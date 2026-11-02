"""The call-off form crossed into the call-off lane on Python (CommCallOffForm.gs callOffFormSweep_, the hiring sweep's
callOffFormSweepMaybe_): the clone house (cloneCallOffs, the lane mirror's daily copy of the estate's call-off form)
read off asa-hub-db's copy, each call-off of the last three days that the call-off house does not already hold for
that person and day answered by the lane (commCallOffRecorded_), five a turn at most; each late show and no-show
handed to the attendance door (staffAttendancePunch) once the ledger says nobody told it yet. Same person and same
day is one absence, whichever door reported it first. The look (callOffFormDue) plans; app/call_off_form_sweep_writes.py
answers the call-offs and hands the attendance rows to the relay, which presses the door."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import clock_sweeps as CS
import gsjs
import hubdb
import locations as L
import smart_clock as SK
import smart_comms_desk as SCD
import staff_alerts as SA
from gsjs import NY

APP_ID = "call-off-form-sweep"
# CALLOFF_FORM_TAB, CALLOFF_FORM_EVERY_S, CALLOFF_FORM_BACK_DAYS, CALLOFF_FORM_MAX_PER_PASS
FORM_TAB = "cloneCallOffs"
EVERY_S = 600
BACK_DAYS = 3
MAX_PER_PASS = 5
THROTTLE_KEY = "calloff_form_ran"
SOURCE = "form"
LOG_BY = "asa-hub:calloffform"
TYPE_CELLS = ("type", "calloff_type", "kind")
NAME_CELLS = ("employeename", "employee_name", "employee", "name")
DAY_CELLS = ("date", "shift_date", "absent_on")
STAMP_CELLS = ("timestamp", "createdat", "created_at")
NOTES_CELLS = ("notesincludereasonandhowmuchadvancednotice", "notes", "reason")
LATE_CELLS = ("howlate", "how_late")
NO_REPORT = "Reported on the call-off form; no further words were typed."
_MONTHS = {m: i + 1 for i, m in enumerate(("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov",
                                           "Dec"))}
# String(date): "Thu Oct 22 2026 14:03:11 GMT-0400 (Eastern Daylight Time)"
_JS_DATE = re.compile(r"^(?:[A-Z][a-z]{2} )?([A-Z][a-z]{2}) (\d{1,2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) "
                      r"GMT([+-])(\d{2})(\d{2})")

s_ = gsjs.str_


def kind_of(word: Any) -> str:
    """callOffFormKind_: underscores fold to spaces so the house's `late_show` matches the form's words."""
    w = gsjs.trim(gsjs.or_text(word)).lower().replace("_", " ")
    if not w:
        return ""
    if "call off" in w or "call-off" in w:
        return "call_off"
    if "late" in w:
        return "late_show"
    if "no show" in w or "no call" in w or "ncns" in w:
        return "no_call"
    return "other"


def cell(row: dict, names: tuple[str, ...]) -> str:
    """callOffFormCell_: the first of `names` the row holds something under, String()'d and trimmed."""
    for n in names:
        if n in row:
            v = gsjs.trim(gsjs.js_str(row[n]))
            if v:
                return v
    return ""


def date_ms(raw: str) -> float | None:
    """Date.parse for the text a form cell hands back: String() of a Date cell, or the shapes typed text takes."""
    m = _JS_DATE.match(raw)
    if m:
        off = timedelta(hours=int(m.group(8)), minutes=int(m.group(9)))
        try:
            at = datetime(int(m.group(3)), _MONTHS[m.group(1)], int(m.group(2)), int(m.group(4)), int(m.group(5)),
                          int(m.group(6)), tzinfo=timezone(off if m.group(7) == "+" else -off))
        except (KeyError, ValueError):
            return None
        return at.timestamp() * 1000.0
    return gsjs.date_parse(raw)


def day_of(value: Any) -> str:
    """callOffFormDay_: an ISO day kept as it is (Date.parse reads it as UTC midnight, the evening before in Ohio),
    else the day it parses to on Ohio's clock."""
    raw = gsjs.trim(gsjs.or_text(value))
    if not raw:
        return ""
    iso = re.match(r"^(\d{4}-\d{2}-\d{2})(?:[T ]|$)", raw)
    if iso:
        return iso.group(1)
    t = date_ms(raw)
    if t is not None:
        return datetime.fromtimestamp(t / 1000.0, timezone.utc).astimezone(NY).strftime("%Y-%m-%d")
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", raw)
    return m.group(0) if m else ""


def noon_ms(day: str) -> float | None:
    """Date.parse(day + 'T12:00:00'): noon on the script's clock."""
    return gsjs.date_parse(day + "T12:00:00")


def untold(rows: list[dict], sid: str, told: set[str] | None) -> list[dict]:
    """callOffFormUntold_: the rows no ledger line names yet; an unreadable ledger hands nothing over."""
    if told is None:
        return []
    out = []
    for r in rows:
        day = gsjs.or_text(r.get("day"))
        names = [gsjs.or_text(r.get("person")), gsjs.name_key(r.get("person"))]
        if not any(n and SK.ledger_key(sid, n, day) in told for n in names):
            out.append(r)
    return out


def known_keys(reads: L.Reads) -> set[str]:
    """Each person and day the call-off house already holds an absence for (commCallOffRows_; a late show is not an
    absence and must not swallow a real call-off that day)."""
    try:
        house = SCD.call_off_rows(reads)
    except hubdb.Unreadable:
        raise
    except Exception:  # noqa: BLE001 - commCallOffRows_'s catch: a first pass has nothing to remember
        house = {}
    known: set[str] = set()
    for r in house.values():
        if kind_of(r.get("kind")) == "late_show":
            continue
        k = gsjs.trim(gsjs.or_text(r.get("person_key"))).lower()
        d = day_of(r.get("shift_date"))
        if k and d:
            known.add(k + "|" + d)
    return known


def plan(reads: L.Reads) -> dict[str, Any]:
    """callOffFormSweep_ up to the lane: every row of the clone house read, the call-offs it would answer in the form's
    order (each with its key and instance), the rows only listed, and the attendance rows the ledger has not seen."""
    out: dict[str, Any] = {"rows": 0, "acted": 0, "duplicates": 0, "listed": {}, "old": 0, "capped": 0, "unnamed": 0,
                           "why": []}
    try:
        rows = SCD.board_rows(reads, FORM_TAB)
    except hubdb.Unreadable:
        raise
    except Exception as e:  # noqa: BLE001 - the clone house's own sentence
        out["why"].append("the clone house could not be read: " + (str(e) or type(e).__name__))
        return {"out": out, "stop": True}
    out["rows"] = len(rows)
    if not rows:
        return {"out": out, "stop": True}
    floor_ms = reads.now.timestamp() * 1000.0 - BACK_DAYS * 86400000
    attendance: dict[str, list[dict]] = {"late": [], "no_call": []}
    calls: list[dict] = []
    for r in rows:
        kind = kind_of(cell(r, TYPE_CELLS))
        if not kind:
            continue
        if kind != "call_off":
            out["listed"][kind] = out["listed"].get(kind, 0) + 1
            # The ledger key (person, day, kind) keeps mailbox, punch clock and form from telling it three times.
            if kind in ("late_show", "no_call"):
                who = cell(r, NAME_CELLS)
                when = day_of(cell(r, DAY_CELLS))
                when_ms = noon_ms(when) if when else None
                if who and when and not (when_ms is not None and when_ms < floor_ms):
                    attendance["no_call" if kind == "no_call" else "late"].append({
                        "person": who, "day": when, "shift_at": when, "house": "", "shift_code": "",
                        "when": cell(r, LATE_CELLS) or ("no call, no show" if kind == "no_call" else "late"),
                        # Without a report the letter would claim nobody reported the absence.
                        "report": cell(r, NOTES_CELLS) or NO_REPORT, "source": SOURCE})
            continue
        person = cell(r, NAME_CELLS)
        if not person:
            out["unnamed"] += 1
            continue
        day = day_of(cell(r, DAY_CELLS))
        stamp = cell(r, STAMP_CELLS)
        if not day:
            out["unnamed"] += 1
            continue
        day_ms = noon_ms(day)
        if day_ms is not None and day_ms < floor_ms:
            out["old"] += 1
            continue
        notes = cell(r, NOTES_CELLS)
        # Keyed on the form's own row so a re-mirror never fires twice.
        calls.append({"person": person, "day": day, "notes": notes, "key": gsjs.name_key(person) + "|" + day,
                      "instance": "form:" + (stamp or day) + ":" + person[:24]})
    att: dict[str, Any] | None = None
    if attendance["late"] or attendance["no_call"]:
        # Ask the ledger before cutting the handful, or the same oldest rows are handed over forever.
        told = SA.ledger_keys(reads)
        att = {"late": untold(attendance["late"], "staff_late_show", told)[:MAX_PER_PASS],
               "no_call": untold(attendance["no_call"], "staff_no_call", told)[:MAX_PER_PASS],
               "why": "" if told is not None else ("the ledger could not be read — no late/no-show row was handed "
                                                   "over; they wait in the clone house for the next pass")}
    return {"out": out, "plans": calls, "attendance": att}


def form_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """callOffFormDue: the relay's look before callOffFormSweep — nothing while the sweep's key holds, else the plan."""
    if not CS.service(sess):
        return dict(CS.DENIED)
    reads = sess.reads
    if CS.held(reads, THROTTLE_KEY):
        return {"status": 200, "data": {"due": False, "skipped": "checked recently"}}
    return {"status": 200, "data": {"due": True, **plan(reads)}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"callOffFormDue": form_due}
POLICY: dict[str, dict[str, Any]] = {"callOffFormDue": {}}
