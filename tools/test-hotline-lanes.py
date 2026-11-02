#!/usr/bin/env python3
"""Asserts the Hotline's three sheet lanes inside asa-hub-snapshot, in memory, against fake books only."""
import base64
import json
import os
import subprocess
import sys

CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")
MODULES = ("snapshot_service", "hotline_desk", "hotline_lanes", "quo_inbox", "quo_pull",
           "mirror_first",
           # Its declaration rides in HUB_IST_CONFIG_DECLARATION_JSON.
           "ist_config",
           # the gates the relay's own doors ask before they reach the world
           "lane_gate",
           # The checkout's copies: a relay not yet restarted has none of these in /srv/app.
           "psi_anywhere", "psi_attendance", "psi_entries", "psi_reminders", "punch_board_slices",
           "house_directory", "daily_notes",
           "master_json", "comm_calls_feed", "redaction",
           "psi_punches_full", "psi_punches_feed", "psi_consumers",
           "badge_follows",
           "shift_requests", "house_cal_live", "shift_handoff",
           # the rehearsal of staff answers, imported at the top of snapshot_service
           "shift_rehearsal",
           "calendar_builder_houses", "calendar_builder_write",
           "effective_roster", "shift_slices",
           # the pair rule: a punch in AND a punch out per shift, the warning
           # that climbs to a director, and the reply ear that hears RECEIVED
           "punch_pairs",
           "sms_ears",
           "web_notices", "web_gate", "web_push",
           "time_off",
           # live chat's half, whose written-behind sends snapshot_service builds at import
           "chat_live")


def _run_in_container() -> int:
    here = os.path.abspath(__file__)
    server = os.path.join(os.path.dirname(os.path.dirname(here)), "server")
    sources = {}
    for name in MODULES:
        with open(os.path.join(server, name + ".py"), encoding="utf-8") as fh:
            sources[name] = fh.read()
    with open(here, encoding="utf-8") as fh:
        body = fh.read()
    blob = base64.b64encode(json.dumps(sources).encode()).decode()
    script = f"HOTLINE_LANES_SOURCES = {blob!r}\n" + body
    try:
        proc = subprocess.run(["docker", "exec", "-i", "-e", "HUB_IST_CONFIG_DECLARATION_JSON="
                               + open(os.path.join(server, "ist_config_defaults.json"),
                                      encoding="utf-8").read(), CONTAINER, "python3", "-"],
                              input=script, capture_output=True, text=True, timeout=300)
    except FileNotFoundError:
        print("docker is not available here — nothing to test against.")
        return 2
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode


# ── The books: live headers, made-up rows ──────────────────────────────────────
QUEUE_HEADER = ["Status", "Urgency", "Date Received", "Requestor", "Requestor Phone",
                "Type of Request", "Description of Request", "Notes", "Processed"]
# 45670 is a date cell (a serial day) in Ohio's book: midnight there, 05:00Z.
QUEUE_ROWS = [
    ["Pending", "High", 45670, "Jessica Book", 13309197779, "PSI - Reset Password",
     "Password reset for the client portal",
     "Named from the caller ID: Jessica Book — one person holds this line.", ""],
    ["", "", "", "", "", "", "", "", ""],
    ["Processed", "Low", 45671, "Alex Rivera", 13309190000, "Supplies",
     "Two boxes of gloves", "", "Processed"],
]
INCIDENTS_HEADER = ["Timestamp", "Your Name", "Client Name", "Incident Category",
                    "Incident Location", "Incident Date", "Incident Time",
                    "Incident Reported Date", "Incident Reported Time", "Employees Involved",
                    "Summary of Incident", "Immediate Action Taken",
                    "Cause and Contributing Factors", "Prevention Plan"]
INCIDENT_ROWS = [
    [46270.580718831014, "Dana Lee", "R. Client", "Injury", "House 12", 46270,
     0.5486111111094942, 46270, 0.5673611111124046, "Dana Lee", "Fell in the hallway",
     "First aid", "Wet floor", "Mats at the door"],
]
CALLOFFS_HEADER = ["id", "createdAt", "updatedAt", "timestamp", "employee_name", "date",
                   "type", "how_late", "notes", "your_name"]
CALLOFF_ROWS = [
    ["CO_9f1c2d3e4a5b", "2026-09-08T13:05:56Z", "2026-09-08T13:05:56Z", "9/5/2026 18:38:50",
     "Jordan Fields", "9/5/2026", "Call Off", "", "Sick", "Auto-processed (Hub)"],
]
# `caller` (column C) must never be asked for.
LOG_HEADER = ["call_id", "at", "caller", "items", "kinds", "status", "via"]
LOG_ROWS = [
    ["ACold000000000000000000000000001", "2026-09-14T11:11:24.522Z", "+13305550111", 1,
     "Request", "processed", "groq"],
]
# A header-only house: the flip is armed, not finished.
UI_HOUSE_STUB = ["id", "createdAt", "updatedAt"]
UI_HOUSE_FULL = ["id", "createdAt", "updatedAt", "timestamp", "your_name", "client_name",
                 "incident_category", "incident_location", "incident_date", "incident_time",
                 "incident_reported_date", "incident_reported_time", "employees_involved",
                 "summary_of_incident", "immediate_action_taken",
                 "cause_and_contributing_factors", "prevention_plan"]
UI_HOUSE_ID = "1uiHouseFake000000000000000000000000000000"
CALLOFFS_HOUSE_MOVED_ID = "1callOffsHouseMovedFake0000000000000000000"


def main_inside() -> int:  # noqa: C901 - one flat list of assertions reads best
    import asyncio
    import gc
    import importlib.abc
    import importlib.util
    import time
    import types

    # noqa: F821 below - HOTLINE_LANES_SOURCES is set by the host half
    sources = json.loads(base64.b64decode(HOTLINE_LANES_SOURCES))  # noqa: F821

    class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
        def find_spec(self, name, path, target=None):
            if name in sources:
                return importlib.util.spec_from_loader(name, self, origin="checkout:" + name)
            return None

        def create_module(self, spec):
            return None

        def exec_module(self, module):
            module.__file__ = "/srv/app/" + module.__name__ + ".py"
            exec(compile(sources[module.__name__], "checkout/" + module.__name__ + ".py", "exec"),
                 module.__dict__)

    os.environ["HUB_QUO_MESSAGES_KEY_FILE"] = "/nonexistent/hotline-lanes-test-messages.key"
    os.environ["HUB_QUO_API_KEY_FILE"] = "/nonexistent/hotline-lanes-test-api.key"
    os.environ["HUB_QUO_INBOX_DIR"] = "/nonexistent/hotline-lanes-test-inbox"
    os.environ["HUB_PSI_TY_SECRET_FILE"] = "/nonexistent/hotline-lanes-test-ty.json"
    os.environ["HUB_PSI_FULL_DIR"] = "/tmp/hotline-lanes-test-psi-full"
    sys.meta_path.insert(0, Checkout())
    sys.path.insert(0, "/srv/app")
    import snapshot_service as service  # noqa: E402
    desk = service.hotline_desk
    lanes = service.hotline_lanes

    results = {"ok": 0, "failed": []}

    def check(name, cond, detail=""):
        if cond:
            results["ok"] += 1
            print(f"ok   {name}")
        else:
            results["failed"].append(name)
            print(f"FAIL {name}{(' — ' + str(detail)[:400]) if detail else ''}")

    check("the checkout's modules are the ones imported",
          getattr(service.__spec__, "origin", "") == "checkout:snapshot_service"
          and lanes is not None
          and getattr(lanes.__spec__, "origin", "") == "checkout:hotline_lanes")
    check("/hub-lanes/hotline/lanes is routed",
          "/hub-lanes/hotline/lanes" in {r.path for r in service.app.routes})
    check("the lanes are keyed the way the whole platform keys them",
          lanes.LANE_KEYS == ("callOffs", "supportQueue", "uiIncidents"), lanes.LANE_KEYS)

    # ── the books, faked: a service with the shape the reader asks of one ──
    class Refused(Exception):
        def __init__(self, status):
            self.resp = types.SimpleNamespace(status=status)
            super().__init__(f"HTTP {status}")

    class Tab:
        def __init__(self, zone, header, rows):
            self.zone, self.header, self.rows = zone, list(header), [list(r) for r in rows]
            self.error = None
            self.delay_s = 0.0

    class FakeSheets:
        """spreadsheets().get / values().batchGet, and nothing else."""

        def __init__(self, tabs):
            self.tabs = tabs
            self.requests = []
            self.ranges = []

        def __call__(self, *a, **kw):
            return self

        def spreadsheets(self):
            return self

        def values(self):
            return self

        def _tab(self, sheet_id):
            tab = self.tabs.get(sheet_id)
            if tab is None:
                raise Refused(404)
            if tab.delay_s:
                time.sleep(tab.delay_s)
            if tab.error is not None:
                raise tab.error
            return tab

        def get(self, spreadsheetId=None, ranges=None, includeGridData=None, fields=None):
            def run(num_retries=0):
                self.requests.append(("meta", spreadsheetId))
                tab = self._tab(spreadsheetId)
                return {"properties": {"timeZone": tab.zone},
                        "sheets": [{"data": [{"rowData": [
                            {"values": [{"formattedValue": h} for h in tab.header]}]}]}]}
            return types.SimpleNamespace(execute=run)

        def batchGet(self, spreadsheetId=None, ranges=None, majorDimension=None,
                     valueRenderOption=None, dateTimeRenderOption=None):
            def run(num_retries=0):
                self.requests.append(("columns", spreadsheetId))
                self.ranges.extend((spreadsheetId, r) for r in (ranges or []))
                tab = self._tab(spreadsheetId)
                out = []
                for rng in ranges or []:
                    letters = rng.split("!")[-1].split(":")[0]
                    idx = 0
                    for ch in letters:
                        idx = idx * 26 + (ord(ch) - 64)
                    idx -= 1
                    col = [tab.header[idx] if idx < len(tab.header) else ""]
                    col += [(r[idx] if idx < len(r) else "") for r in tab.rows]
                    while col and col[-1] == "":
                        col.pop()
                    out.append({"values": [col]})
                return {"valueRanges": out}
            return types.SimpleNamespace(execute=run)

    QUEUE_ID = lanes.LANE_BY_KEY["supportQueue"].book.sheet_id
    INCIDENTS_ID = lanes.LANE_BY_KEY["uiIncidents"].book.sheet_id
    CALLOFFS_ID = lanes.LANE_BY_KEY["callOffs"].book.sheet_id
    LOG_ID = desk.HOTLINE_LOG.sheet_id

    def fresh_books():
        return {QUEUE_ID: Tab("America/New_York", QUEUE_HEADER, QUEUE_ROWS),
                INCIDENTS_ID: Tab("America/Detroit", INCIDENTS_HEADER, INCIDENT_ROWS),
                CALLOFFS_ID: Tab("Etc/GMT", CALLOFFS_HEADER, CALLOFF_ROWS),
                LOG_ID: Tab("UTC", LOG_HEADER, LOG_ROWS),
                UI_HOUSE_ID: Tab("Etc/GMT", UI_HOUSE_STUB, []),
                CALLOFFS_HOUSE_MOVED_ID: Tab("Etc/GMT", CALLOFFS_HEADER, CALLOFF_ROWS)}

    def reset(books=None):
        """A clean process state for one scenario."""
        for key in lanes.LANE_KEYS:
            lanes._HELD[key].update({"lane": None, "at": 0.0, "task": None,
                                     "failure": "", "failed_at": 0.0})
            lanes._HELD[key]["gen"] = int(lanes._HELD[key]["gen"]) + 1
            desk._LAST_GOOD.pop(f"hotline_lane_{key}", None)
        desk._ZONES.clear()
        desk._HEADERS.clear()
        desk._QUOTA.update({"until": 0.0, "at": 0.0})
        lanes._HEADER_AT.clear()
        lanes._HEADER_GAPS.clear()
        lanes._HOUSE_SAID.clear()
        # Pinned empty so nothing here reads the platform's database.
        lanes._DEPOT.update({"until": time.time() + 600, "facts": {}})
        lanes._LOG.update({"at": 0.0, "by_call": {}, "task": None,
                           "failure": "", "failed_at": 0.0})
        del lanes._LANE_SERVICES[:]
        return FakeSheets(books or fresh_books())

    def reads_of(sheets, sheet_id):
        return sum(1 for kind, sid in sheets.requests if sid == sheet_id)

    async def run():  # noqa: C901
        # ── what a row carries ───────────────────────────────────────────
        sheets = reset()
        got = await lanes.current_lanes(sheets, pg_dsn="")
        queue, incidents = got["lanes"]["supportQueue"], got["lanes"]["uiIncidents"]
        calloffs = got["lanes"]["callOffs"]
        blob = json.dumps(got, default=str)

        asked = [r for sid, r in sheets.ranges if sid == QUEUE_ID]
        phone_col = "'Requests'!" + chr(65 + QUEUE_HEADER.index("Requestor Phone"))
        check("queue: the queue's own phone column is read, as the screen draws it",
              any(r.startswith(phone_col) for r in asked) and len(asked) == 9, asked)
        check("queue: the number the queue sheet carries reaches the screen",
              (queue["rows"] or [{}])[0].get("requestor_phone") == "13309197779"
              and "13309197779" in blob, (queue["rows"] or [{}])[0])
        check("a CALLER's phone column is refused by name, whatever a header says",
              all(w in lanes._NEVER_READ for w in ("caller", "caller_phone", "Caller Phone"))
              and "requestor_phone" not in lanes._NEVER_READ)
        drawn = sorted(["id", "status", "urgency", "date_received", "requestor",
                        "requestor_phone", "type_of_request", "description_of_request",
                        "notes", "processed"])
        check("queue: the row carries the fields the screen draws, and only those",
              [sorted(r) for r in (queue["rows"] or [])] == [drawn, drawn], queue["rows"])
        check("queue: a date cell is the instant the book holds, never a serial",
              (queue["rows"] or [{}])[0].get("date_received") == "2025-01-13T05:00:00.000Z",
              queue["rows"])
        check("queue: a blank row is skipped and the rows below keep their place",
              [r["id"] for r in (queue["rows"] or [])] == ["r2", "r4"], queue["rows"])
        check("incidents: a cell holding only a time is the hour as typed",
              (incidents["rows"] or [{}])[0].get("incident_time") == "13:10"
              and (incidents["rows"] or [{}])[0].get("incident_reported_time") == "13:37",
              incidents["rows"])
        check("incidents: a date and hour cell is one instant",
              (incidents["rows"] or [{}])[0].get("timestamp") == "2026-09-05T17:56:14.107Z",
              incidents["rows"])
        check("calloffs: the row keeps the id the house minted",
              (calloffs["rows"] or [{}])[0].get("id") == "CO_9f1c2d3e4a5b", calloffs["rows"])
        check("calloffs: a column the house does not have yet is not emitted",
              "call_id" not in (calloffs["rows"] or [{}])[0]
              and "call_id" not in calloffs["source"]["fields"], calloffs["source"])
        check("calloffs: text the platform wrote passes through as it stands",
              (calloffs["rows"] or [{}])[0].get("timestamp") == "9/5/2026 18:38:50"
              and (calloffs["rows"] or [{}])[0].get("createdAt") == "2026-09-08T13:05:56Z")
        check("every lane names its book, its tab and its columns",
              all(got["lanes"][k]["source"]["book"] and got["lanes"][k]["source"]["tab"]
                  and got["lanes"][k]["source"]["fields"][0] == "id" for k in lanes.LANE_KEYS))
        check("the answer carries one version over the three, and each lane its own",
              len(got["version"]) == 16 and all(len(got["lanes"][k]["version"]) == 16
                                                for k in lanes.LANE_KEYS))
        check("with no depot to ask, every lane says it is on its named book",
              all(got["lanes"][k]["source"]["pointer"] == "named" for k in lanes.LANE_KEYS),
              {k: got["lanes"][k]["source"] for k in lanes.LANE_KEYS})
        check("every lane stamps when its rows were read, under both names",
              all(got["lanes"][k]["read_at"] and got["lanes"][k]["at"]
                  == got["lanes"][k]["read_at"] and isinstance(got["lanes"][k]["age_ms"], int)
                  for k in lanes.LANE_KEYS),
              {k: (got["lanes"][k]["read_at"], got["lanes"][k]["at"]) for k in lanes.LANE_KEYS})
        check("a lane that was read says it is not a copy",
              all(got["lanes"][k]["stale"] is False for k in lanes.LANE_KEYS))
        check("the per-lane health is kept under the platform's own words",
              sorted(k for k in desk._LAST_GOOD if k.startswith("hotline_lane_"))
              == ["hotline_lane_callOffs", "hotline_lane_supportQueue",
                  "hotline_lane_uiIncidents"],
              sorted(k for k in desk._LAST_GOOD if k.startswith("hotline_lane_")))

        sheets = reset()
        sheets.tabs[CALLOFFS_ID].header = CALLOFFS_HEADER + ["call_id", "name_from"]
        sheets.tabs[CALLOFFS_ID].rows = [CALLOFF_ROWS[0] + ["ACtest0000", "person"]]
        one = await lanes.current_lanes(sheets, ("callOffs",), pg_dsn="")
        check("calloffs: the call the row came from travels with it once the house has it",
              (one["lanes"]["callOffs"]["rows"] or [{}])[0].get("call_id") == "ACtest0000"
              and (one["lanes"]["callOffs"]["rows"] or [{}])[0].get("name_from") == "person",
              one["lanes"]["callOffs"]["rows"])

        # ── the column the writer appends to a running relay ─────────────
        # The header cache is deliberately NOT cleared: nothing moved, so the column check never fires.
        sheets = reset()
        await lanes.current_lanes(sheets, ("callOffs",), pg_dsn="")
        sheets.tabs[CALLOFFS_ID].header = CALLOFFS_HEADER + ["call_id", "name_from"]
        sheets.tabs[CALLOFFS_ID].rows = [CALLOFF_ROWS[0] + ["ACfiled0001", "person"]]
        warm = await lanes.current_lanes(sheets, ("callOffs",), pg_dsn="", max_age_s=0.0)
        check("a warm relay does not re-read the header on every pass",
              "call_id" not in (warm["lanes"]["callOffs"]["rows"] or [{}])[0],
              warm["lanes"]["callOffs"]["rows"])
        service._hotline_lanes_stale()
        filed = await lanes.current_lanes(sheets, ("callOffs",), pg_dsn="")
        check("a filing makes the next read ask the house for its header again",
              (filed["lanes"]["callOffs"]["rows"] or [{}])[0].get("call_id") == "ACfiled0001"
              and "call_id" in filed["lanes"]["callOffs"]["source"]["fields"],
              filed["lanes"]["callOffs"]["rows"])
        sheets = reset()
        await lanes.current_lanes(sheets, ("callOffs",), pg_dsn="")
        sheets.tabs[CALLOFFS_ID].header = CALLOFFS_HEADER + ["call_id", "name_from"]
        sheets.tabs[CALLOFFS_ID].rows = [CALLOFF_ROWS[0] + ["ACaged00001", "phone"]]
        kept_ttl, lanes.LANE_HEADER_TTL_S = lanes.LANE_HEADER_TTL_S, 0.0
        aged = await lanes.current_lanes(sheets, ("callOffs",), pg_dsn="", max_age_s=0.0)
        lanes.LANE_HEADER_TTL_S = kept_ttl
        check("a header older than its own age is asked for again",
              (aged["lanes"]["callOffs"]["rows"] or [{}])[0].get("call_id") == "ACaged00001",
              aged["lanes"]["callOffs"]["rows"])

        # ── a column that cannot arrive is asked for once more, then believed ──
        sheets = reset()
        kept_ttl, lanes.LANE_HEADER_TTL_S = lanes.LANE_HEADER_TTL_S, 0.0
        await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="")
        cold = reads_of(sheets, QUEUE_ID)
        await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="", max_age_s=0.0)
        asked_again = reads_of(sheets, QUEUE_ID) - cold
        steady = reads_of(sheets, QUEUE_ID)
        for _ in range(3):
            await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="", max_age_s=0.0)
        per_pass = (reads_of(sheets, QUEUE_ID) - steady) / 3.0
        check("a column the book will never carry is asked for once more, then left alone",
              cold == 2 and asked_again == 2 and per_pass == 1.0,
              (cold, asked_again, per_pass))
        before_filing = reads_of(sheets, QUEUE_ID)
        lanes.invalidate(("supportQueue",))
        await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="", max_age_s=0.0)
        check("and a filing asks once more again — that is when a column is appended",
              reads_of(sheets, QUEUE_ID) - before_filing == 2,
              reads_of(sheets, QUEUE_ID) - before_filing)
        lanes.LANE_HEADER_TTL_S = kept_ttl

        # ── the platform's pointer, for all three lanes ───────────────────
        sheets = reset()
        lanes._DEPOT.update(until=time.time() + 600, facts={
            "switchboard:props.EMP360_WORK_QUEUE_ID": QUEUE_ID,
            "switchboard:props.ESTATE_UI_ID": INCIDENTS_ID,
            "switchboard:props.HUB_HOUSE_UIINCIDENTS_ID": UI_HOUSE_ID,
            "switchboard:moved.uiIncidents": "on",
            "switchboard:props.HUB_HOUSE_CALLOFFS_ID": CALLOFFS_HOUSE_MOVED_ID,
            "switchboard:moved.callOffs": "on"})
        placed = await lanes.current_lanes(sheets, pg_dsn="the depot is faked above")
        check("call offs follow the house the depot names, not the id in the file",
              placed["lanes"]["callOffs"]["source"]["pointer"] == "house"
              and placed["lanes"]["callOffs"]["source"]["fact"]
              == "switchboard:props.HUB_HOUSE_CALLOFFS_ID"
              and reads_of(sheets, CALLOFFS_HOUSE_MOVED_ID) > 0
              and reads_of(sheets, CALLOFFS_ID) == 0,
              placed["lanes"]["callOffs"]["source"])
        check("the queue follows the estate property Emp360 shares with it",
              placed["lanes"]["supportQueue"]["source"]["pointer"] == "estate"
              and placed["lanes"]["supportQueue"]["source"]["fact"]
              == "switchboard:props.EMP360_WORK_QUEUE_ID",
              placed["lanes"]["supportQueue"]["source"])
        check("incidents stay on the estate while the house is an empty stub",
              placed["lanes"]["uiIncidents"]["source"]["pointer"] == "estate"
              and placed["lanes"]["uiIncidents"]["count"] == 1,
              placed["lanes"]["uiIncidents"]["source"])
        # A header alone is not a flip: the rows may still sit in the estate book.
        sheets.tabs[UI_HOUSE_ID].header = UI_HOUSE_FULL
        lanes.invalidate()
        header_only = await lanes.current_lanes(sheets, ("uiIncidents",), pg_dsn="faked")
        check("a house with the right header and no rows never takes the lane off the estate",
              header_only["lanes"]["uiIncidents"]["source"]["pointer"] == "estate"
              and header_only["lanes"]["uiIncidents"]["count"] == 1
              and header_only["lanes"]["uiIncidents"]["ok"] is True,
              header_only["lanes"]["uiIncidents"]["source"])

        sheets.tabs[UI_HOUSE_ID].rows = [
            ["UI_0001", "2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z",
             "2026-09-05T17:56:14.107Z", "Dana Lee", "R. Client", "Injury", "House 12",
             "9/5/2026", "13:10", "9/5/2026", "13:37", "Dana Lee", "Fell in the hallway",
             "First aid", "Wet floor", "Mats at the door"]]
        lanes.invalidate()
        flipped = await lanes.current_lanes(sheets, ("uiIncidents",), pg_dsn="faked")
        check("and the moment the house carries the rows, the lane follows it",
              flipped["lanes"]["uiIncidents"]["source"]["pointer"] == "house"
              and flipped["lanes"]["uiIncidents"]["source"]["fact"]
              == "switchboard:props.HUB_HOUSE_UIINCIDENTS_ID",
              flipped["lanes"]["uiIncidents"]["source"])
        check("a row reads the same in the house as it did in the estate book",
              (flipped["lanes"]["uiIncidents"]["rows"] or [{}])[0].get("timestamp")
              == "2026-09-05T17:56:14.107Z"
              and (flipped["lanes"]["uiIncidents"]["rows"] or [{}])[0].get("your_name")
              == "Dana Lee"
              and (flipped["lanes"]["uiIncidents"]["rows"] or [{}])[0].get("id") == "UI_0001",
              flipped["lanes"]["uiIncidents"]["rows"])
        estate_label = lanes.LANE_BY_KEY["uiIncidents"].book.label
        check("the house is read under its own name, never the estate book's",
              flipped["lanes"]["uiIncidents"]["source"]["book"] != estate_label
              and "house" in flipped["lanes"]["uiIncidents"]["source"]["book"],
              flipped["lanes"]["uiIncidents"]["source"])
        sheets.tabs[UI_HOUSE_ID].error = Refused(403)
        refused = await lanes.current_lanes(sheets, ("uiIncidents",), pg_dsn="faked",
                                            max_age_s=0.0)
        check("and a refusal names the book that was actually read",
              refused["lanes"]["uiIncidents"]["ok"] is False
              and estate_label not in refused["lanes"]["uiIncidents"]["error"]
              and "house" in refused["lanes"]["uiIncidents"]["error"],
              refused["lanes"]["uiIncidents"]["error"])
        sheets.tabs[UI_HOUSE_ID].error = None
        lanes._DEPOT.update({"until": time.time() + 600, "facts": {}})

        # ── a lane that cannot be read ───────────────────────────────────
        sheets = reset()
        sheets.tabs[INCIDENTS_ID].error = Refused(403)
        got = await lanes.current_lanes(sheets, pg_dsn="")
        check("one lane that cannot be read leaves the other two standing",
              got["lanes"]["uiIncidents"]["ok"] is False
              and got["lanes"]["uiIncidents"]["reason"] == "unreadable"
              and got["lanes"]["uiIncidents"]["rows"] is None
              and got["lanes"]["supportQueue"]["ok"] is True
              and got["lanes"]["callOffs"]["ok"] is True,
              got["lanes"]["uiIncidents"])
        check("a lane never read answers null, never an empty lane",
              got["lanes"]["uiIncidents"]["count"] is None
              and got["lanes"]["uiIncidents"]["age_ms"] is None
              and got["lanes"]["uiIncidents"]["read_at"] == ""
              and "could not be read" in got["lanes"]["uiIncidents"]["error"],
              got["lanes"]["uiIncidents"]["error"])
        check("the tab that could not be read is named in the sentence",
              "UI/MUI" in got["lanes"]["uiIncidents"]["error"] or "incidents"
              in got["lanes"]["uiIncidents"]["error"], got["lanes"]["uiIncidents"]["error"])

        sheets.tabs[INCIDENTS_ID].error = None
        good = await lanes.current_lanes(sheets, ("uiIncidents",), pg_dsn="", max_age_s=0.0)
        await asyncio.sleep(1.05)
        sheets.tabs[INCIDENTS_ID].error = Refused(403)
        held = await lanes.current_lanes(sheets, ("uiIncidents",), pg_dsn="", max_age_s=0.0)
        check("a lane that fails after a good read serves the copy it holds, and says so",
              good["lanes"]["uiIncidents"]["ok"] is True
              and held["lanes"]["uiIncidents"]["ok"] is False
              and held["lanes"]["uiIncidents"]["reason"] == "unreadable"
              and held["lanes"]["uiIncidents"]["rows"] == good["lanes"]["uiIncidents"]["rows"]
              and "Showing the copy read at" in held["lanes"]["uiIncidents"]["error"],
              held["lanes"]["uiIncidents"]["error"])
        check("and it never looks healthy: the copy is marked and dated as the copy",
              held["lanes"]["uiIncidents"]["stale"] is True
              and held["lanes"]["uiIncidents"]["read_at"]
              == good["lanes"]["uiIncidents"]["read_at"]
              and held["lanes"]["uiIncidents"]["at"] == held["lanes"]["uiIncidents"]["read_at"]
              and held["lanes"]["uiIncidents"]["age_ms"]
              > good["lanes"]["uiIncidents"]["age_ms"],
              (good["lanes"]["uiIncidents"]["read_at"], held["lanes"]["uiIncidents"]["read_at"],
               held["lanes"]["uiIncidents"]["age_ms"]))

        sheets = reset()
        sheets.tabs[QUEUE_ID].header = [h if h != "Date Received" else "Received On"
                                        for h in QUEUE_HEADER]
        got = await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="")
        check("a tab that lost the column the rows are dated by says which column",
              got["lanes"]["supportQueue"]["ok"] is False
              and "'Date Received'" in got["lanes"]["supportQueue"]["error"],
              got["lanes"]["supportQueue"]["error"])

        # ── the cache ────────────────────────────────────────────────────
        sheets = reset()
        many = await asyncio.gather(*(lanes.current_lanes(sheets, pg_dsn="") for _ in range(10)))
        check("ten screens at once cost one read per lane (a header and the columns)",
              all(reads_of(sheets, sid) == 2 for sid in (QUEUE_ID, INCIDENTS_ID, CALLOFFS_ID))
              and all(m["version"] == many[0]["version"] for m in many),
              sheets.requests)
        before = len(sheets.requests)
        await lanes.current_lanes(sheets, pg_dsn="")
        check("a copy younger than the max age is not read again",
              len(sheets.requests) == before)
        await lanes.current_lanes(sheets, pg_dsn="", max_age_s=0.0)
        check("a copy older than the max age is read again", len(sheets.requests) > before)

        sheets = reset()
        first = await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="")
        again = await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="", max_age_s=0.0)
        check("the version stands still when nothing changed",
              first["lanes"]["supportQueue"]["version"]
              == again["lanes"]["supportQueue"]["version"])
        sheets.tabs[QUEUE_ID].rows = QUEUE_ROWS + [
            ["Pending", "High", 45672, "Jessica Book", 13309197779, "PSI - Reset Password",
             "Reset the portal password", "", ""]]
        lanes.invalidate(("supportQueue",))
        landed = await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="")
        check("the version moves the moment a row lands",
              landed["lanes"]["supportQueue"]["version"]
              != first["lanes"]["supportQueue"]["version"]
              and landed["lanes"]["supportQueue"]["count"] == 3,
              landed["lanes"]["supportQueue"]["count"])
        check("a filing drops the copies: the next read goes to the books",
              reads_of(sheets, QUEUE_ID) >= 2)

        sheets = reset()
        sheets.tabs[QUEUE_ID].delay_s = 0.4
        slow = asyncio.ensure_future(lanes.current_lanes(sheets, ("supportQueue",), pg_dsn=""))
        await asyncio.sleep(0.1)
        lanes.invalidate(("supportQueue",))
        await slow
        await asyncio.sleep(0.05)
        sheets.tabs[QUEUE_ID].delay_s = 0.0
        made = len(sheets.requests)
        await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="")
        check("a read that started before the filing is never taken as fresh",
              len(sheets.requests) > made, (made, len(sheets.requests)))

        # ── the quota pause the desk shares ──────────────────────────────
        sheets = reset()
        await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="")
        held_rows = lanes._HELD["supportQueue"]["lane"]["rows"]
        sheets.tabs[QUEUE_ID].error = Refused(429)
        await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="", max_age_s=0.0)
        check("a 429 starts the desk's pause, the one every reader asks about",
              desk.quota_hold_left() > 0)
        sheets.tabs[QUEUE_ID].error = None
        made = len(sheets.requests)
        paused = await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="", max_age_s=0.0)
        check("while the pause is on the held copy answers and no read is made",
              len(sheets.requests) == made
              and paused["lanes"]["supportQueue"]["rows"] == held_rows)

        # A 429 another reader took freezes this lane too; the held copy must say so.
        sheets = reset()
        fresh = await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="")
        made = len(sheets.requests)
        desk._QUOTA.update({"until": time.time() + 60, "at": time.time()})
        elsewhere = await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="",
                                              max_age_s=0.0)
        lane_said = elsewhere["lanes"]["supportQueue"]
        check("a lane frozen by a pause another reader started never answers healthy",
              lane_said["ok"] is False and lane_said["stale"] is True
              and lane_said["reason"] == "unreadable" and "quota" in lane_said["error"]
              and lane_said["rows"] == fresh["lanes"]["supportQueue"]["rows"]
              and len(sheets.requests) == made, lane_said)
        check("and the copy keeps its own date while the news of it moves",
              lane_said["read_at"] == fresh["lanes"]["supportQueue"]["read_at"]
              and lane_said["version"] != fresh["lanes"]["supportQueue"]["version"]
              and "Showing the copy read at" in lane_said["error"],
              (lane_said["read_at"], lane_said["error"]))
        desk._QUOTA.update({"until": 0.0, "at": 0.0})

        kept_build = lanes.build_lane

        def no_service(*a, **kw):
            raise RuntimeError("no Sheets service")

        lanes.build_lane = no_service
        raised = await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="", max_age_s=0.0)
        lanes.build_lane = kept_build
        check("a read that fails outside the desk's own hands still marks the copy",
              raised["lanes"]["supportQueue"]["ok"] is False
              and raised["lanes"]["supportQueue"]["stale"] is True
              and "RuntimeError" in raised["lanes"]["supportQueue"]["error"]
              and raised["lanes"]["supportQueue"]["rows"]
              == fresh["lanes"]["supportQueue"]["rows"],
              raised["lanes"]["supportQueue"])

        sheets = reset()
        sheets.tabs[QUEUE_ID].error = Refused(429)
        await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="")
        made = len(sheets.requests)
        empty = await lanes.current_lanes(sheets, ("supportQueue",), pg_dsn="", max_age_s=0.0)
        check("with nothing held, the pause is the lane's answer and nothing is asked",
              len(sheets.requests) == made and empty["lanes"]["supportQueue"]["rows"] is None
              and empty["lanes"]["supportQueue"]["reason"] == "unreadable"
              and "quota" in empty["lanes"]["supportQueue"]["error"],
              empty["lanes"]["supportQueue"]["error"])

        # ── a lane read never makes the calls index wait ─────────────────
        sheets = reset()
        check("the lanes have threads of their own",
              lanes._LANE_POOL is not desk._DESK_POOL and lanes._LANE_POOL is not desk._GATE_POOL)
        for sid in (QUEUE_ID, INCIDENTS_ID, CALLOFFS_ID):
            sheets.tabs[sid].delay_s = 1.0
        busy = asyncio.ensure_future(lanes.current_lanes(sheets, pg_dsn=""))
        await asyncio.sleep(0.15)
        t0 = time.time()
        ran = await desk.run_on_desk(lambda: "the index's thread")
        waited = time.time() - t0
        await busy
        check("a lane read never makes the calls index wait for a thread",
              ran == "the index's thread" and waited < 0.5, f"{waited:.2f}s")
        for sid in (QUEUE_ID, INCIDENTS_ID, CALLOFFS_ID):
            sheets.tabs[sid].delay_s = 0.0

        # Three lanes plus the log watch are four jobs on one pool.
        sheets = reset()
        check("the lanes carry a thread for the log watch beside their own",
              lanes._LANE_POOL._max_workers >= len(lanes.LANES) + 1,
              lanes._LANE_POOL._max_workers)
        for sid in (QUEUE_ID, INCIDENTS_ID, CALLOFFS_ID, LOG_ID):
            sheets.tabs[sid].delay_s = 0.5
        watching = asyncio.ensure_future(
            lanes.call_verdict(sheets, "ACnotyet0000000000000000000000"))
        await asyncio.sleep(0.1)
        t0 = time.time()
        await lanes.current_lanes(sheets, pg_dsn="")
        pass_s = time.time() - t0
        await watching
        check("a lanes pass while a call is filing never queues behind the log's read",
              pass_s < 1.5, f"{pass_s:.2f}s")
        for sid in (QUEUE_ID, INCIDENTS_ID, CALLOFFS_ID, LOG_ID):
            sheets.tabs[sid].delay_s = 0.0

        # ── the door ─────────────────────────────────────────────────────
        sheets = reset()
        service.hotline_desk.sheets_client = sheets
        opened = {"role": "manager", "uid": "u-1"}
        gate_said = []

        async def fake_actor(authorization="", app_id="smartcomms", **kw):
            gate_said.append((authorization, app_id, tuple(sorted(kw))))
            if authorization == "Bearer open":
                return (opened["role"], opened["uid"])
            return {"status": 401, "reason": "session", "message": "sign in first"}

        real_actor = service._hotline_actor
        service._hotline_actor = fake_actor
        answer = await service.lane_hotline_lanes(authorization="Bearer open")
        check("the door answers all three lanes at once, under the screen's own keys",
              answer["status"] == 200
              and sorted(answer["data"]["lanes"]) == sorted(["callOffs", "supportQueue",
                                                             "uiIncidents"])
              and answer["data"]["lanes"]["supportQueue"]["count"] == 2,
              answer.get("data", answer))
        check("every lane says how old the copy the screen is looking at is",
              all(isinstance(answer["data"]["lanes"][k]["age_ms"], int) for k in lanes.LANE_KEYS))
        one = await service.lane_hotline_lanes(name="supportQueue", authorization="Bearer open")
        check("the door answers one lane when the screen asks for one",
              one["status"] == 200 and list(one["data"]["lanes"]) == ["supportQueue"])
        cased = await service.lane_hotline_lanes(name="calloffs", authorization="Bearer open")
        check("a lane asked for in any case is the same lane",
              cased["status"] == 200 and list(cased["data"]["lanes"]) == ["callOffs"], cased)
        same = await service.lane_hotline_lanes(since=answer["data"]["version"],
                                               authorization="Bearer open")
        check("a screen already holding this version is sent the news, not the megabyte",
              same["status"] == 200 and same["data"]["unchanged"] is True
              and all("rows" not in same["data"]["lanes"][k] for k in lanes.LANE_KEYS)
              and same["data"]["lanes"]["supportQueue"]["count"] == 2
              and same["data"]["version"] == answer["data"]["version"], same.get("data"))
        check("and the news it is sent is a whole lane but the rows",
              all(all(f in same["data"]["lanes"][k] for f in
                      ("ok", "reason", "error", "stale", "count", "version", "read_at",
                       "at", "age_ms", "source"))
                  for k in lanes.LANE_KEYS), same["data"]["lanes"]["supportQueue"])
        sheets.tabs[QUEUE_ID].rows = QUEUE_ROWS + [
            ["Pending", "High", 45673, "Sam Ortiz", 13309190001, "Supplies", "Batteries", "", ""]]
        lanes.invalidate()
        moved = await service.lane_hotline_lanes(since=answer["data"]["version"],
                                                authorization="Bearer open")
        check("and the rows the moment one lands",
              moved["data"]["unchanged"] is False
              and moved["data"]["lanes"]["supportQueue"]["count"] == 3
              and moved["data"]["version"] != answer["data"]["version"],
              moved["data"]["version"])
        one_since = await service.lane_hotline_lanes(name="supportQueue",
                                                    since=moved["data"]["version"],
                                                    authorization="Bearer open")
        check("one lane asked with a version of all three is never mistaken for unchanged",
              one_since["data"]["unchanged"] is False
              and one_since["data"]["lanes"]["supportQueue"]["rows"] is not None,
              one_since["data"]["version"])
        sheets.tabs[QUEUE_ID].rows = [list(r) for r in QUEUE_ROWS]
        lanes.invalidate()
        bad = await service.lane_hotline_lanes(name="transcripts", authorization="Bearer open")
        check("a lane nobody has is a 400, never a guess",
              bad["status"] == 400 and "supportQueue" in bad["message"], bad)
        shut = await service.lane_hotline_lanes(authorization="")
        check("the door is the calls door's gate: no session, no lanes",
              shut == {"status": 401, "reason": "session", "message": "sign in first"}
              and gate_said[-1][0] == "", shut)
        check("the gate is asked about Smart Comms, exactly as the calls door asks",
              gate_said[0][1] == "smartcomms" and gate_said[0][2] == (), gate_said[0])

        for reason, status in (("badge", 403), ("stale", 403), ("restricted", 403),
                               ("unreadable", 503)):
            async def refusing(authorization="", app_id="smartcomms", _r=reason, _s=status, **kw):
                return {"status": _s, "reason": _r, "message": "no"}
            service._hotline_actor = refusing
            said = await service.lane_hotline_lanes(authorization="Bearer x")
            check(f"the door hands back the gate's '{reason}' refusal untouched",
                  said == {"status": status, "reason": reason, "message": "no"}, said)
        service._hotline_actor = fake_actor

        sheets.tabs[INCIDENTS_ID].error = Refused(403)
        lanes.invalidate()
        mixed = await service.lane_hotline_lanes(authorization="Bearer open")
        check("one lane unreadable never refuses the door",
              mixed["status"] == 200 and mixed["data"]["lanes"]["uiIncidents"]["ok"] is False
              and mixed["data"]["lanes"]["supportQueue"]["ok"] is True,
              mixed["data"]["lanes"]["uiIncidents"])
        sheets.tabs[INCIDENTS_ID].error = None

        kept_lanes = service.hotline_lanes
        service.hotline_lanes = None
        gone = await service.lane_hotline_lanes(authorization="Bearer open")
        check("a reader that did not load is a 503 the screen can say a sentence for",
              gone["status"] == 503 and gone["reason"] == "unreadable", gone)
        service.hotline_lanes = kept_lanes
        service._hotline_actor = real_actor

        # ── a filing, and the clock ──────────────────────────────────────
        sheets = reset()
        service.hotline_desk.sheets_client = sheets
        await lanes.current_lanes(sheets, pg_dsn="")
        made = len(sheets.requests)
        dirtied, published = [], []

        def fake_mark_dirty(names):
            dirtied.append(tuple(names))
            return []

        real_mark_dirty, real_publish = service._mark_dirty, service._publish_slice
        service._mark_dirty = fake_mark_dirty
        service._publish_slice = published.append

        # a stand-in for asa-hub-app: nothing of this file reaches the live app's tables
        filed_answers = {"hotlineCallKeep": {"status": 200, "data": {"kept": True}},
                         "hotlineShadowAsk": {"status": 200, "data": {"enabled": True, "ask": "orders"}},
                         "hotlineFile": {"status": 200, "data": {"state": "filed", "kinds": ["Request"],
                                                                 "items": 1}}}
        python_asked = []

        async def python_door(app_id, action, payload, user, extra=None, timeout=None):
            python_asked.append(action)
            env = filed_answers.get(action)
            return None if env is None else (json.dumps(env).encode(), time.time(), dict(env), None, 0.0)

        async def model(_text):
            return "{}", "test"

        # never restored: whatever the filing starts behind it (the lane mirrors' rewrite) asks this stand-in too
        service._backend_call, service._hotline_model = python_door, model
        service._lane_mirror_after_filing_kick = lambda: python_asked.append("laneMirrorAfterFiling")
        CALL_ONE = "ACtest00000000000000000000000001"
        desk.overlay_put(CALL_ONE, at="2026-09-17T20:18:02Z", duration=30, dialogue=[])
        await service._hotline_python_file({"call_id": CALL_ONE, "dialogue": []}, time.time(), None)
        check("a call Python filed drops the held copies and rings the screens",
              python_asked[:3] == ["hotlineCallKeep", "hotlineShadowAsk", "hotlineFile"]
              and lanes._HELD["supportQueue"]["at"] == 0.0 and "hotline:calls" in published, python_asked)
        check("and the slices every other screen reads are marked",
              dirtied and dirtied[0] == service.HOTLINE_FAST_SLICES, dirtied)
        after = await lanes.current_lanes(sheets, pg_dsn="")
        check("so the next poll reads the books, not the copy",
              len(sheets.requests) > made and after["lanes"]["supportQueue"]["count"] == 2)

        # ── the processing log, read by the lanes' own reader ──
        sheets = reset()
        service.hotline_desk.sheets_client = sheets
        kept_interval, lanes.LOG_READ_EVERY_S = lanes.LOG_READ_EVERY_S, 0.05

        def now_stamp(offset_s=0.0):
            return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + offset_s))

        CALL_THREE = "ACtest00000000000000000000000003"
        sheets.tabs[LOG_ID].rows = LOG_ROWS + [
            [CALL_THREE, "2026-09-14T20:20:31.000Z", "+13305550133", 0, "",
             "blocked", "groq refused: an earlier pass"],
            [CALL_THREE, now_stamp(), "+13305550133", 0, "",
             "blocked", "groq refused: content"]]
        lanes._LOG.update({"at": 0.0, "by_call": {}, "task": None})
        first = await lanes.call_verdict(sheets, CALL_THREE, time.time() - 60)
        check("the log's newest line for a call is its word, never an earlier pass's",
              first is not None and first["status"] == "blocked" and "content" in str(first), first)
        desk._QUOTA.update({"until": time.time() + 60, "at": time.time()})
        lanes._LOG.update({"at": 0.0, "by_call": {}, "task": None})
        made = reads_of(sheets, LOG_ID)
        quiet = await lanes.call_verdict(sheets, CALL_THREE)
        check("while the desk holds its reads, the log is not asked either",
              quiet is None and reads_of(sheets, LOG_ID) == made)
        desk._QUOTA.update({"until": 0.0, "at": 0.0})
        lanes._LOG.update({"at": 0.0, "by_call": {}, "task": None})
        made = reads_of(sheets, LOG_ID)
        both = await asyncio.gather(lanes.call_verdict(sheets, CALL_THREE),
                                    lanes.call_verdict(sheets,
                                                       "ACold000000000000000000000000001"))
        check("every call being watched shares one read of the log",
              reads_of(sheets, LOG_ID) == made + 1 and both[0]["status"] == "blocked"
              and both[1]["status"] == "processed", (made, reads_of(sheets, LOG_ID)))
        check("and a call the log has not reached yet is simply not there",
              await lanes.call_verdict(sheets, "ACnotyet0000000000000000000000") is None)

        # A failed read with no watcher left must not print "Task exception was never retrieved".
        lanes._LOG.update({"at": 0.0, "by_call": {}, "task": None,
                           "failure": "", "failed_at": 0.0})
        loose: list[str] = []
        loop = asyncio.get_running_loop()
        kept_handler = loop.get_exception_handler()
        loop.set_exception_handler(lambda lp, ctx: loose.append(str(ctx.get("message") or "")))
        sheets.tabs[LOG_ID].delay_s = 0.3
        sheets.tabs[LOG_ID].error = Refused(403)
        watcher = asyncio.ensure_future(lanes.call_verdict(sheets, CALL_THREE))
        await asyncio.sleep(0.05)
        watcher.cancel()
        try:
            await watcher
        except asyncio.CancelledError:
            pass
        await asyncio.sleep(0.6)
        check("a log read that fails after its last watcher went says why it failed",
              "could not be read" in str(lanes._LOG["failure"])
              and float(lanes._LOG["failed_at"]) > 0.0, lanes._LOG["failure"])
        lanes._LOG["task"] = None
        gc.collect()
        await asyncio.sleep(0)
        check("and nothing is left for asyncio to complain about in the relay's log",
              not any("never retrieved" in m for m in loose), loose)
        loop.set_exception_handler(kept_handler)
        sheets.tabs[LOG_ID].error = None
        sheets.tabs[LOG_ID].delay_s = 0.0
        lanes.LOG_READ_EVERY_S = kept_interval
        service._mark_dirty, service._publish_slice = real_mark_dirty, real_publish
        desk.overlay_drop(CALL_ONE)

        check("no book was opened that this file did not make",
              all(sid in (QUEUE_ID, INCIDENTS_ID, CALLOFFS_ID, LOG_ID, UI_HOUSE_ID,
                          CALLOFFS_HOUSE_MOVED_ID) for _, sid in sheets.requests))
        check("the reader asked Google for nothing but a header and some columns",
              {kind for kind, _ in sheets.requests} == {"meta", "columns"}
              and not any(w in sources["hotline_lanes"]
                          for w in ("batchUpdate", "values().update", "values().append",
                                    "values().clear", "spreadsheets().create")),
              sorted({kind for kind, _ in sheets.requests}))

    asyncio.run(run())
    total = results["ok"] + len(results["failed"])
    if results["failed"]:
        print(f"\n{len(results['failed'])} of {total} failed: {', '.join(results['failed'])}")
        return 1
    print(f"\nall {total} passed")
    return 0


if __name__ == "__main__":
    if "HOTLINE_LANES_SOURCES" in globals():
        sys.exit(main_inside())
    sys.exit(_run_in_container())
