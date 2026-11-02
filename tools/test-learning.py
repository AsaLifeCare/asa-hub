#!/usr/bin/env python3
"""Learning decided by the streamed modules on the real competencies in asa-hub-db-sync: the stages on made-up
attempts, a person's state read off the copy, their attempt kept as their own, a competency made and changed, the
refusals, and a person learning.skills lists. Nothing real is written: the edit store lives in temp tables inside one
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
import gsjs, hubdb, scope as sc, locations as L, writes as W
import learning as LR
import learning_writes as LW
import main as M

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_lrn"
W.LOCK_KEY = 0x4C524E434B


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
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="learning-check")
store = W.Store(connect=lambda: Conn(real), kind="check", label="Check")
EDITIONS = {"value": "[]"}
if not any(a == "learning" for _e, a in sc.EDITIONS):
    sc.EDITIONS = tuple(sc.EDITIONS) + (("learning.skills", "learning"),)
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
M.stores = lambda: {"learning": store}
M.WRITE_BUDGET_S = 120.0
seq = [0]


def read(action, who, payload):
    res = M._run(LR, action, who, payload)
    return res.status_code, json.loads(res.body)


def write(action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-lrn-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    res = M._run_write(LW, action, who, payload, wid)
    return res.status_code, json.loads(res.body), wid


def kept(wid):
    with real.cursor() as c:
        c.execute("select sheet_id, tab_name, kind, row_key, field, value, edition from pg_temp.hub_edits_lrn"
                  " where write_id = %s order by id", (wid,))
        return c.fetchall()


def final(env):
    return (env.get("_write") or {}).get("final") is True


def at(day, n):
    return "2026-01-%02dT10:%02d:00.000Z" % (day, n)


def stages():
    r = dict(LR.FLOOR)
    ok, bad = [True] * 4, [False] * 4

    def att(pairs):
        return [{"at": at(d, i), "correct": c, "helped": h} for i, (d, c, h) in enumerate(pairs)]
    cases = [
        ([], "exposed", "not attempted yet"),
        (att([(1, False, False)]), "exposed", "attempted, not yet correct"),
        (att([(1, True, True)]), "emerging", "correct at least once"),
        (att([(1, True, True), (1, True, True)]), "practising", "2 in a row"),
        (att([(1, True, True), (1, True, True), (1, True, True)]), "stable", "3 in a row"),
        (att([(1, True, False)] * 4), "mastered", "4 in a row, unaided"),
        (att([(1, True, False)] * 4 + [(9, True, False)]), "generalised", "held after 8 days"),
        (att([(1, True, False)] * 3 + [(1, True, True)]), "stable", "4 in a row"),
        (att([(1, True, False)] * 3 + [(1, False, False), (1, True, False)]), "emerging", "correct at least once"),
    ]
    for attempts, want, why in cases:
        got = LR.stage(attempts, r)
        check(f"a stage: {want}, {why}", got["stage"] == want and got["why"] == why, got)
    check("the rules are the floor, or stricter", all(LR.rules(L.Reads(db, None))[k] >= v for k, v in LR.FLOOR.items()))


reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
staff = next((u for u in users if gsjs.str_(u.get("role")).lower() == "staff" and not gsjs.str_(u.get("clientkey"))
              and gsjs.str_(u.get("active")).lower() != "false"
              and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}
STAFF = {"uid": gsjs.str_((staff or {}).get("userid")), "role": "staff", "is_master": False}
skills0 = [s for s in LR.rows(reads0, LR.SKILLS_TAB) if gsjs.str_(s.get("active")).lower() != "false"]
house = {t: db.resolve(t).sheet_id for t in (LR.SKILLS_TAB, LR.ATTEMPTS_TAB)}
facts["copy"] = f"{len(skills0)} active competencies, {len(LR.rows(reads0, LR.ATTEMPTS_TAB))} attempts"
check("a staff account and the competencies are read from the copy", bool(staff and skills0))


def reads_doors():
    code, env = read("learnState", STAFF, {})
    d = env.get("data") or {}
    check("a person reads their state: 200, every active competency, the six stages",
          code == 200 and env.get("status") == 200 and len(d.get("skills") or []) == len(skills0) and
          d.get("stages") == list(LR.STAGES), env.get("message"))
    code, env = read("learnState", {"is_service": True}, {})
    check("the service is refused, as learnMayUse_ refuses it",
          env == {"status": 403, "message": "Requires an admin or manager account"}, env)


def write_doors():
    sk = gsjs.str_(skills0[0].get("id"))
    code, env = read("learnState", STAFF, {})
    before = next(s for s in env["data"]["skills"] if s["id"] == sk)["attempts"]
    code, env, wid = write("learnAttempt", STAFF, {"skillId": sk, "correct": True, "helped": False})
    got = kept(wid)
    after = next((s for s in (env.get("data") or {}).get("skills") or [] if s["id"] == sk), {})
    check("a person's attempt: 200, final, one row appended in learn_attempts",
          env.get("status") == 200 and final(env) and got and
          all(r[0] == house[LR.ATTEMPTS_TAB] and r[1] == LR.ATTEMPTS_TAB and r[2] == "append" for r in got), env)
    check("kept as their own (ownerId), so the state it answers counts it",
          any(r[4] == "ownerId" and r[5] == STAFF["uid"] for r in got) and after.get("attempts") == before + 1,
          (before, after.get("attempts")))
    code, env, _ = write("learnAttempt", STAFF, {})
    check("no competency is refused", env == {"status": 400, "message": "Which competency?"}, env)
    code, env, _ = write("learnAttempt", STAFF, {"skillId": "no-such-skill"})
    check("an unknown competency is 404",
          env == {"status": 404, "message": 'No "learnSkills" record with id "no-such-skill".'}, env)
    code, env, _ = write("learnSkillSave", STAFF, {"name": "x"})
    check("a staff member nobody listed is refused a competency", env == {"status": 403, "message": LW.ADMIN_ONLY}, env)
    code, env, wid = write("learnSkillSave", MASTER, {"name": "Check skill", "area": "Check", "description": "d"})
    new_id = (env.get("data") or {}).get("id")
    check("the master makes a competency: 200, final, appended in learn_skills",
          env.get("status") == 200 and final(env) and new_id and
          all(r[0] == house[LR.SKILLS_TAB] and r[2] == "append" for r in kept(wid)), env)
    code, env, wid = write("learnSkillSave", MASTER, {"id": new_id, "name": "Check skill", "area": "Check",
                                                       "description": "d", "active": False})
    cells = {r[4] for r in kept(wid)}
    check("and retires it: final, its cells and the stamp", env.get("status") == 200 and final(env) and
          cells == {"name", "area", "description", "active", "updatedAt"}, (env, sorted(cells)))
    code, env, _ = write("learnSkillSave", MASTER, {"name": " "})
    check("a competency with no name is refused", env == {"status": 400, "message": "A competency needs a name."}, env)
    code, env, _ = write("learnSkillSave", MASTER, {"id": "no-such-skill", "name": "x"})
    check("an unknown competency is 404 on a save",
          env == {"status": 404, "message": 'No "learnSkills" record with id "no-such-skill".'}, env)


def edition_doors():
    HOLDER["id"] = STAFF["uid"]
    EDITIONS["value"] = json.dumps([{"id": "learning.skills", "on": True, "people": [STAFF["uid"]]}])
    code, env, wid = write("learnSkillSave", STAFF, {"name": "Check by staff", "area": "Check"})
    got = kept(wid)
    check("a staff member learning.skills lists makes one: 200, final, the edition named",
          env.get("status") == 200 and final(env) and got and all(r[6] == "learning.skills" for r in got), env)
    EDITIONS["value"] = json.dumps([{"id": "learning.skills", "on": False, "people": [STAFF["uid"]]}])
    code, env, _ = write("learnSkillSave", STAFF, {"name": "x"})
    check("an edition whose key is off lets nobody in", env == {"status": 403, "message": LW.ADMIN_ONLY}, env)
    HOLDER["id"] = ""


try:
    with real.transaction():
        store.ensure()
        check("the edit store is made in temp tables", store.ready(), store.why)
        for name, fn in (("stages", stages), ("reads", reads_doors), ("writes", write_doors),
                         ("editions", edition_doors)):
            if staff and skills0:
                try:
                    with real.transaction():
                        fn()
                except Exception as exc:  # noqa: BLE001 - said as a failed check
                    check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300])
        with real.cursor() as c:
            c.execute("select count(*), count(distinct write_id) from pg_temp.hub_edits_lrn")
            n, w = c.fetchone()
        facts["cells kept in the check's app.edits (temp)"] = f"{n} cells from {w} writes"
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
print(json.dumps({"checks": out, "facts": facts}))
'''


def main() -> int:
    for name in ("learning.py", "learning_writes.py", "main.py", "editions.py"):
        py_compile.compile(str(ROOT / "app" / name), doraise=True)
    py_compile.compile(str(ROOT / "server" / "snapshot_service.py"), doraise=True)
    py_compile.compile(str(ROOT / "server" / "edit_overlay.py"), doraise=True)
    print("ok   the Learning modules, main, the catalogue and the relay compile")
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
