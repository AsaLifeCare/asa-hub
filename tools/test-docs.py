#!/usr/bin/env python3
"""Docs' library decided by the streamed modules on the real documents tab in asa-hub-db-sync: the list read off the
copy, a document registered and changed, the refusals, a person docs.library lists, and the app.edits rows each final
write keeps. Nothing real is written: the edit store lives in temp tables inside one transaction rolled back at the
end. Prints shapes and counts only."""
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
import docs as D
import docs_writes as DW
import main as M

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_doc"
W.LOCK_KEY = 0x444F43434B


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
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="docs-check")
store = W.Store(connect=lambda: Conn(real), kind="check", label="Check")
EDITIONS = {"value": "[]"}
if not any(a == "docs" for _e, a in sc.EDITIONS):
    sc.EDITIONS = tuple(sc.EDITIONS) + (("docs.library", "docs"),)
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
M.stores = lambda: {"docs": store}
M.WRITE_BUDGET_S = 120.0
seq = [0]


def read(action, who, payload):
    res = M._run(D, action, who, payload)
    return res.status_code, json.loads(res.body)


def write(action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-doc-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    res = M._run_write(DW, action, who, payload, wid)
    return res.status_code, json.loads(res.body), wid


def kept(wid):
    with real.cursor() as c:
        c.execute("select sheet_id, tab_name, kind, row_key, field, edition from pg_temp.hub_edits_doc"
                  " where write_id = %s order by id", (wid,))
        return c.fetchall()


def final(env):
    return (env.get("_write") or {}).get("final") is True


reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
staff = next((u for u in users if gsjs.str_(u.get("role")).lower() == "staff" and not gsjs.str_(u.get("clientkey"))
              and gsjs.str_(u.get("active")).lower() != "false"
              and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT), None)
client = next((u for u in users if gsjs.str_(u.get("role")).lower() == "client"), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}
STAFF = {"uid": gsjs.str_((staff or {}).get("userid")), "role": "staff", "is_master": False}
CLIENT = {"uid": gsjs.str_((client or {}).get("userid")), "role": "client", "is_master": False}
rows0 = D.rows(reads0)
house = db.resolve(D.TAB).sheet_id
facts["copy"] = f"{len(rows0)} documents"
check("a staff account and the documents are read from the copy", bool(staff and rows0))


def reads_doors():
    code, env = read("docsList", MASTER, {})
    got = env.get("data") or []
    check("the master reads the library: 200, every row the copy holds", code == 200 and env.get("status") == 200 and
          len(got) == len(rows0) and all(r.get("id") and r.get("title") and r.get("url") for r in got), env.get("message"))
    code, env = read("docsList", STAFF, {})
    check("anyone signed in reads it, as the generic list answers", env.get("status") == 200, env)
    if client:
        code, env = read("docsList", CLIENT, {})
        check("a client's list is left to Apps Script (it narrows to their own rows)", code == 503, env)
    code, env = read("docsList", MASTER, {"q": "x"})
    check("a filtered list is left to Apps Script", code == 503, env)


def write_doors():
    code, env, wid = write("docsCreate", MASTER, {"title": "Check doc", "url": "https://example.org/check.pdf",
                                                   "category": "Check", "collection": "Check",
                                                   "addedAt": "2000-01-01T00:00:00.000Z", "tenant": "elsewhere"})
    got = kept(wid)
    rec = env.get("data") or {}
    check("the master registers a document: 200, final, one row appended in the documents house's Data tab",
          env.get("status") == 200 and final(env) and got and
          all(r[0] == house and r[1] == "Data" and r[2] == "append" for r in got), env)
    check("with an id, createdAt and updatedAt as createRow_ gives them, and the place never the caller's",
          rec.get("id") and rec.get("createdAt") and rec.get("updatedAt") and "tenant" not in rec and
          {r[4] for r in got} >= {"id", "title", "url", "category", "collection", "addedAt", "createdAt", "updatedAt"},
          rec)
    code, env = read("docsList", MASTER, {})
    check("the next read lists it", any(r.get("id") == rec.get("id") for r in env.get("data") or []))
    code, env, wid = write("docsUpdate", MASTER, {"id": rec.get("id"), "category": "Check 2", "collection": "Check 2"})
    cells = {r[4] for r in kept(wid)}
    check("changing its category: 200, final, the cells it sets and the stamp",
          env.get("status") == 200 and final(env) and cells == {"category", "collection", "updatedAt"} and
          (env.get("data") or {}).get("title") == "Check doc", (env, sorted(cells)))
    first = rows0[0]
    code, env, wid = write("docsUpdate", MASTER, {"id": gsjs.str_(first.get("id")), "title": "Check — renamed"})
    check("renaming a real document edits its copied row", env.get("status") == 200 and final(env) and
          {r[2] for r in kept(wid)} == {"edit"}, env)
    code, env, _ = write("docsUpdate", MASTER, {"title": "x"})
    check("no id is refused as updateRowById_ refuses it",
          env == {"status": 400, "message": 'Missing required "id" in payload.'}, env)
    code, env, _ = write("docsUpdate", MASTER, {"id": "no-such-doc", "title": "x"})
    check("an unknown document is 404", env == {"status": 404, "message": 'No "documents" record with id "no-such-doc".'},
          env)
    code, env, _ = write("docsCreate", MASTER, {"title": "x", "url": "y", "colour": "red"})
    check("a column the tab does not have is not kept by Python (the relay answers it was not written)", code == 503,
          env)
    code, env, _ = write("docsCreate", STAFF, {"title": "x", "url": "y"})
    check("a staff member nobody listed is refused", env == {"status": 403, "message": DW.DENIED}, env)


def edition_doors():
    HOLDER["id"] = STAFF["uid"]
    EDITIONS["value"] = json.dumps([{"id": "docs.library", "on": True, "people": [STAFF["uid"]]}])
    code, env, wid = write("docsCreate", STAFF, {"title": "Check by staff", "url": "https://example.org/s.pdf",
                                                  "category": "Check"})
    got = kept(wid)
    check("a staff member docs.library lists registers one: 200, final, the edition named",
          env.get("status") == 200 and final(env) and got and all(r[5] == "docs.library" for r in got), env)
    EDITIONS["value"] = json.dumps([{"id": "docs.library", "on": False, "people": [STAFF["uid"]]}])
    code, env, _ = write("docsCreate", STAFF, {"title": "x", "url": "y"})
    check("an edition whose key is off lets nobody in", env == {"status": 403, "message": DW.DENIED}, env)
    HOLDER["id"] = ""


try:
    with real.transaction():
        store.ensure()
        check("the edit store is made in temp tables", store.ready(), store.why)
        for name, fn in (("reads", reads_doors), ("writes", write_doors), ("editions", edition_doors)):
            if staff and rows0:
                try:
                    with real.transaction():
                        fn()
                except Exception as exc:  # noqa: BLE001 - said as a failed check
                    check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300])
        with real.cursor() as c:
            c.execute("select count(*), count(distinct write_id) from pg_temp.hub_edits_doc")
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
    for name in ("docs.py", "docs_writes.py", "main.py", "editions.py"):
        py_compile.compile(str(ROOT / "app" / name), doraise=True)
    py_compile.compile(str(ROOT / "server" / "snapshot_service.py"), doraise=True)
    py_compile.compile(str(ROOT / "server" / "edit_overlay.py"), doraise=True)
    print("ok   the Docs modules, main, the catalogue and the relay compile")
    local = relay_doors()
    for name, ok in local:
        print(("ok   " if ok else "FAIL ") + name)
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
    failed += sum(1 for _n, ok in local if not ok)
    print(f"{len(res['checks']) + 1 + len(local) - failed} ok, {failed} failed")
    return 1 if failed else 0


def relay_doors() -> list[tuple[str, bool]]:
    """The relay's generic-verb table and door, lifted from snapshot_service.py alone and run on envelopes."""
    import ast
    import urllib.parse
    src = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    wanted = {"DOCS_RESOURCE", "BACKEND_GENERIC_DOORS", "_GENERIC_VERBS", "_backend_generic_door"}
    nodes = [n for n in ast.parse(src).body
             if (isinstance(n, ast.FunctionDef) and n.name in wanted)
             or (isinstance(n, (ast.Assign, ast.AnnAssign)) and
                 {getattr(t, "id", "") for t in (n.targets if isinstance(n, ast.Assign) else [n.target])} & wanted)]
    ns: dict = {"Any": object, "_relay_envelope": lambda raw: json.loads(
        urllib.parse.parse_qs(raw.decode())["body"][0])}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "relay_doors", "exec"), ns)

    def raw(**env: object) -> bytes:
        return urllib.parse.urlencode({"body": json.dumps(env)}).encode()
    door = ns["_backend_generic_door"]
    return [("the relay asks Python for documents' list, create and update under their doors' names",
             [door(a, raw(resource="documents", action=a)) for a in ("list", "create", "update")] ==
             ["docsList", "docsCreate", "docsUpdate"]),
            ("a removal of a document stays the generic verb (Apps Script's)",
             door("delete", raw(resource="documents", action="delete")) == "delete"),
            ("another resource's generic verbs are untouched", door("create", raw(resource="tasks")) == "create"),
            ("in a world, away from home or on a visit, documents stay Apps Script's",
             all(door("create", raw(resource="documents", **{k: "x"})) == "create"
                 for k in ("world", "tenant", "member"))),
            ("a named action is never renamed", door("formSave", raw(resource="documents")) == "formSave")]


if __name__ == "__main__":
    sys.exit(main())
