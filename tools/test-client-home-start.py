#!/usr/bin/env python3
"""Care & Support › Home & equipment's Home row dated by the day the person became a client, on the real clients in
asa-hub-db-sync: clientProfileCare's Home row carries the Start Date clientProfileDetails shows (the Hub row, then the
Master, then Master Data), for every client on the roster and for a client of the archive. Nothing is written.
Prints shapes and counts only."""
from __future__ import annotations

import base64
import json
import py_compile
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, re, sys, types
SRC = json.loads(base64.b64decode(sys.stdin.readline()).decode())


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)


sys.meta_path.insert(0, Checkout())
fake = types.ModuleType("fastapi")


class Resp:
    def __init__(self, content=b"", status_code=200, media_type="", headers=None):
        self.body = content if isinstance(content, (bytes, str)) else json.dumps(content)
        self.status_code, self.headers = status_code, dict(headers or {})


class App:
    def __init__(self, **_kw):
        pass

    def _route(self, *_a, **_kw):
        return lambda fn: fn
    get = post = _route


fake.FastAPI, fake.Request = App, object
responses = types.ModuleType("fastapi.responses")
responses.JSONResponse = lambda content, status_code=200, headers=None: Resp(content, status_code, "", headers)
responses.Response = Resp
conc = types.ModuleType("starlette.concurrency")


async def run_in_threadpool(fn, *a, **kw):
    return fn(*a, **kw)
conc.run_in_threadpool = run_in_threadpool
sys.modules.update({"fastapi": fake, "fastapi.responses": responses, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": conc})

import gsjs, hubdb, scope as sc, locations as L, clients as C
import main as M

out, facts = [], {}
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


db = hubdb.HubDb()
M.DB = db
reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}


def read(action, payload):
    res = M._run(M.APPS["clients"], action, MASTER, payload)
    return res.status_code, json.loads(res.body)


def home_of(key):
    code, env = read("clientProfileCare", {"client": key, "tab": "home"})
    rows = ((env.get("data") or {}).get("rows") or []) if env.get("status") == 200 else None
    return code, env, (None if rows is None else next((r for r in rows if r.get("id") == "home_" + key), None))


def start_of(key):
    code, env = read("clientProfileDetails", {"client": key})
    if env.get("status") != 200:
        return None
    return ((env.get("data") or {}).get("services") or {}).get("start_date") or ""


code, env = read("clientProfileRoster", {})
roster = [c["client_key"] for c in ((env.get("data") or {}).get("clients") or [])]
check("the roster answers from Python", env.get("status") == 200 and roster, (code, env.get("defer")))
counts = {"clients": len(roster), "home rows": 0, "dated": 0, "no start date": 0, "details read without Drive": 0}
wrong, home_deferred, shown = [], 0, None
for key in roster:
    code, env, home = home_of(key)
    if home is None:
        home_deferred += 0 if env.get("status") == 200 else 1
        continue
    counts["home rows"] += 1
    start = start_of(key)
    if start is None:
        counts["details read without Drive"] += 1
        start = C.details_data(L.Reads(db, None), C.client_ctx(L.Reads(db, None), key), False)["services"]["start_date"]
    if home.get("date") != start:
        wrong.append([key[:3] + "…", bool(home.get("date")), bool(start)])
    if start:
        counts["dated"] += 1
        shown = shown or (key, home)
    else:
        counts["no start date"] += 1
check("every client's Care & Support answers the Home tab", home_deferred == 0, home_deferred)
check("every Home row carries the client's Start Date from Client Details", counts["home rows"] and not wrong, wrong)
check("a real client's Home row is dated by an ISO day", shown and DAY.match(shown[1].get("date") or ""),
      shown and shown[1].get("date"))
check("the Home row still names the house and the address", shown and shown[1].get("record") == "Home"
      and shown[1].get("details"), shown and shown[1])

own_key = next((k for k in roster if gsjs.text((C.client_ctx(reads0, k).get("row") or {}).get("start_date"))), None)
real_sources = C.sources_of


def behind(_reads, _ctx):
    raise sc.Defer("the client books' copy is behind (check)")


C.sources_of = behind
try:
    code, env, home = home_of(own_key) if own_key else (0, {}, None)
finally:
    C.sources_of = real_sources
own = C.start_day(C.picker(C.client_ctx(reads0, own_key)["row"], {}, {})) if own_key else ""
check("a client books' copy that cannot answer leaves the Home row the Hub row's Start Date, and the tab in Python",
      env.get("status") == 200 and home and own and home.get("date") == own, (code, env.get("defer"), home))
arch = C.archive_index(reads0)
gone = next((k for k in arch["order"] if not arch["rows"][k]["ambiguous"] and k not in roster
             and arch["rows"][k]["fields"].get("start_date")
             and (arch["rows"][k]["fields"].get("house") or arch["rows"][k]["fields"].get("home_address"))), None)
if gone:
    code, env, home = home_of(gone)
    check("a client of the archive: the Home row carries the archive's Start Date",
          home and home.get("date") == arch["rows"][gone]["fields"]["start_date"], (code, env.get("defer"), home))
facts.update(counts)
facts["archive"] = f"{len(arch['order'])} old clients, " + \
    f"{sum(1 for k in arch['order'] if arch['rows'][k]['fields'].get('start_date'))} with a Start Date"
print(json.dumps({"checks": out, "facts": facts}))
'''


def main() -> int:
    for name in ("clients.py", "main.py"):
        py_compile.compile(str(ROOT / "app" / name), doraise=True)
    print("ok   the Clients reads and main compile")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(app).encode()) + b"\n", capture_output=True, timeout=900)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print("FAIL the driver ran in asa-hub-db-sync")
        print(got.stderr.decode()[-2500:])
        return 1
    res = json.loads(lines[-1])
    failed = 0
    for name, ok, detail in res["checks"]:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1
    for k, v in res["facts"].items():
        print(f"fact {k}: {v}")
    print(f"{len(res['checks']) + 1 - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
