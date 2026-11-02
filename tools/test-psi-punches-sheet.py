#!/usr/bin/env python3
"""The full punch sheet, offline: every field with the client's, the door in node, and the relay's one pass."""
import ast
import asyncio
import json
import logging
import os
import re
import stat
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
REPO = HERE.parent.parent
SERVER = REPO / "server"
TMP = Path(tempfile.mkdtemp(prefix="psi-full-"))
os.environ.update({
    "HUB_SNAPSHOT_OUT": str(TMP),
    "HUB_PSI_FULL_DIR": str(TMP / "psi-full"),
    "HUB_PSI_ENTRIES_DIR": str(TMP / "psi-entries"),
    "HUB_PSI_ATTENDANCE_STATE": str(TMP / "state.json"),
    "HUB_PSI_LOGIN_CLOCK_FILE": str(TMP / "login-clock.json"),
    "HUB_PSI_SECRET_FILE": str(TMP / "no-secret.json"),
    "HUB_PSI_TY_SECRET_FILE": str(TMP / "no-ty-secret.json"),
})
sys.path.insert(0, str(SERVER))


def _no_network(*_a, **_k):
    raise AssertionError("the test tried to reach the network")


import urllib.request  # noqa: E402

urllib.request.urlopen = _no_network

import psi_entries  # noqa: E402
import psi_punches_feed  # noqa: E402
import psi_punches_full as full  # noqa: E402

results = {"ok": 0, "failed": []}


def check(name, cond, detail=""):
    if cond:
        results["ok"] += 1
        print(f"ok   {name}")
    else:
        results["failed"].append(name)
        print(f"FAIL {name}{(' — ' + str(detail)[:500]) if detail else ''}")


UTC = timezone.utc
NOW = datetime(2026, 9, 22, 15, 0, tzinfo=UTC)


def payload(i: int, **over: Any) -> dict:
    p = {"Single_Entry_ID": str(70000 + i), "Anywhere_status": "I", "firstname": "Ann",
         "lastname": f"Doe{i}", "peopleId": str(500 + i), "userId": "ann.doe",
         "Date_of_Service": "6/24/2026 12:00:00 AM", "start_time": "07:00:00",
         "end_time": "15:00:00", "check_hours": "8.00", "WCCode": "HPC", "workCodeId": "1",
         "_supervisorId": 3, "submittedUser": "sup.one", "submit_date": "6/25/2026 9:01:00 AM",
         "approvedUser": "boss.one", "approved_time": "6/26/2026 10:00:00 AM", "rejectedUser": "",
         "rejected_time": "", "Last_Update": "6/26/2026 10:00:00 AM", "transportation_units": "",
         "keyTimes": "Y", "Location_Name": "1305 49th St NW", "latitude": "40.812345",
         "longitude": "-81.412345", "Number_Consumers_Present": "1", "comments": "slept  well",
         "_consumers": ["Smith, Jane"],
         "_consumer_meta": [{"evvReasonCode": "99", "hasSignature": "N", "hasNote": "Y",
                             "isDocumented": None}]}
    p.update(over)
    return p


def stored_row(i: int, **over: Any) -> dict:
    raw = payload(i)
    row = {"single_entry_id": raw["Single_Entry_ID"], "status": "I", "employee": f"Ann Doe{i}",
           "people_id": raw["peopleId"], "date_service": "06/24/2026", "start_time": "07:00:00 AM",
           "end_time": "03:00:00 PM", "hours": Decimal("8.0000000000000000710542735760100185871"),
           "address": "1305 49th St NW", "house": "ABD2704", "work_code": "HPC",
           "consumers": "Jane Smith", "num_consumers": 1, "supervisor_id": 3,
           "comments": "slept  well", "submitted_user": "sup.one", "latitude": "40.812345",
           "longitude": "-81.412345", "raw": raw,
           "synced_at": datetime(2026, 8, 14, 12, 0, 0, 123456, tzinfo=UTC),
           "has_signature": False, "is_documented": False, "evv_reasons": "99"}
    row.update(over)
    return row


def live_entry(i: int, **over: Any) -> dict:
    p = payload(i, **over)
    for k in ("_consumers", "_consumer_meta"):
        p.pop(k, None)
    return p


# 1. the shape
s0 = full.project_stored(stored_row(1))
check("SHAPE: a stored row carries every declared column", set(s0) == set(full.FIELDS), set(s0) ^ set(full.FIELDS))
check("SHAPE: the client's half is IN — the clients present by name and in slots with their attestation, the "
      "place, the GPS point, the comments, the house code",
      s0["consumers"] == "Smith, Jane" and s0["consumer_1"] == "Smith, Jane"
      and s0["consumer_1_evv_reason_code"] == "99" and s0["consumer_1_has_signature"] == "N"
      and s0["consumer_1_has_note"] == "Y" and s0["consumer_1_is_documented"] == ""
      and s0["location_name"] == "1305 49th St NW" and s0["latitude"] == "40.812345"
      and s0["longitude"] == "-81.412345" and s0["comments"] == "slept well" and s0["house"] == "ABD2704"
      and s0["consumers_present"] == "1", s0)
check("SHAPE: and so is everything else the payload names — the approval trail, the key times, the user id",
      s0["approved_user"] == "boss.one" and s0["approved_time"] == "6/26/2026 10:00:00 AM"
      and s0["submit_date"] == "6/25/2026 9:01:00 AM" and s0["key_times"] == "Y" and s0["user_id"] == "ann.doe"
      and s0["work_code_id"] == "1" and s0["last_update"] == "6/26/2026 10:00:00 AM", s0)
check("SHAPE: the day, the times and the hours in the stored copy's own spellings (the door's date_iso parses "
      "them), the float artefact spelled off",
      s0["date_service"] == "06/24/2026" and s0["start_time"] == "07:00:00 AM" and s0["end_time"] == "03:00:00 PM"
      and s0["hours"] == "8.00" and s0["supervisor_id"] == "3", s0)
check("SHAPE: the stored copy's own columns ride along — the flags as true/false, the sync stamp in ISO seconds",
      s0["has_signature"] == "false" and s0["is_documented"] == "false" and s0["evv_reasons"] == "99"
      and s0["source"] == full.SOURCE_STORED and s0["source_synced_at"] == "2026-08-14T12:00:00Z", s0)
check("SHAPE: every measured payload key has a name — the raw column is empty", s0["extra_json"] == "", s0["extra_json"])
odd = full.flatten(payload(2, newField={"a": 1},
                           _consumers=["A, One", "B, Two", "C, Three", "D, Four"],
                           _consumer_meta=[{"evvReasonCode": str(n)} for n in range(4)]))
extra = json.loads(odd["extra_json"])
check("SHAPE: a field nothing names rides `extra_json` (sorted); a fourth client lands there, never lost",
      extra.get("newField") == {"a": 1} and extra.get("_consumers_more") == ["D, Four"]
      and odd["consumer_3"] == "C, Three" and odd["consumer_3_evv_reason_code"] == "2"
      and odd["consumers"] == "A, One; B, Two; C, Three; D, Four", odd)
bare = full.project_stored(stored_row(3, raw=None))
check("SHAPE: a stored row with no payload still lands from its own columns — the address is the place",
      bare["location_name"] == "1305 49th St NW" and bare["consumers"] == "Jane Smith"
      and bare["consumers_present"] == "1" and bare["hours"] == "8.00" and bare["employee"] == "Ann Doe3", bare)
check("SHAPE: no key, no row", full.project_stored(stored_row(4, single_entry_id="", raw={})) is None)
H = full.HEADER
check("SHAPE: the header — the door's five and every relay column, once each, date_iso beside date_service",
      H[:3] == ["id", "createdAt", "updatedAt"] and H[-1] == "tenant" and len(H) == len(set(H))
      and H[H.index("date_service") + 1] == "date_iso" and set(full.FIELDS) <= set(H)
      and set(H) - set(full.FIELDS) == set(full.DOOR_AUTHORED), H)
MEASURED_TABLE = {"single_entry_id", "status", "employee", "people_id", "date_service", "start_time",
                  "end_time", "hours", "address", "house", "work_code", "consumers", "num_consumers",
                  "supervisor_id", "comments", "submitted_user", "latitude", "longitude", "raw",
                  "synced_at", "has_signature", "is_documented", "evv_reasons"}
check("SHAPE: every column the stored copy has (all 23, measured) is selected by name",
      set(full.STORED_COLUMNS) == MEASURED_TABLE, set(full.STORED_COLUMNS) ^ MEASURED_TABLE)
gs = (REPO / "apps-script" / "PsiPunches.gs").read_text(encoding="utf-8")
gs_header = re.findall(r"'([^']+)'", re.search(r"var PSI_PUNCHES_FULL_HEADER = \[(.*?)\];", gs, re.S).group(1))
gs_cap = int(re.search(r"var PSI_PUNCHES_FULL_CAP = (\d+);", gs).group(1))
check("SHAPE: the door declares the very same header, in the same order", gs_header == H,
      [x for x in gs_header if x not in H] + [x for x in H if x not in gs_header])
mint_src = (REPO / "tools" / "mint_psi_punches_full_house.py").read_text(encoding="utf-8")
check("SHAPE: the mint tool stamps the header from the module, never a copy of its own",
      "psi_punches_full.HEADER" in mint_src and "HUB_HOUSE_PSI_PUNCHES_FULL_ID" in mint_src)
check("BATCHES: every batch fits the door's cap, and the door's cap is the relay's",
      gs_cap == full.DOOR_CAP and full.LIVE_BATCH <= gs_cap and full.BACKFILL_BATCH <= gs_cap,
      (gs_cap, full.LIVE_BATCH, full.BACKFILL_BATCH))

# 2. the line on the staff-hours record stands
client = {"address", "latitude", "longitude", "consumers", "num_consumers", "comments", "house", "raw"}
check("THE LINE: the staff-hours feed, its history and its slice still carry no client column",
      not (set(psi_punches_feed.FIELDS) & client) and not psi_punches_feed._LINE_HOLDS
      and not (set(psi_entries.KEPT) & set(psi_entries.REFUSED)))
check("THE LINE: the staff-hours door still refuses the client columns — only the full door takes them",
      "var PSI_PUNCHES_REFUSED = ['address', 'latitude', 'longitude', 'consumers'" in gs
      and "HUB_ACTIONS.psiPunchesFullIngest" in gs)
main_gs = (REPO / "apps-script" / "Main.gs").read_text(encoding="utf-8")
FULL_READERS = {"house_slices.py"}
check("THE LINE: no sheet route, no screen and no other slice reads the full record (the generated "
      "action catalogue only describes its door)",
      "psi_punches_full" not in main_gs
      and not any("psi_punches_full" in p.read_text(encoding="utf-8", errors="replace")
                  for p in (REPO / "src").rglob("*.ts*") if ".generated." not in p.name)
      and not any("psi_punches_full" in p.read_text(encoding="utf-8", errors="replace")
                  for p in SERVER.glob("*_slices.py") if p.name not in FULL_READERS))
houses_src = (SERVER / "house_slices.py").read_text(encoding="utf-8")
snapshot_ts = (REPO / "src" / "lib" / "snapshot.ts").read_text(encoding="utf-8")
employee_only = snapshot_ts[snapshot_ts.index("export const EMPLOYEE_ONLY_SLICES"):]
check("THE LINE: that reader keeps a name, a count and a last day, in an employee-only file",
      '{"name": name, "shifts": 0, "last_day": day}' in houses_src
      and "'houses'" in employee_only[:employee_only.index("]\n")])

# 3. the relay's JSON: one row per entry, locked
(TMP / "psi-full").mkdir(mode=0o755)
os.chmod(TMP / "psi-full", 0o755)
c1 = full.record_live([live_entry(10), live_entry(11), {"firstname": "no id"}], NOW)
live = json.loads((TMP / "psi-full" / full.LIVE_FILE).read_text())
check("JSON: a live read is kept whole — every field, the client's place and coordinates and comments included",
      c1 == {"added": 2, "changed": 0, "same": 0, "keyless": 1}
      and live["entries"]["70010"]["entry"]["Location_Name"] == "1305 49th St NW"
      and live["entries"]["70010"]["entry"]["latitude"] == "40.812345", c1)
mode_dir = stat.S_IMODE((TMP / "psi-full").stat().st_mode)
mode_file = stat.S_IMODE((TMP / "psi-full" / full.LIVE_FILE).stat().st_mode)
check("LOCKED: /srv/snapshot is web-served — the directory is 0700 (tightened though it was 0755) and the file 0600",
      mode_dir == 0o700 and mode_file == 0o600, (oct(mode_dir), oct(mode_file)))
first_seen = live["entries"]["70010"]["first_seen"]
c2 = full.record_live([live_entry(10), live_entry(11)], NOW + timedelta(hours=1))
live2 = json.loads((TMP / "psi-full" / full.LIVE_FILE).read_text())
check("UPSERT: the same entries read again are the same rows — nothing added, `changed_at` does not move",
      c2 == {"added": 0, "changed": 0, "same": 2, "keyless": 0}
      and live2["entries"]["70010"]["changed_at"] == live["entries"]["70010"]["changed_at"], c2)
c3 = full.record_live([live_entry(10, end_time="16:00:00")], NOW + timedelta(hours=2))
live3 = json.loads((TMP / "psi-full" / full.LIVE_FILE).read_text())
check("UPSERT: an entry read again closed replaces its fields and keeps `first_seen`",
      c3["changed"] == 1 and live3["entries"]["70010"]["entry"]["end_time"] == "16:00:00"
      and live3["entries"]["70010"]["first_seen"] == first_seen
      and live3["entries"]["70010"]["changed_at"] != first_seen and len(live3["entries"]) == 2, c3)
bad = TMP / "psi-full" / full.LIVE_FILE
kept_text = bad.read_text()
bad.write_text("{truncated", encoding="utf-8")
c4 = full.record_live([live_entry(12)], NOW)
check("JSON: an unreadable record is not an empty one — it is not overwritten", c4.get("unwritten") == 1
      and bad.read_text() == "{truncated", c4)
bad.write_text(kept_text, encoding="utf-8")

# 4. the live read wins
st = full.project_stored(stored_row(10))
lv = full.project_live({"entry": live_entry(10, end_time="16:00:00", comments=""),
                        "first_seen": "2026-09-22T15:00:00Z", "changed_at": "2026-09-22T17:00:00Z"})
u = full.union([st, full.project_stored(stored_row(9))], [lv])
m10 = [r for r in u if r["single_entry_id"] == "70010"]
check("LIVE WINS: one row per entry whichever source saw it; the live read's word wins field by field",
      len(m10) == 1 and m10[0]["end_time"] == "04:00:00 PM" and m10[0]["source"] == full.SOURCE_BOTH
      and m10[0]["source_synced_at"] == "2026-09-22T17:00:00Z", m10)
check("LIVE WINS: where the live read says nothing, the stored value stands — the clients present, the house, "
      "the comments, the flags",
      m10[0]["consumer_1"] == "Smith, Jane" and m10[0]["house"] == "ABD2704"
      and m10[0]["comments"] == "slept well" and m10[0]["has_signature"] == "false", m10[0])
check("LIVE WINS: ordered by key, numerically, whatever the width",
      [r["single_entry_id"] for r in full.union([], [dict(lv, single_entry_id=k) for k in ("900", "10000", "1001")])]
      == ["900", "1001", "10000"])
psi_entries.upsert([{"Single_Entry_ID": "70011", "firstname": "Ann", "lastname": "Doe11",
                     "Date_of_Service": "9/22/2026 12:00:00 AM", "start_time": "07:00:00"},
                    {"Single_Entry_ID": "70099", "firstname": "Slim", "lastname": "Only",
                     "Date_of_Service": "9/21/2026 12:00:00 AM", "start_time": "08:00:00"}], NOW)
lr = {r["single_entry_id"]: r for r in full.live_rows()}
check("LIVE WINS: the staff-hours history joins under the full reads — every entry the lane ever read is a row, "
      "the full read's columns winning",
      set(lr) == {"70010", "70011", "70099"} and lr["70011"]["latitude"] == "40.812345"
      and lr["70099"]["employee"] == "Slim Only" and lr["70099"]["latitude"] == "", sorted(lr))

# 5. the passes
STORED = [full.project_stored(stored_row(i)) for i in range(1000, 2200)]
full.stored_rows = lambda dsn: [dict(r) for r in STORED]
LIVE_IDS = list(range(2150, 2500))
full.record_live([live_entry(i) for i in LIVE_IDS], NOW)
rows = full.build("dsn", NOW)["rows"]
check("JSON FIRST: the full rows are written to rows.json (0600) before anything is handed over",
      (TMP / "psi-full" / full.ROWS_FILE).exists()
      and stat.S_IMODE((TMP / "psi-full" / full.ROWS_FILE).stat().st_mode) == 0o600
      and len(json.loads((TMP / "psi-full" / full.ROWS_FILE).read_text())["rows"]) == len(rows))
b, kind, pending = full.plan(rows, {"handed": {}}, "collection", 0)
live_ids = {r["single_entry_id"] for r in rows if r["source"].startswith(full.SOURCE_LIVE)}
check("BATCHES: a collection's pass carries the live rows only, newest first, at most LIVE_BATCH",
      kind == "live" and len(b) == full.LIVE_BATCH and {r["single_entry_id"] for r in b} <= live_ids
      and [r["single_entry_id"] for r in b] == sorted((r["single_entry_id"] for r in b),
                                                       key=psi_punches_feed._order, reverse=True), (kind, len(b)))
b2, kind2, _ = full.plan(rows, {"handed": full.fingerprints([r for r in rows if r["single_entry_id"] in live_ids])},
                         "collection", 0)
check("BATCHES: with every live row in the sheet, a collection's pass sends nothing — the backfill is the hour's",
      b2 == [] and kind2 == "")
b3, kind3, _ = full.plan(rows, {"handed": full.fingerprints([r for r in rows if r["single_entry_id"] in live_ids])},
                         "hourly", 0)
check("BATCHES: the hourly pass hands BACKFILL_BATCH of the rest, in key order",
      kind3 == "backfill" and len(b3) == full.BACKFILL_BATCH
      and [r["single_entry_id"] for r in b3] == [r["single_entry_id"] for r in rows
                                                  if r["single_entry_id"] not in live_ids][:full.BACKFILL_BATCH])

door_calls = []


def door(got, status=200, **data):
    n = len(got["batch"])
    door_calls.append(n)
    return {"status": status, "data": dict({"kept": n, "overflow": 0, "inserted": n, "updated": 0,
                                            "unchanged": 0, "columns": len(full.HEADER),
                                            "dropped": []}, **data)}


t = time.time()
passes = []
for reason in ("collection", "collection", "collection", "hourly", "hourly", "hourly", "hourly", "hourly"):
    got = full.next_pass("dsn", reason, t)
    passes.append((reason, got and got["kind"], got and len(got["batch"])))
    if got:
        full.settle(got, door(got), t)
    t += 60
rest = len(rows) - len(live_ids)
check(f"BATCHES: the whole record crosses in bounded passes — {len(live_ids)} live rows in two collection "
      f"passes (300 + {len(live_ids) - 300}), a third with nothing to send, then the {rest} others hourly in "
      "500s — ONE execution per pass",
      passes[:3] == [("collection", "live", 300), ("collection", "live", len(live_ids) - 300),
                     ("collection", None, None)]
      and [p[2] for p in passes[3:] if p[2]] == [500, 500, rest - 1000] and len(door_calls) == 5, passes)
state = json.loads((TMP / "psi-full" / full.FEED_FILE).read_text())
check("BATCHES: once every row was taken whole the record is proved (full_at), and nothing more is asked",
      state["full_at"] > 0 and len(state["handed"]) == len(rows)
      and full.next_pass("dsn", "hourly", t) is None and full.next_pass("dsn", "collection", t) is None,
      (state["full_at"], len(state["handed"]), len(rows)))
check("BATCHES: the proof is on disk (0600) — a relay restart does not start the backfill again",
      stat.S_IMODE((TMP / "psi-full" / full.FEED_FILE).stat().st_mode) == 0o600
      and full._feed_state()["handed"] == state["handed"])
full.record_live([live_entry(2499, end_time="18:30:00")], NOW + timedelta(hours=3))
got = full.next_pass("dsn", "collection", t)
check("BATCHES: an entry that changed in a later collection crosses alone, in that collection's pass",
      got and [r["single_entry_id"] for r in got["batch"]] == ["72499"] and got["kind"] == "live", got and got["kind"])
full.settle(got, {"status": 200, "data": {"kept": 0, "overflow": 1}}, t)
check("BATCHES: a pass the door did not take WHOLE proves nothing — the same row goes on the next pass",
      [r["single_entry_id"] for r in full.next_pass("dsn", "collection", t)["batch"]] == ["72499"])
said = full.settle(got, {"status": 409, "message": "The psi_punches_full house is not declared yet",
                         "data": {"missing_tab": True}}, t)
check("HOLD: a house not minted yet holds the feed for hours instead of asking every hour",
      said.get("held") and full.next_pass("dsn", "collection", t + 60) is None
      and full.next_pass("dsn", "hourly", t + 3600) is None
      and full.next_pass("dsn", "collection", t + full.HOLD_S + 1) is not None, said)
said404 = full.settle(got, {"status": 404, "message": "Unknown action: psiPunchesFullIngest"}, t)
check("HOLD: so does a door that is not pushed or not published yet (404 / 403)", said404.get("held"), said404)
# an older publish drops a new column in silence; only the columns it declares tell
t_old = t + full.HOLD_S + 2
said_old = full.settle(got, {"status": 200, "data": {"kept": len(got["batch"]), "overflow": 0,
                                                     "inserted": 0, "updated": 1, "unchanged": 0}}, t_old)
back = full.next_pass("dsn", "collection", t_old + full.HOLD_S + 1)
check("HOLD: a door that took every row but does not say its header — an older publish — proves NOTHING: "
      "the feed holds, and the same rows go again once it can take them",
      said_old.get("held") and "does not say its header" in (said_old.get("why") or "")
      and back and [r["single_entry_id"] for r in back["batch"]] == ["72499"],
      (said_old, back and [r["single_entry_id"] for r in back["batch"]]))
t_drop = t_old + full.HOLD_S + 2
said_drop = full.settle(got, {"status": 200, "data": {
    "kept": len(got["batch"]), "overflow": 0, "columns": len(full.HEADER) - 3,
    "dropped": ["consumer_1_id", "consumer_2_id", "consumer_3_id"]}}, t_drop)
check("HOLD: so does one that names the handed columns it does not carry — the sheet would be short the "
      "client ids with every count green",
      said_drop.get("held") and "consumer_1_id" in (said_drop.get("why") or ""), said_drop)
full.settle(got, door(got), t_drop + full.HOLD_S + 2)
check("HOLD: the door published, the pass is proved and the rows are the sheet's",
      full.next_pass("dsn", "collection", t_drop + 2 * full.HOLD_S) is None)
t2 = t + full.REVERIFY_S + full.HOLD_S + 10
got_rv = full.next_pass("dsn", "hourly", t2)
check("WEEKLY: a week after the record was proved whole it is handed again — hourly, in the same bounded "
      "batches (the live rows first)",
      got_rv and len(got_rv["batch"]) <= full.BACKFILL_BATCH and got_rv["pending"] == len(rows)
      and full.next_pass("dsn", "collection", t2) is not None, got_rv and (got_rv["kind"], got_rv["pending"]))

# 6. the relay's one pass, lifted out of snapshot_service
src = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
want = {"_PSI_FULL", "_psi_full_tick"}
nodes = [n for n in ast.parse(src).body
         if (isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in want)
         or (isinstance(n, (ast.Assign, ast.AnnAssign))
             and isinstance((n.targets[0] if isinstance(n, ast.Assign) else n.target), ast.Name)
             and (n.targets[0] if isinstance(n, ast.Assign) else n.target).id in want)]
posted: list[dict] = []
DOOR = {"answer": "whole"}


async def _post_exec(payload, **_kw):
    posted.append(payload)
    if DOOR["answer"] == "raise":
        raise RuntimeError("the exec door did not answer")
    n = len(payload["payload"]["rows"])
    said = {"kept": n, "overflow": 0, "inserted": n, "updated": 0, "unchanged": 0,
            "columns": len(full.HEADER), "dropped": []}
    if DOOR["answer"] == "older publish":
        said = {"kept": n, "overflow": 0, "inserted": n, "updated": 0, "unchanged": 0}
    return {"status": 200, "data": said}


async def _service_door(_app, action, payload, credential, **kw):
    # the relay's own lane: Apps Script's door or Python's, the same answer shape either way
    return await _post_exec({"action": action, "payload": payload, **credential}, **kw)


ns: dict[str, Any] = {"asyncio": asyncio, "time": time, "Any": Any, "PG_DSN": "dsn",
                      "log": logging.getLogger("test.psi_full"), "psi_punches_full": full,
                      "_post_exec": _post_exec, "_service_door": _service_door, "HIRING_APP": "hiring",
                      "_SWEEP_FAILURES": {"psi_full": 0}}
exec(compile(ast.Module(body=nodes, type_ignores=[]), "snapshot_service._psi_full_tick", "exec"), ns)
(TMP / "psi-full" / full.FEED_FILE).unlink()
full.record_live([live_entry(i) for i in range(3000, 3040)], NOW + timedelta(hours=4))
asyncio.run(ns["_psi_full_tick"]({"service_secret": "s"}, "collection"))
check("TICK: after a collection, ONE execution — psiPunchesFullIngest with the live rows and nothing else",
      len(posted) == 1 and posted[0]["action"] == "psiPunchesFullIngest"
      and set(posted[0]["payload"]) == {"rows"} and len(posted[0]["payload"]["rows"]) == full.LIVE_BATCH, posted[:1]
      and [len(p["payload"]["rows"]) for p in posted])
asyncio.run(ns["_psi_full_tick"]({"service_secret": "s"}, "collection"))
asyncio.run(ns["_psi_full_tick"]({"service_secret": "s"}, "collection"))
live_total = len([r for r in full.build("dsn", NOW)["rows"] if r["source"].startswith(full.SOURCE_LIVE)])
check("TICK: the collection passes stop when every live row is in — never a backfill on a collection's beat",
      sum(len(p["payload"]["rows"]) for p in posted) == live_total and len(posted) == 2,
      [len(p["payload"]["rows"]) for p in posted])
before = len(posted)
asyncio.run(ns["_psi_full_tick"]({"service_secret": "s"}, "hourly"))
check("TICK: the hourly pass carries one backfill batch — one execution",
      len(posted) == before + 1 and len(posted[-1]["payload"]["rows"]) == full.BACKFILL_BATCH)
DOOR["answer"] = "raise"
handed_before = len(full._feed_state()["handed"])
asyncio.run(ns["_psi_full_tick"]({"service_secret": "s"}, "hourly"))
check("TICK: an exec door that did not answer proves nothing and is counted — the rows go again next pass",
      len(full._feed_state()["handed"]) == handed_before and ns["_SWEEP_FAILURES"]["psi_full"] == 1)
DOOR["answer"] = "older publish"
handed_before = len(full._feed_state()["handed"])
posted_before = len(posted)
asyncio.run(ns["_psi_full_tick"]({"service_secret": "s"}, "hourly"))
held = full._feed_state()
asyncio.run(ns["_psi_full_tick"]({"service_secret": "s"}, "hourly"))
check("TICK: a door published before the record's newest columns proves nothing and holds the lane — the "
      "rows are NOT written down as the sheet's, and the next beats do not ask again",
      len(full._feed_state()["handed"]) == handed_before and len(posted) == posted_before + 1
      and held["hold_until"] > 0 and "header" in held["hold_why"])
DOOR["answer"] = "whole"
full._feed_save(dict(full._feed_state(), hold_until=0.0, hold_why=""))
asyncio.run(ns["_psi_full_tick"]({"service_secret": "s"}, "hourly"))
check("TICK: once the door is published, the same rows cross and are proved",
      len(full._feed_state()["handed"]) > handed_before and len(posted) == posted_before + 2)

# 7. the attendance lane keeps every field of what it read
import psi_attendance as pa  # noqa: E402

pa._keep_full([live_entry(4000, comments="new note")], NOW)
kept4000 = json.loads((TMP / "psi-full" / full.LIVE_FILE).read_text())["entries"]["74000"]["entry"]
check("LANE: a collection's rows reach the full record whole, through the lane's own hook",
      kept4000["comments"] == "new note" and kept4000["Location_Name"] == "1305 49th St NW")
check("LANE: a pass that read says so, so the relay starts the full sheet's pass from that beat — and the "
      "hour's pass rides the same one task",
      '"read": True' in (SERVER / "psi_attendance.py").read_text(encoding="utf-8")
      and '(beat or {}).get("read")' in src and '_psi_full_start(credential, "hourly")' in src
      and "await _psi_full_tick(" not in src.split("async def _psi_attendance_loop", 1)[1].split("\nasync def ", 1)[0])

# 7b. never in front of a person, and one pass at a time
want2 = {"_PSI_FULL", "_psi_full_start", "_psi_full_run", "_psi_full_tick", "_psi_attendance_loop"}
nodes2 = [n for n in ast.parse(src).body
          if (isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in want2)
          or (isinstance(n, (ast.Assign, ast.AnnAssign))
              and isinstance((n.targets[0] if isinstance(n, ast.Assign) else n.target), ast.Name)
              and (n.targets[0] if isinstance(n, ast.Assign) else n.target).id in want2)]
FULL_S = 0.6
EV: list[tuple[float, str]] = []
FLIGHT = {"now": 0, "max": 0}
REASONS: list[str] = []


async def _post_exec2(payload, **_kw):
    action = payload.get("action")
    EV.append((time.monotonic(), "start " + action))
    if action == "psiPunchesFullIngest":
        FLIGHT["now"] += 1
        FLIGHT["max"] = max(FLIGHT["max"], FLIGHT["now"])
        try:
            await asyncio.sleep(FULL_S)
        finally:
            FLIGHT["now"] -= 1
        EV.append((time.monotonic(), "end " + action))
        n = len(payload["payload"]["rows"])
        return {"status": 200, "data": {"kept": n, "overflow": 0}}
    return {"status": 200, "data": {"told": 1, "held": 0, "skipped": 0}}


async def _service_door2(_app, action, payload, credential, **kw):
    # the relay's own lane: Apps Script's door or Python's, the same answer shape either way
    return await _post_exec2({"action": action, "payload": payload, **credential}, **kw)


async def _staff_door2(action, payload, credential):
    return await _service_door2("staff-alerts", action, payload, credential)


class _FakeFull:
    HOLD_S = 7200

    @staticmethod
    def next_pass(dsn, reason, now):
        REASONS.append(reason)
        return {"batch": [{"single_entry_id": "1"}], "prints": {}, "kind": "live", "pending": 1,
                "total": 1, "stored": 0, "live": 1, "live_new": 1}

    @staticmethod
    def settle(got, env, now):
        return {"ok": True, "rows": 1}


class _FakeAtt:
    beats = 0

    @staticmethod
    def tick(dsn):
        _FakeAtt.beats += 1
        time.sleep(0.02)
        return {"state": "told", "read": True, "no_call": 1} if _FakeAtt.beats == 1 else {"state": "waiting"}

    @staticmethod
    def pending(now):
        return {"late": [], "no_call": [{"person": "Cy Noshow"}], "ids": ["x"]} if _FakeAtt.beats == 1 else None

    @staticmethod
    def posted(ids, said, now):
        return None

    @staticmethod
    def post_failed(now):
        return None

    @staticmethod
    def fill_consumers():
        EV.append((time.monotonic(), "fill consumers"))
        return {"asked": 0}


async def _noop():
    return None


ns2: dict[str, Any] = {"asyncio": asyncio, "time": time, "Any": Any, "PG_DSN": "dsn",
                       "log": logging.getLogger("test.psi_full"), "EXEC_URL": "x", "SERVICE_SECRET": "s",
                       "SERVICE_TOKEN": "", "PSI_ATTENDANCE_EVERY_S": 0.0, "_SWEEP_FAILURES": {"psi_full": 0},
                       "psi_punches_full": _FakeFull, "psi_attendance": _FakeAtt, "_post_exec": _post_exec2,
                       "_service_door": _service_door2, "_staff_door": _staff_door2, "HIRING_APP": "hiring",
                       "_psi_reminders_post": _noop, "_shift_handoff_post": _noop, "_time_off_post": _noop,
                       "_punch_pairs_post": _noop, "_support_punch_post": _noop,
                       "_shift_pool_sweep": _noop, "_shift_requests_post": _noop,
                       "_open_shift_covered_post": _noop,
                       "_recruit_book_post": _noop,
                       "_calloff_road_post": _noop,
                       "build_all": None, "punch_board_slices": None}
exec(compile(ast.Module(body=nodes2, type_ignores=[]), "snapshot_service._psi_attendance_loop", "exec"), ns2)


async def _beat_scenario():
    t0 = time.monotonic()
    loop_task = asyncio.create_task(ns2["_psi_attendance_loop"]())
    await asyncio.sleep(FULL_S * 2)
    loop_task.cancel()
    try:
        await loop_task
    except asyncio.CancelledError:
        pass
    task = ns2["_PSI_FULL"]["task"]
    if task is not None:
        await task
    return t0


T0 = asyncio.run(_beat_scenario())
punch_at = [t - T0 for t, what in EV if what == "start staffAttendancePunch"]
full_end = [t - T0 for t, what in EV if what == "end psiPunchesFullIngest"]
check("OFF THE PATH: a beat that read starts the full sheet's pass and does NOT wait for it — the no-show door "
      "is called before that execution ends, and the pass still lands, once",
      punch_at and full_end and punch_at[0] < FULL_S / 2 and punch_at[0] < full_end[0]
      and REASONS == ["collection"] and len(full_end) == 1,
      ([(round(t - T0, 2), w) for t, w in EV], REASONS))
fills = [t for t, what in EV if what == "fill consumers"]
full_start = [t for t, what in EV if what == "start psiPunchesFullIngest"]
check("THE CLIENTS FIRST: the pass's own task asks the lane for the clients present before the pass it "
      "carries them in — once, and off the beat like the pass itself",
      len(fills) == 1 and full_start and fills[0] < full_start[0],
      [(round(t - T0, 2), w) for t, w in EV])


async def _single_flight():
    cred = {"service_secret": "s"}
    first = ns2["_psi_full_start"](cred, "collection")
    await asyncio.sleep(FULL_S / 4)
    second = ns2["_psi_full_start"](cred, "collection")
    third = ns2["_psi_full_start"](cred, "hourly")
    fourth = ns2["_psi_full_start"](cred, "collection")
    await asyncio.shield(third)
    return first is second is third is fourth


EV.clear()
REASONS.clear()
FLIGHT.update(now=0, max=0)
same = asyncio.run(_single_flight())
check("ONE PASS AT A TIME: calls while a pass runs join the ONE task — never a second execution beside it — "
      "and owe exactly one more pass after it, an hour's never narrowed to a collection's",
      same and FLIGHT["max"] == 1 and REASONS == ["collection", "hourly"]
      and sum(1 for _t, w in EV if w == "start psiPunchesFullIngest") == 2,
      (same, FLIGHT, REASONS))

# 8. the door itself, in node, over a fake grid
NODE = r"""
const fs = require('fs'); const vm = require('vm');
const ctx = { HUB_POLICY: {}, HUB_ACTIONS: {}, cellText_: (v) => String(v), console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), ctx);
const rows = JSON.parse(fs.readFileSync(0, 'utf8'));
const H = ctx.PSI_PUNCHES_FULL_HEADER;
const grid = [H.slice()];
const sheet = {
  getRange(r, c, n, w) { return { setNumberFormat() {}, setValues(v) {
    for (let i = 0; i < n; i++) grid[r - 1 + i] = v[i].slice(); } }; },
  getLastRow() { return grid.length; }, getMaxRows() { return 6000; }, insertRowsAfter() {},
};
const pass = (items) => {
  const clean = items.map((r) => ctx.psiPunchesFullClean_(r, 'hq'));
  const values = grid.map((l) => l.slice());
  const res = ctx.psiPunchesUpsert_(sheet, clean, H, values);
  return { inserted: res.inserted, updated: res.updated, unchanged: res.unchanged, writes: res.writes };
};
const out = {};
out.first = pass(rows.slice(0, 2));
out.again = pass(rows.slice(0, 2));
const moved = Object.assign({}, rows[1], { end_time: '05:00:00 PM', comments: 'called the nurse' });
out.changed = pass([moved]);
out.lines = grid.length;
const col = (name) => H.indexOf(name);
out.row = { id: grid[1][col('id')], lat: grid[1][col('latitude')], consumer: grid[1][col('consumer_1')],
            comments: grid[2][col('comments')], date_iso: grid[1][col('date_iso')], tenant: grid[1][col('tenant')],
            created: grid[1][col('createdAt')] };
out.staffHoursKeepsLine = !('latitude' in ctx.psiPunchesClean_(rows[0], 'hq'))
  && !('comments' in ctx.psiPunchesClean_(rows[0], 'hq'));
out.policy = ctx.HUB_POLICY.psiPunchesFullIngest;
out.noKey = ctx.psiPunchesFullClean_({ latitude: '1' }, 'hq');
out.undeclared = 'Location_Name' in ctx.psiPunchesFullClean_(Object.assign({ Location_Name: 'x' }, rows[0]), 'hq');
process.stdout.write(JSON.stringify(out));
"""
two = [full.project_stored(stored_row(5000)), full.project_stored(stored_row(5001))]
try:
    proc = subprocess.run(["node", "-e", NODE, str(REPO / "apps-script" / "PsiPunches.gs")],
                          input=json.dumps(two), capture_output=True, text=True, timeout=60)
    door_out = json.loads(proc.stdout or "{}")
except (FileNotFoundError, ValueError) as exc:
    door_out = {"error": str(exc)}
check("DOOR: the first pass appends both rows", door_out.get("first") == {"inserted": 2, "updated": 0,
                                                                         "unchanged": 0, "writes": 1}, door_out)
check("DOOR: the same rows again cost NO write — upsert by PsiAnywhere's own key",
      door_out.get("again") == {"inserted": 0, "updated": 0, "unchanged": 2, "writes": 0}, door_out.get("again"))
check("DOOR: a row read again changed is PATCHED in place — never a second line",
      door_out.get("changed") == {"inserted": 0, "updated": 1, "unchanged": 0, "writes": 1}
      and door_out.get("lines") == 3, (door_out.get("changed"), door_out.get("lines")))
row = door_out.get("row") or {}
check("DOOR: the sheet holds the client's half, keyed by the entry id, with the door's own date_iso and tenant",
      row.get("id") == "75000" and row.get("lat") == "40.812345" and row.get("consumer") == "Smith, Jane"
      and row.get("comments") == "called the nurse" and row.get("date_iso") == "2026-06-24"
      and row.get("tenant") == "hq" and row.get("created"), row)
check("DOOR: service-only, no role — and a row with no key or a key the header does not declare never lands",
      (door_out.get("policy") or {}).get("service") is True and (door_out.get("policy") or {}).get("roles") == []
      and door_out.get("noKey") is None and door_out.get("undeclared") is False, door_out.get("policy"))
check("THE LINE: the staff-hours door's own clean still drops the client columns",
      door_out.get("staffHoursKeepsLine") is True, door_out)
NODE_LOCK = r"""
const fs = require('fs'); const vm = require('vm');
const lock = { held: false, taken: 0 };
const cache = new Map();
const seen = { readsWhileLocked: 0, reads: 0 };
const ctx = { HUB_POLICY: {}, HUB_ACTIONS: {}, cellText_: (v) => String(v), console,
  LockService: { getScriptLock: () => ({
    tryLock: () => { if (lock.held) return false; lock.held = true; lock.taken++; return true; },
    releaseLock: () => { lock.held = false; } }) },
  CacheService: { getScriptCache: () => ({
    get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => { cache.set(k, v); },
    remove: (k) => { cache.delete(k); } }) },
  houseMoved_: () => true, tenantStamp_: () => 'hq', hubPropSet_: () => {}, hubSysLog_: () => {},
  hubDenied_: () => ({ status: 403 }), ensureHeader_: (s, h) => h };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), ctx);
const rows = JSON.parse(fs.readFileSync(0, 'utf8'));
const H = ctx.PSI_PUNCHES_FULL_HEADER;
const grid = [H.slice()];
const sheet = {
  getDataRange() { return { getValues() { seen.reads++; if (lock.held) seen.readsWhileLocked++;
                                          return grid.map((l) => l.slice()); } }; },
  getRange(r, c, n, w) { return { setNumberFormat() {}, setValues(v) {
    if (lock.held) seen.readsWhileLocked++;
    for (let i = 0; i < n; i++) grid[r - 1 + i] = v[i].slice(); } }; },
  getLastRow() { return grid.length; }, getMaxRows() { return 6000; }, insertRowsAfter() {},
};
let broken = false;
ctx.hubTabSheet_ = () => { if (broken) throw new Error('the router threw'); return sheet; };
const door = (p) => ctx.HUB_ACTIONS.psiPunchesFullIngest(p, { is_service: true });
const out = {};
const first = door({ rows });
out.ok = first.status;
out.said = { columns: (first.data || {}).columns, dropped: (first.data || {}).dropped };
out.lockFree = !lock.held;
out.claimLeft = cache.has(ctx.PSI_PUNCHES_FULL_CLAIM_KEY);
out.touchedWhileLocked = seen.readsWhileLocked;
out.lines = grid.length;
cache.set(ctx.PSI_PUNCHES_FULL_CLAIM_KEY, 'another pass');
const readsBefore = seen.reads;
const busy = door({ rows });
out.busy = { status: busy.status, read: seen.reads - readsBefore,
             othersClaimKept: cache.get(ctx.PSI_PUNCHES_FULL_CLAIM_KEY) === 'another pass' };
cache.delete(ctx.PSI_PUNCHES_FULL_CLAIM_KEY);
broken = true;
try { door({ rows }); out.threw = false; } catch (e) { out.threw = true; }
out.claimAfterThrow = cache.has(ctx.PSI_PUNCHES_FULL_CLAIM_KEY);
broken = false;
out.after = door({ rows }).status;
/* a column this publish does not declare — named back, never carried */
out.droppedNames = (door({ rows: [Object.assign({ consumer_9_id: 'x' }, rows[0])] })
                    .data || {}).dropped;
out.lockFreeAtEnd = !lock.held;
process.stdout.write(JSON.stringify(out));
"""
try:
    proc = subprocess.run(["node", "-e", NODE_LOCK, str(REPO / "apps-script" / "PsiPunches.gs")],
                          input=json.dumps(two), capture_output=True, text=True, timeout=60)
    lock_out = json.loads(proc.stdout or "{}")
except (FileNotFoundError, ValueError) as exc:
    lock_out = {"error": str(exc)}
check("DOOR, ONE LOCK: the platform lock is let go before the full record is read or written — the pass "
      "lands, and no claim is left behind",
      lock_out.get("ok") == 200 and lock_out.get("lockFree") is True and lock_out.get("touchedWhileLocked") == 0
      and lock_out.get("claimLeft") is False and lock_out.get("lines") == 3, (lock_out, proc.stderr[-400:]))
check("DOOR, ONE LOCK: a pass that finds another's claim answers 409 without reading a cell, and leaves "
      "that claim alone",
      lock_out.get("busy") == {"status": 409, "read": 0, "othersClaimKept": True}, lock_out.get("busy"))
check("DOOR, ONE LOCK: a pass that throws still drops its claim — the next pass runs",
      lock_out.get("threw") is True and lock_out.get("claimAfterThrow") is False and lock_out.get("after") == 200
      and lock_out.get("lockFreeAtEnd") is True, lock_out)
check("DOOR: every pass is answered with the header this publish declares and the handed columns it does "
      "not carry — how the relay tells a pass that landed whole from one this door was too old to hold",
      (lock_out.get("said") or {}).get("columns") == len(full.HEADER)
      and (lock_out.get("said") or {}).get("dropped") == []
      and lock_out.get("droppedNames") == ["consumer_9_id"],
      (lock_out.get("said"), lock_out.get("droppedNames")))
service_gs = (REPO / "apps-script" / "ServiceIdentity.gs").read_text(encoding="utf-8")
guardian_gs = (REPO / "apps-script" / "Guardian.gs").read_text(encoding="utf-8")
check("DOOR: named on the service list (or refused at the identity) and on the Guardian's relay clock",
      "'psiPunchesFullIngest'" in service_gs and "'psiPunchesFullIngest'" in guardian_gs)
check("DOOR: never makes a tab — it asks the declared house, and answers a missing one as missing",
      "insertSheet" not in gs and "houseMoved_(PSI_PUNCHES_FULL_TAB)" in gs and "missing_tab: true" in gs)

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
