#!/usr/bin/env python3
"""Staff's editions on real subjects, in asa-hub-db-sync: a holder's HR Admin panel witnessed by what the audited HR read
shows (staff.hr, and staff.profile's address), and a staff note's category, priority and text (staff.notesEdit) — the
master, a person not listed and a listed person (the editions value and App Control's release simulated), each write's
app.edits rows printed as shapes. Nothing real is written: the edit store lives in temp tables inside one transaction
rolled back at the end, each write in its own savepoint. Prints shapes, counts and timings only."""
from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, re, sys, time, types, uuid
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
import staff as SP, staff_writes as SW
import main as M

out, facts, rows_seen = [], {}, []


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


# the shared registry's row for the new edition, as the integration adds it to scope.py
if SP.EDITION_NOTES_EDIT not in {e for e, _a in sc.EDITIONS}:
    sc.EDITIONS = tuple(sc.EDITIONS) + ((SP.EDITION_NOTES_EDIT, SP.APP_ID),)
    facts["scope.EDITIONS"] = "staff.notesEdit simulated (the integration adds it)"
W.EDITS_TABLE = "pg_temp.hub_edits_check"
W.LOCK_KEY = 0x53544544434B


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
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="staff-editions-check")
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
M.STORE = M.CLIENT_STORE = W.Store(dsn="")
M.STAFF_STORE = M.SSA_STORE = M.FAMILY_STORE = store
M.WRITE_BUDGET_S = 120.0
spent, seq = {}, [0]


def listed(*eids):
    EDITIONS["value"] = json.dumps([{"id": e, "on": True, "people": [HOLDER["id"]]} for e in eids])


def rows_of(wid):
    with real.cursor() as c:
        c.execute("select tab_name, kind, match_by, field, value, edition from pg_temp.hub_edits_check"
                  " where write_id = %s order by id", (wid,))
        return c.fetchall()


def write(action, who, payload, label, keep=False):
    """One decision in its own savepoint; its app.edits rows read before the savepoint is rolled back."""
    seq[0] += 1
    wid = f"Wcheck-se-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    t0 = time.monotonic()
    got = {}

    def run():
        res = M._run_write(SW, action, who, payload, wid)
        got["code"], got["env"], got["rows"] = res.status_code, json.loads(res.body), rows_of(wid)

    if keep:
        run()
    else:
        try:
            with real.transaction():
                run()
                raise psycopg.Rollback()
        except psycopg.Rollback:
            pass
    spent[action] = max(spent.get(action, 0.0), time.monotonic() - t0)
    shape = [[t, k, m.split(":")[0] if ":" in m else m, f, v if label.get("show_values") else f"<{len(v)} chars>", e]
             for t, k, m, f, v, e in got["rows"]]
    rows_seen.append([label["who"] + " · " + action + " · " + label["what"], got["env"].get("status"), shape])
    return got["code"], got["env"], got["rows"]


def unknown(code, env):
    return code == 200 and env == {"status": 404, "message": "Unknown action."}


def final_of(env):
    return (env.get("_write") or {}).get("final") is True


reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
holder = next((u for u in users if gsjs.str_(u.get("role")).lower() in ("staff", "manager")
               and not gsjs.str_(u.get("clientkey")) and gsjs.str_(u.get("active")).lower() != "false"
               and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")), "role": "admin", "is_master": True}
HOLD = {"uid": gsjs.str_((holder or {}).get("userid")), "role": gsjs.str_((holder or {}).get("role")).lower(),
        "is_master": False}
HOLDER["id"] = HOLD["uid"]
check("the master's account and an employee's account are read from the users tab", bool(master and holder))
NEW_DAY, NEW_ADDRESS = "2026-01-15", "1 Edition Check Way"
SCREEN = "sam"


def hr_subjects(n):
    global SCREEN
    reads = L.Reads(db, None)
    found, why = [], {}
    held = SP.master_index(reads)["cols"]
    # the first screening line the Master carries a column for; else another HR Admin date
    SCREEN = next((c for _s, _l, c, _f in SP.SCREENS if c in held), "i9_date")
    facts["second HR field"] = SCREEN

    def skip(reason):
        why[reason] = why.get(reason, 0) + 1

    for key, row in list(SP.master_index(reads)["rows"].items())[:600]:
        if row.get("ambiguous"):
            skip("ambiguous")
            continue
        c = SP.person(reads, key)
        if c.get("refused") or not c.get("master") or not c["master"].get("employee_id"):
            skip("no person, Master row or Employee ID")
            continue
        cols = c.get("master_cols") or {}
        if not {"w4_date", "address", SCREEN} <= set(cols):
            skip("a column missing: " + ",".join(sorted({"w4_date", "address", SCREEN} - set(cols))))
            continue
        if {"w4_date", "address", SCREEN} & set(c.get("_unsure") or ()):
            skip("a column folded with its twin")
            continue
        live = c.get("master_edit") or {}
        if any(C._marked(live.get(f)) for f in ("w4_date", "address", SCREEN)):
            skip("a cell withheld in the copy")
            continue
        if SW.master_target(reads, c).get("why"):
            skip("the Master row not told apart")
            continue
        found.append((key, c))
        if len(found) == n:
            break
    facts["subjects skipped, by reason"] = json.dumps(why)
    return found


def hr_holder(i, key, ctx):
    tag = f"subject {i + 1}"
    raw = ctx["master_edit"]
    shown = {f: SP.hr_shown(ctx, f) for f in ("w4_date", "address", SCREEN)}
    facts[f"{tag}: w4_date raw differs from what HR Admin shows"] = str(raw.get("w4_date", "") != shown["w4_date"])
    EDITIONS["value"] = "[]"
    code, env, rows = write("staffProfileEdit", MASTER, {"key": key, "changes": [
        {"field": "w4_date", "value": NEW_DAY, "expected": raw.get("w4_date", "")}]},
        {"who": "master", "what": tag + " W-4 date, raw witness", "show_values": True})
    check(f"{tag}: the master's W-4 date on the raw witness is kept final, no edition",
          env.get("status") == 200 and final_of(env) and len(rows) == 1 and rows[0][4] == NEW_DAY and rows[0][5] == "",
          [env.get("status"), env.get("message")])
    if raw.get("w4_date", "") != shown["w4_date"]:
        code, env, rows = write("staffProfileEdit", MASTER, {"key": key, "changes": [
            {"field": "w4_date", "value": NEW_DAY, "expected": shown["w4_date"]}]},
            {"who": "master", "what": tag + " W-4 date, shown witness", "show_values": True})
        check(f"{tag}: the master's panel stays on the raw cells — a shown witness is stale (409), nothing kept",
              env.get("status") == 409 and not rows, [env.get("status"), env.get("message")])
    code, env, rows = write("staffProfileEdit", HOLD, {"key": key, "changes": [
        {"field": "w4_date", "value": NEW_DAY, "expected": shown["w4_date"]}]},
        {"who": "not listed", "what": tag + " W-4 date", "show_values": True})
    check(f"{tag}: an employee no edition lists is told it is no door, nothing kept", unknown(code, env) and not rows, env)
    listed("staff.hr")
    code, env, rows = write("staffProfileEdit", HOLD, {"key": key, "changes": [
        {"field": "w4_date", "value": NEW_DAY, "expected": shown["w4_date"]},
        {"field": SCREEN, "value": NEW_DAY, "expected": shown[SCREEN]},
        {"field": "ssn", "value": "1", "expected": ""}, {"field": "status", "value": "No", "expected": ""},
        {"field": "address", "value": NEW_ADDRESS, "expected": shown["address"]}]},
        {"who": "staff.hr holder", "what": tag + " W-4 + " + SCREEN + " on the shown witness, SSN, status, address",
         "show_values": True})
    why = {r["field"]: r["why"] for r in (env.get("data") or {}).get("refused", [])}
    check(f"{tag}: a staff.hr holder writes the W-4 and {SCREEN} dates on what HR Admin shows (kept under staff.hr); the SSN "
          "stays protected, the status the master's, the address outside staff.hr",
          env.get("status") == 200 and final_of(env) and sorted(env["data"]["written"]) == sorted(["w4_date", SCREEN])
          and {r[5] for r in rows} == {"staff.hr"} and why.get("ssn") == SP.EDIT_PROTECTED
          and why.get("status") == SP.EDIT_MASTER_ONLY["status"] and why.get("address") == SP.EDITION_NOT_HELD,
          [env.get("status"), env.get("message"), why, len(rows)])
    code, env, rows = write("staffProfileEdit", HOLD, {"key": key, "changes": [
        {"field": "w4_date", "value": NEW_DAY, "expected": "1999-01-01"}]},
        {"who": "staff.hr holder", "what": tag + " W-4 date, stale witness", "show_values": True})
    check(f"{tag}: a holder's stale witness is the 409 carrying what HR Admin shows now, nothing kept",
          env.get("status") == 409 and (env.get("data") or {}).get("current", {}).get("w4_date") == shown["w4_date"]
          and not rows, [env.get("status"), env.get("message")])
    listed("staff.profile")
    code, env, rows = write("staffProfileEdit", HOLD, {"key": key, "changes": [
        {"field": "address", "value": NEW_ADDRESS, "expected": shown["address"]}]},
        {"who": "staff.profile holder", "what": tag + " street address on the shown witness", "show_values": True})
    check(f"{tag}: a staff.profile holder writes the street address from the HR panel (kept under staff.profile)",
          env.get("status") == 200 and final_of(env) and env["data"]["written"] == ["address"]
          and [(r[3] != "", r[4], r[5]) for r in rows] == [(True, NEW_ADDRESS, "staff.profile")],
          [env.get("status"), env.get("message")])
    EDITIONS["value"] = "[]"


def note_doors(i, key):
    tag = f"subject {i + 1}"
    EDITIONS["value"] = "[]"
    code, env, rows = write("staffProfileNoteAdd", MASTER, {"staff": key, "category": "general", "details": "Edition check"},
                            {"who": "master", "what": tag + " a note to edit", "show_values": False}, keep=True)
    nid = ((env.get("data") or {}).get("note") or {}).get("id", "")
    check(f"{tag}: a note filed to edit (kept in the check's own store)", env.get("status") == 200 and nid.startswith("SN_"))
    code, env, rows = write("staffProfileNoteEdit", MASTER, {"id": nid, "staff": key, "changes": [
        {"field": "priority", "value": "high", "expected": "normal"},
        {"field": "details", "value": "Edition check (edited)", "expected": "Edition check"}]},
        {"who": "master", "what": tag + " priority + text", "show_values": True})
    check(f"{tag}: the master edits the note's priority and text, kept final with no edition; who and when untouched",
          env.get("status") == 200 and final_of(env) and sorted(r[3] for r in rows) == ["details", "priority"]
          and {r[5] for r in rows} == {""} and {r[2] for r in rows} == {"id"}, [env.get("status"), env.get("message")])
    code, env, rows = write("staffProfileNoteEdit", MASTER, {"id": nid, "staff": key, "changes": [
        {"field": "by", "value": "x", "expected": ""}, {"field": "category", "value": "nope", "expected": "general"},
        {"field": "details", "value": "", "expected": "Edition check"}]},
        {"who": "master", "what": tag + " author, bad category, blank text", "show_values": True})
    why = {r["field"]: r["why"] for r in (env.get("data") or {}).get("refused", [])}
    check(f"{tag}: the author is no field, a category outside the list and a blank text are refused, nothing kept",
          env.get("status") == 200 and not rows and set(why) == {"by", "category", "details"}, [env.get("status"), why])
    code, env, rows = write("staffProfileNoteEdit", MASTER, {"id": nid, "staff": key, "changes": [
        {"field": "priority", "value": "low", "expected": "urgent"}]},
        {"who": "master", "what": tag + " stale priority", "show_values": True})
    check(f"{tag}: a stale witness is the 409 carrying what the note holds now",
          env.get("status") == 409 and (env.get("data") or {}).get("current", {}).get("priority") == "normal" and not rows,
          [env.get("status"), env.get("message")])
    code, env, rows = write("staffProfileNoteEdit", MASTER, {"id": nid, "staff": "zzzsomeoneelse", "changes": [
        {"field": "priority", "value": "low", "expected": "normal"}]},
        {"who": "master", "what": tag + " another staff key", "show_values": True})
    check(f"{tag}: a note of another staff member is the 409", env.get("status") == 409 and not rows, env.get("status"))
    listed("staff.notes")
    code, env, rows = write("staffProfileNoteEdit", HOLD, {"id": nid, "staff": key, "changes": [
        {"field": "category", "value": "training", "expected": "general"}]},
        {"who": "staff.notes holder", "what": tag + " category", "show_values": True})
    check(f"{tag}: staff.notes alone opens no edit of a note's text or category", unknown(code, env) and not rows, env)
    listed("staff.notesEdit")
    code, env, rows = write("staffProfileNoteEdit", HOLD, {"id": nid, "staff": key, "changes": [
        {"field": "category", "value": "training", "expected": "general"}]},
        {"who": "staff.notesEdit holder", "what": tag + " category", "show_values": True})
    check(f"{tag}: a staff.notesEdit holder changes the category, kept under that edition",
          env.get("status") == 200 and final_of(env) and [(r[3], r[4], r[5]) for r in rows] == [
              ("category", "training", "staff.notesEdit")], [env.get("status"), env.get("message")])
    EDITIONS["value"] = "[]"


try:
    with real.transaction():
        store.ensure()
        check("the edit store is made in temp tables", store.ready(), store.why)
        subjects = hr_subjects(2)
        check("two staff members with a Master row (Employee ID), the W-4, address and a screening column", len(subjects) == 2,
              len(subjects))
        for i, (key, ctx) in enumerate(subjects):
            try:
                hr_holder(i, key, ctx)
                note_doors(i, key)
            except Exception as exc:  # noqa: BLE001 - said as a failed check, never a value
                check(f"subject {i + 1}: ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300])
        raise psycopg.Rollback()
except psycopg.Rollback:
    pass
finally:
    try:
        real.close()
    except Exception:
        pass
with psycopg.connect(hubdb._dsn(), autocommit=True, connect_timeout=5) as c2:
    left = c2.execute("select count(*) from pg_stat_activity where application_name = 'staff-editions-check'").fetchone()[0]
check("nothing is left: the check's session is gone, its temp tables with it", left == 0, left)
facts["slowest decision per door (s)"] = ", ".join(f"{a} {t:.1f}" for a, t in sorted(spent.items()))
print(json.dumps({"checks": out, "facts": facts, "rows": rows_seen}))
'''


def main() -> int:
    blob = {"app": {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=1500)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print("the driver did not run in asa-hub-db-sync:", got.stderr.decode()[-1500:])
        return 1
    res = json.loads(lines[-1])
    failed = 0
    for name, ok, detail in res["checks"]:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok or not detail else f"\n       {detail}"))
        failed += 0 if ok else 1
    for k, v in res["facts"].items():
        print(f"  fact {k}: {v}")
    print("app.edits rows (tab, kind, match, field, value, edition) — row keys withheld:")
    for what, status, rows in res["rows"]:
        print(f"  [{status}] {what}")
        for r in rows:
            print(f"      {r}")
    print(f"{len(res['checks']) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
