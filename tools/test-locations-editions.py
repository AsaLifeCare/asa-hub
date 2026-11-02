#!/usr/bin/env python3
"""Locations' editions in Python: a supplies entry's correction (what was on hand after a delivery) and its removal,
decided by the streamed modules on two real houses in asa-hub-db-sync — the master allowed, a person not listed
refused, a listed person allowed (the editions value and App Control's release simulated), a stale witness 409, the
fields that stay as recorded refused, the edit kept in app.edits and read back; the read names what the door takes.
Nothing real is written: the edit store lives in temp tables inside one transaction rolled back at the end. Prints
shapes, counts and the check's own kept cells only."""
from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"

results: dict[str, Any] = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: Any = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail not in (None, ""):
            print(f"       {str(detail)[:500]}")


DRIVER = r'''
import base64, importlib.abc, importlib.util, json, re, resource, sys, time, types, uuid
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = blob["app"]


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

out, facts, shown = [], {}, []


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_check"
W.LOCK_KEY = 0x4C4F43454443


def rw(sql):
    return sql.replace("app.check_", "pg_temp.check_") if isinstance(sql, str) else sql


class Cur:
    def __init__(self, cur):
        self.c = cur

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
        return Cur(self.real.cursor()).execute(sql, params)

    def cursor(self):
        return Cur(self.real.cursor())

    def transaction(self):
        return self.real.transaction()

    def close(self):
        pass


db = hubdb.HubDb()
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="loc-editions-check")
proxy = Conn(real)
store = W.Store(connect=lambda: proxy, kind="check", label="Check")
EDITIONS = {"value": "[]"}
base_cfg = db.hiring_config
db.hiring_config = lambda: {**base_cfg(), sc.EDITIONS_KEY: EDITIONS["value"]}
db.stale = lambda books: False
HOLDER = {"id": ""}
base_gate = sc.profile_app_gate


def gate(app_id, user, src):
    if user and HOLDER["id"] and gsjs.str_(user.get("id")) == HOLDER["id"] and not user.get("is_service"):
        return {"open": True, "scope": sc.scope_of("all")}
    return base_gate(app_id, user, src)


sc.profile_app_gate = gate
M.DB = db
M.STORE = M.CLIENT_STORE = store
M.STAFF_STORE = M.SSA_STORE = M.FAMILY_STORE = M.SCHEDULING_STORE = W.Store(dsn="")
M.WRITE_BUDGET_S = 120.0
seq = [0]


def write(action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-le-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    res = M._run_write(W, action, who, payload, wid)
    return res.status_code, json.loads(res.body), wid


def kept(wid):
    with real.cursor() as c:
        c.execute("select tab_name, kind, match_by, keyed_by, row_key, field, value, before, edition"
                  " from pg_temp.hub_edits_check where write_id = %s order by id", (wid,))
        return c.fetchall()


def said(who, action, rows):
    # the check's own cells: test values on a temp row; the row key shown by its shape only
    shown.append({"as": who, "action": action, "rows": [[r[0], r[1], r[2], r[3], r[4][:3] + "<uuid>", r[5], r[6], r[7],
                                                          r[8]] for r in rows]})


def read(action, who, payload):
    res = M._run(L, action, who, payload)
    return res.status_code, json.loads(res.body)


def final_of(env):
    return (env.get("_write") or {}).get("final") is True


def safe(code, env):
    d = env.get("data") if isinstance(env.get("data"), dict) else {}
    return {"http": code, "status": env.get("status"), "defer": "defer" in env, "keys": sorted(d),
            "written": d.get("written"), "refused": [r.get("why") for r in d.get("refused") or []],
            "message": env.get("message")}


def unknown(code, env):
    return code == 200 and env == {"status": 404, "message": "Unknown action."}


def listed(*eids):
    EDITIONS["value"] = json.dumps([{"id": e, "on": True, "people": [HOLDER["id"]]} for e in eids])


reads0 = L.Reads(db, None)
users = reads0.users()
live_users = [u for u in users if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in live_users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
holder = next((u for u in live_users if gsjs.str_(u.get("role")).lower() in ("staff", "manager")
               and not gsjs.str_(u.get("clientkey")) and gsjs.str_(u.get("active")).lower() != "false"
               and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")), "role": "admin", "is_master": True}
HOLD = {"uid": gsjs.str_((holder or {}).get("userid")), "role": gsjs.str_((holder or {}).get("role")).lower(),
        "is_master": False}
HOLDER["id"] = HOLD["uid"]
check("the master's account and an employee's account are read from the users tab", bool(master and holder))
with real.transaction():
    store.ensure()
    check("the edit store is made in temp tables", store.ready(), store.why)
houses = []
for h in reads0.homes():
    ctx = L.house(reads0, h["code"])
    if not ctx.get("refused") and ctx.get("home"):
        houses.append(ctx["code"])
    if len(houses) == 2:
        break
check("two real houses on the registry", len(houses) == 2, len(houses))
check("the supplies ledger's house is declared", db.house_moved(L.SUPPLY_TAB))


def entry_of(code, eid):
    c, got = read("locationSupplies", MASTER, {"house": code})
    for it in (got.get("data") or {}).get("consumables") or []:
        for e in it.get("entries") or []:
            if e.get("id") == eid:
                return e, got.get("data") or {}
    return None, got.get("data") or {}


def one_house(n, code):
    P = {"house": code}
    tag = f"house {n}"
    EDITIONS["value"] = "[]"
    c, env, wid = write("locationSupplyEntry", MASTER, {**P, "item": f"Editions check towels {n}", "kind": "delivery",
                                                        "qty": 24, "on_hand_after": 30, "category": "Household"})
    did = ((env.get("data") or {}).get("entry") or {}).get("id", "")
    check(f"{tag}: a delivery appended by the master (the subject, temp)", env.get("status") == 200 and bool(did),
          safe(c, env))
    c, env, wid = write("locationSupplyEntry", MASTER, {**P, "item": f"Editions check towels {n}", "kind": "count",
                                                        "qty": 10})
    cid = ((env.get("data") or {}).get("entry") or {}).get("id", "")
    check(f"{tag}: a count appended by the master (the subject, temp)", env.get("status") == 200 and bool(cid),
          safe(c, env))
    if not did or not cid:
        return
    e, data = entry_of(code, did)
    check(f"{tag}: the read names what the correction takes, and that an entry may be removed",
          data.get("entry_fields") == list(L.SUPPLY_EDIT_FIELDS) and data.get("entry_remove") is True
          and bool(e) and e.get("on_hand_after") == 30, [data.get("entry_fields"), data.get("entry_remove")])

    c, env, wid = write("locationSupplyEdit", MASTER, {**P, "id": did, "changes": [
        {"field": "on_hand_after", "value": "28", "expected": "30"}]})
    rows = kept(wid)
    said("master", "locationSupplyEdit", rows)
    check(f"{tag}: master — what was on hand after the delivery kept final, no edition named",
          env.get("status") == 200 and final_of(env) and env["data"]["written"] == ["on_hand_after"]
          and [r[1:4] + r[5:9] for r in rows] == [("edit", "id", "header", "on_hand_after", "28", "30", "")],
          safe(c, env))
    e, _d = entry_of(code, did)
    check(f"{tag}: the next read shows it", bool(e) and e.get("on_hand_after") == 28)

    c, env, wid = write("locationSupplyEdit", HOLD, {**P, "id": did, "changes": [
        {"field": "on_hand_after", "value": "27", "expected": "28"}]})
    check(f"{tag}: a person not listed — the unadvertised 404, nothing kept", unknown(c, env) and not kept(wid),
          safe(c, env))

    listed("locations.house")
    c, env, wid = write("locationSupplyEdit", HOLD, {**P, "id": did, "changes": [
        {"field": "on_hand_after", "value": "27", "expected": "28"}]})
    rows = kept(wid)
    said("listed", "locationSupplyEdit", rows)
    check(f"{tag}: a listed person — kept final under the edition that let it in",
          env.get("status") == 200 and final_of(env)
          and [r[5:9] for r in rows] == [("on_hand_after", "27", "28", "locations.house")], safe(c, env))

    c, env, wid = write("locationSupplyEdit", HOLD, {**P, "id": did, "changes": [
        {"field": "on_hand_after", "value": "26", "expected": "30"}]})
    check(f"{tag}: a stale witness is the 409 carrying what Postgres holds; nothing kept",
          env.get("status") == 409 and ((env.get("data") or {}).get("current") or {}).get("on_hand_after") == "27"
          and not kept(wid), safe(c, env))

    c, env, wid = write("locationSupplyEdit", HOLD, {**P, "id": cid, "changes": [
        {"field": "item", "value": "x", "expected": f"Editions check towels {n}"},
        {"field": "kind", "value": "par", "expected": "count"},
        {"field": "on_hand_after", "value": "5", "expected": ""},
        {"field": "at", "value": "2020-01-01", "expected": ""}]})
    why = [r.get("why") for r in (env.get("data") or {}).get("refused") or []]
    check(f"{tag}: the item, a new kind and the time stay as recorded; a count records no on-hand-after",
          env.get("status") == 200 and env["data"]["written"] == [] and not final_of(env) and not kept(wid)
          and why == [W.SUPPLY_KEPT, W.SUPPLY_KEPT, "Only a delivery records what was on hand after it.", W.SUPPLY_KEPT],
          safe(c, env))

    c, env, wid = write("locationSupplyEdit", HOLD, {**P, "id": cid, "changes": [
        {"field": "kind", "value": L.SUPPLY_REMOVED, "expected": "count"}]})
    rows = kept(wid)
    said("listed", "locationSupplyEdit (remove)", rows)
    check(f"{tag}: a listed person removes a mistaken entry — its kind kept as removed, the row stays",
          env.get("status") == 200 and final_of(env)
          and [r[5:9] for r in rows] == [("kind", L.SUPPLY_REMOVED, "count", "locations.house")], safe(c, env))
    e, _d = entry_of(code, cid)
    check(f"{tag}: the removed entry is no longer listed", e is None)
    c, env, wid = write("locationSupplyEdit", MASTER, {**P, "id": cid, "changes": [
        {"field": "qty", "value": "3", "expected": "10"}]})
    check(f"{tag}: a removed entry is not found again", env.get("status") == 404 and not kept(wid), safe(c, env))
    EDITIONS["value"] = "[]"


try:
    with real.transaction():
        c, got = read("locationScope", MASTER, {})
        check("locationScope: the master's editions are Locations.gs's, House assets among them",
              set((got.get("data") or {}).get("editions") or []) == set(L.EDITION.values())
              and "locations.assets" in ((got.get("data") or {}).get("editions") or []), got.get("status"))
        for i, code in enumerate(houses, start=1):
            try:
                with real.transaction():
                    one_house(i, code)
            except Exception as exc:  # noqa: BLE001 - said as a failed check
                check(f"house {i}: ran to the end", False, type(exc).__name__ + ": " + str(exc)[:200])
        with real.cursor() as cur:
            cur.execute("select count(*), count(distinct write_id) from pg_temp.hub_edits_check")
            n, w = cur.fetchone()
        facts["cells kept in the check's app.edits (temp)"] = f"{n} cells from {w} writes"
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
with psycopg.connect(hubdb._dsn(), autocommit=True, connect_timeout=5) as c2:
    for _ in range(20):
        left = c2.execute("select count(*) from pg_stat_activity"
                          " where application_name = 'loc-editions-check'").fetchone()[0]
        if not left:
            break
        time.sleep(0.25)
    live = c2.execute("select count(*) from app.edits where app = 'locations'").fetchone()[0] \
        if c2.execute("select to_regclass('app.edits') is not null").fetchone()[0] else 0
check("nothing is left: the check's session is gone, its temp tables with it", left == 0, left)
facts["Locations cells in the live app.edits (untouched)"] = str(live)
facts["peak memory (MiB)"] = str(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024)
print(json.dumps({"checks": out, "facts": facts, "kept": shown}))
'''


def compiled() -> None:
    print("the modules compile")
    files = [str(ROOT / "app" / "locations.py"), str(ROOT / "app" / "writes.py")]
    got = subprocess.run([sys.executable, "-m", "py_compile", *files], capture_output=True)
    check("py_compile app/locations.py app/writes.py", got.returncode == 0, got.stderr.decode()[-800:])


def live() -> None:
    print("the doors, on real houses (asa-hub-db-sync)")
    blob = {"app": {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=1500)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        check("the driver ran in asa-hub-db-sync", False, got.stderr.decode()[-1500:])
        return
    res = json.loads(lines[-1])
    for name, ok, detail in res["checks"]:
        check(name, ok, detail)
    for k, v in res["facts"].items():
        print(f"  fact {k}: {v}")
    for s in res["kept"]:
        print(f"  kept {s['as']} {s['action']}: {json.dumps(s['rows'])}")


def main() -> int:
    compiled()
    if "--static" not in sys.argv:
        live()
    print(f"{results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
