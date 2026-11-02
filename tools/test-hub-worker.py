#!/usr/bin/env python3
"""server/hub_worker.py (asa-hub-worker) and the relay's switch-off, never both at once:

- static: the worker's six keepers are the scripts the relay's _start spawns; the relay's flag is off by default and
  its /health says who runs them; app/compose.yaml's asa-hub-worker is on the relay's image, unpublished, backend only,
  armed, mounting what the keepers read, with the relay's own env lines for every name the keepers read;
- the relay's _start run with stand-ins for everything it calls (inside asa-hub-snapshot): none of the six started with
  HUB_RELAY_KEEPERS unset, all six with it at 1, its other loops started either way;
- the real worker app served by uvicorn inside asa-hub-snapshot, the six keepers stood in for by scripts of the same
  names and a stand-in relay /health: held while the relay runs them or does not say, the six spawned (with
  HUB_PG_DSN) once it says "worker", one killed is spawned again, stopped when the relay runs them again, started
  when the relay is gone; the relay's own wake reaching the sheet keeper over the port; /digest/try behind the
  machine token, its reading forwarded back whole;
- the digest keeper and the Try (the real form_digest and lab_try.py over stand-ins for hub_rows' door and the app's
  write door): the roster, the depot's pointers, both queues, the words book and the re-read dial read off asa-hub-db's
  copy alone, the claims, verdicts and releases kept through the app's digestKeep and the proposals through its
  digestScan; no Google or mirror read or write in a full pass; a copy that cannot answer refuses before anything is
  claimed, and a verdict the record does not keep marks nothing done.
Nothing real is read: no Google, no database, no PsiAnywhere.

    python3 tools/test-hub-worker.py
"""
from __future__ import annotations

import ast
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
RUNNER = "asa-hub-snapshot"
RELAY_COMPOSE = Path(os.environ.get("HUB_RELAY_COMPOSE") or "/dev/null")  # the retired relay's compose, named when this history check is run
# relay env names some module in the keepers' import closure reads, but only off the keepers' path: the shift
# words of a notice (shift_requests' ref key) and the behavior slices' manifest
OFF_PATH = {"HUB_SERVICE_SECRET", "HUB_SERVICE_TOKEN", "HUB_SNAPSHOT_MANIFEST"}

results: list[tuple[str, bool]] = []


def check(name: str, ok: bool, detail: object = None) -> None:
    results.append((name, bool(ok)))
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok or detail is None else f" — {detail}"))


def spawned_scripts(start: ast.AsyncFunctionDef) -> list[str]:
    out = []
    for node in ast.walk(start):
        if isinstance(node, ast.AsyncFunctionDef) and node.name.endswith("_keeper"):
            got = [c.value for c in ast.walk(node) if isinstance(c, ast.Constant) and isinstance(c.value, str)
                   and c.value.endswith(".py")]
            out += got
    return out


def closure(names: list[str]) -> set[str]:
    local = {p.stem for p in (ROOT / "server").glob("*.py")}
    seen: set[str] = set()
    stack = list(names)
    while stack:
        m = stack.pop()
        if m in seen or m not in local:
            continue
        seen.add(m)
        for n in ast.walk(ast.parse((ROOT / "server" / f"{m}.py").read_text(encoding="utf-8"))):
            if isinstance(n, ast.Import):
                stack += [a.name.split(".")[0] for a in n.names]
            elif isinstance(n, ast.ImportFrom) and n.module:
                stack.append(n.module.split(".")[0])
            elif isinstance(n, ast.Call) and getattr(n.func, "attr", "") == "import_module" and n.args \
                    and isinstance(n.args[0], ast.Constant):
                stack.append(str(n.args[0].value))
    return seen


def refs(value: object) -> list[str]:
    return re.findall(r"\$\{([A-Z_0-9]+)", str(value))


def static() -> None:
    relay_src = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    worker_src = (ROOT / "server" / "hub_worker.py").read_text(encoding="utf-8")
    relay = ast.parse(relay_src)
    start = next(n for n in relay.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "_start")
    keepers = ast.literal_eval(next(n.value for n in ast.parse(worker_src).body if isinstance(n, ast.Assign)
                                    and getattr(n.targets[0], "id", "") == "KEEPERS"))
    relay_scripts = spawned_scripts(start)
    check("the worker keeps exactly the six scripts the relay's _start spawns",
          len(relay_scripts) == 6 and sorted(relay_scripts) == sorted(s for _n, s in keepers), (relay_scripts, keepers))
    flag = next(n for n in relay.body if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "RELAY_KEEPERS")
    check("the relay's flag reads HUB_RELAY_KEEPERS, \"0\" when unset",
          'os.getenv("HUB_RELAY_KEEPERS") or "0"' in ast.get_source_segment(relay_src, flag))
    health = next(n for n in relay.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "health")
    said = [ast.get_source_segment(relay_src, v) for d in ast.walk(health) if isinstance(d, ast.Dict)
            for k, v in zip(d.keys, d.values) if isinstance(k, ast.Constant) and k.value == "keepers"]
    check("the relay's /health says who runs the keepers", said == ['"relay" if RELAY_KEEPERS else "worker"'], said)

    app = yaml.safe_load((ROOT / "app" / "compose.yaml").read_text(encoding="utf-8"))["services"]
    w = app.get("asa-hub-worker") or {}
    snap = yaml.safe_load(RELAY_COMPOSE.read_text(encoding="utf-8"))["services"]["asa-hub-snapshot"]
    check("asa-hub-worker is on the relay's own image", w.get("image") == snap["image"], (w.get("image"), snap["image"]))
    check("no port published, the backend network only", "ports" not in w and "expose" not in w
          and w.get("networks") == ["backend"], (w.get("ports"), w.get("networks")))
    env = w.get("environment") or {}
    check("the worker is armed and never sets the relay's flag",
          env.get("HUB_WORKER_KEEPERS") == "1" and "HUB_RELAY_KEEPERS" not in env)
    cmd = w.get("command") or []
    port = cmd[cmd.index("--port") + 1] if "--port" in cmd else ""
    check("it serves hub_worker:app where the app and the relay ask it",
          cmd[:1] == ["uvicorn"] and "hub_worker:app" in cmd
          and app["asa-hub-app"]["environment"].get("HUB_WORKER_URL") == f"http://asa-hub-worker:{port}"
          and f'"http://asa-hub-worker:{port}"' in relay_src, (cmd, port))
    def mounts(volumes: list, base: Path) -> dict[str, tuple[Path, bool]]:
        out = {}
        for v in volumes:
            parts = str(v).split(":")
            if len(parts) >= 2 and parts[0][:1] in "./":
                out[parts[1]] = ((base / parts[0]).resolve(), parts[2:] == ["ro"])
        return out
    wm, rm = mounts(w.get("volumes") or [], ROOT / "app"), mounts(snap["volumes"], RELAY_COMPOSE.parent)
    check("the relay's code (read-only, this tree's) and its snapshot folder are mounted where the relay has them",
          wm.get("/srv/app") == (ROOT / "server", True) and rm.get("/srv/app") == (Path("/opt/docker/asa-hub/server"), True)
          and w.get("working_dir") == snap.get("working_dir") == "/srv/app"
          and wm.get("/srv/snapshot") == rm.get("/srv/snapshot") and set(wm) == {"/srv/app", "/srv/snapshot"},
          (wm, rm.get("/srv/snapshot")))
    check("the profile keeps a bare `up -d` of this file from making it", w.get("profiles") == ["worker"])
    relay_env = snap["environment"]

    def norm(v: object) -> str:
        return re.sub(r":\?[^}]*\}", ":-}", str(v))
    same = {k: norm(v) == norm(relay_env.get(k)) for k, v in env.items() if k in relay_env}
    check("each of the relay's lines it carries reads the same variable (or the same literal)",
          same and all(same.values()), {k: ok for k, ok in same.items() if not ok})
    read = set()
    for m in closure([s[:-3] for _n, s in keepers] + ["lab_try", "hub_worker"]):
        read |= set(re.findall(r'os\.(?:getenv|environ\.get)\(\s*"([A-Z_0-9]+)"',
                               (ROOT / "server" / f"{m}.py").read_text(encoding="utf-8")))
    needed = (read & set(relay_env)) - OFF_PATH
    check("every relay env name the keepers read is in the worker's env", needed <= set(env), sorted(needed - set(env)))


DRIVER = r'''
import ast, asyncio, builtins, importlib.util, json, logging, os, signal, socket, sys, tempfile, threading, time, shutil
import httpx, uvicorn
from fastapi import FastAPI
from pathlib import Path

SRC = json.loads(sys.stdin.read())
WORK = Path(tempfile.mkdtemp(prefix="hub-worker-"))
OUT = WORK / "out"
OUT.mkdir()
results = []
def check(name, ok, detail=None):
    results.append((name, bool(ok)))
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok or detail is None else f" — {detail}"))

class Said(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines = []
    def emit(self, record):
        self.lines.append(record.getMessage())

def wait(cond, s=5.0):
    end = time.monotonic() + s
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.05)
    return bool(cond())

# ---- the relay's _start, everything it calls stood in for ---------------------------------------------------------
relay = ast.parse(SRC["snapshot_service"])
start = next(n for n in relay.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "_start")
start.decorator_list = []
flag = next(n for n in relay.body if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "RELAY_KEEPERS")
code = compile(ast.Module(body=[start], type_ignores=[]), "snapshot_service._start", "exec")

class Stub:
    def __init__(self, name):
        object.__setattr__(self, "_n", name)
    def __call__(self, *a, **k):
        return Stub(self._n + "()")
    def __getattr__(self, k):
        return Stub(self._n + "." + k)
    def __setattr__(self, k, v):
        pass
    def __setitem__(self, k, v):
        pass

def names_of(co, out):
    out.update(co.co_names)
    for c in co.co_consts:
        if hasattr(c, "co_names"):
            names_of(c, out)
    return out

KEEPERS6 = {"_sheet_sync_keeper", "_form_digest_keeper", "_mar_papers_keeper", "_call_prefs_keeper",
            "_resume_texts_keeper", "_cert_reads_keeper"}
def relay_start(value):
    os.environ.pop("HUB_RELAY_KEEPERS", None)
    if value is not None:
        os.environ["HUB_RELAY_KEEPERS"] = value
    created = []
    class Rec:
        def create_task(self, coro):
            if isinstance(coro, Stub):
                created.append(coro._n)
                return
            created.append(coro.cr_code.co_name)
            coro.close()
        def get_running_loop(self):
            return Stub("loop")
    said = Said()
    lg = logging.getLogger("relay-stand-in-" + str(value))
    lg.addHandler(said)
    lg.setLevel(logging.INFO)
    ns = {"__builtins__": __builtins__, "os": os}
    exec(compile(ast.Module(body=[flag], type_ignores=[]), "flag", "exec"), ns)
    for name in names_of(code, set()):
        if name not in ns and not hasattr(builtins, name):
            ns[name] = Stub(name)
    ns.update(asyncio=Rec(), log=lg, PG_DSN="stand-in-dsn")
    exec(code, ns)
    asyncio.run(ns["_start"]())
    return ns["RELAY_KEEPERS"], created, said.lines

on, created, lines = relay_start(None)
check("the relay with HUB_RELAY_KEEPERS unset: flag off, none of the six started, said once",
      on is False and not (KEEPERS6 & set(created)) and any("keepers: none started here" in l for l in lines),
      (created, lines))
on, created0, _ = relay_start("0")
check("HUB_RELAY_KEEPERS=0: none of the six", on is False and not (KEEPERS6 & set(created0)))
on, created1, _ = relay_start("1")
check("HUB_RELAY_KEEPERS=1: each of the six started once, as before the worker",
      on is True and sorted(c for c in created1 if c in KEEPERS6) == sorted(KEEPERS6), created1)
check("its other loops start either way", set(created) == set(created1) - KEEPERS6, (created, created1))

# ---- the worker, its keepers stood in for -------------------------------------------------------------------------
STAND_IN = """import os, signal, sys, time, json, pathlib
me = pathlib.Path(__file__).stem
out = pathlib.Path(os.environ["WORKER_TEST_OUT"])
def mark(kind):
    with open(out / (me + "." + kind), "a") as f:
        f.write(str(os.getpid()) + "\\n")
signal.signal(signal.SIGUSR1, lambda *a: mark("woken"))
(out / (me + ".env")).write_text(json.dumps({"HUB_PG_DSN": os.environ.get("HUB_PG_DSN", "")}))
mark("spawned")
while True:
    time.sleep(0.1)
"""
SCRIPTS = ["hub_sheet_sync", "form_digest", "mar_papers", "call_prefs", "resume_texts", "cert_reads"]
for s in SCRIPTS:
    (WORK / f"{s}.py").write_text(STAND_IN)
(WORK / "lab_try.py").write_text("""import os
def read(file_id, name):
    if file_id == "BOOM":
        raise ValueError("the stand-in could not read it")
    return {"status": 200, "file_id": file_id, "file_name": name, "kind": "pdf", "pid": os.getpid(),
            "ordinary": {"chars": 5, "text": "hello"}}
""")
(WORK / ".hub-app-token").write_text("machine-tok\n")
(WORK / "hub_worker.py").write_text(SRC["hub_worker"])
RELAY_PORT, WORKER_PORT, DEAD_PORT = 18391, 18392, 18393
for k in ("HUB_APP_TOKEN", "DATABASE_URL"):
    os.environ.pop(k, None)
os.environ.update(HUB_WORKER_KEEPERS="1", HUB_SNAPSHOT_PG_DSN="stand-in-dsn", GOOGLE_SERVICE_ACCOUNT_JSON="stand-in-sa",
                  HUB_RELAY_URL=f"http://127.0.0.1:{RELAY_PORT}", WORKER_TEST_OUT=str(OUT))

def load(tag):
    spec = importlib.util.spec_from_file_location("hub_worker_" + tag, WORK / "hub_worker.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

HW = load("main")
HW.RESPAWN_S, HW.ASK_EVERY_S, HW.WATCH_EVERY_S, HW.WAKE_AFTER_S, HW.RELAY_GONE_S = 1.0, 0.2, 0.3, 0.5, 1.5
said = Said()
logging.getLogger("hub.worker").addHandler(said)
logging.getLogger("hub.worker").setLevel(logging.INFO)

RELAY = {"body": {"ok": True}}
stand_in_relay = FastAPI()
@stand_in_relay.get("/health")
async def relay_health():
    return RELAY["body"]

def serve(asgi, port, lifespan="off"):
    server = uvicorn.Server(uvicorn.Config(asgi, host="127.0.0.1", port=port, log_level="error", lifespan=lifespan))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(200):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            return server
        except OSError:
            time.sleep(0.05)
    raise RuntimeError(f"port {port} never opened")

def pids(script, kind="spawned"):
    f = OUT / f"{script}.{kind}"
    return [int(x) for x in f.read_text().split()] if f.exists() else []

def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    try:
        with open(f"/proc/{pid}/stat") as f:
            return f.read().split()[2] != "Z"
    except OSError:
        return False

relay_server = serve(stand_in_relay, RELAY_PORT)
worker_server = serve(HW.app, WORKER_PORT, lifespan="on")
base = f"http://127.0.0.1:{WORKER_PORT}"
tok = {"x-hub-token": "machine-tok"}
try:
    time.sleep(1.2)
    h = httpx.get(base + "/health").json()
    check("the relay answering without saying (its code before the worker): no keeper spawned here",
          not any(pids(s) for s in SCRIPTS) and h["armed"] is True and h["free"] is False and h["relay"] == "old"
          and any("does not say who runs them" in l for l in said.lines), (h, said.lines))
    RELAY["body"] = {"ok": True, "keepers": "relay"}
    time.sleep(0.8)
    check("the relay saying it runs them: still none here", not any(pids(s) for s in SCRIPTS)
          and httpx.get(base + "/health").json()["relay"] == "relay")
    RELAY["body"] = {"ok": True, "keepers": "worker"}
    check("the relay saying \"worker\": each of the six spawned once here",
          wait(lambda: all(len(pids(s)) == 1 for s in SCRIPTS)), {s: pids(s) for s in SCRIPTS})
    envs = {s: json.loads((OUT / f"{s}.env").read_text()) for s in SCRIPTS}
    check("each keeper is handed HUB_PG_DSN, the relay's DSN, as the relay handed it",
          all(e == {"HUB_PG_DSN": "stand-in-dsn"} for e in envs.values()), envs)
    named = ["sheet-sync", "form-digest", "mar-papers", "call-prefs", "resume-texts", "cert-reads"]
    check("each spawn said in the relay's words", all(any(l.startswith(f"{n} keeper spawned (pid ") for l in said.lines)
                                                      for n in named), said.lines)
    h = httpx.get(base + "/health").json()
    check("the worker's /health: free, the six up", h["free"] is True and all(v["up"] for v in h["keepers"].values())
          and sorted(h["keepers"]) == sorted(named), h)
    first = pids("form_digest")[0]
    os.kill(first, signal.SIGKILL)
    check("a keeper that dies is said and spawned again after the respawn pause",
          wait(lambda: len(pids("form_digest")) == 2, 4.0) and any("form-digest keeper exited rc=-9" in l for l in said.lines),
          (pids("form_digest"), said.lines[-4:]))

    # the wake: on the worker's port, and the relay's own _sheet_sync_wake reaching it
    time.sleep(0.6)
    r = httpx.post(base + "/sheet-sync/wake", json={})
    check("the wake without the machine token: 401", r.status_code == 401)
    r = httpx.post(base + "/sheet-sync/wake", json={}, headers=tok)
    check("the wake with it: the sheet keeper hears SIGUSR1",
          r.json() == {"status": 200, "woken": True} and wait(lambda: len(pids("hub_sheet_sync", "woken")) == 1), r.text)
    fns = {n.name: n for n in relay.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
           and n.name in ("_sheet_sync_wake", "_worker_wake", "_keep_task")}
    rs = Said()
    rl = logging.getLogger("relay-wake")
    rl.addHandler(rs)
    rl.setLevel(logging.INFO)
    def relay_wake(url):
        ns = {"__builtins__": __builtins__, "asyncio": asyncio, "httpx": httpx, "time": time, "log": rl,
              "RELAY_KEEPERS": False, "HUB_WORKER_URL": url, "HUB_APP_TOKEN": "machine-tok", "_BG_TASKS": set(),
              "_event_loop": None, "_SHEET_SYNC_PROC": [None, 0.0], "SHEET_SYNC_WAKE_AFTER_S": 15.0, "Any": object}
        exec(compile(ast.Module(body=list(fns.values()), type_ignores=[]), "snapshot_service", "exec"), ns)
        async def go():
            ns["_sheet_sync_wake"]()
            for _ in range(60):
                await asyncio.sleep(0.05)
                if not ns["_BG_TASKS"]:
                    break
        asyncio.run(go())
    relay_wake(base)
    check("the relay's own wake (flag off) reaches the worker's sheet keeper",
          wait(lambda: len(pids("hub_sheet_sync", "woken")) == 2)
          and any("the worker's sheet-sync keeper woken" in l for l in rs.lines), rs.lines)
    relay_wake(f"http://127.0.0.1:{DEAD_PORT}")
    check("a worker the relay cannot reach: said, never raised", any("was not reached" in l for l in rs.lines), rs.lines)

    # the lab's Try, behind the machine token
    r = httpx.post(base + "/digest/try", json={"file_id": "F1"})
    check("digest/try without the machine token: 401, the lab's words",
          r.status_code == 401 and r.json() == {"status": 401, "message": "sign in again"})
    r = httpx.post(base + "/digest/try", json={}, headers=tok).json()
    check("digest/try without a file: 400", r == {"status": 400, "message": "file_id is required"}, r)
    r = httpx.post(base + "/digest/try", json={"file_id": "F1", "file_name": "scan.pdf"}, headers=tok)
    got = r.json()
    check("digest/try: the reading answered whole, read in the worker",
          r.status_code == 200 and got["file_id"] == "F1" and got["file_name"] == "scan.pdf"
          and got["ordinary"]["text"] == "hello" and got["pid"] == os.getpid(), got)
    r = httpx.post(base + "/digest/try", json={"file_id": "BOOM"}, headers=tok).json()
    check("digest/try that throws says why: 500", r == {"status": 500, "message":
                                                         "ValueError: the stand-in could not read it"}, r)

    # the relay runs them again: stopped here, held
    running = [pids(s)[-1] for s in SCRIPTS]
    RELAY["body"] = {"ok": True, "keepers": "relay"}
    check("the relay running them again: the six stopped here",
          wait(lambda: not any(alive(p) for p in running), 4.0)
          and any("6 stopped here" in l for l in said.lines), ([alive(p) for p in running], said.lines[-3:]))
    counts = {s: len(pids(s)) for s in SCRIPTS}
    time.sleep(HW.RESPAWN_S + 1.0)
    check("held: none spawned again while the relay runs them", {s: len(pids(s)) for s in SCRIPTS} == counts)
    # the relay gone (its port refused) long enough: it runs none
    HW.RELAY_URL = f"http://127.0.0.1:{DEAD_PORT}"
    check("the relay gone: the six start here again",
          wait(lambda: all(len(pids(s)) == counts[s] + 1 for s in SCRIPTS), 6.0)
          and any("it is not running" in l for l in said.lines), {s: len(pids(s)) for s in SCRIPTS})

    # not armed, or blind: nothing started, said why
    os.environ.pop("HUB_WORKER_KEEPERS")
    off = load("off")
    check("HUB_WORKER_KEEPERS unset: no keeper, only the Try", off.start() == [] and "not armed" in off.STATE["why"])
    os.environ.update(HUB_WORKER_KEEPERS="1", HUB_SNAPSHOT_PG_DSN="")
    blind = load("blind")
    check("the relay's env missing: no keeper, the empty name said",
          blind.start() == [] and "HUB_SNAPSHOT_PG_DSN empty" in blind.STATE["why"], blind.STATE)

    # the worker stopping takes its keepers with it
    last = [pids(s)[-1] for s in SCRIPTS]
    worker_server.should_exit = True
    check("the worker's shutdown ends its keepers", wait(lambda: not any(alive(p) for p in last), 6.0),
          [alive(p) for p in last])
finally:
    relay_server.should_exit = True
    worker_server.should_exit = True
    every = [p for s in SCRIPTS for p in pids(s)]
    for p in every:
        try:
            os.kill(p, signal.SIGKILL)
        except ProcessLookupError:
            pass
    wait(lambda: not any(alive(p) for p in every), 5.0)
    for _ in range(3):
        shutil.rmtree(WORK, ignore_errors=True)
        if not WORK.exists():
            break
        time.sleep(0.3)

# ---- the roster the Try and the digest keeper read: asa-hub-db's copy alone (hub_rows), never Google or the mirror ----
import types
for k in ("HUB_RELAY_DB_DSN", "HUB_HOUSE_MEDS_DSN", "PG_DSN"):
    os.environ.pop(k, None)
os.environ["HUB_PG_DSN"] = "stand-in-dsn"
REAL = Path(tempfile.mkdtemp(prefix="hub-worker-roster-"))
def real(name, as_name=None):
    (REAL / f"{name}.py").write_text(SRC[name])
    spec = importlib.util.spec_from_file_location(as_name or name, REAL / f"{name}.py")
    m = importlib.util.module_from_spec(spec)
    sys.modules[as_name or name] = m
    spec.loader.exec_module(m)
    return m
GOOGLE, MIRROR, ASKS, VERDICT_ROSTER, DOWNLOADED = [], [], [], [], []
class Google:
    def __getattr__(self, k):
        GOOGLE.append(k)
        raise AssertionError("a Google read")
def mirror(*a, **k):
    MIRROR.append(a)
    raise AssertionError("a mirror read")
sys.modules["engine_verdict"] = types.SimpleNamespace(verdict=lambda name, text, roster: VERDICT_ROSTER.append(roster)
                                                      or {"kind": "stand-in"})
sys.modules["sharp_read"] = None
sys.modules["lane_gate"] = types.SimpleNamespace(DIGEST="gate_digest_writes", holds=lambda gid: {"held": False})
import psycopg2
real_connect = psycopg2.connect
psycopg2.connect = mirror
try:
    HDB = real("hub_db")
    HR = real("hub_rows")
    FD = real("form_digest")
    LT = real("lab_try", "lab_try_real")
    HR.FRESH_S = 0.0
    HDB.connect = mirror
    DRIVE = object()
    FD._clients = lambda: (DRIVE, Google())
    BEATS, ITEMS, DOOR, DIGESTED = [], [], [], []
    FD._beat = lambda items, errors: BEATS.append((items, errors))
    FD._items_finished = lambda: set()
    FD._item_mark = lambda rid, state, error="": ITEMS.append((rid, state))
    FD._item_attempts = lambda rid: 0
    FD._route_file = lambda drive, row, got: ""
    FD.PER_REQUEST_DELAY_S = 0.0
    FF, CF = "19OvLdtyF0iENHcesFFm_6DyGjnqTfrjStAQJjiyh6Ww", "1o7opeC1GR3J5Oj7iGEgYo0EKLPmkW_paGBtE8uMx3LY"
    MODE = {"m": "ok"}
    # asa-hub-db's copy as hub_rows' door answers it: {(book, tab): rows}
    COPY = {
        (FD.ESSENCIAL_ID, "Facts"): [(5, {"Source": FD.PEOPLE_PTR, "Value": "OLD_PEOPLE"}),
                                     (9, {"Source": FD.PEOPLE_PTR, "Value": "H_PEOPLE"}),
                                     (10, {"Source": FD.CLIENTS_PTR, "Value": "H_CLIENTS"}),
                                     (11, {"Source": FD.LEDGERS[0]["ptr"], "Value": FF}),
                                     (12, {"Source": FD.LEDGERS[1]["ptr"], "Value": CF})],
        ("H_PEOPLE", "Data"): [(2, {"id": "P1", "name": "Ann Roe"}), (3, {"id": "", "name": "No Id"}),
                               (4, {"id": "P2", "name": ""})],
        ("H_CLIENTS", "Data"): [(2, {"client_key": "ck1", "id": "C1", "name": "Bo Lee"}),
                                (3, {"client_key": "", "id": "", "name": ""})],
        (FD.BOOK_ID, "Digest Settings"): [(2, {"key": "reread_before_version", "value": "", "active": "on"})],
        (FF, "form_files"): [(2, {"id": "R1", "file_id": "F1", "file_name": "a.pdf", "digest_state": "pending"}),
                             (3, {"id": "R2", "file_id": "F2", "file_name": "b.pdf", "digest_state": "done"})],
        (CF, "client_files"): [(2, {"id": "R3", "drive_id": "F3", "title": "c.pdf", "digest_state": "pending"}),
                               (3, {"id": "R4", "drive_id": "F4", "title": "d.pdf", "digest_state": "working",
                                    "updatedAt": "2026-01-01T00:00:00Z"})],
    }
    for t in FD.VOCAB_TABS:
        COPY[(FD.BOOK_ID, t)] = [(2, {"kind": "lab_result", "category": "medical"})] if t == "Digest Kinds" else []
    def answer(rows, known=True):
        heads = []
        for _rn, d in rows:
            heads += [h for h in d if h not in heads]
        return {"rows": [[rn, d] for rn, d in rows], "headers": heads, "as_of": 1.0, "tab_known": known,
                "book_known": True, "book_status": "ok", "sig": ""}
    def ask(action, payload):
        ASKS.append((action, payload))
        if MODE["m"] == "down":
            raise HR.Unreadable("asa-hub-app could not be asked (URLError)")
        out = []
        for a in payload["asks"]:
            key = (a["sheet_id"], a["tab"])
            if a["tab"] == "Facts" and MODE["m"] == "no pointer":
                out.append(answer([]))
                continue
            if a["tab"] == "Data" and MODE["m"] == "unread":
                out.append({"unread": "the copy of that book is not loaded"})
                continue
            rows = COPY.get(key)
            known = rows is not None and not (MODE["m"] == "no tab" and a["sheet_id"] == "H_PEOPLE")
            want = a.get("where") or {}
            rows = [(rn, d) for rn, d in rows or [] if all(
                d.get(k) in (v if isinstance(v, list) else [v]) for k, v in want.items())]
            out.append(answer(rows, known))
        return {"answers": out}
    HR.ask = ask
    MISSING, REFUSE = set(), set()
    def door(action, payload):
        DOOR.append((action, payload.get("ledger"), {r["id"]: r["cells"] for r in payload.get("rows") or []}))
        if action == "digestScan":
            return {"status": 200, "scan": {"proposed": 1, "written": 1}}
        rows = payload["rows"]
        if any("digested_at" in r["cells"] for r in rows) and payload["ledger"] in REFUSE:
            return {"status": 503, "message": "the copy is behind"}
        gone = [r["id"] for r in rows if r["id"] in MISSING]
        return {"status": 200, "data": {"kept": len(rows) - len(gone), "same": 0, "missing": gone}}
    FD.APP_DOOR = door
    def reset():
        for m in (FD._ROSTER_MEMO, FD._VOCAB_MEMO, FD._FLOOR_MEMO):
            m.update({"at": 0.0, "rows": None} if "rows" in m else {"at": 0.0, "v": None})
        for lst in (ASKS, BEATS, ITEMS, DOOR, DIGESTED, GOOGLE, MIRROR):
            lst.clear()

    got = FD._roster_rows(Google())
    asked = [(a["sheet_id"], a["tab"], a.get("where"), a.get("fields")) for _act, p in ASKS for a in p["asks"]]
    check("the roster is asa-hub-db's copy: the depot's last pointer for each house, then each house's Data tab",
          got == {"people": [{"id": "P1", "name": "Ann Roe"}],
                  "clients": [{"client_key": "ck1", "id": "C1", "name": "Bo Lee"}]}
          and asked == [(FD.ESSENCIAL_ID, "Facts", {"Source": [FD.PEOPLE_PTR, FD.CLIENTS_PTR]}, ["Source", "Value"]),
                        ("H_PEOPLE", "Data", None, ["id", "name"]),
                        ("H_CLIENTS", "Data", None, ["client_key", "id", "name"])], (got, asked))
    check("no Google read and no old-platform mirror read is made for the roster, even handed a Sheets client",
          GOOGLE == [] and MIRROR == [], (GOOGLE, MIRROR))
    n = len(ASKS)
    check("read once every few minutes: a second ask within the memo asks nothing", FD._roster_rows() == got
          and len(ASKS) == n)
    refused = {}
    for mode in ("unread", "down", "no pointer", "no tab"):
        FD._ROSTER_MEMO.update(rows=None, at=0.0)
        MODE["m"] = mode
        try:
            FD._roster_rows()
            refused[mode] = "answered"
        except HR.Unreadable as exc:
            refused[mode] = str(exc)
    check("a copy that cannot answer refuses (hub_rows.Unreadable), never an empty roster, never a fallback",
          all(v != "answered" for v in refused.values()) and "people" in refused["no pointer"]
          and FD._ROSTER_MEMO["rows"] is None and GOOGLE == [] and MIRROR == [], refused)
    MODE["m"] = "unread"
    reset()
    out = FD._one_pass()
    ledgers_asked = [a["tab"] for _act, p in ASKS for a in p["asks"] if a["tab"] in ("form_files", "client_files")]
    check("the digest pass is refused before a single ledger is read or claimed",
          out == {"items": 0, "errors": 1, "note": "copy unread"} and not ledgers_asked and not DOOR
          and BEATS == [(0, 1)] and GOOGLE == [], (out, ledgers_asked, DOOR, BEATS))
    def download(drive, file_id, name):
        DOWNLOADED.append(file_id)
        p = REAL / "paper.pdf"
        p.write_bytes(b"%PDF-")
        return str(p)
    FD._download, FD.digest_kind, FD.extract_text = download, (lambda path: "pdf"), (lambda path: "hello world")
    r = LT.read("F7", "paper.pdf")
    check("the Try refused while the roster is unread: 503, before any download",
          r.get("status") == 503 and "roster could not be read from asa-hub-db" in r.get("message", "")
          and DOWNLOADED == [], r)
    MODE["m"] = "ok"
    FD._ROSTER_MEMO.update(rows=None, at=0.0)
    r = LT.read("F7", "paper.pdf")
    check("the Try reads with asa-hub-db's roster and no Google sheet read",
          r.get("status") == 200 and r["ordinary"]["text"] == "hello world" and DOWNLOADED == ["F7"]
          and VERDICT_ROSTER[-1] == got and GOOGLE == [] and MIRROR == [], (r, GOOGLE))

    # a full pass of the digest keeper: everything it reads off the copy, everything it writes kept as the record
    reset()
    FD.digest_one = lambda row, drive, roster, rows_, led: DIGESTED.append(
        (row["id"], drive is DRIVE, sorted(roster))) or {"digest_state": "done", "digest_kind": "lab_result"}
    out = FD._one_pass()
    tabs = {(a["sheet_id"], a["tab"]) for _act, p in ASKS for a in p["asks"]}
    want = {(FF, "form_files"), (CF, "client_files"), (FD.BOOK_ID, "Digest Settings"), (FD.ESSENCIAL_ID, "Facts"),
            ("H_PEOPLE", "Data"), ("H_CLIENTS", "Data")} | {(FD.BOOK_ID, t) for t in FD.VOCAB_TABS}
    check("a full pass: the two queues, the depot's pointers, the roster, the words book and the re-read dial are "
          "read off asa-hub-db's copy, and only the pending papers are read from Drive",
          want <= tabs and DIGESTED == [("R1", True, ["Ann Roe", "Bo Lee"]), ("R3", True, ["Ann Roe", "Bo Lee"])],
          (sorted(want - tabs), DIGESTED))
    keeps = [(a, led, sorted(rows), sorted({c for cells in rows.values() for c in cells})) for a, led, rows in DOOR]
    check("its claims and its verdicts are kept as the record through asa-hub-app's digestKeep, never written to "
          "the sheet; each item marked done only once its verdict is kept",
          keeps == [("digestKeep", "form_files", ["R1"], ["digest_state"]),
                    ("digestKeep", "form_files", ["R1"], sorted(FD.DIGEST_COLS)),
                    ("digestKeep", "client_files", ["R3"], ["digest_state"]),
                    ("digestKeep", "client_files", ["R3"], sorted(FD.DIGEST_COLS))]
          and DOOR[0][2]["R1"] == {"digest_state": "working"} and DOOR[1][2]["R1"]["digest_state"] == "done"
          and DOOR[1][2]["R1"]["digested_at"]
          and ITEMS == [("R1", "working"), ("R1", "done"), ("R3", "working"), ("R3", "done")]
          and out.get("items") == 2 and out.get("errors") == 0, (keeps, ITEMS, out))
    check("no Google read or write and no old-platform mirror read in a full pass (the Sheets client and the "
          "database driver untouched)", GOOGLE == [] and MIRROR == [], (GOOGLE, MIRROR))
    reset()
    REFUSE.add("form_files")
    try:
        FD._one_pass()
        refused_pass = "ran"
    except FD.NotKept as exc:
        refused_pass = str(exc)
    REFUSE.clear()
    check("a verdict the record does not keep marks nothing done: the pass fails, the next one reads it again",
          "503" in refused_pass and not any(s == "done" for _r, s in ITEMS) and GOOGLE == [], (refused_pass, ITEMS))
    reset()
    MISSING.add("R3")
    out = FD._one_pass()
    MISSING.clear()
    back = [rows for a, led, rows in DOOR if led == "client_files"]
    check("a verdict for a row the record does not hold is not marked done, and its claim is handed back",
          ("R3", "done") not in ITEMS and back[-1] == {"R3": {"digest_state": "pending"}} and out["items"] == 1,
          (DOOR, ITEMS, out))
    reset()
    FD._proposals_pass()
    FD._release_stalled(CF, "client_files")
    check("the hourly proposals scan is the app's digestScan, and the start-up sweep reads the record and hands a "
          "stalled claim back to it", [d[0] for d in DOOR] == ["digestScan", "digestKeep"]
          and DOOR[1][2] == {"R4": {"digest_state": "pending"}} and GOOGLE == [] and MIRROR == [], DOOR)
finally:
    psycopg2.connect = real_connect
    shutil.rmtree(REAL, ignore_errors=True)

failed = [n for n, ok in results if not ok]
print(f"\nstand-in run: {len(results) - len(failed)} ok, {len(failed)} failed")
sys.exit(1 if failed else 0)
'''


def main() -> int:
    print("static")
    static()
    print("inside asa-hub-snapshot")
    src = {name: (ROOT / "server" / f"{name}.py").read_text(encoding="utf-8")
           for name in ("snapshot_service", "hub_worker", "form_digest", "hub_rows", "hub_db", "lab_try")}
    got = subprocess.run(["docker", "exec", "-i", RUNNER, "python", "-c", DRIVER], input=json.dumps(src).encode(),
                         capture_output=True, timeout=180)
    sys.stdout.write(got.stdout.decode())
    if got.returncode != 0:
        sys.stdout.write(got.stderr.decode()[-3000:])
    failed = [n for n, ok in results if not ok]
    print(f"static: {len(results) - len(failed)} ok, {len(failed)} failed")
    return 1 if failed or got.returncode != 0 else 0


if __name__ == "__main__":
    sys.exit(main())
