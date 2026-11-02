"""HOTLINE DESK — the call index behind Smart Comms → Hotline.
WHAT THIS FILE IS."""
from __future__ import annotations

import asyncio
import concurrent.futures
import functools
import hashlib
import json
import logging
import math
import os
import re
import socket
import ssl
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, NamedTuple

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover - Python < 3.9 is not a runtime here
    ZoneInfo = None  # type: ignore[assignment]

try:
    import psycopg2
    import psycopg2.extras
except Exception:  # pragma: no cover - the caller is told, never guessed at
    psycopg2 = None  # type: ignore[assignment]

try:
    # The order every book read here follows: the kept copy, the mirror, Google.
    import mirror_first
except Exception:  # noqa: BLE001 - without it the books are read live, as before
    mirror_first = None  # type: ignore[assignment]

# One badge answered wherever another is asked for, while two badges are equivalent (badge_follows).
import badge_follows
# asa-hub-db's copy of the sheets (asked of asa-hub-app), where the old platform's mirror was read
import hub_rows

log = logging.getLogger("hub.hotline")

# ── The two desk lines ───────────────────────────────────────────────────────
HOTLINE_LINE = "+13309195558"
# The 5558's own Quo number id, as an event's deepLink names it (/inbox/<id>/).
HOTLINE_LINE_ID = "PNPqYnvZUD"
SCREENING_LINE = "+13307544040"
LINES = [
    {"line": HOTLINE_LINE, "key": "hotline", "label": "Employee Support Hotline"},
    {"line": SCREENING_LINE, "key": "screening", "label": "Phone Screening"},
]
APP_ID = "smartcomms"


# ── The books, named in full rather than discovered ───────────────────────── The same law comm_calls_slices keeps…
class Book(NamedTuple):
    key: str
    sheet_id: str
    tab: str
    label: str


TRANSCRIPTS = Book("transcripts",
                   os.getenv("HUB_HOTLINE_TRANSCRIPTS_SHEET_ID")
                   or "1nkYZ24EtG4woyIShMKouj1kWdQD2IGpjUkWEamZHMno",
                   "Transcripts", "the transcript inbox (New Transcripts)")
CALLS_HOUSE = Book("calls_house",
                   os.getenv("HUB_HOTLINE_CALLS_HOUSE_SHEET_ID")
                   or "1bLSxXOzmNS8gURKpDP9cnhPzk2qquPNqUS7CGd0og50",
                   "Data", "the calls house (ASA Data — Calls)")
RECAPS = Book("recaps",
              os.getenv("HUB_HOTLINE_RECAPS_SHEET_ID")
              or "1QvwIN5zYNL17hPwIV4DSkdIhKQJa89qTlYBIl86asuI",
              "Data", "the summaries house (ASA Data — Recaps)")
HOTLINE_LOG = Book("hotline_log",
                   os.getenv("HUB_HOTLINE_LOG_SHEET_ID")
                   or "1nbdJ-jOrFsf3eyzY9uAaQ9RPnIcJ8Gwmymt9JFsZFjg",
                   "Data", "the hotline processing log")

LINES_TABLE = os.getenv("HUB_LINES_TABLE", "public.asa_openphone_lines")
PEOPLE_PATH = os.getenv("HUB_HOTLINE_PEOPLE", "/srv/snapshot/people.json")
# The Core book: accounts (`users`), the App Access matrix and the tenant matrix.
CORE_SHEET_ID = os.getenv("HUB_DB_SHEET_ID", "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg")
# The hotline's own settings house (key/value rows), read from the Drive mirror only: two numbers that almost never…
HOTLINE_CONFIG_SHEET_ID = (os.getenv("HUB_HOTLINE_CONFIG_SHEET_ID")
                           or "1XTaqJDks2zk0PqkXDotxcCrDCZQjG1g3hG8fMJBDx8M")

INDEX_MAX_AGE_S = float(os.getenv("HUB_HOTLINE_INDEX_MAX_AGE", "45"))
# A build that could not produce an index at all is not retried by every request that arrives behind it: the refusal…
INDEX_RETRY_S = 10.0
# A request that finds a held index merely old waits this long for the build it started, then takes the held one: a…
HELD_WAIT_S = 8.0
# THE QUOTA IS A MINUTE WIDE, SO THE PAUSE IS WIDER.
QUOTA_HOLD_S = 180.0
# Hotline.gs HOTLINE_MAX_AGE_DAYS: a call older than this is never opened by the sweep, so an unread one is `held`…
HOTLINE_MAX_AGE_DAYS = 14
# The sweep writes "+N capped" beside the kinds when a call carried more note rows than one call may file: a count…
CAPPED_MARK = re.compile(r"^\+\d+\s+capped$", re.I)

# The columns each book is asked for. Key → the header text, exactly.
A_FIELDS = {"call_id": "Call ID", "created": "Transcript Created", "event_at": "Event Timestamp",
            "duration": "Duration (sec)", "quo": "Quo Number", "participants": "Participant(s)",
            "team": "Team Member(s)", "direction": "Direction", "turns": "# Turns",
            "processed": "Processed", "processed_at": "ProcessedAt"}
A_WORDS = {"full": "Full Transcript", "speaker": "Speaker Transcript"}
B_FIELDS = {"call_id": "call_id", "created": "transcript_created", "event_at": "event_at",
            "duration": "duration_s", "quo": "quo_number", "participants": "participants",
            "team": "team_members", "direction": "direction", "turns": "turns"}
B_WORDS = {"full": "full_transcript", "speaker": "speaker_transcript"}
R_FIELDS = {"call_id": "call_id", "summary": "summary", "next_steps": "next_steps",
            "received_at": "received_at", "created": "createdAt"}
# `caller` is deliberately absent: the log's phone column is not the screen's business, and the index never carries…
L_FIELDS = {"call_id": "call_id", "at": "at", "items": "items", "kinds": "kinds",
            "status": "status", "via": "via"}

# THE WORDS, BY NAME.
_WORDS = frozenset(A_WORDS.values()) | frozenset(B_WORDS.values())

# THE SHARED-LINE FLOOR.
DECLARED_SHARED_FLOOR = ("3307544040", "3309195558", "3309195559", "3330919558")
TALENT_GS = Path(os.getenv("HUB_TALENT_GS")
                 or (Path(__file__).resolve().parent.parent / "apps-script" / "Talent.gs"))

SA_PATH = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "/app/service-account.json")
IMPERSONATE = os.getenv("GOOGLE_IMPERSONATE_USER", "jarvis@asalifecare.com")
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]


class SourceError(RuntimeError):
    """A source could not be read. The message is a sentence for a person."""


class IndexUnavailable(RuntimeError):
    """Neither inbox has ever been read — an index would read as 'nobody called'."""


class CallNotFound(KeyError):
    """The call id is not in the index."""


# ═══════════════════════════════════════════════════════════════════════════ Times…
_SHEETS_EPOCH = datetime(1899, 12, 30)
_MONTHS = {m: i + 1 for i, m in enumerate(
    ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}
_MDY = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})"
                  r"(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?)?\s*$")
# "Wed Sep 16 2026 17:45:36 GMT-0400 (Eastern Daylight Time)" — a JS Date that was written into a cell as text.
_JS_DATE = re.compile(r"^\s*(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+"
                      r"(\d{1,2}):(\d{2}):(\d{2})\s+GMT([+-])(\d{2}):?(\d{2})")
_ISO_HEAD = re.compile(r"^\d{4}-\d{2}-\d{2}")


def _zone(name: str | None):
    if ZoneInfo is not None and name:
        try:
            return ZoneInfo(name)
        except Exception:  # noqa: BLE001 - an unknown zone name is read as UTC
            pass
    return timezone.utc


def serial_to_utc(value: Any, tz_name: str | None) -> datetime | None:
    """A Sheets serial date (days since 1899-12-30, local to the book) → UTC."""
    try:
        days = float(value)
    except (TypeError, ValueError):
        return None
    if not 1.0 < days < 2958465.0:
        return None
    # HALF A SECOND GOES UP, AS SHEETS SHOWS IT.
    naive = _SHEETS_EPOCH + timedelta(seconds=math.floor(days * 86400.0 + 0.5))
    return naive.replace(tzinfo=_zone(tz_name)).astimezone(timezone.utc)


def parse_when(value: Any, tz_name: str | None) -> datetime | None:
    """Any date shape this estate writes, as an aware UTC datetime, or None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return serial_to_utc(value, tz_name)
    text = str(value).strip()
    if not text:
        return None
    m = _JS_DATE.match(text)
    if m:
        mon = _MONTHS.get(m.group(1).lower())
        if not mon:
            return None
        sign = 1 if m.group(7) == "+" else -1
        offset = timedelta(hours=int(m.group(8)), minutes=int(m.group(9))) * sign
        try:
            local = datetime(int(m.group(3)), mon, int(m.group(2)),
                             int(m.group(4)), int(m.group(5)), int(m.group(6)),
                             tzinfo=timezone(offset))
        except ValueError:
            return None
        return local.astimezone(timezone.utc)
    if _ISO_HEAD.match(text):
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00").replace(" ", "T", 1))
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_zone(tz_name))
        return dt.astimezone(timezone.utc)
    m = _MDY.match(text)
    if m:
        hour = int(m.group(4) or 0)
        ampm = (m.group(7) or "").lower()
        if ampm == "pm" and hour < 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0
        try:
            naive = datetime(int(m.group(3)), int(m.group(1)), int(m.group(2)),
                             hour, int(m.group(5) or 0), int(m.group(6) or 0))
        except ValueError:
            return None
        return naive.replace(tzinfo=_zone(tz_name)).astimezone(timezone.utc)
    if re.fullmatch(r"\d{5}(?:\.\d+)?", text):
        # a serial that arrived as text
        return serial_to_utc(float(text), tz_name)
    return None


def iso_utc(dt: datetime | None) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if dt else ""


# ═══════════════════════════════════════════════════════════════════════════ Phones and lines…
def digits(value: Any) -> str:
    """Last ten digits — the key every reader of a number on this platform computes (line_directory.digits…"""
    d = re.sub(r"\D+", "", str(value if value is not None else ""))
    if len(d) >= 11 and d.startswith("1"):
        d = d[1:]
    d = d[-10:]
    return d if len(d) == 10 else ""


def e164(value: Any) -> str:
    """A number as E.164."""
    raw = str(value if value is not None else "").strip()
    d = re.sub(r"\D+", "", raw)
    if len(d) == 10:
        return "+1" + d
    if len(d) == 11 and d.startswith("1"):
        return "+" + d
    if raw.startswith("+") and 11 <= len(d) <= 15:
        return "+" + d
    return ""


def split_phones(cell: Any) -> list[str]:
    """A parties cell ("+13309195558, +13307544040") as its entries, in order."""
    return [p.strip() for p in re.split(r"[,;|/\n]+", str(cell if cell is not None else ""))
            if p.strip()]


def is_provider_id(value: Any) -> bool:
    return bool(re.fullmatch(r"PN[A-Za-z0-9]{6,}", str(value if value is not None else "").strip()))


def shared_floor() -> set[str]:
    """The declared shared lines: Talent.gs when it is on disk, UNIONED with the copy above (see…"""
    out = set(DECLARED_SHARED_FLOOR)
    try:
        src = TALENT_GS.read_text(encoding="utf-8")
        m = re.search(r"var\s+SHARED_LINE_DIGITS\s*=\s*\[([^\]]*)\]", src)
        if m:
            out |= {digits(x) for x in re.findall(r"'([^']*)'", m.group(1)) if digits(x)}
    except OSError:
        pass
    return out


def resolve_line(quo: Any, team: Any, logged: bool, provider_ids: dict[str, str]) -> str:
    """Which desk line a call belongs to: '+13309195558', '+13307544040' or ''."""
    wanted = {digits(HOTLINE_LINE): HOTLINE_LINE, digits(SCREENING_LINE): SCREENING_LINE}
    raw = str(quo if quo is not None else "").strip()
    if raw:
        d = digits(raw)
        if not d and is_provider_id(raw):
            d = provider_ids.get(raw, "")
        if d:
            if d not in wanted:
                return ""
            return HOTLINE_LINE if logged else wanted[d]
    if logged:
        return HOTLINE_LINE
    team_digits = [digits(p) for p in split_phones(team)]
    for line_digits in (digits(HOTLINE_LINE), digits(SCREENING_LINE)):
        if line_digits in team_digits:
            return wanted[line_digits]
    return ""


def resolve_caller(line: str, participants: Any, team: Any, *,
                   company: dict[str, str] | None, floor: set[str],
                   roster: dict[str, dict[str, str]] | None) -> dict[str, str]:
    """The other party on a call, and whether a name may be said."""
    line_digits = digits(line)
    phone_raw = ""
    for cell in (participants, team):
        for p in split_phones(cell):
            d = digits(p)
            if d and d != line_digits:
                phone_raw = p
                break
        if phone_raw:
            break
    d = digits(phone_raw)
    out = {"phone": e164(phone_raw) if d else "", "kind": "unknown", "line_name": "",
           "who": "unknown", "name": ""}
    if not d:
        return out
    if d in floor or (company is not None and d in company):
        out.update(kind="company_line", who="shared", line_name=(company or {}).get(d, ""))
        return out
    if company is None:
        # Not provably outside: the list of our own lines was not seen.
        return out
    out["kind"] = "outside"
    if roster is None:
        return out
    people = roster.get(d) or {}
    if len(people) == 1:
        out.update(who="sole", name=next(iter(people.values())))
    elif len(people) > 1:
        out["who"] = "shared"
    return out


# ═══════════════════════════════════════════════════════════════════════════ The hotline's verdict on one call…
def _int_or_none(value: Any) -> int | None:
    if value is None or isinstance(value, bool) or str(value).strip() == "":
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def hotline_state(log_rows: list[dict], processed: Any, processed_at: Any, has_words: bool,
                  at: datetime | None, *, now: datetime, tz_name: str | None,
                  log_zone: str | None = "UTC", log_fresh: bool = True,
                  max_age_days: int = HOTLINE_MAX_AGE_DAYS, log_why: str = "") -> dict[str, Any]:
    """What the sweep did with a hotline call, read from what it wrote down."""
    def rank(r: dict) -> tuple[float, int]:
        dt = parse_when(r.get("at"), log_zone)
        return (dt.timestamp() if dt else 0.0, int(r.get("_row") or 0))

    def of(status: str) -> list[dict]:
        return sorted((r for r in log_rows if str(r.get("status") or "").strip().lower() == status),
                      key=rank, reverse=True)

    filed, blocked = of("processed"), of("blocked")
    if filed:
        r = filed[0]
        tokens = [k.strip() for k in str(r.get("kinds") or "").split(",") if k.strip()]
        capped = [int(re.sub(r"\D", "", t) or 0) for t in tokens if CAPPED_MARK.match(t)]
        return {"state": "filed", "at": iso_utc(parse_when(r.get("at"), log_zone)),
                "kinds": [t for t in tokens if not CAPPED_MARK.match(t)],
                "items": _int_or_none(r.get("items")), "via": str(r.get("via") or "").strip(),
                "why": "", "capped": sum(capped) if capped else None}
    base = {"at": "", "kinds": [], "items": None, "via": "", "why": "", "capped": None}
    refusal = str(blocked[0].get("via") or "").strip() if blocked else ""
    # A call whose time cannot be read is CURRENT, exactly as the sweep treats it.
    young = at is None or now - at <= timedelta(days=max_age_days)
    if str(processed if processed is not None else "").strip():
        if not log_fresh and young:
            return {**base, "state": "unlogged", "via": refusal,
                    "why": log_why or ("The processing log could not be read just now, so "
                                       "what the hotline read filed from this call is not known.")}
        return {**base, "state": "legacy", "at": iso_utc(parse_when(processed_at, tz_name)),
                "via": refusal,
                "why": ("The hotline read was refused on this call, and the Processed cell "
                        "was filled elsewhere afterwards.") if blocked else ""}
    if blocked:
        r = blocked[0]
        return {"state": "blocked", "at": iso_utc(parse_when(r.get("at"), log_zone)), "kinds": [],
                "items": _int_or_none(r.get("items")), "via": refusal,
                "why": ("The model would not answer: " + refusal) if refusal
                else "The model would not answer."}
    if not has_words:
        return {**base, "state": "no_words"}
    if not young:
        return {**base, "state": "held",
                "why": f"Older than the sweep's {max_age_days} days, so it is never opened."}
    return {**base, "state": "waiting"}


_SHEET_ERROR = re.compile(r"#(?:ERROR!|N/A|VALUE!|REF!|NAME\?|DIV/0!|NUM!|NULL!)")


def _cell_text(value: Any) -> str:
    text = str(value if value is not None else "").strip()
    return "" if _SHEET_ERROR.fullmatch(text) else text


def next_steps_list(cell: Any) -> list[str]:
    text = _cell_text(cell)
    if not text:
        return []
    if text.startswith("["):
        try:
            got = json.loads(text)
            if isinstance(got, list):
                return [str(x).strip() for x in got if str(x).strip()]
        except ValueError:
            pass
    out = []
    for ln in text.splitlines():
        step = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", ln).strip()
        if step:
            out.append(step)
    return out


# ═══════════════════════════════════════════════════════════════════════════ Speaker transcripts…
_TURN = re.compile(r"^\s*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s*([^:\n]{0,80}?)\s*:\s?(.*)$")


def parse_speaker_transcript(text: Any, line: str, caller_phone: str) -> list[dict[str, str]]:
    """Lines like "[0:00] +13309195558: Hello." as turns."""
    line_digits = digits(line)
    caller_digits = digits(caller_phone)
    turns: list[dict[str, str]] = []
    for raw in str(text if text is not None else "").splitlines():
        m = _TURN.match(raw)
        if m:
            speaker = m.group(2).strip()
            sd = digits(speaker)
            role = ("agent" if sd and sd == line_digits
                    else "caller" if sd and sd == caller_digits else "other")
            turns.append({"at": m.group(1), "speaker": speaker, "role": role,
                          "text": m.group(3).strip()})
            continue
        piece = raw.strip()
        if not piece:
            continue
        if turns:
            turns[-1]["text"] = (turns[-1]["text"] + "\n" + piece).strip()
        else:
            turns.append({"at": "", "speaker": "", "role": "other", "text": piece})
    return turns if any(t["at"] for t in turns) else []


# ═══════════════════════════════════════════════════════════════════════════ A webhook dialogue, written the way…
def _js_truthy(value: Any) -> bool:
    if value is None or isinstance(value, bool):
        return bool(value)
    if isinstance(value, (int, float)):
        return value == value and value != 0
    if isinstance(value, str):
        return value != ""
    return True


def _js_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value == value and value.is_integer():
        return str(int(value))
    return str(value)


def _js_round(value: Any) -> int | None:
    """Math.round — a half goes up, toward +infinity. None stands for NaN."""
    try:
        x = float(value.strip() if isinstance(value, str) else value)
    except (TypeError, ValueError):
        return None
    if x != x or x in (float("inf"), float("-inf")):
        return None
    whole = math.floor(x)
    return whole + 1 if x - whole >= 0.5 else whole


def _dialogue_turns(dialogue: Any) -> list[dict[str, Any]]:
    return [t for t in (dialogue if isinstance(dialogue, list) else []) if isinstance(t, dict)]


def _user_phones(turns: list[dict[str, Any]]) -> dict[str, Any]:
    """buildUserIdToPhoneMap: each userId → the first identifier it spoke from."""
    out: dict[str, Any] = {}
    for t in turns:
        uid, ident = t.get("userId"), t.get("identifier")
        if _js_truthy(uid) and _js_truthy(ident) and not _js_truthy(out.get(_js_text(uid))):
            out[_js_text(uid)] = ident
    return out


def team_phones(dialogue: Any) -> str:
    """extractTeamMemberPhones: each distinct userId as its phone (or the id)."""
    turns = _dialogue_turns(dialogue)
    phones = _user_phones(turns)
    seen: set[str] = set()
    out: list[str] = []
    for t in turns:
        uid = t.get("userId")
        if not _js_truthy(uid) or _js_text(uid) in seen:
            continue
        seen.add(_js_text(uid))
        phone = phones.get(_js_text(uid))
        out.append(_js_text(phone if _js_truthy(phone) else uid))
    return ", ".join(out)


def caller_phones(dialogue: Any, line: Any = "") -> str:
    """extractExternalParticipants: identifiers that spoke without a userId, the line itself left out when it is…"""
    seen: set[str] = set()
    out: list[str] = []
    for t in _dialogue_turns(dialogue):
        ident = t.get("identifier")
        if not _js_truthy(ident) or _js_text(ident) in seen:
            continue
        if _js_truthy(line) and ident == line:
            continue
        if _js_truthy(t.get("userId")):
            continue
        seen.add(_js_text(ident))
        out.append(_js_text(ident))
    return ", ".join(out)


def _format_dialogue(dialogue: Any) -> tuple[str, str]:
    """formatTranscript: (plain, separated) — "[m:ss] speaker: content" lines."""
    turns = _dialogue_turns(dialogue)
    phones = _user_phones(turns)
    plain: list[str] = []
    separated: list[str] = []
    for t in turns:
        content = _js_text(t.get("content")) if _js_truthy(t.get("content")) else ""
        sec = _js_round(t.get("start")) if _js_truthy(t.get("start")) else 0
        speaker = _js_text(t.get("identifier")) if _js_truthy(t.get("identifier")) else ""
        uid = t.get("userId")
        if not speaker and _js_truthy(uid):
            mapped = phones.get(_js_text(uid))
            speaker = _js_text(mapped if _js_truthy(mapped) else uid)
        plain.append(content)
        if sec is None:
            stamp = "NaN:NaN"
        else:
            secs = int(math.fmod(sec, 60))
            stamp = f"{math.floor(sec / 60)}:{'0' if secs < 10 else ''}{secs}"
        separated.append(f"[{stamp}] {speaker}: {content}")
    return " ".join(plain), "\n".join(separated)


def dialogue_text(dialogue: Any) -> str:
    """The Speaker Transcript cell the legacy receiver would write."""
    return _format_dialogue(dialogue)[1]


def is_hotline(dialogue: Any, line: str = HOTLINE_LINE) -> bool:
    """The sweep's own membership test (hotlineTeamMatch_) over the team the dialogue names: is the line one of…"""
    want = re.sub(r"[^0-9]", "", line)
    return bool(want) and any(re.sub(r"[^0-9]", "", p) == want
                              for p in re.split(r"[,;|/]+", team_phones(dialogue)))


def link_names_another_line(deep_link: Any, line_id: str = HOTLINE_LINE_ID) -> bool:
    """Does the event's deepLink open another number's inbox?"""
    link = deep_link if isinstance(deep_link, str) else ""
    return "/inbox/PN" in link and f"/inbox/{line_id}/" not in link


# ═══════════════════════════════════════════════════════════════════════════ Sheets plumbing…
_CREDS: dict[str, Any] = {"creds": None}
_CREDS_LOCK = threading.Lock()
_ZONES: dict[str, str] = {}
_HEADERS: dict[tuple[str, str], list[str]] = {}
_META_LOCK = threading.Lock()


def _credentials():
    """The mounted service account, impersonating when the domain allows it — the plumbing comm_calls_slices…"""
    with _CREDS_LOCK:
        if _CREDS["creds"] is not None:
            return _CREDS["creds"]
        import base64
        from google.oauth2 import service_account
        raw = (SA_PATH or "").strip()
        info = None
        if raw.startswith("{"):
            info = json.loads(raw)
        elif not raw.startswith("/") and len(raw) > 512:
            try:
                info = json.loads(base64.b64decode(raw))
            except Exception:  # noqa: BLE001
                info = None
        if info is not None:
            base = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
        else:
            base = service_account.Credentials.from_service_account_file(raw, scopes=SCOPES)
        creds = base
        try:
            import google.auth.transport.requests as gtr
            probe = base.with_subject(IMPERSONATE)
            probe.refresh(gtr.Request())
            creds = probe
        except Exception:  # noqa: BLE001 — plain SA still sees shared books
            pass
        _CREDS["creds"] = creds
        return creds


def sheets_client(timeout: float = 15.0):
    """A fresh Sheets service on the shared credentials."""
    from googleapiclient.discovery import build as gbuild
    try:
        import google_auth_httplib2
        import httplib2
        authed = google_auth_httplib2.AuthorizedHttp(_credentials(),
                                                     http=httplib2.Http(timeout=timeout))
        return gbuild("sheets", "v4", http=authed, cache_discovery=False)
    except ImportError:
        return gbuild("sheets", "v4", credentials=_credentials(), cache_discovery=False)


# SERVICES ARE LENT, NOT BUILT PER READ.
_POOL: list[Any] = []
_GATE_SERVICES: list[Any] = []
_POOL_LOCK = threading.Lock()


class _Lent:
    def __init__(self, sheets: Any, shelf: list[Any] | None = None) -> None:
        self._factory = sheets if (callable(sheets) and not hasattr(sheets, "spreadsheets")) else None
        self._given = None if self._factory else sheets
        self._shelf = _POOL if shelf is None else shelf
        self.svc: Any = None

    def __enter__(self) -> Any:
        if self._given is not None:
            self.svc = self._given
            return self.svc
        with _POOL_LOCK:
            self.svc = self._shelf.pop() if self._shelf else None
        if self.svc is None:
            self.svc = self._factory()
        return self.svc

    def __exit__(self, exc_type, exc, tb) -> None:
        # A service whose borrowing block raised is dropped rather than lent on.
        if self._given is None and exc_type is None:
            with _POOL_LOCK:
                if len(self._shelf) < 4:
                    self._shelf.append(self.svc)


def _sentence(what: str) -> str:
    return what[:1].upper() + what[1:]


# THE PASS HAS A DEADLINE, NOT ONLY EACH REQUEST.
PASS_BUDGET_S = 20.0
_BUDGET = threading.local()

_QUOTA: dict[str, float] = {"until": 0.0, "at": 0.0}
_QUOTA_LOCK = threading.Lock()


def _stamp(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%H:%M:%SZ")


def quota_hold_left() -> float:
    """Seconds left on the pause a 429 started (0 when no pause is on)."""
    with _QUOTA_LOCK:
        return max(0.0, _QUOTA["until"] - time.time())


def quota_hold_sentence(what: str) -> str:
    """The sentence a read skipped by the pause is refused with."""
    with _QUOTA_LOCK:
        at, until = _QUOTA["at"], _QUOTA["until"]
    return (f"{_sentence(what)} was not asked: Google refused a read for quota "
            f"at {_stamp(at)}, and the desk holds its reads until {_stamp(until)}.")


def _quota_refused() -> None:
    """Start the pause."""
    now = time.time()
    with _QUOTA_LOCK:
        fresh = _QUOTA["until"] <= now
        if fresh:
            _QUOTA["at"], _QUOTA["until"] = now, now + QUOTA_HOLD_S
    if fresh:
        log.warning("hotline desk: Sheets refused a read for quota (HTTP 429); the desk "
                    "holds its Sheets reads for %.0fs and serves what it holds", QUOTA_HOLD_S)


def _execute(make: Callable[[], Any], what: str, *, honour_hold: bool = True,
             hang_s: float | None = None) -> dict:
    """One Sheets request, with a sentence naming what could not be read."""
    delays = (1.5, 4.0)
    last = ""
    for attempt in range(3):
        if honour_hold and quota_hold_left() > 0:
            raise SourceError(quota_hold_sentence(what))
        until_budget = getattr(_BUDGET, "until", None)
        if until_budget is not None and hang_s and time.time() + hang_s > until_budget:
            raise SourceError(f"{_sentence(what)} was not asked: the access check ran out "
                              f"of its {GATE_READ_BUDGET_S:.0f} seconds.")
        if until_budget is not None and time.time() >= until_budget:
            raise SourceError(f"{_sentence(what)} was not asked: the pass ran out of its "
                              f"{PASS_BUDGET_S:.0f} seconds.")
        try:
            return make().execute(num_retries=0)
        except Exception as exc:  # noqa: BLE001
            status = getattr(getattr(exc, "resp", None), "status", None)
            if status == 429:
                _quota_refused()
                last = "HTTP 429"
                break
            hung = isinstance(exc, (socket.timeout, TimeoutError))
            transient = (status in (500, 502, 503, 504) or hung
                         or isinstance(exc, (ConnectionError, ssl.SSLError)))
            if status is not None:
                last = f"HTTP {status}"
            else:
                last = type(exc).__name__
                if "RefreshError" in last:
                    with _CREDS_LOCK:
                        _CREDS["creds"] = None
            in_budget = (until_budget is None
                         or time.time() + delays[min(attempt, 1)] + (hang_s or 0.0) < until_budget)
            if transient and attempt < 2 and in_budget and not (hung and hang_s):
                time.sleep(delays[attempt])
                continue
            break
    raise SourceError(f"{_sentence(what)} could not be read ({last}).")


def _col_letter(index: int) -> str:
    n, out = index + 1, ""
    while n:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out


def _meta(svc: Any, book: Book, refresh: bool = False) -> tuple[str, list[str]]:
    """(the book's timeZone, the tab's header row), held once per process."""
    key = (book.sheet_id, book.tab)
    with _META_LOCK:
        zone, header = _ZONES.get(book.sheet_id), _HEADERS.get(key)
    if zone and header is not None and not refresh:
        return zone, header
    got = _execute(lambda: svc.spreadsheets().get(
        spreadsheetId=book.sheet_id, ranges=[f"'{book.tab}'!1:1"], includeGridData=True,
        fields="properties.timeZone,sheets.data.rowData.values.formattedValue"),
        f"the header of {book.label}")
    zone = str((got.get("properties") or {}).get("timeZone") or "") or "UTC"
    cells: list[Any] = []
    for sheet in got.get("sheets") or []:
        for grid in sheet.get("data") or []:
            rows = grid.get("rowData") or []
            if rows:
                cells = rows[0].get("values") or []
    header = [str((c or {}).get("formattedValue") or "").strip() for c in cells]
    with _META_LOCK:
        _ZONES[book.sheet_id] = zone
        _HEADERS[key] = header
    return zone, header


def book_zone(svc: Any, book: Book) -> str:
    return _meta(svc, book)[0]


def _header(svc: Any, book: Book, refresh: bool = False) -> list[str]:
    return _meta(svc, book, refresh)[1]


def _read_columns(svc: Any, book: Book, fields: dict[str, str],
                  required: tuple[str, ...] = ("call_id",)) -> list[dict[str, Any]]:
    """The named columns of a tab, as one dict per data row (with `_row`)."""
    if any(name in _WORDS for name in fields.values()):
        raise ValueError("a transcript column was asked for in an index read")
    for attempt in range(2):
        header = _header(svc, book, refresh=attempt > 0)
        pos = {k: header.index(name) for k, name in fields.items() if name in header}
        missing = [fields[k] for k in required if k not in pos]
        if missing:
            if attempt == 0:
                continue
            raise SourceError(f"{_sentence(book.label)} has no "
                              f"{', '.join(repr(m) for m in missing)} column.")
        keys = list(pos)
        ranges = [f"'{book.tab}'!{_col_letter(pos[k])}:{_col_letter(pos[k])}" for k in keys]
        got = _execute(lambda: svc.spreadsheets().values().batchGet(
            spreadsheetId=book.sheet_id, ranges=ranges, majorDimension="COLUMNS",
            valueRenderOption="UNFORMATTED_VALUE", dateTimeRenderOption="SERIAL_NUMBER"),
            book.label)
        columns = [((vr.get("values") or [[]])[0]) for vr in (got.get("valueRanges") or [])]
        if len(columns) != len(keys) or any(
                (str(col[0]).strip() if col else "") != fields[k] for k, col in zip(keys, columns)):
            continue
        n = max((len(c) for c in columns), default=0)
        rows = []
        for i in range(1, n):
            row: dict[str, Any] = {k: (columns[j][i] if i < len(columns[j]) else "")
                                   for j, k in enumerate(keys)}
            for k in fields:
                row.setdefault(k, "")
            row["_row"] = i + 1
            if all(str(row[k]).strip() for k in required):
                rows.append(row)
        return rows
    raise SourceError(f"The columns of {book.label} moved while they were being read.")


# ═══════════════════════════════════════════════════════════════════════════ Sources…
_LAST_GOOD: dict[str, tuple[Any, float]] = {}
_LAST_GOOD_LOCK = threading.Lock()


def _read_directory(pg_dsn: str) -> tuple[tuple[dict[str, str], dict[str, str]], int]:
    """((digits → OpenPhone name, provider id → digits), rows) from the platform's own copy of the company lines."""
    if psycopg2 is None:
        raise SourceError("The company line directory could not be read (psycopg2 is not importable).")
    if not pg_dsn:
        raise SourceError("The company line directory could not be read (no database is configured).")
    try:
        with psycopg2.connect(pg_dsn, connect_timeout=8) as conn, conn.cursor() as cur:
            cur.execute(f"select id, number, name from {LINES_TABLE}")  # noqa: S608 - config, not input
            got = cur.fetchall()
    except Exception as exc:  # noqa: BLE001
        raise SourceError(f"The company line directory could not be read ({type(exc).__name__}).") from exc
    if not got:
        raise SourceError(f"The company line directory ({LINES_TABLE}) holds no rows.")
    names: dict[str, str] = {}
    ids: dict[str, str] = {}
    for pid, number, name in got:
        d = digits(number)
        if not d:
            continue
        names[d] = str(name or "").strip()
        if pid:
            ids[str(pid).strip()] = d
    return (names, ids), len(got)


# Accounts that are not staff: contact guard's staffContactIndex_ skips them.
_NOT_STAFF_ROLES = frozenset({"client", "onboarding", "interviewer"})


def _phone_entries(cell: Any) -> list[Any]:
    """A phones cell or list as its entries — profileParsePhones_ on the relay's side: a list as given, JSON text…"""
    if isinstance(cell, list):
        return cell
    text = str(cell if cell is not None else "").strip()
    if not text:
        return []
    try:
        got = json.loads(text)
        return got if isinstance(got, list) else []
    except ValueError:
        parts = [p for p in re.split(r"\s*[;,]\s*", text) if p]
        return [p.split(":", 1)[1].strip() if ":" in p else p.strip() for p in parts]


def _phone_of(entry: Any) -> str:
    if isinstance(entry, dict):
        return str(entry.get("number") or entry.get("value") or "")
    return str(entry if entry is not None else "")


def _read_roster(people_path: str, pg_dsn: str = "",
                 core_sheet_id: str = CORE_SHEET_ID) -> tuple[dict[str, dict[str, str]], int]:
    """digits → {name key → display name}, built the way the contact guard builds its index (staffContactIndex_…"""
    try:
        with open(people_path, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:  # noqa: BLE001
        raise SourceError(f"The staff roster could not be read ({type(exc).__name__}).") from exc
    rows = data.get("rows") if isinstance(data, dict) else None
    if not isinstance(rows, list) or not rows:
        raise SourceError("The staff roster file carries no rows.")
    try:
        accounts = hub_rows.rows(core_sheet_id, "users")
    except Exception as exc:  # noqa: BLE001
        raise SourceError(f"The staff accounts could not be read ({type(exc).__name__}), "
                          "so no caller is named.") from exc
    if not accounts:
        raise SourceError("The staff accounts copy holds no rows, so no caller is named.")

    out: dict[str, dict[str, str]] = {}

    def add(name_cell: Any, phone: Any) -> None:
        d = digits(_phone_of(phone))
        name = " ".join(str(name_cell or "").split())
        key = re.sub(r"[^a-z0-9]", "", name.lower())
        if d and key:
            out.setdefault(d, {}).setdefault(key, name)

    for r in rows:
        if not isinstance(r, dict):
            continue
        add(r.get("name"), r.get("phone"))
        for entry in _phone_entries(r.get("phones")):
            add(r.get("name"), entry)
    for u in accounts:
        if not isinstance(u, dict):
            continue
        if str(u.get("role") or "").strip().lower() in _NOT_STAFF_ROLES:
            continue
        if str(u.get("system_type") or "").strip():
            continue
        add(u.get("display_name"), u.get("phone"))
        for entry in _phone_entries(u.get("phones")):
            add(u.get("display_name"), entry)
    return out, len(rows) + len(accounts)


def _read_config(pg_dsn: str) -> tuple[dict[str, Any], int]:
    """{max_age_days} from the hotline_config house's mirror (key/value rows), with the sweep's shipped default…"""
    try:
        got = hub_rows.rows(HOTLINE_CONFIG_SHEET_ID, "Data")
    except Exception as exc:  # noqa: BLE001
        raise SourceError(f"The hotline settings could not be read ({type(exc).__name__}).") from exc
    over = {str((r or {}).get("key") or "").strip(): str((r or {}).get("value") or "").strip()
            for r in got if isinstance(r, dict)}
    try:
        days = max(1, int(over.get("max_age_days") or HOTLINE_MAX_AGE_DAYS))
    except ValueError:
        days = HOTLINE_MAX_AGE_DAYS
    team = digits(over.get("team_phone") or "")
    if team and team != digits(HOTLINE_LINE) and _CONFIG_SAID.get("team") != team:
        _CONFIG_SAID["team"] = team
        log.warning("hotline desk: hotline_config points the sweep at another team line; "
                    "the desk still reads %s as the hotline", HOTLINE_LINE)
    return {"max_age_days": days}, len(got)


_CONFIG_SAID: dict[str, str] = {}


def _serve(source: str, read: Callable[[], tuple[Any, ...]]) -> tuple[Any, dict[str, Any], float]:
    """Run one source read; on failure fall back to its last good answer."""
    t0 = time.time()
    try:
        got = read()
        value, count = got[0], got[1]
        copy = got[2] if len(got) > 2 else ""
        if copy:
            return value, {"ok": False, "rows": count, "error": copy}, (time.time() - t0) * 1000
        with _LAST_GOOD_LOCK:
            _LAST_GOOD[source] = ((value, count), time.time())
        return value, {"ok": True, "rows": count, "error": ""}, (time.time() - t0) * 1000
    except Exception as exc:  # noqa: BLE001
        sentence = str(exc) if isinstance(exc, SourceError) else \
            f"The {source.replace('_', ' ')} source failed ({type(exc).__name__})."
        with _LAST_GOOD_LOCK:
            last = _LAST_GOOD.get(source)
        ms = (time.time() - t0) * 1000
        if last:
            (value, count), at = last
            stamp = datetime.fromtimestamp(at, timezone.utc).strftime("%H:%M:%SZ")
            return value, {"ok": False, "rows": count,
                           "error": f"{sentence} Showing the copy read at {stamp}."}, ms
        return None, {"ok": False, "rows": None, "error": sentence}, ms


# ═══════════════════════════════════════════════════════════════════════════ A book, in the fixed order: the kept…
_COPIES = mirror_first.Copies("hotline-desk") if mirror_first is not None else None

# THE NEWS: when the relay last rang for a filing (invalidate).
_NEWS: dict[str, float] = {"at": mirror_first.STARTED_AT if mirror_first is not None
                           else time.time()}

# The zone a DATE CELL's text is shown in, for a mirror read made before this process has asked the book for its…
_DECLARED_ZONES = {TRANSCRIPTS.sheet_id: "America/Sao_Paulo"}


def news_at() -> float:
    """When the relay last rang for a filing — the moment a copy must be newer than."""
    return float(_NEWS["at"])


def mirror_zone(book: Book, kept: dict[str, Any] | None = None, default: str = "UTC") -> str:
    """The book's zone for text read out of the mirror: what a live read of it learned (this process, or the copy…"""
    value = (kept or {}).get("value") if isinstance(kept, dict) else None
    return (str((value or {}).get("zone") or "") or _ZONES.get(book.sheet_id)
            or _DECLARED_ZONES.get(book.sheet_id) or default)


def read_first(svc: Any, book: Book, fields: dict[str, str], pg_dsn: str, *,
               copies: Any = None, refuse: frozenset[str] = frozenset(),
               required: tuple[str, ...] = ("call_id",),
               must_have: tuple[str, ...] | None = None,
               write: bool = True) -> tuple[Any, int, str]:
    """(value {zone, rows, as_of, until}, count, '' or the sentence of the copy standing in)."""
    refused = _WORDS | frozenset(refuse)
    if any(name in refused for name in fields.values()):
        raise ValueError("a refused column was asked for in an index read")

    def live() -> tuple[Any, int]:
        zone = book_zone(svc, book)
        rows = _read_columns(svc, book, fields, required)
        return {"zone": zone, "rows": rows}, len(rows)

    copies = copies if copies is not None else _COPIES
    if mirror_first is None or copies is None:
        value, count = live()
        return value, count, ""

    def from_mirror(kept: dict[str, Any] | None) -> tuple[Any, int]:
        rows = mirror_first.mirror_rows(pg_dsn, book.sheet_id, book.tab, fields,
                                        refuse=refused, required=required, must_have=must_have)
        return {"zone": mirror_zone(book, kept or copies.get(book.key)), "rows": rows}, len(rows)

    ans = mirror_first.read(
        book.key, copies, label=book.label, need_after=news_at(),
        vouch=lambda: mirror_first.vouch(pg_dsn, book.sheet_id, book.tab),
        from_mirror=from_mirror, from_live=live,
        paused=lambda: quota_hold_sentence(book.label) if quota_hold_left() > 0 else "",
        fail=SourceError,
        sentence_of=lambda exc: (str(exc) if isinstance(exc, SourceError)
                                 else f"{_sentence(book.label)} could not be read "
                                      f"({type(exc).__name__})."),
        write=write)
    return {**ans.value, "as_of": ans.as_of, "until": ans.until}, ans.count, ans.stale


def _log_in_step(log_val: dict[str, Any] | None, a_val: dict[str, Any] | None) -> bool:
    """IS THE LOG AT LEAST AS NEW AS INBOX A?"""
    log_as_of = float((log_val or {}).get("as_of") or 0.0)
    log_until = float((log_val or {}).get("until") or log_as_of)
    a_as_of = float((a_val or {}).get("as_of") or 0.0)
    a_until = float((a_val or {}).get("until") or a_as_of)
    if not log_as_of or not a_as_of:
        return True
    return log_as_of >= a_until or (log_as_of == a_as_of and log_until >= a_until)


# ═══════════════════════════════════════════════════════════════════════════ The index…
def _merge_inboxes(a_rows: list[dict] | None, b_rows: list[dict] | None,
                   a_zone: str, b_zone: str) -> dict[str, dict[str, Any]]:
    """One entry per call id: A's fields where A filled them, B's in the blanks."""
    calls: dict[str, dict[str, Any]] = {}
    text_zone = a_zone  # text dates were copied from A's display (module docstring)

    def take(rows: list[dict] | None, which: str, zone: str) -> None:
        for r in rows or []:
            cid = str(r.get("call_id") or "").strip()
            if not cid:
                continue
            entry = calls.setdefault(cid, {"a": [], "b": [], "at": None, "duration": None,
                                           "turns": None, "quo": "", "participants": "",
                                           "team": "", "direction": "", "processed": "",
                                           "processed_at": ""})
            entry[which].append(int(r["_row"]))
            if entry["at"] is None:
                for key in ("event_at", "created"):
                    v = r.get(key)
                    when = parse_when(v, zone if isinstance(v, (int, float)) else text_zone)
                    if when is not None:
                        entry["at"] = when
                        break
            for key in ("duration", "turns"):
                if entry[key] is None:
                    entry[key] = _int_or_none(r.get(key))
            for key in ("quo", "participants", "team", "direction", "processed", "processed_at"):
                v = r.get(key)
                if not entry[key] and v is not None and str(v).strip():
                    entry[key] = v if key == "processed_at" else str(v).strip()

    take(a_rows, "a", a_zone)
    take(b_rows, "b", b_zone)
    return calls


def build_index(sheets: Any, pg_dsn: str, people_path: str = PEOPLE_PATH,
                *, now: datetime | None = None,
                core_sheet_id: str = CORE_SHEET_ID) -> dict[str, Any]:
    """Every desk call, newest first — the payload of GET /hub-lanes/hotline/calls plus what the detail read…"""
    t0 = time.time()
    now = now or datetime.now(timezone.utc)
    _BUDGET.until = t0 + PASS_BUDGET_S
    try:
        return _build_index(sheets, pg_dsn, people_path, now, core_sheet_id, t0)
    finally:
        _BUDGET.until = None


def _build_index(sheets: Any, pg_dsn: str, people_path: str, now: datetime,
                 core_sheet_id: str, t0: float) -> dict[str, Any]:
    with _Lent(sheets) as svc:
        def book_read(book: Book, fields: dict[str, str]) -> Callable[[], tuple[Any, ...]]:
            # The kept copy, the mirror, Google — written to disk once, below.
            return lambda: read_first(svc, book, fields, pg_dsn, write=False)

        # The two sources the index cannot exist without are asked first.
        jobs: dict[str, Callable[[], tuple[Any, int]]] = {
            "transcripts": book_read(TRANSCRIPTS, A_FIELDS),
            "hotline_log": book_read(HOTLINE_LOG, L_FIELDS),
            "calls_house": book_read(CALLS_HOUSE, B_FIELDS),
            "recaps": book_read(RECAPS, R_FIELDS),
            "roster": lambda: _read_roster(people_path, pg_dsn, core_sheet_id),
            "lines": lambda: _read_directory(pg_dsn),
            "config": lambda: _read_config(pg_dsn),
        }
        results = {k: _serve(k, fn) for k, fn in jobs.items()}
    if _COPIES is not None:
        _COPIES.flush()

    # TWO SOURCES THE INDEX CANNOT BE HONEST WITHOUT.
    a_val, b_val = results["transcripts"][0], results["calls_house"][0]
    for need in ("transcripts", "hotline_log"):
        if results[need][0] is None:
            raise IndexUnavailable(
                results[need][1]["error"] + " What happened to each call cannot be said "
                "without it, and no earlier copy exists yet.")

    a_zone = (a_val or {}).get("zone") or _ZONES.get(TRANSCRIPTS.sheet_id) or "America/Sao_Paulo"
    b_zone = (b_val or {}).get("zone") or _ZONES.get(CALLS_HOUSE.sheet_id) or "UTC"
    merged = _merge_inboxes((a_val or {}).get("rows"), (b_val or {}).get("rows"), a_zone, b_zone)

    directory = results["lines"][0]
    company = directory[0] if directory else None
    provider_ids = directory[1] if directory else {}
    roster = results["roster"][0]
    floor = shared_floor()

    # WHAT THE LOG'S ABSENCE MAY MEAN depends on whether this build read it: a last good copy cannot vouch that no…
    log_fresh = bool(results["hotline_log"][1]["ok"])
    log_why = ""
    if log_fresh and not _log_in_step(results["hotline_log"][0], a_val):
        log_fresh = False
        log_why = ("The processing log's copy is older than the inbox's, so what the "
                   "hotline read filed from this call is not known yet.")
    max_age_days = int((results["config"][0] or {}).get("max_age_days") or HOTLINE_MAX_AGE_DAYS)

    log_val = results["hotline_log"][0] or {}
    log_zone = log_val.get("zone") or "UTC"
    log_by_call: dict[str, list[dict]] = {}
    # The newest line the sweep WROTE — a filing or a refusal.
    newest_logged: datetime | None = None
    for r in log_val.get("rows") or []:
        log_by_call.setdefault(str(r.get("call_id") or "").strip(), []).append(r)
        at = parse_when(r.get("at"), log_zone)
        if at and (newest_logged is None or at > newest_logged):
            newest_logged = at

    recap_val = results["recaps"][0] or {}
    r_zone = recap_val.get("zone") or "UTC"
    recaps: dict[str, tuple[tuple[float, int], dict]] = {}
    for r in recap_val.get("rows") or []:
        cid = str(r.get("call_id") or "").strip()
        text = _cell_text(r.get("summary"))
        steps = next_steps_list(r.get("next_steps"))
        if not cid or (not text and not steps):
            continue
        stamp = None
        for key in ("received_at", "created"):
            v = r.get(key)
            stamp = parse_when(v, r_zone if isinstance(v, (int, float)) else a_zone)
            if stamp:
                break
        rank = (stamp.timestamp() if stamp else 0.0, int(r["_row"]))
        if cid not in recaps or rank > recaps[cid][0]:
            recaps[cid] = (rank, {"text": text, "next_steps": steps})

    calls: list[dict[str, Any]] = []
    where: dict[str, dict[str, Any]] = {}
    unplaced = 0
    for cid, c in merged.items():
        line = resolve_line(c["quo"], c["team"], cid in log_by_call, provider_ids)
        if not line:
            unplaced += 1
            continue
        key = "hotline" if line == HOTLINE_LINE else "screening"
        caller = resolve_caller(line, c["participants"], c["team"], company=company,
                                floor=floor, roster=roster)
        # THE TURN COUNT STANDS IN FOR THE WORDS, so the index never reads them.
        has_words = bool(c["turns"] and c["turns"] > 0)
        direction = c["direction"].lower() if c["direction"].lower() in ("incoming", "outgoing") else ""
        calls.append({
            "call_id": cid,
            "at": iso_utc(c["at"]),
            "line": line,
            "line_key": key,
            "direction": direction,
            "duration_sec": c["duration"],
            "turns": c["turns"],
            "caller": caller,
            "summary": recaps[cid][1] if cid in recaps else None,
            "hotline": (hotline_state(log_by_call.get(cid, []), c["processed"], c["processed_at"],
                                      has_words, c["at"], now=now, tz_name=a_zone, log_zone=log_zone,
                                      log_fresh=log_fresh, max_age_days=max_age_days,
                                      log_why=log_why)
                        if key == "hotline" else None),
            "has_transcript": has_words,
        })
        where[cid] = {"a": c["a"], "b": c["b"], "line": line, "caller_phone": caller["phone"]}

    calls.sort(key=lambda r: (r["at"] or "", r["call_id"]), reverse=True)

    sources = {k: dict(results[k][1]) for k in
               ("transcripts", "calls_house", "recaps", "hotline_log", "roster")}
    # THE ROSTER NAMES NOBODY WITHOUT THE LINE DIRECTORY, and the screen reads names off `roster` — so that is where…
    lines_health = results["lines"][1]
    if company is None:
        sources["roster"]["ok"] = False
        sources["roster"]["error"] = " ".join(x for x in (
            sources["roster"]["error"], lines_health["error"],
            "No caller is named until the company lines can be read.") if x)
    elif not lines_health["ok"]:
        sources["roster"]["error"] = " ".join(x for x in (
            sources["roster"]["error"], lines_health["error"]) if x)

    # THE VERSION IS EVERYTHING THE SCREEN DRAWS FROM THE INDEX, AND NOTHING ELSE: the calls, each source's health…
    health = {k: {"ok": bool(v.get("ok")), "error": str(v.get("error") or "")}
              for k, v in sources.items()}

    def version_of(drawn: list[dict[str, Any]], **marks: Any) -> str:
        blob = json.dumps({"calls": drawn, "sources": health,
                           "hotline_last_logged_at": iso_utc(newest_logged), **marks},
                          sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]

    version = version_of(calls)
    # A VIEWER THE 4040 IS WITHHELD FROM GETS A VERSION OF WHAT THEY ARE DRAWN.
    version_without_screening = version_of(
        [c for c in calls if c["line_key"] != "screening"], screening_withheld=True)

    payload = {
        "built_at": iso_utc(datetime.now(timezone.utc)),
        "version": version,
        "lines": [dict(x) for x in LINES],
        "sources": sources,
        "hotline_last_logged_at": iso_utc(newest_logged),
        "calls": calls,
    }
    timings = {k: round(v[2]) for k, v in results.items()}
    timings["total"] = round((time.time() - t0) * 1000)
    counts = {
        "hotline": sum(1 for r in calls if r["line_key"] == "hotline"),
        "screening": sum(1 for r in calls if r["line_key"] == "screening"),
        "not_on_a_desk_line": unplaced,
    }
    log.info("hotline desk index: %d hotline + %d screening calls, %d not on a desk line, "
             "sources %s, %d ms", counts["hotline"], counts["screening"], unplaced,
             ",".join(f"{k}={'ok' if v['ok'] else 'FAILED'}" for k, v in sources.items()),
             timings["total"])
    return {"payload": payload, "where": where, "timings": timings, "counts": counts,
            "version_without_screening": version_without_screening,
            # what a webhook call's caller is resolved against (overlay_apply), kept beside the payload and never…
            "context": {"company": company, "roster": roster},
            "zones": {"transcripts": a_zone, "calls_house": b_zone,
                      "recaps": r_zone, "hotline_log": log_zone}}


# ═══════════════════════════════════════════════════════════════════════════ One call's words…
def _row_words(svc: Any, book: Book, words: dict[str, str], id_header: str,
               rows: list[int], call_id: str) -> list[tuple[str, str]]:
    """(full, speaker) for the given rows of one call — each row verified against its own call id cell, and found…"""
    need = [id_header, words["full"], words["speaker"]]
    header = _header(svc, book)
    if any(h not in header for h in need):
        header = _header(svc, book, refresh=True)
        missing = [h for h in need if h not in header]
        if missing:
            raise SourceError(f"{_sentence(book.label)} has no "
                              f"{', '.join(repr(m) for m in missing)} column.")
    ci, fi, si = (_col_letter(header.index(h)) for h in need)

    def fetch(row_numbers: list[int]) -> tuple[list[tuple[str, str]], bool]:
        ranges: list[str] = []
        for n in row_numbers:
            ranges += [f"'{book.tab}'!{ci}{n}", f"'{book.tab}'!{fi}{n}", f"'{book.tab}'!{si}{n}"]
        got = _execute(lambda: svc.spreadsheets().values().batchGet(
            spreadsheetId=book.sheet_id, ranges=ranges, valueRenderOption="UNFORMATTED_VALUE"),
            f"the transcript in {book.label}")
        vals = [(((vr.get("values") or [[""]])[0] or [""])[0])
                for vr in (got.get("valueRanges") or [])]
        out, intact = [], len(vals) == len(ranges)
        for i in range(0, len(vals) - 2, 3):
            if str(vals[i]).strip() != call_id:
                intact = False
                continue
            out.append((str(vals[i + 1] if vals[i + 1] is not None else ""),
                        str(vals[i + 2] if vals[i + 2] is not None else "")))
        return out, intact

    found, intact = fetch(rows)
    if intact and found:
        return found
    got = _execute(lambda: svc.spreadsheets().values().get(
        spreadsheetId=book.sheet_id, range=f"'{book.tab}'!{ci}:{ci}", majorDimension="COLUMNS",
        valueRenderOption="UNFORMATTED_VALUE"), f"the call ids of {book.label}")
    column = (got.get("values") or [[]])[0]
    again = [i + 1 for i, v in enumerate(column) if i > 0 and str(v).strip() == call_id]
    return fetch(again)[0] if again else []


def read_call(sheets: Any, index: dict[str, Any], call_id: str) -> dict[str, Any]:
    """GET /hub-lanes/hotline/call/{call_id}: the words of one call and its summary."""
    where = (index.get("where") or {}).get(call_id)
    if where is None:
        raise CallNotFound(call_id)
    _BUDGET.until = time.time() + PASS_BUDGET_S
    try:
        return _read_call(sheets, index, call_id, where)
    finally:
        _BUDGET.until = None


def _read_call(sheets: Any, index: dict[str, Any], call_id: str,
               where: dict[str, Any]) -> dict[str, Any]:
    failures: list[str] = []
    fallback: dict[str, Any] | None = None
    for source, book, words, id_header, rows in (
            ("transcripts", TRANSCRIPTS, A_WORDS, A_FIELDS["call_id"], where.get("a") or []),
            ("calls_house", CALLS_HOUSE, B_WORDS, B_FIELDS["call_id"], where.get("b") or [])):
        if not rows:
            continue
        try:
            with _Lent(sheets) as svc:
                copies = _row_words(svc, book, words, id_header, rows, call_id)
        except SourceError as exc:
            failures.append(str(exc))
            continue
        for full, speaker in copies:
            full_text, speaker_text = _cell_text(full), _cell_text(speaker)
            turns = parse_speaker_transcript(speaker_text, where["line"], where["caller_phone"])
            if turns:
                plain = full_text or "\n".join(t["text"] for t in turns)
                return {"call_id": call_id,
                        "transcript": {"source": source, "turns": turns, "plain": plain},
                        "summary": _summary_of(index, call_id)}
            if fallback is None and (full_text or speaker_text):
                fallback = {"source": source, "turns": [], "plain": full_text or speaker_text}
    if fallback is None and failures:
        raise SourceError(" ".join(failures))
    return {"call_id": call_id, "transcript": fallback, "summary": _summary_of(index, call_id)}


def _summary_of(index: dict[str, Any], call_id: str) -> dict[str, Any] | None:
    for row in (index.get("payload") or {}).get("calls") or []:
        if row["call_id"] == call_id:
            s = row.get("summary")
            return ({"text": s["text"], "next_steps": list(s["next_steps"]), "source": "recaps"}
                    if s else None)
    return None


# ═══════════════════════════════════════════════════════════════════════════ The in-process cache: at most one…
_DESK: dict[str, Any] = {"index": None, "at": 0.0, "task": None, "failed_at": 0.0, "failure": "",
                         "gen": 0, "task_gen": 0}

# THE DESK'S OWN THREADS.
_DESK_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="hotline-desk")


# THE GATE HAS ITS OWN FOUR.
_GATE_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="hotline-gate")


async def run_on_desk(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Run one blocking desk call (a build, a word read) on the desk's threads."""
    return await asyncio.get_running_loop().run_in_executor(_DESK_POOL, lambda: fn(*args, **kwargs))


async def run_gate(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Run one blocking access check (app_access, or a door's wrapper of it) on the gate's threads — never on the…"""
    return await asyncio.get_running_loop().run_in_executor(_GATE_POOL, lambda: fn(*args, **kwargs))


def _landed(task: "asyncio.Future", gen: int | None = None) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is None:
        # A BUILD STARTED BEFORE AN INVALIDATE read the books before the news: it answers as the held copy, and the…
        fresh = gen is None or gen == _DESK["gen"]
        _DESK["index"], _DESK["at"], _DESK["failure"] = (
            task.result(), time.time() if fresh else 0.0, "")
        return
    _DESK["failed_at"] = time.time()
    _DESK["failure"] = (str(exc) if isinstance(exc, IndexUnavailable)
                        else f"The call index could not be built ({type(exc).__name__}).")
    log.warning("hotline desk index build failed: %s", _DESK["failure"])


async def current_index(sheets: Any, pg_dsn: str, people_path: str = PEOPLE_PATH,
                        max_age_s: float = INDEX_MAX_AGE_S, *,
                        core_sheet_id: str = CORE_SHEET_ID) -> dict[str, Any]:
    """The index, rebuilt when older than `max_age_s`."""
    now = time.time()
    held = _DESK["index"]
    if held is not None and now - _DESK["at"] < max_age_s:
        return held
    task = _DESK["task"]
    if task is None or task.done():
        if held is not None and quota_hold_left() > 0:
            return held
        if held is None and _DESK["failure"] and (now - _DESK["failed_at"] < INDEX_RETRY_S
                                                  or quota_hold_left() > 0):
            raise IndexUnavailable(_DESK["failure"])
        task = _start_build(sheets, pg_dsn, people_path, core_sheet_id)
    if held is not None:
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=HELD_WAIT_S)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - a slow or failed build: the held copy answers
            return held
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        if isinstance(exc, IndexUnavailable):
            raise
        raise IndexUnavailable(f"The call index could not be built ({type(exc).__name__}).") from exc


def _start_build(sheets: Any, pg_dsn: str, people_path: str, core_sheet_id: str) -> "asyncio.Future":
    """Start the one build, tagged with the generation it reads under."""
    gen = _DESK["gen"]
    task = asyncio.ensure_future(run_on_desk(
        lambda: build_index(sheets, pg_dsn, people_path, core_sheet_id=core_sheet_id)))
    task.add_done_callback(functools.partial(_landed, gen=gen))
    _DESK["task"], _DESK["task_gen"] = task, gen
    return task


def invalidate() -> None:
    """The books just changed (a webhook call was filed): the held index is old now, and so is any build already…"""
    _DESK["at"] = 0.0
    _DESK["gen"] = int(_DESK.get("gen") or 0) + 1
    _NEWS["at"] = time.time()


async def settle(sheets: Any, pg_dsn: str, people_path: str = PEOPLE_PATH, *,
                 core_sheet_id: str = CORE_SHEET_ID, timeout_s: float = 90.0) -> bool:
    """Wait until an index built after the last invalidate() has landed."""
    deadline = time.time() + timeout_s
    while True:
        now = time.time()
        if _DESK["index"] is not None and _DESK["at"] > 0.0:
            return True
        if now >= deadline:
            return False
        task = _DESK["task"]
        if task is None or task.done():
            if quota_hold_left() > 0:
                return False
            if _DESK["failure"] and now - _DESK["failed_at"] < INDEX_RETRY_S:
                return False
            task = _start_build(sheets, pg_dsn, people_path, core_sheet_id)
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=max(0.1, deadline - now))
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - a failed or slow build: nothing landed
            return False


# ═══════════════════════════════════════════════════════════════════════════ The webhook's calls, before the books…
OVERLAY_MAX = 200
OVERLAY_TTL_S = 7200.0
# A call still `filing` this long after its last attempt started is left to the books: the index says `waiting`…
OVERLAY_FILING_TTL_S = 600.0
# What the index says that ends an entry — the books have spoken.
OVERLAY_INDEX_WINS = frozenset({"filed", "blocked", "legacy", "held", "no_words"})
# What the index says that the entry still speaks over.
OVERLAY_INDEX_YIELDS = frozenset({"waiting", "unlogged"})
# THE STATE A SCREEN ALREADY KNOWS, THE STAGE BESIDE IT.
_OVERLAY_STATE = {"filing": "waiting", "filed": "waiting", "blocked": "blocked"}
_OVERLAY: dict[str, dict[str, Any]] = {}


def _overlay_at(value: Any) -> str:
    """The event time to the second, rounded the way a date cell is read back (serial_to_utc), so the row keeps…"""
    when = parse_when(value, "UTC")
    if when is None:
        return ""
    return iso_utc(datetime.fromtimestamp(round(when.timestamp()), timezone.utc))


def _overlay_prune(now: float) -> None:
    for cid in [c for c, e in _OVERLAY.items()
                if now - e["put_at"] > OVERLAY_TTL_S
                or (e["stage"] == "filing" and now - e["stage_at"] > OVERLAY_FILING_TTL_S)]:
        _OVERLAY.pop(cid, None)
    while len(_OVERLAY) > OVERLAY_MAX:
        _OVERLAY.pop(next(iter(_OVERLAY)))


def overlay_put(call_id: str, *, at: Any, duration: Any, dialogue: Any, stage: str = "filing",
                now: float | None = None) -> None:
    """A call the webhook announced: its time, its words and its parties, the last as the legacy receiver writes…"""
    now = time.time() if now is None else now
    turns = _dialogue_turns(dialogue)
    plain, text = _format_dialogue(turns)
    _OVERLAY.pop(call_id, None)
    _OVERLAY[call_id] = {
        "at": _overlay_at(at),
        "duration": _js_round(duration) if _js_truthy(duration) else None,
        "turns_text": text, "plain": plain, "n_turns": len(turns),
        "caller_phones": caller_phones(turns), "team": team_phones(turns),
        "stage": stage, "kinds": None, "items": None, "why": "",
        "stage_at": now, "put_at": now,
    }
    _overlay_prune(now)


def overlay_stage(call_id: str, stage: str, *, kinds: Any = None, items: Any = None,
                  why: str = "", now: float | None = None) -> bool:
    """Move a call's stage; False when the entry is already gone."""
    entry = _OVERLAY.get(call_id)
    if entry is None:
        return False
    entry.update(stage=stage, stage_at=time.time() if now is None else now,
                 kinds=([str(k).strip() for k in kinds if str(k).strip()]
                        if isinstance(kinds, list) else None),
                 items=_int_or_none(items), why=str(why or ""))
    return True


def overlay_drop(call_id: str) -> bool:
    return _OVERLAY.pop(call_id, None) is not None


def _overlay_read(entry: dict[str, Any]) -> dict[str, Any]:
    stage = entry["stage"] if entry["stage"] in _OVERLAY_STATE else "filing"
    # `kinds` is always a list on the wire (older bundles walk it); `items` None beside stage `filed` is the word…
    return {"state": _OVERLAY_STATE[stage], "stage": stage,
            "at": (iso_utc(datetime.fromtimestamp(entry["stage_at"], timezone.utc))
                   if stage != "filing" else ""),
            "kinds": list(entry["kinds"] or []), "items": entry["items"], "via": "",
            "why": entry["why"], "capped": None}


def _overlay_row(call_id: str, entry: dict[str, Any], context: Any, floor: set[str]) -> dict[str, Any]:
    ctx = context if isinstance(context, dict) else {}
    caller = resolve_caller(HOTLINE_LINE, entry["caller_phones"], entry["team"],
                            company=ctx.get("company"), floor=floor, roster=ctx.get("roster"))
    return {"call_id": call_id, "at": entry["at"], "line": HOTLINE_LINE, "line_key": "hotline",
            "direction": "", "duration_sec": entry["duration"], "turns": entry["n_turns"],
            "caller": caller, "summary": None, "hotline": _overlay_read(entry),
            "has_transcript": entry["n_turns"] > 0}


def overlay_apply(calls: list[dict[str, Any]], version: str, context: Any = None,
                  now: float | None = None, *,
                  exclude: Any = ()) -> tuple[list[dict[str, Any]], str]:
    """The index's calls with the webhook's laid over them, and their version."""
    now = time.time() if now is None else now
    _overlay_prune(now)
    if not _OVERLAY:
        return calls, version
    out = list(calls)
    where = {str(c.get("call_id") or ""): i for i, c in enumerate(out)}
    drawn: list[dict[str, Any]] = []
    floor: set[str] | None = None
    for cid, entry in list(_OVERLAY.items()):
        if cid in exclude:
            continue
        i = where.get(cid)
        if i is not None:
            row = out[i]
            if row.get("line_key") != "hotline":
                continue
            state = str((row.get("hotline") or {}).get("state") or "")
            if state in OVERLAY_INDEX_WINS:
                _OVERLAY.pop(cid, None)
                continue
            if state not in OVERLAY_INDEX_YIELDS:
                continue
            row = {**row, "hotline": _overlay_read(entry)}
            out[i] = row
        else:
            if floor is None:
                floor = shared_floor()
            row = _overlay_row(cid, entry, context, floor)
            out.append(row)
        drawn.append(row)
    if not drawn:
        return calls, version
    out.sort(key=lambda r: (r.get("at") or "", r.get("call_id") or ""), reverse=True)
    blob = json.dumps(sorted(drawn, key=lambda r: r["call_id"]), sort_keys=True,
                      separators=(",", ":"), ensure_ascii=False)
    digest = hashlib.sha256(blob.encode("utf-8")).hexdigest()
    return out, hashlib.sha256(f"{version}|{digest}".encode("utf-8")).hexdigest()[:16]


def overlay_detail(call_id: str) -> dict[str, Any] | None:
    """GET /hub-lanes/hotline/call/{id} for a call only the webhook knows yet, in read_call's shape; None when…"""
    _overlay_prune(time.time())
    entry = _OVERLAY.get(call_id)
    if entry is None:
        return None
    line_digits = digits(HOTLINE_LINE)
    counterpart = ""
    for cell in (entry["caller_phones"], entry["team"]):
        counterpart = next((p for p in split_phones(cell) if digits(p) and digits(p) != line_digits), "")
        if counterpart:
            break
    turns = parse_speaker_transcript(entry["turns_text"], HOTLINE_LINE, counterpart)
    return {"call_id": call_id,
            "transcript": {"source": "webhook", "turns": turns,
                           "plain": entry["plain"] or "\n".join(t["text"] for t in turns)},
            "summary": None}


# ═══════════════════════════════════════════════════════════════════════════ Who may open it — App Access by badge…
_APP_LABELS = {"smartcomms": "Smart Comms", "clients": "Client Care"}
# CONTAINMENT: the roles the SPA keeps to their own allow-list (lib/roleAccess RESTRICTED_ROLE_APPS: interviewer…
CONTAINED_ROLES = frozenset({"client", "onboarding", "interviewer"})
# lib/badgeAccess TENANT_BASIC_APPS: a place always operates these, so the tenant matrix never takes them away.
TENANT_BASIC_APPS = frozenset({"myasa", "users", "chat", "suggestions", "teamboard",
                               "calendar", "playground"})
# A live answer from the Core book is held this long: the stale path costs at most one Sheets read a minute however…
CORE_LIVE_TTL_S = 60.0
# A live read that failed is not repeated by every request behind it: nobody reads again until this long after the…
CORE_LIVE_RETRY_S = 15.0
# A gate is a person waiting on a door: the live read gets this long in all.
GATE_READ_BUDGET_S = 10.0
# How long one socket operation of the gate's own services may hang.
GATE_HANG_S = 4.0
# How long a gate check waits on the live read somebody else started before it answers without it.
GATE_WAIT_S = GATE_READ_BUDGET_S + GATE_HANG_S
# The mirror query of a gate check may not outlast the person either.
GATE_PG_OPTIONS = "-c statement_timeout=5000"
# The columns the gate reads from each Core tab — never a password column.
_CORE_TABS: dict[str, tuple[str, ...]] = {
    # client_key: the client an account of the client role is (the relay's own-view door, snapshot_service)
    "users": ("user_id", "role", "types", "active", "app_denials", "home_tenant", "client_key"),
    "app_badge_access": ("app_id", "badges"),
    "app_tenant_access": ("app_id", "tenants"),
}
_CORE_REQUIRED = (("users", "user_id"), ("users", "role"),
                  ("app_badge_access", "app_id"), ("app_badge_access", "badges"))
# sheet_id -> (the live answer, when it was read)
_CORE_LIVE: dict[str, tuple[dict[str, Any], float]] = {}
# sheet_id -> (the sentence a failed read left, when the next read may start)
_CORE_LIVE_FAILED: dict[str, tuple[str, float]] = {}
# sheet_id -> (set when the read in flight lands, whatever it found; when it started)
_CORE_LIVE_FLIGHTS: dict[str, tuple[threading.Event, float]] = {}
_CORE_LIVE_GUARD = threading.Lock()
_GATE_SAID: dict[str, float] = {}


def _say_hourly(key: str, message: str, *args: Any) -> None:
    """A warning said once an hour per fact: enough to notice, not enough to drown."""
    now = time.time()
    if now - _GATE_SAID.get(key, 0.0) >= 3600.0:
        _GATE_SAID[key] = now
        log.warning(message, *args)


def _words(cell: Any) -> list[str]:
    """A badge cell ("ADMIN, MANAGER") as its words, upper-cased."""
    return [b.strip().upper() for b in re.split(r"[,;|\n]+", str(cell if cell is not None else ""))
            if b.strip()]


def _list_cell(cell: Any) -> list[str]:
    """A list written into a cell — JSON text, a real list, or comma separated."""
    if isinstance(cell, list):
        return [str(x).strip() for x in cell if str(x).strip()]
    text = str(cell if cell is not None else "").strip()
    if not text:
        return []
    try:
        got = json.loads(text)
        if isinstance(got, list):
            return [str(x).strip() for x in got if str(x).strip()]
    except ValueError:
        pass
    return [x.strip() for x in re.split(r"[,;|\n]+", text) if x.strip()]


def _core_from_mirror(pg_dsn: str, core_sheet_id: str, uid: str, app_id: str) -> dict[str, Any]:
    """The gate's rows from the Core book's copy in asa-hub-db, with how old they are."""
    users, badges, tenant_access = hub_rows.tabs([{"sheet_id": core_sheet_id, "tab": t} for t in
                                                  ("users", "app_badge_access", "app_tenant_access")])
    uid, app_id = str(uid or ""), str(app_id or "")
    user = next((d for _rn, d in users["rows"] if hub_rows.cell(d.get("user_id")) == uid), None)
    now = time.time()
    # a tab the copy holds no row of vouches for no age, as on the mirror
    ages = [now - t["as_of"] for t in (users, badges)] if users["rows"] and badges["rows"] else []
    rule: list[str] = []
    for _rn, d in badges["rows"]:  # the last row for an app wins, as on the rest of the shelf
        if hub_rows.cell(d.get("app_id")) == app_id:
            rule = _words(d.get("badges"))
    tenants: list[str] = []
    for _rn, d in tenant_access["rows"]:
        if hub_rows.cell(d.get("app_id")) == app_id:
            tenants = _list_cell(d.get("tenants"))
    return {"source": "mirror", "user": dict(user) if user is not None else None,
            "rule": rule, "tenants": tenants, "age_s": max(0.0, max(ages)) if ages else None,
            "sync_ok": users["book_status"].strip().lower() == "ok"}


def gate_sheets_client():
    """A Sheets service for the gate: a socket that hangs gives up after GATE_HANG_S."""
    return sheets_client(timeout=GATE_HANG_S)


def _core_live_read(sheets: Any, sheet_id: str) -> dict[str, Any]:
    """The gate's three Core tabs read from the book itself, only the columns it needs: {users: {user_id: row}…"""
    what = "the access record in the Core book"
    # Only the gate's own services go back on its shelf; any other factory's are dropped.
    shelf = _GATE_SERVICES if sheets is gate_sheets_client else []
    _BUDGET.until = time.time() + GATE_READ_BUDGET_S
    try:
        with _Lent(sheets, shelf) as svc:
            for attempt in range(2):
                got = _execute(lambda: svc.spreadsheets().values().batchGet(
                    spreadsheetId=sheet_id, ranges=[f"'{t}'!1:1" for t in _CORE_TABS],
                    valueRenderOption="FORMATTED_VALUE"), what, hang_s=GATE_HANG_S)
                headers = {tab: [str(c).strip() for c in ((vr.get("values") or [[]])[0])]
                           for tab, vr in zip(_CORE_TABS, got.get("valueRanges") or [])}
                plan = [(tab, key, _col_letter(headers[tab].index(key)))
                        for tab, keys in _CORE_TABS.items() for key in keys
                        if key in (headers.get(tab) or [])]
                planned = {(tab, key) for tab, key, _ in plan}
                if any(need not in planned for need in _CORE_REQUIRED):
                    raise SourceError("The Core book's access tabs have no user_id, role, "
                                      "app_id or badges column.")
                got = _execute(lambda: svc.spreadsheets().values().batchGet(
                    spreadsheetId=sheet_id, ranges=[f"'{t}'!{c}:{c}" for t, _, c in plan],
                    majorDimension="COLUMNS", valueRenderOption="UNFORMATTED_VALUE"),
                    what, hang_s=GATE_HANG_S)
                cols = [((vr.get("values") or [[]])[0]) for vr in (got.get("valueRanges") or [])]
                if len(cols) != len(plan) or any(
                        (str(col[0]).strip() if col else "") != key
                        for (_, key, _), col in zip(plan, cols)):
                    continue
                tables: dict[str, dict[str, list[Any]]] = {tab: {} for tab in _CORE_TABS}
                for (tab, key, _), col in zip(plan, cols):
                    tables[tab][key] = col

                def rows(tab: str) -> list[dict[str, str]]:
                    columns = tables[tab]
                    n = max((len(c) for c in columns.values()), default=0)
                    return [{k: (str(c[i]) if i < len(c) and c[i] is not None else "")
                             for k, c in columns.items()} for i in range(1, n)]

                users: dict[str, dict[str, str]] = {}
                for r in rows("users"):  # the first row for an account, as the mirror query reads
                    u = r.get("user_id", "").strip()
                    if u and u not in users:
                        users[u] = r
                rules: dict[str, list[str]] = {}
                for r in rows("app_badge_access"):  # the last row for an app wins
                    if r.get("app_id", "").strip():
                        rules[r["app_id"].strip()] = _words(r.get("badges"))
                tenants: dict[str, list[str]] = {}
                for r in rows("app_tenant_access"):
                    if r.get("app_id", "").strip():
                        tenants[r["app_id"].strip()] = _list_cell(r.get("tenants"))
                return {"users": users, "rules": rules, "tenants": tenants}
            raise SourceError("The Core book's access columns moved while they were being read.")
    finally:
        _BUDGET.until = None


# The app ids no session but the master's is released (snapshot_service._lane_app_cut).
_APP_CUT: list[Callable[[], Any]] = []


def use_app_cut(reader: Callable[[], Any]) -> None:
    """Hand the gate the reader of the ids it answers as never released for anybody but the master."""
    _APP_CUT[:] = [reader]


def _app_cut() -> frozenset[str]:
    if not _APP_CUT:
        return frozenset()
    try:
        return frozenset(str(x) for x in (_APP_CUT[0]() or ()))
    except Exception:  # noqa: BLE001 - FAIL-OPEN: an unread list cuts nothing
        return frozenset()


# The account ids that see the listed apps too (snapshot_service._lane_app_seen).
_APP_SEEN: list[Callable[[], Any]] = []


def use_app_seen(reader: Callable[[], Any]) -> None:
    """Hand the gate the reader of the accounts the app list does not cut."""
    _APP_SEEN[:] = [reader]


def _app_seen() -> frozenset[str]:
    if not _APP_SEEN:
        return frozenset()
    try:
        return frozenset(str(x) for x in (_APP_SEEN[0]() or ()))
    except Exception:  # noqa: BLE001 - an unread list lets nobody in
        return frozenset()


# When App Control last changed a grant (epoch seconds), kept on disk: App Control is saved through this relay alone,
# so a restart changes no grant, and a copy read before it still vouches. Never seen: 0.
_ACCESS_WRITTEN_FILE = Path(os.getenv("HUB_ACCESS_WRITTEN_FILE") or
                            str(Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) / ".access-written-at"))


def _access_written_kept() -> float:
    try:
        return float(_ACCESS_WRITTEN_FILE.read_text().strip())
    except (OSError, ValueError):
        return 0.0


_ACCESS_WRITTEN_AT = [_access_written_kept()]


def note_access_written() -> None:
    """App Control changed who reaches which app: older copies stop vouching and the live copy is re-read."""
    _ACCESS_WRITTEN_AT[0] = time.time()
    try:
        _ACCESS_WRITTEN_FILE.write_text(f"{_ACCESS_WRITTEN_AT[0]:.3f}")
    except OSError as exc:
        log.warning("access gate: when App Control last changed could not be kept (%s)", type(exc).__name__)
    with _CORE_LIVE_GUARD:
        _CORE_LIVE.clear()


def _core_live(sheets: Any, sheet_id: str, fresh_s: float) -> tuple[dict[str, Any] | None, str]:
    """(the live Core answer, '') or (None, the sentence why there is none)."""
    held: tuple[dict[str, Any], float] | None = None
    why = ""
    waited = False
    while True:
        mine = False
        with _CORE_LIVE_GUARD:
            now = time.time()
            held = _CORE_LIVE.get(sheet_id)
            if held and now - held[1] < CORE_LIVE_TTL_S:
                return held[0], ""
            flight = _CORE_LIVE_FLIGHTS.get(sheet_id)
            failed = _CORE_LIVE_FAILED.get(sheet_id)
            if flight is not None:
                why = "The live check of the access record is still running."
            elif failed and now < failed[1]:
                why = failed[0]
            elif quota_hold_left() > 0:
                why = quota_hold_sentence("the access record in the Core book")
            else:
                flight = (threading.Event(), now)
                _CORE_LIVE_FLIGHTS[sheet_id] = flight
                mine = True
        if mine:
            try:
                view = _core_live_read(sheets, sheet_id)
            except Exception as exc:  # noqa: BLE001
                why = (str(exc) if isinstance(exc, SourceError)
                       else f"The Core book could not be read ({type(exc).__name__}).")
                with _CORE_LIVE_GUARD:
                    _CORE_LIVE_FAILED[sheet_id] = (why, time.time() + CORE_LIVE_RETRY_S)
            else:
                with _CORE_LIVE_GUARD:
                    _CORE_LIVE[sheet_id] = (view, time.time())
                    _CORE_LIVE_FAILED.pop(sheet_id, None)
                return view, ""
            finally:
                with _CORE_LIVE_GUARD:
                    _CORE_LIVE_FLIGHTS.pop(sheet_id, None)
                flight[0].set()
            break
        if flight is not None and not waited:
            waited = True
            flight[0].wait(max(0.0, flight[1] + GATE_WAIT_S - time.time()))
            continue
        break
    now = time.time()
    if held and now - held[1] < fresh_s:
        _say_hourly(f"live-held:{sheet_id}",
                    "access gate: no fresh live Core answer (%s); the answer read %.0fs ago "
                    "still vouches", why or "unknown", now - held[1])
        return held[0], ""
    return None, why or "The Core book could not be read."


def app_access(pg_dsn: str, core_sheet_id: str, uid: str, role: str,
               app_id: str = APP_ID, fresh_s: float = 7200.0, *,
               is_master: bool | None = None, sheets: Any = None,
               refuse_roles: tuple[str, ...] | list[str] | frozenset[str] = (),
               app_label: str = "") -> dict[str, Any]:
    """{open, reason, why, via} — lib/badgeAccess.ts badgeAllowsApp plus the containment lib/audience and…"""
    label = app_label or _APP_LABELS.get(app_id) or app_id

    def closed(reason: str, why: str) -> dict[str, Any]:
        return {"open": False, "reason": reason, "why": why, "via": ""}

    def opened(via: str, why: str) -> dict[str, Any]:
        return {"open": True, "reason": "", "why": why, "via": via}

    session_role = str(role or "").strip().lower()
    refused = {str(r).strip().lower() for r in refuse_roles if str(r).strip()}
    if not uid and not session_role:
        return closed("session", "This session carries no account.")
    if session_role in refused:
        return closed("restricted", f"{label} is not served to the {session_role} role here.")
    if is_master is True:
        return opened("master", "the master's view is never narrowed")
    if not str(uid or "").strip():
        return closed("session", "This session carries no account id, so the door stays closed.")
    # Settings > My Work's app list: answered as an app with no row, before the admin floor can open it
    if app_id in _app_cut() and str(uid).strip() not in _app_seen():
        return closed("badge", f"No badge is written for {label} in App Access, so it is the master's alone.")

    mirror: dict[str, Any] | None = None
    mirror_error = ""
    try:
        mirror = _core_from_mirror(pg_dsn, core_sheet_id, uid, app_id)
    except Exception as exc:  # noqa: BLE001
        mirror_error = f"The access record could not be read ({type(exc).__name__})."

    def narrowed(user: dict[str, Any] | None) -> dict[str, Any] | None:
        if user is None:
            return None
        if str(user.get("active") or "").strip().lower() == "false":
            return closed("restricted", "This account is not active.")
        if app_id in _list_cell(user.get("app_denials")):
            return closed("badge", f"{label} was removed from this account in App Access.")
        account_role = str(user.get("role") or "").strip().lower()
        if account_role in refused:
            return closed("restricted", f"{label} is not served to the {account_role} role here.")
        return None

    if mirror is not None:
        hit = narrowed(mirror["user"])
        if hit:
            return hit

    live: dict[str, Any] | None = None
    live_error = ""

    def live_view() -> dict[str, Any] | None:
        nonlocal live, live_error
        if live is None and not live_error:
            got, live_error = _core_live(sheets or gate_sheets_client, core_sheet_id, fresh_s)
            if got is not None:
                live = {"source": "live", "user": got["users"].get(str(uid or "")),
                        "rule": got["rules"].get(app_id, []),
                        "tenants": got["tenants"].get(app_id, [])}
        return live

    if session_role == "admin" and is_master is None:
        # The floor honours an inactive flag and a denial, so it needs the account's own row: the mirror's (already…
        if mirror is None or mirror["user"] is None:
            if live_view() is None:
                return closed("unreadable", " ".join(x for x in (
                    mirror_error or "This account is not in the access copy yet.",
                    f"The live check could not be made: {live_error}", "So the door stays closed.")
                    if x))
            if live["user"] is None:  # type: ignore[index]
                return closed("session", "This account is not in the access record, so the door "
                              "stays closed.")
            hit = narrowed(live["user"])  # type: ignore[index]
            if hit:
                return hit
        _say_hourly(f"floor:{uid}", "access gate: the admin floor opened %s for %s — the relay "
                    "has not seen this session's master flag since it started", label, uid)
        return opened("admin_floor", "the admin floor, standing in for a master flag not yet seen")

    mirror_vouches = (mirror is not None and mirror["user"] is not None and mirror["sync_ok"]
                      and mirror["age_s"] is not None and mirror["age_s"] <= fresh_s
                      # a copy read before App Control's last change cannot vouch for it
                      and time.time() - mirror["age_s"] >= _ACCESS_WRITTEN_AT[0])
    view = mirror if mirror_vouches else None
    if view is None:
        if mirror is not None and mirror["user"] is not None:
            _say_hourly(f"stale:{core_sheet_id}",
                        "access gate: the Core mirror cannot vouch for a grant (%s, last sync %s) "
                        "— grants are checked live against the Core book",
                        "no ingest stamp" if mirror["age_s"] is None
                        else f"{mirror['age_s']:.0f}s old against {fresh_s:.0f}s",
                        "ok" if mirror["sync_ok"] else "not ok")
        view = live_view()
        if view is None:
            if mirror is None:
                return closed("unreadable", f"{mirror_error} {live_error} So the door stays closed.")
            if mirror["user"] is None:
                return closed("unreadable", "This account is not in the access copy yet, and the "
                              f"live check could not be made: {live_error} So the door stays closed.")
            return closed("stale", "The access record is too old to vouch for a grant, and the "
                          f"live check could not be made: {live_error} So the door stays closed.")
        hit = narrowed(view["user"])
        if hit:
            return hit

    user = view["user"]
    if user is None:
        return closed("session", "This account is not in the access record, so the door stays closed.")
    rule = list(view["rule"] or [])
    account_role = str(user.get("role") or "").strip().lower()
    for word in sorted({session_role, account_role} & CONTAINED_ROLES):
        if word.upper() not in rule:
            return closed("restricted", f"{label} is not open to {word} accounts unless App Access "
                          "names that role.")
    home = str(user.get("home_tenant") or "").strip()
    tenants = list(view["tenants"] or [])
    if home and tenants and app_id not in TENANT_BASIC_APPS and home not in tenants:
        return closed("restricted", f"{label} is not installed for this account's home tenant.")
    if not rule:
        return closed("badge", f"No badge is written for {label} in App Access, so it is the "
                      "master's alone.")
    worn = set(_words(user.get("types")))
    for word in (session_role, account_role):
        if word:
            worn.add(word.upper())
    # and whatever a worn badge currently stands in for: the App Access rows this is compared against were written…
    worn = badge_follows.with_followed(worn)
    if worn & set(rule):
        return opened(view["source"], "badge")
    return closed("badge", f"{label} is not open to this account's badges.")


if __name__ == "__main__":  # a read-only probe: counts, states and health — never words or numbers
    import sys
    from collections import Counter

    logging.basicConfig(level=logging.INFO)
    _dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not _dsn:
        sys.exit("HUB_SNAPSHOT_PG_DSN is not set")
    built = build_index(sheets_client, _dsn, PEOPLE_PATH)
    p = built["payload"]
    print(json.dumps({
        "counts": built["counts"], "timings_ms": built["timings"], "sources": p["sources"],
        "hotline_states": Counter((r["hotline"] or {}).get("state") for r in p["calls"]
                                  if r["line_key"] == "hotline"),
        "hotline_last_logged_at": p["hotline_last_logged_at"], "version": p["version"],
    }, indent=2, default=str))
