#!/usr/bin/env python3
"""The Postgres edit store (app.edits) in asa-hub-db-sync, the modules streamed in: a final write kept in one request,
laid over the copy by every read, a sync reload erasing nothing, a void taking it back, main.py's contract and the
relay's final path over stand-ins. Everything lands in temp tables inside one transaction rolled back at the end;
the live schema app, the platform's write lock and the live services are never touched."""
from __future__ import annotations

import ast
import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"
RELAY_NAMES = ("BACKEND_OWN_SLACK_S", "BACKEND_FINAL_KEEP_S", "BACKEND_FINAL_UNWRITTEN", "_backend_final_covers",
               "_backend_copy_at", "_backend_written_after", "_backend_unwritten", "_backend_final_landed",
               "_backend_final", "_backend_write")

DRIVER = r'''
import asyncio, base64, hashlib, importlib.abc, importlib.util, json, logging, re, sys, time, types, urllib.parse, uuid
from typing import Any
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
# main.py's web framework stood in: its functions are called as they are
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
import gsjs, hubdb, writes as W, client_writes as CW
from gsjs import name_key

out = []


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:500]])


# ---- the stand-ins: temp tables for app.edits and the store's own tables, a lock key nobody else takes ----
W.EDITS_TABLE = "pg_temp.hub_edits_check"
W.LOCK_KEY = 0x45444954434B


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
        self.real, self.closes = real, 0

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
        self.closes += 1


class CheckDb(hubdb.HubDb):
    """asa-hub-db's reader over a throwaway copy table (pg_temp), the catalog left out."""

    def _copy_rows(self, ref):
        got = self.query(f'select row_number, _raw from pg_temp."{ref.table}" order by row_number')
        return [(int(rn), raw if isinstance(raw, dict) else json.loads(raw)) for rn, raw in got]

    def catalog(self):
        return {"at": time.time(), "tabs": {}, "books": {}}


SID = "CHECK_" + uuid.uuid4().hex[:12]
TAB, NOTES, CLIENTS, BULK = "check_tab", "check_notes", "check_clients", "check_bulk"
HEAD = ("id", "name", "phone", "state")
COPY = [(2, {"id": "C1", "name": "Ann Lee", "phone": "(330) 555-0000", "state": "open"}),
        (3, {"id": "C2", "name": "Bob Ray", "phone": "(330) 555-0001", "state": "open"}),
        (4, {"id": "C3", "name": "Cy Dow", "phone": "", "state": "resolved"})]
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="edit-store-check")
proxy = Conn(real)
db = CheckDb(connect=lambda: proxy)
store = W.Store(connect=lambda: proxy, kind="check", label="Check")
facts = {}


def load(table, rows):
    """A sync pass: the copy table emptied and written again from the sheet."""
    with real.cursor() as c:
        c.execute(f"create temp table if not exists {table} (row_number int, _raw jsonb)")
        c.execute(f"delete from {table}")
        for rn, raw in rows:
            c.execute(f"insert into {table} (row_number, _raw) values (%s, %s::jsonb)", (rn, json.dumps(raw)))


def ref_of(tab, table, head, loaded, n):
    return hubdb.TabRef(SID, tab, table, tuple(head), loaded, n)


def record(wid, decision, action="checkEdit"):
    with store.locked() as tx:
        env = W.envelope(decision, wid, {"display_name": "Edit Check"})
        tx.record(wid, action, env, decision, "Edit Check")
    return env


def edit(key, cells, before=None, tab=TAB, match="id", kind="edit", **extra):
    return {"sheet_id": SID, "tab_name": tab, "kind": kind, "match": match, "keyed": "header", "row_key": key,
            "house": key, "cells": cells, "before": before or {}, **extra}


def read(tab=TAB, table="check_copy", head=HEAD, loaded="t1", n=3, pending=()):
    own = CW.Own(list(pending), edits=store.edits(), edits_at=time.time())
    tok = hubdb.OWN.set(own)
    try:
        rows = db.locations_rows(ref_of(tab, table, head, loaded, n))
    finally:
        hubdb.OWN.reset(tok)
    return {r.get("id") or r.get("name"): r for r in rows}, own


def count(sql, params=()):
    with real.cursor() as c:
        c.execute(rw(sql), params)
        return c.fetchone()[0]


try:
    with real.transaction():
        # ---- 1. the table, made by the store's own ensure ----
        why = store.ensure()
        cols = []
        with real.cursor() as c:
            c.execute("select column_name from information_schema.columns where table_name = 'hub_edits_check'"
                      " order by ordinal_position")
            cols = [r[0] for r in c.fetchall()]
        check("Store.ensure makes the edit table beside the store's own (additive, if not exists)",
              why == "" and store.ready() and cols == ["id", "write_id", "app", "action", "sheet_id", "tab_name", "kind",
                                                       "match_by", "keyed_by", "row_key", "field", "value", "before",
                                                       "author", "edition", "at"], [why, cols])
        facts["columns"] = ", ".join(cols)
        load("check_copy", COPY)

        # ---- 2. final writes kept in one locked transaction, receipt and cells together ----
        e1 = record("Wcheck-e1-0001", W.Decision({"status": 200, "data": {"written": ["phone"]}},
                    edits=[edit("C1", {"phone": "(330) 555-0101"}, {"phone": "(330) 555-0000"})],
                    edition="check.edition", subject="C1"))
        record("Wcheck-e2-0001", W.Decision({"status": 200}, edits=[edit("C2", {"name": "Bob Ray Jr"})]))
        record("Wcheck-e3-0001", W.Decision({"status": 200}, edits=[edit("C2", {"name": "Robert Ray"})]))
        record("Wcheck-e4-0001", W.Decision({"status": 200}, edits=[edit(
            "C9", {"id": "C9", "name": "New Person", "phone": "(330) 555-0109", "state": "open"}, kind="append")]))
        record("Wcheck-e5-0001", W.Decision({"status": 200}, edits=[edit("C9", {"state": "resolved"})]))
        check("the answer carries the relay's final plan: kept, its subject, its cells — no lay, no engine",
              e1.get("_write") == {"write_id": "Wcheck-e1-0001", "engine": False, "final": True, "house": "C1", "cells": 1},
              e1.get("_write"))
        with real.cursor() as c:
            c.execute(rw("select app, action, kind, match_by, row_key, field, value, before, author, edition"
                         " from pg_temp.hub_edits_check where write_id = %s"), ("Wcheck-e1-0001",))
            row = c.fetchone()
        check("one row per cell: the app, the action, the row key, the header, the value, what it was, who, the edition",
              row == ("check", "checkEdit", "edit", "id", "C1", "phone", "(330) 555-0101", "(330) 555-0000",
                      "Edit Check", "check.edition"), row)
        check("the receipt is kept with the cells, once",
              count("select count(*) from pg_temp.check_receipts where write_id = %s", ("Wcheck-e1-0001",)) == 1)
        bad = None
        try:
            record("Wcheck-bad-001", W.Decision({"status": 200}, edits=[
                edit("C1", {"phone": "1"}), edit("r3", {"phone": "2"}, match="row")]))
        except W.NotKept as exc:
            bad = str(exc)
        check("an edit naming its row by sheet row number is refused (NotKept), and nothing of the write is kept",
              bad is not None
              and count("select count(*) from pg_temp.check_receipts where write_id = %s", ("Wcheck-bad-001",)) == 0
              and count("select count(*) from pg_temp.hub_edits_check where write_id = %s", ("Wcheck-bad-001",)) == 0,
              bad)

        # ---- 3. read back, laid over the copy ----
        with store.locked() as tx:
            under_lock = tx.edits()
        check("the edits read under the lock are the edits read outside it", under_lock == store.edits())
        rows, own = read()
        check("every read lays the newest value of each (row, field) over the copy",
              rows["C1"]["phone"] == "(330) 555-0101" and rows["C2"]["name"] == "Robert Ray"
              and rows["C3"] == {"_row": 4, "id": "C3", "name": "Cy Dow", "phone": "", "state": "resolved"},
              rows)
        check("an appended row is laid as a row, its later edit over it",
              rows.get("C9", {}).get("state") == "resolved" and rows["C9"]["phone"] == "(330) 555-0109"
              and len(rows) == 4, rows.get("C9"))
        check("a kept edit is never named as a pending write nor retired", not own.held and not own.done,
              [own.held, own.done])

        # ---- 4. the sync reloads the copy ----
        load("check_copy", COPY)
        rows, own = read(loaded="t2")
        check("a reload of the sheet (copy unchanged) erases nothing: the edits are still laid",
              rows["C1"]["phone"] == "(330) 555-0101" and rows["C2"]["name"] == "Robert Ray"
              and rows["C9"]["state"] == "resolved", rows)
        confirmed = [(2, {**COPY[0][1], "phone": "(330) 555-0101", "state": "resolved"})] + COPY[1:]
        load("check_copy", confirmed)
        rows, own = read(loaded="t3")
        check("the copy holding the same value retires nothing; a field nobody edited shows the copy's change",
              rows["C1"]["phone"] == "(330) 555-0101" and rows["C1"]["state"] == "resolved" and not own.done, rows["C1"])
        load("check_copy", [(2, {**COPY[0][1], "phone": "(330) 555-0999"})] + COPY[1:])
        rows, _own = read(loaded="t4")
        check("a different value on the sheet does not win: Postgres holds the truth",
              rows["C1"]["phone"] == "(330) 555-0101", rows["C1"])
        pend = {"write_id": "Wpend-0001", "sheet_id": SID, "tab_name": TAB, "kind": "edit", "match": "id",
                "keyed": "header", "row_key": "C1", "cells": {"phone": "(330) 555-7777"}, "state": "accepted",
                "accepted_at": time.time(), "written_at": 0.0}
        rows, own = read(loaded="t4", pending=[pend])
        check("a pending ledger write on the same cell is laid under the kept edit",
              rows["C1"]["phone"] == "(330) 555-0101" and "Wpend-0001" in own.held, rows["C1"])

        # ---- 5. a tab no sheet holds, made by an appended row ----
        record("Wcheck-n1-0001", W.Decision({"status": 200}, edits=[edit(
            "N_1", {"id": "N_1", "body": "First note", "by": "Edit Check"}, tab=NOTES, kind="append")]))
        own = CW.Own([], edits=store.edits(), edits_at=time.time())
        vref = own.virtual(SID, NOTES)
        tok = hubdb.OWN.set(own)
        try:
            notes = db.sheetdb_rows(vref) if vref is not None else []
        finally:
            hubdb.OWN.reset(tok)
        check("a tab only Postgres holds reads back: its headers as first written, its row laid",
              vref is not None and vref.headers == ("id", "body", "by") and vref.row_count == -1
              and notes == [{"id": "N_1", "body": "First note", "by": "Edit Check"}], [vref, notes])

        # ---- 6. Clients' matchers find a client's row for a kept edit too ----
        load("check_clients_copy", [(2, {"client_key": "", "name": "Dee Fox", "guardian_phone": "(330) 555-0300"})])
        record("Wcheck-c1-0001", W.Decision({"status": 200}, edits=[edit(
            name_key("Dee Fox"), {"guardian_phone": "(330) 555-0301"}, tab=CLIENTS, match="client")]))
        crow, _own = read(tab=CLIENTS, table="check_clients_copy", head=("client_key", "name", "guardian_phone"), n=1)
        check("a client's row found by its key (or its name's key) carries the kept edit",
              crow.get("Dee Fox", {}).get("guardian_phone") == "(330) 555-0301", crow)

        # ---- 7. a void takes a final write back whole ----
        voided = store.settle("Wcheck-e3-0001", "void")
        rows, _own = read(loaded="t5")
        check("a void deletes the write's cells and receipt; the cell falls back to the edit before it",
              voided and count("select count(*) from pg_temp.hub_edits_check where write_id = %s", ("Wcheck-e3-0001",)) == 0
              and count("select count(*) from pg_temp.check_receipts where write_id = %s", ("Wcheck-e3-0001",)) == 0
              and rows["C2"]["name"] == "Bob Ray Jr", rows["C2"])

        # ---- 8. many appended rows stay quick ----
        with real.cursor() as c:
            c.executemany(rw("insert into pg_temp.hub_edits_check (write_id, app, sheet_id, tab_name, kind, match_by,"
                             " keyed_by, row_key, field, value) values (%s, 'check', %s, %s, 'append', 'id', 'header',"
                             " %s, %s, %s)"),
                          [(f"Wbulk-{i:05d}", SID, BULK, f"B_{i}", f, v) for i in range(3000)
                           for f, v in (("id", f"B_{i}"), ("body", f"note {i}"))])
        load("check_bulk_copy", [(n + 2, {"id": f"X_{n}", "body": "copy"}) for n in range(300)])
        t0 = time.monotonic()
        brows, _own = read(tab=BULK, table="check_bulk_copy", head=("id", "body"), n=300)
        spent = time.monotonic() - t0
        facts["3000 appended rows over a 300-row copy, read and laid"] = f"{spent:.2f}s"
        check("3000 appended rows over a 300-row copy are read and laid in well under a second",
              len(brows) == 3300 and spent < 1.0, [len(brows), spent])

        # ---- 9. main.py: the decision recorded in the same request, answered final ----
        import main as M
        held = (M.DB, M.SSA_STORE, M.WRITES)
        try:
            M.DB, M.SSA_STORE = db, store
            door = types.SimpleNamespace(POLICY={}, BUSY_OF={}, ACTIONS={
                "checkFinal": lambda sess, p: W.Decision({"status": 200, "data": {"written": ["phone"]}},
                                                         edits=[edit("C3", {"phone": "(330) 555-0303"})], subject="C3"),
                "checkBad": lambda sess, p: W.Decision({"status": 200}, edits=[edit("r4", {"phone": "x"}, match="row")])})
            M.WRITES = {**M.WRITES, "ssa": door}
            svc = {"is_service": True}
            res = M._run_write(door, "checkFinal", svc, {}, "Wmain-final-0001")
            env = json.loads(res.body)
            n_cells = count("select count(*) from pg_temp.hub_edits_check where write_id = %s", ("Wmain-final-0001",))
            check("main.py: a door's edits kept in the request, the answer final, the edits' moment told to the relay",
                  res.status_code == 200 and env.get("status") == 200 and (env.get("_write") or {}).get("final") is True
                  and n_cells == 1 and float(res.headers.get("X-Hub-Edits-At") or 0) > 0, [env, res.headers, n_cells])
            again = json.loads(M._run_write(door, "checkFinal", svc, {}, "Wmain-final-0001").body)
            check("main.py: the same write id again is the receipt, a replay, nothing kept twice",
                  (again.get("_write") or {}).get("replay") is True
                  and count("select count(*) from pg_temp.hub_edits_check where write_id = %s", ("Wmain-final-0001",)) == 1)
            res = M._run_write(door, "checkBad", svc, {}, "Wmain-bad-00001")
            env = json.loads(res.body)
            check("main.py: edits that cannot be kept answer 503 in Python's words, nothing half-written",
                  res.status_code == 200 and env == {"status": 503, "message": W.NOT_KEPT}
                  and count("select count(*) from pg_temp.check_receipts where write_id = %s", ("Wmain-bad-00001",)) == 0,
                  env)
            reader = types.SimpleNamespace(POLICY={}, ACTIONS={"checkRead": lambda sess, p: {
                "status": 200, "data": {"rows": sess.reads.db.locations_rows(ref_of(TAB, "check_copy", HEAD, "t6", 3))}}})
            res = M._run(reader, "checkRead", svc, {})
            got = {r["id"]: r for r in json.loads(res.body)["data"]["rows"]}
            check("main.py: Python's next read lays the kept edit, and says when it read the edits",
                  got["C3"]["phone"] == "(330) 555-0303" and got["C1"]["phone"] == "(330) 555-0101"
                  and float(res.headers.get("X-Hub-Edits-At") or 0) > 0, [got.get("C3"), res.headers])

            def down():
                raise RuntimeError("down")
            M.SSA_STORE = W.Store(connect=down, kind="check")
            res = M._run(reader, "checkRead", svc, {})
            check("main.py: the edit store configured but not answering, a read defers rather than answer without them",
                  res.status_code == 503 and "edit store" in json.loads(res.body).get("defer", ""), res.body)
        finally:
            M.DB, M.SSA_STORE, M.WRITES = held
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass


# ---- 10. the relay's final path, its functions over stand-ins ----
class Response:
    def __init__(self, content, media_type=""):
        self.body, self.status = content, json.loads(content).get("status")


ns = {"__name__": "relay_check", "time": time, "json": json, "re": re, "hashlib": hashlib, "urllib": urllib,
      "asyncio": asyncio, "Any": Any, "log": logging.getLogger("relay-check"), "Response": Response,
      "_app_pack_touched": {}, "_app_pack_void": {}, "_app_pack_swept": {}, "_backend_own": {}, "_backend_final_at": {},
      "BACKEND_APPS": {"ssa": {"pack": "ssa-pack", "key": "ssa", "keys": (), "writes": frozenset({"checkFinal",
                                                                                                "checkOld"}),
                               "final": frozenset({"checkFinal"})}},
      "_BACKEND_WRITES": {"checkFinal": "ssa", "checkOld": "ssa"}, "_BACKEND_FINAL": frozenset({"checkFinal"}),
      "EXEC_URL": "https://stub.invalid/exec", "_APP_PACK_HOUSE_RE": r"^[A-Z]{2,4}\d{3,6}$"}
exec(compile("from __future__ import annotations\n" + blob["relay"], "relay_check", "exec"), ns)
said = {"call": None, "settled": [], "void_ok": True, "master": True, "settling": False, "landed": []}


async def yes(_a):
    return True


async def actor(_a):
    return ("staff", "u-check")


async def master(_a):
    return (said["master"], False)


async def call(app_id, action, payload, user, extra=None, timeout=None):
    said["extra"] = dict(extra or {})
    got = said["call"]
    if got is None:
        return None
    env = json.loads(json.dumps(got))
    return json.dumps(env).encode(), time.time() - 600, env, frozenset(), time.time()


async def settle(app_id, wid, state, why="", fields=None):
    said["settled"].append((wid, state))
    return said["void_ok"]


def note_write(name, body, env):
    key = (body.get("payload") or {}).get("ssa") or ""
    ns["_app_pack_touched"][("ssa-pack", key)] = time.time()
    ns["_app_pack_touched"][("client-pack", "k1")] = time.time()


ns.update({"_backend_wanted": yes, "_session_actor": actor, "_app_pack_master": master, "_backend_call": call,
           "_backend_settle": settle, "_relay_is_service": lambda raw: False,
           "_backend_settling": lambda: said["settling"],
           "_backend_people_extra": lambda: {"people_at": 1.0} if said["settling"] else {},
           "_BACKEND_UNANSWERED": __import__("contextvars").ContextVar("backend_unanswered", default=""),
           "_relay_envelope": lambda raw: json.loads(urllib.parse.parse_qs(raw.decode())["body"][0]),
           "_backend_key": lambda app_id, p: str(p.get("ssa") or ""),
           "_backend_settle_soon": lambda app_id, wid, state, why="", fields=None, house="": said["settled"].append(
               (wid, state)),
           "_traffic_note": lambda *a, **k: None, "_backend_own_mark": lambda *a, **k: None,
           "_viewer_cache_written": lambda *a, **k: said["landed"].append("viewer"),
           "_app_pack_apps_of": lambda action, raw: {"ssa-pack"},
           "_app_pack_ring": lambda app, **k: said["landed"].append("ring:" + app),
           "_app_pack_write_of": lambda action, raw: (action, ns["_relay_envelope"](raw)),
           "_app_pack_note_write": note_write, "_staff_profiles_rang": lambda *a: None})


async def edit_overlay_python(*a, **k):
    said["landed"].append("overlay")
    return None
ns["_edit_overlay_python"] = edit_overlay_python


def raw_of(action, payload, wid):
    return urllib.parse.urlencode({"body": json.dumps({"action": action, "token": "tok", "payload": payload,
                                                       "write_id": wid})}).encode()


def run(action, payload, wid):
    said["settled"].clear()
    said["landed"].clear()
    return asyncio.run(ns["_backend_write"](action, raw_of(action, payload, wid)))


final_plan = {"status": 200, "data": {"written": ["phone"]},
              "_write": {"write_id": "Wr1", "engine": False, "final": True, "house": "s1", "cells": 1}}
said["call"] = final_plan
res, _raw, settle_of = run("checkFinal", {"ssa": "s1"}, "Wrelay-final-01")
check("relay: a final write is answered by Python's own words — no Apps Script, no ledger, no overlay",
      res is not None and res.status == 200 and "_write" not in json.loads(res.body) and settle_of is None
      and "overlay" not in said["landed"] and not said["settled"], [getattr(res, "body", None), said])
check("relay: the subject's packs and kept copies read again, the screens rung",
      "viewer" in said["landed"] and "ring:ssa-pack" in said["landed"]
      and ("ssa-pack", "s1") in ns["_backend_final_at"] and ("client-pack", "k1") in ns["_backend_final_at"],
      [said["landed"], ns["_backend_final_at"]])
old = time.time() - 600
check("relay: Python's next read of the subject holds the final write, however old its copy (and its pack)",
      ns["_backend_copy_at"]("ssa", "s1", old, None, edits_at=time.time()) is not None
      and ns["_backend_copy_at"]("ssa", "", old, None, any_key=True, edits_at=time.time()) is not None
      and ns["_backend_copy_at"]("ssa", "s1", old, None, edits_at=time.time()) > old)
check("relay: a read whose edits were read before the final write is not taken for it",
      ns["_backend_copy_at"]("ssa", "s1", old, None, edits_at=old) is None
      and ns["_backend_copy_at"]("ssa", "s1", old, None) is None)
ns["_app_pack_touched"][("ssa-pack", "s1")] = time.time() + 60
check("relay: another write landing on the subject after it sends the read back to the copy's age (not covered)",
      ns["_backend_copy_at"]("ssa", "s1", old, None, edits_at=time.time() + 120) is None)
ns["_app_pack_touched"][("ssa-pack", "s1")] = time.time()
said["call"] = None
res, _raw, _s = run("checkFinal", {"ssa": "s1"}, "Wrelay-final-02")
check("relay: Python not answering a final write: 503, nothing written, the id voided — never Apps Script",
      res is not None and res.status == 503 and ("Wrelay-final-02", "void") in said["settled"], said)
res, _raw, _s = run("checkOld", {"ssa": "s1"}, "Wrelay-old-0001")
check("relay: a write not declared final that Python defers: 503, nothing written, the id voided — never Apps Script",
      res is not None and res.status == 503 and ("Wrelay-old-0001", "void") in said["settled"], said)
ns["_BACKEND_UNANSWERED"].set("ConnectError")
res, _raw, _s = run("checkOld", {"ssa": "s1"}, "Wrelay-old-0002")
check("relay: …but Python not had (the line dropped): 503, nothing written, the id voided — never Apps Script",
      res is not None and res.status == 503 and ("Wrelay-old-0002", "void") in said["settled"], said)
ns["_BACKEND_UNANSWERED"].set("")
said["call"] = {"status": 200, "_write": {"write_id": "Wr3", "engine": True, "settle": True, "house": "s1"}}
res, _raw, settle_of = run("checkFinal", {"ssa": "s1"}, "Wrelay-final-03")
check("relay: a final door answering a sheet write is never carried: 503, voided",
      res is not None and res.status == 503 and settle_of is None and ("Wrelay-final-03", "void") in said["settled"])
said.update(call={"status": 503, "message": "This change could not be saved just now, and nothing was written."},
            settling=True, master=False)
res, _raw, _s = run("checkFinal", {"ssa": "s1"}, "Wrelay-final-04")
check("relay: while App Control settles, a final write is asked of Python with the change's moment, and Python's "
      "503 (decided on an older copy, nothing kept) is the answer — never Apps Script",
      res is not None and res.status == 503 and said["extra"].get("people_at") == 1.0 and not said["settled"],
      [getattr(res, "body", None), said])
said.update(call=final_plan)
res, _raw, _s = run("checkFinal", {"ssa": "s1"}, "Wrelay-final-04b")
check("relay: …and a copy that holds the change decides it as ever", res is not None and res.status == 200)
said["master"] = True
res, _raw, _s = run("checkFinal", {"ssa": "s1"}, "Wrelay-final-05")
check("relay: the master's final write is decided meanwhile, on the copy as it stands",
      res is not None and res.status == 200 and "people_at" not in said["extra"])
said.update(settling=False)
ns["_backend_final_at"].clear()
ns["_app_pack_touched"][("ssa-pack", "s2")] = time.time()
res, _raw, _s = run("checkFinal", {"ssa": "s2"}, "Wrelay-final-06")
check("relay: decided on a copy older than a write the relay saw: taken back (void) and answered 409",
      res is not None and res.status == 409 and ("Wrelay-final-06", "void") in said["settled"], said)
said["void_ok"] = False
ns["_app_pack_touched"][("ssa-pack", "s2")] = time.time()
ns["_backend_final_at"].clear()
res, _raw, _s = run("checkFinal", {"ssa": "s2"}, "Wrelay-final-07")
check("relay: the take-back not confirmed, what Postgres holds is what is answered",
      res is not None and res.status == 200, getattr(res, "body", None))
said.update(void_ok=True, call={**final_plan, "_write": {**final_plan["_write"], "replay": True}})
res, _raw, _s = run("checkFinal", {"ssa": "s1"}, "Wrelay-final-08")
check("relay: a replay is answered from its receipt, nothing read again",
      res is not None and res.status == 200 and not said["landed"], said["landed"])
said["call"] = {"status": 403, "message": "Not yours."}
res, _raw, _s = run("checkFinal", {"ssa": "s3"}, "Wrelay-final-09")
check("relay: a final door's refusal is its own words", res is not None and res.status == 403)
print(json.dumps({"checks": out, "facts": facts}))
'''


def relay_source() -> str:
    """The relay's final-path functions and constants, cut from its source as written."""
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    tree = ast.parse(text)
    found: dict[str, str] = {}
    for node in tree.body:
        name = getattr(node, "name", None)
        if name is None and isinstance(node, (ast.Assign, ast.AnnAssign)):
            target = node.targets[0] if isinstance(node, ast.Assign) else node.target
            name = getattr(target, "id", None)
        if name in RELAY_NAMES:
            found[name] = ast.get_source_segment(text, node) or ""
    missing = [n for n in RELAY_NAMES if not found.get(n)]
    if missing:
        raise SystemExit(f"the relay source lacks {missing}")
    return "\n\n".join(found[n] for n in RELAY_NAMES)


def main() -> int:
    blob = {"app": {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")},
            "relay": relay_source()}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=600)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print(got.stderr.decode()[-3000:])
        return 1
    res = json.loads(lines[-1])
    failed = 0
    for name, ok, detail in res["checks"]:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        if not ok:
            failed += 1
            print(f"       {detail}")
    for k, v in res["facts"].items():
        print(f"  fact {k}: {v}")
    print(f"{len(res['checks']) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
