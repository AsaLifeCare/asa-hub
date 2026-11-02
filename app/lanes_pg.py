"""The database surface the scheduling lanes were written against (psycopg2, and the relay's hub_db), over the app's
own psycopg 3 connections. The relay's own tables (schema app of asa-hub-db) are written on the thread's shared writer
connection (writes.Store's), one transaction at a time, with search_path app; a second connection opened while the
first is still open gets a spare of its own, as the relay's pool gave one. A connection switched to autocommit holds
its session advisory locks on the thread's lock connection and lets each one go when it closes. What the lanes read
from the old platform's database (the accounts, the roster, the alerts, the punches…) is the Hub's own since 2026-10-27:
a statement opened on the old platform's connection is read on asa-hub-db's reader, its tables named in schema app
(lane_tables.here). Nothing opens a connection to the old platform; a statement naming its sheet mirror is refused."""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from types import SimpleNamespace
from typing import Any, Callable, Iterable

log = logging.getLogger("asa-hub-app.lanes-pg")

try:
    import psycopg
    from psycopg.rows import dict_row, tuple_row
except ImportError:  # the checks import the lanes without the driver; nothing connects until a lane runs
    psycopg = None
    dict_row = tuple_row = None

SCHEMA = "app"
STATEMENT_TIMEOUT = os.getenv("HUB_LANES_STATEMENT_TIMEOUT", "120s").strip() or "120s"
APP_NAME = "asa-hub-app-lanes"
_MIRROR = re.compile(r"\b(asa_drive_sheets_rows|asa_drive_sheets_meta|hub_sheet_sync_state)\b", re.I)
_LOCKS = re.compile(r"pg_advisory_lock\s*\(", re.I)

# stand-ins for the checks: callables opening the writer's, a spare's and the read-only connection
CONNECT: dict[str, Callable[[], Any] | None] = {"own": None, "spare": None, "intel": None}
# the search path the own connections open on; a sealed rehearsal worker hands its sandbox's
PATH: list[str] = [""]


def _path() -> str:
    return PATH[0] or f"{SCHEMA}, public"

_Base = getattr(psycopg, "Error", Exception)
Error = _Base
OperationalError = getattr(psycopg, "OperationalError", Exception)
IntegrityError = getattr(psycopg, "IntegrityError", Exception)
ProgrammingError = getattr(psycopg, "ProgrammingError", Exception)
DatabaseError = getattr(psycopg, "DatabaseError", Exception)
InterfaceError = getattr(psycopg, "InterfaceError", Exception)
errors = getattr(psycopg, "errors", SimpleNamespace())


class MirrorRefused(_Base):
    """A lane asked the old platform for a sheet: asa-hub-db holds them."""


class Json:
    """psycopg2.extras.Json: the value written as its JSON text."""

    def __init__(self, adapted: Any, dumps: Callable[[Any], str] | None = None) -> None:
        self.adapted, self._dumps = adapted, dumps or json.dumps

    def text(self) -> str:
        return self._dumps(self.adapted)


class RealDictCursor:
    """The marker a lane hands cursor(): rows as {column: value}."""


def _arg(v: Any) -> Any:
    return v.text() if isinstance(v, Json) else v


def _args(args: Any) -> Any:
    if args is None:
        return None
    if isinstance(args, dict):
        return {k: _arg(v) for k, v in args.items()}
    return [_arg(v) for v in args]


# ---- the thread's physical connections ----------------------------------------------------------------------------

class _Phys:
    __slots__ = ("conn", "kind", "busy")

    def __init__(self, conn: Any, kind: str) -> None:
        self.conn, self.kind, self.busy = conn, kind, False


_LOCAL = threading.local()


def _held() -> dict[str, Any]:
    got = getattr(_LOCAL, "held", None)
    if got is None:
        got = _LOCAL.held = {"spares": [], "lock": None}
    return got


def _writer_dsn() -> str:
    return os.getenv("HUB_DB_WRITE_DSN", "").strip()


def _shared_writer() -> Any:
    """The thread's writer connection every store shares (writes.Store)."""
    if CONNECT["own"] is not None:
        held = _held()
        c = held.get("own")
        if c is None or getattr(c, "closed", False):
            c = held["own"] = CONNECT["own"]()
        return c
    import writes  # noqa: PLC0415 - the app's own plumbing, loaded with main
    store = _held().get("store")
    if store is None:
        store = _held()["store"] = writes.Store(label="the scheduling lanes")
    if not store.available:
        raise OperationalError("no HUB_DB_WRITE_DSN is set, so the scheduling lanes cannot reach asa-hub-db")
    return store.conn()


def _open_own() -> Any:
    if CONNECT["spare"] is not None:
        return CONNECT["spare"]()
    dsn = _writer_dsn()
    if not dsn or psycopg is None:
        raise OperationalError("no HUB_DB_WRITE_DSN is set, so the scheduling lanes cannot reach asa-hub-db")
    c = psycopg.connect(dsn, autocommit=True, connect_timeout=5, application_name=APP_NAME)
    return c


def _intel_conn() -> Any:
    """The connection the old platform's reads run on: a stand-in's (the checks, the sealed sandbox), else asa-hub-db's reader of
    this thread."""
    if CONNECT["intel"] is not None:
        held = _held()
        c = held.get("intel")
        if c is None or getattr(c, "closed", False):
            c = held["intel"] = CONNECT["intel"]()
        return c
    import hubdb  # noqa: PLC0415 - the process's one reader of asa-hub-db
    return hubdb.shared().conn()


def _take_tx() -> _Phys:
    """A free transactional connection: the shared writer's first, then a spare."""
    held = _held()
    shared = held.get("shared")
    conn = _shared_writer()
    if shared is None or shared.conn is not conn:
        shared = held["shared"] = _Phys(conn, "shared")
    if not shared.busy and _idle(shared.conn):
        shared.busy = True
        return shared
    for p in held["spares"]:
        if not p.busy and not getattr(p.conn, "closed", False):
            p.busy = True
            return p
    p = _Phys(_open_own(), "spare")
    p.busy = True
    held["spares"].append(p)
    return p


def _take_lock() -> _Phys:
    """The thread's autocommit connection: session locks and table making, with search_path app."""
    held = _held()
    p = held.get("lock")
    if p is None or getattr(p.conn, "closed", False):
        c = _open_own()
        c.execute(f"set search_path to {_path()}")
        p = held["lock"] = _Phys(c, "lock")
    return p


def _idle(conn: Any) -> bool:
    try:
        return conn.info.transaction_status == psycopg.pq.TransactionStatus.IDLE if psycopg is not None else True
    except Exception:  # noqa: BLE001 - a connection that cannot say is not taken
        return False


def finish() -> None:
    """After a lane's call: nothing left open, every lock let go, the spares closed; the shared writer stays."""
    held = getattr(_LOCAL, "held", None)
    if not held:
        return
    shared = held.get("shared")
    if shared is not None:
        _end(shared.conn)
        shared.busy = False
    for p in held["spares"]:
        _close(p.conn)
    held["spares"] = []
    lock = held.get("lock")
    if lock is not None:
        _close(lock.conn)
        held["lock"] = None
    for key in ("own", "intel"):
        c = held.get(key)
        if c is not None:
            _end(c)


def _end(conn: Any) -> None:
    try:
        if not _idle(conn):
            conn.execute("ROLLBACK")
    except Exception:  # noqa: BLE001 - a broken connection is dropped by its owner on its next use
        pass


def _close(conn: Any) -> None:
    try:
        conn.close()
    except Exception:  # noqa: BLE001
        pass


# ---- the cursor ---------------------------------------------------------------------------------------------------

class Cursor:
    """A psycopg2 cursor: execute, the fetches, rowcount and description, on its connection's physical one."""

    def __init__(self, conn: "Conn", dicts: bool) -> None:
        self.connection = conn
        self._dicts = dicts
        self._cur: Any = None
        self.closed = False

    def _client(self, phys: Any) -> Any:
        if self._cur is None or self._cur.connection is not phys:
            self._cur = psycopg.ClientCursor(phys, row_factory=dict_row if self._dicts else tuple_row)
        return self._cur

    def execute(self, sql: Any, args: Any = None) -> None:
        self.connection._execute(self, sql if not isinstance(sql, (str, bytes)) else str(sql), _args(args))

    def executemany(self, sql: Any, seq: Iterable[Any]) -> None:
        for args in seq:
            self.execute(sql, args)

    def mogrify(self, sql: Any, args: Any = None) -> bytes:
        phys = self.connection._phys_for_mogrify()
        return psycopg.ClientCursor(phys).mogrify(str(sql), _args(args)).encode()

    def fetchone(self) -> Any:
        return self._cur.fetchone() if self._cur is not None else None

    def fetchall(self) -> list[Any]:
        return list(self._cur.fetchall()) if self._cur is not None else []

    def fetchmany(self, size: int | None = None) -> list[Any]:
        if self._cur is None:
            return []
        return list(self._cur.fetchmany(size) if size is not None else self._cur.fetchmany())

    def __iter__(self):
        return iter(self.fetchall())

    @property
    def rowcount(self) -> int:
        return self._cur.rowcount if self._cur is not None else -1

    @property
    def description(self) -> Any:
        return self._cur.description if self._cur is not None else None

    @property
    def statusmessage(self) -> str:
        return str(getattr(self._cur, "statusmessage", "") or "") if self._cur is not None else ""

    def close(self) -> None:
        self.closed = True

    def __enter__(self) -> "Cursor":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


# ---- the connections ----------------------------------------------------------------------------------------------

class Conn:
    """A psycopg2 connection's surface; each kind decides where its statements run."""

    kind = ""

    def __init__(self) -> None:
        self.closed = 0
        self._autocommit = False

    @property
    def autocommit(self) -> bool:
        return self._autocommit

    @autocommit.setter
    def autocommit(self, on: bool) -> None:
        self._autocommit = bool(on)

    def cursor(self, cursor_factory: Any = None, name: Any = None, **_k: Any) -> Cursor:
        return Cursor(self, cursor_factory is RealDictCursor)

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass

    def close(self) -> None:
        self.closed = 1

    def __enter__(self) -> "Conn":
        return self

    def __exit__(self, kind: Any, value: Any, tb: Any) -> None:
        try:
            if kind is None:
                self.commit()
            else:
                self.rollback()
        finally:
            self.close()

    def _execute(self, cur: Cursor, sql: str, args: Any) -> None:
        raise NotImplementedError

    def _phys_for_mogrify(self) -> Any:
        raise NotImplementedError


class ReadConn(Conn):
    """What was the old platform's database, read-only: each statement on its own, nothing to commit, read on
    asa-hub-db with its tables named in schema app."""

    kind = "intel"

    def _execute(self, cur: Cursor, sql: Any, args: Any) -> None:
        if isinstance(sql, str) and _MIRROR.search(sql):
            raise MirrorRefused("the sheets are read from asa-hub-db, never from the old platform's mirror")
        if isinstance(sql, str):
            import lane_tables  # noqa: PLC0415
            sql = lane_tables.here(sql)
        cur._client(_intel_conn()).execute(sql, args)

    def _phys_for_mogrify(self) -> Any:
        return _intel_conn()


class OwnConn(Conn):
    """The relay's own tables in asa-hub-db: a transaction on the thread's writer (or a spare) until commit or
    rollback; in autocommit, each statement on the lock connection, its session locks let go at close."""

    kind = "own"

    def __init__(self) -> None:
        super().__init__()
        self._phys: _Phys | None = None
        self._in_tx = False
        self._locks: list[tuple[str, Any]] = []

    @property
    def autocommit(self) -> bool:
        return self._autocommit

    @autocommit.setter
    def autocommit(self, on: bool) -> None:
        if self._in_tx:
            raise ProgrammingError("set_session cannot be used inside a transaction")
        self._release()
        self._autocommit = bool(on)

    def _execute(self, cur: Cursor, sql: str, args: Any) -> None:
        if self.closed:
            raise InterfaceError("connection already closed")
        if self._autocommit:
            p = _take_lock()
            cur._client(p.conn).execute(sql, args)
            if isinstance(sql, str) and _LOCKS.search(sql):
                self._locks.append((_LOCKS.sub("pg_advisory_unlock(", sql), args))
            return
        if self._phys is None:
            self._phys = _take_tx()
        conn = self._phys.conn
        if not self._in_tx:
            conn.execute("BEGIN")
            self._in_tx = True
            conn.execute(f"SET LOCAL search_path TO {_path()}")
            conn.execute(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'")
        cur._client(conn).execute(sql, args)

    def _phys_for_mogrify(self) -> Any:
        if self._autocommit:
            return _take_lock().conn
        if self._phys is None:
            self._phys = _take_tx()
        return self._phys.conn

    def commit(self) -> None:
        if self._in_tx and self._phys is not None:
            self._in_tx = False
            self._phys.conn.execute("COMMIT")

    def rollback(self) -> None:
        if self._in_tx and self._phys is not None:
            self._in_tx = False
            try:
                self._phys.conn.execute("ROLLBACK")
            except Exception:  # noqa: BLE001 - a dead connection rolled itself back
                pass

    def get_transaction_status(self) -> int:
        return 2 if self._in_tx else 0

    def _release(self) -> None:
        if self._phys is not None:
            if self._in_tx:
                self.rollback()
            self._phys.busy = False
            self._phys = None
        if self._locks:
            taken, self._locks = self._locks, []
            p = _held().get("lock")
            if p is not None:
                try:
                    for sql, args in reversed(taken):
                        psycopg.ClientCursor(p.conn).execute(sql, args)
                except Exception:  # noqa: BLE001 - a lock connection that died let its locks go with it
                    _close(p.conn)
                    _held()["lock"] = None

    def close(self) -> None:
        if not self.closed:
            self._release()
        self.closed = 1

    def __del__(self) -> None:
        try:
            if not self.closed:
                self._release()
        except Exception:  # noqa: BLE001 - as psycopg2 lets a forgotten connection go
            pass


# ---- psycopg2's face ----------------------------------------------------------------------------------------------

def connect(dsn: Any = None, **_kw: Any) -> ReadConn:
    """psycopg2.connect(PG_DSN): the old platform's database."""
    return ReadConn()


def execute_values(cur: Cursor, sql: str, argslist: Iterable[Any], template: str | None = None,
                   page_size: int = 100, fetch: bool = False) -> list[Any] | None:
    """psycopg2.extras.execute_values: the rows written as one VALUES list per page."""
    pieces = re.split(r"(%%|%s)", sql)
    at = pieces.index("%s")
    head = "".join("%" if p == "%%" else p for p in pieces[:at])
    tail = "".join("%" if p == "%%" else p for p in pieces[at + 1:])
    rows = list(argslist)
    got: list[Any] = []
    for i in range(0, len(rows), max(1, page_size)):
        parts = []
        for r in rows[i:i + page_size]:
            tpl = template or "(" + ",".join(["%s"] * len(r)) + ")"
            parts.append(cur.mogrify(tpl, r).decode())
        cur.execute(head + ",".join(parts) + tail)
        if fetch:
            got.extend(cur.fetchall())
    return got if fetch else None


extras = SimpleNamespace(RealDictCursor=RealDictCursor, Json=Json, execute_values=execute_values,
                         register_default_json=lambda *a, **k: None, register_default_jsonb=lambda *a, **k: None)
extensions = SimpleNamespace(TRANSACTION_STATUS_IDLE=0)


# ---- the relay's hub_db face ---------------------------------------------------------------------------------------

def own_connect(fallback: Any = None, **_kw: Any) -> OwnConn:
    """hub_db.connect: a connection for the relay's own tables, in asa-hub-db."""
    return OwnConn()


def intel(where: Any = None, **_kw: Any) -> ReadConn:
    """hub_db.intel: the old platform's database."""
    return ReadConn()


def _dicts(cur: Any) -> bool:
    return bool(getattr(cur, "_dicts", False))


def beside(cur: Any, where: Any, sql: str, args: Any = None) -> list[Any]:
    """hub_db.beside: rows of one of the old platform's tables read in the middle of the relay's own."""
    other = ReadConn()
    with other.cursor(cursor_factory=RealDictCursor if _dicts(cur) else None) as c:
        c.execute(sql, args)
        return c.fetchall()


def own(cur: Any, sql: str, args: Any = None) -> list[Any]:
    """hub_db.own: rows of one of the relay's own tables read in the middle of a read of the old platform's."""
    with OwnConn() as conn, conn.cursor(cursor_factory=RealDictCursor if _dicts(cur) else None) as c:
        c.execute(sql, args)
        return c.fetchall()
