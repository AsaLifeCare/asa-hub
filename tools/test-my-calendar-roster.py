#!/usr/bin/env python3
"""My Calendar's roster names on Python (app/mw_roster.py and the names added to app/mw_shifts.py and app/mw_time_off.py)
against the relay's own modules over the same rows. The relay side runs in asa-hub-snapshot as one short read-only
process (DDL skipped, every connection read-only) and hands back its answers and its state tables in the form the relay
sends them; the Python side runs in asa-hub-db-sync with app/*.py streamed in. Prints counts and paths, never a
person's values."""
from __future__ import annotations

import ast
import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import lane_schema  # noqa: E402

RELAY = "asa-hub-snapshot"
DB_RUNNER = "asa-hub-db-sync"
RELAY_BUDGET_S = 240
SERVER_ROOTS = ("effective_roster", "house_cal_live", "house_directory", "shift_slices", "shift_requests", "time_off")

COMMON = r'''
import json
from datetime import date, datetime, timedelta, timezone

SW = {"on": {"on": True, "readable": True, "word": "on", "why": ""},
      "off": {"on": False, "readable": True, "word": "off", "why": ""}}
SAMPLE_TEXTS = ["7a-3p", "11p-7a", "230-10p", "3p-11p JH", "*7a-7p", "OFF", "off", "R/O", "C/O", "NCNS", "JH",
                "JH > 7a-3p", "7a-3p < 48TH", "12a-8a", "8a-12a", "10p-6a", "7:30a-3:30p", "730-330p", "", "  ",
                "NO WORKSHOP", "R/0", "R\\O", "6a-2p MS", "11a-11p"]


def iso(v):
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return v


def jsonable(v):
    if isinstance(v, (datetime, date)):
        return iso(v)
    if isinstance(v, dict):
        return {("\x1f".join(str(x) for x in k) if isinstance(k, tuple) else str(k)): jsonable(x) for k, x in v.items()}
    if isinstance(v, (set, frozenset)):
        return sorted((jsonable(x) for x in v), key=lambda x: json.dumps(x, sort_keys=True, default=str))
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    return v


def ser_est(v):
    def spans(m):
        return {k: [{**s, "span": [iso(s["span"][0]), iso(s["span"][1])]} for s in lst] for k, lst in m.items()}
    return {"locations": list(v["locations"]), "by_code": dict(v["by_code"]),
            "cells": {loc: [[e, i, t] for (e, i), t in cells.items()] for loc, cells in v["cells"].items()},
            "isos": v["isos"], "people": v["people"], "spans": spans(v["spans"]), "unreadable": spans(v["unreadable"]),
            "worked": sorted([[k, loc, sorted(d.isoformat() for d in days)] for (k, loc), days in v["worked"].items()]),
            "worked_since": {loc: iso(d) if d else None for loc, d in v["worked_since"].items()},
            "worked_why": v["worked_why"]}


def windows(on):
    mon = on - timedelta(days=on.weekday())
    sun = mon + timedelta(days=6)
    return mon, sun


# a made-up edits table: every branch of the pending, held, undone and rehearsal rules, no person's name
T0 = datetime(2026, 1, 5, 12, 0, tzinfo=timezone.utc)
L1, L2, L3 = "TST - AA - TST0001", "TST - BB - TST0002", "TST - CC - TST0003"
SYN_COLS = ("id", "location", "employee", "col_iso", "old_value", "new_value", "via", "actor", "at", "note", "stage",
            "act", "undone_at")


def _ago(s):
    return None if s is None else (T0 - timedelta(seconds=s)).isoformat()


SYN_EDITS = [[i, loc, emp, iso_, "", new, via, actor, _ago(at), "", stage, "", _ago(undone)]
             for i, loc, emp, iso_, new, via, actor, at, stage, undone in (
                 (1, L1, "Alpha One", "2026-01-05", "7a-3p", "builder", "a", 600, "published", None),
                 (2, L1, "Alpha One", "2026-01-05", "  3p-11p ", "builder", None, 60, "published", None),
                 (3, L1, "Bravo Two", "2026-01-06", "7a-3p", "builder", "a", 900, "published", None),
                 (4, L1, "Bravo Two", "2026-01-06", "11p-7a", "rehearsal:s1", "a", 800, "test_mode", None),
                 (5, L1, "Charlie Three", "2026-01-07", "OFF", "rehearsal:s1", "a", 700, "test_mode", None),
                 (6, L1, "Charlie Three", "2026-01-07", "7a-7p", "builder", "a", 650, "published", None),
                 (7, L1, "Delta Four", "2026-01-08", "7a-3p", "builder", "a", 30, "test_mode", 20),
                 (8, L2, "Echo Five", "2026-01-05", "7a-3p", "builder", "a", 500, "test_mode", None),
                 (9, L2, "Echo Five", "2026-01-05", "3p-11p", "rehearsal:s2", "a", 400, "test_mode", None),
                 (10, L2, "Fox Six", "2026-01-06", "7a-3p", "rehearsal:s2", "a", 500, "test_mode", None),
                 (11, L2, "Fox Six", "2026-01-06", "OFF", "builder", "a", 450, "published", 440),
                 (12, L2, "Fox Six", "2026-01-06", "3p-11p", "builder", "a", 430, "test_mode", None),
                 (13, L3, "Golf Seven", "2026-01-05", "7a-3p", "builder", "a", 10, "published", None),
                 (14, L2, "Hotel Eight", "2026-01-07", "7a-3p", "builder", "a", None, "published", None),
                 (15, L2, "OPEN", "2026-01-07", "", "builder", None, 5, "published", None),
                 (16, L1, "Alpha One", "2026-01-09", "7a-3p", None, None, 100, "published", None),
                 (17, L1, "India Nine", "2026-01-06", "draft", "builder", "a", 5, "draft", None))]
SYN_LIVE = [[L1, T0.isoformat()], [L2, T0.isoformat()]]
SYN_CASES = [("held", None, None, None, True), ("not held", None, None, None, False),
             ("window held", "2026-01-06", "2026-01-07", None, True), ("one house not held", None, None, L2, False)]
'''

RELAY_DRIVER = r'''
import base64, importlib.abc, importlib.util, json, os, re, signal, sys, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError("the relay side ran out of time")))
signal.alarm(blob["budget"])
SRC = blob["server"]
sys.path[:] = [p for p in sys.path if p not in ("", os.getcwd(), "/srv/app")]


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = "/srv/app/" + module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)


sys.meta_path.insert(0, Checkout())
import psycopg2, psycopg2.extensions as ext
_DDL = re.compile(r"^\s*(CREATE|ALTER|DROP|COMMENT)\b", re.I)
SKIPPED = {"ddl": 0}
# while set, the published-cells read sees the made-up tables (a WITH shadowing both), still read-only
SYN = {"with": None}
_guarded_classes = {}


def guarded(base):
    if base not in _guarded_classes:
        class Guarded(base):
            def execute(self, query, vars=None):
                q = query if isinstance(query, str) else str(query)
                if _DDL.match(q):
                    SKIPPED["ddl"] += 1
                    return None
                if SYN["with"] and "FROM asa_house_calendar_edits e " in q:
                    query = SYN["with"] + " " + q
                return super().execute(query, vars)
        _guarded_classes[base] = Guarded
    return _guarded_classes[base]


class ReadOnly(ext.connection):
    def cursor(self, *a, **kw):
        kw["cursor_factory"] = guarded(kw.get("cursor_factory") or self.cursor_factory or ext.cursor)
        return super().cursor(*a, **kw)


_real_connect = psycopg2.connect


def ro_connect(dsn=None, connection_factory=None, cursor_factory=None, **kw):
    opts = kw.pop("options", "") or ""
    kw["options"] = (opts + " " if opts else "") + "-c default_transaction_read_only=on"
    return _real_connect(dsn, connection_factory=ReadOnly, cursor_factory=cursor_factory, **kw)


psycopg2.connect = ro_connect
PG_DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
exec(blob["common"])
from zoneinfo import ZoneInfo
import effective_roster as ER, house_cal_live as HCL, house_directory as HD, shift_slices as SS
import shift_requests as SR, time_off as TO
from typing import Any

relay_ns = {"psycopg2": psycopg2, "PG_DSN": PG_DSN, "Any": Any, "os": os}
exec(compile(blob["relay_code"], "snapshot_service_state", "exec"), relay_ns)
state = relay_ns["_my_work_state_read"]()
conn = psycopg2.connect(PG_DSN, connect_timeout=5)
conn.autocommit = True
cur = conn.cursor()
cur.execute("SELECT * FROM asa_house_calendar_edits")
names = [d[0] for d in cur.description]
types_, rows_ = {}, []
for raw in cur.fetchall():
    row = list(raw)
    for i, v in enumerate(row):
        if isinstance(v, datetime):
            types_[names[i]], row[i] = "ts", v.isoformat()
        elif isinstance(v, date):
            types_[names[i]], row[i] = "date", v.isoformat()
    rows_.append(row)
state["tables"]["asa_house_calendar_edits"] = {"columns": names, "types": types_, "rows": rows_}

out = {"facts": {}}
on = datetime.now(ZoneInfo("America/New_York")).date()
mon, sun = windows(on)
out["on"] = on.isoformat()
cur.execute("SELECT location FROM asa_house_calendar_live ORDER BY location")
live_locs = [r[0] for r in cur.fetchall()]
edit_locs = sorted({r[names.index("location")] for r in rows_})
loc_pick = (edit_locs or live_locs or [None])[0]
cases = [("all held", None, None, None, True), ("all not held", None, None, None, False),
         ("week held", mon, sun, None, True), ("week not held", mon, sun, None, False),
         ("wide held", mon - timedelta(days=60), sun + timedelta(days=60), None, True),
         ("one house held", None, None, loc_pick, True)]
out["published"] = []
for name, lo, hi, loc, held in cases:
    out["published"].append({"name": name, "from": iso(lo), "to": iso(hi), "location": loc, "held": held,
                             "got": jsonable(ER.published(cur, lo, hi, location=loc, held=held))})
ev = ", ".join(["(%s::bigint, %s::text, %s::text, %s::text, %s::text, %s::text, %s::text, %s::text, "
                "%s::timestamptz, %s::text, %s::text, %s::text, %s::timestamptz)"] * len(SYN_EDITS))
lv = ", ".join(["(%s::text, %s::timestamptz)"] * len(SYN_LIVE))
SYN["with"] = cur.mogrify(f"WITH asa_house_calendar_edits({', '.join(SYN_COLS)}) AS (VALUES {ev}), "
                          f"asa_house_calendar_live(location, updated_at) AS (VALUES {lv})",
                          [x for r in SYN_EDITS for x in r] + [x for r in SYN_LIVE for x in r]).decode()
out["syn"], out["syn_mirror"] = [], {}
for name, lo, hi, loc, held in SYN_CASES:
    out["syn"].append(jsonable(ER.published(cur, date.fromisoformat(lo) if lo else None,
                                            date.fromisoformat(hi) if hi else None, location=loc, held=held)))
for sw in ("on", "off"):
    ER.use_switch(lambda sw=sw: dict(SW[sw]))
    out["syn_mirror"][sw] = jsonable(ER.on_mirror(cur))
SYN["with"] = None
out["on_mirror"], out["said"], out["estate"] = {}, {}, {}
for sw in ("on", "off"):
    ER.use_switch(lambda sw=sw: dict(SW[sw]))
    out["on_mirror"][sw] = jsonable(ER.on_mirror(cur))
    out["said"][sw] = ER.test_mode_said()
    SR.forget_estate()
    out["estate"][sw] = ser_est(SR.estate(PG_DSN, fresh=True))
ER.use_switch(lambda: dict(SW["on"]))
SR.forget_estate()
est = SR.estate(PG_DSN, fresh=True)
# pending cells laid on a real house: a changed cell, a new row held by test mode, an emptied cell
loc0 = next((loc for loc in est["locations"] if len(est["isos"].get(loc) or []) >= 2 and est["people"].get(loc)), None)
out["dyn_edits"] = []
if loc0:
    cur.execute("SELECT updated_at FROM asa_house_calendar_live WHERE location = %s", (loc0,))
    up = cur.fetchone()[0]
    emp0, (iso0, iso1) = est["people"][loc0][0], est["isos"][loc0][:2]
    out["dyn_edits"] = [[1, loc0, emp0, iso0, "", "3p-11p", "builder", "a", (up + timedelta(seconds=10)).isoformat(), "",
                         "published", "", None],
                        [2, loc0, "Zulu New", iso1, "", "7a-3p", "builder", "a", (up - timedelta(days=3)).isoformat(),
                         "", "test_mode", "", None],
                        [3, loc0, emp0, iso1, "", "", "builder", "a", up.isoformat(), "", "published", "", None]]
    ev = ", ".join(["(%s::bigint, %s::text, %s::text, %s::text, %s::text, %s::text, %s::text, %s::text, "
                    "%s::timestamptz, %s::text, %s::text, %s::text, %s::timestamptz)"] * len(out["dyn_edits"]))
    SYN["with"] = cur.mogrify(f"WITH asa_house_calendar_edits({', '.join(SYN_COLS)}) AS (VALUES {ev})",
                              [x for r in out["dyn_edits"] for x in r]).decode()
    SR.forget_estate()
    out["dyn_estate"] = ser_est(SR.estate(PG_DSN, fresh=True))
    SYN["with"] = None
    SR.forget_estate()
    est = SR.estate(PG_DSN, fresh=True)
out["tokens"] = sorted(HCL.house_tokens(PG_DSN))
HD.forget()
homes = HD.read(PG_DSN)
out["homes"] = homes
texts = sorted({t for cells in est["cells"].values() for t in cells.values()} | set(SAMPLE_TEXTS))
out["texts"] = texts
out["classify"] = [SS.classify(t) for t in texts]
managers = SR.house_managers(PG_DSN, fresh=True)
out["managers"] = managers
cells = [(loc, emp, ciso, text) for loc in est["locations"] for (emp, ciso), text in est["cells"][loc].items()]
out["cells"] = [[loc, ciso, text] for loc, _e, ciso, text in cells]
out["span_of"] = [[iso(x) for x in s] if s else None for s in (SR.span_of(c[2], c[3]) for c in cells)]
out["essentials"] = [SR.essentials(c[0], c[2], c[3], homes=homes, managers=managers) for c in cells]

v = TO.view(PG_DSN)
rows = v["rows"]
brd = TO.board(v)
dirs = brd["names"]
out["rows"], out["dirs"], out["brd"] = rows, dirs, brd
people = [n for loc in est["locations"] for n in est["people"].get(loc, []) if not SR.not_a_person(n, loc)]
mgr = next((n for hm in managers.get("by_code", {}).values() for n in (hm.get("names") or []) if n), "")
staff = people[0] if people else ""
whos = {"staff": SR.viewer(PG_DSN, name=staff, role="staff"),
        "manager role": SR.viewer(PG_DSN, name=mgr, role="manager"),
        "house manager": SR.viewer(PG_DSN, name=mgr, role="staff"),
        "master": SR.viewer(PG_DSN, name=staff, role="admin", is_master=True),
        "nobody": SR.viewer(PG_DSN, name="", role="staff"),
        "client": SR.viewer(PG_DSN, name=staff, role="client")}
out["whos"] = whos
accounts = [r for r in state["tables"].get("asa_users", {}).get("rows", [])]
cols = state["tables"].get("asa_users", {}).get("columns", [])
acct_names = []
for r in accounts:
    d = dict(zip(cols, r))
    if d.get("role") == "staff" and d.get("active") is not False:
        acct_names.append(str(d.get("entity_name") or d.get("display_name") or "").strip())
spell = people[:20] + [n.upper() for n in people[:5]] + ["  " + n + "  " for n in people[:3]]
spell += [" ".join(n.split()[:1] + ["Q"] + n.split()[1:]) for n in people[:5] if len(n.split()) >= 2]
spell += acct_names[:15] + ["Other", "", "Nobody Atall", "OPEN"]
out["spell_names"] = spell
out["spell"] = [TO._spell(est, PG_DSN, n) for n in spell]
out["file_for"] = {k: [TO._may_file_for(w, dirs), TO.scope_of(w, dirs)] for k, w in whos.items()}
out["reach"] = {k: [TO.reach_refusal(w, n, est, dirs) for n in spell] for k, w in whos.items()}
out["withdraw"] = {k: [TO.may_withdraw(w, r, on) for r in rows] for k, w in whos.items()}
day = TO.day_of
vcases = []
for r in rows[:30]:
    a, b = day(r.get("start_date")), day(r.get("end_date"))
    for s, e, reason in ((a, b, ""), (on + timedelta(days=3), on + timedelta(days=5), "x"),
                         (on - timedelta(days=2), on + timedelta(days=1), ""),
                         (on + timedelta(days=10), on + timedelta(days=5), ""),
                         (on, on + timedelta(days=200), "y" * 501), (None, None, "")):
        vcases.append([str(r.get("person") or ""), iso(s), iso(e), reason, str(r.get("id") or "")])
out["vcases"] = vcases
out["validate"] = {k: [TO.validate(who=w, person=p, start=day(s), end=day(e), reason=rs,
                                   existing=[x for x in rows if str(x.get("id") or "") != ref], est=est, dirs=dirs,
                                   on=on) for p, s, e, rs, ref in vcases] for k, w in whos.items()}
shaped = {k: [TO.shape(r, w, dirs, managers, est, on, brd=brd) for r in rows] for k, w in whos.items()}
out["shaped"] = shaped
out["hero"] = {k: TO.hero(rows, shaped[k], scope=TO.scope_of(w, dirs), on=on) for k, w in whos.items()}
spans = [(c[2], c[3]) for c in cells if SR.span_of(c[2], c[3]) is not None][:400]
wins = [(day(r.get("start_date")), day(r.get("end_date"))) for r in rows[:30]] + [(on, on + timedelta(days=2))]
wins = [(a, b) for a, b in wins if a and b and b >= a]
out["clash_cells"], out["clash_wins"] = spans, [[iso(a), iso(b)] for a, b in wins]
out["clashes"] = [[TO.clashes(ci, t, a, b) for a, b in wins] for ci, t in spans]
out["state"] = state
out["facts"] = {"edits rows": len(rows_), "live houses": len(live_locs), "cells": len(cells), "texts": len(texts),
                "time off rows": len(rows), "names spelled": len(spell), "validate cases": len(vcases),
                "ddl skipped": SKIPPED["ddl"]}
print("RELAY_RESULT " + json.dumps(jsonable(out), default=str))
'''

DB_DRIVER = r'''
import base64, importlib.abc, importlib.util, json, os, sys, types
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
os.environ.setdefault("HUB_DB_DSN", "host=%s dbname=%s user=%s password=%s" % (
    os.environ.get("HUB_DB_HOST", "asa-hub-db"), os.environ["POSTGRES_DB"], os.environ["POSTGRES_USER"],
    os.environ["POSTGRES_PASSWORD"]))
os.environ.pop("HUB_RELAY_RO_DSN", None)
exec(blob["common"])
import hubdb, locations as L, scope as sc
import mw_relay_state as M, mw_roster as R, mw_shifts as S, mw_time_off as T
relay = blob["relay"]
checks, facts = [], {}
# key names a mismatch may print: never a person's
SAFE_KEYS = {"staff", "manager role", "house manager", "master", "nobody", "client", "pending", "held", "rehearsed",
             "on", "readable", "why", "off_now", "upcoming", "waiting", "month", "bar"}


def check(name, ok, detail=""):
    checks.append([name, bool(ok), detail])


def same(name, a, b):
    a, b = json.loads(json.dumps(jsonable(a), default=str)), json.loads(json.dumps(b, default=str))
    if a == b:
        check(name, True)
        return
    if isinstance(a, list) and isinstance(b, list):
        bad = [i for i in range(max(len(a), len(b))) if i >= len(a) or i >= len(b) or a[i] != b[i]]
        check(name, False, f"{len(bad)} of {max(len(a), len(b))} differ (python {len(a)}, relay {len(b)}); first at "
                           f"{bad[:5]}")
    elif isinstance(a, dict) and isinstance(b, dict):
        bad = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
        named = [k for k in bad if k in SAFE_KEYS]
        check(name, False, f"{len(bad)} of {len(set(a) | set(b))} key(s) differ {named[:8]}")
    else:
        check(name, False, "the answers differ")


ER, HCL, HD, SS = R.effective_roster, R.house_cal_live, R.house_directory, R.shift_slices
sr = S.sr
reads = L.Reads(hubdb.HubDb())
on = date.fromisoformat(relay["on"])
try:
    ER.published(reads, held=True)
    check("without the edits table among the relay tables Python reads, published() defers", False, "it answered")
except sc.Defer as e:
    check("without the edits table among the relay tables Python reads, published() defers", ER.EDITS in str(e))
M.TABLES = M.TABLES | {ER.EDITS}
syn_state = {"tables": {ER.EDITS: {"columns": list(SYN_COLS), "types": {"at": "ts", "undone_at": "ts"},
                                   "rows": SYN_EDITS},
                        ER.LIVE: {"columns": ["location", "updated_at"], "types": {"updated_at": "ts"},
                                  "rows": SYN_LIVE}}}
with M.use({"relay_state": syn_state}):
    for (name, lo, hi, loc, held), want in zip(SYN_CASES, relay["syn"]):
        got = ER.published(reads, date.fromisoformat(lo) if lo else None, date.fromisoformat(hi) if hi else None,
                           location=loc, held=held)
        same(f"effective_roster.published over the made-up table — {name} ({len(want)} cells, "
             f"{sum(1 for c in want if c['pending'])} pending, {sum(1 for c in want if c['rehearsal'])} rehearsed)",
             got, want)
    for sw in ("on", "off"):
        with ER.use_switch(SW[sw]):
            same(f"effective_roster.on_mirror over the made-up table — switch {sw}", ER.on_mirror(reads),
                 relay["syn_mirror"][sw])
state = relay["state"]
if relay["dyn_edits"]:
    dyn = {"tables": {**state["tables"], ER.EDITS: {"columns": list(SYN_COLS), "types": {"at": "ts", "undone_at": "ts"},
                                                    "rows": relay["dyn_edits"]}}}
    with M.use({"relay_state": dyn}), ER.use_switch(SW["on"]):
        got, want = ser_est(sr.estate(reads, fresh=True)), relay["dyn_estate"]
        for part in ("cells", "people", "spans", "unreadable", "worked"):
            same(f"shift_requests.estate[{part}] with pending cells laid on a real house", got[part], want[part])
        check("the pending cells did change that house's estate", want["cells"] != relay["estate"]["on"]["cells"])
with M.use({"relay_state": state}):
    for c in relay["published"]:
        got = ER.published(reads, date.fromisoformat(c["from"]) if c["from"] else None,
                           date.fromisoformat(c["to"]) if c["to"] else None, location=c["location"], held=c["held"])
        same(f"effective_roster.published — {c['name']} ({len(c['got'])} cells)", got, c["got"])
    for sw in ("on", "off"):
        with ER.use_switch(SW[sw]):
            same(f"effective_roster.on_mirror — switch {sw}", ER.on_mirror(reads), relay["on_mirror"][sw])
            same(f"effective_roster.test_mode_said — switch {sw}", ER.test_mode_said(reads), relay["said"][sw])
            got = ser_est(sr.estate(reads, fresh=True))
            want = relay["estate"][sw]
            for part in want:
                same(f"shift_requests.estate[{part}] — switch {sw}", got[part], want[part])
    same("house_cal_live.house_tokens", sorted(HCL.house_tokens(reads)), relay["tokens"])
    with ER.use_switch(SW["on"]):
        est = sr.estate(reads, fresh=True)
        same("time_off._spell (calendars, the staff directory, as typed)",
             [T._spell(est, reads, n) for n in relay["spell_names"]], relay["spell"])
        dirs, whos = relay["dirs"], relay["whos"]
        same("time_off._may_file_for and scope_of", {k: [T._may_file_for(w, dirs), T.scope_of(w, dirs)]
                                                    for k, w in whos.items()}, relay["file_for"])
        same("time_off.reach_refusal", {k: [T.reach_refusal(w, n, est, dirs) for n in relay["spell_names"]]
                                        for k, w in whos.items()}, relay["reach"])
        rows = relay["rows"]
        same("time_off.may_withdraw", {k: [T.may_withdraw(w, r, on) for r in rows] for k, w in whos.items()},
             relay["withdraw"])
        day = T.day_of
        same("time_off.validate", {k: [T.validate(who=w, person=p, start=day(s), end=day(e), reason=rs,
                                                  existing=[x for x in rows if str(x.get("id") or "") != ref], est=est,
                                                  dirs=dirs, on=on) for p, s, e, rs, ref in relay["vcases"]]
                                   for k, w in whos.items()}, relay["validate"])
        same("time_off.hero", {k: T.hero(rows, relay["shaped"][k], scope=T.scope_of(w, dirs), on=on)
                               for k, w in whos.items()}, relay["hero"])
        wins = [(day(a), day(b)) for a, b in relay["clash_wins"]]
        same("time_off.clashes", [[T.clashes(ci, t, a, b) for a, b in wins] for ci, t in relay["clash_cells"]],
             relay["clashes"])
same("shift_slices.classify", [SS.classify(t) for t in relay["texts"]], relay["classify"])
cells = relay["cells"]
same("shift_requests.span_of", [[iso(x) for x in s] if s else None for s in (sr.span_of(c[1], c[2]) for c in cells)],
     relay["span_of"])
homes = HD.read(reads)
same("house_directory.read (entity_homes off asa-hub-db)", homes, relay["homes"])
same("shift_requests.essentials (the relay's homes and managers)",
     [sr.essentials(c[0], c[1], c[2], homes=relay["homes"], managers=relay["managers"]) for c in cells],
     relay["essentials"])
same("shift_requests.essentials (homes off asa-hub-db)",
     [sr.essentials(c[0], c[1], c[2], homes=homes, managers=relay["managers"]) for c in cells], relay["essentials"])

# the relay's read-only DSN (role asa_hub_ro): what it can read agrees with the handed rows; the edits it cannot
import psycopg
M.CONNECT[0] = lambda: psycopg.connect(os.environ["MIRROR_DSN"], autocommit=True, connect_timeout=3)
with M.use({"relay_state": state}):
    handed_tokens = sorted(HCL.house_tokens(reads))
    handed_worked = jsonable(sr._worked_record(reads, on))
with M.use(None):
    check("the read-only DSN reads the house tokens the relay handed", sorted(HCL.house_tokens(reads)) == handed_tokens)
    dsn_worked = jsonable(sr._worked_record(reads, on))
    check("the read-only DSN reads the worked-days record the relay handed", dsn_worked == handed_worked)
    try:
        ER.published(reads, held=True)
        check("the read-only DSN reads the published cells", True)
        facts["edits through the read-only DSN"] = "readable"
    except sc.Defer as e:
        facts["edits through the read-only DSN"] = "deferred: " + str(e)[:140]
M.CONNECT[0] = None

# the switch with nothing handed: the platform's config as Python reads it, and the same `on` the Scheduling app reads
import scheduling as SCH
cfg_switch = ER.test_mode_said(reads)
check("with no switch handed, test mode is read off the config and agrees with the Scheduling app's",
      cfg_switch["on"] == bool(SCH.test_mode(reads)["on"]), str(cfg_switch.get("readable")))
facts["switch read off the config"] = f"on={cfg_switch['on']} readable={cfg_switch['readable']}"
with ER.use_switch(lambda: (_ for _ in ()).throw(RuntimeError("x"))):
    check("a switch that cannot be read holds", ER.test_mode_said(reads)["on"] is True)
facts.update(relay["facts"])
print(json.dumps({"checks": checks, "facts": facts}))
'''


def relay_code() -> str:
    """The relay's state read, as the relay hands its tables to asa-hub-app."""
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    tree = ast.parse(text)
    want = {"_MY_WORK_STATE_TABLES", "_MY_WORK_STATE_COLUMNS", "_my_work_state_read"}
    parts = []
    for node in tree.body:
        name = (node.name if isinstance(node, ast.FunctionDef)
                else getattr(node.targets[0], "id", None) if isinstance(node, ast.Assign)
                else getattr(node.target, "id", None) if isinstance(node, ast.AnnAssign) else None)
        if name in want:
            parts.append(ast.get_source_segment(text, node) or "")
            want.discard(name)
    if want:
        raise RuntimeError(f"the relay lacks {sorted(want)}")
    return "\n\n".join(parts)


def main() -> int:
    failed = 0
    print(f"RELAY — the relay's roster modules, read-only, in {RELAY}")
    server = lane_schema.with_imports(ROOT / "server", SERVER_ROOTS)
    server = {k: v for k, v in server.items() if not k.endswith(".json")}
    blob = {"server": server, "relay_code": relay_code(), "common": COMMON, "budget": RELAY_BUDGET_S}
    got = subprocess.run(["docker", "exec", "-i", "-w", "/tmp", "-e", "MALLOC_ARENA_MAX=2", RELAY, "nice", "-n", "19",
                          "python3", "-c", RELAY_DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True,
                         timeout=RELAY_BUDGET_S + 30)
    line = next((x for x in got.stdout.decode().splitlines() if x.startswith("RELAY_RESULT ")), "")
    if not line:
        print("FAIL the relay side ran")
        print(got.stderr.decode()[-2500:])
        return 1
    relay = json.loads(line[len("RELAY_RESULT "):])
    print(f"\nPYTHON — app/mw_roster.py, app/mw_shifts.py, app/mw_time_off.py with the same rows, in {DB_RUNNER}")
    app_all = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    blob = {"app": app_all, "relay": relay, "common": COMMON}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "nice", "-n", "19", "python",
                          "-c", DB_DRIVER],
                         input=base64.b64encode(json.dumps(blob, default=str).encode()) + b"\n", capture_output=True,
                         timeout=900)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print("FAIL the Python side ran in asa-hub-db-sync")
        print(got.stderr.decode()[-2500:])
        return 1
    res = json.loads(lines[-1])
    for name, ok, detail in res["checks"]:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1
    for k, v in res["facts"].items():
        print(f"fact {k}: {v}")
    print(f"\n{'all ok' if not failed else f'{failed} failed'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
