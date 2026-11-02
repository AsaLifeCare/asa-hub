"""The shift rehearsal in asa-hub-app (app/rehearsal_lanes.py, shift_rehearsal.py, rehearsal_sandbox.py,
shift_rehearsal_acts.py): its doors answer in the relay's own words, and every board, answer and reset runs in a sealed
worker over a sandbox schema of asa-hub-db that nothing it does can get out of.

From the repo root (the relay's doors are read here; the rest runs inside asa-hub-db-sync by the in-process runner):

    RUNNER=<scratchpad> python3 tools/test-shift-rehearsal-app.py

Inside, the doors are asked on stand-ins (the session, Requests' reader, the worker): no session, a switched session, a
session that is not the master's, and the master's. Then real sealed workers run, each its own process with the app's
modules written to disk, over two schemas of this run in asa-hub-db, both owned by a role that cannot write app.*: the
sandbox (empty, as db/shift_rehearsal.sql makes it) and a "real" estate holding a pool row and a canary, the house
calendars read live from the old platform read-only. A reset, a board and two rehearsed answers go through the real
doors; one more worker attacks every wall from inside. Around it all the real estate's every table is fingerprinted
and nothing may change in it. Both schemas are dropped at the end. Nothing is sent and no real row is written.
"""
import ast
import json
import os
import subprocess
import sys

if not os.environ.get("REHEARSAL_TEST_INPROC"):
    src = open("server/snapshot_service.py", encoding="utf-8").read()
    tree = ast.parse(src)
    wanted = {"_REHEARSAL_REFUSED", "_rehearsal_refusal", "_rehearsal_driver", "lane_shift_rehearsal",
              "lane_shift_rehearsal_answer", "lane_shift_rehearsal_reset"}
    parts = [ast.get_source_segment(src, n) for n in tree.body
             if getattr(n, "name", None) in wanted
             or (isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") in wanted)]
    runner = os.environ["RUNNER"]
    env = {"REHEARSAL_TEST_INPROC": "1", "RELAY_DOORS": "\n\n".join(parts),
           "FD_ROUTES": open("app/front_door_routes.json").read(), "IST": open("app/ist_config_defaults.json").read()}
    with open(os.path.join(runner, "rehearsal-env.json"), "w") as fh:
        json.dump(env, fh)
    with open(os.path.join(runner, "test_shift_rehearsal_app.py"), "w") as fh:
        fh.write(open(__file__).read())
    sys.exit(subprocess.call(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"),
                              os.path.join(runner, "test_shift_rehearsal_app.py"),
                              "@" + os.path.join(runner, "rehearsal-env.json")]))

import asyncio  # noqa: E402
import hashlib  # noqa: E402
import logging  # noqa: E402
import shutil  # noqa: E402
import tempfile  # noqa: E402
import types  # noqa: E402
from dataclasses import dataclass  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402
from pathlib import Path  # noqa: E402

import psycopg  # noqa: E402
import psycopg.conninfo  # noqa: E402

logging.disable(logging.CRITICAL)
out: dict = {}
fails: list = []


def check(name, cond, got=None):
    out[name] = "ok" if cond else {"FAILED": got}
    if not cond:
        fails.append(name)


async def _threadpool(fn, *a, **k):
    return fn(*a, **k)


_fa = types.ModuleType("fastapi")
_fa.FastAPI, _fa.Request = object, object
_fr = types.ModuleType("fastapi.responses")
_fr.JSONResponse = _fr.Response = object
_sc = types.ModuleType("starlette.concurrency")
_sc.run_in_threadpool = _threadpool
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": _sc})

WORK = tempfile.mkdtemp(prefix="rehearsal-test-")
APPDIR = os.path.join(WORK, "app")
os.makedirs(APPDIR)
for name, text in SRC.items():  # noqa: F821 - drv.py's sources: the worker imports them from disk
    with open(os.path.join(APPDIR, name + ".py"), "w", encoding="utf-8") as fh:
        fh.write(text)
with open(os.path.join(WORK, "routes.json"), "w") as fh:
    fh.write(os.environ["FD_ROUTES"])
OWNER = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
ROLE = "asa_hub_app_ro"
# the worker's database: asa-hub-db as a role that can write nothing of app.*, so a wall that failed writes no real row
WDSN = psycopg.conninfo.make_conninfo(OWNER, options=f"-c role={ROLE}")
N = os.getpid()
BOX, REAL = f"t_rehearsal_box_{N}", f"t_rehearsal_real_{N}"
ROOT = os.path.join(WORK, "box")
os.environ.update(HUB_FRONT_DOOR_ROUTES=os.path.join(WORK, "routes.json"),
                  HUB_IST_CONFIG_DECLARATION_JSON=os.environ["IST"], HUB_DB_WRITE_DSN=WDSN, HUB_DB_DSN=WDSN,
                  HUB_RELAY_RO_DSN=os.environ["MIRROR_DSN"], HUB_SHIFT_REHEARSAL_REAL_PATH=REAL,
                  HUB_SHIFT_REHEARSAL_SCHEMA=BOX, HUB_SHIFT_REHEARSAL_DIR=ROOT,
                  HUB_SNAPSHOT_OUT=os.path.join(WORK, "snapshot"))

ADMIN = psycopg.connect(OWNER, autocommit=True)


def fingerprint() -> dict[str, str]:
    """Every table of the real estate schema, row by row."""
    got = {}
    for (t,) in ADMIN.execute("select tablename from pg_tables where schemaname=%s order by 1", (REAL,)).fetchall():
        rows = ADMIN.execute(f'select t::text from "{REAL}"."{t}" t order by 1').fetchall()
        got[t] = hashlib.sha256("\n".join(r[0] for r in rows).encode()).hexdigest()
    return got


try:
    # ---- the doors, in the relay's own words -------------------------------------------------------------------
    import rehearsal_lanes as RL  # noqa: E402
    import sched_lanes as SL  # noqa: E402
    import shift_rehearsal as R  # noqa: E402

    def literals(text: str) -> set[str]:
        got = set()
        for n in ast.walk(ast.parse(text)):
            body = getattr(n, "body", None)
            if isinstance(body, list) and body and isinstance(body[0], ast.Expr) \
                    and isinstance(body[0].value, ast.Constant):
                body[0].value.value = None
            if isinstance(n, ast.Constant) and isinstance(n.value, str):
                got.add(n.value)
            if isinstance(n, ast.JoinedStr):
                got.add(ast.unparse(n))
        return got

    relay_words = literals(os.environ["RELAY_DOORS"])
    app_words = literals(SRC["rehearsal_lanes"])  # noqa: F821
    check("doors: every word the relay's rehearsal doors answer with is the app's", relay_words <= app_words,
          sorted(relay_words - app_words))

    @dataclass(frozen=True)
    class Session:
        ok: bool = True
        role: str = "admin"
        uid: str = "U1"
        is_master: bool = False
        acting: bool = False

    held: dict = {"session": None, "viewer": None}
    played: list = []

    async def viewer(request):
        return held["viewer"]

    async def session(request):
        return held["session"]

    SL._requests_viewer, SL._session = viewer, session

    class Req:
        def __init__(self, query=None, body=None):
            self.query_params = dict(query or {})
            self._body = body

        async def json(self):
            if isinstance(self._body, Exception):
                raise self._body
            return self._body

    def stand_in(kind):
        def fn(dsn, **kw):
            played.append((kind, kw))
            if kw.get("run") == "REFUSE":
                raise R.Refused("no such thing", "nope", extra=1)
            if kw.get("run") == "FAIL":
                raise R.Failed("the worker stopped")
            return {"at": datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc), "outcome": "done", "code": "x",
                    "cleared": 0}
        return fn

    real_board, real_answer, real_reset = R.board, R.answer, R.reset
    R.board, R.answer, R.reset = stand_in("board"), stand_in("answer"), stand_in("reset")

    async def doors():
        held["viewer"] = {"status": 401, "message": "sign in first"}
        check("doors: no session is Requests' own refusal",
              await RL.lane_shift_rehearsal(Req()) == {"status": 401, "message": "sign in first"})
        held["viewer"] = ({"name": "Pat Driver", "is_master": True}, ("admin", "U1"))
        held["session"] = Session(is_master=True, acting=True)
        got = await RL.lane_shift_rehearsal(Req())
        check("doors: a switched session is refused in the relay's words",
              got == {"status": 403, "reason": "acting",
                      "message": "the rehearsal is not driven while acting as another account — press "
                                 "Be Back to drive it as yourself"} and not played, got)
        held["session"] = Session(is_master=False)
        got = await RL.lane_shift_rehearsal_reset(Req())
        check("doors: a session that is not the master's is refused",
              got == {"status": 403, "reason": "master", "message": RL._REHEARSAL_REFUSED} and not played, got)
        held["session"] = Session(is_master=True)
        got = await RL.lane_shift_rehearsal(Req({"run": "R1", "at": ""}))
        check("doors: the master's board is played, its instants written as the relay writes them",
              got == {"status": 200, "data": {"at": "2026-10-25T12:00:00+00:00", "outcome": "done", "code": "x",
                                              "cleared": 0}}
              and played[-1] == ("board", {"who": held["viewer"][0], "run": "R1", "at": ""}), (got, played))
        got = await RL.lane_shift_rehearsal(Req({"run": "REFUSE"}))
        check("doors: a refusal is a 409 with its reason", got == {"status": 409, "reason": "nope",
                                                                   "message": "no such thing"}, got)
        got = await RL.lane_shift_rehearsal(Req({"run": "FAIL"}))
        check("doors: a failed worker is a 502 in the relay's words",
              got == {"status": 502, "message": "the rehearsal could not be read: the worker stopped"}, got)
        got = await RL.lane_shift_rehearsal_answer(Req(body=ValueError("x")))
        check("doors: an unreadable body is a 400", got == {"status": 400, "message": "invalid body"}, got)
        got = await RL.lane_shift_rehearsal_answer(Req(body={"act": "apply", "door": "", "person": " Ana ",
                                                            "run": "REFUSE"}))
        check("doors: an answer's refusal carries its data", got == {"status": 409, "reason": "nope",
                                                                     "message": "no such thing", "data": {"extra": 1}},
              got)
        kw = played[-1][1]
        check("doors: the answer is handed the relay's fields, trimmed, the driver from the reader",
              kw["driver"] == "Pat Driver" and kw["door"] == "app" and kw["person"] == "Ana" and kw["word"] == "yes"
              and kw["who"] == held["viewer"][0], kw)
        got = await RL.lane_shift_rehearsal_reset(Req())
        check("doors: the master's reset is played", got.get("status") == 200
              and played[-1] == ("reset", {"by": "Pat Driver"}), (got, played[-1]))

    asyncio.run(doors())
    R.board, R.answer, R.reset = real_board, real_answer, real_reset
    check("doors: three routes installed, the relay's paths",
          [(m, p) for m, p, _f in RL.ROUTES] == [("GET", "/hub-lanes/shift-rehearsal"),
                                                 ("POST", "/hub-lanes/shift-rehearsal/answer"),
                                                 ("POST", "/hub-lanes/shift-rehearsal/reset")])

    # ---- the sandbox, for real ---------------------------------------------------------------------------------
    ADMIN.execute(f'create schema "{BOX}" authorization {ROLE}')
    ADMIN.execute(f'create schema "{REAL}" authorization {ROLE}')
    est = psycopg.connect(WDSN, autocommit=True)
    est.execute(f'set search_path = "{REAL}"')
    import shift_requests as SR  # noqa: E402

    est.execute(SR.POOL_DDL)
    est.execute(SR.POOL_REF_DDL)
    day = (datetime.now(timezone.utc) + timedelta(days=5)).date().isoformat()
    est.execute("insert into asa_shift_pool (location, open_row, col_iso, kind, value) "
                "values ('Rehearsal Test House', 'OPEN', %s, 'open_shift', '7a-3p')", (day,))
    est.execute("create table canary (n int primary key)")
    est.execute("insert into canary values (1)")
    est.close()
    ADMIN.execute(f'create function "{REAL}".sneaky() returns int language sql as '
                  f'$$ insert into "{REAL}".canary values (9) returning 1 $$')
    before = fingerprint()
    R.HERE = Path(APPDIR)

    got = R.reset("asa-hub-db", by="Rehearsal Tester", schema=BOX, root=Path(ROOT))
    made = {t for (t,) in ADMIN.execute("select tablename from pg_tables where schemaname=%s", (BOX,)).fetchall()}
    import rehearsal_sandbox as box  # noqa: E402 - its names only; it is sealed in the workers alone

    check("reset: a worker made every lane's table inside the sandbox and copied the real estate's pool row",
          set(box.MUST_SHADOW) <= made and (got.get("sandbox") or {}).get("counts", {}).get("asa_shift_pool") == 1
          and got.get("cleared") == 0 and (got.get("sandbox") or {}).get("schema") == BOX,
          (got, sorted(set(box.MUST_SHADOW) - made)))
    board = R.board("asa-hub-db", who={"name": "Rehearsal Tester"}, schema=BOX, root=Path(ROOT))
    sandbox = board.get("sandbox") or {}
    check("board: read from the sandbox as the role the worker is, the live houses beside it",
          sandbox.get("schema") == BOX and (sandbox.get("role") or {}).get("name") == ROLE
          and len(board.get("houses") or []) > 0 and board.get("made") == [] and isinstance(board.get("owed"), list)
          and board.get("may") is True and board.get("driver") == "Rehearsal Tester",
          {k: board.get(k) for k in ("sandbox", "made", "not_houses", "stopped")})
    # urllib3 probes for IPv6 at import by binding ::1 (and takes no for an answer): the one reach the wall stops
    probe = "socket.bind — the sandbox reaches no host and starts no process"
    check("board and reset: the lanes' own work reached for nothing outside the sandbox",
          not [s for s in (board.get("stopped") or []) + (got.get("stopped") or []) if s != probe],
          (board.get("stopped"), got.get("stopped")))
    row = R.answer("asa-hub-db", driver="Rehearsal Tester", door="app", act="withdraw", request_id="RNOPE",
                   schema=BOX, root=Path(ROOT))
    check("answer: played through the withdrawal door, refused in its words, written on the sandbox's ledger",
          row.get("outcome") == "refused" and row.get("code") == "no_such_application"
          and row.get("why") == "that application is not on file"
          and ADMIN.execute(f'select count(*) from "{BOX}".asa_shift_rehearsal').fetchone()[0] == 1, row)
    row = R.answer("asa-hub-db", driver="Rehearsal Tester", door="text", act="withdraw", request_id="RNOPE",
                   schema=BOX, root=Path(ROOT))
    check("answer: there is no withdrawal by text", row.get("code") == "no_such_door", row)
    try:
        R.answer("asa-hub-db", driver="x", door="fax", act="apply", schema=BOX, root=Path(ROOT))
        check("answer: an unknown door is refused before any worker", False)
    except R.Refused as exc:
        check("answer: an unknown door is refused before any worker", exc.code == "no_door", exc.code)
    board = R.board("asa-hub-db", who={"name": "Rehearsal Tester"}, schema=BOX, root=Path(ROOT))
    check("board: what was played is listed, newest first", [m.get("code") for m in board.get("made") or []]
          == ["no_such_door", "no_such_application"], board.get("made"))

    # ---- the walls, attacked from inside a sealed worker -------------------------------------------------------
    ATTACK = f"""
import json, os, socket, subprocess, sys, urllib.request
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0, {APPDIR!r})
import rehearsal_sandbox as box
req = json.loads(sys.stdin.read())
box.seal(schema=req["schema"], dsn=req["dsn"], root=Path(req["root"]))
import hubdb, lanes_db, psycopg
res = {{}}
def attempt(name, fn):
    try:
        fn(); res[name] = "done"
    except box.SandboxBreach:
        res[name] = "breach"
    except PermissionError:
        res[name] = "permission"
    except Exception as exc:
        res[name] = type(exc).__name__ + ": " + str(exc)[:160]
def lane(sql, autocommit=False):
    def go():
        c = lanes_db.connect("asa-hub-db")
        c.autocommit = autocommit
        with c.cursor() as cur:
            cur.execute(sql)
        c.commit(); c.close()
    return go
attempt("legit", lane("CREATE TABLE IF NOT EXISTS wall_probe (n int primary key)"))
attempt("legit_write", lane("INSERT INTO wall_probe VALUES (1) ON CONFLICT DO NOTHING"))
attempt("qualified_real", lane('INSERT INTO "{REAL}".canary VALUES (2)'))
attempt("unqualified_real", lane("INSERT INTO canary VALUES (3)"))
attempt("app_table", lane("UPDATE app.asa_sms_replies SET word='x' WHERE false"))
attempt("autocommit_real", lane('DELETE FROM "{REAL}".canary', autocommit=True))
attempt("hidden_write", lane('SELECT "{REAL}".sneaky()'))
attempt("hidden_write_autocommit", lane('SELECT "{REAL}".sneaky()', autocommit=True))
attempt("path_moved", lane("SET search_path TO public"))
attempt("set_config", lane("SELECT set_config('search_path', 'public', false)"))
attempt("make_schema", lane("CREATE SCHEMA evil"))
attempt("two_statements", lane("SELECT 1; INSERT INTO canary VALUES (4)"))
attempt("drop", lane('DROP TABLE "{REAL}".canary'))
attempt("truncate", lane('TRUNCATE "{REAL}".canary'))
attempt("sequence_by_value", lane("SELECT nextval(%s)" % "(select 'x')"))
attempt("hubdb_write", lambda: hubdb.shared().conn().execute('INSERT INTO "{REAL}".canary VALUES (5)'))
def raw_own():
    c = psycopg.connect(req["dsn"])
    s = c.execute("select current_schema()").fetchone()[0]
    c.close()
    if s != req["schema"]:
        raise RuntimeError(s)
attempt("raw_connect_opens_on_sandbox", raw_own)
attempt("raw_connect_elsewhere", lambda: psycopg.connect("host=127.0.0.1 dbname=postgres user=nobody"))
attempt("psycopg_transaction", lambda: psycopg.connect(req["dsn"]).transaction())
attempt("file_outside", lambda: open({os.path.join(WORK, "escape.txt")!r}, "w"))
attempt("file_inside", lambda: open(os.path.join(req["root"], "tmp", "ok.txt"), "w").close())
attempt("socket", lambda: socket.create_connection(("1.1.1.1", 80), timeout=2))
attempt("dns", lambda: socket.getaddrinfo("example.com", 80))
attempt("child", lambda: subprocess.run(["true"]))
attempt("http", lambda: urllib.request.urlopen("http://asa-hub-snapshot:8080/health", timeout=2))
print("RESULT " + json.dumps({{"res": res, "stopped": box.stopped()}}))
"""
    proc = subprocess.run([sys.executable, "-B", "-c", ATTACK], capture_output=True, text=True, timeout=120,
                          input=json.dumps({"schema": BOX, "dsn": WDSN, "root": ROOT}), cwd=APPDIR)
    line = next((ln for ln in reversed(proc.stdout.splitlines()) if ln.startswith("RESULT ")), "")
    walls = json.loads(line[7:])["res"] if line else {"crashed": proc.stderr[-1500:]}
    expect = {"legit": "done", "legit_write": "done", "qualified_real": "breach", "unqualified_real": "breach",
              "app_table": "breach", "autocommit_real": "breach", "hidden_write": "breach",
              "hidden_write_autocommit": "breach", "path_moved": "breach", "set_config": "breach",
              "make_schema": "breach", "two_statements": "breach", "drop": "breach", "truncate": "breach",
              "sequence_by_value": "breach", "hubdb_write": "breach", "raw_connect_opens_on_sandbox": "done",
              "raw_connect_elsewhere": "breach", "psycopg_transaction": "breach", "file_outside": "permission",
              "file_inside": "done", "socket": "permission", "dns": "permission", "child": "permission",
              "http": "permission"}
    wrong = {k: (walls.get(k), v) for k, v in expect.items() if walls.get(k) != v}
    check("walls: every attack from inside a sealed worker stopped, every write inside the sandbox let through",
          not wrong, wrong or walls)
    check("walls: the sandbox kept its own write", ADMIN.execute(f'select count(*) from "{BOX}".wall_probe')
          .fetchone()[0] == 1)
    check("walls: no file was written outside the sandbox directory", not os.path.exists(os.path.join(WORK,
                                                                                                    "escape.txt")))
    check("the criterion: not one byte of the real estate changed", fingerprint() == before)
except Exception:  # noqa: BLE001
    import traceback
    out["crashed"] = traceback.format_exc()[-2500:]
    fails.append("crashed")
finally:
    for s in (BOX, REAL):
        try:
            ADMIN.execute(f'drop schema if exists "{s}" cascade')
        except Exception as exc:  # noqa: BLE001
            out[f"dropped {s}"] = str(exc)[:200]
    shutil.rmtree(WORK, ignore_errors=True)
print(json.dumps({"checks": len(out), "failed": fails, "out": out}, indent=1, default=str))
