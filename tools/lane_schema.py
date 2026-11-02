"""A lane's own room: its modules in a folder of the run's own, its tables in a schema of its own.

A lane test runs in the relay container against the real database, with
search_path = <lane schema>, public. Two things can then put the verdict on
something that is not under test:

- the modules. A folder shared by every run is overwritten by a concurrent run
  from another checkout, and a lazy import then loads that checkout's code. A
  module the run did not ship loads from the container's working directory,
  which is the live checkout. `script` writes every module the roots reach to
  /tmp/<tag>-test-<random>, takes the working directory off the path, and
  removes the folder when the lane exits.
- the tables. A table the lane has not made in its schema resolves to the
  production table of the same name, so a first read lands on live rows and a
  write can land there too. `own` makes the lane's tables before any test
  runs, then refuses to start while any table the shipped code names still
  resolves outside the lane.
- the schemas themselves. A lane killed mid-run (a relay restart kills every
  process it exec'd) never reaches its `finally`, and its schemas stay. Every
  lane takes its schemas from `Rooms`: one prefix (hub_test_), each name
  locked by the run's own session before it exists, dropped when the run
  ends, and dropped by the next run's `sweep` once no session holds its lock.
  Liveness is the lock, never a pid: a pid in the container restarts with
  the container, and a host pid means nothing inside it.

The host half imports this file; the lane half is shipped beside the modules
and imported in the container as `lane_schema`.
"""
from __future__ import annotations

import ast
import base64
import json
import os
import re
from pathlib import Path
from typing import Any, Callable, Iterable

# A relation named in SQL: after FROM / JOIN / INTO / UPDATE / TABLE / INDEX [IF [NOT] EXISTS], or inside
# to_regclass('…'). Unqualified names only: a name the code qualifies itself does not depend on the search path.
_NAMED = re.compile(
    r"(?:\b(?:from|join|into|update)\s+|\b(?:table|index)\s+(?:if\s+(?:not\s+)?exists\s+)?|to_regclass\(\s*')"
    r"([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_.])",
    re.IGNORECASE)
# A statement that changes a relation.
_WRITES = re.compile(
    r"\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?|alter\s+(?:table|index)(?:\s+if\s+exists)?"
    r"|drop\s+(?:table|index)(?:\s+if\s+exists)?)\s+([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_.])",
    re.IGNORECASE)
_MADE = re.compile(r"^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?([A-Za-z_][A-Za-z0-9_]*)\b", re.IGNORECASE)
_SYSTEM = frozenset({"pg_catalog", "information_schema", "pg_toast"})


class Stray(RuntimeError):
    """A table the lane touches resolves outside the lane's schema."""


# ── host half ────────────────────────────────────────────────────────────────

def with_imports(server: Path, roots: Iterable[str]) -> dict[str, str]:
    """The roots and every server module they import, lazily or not, plus the data files beside them."""
    local = {p.stem for p in server.glob("*.py")}
    sources: dict[str, str] = {}
    todo = list(roots)
    while todo:
        name = todo.pop()
        if name in sources:
            continue
        sources[name] = (server / f"{name}.py").read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(sources[name])):
            if isinstance(node, ast.Import):
                todo += [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                todo.append(node.module.split(".")[0])
        todo = [n for n in todo if n in local]
    for data in server.glob("*.json"):
        sources[data.name] = data.read_text(encoding="utf-8")
    return sources


def run_dir(tag: str) -> str:
    """A folder no other run shares."""
    return f"/tmp/{tag}-test-{os.urandom(4).hex()}"


def script(sources: dict[str, str], body: str, tag: str, here: str | None = None) -> str:
    """The script a lane runs in the container: its modules, this helper, then `body`.

    `body` finds the folder as LANE_DIR; it is first on the path and removed when the lane exits.
    """
    here = here or run_dir(tag)
    shipped = dict(sources)
    shipped["lane_schema"] = Path(__file__).read_text(encoding="utf-8")
    blob = base64.b64encode(json.dumps(shipped).encode()).decode()
    return (
        "import atexit, base64, json, os, pathlib, shutil, sys\n"
        f"LANE_DIR = {here!r}\n"
        "pathlib.Path(LANE_DIR).mkdir(parents=True)\n"
        "atexit.register(shutil.rmtree, LANE_DIR, True)\n"
        f"for k, v in json.loads(base64.b64decode({blob!r})).items():\n"
        "    (pathlib.Path(LANE_DIR) / (k if '.' in k else k + '.py')).write_text(v)\n"
        # the working directory is the live checkout: a module not shipped must fail, not load from there
        "sys.path[:] = [p for p in sys.path if p not in ('', os.getcwd())]\n"
        "sys.path.insert(0, LANE_DIR)\n"
        + body)


def self_stop(script_text: str, budget_s: int) -> str:
    """`script_text` stopping itself a minute before the host gives up on it: the host's timeout kills only the
    `docker exec` client, and a lane left running holds its rooms. A lane that sets its own alarm keeps its own."""
    if re.match(r"\s*(?:#[^\n]*\n\s*)*from\s+__future__\s", script_text):
        return script_text
    stop = max(1, int(budget_s) - 60)
    return ("import signal as _lane_signal\n"
            "def _lane_stop(*_a):\n"
            f"    raise TimeoutError('the lane ran past {stop}s and stopped itself')\n"
            "_lane_signal.signal(_lane_signal.SIGALRM, _lane_stop)\n"
            f"_lane_signal.alarm({stop})\n" + script_text)


def run_in(container: str, script_text: str, timeout: int = 300, env: dict[str, str] | None = None
           ) -> dict[str, Any] | None:
    """The lane's LANE_RESULT; None only when no container can run it; a crash is {"crash", "trace"}.

    A lane that ran and printed nothing CRASHED — it is never a lane that was skipped.
    """
    import subprocess  # noqa: PLC0415

    flags = [a for k, v in (env or {}).items() for a in ("-e", f"{k}={v}")]
    try:
        proc = subprocess.run(["docker", "exec", "-i", *flags, container, "python3", "-"],
                              input=self_stop(script_text, timeout), capture_output=True, text=True,
                              timeout=timeout)
    except FileNotFoundError:
        return None
    except subprocess.TimeoutExpired:
        return {"crash": f"the lane ran past {timeout}s and was killed", "trace": ""}
    for line in (proc.stdout or "").splitlines():
        if line.startswith("LANE_RESULT "):
            return json.loads(line[len("LANE_RESULT "):])
    running = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", container],
                             capture_output=True, text=True).stdout.strip() == "true"
    if not running:
        return None
    return {"crash": "the lane printed no result",
            "trace": ((proc.stdout or "")[-1500:] + (proc.stderr or "")[-3000:])}


def named_tables(source: str) -> set[str]:
    """Every unqualified name the source uses where SQL names a table, lower-cased as Postgres folds it."""
    return {m.lower() for m in _NAMED.findall(source)}


def written_tables(source: str) -> set[str]:
    """Every unqualified name the source inserts into, updates, deletes from, truncates, alters or drops."""
    return {m.lower() for m in _WRITES.findall(source)}


def made_tables(make: Iterable[Any]) -> list[str]:
    """The tables the SQL steps of `make` create."""
    out = []
    for step in make:
        m = _MADE.match(step) if isinstance(step, str) else None
        if m and m.group(1).lower() not in out:
            out.append(m.group(1).lower())
    return out


# ── lane half ────────────────────────────────────────────────────────────────

def where(cur, name: str) -> str | None:
    """The schema `name` resolves to on this connection's search path, or None when nothing is there."""
    try:
        cur.execute("SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE c.oid = to_regclass(%s)", (name,))
        row = cur.fetchone()
    except Exception:  # noqa: BLE001 — a name Postgres cannot even parse names no table
        cur.connection.rollback()
        return None
    return row[0] if row else None


def _index_table(cur, name: str) -> str | None:
    """The table an index is on, when `name` resolves to an index; None otherwise."""
    try:
        cur.execute("SELECT t.relname FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid "
                    "WHERE i.indexrelid = to_regclass(%s)", (name,))
        row = cur.fetchone()
    except Exception:  # noqa: BLE001
        cur.connection.rollback()
        return None
    return row[0] if row else None


def _sources(scan: str | dict[str, str] | None) -> dict[str, str]:
    if scan is None:
        return {}
    if isinstance(scan, dict):
        return {k: v for k, v in scan.items() if not k.endswith(".json")}
    return {p.stem: p.read_text(encoding="utf-8") for p in Path(scan).glob("*.py") if p.stem != "lane_schema"}


def own(dsn: str, schema: str, *, make: Iterable[str | Callable[[str], Any]] = (),
        names: Iterable[str] = (), scan: str | dict[str, str] | None = None,
        public_ok: Iterable[str] = (), later: Iterable[str] = (),
        pointers: Iterable[tuple[Any, str]] = ()) -> dict[str, Any]:
    """Make the lane's tables, then prove every table it touches resolves in `schema`.

    make       DDL statements, or callables taking the lane's dsn, run in order on the lane
    names      tables the lane owns: each must resolve in `schema` once `make` has run; every
               table a CREATE TABLE in `make` makes is one of them
    scan       the shipped modules (a folder, or name -> source): every table their SQL names
               that resolves outside `schema` is a stray, unless listed in `public_ok` or `later`
    public_ok  production tables this lane leaves in public on purpose: read-only mirrors, or
               tables whose one reader the lane stands in; a shipped module that writes one
               refuses the lane, since that write would land in production
    later      tables the code under test creates itself; `assert_owned` holds them once it has
    pointers   (module, attribute) pairs naming a table, e.g. a stand-in for a production book;
               each must resolve in `schema`
    Returns where the owned names and pointers resolved, and which public_ok tables stayed in
    public. Raises Stray before any test can run.
    """
    import psycopg2  # noqa: PLC0415 — the host half runs with no driver

    make = list(make)
    names = list(dict.fromkeys([*made_tables(make), *(n.lower() for n in names)]))
    later = {n.lower() for n in later}
    public_ok = {n.lower() for n in public_ok}
    sources = _sources(scan)
    writers = sorted(f"{mod} writes {t}" for mod, text in sources.items()
                     for t in written_tables(text) & public_ok)
    if writers:
        raise Stray(f"lane {schema}: left in public yet written by the shipped code: " + ", ".join(writers))
    conn = psycopg2.connect(dsn)
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SELECT (current_schemas(false))[1]")
            first = (cur.fetchone() or [None])[0]
            if first != schema:
                raise Stray(f"the lane's schema {schema} is not first on its search path "
                            f"(first is {first!r}): every table would resolve elsewhere")
            for step in make:
                if callable(step):
                    step(dsn)
                else:
                    cur.execute(step)
    finally:
        conn.close()
    pointed = {}
    for module, attr in pointers:
        pointed[f"{getattr(module, '__name__', module)}.{attr}"] = str(getattr(module, attr))
    found = {}
    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        for name in names:
            found[name] = where(cur, name)
        for label, table in pointed.items():
            found[table] = where(cur, table)
        scanned = set()
        for text in sources.values():
            scanned |= named_tables(text)
        on = {}
        for name in sorted(scanned - set(found)):
            found[name] = where(cur, name)
            if found[name] not in (None, schema):
                on[name] = _index_table(cur, name) or name
    unowned = [n for n in names if found[n] != schema]
    unpointed = [f"{label} = {t} ({found[t] or 'nowhere'})" for label, t in pointed.items() if found[t] != schema]
    # An index outside the lane matters only when the shipped code drops or alters it by name: a
    # CREATE INDEX IF NOT EXISTS lands beside its table, and a read never names an index.
    written = set()
    for text in sources.values():
        written |= written_tables(text)
    strays = sorted(n for n, s in found.items()
                    if s is not None and s != schema and s not in _SYSTEM
                    and (on.get(n, n) == n or n in written)
                    and on.get(n, n) not in public_ok and on.get(n, n) not in later
                    and n not in names and n not in pointed.values())
    faults = []
    if unowned:
        faults.append("not made in the lane: " + ", ".join(f"{n} ({found[n] or 'nowhere'})" for n in unowned))
    if unpointed:
        faults.append("a stand-in outside the lane: " + ", ".join(unpointed))
    if strays:
        faults.append("named by the shipped code and resolving outside the lane: "
                      + ", ".join(f"{found[n]}.{n}" for n in strays))
    if faults:
        raise Stray(f"lane {schema}: " + "; ".join(faults))
    return {"lane": {n: found[n] for n in [*names, *pointed.values()]},
            "left_in_public": sorted(n for n in public_ok if found.get(n) not in (None, schema)),
            "scanned": len(found)}


# ── the test base: one prefix, one lock class, one sweep ────────────────────

ROOM_PREFIX = "hub_test_"
# the rooms' advisory-lock class; not spelled *LOCK_NS* so the rehearsal worker never shifts it
ROOM_KEY = 8299
ROOM_NAME = re.compile(r"^hub_test_[a-z0-9_]{1,54}$")
# the names suites spelled before the test base; reported, never swept: an older checkout may be running one
LEGACY_ROOM = re.compile(
    r"^(?:rh_(?:real|sbx|foreign|newbox)_\d+_\d+"
    r"|(?:house_calendars|shift_requests|effective_roster|cal_builder_houses|open_shift_covered"
    r"|calloff_open_shift|punch_pairs|hm_training|sms_ears|shift_transfer|comm_calls_deliver)_test2?_\d+(?:_broken)?"
    r"|time_off_test_\d+_\d+"
    r"|(?:lane_schema_test|lane_schema_decoy|web_notices_test|web_push_test)_[0-9a-f]{8}"
    r"|house_meds_test_[a-z]+_[0-9a-f]{8})$")


def room_tag(tag: str) -> str:
    """`tag` as it may stand inside a room's name."""
    out = re.sub(r"[^a-z0-9]+", "_", str(tag).lower()).strip("_")[:24]
    if not out:
        raise ValueError(f"{tag!r} names no room")
    return out


def _rooms(cur) -> list[str]:
    cur.execute("SELECT nspname FROM pg_namespace WHERE nspname LIKE %s ORDER BY 1",
                (ROOM_PREFIX.replace("_", "\\_") + "%",))
    return [r[0] for r in cur.fetchall() if ROOM_NAME.match(r[0])]


def sweep(dsn: str, *, drop: bool = True) -> dict[str, list[str]]:
    """Every room whose owner is gone is dropped (only listed when `drop` is false); a room whose lock
    is held is kept. Legacy names are listed, never touched."""
    import psycopg2  # noqa: PLC0415

    out: dict[str, list[str]] = {"dropped": [], "dead": [], "alive": [], "legacy": []}
    conn = psycopg2.connect(dsn)
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '300s'")
            cur.execute("SELECT nspname FROM pg_namespace ORDER BY 1")
            out["legacy"] = [r[0] for r in cur.fetchall() if LEGACY_ROOM.match(r[0])]
            for name in _rooms(cur):
                cur.execute("SELECT pg_try_advisory_lock(%s, hashtext(%s))", (ROOM_KEY, name))
                if not cur.fetchone()[0]:
                    out["alive"].append(name)
                    continue
                try:
                    if drop:
                        cur.execute(f'DROP SCHEMA IF EXISTS "{name}" CASCADE')
                    out["dropped" if drop else "dead"].append(name)
                finally:
                    cur.execute("SELECT pg_advisory_unlock(%s, hashtext(%s))", (ROOM_KEY, name))
    finally:
        conn.close()
    return out


def _stop_on_term(signum, _frame):
    raise SystemExit(128 + signum)


class Rooms:
    """This run's schemas: hub_test_<tag>_<run>[_<role>], each locked by the run's own session before it
    exists and dropped by `close` (at exit at the latest). A run killed before `close` leaves them to the
    next run's sweep, which finds their lock free once the session is gone."""

    def __init__(self, dsn: str, tag: str, *, run: str | None = None) -> None:
        import atexit  # noqa: PLC0415
        import signal  # noqa: PLC0415

        import psycopg2  # noqa: PLC0415

        self.dsn, self.tag = dsn, room_tag(tag)
        self.run = run or os.urandom(4).hex()
        self.names: list[str] = []
        self.closed: dict[str, Any] | None = None
        self.swept = sweep(dsn)
        self._hold = psycopg2.connect(dsn)
        self._hold.autocommit = True
        with self._hold.cursor() as cur:
            cur.execute("SET statement_timeout = '300s'")
        atexit.register(self.close)
        if signal.getsignal(signal.SIGTERM) is signal.SIG_DFL:
            signal.signal(signal.SIGTERM, _stop_on_term)

    def name(self, role: str = "") -> str:
        """A room this run holds without making it: for a schema the code under test creates itself."""
        name = f"{ROOM_PREFIX}{self.tag}_{self.run}" + (f"_{room_tag(role)}" if role else "")
        if not ROOM_NAME.match(name):
            raise ValueError(f"{name!r} is not a room name")
        if name in self.names:
            return name
        if self._hold is None:
            raise Stray(f"room {name}: the run's rooms are already closed")
        with self._hold.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s, hashtext(%s))", (ROOM_KEY, name))
            if not cur.fetchone()[0]:
                raise Stray(f"room {name}: its lock is held by another session")
        self.names.append(name)
        return name

    def make(self, role: str = "") -> str:
        """A room this run holds, made empty."""
        name = self.name(role)
        with self._hold.cursor() as cur:
            cur.execute(f'CREATE SCHEMA "{name}"')
            cur.execute(f'COMMENT ON SCHEMA "{name}" IS %s', (json.dumps(
                {"tag": self.tag, "run": self.run, "pid": os.getpid(), "backend": self._hold.get_backend_pid()}),))
        return name

    def remake(self, name: str) -> str:
        """One of this run's rooms dropped and made again, empty."""
        if name not in self.names or self._hold is None:
            raise Stray(f"room {name}: not a room this run still holds")
        with self._hold.cursor() as cur:
            cur.execute(f'DROP SCHEMA IF EXISTS "{name}" CASCADE')
            cur.execute(f'CREATE SCHEMA "{name}"')
        return name

    def path(self, *schemas: str, public: bool = True) -> str:
        """The dsn whose search path opens on `schemas`, then public."""
        path = [*schemas, *(["public"] if public else [])]
        return self.dsn + ("&" if "?" in self.dsn else "?") + "options=-csearch_path%3D" + "%2C".join(path)

    def close(self) -> dict[str, Any]:
        """Every room of this run dropped; the session that held them ends, so any left is the next sweep's."""
        if self.closed is not None:
            return self.closed
        left: list[str] = list(self.names)
        why = ""
        try:
            with self._hold.cursor() as cur:
                for name in reversed(self.names):
                    try:
                        cur.execute(f'DROP SCHEMA IF EXISTS "{name}" CASCADE')
                    except Exception as exc:  # noqa: BLE001 — a room not dropped here is the next sweep's
                        why = why or f"{type(exc).__name__}: {exc}"[:300]
                cur.execute("SELECT nspname FROM pg_namespace WHERE nspname = ANY(%s)", (self.names,))
                left = [r[0] for r in cur.fetchall()]
        except Exception as exc:  # noqa: BLE001
            why = why or f"{type(exc).__name__}: {exc}"[:300]
        finally:
            try:
                self._hold.close()
            except Exception:  # noqa: BLE001, S110
                pass
            self._hold = None
        self.closed = {"rooms": list(self.names), "left": left, "why": why,
                       "swept": self.swept["dropped"], "legacy": self.swept["legacy"]}
        return self.closed


def assert_owned(dsn: str, schema: str, names: Iterable[str]) -> dict[str, str | None]:
    """Each name resolves in `schema` now. Raises Stray naming the ones that do not."""
    import psycopg2  # noqa: PLC0415

    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        found = {n.lower(): where(cur, n) for n in names}
    wrong = [f"{n} ({s or 'nowhere'})" for n, s in found.items() if s != schema]
    if wrong:
        raise Stray(f"lane {schema}: not in the lane: " + ", ".join(wrong))
    return found


# What the shift lanes read and no shipped module writes: the synced sheets, the roster copy and the
# users copy. Only the sheet sync writes them, and no lane ships it; `own` refuses a lane that would.
MIRRORS = ("asa_drive_sheets_rows", "asa_drive_sheets_meta", "hub_sheet_sync_state", "hub_sheet_sync_tabs",
           "asa_schedules", "asa_schedule_parsed", "asa_users")

LIVE_DDL = ("CREATE TABLE IF NOT EXISTS asa_house_calendar_live (location TEXT PRIMARY KEY, "
            "grid JSONB, updated_at TIMESTAMPTZ DEFAULT now())")


def shift_family(skip: Iterable[str] = ()) -> list[str]:
    """The shift family's tables as the modules that own them declare them, in `own`'s `make` form.

    `skip` leaves tables to the code under test, with every statement that names them: an ALTER
    kept for a table not made here would alter the production one. Imports from the lane's folder,
    so only inside a lane.
    """
    import calendar_builder_houses as cbh  # noqa: PLC0415
    import calendar_builder_write as cbw  # noqa: PLC0415
    import calloff_road  # noqa: PLC0415
    import house_cal_live as hcl  # noqa: PLC0415
    import open_shift_covered as osc  # noqa: PLC0415
    import punch_pairs as pp  # noqa: PLC0415
    import shift_handoff as sh  # noqa: PLC0415
    import shift_requests as sr  # noqa: PLC0415
    import sms_ears  # noqa: PLC0415
    import time_off  # noqa: PLC0415
    import web_notices as wn  # noqa: PLC0415

    steps = [LIVE_DDL, hcl.OVERRIDES_DDL, hcl.CLAIMS_DDL, hcl.EDITS_DDL, *hcl.EDITS_COLUMNS_DDL,
             sh.HANDOFFS_DDL, *sh.COLUMNS_DDL, sh.OPEN_INDEX_DDL, *sr.DDL, calloff_road.DDL, *osc.DDL,
             *wn.DDL, *sms_ears.DDL, *time_off.DDL, cbh.DRAFT_DDL, cbw.DRAFT_DDL, cbw.PERIODS_DDL,
             cbw.PUBLISH_LOG_DDL, *pp.DDL]
    left = [re.compile(rf"\b{re.escape(s.lower())}\b", re.IGNORECASE) for s in skip]
    return [s for s in steps if not any(p.search(s) for p in left)]


TRACKER_DDL = ("CREATE TABLE IF NOT EXISTS lane_tracker (timestamp TEXT, date TEXT, type TEXT, your_name TEXT, "
               "employee_name TEXT, notes_include_reason_and_how_much_advanced_notice TEXT)")


def tracker_stand_in() -> tuple[str, tuple[Any, str]]:
    """The Call Off Tracker's one reader pointed at an empty book of the lane's own.

    The production name is schema-qualified, so no search path keeps a lane off it; the pointer
    moves before the first read. Returns the make step and the pointer `own` holds.
    """
    import psi_attendance  # noqa: PLC0415

    psi_attendance.TRACKER_TABLE = "lane_tracker"
    return TRACKER_DDL, (psi_attendance, "TRACKER_TABLE")


def own_shift_lane(dsn: str, schema: str, scan: str | dict[str, str], *, skip: Iterable[str] = (),
                   later: Iterable[str] = (), make: Iterable[Any] = (), names: Iterable[str] = (),
                   pointers: Iterable[tuple[Any, str]] = (), public_ok: Iterable[str] = ()) -> dict[str, Any]:
    """`own` for a lane of the shift family: its tables, the tracker stand-in, the mirrors left in public."""
    tracker, pointer = tracker_stand_in()
    return own(dsn, schema, make=[*shift_family(skip), tracker, *make], names=names, scan=scan,
               public_ok=(*MIRRORS, *public_ok), later=later, pointers=[pointer, *pointers])


if __name__ == "__main__":  # python3 tools/lane_schema.py [--drop] — the test base's rooms, read in the relay
    import sys  # noqa: PLC0415

    DROP = "--drop" in sys.argv[1:]
    got = run_in(os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot"), script({}, (
        "import json, os, lane_schema\n"
        f"print('LANE_RESULT ' + json.dumps(lane_schema.sweep(os.environ['HUB_SNAPSHOT_PG_DSN'], drop={DROP!r})))\n"),
        "rooms"), timeout=360)
    print(json.dumps(got, indent=2))
    sys.exit(0 if got and "crash" not in got else 1)
