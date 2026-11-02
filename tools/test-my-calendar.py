#!/usr/bin/env python3
"""My Calendar (server/my_calendar.py and its relay doors): one person's week and their own time off requests,
whose decided on the server, every part cut to that person before it answers and failing closed on its own.
Pure: no database, no network."""
import ast
import asyncio
import hashlib
import json
import logging
import os
import re
import sys
import time
import types
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SERVER = ROOT / "server"

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:1500]}")


if "psycopg2" not in sys.modules:  # pragma: no cover - the host has no driver
    try:
        import psycopg2  # noqa: F401
    except ImportError:
        fake = types.ModuleType("psycopg2")
        fake.Error = Exception
        extras = types.ModuleType("psycopg2.extras")
        extras.RealDictCursor = object
        errors = types.ModuleType("psycopg2.errors")
        errors.UniqueViolation = type("UniqueViolation", (Exception,), {})
        fake.extras, fake.errors = extras, errors
        sys.modules["psycopg2"] = fake
        sys.modules["psycopg2.extras"] = extras
        sys.modules["psycopg2.errors"] = errors
# every connect in this file fails, so nothing is ever read from a real database
sys.modules["psycopg2"].connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no database in this test"))

sys.path.insert(0, str(SERVER))
os.environ.setdefault("HUB_SNAPSHOT_OUT", "/tmp")
import ist_config  # noqa: E402
import shift_handoff  # noqa: E402
import shift_requests as sr  # noqa: E402
import time_off  # noqa: E402
import my_work as mw  # noqa: E402
import my_profile as mp  # noqa: E402
import my_calendar as mc  # noqa: E402

ist_config.pin(dict(ist_config.SHIPPED))
TODAY = date(2026, 9, 24)
D = lambda n: (TODAY + timedelta(days=n)).isoformat()  # noqa: E731
NOW = datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc)
MON, SUN = date(2026, 9, 21), date(2026, 9, 27)

H1 = "CAN - 48TH (B) - ABD1711"
H2 = "CAN - ORCHARD - ABD2000"
H3 = "CAN - MK - MK11787"
MANAGERS = {"readable": True, "why": "", "by_code": {
    "ABD1711": {"name": "Mia Manager", "names": ["Mia Manager"], "phone": "", "house": H1, "last_day": ""}}}
sr.house_managers = lambda dsn, **k: MANAGERS
HOMES = {"ABD1711": {"code": "ABD1711", "label": "48TH (B)", "name": "48TH (B) home",
                     "address": "4801 Meadowlane Ave", "region": "CAN"},
         "ABD2000": {"code": "ABD2000", "label": "ORCHARD", "name": "ORCHARD home",
                     "address": "12 Orchard Dale", "region": "CAN"}}
TOKENS = {"48TH (B)", "ORCHARD", "MK"}
WORDS = {0: "MON", 1: "TUES", 2: "WED", 3: "THUR", 4: "FRI", 5: "SAT", 6: "SUN"}


def cols(first, last):
    out, d = [], first
    while d <= last:
        out.append({"iso": d.isoformat(), "date": f"{d.month}/{d.day}", "weekday": WORDS[d.weekday()]})
        d += timedelta(days=1)
    return out


def grid(columns):
    return {"cols": columns, "rows": []}


# MK's header skips 9/23: the columns after it carry the weekday before their date
MK_COLS = cols(date(2026, 9, 19), date(2026, 9, 22)) + [
    {"iso": "2026-09-24", "weekday": "WED"}, {"iso": "2026-09-25", "weekday": "THUR"},
    {"iso": "2026-09-26", "weekday": "FRI"}, {"iso": "2026-09-27", "weekday": "SAT"}]
DRAWN = cols(date(2026, 9, 12), date(2026, 10, 25))
GRIDS = [(H1, grid(DRAWN)), (H2, grid(DRAWN)), (H3, grid(MK_COLS))]
VIEW = {
    "locations": [H1, H2, H3],
    "by_code": {"ABD1711": H1, "ABD2000": H2, "MK11787": H3},
    "isos": {H1: [c["iso"] for c in DRAWN], H2: [c["iso"] for c in DRAWN], H3: [c["iso"] for c in MK_COLS]},
    "people": {H1: ["Ann Roe", "Bob Bee", "Ann Marie Roe", "OPEN", "WORKSHOP (JH)"], H2: ["Ann Roe"],
               H3: ["Ann Roe"]},
    "cells": {
        H1: {("Ann Roe", "2026-09-20"): "11P-7A", ("Ann Roe", "2026-09-22"): "7A-3P",
             ("Ann Roe", "2026-09-23"): "ADMIN", ("Ann Roe", "2026-09-25"): "C/O",
             ("Ann Roe", "2026-09-27"): "OFF", ("Bob Bee", "2026-09-22"): "7A-3P",
             ("Ann Marie Roe", "2026-09-21"): "7A-3P", ("OPEN", "2026-09-22"): "8A-4P",
             ("WORKSHOP (JH)", "2026-09-22"): "9A-3P"},
        H2: {("Ann Roe", "2026-09-22"): "48TH (B)", ("Ann Roe", "2026-09-24"): "11P-7A"},
        H3: {("Ann Roe", "2026-09-25"): "7A-3P", ("Ann Roe", "2026-09-26"): "3P-11P"},
    },
}
PUBLISHED = [
    {"location": H1, "employee": "Ann Roe", "col_iso": "2026-09-22", "value": "7A-3P", "pending": True,
     "test_mode": False, "rehearsal": False, "actor": "Hal Desk"},
    {"location": H1, "employee": "Ann Roe", "col_iso": "2026-09-23", "value": "ADMIN", "pending": True,
     "test_mode": True, "rehearsal": False, "actor": "Hal Desk"},
    {"location": H2, "employee": "ann roe", "col_iso": "2026-09-24", "value": "11P-7A", "pending": True,
     "test_mode": True, "rehearsal": True, "actor": "Hal Desk"},
    {"location": H1, "employee": "Bob Bee", "col_iso": "2026-09-22", "value": "7A-3P", "pending": True,
     "test_mode": False, "rehearsal": False, "actor": "Hal Desk"},
]
POOL = [{"location": H1, "open_row": "Ann Roe", "col_iso": "2026-09-25", "ref": "SP1", "filled_by": "Cy Far",
         "closed_at": None},
        {"location": H1, "open_row": "Bob Bee", "col_iso": "2026-09-22", "ref": "SP2", "filled_by": "Dan Doe",
         "closed_at": None}]
HANDOFFS = [{"id": "HO1", "location": H2, "col_iso": "2026-09-24", "value": "11P-7A", "from_staff": "ann roe",
             "to_staff": "Eve Taker", "state": "pending", "staff_via": "", "manager_via": "", "director_via": ""},
            {"id": "HO2", "location": H1, "col_iso": "2026-09-22", "value": "7A-3P", "from_staff": "Ann Roe",
             "to_staff": "Eve Taker", "state": "pending", "staff_via": "rehearsal:app", "manager_via": "",
             "director_via": ""}]
OFF_ROWS = [
    {"id": "TO00000000A1", "person": "Ann Roe", "status": "scheduled", "start_date": "2026-09-22",
     "end_date": "2026-09-22"},
    {"id": "TO00000000B1", "person": "Ann Roe", "status": "pending", "start_date": "2026-09-24",
     "end_date": "2026-09-24"},
    {"id": "TO00000000C1", "person": "Ann Roe", "status": "denied", "start_date": "2026-09-21",
     "end_date": "2026-09-21"},
]
KEYS = {"annroe"}


def run_shifts(keys=KEYS, mon=MON, sun=SUN, view=VIEW, grids=GRIDS, **over):
    kw = dict(tokens=TOKENS, homes=HOMES, managers=MANAGERS, published=PUBLISHED, pool=POOL, handoffs=HANDOFFS,
              off_rows=OFF_ROWS)
    kw.update(over)
    return mc.shifts(view, grids, keys, mon, sun, **kw)


def day(days, iso):
    return next(d for d in days if d["iso"] == iso)


def marks(card):
    return [m["kind"] for m in card["marks"]]


print("\nthe week: Monday to Sunday, on the Ohio today")
check("a Sunday snaps to its own week's Monday", mc.week_of(date(2026, 9, 27)) == (MON, SUN)
      and mc.parse_week("2026-09-27", TODAY) == MON and mc.parse_week("", TODAY) == MON)
check("the week of the clock change runs Monday Oct 26 to Sunday Nov 1",
      mc.parse_week("2026-11-01", TODAY) == date(2026, 10, 26) and mc.week_of(date(2026, 11, 1))[1] == date(2026, 11, 1))
check("the year boundary: Jan 1 2027 is in the week of Mon Dec 28 2026 to Sun Jan 3 2027",
      mc.week_of(date(2027, 1, 1)) == (date(2026, 12, 28), date(2027, 1, 3))
      and mc.parse_week("2027-01-01", TODAY) == date(2026, 12, 28))
bad_weeks = []
for raw in ("2026-9-1", "2026-02-30", "next week", "2026-09-21T00:00", "2028-01-03", "2025-08-01"):
    try:
        mc.parse_week(raw, TODAY)
        bad_weeks.append(raw)
    except mc.BadWeek:
        pass
check("a week that is not a day, not on the calendar, or beyond 53 weeks either side is refused", not bad_weeks,
      bad_weeks)
check("53 weeks either side is within reach, 54 is not",
      mc.in_reach(MON + timedelta(weeks=53), TODAY) and not mc.in_reach(MON + timedelta(weeks=54), TODAY)
      and mc.in_reach(MON - timedelta(weeks=53), TODAY))
check("today comes from My Work's Ohio today", mc.today.__code__.co_names == ("mw", "today"))

print("\nthe week: shifts from the live calendars, cut to the person")
DAYS = run_shifts()
check("seven days, Monday first", [d["iso"] for d in DAYS] == [(MON + timedelta(days=i)).isoformat() for i in range(7)])
tue = day(DAYS, "2026-09-22")
check("hours at one house plus the other grid's pointer to it: one card, the pointer in `also`",
      tue["state"] == "shifts" and len(tue["cards"]) == 1 and tue["cards"][0]["shift_code"] == "7A-3P"
      and tue["cards"][0]["house"] == "48TH (B)" and tue["cards"][0]["also"] == [{"house": "ORCHARD", "token": "48TH (B)"}],
      tue)
c22 = tue["cards"][0]
check("the card carries the panel's facts: house name, address, manager, Ohio instants, hours",
      c22["house_name"] == "48TH (B) home" and c22["address"] == "4801 Meadowlane Ave" and c22["manager"] == "Mia Manager"
      and c22["shift_start"] == "2026-09-22T07:00:00-04:00" and c22["shift_end"] == "2026-09-22T15:00:00-04:00"
      and c22["hours"] == 8.0 and c22["hours_known"] is True and c22["overnight"] is False
      and c22["id"] == "ABD1711:2026-09-22:0" and c22["kind"] == "morning", c22)
check("a just-published cell is marked, and the scheduled time off covering it too",
      marks(c22) == ["pending_publish", "off_scheduled"] and "TO00000000A1" in c22["marks"][1]["words"], c22["marks"])
check("the day carries its time off", tue["off"] == {"state": "scheduled", "ref": "TO00000000A1"}, tue["off"])
check("a rehearsed transfer offer marks nothing", "offered" not in marks(c22))
wed = day(DAYS, "2026-09-23")
check("an alias alone (ADMIN) is a card whose hours are not known, marked held by test mode",
      wed["state"] == "shifts" and len(wed["cards"]) == 1 and wed["cards"][0]["hours_known"] is False
      and wed["cards"][0]["shift_code"] == "ADMIN" and wed["cards"][0]["hours"] is None
      and marks(wed["cards"][0]) == ["test_mode"], wed)
thu = day(DAYS, "2026-09-24")
night = thu["cards"][0] if thu["cards"] else {}
check("an overnight 11P-7A on 9/24 starts 9/24 23:00 Ohio and ends 9/25, drawn on its start day only",
      night.get("shift_start") == "2026-09-24T23:00:00-04:00" and night.get("shift_end") == "2026-09-25T07:00:00-04:00"
      and night.get("overnight") is True and night.get("hours") == 8.0
      and not any(c["shift_code"] == "11P-7A" for c in day(DAYS, "2026-09-25")["cards"]), night)
check("a rehearsal square, an open transfer offer and asked time off are all marked on it",
      marks(night) == ["rehearsal", "offered", "off_asked"], night.get("marks"))
check("MK's misdated column is said on the day beside the shifts that stand",
      thu["notes"] == ["MK's calendar has a column whose date and weekday disagree, so what it holds for this day is "
                       "not shown."], thu["notes"])
fri = day(DAYS, "2026-09-25")
check("a called-off shift is a muted card saying called off and covered, and MK's misdated 7A-3P is dropped",
      [c["shift_code"] for c in fri["cards"]] == ["C/O"] and fri["cards"][0]["kind"] == "ro"
      and marks(fri["cards"][0]) == ["called_off", "covered"] and fri["notes"], fri)
check("the coverer is never named, whatever the mode", "Cy Far" not in json.dumps(DAYS) and "Dan Doe" not in json.dumps(DAYS))
taken_back = run_shifts(pool=[dict(POOL[0], filled_by="ann  roe")])
check("a call-off the caller took back is no call-off",
      marks(day(taken_back, "2026-09-25")["cards"][0]) == [], day(taken_back, "2026-09-25"))
sat = day(DAYS, "2026-09-26")
check("a day whose only cell sits in a misdated column is unreadable in words, never 'none'",
      sat["state"] == "unreadable" and "MK's calendar has a column whose date and weekday disagree" in sat["why"]
      and sat["cards"] == [], sat)
sun = day(DAYS, "2026-09-27")
check("an OFF cell is the day off, with no card", sun["state"] == "off" and sun["cards"] == [], sun)
mon = day(DAYS, "2026-09-21")
check("the Sunday 9/20 overnight is not drawn on Monday 9/21, and a namesake's shift is not hers: 'none'",
      mon["state"] == "none" and mon["cards"] == [] and mon["why"] == "", mon)
blob = json.dumps(DAYS)
check("nobody else's shift leaves: not Bob Bee's, not the namesake's, not the offer's taker",
      all(n not in blob for n in ("Bob Bee", "Ann Marie Roe", "Eve Taker", "Hal Desk")), blob[:400])
oddrows = run_shifts(keys={"open", "workshopjh"})
check("OPEN and WORKSHOP rows are never shown, even to a key that folds to them",
      all(d["cards"] == [] for d in oddrows) and all(d["state"] == "not_listed" for d in oddrows), oddrows[0])
later = run_shifts(mon=date(2026, 10, 26), sun=date(2026, 11, 1))
check("a week past every drawn column is not drawn, said as not shown yet — never 'No shifts'",
      all(d["state"] == "not_drawn" and d["why"] == "No house calendar that lists you shows this day yet."
          for d in later), later[0])
earlier = run_shifts(mon=date(2026, 9, 7), sun=date(2026, 9, 13))
check("a week before the drawn columns: the days no calendar still shows say so; the drawn ones are 'none'",
      [d["state"] for d in earlier] == ["not_drawn"] * 5 + ["none"] * 2
      and earlier[0]["why"] == "No house calendar that lists you still shows this day.", earlier)
nobody = run_shifts(keys={"zedzee"})
check("a person on no grid is 'not listed', in words", all(d["state"] == "not_listed" for d in nobody)
      and nobody[0]["why"] == "You are not on any house calendar.", nobody[0])
check("…said of a chosen person in the third person",
      run_shifts(keys={"zedzee"}, you=False)[0]["why"] == "This person is not on any house calendar.")
check("the weekday guard: only the columns whose date and word disagree are misdated, each naming the day its "
      "word does",
      mc.misdated(GRIDS) == {(H3, "2026-09-24"): "2026-09-23", (H3, "2026-09-25"): "2026-09-24",
                             (H3, "2026-09-26"): "2026-09-25", (H3, "2026-09-27"): "2026-09-26"},
      mc.misdated(GRIDS))
check("…a word that is no weekday is not judged",
      mc.misdated([(H1, grid([{"iso": "2026-09-22", "weekday": "HOLIDAY"}]))]) == {})
check("the day a misdated column's word names is said too, beside the shifts that stand",
      wed["notes"] == thu["notes"] and len(wed["notes"]) == 1, wed["notes"])
SKIP_A = cols(date(2026, 9, 21), date(2026, 9, 27))
SKIP_B = cols(date(2026, 9, 21), date(2026, 9, 22)) + [{"iso": "2026-09-24", "weekday": "WED"}]
SKIP_VIEW = {"locations": [H1, H3], "isos": {H1: [c["iso"] for c in SKIP_A], H3: [c["iso"] for c in SKIP_B]},
             "people": {H1: ["Ann Roe"], H3: ["Ann Roe"]},
             "cells": {H1: {("Ann Roe", "2026-09-21"): "7A-3P"}, H3: {("Ann Roe", "2026-09-24"): "7A-3P"}}}
skip = mc.shifts(SKIP_VIEW, [(H1, grid(SKIP_A)), (H3, grid(SKIP_B))], KEYS, MON, SUN, tokens=TOKENS, homes=HOMES,
                 managers=MANAGERS)
check("a skipped header: the day its misdated column really holds is unreadable, never 'No shifts', though "
      "another calendar draws it empty — and so is the column's own date; the other days stand",
      [d["state"] for d in skip] == ["shifts", "none", "unreadable", "unreadable", "none", "none", "none"]
      and all("MK's calendar" in skip[i]["why"] for i in (2, 3)), [(d["iso"], d["state"]) for d in skip])
unmarked = run_shifts(published=None, pool=None, handoffs=None, off_rows=None)
check("marks that could not be read mark nothing (the week says so)",
      all(c["marks"] == [] for d in unmarked for c in d["cards"]) and all(d["off"] is None for d in unmarked))

DST_DRAWN = cols(date(2026, 10, 24), date(2026, 11, 7))
DST_VIEW = {"locations": [H1], "isos": {H1: [c["iso"] for c in DST_DRAWN]}, "people": {H1: ["Ann Roe"]},
            "cells": {H1: {("Ann Roe", "2026-10-31"): "11P-7A"}}}
dst = mc.shifts(DST_VIEW, [(H1, grid(DST_DRAWN))], KEYS, date(2026, 10, 26), date(2026, 11, 1), tokens=TOKENS,
                homes=HOMES, managers=MANAGERS)
dnight = day(dst, "2026-10-31")["cards"][0]
check("across the fall-back night: the end is in standard time and the hours are the nine really worked",
      dnight["shift_start"] == "2026-10-31T23:00:00-04:00" and dnight["shift_end"] == "2026-11-01T07:00:00-05:00"
      and dnight["hours"] == 9.0 and day(dst, "2026-11-01")["cards"] == [], dnight)
MIDNIGHT_VIEW = {"locations": [H1], "isos": {H1: [c["iso"] for c in DRAWN]}, "people": {H1: ["Ann Roe"]},
                 "cells": {H1: {("Ann Roe", "2026-09-24"): "4P-12A"}}}
mid = day(mc.shifts(MIDNIGHT_VIEW, [(H1, grid(DRAWN))], KEYS, MON, SUN, tokens=TOKENS, homes=HOMES,
                    managers=MANAGERS), "2026-09-24")["cards"][0]
check("a shift ending at 12A ends on the next day but is no overnight, as classify reads a night",
      mid["shift_end"] == "2026-09-25T00:00:00-04:00" and mid["overnight"] is False and mid["hours"] == 8.0, mid)

TO_R = "TO00000000R1"
RO_VIEW = {"locations": [H1], "isos": {H1: [c["iso"] for c in DRAWN]}, "people": {H1: ["Ann Roe"]},
           "cells": {H1: {("Ann Roe", "2026-09-22"): "R/O", ("Ann Roe", "2026-09-23"): "ADMIN",
                          ("Ann Roe", "2026-09-24"): "7A-3P", ("Ann Roe", "2026-09-25"): "R/O"}}}
RO_OFF = [{"id": TO_R, "person": "Ann Roe", "status": "scheduled", "start_date": "2026-09-22",
           "end_date": "2026-09-24"},
          {"id": "TO00000000R2", "person": "Ann Roe", "status": "pending", "start_date": "2026-09-25",
           "end_date": "2026-09-25"}]
ro_days = mc.shifts(RO_VIEW, [(H1, grid(DRAWN))], KEYS, MON, SUN, tokens=TOKENS, homes=HOMES, managers=MANAGERS,
                    off_rows=RO_OFF)
ro_tue, ro_wed, ro_thu, ro_fri = (day(ro_days, f"2026-09-{n}") for n in (22, 23, 24, 25))
check("an approved request and the R/O square it staged on the same day: the day carries the time off, the "
      "R/O card no time off mark",
      ro_tue["off"] == {"state": "scheduled", "ref": TO_R} and [c["kind"] for c in ro_tue["cards"]] == ["ro"]
      and marks(ro_tue["cards"][0]) == [], ro_tue)
check("…and an R/O square on a day only asked for carries no mark either",
      ro_fri["off"] == {"state": "asked", "ref": "TO00000000R2"} and marks(ro_fri["cards"][0]) == [], ro_fri)
PUB_KEY = (H1, mc.sr.fold("Ann Roe"), "2026-09-25")
PUB_OFF = [(date(2026, 9, 24), date(2026, 9, 26), "scheduled", "TO0001")]
PUB_ASK = [(date(2026, 9, 24), date(2026, 9, 26), "asked", "TO0002")]
pub_marks = {label: [m["kind"] for m in mc._marks(H1, "Ann Roe", "2026-09-25", "R/O", "ro", pub={PUB_KEY: entry},
                                                  offs={}, offered=set(), intervals=iv)]
             for label, entry, iv in (("settled", {"pending": False}, PUB_OFF),
                                      ("pending", {"pending": True}, PUB_OFF),
                                      ("test_mode", {"test_mode": True}, PUB_ASK))}
check("an R/O square that went through a Builder publish keeps no time off mark: only its publish chip",
      pub_marks == {"settled": [], "pending": ["pending_publish"], "test_mode": ["test_mode"]}, pub_marks)
check("a real clash keeps its mark: hours still on the calendar during approved time off",
      marks(ro_thu["cards"][0]) == ["off_scheduled"]
      and ro_thu["cards"][0]["marks"][0]["words"] == f"On approved time off ({TO_R}), and still on the calendar "
                                                    f"under this name", ro_thu["cards"][0])
check("a working cell whose hours cannot be read, inside approved time off: marked in neutral words",
      marks(ro_wed["cards"][0]) == ["off_scheduled"]
      and ro_wed["cards"][0]["marks"][0]["words"] == f"Approved time off ({TO_R}) covers this day"
      and "still on the calendar" not in json.dumps(ro_wed), ro_wed["cards"][0])

R3_VIEW = {"locations": [H1, H2], "isos": {H1: [c["iso"] for c in DRAWN], H2: [c["iso"] for c in DRAWN]},
           "people": {H1: ["Ann Roe"], H2: ["Ann Roe"]},
           "cells": {H1: {("Ann Roe", "2026-09-22"): "7A-3P"}, H2: {("Ann Roe", "2026-09-22"): "MK"}}}
r3 = day(mc.shifts(R3_VIEW, [(H1, grid(DRAWN)), (H2, grid(DRAWN))], KEYS, MON, SUN, tokens=TOKENS, homes=HOMES,
                   managers=MANAGERS), "2026-09-22")
r3_by = {c["shift_code"]: c for c in r3["cards"]}
check("a house token naming a house with no hours that day is a card of its own, its hours not known — never a "
      "pointer on another house's card",
      set(r3_by) == {"7A-3P", "MK"} and r3_by["7A-3P"]["also"] == [] and r3_by["MK"]["hours_known"] is False
      and r3_by["MK"]["hours"] is None and r3_by["MK"]["house"] == "ORCHARD", r3["cards"])

print("\nthe week part: every read on its own, failing closed")
READERS = {"estate": lambda dsn: VIEW, "grids": lambda dsn: (GRIDS, NOW - timedelta(minutes=10)),
           "tokens": lambda dsn: TOKENS, "published": lambda dsn, a, b: PUBLISHED,
           "pool": lambda db, days, keys: POOL, "handoffs": lambda dsn, keys, a, b: HANDOFFS,
           "homes": lambda dsn: HOMES}


def run_week(keys=KEYS, readers=None, off_rows=OFF_ROWS, off_why="", now=NOW):
    return mc.week_part("dsn", keys, MON, SUN, key_why="", off_rows=off_rows, off_why=off_why, you=True, db=None,
                        managers=MANAGERS, readers={**READERS, **(readers or {})}, now=now)


wk = run_week()
check("a readable week is ready, stamped in UTC for the screen to say in Ohio time, and fresh",
      wk["head"] == {"state": "ready", "why": "", "copied_at": "2026-09-24T14:50:00Z", "stale": False, "stale_why": ""}
      and wk["notes"] == [], wk["head"])
check("a copy older than 35 minutes is stale, in words",
      run_week(now=NOW + timedelta(minutes=40))["head"]["stale"] is True
      and "more than 35 minutes" in run_week(now=NOW + timedelta(minutes=40))["head"]["stale_why"])
noattr = mc.week_part("dsn", set(), MON, SUN, key_why="your name is shared with another account", off_rows=None,
                      off_why="", you=True, db=None, managers=MANAGERS, readers=READERS)
check("no keys: not attributable, every day in words — never 'none', never an empty list",
      noattr["head"]["state"] == "not_attributable"
      and noattr["head"]["why"] == "Your name is shared with another account"
      and len(noattr["days"]) == 7 and all(d["state"] == "unreadable" and d["why"] for d in noattr["days"]), noattr)


def boom(*a, **k):
    raise RuntimeError("down")


down = run_week(readers={"estate": boom})
check("the estate raising: every day unreadable, with the sentence, never 'none'",
      down["head"]["state"] == "unreadable"
      and down["head"]["why"] == "The house calendars could not be read (RuntimeError), so this week is not shown."
      and all(d["state"] == "unreadable" and d["why"] == down["head"]["why"] for d in down["days"]), down["head"])
check("…and the grids read failing is the same: the weekday guard cannot be applied",
      run_week(readers={"grids": boom})["head"]["state"] == "unreadable")
check("…and no calendar copied at all is said, not 'You are not on any house calendar'",
      run_week(readers={"estate": lambda dsn: {"locations": []}})["head"]["state"] == "unreadable")
partial = run_week(readers={"published": boom, "pool": boom, "handoffs": boom, "homes": boom}, off_rows=None,
                   off_why="The time off records could not be read (X), so no day here is marked as time off.")
check("a mark read that fails marks nothing and says so once each; the week still stands",
      partial["head"]["state"] == "ready" and len(partial["notes"]) == 5
      and all("could not be read" in n for n in partial["notes"])
      and day(partial["days"], "2026-09-22")["cards"][0]["marks"] == []
      and day(partial["days"], "2026-09-22")["cards"][0]["address"] == "", partial["notes"])

print("\nthe requests: the person ON the request, grouped at the Ohio today")


def to_row(ref, person, status, start, end, **over):
    base = {"id": ref, "createdAt": "2026-09-01T12:00:00.000Z", "updatedAt": "2026-09-01T12:00:00.000Z",
            "person": person, "person_key": sr.fold(person), "start_date": start, "end_date": end, "days": "",
            "houses": "ABD1711", "reason_given": "no", "time_off_reason": "", "status": status, "status_why": "",
            "filed_by": person, "filed_by_key": sr.fold(person), "filed_via": "platform", "hm_mode": "house_manager",
            "hm_asked": "Mia Manager", "hm_why": "", "hm_state": "waiting", "hm_by": "", "hm_via": "", "hm_at": "",
            "hm_note": "", "dir_asked": "Nora Vale", "dir_state": "waiting", "dir_by": "", "dir_via": "", "dir_at": "",
            "dir_note": "", "decided_at": "", "closed_by": "", "closed_at": "", "closed_note": "", "effects": "",
            "test_mode": "", "source": "platform", "flags": ""}
    base.update(over)
    return base


TO_ROWS = [
    to_row("TO0000000001", "Ann Roe", "pending", D(40), D(42), reason_given="yes", time_off_reason="MY OWN REASON"),
    to_row("TO0000000002", "Ann Roe", "scheduled", "2026-09-22", "2026-09-22", hm_state="approved",
           hm_by="Mia Manager", dir_state="approved", dir_by="Nora Vale"),
    to_row("TO0000000003", "Ann Roe", "scheduled", "2026-09-23", "2026-09-26", hm_state="migrated",
           dir_state="migrated", reason_given="yes"),
    to_row("TO0000000004", "Ann Roe", "scheduled", "2026-10-05", "2026-10-09", hm_state="approved",
           dir_state="approved"),
    to_row("TO0000000005", "Ann Roe", "needs_review", "2026-09-20", "2026-09-21"),
    to_row("TO0000000006", "Ann Roe", "denied", D(3), D(4), closed_by="Nora Vale", closed_note="short staffed"),
    to_row("TO0000000007", "Ann Roe", "history", "2026-03-02", "2026-03-06", filed_via="form"),
    # filed BY Ann for somebody else: never hers
    to_row("TO0000000008", "Dee Way", "pending", D(5), D(6), filed_by="Ann Roe", filed_by_key="annroe"),
    # filed FOR Ann by somebody else: hers
    to_row("TO0000000009", "Ann Roe", "pending", D(50), D(51), filed_by="Hal Desk", filed_by_key="haldesk",
           filed_via="phone"),
    # a namesake with a middle name: another person
    to_row("TO0000000010", "Ann Marie Roe", "pending", D(7), D(8)),
    to_row("TO0000000011", "Ann Roe", "scheduled", "2025-12-29", "2026-01-02", hm_state="migrated",
           dir_state="migrated"),
    to_row("TO0000000012", "Ann Roe", "pending", "2026-12-30", "2027-01-03", test_mode="on"),
]
TO_VIEW = {"minted": True, "id": "house", "rows": TO_ROWS, "settings": {"directors": "Nora Vale"},
           "as_of": "2026-09-24T14:00:00.000Z", "read_at": ""}
time_off.view = lambda dsn, fresh=False: TO_VIEW
REASON_CALLS: list[str] = []


def reason_of(dsn, row):
    REASON_CALLS.append(str(row.get("id")))
    return "family wedding", ""


time_off.reason_of = reason_of
sr.estate = lambda dsn, fresh=False: VIEW

FACTS = {mw.PTR_PEOPLE: "S_PEOPLE"}
PEOPLE = [{"id": "PPL_ANN", "name": "Ann Roe", "email": "ann@example.com", "status": "active"},
          {"id": "PPL_BOB", "name": "Bob Bee", "email": "bob@x.com", "status": "active"},
          {"id": "PPL_TIA1", "name": "Tia Twin", "email": "tia1@x.com", "status": "active"},
          {"id": "PPL_TIA2", "name": "Tia  Twin", "email": "tia2@x.com", "status": "active"},
          {"id": "PPL_BOSS", "name": "The Boss", "email": "boss@asa.example", "status": "active"}]


class FakeDb:
    """The roster reads the chooser makes, answered from memory."""

    def __init__(self, people=PEOPLE, tab_error=None):
        self.people = people
        self.tab_error = tab_error
        self.closed = False

    def pointers(self):
        return dict(FACTS)

    def tab(self, sid, tab, where="", args=()):
        if self.tab_error is not None:
            raise self.tab_error
        rows = self.people if (sid, tab) == ("S_PEOPLE", "Data") else []
        return [dict(r) for r in rows], len(rows), "2026-09-24T12:00:00Z"

    def accounts_for(self, core, roster_id, emails):
        return []

    def close(self):
        self.closed = True


ME = mw.identity_from({"user_id": "u-ann", "display_name": "Ann Roe", "email": "ann@example.com", "active": "TRUE"},
                      "u-ann", roster_name="Ann Roe", people=[])
WHO = sr.viewer("dsn", name="Ann Roe", role="staff", types="STAFF")
MASTER_ME = mw.identity_from({"user_id": "u-boss", "display_name": "The Boss", "active": "TRUE"}, "u-boss",
                             roster_name="The Boss", people=[])
MASTER_WHO = sr.viewer("dsn", name="The Boss", role="admin", types="ADMIN", is_master=True)
OPEN = {"open": True, "why": ""}


def run(mode=mc.MODE_OWN, me=ME, who=WHO, person="", week=MON, time_off_open=OPEN, readers=None, db=None):
    return mc.answer("dsn", "core", mode=mode, me=me, who=who, person=person, week=week, on=TODAY,
                     scope_why="", time_off_open=time_off_open, db=db or FakeDb(),
                     readers={**READERS, **(readers or {})}, now=NOW)


A = run()
rows = {r["ref"]: r for r in A["requests"]["rows"]}
check("only the requests whose PERSON is her: filed-for-her in, filed-by-her-for-another out, the namesake out",
      set(rows) == {"TO0000000001", "TO0000000002", "TO0000000003", "TO0000000004", "TO0000000005", "TO0000000006",
                    "TO0000000007", "TO0000000009", "TO0000000011", "TO0000000012"}, sorted(rows))
check("groups at the Ohio today: waiting, on now, approved ahead, concluded",
      {k: r["group"] for k, r in rows.items()} == {
          "TO0000000001": "pending", "TO0000000005": "pending", "TO0000000009": "pending", "TO0000000012": "pending",
          "TO0000000003": "ongoing", "TO0000000004": "upcoming", "TO0000000002": "concluded",
          "TO0000000006": "concluded", "TO0000000007": "concluded", "TO0000000011": "concluded"},
      {k: r["group"] for k, r in rows.items()})
check("the pills: Waiting, Needs review, On now, Approved, Taken, Denied, On record",
      [rows[k]["word"] for k in ("TO0000000001", "TO0000000005", "TO0000000003", "TO0000000004", "TO0000000002",
                                 "TO0000000006", "TO0000000007")]
      == ["Waiting", "Needs review", "On now", "Approved", "Taken", "Denied", "On record"])
order = [r["group"] for r in A["requests"]["rows"]]
check("the rows come grouped in order, the concluded newest first",
      order == sorted(order, key=mc.GROUP_ORDER.index)
      and [r["ref"] for r in A["requests"]["rows"] if r["group"] == "concluded"]
      == ["TO0000000006", "TO0000000002", "TO0000000007", "TO0000000011"], A["requests"]["rows"])
check("a request someone else filed for her says so", rows["TO0000000009"]["filed_by_other"] is True
      and rows["TO0000000001"]["filed_by_other"] is False)
check("her own waiting request's reason is read for her; a closed one's is only said to be given",
      "family wedding" in json.dumps(rows["TO0000000001"]["details"]) and REASON_CALLS == ["TO0000000001"]
      and {"label": "Reason", "value": "Given — Time Off shows it on the request"} in rows["TO0000000003"]["details"],
      [REASON_CALLS, rows["TO0000000003"]["details"]])
check("a row filed under test mode says so", rows["TO0000000012"]["test_mode"] is True)
check("the figure: approved days in the Ohio year (past, now and ahead, clipped to it), waiting days beside it, "
      "the form's history apart — no allowance invented",
      A["requests"]["figure"] == {"year": 2026, "approved_days": 12, "waiting_days": 9, "on_record_days": 5},
      A["requests"]["figure"])
m1, m2, m4, m5, m6 = (rows[k]["may"] for k in ("TO0000000001", "TO0000000002", "TO0000000004", "TO0000000005",
                                                 "TO0000000006"))
check("a waiting request not yet started: withdraw and change both open, no warning",
      m1 == {"withdraw": True, "withdraw_why": "", "withdraw_warns": "", "edit": True, "edit_why": "",
             "edit_warns": ""}, m1)
check("an approved request that has started: nothing here, each said",
      m2["withdraw"] is False and m2["withdraw_why"] == mc.WITHDRAW_STARTED and m2["edit"] is False
      and m2["edit_why"] == mc.EDIT_SCHEDULED_STARTED == "It has started, so its dates are not changed here."
      and m2["edit_warns"] == "", m2)
check("an approved request ahead: withdraw (with what stays on the calendar), and new dates, warned first that "
      "both approvals start over",
      m4["withdraw"] is True and m4["withdraw_warns"] == mc.WITHDRAW_WARNS and m4["edit"] is True
      and m4["edit_why"] == ""
      and m4["edit_warns"].startswith("Changing the dates sends this request for approval again; both approvals "
                                      "start over."), m4)
m3 = rows["TO0000000003"]["may"]
check("an approved request on now: its dates are not changed here, in words",
      m3["edit"] is False and m3["edit_why"] == mc.EDIT_SCHEDULED_STARTED and m3["withdraw"] is False, m3)
check("a request under review that has started: withdraw yes, change no — for staff",
      m5["withdraw"] is True and m5["edit"] is False and m5["edit_why"] == mc.EDIT_STARTED, m5)
check("a closed request: nothing to withdraw, in words", m6["withdraw_why"] == "Nothing to withdraw: it is denied."
      and m6["edit_why"] == "Nothing to change: it is denied.", m6)
check("the form: filing open for the session's own name, the Time Off limits, the earliest day today for staff",
      A["form"] == {"may_file": True, "may_file_why": "", "file_for": "", "reason_max": time_off.REASON_MAX,
                    "max_days": time_off.MAX_DAYS, "earliest": "2026-09-24"}, A["form"])
check("the answer's shape", set(A) == {"scope", "person", "today", "week", "requests", "form", "test_mode", "read_at"}
      and A["scope"] == {"mode": "own", "why": "", "person": ""} and A["person"] == {"own": True, "name": "Ann Roe",
                                                                                     "key_why": ""}
      and A["week"]["from"] == "2026-09-21" and A["week"]["to"] == "2026-09-27" and A["week"]["prev"] == "2026-09-14"
      and A["week"]["next"] == "2026-09-28" and A["week"]["this"] == "2026-09-21"
      and set(A["test_mode"]) == {"on", "readable", "why"} and "_mine" not in A["requests"], A["scope"])
check("the week's time off is the requests' own rows: approved 9/22, on now 9/23–9/26",
      day(A["week"]["days"], "2026-09-22")["off"] == {"state": "scheduled", "ref": "TO0000000002"}
      and day(A["week"]["days"], "2026-09-25")["off"] == {"state": "scheduled", "ref": "TO0000000003"})
LEAKS = ("Bob Bee", "Cy Far", "Dan Doe", "Dee Way", "Ann Marie Roe", "Eve Taker", "TO0000000008", "TO0000000010")
blob = json.dumps(A)
check("nothing of anybody else leaves: no other person, no coverer, no other applicant, no other request",
      not [n for n in LEAKS if n in blob], [n for n in LEAKS if n in blob])

print("\nthe withdraw rule is the Time Off door's own")
FILER = sr.viewer("dsn", name="Hal Desk", role="staff", types="STAFF")
STRANGER = sr.viewer("dsn", name="Zed Zee", role="staff", types="STAFF")
disagree = []
for st in time_off.STATUSES + ("paused",):
    for start in (D(-2), D(0), D(1), ""):
        raw = to_row("TO00000000FF", "Ann Roe", st, start, start or D(3), filed_by="Hal Desk", filed_by_key="haldesk")
        for reader in (WHO, FILER, STRANGER, MASTER_WHO):
            for you in (True, False):
                got = mc.may_of(reader, raw, you=you, on=TODAY, word=st)
                w = time_off.may_withdraw(reader, raw, TODAY)
                if got["withdraw"] != w:
                    disagree.append((st, start, reader["name"], you))
                ahead = bool(start) and date.fromisoformat(start) > TODAY
                if st == time_off.SCHEDULED and got["edit"] != (w and ahead):
                    disagree.append(("edit on scheduled", start, reader["name"], you))
                if bool(got["edit_warns"]) != (got["edit"] and st == time_off.SCHEDULED):
                    disagree.append(("edit warning", st, start, reader["name"], you))
                if got["edit"] and not w:
                    disagree.append(("edit without withdraw", st, start, reader["name"], you))
                if not got["withdraw"] and not got["withdraw_why"]:
                    disagree.append(("no withdraw sentence", st, start, reader["name"], you))
                if not got["edit"] and not got["edit_why"]:
                    disagree.append(("no edit sentence", st, start, reader["name"], you))
                if not you and not w and st in (time_off.PENDING, time_off.REVIEW) \
                        and got["withdraw_why"] != mc.NOT_YOURS_CHOSEN:
                    disagree.append(("chooser sentence", st, start, reader["name"]))
check("may.withdraw equals time_off.may_withdraw for every status, date, reader and view; an approved one changes "
      "only when it may be withdrawn and its first day is ahead, and only then is warned; every no carries its "
      "sentence", not disagree, disagree)
check("an every-house reader may change a waiting request that has started",
      mc.may_of(MASTER_WHO, to_row("TO00000000FE", "The Boss", "pending", D(-1), D(1)), you=True,
                on=TODAY, word="Waiting")["edit"] is True)
check("…but never an approved one that has started, even the master's own, even one day in",
      mc.may_of(MASTER_WHO, to_row("TO00000000FD", "The Boss", "scheduled", D(0), D(3)), you=True, on=TODAY,
                word="On now")["edit_why"] == mc.EDIT_SCHEDULED_STARTED
      and mc.may_of(MASTER_WHO, to_row("TO00000000FC", "The Boss", "scheduled", D(1), D(3)), you=True, on=TODAY,
                    word="Approved")["edit"] is True)
check("group boundaries at the Ohio today",
      mc.group_of("scheduled", TODAY, TODAY, TODAY) == "ongoing"
      and mc.group_of("scheduled", TODAY + timedelta(days=1), TODAY + timedelta(days=2), TODAY) == "upcoming"
      and mc.group_of("scheduled", TODAY - timedelta(days=3), TODAY - timedelta(days=1), TODAY) == "concluded"
      and mc.group_of("scheduled", TODAY - timedelta(days=1), TODAY, TODAY) == "ongoing"
      and mc.group_of("needs_review", TODAY - timedelta(days=9), TODAY - timedelta(days=8), TODAY) == "pending"
      and mc.group_of("expired", None, None, TODAY) == "concluded")
check("the figure clips to the year on both ends",
      mc.figure([to_row("TOX", "Ann Roe", "scheduled", "2025-12-31", "2026-01-01"),
                 to_row("TOY", "Ann Roe", "needs_review", "2026-12-31", "2027-01-02"),
                 to_row("TOZ", "Ann Roe", "history", "2025-01-01", "2025-01-09"),
                 to_row("TOW", "Ann Roe", "withdrawn", "2026-05-01", "2026-05-09")], TODAY)
      == {"year": 2026, "approved_days": 1, "waiting_days": 1, "on_record_days": 0})

print("\nthe master: a chooser over the whole roster; files for the person chosen, changes only what it filed")
REASON_CALLS.clear()
BOSS = {"filed_by": "The Boss", "filed_by_key": "theboss"}
BOSS_ROWS = [
    to_row("TO00000000M1", "Ann Roe", "pending", D(20), D(21), **BOSS),
    to_row("TO00000000M2", "Ann Roe", "scheduled", D(30), D(31), hm_state="approved", dir_state="approved", **BOSS),
    to_row("TO00000000M3", "Ann Roe", "scheduled", D(-1), D(2), hm_state="approved", dir_state="approved", **BOSS),
]
BOSS_VIEW = dict(TO_VIEW, rows=TO_ROWS + BOSS_ROWS)
time_off.view = lambda dsn, fresh=False: BOSS_VIEW
M = run(mode=mc.MODE_MASS, me=MASTER_ME, who=MASTER_WHO, person="PPL_ANN")
check("the chooser is every staff roster row, by its id",
      [p["key"] for p in M["scope"]["people"]] == ["PPL_ANN", "PPL_BOB", "PPL_BOSS", "PPL_TIA1", "PPL_TIA2"]
      and M["scope"]["people_why"] == "" and M["scope"]["person"] == "PPL_ANN", M["scope"])
mrows = {r["ref"]: r for r in M["requests"]["rows"]}
check("a chosen person's calendar is exactly hers, cut by her roster name",
      set(mrows) == set(rows) | {"TO00000000M1", "TO00000000M2", "TO00000000M3"}
      and day(M["week"]["days"], "2026-09-22")["cards"][0]["shift_code"] == "7A-3P"
      and M["person"] == {"own": False, "name": "Ann Roe", "key_why": ""}, M["person"])
check("…Add files FOR her: the master may file, under the spelling Time Off files her under, from any day",
      M["form"]["may_file"] is True and M["form"]["may_file_why"] == "" and M["form"]["file_for"] == "Ann Roe"
      and M["form"]["earliest"] == "" and time_off._spell(VIEW, "dsn", "Ann Roe") == "Ann Roe", M["form"])
check("…a row she filed herself, or somebody else filed for her, is not the master's to change or withdraw",
      all(mrows[k]["may"]["withdraw"] is False and mrows[k]["may"]["edit"] is False
          and mrows[k]["may"]["withdraw_why"] == mc.NOT_YOURS_CHOSEN == mrows[k]["may"]["edit_why"]
          for k in ("TO0000000001", "TO0000000004", "TO0000000009", "TO0000000012"))
      and mc.NOT_YOURS_CHOSEN == ("Only the person or whoever filed it changes it; a director cancels an approved "
                                  "one in Time Off."),
      {k: mrows[k]["may"] for k in ("TO0000000001", "TO0000000004", "TO0000000009")})
check("…a row the master filed for her: changed and withdrawn while it waits",
      mrows["TO00000000M1"]["may"] == {"withdraw": True, "withdraw_why": "", "withdraw_warns": "", "edit": True,
                                       "edit_why": "", "edit_warns": ""}, mrows["TO00000000M1"]["may"])
check("…and while it is approved and ahead, warned that both approvals start over",
      mrows["TO00000000M2"]["may"]["edit"] is True and mrows["TO00000000M2"]["may"]["withdraw"] is True
      and mrows["TO00000000M2"]["may"]["edit_warns"] == mc.EDIT_WARNS_SCHEDULED, mrows["TO00000000M2"]["may"])
check("…but not once it has started, in words",
      mrows["TO00000000M3"]["may"]["edit"] is False
      and mrows["TO00000000M3"]["may"]["edit_why"] == mc.EDIT_SCHEDULED_STARTED
      and mrows["TO00000000M3"]["may"]["withdraw_why"] == mc.WITHDRAW_STARTED, mrows["TO00000000M3"]["may"])
check("…and her reasons are not read for the master's view", REASON_CALLS == [], REASON_CALLS)
mblob = json.dumps({k: v for k, v in M.items() if k != "scope"})
check("…with nothing of anybody else in it", not [n for n in LEAKS if n in mblob], [n for n in LEAKS if n in mblob])
UNREAD_EST = run(mode=mc.MODE_MASS, me=MASTER_ME, who=MASTER_WHO, person="PPL_ANN", readers={"estate": boom})
check("the calendars unreadable: nothing is filed for her, and no change of dates is offered, in words",
      UNREAD_EST["form"]["may_file"] is False and UNREAD_EST["form"]["may_file_why"] == mc.SPELLING_UNREAD
      and UNREAD_EST["form"]["file_for"] == ""
      and {r["ref"]: r["may"]["edit_why"] for r in UNREAD_EST["requests"]["rows"]}["TO00000000M1"] == mc.SPELLING_UNREAD
      and not any(r["may"]["edit"] for r in UNREAD_EST["requests"]["rows"])
      and {r["ref"]: r["may"]["withdraw"] for r in UNREAD_EST["requests"]["rows"]}["TO00000000M1"] is True,
      UNREAD_EST["form"])
Q_PEOPLE = PEOPLE + [{"id": "PPL_ANNQ", "name": "Ann Q Roe", "email": "annq@x.com", "status": "active"}]
QM = run(mode=mc.MODE_MASS, me=MASTER_ME, who=MASTER_WHO, person="PPL_ANNQ", db=FakeDb(people=Q_PEOPLE))
check("a chosen person Time Off would file under a spelling not read back here is not filed for, in words",
      QM["form"]["may_file"] is False and QM["form"]["may_file_why"] == mc.SPELLED_ELSEWHERE_CHOSEN
      and QM["form"]["file_for"] == "", QM["form"])
time_off.view = lambda dsn, fresh=False: TO_VIEW
STAFF_MASS = run(mode=mc.MODE_MASS, me=MASTER_ME, who=WHO, person="PPL_BOB")
check("whom a request may be filed for is Time Off's own reach: a reader who files for self only files nobody's",
      STAFF_MASS["form"]["may_file"] is False
      and STAFF_MASS["form"]["may_file_why"].startswith("You file time off for yourself only")
      and STAFF_MASS["form"]["file_for"] == "", STAFF_MASS["form"])
T = run(mode=mc.MODE_MASS, me=MASTER_ME, who=MASTER_WHO, person="PPL_TIA1")
check("a chosen name another roster row carries matches nothing: not attributable in words, never 'No shifts'",
      T["week"]["head"]["state"] == "not_attributable" and T["requests"]["state"] == "not_attributable"
      and "another row of the staff roster carries this name" in T["person"]["key_why"].lower()
      and all(d["state"] == "unreadable" for d in T["week"]["days"]) and T["requests"]["rows"] == [], T["person"])
check("…and nothing is filed for a name that matches nobody", T["form"]["may_file"] is False
      and T["form"]["may_file_why"] == mc.SPELLED_ELSEWHERE_CHOSEN, T["form"])
gone = None
try:
    run(mode=mc.MODE_MASS, me=MASTER_ME, who=MASTER_WHO, person="PPL_GONE")
except mp.NoSuchPerson as exc:
    gone = exc
check("a roster id nobody holds raises NoSuchPerson (the door's 404)", gone is not None)
S = run(mode=mc.MODE_MASS, me=MASTER_ME, who=MASTER_WHO)
check("with nobody chosen the master reads the master's own calendar and may file, from any day",
      S["person"]["own"] is True and S["person"]["name"] == "The Boss" and S["form"]["may_file"] is True
      and S["form"]["earliest"] == "" and S["requests"]["state"] == "ready" and S["requests"]["rows"] == []
      and all(d["state"] == "not_listed" for d in S["week"]["days"]), S["form"])
OWNROW = run(mode=mc.MODE_MASS, me=MASTER_ME, who=MASTER_WHO, person="PPL_BOSS")
check("the master's own roster row, chosen, is the master's own calendar (not read-only)",
      OWNROW["person"]["own"] is True and OWNROW["form"]["may_file"] is True)
R = run(mode=mc.MODE_MASS, me=MASTER_ME, who=MASTER_WHO, db=FakeDb(tab_error=RuntimeError("mirror down")))
check("a roster that cannot be read leaves the chooser empty in words, and the calendar still answers",
      R["scope"]["people"] == [] and "could not be read" in R["scope"]["people_why"] and R["person"]["own"] is True,
      R["scope"])

print("\nthe answer: failing closed, part by part")
E = run(readers={"estate": boom})
check("the calendars unreadable: the week says so; the requests still answer",
      E["week"]["head"]["state"] == "unreadable" and E["requests"]["state"] == "ready")
NO = run(me=mw.identity_from({"user_id": "u-x", "display_name": "Ann Roe", "active": "TRUE"}, "u-x",
                             roster_name="", people=[]))
check("an own account with no keys: both cards say why, never 'No shifts' nor an empty list",
      NO["week"]["head"]["state"] == "not_attributable" and NO["requests"]["state"] == "not_attributable"
      and NO["week"]["head"]["why"] and NO["requests"]["why"] and NO["person"]["key_why"], NO["person"])
time_off.view = lambda dsn, fresh=False: (_ for _ in ()).throw(time_off.Unreadable("the time off records could "
                                                                                    "not be read (RuntimeError)"))
U = run()
check("time off unreadable: the requests say so, filing is not offered, and the week says its days are unmarked",
      U["requests"]["state"] == "unreadable" and U["form"]["may_file"] is False
      and any("no day here is marked as time off" in n for n in U["week"]["notes"])
      and all(d["off"] is None for d in U["week"]["days"]), [U["requests"], U["week"]["notes"]])
time_off.view = lambda dsn, fresh=False: dict(TO_VIEW, settings={})
check("a directors list that cannot be read: filing is not offered, said as the house says it",
      run()["form"]["may_file"] is False
      and run()["form"]["may_file_why"].lower().startswith(time_off.DIRECTORS_UNREAD.lower()), run()["form"])
time_off.view = lambda dsn, fresh=False: TO_VIEW
shut = run(time_off_open={"open": False, "why": "No badge is written for Time Off in App Access, so it is the "
                                                "master's alone."})
check("the Time Off gate refusing: nothing is filed from here, in its own words",
      shut["form"]["may_file"] is False and "Time Off in App Access" in shut["form"]["may_file_why"])
BLANK = sr.viewer("dsn", name="", role="staff", types="STAFF")
check("an account on no roster may not file, in words",
      run(who=BLANK)["form"]["may_file_why"] == mc.NOT_ON_ROSTER)
Q_ME = mw.identity_from({"user_id": "u-q", "display_name": "Ann Q Roe", "active": "TRUE"}, "u-q",
                        roster_name="Ann Q Roe", people=[])
Q_WHO = sr.viewer("dsn", name="Ann Q Roe", role="staff", types="STAFF")
check("the fixture: Time Off spells the three-word name as the calendars' middle-name variant",
      Q_ME["keys"] == ["annqroe"] and time_off._spell(VIEW, "dsn", "Ann Q Roe") == "Ann Marie Roe",
      [Q_ME["keys"], time_off._spell(VIEW, "dsn", "Ann Q Roe")])
QF = run(me=Q_ME, who=Q_WHO)
check("one's own request goes under one's own name where no calendar spells that very name — never the "
      "calendars' look-alike — so it is filed here and read back",
      QF["form"]["may_file"] is True and QF["form"]["may_file_why"] == ""
      and time_off._spell_own(VIEW, "Ann Q Roe") == "Ann Q Roe"
      and time_off._spell_own(VIEW, "Ann Roe") == "Ann Roe" and QF["requests"]["state"] == "ready", QF["form"])
check("…and the calendars unreadable: the spelling cannot be checked, so nothing is filed here",
      run(readers={"estate": boom})["form"] == dict(A["form"], may_file=False, may_file_why=mc.SPELLING_UNREAD))
check("…and an own account with no keys files nothing it could not read back",
      NO["form"]["may_file"] is False and NO["form"]["may_file_why"] == mc.SPELLED_ELSEWHERE, NO["form"])

print("\nthe pencil's check: the Time Off door's own validate, the request itself left out")
ok = mc.check("dsn", WHO, "TO0000000001", D(41), D(43), keys=["annroe"], on=TODAY)
check("new dates overlapping only the request being changed are fine", ok["ok"] is True and ok["refusals"] == []
      and ok["days"] == 3 and ok["ref"] == "TO0000000001", ok)
other = mc.check("dsn", WHO, "TO0000000001", D(50), D(50), keys=["annroe"], on=TODAY)
check("…but an overlap with another of her requests is refused, naming it",
      other["ok"] is False and any("TO0000000009" in r for r in other["refusals"]), other)
started = mc.check("dsn", WHO, "TO0000000001", D(-1), D(0), keys=["annroe"], on=TODAY)
check("…and a first day already started is refused for staff",
      started["ok"] is False and any("already started" in r for r in started["refusals"]), started)
sched = mc.check("dsn", WHO, "TO0000000004", D(30), D(31), keys=["annroe"], on=TODAY)
check("an approved request whose first day is ahead is checked like a waiting one",
      sched["ok"] is True and sched["refusals"] == [], sched)
on_now = mc.check("dsn", WHO, "TO0000000003", D(30), D(31), keys=["annroe"], on=TODAY)
check("…but one that has started is not, in words",
      on_now["ok"] is False and on_now["refusals"] == [mc.EDIT_SCHEDULED_STARTED], on_now)
theirs = mc.check("dsn", WHO, "TO0000000008", D(30), D(31), keys=["annroe"], on=TODAY)
check("a request whose person is not hers is not hers to check, even one she filed",
      theirs["ok"] is False and theirs["refusals"] == ["No request of yours carries TO0000000008."], theirs)
time_off.view = lambda dsn, fresh=False: dict(TO_VIEW, rows=TO_ROWS + [
    to_row("TO0000000013", "Ann Q Roe", "pending", D(40), D(42)),
    to_row("TO0000000014", "ANN  ROE", "pending", D(60), D(61))])
qcheck = mc.check("dsn", Q_WHO, "TO0000000013", D(41), D(43), keys=["annqroe"], on=TODAY)
check("the check takes new dates the request door files under one's own name, never the look-alike's",
      qcheck["ok"] is True and qcheck["refusals"] == [], qcheck)
SEEN_PERSON: list[str] = []
_validate = time_off.validate
time_off.validate = lambda **k: SEEN_PERSON.append(k["person"]) or _validate(**k)
own_row = mc.check("dsn", WHO, "TO0000000014", D(62), D(63), keys=["annroe"], on=TODAY)
time_off.validate = _validate
check("the check judges the overlap for the request's own person, not a re-spelling of the session's name",
      SEEN_PERSON == ["ANN  ROE"] and own_row["ok"] is True, [SEEN_PERSON, own_row])
time_off.view = lambda dsn, fresh=False: BOSS_VIEW


def mcheck(ref, start, end, person="PPL_ANN", mode=mc.MODE_MASS, who=MASTER_WHO, db=None):
    return mc.check("dsn", who, ref, start, end, keys=MASTER_ME["keys"], on=TODAY, person=person, mode=mode,
                    core_sheet_id="core", db=db or FakeDb())


SEEN_PERSON.clear()
time_off.validate = lambda **k: SEEN_PERSON.append(k["person"]) or _validate(**k)
mine_for_her = mcheck("TO00000000M1", D(22), D(23))
time_off.validate = _validate
check("the master's chosen person: a waiting row the master filed for her is checked, her overlap judged for her",
      mine_for_her["ok"] is True and mine_for_her["refusals"] == [] and SEEN_PERSON == ["Ann Roe"],
      [mine_for_her, SEEN_PERSON])
check("…an approved one ahead too, and its new dates against her other requests",
      mcheck("TO00000000M2", D(33), D(34))["ok"] is True
      and any("TO0000000001" in r for r in mcheck("TO00000000M2", D(40), D(40))["refusals"]))
check("…but not one that has started", mcheck("TO00000000M3", D(3), D(4))["refusals"] == [mc.EDIT_SCHEDULED_STARTED])
check("…nor one she filed, or somebody else filed for her: only the person or whoever filed it",
      mcheck("TO0000000001", D(41), D(43))["refusals"] == [mc.NOT_YOURS_CHOSEN]
      and mcheck("TO0000000009", D(52), D(53))["refusals"] == [mc.NOT_YOURS_CHOSEN])
check("…nor a request whose person is somebody else",
      mcheck("TO0000000008", D(30), D(31))["refusals"] == ["No request of this person's carries TO0000000008."])
check("…nor anything with a person asked for outside the master's own session",
      mcheck("TO00000000M1", D(22), D(23), mode=mc.MODE_OWN)["refusals"]
      == ["New dates are checked for your own requests only."])
gone_check = None
try:
    mcheck("TO00000000M1", D(22), D(23), person="PPL_GONE")
except mp.NoSuchPerson as exc:
    gone_check = exc
check("…and a roster id nobody holds raises NoSuchPerson (the door's 404)", gone_check is not None)
time_off.view = lambda dsn, fresh=False: dict(TO_VIEW, rows=TO_ROWS + BOSS_ROWS + [
    to_row("TO00000000M4", "Ann Q Roe", "pending", D(20), D(21), **BOSS)])
check("…and a row of a person Time Off would file under another spelling is not refiled from here",
      mcheck("TO00000000M4", D(22), D(23), person="PPL_ANNQ", db=FakeDb(people=Q_PEOPLE))["refusals"]
      == [mc.SPELLED_ELSEWHERE_CHOSEN])
own_row_chosen = mcheck("TO00000000FB", D(22), D(23), person="PPL_BOSS")
check("the master's own roster row, chosen, is checked as the master's own",
      own_row_chosen["refusals"] == ["No request of yours carries TO00000000FB."], own_row_chosen)
time_off.view = lambda dsn, fresh=False: TO_VIEW
time_off.view = lambda dsn, fresh=False: dict(TO_VIEW, settings={})
nodirs = mc.check("dsn", WHO, "TO0000000001", D(41), D(43), keys=["annroe"], on=TODAY)
check("a directors list that cannot be read refuses, FAIL-CLOSED",
      nodirs["ok"] is False and nodirs["refusals"][0].startswith(time_off.DIRECTORS_UNREAD), nodirs)
time_off.view = lambda dsn, fresh=False: {"minted": False, "rows": [], "settings": {}}
raised = None
try:
    mc.check("dsn", WHO, "TO0000000001", D(41), D(43), keys=["annroe"], on=TODAY)
except time_off.Unreadable as exc:
    raised = exc
check("a house not set up raises Unreadable (the door's 503), never 'ok'", raised is not None)
time_off.view = lambda dsn, fresh=False: TO_VIEW

src = (SERVER / "my_calendar.py").read_text(encoding="utf-8")
check("the week reads the live calendars only: no asa_schedules, slices, attendance, drafts or held-by",
      not re.search(r"asa_schedules|shift_slices\.(build|events)|psi_attendance|calendar_builder_slices|_held_of|"
                    r"held_by|calendar_generator", src))
check("the module writes nothing", not re.search(r"\b(INSERT|UPDATE|DELETE)\b|append_row|update_row|\.request\(|"
                                                 r"\.withdraw\(|_close\(", src))


class RecCursor:
    """A cursor that records what it is asked and answers nothing."""

    def __init__(self, conn):
        self.connection = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, args=None):
        self.connection.log.append(("execute", self.connection.readonly, " ".join(str(sql).split())))

    def fetchall(self):
        return []

    def fetchone(self):
        return None


class RecConn:
    def __init__(self, log):
        self.log, self.readonly = log, False

    def set_session(self, readonly=False, autocommit=False):
        self.readonly = bool(readonly)
        self.log.append(("session", readonly, autocommit))

    def cursor(self, *a, **k):
        return RecCursor(self)

    def commit(self):
        self.log.append(("commit",))

    def close(self):
        self.log.append(("close",))


PG_LOG: list = []
_no_connect = sys.modules["psycopg2"].connect
sys.modules["psycopg2"].connect = lambda *a, **k: RecConn(PG_LOG)
try:
    got_reads = (mc.read_handoffs("dsn", ["annroe"], MON, SUN), mc.read_grids("dsn")[0],
                 mc.read_published("dsn", MON, SUN))
finally:
    sys.modules["psycopg2"].connect = _no_connect
executed = [e for e in PG_LOG if e[0] == "execute"]
check("the module's own reads open read-only connections and only ever SELECT: no table made, nothing committed",
      got_reads == ([], [], []) and len(executed) >= 3 and all(e[1] is True and e[2].upper().startswith("SELECT")
                                                                 for e in executed)
      and ("commit",) not in PG_LOG and PG_LOG.count(("session", True, True)) == 3, PG_LOG)
check("the pending transfer offers are read with a plain SELECT, not through the table's writer",
      "rows_for" not in src and "ensure_tables" not in src
      and any("FROM asa_shift_handoffs WHERE state=%s" in e[2] and "LIMIT %s" in e[2] for e in executed), executed)
mod_logs = re.findall(r"log\.\w+\(([^\n]*)", src)
check("the module's log lines carry an exception's type and nothing else",
      mod_logs and all(re.fullmatch(r'"my calendar: [^"%]*\(%s\)", _what\(exc\)\)', a) for a in mod_logs), mod_logs)

print("\nthe doors")
svc = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
tree = ast.parse(svc)


def segment(name):
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(svc, node) or ""
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == name for t in node.targets):
            return ast.get_source_segment(svc, node) or ""
    return ""


route = segment("lane_my_calendar")
croute = segment("lane_my_calendar_check")
gate_src = segment("_my_calendar_gate")
door_src = "\n".join(segment(n) for n in ("_my_calendar_scope", "_my_calendar_session", "_my_calendar_gate",
                                          "_my_calendar_who", "_my_calendar_time_off_open", "lane_my_calendar",
                                          "lane_my_calendar_check", "_time_off_gate"))
check("both routes are declared GET and no-store",
      '@app.get("/hub-lanes/my-calendar")' in svc and '@app.get("/hub-lanes/my-calendar/check")' in svc
      and 'response.headers["Cache-Control"] = "no-store"' in route
      and 'response.headers["Cache-Control"] = "no-store"' in croute
      and not re.search(r'@app\.(post|put|delete|patch)\("/hub-lanes/my-calendar', svc))
check("my_calendar is imported guarded", "try:\n    import my_calendar\nexcept Exception as _my_calendar_import_exc:" in svc)
check("it asks App Control for my-calendar with no admin floor, the trainee and the interviewer refused; a "
      "client-role account is forwarded, and the dead `guardian` role is gone",
      '_hotline_actor(authorization, app_id="my-calendar"' in gate_src and "floor=False" in gate_src
      and set(ast.literal_eval(segment("_MY_CALENDAR_ROLES_REFUSED").split("=", 1)[1].strip()))
      == {"onboarding", "interviewer"})
check("the client-role branch of the week sits after the gate and before any staff read; the check refuses it",
      route.index("_my_calendar_gate(") < route.index("_my_family_session(_actor)") < route.index("my_calendar.today()")
      < route.index("_my_calendar_who(") and croute.index("_my_family_session(_actor)") < croute.index("_my_calendar_who("))
check("the master flag is learned by My Work's one learner: no new authMe caller",
      "_my_work_learn_master(authorization)" in gate_src and '"action": "authMe"' not in door_src)
check("the filing gate is the write doors' own: Time Off's app, else My Calendar's, their refused roles, and never "
      "on the admin floor",
      '_hotline_actor(authorization, app_id="timeoff", refuse_roles=_TIME_OFF_ROLES_REFUSED' in door_src
      and "_time_off_gate(authorization, _TIME_OFF_FILERS, floor=False)" in segment("_my_calendar_time_off_open")
      and "_time_off_gate(authorization, _TIME_OFF_FILERS, floor=False)" in route
      and "_time_off_reader(authorization, _TIME_OFF_FILERS)" in segment("lane_time_off_request")
      and '"the withdrawal", run, _TIME_OFF_FILERS)' in segment("lane_time_off_withdraw")
      and '"the decision", run, _TIME_OFF_DECIDERS)' in segment("lane_time_off_decide")
      and ast.literal_eval(segment("_TIME_OFF_FILERS").split("=", 1)[1].strip()) == (("my-calendar", "My Calendar"),))
door_logs = re.findall(r"log\.\w+\(([^\n]*)", door_src)
check("no log line of either door formats a uid or a name, or speaks of acting",
      door_logs and all(re.fullmatch(r'"my calendar: [^"%]*\(%s\)", type\(exc\)\.__name__\)', a) for a in door_logs)
      and not re.search(r"log\.\w+\([^)]*act", door_src), door_logs)
check("no write door is added and the switched-session guard's open paths are unchanged",
      "my-calendar" not in segment("_BE_ANOTHER_OPEN_PATHS") and "/hub-lanes/my-calendar" not in segment("_BeAnotherWriteGuard"))

calls: list[str] = []
GATE_SAW: list = []
FLOOR_OPENED: list[str] = []
STATE = {"acting": set(), "authme": None, "role": "staff", "uid": "u-ann", "released": True, "timeoff_shut": False,
         "timeoff_floor_only": False, "answer_error": None, "check_error": None}
DOOR_WHO = {"name": "Ann Roe", "role": "staff", "badges": ["STAFF"]}
LAST: dict = {}


async def _session_actor(authorization):
    return (STATE["role"], STATE["uid"])


async def _hotline_actor(authorization, app_id="smartcomms", *, refuse_roles=(), app_label="", floor=True):
    # the relay's gate reads the session before anything else
    if await ns["_session_actor"](authorization) is None:
        return {"status": 401, "reason": "session", "message": "sign in first"}
    calls.append(f"gate:{app_id}:{floor}")
    seen = AUTH_MASTER.get(authorization[7:].strip())
    if seen is None and not floor:
        seen = False
    if app_id == "timeoff":
        shut_words = "No badge is written for Time Off in App Access, so it is the master's alone."
        if STATE["timeoff_shut"]:
            return {"status": 403, "reason": "badge", "message": shut_words}
        if STATE["timeoff_floor_only"] and STATE["role"] == "admin" and seen is not True:
            if seen is None:
                # hotline_desk's admin floor, which writes its hourly audit line
                FLOOR_OPENED.append(app_id)
                return (STATE["role"], STATE["uid"])
            return {"status": 403, "reason": "badge", "message": shut_words}
        return (STATE["role"], STATE["uid"])
    GATE_SAW.append(seen)
    if authorization == "Bearer shut":
        return {"status": 403, "message": "My Calendar is not open to you."}
    if seen is True or (seen is None and STATE["role"] == "admin") or STATE["released"]:
        return (STATE["role"], STATE["uid"])
    return {"status": 403, "reason": "badge", "message": "My Calendar is not open to you."}


async def _requests_viewer(authorization):
    if await ns["_session_actor"](authorization) is None:
        return {"status": 401, "message": "sign in first"}
    calls.append("viewer")
    return dict(DOOR_WHO), (STATE["role"], STATE["uid"])


EXEC_SENT: list = []


async def _post_exec(payload, **k):
    calls.append(f"exec:{payload.get('action')}")
    EXEC_SENT.append(payload)
    if payload.get("action") == "myFamily":
        got = STATE.get("family")
        if isinstance(got, Exception):
            raise got
        return got
    if STATE["authme"] is None:
        raise RuntimeError("no answer")
    return STATE["authme"]


class Acting:
    def known(self, token):
        return token in STATE["acting"]


class Mute:
    """A registry that cannot answer."""
    known = None

    def __contains__(self, token):
        raise RuntimeError("no answer")


def fake_answer(dsn, core, **k):
    calls.append(f"answer:{k['mode']}:{k['person']}:{k['week']}")
    LAST.clear()
    LAST.update(k)
    if STATE["answer_error"] is not None:
        raise STATE["answer_error"]
    return {"mode": k["mode"], "why": k["scope_why"], "person": k["person"], "open": k["time_off_open"]}


LAST_CHECK: dict = {}


def fake_check(dsn, who, ref, start, end, **k):
    calls.append(f"check:{ref}:{start}:{end}:{','.join(k['keys'])}")
    LAST_CHECK.clear()
    LAST_CHECK.update(k)
    if STATE["check_error"] is not None:
        raise STATE["check_error"]
    return {"ok": True, "refusals": [], "ref": ref}


stub_mw = types.SimpleNamespace(
    MODE_MASS=mw.MODE_MASS, scope_verdict=mw.scope_verdict,
    identity=lambda dsn, core, uid, roster_name="": calls.append(f"identity:{uid}:{roster_name}") or ME)
stub_mp = types.SimpleNamespace(PERSON_RE=mp.PERSON_RE, NoSuchPerson=mp.NoSuchPerson)
stub_mc = types.SimpleNamespace(today=lambda: TODAY, parse_week=mc.parse_week, BadWeek=mc.BadWeek,
                                answer=fake_answer, check=fake_check)
stub_to = types.SimpleNamespace(REF_RE=time_off.REF_RE, Unreadable=time_off.Unreadable,
                                refused_reader=time_off.refused_reader)
AUTH_MASTER: dict = {}
# the relay's session memory: token -> (checked_at, ok, role, uid)
AUTH_CACHE: dict = {}
# the session copy (hub_sessions / hub_session_vouch); it never speaks for a switched session
COPY = {"speaks": True}
# what the backend's own sign-in check (/auth's validator) answers: open | refused | unsure
BACKEND = {"answer": "open", "delay": 0.0}
VALIDATED: list[str] = []


def fake_put(token, ok, role, uid="", *, at=None, is_master=None):
    AUTH_CACHE[token] = (time.time() if at is None else at, ok, role, uid)


def fake_copy(token_hash):
    return (True, STATE["role"], STATE["uid"]) if COPY["speaks"] else None


async def fake_validate(token):
    calls.append("validate")
    VALIDATED.append(token)
    try:
        await asyncio.sleep(BACKEND["delay"])
        if BACKEND["answer"] == "open":
            # the answer names the switched session, which _note_session_answer writes before the verdict
            STATE["acting"].add(token)
            fake_put(token, True, "staff", "u-ann", is_master=False)
        elif BACKEND["answer"] == "refused":
            fake_put(token, False, "")
        else:
            placeholder = time.time() - ns["AUTH_TTL_SECONDS"] + 20.0
            fake_put(token, False, "", at=placeholder)
            ns["_auth_unsure"][token] = placeholder
    finally:
        ns["_auth_pending"].discard(token)
        ns["_auth_tasks"].pop(token, None)


async def _family_on_apps_script(_app_id):
    return False


ns = {"app": types.SimpleNamespace(get=lambda path: (lambda f: f)), "Header": lambda default="": default,
      # My Family on Apps Script, the path this story tells
      "_backend_wanted": _family_on_apps_script, "MY_FAMILY_APP": "my-family",
      "Response": object, "Any": object, "asyncio": asyncio, "re": re, "log": logging.getLogger("test"),
      "time": time, "hashlib": hashlib,
      "PG_DSN": "dsn", "HUB_DB_SHEET_ID": "core", "my_work": stub_mw, "my_profile": stub_mp, "my_calendar": stub_mc,
      "time_off": stub_to, "_hotline_actor": _hotline_actor, "_session_actor": _session_actor,
      "_requests_viewer": _requests_viewer, "_auth_me": lambda token: _post_exec({"token": token, "action": "authMe"}),
      "_auth_master": AUTH_MASTER,
      "_acting": Acting(), "_note_session_answer": lambda token, env: None,
      "AUTH_TTL_SECONDS": 300.0, "_auth_cache": AUTH_CACHE, "_auth_unsure": {}, "_auth_pending": set(),
      "_auth_tasks": {}, "_auth_cache_put": fake_put, "_mirror_session_verdict": fake_copy,
      "_validate": fake_validate}
for name in ("_hotline_token", "_DAILY_REASONS", "_daily_refusal", "_my_work_acting", "_my_work_learn_master",
             "_TIME_OFF_ROLES_REFUSED", "_TIME_OFF_FILERS", "_time_off_gate", "_MY_CALENDAR_DOWN", "_MY_CALENDAR_ROLES_REFUSED", "_MY_CALENDAR_VISIT",
             "_MY_CALENDAR_OWN_ONLY", "_MY_CALENDAR_DAY", "_MY_CALENDAR_NO_REQUESTS", "_MY_CALENDAR_SESSION_WAIT_S",
             "_my_calendar_scope", "_my_calendar_session", "_my_calendar_gate", "_my_calendar_who",
             "_my_calendar_time_off_open", "_MY_FAMILY_WORDS", "_my_family_session", "_my_family_forward",
             "lane_my_calendar", "lane_my_calendar_check"):
    code = segment(name)
    check(f"the relay declares {name}", bool(code))
    exec(code, ns)  # noqa: S102 — the relay's own source


def door(auth="Bearer tok", member="", person="", week=""):
    calls.clear()
    resp = types.SimpleNamespace(headers={})
    got = asyncio.run(ns["lane_my_calendar"](resp, member=member, person=person, week=week, authorization=auth))
    return got, list(calls), resp


def cdoor(auth="Bearer tok", member="", person="", ref="TO0000000001", start=D(41), end=D(43)):
    calls.clear()
    resp = types.SimpleNamespace(headers={})
    got = asyncio.run(ns["lane_my_calendar_check"](resp, member=member, person=person, ref=ref, start=start, end=end,
                                                  authorization=auth))
    return got, list(calls), resp


visit, vcalls, vresp = door(member="u-bob")
check("inside a visit it refuses before any gate or read",
      visit["status"] == 403 and visit["reason"] == "visit" and vcalls == [] and vresp.headers["Cache-Control"] == "no-store",
      [visit, vcalls])
cvisit, cvcalls, cvresp = cdoor(member="u-bob")
check("…and so does the check", cvisit["status"] == 403 and cvisit["reason"] == "visit" and cvcalls == []
      and cvresp.headers["Cache-Control"] == "no-store")
shut, scalls, _ = door(auth="Bearer shut")
check("a closed App Control row refuses with its reason and reads nothing",
      shut["status"] == 403 and shut["reason"] == "badge" and scalls == ["gate:my-calendar:False"], [shut, scalls])
okay, ocalls, _ = door()
check("a staff session: the gate with no floor, its own account, the Time Off gate, then its own calendar",
      okay["status"] == 200 and okay["data"]["mode"] == "own"
      and ocalls == ["gate:my-calendar:False", "viewer", "identity:u-ann:Ann Roe", "gate:timeoff:False",
                     "answer:own::2026-09-21"] and okay["data"]["open"] == {"open": True, "why": ""}, [okay, ocalls])
check("…the week asked for is its Monday", door(week="2026-10-01")[0]["status"] == 200
      and LAST["week"] == date(2026, 9, 28) and LAST["on"] == TODAY)
badweek, bwcalls, _ = door(week="soon")
check("a week that cannot be read is a 400 before anything is read",
      badweek["status"] == 400 and badweek["reason"] == "week" and "viewer" not in bwcalls, [badweek, bwcalls])
STATE["timeoff_shut"] = True
tshut, tcalls, _ = door()
check("the Time Off app shut in App Control does not shut filing here: My Calendar's own gate opens its doors",
      tshut["status"] == 200 and tshut["data"]["open"] == {"open": True, "why": ""}
      and tcalls[tcalls.index("gate:timeoff:False") + 1] == "gate:my-calendar:False", [tshut, tcalls])
STATE["released"] = False
AUTH_MASTER["tok"] = False
calls.clear()
both = asyncio.run(ns["_my_calendar_time_off_open"]("Bearer tok", dict(DOOR_WHO)))
check("…both shut: the answer carries Time Off's own words, not a refusal of the calendar",
      both["open"] is False and "Time Off in App Access" in both["why"], both)
AUTH_MASTER.pop("tok", None)
STATE["released"] = True
STATE["timeoff_shut"] = False
DOOR_WHO["role"] = "guardian"
gshut, _gc, _ = door()
check("…and a reader Time Off refuses is told so", gshut["data"]["open"] == {"open": False,
                                                                              "why": "Time Off is the staff's screen."})
DOOR_WHO["role"] = "staff"
nope, ncalls, _ = door(person="PPL_BOB")
check("a person asked for in own mode is refused as scope, before anything is read",
      nope["status"] == 403 and nope["reason"] == "scope" and "viewer" not in ncalls
      and not any(c.startswith("answer") for c in ncalls), [nope, ncalls])
STATE.update(role="admin", uid="u-boss")
AUTH_MASTER["tok"] = True
m_ok, mcalls, _ = door(person="PPL_BOB")
check("the master's own session reads the person chosen, and no master check is asked again",
      m_ok["status"] == 200 and m_ok["data"]["mode"] == "mass" and "answer:mass:PPL_BOB:2026-09-21" in mcalls
      and not any(c.startswith("exec:") for c in mcalls), [m_ok, mcalls])
m_self, _msc, _ = door()
check("…and its own calendar with nobody chosen, saying it may choose, and that what it adds there is filed for them",
      m_self["data"]["mode"] == "mass" and m_self["data"]["person"] == ""
      and "any person's you choose; a request you add there is filed for them, by you." in m_self["data"]["why"],
      m_self)
bad, _bc, _ = door(person="Bob Bee!")
check("a person that is not a roster id is a 400", bad["status"] == 400 and bad["reason"] == "person")
STATE["answer_error"] = mp.NoSuchPerson("No row of the staff roster carries that person.")
gone404, _g4, _ = door(person="PPL_GONE")
check("a roster id nobody holds is a 404 the screen lets go of", gone404["status"] == 404 and gone404["reason"] == "person")
STATE["answer_error"] = RuntimeError("boom")
boom503, _b5, _ = door()
check("an answer that throws is a 503 in words", boom503["status"] == 503
      and "could not be put together (RuntimeError)" in boom503["message"])
STATE["answer_error"] = None
chosen_check, mccalls, _ = cdoor(person="PPL_BOB")
check("the master's own session checks a chosen person's row: the roster id and mass mode go to the check, which "
      "takes only a row the master may withdraw",
      chosen_check["status"] == 200 and any(c.startswith("check:TO0000000001:") for c in mccalls)
      and LAST_CHECK.get("person") == "PPL_BOB" and LAST_CHECK.get("mode") == "mass"
      and LAST_CHECK.get("core_sheet_id") == "core", [chosen_check, mccalls, LAST_CHECK])
STATE["check_error"] = mp.NoSuchPerson("No row of the staff roster carries that person.")
gone_chosen, _gcc, _ = cdoor(person="PPL_GONE")
check("…a roster id nobody holds is a 404", gone_chosen["status"] == 404 and gone_chosen["reason"] == "person",
      gone_chosen)
STATE["check_error"] = None
mself, mscalls, _ = cdoor()
check("…and checks the master's own request with the master's own keys, nobody chosen",
      mself["status"] == 200 and any(c.startswith("check:TO0000000001:") and c.endswith(":annroe") for c in mscalls)
      and LAST_CHECK.get("person") == "" and LAST_CHECK.get("mode") == "mass", [mscalls, LAST_CHECK])
STATE["acting"].add("tok")
act_ok, acalls, _ = door()
check("acting as someone with a stale True flag reads that person's own calendar, told only what they are told",
      act_ok["data"]["mode"] == "own" and act_ok["data"]["why"] == "", act_ok)
act_person, _apc, _ = door(person="PPL_BOB")
check("…and cannot choose another person", act_person["status"] == 403 and act_person["reason"] == "scope")
act_check, accalls, _ = cdoor(person="PPL_BOB")
check("…nor check another person's row", act_check["status"] == 403 and act_check["reason"] == "scope"
      and not any(c.startswith(("check", "viewer")) for c in accalls), [act_check, accalls])
AUTH_MASTER.clear()
act_unknown, aucalls, _ = door()
check("an acting token asks no master check at all", "exec:authMe" not in aucalls and act_unknown["data"]["mode"] == "own")
STATE["acting"].clear()
ns["_acting"] = {"tok": (9e9, "u-boss", "u-ann")}
AUTH_MASTER["tok"] = True
dict_act, _dc, _ = door()
check("the dict-shaped acting registry: own, never mass", dict_act["data"]["mode"] == "own")
ns["_acting"] = Mute()
mute, _mc2, _ = door()
check("FAIL-CLOSED: a registry that cannot answer reads as acting — own, never mass, never a crash",
      mute["status"] == 200 and mute["data"]["mode"] == "own", mute)
ns["_acting"] = Acting()
AUTH_MASTER.clear()
unk, ucalls, _ = door()
check("an admin whose flag is unknown asks authMe once, BEFORE the gate; a failed check is own, in words",
      ucalls.count("exec:authMe") == 1 and ucalls.index("exec:authMe") < ucalls.index("gate:my-calendar:False")
      and unk["data"]["mode"] == "own"
      and unk["data"]["why"] == "The master check could not be made (RuntimeError), so only your own calendar is shown.",
      [unk, ucalls])
STATE["timeoff_floor_only"] = True
FLOOR_OPENED.clear()
AUTH_MASTER.clear()
floorless, _fc, _ = door()
check("an admin whose flag is unknown: Time Off's gate is asked with no floor, filing is offered through My "
      "Calendar's gate alone, and the admin floor never opens on this read",
      floorless["status"] == 200 and floorless["data"]["open"] == {"open": True, "why": ""}
      and _fc.count("gate:my-calendar:False") == 2 and FLOOR_OPENED == [], [floorless, _fc, FLOOR_OPENED])
STATE["timeoff_floor_only"] = False
STATE["authme"] = {"status": 200, "data": {"user": {"is_master": False}}}
GATE_SAW.clear()
plain, _pc, _ = door()
check("an admin the check names not the master: the gate sees False, and the calendar is own",
      GATE_SAW == [False] and plain["data"]["mode"] == "own" and AUTH_MASTER.get("tok") is False, [GATE_SAW, plain])
STATE.update(authme=None, released=False)
AUTH_MASTER.clear()
GATE_SAW.clear()
shut_unknown, sucalls, _ = door()
check("unreleased, and the master check failed: a 503 saying the check failed — never the calendar, never a badge",
      shut_unknown["status"] == 503 and shut_unknown["reason"] == "unavailable"
      and "the master check could not be made (RuntimeError)" in shut_unknown["message"]
      and GATE_SAW == [False] and not any(c.startswith(("answer", "viewer")) for c in sucalls), [shut_unknown, sucalls])
AUTH_MASTER["tok"] = False
plain_shut, _psc, _ = door()
check("…an admin the backend names not the master is refused as a badge", plain_shut["reason"] == "badge")
AUTH_MASTER["tok"] = True
check("…and the master opens it", door()[0]["data"]["mode"] == "mass")
STATE.update(role="staff", uid="u-ann", released=True)
AUTH_MASTER.clear()
cok, cocalls, _ = cdoor()
check("the check: own mode, the request's ref and the new days, with the account's own keys",
      cok["status"] == 200 and cocalls == ["gate:my-calendar:False", "viewer", "identity:u-ann:Ann Roe",
                                           f"check:TO0000000001:{D(41)}:{D(43)}:annroe"], [cok, cocalls])
check("…nobody chosen, in own mode", LAST_CHECK.get("person") == "" and LAST_CHECK.get("mode") == "own", LAST_CHECK)
cscope, cscalls, _ = cdoor(person="PPL_BOB")
check("…a person asked for in own mode is refused as scope before anything is read",
      cscope["status"] == 403 and cscope["reason"] == "scope" and cscalls == ["gate:my-calendar:False"],
      [cscope, cscalls])
cbadref, cbrc, _ = cdoor(ref="nope")
check("…a ref that is not one is a 400 before anything is read", cbadref["status"] == 400 and "viewer" not in cbrc)
cbadday, cbdc, _ = cdoor(start="10/4/2026")
check("…and so is a day not written YYYY-MM-DD", cbadday["status"] == 400 and cbadday["reason"] == "dates"
      and "viewer" not in cbdc)
check("…no reason is taken in the query string", "reason" not in croute.split(")", 1)[0])
STATE["check_error"] = time_off.Unreadable("the time off records could not be read (RuntimeError)")
cun, _cu, _ = cdoor()
check("…a house that cannot be read is a 503 in its own words", cun["status"] == 503
      and "could not be read" in cun["message"])
STATE["check_error"] = None
stub_mw.identity = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("mirror down"))
broken, bcalls, _ = door()
check("an account row that cannot be read is a 502 in words, and no calendar is drawn",
      broken["status"] == 502 and "could not be read" in broken["message"]
      and not any(c.startswith("answer") for c in bcalls), [broken, bcalls])
cbroken, cbcalls, _ = cdoor()
check("…and no check is made", cbroken["status"] == 502 and not any(c.startswith("check") for c in cbcalls))
ns["my_calendar"] = None
check("a module that did not load answers 503 with a sentence", door()[0]["status"] == 503 and cdoor()[0]["status"] == 503)

print("\nthe door, for a client-role session (apps-script/MyFamily.gs)")
ns["my_calendar"] = stub_mc
stub_mw.identity = lambda dsn, core, uid, roster_name="": calls.append(f"identity:{uid}:{roster_name}") or ME
FAMILY_WEEK = {"status": 200, "data": {"family": True, "part": "calendar", "viewer": "client", "linked": True,
                                       "ward": {"name": "Jane Doe"}, "week": {"from": "2026-09-28"},
                                       "appointments": {"rows": [], "next": None, "undated": 0,
                                                        "source": {"key": "appointments", "state": "empty"}}}}
STATE.update(role="client", uid="u-jane", released=True, family=FAMILY_WEEK, authme=None)
AUTH_MASTER.clear()
EXEC_SENT.clear()
fam, fcalls, fresp = door(week="2026-10-01")
check("a client-role session's week is the backend's myFamily read, asked with the session's own token, the part "
      "and the week — and passed back unchanged",
      fam == FAMILY_WEEK and fcalls == ["gate:my-calendar:False", "exec:myFamily"]
      and EXEC_SENT == [{"token": "tok", "action": "myFamily", "payload": {"part": "calendar", "week": "2026-10-01"}}]
      and fresp.headers["Cache-Control"] == "no-store", [fam, fcalls, EXEC_SENT])
check("…no staff source is computed for it: no viewer, no account row, no Time Off gate, no calendar answer",
      not any(c.startswith(("viewer", "identity", "gate:timeoff", "answer")) for c in fcalls), fcalls)
EXEC_SENT.clear()
fnoweek, _fnw, _ = door()
fbadweek, fbwcalls, _ = door(week="soon")
check("…with no week, the backend's own this week; a week that cannot be read is a 400 before the backend is asked",
      fnoweek == FAMILY_WEEK and EXEC_SENT[0]["payload"] == {"part": "calendar"}
      and fbadweek["status"] == 400 and fbadweek["reason"] == "week" and "exec:myFamily" not in fbwcalls,
      [EXEC_SENT, fbadweek])
fvisit, fvcalls, _ = door(member="u-bob")
fperson, fpcalls, _ = door(person="PPL_BOB")
check("a visit is refused before anything, and a person asked for as scope, before the backend is asked",
      fvisit["reason"] == "visit" and fvcalls == [] and fperson["reason"] == "scope"
      and "exec:myFamily" not in fpcalls, [fvisit, fperson])
fcheck, fccalls, _ = cdoor()
check("the check door refuses a client-role session in words: it files no time off request",
      fcheck["status"] == 403 and fcheck["reason"] == "restricted" and "time off" in fcheck["message"].lower()
      and not any(c.startswith(("viewer", "check", "exec")) for c in fccalls), [fcheck, fccalls])
STATE["family"] = RuntimeError("down")
fdown, _fd, _ = door()
check("a backend that did not answer is a 502 in words", fdown["status"] == 502
      and fdown["message"] == "Your calendar could not be read (RuntimeError).", fdown)
STATE["family"] = {"status": 200, "data": {"family": True, "part": "work"}}
fwrong, _fw, _ = door()
check("an answer for another part is a 502 and nothing is drawn", fwrong["status"] == 502 and "data" not in fwrong)
STATE.update(role="staff", uid="u-ann", family=None)
EXEC_SENT.clear()
fstaff, fscalls, _ = door()
check("a staff session is unchanged: its own calendar, and the family read is never asked",
      fstaff["status"] == 200 and fstaff["data"]["mode"] == "own" and not EXEC_SENT
      and any(c.startswith("answer:own") for c in fscalls), [fstaff, fscalls])

print("\nthe door, for a switched session whose verdict the relay's memory no longer holds")
check("a session the copy vouches for never asks the backend (every read above)", VALIDATED == [], VALIDATED)
order = [gate_src.find(s) for s in ('"visit"', "_my_calendar_session(", "_my_work_learn_master(")]
check("the gate asks after the session before the master learner and after the visit refusal, through /auth's own "
      "validator", -1 not in order and order == sorted(order) and "_validate(token)" in segment("_my_calendar_session"),
      order)
# the relay's own session reader: memory first, then the copy, never the backend
exec(segment("_session_actor"), ns)  # noqa: S102
KID = "Bearer kid"
COPY["speaks"] = False
STATE.update(role="staff", uid="u-ann", released=True, authme=None, acting={"kid"})
AUTH_MASTER.clear()


def lapse():
    AUTH_CACHE["kid"] = (time.time() - ns["AUTH_TTL_SECONDS"] - 1, True, "staff", "u-ann")


lapse()
lapsed, lcalls, _ = door(auth=KID)
check("a switched session five minutes past its last verdict: the backend's own check, then that person's calendar "
      "(it used to answer 'sign in first')",
      lapsed["status"] == 200 and lapsed["data"]["mode"] == "own" and lapsed["data"]["why"] == ""
      and lcalls[:2] == ["validate", "gate:my-calendar:False"] and "answer:own::2026-09-21" in lcalls
      and "exec:authMe" not in lcalls and VALIDATED == ["kid"], [lapsed, lcalls, VALIDATED])
again, acalls2, _ = door(auth=KID)
check("…and the next read stands on the verdict that check left, asking nothing",
      again["status"] == 200 and "validate" not in acalls2 and VALIDATED == ["kid"], [again, acalls2])
lapse()
clapsed, clcalls, _ = cdoor(auth=KID)
check("…the check door asks the same way", clapsed["status"] == 200 and clcalls[0] == "validate"
      and any(c.startswith("check:TO0000000001:") for c in clcalls), [clapsed, clcalls])
AUTH_CACHE.clear()
STATE["acting"] = set()
restarted, rcalls, _ = door(auth=KID)
check("after a relay restart (no memory, no acting registry) the check re-learns the switched session, and the "
      "calendar is that person's own, never the master's",
      restarted["status"] == 200 and restarted["data"]["mode"] == "own" and "kid" in STATE["acting"]
      and rcalls[0] == "validate" and "exec:authMe" not in rcalls, [restarted, rcalls])
BACKEND["answer"] = "refused"
lapse()
refused, fcalls2, _ = door(auth=KID)
check("a session the backend refuses is 'sign in first', and nothing is read",
      refused["status"] == 401 and refused["reason"] == "session" and refused["message"] == "sign in first"
      and not any(c.startswith(("viewer", "answer")) for c in fcalls2), [refused, fcalls2])
BACKEND["answer"] = "unsure"
lapse()
before = len(VALIDATED)
unsure, ucalls2, _ = door(auth=KID)
unsure2, ucalls3, _ = door(auth=KID)
check("a backend that could not answer is a 503 saying the check could not be made, never 'sign in first'; the brief "
      "refusal it leaves is not asked again at once",
      unsure["status"] == 503 and unsure["reason"] == "unavailable"
      and "the sign-in check could not be made" in unsure["message"] and unsure2["status"] == 503
      and len(VALIDATED) == before + 1 and not any(c.startswith(("viewer", "answer")) for c in ucalls2 + ucalls3),
      [unsure, unsure2, VALIDATED])
ns["_auth_unsure"].clear()
BACKEND.update(answer="open", delay=1.0)
ns["_MY_CALENDAR_SESSION_WAIT_S"] = 0.05
lapse()
slow, scalls2, _ = door(auth=KID)
check("a check that does not answer in time is a 503 in words, and nothing is read",
      slow["status"] == 503 and "did not answer in time" in slow["message"]
      and not any(c.startswith(("viewer", "answer")) for c in scalls2), [slow, scalls2])
BACKEND["delay"] = 0.0
exec(segment("_MY_CALENDAR_SESSION_WAIT_S"), ns)  # noqa: S102 — the relay's own wait again
lapse()


async def joined():
    ns["_auth_pending"].add("kid")
    ns["_auth_tasks"]["kid"] = asyncio.create_task(fake_validate("kid"))
    return await ns["lane_my_calendar"](types.SimpleNamespace(headers={}), member="", person="", week="",
                                       authorization=KID)


before = len(VALIDATED)
calls.clear()
joined_got = asyncio.run(joined())
check("a check /auth already started is joined, never asked twice", joined_got["status"] == 200
      and len(VALIDATED) == before + 1, [joined_got, VALIDATED])
lapse()
ns["_auth_pending"].update(f"other{n}" for n in range(256))
crowd, ccalls, _ = door(auth=KID)
check("with every check slot taken, a 503 in words and no check started",
      crowd["status"] == 503 and "validate" not in ccalls and not any(c.startswith("answer") for c in ccalls),
      [crowd, ccalls])
ns["_auth_pending"].clear()
ns["_session_actor"] = _session_actor
COPY["speaks"] = True
STATE["acting"] = set()

pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
check("the suite is a script and rides the check chain right after My Profile's",
      pkg["scripts"].get("test:my-calendar") == "python3 tools/test-my-calendar.py"
      and "npm run test:my-profile && npm run test:my-calendar" in pkg["scripts"]["check"])
grants = []
for folder in ("apps-script", "tools", "server"):
    for p in (ROOT / folder).rglob("*"):
        if p.is_file() and p.suffix in (".gs", ".py", ".json", ".mjs", ".js") and p.name != "test-my-calendar.py":
            text = p.read_text(encoding="utf-8", errors="ignore")
            if re.search(r"app_badge_access[^\n]{0,200}my-calendar|my-calendar[^\n]{0,200}app_badge_access", text):
                grants.append(str(p))
check("no App Control grant row for my-calendar ships anywhere: the app is the master's until released",
      not grants, grants)

print(f"\nmy calendar: {results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
