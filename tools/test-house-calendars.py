#!/usr/bin/env python3
"""
House Calendars: the gate, the house manager rows, OPEN row keys, the drag/drop safety laws, Ohio's today.
Pure half on the host; lane half in the relay container, in its own schema (skipped, and said, without it).

    python3 tools/test-house-calendars.py
"""
import json
import os
import subprocess
import sys
import types
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
SERVER = HERE.parent.parent / "server"
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
import lane_schema  # noqa: E402 — beside this file
import badge_follows  # noqa: E402
import house_cal_live as hcl  # noqa: E402
import shift_requests as sr  # noqa: E402

OHIO = hcl.OHIO
BM = "CAN - BM - BM4060"
H38 = "CAN - 38TH - ABD2005"
MK = "CAN - MK - MK11787"


def grid(rows, isos):
    return {"cols": [{"iso": i} for i in isos],
            "rows": [{"employee": e, "cells": [{"text": t} for t in cs]} for e, cs in rows]}


print("\nTHE KEYS — two rows named OPEN are two shifts")

g = hcl.key_rows(grid([("OPEN", ["8A-2P", ""]), ("Ann Roe", ["", ""]),
                       ("OPEN", ["", "8A-230P"])], ["2026-09-28", "2026-09-30"]))
names = [r["employee"] for r in g["rows"]]
check("the first row keeps its name and the second is named OPEN 2",
      names == ["OPEN", "Ann Roe", "OPEN 2"], names)
check("the workbook's own spelling rides along on the renamed row",
      g["rows"][2].get("sheet_name") == "OPEN" and "sheet_name" not in g["rows"][0], g["rows"][2])
check("keying twice is keying once",
      [r["employee"] for r in hcl.key_rows(g)["rows"]] == names)
taken = hcl.key_rows(grid([("OPEN", [""]), ("OPEN 2", [""]), ("OPEN", [""])], ["2026-09-28"]))
check("a name the sheet already uses is skipped — the third is OPEN 3, never a second OPEN 2",
      [r["employee"] for r in taken["rows"]] == ["OPEN", "OPEN 2", "OPEN 3"],
      [r["employee"] for r in taken["rows"]])
twice = hcl.key_rows(grid([("Ann Roe", [""]), ("Ann Roe", [""])], ["2026-09-28"]))
check("people are left as written — a number stuck to a name is somebody else",
      [r["employee"] for r in twice["rows"]] == ["Ann Roe", "Ann Roe"])
check("_as_dict keys every grid it decodes, so every reader sees the same names",
      [r["employee"] for r in hcl._as_dict(json.dumps(grid(
          [("OPEN", [""]), ("OPEN", [""])], ["2026-09-28"])))["rows"]] == ["OPEN", "OPEN 2"])

check("OPEN, OPEN 2 and 'Open (B)' are open rows",
      hcl.is_open_row("OPEN") and hcl.is_open_row("OPEN 2") and hcl.is_open_row("Open (B)"))
check("a person whose name begins with those letters is a person",
      not hcl.is_open_row("Openshaw Smith") and not hcl.is_open_row("") and not hcl.is_open_row(None))
check("nobody is paid for OPEN 2's hours — not a person, like OPEN and WORKSHOP",
      hcl.not_a_person("OPEN 2", BM) and hcl.not_a_person("WORKSHOP", BM)
      and not hcl.not_a_person("Ann Roe", BM))

bm = hcl._as_dict(grid([("OPEN", ["8A-2P", "", ""]), ("OPEN", ["", "8A-230P", ""]),
                        ("Ann Roe", ["8A-4P", "", ""])],
                       ["2026-09-28", "2026-09-30", "2026-10-02"]))
bm["location"] = BM
comp = hcl.compute(bm, now=datetime(2026, 9, 22, 12, 0, tzinfo=OHIO))
keys = [s["key"] for s in comp["open_shifts"]]
check("every open shift is its own key — both BM rows are offered, neither twice",
      keys == ["OPEN|2026-09-28", "OPEN 2|2026-09-30"], keys)
check("no empty cell of one OPEN row is an open shift because the other row has one",
      "OPEN|2026-09-30" not in comp["cells"] and "OPEN 2|2026-09-28" not in comp["cells"],
      sorted(comp["cells"]))
check("OPEN 2 is not counted as a member of staff",
      [p["employee"] for p in comp["people"]] == ["Ann Roe"], comp["people"])
check("an open shift tomorrow has not started, and says when it will",
      comp["open_shifts"][0]["started"] is False
      and comp["open_shifts"][0]["starts_at"].startswith("2026-09-28T08:00:00"),
      comp["open_shifts"][0])
late = hcl.compute(bm, now=datetime(2026, 9, 28, 8, 1, tzinfo=OHIO))
check("a minute after it begins, the relay says it has started",
      late["open_shifts"][0]["started"] is True, late["open_shifts"][0])


print("\nTODAY — Ohio's, not UTC's")

night = datetime(2026, 9, 22, 21, 30, tzinfo=OHIO)
check("at 21:30 in Ohio the UTC date is already tomorrow — which is the trap",
      night.astimezone(timezone.utc).date() == date(2026, 9, 23))
w = hcl.window_of(["2026-09-16", "2026-09-22"], today=night.date())
check("a tab whose last day is today still covers today at 21:30",
      w["covers_today"] is True and w["today"] == "2026-09-22", w)
cw = hcl.compute(hcl._as_dict(grid([("Ann Roe", ["8A-4P", "8A-4P"])],
                                   ["2026-09-21", "2026-09-22"])), now=night)["window"]
check("compute names Ohio's today for the screen to tint",
      cw["today"] == "2026-09-22" and cw["covers_today"] is True, cw)
src_hcl = (SERVER / "house_cal_live.py").read_text(encoding="utf-8")
check("house_cal_live no longer asks the UTC date anything",
      "datetime.now(timezone.utc)" not in src_hcl and "timezone.utc).date()" not in src_hcl)


print("\nTHE HM — the most recent ** row, never the first")

TODAY = date(2026, 9, 22)


def star(loc, name, day, phone=""):
    return {"Location": loc, "Employee": name, "Designation": "**",
            "Date": day.strftime("%m/%d/%Y"), "Phone": phone}


rows = []
rows += [star(H38, "Unique Jamison", date(2026, 2, d), "111") for d in (1, 2, 3)]
rows += [star(H38, "Ashley Davenport", date(2026, 2, 16) + timedelta(days=7 * k), "222")
         for k in range(36)]
NW = "CAN - NW - NW4045"
for k in range(-10, 10):
    day = TODAY + timedelta(days=k)
    rows.append(star(NW, "Wanda McCollum-Dotson", day))
    if k % 2:
        rows.append(star(NW, "Jordyn Walker", day))
J47 = "CAN - 47TH - ABD4708"
rows += [star(J47, "Brianna Newman", date(2024, 12, 1)), star(J47, "Kamari Kidd", date(2026, 8, 28))]
JH = "CAN - JH - ABD2704"
rows += [star(JH, "Regina Bowman", date(2026, 8, 20)), star(JH, "Shaquita Fite", date(2026, 8, 25)),
         star(JH, "Regina Bowman", date(2026, 9, 9))]
FUT = "CAN - HF - HF0001"
rows += [star(FUT, "Late Starter", date(2027, 4, 2)), star(FUT, "Later Still", date(2027, 5, 2))]
by = sr.managers_from_rows(rows, today=TODAY)
check("38TH: the manager on the first ** row, gone for months, is NOT the house manager",
      by["ABD2005"]["name"] == "Ashley Davenport" and by["ABD2005"]["names"] == ["Ashley Davenport"],
      by["ABD2005"])
check("and the phone is the current manager's, not the first row's",
      by["ABD2005"]["phone"] == "222", by["ABD2005"])
check("NW is run by two people at once, and both manage it",
      set(by["NW4045"]["names"]) == {"Wanda McCollum-Dotson", "Jordyn Walker"}, by["NW4045"])
check("the one on the latest row up to today is named first",
      by["NW4045"]["name"] == "Wanda McCollum-Dotson", by["NW4045"])
check("47TH: two years of history, and the most recent is the manager",
      by["ABD4708"]["names"] == ["Kamari Kidd"], by["ABD4708"])
check("JH: a fill-in weeks ago does not stay a manager",
      by["ABD2704"]["names"] == ["Regina Bowman"], by["ABD2704"])
check("a house whose ** rows all lie ahead is managed by the first of them",
      by["HF0001"]["name"] == "Late Starter", by["HF0001"])
check("MK has no ** row, so it has no house manager at all — never a guess",
      "MK11787" not in by)
check("the sheet's date is read as the sheet writes it, and a blank is no date",
      sr._row_day("02/16/2026") == date(2026, 2, 16) and sr._row_day("2026-02-16") == date(2026, 2, 16)
      and sr._row_day("") is None and sr._row_day("soon") is None)


print("\nTHE GATE — one law, per house")

sr.houses_managed = lambda dsn, name: ["ABD2005"] if sr.fold(name) == sr.fold("Ashley Davenport") else []
V = lambda **k: sr.viewer("dsn", **k)  # noqa: E731
hm = V(name="Ashley Davenport", role="staff", types="STAFF")
caregiver = V(name="Ann Roe", role="staff", types="STAFF")
# the badge that follows DIRECTOR, read from the follow table, never spelled here
FOLLOWER = next((w for w, stands in badge_follows.BADGE_FOLLOWS.items() if stands == "DIRECTOR"), "")
lead = V(name="Tee Lead", role="staff", types=f"STAFF,{FOLLOWER}")
director = V(name="Dee Rector", role="staff", types="DIRECTOR")
admin_role = V(name="Ad Min", role="admin", types="")
tester = V(name="Jhonatan House Manager", role="manager", types="")
hm_badge_only = V(name="Tieara Kennemore", role="staff", types="STAFF,HM")
client = V(name="Carl Client", role="client", types="CLIENT,STAFF")
guardian = V(name="Gia Guardian", role="guardian", types="GUARDIAN")
onboarding = V(name="Olly New", role="onboarding", types="ONBOARDING")

check("a caregiver may LOOK", sr.may_view_calendars(caregiver))
check("a client may not, whatever badge the row carries", not sr.may_view_calendars(client))
check("nor a guardian", not sr.may_view_calendars(guardian))
check("nor somebody still onboarding, who is not staff yet", not sr.may_view_calendars(onboarding))
check("a caregiver may not EDIT any house", not sr.may_edit_calendar(caregiver, H38))
check("the house manager edits THEIR house", sr.may_edit_calendar(hm, H38))
check("and not another house", not sr.may_edit_calendar(hm, BM))
if FOLLOWER:
    check("a badge that follows the director reaches what a director reaches — every house (badge_follows)",
          "DIRECTOR" in lead["badges"] and sr.may_edit_calendar(lead, BM)
          and sr.may_edit_calendar(lead, MK))
else:
    print("  (no badge follows the director any more — the follower case has nobody to test)")
check("a director edits every house", sr.may_edit_calendar(director, MK))
check("the admin role folds in as ADMIN and edits every house", sr.may_edit_calendar(admin_role, MK))
check("the role=manager test account keeps editing — the one named exception",
      sr.may_edit_calendar(tester, MK) and "manager" in sr.CALENDAR_EDIT_ROLES)
check("but that exception decides nothing on Requests: may_decide is still the house question",
      not sr.may_decide(tester, MK))
check("an HM badge without the ** row LOOKS but does not edit",
      sr.may_view_calendars(hm_badge_only) and not sr.may_edit_calendar(hm_badge_only, MK))
check("a client edits nothing, even where a badge would have let them",
      not sr.may_edit_calendar(client, MK))

MG = {"readable": True, "why": "", "by_code": {"ABD2005": {"name": "Ashley Davenport",
                                                           "names": ["Ashley Davenport"]}}}
a = sr.calendar_access(caregiver, H38, MG)
check("the grid tells a caregiver it is read-only, and who does edit",
      a["view"] and not a["edit"] and "Ashley Davenport" in a["why"] and "Read-only" in a["why"], a)
check("and names the house manager on the header",
      a["house_manager"]["names"] == ["Ashley Davenport"], a["house_manager"])
a = sr.calendar_access(hm, H38, MG)
check("the house manager is told the calendar is theirs", a["edit"] and "You manage" in a["why"], a)
mk = sr.calendar_access(caregiver, MK, MG)
check("MK: no house manager, and the screen says so in words — only the badges above edit",
      mk["house_manager"]["names"] == [] and "names no house manager" in mk["house_manager"]["why"]
      and sr.deciders_all() in mk["house_manager"]["why"], mk)
blind = sr.calendar_access(hm, H38, {"readable": False, "why": "mirror down", "by_code": {}})
check("a manager list that could not be read is NOT an empty one — it says so, and fails closed",
      blind["house_manager"]["readable"] is False and "could not be read" in blind["house_manager"]["why"]
      and "mirror down" in blind["house_manager"]["why"], blind)
check("and nobody's edit right is inferred from a list nobody could read",
      not sr.may_edit_calendar({**hm, "manages": [], "decides": []}, H38))
check("a client is told the screen is not theirs",
      sr.calendar_access(client, H38, MG)["view"] is False)

VIEW = {"people": {BM: ["OPEN", "OPEN 2", "Ann Roe"], H38: ["Ben Left"]}}
check("a name drawn on a grid is on a grid", sr.on_a_grid(VIEW, "ann  roe"))
check("an OPEN row is nobody, and a display name on no grid is refused",
      not sr.on_a_grid(VIEW, "OPEN 2") and not sr.on_a_grid(VIEW, "Carl Client"))


print("\nTHE DOORS — every one asks the one law, none asks the role word")

door = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")


def body_of(text: str, name: str) -> str:
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.startswith(f"def {name}(") or line.startswith(f"async def {name}("):
            out = [line]
            for nxt in lines[i + 1:]:
                if nxt and not nxt[0].isspace() and not nxt.startswith(")"):
                    break
                out.append(nxt)
            return "\n".join(out)
    return ""


DOORS = ("lane_housecal_list", "lane_housecal_open", "lane_housecal_claim",
         "lane_housecal_claim_release", "lane_housecal_grid", "lane_housecal_cell",
         "lane_housecal_move")
for name in DOORS:
    text = body_of(door, name)
    check(f"{name}: asks the calendar's one law, not the session's role",
          "_housecal_viewer(authorization)" in text
          and 'actor[0] not in ("admin", "manager")' not in text
          and 'actor[0] in ("admin", "manager")' not in text, text[:160])
for name in ("lane_housecal_claim", "lane_housecal_claim_release"):
    check(f"{name}: acts only where may_edit_calendar says so",
          "may_edit_calendar(who, location)" in body_of(door, name))
for name in ("lane_housecal_cell", "lane_housecal_move"):
    check(f"{name}: the door is closed — it says the calendar is edited in Calendar Builder",
          "_housecal_edits_moved(" in body_of(door, name)
          and "house_cal_live." not in body_of(door, name))
check("the claim door names its own road — the body cannot stamp a claim 'by sms'",
      'via="app"' in body_of(door, "lane_housecal_claim")
      and 'body.get("via")' not in body_of(door, "lane_housecal_claim"))
check("nor can the apply door's body",
      'body.get("via")' not in body_of(door, "lane_shift_requests_apply"))
builder = (SERVER / "calendar_builder_houses.py").read_text(encoding="utf-8")
check("the Builder's drag checks and drafts under the people's locks — one act",
      "person_gate" in body_of(builder, "stage_move")
      and "check_move" in body_of(builder, "stage_move"))
check("a move that can never land is refused before the overlap law is asked",
      body_of(builder, "stage_move").index("check_move(")
      < body_of(builder, "stage_move").index("_overlap(dsn, dst_employee"))
check("and so is a typed cell that can never land",
      body_of(builder, "stage_cell").index("check_cell(")
      < body_of(builder, "stage_cell").index("_overlap(dsn, employee"))
check("an occupied drop comes back as a question the screen can ask (409 occupied)",
      '"reason": "occupied"' in body_of(door, "_builder_refusal"))
# one picture (_housecal_grid_for) for the grid door and every write door
check("the grid says per house whether this reader edits, and who manages it",
      'grid["access"]' in body_of(door, "_housecal_grid_for")
      and 'grid["house_manager"]' in body_of(door, "_housecal_grid_for")
      and "_housecal_grid_for(who, location)" in body_of(door, "lane_housecal_grid")
      and "_housecal_grid_for(who, location)" in body_of(door, "_housecal_after"))
check("the list says it for every house",
      '"may_edit": access["edit"]' in body_of(door, "lane_housecal_list"))


print("\nTHE ONE SCREEN'S READS — test mode, how a cell got there, the draft pills")

import calendar_builder_houses as cbh_pure  # noqa: E402
import effective_roster as er  # noqa: E402

check("the live grid and the master grid say whether test mode holds roster writes, from the one switch",
      'grid["test_mode"] = effective_roster.test_mode_said()' in body_of(door, "_housecal_grid_for")
      and '"test_mode": effective_roster.test_mode_said()' in body_of(door, "lane_cal_builder_grid"))

_switch_before = er._SWITCH.get("fn")
er.use_switch(lambda: {"on": False, "readable": True, "word": "off"})
said_off = er.test_mode_said()
er.use_switch(lambda: {"on": True, "readable": True, "word": "on"})
said_on = er.test_mode_said()
er.use_switch(lambda: (_ for _ in ()).throw(OSError("config copy stale")))
said_unread = er.test_mode_said()
er.use_switch(None)
said_none = er.test_mode_said()
er.use_switch(_switch_before)
check("the switch as a screen is told it: off, on, and an unreadable switch that holds",
      said_off == {"on": False, "readable": True, "why": ""}
      and said_on == {"on": True, "readable": True, "why": ""}
      and said_unread["on"] is True and said_unread["readable"] is False and "OSError" in said_unread["why"]
      and said_none["on"] is True and said_none["readable"] is False,
      [said_off, said_on, said_unread, said_none])

rail = body_of(door, "lane_housecal_list")
check("the rail counts drafts only for a reader who builds a house, logs a failed count, and says it unread",
      'if any(h["may_edit"] for h in houses)' in rail
      and "calendar_builder_houses.draft_counts, PG_DSN" in rail
      and "log.warning(" in rail
      and "calendar_builder_houses.lay_draft_pills(houses, drafts)" in rail
      and '"drafts_readable": drafts is not None' in rail)
pills = [{"location": BM, "may_edit": True}, {"location": H38, "may_edit": False}, {"location": MK, "may_edit": True}]
cbh_pure.lay_draft_pills(pills, {BM: 3})
unread = [{"location": BM, "may_edit": True}]
cbh_pure.lay_draft_pills(unread, None)
check("a count lands only on a house the reader builds (0 when it has none); an unread count lays none",
      pills[0].get("drafts") == 3 and "drafts" not in pills[1] and pills[2].get("drafts") == 0
      and "drafts" not in unread[0], [pills, unread])
check("the Builder's own houses door counts through the same reader",
      "calendar_builder_houses.draft_counts_in(cur)" in body_of(door, "lane_cal_builder_houses")
      and "GROUP BY location" not in body_of(door, "lane_cal_builder_houses"))


class _CountCur:
    def __init__(self, exists, rows):
        self.exists, self.rows, self.sql = exists, rows, []

    def execute(self, sql, args=None):
        self.sql.append(sql)

    def fetchone(self):
        return (self.exists,)

    def fetchall(self):
        return self.rows


never = _CountCur(False, [])
check("a database that never drafted counts nothing, and creates nothing",
      cbh_pure.draft_counts_in(never) == {} and len(never.sql) == 1
      and "CREATE" not in " ".join(never.sql).upper())
check("one that did counts per house",
      cbh_pure.draft_counts_in(_CountCur(True, [(BM, 3), (H38, 1)])) == {BM: 3, H38: 1})


class _DictCountCur(_CountCur):
    def fetchone(self):
        return {"present": self.exists}


check("…on a dict cursor too, as the Builder's houses door reads it",
      cbh_pure.draft_counts_in(_DictCountCur(True, [{"location": BM, "n": 2}])) == {BM: 2})

D0 = "2026-09-24"
check("a transfer waiting on this person's shift that day stops a call-off; another's, or none, does not",
      cbh_pure.transfer_waiting(_DictCountCur(True, [{"from_staff": "ann  roe"}]), BM, "Ann Roe", D0)
      and not cbh_pure.transfer_waiting(_DictCountCur(True, [{"from_staff": "Ben Left"}]), BM, "Ann Roe", D0)
      and not cbh_pure.transfer_waiting(_DictCountCur(False, []), BM, "Ann Roe", D0))
mco = body_of((SERVER / "calendar_builder_houses.py").read_text(encoding="utf-8"), "mark_call_off")
check("Mark call-off refuses a shift with a transfer waiting, beside the draft it already refused",
      'transfer_waiting(cur, location, employee, col_iso)' in mco and '"transfer_pending"' in mco
      and mco.find('"draft_pending"') < mco.find('"transfer_pending"') < mco.find("INSERT INTO asa_shift_pool"))


def _refused_before_db(employee, location):
    try:
        cbh_pure.mark_call_off("postgresql://nowhere", location=location, employee=employee,
                               col_iso=D0, actor="Tester")
    except ValueError as exc:
        return str(exc)
    except Exception as exc:  # noqa: BLE001 — reached the database: not refused first
        return f"reached {type(exc).__name__}"
    return "not refused"


check("a WORKSHOP row is nobody: no call-off, no Call Off Tracker row, no URGENT, refused before any read",
      "WORKSHOP row has nobody" in _refused_before_db("WORKSHOP (JH)", BM)
      and "nobody on it" in _refused_before_db("Ann Roe", "CAN - WORKSHOP - W1")
      and "open row has nobody" in _refused_before_db("OPEN 2", BM),
      [_refused_before_db("WORKSHOP (JH)", BM), _refused_before_db("Ann Roe", "CAN - WORKSHOP - W1")])

M1, M2 = "2026-09-26", "2026-09-27"
AT = datetime(2026, 9, 23, 15, 0, tzinfo=timezone.utc)


def pub(emp, iso, value, **k):
    return {"id": 1, "location": BM, "employee": emp, "col_iso": iso, "value": value, "at": AT,
            "actor": "Hana Boss", "via": k.get("via", "publish"),
            "pending": k.get("pending", False), "test_mode": k.get("test_mode", False)}


mg = {"cols": [{"iso": M1}, {"iso": M2}], "rows": [
    {"employee": "Ann Roe", "cells": [{"text": "8A-4P"}, {"text": "8A-2P"}]},
    {"employee": "Ben Left", "cells": [{"text": "2P-10P", "draft": {"base": ""}}, {"text": ""}]},
    {"employee": "Cy Far", "cells": [{"text": "7A-3P"}, {"text": ""}]},
    {"employee": "OPEN · call-off", "call_off_row": True, "cells": [{"text": "7A-3P"}, {"text": ""}]},
]}
laid = er.lay_marks(mg, [M1, M2], [
    pub("Ann Roe", M1, "8A-4P"),
    pub("Ann Roe", M2, "8A-4P", via="decision:approved"),
    pub("Ben Left", M1, "2P-10P"),
    pub("Ben Left", M2, "", pending=True),
    pub("Cy Far", M1, "7A-3P", pending=True, test_mode=True),
    pub("Dee Way", M1, "8A-4P"),
    pub("OPEN · call-off", M1, "7A-3P"),
    pub("Ann Roe", "2031-01-01", "8A-4P"),
])


def mark_state(r, i):
    return (mg["rows"][r]["cells"][i].get("published") or {}).get("state")


check("a published cell the grid still draws is confirmed; one the workbook changed since says so",
      mark_state(0, 0) == "confirmed" and mark_state(0, 1) == "changed",
      [mark_state(0, 0), mark_state(0, 1)])
check("the mark is effective_roster's own shape: when, by whom, which road",
      mg["rows"][0]["cells"][0]["published"] == {"at": "2026-09-23T15:00:00Z", "by": "Hana Boss",
                                                 "via": "publish", "state": "confirmed",
                                                 "location": BM},
      mg["rows"][0]["cells"][0].get("published"))
check("pending while the copy catches up, and test mode above everything",
      mark_state(1, 1) == "pending" and mark_state(2, 0) == "test_mode",
      [mark_state(1, 1), mark_state(2, 0)])
check("a draft, the call-off line, a person with no row and an undrawn day carry no mark",
      "published" not in mg["rows"][1]["cells"][0] and "published" not in mg["rows"][3]["cells"][0]
      and laid == 4, laid)
blanked = {"text": "C/O", "color": "#ffffff", "published": {"by": "x"}}
sr._blank(blanked)
check("a cell cut for a reader who may not know loses its mark with its text",
      "published" not in blanked and blanked["text"] == "", blanked)
cg = body_of((SERVER / "shift_requests.py").read_text(encoding="utf-8"), "calendar_grid")
check("the live grid lays the marks before the call-off cut, and says when they could not be read",
      "_published_here(dsn, location, isos)" in cg
      and 0 <= cg.find("lay_marks(") < cg.find("overlay_call_offs(")
      and 'grid["published_why"] = marks_why["why"]' in cg)
ph = body_of((SERVER / "shift_requests.py").read_text(encoding="utf-8"), "_published_here")
check("the marks are read over the days the tab draws only, never the house's whole history",
      "effective_roster.published(cur, first, last, location=location)" in ph
      and sr.tab_days(["2026-09-26", "2026-09-19", "7", "2026-10-02"]) == (date(2026, 9, 19), date(2026, 10, 2))
      and sr.tab_days(["0", "1"]) == (None, None)
      and sr._published_here("postgresql://nowhere", BM, ["0"]) == ([], ""))


# the lane — against a real database, in a schema of its own

LANE = '''
import json, os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
sys.path.insert(0, LANE_DIR)
import psycopg2, psycopg2.extras
import lane_schema
import house_cal_live as hcl, shift_handoff
import shift_requests as sr
import calendar_builder_houses as cbh
import time_off
# no Time Off house: the verdict never reads the live one
time_off.use_house(time_off.NoHouse())
# …so a swap's directors are stood in; the list itself is held by test-shift-transfer
shift_handoff.directors_for = lambda dsn: {"readable": True, "names": ["Dee Direct"],
                                           "why": "the director Dee Direct approves"}

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
ROOMS = lane_schema.Rooms(DSN, "house-calendars")
SCHEMA = ROOMS.name()
OUT = {}
BM = "CAN - BM - BM4060"
JH = "CAN - JH - ABD2704"
today = datetime.now(sr.OHIO).date()
PAST = (today - timedelta(days=1)).isoformat()
D1 = (today + timedelta(days=1)).isoformat()
D2 = (today + timedelta(days=2)).isoformat()
ISOS = [PAST, D1, D2]
# the IST settings as a read that landed, holding the shipped values
import ist_config
ist_config.pin(dict(ist_config.SHIPPED))
EVERY = {"done": 1, "owed": 0, "clients": [], "owed_for": []}
NAMES = ("Ann Roe", "Ben Left", "Cy Far", "Dee Way")
sr.ist_index = lambda dsn, **k: {
    "readable": True, "why": "", "rows": 0, "source": "test",
    "by_person": {sr.fold(n): {"BM4060": dict(EVERY), "ABD2704": dict(EVERY)} for n in NAMES}}


def grid(rows):
    return {"cols": [{"iso": i} for i in ISOS],
            "rows": [{"employee": e, "cells": [{"text": t} for t in cs]} for e, cs in rows]}


ROOMS.make()
T = ROOMS.path(SCHEMA)


def drafts(loc):
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT employee, col_iso, value FROM asa_cal_builder_house_draft "
                    "WHERE location=%s ORDER BY employee, col_iso", (loc,))
        return [list(r) for r in cur.fetchall()]


def edits(loc):
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT employee, col_iso, old_value, new_value, via FROM "
                    "asa_house_calendar_edits WHERE location=%s ORDER BY id", (loc,))
        return [list(r) for r in cur.fetchall()]


def refused(fn):
    try:
        return ["allowed", fn()]
    except hcl.Occupied as exc:
        return ["occupied", exc.value]
    except hcl.OpenShiftCell as exc:
        return ["open_shift", str(exc)]
    except sr.Refused as exc:
        return ["refused", exc.code]
    except ValueError as exc:
        return ["value", str(exc)]
    except LookupError as exc:
        return ["lookup", str(exc)]


def stage(loc, emp, iso, val, **k):
    return cbh.stage_cell(T, location=loc, employee=emp, col_iso=iso, value=val,
                          actor="Tester", **k)


def move(src, siso, dst, diso, **k):
    return cbh.stage_move(T, location=BM, src_employee=src, src_iso=siso, dst_employee=dst,
                          dst_iso=diso, actor="Tester", **k)


try:
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("CREATE TABLE asa_house_calendar_live (location TEXT PRIMARY KEY, "
                    "grid JSONB, updated_at TIMESTAMPTZ DEFAULT now())")
        cur.execute(hcl.CLAIMS_DDL)
        # NO edits table, NO draft table: the first writers create them, two at once.
        cur.execute(shift_handoff.HANDOFFS_DDL)
        cur.execute(shift_handoff.OPEN_INDEX_DDL)
        for stmt in sr.DDL:
            cur.execute(stmt)
        # BM as it is on the live tab: TWO rows named exactly OPEN.
        grids = {BM: grid([("OPEN", ["8A-4P", "8A-2P", ""]),
                           ("OPEN", ["", "", "8A-230P"]),
                           ("Ann Roe", ["8A-4P", "8A-4P", ""]),
                           ("Ben Left", ["", "2P-10P", ""]),
                           ("Cy Far", ["", "", ""])]),
                 JH: grid([("Dee Way", ["8A-4P", "", ""])])}
        for loc, g in grids.items():
            cur.execute("INSERT INTO asa_house_calendar_live (location, grid) VALUES (%s,%s)",
                        (loc, psycopg2.extras.Json(g)))
        c.commit()
    # every other table the code reads is the lane's before its first read; these two are left
    # to the first writers, and held to the lane once they have made them
    FIRST_WRITERS_MAKE = ("asa_house_calendar_edits", "asa_cal_builder_house_draft")
    OUT["owned"] = lane_schema.own_shift_lane(T, SCHEMA, LANE_DIR, skip=FIRST_WRITERS_MAKE,
                                              later=FIRST_WRITERS_MAKE)
    cbh.use_workbook(cbh.MemoryWorkbook.from_grids(grids))
    sr.forget_estate()

    # two first drafts at once must not race the table creation
    def write(args):
        loc, emp, iso, val = args
        try:
            stage(loc, emp, iso, val)
            return "ok"
        except Exception as exc:
            return type(exc).__name__
    with ThreadPoolExecutor(max_workers=2) as pool:
        OUT["first_writes"] = list(pool.map(write, [(BM, "Cy Far", D1, "8A-4P"),
                                                    (JH, "Dee Way", D1, "8A-4P")]))
    OUT["first_edits"] = len(edits(BM)) + len(edits(JH))
    OUT["first_writers_made"] = lane_schema.assert_owned(T, SCHEMA, FIRST_WRITERS_MAKE)
    cbh.discard(T, location=BM, actor="Tester")
    cbh.discard(T, location=JH, actor="Tester")

    g = hcl.merged_grid(T, BM)
    OUT["rows"] = [[r["employee"], bool(r.get("open_row"))] for r in g["rows"]]
    OUT["open_keys"] = [s["key"] for s in g["computed"]["open_shifts"]]
    OUT["expect_keys"] = [f"OPEN|{PAST}", f"OPEN|{D1}", f"OPEN 2|{D2}"]
    OUT["expect_started"] = {f"OPEN|{PAST}": True, f"OPEN|{D1}": False, f"OPEN 2|{D2}": False}
    OUT["open_started"] = {s["key"]: s["started"] for s in g["computed"]["open_shifts"]}
    OUT["estate_open_2_person"] = sr.fold("OPEN 2") in sr.estate(T, fresh=True)["spans"]

    # the second OPEN row is claimable — it used to be "no longer on the calendar"
    OUT["claim_second_row"] = refused(lambda: hcl.claim_open_shift(
        T, BM, "OPEN 2", D2, "Cy Far", via="assigned")["claimed_by"])
    OUT["claim_first_row_empty_day"] = refused(lambda: hcl.claim_open_shift(
        T, BM, "OPEN", D2, "Cy Far"))

    # the sweep keys the pool the same way — two shifts, two rows
    sr.forget_estate()
    sr.sweep(T)
    OUT["pool_rows"] = sorted([p["open_row"], p["col_iso"]] for p in sr.pool(T)
                              if p["location"] == BM)

    # ── the typed cell, as a Builder draft ────────────────────────────────
    OUT["type_over_open"] = refused(lambda: stage(BM, "OPEN", D1, ""))
    OUT["type_empty_open"] = refused(lambda: stage(BM, "OPEN 2", D1, "8P-8A")["changed"])
    cbh.undo(T, location=BM, actor="Tester")
    OUT["undrawn_day"] = refused(lambda: stage(BM, "Ann Roe", "2031-01-01", "8A-4P"))
    OUT["not_a_row"] = refused(lambda: stage(BM, "Nobody Here", D1, "8A-4P",
                                             admits=lambda name: False))
    before = len(edits(BM))
    stage(BM, "Ann Roe", D1, "8A-2P")
    OUT["after_edit"] = [d for d in drafts(BM) if d[0] == "Ann Roe"]
    stage(BM, "Ann Roe", D1, "8A-4P")
    OUT["after_edit_back"] = [d for d in drafts(BM) if d[0] == "Ann Roe"]
    OUT["edits_written"] = edits(BM)[before:]

    # ── the drag, as a Builder draft ──────────────────────────────────────
    OUT["plain_onto_occupied"] = refused(lambda: move("Ben Left", D1, "Ann Roe", D1))
    OUT["after_refusal"] = drafts(BM)
    OUT["onto_open"] = refused(lambda: move("Ben Left", D1, "OPEN 2", PAST))
    OUT["off_open"] = refused(lambda: move("OPEN", D1, "Cy Far", D1))
    OUT["empty_source"] = refused(lambda: move("Cy Far", D1, "Ann Roe", D2))
    before = len(edits(BM))
    rep = move("Ben Left", D1, "Ann Roe", D1, replace=True)
    OUT["replace"] = [rep["replaced"], rep["displaced"]]
    OUT["replace_recorded"] = edits(BM)[before:]
    cbh.undo(T, location=BM, actor="Tester")
    OUT["restored"] = drafts(BM)
    # a move and a move back leave nothing behind
    move("Ben Left", D1, "Cy Far", D1)
    move("Cy Far", D1, "Ben Left", D1)
    OUT["move_and_back"] = drafts(BM)
    sw = move("Ben Left", D1, "Ann Roe", D1, swap=True)
    OUT["swap"] = [sw["swap"], sw["replaced"], [d for d in drafts(BM) if d[1] == D1]]
    cbh.discard(T, location=BM, actor="Tester")

    # ── the claim door ────────────────────────────────────────────────────
    sr.forget_estate()
    OUT["claim_started"] = refused(lambda: sr.take_open_shift(
        T, location=BM, open_row="OPEN", col_iso=PAST, person="Cy Far", by="Tester",
        may_decide=True))
    OUT["claim_no_grid"] = refused(lambda: sr.take_open_shift(
        T, location=BM, open_row="OPEN", col_iso=D1, person="Carl Client", by="Tester",
        may_decide=True))

    # ── a handoff reads the cell as it is NOW — an old override included ──
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("INSERT INTO asa_house_calendar_overrides (location, employee, col_iso, value) "
                    "VALUES (%s,%s,%s,%s)", (JH, "Dee Way", D2, "2P-10P"))
        c.commit()
    sr.forget_estate()
    off = shift_handoff.offer(T, location=JH, col_iso=D2, from_staff="Dee Way",
                              to_staff="Ann Roe")
    OUT["handoff_value"] = off["value"]

    # ── the live grid says how a published cell got there ────────────────
    # a publish's own record, written here: a real publish in test mode would reach the mock outbox
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("INSERT INTO asa_house_calendar_edits (location, employee, col_iso, old_value, "
                    "new_value, via, actor, stage) VALUES (%s, %s, %s, '', %s, 'publish', 'Tester', "
                    "'published')", (BM, "Ben Left", D2, "8A-4P"))
        c.commit()
    sr.forget_estate()
    marked = sr.calendar_grid(T, BM, None)
    ben = next(r for r in marked["rows"] if r["employee"] == "Ben Left")
    OUT["mark"] = ben["cells"][[str(c.get("iso")) for c in marked["cols"]].index(D2)].get("published")
    OUT["mark_why"] = marked.get("published_why")
finally:
    cbh.use_workbook(None)
    OUT["rooms"] = ROOMS.close()
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''

# the checkout's modules shipped into the container
MODULES = ("calendar_builder_houses", "calendar_builder_write", "house_cal_live",
           "shift_requests", "shift_handoff", "shift_slices", "calendar_builder_slices",
           "house_directory", "psi_reminders", "badge_follows",
           # the one rule of which published cells still count, the calendar's too
           "effective_roster",
           # decide()'s covered hook runs against this run's schema
           "open_shift_covered",
           # the overlap law's time-off source, and the rule its stand-in house copies by
           "time_off", "redaction")


def _lane_in_container(script_body: str = LANE) -> dict | None:
    # every module the roots reach, and the IST settings reader's declaration, in a folder of this run's own
    sources = lane_schema.with_imports(SERVER, (*MODULES, "ist_config"))
    script = lane_schema.script(sources, script_body, "house-calendars")
    try:
        proc = subprocess.run(["docker", "exec", "-i", CONTAINER, "python3", "-"],
                              input=script, capture_output=True, text=True, timeout=300)
    except FileNotFoundError:
        return None
    for line in (proc.stdout or "").splitlines():
        if line.startswith("LANE_RESULT "):
            return json.loads(line[len("LANE_RESULT "):])
    sys.stderr.write(proc.stdout + proc.stderr)
    # A lane that printed nothing CRASHED — it is not a lane that was skipped.
    return {"crash": "the lane printed no result", "trace": (proc.stderr or "")[-3000:]}


# ---------------------------------------------------------------------------
# SCHEDULING RINGS LIKE THE HOUSE CALENDARS: a Scheduling write the engine
# answered 200 through /gas rings the bare name `scheduling`; the board read,
# a refusal and any other action ring nothing; a ring that fails fails no write.
# The relay's own gas_relay runs here, over a fake engine.
# ---------------------------------------------------------------------------
import __future__ as _future  # noqa: E402
import ast  # noqa: E402
import asyncio  # noqa: E402
import builtins  # noqa: E402
import hashlib  # noqa: E402
import re as _re  # noqa: E402
import stat as _stat  # noqa: E402
import tempfile as _tempfile  # noqa: E402
import time as _time  # noqa: E402
import urllib.parse  # noqa: E402

print("\nSCHEDULING — the ring after a write through /gas")
SVC = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
SVC_TREE = ast.parse(SVC)


def _svc_node(name: str) -> ast.AST:
    for n in SVC_TREE.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name:
            return n
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in n.targets):
            return n
    raise KeyError(name)


def _svc_load(ns: dict, *names: str) -> None:
    for name in names:
        code = compile(ast.Module(body=[_svc_node(name)], type_ignores=[]), f"snapshot_service.py:{name}", "exec",
                       flags=_future.annotations.compiler_flag, dont_inherit=True)
        exec(code, ns)  # noqa: S102 - the relay's own source


gas_src = ast.get_source_segment(SVC, _svc_node("gas_relay")) or ""
check("the /gas relay hands the answer Python's door gave to the Scheduling observer, once, and posts nowhere; a "
      "write Python kept rings it from its own landing",
      gas_src.count("_relay_observe_scheduling(action, res.content)") == 1 and ".post(" not in gas_src
      and "_relay_observe_scheduling(action, content)" in (ast.get_source_segment(SVC, _svc_node(
          "_backend_final_landed")) or ""))


class _Answer:
    def __init__(self, content: bytes) -> None:
        self.content = content


class _Engine:
    """Python's door as these cases see it (the relay's _backend_answer asks it through this client): every ask
    answered with what the case says the door answers."""
    answer = b"{}"
    posted: list[str] = []

    def __init__(self, *a, **k) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc) -> bool:
        return False

    async def post(self, url: str, headers=None, content: bytes = b"") -> _Answer:
        body = json.loads(urllib.parse.parse_qs(content.decode()).get("body", ["{}"])[0])
        _Engine.posted.append(str(body.get("action") or ""))
        return _Answer(_Engine.answer)


class _Response:
    def __init__(self, content=b"", media_type: str = "", status_code: int = 200, headers=None) -> None:
        self.body = content if isinstance(content, bytes) else str(content).encode()


class _Request:
    def __init__(self, raw: bytes) -> None:
        self._raw = raw
        self.headers: dict[str, str] = {}

    async def body(self) -> bytes:
        return self._raw


class _App:
    def post(self, *_a, **_k):
        return lambda fn: fn


class _Log:
    def info(self, *a, **k) -> None:
        pass

    warning = info


def _gas_namespace(rung: list[str], publish_fails: bool = False) -> dict:
    gas_node = _svc_node("gas_relay")
    assigned = {n.id for n in ast.walk(gas_node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)}
    assigned |= {n.name for n in ast.walk(gas_node) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    assigned |= {a.arg for n in ast.walk(gas_node) if isinstance(n, ast.arguments) for a in n.args + n.kwonlyargs}
    awaited = {n.value.func.id for n in ast.walk(gas_node)
               if isinstance(n, ast.Await) and isinstance(n.value, ast.Call) and isinstance(n.value.func, ast.Name)}
    free = {n.id for n in ast.walk(gas_node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
    free -= assigned | set(dir(builtins))

    async def _nothing(*_a, **_k):
        return None

    def _publish(name: str) -> None:
        if publish_fails:
            raise RuntimeError("no loop to ring on")
        rung.append(name)

    lanes = {"schedulingBoard": "read", "schedulingCellSave": "tool", "schedulingAnswer": "tool", "chatPing": "read"}
    ns: dict = {name: (_nothing if name in awaited else (lambda *_a, **_k: None)) for name in free}
    # the doors only Python answers and the backend's writes: none here (each has its own suite)
    ns.update({name: frozenset() for name in free if name.endswith("_ACTIONS")
               or name in ("PUBLIC_DOOR_APPS", "PUBLIC_WHOLE_DOORS", "PYTHON_TOOL_DOORS", "AUTH_PY_DOORS")})
    ns.update({"_BACKEND_WRITES": {}, "_BackendAnswer": type("_BackendAnswer", (), {})})

    async def _as_answered(*args):
        # no edition to cut: the door's own bytes
        return next(a for a in reversed(args) if isinstance(a, (bytes, bytearray)))

    async def _python_door(_door: str, raw: bytes):
        # Python's read, asked through the case's client: its answer and the moment it was read
        async with ns["httpx"].AsyncClient() as client:
            res = await client.post("python-door", headers={}, content=raw)
        return res, _time.time()

    ns.update({"_backend_editions_cut": _as_answered, "_backend_answer": _python_door})
    ns.update({
        "asyncio": asyncio, "json": json, "time": _time, "urllib": urllib, "hashlib": hashlib,
        "app": _App(), "log": _Log(), "Request": _Request, "Response": _Response, "httpx": types.SimpleNamespace(AsyncClient=_Engine),
        "_by_action": {}, "_auth_master": {}, "chat_live": None, "_DIGEST_NOW": asyncio.Event(),
        "RELAY_NO_RECEIPT_ACTIONS": frozenset({"schedulingBoard"}),
        "_DIGEST_WAKERS": frozenset(), "_relay_is_service": lambda _raw: False,
        "_resolver_lane": lambda a: lanes.get(a, ""), "_relay_token": lambda _raw: "",
        "_publish_slice": _publish,
        # the master account's guards (their own suite): no address, nothing held
        "_MASTER_SIGN_IN_ADDR": __import__("contextvars").ContextVar("master_sign_in_addr", default=""),
    })
    _svc_load(ns, "_relay_json_constant", "_relay_form", "_relay_action", "SCHEDULING_EVENT", "_SCHEDULING_READS",
              "_relay_observe_scheduling", "gas_relay")
    return ns


def _through_gas(action: str, answer: dict | bytes, publish_fails: bool = False) -> tuple[list[str], bytes, list[str]]:
    """(the names rung, what the browser was answered, what reached the engine) for one /gas call."""
    rung: list[str] = []
    ns = _gas_namespace(rung, publish_fails)
    _Engine.answer = answer if isinstance(answer, bytes) else json.dumps(answer).encode()
    _Engine.posted = []
    raw = urllib.parse.urlencode({"body": json.dumps({"token": "tok", "action": action, "payload": {"house": "BM4060"}})}).encode()
    out = asyncio.run(ns["gas_relay"](_Request(raw)))
    return rung, out.body, list(_Engine.posted)


SAVED = {"status": 200, "data": {"ok": True, "said": "Saved.", "period_id": "P2026-09-28", "grids": {}, "busy": {}}}
rung, said, posted = _through_gas("schedulingCellSave", SAVED)
check("a Scheduling write the engine answered 200 rings `scheduling`, once, and the browser gets the engine's answer",
      rung == ["scheduling"] and json.loads(said) == SAVED and posted == ["schedulingCellSave"], [rung, said, posted])
rung, _said, _posted = _through_gas("schedulingAnswer", {"status": 200, "data": {"ok": True, "said": "Approved."}})
check("…a decision from My Work too (every `scheduling` write, not a list of them)", rung == ["scheduling"], rung)
rung, said, _posted = _through_gas("schedulingBoard", {"status": 200, "data": {"ok": True}})
check("the board read rings nothing — a read changes no screen", rung == [] and json.loads(said)["status"] == 200, rung)
REFUSED = {"status": 409, "message": "Somebody else is changing the calendar right now — try again."}
rung, said, _posted = _through_gas("schedulingCellSave", REFUSED)
check("a refused write rings nothing, and its refusal reaches the browser as the engine said it",
      rung == [] and json.loads(said) == REFUSED, [rung, said])
rung, said, _posted = _through_gas("schedulingCellSave", b'{"status": 500')
check("an answer that is not the engine's envelope rings nothing", rung == [], rung)
rung, said, _posted = _through_gas("chatPing", {"status": 200, "data": {}})
check("another app's call rings nothing", rung == [], rung)
rung, said, _posted = _through_gas("schedulingCellSave", SAVED, publish_fails=True)
check("a ring that cannot be made never fails the write: the browser still gets the engine's 200",
      rung == [] and json.loads(said) == SAVED, said)


# ---------------------------------------------------------------------------
# THE VIEWER CACHE: Scheduling, Support Requests and Transportation answered
# from each viewer's own kept copy — the relay's own gas_relay, its observers,
# its bell and the cache, over a fake engine and a clock that moves when told.
# ---------------------------------------------------------------------------
print("\nTHE VIEWER CACHE — the three boards kept per viewer, through /gas")
_BOARD_READS = ("schedulingBoard", "supportDeskList", "vehicleCalendarBoard")
_BOARD_LANES = {**{r: "read" for r in _BOARD_READS}, "schedulingCellSave": "tool", "supportDeskDecide": "tool",
                "vehicleCalendarRequest": "tool", "appBadgeAccessSet": "tool"}


def _node_label(node: ast.AST) -> str:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return node.name
    if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
        return node.targets[0].id
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return node.target.id
    return ""


def _load_labelled(ns: dict, wanted) -> None:
    for node in SVC_TREE.body:
        if wanted(_node_label(node)):
            exec(compile(ast.Module(body=[node], type_ignores=[]), "snapshot_service.py", "exec",  # noqa: S102
                         flags=_future.annotations.compiler_flag, dont_inherit=True), ns)


def _is_cache_node(label: str) -> bool:
    return "viewer_cache" in label.lower() or label.startswith("_ViewerCache")


class _Clock:
    def __init__(self) -> None:
        self.t = 5000.0

    def monotonic(self) -> float:
        return self.t

    def time(self) -> float:
        return 1_800_000_000.0 + self.t

    def time_ns(self) -> int:
        return int(self.time() * 1e9)


class _Lines:
    def __init__(self) -> None:
        self.said: list[str] = []

    def info(self, msg, *args, **_k) -> None:
        self.said.append(str(msg) % args if args else str(msg))

    warning = info


class _Boards:
    """Apps Script for the three boards: each viewer's own cut of the edition a write moves; a gate holds the reads."""

    def __init__(self) -> None:
        self.posted: list[dict] = []
        self.edition = 1
        self.reads = 0
        self.down: dict[str, int] = {}
        self.accepts = {"tok-ann", "tok-bob"}
        self.gate: asyncio.Event | None = None
        # a held read that has already read its sheets: answered as they were when it arrived
        self.early = False
        # what each board's data carries besides
        self.carry: dict[str, dict] = {}
        # the reads answered with doPost's receipt of an earlier attempt in place of the board
        self.receipt: set[str] = set()

    def answer(self, env: dict) -> dict:
        action, token = str(env.get("action") or ""), str(env.get("token") or "")
        if token not in self.accepts:
            return {"status": 401, "message": "Authentication required."}
        if action in self.receipt:
            return {"status": 200, "data": {"accepted": True, "deduplicated": True}}
        if action in self.down:
            return {"status": self.down[action], "message": "Not just now.", "data": {"ok": False}}
        if action in _BOARD_READS:
            self.reads += 1
            return {"status": 200, "data": {
                "ok": True, "now": f"2026-10-01T12:00:{self.reads:02d}Z", "stamp": f"read {self.reads}",
                "viewer": {"uid": "u-" + token[4:]}, "edition": self.edition,
                "asked": {k: env.get(k) for k in ("payload", "world", "tenant", "member")},
                "sources": [{"key": "events", "state": "ready", "as_of": f"as of read {self.reads}"}],
                **self.carry.get(action, {})}}
        self.edition += 1
        return {"status": 200, "data": {"ok": True, "said": "Saved."}}


class _BoardClient:
    def __init__(self, boards: _Boards) -> None:
        self.boards = boards

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc) -> bool:
        return False

    async def post(self, url: str, headers=None, content: bytes = b"") -> _Answer:
        env = json.loads(urllib.parse.parse_qs(content.decode())["body"][0])
        self.boards.posted.append(env)
        said = self.boards.answer(env) if self.boards.early else None
        if self.boards.gate is not None and env.get("action") in _BOARD_READS:
            await self.boards.gate.wait()
        return _Answer(json.dumps(said if said is not None else self.boards.answer(env)).encode())


class _Stream:
    """One open screen's queue: every name the bell rings."""

    def __init__(self, rung: list[str]) -> None:
        self.rung = rung

    def put_nowait(self, name: str) -> None:
        self.rung.append(name)


def _cache_namespace():
    rung: list[str] = []
    ns = _gas_namespace(rung)
    boards, clock, lines = _Boards(), _Clock(), _Lines()
    sessions, broken = {"tok-ann", "tok-bob"}, set()

    async def session_actor(authorization: str):
        token = authorization[7:] if authorization.startswith("Bearer ") else ""
        if token in broken:
            raise RuntimeError("the mirror is down")
        return ("staff", "u-" + token[4:]) if token in sessions else None

    ns.update({"time": clock, "log": lines, "os": os, "_session_actor": session_actor,
               "httpx": types.SimpleNamespace(AsyncClient=lambda *a, **k: _BoardClient(boards)),
               "_resolver_lane": lambda a: _BOARD_LANES.get(a, ""), "RELAY_NO_RECEIPT_ACTIONS": frozenset(_BOARD_READS),
               "_event_loop": types.SimpleNamespace(call_soon_threadsafe=lambda fn: fn()),
               "_event_subs": {_Stream(rung)}, "_hotline_tag_live": lambda _q, _now: False,
               "APP_PACK_DIR": "", "_housekeeping_slots": asyncio.Semaphore(3), "re": _re, "Path": Path,
               "tempfile": _tempfile,
               # no resolver manifest here: the default lane keeps nothing, so only the boards' own rings are measured
               "_resolver_table": lambda: {}, "_resolver_cache": {"mtime": 0.0},
               "_resolver_touches": lambda _a: None, "_resolver_invalidates": lambda _a: (),
               "_APP_PACK_VERBS": frozenset(), "RELAY_BYTE_READS": frozenset()})
    _load_labelled(ns, lambda label: label in {
        "_relay_json_constant", "_relay_envelope", "SUPPORT_DESK_EVENT", "_SUPPORT_DESK_WRITES",
        "_SUPPORT_DESK_SCHED_WRITES", "_relay_observe_support_desk", "VEHICLE_CALENDAR_EVENT",
        "VEHICLE_CALENDAR_WRITES", "_vehicle_calendar_rang", "_RELAY_APP_ACCESS_ACTIONS", "_BG_TASKS", "_keep_task",
        "_publish_slice", "STAFF_PROFILES_EVENT", "STAFF_PROFILES_WRITES"})
    _load_labelled(ns, _is_cache_node)
    return ns, boards, clock, rung, lines, sessions, broken


def _board_ask(token: str, action: str, payload: dict | None = None, **extra) -> bytes:
    env = {"token": token, "action": action, **({"payload": payload} if payload is not None else {}), **extra}
    return urllib.parse.urlencode({"body": json.dumps(env)}).encode()


async def _via(ns: dict, raw: bytes) -> dict:
    return json.loads((await ns["gas_relay"](_Request(raw))).body)


async def _settled(ns: dict) -> None:
    for _ in range(20):
        await asyncio.sleep(0)
        if not ns["_BG_TASKS"]:
            return
        await asyncio.gather(*list(ns["_BG_TASKS"]))


def _told_nothing_personal(lines: list[str]) -> bool:
    return all(not any(p in line for p in ("tok-", "u-ann", "u-bob", "P1", "BM4060", "T-north", "W-ann"))
               for line in lines)


async def _two_viewers() -> dict:
    ns, boards, clock, _rung, lines, _s, _b = _cache_namespace()
    p1 = {"period_id": "P1"}
    ann1 = await _via(ns, _board_ask("tok-ann", "schedulingBoard", p1))
    clock.t += 1
    bob1 = await _via(ns, _board_ask("tok-bob", "schedulingBoard", p1))
    clock.t += 1
    ann2 = await _via(ns, _board_ask("tok-ann", "schedulingBoard", p1))
    bob2 = await _via(ns, _board_ask("tok-bob", "schedulingBoard", p1))
    asked_by_two = len(boards.posted)
    crossings = []
    for extra in ({"member": "u-bob"}, {"tenant": "T-north"}, {"world": "W-ann"}):
        clock.t += 1
        crossings.append((await _via(ns, _board_ask("tok-ann", "schedulingBoard", p1, **extra)))["data"]["asked"])
    clock.t += 1
    other_period = await _via(ns, _board_ask("tok-ann", "schedulingBoard", {"period_id": "P2"}))
    asked_all = len(boards.posted)
    clock.t += 1
    visit_again = await _via(ns, _board_ask("tok-ann", "schedulingBoard", p1, member="u-bob"))
    return {"ann": (ann1, ann2), "bob": (bob1, bob2), "asked_by_two": asked_by_two, "crossings": crossings,
            "other": other_period["data"]["asked"], "asked_all": asked_all, "asked_end": len(boards.posted),
            "visit_again": visit_again["data"]["asked"], "kept": dict(ns["_VIEWER_CACHE"]), "lines": lines.said}


two = asyncio.run(_two_viewers())
check("two viewers asking the same board with the same payload each get their own cut, and each is answered again "
      "from their own copy — the engine asked once per viewer",
      two["ann"][0]["data"]["viewer"]["uid"] == "u-ann" and two["bob"][0]["data"]["viewer"]["uid"] == "u-bob"
      and two["ann"][1] == two["ann"][0] and two["bob"][1] == two["bob"][0] and two["asked_by_two"] == 2,
      [two["ann"], two["bob"], two["asked_by_two"]])
check("a visit, a tenant, a world and another period are each another copy, asked of the engine; the same visit "
      "again is its own copy",
      [c.get("member") or c.get("tenant") or c.get("world") for c in two["crossings"]] == ["u-bob", "T-north", "W-ann"]
      and two["other"]["payload"] == {"period_id": "P2"} and two["asked_all"] == 6 and two["asked_end"] == 6
      and two["visit_again"]["member"] == "u-bob", [two["crossings"], two["asked_all"], two["asked_end"]])
check("no copy is kept under the token, and no copy carries it: the key is a hash, the session's a hash",
      len(two["kept"]) == 6 and all("tok-" not in k and "tok-" not in repr({f: v for f, v in e.items() if f != "body"})
                                     and b"tok-" not in e["body"] for k, e in two["kept"].items()),
      list(two["kept"]))


async def _receipt_not_kept() -> dict:
    ns, boards, clock, _rung, lines, _s, _b = _cache_namespace()
    ask = _board_ask("tok-ann", "supportDeskList", {"completed": False})
    boards.receipt.add("supportDeskList")
    receipt = await _via(ns, ask)
    kept_after_receipt = len(ns["_VIEWER_CACHE"])
    boards.receipt.clear()
    clock.t += 1
    real = await _via(ns, ask)
    asked = len(boards.posted)
    body = next(iter(ns["_VIEWER_CACHE"].values()))["body"]
    boards.receipt.add("supportDeskList")
    clock.t += ns["VIEWER_CACHE_FRESH_S"] + 1
    stale = await _via(ns, ask)
    await _settled(ns)
    return {"receipt": receipt, "kept_after_receipt": kept_after_receipt, "real": real, "asked": asked,
            "stale": stale, "body_same": next(iter(ns["_VIEWER_CACHE"].values()))["body"] == body,
            "refreshed": len(boards.posted) - asked, "lines": list(lines.said)}


receipt_case = asyncio.run(_receipt_not_kept())
check("a read answered with a receipt in place of the board is never kept: the next ask reaches the engine, and a "
      "real answer is",
      receipt_case["receipt"]["data"] == {"accepted": True, "deduplicated": True}
      and receipt_case["kept_after_receipt"] == 0 and receipt_case["real"]["data"].get("ok") is True
      and receipt_case["asked"] == 2, receipt_case)
check("…and a refresh behind a kept copy answered with a receipt leaves the copy as it was",
      receipt_case["stale"] == receipt_case["real"] and receipt_case["refreshed"] == 1 and receipt_case["body_same"]
      and any("the copy kept" in line for line in receipt_case["lines"]), receipt_case)


async def _session_gone() -> dict:
    ns, boards, clock, _rung, lines, sessions, broken = _cache_namespace()
    ask = _board_ask("tok-ann", "supportDeskList", {"completed": False})
    first = await _via(ns, ask)
    await _via(ns, _board_ask("tok-ann", "vehicleCalendarBoard"))
    clock.t += 1
    sessions.discard("tok-ann")
    boards.accepts.discard("tok-ann")
    before = len(boards.posted)
    gone = await _via(ns, ask)
    asked = len(boards.posted) - before
    left = [e["read"] for e in ns["_VIEWER_CACHE"].values()]
    bob_ask = _board_ask("tok-bob", "supportDeskList", {"completed": False})
    bob_kept = await _via(ns, bob_ask)
    clock.t += 1
    broken.add("tok-bob")
    before = len(boards.posted)
    bob_unvouched = await _via(ns, bob_ask)
    return {"first": first, "gone": gone, "asked": asked, "left": left, "bob_kept": bob_kept,
            "bob_unvouched": bob_unvouched, "bob_asked": len(boards.posted) - before}


gone = asyncio.run(_session_gone())
check("a session that no longer stands is never answered from its copy, fresh as it is: the engine is asked and "
      "its 401 reaches the browser",
      gone["first"]["status"] == 200 and gone["gone"]["status"] == 401 and gone["asked"] == 1, gone)
check("…and the 401 takes every copy that session had, of every board", gone["left"] == [], gone["left"])
check("a session the relay cannot vouch for (its check fails) is asked of the engine, not answered from its copy",
      gone["bob_asked"] == 1 and gone["bob_unvouched"]["status"] == 200
      and gone["bob_unvouched"]["data"]["now"] != gone["bob_kept"]["data"]["now"], gone)


async def _after_a_write() -> dict:
    ns, boards, clock, rung, lines, _s, _b = _cache_namespace()
    ask = _board_ask("tok-ann", "schedulingBoard", {"period_id": "P1"})
    kept = await _via(ns, ask)
    clock.t += 1
    wrote = await _via(ns, _board_ask("tok-bob", "schedulingCellSave", {"house": "BM4060", "date": "2026-10-02"}))
    rung_by_write = list(rung)
    clock.t += 1
    boards.gate = asyncio.Event()
    before = len(boards.posted)
    first = await asyncio.wait_for(_via(ns, ask), 1.0)
    second = await asyncio.wait_for(_via(ns, ask), 1.0)
    for _ in range(5):
        await asyncio.sleep(0)
    held = [dict(e) for e in boards.posted[before:]]
    boards.gate.set()
    await _settled(ns)
    rung_by_refresh = list(rung)
    asked = len(boards.posted)
    clock.t += 1
    third = await _via(ns, ask)
    await _settled(ns)
    return {"kept": kept, "wrote": wrote, "rung_by_write": rung_by_write, "first": first, "second": second,
            "held": held, "rung_by_refresh": rung_by_refresh, "third": third, "asked_third": len(boards.posted) - asked,
            "rung_end": list(rung), "lines": lines.said}


after = asyncio.run(_after_a_write())
check("a Scheduling write rings its board and Support Requests' (the observers, unchanged)",
      after["wrote"]["status"] == 200 and after["rung_by_write"] == ["scheduling", "support-desk"],
      after["rung_by_write"])
check("after the write's ring a viewer's copy is stale and still answered at once, the engine held — twice",
      after["first"] == after["kept"] and after["second"] == after["kept"] and after["first"]["data"]["edition"] == 1,
      [after["first"], after["second"]])
check("…and read again behind it exactly once for both reads, with the very envelope the viewer sent",
      len(after["held"]) == 1 and after["held"][0] == {"token": "tok-ann", "action": "schedulingBoard",
                                                       "payload": {"period_id": "P1"}}, after["held"])
check("the refresh that changed the board rings `scheduling` once, and only that",
      after["rung_by_refresh"] == after["rung_by_write"] + ["scheduling"], after["rung_by_refresh"])
check("the re-read that ring brings is the fresh copy, from memory: no engine call, no second ring — no loop",
      after["third"]["data"]["edition"] == 2 and after["asked_third"] == 0
      and after["rung_end"] == after["rung_by_refresh"], [after["third"], after["asked_third"], after["rung_end"]])
check("one log line per refresh, its outcome and counts, nothing of the viewer or the payload",
      [ln for ln in after["lines"] if ln.startswith("viewer cache:")] == [
          "viewer cache: schedulingBoard read again behind a kept copy — changed, rung (1 kept; 0 fresh, 2 stale, "
          "1 missed)"] and _told_nothing_personal(after["lines"]), after["lines"])


async def _unchanged() -> dict:
    ns, boards, clock, rung, lines, _s, _b = _cache_namespace()
    ask = _board_ask("tok-ann", "supportDeskList", {"completed": False})
    kept = await _via(ns, ask)
    clock.t += ns["VIEWER_CACHE_FRESH_S"] + 1
    before = len(boards.posted)
    served = await _via(ns, ask)
    await _settled(ns)
    asked = len(boards.posted) - before
    clock.t += 1
    again = await _via(ns, ask)
    return {"kept": kept, "served": served, "asked": asked, "again": again, "rung": list(rung),
            "asked_end": len(boards.posted) - before, "lines": lines.said}


same = asyncio.run(_unchanged())
check("a copy past fresh is answered at once and read again behind it once; an answer that moved only its clock "
      "(now, stamp, each source's as_of) rings nothing",
      same["served"] == same["kept"] and same["asked"] == 1 and same["rung"] == []
      and any("— unchanged (" in ln for ln in same["lines"]) and _told_nothing_personal(same["lines"]), same)
check("…and the read it brought is kept: the next answer is the new copy, from memory",
      same["again"]["data"]["now"] != same["kept"]["data"]["now"] and same["asked_end"] == 1, same["again"])


async def _refusals() -> dict:
    ns, boards, clock, rung, lines, _s, _b = _cache_namespace()
    ask = _board_ask("tok-ann", "vehicleCalendarBoard")
    boards.down["vehicleCalendarBoard"] = 503
    one = await _via(ns, ask)
    clock.t += 1
    two_ = await _via(ns, ask)
    kept_after = len(ns["_VIEWER_CACHE"])
    asked_refused = len(boards.posted)
    boards.down.clear()
    good = await _via(ns, ask)
    clock.t += ns["VIEWER_CACHE_FRESH_S"] + 1
    boards.down["vehicleCalendarBoard"] = 503
    served = await _via(ns, ask)
    await _settled(ns)
    still = [e["body"] for e in ns["_VIEWER_CACHE"].values()]
    boards.down["vehicleCalendarBoard"] = 404
    clock.t += 1
    closed_served = await _via(ns, ask)
    await _settled(ns)
    after_closed = len(ns["_VIEWER_CACHE"])
    before = len(boards.posted)
    clock.t += 1
    closed = await _via(ns, ask)
    return {"one": one, "two": two_, "kept_after": kept_after, "asked_refused": asked_refused, "good": good,
            "served": served, "still": still, "rung": list(rung), "closed_served": closed_served,
            "after_closed": after_closed, "closed": closed, "closed_asked": len(boards.posted) - before,
            "lines": lines.said}


refused = asyncio.run(_refusals())
check("an answer that is not a 200 is never kept: asked of the engine each time",
      refused["one"]["status"] == 503 and refused["two"]["status"] == 503 and refused["kept_after"] == 0
      and refused["asked_refused"] == 2, refused)
check("a refresh the engine refuses keeps the copy it had and rings nothing",
      refused["served"] == refused["good"] and refused["still"] == [json.dumps(refused["good"]).encode()]
      and refused["rung"] == [] and any("— answered 503, the copy kept (" in ln for ln in refused["lines"]),
      [refused["still"], refused["lines"]])
check("…but a refresh told the board is closed to this viewer (404) takes the copy: the next read is the engine's",
      refused["closed_served"] == refused["good"] and refused["after_closed"] == 0
      and refused["closed"]["status"] == 404 and refused["closed_asked"] == 1
      and any("— answered 404, the copy taken (" in ln for ln in refused["lines"]), refused)


async def _bounded() -> dict:
    ns, boards, clock, _rung, _lines, _s, _b = _cache_namespace()
    ns["VIEWER_CACHE_MAX_KEYS"] = 3

    def periods() -> list[str]:
        return [json.loads(e["body"])["data"]["asked"]["payload"]["period_id"] for e in ns["_VIEWER_CACHE"].values()]

    for i in range(5):
        clock.t += 1
        await _via(ns, _board_ask("tok-ann", "schedulingBoard", {"period_id": f"P{i}"}))
    five = periods()
    clock.t += 1
    before = len(boards.posted)
    await _via(ns, _board_ask("tok-ann", "schedulingBoard", {"period_id": "P2"}))
    hit_asked = len(boards.posted) - before
    clock.t += 1
    await _via(ns, _board_ask("tok-ann", "schedulingBoard", {"period_id": "P5"}))
    six = periods()
    before = len(boards.posted)
    clock.t += 1
    await _via(ns, _board_ask("tok-ann", "schedulingBoard", {"period_id": "P0"}))
    evicted_asked = len(boards.posted) - before
    size = len(next(iter(ns["_VIEWER_CACHE"].values()))["body"])
    ns["VIEWER_CACHE_MAX_KEYS"], ns["VIEWER_CACHE_MAX_BYTES"] = 400, 8 * size + 64
    for i in range(10, 22):
        clock.t += 1
        await _via(ns, _board_ask("tok-ann", "schedulingBoard", {"period_id": f"P{i}"}))
    held_bytes = sum(len(e["body"]) for e in ns["_VIEWER_CACHE"].values())
    return {"five": five, "hit_asked": hit_asked, "six": six, "evicted_asked": evicted_asked,
            "held_bytes": held_bytes, "max_bytes": ns["VIEWER_CACHE_MAX_BYTES"], "held": len(ns["_VIEWER_CACHE"])}


bound = asyncio.run(_bounded())
check("the copies are bounded, the least recently answered going first: three kept of five, a hit made newest",
      bound["five"] == ["P2", "P3", "P4"] and bound["hit_asked"] == 0 and bound["six"] == ["P4", "P2", "P5"]
      and bound["evicted_asked"] == 1, bound)
check("…and bounded in bytes as well", bound["held_bytes"] <= bound["max_bytes"] and 0 < bound["held"] < 12, bound)


async def _writes_untouched() -> dict:
    ns, boards, clock, _rung, _lines, _s, _b = _cache_namespace()
    sent = {"token": "tok-ann", "action": "vehicleCalendarRequest", "payload": {"trip": "T1", "seats": 2}}
    raw = urllib.parse.urlencode({"body": json.dumps(sent)}).encode()
    one = await _via(ns, raw)
    clock.t += 1
    two_ = await _via(ns, raw)
    posted = [{k: v for k, v in e.items() if k != "write_id"} for e in boards.posted]
    return {"one": one, "two": two_, "posted": posted, "sent": sent, "kept": len(ns["_VIEWER_CACHE"]),
            "stamped": all(str(e.get("write_id") or "").startswith("W") for e in boards.posted)}


writes = asyncio.run(_writes_untouched())
check("a write is never kept: the same write twice reaches its door twice, as it was sent, and nothing is kept",
      writes["one"]["status"] == 200 and writes["two"]["status"] == 200 and writes["posted"] == [writes["sent"]] * 2
      and writes["kept"] == 0, writes)


async def _writer_case() -> dict:
    ns, boards, clock, _rung, _lines, _s, _b = _cache_namespace()
    ann_ask = _board_ask("tok-ann", "schedulingBoard", {"period_id": "P1"})
    bob_ask = _board_ask("tok-bob", "schedulingBoard", {"period_id": "P1"})
    await _via(ns, ann_ask)
    await _via(ns, bob_ask)
    clock.t += 1
    await _via(ns, _board_ask("tok-ann", "schedulingCellSave", {"house": "BM4060"}))
    clock.t += 1
    before = len(boards.posted)
    ann_after = await _via(ns, ann_ask)
    ann_asked = len(boards.posted) - before
    before = len(boards.posted)
    bob_after = await _via(ns, bob_ask)
    await _settled(ns)
    bob_asked = len(boards.posted) - before
    # a read of the writer's that left before its own write landed is answered, never kept
    clock.t += 1
    other = _board_ask("tok-ann", "schedulingBoard", {"period_id": "P9"})
    held = asyncio.Event()
    boards.gate = held
    reading = asyncio.ensure_future(_via(ns, other))
    for _ in range(5):
        await asyncio.sleep(0)
    clock.t += 1
    await _via(ns, _board_ask("tok-ann", "schedulingCellSave", {"house": "BM4060"}))
    held.set()
    crossed = await reading
    boards.gate = None
    kept_crossed = [e for e in ns["_VIEWER_CACHE"].values()
                    if json.loads(e["body"])["data"]["asked"]["payload"] == {"period_id": "P9"}]
    # a Transportation writer's own Support Requests copy, which its write changes, is not answered either
    desk = _board_ask("tok-ann", "supportDeskList", {"completed": False})
    clock.t += 1
    desk_kept = await _via(ns, desk)
    clock.t += 1
    await _via(ns, _board_ask("tok-ann", "vehicleCalendarRequest", {"trip": "T1"}))
    clock.t += 1
    before = len(boards.posted)
    desk_after = await _via(ns, desk)
    desk_asked = len(boards.posted) - before
    return {"ann_after": ann_after, "ann_asked": ann_asked, "bob_after": bob_after, "bob_asked": bob_asked,
            "crossed": crossed, "kept_crossed": kept_crossed, "desk_kept": desk_kept, "desk_after": desk_after,
            "desk_asked": desk_asked, "pending": len(ns["_BG_TASKS"])}


writer = asyncio.run(_writer_case())
check("the writer is never answered from a copy older than its own write: its next read is the engine's",
      writer["ann_asked"] == 1 and writer["ann_after"]["data"]["edition"] == 2, writer)
check("…while another viewer's copy is answered at once, stale, and read again behind it",
      writer["bob_after"]["data"]["edition"] == 1 and writer["bob_asked"] == 1, writer)
check("a read of the writer's that left before its own write landed is answered, and not kept",
      writer["crossed"]["status"] == 200 and writer["kept_crossed"] == [], writer)
check("a Transportation writer's next Support Requests read is the engine's too, not its copy from before",
      writer["desk_asked"] == 1 and writer["desk_after"] != writer["desk_kept"] and writer["pending"] == 0, writer)


async def _cross_rings() -> dict:
    ns, boards, clock, rung, _lines, _s, _b = _cache_namespace()
    ask = _board_ask("tok-ann", "supportDeskList", {"completed": False})

    async def refreshes() -> int:
        before = len(boards.posted)
        await _via(ns, ask)
        await _settled(ns)
        return len(boards.posted) - before

    await _via(ns, ask)
    clock.t += 1
    await _via(ns, _board_ask("tok-bob", "vehicleCalendarRequest", {"trip": "T1"}))
    clock.t += 1
    after_vehicle = await refreshes()
    clock.t += 1
    ns["_publish_slice"]("support-desk")
    clock.t += 1
    after_punch = await refreshes()
    clock.t += 1
    ns["_publish_slice"]("support-desk", kept_copy=True)
    clock.t += 1
    after_own = await refreshes()
    ns["_publish_slice"]("scheduling")
    clock.t += 1
    after_sched = await refreshes()
    ns["_publish_slice"]("housecal")
    clock.t += 1
    after_other = await refreshes()
    return {"after_vehicle": after_vehicle, "after_punch": after_punch, "after_own": after_own,
            "after_sched": after_sched, "after_other": after_other, "rung": list(rung)}


cross = asyncio.run(_cross_rings())
check("a Transportation write makes Support Requests' copies stale too (its rows are listed there)",
      cross["after_vehicle"] == 1, cross)
check("so does any other ring of `support-desk` (the missing-punch warnings) and of `scheduling`",
      cross["after_punch"] == 1 and cross["after_sched"] == 1, cross)
check("a kept copy's own refresh ring makes nothing stale, and another name touches no board",
      cross["after_own"] == 0 and cross["after_other"] == 0, cross)


async def _aged_and_access() -> dict:
    ns, boards, clock, _rung, _lines, _s, _b = _cache_namespace()
    ask = _board_ask("tok-ann", "vehicleCalendarBoard")
    kept = await _via(ns, ask)
    clock.t += ns["VIEWER_CACHE_MAX_AGE_S"] + 1
    before = len(boards.posted)
    aged = await _via(ns, ask)
    aged_asked = len(boards.posted) - before
    await _via(ns, _board_ask("tok-bob", "supportDeskList", {"completed": False}))
    held_before = len(ns["_VIEWER_CACHE"])
    clock.t += 1
    access = await _via(ns, _board_ask("tok-ann", "appBadgeAccessSet", {"badge": "staff", "app": "scheduling"}))
    return {"kept": kept, "aged": aged, "aged_asked": aged_asked, "held_before": held_before,
            "access": access, "held_after": len(ns["_VIEWER_CACHE"])}


aged = asyncio.run(_aged_and_access())
check("a copy past its age is never answered: the engine is asked, while the viewer waits",
      aged["aged_asked"] == 1 and aged["aged"]["data"]["now"] != aged["kept"]["data"]["now"], aged)
check("an App Control write that landed takes every copy, of every viewer",
      aged["access"]["status"] == 200 and aged["held_before"] == 2 and aged["held_after"] == 0, aged)


async def _ring_while_out() -> dict:
    ns, boards, clock, rung, lines, _s, _b = _cache_namespace()
    ask = _board_ask("tok-ann", "schedulingBoard", {"period_id": "P1"})
    kept = await _via(ns, ask)
    clock.t += ns["VIEWER_CACHE_FRESH_S"] + 1
    boards.early, boards.gate = True, asyncio.Event()
    first = await asyncio.wait_for(_via(ns, ask), 1.0)
    for _ in range(5):
        await asyncio.sleep(0)
    clock.t += 1
    await _via(ns, _board_ask("tok-bob", "schedulingCellSave", {"house": "BM4060"}))
    rung_by_write = list(rung)
    clock.t += 1
    on_ring = await asyncio.wait_for(_via(ns, ask), 1.0)
    out_while = sum(1 for e in boards.posted if e.get("action") == "schedulingBoard")
    boards.gate.set()
    await _settled(ns)
    reads = sum(1 for e in boards.posted if e.get("action") == "schedulingBoard")
    clock.t += 1
    before = len(boards.posted)
    after_ring = await _via(ns, ask)
    await _settled(ns)
    return {"kept": kept, "first": first, "on_ring": on_ring, "out_while": out_while, "reads": reads,
            "rung_by_write": rung_by_write, "rung": list(rung), "after_ring": after_ring,
            "asked_after": len(boards.posted) - before, "lines": [ln for ln in lines.said if "viewer cache" in ln],
            "inflight": len(ns["_VIEWER_CACHE_INFLIGHT"]), "again": len(ns.get("_VIEWER_CACHE_AGAIN", ()))}


overtaken = asyncio.run(_ring_while_out())
check("a write that rings while a copy's refresh is out, re-read on that ring: the old copy at once, no second read "
      "out beside the first",
      overtaken["first"] == overtaken["kept"] and overtaken["on_ring"] == overtaken["kept"]
      and overtaken["out_while"] == 2, overtaken)
check("…the refresh that left before the write brings nothing new and rings nothing, so it is read once more; that "
      "read carries the write and rings once",
      overtaken["reads"] == 3 and overtaken["rung"] == overtaken["rung_by_write"] + ["scheduling"]
      and len(overtaken["lines"]) == 2
      and "unchanged; a ring came while it was out, read once more" in overtaken["lines"][0]
      and "— changed, rung (" in overtaken["lines"][1] and _told_nothing_personal(overtaken["lines"]), overtaken)
check("…and the screen the ring re-reads gets the write from memory: no screen is left on the read before a write",
      overtaken["after_ring"]["data"]["edition"] == 2 and overtaken["asked_after"] == 0
      and overtaken["inflight"] == 0 and overtaken["again"] == 0, overtaken)


async def _outgrown() -> dict:
    ns, boards, clock, rung, _lines, _s, _b = _cache_namespace()
    ask = _board_ask("tok-ann", "vehicleCalendarBoard")
    kept = await _via(ns, ask)
    size = len(next(iter(ns["_VIEWER_CACHE"].values()))["body"])
    ns["VIEWER_CACHE_MAX_BYTES"] = 8 * (size - 1)
    clock.t += 1
    await _via(ns, _board_ask("tok-bob", "vehicleCalendarRequest", {"trip": "T1"}))
    rung_by_write = list(rung)
    clock.t += 1
    served = await _via(ns, ask)
    await _settled(ns)
    rung_by_refresh = list(rung)
    kept_after = len(ns["_VIEWER_CACHE"])
    clock.t += 1
    before = len(boards.posted)
    on_ring = await _via(ns, ask)
    await _settled(ns)
    return {"kept": kept, "served": served, "rung_by_write": rung_by_write, "rung_by_refresh": rung_by_refresh,
            "kept_after": kept_after, "on_ring": on_ring, "asked_on_ring": len(boards.posted) - before,
            "rung": list(rung), "pending": len(ns["_BG_TASKS"])}


grown = asyncio.run(_outgrown())
check("a refresh whose 200 is too big to keep takes the copy it outdates, and rings once",
      grown["served"] == grown["kept"] and grown["kept_after"] == 0
      and grown["rung_by_refresh"] == grown["rung_by_write"] + ["vehicle-calendar"], grown)
check("…so the re-read that ring brings is the engine's answer, never the outdated copy again, and nothing rings on "
      "— no loop",
      grown["on_ring"]["data"]["edition"] == 2 and grown["asked_on_ring"] == 1
      and grown["rung"] == grown["rung_by_refresh"] and grown["pending"] == 0, grown)


async def _signed_out() -> dict:
    ns, boards, clock, _rung, _lines, _s, _b = _cache_namespace()
    ann = _board_ask("tok-ann", "schedulingBoard", {"period_id": "P1"})
    for raw in (ann, _board_ask("tok-ann", "supportDeskList", {"completed": False}),
                _board_ask("tok-bob", "schedulingBoard", {"period_id": "P1"})):
        await _via(ns, raw)
    held_before = len(ns["_VIEWER_CACHE"])
    clock.t += 1
    bye = await _via(ns, _board_ask("tok-ann", "authLogout"))
    left = {e["th"] for e in ns["_VIEWER_CACHE"].values()}
    before = len(boards.posted)
    again = await _via(ns, ann)
    return {"held_before": held_before, "bye": bye, "left": left, "again": again,
            "asked_again": len(boards.posted) - before}


signed = asyncio.run(_signed_out())
check("a sign-out takes every copy of that session as it leaves, whatever the session check would say later; "
      "another viewer's stay",
      signed["held_before"] == 3 and signed["bye"]["status"] == 200
      and signed["left"] == {hashlib.sha256(b"tok-bob").hexdigest()} and signed["asked_again"] == 1, signed)

ns_keys, *_rest = _cache_namespace()
service_raw = urllib.parse.urlencode({"body": json.dumps({"service_secret": "s", "token": "tok-ann",
                                                          "action": "schedulingBoard"})}).encode()
check("only the three boards asked with a person's token are kept: not a service call, not a call with no token, "
      "not any other read",
      ns_keys["_viewer_cache_key"]("schedulingBoard", service_raw) is None
      and ns_keys["_viewer_cache_key"]("schedulingBoard", urllib.parse.urlencode(
          {"body": json.dumps({"action": "schedulingBoard"})}).encode()) is None
      and ns_keys["_viewer_cache_key"]("myCalendarVacationRoute", _board_ask("tok-ann", "myCalendarVacationRoute"))
      is None and ns_keys["_viewer_cache_key"]("schedulingBoard", _board_ask("tok-ann", "schedulingBoard")) is not None)
refresh_ask = ns_keys["_viewer_cache_key"]("schedulingBoard", _board_ask("tok-ann", "schedulingBoard"),
                                           ns_keys["_ViewerCacheRefresh"](b"", "x"))
check("a refresh is told apart by the request it rides, never by anything of the session",
      refresh_ask is not None and refresh_ask["refresh"] is True
      and ns_keys["_viewer_cache_key"]("schedulingBoard", _board_ask("tok-ann", "schedulingBoard"),
                                       _Request(b""))["refresh"] is False)

publish_src = ast.get_source_segment(SVC, _svc_node("_publish_slice")) or ""
refresh_src = ast.get_source_segment(SVC, _svc_node("_viewer_cache_refresh")) or ""
cache_src = "\n".join(ast.get_source_segment(SVC, n) or "" for n in SVC_TREE.body if _is_cache_node(_node_label(n)))
sent_at = gas_src.find("_viewer_cache_written(action, raw)\n")
check("the wiring: a write marks its sender before Python's read is asked, right after the app packs see it",
      gas_src.count("_viewer_cache_written(action, raw)\n") == 1
      and -1 < gas_src.find("_app_pack_sending(action, raw)") < sent_at
      < gas_src.find("backend = await _backend_answer("), sent_at)
check("…the kept copy answers before Python is asked, and the answer Python gave is offered to the cache",
      -1 < gas_src.find("board_ask = _viewer_cache_key(action, raw, request)")
      < gas_src.find("backend = await _backend_answer(")
      and gas_src.count("_viewer_cache_written(action, raw, res.content)") == 1
      and gas_src.count("_viewer_cache_take(board_ask, res.content)") == 1)
check("…the bell makes copies stale before it fans out, unless a kept copy's own refresh rang it",
      -1 < publish_src.find("if not kept_copy:\n        _viewer_cache_rang(resource)") < publish_src.find(
          "loop, subs = _event_loop, list(_event_subs)"))
check("…and a refresh reads through the proxy itself, the one door — the cache posts nothing of its own",
      "await gas_relay(_ViewerCacheRefresh(raw, content_type))" in refresh_src and "EXEC_URL" not in cache_src
      and ".post(" not in cache_src)


# ---------------------------------------------------------------------------
# THE VIEWER CACHE ON DISK: every copy also kept whole in a 0700 folder of the packs' volume, taken up by the next
# start and answered at once, read again behind it; and read ahead of a viewer whose stream is open — on a ring of its
# board and as the stream (re)opens — on the housekeeping lane. The same gas_relay, fake engine and clock as above,
# over a real folder.
# ---------------------------------------------------------------------------
print("\nTHE VIEWER CACHE ON DISK — a restart answers from the kept copies; a ring and a stream read them ahead")
import atexit  # noqa: E402
import shutil  # noqa: E402


class _TokenStream(_Stream):
    """One session's open stream, as /events holds it: the names it hears, and its token."""

    def __init__(self, token: str) -> None:
        super().__init__([])
        self.token = token


def _th(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _packs_folder() -> Path:
    root = Path(_tempfile.mkdtemp(prefix="viewer-cache-test-"))
    atexit.register(shutil.rmtree, root, True)
    (root / "packs").mkdir()
    (root / "served").mkdir()
    return root / "packs"


def _disk_namespace(packs: Path, clock_at: float | None = None):
    """A relay over the packs' volume: its viewer folder inside it, the served tree and the bundle deposit beside it."""
    got = _cache_namespace()
    ns, clock = got[0], got[2]
    if clock_at is not None:
        clock.t = clock_at
    ns.update({"VIEWER_CACHE_DIR": str(packs / "viewer"), "OUT_DIR": str(packs.parent / "served"),
               "BUNDLE_DIR": str(packs.parent / "served"), "APP_PACK_DEFAULT_DIR": str(packs)})
    _svc_load(ns, "_chat_cache_dir_state", "_app_pack_write_file", "_app_pack_dir_state")
    return got


def _on_disk(folder: Path) -> dict[str, str]:
    """name -> the session hash each kept file is for."""
    out = {}
    for path in sorted(folder.iterdir()):
        if _re.fullmatch(r"[0-9a-f]{64}\.viewer\.json", path.name):
            out[path.name] = json.loads(path.read_text(encoding="utf-8")).get("th")
    return out


async def _restart() -> dict:
    packs = _packs_folder()
    ns, boards, clock, _rung, _lines, _s, _b = _disk_namespace(packs)
    folder = await ns["_viewer_cache_open"]()
    ask = _board_ask("tok-ann", "schedulingBoard", {"period_id": "P1"})
    first = await _via(ns, ask)
    await ns["_viewer_cache_flush"](folder)
    names = sorted(p.name for p in folder.iterdir())
    text = (folder / names[0]).read_text(encoding="utf-8") if names else "{}"
    modes = {"folder": _stat.S_IMODE(folder.stat().st_mode),
             "files": sorted({_stat.S_IMODE((folder / n).stat().st_mode) for n in names})}
    # the relay stops and starts again forty seconds later: another process over the same folder
    ns2, boards2, clock2, _rung2, lines2, _s2, _b2 = _disk_namespace(packs, clock.t + 40)
    boards2.reads = 100
    await ns2["_viewer_cache_open"]()
    taken = ns2["_VIEWER_CACHE_DISK"]["taken"]
    boards2.gate = asyncio.Event()
    again = await asyncio.wait_for(_via(ns2, ask), 1.0)
    for _ in range(5):
        await asyncio.sleep(0)
    behind = [dict(e) for e in boards2.posted]
    boards2.gate.set()
    await _settled(ns2)
    clock2.t += 1
    before = len(boards2.posted)
    then = await _via(ns2, ask)
    then_asked = len(boards2.posted) - before
    bob = await _via(ns2, _board_ask("tok-bob", "schedulingBoard", {"period_id": "P1"}))
    return {"first": first, "names": names, "file": json.loads(text), "text": text, "modes": modes, "taken": taken,
            "again": again, "behind": behind, "then": then, "then_asked": then_asked, "bob": bob,
            "bob_asked": len(boards2.posted) - before - then_asked, "lines": lines2.said,
            "key": ns["_viewer_cache_key"]("schedulingBoard", ask)["key"]}


restart = asyncio.run(_restart())
check("a kept copy is written whole to the folder: one file named by its key, its session's hash and the envelope "
      "without the token — never the token",
      restart["names"] == [f"{restart['key']}.viewer.json"]
      and set(restart["file"]) == {"v", "key", "th", "read", "asked", "wall", "used", "withheld", "body"}
      and restart["file"]["withheld"] == 0
      and restart["file"]["th"] == _th("tok-ann") and "tok-ann" not in restart["text"]
      and json.loads(restart["file"]["body"]) == restart["first"], [restart["names"], restart["file"]])
check("…a 0600 file in a 0700 folder", restart["modes"] == {"folder": 0o700, "files": [0o600]}, restart["modes"])
check("after a restart the copy is taken up and answered at once, the engine held — the same answer as before",
      restart["taken"] == 1 and restart["again"] == restart["first"], [restart["taken"], restart["again"]])
check("…and read again behind it once, with the very envelope the viewer sent",
      restart["behind"] == [{"token": "tok-ann", "action": "schedulingBoard", "payload": {"period_id": "P1"}}],
      restart["behind"])
check("…whose answer is the next one, from memory, without the engine",
      restart["then"]["data"]["stamp"] == "read 101" and restart["then_asked"] == 0, restart["then"])
check("another viewer asking the same board after the restart is never answered from that copy: the engine is asked "
      "for its own cut",
      restart["bob"]["data"]["viewer"]["uid"] == "u-bob" and restart["bob_asked"] == 1, restart["bob"])
check("the restart said what it took up, nothing of whose",
      any("1 kept copies taken up from disk" in ln for ln in restart["lines"])
      and _told_nothing_personal(restart["lines"]), restart["lines"])


async def _restart_revoked() -> dict:
    packs = _packs_folder()
    ns, _boards, _clock, _rung, _lines, _s, _b = _disk_namespace(packs)
    folder = await ns["_viewer_cache_open"]()
    ask = _board_ask("tok-ann", "vehicleCalendarBoard")
    await _via(ns, ask)
    await ns["_viewer_cache_flush"](folder)
    kept = sorted(_on_disk(folder))
    ns2, boards2, _clock2, _rung2, _lines2, sessions2, _b2 = _disk_namespace(packs, _clock.t + 60)
    sessions2.discard("tok-ann")
    boards2.accepts.discard("tok-ann")
    await ns2["_viewer_cache_open"]()
    gone = await _via(ns2, ask)
    await ns2["_viewer_cache_flush"](folder)
    return {"kept": kept, "gone": gone, "asked": len(boards2.posted), "left": _on_disk(folder)}


revoked = asyncio.run(_restart_revoked())
check("after a restart a session that no longer stands gets nothing from its kept copy: the engine is asked and its "
      "401 reaches the browser, and the file goes",
      len(revoked["kept"]) == 1 and revoked["gone"]["status"] == 401 and revoked["asked"] == 1
      and revoked["left"] == {}, revoked)


async def _forged() -> dict:
    packs = _packs_folder()
    ns, _boards, clock, _rung, _lines, _s, _b = _disk_namespace(packs)
    folder = await ns["_viewer_cache_open"]()
    await _via(ns, _board_ask("tok-ann", "supportDeskList", {"completed": False}))
    await ns["_viewer_cache_flush"](folder)
    (good,) = _on_disk(folder)
    body = json.loads((folder / good).read_text(encoding="utf-8"))

    def plant(name: str, text: str) -> None:
        (folder / name).write_text(text, encoding="utf-8")

    def keyed(**over) -> None:
        b = {**body, **over}
        b["key"] = hashlib.sha256(f"{b['th']}\n{b['asked']}".encode()).hexdigest()
        plant(f"{b['key']}.viewer.json", json.dumps(b))

    plant(f"{'0' * 64}.viewer.json", json.dumps(body))
    plant(f"{'f' * 64}.viewer.json", json.dumps({**body, "key": "f" * 64}))
    keyed(asked=json.dumps({**json.loads(body["asked"]), "payload": {"completed": True}, "token": "tok-ann"},
                           sort_keys=True, separators=(",", ":")))
    keyed(asked=json.dumps({"action": "chatOverview"}, sort_keys=True, separators=(",", ":")), read="chatOverview")
    keyed(asked=json.dumps({**json.loads(body["asked"]), "payload": {"x": 1}}, sort_keys=True, separators=(",", ":")),
          body=json.dumps({"status": 503, "message": "busy"}))
    keyed(asked=json.dumps({**json.loads(body["asked"]), "payload": {"x": 2}}, sort_keys=True, separators=(",", ":")),
          wall=body["wall"] - ns["VIEWER_CACHE_MAX_AGE_S"] - 5)
    plant(f"{'1' * 64}.viewer.json", "{not json")
    plant(f".{'2' * 64}.viewer.json.abc_1234.tmp", "{}")
    plant("notes.txt", "not ours")
    planted = len(list(folder.iterdir()))
    ns2, *_rest2 = _disk_namespace(packs, clock.t + 5)
    await ns2["_viewer_cache_open"]()
    return {"planted": planted, "taken": ns2["_VIEWER_CACHE_DISK"]["taken"], "good": good,
            "left": sorted(p.name for p in folder.iterdir()), "held": list(ns2["_VIEWER_CACHE"])}


forged = asyncio.run(_forged())
check("on a start only a file under its own key, that key the hash of its session and envelope, a board kept, no "
      "credential in the envelope, inside its age and a clean 200 is taken up; every other kept file is removed, "
      "a torn write too, and what is not the cache's is left alone",
      forged["planted"] == 10 and forged["taken"] == 1 and forged["left"] == sorted([forged["good"], "notes.txt"])
      and forged["held"] == [forged["good"].split(".")[0]], forged)


async def _taken_off_disk() -> dict:
    packs = _packs_folder()
    ns, boards, clock, _rung, _lines, sessions, _b = _disk_namespace(packs)
    boards.accepts.add("tok-cy")
    sessions.add("tok-cy")
    folder = await ns["_viewer_cache_open"]()
    steps: dict[str, dict] = {}

    async def step(name: str, *raws: bytes) -> None:
        for raw in raws:
            clock.t += 1
            await _via(ns, raw)
        await ns["_viewer_cache_flush"](folder)
        counts: dict[str, int] = {}
        for th in _on_disk(folder).values():
            counts[th] = counts.get(th, 0) + 1
        steps[name] = {who: counts.get(_th(f"tok-{who}"), 0) for who in ("ann", "bob", "cy")}

    await step("kept", _board_ask("tok-ann", "schedulingBoard", {"period_id": "P1"}),
               _board_ask("tok-ann", "supportDeskList", {"completed": False}),
               _board_ask("tok-bob", "schedulingBoard", {"period_id": "P1"}), _board_ask("tok-cy", "vehicleCalendarBoard"))
    await step("written", _board_ask("tok-ann", "schedulingCellSave", {"house": "BM4060"}))
    await step("signed_out", _board_ask("tok-bob", "authLogout"))
    boards.accepts.discard("tok-cy")
    await step("refused", _board_ask("tok-cy", "supportDeskList", {"completed": False}))
    boards.accepts.add("tok-cy")
    await step("again", _board_ask("tok-ann", "schedulingBoard", {"period_id": "P1"}),
               _board_ask("tok-cy", "vehicleCalendarBoard"))
    await step("access", _board_ask("tok-ann", "appBadgeAccessSet", {"badge": "staff", "app": "scheduling"}))
    await step("aged", _board_ask("tok-cy", "supportDeskList", {"completed": False}))
    clock.t += ns["VIEWER_CACHE_MAX_AGE_S"] + 1
    expired = ns["_viewer_cache_expire"]()
    await step("expired")
    steps["expired"]["count"] = expired
    return steps


off = asyncio.run(_taken_off_disk())
check("the files follow the copies: a writer's own (its Scheduling write touches Support Requests too) go as the "
      "write leaves, a sign-out takes its session's, a 401 its session's, an App Control write every one, and the "
      "minute's ageing every copy past its age",
      off == {"kept": {"ann": 2, "bob": 1, "cy": 1}, "written": {"ann": 0, "bob": 1, "cy": 1},
              "signed_out": {"ann": 0, "bob": 0, "cy": 1}, "refused": {"ann": 0, "bob": 0, "cy": 0},
              "again": {"ann": 1, "bob": 0, "cy": 1}, "access": {"ann": 0, "bob": 0, "cy": 0},
              "aged": {"ann": 0, "bob": 0, "cy": 1}, "expired": {"ann": 0, "bob": 0, "cy": 0, "count": 1}}, off)


async def _ahead_on_ring() -> dict:
    ns, boards, clock, _rung, lines, sessions, _b = _cache_namespace()
    boards.accepts.add("tok-cy")
    sessions.add("tok-cy")
    stream = _TokenStream("tok-ann")
    ns["_event_subs"].add(stream)
    ann = _board_ask("tok-ann", "schedulingBoard", {"period_id": "P1"})
    cy = _board_ask("tok-cy", "schedulingBoard", {"period_id": "P1"})
    await _via(ns, ann)
    await _via(ns, cy)
    clock.t += 1
    before = len(boards.posted)
    await _via(ns, _board_ask("tok-bob", "schedulingCellSave", {"house": "BM4060"}))
    await _settled(ns)
    ahead = [dict(e) for e in boards.posted[before:] if e.get("action") == "schedulingBoard"]
    heard = list(stream.rung)
    clock.t += 1
    before = len(boards.posted)
    ann_after = await _via(ns, ann)
    ann_asked = len(boards.posted) - before
    cy_after = await _via(ns, cy)
    await _settled(ns)
    return {"ahead": ahead, "ann_after": ann_after, "ann_asked": ann_asked, "cy_after": cy_after,
            "cy_asked": len(boards.posted) - before - ann_asked, "heard": heard,
            "lines": [ln for ln in lines.said if ln.startswith("viewer cache:")]}


ring_ahead = asyncio.run(_ahead_on_ring())
check("a ring reads ahead the stale copy of a viewer whose stream is open, once, with its envelope and its stream's "
      "token; a viewer with no stream open is not read ahead",
      ring_ahead["ahead"] == [{"token": "tok-ann", "action": "schedulingBoard", "payload": {"period_id": "P1"}}],
      ring_ahead["ahead"])
check("…so that viewer's next look is the write, from memory: no engine call",
      ring_ahead["ann_after"]["data"]["edition"] == 2 and ring_ahead["ann_asked"] == 0, ring_ahead)
check("…the other's copy is answered at once from before the write and read again behind it, as ever",
      ring_ahead["cy_after"]["data"]["edition"] == 1 and ring_ahead["cy_asked"] == 1, ring_ahead)
check("…the read ahead that changed the board rings it once more, and says so with nothing of whose",
      ring_ahead["heard"] == ["scheduling", "support-desk", "scheduling"]
      and any("read again ahead of its viewer — changed, rung" in ln for ln in ring_ahead["lines"])
      and _told_nothing_personal(ring_ahead["lines"]), ring_ahead)


async def _ahead_behind_people() -> dict:
    ns, boards, clock, _rung, _lines, _s, _b = _cache_namespace()
    ns["_housekeeping_slots"] = asyncio.Semaphore(0)
    ns["_event_subs"].add(_TokenStream("tok-ann"))
    ann = _board_ask("tok-ann", "schedulingBoard", {"period_id": "P1"})
    await _via(ns, ann)
    clock.t += 1
    await _via(ns, _board_ask("tok-bob", "schedulingCellSave", {"house": "BM4060"}))
    waiting = len(ns["_VIEWER_CACHE_PREFILLING"])
    clock.t += 1
    before = len(boards.posted)
    seen = await asyncio.wait_for(_via(ns, ann), 1.0)
    for _ in range(50):
        await asyncio.sleep(0)
    while_held = len(boards.posted) - before
    ns["_housekeeping_slots"].release()
    await _settled(ns)
    return {"waiting": waiting, "seen": seen, "while_held": while_held, "after": len(boards.posted) - before,
            "prefilling": len(ns["_VIEWER_CACHE_PREFILLING"]), "inflight": len(ns["_VIEWER_CACHE_INFLIGHT"])}


people_first = asyncio.run(_ahead_behind_people())
check("a person never waits behind a read ahead: with every housekeeping ticket taken, the look is answered at once "
      "and its own refresh goes out on the person's lane",
      people_first["waiting"] == 1 and people_first["seen"]["data"]["edition"] == 1
      and people_first["while_held"] == 1, people_first)
check("…and the read ahead, once it has its ticket, finds the copy fresh and asks nothing: one read in all",
      people_first["after"] == 1 and people_first["prefilling"] == 0 and people_first["inflight"] == 0, people_first)


async def _ahead_bounded() -> dict:
    ns, boards, clock, _rung, _lines, _s, _b = _cache_namespace()
    ns["VIEWER_CACHE_PREFILL_MAX"] = 2
    ns["_event_subs"].add(_TokenStream("tok-ann"))
    for period in ("P1", "P2", "P3"):
        clock.t += 1
        await _via(ns, _board_ask("tok-ann", "schedulingBoard", {"period_id": period}))
    clock.t += 1
    before = len(boards.posted)
    await _via(ns, _board_ask("tok-bob", "schedulingCellSave", {"house": "BM4060"}))
    await _settled(ns)
    return sorted(e["payload"]["period_id"] for e in boards.posted[before:] if e.get("action") == "schedulingBoard")


check("reads ahead are bounded, the most recently looked at first",
      asyncio.run(_ahead_bounded()) == ["P2", "P3"])


async def _online_after_restart() -> dict:
    packs = _packs_folder()
    ns, _boards, clock, _rung, _lines, _s, _b = _disk_namespace(packs)
    folder = await ns["_viewer_cache_open"]()
    asks = (_board_ask("tok-ann", "schedulingBoard", {"period_id": "P1"}),
            _board_ask("tok-ann", "supportDeskList", {"completed": False}))
    for raw in asks:
        clock.t += 1
        await _via(ns, raw)
    await _via(ns, _board_ask("tok-bob", "vehicleCalendarBoard"))
    await ns["_viewer_cache_flush"](folder)
    snapshot = {p.name: p.read_bytes() for p in folder.iterdir()}
    ns2, boards2, clock2, _rung2, _lines2, _s2, _b2 = _disk_namespace(packs, clock.t + 40)
    await ns2["_viewer_cache_open"]()
    ns2["_event_subs"].add(_TokenStream("tok-ann"))
    ns2["_event_subs"].add(_TokenStream("tok-cy"))
    ns2["_viewer_cache_online"]("tok-cy")
    ns2["_viewer_cache_online"]("tok-ann")
    await _settled(ns2)
    ahead = sorted(e["action"] for e in boards2.posted)
    clock2.t += 1
    before = len(boards2.posted)
    for raw in asks:
        await _via(ns2, raw)
    looked = len(boards2.posted) - before
    await ns2["_viewer_cache_flush"](folder)
    # the same folder as the first stop left it, taken up again long after its viewer last looked
    for path in folder.iterdir():
        path.unlink()
    for name, data in snapshot.items():
        (folder / name).write_bytes(data)
    ns3, boards3, _clock3, _rung3, _lines3, _s3, _b3 = _disk_namespace(
        packs, clock.t + ns["VIEWER_CACHE_PREFILL_RECENT_S"] + 60)
    await ns3["_viewer_cache_open"]()
    ns3["_event_subs"].add(_TokenStream("tok-ann"))
    ns3["_viewer_cache_online"]("tok-ann")
    await _settled(ns3)
    return {"ahead": ahead, "looked": looked, "late_taken": ns3["_VIEWER_CACHE_DISK"]["taken"],
            "late_ahead": len(boards3.posted)}


online = asyncio.run(_online_after_restart())
check("after a restart a viewer's stream opening reads ahead every one of its copies taken up, and nobody else's",
      online["ahead"] == ["schedulingBoard", "supportDeskList"], online)
check("…so its screens' first looks are answered from memory, fresh", online["looked"] == 0, online)
check("…while a copy its viewer has not looked at for longer than the window is taken up but not read ahead",
      online["late_taken"] == 3 and online["late_ahead"] == 0, online)


async def _open_before_taken_up() -> dict:
    packs = _packs_folder()
    ns, _boards, clock, *_rest = _disk_namespace(packs)
    folder = await ns["_viewer_cache_open"]()
    await _via(ns, _board_ask("tok-ann", "supportDeskList", {"completed": False}))
    await ns["_viewer_cache_flush"](folder)
    ns2, boards2, *_rest2 = _disk_namespace(packs, clock.t + 40)
    # the browser is back before the start has read its folder
    ns2["_event_subs"].add(_TokenStream("tok-ann"))
    ns2["_viewer_cache_online"]("tok-ann")
    await _settled(ns2)
    early = len(boards2.posted)
    await ns2["_viewer_cache_open"]()
    await _settled(ns2)
    return {"early": early, "ahead": [e["action"] for e in boards2.posted]}


opened_early = asyncio.run(_open_before_taken_up())
check("a stream open before the start took the copies up has its own read ahead once they are",
      opened_early == {"early": 0, "ahead": ["supportDeskList"]}, opened_early)


async def _gone_as_it_leaves() -> dict:
    packs = _packs_folder()
    ns, _boards, clock, *_rest = _disk_namespace(packs)
    folder = await ns["_viewer_cache_open"]()
    for raw in (_board_ask("tok-ann", "schedulingBoard", {"period_id": "P1"}),
                _board_ask("tok-ann", "vehicleCalendarBoard"),
                _board_ask("tok-bob", "schedulingBoard", {"period_id": "P1"})):
        clock.t += 1
        await _via(ns, raw)
    await ns["_viewer_cache_flush"](folder)

    def count() -> dict:
        counts: dict[str, int] = {}
        for th in _on_disk(folder).values():
            counts[th] = counts.get(th, 0) + 1
        return {who: counts.get(_th(f"tok-{who}"), 0) for who in ("ann", "bob")}

    steps = {"kept": count()}
    clock.t += 1
    # no beat runs from here on: what is on disk is what a stop would leave
    ns["_viewer_cache_written"]("schedulingCellSave", _board_ask("tok-ann", "schedulingCellSave", {"house": "BM4060"}))
    steps["leaving"] = count()
    ns["_viewer_cache_written"]("authLogout", _board_ask("tok-bob", "authLogout"))
    steps["signed_out"] = count()
    snapshot = {p.name: p.read_bytes() for p in folder.iterdir()}
    ns["_viewer_cache_written"]("appBadgeAccessSet",
                                _board_ask("tok-ann", "appBadgeAccessSet", {"badge": "staff", "app": "scheduling"}))
    steps["access"] = count()
    for name, data in snapshot.items():
        (folder / name).write_bytes(data)
    ns2, *_rest2 = _disk_namespace(packs, clock.t + 30)
    await ns2["_viewer_cache_open"]()
    steps["taken_after_stop"] = ns2["_VIEWER_CACHE_DISK"]["taken"]
    steps["taken_reads"] = sorted(e["read"] for e in ns2["_VIEWER_CACHE"].values())
    return steps


leaves = asyncio.run(_gone_as_it_leaves())
check("a write's sender's files of the boards it changes, a sign-out's and an App Control write's every one are "
      "removed as they leave, before any beat: a stop right after leaves only what no write outdated",
      leaves == {"kept": {"ann": 2, "bob": 1}, "leaving": {"ann": 1, "bob": 1}, "signed_out": {"ann": 1, "bob": 0},
                 "access": {"ann": 0, "bob": 0}, "taken_after_stop": 1, "taken_reads": ["vehicleCalendarBoard"]},
      leaves)


async def _refused_before_taken_up() -> dict:
    packs = _packs_folder()
    ns, _boards, clock, *_rest = _disk_namespace(packs)
    folder = await ns["_viewer_cache_open"]()
    ann = _board_ask("tok-ann", "supportDeskList", {"completed": False})
    bob = _board_ask("tok-bob", "schedulingBoard", {"period_id": "P1"})
    bob_vans = _board_ask("tok-bob", "vehicleCalendarBoard")
    for raw in (ann, bob, bob_vans):
        await _via(ns, raw)
    await ns["_viewer_cache_flush"](folder)
    kept = len(_on_disk(folder))
    # the relay starts again and is asked before it has read its folder: one board is closed to ann now, and bob's
    # session is refused by the engine (on one board) while the relay's own door still vouches for it
    ns2, boards2, clock2, *_rest2 = _disk_namespace(packs, clock.t + 40)
    boards2.down["supportDeskList"] = 403
    boards2.accepts.discard("tok-bob")
    early = [(await _via(ns2, ann))["status"], (await _via(ns2, bob))["status"]]
    await ns2["_viewer_cache_open"]()
    await ns2["_viewer_cache_flush"](folder)
    left = len(_on_disk(folder))
    clock2.t += 1
    before = len(boards2.posted)
    later = [(await _via(ns2, raw))["status"] for raw in (ann, bob, bob_vans)]
    return {"kept": kept, "early": early, "taken": ns2["_VIEWER_CACHE_DISK"]["taken"], "left": left,
            "later": later, "asked": len(boards2.posted) - before}


refused_early = asyncio.run(_refused_before_taken_up())
check("a refusal answered after a restart but before the folder is read is never undone by it: the refused copy and "
      "every copy of the 401'd session are not taken up, their files go, and the next looks ask the engine",
      refused_early == {"kept": 3, "early": [403, 401], "taken": 0, "left": 0, "later": [403, 401, 401],
                        "asked": 3}, refused_early)


async def _written_while_removed() -> dict:
    packs = _packs_folder()
    ns, _boards, clock, *_rest = _disk_namespace(packs)
    folder = await ns["_viewer_cache_open"]()
    ask = _board_ask("tok-ann", "schedulingBoard", {"period_id": "P1"})
    await _via(ns, ask)
    clock.t += 1
    # a beat takes its job, the write leaves and lands, then the beat writes
    jobs = ns["_viewer_cache_take_dirty"]()
    await _via(ns, _board_ask("tok-ann", "schedulingCellSave", {"house": "BM4060"}))
    ns["_viewer_cache_disk_write"](folder, jobs)
    after_beat = len(_on_disk(folder))
    # a beat that won that race anyway: its file back, as a stop would leave it
    (name, job), = jobs
    ns["_app_pack_write_file"](folder, name, ns["_viewer_cache_at_rest"](job))
    planted = len(_on_disk(folder))
    marks = json.loads((folder / "marks.viewer.json").read_text(encoding="utf-8"))
    ns2, boards2, *_rest2 = _disk_namespace(packs, clock.t + 30)
    await ns2["_viewer_cache_open"]()
    taken = ns2["_VIEWER_CACHE_DISK"]["taken"]
    seen = await _via(ns2, ask)
    return {"after_beat": after_beat, "planted": planted, "marked": f"{_th('tok-ann')}|schedulingBoard" in marks["marks"],
            "taken": taken, "left": len(_on_disk(folder)), "asked": len(boards2.posted),
            "stamp": seen["data"]["stamp"]}


raced = asyncio.run(_written_while_removed())
check("a beat writing a copy a write removes at that moment removes it again; and a file left from before a write "
      "anyway is refused after a restart by the marks kept beside it: the writer's look asks the engine",
      raced == {"after_beat": 0, "planted": 1, "marked": True, "taken": 0, "left": 0, "asked": 1, "stamp": "read 1"},
      raced)


async def _removal_asked_again() -> dict:
    packs = _packs_folder()
    ns, *_rest = _disk_namespace(packs)
    folder = await ns["_viewer_cache_open"]()
    await _via(ns, _board_ask("tok-ann", "vehicleCalendarBoard"))
    (key,) = list(ns["_VIEWER_CACHE"])
    ns["_viewer_cache_drop"](key)
    ns["_viewer_cache_disk_write"] = lambda _folder, jobs: [name for name, body in jobs if body is None]
    await ns["_viewer_cache_flush"](folder)
    return {"again": sorted(ns["_VIEWER_CACHE_DIRTY"]) == [key]}


check("a file whose removal failed is asked again at the next beat",
      asyncio.run(_removal_asked_again()) == {"again": True})


_WORDS = ("my sister's wedding", "asked by phone", "a fever", "go rest", "hunter2")


async def _withheld_at_rest() -> dict:
    packs = _packs_folder()
    ns, boards, clock, *_rest = _disk_namespace(packs)
    boards.carry = {
        "schedulingBoard": {"note": "The hours are hidden.",
                            "mine": [{"id": "SF1", "kind": "time_off", "reason": "my sister's wedding",
                                      "note": "asked by phone", "why": "", "seats": [{"note": "", "why": "covered"}]}],
                            "waiting": [{"id": "I1", "title": "Time off to decide",
                                         "body": "\"my sister's wedding\" — Approve to put every shift up."}]},
        "supportDeskList": {"note": "Only the requests redirected to you are shown.",
                            "rows": [{"ref": "R1", "password": "hunter2",
                                      "details": [{"label": "House", "value": "BM4060"},
                                                  {"label": "Reason", "value": "a fever"}],
                                      "history": [{"verdict": "approved", "note": "go rest"}]}]},
        "vehicleCalendarBoard": {"trips": [{"id": "T1", "purpose": "dentist", "note": "the wheelchair van"}]}}
    folder = await ns["_viewer_cache_open"]()
    asks = {read: _board_ask("tok-ann", read, payload) for read, payload in (
        ("schedulingBoard", {"period_id": "P1"}), ("supportDeskList", {"completed": False}),
        ("vehicleCalendarBoard", None))}
    first = {read: await _via(ns, raw) for read, raw in asks.items()}
    await ns["_viewer_cache_flush"](folder)
    files = {}
    for path in folder.iterdir():
        kept = json.loads(path.read_text(encoding="utf-8"))
        files[kept["read"]] = {"withheld": kept["withheld"], "data": json.loads(kept["body"])["data"],
                               "text": path.read_text(encoding="utf-8")}
    ns2, boards2, clock2, rung2, *_rest2 = _disk_namespace(packs, clock.t + 40)
    boards2.carry = boards.carry
    await ns2["_viewer_cache_open"]()
    again = await _via(ns2, asks["supportDeskList"])
    await _settled(ns2)
    clock2.t += 1
    then = await _via(ns2, asks["supportDeskList"])
    return {"first": first, "files": files, "again": again, "rung": list(rung2), "then": then,
            "asked": [e["action"] for e in boards2.posted]}


rest = asyncio.run(_withheld_at_rest())
_sb, _sd, _vc = (rest["files"][r]["data"] for r in ("schedulingBoard", "supportDeskList", "vehicleCalendarBoard"))
check("memory answers every word: the copy at rest is all that is withheld",
      rest["first"]["schedulingBoard"]["data"]["mine"][0]["reason"] == "my sister's wedding"
      and rest["first"]["supportDeskList"]["data"]["rows"][0]["details"][1]["value"] == "a fever", rest["first"])
check("on disk the words about an absence are marked private (its reason, the notes beside it, an item body quoting "
      "it, a Reason detail), the redaction rule withholds what it always does, and nothing else changes: the top "
      "notes, the titles, the other details, a board of no absences",
      _sb["mine"][0]["reason"] == _sb["mine"][0]["note"] == "[withheld: private]" and _sb["mine"][0]["seats"][0]
      == {"note": "", "why": "covered"} and _sb["note"] == "The hours are hidden."
      and _sb["waiting"] == [{"id": "I1", "title": "Time off to decide", "body": "[withheld: private]"}]
      and _sd["rows"][0]["details"] == [{"label": "House", "value": "BM4060"},
                                        {"label": "Reason", "value": "[withheld: private]"}]
      and _sd["rows"][0]["history"][0] == {"verdict": "approved", "note": "[withheld: private]"}
      and _sd["rows"][0]["password"] == "[withheld: secret]"
      and _sd["note"] == "Only the requests redirected to you are shown."
      and _vc["trips"] == [{"id": "T1", "purpose": "dentist", "note": "the wheelchair van"}]
      and [rest["files"][r]["withheld"] for r in ("schedulingBoard", "supportDeskList", "vehicleCalendarBoard")]
      == [3, 3, 0], rest["files"])
check("…not one of those words is in any file",
      not any(w in f["text"] for f in rest["files"].values() for w in _WORDS))
check("after a restart the copy at rest is answered at once with its marks, read again behind it, the board rung, "
      "and the next look has every word back from memory",
      rest["again"]["data"]["rows"][0]["details"][1]["value"] == "[withheld: private]"
      and rest["asked"] == ["supportDeskList"] and rest["rung"] == ["support-desk"]
      and rest["then"]["data"]["rows"][0]["details"][1]["value"] == "a fever"
      and rest["then"]["data"]["rows"][0]["password"] == "hunter2", rest)


async def _swept_when_not_in_use() -> dict:
    out = {}
    names = (f"{'a' * 64}.viewer.json", "marks.viewer.json", f".{'b' * 64}.viewer.json.abc_123.tmp",
             ".marks.viewer.json.x_1.tmp", "notes.txt")
    for case in ("unset", "moved", "served"):
        packs = _packs_folder()
        default = (packs.parent / "served" if case == "served" else packs) / "viewer"
        default.mkdir(mode=0o700)
        for name in names:
            (default / name).write_text("{}", encoding="utf-8")
        ns, _boards, _clock, _rung, lines, *_rest = _disk_namespace(packs)
        ns["APP_PACK_DEFAULT_DIR"] = str(default.parent)
        ns["VIEWER_CACHE_DIR"] = str(packs.parent / "elsewhere") if case == "moved" else ""
        await ns["_viewer_cache_open"]()
        out[case] = sorted(p.name for p in default.iterdir())
        out[case + "_said"] = [ln for ln in lines.said if "not in use" in ln]
    return out


swept = asyncio.run(_swept_when_not_in_use())
check("with keeping turned off or moved, the copies, marks and torn writes the default folder still holds are "
      "removed, and said; what is not the cache's is left; a default folder in a served tree is never swept",
      swept["unset"] == swept["moved"] == ["notes.txt"] and len(swept["served"]) == 5
      and swept["unset_said"] == swept["moved_said"] == ["viewer cache: 4 file(s) left in a folder not in use, removed"]
      and swept["served_said"] == [], swept)


async def _folders() -> dict:
    packs = _packs_folder()
    out = {}
    for name, where in (("served", packs.parent / "served" / "viewer"), ("missing", packs / "gone" / "viewer"),
                        ("unset", "")):
        ns, *_rest = _disk_namespace(packs)
        ns["VIEWER_CACHE_DIR"] = str(where)
        folder = await ns["_viewer_cache_open"]()
        out[name] = (folder, ns["_VIEWER_CACHE_DISK"]["state"])
    out["made"] = sorted(p.name for p in packs.iterdir()) + sorted(p.name for p in (packs.parent / "served").iterdir())
    return out


folders = asyncio.run(_folders())
check("the copies are never kept in the served tree, nor in a volume that is not there (nothing is made), nor with "
      "the folder unset: memory alone",
      folders["served"] == (None, "inside the served snapshot tree") and folders["missing"] == (None, "missing")
      and folders["unset"][0] is None and folders["made"] == [], folders)

dir_src = ast.get_source_segment(SVC, next(n for n in SVC_TREE.body if _node_label(n) == "VIEWER_CACHE_DIR")) or ""
for packs_dir, wanted in (("/srv/app-packs", "/srv/app-packs/viewer"), ("", "")):
    dir_ns = {"os": os, "APP_PACK_DIR": packs_dir}
    exec(compile(dir_src, "snapshot_service.py", "exec"), dir_ns)  # noqa: S102 - the relay's own source
    check(f"the folder sits inside the packs' own volume ({packs_dir or 'packs held in memory alone'})",
          dir_ns["VIEWER_CACHE_DIR"] == wanted, dir_ns["VIEWER_CACHE_DIR"])


def _packs_leave_viewer() -> dict:
    packs = _packs_folder()
    viewer = packs / "viewer"
    viewer.mkdir(mode=0o700)
    (viewer / f"{'a' * 64}.viewer.json").write_text("{}", encoding="utf-8")
    elsewhere = packs.parent / "elsewhere"
    elsewhere.mkdir()
    ns = {"os": os, "re": _re, "json": json, "time": _time, "Path": Path, "log": _Log(), "_APP_PACKS": {},
          "APP_PACK_DIR": str(packs), "APP_PACK_DEFAULT_DIR": str(packs),
          "OUT_DIR": str(packs.parent / "served"), "BUNDLE_DIR": str(packs.parent / "served")}
    _svc_load(ns, "_APP_PACK_FILE_RE", "_APP_PACK_MARK_RE", "_APP_PACK_TEMP_RE", "_app_pack_dir_state",
              "_app_pack_dir", "_app_pack_from_disk", "_app_pack_disk_read", "_app_pack_purge_unused")
    found, drop = ns["_app_pack_disk_read"](_time.time())
    ns["APP_PACK_DIR"] = str(elsewhere)
    swept = ns["_app_pack_purge_unused"]()
    return {"found": found, "drop": drop, "swept": swept, "left": sorted(p.name for p in viewer.iterdir())}


leave = _packs_leave_viewer()
check("the packs' own take-up and sweep leave the viewer folder inside their volume alone",
      leave == {"found": [], "drop": [], "swept": 0, "left": [f"{'a' * 64}.viewer.json"]}, leave)

events_src = ast.get_source_segment(SVC, _svc_node("events")) or ""
start_src = ast.get_source_segment(SVC, _svc_node("_start")) or ""
prefill_src = ast.get_source_segment(SVC, _svc_node("_viewer_cache_prefill")) or ""
check("the wiring: a stream that opens reads its viewer's copies ahead once it is listed; the start takes the copies "
      "up; a read ahead holds a housekeeping ticket and a slot of its own before it asks, and goes through the proxy",
      -1 < events_src.find("_event_subs.add(queue)") < events_src.find("_viewer_cache_online(token)")
      and "_keep_task(_viewer_cache_start())" in start_src
      and "async with _VIEWER_CACHE_PREFILLS, _housekeeping_slots:" in prefill_src
      and "ahead=True" in prefill_src and ".post(" not in prefill_src)


print("\nTHE LANE — against a real database")
lane = _lane_in_container()
if lane is None:
    print("  (skipped — no docker here to reach a relay container)")
    print("  NOTE: the pure half above still ran; the lane half did not.")
elif lane.get("crash"):
    check("the lane ran to its end", False, lane.get("trace") or lane["crash"])
else:
    check("every table the lane reads resolves in its own schema before the first read, never public",
          lane["owned"]["lane"] and all(str(s).startswith(("house_calendars_test_", "hub_test_house_calendars_"))
                                        for s in lane["owned"]["lane"].values()), lane["owned"])
    check("two first drafts at once on a database with no edits table both land, and both "
          "are written down — creating the table cannot fail one of them",
          lane["first_writes"] == ["ok", "ok"] and lane["first_edits"] == 2,
          [lane["first_writes"], lane["first_edits"]])
    check("…and the tables those first writers made are the lane's, not public's",
          sorted(lane["first_writers_made"]) == ["asa_cal_builder_house_draft", "asa_house_calendar_edits"]
          and all(str(s).startswith(("house_calendars_test_", "hub_test_house_calendars_")) for s in lane["first_writers_made"].values()),
          lane["first_writers_made"])
    check("BM's two OPEN rows come back as OPEN and OPEN 2, both marked as nobody",
          lane["rows"][:2] == [["OPEN", True], ["OPEN 2", True]]
          and lane["rows"][2] == ["Ann Roe", False], lane["rows"])
    check("every open shift on the grid is one key — three shifts, three keys, no twins",
          sorted(lane["open_keys"]) == sorted(lane["expect_keys"]), lane["open_keys"])
    check("yesterday's open shift is marked started, the ones ahead are not",
          lane["open_started"] == lane["expect_started"], lane["open_started"])
    check("OPEN 2 holds no hours as a person in the estate",
          lane["estate_open_2_person"] is False)
    check("the second OPEN row's shift is claimable — it used to be 'no longer on the calendar'",
          lane["claim_second_row"] == ["allowed", "Cy Far"], lane["claim_second_row"])
    check("and the first row's EMPTY day is not a shift at all",
          lane["claim_first_row_empty_day"][0] == "lookup", lane["claim_first_row_empty_day"])
    check("the pool holds one row per OPEN cell, keyed by its row's own name",
          [r[0] for r in lane["pool_rows"]].count("OPEN 2") == 1, lane["pool_rows"])

    check("an open shift the workbook holds is never typed over or cleared",
          lane["type_over_open"][0] == "open_shift", lane["type_over_open"])
    check("an EMPTY cell on an OPEN row may be drafted — a new open shift put up",
          lane["type_empty_open"] == ["allowed", True], lane["type_empty_open"])
    check("a cell the grid could never show is refused, not drafted",
          lane["undrawn_day"][0] == "value" and lane["not_a_row"][0] == "value",
          [lane["undrawn_day"], lane["not_a_row"]])
    check("an edit is kept as a draft",
          lane["after_edit"] and lane["after_edit"][0][2] == "8A-2P", lane["after_edit"])
    check("and an edit BACK to what the workbook says drops it — nothing left behind",
          lane["after_edit_back"] == [], lane["after_edit_back"])
    check("both changes are written down, with what the cell said before",
          [e[2:4] for e in lane["edits_written"]] == [["8A-4P", "8A-2P"], ["8A-2P", "8A-4P"]],
          lane["edits_written"])

    check("a plain drop onto a shift is REFUSED with what is there",
          lane["plain_onto_occupied"] == ["occupied", "8A-4P"], lane["plain_onto_occupied"])
    check("and nothing was drafted by the refusal",
          lane["after_refusal"] == [], lane["after_refusal"])
    check("nothing is dropped onto an OPEN row, and nothing is dragged off one",
          lane["onto_open"][0] == "open_shift" and lane["off_open"][0] == "open_shift",
          [lane["onto_open"], lane["off_open"]])
    check("an empty cell cannot be 'moved' onto a shift — that is clearing it by another name",
          lane["empty_source"][0] == "value", lane["empty_source"])
    check("with replace, the drop lands and says what it replaced",
          lane["replace"] == [True, "8A-4P"], lane["replace"])
    check("and what was replaced is written down beside the move",
          any(e[2] == "8A-4P" and e[3] == "2P-10P" and e[4] == "replace"
              for e in lane["replace_recorded"]), lane["replace_recorded"])
    check("Undo puts both cells back, leaving no draft",
          lane["restored"] == [], lane["restored"])
    check("a move and a move back leave nothing behind (the 38TH case)",
          lane["move_and_back"] == [], lane["move_and_back"])
    check("Shift-drop still swaps, and a swap replaces nothing",
          lane["swap"][0] is True and lane["swap"][1] is False
          and sorted(d[2] for d in lane["swap"][2]) == ["2P-10P", "8A-4P"], lane["swap"])

    check("a shift that has already started is not taken or assigned from the calendar",
          lane["claim_started"] == ["refused", "started"], lane["claim_started"])
    check("nor is a shift given to a name that is on no house's grid",
          lane["claim_no_grid"] == ["refused", "not_on_a_grid"], lane["claim_no_grid"])
    check("a handoff reads the cell as it is NOW — an old override, not the base under it",
          lane["handoff_value"] == "2P-10P", lane["handoff_value"])
    mark = lane.get("mark") or {}
    check("a cell published from the Builder carries its mark on the live grid: by whom, which road, "
          "and that the copy is still catching up",
          mark.get("by") == "Tester" and mark.get("via") == "publish" and mark.get("state") == "pending"
          and lane.get("mark_why") == "", [mark, lane.get("mark_why")])


print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
