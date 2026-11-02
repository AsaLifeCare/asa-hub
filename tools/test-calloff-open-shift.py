#!/usr/bin/env python3
"""A call-off drawn as an open shift; pure half on the host, lane half in the relay in its own schema."""
import json
import os
import re
import sys
import types
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
import lane_schema  # noqa: E402 — beside this file
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SERVER = ROOT / "server"
CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {detail}")


if "psycopg2" not in sys.modules:  # pragma: no cover - the host has no driver
    fake = types.ModuleType("psycopg2")
    fake.connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no database in this test"))
    fake.Error = Exception
    extras = types.ModuleType("psycopg2.extras")
    extras.RealDictCursor = object
    errors = types.ModuleType("psycopg2.errors")
    errors.UniqueViolation = type("UniqueViolation", (Exception,), {})
    fake.extras, fake.errors = extras, errors
    sys.modules["psycopg2"] = fake
    sys.modules["psycopg2.extras"] = extras
    sys.modules["psycopg2.errors"] = errors

sys.path.insert(0, str(SERVER))
os.environ.setdefault("HUB_SNAPSHOT_OUT", "/tmp")
import house_cal_live as hcl  # noqa: E402
import house_directory  # noqa: E402
import shift_requests as sr  # noqa: E402

OHIO = hcl.OHIO
BM = "CAN - BM - BM4060"
JH = "CAN - JH - ABD2704"
D1, D2 = "2026-09-30", "2026-10-01"
NOW = datetime(2026, 9, 29, 12, 0, tzinfo=OHIO)
LINE = sr.CALL_OFF_ROW


def grid(rows, isos=(D1, D2), location=BM):
    g = {"cols": [{"iso": i} for i in isos],
         "rows": [{"employee": e, "cells": [{"text": t, "color": "#fde"} for t in cs],
                   "open_row": hcl.is_open_row(e)} for e, cs in rows],
         "location": location, "_claims": {}}
    return g


def off(person, iso=D1, value="8P-8A", ref="SPCALLOFF01", **over):
    return {"kind": sr.KIND_CALLOFF, "location": BM, "open_row": person, "col_iso": iso,
            "value": value, "ref": ref, "state": "open", "filled_by": "", "filled_how": "",
            "closed_at": "", "window": {"opens_at": "2026-09-29T15:00:00+00:00"}, **over}


def base():
    return grid([("OPEN", ["", "8A-4P"]), ("Ann Roe", ["8P-8A", "NCNS"]),
                 ("Ben Left", ["8A-4P", "C/O"]), ("Cy Far", ["", ""])])


def row(g, name):
    return next((r for r in g["rows"] if r["employee"] == name), None)


STAFF = {"name": "Ben Left", "badges": ["STAFF"], "whole_company": False, "sees_reasons": False,
         "manages": [], "decides_everywhere": False, "decides": [], "role": "staff"}
HM = {"name": "Hana Boss", "badges": ["STAFF"], "whole_company": False, "sees_reasons": False,
      "manages": ["BM4060"], "decides_everywhere": False, "decides": ["BM4060"], "role": "staff"}
OTHER_HM = {**HM, "name": "Jo Other", "manages": ["ABD2704"], "decides": ["ABD2704"]}
BADGE_HM = {**STAFF, "name": "Kai Badge", "badges": ["HM", "STAFF"], "whole_company": True}
DIRECTOR = {**STAFF, "name": "Dora Dir", "badges": ["DIRECTOR"], "whole_company": True,
            "sees_reasons": True, "decides_everywhere": True}
CLIENT = {**STAFF, "name": "Carl Client", "badges": ["STAFF"], "role": "client"}


print("\nWHO MAY LEARN WHO CALLED OFF — the house's editor and the whole company, never staff")

check("a member of staff may not", not sr.sees_callers(STAFF, BM))
check("this house's manager may", sr.sees_callers(HM, BM))
check("another house's manager may not learn it about this house", not sr.sees_callers(OTHER_HM, BM))
check("a badge that reads the whole company may (HM, and above)", sr.sees_callers(BADGE_HM, BM))
check("a director may", sr.sees_callers(DIRECTOR, BM))
check("a client never may, whatever the row says", not sr.sees_callers(CLIENT, BM))


print("\nTHE DRAWING — as a member of staff sees it")

g = sr.overlay_call_offs(base(), [off("Ann Roe")], sees_callers=False)
names = [r["employee"] for r in g["rows"]]
line = row(g, LINE)
check("an 'OPEN · call-off' line is drawn right after the house's own OPEN rows",
      names == ["OPEN", LINE, "Ann Roe", "Ben Left", "Cy Far"], names)
check("it is marked as nobody, and as the call-off line",
      line and line.get("open_row") is True and line.get("call_off_row") is True, line)
check("its red cell holds the shift and the pool's handle — nothing else",
      line["cells"][0] == {"text": "8P-8A", "color": "transparent", "ref": "SPCALLOFF01",
                           "kind_of_open": "call_off"}, line["cells"][0])
check("the line never names the caller, anywhere in it",
      "Ann" not in json.dumps(line), line)
ann = row(g, "Ann Roe")["cells"]
check("the caller's own cell is EMPTY — no text, no colour, no ring",
      ann[0].get("text") == "" and ann[0].get("color") == "transparent" and "called_off" not in ann[0],
      ann[0])
check("and every other C/O and NCNS on the grid is drawn empty for staff too",
      ann[1]["text"] == "" and row(g, "Ben Left")["cells"][1]["text"] == "",
      [ann[1], row(g, "Ben Left")["cells"][1]])
c = hcl.compute(g, now=NOW)
opened = {s["key"]: s for s in c["open_shifts"]}
cs = opened.get(f"{LINE}|{D1}")
check("the arithmetic makes it an open shift exactly like an OPEN row's",
      cs is not None and cs["open_row"] == LINE and cs["ref"] == "SPCALLOFF01"
      and cs["kind_of_open"] == "call_off" and cs["claimed_by"] is None, cs)
check("and the open shift names nobody to staff",
      cs is not None and "called_off_by" not in cs and "Ann" not in json.dumps(cs), cs)
check("the caller holds no hours for a shift they are not working — the totals are the picture's",
      all(p["employee"] != "Ann Roe" or p["hours"] == 0 for p in c["people"])
      and "Ann Roe" not in next(d for d in c["days"] if d["col_iso"] == D1)["names"],
      [c["people"], c["days"][0]])
check("the house's OPEN row keeps its own red cell beside it",
      f"OPEN|{D2}" in opened, sorted(opened))


print("\nTHE DRAWING — as the house's manager sees it")

h = sr.overlay_call_offs(base(), [off("Ann Roe")], sees_callers=True)
hann = row(h, "Ann Roe")["cells"]
check("the caller's cell says C/O, with what they called off and where it went",
      hann[0]["text"] == "C/O" and hann[0]["called_off"] == {
          "ref": "SPCALLOFF01", "value": "8P-8A", "state": "open", "filled_by": ""}, hann[0])
check("the red cell names the caller — to them",
      row(h, LINE)["cells"][0].get("called_off_by") == "Ann Roe", row(h, LINE)["cells"][0])
hc = hcl.compute(h, now=NOW)
hcs = {s["key"]: s for s in hc["open_shifts"]}[f"{LINE}|{D1}"]
check("and so does its open shift", hcs.get("called_off_by") == "Ann Roe", hcs)
check("the other absence marks stand as written for them", hann[1]["text"] == "NCNS", hann[1])


print("\nTHE DRAWING — the edges")

two = sr.overlay_call_offs(base(), [off("Ann Roe"), off("Ben Left", value="8A-4P", ref="SPCALLOFF02")],
                           sees_callers=False)
check("two call-offs on one day are two lines — 'OPEN · call-off' and 'OPEN · call-off 2'",
      [r["employee"] for r in two["rows"] if r.get("call_off_row")] == [LINE, f"{LINE} 2"],
      [r["employee"] for r in two["rows"]])
filled = sr.overlay_call_offs(base(), [off("Ann Roe", filled_by="Cy Far", filled_how="approved",
                                           state="filled")], sees_callers=False)
fc = {s["key"]: s for s in hcl.compute(filled, now=NOW)["open_shifts"]}[f"{LINE}|{D1}"]
check("a call-off that was given is drawn taken, by whoever took it",
      fc["claimed_by"] == "Cy Far" and fc["claimed_via"] == "approved", fc)
back = sr.overlay_call_offs(base(), [off("Ann Roe", filled_by="Ann Roe", state="filled")],
                            sees_callers=False)
check("a call-off given back to the caller is no call-off — no line, and their shift stands",
      not any(r.get("call_off_row") for r in back["rows"])
      and row(back, "Ann Roe")["cells"][0]["text"] == "8P-8A",
      [r["employee"] for r in back["rows"]])
again = base()
row(again, "Ann Roe")["cells"][0]["text"] = "8A-2P"
rostered = sr.overlay_call_offs(again, [off("Ann Roe")], sees_callers=False)
check("a caller rostered AGAIN on that cell keeps what was written — that is not a secret",
      row(rostered, "Ann Roe")["cells"][0]["text"] == "8A-2P", row(rostered, "Ann Roe")["cells"][0])
undrawn = sr.overlay_call_offs(base(), [off("Ann Roe", iso="2031-01-01")], sees_callers=False)
check("a call-off on a day the grid does not draw draws nothing",
      not any(r.get("call_off_row") for r in undrawn["rows"]))
no_open = grid([("Ann Roe", ["8P-8A", ""])])
tail = sr.overlay_call_offs(no_open, [off("Ann Roe")], sees_callers=False)
check("a house with no OPEN row gets the line at the foot of the grid",
      [r["employee"] for r in tail["rows"]] == ["Ann Roe", LINE])
today = date(2026, 9, 29)
kept = sr.call_offs_on_calendar(
    [off("Ann Roe"), off("Ben Left", iso="2026-08-01"), {**off("Cy Far"), "kind": sr.KIND_OPEN},
     {**off("Dee Way"), "location": JH}], location=BM, today=today)
check("a calendar draws its own house's call-offs from the look-back on — not last month's",
      [k["open_row"] for k in kept] == ["Ann Roe"], [k["open_row"] for k in kept])


print("\nTHE PANEL — the window, the handle, the street, and where the reader stands")

POOLED = [{**off("Ann Roe"), "window": {"state": "open", "closes_at": "2026-09-30T23:00:00+00:00",
                                        "opens_at": "2026-09-29T15:00:00+00:00", "reserved": False,
                                        "why": "open to all staff for 5 hours from the call-off"},
           "applicants": [{"id": "SR1", "person": "Cy Far", "state": "applied", "why": "", "via": "app",
                           "at": "2026-09-29T15:05:00+00:00", "week_hours": 12.0,
                           "decided_by": "", "decided_at": ""}]}]
real_standing, real_read = sr.standing, house_directory.read
asked = []


def fake_standing(dsn, person, pooled, **k):
    asked.append(person)
    return {p["ref"]: {"may": True, "code": "ok", "why": "open to them",
                       "ist": {"ok": False, "state": "missing", "why": "no IST for BM"}} for p in pooled}


sr.standing = fake_standing
house_directory.read = lambda dsn, now=None: {"BM4060": {"address": "4060 Birch Mill Rd"}}
try:
    shifts = [cs, {"key": f"OPEN|{D2}", "location": BM, "open_row": "OPEN", "col_iso": D2}]
    staff_view = sr.decorate_open_shifts("dsn", [dict(s) for s in shifts], pooled=POOLED, who=STAFF)
    hm_view = sr.decorate_open_shifts("dsn", [dict(s) for s in shifts], pooled=POOLED, who=HM)
    sr.standing = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("estate timed out"))
    broken = sr.decorate_open_shifts("dsn", [dict(shifts[0])], pooled=POOLED, who=STAFF)
    nameless = sr.decorate_open_shifts("dsn", [dict(shifts[0])], pooled=POOLED, who={**STAFF, "name": ""})
finally:
    sr.standing, house_directory.read = real_standing, real_read
s0 = staff_view[0]
check("the grid's open shift carries the pool's window, state, handle and applicant count",
      s0.get("pool_state") == "open" and s0.get("ref") == "SPCALLOFF01"
      and s0.get("window", {}).get("closes_at") and s0.get("applicants") == 1
      and s0.get("kind_of_open") == "call_off", s0)
check("and the street, from the houses directory — the same street the URGENT text carries",
      s0.get("address") == "4060 Birch Mill Rd", s0)
check("where this reader stands is the relay's answer, read once for every shift on the grid",
      s0.get("mine", {}).get("may") is True and asked == ["Ben Left", "Hana Boss"], [s0.get("mine"), asked])
check("a member of staff is never sent who applied",
      "applicant_list" not in s0, sorted(s0))
check("the house's manager is — earliest first, with that week's hours",
      [a["person"] for a in hm_view[0].get("applicant_list", [])] == ["Cy Far"]
      and hm_view[0]["applicant_list"][0]["week_hours"] == 12.0, hm_view[0].get("applicant_list"))
check("a shift the pool has not met yet says so — never a silent grey button",
      staff_view[1].get("mine", {}).get("code") == "not_pooled" and "ref" not in staff_view[1],
      staff_view[1])
check("a standing that could not be worked out is said, never read as 'may not'",
      broken[0]["mine"]["code"] == "unreadable" and "RuntimeError" in broken[0]["mine"]["why"],
      broken[0].get("mine"))
check("an account on no roster is told so",
      nameless[0]["mine"]["code"] == "no_name", nameless[0].get("mine"))
check("nothing the panel is sent carries the reason",
      all("reason" not in s for s in staff_view + hm_view), [sorted(s) for s in staff_view])


print("\nTHE CALL-OFF BOOKS — the pool's key is the grid's own spelling of the person")

VIEW = {"locations": [BM], "by_code": {"BM4060": BM}, "isos": {BM: [D1, D2]},
        "people": {BM: ["OPEN", "Ann Roe", "Ben Left"]},
        "cells": {BM: {("Ann Roe", D1): "C/O", ("Ben Left", D1): "8A-4P"}},
        "spans": {}, "worked": {}}
fake_pa = types.ModuleType("psi_attendance")
d1 = date(2026, 9, 30)


def _called_off(dsn, lo, hi):
    return ({"annroe": [{"day": d1, "at": "2026-09-29T15:00:00+00:00", "source": "tracker",
                         "kind": "call_off"}],
             "benleft": [{"day": d1, "at": "", "source": "tracker", "kind": "late_show"}],
             "ghost": [{"day": d1, "at": "", "source": "tracker", "kind": "call_off"}]}, [], True)


def _roster(dsn, lo, hi):
    at = datetime(2026, 9, 30, 20, 0, tzinfo=OHIO)
    return ([{"keys": ["annroe"], "name": "ann  roe", "house": "BM4060", "shift_code": "8P-8A",
              "shift_date": d1, "shift_at": at, "shift_end": at + timedelta(hours=12)},
             {"keys": ["benleft"], "name": "Ben Left", "house": "BM4060", "shift_code": "8A-4P",
              "shift_date": d1, "shift_at": at, "shift_end": at + timedelta(hours=8)},
             {"keys": ["ghost"], "name": "Gus Host", "house": "ZZ9999", "shift_code": "8A-4P",
              "shift_date": d1, "shift_at": at, "shift_end": at + timedelta(hours=8)}], {})


fake_pa.called_off, fake_pa.roster = _called_off, _roster
sys.modules["psi_attendance"] = fake_pa
try:
    got = sr.call_off_shifts("dsn", view=VIEW, now=NOW)
finally:
    sys.modules.pop("psi_attendance", None)
check("a call-off for a house with no calendar here, and a late call, open nothing",
      len(got) == 1, got)
check("the pool is keyed on the row the TAB spells, not the schedule's 'ann  roe'",
      got and got[0]["open_row"] == "Ann Roe" and got[0]["called_off_by"] == "Ann Roe", got)
check("a cell the house manager marked C/O is still the schedule's shift to give — never 'C/O'",
      got and got[0]["value"] == "8P-8A", got)
check("its handle is the hash of the house, that row and the day",
      got and sr.ref_of(got[0]["location"], got[0]["open_row"], got[0]["col_iso"])
      == sr.ref_of(BM, "Ann Roe", D1))


print("\nTHE LINK — one shape for the Desk, Requests and the URGENT text")

link = sr.deep_link("SP0123456789", BM)
check("the path the platform opens a pooled shift at, after the HashRouter's '#'",
      link == "/#/app/calendarbuilder/house-cal?house=CAN%20-%20BM%20-%20BM4060&ref=SP0123456789", link)
check("a handle alone still opens it — the relay says which house",
      sr.deep_link("SP0123456789") == "/#/app/calendarbuilder/house-cal?ref=SP0123456789")
check("the handle is short, stable and names nobody",
      re.fullmatch(r"SP[0-9A-F]{10}", sr.ref_of(BM, "Ann Roe", D1)) is not None
      and sr.ref_of(BM, "Ann Roe", D1) == sr.ref_of(BM, "Ann Roe", D1)
      and "ANN" not in sr.ref_of(BM, "Ann Roe", D1))
spa_types = (ROOT / "src/pages/features/shifts/houseCalTypes.ts").read_text(encoding="utf-8")
m_path = re.search(r"export const HOUSE_CAL_PATH = '([^']+)'", spa_types)
check("the screen's own path is the relay's, less the '#'",
      m_path is not None and sr.DEEP_LINK_PATH == "/#" + m_path.group(1),
      [sr.DEEP_LINK_PATH, m_path and m_path.group(1)])


print("\nTHE DOORS — the ring, the gate, and what never rides back")

door = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")


def body_of(text: str, name: str) -> str:
    lines = text.splitlines()
    for i, ln in enumerate(lines):
        if ln.startswith(f"def {name}(") or ln.startswith(f"async def {name}("):
            out = [ln]
            for nxt in lines[i + 1:]:
                if nxt and not nxt[0].isspace() and not nxt.startswith(")"):
                    break
                out.append(nxt)
            return "\n".join(out)
    return ""


m_event = re.search(r'^HOUSECAL_EVENT = "([^"]+)"', door, re.M)
m_spa_event = re.search(r"export const HOUSECAL_LIVE_EVENT = '([^']+)'", spa_types)
check("the relay's ring and the screens' ear are the same name",
      m_event and m_spa_event and m_event.group(1) == m_spa_event.group(1) == "housecal",
      [m_event and m_event.group(1), m_spa_event and m_spa_event.group(1)])
check("the ring is a name only, heard by every stream — only 'hotline:' names are gated",
      'gated = resource.startswith("hotline:")' in body_of(door, "_publish_slice")
      and "_publish_slice(HOUSECAL_EVENT)" in body_of(door, "_housecal_rang"))
for name in ("lane_housecal_claim", "lane_housecal_claim_release", "lane_shift_requests_apply",
             "lane_shift_requests_withdraw", "lane_shift_requests_decide",
             "lane_shift_requests_training", "lane_handoff_offer", "lane_handoff_answer",
             "_shift_pool_sweep",
             "lane_cal_builder_house_cell", "lane_cal_builder_house_move",
             "lane_cal_builder_request_off", "lane_cal_builder_call_off", "lane_cal_builder_undo",
             "lane_cal_builder_discard", "lane_cal_builder_house_publish"):
    check(f"{name} rings the calendars when it changed something",
          "_housecal_rang()" in body_of(door, name))
for name in ("lane_housecal_cell", "lane_housecal_move"):
    check(f"{name} is closed and rings nothing — it changes nothing",
          "_housecal_rang()" not in body_of(door, name))
check("the grid door answers with the one picture — call-offs drawn, open shifts decorated",
      "_housecal_grid_for(who, location)" in body_of(door, "lane_housecal_grid")
      and "shift_requests.calendar_grid" in body_of(door, "_housecal_grid_for"))
check("and so does every write door, whole — the chosen person's row, not only the totals",
      '"grid": grid' in body_of(door, "_housecal_after")
      and all("_housecal_after(location, who)" in body_of(door, n)
              for n in ("lane_housecal_claim", "lane_shift_requests_decide"))
      and all("_builder_after(location, who)" in body_of(door, n)
              for n in ("lane_cal_builder_house_cell", "lane_cal_builder_house_move",
                        "lane_cal_builder_call_off", "lane_cal_builder_house_publish")))
check("the Desk's list is the same overlay — the called-off shifts are among the open ones",
      "shift_requests.calendar_open_shifts" in body_of(door, "lane_housecal_open"))
check("a called-off shift is claimed by its handle, and its drawn line is never taken for a row",
      "shift_requests.by_ref" in body_of(door, "lane_housecal_claim")
      and "CALL_OFF_ROW" in body_of(door, "lane_housecal_claim"))
check("a handle-only link is told the house and the day — and nothing that names the caller",
      '"location": location' in body_of(door, "lane_housecal_ref")
      and '"open_row"' not in body_of(door, "lane_housecal_ref")
      and "_housecal_viewer(authorization)" in body_of(door, "lane_housecal_ref"))
check("an applicant who may not know who called off is not sent the caller's row back",
      "sees_callers(who, location)" in body_of(door, "lane_shift_requests_apply")
      and "sees_callers(who, location)" in body_of(door, "lane_housecal_claim"))
builder = (SERVER / "calendar_builder_houses.py").read_text(encoding="utf-8")
check("a called-off shift is never dragged off the caller's row, nor drafted over",
      "_called_off(dsn, location, src_employee, src_iso)" in body_of(builder, "stage_move")
      and "_called_off(dsn, location, employee, col_iso)" in body_of(builder, "stage_cell")
      and "open_call_off_at" in body_of(builder, "_called_off"))
check("the URGENT OPEN SHIFT's lookup answers the handle and the path",
      "shift_requests.call_off_ref" in body_of(door, "shift_of")
      and '"open_shift": open_shift' in body_of(door, "shift_of"))



LANE = '''
import json, os, sys, types
from datetime import datetime, timedelta, timezone
sys.path.insert(0, LANE_DIR)
import psycopg2, psycopg2.extras
import lane_schema
import house_cal_live as hcl, shift_handoff
import calendar_builder_houses as cbh
import shift_requests as sr
import effective_roster
import time_off
# before the call-off books are stood in below: the reply ear brings in the punch pair, which reads
# the attendance lane's constants when it loads, and a stand-in module has none of them
import sms_ears
# an unregistered switch holds; this lane writes the stand-in workbook
effective_roster.use_switch(lambda: {"on": False, "readable": True, "word": "off", "why": ""})
# no Time Off house: the verdict never reads the live one
time_off.use_house(time_off.NoHouse())

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
ROOMS = lane_schema.Rooms(DSN, "calloff-open-shift")
SCHEMA = ROOMS.name()
OUT = {}
BM = "CAN - BM - BM4060"
today = datetime.now(sr.OHIO).date()
PAST = (today - timedelta(days=1)).isoformat()
D1 = (today + timedelta(days=1)).isoformat()
D2 = (today + timedelta(days=2)).isoformat()
ISOS = [PAST, D1, D2]
# the IST settings as a read that landed, holding the shipped values
import ist_config
ist_config.pin(dict(ist_config.SHIPPED))
EVERY = {"done": 1, "owed": 0, "clients": [], "owed_for": []}
NAMES = ("Ann Roe", "Ben Left", "Cy Far")
sr.ist_index = lambda dsn, **k: {
    "readable": True, "why": "", "rows": 0, "source": "test",
    "by_person": {sr.fold(n): {"BM4060": dict(EVERY)} for n in NAMES}}

# call-off books stood in; call_off_shifts itself runs on them
d1 = today + timedelta(days=1)
at = datetime.combine(d1, datetime.min.time(), tzinfo=sr.OHIO) + timedelta(hours=20)
pa = types.ModuleType("psi_attendance")
pa.called_off = lambda dsn, lo, hi: ({"annroe": [{"day": d1, "kind": "call_off", "source": "tracker",
                                                  "at": datetime.now(timezone.utc).isoformat()}]}, [], True)
pa.roster = lambda dsn, lo, hi: ([{"keys": ["annroe"], "name": "Ann Roe", "house": "BM4060",
                                   "shift_code": "8P-8A", "shift_date": d1, "shift_at": at,
                                   "shift_end": at + timedelta(hours=12)}], {})
sys.modules["psi_attendance"] = pa

STAFF = {"name": "Ben Left", "badges": ["STAFF"], "whole_company": False, "sees_reasons": False,
         "manages": [], "decides_everywhere": False, "decides": [], "role": "staff"}
ANN = {**STAFF, "name": "Ann Roe"}
HM = {**STAFF, "name": "Hana Boss", "manages": ["BM4060"], "decides": ["BM4060"]}


def grid(rows):
    return {"cols": [{"iso": i} for i in ISOS],
            "rows": [{"employee": e, "cells": [{"text": t} for t in cs]} for e, cs in rows]}


def row(g, name):
    return next((r for r in g["rows"] if r["employee"] == name), {"cells": []})


def cell(g, name, iso):
    cells = row(g, name)["cells"]
    i = ISOS.index(iso)
    return cells[i] if i < len(cells) else {}


def shift_of(g, ref):
    return next((s for s in g["computed"]["open_shifts"] if s.get("ref") == ref), None)


ROOMS.make()
T = ROOMS.path(SCHEMA)

try:
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("CREATE TABLE asa_house_calendar_live (location TEXT PRIMARY KEY, "
                    "grid JSONB, updated_at TIMESTAMPTZ DEFAULT now())")
        cur.execute(hcl.OVERRIDES_DDL)
        cur.execute(hcl.CLAIMS_DDL)
        cur.execute(hcl.EDITS_DDL)
        cur.execute(shift_handoff.HANDOFFS_DDL)
        cur.execute(shift_handoff.OPEN_INDEX_DDL)
        for stmt in sr.DDL:
            cur.execute(stmt)
        BMG = grid([
            ("OPEN", ["", "", ""]),
            ("Ann Roe", ["8A-4P", "8P-8A", ""]),
            ("Ben Left", ["", "", ""]),
            ("Cy Far", ["", "", ""]),
        ])
        cur.execute("INSERT INTO asa_house_calendar_live (location, grid) VALUES (%s,%s)",
                    (BM, psycopg2.extras.Json(BMG)))
        c.commit()
    # every table the code reads is the lane's before its first read
    OUT["owned"] = lane_schema.own_shift_lane(T, SCHEMA, LANE_DIR)
    # a stand-in workbook: a test never reaches the live one
    BOOK = cbh.MemoryWorkbook.from_grids({BM: BMG})
    cbh.use_workbook(BOOK)
    sr.forget_estate()

    swept = sr.sweep(T)
    OUT["swept"] = [swept.get("call_offs"), swept.get("opened")]
    REF = sr.ref_of(BM, "Ann Roe", D1)
    OUT["by_ref"] = list(sr.by_ref(T, REF) or [])
    OUT["open_before"] = bool(sr.open_call_off_at(T, BM, "Ann Roe", D1))
    OUT["urgent_ref"] = sr.call_off_ref(T, person="Ann Roe", day=D1, house="BM4060")
    OUT["REF"] = REF

    g = sr.calendar_grid(T, BM, STAFF)
    s = shift_of(g, REF) or {}
    OUT["staff_rows"] = [r["employee"] for r in g["rows"]]
    OUT["staff_ann"] = cell(g, "Ann Roe", D1)
    OUT["staff_shift"] = {k: s.get(k) for k in ("open_row", "col_iso", "raw", "pool_state",
                                                "kind_of_open", "applicants", "claimed_by")}
    OUT["staff_mine"] = s.get("mine")
    OUT["staff_names_caller"] = ("Ann Roe" in json.dumps(g["computed"]["open_shifts"])
                                 or "Ann Roe" in json.dumps(row(g, sr.CALL_OFF_ROW)))
    OUT["staff_sees_list"] = "applicant_list" in s
    OUT["pool_said"] = g.get("pool")
    OUT["ann_mine"] = (shift_of(sr.calendar_grid(T, BM, ANN), REF) or {}).get("mine")

    h = sr.calendar_grid(T, BM, HM)
    hs = shift_of(h, REF) or {}
    OUT["hm_ann"] = cell(h, "Ann Roe", D1)
    OUT["hm_called_off_by"] = hs.get("called_off_by")
    OUT["hm_list"] = hs.get("applicant_list")

    desk_staff = sr.calendar_open_shifts(T, STAFF)
    desk_hm = sr.calendar_open_shifts(T, HM)
    OUT["desk_staff"] = [[x.get("ref"), x.get("kind_of_open"), x.get("called_off_by")]
                         for x in desk_staff["shifts"] if x.get("ref") == REF]
    OUT["desk_hm"] = [[x.get("ref"), x.get("called_off_by")]
                      for x in desk_hm["shifts"] if x.get("ref") == REF]

    loc, orow, iso = sr.by_ref(T, REF)
    applied = sr.apply_for(T, location=loc, open_row=orow, col_iso=iso, person="Ben Left")
    OUT["applied"] = bool(applied.get("applied"))
    OUT["staff_after_apply"] = ((shift_of(sr.calendar_grid(T, BM, STAFF), REF) or {}).get("mine") or {}).get("code")
    h2 = shift_of(sr.calendar_grid(T, BM, HM), REF) or {}
    OUT["hm_after_apply"] = [[a["person"], a["state"]] for a in h2.get("applicant_list") or []]
    OUT["count_after_apply"] = h2.get("applicants")

    sr.forget_estate()
    # no decision inside the window; after it, the decision is the manager's
    try:
        sr.take_open_shift(T, location=loc, open_row=orow, col_iso=iso, person="Ben Left",
                           by="Hana Boss", may_decide=True)
        OUT["decide_in_window"] = "allowed"
    except sr.Refused as exc:
        OUT["decide_in_window"] = exc.code
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_pool SET opened_at = now() - interval '6 hours'")
        c.commit()
    took = sr.take_open_shift(T, location=loc, open_row=orow, col_iso=iso, person="Ben Left",
                              by="Hana Boss", may_decide=True)
    OUT["took"] = {k: took.get(k) for k in ("decided", "how", "assigned_to_row", "open_row_cleared")}
    OUT["book_after"] = [BOOK.cell(BM, "Ben Left", D1), BOOK.cell(BM, "Ann Roe", D1)]
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT count(*) FROM asa_house_calendar_overrides")
        OUT["overrides_after"] = cur.fetchone()[0]

    after = sr.calendar_grid(T, BM, HM)
    OUT["after_ben"] = cell(after, "Ben Left", D1).get("text")
    OUT["after_ann_hm"] = cell(after, "Ann Roe", D1)
    fs = shift_of(after, REF) or {}
    OUT["after_shift"] = [fs.get("claimed_by"), fs.get("pool_state")]
    staff_after = sr.calendar_grid(T, BM, STAFF)
    OUT["after_ann_staff"] = cell(staff_after, "Ann Roe", D1).get("text")
    OUT["after_staff_taken"] = (shift_of(staff_after, REF) or {}).get("claimed_by")
    OUT["open_after"] = bool(sr.open_call_off_at(T, BM, "Ann Roe", D1))
    sr.forget_estate()
    OUT["ann_spans"] = [h["col_iso"] for h in sr.estate(T, fresh=True)["spans"].get("annroe", [])]

    # AN UNREADABLE POOL IS SAID, never drawn as a covered house.
    real_pool = sr.pool
    sr.pool = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("pool down"))
    try:
        blind = sr.calendar_grid(T, BM, STAFF)
        OUT["blind"] = [blind["pool"]["readable"], "could not be read" in blind["pool"]["why"],
                        any(r.get("call_off_row") for r in blind["rows"])]
    finally:
        sr.pool = real_pool
finally:
    cbh.use_workbook(None)
    OUT["rooms"] = ROOMS.close()
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''

MODULES = ("house_cal_live", "shift_requests", "shift_handoff", "shift_slices",
           "calendar_builder_houses", "calendar_builder_write", "calendar_builder_slices",
           "house_directory", "psi_reminders", "badge_follows",
           "effective_roster",
           # decide()'s covered hook runs against this run's schema
           "open_shift_covered",
           # the overlap law's time-off source, and the rule its stand-in house copies by
           "time_off", "redaction")


def _lane_in_container(script_body: str = LANE) -> dict | None:
    # every module the roots reach, and the IST settings reader's declaration, in a folder of this run's own
    sources = lane_schema.with_imports(SERVER, (*MODULES, "ist_config"))
    return lane_schema.run_in(CONTAINER, lane_schema.script(sources, script_body, "calloff-open-shift"))


print("\nTHE LANE — a call-off, from the book to the red square to the person's row")
lane = _lane_in_container()
if lane is None:
    print("  (skipped — no relay container to hold a database here)")
    print("  NOTE: the pure half above still ran; the lane half did not.")
elif lane.get("crash"):
    check("the lane ran to its end", False, lane.get("trace") or lane["crash"])
else:
    check("every table the lane reads resolves in its own schema before the first read, never public",
          lane["owned"]["lane"] and all(str(s).startswith("hub_test_calloff_open_shift_")
                                        for s in lane["owned"]["lane"].values()), lane["owned"])
    REF = lane["REF"]
    check("the sweep meets the call-off in the books and puts it in the pool",
          lane["swept"][0] == 1 and lane["swept"][1] >= 1, lane["swept"])
    check("its handle resolves back to the caller's cell — on the server, and only there",
          lane["by_ref"] == ["CAN - BM - BM4060", "Ann Roe", lane["staff_shift"]["col_iso"]],
          lane["by_ref"])
    check("the URGENT text's lookup names the same handle and the link that opens it",
          lane["urgent_ref"].get("ref") == REF
          and lane["urgent_ref"].get("path", "").endswith(f"&ref={REF}"), lane["urgent_ref"])
    check("staff see a blood-red open shift on the 'OPEN · call-off' line",
          sr.CALL_OFF_ROW in lane["staff_rows"]
          and lane["staff_shift"]["open_row"] == sr.CALL_OFF_ROW
          and lane["staff_shift"]["raw"] == "8P-8A"
          and lane["staff_shift"]["kind_of_open"] == "call_off"
          and lane["staff_shift"]["claimed_by"] is None, [lane["staff_rows"], lane["staff_shift"]])
    check("with the pool's window on it — open, nobody applied yet",
          lane["staff_shift"]["pool_state"] == "open" and lane["staff_shift"]["applicants"] == 0,
          lane["staff_shift"])
    check("and staff never learn who called off: the caller's cell is empty, the red cell nameless",
          lane["staff_ann"].get("text") == "" and "called_off" not in lane["staff_ann"]
          and lane["staff_names_caller"] is False, [lane["staff_ann"], lane["staff_names_caller"]])
    check("a member of staff may APPLY — a call-off is open to everybody inside its window",
          (lane["staff_mine"] or {}).get("may") is True
          and (lane["staff_mine"] or {}).get("code") == "ok", lane["staff_mine"])
    check("and is not sent who applied", lane["staff_sees_list"] is False)
    check("the caller does not apply for the shift they called off",
          (lane["ann_mine"] or {}).get("code") == "called_off", lane["ann_mine"])
    check("the house's manager sees the caller's cell as C/O, with the shift",
          lane["hm_ann"].get("text") == "C/O"
          and (lane["hm_ann"].get("called_off") or {}).get("ref") == REF, lane["hm_ann"])
    check("and who called off, on the red cell itself",
          lane["hm_called_off_by"] == "Ann Roe", lane["hm_called_off_by"])
    check("the Desk's list carries the same shift — nameless for staff, named for the manager",
          lane["desk_staff"] == [[REF, "call_off", None]] and lane["desk_hm"] == [[REF, "Ann Roe"]],
          [lane["desk_staff"], lane["desk_hm"]])
    check("staff apply by the handle, and then read 'applied' on the same red square",
          lane["applied"] is True and lane["staff_after_apply"] == "applied",
          [lane["applied"], lane["staff_after_apply"]])
    check("the manager's panel lists them, and the count says one",
          lane["hm_after_apply"] == [["Ben Left", "applied"]] and lane["count_after_apply"] == 1,
          [lane["hm_after_apply"], lane["count_after_apply"]])
    check("THE WINDOW RUNS TO ITS END: while the call-off's hours of applications run, the house "
          "manager's decision is refused", lane["decide_in_window"] == "window_open",
          lane["decide_in_window"])
    check("giving it to an applicant is an APPROVAL of their application",
          lane["took"]["decided"] is True and lane["took"]["how"] == "approved", lane["took"])
    check("the decision fills the chosen person's OWN row at once",
          lane["after_ben"] == "8P-8A" and lane["took"]["assigned_to_row"] is True,
          [lane["after_ben"], lane["took"]])
    check("and the red square turns taken, by them — filled",
          lane["after_shift"] == ["Ben Left", "filled"], lane["after_shift"])
    check("the decision is written INTO THE WORKBOOK — the chosen row filled, the caller's emptied",
          lane["book_after"] == ["8P-8A", ""], lane["book_after"])
    check("and not into an override: the overrides table gets no new row",
          lane["overrides_after"] == 0, lane["overrides_after"])
    check("the caller's cell is emptied — C/O to the manager, blank to staff",
          lane["took"]["open_row_cleared"] is True and lane["after_ann_hm"].get("text") == "C/O"
          and lane["after_ann_staff"] == "", [lane["after_ann_hm"], lane["after_ann_staff"]])
    check("staff see the square taken too — the roster shows who works it",
          lane["after_staff_taken"] == "Ben Left", lane["after_staff_taken"])
    check("the caller no longer holds the hours they said they could not work",
          lane["staff_shift"]["col_iso"] not in lane["ann_spans"], lane["ann_spans"])
    check("a waiting call-off is not dragged off the caller's row; a given one is nothing to guard",
          lane["open_before"] is True and lane["open_after"] is False,
          [lane["open_before"], lane["open_after"]])
    check("the pool is read and said to be", (lane["pool_said"] or {}).get("readable") is True,
          lane["pool_said"])
    check("an unreadable pool is SAID on the grid — never drawn as a house with nobody off",
          lane["blind"] == [False, True, False], lane["blind"])


print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
