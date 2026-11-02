"""asa-hub-app's Calendar Builder master grid off its own record (app/cal_builder_master.py, app/master_grid_lanes.py)
run in-process with the translated relay modules, every write on this session's pg_temp stand-ins (the record's tables
from db/cal_builder_master.sql, the relay's from db/relay_tables.sql, app.book_ops, app.edit_conflicts) on a connection
whose role cannot write app.*, the master grid the keeper keeps copied into pg_temp, the old platform's house calendars
read live, read-only:

- the record is seeded once from the kept grid and the copy's Table, and holds the grid exactly;
- the six routes answer the relay's words with the kept master grid gone: grid, cell, apply-requests, generate,
  publish (refused while test mode holds; else written into the record, the Table rows kept, the draft cleared, the
  log appended, the sheet's copy queued) and publish-houses (dry run, and held by test mode);
- the house writer keeps a publish as the houses' record and queues its copy; the cell stays laid over the live copy
  while the copy is queued;
- asa-hub-sheet-sync's side (book_ops.run on a stand-in Sheets): the master cells by place, refused on a row that names
  someone else, the Table rows appended, the house cells by name and day, the newer side kept and logged;
- the sheet's side: the keeper's grid folded in by recency (copied, agreed, both changed: the newer side, a renamed row
  the sheet's), conflicts logged, the keeper's door asking the service token;
- Google is never asked, nothing is told to the relay's clocks but the roster, and asa-hub-db's own tables are as
  they were.

Run inside asa-hub-db-sync by the in-process runner (run.sh, which loads the test from beside its drv.py):

    cp tools/test-master-grid-lanes.py "$RUNNER/test_master_grid_lanes.py"
    E=$(python3 -c 'import json;print(json.dumps({"IST":open("app/ist_config_defaults.json").read(),
        "RELAY_SQL":open("db/relay_tables.sql").read(),"MASTER_SQL":open("db/cal_builder_master.sql").read()}))')
    sh "$RUNNER/run.sh" "$PWD/app" "$RUNNER/test_master_grid_lanes.py" "$E"
"""
import logging

logging.disable(logging.CRITICAL)
import asyncio  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import sys  # noqa: E402
import types  # noqa: E402
from dataclasses import dataclass  # noqa: E402
from datetime import date, datetime, timedelta, timezone  # noqa: E402

import psycopg  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402

_fa = types.ModuleType("fastapi")
_fa.Request = object
_fr = types.ModuleType("fastapi.responses")
_fr.Response = object
sys.modules["fastapi"], sys.modules["fastapi.responses"] = _fa, _fr

OWNER = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
os.environ["HUB_DB_DSN"] = OWNER
os.environ["HUB_IST_CONFIG_DECLARATION_JSON"] = os.environ["IST"]


@dataclass(frozen=True)
class Session:
    ok: bool
    role: str = ""
    uid: str = ""
    is_master: bool = False
    acting: bool = False


SESSIONS: dict[str, Session] = {}
_fd = types.ModuleType("front_door")


async def _session(token: str):
    return SESSIONS.get(token)


_fd.session = _session
sys.modules["front_door"] = _fd

PROD_TABLES = ("asa_cal_builder_draft", "asa_cal_builder_periods", "asa_cal_builder_publish_log", "book_ops",
               "edit_conflicts", "asa_house_calendar_edits", "asa_house_calendar_overrides", "sheet_grids")
PROD = psycopg.connect(OWNER, autocommit=True, options="-c default_transaction_read_only=on")


def prod_counts() -> dict[str, int]:
    out = {t: PROD.execute(f"select count(*) from app.{t}").fetchone()[0] for t in PROD_TABLES}
    for t in ("cal_builder_master", "cal_builder_table"):
        if PROD.execute("select to_regclass(%s)", (f"app.{t}",)).fetchone()[0] is not None:
            out[t] = PROD.execute(f"select count(*) from app.{t}").fetchone()[0]
    return out


BEFORE = prod_counts()

# the stand-ins, on a role that cannot write app.*
TEST = psycopg.connect(OWNER, autocommit=True)
TEST.execute("set role asa_hub_app_ro")
TEST.execute("set search_path = pg_temp, app, public")


def temp_ddl(sql: str) -> None:
    for stmt in [s.strip() for s in re.sub(r"--[^\n]*", "", sql).split(";") if s.strip()]:
        if not stmt.lower().startswith(("create table", "create index", "create unique index")):
            continue
        stmt = re.sub(r"(?i)^create table if not exists", "create temp table", stmt.replace("app.", ""))
        TEST.execute(stmt)


temp_ddl(os.environ["RELAY_SQL"])
temp_ddl(os.environ["MASTER_SQL"])
TEST.execute("create temp table sheet_grids as select * from app.sheet_grids where kind = 'master'")
TEST.execute("create temp table edit_conflicts (id bigserial primary key, sheet_id text not null, tab_name text not null,"
             " match_by text not null, keyed_by text not null, row_key text not null, field text not null,"
             " edit_id bigint not null, base_value text not null default '', pg_value text not null default '',"
             " sheet_value text not null default '', winner text not null, why text not null default '',"
             " edit_at timestamptz, sheet_seen_at timestamptz, at timestamptz not null default now(),"
             " reviewed_at timestamptz, reviewed_by text not null default '')")

import writes  # noqa: E402

writes.EDITS_TABLE = "pg_temp.edits"
import book_ops as BO  # noqa: E402

for stmt in BO.ddl():
    TEST.execute(stmt)
TEST.execute("set search_path = app, public")

import lanes_pg  # noqa: E402

lanes_pg.SCHEMA = "pg_temp"
lanes_pg.CONNECT["own"] = lanes_pg.CONNECT["spare"] = lambda: TEST
MIRROR = psycopg.connect(os.environ["MIRROR_DSN"], autocommit=True)
MIRROR.execute("set session characteristics as transaction read only")
lanes_pg.CONNECT["intel"] = lambda: MIRROR
_close = lanes_pg._close
lanes_pg._close = lambda c: None if c is TEST else _close(c)

import lanes_sheets  # noqa: E402
import live_notify  # noqa: E402

GOOGLE: list[str] = []


def _no_google(*_a, **_k):
    GOOGLE.append("asked")
    raise RuntimeError("Google is never asked by these lanes")


lanes_sheets.sheets_service = lanes_sheets.credentials = _no_google
TOLD: list[dict] = []
DIRTY: list[list[str]] = []
live_notify.tell = lambda resources=(), **said: TOLD.append({"resources": list(resources), **said})
live_notify.tell_now = lambda **said: (TOLD.append(said), {"status": 200, "held_kept": True})[1]
live_notify.dirty = lambda names: (DIRTY.append(list(names)), list(names))[1]

import cal_builder_master as CM  # noqa: E402
import calendar_builder_houses as CBH  # noqa: E402
import calendar_builder_slices as CBS  # noqa: E402
import calendar_builder_write as CBW  # noqa: E402
import effective_roster  # noqa: E402
import house_cal_live  # noqa: E402
import master_grid_lanes as MG  # noqa: E402
import sched_lanes as SL  # noqa: E402
import shift_slices  # noqa: E402
import time_off  # noqa: E402

CM.SCHEMA = "pg_temp"
SWITCH = {"on": True}
SL.wire(types.SimpleNamespace())
effective_roster.use_switch(lambda: {"on": SWITCH["on"], "readable": True, "word": "on" if SWITCH["on"] else "off",
                                     "why": ""})
time_off.KEEPER[0] = lambda door, payload: {"status": 200, "data": {"kept": True}}
time_off.kept = lambda *, fresh=False: True
time_off._kept_rows = lambda: ([], [{"key": "directors", "value": "Nobody Listed", "_row_number": 2},
                                    {"key": "form_sync", "value": "off", "_row_number": 3}])

users = lanes_sheets.data(SL.HUB_DB_SHEET_ID, "users")
admin = next(u for u in users if str(u.get("role") or "").lower() == "admin"
             and str(u.get("active") or "").upper() != "FALSE" and not str(u.get("merged_into") or "").strip())
UID = str(admin["user_id"])
SESSIONS["ADMIN"] = Session(ok=True, role="admin", uid=UID, is_master=True)
SESSIONS["CLIENT"] = Session(ok=True, role="client", uid="USR_TEST_NOBODY")
# the live plane's token check, as live_events.authorized says it (starlette is not in this runner)
_le = types.ModuleType("live_events")
_le.authorized = lambda request: request.headers.get("x-hub-token") == "test-hub-token"
sys.modules["live_events"] = _le

ok = failed = 0


def check(label, cond, detail=""):
    global ok, failed
    if cond:
        ok += 1
        print("  ok  ", label)
    else:
        failed += 1
        print("  FAIL", label, str(detail)[:300])


def q(sql: str, args=()) -> list[dict]:
    return TEST.cursor(row_factory=dict_row).execute(sql, args).fetchall()


class Req:
    def __init__(self, token: str = "", body=None, headers=None) -> None:
        self.headers = {"authorization": f"Bearer {token}"} if token else {}
        self.headers.update(headers or {})
        self.query_params = {}
        self._body = body

    async def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


def call(path: str, method: str = "POST", token: str = "", body=None):
    fn = next(f for m, p, f in MG.ROUTES if p == path and m == method)
    try:
        return asyncio.run(fn(request=Req(token, body)))
    except Exception as exc:  # noqa: BLE001 - a door that raises is a FAIL, said
        return {"status": "raised", "message": f"{type(exc).__name__}: {exc}"[:200]}


# ---- the seed ----------------------------------------------------------------------------------------------------

KEPT = q("select cells, modified_time, read_at from pg_temp.sheet_grids where kind = 'master'")[0]
KEPT_MATRIX = CM._shown(KEPT["cells"])
COPY_TABLE, _loaded = CM._copy_table()
CM.ensure("asa-hub-db")
lanes_pg.finish()
held = q("select count(*) as n from pg_temp.cal_builder_master")[0]["n"]
check("the record is seeded with every cell the kept grid shows",
      held == sum(1 for line in KEPT_MATRIX for v in line if str(v).strip()), held)
check("and the Table with every row of the copy's", q("select count(*) as n from pg_temp.cal_builder_table")[0]["n"]
      == len(COPY_TABLE) > 0, len(COPY_TABLE))
COLS, ROWS = CBS._parse_grid(KEPT_MATRIX)
rec_matrix, _stamp = CM.matrix("asa-hub-db")
lanes_pg.finish()
check("the record parses into the kept grid's columns and rows", CBS._parse_grid(rec_matrix) == (COLS, ROWS))
BY_ROW = {r["sheetRow"]: r for r in ROWS}
# from here on no door may read the kept master grid: it is taken away until the sheet's side is folded in
TEST.execute("delete from pg_temp.sheet_grids where kind = 'master'")

PATHS = [p for _m, p, _f in MG.ROUTES]
check("the six master lanes are answered here", [p.rsplit("/", 1)[-1] for p in PATHS] ==
      ["grid", "cell", "apply-requests", "generate", "publish", "publish-houses"], PATHS)
for method, path, _fn in MG.ROUTES:
    body = {} if method == "POST" else None
    check(f"{method} {path} with no session: 401", call(path, method, "", body).get("status") == 401)
    check(f"{method} {path} as a client: 403", call(path, method, "CLIENT", body).get("status") == 403)

GRID, CELL, APPLY, GEN, PUBLISH, HOUSES = PATHS
env = call(GRID, "GET", "ADMIN")
data = env.get("data") or {}
check("the grid answers 200 off the record", env.get("status") == 200, env.get("message"))
check("its words are the relay's",
      sorted(data) == ["conflicts", "draft", "draftCount", "hours", "period", "rows", "test_mode"], sorted(data))
check("its rows are the record's", data.get("rows") == ROWS and (data.get("period") or {}).get("cols") == COLS)
check("test mode is said as it holds", data.get("test_mode") == {"on": True, "readable": True, "why": ""})

day = COLS[0]["iso"]
staff = [r for r in ROWS if r["rowType"] == "staff" and not CBS._skip_staff(r["employee"], r["house"])]
check("an invalid body is refused", call(CELL, "POST", "ADMIN", None).get("message") == "invalid body")
check("a sheet row that is no number is refused",
      call(CELL, "POST", "ADMIN", {"sheet_row": "x", "date_iso": day}).get("message") == "sheet_row must be a number")
check("a row the record lacks is 404",
      call(CELL, "POST", "ADMIN", {"sheet_row": 499, "date_iso": day, "value": "8A-4P"}).get("status") == 404)


def drafts() -> list[dict]:
    return q("select sheet_row, date_iso::text as date_iso, house, employee, value, base_value, updated_by"
             " from pg_temp.asa_cal_builder_draft order by 1, 2")


def text_of(sheet_row: int, iso: str) -> str:
    return next((c["text"] for c in BY_ROW[sheet_row]["cells"] if c["date"] == iso), "")


# ---- drafts, time off, the generator --------------------------------------------------------------------------

busy: dict[str, set[str]] = {}
for r in staff:
    for c in r["cells"]:
        got = shift_slices.classify(c["text"]) if c["text"] else None
        if got and got.get("start") is not None:
            busy.setdefault(CBW._fold(r["employee"]), set()).add(c["date"])


def free_cells():
    for r in staff:
        mine = busy.get(CBW._fold(r["employee"]), set())
        for c in r["cells"][2:]:
            d = date.fromisoformat(c["date"])
            if not c["text"].strip() and not ({(d + timedelta(days=k)).isoformat() for k in (-1, 0, 1)} & mine):
                yield r, c["date"]


DIRTY.clear()
placed = None
for row, blank in free_cells():
    env = call(CELL, "POST", "ADMIN", {"sheet_row": row["sheetRow"], "date_iso": blank, "value": "8A-4P"})
    if env.get("status") == 200:
        placed = (row, blank, env)
        break
check("a draft cell is kept on a free day", placed is not None)
row, blank, env = placed
check("its answer is the relay's", env.get("data") == {"sheetRow": row["sheetRow"], "date": blank, "value": "8A-4P"})
check("the draft names the record's house and person, its base the record's cell",
      [(d["sheet_row"], d["date_iso"], d["house"], d["employee"], d["base_value"], d["updated_by"]) for d in drafts()]
      == [(row["sheetRow"], blank, row["house"], row["employee"], "", UID)], drafts())
check("the slices that lay the draft are told", DIRTY == [["calendarConflicts", "calendarHours"]], DIRTY)
saved = list(drafts())
TEST.execute("delete from pg_temp.asa_cal_builder_draft")
env = call(APPLY, "POST", "ADMIN", {})
check("time off is staged (or refused whole when unreadable)", env.get("status") in (200, 503), env)
if env.get("status") == 200:
    check("its words are the relay's", sorted(env.get("data") or {}) == ["applied", "moved", "moves", "staged_ro"])
TEST.execute("delete from pg_temp.asa_cal_builder_draft")
env = call(GEN, "POST", "ADMIN", {})
check("the generator fills (or refuses whole when the live calendars are unreadable)",
      env.get("status") in (200, 503), env)
if env.get("status") == 200:
    staged = drafts()
    check("it stages only blank cells on person rows", (env.get("data") or {}).get("staged") == len(staged) and all(
        text_of(d["sheet_row"], d["date_iso"]) == "" and BY_ROW[d["sheet_row"]]["rowType"] == "staff"
        for d in staged), len(staged))
TEST.execute("delete from pg_temp.asa_cal_builder_draft")
call(CELL, "POST", "ADMIN", {"sheet_row": row["sheetRow"], "date_iso": blank, "value": "8A-4P"})

# ---- the publish -------------------------------------------------------------------------------------------------

env = call(PUBLISH, "POST", "ADMIN", {})
check("while test mode holds, the publish is refused and the draft kept",
      env.get("status") == 409 and env.get("reason") == "test_mode" and len(drafts()) == 1, env)
check("and nothing is written or queued", q("select count(*) as n from pg_temp.book_ops")[0]["n"] == 0)
SWITCH["on"] = False
DIRTY.clear()
log_before = q("select count(*) as n from pg_temp.asa_cal_builder_publish_log")[0]["n"]
table_before = q("select count(*) as n from pg_temp.cal_builder_table")[0]["n"]
env = None
for row, blank in free_cells():
    TEST.execute("delete from pg_temp.asa_cal_builder_draft")
    call(CELL, "POST", "ADMIN", {"sheet_row": row["sheetRow"], "date_iso": blank, "value": "8A-4P"})
    env = call(PUBLISH, "POST", "ADMIN", {})
    if env.get("status") == 200:
        break
SWITCH["on"] = True
check("with test mode off, the publish answers the relay's words",
      (env or {}).get("status") == 200 and sorted((env.get("data") or {})) == ["appended", "period", "written"]
      and env["data"]["written"] == 1 and env["data"]["period"] == COLS[0]["iso"], env)
col = next(c["index"] for c in COLS if c["iso"] == blank)
cell = q("select text, synced, updated_by from pg_temp.cal_builder_master where sheet_row = %s and col = %s",
         (row["sheetRow"], col))
check("the cell is written into the record, still owed to the sheet",
      cell == [{"text": "8A-4P", "synced": "", "updated_by": UID}], cell)
check("the draft is cleared and the log appended", drafts() == [] and
      q("select count(*) as n from pg_temp.asa_cal_builder_publish_log")[0]["n"] == log_before + 1)
new_rows = q("select id, cells, source, synced from pg_temp.cal_builder_table where source = 'publish' order by id")
check("the Table rows are kept in the record, owed to the sheet",
      len(new_rows) == env["data"]["appended"] > 0 and all(not r["synced"] for r in new_rows)
      and q("select count(*) as n from pg_temp.cal_builder_table")[0]["n"] == table_before + len(new_rows)
      and new_rows[0]["cells"]["Staff"] == row["employee"] and new_rows[0]["cells"]["House"] == row["house"],
      new_rows[:1])
ops = q("select op, sheet_id, tab_name, spec, state from pg_temp.book_ops order by id")
check("the sheet's copy is queued: the cell by its place, the Table's rows by their ids",
      [(o["op"], o["tab_name"], o["state"]) for o in ops] == [("grid_cells", "New Calendar", "pending"),
                                                             ("table_rows", "New Calendar Table", "pending")]
      and ops[0]["spec"] == {"cells": [[row["sheetRow"], col]]}
      and ops[1]["spec"] == {"ids": [r["id"] for r in new_rows]} and all(o["sheet_id"] == CM.MASTER_SHEET_ID for o in ops),
      ops)
check("every slice read off the record is told", DIRTY and DIRTY[-1] == list(MG.RECORD_SLICES), DIRTY)
grid = call(GRID, "GET", "ADMIN").get("data") or {}
shown = next(c["text"] for r in grid.get("rows") or [] if r["sheetRow"] == row["sheetRow"] for c in r["cells"]
             if c["date"] == blank)
check("the grid shows the publish at once, whatever the sheet holds", shown == "8A-4P" and grid.get("draftCount") == 0)
CBS.forget_grid()
g_rows, _s = CBS.build("calendarGrid", "asa-hub-db")
t_rows, _s = CBS.build("calendarShifts", "asa-hub-db")
lanes_pg.finish()
check("the slices read the record: the grid holds the cell, the shifts the Table rows just kept",
      any(r.get("sheetRow") == row["sheetRow"] and any(c["date"] == blank and c["text"] == "8A-4P" for c in r["cells"])
          for r in g_rows) and any(r.get("Timestamp") == new_rows[0]["cells"]["Timestamp"] for r in t_rows))

# ---- asa-hub-sheet-sync's side -------------------------------------------------------------------------------------


class FakeSheets:
    """sheet_sync.Sheets' surface the carriers use, over in-memory tabs."""

    def __init__(self, sid: str, tabs: dict[str, list[list[str]]]) -> None:
        self.sid, self.tabs = sid, {t: [list(r) for r in m] for t, m in tabs.items()}
        self.gids = {t: 100 + i for i, t in enumerate(self.tabs)}
        self.calls: list[str] = []

    def sheet_props(self, sid):
        self.calls.append("props")
        return {t: {"id": self.gids[t], "rows": len(m), "cols": 40} for t, m in self.tabs.items()}

    def batch_get(self, sid, ranges, render="FORMATTED_VALUE"):
        self.calls.append("get")
        out = []
        for rng in ranges:
            m = re.match(r"^'((?:[^']|'')+)'(?:!(.*))?$", rng)
            tab, part = m.group(1).replace("''", "'"), m.group(2) or ""
            rows = self.tabs[tab]
            if part == "A:A":
                n = max((i + 1 for i, r in enumerate(rows) if r and str(r[0]).strip()), default=0)
                got = [[r[0]] if r else [""] for r in rows[:n]]
            elif re.fullmatch(r"\d+:\d+", part):
                a, b = (int(x) for x in part.split(":"))
                got = rows[a - 1:b]
            elif part:
                a, b = part.split(":")
                r0, r1 = int(re.sub(r"[A-Z]", "", a)), int(re.sub(r"[A-Z]", "", b))
                got = rows[r0 - 1:r1]
            else:
                got = rows
            out.append([[str(v) for v in r] for r in got])
        return out

    def structure(self, sid, requests):
        self.calls.append("write")
        by_gid = {g: t for t, g in self.gids.items()}
        for req in requests:
            if "insertDimension" in req:
                rng = req["insertDimension"]["range"]
                for _ in range(rng["endIndex"] - rng["startIndex"]):
                    self.tabs[by_gid[rng["sheetId"]]].insert(rng["startIndex"], [])
            elif "updateCells" in req:
                u = req["updateCells"]
                rows = self.tabs[by_gid[u["start"]["sheetId"]]]
                for i, line in enumerate(u["rows"]):
                    r = u["start"]["rowIndex"] + i
                    while len(rows) <= r:
                        rows.append([])
                    for j, v in enumerate(line["values"]):
                        c = u["start"]["columnIndex"] + j
                        while len(rows[r]) <= c:
                            rows[r].append("")
                        rows[r][c] = (v.get("userEnteredValue") or {}).get("stringValue", "")


class Quota(Exception):
    pass


def quote(t: str) -> str:
    return "'" + t.replace("'", "''") + "'"


def carry(sheets, ro=None) -> int:
    return BO.run(TEST, sheets, quote, CM.col_letter, str, Quota, RuntimeError, ro=ro)


table_head = ["House", "Staff", "D", "Date", "Start", "End", "Timestamp", "Dur"]
master_book = FakeSheets(CM.MASTER_SHEET_ID, {
    "New Calendar": [list(line) for line in KEPT_MATRIX],
    "New Calendar Table": [table_head] + [[r.get(h, "") for h in table_head] for r in COPY_TABLE]})
carried = carry(master_book)
sheet_row = master_book.tabs["New Calendar"][row["sheetRow"] - 1]
check("the carrier writes the record's cell at its place on the sheet",
      carried == 2 and sheet_row[col] == "8A-4P", (carried, sheet_row[:6]))
tail = master_book.tabs["New Calendar Table"][-len(new_rows):]
check("and appends the record's Table rows after the tab's last row, exactly as kept",
      [r[:7] for r in tail] == [[r["cells"].get(h, "") for h in table_head[:7]] for r in new_rows]
      and all(r["synced"] for r in q("select synced from pg_temp.cal_builder_table where source = 'publish'")))
check("both ops are done", [o["state"] for o in q("select state from pg_temp.book_ops order by id")] == ["done", "done"])

# a row the sheet now names someone else by is never written
other = next(r for r in staff if r["sheetRow"] != row["sheetRow"])
ocol = COLS[3]["index"]
with lanes_pg.own_connect() as conn, conn.cursor() as cur:
    CM.put_cells(cur, [(other["sheetRow"], ocol, "7A-3P")], UID, "test")
lanes_pg.finish()
master_book.tabs["New Calendar"][other["sheetRow"] - 1][2] = "Someone Else"
before_cell = master_book.tabs["New Calendar"][other["sheetRow"] - 1][ocol]
carry(master_book)
last = q("select state, why from pg_temp.book_ops order by id desc limit 1")[0]
check("a cell whose row the sheet now names someone else by is refused, the sheet untouched",
      last["state"] == "refused" and "names someone else" in last["why"]
      and master_book.tabs["New Calendar"][other["sheetRow"] - 1][ocol] == before_cell, last)

# ---- the sheet's side: the keeper's grid folded in by recency ----------------------------------------------------


def keep_grid(matrix: list[list[str]], modified: datetime) -> None:
    TEST.execute("delete from pg_temp.sheet_grids where kind = 'master'")
    TEST.execute("insert into pg_temp.sheet_grids (sheet_id, tab_name, kind, cells, modified_time, read_at)"
                 " values (%s, 'New Calendar', 'master', %s::jsonb, %s, now())",
                 (CM.MASTER_SHEET_ID, json.dumps({"shown": matrix}), modified))


now = datetime.now(timezone.utc)
fold_grid = [list(line) + [""] * (CM.COLS - len(line)) for line in KEPT_MATRIX]
fold_grid[row["sheetRow"] - 1][col] = "8A-4P"   # the carried cell, as the keeper reads it back
third = next(r for r in staff if r["sheetRow"] not in (row["sheetRow"], other["sheetRow"]))
hand = next(c["index"] for c in COLS[4:] if not fold_grid[third["sheetRow"] - 1][c["index"]].strip())
fold_grid[third["sheetRow"] - 1][hand] = "9A-5P"  # a hand edit on the sheet
fold_grid[other["sheetRow"] - 1][2] = "Someone Else"  # the row the sheet renamed
keep_grid(fold_grid, now - timedelta(minutes=5))
DIRTY.clear()
out = MG._fold()
lanes_pg.finish()
rec = {(r["sheet_row"], r["col"]): r for r in q("select * from pg_temp.cal_builder_master")}
check("a cell the sheet changed and the record did not is copied in",
      rec[(third["sheetRow"], hand)]["text"] == "9A-5P" and rec[(third["sheetRow"], hand)]["updated_by"] == "sheet")
check("the carried cell is agreed: no longer owed",
      rec[(row["sheetRow"], col)]["synced"] == "8A-4P" == rec[(row["sheetRow"], col)]["text"])
check("a row the sheet renamed is the sheet's, its owed cell given up and logged",
      rec[(other["sheetRow"], 2)]["text"] == "Someone Else"
      and rec.get((other["sheetRow"], ocol), {}).get("text", "") == fold_grid[other["sheetRow"] - 1][ocol]
      and any("names someone else" in c["why"] for c in q("select why from pg_temp.edit_conflicts")))
check("the fold says it changed the record, and the slices are told",
      out.get("changed") and DIRTY == [list(MG.RECORD_SLICES)], (out, DIRTY))

# both changed: the record's newer edit wins and is queued again; then a newer sheet wins
both = next(c["index"] for c in COLS[5:] if c["index"] != hand)
with lanes_pg.own_connect() as conn, conn.cursor() as cur:
    CM.put_cells(cur, [(third["sheetRow"], both, "6A-2P")], UID, "test")
lanes_pg.finish()
TEST.execute("update pg_temp.book_ops set state = 'done' where state = 'pending'")
fold_grid[third["sheetRow"] - 1][both] = "SYNC-A"
keep_grid(fold_grid, now - timedelta(hours=1))
MG._fold()
lanes_pg.finish()
cellr = q("select text, synced from pg_temp.cal_builder_master where sheet_row = %s and col = %s",
          (third["sheetRow"], both))[0]
queued = q("select spec from pg_temp.book_ops where state = 'pending' and op = 'grid_cells'")
check("both changed, the record newer: the record's value stays, owed again over the sheet's",
      cellr == {"text": "6A-2P", "synced": "SYNC-A"}
      and any([third["sheetRow"], both] in o["spec"]["cells"] for o in queued), (cellr, queued))
fold_grid[third["sheetRow"] - 1][both] = "SYNC-B"
keep_grid(fold_grid, now + timedelta(hours=1))
MG._fold()
lanes_pg.finish()
cellr = q("select text, synced from pg_temp.cal_builder_master where sheet_row = %s and col = %s",
          (third["sheetRow"], both))[0]
check("both changed, the sheet newer: the sheet's value comes in", cellr == {"text": "SYNC-B", "synced": "SYNC-B"},
      cellr)
winners = [c["winner"] for c in q("select winner from pg_temp.edit_conflicts where row_key = %s order by id",
                                  (f"r{third['sheetRow']}",))]
check("each both-changed cell is logged with its winner", winners == ["postgres", "sheet"], winners)
TEST.execute("update pg_temp.book_ops set state = 'done' where state = 'pending'")
check("the keeper's door asks the service token",
      asyncio.run(MG.master_sync(Req(headers={}))).get("status") == 401
      and asyncio.run(MG.master_sync(Req(headers={"x-hub-token": "test-hub-token"}))).get("status") == 200)
lanes_pg.finish()

# ---- publish-houses and the house writer -----------------------------------------------------------------------

TEST.execute("delete from pg_temp.asa_cal_builder_draft")
env = call(HOUSES, "POST", "ADMIN", {"dry_run": True})
houses = (env.get("data") or {}).get("houses") or []
check("publish-houses' dry run answers the relay's words off the platform's houses",
      env.get("status") == 200 and sorted(env["data"]) == ["houses", "test_mode", "written"] and houses
      and all({"house", "tab", "written", "skipped", "status"} <= set(h) for h in houses), env.get("message"))
check("and writes nothing", q("select count(*) as n from pg_temp.asa_house_calendar_edits")[0]["n"] == 0
      and q("select count(*) as n from pg_temp.book_ops where op = 'house_cells'")[0]["n"] == 0)
env = call(HOUSES, "POST", "ADMIN", {})
check("a real push while test mode holds keeps nothing as published and queues no copy",
      env.get("status") == 200 and q("select count(*) as n from pg_temp.asa_house_calendar_edits where stage = 'published'")
      [0]["n"] == 0 and q("select count(*) as n from pg_temp.book_ops where op = 'house_cells'")[0]["n"] == 0,
      env.get("message"))

LOC = EMP = BLANK = None
for loc, g in MIRROR.execute("select location, grid from asa_house_calendar_live order by location").fetchall():
    g = g if isinstance(g, dict) else json.loads(g)
    isos = house_cal_live.col_isos(g)
    for r in g.get("rows") or []:
        emp = str(r.get("employee") or "")
        if not emp or house_cal_live.not_a_person(emp, loc):
            continue
        cells = r.get("cells") or []
        hit = next((isos[i] for i in range(len(isos))
                    if not str(((cells[i] if i < len(cells) else {}) or {}).get("text") or "").strip()), None)
        if hit:
            LOC, EMP, BLANK, GRID_H, ISOS = loc, emp, hit, g, isos
            break
    if LOC:
        break
SWITCH["on"] = False
wrote = CBH.publish_cells("asa-hub-db", LOC, [{"employee": EMP, "col_iso": BLANK, "value": "8A-4P", "base": ""}],
                          actor="Test Writer", via="test")
lanes_pg.finish()
SWITCH["on"] = True
edits = q("select id, at, stage, new_value from pg_temp.asa_house_calendar_edits where location = %s", (LOC,))
hops = q("select spec, state from pg_temp.book_ops where op = 'house_cells'")
check("the house writer keeps the publish as the house's record and queues its copy",
      wrote.get("written") == 1 and not wrote.get("test_mode") and [e["stage"] for e in edits] == ["published"]
      and len(hops) == 1 and hops[0]["spec"]["edit_ids"] == [edits[0]["id"]]
      and hops[0]["spec"]["cells"][0]["employee"] == EMP, (wrote, hops))
TEST.execute("update pg_temp.asa_house_calendar_edits set at = at - interval '1 day' where location = %s", (LOC,))
TEST.execute("update pg_temp.book_ops set at = at - interval '1 day' where op = 'house_cells'")


def laid_now() -> dict:
    with lanes_pg.own_connect() as conn, conn.cursor() as cur:
        got = house_cal_live.pending_publishes(cur, LOC).get(LOC, {})
    lanes_pg.finish()
    return got


laid = laid_now()
check("an old publish stays laid over the live copy while its copy is queued", laid.get((EMP, BLANK)) == "8A-4P", laid)
house_tab = [["", "STAFF"] + [f"{int(i[5:7])}/{int(i[8:10])}" for i in ISOS]]
for r in GRID_H.get("rows") or []:
    house_tab.append(["", str(r.get("sheet_name") or r.get("employee") or "")]
                     + [str((c or {}).get("text") or "") for c in (r.get("cells") or [])])
houses_book = FakeSheets(CBW.LIVE_HOUSES_SHEET_ID, {LOC: house_tab})


class RO:
    def __init__(self, at: float) -> None:
        self.at = at

    def execute(self, *_a):
        return self

    def fetchone(self):
        return (self.at,)


carry(houses_book, ro=lambda: RO(now.timestamp() - 86400 * 7))
layout = CBH.tab_layout(houses_book.tabs[LOC], ISOS)
ri, _why = CBH.resolve_row(layout, EMP)
check("the carrier writes the house cell by name and day",
      houses_book.tabs[LOC][ri][layout["col_by_iso"][BLANK]] == "8A-4P"
      and q("select state from pg_temp.book_ops where op = 'house_cells'")[0]["state"] == "done")
check("carried but not yet read back, it is still laid", laid_now().get((EMP, BLANK)) == "8A-4P")
# the live copy read the house again after the copy was carried
TEST.execute("update pg_temp.book_ops set done_at = done_at - interval '1 day' where op = 'house_cells'")
laid = laid_now()
check("once carried and read back, the live copy is the house's again", (EMP, BLANK) not in laid, laid)
# the sheet changed it since, and later: the sheet's value stands, logged
houses_book.tabs[LOC][ri][layout["col_by_iso"][BLANK]] = "OFF"
TEST.execute("insert into pg_temp.book_ops (write_id, action, subject, sheet_id, tab_name, op, spec)"
             " values ('Wtest', 'test', %s, %s, %s, 'house_cells', %s::jsonb)",
             (LOC, CBW.LIVE_HOUSES_SHEET_ID, LOC, json.dumps({"isos": ISOS, "edit_ids": [], "cells": [
                 {"employee": EMP, "col_iso": BLANK, "value": "9A-5P", "base": "8A-4P",
                  "at": (now - timedelta(hours=2)).isoformat()}]})))
carry(houses_book, ro=lambda: RO(now.timestamp()))
check("a house cell the sheet changed later is left to the sheet, logged",
      houses_book.tabs[LOC][ri][layout["col_by_iso"][BLANK]] == "OFF"
      and q("select winner from pg_temp.edit_conflicts where keyed_by = 'house'")[-1]["winner"] == "sheet")

check("Google was never asked", GOOGLE == [], GOOGLE)
check("the relay's clocks are told only the roster, the bell and the held mockup rows, never a message",
      all(set(t) - {"resources"} <= {"roster", "wake", "events", "forget", "held_roster"} for t in TOLD), TOLD[:3])
check("asa-hub-db's own tables are as they were", prod_counts() == BEFORE, (BEFORE, prod_counts()))
print(f"{ok} ok, {failed} failed")
