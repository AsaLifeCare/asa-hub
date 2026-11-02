#!/usr/bin/env python3
"""Clients › Family members as an edition (clients.family), decided by the streamed modules on two real clients in
asa-hub-db-sync: the master allowed, a person not listed refused, a holder of another edition refused, a listed person
allowed (the editions value and App Control's release simulated), a stale witness 409, a field outside the record
refused, the care rows unchanged, each edit kept in app.edits and read back. Nothing real is written: the edit store
lives in temp tables inside one transaction rolled back at the end. Prints shapes, counts and the kept rows with every
value read from a record masked."""
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
import gsjs, hubdb, scope as sc, locations as L, clients as C, writes as W, client_writes as CW
import main as M

out, facts, kept_rows = [], {}, []


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


# the catalogue row the integrator adds to scope.py, simulated when this checkout does not carry it yet
if "clients.family" not in {e for e, _a in sc.EDITIONS}:
    sc.EDITIONS = sc.EDITIONS + (("clients.family", "client-profiles"),)
    facts["scope.py EDITIONS"] = "clients.family not in this checkout yet (simulated here)"
else:
    facts["scope.py EDITIONS"] = "carries clients.family"
W.EDITS_TABLE = "pg_temp.hub_edits_clients_check"
W.LOCK_KEY = 0x434C45444B


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
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="clients-editions-check")
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
none = W.Store(dsn="")
M.DB = db
M.STORE = M.STAFF_STORE = M.SSA_STORE = M.FAMILY_STORE = M.SCHEDULING_STORE = none
M.CLIENT_STORE = store
M.WRITE_BUDGET_S = 120.0
seq = [0]
spent = {}


def listed(*eids):
    EDITIONS["value"] = json.dumps([{"id": e, "on": True, "people": [HOLDER["id"]]} for e in eids])


def write(who, payload, label):
    seq[0] += 1
    wid = f"Wcheck-ce-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    t0 = time.monotonic()
    res = M._run_write(CW, "clientProfileOverride", who, payload, wid)
    spent[label] = max(spent.get(label, 0.0), time.monotonic() - t0)
    return res.status_code, json.loads(res.body), wid


SHOWN = {}


def rows_of(wid, label, subject, member=""):
    with real.cursor() as c:
        c.execute("select tab_name, kind, match_by, row_key, field, value, edition from "
                  + W.EDITS_TABLE + " where write_id = %s order by id", (wid,))
        got = c.fetchall()
    for tab, kind, match, key, field, value, edition in got:
        def mask(v):
            v = str(v).replace(subject, "<client>")
            return v.replace(member, "<member>") if member else v
        if field in SHOWN.get(wid, {}):
            shown = value
        elif field in ("client_key", "kind", "tab", "state"):
            shown = mask(value)
        elif field == "target":
            shown = mask(value) if value else ""
        elif field == "id":
            shown = mask(value)
        else:
            shown = "<as read>" if value else ""
        kept_rows.append({"write": label, "tab_name": tab, "kind": kind, "match_by": match, "row_key": mask(key),
                          "field": field, "value": shown, "edition": edition})
    return got


def final_of(env):
    return (env.get("_write") or {}).get("final") is True


def unknown(code, env):
    return code == 200 and env == {"status": 404, "message": "Unknown action."}


def family_now(key):
    own = CW.Own([], book=db.book, edits=store.edits(), edits_at=time.time())
    tok = hubdb.OWN.set(own)
    try:
        reads = L.Reads(db, None)
        ctx = C.client_ctx(reads, key)
        people, _w = L._soft(lambda: C.people_index(reads))
        return C.family_of(reads, ctx, C.isp_row(reads, key), people)
    finally:
        hubdb.OWN.reset(tok)


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

# two real clients: A with a plan member to correct, B to add one to
A = B = ""
member = None
for c in C.derived(reads0)[:400]:
    if not C.client_live(c):
        continue
    key = gsjs.trim(gsjs.or_text(c.get("client_key"))) or gsjs.name_key(c.get("name"))
    ctx = C.client_ctx(reads0, key)
    if ctx.get("refused") or ctx.get("archived"):
        continue
    try:
        fam = family_now(key)
    except Exception:
        continue
    plain = [m for m in fam if m.get("key") and not str(m["key"]).startswith("CO_")
             and not any(C._marked(v) for v in (m.get("edit") or {}).values())]
    if not A and plain:
        A, member = key, plain[0]
    elif not B and key != A:
        B = key
    if A and B:
        break
check("two real clients: one whose plan names a family member, one more", bool(A and B and member))
facts["subjects"] = f"A: a client with {len(family_now(A)) if A else 0} family member(s); B: another current client"
NAME, PHONE, PHONE2, MAIL = "Edition Check", "(330) 555-0142", "(330) 555-0143", "edition.check@example.org"


def doors():
    # the master adds a member on B
    code, env, wid = write(MASTER, {"client": B, "kind": "family", "target": "", "changes": [
        {"field": "name", "value": NAME, "expected": ""}, {"field": "relationship", "value": "Sister", "expected": ""},
        {"field": "phone", "value": PHONE, "expected": ""}]}, "master adds on B")
    SHOWN[wid] = {"name", "relationship", "phone", "email"}
    rid = (env.get("data") or {}).get("id", "")
    got = rows_of(wid, "master adds a family member (B)", B)
    steps = [s.get("id") for s in (env.get("data") or {}).get("steps", [])]
    check("master: a new family member kept final in app.edits (an append, no edition), its Apply steps name Postgres",
          env.get("status") == 200 and final_of(env) and rid.startswith("CO_" + B + "_family_")
          and {g[1] for g in got} == {"append"} and {g[6] for g in got} == {""} and steps == ["postgres", "cache"],
          [env.get("status"), env.get("message"), len(got), steps])
    seen = [m for m in family_now(B) if m.get("key") == rid]
    check("master: the next read of B's family members lists the new member", len(seen) == 1 and seen[0]["name"] == NAME)

    # the master corrects A's plan member; a stale witness; a field outside the record
    e = member["edit"]
    code, env, wid = write(MASTER, {"client": A, "kind": "family", "target": member["key"], "changes": [
        {"field": "phone", "value": PHONE2, "expected": e.get("phone", "")}]}, "master corrects on A")
    SHOWN[wid] = {"phone"}
    got = rows_of(wid, "master corrects a plan member's phone (A)", A, member["key"])
    check("master: a plan member's phone corrected over the plan, kept final (the override row appended)",
          env.get("status") == 200 and final_of(env) and {g[1] for g in got} == {"append"}
          and any(g[4] == "phone" and g[5] == PHONE2 for g in got), [env.get("status"), env.get("message")])
    code, env, wid = write(MASTER, {"client": A, "kind": "family", "target": member["key"], "changes": [
        {"field": "relationship", "value": "Cousin", "expected": "zz-not-what-it-holds"}]}, "stale")
    check("master: a stale witness is the 409 with what the record holds, nothing kept",
          env.get("status") == 409 and "relationship" in ((env.get("data") or {}).get("current") or {})
          and not rows_of(wid, "stale", A, member["key"]), env.get("status"))
    code, env, wid = write(MASTER, {"client": A, "kind": "family", "target": member["key"], "changes": [
        {"field": "ssn", "value": "x", "expected": ""}]}, "outside")
    why = {r["field"]: r["why"] for r in (env.get("data") or {}).get("refused", [])}
    check("master: a field outside the family record is refused by name, nothing kept",
          env.get("status") == 200 and why.get("ssn") == "Not a field this record edits."
          and not rows_of(wid, "outside", A, member["key"]), [env.get("status"), why])

    # a person not listed, a holder of another edition, then a listed holder
    EDITIONS["value"] = "[]"
    code, env, wid = write(HOLD, {"client": B, "kind": "family", "target": "", "changes": [
        {"field": "name", "value": NAME + " Two", "expected": ""}]}, "not listed")
    check("a person not listed: no door (Unknown action), nothing kept", unknown(code, env) and not rows_of(wid, "x", B), env)
    listed("clients.care")
    code, env, wid = write(HOLD, {"client": B, "kind": "family", "target": "", "changes": [
        {"field": "name", "value": NAME + " Two", "expected": ""}]}, "care holder on family")
    check("a holder of clients.care alone: the family members stay shut", unknown(code, env), env)
    code, env, wid = write(HOLD, {"client": B, "kind": "care", "tab": "daily", "target": "", "changes": [
        {"field": "record", "value": "Edition check", "expected": ""},
        {"field": "text", "value": "Checked.", "expected": ""}]}, "care holder on care")
    SHOWN[wid] = {"record", "text"}
    got = rows_of(wid, "a clients.care holder adds a care row (B)", B)
    check("a holder of clients.care still adds a care row, kept under clients.care",
          env.get("status") == 200 and final_of(env) and {g[6] for g in got} == {"clients.care"}, env.get("status"))
    listed("clients.family")
    code, env, wid = write(HOLD, {"client": A, "kind": "family", "target": member["key"], "changes": [
        {"field": "email", "value": MAIL, "expected": e.get("email", "")}]}, "holder corrects on A")
    SHOWN[wid] = {"email", "phone"}
    got = rows_of(wid, "a clients.family holder corrects the e-mail (A)", A, member["key"])
    check("a holder of clients.family corrects the plan member, kept under clients.family (an edit of the override row)",
          env.get("status") == 200 and final_of(env) and {g[6] for g in got} == {"clients.family"}
          and {g[1] for g in got} == {"edit"}, [env.get("status"), env.get("message"), len(got)])
    now = [m for m in family_now(A) if m.get("key") == member["key"]]
    check("the next read of A shows both corrections (the master's phone, the holder's e-mail)",
          len(now) == 1 and gsjs.str_(now[0].get("email")) == MAIL
          and re.sub(r"\D", "", gsjs.str_(now[0].get("phone"))) == re.sub(r"\D", "", PHONE2))
    code, env, wid = write(HOLD, {"client": B, "kind": "family", "target": rid, "changes": [
        {"field": "removed", "value": "Yes", "expected": ""}]}, "holder hides on B")
    SHOWN[wid] = {"state"}
    got = rows_of(wid, "a clients.family holder hides the member the master added (B)", B)
    check("a holder hides the member the master added: the same row edited, kept under clients.family",
          env.get("status") == 200 and final_of(env) and {g[1] for g in got} == {"edit"}
          and any(g[4] == "state" and g[5] == "removed" for g in got), env.get("status"))
    check("the next read of B no longer lists the hidden member", not [m for m in family_now(B) if m.get("key") == rid])


try:
    with real.transaction():
        if A and B and member:
            try:
                with real.transaction():
                    doors()
            except Exception as exc:
                check("the doors ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300])
        with real.cursor() as c:
            c.execute("select count(*), count(distinct write_id) from " + W.EDITS_TABLE)
            n, w = c.fetchone()
        facts["cells kept in the check's app.edits (temp)"] = f"{n} cells from {w} writes"
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
with psycopg.connect(hubdb._dsn(), autocommit=True, connect_timeout=5) as c2:
    left = c2.execute("select count(*) from pg_stat_activity where application_name = 'clients-editions-check'").fetchone()[0]
check("nothing is left: the check's session is gone, its temp tables with it", left == 0, left)
facts["slowest decision (s)"] = ", ".join(f"{a} {t:.1f}" for a, t in sorted(spent.items()))
facts["peak memory (MiB)"] = str(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024)
print(json.dumps({"checks": out, "facts": facts, "rows": kept_rows}))
'''


def main() -> int:
    print("Clients › Family members (clients.family), on real clients (asa-hub-db-sync)")
    blob = {"app": {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=1500)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        check("the driver ran in asa-hub-db-sync", False, got.stderr.decode()[-1500:])
    else:
        res = json.loads(lines[-1])
        for name, ok, detail in res["checks"]:
            check(name, ok, detail)
        for k, v in res["facts"].items():
            print(f"  fact {k}: {v}")
        if "--rows" in sys.argv:
            print("  app.edits rows (rolled back):")
            for r in res["rows"]:
                print("    " + json.dumps(r, ensure_ascii=False))
    print(f"{results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
