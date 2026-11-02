#!/usr/bin/env python3
"""
Calendar Builder houses: picker codes, tab reading, drafts, publish through the one writer, the doors.
Pure half on the host; lane half in the relay container, in its own schema with an in-memory workbook.

    python3 tools/test-calendar-builder-houses.py
"""
import json
import os
import re
import sys
import types
from datetime import date, datetime, timedelta
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
import calendar_builder_houses as cbh  # noqa: E402
import house_cal_live as hcl  # noqa: E402
import shift_requests as sr  # noqa: E402

# the code a picker writes (the SPA's codeOf is held to the same table)
print("THE CODE — two times of day, the estate's own spelling, read back")
CASES = json.loads((ROOT / "tests" / "spa" / "fixtures" / "builder-codes.json").read_text())
for start, end, want in CASES:
    got = cbh.code_of(start, end)
    check(f"{start} → {end} is written {want}", got == want, got)
    check(f"and {want} reads back as those hours", cbh.reads_back(got, start, end))
check("the pickers' HH:MM become the code", cbh.value_from_times("21:30", "07:30") == "930P-730A")
check("a leading star the cell had is kept", cbh.value_from_times("08:00", "20:00", keep_star=True)
      == "*8A-8P")
for bad in (("08:00", "08:00"), ("25:00", "08:00"), ("soon", "later")):
    try:
        cbh.value_from_times(*bad)
        check(f"{bad} is refused", False)
    except ValueError:
        check(f"{bad} is refused, in words", True)

print("\nTHE TAB — the STAFF header, the days, the rows the mirror keeps")
ISOS = ["2026-09-26", "2026-09-27", "2026-09-28"]
TAB = [
    ["", "", "", "SAT", "SUN", "MON"],
    ["D", "STAFF", "Cell #", "9/26", "9/27", "9/28"],
    ["", "OPEN", "", "", "", ""],          # an empty OPEN row: the mirror drops it
    ["", "OPEN", "", "8A-4P", "", ""],     # the mirror's first OPEN
    ["", "OPEN", "", "", "8A-2P", ""],     # …and its OPEN 2
    ["**", "Ann Roe", "555", "8A-4P", "", ""],
    ["", "Na'Tajiah Lackey", "", "", "", ""],  # a person with no shift: found by name
    ["", "Twin Name", "", "8P-8A", "", ""],
    ["", "Twin  Name.", "", "", "8P-8A", ""],
    ["", "", "", "", "", ""],
    ["", "notes below the grid", "", "", "", ""],
]
lay = cbh.tab_layout(TAB, ISOS)
check("the header is the row that says STAFF, the names are in its column",
      lay is not None and lay["header"] == 1 and lay["staff_col"] == 1, lay)
check("every day of the grid is found by month and day",
      lay["col_by_iso"] == {"2026-09-26": 3, "2026-09-27": 4, "2026-09-28": 5}, lay["col_by_iso"])
check("the OPEN rows are numbered over the rows the mirror keeps — OPEN is row 4, OPEN 2 row 5",
      lay["by_name"].get("OPEN") == 3 and lay["by_name"].get("OPEN 2") == 4, lay["by_name"])
check("a person whose row holds no shift is still found by their own name",
      cbh.resolve_row(lay, "Na'Tajiah Lackey") == (6, ""))
check("and by the platform's spelling of it (Natajiah)",
      cbh.resolve_row(lay, "Natajiah Lackey") == (6, ""))
check("a name spelled exactly as one row is that row",
      cbh.resolve_row(lay, "Twin Name") == (7, ""), cbh.resolve_row(lay, "Twin Name"))
check("a spelling two rows answer to is refused, never guessed",
      cbh.resolve_row(lay, "twin name")[0] is None and cbh.resolve_row(lay, "twin name")[1] != "",
      cbh.resolve_row(lay, "twin name"))
check("a new person has no row yet — the writer will add one",
      cbh.resolve_row(lay, "Zoe New") == (None, ""))
check("an OPEN row is never added by the platform",
      cbh.resolve_row(lay, "OPEN 3")[0] is None and cbh.resolve_row(lay, "OPEN 3")[1] != "")
check("the last name is where a new row goes (the notes line counts as a name there)",
      lay["last_named"] == 10, lay["last_named"])
check("a tab with no STAFF header is not a roster grid",
      cbh.tab_layout([["Name", "9/26"], ["Ann", "8A-4P"]], ISOS) is None)

print("\nTHE STAND-IN WORKBOOK — the part of the Sheets API the writer uses")
book = cbh.MemoryWorkbook.from_grids({"CAN - BM - BM4060": {
    "cols": [{"iso": i} for i in ISOS],
    "rows": [{"employee": "Ann Roe", "cells": [{"text": "8A-4P"}]}]}})
check("its tab is laid out as the house tabs are",
      book.tabs["CAN - BM - BM4060"][0][:4] == ["D", "STAFF", "Cell #", "9/26"])
check("a cell reads back by name and day", book.cell("CAN - BM - BM4060", "Ann Roe", ISOS[0]) == "8A-4P")
book.values().batchUpdate(body={"data": [{"range": "'CAN - BM - BM4060'!E2",
                                          "values": [["2P-10P"]]}]})
check("a value lands where its A1 range says", book.cell("CAN - BM - BM4060", "Ann Roe", ISOS[1]) == "2P-10P")
book.batchUpdate(body={"requests": [{"insertDimension": {"range": {
    "sheetId": book.gids["CAN - BM - BM4060"], "dimension": "ROWS", "startIndex": 2,
    "endIndex": 3}}}]})
check("a row is inserted under the names", len(book.tabs["CAN - BM - BM4060"]) == 3)

print("\nA TEST NEVER REACHES THE LIVE WORKBOOK")
try:
    cbh.workbook("postgresql://x/y?options=-csearch_path%3Dsome_test%2Cpublic")
    check("a test schema's DSN is refused the live workbook", False)
except hcl.WorkbookRefused as exc:
    check("a test schema's DSN is refused the live workbook", exc.code == "test_database", exc.code)

print("\nA SHIFT IN PROGRESS")
TODAY, YESTERDAY = "2026-09-23", "2026-09-22"
g = {"location": "CAN - BM - BM4060", "cols": [{"iso": YESTERDAY}, {"iso": TODAY}],
     "rows": [{"employee": "Ann Roe", "cells": [{"text": ""}, {"text": "8A-8P"}]},
              {"employee": "Ben Left", "cells": [{"text": "8P-8A"}, {"text": ""}]}]}
at = lambda h: datetime(2026, 9, 23, h, 0, tzinfo=hcl.OHIO)  # noqa: E731
c10 = hcl.compute(g, now=at(10))
check("at ten in the morning Ann's day shift is running",
      c10["cells"][f"Ann Roe|{TODAY}"]["state"] == "in_progress"
      and f"Ann Roe|{TODAY}" in c10["running"], c10["running"])
check("at three in the morning yesterday's overnight is still running",
      hcl.compute(g, now=at(3))["cells"][f"Ben Left|{YESTERDAY}"]["state"] == "in_progress")
check("at nine at night it is done, and at seven in the morning it had not begun",
      hcl.compute(g, now=at(21))["cells"][f"Ann Roe|{TODAY}"]["state"] == "past"
      and hcl.compute(g, now=at(7))["cells"][f"Ann Roe|{TODAY}"]["state"] == "upcoming")
check("each cell says when it starts and ends, in Ohio",
      c10["cells"][f"Ann Roe|{TODAY}"]["ends_at"].startswith("2026-09-23T20:00:00-04:00"),
      c10["cells"][f"Ann Roe|{TODAY}"].get("ends_at"))

print("\nWHAT WAS PUBLISHED SHOWS BEFORE THE MIRROR READS IT BACK")
g2 = {"cols": [{"iso": TODAY}], "rows": [{"employee": "Ann Roe", "cells": [{"text": "8A-4P", "edited": True}]}]}
hcl.lay_published(g2, [TODAY], {("Ann Roe", TODAY): "8A-2P", ("Zoe New", TODAY): "2P-10P",
                                ("Gone Row", TODAY): ""})
check("a published cell replaces the mirror's text, marked pending, no longer 'edited'",
      g2["rows"][0]["cells"][0] == {"text": "8A-2P", "pending": True}, g2["rows"][0])
check("a person the workbook just gained a row for is given it",
      any(r["employee"] == "Zoe New" and r.get("pending_row") for r in g2["rows"]))
check("emptying a row the mirror never drew draws nothing", not any(
    r["employee"] == "Gone Row" for r in g2["rows"]))

print("\nTHE LAW — the Builder's gate is House Calendars' gate")
BM, JH = "CAN - BM - BM4060", "CAN - JH - ABD2704"
base = {"name": "", "badges": ["STAFF"], "whole_company": False, "sees_reasons": False,
        "manages": [], "decides_everywhere": False, "decides": [], "role": "staff"}
hm = {**base, "name": "Hana Boss", "manages": ["BM4060"], "decides": ["BM4060"]}
director = {**base, "badges": ["DIRECTOR"], "whole_company": True, "sees_reasons": True,
            "decides_everywhere": True}
manager_role = {**base, "badges": ["MANAGER"], "whole_company": True, "role": "manager"}
check("a house manager builds their own house", sr.may_edit_calendar(hm, BM))
check("and not another house", not sr.may_edit_calendar(hm, JH))
check("a member of staff builds none", not sr.may_edit_calendar({**base, "name": "Ann"}, BM))
check("a director builds every house, and may use the master grid",
      sr.may_edit_calendar(director, JH) and sr.edits_every_house(director))
check("a house manager may not use the master grid — it changes every house at once",
      not sr.edits_every_house(hm))
check("the role=manager test account keeps its named exception",
      sr.may_edit_calendar(manager_role, JH) and sr.edits_every_house(manager_role))
check("the calendar's sentence tells an editor where the calendar is edited now",
      "Calendar Builder" in sr.calendar_access(hm, BM, {"readable": True, "by_code": {}})["why"])

print("\nTHE DOORS — as the relay declares them")
door = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")


def body_of(src: str, name: str) -> str:
    m = re.search(rf"^(?:async )?def {name}\(.*?(?=^(?:@app\.|async def |def |[A-Z_]+ = ))",
                  src, re.S | re.M)
    return m.group(0) if m else ""


for name in ("lane_housecal_cell", "lane_housecal_move"):
    text = body_of(door, name)
    check(f"House Calendars' {name} is closed and points at the Builder",
          "_housecal_edits_moved(" in text and "house_cal_live" not in text
          and "_housecal_viewer(authorization)" in text, text[:200])
check("the closed doors answer 410 moved_to_builder with the Builder link",
      '"status": 410' in body_of(door, "_housecal_edits_moved")
      and "builder_link" in body_of(door, "_housecal_edits_moved"))
HOUSE_DOORS = ("lane_cal_builder_house", "lane_cal_builder_history", "lane_cal_builder_house_cell",
               "lane_cal_builder_house_move", "lane_cal_builder_request_off",
               "lane_cal_builder_call_off", "lane_cal_builder_undo", "lane_cal_builder_discard",
               "lane_cal_builder_house_publish")
for name in HOUSE_DOORS:
    text = body_of(door, name)
    check(f"{name} asks the calendar's law for THAT house",
          "_builder_house(authorization, location)" in text and "actor[0]" not in text, text[:160])
check("the law it asks is may_edit_calendar, per house",
      "shift_requests.may_edit_calendar(who, location)" in body_of(door, "_builder_house"))
check("the Builder's rail lists only the houses this reader builds",
      'if not access["edit"]' in body_of(door, "lane_cal_builder_houses"))
MASTER = ("lane_cal_builder_grid", "lane_cal_builder_cell", "lane_cal_builder_apply_requests",
          "lane_cal_builder_publish", "lane_cal_builder_generate", "lane_cal_builder_publish_houses")
for name in MASTER:
    check(f"{name} is for those who edit every house",
          "_builder_master(authorization)" in body_of(door, name))
check("the Builder's old role gate is gone",
      "_cal_builder_actor" not in door and 'actor[0] not in ("admin", "manager")' not in
      body_of(door, "_builder_viewer"))
check("a picker's times are turned into the code on the server, never trusted from the screen",
      "value_from_times" in body_of(door, "lane_cal_builder_house_cell"))
check("a new person's name must be one the staff directory holds",
      "calendar_builder_houses.admits" in body_of(door, "lane_cal_builder_house_cell")
      and "calendar_builder_houses.admits" in body_of(door, "lane_cal_builder_house_move"))

print("\nTEST MODE AND THE FULL CALL-OFF — the switch, the road, and their doors")
import effective_roster as er  # noqa: E402
import calloff_road  # noqa: E402
import web_gate  # noqa: E402
er.use_switch(None)
check("a process that was handed no switch holds, as an unreadable one does",
      er.test_mode()["on"] is True and er.test_mode()["readable"] is False)
er.use_switch(lambda: (_ for _ in ()).throw(RuntimeError("lane not read")))
check("a switch that raises HOLDS — unreadable is on",
      er.test_mode()["on"] is True and er.test_mode()["readable"] is False)
er.use_switch(lambda: {"on": "maybe"})
check("a switch that answers neither on nor off holds", er.test_mode()["on"] is True)
er.use_switch(lambda: {"on": False, "readable": True, "word": "off"})
check("only a plain off lets the workbook be written", er.test_mode()["on"] is False)
er.use_switch(None)
check("the relay hands its one switch to the roster writers at import, before any door can run",
      re.search(r"^effective_roster\.use_switch\(_web_switch\)$", door, re.M) is not None)
server_src_cbh = (SERVER / "calendar_builder_houses.py").read_text(encoding="utf-8")
check("the one writer holds while the switch is on, and never for the migration's rehearsal",
      "if record and switch.get(\"on\"):" in body_of(server_src_cbh, "publish_cells")
      and "_hold_cells(" in body_of(server_src_cbh, "publish_cells"))
migrate_src = (HERE.parent / "migrate_housecal_overrides.py").read_text(encoding="utf-8")
check("the overrides migration reads test mode as the relay does and refuses --apply unless it reads off",
      "er.use_switch(lambda: SWITCH)" in migrate_src
      and "web_gate.switch_from(" in migrate_src
      and 'if SWITCH.get("on") is not False or not SWITCH.get("readable"):' in migrate_src
      and migrate_src.index("REFUSED --apply") < migrate_src.index("cbh.publish_cells("))
check("a held write never touches the workbook — no Sheets call in the held path",
      "workbook(" not in body_of(server_src_cbh, "_hold_cells")
      and "spreadsheets()" not in body_of(server_src_cbh, "_hold_cells"))
check("Publish now is refused while test mode holds, and goes through the one writer after",
      "test_mode_on" in body_of(server_src_cbh, "publish_held")
      and "publish_cells(" in body_of(server_src_cbh, "publish_held"))
for name in ("lane_cal_builder_held_publish", "lane_cal_builder_held_discard"):
    check(f"{name} asks the calendar's law for THAT house",
          "_builder_house(authorization, location)" in body_of(door, name), body_of(door, name)[:160])
now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
td = __import__("datetime").timedelta
check("a Builder call-off's road is offered at once, waits RETRY_S after a try, and is given up after GIVE_UP_S",
      calloff_road.due({"created_at": now}, now) == "offer"
      and calloff_road.due({"created_at": now, "tried_at": now - td(seconds=10)}, now) == "wait"
      and calloff_road.due({"created_at": now - td(seconds=calloff_road.GIVE_UP_S + 5)}, now) == "give_up")
check("only what the door NAMES counts: a refusal or a bare 200 files nothing",
      calloff_road.results_of({"status": 403, "message": "Unknown action"}) == ({}, "Unknown action")
      and calloff_road.results_of({"status": 200, "data": {}}) == ({}, "")
      and calloff_road.filed({"ok": True, "recorded": False}) is False
      and calloff_road.filed({"ok": True, "recorded": True}) is True)
check("the relay's post names the door by its literal name, and runs on the beat and at the press",
      "await _calloff_calendar_python(payload)" in body_of(door, "_calloff_road_post")
      and '_backend_pass(COMM_CALL_OFF_FORM_APP, "callOffFromCalendar"' in body_of(door, "_calloff_calendar_python")
      and "_keep_task(_calloff_road_post())" in body_of(door, "lane_cal_builder_call_off")
      and "asyncio.create_task(_calloff_road_post())" not in door
      and "await _calloff_road_post()" in door and calloff_road.DOOR == "callOffFromCalendar")
check("the pool row and the owed road are one act",
      "calloff_road.owe(cur," in body_of(server_src_cbh, "mark_call_off"))
rows_ = web_gate.roster_rows("CAN - BM - BM4060", [{"employee": "Ann Roe", "col_iso": "2026-09-24",
                                                     "value": "8A-2P", "was": "8A-4P"}],
                             via="publish", actor="Hana Boss", act="BA1",
                             switch={"on": True, "readable": True})
check("a held roster write is ONE row of the mock outbox, in its columns, naming the cell and what it said",
      len(rows_) == 1 and set(rows_[0]) == set(web_gate.COMM_MOCK_HEADER) - {"createdAt", "updatedAt"}
      and rows_[0]["channel"] == "roster_write" and rows_[0]["method"] == "rosterWrite"
      and re.fullmatch(r"web_[0-9a-f]{20}", rows_[0]["id"]) is not None
      and "Ann Roe" in rows_[0]["body"] and "was 8A-4P" in rows_[0]["body"]
      and rows_[0]["to_masked"] == "BM" and rows_[0]["held_by"] == web_gate.HELD_TEST, rows_)
check("…and the same act held twice is the same row",
      web_gate.roster_rows("CAN - BM - BM4060", [{"employee": "Ann Roe", "col_iso": "x", "value": "y"}],
                           via="publish", actor="a", act="BA1", switch={"on": True})[0]["id"] == rows_[0]["id"])
check("the Calendar Builder feeds its gated pages' slices only to a reader who edits every house — "
      "per resource, from the manifest's gates, so the screens that moved in from the Shift Board "
      "are fed as they always were",
      "_app_feeds(a, role, worn, resource)" in body_of(door, "_apps_open")
      and "shift_requests.REASON_BADGES" in body_of(door, "_app_feeds")
      and "_RESOURCE_GATES.get(resource)" in body_of(door, "_app_feeds")
      and body_of(door, "_note_gates").count("_RESOURCE_GATES[") == 1
      and door.count("_note_gates(entry)") == 2)
check("the HM a current ** manager wears by code opens the calendar apps alone: every other app's slices "
      "read the written badges",
      'CALENDAR_BADGE_APPS = frozenset({"calendarbuilder", "shiftboard"})' in door
      and "(worn | derived) if a in CALENDAR_BADGE_APPS else worn" in body_of(door, "_apps_open")
      and "| _calendar_badges(" not in door
      and door.count("badges_derived = _calendar_badges(member or uid)") == 2
      and door.count("badges_worn, badges_derived)") == 3)
check("…and a manifest from before page gates keeps the app's old rule, so a relay restarted ahead of "
      "the SPA widens nothing",
      "(app == CALENDAR_BUILDER_APP) if gates is None" in body_of(door, "_app_feeds")
      and 'CALENDAR_BUILDER_APP = "calendarbuilder"' in door)
_manifest = json.loads((HERE.parent.parent / "public" / "snapshot-manifest.json").read_text())
_by = {e["resource"]: e for e in _manifest["resources"]}
check("THE MANIFEST SAYS WHICH SLICES ARE THE GATED PAGES' ALONE: the estate's slices name Calendar "
      "Builder in `gates`; the screens that moved in from the Shift Board name it in `apps` and "
      "not in `gates`",
      all("calendarbuilder" in (_by.get(r, {}).get("gates") or {})
          for r in ("calendarGrid", "calendarConflicts", "calendarHours", "calendarStaff",
                    "calendarHouses", "calendarRequests", "coverageSuggestions"))
      and all("calendarbuilder" in _by[r]["apps"] and "calendarbuilder" not in (_by[r].get("gates") or {})
              for r in ("shiftCards", "shiftMatrix", "shiftTimeline", "shifts", "events")),
      {r: [_by.get(r, {}).get("apps"), _by.get(r, {}).get("gates")] for r in ("calendarGrid", "shiftCards")})
check("…and the client role gains no estate slice from the app's widened audience",
      all("client" not in _by[r]["roles"] for r in ("calendarGrid", "calendarConflicts", "calendarHours",
                                                     "calendarStaff", "calendarHouses", "calendarRequests")),
      {r: _by[r]["roles"] for r in ("calendarGrid", "calendarStaff")})
# the grant tool (tools/grant_calendarbuilder_hm.py)
import importlib.util  # noqa: E402
_gspec = importlib.util.spec_from_file_location("grant_calendarbuilder_hm", HERE.parent / "grant_calendarbuilder_hm.py")
_grant = importlib.util.module_from_spec(_gspec)
_gspec.loader.exec_module(_grant)
_tab = [["app_id", "badges", "updated_at", "updated_by"],
        ["calendarbuilder", "DIRECTOR, ADMINISTRATOR, ADMIN, ENTITY", "", ""],
        ["shiftboard", "DIRECTOR, HM, STAFF", "", ""]]
_p = _grant.plan(_tab)
check("the grant adds HM and the Shift Board's readers to the calendarbuilder row and keeps every "
      "badge already on it",
      _p["ok"] and _p["row"] == 2
      and _p["after"] == ["DIRECTOR", "ADMINISTRATOR", "ADMIN", "ENTITY", "HM", "STAFF"]
      and _p["from_shiftboard"] == ["STAFF"]
      and _p["change"] is True and _p["requests_has_hm"] is True, _p)
_live = [_tab[0], ["calendarbuilder", "DIRECTOR, ADMINISTRATOR, ADMIN, ENTITY", "", ""],
         ["shiftboard", "DIRECTOR, ADMINISTRATOR, ADMIN, ENTITY, MANAGER, HM, STAFF, CLIENT, GUARDIAN", "", ""]]
check("against the rows the matrix holds today, the row becomes exactly the Shift Board's readers — "
      "no badge the Shift Board did not admit",
      set(_grant.plan(_live)["after"]) == set(_grant._words(_live[2][1]))
      and _grant.plan(_live)["after"][:4] == ["DIRECTOR", "ADMINISTRATOR", "ADMIN", "ENTITY"])
check("a row that already names HM is left alone, and a missing row is never invented",
      _grant.plan([_tab[0], ["calendarbuilder", "DIRECTOR, HM", "", ""]])["change"] is False
      and _grant.plan([_tab[0], ["shiftboard", "HM", "", ""]])["ok"] is False)
check("importing the tool fetches nothing — it is a plan until it is run, and writes only with --apply",
      "_bearer()" not in (HERE.parent / "grant_calendarbuilder_hm.py").read_text().split("def main")[0]
      .split("def _bearer")[0] and '"--apply" in argv' in (HERE.parent / "grant_calendarbuilder_hm.py")
      .read_text())

print("\nONE WRITER — nothing writes an override")
server_src = {p.name: p.read_text(encoding="utf-8") for p in SERVER.glob("*.py")}
writers = sorted(n for n, s in server_src.items()
                 if re.search(r"INSERT INTO asa_house_calendar_overrides", s))
check("no module on the relay inserts an override any more", writers == [], writers)
hsrc = server_src["house_cal_live.py"]
check("house_cal_live has no override writer left (set_cell, move_cell, _upsert, _write)",
      not re.search(r"^def (set_cell|move_cell|_upsert|_write|writable|movable)\(", hsrc, re.M))
claim = body_of(hsrc, "claim_open_shift")
check("a claim moves its cells only through the writer it is handed",
      "publish(location, cells)" in claim and "asa_house_calendar_overrides" not in claim)
srsrc = server_src["shift_requests.py"]
check("the house manager's decision hands the claim the Builder's writer",
      "publish=_writer(dsn" in body_of(srsrc, "decide")
      and "publish=_writer(dsn" in body_of(srsrc, "take_open_shift"))
check("and a workbook that refuses refuses the decision, in words",
      "WorkbookRefused" in body_of(srsrc, "decide"))
dec = body_of(srsrc, "decide")
check("the decision reads the roster INSIDE the person's gate, not before it waits on it",
      dec.index("with person_gates(dsn, [person, *trainers]):") < dec.index("view = estate(dsn, fresh=True)"))
rec = body_of(server_src["calendar_builder_houses.py"], "_record_published")
check("the one writer drops the overlap law's held picture the moment a publish is recorded — while "
      "the writer still holds the people's gates — before it rings the bell",
      "shift_requests.forget_estate()" in rec
      and rec.index("shift_requests.forget_estate()") < rec.index("effective_roster.announce("))
check("a batch of completed swaps forgets it after each one, before those two gates open",
      "sr.forget_estate()" in body_of(server_src["shift_handoff.py"], "complete_ready").split(
          "moved = _complete(")[1].split("state = str(moved")[0])
hosrc = server_src["shift_handoff.py"]
check("a completed swap writes through the same writer",
      "calendar_builder_houses.publish_cells" in body_of(hosrc, "_complete")
      and "_write(" not in body_of(hosrc, "_complete"))
check("the estate the overlap law reads lays the published cells over the mirror",
      "pending_publishes" in body_of(srsrc, "estate"))
check("House Calendars' own grid does too", "lay_published" in body_of(hsrc, "merged_grid")
      and "lay_published" in body_of(hsrc, "open_shifts"))
check("Mark Call-Off opens a pooled call-off and never writes the workbook",
      "asa_shift_pool" in body_of(server_src["calendar_builder_houses.py"], "mark_call_off")
      and "publish_cells" not in body_of(server_src["calendar_builder_houses.py"], "mark_call_off"))
check("the migration is a dry run unless told otherwise",
      "--apply" in (ROOT / "tools" / "migrate_housecal_overrides.py").read_text()
      and "a plan only" in (ROOT / "tools" / "migrate_housecal_overrides.py").read_text())
# the migration is not run: its body must compile and its modules exist
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location("migrate_housecal_overrides",
                                               ROOT / "tools" / "migrate_housecal_overrides.py")
_mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mig)
try:
    compile(_mig.BODY, "migrate_housecal_overrides.BODY", "exec")
    check("the migration's body compiles", True)
except SyntaxError as exc:
    check("the migration's body compiles", False, exc)
check("and every module it ships is in this checkout",
      all((SERVER / f"{m}.py").exists() for m in _mig.MODULES), _mig.MODULES)
check("its rehearsal records nothing, and its real run goes through the one writer",
      "record=not ARGS[\"rehearse\"]" in _mig.BODY and "cbh.publish_cells(" in _mig.BODY
      and "INSERT INTO asa_house_calendar_overrides" not in _mig.BODY)


print("\nTHE MASTER GRID — an overnight collides with the next morning, at any house")
import calendar_builder_write as cbw_pure  # noqa: E402
import calendar_generator as cg  # noqa: E402
import effective_roster as er_pure  # noqa: E402
import time_off as to_pure  # noqa: E402

P0 = date(2026, 10, 5)
PD = [(P0 + timedelta(days=i)).isoformat() for i in range(4)]
EVE = (P0 - timedelta(days=1)).isoformat()


def master_row(sheet_row, house, name, texts):
    return {"house": house, "designation": "DSP", "employee": name, "rowType": "staff", "sheetRow": sheet_row,
            "cells": [{"date": d, "text": t} for d, t in zip(PD, texts)]}


def master_ctx(rows):
    return {"cols": [{"index": 3 + i, "iso": d} for i, d in enumerate(PD)], "rows": rows,
            "by_row": {r["sheetRow"]: r for r in rows}, "period_start": PD[0]}


# Joan works SB's overnight on day 0 (ends 08:15 on day 1) and is off there after; EC's usual day
# shift is 7A-230P.
MASTER = [master_row(10, "SB4045", "Joan Cheru", ["8P-815A", "OFF", "OFF", "OFF"]),
          master_row(11, "EC4048", "Joan Cheru", ["", "", "7A-230P", ""])]
NIGHT_BEFORE = {"joancheru": [{"span": (datetime.fromisoformat(EVE + "T22:00"),
                                        datetime.fromisoformat(PD[0] + "T08:00")),
                               "location": "CAN - MS - MS4060", "value": "10P-8A", "col_iso": EVE}]}


class _FakeCur:
    def __init__(self, log):
        self.log = log

    def execute(self, sql, args=None):
        self.log.append((sql, args))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _FakeConn(_FakeCur):
    def cursor(self, *a, **k):
        return _FakeCur(self.log)

    def commit(self):
        pass


gen_log: list = []
held_cg = {k: getattr(cg, k) for k in ("_grid_context", "_draft_map", "_mirror_rows", "time_off_windows",
                                       "nights_before", "psycopg2")}
cg._grid_context = lambda: master_ctx(MASTER)
cg._draft_map = lambda dsn, ps: {}
cg._mirror_rows = lambda dsn, tab: ([], None)
cg.time_off_windows = lambda dsn: ([], [])
cg.nights_before = lambda dsn, ps: NIGHT_BEFORE
cg.psycopg2 = types.SimpleNamespace(connect=lambda dsn: _FakeConn(gen_log))
try:
    gen = cg.generate("dsn", "the suite")
    staged = sorted(a[2] for s, a in gen_log if "INSERT INTO asa_cal_builder_draft" in s and a[3] == "EC4048")

    def _down(dsn, ps):
        raise RuntimeError("the estate is down")

    cg.nights_before = _down
    gen_log.clear()
    gen_down = cg.generate("dsn", "the suite")
finally:
    for k, v in held_cg.items():
        setattr(cg, k, v)
check("THE GENERATOR COMPARES ABSOLUTE INTERVALS: after SB's 8P-815A it stages nothing at EC the next "
      "morning, nothing on the first morning after the live night before the period, and still fills the "
      "free day",
      gen.get("status") == 200 and staged == [PD[3]] and gen["data"]["skippedConflicts"] == 2, (gen, staged))
check("…and a live calendar it cannot read generates nothing, and says why",
      gen_down.get("status") == 503 and "night before the period" in gen_down.get("message", "")
      and not [s for s, a in gen_log if "asa_cal_builder_draft" in s and "INSERT" in s], gen_down)

held_cbw = {k: getattr(cbw_pure, k) for k in ("_grid_context", "_draft_map", "nights_before",
                                             "_sheets_write_service")}
held_away = to_pure.away


class _Reached(Exception):
    pass


def _no_sheets():
    raise _Reached()


def master_publish(rows, draft, night=None):
    cbw_pure._grid_context = lambda: master_ctx(rows)
    cbw_pure._draft_map = lambda dsn, ps: draft
    cbw_pure.nights_before = night if callable(night) else (lambda dsn, ps: night or {})
    try:
        return cbw_pure.publish("dsn", "the suite")
    except _Reached:
        return "reached the workbook"


def drafted(sheet_row, house, day, value):
    return {(sheet_row, day): {"house": house, "employee": "Joan Cheru", "value": value, "base_value": "",
                               "updated_at": "", "updated_by": "x"}}


er_pure.use_switch(lambda: {"on": False, "readable": True, "word": "off", "why": ""})
to_pure.away = lambda dsn, names: {}
cbw_pure._sheets_write_service = _no_sheets
free_rows = [master_row(10, "SB4045", "Joan Cheru", ["8P-815A", "", "", ""]),
             master_row(11, "EC4048", "Joan Cheru", ["", "", "", ""])]
try:
    pub_next = master_publish(free_rows, drafted(11, "EC4048", PD[1], "7A-230P"))
    pub_first = master_publish(free_rows, drafted(11, "EC4048", PD[0], "7A-230P"), NIGHT_BEFORE)
    pub_free = master_publish(free_rows, drafted(11, "EC4048", PD[3], "7A-230P"), NIGHT_BEFORE)
    pub_down = master_publish(free_rows, drafted(11, "EC4048", PD[3], "7A-230P"),
                              lambda dsn, ps: (_ for _ in ()).throw(RuntimeError("the estate is down")))
finally:
    for k, v in held_cbw.items():
        setattr(cbw_pure, k, v)
    to_pure.away = held_away
    er_pure.use_switch(None)
blocked_next = ((pub_next or {}).get("data") or {}).get("blocked") if isinstance(pub_next, dict) else None
blocked_first = ((pub_first or {}).get("data") or {}).get("blocked") if isinstance(pub_first, dict) else None
check("PUBLISH REFUSES A DRAFT THAT OVERLAPS AN OVERNIGHT: 7A-230P at EC the morning after SB's 8P-815A is "
      "blocked with the house, the shift and the day it overlaps",
      isinstance(pub_next, dict) and pub_next.get("status") == 409 and blocked_next
      and blocked_next[0]["date"] == PD[1] and f"overlaps SB4045 8P-815A on {PD[0]}" in blocked_next[0]["reason"],
      pub_next)
check("…and one that overlaps the live night before the period, read from the house calendars",
      isinstance(pub_first, dict) and pub_first.get("status") == 409 and blocked_first
      and f"overlaps CAN - MS - MS4060 10P-8A on {EVE}" in blocked_first[0]["reason"], pub_first)
check("…while a draft that collides with nothing goes on to the workbook",
      pub_free == "reached the workbook", pub_free)
check("…and a live calendar it cannot read publishes nothing, and says why",
      isinstance(pub_down, dict) and pub_down.get("status") == 503
      and "night before the period" in pub_down.get("message", ""), pub_down)


# the lane — against a real database, in a schema of its own

LANE = r'''
import json, os, sys
from datetime import datetime, timedelta, timezone
sys.path.insert(0, LANE_DIR)
# mock rows stay in this run's own directory, never the live relay's
os.environ["HUB_WEB_MOCK_DIR"] = LANE_DIR + "/mock"
import psycopg2, psycopg2.extras
import lane_schema
import house_cal_live as hcl, shift_handoff
import shift_requests as sr
import calendar_builder_houses as cbh
import effective_roster
import time_off
# an unregistered switch holds; this lane writes unless a check turns test mode on
OFF = {"on": False, "readable": True, "word": "off", "why": ""}
effective_roster.use_switch(lambda: OFF)
# no Time Off house: the verdict never reads the live one
time_off.use_house(time_off.NoHouse())
# …so the swap's directors are stood in; the list itself is held by test-shift-transfer
shift_handoff.directors_for = lambda dsn: {"readable": True, "names": ["Dee Direct"],
                                           "why": "the director Dee Direct approves"}

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
ROOMS = lane_schema.Rooms(DSN, "cal-builder-houses")
SCHEMA = ROOMS.name()
OUT = {}
BM = "CAN - BM - BM4060"
JH = "CAN - JH - ABD2704"
TM = "CAN - TM - TM100"
today = datetime.now(sr.OHIO).date()
PAST = (today - timedelta(days=1)).isoformat()
D1 = (today + timedelta(days=1)).isoformat()
D2 = (today + timedelta(days=2)).isoformat()
D3 = (today + timedelta(days=3)).isoformat()
ISOS = [PAST, D1, D2, D3]
EVERY = {"done": 1, "owed": 0, "clients": [], "owed_for": []}
# Zoe New has no IST anywhere; Tia Mode and Tom Mock work the test-mode house
TRAINED = ("Ann Roe", "Ben Left", "Cy Far", "Dee Way", "Tia Mode", "Tom Mock")
# the IST settings as a read that landed, holding the shipped values
import ist_config
ist_config.pin(dict(ist_config.SHIPPED))
sr.ist_index = lambda dsn, **k: {
    "readable": True, "why": "", "rows": 0, "source": "test",
    "by_person": {sr.fold(n): {"BM4060": dict(EVERY), "ABD2704": dict(EVERY), "TM100": dict(EVERY)}
                  for n in TRAINED}}
ADMIT = lambda name: True


def grid(rows):
    return {"cols": [{"iso": i} for i in ISOS],
            "rows": [{"employee": e, "cells": [{"text": t} for t in cs]} for e, cs in rows]}


GRIDS = {
    BM: grid([("OPEN", ["", "8A-4P", "", ""]),
              ("OPEN", ["", "", "", ""]),
              ("OPEN", ["8A-2P", "", "", ""]),
              ("Ann Roe", ["8A-4P", "8A-4P", "8A-4P", ""]),
              ("Ben Left", ["", "2P-10P", "", ""]),
              ("Cy Far", ["", "", "", "10P-8A"])]),
    JH: grid([("Dee Way", ["8A-4P", "8A-4P", "2P-10P", ""]),
              ("Eve Near", ["", "", "", "8A-4P"])]),
    # the house test mode is exercised on — nobody here works anywhere else
    TM: grid([("OPEN", ["", "", "8A-4P", ""]),
              ("Tia Mode", ["", "", "", "8A-4P"]),
              ("Tom Mock", ["", "", "", ""])]),
}

ROOMS.make()
T = ROOMS.path(SCHEMA)


def rows(sql, args=()):
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(sql, args)
        return [list(r) for r in cur.fetchall()]


def refused(fn):
    try:
        return ["allowed", fn()]
    except hcl.Occupied as exc:
        return ["occupied", exc.value]
    except hcl.OpenShiftCell as exc:
        return ["open_shift", str(exc)]
    except hcl.WorkbookRefused as exc:
        return ["workbook", exc.code, exc.blocked]
    except sr.Refused as exc:
        return ["refused", exc.code, exc.why]
    except ValueError as exc:
        return ["value", str(exc)]
    except LookupError as exc:
        return ["lookup", str(exc)]


def cell_of(g, name, iso):
    r = next((r for r in g["rows"] if r["employee"] == name), None)
    if r is None:
        return None
    i = [str(c.get("iso")) for c in g["cols"]].index(iso)
    return (r["cells"][i] if i < len(r["cells"]) else {}).get("text", "")


try:
    with psycopg2.connect(T) as c, c.cursor() as cur:
        # the mirror, stamped a minute ago: a publish now is newer than it
        cur.execute("CREATE TABLE asa_house_calendar_live (location TEXT PRIMARY KEY, "
                    "grid JSONB, updated_at TIMESTAMPTZ DEFAULT now() - interval '1 minute')")
        cur.execute(hcl.CLAIMS_DDL)
        cur.execute(shift_handoff.HANDOFFS_DDL)
        cur.execute(shift_handoff.OPEN_INDEX_DDL)
        for stmt in sr.DDL:
            cur.execute(stmt)
        for loc, g in GRIDS.items():
            cur.execute("INSERT INTO asa_house_calendar_live (location, grid) VALUES (%s,%s)",
                        (loc, psycopg2.extras.Json(g)))
        c.commit()
    # every table the code reads is the lane's before its first read, the call-off road included
    OUT["owned"] = lane_schema.own_shift_lane(T, SCHEMA, LANE_DIR)
    book = cbh.MemoryWorkbook.from_grids(GRIDS)
    cbh.use_workbook(book)
    sr.forget_estate()

    # ── a draft, and the house recomputed over it ───────────────────────────
    OUT["draft"] = refused(lambda: cbh.stage_cell(T, location=BM, employee="Ann Roe", col_iso=D1,
                                                  value="8A-2P", actor="Hana Boss")["was"])
    OUT["draft_row"] = rows("SELECT value, base_value FROM asa_cal_builder_house_draft "
                            "WHERE location=%s AND employee='Ann Roe'", (BM,))
    dg = cbh.draft_grid(T, BM, None)
    ann = next(p for p in dg["computed"]["people"] if p["employee"] == "Ann Roe")
    OUT["draft_hours"] = ann["hours"]
    OUT["draft_marked"] = bool(dg["computed"]["cells"][f"Ann Roe|{D1}"].get("draft"))
    OUT["draft_count"] = dg["draft_count"]
    OUT["estate_weeks"] = dg["estate_weeks"].get("Ann Roe")
    OUT["draft_back"] = cbh.stage_cell(T, location=BM, employee="Ann Roe", col_iso=D1,
                                       value="8A-4P", actor="Hana Boss")["changed"]
    OUT["draft_gone"] = rows("SELECT count(*) FROM asa_cal_builder_house_draft")[0][0]
    OUT["history"] = [[h["was"], h["now"], h["stage"], h["via"]]
                      for h in cbh.history(T, BM, "Ann Roe", D1)]

    # a name nobody admitted (typed by hand, on no staff list) is not placed
    OUT["no_admit"] = refused(lambda: cbh.stage_cell(
        T, location=BM, employee="Nobody Typed", col_iso=D1, value="8A-4P", actor="Hana Boss"))

    # ── the overlap law, across houses and across drafts ────────────────────
    OUT["clash_published"] = refused(lambda: cbh.stage_cell(
        T, location=BM, employee="Dee Way", col_iso=D1, value="10A-6P", actor="Hana Boss",
        admits=ADMIT))
    cbh.stage_cell(T, location=JH, employee="Cy Far", col_iso=D2, value="8A-4P",
                   actor="Rita Lead", admits=ADMIT)
    OUT["clash_draft"] = refused(lambda: cbh.stage_cell(
        T, location=BM, employee="Cy Far", col_iso=D2, value="9A-5P", actor="Hana Boss"))
    # a draft that takes Ben off BM on D1 frees him for JH on D1 — in the plan
    cbh.stage_cell(T, location=BM, employee="Ben Left", col_iso=D1, value="", actor="Hana Boss")
    OUT["plan_frees"] = refused(lambda: cbh.stage_cell(
        T, location=JH, employee="Ben Left", col_iso=D1, value="3P-9P", actor="Rita Lead",
        admits=ADMIT)["changed"])
    # …but a decision elsewhere at that hour still sees Ben's drafted JH shift
    held = sr.held_by(T, "Ben Left")
    OUT["decision_sees_draft"] = any(h["source"] == "draft" and h["location"] == JH for h in held)
    cbh.discard(T, location=JH, actor="Rita Lead")
    cbh.discard(T, location=BM, actor="Hana Boss")
    OUT["discarded"] = rows("SELECT count(*) FROM asa_cal_builder_house_draft")[0][0]

    # ── a move is one act; Undo reverts both cells ──────────────────────────
    mv = cbh.stage_move(T, location=BM, src_employee="Ann Roe", src_iso=D2,
                        dst_employee="Cy Far", dst_iso=D2, actor="Hana Boss")
    OUT["move"] = [mv["moved"], mv["value"]]
    OUT["move_drafts"] = sorted(rows("SELECT employee, value FROM asa_cal_builder_house_draft "
                                     "WHERE location=%s", (BM,)))
    un = cbh.undo(T, location=BM, actor="Hana Boss")
    OUT["undo"] = [un["undone"], rows("SELECT count(*) FROM asa_cal_builder_house_draft")[0][0]]
    OUT["undo_again"] = refused(lambda: cbh.undo(T, location=BM, actor="Hana Boss"))
    OUT["occupied"] = refused(lambda: cbh.stage_move(
        T, location=BM, src_employee="Ben Left", src_iso=D1, dst_employee="Ann Roe", dst_iso=D1,
        actor="Hana Boss"))
    OUT["replace"] = refused(lambda: cbh.stage_move(
        T, location=BM, src_employee="Ben Left", src_iso=D1, dst_employee="Ann Roe", dst_iso=D1,
        actor="Hana Boss", replace=True)["replaced"])
    cbh.undo(T, location=BM, actor="Hana Boss")
    OUT["swap"] = refused(lambda: cbh.stage_move(
        T, location=BM, src_employee="Ben Left", src_iso=D1, dst_employee="Ann Roe", dst_iso=D1,
        actor="Hana Boss", swap=True)["swap"])
    cbh.undo(T, location=BM, actor="Hana Boss")
    OUT["after_undos"] = rows("SELECT count(*) FROM asa_cal_builder_house_draft")[0][0]

    # ── an open shift the workbook holds is never typed over or dragged ────
    OUT["type_over_open"] = refused(lambda: cbh.stage_cell(
        T, location=BM, employee="OPEN", col_iso=D1, value="", actor="Hana Boss"))
    OUT["drag_off_open"] = refused(lambda: cbh.stage_move(
        T, location=BM, src_employee="OPEN", src_iso=D1, dst_employee="Cy Far", dst_iso=D1,
        actor="Hana Boss"))
    OUT["empty_open"] = refused(lambda: cbh.stage_cell(
        T, location=BM, employee="OPEN 2", col_iso=D3, value="8A-8P", actor="Hana Boss")["changed"])
    cbh.undo(T, location=BM, actor="Hana Boss")

    # ── Request Off: R/O, and the shift goes to the first free OPEN row ────
    ro = cbh.request_off(T, location=BM, employee="Ann Roe", col_iso=D2, actor="Hana Boss")
    OUT["request_off"] = [ro["value"], ro["moved_to"]]
    OUT["request_off_drafts"] = sorted(rows(
        "SELECT employee, value FROM asa_cal_builder_house_draft WHERE location=%s", (BM,)))
    cbh.undo(T, location=BM, actor="Hana Boss")

    # ── PUBLISH: one writer, fail closed, and shown at once ────────────────
    cbh.stage_cell(T, location=BM, employee="Ben Left", col_iso=D2, value="2P-10P",
                   actor="Hana Boss", note="covering the evening")
    cbh.stage_cell(T, location=BM, employee="Zoe New", col_iso=D3, value="8A-2P",
                   actor="Hana Boss", admits=ADMIT)
    zoe_ist = rows("SELECT ist_missing FROM asa_cal_builder_house_draft WHERE employee='Zoe New'")
    OUT["zoe_ist_said"] = bool(zoe_ist and zoe_ist[0][0])
    OUT["zoe_no_training_yet"] = rows("SELECT count(*) FROM asa_shift_requests "
                                      "WHERE kind=%s", (sr.KIND_IST,))[0][0]
    # somebody types into the workbook by hand under the draft
    tab = book.tabs[BM]
    ben_row = next(i for i, r in enumerate(tab) if len(r) > 1 and r[1] == "Ben Left")
    tab[ben_row][3 + ISOS.index(D2)] = "7A-3P"
    before_calls = len([c for c in book.calls if c[0] == "write"])
    OUT["blocked"] = refused(lambda: cbh.publish_house(T, location=BM, actor="Hana Boss"))
    OUT["blocked_wrote_nothing"] = len([c for c in book.calls if c[0] == "write"]) == before_calls
    OUT["blocked_kept_drafts"] = rows("SELECT count(*) FROM asa_cal_builder_house_draft")[0][0]
    tab[ben_row][3 + ISOS.index(D2)] = ""
    pub = cbh.publish_house(T, location=BM, actor="Hana Boss")
    OUT["published"] = [pub["written"], pub["rows_added"], len(pub["training"])]
    OUT["tab_after"] = [book.cell(BM, "Ben Left", D2), book.cell(BM, "Zoe New", D3)]
    OUT["drafts_after_publish"] = rows("SELECT count(*) FROM asa_cal_builder_house_draft")[0][0]
    OUT["undo_after_publish"] = refused(lambda: cbh.undo(T, location=BM, actor="Hana Boss"))
    OUT["edits_published"] = sorted(rows(
        "SELECT employee, old_value, new_value, via, note FROM asa_house_calendar_edits "
        "WHERE stage='published' AND location=%s", (BM,)))
    sr.forget_estate()
    shown = hcl.merged_grid(T, BM)
    OUT["shown_at_once"] = [cell_of(shown, "Ben Left", D2), cell_of(shown, "Zoe New", D3)]
    OUT["estate_at_once"] = sr.estate(T, fresh=True)["cells"][BM].get(("Zoe New", D3))
    OUT["training_recorded"] = rows("SELECT person, state, decided_by FROM asa_shift_requests "
                                    "WHERE kind=%s", (sr.KIND_IST,))

    # ── a house manager's decision is a one-cell publish ───────────────────
    sr.forget_estate()
    sr.sweep(T)
    took = sr.take_open_shift(T, location=BM, open_row="OPEN", col_iso=D1, person="Cy Far",
                              by="Hana Boss", may_decide=True)
    OUT["decided"] = [took["decided"], took["how"], took.get("assigned_to_row")]
    OUT["decision_tab"] = book.cell(BM, "Cy Far", D1)
    OUT["decision_edit"] = rows("SELECT employee, new_value, via FROM asa_house_calendar_edits "
                                "WHERE via LIKE 'decision:%%'")
    # a workbook that refuses: the shift is NOT given
    cbh.stage_cell(T, location=BM, employee="OPEN 2", col_iso=D2, value="8P-8A", actor="Hana Boss")
    cbh.publish_house(T, location=BM, actor="Hana Boss")
    sr.forget_estate()
    sr.sweep(T)
    # the ten minutes of applications have run: the decision is the house manager's
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_pool SET opened_at = now() - interval '1 hour'")
        c.commit()
    book.fail_next = RuntimeError("quota")
    OUT["decision_refused"] = refused(lambda: sr.take_open_shift(
        T, location=BM, open_row="OPEN 2", col_iso=D2, person="Eve Near", by="Hana Boss",
        may_decide=True))
    OUT["refused_not_claimed"] = rows("SELECT count(*) FROM asa_house_calendar_claims "
                                      "WHERE open_row='OPEN 2'")[0][0]
    OUT["refused_not_filled"] = rows("SELECT filled_by FROM asa_shift_pool WHERE "
                                     "open_row='OPEN 2' AND col_iso=%s", (D2,))
    book.fail_next = None

    # ── Mark Call-Off: the blood-red call-off shift, through the pool ───────
    co = cbh.mark_call_off(T, location=JH, employee="Dee Way", col_iso=D2, actor="Rita Lead",
                           note="sick")
    OUT["call_off"] = [bool(co["ref"]), co["window"]["kind"], co["path"].startswith("/#/")]
    OUT["call_off_pool"] = rows("SELECT kind, value, called_off_by FROM asa_shift_pool "
                                "WHERE location=%s AND open_row='Dee Way'", (JH,))
    OUT["call_off_tab_untouched"] = book.cell(JH, "Dee Way", D2)
    # a full call-off: the road is owed in the same act, keyed on the pool ref
    import calloff_road
    OUT["road"] = rows("SELECT ref, state, reason, actor, col_iso, value FROM asa_calendar_calloff_road "
                       "WHERE employee='Dee Way'")
    OUT["road_ref"] = co["road"] == "owed" and bool(OUT["road"]) and OUT["road"][0][0] == co["ref"]
    first = calloff_road.owed(T)
    pay = calloff_road.payload(first[0], {"name": "Rita Lead", "phone": "+13305550100"}) if first else {}
    OUT["road_payload"] = {k: pay.get(k) for k in ("instance", "date", "house", "shift", "reason",
                                                   "marked_by", "manager_name", "manager_phone")}
    OUT["road_start"] = pay.get("shift_start")
    calloff_road.mark(T, first, None, failure="the door could not be reached (TimeoutError)")
    OUT["road_failed"] = [rows("SELECT state, tries, last_error FROM asa_calendar_calloff_road "
                               "WHERE employee='Dee Way'"), len(calloff_road.owed(T))]
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_calendar_calloff_road SET tried_at = now() - interval '1 hour'")
        c.commit()
    again = calloff_road.owed(T)
    calloff_road.mark(T, again, {"status": 200, "data": {"rows": [
        {"instance": "SP0000000000", "ok": True, "recorded": True}]}})
    OUT["road_unnamed"] = rows("SELECT state FROM asa_calendar_calloff_road WHERE employee='Dee Way'")
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_calendar_calloff_road SET tried_at = now() - interval '1 hour'")
        c.commit()
    again = calloff_road.owed(T)
    calloff_road.mark(T, again, {"status": 200, "data": {"rows": [
        {"instance": co["ref"], "ok": True, "recorded": True, "tracker": "held: test mode"}]}})
    OUT["road_told"] = [rows("SELECT state, answer->>'tracker' FROM asa_calendar_calloff_road "
                             "WHERE employee='Dee Way'"), len(calloff_road.owed(T))]
    OUT["call_off_again"] = refused(lambda: cbh.mark_call_off(
        T, location=JH, employee="Dee Way", col_iso=D2, actor="Rita Lead"))
    OUT["call_off_no_draft_over"] = refused(lambda: cbh.stage_cell(
        T, location=JH, employee="Dee Way", col_iso=D2, value="", actor="Rita Lead"))
    drawn = sr.calendar_grid(T, JH, None)
    OUT["call_off_drawn"] = any(r.get("call_off_row") for r in drawn["rows"])
    # the reason stays in the pool, never the cell's history
    OUT["call_off_history_notes"] = [
        [h["note"] for h in cbh.history(T, JH, "Dee Way", D2) if h["stage"] == "call_off"],
        rows("SELECT reason FROM asa_shift_pool WHERE open_row='Dee Way'")]
    # a history row written before that is cut on the way out too
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_house_calendar_edits SET note='hospital' WHERE stage='call_off'")
        c.commit()
    OUT["call_off_history_cut"] = [
        [h["note"] for h in cbh.history(T, JH, "Dee Way", D2) if h["stage"] == "call_off"],
        [h["note"] for h in cbh.history(T, JH, "Dee Way", D2, sees_reasons=True)
         if h["stage"] == "call_off"]]

    # a shift is never given to a cell that holds another: refused, nothing moves
    cbh.stage_cell(T, location=JH, employee="Cy Far", col_iso=D2, value="6A-2P", actor="Rita Lead",
                   admits=ADMIT)
    cbh.publish_house(T, location=JH, actor="Rita Lead")
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_pool SET opened_at = now() - interval '6 hours' "
                    "WHERE open_row='Dee Way'")
        c.commit()
    sr.forget_estate()
    OUT["row_holds"] = refused(lambda: sr.decide(T, location=JH, open_row="Dee Way", col_iso=D2,
                                                 person="Cy Far", by="Rita Lead"))
    OUT["row_holds_nothing_moved"] = [book.cell(JH, "Dee Way", D2), book.cell(JH, "Cy Far", D2),
                                      rows("SELECT count(*) FROM asa_house_calendar_claims "
                                           "WHERE open_row='Dee Way'")[0][0]]

    # the decision reads the roster inside the person's gate, after a publish holding it
    import threading
    import time as _t
    held = threading.Event()

    def publisher():
        with sr.person_gate(T, "Cy Far"):
            held.set()
            _t.sleep(1.5)
            cbh.publish_cells(T, JH, [{"employee": "Cy Far", "col_iso": D2, "value": "7P-11P",
                                       "base": "6A-2P"}], actor="Rita Lead", via="publish")

    th = threading.Thread(target=publisher)
    th.start()
    held.wait(10)
    sr.estate(T, fresh=True)   # a picture taken before the write lands
    OUT["race"] = refused(lambda: sr.decide(T, location=BM, open_row="OPEN 2", col_iso=D2,
                                            person="Cy Far", by="Hana Boss"))
    th.join(10)
    OUT["race_not_given"] = [book.cell(BM, "Cy Far", D2),
                             rows("SELECT count(*) FROM asa_house_calendar_claims "
                                  "WHERE open_row='OPEN 2' AND col_iso=%s", (D2,))[0][0]]

    # ── A DRAFT ADDED BETWEEN THE GATES AND THE PICTURE STOPS THE PUBLISH ───
    cbh.stage_cell(T, location=BM, employee="Ben Left", col_iso=D3, value="8A-12P", actor="Hana Boss")
    real_drafts = cbh._drafts
    calls = [0]

    def first_read_misses_one(cur, location):
        got = real_drafts(cur, location)
        calls[0] += 1
        if calls[0] == 1:
            got = {k: v for k, v in got.items() if k[0] != "Ben Left"}
        return got

    cbh._drafts = first_read_misses_one
    try:
        OUT["draft_changed"] = refused(lambda: cbh.publish_house(T, location=BM, actor="Hana Boss"))
    finally:
        cbh._drafts = real_drafts
    OUT["draft_changed_kept"] = [book.cell(BM, "Ben Left", D3),
                                 rows("SELECT count(*) FROM asa_cal_builder_house_draft "
                                      "WHERE employee='Ben Left'")[0][0]]
    cbh.discard(T, location=BM, actor="Hana Boss")

    # ── THE MASTER GRID'S PUSH GOES THROUGH THE SAME LAW AND THE ONE WRITER ─
    import calendar_builder_write as cbw
    sr.forget_estate()
    # Dee works 8A-4P at JH on D1: a push putting her on BM 10A-6P that day is refused whole
    OUT["push_overlap"] = refused(lambda: cbh.push_house(
        T, location=BM, cells=[{"employee": "Dee Way", "col_iso": D1, "value": "10A-6P", "base": ""},
                               {"employee": "Ann Roe", "col_iso": D3, "value": "6P-10P", "base": ""}],
        actor="Dan Director"))
    OUT["push_overlap_wrote_nothing"] = [book.cell(BM, "Ann Roe", D3), book.cell(BM, "Dee Way", D1)]
    # an OPEN row holding a published shift is left out, and the rest still goes
    dry = cbh.push_house(T, location=BM, cells=[
        {"employee": "OPEN", "col_iso": D1, "value": "", "base": "8A-4P"},
        {"employee": "Ann Roe", "col_iso": D3, "value": "6P-10P", "base": ""}],
        actor="Dan Director", dry_run=True)
    OUT["push_dry"] = [dry["written"], dry["would_write"], [c["employee"] for c in dry["left_out"]],
                       book.cell(BM, "Ann Roe", D3)]
    real = cbh.push_house(T, location=BM, cells=[
        {"employee": "OPEN", "col_iso": D1, "value": "", "base": "8A-4P"},
        {"employee": "Ann Roe", "col_iso": D3, "value": "6P-10P", "base": ""}],
        actor="Dan Director")
    OUT["push_real"] = [real["written"], book.cell(BM, "Ann Roe", D3), book.cell(BM, "OPEN", D1),
                        rows("SELECT via FROM asa_house_calendar_edits WHERE employee='Ann Roe' "
                             "AND col_iso=%s AND stage='published' ORDER BY id DESC LIMIT 1", (D3,))]
    own = cbw._house_own_cells(T, BM)
    OUT["house_own"] = [own.get(("cyfar", D1)), ("annroe", D3) in own]

    # ── a swap both people agreed to writes both cells ─────────────────────
    sr.forget_estate()
    off = shift_handoff.offer(T, location=JH, col_iso=D3, from_staff="Eve Near",
                              to_staff="Ann Roe")
    shift_handoff.answer(T, off["id"], side="staff", word="yes")
    # the third consent; the director's own rules are held by test-shift-transfer
    shift_handoff.answer(T, off["id"], side="director", word="yes", by="Dee Direct")
    done = shift_handoff.answer(T, off["id"], side="manager", word="yes")
    OUT["swap_done"] = [done["state"], book.cell(JH, "Eve Near", D3),
                        book.cell(JH, "Ann Roe", D3)]

    # test mode holds the workbook; Publish now / Discard afterwards; an unreadable switch holds
    import effective_roster as er
    import calendar_builder_write as cbw2
    import web_gate
    OUT["days"] = [D1, D2, D3]
    HELD = {"on": True, "readable": True, "word": "on", "why": ""}
    er.use_switch(lambda: HELD)
    writes = lambda: len([c for c in book.calls if c[0] in ("write", "insert")])
    before = writes()
    cbh.stage_cell(T, location=TM, employee="Tia Mode", col_iso=D1, value="8A-2P", actor="Hana Boss")
    held = cbh.publish_house(T, location=TM, actor="Hana Boss")
    OUT["tm_publish"] = [held.get("test_mode"), held.get("written"), held.get("mock_row"),
                         book.cell(TM, "Tia Mode", D1), writes() - before,
                         rows("SELECT count(*) FROM asa_cal_builder_house_draft WHERE location=%s", (TM,))[0][0]]
    shown = sr.calendar_grid(T, TM, None)
    tia = next(r for r in shown["rows"] if r["employee"] == "Tia Mode")
    i1 = [str(c.get("iso")) for c in shown["cols"]].index(D1)
    OUT["tm_shown"] = [tia["cells"][i1].get("text"), tia["cells"][i1].get("test_mode")]
    with psycopg2.connect(T) as c, c.cursor() as cur:
        laid = er.effective_cells(cur, today, today + timedelta(days=5))
    OUT["tm_laid"] = [[x["employee"], x["value"], x["state"]] for x in laid if x["location"] == TM]
    kept = web_gate.pending()
    OUT["tm_mock"] = [[r["channel"], r["situation"], r["result"], "Tia Mode" in r["body"],
                       r["test_mode"]] for r in kept if r.get("channel") == "roster_write"]
    # a second publish stacks on what test mode already holds (its base is the held value)
    cbh.stage_cell(T, location=TM, employee="Tia Mode", col_iso=D1, value="8A-4P", actor="Hana Boss")
    held2 = cbh.publish_house(T, location=TM, actor="Hana Boss")
    OUT["tm_stack"] = [held2.get("test_mode"), held2.get("written"), book.cell(TM, "Tia Mode", D1)]
    # a house manager's decision: the claim stands, the cell is held
    sr.forget_estate()
    claimed = sr.take_open_shift(T, location=TM, open_row="OPEN", col_iso=D2, person="Tom Mock",
                                 by="Hana Boss", may_decide=True)
    OUT["tm_decision"] = [claimed.get("claimed_by"), (claimed.get("published") or {}).get("test_mode"),
                          book.cell(TM, "Tom Mock", D2), book.cell(TM, "OPEN", D2)]
    # a swap both people agreed to: done on the platform, both cells held, and it says so
    sr.forget_estate()
    swap = shift_handoff.offer(T, location=TM, col_iso=D3, from_staff="Tia Mode", to_staff="Tom Mock")
    shift_handoff.answer(T, swap["id"], side="staff", word="yes")
    shift_handoff.answer(T, swap["id"], side="director", word="yes", by="Dee Direct")
    swapped = shift_handoff.answer(T, swap["id"], side="manager", word="yes")
    OUT["tm_swap"] = [swapped["state"], "test mode" in str(swapped.get("why") or ""),
                      book.cell(TM, "Tia Mode", D3), book.cell(TM, "Tom Mock", D3)]
    # a switch nobody can read holds too
    def unreadable():
        raise RuntimeError("config lane not read yet")
    er.use_switch(unreadable)
    held3 = cbh.publish_cells(T, TM, [{"employee": "Tom Mock", "col_iso": D1, "value": "2P-10P",
                                       "base": ""}], actor="Hana Boss", via="publish")
    OUT["tm_unreadable"] = [held3.get("test_mode"), book.cell(TM, "Tom Mock", D1)]
    er.use_switch(lambda: HELD)
    # the master grid is not published at all while test mode holds
    OUT["tm_master"] = cbw2.publish(T, "Dan Director")
    # the list the house manager answers
    OUT["tm_held"] = [[h["employee"], h["col_iso"], h["value"], h["base"]]
                      for h in cbh.held_cells(T, TM)]
    OUT["tm_grid_held"] = [len(cbh.draft_grid(T, TM, None).get("held") or []),
                           cbh.draft_grid(T, TM, None)["test_mode"]["on"]]
    OUT["tm_publish_now_on"] = refused(lambda: cbh.publish_held(T, location=TM, actor="Hana Boss"))
    # test mode off: the workbook is the roster again, nothing is replayed
    er.use_switch(lambda: {"on": False, "readable": True, "word": "off", "why": ""})
    sr.forget_estate()
    off_grid = sr.calendar_grid(T, TM, None)
    tia_off = next(r for r in off_grid["rows"] if r["employee"] == "Tia Mode")
    OUT["tm_off_shown"] = [tia_off["cells"][i1].get("text"), bool(tia_off["cells"][i1].get("test_mode")),
                           book.cell(TM, "Tia Mode", D1), len(cbh.held_cells(T, TM))]
    # discard one, publish the rest now
    gone = cbh.discard_held(T, location=TM, actor="Hana Boss",
                            cells=[{"employee": "Tom Mock", "col_iso": D1}])
    OUT["tm_discard"] = [gone["discarded"], book.cell(TM, "Tom Mock", D1),
                         [h["employee"] + "|" + h["col_iso"] for h in cbh.held_cells(T, TM)],
                         [h["via"] for h in cbh.history(T, TM, "Tom Mock", D1)][:1]]
    now = cbh.publish_held(T, location=TM, actor="Hana Boss")
    OUT["tm_publish_now"] = [now.get("test_mode"), now.get("written"), book.cell(TM, "Tia Mode", D1),
                             book.cell(TM, "Tom Mock", D2), book.cell(TM, "OPEN", D2),
                             book.cell(TM, "Tia Mode", D3), book.cell(TM, "Tom Mock", D3),
                             len(cbh.held_cells(T, TM))]
    OUT["tm_empty"] = refused(lambda: cbh.publish_held(T, location=TM, actor="Hana Boss"))
    # a process handed no switch holds: nothing reaches the workbook, the cell is recorded as held
    er.use_switch(None)
    before_none = writes()
    unswitched = cbh.publish_cells(T, TM, [{"employee": "Tom Mock", "col_iso": D1, "value": "6A-2P",
                                            "base": book.cell(TM, "Tom Mock", D1)}],
                                   actor="Hana Boss", via="publish")
    OUT["tm_no_switch"] = [unswitched.get("test_mode"), writes() - before_none,
                           er.test_mode()["on"], er.test_mode()["readable"]]
    cbh.discard_held(T, location=TM, actor="Hana Boss", cells=[{"employee": "Tom Mock", "col_iso": D1}])
    er.use_switch(lambda: OFF)

    # ── no override was written by any of it ───────────────────────────────
    OUT["overrides"] = rows("SELECT count(*) FROM asa_house_calendar_overrides")[0][0]

    # ── and the live workbook is out of reach of a test schema ────────────
    cbh.use_workbook(None)
    OUT["test_guard"] = refused(lambda: cbh.publish_cells(
        T, BM, [{"employee": "Ann Roe", "col_iso": D3, "value": "8A-4P", "base": ""}],
        actor="x", via="x"))
    cbh.use_workbook(book)
except Exception as exc:  # noqa: BLE001
    OUT["crash"] = f"{type(exc).__name__}: {exc}"
    import traceback
    OUT["trace"] = traceback.format_exc()[-3000:]
finally:
    cbh.use_workbook(None)
    OUT["rooms"] = ROOMS.close()
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''

# the checkout's modules shipped into the container
MODULES = ("calendar_builder_houses", "calendar_builder_write", "calendar_builder_slices",
           "house_cal_live", "shift_requests", "shift_handoff", "shift_slices",
           "house_directory", "psi_reminders", "badge_follows",
           # the one rule of which published cells still count, the calendar's too
           "effective_roster",
           # a Builder call-off's road, owed to Apps Script; the mockup's keeper
           "calloff_road", "web_gate",
           # the overlap law's time-off source, and the rule its stand-in house copies by
           "time_off", "redaction", "web_notices")


def _lane_in_container(script_body: str = LANE) -> dict | None:
    # every module the roots reach, and the IST settings reader's declaration, in a folder of this run's own
    sources = lane_schema.with_imports(SERVER, (*MODULES, "ist_config"))
    return lane_schema.run_in(CONTAINER, lane_schema.script(sources, script_body, "calendar-builder-houses"))


print("\nTHE LANE — drafts, publish and the one writer, against a real database")
lane = _lane_in_container()
if lane is None:
    print("  (skipped — no docker here to reach a relay container)")
    print("  NOTE: the pure half above still ran; the lane half did not.")
else:
    if lane.get("crash"):
        check("the lane ran to its end", False, lane.get("trace") or lane["crash"])
    L = lane.get
    owned = (L("owned") or {}).get("lane") or {}
    check("every table the lane reads resolves in its own schema before the first read — the call-off "
          "road included, never public's",
          "asa_calendar_calloff_road" in owned
          and all(str(s).startswith("hub_test_cal_builder_houses_") for s in owned.values()), L("owned"))
    check("an edit is a draft, and says what the cell said", L("draft") == ["allowed", "8A-4P"],
          L("draft"))
    check("the draft carries its base — what the workbook said", L("draft_row") == [["8A-2P", "8A-4P"]],
          L("draft_row"))
    check("the house is recomputed over the draft: Ann's hours drop by two",
          L("draft_hours") == 22.0 and L("draft_marked") is True and L("draft_count") == 1,
          [L("draft_hours"), L("draft_marked"), L("draft_count")])
    check("each person's weeks are totalled across every house, with the draft on",
          isinstance(L("estate_weeks"), dict) and sum((L("estate_weeks") or {}).values()) == 22.0,
          L("estate_weeks"))
    check("typing the workbook's own value back drops the draft",
          L("draft_back") is True and L("draft_gone") == 0, [L("draft_back"), L("draft_gone")])
    check("both edits are the cell's history, newest first, as drafts",
          [h[:3] for h in (L("history") or [])] == [["8A-2P", "8A-4P", "draft"],
                                                   ["8A-4P", "8A-2P", "draft"]], L("history"))
    check("a person nobody admitted is not placed at a house — no row from a typed name",
          (L("no_admit") or [None])[0] == "value", L("no_admit"))
    check("a draft that crosses a published shift at another house is refused",
          (L("clash_published") or [None, None])[1] == "overlap", L("clash_published"))
    check("so is one that crosses another house manager's DRAFT — and it says so",
          (L("clash_draft") or [None, None])[1] == "overlap"
          and "drafted on Calendar Builder" in str(L("clash_draft")), L("clash_draft"))
    check("a person drafted out of one house is free for another in the plan",
          L("plan_frees") == ["allowed", True], L("plan_frees"))
    check("while a decision elsewhere still counts the drafted shift as theirs",
          L("decision_sees_draft") is True)
    check("Discard throws a house's draft away", L("discarded") == 0, L("discarded"))
    check("a drag is a move of the shift, as a draft on both cells",
          L("move") == [True, "8A-4P"]
          and L("move_drafts") == [["Ann Roe", ""], ["Cy Far", "8A-4P"]], [L("move"), L("move_drafts")])
    check("Undo reverts the move whole — both cells", L("undo") == [2, 0], L("undo"))
    check("and there is nothing left of mine to undo after it",
          (L("undo_again") or [None, None])[1] == "nothing_to_undo", L("undo_again"))
    check("a plain drop onto a shift is refused with what is there",
          L("occupied") == ["occupied", "8A-4P"], L("occupied"))
    check("with replace it lands, and says it replaced", L("replace") == ["allowed", True],
          L("replace"))
    check("Shift-drop swaps", L("swap") == ["allowed", True], L("swap"))
    check("every one of those undone leaves no draft", L("after_undos") == 0, L("after_undos"))
    check("an open shift the workbook holds is not typed over",
          (L("type_over_open") or [None])[0] == "open_shift", L("type_over_open"))
    check("nor dragged off its OPEN row", (L("drag_off_open") or [None])[0] == "open_shift",
          L("drag_off_open"))
    check("an empty OPEN cell may take a new open shift", L("empty_open") == ["allowed", True],
          L("empty_open"))
    check("Request Off puts R/O on the day and the shift on the first free OPEN row",
          L("request_off") == ["R/O", "OPEN"]
          and L("request_off_drafts") == [["Ann Roe", "R/O"], ["OPEN", "8A-4P"]],
          [L("request_off"), L("request_off_drafts")])
    check("a person with no IST is told at the draft, and no training is recorded yet",
          L("zoe_ist_said") is True and L("zoe_no_training_yet") == 0,
          [L("zoe_ist_said"), L("zoe_no_training_yet")])
    check("a cell the workbook no longer holds at its base stops the whole publish",
          (L("blocked") or [None, None])[:2] == ["workbook", "blocked"], L("blocked"))
    check("and a refused publish writes nothing and keeps the draft",
          L("blocked_wrote_nothing") is True and L("blocked_kept_drafts") == 2,
          [L("blocked_wrote_nothing"), L("blocked_kept_drafts")])
    check("publish writes the house's tab, adding a row for the new person",
          L("published") == [2, ["Zoe New"], 1] and L("tab_after") == ["2P-10P", "8A-2P"],
          [L("published"), L("tab_after")])
    check("the draft is gone once published", L("drafts_after_publish") == 0)
    check("and a publish closes the draft Undo steps back through",
          (L("undo_after_publish") or [None, None])[1] == "nothing_to_undo", L("undo_after_publish"))
    check("each published cell is written down with what the workbook said, and the note",
          ["Ben Left", "", "2P-10P", "publish", "covering the evening"] in (L("edits_published") or []),
          L("edits_published"))
    check("House Calendars shows the published cells at once, the new row included",
          L("shown_at_once") == ["2P-10P", "8A-2P"], L("shown_at_once"))
    check("and the overlap law's estate sees them at once", L("estate_at_once") == "8A-2P",
          L("estate_at_once"))
    check("publishing a person with no IST takes the training on in the publisher's name",
          L("training_recorded") == [["Zoe New", "approved", "Hana Boss"]], L("training_recorded"))
    check("a house manager's decision gives the shift", L("decided") == [True, "assigned", True],
          L("decided"))
    check("and writes the chosen person's cell into the workbook — one cell, published",
          L("decision_tab") == "8A-4P"
          and (L("decision_edit") or [[None]])[0][:2] == ["Cy Far", "8A-4P"],
          [L("decision_tab"), L("decision_edit")])
    check("a workbook that cannot be written refuses the decision, in words",
          (L("decision_refused") or [None, None])[:2] == ["refused", "workbook"],
          L("decision_refused"))
    check("and the shift is NOT given — no claim, nothing filled",
          L("refused_not_claimed") == 0 and L("refused_not_filled") in ([[""]], [["" ]]),
          [L("refused_not_claimed"), L("refused_not_filled")])
    check("Mark Call-Off opens the blood-red call-off shift in the pool",
          L("call_off") == [True, "call_off", True]
          and L("call_off_pool") == [["call_off", "2P-10P", "Dee Way"]],
          [L("call_off"), L("call_off_pool")])
    check("and never types C/O over the shift in the workbook",
          L("call_off_tab_untouched") == "2P-10P", L("call_off_tab_untouched"))
    check("a shift called off twice is said to be in the pool already",
          (L("call_off_again") or [None, None])[1] == "already_pooled", L("call_off_again"))
    check("a called-off shift is not drafted over — it is given from its red cell",
          (L("call_off_no_draft_over") or [None, None])[1] == "called_off",
          L("call_off_no_draft_over"))
    check("House Calendars draws it on the call-off line", L("call_off_drawn") is True)
    check("THE REASON IS THE DIRECTORS' ALONE: the pool keeps it, the cell's history the house "
          "manager reads does not", L("call_off_history_notes") == [[""], [["sick"]]],
          L("call_off_history_notes"))
    check("…and a history row written before that is cut on the way out, unless the reader reads "
          "reasons", L("call_off_history_cut") == [[""], ["hospital"]], L("call_off_history_cut"))
    check("A SHIFT IS NEVER GIVEN TO A CELL THAT HOLDS ANOTHER ONE: refused, in words",
          (L("row_holds") or [None, None])[:2] == ["refused", "workbook"]
          and "already says 6A-2P" in str((L("row_holds") or ["", "", ""])[2]), L("row_holds"))
    check("…and nothing moved: the caller's cell still holds the shift, no claim was recorded",
          L("row_holds_nothing_moved") == ["2P-10P", "6A-2P", 0], L("row_holds_nothing_moved"))
    check("THE DECISION READS THE ROSTER INSIDE THE PERSON'S GATE: a publish holding that gate lands "
          "first, and the decision sees it — refused as an overlap, never two houses at one hour",
          (L("race") or [None, None])[:2] == ["refused", "overlap"]
          and "7P-11P" in str((L("race") or ["", "", ""])[2]), L("race"))
    check("…and the shift was not given", L("race_not_given") == ["", 0], L("race_not_given"))
    check("A DRAFT ADDED BETWEEN THE GATES AND THE PICTURE stops the publish whole — nothing is "
          "written without its person's gate",
          (L("draft_changed") or [None, None])[:2] == ["refused", "draft_changed"]
          and L("draft_changed_kept") == ["", 1], [L("draft_changed"), L("draft_changed_kept")])
    check("THE MASTER GRID'S PUSH IS NOT A SECOND WRITER: an overlap at another house refuses that "
          "house whole, and nothing is written there",
          (L("push_overlap") or [None, None])[:2] == ["refused", "blocked"]
          and L("push_overlap_wrote_nothing") == ["", None],
          [L("push_overlap"), L("push_overlap_wrote_nothing")])
    check("…an OPEN row holding a published shift is left out and named; the dry run writes nothing",
          L("push_dry") == [0, 1, ["OPEN"], ""], L("push_dry"))
    check("…and the push writes through the one writer, recorded as the master's push",
          L("push_real") == [1, "6P-10P", "8A-4P", [["master_push"]]], L("push_real"))
    check("the cells the house changed on its own are known to the push (a decision), and its own "
          "pushes are not", L("house_own") == ["decision:assigned", False], L("house_own"))
    check("a swap both agreed to writes both cells, the receiver given a row",
          L("swap_done") == ["done", "", "8A-4P"], L("swap_done"))
    # ── A FULL CALL-OFF: the road owed to Apps Script ──────────────────────
    road = L("road") or [[None] * 6]
    days = L("days") or [None, None, None]
    check("MARK CALL-OFF IS A FULL CALL-OFF: the rest of its road is owed to Apps Script in the same act, "
          "keyed on the pool ref",
          L("road_ref") is True and road[0][1:] == ["owed", "sick", "Rita Lead", days[1], "2P-10P"], L("road"))
    check("…and it reaches the door as the form road's own facts: the pool ref as the instance, the shift's "
          "day and hours, the house and its manager, and the reason for the directors' row",
          (L("road_payload") or {}) == {"instance": road[0][0], "date": days[1],
                                        "house": "CAN - JH - ABD2704", "shift": "2P-10P", "reason": "sick",
                                        "marked_by": "Rita Lead", "manager_name": "Rita Lead",
                                        "manager_phone": "+13305550100"}
          and re.fullmatch(r"\d{2}:\d{2}", str(L("road_start") or "")) is not None,
          [L("road_payload"), L("road_start")])
    failed_road = L("road_failed") or [[[None, None, None]], None]
    check("a door that could not be reached leaves the call-off OWED, says why, and waits before it is "
          "offered again",
          failed_road[0][0][:2] == ["owed", 1] and "could not be reached" in str(failed_road[0][0][2])
          and failed_road[1] == 0, L("road_failed"))
    check("a 200 that does not NAME the call-off filed nothing — it stays owed",
          L("road_unnamed") == [["owed"]], L("road_unnamed"))
    check("the door naming it filed is what marks it told, with the door's answer kept",
          (L("road_told") or [None, None])[0] == [["told", "held: test mode"]]
          and (L("road_told") or [None, None])[1] == 0, L("road_told"))

    # ── TEST MODE HOLDS THE WORKBOOK ───────────────────────────────────────
    tm = L("tm_publish") or [None] * 6
    check("TEST MODE HOLDS ROSTER WRITES: a Publish with test mode on records the cells on the platform and "
          "writes NOTHING to the workbook — the draft is gone, the mockup row kept",
          tm == [True, 1, True, "", 0, 0], L("tm_publish"))
    check("…and the platform shows the held cell, marked as test mode, on House Calendars",
          L("tm_shown") == ["8A-2P", True], L("tm_shown"))
    check("…and on every reader of the per-house copy, as the effective roster's test_mode state",
          ["Tia Mode", "8A-2P", "test_mode"] in (L("tm_laid") or []), L("tm_laid"))
    check("…and the mock outbox holds one roster_write row for the act, naming the cell",
          L("tm_mock") == [["roster_write", "roster_write", "held", True, "on"]], L("tm_mock"))
    check("a second publish stacks on what test mode holds — its base is the held value — and still writes "
          "nothing", L("tm_stack") == [True, 1, ""], L("tm_stack"))
    check("A HOUSE MANAGER'S DECISION in test mode: the shift is given on the platform, the cell is held, the "
          "workbook untouched",
          L("tm_decision") == ["Tom Mock", True, "", "8A-4P"], L("tm_decision"))
    check("A SWAP BOTH PEOPLE AGREED TO in test mode is done on the platform and says so, and neither cell "
          "reaches the workbook", L("tm_swap") == ["done", True, "8A-4P", ""], L("tm_swap"))
    check("a switch nobody can read holds the write too",
          L("tm_unreadable") == [True, ""], L("tm_unreadable"))
    check("the master grid is not published at all while test mode holds — its draft is kept",
          (L("tm_master") or {}).get("status") == 409 and (L("tm_master") or {}).get("reason") == "test_mode",
          L("tm_master"))
    check("what test mode held waits in the Builder, per cell, with what the workbook still says",
          sorted(L("tm_held") or []) == sorted([["Tia Mode", days[0], "8A-4P", ""],
                                                ["Tom Mock", days[1], "8A-4P", ""],
                                                ["Tia Mode", days[2], "", "8A-4P"],
                                                ["Tom Mock", days[2], "8A-4P", ""],
                                                ["Tom Mock", days[0], "2P-10P", ""]])
          and L("tm_grid_held") == [5, True], [L("tm_held"), L("tm_grid_held")])
    check("Publish now is refused while test mode is still on",
          (L("tm_publish_now_on") or [None, None])[1] == "test_mode_on", L("tm_publish_now_on"))
    check("with test mode off the held cells are no longer laid — the workbook is the roster again — and "
          "nothing is replayed: they still wait",
          L("tm_off_shown") == ["", False, "", 5], L("tm_off_shown"))
    check("Discard drops one held cell, never reaching the workbook, and its history says so",
          (L("tm_discard") or [None] * 4)[0] == 1 and (L("tm_discard") or [None] * 4)[1] == ""
          and len((L("tm_discard") or [None, None, []])[2]) == 4
          and (L("tm_discard") or [None] * 4)[3] == ["test_mode_discard"], L("tm_discard"))
    check("PUBLISH NOW writes the rest through the one writer — the stacked value, the decision's cell, both "
          "halves of the swap — and nothing is left waiting",
          L("tm_publish_now") == [False, 4, "8A-4P", "8A-4P", "8A-4P", "", "8A-4P", 0], L("tm_publish_now"))
    check("…and a second Publish now finds nothing waiting",
          (L("tm_empty") or [None, None])[1] == "empty", L("tm_empty"))
    check("a process that was handed no switch holds the write: nothing reaches the workbook",
          L("tm_no_switch") == [True, 0, True, False], L("tm_no_switch"))

    check("none of it wrote an override", L("overrides") == 0, L("overrides"))
    check("a test schema is refused the live workbook when no stand-in is handed in",
          (L("test_guard") or [None, None])[:2] == ["workbook", "test_database"], L("test_guard"))


print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
