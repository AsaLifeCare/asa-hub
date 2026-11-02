#!/usr/bin/env python3
"""Settings › Routes (app/route_switches.py) in two halves, one command.

The gate, inside asa-hub-snapshot (it has fastapi, uvicorn and httpx; asa-hub-app is never exec'd into): the module and
app/relay_carrier.py on a stand-in app, in front of a stand-in relay that records every request carried to it, both
served by uvicorn on loopback, the session verdicts and the live ring stood in for and the switches kept in a dict.
The defaults (three off, every other route on); a route turned off refused 503 route_disabled and never carried nor
answered; the key is the method and template, matched as the routers match (an app route a relay template would also
match is not refused for it); the locked ones never off, whatever a row says; the lane refused to anyone but the
master's own session; a change made outside the lane picked up on the clock; an unreadable or unwritable store leaving
the last switches standing.

The record, inside asa-hub-db-sync by the in-process runner (tools/inprocess): db/route_switches.sql applied to a temp
copy (pg_temp) of app.route_switches, its seed agreeing with the code's defaults, applied again without resetting a
switch, and the module's own read and write on asa-hub-db's real engine. Nothing is written to a live table.

    python3 tools/test-route-switches.py
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATE_RUNNER = "asa-hub-snapshot"

GATE = r'''
import asyncio, json, os, socket, sys, tempfile, threading, time, types
import httpx, uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

blob = json.loads(sys.stdin.read())
RELAY_PORT, APP_PORT = 18391, 18392
os.environ["HUB_RELAY_URL"] = f"http://127.0.0.1:{RELAY_PORT}"
held = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
held.write(blob["relay_routes"])
held.close()
os.environ["HUB_RELAY_ROUTES"] = held.name
os.environ["HUB_ROUTE_SWITCHES_EVERY_S"] = "0.3"

results = []
def check(name, ok, detail=None):
    results.append((name, bool(ok)))
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok or detail is None else f" — {detail}"))

class S:
    def __init__(self, uid, master):
        self.uid, self.ok, self.master = uid, True, master
SESSIONS = {"tm": S("U-master", True), "ta": S("U-admin", False)}
LG = types.ModuleType("lane_gate")
LG.UNKNOWN_LANE = {"status": 404, "reason": "unknown", "message": "Unknown lane."}
def token_of(request):
    a = str(request.headers.get("authorization") or "")
    return a[7:].strip() if a.lower().startswith("bearer ") else ""
async def session(token):
    return SESSIONS.get(token)
async def body_json(request):
    raw = await request.body()
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return None
LG.token_of, LG.session, LG.body_json = token_of, session, body_json
LG.query = lambda request, name: str(request.query_params.get(name) or "")
LG.is_master = lambda s: s is not None and s.master
LG.answer = lambda env, no_store=False: Response(json.dumps(env).encode(), media_type="application/json")
RUNG = []
LN = types.ModuleType("live_notify")
LN.dirty = lambda names: RUNG.append(list(names)) or list(names)
sys.modules.update({"lane_gate": LG, "live_notify": LN})

def load(name, src):
    mod = types.ModuleType(name)
    mod.__file__ = f"/app/{name}.py"
    sys.modules[name] = mod
    exec(compile(src, f"{name}.py", "exec"), mod.__dict__)
    return mod
RS = load("route_switches", blob["route_switches"])
carrier = load("relay_carrier", blob["relay_carrier"])

DB, FAIL = {}, {"read": False, "write": False}
def read_rows():
    if FAIL["read"]:
        raise ConnectionError("asa-hub-db away")
    return {k: dict(v) for k, v in DB.items()}
def write_row(key, enabled, set_by):
    if FAIL["write"]:
        raise ConnectionError("asa-hub-db away")
    DB[key] = {"enabled": enabled, "set_by": set_by, "set_at": "2026-01-01T00:00:00+00:00"}
    return key, dict(DB[key])
RS.read_rows, RS.write_row = read_rows, write_row

HITS, APP_HITS = [], []
relay = FastAPI()
@relay.api_route("/{path:path}", methods=["GET", "POST"])
async def anything(path: str, request: Request):
    HITS.append((request.method, "/" + path, request.url.query))
    return JSONResponse({"status": 200, "data": {"relay": "/" + path}})

app = FastAPI()
def mark(name):
    async def answered(request: Request):
        APP_HITS.append(name)
        return JSONResponse({"status": 200, "data": {"app": name}})
    answered.__name__ = name
    return answered
for method, path, name in (("get", "/health", "health"), ("get", "/healthz", "healthz"), ("get", "/auth", "auth"),
                           ("post", "/gas", "gas"), ("get", "/hub-lanes/backends", "backends"),
                           ("get", "/hub-lanes/housecal/open", "housecal_open")):
    getattr(app, method)(path)(mark(name))
RS.install(app)
carrier.install(app)

def serve(asgi, port):
    server = uvicorn.Server(uvicorn.Config(asgi, host="127.0.0.1", port=port, log_level="error", lifespan="off"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            return server
        except OSError:
            time.sleep(0.05)
    raise RuntimeError(f"port {port} never opened")

serve(relay, RELAY_PORT)
serve(app, APP_PORT)
base = f"http://127.0.0.1:{APP_PORT}"
c = httpx.Client(timeout=10)
LANE = RS.LANE
def auth(token):
    return {"Authorization": f"Bearer {token}"} if token else {}
def lane_get(token="tm", q=""):
    return c.get(base + LANE + q, headers=auth(token)).json()
def lane_set(key, enabled, token="tm"):
    return c.post(base + LANE, json={"key": key, "enabled": enabled}, headers=auth(token)).json()
def listed(env):
    return {r["key"]: r for r in env["data"]["routes"]}

relay_keys = {f"{r['method']} {r['path']}" for r in json.loads(blob["relay_routes"])["routes"]}
OFF3 = {"POST /media-probe", "POST /shift/of", "POST /smart-comms/rpc"}

print("before any switch is read")
FAIL["read"] = True
r = c.post(base + "/shift/of", json={})
check("the defaults stand: a route without a caller is refused", r.status_code == 503 and HITS == [], (r.status_code, HITS))
check("and every other route is answered", c.get(base + "/healthz").status_code == 200)
FAIL["read"] = False

print("defaults")
env = lane_get()
rows = listed(env) if env.get("status") == 200 else {}
check("the master reads the lane", env.get("status") == 200, env)
check("every relay route is listed", relay_keys <= set(rows), sorted(relay_keys - set(rows))[:5])
check(f"{len(relay_keys)} relay routes in the table", len(relay_keys) > 100, len(relay_keys))
check("the app's own routes are listed, the carrier is not",
      {"GET /healthz", "POST /gas", f"GET {LANE}", f"POST {LANE}"} <= set(rows)
      and not any(k.endswith(" /{path:path}") for k in rows), [k for k in rows if "{path:path}" in k])
check("who answers: app, relay, both",
      rows.get("GET /healthz", {}).get("answered_by") == "app" and rows.get("POST /shift/of", {}).get("answered_by") == "relay"
      and rows.get("GET /hub-lanes/backends", {}).get("answered_by") == "both"
      and rows.get("GET /health", {}).get("answered_by") == "both")
check("exactly the three without a caller start off", {k for k, r in rows.items() if not r["enabled"]} == OFF3,
      sorted(k for k, r in rows.items() if not r["enabled"]))
check("their default is off, every other route's on",
      all(rows[k]["default_enabled"] is (k not in OFF3) for k in rows))
LOCKED = {f"GET {LANE}", f"POST {LANE}", "GET /health", "GET /healthz", "GET /auth", "POST /gas"}
check("the locked ones, and only they, are locked", {k for k, r in rows.items() if r["locked"]} == LOCKED,
      sorted(k for k, r in rows.items() if r["locked"]))
check("the routes carry an area", rows.get("GET /hub-lanes/calendar-builder/grid", {}).get("area")
      == "/hub-lanes/calendar-builder" and rows.get("POST /shift/of", {}).get("area") == "/shift",
      (rows.get("GET /hub-lanes/calendar-builder/grid", {}).get("area"), rows.get("POST /shift/of", {}).get("area")))
check("the store is read and nothing is said against it", env["data"]["store_why"] == "" and env["data"]["relay_why"] == "")

print("a route turned off")
HITS.clear()
for path in ("/shift/of", "/media-probe", "/smart-comms/rpc"):
    r = c.post(base + path, json={"x": 1})
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    check(f"POST {path} is refused 503 route_disabled", r.status_code == 503 and body.get("reason") == "route_disabled"
          and body.get("status") == 503 and body.get("route") == f"POST {path}" and body.get("message"), (r.status_code, body))
check("and none of them reached the relay", HITS == [], HITS)
r = c.get(base + "/shift/of")
check("the same path by another method is its own route, and is carried", r.status_code == 200
      and HITS == [("GET", "/shift/of", "")], (r.status_code, HITS))

print("turned on by the master")
HITS.clear()
env = lane_set("POST /shift/of", True)
row = listed(env).get("POST /shift/of", {}) if env.get("status") == 200 else {}
check("the lane answers the list with it on", row.get("enabled") is True and row.get("set_by") == "U-master", env)
check("kept, by the master", DB.get("POST /shift/of", {}).get("enabled") is True
      and DB["POST /shift/of"]["set_by"] == "U-master", DB)
check("the open Settings are told", RUNG and RUNG[-1] == ["route-switches"], RUNG)
r = c.post(base + "/shift/of", json={"x": 1})
check("and the route is carried again", r.status_code == 200 and HITS == [("POST", "/shift/of", "")], (r.status_code, HITS))

print("an app route turned off")
HITS.clear()
APP_HITS.clear()
check("turned off", lane_set("GET /hub-lanes/backends", False).get("status") == 200)
r = c.get(base + "/hub-lanes/backends")
check("refused, not answered by the app nor carried", r.status_code == 503 and APP_HITS == [] and HITS == [],
      (r.status_code, APP_HITS, HITS))
lane_set("GET /hub-lanes/backends", True)
r = c.get(base + "/hub-lanes/backends")
check("on again, the app answers it", r.status_code == 200 and APP_HITS == ["backends"], (r.status_code, APP_HITS))

print("matched as the routers match")
HITS.clear()
APP_HITS.clear()
lane_set("GET /hub-lanes/housecal/{location}", False)
r1 = c.get(base + "/hub-lanes/housecal/open")
r2 = c.get(base + "/hub-lanes/housecal/house-9")
check("a path an app route answers first is not refused for the relay's template",
      r1.status_code == 200 and APP_HITS == ["housecal_open"], (r1.status_code, APP_HITS))
check("the template's own paths are refused and not carried", r2.status_code == 503 and HITS == [], (r2.status_code, HITS))
lane_set("GET /hub-lanes/housecal/{location}", True)

print("the locked ones")
for key in sorted(LOCKED):
    got = lane_set(key, False)
    check(f"{key} cannot be turned off", got.get("status") == 409 and got.get("reason") == "locked" and key not in DB, got)
for key in ("GET /health", "POST /gas", f"GET {LANE}", "GET /auth", "GET /__snapshot_auth", "GET /__snapshot_auth/auth"):
    DB[key] = {"enabled": False, "set_by": "by hand", "set_at": ""}
env = lane_get()
rows = listed(env) if env.get("status") == 200 else {}
check("a row turning a locked route off is read, and the lane still answers", env.get("status") == 200
      and rows.get("GET /health", {}).get("enabled") is True and rows.get("POST /gas", {}).get("enabled") is True, env)
APP_HITS.clear()
HITS.clear()
answered = [c.get(base + "/health").status_code, c.post(base + "/gas", content=b"a=1").status_code,
            c.get(base + "/auth").status_code, c.get(base + "/__snapshot_auth").status_code,
            c.get(base + "/__snapshot_auth/auth").status_code]
check("and every one of them is still answered", answered == [200] * 5 and APP_HITS == ["health", "gas", "auth"]
      and [h[1] for h in HITS] == ["/__snapshot_auth", "/__snapshot_auth/auth"], (answered, APP_HITS, HITS))
for key in ("GET /health", "POST /gas", f"GET {LANE}", "GET /auth", "GET /__snapshot_auth", "GET /__snapshot_auth/auth"):
    DB.pop(key, None)

print("only the master")
check("no session: 401", lane_get(token="").get("status") == 401)
check("another admin: the lane does not exist", lane_get(token="ta") == LG.UNKNOWN_LANE)
check("the master visiting a member: 403", lane_get(q="?member=M-1").get("reason") == "visit")
before = dict(DB)
got = lane_set("POST /media-probe", True, token="ta")
check("another admin's write is refused and nothing is kept", got == LG.UNKNOWN_LANE and DB == before, got)
check("so the route stays off", c.post(base + "/media-probe").status_code == 503)

print("what the lane refuses")
check("an unknown key", lane_set("POST /nowhere", True).get("reason") == "route")
got = c.post(base + LANE, json={"key": "POST /media-probe", "enabled": "yes"}, headers=auth("tm")).json()
check("enabled that is not true or false", got.get("reason") == "enabled" and "POST /media-probe" not in DB, got)

print("the clock")
HITS.clear()
DB["POST /media-probe"] = {"enabled": True, "set_by": "by hand", "set_at": ""}
time.sleep(0.45)
c.get(base + "/healthz")
time.sleep(0.3)
r = c.post(base + "/media-probe")
check("a switch changed outside the lane is picked up on the clock", r.status_code == 200
      and HITS == [("POST", "/media-probe", "")], (r.status_code, HITS))

print("the store away")
FAIL["read"] = True
env = lane_get()
check("an unreadable store is said, and the list still drawn", env.get("status") == 200 and env["data"]["store_why"]
      and listed(env)["POST /smart-comms/rpc"]["enabled"] is False, env.get("data", {}).get("store_why"))
check("and the last switches read stand", c.post(base + "/smart-comms/rpc").status_code == 503
      and c.post(base + "/media-probe").status_code == 200)
FAIL.update(read=False, write=True)
got = lane_set("POST /smart-comms/rpc", True)
check("a write that cannot be kept is 503 unkept and changes nothing", got.get("reason") == "unkept"
      and c.post(base + "/smart-comms/rpc").status_code == 503, got)
FAIL["write"] = False

print("everything else as it was")
HITS.clear()
r = c.get(base + "/hub-lanes/hotline/calls?since=5")
check("a carried request still reaches the relay as it came", r.status_code == 200
      and HITS == [("GET", "/hub-lanes/hotline/calls", "since=5")], HITS)

print("the cost")
miss = {"type": "http", "method": "GET", "path": "/hub-lanes/notices", "root_path": "", "query_string": b"",
        "headers": []}
near = {**miss, "method": "POST", "path": "/smart-comms/rpc"}
n = 20000
t0 = time.perf_counter()
for _ in range(n):
    RS.refused_key(miss)
fast = (time.perf_counter() - t0) / n * 1e6
t0 = time.perf_counter()
for _ in range(2000):
    RS.refused_key(near)
slow = (time.perf_counter() - t0) / 2000 * 1e6
print(f"  gate: {fast:.2f} µs a request no switch matches, {slow:.1f} µs one a switched-off route matches")
check("a request no switched-off route could match costs a few microseconds", fast < 20, fast)
check("one it could match is resolved under a millisecond", slow < 1000, slow)

bad = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(bad)}/{len(results)} ok" + ("" if not bad else " — FAILED: " + "; ".join(bad)))
sys.exit(1 if bad else 0)
'''

RECORD = r'''
import os, sys, types
import psycopg

results = []
def check(name, ok, detail=None):
    results.append((name, bool(ok)))
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok or detail is None else f" — {detail}"))

fa, fr = types.ModuleType("fastapi"), types.ModuleType("fastapi.responses")
fa.Request, fr.Response = object, object
sys.modules.update({"fastapi": fa, "fastapi.responses": fr})
import hubdb
import route_switches as RS

conn = psycopg.connect(hubdb._dsn(), autocommit=True, connect_timeout=5, application_name="route-switches-check")
ddl = os.environ["RS_DDL"]
copy = "\n".join(line for line in ddl.splitlines()
                 if not line.strip().lower().startswith(("set role", "reset role", "grant ")))
copy = copy.replace("app.route_switches", "pg_temp.route_switches")
check("the DDL names app.route_switches and the writer role", "create table if not exists app.route_switches" in ddl
      and "set role asa_hub_app_rw;" in ddl and "reset role;" in ddl)
conn.execute(copy)

class Held:
    def conn(self):
        return conn
RS._STORE[:] = [Held()]
RS.TABLE = "pg_temp.route_switches"

print("the seed")
rows = RS.read_rows()
check("the seed is the code's three off, and only they", set(rows) == set(RS.DEFAULT_OFF)
      and all(r["enabled"] is False and r["set_by"] == "default" for r in rows.values()), rows)
print("the module's write")
key, row = RS.write_row("POST /shift/of", True, "U-master")
check("a switch set comes back as it stands", key == "POST /shift/of" and row["enabled"] is True
      and row["set_by"] == "U-master" and row["set_at"][:2] == "20", row)
key, row = RS.write_row("GET /hub-lanes/backends", False, "U-master")
rows = RS.read_rows()
check("a new route's switch is a new row", rows.get("GET /hub-lanes/backends", {}).get("enabled") is False
      and len(rows) == 4, rows)
conn.execute(copy)
rows = RS.read_rows()
check("the DDL applied again resets no switch", rows["POST /shift/of"]["enabled"] is True
      and rows["POST /shift/of"]["set_by"] == "U-master" and len(rows) == 4, rows)
try:
    RS.write_row("shift/of", False, "x")
    refused = False
except psycopg.Error:
    refused = True
check("a key that is not METHOD /path is refused by the table", refused)
conn.close()

bad = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(bad)}/{len(results)} ok" + ("" if not bad else " — FAILED: " + "; ".join(bad)))
sys.exit(1 if bad else 0)
'''


def gate() -> int:
    blob = json.dumps({"route_switches": (ROOT / "app" / "route_switches.py").read_text(encoding="utf-8"),
                       "relay_carrier": (ROOT / "app" / "relay_carrier.py").read_text(encoding="utf-8"),
                       "relay_routes": (ROOT / "app" / "relay_routes.json").read_text(encoding="utf-8")})
    return subprocess.run(["docker", "exec", "-i", GATE_RUNNER, "python3", "-c", GATE], input=blob.encode(),
                          timeout=300).returncode


def record() -> int:
    runner = Path(tempfile.mkdtemp(prefix="route-switches-"))
    try:
        for name in ("run.sh", "drv.py"):
            shutil.copy(ROOT / "tools" / "inprocess" / name, runner / name)
        (runner / "test_route_switches_record.py").write_text(RECORD, encoding="utf-8")
        (runner / "env.json").write_text(json.dumps({"RS_DDL": (ROOT / "db" / "route_switches.sql").read_text(
            encoding="utf-8")}), encoding="utf-8")
        return subprocess.run(["sh", str(runner / "run.sh"), str(ROOT / "app"),
                               str(runner / "test_route_switches_record.py"), f"@{runner / 'env.json'}"],
                              timeout=300).returncode
    finally:
        shutil.rmtree(runner, ignore_errors=True)


def main() -> int:
    print("== the gate and the lane (asa-hub-snapshot)", flush=True)
    first = gate()
    print("\n== the record (asa-hub-db-sync)", flush=True)
    second = record()
    return 1 if first or second else 0


if __name__ == "__main__":
    sys.exit(main())
