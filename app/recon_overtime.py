"""Overtime: each person's worked hours per Sunday-to-Saturday week, read from PsiAnywhere's record (app/recon_psi.py),
against 40 hours summed across every house (the operator's rule, 10-29), and beside them the hours Scheduling's own
calendar planned.

A week is judged whole. A range that cuts one (a custom From/To, a few days picked) still reads all seven of its days,
because overtime is owed on the week, never on the slice a filter shows: each week's hours are the whole week's, and
`inRange` alone is the slice. The weeks are PsiAnywhere's halves of its pay periods
(psi_periods.week_start, Sunday), never Scheduling's Saturday weeks (scheduling.week_key) nor the Builder's Monday ones.

Worked time is recon_psi.worked: PsiAnywhere's P, A, S and I entries (R and D never reach it), every work code (ADMIN
and TRAIN too), a day's own minutes (PsiAnywhere already splits a shift at midnight), a person's overlapping minutes
counted once (one entry per consumer for the same minutes would otherwise count 2:1 staffing twice). An entry with no
clock-out adds nothing and is counted in `open`, so the screen can say why a week looks short.

Planned time is Scheduling's cells (sched_cells beside sched_rows, read with app/scheduling.py's own reader and its own
cell grammar, read-only): the person rows the board shows, a cell that holds a time and no off state, an overnight
shift's hours on the day it starts, a person's overlapping cells counted once as worked minutes are. Each row's name is
resolved against the people tab exactly as recon resolves PsiAnywhere's names (recon_roster.resolve), so a person keys
alike on both sides. Only when asa-hub-db holds no copy of Scheduling's houses (never uploaded, or no copy held) does it
fall back to the house calendars' live copy (recon_roster.load_shifts), and says so (`plannedSource`); a database that
did not answer this time is raised, never swapped for another source."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Callable, Iterable

import gsjs
import hubdb
import recon_detect as D
import recon_psi as RP
import recon_roster as RO
from psi_periods import day_of, label, week_start
from scope import Defer

THRESHOLD = 40.0
SCHEDULE, HOUSE_CALENDARS = "schedule", "house calendars"
# a start time never read sorts after every real one
NO_START = 24 * 60 + 1

s_ = gsjs.str_


def _day(v: Any) -> date | None:
    return v if isinstance(v, date) else day_of(v)


def _r2(x: float) -> float:
    return round(float(x) + 0.0, 2)


# ---- weeks ---------------------------------------------------------------------------------------------------------

def weeks_touching(day_from: Any, day_to: Any) -> list[dict[str, str]]:
    """Every Sunday-to-Saturday week touching [day_from, day_to] (ISO days or dates): {from, to, label}, oldest
    first; none for a range that is not one."""
    a, b = _day(day_from), _day(day_to)
    if a is None or b is None or b < a:
        return []
    out = []
    w = week_start(a)
    while w <= b:
        e = w + timedelta(days=6)
        out.append({"from": w.isoformat(), "to": e.isoformat(), "label": label(w, e)})
        w += timedelta(days=7)
    return out


def _week_days(week: dict[str, str]) -> list[str]:
    a = date.fromisoformat(week["from"])
    return [(a + timedelta(days=k)).isoformat() for k in range(7)]


def _wanted(employees: Iterable[Any] | None) -> Callable[[str, str], bool] | None:
    """The people a list of keys names (recon's matchKey or the people id, any case); None (everyone) for no list."""
    keys = {s_(k).strip().lower() for k in (employees or ()) if s_(k).strip()}
    if not keys:
        return None
    return lambda key, eid: s_(key).lower() in keys or bool(eid and s_(eid).lower() in keys)


def _empty(a: date | None, b: date | None, threshold: float) -> dict[str, Any]:
    return {"from": a.isoformat() if a else "", "to": b.isoformat() if b else "", "threshold": D.num(threshold),
            "weeks": [], "people": [], "employees": []}


def _by_name(people: list[dict[str, str]]) -> list[dict[str, str]]:
    return sorted(people, key=lambda p: (s_(p["name"]).lower(), p["key"]))


# ---- worked --------------------------------------------------------------------------------------------------------

def actual(reads: Any, day_from: Any, day_to: Any, employees: Iterable[Any] | None = None,
           threshold: float = THRESHOLD) -> dict[str, Any]:
    """Worked hours per person per whole Sunday week touching [day_from, day_to], from PsiAnywhere's record.

    → {from, to, threshold, weeks: [{from, to, label}],
       people: [{key, employeeId, employeeName, weeks: [{from, hours, over, overtime}], total (the weeks' sum), inRange,
                 overtime (the weeks' overtime), days: {iso: hours} (every day of those weeks), open (entries with no
                 clock-out)}] by overtime, then total, highest first,
       totals: {people, peopleOver, overtimeHours, hours (the people's totals)} — of the people `employees` keeps,
       employees: [{key, name}] (everyone with hours in those weeks, whatever `employees` keeps: a person whose only
       entries are still open is in `people`, with 0 hours and `open`, never in the picker)}"""
    a, b = _day(day_from), _day(day_to)
    weeks = weeks_touching(a, b)
    if not weeks:
        return {**_empty(a, b, threshold), "totals": {"people": 0, "peopleOver": 0, "overtimeHours": 0, "hours": 0}}
    worked = RP.worked(reads, weeks[0]["from"], weeks[-1]["to"])
    want = _wanted(employees)
    lo, hi = a.isoformat(), b.isoformat()
    people, everyone = [], []
    for key, w in worked.items():
        if _r2(sum(w["days"].values())) > 0:
            everyone.append({"key": key, "name": w["employeeName"]})
        if want is not None and not want(key, w["employeeId"]):
            continue
        days: dict[str, float] = {}
        out_weeks = []
        for wk in weeks:
            hours = 0.0
            for d in _week_days(wk):
                days[d] = _r2(w["days"].get(d, 0.0))
                hours += days[d]
            hours = _r2(hours)
            out_weeks.append({"from": wk["from"], "hours": hours, "over": hours > threshold,
                              "overtime": _r2(max(0.0, hours - threshold))})
        people.append({"key": key, "employeeId": w["employeeId"], "employeeName": w["employeeName"],
                       "weeks": out_weeks, "total": _r2(sum(x["hours"] for x in out_weeks)),
                       "inRange": _r2(sum(h for d, h in days.items() if lo <= d <= hi)),
                       "overtime": _r2(sum(x["overtime"] for x in out_weeks)), "days": days, "open": len(w["open"])})
    people.sort(key=lambda p: (-p["overtime"], -p["total"], s_(p["employeeName"]).lower(), p["key"]))
    return {"from": lo, "to": hi, "threshold": D.num(threshold), "weeks": weeks, "people": people,
            "totals": {"people": len(people), "peopleOver": sum(1 for p in people if p["overtime"] > 0),
                       "overtimeHours": _r2(sum(p["overtime"] for p in people)),
                       "hours": _r2(sum(p["total"] for p in people))},
            "employees": _by_name(everyone)}


def entries(reads: Any, key: Any, day_from: Any, day_to: Any) -> dict[str, Any]:
    """One person's PsiAnywhere entries whose service day is in [day_from, day_to], as PsiAnywhere wrote them (never
    stitched nor folded: the drill-down shows the record the week's hours come from), worked statuses only, by day and
    start. `key` is recon's matchKey or the people id.

    → {employee: {key, name}, entries: [{date, startTime, endTime, hours, location, site, workCode, status, consumers,
       entryIds}]}"""
    a, b = _day(day_from), _day(day_to)
    k = s_(key).strip()
    want = _wanted([k])
    if a is None or b is None or b < a or want is None:
        return {"employee": {"key": k, "name": ""}, "entries": []}
    people, fp = RO.roster(reads)
    places = RP.place_map(reads)
    got = []
    for c in RP.rows(reads, a.isoformat(), b.isoformat()):
        e = RP.entry(c, places, people, fp)
        if e["date"] and want(e["matchKey"], e["employeeId"]):
            got.append(e)
    got.sort(key=lambda e: (e["date"], NO_START if e["startMin"] is None else e["startMin"], e["entryIds"]))
    name = next((e["employeeName"] for e in got if e["employeeName"]), "") or \
        next((p["name"] for p in people if p["id"] == k), "")
    return {"employee": {"key": k, "name": name},
            "entries": [{"date": e["date"], "startTime": e["startTime"], "endTime": e["endTime"],
                         "hours": _r2(e["hours"]), "location": e["location"], "site": e["site"],
                         "workCode": e["workCode"], "status": e["status"], "consumers": e["consumers"],
                         "entryIds": list(e["entryIds"])} for e in got]}


# ---- planned -------------------------------------------------------------------------------------------------------

def no_copy(exc: BaseException) -> bool:
    """Scheduling's houses are structurally not in asa-hub-db: never uploaded to Postgres (scope.Defer), or a read that
    says no copy is held. A database that did not answer this time is neither: it is said (503), never swapped for
    another source."""
    return isinstance(exc, Defer) or (isinstance(exc, hubdb.Unreadable) and "holds no copy" in str(exc))


def _schedule_tabs(reads: Any) -> tuple[list[dict], list[dict]] | None:
    """Scheduling's rows and cells, read with its own reader; None only when asa-hub-db holds no copy of them
    (no_copy). Any other failure is raised."""
    import scheduling as S  # noqa: PLC0415 - Scheduling's reader and grammar, loaded beside the recon modules
    try:
        return S.read_tab(reads, S.TABS["rows"]), S.read_tab(reads, S.TABS["cells"])
    except (Defer, hubdb.Unreadable) as exc:
        if no_copy(exc):
            return None
        raise


def _schedule_spans(reads: Any, rows: list[dict], cells: list[dict], lo: str, hi: str) -> list[dict[str, Any]]:
    """Each worked cell of Scheduling's calendar in [lo, hi] as a span of minutes on the day it starts: the person rows
    the board shows (active), a cell that holds a time (scheduling.classify), not one an off state empties (called off,
    asked off, time off, swapped out); a trainee's shift is their own hours, as the board counts it."""
    import scheduling as S  # noqa: PLC0415
    name_of = {r["house_code"] + "|" + r["row_id"]: gsjs.trim(r["name"]) for r in rows
               if r["row_kind"] == "person" and r["active"] != "no" and gsjs.trim(r["name"])}
    people, fp = RO.roster(reads)
    out = []
    for c in cells:
        day = c["date"]
        if not S.iso_valid(day) or day < lo or day > hi or c["state"] in S.OFF_STATES:
            continue
        name = name_of.get(c["house_code"] + "|" + c["row_id"])
        if not name:
            continue
        k = S.classify(c["text"])
        if not k or k.start is None or k.end is None:
            continue
        who = RO.resolve(name, people, fp)
        out.append({"key": who["key"], "employeeId": who["id"] if who["ok"] else "",
                    "employeeName": who["name"] if who["ok"] else name, "date": day,
                    "start": int(gsjs.js_round(k.start * 60)), "end": int(gsjs.js_round(k.end * 60))})
    return out


def _calendar_spans(reads: Any, lo: str, hi: str) -> list[dict[str, Any]]:
    """The house calendars' worked cells (their live copy, as recon reads its roster), placeholders (Family, Nurse, a
    workshop) left out as Scheduling leaves them out of its people."""
    import scheduling as S  # noqa: PLC0415
    out = []
    for e in RO.load_shifts(reads, lo, hi):
        if e["startMin"] is None or e["endMin"] is None:
            continue
        if not e["employeeId"] and S.row_kind_of(e["employeeName"]) != "person":
            continue
        out.append({"key": e["matchKey"], "employeeId": e["employeeId"], "employeeName": e["employeeName"],
                    "date": e["date"], "start": e["startMin"], "end": e["endMin"]})
    return out


def planned(reads: Any, day_from: Any, day_to: Any) -> dict[str, Any]:
    """Each person's planned hours per day in [day_from, day_to], from Scheduling's own calendar (the house calendars'
    live copy only when asa-hub-db holds no copy of Scheduling's houses, no_copy; a database that did not answer is
    raised, for the lane to say).

    → {"source": "schedule" | "house calendars",
       "people": {matchKey: {employeeId, employeeName, days: {iso: hours}}}}"""
    a, b = _day(day_from), _day(day_to)
    if a is None or b is None or b < a:
        return {"source": SCHEDULE, "people": {}}
    lo, hi = a.isoformat(), b.isoformat()
    tabs = _schedule_tabs(reads)
    if tabs is not None:
        spans, source = _schedule_spans(reads, tabs[0], tabs[1], lo, hi), SCHEDULE
    else:
        spans, source = _calendar_spans(reads, lo, hi), HOUSE_CALENDARS
    out: dict[str, dict[str, Any]] = {}
    by_day: dict[tuple[str, str], list[tuple[int, int]]] = {}
    for sp in spans:
        who = out.setdefault(sp["key"], {"employeeId": sp["employeeId"], "employeeName": sp["employeeName"],
                                         "days": {}})
        if not who["employeeId"] and sp["employeeId"]:
            who["employeeId"], who["employeeName"] = sp["employeeId"], sp["employeeName"]
        by_day.setdefault((sp["key"], sp["date"]), []).append((sp["start"], sp["end"]))
    for (key, day), ss in by_day.items():
        out[key]["days"][day] = _r2(RP.union_minutes(ss) / 60)
    return {"source": source, "people": out}


def compare(reads: Any, day_from: Any, day_to: Any, employees: Iterable[Any] | None = None,
            threshold: float = THRESHOLD) -> dict[str, Any]:
    """Planned (Scheduling) beside actual (PsiAnywhere) hours per person per whole Sunday week touching the range.

    → {from, to, threshold, weeks: [{from, to, label}], plannedSource,
       people: [{key, employeeId, employeeName, weeks: [{from, planned, actual, over, plannedOver, overtime}], planned,
                 actual, overtime, days: {iso: {planned, actual}}}] by overtime, then actual, highest first,
       totals: {people, peopleOver, overtimeHours}, employees: [{key, name}] (everyone with planned or worked hours in
       those weeks)}"""
    a, b = _day(day_from), _day(day_to)
    weeks = weeks_touching(a, b)
    if not weeks:
        return {**_empty(a, b, threshold), "plannedSource": SCHEDULE,
                "totals": {"people": 0, "peopleOver": 0, "overtimeHours": 0}}
    worked = RP.worked(reads, weeks[0]["from"], weeks[-1]["to"])
    plan = planned(reads, weeks[0]["from"], weeks[-1]["to"])
    want = _wanted(employees)
    people, everyone = [], []
    for key in sorted(set(worked) | set(plan["people"])):
        w, p = worked.get(key) or {}, plan["people"].get(key) or {}
        eid = s_(w.get("employeeId")) or s_(p.get("employeeId"))
        name = s_(w.get("employeeName")) or s_(p.get("employeeName"))
        wd, pd = w.get("days") or {}, p.get("days") or {}
        if _r2(sum(wd.values())) > 0 or _r2(sum(pd.values())) > 0:
            everyone.append({"key": key, "name": name})
        if want is not None and not want(key, eid):
            continue
        days: dict[str, dict[str, float]] = {}
        out_weeks = []
        for wk in weeks:
            act = pl = 0.0
            for d in _week_days(wk):
                days[d] = {"planned": _r2(pd.get(d, 0.0)), "actual": _r2(wd.get(d, 0.0))}
                act += days[d]["actual"]
                pl += days[d]["planned"]
            act, pl = _r2(act), _r2(pl)
            out_weeks.append({"from": wk["from"], "planned": pl, "actual": act, "over": act > threshold,
                              "plannedOver": pl > threshold, "overtime": _r2(max(0.0, act - threshold))})
        people.append({"key": key, "employeeId": eid, "employeeName": name, "weeks": out_weeks,
                       "planned": _r2(sum(x["planned"] for x in out_weeks)),
                       "actual": _r2(sum(x["actual"] for x in out_weeks)),
                       "overtime": _r2(sum(x["overtime"] for x in out_weeks)), "days": days})
    people.sort(key=lambda p: (-p["overtime"], -p["actual"], -p["planned"], s_(p["employeeName"]).lower(), p["key"]))
    return {"from": a.isoformat(), "to": b.isoformat(), "threshold": D.num(threshold), "weeks": weeks,
            "plannedSource": plan["source"], "people": people,
            "totals": {"people": len(people), "peopleOver": sum(1 for p in people if p["overtime"] > 0),
                       "overtimeHours": _r2(sum(p["overtime"] for p in people))},
            "employees": _by_name(everyone)}
