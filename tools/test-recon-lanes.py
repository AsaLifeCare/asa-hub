#!/usr/bin/env python3
"""
TIME RECONCILIATION'S LANES (/hub-lanes/time-recon/periods and /queue), driven through app/recon_lanes.py's own lane
with stand-in requests and sessions, then read once, read-only, off the live record.

  the gate     no session is a 401; a staff member nobody listed a 403 in the readers' words; the master, an admin
               or a manager, and one the Review edition names read
  the queue    the current pay period and open errors by default; from/to, house, employee (by people id, by recon's
               key, by name — an overlap's staff by the roster's names), type and status filter; the counts honour every
               filter but the type; place, day and clock order; the runs that touched the days, newest first; the days
               PsiAnywhere holds no entry for, up to today (never the days still to come); a range thirteen pay periods
               at most; a query it cannot answer a 400, a failure a 503 in plain words, never a traceback
  the periods  today, thirteen pay periods newest first, the houses, the people, the record's coverage, the daily
               run's last word
  live         one answer of each off asa-hub-db, read-only, printing counts only

The modules are streamed from this checkout into asa-hub-db-sync (FastAPI faked; nothing else is installed there). The
stand-in part reads nothing; the live part only reads.

    python3 tools/test-recon-lanes.py
"""
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
import asyncio, base64, importlib.abc, importlib.util, json, os, sys, tempfile, types
from datetime import datetime, timezone
SRC = json.loads(base64.b64decode(sys.stdin.readline()).decode())
WORK = tempfile.mkdtemp(prefix="recon-lanes-")
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


class Resp:
    def __init__(self, content=b"", status_code=200, media_type="", headers=None):
        self.body = content if isinstance(content, (bytes, str)) else json.dumps(content)
        self.status_code, self.headers = status_code, dict(headers or {})


class App:
    def __init__(self, *_a, **_kw):
        self.routes = {}

    def get(self, path, **_kw):
        def keep(fn):
            self.routes[path] = fn
            return fn
        return keep

    def __getattr__(self, _name):
        return lambda *_a, **_kw: (lambda fn: fn)


fake = types.ModuleType("fastapi")
fake.FastAPI, fake.Request, fake.Response, fake.Header = App, object, Resp, (lambda *_a, **_kw: None)
responses = types.ModuleType("fastapi.responses")
responses.JSONResponse = lambda content, status_code=200, headers=None: Resp(content, status_code, "", headers)
responses.Response = responses.StreamingResponse = Resp
conc = types.ModuleType("starlette.concurrency")


async def run_in_threadpool(fn, *a, **kw):
    return fn(*a, **kw)
conc.run_in_threadpool = run_in_threadpool
sys.modules.update({"fastapi": fake, "fastapi.responses": responses, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": conc})

import hubdb, locations as L
import recon as R
import recon_gate as RG
import recon_lanes as RL
import sched_lanes as SL

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


class Sess:
    def __init__(self, uid, master=False):
        self.uid, self.is_master, self.ok, self.role = uid, master, True, "staff"


class Req:
    def __init__(self, q=None):
        self.query_params, self.headers = dict(q or {}), {}


SESSION = {"s": None}


async def session_of(_request):
    return SESSION["s"]


SL._session = session_of
USERS = {"U-STAFF": {"id": "U-STAFF", "role": "staff"}, "U-MGR": {"id": "U-MGR", "role": "manager"},
         "U-ADMIN": {"id": "U-ADMIN", "role": "admin"}, "U-HOLDER": {"id": "U-HOLDER", "role": "staff"}}
base_user_of, base_holds = RG._user_of, R.edition_holds
RG._user_of = lambda reads, uid: USERS.get(uid)
R.edition_holds = lambda sess, eid: eid == R.EDITION["review"] and (sess.user or {}).get("id") == "U-HOLDER"


class StandReads:
    now = datetime(2026, 10, 29, 16, 0, tzinfo=timezone.utc)


def e(eid, kind, day, loc, who_id, who, start, status="Open", consumers=""):
    return {"id": eid, "runId": "r2", "type": kind, "date": day, "location": loc, "employeeId": who_id,
            "employeeName": who, "consumers": consumers, "startTime": start, "endTime": "", "hours": 1, "detail": "",
            "status": status, "note": "", "resolvedBy": "", "resolvedAt": ""}


ERRORS = [e("e1", "missing", "2026-10-26", "ABD1711", "P1", "Jane Doe", "8:00 AM"),
          e("e2", "noEnd", "2026-10-27", "ABD2005", "P1", "Jane Doe", "07:00:00 AM"),
          e("e3", "overlap", "2026-10-27", "ABD2005", "", "Jane Doe, Rick Roe", "9:00 AM", consumers="Smith Ann"),
          e("e4", "gap", "2026-10-28", "ABD2005", "", "Smith Ann (consumer)", "1:00 PM", consumers="Smith Ann"),
          e("e5", "dupe", "2026-10-26", "ABD1711", "P2", "Rick Roe", "8:00 AM", status="Verified"),
          e("e6", "missing", "2026-10-12", "ABD1711", "P2", "Rick Roe", "8:00 AM"),
          e("e7", "noEnd", "2026-10-28", "ABD1711", "", "Pat Unknown", "10:00:00 AM")]
RUNS = [{"id": "r1", "dateFrom": "2026-10-11", "dateTo": "2026-10-24", "createdAt": "2026-10-28T10:00:00Z",
         "total": "1", "source": "psi", "carried": "0", "status": "Review"},
        {"id": "r2", "dateFrom": "2026-10-25", "dateTo": "2026-11-07", "createdAt": "2026-10-29T10:00:00Z",
         "total": "6", "source": "psi", "carried": "2", "status": "Review"},
        {"id": "r0", "dateFrom": "2026-08-02", "dateTo": "2026-10-23", "createdAt": "2026-10-20T10:00:00Z",
         "total": "1094", "status": "Review"}]
STAND = {"live_errors": lambda reads: [dict(x) for x in ERRORS], "live_runs": lambda reads: [dict(x) for x in RUNS],
         "psi_days": lambda reads, a, b: {d for d in ("2026-10-25", "2026-10-26", "2026-10-28") if a <= d <= b},
         "ids_by_name": lambda reads: {"jane doe": "P1", "rick roe": "P2"},
         "houses": lambda reads: ["ABD1711", "ABD2005"],
         "psi_people": lambda reads, a, b: [{"key": "P1", "id": "P1", "name": "Jane Doe"}],
         "psi_coverage": lambda reads: {"psiFrom": "2026-06-07", "psiTo": "2026-10-29"},
         "last_auto": lambda reads: {"ranAt": "2026-10-29T06:02:22+00:00", "said": "P2026-10-11: 1 error(s)"}}
REAL = {k: getattr(RL, k) for k in STAND}


def ask(view, q=None, who=None, reads_of=StandReads):
    SESSION["s"] = who
    resp = asyncio.run(RL.lane(Req(q), reads_of, view))
    return json.loads(resp.body)


def stand_in():
    for k, fn in STAND.items():
        setattr(RL, k, fn)
    master = Sess("U-MASTER", master=True)
    env = ask(RL.queue_view)
    check("no session: 401, sign in first", env == {"status": 401, "reason": "session", "message": "sign in first"},
          env)
    env = ask(RL.queue_view, who=Sess("U-STAFF"))
    check("a staff member nobody listed: 403 in the readers' words",
          env.get("status") == 403 and env.get("message") == RG.READERS_ONLY, env)
    env = ask(RL.periods_view, who=Sess("U-STAFF"))
    check("the periods too", env.get("status") == 403, env)
    for uid, said in (("U-MGR", "a manager"), ("U-ADMIN", "an admin"), ("U-HOLDER", "one the Review edition names")):
        env = ask(RL.queue_view, who=Sess(uid))
        check(f"{said} reads the queue", env.get("status") == 200, env)
    env = ask(RL.queue_view, who=master)
    d = env.get("data") or {}
    check("the master reads it: the current pay period, open errors, its text",
          env.get("status") == 200 and (d.get("from"), d.get("to"), d.get("period")) ==
          ("2026-10-25", "2026-11-07", "10/25/26 – 11/07/26"), env)
    check("in place, day and clock order (the clock by its minutes)",
          [x["id"] for x in d.get("errors") or []] == ["e1", "e7", "e2", "e3", "e4"], [x["id"] for x in d.get("errors")
                                                                                      or []])
    check("each error with the contract's fields, its key worked out where the row has none",
          all(set(x) == set(RL.ERROR_FIELDS) for x in d.get("errors") or [])
          and (d.get("errors") or [{}])[0].get("key") == "missing|2026-10-26|ABD1711|P1|8:00 AM|",
          (d.get("errors") or [{}])[0])
    c = d.get("counts") or {}
    check("counts: the total, per type, per house most first",
          c.get("total") == 5 and c.get("byType") == {"missing": 1, "noEnd": 2, "dupe": 0, "gap": 1, "overlap": 1}
          and [(h["house"], h["total"]) for h in c.get("byHouse") or []] == [("ABD2005", 3), ("ABD1711", 2)]
          and (c.get("byHouse") or [{}])[0].get("byType") == {"missing": 0, "noEnd": 1, "dupe": 0, "gap": 1,
                                                              "overlap": 1}, c)
    check("per employee, most first: an overlap counts for each of its staff, a gap nobody covered for nobody",
          [(p["key"], p["total"]) for p in c.get("byEmployee") or []] ==
          [("P1", 3), ("name:pat unknown", 1), ("P2", 1)], c.get("byEmployee"))
    check("the runs that touched the days, newest first, their counts as numbers and a legacy one named so",
          [r["id"] for r in d.get("runs") or []] == ["r2"] and (d.get("runs") or [{}])[0].get("carried") == 2
          and set((d.get("runs") or [{}])[0]) == {"id", "dateFrom", "dateTo", "status", "createdAt", "createdBy",
                                                   "missing", "noEnd", "dupe", "gap", "overlap", "total", "carried",
                                                   "source"}, d.get("runs"))
    check("the days PsiAnywhere holds no entry for, up to today (10-30..11-07 still to come are not listed)",
          d.get("daysWithoutData") == ["2026-10-27", "2026-10-29"], d.get("daysWithoutData"))
    d = (ask(RL.queue_view, {"type": "noEnd"}, master).get("data") or {})
    check("type filters the errors, never the counts",
          [x["id"] for x in d.get("errors") or []] == ["e7", "e2"] and (d.get("counts") or {}).get("total") == 5, d)
    d = (ask(RL.queue_view, {"status": "resolved"}, master).get("data") or {})
    check("resolved: the errors whose status is not Open", [x["id"] for x in d.get("errors") or []] == ["e5"]
          and (d.get("counts") or {}).get("total") == 1, d)
    d = (ask(RL.queue_view, {"status": "all"}, master).get("data") or {})
    check("all: every live error of the days", len(d.get("errors") or []) == 6, d.get("counts"))
    d = (ask(RL.queue_view, {"house": "ABD2005"}, master).get("data") or {})
    check("house: its errors alone, and its counts", [x["id"] for x in d.get("errors") or []] == ["e2", "e3", "e4"]
          and [h["house"] for h in (d.get("counts") or {}).get("byHouse") or []] == ["ABD2005"], d)
    for want, ids, said in (("P1", ["e1", "e2", "e3"], "by people id, an overlap by the roster's name"),
                            ("P2", ["e3"], "the other overlap's staff member (resolved errors aside)"),
                            ("name:pat unknown", ["e7"], "by recon's key for an unresolved name"),
                            ("JANE DOE", ["e1", "e2", "e3"], "by name, any case")):
        d = (ask(RL.queue_view, {"employee": want}, master).get("data") or {})
        check(f"employee {said}", [x["id"] for x in d.get("errors") or []] == ids,
              [x["id"] for x in d.get("errors") or []])
    d = (ask(RL.queue_view, {"from": "2026-10-11", "to": "2026-10-24"}, master).get("data") or {})
    check("a past pay period: its errors, its text, every run that touched it",
          [x["id"] for x in d.get("errors") or []] == ["e6"] and d.get("period") == "10/11/26 – 10/24/26"
          and [r["id"] for r in d.get("runs") or []] == ["r1", "r0"]
          and (d.get("runs") or [{}, {}])[1].get("source") == RL.LEGACY_SOURCE, d)
    d = (ask(RL.queue_view, {"from": "2026-10-26", "to": "2026-10-27"}, master).get("data") or {})
    check("a range that is no pay period names none", d.get("period") == "" and len(d.get("errors") or []) == 3, d)
    for q, said in (({"from": "2026-10-11"}, "one end alone"),
                    ({"from": "2026-10-24", "to": "2026-10-11"}, "backwards"),
                    ({"from": "10/11/2026", "to": "2026-10-24"}, "not a day"),
                    ({"type": "late"}, "a type that is none"),
                    ({"status": "closed"}, "a status that is none"),
                    ({"from": "1900-01-01", "to": "2026-10-24"}, "a range past thirteen pay periods")):
        env = ask(RL.queue_view, q, master)
        check(f"{said}: 400 in plain words", env.get("status") == 400 and env.get("message"), env)
    env = ask(RL.queue_view, {"from": "1900-01-01", "to": "2026-10-24"}, master)
    check("the range refused says its limit and its length",
          env.get("message") == "The queue reads 182 days at most (thirteen pay periods): 1900-01-01–2026-10-24 is "
                                "46318 days.", env)
    d = (ask(RL.queue_view, {"from": "2026-05-10", "to": "2026-11-07"}, master).get("data") or {})
    check("the thirteen periods the picker offers are one range (182 days)",
          (d.get("from"), d.get("to")) == ("2026-05-10", "2026-11-07") and len(d.get("errors") or []) == 6, d)
    RL.live_errors = lambda reads: (_ for _ in ()).throw(RuntimeError("the database went away"))
    env = ask(RL.queue_view, None, master)
    check("a failure is a 503 in plain words, never a traceback",
          env.get("status") == 503 and "RuntimeError" in env.get("message", "") and "Traceback" not in json.dumps(env),
          env)
    RL.live_errors = STAND["live_errors"]
    d = (ask(RL.periods_view, None, master).get("data") or {})
    ps = d.get("periods") or []
    check("the periods: today, thirteen newest first (the current first), houses, people, coverage, the last run",
          d.get("today") == "2026-10-29" and len(ps) == 13 and ps[0]["id"] == "P2026-10-25" and ps[0]["current"]
          and set(ps[0]) == {"id", "from", "to", "label", "current", "weeks"} and d.get("houses") == ["ABD1711",
                                                                                                       "ABD2005"]
          and d.get("employees") == [{"key": "P1", "id": "P1", "name": "Jane Doe"}]
          and d.get("coverage") == {"psiFrom": "2026-06-07", "psiTo": "2026-10-29"}
          and (d.get("lastAuto") or {}).get("said"), d)
    app = App()
    RL.install(app, StandReads)
    check("install puts both lanes under /hub-lanes/time-recon",
          sorted(app.routes) == ["/hub-lanes/time-recon/periods", "/hub-lanes/time-recon/queue"], sorted(app.routes))
    for k, fn in REAL.items():
        setattr(RL, k, fn)


def live_read():
    RG._user_of, R.edition_holds = base_user_of, base_holds
    db = hubdb.HubDb()
    master = Sess("U-LIVE-MASTER", master=True)
    reads_of = lambda: L.Reads(db, None)
    env = ask(RL.periods_view, None, master, reads_of)
    d = env.get("data") or {}
    check("live periods: 200, thirteen periods, houses and people", env.get("status") == 200 and
          len(d.get("periods") or []) == 13 and d.get("houses") and d.get("employees"), env.get("message"))
    facts["periods"] = (f"{len(d.get('periods') or [])} periods from {(d.get('periods') or [{}])[-1].get('from')}, "
                        f"{len(d.get('houses') or [])} houses, {len(d.get('employees') or [])} people, "
                        f"record {(d.get('coverage') or {}).get('psiFrom')}..{(d.get('coverage') or {}).get('psiTo')}, "
                        f"last auto run {'on file' if d.get('lastAuto') else 'none'}")
    for label, q in (("current period", {}), ("P2026-10-11", {"from": "2026-10-11", "to": "2026-10-24"})):
        env = ask(RL.queue_view, q, master, reads_of)
        d = env.get("data") or {}
        c = d.get("counts") or {}
        check(f"live queue ({label}): 200, the counts add up", env.get("status") == 200 and
              c.get("total") == len(d.get("errors") or []) == sum((c.get("byType") or {}).values())
              == sum(h["total"] for h in c.get("byHouse") or []), env.get("message") or c)
        kinds = ", ".join(f"{k} {v}" for k, v in (c.get("byType") or {}).items())
        facts[f"queue {label}"] = (f"{c.get('total')} open errors ({kinds}) over {len(c.get('byHouse') or [])} "
                                   f"houses, {len(c.get('byEmployee') or [])} people, {len(d.get('runs') or [])} "
                                   f"runs, {len(d.get('daysWithoutData') or [])} days without data")


try:
    for name, fn in (("stand-in", stand_in), ("live", live_read)):
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - said as a failed check
            import traceback
            check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:200] + " " +
                  traceback.format_exc()[-600:])
finally:
    import shutil
    shutil.rmtree(WORK, ignore_errors=True)
print(json.dumps({"checks": out, "facts": facts}))
'''


def main() -> int:
    for name in ("recon_lanes.py", "recon_gate.py", "recon.py", "recon_psi.py", "psi_periods.py"):
        py_compile.compile(str(ROOT / "app" / name), doraise=True)
    print("ok   the lanes and what they read compile")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    app.update({"@" + p.name: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.json")})
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(app).encode()) + b"\n", capture_output=True, timeout=600)
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
