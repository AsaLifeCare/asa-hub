"""Company notices: one stored notice per event, judged per reader in Requests' terms when read.
A call-off's reason is never stored.

The relay's server/web_notices.py on the app's connections: its tables (asa_hub_notices, asa_hub_notice_reads) are the
relay's own in asa-hub-db's schema app (lanes_db), and every reader it asks (shift_requests, time_off,
house_directory, psi_reminders) is the app's copy. The bell reads and the read marks run here; the catch-up publisher
and its fan-out still run in the relay."""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable
from zoneinfo import ZoneInfo

import lanes_db as hub_db
import lanes_pg as psycopg2

log = logging.getLogger("hub.notices")

OHIO = ZoneInfo("America/New_York")

# one row per event key; `facts` is cut per reader before anything leaves the relay
NOTICES_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_hub_notices ("
    "id BIGSERIAL PRIMARY KEY, key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, "
    "at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "location TEXT NOT NULL DEFAULT '', col_iso TEXT NOT NULL DEFAULT '', "
    "ref TEXT NOT NULL DEFAULT '', value TEXT NOT NULL DEFAULT '', "
    "facts JSONB NOT NULL DEFAULT '{}'::jsonb, "
    "created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
)
NOTICES_AT_DDL = "CREATE INDEX IF NOT EXISTS asa_hub_notices_created ON asa_hub_notices (created_at DESC)"
# stored under test mode: the mock row is its only delivery, never released later
NOTICES_HELD_DDL = ("ALTER TABLE asa_hub_notices ADD COLUMN IF NOT EXISTS held_test "
                    "BOOLEAN NOT NULL DEFAULT false")
# reads and dismissals, keyed by account
READS_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_hub_notice_reads ("
    "user_id TEXT NOT NULL, notice_id BIGINT NOT NULL, "
    "read_at TIMESTAMPTZ NOT NULL DEFAULT now(), dismissed_at TIMESTAMPTZ, "
    "PRIMARY KEY (user_id, notice_id))"
)
DDL = (NOTICES_DDL, NOTICES_AT_DDL, NOTICES_HELD_DDL, READS_DDL)

# how far back catch-up looks; bounds the first run
LOOKBACK_MIN = int(os.getenv("HUB_NOTICES_LOOKBACK_MIN", "120"))
# How many days of notices a bell holds.
INBOX_DAYS = int(os.getenv("HUB_NOTICES_INBOX_DAYS", "14"))
INBOX_LIMIT = int(os.getenv("HUB_NOTICES_INBOX_LIMIT", "60"))
# notices judged per page; past the maximum the answer says `truncated`
INBOX_PAGE = int(os.getenv("HUB_NOTICES_INBOX_PAGE", "400"))
INBOX_SCAN_MAX = int(os.getenv("HUB_NOTICES_INBOX_SCAN_MAX", "6000"))
# the most ids one read-mark may carry
READ_MAX_IDS = 500

# The catalogue: every kind, its audience and its event key; the audience is read from here only.
K_CALL_OFF = "call_off"                  # a call-off opened a shift to applications
K_OPEN_SHIFT = "open_shift"              # a published day's OPEN row opened its window
K_APPLICATION = "application"            # somebody applied (to the house manager)
K_TRAINING = "training_needed"           # an IST approval is waiting on the house manager
K_WINDOW_CLOSED = "window_closed"        # applications closed with people on it
K_DECIDED = "decided"                    # the house manager approved or assigned somebody
K_NOT_CHOSEN = "not_chosen"              # the shift went to somebody else (to that applicant)
K_WITHDRAWN = "withdrawn"                # an application was taken back
K_TRAINING_DECIDED = "training_decided"  # the house manager took the training on, or did not
K_FILLED = "filled"                      # a shift got its person (who took the latest shifts)
K_SWAP_OFFERED = "swap_offered"          # a shift was offered to somebody
K_SWAP_ANSWERED = "swap_answered"        # the receiver or the house manager answered
K_SWAP_DONE = "swap_done"                # both said yes and the shift moved
K_SWAP_ENDED = "swap_ended"              # it died for a reason that was not a no
K_NO_SHOW = "no_call_no_show"            # the punch board's no_punch verdict
K_LATE_CALL = "late_call"                # somebody called to say they would be late
K_TO_ASKED = "time_off_asked"            # a time off request waits for its approvers
K_TO_DECIDED = "time_off_decided"        # one half of a time off request was answered
K_TO_SCHEDULED = "time_off_scheduled"    # both halves approved: the person is off
K_TO_ENDED = "time_off_ended"            # denied, withdrawn, cancelled or expired
TIME_OFF_KINDS = (K_TO_ASKED, K_TO_DECIDED, K_TO_SCHEDULED, K_TO_ENDED)

#: kind -> {who: the audiences, key: the event key's shape}
CATALOGUE: dict[str, dict[str, Any]] = {
    # a call-off reaches all staff online: invited if open to them, else the news; never who or why
    K_CALL_OFF: {"who": ("company", "decider", "invited", "staff"), "key": "call_off:<pool ref>"},
    K_OPEN_SHIFT: {"who": ("company", "decider", "invited"), "key": "open_shift:<pool ref>"},
    K_APPLICATION: {"who": ("company", "decider"), "key": "application:<request id>"},
    K_TRAINING: {"who": ("company", "decider", "theirs"), "key": "training:<request id>"},
    K_WINDOW_CLOSED: {"who": ("company", "decider"), "key": "window_closed:<pool ref>"},
    K_DECIDED: {"who": ("company", "decider", "theirs"), "key": "decided:<request id>"},
    K_NOT_CHOSEN: {"who": ("theirs",), "key": "not_chosen:<request id>"},
    K_WITHDRAWN: {"who": ("company", "decider"), "key": "withdrawn:<request id>"},
    K_TRAINING_DECIDED: {"who": ("company", "decider", "theirs"),
                         "key": "training_decided:<request id>"},
    # the attendance panel's, so deciders only
    K_FILLED: {"who": ("decider", "theirs"), "key": "filled:<pool ref>"},
    K_SWAP_OFFERED: {"who": ("company", "decider", "theirs"), "key": "swap_offered:<handoff id>"},
    K_SWAP_ANSWERED: {"who": ("company", "decider", "theirs"),
                      "key": "swap_staff:<handoff id> | swap_manager:<handoff id>"},
    K_SWAP_DONE: {"who": ("company", "decider", "theirs"), "key": "swap_done:<handoff id>"},
    K_SWAP_ENDED: {"who": ("company", "decider", "theirs"), "key": "swap_ended:<handoff id>"},
    # attendance too: never a caregiver
    K_NO_SHOW: {"who": ("decider",), "key": "no_show:<board shift id>"},
    K_LATE_CALL: {"who": ("decider",), "key": "late_call:<board shift id>"},
    # `:directors` — the directors named after a request filed while the list named nobody
    K_TO_ASKED: {"who": ("approver",), "key": "time_off_asked:<ref>[:directors]"},
    K_TO_DECIDED: {"who": ("theirs", "approver"), "key": "time_off_decided:<ref>:<leg>"},
    K_TO_SCHEDULED: {"who": ("theirs", "approver", "decider"), "key": "time_off_scheduled:<ref>"},
    K_TO_ENDED: {"who": ("theirs", "approver"), "key": "time_off_ended:<ref>:<status>"},
}

# kind -> the alert a director or the master may turn off for themselves in Settings > Alerts I receive…
RECEIVE_PART: dict[str, str] = {K_NO_SHOW: "no_call"}

# never stored, whoever hands them in
_NEVER_STORED = ("reason", "note")

# a swap ended by a "no" was already announced; older fixed sentences still count
_DECLINE_WHYS = ("the staff member declined", "the house manager did not approve")


def _ended_by_a_no(h: dict[str, Any]) -> bool:
    return ("declined" in (str(h.get("staff_state") or ""), str(h.get("manager_state") or ""),
                           str(h.get("director_state") or ""))
            or str(h.get("why") or "") in _DECLINE_WHYS)

# DDL once per process: CREATE INDEX IF NOT EXISTS still takes a table lock
_READY: set[str] = set()
_LISTENERS: list[Callable[[dict[str, Any]], None]] = []
# the switch probe (set_hold_probe); a probe that raises stores the notice held
_HOLD_PROBE: list[Callable[[], bool] | None] = [None]
_LATEST: dict[str, Any] = {"id": None}
_SEEN_LOCK = threading.Lock()
_SEEN: set[str] = set()


def _connect(dsn: str):
    return hub_db.connect(dsn)


def ensure(cur) -> None:
    for statement in DDL:
        cur.execute(statement)


def _ensure(cur, dsn: str) -> None:
    """The tables, once per process per database; a rolled-back caller `_forget`s the mark."""
    if dsn in _READY:
        return
    ensure(cur)
    _READY.add(dsn)


def _forget(dsn: str) -> None:
    _READY.discard(dsn)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value or "")


def _at(value: Any) -> datetime | None:
    """An instant from whatever a row carries, or None. A naive stamp is Ohio's."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=OHIO)
    try:
        got = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return got if got.tzinfo else got.replace(tzinfo=OHIO)


def fold(name: Any) -> str:
    """The platform's one name key — the same fold Requests matches rows with."""
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())


# publish — the one door every notice is written through

def on_publish(fn: Callable[[dict[str, Any]], None]) -> None:
    """Listen for stored notices; called on the publishing thread."""
    if fn not in _LISTENERS:
        _LISTENERS.append(fn)


def set_hold_probe(fn: Callable[[], bool] | None) -> None:
    """Set the switch probe asked as each notice is stored."""
    _HOLD_PROBE[0] = fn


# Each kind's own Smart Comms situation (lane_gate.notice_state): kind -> {armed, unreadable, why}.
_SITUATION_PROBE: list[Callable[[str], dict[str, Any]] | None] = [None]
_OFF_SAID: set[tuple[str, str]] = set()


def set_situation_probe(fn: Callable[[str], dict[str, Any]] | None) -> None:
    """Set the probe that says whether a notice kind's situation is switched on."""
    _SITUATION_PROBE[0] = fn


def situation(kind: str) -> dict[str, Any]:
    """{armed, why}: may a notice of this kind be stored? FAIL-CLOSED: no probe, or one that raises, is no."""
    probe = _SITUATION_PROBE[0]
    if probe is None:
        return {"armed": False, "why": "no situation switch was handed to this process"}
    try:
        got = probe(kind) or {}
    except Exception as exc:  # noqa: BLE001 — an unreadable switch is never a yes
        return {"armed": False, "why": f"the situation switch could not be read ({type(exc).__name__})"}
    return {"armed": got.get("armed") is True, "why": str(got.get("why") or got.get("unreadable") or "")}


def _held_now() -> bool:
    probe = _HOLD_PROBE[0]
    if probe is None:
        return False
    try:
        return bool(probe())
    except Exception as exc:  # noqa: BLE001 — unreadable is on
        log.warning("notices: the switch could not be read while storing (%s) — stored held",
                    type(exc).__name__)
        return True


def latest_id() -> int | None:
    """The newest notice id known, or None ("ask the inbox", never "nothing")."""
    got = _LATEST.get("id")
    return int(got) if got is not None else None


def prime(dsn: str) -> int | None:
    """Learn the newest id and recent keys from the table after a restart."""
    try:
        with _connect(dsn) as conn, conn.cursor() as cur:
            _ensure(cur, dsn)
            cur.execute("SELECT max(id) FROM asa_hub_notices")
            top = cur.fetchone()
            cur.execute("SELECT key FROM asa_hub_notices WHERE created_at > now() - interval '3 days'")
            keys = {r[0] for r in cur.fetchall()}
            conn.commit()
    except Exception:
        _forget(dsn)
        raise
    with _SEEN_LOCK:
        _SEEN.update(keys)
    newest = int(top[0]) if top and top[0] is not None else 0
    if _LATEST.get("id") is None or newest > int(_LATEST["id"] or 0):
        _LATEST["id"] = newest
    return latest_id()


def publish(kind: str, *, key: str, dsn: str, location: str = "", col_iso: str = "",
            ref: str = "", value: str = "", at: Any = None,
            facts: dict[str, Any] | None = None) -> dict[str, Any]:
    """Store one notice once per `key` and tell the listeners; never raises (worker thread)."""
    if kind not in CATALOGUE:
        log.warning("notices: %s was not stored — the kind is not in the catalogue", kind)
        return {"stored": False, "duplicate": False, "why": f"unknown kind {kind}"}
    key = str(key or "").strip()
    if not key:
        return {"stored": False, "duplicate": False, "why": "a notice needs an event key"}
    # EVERY NOTICE IS A SMART COMMS MESSAGE: a kind whose situation is off, or whose switch cannot be read, is not…
    gate = situation(kind)
    if not gate["armed"]:
        said = (kind, gate["why"])
        if said not in _OFF_SAID:
            _OFF_SAID.add(said)
            log.info("notices: %s is not stored — %s", kind, gate["why"])
        return {"stored": False, "duplicate": False, "off": True, "why": gate["why"]}
    clean = {k: v for k, v in (facts or {}).items() if k not in _NEVER_STORED}
    when = _at(at) or _now()
    held = _held_now()
    try:
        with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            _ensure(cur, dsn)
            cur.execute(
                "INSERT INTO asa_hub_notices (key, kind, at, location, col_iso, ref, value, facts, "
                "held_test) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (key) DO NOTHING "
                "RETURNING id, key, kind, at, location, col_iso, ref, value, facts, created_at, held_test",
                (key, kind, when, str(location or ""), str(col_iso or ""), str(ref or ""),
                 str(value or ""), json.dumps(clean, default=str), held))
            row = cur.fetchone()
            conn.commit()
    except Exception as exc:  # noqa: BLE001 — a notice must never break the act it reports
        _forget(dsn)
        log.warning("notices: %s %s could not be stored (%s)", kind, key, type(exc).__name__)
        return {"stored": False, "duplicate": False, "why": f"not stored ({type(exc).__name__})"}
    with _SEEN_LOCK:
        _SEEN.add(key)
    if not row:
        return {"stored": False, "duplicate": True, "why": "", "id": None}
    notice = _row_notice(dict(row))
    if _LATEST.get("id") is None or int(notice["id"]) > int(_LATEST["id"] or 0):
        _LATEST["id"] = int(notice["id"])
    for fn in list(_LISTENERS):
        try:
            fn(notice)
        except Exception as exc:  # noqa: BLE001 — a listener is a bonus, never a failure mode
            log.warning("notices: a listener failed on %s (%s)", key, type(exc).__name__)
    return {"stored": True, "duplicate": False, "why": "", "id": notice["id"]}


def _row_notice(row: dict[str, Any]) -> dict[str, Any]:
    facts = row.get("facts")
    if isinstance(facts, str):
        try:
            facts = json.loads(facts)
        except ValueError:
            facts = {}
    return {"id": int(row["id"]), "key": row["key"], "kind": row["kind"],
            "at": _iso(row.get("at")), "location": row.get("location") or "",
            "col_iso": row.get("col_iso") or "", "ref": row.get("ref") or "",
            "value": row.get("value") or "", "facts": facts if isinstance(facts, dict) else {},
            "published_at": _iso(row.get("created_at")), "held": bool(row.get("held_test"))}


# who hears it, in Requests' own terms

def _names_of(n: dict[str, Any]) -> set[str]:
    """The people a notice is ABOUT — the ones for whom it is `theirs`."""
    f = n.get("facts") or {}
    kind = n.get("kind")
    if kind in (K_TRAINING, K_DECIDED, K_NOT_CHOSEN, K_TRAINING_DECIDED):
        return {fold(f.get("person"))} - {""}
    if kind == K_FILLED:
        # only a direct ledger claim tells its person here; a decision already did
        how = str(f.get("how") or "")
        return ({fold(f.get("person"))} - {""}) if how not in ("approved", "assigned") else set()
    if kind in (K_SWAP_OFFERED, K_SWAP_ANSWERED, K_SWAP_DONE, K_SWAP_ENDED):
        return {fold(f.get("from")), fold(f.get("to")), fold(f.get("manager"))} - {""}
    if kind in TIME_OFF_KINDS:
        return {fold(f.get("person"))} - {""}
    return set()


def _approves(n: dict[str, Any], who: dict[str, Any]) -> bool:
    """A time off notice's approver: a name on the request's list, as the lane matches its directors."""
    import time_off  # noqa: PLC0415 — the one rule of who is a listed name
    me = str(who.get("name") or "")
    return bool(fold(me)) and any(time_off.named_as(me, a)
                                  for a in (n.get("facts") or {}).get("approvers") or [])


def _decides_a_house(n: dict[str, Any], who: dict[str, Any],
                     decides: Callable[[dict[str, Any], str], bool]) -> bool:
    houses = (n.get("facts") or {}).get("houses") or []
    return any(decides(who, str(h)) for h in houses if str(h).strip())


def audience(n: dict[str, Any], who: dict[str, Any], *,
             eligible: Callable[[dict[str, Any], str], bool] | None = None,
             may_decide: Callable[[dict[str, Any], str], bool] | None = None) -> str:
    """This reader's one role for the notice ('theirs', 'invited', 'decider', 'company', 'staff', 'approver') or ''."""
    spec = CATALOGUE.get(str(n.get("kind") or ""))
    if not spec:
        return ""
    # a reader who turned this alert off for themselves never hears it, whatever role they would have had
    part = RECEIVE_PART.get(str(n.get("kind") or ""))
    if part and part in (who.get("alerts_off") or ()):
        return ""
    allowed = spec["who"]
    me = fold(who.get("name"))
    decides = may_decide or _may_decide
    if "theirs" in allowed and me and me in _names_of(n):
        return "theirs"
    if n.get("kind") in TIME_OFF_KINDS:
        # the master's own session reads every approver's notice
        if "approver" in allowed and (_approves(n, who) or who.get("is_master") is True):
            return "approver"
        if "decider" in allowed and _decides_a_house(n, who, decides):
            return "decider"
        return ""
    # the caller is never invited to, nor told of, their own call-off
    caller = fold((n.get("facts") or {}).get("caller"))
    location = str(n.get("location") or "")
    if "invited" in allowed and me and eligible is not None and caller != me:
        try:
            if eligible(n, str(who.get("name") or "")):
                return "invited"
        except Exception:
            # eligibility unreadable: deciders still hear it, anybody else raises
            if not (("decider" in allowed and decides(who, location))
                    or ("company" in allowed and who.get("whole_company"))):
                raise
    if "decider" in allowed and decides(who, location):
        return "decider"
    if "company" in allowed and who.get("whole_company"):
        return "company"
    worn = {str(b).strip().upper() for b in who.get("badges") or ()}
    # an SSA or a FAMILY is never the staff a call-off is news to, whatever its role or name says
    if "staff" in allowed and (not me or caller != me) and (me or "STAFF" in worn) and not worn & {"FAMILY", "SSA"}:
        return "staff"
    return ""


def _may_decide(who: dict[str, Any], location: str) -> bool:
    import shift_requests  # noqa: PLC0415 — lazy: shift_requests is heavy and imports back nothing
    return bool(location) and shift_requests.may_decide(who, location)


def _sees_house(who: dict[str, Any], location: str) -> bool:
    import shift_requests  # noqa: PLC0415 — the one rule of who reads a house whole
    return bool(location) and shift_requests.sees_house(who, location)


# the words — one reader's copy of one notice

def day_label(col_iso: str) -> str:
    """An ISO day → 'Tue 9/23'. A column that is not a day is said as written."""
    try:
        y, m, d = (int(p) for p in str(col_iso).split("-")[:3])
        got = date(y, m, d)
    except Exception:  # noqa: BLE001
        return str(col_iso or "")
    return f"{got.strftime('%a')} {got.month}/{got.day}"


def clock_label(iso: Any) -> str:
    """An instant as Ohio's clock: '3:45 PM'."""
    got = _at(iso)
    if got is None:
        return ""
    local = got.astimezone(OHIO)
    return f"{local.hour % 12 or 12}:{local.minute:02d} {'AM' if local.hour < 12 else 'PM'}"


def _house(n: dict[str, Any]) -> str:
    f = n.get("facts") or {}
    if f.get("house"):
        return str(f["house"])
    try:
        import house_directory  # noqa: PLC0415
        loc = str(n.get("location") or "")
        return house_directory.label_of(loc, house_directory.code_of(loc)) or loc or "the house"
    except Exception:  # noqa: BLE001
        return str(n.get("location") or "the house")


# the old Shift Board address redirects here
REQUESTS_HREF = "/app/calendarbuilder/requests"
HOUSE_CAL_HREF = "/app/calendarbuilder/house-cal"


def _href(tab: str, ref: str = "") -> str:
    return f"{REQUESTS_HREF}?tab={tab}" + (f"&ref={ref}" if ref else "")


def _cal_href(location: str, col_iso: str, ref: str) -> str:
    """Calendar Builder → Live with the shift in its panel, named by house, day and ref, never by roster row."""
    query = urllib.parse.urlencode({"house": location, "day": col_iso, "ref": ref},
                                   quote_via=urllib.parse.quote)
    return f"{HOUSE_CAL_HREF}?{query}"


# Live's doors' own test, so a link never points at a 403; others go to Requests
def reads_calendars(who: dict[str, Any]) -> bool:
    import shift_requests  # noqa: PLC0415 — lazy: shift_requests is heavy and imports back nothing
    return shift_requests.may_view_calendars(who)


# deciders are sent to the cell itself
_CELL_KINDS = (K_CALL_OFF, K_OPEN_SHIFT)


def shape(n: dict[str, Any], role: str, who: dict[str, Any], *, quiet: bool = False) -> dict[str, Any]:
    """The only copy that leaves: no `facts`, the caller only for readers of that house; `quiet` keeps it off the OS."""
    f = n.get("facts") or {}
    kind = n["kind"]
    house = _house(n)
    day = day_label(n.get("col_iso") or "")
    ref = str(n.get("ref") or "")
    person = str(f.get("person") or "someone")
    by = str(f.get("by") or "the house manager")
    whole = bool(who.get("whole_company"))
    # a house's own manager reads it as the whole company does
    here = whole or _sees_house(who, str(n.get("location") or ""))
    me = fold(who.get("name"))
    window = f.get("window") if isinstance(f.get("window"), dict) else {}
    closes = clock_label(window.get("closes_at"))
    title, body, tab, priority, tone = "", "", "all", "normal", ""

    if kind == K_CALL_OFF:
        tone = "urgent"
        priority = "high"
        caller = str(f.get("caller") or "") if here else ""
        if role == "invited":
            title = f"Open shift at {house} — somebody called off"
            body = (f"{caller + ' called off · ' if caller else ''}{day} · {{shift}}"
                    + (f" · apply by {closes}" if closes else "") + _also_decides(n, who))
            tab = "me"
        elif role == "decider" and window.get("state") == "manager_only" and reads_calendars(who):
            title = f"Call-off at {house} — assign it now"
            body = (f"{caller + ' called off · ' if caller else ''}{day} · {{shift}} · "
                    "it starts too soon for applications")
            tab = "calloffs"
        elif role == "decider" and window.get("state") == "manager_only":
            # this reader cannot open Calendar Builder → Live, so it is told as news
            title = f"Call-off at {house} — it starts too soon for applications"
            body = (f"{caller + ' called off · ' if caller else ''}{day} · {{shift}} · "
                    "somebody has to be placed on it from Calendar Builder → Live")
            tab = "calloffs"
        elif role == "staff":
            # the news: a toast, never the pin or a push
            tone = ""
            title = f"Call-off at {house}"
            body = f"{day} · {{shift}}"
            tab = "calloffs"
        elif role == "decider":
            title = f"Call-off at {house}"
            body = (f"{caller + ' called off · ' if caller else ''}{day} · {{shift}}"
                    + (f" · applications until {closes}, then you decide" if closes else ""))
            tab = "calloffs"
        else:
            title = f"Call-off at {house}"
            body = f"{caller + ' called off · ' if caller else ''}{day} · {{shift}}"
            tab = "calloffs"
    elif kind == K_OPEN_SHIFT:
        if role == "invited":
            # urgent to the invited, quiet to everybody else
            title, priority, tab, tone = f"Open shift at {house}", "high", "me", "urgent"
            body = (f"{day} · {{shift}}" + (f" · for {house}'s own staff until {closes}" if closes else "")
                    + _also_decides(n, who))
        else:
            title, tab = f"Open shift published at {house}", "houses" if whole else "mine"
            body = f"{day} · {{shift}}" + (
                f" · applications until {closes}, then {'you decide' if role == 'decider' else 'the house manager decides'}"
                if closes else "")
    elif kind == K_APPLICATION:
        title = f"{person} applied for a shift at {house}"
        body = f"{day} · {{shift}}"
        if str(f.get("state") or "") == "needs_training_approval":
            body += " · no IST for this house yet, so it needs a training approval"
        if role == "decider":
            priority, tab = "high", "mine"
            body += " · you decide when applications close"
    elif kind == K_TRAINING:
        why = str(f.get("why") or "")
        if role == "theirs":
            title = "Your shift needs the house manager's training approval"
            body = f"{house} · {day} · {{shift}}" + (f" — {why}" if why else "")
        else:
            title = f"Training approval waiting — {person} at {house}"
            body = f"{day} · {{shift}}" + (f" — {why}" if why else "")
            if role == "decider":
                priority, tab = "high", "mine"
    elif kind == K_WINDOW_CLOSED:
        count = int(f.get("applicants") or 0)
        people = f"{count} applicant{'s' if count != 1 else ''}"
        if role == "decider":
            title, priority, tab = f"Applications closed at {house} — your decision", "high", "mine"
            body = f"{day} · {{shift}} · {people} waiting"
        else:
            title = f"Applications closed at {house}"
            body = f"{day} · {{shift}} · {people} · the house manager decides"
    elif kind == K_DECIDED:
        how = "assigned" if str(f.get("how") or "") == "assigned" else "approved"
        if role == "theirs":
            title, priority, tone = f"You have the shift at {house}", "high", "good"
            body = f"{day} · {{shift}} · {how} by {by}"
        else:
            title = f"{person} takes the shift at {house}"
            body = f"{day} · {{shift}} · {how} by {by}"
    elif kind == K_NOT_CHOSEN:
        title = f"The shift at {house} went to someone else"
        body = f"{day} · {{shift}} · the house manager decided"
        priority = "high"
    elif kind == K_WITHDRAWN:
        title = f"{person} withdrew an application at {house}"
        body = f"{day} · {{shift}}"
    elif kind == K_TRAINING_DECIDED:
        yes = str(f.get("state") or "") == "approved"
        if role == "theirs":
            priority = "high"
            if yes:
                title, tone = "Training approved — your application stands", "good"
                body = f"{house} · {day} · {{shift}} · approved by {by}"
            else:
                title = "The house manager did not take the training on"
                body = f"{house} · {day} · {{shift}} · your application was not accepted"
        else:
            title = (f"{by} approved training for {person} at {house}" if yes
                     else f"{by} did not take on training for {person} at {house}")
            body = f"{day} · {{shift}}"
    elif kind == K_FILLED:
        if role == "theirs":
            title, priority, tone = f"You have the shift at {house}", "high", "good"
            body = f"{day} · {{shift}}"
        else:
            title = f"{person} took the shift at {house}"
            body = f"{day} · {{shift}} · {_how_words(f.get('how'))}"
            tab = "attendance" if here else "all"
    elif kind in (K_SWAP_OFFERED, K_SWAP_ANSWERED, K_SWAP_DONE, K_SWAP_ENDED):
        title, body, priority, tone, tab = _swap_words(kind, f, role, me, house, day)
    elif kind == K_NO_SHOW:
        title, priority, tone, tab = f"No-call no-show at {house}: {person}", "high", "urgent", "attendance"
        minutes = f.get("minutes")
        body = f"{day} · {{shift}}" + (
            f" · nothing on the clock {minutes} minutes after the start" if minutes else "")
    elif kind == K_LATE_CALL:
        title, tab = f"{person} called to say they will be late at {house}", "attendance"
        body = f"{day} · {{shift}}"
    elif kind in TIME_OFF_KINDS:
        title, body, priority, tone = _time_off_words(kind, f, role)
        house = ", ".join(str(h) for h in f.get("house_labels") or f.get("houses") or []) or house
    if tab in ("houses", "attendance") and not (whole or who.get("manages")):
        # only a tab this reader's Requests draws
        tab = "mine"
    href = _href(tab, ref)
    if kind in TIME_OFF_KINDS:
        href = f"{TIME_OFF_HREF}?ref={ref}"
    location, col_iso = str(n.get("location") or ""), str(n.get("col_iso") or "")
    if (kind in _CELL_KINDS and role in ("decider", "company") and reads_calendars(who)
            and location and col_iso and ref):
        href = _cal_href(location, col_iso, ref)
    # an invitation expires with its window
    expires = str(window.get("closes_at") or "") if (
        role == "invited" and kind in _CELL_KINDS) else ""
    # `held`: stored under test mode; the browser never draws such a copy
    return {"id": n["id"], "kind": kind, "role": role, "at": n.get("at") or "",
            "published_at": n.get("published_at") or "", "title": title, "body": body,
            "shift": n.get("value") or "", "house": house, "col_iso": col_iso,
            "ref": ref, "href": href, "priority": priority, "tone": tone,
            "expires_at": expires, "held": bool(n.get("held")), "quiet": bool(quiet)}


TIME_OFF_HREF = "/app/timeoff/requests"


def _span_words(f: dict[str, Any]) -> str:
    a, b = day_label(str(f.get("start") or "")), day_label(str(f.get("end") or ""))
    return a if not b or a == b else f"{a} – {b}"


def _time_off_words(kind: str, f: dict[str, Any], role: str) -> tuple[str, str, str, str]:
    """(title, body, priority, tone) for a time off notice; never a reason or a decider's words."""
    person = str(f.get("person") or "someone")
    span = _span_words(f)
    status = str(f.get("status") or "")
    if kind == K_TO_ASKED:
        return (f"Time off waiting for your approval — {person}", f"{span} · open it to approve or deny",
                "high", "")
    if kind == K_TO_DECIDED:
        half = "house manager" if f.get("leg") == "hm" else "director"
        said = "approved" if f.get("word") == "approve" else "did not approve"
        if role == "theirs":
            return (f"Your time off: the {half} {said}", f"{span} · by {f.get('by') or 'an approver'}",
                    "normal", "")
        return (f"Time off for {person}: the {half} half was answered", f"{span} · {said} by {f.get('by') or '—'}",
                "normal", "")
    if kind == K_TO_SCHEDULED:
        if role == "theirs":
            return ("Your time off is scheduled", f"{span} · approved by the house manager and a director",
                    "high", "good")
        return (f"{person} is off {span}", "approved by the house manager and a director", "normal", "good")
    words = {"denied": "was not approved", "withdrawn": "was withdrawn", "cancelled": "was cancelled",
             "expired": "was not answered before it ended"}.get(status, "is closed")
    if role == "theirs":
        return (f"Your time off request {words}", span, "high" if status in ("denied", "cancelled") else "normal", "")
    return (f"Time off for {person} {words}", span, "normal", "")


def _also_decides(n: dict[str, Any], who: dict[str, Any]) -> str:
    """The line an invitation carries for a reader who also decides that house."""
    try:
        return " · you decide when applications close" if _may_decide(
            who, str(n.get("location") or "")) else ""
    except Exception:  # noqa: BLE001 — the invitation stands without the line
        return ""


def _how_words(how: Any) -> str:
    how = str(how or "")
    return {"approved": "applied and approved", "assigned": "assigned by the house manager"}.get(
        how, "placed by the desk")


def _swap_words(kind: str, f: dict[str, Any], role: str, me: str, house: str,
                day: str) -> tuple[str, str, str, str, str]:
    giver, taker = str(f.get("from") or "someone"), str(f.get("to") or "someone")
    manager = fold(f.get("manager"))
    am_giver, am_taker = me and me == fold(giver), me and me == fold(taker)
    # only the manager named on the swap is asked; other deciders get the news
    asks_me = bool(me) and me == manager
    where = f"{house} · {day} · {{shift}}"
    if kind == K_SWAP_OFFERED:
        if am_taker:
            return (f"{giver} wants to give you a shift", f"{where} · accept or decline it",
                    "high", "", "mine")
        if am_giver:
            return (f"Your shift offer went to {taker}", f"{where} · waiting for {taker} and the house manager",
                    "normal", "", "all")
        return (f"Swap asked at {house}: {giver} → {taker}",
                f"{day} · {{shift}} · waiting for {taker}" + (" and your approval" if asks_me else ""),
                "high" if asks_me else "normal", "", "mine" if asks_me else "all")
    if kind == K_SWAP_ANSWERED:
        side, word = str(f.get("side") or ""), str(f.get("word") or "")
        if side == "staff" and word == "accepted":
            if asks_me:
                return (f"{taker} accepted {giver}'s shift — approve it?", where, "high", "", "mine")
            if am_giver:
                return (f"{taker} accepted your shift", f"{where} · waiting for the house manager",
                        "high", "", "all")
            return (f"{taker} accepted {giver}'s shift at {house}", f"{day} · {{shift}}", "normal", "", "all")
        if side == "staff":
            return ((f"{taker} declined your shift" if am_giver
                     else f"{taker} declined {giver}'s shift at {house}"),
                    where, "high" if am_giver else "normal", "", "all")
        if side == "director":
            by = str(f.get("by") or "") or "The director"
            if word == "approved":
                return (f"{by} approved {giver} → {taker} at {house} as director",
                        f"{day} · {{shift}}", "normal", "", "all")
            return (f"{by} did not approve {giver} → {taker} at {house} as director",
                    f"{day} · {{shift}}", "high" if (am_giver or am_taker) else "normal", "", "all")
        if word == "approved":
            return (f"The house manager approved {giver} → {taker} at {house}", f"{day} · {{shift}}",
                    "normal", "", "all")
        return (f"The house manager did not approve {giver} → {taker} at {house}", f"{day} · {{shift}}",
                "high" if (am_giver or am_taker) else "normal", "", "all")
    if kind == K_SWAP_DONE:
        if am_taker:
            return (f"The swap is done — you have {giver}'s shift", where, "high", "good", "all")
        return (f"The swap is done — {taker} has {giver}'s shift at {house}", f"{day} · {{shift}}",
                "normal", "good", "all")
    why = str(f.get("why") or "")
    return (f"The swap {giver} → {taker} did not go through", f"{where}" + (f" — {why}" if why else ""),
            "high" if (am_giver or am_taker) else "normal", "", "all")


# one reader, many notices — and one notice, many readers

class _Ctx:
    """What the invitation question needs, read once per call."""

    def __init__(self, dsn: str, now: datetime | None = None) -> None:
        self.dsn, self.now = dsn, now or _now()
        self._pool: dict[str, dict[str, Any]] | None = None
        self._view: dict[str, Any] | None = None
        self._ist: dict[str, Any] | None = None
        self._memo: dict[tuple[str, str], bool] = {}

    def pool(self) -> dict[str, dict[str, Any]]:
        if self._pool is None:
            import shift_requests  # noqa: PLC0415
            self._pool = {p["ref"]: p for p in shift_requests.pool(self.dsn, now=self.now)}
        return self._pool

    def eligible(self, n: dict[str, Any], person: str) -> bool:
        """Would the apply door take this application now? Asked of the door's own function."""
        if n.get("kind") not in (K_CALL_OFF, K_OPEN_SHIFT) or not person.strip():
            return False
        memo = (str(n.get("ref") or ""), fold(person))
        if memo in self._memo:
            return self._memo[memo]
        self._memo[memo] = answer = self._eligible(n, person)
        return answer

    def _eligible(self, n: dict[str, Any], person: str) -> bool:
        import shift_requests  # noqa: PLC0415
        closes = _at(((n.get("facts") or {}).get("window") or {}).get("closes_at"))
        if closes is not None and closes <= self.now:
            return False  # the window it was published with is over; nothing to invite to
        row = self.pool().get(str(n.get("ref") or ""))
        if not row or row.get("filled_by") or row.get("state") != shift_requests.WINDOW_OPEN:
            return False
        if any(fold(a.get("person")) == fold(person) for a in row.get("applicants") or []):
            return False  # already on it; the list shows them their own row
        if self._view is None:
            self._view = shift_requests.estate(self.dsn)
        if self._ist is None:
            self._ist = shift_requests.ist_index(self.dsn)
        got = shift_requests.eligibility(
            self.dsn, location=row["location"], open_row=row["open_row"], col_iso=row["col_iso"],
            person=person, now=self.now, view=self._view, ist=self._ist)
        return bool(got.get("may"))


class Unjudged:
    """A reader whose audience question failed; never "not theirs". Falsy."""

    __slots__ = ("why",)

    def __init__(self, why: str) -> None:
        self.why = why

    def __bool__(self) -> bool:
        return False

    def __repr__(self) -> str:
        return f"Unjudged({self.why!r})"


def quiet_now(now: datetime | None = None) -> bool:
    """Does the quiet window hold now (psi_reminders.quiet)? Unreadable holds."""
    try:
        import psi_reminders  # noqa: PLC0415 — the window has one home on this relay
        return bool(psi_reminders.quiet(now or _now()))
    except Exception:  # noqa: BLE001
        return True


def for_viewer(dsn: str, notices: Iterable[dict[str, Any]], who: dict[str, Any], *,
               ctx: Any = None) -> list[dict[str, Any]]:
    """Every notice this reader hears, as they may see it, newest first."""
    ctx = ctx or _Ctx(dsn)
    quiet = quiet_now(ctx.now)
    out = []
    for n in notices:
        role = audience(n, who, eligible=ctx.eligible)
        if role:
            out.append(shape(n, role, who, quiet=quiet))
    return out


def for_viewers(dsn: str, notice: dict[str, Any], whos: list[dict[str, Any]], *,
                ctx: Any = None) -> list[dict[str, Any] | Unjudged | None]:
    """One notice per reader: a copy, None (not theirs) or Unjudged; one failure never silences the rest."""
    ctx = ctx or _Ctx(dsn)
    quiet = quiet_now(ctx.now)
    deciders = "decider" in (CATALOGUE.get(str(notice.get("kind") or "")) or {}).get("who", ())
    out: list[dict[str, Any] | Unjudged | None] = []
    for who in whos:
        if deciders and who.get("managers_readable") is False and not who.get("decides_everywhere"):
            out.append(Unjudged("the hotline calendar's house managers could not be read"))
            continue
        try:
            role = audience(notice, who, eligible=ctx.eligible)
        except Exception as exc:  # noqa: BLE001 — one reader's question never silences the rest
            log.warning("notices: %s could not be judged for one reader (%s)",
                        notice.get("key"), type(exc).__name__)
            out.append(Unjudged(f"the audience question failed ({type(exc).__name__})"))
            continue
        out.append(shape(notice, role, who, quiet=quiet) if role else None)
    return out


def inbox(dsn: str, *, who: dict[str, Any], uid: str, since: int = 0,
          limit: int = INBOX_LIMIT, held: str = "") -> dict[str, Any]:
    """This reader's bell — {notices, unread, seq}; raises on a failed read; `held` returns no notice at all."""
    limit = max(1, min(int(limit or INBOX_LIMIT), 200))
    since = max(0, int(since or 0))
    if held:
        try:
            with _connect(dsn) as conn, conn.cursor() as cur:
                _ensure(cur, dsn)
                cur.execute("SELECT max(id) FROM asa_hub_notices")
                top = (cur.fetchone() or [None])[0]
                conn.commit()
        except Exception:
            _forget(dsn)
            raise
        return {"notices": [], "unread": 0, "seq": int(top) if top is not None else 0,
                "since": since, "me": str(who.get("name") or ""), "held": str(held)}
    # the whole window is judged page by page (`truncated` past the max); `seq` is read first and bounds the rows
    ctx = _Ctx(dsn)
    heard: list[dict[str, Any]] = []
    scanned, truncated = 0, False
    try:
        with _connect(dsn) as conn, conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            _ensure(cur, dsn)
            cur.execute("SELECT max(id) AS top FROM asa_hub_notices")
            top = (cur.fetchone() or {}).get("top")
            below = int(top) + 1 if top is not None else 0
            while top is not None and below > since + 1:
                cur.execute(
                    "SELECT id, key, kind, at, location, col_iso, ref, value, facts, created_at, held_test "
                    "FROM asa_hub_notices WHERE created_at > now() - make_interval(days => %s) "
                    "AND id > %s AND id < %s AND NOT held_test ORDER BY id DESC LIMIT %s",
                    (INBOX_DAYS, since, below, INBOX_PAGE))
                rows = [_row_notice(dict(r)) for r in cur.fetchall()]
                if not rows:
                    break
                scanned += len(rows)
                below = min(r["id"] for r in rows)
                reads: dict[int, dict[str, Any]] = {}
                if uid:
                    cur.execute("SELECT notice_id, read_at, dismissed_at FROM asa_hub_notice_reads "
                                "WHERE user_id=%s AND notice_id = ANY(%s)",
                                (str(uid), [r["id"] for r in rows]))
                    reads = {int(r["notice_id"]): dict(r) for r in cur.fetchall()}
                for s in for_viewer(dsn, rows, who, ctx=ctx):
                    mark = reads.get(int(s["id"])) or {}
                    if mark.get("dismissed_at"):
                        continue
                    heard.append({**s, "read": bool(mark.get("read_at"))})
                if len(rows) < INBOX_PAGE:
                    break
                if scanned >= INBOX_SCAN_MAX:
                    truncated = True
                    break
            conn.commit()
    except Exception:
        _forget(dsn)
        raise
    if top is not None and (_LATEST.get("id") is None or int(top) > int(_LATEST["id"] or 0)):
        _LATEST["id"] = int(top)
    return {"notices": heard[:limit], "unread": sum(1 for s in heard if not s["read"]),
            "seq": int(top) if top is not None else 0, "since": since,
            "me": str(who.get("name") or ""), "held": "", "truncated": truncated}


# a client-role reader hears who takes a shift at its own houses, and nothing else

# the kinds that say who will work at a house: never an invitation, an application, a call-off, attendance or time off
HOUSE_NEWS_KINDS = (K_DECIDED, K_FILLED, K_SWAP_DONE)
_HOUSE_CODE = re.compile(r"[A-Z]{2,4}\d{3,6}")


def house_code(n: dict[str, Any]) -> str:
    """The code of the house a notice is at, from its location; '' when it names none."""
    import house_directory  # noqa: PLC0415 — the one reading of a location's code
    code = house_directory.code_of(n.get("location"))
    return code if _HOUSE_CODE.fullmatch(code) else ""


def house_copy(n: dict[str, Any], houses: Iterable[str]) -> dict[str, Any] | None:
    """A client-role reader's copy of a notice at one of `houses`: who takes the shift, its day and its shift…"""
    kind = n.get("kind")
    if kind not in HOUSE_NEWS_KINDS or n.get("held"):
        return None
    code = house_code(n)
    if not code or code not in {str(h).strip().upper() for h in houses or ()}:
        return None
    f = n.get("facts") or {}
    if kind == K_FILLED and str(f.get("how") or "") in ("approved", "assigned"):
        # its decision already said it
        return None
    person = str((f.get("to") if kind == K_SWAP_DONE else f.get("person")) or "").strip()
    if not fold(person):
        return None
    return {"id": n["id"], "kind": kind, "title": f"{person} takes the shift at {_house(n)}",
            "body": " · ".join(x for x in (day_label(n.get("col_iso") or ""), str(n.get("value") or "").strip()) if x),
            "at": n.get("at") or "", "published_at": n.get("published_at") or "", "house": code}


def house_news(dsn: str, *, houses: Iterable[str], uid: str, limit: int = INBOX_LIMIT,
               held: str = "") -> dict[str, Any]:
    """{notices, unread, held, truncated}: house_copy of the notices of the last INBOX_DAYS days at `houses`…"""
    codes = sorted({c for c in (str(h or "").strip().upper() for h in houses or ()) if _HOUSE_CODE.fullmatch(c)})
    limit = max(1, min(int(limit or INBOX_LIMIT), 200))
    if held or not codes:
        return {"notices": [], "unread": 0, "held": str(held or ""), "truncated": False}
    try:
        with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            _ensure(cur, dsn)
            cur.execute(
                "SELECT id, key, kind, at, location, col_iso, ref, value, facts, created_at, held_test "
                "FROM asa_hub_notices WHERE created_at > now() - make_interval(days => %s) "
                "AND kind = ANY(%s) AND NOT held_test ORDER BY id DESC LIMIT %s",
                (INBOX_DAYS, list(HOUSE_NEWS_KINDS), INBOX_SCAN_MAX))
            rows = [_row_notice(dict(r)) for r in cur.fetchall()]
            copies = [c for c in (house_copy(r, codes) for r in rows) if c]
            reads: dict[int, dict[str, Any]] = {}
            if uid and copies:
                cur.execute("SELECT notice_id, read_at, dismissed_at FROM asa_hub_notice_reads "
                            "WHERE user_id=%s AND notice_id = ANY(%s)", (str(uid), [c["id"] for c in copies]))
                reads = {int(r["notice_id"]): dict(r) for r in cur.fetchall()}
            conn.commit()
    except Exception:
        _forget(dsn)
        raise
    heard = []
    for c in copies:
        mark = reads.get(int(c["id"])) or {}
        if not mark.get("dismissed_at"):
            heard.append({**c, "read": bool(mark.get("read_at"))})
    return {"notices": heard[:limit], "unread": sum(1 for s in heard if not s["read"]), "held": "",
            "truncated": len(rows) >= INBOX_SCAN_MAX or len(heard) > limit}


def mark_read(dsn: str, *, uid: str, ids: Iterable[Any], dismiss: bool = False) -> int:
    """Record this account's own read (or cleared) marks."""
    uid = str(uid or "").strip()
    clean = sorted({int(i) for i in ids if str(i).strip().lstrip("-").isdigit() and int(i) > 0})
    if not uid or not clean:
        return 0
    clean = clean[:READ_MAX_IDS]
    try:
        with _connect(dsn) as conn, conn.cursor() as cur:
            _ensure(cur, dsn)
            for nid in clean:
                cur.execute(
                    "INSERT INTO asa_hub_notice_reads (user_id, notice_id, read_at, dismissed_at) "
                    "VALUES (%s,%s,now(),%s) ON CONFLICT (user_id, notice_id) DO UPDATE SET "
                    "dismissed_at = coalesce(asa_hub_notice_reads.dismissed_at, "
                    "EXCLUDED.dismissed_at)",
                    (uid, nid, _now() if dismiss else None))
            conn.commit()
    except Exception:
        _forget(dsn)
        raise
    return len(clean)


# Events from rows (pure): {kind, key, location, col_iso, ref, value, at, facts}; the key is the identity.

def _within(at: Any, now: datetime, span: timedelta) -> bool:
    got = _at(at)
    return got is not None and now - span <= got <= now + timedelta(minutes=5)


def _event(kind: str, key: str, *, location: str, col_iso: str, ref: str, value: str,
           at: Any, facts: dict[str, Any]) -> dict[str, Any]:
    return {"kind": kind, "key": key, "location": location, "col_iso": col_iso, "ref": ref,
            "value": value, "at": _iso(at) if at is not None else "", "facts": facts}


def events_from_pool(rows: Iterable[dict[str, Any]], *, now: datetime,
                     lookback: timedelta) -> list[dict[str, Any]]:
    """Pool events; a call-off is news until its shift starts, an open shift only while its window is open."""
    out = []
    today = now.astimezone(OHIO).date().isoformat()
    for s in rows:
        ref = str(s.get("ref") or "")
        if not ref:
            continue
        window = s.get("window") or {}
        base = {"location": s.get("location") or "", "col_iso": s.get("col_iso") or "",
                "ref": ref, "value": s.get("value") or ""}
        facts = {"house": s.get("house") or "",
                 "shift_kind": s.get("kind") or "", "shift_start": s.get("shift_start") or "",
                 "window": {"closes_at": window.get("closes_at") or "",
                            "state": window.get("state") or "", "why": window.get("why") or ""}}
        filled = str(s.get("filled_by") or "")
        start = _at(s.get("shift_start"))
        if s.get("kind") == "call_off" and not filled and (
                (start is not None and start > now) or (start is None and base["col_iso"] >= today)):
            out.append(_event(K_CALL_OFF, f"call_off:{ref}", at=window.get("opens_at"), **base,
                              facts={**facts, "caller": s.get("called_off_by") or ""}))
        if s.get("kind") == "open_shift" and not filled and window.get("state") == "open":
            out.append(_event(K_OPEN_SHIFT, f"open_shift:{ref}", at=window.get("opens_at"), **base,
                              facts=facts))
        if filled:
            if _within(s.get("closed_at"), now, lookback):
                out.append(_event(K_FILLED, f"filled:{ref}", at=s.get("closed_at"), **base,
                                  facts={**facts, "person": filled, "how": s.get("filled_how") or "",
                                         "by": s.get("decided_by") or ""}))
        elif s.get("state") == "closed" and s.get("applicants") and _within(
                window.get("closes_at"), now, lookback):
            out.append(_event(K_WINDOW_CLOSED, f"window_closed:{ref}", at=window.get("closes_at"),
                              **base, facts={**facts, "applicants": len(s.get("applicants") or [])}))
    return out


def events_from_requests(rows: Iterable[dict[str, Any]], *, now: datetime, lookback: timedelta,
                         ref_of: Callable[[str, str, str], str]) -> list[dict[str, Any]]:
    """Request events; an assignment is announced as a decision, never as an application."""
    out = []
    for r in rows:
        kind = str(r.get("kind") or "")
        loc, row_name, iso = (str(r.get("location") or ""), str(r.get("open_row") or ""),
                              str(r.get("col_iso") or ""))
        rid = str(r.get("id") or "")
        if not rid:
            continue
        ref = ref_of(loc, row_name, iso) if loc and iso else ""
        base = {"location": loc, "col_iso": iso, "ref": ref, "value": str(r.get("value") or "")}
        created, decided = _at(r.get("created_at")), _at(r.get("decided_at"))
        waited = (created is not None and decided is not None
                  and (decided - created) > timedelta(seconds=5))
        facts = {"person": r.get("person") or "", "via": r.get("via") or "",
                 "by": r.get("decided_by") or "", "state": r.get("state") or ""}
        if kind in ("open_shift", "call_off"):
            facts["shift_kind"] = kind
            assigned = str(r.get("why") or "") == "assigned by the house manager"
            if not assigned and _within(created, now, lookback):
                out.append(_event(K_APPLICATION, f"application:{rid}", at=created, **base,
                                  facts=dict(facts)))
            if _within(decided, now, lookback):
                state = str(r.get("state") or "")
                if state == "approved":
                    out.append(_event(K_DECIDED, f"decided:{rid}", at=decided, **base,
                                      facts={**facts, "how": "assigned" if assigned else "approved"}))
                elif state == "not_chosen":
                    out.append(_event(K_NOT_CHOSEN, f"not_chosen:{rid}", at=decided, **base,
                                      facts=dict(facts)))
                elif state == "withdrawn":
                    out.append(_event(K_WITHDRAWN, f"withdrawn:{rid}", at=decided, **base,
                                      facts=dict(facts)))
        elif kind == "ist_approval":
            # a training row's ref column is the shift kind
            facts.update({"why": r.get("why") or "", "shift_kind": r.get("ref") or ""})
            state = str(r.get("state") or "")
            if _within(created, now, lookback) and (state == "needs_training_approval" or waited):
                out.append(_event(K_TRAINING, f"training:{rid}", at=created, **base,
                                  facts={**facts, "state": "needs_training_approval"}))
            if waited and state in ("approved", "refused") and _within(decided, now, lookback):
                out.append(_event(K_TRAINING_DECIDED, f"training_decided:{rid}", at=decided, **base,
                                  facts=dict(facts)))
    return out


def events_from_handoffs(rows: Iterable[dict[str, Any]], *, now: datetime,
                         lookback: timedelta) -> list[dict[str, Any]]:
    """A swap offered, each of its three answers, and how it ended."""
    out = []
    for h in rows:
        hid = str(h.get("id") or "")
        if not hid:
            continue
        base = {"location": str(h.get("location") or ""), "col_iso": str(h.get("col_iso") or ""),
                "ref": hid, "value": str(h.get("value") or "")}
        facts = {"from": h.get("from_staff") or "", "to": h.get("to_staff") or "",
                 "manager": h.get("house_manager") or ""}
        if _within(h.get("created_at"), now, lookback):
            out.append(_event(K_SWAP_OFFERED, f"swap_offered:{hid}", at=h.get("created_at"), **base,
                              facts=dict(facts)))
        if str(h.get("staff_state") or "") in ("accepted", "declined") and _within(
                h.get("staff_at"), now, lookback):
            out.append(_event(K_SWAP_ANSWERED, f"swap_staff:{hid}", at=h.get("staff_at"), **base,
                              facts={**facts, "side": "staff", "word": h.get("staff_state")}))
        if str(h.get("manager_state") or "") in ("approved", "declined") and _within(
                h.get("manager_at"), now, lookback):
            out.append(_event(K_SWAP_ANSWERED, f"swap_manager:{hid}", at=h.get("manager_at"), **base,
                              facts={**facts, "side": "manager", "word": h.get("manager_state"),
                                     "by": h.get("manager_by") or ""}))
        # the third consent, its own notice like the other two
        if str(h.get("director_state") or "") in ("approved", "declined") and _within(
                h.get("director_at"), now, lookback):
            out.append(_event(K_SWAP_ANSWERED, f"swap_director:{hid}", at=h.get("director_at"),
                              **base, facts={**facts, "side": "director",
                                             "word": h.get("director_state"),
                                             "by": h.get("director_by") or ""}))
        if _within(h.get("closed_at"), now, lookback):
            state, why = str(h.get("state") or ""), str(h.get("why") or "")
            if state == "done":
                out.append(_event(K_SWAP_DONE, f"swap_done:{hid}", at=h.get("closed_at"), **base,
                                  facts={**facts, "why": why}))
            elif state == "dead" and not _ended_by_a_no(h):
                out.append(_event(K_SWAP_ENDED, f"swap_ended:{hid}", at=h.get("closed_at"), **base,
                                  facts={**facts, "why": why}))
    return out


def events_from_claims(rows: Iterable[dict[str, Any]], *, now: datetime, lookback: timedelta,
                       ref_of: Callable[[str, str, str], str],
                       houses: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """Claims-ledger events, keyed `filled:<ref>` like the pool's."""
    out = []
    for c in rows:
        loc, row_name, iso = (str(c.get("location") or ""), str(c.get("open_row") or ""),
                              str(c.get("col_iso") or ""))
        if not loc or not iso or not _within(c.get("claimed_at"), now, lookback):
            continue
        ref = ref_of(loc, row_name, iso)
        out.append(_event(K_FILLED, f"filled:{ref}", location=loc, col_iso=iso, ref=ref,
                          value=str(c.get("value") or ""), at=c.get("claimed_at"),
                          facts={"person": c.get("claimed_by") or "", "how": c.get("claimed_via") or "",
                                 "house": (houses or {}).get(loc, "")}))
    return out


def events_from_board(rows: Iterable[dict[str, Any]], *, now: datetime,
                      lookback: timedelta) -> list[dict[str, Any]]:
    """Punch-board events: `no_punch` only (never `not_entered_yet`), and late calls until the shift ends."""
    out = []
    for r in rows:
        if r.get("row_kind") != "shift" or not r.get("id"):
            continue
        house = str(r.get("house") or "")
        base = {"location": house, "col_iso": str(r.get("day") or ""), "ref": "",
                "value": str(r.get("shift_code") or "")}
        facts = {"person": r.get("person") or "", "shift_at": r.get("shift_at") or ""}
        if r.get("verdict") == "no_punch" and _within(r.get("checked_at") or r.get("shift_at"),
                                                      now, lookback):
            out.append(_event(K_NO_SHOW, f"no_show:{r['id']}", at=r.get("checked_at") or r.get("shift_at"),
                              **base, facts={**facts, "minutes": r.get("minutes")}))
        end = _at(r.get("shift_end"))
        if r.get("late_call") and end is not None and end > now:
            out.append(_event(K_LATE_CALL, f"late_call:{r['id']}", at=r.get("told_at") or now,
                              **base, facts={**facts, "told_at": r.get("told_at") or ""}))
    return out


def events_from_time_off(rows: Iterable[dict[str, Any]], *, now: datetime,
                         lookback: timedelta, labels: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """Time off events from the house's rows, keyed as the lane publishes them."""
    out = []

    def names(cell: Any) -> list[str]:
        return [p.strip() for p in str(cell or "").split(",") if p.strip()]

    for r in rows:
        ref = str(r.get("id") or "")
        if not ref or r.get("filed_via") == "migration":
            continue
        base = {"location": "", "col_iso": str(r.get("start_date") or ""), "ref": ref, "value": ""}
        facts = {"person": r.get("person") or "", "start": r.get("start_date") or "",
                 "end": r.get("end_date") or "", "houses": names(r.get("houses")),
                 "house_labels": [(labels or {}).get(c) or c for c in names(r.get("houses"))],
                 "approvers": names(r.get("hm_asked")) + names(r.get("dir_asked")),
                 "status": r.get("status") or ""}
        status = str(r.get("status") or "")
        if status == "pending" and _within(r.get("createdAt"), now, lookback):
            out.append(_event(K_TO_ASKED, f"time_off_asked:{ref}", at=r.get("createdAt"), **base,
                              facts=dict(facts)))
        for leg in ("hm", "dir"):
            state = str(r.get(f"{leg}_state") or "")
            if state in ("approved", "denied") and _within(r.get(f"{leg}_at"), now, lookback):
                out.append(_event(K_TO_DECIDED, f"time_off_decided:{ref}:{leg}", at=r.get(f"{leg}_at"),
                                  **base, facts={**facts, "leg": leg, "by": r.get(f"{leg}_by") or "",
                                                 "word": "approve" if state == "approved" else "deny"}))
        if status == "scheduled" and _within(r.get("decided_at"), now, lookback):
            out.append(_event(K_TO_SCHEDULED, f"time_off_scheduled:{ref}", at=r.get("decided_at"), **base,
                              facts=dict(facts)))
        ended_at = r.get("closed_at") or r.get("decided_at") or r.get("updatedAt")
        if status in ("denied", "withdrawn", "cancelled", "expired") and _within(ended_at, now, lookback):
            out.append(_event(K_TO_ENDED, f"time_off_ended:{ref}:{status}", at=ended_at, **base,
                              facts=dict(facts)))
    return out


# the minute's catch-up

def catch_up(dsn: str, *, now: datetime | None = None,
             lookback_min: int | None = None) -> dict[str, Any]:
    """Publish every event without a notice; {published, by_kind, unreadable, failed}, each source read independently."""
    import shift_requests  # noqa: PLC0415 — lazy: it imports the estate
    now = now or _now()
    span = timedelta(minutes=LOOKBACK_MIN if lookback_min is None else lookback_min)
    if latest_id() is None:
        prime(dsn)
    events: list[dict[str, Any]] = []
    unreadable: list[str] = []
    pool: list[dict[str, Any]] = []
    try:
        pool = shift_requests.pool(dsn, now=now)
        events += events_from_pool(pool, now=now, lookback=span)
    except Exception as exc:  # noqa: BLE001
        unreadable.append(f"the shift pool ({type(exc).__name__})")
    houses = {p["location"]: p.get("house") or "" for p in pool}
    # a pool row's stored ref first, so one shift never gets two handles
    stored = {(p.get("location"), p.get("open_row"), p.get("col_iso")): p.get("ref")
              for p in pool if p.get("ref")}

    def pool_ref(location: str, open_row: str, col_iso: str) -> str:
        return stored.get((location, open_row, col_iso)) or shift_requests.ref_of(location, open_row, col_iso)

    try:
        import shift_handoff  # noqa: PLC0415
        # `director_at` is one of the lane's newer columns: added on its own connection, before this read's…
        shift_handoff.ensure_tables(dsn)
        with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            for statement in shift_requests.DDL:
                cur.execute(statement)
            cur.execute(shift_handoff.HANDOFFS_DDL)
            cur.execute("SELECT id, kind, location, open_row, col_iso, value, person, state, why, "
                        "via, ref, decided_by, decided_at, created_at FROM asa_shift_requests "
                        "WHERE created_at > %s OR decided_at > %s", (now - span, now - span))
            requests = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT * FROM asa_shift_handoffs WHERE created_at > %s OR staff_at > %s "
                        "OR manager_at > %s OR director_at > %s OR closed_at > %s",
                        (now - span,) * 5)
            handoffs = [dict(r) for r in cur.fetchall()]
            conn.commit()
        events += events_from_requests(requests, now=now, lookback=span,
                                       ref_of=pool_ref)
        events += events_from_handoffs(handoffs, now=now, lookback=span)
    except Exception as exc:  # noqa: BLE001
        unreadable.append(f"the requests and handoffs ({type(exc).__name__})")
    try:
        import house_cal_live  # noqa: PLC0415
        with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(house_cal_live.CLAIMS_DDL)
            cur.execute("SELECT location, open_row, col_iso, value, claimed_by, claimed_via, "
                        "claimed_at FROM asa_house_calendar_claims WHERE claimed_at > %s",
                        (now - span,))
            claims = [dict(r) for r in cur.fetchall()]
            conn.commit()
        events += events_from_claims(claims, now=now, lookback=span, ref_of=pool_ref,
                                     houses=houses)
    except Exception as exc:  # noqa: BLE001
        unreadable.append(f"the claims ledger ({type(exc).__name__})")
    try:
        board = shift_requests._attendance_board()  # noqa: SLF001 — Requests' own reader of the board
        on_board = events_from_board((board or {}).get("rows") or [], now=now, lookback=span)
        if on_board:
            events += _placed(on_board, dsn)
    except FileNotFoundError:
        pass  # the attendance lane has not written a board on this relay yet: nothing to read
    except Exception as exc:  # noqa: BLE001
        unreadable.append(f"the punch board ({type(exc).__name__})")
    try:
        import time_off  # noqa: PLC0415 — lazy: the lane may not be loaded
        events += events_from_time_off(time_off.rows(dsn), now=now, lookback=span,
                                       labels=time_off.house_labels(dsn))
    except Exception as exc:  # noqa: BLE001
        unreadable.append(f"the Time Off house ({type(exc).__name__})")

    published, failed, off = 0, 0, 0
    by_kind: dict[str, int] = {}
    for ev in events:
        with _SEEN_LOCK:
            known = ev["key"] in _SEEN
        if known:
            continue
        said = publish(ev["kind"], key=ev["key"], dsn=dsn, location=ev["location"],
                       col_iso=ev["col_iso"], ref=ev["ref"], value=ev["value"], at=ev["at"] or None,
                       facts=ev["facts"])
        if said.get("stored"):
            published += 1
            by_kind[ev["kind"]] = by_kind.get(ev["kind"], 0) + 1
        elif said.get("off"):
            # its situation is off or unreadable: said once by publish, offered again next pass
            off += 1
        elif not said.get("duplicate"):
            failed += 1
    return {"published": published, "by_kind": by_kind, "unreadable": unreadable,
            "failed": failed, "off": off, "looked_at": len(events), "at": _iso(now)}


def _placed(events: list[dict[str, Any]], dsn: str) -> list[dict[str, Any]]:
    """Board events move from house code to location; an unknown code stays a code."""
    import house_directory  # noqa: PLC0415
    import shift_requests  # noqa: PLC0415
    try:
        by_code = shift_requests.estate(dsn).get("by_code") or {}
    except Exception:  # noqa: BLE001 — unplaced is still told, under its code
        by_code = {}
    for ev in events:
        code = house_directory.code_of(ev["location"]) or str(ev["location"]).upper()
        loc = by_code.get(code)
        if loc:
            ev["location"] = loc
            ev["facts"]["house"] = shift_requests.short_house(loc)
    return events
