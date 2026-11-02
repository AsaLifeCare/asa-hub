#!/usr/bin/env python3
"""The effective roster: every reader sees the same published shift; the lane runs in its own schema."""
import ast
import logging
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


if "psycopg2" not in sys.modules:  # pragma: no cover
    fake = types.ModuleType("psycopg2")
    fake.connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no database in this test"))
    fake.Error = Exception
    extras = types.ModuleType("psycopg2.extras")
    extras.RealDictCursor = object
    extras.Json = lambda v: v
    errors = types.ModuleType("psycopg2.errors")
    errors.UniqueViolation = type("UniqueViolation", (Exception,), {})
    fake.extras, fake.errors = extras, errors
    sys.modules["psycopg2"] = fake
    sys.modules["psycopg2.extras"] = extras
    sys.modules["psycopg2.errors"] = errors

sys.path.insert(0, str(SERVER))
os.environ.setdefault("HUB_SNAPSHOT_OUT", "/tmp")
import effective_roster as er  # noqa: E402
import shift_slices  # noqa: E402
import psi_attendance as pa  # noqa: E402


def src(name: str) -> str:
    return (SERVER / f"{name}.py").read_text(encoding="utf-8")


def fn_source(source: str, name: str) -> str:
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(source, node) or ""
    return ""


UTC = timezone.utc
T0 = datetime(2026, 9, 23, 15, 0, tzinfo=UTC)
D = date(2026, 9, 24)

print("THE RULE — the copy's own word stands only when it spoke after the publish")
check("the house is named by the code the copy uses", er.house_code("CAN - BM - BM4060") == "BM4060")
check("one person, however the two workbooks case and space the name",
      er.fold("  Ann   ROE ") == er.fold("ann roe") == "ann roe")


def cell(emp="Ann Roe", value="8A-4P", at=T0, cid=1, day=D, state="pending"):
    return {"house": "BM4060", "employee": emp, "day": day, "value": value, "at": at, "id": cid,
            "state": state, "actor": "Hana Boss", "via": "publish", "location": "CAN - BM - BM4060",
            "published_value": value}


K = ("BM4060", "ann roe", D)
check("a cell the copy holds no row for is laid", K in er.decide([cell()], {}))
check("so is one the copy last spoke about BEFORE the publish",
      K in er.decide([cell()], {K: (T0 - timedelta(hours=2), "8A-8P")}))
check("one the copy has said something ELSE about since is not — the newest word stands",
      K not in er.decide([cell()], {K: (T0 + timedelta(minutes=5), "7A-3P")}))
check("one the copy has since caught up with (same text) is still laid, so no stale row returns",
      K in er.decide([cell()], {K: (T0 + timedelta(minutes=5), "8A-4P")}))
two = er.decide([cell(emp="Ann Roe", value="8A-4P", cid=5), cell(emp="ann  roe", value="9A-5P", cid=9)], {})
check("two published rows folding onto one person: the later one", two[K]["value"] == "9A-5P", two)

print("\nTHE LAYING — the copy's rows for a laid cell are replaced by one, in place")
COPY = [
    {"id": 1, "house": "BM4060", "staff_name": "Dee Way", "shift_date": D, "shift_raw": "7A-3P"},
    {"id": 2, "house": "BM4060", "staff_name": "Ann Roe", "shift_date": D, "shift_raw": "8A-8P"},
    {"id": 3, "house": "BM4060", "staff_name": "Cy Far", "shift_date": D, "shift_raw": "2P-10P"},
    {"id": 4, "house": "bm4060", "staff_name": "ann roe", "shift_date": D, "shift_raw": "7A-7P"},
]
same = er.lay_rows(COPY, {})
check("nothing laid hands back the very list — the same object", same is COPY)
laid = er.lay_rows(COPY, er.decide([cell()], {}))
check("the laid person keeps one row, where their first stood; nothing else moves",
      [r["staff_name"] for r in laid] == ["Dee Way", "Ann Roe", "Cy Far"], laid)
check("…and that row says the published value, not the stale 7A-7P the copy never deleted",
      laid[1]["shift_raw"] == "8A-4P" and all(r.get("shift_raw") != "7A-7P" for r in laid))
check("the replaced row's own spelling is kept", laid[1]["staff_name"] == "Ann Roe")
check("the laid row says when, by whom and by which road it was published",
      laid[1]["published"] == {"at": "2026-09-23T15:00:00Z", "by": "Hana Boss", "via": "publish",
                               "state": "pending", "location": "CAN - BM - BM4060"},
      laid[1].get("published"))
gone = er.lay_rows(COPY, er.decide([cell(value="")], {}))
check("an EMPTIED cell takes the person's shift away — every row of it",
      [r["staff_name"] for r in gone] == ["Dee Way", "Cy Far"], gone)
kept = er.lay_rows(COPY, er.decide([cell(value="")], {}), keep_empty=True)
check("…unless the reader keeps the empty cell as the calendar's answer (Daily Notes)",
      [(r["staff_name"], r["shift_raw"]) for r in kept]
      == [("Dee Way", "7A-3P"), ("Ann Roe", ""), ("Cy Far", "2P-10P")], kept)
new = er.lay_rows(COPY, er.decide([cell(emp="Zoe New", value="8P-8A", cid=7)], {}),
                  facts={("BM4060", "zoe new"): {"staff_name": "ZOE NEW", "phone": "3305550100",
                                                "source_id": "SRC-BM", "house": "BM4060"}})
check("a person the copy has no row for that day joins at the end, as the copy spells them",
      [r["staff_name"] for r in new] == ["Dee Way", "Ann Roe", "Cy Far", "ann roe", "ZOE NEW"]
      and new[-1]["phone"] == "3305550100" and new[-1]["source_id"] == "SRC-BM"
      and new[-1]["shift_date"] == D and new[-1]["tab_name"] == "CALENDAR", new[-1])
check("the joined row carries an id no copy row can have",
      new[-1]["id"] == "pub-7" and str(new[-1]["id"]).startswith("pub-"))


class ReadyCursor:
    asked: list = []

    def __init__(self, ok):
        self.ok, self.connection = ok, self

    def cursor(self, **k):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, args=None):
        ReadyCursor.asked.append(sql)

    def fetchone(self):
        return {"ok": self.ok}

    def fetchall(self):
        raise AssertionError("nothing past the first question may be read")


same = er.lay(ReadyCursor(False), COPY, D, D)
check("a database with no record table (nor its `stage` column) hands the reader's own list back",
      same is COPY and len(ReadyCursor.asked) == 1 and "to_regclass" in ReadyCursor.asked[0],
      ReadyCursor.asked)

print("\nTHE LENS — the window ask's roster read, recognised; every other statement untouched")
MOMENTS_SQL = ("SELECT house, staff_name, phone, shift_date, shift_raw "
               "FROM public.asa_schedules "
               "WHERE tab_name = %s AND shift_date BETWEEN %s AND %s "
               "AND coalesce(staff_name, '') <> '' "
               "ORDER BY shift_date, staff_name")
PHONES_SQL = ("SELECT staff_name AS n, phone AS p FROM public.asa_schedules "
              "WHERE coalesce(phone, '') <> ''")
check("the roster read is recognised, with its table and its two days",
      er.roster_read(MOMENTS_SQL, ("CALENDAR", "d1", "d2")) == ("public.asa_schedules", "d1", "d2"))
check("the phone book is not a roster read", er.roster_read(PHONES_SQL, None) is None)
check("nor is a read of anything else",
      er.roster_read("SELECT * FROM asa_call_off_tracker WHERE shift_date BETWEEN %s AND %s",
                     ("a", "b")) is None)
SIBLING = Path(os.environ.get("HUB_COMM_WHEN_ORACLE") or "/dev/null/none")
if SIBLING.exists():
    sib = SIBLING.read_text(encoding="utf-8")
    body = fn_source(sib, "moments")
    stmt = re.search(r'cur\.execute\(\s*((?:"[^"]*"\s*)+),', body)
    text = "".join(re.findall(r'"([^"]*)"', stmt.group(1))) if stmt else ""
    check("the sibling's own moments() statement is the one the lens recognises",
          er.roster_read(text, ("CALENDAR", "a", "b")) == ("public.asa_schedules", "a", "b"), text)
    check("and its phone book is left alone", "phone AS p FROM public.asa_schedules" in sib
          and er.roster_read(PHONES_SQL, None) is None)
else:
    print("  (the sibling's comm_when.py is not on this host — the lane holds the lens to it)")

calls: list = []


class FakeCur:
    def __init__(self, rows):
        self.rows, self.sql, self.connection = rows, None, "the real connection"

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, args=None):
        self.sql = sql

    def fetchall(self):
        return list(self.rows)

    description = "passes through"


class FakeConn:
    def __init__(self, rows):
        self.rows = rows

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self, *a, **k):
        return FakeCur(self.rows)


fake_driver = types.ModuleType("fake_psycopg2")
fake_driver.connect = lambda dsn: FakeConn([{"house": "BM4060", "staff_name": "Ann Roe",
                                             "shift_date": D, "shift_raw": "8A-8P"}])
fake_driver.extras = types.SimpleNamespace(RealDictCursor="RDC")
computation = types.ModuleType("fake_comm_when")
computation.psycopg2 = fake_driver
held_lay = er.lay
er.lay = lambda cur, rows, lo, hi, table=None, keep_empty=False: calls.append((table, lo, hi)) or rows + ["LAID"]
try:
    er.lens(computation)
    er.lens(computation)
    check("the lens is put on once", type(computation.psycopg2).__name__ == "_LensDriver"
          and type(computation.psycopg2._real).__name__ == "module")
    check("the driver's own attributes pass through", computation.psycopg2.extras.RealDictCursor == "RDC")
    with computation.psycopg2.connect("dsn") as conn, conn.cursor(cursor_factory="RDC") as cur:
        cur.execute(MOMENTS_SQL, ("CALENDAR", D, D + timedelta(days=6)))
        got = cur.fetchall()
        cur.execute(PHONES_SQL)
        untouched = cur.fetchall()
        passes = (cur.description, cur.connection)
    check("a roster read is laid over, with the table and days its statement names",
          got[-1] == "LAID" and calls == [("public.asa_schedules", D, D + timedelta(days=6))], calls)
    check("any other statement's rows come back exactly as fetched",
          "LAID" not in untouched and len(calls) == 1)
    check("the cursor's own attributes pass through (connection, description)",
          passes == ("passes through", "the real connection"))
finally:
    er.lay = held_lay

print("\nTHE BELL — a publish tells every reader, and one deaf reader stops nobody")
heard: list = []
said: list = []


class Said(logging.Handler):
    def emit(self, record):
        said.append(record.getMessage())


er.log.addHandler(Said())
er.log.propagate = False
er._LISTENERS.clear()
er.on_change(lambda e: heard.append(e))
er.on_change(lambda e: (_ for _ in ()).throw(RuntimeError("deaf")))
er.on_change(lambda e: heard.append(("second", e["house"])))
n = er.announce("CAN - BM - BM4060", [{"employee": "Ann Roe", "col_iso": "2026-09-24",
                                       "value": "8A-4P", "base": "8A-8P"}],
                via="publish", actor="Hana Boss")
check("every listener that could hear it did, past the one that failed", n == 2 and len(heard) == 2,
      heard)
check("…and the one that failed is said, with the house and what it could not hear",
      any("could not be told of 1 published cell(s) at CAN - BM - BM4060" in s and "deaf" in s
          for s in said), said)
check("the event names the house, the cells, the road and the person",
      heard and heard[0]["house"] == "BM4060" and heard[0]["cells"] == [
          {"employee": "Ann Roe", "col_iso": "2026-09-24", "value": "8A-4P"}]
      and heard[0]["via"] == "publish" and heard[0]["actor"] == "Hana Boss", heard[:1])
check("a publish that wrote nothing rings nobody", er.announce("CAN - BM - BM4060", []) == 0)
er._LISTENERS.clear()

relay = src("snapshot_service")
listener = fn_source(relay, "_roster_published")
ran: list = []
ns = {
    "shift_slices": types.SimpleNamespace(forget=lambda: ran.append("forget")),
    "psi_attendance": types.SimpleNamespace(roster_moved=lambda: ran.append("roster_moved")),
    "shift_requests": types.SimpleNamespace(forget_estate=lambda: ran.append("forget_estate")),
    "_mark_dirty": lambda names: ran.append(("dirty", tuple(names))),
    "_event_loop": None, "ROSTER_SLICES": ("shifts", "shiftCards"),
    "log": types.SimpleNamespace(info=lambda *a, **k: ran.append("logged")), "Any": object,
}
exec(compile(listener, "snapshot_service._roster_published", "exec"), ns)  # noqa: S102
ns["_roster_published"]({"location": "CAN - BM - BM4060", "cells": [{}], "via": "publish",
                         "actor": "Hana Boss"})
check("the relay's listener clears the Shift Board's memo, marks the shift flow's roster stale, "
      "drops the overlap law's held picture and queues the slices",
      ran == ["forget", "roster_moved", "forget_estate", ("dirty", ("shifts", "shiftCards")),
              "logged"], ran)
hops: list = []
ns["_event_loop"] = types.SimpleNamespace(call_soon_threadsafe=lambda fn, arg: hops.append((fn, arg)))
ran.clear()
ns["_roster_published"]({"location": "x", "cells": []})
check("…and from the writer's thread it hands the queue to the loop, never touches it itself",
      len(hops) == 1 and hops[0][1] == ("shifts", "shiftCards") and not any(
          isinstance(r, tuple) for r in ran), (hops, ran))
check("the relay registers the listener at start",
      "effective_roster.on_change(_roster_published)" in fn_source(relay, "_start"))
check("the slices it queues are the Shift Board's four and the window ask's two — and not `events`,"
      " whose rebuild can spend an execution",
      re.search(r"ROSTER_SLICES = tuple\(shift_slices\.RESOURCES\) \+ "
                r"tuple\(comm_when_slices\.RESOURCES\)", relay) is not None
      and set(shift_slices.RESOURCES) == {"shifts", "shiftCards", "shiftMatrix", "shiftTimeline"})

pa._CACHE["at"] = datetime.now(UTC).timestamp() - 5
pa._ROSTER_MOVED["at"] = 0.0
before = pa.roster_moved_since_read()
pa.roster_moved()
after = pa.roster_moved_since_read()
pa._CACHE["at"] = datetime.now(UTC).timestamp() + 1
reread = pa.roster_moved_since_read()
check("the shift flow's roster is stale from the moment a publish is heard, until it is read again",
      (before, after, reread) == (False, True, False), (before, after, reread))
pa._CACHE["at"], pa._ROSTER_MOVED["at"] = 0.0, 0.0
check("and its pass reads the books again when it is",
      "or roster_moved_since_read()" in fn_source(src("psi_attendance"), "_pass"))

shift_slices._memo.update(data={"x": 1}, at=9e12, day=None)
shift_slices.forget()
check("the Shift Board forgets its memo", shift_slices._memo["data"] is None)
check("a Shift Board row is marked only when its cell was published",
      shift_slices._marked({"id": 1}, {"published": {"by": "x"}}) == {"id": 1, "published": {"by": "x"}}
      and shift_slices._marked({"id": 1}, {"kind": "day"}) == {"id": 1}
      and shift_slices._marked({"id": 1}, None) == {"id": 1})

print("\nREACH — nothing reads a shift from the copy without the published cells laid in")
READS = re.compile(r"(?i)\bfrom\s+(?:public\.)?asa_schedules\b|\bfrom\s+\{(?:effective_roster\.)?"
                   r"SCHEDULES\}")
ALLOWED = {
    ("shift_slices", "_fetch"): "lay",
    ("psi_attendance", "roster"): "lay",
    ("daily_notes", "_read_schedule"): "_published_over",
    ("snapshot_service", "_ist_roster_read"): "lay",
    ("behavior_slices", "_roster_phones"): None,     # a phone book, never a shift
}


def literals(tree):
    docs = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.body \
                and isinstance(n.body[0], ast.Expr) and isinstance(n.body[0].value, ast.Constant):
            docs.add(id(n.body[0].value))
    for n in ast.walk(tree):
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docs:
            yield n.lineno, n.value
        elif isinstance(n, ast.JoinedStr):
            yield n.lineno, "".join(v.value if isinstance(v, ast.Constant)
                                    else "{" + ast.unparse(v.value) + "}" for v in n.values)


found: dict = {}
for path in sorted(SERVER.glob("*.py")):
    text = path.read_text(encoding="utf-8")
    tree = ast.parse(text)
    spans = [(n.lineno, n.end_lineno, n.name) for n in ast.walk(tree)
             if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    for line, lit in literals(tree):
        if not READS.search(lit):
            continue
        owner = min((s for s in spans if s[0] <= line <= s[1]), key=lambda s: s[1] - s[0],
                    default=(0, 0, "<module>"))
        found.setdefault((path.stem, owner[2]), 0)
        found[(path.stem, owner[2])] += 1
stray = sorted(k for k in found if k not in ALLOWED)
check("every read of the roster copy in the relay is one of the known readers", not stray, stray)
for (mod, fn), via in ALLOWED.items():
    if via is None:
        continue
    body = fn_source(src(mod), fn)
    check(f"{mod}.{fn} reads it and lays the published cells in ({via})",
          (mod, fn) in found and f"{via}(" in body, body[:120])
check("Daily Notes lays them keeping emptied cells, over the table it reads",
      'table="asa_schedules", keep_empty=True' in fn_source(src("daily_notes"), "_published_over"))
check("the window ask's computation is loaded through the lens",
      "effective_roster.lens(mod)" in fn_source(src("comm_when_feed"), "module"))
check("House Calendars' pending layer is the same rule, not a second one",
      "effective_roster.pending_on_mirror(cur, location)" in fn_source(src("house_cal_live"),
                                                                       "pending_publishes"))
check("the roster readers name the copy by the one name, which is the live table",
      er.SCHEDULES == "public.asa_schedules"
      and "{effective_roster.SCHEDULES}" in fn_source(src("psi_attendance"), "roster")
      and "{effective_roster.SCHEDULES}" in fn_source(src("shift_slices"), "_fetch"))
recorded = fn_source(src("calendar_builder_houses"), "_record_published")
check("the one writer rings the bell after the record is committed, never before",
      "effective_roster.announce(location, writes" in recorded
      and recorded.index("conn.commit()") < recorded.index("effective_roster.announce("))
pushed = fn_source(src("calendar_builder_write"), "_push_house")
houses = fn_source(src("calendar_builder_write"), "publish_houses")
check("so does the master grid's push to the houses — it is not a second writer: every house's "
      "cells go through the one writer by the house publish's own law, and the push itself "
      "writes no cell of a house tab",
      "cbh.push_house(" in pushed and "publish_cells(" in fn_source(src("calendar_builder_houses"),
                                                                    "push_house")
      and "batchUpdate" not in houses and "batchUpdate" not in pushed
      and "_house_own_cells(" in pushed)
master = fn_source(relay, "lane_cal_builder_publish")
check("the MASTER grid's publish is read again at once by its own readers (the Builder's tabs, the "
      "coverage built on calendarGrid) — its cells reach shifts only through the Houses… push",
      "calendar_builder_slices.forget_grid()" in master
      and "_mark_dirty(calendar_builder_slices.RESOURCES)" in master
      and "_builder_master(authorization)" in master)
import calendar_builder_slices as cbs  # noqa: E402
cbs._GRID_CACHE.update(at=1.0, rows=[{"x": 1}])
cbs.forget_grid()
check("…and the grid's cache is forgotten", cbs._GRID_CACHE == {"at": None, "rows": None})
check("the Shift Board reads the copy's newest edit before anything is laid over it",
      fn_source(src("shift_slices"), "_fetch").index('newest = rows[0]["newest"]')
      < fn_source(src("shift_slices"), "_fetch").index("effective_roster.lay("))


LANE = r'''
import importlib.util, json, os, sys, types
from datetime import datetime, timedelta, timezone
sys.path.insert(0, LANE_DIR)
import psycopg2, psycopg2.extras
import lane_schema
import effective_roster as er
# an unregistered switch holds; this lane writes unless a check turns test mode on
OFF = {"on": False, "readable": True, "word": "off", "why": ""}
er.use_switch(lambda: OFF)
import house_cal_live as hcl
import shift_requests as sr
import shift_handoff
import calendar_builder_houses as cbh
import shift_slices
import psi_attendance as pa
import psi_reminders as pr
import daily_notes as dn
import comm_when_feed as cwf

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
ROOMS = lane_schema.Rooms(DSN, "effective-roster")
SCHEMA, BROKEN = ROOMS.name(), ROOMS.name("broken")
OUT = {}
UTC = timezone.utc
BM = "CAN - BM - BM4060"
today = datetime.now(hcl.OHIO).date()
DM, D0, D1, D2 = (today + timedelta(days=k) for k in (-1, 0, 1, 2))
ISOS = [d.isoformat() for d in (DM, D0, D1, D2)]
# the IST settings as a read that landed, holding the shipped values
import ist_config
ist_config.pin(dict(ist_config.SHIPPED))
EVERY = {"done": 1, "owed": 0, "clients": [], "owed_for": []}
sr.ist_index = lambda dsn, **k: {
    "readable": True, "why": "", "rows": 0, "source": "test",
    "by_person": {sr.fold(n): {"BM4060": dict(EVERY)}
                  for n in ("Ann Roe", "Ben Left", "Cy Far", "Dee Way")}}
# no live call-off book is read by the pool's sweep in this run
sr.call_off_shifts = lambda dsn, **k: []


def grid(rows):
    return {"cols": [{"iso": i} for i in ISOS],
            "rows": [{"employee": e, "cells": [{"text": t} for t in cs]} for e, cs in rows]}


GRIDS = {BM: grid([("OPEN", ["", "", "8P-8A", ""]),
                   ("Ann Roe", ["8A-8P", "8A-8P", "2P-10P", ""]),
                   ("Ben Left", ["", "", "", "8A-4P"]),
                   ("Cy Far", ["", "", "", "10P-8A"]),
                   ("Dee Way", ["7A-3P", "", "", ""])])}
# the per-house copy as the ingester leaves it (a stale row, another spelling)
COPY = [("Ann Roe", DM, "8A-8P", "2 hours"), ("Ann Roe", D0, "8A-8P", "2 hours"),
        ("Ann Roe", D0, "7A-7P", "3 days"), ("Ann Roe", D1, "2P-10P", "2 hours"),
        ("BEN LEFT", D2, "8A-4P", "2 hours"), ("Cy Far", D2, "10P-8A", "2 hours"),
        ("Dee Way", DM, "7A-3P", "2 hours")]
SCHED_DDL = ("CREATE TABLE asa_schedules (id SERIAL PRIMARY KEY, source_id VARCHAR(64), "
             "house VARCHAR(100), staff_name VARCHAR(200), phone VARCHAR(20), shift_date DATE, "
             "shift_raw VARCHAR(200), shift_start VARCHAR(10), shift_end VARCHAR(10), "
             "location_code VARCHAR(50), tab_name VARCHAR(200), updated_at TIMESTAMPTZ DEFAULT NOW(), "
             "UNIQUE(source_id, house, staff_name, shift_date, shift_raw))")
LIVE_DDL = ("CREATE TABLE asa_house_calendar_live (location TEXT PRIMARY KEY, grid JSONB, "
            "updated_at TIMESTAMPTZ DEFAULT now() - interval '1 minute')")

ROOMS.make()
ROOMS.make("broken")


def dsn_for(schema):
    return ROOMS.path(schema)


T = dsn_for(SCHEMA)


def run(sql, args=(), dsn=None):
    with psycopg2.connect(dsn or T) as c, c.cursor() as cur:
        cur.execute(sql, args)
        c.commit()


def roster_of(day_from, day_to):
    shifts, _ = pa.roster(T, day_from, day_to)
    return {(s["name"], s["shift_date"].isoformat()): [s["shift_at"].astimezone(hcl.OHIO).strftime("%H:%M"),
                                                      s["shift_end"].astimezone(hcl.OHIO).strftime("%H:%M"),
                                                      s["shift_code"]] for s in shifts}


def norm(v):
    if isinstance(v, dict):
        return {(k if isinstance(k, str) else repr(norm(k))): norm(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [norm(x) for x in v]
    if isinstance(v, (set, frozenset)):
        return sorted(repr(norm(x)) for x in v)
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def stable(v):
    return json.dumps(norm(v), sort_keys=True, default=str)


def board_of(day_from, day_to, days):
    shifts, _ = pa.roster(T, day_from, day_to)
    recent = set()
    for s in shifts:
        recent |= set(s["keys"])
    got = pa.board(shifts, {}, recent, {}, [], datetime.now(UTC), None, days)
    return [r for r in got["rows"] if r["row_kind"] == "shift"]


def slices():
    shift_slices.forget()
    return shift_slices._build(T)


def matrix_of(built, name, day):
    return [{"code": r["code"], "published": r.get("published")} for r in built["shiftMatrix"][0]
            if r["staffName"].lower() == name.lower() and r["date"] == day.isoformat()]


def timeline_of(built, name, day):
    return [[r["startHour"], r["endHour"]] for r in built["shiftTimeline"][0]
            if r["staffName"].lower() == name.lower() and r["date"] == day.isoformat()]


def chip_of(built, name, day):
    card = next((c for c in built["shiftCards"][0] if c["personName"].lower() == name.lower()), None)
    if card is None:
        return None
    week0 = today - timedelta(days=(today.weekday() + 2) % 7)
    i = (day - week0).days
    return card["week"][i] if 0 <= i < 7 else "outside this week"


def notes_of(day):
    sched, _ = dn._read_schedule(T, {day})
    return ({f"{k[0]}|{k[1].isoformat()}": [[s["start_m"], s["end_m"]] for s in v]
             for k, v in sched["shifts"].items() if k[1] == day}, sched["failed"], sched["live_read"])


def key(name):
    return dn.client_name_key(name)


# the real comm_when module, lensed, plus a copy pointed at this run's roster table
real_when = cwf.module()
text = open(real_when.__file__, encoding="utf-8").read().replace("public.asa_schedules", "asa_schedules")
spec = importlib.util.spec_from_loader("comm_when_this_run", loader=None)
copy_when = importlib.util.module_from_spec(spec)
exec(compile(text, "comm_when_this_run", "exec"), copy_when.__dict__)
er.lens(copy_when)


def moments_of(mod, name, day):
    found, _counts, _everybody = mod.moments(T, 7)
    return sorted(m["shift_at"].astimezone(hcl.OHIO).strftime("%H:%M") for m in found
                  if mod._key(m["name"]) == mod._key(name) and m["shift_date"] == day)


EVENTS = []
er._LISTENERS.clear()
# what the relay's listener does, short of queueing slices this run has no loop for
er.on_change(lambda e: (EVENTS.append(e), shift_slices.forget(), pa.roster_moved()))
er.SCHEDULES = "asa_schedules"   # the roster readers read this run's copy

try:
    # a database that never held a publish (this schema alone)
    ALONE = DSN + ("&" if "?" in DSN else "?") + "options=-csearch_path%3D" + SCHEMA
    with psycopg2.connect(ALONE) as c, c.cursor() as cur:
        OUT["ready_empty"] = er.ready(cur)
        OUT["published_empty"] = er.published(cur)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(SCHED_DDL)
        cur.execute(LIVE_DDL)
        cur.execute(hcl.CLAIMS_DDL)
        cur.execute(shift_handoff.HANDOFFS_DDL)
        cur.execute(shift_handoff.OPEN_INDEX_DDL)
        for stmt in sr.DDL:
            cur.execute(stmt)
        for loc, g in GRIDS.items():
            cur.execute("INSERT INTO asa_house_calendar_live (location, grid) VALUES (%s,%s)",
                        (loc, psycopg2.extras.Json(g)))
        for name, day, raw, age in COPY:
            cur.execute("INSERT INTO asa_schedules (source_id, house, staff_name, phone, shift_date, "
                        "shift_raw, tab_name, updated_at) VALUES ('SRC-BM', 'BM4060', %s, "
                        "'3305550199', %s, %s, 'CALENDAR', now() - %s::interval)",
                        (name, day, raw, age))
        c.commit()
    # every table the code reads is the lane's before its first read; the roster readers read its copy
    OUT["owned"] = lane_schema.own_shift_lane(T, SCHEMA, LANE_DIR, pointers=[(er, "SCHEDULES")])
    book = cbh.MemoryWorkbook.from_grids(GRIDS)
    cbh.use_workbook(book)
    sr.forget_estate()

    # nothing published: byte for byte, with and without the lay (empty tables made here first)
    def whole():
        return {"roster": stable(pa.roster(T, DM, D1)), "slices": stable(slices()),
                "notes": stable(dn._read_schedule(T, {D0, D1})[0])}
    hcl.ensure_tables(T)
    cbh.ensure_tables(T)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        OUT["ready_tables"] = er.ready(cur)
        cur.execute("SELECT * FROM asa_schedules")
        rows = cur.fetchall()
        OUT["same_object"] = er.lay(cur, rows, DM, D2) is rows
    empty_table = whole()
    held = er.lay
    er.lay = lambda cur, rows, *a, **k: rows
    try:
        reference = whole()
    finally:
        er.lay = held
    OUT["identical_empty_table"] = empty_table == reference
    OUT["stale_row_before"] = matrix_of(slices(), "Ann Roe", D0)

    # ── A PUBLISHED END TIME: the shift flow's window and the Cards, at once ─
    OUT["roster_before"] = roster_of(DM, D1).get(("Ann Roe", D0.isoformat()))
    board_before = [r for r in board_of(DM, D1, [D0]) if r["person"] == "Ann Roe"]
    OUT["board_end_before"] = board_before[0]["shift_end"][11:16] if board_before else None
    held_cards = shift_slices._cached(T)                       # the memo, filled before the publish
    OUT["cards_before"] = (chip_of(held_cards, "Ann Roe", D0) or {}).get("code")
    pa._CACHE["at"] = datetime.now(UTC).timestamp()
    OUT["stale_before_publish"] = pa.roster_moved_since_read()
    cbh.stage_cell(T, location=BM, employee="Ann Roe", col_iso=D0.isoformat(), value="8A-4P",
                   actor="Hana Boss")
    pub = cbh.publish_house(T, location=BM, actor="Hana Boss")
    OUT["published_end"] = [pub["written"], book.cell(BM, "Ann Roe", D0.isoformat())]
    OUT["bell"] = [[e["house"], e["via"], e["actor"], e["cells"]] for e in EVENTS]
    OUT["stale_after_publish"] = pa.roster_moved_since_read()
    OUT["memo_forgotten"] = shift_slices._memo["data"] is None
    OUT["roster_after"] = roster_of(DM, D1).get(("Ann Roe", D0.isoformat()))
    board_after = [r for r in board_of(DM, D1, [D0]) if r["person"] == "Ann Roe"]
    OUT["board_end_after"] = board_after[0]["shift_end"][11:16] if board_after else None
    at0 = datetime(D0.year, D0.month, D0.day, 8, tzinfo=hcl.OHIO)
    OUT["note_slots"] = [
        [t.astimezone(hcl.OHIO).strftime("%H:%M") for t in pr.note_slots(at0, at0 + timedelta(hours=12))][:3],
        [t.astimezone(hcl.OHIO).strftime("%H:%M") for t in pr.note_slots(at0, at0 + timedelta(hours=8))][:3]]
    built = shift_slices._cached(T)
    OUT["cards_after"] = chip_of(built, "Ann Roe", D0)
    OUT["matrix_after"] = matrix_of(built, "Ann Roe", D0)
    OUT["timeline_after"] = timeline_of(built, "Ann Roe", D0)
    OUT["flat_after"] = [[r["start"], r["end"]] for r in built["shifts"][0]
                         if r["staff"] == "Ann Roe" and r["date"] == D0.isoformat()]
    OUT["dee_untouched"] = [r.get("published") for r in built["shiftMatrix"][0]
                            if r["staffName"] == "Dee Way"]

    # ── A MOVED SHIFT: it leaves Ann and reaches Ben, everywhere ────────────
    cbh.stage_move(T, location=BM, src_employee="Ann Roe", src_iso=D1.isoformat(),
                   dst_employee="Ben Left", dst_iso=D1.isoformat(), actor="Hana Boss")
    cbh.publish_house(T, location=BM, actor="Hana Boss")
    moved = roster_of(D0, D1)
    OUT["moved_roster"] = [moved.get(("Ann Roe", D1.isoformat())), moved.get(("BEN LEFT", D1.isoformat()))]
    rows = board_of(D0, D1, [D1])
    OUT["moved_board"] = sorted([r["person"], r["shift_at"][11:16], r["shift_end"][11:16]] for r in rows)
    ask_at = datetime(D1.year, D1.month, D1.day, 13, 40, tzinfo=hcl.OHIO).astimezone(UTC)
    planned = pr.plan([dict(r, known=True) for r in rows], mode="calendar", now=ask_at, ledger={},
                      stopped={})
    OUT["confirm_flow"] = pr.CONFIRM_FLOW
    OUT["moved_asks"] = sorted({r["person"] for r in planned["due"] + planned["held"]
                                if r["kind"] in ("confirm_ask", "confirm_again")})
    built = slices()
    OUT["moved_matrix"] = [matrix_of(built, "Ann Roe", D1), [m["code"] for m in matrix_of(built, "Ben Left", D1)]]
    OUT["moved_cards"] = [(chip_of(built, "Ben Left", D1) or {}).get("code")
                          if isinstance(chip_of(built, "Ben Left", D1), dict) else chip_of(built, "Ben Left", D1)]
    notes, failed, live = notes_of(D1)
    OUT["moved_notes"] = [notes.get(f"{key('Ann Roe')}|{D1.isoformat()}"),
                          notes.get(f"{key('Ben Left')}|{D1.isoformat()}"), failed, live]
    OUT["moved_when_copy"] = [moments_of(copy_when, "Ann Roe", D1), moments_of(copy_when, "Ben Left", D1)]
    OUT["moved_when_real"] = moments_of(real_when, "Ben Left", D1)
    shown = hcl.merged_grid(T, BM)
    col = ISOS.index(D1.isoformat())
    OUT["moved_calendar"] = {r["employee"]: r["cells"][col].get("text", "") for r in shown["rows"]
                             if r["employee"] in ("Ann Roe", "Ben Left")}

    # ── THE HOUSE MANAGER'S DECISION ON AN OPEN SHIFT: Cy, everywhere ───────
    sr.forget_estate()
    sr.sweep(T)
    took = sr.take_open_shift(T, location=BM, open_row="OPEN", col_iso=D1.isoformat(),
                              person="Cy Far", by="Hana Boss", may_decide=True)
    OUT["decided"] = [took.get("decided"), took.get("how"), book.cell(BM, "Cy Far", D1.isoformat())]
    OUT["decided_bell"] = EVENTS[-1]["via"] if EVENTS else None
    OUT["decided_roster"] = roster_of(D1, D2).get(("Cy Far", D1.isoformat()))
    built = slices()
    OUT["decided_matrix"] = matrix_of(built, "Cy Far", D1)
    notes, failed, live = notes_of(D1)
    OUT["decided_notes"] = notes.get(f"{key('Cy Far')}|{D1.isoformat()}")
    OUT["decided_when"] = [moments_of(copy_when, "Cy Far", D1), moments_of(real_when, "Cy Far", D1)]
    sr.forget_estate()
    OUT["decided_estate"] = sr.estate(T, fresh=True)["cells"][BM].get(("Cy Far", D1.isoformat()))
    shown = hcl.merged_grid(T, BM)
    OUT["decided_calendar"] = next((r["cells"][col].get("text", "") for r in shown["rows"]
                                    if r["employee"] == "Cy Far"), None)
    OUT["no_open_person"] = [n for n in roster_of(DM, D2) if n[0].upper().startswith("OPEN")]

    # ── THE COPY MOVED ON AFTER THE PUBLISH: its newer word stands ──────────
    run("INSERT INTO asa_schedules (source_id, house, staff_name, phone, shift_date, shift_raw, "
        "tab_name, updated_at) VALUES ('SRC-BM', 'BM4060', 'BEN LEFT', '', %s, '3P-11P', 'CALENDAR', "
        "now() + interval '1 minute')", (D1,))
    later = roster_of(D0, D1)
    OUT["copy_newer"] = [later.get(("BEN LEFT", D1.isoformat())), later.get(("Ann Roe", D1.isoformat()))]

    # ── A WINDOW WITH NOTHING PUBLISHED IN IT: untouched ────────────────────
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT * FROM asa_schedules")
        rows = cur.fetchall()
        far = today + timedelta(days=20)
        OUT["far_window_same"] = er.lay(cur, rows, far, far + timedelta(days=3)) is rows

    # ── THE MIRROR CAUGHT UP: confirmed, then typed over by hand ────────────
    g = json.loads(json.dumps(GRIDS[BM]))
    g["rows"][1]["cells"][ISOS.index(D0.isoformat())]["text"] = "8A-4P"
    g["rows"][1]["cells"][ISOS.index(D1.isoformat())]["text"] = ""
    run("UPDATE asa_house_calendar_live SET grid=%s, updated_at=now() + interval '10 minutes' "
        "WHERE location=%s", (psycopg2.extras.Json(g), BM))
    with psycopg2.connect(T) as c, c.cursor() as cur:
        eff = {(x["employee"], x["day"].isoformat()): [x["state"], x["value"]]
               for x in er.effective_cells(cur, DM, D2)}
        OUT["pending_left"] = er.pending_on_mirror(cur)
    OUT["confirmed"] = eff.get(("Ann Roe", D0.isoformat()))
    OUT["emptied_confirmed"] = eff.get(("Ann Roe", D1.isoformat()))
    OUT["still_laid"] = roster_of(DM, D1).get(("Ann Roe", D0.isoformat()))
    g["rows"][1]["cells"][ISOS.index(D0.isoformat())]["text"] = "9A-3P"
    run("UPDATE asa_house_calendar_live SET grid=%s WHERE location=%s", (psycopg2.extras.Json(g), BM))
    OUT["changed_roster"] = roster_of(DM, D1).get(("Ann Roe", D0.isoformat()))
    OUT["changed_marker"] = [(m["code"], (m["published"] or {}).get("state"))
                             for m in matrix_of(slices(), "Ann Roe", D0)]
    OUT["gone_stays_gone"] = roster_of(D0, D1).get(("Ann Roe", D1.isoformat()))

    # a held cell is laid only while test mode holds
    er.use_switch(lambda: {"on": True, "readable": True, "word": "on", "why": ""})
    cbh.stage_cell(T, location=BM, employee="Cy Far", col_iso=D2.isoformat(), value="6P-10P",
                   actor="Hana Boss")
    held = cbh.publish_house(T, location=BM, actor="Hana Boss")
    pa.roster_moved()
    OUT["held_publish"] = [held.get("test_mode"), book.cell(BM, "Cy Far", D2.isoformat())]
    OUT["held_roster"] = roster_of(D1, D2).get(("Cy Far", D2.isoformat()))
    OUT["held_matrix"] = [(m["code"], (m["published"] or {}).get("state"))
                          for m in matrix_of(slices(), "Cy Far", D2)]
    er.use_switch(lambda: {"on": False, "readable": True, "word": "off", "why": ""})
    pa.roster_moved()
    OUT["off_roster"] = roster_of(D1, D2).get(("Cy Far", D2.isoformat()))
    OUT["off_matrix"] = [(m["code"], (m["published"] or {}).get("state"))
                         for m in matrix_of(slices(), "Cy Far", D2)]
    er.use_switch(lambda: OFF)

    # ── A RECORD THAT CANNOT BE READ IS NEVER "NOTHING PUBLISHED" ───────────
    B = dsn_for(BROKEN)
    run(SCHED_DDL, dsn=B)
    run(LIVE_DDL, dsn=B)
    run("CREATE TABLE asa_house_calendar_edits (id BIGSERIAL PRIMARY KEY, location TEXT, "
        "employee TEXT, col_iso TEXT, stage TEXT, at TIMESTAMPTZ DEFAULT now())", dsn=B)
    run("INSERT INTO asa_house_calendar_live (location, grid) VALUES (%s, %s)",
        (BM, psycopg2.extras.Json(GRIDS[BM])), dsn=B)
    run("INSERT INTO asa_house_calendar_edits (location, employee, col_iso, stage) "
        "VALUES (%s, 'Ann Roe', %s, 'published')", (BM, D0.isoformat()), dsn=B)
    # the broken room owns every other table too: its failure is its own record's, never a public read
    OUT["broken_owned"] = lane_schema.own_shift_lane(
        B, BROKEN, LANE_DIR, skip=("asa_house_calendar_edits",),
        names=("asa_schedules", "asa_house_calendar_edits"))
    try:
        pa.roster(B, DM, D1)
        OUT["broken_roster"] = "answered"
    except Exception as exc:
        OUT["broken_roster"] = type(exc).__name__
    try:
        shift_slices.forget()
        shift_slices._build(B)
        OUT["broken_slices"] = "answered"
    except Exception as exc:
        OUT["broken_slices"] = type(exc).__name__
    sched, _ = dn._read_schedule(B, {D0})
    OUT["broken_notes"] = [sched["live_read"], sched["failed"]]
except Exception as exc:  # noqa: BLE001
    OUT["crash"] = f"{type(exc).__name__}: {exc}"
    import traceback
    OUT["trace"] = traceback.format_exc()[-3000:]
finally:
    cbh.use_workbook(None)
    er._LISTENERS.clear()
    OUT["rooms"] = ROOMS.close()
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''

MODULES = ("effective_roster", "shift_slices", "psi_attendance", "psi_reminders", "daily_notes",
           "comm_when_feed", "comm_when_slices", "house_cal_live", "shift_requests",
           "shift_handoff", "calendar_builder_houses", "calendar_builder_write",
           "calendar_builder_slices", "house_directory", "badge_follows", "hotline_desk",
           "mirror_first", "time_off", "redaction")


def _lane_in_container(script_body: str = LANE) -> dict | None:
    # every module the roots reach, and the IST settings reader's declaration, in a folder of this run's own
    sources = lane_schema.with_imports(SERVER, (*MODULES, "ist_config"))
    return lane_schema.run_in(CONTAINER, lane_schema.script(sources, script_body, "effective-roster"))


print("\nTHE LANE — publish once, and every reader of a shift sees it")
lane = _lane_in_container()
if lane is None:
    print("  (skipped — no docker here to reach a relay container)")
    print("  NOTE: the pure half above still ran; the lane half did not.")
else:
    if lane.get("crash"):
        check("the lane ran to its end", False, lane.get("trace") or lane["crash"])
    L = lane.get
    for room, broken in (("owned", False), ("broken_owned", True)):
        got = (L(room) or {}).get("lane") or {}
        check(f"{room}: every table the room reads resolves in its own schema before the first read, never "
              "public — the roster copy the readers are pointed at included",
              bool(got) and "asa_schedules" in got
              and all(str(s).startswith("hub_test_effective_roster_") and str(s).endswith("_broken") is broken
                      for s in got.values()), L(room))
    check("a database with no record table has never held a publish — said as nothing, not as an error",
          L("ready_empty") is False and L("published_empty") == [], [L("ready_empty"), L("published_empty")])
    check("with the tables in place it can have", L("ready_tables") is True)
    check("NOTHING PUBLISHED: the roster rows handed in are handed back — the same object",
          L("same_object") is True)
    check("…and the shift flow, the Shift Board and Daily Notes answer byte for byte as with no "
          "lay at all", L("identical_empty_table") is True)
    check("(before any publish the Shift Board shows the copy's own pick for Ann today, unmarked)",
          len(L("stale_row_before") or []) == 1
          and (L("stale_row_before") or [{}])[0].get("published") is None, L("stale_row_before"))

    check("the Builder's publish wrote the new end into the workbook",
          L("published_end") == [1, "8A-4P"], L("published_end"))
    check("the writer rang the bell with the cell, the road and the person",
          (L("bell") or [[None]])[0][:3] == ["BM4060", "publish", "Hana Boss"]
          and (L("bell") or [[None, None, None, [{}]]])[0][3][0].get("value") == "8A-4P", L("bell"))
    check("the shift flow's roster turned stale the moment the bell rang",
          L("stale_before_publish") is False and L("stale_after_publish") is True,
          [L("stale_before_publish"), L("stale_after_publish")])
    check("and the Shift Board's memo was forgotten", L("memo_forgotten") is True)
    check("THE SHIFT FLOW: Ann's shift today ended at 20:00 and ends at 16:00 now",
          L("roster_before") == ["08:00", "20:00", "8A-8P"]
          and L("roster_after") == ["08:00", "16:00", "8A-4P"], [L("roster_before"), L("roster_after")])
    check("…on the board the reminders are planned from",
          L("board_end_before") == "20:00" and L("board_end_after") == "16:00",
          [L("board_end_before"), L("board_end_after")])
    check("…so the daily-note reminders fall four hours earlier (end-30, end-10, end+10)",
          (L("note_slots") or [[], []]) == [["19:30", "19:50", "20:10"], ["15:30", "15:50", "16:10"]],
          L("note_slots"))
    check("THE CARDS: the memo held the copy's own pick before the publish (a row the copy never "
          "deleted can be it), and the very next build says 8A-4P",
          L("cards_before") in ("8A-8P", "7A-7P") and (L("cards_after") or {}).get("code") == "8A-4P",
          [L("cards_before"), L("cards_after")])
    check("…marked as published, with who and how", ((L("cards_after") or {}).get("published") or {})
          .get("by") == "Hana Boss" and (L("cards_after") or {}).get("published", {}).get("via") == "publish",
          L("cards_after"))
    check("THE CALENDAR: one cell for Ann today, the new one — the stale 7A-7P row cannot come back",
          [m["code"] for m in (L("matrix_after") or [])] == ["8A-4P"], L("matrix_after"))
    check("THE TIMELINE and the flat board /shift/of reads: 8 to 16",
          L("timeline_after") == [[8.0, 16.0]] and L("flat_after") == [["08:00", "16:00"]],
          [L("timeline_after"), L("flat_after")])
    check("a person nobody published is drawn exactly as the copy says, unmarked",
          L("dee_untouched") == [None], L("dee_untouched"))

    check("THE SHIFT FLOW: the moved shift left Ann and reached Ben (as his calendar spells him)",
          L("moved_roster") == [None, ["14:00", "22:00", "2P-10P"]], L("moved_roster"))
    check("…on the board: only Ben has tomorrow's 14:00",
          L("moved_board") == [["BEN LEFT", "14:00", "22:00"]], L("moved_board"))
    if L("confirm_flow"):
        check("…and the T-30 ask goes to Ben, never to Ann", L("moved_asks") == ["BEN LEFT"],
              L("moved_asks"))
    check("THE SHIFT BOARD: Ann has no cell tomorrow, Ben has 2P-10P",
          (L("moved_matrix") or [None, None]) == [[], ["2P-10P"]], L("moved_matrix"))
    check("…and on his card", L("moved_cards") in (["2P-10P"], ["outside this week"]), L("moved_cards"))
    check("DAILY NOTES: the shift is Ben's to write the note for, not Ann's",
          (L("moved_notes") or [0, 0])[:2] == [None, [[840, 1320]]] and L("moved_notes")[3] is True,
          L("moved_notes"))
    check("THE WINDOW ASK: Ann's moment is gone and Ben's is there",
          L("moved_when_copy") == [[], ["14:00"]], L("moved_when_copy"))
    check("…and the sibling's REAL module, through the lens, finds Ben's 14:00 too",
          L("moved_when_real") == ["14:00"], L("moved_when_real"))
    check("HOUSE CALENDARS: Ann empty, Ben 2P-10P", L("moved_calendar") == {"Ann Roe": "", "Ben Left": "2P-10P"},
          L("moved_calendar"))

    check("the house manager's decision wrote Cy into the workbook, and rang the bell",
          (L("decided") or [None])[0] is True and (L("decided") or [0, 0, 0])[2] == "8P-8A"
          and str(L("decided_bell") or "").startswith("decision:"), [L("decided"), L("decided_bell")])
    check("THE SHIFT FLOW: Cy works tomorrow 20:00 to 08:00", L("decided_roster") == ["20:00", "08:00", "8P-8A"],
          L("decided_roster"))
    check("THE SHIFT BOARD: Cy's cell, marked as the decision",
          [m["code"] for m in (L("decided_matrix") or [])] == ["8P-8A"]
          and str(((L("decided_matrix") or [{}])[0].get("published") or {}).get("via", "")).startswith("decision:"),
          L("decided_matrix"))
    check("DAILY NOTES: Cy's night", L("decided_notes") == [[1200, 1920]], L("decided_notes"))
    check("THE WINDOW ASK: Cy's moment, in the copy and in the real module",
          L("decided_when") == [["20:00"], ["20:00"]], L("decided_when"))
    check("HOUSE CALENDARS and the Requests lane's estate: Cy",
          L("decided_calendar") == "8P-8A" and L("decided_estate") == "8P-8A",
          [L("decided_calendar"), L("decided_estate")])
    check("an OPEN row is nobody's shift in any roster", L("no_open_person") == [], L("no_open_person"))

    check("THE COPY SPOKE AFTER THE PUBLISH: its newer word stands for Ben; Ann's emptied cell holds",
          L("copy_newer") == [["15:00", "23:00", "3P-11P"], None], L("copy_newer"))
    check("a window with nothing published in it is handed back untouched", L("far_window_same") is True)
    check("THE MIRROR CAUGHT UP: nothing is pending on it any more", L("pending_left") == {},
          L("pending_left"))
    check("…the published end is confirmed by it, and still laid over the copy",
          L("confirmed") == ["confirmed", "8A-4P"] and L("still_laid") == ["08:00", "16:00", "8A-4P"],
          [L("confirmed"), L("still_laid")])
    check("…the emptied cell is confirmed empty — the copy, which never deletes, is overruled still",
          L("emptied_confirmed") == ["confirmed", ""] and L("gone_stays_gone") is None,
          [L("emptied_confirmed"), L("gone_stays_gone")])
    check("TYPED OVER IN THE WORKBOOK AFTERWARDS: every reader follows the workbook's own word",
          L("changed_roster") == ["09:00", "15:00", "9A-3P"]
          and L("changed_marker") == [["9A-3P", "changed"]], [L("changed_roster"), L("changed_marker")])
    check("A CELL TEST MODE HELD is laid over the shift flow's roster and the Shift Board while test mode "
          "holds — marked test_mode — and the workbook never had it",
          L("held_publish") == [True, "10P-8A"]
          and L("held_roster") == ["18:00", "22:00", "6P-10P"]
          and L("held_matrix") == [["6P-10P", "test_mode"]], [L("held_publish"), L("held_roster"),
                                                               L("held_matrix")])
    check("…and once test mode is off every reader follows the per-house copy again — nothing held is "
          "replayed", L("off_roster") == ["22:00", "08:00", "10P-8A"]
          and [m[0] for m in (L("off_matrix") or [])] == ["10P-8A"], [L("off_roster"), L("off_matrix")])
    check("A RECORD THAT CANNOT BE READ fails the shift flow's roster — never an empty answer",
          L("broken_roster") not in (None, "answered"), L("broken_roster"))
    check("…and the Shift Board's build (the previous slice stays served)",
          L("broken_slices") not in (None, "answered"), L("broken_slices"))
    check("…and Daily Notes names the live calendar as unread, saying why",
          (L("broken_notes") or [None, []])[0] is False
          and any("published cells could not be read" in f for f in (L("broken_notes") or [0, []])[1]),
          L("broken_notes"))

# ── the switch is asked on its own clock, not the builder's ────────────────
# Everything the gate holds is held under this answer, so the minutes after a
# restart and a slow slice pass both used to read as "the switch cannot be
# read" — which holds every notice and stamps every roster write that way.
notices_loop = fn_source(relay, "_notices_loop")
start = fn_source(relay, "_start")
check("the notices beat refreshes the configuration itself, so the switch is a minute old at worst",
      "_config_lane_refresh()" in notices_loop)
check("…and it asks BEFORE it publishes or beats, never after",
      notices_loop.index("_config_lane_refresh()") < notices_loop.index("web_notices.catch_up")
      < notices_loop.index("_web_beat()"))
check("…in its own try, so a refusal never costs the catch-up",
      "the config lane could not be refreshed" in notices_loop)
check("the relay asks for the switch at startup, before anything can be held by it, and starts no notices loop of "
      "its own (asa-hub-app's app/notice_clock.py runs it)",
      "_config_lane_refresh(force=True)" in start and "_notices_loop()" not in start)

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
if results["failed"]:
    for f in results["failed"]:
        print(f"  - {f}")
sys.exit(1 if results["failed"] else 0)
