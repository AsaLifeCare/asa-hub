"""Overtime's lanes: worked hours per employee per Sunday-to-Saturday week from PsiAnywhere's record, in Time
Reconciliation (/hub-lanes/time-recon/overtime…) and, beside the planned hours, in Scheduling
(/hub-lanes/scheduling/overtime). Each page answers to its own App Control row (no row = the master's alone): Time
Reconciliation's behind its readers' gate (app/recon_gate.py) and then `time-recon.overtime`; Scheduling's behind the
app's own door, then `scheduling.overtime`, then the board's own viewer cut (scheduling.hours_hidden: when the board
hides hours from a viewer, this page of hours is refused them; the master always sees). The arithmetic is
app/recon_overtime.py's; this module only reads the query, picks the default range and says what went wrong.

A range is ISO days (yyyy-mm-dd). With neither end it is PsiAnywhere's current pay period (New York's today); with one
end, the pay period holding it supplies the other. More than 62 days is refused (400): every week touching the range is
read whole, so the cap keeps one request to ten weeks of PsiAnywhere entries."""
from __future__ import annotations

import logging
from datetime import date
from typing import Any, Callable

try:
    from fastapi import Request
except ImportError:  # the sync container runs the module's logic without the web stack
    Request = Any  # type: ignore[misc,assignment]

import psi_periods as PP

log = logging.getLogger("asa-hub-app.overtime-lanes")

RECON_LANE = "/hub-lanes/time-recon/overtime"
SCHED_LANE = "/hub-lanes/scheduling/overtime"
RECON_FEATURE, RECON_FEATURE_LABEL = "time-recon.overtime", "Time Reconciliation › Overtime"
SCHED_APP, SCHED_APP_LABEL = "scheduling", "Scheduling"
SCHED_FEATURE, SCHED_FEATURE_LABEL = "scheduling.overtime", "Scheduling › Overtime"
MAX_DAYS = 62
BACK_PERIODS = 12
HOURS_HIDDEN = ("Scheduling shows its hours to the master alone (Settings › My Work › Scheduling · Hours column), so "
                "Scheduling › Overtime, which is nothing but hours, is not open to you.")


class Asked(ValueError):
    """A query the lane cannot answer as asked: said back as a 400 in its own words."""


def _day(raw: str, name: str) -> date | None:
    t = str(raw or "").strip()
    if not t:
        return None
    d = PP.day_of(t)
    if d is None:
        raise Asked(f"{name} must be a day written yyyy-mm-dd.")
    return d


def span(q_from: str, q_to: str, today: date) -> tuple[date, date]:
    """The range asked: both ends, one end and its pay period, or the current pay period; at most MAX_DAYS days."""
    a, b = _day(q_from, "from"), _day(q_to, "to")
    if a is None and b is None:
        p = PP.period(today, today)
        a, b = PP.day_of(p["from"]), PP.day_of(p["to"])
    elif a is None:
        a = PP.day_of(PP.period(b, today)["from"])
    elif b is None:
        b = PP.day_of(PP.period(a, today)["to"])
    if b < a:
        raise Asked("to must not be before from.")
    if (b - a).days + 1 > MAX_DAYS:
        raise Asked(f"Pick at most {MAX_DAYS} days.")
    return a, b


def keys_of(raw: str) -> list[str] | None:
    """employees=KEY,KEY → the keys; None (everyone) when none is named."""
    got = [k.strip() for k in str(raw or "").split(",") if k.strip()]
    return got or None


# ---- the answers (called in the threadpool, each over one fresh Reads) ---------------------------------------------

def overtime(reads: Any, q_from: str, q_to: str, q_employees: str, today: date) -> dict[str, Any]:
    """GET /hub-lanes/time-recon/overtime's data."""
    import recon_overtime as OT  # noqa: PLC0415
    a, b = span(q_from, q_to, today)
    got = OT.actual(reads, a, b, keys_of(q_employees))
    return {"from": got["from"], "to": got["to"], "threshold": got["threshold"], "weeks": got["weeks"],
            "people": got["people"], "totals": got["totals"], "periods": PP.periods(today, BACK_PERIODS),
            "employees": got["employees"]}


def overtime_entries(reads: Any, q_employee: str, q_from: str, q_to: str, today: date) -> dict[str, Any]:
    """GET /hub-lanes/time-recon/overtime/entries's data."""
    import recon_overtime as OT  # noqa: PLC0415
    key = str(q_employee or "").strip()
    if not key:
        raise Asked("employee: name one person's key.")
    a, b = span(q_from, q_to, today)
    return OT.entries(reads, key, a, b)


def scheduling_overtime(reads: Any, q_from: str, q_to: str, q_employees: str, today: date) -> dict[str, Any]:
    """GET /hub-lanes/scheduling/overtime's data."""
    import recon_overtime as OT  # noqa: PLC0415
    a, b = span(q_from, q_to, today)
    got = OT.compare(reads, a, b, keys_of(q_employees))
    return {"from": got["from"], "to": got["to"], "threshold": got["threshold"], "weeks": got["weeks"],
            "plannedSource": got["plannedSource"], "people": got["people"], "totals": got["totals"],
            "periods": PP.periods(today, BACK_PERIODS), "employees": got["employees"]}


def hours_cut(reads: Any, is_master: bool) -> dict[str, Any] | None:
    """The Scheduling board's own viewer cut (scheduling.hours_hidden, the check scheduling.cut applies): when the board
    hides hours from this viewer, the page that shows nothing else is refused (403); the master always sees. None when
    it may be read."""
    import scheduling as S  # noqa: PLC0415
    if S.hours_hidden(reads, {"is_master": is_master is True}):
        return {"status": 403, "reason": "restricted", "message": HOURS_HIDDEN}
    return None


def envelope(what: str, fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    """The lane's envelope: 200 with the data; 400 for a query it cannot answer; 503 for a read that failed — said in
    plain words, never a blank page."""
    try:
        return {"status": 200, "data": fn()}
    except Asked as exc:
        return {"status": 400, "message": str(exc)}
    except Exception as exc:  # noqa: BLE001 - said, never a blank page
        log.warning("overtime: %s could not be read (%s)", what, type(exc).__name__)
        return {"status": 503, "message": f"{what} could not be read right now ({type(exc).__name__})."}


def install(app: Any, reads_of: Callable[[], Any]) -> None:
    """GET /hub-lanes/time-recon/overtime, /hub-lanes/time-recon/overtime/entries and /hub-lanes/scheduling/overtime."""
    from starlette.concurrency import run_in_threadpool  # noqa: PLC0415

    def q(request: Request, name: str) -> str:
        import lane_gate as LG  # noqa: PLC0415
        return LG.query(request, name)

    async def recon_reader(request: Request) -> dict[str, Any] | None:
        import recon_gate as RG  # noqa: PLC0415
        _who, refused = await RG.reader(request, reads_of, RECON_FEATURE, RECON_FEATURE_LABEL)
        return refused

    async def sched_reader(request: Request) -> dict[str, Any] | None:
        import sched_lanes  # noqa: PLC0415
        for app_id, lab in ((SCHED_APP, SCHED_APP_LABEL), (SCHED_FEATURE, SCHED_FEATURE_LABEL)):
            got = await sched_lanes._app_gate(request, app_id, app_label=lab)
            if isinstance(got, dict):
                return got
        # then the board's own cut: hours hidden from this viewer close the page (the gates' session, held)
        s = await sched_lanes._session(request)
        if s is None:
            return {"status": 401, "reason": "session", "message": "sign in first"}
        master = s.is_master is True
        try:
            return await run_in_threadpool(lambda: hours_cut(reads_of(), master))
        except Exception as exc:  # noqa: BLE001 - a gate that throws stays shut
            log.warning("overtime: the hours switch could not be read (%s)", type(exc).__name__)
            return {"status": 403, "reason": "unreadable",
                    "message": f"The access check failed ({type(exc).__name__}), so the door stays closed."}

    async def lane_overtime(request: Request) -> Any:
        import lane_gate as LG  # noqa: PLC0415
        refused = await recon_reader(request)
        if refused is not None:
            return LG.answer(refused, no_store=True)
        qf, qt, qe = q(request, "from"), q(request, "to"), q(request, "employees")
        return LG.answer(await run_in_threadpool(
            envelope, "Overtime", lambda: overtime(reads_of(), qf, qt, qe, PP.today_ny())), no_store=True)

    async def lane_entries(request: Request) -> Any:
        import lane_gate as LG  # noqa: PLC0415
        refused = await recon_reader(request)
        if refused is not None:
            return LG.answer(refused, no_store=True)
        qe, qf, qt = q(request, "employee"), q(request, "from"), q(request, "to")
        return LG.answer(await run_in_threadpool(
            envelope, "The entries", lambda: overtime_entries(reads_of(), qe, qf, qt, PP.today_ny())), no_store=True)

    async def lane_scheduling(request: Request) -> Any:
        import lane_gate as LG  # noqa: PLC0415
        refused = await sched_reader(request)
        if refused is not None:
            return LG.answer(refused, no_store=True)
        qf, qt, qe = q(request, "from"), q(request, "to"), q(request, "employees")
        return LG.answer(await run_in_threadpool(
            envelope, "Overtime", lambda: scheduling_overtime(reads_of(), qf, qt, qe, PP.today_ny())), no_store=True)

    app.get(RECON_LANE, include_in_schema=False)(lane_overtime)
    app.get(RECON_LANE + "/entries", include_in_schema=False)(lane_entries)
    app.get(SCHED_LANE, include_in_schema=False)(lane_scheduling)
