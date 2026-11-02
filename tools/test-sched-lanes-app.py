"""asa-hub-app's scheduling lanes (app/sched_lanes.py) run in-process with the translated relay modules, asa-hub-db's
sheets and the old platform's house calendars read live, and every write on stand-ins of this session alone: the relay's
own tables are pg_temp copies (db/relay_tables.sql) on one connection whose role cannot write app.*, test mode holds
every roster write, and the session verdict, Time Off's door to the app, the relay's /lanes/told and the mockup keeper
are stood in for. Each moved route is asked once with no session (its refusal) and once as a signed-in admin.

Run inside asa-hub-db-sync by the in-process runner (run.sh, which loads the test from beside its drv.py):

    cp tools/test-sched-lanes-app.py "$RUNNER/test_sched_lanes_app.py"
    E=$(python3 -c 'import json;print(json.dumps({"IST":open("app/ist_config_defaults.json").read(),
        "RELAY_SQL":open("db/relay_tables.sql").read()}))')
    sh "$RUNNER/run.sh" "$PWD/app" "$RUNNER/test_sched_lanes_app.py" "$E"
"""
import logging

logging.disable(logging.CRITICAL)
import asyncio  # noqa: E402
import inspect  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import sys  # noqa: E402
import types  # noqa: E402
from dataclasses import dataclass  # noqa: E402

import psycopg  # noqa: E402

_fa = types.ModuleType("fastapi")
_fa.Request = object
_fr = types.ModuleType("fastapi.responses")
_fr.Response = object
sys.modules["fastapi"], sys.modules["fastapi.responses"] = _fa, _fr

OWNER = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
os.environ["HUB_DB_DSN"] = OWNER
os.environ["HUB_IST_CONFIG_DECLARATION_JSON"] = os.environ["IST"]
os.environ["HUB_SERVICE_SECRET"] = "lanes-test-secret"


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

# the relay's own tables as this session's pg_temp copies, on a connection that cannot write app.*
TEST = psycopg.connect(OWNER, autocommit=True)
TEST.execute("set role asa_hub_app_ro")
TEST.execute("set search_path = pg_temp, app, public")
sql = re.sub(r"--[^\n]*", "", os.environ["RELAY_SQL"])
for stmt in [s.strip() for s in sql.split(";") if s.strip()]:
    low = stmt.lower()
    if not low.startswith(("create table", "create index", "create unique index")):
        continue
    stmt = stmt.replace("app.", "")
    stmt = re.sub(r"(?i)^create table if not exists", "create temp table", stmt)
    TEST.execute(stmt)
TEST.execute("set search_path = app, public")

import lanes_pg  # noqa: E402

# every unqualified table the lanes name, and every table they make, is this session's own
lanes_pg.SCHEMA = "pg_temp"
lanes_pg.CONNECT["own"] = lanes_pg.CONNECT["spare"] = lambda: TEST
MIRROR = psycopg.connect(os.environ["MIRROR_DSN"], autocommit=True)
MIRROR.execute("set session characteristics as transaction read only")
lanes_pg.CONNECT["intel"] = lambda: MIRROR
_close = lanes_pg._close
lanes_pg._close = lambda c: None if c is TEST else _close(c)

import live_notify  # noqa: E402

TOLD: list[dict] = []
live_notify.tell = lambda resources=(), **said: TOLD.append({"resources": list(resources), **said})
live_notify.tell_now = lambda **said: (TOLD.append(said), {"status": 200, "held_kept": True})[1]

import sched_lanes as SL  # noqa: E402
import effective_roster  # noqa: E402
import time_off  # noqa: E402
import lanes_sheets  # noqa: E402

KEPT: list[tuple[str, dict]] = []


def keeper(door: str, payload: dict) -> dict:
    KEPT.append((door, payload))
    return {"status": 200, "data": {"kept": True}}


SL.wire(types.SimpleNamespace())
effective_roster.use_switch(lambda: {"on": True, "readable": True, "word": "on", "why": ""})
time_off.KEEPER[0] = keeper
time_off.kept = lambda *, fresh=False: True
time_off._kept_rows = lambda: ([], [{"key": "directors", "value": "Nobody Listed", "_row_number": 2},
                                    {"key": "form_sync", "value": "off", "_row_number": 3}])

# a real admin account and a real house with a person and a blank day on it, read live
users = lanes_sheets.data(SL.HUB_DB_SHEET_ID, "users")
admin = next(u for u in users if str(u.get("role") or "").lower() == "admin"
             and str(u.get("active") or "").upper() != "FALSE" and not str(u.get("merged_into") or "").strip())
SESSIONS["ADMIN"] = Session(ok=True, role="admin", uid=str(admin["user_id"]), is_master=True)
pick = None
for loc, grid in MIRROR.execute("select location, grid from asa_house_calendar_live order by location").fetchall():
    g = grid if isinstance(grid, dict) else json.loads(grid)
    isos = [str(c.get("iso") or c.get("date") or "") for c in g.get("cols") or []]
    for row in g.get("rows") or []:
        emp = str(row.get("employee") or "")
        if not emp or SL.house_cal_live.not_a_person(emp, loc):
            continue
        cells = row.get("cells") or []
        blank = next((isos[i] for i in range(len(isos))
                      if not str(((cells[i] if i < len(cells) else {}) or {}).get("text") or "").strip()), None)
        if blank:
            pick = (loc, emp, blank)
            break
    if pick:
        break
LOC, EMP, BLANK = pick
# the People slice the relay builds, stood in for with the one person the test places
PEOPLE = "/tmp/sched-lanes-people.json"
with open(PEOPLE, "w", encoding="utf-8") as fh:
    json.dump({"rows": [{"name": EMP, "phone": "(330) 555-0100", "email": "x@example.com"},
                        {"name": "Nobody Listed", "phone": "(330) 555-0101", "email": "y@example.com"}]}, fh)
time_off.PEOPLE_PATH = PEOPLE
SL.PEOPLE_PATH = __import__("pathlib").Path(PEOPLE)


class Req:
    def __init__(self, token: str = "", query: dict | None = None, body=None) -> None:
        self.headers = {"authorization": f"Bearer {token}"} if token else {}
        self.query_params = dict(query or {})
        self._body = body

    async def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


class Resp:
    def __init__(self) -> None:
        self.headers: dict[str, str] = {}


def call(path: str, method: str, token: str = "", query=None, body=None, **path_args):
    fn = next(f for m, p, f in SL.ROUTES if p == path and m == method)
    kwargs = dict(path_args)
    if "response" in inspect.signature(fn).parameters:
        kwargs["response"] = Resp()
    try:
        return asyncio.run(fn(request=Req(token, query, body), **kwargs))
    except Exception as exc:  # noqa: BLE001 - a door that raises is a FAIL, said
        return {"status": "raised", "message": f"{type(exc).__name__}: {exc}"[:200]}


results: list[tuple[str, str, bool, str]] = []


def check(name: str, env: dict, ok_statuses: tuple, kind: str) -> dict:
    st = env.get("status") if isinstance(env, dict) else None
    results.append((kind, name, st in ok_statuses,
                    f"{st} {str(env.get('message') or env.get('reason') or '')[:110]}"))
    return env


for method, path, _fn in SL.ROUTES:
    args = {"ref": "SP0000000000"} if "{ref}" in path else {"location": LOC} if "{location}" in path else {}
    check(f"{method} {path}", call(path, method, body={} if method == "POST" else None, **args), (401,), "refusal")

A, ok, data_or = "ADMIN", (200,), (200, 404, 409)
check("GET housecal", call("/hub-lanes/housecal", "GET", A), ok, "happy")
check("GET houses/mine", call("/hub-lanes/houses/mine", "GET", A), (400,), "happy")
open_env = check("GET housecal/open", call("/hub-lanes/housecal/open", "GET", A), ok, "happy")
shifts = (open_env.get("data") or {}).get("shifts") or []
ref = next((s.get("ref") for s in shifts if s.get("ref")), "SP0000000000")
check("GET housecal/ref", call("/hub-lanes/housecal/ref/{ref}", "GET", A, ref=ref), data_or, "happy")
check("GET housecal/{location}", call("/hub-lanes/housecal/{location}", "GET", A, location=LOC), ok, "happy")
check("POST housecal/cell", call("/hub-lanes/housecal/cell", "POST", A, body={"location": LOC}), (410,), "happy")
check("POST housecal/move", call("/hub-lanes/housecal/move", "POST", A, body={"location": LOC}), (410,), "happy")
check("POST housecal/claim", call("/hub-lanes/housecal/claim", "POST", A,
                                  body={"location": LOC, "col_iso": BLANK, "claimed_by": EMP}),
      data_or + (400,), "happy")
check("POST housecal/claim/release", call("/hub-lanes/housecal/claim/release", "POST", A,
                                          body={"location": LOC, "col_iso": BLANK}), ok, "happy")
check("GET shift-handoff", call("/hub-lanes/shift-handoff", "GET", A, query={"location": LOC}), ok, "happy")
check("GET shift-handoff/swaps", call("/hub-lanes/shift-handoff/swaps", "GET", A), ok, "happy")
check("GET shift-handoff/candidates", call("/hub-lanes/shift-handoff/candidates", "GET", A,
                                           query={"location": LOC, "col_iso": BLANK, "from_staff": EMP}),
      data_or + (400, 403), "happy")
check("POST shift-handoff", call("/hub-lanes/shift-handoff", "POST", A,
                                 body={"location": LOC, "col_iso": BLANK, "to_staff": EMP, "from_staff": EMP}),
      data_or + (400, 403), "happy")
check("POST shift-handoff/answer", call("/hub-lanes/shift-handoff/answer", "POST", A,
                                        body={"handoff_id": "H-none", "word": "yes"}), (404,), "happy")
check("POST shift-handoff/withdraw", call("/hub-lanes/shift-handoff/withdraw", "POST", A,
                                          body={"handoff_id": "H-none"}), (404,), "happy")
check("GET shift-requests", call("/hub-lanes/shift-requests", "GET", A), ok, "happy")
check("GET shift-requests/detail", call("/hub-lanes/shift-requests/detail", "GET", A, query={"ref": ref}),
      data_or + (400, 403), "happy")
check("POST shift-requests/apply", call("/hub-lanes/shift-requests/apply", "POST", A,
                                        body={"location": LOC, "col_iso": BLANK, "person": EMP}), data_or, "happy")
check("POST shift-requests/withdraw", call("/hub-lanes/shift-requests/withdraw", "POST", A,
                                           body={"request_id": "R-none"}), (409, 502), "happy")
check("POST shift-requests/decide", call("/hub-lanes/shift-requests/decide", "POST", A,
                                         body={"location": LOC, "col_iso": BLANK, "person": EMP}), data_or, "happy")
check("POST shift-requests/training", call("/hub-lanes/shift-requests/training", "POST", A,
                                           body={"request_id": "R-none"}), (404,), "happy")
check("GET calendar-builder/houses", call("/hub-lanes/calendar-builder/houses", "GET", A), ok, "happy")
check("GET calendar-builder/house", call("/hub-lanes/calendar-builder/house", "GET", A, query={"location": LOC}),
      ok, "happy")
check("GET calendar-builder/staff", call("/hub-lanes/calendar-builder/staff", "GET", A), ok, "happy")
check("GET calendar-builder/house-history", call("/hub-lanes/calendar-builder/house-history", "GET", A,
                                                 query={"location": LOC, "employee": EMP, "col_iso": BLANK}),
      ok, "happy")
draft = {"location": LOC, "employee": EMP, "col_iso": BLANK, "value": "8A-4P"}
check("POST calendar-builder/house/cell", call("/hub-lanes/calendar-builder/house/cell", "POST", A, body=draft),
      ok, "happy")
check("POST calendar-builder/house/undo", call("/hub-lanes/calendar-builder/house/undo", "POST", A,
                                               body={"location": LOC}), ok, "happy")
call("/hub-lanes/calendar-builder/house/cell", "POST", A, body=draft)
check("POST calendar-builder/house/move", call("/hub-lanes/calendar-builder/house/move", "POST", A,
                                               body={"location": LOC, "from": {"employee": EMP, "col_iso": BLANK},
                                                     "to": {"employee": "OPEN", "col_iso": BLANK}}),
      data_or + (400,), "happy")
check("POST calendar-builder/house/request-off", call("/hub-lanes/calendar-builder/house/request-off", "POST", A,
                                                      body={"location": LOC, "employee": EMP, "col_iso": BLANK}),
      data_or + (400,), "happy")
check("POST calendar-builder/house/call-off", call("/hub-lanes/calendar-builder/house/call-off", "POST", A,
                                                   body={"location": LOC, "employee": EMP, "col_iso": BLANK}),
      data_or + (400,), "happy")
check("POST calendar-builder/house/discard", call("/hub-lanes/calendar-builder/house/discard", "POST", A,
                                                  body={"location": LOC}), ok, "happy")
call("/hub-lanes/calendar-builder/house/cell", "POST", A, body=draft)
check("POST calendar-builder/house/publish", call("/hub-lanes/calendar-builder/house/publish", "POST", A,
                                                  body={"location": LOC}), data_or, "happy")
check("POST calendar-builder/house/held/publish", call("/hub-lanes/calendar-builder/house/held/publish", "POST",
                                                       A, body={"location": LOC}), (409,), "happy")
check("POST calendar-builder/house/held/discard", call("/hub-lanes/calendar-builder/house/held/discard", "POST",
                                                       A, body={"location": LOC}), ok, "happy")
check("GET time-off", call("/hub-lanes/time-off", "GET", A), ok, "happy")
check("GET time-off/detail", call("/hub-lanes/time-off/detail", "GET", A, query={"ref": "TO0000000000"}),
      (404,), "happy")
FUT = (__import__("datetime").date.today() + __import__("datetime").timedelta(days=40)).isoformat()
asked = {"person": EMP, "start": FUT, "end": FUT, "reason": "test"}
check("POST time-off/request dry_run", call("/hub-lanes/time-off/request", "POST", A, body={**asked, "dry_run": True}),
      (200, 400, 409), "happy")
check("POST time-off/request", call("/hub-lanes/time-off/request", "POST", A, body=asked), (200, 400, 409), "happy")
for door in ("decide", "withdraw", "cancel", "review"):
    check(f"POST time-off/{door}", call(f"/hub-lanes/time-off/{door}", "POST", A,
                                        body={"ref": "TO0000000000", "word": "approve"}), (404, 400), "happy")
check("GET time-off/settings", call("/hub-lanes/time-off/settings", "GET", A), ok, "happy")
check("POST time-off/settings", call("/hub-lanes/time-off/settings", "POST", A, body={"directors": "Nobody Listed"}),
      (200, 400, 409), "happy")
check("POST time-off/discard-test", call("/hub-lanes/time-off/discard-test", "POST", A, body={}), ok, "happy")
check("POST time-off/away", call("/hub-lanes/time-off/away", "POST",
                                 body={"service_secret": "lanes-test-secret", "from": BLANK, "to": BLANK}),
      ok, "happy")

wrote = {t: TEST.execute(f"select count(*) from pg_temp.{t}").fetchone()[0]
         for t in ("asa_cal_builder_house_draft", "asa_house_calendar_edits", "asa_shift_pool", "asa_shift_requests",
                   "asa_shift_handoffs", "asa_calendar_calloff_road", "asa_house_calendar_claims")}
for kind, name, good, said in results:
    print(("ok  " if good else "FAIL"), kind.ljust(8), name.ljust(48), said)
print("house", LOC, "| person", EMP, "| day", BLANK)
print("temp rows written:", wrote)
print("told the relay:", sorted({k for t in TOLD for k in t if t.get(k)}), "| kept by the app's door:",
      sorted({d for d, _ in KEPT}))
bad = [r for r in results if not r[2]]
print(f"{len(results) - len(bad)}/{len(results)} ok")
