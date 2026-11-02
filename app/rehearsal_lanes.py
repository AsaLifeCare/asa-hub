"""The shift rehearsal's doors (the relay's /hub-lanes/shift-rehearsal, …/answer and …/reset), answered here as the
relay answered them: the reader is Requests' own (sched_lanes), the master's own session alone drives it, and every
board, answer and reset is played in a sealed worker over asa-hub-db's sandbox (shift_rehearsal.py,
rehearsal_sandbox.py). Nothing outside the sandbox is told or woken."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import Request

import sched_lanes as SL
import shift_rehearsal

log = logging.getLogger("asa-hub-app.shift-rehearsal")

PG_DSN = "asa-hub-db"

_REHEARSAL_REFUSED = ("the rehearsal is the master's alone until it is released — "
                      "it plays real people's answers, even inside its own sandbox")


async def _rehearsal_refusal(request: Request) -> dict[str, Any] | None:
    """None for the master's own session, else the refusal envelope; a switched session is the front door's word."""
    s = await SL._session(request)  # noqa: SLF001
    acting = bool(s is not None and s.acting)
    flag = s.is_master if s is not None else None
    if shift_rehearsal.may_drive(flag, acting=acting):
        return None
    if acting:
        return {"status": 403, "reason": "acting",
                "message": "the rehearsal is not driven while acting as another account — press "
                           "Be Back to drive it as yourself"}
    if flag is None:
        return {"status": 403, "reason": "unknown",
                "message": "this session's master check has not been made yet, so the rehearsal "
                           "stays closed — reload the page to make it"}
    return {"status": 403, "reason": "master", "message": _REHEARSAL_REFUSED}


async def _rehearsal_driver(request: Request):
    """(the reader, the session) for a rehearsal door, or its refusal envelope."""
    got = await SL._requests_viewer(request)  # noqa: SLF001
    if isinstance(got, dict):
        return got
    refused = await _rehearsal_refusal(request)
    if refused is not None:
        return refused
    return got


async def lane_shift_rehearsal(request: Request) -> dict[str, Any]:
    """The rehearsal board, read from the sandbox: its copy of the houses, people, shifts and swaps, and what was…"""
    got = await _rehearsal_driver(request)
    if isinstance(got, dict):
        return got
    who, _actor = got
    run, at = SL._q(request, "run"), SL._q(request, "at")  # noqa: SLF001
    try:
        data = await asyncio.to_thread(shift_rehearsal.board, PG_DSN, who=who, run=run, at=at)
    except shift_rehearsal.Refused as exc:
        return {"status": 409, "reason": exc.code, "message": exc.why}
    except shift_rehearsal.Failed as exc:
        return {"status": 502, "message": f"the rehearsal could not be read: {exc}"}
    except Exception as exc:  # noqa: BLE001
        log.warning("shift rehearsal: the board failed (%s)", type(exc).__name__)
        return {"status": 502, "message": f"the rehearsal could not be read ({type(exc).__name__})"}
    return {"status": 200, "data": SL._jsonable([data])[0]}  # noqa: SLF001


async def lane_shift_rehearsal_answer(request: Request) -> dict[str, Any]:
    """One simulated answer, through the door a real one comes through, inside the sandbox."""
    got = await _rehearsal_driver(request)
    if isinstance(got, dict):
        return got
    who, actor = got
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return {"status": 400, "message": "invalid body"}
    fields = {k: str(body.get(k) or "").strip() for k in
              ("run", "door", "act", "location", "open_row", "col_iso", "ref", "person",
               "request_id", "handoff_id", "to_staff", "word", "at", "decider")}
    try:
        row = await asyncio.to_thread(
            shift_rehearsal.answer, PG_DSN, driver=str(who.get("name") or actor[1]),
            door=fields["door"] or "app", act=fields["act"], run=fields["run"],
            location=fields["location"], open_row=fields["open_row"], col_iso=fields["col_iso"],
            ref=fields["ref"], person=fields["person"], request_id=fields["request_id"],
            handoff_id=fields["handoff_id"], to_staff=fields["to_staff"],
            word=fields["word"] or "yes", at=fields["at"], decider=fields["decider"], who=who)
    except shift_rehearsal.Refused as exc:
        return {"status": 409, "reason": exc.code, "message": exc.why, "data": exc.extra}
    except shift_rehearsal.Failed as exc:
        return {"status": 502, "message": f"the rehearsal failed: {exc}"}
    except Exception as exc:  # noqa: BLE001
        log.warning("shift rehearsal: the answer failed (%s)", type(exc).__name__)
        return {"status": 502, "message": f"the rehearsal failed ({type(exc).__name__})"}
    log.info("shift rehearsal: %s by the %s door — %s (%s) driven by %s, inside the sandbox",
             fields["act"], fields["door"] or "app", row.get("outcome"), row.get("code"), actor[1])
    # no real notice, calendar or reader is woken: nothing outside the sandbox changed
    return {"status": 200, "data": SL._jsonable([row])[0]}  # noqa: SLF001


async def lane_shift_rehearsal_reset(request: Request) -> dict[str, Any]:
    """Empty the sandbox of everything played in it and take a fresh copy of the estate."""
    got = await _rehearsal_driver(request)
    if isinstance(got, dict):
        return got
    who, actor = got
    try:
        data = await asyncio.to_thread(shift_rehearsal.reset, PG_DSN, by=str(who.get("name") or actor[1]))
    except shift_rehearsal.Refused as exc:
        return {"status": 409, "reason": exc.code, "message": exc.why}
    except shift_rehearsal.Failed as exc:
        return {"status": 502, "message": f"the reset failed: {exc}"}
    except Exception as exc:  # noqa: BLE001
        log.warning("shift rehearsal: the reset failed (%s)", type(exc).__name__)
        return {"status": 502, "message": f"the reset failed ({type(exc).__name__})"}
    log.info("shift rehearsal: the sandbox was reset by %s (%s answer(s) cleared)", actor[1],
             data.get("cleared"))
    return {"status": 200, "data": SL._jsonable([data])[0]}  # noqa: SLF001


ROUTES: tuple[tuple[str, str, Any], ...] = (
    ("GET", "/hub-lanes/shift-rehearsal", lane_shift_rehearsal),
    ("POST", "/hub-lanes/shift-rehearsal/answer", lane_shift_rehearsal_answer),
    ("POST", "/hub-lanes/shift-rehearsal/reset", lane_shift_rehearsal_reset),
)


def install(app: Any) -> None:
    """The three rehearsal doors on main.py's app, before the relay carrier."""
    for method, path, fn in ROUTES:
        (app.get if method == "GET" else app.post)(path)(fn)
