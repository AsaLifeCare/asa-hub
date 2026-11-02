#!/usr/bin/env python3
"""Overtime decided by the streamed modules in asa-hub-db-sync (app/recon_overtime.py, app/overtime_lanes.py).

First on stand-in reads (no database touched): the Sunday weeks, a range that cuts a week judged on the whole week, the
40-hour threshold at and past its edge, a person's overlapping PsiAnywhere entries counted once, R and D left out, a
midnight split landing on both sides of a Sunday, the sort, the employees filter and picker (hours only), the raw
entries of the drill-down, Scheduling's planned cells (off states, inactive and placeholder rows, overnight, overlap),
the fall-back to the house calendars only when no copy of Scheduling is held (a database that did not answer is a 503),
the board's hours cut on Scheduling › Overtime, and the lanes' ranges, refusals and gates. Then on the live copy,
read-only (every connection of the driver opens with default_transaction_read_only, so a write would fail rather than
land): pay period P2026-10-11's overtime and planned hours, the real readers' gate (recon_gate.may_read and .reader)
refusing an ordinary staff account, and the live hours switch — printed as aggregates only, never a name.

Scheduling's own gate (sched_lanes._app_gate / app_access) stays a stand-in: sched_lanes and front_door read files at
import that asa-hub-db-sync does not hold (ist_config_defaults.json, front_door_routes.json)."""
from __future__ import annotations

import base64
import json
import py_compile
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"
LIVE_PERIOD = "P2026-10-11"

DRIVER = r'''
import asyncio, base64, importlib.abc, importlib.util, json, sys, time, types
SRC = json.loads(base64.b64decode(sys.stdin.readline()).decode())
LIVE_PERIOD = sys.argv[1]


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
        self.routes = {}

    def get(self, path, **_kw):
        def keep(fn):
            self.routes[path] = fn
            return fn
        return keep
    post = get


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
# Scheduling's lanes and the front door load the whole web stack (the front door's route files, the relay's packs);
# the gates the lanes ask of them are stood in for below, and lane_gate (whose answer and query are the real ones)
# names the front door only inside its session helpers, so both stand in as modules holding just that
sched_lanes = types.ModuleType("sched_lanes")
front_door = types.ModuleType("front_door")


async def _no_gate(*_a, **_kw):
    raise AssertionError("a gate was asked before the check stood one in")
sched_lanes._app_gate = sched_lanes._session = front_door.session = _no_gate
sys.modules.update({"sched_lanes": sched_lanes, "front_door": front_door})

from datetime import date
import gsjs, hubdb, locations as L
import psi_periods as PP
import recon_psi as RP
import recon_roster as RO
import recon_overtime as OT
import overtime_lanes as OL
import recon_gate as RG
import scheduling as S
from scope import Defer

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:500]])


# ---- stand-in reads ------------------------------------------------------------------------------------------------

PEOPLE = [{"id": "P1", "name": "Alice Smith"}, {"id": "P2", "name": "Bruno Costa"},
          {"id": "P3", "name": "Carla Dias"}, {"id": "P4", "name": "Diego Lima"}]
FP = 0x0E57


class Db:
    def __init__(self, punches):
        self.punches = punches

    def query(self, sql, params=()):
        if params and params[0] == RP.PUNCHES:
            _res, a, b = params
            return [(json.dumps(c),) for c in self.punches if a <= c["date_iso"] <= b]
        raise AssertionError("the stand-in was asked an unexpected query: " + sql[:80])


class Stand:
    def __init__(self, punches, rows=None, cells=None, calendars=None, config=None):
        self.db = Db(punches)
        self.memo = {"recon:roster": (PEOPLE, FP), "recon_psi:places": {"guildford": "ABD1547", "maple": "BM2001"},
                     "recon:calendars": calendars or []}
        if rows is not None:
            self.memo["sch:tab:" + S.TABS["rows"]] = rows
            self.memo["sch:tab:" + S.TABS["cells"]] = cells or []
        # Scheduling's hours switch: shown to everyone unless a test says otherwise; an exception is raised as read
        self.cfg = {S.HOURS_KEY: "no"} if config is None else config

    def once(self, name, read):
        if name not in self.memo:
            self.memo[name] = read()
        return self.memo[name]

    def config(self):
        if isinstance(self.cfg, Exception):
            raise self.cfg
        return self.cfg


SEQ = [0]


def psi(first, last, day, start, end, hours, status="A", site="Guildford", consumers=("Ann, Lee",)):
    SEQ[0] += 1
    c = {"single_entry_id": f"E{SEQ[0]:04d}", "date_iso": day, "status": status, "employee": "", "firstname": first,
         "lastname": last, "start_time": start, "end_time": end, "hours": hours, "location_name": site,
         "house": "", "work_code": "DSP"}
    for n, who in enumerate(consumers, 1):
        c[f"consumer_{n}"] = who
    return c


A = ("Alice", "Smith")
B = ("Bruno", "Costa")
C = ("Carla", "Dias")
DG = ("Diego", "Lima")
Z = ("Zed", "Unknown")
E = ("Erin", "Moss")
PUNCHES = (
    # Alice: 10 h a day Sunday 10-11 to Thursday 10-15 (50 h), and 4 h on Sunday 10-18
    [psi(*A, f"2026-10-1{d}", "7:00:00 AM", "5:00:00 PM", "10") for d in range(1, 6)]
    + [psi(*A, "2026-10-18", "8:00:00 AM", "12:00:00 PM", "4")]
    # Bruno: exactly 40 h in the week of 10-11; a Rejected and a Duplicate entry that never count
    + [psi(*B, f"2026-10-1{d}", "7:00:00 AM", "5:00:00 PM", "10") for d in range(2, 6)]
    + [psi(*B, "2026-10-16", "7:00:00 AM", "5:00:00 PM", "10", status="R"),
       psi(*B, "2026-10-17", "7:00:00 AM", "5:00:00 PM", "10", status="D")]
    # Carla: one entry per consumer for the same minutes, and a third overlapping them (10 h once, not 18);
    # an entry still open; a shift PsiAnywhere split at midnight across Saturday 10-17 and Sunday 10-18
    + [psi(*C, "2026-10-13", "9:00:00 AM", "5:00:00 PM", "8", consumers=("Ann, Lee",)),
       psi(*C, "2026-10-13", "9:00:00 AM", "5:00:00 PM", "8", consumers=("Bo, Ray",)),
       psi(*C, "2026-10-13", "3:00:00 PM", "7:00:00 PM", "4", site="Maple"),
       psi(*C, "2026-10-14", "8:00:00 AM", "", ""),
       psi(*C, "2026-10-17", "11:00:00 PM", "11:59:59 PM", "1"),
       psi(*C, "2026-10-18", "12:00:00 AM", "7:00:00 AM", "7")]
    # Diego: 40.5 h in the week of 10-18
    + [psi(*DG, f"2026-10-{d}", "7:00:00 AM", "5:00:00 PM", "10") for d in (18, 19, 20, 21)]
    + [psi(*DG, "2026-10-22", "7:00:00 AM", "7:30:00 AM", "0.5")]
    # Zed: nobody on the people tab
    + [psi(*Z, "2026-10-20", "7:00:00 AM", "3:00:00 PM", "8")])


def by_key(got):
    return {p["key"]: p for p in got["people"]}


def pure_weeks():
    w = OT.weeks_touching("2026-10-11", "2026-10-24")
    check("a pay period touches its two Sunday weeks",
          [(x["from"], x["to"]) for x in w] == [("2026-10-11", "2026-10-17"), ("2026-10-18", "2026-10-24")], w)
    check("a week's label is PsiAnywhere's text", w and w[0]["label"] == "10/11/26 – 10/17/26", w)
    w = OT.weeks_touching("2026-10-17", "2026-10-18")
    check("Saturday to Sunday touches two weeks", [x["from"] for x in w] == ["2026-10-11", "2026-10-18"], w)
    check("one Wednesday touches its own week", [x["from"] for x in OT.weeks_touching("2026-10-14", "2026-10-14")] ==
          ["2026-10-11"])
    check("a Saturday ends its week, a Sunday starts the next",
          [x["from"] for x in OT.weeks_touching("2026-10-24", "2026-10-24")] == ["2026-10-18"] and
          [x["from"] for x in OT.weeks_touching("2026-10-25", "2026-10-25")] == ["2026-10-25"])
    check("dates are read as dates too, and a reversed range touches nothing",
          OT.weeks_touching(date(2026, 10, 12), date(2026, 10, 12))[0]["from"] == "2026-10-11" and
          OT.weeks_touching("2026-10-20", "2026-10-19") == [] and OT.weeks_touching("10/20/2026", "2026-10-21") == [])


def pure_actual():
    reads = Stand(PUNCHES)
    got = OT.actual(reads, "2026-10-11", "2026-10-24")
    p = by_key(got)
    a = p.get("P1") or {}
    check("Alice: 50 h in the week of 10-11 is over by 10, 4 h the next",
          [(x["from"], x["hours"], x["over"], x["overtime"]) for x in a.get("weeks") or []] ==
          [("2026-10-11", 50.0, True, 10.0), ("2026-10-18", 4.0, False, 0.0)] and a.get("total") == 54.0 and
          a.get("overtime") == 10.0 and a.get("inRange") == 54.0, a)
    b = p.get("P2") or {}
    check("Bruno: exactly 40 h is not over; his Rejected and Duplicate entries never count",
          b.get("weeks", [{}])[0] == {"from": "2026-10-11", "hours": 40.0, "over": False, "overtime": 0.0} and
          b.get("total") == 40.0 and b.get("days", {}).get("2026-10-16") == 0.0, b)
    c = p.get("P3") or {}
    check("Carla: the per-consumer copies and the overlapping entry count each minute once (10 h, not 18)",
          c.get("days", {}).get("2026-10-13") == 10.0, c.get("days"))
    check("Carla: a midnight split lands an hour on Saturday's week and seven on Sunday's",
          c.get("days", {}).get("2026-10-17") == 1.0 and c.get("days", {}).get("2026-10-18") == 7.0 and
          [x["hours"] for x in c.get("weeks") or []] == [11.0, 7.0], c.get("weeks"))
    check("Carla: the entry with no clock-out adds nothing and is counted open",
          c.get("open") == 1 and c.get("days", {}).get("2026-10-14") == 0.0, c.get("open"))
    d = p.get("P4") or {}
    check("Diego: 40.5 h is over by half an hour",
          d.get("weeks", [{}, {}])[1] == {"from": "2026-10-18", "hours": 40.5, "over": True, "overtime": 0.5}, d)
    z = next((x for x in got["people"] if x["key"].startswith("name:")), {})
    check("a name nobody on the people tab holds keys as recon keys it (name:…), no people id",
          z.get("employeeId") == "" and z.get("total") == 8.0, z)
    check("sorted by overtime, then total, highest first",
          [x["key"] for x in got["people"]] == ["P1", "P4", "P2", "P3", z.get("key")],
          [x["key"] for x in got["people"]])
    check("days hold every day of the touching weeks, zero where nothing was worked",
          all(len(x["days"]) == 14 for x in got["people"]) and a.get("days", {}).get("2026-10-24") == 0.0)
    check("the totals: people, people over, overtime and hours",
          got["totals"] == {"people": 5, "peopleOver": 2, "overtimeHours": 10.5, "hours": 54 + 40 + 18 + 40.5 + 8},
          got["totals"])
    check("threshold 40, the weeks and the employees picker (by name)",
          got["threshold"] == 40 and len(got["weeks"]) == 2 and
          [e["key"] for e in got["employees"]] == ["P1", "P2", "P3", "P4", z.get("key")], got["employees"])

    cut = OT.actual(Stand(PUNCHES), "2026-10-14", "2026-10-15")
    a = by_key(cut).get("P1") or {}
    check("a range that cuts a week judges the whole week: Wed-Thu shows 20 h in range, 50 h and 10 over in the week",
          cut["from"] == "2026-10-14" and [w["from"] for w in cut["weeks"]] == ["2026-10-11"] and
          a.get("inRange") == 20.0 and a.get("total") == 50.0 and a.get("overtime") == 10.0 and
          sorted(a.get("days") or {}) == [f"2026-10-1{d}" for d in range(1, 8)], a)
    check("…and the next week's entries are not read", "P4" not in by_key(cut), sorted(by_key(cut)))

    t30 = by_key(OT.actual(Stand(PUNCHES), "2026-10-11", "2026-10-17", threshold=30))
    check("the threshold is a parameter: at 30 h Bruno's 40 are 10 over",
          (t30.get("P2") or {}).get("overtime") == 10.0 and (t30.get("P1") or {}).get("overtime") == 20.0)

    one = OT.actual(Stand(PUNCHES), "2026-10-11", "2026-10-24", employees=["p2", "NAME:ZED UNKNOWN"])
    check("the employees filter keeps the keys asked (any case), the totals follow, the picker keeps everyone",
          sorted(x["key"] for x in one["people"]) == sorted(["P2", z.get("key")]) and one["totals"]["people"] == 2 and
          one["totals"]["peopleOver"] == 0 and len(one["employees"]) == 5, (one["people"], one["totals"]))
    check("an empty employees list narrows nothing", len(OT.actual(Stand(PUNCHES), "2026-10-11", "2026-10-24",
                                                                   employees=[])["people"]) == 5)
    bad = OT.actual(Stand(PUNCHES), "2026-10-24", "2026-10-11")
    check("a reversed range answers nothing", bad["people"] == [] and bad["weeks"] == [] and
          bad["totals"]["people"] == 0, bad)

    opened = OT.actual(Stand(PUNCHES + [psi(*E, "2026-10-15", "8:00:00 AM", "", "")]), "2026-10-11", "2026-10-24")
    e = next((x for x in opened["people"] if x["employeeName"] == "Erin Moss"), {})
    check("a person whose only entry is still open: in people with 0 h and open, never in the employees picker",
          e.get("total") == 0.0 and e.get("open") == 1 and e.get("key") and
          e.get("key") not in [x["key"] for x in opened["employees"]] and len(opened["employees"]) == 5,
          (e, opened["employees"]))


def pure_entries():
    got = OT.entries(Stand(PUNCHES), "P3", "2026-10-13", "2026-10-18")
    es = got["entries"]
    check("the drill-down: Carla's raw entries, never folded nor stitched (6), by day and start",
          got["employee"] == {"key": "P3", "name": "Carla Dias"} and len(es) == 6 and
          [(e["date"], e["startTime"]) for e in es] ==
          [("2026-10-13", "9:00:00 AM"), ("2026-10-13", "9:00:00 AM"), ("2026-10-13", "3:00:00 PM"),
           ("2026-10-14", "8:00:00 AM"), ("2026-10-17", "11:00:00 PM"), ("2026-10-18", "12:00:00 AM")], es)
    e = es[2] if len(es) > 2 else {}
    check("an entry carries PsiAnywhere's hours, house, site, work code, status, consumers and id",
          e.get("hours") == 4.0 and e.get("location") == "BM2001" and e.get("site") == "Maple" and
          e.get("workCode") == "DSP" and e.get("status") == "A" and e.get("consumers") == "Ann Lee" and
          len(e.get("entryIds") or []) == 1 and set(e) == {"date", "startTime", "endTime", "hours", "location", "site",
                                                         "workCode", "status", "consumers", "entryIds"}, e)
    check("the open entry is there with no end", es[3]["endTime"] == "" if len(es) > 3 else False)
    check("Rejected entries never reach the drill-down",
          OT.entries(Stand(PUNCHES), "P2", "2026-10-16", "2026-10-17")["entries"] == [])
    z = OT.entries(Stand(PUNCHES), "name:zed unknown", "2026-10-11", "2026-10-24")
    check("a name: key reads its own entries", len(z["entries"]) == 1 and z["employee"]["name"] == "Zed Unknown", z)
    check("an unknown key reads none", OT.entries(Stand(PUNCHES), "P9", "2026-10-11", "2026-10-24") ==
          {"employee": {"key": "P9", "name": ""}, "entries": []})


ROWS = [{"house_code": "H1", "row_id": "R1", "row_kind": "person", "name": "Alice Smith", "active": "yes"},
        {"house_code": "H1", "row_id": "R2", "row_kind": "person", "name": "Bruno Costa", "active": "no"},
        {"house_code": "H1", "row_id": "OPEN:1", "row_kind": "open", "name": "OPEN 1", "active": ""},
        {"house_code": "H1", "row_id": "R3", "row_kind": "other", "name": "Family", "active": ""},
        {"house_code": "H2", "row_id": "R1", "row_kind": "person", "name": "Alice Smith", "active": ""},
        {"house_code": "H2", "row_id": "R2", "row_kind": "person", "name": "Zed Unknown", "active": ""},
        {"house_code": "H2", "row_id": "R3", "row_kind": "person", "name": "Diego Lima", "active": ""}]


def cell(h, r, d, text, state="scheduled"):
    return {"house_code": h, "row_id": r, "date": d, "text": text, "state": state}


CELLS = ([cell("H1", "R1", "2026-10-12", "7A-3P"), cell("H2", "R1", "2026-10-12", "1P-5P"),
          cell("H1", "R1", "2026-10-13", "11P-7A"), cell("H1", "R1", "2026-10-14", "7A-3P", "called_off"),
          cell("H1", "R1", "2026-10-15", "OFF"), cell("H1", "R1", "2026-10-16", "7A-3P", "training"),
          cell("H1", "R1", "2026-10-30", "7A-3P"), cell("H1", "R2", "2026-10-12", "7A-3P"),
          cell("H1", "OPEN:1", "2026-10-12", "7A-3P"), cell("H1", "R3", "2026-10-12", "7A-3P"),
          cell("H2", "R2", "2026-10-20", "7A-3P"), cell("H2", "R1", "2026-10-17", "ABD1547")]
         + [cell("H2", "R3", f"2026-10-{d}", "7A-7P") for d in (18, 19, 20, 21)])


def pure_planned():
    got = OT.planned(Stand([], ROWS, CELLS), "2026-10-11", "2026-10-24")
    p = got["people"]
    a = (p.get("P1") or {}).get("days") or {}
    check("planned reads Scheduling's own cells", got["source"] == "schedule", got["source"])
    check("two houses' overlapping cells count once (7A-3P and 1P-5P = 10 h)", a.get("2026-10-12") == 10.0, a)
    check("an overnight shift's hours land on the day it starts", a.get("2026-10-13") == 8.0 and
          "2026-10-14" not in a, a)
    check("called off and OFF plan nothing, a trainee's shift is their own hours, an alias holds no time",
          "2026-10-15" not in a and a.get("2026-10-16") == 8.0 and "2026-10-17" not in a, a)
    check("a day outside the range is not read", "2026-10-30" not in a, a)
    check("an inactive row, an open row and a placeholder row plan nothing",
          "P2" not in p and not any(k for k in p if "open" in k or "family" in k), sorted(p))
    check("a name nobody holds plans under the key recon gives it",
          any(k.startswith("name:") and v["days"] == {"2026-10-20": 8.0} for k, v in p.items()), sorted(p))

    cmp_ = OT.compare(Stand(PUNCHES, ROWS, CELLS), "2026-10-11", "2026-10-24")
    c = by_key(cmp_)
    a = c.get("P1") or {}
    check("compare: Alice planned 26 h and worked 50 in the week of 10-11",
          (a.get("weeks") or [{}])[0] == {"from": "2026-10-11", "planned": 26.0, "actual": 50.0, "over": True,
                                         "plannedOver": False, "overtime": 10.0} and
          a.get("days", {}).get("2026-10-12") == {"planned": 10.0, "actual": 10.0}, a.get("weeks"))
    d = c.get("P4") or {}
    check("compare: Diego planned 48 h (over) and worked 40.5",
          (d.get("weeks") or [{}, {}])[1] == {"from": "2026-10-18", "planned": 48.0, "actual": 40.5, "over": True,
                                             "plannedOver": True, "overtime": 0.5} and d.get("planned") == 48.0, d)
    z = next((x for x in cmp_["people"] if x["key"].startswith("name:")), {})
    check("compare: one person on both sides is one row (planned and worked keyed alike)",
          z.get("planned") == 8.0 and z.get("actual") == 8.0 and
          sum(1 for x in cmp_["people"] if x["key"].startswith("name:")) == 1, z)
    check("compare: sorted by overtime, then actual", [x["key"] for x in cmp_["people"]] ==
          ["P1", "P4", "P2", "P3", z.get("key")], [x["key"] for x in cmp_["people"]])
    check("compare: totals, plannedSource, every day of the weeks",
          cmp_["totals"] == {"people": 5, "peopleOver": 2, "overtimeHours": 10.5} and
          cmp_["plannedSource"] == "schedule" and all(len(x["days"]) == 14 for x in cmp_["people"]), cmp_["totals"])
    one = OT.compare(Stand(PUNCHES, ROWS, CELLS), "2026-10-11", "2026-10-24", employees=["P4"])
    check("compare: the employees filter, the picker keeps everyone",
          [x["key"] for x in one["people"]] == ["P4"] and len(one["employees"]) == 5, one["employees"])
    no_diego = [x for x in PUNCHES if x["firstname"] != "Diego"]
    pk = [x["key"] for x in OT.compare(Stand(no_diego + [psi(*E, "2026-10-15", "8:00:00 AM", "", "")], ROWS, CELLS),
                                       "2026-10-11", "2026-10-24")["employees"]]
    check("compare: the picker lists planned-only people (Diego) and never an only-open one (Erin)",
          "P4" in pk and len(pk) == 5 and not any("erin" in k for k in pk), pk)

    grid = {"cols": [{"iso": "2026-10-12"}, {"iso": "2026-10-13"}],
            "rows": [{"employee": "Alice Smith", "cells": [{"text": "7A-3P"}, {"text": "OFF"}]},
                     {"employee": "FAMILY", "cells": [{"text": "7A-3P"}, {"text": ""}]},
                     {"employee": "OPEN", "cells": [{"text": "7A-3P"}, {"text": ""}]}]}
    real = S.read_tab
    calendars = [("CAN - 48TH - ABD1547", grid)]
    from_calendars = {"P1": {"employeeId": "P1", "employeeName": "Alice Smith", "days": {"2026-10-12": 8.0}}}

    def failing(exc):
        def read_tab(_reads, _tab):
            raise exc
        return read_tab

    def planned_when(exc):
        S.read_tab = failing(exc)
        try:
            return OT.planned(Stand([], calendars=calendars), "2026-10-11", "2026-10-24")
        finally:
            S.read_tab = real

    got = planned_when(Defer("the Scheduling house is not declared in the copy"))
    check("Scheduling never uploaded (Defer): the house calendars' live copy, said as such, placeholders left out",
          got["source"] == "house calendars" and got["people"] == from_calendars, got)
    got = planned_when(hubdb.Unreadable("asa-hub-db holds no copy of the Scheduling house sched_cells"))
    check("asa-hub-db holds no copy of Scheduling's houses: the house calendars too",
          got["source"] == "house calendars" and got["people"] == from_calendars, got)
    for words in ("asa-hub-db did not answer (every reader busy)", "asa-hub-db did not answer (OperationalError)"):
        try:
            got = planned_when(hubdb.Unreadable(words))
            raised = ""
        except hubdb.Unreadable as exc:
            raised = str(exc)
        check(f"a database that did not answer ({words[27:-1]}) is raised, never swapped for the house calendars",
              raised == words, got if not raised else raised)
    check("no_copy: Defer and 'holds no copy' are structural; a database that did not answer and any other error "
          "are not", OT.no_copy(Defer("x")) and OT.no_copy(hubdb.Unreadable("asa-hub-db holds no copy of the book")) and
          not OT.no_copy(hubdb.Unreadable("asa-hub-db did not answer (OperationalError)")) and
          not OT.no_copy(KeyError("holds no copy")))
    S.read_tab = failing(hubdb.Unreadable("asa-hub-db did not answer (OperationalError)"))
    try:
        env = OL.envelope("Overtime", lambda: OL.scheduling_overtime(Stand(PUNCHES, calendars=calendars),
                                                                   "2026-10-11", "2026-10-24", "", date(2026, 10, 29)))
    finally:
        S.read_tab = real
    check("…and reaches the scheduling lane as a 503 in plain words",
          env == {"status": 503, "message": "Overtime could not be read right now (Unreadable)."}, env)


class Req:
    def __init__(self, **q):
        self.query_params, self.headers = q, {}


def pure_lanes():
    today = date(2026, 10, 29)
    check("no range: the current pay period", OL.span("", "", today) == (date(2026, 10, 25), date(2026, 11, 7)))
    check("one end: the pay period holding it supplies the other",
          OL.span("2026-10-14", "", today) == (date(2026, 10, 14), date(2026, 10, 24)) and
          OL.span("", "2026-10-14", today) == (date(2026, 10, 11), date(2026, 10, 14)))
    check("62 days are read", OL.span("2026-08-01", "2026-10-01", today) == (date(2026, 8, 1), date(2026, 10, 1)))
    for name, args in (("63 days", ("2026-08-01", "2026-10-02")), ("a reversed range", ("2026-10-20", "2026-10-19")),
                       ("a day not ISO", ("10/20/2026", "")), ("a day that is none", ("2026-02-30", ""))):
        env = OL.envelope("Overtime", lambda args=args: OL.overtime(Stand(PUNCHES), *args, "", today))
        check(f"{name} is refused 400 in words", env.get("status") == 400 and env.get("message"), env)
    env = OL.envelope("Overtime", lambda: 1 / 0)
    check("a read that fails answers 503 in plain words", env == {
        "status": 503, "message": "Overtime could not be read right now (ZeroDivisionError)."}, env)
    check("employees=KEY,KEY", OL.keys_of(" P1, ,name:zed unknown ") == ["P1", "name:zed unknown"] and
          OL.keys_of("") is None)
    env = OL.envelope("Overtime", lambda: OL.overtime(Stand(PUNCHES), "2026-10-11", "2026-10-24", "P1", today))
    d = env.get("data") or {}
    check("the overtime lane's data: the contract's fields, 13 pay periods newest first, the picker",
          env.get("status") == 200 and set(d) == {"from", "to", "threshold", "weeks", "people", "totals", "periods",
                                                  "employees"} and
          len(d["periods"]) == 13 and d["periods"][0]["id"] == "P2026-10-25" and d["periods"][0]["current"] and
          [p["key"] for p in d["people"]] == ["P1"] and len(d["employees"]) == 5 and
          set(d["people"][0]) == {"key", "employeeId", "employeeName", "weeks", "total", "inRange", "overtime",
                                  "days", "open"}, {k: d.get(k) for k in ("from", "to", "totals")})
    env = OL.envelope("x", lambda: OL.overtime_entries(Stand(PUNCHES), "", "", "", today))
    check("the entries lane asks for an employee", env.get("status") == 400, env)
    env = OL.envelope("Overtime", lambda: OL.scheduling_overtime(Stand(PUNCHES, ROWS, CELLS), "2026-10-11",
                                                               "2026-10-24", "", today))
    d = env.get("data") or {}
    check("the scheduling lane's data: the contract's fields",
          env.get("status") == 200 and set(d) == {"from", "to", "threshold", "weeks", "plannedSource", "people",
                                                  "totals", "periods", "employees"} and
          set(d["people"][0]) == {"key", "employeeId", "employeeName", "weeks", "planned", "actual", "overtime",
                                  "days"}, env.get("message"))

    # the board's own viewer cut (scheduling.hours_hidden), the master always seeing
    for value, master, refused in (("yes", False, True), ("yes", True, False), (" No ", False, False),
                                   ("off", False, False), ("hide", False, True)):
        got = OL.hours_cut(Stand([], config={S.HOURS_KEY: value}), master)
        check(f"hours switch {value.strip()!r}, {'the master' if master else 'anyone else'}: "
              + ("refused 403 in words" if refused else "may read"),
              got == ({"status": 403, "reason": "restricted", "message": OL.HOURS_HIDDEN} if refused else None), got)

    # the routes, behind their gates
    app, asked = App(), []
    cur = {"reads": Stand(PUNCHES, ROWS, CELLS)}
    OL.install(app, lambda: cur["reads"])
    check("three routes are installed", sorted(app.routes) == sorted([
        "/hub-lanes/time-recon/overtime", "/hub-lanes/time-recon/overtime/entries",
        "/hub-lanes/scheduling/overtime"]), sorted(app.routes))
    real_reader, real_gate, real_session = RG.reader, sched_lanes._app_gate, sched_lanes._session
    verdict = {"reader": None, "gate": {}, "session": types.SimpleNamespace(ok=True, role="staff", uid="U1",
                                                                            is_master=False)}

    async def reader(request, reads_of, feature="", feature_label=""):
        asked.append(("reader", feature, feature_label))
        if verdict["reader"] is not None:
            return None, verdict["reader"]
        return {"uid": "U1", "master": False, "user": {}}, None

    async def gate(request, app_id, *, refuse_roles=(), app_label=""):
        asked.append(("gate", app_id, app_label))
        return verdict["gate"].get(app_id) or ("staff", "U1")

    async def session(request):
        asked.append(("session", "", ""))
        return verdict["session"]

    RG.reader, sched_lanes._app_gate, sched_lanes._session = reader, gate, session
    try:
        def call(path, **q):
            res = asyncio.run(app.routes[path](Req(**q)))
            return json.loads(res.body), res.headers
        env, headers = call("/hub-lanes/time-recon/overtime", **{"from": "2026-10-11", "to": "2026-10-24"})
        check("time-recon overtime: behind recon's readers and its own page row, answered no-store",
              env.get("status") == 200 and asked == [("reader", "time-recon.overtime",
                                                      "Time Reconciliation › Overtime")] and
              headers.get("Cache-Control") == "no-store" and env["data"]["totals"]["people"] == 5,
              (asked, env.get("message")))
        env, _h = call("/hub-lanes/time-recon/overtime/entries", employee="P1", **{"from": "2026-10-11",
                                                                                  "to": "2026-10-17"})
        check("time-recon overtime entries: the same gate, the person's entries",
              env.get("status") == 200 and asked[-1][1] == "time-recon.overtime" and
              len(env["data"]["entries"]) == 5, env.get("message"))
        verdict["reader"] = {"status": 403, "reason": "badge", "message": RG.READERS_ONLY}
        env, _h = call("/hub-lanes/time-recon/overtime")
        check("a reader refused is answered the refusal", env == verdict["reader"], env)
        verdict["reader"] = None
        del asked[:]
        env, _h = call("/hub-lanes/scheduling/overtime", **{"from": "2026-10-11", "to": "2026-10-24"})
        check("scheduling overtime: Scheduling's door, then its own page row, then the board's hours cut",
              env.get("status") == 200 and [a[0] + ":" + a[1] for a in asked] ==
              ["gate:scheduling", "gate:scheduling.overtime", "session:"] and
              asked[1][2] == "Scheduling › Overtime" and env["data"]["plannedSource"] == "schedule",
              (asked, env.get("message")))
        verdict["gate"] = {"scheduling.overtime": {"status": 403, "reason": "badge", "message": "closed"}}
        del asked[:]
        env, _h = call("/hub-lanes/scheduling/overtime")
        check("scheduling overtime: a page row that refuses closes it (the hours cut never asked)",
              env.get("status") == 403 and asked[-1][1] == "scheduling.overtime", (env, asked))
        verdict["gate"] = {}
        cur["reads"] = Stand(PUNCHES, ROWS, CELLS, config={S.HOURS_KEY: "yes"})
        env, _h = call("/hub-lanes/scheduling/overtime", **{"from": "2026-10-11", "to": "2026-10-24"})
        check("scheduling overtime: hours the board hides from this viewer close it, 403 in plain words",
              env == {"status": 403, "reason": "restricted", "message": OL.HOURS_HIDDEN}, env)
        verdict["session"] = types.SimpleNamespace(ok=True, role="admin", uid="U0", is_master=True)
        cur["reads"] = Stand(PUNCHES, ROWS, CELLS, config={S.HOURS_KEY: "yes"})
        env, _h = call("/hub-lanes/scheduling/overtime", **{"from": "2026-10-11", "to": "2026-10-24"})
        check("scheduling overtime: the master always sees, the hours hidden from everyone else",
              env.get("status") == 200 and env["data"]["totals"]["people"] == 5, env.get("message"))
        verdict["session"] = types.SimpleNamespace(ok=True, role="staff", uid="U1", is_master=False)
        cur["reads"] = Stand(PUNCHES, ROWS, CELLS, config=hubdb.Unreadable("asa-hub-db did not answer (x)"))
        env, _h = call("/hub-lanes/scheduling/overtime")
        check("scheduling overtime: a hours switch that cannot be read keeps the door shut (403, in words)",
              env.get("status") == 403 and env.get("reason") == "unreadable" and "stays closed" in env.get("message",
                                                                                                           ""), env)
        verdict["session"] = None
        cur["reads"] = Stand(PUNCHES, ROWS, CELLS)
        env, _h = call("/hub-lanes/scheduling/overtime")
        check("scheduling overtime: a session gone by the hours cut is 401", env.get("status") == 401, env)
        verdict["session"] = types.SimpleNamespace(ok=True, role="staff", uid="U1", is_master=False)
        env, _h = call("/hub-lanes/time-recon/overtime", **{"from": "2026-08-01", "to": "2026-10-02"})
        check("a range of 63 days is 400 through the route", env.get("status") == 400, env)
    finally:
        RG.reader, sched_lanes._app_gate, sched_lanes._session = real_reader, real_gate, real_session


# ---- live, read-only -----------------------------------------------------------------------------------------------

def live():
    db = hubdb.HubDb()
    reads = L.Reads(db, None)
    ro = db.query("select current_setting('transaction_read_only')")
    check("live: every connection opens read-only", ro and ro[0][0] == "on", ro)
    today = PP.today_ny()
    per = PP.period_of_id(LIVE_PERIOD, today)
    t0 = time.monotonic()
    got = OT.actual(reads, per["from"], per["to"])
    facts["actual read in"] = f"{time.monotonic() - t0:.1f} s"
    people = got["people"]
    facts["period"] = f"{per['id']} ({per['label']})"
    facts["people with PsiAnywhere entries"] = len(people)
    for i, wk in enumerate(got["weeks"]):
        facts[f"people over 40 h, week of {wk['from']}"] = sum(1 for p in people if p["weeks"][i]["over"])
    facts["people over 40 h in some week"] = got["totals"]["peopleOver"]
    facts["overtime hours / worked hours"] = f"{got['totals']['overtimeHours']} / {got['totals']['hours']}"
    facts["people with an entry still open"] = sum(1 for p in people if p["open"])
    check("live: some people worked the period", len(people) > 0, len(people))
    check("live: each person's weeks sum to their total, their days to the same, the period read whole (in range = "
          "total)", all(abs(sum(w["hours"] for w in p["weeks"]) - p["total"]) < 0.02 and
                        abs(sum(p["days"].values()) - p["total"]) < 0.05 and abs(p["inRange"] - p["total"]) < 0.02
                        and len(p["days"]) == 14 for p in people))
    check("live: sorted by overtime then total", all(
        (people[i]["overtime"], people[i]["total"]) >= (people[i + 1]["overtime"], people[i + 1]["total"])
        for i in range(len(people) - 1)))
    check("live: no week holds more hours than it has (168 h)", all(w["hours"] <= 168 for p in people
                                                                     for w in p["weeks"]))
    if people:
        top = people[0]
        ent = OT.entries(reads, top["key"], per["from"], per["to"])["entries"]
        facts["the top row's raw entries"] = len(ent)
        check("live: the top row's drill-down holds entries inside the range, by day",
              ent and all(per["from"] <= e["date"] <= per["to"] for e in ent) and
              [e["date"] for e in ent] == sorted(e["date"] for e in ent), len(ent))
    t0 = time.monotonic()
    cmp_ = OT.compare(reads, per["from"], per["to"])
    facts["compare read in"] = f"{time.monotonic() - t0:.1f} s"
    facts["plannedSource"] = cmp_["plannedSource"]
    planned_people = [p for p in cmp_["people"] if p["planned"] > 0]
    facts["people with planned hours"] = len(planned_people)
    facts["planned hours / actual hours (the period's weeks)"] = (
        f"{round(sum(p['planned'] for p in cmp_['people']), 2)} / {round(sum(p['actual'] for p in cmp_['people']), 2)}")
    facts["people both planned and worked"] = sum(1 for p in cmp_["people"] if p["planned"] > 0 and p["actual"] > 0)
    for i, wk in enumerate(cmp_["weeks"]):
        facts[f"planned over 40 h, week of {wk['from']}"] = sum(1 for p in cmp_["people"]
                                                               if p["weeks"][i]["plannedOver"])
    check("live: compare's actual side is actual's", round(sum(p["actual"] for p in cmp_["people"]), 1) ==
          round(got["totals"]["hours"], 1) and cmp_["totals"]["peopleOver"] == got["totals"]["peopleOver"])
    env = OL.envelope("Overtime", lambda: OL.overtime(L.Reads(db, None), "", "", "", today))
    d = env.get("data") or {}
    cur = PP.period(today, today)
    check("live: the lane's default is the current pay period, 13 periods",
          env.get("status") == 200 and d.get("from") == cur["from"] and d.get("to") == cur["to"] and
          len(d.get("periods") or []) == 13, env.get("message"))
    env = OL.envelope("Overtime", lambda: OL.scheduling_overtime(L.Reads(db, None), "", "", "", today))
    check("live: the scheduling lane answers", env.get("status") == 200, env.get("message"))
    live_gates(db)


def live_gates(db):
    """The real readers' gate (recon_gate.may_read and recon_gate.reader) on the live accounts, read-only: an ordinary
    staff account (no badge, not on the Review edition's list, not the master) is refused, through the lane too, before
    its page row is asked; an admin or a manager may read. Then the board's own hours cut on the live switch."""
    import editions as ED
    import scope as sc
    reads = L.Reads(db, None)
    review = ED.parse(reads.config().get(ED.EDITIONS_KEY)).get("recon.review") or {}
    listed = set(review.get("people") or ())
    accounts = sorted((sc.user_from_row(u) for u in reads.users()), key=lambda u: u["id"])
    plain = [u for u in accounts if u["id"] and u["role"] == "staff" and not u["types"] and u["id"] not in listed
             and not sc.is_master_email(u["email"])]
    writers = [u for u in accounts if u["id"] and u["role"] in ("admin", "manager") and
               not sc.is_master_email(u["email"])]
    facts["staff accounts with no badge and no Review listing"] = len(plain)
    check("live: an ordinary staff account exists to try the gate with", plain, len(plain))
    if plain:
        u = plain[0]
        check("live: recon_gate.may_read is False for a non-master staff account with no grant",
              RG.may_read(L.Reads(db, None), u, False) is False)
        app = App()
        OL.install(app, lambda: L.Reads(db, None))
        real_session = sched_lanes._session

        async def session(_request):
            return types.SimpleNamespace(ok=True, role="staff", uid=u["id"], is_master=False)
        sched_lanes._session = session
        try:
            # sched_lanes._app_gate is still the stand-in that raises: a refusal must come before the page row
            for path in ("/hub-lanes/time-recon/overtime", "/hub-lanes/time-recon/overtime/entries"):
                env = json.loads(asyncio.run(app.routes[path](Req(employee="x"))).body)
                check(f"live: {path} refuses it through the real readers' gate, 403 in words, before its page row",
                      env == {"status": 403, "reason": "badge", "message": RG.READERS_ONLY}, env)
        finally:
            sched_lanes._session = real_session
    if writers:
        check("live: recon_gate.may_read is True for an admin or a manager (the gate is no blanket refusal)",
              RG.may_read(L.Reads(db, None), writers[0], False) is True)
    hidden = S.hours_hidden(L.Reads(db, None), None)
    facts["the board hides hours from everyone but the master"] = hidden
    check("live: the hours cut never closes the page to the master, and closes it to anyone else exactly when the "
          "board hides hours", OL.hours_cut(L.Reads(db, None), True) is None and
          (OL.hours_cut(L.Reads(db, None), False) is not None) == hidden)


for name, fn in (("weeks", pure_weeks), ("actual", pure_actual), ("entries", pure_entries),
                 ("planned", pure_planned), ("lanes", pure_lanes), ("live", live)):
    try:
        fn()
    except Exception as exc:  # noqa: BLE001 - said as a failed check
        import traceback
        check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300] + " | " +
              traceback.format_exc()[-600:])
print(json.dumps({"checks": out, "facts": facts}))
'''


def main() -> int:
    for name in ("recon_overtime.py", "overtime_lanes.py", "recon_psi.py", "psi_periods.py", "recon_gate.py",
                 "main.py"):
        py_compile.compile(str(ROOT / "app" / name), doraise=True)
    print("ok   the Overtime modules, the recon modules they read and main compile")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2",
                          "-e", "PGOPTIONS=-c default_transaction_read_only=on", DB_RUNNER, "python", "-c", DRIVER,
                          LIVE_PERIOD],
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
