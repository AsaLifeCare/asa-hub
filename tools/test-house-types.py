#!/usr/bin/env python3
"""House Details › Type decided by the streamed modules on the real tables in asa-hub-db-sync: the overview reads
the house's type from app.house_types, the house edition changes it in the same locked transaction as its receipt,
a stale or empty type is refused, and the registry's own cells still go to app.edits. Every write lives inside one
transaction rolled back at the end. Prints shapes and counts only."""
from __future__ import annotations

import base64
import json
import py_compile
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"
HOUSE = "ABD2005"

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, sys, types, uuid
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

import psycopg
import gsjs, hubdb, scope as sc, locations as L, writes as W
import main as M

HOUSE = sys.argv[1]
out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_types"
W.LOCK_KEY = 0x4854595045


def rw(sql):
    return sql.replace("app.check_", "pg_temp.check_") if isinstance(sql, str) else sql


class Cur:
    def __init__(self, cur, conn):
        self.c, self.connection = cur, conn

    def execute(self, sql, params=None):
        self.c.execute(rw(sql), params)
        return self

    def executemany(self, sql, rows):
        self.c.executemany(rw(sql), rows)
        return self

    def fetchone(self):
        return self.c.fetchone()

    def fetchall(self):
        return self.c.fetchall()


class Conn:
    def __init__(self, real):
        self.real = real

    @property
    def closed(self):
        return self.real.closed

    @property
    def broken(self):
        return self.real.broken

    def execute(self, sql, params=None):
        return Cur(self.real.cursor(), self).execute(sql, params)

    def cursor(self, **kw):
        return Cur(self.real.cursor(**kw), self)

    def transaction(self):
        return self.real.transaction()

    def close(self):
        pass


real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="house-types-check")
conn = Conn(real)


class Db(hubdb.HubDb):
    """asa-hub-db as the copy is read, but the house types off this transaction: the edit is seen before it commits."""

    def query(self, sql_text, params=None):
        if "house_types" in str(sql_text):
            with real.cursor() as c:
                c.execute(sql_text, params)
                return list(c.fetchall())
        return super().query(sql_text, params)


db = Db()
db.stale = lambda books: False
store = W.Store(connect=lambda: conn, kind="check", label="Check")
M.DB = db
M.stores = lambda: {"locations": store}
M.WRITE_BUDGET_S = 120.0
reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}


def read(action, payload):
    res = M._run(L, action, MASTER, payload)
    return json.loads(res.body)


def write(action, payload):
    wid = f"Wcheck-types-{uuid.uuid4().hex[:12]}"
    res = M._run_write(W, action, MASTER, payload, wid)
    return json.loads(res.body)


try:
    with real.transaction():
        store.ensure()
        check("the write store is made in temp tables", store.ready(), store.why)
        with real.cursor() as c:
            c.execute("select count(*), count(*) filter (where type = 'House') from app.house_types")
            n, house = c.fetchone()
        facts["app.house_types rows / House"] = f"{n} / {house}"
        env = read("locationOverview", {"house": HOUSE})
        d = env.get("data") or {}
        check("the overview reads the house's type from app.house_types, and hands it to the edition",
              env.get("status") == 200 and (d.get("house") or {}).get("type") == "House"
              and (d.get("edit") or {}).get("type") == "House", (env.get("status"), d.get("house"), d.get("edit")))
        name = (d.get("edit") or {}).get("home_name") or ""
        env = write("locationHouseSave", {"house": HOUSE, "home_name": name,
                                          "changes": [{"field": "type", "value": "  Group   Home ", "expected": "House"}]})
        check("the edition changes the type: 200, the type written, nothing sent to the sheet",
              env.get("status") == 200 and "_write" not in env, env)
        with real.cursor() as c:
            c.execute("select type, updated_by from app.house_types where code = %s", (HOUSE,))
            got = c.fetchone()
        check("app.house_types holds it, spaces folded, in the same transaction", got and got[0] == "Group Home", got)
        env = read("locationOverview", {"house": HOUSE})
        check("the overview reads the new type back", ((env.get("data") or {}).get("house") or {}).get("type")
              == "Group Home", env.get("data"))
        env = write("locationHouseSave", {"house": HOUSE, "home_name": name,
                                          "changes": [{"field": "type", "value": "Home", "expected": "House"}]})
        check("a type changed since the panel opened is stale, and nothing is written",
              "type" in json.dumps(env.get("data") or env).lower() and env.get("status") in (200, 409), env)
        env = write("locationHouseSave", {"house": HOUSE, "home_name": name,
                                          "changes": [{"field": "type", "value": "   ", "expected": "Group Home"}]})
        check("an empty type is refused", "A house keeps a type." in json.dumps(env), env)
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
print(json.dumps({"checks": out, "facts": facts}))
'''


def main() -> int:
    for name in ("locations.py", "writes.py", "main.py"):
        py_compile.compile(str(ROOT / "app" / name), doraise=True)
    print("ok   the Locations reads, the writes and main compile")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER, HOUSE],
                         input=base64.b64encode(json.dumps(app).encode()) + b"\n", capture_output=True, timeout=600)
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
