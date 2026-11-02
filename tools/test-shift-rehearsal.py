#!/usr/bin/env python3
"""
THE REHEARSAL OF STAFF ANSWERS — asserted against the real doors, and against the one criterion it
ships on: NOTHING IT DOES CAN TOUCH A REAL ROW, A REAL FILE, A REAL PERSON OR A HOST.

WHAT IT PROVES.

  THE WALL. Every rehearsal call runs in a worker process sealed before any lane loads: its
  connections open on a schema of their own, a statement naming a table outside it is refused, a
  commit that wrote one is rolled back, and an audit hook refuses writes outside the sandbox
  directory, every socket and every child process. The lane half attacks each of those from inside
  a sealed worker and asserts the attack was stopped and left nothing behind.

  THE CRITERION, measured rather than argued. The lane half keeps a "real" estate in a schema of
  its own, and around EVERY rehearsal call it fingerprints every table of that estate and every
  file in the real inbox and mockup directories. A single changed byte is a failure.

  THE READERS THE REVIEW NAMED. The swap asks (after the dial reads send), the ear's
  acknowledgements, the pool's notices, the shift flow's inbox reader, the effective roster, a real
  decision, a real offer on the same cell and a real house publish are each asked directly, on the
  real estate, after the rehearsal has played.

  THE DOORS ARE THE REAL ONES, and the rules are the lane's: windows, overlap, a caller's own call
  off, a house's regulars, the rehearsed clock, a swap that now completes — inside the sandbox.

HOW IT RUNS. The pure half needs nothing. The lane half ships the checkout's modules into the
relay's container and runs there with a real estate and a sandbox that are BOTH schemas of this run
(tests own their schema), every table created before anything reads it.

    python3 tools/test-shift-rehearsal.py
"""
import ast
import base64
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import time
import types
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
            print(f"       {str(detail)[:1500]}")


FAKE_PSYCOPG2 = textwrap.dedent('''
    import sys, types
    if "psycopg2" not in sys.modules:
        fake = types.ModuleType("psycopg2")
        fake.connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no database here"))
        fake.Error = Exception
        extras = types.ModuleType("psycopg2.extras")
        extras.RealDictCursor = object
        extras.Json = lambda v: v
        errors = types.ModuleType("psycopg2.errors")
        errors.UniqueViolation = type("UniqueViolation", (Exception,), {})
        extensions = types.ModuleType("psycopg2.extensions")
        extensions.connection = type("connection", (), {})
        extensions.cursor = type("cursor", (), {})
        extensions.parse_dsn = lambda d: {}
        extensions.make_dsn = lambda d, **k: d
        sqlmod = types.ModuleType("psycopg2.sql")
        sqlmod.Composable = type("Composable", (), {})
        sqlmod.SQL = type("SQL", (sqlmod.Composable,), {})
        sqlmod.Identifier = type("Identifier", (sqlmod.Composable,), {})
        fake.extras, fake.errors, fake.extensions, fake.sql = extras, errors, extensions, sqlmod
        for k, v in (("psycopg2", fake), ("psycopg2.extras", extras), ("psycopg2.errors", errors),
                     ("psycopg2.extensions", extensions), ("psycopg2.sql", sqlmod)):
            sys.modules[k] = v
''')
exec(FAKE_PSYCOPG2)  # noqa: S102 — the pure half's stand-in for a database it never opens

sys.path.insert(0, str(SERVER))
import rehearsal_sandbox as box  # noqa: E402
import shift_rehearsal as rh  # noqa: E402

RELAY_SRC = (SERVER / "shift_rehearsal.py").read_text(encoding="utf-8")
BOX_SRC = (SERVER / "rehearsal_sandbox.py").read_text(encoding="utf-8")
ACTS_SRC = (SERVER / "shift_rehearsal_acts.py").read_text(encoding="utf-8")
SS_SRC = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
STDLIB = {"__future__", "json", "logging", "os", "re", "subprocess", "sys", "pathlib", "typing",
          "tempfile", "threading", "traceback", "datetime", "secrets"}


def top_imports(src: str) -> list[str]:
    out = []
    for node in ast.parse(src).body:
        if isinstance(node, ast.Import):
            out += [a.name.split(".")[0] for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module:
            out.append(node.module.split(".")[0])
    return out


def fn_source(src: str, name: str) -> str:
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) \
                and node.name == name:
            return ast.get_source_segment(src, node) or ""
    return ""


print("THE RELAY NEVER HANDS A LANE THE SANDBOX — the door imports no lane at all")
relay_imports = top_imports(RELAY_SRC)
check("server/shift_rehearsal.py imports nothing but the standard library, so no reader, cache or "
      "beat of the relay can ever be handed the sandbox's database",
      set(relay_imports) <= STDLIB, relay_imports)
check("every answer, board and reset goes to a worker process of its own",
      "subprocess.run(" in fn_source(RELAY_SRC, "_run_worker")
      and "_run_worker(" in fn_source(RELAY_SRC, "_worker")
      and all(f"_worker(dsn, \"{op}\"" in RELAY_SRC for op in ("board", "answer", "reset")))
check("a worker that ends without a result, times out or cannot start is a failure said out loud, "
      "never an empty board",
      "raise Failed(" in fn_source(RELAY_SRC, "_run_worker")
      and "TimeoutExpired" in fn_source(RELAY_SRC, "_run_worker"))
# L1: each worker holds a thread of the relay's shared executor, so only WORKER_SLOTS run at once
held = []
while rh._SLOTS.acquire(blocking=False):
    held.append(1)
try:
    rh.board("dbname=never", who={"name": "Nobody", "sees_reasons": True},
             schema="asa_rehearsal", root=Path("/tmp/never/here"))
    capped = "started"
except rh.Refused as exc:
    capped = exc.code
except rh.Failed:
    capped = "failed"
finally:
    for _ in held:
        rh._SLOTS.release()
check("with every worker slot taken, one more read is refused as busy at the door — no process "
      "is started and no executor thread waits for a slot",
      len(held) == rh.WORKER_SLOTS and capped == "busy"
      and "acquire(blocking=False)" in fn_source(RELAY_SRC, "_worker"), [len(held), capped])
check("the driver's session is handed to the worker as a reader, so the driver's own decisions "
      "and approvals are weighed as the real door weighs that session",
      rh.driver_reader({"name": "D", "decides_everywhere": True, "decides": ("A",), "x": 1})
      == {"decides_everywhere": True, "decides": ["A"]} and rh.driver_reader(None) is None
      and "who=who" in fn_source(SS_SRC, "lane_shift_rehearsal_answer")
      and '"decider"' in fn_source(SS_SRC, "lane_shift_rehearsal_answer"))
routes = "".join(fn_source(SS_SRC, n) for n in ("lane_shift_rehearsal", "lane_shift_rehearsal_answer",
                                                "lane_shift_rehearsal_reset"))
check("the relay's rehearsal routes wake no real notice and no real calendar — nothing real "
      "changed — and the old per-row undo door is gone",
      routes.count("shift_rehearsal.") >= 3 and "_notices_wake(" not in routes
      and "_housecal_rang(" not in routes and "shift_rehearsal.undo" not in SS_SRC
      and '"/hub-lanes/shift-rehearsal/reset"' in SS_SRC, routes[:300])

print("\nTHE SEAL COMES BEFORE ANY LANE")
box_imports = top_imports(BOX_SRC)
check("the sandbox module loads only the standard library and psycopg2 at its top — every lane it "
      "touches is imported inside a function, after the seal",
      set(box_imports) <= STDLIB | {"psycopg2"}, box_imports)
acts_tree = ast.parse(ACTS_SRC)
order = []
for node in acts_tree.body:
    if isinstance(node, ast.If) and "sealed" in ast.get_source_segment(ACTS_SRC, node.test):
        order.append("seal-check")
    elif isinstance(node, (ast.Import, ast.ImportFrom)):
        names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module]
        if any(n in ("shift_requests", "shift_handoff", "sms_ears", "house_cal_live",
                     "open_shift_covered", "psi_reminders") for n in names):
            order.append("lane")
check("the acts refuse to load outside a sealed worker, and the check stands before the first lane",
      "seal-check" in order and order.index("seal-check") < order.index("lane"), order)
check("the worker seals, and only then imports the acts",
      fn_source(BOX_SRC, "main").index("seal(") < fn_source(BOX_SRC, "main").index(
          "import shift_rehearsal_acts"))
check("the walls: the connection is replaced and the audit hook installed inside seal()",
      "psycopg2.connect = _guarded_connect" in fn_source(BOX_SRC, "seal")
      and "install_walls(base)" in fn_source(BOX_SRC, "seal"))
check("inside the worker the calendar switch holds, the workbook is absent and the lanes' locks "
      "are moved clear of the real ones",
      "effective_roster.use_switch" in fn_source(BOX_SRC, "configure_lanes")
      and "use_workbook(_NoWorkbook())" in fn_source(BOX_SRC, "configure_lanes")
      and "LOCK_SHIFT" in fn_source(BOX_SRC, "configure_lanes"))

print("\nTHE DOOR IS THE REAL ONE, AND NOTHING IS STAMPED TO HIDE WHAT IT OWES")
doors = [d for d in ("sr.apply_for", "sr.withdraw", "sr.decide", "sr.take_open_shift",
                     "shift_handoff.offer", "shift_handoff.answer", "sms_ears.listen")
         if d in ACTS_SRC]
check("the acts call every lane door by name", len(doors) == 7, doors)
stamps = [w for w in ("mark_said", "'expired'", "note_rehearsed", "_hold_", "fresh_only")
          if w in ACTS_SRC]
check("the acts write no lane state to silence a message: what a lane owes inside the sandbox is "
      "READ from its own owed(), and nothing hands it to a door", stamps == [], stamps)
check("every lane's owed() is read before and after an answer, and a lane that cannot be read is "
      "named rather than counted as owing nothing",
      all(f in ACTS_SRC for f in ("sr.owed(", "shift_handoff.owed(", "sms_ears.owed(",
                                  "open_shift_covered.owed("))
      and "could not be read" in fn_source(ACTS_SRC, "owed_now"))
check("the answer is written down BEFORE it is played, so one that never finishes still shows",
      fn_source(ACTS_SRC, "answer").index("_begin(row)")
      < fn_source(ACTS_SRC, "answer").index("_apply(row"))


def _prepare_sites(src: str) -> list[str]:
    """For every call of _prepare(), the lock it stands in: 'exclusive', 'shared' or 'none'."""
    tree = ast.parse(src)
    out: list[str] = []

    def walk(node: ast.AST, lock: str) -> None:
        if isinstance(node, ast.With):
            for item in node.items:
                call = item.context_expr
                if isinstance(call, ast.Call) and getattr(call.func, "id", "") == "_ActLock":
                    shared = any(k.arg == "shared" and getattr(k.value, "value", False)
                                 for k in call.keywords)
                    lock = "shared" if shared else "exclusive"
        if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "_prepare":
            out.append(lock)
        for child in ast.iter_child_nodes(node):
            walk(child, lock)

    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name != "_prepare":
            walk(node, "none")
    return out


sites = _prepare_sites(ACTS_SRC)
check("L4 — the sandbox is prepared (tables, copy, top-up and its renumbering) only under the "
      "EXCLUSIVE act lock, wherever it is prepared, and the top-up has no other caller",
      sites and set(sites) == {"exclusive"} and ACTS_SRC.count("box.top_up(") == 1
      and "box.top_up(" in fn_source(ACTS_SRC, "_prepare"), sites)
check("L4 — a board is read under the SHARED lock, so it never meets a reset or an answer half "
      "done, and it waits its turn rather than failing at once",
      "_ActLock(shared=True, wait=BOARD_WAIT_S)" in fn_source(ACTS_SRC, "board")
      and "pg_try_advisory_lock_shared" in fn_source(ACTS_SRC, "_ActLock"))
check("the rehearsed clock is compared as instants, never as strings",
      "_instant(span[\"from\"])" in fn_source(ACTS_SRC, "_clock_for")
      and "_iso(clock) <" not in fn_source(ACTS_SRC, "_clock_for"))
check("a rehearsed text is a line in the SANDBOX's own inbox, heard by the real ear",
      'box.root() / "inbox"' in ACTS_SRC and "sms_ears.listen(DSN, inbox=inbox" in ACTS_SRC)
check("the acts and doors the screen offers are the relay's one list",
      rh.ACTS == ("apply", "withdraw", "decide", "take", "offer_swap", "swap_accept",
                  "swap_approve", "swap_director") and rh.CLOCK_ACTS == ("apply", "decide", "take")
      and "from shift_rehearsal import ACTS, CLOCK_ACTS, DOORS, Refused" in ACTS_SRC)

print("\nTHE DATABASE WALL, READ STATEMENT BY STATEMENT")
T = box.write_targets
check("an insert, an update and a delete name their table",
      T("INSERT INTO asa_x (a) VALUES (1)") == ["asa_x"]
      and T("UPDATE ONLY public.asa_x SET a=1") == ["public.asa_x"]
      and T("DELETE FROM asa_y WHERE a=1") == ["asa_y"])
check("ON CONFLICT … DO UPDATE and FOR UPDATE are not tables",
      T("INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a=2") == ["t"]
      and T("SELECT * FROM t WHERE a=1 FOR UPDATE SKIP LOCKED") == []
      and T("SELECT * FROM t FOR UPDATE OF t NOWAIT") == [])
check("a write hidden in a WITH is still seen",
      T("WITH x AS (DELETE FROM real_t RETURNING 1) SELECT * FROM x") == ["real_t"])
check("the DDL a lane runs names what it reshapes",
      T("ALTER TABLE IF EXISTS asa_y ADD COLUMN IF NOT EXISTS z TEXT") == ["asa_y"]
      and T("CREATE UNIQUE INDEX IF NOT EXISTS idx ON asa_z (a) WHERE s='pending'") == ["asa_z"]
      and T("CREATE INDEX ON asa_z (a)") == ["asa_z"]
      and T("TRUNCATE TABLE a") == ["a"])
check("quoted and qualified names come through whole",
      T('INSERT INTO "sbx"."t" (a) SELECT a FROM "real"."t"') == ['"sbx"."t"'])
check("words inside a string or a comment are not SQL, and a lock function is not a LOCK",
      T("SELECT 'INSERT INTO real_t' AS words") == []
      and T("-- DELETE FROM x\nSELECT 1") == []
      and T("SELECT pg_try_advisory_lock(1, 2)") == []
      and T("UPDATE t SET updated_at = now()") == ["t"])
never = box.never
check("statements that move the connection or reach outside are never let through",
      all(never(s) for s in ("DROP TABLE asa_shift_pool", "SET search_path TO public",
                             "SELECT set_config('search_path', 'public', false)", "COMMIT",
                             "NOTIFY hub", "SELECT pg_notify('hub', 'x')",
                             "DO $$ BEGIN END $$", "CREATE FUNCTION f() RETURNS int AS 'x'",
                             "GRANT ALL ON asa_x TO somebody", "RESET ALL",
                             "SET ROLE postgres", "CREATE SCHEMA other")))
check("…and the statements the lanes do send are let through to be vetted",
      not any(never(s) for s in ("CREATE TABLE IF NOT EXISTS t (a int)", "SELECT 1", "BEGIN",
                                 "ROLLBACK", "SET LOCAL lock_timeout = '2s'",
                                 "INSERT INTO t VALUES (1)")))
check("a table created with a schema of its own is named, so one outside the sandbox is refused",
      box.created_names("CREATE TABLE IF NOT EXISTS public.x (a int)") == ["public.x"]
      and box.created_names("CREATE TABLE IF NOT EXISTS x (a int)") == ["x"])
check("L2 — a second statement never rides behind the first: a COMMIT after a call, a DELETE after "
      "a value holding '--', are refused whole; a trailing ';' and a ';' inside a string are not "
      "a second statement",
      all(never(s) for s in ("SELECT f(); COMMIT", "SELECT 1; SELECT 2",
                             "INSERT INTO t VALUES ('--', 'x'); DELETE FROM public.y"))
      and not any(never(s) for s in ("SELECT 1;", "SELECT 'a; COMMIT' AS s", "SELECT $$ ; $$",
                                     "INSERT INTO t VALUES ('/*', 1)")))
check("L2 — COPY in any shape, SELECT … INTO, large objects and other sessions are never let "
      "through; INSERT INTO, MERGE INTO and a column spelled \"into\" are",
      all(never(s) for s in ("COPY (SELECT 1) TO '/tmp/x'", "copy t from stdin",
                             "SELECT 1 INTO public.t", "SELECT a INTO t FROM u",
                             "SELECT lo_unlink(1)", "SELECT pg_terminate_backend(1)",
                             "SELECT pg_reload_conf()"))
      and not any(never(s) for s in ("INSERT INTO t SELECT a FROM u", 'SELECT "into" FROM t',
                                     "MERGE INTO t USING u ON true WHEN MATCHED THEN DO NOTHING",
                                     "SELECT lower(a) FROM t")))
check("L2 — a partition, a parent and a foreign key's target are named, so one outside the "
      "sandbox is refused",
      box.linked_names("CREATE TABLE x PARTITION OF public.y FOR VALUES IN (1)") == ["public.y"]
      and box.linked_names("CREATE TABLE x (a int) INHERITS (public.y, z)") == ["public.y", "z"]
      and box.linked_names("CREATE TABLE x (a int REFERENCES real_t(id))") == ["real_t"]
      and box.linked_names("ALTER TABLE x ATTACH PARTITION public.y FOR VALUES IN (1)")
      == ["public.y"]
      and box.linked_names("CREATE TABLE IF NOT EXISTS t (a int)") == [])
check("L2 — the sequence a setval or nextval moves is read from its literal; anything but a "
      "literal is None, and refused",
      box.sequence_args("SELECT setval('public.x', 5)") == ["public.x"]
      and box.sequence_args("SELECT nextval('x'::regclass)") == ["x"]
      and box.sequence_args("SELECT setval(pg_get_serial_sequence('t', 'a'), 1)") == [None]
      and box.sequence_args("SELECT 1 WHERE e LIKE 'nextval(%'") == []
      and "self.mogrify(query, vars)" in fn_source(BOX_SRC, "_VettedMixin"))
check("L-a — every relation of a TRUNCATE or LOCK list is a target, not just the first",
      T("TRUNCATE asa_shift_pool, public.asa_users") == ["asa_shift_pool", "public.asa_users"]
      and T("TRUNCATE TABLE ONLY a, ONLY b *, public.c RESTART IDENTITY") == ["a", "b", "public.c"]
      and T("LOCK TABLE a, public.b IN ACCESS EXCLUSIVE MODE") == ["a", "public.b"]
      and T("SELECT pg_advisory_lock(1, 2)") == [])
check("L-a — a view made OR REPLACE, RECURSIVE or TEMP names what it makes, so one outside the "
      "sandbox is refused",
      box.created_names("CREATE OR REPLACE VIEW public.v AS SELECT 1") == ["public.v"]
      and box.created_names("CREATE RECURSIVE VIEW public.r (a) AS SELECT 1") == ["public.r"]
      and box.created_names("CREATE OR REPLACE TEMP VIEW v AS SELECT 1") == ["v"])
check("L-a — nothing but a table, index, sequence, view or type is made or altered: a trigger, a "
      "materialized view, a policy, a domain, a rule or a foreign table is refused whole, wherever "
      "the CREATE stands",
      all(never(s) for s in ("ALTER TRIGGER t ON public.x RENAME TO y",
                             "ALTER MATERIALIZED VIEW public.m RENAME TO n",
                             "ALTER POLICY p ON public.x RENAME TO q", "ALTER DOMAIN d RENAME TO e",
                             "ALTER RULE r ON public.x RENAME TO s",
                             "ALTER FOREIGN TABLE public.f RENAME TO g",
                             "ALTER FUNCTION f() OWNER TO x", "ALTER SCHEMA s RENAME TO t",
                             "CREATE MATERIALIZED VIEW m AS SELECT 1",
                             "EXPLAIN ANALYZE CREATE MATERIALIZED VIEW public.m AS SELECT 1",
                             "CREATE TRIGGER t BEFORE INSERT ON x FOR EACH ROW EXECUTE FUNCTION f()",
                             "CREATE OR REPLACE RULE r AS ON INSERT TO x DO NOTHING",
                             "CREATE POLICY p ON x", "CREATE SCHEMA other", "ANALYZE public.x",
                             "TRUNCATE sbx_t CASCADE"))
      and not any(never(s) for s in ("ALTER TABLE t ALTER COLUMN a TYPE text",
                                     "ALTER TABLE IF EXISTS t ADD COLUMN IF NOT EXISTS z TEXT",
                                     "ALTER INDEX i SET (fillfactor = 70)", 'SELECT "create" FROM t',
                                     "CREATE TEMP TABLE t (a int)", "CREATE SEQUENCE IF NOT EXISTS s",
                                     "CREATE UNIQUE INDEX IF NOT EXISTS i ON t (a)",
                                     "CREATE OR REPLACE VIEW v AS SELECT 1", "TRUNCATE sbx_t")))
check("REH-2 — a relation moved to another schema, every relation of a tablespace, or a sequence "
      "tied to another table is refused wherever the words stand",
      all(never(s) for s in ("ALTER TABLE x SET SCHEMA public", "ALTER SEQUENCE s SET SCHEMA public",
                             "ALTER TABLE ALL IN TABLESPACE a SET TABLESPACE b",
                             "ALTER SEQUENCE s OWNED BY public.t.a",
                             "ROLLBACK PREPARED 'x'", "COMMIT PREPARED 'x'")))
check("REH-2 — a two-phase transaction is never begun, prepared or committed on a sandbox connection: "
      "its commit would pass the check every commit makes",
      "raise SandboxBreach(" in fn_source(BOX_SRC, "tpc_begin")
      and "tpc_prepare = tpc_commit = tpc_rollback = tpc_recover = tpc_begin"
      in fn_source(BOX_SRC, "SandboxConnection"))
check("the one DROP the lanes send — a retired index — passes the statement check only as one index "
      "and no CASCADE; the vet then wants it spelled in the sandbox's own schema",
      box.dropped_index('DROP INDEX IF EXISTS "s"."asa_shift_handoffs_open"')
      == '"s"."asa_shift_handoffs_open"'
      and not never('DROP INDEX IF EXISTS "s"."i"')
      and all(never(s) for s in ('DROP INDEX IF EXISTS "s"."i" CASCADE', "DROP INDEX a, b",
                                 "DROP INDEX CONCURRENTLY i", "DROP TABLE x", "DROP VIEW v"))
      and "_vet_names(conn, sql)" in fn_source(BOX_SRC, "vet")
      and "dropped_index(sql)" in fn_source(BOX_SRC, "_vet_names")
      and "so it could be a real one" in fn_source(BOX_SRC, "_vet_names"))
# what each wall refuses is proved by the checks around this one; its prose left the module with the comment trim
check("a DELETE FROM ONLY and a MERGE INTO ONLY name their table, so the vet reads it before it runs",
      T("DELETE FROM ONLY public.x WHERE a=1") == ["public.x"]
      and T("WITH d AS (DELETE FROM ONLY real_t RETURNING 1) SELECT * FROM d") == ["real_t"]
      and T("MERGE INTO ONLY public.m USING u ON true WHEN MATCHED THEN DO NOTHING")
      == ["public.m"]
      and T("DELETE FROM asa_y WHERE a=1") == ["asa_y"])
check("a RENAME is never sent from the sandbox — a name it gave up would fall through to a real "
      "relation — while a column or a quoted word merely spelled like one passes",
      all(never(s) for s in ("ALTER INDEX i RENAME TO j", "ALTER TABLE t RENAME TO u",
                             "ALTER TABLE IF EXISTS t RENAME COLUMN a TO b",
                             "ALTER SEQUENCE s RENAME TO r", "ALTER VIEW v RENAME TO w"))
      and not any(never(s) for s in ('SELECT "rename" FROM t',
                                     "ALTER TABLE t ADD COLUMN IF NOT EXISTS renamed TEXT",
                                     "UPDATE t SET note = 'RENAME'")))
# the remembered names, with the catalog stood in for: a name proved inside is forgotten after an
# ALTER or a DROP, so a name that now resolves to a real relation is read again and refused
_held_state = (box._resolve, box._STATE["schema"], set(box._KNOWN_INSIDE), box._current_schema)
_where = {"t": "sbx_probe"}
_path = {"now": "sbx_probe", "asked": 0}


def _path_now(conn):
    _path["asked"] += 1
    return _path["now"]


box._resolve = lambda conn, name: _where.get(name)
box._current_schema = _path_now
box._STATE["schema"] = "sbx_probe"
box._KNOWN_INSIDE.clear()
try:
    box.vet(None, "INSERT INTO t VALUES (1)")
    _cached = "t" in box._KNOWN_INSIDE
    box.vet(None, "ALTER TABLE t ADD COLUMN IF NOT EXISTS z INT")
    _after_alter = set(box._KNOWN_INSIDE)
    box.vet(None, "INSERT INTO t VALUES (2)")
    box.vet(None, 'DROP INDEX IF EXISTS "sbx_probe"."i"')
    _after_drop = set(box._KNOWN_INSIDE)
    _where["t"] = "public"
    try:
        box.vet(None, "TRUNCATE t")
        _moved = "let through"
    except box.SandboxBreach as exc:
        _moved = "refused: " + str(exc)
    # V2-W1: the path moved under a remembered name (a function the vet cannot read called
    # set_config): the name is never trusted, the statement is refused and the memory goes
    _where["t"] = "sbx_probe"
    box._KNOWN_INSIDE.clear()
    box.vet(None, "INSERT INTO t VALUES (3)")
    _cached_again = "t" in box._KNOWN_INSIDE
    _path["now"] = "public"
    try:
        box.vet(None, "TRUNCATE t")
        _path_moved = "let through"
    except box.SandboxBreach as exc:
        _path_moved = "refused: " + str(exc)
    _after_path = set(box._KNOWN_INSIDE)
    # a statement that names nothing is never held up by the path it does not read
    _asked = _path["asked"]
    box.vet(None, "SELECT 1")
    _select_asked = _path["asked"] - _asked
finally:
    box._resolve, box._STATE["schema"] = _held_state[0], _held_state[1]
    box._current_schema = _held_state[3]
    box._KNOWN_INSIDE.clear()
    box._KNOWN_INSIDE.update(_held_state[2])
check("a name proved inside is remembered only until the next ALTER or DROP: after either, a name "
      "that now resolves to a real relation is read again and refused",
      _cached and _after_alter == set() and _after_drop == set()
      and _moved.startswith("refused") and "public.t" in _moved,
      [_cached, _after_alter, _after_drop, _moved])
check("V2-W1 — a statement that names anything is sent only while the connection's path still "
      "opens on the sandbox: with the path moved, a remembered name is refused and forgotten; a "
      "statement naming nothing never asks",
      _cached_again and _path_moved.startswith("refused") and "now opens on public" in _path_moved
      and _after_path == set() and _select_asked == 0
      and "_path_holds(conn)" in fn_source(BOX_SRC, "_vet_names"),
      [_cached_again, _path_moved, _after_path, _select_asked])
check("V2-wall-glued-ident — a quoted name glued to the word before it is read like any other",
      T('TRUNCATE"public"."x"') == ['"public"."x"']
      and T('ALTER TABLE"public"."x" ADD COLUMN b int') == ['"public"."x"']
      and T('LOCK"public"."x"') == ['"public"."x"']
      and T('CREATE INDEX i ON"public"."x" (a)') == ['"public"."x"']
      and T('CREATE INDEX"i"ON"public"."x" (a)') == ['"public"."x"']
      and T('INSERT INTO"public"."x" VALUES (1)') == ['"public"."x"']
      and box.created_names('CREATE TABLE"public"."x"(a int)') == ['"public"."x"']
      and T('TRUNCATE "a""b"') == ['"a""b"'],
      [T('TRUNCATE"public"."x"'), T('CREATE INDEX"i"ON"public"."x" (a)')])
check("V2-W1 — a function or a setting is known by name however it is quoted: set_config and the "
      "search path in quotes are refused",
      all(never(s) for s in ('SELECT "set_config"(\'search_path\', \'public\', false)',
                             'SELECT pg_catalog."set_config"(\'search_path\', \'public\', false)',
                             'SET "search_path" TO public', 'SELECT "pg_notify"(\'hub\', \'x\')'))
      and not any(never(s) for s in ('UPDATE t SET "search_path_col" = 1',
                                     'SELECT "into" FROM t')))
check("V2-W1 — a name or a string in Unicode escapes is refused whole: U&\"…\" would be read as a "
      "name the vet does not resolve",
      all(never(s) for s in ('TRUNCATE U&"public".asa_shift_pool',
                             'ALTER TABLE U&"public".t ADD COLUMN b int',
                             "SELECT setval(U&'\\0070ublic.x', 1)", 'TRUNCATE u&"x"'))
      and "Unicode escapes" in never('TRUNCATE U&"public".asa_shift_pool'))
check("V2-W2 — a table made LIKE another names that model, so a real one (whose defaults draw from "
      "a real sequence) is refused; a LIKE comparison is not a model",
      box.linked_names("CREATE TABLE x (LIKE public.t INCLUDING ALL)") == ["public.t"]
      and box.linked_names('CREATE TABLE x (a int, LIKE "public"."t")') == ['"public"."t"']
      and box.linked_names("SELECT * FROM t WHERE a LIKE b") == []
      and box.linked_names("SELECT * FROM t WHERE a NOT LIKE 'x%'") == [])
check("a qualified name's schema is read as Postgres reads it: quoted as spelled, bare folded",
      box._schema_of_name('"public"."x"') == "public" and box._schema_of_name("PUBLIC.x") == "public"
      and box._schema_of_name('"a""b".x') == 'a"b' and box._schema_of_name("x") == ""
      and box._schema_of_name('"a.b"') == "")


class _FakeCur:
    def __init__(self, script):
        self.script, self.sent, self.last = script, [], ""

    def execute(self, sql, args=None):
        text = sql if isinstance(sql, str) else getattr(sql, "text", "CREATE SCHEMA")
        self.sent.append(text)
        self.last = text

    def fetchone(self):
        return self.script(self.last, self.sent)


class _FakeConn:
    def __init__(self, script):
        self.cur, self.done = _FakeCur(script), []

    def cursor(self):
        return self.cur

    def commit(self):
        self.done.append("commit")

    def rollback(self):
        self.done.append("rollback")

    def close(self):
        self.done.append("close")


def _real_path_with(script, name="asa_rehearsal"):
    conn = _FakeConn(script)
    held = (box._REAL_CONNECT, box.psycopg2.sql.SQL, box.psycopg2.sql.Identifier)

    class _Sql:
        def __init__(self, text):
            self.text = text

        def format(self, *a):
            return self

    class _Ident:
        def __init__(self, *parts):
            self.parts = parts

        def as_string(self, conn):
            return ".".join(self.parts)

    box._REAL_CONNECT = lambda dsn: conn
    box.psycopg2.sql.SQL, box.psycopg2.sql.Identifier = _Sql, _Ident
    try:
        box._real_path("dbname=x", name)
        got = "used"
    except box.SandboxBreach as exc:
        got = "refused: " + str(exc)
    finally:
        box._REAL_CONNECT, box.psycopg2.sql.SQL, box.psycopg2.sql.Identifier = held
    return got, conn


_as_role, _role_conn = _real_path_with(
    lambda last, sent: ("asa_rehearsal", "asa_rehearsal", True) if "current_user" in last
    else (["public"],) if "current_schemas" in last else (False,))
check("V2-W4 — a sandbox schema named like the database role is never made: \"$user\" on the real "
      "estate's path would open on it the moment it existed",
      _as_role.startswith("refused") and "named like the database role" in _as_role
      and not any("CREATE SCHEMA" in s for s in _role_conn.cur.sent)
      and "commit" not in _role_conn.done, [_as_role, _role_conn.cur.sent])
_after_make, _make_conn = _real_path_with(
    lambda last, sent: ("postgres", "postgres", True) if "current_user" in last
    else ((["asa_rehearsal", "public"],) if any("CREATE SCHEMA" in s for s in sent) else (["public"],))
    if "current_schemas" in last else (False,))
check("V2-W4 — a schema the real estate's path names before it exists is read again once made; "
      "standing on that path, it is rolled back and never used",
      _after_make.startswith("refused") and "stood on the real estate's own path" in _after_make
      and "rollback" in _make_conn.done and "commit" not in _make_conn.done,
      [_after_make, _make_conn.done])
_fine, _fine_conn = _real_path_with(
    lambda last, sent: ("postgres", "postgres", True) if "current_user" in last
    else (["public"],) if "current_schemas" in last else (False,))
check("…and a schema of its own name, off every real path, is made and kept, and the role it was "
      "made by is remembered with whether it is a superuser",
      _fine == "used" and "commit" in _fine_conn.done
      and box.role() == {"name": "postgres", "superuser": True}, [_fine, box.role()])
box._STATE["role"] = {}
# every lock namespace a lane reads from the environment is moved clear of the real one
_lock_envs = {}
for _p in SERVER.glob("*.py"):
    for _m in __import__("re").finditer(r'os\.getenv\("(HUB_\w*LOCK_NS)",\s*"(\d+)"\)',
                                        _p.read_text(encoding="utf-8")):
        _lock_envs[_m.group(1)] = int(_m.group(2))
check("every lock namespace a lane reads from the environment is moved clear of the real one in the "
      "worker, the Time Off house's among them, with the lane's own default",
      _lock_envs and _lock_envs == box.LOCK_ENV and box.LOCK_ENV["HUB_TIME_OFF_LOCK_NS"] == 8231,
      [_lock_envs, box.LOCK_ENV])
check("…and every module attribute holding one is moved too, whatever it is called",
      all(box.LOCK_ATTR_RE.search(a) for a in ("LOCK_NS", "TAB_LOCK_NS", "HOUSE_LOCK_NS",
                                                "PERSON_LOCK_NS", "LOCK_NS_ID", "LOCK_NS_TAB"))
      and not any(box.LOCK_ATTR_RE.search(a) for a in ("BLOCK_NSX", "LOCK_NSFW", "CLOCK_NS",
                                                       "LOCKS"))
      and "LOCK_ATTR_RE.search(a)" in fn_source(BOX_SRC, "configure_lanes"))
with tempfile.TemporaryDirectory() as _tmp:
    _base = Path(_tmp) / "shift-rehearsal"
    (_base / "inbox").mkdir(parents=True, mode=0o755)
    os.chmod(_base / "inbox", 0o755)
    os.chmod(_base, 0o755)
    _made = box.private_dirs(_base)
    _modes = {str(d.relative_to(_base)): oct(d.stat().st_mode & 0o777) for d in _made}
check("the sandbox directory and its inbox, out and tmp are readable by their owner alone, like the "
      "real inbox and mockup directories — one made earlier with a wider mode is narrowed",
      _modes == {".": "0o700", "inbox": "0o700", "out": "0o700",
                 "out/comm-mock-web": "0o700", "tmp": "0o700"}
      and "private_dirs(base)" in fn_source(BOX_SRC, "seal")
      and fn_source(BOX_SRC, "seal").index("private_dirs(base)")
      < fn_source(BOX_SRC, "seal").index("install_walls(base)"), _modes)
# the answer's own list of what would have been said: new messages only, an unread lane apart
_msg = lambda lane, i: {"lane": lane, "key": f"{lane}:{i}", "kind": "ack", "to": "Ann Roe",  # noqa: E731
                        "about": "", "words": ""}
_unread = lambda lane: {"lane": lane, "key": f"{lane}:unreadable", "kind": "unreadable",  # noqa: E731
                        "to": "", "about": "this lane could not be read (OperationalError)",
                        "why": "OperationalError", "words": ""}
_d1 = rh.owed_diff([_msg("shift", 1)], [_msg("shift", 1), _msg("shift", 2)])
_d2 = rh.owed_diff([_msg("text", 1)], [_unread("text")])
_d3 = rh.owed_diff([_unread("text")], [_msg("text", 1), _msg("text", 2), _msg("swap", 9)])
_d4 = rh.owed_diff([_unread("follow-up")], [_unread("follow-up")])
check("V1-c — an answer is credited only with what the lanes owe after it and did not owe before",
      [o["key"] for o in _d1] == ["shift:2"], _d1)
check("V1-c — a lane readable before and unreadable after is never listed as a message: it is said "
      "apart, as not read after the answer",
      [(o["key"], o["kind"]) for o in _d2] == [("text:unreadable", "unreadable")]
      and "could not be read after the answer (OperationalError)" in _d2[0]["about"]
      and "not known" in _d2[0]["about"], _d2)
check("V1-c — a lane unreadable before and readable after credits the answer with none of what it "
      "owes, since it may have owed it already; another lane's new message still counts",
      [(o["key"], o["kind"]) for o in _d3] == [("swap:9", "ack"), ("text:unreadable", "unreadable")]
      and "before the answer" in _d3[1]["about"], _d3)
check("V1-c — a lane unread on both sides is named once",
      len(_d4) == 1 and "before or after the answer" in _d4[0]["about"], _d4)
check("V1-c — the answer's list is that diff, and the lane's unread entry carries why",
      "owed_diff(before, owed_now(played))" in fn_source(ACTS_SRC, "answer")
      and '"why": type(exc).__name__' in fn_source(ACTS_SRC, "owed_now"))
# V2-owed-nobody: each lane's recipient, read from the field that lane names it in
_notice = rh.owed_entry("shift", {"id": "L|OPEN|D:open_shift_applicants", "kind": "open_shift_applicants",
                                  "person": "Ann Roe", "to_name": "", "house_name": "48TH",
                                  "col_iso": "2026-09-26", "shift_code": "8A-4P"})
_named = rh.owed_entry("shift", {"id": "x", "kind": "k", "person": "Ann Roe", "to_name": "Hana Manager"})
_ack = rh.owed_entry("text", {"id": "SMS|REH1:sms_reply_applied", "kind": "sms_reply_applied",
                              "person": "Ben Left"})
_follow = rh.owed_entry("follow-up", {"id": "L|Cy Far|D", "kind": "open_shift_covered",
                                      "called_off_by": "Cy Far", "filled_by": "Ann Roe"})
_ask = rh.owed_entry("swap", {"id": "HO1:handoff_ask_manager", "kind": "handoff_ask_manager",
                              "person": "", "to_name": "", "house_manager": ""})
check("V2-owed-nobody — a recipient the lane left blank is said as not known, never as nobody and "
      "never as the applicant the notice is about; each lane's recipient is read from its own field",
      _notice["to"] == "" and _notice["to_known"] is False
      and _notice["about"] == "48TH · 2026-09-26 · 8A-4P"
      and _named["to"] == "Hana Manager" and _named["to_known"] is True
      and _ack["to"] == "Ben Left" and _follow["to"] == "Cy Far"
      and _ask["to"] == "" and _ask["to_known"] is False
      and "owed_entry(lane, o)" in fn_source(ACTS_SRC, "owed_now")
      and "def _summary" not in ACTS_SRC,
      [_notice, _named, _ack, _follow, _ask])
# V2-superuser-role: the worker's database is its own when one is named
_env_held = os.environ.pop("HUB_SHIFT_REHEARSAL_DSN", None)
_sent: list = []
_run_held = rh.subprocess.run


def _fake_run(args, input=None, **kw):  # noqa: A002 — subprocess.run's own spelling
    _sent.append(json.loads(input))
    return types.SimpleNamespace(stdout=rh.RESULT + json.dumps({"data": {"ok": True}}) + "\n",
                                 stderr="", returncode=0)


rh.subprocess.run = _fake_run
try:
    rh._run_worker("dbname=relay", "board", {}, schema="asa_rehearsal", root=Path("/tmp/a/b"))
    os.environ["HUB_SHIFT_REHEARSAL_DSN"] = "dbname=relay user=asa_rehearsal_worker"
    rh._run_worker("dbname=relay", "board", {}, schema="asa_rehearsal", root=Path("/tmp/a/b"))
finally:
    rh.subprocess.run = _run_held
    os.environ.pop("HUB_SHIFT_REHEARSAL_DSN", None)
    if _env_held is not None:
        os.environ["HUB_SHIFT_REHEARSAL_DSN"] = _env_held
check("V2-superuser-role — the worker is handed HUB_SHIFT_REHEARSAL_DSN when it is set (a role that "
      "owns only the sandbox), and the relay's own database otherwise",
      [s.get("dsn") for s in _sent] == ["dbname=relay", "dbname=relay user=asa_rehearsal_worker"],
      _sent)
check("…and the board says which role the worker connects as and whether it is a superuser",
      '"role": box.role()' in fn_source(ACTS_SRC, "_read_board")
      and "rolsuper" in fn_source(BOX_SRC, "_real_path"))
# V2-owed-second-wall: outside the sealed worker a rehearsed row is never a message
_seal_src = fn_source((SERVER / "shift_requests.py").read_text(encoding="utf-8"), "messages_rehearsed")
_seal_ns: dict = {"sys": sys, "Any": object}
exec(compile("from __future__ import annotations\n" + _seal_src, "messages_rehearsed", "exec"),  # noqa: S102
     _seal_ns)
_seal_held = box._STATE["sealed"]
try:
    _outside = _seal_ns["messages_rehearsed"]()
    box._STATE["sealed"] = True
    _inside = _seal_ns["messages_rehearsed"]()
finally:
    box._STATE["sealed"] = _seal_held
_broken = types.ModuleType("rehearsal_sandbox")
_broken.sealed = lambda: (_ for _ in ()).throw(RuntimeError("no seal"))
sys.modules["rehearsal_sandbox"], _real_box = _broken, sys.modules["rehearsal_sandbox"]
try:
    _unread_seal = _seal_ns["messages_rehearsed"]()
finally:
    sys.modules["rehearsal_sandbox"] = _real_box
_absent = sys.modules.pop("rehearsal_sandbox")
try:
    _no_box = _seal_ns["messages_rehearsed"]()
finally:
    sys.modules["rehearsal_sandbox"] = _absent
check("V2-owed-second-wall — a lane lists what a rehearsed row would say only inside the sealed "
      "worker: unsealed, absent or unreadable, the seal says no",
      [_outside, _inside, _unread_seal, _no_box] == [False, True, False, False],
      [_outside, _inside, _unread_seal, _no_box])
_abt = fn_source(ACTS_SRC, "_apply_by_text")
check("V1-a — a rehearsed text quotes only the pool's own ref: with no pool row on the cell it is "
      "refused, and a ref handed in with the request is never carried onward",
      "if pooled is None:" in _abt and '"no_such_shift"' in _abt and 'f"YES {ref}"' in _abt
      and 'row["ref"]' not in _abt
      and 'row["ref"] = str((pooled or {}).get("ref") or "")' in fn_source(ACTS_SRC, "answer")
      and "or ref or" not in fn_source(ACTS_SRC, "answer"))
SR_SRC = (SERVER / "shift_requests.py").read_text(encoding="utf-8")
SH_SRC = (SERVER / "shift_handoff.py").read_text(encoding="utf-8")
SE_SRC = (SERVER / "sms_ears.py").read_text(encoding="utf-8")
check("REH-3 / L-b — no leftover of the design before the sandbox stays in the lane: no "
      "REHEARSED_SQL, no key signed by the rehearsal, mark_said as the lane had it",
      "REHEARSED_SQL" not in SR_SRC and "_held_by_rehearsal" not in SR_SRC
      and "fresh_only" not in SR_SRC
      and "def mark_said(dsn: str, ids: list[str], results: dict[str, Any]) -> int:" in SR_SRC
      and "if KIND_APPLICANTS in (s.get(\"said\") or {}):" in fn_source(SR_SRC, "owed"))
OSC_SRC = (SERVER / "open_shift_covered.py").read_text(encoding="utf-8")
HCL_SRC = (SERVER / "house_cal_live.py").read_text(encoding="utf-8")
check("V2-owed-second-wall — every message lane reads the mark outside the sealed worker: the "
      "pool's notice counts only real applicants, a swap's ask and a text's acknowledgement skip a "
      "rehearsed row, and the follow-up net never notes or offers a rehearsed fill",
      "rehearsed = messages_rehearsed()" in fn_source(SR_SRC, "owed")
      and "rehearsed or not a.get(REHEARSAL)" in fn_source(SR_SRC, "owed")
      and '"person": applicants[0]["person"]' in fn_source(SR_SRC, "owed")
      and "not rehearsed and is_rehearsed(row)" in fn_source(SH_SRC, "owed")
      and "rehearsed = sr.messages_rehearsed()" in fn_source(SH_SRC, "owed")
      and "shift_requests.messages_rehearsed()" in fn_source(SE_SRC, "owed")
      and 'rehearsed or not r.get("rehearsal")' in fn_source(SE_SRC, "owed")
      and "REHEARSED_FILL" in fn_source(OSC_SRC, "note_from_pool")
      and "REHEARSED_FILL" in fn_source(OSC_SRC, "owed"))
check("V2-W3 — the estate's open shifts are counted without a cell the rehearsal played, from the "
      "one read of the published cells",
      'mirror["rehearsed"]' in fn_source(HCL_SRC, "open_shifts")
      and "mirror_publishes(cur)" in fn_source(HCL_SRC, "open_shifts")
      and "pending_publishes(cur)" not in fn_source(HCL_SRC, "open_shifts"))
dec = fn_source(SR_SRC, "decide")
check("every row a rehearsed decision makes carries the mark: its claim, the pool's fill, both "
      "training approvals it may raise, the assignment it records and the cells it writes",
      "via=rehearsed_via(how, rehearsal)" in dec
      and "rehearsed_via(how, rehearsal), by, location" in dec
      and dec.count("rehearsal=rehearsal)") >= 2
      and "{REHEARSAL: rehearsal}" in dec and "rehearsal=rehearsal is not None" in dec
      and "rehearsal=rehearsal" in fn_source(SR_SRC, "guard_assignment")
      and "**_training_mark(rehearsal)" in fn_source(SR_SRC, "raise_training"))
rec = fn_source(SR_SRC, "_record_training")
check("a rehearsal's training approval closes or names only a row that carries the mark, and a "
      "real one standing on the cell is refused, never taken over",
      "only_marked" in rec and '"real_rows"' in rec and "is_rehearsed(got)" in rec)
check("L-c — a completed rehearsed swap writes its cells, and raises its training, with the "
      "rehearsal's road",
      'via=sr.rehearsed_via("handoff", _evidence(row))' in fn_source(SH_SRC, "_complete")
      and "rehearsal=_evidence(row)" in fn_source(SH_SRC, "_complete")
      and '"director_via"' in fn_source(SH_SRC, "is_rehearsed"))
cr = fn_source(SH_SRC, "complete_ready")
check("REH-1 — the beat completes a swap only with all three consents, and never one the rehearsal "
      "marked, whatever its columns say",
      "director_state=%s" in cr and "NOT (extra ? %s)" in cr
      and "(PENDING, ACCEPTED, APPROVED, APPROVED, REHEARSAL_KEY, limit)" in cr)
ans = fn_source(SH_SRC, "answer")
check("REH-1 — the swap door's rehearsal guard stands before every seat's rule, the director's "
      "included, and an offer writes the directors and the evidence together",
      ans.index('"rehearsed_swap"') < ans.index('side == "director"')
      and ans.index('"real_swap"') < ans.index('side == "director"')
      and "training, directors, extra)" in fn_source(SH_SRC, "offer")
      and "and not is_rehearsed(row)" in fn_source(SH_SRC, "describe").split(
          '"may_approve_director"')[1][:120])
off_src = fn_source(ACTS_SRC, "_offer")
check("N1 — the rehearsal's offer hands the transfer door the same reachable set the real route "
      "does, read the same way, and the receiver as the real route hands it",
      "reachable=reachable" in off_src and "reachable_names()" in off_src
      and "_person_or_refuse(view, location, to_staff)" not in off_src
      and "{k for names in (book.roster or {}).values() for k in names}"
      in fn_source(ACTS_SRC, "reachable_names")
      and "{k for names in (book.roster or {}).values() for k in names}"
      in fn_source(SS_SRC, "_reachable_names"))
check("REH-1 — the director's approval is an act of its own, by both doors, played only for the "
      "seat the real door would give that name",
      rh.ACTS[-1] == "swap_director" and '"swap_director": "director"' in ACTS_SRC
      and "seat = shift_handoff.side_for(reader, got)" in fn_source(ACTS_SRC, "_approval_refusal")
      and '"another_seat"' in ACTS_SRC and '"not_the_director"' in ACTS_SRC)
check("inside the sandbox, a breach is never swallowed as an unreadable contact index",
      all("except box.SandboxBreach:\n        raise" in fn_source(ACTS_SRC, f)
          for f in ("reachable_names", "phone_book")))

refusals = []
for kw in ({"schema": "public", "dsn": "x", "root": Path("/tmp/a/b")},
           {"schema": "Bad-Name", "dsn": "x", "root": Path("/tmp/a/b")},
           {"schema": "pg_toast", "dsn": "x", "root": Path("/tmp/a/b")},
           {"schema": "asa_rehearsal", "dsn": "", "root": Path("/tmp/a/b")},
           {"schema": "asa_rehearsal", "dsn": "x", "root": Path("/")}):
    try:
        box.seal(**kw)
        refusals.append("sealed")
    except box.SandboxBreach:
        refusals.append("refused")
check("a worker is never sealed on the real schema, a name it cannot spell, no database or the "
      "root of the disk", refusals == ["refused"] * 5 and not box.sealed(), refusals)

print("\nTHE DISK AND THE WIRE — a hook that cannot be taken back, tried in a process of its own")
with tempfile.TemporaryDirectory() as tmp:
    inside, outside = Path(tmp) / "inside", Path(tmp) / "outside"
    inside.mkdir()
    outside.mkdir()
    (outside / "kept.txt").write_text("kept", encoding="utf-8")
    probe = FAKE_PSYCOPG2 + textwrap.dedent(f'''
        import json, os, socket, subprocess, sys
        sys.path.insert(0, {str(SERVER)!r})
        import rehearsal_sandbox as box
        from pathlib import Path
        box.install_walls(Path({str(inside)!r}))
        out = {{}}
        def tryit(name, fn):
            try:
                fn()
                out[name] = "done"
            except PermissionError:
                out[name] = "refused"
            except Exception as exc:
                out[name] = type(exc).__name__
        tryit("write_inside", lambda: open({str(inside / "a.txt")!r}, "w").write("x"))
        tryit("write_outside", lambda: open({str(outside / "b.txt")!r}, "w").write("x"))
        tryit("append_outside", lambda: open({str(outside / "kept.txt")!r}, "a").write("x"))
        tryit("os_open_outside", lambda: os.open({str(outside / "c.txt")!r}, os.O_WRONLY | os.O_CREAT))
        tryit("read_outside", lambda: open({str(outside / "kept.txt")!r}).read())
        tryit("remove_outside", lambda: os.remove({str(outside / "kept.txt")!r}))
        tryit("rename_out", lambda: os.rename({str(inside / "a.txt")!r}, {str(outside / "a.txt")!r}))
        tryit("socket", lambda: socket.create_connection(("127.0.0.1", 9), timeout=1))
        tryit("dns", lambda: socket.getaddrinfo("example.com", 80))
        tryit("child", lambda: subprocess.run(["true"], check=False))
        out["stopped"] = len(box.stopped())
        print("WALLS " + json.dumps(out))
    ''')
    proc = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True, timeout=60)
    walls = {}
    for line in proc.stdout.splitlines():
        if line.startswith("WALLS "):
            walls = json.loads(line[6:])
    check("a write inside the sandbox directory is let through, and reading anywhere still works",
          walls.get("write_inside") == "done" and walls.get("read_outside") == "done",
          walls or proc.stderr[-800:])
    check("a write, an append, an os.open, a removal or a rename OUT of the sandbox directory is "
          "refused",
          all(walls.get(k) == "refused" for k in ("write_outside", "append_outside",
                                                  "os_open_outside", "remove_outside",
                                                  "rename_out")), walls)
    check("no socket, no name lookup and no child process leave the worker",
          all(walls.get(k) == "refused" for k in ("socket", "dns", "child")), walls)
    # a socket's own name lookup and the lookup tried alone are one refusal, written once
    check("every refusal is written down for the worker's answer", walls.get("stopped", 0) >= 7,
          walls)
    check("and the file outside is exactly as it was",
          (outside / "kept.txt").read_text(encoding="utf-8") == "kept"
          and not (outside / "b.txt").exists() and not (outside / "c.txt").exists())


# ═══════════════════════════════════════════════════════════════════════════
# THE LANE — the whole rehearsal against a real database, with a real estate that is watched
# ═══════════════════════════════════════════════════════════════════════════

LANE = '''
import json, os, sys, tempfile, time, subprocess, textwrap
from datetime import datetime, timedelta, timezone
from pathlib import Path
sys.path.insert(0, LANE_DIR)
import psycopg2, psycopg2.extras

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
import lane_schema
# every schema of the run is held from here: the sandbox and the refused ones too, never made by this file
ROOMS = lane_schema.Rooms(DSN, "shift-rehearsal")
RUN = ROOMS.run
REAL, SBX, FOREIGN, NEWBOX = (ROOMS.name(r) for r in ("real", "sbx", "foreign", "newbox"))
ROOT = Path(tempfile.mkdtemp(prefix="rehearsal-root-"))
REAL_INBOX = Path(tempfile.mkdtemp(prefix="real-inbox-"))
REAL_MOCK = Path(tempfile.mkdtemp(prefix="real-mock-"))
PEOPLE = Path(tempfile.mkdtemp(prefix="real-people-")) / "people.json"
OUTSIDE = Path(tempfile.gettempdir()) / f"rh-outside-{RUN}.txt"
# the real estate's files: the ear's inbox, the mockup rows and the people roster
os.environ["HUB_QUO_INBOX_DIR"] = str(REAL_INBOX)
os.environ["HUB_WEB_MOCK_DIR"] = str(REAL_MOCK)
os.environ["HUB_SMS_EARS_PEOPLE"] = str(PEOPLE)
# this run's estate is its own schema: the container's asa-hub-db (where Time Off's records live once it is Python's)
# is never reached, so its lanes read the run's own house
os.environ.pop("HUB_HOUSE_MEDS_DSN", None)

import house_cal_live, open_shift_covered, shift_handoff
import shift_requests as sr
import shift_rehearsal as rh
import sms_ears
import calendar_builder_houses as cbh
import effective_roster
import psi_reminders

OUT = {}
LOC = "CAN - 48TH (B) - ABD1711"
OTHER = "CAN - JH - ABD2704"
GHOST = "Copy of CALENDAR"
DRIVER = "Driver Fixture"
today = datetime.now(sr.OHIO).date()
D1 = (today + timedelta(days=1)).isoformat()
D2 = (today + timedelta(days=2)).isoformat()
D3 = (today + timedelta(days=3)).isoformat()
D4 = (today + timedelta(days=4)).isoformat()
OLD = (today - timedelta(days=3)).isoformat()
ANN, BEN, CY, DEE = "Ann Roe", "Ben Left", "Cy Far", "Dee Way"
# the director on the settings list, on no grid; a one-word name with a phone; a giver; and a
# regular of the house with no phone anywhere
DORA, ZED, GIL, UMA = "Dora Desk", "Zed", "Gil Giver", "Uma Nophone"
PHONES = {"3305550101": ANN, "3305550102": BEN, "3305550103": CY, "3305550104": DEE,
          "3305550105": DORA, "3305550106": ZED, "3305550107": GIL}
PEOPLE.write_text(json.dumps({"rows": [{"name": n, "phone": d} for d, n in PHONES.items()]}))
# the Time Off house the directors list is read from: this run's own, in the real estate's schema
TIME_OFF_ID = f"rh-time-off-{RUN}"
os.environ["HUB_TIME_OFF_HOUSE_ID"] = TIME_OFF_ID


def daytime_pin(now):
    """The latest New York noon at least half an hour ago: an instant outside the quiet window
    whatever hour this run starts at."""
    local = now.astimezone(sr.OHIO)
    noon = local.replace(hour=12, minute=0, second=0, microsecond=0)
    if noon > local - timedelta(minutes=30):
        noon -= timedelta(days=1)
    return noon.astimezone(timezone.utc)


def grid(rows, isos):
    return {"cols": [{"iso": i} for i in isos],
            "rows": [{"employee": e, "cells": [{"text": t} for t in cs]} for e, cs in rows]}


def conn_with(path):
    return psycopg2.connect(DSN + ("&" if "?" in DSN else "?") + "options=-csearch_path%3D"
                            + path.replace(",", "%2C"))


ROOMS.make("real")
T = ROOMS.path(REAL)
effective_roster.use_switch(lambda: {"on": True, "readable": True, "word": "on", "why": ""})


def real_state():
    """Every table of the real estate fingerprinted, and every file of its inbox and mockups."""
    out = {}
    with psycopg2.connect(DSN) as c, c.cursor() as cur:
        cur.execute("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                    "WHERE n.nspname=%s AND c.relkind='r' ORDER BY 1", (REAL,))
        for (t,) in cur.fetchall():
            cur.execute(f'SELECT count(*), md5(coalesce(string_agg(x::text, \\'|\\' ORDER BY '
                        f'x::text), \\'\\')) FROM "{REAL}"."{t}" x')
            out[t] = list(cur.fetchone())
        c.rollback()
    files = sorted(f"{p.name}:{p.stat().st_size}" for base in (REAL_INBOX, REAL_MOCK)
                   for p in base.rglob("*") if p.is_file())
    return {"tables": out, "files": files, "people": PEOPLE.read_text()}


TOUCHED = []
STOPPED = []


def watched(label, fn):
    before = real_state()
    try:
        got = fn()
    except rh.Refused as exc:
        got = {"outcome": "refused", "code": exc.code, "why": exc.why, "made": {}, "owed": [],
               "stopped": (exc.extra or {}).get("stopped") or []}
    except rh.Failed as exc:
        got = {"outcome": "failed", "code": "failed", "why": str(exc), "made": {}, "owed": []}
    if got.get("stopped"):
        STOPPED.append({"label": label, "stopped": got.get("stopped")})
    after = real_state()
    if before != after:
        diff = {k: [before["tables"].get(k), after["tables"].get(k)]
                for k in set(before["tables"]) | set(after["tables"])
                if before["tables"].get(k) != after["tables"].get(k)}
        TOUCHED.append({"label": label, "tables": diff,
                        "files": [before["files"], after["files"]]
                        if before["files"] != after["files"] else []})
    return got


# the driver's session as the relay hands it over: a reader above every house
DRIVER_WHO = {"name": DRIVER, "sees_reasons": True, "decides_everywhere": True, "decides": [],
              "manages": [], "badges": ["DIRECTOR"], "managers_readable": True}


def play(**kw):
    kw.setdefault("driver", DRIVER)
    kw.setdefault("run", "RUNONE")
    kw.setdefault("who", DRIVER_WHO)
    return watched(kw.get("act"), lambda: rh.answer(T, schema=SBX, root=ROOT, **kw))


def board(at=""):
    return watched("board", lambda: rh.board(T, who=DRIVER_WHO, at=at, schema=SBX, root=ROOT))


def said(row):
    return {k: row.get(k) for k in ("outcome", "code", "why")}


def sbx_rows(sql, args=()):
    with psycopg2.connect(DSN) as c, c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql.replace("{S}", SBX).replace("{R}", REAL), args)
        rows = [dict(r) for r in cur.fetchall()] if cur.description else []
        c.commit()
    return rows


def sbx_do(sql, args=()):
    with psycopg2.connect(DSN) as c, c.cursor() as cur:
        cur.execute(sql.replace("{S}", SBX).replace("{R}", REAL), args)
        c.commit()


def clock(at, minutes):
    return (datetime.fromisoformat(at) + timedelta(minutes=minutes)).isoformat()


try:
    # ── the real estate, every table created before anything reads it ──
    # the shift family's tables made in this run's own schema, and every table the shipped code
    # names proved to resolve there (or to a read-only mirror) before the first read
    OUT["owned"] = lane_schema.own_shift_lane(T, REAL, LANE_DIR, make=[cbh.PUBLISH_LOG_DDL])
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT current_schema()")
        assert cur.fetchone()[0] == REAL, "the real estate's schema is not first on its path"
        cur.execute(f"INSERT INTO {REAL}.asa_sms_reply_start (id, since) VALUES "
                    "(1, now() - interval '2 days')")
        # 48TH (B)'s worked-days record reaches back past the regulars' window, so an absence in it
        # is a verdict (not_a_regular) rather than a record too short to tell (regular_unknown)
        cur.execute(f"INSERT INTO {REAL}.asa_house_worked_days (person_key, location, day) "
                    "VALUES (%s, %s, %s)",
                    (sr.fold(ANN), LOC, today - timedelta(days=sr.OPEN_SHIFT_REGULAR_DAYS + 12)))
        # a table only the real estate has, and a function that writes it: the wall's targets
        cur.execute(f"CREATE TABLE {REAL}.rh_probe (a INT)")
        cur.execute(f"CREATE FUNCTION {REAL}.rh_probe_write() RETURNS int LANGUAGE sql AS "
                    f"'INSERT INTO {REAL}.rh_probe VALUES (7) RETURNING a'")
        # a real sequence and a real partitioned table: what a setval or a PARTITION OF would move
        cur.execute(f"CREATE SEQUENCE {REAL}.rh_probe_seq")
        cur.execute(f"CREATE TABLE {REAL}.rh_parted (a INT) PARTITION BY LIST (a)")
        # a real table holding one row, and a real index: what a TRUNCATE list or a DROP would reach
        cur.execute(f"CREATE TABLE {REAL}.rh_keep (a INT)")
        cur.execute(f"INSERT INTO {REAL}.rh_keep VALUES (1)")
        cur.execute(f"CREATE INDEX rh_keep_idx ON {REAL}.rh_keep (a)")
        # this run's Time Off house has no mirrored rows; its Settings row naming the one director
        # stands in the house's own overlay, which the house reads on top of its mirror
        cur.execute(f"INSERT INTO {REAL}.asa_time_off_writes (tab, id, row, row_number) "
                    "VALUES ('settings', 'directors', %s, 2)",
                    (psycopg2.extras.Json({"key": "directors", "value": DORA}),))
        # Ann, Ben and Cy are regulars of 48TH (B); Cy works at JH on D1 and Dee has never worked
        # at 48TH. Ann holds the D3 shift the rehearsed swap is offered from, and Dee holds the
        # D3 shift of JH a REAL swap is offered from below. Gil gives his D2 evening away; Zed
        # (one word, a phone) and Uma (no phone anywhere) are regulars who could take it. JH's
        # D2 open shift is the one a text is played on at a daytime clock.
        GRIDS = {
            LOC: grid([("OPEN", ["", "8A-4P", "", "", "8A-4P"]),
                       (ANN, ["8A-4P", "", "", "8A-4P", ""]),
                       (BEN, ["8A-4P", "", "", "", ""]),
                       (CY, ["8A-4P", "", "8A-4P", "", ""]),
                       (GIL, ["8A-4P", "", "4P-10P", "", ""]),
                       (ZED, ["8A-4P", "", "", "", ""]),
                       (UMA, ["8A-4P", "", "", "", ""])], [OLD, D1, D2, D3, D4]),
            OTHER: grid([("OPEN", ["", "", "8A-4P", ""]),
                         (CY, ["", "10A-6P", "", ""]),
                         (DEE, ["8A-4P", "", "", "8A-4P"])], [OLD, D1, D2, D3]),
        }
        for loc, g in GRIDS.items():
            cur.execute(f"INSERT INTO {REAL}.asa_house_calendar_live (location, grid) VALUES (%s,%s)",
                        (loc, psycopg2.extras.Json(g)))
        c.commit()
    sr.forget_estate()
    sr.sweep(T)
    now = datetime.now(timezone.utc)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(f"UPDATE {REAL}.asa_shift_pool SET opened_at=%s", (now,))
        cur.execute(f"INSERT INTO {REAL}.asa_shift_pool (location, open_row, col_iso, kind, value, "
                    "opened_at, shift_start, shift_end, called_off_by, ref) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (GHOST, "OPEN", D1, sr.KIND_OPEN, "8A-4P", now, None, None, "",
                     sr.ref_of(GHOST, "OPEN", D1)))
        cur.execute(f"INSERT INTO {REAL}.asa_shift_pool (location, open_row, col_iso, kind, value, "
                    "opened_at, shift_start, shift_end, called_off_by, ref) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (LOC, CY, D2, sr.KIND_CALLOFF, "8A-4P", now,
                     sr.span_of(D2, "8A-4P")[0], sr.span_of(D2, "8A-4P")[1], CY,
                     sr.ref_of(LOC, CY, D2)))
        # the live estate's shape: D4's reserved minutes ran out two hours ago, and JH's
        # call-off is eight hours old
        cur.execute(f"UPDATE {REAL}.asa_shift_pool SET opened_at = %s, shift_start=%s, shift_end=%s "
                    "WHERE location=%s AND open_row='OPEN' AND col_iso=%s",
                    (now - timedelta(hours=2), sr.span_of(D4, "8A-4P")[0],
                     sr.span_of(D4, "8A-4P")[1], LOC, D4))
        cur.execute(f"INSERT INTO {REAL}.asa_shift_pool (location, open_row, col_iso, kind, value, "
                    "opened_at, shift_start, shift_end, called_off_by, ref) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (OTHER, CY, D1, sr.KIND_CALLOFF, "10A-6P", now - timedelta(hours=8),
                     sr.span_of(D1, "10A-6P")[0], sr.span_of(D1, "10A-6P")[1], CY,
                     sr.ref_of(OTHER, CY, D1)))
        # T1: JH's D2 open shift was published at a daytime instant, so the text played on it
        # is played at a clock outside the quiet window whatever hour this run starts at
        PIN = daytime_pin(now)
        cur.execute(f"UPDATE {REAL}.asa_shift_pool SET opened_at=%s, shift_start=%s, shift_end=%s "
                    "WHERE location=%s AND open_row='OPEN' AND col_iso=%s",
                    (PIN, sr.span_of(D2, "8A-4P")[0], sr.span_of(D2, "8A-4P")[1], OTHER, D2))
        c.commit()
    sr.forget_estate()
    # A REAL SWAP between two real people, on the real estate before the sandbox copies it
    real_swap = shift_handoff.offer(T, location=OTHER, col_iso=D3, from_staff=DEE, to_staff=CY,
                                    offered_by=DEE, created_by=DEE)
    REAL_HID = str(real_swap.get("id") or "")
    OUT["real_swap_directors"] = shift_handoff.director_names(real_swap)
    # the house-day index the swaps lane retires, standing in the REAL estate after this process
    # retired its own: the sandbox's retirement must drop only the sandbox's, never this one
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(f"CREATE INDEX asa_shift_handoffs_open ON {REAL}.asa_shift_handoffs "
                    "(location, col_iso) WHERE state = 'pending'")
        c.commit()
    pool = {(s["location"], s["open_row"], s["col_iso"]): s for s in sr.pool(T)}
    OPEN_REF, OPEN_AT = pool[(LOC, "OPEN", D1)]["ref"], pool[(LOC, "OPEN", D1)]["window"]["opens_at"]
    CALLOFF_REF = pool[(LOC, CY, D2)]["ref"]
    CALLOFF_AT = pool[(LOC, CY, D2)]["window"]["opens_at"]
    GHOST_REF = pool[(GHOST, "OPEN", D1)]["ref"]
    AGED_REF, AGED_AT = pool[(LOC, "OPEN", D4)]["ref"], pool[(LOC, "OPEN", D4)]["window"]["opens_at"]
    AGED_CALLOFF_REF = pool[(OTHER, CY, D1)]["ref"]
    AGED_CALLOFF_AT = pool[(OTHER, CY, D1)]["window"]["opens_at"]
    PIN_REF, PIN_AT = pool[(OTHER, "OPEN", D2)]["ref"], pool[(OTHER, "OPEN", D2)]["window"]["opens_at"]
    OUT["aged_windows"] = [pool[(LOC, "OPEN", D4)]["window"]["state"],
                           pool[(OTHER, CY, D1)]["window"]["state"]]
    OUT["d3"] = D3
    OUT["days"] = {"OLD": OLD, "D2": D2, "D3": D3, "today": today.isoformat()}
    shift_handoff.note_dial("send", "off")
    REAL_OWED = {"shift": sorted(o["id"] for o in sr.owed(T)),
                 "swap": sorted(o["id"] for o in shift_handoff.owed(T)),
                 "text": sorted(o["id"] for o in sms_ears.owed(T)),
                 "follow": sorted(o["id"] for o in open_shift_covered.owed(T))}

    def said_keys():
        """Every idempotency key the real estate's message lanes keep: what each says it said."""
        out = {}
        for table, key in (("asa_shift_pool", "location || '|' || open_row || '|' || col_iso"),
                           ("asa_shift_handoffs", "id"), ("asa_sms_replies", "id")):
            rows = sbx_rows(f"SELECT {key} AS k, said FROM {{R}}.{table} ORDER BY 1")
            out[table] = [[str(r["k"]), r["said"]] for r in rows]
        return out

    # one key a rehearsal could strip: the leftover tab's notice, already said on the real estate
    sbx_do("UPDATE {R}.asa_shift_pool SET said = %s::jsonb WHERE location=%s",
           (json.dumps({sr.KIND_APPLICANTS: "said on the real estate"}), GHOST))
    SAID_BEFORE = said_keys()

    # ── 1 the board fills the sandbox with a copy of the estate ──
    b = board()
    OUT["board_ok"] = "houses" in b
    OUT["board"] = {k: b.get(k) for k in ("not_houses", "textable", "stopped")}
    OUT["board_houses"] = sorted(h["location"] for h in b.get("houses") or [])
    OUT["board_people_here"] = (b.get("people") or {}).get(LOC)
    OUT["sandbox"] = b.get("sandbox")
    OUT["board_error"] = b.get("why") if not OUT["board_ok"] else ""
    OUT["sbx_copied_pool"] = len(sbx_rows("SELECT 1 FROM {S}.asa_shift_pool"))
    OUT["sbx_copied_swap"] = [r["id"] for r in sbx_rows("SELECT id FROM {S}.asa_shift_handoffs")]
    OUT["real_hid"] = REAL_HID
    OUT["board_readable"] = [b.get("textable_readable"), b.get("textable_why")]
    # V1-d: the directories the sealed worker made hold real staff numbers — the owner's alone
    OUT["sbx_dir_modes"] = {sub: oct((ROOT / sub).stat().st_mode & 0o777)
                            for sub in ("inbox", "out", "out/comm-mock-web", "tmp")}
    # V2-superuser-role: the board names the role the worker connects as
    OUT["board_role"] = (b.get("sandbox") or {}).get("role")
    # V2-offer-picker: a swap offers the giver's own shifts still ahead, never the pool's
    OUT["board_giveable"] = (b.get("giveable") or {}).get(LOC)

    # ── 1b M-B: a contact index nobody could read is said, never drawn as nobody's number ──
    kept_people = PEOPLE.read_text()
    PEOPLE.write_text("{ this is not json")
    try:
        blind = board()
        OUT["blind_board"] = [blind.get("textable_readable"), blind.get("textable"),
                              blind.get("textable_why")]
        OUT["blind_text"] = said(play(door="text", act="apply", ref=OPEN_REF, person=ANN))
    finally:
        PEOPLE.write_text(kept_people)

    # ── 1c L4: a board never reads while an answer or a reset holds the sandbox ──
    import re as _re
    ns = int(_re.search(r"ACT_LOCK_NS = box\\.LOCK_SHIFT \\+ (\\d+)",
                        open(os.path.join(LANE_DIR, "shift_rehearsal_acts.py")).read()).group(1))
    import rehearsal_sandbox as _box
    holder = psycopg2.connect(DSN)
    holder.autocommit = True
    with holder.cursor() as cur:
        cur.execute("SELECT pg_advisory_lock(%s, hashtext(%s))", (_box.LOCK_SHIFT + ns, SBX))
    os.environ["HUB_SHIFT_REHEARSAL_WAIT_S"] = "1"
    try:
        locked = board()
        OUT["board_while_held"] = [locked.get("outcome"), locked.get("code")]
    finally:
        os.environ.pop("HUB_SHIFT_REHEARSAL_WAIT_S", None)
        holder.close()
    OUT["board_after_release"] = "houses" in board()

    # ── 2 applications, through the app and through the ear ──
    one = play(door="app", act="apply", ref=OPEN_REF, person=ANN)
    OUT["apply_in_window"] = said(one)
    two = play(door="text", act="apply", ref=OPEN_REF, person=BEN)
    OUT["apply_by_text"] = said(two)
    OUT["apply_by_text_lanes"] = {k: (two.get("lanes") or {}).get(k) for k in ("door", "text_id",
                                                                               "request", "ack")}
    OUT["apply_by_text_owed"] = [(o["lane"], o["to"], o["kind"]) for o in two.get("owed") or []]
    OUT["sbx_requests"] = [(r["person"], r["kind"], r["via"],
                            bool((r["extra"] or {}).get("rehearsal")), sr.is_rehearsed(r))
                           for r in sbx_rows("SELECT * FROM {S}.asa_shift_requests "
                                             "WHERE col_iso=%s ORDER BY person, kind", (D1,))]
    OUT["sbx_ear"] = [(r["id"][:3], r["person"], r["outcome"], bool(r["ack"]), r["rehearsal"])
                      for r in sbx_rows("SELECT * FROM {S}.asa_sms_replies")]
    OUT["sbx_inbox_lines"] = sum(len(p.read_text().splitlines())
                                 for p in (ROOT / "inbox").glob("*.jsonl"))
    # T1: whatever the hour, the lanes were asked at the instant a message could go — the answer's
    # own hour, or the end of the quiet window when it fell inside it
    OUT["apply_by_text_when"] = sorted({str(o.get("when") or "") for o in two.get("owed") or []})
    OUT["apply_by_text_expected_when"] = (
        psi_reminders.quiet_ends(datetime.fromisoformat(two["at"])).isoformat()
        if two.get("at") else "")
    # …and a text played at a daytime clock owes its acknowledgement at that clock
    pinned = play(door="text", act="apply", ref=PIN_REF, person=DEE, at=clock(PIN_AT, 1))
    OUT["pinned_text"] = said(pinned)
    OUT["pinned_quiet"] = psi_reminders.quiet(datetime.fromisoformat(clock(PIN_AT, 1)))
    OUT["pinned_text_owed"] = [(o["lane"], o["to"], o["kind"], o.get("when"))
                               for o in pinned.get("owed") or []]
    OUT["pinned_clock"] = (pinned.get("lanes") or {}).get("clock")
    OUT["sbx_ear_pinned"] = [(r["person"], r["outcome"], bool(r["ack"]), r["rehearsal"])
                             for r in sbx_rows("SELECT * FROM {S}.asa_sms_replies WHERE person=%s",
                                               (DEE,))]
    # V1-a: a ref handed in with the request, shaped as a time off request's, on a cell that has
    # no pool row, is never texted — the ear never hears it, so no road but the shift's is reached
    lines_before = sum(len(p.read_text().splitlines()) for p in (ROOT / "inbox").glob("*.jsonl"))
    foreign = play(door="text", act="apply", location=LOC, open_row="OPEN", col_iso=D2,
                   ref="TO0000FACE01", person=ANN)
    OUT["text_foreign_ref"] = said(foreign)
    OUT["text_foreign_ref_said"] = [foreign.get("said") or "", foreign.get("ref") or ""]
    OUT["text_foreign_ref_ear"] = [r["id"] for r in sbx_rows(
        "SELECT id FROM {S}.asa_sms_replies WHERE ref=%s OR road=%s",
        ("TO0000FACE01", sms_ears.ROAD_TIME_OFF))]
    OUT["text_foreign_ref_lines"] = [lines_before, sum(
        len(p.read_text().splitlines()) for p in (ROOT / "inbox").glob("*.jsonl"))]
    OUT["overlap"] = said(play(door="app", act="apply", ref=OPEN_REF, person=CY))
    OUT["own_call_off"] = said(play(door="app", act="apply", ref=CALLOFF_REF, person=CY))
    OUT["outsider"] = said(play(door="app", act="apply", ref=OPEN_REF, person=DEE))
    OUT["phantom"] = said(play(door="app", act="apply", ref=GHOST_REF, person=ANN))
    OUT["call_off_in_window"] = said(play(door="app", act="apply", ref=CALLOFF_REF, person=ANN))
    OUT["call_off_after_window"] = said(play(door="app", act="apply", ref=CALLOFF_REF, person=BEN,
                                             at=clock(CALLOFF_AT, 360)))
    OUT["after_window"] = said(play(door="app", act="apply", ref=OPEN_REF, person=CY,
                                    at=clock(OPEN_AT, 180)))

    # ── 3 the rehearsed clock, on windows that closed before this run began ──
    OUT["aged_no_clock"] = said(play(door="app", act="apply", ref=AGED_REF, person=BEN))
    OUT["aged_bad_clock"] = said(play(door="app", act="apply", ref=AGED_REF, person=BEN,
                                      at=clock(AGED_AT, -600)))
    OUT["aged_not_a_clock"] = said(play(door="app", act="apply", ref=AGED_REF, person=BEN,
                                        at="whenever"))
    OUT["ten_minutes_ben"] = said(play(door="app", act="apply", ref=AGED_REF, person=BEN,
                                       at=clock(AGED_AT, 1)))
    OUT["ten_minutes_cy"] = said(play(door="app", act="apply", ref=AGED_REF, person=CY,
                                      at=clock(AGED_AT, 2)))
    OUT["ten_minutes_outsider"] = said(play(door="app", act="apply", ref=AGED_REF, person=DEE,
                                            at=clock(AGED_AT, 3)))
    OUT["five_hours"] = said(play(door="app", act="apply", ref=AGED_CALLOFF_REF, person=DEE,
                                  at=clock(AGED_CALLOFF_AT, 60)))
    OUT["five_hours_gone"] = said(play(door="app", act="apply", ref=AGED_CALLOFF_REF, person=ANN,
                                       at=clock(AGED_CALLOFF_AT, 400)))
    # the notice a closed window owes the house manager: owed INSIDE the sandbox, never outside it
    OUT["sbx_owes_notice"] = any(o["lane"] == "shift" and o["about"].endswith("8A-4P")
                                 and D4 in o["about"] for o in board().get("owed") or [])

    # ── 4 the withdrawal, and the rows the sandbox copied from the estate ──
    cy_d4 = sbx_rows("SELECT id FROM {S}.asa_shift_requests WHERE col_iso=%s AND person=%s "
                     "AND state = ANY(%s)", (D4, CY, list(sr.LIVE_STATES)))
    CY_D4 = str((cy_d4 or [{}])[0].get("id") or "")
    # a row as the copy of the estate would carry it: nobody here made it
    sbx_do("INSERT INTO {S}.asa_shift_requests (id, kind, location, open_row, col_iso, value, "
           "person, state, via) VALUES ('SRREAL0001',%s,%s,%s,%s,'8A-4P',%s,%s,'app')",
           (sr.KIND_OPEN, LOC, "OPEN", D4, DEE, sr.APPLIED))
    OUT["withdraw_real"] = said(play(door="app", act="withdraw", request_id="SRREAL0001"))
    OUT["withdraw_by_text"] = said(play(door="text", act="withdraw", request_id=CY_D4))
    OUT["decide_with_a_real_one"] = said(play(door="app", act="decide", ref=AGED_REF, person=BEN,
                                              at=clock(AGED_AT, 30)))
    sbx_do("DELETE FROM {S}.asa_shift_requests WHERE id='SRREAL0001'")
    OUT["withdraw_rehearsed"] = said(play(door="app", act="withdraw", request_id=CY_D4))
    play(door="app", act="apply", ref=AGED_REF, person=CY, at=clock(AGED_AT, 4))
    sbx_do("INSERT INTO {S}.asa_shift_requests (id, kind, location, open_row, col_iso, value, "
           "person, state, via, ref) VALUES ('SRREALIST1',%s,%s,%s,%s,'8A-4P',%s,%s,'app',%s)",
           (sr.KIND_IST, LOC, "OPEN", D4, DEE, sr.NEEDS_TRAINING, sr.KIND_OPEN))
    OUT["decide_over_a_real_training"] = said(play(door="app", act="decide", ref=AGED_REF,
                                                   person=BEN, at=clock(AGED_AT, 30)))
    sbx_do("DELETE FROM {S}.asa_shift_requests WHERE id='SRREALIST1'")

    # ── 5 the decisions, played at a clock after the window closed ──
    # the rehearsed applicants' training is taken as settled, inside the sandbox and only for
    # the rows the rehearsal made, so the decision itself is what is played
    MARKED = "(via LIKE 'rehearsal:%%' OR extra ? 'rehearsal')"
    sbx_do("UPDATE {S}.asa_shift_requests SET state=%s WHERE state=%s AND " + MARKED,
           (sr.APPLIED, sr.NEEDS_TRAINING))
    sbx_do("UPDATE {S}.asa_shift_requests SET state=%s WHERE kind=%s AND state=%s AND " + MARKED,
           (sr.APPROVED, sr.KIND_IST, sr.APPLIED))
    # L4: a decision is played AS somebody, weighed as the real door weighs them — a regular of
    # the house decides nothing, and taking a shift for oneself is the lane's own answer
    OUT["decide_as_a_regular"] = said(play(door="app", act="decide", ref=OPEN_REF, person=ANN,
                                           decider=CY, at=clock(OPEN_AT, 180)))
    OUT["assign_as_a_regular"] = said(play(door="app", act="take", ref=CALLOFF_REF, person=BEN,
                                           decider=CY, at=clock(CALLOFF_AT, 360)))
    OUT["take_for_oneself"] = said(play(door="app", act="take", ref=CALLOFF_REF, person=BEN,
                                        decider=BEN, at=clock(CALLOFF_AT, 360)))
    OUT["decided_nothing"] = [r["filled_by"] for r in sbx_rows(
        "SELECT filled_by FROM {S}.asa_shift_pool WHERE ref = ANY(%s)", ([OPEN_REF, CALLOFF_REF],))]
    decided = play(door="app", act="decide", ref=OPEN_REF, person=ANN, at=clock(OPEN_AT, 180),
                   decider=DRIVER)
    OUT["decided_as"] = (decided.get("lanes") or {}).get("decided_as")
    OUT["decision"] = said(decided)
    OUT["after_decision"] = [(r["person"], r["state"]) for r in sbx_rows(
        "SELECT person, state FROM {S}.asa_shift_requests WHERE kind=%s AND col_iso=%s "
        "ORDER BY person", (sr.KIND_OPEN, D1))]
    OUT["sbx_pool_d1"] = [r["filled_by"] for r in sbx_rows(
        "SELECT filled_by FROM {S}.asa_shift_pool WHERE location=%s AND open_row='OPEN' "
        "AND col_iso=%s", (LOC, D1))]
    OUT["sbx_cells_held"] = [(r["stage"], r["employee"]) for r in sbx_rows(
        "SELECT stage, employee FROM {S}.asa_house_calendar_edits WHERE location=%s ORDER BY id",
        (LOC,))]
    OUT["assignment"] = said(play(door="app", act="take", ref=CALLOFF_REF, person=BEN,
                                  at=clock(CALLOFF_AT, 360)))
    OUT["aged_decision"] = said(play(door="app", act="decide", ref=AGED_REF, person=BEN,
                                     at=clock(AGED_AT, 30)))
    OUT["aged_after_decision"] = sorted((r["person"], r["state"]) for r in sbx_rows(
        "SELECT person, state FROM {S}.asa_shift_requests WHERE kind=%s AND col_iso=%s "
        "AND state = ANY(%s)", (sr.KIND_OPEN, D4, [sr.APPROVED, sr.NOT_CHOSEN])))

    # ── 6 the swap: offered, accepted by text, approved — and completed inside the sandbox ──
    swap = play(door="app", act="offer_swap", location=LOC, col_iso=D3, person=ANN, to_staff=BEN)
    OUT["swap_offer"] = said(swap)
    HID = str(swap.get("ref") or "")
    OUT["swap_offer_owed"] = sorted({o["kind"] for o in swap.get("owed") or []
                                     if o["lane"] == "swap"})
    OUT["swap_accept_by_text"] = said(play(door="text", act="swap_accept", handoff_id=HID,
                                           word="yes"))
    OUT["swap_row_mid"] = [(r["staff_state"], r["staff_via"], r["manager_state"], r["state"])
                           for r in sbx_rows("SELECT * FROM {S}.asa_shift_handoffs WHERE id=%s",
                                             (HID,))]
    # M-A: the approver is a fixture of THIS sandbox row — a house manager on no grid at all — so
    # the approval is weighed against a name this run owns, never against the estate's own book
    HM = "Hana Fixture"
    sbx_do("UPDATE {S}.asa_shift_handoffs SET approvers=%s::jsonb, house_manager=%s, "
           "approval='house_manager', approval_why=%s WHERE id=%s",
           (json.dumps([HM]), HM, f"the house manager {HM} approves", HID))
    swap_board = board()
    OUT["swap_board_approvers"] = next((s.get("approvers") for s in swap_board.get("swaps") or []
                                        if s.get("id") == HID), None)
    OUT["swap_board_directors"] = next(([s.get("directors"), s.get("director_state")]
                                        for s in swap_board.get("swaps") or []
                                        if s.get("id") == HID), None)
    OUT["swap_by_a_regular"] = said(play(door="app", act="swap_approve", handoff_id=HID,
                                         person=CY, word="yes"))
    OUT["swap_by_the_receiver"] = said(play(door="app", act="swap_approve", handoff_id=HID,
                                            person=BEN, word="yes"))
    OUT["swap_row_untouched"] = [(r["manager_state"], r["state"]) for r in sbx_rows(
        "SELECT * FROM {S}.asa_shift_handoffs WHERE id=%s", (HID,))]
    # REH-1: the third consent is the director's, from the settings list, never a badge
    OUT["director_by_a_regular"] = said(play(door="app", act="swap_director", handoff_id=HID,
                                             person=CY, word="yes"))
    OUT["director_by_the_hm"] = said(play(door="app", act="swap_director", handoff_id=HID,
                                          person=HM, word="yes"))
    OUT["director_by_the_driver"] = said(play(door="app", act="swap_director", handoff_id=HID,
                                              person=DRIVER, word="yes"))
    OUT["director_untouched"] = [(r["director_state"], r["manager_state"], r["state"])
                                 for r in sbx_rows("SELECT * FROM {S}.asa_shift_handoffs "
                                                   "WHERE id=%s", (HID,))]
    OUT["director_app"] = said(play(door="app", act="swap_director", handoff_id=HID, person=DORA,
                                    word="yes"))
    OUT["director_row"] = [(r["director_state"], r["director_via"], r["director_by"],
                            r["manager_state"], r["state"])
                           for r in sbx_rows("SELECT * FROM {S}.asa_shift_handoffs WHERE id=%s",
                                             (HID,))]
    OUT["swap_second_consent"] = said(play(door="app", act="swap_approve", handoff_id=HID,
                                           person=HM, word="yes"))
    OUT["swap_row_end"] = [(r["staff_state"], r["manager_state"], r["director_state"], r["state"])
                           for r in sbx_rows("SELECT * FROM {S}.asa_shift_handoffs WHERE id=%s",
                                             (HID,))]
    OUT["sbx_d3_cells"] = sorted((r["employee"], r["new_value"]) for r in sbx_rows(
        "SELECT employee, new_value FROM {S}.asa_house_calendar_edits WHERE location=%s "
        "AND col_iso=%s AND undone_at IS NULL", (LOC, D3)))
    OUT["sbx_d3_vias"] = sorted({r["via"] for r in sbx_rows(
        "SELECT via FROM {S}.asa_house_calendar_edits WHERE location=%s AND col_iso=%s", (LOC, D3))})
    OUT["real_swap_app"] = said(play(door="app", act="swap_accept", handoff_id=REAL_HID, word="yes"))
    OUT["real_swap_text"] = said(play(door="text", act="swap_accept", handoff_id=REAL_HID,
                                      word="yes"))
    OUT["real_swap_manager"] = said(play(door="app", act="swap_approve", handoff_id=REAL_HID,
                                         person=ANN, word="yes"))
    OUT["real_swap_director"] = said(play(door="app", act="swap_director", handoff_id=REAL_HID,
                                          person=DORA, word="yes"))
    OUT["real_swap_director_text"] = said(play(door="text", act="swap_director",
                                               handoff_id=REAL_HID, person=DORA, word="yes"))
    OUT["sbx_real_swap_row"] = [(r["staff_state"], r["staff_via"], r["manager_state"],
                                 r["director_state"])
                                for r in sbx_rows("SELECT * FROM {S}.asa_shift_handoffs WHERE id=%s",
                                                  (REAL_HID,))]

    # ── 6b N1: the offer goes through the real door with the reachable set the real route hands it ──
    OUT["offer_no_phone"] = said(play(door="app", act="offer_swap", location=LOC, col_iso=D2,
                                      person=GIL, to_staff=UMA))
    second = play(door="app", act="offer_swap", location=LOC, col_iso=D2, person=GIL, to_staff=ZED)
    OUT["offer_one_word"] = said(second)
    OUT["offer_one_word_lanes"] = {k: (second.get("lanes") or {}).get(k)
                                   for k in ("reachable_known", "directors")}
    HID2 = str(second.get("ref") or "")
    # a transfer the rehearsal made never offers a real hand a button, and the flag is what does it
    sbx_row2 = (sbx_rows("SELECT * FROM {S}.asa_shift_handoffs WHERE id=%s", (HID2,)) or [{}])[0]
    if sbx_row2:
        seen = shift_handoff.describe(sbx_row2, {"name": DORA})
        bare = shift_handoff.describe({**sbx_row2, "extra": {}}, {"name": DORA})
        OUT["describe_rehearsed"] = [seen.get("rehearsal"), seen.get("may_approve_director"),
                                     bare.get("rehearsal"), bare.get("may_approve_director")]
    else:
        OUT["describe_rehearsed"] = None
    # the director answers BY TEXT, from the number the ear knows, on no grid
    OUT["director_text"] = said(play(door="text", act="swap_director", handoff_id=HID2,
                                     person=DORA, word="yes"))
    OUT["director_text_row"] = [(r["director_state"], r["director_via"], r["director_by"])
                                for r in sbx_rows("SELECT * FROM {S}.asa_shift_handoffs "
                                                  "WHERE id=%s", (HID2,))]
    # the lane's own guard, asked directly: a real answer on a rehearsed transfer, and a
    # rehearsed answer on a real one, are each refused before anything is written
    SBX_T = (DSN + ("&" if "?" in DSN else "?") + "options=-csearch_path%3D" + SBX + "%2C" + REAL
             + "%2Cpublic")
    try:
        shift_handoff.answer(SBX_T, HID2, side="manager", word="yes", by="Somebody Real")
        OUT["real_answer_on_rehearsed"] = "answered"
    except shift_handoff.Refused as exc:
        OUT["real_answer_on_rehearsed"] = exc.code
    try:
        shift_handoff.answer(T, REAL_HID, side="director", word="yes", by=DORA,
                             rehearsal={"id": "REHPROBE"})
        OUT["rehearsed_answer_on_real"] = "answered"
    except shift_handoff.Refused as exc:
        OUT["rehearsed_answer_on_real"] = exc.code
    OUT["real_swap_row_after"] = [(r["staff_state"], r["manager_state"], r["director_state"],
                                   r["state"])
                                  for r in sbx_rows("SELECT * FROM {R}.asa_shift_handoffs "
                                                    "WHERE id=%s", (REAL_HID,))]

    # ── 6c EVERY ROW THE REHEARSAL WROTE CARRIES THE MARK, and it wrote some of each ──
    MARK_REQ = "(s.via LIKE 'rehearsal:%%' OR s.extra ? 'rehearsal')"
    OUT["unmarked"] = {
        "asa_shift_requests": [r["id"] for r in sbx_rows(
            "SELECT s.id FROM {S}.asa_shift_requests s WHERE NOT EXISTS (SELECT 1 FROM "
            "{R}.asa_shift_requests r WHERE r.id = s.id) AND NOT " + MARK_REQ)],
        "asa_shift_handoffs": [r["id"] for r in sbx_rows(
            "SELECT s.id FROM {S}.asa_shift_handoffs s WHERE NOT EXISTS (SELECT 1 FROM "
            "{R}.asa_shift_handoffs r WHERE r.id = s.id) AND NOT (s.extra ? 'rehearsal')")],
        "asa_house_calendar_edits": [r["id"] for r in sbx_rows(
            "SELECT s.id FROM {S}.asa_house_calendar_edits s WHERE NOT EXISTS (SELECT 1 FROM "
            "{R}.asa_house_calendar_edits r WHERE r.id = s.id) AND s.via NOT LIKE 'rehearsal:%%'")],
        "asa_house_calendar_claims": [[r["open_row"], r["col_iso"], r["claimed_via"]] for r in sbx_rows(
            "SELECT s.* FROM {S}.asa_house_calendar_claims s WHERE NOT EXISTS (SELECT 1 FROM "
            "{R}.asa_house_calendar_claims r WHERE (r.location, r.open_row, r.col_iso) = "
            "(s.location, s.open_row, s.col_iso)) AND s.claimed_via NOT LIKE 'rehearsal:%%'")],
        "asa_sms_replies": [r["id"] for r in sbx_rows(
            "SELECT id FROM {S}.asa_sms_replies WHERE NOT rehearsal")],
        "asa_shift_pool": [[r["open_row"], r["col_iso"], r["filled_how"]] for r in sbx_rows(
            "SELECT s.* FROM {S}.asa_shift_pool s JOIN {R}.asa_shift_pool r USING "
            "(location, open_row, col_iso) WHERE s.filled_by <> '' AND r.filled_by = '' "
            "AND s.filled_how NOT LIKE 'rehearsal:%%'")],
    }
    OUT["made_marked"] = {
        "requests": len(sbx_rows("SELECT 1 FROM {S}.asa_shift_requests s WHERE " + MARK_REQ)),
        "handoffs": len(sbx_rows("SELECT 1 FROM {S}.asa_shift_handoffs WHERE extra ? 'rehearsal'")),
        "edits": len(sbx_rows("SELECT 1 FROM {S}.asa_house_calendar_edits "
                              "WHERE via LIKE 'rehearsal:%%'")),
        "claims": len(sbx_rows("SELECT 1 FROM {S}.asa_house_calendar_claims "
                               "WHERE claimed_via LIKE 'rehearsal:%%'")),
        "replies": len(sbx_rows("SELECT 1 FROM {S}.asa_sms_replies WHERE rehearsal")),
        "pool": len(sbx_rows("SELECT 1 FROM {S}.asa_shift_pool WHERE filled_how LIKE 'rehearsal:%%'")),
    }
    # the follow-up net was never told about a rehearsed fill, inside the sandbox either
    OUT["covered_rows"] = [len(sbx_rows("SELECT 1 FROM {S}.asa_open_shift_covered")),
                           len(sbx_rows("SELECT 1 FROM {R}.asa_open_shift_covered"))]

    # ── 7 THE READERS THE REVIEW NAMED, asked on the real estate after all of that ──
    OUT["touched"] = TOUCHED
    # no real idempotency key was stripped, added or rewritten by anything the rehearsal played
    OUT["real_said_kept"] = [said_keys() == SAID_BEFORE,
                             sum(1 for rows in SAID_BEFORE.values() for _k, said in rows if said)]
    OUT["stopped_while_playing"] = list(STOPPED)
    OUT["real_owed_after"] = {"shift": sorted(o["id"] for o in sr.owed(T)),
                              "swap": sorted(o["id"] for o in shift_handoff.owed(T)),
                              "text": sorted(o["id"] for o in sms_ears.owed(T)),
                              "follow": sorted(o["id"] for o in open_shift_covered.owed(T))}
    OUT["real_owed_before"] = REAL_OWED
    OUT["real_inbound"] = psi_reminders.inbound(REAL_INBOX)
    # the second wall: the shift flow's reader ignores a rehearsed line even where one lies
    OUT["sbx_inbound"] = psi_reminders.inbound(ROOT / "inbox")
    with psycopg2.connect(T) as c, c.cursor() as cur:
        effective = effective_roster.published(cur, held=True)
    OUT["real_effective"] = [(e["employee"], e["col_iso"]) for e in effective]
    OUT["real_marked"] = {
        t: [r["n"] for r in sbx_rows(f"SELECT count(*) AS n FROM {{R}}.{t} WHERE {where}")][0]
        for t, where in (("asa_shift_requests", "via LIKE 'rehearsal:%%' OR extra ? 'rehearsal'"),
                         ("asa_shift_handoffs", "extra ? 'rehearsal'"),
                         ("asa_house_calendar_edits", "via LIKE 'rehearsal:%%'"),
                         ("asa_house_calendar_claims", "claimed_via LIKE 'rehearsal:%%'"),
                         ("asa_sms_replies", "rehearsal"))}
    OUT["real_rows"] = {t: [r["n"] for r in sbx_rows(f"SELECT count(*) AS n FROM {{R}}.{t}")][0]
                        for t in ("asa_house_calendar_claims", "asa_house_calendar_edits",
                                  "asa_sms_replies", "asa_open_shift_covered")}
    OUT["real_pool_d1"] = [r["filled_by"] for r in sbx_rows(
        "SELECT filled_by FROM {R}.asa_shift_pool WHERE location=%s AND open_row='OPEN' "
        "AND col_iso=%s", (LOC, D1))]
    OUT["real_waiting_on_ben"] = [h["id"] for h in shift_handoff.waiting_on(T, BEN)]
    OUT["real_waiting_on_dora"] = [h["id"] for h in shift_handoff.waiting_on(T, DORA)]
    # the real live grid: no square pending, held or played, after everything the sandbox did —
    # and the published cells are read ONCE for the pending, held and played marks together
    _published, _reads = effective_roster.published, []
    effective_roster.published = lambda *a, **k: (_reads.append(1), _published(*a, **k))[1]
    try:
        real_grid = house_cal_live.merged_grid(T, LOC) or {}
    finally:
        effective_roster.published = _published
    OUT["grid_published_reads"] = len(_reads)
    OUT["real_grid_flags"] = [[r.get("employee"), i] for r in real_grid.get("rows") or []
                              for i, c in enumerate(r.get("cells") or [])
                              if isinstance(c, dict)
                              and (c.get("pending") or c.get("test_mode") or c.get("rehearsal"))]
    # the swaps lane's retirement of its old index ran inside the sandbox and dropped only the
    # sandbox's: the real estate's index of that name is still there
    OUT["real_retired_index"] = [r["n"] for r in sbx_rows(
        "SELECT count(*) AS n FROM pg_indexes WHERE schemaname=%s AND indexname=%s",
        (REAL, "asa_shift_handoffs_open"))][0]
    # a real house publish finds nothing the rehearsal held
    effective_roster.use_switch(lambda: {"on": False, "readable": True, "word": "off", "why": ""})
    try:
        cbh.publish_held(T, location=LOC, actor="Somebody Real")
        OUT["real_publish"] = "published"
    except cbh.Refused as exc:
        OUT["real_publish"] = exc.code
    effective_roster.use_switch(lambda: {"on": True, "readable": True, "word": "on", "why": ""})
    # a real offer on the very cell the sandbox holds a rehearsed swap on: the open-offer slot is free
    try:
        shift_handoff.offer(T, location=LOC, col_iso=D3, from_staff=ANN, to_staff=BEN,
                            offered_by=ANN, created_by=ANN)
        OUT["real_offer_same_cell"] = "offered"
    except (shift_handoff.Refused, sr.Refused) as exc:
        OUT["real_offer_same_cell"] = exc.code
    # a real decision on a cell the rehearsal applied for in the sandbox: nothing blocks it
    try:
        sr.decide(T, location=LOC, open_row="OPEN", col_iso=D4, person=BEN, by="Real Manager")
        OUT["real_decision"] = "decided"
    except sr.Refused as exc:
        OUT["real_decision"] = exc.code

    # ── 8 THE WALL, attacked from inside a sealed worker ──
    probe = textwrap.dedent(f"""
        import json, os, socket, subprocess, sys
        sys.path.insert(0, {LANE_DIR!r})
        from pathlib import Path
        import rehearsal_sandbox as box
        box.seal(schema={SBX!r}, dsn={T!r}, root=Path({str(ROOT)!r}))
        box.configure_lanes()
        import psycopg2
        out = {{}}
        def tryit(name, fn):
            try:
                fn()
                out[name] = "done"
            except box.SandboxBreach:
                out[name] = "breach"
            except PermissionError:
                out[name] = "refused"
            except Exception as exc:
                out[name] = type(exc).__name__ + ": " + str(exc)[:120]
        def run(sql, autocommit=False):
            run_args(sql, None, autocommit)
        def run_args(sql, args, autocommit=False):
            c = psycopg2.connect(box.dsn())
            c.autocommit = autocommit
            try:
                with c.cursor() as cur:
                    cur.execute(sql, args)
                if not autocommit:
                    c.commit()
            finally:
                c.close()
        tryit("inside", lambda: run("CREATE TABLE IF NOT EXISTS rh_inside (a int)"))
        tryit("inside_write", lambda: run("INSERT INTO rh_inside VALUES (1)"))
        tryit("unqualified", lambda: run("INSERT INTO rh_probe VALUES (1)"))
        tryit("qualified", lambda: run("INSERT INTO {REAL}.rh_probe VALUES (2)"))
        tryit("cte", lambda: run("WITH x AS (INSERT INTO rh_probe VALUES (3) RETURNING 1) "
                                 "SELECT * FROM x"))
        tryit("function", lambda: run("SELECT {REAL}.rh_probe_write()"))
        tryit("function_autocommit", lambda: run("SELECT {REAL}.rh_probe_write()", True))
        tryit("path", lambda: run("SET search_path TO public"))
        tryit("drop", lambda: run("DROP TABLE rh_inside"))
        tryit("multi", lambda: run("SELECT 1; COMMIT", True))
        tryit("setval_real", lambda: run("SELECT setval('{REAL}.rh_probe_seq', 99)"))
        tryit("nextval_unqualified", lambda: run("SELECT nextval('rh_probe_seq')"))
        tryit("setval_param", lambda: run_args("SELECT setval(%s, 42)", ("{REAL}.rh_probe_seq",)))
        tryit("partition_of", lambda: run("CREATE TABLE rh_part PARTITION OF {REAL}.rh_parted "
                                          "FOR VALUES IN (1)"))
        tryit("inherits", lambda: run("CREATE TABLE rh_child (b int) INHERITS ({REAL}.rh_probe)"))
        tryit("select_into", lambda: run("SELECT 1 AS a INTO rh_into"))
        tryit("copy_out", lambda: run("COPY (SELECT 1) TO STDOUT"))
        tryit("inside_seq", lambda: run("CREATE SEQUENCE IF NOT EXISTS rh_inside_seq"))
        tryit("inside_setval", lambda: run_args("SELECT setval(%s, 5)", ("rh_inside_seq",)))
        # L-a and REH-2: DDL and TRUNCATE are not counted at the commit, so each is read first
        tryit("or_replace_view", lambda: run("CREATE OR REPLACE VIEW {REAL}.rh_view AS SELECT 1"))
        tryit("truncate_list", lambda: run("TRUNCATE rh_inside, {REAL}.rh_keep"))
        tryit("lock_list", lambda: run("LOCK TABLE rh_inside, {REAL}.rh_keep IN SHARE MODE"))
        tryit("alter_trigger", lambda: run("ALTER TRIGGER t ON {REAL}.rh_keep RENAME TO u"))
        tryit("alter_matview", lambda: run("ALTER MATERIALIZED VIEW {REAL}.m RENAME TO n"))
        tryit("set_schema", lambda: run("ALTER TABLE rh_inside SET SCHEMA {REAL}"))
        tryit("all_in_tablespace", lambda: run("ALTER TABLE ALL IN TABLESPACE pg_default "
                                               "SET TABLESPACE pg_default"))
        tryit("drop_real_index", lambda: run("DROP INDEX IF EXISTS {REAL}.rh_keep_idx"))
        tryit("drop_unqualified_index", lambda: run("DROP INDEX IF EXISTS rh_keep_idx"))
        tryit("inside_index", lambda: run("CREATE INDEX IF NOT EXISTS rh_inside_idx ON rh_inside (a)"))
        tryit("drop_inside_index", lambda: run('DROP INDEX IF EXISTS "{SBX}"."rh_inside_idx"'))
        # the names proved inside are forgotten after a DROP, so none is trusted without a look
        out["known_after_drop"] = len(box._KNOWN_INSIDE)
        # a DELETE FROM ONLY of a real table is refused BEFORE it runs, by the vet's own words
        def said_why(name, fn):
            try:
                fn()
                out[name] = "done"
            except box.SandboxBreach as exc:
                out[name] = "breach: " + str(exc)[:240]
            except Exception as exc:
                out[name] = type(exc).__name__ + ": " + str(exc)[:120]
        said_why("delete_only_real", lambda: run("DELETE FROM ONLY {REAL}.rh_keep"))
        tryit("rename", lambda: run("ALTER TABLE rh_inside RENAME TO rh_moved"))
        # V2: a quoted name glued to its keyword, a quoted set_config, a Unicode-escaped name and
        # a LIKE model are each read before they run
        tryit("glued_truncate", lambda: run('TRUNCATE"{REAL}"."rh_keep"'))
        tryit("quoted_set_config", lambda: run_args('SELECT "set_config"(%s, %s, false)',
                                                    ("search_path", {REAL!r})))
        tryit("unicode_name", lambda: run('TRUNCATE U&"{REAL}".rh_keep'))
        tryit("like_real", lambda: run("CREATE TABLE rh_like (LIKE {REAL}.rh_keep INCLUDING ALL)"))
        # the path moved under a remembered name by a call the vet never read: the sandbox's own
        # rh_keep is proved inside, then the path is moved to the real estate, where a TRUNCATE
        # of that same name would empty the real rh_keep (a TRUNCATE is not counted at a commit)
        def path_moved():
            c = psycopg2.connect(box.dsn())
            try:
                with c.cursor() as cur:
                    cur.execute("CREATE TABLE IF NOT EXISTS rh_keep (a int)")
                    cur.execute("INSERT INTO rh_keep VALUES (9)")
                c.commit()
                raw = psycopg2.extensions.cursor(c)
                raw.execute("SELECT set_config('search_path', %s, false)", ({REAL!r},))
                raw.close()
                with c.cursor() as cur:
                    cur.execute("TRUNCATE rh_keep")
                c.commit()
            finally:
                c.close()
        said_why("path_moved", path_moved)
        out["known_after_path"] = len(box._KNOWN_INSIDE)
        # the Time Off house's lock namespaces are moved clear of the real ones, from the
        # environment and, for a module loaded earlier, by the attribute itself
        import time_off
        out["time_off_ns"] = [time_off.LOCK_NS_ID, time_off.LOCK_NS_TAB,
                              int(os.environ.get("HUB_TIME_OFF_LOCK_NS", "0"))]
        time_off.LOCK_NS_ID, time_off.LOCK_NS_TAB = 8231, 8232
        box.configure_lanes()
        out["time_off_ns_moved"] = [time_off.LOCK_NS_ID, time_off.LOCK_NS_TAB]
        def two_phase():
            c = psycopg2.connect(box.dsn())
            try:
                c.tpc_begin(c.xid(1, "rh", "probe"))
            finally:
                c.close()
        tryit("tpc", two_phase)
        tryit("plain_connection", lambda: psycopg2.connect({DSN!r}))
        tryit("file", lambda: open({str(OUTSIDE)!r}, "w").write("x"))
        tryit("socket", lambda: socket.create_connection(("127.0.0.1", 5432), timeout=2))
        tryit("child", lambda: subprocess.run(["true"]))
        import effective_roster, calendar_builder_houses
        out["switch_holds"] = bool(effective_roster.test_mode().get("on"))
        tryit("workbook", lambda: calendar_builder_houses.workbook(box.dsn()).spreadsheets())
        out["stopped"] = len(box.stopped())
        print("PROBE " + json.dumps(out))
    """)
    proc = subprocess.run([sys.executable, "-B", "-c", probe], capture_output=True, text=True,
                          timeout=120, cwd=LANE_DIR)
    OUT["probe"] = next((json.loads(ln[6:]) for ln in proc.stdout.splitlines()
                         if ln.startswith("PROBE ")), {"error": proc.stderr[-1500:]})
    OUT["probe_left"] = [r["n"] for r in sbx_rows("SELECT count(*) AS n FROM {R}.rh_probe")][0]
    OUT["probe_kept"] = [[r["n"] for r in sbx_rows("SELECT count(*) AS n FROM {R}.rh_keep")][0],
                         [r["n"] for r in sbx_rows(
                             "SELECT count(*) AS n FROM pg_indexes WHERE schemaname=%s "
                             "AND indexname='rh_keep_idx'", (REAL,))][0],
                         [r["n"] for r in sbx_rows(
                             "SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n "
                             "ON n.oid=c.relnamespace WHERE n.nspname=%s AND c.relname=%s",
                             (REAL, "rh_inside"))][0],
                         [r["n"] for r in sbx_rows(
                             "SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n "
                             "ON n.oid=c.relnamespace WHERE n.nspname=%s AND c.relname=%s",
                             (REAL, "rh_view"))][0]]
    OUT["probe_seq"] = [[r["last_value"], r["is_called"]] for r in sbx_rows(
        "SELECT last_value, is_called FROM {R}.rh_probe_seq")][0]
    OUT["probe_linked"] = [r["n"] for r in sbx_rows(
        "SELECT count(*) AS n FROM pg_inherits WHERE inhparent IN (to_regclass(%s), to_regclass(%s))",
        (f"{REAL}.rh_parted", f"{REAL}.rh_probe"))][0]
    OUT["probe_made"] = [r["relname"] for r in sbx_rows(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname = ANY(%s) AND c.relname = ANY(%s) ORDER BY 1",
        ([SBX, REAL], ["rh_part", "rh_child", "rh_into", "rh_like"]))]
    OUT["outside_file"] = OUTSIDE.exists()

    # ── 9 a schema that is not the rehearsal's is never used as its sandbox ──
    ROOMS.make("foreign")
    with psycopg2.connect(DSN) as c, c.cursor() as cur:
        cur.execute(f"CREATE TABLE {FOREIGN}.somebody_elses (a int)")
        c.commit()
    try:
        rh.board(T, who={"name": DRIVER, "sees_reasons": True}, schema=FOREIGN, root=ROOT)
        OUT["foreign"] = "used"
    except (rh.Refused, rh.Failed) as exc:
        OUT["foreign"] = getattr(exc, "code", "failed")
    OUT["foreign_tables"] = [r["relname"] for r in sbx_rows(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname=%s ORDER BY 1", (FOREIGN,))]
    # V2-W4: a path that names the schema before it exists shows it once it is made; the worker
    # reads the path again after making it, and a schema standing there is rolled back
    NAMED_PATH = (DSN + ("&" if "?" in DSN else "?") + "options=-csearch_path%3D" + NEWBOX + "%2C"
                  + REAL + "%2Cpublic")
    try:
        rh.board(NAMED_PATH, who={"name": DRIVER, "sees_reasons": True}, schema=NEWBOX, root=ROOT)
        OUT["path_named"] = ["used", ""]
    except (rh.Refused, rh.Failed) as exc:
        OUT["path_named"] = [getattr(exc, "code", "failed"), str(getattr(exc, "why", exc))]
    OUT["path_named_made"] = [r["n"] for r in sbx_rows(
        "SELECT count(*) AS n FROM pg_namespace WHERE nspname=%s", (NEWBOX,))][0]

    # ── 10 the reset: everything played goes, a fresh copy comes in, the ledger keeps history ──
    TOUCHED.clear()
    standing = [r for r in board().get("made") or [] if not r.get("cleared")]
    OUT["standing"] = len(standing)
    reset = watched("reset", lambda: rh.reset(T, by=DRIVER, schema=SBX, root=ROOT))
    OUT["reset"] = {k: reset.get(k) for k in ("cleared", "why", "code")}
    OUT["after_reset_rehearsed"] = [r["id"] for r in sbx_rows(
        "SELECT id FROM {S}.asa_shift_requests WHERE via LIKE 'rehearsal:%%' OR extra ? 'rehearsal'")]
    OUT["after_reset_swaps"] = [r["id"] for r in sbx_rows(
        "SELECT id FROM {S}.asa_shift_handoffs WHERE extra ? 'rehearsal'")]
    OUT["after_reset_inbox"] = sorted(p.name for p in (ROOT / "inbox").glob("*"))
    OUT["after_reset_board"] = [bool(r.get("cleared")) for r in board().get("made") or []]
    OUT["touched_by_reset"] = TOUCHED

    # ── 11 THE SECOND WALL, for the day a rehearsed cell ever stood on a real house ──
    # (written by hand into the real estate, after every measurement above: the sandbox never did)
    # Dee's square holds a rehearsed write alone; Cy's a rehearsed write with a real held write
    # on top of it (V1-b); and at 48TH, Ann's rehearsed write had a real publish land on it before
    # a real held write, so it is no longer in the chain waiting to be published
    EDIT = (f"INSERT INTO {REAL}.asa_house_calendar_edits (location, employee, col_iso, old_value, "
            "new_value, via, actor, stage, note) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)")
    PLAYED = "played by the shift rehearsal"
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(EDIT, (OTHER, DEE, D2, "", "8A-4P", "rehearsal:decision:approved", DRIVER,
                           "test_mode", PLAYED))
        cur.execute(EDIT, (OTHER, CY, D2, "", "8A-4P", "rehearsal:handoff", DRIVER, "test_mode",
                           PLAYED))
        cur.execute(EDIT, (OTHER, CY, D2, "8A-4P", "9A-5P", "decision:approved", "Real Manager",
                           "test_mode", ""))
        cur.execute(EDIT, (LOC, ANN, D2, "", "8A-4P", "rehearsal:decision:approved", DRIVER,
                           "test_mode", PLAYED))
        cur.execute(EDIT, (LOC, ANN, D2, "8A-4P", "", "house_publish", "Real Manager",
                           "published", ""))
        cur.execute(EDIT, (LOC, ANN, D2, "", "2P-10P", "decision:approved", "Real Manager",
                           "test_mode", ""))
        c.commit()

    def flagged(g):
        return [[r.get("employee"), i, bool(c.get("rehearsal")), bool(c.get("test_mode"))]
                for r in g.get("rows") or [] for i, c in enumerate(r.get("cells") or [])
                if isinstance(c, dict) and c.get("pending")]

    OUT["wall_grid"] = flagged(house_cal_live.merged_grid(T, OTHER) or {})
    OUT["wall_grid_republished"] = [f for f in flagged(house_cal_live.merged_grid(T, LOC) or {})
                                    if f[0] == ANN]
    OUT["wall_held_cells"] = sorted([e["employee"], bool(e.get("rehearsal"))]
                                    for loc in (OTHER, LOC) for e in cbh.held_cells(T, loc)
                                    if e["col_iso"] == D2)
    effective_roster.use_switch(lambda: {"on": False, "readable": True, "word": "off", "why": ""})
    try:
        cbh.publish_held(T, location=OTHER, actor="Somebody Real")
        OUT["wall_publish"] = ["published", []]
    except cbh.Refused as exc:
        OUT["wall_publish"] = [exc.code, [b.get("employee") for b in (exc.extra or {}).get("blocked") or []]]
    effective_roster.use_switch(lambda: {"on": True, "readable": True, "word": "on", "why": ""})
    OUT["wall_left"] = [(r["stage"], r["undone_at"] is None) for r in sbx_rows(
        "SELECT stage, undone_at FROM {R}.asa_house_calendar_edits WHERE location=%s", (OTHER,))]

    # ── 11b THE SECOND WALL FOR THE MESSAGE LANES, and for the estate's open shifts ──
    # Each rehearsed row is written by hand onto the real estate. The lane's own reader skips it
    # while the mark stands and counts it once the mark is taken off, so the mark is the reason.
    DAY = daytime_pin(datetime.now(timezone.utc))
    # the pool's notice to a house manager: a rehearsed application on JH's closed call-off
    REQ_W = "SRREHWALL001"
    NOTICE_W = f"{OTHER}|{CY}|{D1}:{sr.KIND_APPLICANTS}"
    sbx_do("INSERT INTO {R}.asa_shift_requests (id, kind, location, open_row, col_iso, value, person, "
           "state, via, extra) VALUES (%s,%s,%s,%s,%s,'10A-6P',%s,%s,'rehearsal:app',"
           "'{\\"rehearsal\\": {\\"id\\": \\"REHWALL\\"}}'::jsonb)",
           (REQ_W, sr.KIND_CALLOFF, OTHER, CY, D1, ANN, sr.APPLIED))
    OUT["wall_notice"] = [NOTICE_W in [o["id"] for o in sr.owed(T, limit=500)]]
    sbx_do("UPDATE {R}.asa_shift_requests SET via='app', extra='{}'::jsonb WHERE id=%s", (REQ_W,))
    OUT["wall_notice"].append(NOTICE_W in [o["id"] for o in sr.owed(T, limit=500)])
    # a swap's asks: a copy of the real transfer, on another day, carrying the rehearsal's evidence
    HID_W = "HOREHWALL001"
    sbx_do("INSERT INTO {R}.asa_shift_handoffs SELECT (jsonb_populate_record(h, jsonb_build_object("
           "'id', %s::text, 'col_iso', %s::text, 'said', '{}'::jsonb, "
           "'extra', '{\\"rehearsal\\": {\\"id\\": \\"REHWALL\\"}}'::jsonb))).* "
           "FROM {R}.asa_shift_handoffs h WHERE h.id = %s", (HID_W, D2, REAL_HID))
    asks = lambda: [o["id"] for o in shift_handoff.owed(T, now=DAY, limit=500)  # noqa: E731
                    if o["id"].startswith(HID_W + ":")]
    OUT["wall_asks"] = [asks()]
    sbx_do("UPDATE {R}.asa_shift_handoffs SET extra='{}'::jsonb WHERE id=%s", (HID_W,))
    OUT["wall_asks"].append(asks())
    # a text's acknowledgement: a line the ear heard, marked as the rehearsal's
    RID_W = "REHWALL00001"
    sbx_do("INSERT INTO {R}.asa_sms_replies (id, line, sent_at, heard_at, person, outcome, col_iso, "
           "value, ack, ack_why, rehearsal) VALUES (%s,'3305550000',%s,%s,%s,'refused',%s,'8A-4P',"
           "%s,'refused',true)",
           (RID_W, DAY - timedelta(minutes=2), DAY - timedelta(minutes=1), DEE, D3,
            sms_ears.ACK_REFUSED))
    ack_w = f"{sms_ears.ACK_ID_PREFIX}{RID_W}:{sms_ears.ACK_REFUSED}"
    OUT["wall_ack"] = [ack_w in [o["id"] for o in sms_ears.owed(T, now=DAY, limit=500)]]
    sbx_do("UPDATE {R}.asa_sms_replies SET rehearsal=false WHERE id=%s", (RID_W,))
    OUT["wall_ack"].append(ack_w in [o["id"] for o in sms_ears.owed(T, now=DAY, limit=500)])
    # the follow-up net: the same call-off filled by a rehearsed decision is never noted, and a
    # rehearsed fill already in the ledger is never offered
    COVER_W = open_shift_covered.row_id(OTHER, CY, D1)
    sbx_do("UPDATE {R}.asa_shift_pool SET filled_by=%s, filled_how='rehearsal:decision:approved', "
           "decided_by=%s, closed_at=now() WHERE location=%s AND open_row=%s AND col_iso=%s",
           (ANN, DRIVER, OTHER, CY, D1))
    covered_n = lambda: [r["n"] for r in sbx_rows(  # noqa: E731
        "SELECT count(*) AS n FROM {R}.asa_open_shift_covered WHERE location=%s AND open_row=%s "
        "AND col_iso=%s", (OTHER, CY, D1))][0]
    open_shift_covered.note_from_pool(T)
    OUT["wall_follow_noted"] = [covered_n()]
    sbx_do("UPDATE {R}.asa_shift_pool SET filled_how='decision:approved' WHERE location=%s "
           "AND open_row=%s AND col_iso=%s", (OTHER, CY, D1))
    open_shift_covered.note_from_pool(T)
    OUT["wall_follow_noted"].append(covered_n())
    offered = lambda: COVER_W in [o["id"] for o in open_shift_covered.owed(T, limit=500)]  # noqa: E731
    OUT["wall_follow_offered"] = [offered()]
    sbx_do("UPDATE {R}.asa_open_shift_covered SET filled_how='rehearsal:decision:approved' "
           "WHERE location=%s AND open_row=%s AND col_iso=%s", (OTHER, CY, D1))
    OUT["wall_follow_offered"].append(offered())
    # V2-W3: the estate's open shifts — a rehearsed held write clearing JH's D2 open shift never
    # takes it off the list; the same write, real, does
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(EDIT, (OTHER, "OPEN", D2, "8A-4P", "", "rehearsal:decision:approved", DRIVER,
                           "test_mode", PLAYED))
        c.commit()
    listed = lambda: (OTHER, "OPEN", D2) in {(s["location"], s["open_row"], s["col_iso"])  # noqa: E731
                                              for s in house_cal_live.open_shifts(T)}
    OUT["wall_open_shifts"] = [listed()]
    sbx_do("UPDATE {R}.asa_house_calendar_edits SET via='decision:approved' WHERE location=%s "
           "AND employee='OPEN' AND col_iso=%s", (OTHER, D2))
    OUT["wall_open_shifts"].append(listed())

    # ── 12 L-c: a rehearsed swap that completes writes its cells with the rehearsal's road ──
    # Played in a sealed worker of its own on the freshly reset sandbox. The one stand-in is the
    # overlap and training check, which this estate cannot answer (its IST settings house is not
    # readable here), so the completion itself is what is played.
    lc_before = real_state()
    lc_probe = textwrap.dedent(f"""
        import json, sys
        sys.path.insert(0, {LANE_DIR!r})
        from pathlib import Path
        import rehearsal_sandbox as box
        box.seal(schema={SBX!r}, dsn={T!r}, root=Path({str(ROOT)!r}))
        box.configure_lanes()
        import psycopg2
        import shift_requests as sr
        import shift_handoff as sh
        sr.check_assignment = lambda *a, **k: {{"ok": True, "code": "ok", "why": "", "ist": {{"ok": True}}}}
        sh.ensure_tables(box.dsn())
        hid = "HOREHPROBE01"
        start = sr.span_of({D2!r}, "4P-10P")[0]
        with psycopg2.connect(box.dsn()) as c, c.cursor() as cur:
            cur.execute("INSERT INTO asa_shift_handoffs (id, location, col_iso, value, from_staff, "
                        "to_staff, house_manager, staff_state, staff_via, manager_state, "
                        "director_state, director_via, director_by, directors, approvers, approval, "
                        "offered_by, shift_start, extra) VALUES (%s,%s,%s,'4P-10P',%s,%s,%s,"
                        "'accepted','rehearsal:app','pending','approved','rehearsal:app',%s,%s,%s,"
                        "'house_manager',%s,%s,%s)",
                        (hid, {LOC!r}, {D2!r}, {GIL!r}, {ZED!r}, "Hana Fixture", {DORA!r},
                         json.dumps([{DORA!r}]), json.dumps(["Hana Fixture"]), {GIL!r}, start,
                         json.dumps({{"rehearsal": {{"id": "REHPROBE"}}}})))
            c.commit()
        out = {{}}
        try:
            got = sh.answer(box.dsn(), hid, side="manager", word="yes", via="rehearsal:app",
                            by="Hana Fixture", rehearsal={{"id": "REHPROBE"}})
            out["state"] = got.get("state")
        except Exception as exc:
            out["state"] = type(exc).__name__ + ": " + str(getattr(exc, "why", exc))[:200]
        with psycopg2.connect(box.dsn()) as c, c.cursor() as cur:
            cur.execute("SELECT employee, new_value, via, stage FROM asa_house_calendar_edits "
                        "WHERE act=%s ORDER BY employee", (hid,))
            out["cells"] = [list(r) for r in cur.fetchall()]
            c.commit()
        out["stopped"] = box.stopped()
        print("LC " + json.dumps(out, default=str))
    """)
    proc = subprocess.run([sys.executable, "-B", "-c", lc_probe], capture_output=True, text=True,
                          timeout=120, cwd=LANE_DIR)
    OUT["lc"] = next((json.loads(ln[3:]) for ln in proc.stdout.splitlines()
                      if ln.startswith("LC ")), {"error": proc.stderr[-1500:]})
    OUT["lc_real_untouched"] = real_state() == lc_before
finally:
    effective_roster.use_switch(None)
    for p in (ROOT, REAL_INBOX, REAL_MOCK, PEOPLE.parent):
        __import__("shutil").rmtree(p, ignore_errors=True)
    try:
        OUTSIDE.unlink()
    except OSError:
        pass
    OUT["rooms"] = ROOMS.close()
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''

LANE_BUDGET_S = 900
_LANE_BROKEN: list[str] = []


def _lane_broke(why: str, detail: str) -> None:
    """A lane that broke is recorded as a FAILURE, never as a skip."""
    _LANE_BROKEN.append(why)
    check(f"THE LANE RAN: {why}", False, detail)


def _closure(seeds: tuple[str, ...]) -> dict[str, str]:
    """The seeds and everything of server/ they import, top level or lazily — a module missing in
    the container must never load from the live checkout beside it."""
    out: dict[str, str] = {}
    todo = list(seeds)
    while todo:
        name = todo.pop()
        if name in out:
            continue
        path = SERVER / f"{name}.py"
        if not path.exists() or name == "snapshot_service":
            continue
        out[name] = path.read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(out[name])):
            if isinstance(node, ast.Import):
                todo += [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                todo.append(node.module.split(".")[0])
    return out


def _reached(seeds: tuple[str, ...]) -> set[str]:
    """Every module of server/ the seeds import, top level or lazily, snapshot_service included."""
    out: set[str] = set()
    todo = list(seeds)
    while todo:
        name = todo.pop()
        if name in out:
            continue
        out.add(name)
        path = SERVER / f"{name}.py"
        if not path.exists():
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                todo += [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                todo.append(node.module.split(".")[0])
    return out


print("\nA REAL PERSON IS NEVER MESSAGED — the doors that hand a message on are never loaded")
_worker_mods = _reached(("rehearsal_sandbox", "shift_rehearsal_acts"))
_doors = ("_sms_replies_post", "_shift_handoff_post", "_shift_requests_post",
          "_open_shift_covered_post", "_service_door")
check("every function that hands an owed message to the message door lives in the relay "
      "(snapshot_service), and the worker never imports it — not at the top, not lazily, not "
      "through any lane it loads; what a lane owes inside the sandbox is only ever read",
      all(f"async def {d}(" in SS_SRC for d in _doors) and "snapshot_service" not in _worker_mods
      and not any(d in ACTS_SRC or d in BOX_SRC for d in _doors),
      sorted(_worker_mods)[:60])


def _lane_in_container(script_body: str):
    sources = _closure(("shift_rehearsal", "rehearsal_sandbox", "shift_rehearsal_acts",
                        "shift_requests", "shift_handoff", "sms_ears", "house_cal_live",
                        "calendar_builder_houses", "effective_roster", "psi_reminders",
                        "hotline_desk", "web_gate", "open_shift_covered"))
    sources["ist_config_defaults.json"] = (SERVER / "ist_config_defaults.json").read_text(encoding="utf-8")
    # the helper that holds the real estate's tables in this run's own schema
    sources["lane_schema"] = (HERE.parent / "lane_schema.py").read_text(encoding="utf-8")
    here = f"/tmp/shift-rehearsal-test-{os.getpid()}-{int(time.time() * 1000) % 100000}"
    script = (
        "import base64, json, os, pathlib, shutil, signal, sys\n"
        f"SRC = json.loads(base64.b64decode({base64.b64encode(json.dumps(sources).encode())!r}))\n"
        f"d = pathlib.Path({here!r}); d.mkdir(parents=True, exist_ok=True)\n"
        "for k, v in SRC.items(): (d / (k if k.endswith('.json') else k + '.py')).write_text(v)\n"
        "sys.path[:] = [p for p in sys.path if p not in ('', os.getcwd())]\n"
        f"LANE_DIR = {here!r}\n"
        f"signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw("
        f"TimeoutError('the lane ran past {LANE_BUDGET_S - 60}s and stopped itself')))\n"
        f"signal.alarm({LANE_BUDGET_S - 60})\n"
        "try:\n"
        + "".join("    " + line + "\n" for line in script_body.splitlines())
        + "finally:\n"
        f"    shutil.rmtree({here!r}, ignore_errors=True)\n")
    # the quiet window may be moved for one run (HUB_QUIET_FROM / HUB_QUIET_TO), so the lane can be
    # proved on both sides of it without waiting for the clock
    env = [f"-e{k}={os.environ[k]}" for k in ("HUB_QUIET_FROM", "HUB_QUIET_TO") if os.environ.get(k)]
    try:
        proc = subprocess.run(["docker", "exec", "-i", *env, CONTAINER, "python3", "-B", "-"],
                              input=script, capture_output=True, text=True, timeout=LANE_BUDGET_S)
    except FileNotFoundError:
        return None
    except subprocess.TimeoutExpired:
        _lane_broke(f"the lane did not answer inside {LANE_BUDGET_S}s — it was killed, not skipped", "")
        return None
    for line in (proc.stdout or "").splitlines():
        if line.startswith("LANE_RESULT "):
            return json.loads(line[len("LANE_RESULT "):])
    absent = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER],
                            capture_output=True, text=True).stdout.strip() != "true"
    if absent:
        return None
    _lane_broke("the lane ran in the container and produced no result",
                ((proc.stdout or "") + (proc.stderr or ""))[-3000:])
    return None


print("\nTHE WHOLE REHEARSAL, against a real database and a watched real estate")
# Every safety assertion — the fingerprints, the readers, the wall probes — lives in the lane half,
# so a lane that did not run is a FAILURE unless it was skipped by name.
SKIP_ENV = "HUB_SHIFT_REHEARSAL_LANE"
if os.getenv(SKIP_ENV, "") == "skip":
    print(f"  SKIPPED by {SKIP_ENV}=skip — the pure half above ran; the lane half, which holds every "
          f"safety assertion, did NOT")
    lane = None
else:
    lane = _lane_in_container(LANE)
    if lane is None and not _LANE_BROKEN:
        check(f"THE LANE RAN: no relay container ({CONTAINER}) or no docker to hold a database here "
              f"— the lane half, which holds every safety assertion, did not run. Set "
              f"{SKIP_ENV}=skip to run the pure half alone on purpose", False)
    elif lane is None:
        print("  THE LANE BROKE — counted as a failure above, never as a skip.")
if lane is not None:
    print("\n  THE CRITERION")
    check("AROUND EVERY REHEARSAL CALL — every board, answer and refusal — every table of the real "
          "estate and every file of its inbox and mockups was byte-for-byte unchanged",
          lane["touched"] == [], lane["touched"])
    check("…and around the reset too", lane["touched_by_reset"] == [], lane["touched_by_reset"])
    check("and no lane reached for a real table, file or host while it was played — not even a "
          "reach a lane caught and carried on from", lane["stopped_while_playing"] == [],
          lane["stopped_while_playing"])
    check("no real idempotency key — what the pool, the transfers and the ear each say they said — "
          "was stripped, added or rewritten by anything the rehearsal played, and there were keys "
          "to strip", lane["real_said_kept"][0] is True and lane["real_said_kept"][1] > 0,
          lane["real_said_kept"])

    check("the watched real estate is this run's own room: the shift family's tables were made in "
          "its schema before any read, and no table the shipped code names resolves in production",
          bool(lane["owned"].get("lane"))
          and len(set(lane["owned"]["lane"].values())) == 1
          and None not in lane["owned"]["lane"].values(), lane["owned"])

    print("\n  THE SANDBOX")
    check("the board reads the sandbox's copy of the estate: the houses, the people, the leftover "
          "tab named and not offered", lane["board_ok"]
          and lane["board_houses"] == sorted(["CAN - 48TH (B) - ABD1711", "CAN - JH - ABD2704"])
          and "Copy of CALENDAR" in (lane["board"]["not_houses"] or [])
          and "Ann Roe" in (lane["board_people_here"] or []),
          [lane["board"], lane["board_houses"], lane["board_error"]])
    check("the copy was taken from the real estate — its pool and its real swap are in the sandbox",
          lane["sbx_copied_pool"] >= 5 and lane["real_hid"] in lane["sbx_copied_swap"],
          [lane["sbx_copied_pool"], lane["sbx_copied_swap"], lane["sandbox"]])
    check("nothing reached for anything outside the sandbox while the board was read",
          not lane["board"].get("stopped"), lane["board"].get("stopped"))
    check("V1-d — the directories the sealed worker made (its inbox of real staff numbers among "
          "them) are readable by their owner alone, like the real inbox",
          lane["sbx_dir_modes"] == {"inbox": "0o700", "out": "0o700",
                                    "out/comm-mock-web": "0o700", "tmp": "0o700"},
          lane["sbx_dir_modes"])
    role = lane.get("board_role") or {}
    check("V2-superuser-role — the board names the database role the worker connects as, and says "
          "whether it is a superuser (read, never assumed)",
          bool(role.get("name")) and role.get("superuser") in (True, False), role)
    days = lane["days"]
    give = lane.get("board_giveable") or {}
    check("V2-offer-picker — the board offers each person's OWN shifts still ahead for a swap: Gil's "
          "evening and Ann's D3, never a day already gone and never an open row of the pool",
          {"col_iso": days["D2"], "value": "4P-10P"} in (give.get("Gil Giver") or [])
          and {"col_iso": days["D3"], "value": "8A-4P"} in (give.get("Ann Roe") or [])
          and not any(c["col_iso"] == days["OLD"] for cells in give.values() for c in cells)
          and "OPEN" not in give
          and all(c["col_iso"] > days["today"] for cells in give.values() for c in cells), give)
    check("M-B — with the contact index read, the board says so and names who can text",
          lane["board_readable"][0] is True and "Ann Roe" in (lane["board"]["textable"] or []),
          [lane["board_readable"], lane["board"]["textable"]])
    check("M-B — with the contact index UNREADABLE, the board says it could not be read and why, "
          "and names nobody as textable rather than everybody as numberless",
          lane["blind_board"][0] is False and lane["blind_board"][1] == []
          and bool(lane["blind_board"][2]), lane["blind_board"])
    check("M-B — …and a text act is refused as contacts_unreadable, in words that say so",
          lane["blind_text"]["code"] == "contacts_unreadable"
          and "could not be read" in str(lane["blind_text"]["why"]), lane["blind_text"])
    check("L4 — while an answer or a reset holds the sandbox, a board waits its turn and is then "
          "refused as busy — it never reads a sandbox half done; once released it reads",
          lane["board_while_held"] == ["refused", "busy"] and lane["board_after_release"] is True,
          [lane["board_while_held"], lane["board_after_release"]])

    print("\n  THE APPLICATIONS")
    check("an application in the platform is done", lane["apply_in_window"]["outcome"] == "done"
          and lane["apply_in_window"]["code"] == "applied", lane["apply_in_window"])
    check("a second by TEXT: a line in the sandbox's own inbox, heard by the real ear",
          lane["apply_by_text"]["outcome"] == "done"
          and str(lane["apply_by_text_lanes"]["door"]).startswith("sms_ears.listen")
          and lane["sbx_inbox_lines"] == 1, [lane["apply_by_text"], lane["apply_by_text_lanes"]])
    apps = [r for r in lane["sbx_requests"] if r[1] == "open_shift"]
    check("every row either answer made carries the mark ON THE ROW, in the sandbox — the "
          "applications in their road and their evidence, and a training approval they raised in "
          "its road",
          sorted((p, via, ev) for p, _k, via, ev, _m in apps)
          == [("Ann Roe", "rehearsal:app", True), ("Ben Left", "rehearsal:sms", True)]
          and all(m for *_x, m in lane["sbx_requests"]), lane["sbx_requests"])
    check("the ear's own ledger — the sandbox's — holds the text with its mark and the "
          "acknowledgement it owes, whatever the hour",
          lane["sbx_ear"] == [["REH", "Ben Left", "applied", True, True]], lane["sbx_ear"])
    check("T1 — whatever hour the suite runs at, every lane was asked at the instant a message could "
          "go: the answer's own hour, or the end of the quiet window when it fell inside it",
          bool(lane["apply_by_text_expected_when"])
          and all(w == lane["apply_by_text_expected_when"] for w in lane["apply_by_text_when"]),
          [lane["apply_by_text_when"], lane["apply_by_text_expected_when"],
           lane["apply_by_text_owed"]])
    check("T1 — a text played at a daytime clock (pinned, never the hour the suite runs at) owes "
          "its acknowledgement to the sender at that clock, and the answer says so",
          lane["pinned_quiet"] is False and lane["pinned_text"]["outcome"] == "done"
          and bool(lane["pinned_clock"])
          and any(lane_ == "text" and to == "Dee Way" and when == lane["pinned_clock"]
                  for lane_, to, _k, when in lane["pinned_text_owed"])
          and lane["sbx_ear_pinned"] == [["Dee Way", "applied", True, True]],
          [lane["pinned_text"], lane["pinned_clock"], lane["pinned_text_owed"],
           lane["sbx_ear_pinned"]])
    check("V1-a — a ref handed in with the request (a time off request's shape) on a cell with no "
          "pool row is refused as no_such_shift: no line is written, the ear hears nothing, no "
          "road but the shift's could be reached",
          lane["text_foreign_ref"]["code"] == "no_such_shift"
          and lane["text_foreign_ref_said"] == ["", ""]
          and lane["text_foreign_ref_ear"] == []
          and lane["text_foreign_ref_lines"][0] == lane["text_foreign_ref_lines"][1],
          [lane["text_foreign_ref"], lane["text_foreign_ref_said"], lane["text_foreign_ref_ear"],
           lane["text_foreign_ref_lines"]])
    check("the lane's own rules refuse: an overlap, a caller's own call-off, an outsider in the "
          "reserved minutes, a leftover tab",
          lane["overlap"]["code"] == "overlap" and lane["own_call_off"]["code"] == "called_off"
          and lane["outsider"]["code"] == "not_a_regular" and lane["phantom"]["code"] == "no_house",
          [lane["overlap"], lane["own_call_off"], lane["outsider"], lane["phantom"]])
    check("a call-off inside its five hours is applied for, and refused at a clock past them",
          lane["call_off_in_window"]["outcome"] == "done"
          and lane["call_off_after_window"]["code"] == "window_closed",
          [lane["call_off_in_window"], lane["call_off_after_window"]])
    check("an open shift at a clock past its window is refused",
          lane["after_window"]["code"] in ("window_closed", "overlap"), lane["after_window"])

    print("\n  THE REHEARSED CLOCK")
    check("both aged windows began closed, as every pooled window on the estate is",
          lane["aged_windows"] == ["closed", "closed"], lane["aged_windows"])
    check("without a clock the aged shift is refused; a clock outside its life, or no instant at "
          "all, is refused in words",
          lane["aged_no_clock"]["code"] == "window_closed"
          and lane["aged_bad_clock"]["code"] == "clock_outside"
          and lane["aged_not_a_clock"]["code"] == "no_clock",
          [lane["aged_no_clock"], lane["aged_bad_clock"], lane["aged_not_a_clock"]])
    check("the ten reserved minutes: two regulars apply and an outsider is refused",
          lane["ten_minutes_ben"]["outcome"] == "done" and lane["ten_minutes_cy"]["outcome"] == "done"
          and lane["ten_minutes_outsider"]["code"] == "not_a_regular",
          [lane["ten_minutes_ben"], lane["ten_minutes_cy"], lane["ten_minutes_outsider"]])
    check("a call-off's five hours: applied one hour in, refused past them",
          lane["five_hours"]["outcome"] == "done"
          and lane["five_hours_gone"]["code"] == "window_closed",
          [lane["five_hours"], lane["five_hours_gone"]])
    check("the house manager's notice about the closed window is owed INSIDE the sandbox",
          lane["sbx_owes_notice"] is True)

    print("\n  NOTHING THE REHEARSAL DID NOT MAKE IS MOVED")
    check("a row the copy carried is never withdrawn, and there is no withdrawal by text",
          lane["withdraw_real"]["code"] == "not_a_rehearsal"
          and lane["withdraw_by_text"]["code"] == "no_such_door",
          [lane["withdraw_real"], lane["withdraw_by_text"]])
    check("a rehearsed name comes back off through the withdrawal door",
          lane["withdraw_rehearsed"]["code"] == "withdrawn", lane["withdraw_rehearsed"])
    check("a decision over a copied application, or a copied training approval, is refused",
          lane["decide_with_a_real_one"]["code"] == "real_applicants"
          and lane["decide_over_a_real_training"]["code"] == "real_applicants",
          [lane["decide_with_a_real_one"], lane["decide_over_a_real_training"]])

    print("\n  THE DECISIONS")
    check("L4 — a decision played as a regular of the house is refused as the real door refuses "
          "it (not_a_decider), and so is an assignment of somebody else",
          lane["decide_as_a_regular"]["code"] == "not_a_decider"
          and lane["assign_as_a_regular"]["code"] == "not_a_decider",
          [lane["decide_as_a_regular"], lane["assign_as_a_regular"]])
    check("L4 — taking a shift for oneself goes to the lane, which answers in its own words, and "
          "none of the three moved a shift",
          lane["take_for_oneself"]["outcome"] == "refused"
          and lane["take_for_oneself"]["code"] not in ("not_a_decider", "failed")
          and lane["decided_nothing"] == ["", ""],
          [lane["take_for_oneself"], lane["decided_nothing"]])
    check("the decision below is played as the driver, and says so",
          lane["decided_as"] == "Driver Fixture", lane["decided_as"])
    check("the house manager gives the shift to one applicant and the other is passed over — in "
          "the sandbox", lane["decision"]["outcome"] == "done"
          and sorted(lane["after_decision"]) == [["Ann Roe", "approved"], ["Ben Left", "not_chosen"]],
          [lane["decision"], lane["after_decision"]])
    check("the SANDBOX's pooled shift is filled and its calendar holds the cell; the REAL pooled "
          "shift is still open",
          lane["sbx_pool_d1"] == ["Ann Roe"] and lane["real_pool_d1"] == [""]
          and any(st == "test_mode" and e == "Ann Roe" for st, e in lane["sbx_cells_held"]),
          [lane["sbx_pool_d1"], lane["real_pool_d1"], lane["sbx_cells_held"]])
    check("an assignment and the aged decision are played too",
          lane["assignment"]["outcome"] == "done" and lane["aged_decision"]["outcome"] == "done"
          and lane["aged_after_decision"] == [["Ben Left", "approved"], ["Cy Far", "not_chosen"]],
          [lane["assignment"], lane["aged_decision"], lane["aged_after_decision"]])

    print("\n  THE SWAP — played to the end, inside the sandbox")
    check("offered through the transfer door, and the lane owes its asks inside the sandbox",
          lane["swap_offer"]["outcome"] == "done" and "handoff_ask_staff" in lane["swap_offer_owed"],
          [lane["swap_offer"], lane["swap_offer_owed"]])
    check("the receiver agrees BY TEXT, with the road the line earned",
          lane["swap_accept_by_text"]["outcome"] == "done"
          and lane["swap_row_mid"] == [["accepted", "rehearsal:sms", "pending", "pending"]],
          [lane["swap_accept_by_text"], lane["swap_row_mid"]])
    check("M-A — the board offers the transfer's OWN approver, a house manager on no grid",
          lane["swap_board_approvers"] == ["Hana Fixture"], lane["swap_board_approvers"])
    check("M-A — an approval by a regular of the house is refused as the real door refuses it "
          "(not_the_approver), and one by the receiver as their own swap; the swap is untouched",
          lane["swap_by_a_regular"]["code"] == "not_the_approver"
          and lane["swap_by_the_receiver"]["code"] == "own_swap"
          and lane["swap_row_untouched"] == [["pending", "pending"]],
          [lane["swap_by_a_regular"], lane["swap_by_the_receiver"], lane["swap_row_untouched"]])
    check("REH-1 — the swap carries the directors list it was asked of, read from the Time Off "
          "house's settings (never from code), and the board offers it",
          lane["real_swap_directors"] == ["Dora Desk"]
          and lane["swap_board_directors"] == [["Dora Desk"], "pending"],
          [lane["real_swap_directors"], lane["swap_board_directors"]])
    check("REH-1 — the director's approval is refused to a regular of the house (not on the list), "
          "to the house manager (the real door gives them their own seat) and to a badge above "
          "every house; the swap is untouched",
          lane["director_by_a_regular"]["code"] == "not_the_director"
          and lane["director_by_the_hm"]["code"] == "another_seat"
          and lane["director_by_the_driver"]["code"] == "another_seat"
          and lane["director_untouched"] == [["pending", "pending", "pending"]],
          [lane["director_by_a_regular"], lane["director_by_the_hm"],
           lane["director_by_the_driver"], lane["director_untouched"]])
    check("REH-1 — the director on the list approves in the platform, in the director's own "
          "column, with the rehearsal's road on it; the swap still waits on the house manager",
          lane["director_app"]["outcome"] == "done"
          and lane["director_row"] == [["approved", "rehearsal:app", "Dora Desk", "pending",
                                        "pending"]],
          [lane["director_app"], lane["director_row"]])
    completed = (lane["swap_second_consent"]["outcome"] == "done"
                 and lane["swap_row_end"] == [["accepted", "approved", "approved", "done"]]
                 and ["Ben Left", "8A-4P"] in lane["sbx_d3_cells"])
    # the receiver has no IST on the estate's own book, so the swap's training rule is the
    # lane's to apply: it either finds a free trainer and moves the shift, or says why not
    trained_out = (lane["swap_second_consent"]["outcome"] in ("refused", "held")
                   and lane["swap_row_end"][0][3] == "pending"
                   and "train" in (str(lane["swap_second_consent"]["code"])
                                   + str(lane["swap_second_consent"]["why"])).lower())
    check("M-A — the approval by the transfer's OWN approver is played to the end inside the "
          "sandbox: all three consents move the shift on the SANDBOX's calendar, or the lane's "
          "training rule stops it in its own words",
          completed or trained_out,
          [lane["swap_second_consent"], lane["swap_row_end"], lane["sbx_d3_cells"]])
    print(f"       (this run: {'the shift moved on the sandbox calendar' if completed else 'the training rule held it: ' + str(lane['swap_second_consent']['why'])[:160]})")
    check("L-c — the cells a completed rehearsed swap writes carry the rehearsal's road, like every "
          "other rehearsed write",
          (not completed) or lane["sbx_d3_vias"] == ["rehearsal:handoff"], lane["sbx_d3_vias"])
    check("the copied REAL swap is answered by nobody here — not the receiver, not by text, not "
          "the house manager, not the director in the platform or by text — and its copy is "
          "untouched",
          all(lane[k]["code"] == "not_a_rehearsal"
              for k in ("real_swap_app", "real_swap_text", "real_swap_manager",
                        "real_swap_director", "real_swap_director_text"))
          and lane["sbx_real_swap_row"] == [["pending", "", "pending", "pending"]],
          [lane["real_swap_app"], lane["real_swap_text"], lane["real_swap_manager"],
           lane["real_swap_director"], lane["real_swap_director_text"], lane["sbx_real_swap_row"]])
    check("…and the swap lane's own guard, asked directly, refuses a real answer on a rehearsed "
          "transfer and a rehearsed answer on the real one; the real row still waits on all three",
          lane["real_answer_on_rehearsed"] == "rehearsed_swap"
          and lane["rehearsed_answer_on_real"] == "real_swap"
          and lane["real_swap_row_after"] == [["pending", "pending", "pending", "pending"]],
          [lane["real_answer_on_rehearsed"], lane["rehearsed_answer_on_real"],
           lane["real_swap_row_after"]])

    print("\n  N1 — THE OFFER GOES THROUGH THE REAL DOOR, WITH WHO CAN BE REACHED")
    check("N1 — a receiver with no phone on file is refused as the real door refuses them "
          "(no_contact), and nothing is offered",
          lane["offer_no_phone"]["code"] == "no_contact", lane["offer_no_phone"])
    check("N1 — a one-word name the ear can reach is accepted, as the real door accepts it, and the "
          "offer says who can be reached was read",
          lane["offer_one_word"]["outcome"] == "done"
          and lane["offer_one_word_lanes"]["reachable_known"] is True
          and lane["offer_one_word_lanes"]["directors"] == ["Dora Desk"],
          [lane["offer_one_word"], lane["offer_one_word_lanes"]])
    check("a transfer the rehearsal made never offers a real hand a button: the flag is set and the "
          "director's button withheld — and it is the flag that withholds it",
          lane["describe_rehearsed"] == [True, False, False, True], lane["describe_rehearsed"])
    check("REH-1 — the director answers BY TEXT from the number the ear knows, on no grid; the ear "
          "seats them as the director and the road the line earned is on the row",
          lane["director_text"]["outcome"] == "done"
          and lane["director_text_row"] == [["approved", "rehearsal:sms", "Dora Desk"]],
          [lane["director_text"], lane["director_text_row"]])

    print("\n  EVERY ROW THE REHEARSAL WROTE SAYS SO")
    check("every row the rehearsal made in the sandbox carries the mark — applications, training "
          "approvals, transfers, calendar cells, claims, texts and the pool's fills",
          all(v == [] for v in lane["unmarked"].values()), lane["unmarked"])
    check("…and it made some of every kind, so that proof is not about nothing",
          all(lane["made_marked"][k] > 0 for k in ("requests", "handoffs", "edits", "claims",
                                                    "replies", "pool")), lane["made_marked"])
    check("the follow-up net holds no row the rehearsal's fills made, inside the sandbox or out",
          lane["covered_rows"] == [0, 0], lane["covered_rows"])

    print("\n  THE READERS THE REVIEW NAMED, on the real estate")
    check("H1/H2 — the swap asks: with the dial reading send and test mode off, the real lane owes "
          "exactly what it owed before", lane["real_owed_after"]["swap"]
          == lane["real_owed_before"]["swap"], lane["real_owed_after"])
    check("H3 — the ear's acknowledgements: nothing new is owed on the real estate",
          lane["real_owed_after"]["text"] == lane["real_owed_before"]["text"] == [],
          lane["real_owed_after"])
    check("M5 — the pool's notices: nothing new", lane["real_owed_after"]["shift"]
          == lane["real_owed_before"]["shift"], lane["real_owed_after"])
    check("the follow-up net: nothing new", lane["real_owed_after"]["follow"]
          == lane["real_owed_before"]["follow"] == [], lane["real_owed_after"])
    check("H4 — the shift flow's inbox reader hears nothing on the real inbox, and ignores a "
          "rehearsed line even where one lies", lane["real_inbound"] == {} and lane["sbx_inbound"] == {},
          [lane["real_inbound"], lane["sbx_inbound"]])
    check("H5/H11 — the real effective roster carries no rehearsed cell, and the real calendar's "
          "edits, claims, texts and follow-ups hold nothing at all",
          lane["real_effective"] == []
          and lane["real_rows"] == {"asa_house_calendar_claims": 0, "asa_house_calendar_edits": 0,
                                    "asa_sms_replies": 0, "asa_open_shift_covered": 0},
          [lane["real_effective"], lane["real_rows"]])
    check("H8/H12 — not one row of the real estate carries the rehearsal's mark: no application, "
          "training approval, transfer, calendar edit, claim or text — so no notice builder, "
          "Requests list or approval door there can meet one",
          set(lane["real_marked"].values()) == {0}, lane["real_marked"])
    check("H6 — the real pooled shift the sandbox filled is still open on the real estate",
          lane["real_pool_d1"] == [""], lane["real_pool_d1"])
    check("H9 — the real receiver and the real director are waiting on nothing the rehearsal "
          "offered, and a real offer on the very cell of the rehearsed swap takes the open-offer slot",
          lane["real_waiting_on_ben"] == [] and lane["real_offer_same_cell"] == "offered"
          and lane["real_waiting_on_dora"] == [lane["real_hid"]],
          [lane["real_waiting_on_ben"], lane["real_waiting_on_dora"], lane["real_offer_same_cell"]])
    check("H5 — the real live grid shows no square pending, held or played after everything the "
          "sandbox did", lane["real_grid_flags"] == [], lane["real_grid_flags"])
    check("V1-e — a grid read reads the published cells once, for the pending, held and played "
          "marks together", lane["grid_published_reads"] == 1, lane["grid_published_reads"])
    check("the swaps lane's retirement of its old index ran inside the sandbox and dropped only the "
          "sandbox's — the real estate's index of that name still stands, and nothing was stopped",
          lane["real_retired_index"] == 1, lane["real_retired_index"])
    check("H7 — a real decision on a cell the rehearsal applied for is never stopped by the "
          "rehearsal: no rehearsed row stands on the real cell for it to meet",
          lane["real_decision"] not in ("rehearsed_rows", "real_rows"), lane["real_decision"])
    print(f"       (this run: the real decision answered {lane['real_decision']!r})")
    check("H10 — a real house publish finds nothing the rehearsal held",
          lane["real_publish"] == "empty", lane["real_publish"])

    print("\n  THE WALL, attacked from inside a sealed worker")
    probe = lane["probe"]
    check("a table made and written inside the sandbox is let through",
          probe.get("inside") == "done" and probe.get("inside_write") == "done", probe)
    check("a write to a real table is stopped — unqualified, qualified, or hidden in a WITH",
          all(probe.get(k) == "breach" for k in ("unqualified", "qualified", "cte")), probe)
    check("a write done by a FUNCTION the vetting cannot read is caught at the commit and rolled "
          "back — under autocommit too",
          probe.get("function") == "breach" and probe.get("function_autocommit") == "breach", probe)
    check("…and the real table holds nothing: every stopped write was undone",
          lane["probe_left"] == 0, lane["probe_left"])
    check("the connection cannot be moved off the sandbox, nothing is dropped, and a connection "
          "opened on the real path is closed before it is used",
          all(probe.get(k) == "breach" for k in ("path", "drop", "plain_connection")), probe)
    check("no file outside the sandbox directory, no socket, no child process",
          all(probe.get(k) == "refused" for k in ("file", "socket", "child"))
          and lane["outside_file"] is False, probe)
    check("inside the worker the switch holds and the workbook is absent",
          probe.get("switch_holds") is True and probe.get("workbook") == "breach", probe)
    check("L2 — a second statement behind the first, COPY, and SELECT … INTO are stopped whole",
          all(probe.get(k) == "breach" for k in ("multi", "copy_out", "select_into")), probe)
    check("L2 — a real sequence is never moved: qualified, unqualified, or named by a parameter; "
          "and the sandbox's own sequence still is",
          all(probe.get(k) == "breach"
              for k in ("setval_real", "nextval_unqualified", "setval_param"))
          and probe.get("inside_seq") == "done" and probe.get("inside_setval") == "done"
          and lane["probe_seq"] == [1, False], [probe, lane["probe_seq"]])
    check("L2 — no sandbox table is made a partition or a child of a real one, and nothing of the "
          "kind was left behind",
          probe.get("partition_of") == "breach" and probe.get("inherits") == "breach"
          and lane["probe_linked"] == 0 and lane["probe_made"] == [],
          [probe, lane["probe_linked"], lane["probe_made"]])
    check("L-a — a CREATE OR REPLACE of a real view, a TRUNCATE or LOCK list with a real table in "
          "it, an ALTER of a trigger or a materialized view: each stopped whole",
          all(probe.get(k) == "breach" for k in ("or_replace_view", "truncate_list", "lock_list",
                                                 "alter_trigger", "alter_matview")), probe)
    check("REH-2 — a sandbox table is never moved into another schema, no tablespace is emptied, and "
          "a prepared two-phase transaction is never begun",
          all(probe.get(k) == "breach" for k in ("set_schema", "all_in_tablespace", "tpc")), probe)
    check("the one DROP the lanes send is let through only for an index spelled in the sandbox's own "
          "schema; a real index, qualified or not, is stopped",
          probe.get("drop_real_index") == "breach" and probe.get("drop_unqualified_index") == "breach"
          and probe.get("inside_index") == "done" and probe.get("drop_inside_index") == "done",
          probe)
    check("a DELETE FROM ONLY a real table is refused BEFORE it runs, in the vet's own words, not "
          "only rolled back at the commit",
          str(probe.get("delete_only_real")).startswith("breach")
          and "would have been written" in str(probe.get("delete_only_real")), probe)
    check("a RENAME is stopped whole, and after a DROP no name is trusted without a fresh look",
          probe.get("rename") == "breach" and probe.get("known_after_drop") == 0, probe)
    check("V2 — a quoted name glued to its keyword, a quoted set_config, a Unicode-escaped name and a "
          "table made LIKE a real one are each stopped before they run",
          all(probe.get(k) == "breach" for k in ("glued_truncate", "quoted_set_config",
                                                 "unicode_name", "like_real")), probe)
    check("V2-W1 — with the path moved under a remembered name by a call the vet never read, a "
          "TRUNCATE of that name is stopped by the path check before it runs, and the memory goes; "
          "the real table of that name keeps its row",
          str(probe.get("path_moved")).startswith("breach")
          and "now opens on" in str(probe.get("path_moved"))
          and probe.get("known_after_path") == 0 and lane["probe_kept"][0] == 1,
          [probe.get("path_moved"), probe.get("known_after_path"), lane["probe_kept"]])
    ns = probe.get("time_off_ns") or [0, 0, 0]
    check("the Time Off house's lock namespaces are moved clear of the real ones — from the "
          "environment, and by the attribute for a module loaded before the move",
          ns[0] == ns[2] >= 100000 and ns[1] == ns[0] + 1
          and probe.get("time_off_ns_moved") == [108231, 108232],
          [ns, probe.get("time_off_ns_moved")])
    check("…and the real estate is as it was: its table keeps its row, its index stands, no sandbox "
          "table moved into it and no view was made in it",
          lane["probe_kept"] == [1, 1, 0, 0], lane["probe_kept"])
    check("a schema holding somebody else's tables is never taken as the sandbox, and nothing is "
          "added to it", lane["foreign"] == "sandbox_breach"
          and lane["foreign_tables"] == ["somebody_elses"], [lane["foreign"], lane["foreign_tables"]])
    check("V2-W4 — a schema the real estate's path names before it exists is read again once made: "
          "standing on that path, it is rolled back, never kept and never used",
          lane["path_named"][0] == "sandbox_breach"
          and "stood on the real estate's own path" in lane["path_named"][1]
          and lane["path_named_made"] == 0, [lane["path_named"], lane["path_named_made"]])

    print("\n  THE RESET")
    check("it clears every answer still standing and says so",
          lane["reset"]["cleared"] == lane["standing"] and lane["standing"] > 0, lane["reset"])
    check("afterwards the sandbox holds no rehearsed application, no rehearsed swap and no line in "
          "its inbox — only a fresh copy of the estate",
          lane["after_reset_rehearsed"] == [] and lane["after_reset_swaps"] == []
          and lane["after_reset_inbox"] == [],
          [lane["after_reset_rehearsed"], lane["after_reset_swaps"], lane["after_reset_inbox"]])
    check("and the ledger keeps the history, every row marked cleared",
          lane["after_reset_board"] and all(lane["after_reset_board"]), lane["after_reset_board"])

    print("\n  THE SECOND WALL — a rehearsed cell written by hand onto a real house")
    check("the real live grid marks the square as played, and as held",
          any(e == "Dee Way" and played and held for e, _i, played, held in lane["wall_grid"]),
          lane["wall_grid"])
    check("V1-b — a real held write on top of a rehearsed one keeps the square marked as played on "
          "the grid, by the same rule the held list keeps: any rehearsed write in the held chain",
          any(e == "Cy Far" and played and held for e, _i, played, held in lane["wall_grid"])
          and ["Cy Far", True] in lane["wall_held_cells"]
          and ["Dee Way", True] in lane["wall_held_cells"],
          [lane["wall_grid"], lane["wall_held_cells"]])
    check("V1-b — a rehearsed write a real publish landed on is out of the chain: the grid and the "
          "held list both leave the real held write after it unmarked",
          len(lane["wall_grid_republished"]) == 1
          and lane["wall_grid_republished"][0][2:] == [False, True]
          and ["Ann Roe", False] in lane["wall_held_cells"],
          [lane["wall_grid_republished"], lane["wall_held_cells"]])
    check("a real publish_held never lands a played chain on the calendar: nothing else waits there, "
          "so the publish is refused as rehearsal_only, names both cells, and leaves every write "
          "where it is",
          lane["wall_publish"] == ["rehearsal_only", ["Cy Far", "Dee Way"]]
          and lane["wall_left"] == [["test_mode", True]] * 3,
          [lane["wall_publish"], lane["wall_left"]])
    check("L-c — a rehearsed swap whose three consents are in completes inside a sealed worker, and "
          "both cells it writes carry the rehearsal's road (so the second wall knows them); nothing "
          "reached outside and the real estate is unchanged",
          lane["lc"].get("state") == "done"
          and lane["lc"].get("cells") == [["Gil Giver", "", "rehearsal:handoff", "test_mode"],
                                          ["Zed", "4P-10P", "rehearsal:handoff", "test_mode"]]
          and lane["lc"].get("stopped") == [] and lane["lc_real_untouched"] is True,
          [lane["lc"], lane["lc_real_untouched"]])

    print("\n  THE SECOND WALL FOR THE MESSAGE LANES — rehearsed rows written by hand onto a real estate")
    check("V2-owed-second-wall — the pool's notice: a rehearsed application on a closed call-off "
          "tells no house manager; the same application, real, does",
          lane["wall_notice"] == [False, True], lane["wall_notice"])
    check("V2-owed-second-wall — a swap's asks: a rehearsed transfer asks nobody at a daytime clock; "
          "the same transfer without the mark asks",
          lane["wall_asks"][0] == [] and len(lane["wall_asks"][1]) > 0, lane["wall_asks"])
    check("V2-owed-second-wall — a text's acknowledgement: a rehearsed line is owed none at a daytime "
          "clock; the same line, real, is",
          lane["wall_ack"] == [False, True], lane["wall_ack"])
    check("V2-W3 — the follow-up net: a call-off filled by a rehearsed decision is never noted, and a "
          "rehearsed fill already in its ledger is never offered; a real fill is both",
          lane["wall_follow_noted"] == [0, 1] and lane["wall_follow_offered"] == [True, False],
          [lane["wall_follow_noted"], lane["wall_follow_offered"]])
    check("V2-W3 — the estate's open shifts: a rehearsed held write clearing an open shift never "
          "takes it off the list; the same write, real, does",
          lane["wall_open_shifts"] == [True, False], lane["wall_open_shifts"])

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print(f"  FAILED: {name}")
sys.exit(1 if results["failed"] else 0)
