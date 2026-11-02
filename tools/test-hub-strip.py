#!/usr/bin/env python3
"""
"NEW VERSION LAUNCHED, TRANSFERRING..." — the relay's half of the strip at the
top of every tab, asserted against the real code in server/snapshot_service.py.

WHAT IT PROVES:

  S1  the phase machine: `warming` from the moment the process starts until
      its first FULL build pass ends; `engine` when a NEW Apps Script build
      answers (the first build a process learns is not a change), back to
      `ready` only at the end of a full pass that decided what to re-ask
      AFTER the change — a second build while one is being taken in moves
      that clock
  S2  a change is one hub frame, handed ONLY to streams that said they draw
      the strip — an older bundle hands any frame it does not know to its
      chat listeners
  S3  a new SPA build: the served index.html naming a different bundle is one
      frame at once; the first look only learns the bundle; an unchanged or
      unreadable file says nothing; from then on EVERY frame names the bundle
  S4  the loops, run: the builder's loop ends a phase on a full pass that
      raised or was abandoned — not one noted during that pass — and lives on;
      the web look runs on its own one-second clock, outside the builder, and
      survives an error; build_all measures the phase from the moment it
      decided what to re-ask
  S5  X-Hub-Phase on every answer, run against the middleware itself: a plain
      answer, a stream's head, and a 500 the app raised (answered stamped,
      then re-raised); a response already started is not answered twice; a
      websocket passes untouched
  L   in the relay's container, the checkout's module imported for real and
      driven through its own ASGI app: the stream's head carries the phase,
      its first frame after `: open` is the phase naming the bundle — only
      for a tab that asked; a phase change reaches that tab and not an older
      one; a frame lost on the way comes back with the keepalive; the 401,
      the 503 and a raised 500 carry X-Hub-Phase; /health says the phase

HOW IT RUNS: the pure half executes the functions, read out of the module's
own source, on the host; the lane half ships the checkout's server/ into the
relay's container over stdin and imports it in memory ahead of /srv/app, in a
/tmp folder of its own, removed at the end. Nothing reaches a table, Apps
Script or a person. A docker CLI that cannot reach the relay's container FAILS
the lane — a relay restarting under `npm run check` is not a pass;
HUB_STRIP_LANE=skip says out loud to run the pure half only. A machine with no
docker CLI at all skips it and says so.

    python3 tools/test-hub-strip.py
"""
import ast
import asyncio
import base64
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SERVER = ROOT / "server"
CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:600]}")


SVC = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
TREE = ast.parse(SVC)


def body_of(name: str) -> str:
    node = next(n for n in ast.walk(TREE) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                and n.name == name)
    return ast.get_source_segment(SVC, node) or ""


# ── the pieces, out of the module's own source ──────────────────────────────
NAMES = {"_HUB_PHASE", "HUB_WEB_INDEX", "HUB_WEB_EVERY_S", "_HUB_WEB", "_HUB_BUNDLE_RE",
         "_hub_frame", "_hub_fan", "_hub_phase", "_hub_full_pass_done", "_hub_web_tick",
         "_hub_web_loop", "_loop", "_HubPhaseHeader", "ENGINE_BUILD_PATH", "_engine_build_kept"}
KEPT_BUILDS: list[str] = []


def machine() -> dict[str, Any]:
    ns: dict[str, Any] = {"asyncio": asyncio, "json": json, "os": os, "re": re, "time": time,
                          "Path": Path, "Any": Any, "log": logging.getLogger("hub-strip-test"),
                          "_chat_subs": {}, "_event_loop": None, "_ENGINE_BUILD": "",
                          "_ADAPTER_SIZES": {}, "_hopeless": set(), "_engine_build_keep": KEPT_BUILDS.append}
    found = set()
    for node in TREE.body:
        name = (node.name if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
                else getattr(node.targets[0], "id", "") if isinstance(node, ast.Assign)
                else getattr(node.target, "id", "") if isinstance(node, ast.AnnAssign) else "")
        if name in NAMES:
            exec(compile(ast.Module(body=[node], type_ignores=[]), "snapshot_service.py", "exec"), ns)
            found.add(name)
    ns["_found"] = found
    return ns


class Q(asyncio.Queue):
    """A stream's queue, marked the way chat_stream marks it."""

    def __init__(self, strip: bool) -> None:
        super().__init__(maxsize=32)
        self.strip = strip


def frames(q: asyncio.Queue) -> list[dict]:
    out = []
    while not q.empty():
        out.append(json.loads(q.get_nowait()))
    return out


logging.getLogger("hub-strip-test").addHandler(logging.NullHandler())
logging.getLogger("hub-strip-test").propagate = False

print("S1/S2 — the phase machine and who hears it")
ns = machine()
check("the module holds every piece", ns["_found"] == NAMES, NAMES - ns["_found"])
loop = asyncio.new_event_loop()
ns["_event_loop"] = loop
new_tab, old_tab = Q(True), Q(False)
ns["_chat_subs"]["u1"] = {new_tab, old_tab}


def settle() -> None:
    loop.run_until_complete(asyncio.sleep(0))


P = ns["_HUB_PHASE"]
check("a process starts `warming`", P["phase"] == "warming", P)
ns["_hub_full_pass_done"](P["since"] - 1)
settle()
check("a pass that decided before the process began cannot end warming", P["phase"] == "warming", P)
ns["_hub_full_pass_done"](time.time())
settle()
check("the first full pass ends warming", P["phase"] == "ready", P)
got_new, got_old = frames(new_tab), frames(old_tab)
check("the change is ONE hub frame to the tab that draws the strip",
      got_new == [{"kind": "hub", "phase": "ready"}], got_new)
check("an older bundle's stream hears nothing", got_old == [], got_old)

check("no engine build is learned any more: the relay asks no engine for one", "_note_engine_build" not in SVC
      and "_engine_build_keep(" not in SVC)
decided_before = time.time()
time.sleep(0.01)
ns["_hub_phase"]("engine")
settle()
check("the `engine` phase, set, is told to the tab", P["phase"] == "engine"
      and frames(new_tab) == [{"kind": "hub", "phase": "engine"}], P)
with tempfile.TemporaryDirectory() as kept_dir:
    ns["ENGINE_BUILD_PATH"] = Path(kept_dir) / "engine-build.json"
    held_env = os.environ.pop("HUB_GAS_ENGINE_BUILD", None)
    check("nothing kept and nothing in the environment: no build, never a guessed one", ns["_engine_build_kept"]() == "")
    os.environ["HUB_GAS_ENGINE_BUILD"] = "2026-01-01T00:00:00Z"
    check("…the environment's, when it names one", ns["_engine_build_kept"]() == "2026-01-01T00:00:00Z")
    ns["ENGINE_BUILD_PATH"].write_text(json.dumps({"build": "9999-01-01T00:00:00Z"}))
    check("…and the kept build first, when one was kept", ns["_engine_build_kept"]() == "9999-01-01T00:00:00Z")
    ns["ENGINE_BUILD_PATH"].write_text("not json")
    check("an unreadable file is no build", ns["_engine_build_kept"]() == "2026-01-01T00:00:00Z")
    os.environ.pop("HUB_GAS_ENGINE_BUILD", None)
    if held_env is not None:
        os.environ["HUB_GAS_ENGINE_BUILD"] = held_env
check("the module starts from the kept build", "_ENGINE_BUILD = _engine_build_kept()" in SVC)
ns["_hub_full_pass_done"](decided_before)
check("a pass that decided what to re-ask BEFORE the change does not end it", P["phase"] == "engine", P)
first_since = P["since"]
time.sleep(0.01)
ns["_hub_phase"]("engine")
settle()
check("`engine` again while it holds moves the clock, with no second frame",
      P["phase"] == "engine" and P["since"] > first_since and frames(new_tab) == [], P)
ns["_hub_full_pass_done"](first_since + 0.001)
check("so a pass that decided between the two does not end it", P["phase"] == "engine", P)
ns["_hub_full_pass_done"](time.time())
settle()
check("a full pass that decided after the change ends it", P["phase"] == "ready", P)
check("told once", frames(new_tab) == [{"kind": "hub", "phase": "ready"}])
ns["_event_loop"] = None
ns["_hub_phase"]("engine")
check("no loop yet (import time): the phase is kept and nothing is fanned", P["phase"] == "engine")
ns["_hub_phase"]("ready")
ns["_event_loop"] = loop
full = Q(True)
for i in range(32):
    full.put_nowait(json.dumps({"kind": "chatSend", "i": i}))
ns["_chat_subs"]["u2"] = {full}
ns["_hub_phase"]("engine")
settle()
check("a full queue drops the frame rather than block the relay (the keepalive heals it, L)",
      full.qsize() == 32 and P["phase"] == "engine")
ns["_hub_phase"]("ready")
settle()
del ns["_chat_subs"]["u2"]
frames(new_tab)


print("\nS3 — a new SPA build on the served disk")
work = Path(tempfile.mkdtemp(prefix="hub-strip-test-"))
index = work / "index.html"
ns["HUB_WEB_INDEX"] = index
ns["_hub_web_tick"]()
check("no served file: nothing is said, nothing breaks", frames(new_tab) == [] and ns["_HUB_WEB"]["bundle"] == "")
index.write_text('<script type="module" crossorigin src="/assets/index-AAA111.js"></script>')
ns["_hub_web_tick"]()
settle()
check("the first look learns the bundle and announces nothing",
      ns["_HUB_WEB"]["bundle"] == "index-AAA111.js" and frames(new_tab) == [], ns["_HUB_WEB"])
ns["_hub_web_tick"]()
settle()
check("an unchanged file is one stat and nothing more", frames(new_tab) == [])
index.write_text('<script type="module" crossorigin src="/assets/index-BBB222.js"></script>')
os.utime(index, (time.time() + 5, time.time() + 5))
ns["_hub_web_tick"]()
settle()
got = frames(new_tab)
check("a different bundle is one frame at once, naming it, the phase alongside",
      got == [{"kind": "hub", "phase": "ready", "web": "index-BBB222.js"}], got)
check("an older bundle's stream hears nothing of it", frames(old_tab) == [])
index.write_text("<html>half written</html>")
os.utime(index, (time.time() + 10, time.time() + 10))
ns["_hub_web_tick"]()
settle()
check("a file naming no bundle (mid-copy) says nothing and forgets nothing",
      frames(new_tab) == [] and ns["_HUB_WEB"]["bundle"] == "index-BBB222.js", ns["_HUB_WEB"])
ns["_hub_phase"]("engine")
settle()
got = frames(new_tab)
check("from then on every frame names the served bundle — a lost frame or a restart mid-deploy hides nothing",
      got == [{"kind": "hub", "phase": "engine", "web": "index-BBB222.js"}]
      and json.loads(ns["_hub_frame"]()).get("web") == "index-BBB222.js", got)
ns["_hub_phase"]("ready")
settle()
frames(new_tab)
for f in work.iterdir():
    f.unlink()
work.rmdir()


print("\nS4 — the loops, run")


async def _noop(*a: Any, **k: Any) -> None:
    return None


def builder_loop(build: Any, seconds: float, timeout_s: float = 5.0) -> tuple[dict, bool]:
    """Run the module's own `_loop` against a stand-in build_all."""
    bns = machine()
    bl = asyncio.new_event_loop()
    bns.update(_dirty=set(), _dirty_at=0.0, DEBOUNCE_SECONDS=6, HEARTBEAT_SECONDS=300,
               BUILD_TIMEOUT_S=timeout_s, _config_lane_refresh=_noop, _event_loop=bl)
    bns["build_all"] = lambda only=None: build(bns, only)
    task = bl.create_task(bns["_loop"]())
    bl.run_until_complete(asyncio.sleep(seconds))
    alive = not task.done()
    task.cancel()
    try:
        bl.run_until_complete(task)
    except (asyncio.CancelledError, Exception):  # noqa: BLE001
        pass
    bl.close()
    return bns, alive


async def raising(bns: dict, only: Any) -> None:
    raise RuntimeError("the sheet is gone")


bns, alive = builder_loop(raising, 1.3)
check("a full pass that RAISED ends `warming` — a backend that cannot finish one is not a version arriving",
      bns["_HUB_PHASE"]["phase"] == "ready", bns["_HUB_PHASE"])
check("and the builder's loop lives on", alive)


async def hanging(bns: dict, only: Any) -> None:
    await asyncio.sleep(30)

bns, alive = builder_loop(hanging, 1.5, timeout_s=0.2)
check("a full pass ABANDONED at the ceiling ends it too, and the loop lives on",
      bns["_HUB_PHASE"]["phase"] == "ready" and alive, bns["_HUB_PHASE"])


async def noting_then_raising(bns: dict, only: Any) -> None:
    bns["_HUB_PHASE"].update(phase="ready")
    bns["_hub_phase"]("engine")             # the phase set DURING the pass
    raise RuntimeError("then the pass fails")

bns, alive = builder_loop(noting_then_raising, 1.3)
check("a change noted during a failed pass waits for the next one", bns["_HUB_PHASE"]["phase"] == "engine",
      bns["_HUB_PHASE"])

wns = machine()
wl = asyncio.new_event_loop()
ticks = {"n": 0}


def flaky_tick() -> None:
    ticks["n"] += 1
    if ticks["n"] == 1:
        raise ValueError("not an OSError")

wns.update(HUB_WEB_EVERY_S=0.05, _hub_web_tick=flaky_tick)
wtask = wl.create_task(wns["_hub_web_loop"]())
wl.run_until_complete(asyncio.sleep(0.4))
check("the web look survives an error and keeps looking, on its own clock",
      not wtask.done() and ticks["n"] >= 3, ticks)
wtask.cancel()
try:
    wl.run_until_complete(wtask)
except asyncio.CancelledError:
    pass
wl.close()
check("the look is a second, outside the builder (never held behind a 420 s pass), and asa-hub-app starts it "
      "(app/hub_strip.py), never the relay",
      ns["HUB_WEB_EVERY_S"] == 1.0 and "_hub_web_tick" not in body_of("_loop")
      and "asyncio.create_task(_hub_web_loop())" not in body_of("_start"))
build = body_of("build_all")
carry_end = build.find("carried_shaped: set[str] = {n for n in shaped_names if n not in from_python}")
decided = build.find("decided_at = time.time()")
fill = build.find("shaped = await _rows_from_python(from_python)")
check("build_all measures the phase from the moment it decided what to re-ask: after the carry, before the fill",
      0 < carry_end < decided < fill and "pass_started" not in build)
check("a shaped resource is Python's door's or its kept file, never Apps Script's adapter",
      "_rows_from_backend" not in SVC and "_ADAPTER_DEPS" not in SVC
      and 'raise RuntimeError("no Python door filled it and no file of it is kept")' in body_of("build_one"))
check("only a FULL pass ends a phase, as its last word after the index is written",
      re.search(r"if only is None:\n\s+_hub_full_pass_done\(decided_at\)", build) is not None
      and build.find("_hub_full_pass_done(decided_at)") > build.find("_write_atomic(index_path, payload)") > 0)
check("nothing polls Apps Script for it: the machine makes no call",
      not any(w in body_of(n) for n in ("_hub_phase", "_hub_full_pass_done", "_hub_web_tick", "_hub_fan",
                                         "_hub_web_loop")
              for w in ("_post_exec", "httpx", "EXEC_URL")))
pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
check("npm run check runs this file and the browser's half",
      "npm run test:hub-strip" in pkg["scripts"]["check"]
      and pkg["scripts"].get("test:hub-strip") == "python3 tools/test-hub-strip.py"
      and (ROOT / "tests/spa/hub-strip.test.tsx").is_file() and "npm run test:spa" in pkg["scripts"]["check"])
frames_ts = (ROOT / "src/lib/streamFrames.ts").read_text(encoding="utf-8")
check("the browser routes a hub frame as its own kind, and an unknown kind to nobody",
      "if (kind === 'hub') return 'hub'" in frames_ts and ": 'ignore'" in frames_ts)


print("\nS5 — X-Hub-Phase on every answer (the middleware, run)")
H = ns["_HubPhaseHeader"]
ns["_HUB_PHASE"]["phase"] = "warming"


async def drive(inner: Any, kind: str = "http") -> tuple[list, Any]:
    sent: list = []

    async def send(m: dict) -> None:
        sent.append(m)

    async def receive() -> dict:
        return {"type": "http.disconnect"}

    err = None
    try:
        await H(inner)({"type": kind}, receive, send)
    except Exception as exc:  # noqa: BLE001
        err = exc
    return sent, err


def said(m: dict) -> list:
    return [v for k, v in (m.get("headers") or []) if k == b"x-hub-phase"]


async def plain(scope: Any, receive: Any, send: Any) -> None:
    await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"application/json")]})
    await send({"type": "http.response.body", "body": b"{}"})

sent, err = loop.run_until_complete(drive(plain))
check("a plain answer says the phase, beside its own headers",
      err is None and said(sent[0]) == [b"warming"] and (b"content-type", b"application/json") in sent[0]["headers"],
      sent)


async def streaming(scope: Any, receive: Any, send: Any) -> None:
    await send({"type": "http.response.start", "status": 200})
    await send({"type": "http.response.body", "body": b": open\n\n", "more_body": True})
    await send({"type": "http.response.body", "body": b"data: {}\n\n", "more_body": True})

sent, err = loop.run_until_complete(drive(streaming))
check("a stream's head says it (a start with no headers of its own), the body passes as sent",
      said(sent[0]) == [b"warming"] and [m.get("body") for m in sent[1:]] == [b": open\n\n", b"data: {}\n\n"], sent)


async def boom(scope: Any, receive: Any, send: Any) -> None:
    raise RuntimeError("a route raised")

sent, err = loop.run_until_complete(drive(boom))
check("a 500 the app raised is answered HERE, stamped — the relay's own error, never 'the relay is gone'",
      len(sent) == 2 and sent[0]["status"] == 500 and said(sent[0]) == [b"warming"]
      and sent[1]["body"] == b"Internal Server Error", sent)
check("and still raised, so the server logs it as before", isinstance(err, RuntimeError), err)


async def boom_late(scope: Any, receive: Any, send: Any) -> None:
    await send({"type": "http.response.start", "status": 200, "headers": []})
    raise RuntimeError("mid-stream")

sent, err = loop.run_until_complete(drive(boom_late))
check("a response already started is never answered twice", [m["type"] for m in sent] == ["http.response.start"]
      and isinstance(err, RuntimeError), sent)


async def ws(scope: Any, receive: Any, send: Any) -> None:
    await send({"type": "websocket.accept"})

sent, err = loop.run_until_complete(drive(ws, "websocket"))
check("a websocket passes untouched", sent == [{"type": "websocket.accept"}], sent)
check("the app is wrapped by it", re.search(r"^app\.add_middleware\(_HubPhaseHeader\)$", SVC, re.M) is not None)
loop.close()


# ═══════════════════════════════════════════════════════════════════════════
# L — the checkout's module, imported for real in the relay's container
# ═══════════════════════════════════════════════════════════════════════════

LANE = r'''
import asyncio, base64, json, os, shutil, sys, tempfile, time
import importlib.abc, importlib.util

SRC = json.loads(base64.b64decode(HUB_STRIP_SOURCES))  # noqa: F821 — set by the host half


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        if name in SRC:
            return importlib.util.spec_from_loader(name, self, origin="checkout:" + name)
        return None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = "/srv/app/" + module.__name__ + ".py"
        exec(compile(SRC[module.__name__], "checkout/" + module.__name__ + ".py", "exec"), module.__dict__)


WORK = tempfile.mkdtemp(prefix="hub-strip-test-")
os.chmod(WORK, 0o700)
# NOTHING OF THE LIVE RELAY: its disk, its keys, its inbox, its clock probes.
os.environ["HUB_SNAPSHOT_OUT"] = WORK + "/out"
os.environ["HUB_WEB_MOCK_DIR"] = WORK + "/mock"
os.environ["HUB_WEBPUSH_VAPID_FILE"] = WORK + "/vapid.json"
os.environ["HUB_WEB_INDEX"] = WORK + "/index.html"
os.environ["QUO_HOTLINE_WEBHOOK_KEY_FILE"] = "/nonexistent/hub-strip-test.key"
os.environ["HUB_QUO_MESSAGES_KEY_FILE"] = "/nonexistent/hub-strip-test-messages.key"
os.environ["HUB_QUO_API_KEY_FILE"] = "/nonexistent/hub-strip-test-api.key"
os.environ["HUB_QUO_INBOX_DIR"] = WORK + "/quo-inbox"
os.environ["HUB_PSI_PROBE"] = "0"
os.environ["HUB_PSI_SECRET_FILE"] = "/nonexistent/hub-strip-test.json"
os.environ["HUB_PSI_TY_SECRET_FILE"] = "/nonexistent/hub-strip-test-ty.json"
os.environ["HUB_PSI_FULL_DIR"] = WORK + "/psi-full"
os.environ.pop("QUO_HOTLINE_WEBHOOK_KEY", None)
os.makedirs(WORK + "/out", exist_ok=True)
sys.meta_path.insert(0, Checkout())
sys.path.insert(0, "/srv/app")

OUT = {}
try:
    import snapshot_service as svc  # noqa: E402
    OUT["origin"] = getattr(svc.__spec__, "origin", "")
    OUT["at_import"] = svc._HUB_PHASE["phase"]
    OUT["web_index"] = [str(svc.HUB_WEB_INDEX) == WORK + "/index.html", os.path.isfile("/srv/web/index.html")]
    # the doors below must not reach Apps Script or a database
    async def _no_exec(*a, **k):
        raise RuntimeError("no Apps Script in this test")
    svc._post_exec = _no_exec
    svc._sheet_sync_health = lambda *a, **k: {}
    svc._form_digest_health = lambda *a, **k: {}

    async def _boom():
        raise RuntimeError("a route raised")
    svc.app.add_api_route("/__hub_strip_boom", _boom, methods=["GET"])

    # the stream's 25 s keepalive, shortened for this process only
    _real_wait_for = asyncio.wait_for

    def _quick(aw, timeout=None):
        return _real_wait_for(aw, 0.3 if timeout == 25 else timeout)
    asyncio.wait_for = _quick

    class Call:
        """One request through the app's own ASGI stack, middleware included."""

        def __init__(self, path, headers=None):
            self.status, self.headers, self.chunks, self.read = None, {}, [], 0
            self.more = asyncio.Event()
            scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"}, "http_version": "1.1",
                     "method": "GET", "scheme": "http", "path": path, "raw_path": path.encode(),
                     "query_string": b"", "root_path": "",
                     "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
                     "client": ("127.0.0.1", 50000), "server": ("127.0.0.1", 8080)}

            async def receive():
                await asyncio.sleep(3600)
                return {"type": "http.disconnect"}

            async def send(m):
                if m["type"] == "http.response.start":
                    self.status = m["status"]
                    self.headers = {k.decode().lower(): v.decode() for k, v in m.get("headers") or []}
                elif m["type"] == "http.response.body" and m.get("body"):
                    self.chunks.append(m["body"].decode())
                self.more.set()

            self.task = asyncio.ensure_future(svc.app(scope, receive, send))

        async def head(self, wait=3.0):
            end = time.monotonic() + wait
            while self.status is None and time.monotonic() < end:
                self.more.clear()
                await asyncio.wait({asyncio.ensure_future(self.more.wait())}, timeout=0.05)
            return self.status

        async def next(self, wait=1.0):
            end = time.monotonic() + wait
            while self.read >= len(self.chunks) and time.monotonic() < end and not self.task.done():
                self.more.clear()
                await asyncio.wait({asyncio.ensure_future(self.more.wait())}, timeout=0.05)
            if self.read < len(self.chunks):
                self.read += 1
                return self.chunks[self.read - 1]
            return None

        async def close(self):
            self.task.cancel()
            try:
                await self.task
            except BaseException:  # noqa: BLE001 — a cancelled stream, or a route that raised
                pass

    def hub(chunk):
        return json.loads(chunk[len("data: "):].strip()) if chunk and chunk.startswith("data: ") else chunk

    async def drain(call, wait):
        got, end = [], time.monotonic() + wait
        while time.monotonic() < end:
            c = await call.next(wait=max(0.01, end - time.monotonic()))
            if c is None:
                break
            got.append(c)
        return got

    async def main():
        svc._event_loop = asyncio.get_running_loop()
        svc._HUB_WEB["bundle"] = "index-LANE01.js"
        tok_new, tok_old, tok_anon = "tok-new-" + os.urandom(4).hex(), "tok-old-" + os.urandom(4).hex(), "tok-x"
        for t in (tok_new, tok_old):
            svc._auth_cache[t] = (time.time(), True, "staff", "u-strip")
            svc._token_user_put(t, "u-strip", "Strip Tester")
        new = Call("/chat/stream", {"authorization": "Bearer " + tok_new, "x-hub-notices": "1", "x-hub-strip": "1"})
        old = Call("/chat/stream", {"authorization": "Bearer " + tok_old, "x-hub-notices": "1"})
        OUT["new_head"] = [await new.head(), new.headers.get("x-hub-phase")]
        OUT["new_first"] = [await new.next(), hub(await new.next())]
        await old.head()
        OUT["old_first"] = await old.next()
        svc._hub_phase("engine")
        OUT["new_after"] = [hub(await new.next(wait=0.2))]
        # a frame lost on the way: the state moves, nothing is sent
        svc._HUB_PHASE.update(phase="ready", since=time.time())
        OUT["old_after"] = await drain(old, 0.8)
        OUT["new_keepalive"] = [hub(await new.next(wait=1.5))]
        await new.close()
        await old.close()
        OUT["subs_left"] = len(svc._chat_subs.get("u-strip") or ())
        svc._HUB_PHASE.update(phase="warming")
        r401 = Call("/chat/stream", {"authorization": "Bearer " + tok_anon, "x-hub-strip": "1"})
        OUT["r401"] = [await r401.head(), r401.headers.get("x-hub-phase")]
        await r401.close()
        svc._auth_cache[tok_anon] = (time.time(), True, "staff", "")
        r503 = Call("/chat/stream", {"authorization": "Bearer " + tok_anon, "x-hub-strip": "1"})
        OUT["r503"] = [await r503.head(), r503.headers.get("x-hub-phase")]
        await r503.close()
        boom = Call("/__hub_strip_boom")
        OUT["r500"] = [await boom.head(), boom.headers.get("x-hub-phase"), await boom.next(wait=0.5)]
        await boom.close()
        health = Call("/health")
        OUT["health_head"] = [await health.head(wait=10), health.headers.get("x-hub-phase")]
        body = ""
        while True:
            part = await health.next(wait=2)
            if part is None:
                break
            body += part
        await health.close()
        h = json.loads(body or "{}")
        OUT["health"] = [h.get("phase"), h.get("phase_since")]

    asyncio.run(main())
except Exception as exc:  # noqa: BLE001
    import traceback
    OUT["error"] = traceback.format_exc()[-3000:]
finally:
    shutil.rmtree(WORK, ignore_errors=True)
    OUT["cleaned"] = not os.path.exists(WORK)
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''


def _lane_in_container() -> tuple[dict | None, str]:
    """(result, why it did not run)."""
    sources = {p.stem: p.read_text(encoding="utf-8") for p in sorted(SERVER.glob("*.py"))}
    blob = base64.b64encode(json.dumps(sources).encode()).decode()
    script = f"HUB_STRIP_SOURCES = {blob!r}\n" + LANE
    try:
        proc = subprocess.run(["docker", "exec", "-i", "-e", "HUB_IST_CONFIG_DECLARATION_JSON="
                               + (SERVER / "ist_config_defaults.json").read_text(encoding="utf-8"),
                               CONTAINER, "python3", "-"],
                              input=script, capture_output=True, text=True, timeout=300)
    except FileNotFoundError:
        return None, "no-docker"
    except subprocess.TimeoutExpired:
        return None, "the lane ran past 300 s"
    for line in (proc.stdout or "").splitlines():
        if line.startswith("LANE_RESULT "):
            return json.loads(line[len("LANE_RESULT "):]), ""
    return None, ((proc.stdout or "")[-1500:] + (proc.stderr or "")[-1500:]).strip() or f"exit {proc.returncode}"


print("\nL — the checkout's module, in the relay's container, through its own ASGI app")
if os.getenv("HUB_STRIP_LANE", "") == "skip":
    print("  (skipped — HUB_STRIP_LANE=skip: the pure half above ran; the lane half did NOT)")
    L, why = None, "skip"
else:
    L, why = _lane_in_container()
if L is None and why == "no-docker":
    print("  (skipped — no docker CLI on this machine: the pure half above ran; the lane half did NOT)")
elif L is None and why != "skip":
    check(f"the lane ran in {CONTAINER} (a relay down or restarting is not a pass)", False, why)
elif L is not None and L.get("error"):
    check("the lane ran", False, L["error"])
elif L is not None:
    check("the checkout's module is the one imported, not /srv/app's", L["origin"] == "checkout:snapshot_service",
          L["origin"])
    check("an imported relay is `warming`", L["at_import"] == "warming", L["at_import"])
    check("the served index is where the relay's container mounts the web root, and the setting moves it",
          L["web_index"] == [True, True] and 'Path(os.getenv("HUB_WEB_INDEX", "/srv/web/index.html"))' in SVC,
          L["web_index"])
    check("the stream's head says the phase — the tab learns it in the same answer that says the relay is back",
          L["new_head"] == [200, "warming"], L["new_head"])
    nf = L["new_first"]
    check("a tab that draws the strip: `: open`, then the phase at once, naming the served bundle",
          nf[0] == ": open\n\n" and nf[1] == {"kind": "hub", "phase": "warming", "web": "index-LANE01.js"}, nf)
    check("an older tab: `: open` first", L["old_first"] == ": open\n\n", L["old_first"])
    check("a phase change reaches the tab that draws the strip",
          L["new_after"] == [{"kind": "hub", "phase": "engine", "web": "index-LANE01.js"}], L["new_after"])
    check("and never the older one: no hub frame ever, its keepalive a bare ping",
          L["old_after"] and not any(c.startswith("data:") for c in L["old_after"])
          and set(L["old_after"]) == {": ping\n\n"}, L["old_after"])
    check("a frame lost on the way comes back with the keepalive, which IS the current frame",
          L["new_keepalive"] == [{"kind": "hub", "phase": "ready", "web": "index-LANE01.js"}], L["new_keepalive"])
    check("a closed stream leaves no queue behind", L["subs_left"] == 0, L["subs_left"])
    check("the stream's 401 says the phase", L["r401"] == [401, "warming"], L["r401"])
    check("the stream's 503 (no name for the session) says the phase", L["r503"] == [503, "warming"], L["r503"])
    check("a 500 a route RAISED says the phase — the relay's own error, never 'the relay is gone'",
          L["r500"] == [500, "warming", "Internal Server Error"], L["r500"])
    check("/health says the phase in its body and its header",
          L["health_head"] == [200, "warming"] and L["health"][0] == "warming"
          and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", str(L["health"][1] or "")),
          [L["health_head"], L["health"]])
    check("the run's folder is gone", L["cleaned"] is True)


print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
