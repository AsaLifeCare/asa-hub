"""The live stream, the relay's /events: which slice or board just changed, as it happens, to every open tab — a name,
never a row, the 25-second keepalive between, a hotline name only to a stream whose session passes the Smart Comms
gate, and the stream of a session the sign-in ended closed. Also the relay's /notify (a write happened: its slices are
rebuilt) and the one door the relay's own writers tell this bus through while any of them is still there."""
from __future__ import annotations

import asyncio
import hmac
import logging
import os
import time
from typing import Any, AsyncIterator, Callable

from fastapi import Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

log = logging.getLogger("asa-hub-app.live-events")

PING_S = 25.0
QUEUE_MAX = 64
HOTLINE_STREAM_GATE_TTL_S = 300.0
HOTLINE_STREAM_GATE_RETRY_S = 30.0
HOTLINE_GATE_MAX = 5000
# a stream's end, put on its queue when the session behind it ended
STREAM_END = object()

SUBS: set[asyncio.Queue] = set()
LOOP: list[asyncio.AbstractEventLoop | None] = [None]
# a name told to every stream makes every viewer's kept copy of its boards stale (viewer_cache.rang)
RINGERS: list[Callable[[str], None]] = []
# a viewer back online: its stale kept boards read again before it looks (viewer_cache.online)
ONLINE: list[Callable[[str], None]] = []
# token -> (when, open | shut | retry, how long that holds)
_HOTLINE_GATE: dict[str, tuple[float, str, float]] = {}
_BG: set[asyncio.Task] = set()

# set by live_plane: the front door (sessions), the slices (the dirty marks), the hotline gate, the app token
FD: Any = None
SLICES: Any = None
GATE: Any = None
TOKEN: list[str] = [os.getenv("HUB_APP_TOKEN", "")]


def keep_task(coro: Any) -> asyncio.Task:
    """A task nobody awaits, held until it finishes."""
    task = asyncio.ensure_future(coro)
    _BG.add(task)
    task.add_done_callback(_BG.discard)
    return task


def bearer(authorization: str) -> str:
    return authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""


def _held(token: str) -> Any:
    """The front door's last verdict on this token, however old; None when it holds none."""
    hit = getattr(FD, "_SESSIONS", {}).get(token) if token else None
    return hit[1] if hit is not None else None


def publish(resource: str, *, kept_copy: bool = False) -> None:
    """Tell every open stream that this resource just changed; any thread, never raises, never waits."""
    if not kept_copy:
        for rang in list(RINGERS):
            try:
                rang(resource)
            except Exception:  # noqa: BLE001 - a kept copy's own age still refreshes it
                pass
    loop, subs = LOOP[0], list(SUBS)
    if loop is None or not subs:
        return
    gated = resource.startswith("hotline:")

    def fan() -> None:
        now = time.time()
        for q in subs:
            if gated and not hotline_tag_live(q, now):
                continue
            try:
                q.put_nowait(resource)
            except asyncio.QueueFull:
                pass

    try:
        loop.call_soon_threadsafe(fan)
    except RuntimeError:
        pass


def close_streams_for(token: str) -> int:
    """End every stream this token opened."""
    closed = 0
    for q in list(SUBS):
        if getattr(q, "token", None) != token:
            continue
        try:
            while q.full():
                q.get_nowait()
            q.put_nowait(STREAM_END)
            closed += 1
        except Exception:  # noqa: BLE001 - a stream that will not take it dies with its tab
            pass
    return closed


async def recheck() -> int:
    """The front door forgot verdicts: each open stream whose session the sign-in now says ended is closed (a verdict
    that cannot be read just now keeps its stream)."""
    closed = 0
    for token in sorted({str(getattr(q, "token", "") or "") for q in list(SUBS)} - {""}):
        try:
            s = await FD.session(token)
        except Exception:  # noqa: BLE001 - not told is not ended
            continue
        if s is not None and not s.ok:
            closed += close_streams_for(token)
    return closed


def sessions_forgotten(_gone: frozenset[str] | None = None) -> None:
    """A front_door.SESSIONS_FORGOTTEN listener: the streams' sessions judged again, out of the caller's way."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        loop = LOOP[0]
        if loop is not None:
            try:
                loop.call_soon_threadsafe(lambda: keep_task(recheck()))
            except RuntimeError:
                pass
        return
    keep_task(recheck())


async def hotline_actor(token: str) -> tuple[str, str] | dict[str, Any]:
    """(role, uid) when the session may open Smart Comms, else the refusal envelope (the relay's _hotline_actor)."""
    s = await FD.session(token) if token else None
    if s is None or not s.ok:
        return {"status": 401, "reason": "session", "message": "sign in first"}
    try:
        verdict = await run_in_threadpool(GATE.app_access, s.uid, s.role, GATE.APP_ID, GATE.FRESH_S,
                                          is_master=s.is_master)
    except Exception as exc:  # noqa: BLE001 - a gate that throws stays shut
        log.warning("hotline desk: access check failed: %s", type(exc).__name__)
        return {"status": 403, "reason": "unreadable",
                "message": f"The access check failed ({type(exc).__name__}), so the door stays closed."}
    if not verdict.get("open"):
        return {"status": 403, "reason": str(verdict.get("reason") or "badge"),
                "message": str(verdict.get("why") or "This app is not open to you.")}
    return s.role, s.uid


async def hotline_stream_allowed(token: str) -> tuple[str, float]:
    """This session at the hotline doors' Smart Comms gate, held per token: (open | shut | retry, until when)."""
    now = time.time()
    held = _HOTLINE_GATE.get(token)
    if held and now - held[0] < held[2]:
        hit = _held(token)
        if held[1] != "open" or (hit is not None and hit.ok):
            return held[1], held[0] + held[2]
    try:
        actor = await hotline_actor(token)
    except Exception as exc:  # noqa: BLE001 - a gate that throws stays shut
        log.warning("hotline stream: access check failed: %s", type(exc).__name__)
        actor = {"status": 403, "reason": "unreadable"}
    if not isinstance(actor, dict):
        verdict = "open"
    elif str(actor.get("reason") or "") in ("unreadable", "stale", "session"):
        verdict = "retry"
    else:
        verdict = "shut"
    held_for = HOTLINE_STREAM_GATE_RETRY_S if verdict == "retry" else HOTLINE_STREAM_GATE_TTL_S
    if len(_HOTLINE_GATE) > HOTLINE_GATE_MAX:
        _HOTLINE_GATE.clear()
    at = time.time()
    _HOTLINE_GATE[token] = (at, verdict, held_for)
    return verdict, at + held_for


async def tag_hotline(queue: asyncio.Queue, token: str) -> None:
    """Tag a stream for hotline names while its session passes the gate."""
    queue.hotline_checking = True  # type: ignore[attr-defined]
    try:
        if not token:
            return
        queue.hotline_auth = token  # type: ignore[attr-defined]
        while queue in SUBS:
            verdict, until = await hotline_stream_allowed(token)
            if verdict == "open":
                queue.hotline, queue.hotline_until = True, until  # type: ignore[attr-defined]
                try:
                    queue.put_nowait("hotline:calls")
                except asyncio.QueueFull:
                    pass
                return
            queue.hotline, queue.hotline_until = False, 0.0  # type: ignore[attr-defined]
            if verdict != "retry":
                return
            await asyncio.sleep(max(HOTLINE_STREAM_GATE_RETRY_S, until - time.time()) + 0.05)
    finally:
        queue.hotline_checking = False  # type: ignore[attr-defined]


def hotline_tag_live(queue: Any, now: float) -> bool:
    """May this stream hear a `hotline:` name now?"""
    if getattr(queue, "hotline", False) is not True:
        return False
    token = getattr(queue, "hotline_auth", "")
    hit = _held(token)
    if float(getattr(queue, "hotline_until", 0.0) or 0.0) > now and not (hit is not None and not hit.ok):
        return True
    queue.hotline, queue.hotline_until = False, 0.0
    if token and not getattr(queue, "hotline_checking", False) and queue in SUBS:
        queue.hotline_checking = True
        keep_task(tag_hotline(queue, token))
    return False


async def events(request: Request) -> Response:
    """GET /events — which slice just changed, as it happens."""
    from fastapi.responses import StreamingResponse

    token = bearer(str(request.headers.get("authorization") or ""))
    s = await FD.session(token) if token else None
    if s is None or not s.ok:
        return Response(status_code=401)
    queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)
    queue.hotline = False  # type: ignore[attr-defined]
    queue.hotline_until = 0.0  # type: ignore[attr-defined]
    queue.hotline_auth = token  # type: ignore[attr-defined]
    queue.token = token  # type: ignore[attr-defined]
    SUBS.add(queue)
    keep_task(tag_hotline(queue, token))
    for online in list(ONLINE):
        try:
            online(token)
        except Exception:  # noqa: BLE001 - the kept boards refresh on their own clock
            pass

    async def stream() -> AsyncIterator[bytes]:
        try:
            yield b": open\n\n"
            while True:
                try:
                    resource = await asyncio.wait_for(queue.get(), timeout=PING_S)
                except asyncio.TimeoutError:
                    yield b": ping\n\n"
                    continue
                if resource is STREAM_END:
                    break
                yield f"data: {resource}\n\n".encode()
        finally:
            SUBS.discard(queue)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "Connection": "keep-alive",
                                      "X-Accel-Buffering": "no"})


async def notify(payload: dict[str, Any]) -> dict[str, Any]:
    """POST /notify — a write happened."""
    names = payload.get("resources") or ([payload["resource"]] if payload.get("resource") else [])
    accepted = SLICES.mark_dirty(names)
    return {"accepted": accepted, "rebuild_in": SLICES.DEBOUNCE_SECONDS if accepted else None}


def authorized(request: Request) -> bool:
    return bool(TOKEN[0]) and hmac.compare_digest(str(request.headers.get("x-hub-token") or ""), TOKEN[0])


async def told(request: Request) -> Response:
    """POST /live/publish — the relay's own writers, while any is left there: {resources: [{name, kept_copy}]}."""
    import json

    if not authorized(request):
        return Response(status_code=401)
    try:
        body = json.loads(await request.body() or b"{}")
    except ValueError:
        return Response(status_code=400)
    said = body.get("resources") if isinstance(body, dict) else None
    if not isinstance(said, list):
        return Response(status_code=400)
    n = 0
    for item in said:
        name = item.get("name") if isinstance(item, dict) else item
        if isinstance(name, str) and name.strip():
            publish(name, kept_copy=bool(item.get("kept_copy")) if isinstance(item, dict) else False)
            n += 1
    return Response(content=json.dumps({"published": n}).encode(), media_type="application/json")


def start() -> None:
    """On the serving loop: the builders and the relay's door publish from other threads onto it."""
    LOOP[0] = asyncio.get_running_loop()


def install(app: Any) -> None:
    app.get("/events")(events)
    app.post("/notify")(notify)
    app.post("/live/publish")(told)
