"""Who is not at work, asked of the PsiAnywhere time clock: the late-call and no-show/no-call lane.
Shifts from the roster mirror (newest cell), punches from PsiAnywhere live, and a person a call-off book names…

The relay's server/psi_attendance.py, run in the app (app/attendance_loop.py): its state, its board and the entry
history are the same files on /srv/snapshot. The roster is the CALENDAR grids asa-hub-db keeps, published cells laid
(shift_slices.roster), and the call-off books (the retired book, the hotline queue, the Call Off Tracker) are
asa-hub-db's copies; nothing here reads the old platform's sheet copies or asa_schedules.

Once a New York day, on the first beat after a collection that read that makes no collection of its own, the session
that read re-reads the current and the previous PsiAnywhere pay period for the full punches alone (`_period_refresh`): a
collection reaches HISTORY_DAYS back and never again, and Time Reconciliation and Overtime read their worked hours off
that record."""
from __future__ import annotations

import json
import logging
import os
import re
import socket
import ssl
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo

log = logging.getLogger("asa-hub-app.psi_attendance")

# THE CLOCK EVERYTHING HERE IS READ ON.
OHIO = ZoneInfo("America/New_York")
UTC = timezone.utc

PSI_BASE = os.getenv("HUB_PSI_BASE", "https://abrighterdawn.psianywhere.com").rstrip("/")
PSI_SERVICE = PSI_BASE + "/service/Anywhere.svc"

# How long after a shift begins somebody is LATE, and how long before the platform says they never came.
LATE_AFTER_MIN = float(os.getenv("HUB_PSI_LATE_AFTER_MIN", "20"))
NOCALL_AFTER_MIN = float(os.getenv("HUB_PSI_NOCALL_AFTER_MIN", "60"))

# THE PLAN.
CHECK_WINDOW_MIN = float(os.getenv("HUB_PSI_CHECK_WINDOW_MIN", "60"))
MIN_GAP_MIN = float(os.getenv("HUB_PSI_MIN_GAP_MIN", "60"))

# The longest an entry open before a start may still count as the person being on the clock for it: a double runs 16…
OPEN_ENTRY_MAX_H = float(os.getenv("HUB_PSI_OPEN_ENTRY_MAX_H", "14"))
# An entry begun before a start covers it when it ran at least this far into the shift (less a quarter hour): the…
COVER_MIN = float(os.getenv("HUB_PSI_COVER_MIN", "60"))

# A SHIFT STAYS OPEN A WHOLE DAY.
STALE_AFTER_MIN = float(os.getenv("HUB_PSI_ATTENDANCE_STALE_MIN", "1440"))

# EVERY COLLECTION READS THIS MANY DAYS BACK, WHATEVER IS DUE — the board's own reach (the day before yesterday, for…
HISTORY_DAYS = int(os.getenv("HUB_PSI_HISTORY_DAYS", "2"))
# A SHIFT THAT IS OVER, READ THIS LONG AFTER ITS END WITH NO ENTRY, IS `not_entered_yet`: the time may still be…
ENTRY_GRACE_MIN = float(os.getenv("HUB_PSI_ENTRY_GRACE_MIN", "60"))

# THE PAY-PERIOD REFRESH. A collection reads HISTORY_DAYS back and never again, so an entry's status (P→A→S→I), its end
# and its hours froze on the third day in the full punch house that Time Reconciliation and Overtime read as the worked
# side. Once a New York day, from this hour on, a collection that READ leaves one more read of the current and the
# previous pay period (psi_periods) owed to its session, for the full punches only, and the next beat that makes no
# collection pays it — never the read's own beat, whose verdicts the app's beat delivers only once tick() returns.
PERIOD_REFRESH_AFTER_H = int(os.getenv("HUB_PSI_PERIOD_REFRESH_AFTER_H", "5"))
# A refresh that could not read is tried once more that day, no sooner than this after: two tries a day at most, so a
# PsiAnywhere that refuses the long read is not asked for it on every collection. 0 switches the refresh off.
PERIOD_REFRESH_TRIES = int(os.getenv("HUB_PSI_PERIOD_REFRESH_TRIES", "2"))
PERIOD_REFRESH_RETRY_S = float(os.getenv("HUB_PSI_PERIOD_REFRESH_RETRY_S", str(3 * 3600)))
# THE LONGEST THE REFRESH MAY HOLD ITS BEAT (the lane's lock, and behind it that beat's board notice, shift-flow texts
# and door posts): no request is started past it — not a period's supervisor list, not a queue — so it runs over only
# by the one request already on the wire (PSI_TIMEOUT_S), inside what a collection's own requests may take at their
# PSI_TIMEOUT_S each (the supervisor list and 17 queues: 18 × 45 s).
PERIOD_REFRESH_BUDGET_S = float(os.getenv("HUB_PSI_PERIOD_REFRESH_BUDGET_S", "600"))
# The pass states of a beat that made no collection and sent nothing, the only beats the owed refresh rides.
_PERIOD_REFRESH_QUIET = ("waiting", "nothing_for_the_clock")

# RULE 13: while a check has found somebody missing, the clock is asked again every this-many minutes — and only then.
FOLLOW_UP_MIN = float(os.getenv("HUB_PSI_FOLLOW_UP_MIN", "30"))
# AND THE FOLLOW-UPS ARE BOUNDED, BECAUSE THE ROSTER NEVER RUNS OUT OF MISSING PEOPLE.
FOLLOW_UPS_PER_SHIFT = int(os.getenv("HUB_PSI_FOLLOW_UPS_PER_SHIFT", "4"))
FOLLOW_UP_DAY_MAX = int(os.getenv("HUB_PSI_FOLLOW_UP_DAY_MAX", "12"))

# A COLLECTION THAT WAS SENT AND COULD NOT READ waits longer each time: the next one no sooner than FAIL_BACKOFF_MIN…
FAIL_BACKOFF_MIN = float(os.getenv("HUB_PSI_FAIL_BACKOFF_MIN", "60"))
FAIL_BACKOFF_MAX_MIN = float(os.getenv("HUB_PSI_FAIL_BACKOFF_MAX_MIN", "480"))
# "SIGN IN ONCE MORE, THEN STOP", ACROSS COLLECTIONS.
RELOGIN_REST_S = float(os.getenv("HUB_PSI_RELOGIN_REST_S", "86400"))

# THE TY ACCOUNT'S TWO TRIES A DAY, New York wall times.
TY_SLOTS = tuple(s.strip() for s in os.getenv("HUB_PSI_TY_SLOTS", "10:15,16:15").split(",")
                 if s.strip())
# How long a slot stays live after its minute: a relay restarting across 10:15 still tries at 10:20, and a slot the…
TY_SLOT_WINDOW_MIN = float(os.getenv("HUB_PSI_TY_SLOT_WINDOW_MIN", "120"))
# The no-credential service probe's own ceiling, for DOWN's health retry.
PROBE_TIMEOUT_S = float(os.getenv("HUB_PSI_PROBE_TIMEOUT_S", "10"))

# THE ANTICIPATED SHIFT: an entry that began more than EARLY_MIN before the roster start is an early clock-in, and…
EARLY_MIN = float(os.getenv("HUB_PSI_EARLY_MIN", "15"))
EARLY_WINDOW_MIN = float(os.getenv("HUB_PSI_EARLY_WINDOW_MIN", "240"))

# THE PUNCH BOARD, on the relay's own disk (the slice commPunchBoard reads it).
BOARD_FILE = Path(os.getenv(
    "HUB_PSI_PUNCH_BOARD",
    str(Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) / ".psi-punch-board.json")))

# The most people one pass will name, and one post will carry.
MAX_PER_PASS = int(os.getenv("HUB_PSI_ATTENDANCE_MAX", "12"))

PSI_TIMEOUT_S = float(os.getenv("HUB_PSI_ATTENDANCE_TIMEOUT_S", "45"))

# How often the roster and the call-off books are re-read between collections.
REFRESH_S = float(os.getenv("HUB_PSI_ATTENDANCE_REFRESH_S", "600"))

# A post the door refused waits this long before it is tried again.
POST_RETRY_S = float(os.getenv("HUB_PSI_ATTENDANCE_POST_RETRY_S", "600"))
# A post the door answered with nothing sent ("held" — a switch, the dial, no recipient) is offered once more an…
HELD_RETRY_S = float(os.getenv("HUB_PSI_ATTENDANCE_HELD_RETRY_S", "3600"))
HELD_OFFERS = int(os.getenv("HUB_PSI_ATTENDANCE_HELD_OFFERS", "2"))

# Who may be named: somebody the clock itself has seen working this recently.
SEEN_RECENT_DAYS = int(os.getenv("HUB_PSI_SEEN_RECENT_DAYS", "14"))
SEEN_KEEP_DAYS = 120

# THE STATE THAT MUST OUTLIVE A RESTART: which shifts were judged, when the last collection ran, which spellings the…
STATE_FILE = Path(os.getenv(
    "HUB_PSI_ATTENDANCE_STATE",
    str(Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) / ".psi-attendance.json")))

# The Call Off Tracker the form fills ("Call Off and Late (Responses)" › Master), as asa-hub-db keeps it; only these
# columns are read (its notes never are).
TRACKER_SHEET_ID = os.getenv("HUB_PSI_CALLOFF_TRACKER_SHEET_ID", "1KIDBnkI8CH_P3WEihDcKPmPyeBNSjR2WUoxptP1IWTA")
TRACKER_TAB = "Master"
_TRACKER_HEADERS = {"Employee Name": "employee_name", "Date": "date", "Type": "type", "Timestamp": "timestamp"}
# The hotline queue's call-offs (comm_when_reading.LIVE_QUEUE), the same three cells the mirror's columns were.
_QUEUE_HEADERS = {"Requestor": "requestor", "Date Received": "date_received",
                  "Description of Request": "description_of_request"}

# Roster rows that are not a person.
_NOT_A_PERSON = re.compile(r"^(?:family|nurse|open|workshop\b.*)$", re.IGNORECASE)


# ── names ──────────────────────────────────────────────────────────────────

def person_keys(name: Any) -> frozenset[str]:
    """Every key a person is found by, both folds at once."""
    s = str(name or "").strip().lower()
    flat = re.sub(r"[^a-z0-9]+", "", s)
    words = " ".join(sorted(re.findall(r"[a-z0-9]+", re.sub(r"['’`]", "", s))))
    return frozenset(k for k in (flat, words) if k)


def flat_key(name: Any) -> str:
    """The platform's flattened name alone (`clientNameKey_`, `comm_when._key`)."""
    return re.sub(r"[^a-z0-9]+", "", str(name or "").strip().lower())


def name_tokens(name: Any) -> frozenset[str]:
    """The words of a name that could be somebody's (three letters or more)."""
    s = re.sub(r"['’`]", "", str(name or "").lower())
    return frozenset(w for w in re.findall(r"[a-z]+", s) if len(w) >= 3)


def not_a_person(name: Any) -> bool:
    return bool(_NOT_A_PERSON.match(str(name or "").strip()))


def entry_name(row: dict) -> str:
    """The person on a live entry."""
    first = str(row.get("firstname") or "").strip()
    last = str(row.get("lastname") or "").strip()
    if first or last:
        return f"{first} {last}".strip()
    return str(row.get("employee_name") or row.get("Employee_Name") or row.get("name") or "").strip()


def _mins(a: datetime, b: datetime) -> float:
    """a − b in real minutes, whatever zone either was read in."""
    return (a.astimezone(UTC) - b.astimezone(UTC)).total_seconds() / 60.0


# ── the plan ───────────────────────────────────────────────────────────────

def next_collection(starts: Iterable[datetime], last_done: datetime | None, *,
                    late: float = LATE_AFTER_MIN, window: float = CHECK_WINDOW_MIN,
                    gap: float = MIN_GAP_MIN) -> datetime | None:
    """The next moment worth a login, or None when no shift waits on one."""
    ordered = sorted(s.astimezone(UTC) for s in starts)
    if not ordered:
        return None
    at = ordered[0] + timedelta(minutes=late + window)
    if last_done is not None:
        at = max(at, last_done.astimezone(UTC) + timedelta(minutes=gap))
    return at


def day_plan(starts: Iterable[datetime], last_done: datetime | None, until: datetime, **kw: float
             ) -> list[datetime]:
    """Every collection `next_collection` will choose from here to `until`, assuming each one runs on time and…"""
    late = kw.get("late", LATE_AFTER_MIN)
    remaining = sorted(s.astimezone(UTC) for s in starts)
    out: list[datetime] = []
    done = last_done
    for _ in range(96):
        at = next_collection(remaining, done, **kw)
        if at is None or at > until.astimezone(UTC):
            break
        out.append(at)
        done = at
        remaining = [s for s in remaining if s + timedelta(minutes=late) > at]
    return out


# ── the clock's answers ────────────────────────────────────────────────────

_WINDOW_NAME = re.compile(r"<window_name>([^<]*)</window_name>")
_SPECIAL_DATA = re.compile(r"<special_data>([^<]*)</special_data>")


def read_login(answer: Any) -> tuple[str, str]:
    """(token, word) from a getLogIn result."""
    text = str(answer or "").replace("<\\/", "</")
    word = _WINDOW_NAME.search(text)
    data = _SPECIAL_DATA.search(text)
    w = word.group(1).strip() if word else ""
    token = data.group(1).strip() if data else ""
    if w != "Token" or not token:
        return "", w
    return token, w


_PSI_DAY = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})")
_ISO_DAY = re.compile(r"^\s*(\d{4})-(\d{2})-(\d{2})")
_PSI_TIME = re.compile(r"^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*$")


def _psi_day(raw: Any) -> date | None:
    text = str(raw or "")
    m = _PSI_DAY.match(text)
    try:
        if m:
            return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
        m = _ISO_DAY.match(text)
        if m:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None
    return None


def _psi_minutes(raw: Any) -> int | None:
    m = _PSI_TIME.match(str(raw or ""))
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2))
    if m.group(4):
        if not 1 <= hour <= 12:
            return None
        hour = hour % 12 + (12 if m.group(4).upper() == "PM" else 0)
    if hour > 23 or minute > 59:
        return None
    return hour * 60 + minute


def _ohio(day: date, minutes: int) -> datetime:
    """An Ohio wall time on a day → the real instant, in UTC."""
    wall = datetime(day.year, day.month, day.day, tzinfo=OHIO) + timedelta(minutes=minutes)
    return wall.astimezone(UTC)


def entry_span(row: dict) -> tuple[datetime, datetime | None] | None:
    """(began, ended) of one live entry, in UTC; `ended` is None while it is open."""
    day = _psi_day(row.get("Date_of_Service") or row.get("date_of_service"))
    start = _psi_minutes(row.get("start_time") or row.get("Start_Time"))
    if day is None or start is None:
        return None
    began = _ohio(day, start)
    end = _psi_minutes(row.get("end_time") or row.get("End_Time"))
    if end is None:
        return began, None
    ended = _ohio(day, end if end >= start else end + 1440)
    return began, ended


def punch_index(rows: Iterable[dict]) -> tuple[dict[str, list[tuple]], Counter]:
    """name key → every span that person clocked, and what could not be read."""
    index: dict[str, list[tuple]] = {}
    counts: Counter = Counter()
    for row in rows:
        if not isinstance(row, dict):
            counts["not_a_record"] += 1
            continue
        name = entry_name(row)
        span = entry_span(row)
        if not name:
            counts["no_name"] += 1
            continue
        if span is None:
            counts["no_start"] += 1
            continue
        counts["read"] += 1
        ref = {"id": str(row.get("Single_Entry_ID") or ""), "name": name,
               "day": _psi_day(row.get("Date_of_Service") or row.get("date_of_service"))}
        for k in person_keys(name):
            index.setdefault(k, []).append((span[0], span[1], ref))
    return {k: _stitch(v) for k, v in index.items()}, counts


def _stitch(spans: list[tuple]) -> list[tuple]:
    """PSIANYWHERE CUTS AN OVERNIGHT ENTRY AT MIDNIGHT — 23:59:59 on one row and 00:00:00 on the next — and the…"""
    ordered = sorted(spans, key=lambda sp: sp[0].astimezone(UTC))
    out: list[tuple] = []
    for sp in ordered:
        if out and out[-1][1] is not None:
            prev = out[-1]
            began = sp[0].astimezone(OHIO)
            if (began.hour, began.minute) == (0, 0) and 0 <= _mins(sp[0], prev[1]) <= 2:
                ref = dict(prev[2]) if len(prev) > 2 and prev[2] else {}
                first = (prev[2] or {}).get("id") if len(prev) > 2 and prev[2] else ""
                later = (sp[2] or {}).get("id") if len(sp) > 2 and sp[2] else ""
                ref["ids"] = [i for i in (list(ref.get("ids") or [first]) + [later]) if i]
                out[-1] = (prev[0], sp[1], ref)
                continue
        out.append(sp)
    return out


def arrival(shift_at: datetime, shift_end: datetime, spans: Iterable[tuple],
            now: datetime) -> datetime | None:
    """When the person was on the clock for THIS shift, or None."""
    return arrival_match(shift_at, shift_end, spans, now)[0]


def arrival_match(shift_at: datetime, shift_end: datetime, spans: Iterable[tuple],
                  now: datetime) -> tuple[datetime | None, tuple | None]:
    """(when the person was on the clock for THIS shift, the span that says so), or (None, None)."""
    start = shift_at.astimezone(UTC)
    over = shift_end.astimezone(UTC)
    now_u = now.astimezone(UTC)
    # HOW LONG AN EARLIER ENTRY MUST RUN PAST THE START TO BE THIS SHIFT'S: until now, the shift's end or COVER_MIN…
    held_until = max(start, min(now_u, shift_end.astimezone(UTC),
                                start + timedelta(minutes=COVER_MIN)) - timedelta(minutes=15))
    oldest = start - timedelta(hours=OPEN_ENTRY_MAX_H)
    best: datetime | None = None
    chosen: tuple | None = None
    for span in spans:
        began, ended = span[0], span[1]
        b = began.astimezone(UTC)
        if b > now_u or b >= over:
            continue
        if b <= start:
            if b < oldest or (ended is not None and ended.astimezone(UTC) < held_until):
                continue
            at = start
        else:
            at = b
        # THE EARLIEST ARRIVAL WINS, and between two spans that both cover the start, the one that began LATER is…
        if best is None or at < best or (at == best and chosen is not None and b > chosen[0]):
            best, chosen = at, span
    return best, chosen


# ── the verdict ────────────────────────────────────────────────────────────

def shift_id(s: dict) -> str:
    return f"{s['person_key']}|{s['shift_at'].astimezone(UTC).isoformat()}"


def told_by_a_human(s: dict, offs: dict[str, list[dict]], loose: list[dict] | None = None
                    ) -> dict | None:
    """The row a human wrote about this person's shift day, or None."""
    for k in s["keys"]:
        for f in offs.get(k, ()):
            if abs((s["shift_date"] - f["day"]).days) <= f["spread"]:
                return f
    mine = name_tokens(s["name"])
    for f in loose or ():
        if abs((s["shift_date"] - f["day"]).days) <= 1 and mine & f["tokens"]:
            return f
    return None


def judge(shifts: Iterable[dict], index: dict, recent: set[str], offs: dict[str, list[dict]],
          loose: list[dict], judged: set[str], now: datetime) -> dict:
    """Which of the shifts that are due have somebody missing."""
    late: list[dict] = []
    nocall: list[dict] = []
    skipped: Counter = Counter()
    closed: list[str] = []
    not_seen: list[str] = []
    for s in shifts:
        age = _mins(now, s["shift_at"])
        if age < LATE_AFTER_MIN:
            skipped["not_yet"] += 1
            continue
        sid = shift_id(s)
        if sid in judged:
            skipped["judged_before"] += 1
            continue
        if age > STALE_AFTER_MIN:
            skipped["stale"] += 1
            closed.append(sid)
            continue
        if told_by_a_human(s, offs, loose):
            skipped["told_by_a_human"] += 1
            closed.append(sid)
            continue
        spans = [sp for k in s["keys"] for sp in index.get(k, ())]
        came = arrival(s["shift_at"], s["shift_end"], spans, now)
        row = {
            "person": s["name"],
            "person_key": s["person_key"],
            "house": s["house"],
            "shift_code": s["shift_code"],
            "shift_at": s["shift_at"].astimezone(OHIO).isoformat(),
            # THE SHIFT'S OWN DAY.
            "day": s["shift_date"].isoformat(),
            "_id": sid,
            # WHO LEARNED IT: the door words the e-mail by its source, and the time clock is the platform noticing…
            "source": "time_clock",
        }
        if came is not None:
            mins = _mins(came, s["shift_at"])
            if mins < LATE_AFTER_MIN:
                skipped["on_the_clock"] += 1
                closed.append(sid)
                continue
            row["minutes_late"] = int(mins)
            # The arrival the clock measured, for the e-mail's "Arrived" line.
            row["arrived"] = came.astimezone(OHIO).strftime("%H:%M")
            row["report"] = (f"The time clock has them clocked in at "
                             f"{came.astimezone(OHIO).strftime('%H:%M')}, {int(mins)} minutes "
                             "after the shift began.")
            late.append(row)
            continue
        if not (s["keys"] & recent):
            skipped["not_seen"] += 1
            not_seen.append(s["name"])
            closed.append(sid)
            continue
        if _mins(now, s["shift_end"]) >= ENTRY_GRACE_MIN:
            skipped["not_entered_yet"] += 1
            closed.append(sid)
            continue
        if age < NOCALL_AFTER_MIN:
            skipped["no_punch_yet"] += 1
            continue
        row["minutes_late"] = int(age)
        row["report"] = (f"The time clock has no punch for this shift {int(age)} minutes after "
                         "it began, and no call-off is on record.")
        nocall.append(row)
    late.sort(key=lambda r: r["minutes_late"], reverse=True)
    nocall.sort(key=lambda r: r["minutes_late"], reverse=True)
    named = (nocall + late)[:MAX_PER_PASS]
    kept = {r["_id"] for r in named}
    capped = len(late) + len(nocall) - len(named)
    closed.extend(kept)
    return {"late": [r for r in late if r["_id"] in kept],
            "no_call": [r for r in nocall if r["_id"] in kept],
            "skipped": dict(skipped), "capped": capped,
            "judged": closed, "not_seen": sorted(set(not_seen))}


# ── the punch board ────────────────────────────────────────────────────────

VERDICTS = ("punched_on_time", "late", "no_punch_yet", "no_punch", "not_entered_yet",
            "told_by_a_human", "not_known_to_clock", "upcoming", "clock_not_read",
            "punch_without_shift")


# The verdicts a real read made after the start, and before the shift was ENTRY_GRACE_MIN over, gave when it found…
_NOTHING_READ = frozenset({"no_punch_yet", "no_punch"})
# And the ones that put the person on the clock for that shift.
_ON_THE_CLOCK = frozenset({"punched_on_time", "late"})


def _hhmm(at: datetime | None) -> str:
    return at.astimezone(OHIO).strftime("%H:%M") if at is not None else ""


def _ids(ref: dict | None) -> list[str]:
    """Every entry id a span stands for — two when the midnight cut was stitched."""
    if not ref:
        return []
    return [str(i) for i in (ref.get("ids") or [ref.get("id")]) if i]


def board(shifts: Iterable[dict], index: dict[str, list[tuple]], recent: set[str],
          offs: dict[str, list[dict]], loose: list[dict], now: datetime,
          read_at: datetime | None, days: Iterable[date],
          absence_from: date | None = None, recent_complete: bool = True) -> dict:
    """WHO PUNCHED AND WHO DID NOT — every houred shift of `days`, and every punch no shift claimed."""
    days = {d for d in days}
    ordered = sorted(shifts, key=lambda s: s["shift_at"])
    claimed: dict[str, str] = {}
    rows: list[dict] = []
    counts: Counter = Counter()
    for s in ordered:
        spans = [sp for k in s["keys"] for sp in index.get(k, ())]
        came, span = arrival_match(s["shift_at"], s["shift_end"], spans, now)
        ref = (span[2] if span is not None and len(span) > 2 else None) or {}
        eid = str(ref.get("id") or "")
        first_claim = bool(eid) and eid not in claimed
        if eid and first_claim:
            for i in _ids(ref):
                claimed[i] = shift_id(s)
        if s["shift_date"] not in days:
            continue
        told = told_by_a_human(s, offs, loose)
        facts = told_facts(s, offs, loose) if told else []
        row: dict[str, Any] = {
            "row_kind": "shift", "id": shift_id(s), "person": s["name"],
            "person_key": s["person_key"], "house": s["house"], "shift_code": s["shift_code"],
            "day": s["shift_date"].isoformat(),
            "shift_at": s["shift_at"].astimezone(OHIO).isoformat(),
            "shift_end": s["shift_end"].astimezone(OHIO).isoformat(),
            "time": _hhmm(s["shift_at"]),
            "verdict": "", "minutes": None, "arrived": "", "entry_id": eid,
            "early_minutes": None, "told_source": (told or {}).get("source") or "",
            # WHAT KIND OF DAY THE HUMAN SAID, AND WHEN IT WAS LEARNED — and whether any book says they called to…
            "told_kind": (told or {}).get("kind") or "",
            "told_at": (told or {}).get("at") or "",
            # A LATE CALL NAMES SOMEBODY, SO IT COMES ONLY FROM A ROW TIED TO THEM BY NAME, ON THE DAY IT NAMES…
            "late_call": any(f.get("kind") in LATE_KINDS and not f.get("tokens")
                             and int(f.get("spread") or 0) == 0 for f in facts),
            "checked_at": "",
            "known": (True if s["keys"] & recent
                      else False if (recent and recent_complete) else None),
        }
        age = _mins(now, s["shift_at"])
        reached = absence_from is None or (
            s["shift_at"] - timedelta(hours=OPEN_ENTRY_MAX_H)).astimezone(OHIO).date() >= absence_from
        if came is not None:
            late_by = _mins(came, s["shift_at"])
            row["verdict"] = "late" if late_by >= LATE_AFTER_MIN else "punched_on_time"
            row["minutes"] = int(late_by) if late_by >= LATE_AFTER_MIN else 0
            # THE ENTRY'S OWN START is what the clock recorded, early or late.
            began = span[0] if span is not None else came
            row["arrived"] = _hhmm(began)
            ahead = _mins(s["shift_at"], began)
            # AN EARLY CLOCK-IN, and only one that belongs to THIS shift: the entry must not already be the arrival…
            if EARLY_MIN < ahead <= EARLY_WINDOW_MIN and first_claim:
                row["early_minutes"] = int(ahead)
        elif age < 0:
            row["verdict"] = "upcoming"
        elif told:
            row["verdict"] = "told_by_a_human"
        elif read_at is None or read_at <= s["shift_at"] or not reached:
            row["verdict"] = "clock_not_read"
        elif not (s["keys"] & recent):
            row["verdict"] = "not_known_to_clock"
        else:
            looked = _mins(read_at, s["shift_at"])
            if _mins(read_at, s["shift_end"]) >= ENTRY_GRACE_MIN:
                row["verdict"] = "not_entered_yet"
            else:
                row["verdict"] = "no_punch" if looked >= NOCALL_AFTER_MIN else "no_punch_yet"
            row["minutes"] = int(looked)
            row["checked_at"] = read_at.astimezone(OHIO).isoformat()
        counts[row["verdict"]] += 1
        if row["early_minutes"]:
            counts["early_in"] += 1
        rows.append(row)

    # THE PUNCHES NO SHIFT CLAIMED, once each — a stitched night is one punch.
    seen_ids: set[str] = set()
    for key_spans in index.values():
        for sp in key_spans:
            ref = sp[2] if len(sp) > 2 else None
            ids = _ids(ref)
            if not ids or ids[0] in seen_ids or any(i in claimed for i in ids):
                continue
            seen_ids.update(ids)
            day = ref.get("day")
            if day not in days or sp[0].astimezone(UTC) > now.astimezone(UTC):
                continue
            rows.append({
                "row_kind": "punch", "id": f"E|{ref['id']}", "person": ref.get("name") or "",
                "person_key": flat_key(ref.get("name")), "house": "", "shift_code": "",
                "day": day.isoformat(), "shift_at": "", "shift_end": "", "time": "",
                "verdict": "punch_without_shift", "minutes": None,
                "arrived": _hhmm(sp[0]), "ended": _hhmm(sp[1]), "open": sp[1] is None,
                "entry_id": ref["id"], "early_minutes": None, "told_source": "", "checked_at": "",
            })
            counts["punch_without_shift"] += 1
    return {"rows": rows, "counts": dict(counts)}


# ── the books (Postgres, read-only) ────────────────────────────────────────

def _when():
    """The window computation, loaded the way its feed loads it."""
    from comm_when_feed import module as when_module  # noqa: PLC0415
    return when_module()


def roster(dsn: str, day_from: date, day_to: date) -> tuple[list[dict], Counter]:
    """Every houred start between two Ohio days, one per person per start, with published cells laid in: the CALENDAR
    grids asa-hub-db keeps, one cell per house, person and day (shift_slices.roster)."""
    import shift_slices  # noqa: PLC0415
    cw = _when()
    counts: Counter = Counter()
    rows = [r for r in shift_slices.roster(day_from, day_to) if str(r.get("staff_name") or "").strip()]
    shifts: list[dict] = []
    seen: set[tuple[str, datetime]] = set()
    for r in rows:
        cell = cw.read_cell(r["shift_raw"])
        counts[cell["kind"]] += 1
        if cell["kind"] != "hours":
            continue
        name = str(r["staff_name"] or "").strip()
        if not_a_person(name):
            counts["not_a_person"] += 1
            continue
        key = cw._key(name)
        for start_min, end_min in cell["spans"]:
            at = _ohio(r["shift_date"], start_min)
            if (key, at) in seen:
                counts["same_start_twice"] += 1
                continue
            seen.add((key, at))
            shifts.append({"person_key": key, "keys": person_keys(name), "name": name,
                           "house": str(r["house"] or ""), "shift_code": cell["code"],
                           "shift_date": r["shift_date"], "shift_at": at,
                           "shift_end": _ohio(r["shift_date"], end_min if end_min > start_min
                                              else end_min + 1440)})
    return shifts, counts


# THE BOOKS' TYPES, in the lane's words.
_TRACKER_KINDS = {"call off": "call_off", "late show": "late_show", "no show no call": "no_show",
                  "no show / no call": "no_show", "sent home": "sent_home"}
# The kinds that mean "they called to say they would be late" (rule 5).
LATE_KINDS = frozenset({"late_show"})
# The kinds a human reports about a shift that was still WORKED: late, or sent home part way.
WORKED_TOLD = LATE_KINDS | frozenset({"sent_home"})
# THE LIVE QUEUE HAS NO LATE CATEGORY: a caller who says she will be late is filed under "Schedule - Call Off" like…
_LATE_WORDS = re.compile(
    r"\b(?:running|be(?:ing)?|am|i'?m|will\s+be|gonna\s+be|going\s+to\s+be|coming(?:\s+in)?|"
    r"arriv(?:e|ing))\s+(?:a\s+(?:little|bit|few\s+minutes)\s+|\d+\s*(?:min(?:ute)?s?|hours?)\s+)?late\b",
    re.IGNORECASE)


def called_off(dsn: str, day_from: date, day_to: date
               ) -> tuple[dict[str, list[dict]], list[dict], str]:
    """(person key → rows a human wrote about their day, the line's call-offs no name could be tied to, how old…"""
    import hub_rows  # noqa: PLC0415
    import lanes_db  # noqa: PLC0415
    import lanes_pg  # noqa: PLC0415
    cw = _when()
    lo, hi = day_from - timedelta(days=1), day_to + timedelta(days=1)
    offs: dict[str, list[dict]] = {}
    facts, report = cw.call_off_facts(dsn, lo, hi)
    for who, fs in facts.items():
        for f in fs:
            kind = str(f.get("kind") or "call_off")
            said = f.get("reported_on") or f.get("absent_on") or f.get("holds_on")
            at = said.isoformat() if hasattr(said, "isoformat") else str(said or "")
            if f.get("absent_on"):
                offs.setdefault(who, []).append(
                    {"day": f["absent_on"], "spread": 0, "source": f.get("source") or "book",
                     "kind": kind, "at": at})
            elif f.get("holds_on"):
                offs.setdefault(who, []).append(
                    {"day": f["holds_on"], "spread": 1, "source": f.get("source") or "live queue",
                     "kind": kind, "at": at})
    loose: list[dict] = []
    newest: date | None = None
    not_names = set(cw._NOT_A_PERSON)
    for d in hub_rows.rows(TRACKER_SHEET_ID, TRACKER_TAB, fields=list(_TRACKER_HEADERS)):
        r = {col: d.get(head) for head, col in _TRACKER_HEADERS.items()}
        day = cw._us_date(r["date"])
        if day is None:
            continue
        newest = day if newest is None or day > newest else newest
        if not lo <= day <= hi:
            continue
        name = str(r["employee_name"] or "").strip()
        if not name or name.lower() in not_names:
            continue
        kind = _TRACKER_KINDS.get(" ".join(str(r.get("type") or "").lower().split()), "call_off")
        at = _typed_at(r.get("timestamp")) or day.isoformat()
        for k in person_keys(name):
            offs.setdefault(k, []).append({"day": day, "spread": 0, "source": "tracker",
                                           "kind": kind, "at": at})
    for d in hub_rows.rows(cw.LIVE_QUEUE_ID, cw.LIVE_QUEUE_TAB, where={"Type of Request": cw.LIVE_CALL_OFF_CATEGORY},
                           fields=list(_QUEUE_HEADERS)):
        r = {col: d.get(head) for head, col in _QUEUE_HEADERS.items()}
        day = cw._queue_date(r["date_received"])
        if day is None or not lo <= day <= hi:
            continue
        tokens = name_tokens(r["requestor"]) - {w for n in not_names for w in n.split()}
        late = bool(_LATE_WORDS.search(str(r.get("description_of_request") or "")))
        if tokens:
            loose.append({"day": day, "tokens": tokens, "source": "the line (a caller's name)",
                          "kind": "reported_call_off", "at": day.isoformat()})
        requestor = str(r.get("requestor") or "").strip()
        if late and len(tokens) >= 2 and requestor.lower() not in not_names:
            for k in person_keys(requestor):
                offs.setdefault(k, []).append({"day": day, "spread": 0, "source": "live_queue",
                                               "kind": "late_show", "at": day.isoformat()})
    with lanes_db.connect(dsn) as conn, conn.cursor(cursor_factory=lanes_pg.extras.RealDictCursor) as cur:
        cur.execute("SELECT to_regclass('asa_shift_pool') IS NOT NULL AS here")
        here = cur.fetchone()
        if here and here.get("here"):
            cur.execute("SELECT open_row, col_iso, opened_at FROM asa_shift_pool "
                        "WHERE kind='call_off' AND col_iso BETWEEN %s AND %s", (lo.isoformat(), hi.isoformat()))
            pool_call_offs(cur.fetchall(), offs)
    freshness = f"{report.get('freshness', '')}; tracker newest {newest or 'never'}"
    return offs, loose, freshness


def pool_call_offs(rows: Iterable[dict], offs: dict[str, list[dict]]) -> int:
    """Lay the pool's call-offs (Builder Mark Call-Off) into `offs`, once per person and day; returns how many."""
    added = 0
    for r in rows:
        try:
            day = date.fromisoformat(str(r.get("col_iso") or "")[:10])
        except ValueError:
            continue
        keys = person_keys(str(r.get("open_row") or ""))
        if not keys or any(f.get("kind") == "call_off" and f.get("day") == day
                           for k in keys for f in offs.get(k, ())):
            continue
        opened = r.get("opened_at")
        at = (opened.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
              if hasattr(opened, "astimezone") else day.isoformat())
        for k in keys:
            offs.setdefault(k, []).append({"day": day, "spread": 0, "source": "house calendars",
                                           "kind": "call_off", "at": at})
        added += 1
    return added


_TYPED_AT = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$")


def _typed_at(raw: Any) -> str:
    """The form's own "M/D/YYYY H:MM:SS" (Ohio wall time) as an instant, or '' — the moment a human typed the…"""
    m = _TYPED_AT.match(str(raw or ""))
    if not m:
        return ""
    try:
        local = datetime(int(m.group(3)), int(m.group(1)), int(m.group(2)), int(m.group(4)),
                         int(m.group(5)), int(m.group(6) or 0), tzinfo=OHIO)
    except ValueError:
        return ""
    return local.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def told_facts(s: dict, offs: dict[str, list[dict]], loose: list[dict] | None = None) -> list[dict]:
    """EVERY row a human wrote about this person's shift day — told_by_a_human answers with the first, and the…"""
    out: list[dict] = []
    for k in s["keys"]:
        for f in offs.get(k, ()):
            if abs((s["shift_date"] - f["day"]).days) <= f["spread"] and f not in out:
                out.append(f)
    mine = name_tokens(s["name"])
    for f in loose or ():
        if abs((s["shift_date"] - f["day"]).days) <= 1 and mine & f["tokens"] and f not in out:
            out.append(f)
    return out


def notes_written(dsn: str) -> dict[str, Any]:
    """RULE 8'S HALF OF THE DAILY NOTES: {ok, by_key: {person key: [instants]}, names: {name as spoken…"""
    try:
        import daily_notes  # noqa: PLC0415
        got = daily_notes.written_notes(dsn)
    except Exception as exc:  # noqa: BLE001 — unreadable is not empty
        return {"ok": False, "by_key": {}, "why": f"the Daily Notes reader failed "
                                                  f"({type(exc).__name__})"}
    if not got.get("ok"):
        return {"ok": False, "by_key": {}, "why": str(got.get("why") or "")}
    by_key: dict[str, list[str]] = {}
    names: dict[str, list[str]] = {}
    for n in got.get("notes") or []:
        when = str(n.get("call_at") or "")
        if not when and n.get("day"):
            # A NOTE WITH NO TIME COUNTS FROM THE START OF ITS DAY: it cannot be said to come after a shift that…
            try:
                d = date.fromisoformat(str(n["day"]))
                when = datetime(d.year, d.month, d.day, tzinfo=OHIO).astimezone(UTC).isoformat()
            except ValueError:
                when = ""
        if not when:
            continue
        for k in person_keys(n.get("dsp_name")):
            by_key.setdefault(k, []).append(when)
        spoken = " ".join(str(n.get("dsp_name") or "").split())
        if spoken:
            names.setdefault(spoken, []).append(when)
    return {"ok": True, "by_key": by_key, "names": names, "why": "", "via": got.get("via") or "",
            "as_of": got.get("as_of") or 0.0}


def house_names(dsn: str) -> dict[str, str]:
    """Roster house code → the name a text says ("ABD2704" → "JH home"), from the house directory the platform…"""
    try:
        import house_directory  # noqa: PLC0415
        return {code: h["name"] for code, h in house_directory.read(dsn).items() if h.get("name")}
    except Exception as exc:  # noqa: BLE001
        log.info("psi attendance: the house directory could not be read (%s) — the codes travel",
                 type(exc).__name__)
        return {}


# ── the clock itself ───────────────────────────────────────────────────────

def _ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    # Their certificate chain is the one the health probe already meets; this module is a reader of an internal…
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


class PsiAnswer(RuntimeError):
    """The service answered, and the answer was not one we can read."""


def _call(method: str, body: dict, timeout: float) -> Any:
    req = urllib.request.Request(
        f"{PSI_SERVICE}/{method}/", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json; charset=utf-8",
                 "X-Requested-With": "XMLHttpRequest",
                 "User-Agent": "asa-hub-attendance/1"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout, context=_ctx()) as r:
        raw = r.read().decode()
    try:
        env = json.loads(raw)
    except ValueError as exc:
        raise PsiAnswer(f"{method}: the answer is not JSON — {raw[:160]!r}") from exc
    if not isinstance(env, dict):
        raise PsiAnswer(f"{method}: expected an object, got {type(env).__name__} — {raw[:160]!r}")
    key = method + "Result"
    if key not in env:
        raise PsiAnswer(f"{method}: no {key} in the answer — keys were {sorted(env)[:8]}")
    out = env[key]
    return json.loads(out) if isinstance(out, str) and out.strip().startswith(("[", "{")) else out


class PsiPaused(RuntimeError):
    """Nothing was sent: every request to PsiAnywhere is held — DOWN until its next health retry."""


class PsiTransport(RuntimeError):
    """The request timed out, failed with a 5xx or found no road."""


def _transport_kind(exc: BaseException) -> str:
    """What kind of transport failure this is, in words, or '' when it is not one (then it is somebody else's…"""
    if isinstance(exc, urllib.error.HTTPError):
        return f"answered {exc.code}" if exc.code >= 500 else ""
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return "timed out"
    if isinstance(exc, urllib.error.URLError):
        reason = exc.reason
        if isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason):
            return "timed out"
        return f"could not be reached ({type(reason).__name__})"
    if isinstance(exc, (ConnectionError, ssl.SSLError, OSError)):
        return f"the connection failed ({type(exc).__name__})"
    return ""


def _ask(method: str, body: dict, timeout: float) -> Any:
    """ONE REQUEST, THE STRATEGY'S WAY: refused while PsiAnywhere is held (DOWN, until its next health retry)…"""
    import psi_anywhere  # noqa: PLC0415
    held, why = psi_anywhere.paused()
    if held:
        raise PsiPaused(why)
    with psi_anywhere.wire():
        held, why = psi_anywhere.paused()
        if held:
            raise PsiPaused(why)
        try:
            return _call(method, body, timeout)
        except PsiAnswer:
            raise
        except urllib.error.HTTPError as exc:
            if exc.code < 500:
                raise PsiAnswer(f"{method}: answered {exc.code}") from exc
            raise PsiTransport(f"{method} {_transport_kind(exc)}") from exc
        except Exception as exc:  # noqa: BLE001 — classified, then re-raised
            kind = _transport_kind(exc)
            if not kind:
                raise
            raise PsiTransport(f"{method} {kind}") from exc


def _service_answers(timeout: float = PROBE_TIMEOUT_S) -> dict[str, Any]:
    """DOWN'S CHEAP HALF: {up, why}."""
    try:
        answer = _ask("getLogIn", {}, timeout)
    except PsiPaused as exc:
        return {"up": False, "why": str(exc)}
    except Exception as exc:  # noqa: BLE001 — every failure here is "not answering"
        return {"up": False, "why": f"{type(exc).__name__}: {str(exc)[:120]}"}
    word = read_login(answer)[1]
    if word:
        return {"up": True, "why": "the service answered in its own words"}
    return {"up": False, "why": f"the service answered without its login grammar — {str(answer)[:80]!r}"}


def _supervisors(token: str, timeout: float = PSI_TIMEOUT_S) -> tuple[list[dict], int]:
    """(the supervisor rows that name a person, how many rows came back)."""
    sups = _ask("getSingleEntrySupervisorsJSON", {"token": token}, timeout)
    if not isinstance(sups, list):
        raise PsiAnswer(f"the supervisor list is not a list — {str(sups)[:120]!r}")
    usable = [s for s in sups if isinstance(s, dict) and str(s.get("person_id") or "").strip().isdigit()]
    if not usable:
        raise PsiAnswer(f"{len(sups)} supervisor row(s), none with a person — {str(sups)[:120]!r}")
    return usable, len(sups)


def entries(token: str, day_from: date, day_to: date, timeout: float = PSI_TIMEOUT_S,
            deadline: float | None = None) -> tuple[list[dict], dict]:
    """Every entry between two Ohio days, across every supervisor's queue — on a session whose supervisor list…

    `deadline` (a time.monotonic() stamp) bounds a read that is not a collection's (the pay-period refresh): past it
    no further queue is asked and the read raises PsiTransport, as a request that timed out does. A collection passes
    none and reads every queue."""
    usable, listed = _supervisors(token, timeout)
    seen: dict[Any, dict] = {}
    for n, sup in enumerate(usable):
        if deadline is not None and time.monotonic() >= deadline:
            raise PsiTransport(f"the read ran past its budget after {n} of {len(usable)} supervisor queue(s)")
        sup_id = int(str(sup["person_id"]).strip())
        rows = _ask("singleEntryFilterAdminListJSON", {
            "token": token, "startDate": day_from.isoformat(), "endDate": day_to.isoformat(),
            "supervisorId": sup_id, "locationId": "",
            "employeeId": "", "status": "", "workCodeId": ""}, timeout)
        if not isinstance(rows, list):
            raise PsiAnswer(f"a supervisor's entries are not a list — {str(rows)[:120]!r}")
        for r in rows:
            if isinstance(r, dict):
                # WHICH QUEUE IT WAS READ FROM, the way the old scraper kept it: the punch house carries it as…
                seen[r.get("Single_Entry_ID") or id(r)] = dict(r, _supervisorId=sup_id)
    return list(seen.values()), {"supervisors": len(usable),
                                 "supervisor_rows_without_a_person": listed - len(usable)}


def _sign_in(timeout: float = PSI_TIMEOUT_S, account: str | None = None,
             purpose: str = "attendance") -> dict[str, Any]:
    """{token, word, why, sent, fault, account}."""
    import psi_anywhere  # noqa: PLC0415
    account = account or psi_anywhere.active_account()
    out: dict[str, Any] = {"token": "", "word": "", "why": "", "sent": False, "fault": "",
                           "account": account}
    user, pass_hash = psi_anywhere._credential(account)
    if not user or not pass_hash:
        out["why"] = f"no PsiAnywhere credential for the {psi_anywhere.ACCOUNT_LABELS[account]} account"
        return out
    ok, why = psi_anywhere.login_claim(purpose, account=account)
    if not ok:
        out["why"] = why
        return out
    out["sent"] = True
    try:
        answer = _ask("getLogIn", {"userId": user, "hash": pass_hash}, timeout)
    except PsiAnswer as exc:
        psi_anywhere.login_settle("unknown", "", account=account)
        out.update(fault="unreadable",
                   why=f"PsiAnywhere answered the login with something we cannot read — {exc}")
        return out
    except PsiPaused as exc:
        # THE SLOT WAS CLAIMED AND NOTHING LEFT: DOWN landed between the claim and the wire.
        out["sent"] = False
        out["why"] = str(exc)
        return out
    except PsiTransport as exc:
        psi_anywhere.login_settle("unknown", "", account=account)
        out.update(fault="transport", why=f"PsiAnywhere could not be asked ({exc})")
        return out
    except Exception as exc:  # noqa: BLE001 — a login that never landed is a reason, not a crash
        psi_anywhere.login_settle("unknown", "", account=account)
        out.update(fault="transport",
                   why=f"PsiAnywhere could not be asked ({type(exc).__name__}: {str(exc)[:120]})")
        return out
    token, word = read_login(answer)
    if not word:
        # NOT THE ACCOUNT'S WORD: an answer without a window_name is a service we cannot read, and the miss brake…
        psi_anywhere.login_settle("unknown", "", account=account)
        out.update(fault="unreadable",
                   why=f"PsiAnywhere answered the login without a window_name — {str(answer)[:120]!r}")
        return out
    psi_anywhere.login_settle("up", word, account=account)
    out["word"] = word
    if not token:
        out["why"] = (f"PsiAnywhere refused the {psi_anywhere.ACCOUNT_LABELS[account]} "
                      f"login: {word!r}")
        return out
    out["token"] = token
    return out


# ── the state and the pass ─────────────────────────────────────────────────

_LOCK = threading.Lock()
_S: dict[str, Any] = {}
_CACHE: dict[str, Any] = {"at": 0.0, "shifts": [], "counts": Counter(), "offs": {}, "loose": [],
                          "freshness": "", "plan_said": "", "held_said": "", "books_why": "",
                          # rule 8's Daily Notes and the houses' own names, read with the books and never on their…
                          "notes": None, "houses": {}}
# The board as last written, for the follow-up plan and the reminders.
_BOARD: dict[str, Any] = {"at": 0.0, "rows": [], "status": {}}
# THE LAST READ, IN MEMORY: the entries the last collection saw (allow-listed), its instant and the first day it…
_LAST_READ: dict[str, Any] = {"at": "", "rows": [], "day_from": None}


def _load() -> dict[str, Any]:
    if _S:
        return _S
    got: Any = None
    inherit = ""
    try:
        got = json.loads(STATE_FILE.read_text(encoding="utf-8") or "null")
    except FileNotFoundError:
        # THE FIRST START OF THIS VERSION INHERITS A REFUSAL.
        inherit = "Not active (the last answer on record)"
    except (OSError, ValueError) as exc:
        inherit = f"unknown (the attendance state was unreadable: {type(exc).__name__})"
    if not isinstance(got, dict):
        if not inherit:
            inherit = "unknown (the attendance state was not a record)"
        got = {}
    _S.update({
        "last_done": str(got.get("last_done") or ""),
        "judged": dict(got.get("judged") or {}),
        "seen": dict(got.get("seen") or {}),
        "pending": [r for r in (got.get("pending") or []) if isinstance(r, dict) and r.get("_id")],
        "post_after": float(got.get("post_after") or 0.0),
        # THE KEPT SESSION: the token the service last handed over and the moment it did.
        "session": dict(got.get("session") or {}) if isinstance(got.get("session"), dict) else {},
        # How the last collection ended, and the last one that READ.
        "clock": dict(got.get("clock") or {}) if isinstance(got.get("clock"), dict) else {},
        "read_at": str(got.get("read_at") or ""),
        # Whether the entry history holds that read.
        "history_ok": bool(got.get("history_ok", True)),
        # The wait after collections that were sent and could not read.
        "backoff": dict(got.get("backoff") or {}) if isinstance(got.get("backoff"), dict) else {},
        # No new login while a fresh session could not read (RELOGIN_REST_S).
        "relogin_rest": (dict(got.get("relogin_rest") or {})
                         if isinstance(got.get("relogin_rest"), dict) else {}),
        # What the follow-up collections have spent, per Ohio day and per shift.
        "follow_ups": (dict(got.get("follow_ups") or {})
                       if isinstance(got.get("follow_ups"), dict) else {}),
        # HOW LONG A KEPT SESSION LIVES, measured by the lane itself: the oldest one the service still took, and the…
        "session_life": (dict(got.get("session_life") or {})
                         if isinstance(got.get("session_life"), dict) else {}),
        # The Ty slots already spent (slot key → what happened), a few days.
        "ty_slots": (dict(got.get("ty_slots") or {})
                     if isinstance(got.get("ty_slots"), dict) else {}),
        # THE DAY THE LANE FIRST READ THE CLOCK, set once.
        "reading_since": str(got.get("reading_since") or min(
            (str(v) for v in (got.get("seen") if isinstance(got.get("seen"), dict) else {}).values()
             if v), default="")),
        # THE PAY-PERIOD REFRESH: the New York day it last ran, the tries spent that day and how the last one ended —
        # kept here so a restart neither repeats a refresh that read nor buys a third try — and, between a read and
        # the beat that pays it, the read it is owed on (`owed`).
        "period_refresh": (dict(got.get("period_refresh") or {})
                           if isinstance(got.get("period_refresh"), dict) else {}),
    })
    if inherit:
        try:
            import psi_anywhere  # noqa: PLC0415
            psi_anywhere.login_refused(inherit)
        except Exception as exc:  # noqa: BLE001
            log.warning("psi attendance: the refusal could not be inherited (%s)", type(exc).__name__)
        _save()
    return _S


def prepare() -> None:
    """Load the lane's state at start, before anything can log in; nothing while the lane is held here."""
    if held_here():
        return
    with _LOCK:
        _load()


def _save() -> None:
    tmp = STATE_FILE.with_name(STATE_FILE.name + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(_S, fh, default=str)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, STATE_FILE)
    except OSError as exc:
        log.warning("psi attendance: the state file could not be written (%s: %s)",
                    type(exc).__name__, exc)


def _recent(now: datetime) -> set[str]:
    cut = (now.astimezone(OHIO).date() - timedelta(days=SEEN_RECENT_DAYS)).isoformat()
    return {k for k, v in _S["seen"].items() if v >= cut}


def _recent_complete(now: datetime) -> bool:
    """Has the lane been reading the clock for the whole SEEN_RECENT_DAYS window?"""
    first = str(_S.get("reading_since") or "")
    cut = (now.astimezone(OHIO).date() - timedelta(days=SEEN_RECENT_DAYS)).isoformat()
    return bool(first) and first <= cut


def _prune(now: datetime) -> list[dict]:
    """Forget what is old; hand back the pending rows that went stale."""
    today = now.astimezone(OHIO).date()
    cut = (today - timedelta(days=3)).isoformat()
    _S["judged"] = {k: v for k, v in _S["judged"].items() if v >= cut}
    keep = (today - timedelta(days=SEEN_KEEP_DAYS)).isoformat()
    _S["seen"] = {k: v for k, v in _S["seen"].items() if v >= keep}
    fresh, gone = [], []
    for r in _S["pending"]:
        try:
            age = _mins(now, datetime.fromisoformat(r["shift_at"]))
        except (KeyError, ValueError):
            age = STALE_AFTER_MIN + 1
        (gone if age > STALE_AFTER_MIN else fresh).append(r)
    _S["pending"] = fresh
    return gone


# the last publish heard; kept apart from _CACHE["at"] so a publish during a read still forces the next one
_ROSTER_MOVED: dict[str, float] = {"at": 0.0}


def roster_moved() -> None:
    """A house calendar was published: re-read the roster next beat (thread-safe)."""
    _ROSTER_MOVED["at"] = datetime.now(UTC).timestamp()


def roster_moved_since_read() -> bool:
    """Was a house calendar published after the roster in hand was read?"""
    return float(_ROSTER_MOVED["at"]) > float(_CACHE["at"] or 0.0)


def _refresh(dsn: str, now: datetime) -> None:
    today = now.astimezone(OHIO).date()
    shifts, counts = roster(dsn, today - timedelta(days=1), today + timedelta(days=1))
    offs, loose, freshness = called_off(dsn, today - timedelta(days=1), today + timedelta(days=1))
    _CACHE.update(at=now.timestamp(), shifts=shifts, counts=counts, offs=offs, loose=loose,
                  freshness=freshness)
    # THE TWO READS THE ROSTER DOES NOT NEED, EACH ON ITS OWN FATE: a notes book or a house directory that will not…
    try:
        _CACHE["notes"] = notes_written(dsn)
    except Exception as exc:  # noqa: BLE001
        _CACHE["notes"] = {"ok": False, "by_key": {}, "why": type(exc).__name__}
    try:
        _CACHE["houses"] = house_names(dsn) or _CACHE.get("houses") or {}
    except Exception:  # noqa: BLE001 — the last names read stand
        pass


def _told(s: dict) -> bool:
    return told_by_a_human(s, _CACHE["offs"], _CACHE["loose"]) is not None


def _unjudged(now: datetime) -> list[dict]:
    """Every shift not judged yet and not stale."""
    return [s for s in _CACHE["shifts"]
            if shift_id(s) not in _S["judged"] and _mins(now, s["shift_at"]) <= STALE_AFTER_MIN]


def _instant(raw: Any) -> datetime | None:
    try:
        got = datetime.fromisoformat(str(raw or ""))
    except ValueError:
        return None
    return got if got.tzinfo else got.replace(tzinfo=UTC)


def _read_at() -> datetime | None:
    """When the clock was last READ — a collection that came back with entries."""
    return _instant(_S.get("read_at"))


def _note_clock(state: str, why: str, now: datetime) -> None:
    _S["clock"] = {"state": state, "why": str(why or "")[:300], "at": now.isoformat()}


def _keep_session(token: str, now: datetime, account: str = "") -> None:
    import psi_anywhere  # noqa: PLC0415
    _S["session"] = {"token": token, "obtained_at": now.isoformat(),
                     "account": account or psi_anywhere.active_account()}
    _save()


def _session_token() -> str:
    """The kept token — unless the account has refused a login since, or the lane has since switched to the other…"""
    session = _S.get("session") or {}
    token = str(session.get("token") or "")
    if not token:
        return ""
    import psi_anywhere  # noqa: PLC0415
    if psi_anywhere.login_snapshot().get("refused") \
            or str(session.get("account") or "adm") != psi_anywhere.active_account():
        _S["session"] = {}
        _save()
        return ""
    return token


def _session_age_min(now: datetime) -> float | None:
    got = _instant((_S.get("session") or {}).get("obtained_at"))
    return None if got is None else round(_mins(now, got), 1)


def _session_taken(now: datetime) -> None:
    """A read on the kept session landed: the oldest age it was still taken at."""
    age = _session_age_min(now)
    if age is None:
        return
    life = _S.setdefault("session_life", {})
    if age > float(life.get("longest_taken_min") or 0.0):
        life["longest_taken_min"] = age


def _session_refused(now: datetime, exc: BaseException) -> None:
    """The kept session was not taken."""
    age = _session_age_min(now)
    life = _S.setdefault("session_life", {})
    if age is not None:
        life["refused_at_min"] = ([age] + list(life.get("refused_at_min") or []))[:10]
    log.info("psi attendance: the kept session, obtained %s min ago, was not taken (%s) — the "
             "oldest one taken so far was %s min old; ages it was refused at: %s",
             age if age is not None else "?", str(exc)[:120],
             life.get("longest_taken_min", "?"), life.get("refused_at_min") or [])


def _credential_stamp() -> Any:
    try:
        import psi_anywhere  # noqa: PLC0415
        return psi_anywhere._secret_stamp()
    except Exception:  # noqa: BLE001 — no stamp is a stamp that never moves
        return None


def _relogin_rest(now: datetime) -> str:
    """Why no new login may be made now because a FRESH session could not read, or '' when it may."""
    rest = _S.get("relogin_rest") or {}
    since = _instant(rest.get("at"))
    if since is None:
        return ""
    import psi_anywhere  # noqa: PLC0415
    if str(rest.get("account") or "adm") != psi_anywhere.active_account():
        # THE REST IS THE ACCOUNT'S: a session of the other account that could not read says nothing about this one.
        return ""
    until = since + timedelta(seconds=RELOGIN_REST_S)
    if now >= until or rest.get("stamp") != _credential_stamp():
        _S["relogin_rest"] = {}
        _save()
        return ""
    return (f"a session signed in at {since.astimezone(OHIO):%H:%M} could not read either "
            f"({rest.get('why') or 'an answer we cannot use'}) — no new login until "
            f"{until.astimezone(OHIO):%m/%d %H:%M}, a read on the kept session, or a new "
            "credential file")


def _fresh_unreadable(now: datetime, exc: BaseException) -> None:
    import psi_anywhere  # noqa: PLC0415
    _S["relogin_rest"] = {"at": now.isoformat(), "why": str(exc)[:160],
                          "stamp": _credential_stamp(), "account": psi_anywhere.active_account()}
    _save()


def _backoff_until(now: datetime) -> datetime | None:
    """The first moment the next collection may go after collections that were sent and could not read, or None."""
    got = _S.get("backoff") or {}
    until = _instant(got.get("until"))
    if until is None:
        return None
    if got.get("stamp") != _credential_stamp():
        _S["backoff"] = {}
        _save()
        return None
    return until if until > now else None


def _backoff_bump(now: datetime, why: str) -> datetime:
    n = int((_S.get("backoff") or {}).get("n") or 0) + 1
    wait = min(FAIL_BACKOFF_MIN * (2 ** (n - 1)), FAIL_BACKOFF_MAX_MIN)
    until = now + timedelta(minutes=wait)
    _S["backoff"] = {"n": n, "until": until.isoformat(), "why": str(why or "")[:160],
                     "stamp": _credential_stamp()}
    log.info("psi attendance: %s collection(s) in a row were sent and could not read — the next "
             "one waits until %s (%s min)", n, until.astimezone(OHIO).strftime("%m/%d %H:%M"),
             int(wait))
    return until


def _clock_now(now: datetime) -> tuple[str, str]:
    """(state, why) of the clock as the board and the reminders must read it: what stops it being read at all…"""
    import psi_anywhere  # noqa: PLC0415
    if not psi_anywhere.credential_present():
        return "no_credential", "no PsiAnywhere credential on this host"
    down = psi_anywhere.down_state()
    if down:
        # THE LOGIN CLOCK KEEPS REAL TIME (every ration on it does), so DOWN and its retry are read on it, never on…
        return "down", psi_anywhere.paused()[1] or (
            f"PsiAnywhere is down ({down.get('why') or 'a read and the login after it both failed'})"
            " — the health retry is due")
    held, why = psi_anywhere.paused()
    if held:
        return "paused", why
    if psi_anywhere.login_snapshot().get("refused"):
        ok, why = psi_anywhere.login_would_allow()
        if not ok:
            return "refused", why
    last = _S.get("clock") or {}
    return str(last.get("state") or "never_read"), str(last.get("why") or "")


def _mode(now: datetime) -> str:
    """'psi' unless the clock CANNOT be read; 'calendar' then — the reminders go from the roster (rule 13's "go…"""
    state, _why = _clock_now(now)
    return "calendar" if state in ("no_credential", "down", "refused") else "psi"


def _missing(now: datetime) -> list[dict]:
    """The board's shifts a real read found with no punch, still inside the day and not stopped (a reply, nobody…"""
    import psi_reminders  # noqa: PLC0415
    try:
        stopped = psi_reminders.stopped_shifts()
    except Exception:  # noqa: BLE001 — no ledger, nobody stopped
        stopped = set()
    try:
        waiting = psi_reminders.awaiting()
    except Exception:  # noqa: BLE001 — no ledger, nobody waiting
        waiting = set()
    out = []
    for r in _BOARD.get("rows") or []:
        if r.get("row_kind") != "shift":
            continue
        # `not_entered_yet` is left out: a read that late backs no message, so a collection made for it would buy…
        if r.get("verdict") not in _NOTHING_READ and not (
                r.get("id") in waiting and r.get("verdict") in _NOTHING_READ | {"clock_not_read"}):
            continue
        at = _instant(r.get("shift_at"))
        until = psi_reminders.owed_until(r)
        # THE SAME BOUND AS THE MESSAGE IT BACKS: a check nobody may be told about is a request nobody needs.
        if at is None or _mins(now, at) > STALE_AFTER_MIN or r.get("id") in stopped \
                or until is None or now > until or r.get("known") is False:
            continue
        out.append(r)
    return out


def _follow_ups_spent(now: datetime) -> tuple[int, dict[str, int]]:
    """(dedicated follow-up collections made today, per shift id)."""
    got = _S.get("follow_ups") or {}
    today = now.astimezone(OHIO).date().isoformat()
    n = int(got.get("n") or 0) if got.get("day") == today else 0
    return n, {str(k): int(v or 0) for k, v in (got.get("by_shift") or {}).items()}


def _follow_up_rows(now: datetime) -> list[dict]:
    """The missing shifts a follow-up collection may still be made for: the day's purse not empty, and the…"""
    spent_today, by_shift = _follow_ups_spent(now)
    if FOLLOW_UP_DAY_MAX > 0 and spent_today >= FOLLOW_UP_DAY_MAX:
        return []
    return [r for r in _missing(now)
            if FOLLOW_UPS_PER_SHIFT <= 0 or by_shift.get(str(r.get("id"))) is None
            or by_shift[str(r.get("id"))] < FOLLOW_UPS_PER_SHIFT]


def _follow_up_spend(now: datetime, rows: list[dict]) -> None:
    """A dedicated follow-up collection left this host: one from the day's purse and one from each shift's it was…"""
    spent_today, by_shift = _follow_ups_spent(now)
    for r in rows:
        sid = str(r.get("id") or "")
        if sid:
            by_shift[sid] = by_shift.get(sid, 0) + 1
    cut = (now - timedelta(minutes=STALE_AFTER_MIN + 1440)).astimezone(UTC).isoformat()
    by_shift = {k: v for k, v in by_shift.items() if k.rsplit("|", 1)[-1] >= cut}
    _S["follow_ups"] = {"day": now.astimezone(OHIO).date().isoformat(), "n": spent_today + 1,
                        "by_shift": by_shift}
    if FOLLOW_UP_DAY_MAX > 0 and spent_today + 1 == FOLLOW_UP_DAY_MAX:
        log.info("psi attendance: the day's %s follow-up collections are spent — until midnight "
                 "the missing are looked at only by the collections the roster plans",
                 FOLLOW_UP_DAY_MAX)


def _follow_up_at(now: datetime, last_done: datetime | None) -> datetime | None:
    """RULE 13: every FOLLOW_UP_MIN while somebody a check found missing is still missing (within the purses…"""
    if not _follow_up_rows(now):
        return None
    import psi_reminders  # noqa: PLC0415
    at = (last_done + timedelta(minutes=FOLLOW_UP_MIN)) if last_done is not None else now
    if last_done is not None and psi_reminders.quiet(last_done):
        at = min(at, psi_reminders.quiet_ends(last_done))
    return psi_reminders.quiet_ends(at)


def _warning_reads(now: datetime) -> tuple[datetime | None, list[dict]]:
    """(when, the shifts) a read is owed for the live punch warnings — asked of server/punch_pairs.py, which…"""
    try:
        import punch_pairs  # noqa: PLC0415
        got = punch_pairs.reads_wanted(now, _read_at())
    except Exception as exc:  # noqa: BLE001
        log.warning("psi attendance: the punch warnings' reads could not be planned (%s: %s)",
                    type(exc).__name__, str(exc)[:160])
        return None, []
    return got.get("at"), list(got.get("shifts") or [])


def _union(kept: Iterable[dict], fresh: Iterable[dict]) -> list[dict]:
    """The history and the last read, one row per Single_Entry_ID, the last read winning (an entry read open is…"""
    by: dict[str, dict] = {}
    loose: list[dict] = []
    for r in list(kept) + list(fresh):
        if not isinstance(r, dict):
            continue
        k = str(r.get("Single_Entry_ID") or "").strip()
        if k:
            by[k] = r
        else:
            loose.append(r)
    return list(by.values()) + loose


def _read_index(rows: list[dict], day_from: date, day_to: date) -> dict:
    """THE JUDGE STANDS WHERE THE BOARD STANDS: this read and what the entry history kept of the same days, one…"""
    try:
        import psi_entries  # noqa: PLC0415
        kept = psi_entries.between(day_from, day_to)
    except Exception as exc:  # noqa: BLE001 — the read alone still judges
        log.info("psi attendance: the entry history could not be joined to the read (%s)",
                 type(exc).__name__)
        kept = []
    return punch_index(_union(kept, rows))[0]


def _board_index(now: datetime) -> tuple[dict, str, date | None]:
    """(punch index, the history's state, absence_from) for the board."""
    today = now.astimezone(OHIO).date()
    state = "kept"
    try:
        import psi_entries  # noqa: PLC0415
        kept = psi_entries.between(today - timedelta(days=2), today, strict=True)
    except Exception as exc:  # noqa: BLE001 — unreadable is not empty
        log.warning("psi attendance: the entry history could not be read (%s) — the board stands "
                    "on the last read alone", type(exc).__name__)
        kept, state = [], "unreadable"
    if state == "kept" and not _S.get("history_ok", True):
        state = "unwritten"
    fresh = (list(_LAST_READ.get("rows") or [])
             if _LAST_READ.get("at") and _LAST_READ["at"] == _S.get("read_at") else [])
    index, _counts = punch_index(_union(kept, fresh))
    if state == "kept":
        return index, state, None
    return index, state, (_LAST_READ.get("day_from") if fresh else None) or date.max


def _board_write(now: datetime) -> None:
    """THE PUNCH BOARD, on disk, atomically: the verdicts, the clock's state beside them, and what the reminders…"""
    try:
        today = now.astimezone(OHIO).date()
        days = (today - timedelta(days=1), today)
        index, history, absence_from = _board_index(now)
        got = board(_CACHE["shifts"], index, _recent(now), _CACHE["offs"], _CACHE["loose"],
                    now, _read_at(), days, absence_from=absence_from,
                    recent_complete=_recent_complete(now))
        # THE HOUSE'S OWN NAME rides every row ("JH home"), for the texts and the screens; the code stays where it…
        names = _CACHE.get("houses") or {}
        for r in got["rows"]:
            if r.get("house"):
                r["house_name"] = names.get(str(r["house"]).strip().upper(), "")
        _BOARD.update(at=now.timestamp(), rows=got["rows"])
        _remind(now)
        _pair(now, index, absence_from, days)
        state, why = _clock_now(now)
        try:
            import psi_reminders  # noqa: PLC0415
            reminders = psi_reminders.status()
            # WHAT THE FLOW KNOWS OF EACH SHIFT — the reply, the house manager told nobody came, the late call…
            flow = psi_reminders.marks()
            for r in got["rows"]:
                r.update(flow.get(str(r.get("id") or ""), {}))
        except Exception:  # noqa: BLE001
            reminders = {"readable": False}
        # THE PAIR BESIDE THE ENTRY: each shift's pair verdict and the warning on it, and the lane's own card — the…
        try:
            import punch_pairs  # noqa: PLC0415
            pairs_marks = punch_pairs.marks()
            for r in got["rows"]:
                r.update(pairs_marks.get(str(r.get("id") or ""), {}))
            pairs = punch_pairs.board_status(now)
        except Exception as exc:  # noqa: BLE001 — unreadable, and said so
            pairs = {"readable": False, "why": f"the punch pairs could not be read ({type(exc).__name__})"}
        read = _read_at()
        status = {
            "row_kind": "status", "id": "status",
            "generated_at": now.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "clock_state": state, "clock_why": why,
            "read_at": read.astimezone(OHIO).isoformat() if read else "",
            "last_attempt": dict(_S.get("clock") or {}),
            "mode": _mode(now),
            "next_collection": _CACHE.get("next_at") or "",
            # Whether a collection is due for the missing alone — within the day's and each shift's purse.
            "follow_up": bool(_follow_up_rows(now)),
            "follow_ups_today": _follow_ups_spent(now)[0],
            "days": [d.isoformat() for d in days],
            "counts": got["counts"],
            "books": _CACHE.get("freshness") or "",
            "books_why": _CACHE.get("books_why") or "",
            "books_at": (datetime.fromtimestamp(float(_CACHE["at"]), UTC)
                         .strftime("%Y-%m-%dT%H:%M:%SZ") if _CACHE.get("at") else ""),
            # "kept" while the entry history holds every read; otherwise the absences it cannot vouch for read…
            "history": history,
            # WHETHER a session is kept — never the session — and how long the lane has measured one to live, in…
            "session_kept": bool((_S.get("session") or {}).get("token")),
            "session_life": dict(_S.get("session_life") or {}),
            "reminders": reminders,
            # THE PUNCH PAIRS (server/punch_pairs.py): when the shifts were paired, whether that is stale, and every…
            "pairs": pairs,
            # WHICH ACCOUNT THE LANE SIGNS IN WITH, Ty's day (its tries, the last one and its answer, the next slot)…
            **_accounts_status(now),
        }
        _BOARD["status"] = status
        body = {"generated_at": status["generated_at"], "status": status, "rows": got["rows"]}
        tmp = BOARD_FILE.with_name(BOARD_FILE.name + ".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(body, fh, default=str)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, BOARD_FILE)
    except Exception as exc:  # noqa: BLE001 — the board is a view; the lane goes on
        log.warning("psi attendance: the punch board could not be written (%s: %s)",
                    type(exc).__name__, str(exc)[:160])


def _accounts_status(now: datetime) -> dict[str, Any]:
    """{account, ty, down} for the board's status row."""
    import psi_anywhere  # noqa: PLC0415

    def iso(ts: Any) -> str:
        return (datetime.fromtimestamp(float(ts), UTC).astimezone(OHIO).isoformat()
                if ts else "")
    ty = psi_anywhere.ty_status()
    done = _ty_done()
    last_slot = max(done) if done else ""
    down = psi_anywhere.down_state()
    return {
        "account": psi_anywhere.active_account(),
        "ty": {"configured": ty["configured"], "active": ty["active"],
               "slots": list(TY_SLOTS), "next_slot": "" if not ty["configured"] or ty["active"]
               else _ty_next(now),
               "tries_today": ty["tries_today"], "tries_per_day": ty["tries_per_day"],
               "last_at": ty["last_at"], "last_answer": ty["last_answer"],
               "last_slot": last_slot, "last_slot_said": done.get(last_slot, "") if last_slot else "",
               "refused": ty["refused"]},
        "down": ({"since": iso(down.get("since")), "why": str(down.get("why") or ""),
                  "retry_at": iso(down.get("retry_at")), "retries": int(down.get("retries") or 0)}
                 if down else None),
    }


def _pair(now: datetime, index: dict, absence_from: date | None,
          days: Iterable[date]) -> None:
    """Re-pair the punches to the SHIFTS from the same reads the board stands on — the pair rule is per shift…"""
    try:
        import punch_pairs  # noqa: PLC0415
        wanted = {d for d in days}
        punch_pairs.note([s for s in _CACHE["shifts"] if s["shift_date"] in wanted],
                         index, _recent(now), now, read_at=_read_at(),
                         absence_from=absence_from, houses=_CACHE.get("houses") or {},
                         offs=_CACHE.get("offs") or {}, loose=_CACHE.get("loose") or [])
    except Exception as exc:  # noqa: BLE001
        log.warning("psi attendance: the punch pairs could not be read (%s: %s)",
                    type(exc).__name__, str(exc)[:160])


def _remind(now: datetime) -> None:
    """Re-plan the shift flow from the board as it stands, with the Daily Notes read beside the books (rule 8)."""
    try:
        import psi_reminders  # noqa: PLC0415
        psi_reminders.refresh(_BOARD.get("rows") or [], _mode(now), now, notes=_CACHE.get("notes"))
    except Exception as exc:  # noqa: BLE001
        log.warning("psi attendance: the reminders could not be planned (%s: %s)",
                    type(exc).__name__, str(exc)[:160])


def held_here() -> str:
    """Why the lane may not run in this process ('' when it may): the credential it signs in with is not mounted
    here (psi_anywhere.unmounted), so nothing is read, asked or written."""
    import psi_anywhere  # noqa: PLC0415
    return psi_anywhere.unmounted()


def tick(dsn: str, now: datetime | None = None) -> dict:
    """One beat of the lane."""
    why = held_here()
    if why:
        return {"state": "held", "why": why}
    with _LOCK:
        return _tick(dsn, (now or datetime.now(UTC)).astimezone(UTC))


def _tick(dsn: str, now: datetime) -> dict:
    """The pass, then the board and the reminders; then the day's pay-period refresh — owed by a collection that read,
    paid by a later beat that made none."""
    out = _pass(dsn, now)
    moved = bool(out.pop("_board", False))
    landed = bool(out.pop("_read_landed", False))
    if moved or not _BOARD.get("at") or now.timestamp() - float(_BOARD["at"]) >= REFRESH_S:
        _board_write(now)
        out["board"] = True
    else:
        _remind(now)
    # NOTHING OF THE REFRESH ESCAPES THE BEAT: whatever it raises, the app's beat still notifies the board, posts the
    # shift flow and delivers the verdicts.
    try:
        if landed:
            # THE READ'S OWN BEAT ONLY MARKS IT OWED: the app's beat (attendance_loop.beat) delivers this read's verdicts
            # after tick() returns, so the day's one long read waits for a beat that brought none.
            _period_refresh_owe(now)
            said = None
        elif out.get("state") in _PERIOD_REFRESH_QUIET and not out.get("ty"):
            said = _period_refresh(now)
        else:
            said = None
    except Exception as exc:  # noqa: BLE001
        log.warning("psi attendance: the pay-period refresh failed (%s: %s)", type(exc).__name__, str(exc)[:160])
        said = None
    if said is not None:
        out["period_refresh"] = {k: said.get(k) for k in ("ok", "tries", "periods", "rows", "added", "changed")}
    return out


def _collect(day_from: date, day_to: date, now: datetime) -> dict:
    """ONE COLLECTION: the kept session first, a login only when there is none or the kept one could not read…"""
    out: dict[str, Any] = {"state": "", "why": "", "sent": False, "rows": [], "meta": {}}
    token = _session_token()
    reused = bool(token)
    lead = ""
    if reused:
        out["sent"] = True
        try:
            rows, meta = entries(token, day_from, day_to)
        except PsiPaused as exc:
            out.update(state="held", why=str(exc), sent=False)
            return out
        except PsiTransport as exc:
            # THE KEPT SESSION IS KEPT: a service that timed out says nothing against the session, and if the login…
            lead = f"the read on the kept session failed ({str(exc)[:120]})"
        except Exception as exc:  # noqa: BLE001 — anything unreadable
            _session_refused(now, exc)
            lead = f"the kept session was not taken ({str(exc)[:120]})"
            rest = _relogin_rest(now)
            if rest:
                # A FRESH SESSION FAILED THE SAME WAY NOT LONG AGO: the kept one is kept (it may read again when the…
                out.update(state="unknown", why=f"{lead}; {rest}")
                return out
            # NOT TAKEN — or the answer was not one a working session gets, which here is the same thing.
            _S["session"] = {}
            _save()
        else:
            _session_taken(now)
            out.update(state="read", rows=rows, meta=meta)
            return out
    else:
        rest = _relogin_rest(now)
        if rest:
            out.update(state="held", why=rest)
            return out
    return _login_and_read(out, day_from, day_to, now, lead, reused)


def _login_and_read(out: dict, day_from: date, day_to: date, now: datetime, lead: str,
                    reused: bool, account: str | None = None, purpose: str = "attendance",
                    fallback_ok: bool = True) -> dict:
    """The login `_collect` decided on, and the read on its fresh session."""
    import psi_anywhere  # noqa: PLC0415
    signed = _sign_in(account=account, purpose=purpose)
    out["sent"] = bool(out["sent"] or signed["sent"])
    # A LOGIN THE SERVICE ANSWERED IN ITS OWN GRAMMAR — Token or a refusal — is PsiAnywhere up, whatever the read…
    out["login_answered"] = bool(out.get("login_answered") or signed["word"])
    acct = signed["account"]
    label = psi_anywhere.ACCOUNT_LABELS[acct]
    prefix = f"{lead}; " if lead else ""
    if not signed["token"]:
        if not signed["sent"]:
            out.update(state="held", why=prefix + signed["why"])
            return out
        if signed["word"]:
            # THE ACCOUNT'S OWN REFUSAL: the service answered — not DOWN.
            _S["session"] = {}
            _save()
            if acct == "ty" and fallback_ok:
                return _fall_back(out, day_from, day_to, now,
                                  f"{prefix}the Ty account refused the login ({signed['word']!r})")
            out.update(state="refused", why=prefix + signed["why"])
            return out
        # SENT, AND NO ANSWER IN THE SERVICE'S LOGIN GRAMMAR: the login could not be made.
        why = (f"{lead or 'no session was kept to read with'}; and the {label} login right "
               f"after it failed too — {signed['why']}")
        psi_anywhere.mark_down(why[:200])
        out.update(state="down", why=why)
        return out
    _keep_session(signed["token"], now, acct)
    try:
        rows, meta = entries(signed["token"], day_from, day_to)
    except PsiPaused as exc:
        out.update(state="held", why=str(exc))
        return out
    except PsiTransport as exc:
        # SIGNED IN, AND THE READ ON THE FRESH SESSION FAILED: the login worked, so by the definition above this is…
        out.update(state="unknown", why=f"{prefix}signed in as {label}, but the read after it "
                                        f"failed — {str(exc)[:160]}")
        return out
    except Exception as exc:  # noqa: BLE001
        if acct == "ty" and fallback_ok:
            return _fall_back(out, day_from, day_to, now,
                              f"{prefix}a fresh Ty session could not read ({str(exc)[:120]})")
        _fresh_unreadable(now, exc)
        out.update(state="unknown", why=(f"{prefix}signed in{' again' if reused else ''}, and the "
                                         f"entries still could not be read — {str(exc)[:200]}; no "
                                         f"new login for {round(RELOGIN_REST_S / 3600, 1)} h"))
        return out
    out.update(state="read", rows=rows, meta=dict(meta, relogin=reused, account=acct))
    return out


def _fall_back(out: dict, day_from: date, day_to: date, now: datetime, why: str) -> dict:
    """THE TY LINE REFUSED: back to ADM at once — one login, in this very collection — and the twice-daily Ty…"""
    import psi_anywhere  # noqa: PLC0415
    psi_anywhere.set_active("adm", why[:160])
    _S["session"] = {}
    _save()
    log.warning("psi attendance: %s — back to the ADM line, one login now", why[:200])
    return _login_and_read(out, day_from, day_to, now, why, True, account="adm",
                           purpose="fallback", fallback_ok=False)


def _quiet_beat(out: dict, now: datetime) -> dict:
    """A BEAT THAT SENT NOTHING TO PSIANYWHERE IS ONE A TY SLOT MAY USE."""
    ty = _ty_maybe(now)
    if ty:
        out["ty"] = ty
        out["_board"] = True
    return out


def _pass(dsn: str, now: datetime) -> dict:
    _load()
    gone = _prune(now)
    if gone:
        _save()
        log.warning("psi attendance: %s row(s) went stale before the door took them and were "
                    "let go (%s)", len(gone), ", ".join(r.get("person", "?") for r in gone[:6]))
    last_done = _instant(_S["last_done"]) if _S["last_done"] else None
    books_moved = False
    if now.timestamp() - float(_CACHE["at"] or 0.0) >= REFRESH_S or roster_moved_since_read():
        try:
            _refresh(dsn, now)
            books_moved = True
            _CACHE["books_why"] = ""
        except Exception as exc:  # noqa: BLE001 — no books, no plan, nobody named
            _CACHE["at"] = now.timestamp()
            _CACHE["books_why"] = f"{type(exc).__name__}: {str(exc)[:120]}"
            log.warning("psi attendance: the roster or the call-off books could not be read "
                        "(%s: %s) — no collection until they can", type(exc).__name__, str(exc)[:160])
            return _quiet_beat({"state": "unknown", "why": f"books unreadable ({type(exc).__name__})",
                                "_board": True}, now)
    import psi_anywhere  # noqa: PLC0415
    # THE TY LINE REFUSED ELSEWHERE — the health probe's own login heard it — is the ADM line again at once, the way…
    if psi_anywhere.active_account() == "ty" and psi_anywhere.login_snapshot().get("refused"):
        word = (psi_anywhere.login_snapshot().get("refused") or {}).get("word")
        psi_anywhere.set_active("adm", f"the Ty account refused a login ({word!r})")
        _S["session"] = {}
        _save()
    # DOWN FIRST: nothing is asked of a PsiAnywhere that is down until its next health retry, and then the…
    retry = False
    if psi_anywhere.down_state():
        if not psi_anywhere.down_retry_due():
            state, why = _clock_now(now)
            moved = (str(_S["clock"].get("state") or ""), str(_S["clock"].get("why") or "")) != (state, why)
            if moved:
                _note_clock(state, why, now)
                _save()
            return {"state": "down", "why": why, "_board": moved or books_moved}
        probe = _service_answers()
        if not probe["up"]:
            psi_anywhere.mark_down(f"the health retry's service probe: {probe['why']}")
            _note_clock("down", _clock_now(now)[1], now)
            _save()
            return {"state": "down", "why": probe["why"], "_board": True}
        # THE SERVICE ANSWERS AGAIN: the only proof that counts is a read on our own session, so a collection goes…
        retry = True
    starts = [s["shift_at"] for s in _unjudged(now) if not _told(s)]
    local = now.astimezone(OHIO)
    plan = day_plan(starts, last_done, local.replace(hour=23, minute=59, second=59))
    said = " ".join(p.astimezone(OHIO).strftime("%H:%M") for p in plan)
    if said != _CACHE["plan_said"]:
        _CACHE["plan_said"] = said
        c = _CACHE["counts"]
        log.info("psi attendance: collections planned for the rest of %s — %s (from %s open "
                 "houred start(s); %s roster cell(s) carry no hour, %s placeholder row(s))",
                 local.strftime("%a %m/%d"), said or "none", len(starts),
                 c.get("no_hour", 0), c.get("not_a_person", 0))
    at_plan = next_collection(starts, last_done)
    at_follow = _follow_up_at(now, last_done)
    # THE MORNING READ: rows the quiet window held are offered only on a read made after it ended (`pending`), so…
    at_morning = _morning_read_at(now)
    # A LIVE PUNCH WARNING'S OWN READ, on its cadence and outside the purses.
    at_warn, warn_rows = _warning_reads(now)
    candidates = [x for x in (at_plan, at_follow, at_morning, at_warn) if x is not None]
    at = min(candidates) if candidates else None
    # AFTER COLLECTIONS THAT WERE SENT AND COULD NOT READ, the next one waits its turn in the backoff, whatever the…
    wait = _backoff_until(now)
    if at is not None and wait is not None:
        at = max(at, wait)
    if retry:
        # DOWN'S HEALTH RETRY IS ITS OWN SPACING: the backoff is not waited on.
        at = now
    _CACHE["next_at"] = at.astimezone(OHIO).isoformat() if at else ""
    if at is None or now < at:
        # NO COLLECTION ON THIS BEAT: a Ty slot may use it (`_quiet_beat`).
        return _quiet_beat({"state": "waiting", "next": at.isoformat() if at else "",
                            "_board": books_moved}, now)
    # A COLLECTION MADE ONLY FOR THE MISSING spends the follow-up purses.
    for_missing = (not retry and at_follow is not None and now >= at_follow
                   and (at_plan is None or now < at_plan))
    # A COLLECTION THAT CANNOT ASK IS NOT RUN AT ALL — not the books, not the judging.
    paused_now, why = psi_anywhere.paused()
    held = paused_now
    if not held and not _session_token():
        why = _relogin_rest(now)
        held = bool(why)
        if not held:
            ok, why = psi_anywhere.login_would_allow()
            held = not ok
    if held:
        if retry:
            # THE RETRY COULD NOT SIGN IN YET (the login clock's own ration): still down, and the next retry is a…
            psi_anywhere.mark_down(f"the health retry could not sign in yet — {why}")
            why = _clock_now(now)[1]
        state = "down" if retry else "paused" if paused_now else "held"
        if why != _CACHE["held_said"]:
            _CACHE["held_said"] = why
            log.info("psi attendance: a collection is due and nothing was sent — %s", why)
        moved = (str(_S["clock"].get("state") or ""), str(_S["clock"].get("why") or "")) != (state, why)
        if moved:
            _note_clock(state, why, now)
            _save()
        # DUE AND HELD — the ADM line refused, most often: the Ty slot's beat.
        return _quiet_beat({"state": "down" if retry else "held", "why": why,
                            "_board": moved or books_moved}, now)

    # DUE. The books again, right now: a call-off typed minutes ago counts.
    try:
        _refresh(dsn, now)
    except Exception as exc:  # noqa: BLE001
        log.warning("psi attendance: the books could not be re-read before the collection "
                    "(%s) — nobody named", type(exc).__name__)
        if retry:
            psi_anywhere.mark_down("the health retry waits for the roster and the books to read")
        return _quiet_beat({"state": "unknown", "why": "books unreadable", "_board": True}, now)
    today = now.astimezone(OHIO).date().isoformat()
    due = [s for s in _unjudged(now) if _mins(now, s["shift_at"]) >= LATE_AFTER_MIN]
    missing = _missing(now)
    follow_rows = _follow_up_rows(now)
    # Only once their read is due: a collection the plan makes at 23:20 is not the read that vouches for them at…
    morning_rows = _morning_rows(now) if at_morning is not None and now >= at_morning else []
    warned = [r for r in warn_rows if r.get("at") is not None and now >= r["at"]]
    if warned and not any(x is not None and now >= x for x in (at_plan, at_follow, at_morning)):
        log.info("psi attendance: a collection for %s live punch warning(s) — the directors are told "
                 "and a RECEIVED is opened only on a fresh read", len(warned))
    if not retry and not any(not _told(s) for s in due) and not follow_rows and not morning_rows \
            and not warned:
        # NOTHING HERE IS THE CLOCK'S TO ANSWER: every shift that is due was written about by a human, nobody a…
        found = judge(due, {}, _recent(now), _CACHE["offs"], _CACHE["loose"],
                      set(_S["judged"]), now)
        for sid in found["judged"]:
            _S["judged"][sid] = today
        _save()
        return _quiet_beat({"state": "nothing_for_the_clock", "_board": True}, now)

    looked_at = [s["shift_at"] for s in due] + [a for a in (_instant(r.get("shift_at"))
                                                           for r in missing + morning_rows)
                                               if a is not None] \
        + [r["shift_at"] for r in warned if isinstance(r.get("shift_at"), datetime)]
    # THE READ REACHES THE BOARD'S DAYS WHATEVER IS DUE (HISTORY_DAYS): an entry typed this evening for yesterday's…
    day_from = local.date() - timedelta(days=HISTORY_DAYS)
    if looked_at:
        oldest = min(looked_at) - timedelta(hours=OPEN_ENTRY_MAX_H)
        day_from = min(oldest.astimezone(OHIO).date(), day_from)
    got = _collect(day_from, local.date(), now)
    if got["sent"]:
        # SOMETHING LEFT THIS HOST: the next collection keeps its distance from it, and every shift it could not…
        _S["last_done"] = now.isoformat()
        if for_missing:
            _follow_up_spend(now, follow_rows)
    if got["state"] != "down" and (psi_anywhere.down_state() or retry):
        # THE RETRY'S OWN ANSWER.
        if got["state"] == "read" or got.get("login_answered"):
            psi_anywhere.mark_up("the first read after the outage landed" if got["state"] == "read"
                                 else f"the service answered the login ({got['why'][:120]})")
        else:
            psi_anywhere.mark_down(f"the health retry proved nothing — {got['why'][:160]}")
    if got["state"] != "read":
        state_now = got["state"]
        _note_clock(state_now, _clock_now(now)[1] if state_now == "down" else got["why"], now)
        if got["sent"] and state_now == "unknown":
            _backoff_bump(now, got["why"])
        _save()
        if got["sent"]:
            _CACHE["held_said"] = ""
            log.warning("psi attendance: %s — nobody named%s", got["why"],
                        {"refused": "; the next login on that account waits for its credential "
                                    "file to change or for a day to pass",
                         "down": "; the calendar takes over until a read lands, and the health "
                                 f"retry comes every {int(psi_anywhere.PSI_DOWN_RETRY_S / 60)} min"}
                        .get(state_now, "; the shifts stay open"))
        elif got["why"] != _CACHE["held_said"]:
            _CACHE["held_said"] = got["why"]
            log.info("psi attendance: a collection is due and nothing was sent — %s", got["why"])
        state = state_now if state_now in ("refused", "unknown", "down") else "held"
        out = {"state": state, "why": got["why"], "_board": True}
        # A COLLECTION THAT SENT NOTHING (no ADM credential, the login clock's own ration) left the wire free: the…
        return out if got["sent"] else _quiet_beat(out, now)
    rows, meta = got["rows"], got["meta"]
    _CACHE["held_said"] = ""
    # EVERY FIELD OF EVERY ENTRY, CLIENT DATA INCLUDED, INTO ITS OWN LOCKED JSON before anything else is done with…
    _keep_full(rows, now)
    index, rcounts = punch_index(rows)
    if not rcounts.get("read"):
        # NOBODY CLOCKED ANYTHING IN TWO DAYS is not a fact about a company that works around the clock; it is a…
        _note_clock("unknown", "no readable entries", now)
        _backoff_bump(now, "no readable entries")
        _save()
        log.warning("psi attendance: %s entr(y/ies) came back over %s–%s and none carries a name "
                    "and a start (%s) — nobody named; the shifts stay open", len(rows),
                    day_from, local.date(), dict(rcounts))
        return {"state": "unknown", "why": "no readable entries", "read": True, "_board": True}
    # A REAL READ.
    _S["read_at"] = now.isoformat()
    _S["backoff"] = {}
    _S["relogin_rest"] = {}
    _note_clock("read", f"{len(rows)} entr(y/ies) from {meta.get('supervisors')} supervisor "
                        f"queue(s){' after one more login' if meta.get('relogin') else ''}", now)
    try:
        import psi_entries  # noqa: PLC0415
        kept = psi_entries.upsert(rows, now)
        slim = [psi_entries.keep(r) for r in rows if isinstance(r, dict)]
    except Exception as exc:  # noqa: BLE001 — the read still judges; the history says why not
        kept = {"unwritten": 1}
        slim = [r for r in rows if isinstance(r, dict)]
        log.warning("psi attendance: the entries could not be kept (%s: %s)",
                    type(exc).__name__, str(exc)[:160])
    # THE BOARD'S HALF OF THIS READ: in memory whatever the history managed, and whether the history holds it — an…
    _LAST_READ.update(at=_S["read_at"], rows=slim, day_from=day_from)
    _S["history_ok"] = not kept.get("unwritten")
    if kept.get("unwritten"):
        log.warning("psi attendance: the entry history did not take this read — the board stands "
                    "on the read itself, and says 'clock not read' where it cannot vouch")
    for k in index:
        _S["seen"][k] = today
    if not _S.get("reading_since"):
        _S["reading_since"] = today
    found = judge(due, _read_index(rows, day_from, local.date()), _recent(now), _CACHE["offs"],
                  _CACHE["loose"], set(_S["judged"]), now)
    for sid in found["judged"]:
        _S["judged"][sid] = today
    # WHEN THE ROW WAS JUDGED AND WHEN ITS SHIFT ENDS, kept beside it (never sent: the door is handed no "_" key)…
    ends = {shift_id(s): s["shift_end"].astimezone(OHIO).isoformat() for s in due}
    judged_at = now.isoformat()
    _S["pending"].extend([dict(r, kind="late", _offers=0, _at=judged_at, _end=ends.get(r["_id"], ""))
                          for r in found["late"]]
                         + [dict(r, kind="no_call", _offers=0, _at=judged_at, _end=ends.get(r["_id"], ""))
                            for r in found["no_call"]])
    _save()
    sk = found["skipped"]
    log.info("psi attendance: collected %s entr(y/ies) over %s–%s from %s supervisor queue(s)%s "
             "— %s shift(s) closed: %s on the clock, %s late, %s no-call, %s told by a human, %s "
             "not seen by the clock lately%s, %s over with no entry typed yet (nobody named); %s "
             "with no punch yet stay open%s; %s still missing after an earlier check; history +%s "
             "new, %s changed; call-off books: %s",
             len(rows), day_from, local.date(), meta.get("supervisors"),
             " (the kept session was refused, one more login)" if meta.get("relogin") else "",
             len(found["judged"]), sk.get("on_the_clock", 0),
             len(found["late"]), len(found["no_call"]), sk.get("told_by_a_human", 0),
             sk.get("not_seen", 0),
             f" ({', '.join(found['not_seen'][:6])})" if found["not_seen"] else "",
             sk.get("not_entered_yet", 0),
             sk.get("no_punch_yet", 0),
             f"; {found['capped']} over the cap stay open" if found["capped"] else "",
             len(missing), kept.get("added", 0), kept.get("changed", 0),
             _CACHE["freshness"])
    # `_read_landed`: THE ONE RETURN OF A REAL READ on the session now kept — the only one that owes the pay-period
    # refresh.
    return {"state": "told", "late": len(found["late"]), "no_call": len(found["no_call"]),
            "read": True, "_board": True, "_read_landed": True}


def _keep_full(rows: list[dict], now: datetime) -> dict[str, int]:
    """Every field of what this read saw — the client's half included, as the full punch sheet requires — into…

    What record_live counted (added, changed, same), or {"unwritten": 1} when nothing could be kept."""
    try:
        import psi_punches_full  # noqa: PLC0415
        return dict(psi_punches_full.record_live(rows, now) or {})
    except Exception as exc:  # noqa: BLE001
        log.warning("psi attendance: the full entries could not be kept (%s: %s)",
                    type(exc).__name__, str(exc)[:160])
        return {"unwritten": 1}


# ── the pay-period refresh ─────────────────────────────────────────────────

def _period_windows(now: datetime) -> list[tuple[date, date]]:
    """(from, to) of each read the refresh makes: the previous PsiAnywhere pay period whole, then the current one up to
    today. Two reads, never one: one window of up to 28 days per queue is the request most likely to outlive
    PSI_TIMEOUT_S, and a period of 14 is a request the size PsiAnywhere's own Time Approval screen asks for."""
    import psi_periods  # noqa: PLC0415
    today = psi_periods.today_ny(now)
    start = psi_periods.period_start(today)
    return [(start - timedelta(days=psi_periods.PERIOD_DAYS), start - timedelta(days=1)), (start, today)]


def _period_refresh_kept() -> dict:
    """The refresh's record in the lane's state, always a dict."""
    got = _S.get("period_refresh")
    if not isinstance(got, dict):
        got = {}
        _S["period_refresh"] = got
    return got


def _period_refresh_tries(got: dict, day: str) -> int:
    """The tries the record says were spent on `day` (0 on any other day). A count that cannot be read — a state file
    edited by hand or garbled — counts as every try spent: it buys no read, and the next New York day starts over."""
    if str(got.get("day") or "") != day:
        return 0
    try:
        return max(0, int(got.get("tries") or 0))
    except (TypeError, ValueError, OverflowError):
        return max(PERIOD_REFRESH_TRIES, 0)


def _period_refresh_due(now: datetime) -> bool:
    """Is the day's refresh owed now: switched on (PERIOD_REFRESH_TRIES above 0), past PERIOD_REFRESH_AFTER_H in New
    York, not read whole yet today, fewer than PERIOD_REFRESH_TRIES tries spent today, and the last of them at least
    PERIOD_REFRESH_RETRY_S ago."""
    if PERIOD_REFRESH_TRIES <= 0:
        return False
    local = now.astimezone(OHIO)
    if local.hour < PERIOD_REFRESH_AFTER_H:
        return False
    got = _period_refresh_kept()
    day = local.date().isoformat()
    if str(got.get("day") or "") != day:
        return True
    if got.get("ok") or _period_refresh_tries(got, day) >= PERIOD_REFRESH_TRIES:
        return False
    last = _instant(got.get("at"))
    return last is None or (now - last).total_seconds() >= PERIOD_REFRESH_RETRY_S


def _period_refresh_mark(now: datetime) -> dict[str, str]:
    """What makes a read and its session the ones a refresh is owed on: the New York day, the read's instant, the
    last time anything was sent, and the kept session's own instant and account (never its token)."""
    session = _S.get("session") or {}
    return {"day": now.astimezone(OHIO).date().isoformat(), "read_at": str(_S.get("read_at") or ""),
            "done_at": str(_S.get("last_done") or ""), "session_at": str(session.get("obtained_at") or ""),
            "account": str(session.get("account") or "adm")}


def _period_refresh_owe(now: datetime) -> None:
    """A COLLECTION READ: the refresh, if the day still owes it, is owed on this read and this session — and paid by
    the next beat that makes no collection (`_period_refresh`), once the app's beat has delivered this read's verdicts.
    A read that does not owe it lets go of any older mark."""
    got = _period_refresh_kept()
    had = got.pop("owed", None) is not None
    if _period_refresh_due(now):
        got["owed"] = _period_refresh_mark(now)
    if had or "owed" in got:
        _save()


def _period_refresh_owed_here(owed: Any, now: datetime) -> bool:
    """Is the read the refresh was owed on still the lane's last word, the same New York day, with nothing sent to
    PsiAnywhere since and the session it read with still the one kept?"""
    if not isinstance(owed, dict) or not owed.get("read_at"):
        return False
    here = _period_refresh_mark(now)
    return all(str(owed.get(k) or "") == here[k] for k in here)


def _period_refresh(now: datetime) -> dict | None:
    """THE DAY'S RE-READ OF THE CURRENT AND THE PREVIOUS PAY PERIOD, made on the first beat after a collection read
    that makes no collection of its own (`_tick`), on the session that read, with the collection's own `entries` — and
    its rows go to the full punches (`_keep_full`) and nowhere else: never the judgement, the entry history, the
    board, the seen list or the reminders, which stand on the collection's HISTORY_DAYS alone. What it did, or None
    when it was not owed or skipped.

    The mark a read left (`_period_refresh_owe`) is spent by the first such beat whatever happens, and honoured only
    while that read is still the lane's last, nothing has been sent since, the kept session is still the one it read
    with and the New York day is the same: anything else waits for the next read to owe it again.

    It can never cost the lane its session: it signs in to nothing, a failure neither drops nor refuses the kept
    session nor touches the backoff, the relogin rest, DOWN or the clock's state the board reads (the next collection
    finds out about a dead session its own way), and it says one line. A PsiPaused (DOWN) skips it quietly with no try
    spent. The outcome is kept in the lane's state, so a restart does not repeat a refresh that read."""
    kept = _period_refresh_kept()
    if "owed" not in kept:
        return None
    owed = kept.pop("owed")
    _save()
    if not _period_refresh_owed_here(owed, now) or not _period_refresh_due(now):
        return None
    # THE SESSION AS KEPT, never through _session_token() (which drops it): a refresh with no session waits for a
    # collection that has one rather than sign in, and one the lane would no longer read with (the account refused a
    # login since, or the lane switched lines) is left for the next collection to let go — the refresh only skips.
    session = _S.get("session") or {}
    token = str(session.get("token") or "")
    if not token:
        return None
    import psi_anywhere  # noqa: PLC0415
    if psi_anywhere.login_snapshot().get("refused") \
            or str(session.get("account") or "adm") != psi_anywhere.active_account():
        return None
    today = now.astimezone(OHIO).date().isoformat()
    tries = _period_refresh_tries(kept, today) + 1
    deadline = time.monotonic() + PERIOD_REFRESH_BUDGET_S
    counts: Counter = Counter()
    read: list[str] = []
    why = ""
    for day_from, day_to in _period_windows(now):
        if time.monotonic() >= deadline:
            # THE BUDGET IS CHECKED BEFORE EACH PERIOD TOO: past it not even the period's supervisor list is asked.
            why = (f"{day_from}–{day_to}: the refresh's budget of {PERIOD_REFRESH_BUDGET_S:g} s was spent before "
                   f"this period was asked")
            break
        try:
            rows, _meta = entries(token, day_from, day_to, deadline=deadline)
        except PsiPaused:
            # PSIANYWHERE IS DOWN (the collection path says so on its own): nothing more is sent, nothing is said and
            # the try is not spent — the first collection that reads after it owes the refresh again.
            return None
        except Exception as exc:  # noqa: BLE001 — a refresh that could not read is said, and tried later
            why = f"{day_from}–{day_to}: {type(exc).__name__}: {str(exc)[:160]}"
            break
        # EACH PERIOD KEPT AS IT LANDS: a second period that fails does not cost the first.
        got = _keep_full(rows, now)
        if got.get("unwritten"):
            why = f"{day_from}–{day_to}: {len(rows)} entr(y/ies) read and not kept in the full punches"
            break
        counts["rows"] += len(rows)
        for k in ("added", "changed", "same"):
            counts[k] += int(got.get(k) or 0)
        read.append(f"{day_from.isoformat()}..{day_to.isoformat()}")
    said = {"day": today, "tries": tries, "at": now.isoformat(), "ok": not why, "periods": read,
            "rows": counts["rows"], "added": counts["added"], "changed": counts["changed"],
            "same": counts["same"], "why": why[:300]}
    _S["period_refresh"] = said
    _save()
    if not why:
        log.info("psi attendance: the pay periods re-read on the kept session (%s) — %s entr(y/ies): %s new and %s "
                 "changed in the full punches", ", ".join(read), counts["rows"], counts["added"], counts["changed"])
    else:
        again = (now + timedelta(seconds=PERIOD_REFRESH_RETRY_S)).astimezone(OHIO)
        log.warning("psi attendance: the pay-period refresh could not read (try %s of %s today) — %s; %s%s", tries,
                    PERIOD_REFRESH_TRIES, why, f"{len(read)} period(s) kept before it; " if read else "",
                    f"the first quiet beat after a collection that reads from {again:%H:%M} on tries it again"
                    if tries < PERIOD_REFRESH_TRIES else "not again today")
    return said


# The longest the clients-present pass waits for the lane's lock before it gives this beat up: a collection holds…
CONSUMERS_LANE_WAIT_S = 2.0


def fill_consumers(now: datetime | None = None) -> dict:
    """THE CLIENTS PRESENT, ASKED ON THE SESSION THE LAST COLLECTION READ WITH."""
    now = (now or datetime.now(UTC)).astimezone(UTC)
    why = held_here()
    if why:
        return {"asked": 0, "why": why}
    try:
        import psi_consumers  # noqa: PLC0415
        if not _LOCK.acquire(timeout=CONSUMERS_LANE_WAIT_S):
            return {"asked": 0, "why": "the lane is busy — nothing asked"}
        try:
            _load()
            read_at = _read_at()
            obtained = _instant((_S.get("session") or {}).get("obtained_at"))
            token = _session_token()
        finally:
            _LOCK.release()
        if not token:
            return {"asked": 0, "why": "no kept session — nothing asked"}
        if read_at is None or (now - read_at).total_seconds() > psi_consumers.FRESH_S:
            return {"asked": 0, "why": "the kept session has not read lately — nothing asked"}
        if obtained is not None and obtained > read_at:
            return {"asked": 0, "why": "the kept session has not read yet — nothing asked"}
        return psi_consumers.fill(token, read_at.isoformat(), now)
    except Exception as exc:  # noqa: BLE001 — the clients' names are a record, the lane goes on
        log.warning("psi attendance: the clients present could not be asked (%s: %s)",
                    type(exc).__name__, str(exc)[:160])
        return {"asked": 0, "why": f"{type(exc).__name__}"}


# ── the Ty account's two tries a day ───────────────────────────────────────

def ty_slots(day: date) -> list[tuple[str, datetime]]:
    """(key, instant) of each Ty slot on a New York day."""
    out = []
    for raw in TY_SLOTS:
        m = re.match(r"^\s*(\d{1,2}):(\d{2})\s*$", raw)
        if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
            continue
        at_ = _ohio(day, int(m.group(1)) * 60 + int(m.group(2)))
        out.append((f"{day.isoformat()} {int(m.group(1)):02d}:{m.group(2)}", at_))
    return out


def _ty_done() -> dict[str, str]:
    """The slots already spent, slot key → what happened, the last few days."""
    got = _S.get("ty_slots")
    return dict(got) if isinstance(got, dict) else {}


def _ty_spend(key: str, answer: str, now: datetime) -> None:
    cut = (now.astimezone(OHIO).date() - timedelta(days=3)).isoformat()
    done = {k: v for k, v in _ty_done().items() if k >= cut}
    done[key] = str(answer or "")[:160]
    _S["ty_slots"] = done
    _save()


def _ty_slot_due(now: datetime) -> str:
    """The key of the Ty slot this beat may try, or ''."""
    done = _ty_done()
    today = now.astimezone(OHIO).date()
    for key, at_ in ty_slots(today):
        if at_ <= now < at_ + timedelta(minutes=TY_SLOT_WINDOW_MIN) and key not in done:
            return key
    return ""


def _ty_next(now: datetime) -> str:
    """The next Ty slot not spent, as an Ohio instant, or ''."""
    done = _ty_done()
    today = now.astimezone(OHIO).date()
    for day in (today, today + timedelta(days=1)):
        for key, at_ in ty_slots(day):
            if key not in done and now < at_ + timedelta(minutes=TY_SLOT_WINDOW_MIN):
                return at_.astimezone(OHIO).isoformat()
    return ""


def _ty_maybe(now: datetime) -> dict | None:
    """THE TWICE-DAILY TRY: the lane keeps using the line it has (ADM) and, twice a day, as a setup in the…"""
    try:
        import psi_anywhere  # noqa: PLC0415
        if not psi_anywhere.credential_present("ty") or psi_anywhere.active_account() == "ty" \
                or psi_anywhere.down_state():
            return None
        done = _ty_done()
        today = now.astimezone(OHIO).date()
        for key, at_ in ty_slots(today):
            # A slot whose window closed without a try is let go, saying why.
            if key not in done and now >= at_ + timedelta(minutes=TY_SLOT_WINDOW_MIN):
                _ty_spend(key, "not tried: " + (_CACHE.get("ty_held") or "the window closed"), now)
        key = _ty_slot_due(now)
        if not key:
            return None
        ok, why = psi_anywhere.login_would_allow(account="ty", purpose="ty_try")
        if not ok:
            if why != _CACHE.get("ty_held"):
                _CACHE["ty_held"] = why
                log.info("psi attendance: the Ty try of %s waits — %s", key, why)
            return None
        signed = _sign_in(account="ty", purpose="ty_try")
        if not signed["sent"]:
            _CACHE["ty_held"] = signed["why"]
            return None
        _CACHE["ty_held"] = ""
        if signed["token"]:
            try:
                _supervisors(signed["token"])
                unproved = ""
            except Exception as exc:  # noqa: BLE001 — any failure is "not proved"
                unproved = f"{type(exc).__name__}: {str(exc)[:120]}"
            if unproved:
                answer = "Token, but its session could not read"
                psi_anywhere.ty_note(f"{answer} ({unproved[:100]})")
                _ty_spend(key, f"{answer} ({unproved[:80]}) — the lane stays on ADM", now)
                log.warning("psi attendance: the Ty try of %s signed in, but the session could not "
                            "read (%s) — the lane stays on ADM, its session untouched; the next slot "
                            "tries again", key, unproved[:160])
                return {"slot": key, "answer": answer, "active": psi_anywhere.active_account()}
            psi_anywhere.set_active("ty", f"the Ty try of {key} signed in and read")
            _keep_session(signed["token"], now, "ty")
            _ty_spend(key, "Token, and its session read — the lane signs in as Ty", now)
            log.warning("psi attendance: the Ty try of %s signed in and its session read — the lane "
                        "reads as Ty from the next collection on; ADM stays the fallback", key)
            return {"slot": key, "answer": "Token", "active": "ty"}
        answer = signed["word"] or signed["fault"] or "no answer"
        _ty_spend(key, f"{answer} — the lane stays on ADM", now)
        log.warning("psi attendance: the Ty try of %s did not sign in (%s) — the lane stays on "
                    "ADM; the next slot tries again", key, signed["why"][:160])
        return {"slot": key, "answer": answer, "active": "adm"}
    except Exception as exc:  # noqa: BLE001 — a try that failed to run is a log line
        log.warning("psi attendance: the Ty try could not run (%s: %s)", type(exc).__name__,
                    str(exc)[:160])
        return None


def _still_owed(r: dict) -> bool:
    """A row is re-checked against the call-off books before every offer: a call-off typed while the door was…"""
    try:
        s = {"keys": person_keys(r.get("person")), "name": r.get("person"),
             "shift_date": date.fromisoformat(r["day"])}
    except (KeyError, ValueError):
        return False
    return not _told(s)


def _since_on_the_clock(r: dict) -> bool:
    """A no-call whose shift the board has since found on the clock ON TIME: the entry was typed after the read…"""
    if r.get("kind") != "no_call":
        return False
    return any(b.get("id") == r.get("_id") and b.get("verdict") == "punched_on_time"
               for b in _BOARD.get("rows") or [])


def _night_read_due(r: dict, now: datetime) -> datetime | None:
    """For a row the quiet window held — a window began after it was judged and before now — the instant that…"""
    import psi_reminders  # noqa: PLC0415
    since = _instant(r.get("_at")) or _instant(r.get("shift_at"))
    if since is None:
        return None
    began = psi_reminders.quiet_begins(since)
    if began > now:
        return None
    return psi_reminders.quiet_ends(began)


def _morning_rows(now: datetime) -> list[dict]:
    """The waiting NO-CALLS the quiet window held that no read since has vouched for."""
    read = _read_at()
    out = []
    for r in _S.get("pending") or []:
        if r.get("kind") != "no_call":
            continue
        due = _night_read_due(r, now)
        if due is not None and (read is None or read < due):
            out.append(r)
    return out


def _morning_read_at(now: datetime) -> datetime | None:
    """When the read those rows wait for is due: the end of the window that held them (never inside it)."""
    dues = [d for d in (_night_read_due(r, now) for r in _morning_rows(now)) if d is not None]
    return min(dues) if dues else None


def _recheck(rows: list[dict], now: datetime) -> tuple[list[dict], list[dict], list[dict]]:
    """(the rows to offer, the no-calls a punch has since answered, the no-calls that became late rows) — every…"""
    if not any(r.get("kind") == "no_call" for r in rows):
        return rows, [], []
    index, _history, _absence_from = _board_index(now)
    keep: list[dict] = []
    answered: list[dict] = []
    turned: list[dict] = []
    for r in rows:
        at = _instant(r.get("shift_at")) if r.get("kind") == "no_call" else None
        if at is None:
            keep.append(r)
            continue
        end = _instant(r.get("_end")) or at + timedelta(hours=OPEN_ENTRY_MAX_H)
        spans = [sp for k in person_keys(r.get("person")) for sp in index.get(k, ())]
        came = arrival(at, end, spans, now)
        if came is None:
            keep.append(r)
            continue
        mins = _mins(came, at)
        if mins < LATE_AFTER_MIN:
            answered.append(r)
            continue
        hhmm = came.astimezone(OHIO).strftime("%H:%M")
        late = dict(r, kind="late", minutes_late=int(mins), arrived=hhmm,
                    report=(f"The time clock has them clocked in at {hhmm}, {int(mins)} minutes "
                            "after the shift began."))
        turned.append(late)
        keep.append(late)
    return keep, answered, turned


def pending(now_ts: float) -> dict | None:
    """The rows waiting for the door, when it is time to offer them: at most MAX_PER_PASS, none stale, none a…"""
    import psi_reminders  # noqa: PLC0415
    if held_here():
        return None
    with _LOCK:
        _load()
        if not _S["pending"] or now_ts < float(_S["post_after"] or 0.0):
            return None
        now = datetime.fromtimestamp(now_ts, UTC)
        if psi_reminders.quiet(now):
            return None
        gone = _prune(now)
        told = [r for r in _S["pending"] if not _still_owed(r) or _since_on_the_clock(r)]
        if told:
            _S["pending"] = [r for r in _S["pending"] if r not in told]
        if gone or told:
            _save()
            log.info("psi attendance: %s stale and %s since told by a human or found on the "
                     "clock — let go before the door (%s)", len(gone), len(told),
                     ", ".join(r.get("person", "?") for r in (gone + told)[:6]))
        waiting = {id(r) for r in _morning_rows(now)}
        ready = [r for r in _S["pending"] if id(r) not in waiting]
        checked, answered, turned = _recheck(ready, now)
        if answered or turned:
            mine = {r["_id"]: r for r in checked}
            _S["pending"] = [mine.get(r["_id"], r) for r in _S["pending"]
                             if id(r) in waiting or r["_id"] in mine]
            _save()
            log.info("psi attendance: %s no-call row(s) the clock has since answered were let go and "
                     "%s became late rows before the door (%s)", len(answered), len(turned),
                     ", ".join(r.get("person", "?") for r in (answered + turned)[:6]))
        offer = checked[:MAX_PER_PASS]
        if not offer:
            return None
        clean = [{k: v for k, v in r.items() if not k.startswith("_") and k != "kind"}
                 for r in offer]
        return {"late": [c for c, r in zip(clean, offer) if r["kind"] == "late"],
                "no_call": [c for c, r in zip(clean, offer) if r["kind"] == "no_call"],
                "ids": [r["_id"] for r in offer]}


def posted(ids: list[str], said: dict, now_ts: float) -> None:
    """The door took the offer."""
    import psi_reminders  # noqa: PLC0415
    with _LOCK:
        quiet_n = int(said.get("quiet") or 0)
        if (quiet_n > 0 and not int(said.get("told") or 0) and not int(said.get("skipped") or 0)
                and int(said.get("held") or 0) <= quiet_n):
            now = datetime.fromtimestamp(now_ts, UTC)
            _S["post_after"] = max(now_ts, psi_reminders.quiet_ends(now).timestamp())
            _save()
            log.info("psi attendance: %s row(s) held by the send door's quiet window — kept for 08:00",
                     len(ids))
            return
        mine = set(ids)
        held_all = int(said.get("held") or 0) > 0 and not int(said.get("told") or 0) \
            and not int(said.get("skipped") or 0)
        keep, dropped = [], []
        for r in _S["pending"]:
            if r["_id"] not in mine:
                keep.append(r)
            elif held_all and int(r.get("_offers") or 0) + 1 < HELD_OFFERS:
                keep.append(dict(r, _offers=int(r.get("_offers") or 0) + 1))
            elif held_all:
                dropped.append(r)
        _S["pending"] = keep
        _S["post_after"] = now_ts + HELD_RETRY_S if held_all and any(
            r["_id"] in mine for r in keep) else 0.0
        _save()
        if dropped:
            log.info("psi attendance: %s row(s) held by the door twice — let go (%s)",
                     len(dropped), ", ".join(r.get("person", "?") for r in dropped[:6]))


def post_failed(now_ts: float) -> None:
    with _LOCK:
        _S["post_after"] = now_ts + POST_RETRY_S
        _save()
