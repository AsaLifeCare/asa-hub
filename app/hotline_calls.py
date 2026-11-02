"""The hotline desk's call index and the webhook's calls (the relay's server/hotline_desk.py), answered here: every desk
call newest first with each source's health beside it, one call's words and summary, and the calls the hotline webhook
took that the books do not show yet. Every book is read off asa-hub-db's copy with Python's kept edits laid
(app/hotline_desk.py read_copy), never off Google; a call's words come from the same copy. The webhook's calls are
kept in this process as app/hotline_fast.py takes and files them, and taken up again after a restart from
app.hotline_calls, where each one is kept."""
from __future__ import annotations

import asyncio
import functools
import hashlib
import json
import logging
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import gsjs
import hotline_desk as HD
import hub_rows

log = logging.getLogger("asa-hub-app.hotline")

# ── the two desk lines ──────────────────────────────────────────────────────────────────────────────────────────────
HOTLINE_LINE = "+13309195558"
# the 5558's own Quo number id, as an event's deepLink names it (/inbox/<id>/)
HOTLINE_LINE_ID = "PNPqYnvZUD"
SCREENING_LINE = "+13307544040"
LINES = [
    {"line": HOTLINE_LINE, "key": "hotline", "label": "Employee Support Hotline"},
    {"line": SCREENING_LINE, "key": "screening", "label": "Phone Screening"},
]

# ── the books, named in full ─────────────────────────────────────────────────────────────────────────────────────────
TRANSCRIPTS = HD.Book("transcripts", os.getenv("HUB_HOTLINE_TRANSCRIPTS_SHEET_ID")
                      or "1nkYZ24EtG4woyIShMKouj1kWdQD2IGpjUkWEamZHMno",
                      "Transcripts", "the transcript inbox (New Transcripts)")
CALLS_HOUSE = HD.Book("calls_house", os.getenv("HUB_HOTLINE_CALLS_HOUSE_SHEET_ID")
                      or "1bLSxXOzmNS8gURKpDP9cnhPzk2qquPNqUS7CGd0og50",
                      "Data", "the calls house (ASA Data — Calls)")
RECAPS = HD.Book("recaps", os.getenv("HUB_HOTLINE_RECAPS_SHEET_ID")
                 or "1QvwIN5zYNL17hPwIV4DSkdIhKQJa89qTlYBIl86asuI",
                 "Data", "the summaries house (ASA Data — Recaps)")
HOTLINE_LOG = HD.Book("hotline_log", os.getenv("HUB_HOTLINE_LOG_SHEET_ID")
                      or "1nbdJ-jOrFsf3eyzY9uAaQ9RPnIcJ8Gwmymt9JFsZFjg",
                      "Data", "the hotline processing log")
LINES_TABLE = os.getenv("HUB_LINES_TABLE", "app.asa_openphone_lines")
PEOPLE_PATH = os.getenv("HUB_HOTLINE_PEOPLE", str(Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) / "people.json"))
CORE_SHEET_ID = os.getenv("HUB_DB_SHEET_ID", "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg")
HOTLINE_CONFIG_SHEET_ID = (os.getenv("HUB_HOTLINE_CONFIG_SHEET_ID")
                           or "1XTaqJDks2zk0PqkXDotxcCrDCZQjG1g3hG8fMJBDx8M")
INDEX_MAX_AGE_S = float(os.getenv("HUB_HOTLINE_INDEX_MAX_AGE", "45"))
INDEX_RETRY_S = 10.0
# Hotline.gs HOTLINE_MAX_AGE_DAYS: a call older than this is never opened by the sweep
HOTLINE_MAX_AGE_DAYS = 14
# the sweep writes "+N capped" beside the kinds when a call carried more note rows than one call may file
CAPPED_MARK = re.compile(r"^\+\d+\s+capped$", re.I)

# the columns each book is asked for: key → the header text, exactly
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
# `caller` is left out: the log's phone column is not the screen's business
L_FIELDS = {"call_id": "call_id", "at": "at", "items": "items", "kinds": "kinds",
            "status": "status", "via": "via"}
# the words, refused in every index read
_WORDS = frozenset(A_WORDS.values()) | frozenset(B_WORDS.values())
# the shared-line floor (Talent.gs SHARED_LINE_DIGITS), unioned with the file when it is on disk
DECLARED_SHARED_FLOOR = ("3307544040", "3309195558", "3309195559", "3330919558")
TALENT_GS = Path(os.getenv("HUB_TALENT_GS") or "/srv/apps-script/Talent.gs")


class IndexUnavailable(RuntimeError):
    """The index could not be built at all. The message is a sentence for a person."""


class CallNotFound(KeyError):
    """The call id is not in the index."""


SourceError = HD.SourceError
parse_when = gsjs.parse_when
iso_utc = HD.iso_utc
_int_or_none = HD._int_or_none


# ── phones and lines ─────────────────────────────────────────────────────────────────────────────────────────────────

def digits(value: Any) -> str:
    """The last ten digits, the key every reader of a number on this platform computes."""
    d = re.sub(r"\D+", "", str(value if value is not None else ""))
    if len(d) >= 11 and d.startswith("1"):
        d = d[1:]
    d = d[-10:]
    return d if len(d) == 10 else ""


def e164(value: Any) -> str:
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
    return [p.strip() for p in re.split(r"[,;|/\n]+", str(cell if cell is not None else "")) if p.strip()]


def is_provider_id(value: Any) -> bool:
    return bool(re.fullmatch(r"PN[A-Za-z0-9]{6,}", str(value if value is not None else "").strip()))


def shared_floor() -> set[str]:
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
    """Which desk line a call belongs to: HOTLINE_LINE, SCREENING_LINE or ''."""
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


def resolve_caller(line: str, participants: Any, team: Any, *, company: dict[str, str] | None, floor: set[str],
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
    out = {"phone": e164(phone_raw) if d else "", "kind": "unknown", "line_name": "", "who": "unknown", "name": ""}
    if not d:
        return out
    if d in floor or (company is not None and d in company):
        out.update(kind="company_line", who="shared", line_name=(company or {}).get(d, ""))
        return out
    if company is None:
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


# ── the hotline's verdict on one call, read from what the sweep wrote down ───────────────────────────────────────────

def hotline_state(log_rows: list[dict], processed: Any, processed_at: Any, has_words: bool, at: datetime | None, *,
                  now: datetime, tz_name: str | None, log_zone: str | None = "UTC", log_fresh: bool = True,
                  max_age_days: int = HOTLINE_MAX_AGE_DAYS, log_why: str = "") -> dict[str, Any]:
    def rank(r: dict) -> tuple[float, int]:
        dt = parse_when(r.get("at"), log_zone)
        return (dt.timestamp() if dt else 0.0, int(r.get("_row") or 0))

    def of(status: str) -> list[dict]:
        return sorted((r for r in log_rows if str(r.get("status") or "").strip().lower() == status), key=rank,
                      reverse=True)

    filed, blocked = of("processed"), of("blocked")
    if filed:
        r = filed[0]
        tokens = [k.strip() for k in str(r.get("kinds") or "").split(",") if k.strip()]
        capped = [int(re.sub(r"\D", "", t) or 0) for t in tokens if CAPPED_MARK.match(t)]
        return {"state": "filed", "at": iso_utc(parse_when(r.get("at"), log_zone)),
                "kinds": [t for t in tokens if not CAPPED_MARK.match(t)], "items": _int_or_none(r.get("items")),
                "via": str(r.get("via") or "").strip(), "why": "", "capped": sum(capped) if capped else None}
    base = {"at": "", "kinds": [], "items": None, "via": "", "why": "", "capped": None}
    refusal = str(blocked[0].get("via") or "").strip() if blocked else ""
    young = at is None or now - at <= timedelta(days=max_age_days)
    if str(processed if processed is not None else "").strip():
        if not log_fresh and young:
            return {**base, "state": "unlogged", "via": refusal,
                    "why": log_why or ("The processing log could not be read just now, so what the hotline read "
                                       "filed from this call is not known.")}
        return {**base, "state": "legacy", "at": iso_utc(parse_when(processed_at, tz_name)), "via": refusal,
                "why": ("The hotline read was refused on this call, and the Processed cell was filled elsewhere "
                        "afterwards.") if blocked else ""}
    if blocked:
        r = blocked[0]
        return {"state": "blocked", "at": iso_utc(parse_when(r.get("at"), log_zone)), "kinds": [],
                "items": _int_or_none(r.get("items")), "via": refusal,
                "why": ("The model would not answer: " + refusal) if refusal else "The model would not answer."}
    if not has_words:
        return {**base, "state": "no_words"}
    if not young:
        return {**base, "state": "held", "why": f"Older than the sweep's {max_age_days} days, so it is never opened."}
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
            role = "agent" if sd and sd == line_digits else "caller" if sd and sd == caller_digits else "other"
            turns.append({"at": m.group(1), "speaker": speaker, "role": role, "text": m.group(3).strip()})
            continue
        piece = raw.strip()
        if not piece:
            continue
        if turns:
            turns[-1]["text"] = (turns[-1]["text"] + "\n" + piece).strip()
        else:
            turns.append({"at": "", "speaker": "", "role": "other", "text": piece})
    return turns if any(t["at"] for t in turns) else []


# ── a webhook dialogue, written the way the legacy receiver wrote it ────────────────────────────────────────────────

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
    """Math.round: a half goes up. None stands for NaN."""
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
    """extractExternalParticipants: identifiers that spoke without a userId."""
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


def is_hotline(dialogue: Any, line: str = HOTLINE_LINE) -> bool:
    """hotlineTeamMatch_ over the team the dialogue names."""
    want = re.sub(r"[^0-9]", "", line)
    return bool(want) and any(re.sub(r"[^0-9]", "", p) == want for p in re.split(r"[,;|/]+", team_phones(dialogue)))


def link_names_another_line(deep_link: Any, line_id: str = HOTLINE_LINE_ID) -> bool:
    """Does the event's deepLink open another number's inbox?"""
    link = deep_link if isinstance(deep_link, str) else ""
    return "/inbox/PN" in link and f"/inbox/{line_id}/" not in link


# ── the sources ──────────────────────────────────────────────────────────────────────────────────────────────────────

def _read_directory() -> tuple[tuple[dict[str, str], dict[str, str]], int]:
    """((digits → OpenPhone name, provider id → digits), rows) from the company lines kept in asa-hub-db
    (app/company_lines.py)."""
    import lanes_db  # noqa: PLC0415

    try:
        with lanes_db.connect() as conn, conn.cursor() as cur:
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


_NOT_STAFF_ROLES = frozenset({"client", "onboarding", "interviewer"})


def _phone_entries(cell: Any) -> list[Any]:
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


def _read_roster(people_path: str = PEOPLE_PATH, core_sheet_id: str = CORE_SHEET_ID
                 ) -> tuple[dict[str, dict[str, str]], int]:
    """digits → {name key → display name}, as the contact guard builds its index (staffContactIndex_)."""
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
        raise SourceError(f"The staff accounts could not be read ({type(exc).__name__}), so no caller is named.") \
            from exc
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


_CONFIG_SAID: dict[str, str] = {}


def _read_config() -> tuple[dict[str, Any], int]:
    """{max_age_days} from the hotline_config house (key/value rows, its own table once kept there), the sweep's
    shipped default beside it."""
    import house_tables as HT  # noqa: PLC0415 - the app's readers, only for this house
    import hubdb  # noqa: PLC0415
    import locations as L  # noqa: PLC0415

    try:
        got = HT.rows(L.Reads(hubdb.shared(), None), "hotline_config") if HT.tabled("hotline_config") else \
            hub_rows.rows(HOTLINE_CONFIG_SHEET_ID, "Data")
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
        log.warning("hotline desk: hotline_config points the sweep at another team line; the desk still reads %s as "
                    "the hotline", HOTLINE_LINE)
    return {"max_age_days": days}, len(got)


def book_zone(book: HD.Book) -> str:
    """The zone a book's date text is shown on: what a live read of it learned, else the declared one, else UTC."""
    return HD.learned_zone(book.key, book.sheet_id) or gsjs.DECLARED_ZONES.get(book.sheet_id) or "UTC"


def _book_read(book: HD.Book, fields: dict[str, str]) -> Callable[[], tuple[Any, ...]]:
    return lambda: HD.read_copy(book, fields, zone=book_zone(book), refuse=_WORDS)


def _log_in_step(log_val: dict[str, Any] | None, a_val: dict[str, Any] | None) -> bool:
    """Is the log's copy at least as new as inbox A's?"""
    log_as_of = float((log_val or {}).get("as_of") or 0.0)
    log_until = float((log_val or {}).get("until") or log_as_of)
    a_as_of = float((a_val or {}).get("as_of") or 0.0)
    a_until = float((a_val or {}).get("until") or a_as_of)
    if not log_as_of or not a_as_of:
        return True
    return log_as_of >= a_until or (log_as_of == a_as_of and log_until >= a_until)


# ── the index ────────────────────────────────────────────────────────────────────────────────────────────────────────

def _merge_inboxes(a_rows: list[dict] | None, b_rows: list[dict] | None, a_zone: str,
                   b_zone: str) -> dict[str, dict[str, Any]]:
    """One entry per call id: A's fields where A filled them, B's in the blanks."""
    calls: dict[str, dict[str, Any]] = {}
    text_zone = a_zone

    def take(rows: list[dict] | None, which: str, zone: str) -> None:
        for r in rows or []:
            cid = str(r.get("call_id") or "").strip()
            if not cid:
                continue
            entry = calls.setdefault(cid, {"a": [], "b": [], "at": None, "duration": None, "turns": None, "quo": "",
                                           "participants": "", "team": "", "direction": "", "processed": "",
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


def build_index(people_path: str = PEOPLE_PATH, *, now: datetime | None = None,
                core_sheet_id: str = CORE_SHEET_ID) -> dict[str, Any]:
    """Every desk call, newest first: the payload of GET /hub-lanes/hotline/calls and what one call's read needs."""
    t0 = time.time()
    now = now or datetime.now(timezone.utc)
    jobs: dict[str, Callable[[], tuple[Any, ...]]] = {
        "transcripts": _book_read(TRANSCRIPTS, A_FIELDS),
        "hotline_log": _book_read(HOTLINE_LOG, L_FIELDS),
        "calls_house": _book_read(CALLS_HOUSE, B_FIELDS),
        "recaps": _book_read(RECAPS, R_FIELDS),
        "roster": lambda: _read_roster(people_path, core_sheet_id),
        "lines": _read_directory,
        "config": _read_config,
    }
    results = {k: HD._serve(k, fn) for k, fn in jobs.items()}  # noqa: SLF001
    a_val, b_val = results["transcripts"][0], results["calls_house"][0]
    for need in ("transcripts", "hotline_log"):
        if results[need][0] is None:
            raise IndexUnavailable(results[need][1]["error"] + " What happened to each call cannot be said without "
                                                                "it, and no earlier copy exists yet.")
    a_zone = (a_val or {}).get("zone") or book_zone(TRANSCRIPTS)
    b_zone = (b_val or {}).get("zone") or book_zone(CALLS_HOUSE)
    merged = _merge_inboxes((a_val or {}).get("rows"), (b_val or {}).get("rows"), a_zone, b_zone)
    directory = results["lines"][0]
    company = directory[0] if directory else None
    provider_ids = directory[1] if directory else {}
    roster = results["roster"][0]
    floor = shared_floor()
    log_fresh = bool(results["hotline_log"][1]["ok"])
    log_why = ""
    if log_fresh and not _log_in_step(results["hotline_log"][0], a_val):
        log_fresh = False
        log_why = ("The processing log's copy is older than the inbox's, so what the hotline read filed from this "
                   "call is not known yet.")
    max_age_days = int((results["config"][0] or {}).get("max_age_days") or HOTLINE_MAX_AGE_DAYS)
    log_val = results["hotline_log"][0] or {}
    log_zone = log_val.get("zone") or "UTC"
    log_by_call: dict[str, list[dict]] = {}
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
        caller = resolve_caller(line, c["participants"], c["team"], company=company, floor=floor, roster=roster)
        has_words = bool(c["turns"] and c["turns"] > 0)
        direction = c["direction"].lower() if c["direction"].lower() in ("incoming", "outgoing") else ""
        calls.append({
            "call_id": cid, "at": iso_utc(c["at"]), "line": line, "line_key": key, "direction": direction,
            "duration_sec": c["duration"], "turns": c["turns"], "caller": caller,
            "summary": recaps[cid][1] if cid in recaps else None,
            "hotline": (hotline_state(log_by_call.get(cid, []), c["processed"], c["processed_at"], has_words, c["at"],
                                      now=now, tz_name=a_zone, log_zone=log_zone, log_fresh=log_fresh,
                                      max_age_days=max_age_days, log_why=log_why) if key == "hotline" else None),
            "has_transcript": has_words,
        })
        where[cid] = {"a": c["a"], "b": c["b"], "line": line, "caller_phone": caller["phone"]}
    calls.sort(key=lambda r: (r["at"] or "", r["call_id"]), reverse=True)
    sources = {k: dict(results[k][1]) for k in ("transcripts", "calls_house", "recaps", "hotline_log", "roster")}
    lines_health = results["lines"][1]
    if company is None:
        sources["roster"]["ok"] = False
        sources["roster"]["error"] = " ".join(x for x in (
            sources["roster"]["error"], lines_health["error"],
            "No caller is named until the company lines can be read.") if x)
    elif not lines_health["ok"]:
        sources["roster"]["error"] = " ".join(x for x in (sources["roster"]["error"], lines_health["error"]) if x)
    health = {k: {"ok": bool(v.get("ok")), "error": str(v.get("error") or "")} for k, v in sources.items()}

    def version_of(drawn: list[dict[str, Any]], **marks: Any) -> str:
        blob = json.dumps({"calls": drawn, "sources": health, "hotline_last_logged_at": iso_utc(newest_logged),
                           **marks}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]

    payload = {"built_at": iso_utc(datetime.now(timezone.utc)), "version": version_of(calls),
               "lines": [dict(x) for x in LINES], "sources": sources,
               "hotline_last_logged_at": iso_utc(newest_logged), "calls": calls}
    timings = {k: round(v[2]) for k, v in results.items()}
    timings["total"] = round((time.time() - t0) * 1000)
    counts = {"hotline": sum(1 for r in calls if r["line_key"] == "hotline"),
              "screening": sum(1 for r in calls if r["line_key"] == "screening"), "not_on_a_desk_line": unplaced}
    log.info("hotline desk index: %d hotline + %d screening calls, %d not on a desk line, sources %s, %d ms",
             counts["hotline"], counts["screening"], unplaced,
             ",".join(f"{k}={'ok' if v['ok'] else 'FAILED'}" for k, v in sources.items()), timings["total"])
    return {"payload": payload, "where": where, "timings": timings, "counts": counts,
            "version_without_screening": version_of([c for c in calls if c["line_key"] != "screening"],
                                                    screening_withheld=True),
            "context": {"company": company, "roster": roster},
            "zones": {"transcripts": a_zone, "calls_house": b_zone, "recaps": r_zone, "hotline_log": log_zone}}


# ── one call's words, off the same copy ──────────────────────────────────────────────────────────────────────────────

def _row_words(book: HD.Book, words: dict[str, str], id_header: str, rows: list[int],
               call_id: str) -> list[tuple[str, str]]:
    """(full, speaker) for the given rows of one call, each row checked against its own call id cell, and found by
    its id again when the copy moved."""
    copy = HD.read_tab(book.sheet_id, book.tab)
    if not copy.vouch.has:
        raise SourceError(f"{HD._sentence(book.label)} could not be read: {copy.vouch.why}.")  # noqa: SLF001
    need = [id_header, words["full"], words["speaker"]]
    missing = [h for h in need if h not in copy.headers]
    if missing:
        raise SourceError(f"{HD._sentence(book.label)} has no {', '.join(repr(m) for m in missing)} column.")  # noqa: SLF001

    def text(d: dict, h: str) -> str:
        v = hub_rows.cell(d.get(h))
        return "" if v is None else str(v)

    wanted = set(rows)
    found = [(text(d, words["full"]), text(d, words["speaker"])) for rn, d in copy.rows
             if rn in wanted and text(d, id_header).strip() == call_id]
    if found and len(found) == len(wanted):
        return found
    return [(text(d, words["full"]), text(d, words["speaker"])) for _rn, d in copy.rows
            if text(d, id_header).strip() == call_id]


def read_call(index: dict[str, Any], call_id: str) -> dict[str, Any]:
    """GET /hub-lanes/hotline/call/{call_id}: the words of one call and its summary."""
    where = (index.get("where") or {}).get(call_id)
    if where is None:
        raise CallNotFound(call_id)
    failures: list[str] = []
    fallback: dict[str, Any] | None = None
    for source, book, words, id_header, rows in (
            ("transcripts", TRANSCRIPTS, A_WORDS, A_FIELDS["call_id"], where.get("a") or []),
            ("calls_house", CALLS_HOUSE, B_WORDS, B_FIELDS["call_id"], where.get("b") or [])):
        if not rows:
            continue
        try:
            copies = _row_words(book, words, id_header, rows, call_id)
        except SourceError as exc:
            failures.append(str(exc))
            continue
        except Exception as exc:  # noqa: BLE001 - one book that will not answer leaves the other
            failures.append(f"{HD._sentence(book.label)} could not be read ({type(exc).__name__}).")  # noqa: SLF001
            continue
        for full, speaker in copies:
            full_text, speaker_text = _cell_text(full), _cell_text(speaker)
            turns = parse_speaker_transcript(speaker_text, where["line"], where["caller_phone"])
            if turns:
                plain = full_text or "\n".join(t["text"] for t in turns)
                return {"call_id": call_id, "transcript": {"source": source, "turns": turns, "plain": plain},
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
            return {"text": s["text"], "next_steps": list(s["next_steps"]), "source": "recaps"} if s else None
    return None


# ── the index held in this process: at most one build at a time ─────────────────────────────────────────────────────

_DESK: dict[str, Any] = {"index": None, "at": 0.0, "task": None, "failed_at": 0.0, "failure": "", "gen": 0}


def _landed(task: "asyncio.Future", gen: int | None = None) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is None:
        # a build started before an invalidate read the books before the news: it answers as the held copy
        fresh = gen is None or gen == _DESK["gen"]
        _DESK["index"], _DESK["at"], _DESK["failure"] = task.result(), time.time() if fresh else 0.0, ""
        return
    _DESK["failed_at"] = time.time()
    _DESK["failure"] = (str(exc) if isinstance(exc, IndexUnavailable)
                        else f"The call index could not be built ({type(exc).__name__}).")
    log.warning("hotline desk index build failed: %s", _DESK["failure"])


def _start_build(people_path: str, core_sheet_id: str) -> "asyncio.Future":
    gen = _DESK["gen"]
    task = asyncio.ensure_future(HD.run_on_desk(lambda: build_index(people_path, core_sheet_id=core_sheet_id)))
    task.add_done_callback(functools.partial(_landed, gen=gen))
    _DESK["task"] = task
    return task


async def current_index(people_path: str = PEOPLE_PATH, max_age_s: float = INDEX_MAX_AGE_S, *,
                        core_sheet_id: str = CORE_SHEET_ID) -> dict[str, Any]:
    """The index, rebuilt when older than `max_age_s`; a held one answers while a slow build runs."""
    now = time.time()
    held = _DESK["index"]
    if held is not None and now - _DESK["at"] < max_age_s:
        return held
    task = _DESK["task"]
    if task is None or task.done():
        if held is None and _DESK["failure"] and now - _DESK["failed_at"] < INDEX_RETRY_S:
            raise IndexUnavailable(_DESK["failure"])
        task = _start_build(people_path, core_sheet_id)
    if held is not None:
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=HD.HELD_WAIT_S)
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


def invalidate() -> None:
    """The books just changed (a call was filed): the held index is old now, and so is any build already running."""
    _DESK["at"] = 0.0
    _DESK["gen"] = int(_DESK.get("gen") or 0) + 1


# ── the webhook's calls, before the books show them ─────────────────────────────────────────────────────────────────

OVERLAY_MAX = 200
OVERLAY_TTL_S = 7200.0
# a call still `filing` this long after its last attempt started is left to the books
OVERLAY_FILING_TTL_S = 600.0
# what the index says that ends an entry — the books have spoken
OVERLAY_INDEX_WINS = frozenset({"filed", "blocked", "legacy", "held", "no_words"})
# what the index says that the entry still speaks over
OVERLAY_INDEX_YIELDS = frozenset({"waiting", "unlogged"})
_OVERLAY_STATE = {"filing": "waiting", "filed": "waiting", "blocked": "blocked"}
_OVERLAY: dict[str, dict[str, Any]] = {}
_TAKEN_UP = [False]
CALLS_TABLE = "app.hotline_calls"


def _overlay_at(value: Any) -> str:
    """The event time to the second, rounded the way a date cell is read back."""
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


def _entry(at: Any, duration: Any, dialogue: Any, stage: str, now: float, put_at: float | None = None
           ) -> dict[str, Any]:
    turns = _dialogue_turns(dialogue)
    plain, text = _format_dialogue(turns)
    return {"at": _overlay_at(at), "duration": _js_round(duration) if _js_truthy(duration) else None,
            "turns_text": text, "plain": plain, "n_turns": len(turns), "caller_phones": caller_phones(turns),
            "team": team_phones(turns), "stage": stage, "kinds": None, "items": None, "why": "", "stage_at": now,
            "put_at": now if put_at is None else put_at}


def overlay_put(call_id: str, *, at: Any, duration: Any, dialogue: Any, stage: str = "filing",
                now: float | None = None) -> None:
    """A call the webhook announced: its time, its words and its parties."""
    now = time.time() if now is None else now
    _OVERLAY.pop(call_id, None)
    _OVERLAY[call_id] = _entry(at, duration, dialogue, stage, now)
    _overlay_prune(now)


def overlay_stage(call_id: str, stage: str, *, kinds: Any = None, items: Any = None, why: str = "",
                  now: float | None = None) -> bool:
    """Move a call's stage; False when the entry is already gone."""
    entry = _OVERLAY.get(call_id)
    if entry is None:
        return False
    entry.update(stage=stage, stage_at=time.time() if now is None else now,
                 kinds=[str(k).strip() for k in kinds if str(k).strip()] if isinstance(kinds, list) else None,
                 items=_int_or_none(items), why=str(why or ""))
    return True


def overlay_drop(call_id: str) -> bool:
    return _OVERLAY.pop(call_id, None) is not None


def _kept_stage(filed_at: Any, filing: Any) -> tuple[str, Any, Any, str]:
    """(stage, kinds, items, why) of a kept call, as its filing says."""
    f = filing if isinstance(filing, dict) else {}
    state = str(f.get("state") or "")
    if filed_at is None:
        if state == "retrying":
            return "blocked", None, None, "The model would not answer: " + str(f.get("why") or "")
        return "filing", None, None, ""
    if state == "blocked":
        return "blocked", None, None, "The model would not answer: " + str(f.get("why") or "")
    if state == "nothing_to_file":
        return "filed", [], 0, ""
    if state == "filed":
        return "filed", f.get("kinds"), f.get("items"), ""
    return "filed", None, None, ""


def take_up(rows: list[tuple] | None = None, now: float | None = None) -> int:
    """Blocking: the webhook's calls of the last OVERLAY_TTL_S, as app.hotline_calls keeps them, laid back after a
    restart (a call the inbox pass kept carries no spoken turns and is the books' already). Once per process."""
    if _TAKEN_UP[0]:
        return 0
    now = time.time() if now is None else now
    if rows is None:
        import hubdb  # noqa: PLC0415

        rows = hubdb.shared().query(
            f"select call_id, event_at, duration, dialogue, extract(epoch from received_at), filed_at, filing "
            f"from {CALLS_TABLE} where received_at > now() - make_interval(secs => %s) order by received_at",
            (OVERLAY_TTL_S,))
    _TAKEN_UP[0] = True
    n = 0
    for call_id, event_at, duration, dialogue, received, filed_at, filing in rows:
        dialogue = json.loads(dialogue) if isinstance(dialogue, str) else dialogue
        turns = _dialogue_turns(dialogue)
        if call_id in _OVERLAY or not any("content" in t for t in turns):
            continue
        filing = json.loads(filing) if isinstance(filing, str) else filing
        stage, kinds, items, why = _kept_stage(filed_at, filing)
        put_at = float(received or now)
        stage_at = filed_at.timestamp() if isinstance(filed_at, datetime) else put_at
        entry = _entry(event_at, float(duration) if duration is not None else None, turns, stage, stage_at, put_at)
        entry.update(kinds=[str(k).strip() for k in kinds if str(k).strip()] if isinstance(kinds, list) else None,
                     items=_int_or_none(items), why=why)
        _OVERLAY[call_id] = entry
        n += 1
    _overlay_prune(now)
    return n


def _taken_up() -> None:
    if _TAKEN_UP[0]:
        return
    try:
        got = take_up()
        if got:
            log.info("hotline desk: %d webhook call(s) laid back from app.hotline_calls", got)
    except Exception as exc:  # noqa: BLE001 - the books show them in time; asked again on the next read
        _TAKEN_UP[0] = False
        log.warning("hotline desk: the kept webhook calls could not be read (%s)", type(exc).__name__)


def _overlay_read(entry: dict[str, Any]) -> dict[str, Any]:
    stage = entry["stage"] if entry["stage"] in _OVERLAY_STATE else "filing"
    return {"state": _OVERLAY_STATE[stage], "stage": stage,
            "at": iso_utc(datetime.fromtimestamp(entry["stage_at"], timezone.utc)) if stage != "filing" else "",
            "kinds": list(entry["kinds"] or []), "items": entry["items"], "via": "", "why": entry["why"],
            "capped": None}


def _overlay_row(call_id: str, entry: dict[str, Any], context: Any, floor: set[str]) -> dict[str, Any]:
    ctx = context if isinstance(context, dict) else {}
    caller = resolve_caller(HOTLINE_LINE, entry["caller_phones"], entry["team"], company=ctx.get("company"),
                            floor=floor, roster=ctx.get("roster"))
    return {"call_id": call_id, "at": entry["at"], "line": HOTLINE_LINE, "line_key": "hotline", "direction": "",
            "duration_sec": entry["duration"], "turns": entry["n_turns"], "caller": caller, "summary": None,
            "hotline": _overlay_read(entry), "has_transcript": entry["n_turns"] > 0}


def overlay_apply(calls: list[dict[str, Any]], version: str, context: Any = None, now: float | None = None, *,
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
    blob = json.dumps(sorted(drawn, key=lambda r: r["call_id"]), sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False)
    digest = hashlib.sha256(blob.encode("utf-8")).hexdigest()
    return out, hashlib.sha256(f"{version}|{digest}".encode("utf-8")).hexdigest()[:16]


def overlay_detail(call_id: str) -> dict[str, Any] | None:
    """One call only the webhook knows yet, in read_call's shape; None when it is not held."""
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
    return {"call_id": call_id, "transcript": {"source": "webhook", "turns": turns,
                                               "plain": entry["plain"] or "\n".join(t["text"] for t in turns)},
            "summary": None}


async def overlay_ready() -> None:
    """The kept webhook calls laid back once, off the request's way (the desk's own thread)."""
    if not _TAKEN_UP[0]:
        await HD.run_on_desk(_taken_up)
