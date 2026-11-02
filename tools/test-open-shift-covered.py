#!/usr/bin/env python3
"""The "covered" follow-up's relay half; the Apps Script half is its own self-test section."""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
REPO = HERE.parent.parent
SERVER = REPO / "server"
GS = REPO / "apps-script"
CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")
import lane_schema  # noqa: E402 — beside this file
sys.path.insert(0, str(SERVER))

results = {"ok": 0, "failed": []}


def check(name, cond, detail=None):
    if cond:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {detail}")


import open_shift_covered as osc  # noqa: E402

UTC = timezone.utc
NOW = datetime(2026, 9, 22, 16, 0, tzinfo=UTC)
NIGHT = datetime(2026, 9, 23, 3, 0, tzinfo=UTC)

print("\nthe clock — when a fill is offered to the door")


def row(**over):
    base = {"state": "", "noted_at": NOW - timedelta(minutes=1), "offered_at": None,
            "failures": 0, "waits": 0, "shift_end": NOW + timedelta(hours=24)}
    base.update(over)
    return base


check("a fill never offered is offered at once — at noon and inside the quiet window alike",
      osc.due(row(), NOW, quiet=False) == "offer" and osc.due(row(), NIGHT, quiet=True) == "offer")
check("`refused_quiet` waits while the window lasts and is offered the moment it ends",
      osc.due(row(state="refused_quiet"), NIGHT, quiet=True) == "wait"
      and osc.due(row(state="refused_quiet"), NOW, quiet=False) == "offer")
check("`not_yet` waits its retry, is offered after it, and gives up once the call-off never came",
      osc.due(row(state="not_yet", offered_at=NOW - timedelta(seconds=30)), NOW, quiet=False) == "wait"
      and osc.due(row(state="not_yet", offered_at=NOW - timedelta(seconds=osc.RETRY_S + 1)), NOW,
                  quiet=False) == "offer"
      and osc.due(row(state="not_yet", waits=osc.NOT_YET_OFFERS,
                      offered_at=NOW - timedelta(seconds=osc.RETRY_S + 1)), NOW, quiet=False) == "gave_up")
check("and its patience is counted in answers, not measured from the note — a fill noted at three in the "
      "morning and first asked at eight has used none of it",
      osc.due(row(state="not_yet", waits=1, noted_at=NOW - timedelta(hours=9),
                  offered_at=NOW - timedelta(seconds=osc.RETRY_S + 1)), NOW, quiet=False) == "offer")
check("`failed` is offered again a few times and then gives up",
      osc.due(row(state="failed", failures=1, offered_at=NOW - timedelta(seconds=osc.RETRY_S + 1)), NOW,
              quiet=False) == "offer"
      and osc.due(row(state="failed", failures=osc.FAILED_OFFERS), NOW, quiet=False) == "gave_up")
check("`dial_unknown` is asked again after its own short wait",
      osc.due(row(state="dial_unknown", offered_at=NOW - timedelta(seconds=10)), NOW, quiet=False) == "wait"
      and osc.due(row(state="dial_unknown", offered_at=NOW - timedelta(seconds=osc.DIAL_RETRY_S + 1)), NOW,
                  quiet=False) == "offer")
check("a final answer is never offered again",
      all(osc.due(row(state=s), NOW, quiet=False) == "wait" for s in osc.FINAL))
check("a shift an hour over with no final answer is closed as stale, never offered",
      osc.due(row(shift_end=NOW - timedelta(hours=2)), NOW, quiet=False) == "stale"
      and osc.due(row(state="not_yet", shift_end=NOW - timedelta(hours=2)), NOW, quiet=False) == "stale")

print("\nthe row the door reads")

start = datetime(2026, 9, 22, 20, 0, tzinfo=UTC)
p = osc.payload({"location": "CAN - JH - ABD2704", "open_row": "Zed Caller", "col_iso": "2026-09-22",
                 "value": "4P-12A", "shift_start": start, "shift_end": start + timedelta(hours=8),
                 "filled_by": "Cy Far", "filled_how": "approved", "decided_by": "Mary Manager",
                 "filled_at": NOW, "reason": "she is at the hospital"},
                {"ABD2704": {"name": "JH home", "address": "2407 Harrison Ave"}})
check("the payload carries the house the way the blast names it, its street and the start in New York",
      p["house_name"] == "JH home" and p["address"] == "2407 Harrison Ave" and p["start_hm"] == "16:00"
      and p["house"] == "ABD2704", p)
check("the id is the cell, and the caller's roster name rides only to FIND the call-off row",
      p["id"] == "CAN - JH - ABD2704|Zed Caller|2026-09-22" and p["called_off_by"] == "Zed Caller", p)
check("the reason never leaves the relay — there is no field for it",
      "reason" not in p and "hospital" not in json.dumps(p), p)
check("a directory that does not know the house costs its name, never the row",
      osc.payload({"location": "CAN - XX - ZZ9999", "open_row": "A", "col_iso": "2026-09-22"}, {})["house_name"] == "")

print("\nthe hook never undoes a decision")
check("an OPEN row from a published schedule is not noted — no URGENT OPEN SHIFT went out about it",
      osc.note_filled("dsn", {"kind": "open_shift"}, person="Ann")["noted"] is False)
held = osc._connect
try:
    osc._connect = lambda dsn: (_ for _ in ()).throw(RuntimeError("no database"))
    said = osc.note_filled("dsn", {"kind": "call_off", "location": "L", "open_row": "R", "col_iso": "D"},
                           person="Ann")
finally:
    osc._connect = held
check("a ledger that cannot be written answers, and never raises into the decision",
      said["noted"] is False and "could not be written" in said["why"], said)

print("\nthe words the two sides share")
gs = (GS / "CommOpenShiftCovered.gs").read_text(encoding="utf-8")
door_states = set(re.findall(r"done\('([a-z_]+)'", gs)) | set(re.findall(r"state: '([a-z_]+)'", gs))
door_states |= {"told", "rehearsed"}          # commCallOffEnding_ sets these through a variable
unknown = sorted(s for s in door_states if s not in osc.FINAL and s not in osc.NOT_NOW)
check("every answer the door gives is one the ledger knows, final or not now",
      len(door_states) >= 12 and not unknown, {"unknown": unknown, "door": sorted(door_states)})
check("the ledger's own endings are not the door's to give",
      "gave_up" in osc.FINAL and "gave_up" not in door_states)
svc = (GS / "ServiceIdentity.gs").read_text(encoding="utf-8")
guardian = (GS / "Guardian.gs").read_text(encoding="utf-8")
relay = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
check("one action on every side: the door, the relay's post, the service list and the Guardian's event mirror",
      osc.DOOR == "openShiftCovered"
      and "HUB_ACTIONS.openShiftCovered = function" in gs
      and '"action": "openShiftCovered"' in relay
      and re.search(r"'openShiftCovered'[,\]]", svc) is not None
      and re.search(r"'openShiftCovered'[,\]]", guardian) is not None)
check("the relay's minute beat hands the fills over right after the Requests notices",
      "await _shift_requests_post()\n        await _open_shift_covered_post()" in relay)
post = relay[relay.index("async def _open_shift_covered_post"):]
post = post[:post.index("\nasync def ", 10)]
check("the post notes the claims road first, then offers, then writes down only what the door said",
      post.index("open_shift_covered.note_from_pool") < post.index("open_shift_covered.owed")
      < post.index("_post_exec(") < post.index("open_shift_covered.mark"), post[:200])
check("a door that could not be reached is written down as a failure for every row offered",
      "failure=failure" in post and "the door could not be reached" in post)
sr = (SERVER / "shift_requests.py").read_text(encoding="utf-8")
decide = sr[sr.index("def decide("):sr.index("def _record_training(")]
check("the hook is ONE call in decide(), after the decision's own commit",
      decide.count("open_shift_covered.note_filled(") == 1
      and decide.index("conn.commit()") < decide.index("open_shift_covered.note_filled(")
      and sr.count("open_shift_covered.note_filled(") == 1)


LANE = '''
import json, os, sys
from datetime import datetime, timedelta, timezone
sys.path.insert(0, LANE_DIR)
import psycopg2, psycopg2.extras
import lane_schema
import house_cal_live, shift_handoff
import calendar_builder_houses as cbh
import shift_requests as sr
import open_shift_covered as osc

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
ROOMS = lane_schema.Rooms(DSN, "open-shift-covered")
SCHEMA = ROOMS.name()
OUT = {}
H1 = "CAN - 48TH (B) - ABD1711"
OHIO = sr.OHIO
today = datetime.now(OHIO).date()
D1 = (today + timedelta(days=1)).isoformat()
OLD = (today - timedelta(days=3)).isoformat()
ISOS = [OLD, D1]
NIGHT = datetime.fromisoformat(D1 + "T03:00:00").replace(tzinfo=OHIO)
NOON = datetime.fromisoformat(D1 + "T12:00:00").replace(tzinfo=OHIO)
# the IST settings as a read that landed, holding the shipped values
import ist_config
ist_config.pin(dict(ist_config.SHIPPED))
EVERY = {"done": 1, "owed": 0, "clients": [], "owed_for": []}
NAMES = ("Zed Caller", "Cy Far", "Dee Way", "Ann Roe")
sr.ist_index = lambda dsn, **k: {
    "readable": True, "why": "", "rows": 0, "source": "test",
    "by_person": {sr.fold(n): {"ABD1711": dict(EVERY)} for n in NAMES}}


def grid(rows):
    return {"cols": [{"iso": i} for i in ISOS],
            "rows": [{"employee": e, "cells": [{"text": t} for t in cs]} for e, cs in rows]}


ROOMS.make()
T = ROOMS.path(SCHEMA)


def ledger():
    with psycopg2.connect(T) as c, c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT open_row, col_iso, state, noted_by, filled_by, filled_how, failures, "
                    "said_at IS NOT NULL AS said FROM asa_open_shift_covered ORDER BY open_row")
        return [dict(r) for r in cur.fetchall()]


def pool_row(open_row, iso, value, kind, filled_by="", closed_ago=None, ends=None):
    span = sr.span_of(iso, value)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(
            "INSERT INTO asa_shift_pool (location, open_row, col_iso, kind, value, opened_at, shift_start, "
            "shift_end, called_off_by, reason, ref, filled_by, closed_at) "
            "VALUES (%s,%s,%s,%s,%s,now(),%s,%s,%s,%s,%s,%s,%s)",
            (H1, open_row, iso, kind, value, span[0], ends or span[1],
             open_row if kind == sr.KIND_CALLOFF else "", "flu", sr.ref_of(H1, open_row, iso), filled_by,
             (datetime.now(timezone.utc) - closed_ago) if closed_ago is not None else None))
        c.commit()


try:
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("CREATE TABLE asa_house_calendar_live (location TEXT PRIMARY KEY, "
                    "grid JSONB, updated_at TIMESTAMPTZ DEFAULT now())")
        cur.execute(house_cal_live.OVERRIDES_DDL)
        cur.execute(house_cal_live.CLAIMS_DDL)
        cur.execute(shift_handoff.HANDOFFS_DDL)
        cur.execute(shift_handoff.OPEN_INDEX_DDL)
        for stmt in sr.DDL:
            cur.execute(stmt)
        H1_GRID = grid([
            ("OPEN", ["", "8A-4P"]),
            ("Zed Caller", ["8A-4P", "4P-12A"]),
            ("Cy Far", ["8A-4P", ""]),
            ("Ann Roe", ["8A-4P", ""]),
        ])
        cur.execute("INSERT INTO asa_house_calendar_live (location, grid) VALUES (%s,%s)",
                    (H1, psycopg2.extras.Json(H1_GRID)))
        c.commit()
    # every table the code reads is the lane's before its first read, the ledger included
    OUT["owned"] = lane_schema.own_shift_lane(T, SCHEMA, LANE_DIR)
    # a stand-in workbook: a test schema never reaches the live one
    cbh.use_workbook(cbh.MemoryWorkbook.from_grids({H1: H1_GRID}))
    sr.forget_estate()

    # ── THE HOOK: a call-off decided is noted, once; an OPEN row is not ──
    pool_row("Zed Caller", D1, "4P-12A", sr.KIND_CALLOFF)
    pool_row("OPEN", D1, "8A-4P", sr.KIND_OPEN)
    # the house manager decides once applications have closed, never inside them
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_pool SET opened_at = now() - interval '6 hours'")
        c.commit()
    sr.decide(T, location=H1, open_row="Zed Caller", col_iso=D1, person="Cy Far", by="Mary Manager")
    sr.forget_estate()
    sr.decide(T, location=H1, open_row="OPEN", col_iso=D1, person="Ann Roe", by="Mary Manager")
    OUT["after_decide"] = ledger()
    again = osc.note_filled(T, {"kind": sr.KIND_CALLOFF, "location": H1, "open_row": "Zed Caller",
                                "col_iso": D1}, person="Cy Far")
    OUT["noted_again"] = again["noted"]
    OUT["rows_after_again"] = len(ledger())

    # ── THE CLOCK, against the table ──
    offer = osc.owed(T, now=NIGHT)
    OUT["night_offer"] = [(o["called_off_by"], o["start_hm"], o["house"]) for o in offer]
    osc.mark(T, offer, {"results": [{"id": o["id"], "state": "refused_quiet", "why": "night"} for o in offer]},
             now=NIGHT)
    OUT["night_again"] = len(osc.owed(T, now=NIGHT + timedelta(minutes=1)))
    morning = osc.owed(T, now=NOON)
    OUT["morning"] = len(morning)
    osc.mark(T, morning, {"results": [{"id": o["id"], "state": "not_yet", "why": "no call-off yet"}
                                      for o in morning]}, now=NOON)
    OUT["not_yet_soon"] = len(osc.owed(T, now=NOON + timedelta(minutes=1)))
    OUT["not_yet_later"] = len(osc.owed(T, now=NOON + timedelta(seconds=osc.RETRY_S + 1)))
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_open_shift_covered SET waits = %s", (osc.NOT_YET_OFFERS,))
        c.commit()
    OUT["gave_up_offer"] = len(osc.owed(T, now=NOON + timedelta(seconds=osc.RETRY_S + 2)))
    OUT["gave_up_state"] = [r["state"] for r in ledger()]

    # the net: a fill after the ledger's birth is noted, an older one is not
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_open_shift_covered_birth SET born = now() - interval '10 minutes'")
        c.commit()
    pool_row("Dee Way", D1, "8A-4P", sr.KIND_CALLOFF, filled_by="Ann Roe", closed_ago=timedelta(minutes=1))
    pool_row("Old Timer", D1, "8A-4P", sr.KIND_CALLOFF, filled_by="Ann Roe", closed_ago=timedelta(days=2))
    pool_row("Gone Shift", OLD, "8A-4P", sr.KIND_CALLOFF, filled_by="Ann Roe",
             closed_ago=timedelta(minutes=1))
    pool_row("OPEN2", D1, "4P-12A", sr.KIND_OPEN, filled_by="Ann Roe", closed_ago=timedelta(minutes=1))
    OUT["net_added"] = osc.note_from_pool(T, now=NOON)
    OUT["net_again"] = osc.note_from_pool(T, now=NOON)
    OUT["net_rows"] = [(r["open_row"], r["noted_by"], r["filled_by"]) for r in ledger()]

    # ── ANSWERS: a final one closes it; a door out of reach is a failure, three times ──
    dee = [o for o in osc.owed(T, now=NOON) if o["called_off_by"] == "Dee Way"]
    OUT["dee_offered"] = len(dee)
    osc.mark(T, dee, {}, failure="the door could not be reached (TimeoutError)", now=NOON)
    osc.mark(T, dee, {}, failure="x", now=NOON + timedelta(seconds=osc.RETRY_S + 1))
    osc.mark(T, dee, {}, failure="x", now=NOON + timedelta(seconds=2 * osc.RETRY_S + 2))
    OUT["dee_failed"] = [(r["state"], r["failures"]) for r in ledger() if r["open_row"] == "Dee Way"]
    OUT["dee_after_three"] = len([o for o in osc.owed(T, now=NOON + timedelta(seconds=3 * osc.RETRY_S + 3))
                                  if o["called_off_by"] == "Dee Way"])
    OUT["dee_state"] = [r["state"] for r in ledger() if r["open_row"] == "Dee Way"]
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("INSERT INTO asa_open_shift_covered (location, open_row, col_iso, shift_end, noted_by) "
                    "VALUES (%s,'Told Once',%s,%s,'decide'), (%s,'Long Over',%s,%s,'decide')",
                    (H1, D1, NOON + timedelta(hours=8), H1, D1, NOON - timedelta(hours=2)))
        c.commit()
    told = [o for o in osc.owed(T, now=NOON) if o["called_off_by"] == "Told Once"]
    osc.mark(T, told, {"results": [{"id": o["id"], "state": "told", "count": "3/3"} for o in told]}, now=NOON)
    OUT["told_again"] = len([o for o in osc.owed(T, now=NOON + timedelta(hours=1))
                             if o["called_off_by"] == "Told Once"])
    OUT["final_states"] = {r["open_row"]: [r["state"], r["said"]] for r in ledger()}
finally:
    OUT["rooms"] = ROOMS.close()
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''


def _lane_in_container():
    # every module the roots reach, and the IST settings reader's declaration, in a folder of this run's own
    sources = lane_schema.with_imports(SERVER, (
        "shift_requests", "shift_handoff", "house_cal_live", "shift_slices", "calendar_builder_slices",
        "house_directory", "psi_reminders", "open_shift_covered", "badge_follows", "effective_roster",
        "calendar_builder_houses", "calendar_builder_write", "ist_config", "time_off", "redaction"))
    return lane_schema.run_in(CONTAINER, lane_schema.script(sources, LANE, "open-shift-covered"))


print("\nthe ledger, against a real database")
lane = _lane_in_container()
if lane is None:
    print("  (skipped — no relay container to hold a database here)")
    print("  NOTE: the pure half above still ran; the ledger half did not.")
elif lane.get("crash"):
    check("the lane ran to its end", False, lane.get("trace") or lane["crash"])
else:
    check("every table the lane reads resolves in its own schema before the first read, never public",
          lane["owned"]["lane"] and all(str(s).startswith("hub_test_open_shift_covered_")
                                        for s in lane["owned"]["lane"].values()), lane["owned"])
    after = lane["after_decide"]
    check("the house manager's decision on a CALL-OFF is noted once, by the hook, with who took it",
          len(after) == 1 and after[0]["open_row"] == "Zed Caller" and after[0]["noted_by"] == "decide"
          and after[0]["filled_by"] == "Cy Far" and after[0]["filled_how"] == "approved", after)
    check("and the decision on an OPEN row from a published schedule is not noted at all",
          all(r["open_row"] != "OPEN" for r in after), after)
    check("noting the same fill again is not a second row",
          lane["noted_again"] is False and lane["rows_after_again"] == 1, lane)
    check("never offered, it is offered at night too, carrying the caller only to find the call-off",
          lane["night_offer"] == [["Zed Caller", "16:00", "ABD1711"]], lane["night_offer"])
    check("`refused_quiet` waits out the night and is offered again at noon",
          lane["night_again"] == 0 and lane["morning"] == 1, lane)
    check("`not_yet` waits its retry, comes back after it, and gives up when the call-off never came",
          lane["not_yet_soon"] == 0 and lane["not_yet_later"] == 1 and lane["gave_up_offer"] == 0
          and lane["gave_up_state"] == ["gave_up"], lane)
    net = lane["net_rows"]
    check("the net notes the call-off a claim filled, once, and says it came from the pool",
          lane["net_added"] == 1 and lane["net_again"] == 0
          and ["Dee Way", "pool", "Ann Roe"] in net, net)
    check("and never a fill from before the ledger was born, a shift already over, or an OPEN row",
          not any(r[0] in ("Old Timer", "Gone Shift", "OPEN2") for r in net), net)
    check("a door out of reach is `failed` — offered again, counted — and gives up after three",
          lane["dee_offered"] == 1 and lane["dee_failed"] == [["failed", 3]]
          and lane["dee_after_three"] == 0 and lane["dee_state"] == ["gave_up"], lane)
    fs = lane["final_states"]
    check("`told` closes the row for good, with the minute it was said",
          lane["told_again"] == 0 and fs.get("Told Once") == ["told", True], fs)
    check("a shift two hours over is closed as stale, never offered",
          fs.get("Long Over", [None])[0] == "stale", fs)


print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
