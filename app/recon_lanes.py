"""Time Reconciliation's lanes (/hub-lanes/time-recon/…): the pay periods and pickers, and the review queue filtered by
dates, house, employee, type and status. Read behind app/recon_gate.py — the people the writes let in — since every
error names staff and clients.

The queue answers the LIVE errors (a newer run supersedes the rows of the days it covers, so each anomaly is there once)
of the days asked — a pay period by default, the current one — and counts them per type, house and employee BEFORE the
type filter, so a screen grouping by house first and paging after shows every house, never the first twenty rows of one.
The runs that touched those days and the days PsiAnywhere holds no entry for come with them, so an empty day reads as
"no data yet", not as "nothing wrong" — daysWithoutData stops at today (New York): a day still to come holds no entry
by nature, and listing the rest of the current period would read as a hole in the record. A range is thirteen pay
periods at most. Each reading is a function of its own, so the tests stand in for it."""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Callable

try:
    from fastapi import Request
except ImportError:  # the sync container runs the module's logic without the web stack
    Request = Any  # type: ignore[misc,assignment]

import gsjs
import names as N
import psi_periods as PP
import recon as R
import recon_psi as PSI
import recon_roster as RO

log = logging.getLogger("asa-hub-app.lanes")

LANE = "/hub-lanes/time-recon"
STATUSES = ("open", "resolved", "all")
QUERY = ("from", "to", "house", "employee", "type", "status")
EMPLOYEES_SHOWN = 50
RUNS_SHOWN = 10
# the longest range the queue reads at once: the thirteen pay periods the periods lane offers (a range of years would
# list and look up every one of its days)
QUEUE_MAX_DAYS = PP.PERIOD_DAYS * 13
ERROR_FIELDS = ("id", "runId", "key", "type", "date", "location", "employeeId", "employeeName", "consumers",
                "startTime", "endTime", "hours", "detail", "status", "note", "resolvedBy", "resolvedAt",
                "reminderQueuedAt")
RUN_FIELDS = ("id", "dateFrom", "dateTo", "status", "createdAt", "createdBy")
RUN_COUNTS = ("missing", "noEnd", "dupe", "gap", "overlap", "total", "carried")
# a run stamped no source read the workbook's punches (the sheet era)
LEGACY_SOURCE = "workbook"
UNREADABLE = "Time Reconciliation could not be read just now ({why}). Try again in a moment."

s_ = gsjs.str_


class Asked(ValueError):
    """A query the lane cannot answer as asked: a 400 in plain words."""


# ---- the readings ----------------------------------------------------------------------------------------------------

def live_errors(reads: Any) -> list[dict]:
    """Every live error row (a superseded one is removed), its stamps healed."""
    return [R.heal(r) for r in R.rows(reads, R.ERRORS_TAB)]


def live_runs(reads: Any) -> list[dict]:
    """Every live run row (one a newer run covered whole is removed)."""
    return R.rows(reads, R.RUNS_TAB)


def psi_days(reads: Any, day_from: str, day_to: str) -> set[str]:
    """The service days in [day_from, day_to] PsiAnywhere holds any entry for."""
    got = reads.db.query(
        "select distinct cells->>'date_iso' from app.resource_rows where resource = %s and removed_at is null"
        " and cells->>'date_iso' between %s and %s", (PSI.PUNCHES, day_from, day_to))
    return {s_(d) for (d,) in got if d}


def psi_coverage(reads: Any) -> dict[str, str]:
    """The first and the last service day the PsiAnywhere record holds."""
    got = reads.db.query(
        "select min(cells->>'date_iso'), max(cells->>'date_iso') from app.resource_rows where resource = %s"
        " and removed_at is null and coalesce(cells->>'date_iso', '') <> ''", (PSI.PUNCHES,))
    lo, hi = got[0] if got else ("", "")
    return {"psiFrom": s_(lo), "psiTo": s_(hi)}


def last_auto(reads: Any) -> dict[str, str] | None:
    """When the daily run last ran and what it said; None before its first pass."""
    try:
        got = reads.db.query(f"select ran_at, said from {R.AUTO_TABLE} where id = 1")
    except Exception as exc:  # noqa: BLE001 - a mark not made yet is no pass yet
        log.info("time-recon lanes: the auto run's mark was not read (%s)", type(exc).__name__)
        return None
    if not got or got[0][0] is None:
        return None
    at, said = got[0]
    return {"ranAt": at.isoformat() if hasattr(at, "isoformat") else s_(at), "said": s_(said)}


def houses(reads: Any) -> list[str]:
    """The codes of the houses whose calendars the roster reads."""
    return sorted(PSI.house_codes(reads))


def psi_people(reads: Any, day_from: str, day_to: str) -> list[dict[str, str]]:
    """The people PsiAnywhere holds worked entries for in [day_from, day_to], each once by recon's key (the people
    id, or 'name:<core tokens>' for a name the people tab does not resolve), by name."""
    people, fp = RO.roster(reads)
    places = PSI.place_map(reads)
    out: dict[str, dict[str, str]] = {}
    for c in PSI.rows(reads, day_from, day_to):
        e = PSI.entry(c, places, people, fp)
        if e["matchKey"] and e["matchKey"] != "name:" and e["matchKey"] not in out:
            out[e["matchKey"]] = {"key": e["matchKey"], "id": e["employeeId"], "name": e["employeeName"]}
    return sorted(out.values(), key=lambda p: (p["name"].lower(), p["key"]))


def ids_by_name(reads: Any) -> dict[str, str]:
    """The people tab's names (lower case) → their ids, a name two people share left out: an overlap names its staff
    by the roster's names, never by id."""
    people, _fp = RO.roster(reads)
    seen: dict[str, str] = {}
    shared: set[str] = set()
    for p in people:
        k = p["name"].strip().lower()
        if k in seen and seen[k] != p["id"]:
            shared.add(k)
        seen.setdefault(k, p["id"])
    return {k: v for k, v in seen.items() if k not in shared and v}


# ---- the queue's pieces ----------------------------------------------------------------------------------------------

def name_key(name: str) -> str:
    """recon's key for a name the people tab does not resolve (recon_roster.resolve's fallback)."""
    return "name:" + " ".join(N.tokens(name)["core"])


def people_of(e: dict, by_name: dict[str, str]) -> list[tuple[str, str]]:
    """(key, name) of each person an error is about: its employee; each staff member of an overlap; nobody for a gap
    no planned shift covered (it names the consumer)."""
    eid, name = s_(e.get("employeeId")), s_(e.get("employeeName")).strip()
    if eid:
        return [(eid, name)]
    if not name or (s_(e.get("type")) == "gap" and name.endswith(" (consumer)")):
        return []
    names = [n.strip() for n in name.split(",")] if s_(e.get("type")) == "overlap" else [name]
    out: dict[str, str] = {}
    for n in names:
        if n:
            out.setdefault(by_name.get(n.lower()) or name_key(n), n)
    return list(out.items())


def is_about(e: dict, want: str, by_name: dict[str, str]) -> bool:
    """Whether an error is about the employee asked: by people id, by recon's key, or by name (any case)."""
    w = want.lower()
    if s_(e.get("employeeId")) == want:
        return True
    return any(k == want or k.lower() == w or n.lower() == w for k, n in people_of(e, by_name))


def counted(errors: list[dict], by_name: dict[str, str]) -> dict[str, Any]:
    """The errors counted per type, per house (most first) and per employee (most first, the first fifty)."""
    def blank() -> dict[str, int]:
        return {t: 0 for t in R.TYPES}

    by_type = blank()
    by_house: dict[str, dict[str, Any]] = {}
    by_person: dict[str, dict[str, Any]] = {}
    for e in errors:
        kind = s_(e.get("type"))
        h = by_house.setdefault(s_(e.get("location")), {"house": s_(e.get("location")), "total": 0,
                                                         "byType": blank()})
        h["total"] += 1
        if kind in by_type:
            by_type[kind] += 1
            h["byType"][kind] += 1
        for key, name in people_of(e, by_name):
            p = by_person.setdefault(key, {"key": key, "name": name, "total": 0})
            p["total"] += 1
    return {"total": len(errors), "byType": by_type,
            "byHouse": sorted(by_house.values(), key=lambda h: (-h["total"], h["house"])),
            "byEmployee": sorted(by_person.values(), key=lambda p: (-p["total"], p["name"].lower()))[:EMPLOYEES_SHOWN]}


def _count(v: Any) -> int:
    n = R._js_number(v)
    return int(n) if n == n and abs(n) < 1e12 else 0


def run_shown(r: dict) -> dict[str, Any]:
    return {**{f: s_(r.get(f)) for f in RUN_FIELDS}, "dateFrom": R.stored_day(r.get("dateFrom")),
            "dateTo": R.stored_day(r.get("dateTo")), **{f: _count(r.get(f)) for f in RUN_COUNTS},
            "source": s_(r.get("source")) or LEGACY_SOURCE}


def error_shown(e: dict) -> dict[str, Any]:
    out = {f: e.get(f) if e.get(f) is not None else "" for f in ERROR_FIELDS}
    out["key"] = s_(e.get("key")) or R.anomaly_key(e)
    return out


def range_of(q: dict[str, str], today: date) -> tuple[str, str]:
    """from and to as asked, or — both left out — the pay period holding today; QUEUE_MAX_DAYS at most."""
    a_said, b_said = q.get("from", "").strip(), q.get("to", "").strip()
    if not a_said and not b_said:
        cur = PP.period(today, today)
        return cur["from"], cur["to"]
    if not a_said or not b_said:
        raise Asked("Give both from and to, or neither for the current pay period.")
    a, b = PP.day_of(a_said), PP.day_of(b_said)
    if a is None or b is None:
        raise Asked("from and to must be days written yyyy-mm-dd.")
    if a > b:
        raise Asked(f"from ({a.isoformat()}) is after to ({b.isoformat()}).")
    days = (b - a).days + 1
    if days > QUEUE_MAX_DAYS:
        raise Asked(f"The queue reads {QUEUE_MAX_DAYS} days at most (thirteen pay periods): "
                    f"{a.isoformat()}–{b.isoformat()} is {days} days.")
    return a.isoformat(), b.isoformat()


def days_between(day_from: str, day_to: str) -> list[str]:
    a, b = date.fromisoformat(day_from), date.fromisoformat(day_to)
    return [(a + timedelta(days=n)).isoformat() for n in range((b - a).days + 1)]


# ---- the views -------------------------------------------------------------------------------------------------------

def periods_view(reads: Any, q: dict[str, str], today: date) -> dict[str, Any]:
    """The pickers: today, the current pay period and the twelve before it (newest first), the houses, the people
    PsiAnywhere holds entries for in those periods, the days its record covers and the daily run's last word."""
    ps = PP.periods(today)
    return {"today": today.isoformat(), "periods": ps, "houses": houses(reads),
            "employees": psi_people(reads, ps[-1]["from"], ps[0]["to"]), "coverage": psi_coverage(reads),
            "lastAuto": last_auto(reads)}


def queue_view(reads: Any, q: dict[str, str], today: date) -> dict[str, Any]:
    """The review queue of [from, to] (the current pay period by default): the live errors of those days that pass the
    house, employee, status (open by default) and type filters, in place, day and clock order; their counts, which
    honour every filter but the type; the runs that touched those days (newest first); and the days, up to today,
    PsiAnywhere holds no entry for."""
    day_from, day_to = range_of(q, today)
    kind = q.get("type", "").strip()
    if kind and kind not in R.TYPES:
        raise Asked("type must be one of " + ", ".join(R.TYPES) + ".")
    status = (q.get("status", "").strip() or "open").lower()
    if status not in STATUSES:
        raise Asked("status must be one of " + ", ".join(STATUSES) + ".")
    house, employee = q.get("house", "").strip(), q.get("employee", "").strip()
    by_name = ids_by_name(reads)
    picked = []
    for e in live_errors(reads):
        day = s_(e.get("date"))
        if not day_from <= day <= day_to:
            continue
        is_open = s_(e.get("status")) == "Open"
        if (status == "open" and not is_open) or (status == "resolved" and is_open):
            continue
        if house and s_(e.get("location")) != house:
            continue
        if employee and not is_about(e, employee, by_name):
            continue
        picked.append(e)
    shown = [error_shown(e) for e in R.by_place(picked) if not kind or s_(e.get("type")) == kind]
    runs = [run_shown(r) for r in R.newest_first(live_runs(reads))
            if R.stored_day(r.get("dateFrom")) <= day_to and R.stored_day(r.get("dateTo")) >= day_from]
    last = min(day_to, today.isoformat())
    held = psi_days(reads, day_from, last) if day_from <= last else set()
    return {"from": day_from, "to": day_to, "period": R.period_label(day_from, day_to), "errors": shown,
            "counts": counted(picked, by_name), "runs": runs[:RUNS_SHOWN],
            "daysWithoutData": [d for d in days_between(day_from, last) if d not in held] if day_from <= last else []}


# ---- the lanes -------------------------------------------------------------------------------------------------------

async def lane(request: Any, reads_of: Callable[[], Any], view: Callable[[Any, dict[str, str], date], dict[str, Any]]
               ) -> Any:
    """One GET behind the readers' gate: the view over this request's reads, off the event loop; a query it cannot
    answer is a 400, anything that fails a 503 in plain words — never a traceback page."""
    import lane_gate as LG  # noqa: PLC0415
    import recon_gate as RG  # noqa: PLC0415
    from starlette.concurrency import run_in_threadpool  # noqa: PLC0415
    _who, refused = await RG.reader(request, reads_of)
    if refused is not None:
        return LG.answer(refused, no_store=True)
    q = {name: LG.query(request, name) for name in QUERY}

    def run() -> dict[str, Any]:
        reads = reads_of()
        return view(reads, q, PP.today_ny(reads.now))
    try:
        data = await run_in_threadpool(run)
    except Asked as exc:
        return LG.answer({"status": 400, "message": str(exc)}, no_store=True)
    except Exception as exc:  # noqa: BLE001 - said, never a blank page
        log.warning("time-recon lanes: %s not answered (%s)", getattr(view, "__name__", "view"), type(exc).__name__)
        return LG.answer({"status": 503, "message": UNREADABLE.format(why=type(exc).__name__)}, no_store=True)
    return LG.answer({"status": 200, "data": data}, no_store=True)


def install(app: Any, reads_of: Callable[[], Any]) -> None:
    """GET {LANE}/periods and {LANE}/queue."""
    async def periods_lane(request: Request) -> Any:
        return await lane(request, reads_of, periods_view)

    async def queue_lane(request: Request) -> Any:
        return await lane(request, reads_of, queue_view)

    app.get(f"{LANE}/periods", include_in_schema=False)(periods_lane)
    app.get(f"{LANE}/queue", include_in_schema=False)(queue_lane)
