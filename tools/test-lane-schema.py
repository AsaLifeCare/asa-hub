#!/usr/bin/env python3
"""A lane's own room (tools/lane_schema.py): its modules in a folder of the run's own, its tables in its schema.

WHAT IT PROVES.
  folder   a lane's modules are written to /tmp/<tag>-test-<random>, a folder no other run shares, and
           removed when the lane exits; a module the run did not ship never loads from the working
           directory (in the relay container that is the live checkout) — proved by running the
           shipped preamble here, twice
  suites   no lane suite writes its modules to a fixed folder any more, and every suite that connects
           with `<lane>, public` on its search path holds its tables with `own`
  tables   `own` refuses to start a lane while a table the shipped code names resolves outside the
           lane's schema: the call-off road a fixture row once leaked into is found in the decoy and
           refused, then made in the lane and found empty there; an owned name not made, a stand-in
           pointed outside, a mirror left in public that shipped code writes, a dropped index, and a
           search path whose first schema is gone are each refused; a read-only mirror, an index
           only created beside its table, and a table the code makes itself are let through
  family   `shift_family(skip=...)` leaves out every statement naming a skipped table — an ALTER kept
           for a table not made would alter the production one
  stop     every lane run_in ships stops itself a minute inside the host's timeout and still runs its
           `finally`, so a lane the host gave up on closes its rooms — proved by running one here

WHERE IT RUNS. The first half here, on the host. The `tables` half in the relay's container, against
the real database, in two schemas of its own (a lane and a decoy standing where public stands), both
dropped at the end; it never names a table in public.

    python3 tools/test-lane-schema.py
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import types
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
TOOLS = HERE.parent
SERVER = TOOLS.parent / "server"
CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")
import lane_schema  # noqa: E402 — beside this file

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


print("\nfolder — the shipped preamble, run here")
body = ("import sys, os, mod_x\n"
        "print('GOT', mod_x.VALUE, LANE_DIR, os.path.isdir(LANE_DIR))\n"
        "try:\n"
        "    import mod_y\n"
        "    print('LEAKED', mod_y.__file__)\n"
        "except ModuleNotFoundError:\n"
        "    print('REFUSED mod_y')\n")
with tempfile.TemporaryDirectory(prefix="lane-schema-cwd-") as cwd:
    # a module the run did not ship, sitting in the working directory as the live checkout does
    Path(cwd, "mod_y.py").write_text("VALUE = 'live'\n")
    seen = []
    for _ in range(2):
        text = lane_schema.script({"mod_x": "VALUE = 7\n"}, body, "lane-schema-selftest")
        proc = subprocess.run([sys.executable, "-"], input=text, capture_output=True, text=True, cwd=cwd,
                              timeout=60)
        got = next((ln.split() for ln in proc.stdout.splitlines() if ln.startswith("GOT ")), [])
        seen.append({"got": got, "out": proc.stdout, "err": proc.stderr[-800:],
                     "gone": bool(got) and not os.path.exists(got[2])})
check("the shipped module is imported from the run's own folder, which exists while the lane runs",
      all(s["got"][:2] == ["GOT", "7"] and s["got"][3] == "True" for s in seen), seen)
check("the folder is /tmp/<tag>-test-<random>, and a second run gets another one",
      all(re.fullmatch(r"/tmp/lane-schema-selftest-test-[0-9a-f]{8}", s["got"][2]) for s in seen)
      and seen[0]["got"][2] != seen[1]["got"][2], [s["got"] for s in seen])
check("the folder is removed when the lane exits", all(s["gone"] for s in seen), seen)
check("a module not shipped never loads from the working directory — the live checkout in the container",
      all("REFUSED mod_y" in s["out"] and "LEAKED" not in s["out"] for s in seen), seen)
check("the helper itself is shipped beside the modules, for the lane to import",
      '"lane_schema"' in __import__("base64").b64decode(
          re.search(r"b64decode\('([^']+)'\)", lane_schema.script({}, "", "x")).group(1)).decode())


print("\nsuites — every lane suite in its own room")
suites = sorted(p for p in TOOLS.glob("test-*.py") if p.name != HERE.name)
fixed = []
for path in suites:
    src = path.read_text(encoding="utf-8")
    for pat in (r"""sys\.path\.insert\(0,\s*["']/tmp/""", r"""pathlib\.Path\(\s*["']/tmp/[\w.-]+["']\s*\)"""):
        fixed += [f"{path.name}: {m.group(0)}" for m in re.finditer(pat, src)]
check("no suite writes its modules to a fixed folder a concurrent run from another checkout shares",
      fixed == [], fixed)
LANE_MARK = re.compile(r"%2Cpublic|\bROOMS\.path\(")
unguarded = []
for path in suites:
    src = path.read_text(encoding="utf-8")
    if LANE_MARK.search(src) and not re.search(r"lane_schema\.own(?:_shift_lane)?\(", src):
        unguarded.append(path.name)
check("every suite that connects with `<lane>, public` holds its tables with lane_schema.own",
      unguarded == [], unguarded)
lanes = [p.name for p in suites if LANE_MARK.search(p.read_text(encoding="utf-8"))]
check("…and there are lanes to hold (the rule above is not vacuous)", len(lanes) >= 13, lanes)


print("\nthe test base — one prefix, one lock, one sweep")
spelled, pids, roomless, readers = [], [], [], []
# a suite that only reads the real database (its connections opened read-only, its own rows in pg_temp) makes nothing
# a room would hold
READ_ONLY = re.compile(r"default_transaction_read_only=on")
for path in suites:
    src = path.read_text(encoding="utf-8")
    spelled += [f"{path.name}: {m.group(0)}"
                for m in re.finditer(r"execute\(\s*f?[\"'](?:create|drop)\s+schema\b", src, re.IGNORECASE)]
    pids += [f"{path.name}: {m.group(0)}" for m in re.finditer(r"\w*_test\w*\{os\.getpid\(\)\}", src)]
    if re.search(r"environ\[\s*[\"']HUB_SNAPSHOT_PG_DSN", src) and not re.search(r"\bRooms\(", src):
        (readers if READ_ONLY.search(src) else roomless).append(path.name)
check("no suite makes or drops a schema itself: every one comes from lane_schema.Rooms, locked before it "
      "exists, so a killed run's room is the next run's sweep", spelled == [], spelled)
check("no schema is named after a pid (a container's pids restart with it; a host pid means nothing there)",
      pids == [], pids)
check("every suite that reaches the real database opens its rooms with lane_schema.Rooms, or only reads it",
      roomless == [], roomless)
check("…and every one that only reads it makes no table outside pg_temp",
      [n for n in readers if re.search(r"create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?!pg_temp\.)\w",
                                       (TOOLS / n).read_text(encoding="utf-8"), re.IGNORECASE)] == [], readers)
check("the rooms' lock class is not spelled like a lane lock namespace, which the rehearsal worker shifts",
      not re.search(r"(?:^|_)LOCK_NS(?:_|$)", "ROOM_KEY") and isinstance(lane_schema.ROOM_KEY, int))
check("a room name is the prefix, a folded tag, the run and the role, and fits the sandbox's own rule",
      re.match(r"^[a-z_][a-z0-9_]{0,62}$", f"{lane_schema.ROOM_PREFIX}{lane_schema.room_tag('X' * 90)}_0a1b2c3d_foreign")
      is not None and lane_schema.room_tag("Shift Rehearsal-2") == "shift_rehearsal_2")
legacy = ("rh_real_4087_67268", "rh_sbx_4087_67268", "rh_foreign_1_2", "house_calendars_test_123",
          "shift_requests_test2_77", "effective_roster_test_9_broken", "time_off_test_4242_31337",
          "lane_schema_decoy_0a1b2c3d", "web_push_test_deadbeef", "house_meds_test_syn_0a1b2c3d",
          "comm_calls_deliver_test_55")
check("every name a suite spelled before the test base is known as legacy: listed by the sweep, never dropped",
      all(lane_schema.LEGACY_ROOM.match(n) and not lane_schema.ROOM_NAME.match(n) for n in legacy))
check("…and nothing that is not a test's is ever taken for one",
      not any(lane_schema.LEGACY_ROOM.match(n) or lane_schema.ROOM_NAME.match(n)
              for n in ("public", "asa_rehearsal", "ops", "talent_dry_run_sandbox", "staff_scheduling_data")))

# The host's timeout kills the `docker exec` client only: the lane itself must stop, reach its `finally` and
# close its rooms. Run here, on the host, with a budget whose self-stop comes after one second.
stopping = lane_schema.self_stop("import time\ntry:\n    time.sleep(30)\nfinally:\n    print('CLOSED', flush=True)\n", 61)
t0 = time.monotonic()
ran = subprocess.run([sys.executable, "-B", "-"], input=stopping, capture_output=True, text=True, timeout=25)
took = time.monotonic() - t0
check("a lane stops itself a minute before the host's timeout and still runs its `finally`",
      "CLOSED" in ran.stdout and "the lane ran past 1s and stopped itself" in ran.stderr and took < 20,
      [ran.stdout[-200:], ran.stderr[-300:], round(took, 1)])
check("…a script that must open with `from __future__` is left as it is",
      lane_schema.self_stop("from __future__ import annotations\nx = 1\n", 300)
      == "from __future__ import annotations\nx = 1\n")
sent = {}
real_run = subprocess.run


def fake_run(cmd, **kw):
    if cmd[:2] == ["docker", "exec"]:
        sent.update(input=kw.get("input"), timeout=kw.get("timeout"))
        return types.SimpleNamespace(stdout="LANE_RESULT {}\n", stderr="", returncode=0)
    return real_run(cmd, **kw)


subprocess.run = fake_run
try:
    lane_schema.run_in("no-container", "print('LANE_RESULT {}')\n", timeout=600)
finally:
    subprocess.run = real_run
check("…and every lane run_in ships carries it, a minute inside the host's own timeout",
      str(sent.get("input", "")).startswith("import signal as _lane_signal\n")
      and "_lane_signal.alarm(540)" in sent.get("input", "") and sent.get("timeout") == 600, sent)


print("\nthe SQL a lane's modules name")
sample = ("cur.execute(\"SELECT to_regclass('asa_calendar_calloff_road') IS NOT NULL\")\n"
          "cur.execute('SELECT * FROM asa_shift_pool p JOIN asa_house_calendar_live l ON 1=1')\n"
          "cur.execute('select location from public.asa_house_calendar_live')\n"
          "cur.execute(f'SELECT * FROM {TRACKER_TABLE}')\n"
          "'DROP INDEX IF EXISTS asa_shift_handoffs_open'\n"
          "'INSERT INTO asa_hub_notices (key) VALUES (1)'\n"
          "'UPDATE asa_shift_pool SET x=1'\n")
named = lane_schema.named_tables(sample)
check("a table named after FROM / JOIN / to_regclass / INDEX is found, lower-cased",
      {"asa_calendar_calloff_road", "asa_shift_pool", "asa_house_calendar_live", "asa_shift_handoffs_open",
       "asa_hub_notices"} <= named, sorted(named))
check("a name the code qualifies itself is not a search-path question, and an f-string hole is no name",
      "public" not in named and "tracker_table" not in named, sorted(named))
check("the writes are told apart from the reads",
      lane_schema.written_tables(sample) == {"asa_shift_handoffs_open", "asa_hub_notices", "asa_shift_pool"},
      lane_schema.written_tables(sample))
check("the tables a make list creates are its owned names",
      lane_schema.made_tables(["CREATE TABLE IF NOT EXISTS asa_a (x int)", "  create table asa_b (y int)",
                               "ALTER TABLE asa_a ADD COLUMN z int", lambda dsn: None]) == ["asa_a", "asa_b"])


print("\nfamily — the shift family's make list")
if "psycopg2" not in sys.modules:  # pragma: no cover - the host has no driver
    fake = types.ModuleType("psycopg2")
    fake.connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no database in this test"))
    fake.Error = Exception
    extras = types.ModuleType("psycopg2.extras")
    extras.RealDictCursor = object
    extras.Json = lambda v: v
    errors = types.ModuleType("psycopg2.errors")
    errors.UniqueViolation = type("UniqueViolation", (Exception,), {})
    fake.extras, fake.errors = extras, errors
    sys.modules.update({"psycopg2": fake, "psycopg2.extras": extras, "psycopg2.errors": errors})
sys.path.insert(0, str(SERVER))
os.environ.setdefault("HUB_SNAPSHOT_OUT", tempfile.mkdtemp(prefix="lane-schema-out-"))
try:
    whole = lane_schema.shift_family()
    kept = lane_schema.shift_family(skip=("asa_house_calendar_edits", "asa_cal_builder_house_draft"))
    made = lane_schema.made_tables(whole)
    check("the family makes the call-off road, the pool, the edits, the notices, the replies and the overlay",
          {"asa_calendar_calloff_road", "asa_shift_pool", "asa_house_calendar_edits", "asa_hub_notices",
           "asa_sms_replies", "asa_time_off_writes", "asa_house_calendar_live"} <= set(made), made)
    check("skipping a table drops every statement that names it — its ALTERs and indexes too",
          not any(re.search(r"\basa_house_calendar_edits\b|\basa_cal_builder_house_draft\b", s) for s in kept)
          and any("asa_house_calendar_edits" in s and s.lstrip().upper().startswith("ALTER") for s in whole),
          [s[:60] for s in whole if "edits" in s])
    check("the family never drops anything by name — a DROP resolving to public would reach production",
          not any(re.match(r"\s*drop\b", s, re.IGNORECASE) for s in whole))
except Exception as exc:  # noqa: BLE001
    check("the family's modules import on the host", False, f"{type(exc).__name__}: {exc}")


PROBE = r'''
import json, os, types
import psycopg2
import lane_schema as ls
import calloff_road

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
ROOMS = ls.Rooms(DSN, "lane-schema")
A, D = ROOMS.name("lane"), ROOMS.name("decoy")


def path(*schemas):
    return DSN + ("&" if "?" in DSN else "?") + "options=-csearch_path%3D" + "%2C".join(schemas)


# the decoy stands where public stands for a real lane
T = path(A, D)
OUT = {}


def attempt(fn):
    try:
        return ["ok", fn()]
    except ls.Stray as exc:
        return ["stray", str(exc)]


def fresh():
    ROOMS.remake(A)


def rows(sql):
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(sql)
        return [list(r) for r in cur.fetchall()]


ROOMS.make("decoy")
with psycopg2.connect(DSN) as c, c.cursor() as cur:
    # the row a broken run once left in the production road
    cur.execute(f"CREATE TABLE {D}.asa_calendar_calloff_road (ref TEXT PRIMARY KEY)")
    cur.execute(f"INSERT INTO {D}.asa_calendar_calloff_road VALUES ('SP0D0CAABA2F')")
    cur.execute(f"CREATE TABLE {D}.asa_lane_probe (x INT)")
    cur.execute(f"CREATE INDEX asa_lane_probe_x ON {D}.asa_lane_probe (x)")
    c.commit()
try:
    fresh()
    OUT["road_read_before"] = rows("SELECT ref FROM asa_calendar_calloff_road")
    OUT["road_unmade"] = attempt(lambda: ls.own(T, A, scan=LANE_DIR))
    OUT["road_made"] = attempt(lambda: ls.own(T, A, make=[calloff_road.DDL], scan=LANE_DIR))
    OUT["road_read_after"] = rows("SELECT ref FROM asa_calendar_calloff_road")

    fresh()
    OUT["owned_unmade"] = attempt(lambda: ls.own(T, A, names=["asa_lane_probe"]))
    OUT["mirror_read"] = attempt(lambda: ls.own(T, A, scan={"m": "cur.execute('SELECT x FROM asa_lane_probe')"},
                                                public_ok=["asa_lane_probe"]))
    OUT["mirror_written"] = attempt(lambda: ls.own(
        T, A, scan={"m": "cur.execute('INSERT INTO asa_lane_probe VALUES (1)')"}, public_ok=["asa_lane_probe"]))
    OUT["unlisted_read"] = attempt(lambda: ls.own(T, A, scan={"m": "cur.execute('SELECT x FROM asa_lane_probe')"}))

    fresh()
    OUT["later_start"] = attempt(lambda: ls.own(T, A, scan={"m": "'SELECT x FROM asa_lane_probe'"},
                                                later=["asa_lane_probe"]))
    OUT["later_unmade"] = attempt(lambda: ls.assert_owned(T, A, ["asa_lane_probe"]))
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("CREATE TABLE IF NOT EXISTS asa_lane_probe (x INT)")
        c.commit()
    OUT["later_made"] = attempt(lambda: ls.assert_owned(T, A, ["asa_lane_probe"]))

    # the table is the lane's now; only the decoy holds the index of that name
    OUT["index_created"] = attempt(lambda: ls.own(
        T, A, scan={"m": "'CREATE INDEX IF NOT EXISTS asa_lane_probe_x ON asa_lane_probe (x)'"}))
    OUT["index_dropped"] = attempt(lambda: ls.own(T, A, scan={"m": "'DROP INDEX IF EXISTS asa_lane_probe_x'"}))

    fresh()
    book = types.SimpleNamespace(__name__="book", TABLE=f"{D}.asa_lane_probe")
    OUT["pointer_out"] = attempt(lambda: ls.own(T, A, pointers=[(book, "TABLE")]))
    book.TABLE = "lane_book"
    OUT["pointer_in"] = attempt(lambda: ls.own(T, A, make=["CREATE TABLE IF NOT EXISTS lane_book (x INT)"],
                                               pointers=[(book, "TABLE")]))

    OUT["first_not_lane"] = attempt(lambda: ls.own(path(D, A), A))
    OUT["lane_gone"] = attempt(lambda: ls.own(path(A + "_gone", D), A + "_gone"))

    # the test base: two runs of their own, one killed and one stopped, and this run's sweep between
    import subprocess, sys, time
    child = ("import os, sys, time\n"
             f"sys.path.insert(0, {LANE_DIR!r})\n"
             "import lane_schema as ls\n"
             "r = ls.Rooms(os.environ['HUB_SNAPSHOT_PG_DSN'], 'lane-schema-child')\n"
             "print(r.make('kept'), flush=True)\n"
             "time.sleep(120)\n")
    alive = subprocess.Popen([sys.executable, "-B", "-c", child], stdout=subprocess.PIPE, text=True)
    killed = subprocess.Popen([sys.executable, "-B", "-c", child], stdout=subprocess.PIPE, text=True)
    live_room, dead_room = alive.stdout.readline().strip(), killed.stdout.readline().strip()
    OUT["rooms_made"] = [live_room, dead_room]
    killed.kill()
    killed.wait()
    for _ in range(40):  # the server ends the session once it sees the socket close
        if dead_room in ls.sweep(DSN, drop=False)["dead"]:
            break
        time.sleep(0.25)
    swept = ls.sweep(DSN)
    OUT["rooms_swept"] = [dead_room in swept["dropped"], live_room in swept["alive"]]
    alive.terminate()
    alive.wait(timeout=60)
    with psycopg2.connect(DSN) as c, c.cursor() as cur:
        cur.execute("SELECT count(*) FROM pg_namespace WHERE nspname IN (%s, %s)", (live_room, dead_room))
        OUT["rooms_after_term"] = cur.fetchone()[0]
finally:
    OUT["rooms"] = ROOMS.close()
    OUT["schemas_left"] = len(OUT["rooms"]["left"])
OUT["A"], OUT["D"] = A, D
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''


print("\ntables — own(), against the real database, a lane and a decoy of its own")
sources = {name: (SERVER / f"{name}.py").read_text(encoding="utf-8") for name in ("calloff_road", "shift_requests")}
lane = lane_schema.run_in(CONTAINER, lane_schema.script(sources, PROBE, "lane-schema"))
if lane is None:
    print("  (skipped — no relay container to hold a database here)")
    print("  NOTE: the host half above still ran; the database half did not.")
elif lane.get("crash"):
    check("the probe ran to its end", False, lane.get("trace") or lane["crash"])
else:
    A, D = lane["A"], lane["D"]
    check("without the guard, a lane's first read of the call-off road lands on the row behind it",
          lane["road_read_before"] == [["SP0D0CAABA2F"]], lane["road_read_before"])
    check("THE GUARD: a lane that has not made the road is refused before any test runs, naming it",
          lane["road_unmade"][0] == "stray" and f"{D}.asa_calendar_calloff_road" in lane["road_unmade"][1],
          lane["road_unmade"])
    check("made in the lane, the road resolves there and the lane starts",
          lane["road_made"][0] == "ok" and lane["road_made"][1]["lane"].get("asa_calendar_calloff_road") == A,
          lane["road_made"])
    check("…and the lane's first read finds its own empty road, never the row behind it",
          lane["road_read_after"] == [], lane["road_read_after"])
    check("an owned name that was not made is refused",
          lane["owned_unmade"][0] == "stray" and "not made in the lane" in lane["owned_unmade"][1],
          lane["owned_unmade"])
    check("a read-only mirror listed as left in public is let through, and said",
          lane["mirror_read"][0] == "ok" and lane["mirror_read"][1]["left_in_public"] == ["asa_lane_probe"],
          lane["mirror_read"])
    check("a mirror left in public that the shipped code WRITES is refused — that write would land in production",
          lane["mirror_written"][0] == "stray" and "written by the shipped code" in lane["mirror_written"][1],
          lane["mirror_written"])
    check("a table the code reads, neither made nor listed, is refused",
          lane["unlisted_read"][0] == "stray" and f"{D}.asa_lane_probe" in lane["unlisted_read"][1],
          lane["unlisted_read"])
    check("a table the code makes itself is let through at the start, held to the lane once made",
          lane["later_start"][0] == "ok" and lane["later_unmade"][0] == "stray"
          and lane["later_made"][0] == "ok", [lane["later_start"], lane["later_unmade"], lane["later_made"]])
    check("an index only created beside its table is no stray; one the code drops by name is",
          lane["index_created"][0] == "ok" and lane["index_dropped"][0] == "stray"
          and "asa_lane_probe_x" in lane["index_dropped"][1], [lane["index_created"], lane["index_dropped"]])
    check("a stand-in pointed outside the lane is refused; pointed at the lane's own book, it starts",
          lane["pointer_out"][0] == "stray" and "a stand-in outside the lane" in lane["pointer_out"][1]
          and lane["pointer_in"][0] == "ok", [lane["pointer_out"], lane["pointer_in"]])
    check("a search path whose first schema is not the lane is refused — and so is one whose lane was dropped "
          "under it, which is how a fixture row once reached production",
          lane["first_not_lane"][0] == "stray" and "not first" in lane["first_not_lane"][1]
          and lane["lane_gone"][0] == "stray" and "not first" in lane["lane_gone"][1],
          [lane["first_not_lane"], lane["lane_gone"]])
    check("both schemas the probe made were dropped", lane["schemas_left"] == 0, lane["schemas_left"])
    check("the probe's rooms are the test base's", A.startswith("hub_test_lane_schema_") and A.endswith("_lane")
          and D.endswith("_decoy"), [A, D])
    check("THE TEST BASE: a run killed before its end leaves its room to the next run's sweep, which drops it",
          lane.get("rooms_swept", [False])[0], lane.get("rooms_made"))
    check("…while a room whose run is still alive is kept by that sweep",
          lane.get("rooms_swept", [False, False])[1], lane.get("rooms_made"))
    check("a run stopped by SIGTERM drops its own rooms on the way out", lane.get("rooms_after_term") == 0,
          lane.get("rooms_after_term"))


print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
