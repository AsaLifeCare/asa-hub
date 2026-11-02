#!/usr/bin/env python3
"""Locations and Clients kept in Postgres: the relay names the converted doors final and leaves the others on Apps
Script, and every converted door is decided by the streamed modules on real subjects in asa-hub-db-sync — the master's
change kept in app.edits under a lasting row key (an id, a house code, a client's row id, the cells no edit writes),
read back by the next Python read and still read back after a reload of the copy; a stale witness, a gate and an
edition refuse as before; the doors left on Apps Script still hand it on. Nothing real is written: the edit store lives
in temp tables inside one transaction rolled back at the end. Prints shapes, counts and timings only."""
from __future__ import annotations

import ast
import base64
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"
FINAL = {"locations": {"locationNoteAdd", "locationNoteState", "locationSupplyEntry", "locationHouseSave",
                       "locationNoteEdit", "locationSupplyEdit", "locationStaffRemove", "locationRepairEdit",
                       "locationClientsAdd"},
         "clients": {"clientProfileSave", "clientProfileOverride", "clientCreate"}}
LEFT = {"locations": {"locationIncidentFile", "locationIncidentEdit", "locationRepairFile"},
        "clients": {"clientProfileRename", "clientProfileStatus", "emarMedUpdate", "emarMedDelete",
                    "clientUserCreate"}}

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


# ---- 1. what the relay says --------------------------------------------------------------------------------------------

def strings(node: ast.AST) -> set[str]:
    return {n.value for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)}


def relay() -> None:
    print("the relay's sets")
    tree = ast.parse((ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8"))
    table = next((n.value for n in tree.body if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)
                  and n.target.id == "BACKEND_APPS"), None)
    check("BACKEND_APPS is in the relay", isinstance(table, ast.Dict))
    if not isinstance(table, ast.Dict):
        return
    for k, v in zip(table.keys, table.values):
        app = k.value if isinstance(k, ast.Constant) else ""
        if app not in FINAL or not isinstance(v, ast.Dict):
            continue
        spec = {kk.value: vv for kk, vv in zip(v.keys, v.values) if isinstance(kk, ast.Constant)}
        final, writes = strings(spec.get("final", ast.Constant(""))), strings(spec.get("writes", ast.Constant("")))
        check(f"{app}: the final set is the converted doors, every one a write Python decides",
              final == FINAL[app] and final <= writes, sorted(final ^ FINAL[app]))
        check(f"{app}: the doors left on Apps Script stay writes Python decides, never final",
              LEFT[app] <= writes and not (LEFT[app] & final), sorted(LEFT[app] & final))


# ---- 2. the doors on real subjects, in asa-hub-db-sync ------------------------------------------------------------------

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, re, resource, sys, time, types, uuid
from datetime import timedelta
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

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_check"
W.LOCK_KEY = 0x4C4346494E4C


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


# the live copies on their own read-only connection; the edit store on a transaction rolled back at the end
db = hubdb.HubDb()
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="loc-clients-final-check")
proxy = Conn(real)
store = W.Store(connect=lambda: proxy, kind="check", label="Check")
EDITIONS = {"value": "[]"}
base_cfg = db.hiring_config
db.hiring_config = lambda: {**base_cfg(), sc.EDITIONS_KEY: EDITIONS["value"]}
# the copy taken as current: a verdict resting on rows is answered, never deferred for a book Drive moved meanwhile
db.stale = lambda books: False
base_catalog = db.catalog
BUMP = {"n": 0, "held": None}


def catalog():
    cat = base_catalog()
    if not BUMP["n"]:
        return cat
    if BUMP["held"] is None or BUMP["held"][0] != BUMP["n"] or BUMP["held"][1] is not cat:
        def later(v):
            return v + timedelta(minutes=BUMP["n"]) if hasattr(v, "year") else f"{v}+{BUMP['n']}"
        BUMP["held"] = (BUMP["n"], cat, {**cat, "tabs": {k: r._replace(loaded_at=later(r.loaded_at))
                                                         for k, r in cat["tabs"].items()}})
    return BUMP["held"][2]


db.catalog = catalog


def reload():
    """A sync pass: every tab read again from its table under a newer load stamp; the sheet itself unchanged."""
    BUMP["n"] += 1
    with db._lock:
        db._rows.clear()


HOLDER = {"id": ""}
base_gate = sc.profile_app_gate


def gate(app_id, user, src):
    if user and HOLDER["id"] and gsjs.str_(user.get("id")) == HOLDER["id"] and not user.get("is_service"):
        return {"open": True, "scope": sc.scope_of("all")}
    return base_gate(app_id, user, src)


sc.profile_app_gate = gate
M.DB = db
M.STORE = M.CLIENT_STORE = store
M.STAFF_STORE = M.SSA_STORE = M.FAMILY_STORE = W.Store(dsn="")
M.WRITE_BUDGET_S = 120.0
spent = {}
seq = [0]


def write(module, action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-lc-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    t0 = time.monotonic()
    res = M._run_write(module, action, who, payload, wid)
    spent[action] = max(spent.get(action, 0.0), time.monotonic() - t0)
    return res.status_code, json.loads(res.body), wid


def kept(wid):
    """(tab, kind, match, keyed, row_key, field, value, edition) per cell, as app.edits holds them; never printed."""
    with real.cursor() as c:
        c.execute("select tab_name, kind, match_by, keyed_by, row_key, field, value, edition"
                  " from pg_temp.hub_edits_check where write_id = %s order by id", (wid,))
        return c.fetchall()


def read(app_id, action, who, payload):
    res = M._run(M.APPS[app_id], action, who, payload)
    return res.status_code, json.loads(res.body)


def laid(fn):
    own = CW.Own([], book=db.book, edits=store.edits(), edits_at=time.time())
    tok = hubdb.OWN.set(own)
    try:
        return fn(L.Reads(db, None))
    finally:
        hubdb.OWN.reset(tok)


def final_of(env):
    return (env.get("_write") or {}).get("final") is True


def pg(env):
    return (((env.get("data") or {}).get("steps") or [{}])[0]).get("id") == "postgres"


def safe(code, env):
    """What a failure may print: the status, the data's keys, how many fields were refused — no value, no name."""
    d = env.get("data") if isinstance(env.get("data"), dict) else {}
    return {"http": code, "status": env.get("status"), "defer": "defer" in env, "keys": sorted(d),
            "written": d.get("written"), "refused": len(d.get("refused") or []), "plan": sorted(env.get("_write") or {})}


def unknown(code, env):
    return code == 200 and env == {"status": 404, "message": "Unknown action."}


def guarded(name, fn):
    try:
        with real.transaction():
            fn()
    except Exception as exc:  # noqa: BLE001 - said as a failed check, never a value
        check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:200])


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
    check("the edit store is made in temp tables (the store's own ensure, a lock key nobody else takes)",
          store.ready(), store.why)
SUBJECT = {}


def the_house():
    reads = L.Reads(db, None)
    for h in reads.homes():
        ctx = L.house(reads, h["code"])
        if ctx.get("refused") or not ctx.get("home") or not ctx.get("clients"):
            continue
        idx = L.addr_index(ctx["homes"], ctx["all_clients"])
        if not L.repairs_for(reads.estate("workOrders"), ctx["code"], idx):
            continue
        return ctx
    return None


def notes_doors():
    ctx = SUBJECT["house"]
    P = {"house": ctx["code"]}
    ck = ctx["clients"][0]["client_key"]
    code, env, wid = write(W, "locationNoteAdd", MASTER, {**P, "details": "Final check note", "priority": "high",
                                                          "client_key": ck})
    rows = kept(wid)
    nid = ((env.get("data") or {}).get("note") or {}).get("id", "")
    check("locationNoteAdd: the master's note kept final — one appended house_notes row under its minted HN_ id",
          env.get("status") == 200 and final_of(env) and pg(env) and re.fullmatch(r"HN_[0-9a-f-]{36}", nid or "")
          and {r[0] for r in rows} == {L.NOTES_TAB} and {r[1:4] for r in rows} == {("append", "id", "header")}
          and {r[4] for r in rows} == {nid} and set(W.NOTES_HEADER) == {r[5] for r in rows}
          and {r[7] for r in rows} == {""}, safe(code, env))

    def shown():
        code_, got = read("locations", "locationNotes", MASTER, P)
        return next((n for n in (got.get("data") or {}).get("notes") or [] if n.get("id") == nid), None)
    n = shown()
    check("locationNoteAdd: the next read shows the note, its client named", bool(n) and n["details"] == "Final check note"
          and n["priority"] == "high" and n["client_key"] == ck and bool(n["client_name"]))
    reload()
    n = shown()
    check("locationNoteAdd: after a reload of the copy (the sheet unchanged) the note is still read",
          bool(n) and n["details"] == "Final check note")
    code, env, wid = write(W, "locationNoteAdd", MASTER, {**P, "details": "  "})
    check("locationNoteAdd: no details is the 400 it was; nothing kept", env.get("status") == 400 and not kept(wid)
          and not final_of(env), safe(code, env))
    EDITIONS["value"] = "[]"
    code, env, wid = write(W, "locationNoteAdd", HOLD, {**P, "details": "Holder note"})
    check("locationNoteAdd: an employee no edition lists is told it is no door; nothing kept",
          unknown(code, env) and not kept(wid), safe(code, env))
    EDITIONS["value"] = json.dumps([{"id": "locations.house", "on": True, "people": [HOLDER["id"]]}])
    code, env, wid = write(W, "locationNoteAdd", HOLD, {**P, "details": "Holder note"})
    rows = kept(wid)
    check("locationNoteAdd: a holder of locations.house files it, kept under that edition",
          env.get("status") == 200 and final_of(env) and rows and {r[7] for r in rows} == {"locations.house"},
          safe(code, env))
    EDITIONS["value"] = "[]"

    code, env, wid = write(W, "locationNoteState", MASTER, {**P, "id": nid, "state": "resolved"})
    rows = kept(wid)
    check("locationNoteState: a note kept only in Postgres is found and resolved — three cells under its id",
          env.get("status") == 200 and final_of(env) and {r[1:5] for r in rows} == {("edit", "id", "header", nid)}
          and {r[5] for r in rows} == {"state", "state_by", "state_at"}, safe(code, env))
    n = shown()
    check("locationNoteState: the next read shows it resolved", bool(n) and n["state"] == "resolved")
    code, env, wid = write(W, "locationNoteState", MASTER, {"house": "QQ9", "id": nid, "state": "open"})
    check("locationNoteState: a house witness the note does not carry is the 409 it was; nothing kept",
          env.get("status") == 409 and not kept(wid), safe(code, env))

    code, env, wid = write(W, "locationNoteEdit", MASTER, {**P, "id": nid, "changes": [
        {"field": "details", "value": "Final check note, edited", "expected": "Final check note"},
        {"field": "by", "value": "x", "expected": ""}]})
    rows = kept(wid)
    check("locationNoteEdit: the details kept final under the note's id; a field that is not a note's refused",
          env.get("status") == 200 and final_of(env) and env["data"]["written"] == ["details"]
          and len(env["data"]["refused"]) == 1 and {r[1:6] for r in rows} == {("edit", "id", "header", nid, "details")},
          safe(code, env))
    reload()
    n = shown()
    check("locationNoteEdit: read back after a reload", bool(n) and n["details"] == "Final check note, edited")
    code, env, wid = write(W, "locationNoteEdit", MASTER, {**P, "id": nid, "changes": [
        {"field": "details", "value": "Again", "expected": "Final check note"}]})
    check("locationNoteEdit: a stale witness is the 409 carrying what Postgres holds now; nothing kept",
          env.get("status") == 409 and ((env.get("data") or {}).get("current") or {}).get("details")
          == "Final check note, edited" and not kept(wid) and not final_of(env), safe(code, env))


def supply_doors():
    ctx = SUBJECT["house"]
    P = {"house": ctx["code"]}
    code, env, wid = write(W, "locationSupplyEntry", MASTER, {**P, "item": "Final check gloves", "kind": "count",
                                                              "qty": 3, "category": "PPE"})
    if env.get("status") == 503:
        check("locationSupplyEntry: the supplies house is declared (else its 503, as Apps Script says)", False,
              safe(code, env))
        return
    rows = kept(wid)
    eid = ((env.get("data") or {}).get("entry") or {}).get("id", "")
    check("locationSupplyEntry: the line kept final — one appended row under its minted LS_ id",
          env.get("status") == 200 and final_of(env) and pg(env) and re.fullmatch(r"LS_[0-9a-f-]{36}", eid or "")
          and {r[1:5] for r in rows} == {("append", "id", "header", eid)}
          and set(W.SUPPLY_HEADER) == {r[5] for r in rows}, safe(code, env))

    def entry():
        code_, got = read("locations", "locationSupplies", MASTER, P)
        for it in (got.get("data") or {}).get("consumables") or []:
            for e in it.get("entries") or []:
                if e.get("id") == eid:
                    return e
        return None
    e = entry()
    check("locationSupplyEntry: the next read shows the line on the house's supplies", bool(e) and e.get("qty") == 3)
    code, env, wid = write(W, "locationSupplyEdit", MASTER, {**P, "id": eid, "changes": [
        {"field": "qty", "value": "5", "expected": "3"}, {"field": "item", "value": "x", "expected": ""}]})
    rows = kept(wid)
    check("locationSupplyEdit: the quantity kept final under the line's id; the item stays as recorded",
          env.get("status") == 200 and final_of(env) and env["data"]["written"] == ["qty"]
          and {r[1:6] for r in rows} == {("edit", "id", "header", eid, "qty")} and rows[0][6] == "5", safe(code, env))
    reload()
    e = entry()
    check("locationSupplyEdit: read back after a reload", bool(e) and e.get("qty") == 5)
    code, env, wid = write(W, "locationSupplyEdit", MASTER, {**P, "id": eid, "changes": [
        {"field": "qty", "value": "7", "expected": "3"}]})
    check("locationSupplyEdit: a stale witness is the 409 carrying what Postgres holds now; nothing kept",
          env.get("status") == 409 and ((env.get("data") or {}).get("current") or {}).get("qty") == "5"
          and not kept(wid), safe(code, env))
    code, env, wid = write(W, "locationSupplyEntry", MASTER, {**P, "item": "Gloves", "kind": "nope", "qty": 1})
    check("locationSupplyEntry: a kind that is none of the ledger's is the 400 it was; nothing kept",
          env.get("status") == 400 and not kept(wid), safe(code, env))


def house_door():
    ctx = SUBJECT["house"]
    code_ = ctx["code"]
    reads = L.Reads(db, None)
    sid = reads.prop_book(L.ENTITIES_PROP, L.ENTITIES_FALLBACK)
    ref = reads.db.tab(sid, L.HOMES_TAB)
    row = next((r for r in reads.db.locations_rows(ref)
                if L.home_code(r.get("abbreviation", ""), r.get("home_name", "")) == code_), None)
    if row is None or "telephone" not in [gsjs.trim(gsjs.js_str(h)) for h in ref.headers]:
        check("locationHouseSave: the house's registry row with a telephone column", False)
        return
    name, phone = gsjs.text(row.get("home_name", "")), gsjs.text(row.get("telephone", ""))
    new = "(330) 555-0177" if phone != "(330) 555-0177" else "(330) 555-0178"
    code, env, wid = write(W, "locationHouseSave", MASTER, {"house": code_, "home_name": name, "changes": [
        {"field": "telephone", "value": new, "expected": phone},
        {"field": "abbreviation", "value": "ZZ", "expected": ""}]})
    rows = kept(wid)
    check("locationHouseSave: the telephone kept final under the house code; the code itself stays locked",
          env.get("status") == 200 and final_of(env) and env["data"]["written"] == ["telephone"]
          and {r[1:6] for r in rows} == {("edit", "code", "header", code_, "telephone")} and rows[0][6] == new,
          safe(code, env))

    def phone_now():
        c, got = read("locations", "locationOverview", MASTER, {"house": code_})
        return (((got.get("data") or {}).get("house") or {}).get("phone"))
    check("locationHouseSave: the next read (the overview) shows the telephone", phone_now() == new)
    reload()
    check("locationHouseSave: read back after a reload", phone_now() == new)
    code, env, wid = write(W, "locationHouseSave", MASTER, {"house": code_, "home_name": name, "changes": [
        {"field": "telephone", "value": "(330) 555-0179", "expected": phone}]})
    check("locationHouseSave: a stale witness is the 409 carrying what Postgres holds now; nothing kept",
          env.get("status") == 409 and ((env.get("data") or {}).get("current") or {}).get("telephone") == new
          and not kept(wid), safe(code, env))
    code, env, wid = write(W, "locationHouseSave", MASTER, {"house": code_, "home_name": name + " x", "changes": [
        {"field": "telephone", "value": phone, "expected": new}]})
    check("locationHouseSave: a house name the row no longer carries is the 409 it was; nothing kept",
          env.get("status") == 409 and not kept(wid), safe(code, env))


def staff_door():
    ctx = SUBJECT["house"]
    code_ = ctx["code"]
    part = L.staff_part(L.Reads(db, None), ctx)
    if part.get("removed_why") or not part.get("staff"):
        check("locationStaffRemove: a person on the house's Staff list", False, part.get("removed_why"))
        return
    p = part["staff"][0]
    code, env, wid = write(W, "locationStaffRemove", MASTER, {"house": code_, "staff": p["name"]})
    rows = kept(wid)
    rid = next((r[4] for r in rows), "")
    check("locationStaffRemove: the person taken off, kept final — one appended row under its minted HS_ id",
          env.get("status") == 200 and final_of(env) and re.fullmatch(r"HS_[0-9a-f-]{36}", rid or "")
          and {r[0:4] for r in rows} == {(L.STAFF_OFF_TAB, "append", "id", "header")}
          and set(W.STAFF_OFF_HEADER) == {r[5] for r in rows}, safe(code, env))
    check("locationStaffRemove: the next read has the person off the house",
          p["key"] in laid(lambda r: r.staff_off(code_)))
    reload()
    check("locationStaffRemove: still off after a reload", p["key"] in laid(lambda r: r.staff_off(code_)))
    code, env, wid = write(W, "locationStaffRemove", MASTER, {"house": code_, "staff": p["name"]})
    check("locationStaffRemove: taking them off again is the 404 it was (they are not on the list); nothing kept",
          env.get("status") == 404 and not kept(wid), safe(code, env))
    code, env, wid = write(W, "locationStaffRemove", MASTER, {"house": code_, "staff": p["name"], "back": True})
    check("locationStaffRemove: put back, kept final; the next read has them on the house again",
          env.get("status") == 200 and final_of(env) and kept(wid)
          and p["key"] not in laid(lambda r: r.staff_off(code_)), safe(code, env))


def repair_door():
    ctx = SUBJECT["house"]
    code_ = ctx["code"]
    reads = L.Reads(db, None)
    rows_ = L.repairs_for(reads.estate("workOrders"), code_, L.addr_index(ctx["homes"], ctx["all_clients"]))
    done, rid, env, wid, code = False, "", {}, "", 0
    note = "Final check resolution note"
    for r in rows_[:30]:
        rid = r["id"]
        code, env, wid = write(W, "locationRepairEdit", MASTER, {"house": code_, "id": rid, "changes": [
            {"field": "resolution_notes", "value": note, "expected": r["resolution_notes"]},
            {"field": "timestamp", "value": "x", "expected": ""}]})
        if env.get("status") == 200:
            done = True
            break
    rows = kept(wid) if done else []
    check("locationRepairEdit: the resolution kept final under the cells no edit writes (its filing time and street),"
          " never its sheet row; the filing time stays",
          done and final_of(env) and env["data"]["written"] == ["resolution_notes"] and len(env["data"]["refused"]) == 1
          and len(rows) == 1 and rows[0][2] == "cols:Timestamp|Select Address/vehicle" and rows[0][3] == "estate"
          and rows[0][5] == "resolution_notes" and not re.fullmatch(r"r\d+", rows[0][4]), safe(code, env))
    if not done:
        return

    def shown():
        c, got = read("locations", "locationRepairs", MASTER, {"house": code_, "resolved": True})
        return next((x.get("resolution_notes") for x in (got.get("data") or {}).get("rows") or [] if x.get("id") == rid),
                    None)
    check("locationRepairEdit: the next read shows it on the house's repairs", shown() == note)
    reload()
    check("locationRepairEdit: read back after a reload", shown() == note)
    code, env, wid = write(W, "locationRepairEdit", MASTER, {"house": code_, "id": rid, "changes": [
        {"field": "resolution_notes", "value": "Again", "expected": "stale"}]})
    check("locationRepairEdit: a stale witness is the 409 carrying what Postgres holds now; nothing kept",
          env.get("status") == 409 and ((env.get("data") or {}).get("current") or {}).get("resolution_notes") == note
          and not kept(wid), safe(code, env))


def left_doors():
    ctx = SUBJECT["house"]
    c0 = ctx["clients"][0]
    code, env, wid = write(W, "locationIncidentFile", MASTER, {"house": ctx["code"], "row": {
        "client_name": c0["name"], "incident_category": "Final check"}})
    check("locationIncidentFile: still handed to Apps Script (its support-desk alert), never final; nothing kept",
          (env.get("_write") or {}).get("engine") is True and not final_of(env) and not kept(wid), safe(code, env))


def client_subject():
    reads = L.Reads(db, None)
    mi = C.master_index(reads)
    cols = C.edit_columns()
    for r in C._hub(reads, "clients"):
        key = gsjs.trim(gsjs.or_text(r.get("client_key")))
        if not key or not gsjs.js_str(r.get("id")):
            continue
        ctx = C.client_ctx(reads, key)
        if ctx.get("refused") or ctx.get("archived") or C.status_word(ctx) != "Active":
            continue
        hit = mi["rows"].get(gsjs.name_key(ctx["name"]))
        if not hit or hit.get("ambiguous"):
            continue
        src = C.sources_of(reads, ctx)
        if src["degraded"]:
            continue
        live = C.scrub(C.edit_raw(C.picker(ctx.get("row") or {}, src["mf"], src["tf"])))
        field = next((f for f in ("transportation", "workshop", "medical_supply", "media_release")
                      if f in cols and not C._marked(live.get(f))), "")
        if field:
            return key, field
    return "", ""


def profile_live(key, field):
    def go(reads):
        ctx = C.client_ctx(reads, key)
        src = C.sources_of(reads, ctx)
        return C.scrub(C.edit_raw(C.picker(ctx.get("row") or {}, src["mf"], src["tf"]))).get(field)
    return laid(go)


def client_doors():
    key, field = client_subject()
    check("clientProfileSave: an active client with a Hub row and one Master row", bool(key))
    if not key:
        return
    SUBJECT["client"] = key
    before = profile_live(key, field) or ""
    value = "Final check value"
    code, env, wid = write(CW, "clientProfileSave", MASTER, {"client": key, "changes": [
        {"field": field, "value": value, "expected": before}, {"field": "ssn", "value": "1", "expected": ""}]})
    rows = kept(wid)
    col = C.edit_columns()[field]
    check("clientProfileSave: the master's field kept final on the client's Hub row under its id (and its updatedAt);"
          " the SSN stays protected",
          env.get("status") == 200 and final_of(env) and pg(env) and env["data"]["written"] == [field]
          and len(env["data"]["refused"]) == 1 and {r[1:4] for r in rows} == {("edit", "id", "header")}
          and {r[5] for r in rows} == {col, "updatedAt"}, safe(code, env))
    check("clientProfileSave: the next read shows it", profile_live(key, field) == value)
    reload()
    check("clientProfileSave: read back after a reload", profile_live(key, field) == value)
    code, env, wid = write(CW, "clientProfileSave", MASTER, {"client": key, "changes": [
        {"field": field, "value": "Again", "expected": before or "zz-stale"}]})
    check("clientProfileSave: a stale witness is the 409 carrying what Postgres holds now; nothing kept",
          env.get("status") == 409 and ((env.get("data") or {}).get("current") or {}).get(field) == value
          and not kept(wid), safe(code, env))
    EDITIONS["value"] = "[]"
    code, env, wid = write(CW, "clientProfileSave", HOLD, {"client": key, "changes": [
        {"field": field, "value": "Holder", "expected": value}]})
    check("clientProfileSave: an employee no edition lists is told it is no door", unknown(code, env) and not kept(wid),
          safe(code, env))
    EDITIONS["value"] = json.dumps([{"id": "clients.profile", "on": True, "people": [HOLDER["id"]]}])
    code, env, wid = write(CW, "clientProfileSave", HOLD, {"client": key, "changes": [
        {"field": field, "value": "Holder value", "expected": value}]})
    rows = kept(wid)
    check("clientProfileSave: a holder of clients.profile writes it, kept under that edition",
          env.get("status") == 200 and final_of(env) and rows and {r[7] for r in rows} == {"clients.profile"},
          safe(code, env))
    EDITIONS["value"] = "[]"

    # the house: the Hub row and the Master write-through, both kept
    reads = L.Reads(db, None)
    homes = [h["code"] for h in reads.homes()]
    now = gsjs.text(profile_live(key, "house") or "")
    to = next((h for h in homes if h != now), "")
    code, env, wid = write(CW, "clientProfileSave", MASTER, {"client": key, "changes": [
        {"field": "house", "value": to, "expected": now}]})
    rows = kept(wid)
    tabs = {(r[2].split(":")[0], r[5]) for r in rows}
    check("clientProfileSave: a house change kept final on the Hub row (by id) and on the client's Master row (by the"
          " name cell, the House column)",
          env.get("status") == 200 and final_of(env) and env["data"]["written"] == ["house"]
          and ("id", "house") in tabs and ("cols", "House") in tabs, [safe(code, env), sorted(tabs)])
    check("clientProfileSave: the next read has the client in the new house", profile_live(key, "house") == to
          and any(c.get("client_key") == key for c in laid(lambda r: L.house(r, to)).get("clients") or []))
    SUBJECT["moved_to"] = to

    code, env, wid = write(CW, "clientProfileSave", MASTER, {"client": key, "fields": {field: "Older save"}})
    check("clientProfileSave: the older `fields` save kept final too", env.get("status") == 200 and final_of(env)
          and (env.get("data") or {}).get("saved") is True and kept(wid), safe(code, env))
    check("clientProfileSave: read back", profile_live(key, field) == "Older save")


def override_doors():
    key = SUBJECT.get("client")
    if not key:
        return
    tab = C.OVERRIDE_TABS[0]
    code, env, wid = write(CW, "clientProfileOverride", MASTER, {"client": key, "kind": "care", "tab": tab, "changes": [
        {"field": "record", "value": "Final check record", "expected": ""},
        {"field": "text", "value": "Final check text", "expected": ""}]})
    rows = kept(wid)
    rid = (env.get("data") or {}).get("id", "")
    check("clientProfileOverride: a new care record kept final — appended under the id Python mints (CO_<client>_care_…)",
          env.get("status") == 200 and final_of(env) and rid.startswith(f"CO_{key}_care_")
          and re.fullmatch(r"[0-9a-f]{10}", rid.rsplit("_", 1)[-1] or "")
          and {r[0:5] for r in rows} == {(C.OVERRIDES_TAB, "append", "id", "header", rid)}, safe(code, env))

    def record():
        def go(reads):
            ctx = C.client_ctx(reads, key)
            return next((r for r in C.care_build(reads, ctx, tab)["rows"] if r.get("id") == rid), None)
        return laid(go)
    r = record()
    check("clientProfileOverride: the next read shows the record on the client's Care & Support",
          bool(r) and r.get("record") == "Final check record")
    reload()
    check("clientProfileOverride: read back after a reload", bool(record()))
    code, env, wid = write(CW, "clientProfileOverride", MASTER, {"client": key, "kind": "care", "tab": tab, "target": rid,
                                                                 "changes": [{"field": "text", "value": "Edited text",
                                                                              "expected": "Final check text"}]})
    rows = kept(wid)
    check("clientProfileOverride: the record edited, kept final under the same id",
          env.get("status") == 200 and final_of(env) and {r[1:5] for r in rows} == {("edit", "id", "header", rid)},
          safe(code, env))
    code, env, wid = write(CW, "clientProfileOverride", MASTER, {"client": key, "kind": "care", "tab": tab, "target": rid,
                                                                 "changes": [{"field": "text", "value": "x",
                                                                              "expected": "Final check text"}]})
    check("clientProfileOverride: a stale witness is the 409 it was; nothing kept",
          env.get("status") == 409 and not kept(wid), safe(code, env))
    code, env, wid = write(CW, "clientProfileOverride", HOLD, {"client": key, "kind": "family", "changes": [
        {"field": "name", "value": "Someone", "expected": ""}]})
    check("clientProfileOverride: a family member stays the master's — anyone else is told it is no door",
          unknown(code, env) and not kept(wid), safe(code, env))


def create_and_place():
    name = "Zzfinal Checkperson"
    code, env, wid = write(CW, "clientCreate", MASTER, {"name": name, "status": "active"})
    rows = kept(wid)
    key = gsjs.name_key(name)
    check("clientCreate: the new client kept final — one appended Hub row under CLI_<key>, createRow_'s stamps",
          env.get("status") == 200 and final_of(env) and (env.get("data") or {}).get("id") == "CLI_" + key
          and {r[1:5] for r in rows} == {("append", "id", "header", "CLI_" + key)}
          and {"createdAt", "updatedAt", "client_key", "name"} <= {r[5] for r in rows}, safe(code, env))
    check("clientCreate: the next read has the client on the directory",
          any(gsjs.trim(gsjs.or_text(r.get("client_key"))) == key for r in laid(lambda r: C._hub(r, "clients"))))
    code, env, wid = write(CW, "clientCreate", MASTER, {"name": name})
    check("clientCreate: the same name again is the 409 it was (the kept row is on the directory); nothing kept",
          env.get("status") == 409 and not kept(wid), safe(code, env))
    ctx = SUBJECT["house"]
    code, env, wid = write(W, "locationClientsAdd", MASTER, {"house": ctx["code"], "clients": [key]})
    rows = kept(wid)
    d = env.get("data") or {}
    check("locationClientsAdd: a client with no house placed at this one, kept final on its Hub row (by id); "
          "no Master row, so the Hub record alone carries it",
          env.get("status") == 200 and final_of(env) and d.get("client_keys") == [key]
          and {(r[2], r[4], r[5]) for r in rows} == {("id", "CLI_" + key, "house"), ("id", "CLI_" + key, "updatedAt")},
          safe(code, env))
    check("locationClientsAdd: the next read has the client in the house",
          any(c.get("client_key") == key for c in laid(lambda r: L.house(r, ctx["code"])).get("clients") or []))
    code, env, wid = write(W, "locationClientsAdd", MASTER, {"house": ctx["code"], "clients": [key]})
    check("locationClientsAdd: again is the 409 it was (already a client here); nothing kept",
          env.get("status") == 409 and not kept(wid), safe(code, env))
    moved, to = SUBJECT.get("client"), SUBJECT.get("moved_to")
    if moved and to and to != ctx["code"]:
        code, env, wid = write(W, "locationClientsAdd", MASTER, {"house": ctx["code"], "clients": [moved]})
        check("locationClientsAdd: Locations' write sees the house Clients kept in Postgres (a current client of "
              "another house is never taken off it); nothing kept", env.get("status") == 409 and not kept(wid),
              safe(code, env))


def left_client_doors():
    key = SUBJECT.get("client")
    if not key:
        return
    code, env, wid = write(CW, "clientProfileStatus", MASTER, {"client": key, "changes": [
        {"field": "status", "value": "Inactive", "expected": "Active"}]})
    handed = (env.get("_write") or {}).get("engine") is True
    check("clientProfileStatus: the Hub row kept final, a refusal with nothing kept, or a book row's move handed to "
          "Apps Script with nothing kept",
          (final_of(env) and bool(kept(wid))) if env.get("status") == 200 and not handed
          else not final_of(env) and not kept(wid) and (handed or env.get("status") == 409), safe(code, env))


SUBJECT["house"] = the_house()
check("a house with a registry row, current clients and repair requests", bool(SUBJECT["house"]))
try:
    with real.transaction():
        if SUBJECT["house"]:
            for name, fn in (("Notes", notes_doors), ("Supplies", supply_doors), ("House", house_door),
                             ("Staff", staff_door), ("Repairs", repair_door), ("Left on Apps Script", left_doors),
                             ("Client profile", client_doors), ("Care and family", override_doors),
                             ("New client, placed", create_and_place), ("Clients left", left_client_doors)):
                guarded(name, fn)
        with real.cursor() as c:
            c.execute("select count(*), count(distinct write_id), count(*) filter (where match_by = 'row')"
                      " from pg_temp.hub_edits_check")
            n, w, rowed = c.fetchone()
        check("no kept cell names a sheet row number", rowed == 0, rowed)
        facts["cells kept in the check's app.edits (temp)"] = f"{n} cells from {w} writes"
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
with psycopg.connect(hubdb._dsn(), autocommit=True, connect_timeout=5) as c2:
    # a closed session leaves pg_stat_activity a moment after its socket closes
    for _ in range(20):
        left = c2.execute("select count(*) from pg_stat_activity"
                          " where application_name = 'loc-clients-final-check'").fetchone()[0]
        if not left:
            break
        time.sleep(0.25)
    live_edits = c2.execute("select to_regclass('app.edits') is not null").fetchone()[0]
check("nothing is left: the check's session is gone, its temp tables with it", left == 0, left)
facts["app.edits in the live database"] = "exists (untouched by this check)" if live_edits else "not made yet (untouched)"
facts["slowest decision per door (s)"] = ", ".join(f"{a} {t:.1f}" for a, t in sorted(spent.items()))
facts["peak memory (MiB)"] = str(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024)
print(json.dumps({"checks": out, "facts": facts}))
'''


def live() -> None:
    print("the doors, on real subjects (asa-hub-db-sync)")
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


def compiled() -> None:
    print("the modules compile")
    files = [str(p) for p in sorted((ROOT / "app").glob("*.py"))] + [str(ROOT / "server" / "snapshot_service.py")]
    got = subprocess.run([sys.executable, "-m", "py_compile", *files], capture_output=True)
    check("py_compile app/*.py server/snapshot_service.py", got.returncode == 0, got.stderr.decode()[-800:])


def main() -> int:
    compiled()
    relay()
    if "--static" not in sys.argv:
        live()
    print(f"{results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
