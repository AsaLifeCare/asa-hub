"""asa-hub-app's lane-module slices (live_slices.APP_BUILT: the calendar builder's grid and tables, the punch board,
the shift board, the invoice and finance catalogs and summary, the CV coverage, the alert triage and workforce
forecast, the cortex contacts, the communication routes, PsiAnywhere's punches, the behavior board, the recruiters'
book, the communication windows and the attendance) and the late analyses (live_slices.APP_LATE: coverage, hiring,
the medication study) built in-process with the app's copies of the modules, asa-hub-db and the old platform read live
on read-only connections, the files written to a scratch folder: build_all asks the relay for nothing, every one is
written with rows and told to the bus, a write's rebuild drops a module's held read first, and no slice is left in the
relay's list. The shift board reads the house books' CALENDAR grids asa-hub-db keeps, never the old platform's
asa_schedules; the calendar builder's grid reads the master grid asa-hub-db keeps (kind master), never Google; the
behavior board, the windows and the attendance take their phones, roster and call-offs off the same grids and
asa-hub-db's copies of the books. Two slices their Python door fills are finished here (live_slices.APP_FINISHED):
the events with the roster's hours off the grids, the HR tracker with its digest off the shared cache (no model is
asked here). With DUMP set, the slices are printed after `BOARD_ROWS ` for a comparison with the files the relay
wrote.

Run inside asa-hub-db-sync by the in-process runner (run.sh, which loads the test from beside its drv.py), with the
files the lanes keep on /srv/snapshot and the manifests as asa-hub-app sees them:

    cp tools/test-app-built-slices.py "$RUNNER/test_app_built_slices.py"
    docker exec asa-hub-app cat /srv/snapshot/.psi-punch-board.json > "$RUNNER/board.json"
    docker exec asa-hub-app tar -C /srv/snapshot -cz psi-entries recruit candidates.json hr_digest_cache.json \
        staffIssues.json callOffs.json talentPool.json recruitment.json | base64 -w0 > "$RUNNER/snap.b64"
    docker exec asa-hub-app tar -C /srv/manifests -cz snapshot-manifest.json resolver-manifest.json \
        | base64 -w0 > "$RUNNER/manifests.b64"
    python3 -c 'import json,sys;print(json.dumps({"PLANE":open("app/live_plane.json").read(),
        "IST":open("app/ist_config_defaults.json").read(),"BOARD":open(sys.argv[1]).read(),
        "SNAP":open(sys.argv[2]).read(),"MANIFESTS":open(sys.argv[3]).read()}))' \
        "$RUNNER/board.json" "$RUNNER/snap.b64" "$RUNNER/manifests.b64" > "$RUNNER/env.json"
    sh "$RUNNER/run.sh" "$PWD/app" "$RUNNER/test_app_built_slices.py" "@$RUNNER/env.json"
"""
import logging

logging.disable(logging.CRITICAL)
import asyncio  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import sys  # noqa: E402
import tempfile  # noqa: E402
import types  # noqa: E402

import psycopg  # noqa: E402

_fa = types.ModuleType("fastapi")
_fa.Request = object
_fr = types.ModuleType("fastapi.responses")
_fr.JSONResponse = lambda body, status_code=200: {"status": status_code, "body": body}
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr})

WORK = tempfile.mkdtemp(prefix="app-built-")
OUT = os.path.join(WORK, "snapshot")
os.makedirs(OUT)
with open(os.path.join(OUT, ".psi-punch-board.json"), "w") as fh:
    fh.write(os.environ["BOARD"])
import base64  # noqa: E402
import io  # noqa: E402
import tarfile  # noqa: E402

for key, into in (("SNAP", OUT), ("MANIFESTS", WORK)):
    with tarfile.open(fileobj=io.BytesIO(base64.b64decode(os.environ[key])), mode="r:gz") as tar:
        tar.extractall(into, filter="data")
LIVE_STAFF = json.load(open(os.path.join(OUT, "staffIssues.json")))["rows"]
# the build reads this one; the behavior board reads the real snapshot-manifest.json beside it
MANIFEST = os.path.join(WORK, "manifest.json")
os.environ.update({"HUB_SNAPSHOT_OUT": OUT, "HUB_SNAPSHOT_MANIFEST": MANIFEST,
                   "HUB_IST_CONFIG_DECLARATION_JSON": os.environ["IST"], "HUB_HR_DIGEST_ROWS": "0"})
OWNER = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
os.environ["HUB_DB_DSN"] = OWNER
RO = "-c default_transaction_read_only=on"

import lanes_pg  # noqa: E402
import live_slices  # noqa: E402

lanes_pg.CONNECT["own"] = lanes_pg.CONNECT["spare"] = lambda: psycopg.connect(OWNER, autocommit=True, options=RO)
lanes_pg.CONNECT["intel"] = lambda: psycopg.connect(os.environ["MIRROR_DSN"], autocommit=True, options=RO)

PLANE = json.loads(os.environ["PLANE"])
live_slices.wire(PLANE)
published: list[str] = []
live_slices.EVENTS = type("Bus", (), {"publish": staticmethod(lambda name, **_k: published.append(name))})()
asked_relay: list[list[str]] = []


async def _relay(entries, late):
    asked_relay.append([e["resource"] for e in entries])
    return []

live_slices.relay_built = _relay
HERE = sorted(live_slices.APP_BUILT)
LATE_HERE = ["coverageSuggestions", "hiringAnalysis", "medCorrelation", "rosterProfile"]
with open(MANIFEST, "w") as fh:
    json.dump({"resources": [{"resource": r, "mode": "derived", "shelf": "private", "roles": ["admin"]}
                             for r in HERE + LATE_HERE]}, fh)

# the front door's doors: the HR tracker's answers its rows as the relay's file holds them, the digest taken off; the
# sheet tabs door is the real one (the medication study's held sources); any other answers the Hub's own events
import hubdb  # noqa: E402
import locations  # noqa: E402
import sheet_tabs  # noqa: E402

own = [{"id": "e1", "date": "2026-10-25", "title": "Hub's own"}, {"id": "e2", "date": "", "title": "trail"}]
door_staff = [{k: v for k, v in r.items() if not k.startswith("digest_")} for r in LIVE_STAFF]


async def _door(app_id, door, ident, payload):
    if door == "sheetTabs":
        sess = types.SimpleNamespace(user={"is_service": True}, reads=locations.Reads(hubdb.shared()))
        return None, None, sheet_tabs.sheet_tabs(sess, payload)
    return None, None, {"status": 200, "data": [dict(r) for r in (door_staff if door == "staffIssuesList" else own)]}

live_slices.FD = type("FD", (), {"call_app": staticmethod(_door)})()

ok = failed = 0


def check(label, cond, detail=""):
    global ok, failed
    if cond:
        ok += 1
        print("  ok  ", label)
    else:
        failed += 1
        print("  FAIL", label, detail)


SHIFTS = ["shiftCards", "shiftMatrix", "shiftTimeline", "shifts"]
GRIDDED = ["calendarConflicts", "calendarGrid", "calendarHours"]
CATALOGS = ["finances", "invoices", "resumeCoverage"]
INTEL = ["alertsTriage", "commRoutes", "cortexContacts", "financeSummary", "psiPunches", "workforceForecast"]
LANES = ["behaviorBoard", "recruitBook"]
COMMS = ["commAttendance", "commWhen", "commWhenMoments"]
check("the table names the twenty-six slices built here", HERE == sorted([
    "calendarHouses", "calendarRequests", "calendarShifts", "calendarStaff", "commPunchBoard"] + SHIFTS + GRIDDED
    + CATALOGS + INTEL + LANES + COMMS), HERE)
check("no slice is left to the relay", PLANE["relay_built"] == [], PLANE["relay_built"])
check("the events and the HR tracker are finished here, not by the relay",
      PLANE.get("app_finished") == {"events": "shift_slices", "staffIssues": "hr_digest"}, PLANE.get("app_finished"))
check("the three late analyses are built here",
      PLANE.get("app_late") == {"hiring": "hiring_slices", "medcorr": "medcorr_slices", "coverage": "coverage_slices"},
      PLANE.get("app_late"))

payload = asyncio.run(live_slices.build_all(only=set(HERE) | set(LATE_HERE)))
check("the relay is asked for nothing", not [a for a in asked_relay if a], asked_relay)
for r in LATE_HERE:
    rec = payload["slices"].get(r) or {}
    check(f"{r}: built here after the pass, with rows", "error" not in rec and rec.get("rows", 0) > 0, rec)
for r in HERE:
    rec = payload["slices"].get(r) or {}
    path = os.path.join(OUT, f"{r}.json")
    body = json.load(open(path)) if os.path.exists(path) else {}
    check(f"{r}: written here with rows", "error" not in rec and rec.get("rows", 0) > 0
          and len(body.get("rows") or []) == rec.get("rows") and body.get("source_at"),
          f"{rec} file_rows={len(body.get('rows') or [])}")
check("each file was told to the bus", set(HERE) <= set(published), sorted(set(HERE) - set(published)))

import shift_slices  # noqa: E402

_read = []
_execute = lanes_pg.Cursor.execute if hasattr(lanes_pg, "Cursor") else None
if _execute is not None:
    def _seen(self, sql, *a, **k):
        _read.append(str(sql))
        return _execute(self, sql, *a, **k)
    lanes_pg.Cursor.execute = _seen
shift_slices.forget()
shift_slices.build("shifts", "asa-hub-db")
check("the shift board never asks the old platform for asa_schedules or its ingest log",
      _execute is not None and _read and not any("asa_schedules" in s or "asa_ingest_log" in s for s in _read),
      [s[:80] for s in _read if "asa_" in s][:4])
books, grids = shift_slices._kept_grids()
check("every house book the index links has its grid kept", books and all(b["id"] in grids for b in books),
      [b["code"] for b in books if b["id"] not in grids])
matrix = json.load(open(os.path.join(OUT, "shiftMatrix.json")))["rows"]
check("the matrix holds one cell per house, person and day",
      len({(m["houseId"], m["staffName"], m["date"]) for m in matrix}) == len(matrix))
check("the matrix spans the board's window", matrix and min(m["date"] for m in matrix) >= str(
    shift_slices._today() - shift_slices.timedelta(days=shift_slices.PAST_DAYS)))
grid = json.load(open(os.path.join(OUT, "calendarGrid.json")))["rows"]
check("the calendar grid opens with its period, 28 days read off the kept master grid",
      grid and grid[0].get("rowType") == "period" and grid[0].get("days") == 28 and len(grid) > 1,
      grid[0] if grid else None)
import calendar_builder_slices  # noqa: E402

calendar_builder_slices.forget()
calendar_builder_slices.build("calendarGrid", "asa-hub-db")
check("the master grid is asked of asa-hub-db's kept grids", any("sheet_grids" in s and "master" in s for s in _read),
      [s[:80] for s in _read if "sheet_grids" in s][:2])

import lanes_sheets  # noqa: E402

db = lanes_sheets._db()
_book = db.book
oldest = min(books, key=lambda b: grids[b["id"]]["modified_time"])["id"]
db.book = lambda sid: (_book(sid)._replace(modified_time=__import__("datetime").datetime.now(
    __import__("datetime").timezone.utc)) if sid == oldest and _book(sid) is not None else _book(sid))
shift_slices.forget()
_rows, at = shift_slices.build("shifts", "asa-hub-db")
db.book = _book
shift_slices.forget()
check("a grid behind its book stamps the board with when that grid was read",
      at == grids[oldest]["read_at"].isoformat(), (at, grids[oldest]["read_at"]))
_rows, at = shift_slices.build("shifts", "asa-hub-db")
behind = [grids[b["id"]]["read_at"] for b in books if b["id"] in grids and db.book(b["id"]) is not None
          and __import__("hubdb")._epoch(db.book(b["id"]).modified_time)
          > grids[b["id"]]["modified_time"].timestamp() + shift_slices.GRID_SLACK_S]
check("the board is current when no grid is behind its book, else as old as the oldest behind",
      at == (min(behind).isoformat() if behind else None), (at, len(behind)))

# the events: the door's dated rows kept, the undated trail dropped, the roster's hours laid after them
events = asyncio.run(live_slices.rows_from_python(["events"]))["events"]
import hr_digest  # noqa: E402

asked_model: list = []
hr_digest.ask = lambda row, http=None: asked_model.append(row) or {}
staff = asyncio.run(live_slices.rows_from_python(["staffIssues"]))["staffIssues"]
check("the HR tracker is finished here with the digest the relay laid, off the shared cache",
      staff == LIVE_STAFF, next(((a, b) for a, b in zip(LIVE_STAFF, staff) if a != b), (len(staff), len(LIVE_STAFF))))
check("the digest reads the roster and the cache, and asks no model on a build", not asked_model
      and not any(r.get("digest_failed") or r.get("digest_roster_why") for r in staff), len(asked_model))
import behavior_slices  # noqa: E402

_read.clear()
behavior_slices._CACHE["board"] = None
# built again now the shift board's file is on this disk (the pass above built it after the shifts.json it reads)
board_rows, _at = behavior_slices.build("behaviorBoard", "asa-hub-db")
check("the behavior board joins the shift board's file", any(r.get("shifts") for r in board_rows))
check("the behavior board asks the old platform for no sheet copy and no asa_schedules",
      _read and not any("asa_schedules" in s or "asa_sheet_" in s for s in _read), [s[:80] for s in _read][:4])
_none, calloff_last, _age = behavior_slices._absences(None, {})
check("its IST records, phones and call-offs come off asa-hub-db", any("ist_records_kept" in s for s in _read)
      and behavior_slices._roster_phones(None) and calloff_last, (calloff_last, [s[:60] for s in _read][:6]))
import attendance_slices  # noqa: E402
import comm_when_slices  # noqa: E402

_read.clear()
comm_when_slices.build("commWhen", "asa-hub-db")
attendance_slices.build("commAttendance", "asa-hub-db")
check("the windows and the attendance ask the old platform for no sheet copy and no asa_schedules",
      _read and not any("asa_schedules" in s or "asa_sheet_" in s for s in _read), [s[:80] for s in _read][:6])
timeline = json.load(open(os.path.join(OUT, "shiftTimeline.json")))["rows"]
check("the events keep the Hub's own dated rows and drop the trail", events[:1] == own[:1]
      and not any(e.get("id") == "e2" for e in events), events[:2])
check("the roster's hours follow, one event per timed shift", len(events) - 1 == len(timeline) and timeline
      and all(e.get("readOnly") and e.get("type") == "shift" for e in events[1:]), (len(events), len(timeline)))
if os.environ.get("DUMP"):
    print("BOARD_ROWS " + json.dumps(dict({r: json.load(open(os.path.join(OUT, f"{r}.json")))
                                           for r in SHIFTS + GRIDDED + CATALOGS + INTEL + LANES + COMMS
                                           + LATE_HERE},
                                          events={"rows": events}, staffIssues={"rows": staff},
                                          behaviorBoard={"rows": board_rows})))

# a module that holds its read: a write's rebuild drops it, the floor's may use it
held = types.ModuleType("held_slices")
held.memo = {"rows": [{"held": True}]}
held.forget = lambda: held.memo.update(rows=[{"fresh": True}])
held.build = lambda resource, dsn: (list(held.memo["rows"]), None)
sys.modules["held_slices"] = held
live_slices.APP_BUILT["heldBoard"] = "held_slices"
asyncio.run(live_slices.app_built([{"resource": "heldBoard"}], fresh=False))
got = json.load(open(os.path.join(OUT, "heldBoard.json")))
check("the floor's rebuild may use the held read", got["rows"] == [{"held": True}], got["rows"])
asyncio.run(live_slices.app_built([{"resource": "heldBoard"}], fresh=True))
got = json.load(open(os.path.join(OUT, "heldBoard.json")))
check("a write's rebuild reads again", got["rows"] == [{"fresh": True}], got["rows"])


class Asked:
    def __init__(self, token, body):
        self.headers, self._body = {"x-hub-token": token} if token else {}, json.dumps(body).encode()

    async def body(self):
        return self._body


live_slices.TOKEN[0] = "tok"
asked_relay.clear()
refused = asyncio.run(live_slices.rebuild(Asked("", {"resources": ["commPunchBoard"]})))
check("/rebuild without the relay's token is refused", refused == {"status": 401, "body": {"error": "unauthorized"}},
      refused)
again = asyncio.run(live_slices.rebuild(Asked("tok", {"resources": ["commPunchBoard"]})))
check("/rebuild with it rebuilds the named slice here", (again.get("slices") or {}).get("commPunchBoard", {})
      .get("rows", 0) > 0 and not [a for a in asked_relay if a], asked_relay)

print(json.dumps({r: (payload["slices"].get(r) or {}).get("rows") for r in HERE}))
print(f"{ok} ok, {failed} failed")
