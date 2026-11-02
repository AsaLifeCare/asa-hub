#!/usr/bin/env python3
"""House Supplies' medication lane decided by the streamed modules on the real tables in asa-hub-db-sync: the
Medications tab for the master and for one house manager, a prescription's history, a PatID matched and refused, and
the staged files committed — every one on temp copies of app.hub_med_* inside one transaction rolled back at the end.
Prints shapes, counts and seconds only, never a patient, a drug or a name."""
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
import base64, importlib.abc, importlib.util, json, sys, time, types, uuid
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
from psycopg.rows import dict_row
import gsjs, hubdb, scope as sc, locations as L, writes as W
import house_meds as HM
import main as M

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_hm"
W.LOCK_KEY = 0x484D43484B
HM.SCHEMA = "pg_temp"
TABLES = ("hub_med_imports", "hub_med_staged", "hub_med_dispenses", "hub_med_patients", "hub_med_state")


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

    @property
    def rowcount(self):
        return self.c.rowcount


class Conn:
    def __init__(self, real):
        self.real = real

    @property
    def closed(self):
        return self.real.closed

    @property
    def broken(self):
        return self.real.broken

    @property
    def info(self):
        return self.real.info

    def execute(self, sql, params=None):
        return Cur(self.real.cursor(), self).execute(sql, params)

    def cursor(self, **kw):
        return Cur(self.real.cursor(**kw), self)

    def transaction(self):
        return self.real.transaction()

    def close(self):
        pass


db = hubdb.HubDb()
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="house-meds-check")
conn = Conn(real)
store = HM.Store(connect=lambda: conn)
store.kind = "check"
HM.bind(store)
db.stale = lambda books: False
M.DB = db
M.stores = lambda: {"house-supplies": store}
M.WRITE_BUDGET_S = 120.0
seq = [0]


def read(action, who, payload):
    t = time.monotonic()
    res = M._run(HM, action, who, payload)
    return res.status_code, json.loads(res.body), round(time.monotonic() - t, 2)


def write(action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-hm-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    t = time.monotonic()
    res = M._run_write(HM.WRITE, action, who, payload, wid)
    return res.status_code, json.loads(res.body), wid, round(time.monotonic() - t, 2)


def count(table):
    with real.cursor() as c:
        c.execute(f"select count(*) from pg_temp.{table}")
        return c.fetchone()[0]


reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}
EVERY = {"reader": True, "writer": True, "every_house": True, "houses": [], "managers_readable": True, "why": ""}


def seed():
    real.execute("create temp table hm_check_schema (a int)")
    store.ensure()
    check("the store makes the lane's tables and its receipts in temp tables", store.ready(), store.why)
    for t in TABLES:
        real.execute(f"insert into pg_temp.{t} select * from app.{t}")
    for seq_name, table, col in (("hub_med_import_seq", "hub_med_imports", "import_id"),
                                 ("hub_med_stage_seq", "hub_med_staged", "stage_id")):
        real.execute(f"select setval('pg_temp.{seq_name}', greatest(1, coalesce((select max(substr({col}, 4)::int) "
                     f"from pg_temp.{table}), 1)))")
    facts["copied (imports / dispenses / patients / staged)"] = " / ".join(
        str(count(t)) for t in ("hub_med_imports", "hub_med_dispenses", "hub_med_patients", "hub_med_staged"))


def reads_doors():
    code, env, s = read("houseMedsView", MASTER, {"scope": EVERY})
    data = env.get("data") or {}
    pats = data.get("patients") or []
    groups = {}
    for p in pats:
        groups[p["group"]] = groups.get(p["group"], 0) + 1
    check("the master reads the Medications tab: 200, every patient, the ledger, the clients and the staged files",
          env.get("status") == 200 and len(pats) == count("hub_med_patients") and data.get("ledger")
          and data.get("clients") and isinstance(data.get("staged"), list), env.get("message"))
    facts["view seconds / rx / patients by group"] = f"{s} / {len(data.get('rx') or [])} / {groups}"
    facts["summary"] = json.dumps(data.get("summary"))
    code, env2, s = read("houseMedsView", MASTER, {"scope": EVERY, "since": data.get("version")})
    check("asked again with its version, the view answers unchanged", (env2.get("data") or {}).get("unchanged"), env2)
    houses = sorted({p["house"] for p in pats if p["group"] == "house"})
    check("matched patients are placed in houses", bool(houses), groups)
    facts["houses"] = " ".join(houses)
    facts["labels"] = " | ".join(sorted({p["house_label"] for p in pats if p["house"]}))
    if houses:
        one = houses[0]
        hm = {"reader": True, "writer": False, "every_house": False, "houses": [one], "managers_readable": True,
              "why": ""}
        code, env, s = read("houseMedsView", MASTER, {"scope": hm})
        mine = (env.get("data") or {}).get("patients") or []
        check("a house manager reads only their house's residents, and no ledger",
              env.get("status") == 200 and mine and all(p["house"] == one for p in mine)
              and "ledger" not in (env.get("data") or {}), env.get("message"))
        rx = (env.get("data") or {}).get("rx") or []
        if rx:
            code, env, s = read("houseMedsRx", MASTER, {"scope": hm, "key": rx[0]["rx_root"]})
            check("a prescription of their house: its history", env.get("status") == 200
                  and (env.get("data") or {}).get("rows"), env.get("message"))
        other = [r for r in (data.get("rx") or []) if r["patient"] not in {p["key"] for p in mine}]
        if other:
            code, env, s = read("houseMedsRx", MASTER, {"scope": hm, "key": other[0]["rx_root"]})
            check("another house's prescription is 'no such prescription' to them", env.get("status") == 404, env)
    code, env, s = read("houseMedsView", MASTER, {})
    check("no scope handed by the relay opens nothing", env.get("status") == 403, env)
    code, env, s = read("houseSuppliesInventory", MASTER, {})
    hs = (env.get("data") or {}).get("houses") or []
    n_assets = sum(len((h.get("supplies") or {}).get("assets") or []) for h in hs)
    n_cons = sum(len((h.get("supplies") or {}).get("consumables") or []) for h in hs)
    check("House Supplies › Inventory: every house Locations opens, each with its consumables and assets",
          env.get("status") == 200 and len(hs) == len(L.Reads(db, None).homes()) and all(h.get("supplies") for h in hs),
          env.get("message") or [h.get("why") for h in hs if not h.get("supplies")])
    facts["inventory seconds / houses / assets / consumables"] = f"{s} / {len(hs)} / {n_assets} / {n_cons}"
    cl = next((u for u in users if gsjs.str_(u.get("role")).lower() == "client"
               and gsjs.str_(u.get("active")).lower() != "false"), None)
    if cl:
        code, env, s = read("houseSuppliesInventory", {"uid": gsjs.str_(cl.get("userid")), "role": "client",
                                                       "is_master": False}, {})
        check("a client account is drawn no house's inventory", not (env.get("data") or {}).get("houses"), env)
    if houses:
        one = houses[0]
        code, env, s = read("locationMedications", MASTER, {"house": one})
        here = (env.get("data") or {}).get("patients") or []
        check("Locations › Supplies: the house's residents whole, read-only, through Locations' own door",
              env.get("status") == 200 and here and all(p["house"] == one for p in here)
              and not (env.get("data") or {}).get("scope", {}).get("writer") and "ledger" not in (env.get("data") or {}),
              env.get("message"))
        facts["locationMedications seconds / residents / rx"] = \
            f"{s} / {len(here)} / {len((env.get('data') or {}).get('rx') or [])}"
        rx_here = (env.get("data") or {}).get("rx") or []
        if rx_here:
            code, env, s = read("locationMedicationHistory", MASTER, {"house": one, "key": rx_here[0]["rx_root"]})
            check("a prescription of that house: its history", env.get("status") == 200, env.get("message"))
        elsewhere = [r for r in (data.get("rx") or []) if r["patient"] not in {p["key"] for p in here}]
        if elsewhere:
            code, env, s = read("locationMedicationHistory", MASTER, {"house": one, "key": elsewhere[0]["rx_root"]})
            check("another house's prescription asked through this house is 'no such prescription'",
                  env.get("status") == 404, env)
        client = next((u for u in users if gsjs.str_(u.get("role")).lower() == "client"
                       and gsjs.str_(u.get("active")).lower() != "false"), None)
        if client:
            who = {"uid": gsjs.str_(client.get("userid")), "role": "client", "is_master": False}
            code, env, s = read("locationMedications", who, {"house": one})
            check("a client account never reads the house's prescriptions", env.get("status") != 200 and
                  not (env.get("data") or {}).get("patients"), env)


def write_doors():
    view = (read("houseMedsView", MASTER, {"scope": EVERY})[1].get("data") or {})
    pats = view.get("patients") or []
    clients = view.get("clients") or []
    if pats and clients:
        p = pats[0]
        code, env, wid, s = write("houseMedsMatch", MASTER, {"scope": EVERY, "patid": p["patid"],
                                                              "client_key": clients[0]["client_key"], "by": "check"})
        check("a PatID matched by a person: 200, `person`, final", env.get("status") == 200
              and (env.get("data") or {}).get("match") == "person", env)
        code, env, wid, s = write("houseMedsMatch", MASTER, {"scope": EVERY, "patid": p["patid"],
                                                              "client_key": "no-such-client", "by": "check"})
        check("a client not in the list is refused", env.get("status") == 400, env)
        code, env, wid, s = write("houseMedsMatch", MASTER, {"scope": EVERY, "patid": "0", "client_key": "",
                                                              "by": "check"})
        check("an unknown PatID is 404", env.get("status") == 404, env)
    reader = {**EVERY, "writer": False}
    code, env, wid, s = write("houseMedsMatch", MASTER, {"scope": reader, "patid": "x", "client_key": "", "by": "c"})
    check("a reader who is not a writer is refused", env.get("status") == 403, env)
    staged = [x["stage_id"] for x in (view.get("staged") or [])]
    if staged:
        before = count("hub_med_dispenses")
        code, env, wid, s = write("houseMedsCommit", MASTER, {"scope": EVERY, "stage_ids": staged,
                                                               "actor_uid": MASTER["uid"], "actor_label": "check"})
        data = env.get("data") or {}
        facts["commit seconds / counts / lines new"] = f"{s} / {data.get('counts')} / {data.get('lines_new')}"
        check("the staged files committed in period order: 200, each with its verdict, the lines in",
              env.get("status") == 200 and len(data.get("results") or []) == len(staged)
              and count("hub_med_dispenses") - before == int(data.get("lines_new") or 0)
              and count("hub_med_staged") == 0 + sum(1 for r in data.get("results") or [] if r.get("verdict") == "failed"),
              env)
        code, env, wid, s = write("houseMedsCommit", MASTER, {"scope": EVERY, "stage_ids": staged,
                                                               "actor_uid": MASTER["uid"], "actor_label": "check"})
        again = (env.get("data") or {}).get("results") or []
        check("committed again, each answers from the ledger, nothing written twice",
              env.get("status") == 200 and all(r.get("already") or r.get("verdict") == "unknown" for r in again), env)
        view2 = read("houseMedsView", MASTER, {"scope": EVERY})[1].get("data") or {}
        facts["periods before / after"] = f"{len(view.get('periods') or [])} / {len(view2.get('periods') or [])}"


try:
    with real.transaction():
        seed()
        for name, fn in (("reads", reads_doors), ("writes", write_doors)):
            try:
                with real.transaction():
                    fn()
            except Exception as exc:  # noqa: BLE001 - said as a failed check
                check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300])
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
print(json.dumps({"checks": out, "facts": facts}))
'''


def main() -> int:
    for name in ("house_meds.py", "main.py"):
        py_compile.compile(str(ROOT / "app" / name), doraise=True)
    for name in ("snapshot_service.py", "house_meds.py"):
        py_compile.compile(str(ROOT / "server" / name), doraise=True)
    print("ok   the medication modules, main and the relay compile")
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
