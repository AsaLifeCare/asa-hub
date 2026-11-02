#!/usr/bin/env python3
"""Smart Comms' data-only doors decided by the streamed modules on real replies in asa-hub-db-sync: the Replies
verdict kept for an owner (the exact app.edits rows, and the Replies read laying them), every refusal in Apps Script's
words, the verdicts once handed to Apps Script, and the edition on and off for a listed person (App Control's release
simulated). Nothing real is written: the edit store lives in temp tables inside one transaction rolled back at the
end, nothing is sent and no socket may open. Prints ids, shapes and counts only."""
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
import base64, importlib.abc, importlib.util, json, socket, sys, types, uuid
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

SOCKETS = []


def no_socket(*_a, **_kw):
    SOCKETS.append(1)
    raise OSError("the check opens no socket")


import psycopg
import editions as E, gsjs, hubdb, scope as sc, locations as L, writes as W
import smart_comms_desk as D
import smart_comms_writes as SW
import smart_comms_doors as SD
import book_ops as BO
import main as M
from scope import Defer

out, facts, rows_out = [], {}, []


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_scdoors"
W.LOCK_KEY = 0x5343444F4F


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
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="smart-comms-doors-check")
socket.socket.connect = no_socket
socket.socket.connect_ex = no_socket
socket.create_connection = no_socket
proxy = Conn(real)
store = W.Store(connect=lambda: proxy, kind="check", label="Check")
# the catalogue entry the integrator files in app/editions.py, laid here while the tree does not carry it
for e in SD.EDITIONS:
    E._BY_ID.setdefault(e["id"], e)
filed = {c["id"] for c in E.CATALOGUE}
facts["edition in app/editions.py"] = ", ".join(e["id"] for e in SD.EDITIONS if e["id"] in filed) or \
    "not yet (laid by the check)"
EDITIONS = {"value": "[]"}
base_cfg = db.hiring_config
db.hiring_config = lambda: {**base_cfg(), sc.EDITIONS_KEY: EDITIONS["value"]}
STALE = {"on": False}
db.stale = lambda books: STALE["on"]
HOLDER = {"id": "", "shut": ""}
base_gate = sc.profile_app_gate


def gate(app_id, user, src):
    uid = gsjs.str_((user or {}).get("id"))
    if uid and HOLDER["shut"] == uid:
        return {"open": False, "scope": sc.scope_of("none", "closed by the check")}
    if user and HOLDER["id"] and uid == HOLDER["id"] and not user.get("is_service"):
        return {"open": True, "scope": sc.scope_of("all")}
    return base_gate(app_id, user, src)


sc.profile_app_gate = gate
M.DB = db
M.WRITES["smart-comms"] = SD
M.stores = lambda: {"smart-comms": store}
M.WRITE_BUDGET_S = 120.0
seq = [0]
SHOWN = {"state", "verdict", "close", "type", "source", "subject_type", "tenant"}


def listed(*eids, on=True):
    EDITIONS["value"] = json.dumps([{"id": e, "on": on, "people": [HOLD["uid"]]} for e in eids])


def write(who, payload):
    seq[0] += 1
    wid = f"Wcheck-scd-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    res = M._run_write(SD, SD.ACTION, who, payload, wid)
    return res.status_code, json.loads(res.body), wid


def masked(field, value):
    if field in SHOWN or value.startswith("Check"):
        return value
    return f"<{len(value)} chars>" if value else ""


def rows_of(wid, label):
    with real.cursor() as c:
        c.execute("select tab_name, kind, match_by, row_key, field, value, before, edition"
                  " from pg_temp.hub_edits_scdoors where write_id = %s order by id", (wid,))
        got = c.fetchall()
    rows_out.append({"write": label, "rows": [[t, k, m, rk if m == "id" else "<event id>", f, masked(f, v), e]
                                              for t, k, m, rk, f, v, _b, e in got]})
    return got


def plan(env):
    return env.get("_write") or {}


class Undo(Exception):
    """Each part of the check starts from the copy: its kept cells are rolled back when it ends."""


KEPT = {"cells": 0, "writes": 0}


def guarded(name, fn):
    try:
        with real.transaction():
            fn()
            with real.cursor() as c:
                c.execute("select count(*), count(distinct write_id) from pg_temp.hub_edits_scdoors")
                n, w = c.fetchone()
            KEPT["cells"] += n
            KEPT["writes"] += w
            raise Undo()
    except Undo:
        pass
    except Exception as exc:  # noqa: BLE001 - said as a failed check, never a value
        check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300])


reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]


def active(u):
    return gsjs.str_(u.get("active")).lower() != "false" and not gsjs.str_(u.get("clientkey"))


master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
manager = next((u for u in users if gsjs.str_(u.get("role")).lower() == "manager" and active(u)), None)
holder = next((u for u in users if gsjs.str_(u.get("role")).lower() == "staff" and active(u)
               and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}
MANAGER = {"uid": gsjs.str_((manager or {}).get("userid")), "role": "manager", "is_master": False}
HOLD = {"uid": gsjs.str_((holder or {}).get("userid")), "role": "staff", "is_master": False}
facts["accounts"] = (f"master row {'found' if master else 'absent'}, a manager {'found' if manager else 'absent'}, "
                     f"a staff account {'found' if holder else 'absent'}")
check("a staff account is read from the users tab", bool(holder))
with real.transaction():
    store.ensure()
    check("the edit store is made in temp tables", store.ready(), store.why)
    with real.cursor() as c:
        for stmt in BO.ddl():
            c.execute(stmt)

house0 = SD.house_of(reads0, SD.CONTRIBUTIONS)
trail0 = SD.house_of(reads0, SD.OBSERVATIONS)
idh = next(h for h in house0.ref.headers if gsjs.js_str(h) == "id")
sth = next(h for h in house0.ref.headers if gsjs.js_str(h) == "state")
by_id = {}
for rn, raw in db.rows(house0.ref):
    v = hubdb.typed(raw.get(idh), "hub")
    if v != "":
        by_id.setdefault(gsjs.js_str(v), []).append(gsjs.or_blank(hubdb.typed(raw.get(sth), "hub")))
open_once = sorted(k for k, v in by_id.items() if len(v) == 1 and v[0] in ("needs_human", "awaiting_owner"))
twice = sorted(k for k, v in by_id.items() if len(v) > 1)
facts["replies house"] = (f"tab {house0.ref.tab}, {sum(len(v) for v in by_id.values())} rows, {len(by_id)} ids, "
                          f"{len(open_once)} open once, {len(twice)} written twice; trail tab {trail0.ref.tab}")
# the newest open replies, so the Replies read (its 500 newest) carries them
listed_open = [gsjs.js_str(r.get("id")) for r in
               (json.loads(M._run(D, "commReplies", MASTER, {}).body).get("data") or {}).get("rows") or []]
newest = [k for k in listed_open if k in set(open_once)]
A = newest[0] if newest else None
B = newest[1] if len(newest) > 1 else None
T = twice[0] if twice else None
facts["subjects"] = f"A {A}, B {B}, twice {T or 'none in the copy'}"
check("two open replies are read from the copy", bool(A and B))


def replies_state(rid):
    res = M._run(D, "commReplies", MASTER, {"all": True})
    env = json.loads(res.body)
    row = next((r for r in (env.get("data") or {}).get("rows") or [] if gsjs.js_str(r.get("id")) == rid), None)
    return (env.get("data") or {}).get("open"), row


def owners():
    open_before, _row = replies_state(A)
    code, env, wid = write(MASTER, {"id": A, "verdict": "dismissed"})
    got = rows_of(wid, f"master · {A} · dismissed")
    check("the master dismisses A: answered 200, final", env.get("status") == 200 and plan(env).get("final") is True,
          env)
    check("its answer is commContributionVerdict's: the id, the verdict, nothing settled",
          env.get("data") == {"id": A, "verdict": "dismissed", "settled": []}, env)
    mine = {r[4]: r[5] for r in got if r[2] == "id"}
    check("the reply's row is edited by id, the saved cells alone, no edition",
          all(r[3] == A and r[1] == "edit" and r[7] == "" for r in got if r[2] == "id")
          and set(mine) <= set(SD.SAVED) and mine.get("state") == "dismissed" and mine.get("verdict") == "dismissed"
          and mine.get("close") == "person" and mine.get("closed_at") == mine.get("verdict_at") == mine.get("updatedAt")
          and mine.get("verdict_by"), sorted(mine))
    trail = {r[4]: r[5] for r in got if r[2] == "cols:event_id"}
    body = json.loads(trail.get("payload") or "{}")
    check("one trail row is appended, keyed by its event id: type dismissed, from the desk, the verdict as its payload",
          all(r[1] == "append" and r[0] == trail0.ref.tab for r in got if r[2] == "cols:event_id")
          and set(trail) <= set(SD.OBSERVATION_HEADER) and trail.get("type") == "dismissed"
          and trail.get("source") == "desk" and trail.get("subject_type") == "person"
          and trail.get("event_id", "").startswith("cmo_") and len(trail.get("event_id", "")) == 20
          and list(body) == ["verdict", "by", "contribution"] and body.get("contribution") == A
          and trail.get("at") == mine.get("verdict_at"), sorted(trail))
    open_after, row = replies_state(A)
    check("the Replies read lays the kept verdict at once: the row reads dismissed and one fewer is open",
          row is not None and row.get("state") == "dismissed" and row.get("verdict") == "dismissed"
          and open_after == (open_before or 0) - 1, f"{open_before} → {open_after}, {row and row.get('state')}")
    code, env, wid = write(MASTER, {"id": B, "verdict": "not_settled", "note": "Check — not yet"})
    got = rows_of(wid, f"master · {B} · not settled, with a note")
    mine = {r[4]: r[5] for r in got if r[2] == "id"}
    trail = {r[4]: r[5] for r in got if r[2] == "cols:event_id"}
    check("not settled keeps B open: awaiting the owner, no close stamped, the note kept, the trail says contribution",
          env.get("status") == 200 and plan(env).get("final")
          and mine.get("state", "awaiting_owner") == "awaiting_owner" and mine.get("close", "") == ""
          and mine.get("closed_at", "") == "" and mine.get("note") == "Check — not yet"
          and trail.get("type") == "contribution", env)
    if manager:
        code, env, wid = write(MANAGER, {"id": B, "verdict": "dismissed"})
        got = rows_of(wid, f"a manager · {B} · dismissed")
        check("a manager gives a verdict as today (role manager), no edition",
              env.get("status") == 200 and plan(env).get("final") and got and all(r[7] == "" for r in got), env)


def refusals():
    cases = [
        ({}, 400, "Missing required parameter: id."),
        ({"id": ""}, 400, "Missing required parameter: id."),
        ({"id": "x"}, 400, "Missing required parameter: verdict."),
        ({"id": 5, "verdict": "dismissed"}, 400, "id must be string, got number."),
        ({"id": "x", "verdict": True}, 400, "verdict must be string, got boolean."),
        ({"id": "x", "verdict": "dismissed", "note": ["a"]}, 400, "note must be string, got array."),
        ({"id": "x", "verdict": "dismissed", "note": {"a": 1}}, 400, "note must be string, got object."),
        ({"id": "   ", "verdict": "dismissed"}, 400, SD.NEED),
        ({"id": A, "verdict": "maybe"}, 400, SD.NEED),
        ({"id": A, "verdict": " Dismissed"}, 400, SD.NEED),
    ]
    for payload, status, msg in cases:
        code, env, _ = write(MASTER, payload)
        check(f"refused {json.dumps(payload)[:48]}: {msg}", env == {"status": status, "message": msg}, env)
    code, env, _ = write(HOLD, {"id": A, "verdict": "dismissed"})
    check("a staff account no edition lists: the policy's sentence",
          env == {"status": 403, "message": "This action is for admin or director or manager."}, env)
    code, env, _ = write(HOLD, {})
    check("the role is refused before the params, as hubPolicyGate_ orders them",
          env == {"status": 403, "message": "This action is for admin or director or manager."}, env)


def no_handoffs():
    code, env, wid = write(MASTER, {"id": A, "verdict": "settled", "note": "Check — settled"})
    got = rows_of(wid, f"master · {A} · settled")
    check("settled is kept here, final, never Apps Script",
          env.get("status") == 200 and plan(env).get("final") is True and not plan(env).get("engine"), env)
    mine = {r[4]: r[5] for r in got if r[0] == house0.ref.tab and r[2] == "id"}
    check("…the reply closed as a person's close: state settled, close person",
          mine.get("state") == "settled" and mine.get("close") == "person", got)
    check("…the trail says settled", any(r[0] == trail0.ref.tab and r[4] == "type" and r[5] == "settled" for r in got),
          got)
    facts["settled: the demands closed"] = json.dumps((env.get("data") or {}).get("settled"))
    facts["settled: tabs it wrote"] = ", ".join(sorted({r[0] for r in got}))
    code, env, _ = write(MASTER, {"id": "CMC_CHECKNOSUCHROW", "verdict": "dismissed"})
    check("an id the copy does not hold: 404 here", env == {"status": 404, "message": SD.NO_SUCH}, env)
    if T:
        code, env, wid = write(MASTER, {"id": T, "verdict": "dismissed"})
        with real.cursor() as c:
            c.execute("select op, spec from pg_temp.hub_book_ops_scdoors where write_id = %s", (wid,))
            ops = c.fetchall()
        check("an id written twice: its row's cells a `cells` book op on the first row",
              env.get("status") == 200 and [(o, s.get("key"), s.get("which")) for o, s in ops] == [("cells", T, "first")],
              ops)
    STALE["on"] = True
    try:
        code, env, _ = write(MASTER, {"id": A, "verdict": "dismissed"})
        check("a house newer than its copy defers, never Apps Script", code == 503 and "defer" in env, env)
    finally:
        STALE["on"] = False
    real_gate = W.gate
    W.gate = lambda reads: (_ for _ in ()).throw(Defer("armed by the check"))
    try:
        code, env, _ = write(MASTER, {"id": A, "verdict": "dismissed"})
        check("the book-write gate armed: 503 here", env == {"status": 503, "message": SW.ARMED_HELD}, env)
    finally:
        W.gate = real_gate


def people():
    HOLDER["id"], HOLDER["shut"] = "", HOLD["uid"]
    listed(SD.EDITION)
    code, env, _ = write(HOLD, {"id": A, "verdict": "dismissed"})
    check("listed but Smart Comms is not released to them: the policy's sentence",
          env == {"status": 403, "message": SD.POLICY_REFUSAL}, env)
    HOLDER["id"], HOLDER["shut"] = HOLD["uid"], ""
    listed(SD.EDITION, on=False)
    code, env, _ = write(HOLD, {"id": A, "verdict": "dismissed"})
    check(f"{SD.EDITION} off (listed): the policy's sentence",
          env == {"status": 403, "message": SD.POLICY_REFUSAL}, env)
    listed("smartComms.words", "smartComms.switch")
    code, env, _ = write(HOLD, {"id": A, "verdict": "dismissed"})
    check("the Desk's editions do not open the Replies verdict", env == {"status": 403, "message": SD.POLICY_REFUSAL},
          env)
    listed(SD.EDITION)
    sess = L.Session(L.Reads(db, None), M.caller(HOLD, L.Reads(db, None)))
    check("the page's powers for the holder: a verdict, never the settling one",
          SD.replies_powers(sess) == {"verdict": True, "settle": False, "edition": True}, SD.replies_powers(sess))
    msess = L.Session(L.Reads(db, None), M.caller(MASTER, L.Reads(db, None)))
    check("the page's powers for the master: every verdict, by role",
          SD.replies_powers(msess) == {"verdict": True, "settle": True, "edition": False}, SD.replies_powers(msess))
    code, env, wid = write(HOLD, {"id": A, "verdict": "dismissed"})
    got = rows_of(wid, f"listed ({SD.EDITION}) · {A} · dismissed")
    check(f"{SD.EDITION} on: dismissed kept, final, both rows name the edition",
          env.get("status") == 200 and plan(env).get("final") and len({r[2] for r in got}) == 2
          and all(r[7] == SD.EDITION for r in got), env)
    code, env, wid = write(HOLD, {"id": B, "verdict": "not_settled"})
    check(f"{SD.EDITION} on: not settled kept, final", env.get("status") == 200 and plan(env).get("final"), env)
    code, env, _ = write(HOLD, {"id": A, "verdict": "settled"})
    check("settling stays with an admin, a director or a manager", env.get("status") == 403
          and env.get("message") == SD.SETTLE_HELD and not plan(env), env)
    code, env, _ = write(HOLD, {"id": "CMC_CHECKNOSUCHROW", "verdict": "dismissed"})
    check("an id the copy does not hold: Apps Script's 404 sentence",
          env == {"status": 404, "message": SD.NO_SUCH}, env)
    if T:
        code, env, _ = write(HOLD, {"id": T, "verdict": "dismissed"})
        check("an id written twice is the holder's too, carried to its first row",
              env.get("status") == 200 and not plan(env).get("engine"), env)
    code, env, _ = write(HOLD, {"id": A})
    check("the params are refused in Apps Script's words for a holder too",
          env == {"status": 400, "message": "Missing required parameter: verdict."}, env)
    real_gate = W.gate
    W.gate = lambda reads: (_ for _ in ()).throw(Defer("armed by the check"))
    try:
        code, env, _ = write(HOLD, {"id": A, "verdict": "dismissed"})
        check("the book-write gate armed: a holder is told, nothing carried",
              env == {"status": 503, "message": SW.ARMED_HELD}, env)
    finally:
        W.gate = real_gate
    HOLDER["id"] = ""


try:
    with real.transaction():
        for name, fn in (("an owner's verdicts", owners), ("the refusals", refusals), ("no hand-off left", no_handoffs),
                         ("the edition", people)):
            if A and B and holder:
                guarded(name, fn)
        facts["cells kept in the check's app.edits (temp), each part rolled back"] = \
            f"{KEPT['cells']} cells from {KEPT['writes']} writes"
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
check("no socket was opened by any decision", not SOCKETS, f"{len(SOCKETS)} attempt(s)")
check("the busy lock is never a 409", SD.BUSY_OF[SD.ACTION]["status"] != 409)
check("the edition is Smart Comms', off with nobody listed until Settings › Editions lists someone",
      all(e["id"].startswith("smartComms.") and e["app"] == "smart-comms" and e["app_name"] == "Smart Comms"
          for e in SD.EDITIONS))
print(json.dumps({"checks": out, "facts": facts, "rows": rows_out}))
'''


def main() -> int:
    py_compile.compile(str(ROOT / "app" / "smart_comms_doors.py"), doraise=True)
    print("ok   app/smart_comms_doors.py compiles")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps({"app": app}).encode()) + b"\n", capture_output=True,
                         timeout=900)
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
    for w in res["rows"]:
        print(f"rows {w['write']}:")
        for r in w["rows"]:
            print("     " + " | ".join(str(x) for x in r))
    print(f"{len(res['checks']) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
