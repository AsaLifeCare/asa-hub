"""Calendar Builder's master grid, answered here as the relay answered it (server/snapshot_service.py): the grid with
the draft laid on, one draft cell, scheduled time off staged as drafts, the generator's fill of the blanks, the
publish, and the push of the master's house blocks into the houses. Every one reads and writes the master's own record
in asa-hub-db (cal_builder_master: the grid cell by cell and its Table) beside the draft tables, and the houses' record
(asa_house_calendar_edits); Google is never read or written here — the sheets are the records' copies, carried by
asa-hub-sheet-sync. The sheet's side comes in through POST /calendar-builder/master-sync, which the keeper calls once
it read the master book again, and once a day (daily)."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

from fastapi import Request

import cal_builder_master
import calendar_builder_slices
import calendar_builder_write
import calendar_generator
import effective_roster
import live_notify
import sched_lanes
import shift_requests

log = logging.getLogger("asa-hub-app.master-grid")

PG_DSN = sched_lanes.PG_DSN
# the slices that lay the master draft over the grid (calendar_builder_slices._period_draft)
DRAFT_SLICES = ("calendarConflicts", "calendarHours")
# the slices read off the master record itself
RECORD_SLICES = ("calendarGrid", "calendarConflicts", "calendarHours", "calendarShifts")
DAILY_LOOK_S = 3600.0

_BUILDER_ALL_REFUSED = ("the master grid changes every house at once, so it is for the badges "
                        f"that edit every house — {shift_requests.deciders_all()}; a "
                        "house manager builds their own houses under House calendars")


async def _builder_master(request: Request) -> tuple[dict[str, Any], tuple[str, str]] | dict[str, Any]:
    got = await sched_lanes._builder_viewer(request)  # noqa: SLF001 - the Builder's one gate
    if isinstance(got, dict):
        return got
    who, actor = got
    if not shift_requests.edits_every_house(who):
        return {"status": 403, "message": _BUILDER_ALL_REFUSED}
    return who, actor


def _drafted(out: Any) -> Any:
    """A draft changed: the grid read again, the slices that lay the draft rebuilt."""
    if isinstance(out, dict) and out.get("status") == 200:
        calendar_builder_slices.forget_grid()
        live_notify.dirty(DRAFT_SLICES)
    return out


async def _run(fn: Callable[..., Any], *args: Any) -> Any:
    return await sched_lanes._run(fn, *args)  # noqa: SLF001 - the lanes' own threads and connections


async def lane_cal_builder_grid(request: Request) -> dict[str, Any]:
    """The master grid with the draft layered on top, plus conflicts and hours computed over the merged picture."""
    got = await _builder_master(request)
    if isinstance(got, dict):
        return got
    try:
        grid = await _run(calendar_builder_write.merged_grid, PG_DSN)
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"grid unreadable ({type(exc).__name__})"}
    # said before Publish is pressed: while test mode holds, the master publish is refused
    return {"status": 200, "data": {**grid, "test_mode": await _run(effective_roster.test_mode_said)}}


async def lane_cal_builder_cell(request: Request) -> dict[str, Any]:
    """Upsert one draft cell of the master grid."""
    got = await _builder_master(request)
    if isinstance(got, dict):
        return got
    _who, actor = got
    body = await sched_lanes._body(request)  # noqa: SLF001
    if not isinstance(body, dict):
        return {"status": 400, "message": "invalid body"}
    try:
        sheet_row = int(body.get("sheet_row") or 0)
    except (TypeError, ValueError):
        return {"status": 400, "message": "sheet_row must be a number"}
    date_iso = str(body.get("date_iso") or "").strip()
    value = str(body.get("value") if body.get("value") is not None else "")
    if not sheet_row or not date_iso:
        return {"status": 400, "message": "sheet_row and date_iso are required"}
    try:
        out = await _run(calendar_builder_write.set_cell, PG_DSN, actor[1], sheet_row, date_iso, value)
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"write failed ({type(exc).__name__})"}
    return _drafted(out)


async def lane_cal_builder_apply_requests(request: Request) -> dict[str, Any]:
    """Pending time-off requests → master-grid drafts (R/O, the shift offered to the first blank OPEN slot)."""
    got = await _builder_master(request)
    if isinstance(got, dict):
        return got
    try:
        out = await _run(calendar_builder_write.apply_requests, PG_DSN, got[1][1])
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"apply failed ({type(exc).__name__})"}
    return _drafted(out)


async def lane_cal_builder_generate(request: Request) -> dict[str, Any]:
    """Fill the master period's blanks as drafts (calendar_generator.py); filled cells are never touched."""
    got = await _builder_master(request)
    if isinstance(got, dict):
        return got
    try:
        out = await _run(calendar_generator.generate, PG_DSN, got[1][1])
    except Exception as exc:  # noqa: BLE001
        log.warning("calendar-builder generate failed: %s", exc)
        return {"status": 502, "message": f"generate failed ({type(exc).__name__})"}
    return _drafted(out)


def _recorded() -> None:
    """The master record changed: the grid read again, every slice read off it rebuilt."""
    calendar_builder_slices.forget_grid()
    live_notify.dirty(RECORD_SLICES)


async def lane_cal_builder_publish(request: Request) -> dict[str, Any]:
    """The master draft → the master record (cal_builder_master); the sheet's copy is queued."""
    got = await _builder_master(request)
    if isinstance(got, dict):
        return got
    try:
        out = await _run(calendar_builder_write.publish, PG_DSN, got[1][1])
    except Exception as exc:  # noqa: BLE001
        log.warning("calendar-builder publish failed: %s", exc)
        return {"status": 502, "message": f"publish failed ({type(exc).__name__})"}
    if (out or {}).get("status") == 200 and ((out.get("data") or {}).get("written") or 0) > 0:
        _recorded()
    return out


async def lane_cal_builder_publish_houses(request: Request) -> dict[str, Any]:
    """The master's house blocks → the houses' record, fail-closed per house; {"dry_run": true} writes nothing."""
    got = await _builder_master(request)
    if isinstance(got, dict):
        return got
    body = await sched_lanes._body(request)  # noqa: SLF001
    dry_run = bool(body.get("dry_run")) if isinstance(body, dict) else False
    try:
        out = await _run(calendar_builder_write.publish_houses, PG_DSN, got[1][1], dry_run)
    except Exception as exc:  # noqa: BLE001
        log.warning("calendar-builder houses publish failed: %s", exc)
        return {"status": 502, "message": f"houses publish failed ({type(exc).__name__})"}
    if not dry_run:
        # a first shift pushed without an IST raised a training approval
        sched_lanes._notices_wake()  # noqa: SLF001
    return out


def _fold(force: bool = False) -> dict[str, Any]:
    out = cal_builder_master.fold(PG_DSN, force=force)
    if out.get("changed"):
        _recorded()
    return out


async def master_sync(request: Request) -> dict[str, Any]:
    """POST /calendar-builder/master-sync — the keeper read the master book again: its grid folded into the record."""
    import live_events  # noqa: PLC0415 - the live plane's service token
    if not live_events.authorized(request):
        return {"status": 401, "message": "service identity required"}
    try:
        out = await _run(_fold)
    except Exception as exc:  # noqa: BLE001 - the daily pass folds it
        log.warning("calendar-builder: the master record's sync failed (%s)", type(exc).__name__)
        return {"status": 502, "message": f"the master record's sync failed ({type(exc).__name__})"}
    return {"status": 200, "data": out}


async def daily() -> None:
    """The record's daily look at the sheet's side, whatever the keeper said, and the cells it still owes queued again."""
    await asyncio.sleep(60)
    while True:
        try:
            if await _run(cal_builder_master.fold_due, PG_DSN):
                await _run(_fold, True)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - looked at again within the hour
            log.warning("calendar-builder: the master record's daily sync failed (%s)", type(exc).__name__)
        await asyncio.sleep(DAILY_LOOK_S)


ROUTES: tuple[tuple[str, str, Callable[..., Any]], ...] = (
    ("GET", "/hub-lanes/calendar-builder/grid", lane_cal_builder_grid),
    ("POST", "/hub-lanes/calendar-builder/cell", lane_cal_builder_cell),
    ("POST", "/hub-lanes/calendar-builder/apply-requests", lane_cal_builder_apply_requests),
    ("POST", "/hub-lanes/calendar-builder/generate", lane_cal_builder_generate),
    ("POST", "/hub-lanes/calendar-builder/publish", lane_cal_builder_publish),
    ("POST", "/hub-lanes/calendar-builder/publish-houses", lane_cal_builder_publish_houses),
)


def install(app: Any) -> None:
    """The master grid's lanes on main.py's app, after sched_lanes (its gate) and before the relay carrier, and the
    keeper's door to the record's sync."""
    for method, path, fn in ROUTES:
        (app.get if method == "GET" else app.post)(path)(fn)
    app.post("/calendar-builder/master-sync")(master_sync)
    log.info("master grid: answers %s off the master record", ", ".join(p.rsplit("/", 1)[-1] for _m, p, _f in ROUTES))
