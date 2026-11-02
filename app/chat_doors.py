"""The chat's live doors, the relay's (server/snapshot_service.py) answered here with the same paths, statuses, headers
and words: the shell's stream (/chat/stream) and beat (/chat/beat), live chat's ticket (/chat/ticket) and the live
hub's own doors (/chat/ticket/redeem, /chat/exec, /chat/refs, /chat/gate, keyed X-Hub-Chat-Key), the chat page's six
actions on /gas (a front door rung), and the cortex chat (/cortex/chat/send, /cortex/chat/dialogs[/<id>],
/cortex/chat/voice/transcribe|speak). With them the machinery behind them: the refs and tickets, the chat cache, the
sends kept here first and written behind (each on disk under its own folder), and the push of a message to someone
with nothing open, planned and delivered here (web_push: the devices and the keys).

Every bearer is judged by the front door's verdict (front_door.session). The chat itself is app/chat.py, asked
in-process (main._run_chat). The company notices' frames (app/notice_clock.py) and the strip's hub frame
(app/hub_strip.py) are made here too."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

import chat_live
import chat_push
import front_door

log = logging.getLogger("asa-hub-app.chat-doors")

CHAT_KEY = chat_live.derive_key(os.getenv("HUB_SERVICE_SECRET", ""))
PING_S = 25.0
QUEUE_MAX = 32
# what a session minted from the master's own may not do here, in the words the pages read
SWITCHED_CHAT = {"status": 409, "code": "be_another_refused", "reason": "acting",
                 "message": "Chat is off while acting as someone else. Press Be Back to chat as yourself."}
SWITCHED_POST = {"status": 409, "code": "be_another_refused",
                 "message": "Not in a switched session: this door cannot take the write. "
                            "Press Be Back to do this as yourself."}
VISIT = "Live chat answers the signed-in account only; it is not opened inside a visit."
ROLES_REFUSED = ("onboarding", "interviewer")
UNNARROWED = {"status": 503, "reason": "narrowing",
              "message": "Live chat is not open to this account yet: the chat that shows it only its own people has "
                         "not been published."}
NOT_LISTED = {"status": 404, "reason": "circle", "message": "Not found."}

# the chat page's actions, answered by app/chat.py as the session the front door verified
PY_ACTIONS = frozenset({"chatOverview", "chatMessages", "chatSend", "chatReact", "chatMarkRead", "chatPing"})
PY_WRITES = frozenset({"chatSend", "chatReact", "chatMarkRead"})
PY_TIMEOUT_S = float(os.getenv("HUB_CHAT_PYTHON_TIMEOUT_S", "8"))
UNREAD = {"status": 503, "message": "The chat could not be read just now. Try again in a moment."}
UNSENT = {"status": 503, "message": "The chat could not be reached just now, and nothing was sent. Try again in a "
                                    "moment."}
AWAY = {"status": 409, "message": "The chat is read from your own workspace — not on a visit, in a world or at another "
                                  "place."}
UNREADABLE = {"status": 400, "message": "The request could not be read."}
AUTH_REQUIRED = {"status": 401, "message": "Authentication required."}

# the beat: how long a person may go without the chat learning they are here
BEAT_DUE_S = 4 * 60.0
STAMPS_PRESENCE = ("chatPing", "chatOverview", "chatReact", "chatMarkRead")
SETTLES_UNREAD = ("chatPing", "chatMarkRead")
NOTICES_TTL_S = float(os.getenv("HUB_CHAT_NOTICES_TTL_S", "5"))

FRAME_GATE = "gate_chat_live_frame"
FRAME_GATE_TTL_S = 30.0

PACKS_DIR = os.getenv("HUB_APP_PACK_DIR", "/srv/app-packs").strip()
# the relay keeps its own in these: never shared by two processes
RELAY_DIRS = ("/srv/app-packs/chat", "/srv/app-packs/chat-behind")
CACHE_DIR = os.getenv("HUB_APP_CHAT_CACHE_DIR", "/srv/app-packs/app-chat").strip()
CACHE_FLUSH_S = 1.0
CACHE_EXPIRE_EVERY = 60
CACHE_REFRESHES = 2
BEHIND_DIR = os.getenv("HUB_APP_CHAT_BEHIND_DIR", "/srv/app-packs/app-chat-behind").strip()
BEHIND_READS = ("chatMessages", "chatOverview", "chatPing")

# the cortex is retired (2026-10-27; it ran on the old platform, which is shut down): no address is asked, so the send
# and the voice answer RETIRED, and the transcripts stay readable here (app.asa_cortex_dialog_messages)
CORTEX_URL = ""
CORTEX_KEY = ""
RETIRED = {"status": 410, "reason": "retired",
           "message": "The cortex is retired: it ran on the old platform, which is shut down. Your past conversations "
                      "are kept here."}
CORTEX_TIMEOUT = float(os.getenv("HUB_CORTEX_TIMEOUT", "120"))
CORTEX_DIALOG_MAX = 60
CORTEX_TURN_MAX = 400
CORTEX_TITLE_CHARS = 90

_END = object()
_TASKS: set[asyncio.Future] = set()
_LOOP: dict[str, Any] = {"loop": None}
# the strip's current hub frame (app/hub_strip.py), and its phase (X-Hub-Phase)
_HUB: dict[str, str] = {"frame": "", "phase": ""}
# told each stream a session that is not switched opens, and that session's verdict (app/notice_clock.py)
ON_OPEN: list[Any] = []


class _Sub(asyncio.Queue):
    """One open chat stream: whose session, and which frames it asked for."""

    def __init__(self, token: str, uid: str, *, notices: bool, strip: bool, switched: bool) -> None:
        super().__init__(maxsize=QUEUE_MAX)
        self.token, self.uid = token, uid
        self.notices, self.strip, self.switched = notices, strip, switched
        self.hub_sent = ""


_subs: dict[str, set[_Sub]] = {}
# uid -> when a real chat read last stamped them present; -> when the browser last beat at all
_beat_at: dict[str, float] = {}
_presence_seen: dict[str, float] = {}
# uid -> the `at` of the newest send for them since they last said they read it
_dirty: dict[str, str] = {}
# a switched session's own clock, by token: it never settles the account's flags
_switched_beat_at: dict[str, float] = {}
_FRAME: dict[str, Any] = {"at": 0.0, "held": None, "busy": False}
_NOTICES: dict[str, Any] = {"at": 0.0, "id": None, "busy": False}


def _main() -> Any:
    return front_door.M


def _keep_task(coro: Any) -> asyncio.Future:
    task = asyncio.ensure_future(coro)
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    return task


def _start() -> None:
    """The first door asked on a loop starts what runs behind the doors: the hub's hello, the cache, the kept sends."""
    loop = asyncio.get_running_loop()
    if _LOOP["loop"] is loop:
        return
    _LOOP["loop"] = loop
    _keep_task(_hello())
    _keep_task(_cache_start())
    _keep_task(_behind_start())


def _bearer(authorization: str) -> str:
    return authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""


async def _session(token: str) -> Any:
    return await front_door.session(token) if token else None


def _stamp(headers: dict[str, str]) -> dict[str, str]:
    """The relay's X-Hub-Phase on every answer, while its phase is known here."""
    return {**headers, "X-Hub-Phase": _HUB["phase"]} if _HUB["phase"] else headers


def _answer(env: dict[str, Any], http: int | None = None) -> JSONResponse:
    return JSONResponse(env, status_code=int(http or env.get("status") or 200),
                        headers=_stamp({"Cache-Control": "no-store"}))


def _said(env: dict[str, Any], status: int | None = None) -> Response:
    return Response(content=json.dumps(env), status_code=int(status or env.get("status") or 200),
                    media_type="application/json", headers=_stamp({}))


def _switched_post(s: Any) -> Response | None:
    """A POST that carries a switched session's bearer is refused before any door, as the relay's own doors were."""
    if s is None or not s.ok or not s.acting:
        return None
    return Response(content=json.dumps(SWITCHED_POST).encode(), status_code=409, media_type="application/json",
                    headers=_stamp({}))


async def _body(request: Request) -> dict[str, Any] | None:
    try:
        raw = await request.body()
        body = json.loads(raw) if raw.strip() else {}
    except Exception:  # noqa: BLE001
        return None
    return body if isinstance(body, dict) else None


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso(text: str) -> datetime | None:
    try:
        got = datetime.fromisoformat(str(text or "").replace("Z", "+00:00"))
    except ValueError:
        return None
    return got if got.tzinfo else got.replace(tzinfo=timezone.utc)


# ---- the frame gate: words reach the other end before the chat has them only while it is open ---------------------

def _frame_read() -> bool:
    """lane_gate.holds(CHAT_FRAME): armed in Smart Comms and the send switch on; an unreadable gate is not armed."""
    import config_lane  # noqa: PLC0415 - main.py's own modules, loaded with it
    import locations as L  # noqa: PLC0415

    m = _main()
    reads = L.Reads(m.DB, m.DRIVE)
    try:
        armed = config_lane.situation_switches(reads, [FRAME_GATE]).get(FRAME_GATE) is True
    except Exception:  # noqa: BLE001 - an unreadable lane holds only the doors that reach a person
        armed = False
    if not armed:
        return False
    try:
        return bool(config_lane.test_mode(reads.config()).get("on"))
    except Exception:  # noqa: BLE001 - a switch that cannot be read holds
        return True


async def _frame_refresh() -> None:
    if _FRAME["busy"] or time.monotonic() - _FRAME["at"] < FRAME_GATE_TTL_S:
        return
    _FRAME["busy"] = True
    try:
        _FRAME["held"] = await asyncio.to_thread(_frame_read)
    except Exception:  # noqa: BLE001 - a gate that cannot answer holds
        _FRAME["held"] = True
    finally:
        _FRAME["at"], _FRAME["busy"] = time.monotonic(), False


def _frame_held() -> bool:
    held = _FRAME["held"]
    return True if held is None else bool(held)


# ---- the users copy the folds, the names and the homes come from --------------------------------------------------

def _fold_rows() -> list[dict[str, Any]]:
    import locations as L  # noqa: PLC0415

    m = _main()
    return list(L.Reads(m.DB, m.DRIVE).users())


_fold = chat_live.FoldCache(_fold_rows)
_refs = chat_live.Registry()
_unsettled = chat_live.Unsettled()
_feed = chat_live.Feed(CHAT_KEY)
# live chat's own slots: the chat and every other door never starve each other
_slots = asyncio.Semaphore(chat_live.EXEC_CONCURRENCY)
_by_action: dict[str, int] = {}


def _emit(event: dict[str, Any], tries: int = 1) -> None:
    """One event to the hub, out of everyone's way; nothing without a loop or a key."""
    if not _feed.enabled:
        return
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return
    _keep_task(_feed.send(event, tries=tries))


def _revoke(token: str) -> None:
    """A session that ended: its refs are forgotten here and the hub closes their connections."""
    if not token:
        return
    refs = _refs.revoke_token(token)
    if refs:
        _emit({"kind": "revoke", "refs": refs}, tries=chat_live.REVOKE_TRIES)


async def _hello() -> None:
    """After a start the hub's tabs hold refs this process never minted: they are asked to re-ticket."""
    if not _feed.enabled:
        return
    for wait in (5.0, 30.0, 120.0):
        await asyncio.sleep(wait)
        if await _feed.send({"kind": "hello"}):
            return


# ---- the streams ---------------------------------------------------------------------------------------------------

def _publish(uid: str, line: str) -> None:
    """Wake this person's open tabs. Never blocks, never raises."""
    for q in list(_subs.get(uid) or ()):
        try:
            q.put_nowait(line)
        except asyncio.QueueFull:
            pass


def _end_streams(token: str) -> int:
    """End every chat stream this token opened."""
    closed = 0
    for subs in list(_subs.values()):
        for q in list(subs):
            if q.token != token:
                continue
            try:
                while q.full():
                    q.get_nowait()
                q.put_nowait(_END)
                closed += 1
            except Exception:  # noqa: BLE001 - a stream that will not take it dies with its tab
                pass
    return closed


async def _session_gone(token: str) -> bool:
    """A fresh verdict on this token: True only when the sign-in says it ended."""
    try:
        s = await run_in_threadpool(front_door.verdict, token)
    except Exception:  # noqa: BLE001 - not told is not ended
        return False
    return s is not None and not s.ok


async def chat_stream(request: Request) -> Response:
    """Messages as they are sent, instead of a browser asking every 20 seconds."""
    from fastapi.responses import StreamingResponse  # noqa: PLC0415 - the in-process runner has no streaming

    _start()
    authorization = str(request.headers.get("authorization") or "")
    token = _bearer(authorization)
    s = await _session(token)
    if s is None or not s.ok:
        return Response(status_code=401, headers=_stamp({}))
    if not s.uid:
        # no name, no routing
        return Response(status_code=503, headers=_stamp({}))
    sub = _Sub(token, s.uid, notices=str(request.headers.get("x-hub-notices") or "").strip() == "1",
               strip=str(request.headers.get("x-hub-strip") or "").strip() == "1", switched=bool(s.acting))
    if not sub.switched:
        for told in list(ON_OPEN):
            try:
                told(sub, s)
            except Exception:  # noqa: BLE001 - a listener never costs the stream
                pass

    async def stream() -> Any:
        _subs.setdefault(sub.uid, set()).add(sub)
        try:
            yield b": open\n\n"
            # the phase at once, so a reconnect never waits for the next change
            if sub.strip and _HUB["frame"]:
                sub.hub_sent = _HUB["frame"]
                yield f"data: {sub.hub_sent}\n\n".encode()
            while True:
                try:
                    line = await asyncio.wait_for(sub.get(), timeout=PING_S)
                except asyncio.TimeoutError:
                    # a tab that draws the strip is kept alive by the current hub frame
                    if sub.strip and _HUB["frame"]:
                        sub.hub_sent = _HUB["frame"]
                        yield f"data: {sub.hub_sent}\n\n".encode()
                    else:
                        yield b": ping\n\n"
                    continue
                if line is _END:
                    break
                yield f"data: {line}\n\n".encode()
        finally:
            subs = _subs.get(sub.uid)
            if subs is not None:
                subs.discard(sub)
                if not subs:
                    _subs.pop(sub.uid, None)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers=_stamp({"Cache-Control": "no-store", "Connection": "keep-alive",
                                             "X-Accel-Buffering": "no"}))


def _sessions_forgotten(gone: frozenset[str] | None) -> None:
    """front_door dropped held verdicts: the streams and refs of those accounts (or all) are judged again."""
    loop = _LOOP["loop"]
    if loop is None:
        return
    try:
        loop.call_soon_threadsafe(lambda: _keep_task(_rejudge(gone)))
    except RuntimeError:
        pass


async def _rejudge(gone: frozenset[str] | None) -> None:
    tokens = {q.token for subs in list(_subs.values()) for q in list(subs) if gone is None or q.uid in gone}
    held = _refs._refs  # noqa: SLF001 - the registry's own entries, read for their sessions
    tokens |= {e["token"] for e in list(held.values())
               if gone is None or str((e.get("ident") or {}).get("account_id") or "") in gone}
    room = asyncio.Semaphore(4)

    async def one(token: str) -> None:
        async with room:
            s = await _session(token)
        if s is not None and not s.ok:
            _end_streams(token)
            _revoke(token)

    await asyncio.gather(*(one(t) for t in tokens if t), return_exceptions=True)


# ---- the beat ------------------------------------------------------------------------------------------------------

def _switched_dirty(since: str | None, last: float) -> bool:
    """Whether a message waits that the switched tab has not pinged for since `last`."""
    if since is None:
        return False
    parsed = _iso(since)
    if parsed is None:
        return last == 0.0
    return parsed.timestamp() > last


def _notices_read() -> int | None:
    """The newest company notice id in the relay's own table in asa-hub-db; 0 for none, None when not readable."""
    import mw_relay_state  # noqa: PLC0415

    if not mw_relay_state.moved():
        return None
    got = _main().CHAT_STORE.run(lambda c: c.execute("select max(id) from app.asa_hub_notices").fetchone())
    return int(got[0]) if got and got[0] is not None else 0


async def _notices_refresh() -> None:
    _NOTICES["busy"] = True
    try:
        _NOTICES["id"] = await asyncio.to_thread(_notices_read)
    except Exception as exc:  # noqa: BLE001 - null is "ask", never "none"
        log.info("chat beat: the newest notice could not be read (%s)", type(exc).__name__)
    finally:
        _NOTICES["at"], _NOTICES["busy"] = time.monotonic(), False


def _notices_latest() -> int | None:
    if not _NOTICES["busy"] and time.monotonic() - _NOTICES["at"] >= NOTICES_TTL_S:
        _keep_task(_notices_refresh())
    return _NOTICES["id"]


async def _name_of(uid: str) -> str:
    if _fold.known() and not _fold.stale():
        return _fold.peek_name(uid)
    return await asyncio.to_thread(_fold.name_of, uid)


async def chat_beat(request: Request) -> Response:
    """The shell's heartbeat, answered from memory."""
    _start()
    token = _bearer(str(request.headers.get("authorization") or ""))
    s = await _session(token)
    if s is None or not s.ok:
        return Response(status_code=401, headers=_stamp({}))
    me = s.uid
    if not me:
        return JSONResponse({"ok": False, "due": True}, headers=_stamp({}))
    now = time.time()
    switched = bool(s.acting)
    if not switched:
        _presence_seen[me] = now
    if switched:
        last = _switched_beat_at.get(token, 0.0)
        dirty = _switched_dirty(_dirty.get(me) if me in _dirty else None, last)
    else:
        last = _beat_at.get(me, 0.0)
        dirty = me in _dirty
    due = dirty or (now - last) >= BEAT_DUE_S
    return JSONResponse({
        "ok": True,
        "me": me,
        "me_name": await _name_of(me),
        "due": bool(due),
        "dirty": bool(dirty),
        "live": any(not q.switched for q in (_subs.get(me) or ())),
        "since": _dirty.get(me, ""),
        "notices": _notices_latest(),
    }, headers=_stamp({}))


# ---- what a chat answer tells the streams, the beat, the hub, the cache and the push --------------------------------

def _observe_chat(action: str, payload: dict[str, Any], answer: dict[str, Any], me: str) -> None:
    """A message just landed: tell the recipient, and this sender's other tabs."""
    try:
        if _frame_held() or action not in ("chatSend", "chatReact") or answer.get("status") != 200:
            return
        data = answer.get("data") if isinstance(answer.get("data"), dict) else {}
        to_user = str(payload.get("to_user") or data.get("to_user") or "")
        at = str(data.get("created_at") or "")
        line = json.dumps({"kind": action, "thread_key": str(data.get("thread_key") or ""), "from_user": me,
                           "at": at}, separators=(",", ":"))
        if to_user:
            _publish(to_user, line)
            # remembered for the tab that is not streaming
            if action == "chatSend":
                _dirty[to_user] = at or _iso_now()
        # the sender's other tabs: a message typed on the laptop appears on the phone
        if me:
            _publish(me, line)
    except Exception:  # noqa: BLE001 - a bonus, never a failure mode
        pass


def _observe_read(action: str, answer: dict[str, Any], token: str, me: str, switched: bool) -> None:
    """A real chat answer: the beat may stop asking for one."""
    if action not in STAMPS_PRESENCE or answer.get("status") != 200:
        return
    # a switched session stamps no presence and reads nothing for the account: its flags stay
    if switched:
        _switched_beat_at[token] = time.time()
        return
    if not me:
        return
    _beat_at[me] = time.time()
    if action in SETTLES_UNREAD:
        _dirty.pop(me, None)


def _observed(raw: bytes, content: bytes, s: Any, source: str) -> None:
    """A chat write that landed outside the hub (the chat page's /gas): the hub nudges both ends."""
    _cache_observed(raw, content, s)
    if not _feed.enabled or b"chat" not in raw[:4096]:
        return
    token, uid = str(chat_live.chat_envelope(raw).get("token") or ""), str(getattr(s, "uid", "") or "")
    try:
        event = chat_live.observed_event(raw, content, token_user=lambda t: uid if t == token else "", held=False,
                                         source=source)
        if event is None:
            return
        if event["kind"] == "nudge":
            event["held"] = _frame_held()
    except Exception:  # noqa: BLE001 - observation, never a failure mode
        return
    _emit(event)


def _unanswered(raw: bytes, s: Any, delays: tuple[float, ...]) -> None:
    """A send answered `accepted` without its receipt: both ends are nudged after a while."""
    _cache_observed(raw, None, s)
    if not _feed.enabled or not delays or b"chat" not in raw[:4096]:
        return
    token, uid = str(chat_live.chat_envelope(raw).get("token") or ""), str(getattr(s, "uid", "") or "")
    try:
        event = chat_live.unanswered_event(raw, token_user=lambda t: uid if t == token else "", source="gas")
    except Exception:  # noqa: BLE001
        return
    if event is None:
        return

    async def later() -> None:
        waited = 0.0
        for at in sorted(delays):
            await asyncio.sleep(max(0.0, at - waited))
            waited = max(waited, at)
            await _frame_refresh()
            await _feed.send({**event, "held": _frame_held()})

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return
    _keep_task(later())


# ---- the chat, asked in-process --------------------------------------------------------------------------------------

def _user_of(s: Any) -> dict[str, Any]:
    """The identity app/chat.py is told: a switched session says so, is never the master, and leaves no line."""
    user = {"uid": s.uid, "role": str(s.role or "").strip().lower(), "is_master": bool(s.master)}
    if s.acting:
        user = {**user, "acting": True, "unlogged": True, "is_master": False}
    return user


async def _ask(env: dict[str, Any], payload: dict[str, Any],
               timeout: float = PY_TIMEOUT_S) -> tuple[dict[str, Any] | None, str]:
    """(envelope, '') from app/chat.py; (None, why) when a write was asked and not answered, so it may still have
    landed (its write id settles it)."""
    action = str(env.get("action") or "")
    write = action in PY_WRITES
    s = await _session(str(env.get("token") or ""))
    if s is None or not s.ok or not s.uid:
        return dict(AUTH_REQUIRED), ""
    # a switched session reads the person's conversations as the chat lets it, and writes nothing in them
    if s.acting and write:
        return dict(SWITCHED_CHAT), ""
    if any(str(env.get(k) or "").strip() for k in ("member", "world", "tenant")):
        return dict(AWAY), ""
    wid = str(env.get("write_id") or "") if write else ""
    why = ""
    try:
        resp = await asyncio.wait_for(run_in_threadpool(_main()._run_chat, action, _user_of(s), payload, wid),
                                      timeout=max(1.0, min(PY_TIMEOUT_S, timeout)))
    except asyncio.TimeoutError:
        why = "ReadTimeout"
    except Exception as exc:  # noqa: BLE001 - said; never handed anywhere else
        why = type(exc).__name__
    else:
        got = None
        if resp.status_code != 200:
            try:
                said = str((json.loads(bytes(resp.body or b"")) or {}).get("defer") or "")
            except Exception:  # noqa: BLE001
                said = ""
            why = f"it deferred {resp.status_code}: {said[:120]}"
        else:
            try:
                got = json.loads(bytes(resp.body or b""))
            except ValueError:
                got = None
            if isinstance(got, dict) and isinstance(got.get("status"), int):
                return got, ""
            why = "another shape"
    log.info("chat: %s not answered by Python — %s", action, why)
    if write and not why.startswith("it deferred"):
        return None, why
    return dict(UNSENT if write else UNREAD), ""


async def _live_post(raw: bytes, timeout: float) -> tuple[str, bytes]:
    """One chat action asked on live chat's own slots: (json | connect | timeout | error, body)."""
    began = time.monotonic()
    try:
        await asyncio.wait_for(_slots.acquire(), timeout=max(0.1, timeout))
    except asyncio.TimeoutError:
        return "connect", b""
    left = timeout - (time.monotonic() - began)
    if left < chat_live.MIN_POST_S:
        _slots.release()
        return "connect", b""
    try:
        env = chat_live.chat_envelope(raw)
        payload = env.get("payload") if isinstance(env.get("payload"), dict) else {}
        answer, _why = await asyncio.wait_for(_ask(env, payload, left), timeout=left)
    except asyncio.TimeoutError:
        return "timeout", b""
    except Exception:  # noqa: BLE001 - it left, and nobody knows how it ended
        return "error", b""
    finally:
        _slots.release()
    if answer is None:
        return "timeout", b""
    return "json", json.dumps(answer).encode()


# ---- the chat page's six actions on /gas ---------------------------------------------------------------------------

async def gas_rung(env: dict[str, Any], raw: bytes, request: Any) -> Response:
    """A chat action from /gas (the chat page, the shell's heartbeat), answered by app/chat.py, then told everywhere:
    the streams, the beat, live chat, the cache and the push."""
    _start()
    await _frame_refresh()
    action = str(env.get("action") or "")
    payload = chat_live.clean_payload(action, env.get("payload"))
    if "reason" in payload:
        return _said(payload, 200)
    env = dict(env)
    if action in PY_WRITES and not re.fullmatch(r"[A-Za-z0-9_.:\-]{8,80}", str(env.get("write_id") or "")):
        env["write_id"] = "W" + hashlib.sha256(raw + str(time.time_ns()).encode()).hexdigest()[:24]
    form = chat_live.form(env)
    s = front_door.held_session(str(env.get("token") or ""))
    answer, _why = await _ask(env, payload)
    s = s or front_door.held_session(str(env.get("token") or ""))
    if answer is None:
        # sent, outcome unknown: both ends are nudged to read again
        _push_unanswered(form, s)
        _unanswered(form, s, chat_live.UNANSWERED_NUDGE_S)
        return _said({"status": 200, "data": {"accepted": True, "confirmed": False}}, 200)
    content = json.dumps(answer).encode()
    if answer.get("status") == 200 and s is not None:
        raw_payload = env.get("payload") if isinstance(env.get("payload"), dict) else {}
        _observe_chat(action, raw_payload, answer, s.uid)
        _observe_read(action, answer, str(env.get("token") or ""), s.uid, bool(s.acting))
        _observed(form, content, s, "gas")
        _push_observed(form, content, s=s)
    if action in BEHIND_READS:
        content = _behind_gas_read(form, content, s)
    return Response(content, media_type="application/json", headers=_stamp({}))


# ---- live chat's ticket, and the hub's doors -----------------------------------------------------------------------

def _access(s: Any) -> dict[str, Any]:
    """{open, reason, why}: App Control's row for live chat (badgeAllowsApp and its containment), as the relay's gate
    decides it (lane_gate.app_access); FAIL-CLOSED. The master's own session is never narrowed."""
    import lane_gate as LG  # noqa: PLC0415

    return LG.in_reads(lambda reads: LG.app_access(reads, s.uid, s.role, chat_live.APP_ID, master=s.master,
                                                   refuse_roles=ROLES_REFUSED, app_label=chat_live.APP_LABEL))


async def chat_ticket(request: Request) -> Response:
    """A ticket the live chat hub redeems within a minute; the session token stays in this process."""
    _start()
    token = _bearer(str(request.headers.get("authorization") or ""))
    s = await _session(token)
    refused = _switched_post(s)
    if refused is not None:
        return refused
    if not token:
        return _answer(chat_live.refusal(401, "session", "sign in first"))
    body = await _body(request)
    if body is None:
        return _answer(chat_live.refusal(400, "body", "The body could not be read."))
    query = dict(request.query_params)
    if str(query.get("member") or "").strip() or chat_live.has_refused_field(body, query):
        return _answer(chat_live.refusal(400, "member", VISIT))
    if s is None or not s.ok or not s.uid:
        return _answer(chat_live.refusal(401, "session", "This session could not be confirmed."))
    if s.acting:
        return _answer(dict(SWITCHED_CHAT))
    try:
        gate = await asyncio.to_thread(_access, s)
    except Exception as exc:  # noqa: BLE001 - a gate that throws stays shut
        log.warning("live chat: access check failed: %s", type(exc).__name__)
        gate = {"open": False, "reason": "unreadable",
                "why": f"The access check failed ({type(exc).__name__}), so the door stays closed."}
    if not gate.get("open"):
        return _answer(chat_live.refusal(403, str(gate.get("reason") or "badge"),
                                         str(gate.get("why") or "Live chat is not open to you.")))
    tenant = str(request.headers.get("x-hub-tenant") or "").strip()
    if not chat_live.TENANT_RE.fullmatch(tenant):
        return _answer(chat_live.refusal(400, "tenant", "That place cannot be read."))
    person, folds = await asyncio.to_thread(_fold.identity, s.uid)
    ident = {"account_id": s.uid, "person_id": person or s.uid, "fold_ids": folds or [s.uid],
             "name": await asyncio.to_thread(_fold.name_of, s.uid), "is_master": bool(s.master),
             "narrowed": chat_live.narrowed(s.role)}
    ticket = _refs.mint(token, tenant, ident)
    return _answer({"status": 200, "data": {"ticket": ticket, "expires_in": int(chat_live.TICKET_TTL_S)}})


async def _switched_token(token: str) -> bool:
    s = await _session(token)
    return bool(s is not None and s.ok and s.acting)


async def chat_ticket_redeem(request: Request) -> Response:
    """The hub's: a ticket's ref and whose it is. Never the session token."""
    _start()
    if not chat_live.key_ok(str(request.headers.get("x-hub-chat-key") or ""), CHAT_KEY):
        return _answer(chat_live.refusal(401, "key", "This door is the live chat hub's."))
    body = await _body(request)
    if body is None:
        return _answer(chat_live.refusal(400, "body", "The body could not be read."))
    got = _refs.redeem(str(body.get("ticket") or ""))
    if got is None:
        return _answer(chat_live.refusal(401, "ticket", "That ticket is expired, used up or unknown."))
    entry = _refs.lookup(got["ref"])
    if entry is None:
        return _answer(chat_live.refusal(401, "ref_unknown", "That session is not known here."))
    if await _switched_token(entry["token"]):
        _revoke(entry["token"])
        return _answer(dict(SWITCHED_CHAT))
    _push_seen(got.get("fold_ids"))
    return _answer({"status": 200, "data": got})


def _rail_kept(ref: str, answer: dict[str, Any]) -> dict[str, Any]:
    """A narrowed ref's rail, carried only as the chat marked it; the ids it names are kept for the ref."""
    if "reason" in answer or answer.get("status") != 200:
        return answer
    got = chat_live.narrow_overview(answer.get("data"))
    if got is None:
        _refs.set_listed(ref, None)
        return dict(UNNARROWED)
    _refs.set_listed(ref, got[1])
    return {**answer, "data": got[0]}


async def _narrowed_exec(req: dict[str, Any], entry: dict[str, Any], raw: bytes, write_id: str) -> dict[str, Any]:
    """A client's or a guardian's action: nothing leaves for a person its last marked rail did not name."""
    ref, action = req["ref"], req["action"]
    if action != "chatOverview" and _refs.listed(ref) is None:
        first_raw = chat_live.form(chat_live.envelope(entry["token"], entry["tenant"], "chatOverview", {}))
        first = _rail_kept(ref, await _live_run(ref, entry, "chatOverview", {}, first_raw))
        if "reason" in first or first.get("status") != 200:
            return first
    if action != "chatOverview":
        who = chat_live.person_in(action, req["payload"])
        if who and who not in (_refs.listed(ref) or frozenset()):
            return dict(NOT_LISTED)
    answer = await _live_run(ref, entry, action, req["payload"], raw, write_id)
    return _rail_kept(ref, answer) if action == "chatOverview" else answer


async def chat_exec(request: Request) -> Response:
    """The hub's: one chat action as the ref's session, in the ref's tenant — never a visit."""
    _start()
    if not chat_live.key_ok(str(request.headers.get("x-hub-chat-key") or ""), CHAT_KEY):
        return _answer(chat_live.refusal(401, "key", "This door is the live chat hub's."))
    await _frame_refresh()
    body = await _body(request)
    req = chat_live.exec_request(body) if body is not None else chat_live.refusal(400, "body", "Unreadable body.")
    if "reason" in req:
        return _answer(req, http=200)
    entry = _refs.lookup(req["ref"])
    if entry is None:
        return _answer(chat_live.refusal(
            401, "ref_unknown", "This live chat session is not known here; ask for a new ticket."), http=200)
    token = entry["token"]
    if await _switched_token(token):
        _revoke(token)
        return _answer(dict(SWITCHED_CHAT), http=200)
    action = req["action"]
    ident = entry["ident"]
    _push_seen(ident.get("fold_ids"))
    write_id = (chat_live.write_id_for(str(ident.get("account_id") or ""), req["client_id"])
                if action in chat_live.WRITES else "")
    raw = chat_live.form(chat_live.envelope(token, entry["tenant"], action, req["payload"], write_id))
    if action == "chatSend" and not ident.get("narrowed"):
        # kept here first: answered now, told to both ends now, written behind
        kept = await _behind_keep(token=token, tenant=entry["tenant"], ident=ident, payload=req["payload"],
                                  write_id=write_id, client_id=req["client_id"], source="hub")
        if kept is not None:
            return _answer({**kept, "frame_held": _frame_held()}, http=200)
    if ident.get("narrowed"):
        answer = await _narrowed_exec(req, entry, raw, write_id)
    else:
        answer = await _live_run(req["ref"], entry, action, req["payload"], raw, write_id)
    if action == "chatSend":
        _behind_learn(write_id, str(ident.get("account_id") or ""), answer)
    if action in chat_live.WRITES:
        _cache_wrote(action, ident, entry["tenant"], req["payload"], answer)
    # a cached answer ran nothing: no clock moves on it
    if "reason" not in answer and not answer.get("cached"):
        content = json.dumps(answer).encode()
        if answer.get("status") == 200:
            # the shell's stream tabs hear of it, and the beat's clocks move, as for a /gas answer
            me = str(ident.get("account_id") or "")
            _observe_chat(action, req["payload"], answer, me)
            _observe_read(action, answer, token, me, False)
            _push_observed(raw, content, ident=ident)
        elif answer.get("status") == 401:
            _revoke(token)
            answer = {**answer, "reason": "revoked"}
    return _answer({**answer, "frame_held": _frame_held()}, http=200)


async def chat_refs(request: Request) -> Response:
    """The hub's: which refs its connections hold are no longer sessions here."""
    _start()
    if not chat_live.key_ok(str(request.headers.get("x-hub-chat-key") or ""), CHAT_KEY):
        return _answer(chat_live.refusal(401, "key", "This door is the live chat hub's."))
    body = await _body(request)
    if body is None:
        return _answer(chat_live.refusal(400, "body", "The body could not be read."))
    refs = body.get("refs")
    tokens = {e["token"] for r in (refs if isinstance(refs, list) else [])[: chat_live.MAX_CHECK]
              if isinstance(r, str) for e in [_refs.peek(r)] if e is not None}
    ended: dict[str, bool] = {}
    room = asyncio.Semaphore(8)

    async def judge(token: str) -> None:
        # live chat stops carrying a session switched now, or one the sign-in ended; one it cannot judge stays
        async with room:
            s = await _session(token)
        ended[token] = s is not None and (not s.ok or bool(s.acting))

    await asyncio.gather(*(judge(t) for t in tokens), return_exceptions=True)
    verdict = chat_live.check_refs(_refs, refs, lambda t: ended.get(t, False))
    _push_listed(refs, verdict)
    return _answer({"status": 200, "data": verdict})


async def chat_gate(request: Request) -> Response:
    """The hub's: the frame gate as this process holds it now."""
    _start()
    if not chat_live.key_ok(str(request.headers.get("x-hub-chat-key") or ""), CHAT_KEY):
        return _answer(chat_live.refusal(401, "key", "This door is the live chat hub's."))
    await _frame_refresh()
    return _answer({"status": 200, "frame_held": _frame_held()}, http=200)


# ---- THE CACHE (chat_live.ChatCache) ---------------------------------------------------------------------------------

_cache = chat_live.ChatCache()
_cache_busy: dict[tuple[str, ...], int] = {}
_cache_refresh_slots = asyncio.Semaphore(CACHE_REFRESHES)
_cache_said: dict[str, Any] = {"refreshes": 0, "refresh_failed": 0, "last_failed": "", "disk": "not started",
                               "written": 0, "removed": 0, "disk_failed": 0, "disk_last_failed": ""}


def _cache_hold(slot: tuple[str, ...] | None, step: int) -> None:
    if slot is None:
        return
    held = _cache_busy.get(slot, 0) + step
    if held > 0:
        _cache_busy[slot] = held
    else:
        _cache_busy.pop(slot, None)


def _cache_ids(ident: dict[str, Any]) -> frozenset[str]:
    """The ids a session is: its person, its account, and every account folded onto that person."""
    return frozenset(str(i) for i in (ident.get("person_id"), ident.get("account_id"), *(ident.get("fold_ids") or ()))
                     if i)


def _cache_place(tenant: Any, uid: str, is_master: bool) -> str | None:
    """The place whose chat a session in this tenant reads: the one it names, else the master's headquarters, else
    the account's home; None when it cannot be told."""
    named = str(tenant or "").strip()
    if named:
        return named
    if is_master:
        return ""
    return _fold.home_of(uid) if uid else None


def _cache_view(ident: dict[str, Any], tenant: Any, action: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    """The slot a read is, and as whom: {slot, ids, narrowed}; None for one the cache does not carry."""
    if action not in chat_live.CACHE_READS:
        return None
    uid, person = str(ident.get("account_id") or ""), str(ident.get("person_id") or "")
    place = _cache_place(tenant, uid, bool(ident.get("is_master")))
    if place is None or not uid or not person:
        return None
    ids = _cache_ids(ident)
    if action == "chatMessages":
        key = chat_live.pair_key(person, _fold.peek_person(str(payload.get("with_user") or "")))
        return {"slot": ("t", place, key), "ids": ids, "narrowed": False} if key else None
    narrowed = bool(ident.get("narrowed"))
    return {"slot": ("o", place, person, uid if narrowed else ""), "ids": ids, "narrowed": narrowed}


def _cache_took(view: dict[str, Any] | None, payload: dict[str, Any], answer: dict[str, Any], began: float) -> None:
    """The chat's answer to a read, into the cache: a whole thread or a rail fills its slot, a refusal drops it."""
    if view is None or "reason" in answer:
        return
    slot = view["slot"]
    if answer.get("status") != 200:
        _cache.drop(slot)
        return
    data = answer.get("data")
    if slot[0] == "t":
        if payload.get("after") and not (isinstance(data, dict) and data.get("reset") is True):
            return
        got = _cache.fill_thread(slot[1], slot[2], view["ids"], data, began)
    else:
        got = _cache.fill_rail(slot[1], slot[2], slot[3], data, began, view["narrowed"])
    if got == "wrong":
        _cache.drop(slot)


async def _live_run(ref: str, entry: dict[str, Any], action: str, payload: dict[str, Any], raw: bytes,
                    write_id: str = "") -> dict[str, Any]:
    """One chat action for the exec door."""
    view = None
    if action in chat_live.CACHE_READS:
        try:
            if _fold.stale():
                await asyncio.to_thread(_fold.index)
            view = _cache_view(entry["ident"], entry["tenant"], action, payload)
        except Exception:  # noqa: BLE001 - the cache is a shortcut, never the way
            view = None
    if view is not None:
        slot = view["slot"]
        hit = (_cache.thread(slot[1], slot[2], view["ids"], str(payload.get("after") or "")) if slot[0] == "t"
               else _cache.rail(slot[1], slot[2], slot[3]))
        if hit is not None:
            _cache_reread(view, ref, entry, action, payload)
            return {"status": 200, "data": hit, "cached": True}
    _by_action[action] = _by_action.get(action, 0) + 1
    slot = view["slot"] if view is not None else None
    _cache_hold(slot, 1)
    began = time.monotonic()
    try:
        answer = await chat_live.run_exec(_live_post, raw, action, write_id=write_id, unsettled=_unsettled)
    finally:
        _cache_hold(slot, -1)
    if view is not None:
        try:
            _cache_took(view, payload, answer, began)
            data = answer.get("data") if isinstance(answer.get("data"), dict) else {}
            if (slot[0] == "t" and payload.get("after") and answer.get("status") == 200 and "reason" not in answer
                    and data.get("reset") is not True):
                # a cursor the cache could not answer: the whole thread read behind it, so the next read is instant
                _cache_reread(view, ref, entry, action, payload, force=True)
        except Exception:  # noqa: BLE001
            _cache.forget_all()
    if action in BEHIND_READS:
        ident = entry["ident"]
        uid = str(ident.get("account_id") or "")
        answer = _behind_overlaid(action, answer, person=str(ident.get("person_id") or ""), ids=_cache_ids(ident),
                                  with_user=str(payload.get("with_user") or ""),
                                  place=_cache_place(entry["tenant"], uid, bool(ident.get("is_master"))))
    return answer


def _cache_reread(view: dict[str, Any], ref: str, entry: dict[str, Any], action: str, payload: dict[str, Any],
                  *, force: bool = False) -> None:
    """The slot read again behind an answer, as the session that asked: one read per slot at a time."""
    slot = view["slot"]
    if _cache_busy.get(slot) or not (force or _cache.needs_refresh(slot)):
        return
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return
    _cache_hold(slot, 1)
    _keep_task(_cache_read_again(view, ref, entry["token"], action,
                                 {k: v for k, v in payload.items() if k != "after"}))


async def _cache_read_again(view: dict[str, Any], ref: str, token: str, action: str, payload: dict[str, Any]) -> None:
    slot = view["slot"]
    try:
        async with _cache_refresh_slots:
            entry = _refs.peek(ref)
            if entry is None or entry["token"] != token or await _switched_token(token):
                return
            raw = chat_live.form(chat_live.envelope(token, entry["tenant"], action, payload))
            _by_action[action] = _by_action.get(action, 0) + 1
            _cache_said["refreshes"] += 1
            began = time.monotonic()
            answer = await chat_live.run_exec(_live_post, raw, action, unsettled=_unsettled)
            entry = _refs.peek(ref)
            if entry is None or entry["token"] != token or await _switched_token(token):
                return
            if "reason" in answer:
                _cache_said["refresh_failed"] += 1
                return
            if answer.get("status") == 200:
                ident = entry["ident"]
                _observe_read(action, answer, token, str(ident.get("account_id") or ""), False)
            _cache_took(view, payload, answer, began)
    except Exception as exc:  # noqa: BLE001 - a read behind an answer is never a failure mode
        _cache_said["refresh_failed"] += 1
        _cache_said["last_failed"] = type(exc).__name__
    finally:
        _cache_hold(slot, -1)


def _cache_forget_write(action: str, key: str, person: str, other: str, payload: dict[str, Any],
                        settle_s: float) -> None:
    if action == "chatReact":
        _cache.forget_message(str(payload.get("message_id") or ""), settle_s)
    elif action == "chatSend":
        _cache.forget(keys=(key,), people=(person, other), settle_s=settle_s)
    else:
        _cache.forget(keys=(key,), people=(person,), settle_s=settle_s)


def _cache_write(action: str, place: str | None, ids: frozenset[str], person: str, name: str,
                 payload: dict[str, Any], answer: dict[str, Any]) -> None:
    """A chat write as the cache must see it."""
    other = _fold.peek_person(chat_live.person_in(action, payload)) if action != "chatReact" else ""
    key = chat_live.pair_key(person, other) if other else ""
    reason = str(answer.get("reason") or "")
    if reason:
        if reason in ("unconfirmed", "unreachable"):
            _cache_forget_write(action, key, person, other, payload, chat_live.SETTLE_S)
        return
    if answer.get("status") != 200:
        _cache_forget_write(action, key, person, other, payload, 0.0)
        return
    data = answer.get("data") if isinstance(answer.get("data"), dict) else {}
    if action == "chatSend":
        answered = str(data.get("thread_key") or "")
        if not data.get("id") or not data.get("created_at") or not answered:
            _cache_forget_write(action, key, person, other, payload, chat_live.SETTLE_S)
            return
        _cache.sent(place, answered, ids, {"id": data.get("id"), "created_at": data.get("created_at"),
                                           "from_name": name, "body": payload.get("body")},
                    expected_key=key, sender_person=person, to_person=other)
    elif action == "chatReact":
        if not isinstance(data.get("reactions"), dict) or not data.get("to_user"):
            _cache_forget_write(action, key, person, other, payload, chat_live.SETTLE_S)
            return
        key = chat_live.pair_key(person, _fold.peek_person(str(data.get("to_user"))))
        _cache.reacted(place, key, ids, str(data.get("message_id") or payload.get("message_id") or ""),
                       data.get("reactions"))
    else:
        _cache.read(place, key, ids, chat_live.iso_at(time.time()), reader_person=person)


def _cache_wrote(action: str, ident: dict[str, Any], tenant: Any, payload: dict[str, Any],
                 answer: dict[str, Any]) -> None:
    """A write the exec door carried, as its session. Never raises."""
    try:
        uid = str(ident.get("account_id") or "")
        _cache_write(action, _cache_place(tenant, uid, bool(ident.get("is_master"))), _cache_ids(ident),
                     str(ident.get("person_id") or ""), str(ident.get("name") or ""), payload, answer)
    except Exception:  # noqa: BLE001 - a write the cache could not follow leaves nothing it may have changed
        _cache.forget_all()


def _cache_blind(action: str, payload: dict[str, Any], answer: dict[str, Any]) -> None:
    """A chat write by a session the cache cannot place (unknown, switched, or visiting): what it may touch goes."""
    data = answer.get("data") if isinstance(answer.get("data"), dict) else {}
    settle = chat_live.SETTLE_S if "reason" in answer or (answer.get("status") == 200 and not data) else 0.0
    if action == "chatReact":
        _cache.forget_message(str(payload.get("message_id") or ""), settle)
        named = str(data.get("to_user") or "")
    else:
        named = chat_live.person_in(action, payload)
    if named:
        _cache.forget_person(_fold.peek_person(named), settle)


def _cache_observed(raw: bytes, content: bytes | None, s: Any) -> None:
    """A chat answer /gas carried (None: a write that left and did not answer), as the session `s` asked it."""
    if b"chat" not in raw[:4096]:
        return
    req = chat_live.chat_envelope(raw)
    action = str(req.get("action") or "")
    if action not in chat_live.CACHE_READS and action not in chat_live.WRITES:
        return
    try:
        answer = {"reason": "unconfirmed"} if content is None else json.loads(content)
    except (ValueError, UnicodeDecodeError, TypeError):
        answer = None
    if not isinstance(answer, dict):
        if action in chat_live.WRITES:
            _cache.forget_all()
        return
    try:
        payload = req.get("payload") if isinstance(req.get("payload"), dict) else {}
        uid = str(getattr(s, "uid", "") or "") if s is not None and s.ok else ""
        own = (bool(uid) and _fold.known() and not s.acting and not str(req.get("member") or "").strip()
               and not str(req.get("world") or "").strip())
        if not own:
            if action in chat_live.WRITES:
                _cache_blind(action, payload, answer)
            return
        person, folds = _fold.peek_identity(uid)
        ident = {"account_id": uid, "person_id": person, "fold_ids": folds, "is_master": bool(s.master)}
        if action in chat_live.CACHE_READS:
            data = answer.get("data")
            ident["narrowed"] = (action == "chatOverview" and isinstance(data, dict)
                                 and isinstance(data.get("circle"), dict))
            _cache_took(_cache_view(ident, req.get("tenant"), action, payload), payload, answer,
                        time.monotonic() - chat_live.CACHE_GAS_READ_S)
            return
        _cache_write(action, _cache_place(req.get("tenant"), uid, ident["is_master"]), _cache_ids(ident), person,
                     _fold.peek_name(uid), payload, answer)
    except Exception:  # noqa: BLE001 - observation, never a failure mode; what it may have touched goes
        _cache.forget_all()


def _dir_state(wanted: str) -> tuple[Path | None, str]:
    """(the folder kept in, '') — or (None, why there is none): unset, the packs' own folder, the relay's own, or
    missing."""
    if not wanted:
        return None, "unset"
    try:
        folder = Path(wanted).resolve()
        if PACKS_DIR and folder == Path(PACKS_DIR).resolve():
            return None, "the app packs' own folder"
        if any(folder == Path(r) for r in RELAY_DIRS):
            return None, "the relay's own folder"
        if not folder.is_dir():
            if not folder.parent.is_dir():
                return None, "missing"
            folder.mkdir(mode=0o700)
        os.chmod(folder, 0o700)
    except (OSError, RuntimeError):
        return None, "unreadable"
    return folder, ""


def _cache_disk_read(folder: Path) -> tuple[list[tuple[str, Any]], list[str]]:
    found: list[tuple[str, Any]] = []
    drop: list[str] = []
    for path in sorted(folder.iterdir()):
        if chat_live.CACHE_TEMP_RE.fullmatch(path.name):
            drop.append(path.name)
        elif chat_live.CACHE_FILE_RE.fullmatch(path.name):
            try:
                found.append((path.name, json.loads(path.read_text(encoding="utf-8"))))
            except Exception:  # noqa: BLE001 - not taken up, and removed
                drop.append(path.name)
    return found, drop


def _cache_disk_write(folder: Path, jobs: list[tuple[str, str | None]]) -> None:
    """Each kept file written whole beside itself and renamed over it (0600)."""
    for name, text in jobs:
        temp = ""
        try:
            if text is None:
                (folder / name).unlink(missing_ok=True)
                _cache_said["removed"] += 1
                continue
            fd, temp = tempfile.mkstemp(dir=folder, prefix=f".{name}.", suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as out:
                out.write(text)
            os.replace(temp, folder / name)
            temp = ""
            _cache_said["written"] += 1
        except Exception as exc:  # noqa: BLE001
            _cache_said["disk_failed"] += 1
            _cache_said["disk_last_failed"] = type(exc).__name__
        finally:
            if temp:
                try:
                    os.unlink(temp)
                except OSError:
                    pass


async def _cache_start() -> None:
    """The kept copies taken up (each read again the first time it is served); from then on written back as they
    change, and expired on their own clock."""
    folder = None
    try:
        folder, why = await asyncio.to_thread(_dir_state, CACHE_DIR)
        _cache_said["disk"] = why or "kept"
        if folder is not None:
            found, drop = await asyncio.to_thread(_cache_disk_read, folder)
            drop += [name for name, body in found if not _cache.adopt(name, body)]
            if drop:
                await asyncio.to_thread(_cache_disk_write, folder, [(name, None) for name in drop])
    except Exception as exc:  # noqa: BLE001 - a folder that cannot be read starts cold, in memory
        folder = None
        _cache_said["disk"] = "unreadable"
        _cache_said["disk_last_failed"] = type(exc).__name__
    beat = 0
    while True:
        await asyncio.sleep(CACHE_FLUSH_S)
        beat += 1
        try:
            if beat % CACHE_EXPIRE_EVERY == 0:
                _cache.expire()
            jobs = _cache.take_dirty()
            if folder is not None and jobs:
                await asyncio.to_thread(_cache_disk_write, folder, jobs)
        except Exception as exc:  # noqa: BLE001
            _cache_said["disk_failed"] += 1
            _cache_said["disk_last_failed"] = type(exc).__name__


# ---- WRITTEN BEHIND (chat_live.Behind): a hub send kept here first, answered at once, written to the chat behind -----

_behind = chat_live.Behind()
_behind_where: dict[str, Any] = {"folder": None, "disk": "not started"}
_behind_lanes: dict[str, Any] = {}
_behind_said: dict[str, Any] = {"written": 0, "disk_failed": 0, "disk_last_failed": "", "restored": 0, "unreadable": 0,
                                "lane_failed": 0}


def _behind_disk_write(folder: Path, name: str, body: dict[str, Any]) -> bool:
    """One file written whole beside itself, flushed, and renamed over it (0600)."""
    temp = ""
    try:
        fd, temp = tempfile.mkstemp(dir=folder, prefix=f".{name}.", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.write(json.dumps(body, separators=(",", ":")))
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, folder / name)
        temp = ""
        _behind_said["written"] += 1
        return True
    except Exception as exc:  # noqa: BLE001
        _behind_said["disk_failed"] += 1
        _behind_said["disk_last_failed"] = type(exc).__name__
        return False
    finally:
        if temp:
            try:
                os.unlink(temp)
            except OSError:
                pass


def _behind_disk_remove(name: str) -> None:
    folder = _behind_where.get("folder")
    if folder is None or not name:
        return
    try:
        (folder / name).unlink(missing_ok=True)
    except OSError as exc:
        _behind_said["disk_failed"] += 1
        _behind_said["disk_last_failed"] = type(exc).__name__


def _behind_disk_read(folder: Path) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
    """(each kept send, the torn writes to remove, the kept state)."""
    found: list[dict[str, Any]] = []
    torn: list[str] = []
    state: dict[str, Any] = {}
    for path in sorted(folder.iterdir()):
        name = path.name
        if name == chat_live.BEHIND_STATE_FILE:
            try:
                got = json.loads(path.read_text(encoding="utf-8"))
                state = got if isinstance(got, dict) else {}
            except Exception:  # noqa: BLE001 - no state is the state before any proof
                state = {}
        elif chat_live.BEHIND_TEMP_RE.fullmatch(name) or (name.startswith(f".{chat_live.BEHIND_STATE_FILE}.")
                                                          and name.endswith(".tmp")):
            torn.append(name)
        elif chat_live.BEHIND_FILE_RE.fullmatch(name):
            try:
                body = json.loads(path.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                body = None
            if chat_live.behind_valid(body) and body.get("file") == name:
                found.append(body)
            else:
                _behind_said["unreadable"] += 1
    return found, torn, state


def _behind_state_save() -> None:
    folder = _behind_where.get("folder")
    if folder is not None:
        _behind_disk_write(folder, chat_live.BEHIND_STATE_FILE, {"on": _behind.on, "why": _behind.why})


def _behind_answer(entry: dict[str, Any]) -> dict[str, Any]:
    """A kept send's answer: the receipt the chat will give it, now."""
    return {"status": 200, "data": {"id": entry["id"], "created_at": entry["created_at"],
                                    "thread_key": entry["thread_key"], "emailed": False, "kept": True},
            "behind": True}


def _behind_learn(write_id: str, uid: str, answer: Any) -> None:
    """A send the chat answered itself: whether it files a row under the id this process would give it."""
    if not write_id or not uid or not isinstance(answer, dict):
        return
    if answer.get("status") != 200 or "reason" in answer or answer.get("behind"):
        return
    data = answer.get("data") if isinstance(answer.get("data"), dict) else {}
    got = str(data.get("id") or "")
    if not got or data.get("deduplicated"):
        return
    proven = got == chat_live.message_id_for(write_id, uid)
    why = ("the chat files a send under the id this process gives it" if proven
           else "the chat filed a send under another id than this process gives it")
    if _behind.learn(proven, why):
        log.info("live chat: sends are %s", "kept here first from now on" if proven else "no longer kept here first")
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return
        _keep_task(asyncio.to_thread(_behind_state_save))


def _behind_publish(user_ids: Any, words: str, fact: str | None) -> None:
    """A kept send's line to these accounts' streams: the words to their own tabs, only the fact (or nothing) to a
    switched tab."""
    for uid in dict.fromkeys(str(u) for u in user_ids or () if u):
        for queue in list(_subs.get(uid) or ()):
            line = fact if queue.switched else words
            if not line:
                continue
            try:
                queue.put_nowait(line)
            except asyncio.QueueFull:
                pass


def _behind_fact(entry: dict[str, Any]) -> str:
    return json.dumps({"kind": "chatSend", "thread_key": entry["thread_key"], "from_user": entry["from_account"],
                       "at": entry["created_at"]}, separators=(",", ":"))


def _behind_told(entry: dict[str, Any]) -> None:
    """Both ends hear a kept send at once: the stream's line with the words (while the frame gate lets them reach the
    other end), the hub's word, and the push."""
    try:
        held = _frame_held()
        fact = _behind_fact(entry)
        if not held:
            _behind_publish(entry["to_ids"], chat_live.behind_line(entry, mine=False), fact)
            for uid in entry["to_ids"]:
                _dirty[uid] = entry["created_at"]
        _behind_publish(entry["from_ids"], chat_live.behind_line(entry, mine=True), fact)
        if entry["source"] != "hub":
            _emit(chat_live.behind_event(entry, held=held))
            _emit({"kind": "nudge", "action": "chatSend", "thread_key": entry["thread_key"],
                   "from": entry["from_account"], "to": [entry["to_user"]], "held": held, "source": "behind"})
        _push_observed(entry["raw"].encode("ascii"), json.dumps(_behind_answer(entry)).encode(),
                       ident={"account_id": entry["from_account"], "person_id": entry["from_person"],
                              "name": entry["from_name"]})
    except Exception:  # noqa: BLE001 - telling is a bonus; the send is kept either way
        pass


def _behind_patch(entry: dict[str, Any]) -> None:
    """The cache carries the kept send, and nothing fills what it touches until it lands."""
    try:
        _cache.sent("", entry["thread_key"], entry["from_ids"],
                    {"id": entry["id"], "created_at": entry["created_at"], "from_name": entry["from_name"],
                     "body": entry["body"]},
                    expected_key=entry["thread_key"], sender_person=entry["from_person"],
                    to_person=entry["to_person"])
    except Exception:  # noqa: BLE001
        _cache.forget_all()
    _cache.pin(keys=(entry["thread_key"],), people=(entry["from_person"], entry["to_person"]))


def _behind_unpin(entry: dict[str, Any], *, forget: bool) -> None:
    people = (entry["from_person"], entry["to_person"])
    _cache.unpin(keys=(entry["thread_key"],), people=people)
    if forget:
        _cache.forget(keys=(entry["thread_key"],), people=people)


async def _behind_keep(*, token: str, tenant: str, ident: dict[str, Any], payload: dict[str, Any], write_id: str,
                       client_id: str, source: str) -> dict[str, Any] | None:
    """The send kept here first and told to both ends, answered with its receipt; None when the chat is asked now."""
    uid = str(ident.get("account_id") or "")
    if not write_id or not uid or not token:
        return None
    held = _behind.held(write_id)
    if held is not None:
        return _behind_answer(held)
    folder = _behind_where.get("folder")
    body = str(payload.get("body") or "").strip()
    to_user = str(payload.get("to_user") or "").strip()
    if _behind.on and folder is not None and _fold.stale():
        await asyncio.to_thread(_fold.index)
    person, folds = _fold.peek_identity(uid)
    to_person, to_ids = _fold.peek_identity(to_user)
    why = chat_live.behind_refusal(
        on=_behind.on and folder is not None, acting=await _switched_token(token),
        place=_cache_place(tenant, uid, bool(ident.get("is_master"))),
        sender_narrowed=_fold.peek_narrowed(uid), to_narrowed=_fold.peek_narrowed(to_user), sender_person=person,
        to_person=to_person, room=_behind.room())
    # the chat keeps 4000 of JavaScript's characters: a longer one goes to it, so the row says what was answered
    if not why and (not body or not to_user or "|" in to_user or len(body.encode("utf-16-le")) > 8000):
        why = "body"
    if why:
        _behind.note_not_kept(why)
        return None
    wall = time.time()
    at = chat_live.iso_at(wall)
    raw = chat_live.form(chat_live.envelope(token, tenant, "chatSend", {"to_user": to_user, "body": body, "at": at},
                                            write_id))
    entry = chat_live.behind_entry(write_id=write_id, account_id=uid, person_id=person, ids=folds,
                                   name=str(ident.get("name") or ""), to_user=to_user, to_person=to_person,
                                   to_ids=to_ids, body=body, client_id=client_id or ("b" + write_id), source=source,
                                   raw=raw, created_at=at, wall=wall)
    # as whom it was taken: delivered so if the session ends before it lands, as a sign-out sends it first
    entry["as"] = {"uid": uid, "role": "", "is_master": bool(ident.get("is_master"))}
    s = front_door.held_session(token)
    if s is not None and s.ok:
        entry["as"]["role"] = str(s.role or "").strip().lower()
    entry["file"] = f"{time.time_ns():020d}.{hashlib.sha256(write_id.encode()).hexdigest()[:16]}.behind.json"
    if not await asyncio.to_thread(_behind_disk_write, folder, entry["file"], entry):
        _behind.note_not_kept("disk")
        return None
    twin = _behind.held(write_id)
    if twin is not None:
        await asyncio.to_thread(_behind_disk_remove, entry["file"])
        return _behind_answer(twin)
    _behind.add(entry)
    _behind_patch(entry)
    _behind_told(entry)
    _behind_wake(entry["from_person"])
    return _behind_answer(entry)


def _behind_wake(person: str) -> None:
    running = _behind_lanes.get(person)
    if running is not None and not running.done():
        return
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return
    _behind_lanes[person] = asyncio.ensure_future(_behind_lane(person))


async def _behind_post(entry: dict[str, Any]) -> tuple[str, bytes]:
    """A kept send to the chat as its session; as whom it was taken once that session has ended."""
    raw = entry["raw"].encode("ascii")
    taken = entry.get("as") if isinstance(entry.get("as"), dict) else None
    token = str(chat_live.chat_envelope(raw).get("token") or "")
    if taken and str(taken.get("uid") or "") and str(taken.get("role") or "") and await _session_gone(token):
        user = {"uid": str(taken["uid"]), "role": str(taken["role"]), "is_master": taken.get("is_master") is True}
        env = chat_live.chat_envelope(raw)
        payload = env.get("payload") if isinstance(env.get("payload"), dict) else {}
        try:
            resp = await asyncio.wait_for(run_in_threadpool(_main()._run_chat, "chatSend", user, payload,
                                                            str(env.get("write_id") or "")), timeout=PY_TIMEOUT_S)
        except asyncio.TimeoutError:
            return "timeout", b""
        except Exception:  # noqa: BLE001
            return "error", b""
        if resp.status_code != 200:
            return "json", json.dumps(dict(UNSENT)).encode()
        return "json", bytes(resp.body or b"")
    return await _live_post(raw, chat_live.EXEC_BUDGET_S)


async def _behind_lane(person: str) -> None:
    """One sender's kept sends to the chat, oldest first and one at a time, until none waits."""
    tries = 0
    while True:
        entry = _behind.next_for(person)
        if entry is None:
            return
        try:
            if time.time() - float(entry["accepted_at"]) > chat_live.BEHIND_MAX_AGE_S:
                _behind_refused(entry, "The chat did not take it within a day.", how="given_up")
                tries = 0
                continue
            wait = float(entry.get("hold_until") or 0) - time.time()
            if wait > 0:
                await asyncio.sleep(min(wait, chat_live.SETTLE_S))
                continue
            entry["sent_at"] = time.time()
            folder = _behind_where.get("folder")
            if folder is not None:
                await asyncio.to_thread(_behind_disk_write, folder, entry["file"], entry)
            _by_action["chatSend"] = _by_action.get("chatSend", 0) + 1

            async def post(raw: bytes, timeout: float, entry: dict[str, Any] = entry) -> tuple[str, bytes]:
                return await _behind_post(entry)

            answer = await chat_live.run_exec(post, entry["raw"].encode("ascii"), "chatSend",
                                              write_id=entry["write_id"], unsettled=_unsettled)
            how, why = chat_live.behind_outcome(entry, answer)
            if how == "retry":
                tries += 1
                after = (float(answer.get("retry_after_s") or 0) if answer.get("reason") == "unconfirmed" else 0.0)
                entry["hold_until"] = time.time() + max(
                    after, chat_live.BEHIND_BACKOFF_S[min(tries - 1, len(chat_live.BEHIND_BACKOFF_S) - 1)])
                continue
            tries = 0
            if how == "landed":
                _behind_landed(entry, answer)
            elif how == "moved":
                _behind_moved(entry)
            else:
                _behind_refused(entry, why)
        except Exception as exc:  # noqa: BLE001 - the lane never dies with a send in it
            _behind_said["lane_failed"] += 1
            _behind_said["disk_last_failed"] = type(exc).__name__
            entry["hold_until"] = time.time() + chat_live.BEHIND_BACKOFF_S[-1]


def _behind_landed(entry: dict[str, Any], answer: dict[str, Any]) -> None:
    """The row is there, under the id both ends were given."""
    _behind.landed(entry["write_id"])
    _behind_disk_remove(entry.get("file") or "")
    data = answer.get("data") if isinstance(answer.get("data"), dict) else {}
    filed = str(data.get("thread_key") or "")
    moved_pair = bool(filed) and filed != entry["thread_key"]
    _behind_unpin(entry, forget=moved_pair)
    if moved_pair:
        # the chat filed it under another pair (its folds and these differ): both ends read it again
        _cache.forget(keys=(filed,))
        _behind_nudge(entry)


def _behind_moved(entry: dict[str, Any]) -> None:
    """Filed, but under another id (or none said): the chat does not name rows by their write id now."""
    _behind.drop(entry["write_id"], how="moved")
    _behind_disk_remove(entry.get("file") or "")
    if _behind.learn(False, "a kept send was filed under another id than this process gave it"):
        log.warning("live chat: a kept send was filed under another id; sends are no longer kept here first")
        _behind_state_save()
    _behind_unpin(entry, forget=True)
    _behind_take_back(entry)
    _emit({**chat_live.behind_refused_event(entry, ""), "moved": True})
    _behind_nudge(entry)


def _behind_refused(entry: dict[str, Any], why: str, how: str = "refused") -> None:
    """The chat will not file it (or never took it): the line goes at the recipient's end, the sender's shows why."""
    _behind.drop(entry["write_id"], how=how)
    _behind_disk_remove(entry.get("file") or "")
    _behind_unpin(entry, forget=True)
    log.warning("live chat: a kept send was not filed by the chat (%s)", how)
    _behind_take_back(entry)
    _behind_publish(entry["from_ids"], json.dumps({
        "kind": "write_refused", "resource": "Your chat message", "action": "chatSend", "why": why,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}), None)
    _emit(chat_live.behind_refused_event(entry, why))


def _behind_take_back(entry: dict[str, Any]) -> None:
    gone = chat_live.behind_gone_line(entry)
    if not _frame_held():
        _behind_publish(entry["to_ids"], gone, None)
    _behind_publish(entry["from_ids"], gone, None)


def _behind_nudge(entry: dict[str, Any]) -> None:
    """Both ends read the thread again (the stream's fact, and the hub's nudge)."""
    held = _frame_held()
    fact = _behind_fact(entry)
    if not held:
        _behind_publish(entry["to_ids"], fact, fact)
    _behind_publish(entry["from_ids"], fact, fact)
    _emit({"kind": "nudge", "action": "chatSend", "thread_key": "", "from": entry["from_account"],
           "to": [entry["to_user"]], "held": held, "source": "behind"})


def _behind_overlaid(action: str, answer: Any, *, person: str, ids: frozenset[str], with_user: str,
                     place: str | None) -> Any:
    """A read the chat answered, with the kept sends it does not carry yet."""
    if (not _behind.any() or place != "" or not person or not isinstance(answer, dict)
            or answer.get("status") != 200 or "reason" in answer):
        return answer
    data = answer.get("data")
    if action == "chatMessages":
        key = chat_live.pair_key(person, _fold.peek_person(with_user))
        got = chat_live.overlay_messages(data, key, ids, _behind.touching_thread(key)) if key else data
    elif action == "chatOverview":
        got = chat_live.overlay_rail(data, person, _behind.touching((person,)))
    elif action == "chatPing":
        got = chat_live.overlay_ping(data, person, _behind.touching((person,)))
    else:
        return answer
    return answer if got is data else {**answer, "data": got}


def _behind_gas_read(raw: bytes, content: bytes, s: Any) -> bytes:
    """A chat read /gas carried, with the kept sends it does not carry yet — for the session's own workspace."""
    if not _behind.any() or b"chat" not in raw[:4096]:
        return content
    try:
        req = chat_live.chat_envelope(raw)
        action = str(req.get("action") or "")
        if action not in BEHIND_READS:
            return content
        uid = str(getattr(s, "uid", "") or "") if s is not None and s.ok else ""
        if (not uid or not _fold.known() or s.acting or str(req.get("member") or "").strip()
                or str(req.get("world") or "").strip()):
            return content
        answer = json.loads(content)
        person, folds = _fold.peek_identity(uid)
        payload = req.get("payload") if isinstance(req.get("payload"), dict) else {}
        got = _behind_overlaid(action, answer, person=person,
                               ids=_cache_ids({"account_id": uid, "person_id": person, "fold_ids": folds}),
                               with_user=str(payload.get("with_user") or ""),
                               place=_cache_place(req.get("tenant"), uid, bool(s.master)))
        return content if got is answer else json.dumps(got).encode()
    except Exception:  # noqa: BLE001 - the answer as the chat gave it
        return content


async def _behind_start() -> None:
    """The kept sends taken up again, each held off what it touches in the cache, and their lanes started."""
    try:
        folder, why = await asyncio.to_thread(_dir_state, BEHIND_DIR)
        _behind_where.update(folder=folder, disk=why or "kept")
        if folder is None:
            return
        found, torn, state = await asyncio.to_thread(_behind_disk_read, folder)
        for name in torn:
            await asyncio.to_thread(_behind_disk_remove, name)
        if state.get("on") is True:
            _behind.learn(True, str(state.get("why") or "kept from before the start"))
        for entry in sorted(found, key=lambda e: e["file"]):
            if _behind.held(entry["write_id"]) is not None:
                continue
            sent = float(entry.get("sent_at") or 0)
            entry["hold_until"] = sent + chat_live.SETTLE_S if sent else 0.0
            _behind.add(entry, restored=True)
            _behind_said["restored"] += 1
            people = (entry["from_person"], entry["to_person"])
            _cache.forget(keys=(entry["thread_key"],), people=people)
            _cache.pin(keys=(entry["thread_key"],), people=people)
        for person in _behind.senders():
            _behind_wake(person)
    except Exception as exc:  # noqa: BLE001 - nothing is kept here first until the folder can be read
        _behind_where.update(folder=None, disk="unreadable")
        _behind_said["disk_last_failed"] = type(exc).__name__


# ---- CHAT PUSH (chat_push.py): planned and delivered here ------------------------------------------------------------

_push_hub = chat_push.HubLive()
_push_rate = chat_push.RateLimit()
# the delivery's own: one push per recipient and thread, spent only with a device to reach (chat_push.judge)
_push_deliver_rate = chat_push.RateLimit()
_PUSH_SAID: dict[str, Any] = {"no_key": 0.0, "last": ""}


def _push_seen(ids: Any) -> None:
    """The hub redeemed a ticket or ran an exec for this person: a live chat connection is theirs now."""
    if isinstance(ids, (list, tuple)):
        _push_hub.touched(str(i) for i in ids if i)


def _push_listed(refs: Any, verdict: Any) -> None:
    """The hub's list of the refs its connections hold: those still sessions here are live, as their ids."""
    if not isinstance(refs, list):
        return
    try:
        closed = {r for key in ("unknown", "revoked") for r in ((verdict or {}).get(key) or ()) if isinstance(r, str)}
        groups: list[list[str]] = []
        for ref in refs[: chat_live.MAX_CHECK]:
            if not isinstance(ref, str) or ref in closed:
                continue
            ident = (_refs.peek(ref) or {}).get("ident") or {}
            groups.append([str(i) for i in (ident.get("fold_ids") or [ident.get("account_id")]) if i])
        _push_hub.listed(groups)
    except Exception:  # noqa: BLE001 - the last list stands until it ages out
        return


def _push_live(ids: list[str]) -> bool:
    """Any of these accounts with a chat stream open (a switched tab is not them) or a live chat connection."""
    for uid in ids:
        if any(not q.switched for q in list(_subs.get(uid) or ())):
            return True
    return _push_hub.live(ids)


def _push_observed(raw: bytes, content: bytes, *, ident: dict[str, Any] | None = None, s: Any = None) -> None:
    """A chatSend that landed (a /gas answer, the hub's exec, a kept send)."""
    if b"chatSend" not in raw[:4096]:
        return
    try:
        got = chat_push.landed_send(raw, content)
        if got is None:
            return
        if got["message_id"]:
            _push_start(got, ident, 0.0, s)
        else:
            _push_unconfirmed(got, chat_push.AFTER_SILENCE_S, s)
    except Exception:  # noqa: BLE001 - observation, never a failure mode
        return


def _push_unanswered(raw: bytes, s: Any) -> None:
    """A /gas send answered without its receipt: looked for once the chat has had the time to file it."""
    if b"chatSend" not in raw[:4096]:
        return
    try:
        got = chat_push.unanswered_send(raw)
        if got is not None:
            _push_unconfirmed(got, chat_push.AFTER_SILENCE_S, s)
    except Exception:  # noqa: BLE001
        return


def _push_unconfirmed(got: dict[str, str], delay: float, s: Any) -> None:
    """A send with no receipt: nothing for a client's or a guardian's session, one not known, or one in a place."""
    role = str(s.role or "") if s is not None and s.ok else ""
    if not role or chat_live.narrowed(role) or got.get("tenant"):
        return
    _push_start({**got, "since": chat_push.row_since()}, None, delay, s, confirm=True)


def _push_start(got: dict[str, str], ident: dict[str, Any] | None, delay: float, s: Any, *,
                confirm: bool = False) -> None:
    """The sender named now; the token dropped here unless the row is still to be read as them."""
    token = got.pop("token", "")
    if ident:
        job = {**got, "from_uid": str(ident.get("account_id") or ""),
               "from_person": str(ident.get("person_id") or ""), "from_name": str(ident.get("name") or "")}
    else:
        uid = str(getattr(s, "uid", "") or "") if s is not None and s.ok else ""
        job = {**got, "from_uid": uid, "from_person": "", "from_name": _fold.peek_name(uid) if uid else ""}
    if confirm:
        job["confirm_as"] = token
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return
    _keep_task(_push_run(job, delay))


def _push_devices(ids: list[str]) -> bool:
    """Whether a device is kept for any of these accounts (the relay's own table in asa-hub-db); True when that
    cannot be read here, so the relay decides."""
    import mw_relay_state  # noqa: PLC0415

    if not mw_relay_state.moved():
        return True
    got = _main().CHAT_STORE.run(lambda c: c.execute(
        "select 1 from app.asa_hub_push_subs where user_id = any(%s) limit 1", (list(ids),)).fetchone())
    return got is not None


async def _push_confirm(job: dict[str, str], plan: dict[str, Any]) -> bool:
    """A send with no receipt: its row, read as its sender, or no push."""
    if not _push_rate.open(plan["rate_key"]):
        return False
    try:
        if not await asyncio.to_thread(_push_devices, plan["to_ids"]):
            return False
    except Exception:  # noqa: BLE001 - the relay decides
        pass
    raw = chat_live.form(chat_live.envelope(job["confirm_as"], job.get("tenant") or "", "chatMessages",
                                            {"with_user": job["to_user"]}))
    answer = await chat_live.run_exec(_live_post, raw, "chatMessages", unsettled=_unsettled)
    found = chat_push.row_filed(answer, job.get("since") or "")
    if not found:
        return False
    plan["event"] = found
    return True


def _push_plan(job: dict[str, str]) -> dict[str, Any] | None:
    """Worker thread: the recipient's accounts and both names, from the users copy the folds come from."""
    to_user = job["to_user"]
    to_person, to_ids = _fold.identity(to_user)
    from_person = job.get("from_person") or ""
    if not from_person and job.get("from_uid"):
        from_person = _fold.identity(job["from_uid"])[0]
    if not from_person:
        from_person = chat_push.other_side(job.get("thread_key") or "", to_person or to_user)
    from_name = job.get("from_name") or (_fold.name_of(from_person) if from_person else "")
    return chat_push.plan(to_user=to_user, to_person=to_person, to_ids=to_ids, to_name=_fold.name_of(to_user),
                          from_person=from_person, from_name=from_name, thread_key=job.get("thread_key") or "",
                          message_id=job.get("message_id") or "")


def _push_here(plan: dict[str, Any]) -> tuple[str, int, str]:
    """Worker thread: the devices, the send switch, the chat gate, the night and the keys as they stand now; then the
    push, and its row on the push channel (sent, failed, held by test mode, or not sent in the quiet window)."""
    import candidate_papers as CP  # noqa: PLC0415 - the Smart Comms gates, as every door here reads them
    import lane_gate  # noqa: PLC0415
    import notice_clock  # noqa: PLC0415
    import web_gate  # noqa: PLC0415
    import web_push  # noqa: PLC0415

    dsn = notice_clock._SL().PG_DSN  # noqa: SLF001 - the push tables' one DSN, as the notices' clock reads it
    devs = web_push.devices_for(dsn, plan["to_ids"])
    switch = notice_clock.switch()
    try:
        held = lane_gate.in_reads(lambda reads: CP.gate_holds(reads, FRAME_GATE))
        gate = {"held": bool(held), "why": held}
    except Exception as exc:  # noqa: BLE001 - a gate that cannot answer holds
        gate = {"held": True, "why": f"the chat gate could not be read ({type(exc).__name__})"}
    now = chat_push.now()
    keys = web_push.keys()
    state = chat_push.judge(devices=len(devs), rate=_push_deliver_rate, key=plan["rate_key"],
                            held=bool(switch.get("on") or gate["held"]), quiet=web_gate.quiet(now),
                            keys_ok=bool(keys.get("ok")))
    took, why = 0, ""
    if state == chat_push.SEND:
        state, took, why = web_push.push_chat(dsn, devs, chat_push.payload(plan, now), vapid=keys,
                                              ttl=web_push.chat_ttl(now))
    elif state == chat_push.NO_KEY:
        why = str(keys.get("why") or "no VAPID keys")
    if state == chat_push.HELD_TEST:
        how = (web_gate.held_by_test(switch) if switch.get("on") else str(gate["why"] or "the chat gate"),
               "held", "test mode is on — no push left the platform, and none will: this row is its only delivery")
    elif state == chat_push.QUIET:
        how = (f"held: the quiet window ({web_gate.quiet_words()})", "quiet",
               "not pushed in the quiet window, and not afterwards: the unread count in My Inbox still shows it")
    elif state == web_push.S_SENT:
        how = ("", "sent", "pushed to the person's device(s)")
    elif state == web_push.S_FAILED:
        how = ("the push service", "failed", f"no device took it, and it is not tried again ({why})"[:300])
    else:
        return state, took, why
    notice = {"key": f"{chat_push.KIND}:{plan['event']}", "kind": chat_push.KIND, "facts": {"person": plan["from_name"]}}
    try:
        web_gate.record(web_gate.mock_rows(web_gate.CH_PUSH, notice, [(plan["to_name"], chat_push.copy_of(plan))],
                                           result=how[1], held_by=how[0], reason=how[2], switch=switch))
    except Exception as exc:  # noqa: BLE001 - the push stands; its row is what is missing
        log.warning("chat push: its row could not be kept (%s)", type(exc).__name__)
    return state, took, why


async def _push_deliver(plan: dict[str, Any]) -> dict[str, Any] | None:
    """One chat message's push, delivered here (_push_here)."""
    import web_push  # noqa: PLC0415

    try:
        state, took, why = await asyncio.to_thread(_push_here, plan)
    except Exception as exc:  # noqa: BLE001 - one message's push, never the door's
        log.warning("chat push: a message could not be pushed (%s)", type(exc).__name__)
        return None
    if state == chat_push.NO_KEY:
        if time.time() - _PUSH_SAID["no_key"] > 3600:
            _PUSH_SAID["no_key"] = time.time()
            log.warning("chat push: nothing is pushed — %s", why)
    elif state in (web_push.S_SENT, web_push.S_FAILED, chat_push.HELD_TEST, chat_push.QUIET):
        log.info("chat push: %s (%s device(s))%s", state, took, f" — {why}" if why else "")
    return {"state": state, "took": took, "why": why}


async def _push_run(job: dict[str, str], delay: float) -> None:
    try:
        if delay > 0:
            await asyncio.sleep(delay)
        plan = await asyncio.to_thread(_push_plan, job)
        # a chat copy is high and never urgent: it is pushed only to someone with nothing open
        if plan is None or _push_live(plan["to_ids"]):
            return
        if job.get("confirm_as") is not None and not await _push_confirm(job, plan):
            return
        got = await _push_deliver(plan)
    except Exception as exc:  # noqa: BLE001
        log.warning("chat push: a message could not be pushed (%s)", type(exc).__name__)
        return
    if got is not None and got.get("state") != chat_push.NO_DEVICE:
        _push_rate.claim(plan["rate_key"])
        _PUSH_SAID["last"] = str(got.get("state") or "")


# ---- the cortex chat ---------------------------------------------------------------------------------------------

def _refused(env: dict[str, Any]) -> Response:
    return Response(content=json.dumps(env), status_code=env["status"], media_type="application/json",
                    headers=_stamp({}))


async def _cortex_gate(authorization: str, live: bool = False) -> tuple[Any, dict[str, Any] | None]:
    """The session check every cortex route shares: (session, error-or-None). A route that asks the cortex itself
    (`live`: the send, the voice) is told RETIRED while no cortex is named; the transcripts are the Hub's own."""
    s = await _session(_bearer(authorization))
    if s is None or not s.ok:
        return None, dict(AUTH_REQUIRED)
    if live and not CORTEX_URL:
        return None, dict(RETIRED)
    if live and not CORTEX_KEY:
        return None, {"status": 503, "message": "The cortex door is not configured on this server."}
    return s, None


async def _cortex_who(s: Any) -> str:
    """The cortex-facing identity of the session (app/cortex.py cortexWho), or "" when unknown."""
    try:
        got = await front_door.call_app("cortex", "cortexWho", _user_of(s), {})
    except Exception as exc:  # noqa: BLE001
        log.info("cortex: the session's account was not named by Python (%s)", type(exc).__name__)
        return ""
    env = got[2] if got is not None else None
    who = str(((env or {}).get("data") or {}).get("who") or "").strip() if (env or {}).get("status") == 200 else ""
    if not who:
        log.info("cortex: the session's account was not named by Python (%s)", (env or {}).get("status"))
    return who


async def _cortex_caller(request: Request, post: bool) -> tuple[str, Response | None]:
    authorization = str(request.headers.get("authorization") or "")
    if post:
        refused = _switched_post(await _session(_bearer(authorization)))
        if refused is not None:
            return "", refused
    # a post asks the cortex itself (the voice); a get reads the transcripts kept here
    s, refused_env = await _cortex_gate(authorization, live=post)
    if refused_env is not None:
        return "", _refused(refused_env)
    who = await _cortex_who(s)
    if not who:
        return "", _refused(dict(AUTH_REQUIRED))
    return who, None


async def cortex_chat_send(request: Request) -> Response:
    """One Dialog3 turn for a signed-in Hub user — SSE in, SSE out."""
    import httpx  # noqa: PLC0415
    from fastapi.responses import StreamingResponse  # noqa: PLC0415

    authorization = str(request.headers.get("authorization") or "")
    refused = _switched_post(await _session(_bearer(authorization)))
    if refused is not None:
        return refused
    s, refused_env = await _cortex_gate(authorization, live=True)
    if refused_env is not None:
        return _refused(refused_env)
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    message = str((body or {}).get("message") or "").strip()[:4000]
    if not message:
        return _refused({"status": 400, "message": "message required"})
    # the browser mints and keeps its own session id (DLG-hub-…)
    session_id = re.sub(r"[^A-Za-z0-9_-]", "", str((body or {}).get("session_id") or ""))[:64]
    who = await _cortex_who(s)
    if not who:
        return _refused(dict(AUTH_REQUIRED))
    log.info("cortex chat: send for %s (session %s, %d chars)", who, session_id or "new", len(message))
    upstream_body: dict[str, Any] = {"message": message, "user_id": who}
    if session_id:
        upstream_body["session_id"] = session_id
    client = httpx.AsyncClient(timeout=httpx.Timeout(CORTEX_TIMEOUT, connect=10.0))
    try:
        req = client.build_request("POST", f"{CORTEX_URL}/v1/cortex/dialog/send", json=upstream_body,
                                   headers={"Authorization": f"Bearer {CORTEX_KEY}"})
        upstream = await client.send(req, stream=True)
    except Exception as exc:  # noqa: BLE001
        await client.aclose()
        log.warning("cortex chat: upstream unreachable for %s: %s", who, str(exc)[:120])
        return _refused({"status": 502, "message": "The cortex did not answer."})
    if upstream.status_code != 200:
        detail = (await upstream.aread())[:200]
        await upstream.aclose()
        await client.aclose()
        log.warning("cortex chat: upstream %s for %s: %r", upstream.status_code, who, detail)
        return Response(content=json.dumps({"status": 502,
                                            "message": f"The cortex refused the turn ({upstream.status_code})."}),
                        status_code=502, media_type="application/json", headers=_stamp({}))

    async def stream() -> Any:
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers=_stamp({"Cache-Control": "no-store", "X-Accel-Buffering": "no"}))


async def cortex_voice_transcribe(request: Request) -> Response:
    """One audio clip in, the transcript out."""
    import httpx  # noqa: PLC0415

    who, refused = await _cortex_caller(request, post=True)
    if refused is not None:
        return refused
    body = await request.body()
    if not body:
        return _refused({"status": 400, "message": "no audio in the request"})
    ctype = request.headers.get("content-type", "")
    if "multipart/form-data" not in ctype:
        return _refused({"status": 400, "message": "multipart/form-data with an 'audio' field"})
    bias = "1" if request.query_params.get("bias") in ("1", "true") else ""
    url = f"{CORTEX_URL}/v1/cortex/dialog/voice/transcribe" + ("?bias=1" if bias else "")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(CORTEX_TIMEOUT, connect=10.0)) as client:
            upstream = await client.post(url, content=body, headers={"Content-Type": ctype,
                                                                     "Authorization": f"Bearer {CORTEX_KEY}"})
    except Exception as exc:  # noqa: BLE001
        log.warning("cortex voice: transcribe unreachable for %s: %s", who, str(exc)[:120])
        return _refused({"status": 502, "message": "The cortex did not answer."})
    if upstream.status_code != 200:
        log.warning("cortex voice: transcribe upstream %s for %s", upstream.status_code, who)
        return _refused({"status": 502, "message": f"The cortex refused the audio ({upstream.status_code})."})
    log.info("cortex voice: transcribed for %s (%d bytes)", who, len(body))
    return Response(content=upstream.content, status_code=200, media_type="application/json", headers=_stamp({}))


async def cortex_voice_speak(request: Request) -> Response:
    """One reply in, its audio out."""
    import httpx  # noqa: PLC0415

    who, refused = await _cortex_caller(request, post=True)
    if refused is not None:
        return refused
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    text = str((body or {}).get("text") or "").strip()[:4000]
    if not text:
        return _refused({"status": 400, "message": "text required"})
    upstream_body: dict[str, Any] = {"text": text}
    for k in ("voice", "format", "message_id"):
        if (body or {}).get(k) is not None:
            upstream_body[k] = body[k]
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(CORTEX_TIMEOUT, connect=10.0)) as client:
            upstream = await client.post(f"{CORTEX_URL}/v1/cortex/dialog/voice/speak", json=upstream_body,
                                         headers={"Authorization": f"Bearer {CORTEX_KEY}"})
    except Exception as exc:  # noqa: BLE001
        log.warning("cortex voice: speak unreachable for %s: %s", who, str(exc)[:120])
        return _refused({"status": 502, "message": "The cortex did not answer."})
    ctype = upstream.headers.get("content-type", "application/json")
    if upstream.status_code != 200 or "audio" not in ctype:
        log.warning("cortex voice: speak upstream %s for %s", upstream.status_code, who)
        return Response(content=upstream.content, status_code=502, media_type="application/json",
                        headers=_stamp({}))
    log.info("cortex voice: spoke %d chars for %s", len(text), who)
    passthrough = {k: v for k, v in upstream.headers.items() if k.lower() in ("x-tts-lane", "x-tts-latency-ms")}
    return Response(content=upstream.content, status_code=200, media_type=ctype,
                    headers=_stamp({**passthrough, "Cache-Control": "no-store"}))


def _ro_rows(sql: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
    """Rows of the cortex's transcripts, the Hub's own in asa-hub-db since 2026-10-27 (app.asa_cortex_dialog_messages)."""
    import mw_relay_state as RS  # noqa: PLC0415

    return RS.query(sql, args)


DIALOGS_SQL = """
    with mine as (
        select session_id, role, content, created_at, id
          from asa_cortex_dialog_messages
         where user_id = %s
    ),
    latest as (
        select session_id,
               count(*)            as turns,
               max(created_at)     as last_at,
               min(created_at)     as first_at
          from mine
         group by session_id
         order by max(created_at) desc
         limit %s
    )
    select l.session_id, l.turns, l.last_at, l.first_at,
           (select m.content
              from mine m
             where m.session_id = l.session_id and m.role = 'user'
             order by m.id
             limit 1) as opener
      from latest l
     order by l.last_at desc
"""
TURNS_SQL = """
    select role, content, created_at
      from asa_cortex_dialog_messages
     where user_id = %s and session_id = %s
     order by id
     limit %s
"""


def _dialog_list(who: str) -> list[dict[str, Any]]:
    """This person's dialogs, newest first: id, title, turns, when."""
    out: list[dict[str, Any]] = []
    for r in _ro_rows(DIALOGS_SQL, (who, CORTEX_DIALOG_MAX)):
        opener = " ".join(str(r["opener"] or "").split())[:CORTEX_TITLE_CHARS]
        out.append({"id": r["session_id"], "title": opener or "Conversation", "turns": int(r["turns"] or 0),
                    "at": r["last_at"].isoformat() if r["last_at"] else "",
                    "started_at": r["first_at"].isoformat() if r["first_at"] else ""})
    return out


def _dialog_turns(who: str, session_id: str) -> list[dict[str, Any]]:
    """The turns of ONE dialog — and only if it is this person's."""
    return [{"role": "assistant" if str(r["role"]) != "user" else "user", "text": str(r["content"] or ""),
             "at": r["created_at"].isoformat() if r["created_at"] else ""}
            for r in _ro_rows(TURNS_SQL, (who, session_id, CORTEX_TURN_MAX))]


NO_STORE = {"status": 503, "message": "The transcript store is not configured on this server."}
STORE_DOWN = {"status": 502, "message": "The transcript store did not answer."}


async def cortex_chat_dialogs(request: Request) -> Response:
    """Every conversation this person has had with the cortex, newest first."""
    who, refused = await _cortex_caller(request, post=False)
    if refused is not None:
        return refused
    try:
        dialogs = await asyncio.to_thread(_dialog_list, who)
    except Exception as exc:  # noqa: BLE001
        log.warning("cortex dialogs: list failed for %s: %s", who, str(exc)[:160])
        return _refused(dict(STORE_DOWN))
    return Response(content=json.dumps({"status": 200, "data": {"dialogs": dialogs}}), status_code=200,
                    media_type="application/json", headers=_stamp({}))


async def cortex_chat_dialog_turns(session_id: str, request: Request) -> Response:
    """One conversation, turn by turn — this person's own, or nothing."""
    who, refused = await _cortex_caller(request, post=False)
    if refused is not None:
        return refused
    sid = re.sub(r"[^A-Za-z0-9_-]", "", str(session_id or ""))[:64]
    if not sid:
        return _refused({"status": 400, "message": "Which conversation?"})
    try:
        turns = await asyncio.to_thread(_dialog_turns, who, sid)
    except Exception as exc:  # noqa: BLE001
        log.warning("cortex dialogs: turns failed for %s/%s: %s", who, sid, str(exc)[:160])
        return _refused(dict(STORE_DOWN))
    # an empty list is the answer for "not yours" and for "no turns" alike
    return Response(content=json.dumps({"status": 200, "data": {"id": sid, "turns": turns}}), status_code=200,
                    media_type="application/json", headers=_stamp({}))


# ---- health and the doors ------------------------------------------------------------------------------------------

def health() -> dict[str, Any]:
    """Counts only: refs, tickets, streams, execs by action, the hub feed, the cache and the kept sends."""
    return {"keyed": bool(CHAT_KEY), **_refs.counts(), "streams": sum(len(s) for s in _subs.values()),
            "unsettled": len(_unsettled), "by_action": dict(_by_action), "feed": _feed.health(),
            "folds_unreadable": _fold.unreadable, "frame_held": _FRAME["held"],
            "cache": {**_cache.counts(), **_cache_said, "reading": len(_cache_busy)},
            "behind": {**_behind.counts(), **_behind_said, "disk": _behind_where["disk"],
                       "lanes": sum(1 for task in _behind_lanes.values() if not task.done())},
            "push": {**_push_hub.counts(), "last": _PUSH_SAID["last"]}}


def install(app: Any) -> None:
    """The chat's doors on main.py's app, ahead of the relay carrier; the chat page's /gas actions as front door
    rungs; and the front door's word when held verdicts go."""
    app.get("/chat/stream", include_in_schema=False)(chat_stream)
    app.post("/chat/beat", include_in_schema=False)(chat_beat)
    app.post("/chat/ticket", include_in_schema=False)(chat_ticket)
    app.post("/chat/ticket/redeem", include_in_schema=False)(chat_ticket_redeem)
    app.post("/chat/exec", include_in_schema=False)(chat_exec)
    app.post("/chat/refs", include_in_schema=False)(chat_refs)
    app.post("/chat/gate", include_in_schema=False)(chat_gate)
    app.post("/cortex/chat/send", include_in_schema=False)(cortex_chat_send)
    app.post("/cortex/chat/voice/transcribe", include_in_schema=False)(cortex_voice_transcribe)
    app.post("/cortex/chat/voice/speak", include_in_schema=False)(cortex_voice_speak)
    app.get("/cortex/chat/dialogs", include_in_schema=False)(cortex_chat_dialogs)
    app.get("/cortex/chat/dialogs/{session_id}", include_in_schema=False)(cortex_chat_dialog_turns)
    for action in PY_ACTIONS:
        front_door.RUNGS[action] = gas_rung
    if _sessions_forgotten not in front_door.SESSIONS_FORGOTTEN:
        front_door.SESSIONS_FORGOTTEN.append(_sessions_forgotten)
