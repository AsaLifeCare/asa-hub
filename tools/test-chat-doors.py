#!/usr/bin/env python3
"""app/chat_doors.py served by uvicorn on loopback inside asa-hub-snapshot (httpx, fastapi and uvicorn are there;
asa-hub-app is never exec'd into), with the real chat_live, chat_push and relay_carrier, and stand-ins for the front
door's verdicts, app/chat.py, the users copy, the relay (its stream and its /chat/push), the live hub and the cortex:
each moved door asked once as it should answer and once as it must refuse, the stream unbuffered with its pings and
the relay's frames, a send told to the other end's stream, a kept send written behind, a push handed to the relay, and
a stream ended when its session is.

    python3 tools/test-chat-doors.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNER = "asa-hub-snapshot"

STANDINS = r'''
import json, time, types
from dataclasses import dataclass

# ---- front_door: the verdicts by token, the rungs, the listeners --------------------------------------------------
fd = types.ModuleType("front_door")

@dataclass(frozen=True)
class Session:
    ok: bool
    role: str = ""
    uid: str = ""
    is_master: bool = False
    acting: bool = False
    worn: str = ""
    until: float = 0.0

    @property
    def master(self):
        return self.ok and self.role == "admin" and not self.acting and self.is_master

SESSIONS = {"tA": Session(True, "staff", "u1"), "tB": Session(True, "staff", "u2"),
            "tS": Session(True, "staff", "u2", acting=True), "tX": Session(False)}
fd.Session, fd.SESSIONS, fd.RUNGS, fd.SESSIONS_FORGOTTEN = Session, SESSIONS, {}, []

async def session(token):
    return SESSIONS.get(token)

def held_session(token):
    return SESSIONS.get(token)

def verdict(token):
    return SESSIONS.get(token)

def forget_sessions(uids=None):
    for told in list(fd.SESSIONS_FORGOTTEN):
        told(None if uids is None else frozenset(uids))

async def call_app(app_id, action, user, payload, write_id="", at=0.0):
    env = {"status": 200, "data": {"who": user["uid"] + "@asa"}}
    return json.dumps(env).encode(), time.time(), env, None, 0.0

fd.session, fd.held_session, fd.verdict, fd.forget_sessions, fd.call_app = session, held_session, verdict, forget_sessions, call_app

class Resp:
    def __init__(self, env, status=200):
        self.body, self.status_code = json.dumps(env).encode(), status

CALLS = []

def run_chat(action, said, payload, write_id):
    import chat_live
    CALLS.append((action, dict(said), dict(payload), write_id))
    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    if action == "chatSend":
        if said.get("acting"):
            return Resp({"status": 409, "message": "no"})
        data = {"id": chat_live.message_id_for(write_id, said["uid"]), "created_at": now,
                "thread_key": chat_live.pair_key(said["uid"], payload["to_user"]), "to_user": payload["to_user"]}
        return Resp({"status": 200, "data": data})
    if action == "chatOverview":
        return Resp({"status": 200, "data": {"threads": [], "people": [], "unread": 0}})
    if action == "chatMessages":
        return Resp({"status": 200, "data": {"messages": []}})
    return Resp({"status": 200, "data": {"unread": 0, "latest": None}})

fd.M = types.SimpleNamespace(_run_chat=run_chat, DB=None, DRIVE=None, CHAT_STORE=None)

# ---- the users copy, the gate's switches, the relay's tables ------------------------------------------------------
loc = types.ModuleType("locations")
class Reads:
    def __init__(self, db, drive):
        pass
    def users(self):
        return [{"user_id": "u1", "display_name": "Ana", "home_tenant": "", "role": "staff"},
                {"user_id": "u2", "display_name": "Bo", "home_tenant": "", "role": "staff"},
                {"user_id": "u3", "display_name": "Cy", "home_tenant": "", "role": "staff"}]
    def config(self):
        return {}
loc.Reads = Reads
cl = types.ModuleType("config_lane")
cl.situation_switches = lambda reads, ids: {i: False for i in ids}
cl.test_mode = lambda cfg: {"on": True}
rs = types.ModuleType("mw_relay_state")
rs.moved = lambda: False
MODULES = {"front_door": fd, "locations": loc, "config_lane": cl, "mw_relay_state": rs}
'''

DRIVER = r'''
import asyncio, json, os, socket, sys, tempfile, threading, time, types
blob = json.loads(sys.stdin.read())
tmp = tempfile.mkdtemp()
RELAY_PORT, APP_PORT, HUB_PORT, CORTEX_PORT = 18391, 18392, 18393, 18394
os.environ.update({"HUB_RELAY_URL": f"http://127.0.0.1:{RELAY_PORT}", "HUB_CHAT_URL": f"http://127.0.0.1:{HUB_PORT}",
                   "HUB_CORTEX_URL": f"http://127.0.0.1:{CORTEX_PORT}", "HUB_SERVICE_SECRET": "s3cret",
                   "ASA_MASTER_KEY": "cortex-key", "HUB_APP_PACK_DIR": tmp,
                   "HUB_APP_CHAT_CACHE_DIR": tmp + "/app-chat", "HUB_APP_CHAT_BEHIND_DIR": tmp + "/app-chat-behind"})
os.environ.pop("HUB_RELAY_RO_DSN", None)
stand = {}
exec(compile(blob["standins"], "standins", "exec"), stand)
for name, mod in stand["MODULES"].items():
    sys.modules[name] = mod
for name in ("chat_live", "chat_push", "relay_carrier", "chat_doors"):
    mod = types.ModuleType(name)
    mod.__file__ = f"/app/{name}.py"
    sys.modules[name] = mod
    exec(compile(blob[name], f"{name}.py", "exec"), mod.__dict__)
import httpx, uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
cd, chat_live, fd = sys.modules["chat_doors"], sys.modules["chat_live"], sys.modules["front_door"]
cd.PING_S = 1.0
KEY = chat_live.derive_key("s3cret")

results = []
def check(name, ok, detail=None):
    results.append((name, bool(ok)))
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok or detail is None else f" — {detail}"))

# ---- the relay: its stream (a hub frame, a notice), its push door ----------------------------------------------
relay = FastAPI()
seen = {"streams": [], "pushes": []}

@relay.get("/chat/stream")
async def relay_stream(request: Request):
    seen["streams"].append({k: request.headers.get(k) for k in ("authorization", "x-hub-notices", "x-hub-strip")})
    async def gen():
        yield b": open\n\n"
        yield b'data: {"kind": "hub", "phase": "ready"}\n\n'
        await asyncio.sleep(0.2)
        yield b'data: {"kind":"notice","notice":{"id":7}}\n\n'
        while True:
            await asyncio.sleep(0.5)
            yield b": ping\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")

@relay.post("/chat/push")
async def relay_push(request: Request):
    seen["pushes"].append((request.headers.get("x-hub-chat-key"), await request.json()))
    return JSONResponse({"status": 200, "data": {"state": "sent", "took": 1, "why": ""}})

hub = FastAPI()
events = []

@hub.post("/internal/event")
async def hub_event(request: Request):
    events.append((request.headers.get("x-hub-chat-key"), await request.json()))
    return JSONResponse({"ok": True})

cortex = FastAPI()

@cortex.post("/v1/cortex/dialog/send")
async def cortex_send(request: Request):
    body = await request.json()
    async def gen():
        yield f"data: {json.dumps({'echo': body['message'], 'user': body['user_id']})}\n\n".encode()
        yield b"data: [DONE]\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")

@cortex.post("/v1/cortex/dialog/voice/transcribe")
async def cortex_transcribe(request: Request):
    return JSONResponse({"text": "hello"})

app = FastAPI()
cd.install(app)

@app.post("/gas")
async def gas(request: Request):
    raw = await request.body()
    env = json.loads(raw)
    return await fd.RUNGS[env["action"]](env, raw, request)

def serve(asgi, port):
    server = uvicorn.Server(uvicorn.Config(asgi, host="127.0.0.1", port=port, log_level="error", lifespan="off"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            return
        except OSError:
            time.sleep(0.05)
    raise RuntimeError(f"port {port} never opened")

for asgi, port in ((relay, RELAY_PORT), (hub, HUB_PORT), (cortex, CORTEX_PORT), (app, APP_PORT)):
    serve(asgi, port)
base = f"http://127.0.0.1:{APP_PORT}"
H = lambda t: {"Authorization": f"Bearer {t}"}

async def read_stream(token, until_s, out, headers=None):
    """The frames a stream sends, each with when it arrived."""
    began = time.monotonic()
    async with httpx.AsyncClient(timeout=None) as c:
        async with c.stream("GET", base + "/chat/stream", headers={**H(token), **(headers or {})}) as r:
            out["status"], out["headers"] = r.status_code, dict(r.headers)
            out["frames"] = []
            buf = b""
            try:
                async for chunk in r.aiter_raw():
                    buf += chunk
                    while b"\n\n" in buf:
                        frame, buf = buf.split(b"\n\n", 1)
                        out["frames"].append((round(time.monotonic() - began, 2), frame.decode()))
                    if time.monotonic() - began > until_s:
                        break
                out["ended"] = True
            except Exception as exc:  # noqa: BLE001
                out["error"] = type(exc).__name__

async def main():
    async with httpx.AsyncClient(timeout=20) as c:
        # ---- the stream: refused, then open with the relay's frames, pings, a send, and its session's end ----
        r = await c.get(base + "/chat/stream")
        check("stream: no bearer is 401", r.status_code == 401, r.status_code)
        b_stream = {}
        tb = asyncio.ensure_future(read_stream("tB", 30, b_stream, {"X-Hub-Notices": "1", "X-Hub-Strip": "1"}))
        await asyncio.sleep(2.6)
        frames = [f for _at, f in b_stream.get("frames", [])]
        check("stream: 200 text/event-stream, unbuffered", b_stream.get("status") == 200
              and b_stream["headers"].get("content-type", "").startswith("text/event-stream")
              and b_stream["headers"].get("x-accel-buffering") == "no" and frames[:1] == [": open"], b_stream)
        check("stream: the relay's hub frame and notice reach it, its pings do not",
              'data: {"kind": "hub", "phase": "ready"}' in frames and any('"kind":"notice"' in f for f in frames)
              and seen["streams"] and seen["streams"][0]["x-hub-notices"] == "1"
              and seen["streams"][0]["authorization"] == "Bearer tB", (frames, seen["streams"]))
        await asyncio.sleep(1.5)
        frames = [f for _at, f in b_stream.get("frames", [])]
        check("stream: an idle strip tab is kept alive by the hub frame", frames.count(
            'data: {"kind": "hub", "phase": "ready"}') >= 2, frames)
        a_stream = {}
        ta = asyncio.ensure_future(read_stream("tA", 30, a_stream))
        await asyncio.sleep(2.3)
        check("stream: an idle tab without the strip gets ': ping' each PING_S",
              [f for _at, f in a_stream.get("frames", [])].count(": ping") >= 1, a_stream.get("frames"))

        # ---- the beat ----
        r = await c.post(base + "/chat/beat", headers=H("tX"))
        check("beat: an ended session is 401", r.status_code == 401, r.status_code)
        r = await c.post(base + "/chat/beat", headers=H("tB"))
        j = r.json()
        check("beat: me, its name, live while its stream is open", j.get("ok") and j.get("me") == "u2"
              and j.get("me_name") == "Bo" and j.get("live") is True and "notices" in j
              and r.headers.get("x-hub-phase") == "ready", j)

        # ---- the chat page's /gas: a send told to the other end's stream ----
        r = await c.post(base + "/gas", content=json.dumps({"token": "tS", "action": "chatSend",
                                                            "payload": {"to_user": "u1", "body": "hi"}}))
        check("gas: a switched session's send is refused in the chat's words", r.json().get("code")
              == "be_another_refused" and r.json().get("reason") == "acting", r.text)
        r = await c.post(base + "/gas", content=json.dumps({"token": "tA", "action": "chatSend",
                                                            "payload": {"to_user": "u2", "body": "hello"}}))
        j = r.json()
        await asyncio.sleep(0.3)
        heard = [f for _at, f in b_stream.get("frames", []) if '"kind":"chatSend"' in f]
        check("gas: chatSend answered by the chat, with a write id", j.get("status") == 200
              and stand["CALLS"][-1][0] == "chatSend" and stand["CALLS"][-1][3].startswith("W"), j)
        check("gas: the recipient's stream hears it", heard and json.loads(heard[-1][5:])["from_user"] == "u1",
              heard)
        check("gas: the hub is nudged", any(e[1].get("kind") == "nudge" and e[1].get("to") == ["u2"] and e[0] == KEY
                                            for e in events), events)
        r = await c.post(base + "/chat/beat", headers=H("tB"))
        check("beat: a send waiting for them makes it due", r.json().get("dirty") is True, r.json())

        # ---- live chat's ticket and the hub's doors ----
        r = await c.post(base + "/chat/ticket", headers={**H("tS"), "X-Hub-Tenant": ""}, content="{}")
        check("ticket: a switched session's POST is refused 409", r.status_code == 409
              and r.json().get("message", "").startswith("Not in a switched session"), r.text)
        cd._access = lambda s: {"open": True, "reason": "", "why": "badge"}
        r = await c.post(base + "/chat/ticket", headers={**H("tA"), "X-Hub-Tenant": ""}, content="{}")
        ticket = r.json().get("data", {}).get("ticket", "")
        check("ticket: minted for the session", r.status_code == 200 and ticket, r.text)
        r = await c.post(base + "/chat/ticket/redeem", json={"ticket": ticket}, headers={"X-Hub-Chat-Key": "no"})
        check("redeem: a wrong key is 401", r.status_code == 401 and r.json().get("reason") == "key", r.text)
        r = await c.post(base + "/chat/ticket/redeem", json={"ticket": ticket}, headers={"X-Hub-Chat-Key": KEY})
        got = r.json().get("data") or {}
        ref = got.get("ref", "")
        check("redeem: the ref and whose it is", r.status_code == 200 and got.get("account_id") == "u1"
              and got.get("name") == "Ana" and ref, r.text)
        r = await c.post(base + "/chat/exec", json={"ref": "x" * 30, "action": "chatOverview"},
                         headers={"X-Hub-Chat-Key": KEY})
        check("exec: an unknown ref is refused", r.status_code == 200 and r.json().get("reason") == "ref_unknown",
              r.text)
        r = await c.post(base + "/chat/exec", json={"ref": ref, "action": "chatSend", "client_id": "c" * 12,
                                                    "payload": {"to_user": "u3", "body": "first"}},
                         headers={"X-Hub-Chat-Key": KEY})
        j = r.json()
        check("exec: a send answered by the chat (behind learns the id rule)", j.get("status") == 200
              and not j.get("behind") and "frame_held" in j and cd._behind.on, j)
        await asyncio.sleep(0.5)
        check("push: a send to someone with nothing open is handed to the relay's /chat/push",
              any(p[0] == KEY and p[1]["plan"]["to_person"] == "u3" and p[1]["plan"]["from_name"] == "Ana"
                  for p in seen["pushes"]), seen["pushes"])
        n = len(stand["CALLS"])
        r = await c.post(base + "/chat/exec", json={"ref": ref, "action": "chatSend", "client_id": "d" * 12,
                                                    "payload": {"to_user": "u2", "body": "kept"}},
                         headers={"X-Hub-Chat-Key": KEY})
        j = r.json()
        await asyncio.sleep(0.5)
        words = [f for _at, f in b_stream.get("frames", []) if '"body":"kept"' in f]
        check("exec: the next send is kept here first, told at once and written behind", j.get("behind") is True
              and words and any(cl[0] == "chatSend" and cl[2].get("body") == "kept" for cl in stand["CALLS"][n:])
              and cd._behind.counts()["waiting"] == 0, (j, words))
        r = await c.post(base + "/chat/gate", headers={"X-Hub-Chat-Key": "no"})
        check("gate: a wrong key is 401", r.status_code == 401, r.status_code)
        r = await c.post(base + "/chat/gate", headers={"X-Hub-Chat-Key": KEY})
        check("gate: the frame gate as held here", r.json() == {"status": 200, "frame_held": False}, r.text)
        r = await c.post(base + "/chat/refs", json={"refs": [ref]}, headers={"X-Hub-Chat-Key": "no"})
        check("refs: a wrong key is 401", r.status_code == 401, r.status_code)
        r = await c.post(base + "/chat/refs", json={"refs": [ref, "y" * 30]}, headers={"X-Hub-Chat-Key": KEY})
        check("refs: a live session stays, an unknown ref is said", r.json().get("data") == {
            "unknown": ["y" * 30], "revoked": []}, r.text)

        # ---- the cortex chat ----
        r = await c.post(base + "/cortex/chat/send", json={"message": "hi"})
        check("cortex send: no bearer is 401", r.status_code == 401 and r.json()["status"] == 401, r.text)
        r = await c.post(base + "/cortex/chat/send", json={"message": "hi", "session_id": "DLG-hub-1"},
                         headers=H("tA"))
        check("cortex send: the cortex's SSE carried, as the session's account",
              r.status_code == 200 and r.headers.get("content-type", "").startswith("text/event-stream")
              and '"user": "u1@asa"' in r.text and "[DONE]" in r.text, r.text)
        r = await c.post(base + "/cortex/chat/voice/transcribe", content=b"x", headers=H("tA"))
        check("cortex transcribe: not multipart is 400", r.status_code == 400, r.text)
        r = await c.post(base + "/cortex/chat/voice/transcribe", files={"audio": ("a.webm", b"xx")}, headers=H("tA"))
        check("cortex transcribe: the transcript carried", r.status_code == 200 and r.json() == {"text": "hello"},
              r.text)
        r = await c.post(base + "/cortex/chat/voice/speak", json={}, headers=H("tA"))
        check("cortex speak: no text is 400", r.status_code == 400, r.text)
        r = await c.get(base + "/cortex/chat/dialogs", headers=H("tA"))
        check("cortex dialogs: without the transcript store said 503", r.status_code == 503, r.text)
        r = await c.get(base + "/cortex/chat/dialogs/DLG-1", headers=H("tX"))
        check("cortex dialog turns: an ended session is 401", r.status_code == 401, r.text)

        # ---- a session that ends: its streams end and its refs are revoked ----
        fd.SESSIONS["tA"] = fd.Session(False)
        fd.forget_sessions(None)
        await asyncio.sleep(0.8)
        check("stream: ended when its session is", a_stream.get("ended") is True and not ta.cancelled()
              and ta.done(), a_stream)
        check("refs: its live chat refs revoked at the hub", any(e[1].get("kind") == "revoke" and ref in
                                                               e[1].get("refs", []) for e in events), events)
        check("stream: another session's stream stays open", not tb.done())
        tb.cancel()
        await asyncio.sleep(0.5)
        check("stream: a tab that leaves takes its subscriber with it", "u2" not in cd._subs, list(cd._subs))

asyncio.run(main())
bad = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(bad)}/{len(results)} passed")
sys.exit(1 if bad else 0)
'''


def main() -> int:
    blob = {"standins": STANDINS,
            **{name: (ROOT / "app" / f"{name}.py").read_text() for name in
               ("chat_live", "chat_push", "relay_carrier", "chat_doors")}}
    return subprocess.run(["docker", "exec", "-i", RUNNER, "python", "-c", DRIVER],
                          input=json.dumps(blob).encode()).returncode


if __name__ == "__main__":
    sys.exit(main())
