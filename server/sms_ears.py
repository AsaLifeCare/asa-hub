"""The reply ear: a text reaches the same function as the button, exactly once, in sent order; a bare word acts only when unambiguous."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

import psycopg2
import psycopg2.extras

import house_cal_live
import house_directory
import hub_db
import psi_reminders
import punch_pairs
import quo_inbox
import shift_handoff
import shift_requests

log = logging.getLogger("hub.sms_ears")

UTC = timezone.utc
OUT = Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"))
INBOX_DIR = Path(os.getenv("HUB_QUO_INBOX_DIR", str(OUT / "quo-inbox")))
PEOPLE_PATH = Path(os.getenv("HUB_SMS_EARS_PEOPLE", str(OUT / "people.json")))

LOOKBACK_H = float(os.getenv("HUB_SMS_EARS_LOOKBACK_H", "36"))
# how long an unreadable text waits before it is written down as unheard
HOLD_H = float(os.getenv("HUB_SMS_EARS_HOLD_H", "6"))
REF_WAIT_MIN = float(os.getenv("HUB_SMS_EARS_REF_WAIT_MIN", "30"))
# a bare YES that fits nothing open is compared with call-offs this recent
RECENT_H = float(os.getenv("HUB_SMS_EARS_RECENT_H", str(shift_requests.CALLOFF_APPLY_H + 1)))
CONTACTS_TTL_S = float(os.getenv("HUB_SMS_EARS_CONTACTS_TTL_S", "300"))
ACK_KEEP_H = float(os.getenv("HUB_SMS_EARS_ACK_KEEP_H", "12"))
# pause after a door that knew none of the rows (not yet published)
ACK_UNKNOWN_PAUSE_S = float(os.getenv("HUB_SMS_EARS_ACK_UNKNOWN_PAUSE_S", "1800"))
PANEL_DAYS = int(os.getenv("HUB_SMS_EARS_PANEL_DAYS", "14"))
PANEL_LIMIT = int(os.getenv("HUB_SMS_EARS_PANEL_LIMIT", "300"))
WORDS_KEPT = 300
LOCK_NS = int(os.getenv("HUB_SMS_EARS_LOCK_NS", "8217"))
LINE_IDS = {
    pid.strip(): re.sub(r"\D", "", num)[-10:]
    for pid, _, num in (x.partition(":") for x in os.getenv(
        "HUB_SMS_EARS_LINE_IDS", "PNPqYnvZUD:+13309195558,PNadbCL4lS:+13307544040").split(","))
    if pid.strip() and len(re.sub(r"\D", "", num)) >= 10}

# ── what a text came to ─────────────────────────────────────────────────────
APPLIED = "applied"
ALREADY = "already"
ANSWERED = "answered"
AMBIGUOUS = "ambiguous"        # more than one thing could be meant: nothing done
REFUSED = "refused"
UNCLEAR = "unclear"
DECLINED = "declined"
SHIFT_ASK = "shift_ask"
UNMATCHED = "unmatched"
NOT_A_REPLY = "not_a_reply"
UNKNOWN_SENDER = "unknown_sender"
UNHEARD = "unheard"
OUTCOMES = (APPLIED, ALREADY, ANSWERED, AMBIGUOUS, REFUSED, UNCLEAR, DECLINED, SHIFT_ASK,
            UNMATCHED, NOT_A_REPLY, UNKNOWN_SENDER, UNHEARD)
ACTED = frozenset({APPLIED, ANSWERED})

ROAD_CALL_OFF = "call_off"
ROAD_OPEN = "open_shift"
ROAD_HANDOFF = "handoff"
ROAD_SHIFT_ASK = "shift_ask"
ROAD_TIME_OFF = "time_off"
ROAD_PUNCH = "punch_warning"

SENDER_NAMED = "named"
SENDER_SHARED = "shared"
SENDER_UNKNOWN = "unknown"
SENDER_UNREAD = "unread"       # who sent it could not be read when it was heard

# staffShiftReminder kinds (StaffAlerts.gs maps each to shift_reply_*)
ACK_APPLIED = "sms_reply_applied"
ACK_UNCLEAR = "sms_reply_unclear"
ACK_REFUSED = "sms_reply_refused"
ACK_ANSWERED = "sms_reply_answered"
# A DIRECTOR'S RECEIVED ON A PUNCH WARNING, by what it came to — each its own situation (shift_reply_punch_*)…
ACK_PUNCH = {punch_pairs.ACK_OPENED: "sms_reply_punch_open",
             punch_pairs.ACK_WAITING: "sms_reply_punch_waiting",
             punch_pairs.ACK_CLOSED: "sms_reply_punch_closed"}
ACK_PUNCH_KINDS = tuple(ACK_PUNCH.values())
ACK_KINDS = (ACK_APPLIED, ACK_UNCLEAR, ACK_REFUSED, ACK_ANSWERED) + ACK_PUNCH_KINDS
ACK_ID_PREFIX = "SMS|"

REPLIES_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_sms_replies ("
    "id TEXT PRIMARY KEY, line TEXT NOT NULL DEFAULT '', sent_at TIMESTAMPTZ NOT NULL, "
    "heard_at TIMESTAMPTZ NOT NULL DEFAULT now(), phone_key TEXT NOT NULL DEFAULT '', "
    "phone_tail TEXT NOT NULL DEFAULT '', person TEXT NOT NULL DEFAULT '', "
    "sender TEXT NOT NULL DEFAULT '', word TEXT NOT NULL DEFAULT '', "
    "words TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL, road TEXT NOT NULL DEFAULT '', "
    "code TEXT NOT NULL DEFAULT '', why TEXT NOT NULL DEFAULT '', "
    "location TEXT NOT NULL DEFAULT '', col_iso TEXT NOT NULL DEFAULT '', "
    "value TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '', "
    "request_id TEXT NOT NULL DEFAULT '', handoff_id TEXT NOT NULL DEFAULT '', "
    "candidates JSONB NOT NULL DEFAULT '[]'::jsonb, ack TEXT NOT NULL DEFAULT '', "
    "ack_why TEXT NOT NULL DEFAULT '', said JSONB NOT NULL DEFAULT '{}'::jsonb)"
)
REPLIES_INDEX_DDL = "CREATE INDEX IF NOT EXISTS asa_sms_replies_sent ON asa_sms_replies (sent_at)"
# THE MARK on the ear's own ledger: a line the staff-answers rehearsal wrote says so by its source.
REHEARSAL_COLUMN_DDL = ("ALTER TABLE asa_sms_replies ADD COLUMN IF NOT EXISTS rehearsal BOOLEAN "
                        "NOT NULL DEFAULT FALSE")
# the minute the ear first listened; earlier texts are history
START_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_sms_reply_start ("
    "id INT PRIMARY KEY, since TIMESTAMPTZ NOT NULL DEFAULT now())"
)
DDL = (REPLIES_DDL, REPLIES_INDEX_DDL, REHEARSAL_COLUMN_DDL, START_DDL)

# The word a rehearsed line carries as its source, and the via it earns at every door it reaches.
REHEARSAL = "rehearsal"
REHEARSAL_VIA = f"{REHEARSAL}:sms"


def played(t: dict[str, Any] | None) -> bool:
    """True when this text was written by the staff-answers rehearsal, by its own source word."""
    return str((t or {}).get("source") or "") == REHEARSAL

_ENSURED: set[str] = set()
_ENSURE_LOCK = threading.Lock()


def _now() -> datetime:
    return datetime.now(UTC)


def _connect(dsn: str):
    return hub_db.connect(dsn)


def _iso(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value or "")


class _Wait(Exception):
    """This text's answer could not be READ now — it is heard on a later pass."""

    def __init__(self, why: str) -> None:
        super().__init__(why)
        self.why = why


# the inbox — the texts this ear hears

def heard_text(raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, (str, bytes)):
        try:
            got = json.loads(raw)
        except ValueError:
            return None
    else:
        got = raw
    if not isinstance(got, dict):
        return None
    event = got.get("event") if isinstance(got.get("event"), dict) else {}
    key = quo_inbox.event_key(event)
    if key is None or key[1] != "message.received":
        return None
    data = event.get("data") if isinstance(event.get("data"), dict) else {}
    obj = data.get("object") if isinstance(data.get("object"), dict) else data
    direction = str(obj.get("direction") or "").lower()
    if direction and direction not in ("incoming", "inbound"):
        return None
    lines = psi_reminders.REPLY_LINES
    to = psi_reminders._to_digits(obj.get("to"))
    heard = sorted(set(to) & lines) if lines else sorted(set(to))
    line = heard[0] if heard else LINE_IDS.get(str(obj.get("phoneNumberId") or "").strip(), "")
    if not line or (lines and line not in lines):
        return None
    sent = psi_reminders._instant(obj.get("createdAt")) or psi_reminders._instant(got.get("received_at"))
    if sent is None:
        return None
    return {"id": key[0], "line": line, "sent_at": sent, "from": str(obj.get("from") or ""),
            "text": str(obj.get("text") or obj.get("body") or ""),
            "group": len(set(to)) > 1,
            "received_at": str(got.get("received_at") or ""), "source": str(got.get("source") or "")}


# path → (its stamp, the texts it holds — or None when it could not be read)
_FILES: dict[str, tuple[tuple[int, int], list[dict[str, Any]] | None]] = {}
_FILES_LOCK = threading.Lock()


def inbox_texts(inbox: Path | None = None, now: datetime | None = None
                ) -> tuple[list[dict[str, Any]], list[str]]:
    inbox = inbox or INBOX_DIR
    now = now or _now()
    floor = now - timedelta(hours=LOOKBACK_H)
    try:
        paths = sorted(list(inbox.glob("*.jsonl")) + list(inbox.glob("*.jsonl.gz")))
    except OSError:
        return [], [str(inbox)]
    seen: dict[str, dict[str, Any]] = {}
    unreadable: list[str] = []
    for p in paths:
        try:
            st = p.stat()
        except OSError:
            unreadable.append(p.name)
            continue
        if datetime.fromtimestamp(st.st_mtime, UTC) < floor:
            continue
        stamp = (st.st_mtime_ns, st.st_size)
        with _FILES_LOCK:
            cached = _FILES.get(str(p))
        if cached and cached[0] == stamp:
            found = cached[1]
        else:
            try:
                found = [t for t in (heard_text(ln) for ln in psi_reminders._inbox_lines(p)) if t]
            except (OSError, EOFError, ValueError) as exc:
                # logged once per version of the file
                log.info("sms ears: %s could not be read (%s) — its texts wait", p.name,
                         type(exc).__name__)
                found = None
            with _FILES_LOCK:
                _FILES[str(p)] = (stamp, found)
        if found is None:
            unreadable.append(p.name)
            continue
        for t in found:
            if t["sent_at"] >= floor:
                seen.setdefault(t["id"], t)
    here = {str(p) for p in paths}
    with _FILES_LOCK:
        for gone in [k for k in _FILES if k not in here]:
            _FILES.pop(gone, None)
    return sorted(seen.values(), key=lambda t: (t["sent_at"], t["id"])), unreadable


# the words — read by the estate's own readers

_REF_WORDS = re.compile(r"\b(?:ref|reference|code)\b\s*[:#]?", re.I)
# an OK alone answers a swap or the shift ask but never applies for a shift without its ref
WEAK_YES = frozenset({"ok", "okay", "k", "kk", "okk", "okey"})


TIME_OFF_REF_RE = re.compile(r"\bTO[0-9A-F]{10}\b")

# The two sides an APPROVE answers; each consent is its own field and its own ask.
APPROVER_SIDES = ("manager", "director")


def read_text(text: Any) -> dict[str, Any]:
    """{word, weak, late, manager, sp, ho, to, pw, received, reply} for one text; refs are taken out before shift_handoff.read_word."""
    raw = str(text or "")
    upper = raw.upper()
    sp = sorted(set(shift_requests.REF_RE.findall(upper)))
    ho = sorted(set(shift_handoff.REF_RE.findall(upper)))
    to = sorted(set(TIME_OFF_REF_RE.findall(upper)))
    pw = sorted(set(punch_pairs.REF_RE.findall(upper)))
    bare = punch_pairs.REF_RE.sub(" ", TIME_OFF_REF_RE.sub(
        " ", shift_handoff.REF_RE.sub(" ", shift_requests.REF_RE.sub(" ", upper))))
    bare = _REF_WORDS.sub(" ", bare)
    word = shift_handoff.read_word(bare)
    late = psi_reminders.reply_word(bare) == "late"
    # RECEIVED is a word of its own, never a yes: a yes on this line already answers a swap, a shift ask or an…
    received = (punch_pairs.received_answer(bare) if pw else punch_pairs.received_alone(bare))
    words = psi_reminders._fold_reply(bare).split()
    weak = (word == "yes" and bool(words) and words[0] in WEAK_YES
            and shift_handoff.read_word(" ".join(words[1:])) != "yes")
    return {"word": word, "weak": weak, "late": late, "received": received,
            "manager": shift_handoff.is_manager_word(bare),
            "sp": sp, "ho": ho, "to": to, "pw": pw,
            "reply": word in ("yes", "no") or late or received or bool(sp or ho or to or pw)}


def _day_word(col_iso: str) -> str:
    day = shift_requests.day_of(col_iso)
    return f"{day.strftime('%a')} {day.month}/{day.day}" if day else str(col_iso or "")


def _shift_words(c: dict[str, Any]) -> str:
    value = str(c.get("value") or "").strip() or "open"
    house = str(c.get("house") or "") or shift_requests.short_house(str(c.get("location") or ""))
    return f"the {value} shift at {house} on {_day_word(str(c.get('col_iso') or ''))}"


# never guess — what a text that quotes no ref may do (pure)

def plan_bare(*, word: str, late: bool, manager: bool, handoffs: list[dict[str, Any]],
              offers: list[dict[str, Any]], ask: dict[str, Any] | None,
              recent: list[dict[str, Any]], on_grid: bool, weak: bool = False) -> dict[str, Any]:
    """The bare-word decision (pure): {act, target} or {outcome, why, code, candidates}; two candidates is AMBIGUOUS."""
    if late and word not in ("yes", "no"):
        if ask:
            return {"outcome": SHIFT_ASK, "road": ROAD_SHIFT_ASK, "code": "late",
                    "why": ("a late call — the shift flow reads it as the answer to its ask about "
                            f"the {ask.get('shift_code') or ''} shift at "
                            f"{ask.get('house_name') or ask.get('house') or 'their house'}").strip(),
                    "candidates": [_ask_candidate(ask)]}
        return {"outcome": NOT_A_REPLY, "code": "late",
                "why": "it says they are running late, and no shift ask was waiting on them"}
    if word not in ("yes", "no"):
        return {"outcome": NOT_A_REPLY, "code": "",
                "why": "neither a yes, a no nor a shift's ref — nothing to act on"}
    # APPROVE is an approver's word: it answers an approval — a house manager's or a director's — and nothing else.
    hands = [h for h in handoffs if not manager or h.get("side") in APPROVER_SIDES]
    # an approver's bare word counts only when that approval ask reached this phone (`asked_here`), never an OK
    unasked = [h for h in hands if h.get("side") in APPROVER_SIDES and not h.get("asked_here")
               and (h.get("side") == "director"
                    or h.get("approval") != shift_handoff.BY_ABOVE) and not weak]
    hands = [h for h in hands
             if h.get("side") not in APPROVER_SIDES or (h.get("asked_here") and not weak)]
    offs = offers if (word == "yes" and not manager and not weak) else []
    asked = ask if not manager else None
    if asked and hands:
        ask_at = psi_reminders._instant(asked.get("asked_at"))
        reached = [(h, psi_reminders._instant(h.get("asked_at"))) for h in hands
                   if h.get("asked_here")]
        newer = [h for h, at in reached if ask_at is not None and at is not None and at > ask_at]
        if newer:
            hands, asked = newer, None
        elif not reached or (ask_at is not None
                             and all(at is not None and at < ask_at for _h, at in reached)):
            hands = []
    cands = ([_offer_candidate(o) for o in offs] + [_handoff_candidate(h) for h in hands]
             + ([_ask_candidate(asked)] if asked else []))
    if not cands and unasked:
        cands_u = [_handoff_candidate(h) for h in unasked]
        return {"outcome": AMBIGUOUS, "code": "approval_needs_ref",
                "why": (f"a bare {word.upper()} from a phone the approval ask was not seen reaching "
                        f"— " + "; ".join(_candidate_words(c) for c in cands_u)
                        + " — an approval is given with its ref or on the Hub, so nothing was done"),
                "candidates": cands_u}
    if len(cands) > 1:
        return {"outcome": AMBIGUOUS, "code": "several",
                "why": (f"a bare {word.upper()} that could answer {len(cands)} things — "
                        + "; ".join(_candidate_words(c) for c in cands)
                        + " — so nothing was done"),
                "candidates": cands}
    if len(cands) == 1:
        c = cands[0]
        if c["road"] == ROAD_SHIFT_ASK:
            return {"outcome": SHIFT_ASK, "road": ROAD_SHIFT_ASK, "code": word,
                    "why": (f"the shift flow reads it as the answer to its ask about "
                            f"{_candidate_words(c)}"), "candidates": cands}
        if c["road"] == ROAD_HANDOFF:
            return {"act": "answer", "target": hands[0]}
        return {"act": "apply", "target": offs[0]}
    if weak:
        return {"outcome": NOT_A_REPLY, "code": "acknowledgement",
                "why": ("an OK acknowledges a message — it is never read as taking a shift; a YES "
                        "or the shift's ref applies")}
    if word == "yes" and not manager:
        if recent and not on_grid:
            return {"outcome": REFUSED, "road": ROAD_CALL_OFF, "code": "not_on_a_grid",
                    "why": ("their name is on no house calendar, so no call-off shift could be "
                            "applied for — the house manager can apply for them"),
                    "candidates": [_offer_candidate(r) for r in recent]}
        if len(recent) == 1:
            r = recent[0]
            st = r.get("standing") or {}
            return {"outcome": REFUSED, "road": ROAD_CALL_OFF,
                    "code": str(st.get("code") or "refused"),
                    "why": f"{_shift_words(r)}: {st.get('why') or 'it was not open to them'}",
                    "target": r, "candidates": [_offer_candidate(r)]}
    return {"outcome": UNMATCHED, "code": "nothing_waiting",
            "why": (f"a {word.upper()} with nothing waiting on it — no call-off shift open to them, "
                    f"no swap waiting on them and no shift ask in front of them")}


def _offer_candidate(o: dict[str, Any]) -> dict[str, Any]:
    # NEVER THE ROW: for a call-off the `open_row` is the person who called off.
    return {"road": ROAD_CALL_OFF if o.get("kind", shift_requests.KIND_CALLOFF)
            == shift_requests.KIND_CALLOFF else ROAD_OPEN,
            "ref": str(o.get("ref") or ""), "location": str(o.get("location") or ""),
            "house": shift_requests.short_house(str(o.get("location") or "")),
            "col_iso": str(o.get("col_iso") or ""), "value": str(o.get("value") or ""),
            "standing": str((o.get("standing") or {}).get("code") or "")}


def _handoff_candidate(h: dict[str, Any]) -> dict[str, Any]:
    return {"road": ROAD_HANDOFF, "handoff_id": str(h.get("id") or ""),
            "side": str(h.get("side") or ""), "location": str(h.get("location") or ""),
            "house": shift_requests.short_house(str(h.get("location") or "")),
            "col_iso": str(h.get("col_iso") or ""), "value": str(h.get("value") or "")}


def _ask_candidate(a: dict[str, Any]) -> dict[str, Any]:
    return {"road": ROAD_SHIFT_ASK, "house": str(a.get("house_name") or a.get("house") or ""),
            "shift_at": str(a.get("shift_at") or ""), "value": str(a.get("shift_code") or ""),
            "col_iso": str(a.get("shift_at") or "")[:10]}


def _candidate_words(c: dict[str, Any]) -> str:
    if c["road"] == ROAD_HANDOFF:
        return f"the swap {c.get('handoff_id')} ({_shift_words(c)[4:]})"
    if c["road"] == ROAD_SHIFT_ASK:
        return f"the shift ask about {_shift_words(c)[4:]}"
    return f"{_shift_words(c)} (ref {c.get('ref')})"


def choices_text(cands: Iterable[dict[str, Any]]) -> str:
    out = []
    for c in cands:
        if c.get("road") == ROAD_HANDOFF:
            hid = c.get("handoff_id")
            out.append(f"the swap {hid} ({_shift_words(c)[4:]}) - reply YES {hid} or NO {hid}")
        elif c.get("road") == ROAD_SHIFT_ASK:
            out.append(f"your {c.get('value') or ''} shift at {c.get('house') or 'your house'} "
                       f"(the shift reminder)".replace("  ", " "))
        else:
            out.append(f"{_shift_words(c)} - reply YES {c.get('ref')}")
    return "; ".join(out)


_STAFF_WHY = {
    "window_closed": "applications for it have closed - the house manager decides who takes it",
    "manager_only": "it starts too soon for applications - the house manager assigns it",
    "filled": "somebody already has it",
    "called_off": "it is the shift you called off - speak to your house manager to take it back",
    "not_a_regular": "for its first minutes it is kept for the house's own staff",
    "regular_unknown": ("for its first minutes it is kept for the house's own staff, and the calendar "
                        "cannot show yet whether you are one - the house manager decides"),
    "unreadable_hours": ("a cell on your calendar that day has no hours anybody can read - your house "
                         "manager can fix it, or apply on the Hub"),
    "no_such_shift": "no open shift carries that reference",
    "not_on_a_grid": ("we could not find your name on the house calendars - apply on the Hub or "
                      "call the office"),
    "no_name": "we could not tell who you are from this number",
}


def staff_why(code: str, extra: dict[str, Any] | None = None) -> str:
    if code == "time_off":
        return "you are on approved time off that day"
    if code == "overlap":
        c = (extra or {}).get("clash") or {}
        where = shift_requests.short_house(str(c.get("location") or ""))
        what = str(c.get("value") or "").strip() or "another"
        return (f"it overlaps the {what} shift at {where} on {_day_word(str(c.get('col_iso') or ''))} "
                f"you already hold").replace(" at  on", " on")
    return _STAFF_WHY.get(code, "it could not be taken - apply on the Hub or call the office")


def staff_refusal(row: dict[str, Any], code: str, extra: dict[str, Any] | None = None) -> str:
    why = staff_why(code, extra)
    return f"{_shift_words(row)}: {why}" if row.get("location") else why


def applied_words(training: bool) -> str:
    """What an applicant by text is told happens next; never that the shift is theirs."""
    if training:
        return ("The house manager decides who takes it, and as it is your first shift there, "
                "also has to approve your training.")
    return "The house manager decides who takes it."


def still_waiting(row: dict[str, Any]) -> str:
    """Whose answer a swap is still owed, each read from its own field."""
    want = []
    if str(row.get("staff_state") or shift_handoff.PENDING) == shift_handoff.PENDING:
        want.append(f"{row.get('to_staff') or 'the other member of staff'} to accept")
    if str(row.get("manager_state") or shift_handoff.PENDING) == shift_handoff.PENDING:
        want.append(("a director, team lead or administrator"
                     if row.get("approval") == shift_handoff.BY_ABOVE else "the house manager")
                    + " to approve")
    if str(row.get("director_state") or shift_handoff.PENDING) == shift_handoff.PENDING:
        named = shift_handoff.director_names(row)
        want.append(f"the director {named[0]}" if named else "the director")
        want[-1] += " to approve"
    return " and ".join(want)


def handoff_words(row: dict[str, Any], side: str, word: str, *, second: bool) -> str:
    state = str(row.get("state") or "")
    hid = str(row.get("id") or "")
    if side == "director":
        who = "you" if second else (str(row.get("director_by") or "") or "the director")
    else:
        who = "you" if second else (str(row.get("to_staff") if side == "staff"
                                        else row.get("manager_by") or row.get("house_manager")
                                        or "the house manager"))
    if side == "staff":
        if word == "no":
            return f"{who} passed on the swap {hid}, so the offer is closed"
        if state == shift_handoff.DONE:
            return (f"{who} accepted the swap {hid} and it went through - the shift is "
                    f"{'yours' if second else 'theirs'}")
        if state == shift_handoff.DEAD:
            return f"{who} accepted the swap {hid}, but it could not go through: {row.get('why') or ''}"
        rest = still_waiting(row)
        if not rest:
            return (f"{who} accepted the swap {hid} - all three have agreed, and it waits: "
                    f"{row.get('why') or 'it goes through within the minute'}")
        return f"{who} accepted the swap {hid} - it now waits on {rest}"
    if word == "no":
        return f"{who} did not approve the swap {hid}, so the offer is closed"
    if state == shift_handoff.DONE:
        return f"{who} approved the swap {hid} and it went through"
    if state == shift_handoff.DEAD:
        return f"{who} approved the swap {hid}, but it could not go through: {row.get('why') or ''}"
    rest = still_waiting(row)
    if not rest:
        return (f"{who} approved the swap {hid} - all three have agreed, and it waits: "
                f"{row.get('why') or 'it goes through within the minute'}")
    return f"{who} approved the swap {hid} - it now waits on {rest}"


# who sent it

class Contacts:
    def __init__(self, company: dict[str, str], floor: set[str],
                 roster: dict[str, dict[str, str]]) -> None:
        self.company, self.floor, self.roster = company, floor, roster

    def who(self, line: str, phone: str) -> dict[str, str]:
        import hotline_desk  # noqa: PLC0415 — optional on a relay; its absence waits the text
        got = hotline_desk.resolve_caller(line, phone, "", company=self.company,
                                          floor=self.floor, roster=self.roster)
        if got.get("who") == "sole" and got.get("name"):
            return {"sender": SENDER_NAMED, "name": str(got["name"])}
        if got.get("who") == "shared":
            return {"sender": SENDER_SHARED, "name": ""}
        return {"sender": SENDER_UNKNOWN, "name": ""}


_CONTACTS: dict[str, Any] = {"at": 0.0, "value": None}
_CONTACTS_LOCK = threading.Lock()


def load_contacts(dsn: str) -> Contacts:
    with _CONTACTS_LOCK:
        if _CONTACTS["value"] is not None and time.time() - _CONTACTS["at"] < CONTACTS_TTL_S:
            return _CONTACTS["value"]
    import hotline_desk  # noqa: PLC0415
    (company, _ids), _n = hotline_desk._read_directory(dsn)
    roster, _m = hotline_desk._read_roster(str(PEOPLE_PATH), dsn)
    got = Contacts(company, hotline_desk.shared_floor(), roster)
    with _CONTACTS_LOCK:
        _CONTACTS.update(at=time.time(), value=got)
    return got


def forget() -> None:
    """Tests only."""
    with _CONTACTS_LOCK:
        _CONTACTS.update(at=0.0, value=None)
    with _FILES_LOCK:
        _FILES.clear()
    _ACK_PAUSE["until"] = 0.0
    _ENSURED.clear()


def grid_name(view: dict[str, Any], name: str) -> str:
    key = shift_requests.fold(name)
    if not key:
        return ""
    found = sorted({n for loc, names in (view.get("people") or {}).items() for n in names
                    if shift_requests.fold(n) == key and not house_cal_live.not_a_person(n, loc)})
    return found[0] if found else ""


# one pass

class _Pass:
    """Reads once per pass, lazily; a failed read makes the texts that need it wait."""

    def __init__(self, dsn: str, now: datetime,
                 contacts: Callable[[], Contacts] | None) -> None:
        self.dsn, self.now = dsn, now
        self._contacts_fn = contacts or (lambda: load_contacts(dsn))
        self._contacts: Contacts | None = None
        self._contacts_why = ""
        self._view: dict[str, Any] | None = None
        self._ist: dict[str, Any] | None = None
        self._who: dict[str, dict[str, Any]] = {}
        self._warned: set[str] | None = None

    def warned_phones(self) -> set[str]:
        """The phones a punch warning still being told has reached — one read per pass."""
        if self._warned is None:
            try:
                self._warned = punch_pairs.warned_phones(self.dsn)
            except Exception as exc:  # noqa: BLE001
                raise _Wait(f"the punch warnings could not be read ({type(exc).__name__})") from exc
        return self._warned

    def who(self, name: str) -> dict[str, Any]:
        if name not in self._who:
            try:
                self._who[name] = shift_requests.viewer_by_name(self.dsn, name)
            except Exception as exc:  # noqa: BLE001
                raise _Wait(f"who {name} is on the platform could not be read "
                            f"({type(exc).__name__})") from exc
        return self._who[name]

    def contacts(self) -> Contacts:
        if self._contacts is None and not self._contacts_why:
            try:
                self._contacts = self._contacts_fn()
            except Exception as exc:  # noqa: BLE001
                self._contacts_why = (f"who a number belongs to could not be read "
                                      f"({type(exc).__name__}: {str(exc)[:120]})")
        if self._contacts is None:
            raise _Wait(self._contacts_why)
        return self._contacts

    def view(self) -> dict[str, Any]:
        if self._view is None:
            try:
                self._view = shift_requests.estate(self.dsn)
            except Exception as exc:  # noqa: BLE001
                raise _Wait(f"the house calendars could not be read ({type(exc).__name__})") from exc
        return self._view

    def ist(self) -> dict[str, Any]:
        if self._ist is None:
            self._ist = shift_requests.ist_index(self.dsn)
        return self._ist


def _base(t: dict[str, Any]) -> dict[str, Any]:
    digits = re.sub(r"\D", "", t.get("from") or "")
    return {"id": t["id"], "line": t["line"], "sent_at": t["sent_at"],
            "phone_key": psi_reminders.phone_key(t.get("from")), "phone_tail": digits[-4:],
            "person": "", "sender": "", "word": "", "words": "", "outcome": "", "road": "",
            "code": "", "why": "", "location": "", "col_iso": "", "value": "", "ref": "",
            "request_id": "", "handoff_id": "", "candidates": [], "ack": "", "ack_why": "",
            "rehearsal": played(t)}


def _hear(dsn: str, t: dict[str, Any], ctx: _Pass) -> dict[str, Any]:
    p = read_text(t["text"])
    row = _base(t)
    row["word"] = p["word"] if p["word"] in ("yes", "no") else ("late" if p["late"] else "other")
    # A BARE RECEIVED FROM A PHONE NO LIVE WARNING REACHED IS NOT A REPLY, as it was before the word was read at…
    stray = bool(p["received"] and not t.get("group")
                 and not (p["sp"] or p["ho"] or p["to"] or p["pw"])
                 and row["phone_key"] not in ctx.warned_phones())
    if stray:
        p = dict(p, received=False, reply=p["word"] in ("yes", "no") or p["late"])
    if t.get("group") or not p["reply"]:
        # not a reply; a failed contacts read is "unread", never unknown
        try:
            who = ctx.contacts().who(t["line"], t["from"])
            row.update(person=who["name"], sender=who["sender"])
        except _Wait:
            row["sender"] = SENDER_UNREAD
        row.update(outcome=NOT_A_REPLY, code="group" if t.get("group") else "",
                   why=("a group text — a conversation among several people, not an answer to "
                        "one of our asks" if t.get("group")
                        else "a bare RECEIVED from a phone no punch warning reached — nothing to act on"
                        if stray
                        else "neither a yes, a no nor a shift's ref — nothing to act on"))
        return row
    row["words"] = str(t["text"] or "")[:WORDS_KEPT]
    row["ref"] = (p["sp"] + p["ho"] + p["to"] + p["pw"] + [""])[0]
    who = ctx.contacts().who(t["line"], t["from"])
    row.update(person=who["name"], sender=who["sender"])
    if who["sender"] != SENDER_NAMED:
        row.update(outcome=UNKNOWN_SENDER, code=who["sender"],
                   why=("sent from a company line or a number several people share — it is never "
                        "given a name, so nothing was done" if who["sender"] == SENDER_SHARED
                        else "a number nobody on the staff roster holds — nothing was done"))
        return row
    name = who["name"]
    grid = grid_name(ctx.view(), name)
    if grid:
        row["person"] = grid
    if len(p["sp"]) + len(p["ho"]) + len(p["to"]) + len(p["pw"]) > 1:
        refs = ", ".join(p["sp"] + p["ho"] + p["to"] + p["pw"])
        row.update(outcome=AMBIGUOUS, code="several_refs",
                   why=f"it quotes more than one ref ({refs}) — nothing was done",
                   candidates=[{"road": ROAD_CALL_OFF, "ref": r} for r in p["sp"]]
                   + [{"road": ROAD_HANDOFF, "handoff_id": h} for h in p["ho"]]
                   + [{"road": ROAD_TIME_OFF, "ref": r} for r in p["to"]]
                   + [{"road": ROAD_PUNCH, "ref": r} for r in p["pw"]])
        # THE TWO WARNINGS OF A DOUBLE, ANSWERED IN ONE TEXT: still nothing is done — one RECEIVED answers one…
        if not (p["sp"] or p["ho"] or p["to"]):
            row.update(road=ROAD_PUNCH, ref="", ack=ACK_UNCLEAR,
                       ack_why=(f"it named {' and '.join(p['pw'])}, and one RECEIVED answers one "
                                f"warning - reply {', then '.join('RECEIVED ' + r for r in p['pw'])}, "
                                "each in a text of its own"))
        return row
    # THE REF NAMES THE ROAD, AND IT IS ASKED FIRST.
    if p["pw"]:
        return _by_received(dsn, t, p, row, name)
    if p["to"]:
        return _by_time_off_ref(dsn, t, p, row, name, grid, ctx)
    if p["ho"]:
        return _by_handoff_ref(dsn, t, p, row, name, grid, ctx)
    if p["sp"]:
        return _by_shift_ref(dsn, t, p, row, name, grid, ctx)
    # A BARE RECEIVED — the whole text is the word, quoting nothing: a director answering the one warning that…
    if p["received"]:
        got = _by_received(dsn, t, p, row, name, bare=True)
        if got is not None:
            return got
        row.update(road="", ref="")
    return _bare(dsn, t, p, row, name, grid, ctx)


def _names(grid: str, name: str) -> list[str]:
    return [n for i, n in enumerate([grid, name]) if n and n not in [grid, name][:i]]


def _by_handoff_ref(dsn: str, t: dict[str, Any], p: dict[str, Any], row: dict[str, Any],
                    name: str, grid: str, ctx: _Pass) -> dict[str, Any]:
    ref = p["ho"][0]
    row.update(road=ROAD_HANDOFF, handoff_id=ref, ref=ref)
    found, person = None, name
    for n in _names(grid, name):
        found = shift_handoff.match_reply(dsn, text=t["text"], name=n,
                                          who=lambda n=n: ctx.who(n))
        if found:
            person = n
            break
    if not found:
        held = shift_handoff.handoff(dsn, ref)
        if held:
            row.update(location=held["location"], col_iso=held["col_iso"], value=held["value"])
        if not held:
            row.update(outcome=REFUSED, code="no_such_swap", why=f"no swap carries the ref {ref}")
        elif held["state"] != shift_handoff.PENDING:
            row.update(outcome=REFUSED, code="swap_closed",
                       why=(f"the swap {ref} is already "
                            f"{'done' if held['state'] == shift_handoff.DONE else 'closed'}"))
        else:
            row.update(outcome=REFUSED, code="not_theirs",
                       why=f"the swap {ref} is not waiting on {name} — neither the one taking "
                           f"it nor the house manager approving it")
        return row
    row.update(location=found["location"], col_iso=found["col_iso"], value=found["value"])
    return _answer(dsn, row, found, p["word"], person)


# A BARE RECEIVED THAT IS NOT OURS: from somebody who is not a director, or from a phone no waiting warning reached.
_BARE_NOT_OURS = frozenset({"not_a_director", "not_asked_here"})


def _by_received(dsn: str, t: dict[str, Any], p: dict[str, Any], row: dict[str, Any],
                 name: str, *, bare: bool = False) -> dict[str, Any] | None:
    """RECEIVED: a DIRECTOR answering a punch warning, and nobody else."""
    ref = (p["pw"] + [""])[0]
    row.update(road=ROAD_PUNCH, ref=ref)
    if not p["received"]:
        row.update(outcome=UNCLEAR, code="no_word",
                   why=f"it quotes the punch warning {ref} but is not a plain RECEIVED — nothing "
                       f"was done", ack=ACK_UNCLEAR,
                   ack_why=(f"your text named {ref} but was not a plain RECEIVED - to open the "
                            f"shift, reply RECEIVED {ref}"))
        return row
    try:
        got = punch_pairs.acknowledge(dsn, by=name, ref=ref, via="sms",
                                      phone_key=str(row.get("phone_key") or ""))
    except punch_pairs.Unreadable as exc:
        raise _Wait(str(exc)) from exc
    except punch_pairs.Refused as exc:
        if bare and exc.code in _BARE_NOT_OURS:
            return None
        row.update(outcome=AMBIGUOUS if exc.code == "several" else REFUSED, code=exc.code,
                   why=f"the RECEIVED was not acted on: {exc.why}",
                   ack=ACK_UNCLEAR if exc.code == "several" else ACK_REFUSED,
                   ack_why=shift_handoff._plain(exc.why))
        return row
    # THE ACKNOWLEDGEMENT IS A SITUATION OF ITS OWN PER OUTCOME, and carries one fact: its words live in the book.
    outcome, fact = punch_pairs.received_ack(got)
    row.update(outcome=ANSWERED, code=f"punch_{got.get('state') or 'received'}",
               ref=str(got.get("ref") or ref), why=punch_pairs.received_words(got),
               ack=ACK_PUNCH[outcome], ack_why=fact)
    return row


def _by_time_off_ref(dsn: str, t: dict[str, Any], p: dict[str, Any], row: dict[str, Any],
                     name: str, grid: str, ctx: _Pass) -> dict[str, Any]:
    """YES TO… / NO TO…: the leg this sender may fill, decided through the app's own door."""
    import time_off  # noqa: PLC0415 — lazy: the ear runs without the lane loaded
    ref = p["to"][0]
    row.update(road=ROAD_TIME_OFF, ref=ref)
    if played(t):
        # The rehearsal plays no time off: its line never decides a request, a copied one least of all, and a time…
        row.update(outcome=REFUSED, code="rehearsal",
                   why=f"a line the shift rehearsal wrote never decides the time off request {ref} "
                       f"— the rehearsal plays no time off, so nothing was decided")
        return row
    word = p["word"]
    if word not in ("yes", "no"):
        row.update(outcome=UNCLEAR, code="no_word",
                   why=f"it quotes the time off request {ref} but says neither yes nor no — nothing "
                       f"was decided", ack=ACK_UNCLEAR,
                   ack_why=f"your text named {ref} but did not say yes or no - reply YES {ref} or NO {ref}")
        return row
    found, person, refusal = None, name, None
    try:
        for n in _names(grid, name):
            got = time_off.match_reply(dsn, ref=ref, name=n, who=lambda n=n: ctx.who(n))
            if got.get("leg"):
                found, person = got, n
                break
            refusal = refusal or got
            # a refusal about who the sender is holds for every spelling of them
            if got.get("code") in ("own", "filed", "one_leg"):
                refusal = got
                break
    except time_off.Unreadable as exc:
        raise _Wait(str(exc)) from exc
    if not found:
        why = str((refusal or {}).get("why") or f"{ref} is not waiting on {name}")
        row.update(outcome=REFUSED, code=str((refusal or {}).get("code") or "not_theirs"),
                   why=f"{ref} was not decided: {why}", ack=ACK_REFUSED,
                   ack_why=shift_handoff._plain(f"{ref}: {why}"))
        return row
    note = time_off.note_from_text(str(t.get("text") or ""), ref)
    try:
        got = time_off.decide(dsn, {**ctx.who(person), "name": person}, ref,
                              "approve" if word == "yes" else "deny", note, via="sms")
    except time_off.Unreadable as exc:
        raise _Wait(str(exc)) from exc
    except time_off.Refused as exc:
        row.update(outcome=REFUSED, code=exc.code, why=f"{ref} was not decided: {exc.why}",
                   ack=ACK_REFUSED, ack_why=shift_handoff._plain(f"{ref}: {exc.why}"))
        return row
    words = time_off.answered_words(got, got.get("leg") or found["leg"],
                                    "approve" if word == "yes" else "deny")
    row.update(outcome=ANSWERED, code=f"time_off_{word}", why=words, ack=ACK_ANSWERED, ack_why=words)
    return row


def _answer(dsn: str, row: dict[str, Any], h: dict[str, Any], word: str,
            person: str) -> dict[str, Any]:
    side = str(h.get("side") or "")
    if word not in ("yes", "no") or side not in ("staff", "manager", "director"):
        row.update(outcome=UNCLEAR, code="no_word",
                   why=f"it quotes the swap {h['id']} but says neither yes nor no — nothing was "
                       f"answered", ack=ACK_UNCLEAR,
                   ack_why=(f"your text named the swap {h['id']} but did not say yes or no - "
                            f"reply YES {h['id']} or NO {h['id']}"))
        return row
    try:
        # A rehearsed line may answer only a rehearsed transfer, and a real one only a real transfer; the swap door…
        rehearsed = bool(row.get("rehearsal"))
        got = shift_handoff.answer(dsn, str(h["id"]), side=side, word=word, by=person,
                                   via=REHEARSAL_VIA if rehearsed else "sms",
                                   rehearsal={"text": row["id"]} if rehearsed else None)
    except shift_handoff.Refused as exc:
        row.update(outcome=REFUSED, code=exc.code,
                   why=f"the swap {h['id']} was not answered: {exc.why}", ack=ACK_REFUSED,
                   ack_why=shift_handoff._plain(f"the swap {h['id']}: {exc.why}"))
        return row
    if not got.get("changed"):
        row.update(outcome=ALREADY, code="already_answered",
                   why=(f"{person} had already answered the swap {h['id']} on that side "
                        f"({got.get(side + '_state')})"))
        return row
    row.update(outcome=ANSWERED, code=f"{side}_{word}", why=handoff_words(got, side, word, second=False),
               ack=ACK_ANSWERED, ack_why=handoff_words(got, side, word, second=True))
    return row


def _pooled(dsn: str, location: str, open_row: str, col_iso: str) -> dict[str, Any] | None:
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        shift_requests._ddl(cur)
        return shift_requests._pool_one(cur, location, open_row, col_iso)


def _by_shift_ref(dsn: str, t: dict[str, Any], p: dict[str, Any], row: dict[str, Any],
                  name: str, grid: str, ctx: _Pass) -> dict[str, Any]:
    ref = p["sp"][0]
    row["ref"] = ref
    found = shift_requests.by_ref(dsn, ref)
    if not found:
        waited = (ctx.now - t["sent_at"]).total_seconds() / 60.0
        if waited < REF_WAIT_MIN:
            raise _Wait(f"no open shift carries {ref} yet — the sweep may not have met the "
                        f"call-off the text was sent about")
        row.update(outcome=REFUSED, road=ROAD_CALL_OFF, code="no_such_shift",
                   why=f"no open shift carries the ref {ref}", ack=ACK_REFUSED,
                   ack_why=staff_refusal(row, "no_such_shift"))
        return row
    loc, orow, iso = found
    pool_row = _pooled(dsn, loc, orow, iso) or {}
    road = ROAD_CALL_OFF if pool_row.get("kind") == shift_requests.KIND_CALLOFF else ROAD_OPEN
    row.update(road=road, location=loc, col_iso=iso, value=str(pool_row.get("value") or ""))
    if p["word"] == "no":
        row.update(outcome=DECLINED, code="no",
                   why=f"{row['person'] or name} said no to {_shift_words(row)} — nothing was "
                       f"applied for")
        return row
    if p["word"] != "yes":
        row.update(outcome=UNCLEAR, code="no_word",
                   why=f"it quotes the ref of {_shift_words(row)} but does not say yes — nothing "
                       f"was applied for", ack=ACK_UNCLEAR,
                   ack_why=(f"your text named {_shift_words(row)} but did not say yes - reply "
                            f"YES {ref} to apply"))
        return row
    return _apply(dsn, t, row, name, grid, loc, orow, iso)


def _apply(dsn: str, t: dict[str, Any], row: dict[str, Any], name: str, grid: str,
           loc: str, orow: str, iso: str) -> dict[str, Any]:
    if not grid:
        row.update(outcome=REFUSED, code="not_on_a_grid",
                   why=(f"{name} is on no house calendar under that name, so no application "
                        f"was made — the house manager can apply for them"),
                   ack=ACK_REFUSED, ack_why=staff_refusal(row, "not_on_a_grid"))
        return row
    try:
        # The mark goes on AT THE DOOR, in the same statement that makes the row: there is no moment in which a…
        mark = {REHEARSAL: {"text": t["id"], "line": t["line"]}} if played(t) else {}
        got = shift_requests.apply_for(dsn, location=loc, open_row=orow, col_iso=iso, person=grid,
                                       via=REHEARSAL_VIA if played(t) else "sms", now=t["sent_at"],
                                       evidence={"sms": {"id": t["id"], "line": t["line"]}, **mark})
    except shift_requests.Refused as exc:
        row.update(outcome=REFUSED, code=exc.code, why=f"{_shift_words(row)}: {exc.why}",
                   ack=ACK_REFUSED, ack_why=staff_refusal(row, exc.code, exc.extra))
        return row
    extra = got.get("extra") if isinstance(got.get("extra"), dict) else {}
    this_text = ((extra or {}).get("sms") or {}).get("id") == t["id"]
    row["request_id"] = str(got.get("id") or "")
    if got.get("applied") or this_text:
        # An application carrying this text's id came from an earlier, interrupted pass.
        training = bool(got.get("needs_training_approval")) \
            or str(got.get("state") or "") == shift_requests.NEEDS_TRAINING
        row.update(outcome=APPLIED, code="training" if training else "ok",
                   why=(f"{grid} applied by text for {_shift_words(row)}"
                        + (" — a first shift there, so it waits on the house manager's training "
                           "approval" if training else "")
                        + " — the house manager decides"),
                   ack=ACK_APPLIED, ack_why=applied_words(training))
        return row
    row.update(outcome=ALREADY, code="already_applied",
               why=f"{grid} had already applied for {_shift_words(row)}")
    return row


def _bare(dsn: str, t: dict[str, Any], p: dict[str, Any], row: dict[str, Any], name: str,
          grid: str, ctx: _Pass) -> dict[str, Any]:
    try:
        ask = psi_reminders.ask_open_for(t["from"], t["sent_at"])
    except psi_reminders.LedgerUnreadable as exc:
        raise _Wait(str(exc)) from exc
    handoffs: dict[str, dict[str, Any]] = {}
    above_open = any(h.get("approval") == shift_handoff.BY_ABOVE
                     for h in shift_handoff.open_offers(dsn))
    for n in _names(grid, name):
        above = above_open and bool(ctx.who(n).get("decides_everywhere"))
        for h in shift_handoff.waiting_on(dsn, n, above=above):
            side = shift_handoff.side_for({**ctx.who(n), "name": n}, h)
            # The text door never invents a seat: one the screen would not offer is not theirs.
            if side not in ("staff", "manager", "director"):
                continue
            # A director's ask is kept per seat; its bare kind reads every seat, matched by phone.
            kind = {"staff": shift_handoff.KIND_ASK_STAFF,
                    "director": shift_handoff.KIND_ASK_DIRECTOR}.get(
                        side, shift_handoff.KIND_ASK_MANAGER)
            at = None if (side == "manager" and h.get("approval") == shift_handoff.BY_ABOVE) \
                else shift_handoff.asked_at(h, row["phone_key"], t["sent_at"], kind)
            handoffs.setdefault(str(h["id"]), {
                **h, "side": side, "as": n, "asked_here": at is not None,
                "asked_at": _iso(at) if at is not None else ""})
    offers: list[dict[str, Any]] = []
    recent: list[dict[str, Any]] = []
    if p["word"] == "yes" and not p["manager"]:
        view = ctx.view()
        pooled = shift_requests.pool(dsn, now=t["sent_at"], view=view)
        offs = [s for s in pooled if s["kind"] == shift_requests.KIND_CALLOFF and not s["filled_by"]]
        stand = (shift_requests.standing(dsn, grid, offs, now=t["sent_at"], view=view,
                                         ist=ctx.ist()) if grid and offs else {})
        floor = t["sent_at"] - timedelta(hours=RECENT_H)
        for s in offs:
            st = stand.get(s["ref"]) or {}
            code = str(st.get("code") or "")
            open_now = s["window"]["state"] == shift_requests.WINDOW_OPEN
            if code == "ok" or (code == "applied" and open_now):
                offers.append({**s, "standing": st})
                continue
            opened = psi_reminders._instant(s["window"].get("opens_at"))
            if opened is not None and floor <= opened <= t["sent_at"]:
                recent.append({**s, "standing": st})
    plan = plan_bare(word=p["word"], late=p["late"], manager=p["manager"],
                     handoffs=list(handoffs.values()), offers=offers, ask=ask, recent=recent,
                     on_grid=bool(grid), weak=p["weak"])
    if plan.get("act") == "answer":
        h = plan["target"]
        row.update(road=ROAD_HANDOFF, handoff_id=str(h["id"]), ref=str(h["id"]),
                   location=h["location"], col_iso=h["col_iso"], value=h["value"])
        return _answer(dsn, row, h, p["word"], str(h.get("as") or name))
    if plan.get("act") == "apply":
        o = plan["target"]
        row.update(road=ROAD_CALL_OFF, ref=o["ref"], location=o["location"], col_iso=o["col_iso"],
                   value=o["value"])
        if (o.get("standing") or {}).get("code") == "applied":
            row.update(outcome=ALREADY, code="already_applied", request_id=str(
                (o.get("standing") or {}).get("request_id") or ""),
                why=f"{grid} had already applied for {_shift_words(row)}")
            return row
        return _apply(dsn, t, row, name, grid, o["location"], o["open_row"], o["col_iso"])
    row.update(outcome=plan["outcome"], code=plan.get("code") or "", why=plan.get("why") or "",
               road=plan.get("road") or "", candidates=plan.get("candidates") or [])
    target = plan.get("target")
    if target:
        row.update(ref=str(target.get("ref") or ""), location=str(target.get("location") or ""),
                   col_iso=str(target.get("col_iso") or ""), value=str(target.get("value") or ""))
    if plan["outcome"] == AMBIGUOUS:
        row.update(ack=ACK_UNCLEAR, ack_why=("we could not tell which it was for: "
                                             + choices_text(row["candidates"])))
    elif plan["outcome"] == REFUSED:
        code = str(plan.get("code") or "")
        extra = {"clash": ((target or {}).get("standing") or {}).get("clash")} if target else {}
        row.update(ack=ACK_REFUSED, ack_why=staff_refusal(row, code, extra))
    return row


# ── the ledger ─────────────────────────────────────────────────────────────

def _ensure(dsn: str) -> None:
    with _ENSURE_LOCK:
        if dsn in _ENSURED:
            return
        with _connect(dsn) as conn, conn.cursor() as cur:
            for stmt in DDL:
                cur.execute(stmt)
            cur.execute("INSERT INTO asa_sms_reply_start (id) VALUES (1) ON CONFLICT DO NOTHING")
            conn.commit()
        _ENSURED.add(dsn)


def _since(dsn: str) -> datetime:
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT since FROM asa_sms_reply_start WHERE id=1")
        got = cur.fetchone()
    return got[0] if got else _now()


def _handled(dsn: str, ids: list[str]) -> set[str]:
    if not ids:
        return set()
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM asa_sms_replies WHERE id = ANY(%s)", (ids,))
        return {r[0] for r in cur.fetchall()}


_COLUMNS = ("id", "line", "sent_at", "phone_key", "phone_tail", "person", "sender", "word",
            "words", "outcome", "road", "code", "why", "location", "col_iso", "value", "ref",
            "request_id", "handoff_id", "candidates", "ack", "ack_why", "rehearsal")


def _record(dsn: str, row: dict[str, Any]) -> bool:
    vals = [json.dumps(row.get(c) or [], default=str) if c == "candidates"
            else bool(row.get(c)) if c == "rehearsal" else row.get(c, "")
            for c in _COLUMNS]
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"INSERT INTO asa_sms_replies ({', '.join(_COLUMNS)}) "
                    f"VALUES ({', '.join(['%s'] * len(_COLUMNS))}) ON CONFLICT (id) DO NOTHING",
                    vals)
        wrote = cur.rowcount == 1
        conn.commit()
    return wrote


class _EarLock:
    """One pass at a time per schema, on a session lock of its own connection."""

    def __init__(self, dsn: str) -> None:
        self.dsn, self.conn, self.held = dsn, None, False

    def __enter__(self) -> "_EarLock":
        self.conn = _connect(self.dsn)
        self.conn.autocommit = True
        with self.conn.cursor() as cur:
            cur.execute("SELECT current_schema()")
            schema = str((cur.fetchone() or [""])[0] or "")
            key = int(hashlib.sha1(f"sms_ears|{schema}".encode()).hexdigest()[:8], 16) % (2 ** 31)
            cur.execute("SELECT pg_try_advisory_lock(%s,%s)", (LOCK_NS, key))
            self.held = bool((cur.fetchone() or [False])[0])
        return self

    def __exit__(self, *exc: Any) -> None:
        if self.conn is not None:
            try:
                self.conn.close()
            except Exception:  # noqa: BLE001
                pass
        self.conn, self.held = None, False


# the caller's own pass lock, to take before writing a line this same pass must hear
EarLock = _EarLock


class _Kept:
    """A lock somebody else holds: entering and leaving it neither takes nor gives it back."""

    def __init__(self, lock: "EarLock") -> None:
        self.lock = lock

    def __enter__(self) -> "EarLock":
        return self.lock

    def __exit__(self, *exc: Any) -> None:
        return None


def listen(dsn: str, *, inbox: Path | None = None, now: datetime | None = None,
           contacts: Callable[[], Contacts] | None = None,
           lock: "EarLock | None" = None) -> dict[str, Any]:
    """One pass over every unheard text in sent order: {state (ok | busy), heard, acted, waiting, …, why}."""
    now = now or _now()
    said: dict[str, Any] = {"state": "ok", "heard": 0, "acted": 0, "waiting": 0, "before": 0,
                            "outcomes": {}, "why": "", "unreadable": []}
    texts, unreadable = inbox_texts(inbox, now)
    said["unreadable"] = unreadable
    if not texts:
        return said
    with (_Kept(lock) if lock is not None and lock.held else _EarLock(dsn)) as lock:
        if not lock.held:
            said["state"] = "busy"
            return said
        _ensure(dsn)
        since = _since(dsn)
        todo = [t for t in texts if t["sent_at"] >= since]
        said["before"] = len(texts) - len(todo)
        done = _handled(dsn, [t["id"] for t in todo])
        todo = [t for t in todo if t["id"] not in done]
        ctx = _Pass(dsn, now, contacts)
        held_phones: set[str] = set()
        for t in todo:
            phone = psi_reminders.phone_key(t["from"]) or str(t["from"])
            if phone in held_phones:
                said["waiting"] += 1
                continue
            why = None
            try:
                row = _hear(dsn, t, ctx)
            except _Wait as w:
                why = w.why
            except Exception as exc:  # noqa: BLE001 — the text waits; the pass goes on
                why = f"{type(exc).__name__}: {str(exc)[:160]}"
                log.warning("sms ears: a text could not be heard (%s)", type(exc).__name__)
            if why is not None:
                if (now - t["sent_at"]).total_seconds() < HOLD_H * 3600:
                    held_phones.add(phone)
                    said["waiting"] += 1
                    said["why"] = said["why"] or why
                    continue
                row = {**_base(t), "word": read_text(t["text"])["word"],
                       "outcome": UNHEARD, "code": "unreadable",
                       "why": f"it could not be heard for {HOLD_H:g} hours — {why}"}
            if _record(dsn, row):
                said["heard"] += 1
                said["outcomes"][row["outcome"]] = said["outcomes"].get(row["outcome"], 0) + 1
                if row["outcome"] in ACTED:
                    said["acted"] += 1
    return said


# the house managers' list — every text and what it came to

def _exists(cur) -> bool:
    cur.execute("SELECT to_regclass('asa_sms_replies') IS NOT NULL")
    return bool((cur.fetchone() or [False])[0])


def _ack_state(r: dict[str, Any], now: datetime) -> str:
    """said | opted_out | rehearsal | not_sent | expired | waiting; only `said` reached the person."""
    said = r.get("said") if isinstance(r.get("said"), dict) else {}
    ack = str(r.get("ack") or "")
    if not ack:
        return ""
    entry = said.get(ack)
    if isinstance(entry, str):
        return "said"
    if isinstance(entry, dict):
        state = str(entry.get("state") or "")
        if state in ("told", "duplicate"):
            return "said"
        if state == "opted_out":
            return "opted_out"
    if "expired" in said:
        return "expired"
    heard = r.get("heard_at")
    if isinstance(heard, datetime) and now - heard > timedelta(hours=ACK_KEEP_H):
        return "expired"
    if isinstance(entry, dict):
        return "rehearsal" if str(entry.get("state") or "") in shift_handoff.REHEARSAL \
            else "not_sent"
    return "waiting"


def _ack_note(r: dict[str, Any]) -> str:
    said = r.get("said") if isinstance(r.get("said"), dict) else {}
    if "expired" in said:
        return str(said.get("expired") or "")
    entry = said.get(str(r.get("ack") or ""))
    if isinstance(entry, dict) and str(entry.get("state") or "") not in ("told", "duplicate"):
        why = str(entry.get("why") or "").strip()
        state = str(entry.get("state") or "")
        dial = str(entry.get("dial") or "")
        return why or (f"{state}" + (f" (dial {dial})" if dial else ""))
    return ""


def replies(dsn: str, *, mine: Callable[[Any], bool], everywhere: bool,
            now: datetime | None = None) -> dict[str, Any]:
    """The Texts panel, newest first; an unreadable ledger raises, a missing one is empty."""
    now = now or _now()
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT to_regclass('asa_sms_replies') IS NOT NULL AS here")
        if not (cur.fetchone() or {}).get("here"):
            return {"readable": True, "why": "", "rows": []}
        cur.execute("SELECT * FROM asa_sms_replies WHERE sent_at > %s "
                    "ORDER BY sent_at DESC LIMIT %s",
                    (now - timedelta(days=PANEL_DAYS), PANEL_LIMIT))
        got = [dict(r) for r in cur.fetchall()]
    out = []
    for r in got:
        cands = r.get("candidates") if isinstance(r.get("candidates"), list) else []
        places = [str(r.get("location") or "")] if r.get("location") else \
            [str(c.get("location") or "") for c in cands if c.get("location")]
        if places:
            if not any(mine(loc) for loc in places):
                continue
        elif not everywhere:
            continue
        out.append({
            "id": r["id"], "at": _iso(r.get("sent_at")), "heard_at": _iso(r.get("heard_at")),
            "line": str(r.get("line") or "")[-4:], "person": r.get("person") or "",
            "sender": r.get("sender") or "", "phone_tail": r.get("phone_tail") or "",
            "word": r.get("word") or "", "words": r.get("words") or "",
            "outcome": r.get("outcome") or "", "road": r.get("road") or "",
            "code": r.get("code") or "", "why": r.get("why") or "",
            "location": r.get("location") or "",
            "house": shift_requests.short_house(str(r.get("location") or ""))
            if r.get("location") else "",
            "col_iso": r.get("col_iso") or "", "value": r.get("value") or "",
            "ref": r.get("ref") or "", "request_id": r.get("request_id") or "",
            "handoff_id": r.get("handoff_id") or "", "candidates": cands,
            "ack": r.get("ack") or "", "ack_state": _ack_state(r, now),
            "ack_note": _ack_note(r),
            # THE MARK: a line the staff-answers rehearsal wrote is never read as the person's own
            "rehearsal": bool(r.get("rehearsal"))})
    return {"readable": True, "why": "", "rows": out}


# what the message door is owed — the acknowledgements

_ACK_PAUSE: dict[str, float] = {"until": 0.0}
_DOOR_UNKNOWN = "not a row this door knows"


def _still_true(r: dict[str, Any], now: datetime, *, pool_by_ref: dict[str, dict[str, Any]],
                dsn: str) -> tuple[bool, str]:
    span = shift_requests.span_of(str(r.get("col_iso") or ""), str(r.get("value") or ""))
    if span and now >= span[0]:
        return False, "the shift had already started"
    ack = str(r.get("ack") or "")
    if ack == ACK_APPLIED:
        req = shift_requests.request_row(dsn, str(r.get("request_id") or "")) \
            if r.get("request_id") else None
        if not req or req.get("state") not in shift_requests.LIVE_STATES:
            return False, "the application was no longer open"
    if ack == ACK_UNCLEAR:
        cands = r.get("candidates") if isinstance(r.get("candidates"), list) else []
        # a punch warning is no pool row: whether it still waits is punch_ack_true's to say
        cands = [c for c in cands if isinstance(c, dict) and c.get("road") != ROAD_PUNCH]
        if cands:
            open_any = False
            for c in cands:
                if c.get("road") == ROAD_HANDOFF:
                    h = shift_handoff.handoff(dsn, str(c.get("handoff_id") or ""))
                    open_any = open_any or bool(h and h.get("state") == shift_handoff.PENDING)
                elif c.get("road") == ROAD_SHIFT_ASK:
                    at = psi_reminders._instant(c.get("shift_at"))
                    open_any = open_any or bool(at and at > now)
                else:
                    s = pool_by_ref.get(str(c.get("ref") or ""))
                    open_any = open_any or bool(s and not s.get("filled_by")
                                                and s["window"]["state"] == shift_requests.WINDOW_OPEN)
            if not open_any:
                return False, "nothing the text could have meant was still open"
    return True, ""


def punch_ack_true(ack: str, found: list[dict[str, Any]], now: datetime) -> tuple[bool, str]:
    """(still true, why not) of a punch acknowledgement, against the warnings it speaks of AS THEY STAND NOW — a…"""
    if not found:
        return True, ""

    def ended(w: dict[str, Any]) -> bool:
        end = punch_pairs._instant(w.get("shift_end"))
        return end is not None and now >= end

    w = found[0]
    state = str(w.get("state") or "")
    if ack == ACK_PUNCH[punch_pairs.ACK_WAITING]:
        if state != punch_pairs.RECEIVED or str(w.get("call_off_ref") or ""):
            return False, (f"the warning it answers is now {state or 'gone'} - what it came to is "
                           "said on its own")
        if ended(w):
            return False, "the shift had ended"
    elif ack == ACK_PUNCH[punch_pairs.ACK_OPENED]:
        if state != punch_pairs.CONVERTED:
            return False, f"the warning it answers is now {state or 'gone'}, not an open shift"
        if ended(w):
            return False, "the shift had ended, and its open shift with it"
    elif ack == ACK_UNCLEAR:
        if not any(str(x.get("state") or "") == punch_pairs.WARNED and not ended(x) for x in found):
            return False, "no warning it named still waits for an answer"
    elif ack == ACK_REFUSED:
        if all(ended(x) for x in found):
            return False, "the shift had ended"
    return True, ""


def _punch_refs(r: dict[str, Any]) -> list[str]:
    """The warnings a punch reply speaks of: its ref, or the refs its reason names."""
    ref = str(r.get("ref") or "").strip().upper()
    if ref:
        return [ref]
    return sorted(set(punch_pairs.REF_RE.findall(str(r.get("ack_why") or "").upper())))


def door_row(r: dict[str, Any], warning: dict[str, Any] | None = None) -> dict[str, Any]:
    """One acknowledgement row for staffShiftReminder; `reply` never names the caller."""
    if str(r.get("ack") or "") in ACK_PUNCH_KINDS:
        w = warning or {}
        return {"id": f"{ACK_ID_PREFIX}{r['id']}:{r['ack']}", "kind": r["ack"],
                "person": r.get("person") or "", "staff": str(w.get("person") or ""),
                "house": str(w.get("house") or ""), "house_name": str(w.get("house_name") or ""),
                "shift_at": _iso(w.get("shift_at")), "shift_code": str(w.get("shift_code") or ""),
                "value": str(w.get("shift_code") or ""), "day": str(w.get("day") or ""),
                "col_iso": str(w.get("day") or ""), "ref": r.get("ref") or "",
                "call_off_ref": str(w.get("call_off_ref") or ""), "why": r.get("ack_why") or "",
                "mail": False}
    location = str(r.get("location") or "")
    span = shift_requests.span_of(str(r.get("col_iso") or ""), str(r.get("value") or ""))
    return {"id": f"{ACK_ID_PREFIX}{r['id']}:{r['ack']}", "kind": r["ack"],
            "person": r.get("person") or "",
            "house": (house_directory.code_of(location) or "") if location else "",
            "house_name": shift_requests.short_house(location) if location else "",
            "shift_at": span[0].isoformat() if span else "",
            "shift_code": r.get("value") or "", "value": r.get("value") or "",
            "col_iso": r.get("col_iso") or "", "day": r.get("col_iso") or "",
            "ref": r.get("ref") or r.get("handoff_id") or "",
            "handoff_id": r.get("handoff_id") or "", "reply": r.get("ack_why") or ""}


def owed(dsn: str, *, now: datetime | None = None, limit: int = 20) -> list[dict[str, Any]]:
    """The acknowledgements owed now; none in the quiet window; untrue ones expire."""
    now = now or _now()
    if psi_reminders.quiet(now) or time.time() < _ACK_PAUSE["until"]:
        return []
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT to_regclass('asa_sms_replies') IS NOT NULL AS here")
        if not (cur.fetchone() or {}).get("here"):
            return []
        cur.execute("SELECT * FROM asa_sms_replies WHERE ack <> '' AND person <> '' "
                    "AND NOT (said ? 'expired') AND heard_at > %s "
                    "AND NOT (said ? ack AND (jsonb_typeof(said->ack) <> 'object' "
                    "OR said->ack->>'state' IN ('told', 'duplicate', 'opted_out'))) "
                    "ORDER BY sent_at LIMIT 100", (now - timedelta(hours=ACK_KEEP_H),))
        rows = [dict(r) for r in cur.fetchall()]
    # a line the rehearsal wrote is owed no acknowledgement outside the rehearsal's sandbox
    rehearsed = shift_requests.messages_rehearsed()
    rows = [r for r in rows if (rehearsed or not r.get("rehearsal")) and shift_handoff._owed_again(
        (r.get("said") if isinstance(r.get("said"), dict) else {}).get(str(r.get("ack") or "")),
        now)]
    if not rows:
        return []
    pool_by_ref: dict[str, dict[str, Any]] = {}
    if any(r.get("ack") == ACK_UNCLEAR for r in rows):
        pool_by_ref = {s["ref"]: s for s in shift_requests.pool(dsn, now=now)}
    out, expired = [], []
    for r in rows:
        ok, why = _still_true(r, now, pool_by_ref=pool_by_ref, dsn=dsn)
        if not ok:
            expired.append((r["id"], why))
            continue
        warning = None
        ack = str(r.get("ack") or "")
        if ack in ACK_PUNCH_KINDS or str(r.get("road") or "") == ROAD_PUNCH:
            # THE SHIFT AND THE CALL OFF'S REF, FROM THE WARNING ITSELF, AND WHETHER WHAT THE ACKNOWLEDGEMENT SAYS…
            refs = _punch_refs(r)
            try:
                found = [punch_pairs.warning_by_ref(dsn, x) for x in refs]
            except Exception as exc:  # noqa: BLE001
                log.warning("sms ears: the punch warning %s could not be read (%s) — its "
                            "acknowledgement waits", ", ".join(refs), type(exc).__name__)
                continue
            if ack in ACK_PUNCH_KINDS and (not found or found[0] is None):
                expired.append((r["id"], "the punch warning it answers is no longer on file"))
                continue
            ok, why = punch_ack_true(ack, [w for w in found if w], now)
            if not ok:
                expired.append((r["id"], why))
                continue
            if ack in ACK_PUNCH_KINDS:
                warning = found[0]
        out.append(door_row(r, warning))
        if len(out) >= limit:
            break
    if expired:
        with _connect(dsn) as conn, conn.cursor() as cur:
            for rid, why in expired:
                cur.execute("UPDATE asa_sms_replies SET said = said || jsonb_build_object("
                            "'expired', %s::text) WHERE id=%s", (why, rid))
            conn.commit()
    return out


# THE SITUATION ITSELF HELD IT — switched off, or with no words — said by the door's code alone.
ACK_SITUATION_HELD = frozenset({"situation_off", "no_words"})


def mark_said(dsn: str, ids: list[str], results: dict[str, Any]) -> int:
    """Records the door's answers as shift_handoff.mark_said does; "not now" and unknown rows stay owed."""
    by_id = {str(r.get("id")): (str(r.get("state") or ""), str(r.get("why") or ""))
             for r in (results.get("results") or []) if isinstance(r, dict)}
    codes = {str(r.get("id")): str(r.get("code") or "")
             for r in (results.get("results") or []) if isinstance(r, dict)}
    dial = str(results.get("dial") or "")
    test_mode = str(results.get("test_mode") or "")
    shift_handoff.note_dial(dial, test_mode)
    if ids and not by_id:
        # AN ANSWER WITH NO WORD PER ROW SAYS NOTHING WAS SAID: "ok" is not "sent".
        _ACK_PAUSE["until"] = time.time() + ACK_UNKNOWN_PAUSE_S
        log.warning("sms ears: the door answered without a result per row — nothing is written "
                    "down, asked again in %ss", round(ACK_UNKNOWN_PAUSE_S))
        return 0
    done = unknown = 0
    with _connect(dsn) as conn, conn.cursor() as cur:
        for key in ids:
            body = str(key)[len(ACK_ID_PREFIX):] if str(key).startswith(ACK_ID_PREFIX) else ""
            mid, _, kind = body.rpartition(":")
            if not mid or kind not in ACK_KINDS:
                continue
            if str(key) not in by_id:
                continue
            state, why = by_id[str(key)]
            state = state or "failed"
            if state in shift_handoff.NOT_NOW:
                continue
            if state == "refused" and why.startswith(_DOOR_UNKNOWN):
                unknown += 1
                continue
            entry = {"state": state, "why": why[:300], "at": _iso(_now()), "dial": dial,
                     "test_mode": test_mode}
            cur.execute("UPDATE asa_sms_replies SET said = said || jsonb_build_object(%s, "
                        "%s::jsonb) WHERE id=%s", (kind, json.dumps(entry), mid))
            done += cur.rowcount
            if state == "held" and codes.get(str(key)) in ACK_SITUATION_HELD:
                cur.execute("UPDATE asa_sms_replies SET said = said || jsonb_build_object("
                            "'expired', %s::text) WHERE id=%s",
                            (f"its situation held it when it was due ({why[:160] or 'switched off'}) "
                             "- switched off, an acknowledgement is not sent later", mid))
        conn.commit()
    if ids and unknown == len(ids):
        _ACK_PAUSE["until"] = time.time() + ACK_UNKNOWN_PAUSE_S
        log.warning("sms ears: the door does not know the acknowledgement situations yet — "
                    "nothing was said, asked again in %ss", round(ACK_UNKNOWN_PAUSE_S))
    return done
