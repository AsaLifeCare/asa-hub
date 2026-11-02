#!/usr/bin/env python3
"""Smart Comms' Desk save decided by the streamed modules on real situations in asa-hub-db-sync: an admin's saves and
the exact app.edits rows they keep, every refusal of smartCommsSet's validation, the saves handed to Apps Script, and
each edition on and off for a listed person (App Control's release simulated). Nothing real is written: the edit
store lives in temp tables inside one transaction rolled back at the end, and no socket may open. Prints ids, shapes
and counts only."""
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

import psycopg
import editions as E, gsjs, hubdb, scope as sc, locations as L, writes as W
import smart_comms_writes as SW
import book_ops as BO
import main as M
from scope import Defer

out, facts, rows_out = [], {}, []


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_scw"
W.LOCK_KEY = 0x5343574348


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
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="smart-comms-writes-check")
proxy = Conn(real)
store = W.Store(connect=lambda: proxy, kind="check", label="Check")
# the catalogue entries the integrator files in app/editions.py, laid here while the tree does not carry them
for e in SW.EDITIONS:
    E._BY_ID.setdefault(e["id"], e)
facts["editions in app/editions.py"] = ", ".join(e["id"] for e in SW.EDITIONS if e["id"] in {c["id"] for c in E.CATALOGUE}) or "none yet (laid by the check)"
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
M.WRITES["smart-comms"] = SW
M.stores = lambda: {"smart-comms": store}
M.WRITE_BUDGET_S = 120.0
seq = [0]
SHOWN = {"enabled", "channels", "frequency", "max_attempts", "send_at", "days_before"}
SOCKETS = []


def no_socket(*_a, **_kw):
    SOCKETS.append(1)
    raise OSError("the check opens no socket")


socket.socket.connect = no_socket
socket.socket.connect_ex = no_socket
socket.create_connection = no_socket


def listed(*eids, on=True):
    EDITIONS["value"] = json.dumps([{"id": e, "on": on, "people": [HOLDER["id"] or HOLD["uid"]]} for e in eids])


def write(who, payload):
    seq[0] += 1
    wid = f"Wcheck-scw-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    res = M._run_write(SW, SW.ACTION, who, payload, wid)
    return res.status_code, json.loads(res.body), wid


def masked(field, value):
    if field in SHOWN or value.startswith("Check"):
        return value
    return f"<{len(value)} chars>" if value else ""


def rows_of(wid, label):
    with real.cursor() as c:
        c.execute("select tab_name, kind, match_by, row_key, field, value, before, edition from pg_temp.hub_edits_scw"
                  " where write_id = %s order by id", (wid,))
        got = c.fetchall()
    rows_out.append({"write": label, "rows": [[t, k, m, rk, f, masked(f, v), e] for t, k, m, rk, f, v, _b, e in got]})
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
                c.execute("select count(*), count(distinct write_id) from pg_temp.hub_edits_scw")
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
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
admin2 = next((u for u in users if gsjs.str_(u.get("role")) == "admin" and not gsjs.str_(u.get("clientkey"))
               and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT
               and gsjs.str_(u.get("active")).lower() != "false"), None)
holder = next((u for u in users if gsjs.str_(u.get("role")).lower() == "staff" and not gsjs.str_(u.get("clientkey"))
               and gsjs.str_(u.get("active")).lower() != "false"
               and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}
ADMIN2 = {"uid": gsjs.str_((admin2 or {}).get("userid")), "role": "admin", "is_master": False}
HOLD = {"uid": gsjs.str_((holder or {}).get("userid")), "role": "staff", "is_master": False}
facts["accounts"] = (f"master row {'found' if master else 'absent'}, another admin {'found' if admin2 else 'absent'}, "
                     f"a staff account {'found' if holder else 'absent'}")
check("a staff account is read from the users tab", bool(holder))
with real.transaction():
    store.ensure()
    check("the edit store is made in temp tables", store.ready(), store.why)
    with real.cursor() as c:
        for stmt in BO.ddl():
            c.execute(stmt)

res0, _h, index0 = SW.situations(reads0)
facts["situations house"] = f"tab {res0.ref.tab}, {sum(len(v) for v in index0.values())} rows, {len(index0)} ids"
twice = sorted(k for k, v in index0.items() if k and len(v) > 1)
facts["ids written twice"] = f"{len(twice)} ({', '.join(twice[:3])}…)" if twice else "0"


def pick(kinds):
    for k in sorted(index0):
        if k and len(index0[k]) == 1:
            was = index0[k][0][0]
            if not SW.is_gate(was) and was["kind"] in kinds and not was["from_line"].strip() and not was["record_to"].strip():
                return k
    return None


A = pick(("event", "letter", "reminder"))
B = next((k for k in sorted(index0) if k and k != A and len(index0[k]) == 1 and not SW.is_gate(index0[k][0][0])
          and not index0[k][0][0]["from_line"].strip()), None)
G = next((k for k in sorted(index0) if k and len(index0[k]) == 1 and SW.is_gate(index0[k][0][0])), None)
D = twice[0] if twice else None
facts["subjects"] = f"A {A}, B {B}, gate {G}, twice {D}"
check("two plain situations and a gate are read from the copy", bool(A and B and G))


def was(rid, h):
    return index0[rid][-1][0][h]


def flipped(rid):
    return "no" if was(rid, "enabled") == "yes" else "yes"


def admins():
    flip = flipped(A)
    code, env, wid = write(MASTER, {"rows": [{"id": A, "enabled": flip}]})
    got = rows_of(wid, f"master · {A} · the switch")
    check("the master switches A: answered 200, final", env.get("status") == 200 and plan(env).get("final") is True, env)
    check("its app.edits row is exactly the switch cell, matched by id, with the stored value before and no edition",
          [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]) for r in got] ==
          [(res0.ref.tab, "edit", "id", A, "enabled", flip, index0[A][-1][1]["enabled"], "")], got)
    d = env.get("data") or {}
    check("its answer is smartCommsSet's: saved 1, nothing unknown, the correction's own skip",
          d.get("saved") == 1 and d.get("unknown") == [] and d.get("unaddressed") == [] and d.get("bad_hours") == []
          and d.get("correction") == {"discovered": 0, "incidents": [], "said": 0, "audience": 0,
                                      "skipped": [f"{A}: the words did not move"], "woke": ""}, d)
    code, env, _ = write(MASTER, {"rows": [{"id": A, "enabled": flip}]})
    check("the same switch again lays over the copy and keeps nothing", env.get("status") == 200 and not plan(env), env)
    code, env, wid = write(MASTER, {"rows": [{"id": B, "sms_text": "Check — the words", "to": "allstaff",
                                              "send_at": "9am, 13:00", "enabled": was(B, "enabled")}]})
    got = rows_of(wid, f"master · {B} · words, audience, hours")
    check("the master's words, audience and hours on B: final, the changed cells alone",
          env.get("status") == 200 and plan(env).get("final") and
          {r[4] for r in got} == {f for f, v in (("sms_text", "Check — the words"), ("to", "allstaff"),
                                                 ("send_at", "9am, 13:00")) if v != was(B, f)}, got)
    check("words that moved with nothing declared are an improvement",
          (env.get("data") or {}).get("correction", {}).get("skipped") ==
          [f"{B}: the words moved, and nothing was declared wrong — an improvement"], env)
    code, env, wid = write(MASTER, {"rows": [{"id": A, "channels": "sms"}, {"id": A, "frequency": "weekly"}]})
    got = rows_of(wid, f"master · {A} twice in one save")
    check("two rows for one id: the last row's cells over the stored row (smartCommsSet writes each whole)",
          env.get("data", {}).get("saved") == 2 and {r[4] for r in got} <= {"frequency"}, got)
    code, env, wid = write(MASTER, {"rows": [{"id": A, "sms_text": "Check — declared", "correct_audience": True}]})
    check("declared wrong with no sentence: kept here, nothing sent",
          plan(env).get("final") and env["data"]["correction"]["skipped"] ==
          [f"{A}: declared wrong with no sentence saying what — nothing was sent"], env)
    if admin2:
        code, env, wid = write(ADMIN2, {"rows": [{"id": B, "enabled": flipped(B)}]})
        got = rows_of(wid, f"another admin · {B} · the switch")
        check("another admin saves as today (role admin), no edition", env.get("status") == 200 and
              plan(env).get("final") and all(r[7] == "" for r in got), env)


def refusals():
    cases = [
        ({"rows": []}, 400, "Nothing to save."),
        ({"rows": "x"}, 400, "Nothing to save."),
        ({}, 400, "Nothing to save."),
    ]
    for payload, status, msg in cases:
        code, env, _ = write(MASTER, payload)
        check(f"refused {json.dumps(payload)[:30]}: {msg}", env == {"status": status, "message": msg}, env)
    code, env, _ = write(MASTER, {"rows": [{"id": "check_no_such_row"}, {"id": ""}, {"enabled": "yes"}]})
    check("unknown ids, all named, nothing saved",
          env.get("status") == 400 and env.get("message") ==
          "No situation has the id check_no_such_row · (blank) · (blank) — a row is editable here, never creatable. "
          "NOTHING WAS SAVED, including the other 0 row(s) in this save." and
          env.get("data") == {"saved": 0, "unknown": ["check_no_such_row", "(blank)", "(blank)"], "unaddressed": [],
                              "bad_hours": [], "bad_lines": []} and not plan(env), env)
    code, env, _ = write(MASTER, {"rows": [{"id": A, "to": "bob, extension 12"}, {"id": B, "send_at": "25:00, noon"},
                                           {"id": A, "send_at": None}, {"id": B, "enabled": "yes"},
                                           {"id": "check_gone"}]})
    msg = (f'Nobody would be reached: {A}: "bob, extension 12". `to` holds e-mail addresses and phone numbers written '
           "out — the only words allowed there are keywords this backend resolves (allstaff, housemanagers, directors)."
           " Leave it blank if the lane resolves its own audience. No situation has the id check_gone — a row is "
           f'editable here, never creatable. These hours could not be read: {B}: "25:00", "noon" · {A}: "null". Write '
           "times of day separated by commas — 09:00, 13:00, 17:00 (9am and 21h are read too). Leave it blank for a row "
           "that speaks whenever its sweep passes. NOTHING WAS SAVED, including the other 1 row(s) in this save.")
    check("every refusal of the validation at once, in smartCommsSet's order and words",
          env.get("status") == 400 and env.get("message") == msg and env.get("data", {}).get("bad_hours") ==
          [f'{B}: "25:00", "noon"', f'{A}: "null"'], env.get("message"))
    code, env, _ = write(MASTER, {"rows": [{"id": A, "to": "", "cc": "nobody"}]})
    check("a cleared `to` is allowed and `cc` is not judged", env.get("status") == 200, env)
    code, env, _ = write({"uid": HOLD["uid"], "role": "staff", "is_master": False}, {"rows": [{"id": A, "enabled": "yes"}]})
    check("a staff account no edition lists: smartCommsSet's policy sentence",
          env == {"status": 403, "message": "This action is for admin."}, env)


def no_handoffs():
    def kept(payload, label, who=MASTER):
        code, env, wid = write(who, payload)
        check(label, env.get("status") == 200 and plan(env).get("final") is True and not plan(env).get("engine"), env)
        return env, rows_of(wid, label)
    env, got = kept({"rows": [{"id": A, "from_line": "Administration"}]},
                    "a sending line the directory names (its role) is kept here")
    check("…as the from_line cell, matched by id", [(r[2], r[3], r[4]) for r in got] == [("id", A, "from_line")], got)
    code, env, _ = write(MASTER, {"rows": [{"id": A, "from_line": "Check — no such line"}]})
    check("a sending line no line of ours answers to: 400, bad_lines, nothing saved",
          env.get("status") == 400 and len((env.get("data") or {}).get("bad_lines") or []) == 1
          and "No line of ours sends from" in env.get("message", ""), env)
    kept({"rows": [{"id": A, "from_line": None}]}, "a null sending line ('null' to judge, blank to the directory) is kept")
    if D:
        code, env, wid = write(MASTER, {"rows": [{"id": D, "enabled": flipped(D)}]})
        check("an id written twice is saved here, nothing of it in app.edits",
              env.get("status") == 200 and not plan(env).get("engine") and not rows_of(wid, "twice"), env)
        with real.cursor() as c:
            c.execute("select op, spec from pg_temp.hub_book_ops_scw where write_id = %s", (wid,))
            ops = c.fetchall()
        check("…its cell queued as a `cells` book op on the id's last row",
              [(o, s.get("key"), sorted(s.get("cells") or {})) for o, s in ops] == [("cells", D, ["enabled"])], ops)
    code, env, _ = write(MASTER, {"rows": [None]})
    check("a null row: an unknown id, 400", env.get("status") == 400 and
          (env.get("data") or {}).get("unknown") == ["(blank)"], env)
    code, env, _ = write(MASTER, {"rows": [{"id": "constructor"}]})
    check("a prototype's name: an unknown id, 400", env.get("status") == 400 and
          (env.get("data") or {}).get("unknown") == ["constructor"], env)
    STALE["on"] = True
    try:
        code, env, _ = write(MASTER, {"rows": [{"id": A, "enabled": flipped(A)}]})
        check("a book newer than its copy defers, never Apps Script", code == 503 and "defer" in env, env)
    finally:
        STALE["on"] = False
    real_gate = W.gate
    W.gate = lambda reads: (_ for _ in ()).throw(W.GateHeld({"status": 409, "message": "armed by the check"}))
    try:
        code, env, _ = write(MASTER, {"rows": [{"id": A, "enabled": flipped(A)}]})
        check("the book-write gate armed: the Desk still saves, so every gate can be switched off",
              env.get("status") == 200 and plan(env).get("final") is True, env)
    finally:
        W.gate = real_gate
    code, env, _ = write(MASTER, {"rows": [{"id": A, "sms_text": "Check — wrong words", "correct_audience": "yes",
                                            "what_was_wrong": "Check — a typo"}]})
    corr = (env.get("data") or {}).get("correction") or {}
    facts["the correction's answer"] = json.dumps(corr)[:300]
    check("a declared correction is saved here with the repair lane's answer", env.get("status") == 200 and
          plan(env).get("final") is True and "discovered" in corr and "error" not in corr, env)
    code, env, _ = write(MASTER, {"rows": [{"id": A, "from_line": ""}]})
    check("clearing a sending line needs no line list: kept here when it changes, answered here when it does not",
          env.get("status") == 200 and not plan(env).get("engine"), env)


def change_of(rid, field):
    """A value of `field` that is a change on the stored row and passes the validation."""
    now = was(rid, field)
    if field == "enabled":
        return flipped(rid)
    if field == "to":
        return "housemanagers" if now.strip().lower() == "directors" else "directors"
    if field == "frequency":
        return "monthly" if now.strip() == "weekly" else "weekly"
    return f"Check — {field}"


FIELD_OF = {"words": "sms_text", "switch": "enabled", "audience": "to", "pacing": "frequency", "ai": "ai_model",
            "recording": "record_to"}


def people():
    HOLDER["id"], HOLDER["shut"] = "", HOLD["uid"]
    listed("smartComms.switch")
    code, env, _ = write(HOLD, {"rows": [{"id": A, "enabled": flipped(A)}]})
    check("listed but Smart Comms is not released to them: the policy sentence",
          env == {"status": 403, "message": "This action is for admin."}, env)
    HOLDER["id"], HOLDER["shut"] = HOLD["uid"], ""
    for fam, eid, fields, _w in SW.FAMILIES:
        field = FIELD_OF[fam]
        value = change_of(B, field)
        listed(eid, on=False)
        code, env, _ = write(HOLD, {"rows": [{"id": B, field: value}]})
        check(f"{eid} off (listed): refused", env == {"status": 403, "message": "This action is for admin."}, env)
        listed(eid)
        code, env, wid = write(HOLD, {"rows": [{"id": B, field: value}]})
        got = rows_of(wid, f"listed ({eid}) · {B} · {field}")
        check(f"{eid} on: {field} kept, final, the row names {eid}", env.get("status") == 200 and plan(env).get("final")
              and [(r[4], r[7]) for r in got] == [(field, eid)], env)
        other = next(f for f in ("ai_model", "sms_text", "record_to") if f not in fields)
        code, env, _ = write(HOLD, {"rows": [{"id": B, other: f"Check — other {fam}"}]})
        check(f"{eid} does not open {other}", env.get("status") == 403 and "Only an admin changes" in env.get("message", ""),
              env)
    listed("smartComms.words", "smartComms.switch")
    code, env, wid = write(HOLD, {"rows": [{"id": A, "sms_text": "Check — both", "enabled": flipped(A)}]})
    got = rows_of(wid, f"listed (words + switch) · {A}")
    check("two editions in one save: one record per family, each naming its edition",
          env.get("status") == 200 and sorted((r[4], r[7]) for r in got) ==
          [("enabled", "smartComms.switch"), ("sms_text", "smartComms.words")], got)
    code, env, _ = write(HOLD, {"rows": [{"id": B, "label": was(B, "label"), "note": was(B, "note"),
                                          "kind": was(B, "kind")}]})
    check("cells outside their editions sent as stored are not changes: answered 200, nothing kept",
          env.get("status") == 200 and not plan(env), env)
    code, env, _ = write(HOLD, {"rows": [{"id": G, "enabled": flipped(G)}]})
    check("a gate stays an admin's", env == {"status": 403, "message": SW.GATE_HELD}, env)
    if D:
        code, env, _ = write(HOLD, {"rows": [{"id": D, "enabled": flipped(D)}]})
        check("an id written twice is the holder's too, carried to its last row",
              env.get("status") == 200 and not plan(env).get("engine"), env)
    code, env, _ = write(HOLD, {"rows": [{"id": A, "from_line": "Administration"}]})
    check("the sending line stays an admin's",
          env.get("status") == 403 and env.get("message") == "Only an admin changes the sending line here — nothing was saved.",
          env)
    code, env, _ = write(HOLD, {"rows": [{"id": A, "sms_text": "Check — x", "correct_audience": True,
                                          "what_was_wrong": "Check — y"}]})
    check("a correction stays an admin's", env.get("status") == 403 and "a correction" in env.get("message", ""), env)
    listed("smartComms.audience")
    code, env, _ = write(HOLD, {"rows": [{"id": A, "to": "bob"}]})
    check("the validation holds for a listed person too", env.get("status") == 400 and
          env.get("message", "").startswith(f'Nobody would be reached: {A}: "bob"'), env)
    real_gate = W.gate
    W.gate = lambda reads: (_ for _ in ()).throw(Defer("armed by the check"))
    try:
        code, env, _ = write(HOLD, {"rows": [{"id": A, "to": change_of(A, "to")}]})
        check("the book-write gate armed: a listed person is told, nothing carried", env ==
              {"status": 503, "message": SW.ARMED_HELD}, env)
    finally:
        W.gate = real_gate
    HOLDER["id"] = ""


try:
    with real.transaction():
        for name, fn in (("an admin's saves", admins), ("the refusals", refusals), ("no hand-off left", no_handoffs),
                         ("the editions", people)):
            if A and B and G and holder:
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
check("the busy lock is never a 409 (the Desk reads 409 as a save that landed)",
      SW.BUSY_OF[SW.ACTION]["status"] != 409)
print(json.dumps({"checks": out, "facts": facts, "rows": rows_out}))
'''


def main() -> int:
    py_compile.compile(str(ROOT / "app" / "smart_comms_writes.py"), doraise=True)
    print("ok   app/smart_comms_writes.py compiles")
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
