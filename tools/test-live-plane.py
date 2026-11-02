#!/usr/bin/env python3
"""asa-hub-app's live plane (app/live_plane.py and its parts) against a stand-in relay and a stand-in front door, both
served by uvicorn on loopback inside asa-hub-snapshot (which has httpx, fastapi and uvicorn; asa-hub-app is never
exec'd into): a name said through live_notify.dirty reaches an open /events stream at once, unbuffered, and a stream
without a session is refused; the finish of an answer runs its observers here and never asks the relay's
/front-door/finish: a landed write's rings and sweeps told to the relay's memory and published here once it heard
them, the slice it marks dirty rebuilt; a read judged against a write that landed after its copy is said 503; an
answer the relay carried leaves its marks here and rings nothing; a rebuild writes the slice files and the index, the
relay-shaped ones written here too (one writer);
/bundle answers a session and refuses none; /notify and /health answer as the relay's did; and what the lanes and
the clocks tell the relay (live_notify.tell and told) reaches it, each bare name published here once after it, the
relay's routes for them publishing nothing.

    python3 tools/test-live-plane.py
"""
from __future__ import annotations

import ast
import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNER = "asa-hub-snapshot"
MODULES = ("live_events", "live_slices", "live_bundle", "live_health", "live_finish", "live_plane", "live_notify",
           "hotline_gate", "app_packs", "badge_follows")

DRIVER = r'''
import asyncio, base64, contextvars, importlib.abc, importlib.util, json, os, struct, sys, tempfile, threading, time, types
from dataclasses import dataclass

blob = json.loads(sys.stdin.read())
SRC = {k: base64.b64decode(v).decode() for k, v in blob["app"].items()}
WORK = tempfile.mkdtemp(prefix="live-plane-")
OUT = os.path.join(WORK, "snapshot"); os.makedirs(OUT)
BUNDLES = os.path.join(WORK, "bundles"); os.makedirs(BUNDLES)
MANIFEST = os.path.join(WORK, "snapshot-manifest.json")
RELAY_PORT, APP_PORT = 18391, 18392
os.environ.update({"HUB_SNAPSHOT_OUT": OUT, "HUB_SNAPSHOT_MANIFEST": MANIFEST, "HUB_BUNDLE_DIR": BUNDLES,
                   "HUB_RELAY_URL": f"http://127.0.0.1:{RELAY_PORT}", "HUB_APP_TOKEN": "tok",
                   "HUB_SNAPSHOT_DEBOUNCE": "0.5", "HUB_SNAPSHOT_HEARTBEAT": "3600",
                   "HUB_ACCESS_WRITTEN_FILE": os.path.join(WORK, ".access-written-at"),
                   "HUB_RESOLVER_MANIFEST": os.path.join(WORK, "resolver-manifest.json"),
                   "HUB_HOST_STATUS_PATH": os.path.join(WORK, "host-status.json"),
                   # never the relay's own pack folder, which this container mounts
                   "HUB_APP_PACK_DIR": os.path.join(WORK, "packs"), "HUB_APP_PACK_DEFAULT_DIR": os.path.join(WORK, "packs"),
                   "HUB_APP_PACK_WARM_START_S": "3600"})
os.makedirs(os.environ["HUB_APP_PACK_DIR"])
json.dump({"resources": [
    {"resource": "documents", "mode": "sheet", "sheet": "documents", "roles": ["admin", "staff"]},
    {"resource": "callOffs", "mode": "adapter", "sheet": "callOffs", "roles": ["admin"]},
    {"resource": "shifts", "mode": "derived", "roles": ["admin", "staff"]},
    {"resource": "secretBoard", "mode": "derived", "roles": ["admin"]},
    {"resource": "marEntries", "mode": "live", "held": "by-design"}]}, open(MANIFEST, "w"))
json.dump({"actions": {"policiesList": {"lane": "read", "file": "Policies.gs", "idempotent": True}}},
          open(os.environ["HUB_RESOLVER_MANIFEST"], "w"))

import httpx, uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import Response, JSONResponse

results = []
def check(name, ok, detail=None):
    results.append((name, bool(ok)))
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok or detail is None else f" — {detail}"), flush=True)

# ---- stand-ins for the app's own modules the plane leans on --------------------------------------------------------
hubdb = types.ModuleType("hubdb")
hubdb.OWN = contextvars.ContextVar("own", default=None)
hubdb.RECORD_STATUS = "record"
class Unreadable(RuntimeError): pass
hubdb.Unreadable = Unreadable
scope = types.ModuleType("scope")
scope.BADGE_FOLLOWS = {"SUPERVISOR": "DIRECTOR"}

@dataclass(frozen=True)
class Session:
    ok: bool
    role: str = ""
    uid: str = ""
    is_master: bool = False

@dataclass(frozen=True)
class Finished:
    content: bytes | None
    ring: str | None
    phase: str | None = None

fd = types.ModuleType("front_door")
fd.Session, fd.Finished = Session, Finished
fd._SESSIONS = {}
fd.SESSIONS_FORGOTTEN, fd.FINISH = [], None
fd.READS, fd.WRITES, fd.PREPARE = {}, {}, {}
SESSIONS = {"good": Session(True, "staff", "u1", False), "ended": Session(False)}
CALLS = []
async def session(token):
    s = SESSIONS.get(token)
    if s is not None:
        fd._SESSIONS[token] = (time.time() + 60, s)
    return s
fd.session = session
def is_service(raw): return b"service_secret" in raw[:4096]
fd.is_service = is_service
def builder_payload(action, env, payload): return payload
fd.builder_payload = builder_payload
async def call_app(app_id, action, user, payload, write_id="", at=0.0):
    CALLS.append((app_id, action))
    if action == "sheetTabs":
        env = {"status": 200, "data": {"tabs": {t: [{"id": t + "-1"}] for t in payload["tabs"]},
                                        "read_at": "2026-10-24T00:00:00Z", "unread": {}}}
    elif action == "configLane":
        env = {"status": 200, "data": {"place": "", "shelf": {"sections": [{"id": "s"}], "placement": {}, "order": {}}}}
    elif action == "callOffsList":
        env = {"status": 200, "data": [{"id": "c1"}, {"id": "c2"}]}
    else:
        env = {"status": 404, "message": "Unknown action."}
    return json.dumps(env).encode(), time.time(), env, None, 0.0
fd.call_app = call_app
def ask_relay(path, body, headers, timeout):
    async def go():
        async with httpx.AsyncClient() as c:
            return await c.post(f"http://127.0.0.1:{RELAY_PORT}{path}", content=body, headers=headers, timeout=timeout)
    return go()
fd.ask_relay = ask_relay
main = types.ModuleType("main")
class Ref:
    def __init__(self, rows): self.rows = rows
class DB:
    TABS = {"app_badge_access": [{"app_id": "smartcomms", "badges": "ADMIN"}],
            "app_tenant_access": [], "config_badge_access": [{"section_id": "ops", "badges": "ADMIN"}]}
    def tab(self, sheet_id, tab): return Ref(self.TABS[tab]) if tab in self.TABS else None
    def rows(self, ref): return list(enumerate(ref.rows, 2))
    def book(self, sheet_id): return None
main.DB, main._own = DB(), (lambda: None)
# the lanes' gate and the sheet words the packs lean on: no pack door is read in this test
lane_gate = types.ModuleType("lane_gate")
gsjs = types.ModuleType("gsjs")
gsjs.str_ = lambda v: "" if v is None else str(v)
for name, mod in (("hubdb", hubdb), ("scope", scope), ("front_door", fd), ("main", main), ("lane_gate", lane_gate),
                  ("gsjs", gsjs)):
    sys.modules[name] = mod

class Loader(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self) if name in SRC else None
    def create_module(self, spec): return None
    def exec_module(self, module):
        module.__file__ = os.path.join(WORK, module.__name__ + ".py")
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)
sys.meta_path.insert(0, Loader())
TABLES = json.loads(blob["tables"])
TABLES["relay_built"] = ["shifts", "secretBoard"]
TABLES["late"] = {}
TABLES["slice_doors"] = {"callOffs": ["call-offs", "callOffsList"]}
import live_plane, live_events, live_finish, live_slices, live_notify
live_plane.TABLES_PATH = types.SimpleNamespace(read_text=lambda: json.dumps(TABLES))

# ---- the stand-in relay -------------------------------------------------------------------------------------------
relay = FastAPI()
TOLD = []
@relay.post("/front-door/finish")
async def finish(request: Request):
    if request.headers.get("x-hub-token") != "tok":
        return Response(status_code=401)
    body = await request.body()
    n_meta, n_raw = struct.unpack(">QQ", body[:16])
    meta = json.loads(body[16:16 + n_meta])
    TOLD.append(meta)
    if meta.get("kind") == "marks":
        return JSONResponse({"marks": {"touched": [["locations", "AB123", 1.0]]}})
    return JSONResponse({"published": [["scheduling", False]], "dirty": ["callOffs"], "released": [],
                         "marks": {"touched": [["locations", "AB124", time.time() + 30]]}})
@relay.post("/slices/derived")
async def derived(request: Request):
    body = await request.json()
    TOLD.append({"kind": "derived", **body})
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    res = [{"resource": r, "shelf": "private", "built_at": now, "source_at": now, "rows": 1, "roles": ["admin"]}
           for r in body["resources"]]
    files = {r: {"resource": r, "built_at": now, "source_at": now, "rows": [{"id": r}]} for r in body["resources"]}
    return JSONResponse({"results": res, "files": files, "published": [], "dirty": []})
RTOLD = []
@relay.post("/lanes/told")
async def lanes_told(request: Request):
    RTOLD.append(("/lanes/told", time.time(), await request.json()))
    return JSONResponse({"status": 200})
@relay.post("/live-notify/told")
async def live_notify_told(request: Request):
    if request.headers.get("x-hub-token") != "tok":
        return Response(status_code=401)
    RTOLD.append(("/live-notify/told", time.time(), await request.json()))
    return Response(status_code=204)
@relay.get("/health")
async def rhealth():
    return {"sweeps": {"hiring": 0}, "sheet_sync": {"last_pass_age_s": 5}, "chat_live": {"loaded": True}}

app = FastAPI()
live_plane.install(app, main)

def serve(a, port):
    srv = uvicorn.Server(uvicorn.Config(a, host="127.0.0.1", port=port, log_level="warning", lifespan="on"))
    threading.Thread(target=srv.run, daemon=True).start()
    for _ in range(100):
        if srv.started:
            return srv
        time.sleep(0.05)
    raise SystemExit("server did not start")
serve(relay, RELAY_PORT); serve(app, APP_PORT)
BASE = f"http://127.0.0.1:{APP_PORT}"
LOOP = live_events.LOOP[0]
def on_loop(coro, timeout=30):
    return asyncio.run_coroutine_threadsafe(coro, LOOP).result(timeout)

# 1. the live stream
r = httpx.get(BASE + "/events", timeout=5)
check("/events without a session is 401", r.status_code == 401, r.status_code)
r = httpx.get(BASE + "/events", headers={"Authorization": "Bearer ended"}, timeout=5)
check("/events for an ended session is 401", r.status_code == 401, r.status_code)
got, opened = [], threading.Event()
def listen():
    with httpx.stream("GET", BASE + "/events", headers={"Authorization": "Bearer good"}, timeout=30) as res:
        got.append(("status", res.status_code, res.headers.get("content-type"), res.headers.get("x-accel-buffering")))
        for chunk in res.iter_raw():
            got.append(("chunk", time.time(), chunk))
            if b": open" in chunk:
                opened.set()
            if b"data: scheduling" in chunk and any(b"data: app:locations" in c[2] for c in got if c[0] == "chunk"):
                return
threading.Thread(target=listen, daemon=True).start()
check("/events opens for a session", opened.wait(5), got[:2])
said = time.time()
live_notify.dirty(["app:locations"])
for _ in range(40):
    if any(c[0] == "chunk" and b"data: app:locations" in c[2] for c in got):
        break
    time.sleep(0.05)
hit = [c for c in got if c[0] == "chunk" and b"data: app:locations" in c[2]]
check("live_notify.dirty reaches the open stream at once", hit and hit[0][1] - said < 1.0,
      hit[0][1] - said if hit else got)
check("the stream is text/event-stream, unbuffered", got and got[0][1] == 200 and "text/event-stream" in (got[0][2] or "")
      and got[0][3] == "no", got[:1])

# 2. the finish, here alone: the sign-out's verdict forgotten, a landed write's rings, sweeps and slices
fd._SESSIONS["bye"] = (time.time() + 60, Session(True, "staff", "u9"))
form = lambda env: ("body=" + __import__("urllib.parse").parse.quote(json.dumps(env))).encode()
raw = form({"action": "authLogout", "token": "bye"})
fin = on_loop(live_finish.finish({"kind": "auth", "action": "authLogout", "door": "authLogout"}, raw,
                                 b'{"status": 200, "data": {}}'))
check("the sign-out's held verdict is forgotten here", "bye" not in fd._SESSIONS)
check("the phase rides the finish", isinstance(fin, Finished) and fin.phase in ("warming", "ready"), fin)
said = time.time()
wraw = form({"action": "schedulingCellSave", "token": "good", "payload": {"house": "AB123"}})
fin = on_loop(live_finish.finish({"kind": "write", "action": "schedulingCellSave", "door": "schedulingCellSave",
                                  "app_id": "scheduling", "write_id": "W1", "as_of": time.time() + 1, "held": None,
                                  "edits_at": 0, "plan": {}}, wraw, b'{"status": 200, "data": {"saved": 1}}'))
check("a landed write is answered as Python kept it", fin is not None and json.loads(fin.content) == {
    "status": 200, "data": {"saved": 1}}, fin)
craw = form({"action": "callOffsCreate", "token": "good", "payload": {"row": {"id": "c3"}}})
on_loop(live_finish.finish({"kind": "write", "action": "callOffsCreate", "door": "callOffsCreate",
                            "app_id": "call-offs", "write_id": "W2", "as_of": time.time() + 1, "held": None,
                            "edits_at": 0, "plan": {}}, craw, b'{"status": 200, "data": {}}'))
for _ in range(60):
    rang = [c for c in got if c[0] == "chunk" and b"data: scheduling" in c[2]]
    rebuilt = CALLS.count(("call-offs", "callOffsList")) >= 2
    if rang and rebuilt:
        break
    time.sleep(0.1)
heard = [(t, b) for p, t, b in RTOLD if p == "/live-notify/told" and t >= said]
check("the landing's ring and sweep are told to the relay's memory",
      any(b.get("rang") == ["scheduling"] and b.get("swept") == ["scheduling"] for _t, b in heard), heard)
check("... and published here once, after the relay heard it",
      len(rang) == 1 and heard and rang[0][1] >= heard[0][0], (rang, heard))
check("... the sweep's mark laid here at once, the final write's moment beside it",
      live_finish.MARKS["swept"].get("scheduling", 0.0) >= said
      and live_finish.MARKS["final_at"].get(("scheduling", ""), 0.0) >= said, live_finish.MARKS)
check("the slice a kept write lands in is rebuilt here", rebuilt, CALLS[-6:])
check("the relay's /front-door/finish is never asked", not [m for m in TOLD if m.get("kind") != "derived"], TOLD)
# an answer the relay carried: its pack marks kept here, nothing rung nor told
before = len(RTOLD)
live_finish.carried("smartCommsSet", form({"action": "smartCommsSet", "token": "good"}), b'{"status": 200}')
time.sleep(0.3)
check("an answer the relay carried keeps its sweep here and tells nothing",
      live_finish.MARKS["swept"].get("smartcomms", 0.0) >= said and len(RTOLD) == before, RTOLD[before:])
live_finish.MARKS["touched"][("locations", "AB777")] = time.time() + 60
rraw = form({"action": "locationPack", "token": "good", "payload": {"house": "ab777"}})
fin = on_loop(live_finish.finish({"kind": "read", "action": "locationPack", "door": "locationPack",
                                  "app_id": "locations", "as_of": time.time(), "held": None, "edits_at": 0},
                                 rraw, b'{"status": 200, "data": {}}'))
check("a read older than a write seen land is said 503", fin.content and json.loads(fin.content)["status"] == 503,
      fin)
fin = on_loop(live_finish.finish({"kind": "read", "action": "locationPack", "door": "locationPack",
                                  "app_id": "locations", "as_of": time.time() + 120, "held": None, "edits_at": 0},
                                 rraw, b'{"status": 200, "data": {}}'))
check("a read newer than every write stands", fin is not None and fin.content is None, fin)

# 3. a rebuild writes the slices, the relay-shaped ones written here, and the index
payload = on_loop(live_slices.build_all({"documents", "callOffs", "shifts"}), 60)
files = sorted(os.listdir(OUT))
doc = json.load(open(os.path.join(OUT, "documents.json")))
shifts = json.load(open(os.path.join(OUT, "shifts.json")))
check("a rebuild writes the sheet slice from Python's tab read", doc["rows"] == [{"id": "documents-1"}], doc)
check("a relay-shaped slice is written here, from the relay's rows", shifts["rows"] == [{"id": "shifts"}], shifts)
check("the index holds every slice of the pass", {"documents", "callOffs", "shifts"} <= set(payload["slices"]),
      payload)
check("the relay was asked only for what it shapes", any(m.get("kind") == "derived" and m["resources"] == ["shifts"]
                                                         for m in TOLD), TOLD[-2:])
r = httpx.post(BASE + "/notify", json={"resources": ["documents", "nope"]}, timeout=5)
check("/notify accepts what the manifest knows", r.json() == {"accepted": ["documents"], "rebuild_in": 0.5}, r.text)

# 4. the bang and the health
r = httpx.get(BASE + "/bundle", timeout=10)
check("/bundle without a session is 401", r.status_code == 401, r.status_code)
r = httpx.get(BASE + "/bundle", headers={"Authorization": "Bearer good"}, timeout=10)
b = r.json() if r.status_code == 200 else {}
check("/bundle answers a session with its role's slices and the access matrices",
      r.status_code == 200 and "documents" in b.get("slices", {}) and "secretBoard" not in b.get("slices", {})
      and b.get("access", {}).get("badges", {}).get("smartcomms") == ["ADMIN"], r.text[:300])
r = httpx.get(BASE + "/health", timeout=10)
h = r.json() if r.status_code == 200 else {}
check("/health answers with the plane's own and the relay's keys",
      h.get("ok") is True and h.get("manifest") == 4 and h.get("sweeps") == {"hiring": 0}
      and "documents" not in h.get("failing", ["documents"]) and h.get("held_live", {}).get("by_design") == 1, h)

# 5. the relay's half (server/front_door_finish.py) on a stand-in of its namespace
ffin = types.ModuleType("front_door_finish")
exec(compile(blob["relay_finish"], "front_door_finish.py", "exec"), ffin.__dict__)
CAP = contextvars.ContextVar("live_capture", default=None)
ran = []
def publish(name, *, kept_copy=False):
    CAP.get()["published"].append([name, kept_copy])
def observer(name):
    def run(*args, **kw):
        ran.append(name)
        if name == "_relay_observe_scheduling":
            publish("scheduling")
    return run
async def build_one(entry, catchup, shaped, carried):
    CAP.get()["files"][entry["resource"]] = {"rows": [1]}
    return {"resource": entry["resource"], "rows": 1}
ns = {name: observer(name) for name, _spec in ffin.LOOP}
ns.update({"_LIVE_CAPTURE": CAP, "_live_marks_since": lambda since: {"touched": [["a", "k", since]]},
           "load_manifest": lambda: [{"resource": "shifts"}], "BACKEND_SLICE_DOORS": {}, "_is_hopeless": lambda r: False,
           "build_one": build_one, "_viewer_cache_key": lambda *a: None})
said = json.loads(asyncio.run(ffin.observed(ns, {"kind": "observe", "action": "schedulingSave",
                                                 "observers": ["_relay_observe_scheduling", "_relay_observe_auth"]},
                                            b"", b"{}")))
check("the relay runs only the observers it is named, in its own order", ran == ["_relay_observe_auth",
                                                                                  "_relay_observe_scheduling"], ran)
check("what they raise is caught and handed back, never raised there", said["published"] == [["scheduling", False]]
      and CAP.get() is None, said)
got = asyncio.run(ffin.derived(ns, ["shifts", "unknown"], []))
check("a relay-shaped slice comes back as its file, never written there", got["files"] == {"shifts": {"rows": [1]}}
      and [r["resource"] for r in got["results"]] == ["shifts"], got)

# 6. what the lanes and the clocks tell the relay: each bare name published here once, after the relay rang it
heard, ready = [], threading.Event()
def listen_all():
    with httpx.stream("GET", BASE + "/events", headers={"Authorization": "Bearer good"}, timeout=60) as res:
        for chunk in res.iter_raw():
            heard.append((time.time(), chunk))
            if b": open" in chunk:
                ready.set()
threading.Thread(target=listen_all, daemon=True).start()
check("another stream opens", ready.wait(5))
said = time.time()
live_notify.tell(events=["housecal", "housecal"], wake=["notices"])
live_notify.told(rang=["smartcomms"], swept=["smartcomms"], wake=["sms-ears"])
def lines(name):
    return [t for t, c in heard for line in c.split(b"\n") if line == b"data: " + name.encode()]
for _ in range(60):
    if lines("housecal") and lines("smartcomms"):
        break
    time.sleep(0.05)
time.sleep(0.3)
lanes = [(t, b) for p, t, b in RTOLD if p == "/lanes/told"]
told = [(t, b) for p, t, b in RTOLD if p == "/live-notify/told"]
check("tell: the relay hears the events and the wakes",
      lanes and lanes[-1][1].get("events") == ["housecal"] and lanes[-1][1].get("wake") == ["notices"], lanes)
check("tell: the open stream hears the event once, after the relay heard it",
      len(lines("housecal")) == 1 and lanes and lines("housecal")[0] >= lanes[-1][0], (lines("housecal"), lanes))
check("told: the relay hears the ring, the sweep and the wake",
      told and told[-1][1] == {"rang": ["smartcomms"], "swept": ["smartcomms"], "wake": ["sms-ears"]}, told)
check("told: the open stream hears the ring once, after the relay heard it",
      len(lines("smartcomms")) == 1 and told and lines("smartcomms")[0] >= told[-1][0], (lines("smartcomms"), told))
check("told: the sweep's mark is laid here for the next read",
      live_finish.MARKS["swept"].get("smartcomms", 0.0) >= said, live_finish.MARKS["swept"])
check("the live stream listens on the front door's one list of session listeners",
      fd.SESSIONS_FORGOTTEN.count(live_events.sessions_forgotten) == 1, fd.SESSIONS_FORGOTTEN)

print(f"{sum(ok for _n, ok in results)} ok, {sum(not ok for _n, ok in results)} failed", flush=True)
sys.exit(0 if all(ok for _n, ok in results) else 1)
'''


def relay_tells() -> bool:
    """The relay's routes for those tells ring its kept copies and publish nothing (the bus is asa-hub-app's)."""
    tree = ast.parse((ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8"))
    fns = {n.name: n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    good = True
    for name in ("lanes_told", "live_notify_told"):
        calls = {c.func.id for c in ast.walk(fns[name]) if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}
        ok = "_viewer_cache_rang" in calls and "_publish_slice" not in calls
        good = good and ok
        print(("  ok   " if ok else "  FAIL ") + f"the relay's {name} rings its kept copies and publishes nothing",
              flush=True)
    return good


def main() -> int:
    tells_ok = relay_tells()
    blob = {"app": {m: base64.b64encode((ROOT / "app" / f"{m}.py").read_bytes()).decode() for m in MODULES},
            "tables": (ROOT / "app" / "live_plane.json").read_text(),
            "relay_finish": (ROOT / "server" / "front_door_finish.py").read_text()}
    proc = subprocess.run(["docker", "exec", "-i", RUNNER, "python", "-c", DRIVER], input=json.dumps(blob).encode(),
                          timeout=300)
    return proc.returncode or (0 if tells_ok else 1)


if __name__ == "__main__":
    sys.exit(main())
