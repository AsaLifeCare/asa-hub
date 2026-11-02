"""The relay's hotline desk doors, answered here with its gates and words (app/lane_gate.py): GET
/hub-lanes/hotline/calls and /hub-lanes/hotline/call/{id} (app/hotline_calls.py, the calls this app's Quo webhook took
laid over the index), /hub-lanes/hotline/lanes (app/hotline_lanes.py), /hub-lanes/hotline/daily-notes and
/hub-lanes/clients/daily (app/daily_notes.py), every book read off asa-hub-db."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

import daily_notes
import front_door as FD
import hotline_calls as HCALLS
import hotline_desk
import hotline_lanes
import lane_gate as LG

log = logging.getLogger("asa-hub-app.lanes")

APP_ID = "smartcomms"
CLIENTS_APP = "clients"
CLIENTS_LABEL = "Client Care"
# written out here, not borrowed from daily_notes: a reader that failed to import must not turn into an open door
CLIENTS_ROLES_REFUSED = ("client", "guardian", "onboarding", "interviewer")


async def _actor(request: Request, app_id: str = APP_ID, **kw: Any) -> tuple[Any, tuple[str, str] | dict[str, Any]]:
    s = await LG.session(LG.token_of(request))
    return s, await LG.gate(s, app_id, **kw)


def _screening_roles() -> set[str]:
    """The roles the hiring lane serves Phone Screening to: its manifest entry's own list."""
    for entry in FD.load_manifest():
        if entry.get("resource") == "phoneScreens":
            return {str(r).strip().lower() for r in (entry.get("roles") or []) if str(r).strip()}
    return set()


async def _index() -> dict[str, Any]:
    """{index}: the held index, or {refused}: the refusal to say."""
    try:
        return {"index": await HCALLS.current_index()}
    except HCALLS.IndexUnavailable as exc:
        return {"refused": {"status": 503, "reason": "unreadable", "message": str(exc)}}
    except Exception as exc:  # noqa: BLE001
        log.warning("hotline desk: index unavailable: %s", type(exc).__name__)
        return {"refused": {"status": 503, "reason": "unreadable",
                            "message": f"The call index could not be built ({type(exc).__name__})."}}


async def hotline_calls_door(request: Request) -> Response:
    """GET /hub-lanes/hotline/calls: every desk call, newest first, with each source's health beside it."""
    _s, actor = await _actor(request)
    if isinstance(actor, dict):
        return LG.answer(actor)
    await HCALLS.overlay_ready()
    got = await _index()
    if "refused" in got:
        return LG.answer(got["refused"])
    index = got["index"]
    # a copy per answer: the index is shared by every request and every role
    payload = dict(index["payload"])
    withheld = str(actor[0] or "").strip().lower() not in _screening_roles()
    screening_ids: set[str] = set()
    if withheld:
        screening_ids = {str(c.get("call_id")) for c in payload["calls"] if c.get("line_key") == "screening"}
        payload["calls"] = [c for c in payload["calls"] if c.get("line_key") != "screening"]
        payload["version"] = index["version_without_screening"]
    payload["calls"], payload["version"] = HCALLS.overlay_apply(payload["calls"], payload["version"],
                                                                index.get("context"), exclude=screening_ids)
    payload["screening_withheld"] = withheld
    import hotline_fast  # noqa: PLC0415 - the webhook's own module, which imports this one

    payload["hotline_sweep"] = await hotline_fast.sweep_clock()
    payload["fast_path_armed"] = hotline_fast.armed()
    return LG.answer({"status": 200, "data": payload})


async def hotline_call_door(call_id: str, request: Request) -> Response:
    """GET /hub-lanes/hotline/call/{call_id}: one call's words — the two transcript cells of its own rows — and its
    summary."""
    _s, actor = await _actor(request)
    if isinstance(actor, dict):
        return LG.answer(actor)
    call_id = str(call_id or "")
    await HCALLS.overlay_ready()
    got = await _index()
    if "refused" in got:
        return LG.answer(got["refused"])
    index = got["index"]
    where = index["where"].get(call_id)
    if where is None:
        # a call only the hotline webhook knows yet: its words from what the webhook carried
        early = HCALLS.overlay_detail(call_id)
        if early is not None:
            log.info("hotline call read %s by %s", call_id, actor[1])
            return LG.answer({"status": 200, "data": early})
    if where is None or (where.get("line") == HCALLS.SCREENING_LINE
                         and str(actor[0] or "").strip().lower() not in _screening_roles()):
        return LG.answer({"status": 404, "message": "That call is not on the hotline desk."})
    try:
        data = await hotline_desk.run_on_desk(HCALLS.read_call, index, call_id)
    except HCALLS.CallNotFound:
        return LG.answer({"status": 404, "message": "That call is not on the hotline desk."})
    except HCALLS.SourceError as exc:
        return LG.answer({"status": 503, "reason": "unreadable", "message": str(exc)})
    except Exception as exc:  # noqa: BLE001
        log.warning("hotline desk: call %s unreadable: %s", call_id, type(exc).__name__)
        return LG.answer({"status": 503, "reason": "unreadable",
                          "message": f"The call could not be read ({type(exc).__name__})."})
    log.info("hotline call read %s by %s", call_id, actor[1])
    return LG.answer({"status": 200, "data": data})


async def hotline_lanes_door(request: Request) -> Response:
    """GET /hub-lanes/hotline/lanes: the Hotline screen's sheet lanes, behind a short cache."""
    _s, actor = await _actor(request)
    if isinstance(actor, dict):
        return LG.answer(actor)
    name, since = LG.query(request, "name"), LG.query(request, "since")
    try:
        wanted = ((hotline_lanes.lane_named(name),) if str(name or "").strip() else hotline_lanes.LANE_KEYS)
        data = await hotline_lanes.current_lanes(wanted)
    except hotline_lanes.LaneUnknown:
        return LG.answer({"status": 400,
                          "message": "Say which lane: ?name=" + " | ".join(hotline_lanes.LANE_KEYS) + "."})
    except Exception as exc:  # noqa: BLE001 - a lane says it is unreadable itself; this is the rest
        log.warning("hotline lanes: the lanes could not be served: %s", type(exc).__name__)
        return LG.answer({"status": 503, "reason": "unreadable",
                          "message": f"The hotline lanes could not be read ({type(exc).__name__})."})
    if since and str(since).strip() == data["version"]:
        data = hotline_lanes.without_rows(data)
    return LG.answer({"status": 200, "data": data})


async def daily_notes_door(request: Request) -> Response:
    """GET /hub-lanes/hotline/daily-notes: every staff daily note, newest first, with its client, its shift and each
    source's health beside it."""
    _s, actor = await _actor(request)
    if isinstance(actor, dict):
        return LG.answer(LG.refusal(actor))
    try:
        book = await daily_notes.current_book()
    except daily_notes.BookUnavailable as exc:
        return LG.answer({"status": 503, "reason": "unreadable", "message": str(exc)})
    except Exception as exc:  # noqa: BLE001
        log.warning("daily notes: book unavailable: %s", type(exc).__name__)
        return LG.answer({"status": 503, "reason": "unreadable",
                          "message": f"The daily notes could not be read ({type(exc).__name__})."})
    return LG.answer({"status": 200, "data": book["payload"]})


async def clients_daily_door(request: Request) -> Response:
    """GET /hub-lanes/clients/daily?client=: the staff daily notes matched to one client, for the client's record."""
    s, actor = await _actor(request, CLIENTS_APP, refuse_roles=CLIENTS_ROLES_REFUSED, app_label=CLIENTS_LABEL)
    if isinstance(actor, dict):
        return LG.answer(LG.refusal(actor))
    try:
        refusal = await run_in_threadpool(LG.in_reads, lambda reads: daily_notes.types_refusal(
            reads.users(), actor[1], is_master=LG.is_master(s)))
    except Exception as exc:  # noqa: BLE001 - a check that throws stays shut
        log.warning("daily notes: types check failed: %s", type(exc).__name__)
        return LG.answer({"status": 403, "reason": "unreadable",
                          "message": f"The access check failed ({type(exc).__name__}), so the door stays closed."})
    if refusal is not None:
        return LG.answer(LG.refusal(refusal))
    wanted = " ".join(LG.query(request, "client").split())
    if not wanted:
        return LG.answer({"status": 400, "message": "Say which client: ?client=<the client's name>."})
    try:
        book = await daily_notes.current_book()
        data = daily_notes.client_view(book, wanted)
    except daily_notes.ClientNotFound:
        return LG.answer({"status": 404, "message": "That client is not in the clients list."})
    except daily_notes.BookUnavailable as exc:
        return LG.answer({"status": 503, "reason": "unreadable", "message": str(exc)})
    except Exception as exc:  # noqa: BLE001
        log.warning("daily notes: client view unavailable: %s", type(exc).__name__)
        return LG.answer({"status": 503, "reason": "unreadable",
                          "message": f"The daily notes could not be read ({type(exc).__name__})."})
    log.info("client daily notes read: %d note(s) by %s", len(data["notes"]), actor[1])
    return LG.answer({"status": 200, "data": data})


def install(app: Any) -> list[str]:
    """These doors on main.py's app, matched before the relay carrier."""
    app.get("/hub-lanes/hotline/calls")(hotline_calls_door)
    app.get("/hub-lanes/hotline/call/{call_id}")(hotline_call_door)
    app.get("/hub-lanes/hotline/lanes")(hotline_lanes_door)
    app.get("/hub-lanes/hotline/daily-notes")(daily_notes_door)
    app.get("/hub-lanes/clients/daily")(clients_daily_door)
    taken = ["hotline/calls", "hotline/call/{id}", "hotline/lanes", "hotline/daily-notes", "clients/daily"]
    log.info("hotline doors: answered here: %s", ", ".join(taken))
    return taken
