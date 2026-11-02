#!/usr/bin/env python3
"""Scheduling's editions decided by the streamed modules on real houses in asa-hub-db-sync: the master allowed, a
person not listed refused, a listed person allowed with the edition stamped on every app.edits row, a stale witness
409, the directors kept the master's, somebody new to a house (once a hand-off to Apps Script) decided in Python for an
edition alone and for the master.
The editions value, the catalogue rows and App Control's release are simulated in-process. Nothing real is written: the
edit store lives in temp tables of one session that ends with the check, a statement writing or locking a live app.*
table is refused before it is sent, and a write's system-log line is kept nowhere. Prints shapes, counts and app.edits rows with
every personal value withheld."""
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
import gsjs, hubdb, scope as sc, locations as L, writes as W
import scheduling as SCH, scheduling_writes as SW, scheduling_builder as SB
import staff_views
import main as M

# a write's system-log line goes on the Staff store's own connection, outside the check's session: kept nowhere here
staff_views.bind(None)
out, facts, dumped = [], {}, []


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


# the integrator's catalogue rows (scope.EDITIONS), simulated in-process
sc.EDITIONS = tuple(sc.EDITIONS) + tuple((e, "scheduling") for e in SCH.EDITIONS if e not in {x for x, _a in sc.EDITIONS})
W.EDITS_TABLE = "pg_temp.hub_edits_check"
W.LOCK_KEY = 0x5343454448434B


LIVE_WRITE = re.compile(r"\b(insert\s+into|update|delete\s+from|merge\s+into|truncate|alter\s+table|drop\s+table|"
                        r"create\s+(unique\s+)?(table|index)(\s+if\s+not\s+exists)?(\s+\w+\s+on)?)\s+app\.", re.I)


def rw(sql):
    """The check's own tables for the store's; a statement that would write or lock a live app.* table is refused
    before it is sent (each block of this check commits its session's work)."""
    if not isinstance(sql, str):
        return sql
    sql = sql.replace("app.scheduling_", "pg_temp.scheduling_")
    if LIVE_WRITE.search(sql) or (re.search(r"\bfor\s+(no\s+key\s+)?update\b", sql, re.I) and re.search(r"\bapp\.", sql)):
        raise RuntimeError("the check refuses a write to a live table: " + " ".join(sql.split())[:90])
    return sql


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
db.stale = lambda books: False
EDITIONS = {"value": "[]"}
base_cfg = db.hiring_config
db.hiring_config = lambda: {**base_cfg(), sc.EDITIONS_KEY: EDITIONS["value"]}
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="scheduling-editions-check")
store = W.Store(connect=lambda: Conn(real), kind="scheduling", label="Scheduling")
off = W.Store(dsn="")
M.DB = db
M.STORE = M.CLIENT_STORE = M.STAFF_STORE = M.SSA_STORE = M.FAMILY_STORE = off
M.SCHEDULING_STORE = store
M.WRITE_BUDGET_S = 120.0
APP, DOORS = M.APPS["scheduling"], M.WRITES["scheduling"]
OPEN = set()
base_gate = sc.profile_app_gate


def gate(app_id, user, src):
    # App Control's release of Scheduling and its screens, simulated for the two check accounts
    if user and not user.get("is_service") and gsjs.str_(user.get("id")) in OPEN and app_id.startswith("scheduling"):
        return {"open": True, "scope": sc.scope_of("all")}
    return base_gate(app_id, user, src)


sc.profile_app_gate = gate
seq = [0]


def listed(*eids, on=True):
    EDITIONS["value"] = json.dumps([{"id": e, "on": on, "people": [HOLD["uid"]]} for e in eids])


def read(action, who, payload):
    res = M._run(APP, action, who, payload)
    return res.status_code, json.loads(res.body)


def write(action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-sed-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    res = M._run_write(DOORS, action, who, payload, wid)
    return res.status_code, json.loads(res.body), wid


SAFE = {"text", "kind", "start_min", "end_min", "hours", "token", "state", "base", "flow_id", "source", "note", "via",
        "was", "now", "date", "house_code", "period_id", "value", "key", "rev", "first", "last", "undone_at", "color",
        "row_kind", "active", "order", "updated_at", "at", "approved_at", "published_at"}


def shown(field, value):
    if field in SAFE:
        return re.sub(r"^seed:.+$", "seed:<book>", value or "")
    if field == "row_id":
        return re.sub(r"^P:.+$", "P:<key>", value or "")
    return f"<withheld:{len(value or '')}>"


def rows_of(wid, label):
    with real.cursor() as c:
        c.execute("select tab_name, kind, match_by, row_key, field, value, before, edition"
                  " from pg_temp.hub_edits_check where write_id = %s order by id", (wid,))
        got = c.fetchall()
    dumped.append({"write": label, "rows": [{"tab": t, "kind": k, "match": m, "row_key": re.sub(r"^P:.+$", "P:<key>", rk or ""),
                                             "field": f, "value": shown(f, v), "before": shown(f, b), "edition": e}
                                            for t, k, m, rk, f, v, b, e in got]})
    return got


def said(env):
    return re.sub(r"[A-Z][\w'’.-]*", "X", str(env.get("message") or ""))[:140]


def final_of(env):
    return (env.get("_write") or {}).get("final") is True


def engine_of(env):
    return (env.get("_write") or {}).get("engine") is True


def guarded(name, fn):
    try:
        with real.transaction():
            fn()
    except Exception as exc:  # noqa: BLE001 - said as a failed check, never a value
        import traceback
        check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:200] + " @ " +
              traceback.format_exc().strip().splitlines()[-3][:160])


reads0 = L.Reads(db, None)
users = reads0.users()
live_users = [u for u in users if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))
              and gsjs.str_(u.get("active")).lower() not in ("false", "0", "no")]
master = next((u for u in live_users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")), "role": "admin", "is_master": True}
rows0 = SCH.read_tab(reads0, "sched_rows")
cells0 = SCH.read_tab(reads0, "sched_cells")
dirs = {d["uid"] for d in SCH.settings(reads0)["directors"]}
hm_keys = {r["person_key"] for r in rows0 if r["designation"] == "**" and r["active"] != "no"}
plain = [u for u in live_users if gsjs.str_(u.get("role")).lower() == "staff" and not gsjs.str_(u.get("clientkey"))
         and gsjs.str_(u.get("userid")) not in dirs and SCH.name_fold(u.get("displayname")) not in hm_keys
         and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT]
check("the master and two plain staff accounts (no director, no house manager) are read from the users tab",
      bool(master) and len(plain) >= 2)
HOLD = {"uid": gsjs.str_(plain[0].get("userid")), "role": "staff", "is_master": False}
OTHER = {"uid": gsjs.str_(plain[1].get("userid")), "role": "staff", "is_master": False}
OPEN.update({HOLD["uid"], OTHER["uid"]})
TODAY = reads0.today()
period = SCH.current_period(reads0)
houses_all = [h["code"] for h in SCH.house_list(reads0)]
facts["houses on the board"] = str(len(houses_all))


def cell_subject(house):
    """A person's own timed shift still to come at the house: plain, nothing waiting on it, no clash."""
    by_row = {r["row_id"]: r for r in rows0 if r["house_code"] == house and r["row_kind"] == "person"
              and r["active"] != "no" and r["person_key"]}
    for c in sorted(cells0, key=lambda c: c["date"]):
        r = by_row.get(c["row_id"])
        k = SCH.classify(c["text"])
        if c["house_code"] != house or not r or not (TODAY < c["date"] <= period["last"]) or not k or k.start is None:
            continue
        if (c["state"] or "scheduled") != "scheduled" or c["flow_id"] or SW.cell_busy(reads0, house, c["row_id"], c["date"]):
            continue
        span = SCH.value_span(k, c["text"])
        if SCH.clash(reads0, r["person_key"], c["date"], span[0], span[1], ignore=(c["id"],), house_code=house, value=c["text"]):
            continue
        return {"house": house, "row_id": c["row_id"], "date": c["date"], "text": c["text"]}
    return None


subjects = []
for h in sorted(houses_all, key=lambda h: -sum(1 for r in rows0 if r["house_code"] == h and r["row_kind"] == "person")):
    s = cell_subject(h)
    if s:
        subjects.append(s)
    if len(subjects) == 2:
        break
check("two real houses each give a plain shift still to come (the subjects)", len(subjects) == 2, len(subjects))


def calendar(n, s):
    base = {"house": s["house"], "row_id": s["row_id"], "date": s["date"], "value": s["text"], "via": "edit",
            "note": "edition check"}
    EDITIONS["value"] = "[]"
    code, env, wid = write("schedulingCellSave", OTHER, {**base, "seen": s["text"]})
    check(f"subject {n}: a person not listed is refused (403, the editors' words), nothing kept",
          env.get("status") == 403 and env.get("message") == SCH.EDITORS_ONLY and not rows_of(wid, f"s{n} not listed"),
          [env.get("status"), said(env)])
    code, env, wid = write("schedulingCellSave", MASTER, {**base, "seen": s["text"]})
    got = rows_of(wid, f"s{n} master")
    check(f"subject {n}: the master is allowed, final, kept with no edition",
          env.get("status") == 200 and final_of(env) and got and all(not r[7] for r in got), [env.get("status"), said(env)])
    listed(SCH.CALENDAR_EDITION)
    if n == 1:
        boards = [read("schedulingBoard", w, {})[1] for w in (MASTER, OTHER)]
        check("the master's board and a person's not listed name no edition (Apps Script's board, word for word)",
              all(b.get("status") == 200 and "editions" not in ((b.get("data") or {}).get("viewer") or {}) for b in boards))
    code, env = read("schedulingBoard", HOLD, {})
    v = (env.get("data") or {}).get("viewer") or {}
    log = (env.get("data") or {}).get("log") or {}
    check(f"subject {n}: the listed person's board names the edition, no house as its own editor, every house's log",
          env.get("status") == 200 and v.get("editions") == [SCH.CALENDAR_EDITION] and v.get("editor_of") == []
          and set(log) >= set(houses_all) and v.get("can_edit_any") is False, [env.get("status"), v.get("editions")])
    code, env, wid = write("schedulingCellSave", HOLD, {**base, "seen": s["text"] + " x"})
    check(f"subject {n}: a stale witness is refused 409, nothing kept",
          env.get("status") == 409 and not rows_of(wid, f"s{n} stale"), [env.get("status"), said(env)])
    code, env, wid = write("schedulingCellSave", HOLD, {**base, "seen": s["text"], "note": "edition check, listed"})
    got = rows_of(wid, f"s{n} listed")
    check(f"subject {n}: the listed person is allowed, final, every row kept under the calendar edition",
          env.get("status") == 200 and final_of(env) and got and all(r[7] == SCH.CALENDAR_EDITION for r in got),
          [env.get("status"), said(env)])
    listed(SCH.CALENDAR_EDITION, on=False)
    code, env, wid = write("schedulingCellSave", HOLD, {**base, "seen": s["text"]})
    check(f"subject {n}: the same person with the edition's key off is refused 403",
          env.get("status") == 403 and not rows_of(wid, f"s{n} key off"), [env.get("status"), said(env)])
    EDITIONS["value"] = "[]"


def settings_doors():
    now = str(SCH.settings(reads0)["min_days_ahead"])
    EDITIONS["value"] = "[]"
    code, env, wid = write("schedulingSettingsSet", HOLD, {"values": {"min_days_ahead": now}})
    check("settings: a person not listed is refused 403", env.get("status") == 403 and not rows_of(wid, "settings not listed"))
    listed(SCH.SETTINGS_EDITION)
    code, env, wid = write("schedulingSettingsSet", HOLD, {"values": {"directors": "someone@example.org"}})
    check("settings: the directors stay the master's (403), nothing kept",
          env.get("status") == 403 and env.get("message") == SW.DIRECTORS_MASTER and not rows_of(wid, "settings directors"))
    code, env, wid = write("schedulingSettingsSet", HOLD, {"values": {"min_days_ahead": now}, "seen": {"min_days_ahead": now + "9"}})
    check("settings: a stale witness is refused 409", env.get("status") == 409 and not rows_of(wid, "settings stale"))
    code, env, wid = write("schedulingSettingsSet", HOLD, {"values": {"min_days_ahead": now}, "seen": {"min_days_ahead": now}})
    got = rows_of(wid, "settings listed")
    check("settings: the listed person is allowed, final, kept under the settings edition",
          env.get("status") == 200 and final_of(env) and got and all(r[7] == SCH.SETTINGS_EDITION for r in got),
          [env.get("status"), said(env)])
    EDITIONS["value"] = "[]"
    code, env, wid = write("schedulingSettingsSet", MASTER, {"values": {"min_days_ahead": now}})
    got = rows_of(wid, "settings master")
    check("settings: the master is allowed, kept with no edition", env.get("status") == 200 and final_of(env)
          and all(not r[7] for r in got))


def handoff():
    """Somebody placed at a house whose roster lacks them (once Apps Script's, for the IST training): decided in Python
    for the master and for an edition alone, a training opened when they lack the house's IST."""
    on_rows = {}
    for r in rows0:
        if r["row_kind"] == "person" and r["active"] != "no" and r["person_key"]:
            on_rows.setdefault(r["person_key"], (r["name"], set()))[1].add(r["house_code"])
    days = [d for d in SCH.dates(TODAY, period["last"]) if d > TODAY]
    picks = []
    for key, (name, at) in sorted(on_rows.items()):
        h = next((h for h in houses_all if h not in at and all(p["house"] != h for p in picks)), None)
        if not h:
            continue
        for d in days:
            if SCH.clash(reads0, key, d, 540, 1020, house_code=h, value="9A-5P") or SCH.prefs_against(reads0, key, name, h, d):
                continue
            if SW.cell_at(reads0, h, "P:" + key, d):
                continue
            picks.append({"house": h, "person": name, "date": d, "value": "9A-5P", "via": "add"})
            break
        if len(picks) == 2:
            break
    check("two people, each with a day free at a house whose roster lacks them", len(picks) == 2, len(picks))
    if len(picks) < 2:
        return

    def placed(env, got, edition):
        tr = (env.get("data") or {}).get("training") or {}
        return (env.get("status") == 200 and final_of(env) and not engine_of(env) and bool(got)
                and all((r[7] or "") == edition for r in got)
                and (not tr or any(r[3] == tr.get("flow_id") for r in got)))

    listed(SCH.CALENDAR_EDITION)
    code, env, wid = write("schedulingCellSave", HOLD, picks[0])
    got = rows_of(wid, "new to the house · edition")
    facts["new to the house, the listed person's"] = "a training opened" if (env.get("data") or {}).get("training") \
        else "a plain placement (the IST is on file)"
    check("new to the house: an edition alone is decided in Python, final, every row under the calendar edition (a "
          "training's flow among them when the IST is lacking), nothing carried to Apps Script",
          placed(env, got, SCH.CALENDAR_EDITION), [env.get("status"), said(env), env.get("_write")])
    EDITIONS["value"] = "[]"
    code, env, wid = write("schedulingCellSave", MASTER, picks[1])
    got = rows_of(wid, "new to the house · master")
    facts["new to the house, the master's"] = "a training opened" if (env.get("data") or {}).get("training") \
        else "a plain placement (the IST is on file)"
    check("new to the house: the master's is decided in Python, final, kept with no edition, nothing carried to Apps "
          "Script", placed(env, got, ""), [env.get("status"), said(env), env.get("_write")])


def builder():
    EDITIONS["value"] = "[]"
    code, env = read("schedulingBuilderRead", OTHER, {})
    # the stand-in row opens every scheduling id with the whole view: the badge builds every house, no list needed
    hs = [h["code"] for h in (env.get("data") or {}).get("houses") or []]
    check("Builder: a badge the Builder's row opens over every house builds every house, listed or not",
          env.get("status") == 200 and set(hs) == set(houses_all), [env.get("status"), hs])
    listed(SCH.BUILDER_EDITION)
    code, env = read("schedulingBuilderRead", HOLD, {})
    hs = [h["code"] for h in (env.get("data") or {}).get("houses") or []]
    check("Builder: the listed person builds every house", env.get("status") == 200 and set(hs) == set(houses_all),
          [env.get("status"), len(hs)])
    last = SCH.settings(reads0)["periods"][-1]["last"]
    first = SCH.iso_add(last, 200)
    while SCH.dow(first) != 1:
        first = SCH.iso_add(first, 1)
    p = {"house": subjects[0]["house"], "first": first, "last": SCH.iso_add(first, 27),
         "draft": {"rows": [], "cells": {}, "open": {}}, "state": "pattern", "rev": "0"}
    code, env, wid = write("schedulingBuilderSave", HOLD, p)
    got = rows_of(wid, "builder listed")
    check("Builder: the listed person's draft is kept final under the Builder edition",
          env.get("status") == 200 and final_of(env) and got and all(r[7] == SCH.BUILDER_EDITION for r in got),
          [env.get("status"), said(env)])
    EDITIONS["value"] = "[]"


with real.transaction():
    store.ensure()
check("the edit store is made in temp tables", store.ready(), store.why)
for n, s in enumerate(subjects, 1):
    guarded(f"subject {n}", lambda n=n, s=s: calendar(n, s))
guarded("settings", settings_doors)
guarded("hand-off", handoff)
if subjects:
    guarded("builder", builder)
with real.cursor() as c:
    c.execute("select count(*), count(distinct write_id) from pg_temp.hub_edits_check")
    n, w = c.fetchone()
facts["cells kept in the check's app.edits (temp)"] = f"{n} cells from {w} writes"
real.close()
print(json.dumps({"checks": out, "facts": facts, "rows": dumped}))
'''


def main() -> int:
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    app["redaction"] = (ROOT / "server" / "redaction.py").read_text(encoding="utf-8")
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps({"app": app}).encode()) + b"\n", capture_output=True,
                         timeout=1500)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print("FAIL the driver ran in asa-hub-db-sync")
        print(got.stderr.decode()[-1500:])
        return 1
    res = json.loads(lines[-1])
    failed = 0
    for name, ok, detail in res["checks"]:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok or not detail else f"\n       {detail}"))
        failed += 0 if ok else 1
    for k, v in res["facts"].items():
        print(f"  fact {k}: {v}")
    if "--rows" in sys.argv:
        for w in res["rows"]:
            if not w["rows"]:
                continue
            print(f"  app.edits — {w['write']}:")
            for r in w["rows"]:
                print("    " + json.dumps(r, ensure_ascii=False))
    print(f"{len(res['checks']) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
