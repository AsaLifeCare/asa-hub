#!/usr/bin/env python3
"""Time Reconciliation decided by the streamed modules on the real recon rows in asa-hub-db-sync: the runs, the errors
(a run's, or the live ones of every run) and a day's shifts read by the people the writes let in and refused to anyone
else, through its doors and through the generic verbs alike (reconErrorsList and the rest: the same gate, the generic
writes the writers' alone); an error resolved and reopened, a run closed, the thresholds saved, the refusals, and the
people recon.review and recon.settings list; a run over one PsiAnywhere pay period (the current one by default, 35 days
at most) prepared — judged as of the record's last change, so nothing still in progress today is an error — and
stored — the earlier rows of its days superseded, a resolution carried to the next run of the same days — and the daily
run over the previous and the current period with its mark. Nothing real is written: the edit store lives in temp
tables and every row written lands inside one transaction rolled back at the end. Prints shapes and counts only."""
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
import base64, importlib.abc, importlib.util, json, os, sys, tempfile, time, types, uuid
SRC = json.loads(base64.b64decode(sys.stdin.readline()).decode())
# the JSON the modules read beside themselves at import (front_door's routes, the lanes' tables), laid in a scratch
# directory each module is placed in
WORK = tempfile.mkdtemp(prefix="recon-check-")
for name, text in SRC.items():
    if name.startswith("@"):
        with open(os.path.join(WORK, name[1:]), "w", encoding="utf-8") as fh:
            fh.write(text)


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = os.path.join(WORK, module.__name__ + ".py")
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)


sys.meta_path.insert(0, Checkout())
fake = types.ModuleType("fastapi")


class Resp:
    def __init__(self, content=b"", status_code=200, media_type="", headers=None):
        self.body = content if isinstance(content, (bytes, str)) else json.dumps(content)
        self.status_code, self.headers = status_code, dict(headers or {})


class App:
    def __init__(self, *_a, **_kw):
        pass

    # every route, mount and middleware main.py installs: a decorator that keeps the function as it is
    def __getattr__(self, _name):
        return lambda *_a, **_kw: (lambda fn: fn)


fake.FastAPI, fake.Request, fake.Response = App, object, Resp
fake.Header = lambda *_a, **_kw: None
responses = types.ModuleType("fastapi.responses")
responses.JSONResponse = lambda content, status_code=200, headers=None: Resp(content, status_code, "", headers)
responses.Response = responses.StreamingResponse = Resp
conc = types.ModuleType("starlette.concurrency")


async def run_in_threadpool(fn, *a, **kw):
    return fn(*a, **kw)
conc.run_in_threadpool = run_in_threadpool
sys.modules.update({"fastapi": fake, "fastapi.responses": responses, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": conc})

import re
from datetime import datetime, timezone
import psycopg
import gsjs, hubdb, scope as sc, locations as L, writes as W
import psi_periods as PP
import recon as R
import recon_detect as D
import recon_gate as RG
import recon_psi as PSI
import recon_writes as RW
import main as M

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_rcn"
W.LOCK_KEY = 0x52434E434B


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
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="recon-check")
store = W.Store(connect=lambda: Conn(real), kind="check", label="Check")
EDITIONS = {"value": "[]"}
if not any(a == "time-recon" for _e, a in sc.EDITIONS):
    sc.EDITIONS = tuple(sc.EDITIONS) + (("recon.review", "time-recon"), ("recon.settings", "time-recon"))
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
M.stores = lambda: {"time-recon": store}
M.WRITE_BUDGET_S = 120.0
seq = [0]


def read(action, who, payload):
    res = M._run(R, action, who, payload)
    return res.status_code, json.loads(res.body)


def write(action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-rcn-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    res = M._run_write(RW, action, who, payload, wid)
    return res.status_code, json.loads(res.body), wid


def kept(wid):
    with real.cursor() as c:
        c.execute("select sheet_id, tab_name, kind, row_key, field, value, edition from pg_temp.hub_edits_rcn"
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
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}
STAFF = {"uid": gsjs.str_((staff or {}).get("userid")), "role": "staff", "is_master": False}
runs0 = R.newest_first(R.rows(reads0, R.RUNS_TAB))
errors0 = R.rows(reads0, R.ERRORS_TAB)
RUN = runs0[0] if runs0 else None
# where the copy keeps the errors (a declared house keeps them in its Data tab)
ERRORS_COPY_TAB = W.where_of(W.tab_of(reads0, R.ERRORS_TAB))[1]
facts["the errors' tab"] = ERRORS_COPY_TAB
RUN_ID = gsjs.str_((RUN or {}).get("id"))
ERR = next((e for e in errors0 if gsjs.str_(e.get("runId")) == RUN_ID), None)
facts["copy"] = f"{len(runs0)} runs, {len(errors0)} errors, the newest run holding " \
                f"{sum(1 for e in errors0 if gsjs.str_(e.get('runId')) == RUN_ID)}"
check("a staff account, a run and one of its errors are read from the copy", bool(staff and RUN and ERR))


def reads_doors():
    refused = {"status": 403, "message": RG.READERS_ONLY}
    for action, payload in (("reconRuns", {}), ("reconErrors", {}),
                            ("reconShiftsForDate", {"date": "2026-10-15", "location": "ABD2005"})):
        code, env = read(action, STAFF, payload)
        check(f"{action}: a staff member nobody listed is refused (the errors name staff and clients)",
              env == refused, env)
    for door, payload in (("reconErrorsList", {}), ("reconRunsList", {}), ("timePunchesList", {}),
                          ("reconErrorsGet", {"id": gsjs.str_(ERR.get("id"))}), ("reconRunsGet", {"id": RUN_ID})):
        code, env = read(door, STAFF, payload)
        check(f"{door} (the generic verbs, front_door's route): the same refusal, never a way around the gate",
              env == refused, env)
    code, env = read("reconErrorsList", MASTER, {})
    check("the master lists the error rows through the generic verbs",
          env.get("status") == 200 and len(env.get("data") or []) == len(errors0), (env.get("status"),
                                                                                   len(env.get("data") or [])))
    code, env = read("reconRuns", MASTER, {})
    runs = (env.get("data") or {}).get("runs") or []
    check("the master reads the runs: 200, the twenty newest, newest first",
          code == 200 and env.get("status") == 200 and len(runs) == min(20, len(runs0)) and
          [r.get("id") for r in runs] == [r.get("id") for r in runs0[:20]], env.get("message"))
    code, env = read("reconErrors", MASTER, {})
    d = env.get("data") or {}
    got = d.get("errors") or []
    want = [e for e in errors0 if gsjs.str_(e.get("status")) == "Open"]
    check("no run named: the live Open errors of every run, in place, day and clock order",
          d.get("runId") == "" and len(got) == len(want) and
          [e.get("id") for e in got] == [e.get("id") for e in R.by_place([R.heal(e) for e in want])],
          (len(got), len(want)))
    code, env = read("reconErrors", MASTER, {"runId": RUN_ID, "status": "all"})
    alln = sum(1 for e in errors0 if gsjs.str_(e.get("runId")) == RUN_ID)
    check("a run named, status all: every error of the run, the 1899 stamps healed",
          len((env.get("data") or {}).get("errors") or []) == alln and
          not any(gsjs.str_(e.get("startTime")).startswith("18") for e in (env.get("data") or {}).get("errors") or []))
    worked = [p for p in PSI.punches(reads0, "2026-10-15", "2026-10-15") if p["location"] != "Not Found"]
    place = worked[0]["location"] if worked else "ABD2005"
    code, env = read("reconShiftsForDate", MASTER, {"date": "2026-10-15", "location": place})
    d = env.get("data") or {}
    check("a day's shifts: the plan, PsiAnywhere's punches at the place, and its people's punches elsewhere",
          env.get("status") == 200 and set(d) == {"date", "location", "shifts", "punches", "elsewhere"} and
          len(d.get("punches") or []) == sum(1 for p in worked if p["location"] == place) and
          all(set(x) == {"employeeName", "location", "startTime", "endTime"} and x["location"] != place
              for x in d.get("elsewhere") or []), env.get("message") or sorted(d))
    facts["a day's shifts (10-15, one house)"] = (f"{len(d.get('shifts') or [])} planned, "
                                                 f"{len(d.get('punches') or [])} punches, "
                                                 f"{len(d.get('elsewhere') or [])} elsewhere")
    code, env = read("reconShiftsForDate", MASTER, {"date": "10/15/2026", "location": place})
    check("a day not written yyyy-mm-dd is refused", env.get("status") == 400, env)
    code, env = read("reconConfigGet", MASTER, {})
    d = env.get("data") or {}
    check("the master reads the thresholds: 200, as Apps Script reads them (the saved row's JSON goes through str_)",
          env.get("status") == 200 and all(d.get(k) == v for k, v in R.DEFAULTS.items()) and d.get("auto") == "on"
          and set(d.get("meanings") or {}) == set(R.MEANINGS) and (d.get("source") or {}).get("mode") == "masterSheet",
          d)
    code, env = read("reconConfigGet", STAFF, {})
    check("a staff member nobody listed is refused the thresholds",
          env == {"status": 403, "message": "This action is for admin or manager."}, env)


def changes(wid):
    """What a write changed in Postgres, as the check's own transaction sees it (app.resource_changes): (resource,
    kind, the cells it changed) each — the recon tabs live there since their upload, never in app.edits."""
    out = []
    with real.cursor() as c:
        c.execute("select resource, kind, before, after from app.resource_changes where write_id = %s order by id",
                  (wid,))
        for resource, kind, before, after in c.fetchall():
            b, a = before or {}, after or {}
            out.append((resource, kind, {k: v for k, v in a.items() if b.get(k) != v}))
    return out


def write_doors():
    eid = gsjs.str_(ERR.get("id"))
    code, env, wid = write("reconErrorResolve", MASTER, {"errorId": eid, "status": "Verified", "note": "Check note"})
    got = changes(wid)
    check("the master resolves an error: 200, final, its cells changed in reconErrors and logged",
          env.get("status") == 200 and final(env) and len(got) == 1 and got[0][:2] == ("reconErrors", "update") and
          set(got[0][2]) == {"status", "resolvedBy", "resolvedAt", "note", "updatedAt"}, (got, final(env)))
    check("and the answer is the merged row", ((env.get("data") or {}).get("error") or {}).get("status") == "Verified")
    code, env, wid = write("reconErrorResolve", MASTER, {"errorId": eid, "status": "Open"})
    vals = (changes(wid) or [("", "", {})])[0][2]
    check("reopening clears who and when", vals.get("resolvedBy") == "" and vals.get("resolvedAt") == "", vals)
    code, env, _ = write("reconErrorResolve", MASTER, {"errorId": eid, "status": "Maybe"})
    check("a status that is none is refused", env.get("status") == 400 and "status must be one of" in
          env.get("message", ""), env)
    code, env, _ = write("reconErrorResolve", MASTER, {"status": "Open"})
    check("no error id is refused as the policy refuses it",
          env == {"status": 400, "message": "Missing required parameter: errorId."}, env)
    code, env, _ = write("reconErrorResolve", MASTER, {"errorId": "no-such", "status": "Open"})
    check("an unknown error is 404", env == {"status": 404, "message": 'No "recon_errors" record with id "no-such".'},
          env)
    code, env, _ = write("reconErrorResolve", STAFF, {"errorId": eid, "status": "Open"})
    check("a staff member nobody listed is refused", env == {"status": 403, "message": RW.WRITERS_ONLY}, env)
    for door, payload in (("reconErrorsUpdate", {"id": eid, "status": "Excused"}), ("reconErrorsCreate", {"x": "1"}),
                          ("reconErrorsDelete", {"id": eid}), ("timePunchesUpdate", {"id": "nope"})):
        code, env, _ = write(door, STAFF, payload)
        check(f"{door} (the generic verbs): a staff member writes none", env == {"status": 403,
                                                                                 "message": R.WRITERS_ONLY}, env)
    code, env, _ = write("timePunchesUpdate", MASTER, {"id": "nope"})
    check("the master passes the gate, and route() names the punches by their tab",
          env == {"status": 404, "message": 'No "time_punches" record with id "nope".'}, env)
    code, env, wid = write("reconRunClose", MASTER, {"runId": RUN_ID, "status": "Reviewed"})
    got = changes(wid)
    check("the master closes the run: final, its status and the stamp",
          env.get("status") == 200 and final(env) and len(got) == 1 and got[0][0] == "reconRuns" and
          set(got[0][2]) == {"status", "updatedAt"}, (env.get("status"), got))
    code, env, wid = write("reconConfigSet", MASTER, {"gapMin": 7})
    got = changes(wid) + [("edits", "", {r[4]: r[5] for r in kept(wid)})]
    cfg = (env.get("data") or {}).get("config") or {}
    check("the master saves a threshold: final, the reconThresholds value written as JSON.stringify writes it",
          env.get("status") == 200 and final(env) and cfg.get("gapMin") == 7 and
          any("value" in cells and json.loads(cells["value"]).get("gapMin") == 7 for _r, _k, cells in got), (env, got))
    code, env, _ = write("reconConfigSet", MASTER, {"overlapMin": 999})
    check("a threshold out of range is refused in Apps Script's words",
          env == {"status": 400, "message": "overlapMin must be a whole number between 1 and 480."}, env)
    code, env, _ = write("reconConfigSet", STAFF, {"gapMin": 7})
    check("a staff member nobody listed is refused the thresholds", env == {"status": 403, "message": RW.ADMIN_ONLY},
          env)


def edition_doors():
    HOLDER["id"] = STAFF["uid"]
    EDITIONS["value"] = json.dumps([{"id": "recon.review", "on": True, "people": [STAFF["uid"]]},
                                    {"id": "recon.settings", "on": True, "people": [STAFF["uid"]]}])
    code, env, wid = write("reconErrorResolve", STAFF, {"errorId": gsjs.str_(ERR.get("id")), "status": "Excused"})
    got = changes(wid)
    check("a staff member recon.review lists resolves an error: final, the row changed",
          env.get("status") == 200 and final(env) and got and got[0][2].get("status") == "Excused", (env, got))
    code, env, wid = write("reconConfigSet", STAFF, {"smartRunDays": 3})
    got = changes(wid) + [("edits", "", {r[4]: r[5] for r in kept(wid)})]
    check("a staff member recon.settings lists saves a threshold: final, the value written",
          env.get("status") == 200 and final(env) and
          any("value" in cells and json.loads(cells["value"]).get("smartRunDays") == 3 for _r, _k, cells in got),
          (env, got))
    code, env = read("reconConfigGet", STAFF, {})
    check("and reads the thresholds", env.get("status") == 200, env)
    code, env = read("reconRuns", STAFF, {})
    check("one recon.review lists reads the runs as its writers do", env.get("status") == 200, env)
    code, env = read("reconErrorsList", STAFF, {})
    check("and the error rows through the generic verbs", env.get("status") == 200, env.get("message"))
    code, env, _ = write("reconErrorsUpdate", STAFF, {"id": gsjs.str_(ERR.get("id")), "status": "Excused"})
    check("but writes them only through reconErrorResolve, never the generic verbs",
          env == {"status": 403, "message": R.WRITERS_ONLY}, env)
    code, env = read("reconRunPrepare", STAFF, {})
    check("but a run stays the admins' and the managers'", env == {"status": 403, "message": R.WRITERS_ONLY}, env)
    EDITIONS["value"], HOLDER["id"] = "[]", ""


SERVICE = {"is_service": True}
OLD_RUN_TOTAL = 1094


def live(sql, params=()):
    """What the check's own transaction sees now (every row it wrote, nothing committed)."""
    with real.cursor() as c:
        c.execute(sql, params)
        return c.fetchall()


def live_errors_in(a, b):
    return live("select row_key, cells->>'runId', cells->>'status', cells->>'key', cells from app.resource_rows"
                " where resource = 'reconErrors' and removed_at is null and left(cells->>'date', 10) between %s and %s",
                (a, b))


def run_doors():
    today = PP.today_ny()
    cur = PP.period(today, today)
    code, env = read("reconRunPrepare", MASTER, {})
    d = env.get("data") or {}
    run = d.get("run") or {}
    check("no dates: the run prepared over the current pay period, from PsiAnywhere, sealed",
          env.get("status") == 200 and (run.get("dateFrom"), run.get("dateTo")) == (cur["from"], cur["to"])
          and run.get("source") == "psi" and run.get("period") == cur["label"] and isinstance(d.get("seal"), str),
          env.get("message") or run)
    as_of = datetime.fromisoformat(run.get("asOf") or "1970-01-01T00:00:00+00:00")
    at = D.now_minute(as_of)
    early = []
    for e in d.get("errors") or []:
        a, b = D.parse_time_min(e.get("startTime")), D.parse_time_min(e.get("endTime"))
        if e.get("type") == "missing":
            over = D.minute_of(e.get("date"), D.overnight(a, b))
            if over is None or at - over < D.SETTLE_MIN:
                early.append(e)
        elif e.get("type") == "noEnd":
            began = D.minute_of(e.get("date"), a)
            if began is None or at - began < D.ON_CLOCK_MIN:
                early.append(e)
    check("judged as of the record's last change, never past now: no shift still to end (or under an hour over) is "
          "missing, nobody still on the clock lacks an end",
          run.get("asOf") and early == [] and as_of <= datetime.now(timezone.utc),
          [(e["type"], e["date"], e["startTime"]) for e in early[:5]] or run.get("asOf"))
    today_iso = today.isoformat()
    facts["the current period's run (as of " + (run.get("asOf") or "?") + ")"] = (
        ", ".join(f"{k} {run.get(k)}" for k in R.TYPES) + f"; dated today: "
        + ", ".join(f"{k} {sum(1 for e in d.get('errors') or [] if e['type'] == k and e['date'] == today_iso)}"
                    for k in R.TYPES))
    for payload, why in (({"dateFrom": "2026-08-02", "dateTo": "2026-10-23"}, "over 35 days"),
                         ({"dateFrom": "2026-10-11"}, "one end alone"),
                         ({"dateFrom": "2026-10-24", "dateTo": "2026-10-11"}, "backwards"),
                         ({"dateFrom": "2026-08-20", "dateTo": "2026-09-05"}, "no PsiAnywhere entry")):
        code, env = read("reconRunPrepare", MASTER, payload)
        check(f"a range {why} is refused in plain words", env.get("status") == 400 and env.get("message"), env)
    code, env = read("reconRunPrepare", MASTER, {"dateFrom": "2026-08-20", "dateTo": "2026-09-05"})
    check("and the empty one says so", "PsiAnywhere has no entries on file for 2026-08-20–2026-09-05 yet."
          == env.get("message"), env)
    a, b = "2026-10-11", "2026-10-24"
    code, env = read("reconRunPrepare", MASTER, {"dateFrom": a, "dateTo": b})
    first = env.get("data") or {}
    run = first.get("run") or {}
    facts["the run over P2026-10-11 (the old run found 1,094)"] = ", ".join(
        f"{k} {run.get(k)}" for k in R.TYPES) + f", total {run.get('total')}, suppressed {run.get('suppressed')}"
    check("P2026-10-11 from PsiAnywhere finds far fewer than the 1,094 the workbook's run found",
          env.get("status") == 200 and 0 < run.get("total", 0) < OLD_RUN_TOTAL / 2 and run.get("period") ==
          "10/11/26 – 10/24/26", env.get("message") or run)
    check("one dupe card per cluster: never two cards for one person's day",
          len({(e["date"], e["employeeId"] or e["employeeName"]) for e in first.get("errors") or []
               if e["type"] == "dupe"}) == run.get("dupe"), run.get("dupe"))
    before_in = live_errors_in(a, b)
    before_out = live("select count(*) from app.resource_rows where resource = 'reconErrors' and removed_at is null"
                      " and left(cells->>'date', 10) not between %s and %s", (a, b))[0][0]
    resolved_before = {r[3] or R.anomaly_key(r[4]) for r in before_in if r[2] != "Open"}
    expect_carried = sum(1 for e in first.get("errors") or [] if R.anomaly_key(e) in resolved_before)
    code, env, wid = write("reconRun", MASTER, {"prepared": first})
    got = env.get("data") or {}
    rid = got.get("runId")
    check("the run is stored: final, its counts, the earlier rows of its days superseded, what was resolved carried",
          env.get("status") == 200 and final(env) and got.get("counts", {}).get("missing") == run.get("missing")
          and got.get("superseded", {}).get("errors") == len(before_in) and got.get("carried") == expect_carried,
          (env, expect_carried))
    now_in = live_errors_in(a, b)
    check("only the new run's errors are live on its days, each with its anomaly key",
          len(now_in) == run.get("total") and all(r[1] == rid and r[3] for r in now_in),
          (len(now_in), run.get("total")))
    after_out = live("select count(*) from app.resource_rows where resource = 'reconErrors' and removed_at is null"
                     " and left(cells->>'date', 10) not between %s and %s", (a, b))[0][0]
    check("rows outside its days are untouched", after_out == before_out, (before_out, after_out))
    gone = live("select count(*), count(*) filter (where removed_by = %s) from app.resource_rows"
                " where resource = 'reconErrors' and row_key = any(%s)",
                (f"superseded by run {rid}", [r[0] for r in before_in]))[0]
    logged = live("select count(*) from app.resource_changes where resource = 'reconErrors' and kind = 'delete'"
                  " and row_key = any(%s)", ([r[0] for r in before_in],))[0][0]
    check("each superseded row is marked 'superseded by run <id>' and logged, so a void brings it back",
          gone == (len(before_in), len(before_in)) and logged >= len(before_in), (gone, logged, len(before_in)))
    row = live("select cells from app.resource_rows where resource = 'reconRuns' and row_key = %s", (rid,))
    cells = row[0][0] if row else {}
    check("the run row says its source and how many resolutions it carried",
          cells.get("source") == "psi" and cells.get("carried") == str(expect_carried) and cells.get("dateFrom") == a,
          cells)
    keys1 = [r[3] for r in now_in]
    once = {k for k in keys1 if keys1.count(k) == 1}
    id1 = {r[3]: r[4].get("id") for r in now_in if r[3] in once}
    target = next((r for r in now_in if r[2] == "Open" and r[3] in once), None)
    code, env, _ = write("reconErrorResolve", MASTER, {"errorId": target[4].get("id"), "status": "Verified",
                                                       "note": "Check carry"})
    check("one of its errors resolved", env.get("status") == 200, env)
    told = next((r for r in now_in if r[3] in once and r[3] != target[3]
                 and r[4].get("type") in ("missing", "noEnd")), None)
    if told:
        live("update app.resource_rows set cells = cells || %s::jsonb where resource = 'reconErrors' and row_key = %s"
             " returning row_key", (json.dumps({"reminderQueuedAt": "2026-10-29T12:00:00.000Z",
                                                "reminderQueuedBy": "asa-hub:check", "reminderPhone": "0000"}),
                                    told[0]))
    code, env = read("reconRunPrepare", MASTER, {"dateFrom": a, "dateTo": b})
    code, env, _ = write("reconRun", MASTER, {"prepared": env.get("data")})
    again = env.get("data") or {}
    rid2 = again.get("runId")
    now2 = live_errors_in(a, b)
    carried = [r for r in now2 if r[3] == target[3]]
    check("the next run of the same days carries the resolution of the same anomaly",
          env.get("status") == 200 and again.get("carried") >= 1 and len(carried) == 1 and carried[0][1] == rid2
          and carried[0][2] == "Verified" and carried[0][4].get("note") == "Check carry"
          and carried[0][4].get("resolvedBy", "").startswith("asa-hub:"), (again, carried and carried[0][:4]))
    id2 = {r[3]: r[4].get("id") for r in now2 if r[3] in once}
    check("an anomaly still there goes on under its id", id1 and all(id2.get(k) == v for k, v in id1.items()),
          sum(1 for k, v in id1.items() if id2.get(k) != v))
    sent = [r[4] for r in now2 if told and r[3] == told[3]]
    check("a queued reminder is carried whatever the status, under the id Smart Comms keyed it by",
          told is not None and len(sent) == 1 and sent[0].get("reminderQueuedAt") == "2026-10-29T12:00:00.000Z"
          and sent[0].get("reminderPhone") == "0000" and sent[0].get("id") == told[4].get("id"), told and sent)
    old_run = live("select removed_by from app.resource_rows where resource = 'reconRuns' and row_key = %s", (rid,))
    check("and supersedes the earlier run lying inside its days",
          old_run and old_run[0][0] == f"superseded by run {rid2}", old_run)
    runs_live = {k for (k,) in live("select row_key from app.resource_rows where resource = 'reconRuns'"
                                     " and removed_at is null")}
    check("which is no longer among the live runs; the earlier, wider runs stay", rid not in runs_live and
          rid2 in runs_live and RUN_ID in runs_live, (rid in runs_live, rid2 in runs_live))


def auto_doors():
    base_last = R.last_auto
    R.last_auto = lambda reads: None
    try:
        code, env = read("reconAutoSweep", SERVICE, {})
    finally:
        R.last_auto = base_last
    d = env.get("data") or {}
    today = PP.today_ny()
    ids = [p["id"] for p in R.auto_periods(today)]
    check("the daily run is prepared over the previous and the current pay period, nothing imported",
          env.get("status") == 200 and d.get("due") is True and [r.get("period") for r in d.get("runs") or []] == ids
          and "import" not in d, env.get("message") or sorted(d))
    code, env = read("reconAutoSweep", MASTER, {})
    check("the sweep is the relay's own", env.get("status") == 403, env)
    live("update app.recon_auto set ran_at = now() - interval '2 days' where id = 1 returning id")
    code, env, _ = write("reconAutoRecord", SERVICE, {"prepared": d})
    got = env.get("data") or {}
    said = got.get("said") or ""
    check("its record stores each period's run and says what each found",
          env.get("status") == 200 and re.fullmatch(
              r"P\d{4}-\d\d-\d\d: (\d+ error\(s\)|refused: .+); P\d{4}-\d\d-\d\d: (\d+ error\(s\)|refused: .+)", said)
          and said.startswith(ids[0] + ":") and ("; " + ids[1] + ":") in said, env)
    facts["the daily run (in the rolled-back transaction)"] = re.sub(r"refused: .*", "refused", said)
    mark = live("select said, ran_at > now() - interval '1 minute' from app.recon_auto where id = 1")
    check("and stamps the mark with it", mark and mark[0][0] == said and mark[0][1], mark)
    code, env, _ = write("reconAutoRecord", SERVICE, {"prepared": d})
    check("a second record the same day stores nothing", (env.get("data") or {}).get("due") is False, env)


try:
    with real.transaction():
        store.ensure()
        check("the edit store is made in temp tables", store.ready(), store.why)
        for name, fn in (("reads", reads_doors), ("writes", write_doors), ("editions", edition_doors),
                         ("runs", run_doors), ("auto", auto_doors)):
            if staff and RUN and ERR:
                try:
                    with real.transaction():
                        fn()
                except Exception as exc:  # noqa: BLE001 - said as a failed check
                    check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300])
        with real.cursor() as c:
            c.execute("select count(*), count(distinct write_id) from pg_temp.hub_edits_rcn")
            n, w = c.fetchone()
        facts["cells kept in the check's app.edits (temp)"] = f"{n} cells from {w} writes"
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
    import shutil
    shutil.rmtree(WORK, ignore_errors=True)
print(json.dumps({"checks": out, "facts": facts}))
'''


def main() -> int:
    for name in ("recon.py", "recon_writes.py", "recon_detect.py", "recon_roster.py", "recon_report.py",
                 "recon_psi.py", "recon_gate.py", "recon_lanes.py", "psi_periods.py", "resource_rows.py", "main.py",
                 "editions.py", "sheet_resources.py", "generic_rows.py"):
        py_compile.compile(str(ROOT / "app" / name), doraise=True)
    py_compile.compile(str(ROOT / "server" / "snapshot_service.py"), doraise=True)
    py_compile.compile(str(ROOT / "server" / "edit_overlay.py"), doraise=True)
    print("ok   the Time Reconciliation modules, main, the catalogue and the relay compile")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    app.update({"@" + p.name: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.json")})
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
