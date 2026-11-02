"""Smart Comms' one send home: smartTell_ and rpcCall_ decided in a door's transaction, the provider reached by the drain."""
from __future__ import annotations

import asyncio
import contextlib
import contextvars
import hashlib
import json
import logging
import os
import random
import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterator

import comm_logs
import editions
import gsjs
import hubdb
import writes as W
from gsjs import NY

log = logging.getLogger("asa-hub-app")
if comm_logs.void not in W.VOID_HOOKS:
    W.VOID_HOOKS.append(comm_logs.void)

APP_ID = "smart-comms"
OUTBOX = "app.smart_comms_outbox"
ARM = "app.smart_comms_arm"
AUTHOR = "Smart Comms"

SITUATIONS_TAB = "smart_comms"
LEDGER_TAB = "smart_comms_sent"
OPT_OUT_TAB = "entity_opt_outs"
MOCK_TAB = "comm_mock"
REHEARSAL_TAB = "comm_rehearsal"

# the situations only Python's doors raise: appended to the situations tab when it holds no row of them (smartSheet_'s
# missing ids, kept in app.edits), the Desk's to word and switch from then on
SEEDS: tuple[dict[str, str], ...] = (
    {"id": "time_off_told_approved", "enabled": "yes", "channels": "sms",
     "label": "your time off request was approved (sent from My Work)",
     "sms_text": "Hi {first_name}, your time off request for {dates} was approved. For more details, contact your "
                 "director. - {sender}",
     "note": "My Work › Time off approval › Send Message Approved. Fills {first_name} {dates} {sender}."},
    {"id": "time_off_told_not_approved", "enabled": "yes", "channels": "sms",
     "label": "your time off request was not approved (sent from My Work)",
     "sms_text": "Hi {first_name}, your time off request for {dates} was not approved. For more details, contact your "
                 "director. - {sender}",
     "note": "My Work › Time off approval › Send Message Not Approved. Fills {first_name} {dates} {sender}."},
    {"id": "sched_drag_moved", "enabled": "yes", "channels": "sms",
     "label": "your shift was moved on the calendar (House Calendars drag and drop)",
     "sms_text": "Schedule change at {house}: {change} Changed by {by}. Details in My Work on the Hub: {link} - {sender}",
     "note": "Scheduling › House Calendars, when a house manager or above drags a shift onto another cell: TO EACH "
             "PERSON WHOSE SHIFTS CHANGED, at once, auto-approved. Said by the Scheduling clock, held inside 21:31-07:59 "
             "and said at 08:00. Fills {house} {date} {day_word} {time} {shift} {location} {by} {change} {link} "
             "{sender}; {change} is that person's own change in one sentence."},
    {"id": "sched_open_assigned", "enabled": "yes", "channels": "sms",
     "label": "you are on the schedule for an open shift (House Calendars drag and drop)",
     "sms_text": "You are on the schedule for an open shift: {house} {date} {shift}. Assigned by {by}. Details in My "
                 "Work on the Hub: {link} - {sender}",
     "note": "Scheduling › House Calendars, when a house manager or above drags an OPEN shift onto somebody's row: TO "
             "THE PERSON GIVEN IT. Said by the Scheduling clock, held inside 21:31-07:59 and said at 08:00. Fills "
             "{house} {date} {day_word} {time} {shift} {location} {by} {change} {link} {sender}."},
    {"id": "platform_mail_by_hand", "enabled": "yes", "channels": "email",
     "label": "a letter written by hand in the Mail app",
     "email_subject": "{subject}", "email_text": "{body}",
     "note": "Mail › Compose. The letter's own words leave as written, from the mailbox the person chose; the quiet "
             "window does not hold a person writing by hand."},
    {"id": "email_design_preview", "enabled": "yes", "channels": "email",
     "label": "one of the platform's letter designs, sent to the person who asked for it (Email Designs)",
     "email_subject": "{subject}", "email_text": "{body}",
     "note": "Email Designs › Send me this one. The design's own subject, text and HTML, to the address of the person "
             "pressing; the quiet window does not hold a person who just asked."},
    {"id": "platform_member_ask", "enabled": "yes", "channels": "email",
     "label": "a platform owner asks to bring a person's account into their workspace (Settings › Platform users)",
     "email_subject": "{owner_name} is asking to bring your account into their workspace",
     "email_text": "{greeting} {owner_name} is asking to bring your account into their workspace on the ASA platform, "
                   "temporarily.\n\nReply to this e-mail with one word:\n"
                   "  WORK — they see the work registered under your name (cards, notes, activity)\n"
                   "  BOTH — your work AND your My world workbook\n"
                   "  NO   — nothing is shared\n\n"
                   "Whatever you choose it is READ-ONLY: nobody writes in your name, your password is never shared, "
                   "and you can end it any time by replying STOP.\n\nIf you do not answer, nothing is shared.",
     "note": "Settings › Platform users › Ask. Fills {greeting} {owner_name} "
             "{name}; the letter's own HTML leaves beside these words. The reply sweep reads WORK, BOTH or NO."},
)
SEED_DOOR = "smartCommsSeed"
# SmartComms.gs SMART_SENDER_DEFAULT, SMART_LEAD_KEY
SENDER_DEFAULT = "the admin team from ASA LifeCare"
LEAD_KEY = "@lead"
# Talent.gs SHARED_LINE_DIGITS
SHARED_LINE_DIGITS = ("3307544040", "3309195558", "3309195559")
# Comms.gs COMMS_OPERATOR_LINE_DIGITS: the line the texts leave from, never a team copy's destination
OPERATOR_LINE_DIGITS = "3309195558"
# Rpc.gs HUB_QUIET_FROM / HUB_QUIET_TO / HUB_QUIET_TZ
QUIET_FROM, QUIET_TO = "21:31", "08:00"
QUIET_TZ = "America/New_York"
# AlertsConfig.gs HUB_TEST_MODE_ON_WORDS / _OFF_WORDS, Rpc.gs HUB_REHEARSAL_WORDS
TEST_ON = ("on", "true", "1", "test")
TEST_OFF = ("off", "false", "0", "production")
TEST_SHEET = ("sheet", "rehearsal", "paper")
PAUSE_ON = ("on", "true", "1", "yes")
PAUSE_OFF = ("off", "false", "0", "no")
SEND_ON = ("on", "true", "1")
# SmartComms.gs SMART_EXTRA_SITUATIONS_SEED: the ids whose seed spells sms_text blank
SEED_BLANK_SMS = frozenset({"shift_login_missing_mail"})
GENERIC_SEED = (
    "Hi {first_name}, this is {sender}. Your {credential} expires on {expires} ({days_left} days). Please renew it and "
    "upload the new certificate to our document portal.",
    "Your {credential} expires on {expires}",
    "Hi {first_name},\n\nYour {credential} expires on {expires} ({days_left} days).\n\nPlease renew it and upload the "
    "new certificate to our document portal.\n\n{sender}")
# the seed's record_to, answered while a row's cell is blank (commMockRecordTo_)
SEED_RECORD_TO = {"ist_due": "ist_notices", "pattern_scan_daily": "pattern_scan"}

MOCK_HEADER = ("id", "createdAt", "updatedAt", "at", "day", "hour", "pass_id", "seq", "situation", "purpose", "method",
               "send_at", "person_name", "to_masked", "audience", "channel", "subject", "body", "body_chars", "result",
               "held_by", "reason", "dial", "test_mode", "send_switch", "ledger_key", "tenant")
REHEARSAL_HEADER = ("id", "createdAt", "updatedAt", "pass_id", "pass_at", "pass_by", "seq", "intent_key", "person_key",
                    "person_name", "channel", "to_masked", "redirected", "redirect_to_masked", "situation", "purpose",
                    "words_sha", "sender_used", "from_account", "subject", "body", "body_chars", "would_have_sent",
                    "verdict", "reasons", "consent", "window", "attempt", "dial", "at", "test_mode", "tenant")
LEDGER_HEADER = ("key", "situation", "person", "expires", "channel", "at")
LEDGER_MATCH = "cols:key|at"

QUIET_WORDS = f"{QUIET_FROM}–07:59 New York"
QUIET_DETAIL = (f"Inside the quiet window ({QUIET_WORDS}): nothing reaches a person now. Ask again at {QUIET_TO}, "
                "and say it then only if it is still true.")
DEDUP_DETAIL = "This exact request was already made — not sent again."
REHEARSED_DETAIL = f"The dial is at the sheet: this message was written into {REHEARSAL_TAB} and sent to nobody."
REHEARSAL_LOST = ("The dial is at the sheet: nothing was sent, and the row could NOT be written — the words of this "
                  "message are lost.")
SWITCH_OFF = "HUB_RPC_SEND is off"
NOT_ARMED = "the Python sender is not armed (no app.smart_comms_arm row says on)"

# outbox states: the claim states hold a key for good; the others are proof
CLAIMS = ("owed", "sending", "sent", "unknown")
STATES = CLAIMS + ("held", "refused", "already", "failed", "off", "no_phone", "cancelled", "void")
# a door's owed text waits this long so a write the relay voids is withdrawn before it can leave
VOID_GRACE_S = float(os.getenv("HUB_SMART_COMMS_VOID_GRACE_S", "20"))
SENDING_STALE_S = 600.0
DRAIN_LOCK = 0x534D434F4D53
DRAIN_BATCH = 25
IDLE_S = 3600.0
QUIET_MEMO_S = 21600.0

PROVIDER = "https://api.openphone.com/v1"
KEY_FILE_ENV = "HUB_SMART_COMMS_KEY_FILE"
DEFAULT_LINE = "Automations"
PROVIDER_TIMEOUT_S = 20.0
# PlatformMail.gs PLATFORM_MAIL_FROM_NAME: the name the platform's own mailbox signs with
MAIL_FROM_NAME = "ASA MyLife"
# LineDirectory.gs LINE_ROLE_WORDS
LINE_ROLE_WORDS = {"3307544040": "Manager", "3309195558": "Software Specialist", "3309195559": "Administration",
                   "3309197595": "HR-Administration", "3309197779": "Director", "9377166410": "Director"}

# JavaScript's \s and trim() as a regex class body; \w is ASCII
_JS_WS = ("\t\n\x0b\x0c\r \xa0" + "".join(map(chr, (0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF)))
          + chr(0x2000) + "-" + chr(0x200A))
_PLACEHOLDER = re.compile(r"\{([A-Za-z0-9_]+)\}")
_PART = re.compile(r"[^.!?]+[.!?]*[" + _JS_WS + r"]*")
_FROM_LANE = re.compile(r"(?:smart comms(?: cc| digest| event)?|comms|smart comms event)[" + _JS_WS + r"]*:["
                        + _JS_WS + r"]*([A-Za-z0-9_\-]+)")
_FROM_TAIL = re.compile(r":[" + _JS_WS + r"]*([A-Za-z0-9_\-]+)[" + _JS_WS + r"]*\Z")
_JS_NUM = re.compile(r"^[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|Infinity)$")
_OPT_OUT_UNREAD = re.compile(r"opt-out list could not be (read|checked)", re.I)
# what Object.prototype answers for a placeholder no var names
_PROTO = {k: f"function {k}() {{ [native code] }}" for k in (
    "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "toString", "valueOf",
    "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__")}
_PROTO["constructor"] = "function Object() { [native code] }"
_PROTO["__proto__"] = "[object Object]"
# a credential already past its day: the words a reminder says it in, never a negative count ("(-40 days)",
# "about to expire in -88 days"); {days_ago} is how long ago it expired
_PAST_DUE = (
    (re.compile(r"\bexpires on (\{expires\}) \(\{days_left\} days?\)", re.I), r"expired on \1 ({days_ago} days ago)"),
    (re.compile(r"\b(?:is )?about to expire in \{days_left\} days?", re.I), "expired {days_ago} days ago"),
    (re.compile(r"\b(?:will )?expires? in \{days_left\} days?", re.I), "expired {days_ago} days ago"),
    (re.compile(r"\(\{days_left\} days?\)"), "({days_ago} days ago)"),
    (re.compile(r"\bin \{days_left\} days?", re.I), "{days_ago} days ago"),
    (re.compile(r"\{days_left\} days? left", re.I), "expired {days_ago} days ago"),
)


def past_due(tpl: str, v: dict) -> tuple[str, dict]:
    """A template and its vars for a credential already past its day: each phrase of {days_left} said as how long ago
    it expired, {days_ago} given; any other template, or a day still ahead, as it is."""
    try:
        left = int(float(gsjs.js_str(v.get("days_left"))))
    except (TypeError, ValueError):
        return tpl, v
    if left >= 0 or "{days_left}" not in tpl:
        return tpl, v
    for rx, to in _PAST_DUE:
        tpl = rx.sub(to, tpl)
    return tpl, {**v, "days_ago": str(-left)}

_DB: hubdb.HubDb | None = None
# the write a door is deciding in: {"tx", "write_id", "door"}, set by main.py around the door's decision
_WRITE: contextvars.ContextVar[dict | None] = contextvars.ContextVar("smart_comms_write", default=None)
_KICK = threading.Event()
_STOP = threading.Event()
_PENDING: list[float] = []
_PENDING_LOCK = threading.Lock()


def bind(db: hubdb.HubDb) -> None:
    """The reader raise_situation and drain use when a call names none (main.py's DB)."""
    global _DB
    _DB = db


@contextlib.contextmanager
def deciding(tx: Any, write_id: str, door: str) -> Iterator[None]:
    """The write a door decides in: raise_situation(None, …) inside it raises in that transaction, under that write."""
    token = _WRITE.set({"tx": tx, "write_id": write_id, "door": door})
    try:
        yield
    finally:
        _WRITE.reset(token)


def write_id() -> str:
    """The write the door being decided runs under (deciding); '' outside one."""
    return str((_WRITE.get() or {}).get("write_id") or "")


def _reader(db: Any) -> Any:
    global _DB
    if db is not None:
        return db
    if _DB is None:
        _DB = hubdb.HubDb()
    return _DB


# ---- JavaScript's view of a value ----------------------------------------------------------------------------------

def _len16(s: str) -> int:
    """String.prototype.length: UTF-16 code units."""
    return len(s.encode("utf-16-le")) // 2


def _cut16(s: str, n: int) -> str:
    """s.slice(0, n) in UTF-16 units; a pair the cut would split is left out whole."""
    if _len16(s) <= n:
        return s
    out, used = [], 0
    for ch in s:
        w = 2 if ord(ch) > 0xFFFF else 1
        if used + w > n:
            break
        out.append(ch)
        used += w
    return "".join(out)


def _truthy(v: Any) -> bool:
    return not gsjs.falsy(v)


def _number(v: Any) -> float | None:
    """Number(v) for what a door hands as at_ms; None for NaN."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return None if v != v else float(v)
    s = gsjs.trim(gsjs.or_blank(v))
    if not s:
        return 0.0
    if not _JS_NUM.match(s):
        return None
    return float(s.replace("Infinity", "inf"))


# ---- the words -----------------------------------------------------------------------------------------------------

def smart_list(raw: Any) -> list[str]:
    """smartList_."""
    return [x for x in (gsjs.trim(p) for p in re.split(r"[,;|\n]+", gsjs.or_text(raw))) if x]


def smart_on(v: Any) -> bool:
    """smartOn_."""
    return gsjs.trim(gsjs.or_text(v)).lower() in ("yes", "true", "on", "1")


def render(tpl: Any, vars: dict | None) -> str:
    """smartRender_: {placeholder} filled when its value is neither undefined nor ''; a lead line when named."""
    v = vars if isinstance(vars, dict) else {}

    def sub(m: re.Match) -> str:
        k = m.group(1)
        if k in v:
            val = v[k]
            return m.group(0) if isinstance(val, str) and val == "" else gsjs.js_str(val)
        return _PROTO.get(k, m.group(0))

    # an expired credential's days said as how long ago (the template itself stays the one the lead line is matched by)
    words, v = past_due(gsjs.or_text(tpl), v)
    out = _PLACEHOLDER.sub(sub, words)
    lead = v.get(LEAD_KEY)
    if not _truthy(lead) or not _truthy(tpl):
        return out
    t = gsjs.js_str(tpl)

    def said(name: str) -> str:
        return gsjs.or_text(lead.get(name) if isinstance(lead, dict) else None)

    if t == said("subject_tpl"):
        return out
    line = ""
    if t == said("sms_tpl"):
        line = said("line_sms")
    elif t == said("email_tpl"):
        line = said("line_email")
    if not line or not out:
        return out
    if isinstance(lead, dict):
        lead["used"] = "sms" if t == said("sms_tpl") else "email"
    return line + "\n\n" + out


def prune(text: Any) -> str:
    """smartPruneUnfilled_: each sentence still holding a placeholder dropped, then every empty line."""
    kept = []
    for line in gsjs.or_text(text).split("\n"):
        if _PLACEHOLDER.search(line):
            parts = _PART.findall(line) or [line]
            line = gsjs.trim("".join(p for p in parts if not _PLACEHOLDER.search(p)))
        if line != "":
            kept.append(line)
    return "\n".join(kept)


def prune_letter(text: Any) -> str:
    """An e-mail's words with each sentence still holding a placeholder dropped — a value nothing had is left out,
    never shown to a person as a brace — and a line it empties gone, the paragraphs one blank line apart as written.
    Words with no placeholder left are handed back untouched."""
    words = gsjs.or_text(text)
    if not _PLACEHOLDER.search(words):
        return words
    kept = []
    for line in words.split("\n"):
        if _PLACEHOLDER.search(line):
            parts = _PART.findall(line) or [line]
            line = gsjs.trim("".join(p for p in parts if not _PLACEHOLDER.search(p)))
            if line == "":
                continue
        kept.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip("\n")


def letter_subject(text: Any) -> str:
    """An e-mail's subject with a placeholder nothing filled left out, never shown as a brace."""
    return re.sub(r"[ \t]{2,}", " ", _PLACEHOLDER.sub("", gsjs.or_text(text))).strip()


def sendable(raw: Any) -> str:
    """packetSendableNumber_: +1 and ten digits, never one of the company's shared lines."""
    d = re.sub(r"^1", "", re.sub(r"[^0-9]", "", gsjs.or_text(raw)), count=1)
    if len(d) != 10 or d in SHARED_LINE_DIGITS:
        return ""
    return "+1" + d


def letter_to(raw: Any) -> str:
    """One address a letter may go to, lower-cased; a list or anything else is none."""
    s = gsjs.trim(gsjs.or_text(raw)).lower()
    return s if re.fullmatch(r"[^@\s,;<>\"]+@[^@\s,;<>\"]+\.[a-z]{2,}", s) else ""


def group_line(raw: Any) -> str:
    """The 5558 group's own line (commCallOffDirectorsAudience_): +1 and ten digits, the shared line it is."""
    d = re.sub(r"^1", "", re.sub(r"[^0-9]", "", gsjs.or_text(raw)), count=1)
    return "+1" + d if len(d) == 10 else ""


def team_copy(raw: Any) -> str:
    """packetTeamCopyNumber_: +1 and ten digits, a shared team line too — never the line the texts leave from."""
    d = re.sub(r"^1", "", re.sub(r"[^0-9]", "", gsjs.or_text(raw)), count=1)
    if len(d) != 10 or d == OPERATOR_LINE_DIGITS:
        return ""
    return "+1" + d


def _fold(text: Any) -> str:
    return re.sub(r"[" + _JS_WS + r"]+", " ", gsjs.or_blank(text)).strip(gsjs._TRIM).lower()


def unwritten_words(db: Any, sit: dict, field: str) -> bool:
    """smartUnwrittenWords_: a cell the seed spells blank that holds the planted credential letter."""
    value = gsjs.trim(gsjs.or_text(sit.get(field)))
    if not value or gsjs.or_text(sit.get("id")) not in SEED_BLANK_SMS or field != "sms_text":
        return False
    planted = list(GENERIC_SEED)
    try:
        seen = json.loads(_prop(db, "SMART_GENERIC_SEEN") or "[]")
        planted += [gsjs.or_blank(x) for x in seen] if isinstance(seen, list) else []
    except Exception:  # noqa: BLE001 - the seed's own letter still stands
        pass
    want = _fold(value)
    return any(p and _fold(p) == want for p in planted)


# ---- the clock -----------------------------------------------------------------------------------------------------

def quiet_at(at_s: float | None) -> bool:
    """hubQuietAt_ on New York wall time; a clock that cannot be read is quiet."""
    if at_s is None or gsjs.ZoneInfo is None:
        return True
    try:
        hm = datetime.fromtimestamp(at_s, tz=NY).strftime("%H:%M")
    except (OverflowError, OSError, ValueError):
        return True
    if QUIET_FROM <= QUIET_TO:
        return QUIET_FROM <= hm < QUIET_TO
    return hm >= QUIET_FROM or hm < QUIET_TO


def quiet_end(at_s: float) -> float:
    """The first 08:00 New York after this instant."""
    try:
        local = datetime.fromtimestamp(at_s, tz=NY)
        h, m = (int(x) for x in QUIET_TO.split(":"))
        end = local.replace(hour=h, minute=m, second=0, microsecond=0)
        if end <= local:
            end = (local + timedelta(days=1)).replace(hour=h, minute=m, second=0, microsecond=0)
        return end.timestamp()
    except (OverflowError, OSError, ValueError):
        return at_s + 3600.0


def _caller_clock(at_ms: Any, now: float) -> float | None:
    """The instant smartTell_ asks the window about: the caller's at_ms, else now; None when it is no instant."""
    if not _truthy(at_ms):
        return now
    n = _number(at_ms)
    if n is None or abs(n) > 8.64e15:
        return None
    return n / 1000.0


def iso(at_s: float) -> str:
    return gsjs.iso(datetime.fromtimestamp(at_s, tz=timezone.utc))


# ---- what asa-hub-db holds -----------------------------------------------------------------------------------------

@contextlib.contextmanager
def _unnoted() -> Iterator[None]:
    """Smart Comms' reads never join a door's freshness set."""
    token = hubdb.READ_BOOKS.set(None)
    try:
        yield
    finally:
        hubdb.READ_BOOKS.reset(token)


def _cell(v: Any) -> str:
    """String(getValues() cell)."""
    t = hubdb.typed(v, "hub")
    return "" if t is None else gsjs.js_str(t)


def read_situations(db: Any) -> list[dict]:
    """smartSituations_ off the live house (its own table once kept there): every row with an id, each cell as its
    text, in sheet order."""
    import house_tables as HT  # noqa: PLC0415 - it imports this module
    import locations as L  # noqa: PLC0415

    if HT.tabled(SITUATIONS_TAB):
        cols, rows = HT.raw(L.Reads(db, None), SITUATIONS_TAB)
        heads = [(h, gsjs.trim(h)) for h in cols]
    else:
        res = db.resolve(SITUATIONS_TAB)
        if res.runtime:
            raise hubdb.Unreadable("the situations tab lives in the depot's facts")
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable("asa-hub-db holds no copy of the situations tab's book")
            return []
        heads = [(h, gsjs.trim(gsjs.js_str(h))) for h in res.ref.headers]
        rows = db.rows(res.ref)
    out = []
    for _rn, raw in rows:
        row = {k: _cell(raw.get(h)) for h, k in heads if k}
        if row.get("id"):
            out.append(row)
    return out


def situation_row(rows: list[dict], sid: str) -> dict | None:
    """The last row whose id is this one (smartSituationOn_'s forEach)."""
    sit = None
    for s in rows:
        if gsjs.str_(s.get("id")) == sid:
            sit = s
    return sit


def situation_from(reason: Any, rows: list[dict] | None) -> str:
    """commMockSituationFrom_."""
    s = gsjs.or_text(reason)
    m = _FROM_LANE.search(s)
    if m:
        return m.group(1)
    tail = _FROM_TAIL.search(s)
    if not tail or rows is None:
        return ""
    want = tail.group(1)
    return want if any(gsjs.or_blank(r.get("id")) == want for r in rows) else ""


def _last_cell(rows: list[dict] | None, sid: str, field: str) -> str:
    got = ""
    for r in rows or ():
        if gsjs.or_blank(r.get("id")) == sid:
            got = gsjs.or_blank(r.get(field))
    return got


def record_to(rows: list[dict] | None, sid: str) -> str:
    """commMockRecordTo_: the row's own house, the seed's while the cell is blank; send/none is no house."""
    if not sid or rows is None:
        return ""
    house = gsjs.trim(_last_cell(rows, sid, "record_to"))
    if not house:
        house = SEED_RECORD_TO.get(sid, "")
    return "" if house.lower() in ("send", "none") else house


def opt_out_key(target: Any) -> str:
    """optOutKey_."""
    s = gsjs.trim(gsjs.or_text(target))
    if not s:
        return ""
    if "@" in s:
        return s.lower()
    d = re.sub(r"[^0-9]", "", s)
    return d[-10:] if len(d) >= 10 else ""


def read_opt_outs(db: Any) -> dict[str, dict]:
    """optOutIndex_: target key → its standing stop; a released row clears the key. The list is Postgres's once the
    opt-outs are kept there (opt_outs), else the copy's."""
    import opt_outs  # noqa: PLC0415 - the list's owner, which reads through this module's neighbours
    by: dict[str, dict] = {}
    for r in opt_outs.opt_out_rows(db):
        key = gsjs.str_(r.get("targetkey")) or opt_out_key(r.get("target"))
        if not key:
            continue
        if gsjs.str_(r.get("releasedat")):
            by.pop(key, None)
            continue
        by[key] = {"at": gsjs.str_(r.get("at")), "phrase": gsjs.str_(r.get("phrase"))}
    return by


def opt_out_blocked(db: Any, to: Any) -> str:
    """optOutBlocked_ for a caller that names no scope: any standing stop blocks, and an unread list refuses."""
    key = opt_out_key(to)
    if not key:
        return ""
    try:
        hit = read_opt_outs(db).get(key)
    except Exception as exc:  # noqa: BLE001 - an unread list is a refusal at the send door
        return f"The opt-out list could not be read: {str(exc)[:160] or type(exc).__name__}"
    if not hit:
        return ""
    return ("This person asked us to stop" + (" on " + hit["at"][:10] if hit["at"] else "")
            + (' ("' + hit["phrase"] + '")' if hit["phrase"] else "") + ".")


def read_config(db: Any) -> dict[str, str]:
    """hiringAlerts_ as Python reads it, its own saves laid over the copy."""
    return editions.laid_config(db, db.hiring_config())


def _prop(db: Any, key: str) -> str:
    """hubdb.prop's depot answer without its environment override: the switchboard's props, then the fact."""
    facts = db.facts()
    got = gsjs.trim(gsjs.or_blank(((facts.get("areas") or {}).get("props") or {}).get(key)))
    return got or gsjs.or_blank((facts.get("subjects") or {}).get(key))


def read_rpc_send(db: Any) -> str:
    """The depot's copy of HUB_RPC_SEND (a switch, never a secret)."""
    return gsjs.trim(_prop(db, "HUB_RPC_SEND")).lower()


def _testers(cfg: dict) -> list[str]:
    """hubTestModeState_'s SMS testers."""
    out: list[str] = []
    for raw in re.split(r"[,;\n]+", gsjs.or_blank(cfg.get("test_redirect_sms"))):
        d = re.sub(r"^1", "", re.sub(r"[^0-9]", "", gsjs.trim(raw)), count=1)
        n = "+1" + d if len(d) == 10 else ""
        if n and n not in out:
            out.append(n)
    return out


def armed(cur: Any) -> bool:
    """The Python arm: its one row says on; no row, no table or no answer is off."""
    try:
        with _guard(cur):
            cur.execute(f"select armed from {ARM} where id = 1")
            got = cur.fetchone()
        return bool(got) and got[0] is True
    except Exception:  # noqa: BLE001 - an arm that cannot be read is off
        return False


def brakes(db: Any, cur: Any) -> dict[str, Any]:
    """Test mode, messages_paused, HUB_RPC_SEND and the arm, each holding unless it plainly says go."""
    b: dict[str, Any] = {"hold": True, "test_why": "", "mock_test_mode": "unreadable", "dial": "off", "testers": [],
                         "rpc_send": False, "paused": True, "paused_why": "", "armed": False}
    try:
        cfg = read_config(db)
        why = ""
    except Exception as exc:  # noqa: BLE001 - an unread switch holds
        cfg, why = None, f"test mode could not be read ({type(exc).__name__})"
    if cfg is None:
        b["test_why"] = why
        b["paused_why"] = "messages_paused could not be read"
    else:
        if "test_mode" not in cfg:
            b["test_why"] = "test_mode is not set in the configuration — held as on until it says on or off"
        else:
            w = gsjs.trim(gsjs.or_blank(cfg.get("test_mode"))).lower()
            if w in TEST_ON or w in TEST_SHEET:
                b.update(mock_test_mode="sheet", dial="record", testers=_testers(cfg))
            elif w in TEST_OFF:
                b.update(hold=False, mock_test_mode="off", dial="send")
            elif not w:
                b["test_why"] = "test_mode is blank — held as on until it says on or off"
            else:
                b["test_why"] = (f'test_mode reads "{w[:40]}", a word the switch does not know (on or off) — held as '
                                 "on until it is saved as one of them")
        if "messages_paused" not in cfg:
            b["paused_why"] = "messages_paused is not set in the configuration"
        else:
            p = gsjs.trim(gsjs.or_blank(cfg.get("messages_paused"))).lower()
            if p in PAUSE_OFF:
                b["paused"] = False
            else:
                b["paused_why"] = "messages_paused is on" if p in PAUSE_ON else \
                    f'messages_paused reads "{p[:40]}", which is not off'
    try:
        b["rpc_send"] = read_rpc_send(db) in SEND_ON
    except Exception:  # noqa: BLE001 - an unread switch is off
        b["rpc_send"] = False
    b["armed"] = armed(cur)
    b["sending"] = b["rpc_send"] and not b["paused"] and b["armed"]
    b["send_detail"] = "" if (not b["rpc_send"] or b["paused"]) else ("" if b["armed"] else NOT_ARMED)
    b["send_why"] = SWITCH_OFF if not b["rpc_send"] else (b["paused_why"] if b["paused"] else
                                                          ("" if b["armed"] else NOT_ARMED))
    return b


# ---- the stores ----------------------------------------------------------------------------------------------------

def _bare(table: str) -> str:
    return table.rpartition(".")[2]


def ddl() -> tuple[str, ...]:
    t, a = OUTBOX, ARM
    claims = ", ".join(f"'{s}'" for s in CLAIMS)
    states = ", ".join(f"'{s}'" for s in STATES)
    return (
        f"create table if not exists {t} ("
        " id bigserial primary key, idem_key text not null default '', situation text not null default '',"
        " to_digits text not null default '', body text not null default '', from_line text not null default '',"
        f" state text not null check (state in ({states})), held_by text not null default '',"
        " why text not null default '', receipt text not null default '', due_at timestamptz,"
        " attempts integer not null default 0, lane text not null default '', door text not null default '',"
        " write_id text not null default '', ask jsonb not null default '{}',"
        " created_at timestamptz not null default now(), updated_at timestamptz not null default now())",
        # the key a send claims, held for good: a repeat answers what it stored, never a second send
        f"create unique index if not exists {_bare(t)}_claim on {t} (idem_key)"
        f" where idem_key <> '' and state in ({claims})",
        f"create index if not exists {_bare(t)}_due on {t} (due_at) where state = 'owed'",
        f"create index if not exists {_bare(t)}_key on {t} (idem_key, id)",
        f"create index if not exists {_bare(t)}_write on {t} (write_id) where write_id <> ''",
        # the look doors ask what the outbox still owes over the read connection (letters, team alerts, IST notices,
        # hiring's holds, the Guardian)
        f"grant select on {t} to asa_hub_app_ro",
        f"create table if not exists {a} ("
        " id smallint primary key default 1 check (id = 1), armed boolean not null default false,"
        " by_whom text not null default '', why text not null default '', at timestamptz not null default now())",
    )


def ensure(conn: Any) -> str:
    """The outbox, the arm, app.edits and the test-mode logs, made when missing by the writer role; '' when ready,
    else why not."""
    try:
        c = _cur(conn)
        for stmt in W.edits_ddl() + ddl() + comm_logs.ddl():
            c.execute(stmt)
        return ""
    except Exception as exc:  # noqa: BLE001 - said on /healthz; nothing is raised meanwhile
        return f"the Smart Comms outbox is not ready ({type(exc).__name__}: {str(exc)[:120]})"


def seed(store: Any, db: Any = None) -> list[str]:
    """The SEEDS neither the situations tab's copy nor app.edits holds, appended under the write lock (made in its own
    table once kept there); their ids."""
    import house_tables as HT  # noqa: PLC0415 - it imports this module
    import resource_rows as RR  # noqa: PLC0415

    db = _reader(db)
    if HT.tabled(SITUATIONS_TAB):
        held = {gsjs.str_(r.get("id")) for r in read_situations(db)}
        made: list[str] = []
        with store.locked() as tx:
            for s in SEEDS:
                if s["id"] in held:
                    continue
                cur_tok, write_tok = W.HELD.set(tx.cur), _WRITE.set({"write_id": "seed:" + s["id"]})
                try:
                    RR.create(None, HT.resource_of(SITUATIONS_TAB) or "",  # type: ignore[arg-type]
                              {h: W.sheet_text(v) for h, v in s.items()}, AUTHOR)
                finally:
                    _WRITE.reset(write_tok)
                    W.HELD.reset(cur_tok)
                made.append(s["id"])
        return made
    with _unnoted():
        res = db.resolve(SITUATIONS_TAB)
    if res.runtime or not res.sheet_id or (res.ref is None and not res.book_known):
        return []
    tab = res.ref.tab if res.ref is not None else SITUATIONS_TAB
    held = {gsjs.str_(r.get("id")) for r in read_situations(db)}
    out: list[str] = []
    with store.locked() as tx:
        for s in SEEDS:
            if s["id"] in held:
                continue
            tx.cur.execute(f"select 1 from {W.EDITS_TABLE} where sheet_id = %s and tab_name = %s and row_key = %s"
                           " limit 1", (res.sheet_id, tab, s["id"]))
            if tx.cur.fetchone():
                continue
            tx.cur.executemany(
                f"insert into {W.EDITS_TABLE} (write_id, app, action, sheet_id, tab_name, kind, match_by, keyed_by,"
                " row_key, field, value, before, author, edition)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                [("seed:" + s["id"], APP_ID, SEED_DOOR, res.sheet_id, tab, "append", "id", "header", s["id"], h,
                  W.sheet_text(v), "", AUTHOR, "") for h, v in s.items()])
            out.append(s["id"])
    return out


def _cur(x: Any) -> Any:
    """A cursor from a writes.Tx, a connection or a cursor."""
    if hasattr(x, "cur"):
        return x.cur
    if hasattr(x, "cursor") and not hasattr(x, "fetchone"):
        return x.cursor()
    return x


@contextlib.contextmanager
def _guard(cur: Any) -> Iterator[None]:
    """A savepoint, so a failed statement never aborts the door's transaction; outside a transaction (a connection in
    autocommit that opened none) each statement stands alone, and none is asked for."""
    name = "smart_comms_" + uuid.uuid4().hex[:10]
    conn = getattr(cur, "connection", None)
    # psycopg's TransactionStatus IDLE: no transaction block is open on this connection
    held = not (conn is not None and getattr(conn, "autocommit", False)
                and int(getattr(getattr(conn, "info", None), "transaction_status", 0) or 0) == 0)
    if held:
        try:
            cur.execute(f"savepoint {name}")
        except Exception:  # noqa: BLE001 - outside a transaction each statement stands alone
            held = False
    try:
        yield
    except Exception:
        if held:
            cur.execute(f"rollback to savepoint {name}")
            cur.execute(f"release savepoint {name}")
        raise
    else:
        if held:
            cur.execute(f"release savepoint {name}")


_COLS = ("id", "idem_key", "situation", "to_digits", "body", "from_line", "state", "held_by", "why", "receipt",
         "due_at", "attempts", "lane", "door", "write_id", "ask", "created_at", "updated_at")


def _row(r: tuple) -> dict[str, Any]:
    out = dict(zip(_COLS, r))
    for k in ("due_at", "created_at", "updated_at"):
        v = out.get(k)
        out[k] = v.timestamp() if isinstance(v, datetime) else (float(v) if v is not None else None)
    if not isinstance(out.get("ask"), dict):
        out["ask"] = json.loads(out.get("ask") or "{}")
    return out


def _select() -> str:
    return ("select id, idem_key, situation, to_digits, body, from_line, state, held_by, why, receipt, due_at, attempts,"
            f" lane, door, write_id, ask, created_at, updated_at from {OUTBOX}")


def _claim(cur: Any, key: str, but: int | None = None) -> dict | None:
    """The row that holds this key, if any."""
    if not key:
        return None
    cur.execute(_select() + " where idem_key = %s and state = any(%s) and id <> %s order by id desc limit 1",
                (key, list(CLAIMS), but or 0))
    got = cur.fetchone()
    return _row(got) if got else None


def _quiet_seen(cur: Any, to_digits: str, body: str, but: int | None) -> bool:
    """commMockQuietSeen_: the same words to the same number already held by the window lately."""
    cur.execute(f"select 1 from {OUTBOX} where to_digits = %s and left(body, 400) = left(%s, 400) and held_by = 'quiet'"
                " and created_at > now() - make_interval(secs => %s) and id <> %s limit 1",
                (to_digits, body, QUIET_MEMO_S, but or 0))
    return cur.fetchone() is not None


def _ts(at_s: float | None) -> datetime | None:
    return None if at_s is None else datetime.fromtimestamp(at_s, tz=timezone.utc)


# ---- the proof rows ------------------------------------------------------------------------------------------------

_MOCK_PASSES: dict[str, list] = {}
_MOCK_LOCK = threading.Lock()


class _Run:
    """One execution: its clock and the pass ids and counters Apps Script keeps per execution."""

    def __init__(self, now: float) -> None:
        self.now = now
        self._rehearsal = ""
        self.rehearsal_seq = 0
        self.lines: dict[str, dict] = {}

    def digits(self) -> str:
        return re.sub(r"[^0-9]", "", iso(self.now))[:14]

    def mock_next(self) -> tuple[str, int]:
        """The mock pass of this second and the next seq in it: one pass per second per process, so the four random
        digits never have to tell two of this process's passes apart."""
        sec = self.digits()
        with _MOCK_LOCK:
            held = _MOCK_PASSES.get(sec)
            if held is None:
                if len(_MOCK_PASSES) > 64:
                    _MOCK_PASSES.clear()
                held = _MOCK_PASSES[sec] = [f"mock_{sec}_{random.randint(1000, 9999)}", 0]
            held[1] += 1
            return held[0], held[1]

    def rehearsal_pass(self) -> str:
        if not self._rehearsal:
            self._rehearsal = f"RHP_{self.digits()}_{str(uuid.uuid4())[:6]}"
        return self._rehearsal


def mask_to(v: Any) -> str:
    """rpcMaskTo_."""
    s = gsjs.or_blank(v)
    return "•••" + s[-4:] if _len16(s) > 4 else "•••"


def mask(v: Any) -> str:
    """hubRehearsalMask_."""
    parts = [x for x in (gsjs.trim(p) for p in re.split(r"[,;]+", gsjs.or_blank(v))) if x]
    if not parts:
        return ""
    head = mask_to(parts[0])
    return head + f" +{len(parts) - 1} more" if len(parts) > 1 else head


def audience(to: Any) -> int:
    """commMockAudience_."""
    return len([x for x in re.split(r"[,;]+", gsjs.or_blank(to)) if gsjs.trim(x)])


def mock_row(run: _Run, c: dict, b: dict, result: str, held_by: str, reason: str) -> dict[str, Any]:
    """commMockNote_'s row for one message."""
    pass_id, seq = run.mock_next()
    at = datetime.fromtimestamp(run.now, tz=timezone.utc)
    local = at.astimezone(NY)
    stamp = gsjs.iso(at)
    body = withheld(c["body"], c)
    return {"id": f"{pass_id}#{seq}", "createdAt": stamp, "updatedAt": stamp, "at": stamp,
            "day": local.strftime("%Y-%m-%d"), "hour": local.strftime("%H:%M"), "pass_id": pass_id,
            "seq": seq, "situation": c["sid"], "purpose": c["lane"],
            "method": "emailSend" if c.get("channel") == "email" else "smsSend",
            "send_at": _last_cell(c["rows"], c["sid"], "send_at"), "person_name": c["person"],
            "to_masked": mask(c["to"]) or mask_to(c["to"]), "audience": audience(c["to"]),
            "channel": c.get("channel") or "sms",
            "subject": withheld(c.get("subject", ""), c), "body": _cut16(body, 4000), "body_chars": _len16(body),
            "result": result,
            "held_by": held_by, "reason": reason, "dial": b["dial"], "test_mode": b["mock_test_mode"],
            "send_switch": "on" if b["sending"] else "off", "ledger_key": c["key"], "tenant": ""}


def rehearsal_row(run: _Run, c: dict, b: dict) -> dict[str, Any]:
    """hubRehearsalRow_ for one text smartTell_ handed the door."""
    run.rehearsal_seq += 1
    stamp = iso(run.now)
    body = withheld(gsjs.str_(c["body"]), c)
    intent = c["key"]
    seed = f"{run.rehearsal_pass()}|{intent or (c['to'] + '||' + _cut16(body, 40))}|{c.get('channel') or 'sms'}"
    reasons = ""
    if not b["sending"]:
        reasons = NOT_ARMED if (b["rpc_send"] and not b["paused"]) else SWITCH_OFF
    hands_over = not b["dial"] or b["dial"] == "send"
    if b["dial"] and not hands_over:
        reasons = (reasons + " · " if reasons else "") + f"the sending dial stands at `{b['dial']}`, not `send`"
    testers = ",".join(b["testers"])
    return {"id": "CRH_" + hashlib.md5(seed.encode("utf-8")).hexdigest()[:12], "createdAt": stamp, "updatedAt": stamp,
            "pass_id": run.rehearsal_pass(), "pass_at": stamp, "pass_by": "asa-hub:" + c["lane"],
            "seq": run.rehearsal_seq, "intent_key": intent, "person_key": c["person_key"], "person_name": c["person"],
            "channel": c.get("channel") or "sms", "to_masked": mask(c["to"]), "redirected": "yes" if testers else "no",
            "redirect_to_masked": mask(testers), "situation": c["sid"], "purpose": c["lane"], "words_sha": "",
            "sender_used": c["sender"], "from_account": "", "subject": withheld(c.get("subject", ""), c), "body": body,
            "body_chars": _len16(body),
            "would_have_sent": "yes" if b["sending"] and hands_over else "no", "verdict": "", "reasons": reasons,
            "consent": "", "window": "", "attempt": "", "dial": b["dial"], "at": stamp, "test_mode": "sheet",
            "tenant": ""}


def ledger_row(run: _Run, c: dict) -> dict[str, Any] | None:
    """smartRecord_'s line for a text that left; none without a key."""
    lk = c["ledger_key"] or c["key"]
    if not lk:
        return None
    return {"key": lk, "situation": c["sid"], "person": c["ledger_person"] or c["person"],
            "expires": _cut16(c["occasion"], 10), "channel": c.get("channel") or "sms", "at": iso(run.now)}


# Rpc.gs HUB_AUTH_LETTERS / HUB_AUTH_TEXTS: the two letters that carry a way in (a reset password, an invitation) pass
# the dial, the window and the switch; of their texts only the reset's does
AUTH_LETTERS = ("password_reset", "invitation")
AUTH_TEXTS = ("password_reset",)
WITHHELD_WORDS = "{withheld}"


def auth_kind(ask: dict) -> str:
    """hubAuthLetterKind_ (and hubAuthTextKind_ for a text): the kind when the ask may pass the brakes, else ''."""
    kind = gsjs.trim(gsjs.or_blank(ask.get("auth_letter")))
    if kind not in AUTH_LETTERS:
        return ""
    if gsjs.str_(ask.get("channel")).lower() != "email" and kind not in AUTH_TEXTS:
        return ""
    return kind


def withheld(text: Any, c: dict) -> str:
    """hubSecretScrub_ / hubWithhold_: the words as the records keep them, every secret the ask names withheld."""
    s = "" if text is None else str(text)
    held = (c.get("ask") or {}).get("withhold")
    for secret in (held if isinstance(held, list) else [held] if held else []):
        w = "" if secret is None else str(secret)
        if len(w) >= 4:
            s = s.replace(w, WITHHELD_WORDS)
    return s


def _target(db: Any, tab: str) -> tuple[str, str] | None:
    """Where a tab's appended row lands: a declared house the copy knows, as hubTabSheet_ opens it (never HUB_DB,
    which Python and Apps Script name differently)."""
    try:
        with _unnoted():
            res = db.resolve(tab)
    except Exception:  # noqa: BLE001 - a house that cannot be named takes no row
        return None
    if res.runtime or not res.declared_house or not res.sheet_id or (res.ref is None and not res.book_known):
        return None
    # the writes' own rule: a house no copy holds a tab of yet keeps the row in its Data tab
    return W.where_of(res)


def _append(cur: Any, c: dict, target: tuple[str, str] | None, header: tuple, rec: dict, match: str,
            row_key: str) -> bool:
    """One appended row kept in app.edits (W.final kind 'append'); False when it could not be kept."""
    if target is None:
        return False
    cells = [(h, W.sheet_text(rec.get(h))) for h in header]
    rows = [(c["write_id"], APP_ID, c["door"], target[0], target[1], "append", match, "header", row_key, h, v, "",
             AUTHOR, "") for h, v in cells if v != "" or h in ("id", "key")]
    try:
        with _guard(cur):
            cur.executemany(
                f"insert into {W.EDITS_TABLE} (write_id, app, action, sheet_id, tab_name, kind, match_by, keyed_by,"
                " row_key, field, value, before, author, edition)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)", rows)
        return True
    except Exception as exc:  # noqa: BLE001 - a lost proof row never changes the answer
        log.warning("smart comms: a %s row was not kept (%s)", target[1], type(exc).__name__)
        return False


def _append_house(cur: Any, c: dict, db: Any, house: str, header: tuple, rec: dict, match: str,
                  row_key: str) -> bool:
    """One appended row of a house: in its own table once kept there (under this write, through this cursor), else
    kept in app.edits for its book; False when it could not be kept."""
    import house_tables as HT  # noqa: PLC0415 - it imports this module
    import resource_rows as RR  # noqa: PLC0415

    if not HT.tabled(house):
        return _append(cur, c, _target(db, house), header, rec, match, row_key)
    cells = {h: W.sheet_text(rec.get(h)) for h in header}
    cells = {h: v for h, v in cells.items() if v != "" or h in ("id", "key")}
    held, wrote = W.HELD.set(cur), _WRITE.set({**(_WRITE.get() or {}), "write_id": c["write_id"]})
    try:
        with _guard(cur):
            RR.create(None, HT.resource_of(house) or "", cells, AUTHOR)  # type: ignore[arg-type]
        return True
    except Exception as exc:  # noqa: BLE001 - a lost proof row never changes the answer
        log.warning("smart comms: a %s row was not kept (%s)", house, type(exc).__name__)
        return False
    finally:
        _WRITE.reset(wrote)
        W.HELD.reset(held)


def keep_test_row(cur: Any, c: dict, name: str, rec: dict) -> bool:
    """A row of the test-mode logs (comm_logs: the mock outbox, the rehearsal book) kept in the write being decided,
    its blank cells left unwritten as an appended row's; False when it could not be kept."""
    return comm_logs.keep(cur, name, rec, gsjs.str_(c.get("write_id")), gsjs.str_(c.get("door")), blanks=False)


def _note_mock(cur: Any, db: Any, run: _Run, c: dict, b: dict, result: str, held_by: str, reason: str) -> bool:
    return keep_test_row(cur, c, comm_logs.MOCK, mock_row(run, c, b, result, held_by, reason))


def _note_rehearsal(cur: Any, db: Any, run: _Run, c: dict, b: dict) -> bool:
    return keep_test_row(cur, c, comm_logs.REHEARSAL, rehearsal_row(run, c, b))


def _note_ledger(cur: Any, db: Any, run: _Run, c: dict) -> bool:
    rec = ledger_row(run, c)
    if rec is None:
        return True
    return _append_house(cur, c, db, LEDGER_TAB, LEDGER_HEADER, rec, LEDGER_MATCH,
                         gsjs.trim(rec["key"]) + "\x1f" + gsjs.trim(rec["at"]))


def record_ledger(key: str, situation: str, person: str, expires: Any, channel: str, db: Any = None) -> bool:
    """smartRecord_: one ledger line (smart_comms_sent) kept in the write being decided; False when it was lost."""
    held = _WRITE.get() or {}
    if held.get("tx") is None:
        return False
    c = {"write_id": gsjs.str_(held.get("write_id")), "door": gsjs.str_(held.get("door")) or "smartRecord"}
    rec = {"key": key, "situation": situation, "person": person, "expires": _cut16(gsjs.str_(expires), 10),
           "channel": channel, "at": iso(time.time())}
    return _append_house(_cur(held["tx"]), c, _reader(db), LEDGER_TAB, LEDGER_HEADER, rec, LEDGER_MATCH,
                         gsjs.trim(key) + "\x1f" + gsjs.trim(rec["at"]))


def _note_record(cur: Any, db: Any, run: _Run, c: dict, b: dict, house: str) -> bool:
    rec = mock_row(run, c, b, "recorded", "this row writes into " + house,
                   f"This situation writes into its own sheet ({house}) instead of sending. Nobody was contacted.")
    return _append_house(cur, c, db, house, MOCK_HEADER, rec, "id", rec["id"])


# ---- the decision --------------------------------------------------------------------------------------------------

def _answer(sid: str) -> dict[str, Any]:
    return {"situation": sid, "state": "", "held": "", "why": "", "receipt": "", "unreadable": False}


def _keep(cur: Any, c: dict, state: str, held_by: str = "", why: str = "", due: float | None = None,
          receipt: str = "") -> int | None:
    """The outbox's row for this message: inserted for a raise, the drained row updated."""
    if c.get("row_id"):
        cur.execute(f"update {OUTBOX} set state = %s, held_by = %s, why = %s, due_at = %s, receipt = %s,"
                    " body = %s, from_line = %s, to_digits = %s, updated_at = now() where id = %s",
                    (state, held_by, why[:1000], _ts(due), receipt, c["body"], c["from_line"], c["to_digits"],
                     c["row_id"]))
        return c["row_id"]
    cur.execute(f"insert into {OUTBOX} (idem_key, situation, to_digits, body, from_line, state, held_by, why, receipt,"
                " due_at, lane, door, write_id, ask) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,"
                " %s::jsonb) returning id",
                (c["key"], c["sid"], c["to_digits"], c["body"], c["from_line"], state, held_by, why[:1000], receipt,
                 _ts(due), c["lane"], c["door"], c["write_id"], json.dumps(c["ask"], default=str)))
    got = cur.fetchone()
    return int(got[0]) if got else None


def _ask(situation: Any, to: Any, vars: Any, key: Any, ledger_key: Any, person: Any, person_key: Any,
         ledger_person: Any, occasion: Any, lane: Any, at_ms: Any, prune_words: Any, team: Any = False,
         channel: Any = "sms", words: Any = None, body: Any = None, subject: Any = None) -> dict[str, Any]:
    return {"situation": situation, "to": to, "vars": vars if isinstance(vars, dict) else {}, "key": key,
            "ledger_key": ledger_key, "person": person, "person_key": person_key, "ledger_person": ledger_person,
            "occasion": occasion, "lane": lane, "at_ms": at_ms, "prune": prune_words,
            "team": "group" if gsjs.str_(team).lower() == "group" else bool(team),
            "channel": "email" if gsjs.str_(channel).lower() == "email" else "sms",
            "words": gsjs.str_(words) if words is not None else None,
            "body": gsjs.str_(body) if body is not None else None,
            "subject": gsjs.str_(subject) if subject is not None else None}


def _tell(cur: Any, db: Any, ask: dict, run: _Run, *, door: str, write_id: str,
          row: dict | None = None) -> tuple[dict[str, Any], dict | None]:
    """smartTell_ then rpcCall_'s brakes over one ask, in Apps Script's order: (its answer, the send owed now)."""
    sid = gsjs.str_(ask.get("situation"))
    out = _answer(sid)
    draining = row is not None
    c: dict[str, Any] = {
        "sid": sid, "key": gsjs.str_(ask.get("key")), "lane": gsjs.str_(ask.get("lane")) or "smart comms",
        "person": gsjs.str_(ask.get("person")), "person_key": gsjs.str_(ask.get("person_key")),
        "ledger_key": gsjs.str_(ask.get("ledger_key")), "ledger_person": gsjs.str_(ask.get("ledger_person")),
        "occasion": gsjs.str_(ask.get("occasion")), "door": door, "write_id": write_id, "ask": ask,
        "row_id": row["id"] if draining else None, "rows": None, "to": "", "to_digits": "", "body": "",
        "from_line": "", "sender": "", "subject": "",
        "channel": "email" if gsjs.str_(ask.get("channel")).lower() == "email" else "sms"}

    def ended(state: str, why: str) -> tuple[dict, None]:
        # an early return writes nothing; a drained row it ends is closed with it
        if draining:
            _keep(cur, c, state, "", why)
        return out, None

    # a message its lane wrote whole and hands the one send door (rpcCall_'s own callers): no situation decides it,
    # every brake still does
    transport = ask.get("transport") is True
    # S1 the situation, its last row; unread or off says nothing
    try:
        rows = read_situations(db)
        unread = ""
    except Exception as exc:  # noqa: BLE001 - an unread tab is held, never sent
        rows, unread = None, type(exc).__name__
    sit = situation_row(rows, sid) if rows is not None else None
    c["rows"] = rows
    if transport:
        sit = sit or {}
        c["rows"] = rows or []
    elif sit is None or not smart_on(sit.get("enabled")):
        out["state"] = "off"
        out["unreadable"] = bool(unread)
        out["why"] = (f"the situations tab could not be read, so whether `{sid}` is on cannot be told — nothing was "
                      "sent" if unread else f"the situation `{sid}` is off or absent on the Desk — nothing was sent")
        return ended("off", out["why"])
    if c["channel"] == "email":
        # S2 a letter: the channel named, and its words (the text's when the letter has none of its own)
        if not transport and ("email" not in smart_list(sit.get("channels")) or
                              not (gsjs.str_(sit.get("email_text")) or gsjs.str_(sit.get("sms_text")))):
            out["state"], out["why"] = "off", f"the situation `{sid}` names no e-mail words — nothing was sent"
            return ended("off", out["why"])
        # S3 an address
        to = letter_to(ask.get("to"))
        if not to:
            out["state"], out["why"] = "no_address", "no address this platform may write to"
            return ended("no_address", out["why"])
        c["to"], c["to_digits"] = to, to
    else:
        # S2 the SMS words
        if not transport and ("sms" not in smart_list(sit.get("channels")) or not gsjs.str_(sit.get("sms_text"))
                              or unwritten_words(db, sit, "sms_text")):
            out["state"], out["why"] = "off", f"the situation `{sid}` names no SMS words — nothing was sent"
            return ended("off", out["why"])
        # S3 a number this platform may text; a team copy may reach a shared team line
        team = gsjs.str_(ask.get("team")).lower()
        to = (group_line(ask.get("to")) if team == "group" else team_copy(ask.get("to")) if _truthy(ask.get("team"))
              else sendable(ask.get("to")))
        if not to:
            out["state"], out["why"] = "no_phone", "no number this platform may text"
            return ended("no_phone", out["why"])
        c["to"], c["to_digits"] = to, to[2:]
    # S4 the window on the caller's clock: the text is owed for 08:00, kept here
    at = _caller_clock(ask.get("at_ms"), run.now) if not draining else run.now
    if (at is None or quiet_at(at)) and ask.get("quiet_exempt") is not True and not auth_kind(ask):
        out["state"], out["held"] = "held", "quiet"
        out["why"] = f"inside the quiet window ({QUIET_WORDS}) — owed at {QUIET_TO}"
        _owe_quiet(cur, c, run, out["why"])
        return out, None
    # S5 the words
    v = dict(ask.get("vars") or {})
    if not _truthy(v.get("sender")):
        v["sender"] = gsjs.str_(sit.get("sender")) or SENDER_DEFAULT
    c["sender"] = gsjs.str_(v["sender"])
    if c["channel"] == "email" and ask.get("body") is not None:
        # a letter its lane wrote itself (hubLetterSend_'s words: the row's cells, or the lane's own floors)
        body = gsjs.str_(ask.get("body"))
        c["subject"] = gsjs.str_(ask.get("subject")) or sid
    elif c["channel"] == "email":
        body = prune_letter(render(sit.get("email_text") or sit.get("sms_text"), v))
        c["subject"] = letter_subject(render(sit.get("email_subject"), v)) or sid
    else:
        # the words a lane pruned for this one message (CommCallOff.gs), else the situation's own
        if ask.get("body") is not None:
            # the text a lane rendered itself (CommBroadcast.gs's own placeholders), sent as it stands
            body = gsjs.str_(ask.get("body"))
        else:
            body = render(sit.get("sms_text") if ask.get("words") is None else ask.get("words"), v)
            if _truthy(ask.get("prune")):
                body = prune(body)
    c["body"] = body
    if not gsjs.str_(body):
        out["state"], out["why"] = "off", "the words rendered empty — nothing was sent"
        return ended("off", out["why"])
    # a fault past here unwinds the whole decision: the caller answers it failed, nothing kept and nothing sent
    return _rpc(cur, db, run, c, out)


def _owe_quiet(cur: Any, c: dict, run: _Run, why: str) -> None:
    """A text the window held, owed in the outbox until 08:00 New York (never a second owed row for its key)."""
    due = quiet_end(run.now)
    if c.get("row_id"):
        _keep(cur, c, "owed", "quiet", why, due)
        return
    if _claim(cur, c["key"]) is None:
        _keep(cur, c, "owed", "quiet", why, due)
        _expect(due)


def _rpc(cur: Any, db: Any, run: _Run, c: dict, out: dict) -> tuple[dict, dict | None]:
    """rpcCall_('smsSend') past its contract: from_line, opt-out, quiet, test mode, record_to, the key, the switch."""
    sid, rows, draining = c["sid"], c["rows"], bool(c.get("row_id"))
    reason = f"{c['lane']}: {sid}"
    line_sid = situation_from(reason, rows) or sid
    asked = c.get("ask") or {}
    # a line the caller named (rpcCall_'s from_line), else the situation's
    c["from_line"] = gsjs.str_(asked.get("from_line")) or gsjs.str_(_last_cell(rows, line_sid, "from_line"))
    # an authentication letter passes the window, the dial, a row's own house and the switch (HUB_AUTH_LETTERS)
    auth = auth_kind(asked)
    b = brakes(db, cur)

    # the person's own brake
    stopped = opt_out_blocked(db, c["to"])
    if stopped:
        out["state"], out["why"] = "refused", stopped or "opted out"
        held_by = ("the opt-out list could not be read" if _OPT_OUT_UNREAD.search(stopped)
                   else "the person asked us to stop")
        _note_mock(cur, db, run, c, b, "refused", held_by, stopped)
        _keep(cur, c, "refused", "opted_out", stopped)
        return out, None

    house = "" if auth else record_to(rows, situation_from(reason, rows))
    # the window on the real clock (a row that writes into its own house reaches nobody, at any hour)
    if quiet_at(run.now) and not house and asked.get("quiet_exempt") is not True and not auth:
        held = _claim(cur, c["key"], c.get("row_id"))
        # a key whose text left (or is leaving) answers its receipt; one the window already owes stays owed once
        if held is not None and not (held["state"] == "owed" and held["held_by"] == "quiet"):
            return _already(cur, db, run, c, b, out)
        out["state"], out["held"], out["why"] = "held", "quiet", QUIET_DETAIL
        if held is None:
            if not _quiet_seen(cur, c["to_digits"], c["body"], c.get("row_id")):
                _note_mock(cur, db, run, c, b, "held_quiet", f"the quiet window ({QUIET_WORDS})", QUIET_DETAIL)
            _owe_quiet(cur, c, run, QUIET_DETAIL)
        return out, None

    # test mode, in any of its positions or unread: the words written down, nobody contacted
    if b["hold"] and not auth:
        kept = _note_rehearsal(cur, db, run, c, b)
        detail = REHEARSED_DETAIL if kept else REHEARSAL_LOST
        _note_mock(cur, db, run, c, b, "rehearsed", b["test_why"] or "the dial is at the sheet", detail)
        out["state"], out["held"] = "held", "test_mode"
        out["why"] = "test mode: written to the rehearsal book and the mock outbox — nobody contacted"
        _keep(cur, c, "held", "test_mode", b["test_why"] or detail)
        return out, None

    # a row that writes into its own house
    if house:
        _note_record(cur, db, run, c, b, house)
        out["state"], out["held"], out["why"] = "held", "recorded", f"written into {house} — nobody contacted"
        _keep(cur, c, "held", "recorded", out["why"])
        return out, None

    # exactly once
    if _claim(cur, c["key"], c.get("row_id")) is not None:
        return _already(cur, db, run, c, b, out)

    # the send switch: the depot's HUB_RPC_SEND, messages_paused, and the Python arm
    if not b["sending"] and not auth:
        _note_mock(cur, db, run, c, b, "held", SWITCH_OFF, b["send_detail"] or SWITCH_OFF)
        out["state"], out["held"], out["why"] = "held", SWITCH_OFF, b["send_detail"]
        _keep(cur, c, "held", SWITCH_OFF, b["send_why"])
        return out, None

    if draining:
        _keep(cur, c, "sending", "", "")
        cur.execute(f"update {OUTBOX} set attempts = attempts + 1 where id = %s", (c["row_id"],))
        return out, {"row_id": c["row_id"], "to": c["to"], "body": c["body"], "from_line": c["from_line"], "c": c,
                     "channel": c["channel"], "subject": c["subject"]}
    # owed to the drain past the write budget and the grace a voided write needs: the door answers what a send that
    # left would answer, its receipt still to come (outbox_for reads it)
    due = run.now + max(VOID_GRACE_S, 10.0)
    try:
        with _guard(cur):
            _keep(cur, c, "owed", "", "", due)
    except Exception as exc:  # noqa: BLE001 - a text that could not be owed is not sent
        if _claim(cur, c["key"]) is not None:
            return _already(cur, db, run, c, b, out)
        log.warning("smart comms: %s could not be owed (%s)", sid, type(exc).__name__)
        out["state"], out["why"] = "failed", "outbox: the text could not be kept, so nothing was sent"
        return out, None
    _expect(due)
    out["state"] = "sent"
    return out, None


def _already(cur: Any, db: Any, run: _Run, c: dict, b: dict, out: dict) -> tuple[dict, None]:
    _note_mock(cur, db, run, c, b, "held", "the same ask already landed", DEDUP_DETAIL)
    out["state"], out["held"], out["why"] = "already", "", "this exact text was already asked for"
    _keep(cur, c, "already", "", out["why"])
    return out, None


# ---- the doors' entry points ---------------------------------------------------------------------------------------

def raise_situation(tx_or_conn: Any, *, situation: Any, to: Any, vars: Any, key: Any, ledger_key: Any = None,
                    person: Any = None, person_key: Any = None, ledger_person: Any = None, occasion: Any = None,
                    lane: Any = None, at_ms: Any = None, prune: Any = True, door: Any = None, write_id: Any = None,
                    db: Any = None, now: float | None = None, team: Any = False,
                    channel: Any = "sms", words: Any = None, body: Any = None,
                    subject: Any = None, from_account: Any = None, quiet_exempt: Any = False,
                    html: Any = None, transport: Any = False, from_line: Any = None, auth_letter: Any = None,
                    withhold: Any = None, cc: Any = None) -> dict[str, Any]:
    """smartTell_ for a door: decided in its transaction with no network; {situation, state, held, why, receipt,
    unreadable}. tx_or_conn None: the write `deciding` names. `team`: a team copy (packetTeamCopyNumber_);
    `channel` "email": a letter to an address, the situation's e-mail words, out through the relay's mailbox;
    `team` "group": the 5558 group's own line; `words`: the text template this one message is rendered from;
    `body` (and a letter's `subject`): the words themselves, rendered by their lane and sent as they stand;
    `from_account`: the platform mailbox slot a letter leaves from (the first when none); `quiet_exempt`: a person
    writing by hand, whom the quiet window does not hold (rpcCall_'s quiet_exempt 'by_hand'); `html`: a letter's own
    HTML beside its text (emailSend's html). `transport`: a message its lane wrote whole (rpcCall_'s own callers) —
    no situation decides it, every brake still does — with `from_line`, the `auth_letter` kind that passes the brakes,
    the `withhold` secrets its records never keep, and a letter's `cc`."""
    held = _WRITE.get() or {}
    if tx_or_conn is None:
        tx_or_conn = held.get("tx")
        if tx_or_conn is None:
            got = _answer(gsjs.str_(situation))
            got["state"], got["why"] = "failed", "no write is being decided, so the text has no transaction to be kept in"
            return got
    write_id = write_id or held.get("write_id")
    door = door or held.get("door")
    cur = _cur(tx_or_conn)
    ask = _ask(situation, to, vars, key, ledger_key, person, person_key, ledger_person, occasion, lane, at_ms, prune,
               team, channel, words, body, subject)
    if gsjs.str_(from_account):
        ask["from_account"] = gsjs.str_(from_account)
    if quiet_exempt is True:
        ask["quiet_exempt"] = True
    if gsjs.str_(html):
        ask["html"] = gsjs.str_(html)
    if transport is True:
        ask["transport"] = True
    if gsjs.str_(from_line):
        ask["from_line"] = gsjs.str_(from_line)
    if gsjs.str_(auth_letter):
        ask["auth_letter"] = gsjs.str_(auth_letter)
    if withhold:
        ask["withhold"] = [str(w) for w in (withhold if isinstance(withhold, list) else [withhold]) if w is not None]
    if gsjs.str_(cc):
        ask["cc"] = gsjs.str_(cc)
    wid = gsjs.str_(write_id) or "smart-comms:" + uuid.uuid4().hex
    run = _Run(time.time() if now is None else float(now))
    try:
        # one savepoint: a fault unwinds every row this raise kept, and the door's own transaction goes on
        with _unnoted(), _guard(cur):
            got, _send = _tell(cur, _reader(db), ask, run, door=gsjs.str_(door) or "smartTell", write_id=wid)
    except Exception as exc:  # noqa: BLE001 - a door is never failed by the message it raised
        log.warning("smart comms: %s not decided (%s)", gsjs.str_(situation), type(exc).__name__)
        got = _answer(gsjs.str_(situation))
        got["state"], got["why"] = "failed", f"transport: {type(exc).__name__}"
    return got


def cancel_owed(tx_or_conn: Any, key_prefix: str, why: str = "") -> int:
    """Withdraws every text still owed under keys starting with this prefix (said only while still true)."""
    prefix = gsjs.str_(key_prefix)
    if not prefix:
        return 0
    cur = _cur(tx_or_conn)
    like = re.sub(r"([\\%_])", r"\\\1", prefix) + "%"
    cur.execute(f"update {OUTBOX} set state = 'cancelled', why = %s, updated_at = now()"
                " where state = 'owed' and idem_key like %s", ((why or "withdrawn by its door")[:400], like))
    return int(getattr(cur, "rowcount", 0) or 0)


def void_write(tx_or_conn: Any, write_id: str) -> int:
    """A write the relay voided: what it owed never leaves, and the ledger lines it kept in their table go with it."""
    import house_tables as HT  # noqa: PLC0415 - it imports this module
    import resource_rows as RR  # noqa: PLC0415

    if not gsjs.str_(write_id):
        return 0
    cur = _cur(tx_or_conn)
    cur.execute(f"update {OUTBOX} set state = 'void', why = 'the write that owed it was voided', updated_at = now()"
                " where write_id = %s and state = 'owed'", (gsjs.str_(write_id),))
    n = int(getattr(cur, "rowcount", 0) or 0)
    if HT.tabled(LEDGER_TAB):
        RR.void(cur, gsjs.str_(write_id), HT.resource_of(LEDGER_TAB))
    return n


def outbox_for(tx_or_conn: Any, key: str = "", *, write_id: str = "", limit: int = 20) -> list[dict[str, Any]]:
    """The outbox rows of a key (or of a write), newest first; `ask` left out."""
    cur = _cur(tx_or_conn)
    if key:
        cur.execute(_select() + " where idem_key = %s order by id desc limit %s", (gsjs.str_(key), int(limit)))
    elif write_id:
        cur.execute(_select() + " where write_id = %s order by id desc limit %s", (gsjs.str_(write_id), int(limit)))
    else:
        return []
    return [{k: v for k, v in _row(r).items() if k != "ask"} for r in cur.fetchall()]


def status(tx_or_conn: Any) -> dict[str, Any]:
    """Counts by state, the next text due, and whether the arm is on."""
    cur = _cur(tx_or_conn)
    cur.execute(f"select state, count(*) from {OUTBOX} group by state")
    counts = {s: int(n) for s, n in cur.fetchall()}
    return {"states": counts, "next_due": next_due(cur), "armed": armed(cur)}


def next_due(tx_or_conn: Any) -> float | None:
    cur = _cur(tx_or_conn)
    cur.execute(f"select min(due_at) from {OUTBOX} where state = 'owed'")
    got = cur.fetchone()
    v = got[0] if got else None
    return v.timestamp() if isinstance(v, datetime) else (float(v) if v is not None else None)


# ---- the drain -----------------------------------------------------------------------------------------------------

def kick() -> None:
    """The drain looks now (after a door's transaction committed)."""
    _KICK.set()


def stop() -> None:
    _STOP.set()
    _KICK.set()


def wait(timeout: float) -> bool:
    """Sleeps until a kick or the timeout; True when kicked."""
    got = _KICK.wait(max(0.0, timeout))
    _KICK.clear()
    return got


def _expect(due: float) -> None:
    """A text owed by a raise in this process: the drain wakes for it even before its door commits."""
    with _PENDING_LOCK:
        _PENDING.append(due)
    _KICK.set()


def _pending(after: float | None = None) -> float | None:
    """The earliest owed time this process expects; the ones a finished drain already covered are let go."""
    with _PENDING_LOCK:
        if after is not None:
            _PENDING[:] = [d for d in _PENDING if d > after]
        return min(_PENDING) if _PENDING else None


@contextlib.contextmanager
def _locked(conn: Any) -> Iterator[Any]:
    """One short transaction under the platform's write lock (no provider call ever inside)."""
    with conn.transaction():
        cur = conn.cursor()
        cur.execute(f"set local lock_timeout = '{W.LOCK_WAIT}'")
        try:
            cur.execute("select pg_advisory_xact_lock(%s)", (W.LOCK_KEY,))
        except Exception as exc:
            if getattr(exc, "sqlstate", "") == "55P03":
                raise W.Busy() from exc
            raise
        yield cur


def _due(conn: Any, now: float, limit: int) -> list[int]:
    cur = conn.cursor()
    cur.execute(f"update {OUTBOX} set state = 'unknown', why = 'the drain stopped while it was sending; never sent "
                "again', updated_at = now() where state = 'sending' and updated_at < to_timestamp(%s)",
                (now - SENDING_STALE_S,))
    cur.execute(f"select id from {OUTBOX} where state = 'owed' and due_at <= to_timestamp(%s) order by due_at, id"
                " limit %s", (now, int(limit)))
    return [int(r[0]) for r in cur.fetchall()]


def drain(conn: Any, now: float | None = None, *, db: Any = None, transport: Callable[..., dict] | None = None,
          limit: int = DRAIN_BATCH) -> dict[str, Any]:
    """Every owed text that is due, decided again from its ask and sent only when every brake and the arm say go.
    conn: the writer role's autocommit connection; one drain at a time (a session advisory lock)."""
    t = time.time() if now is None else float(now)
    db = _reader(db)
    send = transport or TRANSPORT
    cur = conn.cursor()
    cur.execute("select pg_try_advisory_lock(%s)", (DRAIN_LOCK,))
    got = cur.fetchone()
    if not got or not got[0]:
        return {"ran": False, "why": "another drain holds the lock", "done": {}, "next_due": None}
    done: dict[str, int] = {}
    try:
        run = _Run(t)
        with _unnoted():
            for row_id in _due(conn, t, limit):
                word = _drain_one(conn, db, run, row_id, send, now)
                done[word] = done.get(word, 0) + 1
        return {"ran": True, "done": done, "next_due": next_due(conn)}
    finally:
        with contextlib.suppress(Exception):
            conn.cursor().execute("select pg_advisory_unlock(%s)", (DRAIN_LOCK,))


def _set_aside(conn: Any, row_id: int, now: float, why: str) -> None:
    """A row the drain could not decide: looked at again later, and closed failed after a few tries."""
    with contextlib.suppress(Exception):
        conn.cursor().execute(
            f"update {OUTBOX} set attempts = attempts + 1, due_at = to_timestamp(%s), why = %s,"
            " state = case when attempts + 1 >= 5 then 'failed' else state end, updated_at = now()"
            " where id = %s and state = 'owed'", (now + 300.0, why[:400], row_id))


def _drain_one(conn: Any, db: Any, run: _Run, row_id: int, send: Callable[..., dict], fixed: float | None) -> str:
    run.now = time.time() if fixed is None else float(fixed)
    try:
        with _locked(conn) as cur:
            cur.execute(_select() + " where id = %s and state = 'owed' for update", (row_id,))
            got = cur.fetchone()
            if not got:
                return "gone"
            row = _row(got)
            if row["due_at"] is not None and row["due_at"] > run.now:
                return "early"
            # the drain's proof rows are its own write, never the door's (a late void of that write keeps them)
            answer, owed = _tell(cur, db, row["ask"], run, door=row["door"] or "smartTell",
                                 write_id="smart-comms:" + uuid.uuid4().hex, row=row)
    except W.Busy:
        return "busy"
    except Exception as exc:  # noqa: BLE001 - the row stays owed, set aside for a later look
        log.warning("smart comms: owed text %s not decided (%s)", row_id, type(exc).__name__)
        _set_aside(conn, row_id, run.now, f"not decided ({type(exc).__name__}); looked at again later")
        return "error"
    if owed is None:
        return answer["state"] + (":" + answer["held"] if answer["held"] else "")
    try:
        if owed.get("channel") == "email":
            asked = owed["c"].get("ask") if isinstance(owed["c"].get("ask"), dict) else {}
            slot, html = gsjs.str_(asked.get("from_account")), gsjs.str_(asked.get("html"))
            cc = gsjs.str_(asked.get("cc"))
            res = LETTER(owed["to"], owed["subject"], owed["body"], key=owed["c"]["key"],
                         **({"from_account": slot} if slot else {}), **({"html": html} if html else {}),
                         **({"cc": cc} if cc else {}))
        else:
            res = send(owed["to"], owed["body"], owed["from_line"], lines=run.lines)
    except Exception as exc:  # noqa: BLE001 - rpcCall_'s catch around the transport
        res = {"ok": False, "sent": False, "error": "transport", "detail": type(exc).__name__}
    run.now = time.time() if fixed is None else float(fixed)
    c = owed["c"]
    for attempt in range(3):
        try:
            with _locked(conn) as cur:
                b = brakes(db, cur)
                if res.get("ok") and res.get("sent"):
                    receipt = gsjs.str_(res.get("receipt"))
                    _keep(cur, c, "sent", "", "", receipt=receipt)
                    _note_mock(cur, db, run, c, b, "sent", "", "")
                    _note_ledger(cur, db, run, c)
                    return "sent"
                why = gsjs.str_(res.get("error")) + (": " + gsjs.str_(res.get("detail")) if res.get("detail") else "")
                _keep(cur, c, "failed", gsjs.str_(res.get("error")), why)
                _note_mock(cur, db, run, c, b, "failed", gsjs.or_blank(res.get("error")),
                           gsjs.or_blank(res.get("detail") or res.get("reason")))
                return "failed"
        except W.Busy:
            time.sleep(0.5 * (attempt + 1))
        except Exception as exc:  # noqa: BLE001 - left 'sending', it turns 'unknown' and is never sent again
            log.warning("smart comms: the outcome of %s was not kept (%s)", row_id, type(exc).__name__)
            return "unrecorded"
    return "unrecorded"


async def drain_forever(connect: Callable[[], Any], *, idle_s: float = IDLE_S) -> None:
    """The lifespan task: a drain at start, then after every kick or when the next owed text falls due."""
    _STOP.clear()
    while not _STOP.is_set():
        sleep = idle_s
        started = time.time()
        try:
            got = await asyncio.to_thread(lambda: drain(connect()))
            dues = [d for d in (got.get("next_due"), _pending(after=started)) if d is not None]
            if dues:
                sleep = min(idle_s, max(1.0, min(dues) - time.time()))
        except Exception as exc:  # noqa: BLE001 - the next look tries again
            log.warning("smart comms drain: %s", type(exc).__name__)
            sleep = min(idle_s, 60.0)
        await asyncio.to_thread(wait, sleep)


# ---- the provider --------------------------------------------------------------------------------------------------

def _fail(error: str, detail: str) -> dict[str, Any]:
    return {"ok": False, "sent": False, "gated": False, "error": error, "detail": detail}


def line_key(v: Any) -> str:
    """hubLineKey_."""
    d = re.sub(r"[^0-9]+", "", gsjs.or_blank(v))
    if len(d) >= 11 and d[0] == "1":
        d = d[1:]
    d = d[-10:]
    return d if len(d) == 10 else ""


def line_match(rows: list, word: Any) -> dict[str, Any]:
    """hubLineSenderMatch_: id, number, provider name, then role; a name or role held by two lines names neither."""
    w = gsjs.trim(gsjs.or_blank(word))
    if not w:
        return {"line": None, "why": "no line was named"}
    lines = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        digits = line_key(r.get("number") or r.get("digits") or r.get("e164") or "")
        role = r.get("role") or (LINE_ROLE_WORDS.get(digits) if digits else "")
        lines.append({"row": r, "id": gsjs.or_text(r.get("id")), "digits": digits,
                      "name": gsjs.trim(gsjs.or_text(r.get("name"))), "role": gsjs.trim(gsjs.or_text(role))})
    lower = w.lower()

    def pick(test: Callable[[dict], bool]) -> Any:
        hits = [x for x in lines if test(x)]
        return hits[0] if len(hits) == 1 else ("many" if hits else None)

    by_id = pick(lambda x: x["id"] == w) if re.fullmatch(r"PN[A-Za-z0-9]{6,}", w) else None
    if by_id and by_id != "many":
        return {"line": by_id["row"], "via": "id"}
    key = line_key(w)
    if key:
        by_num = pick(lambda x: x["digits"] == key)
        if by_num and by_num != "many":
            return {"line": by_num["row"], "via": "number"}
        return {"line": None, "why": "no line of ours has the number " + w}
    by_name = pick(lambda x: bool(x["name"]) and x["name"].lower() == lower)
    if by_name == "many":
        return {"line": None, "why": f'more than one of our lines is called "{w}"'}
    if by_name:
        return {"line": by_name["row"], "via": "name"}
    by_role = pick(lambda x: bool(x["role"]) and x["role"].lower() == lower)
    if by_role == "many":
        return {"line": None,
                "why": f'"{w}" is the role of more than one of our lines — name the line by its number instead'}
    if by_role:
        return {"line": by_role["row"], "via": "role"}
    return {"line": None, "why": f'no line of ours answers to "{w}"'}


def sender_pick(data: list, want: Any) -> dict[str, Any]:
    """rpcSenderPick_: Automations by name unless the situation names a line; a name that does not resolve refuses."""
    w = gsjs.str_(want)
    hit = None
    if not w:
        for p in data or []:
            if isinstance(p, dict) and p.get("name") == DEFAULT_LINE:
                hit = p
        if hit is None:
            return {"error": "no_sending_line", "detail": f'No line named "{DEFAULT_LINE}" — nothing to send from.'}
    else:
        m = line_match(data, w)
        if not m.get("line"):
            return {"error": "no_sending_line",
                    "detail": f'The situation says it sends from "{w}" and {m["why"]} — nothing was sent. Blank the '
                              f'"Sends from" cell to send from {DEFAULT_LINE}.'}
        hit = m["line"]
    users = hit.get("users") if isinstance(hit.get("users"), list) else []
    uid = gsjs.str_(users[0].get("id")) if users and isinstance(users[0], dict) else ""
    return {"from": gsjs.str_(hit.get("number")), "userId": uid, "line": w or DEFAULT_LINE}


def verdict(code: int, text: str) -> dict[str, Any]:
    """rpcProviderVerdict_: the provider's own sentence is never carried up."""
    if code >= 400:
        return _fail(f"provider_{code}", f"the provider refused with {code}")
    try:
        body = json.loads(text or "")
    except ValueError:
        body = None
    data = body.get("data") if isinstance(body, dict) else None
    mid = gsjs.str_(data.get("id")) if isinstance(data, dict) else ""
    if not mid:
        return _fail("provider_bad_shape", f"the provider answered {code} with no message id — nothing here proves "
                                           "anything was sent")
    return {"ok": True, "sent": True, "gated": False, "receipt": mid}


def _key() -> str:
    """The provider key, from the one file the environment names; never from the depot (it holds a withheld marker)."""
    path = os.getenv(KEY_FILE_ENV, "").strip()
    if not path:
        return ""
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def _http(method: str, url: str, key: str, payload: dict | None = None) -> tuple[int, str]:
    import urllib.error  # noqa: PLC0415 - only a send that passed every brake opens it
    import urllib.request  # noqa: PLC0415
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Authorization": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=PROVIDER_TIMEOUT_S) as res:  # noqa: S310 - a fixed https host
            return int(res.status), res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return int(exc.code), ""


def openphone(to: str, body: str, from_line: str, *, lines: dict | None = None) -> dict[str, Any]:
    """rpcOpenPhoneSms_ past its sinks: the line, then one POST, its verdict checked."""
    key = _key()
    if not key:
        return _fail("no_provider_key", f"No provider key file is named ({KEY_FILE_ENV}), so nothing can leave.")
    want = gsjs.str_(from_line)
    cache = lines if lines is not None else {}
    line = cache.get(want)
    if line is None:
        code, text = _http("GET", PROVIDER + "/phone-numbers", key)
        if code != 200:
            return _fail(f"provider_{code}", "The provider would not list our lines, so there is no number to send from.")
        try:
            listed = json.loads(text or "{}")
        except ValueError:
            listed = None
        data = listed.get("data") if isinstance(listed, dict) else None
        line = sender_pick(data if isinstance(data, list) else [], want)
        if not line.get("error"):
            cache[want] = line
    if line.get("error"):
        return _fail(line["error"], line["detail"])
    payload: dict[str, Any] = {"content": body, "from": line["from"], "to": [to]}
    if line.get("userId"):
        payload["userId"] = line["userId"]
    code, text = _http("POST", PROVIDER + "/messages", key, payload)
    return verdict(code, text)


def platform_letter(to: str, subject: str, body: str, *, key: str = "", from_account: str = "",
                    html: str = "", cc: str = "") -> dict[str, Any]:
    """platformMailOut_ past its sinks: one letter from a platform mailbox (the first, unless the ask names another)
    straight to the mail server over SMTP, filed in its Sent — never through the relay or Apps Script."""
    import mail_server as MB  # noqa: PLC0415 - only a letter that passed every brake opens it
    box = MB.creds(from_account)
    if box is None:
        return _fail("no_mailbox", "The platform's mailbox is not wired here (PLATFORM_EMAIL and its password), so no "
                                   "letter can leave.")
    # the platform's own voice carries its name; a numbered mailbox is somebody's and keeps its bare address
    name = MAIL_FROM_NAME if box["id"] == "1" else ""
    try:
        got = MB.send(box["user"], box["password"], to, subject, body, html=html, cc=cc, from_name=name)
    except Exception as exc:  # noqa: BLE001 - the class of the failure, never the conversation (it may hold the login)
        return _fail("smtp_failed", f"the mail server did not take the letter ({type(exc).__name__})")
    return {"ok": True, "sent": True, "gated": False, "receipt": gsjs.str_(got.get("message_id") or got.get("receipt"))}


# the transports the drain calls; a check swaps in its own
TRANSPORT: Callable[..., dict[str, Any]] = openphone
LETTER: Callable[..., dict[str, Any]] = platform_letter
