"""THE TIME OFF'S SIDE PANEL (the operator's layout, 10-30): what it shows past the request's own facts, whatever
the request's status — approved, and waiting where its approvers decide it (the same panel on both sides).

- **Impacted shifts**: the person's timed shifts on Scheduling's own calendars whose hours overlap the days off, from
  the first day's midnight to the midnight after the last, so an overnight that starts on the eve counts. A shift
  still theirs is read off its cell; one the approval gave up (its cell now R/O on the flow) off the call-off it
  started, which keeps its hours.
- **Approved time off in the year**: the calendar days of the request's year the person is on approved time off, each
  day once, from Scheduling's approved asks and the Time Off app's scheduled requests (an ask carried over from the
  Time Off app counts as that one request).

Who may press Edit is each record's own rule (time_off.may_edit, scheduling.asks_cut's approvers); nothing here
decides access. A read that fails is said (`*_why`), never drawn as none."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import gsjs
import hubdb
import locations as L
import scheduling as SCH
import time_off

DAY_MIN = 1440
GIVEN_UP = "given_up"
# Scheduling's asks that hold their days
HOLDING_ASKS = ("approved", "approved_future")


def _s(v: Any) -> str:
    return gsjs.trim(gsjs.or_blank(v))


def _day(iso: Any) -> date | None:
    i = SCH.day_index(iso)
    return None if i is None else date.fromordinal(i + SCH._EPOCH_ORD)


def _minutes(v: Any) -> int | None:
    n = SCH.js_num(v)
    return None if n is None or _s(v) == "" else int(n)


def _shift(reads: L.Reads, c: dict, start: Any, end: Any, text: Any, state: str) -> dict | None:
    a, b = _minutes(start), _minutes(end)
    if a is None or b is None or b <= a:
        return None
    return {"date": _s(c.get("date")), "house_code": _s(c.get("house_code")),
            "location": SCH.house_label(reads, c.get("house_code")), "start_min": a, "end_min": b,
            "text": _s(text), "state": state}


def _overlaps(s: dict, first: date, last: date) -> bool:
    """Half-open, in minutes from the first day's midnight: ending at midnight is a handover, not an overlap."""
    d = _day(s["date"])
    if d is None:
        return False
    at = (d - first).days * DAY_MIN
    return at + s["start_min"] < ((last - first).days + 1) * DAY_MIN and at + s["end_min"] > 0


def impacted(reads: L.Reads, person_key: str, first: Any, last: Any, flow_id: str = "") -> list[dict]:
    """The person's timed Scheduling shifts overlapping [first 00:00, last + 1 00:00), each once, in time order."""
    a, b = _day(first), _day(last)
    key = _s(person_key)
    if a is None or b is None or b < a or not key:
        return []
    row_id = "P:" + key
    lo, hi = (a - timedelta(days=1)).isoformat(), b.isoformat()
    out: list[dict] = []
    for c in SCH.read_tab(reads, SCH.TABS["cells"]):
        if _s(c.get("row_id")) != row_id or not lo <= _s(c.get("date")) <= hi or not SCH.flow_holds(c):
            continue
        got = _shift(reads, c, c.get("start_min"), c.get("end_min"), c.get("text"), _s(c.get("state")) or "scheduled")
        if got and _overlaps(got, a, b):
            out.append(got)
    if flow_id:
        for f in SCH.read_tab(reads, SCH.TABS["flows"]):
            if _s(f.get("kind")) != "call_off" or _s(f.get("source_ref")) != flow_id or _s(f.get("row_id")) != row_id:
                continue
            got = _shift(reads, f, f.get("start_min"), f.get("end_min"), f.get("shift_text"), GIVEN_UP)
            if got and _overlaps(got, a, b):
                out.append(got)
    seen: set[tuple[str, str, int]] = set()
    once = []
    for s in sorted(out, key=lambda s: (s["date"], s["start_min"], s["location"], s["state"] == GIVEN_UP)):
        k = (s["house_code"], s["date"], s["start_min"])
        if k not in seen:
            seen.add(k)
            once.append(s)
    return once


def _spans(reads: L.Reads, person: str, person_key: str) -> list[tuple[date, date]]:
    """Every approved span of the person: Scheduling's asks, then the Time Off app's requests not carried into them."""
    key = _s(person_key)
    spans: list[tuple[date, date]] = []
    carried: set[str] = set()
    for f in SCH.read_tab(reads, SCH.TABS["flows"]):
        if _s(f.get("kind")) != "time_off" or _s(f.get("person_key")) != key:
            continue
        if _s(f.get("source")) == SCH.TO_SOURCE and _s(f.get("source_ref")):
            carried.add(_s(f.get("source_ref")))
        if _s(f.get("state")) not in HOLDING_ASKS:
            continue
        a = _day(f.get("date"))
        b = _day(f.get("date_to")) or a
        if a is not None and b is not None and b >= a:
            spans.append((a, b))
    for r in time_off.rows(time_off.KEPT_DSN):
        if r.get("status") != time_off.SCHEDULED or _s(r.get("id")) in carried:
            continue
        if SCH.name_fold(r.get("person")) != key and not time_off.same_person(r.get("person"), person):
            continue
        a, b = time_off.day_of(r.get("start_date")), time_off.day_of(r.get("end_date"))
        if a is not None and b is not None and b >= a:
            spans.append((a, b))
    return spans


def year_days(reads: L.Reads, person: str, person_key: str, year: int) -> int:
    """The days of `year` the person is on approved time off, each day once."""
    lo, hi = date(year, 1, 1), date(year, 12, 31)
    days: set[date] = set()
    for a, b in _spans(reads, person, person_key):
        x, y = max(a, lo), min(b, hi)
        while x <= y:
            days.add(x)
            x += timedelta(days=1)
    return len(days)


def facts(reads: L.Reads, *, person: str, person_key: str, first: Any, last: Any, flow_id: str = "") -> dict[str, Any]:
    """{year, year_days, year_why, shifts, shifts_why} for one approved request; a part that cannot be read is None
    with its sentence."""
    a = _day(first)
    out: dict[str, Any] = {"year": a.year if a else None, "year_days": None, "year_why": "", "shifts": None,
                           "shifts_why": ""}
    key = _s(person_key) or SCH.name_fold(person)
    if not key or a is None:
        why = "the request carries no person or no first day"
        return {**out, "year_why": why, "shifts_why": why}
    try:
        out["shifts"] = impacted(reads, key, first, last, flow_id)
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said, never drawn as no shift
        out["shifts_why"] = f"the Scheduling calendars could not be read ({type(exc).__name__})"
    try:
        out["year_days"] = year_days(reads, person, key, a.year)
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said, never drawn as 0
        out["year_why"] = f"the approved time off could not be read ({type(exc).__name__})"
    return out


def of_detail(detail: dict[str, Any]) -> dict[str, Any]:
    """The Time Off app's request (time_off.detail), read against Scheduling on the app's own reader."""
    reads = L.Reads(hubdb.shared(), None)
    return facts(reads, person=_s(detail.get("person")), person_key="", first=detail.get("start"),
                 last=detail.get("end"))
