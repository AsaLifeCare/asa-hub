"""asa-hub-db for the relay's own tables (schema app, as asa_hub_app_rw): one small pool for the whole process.

HUB_RELAY_DB_DSN names it; unset, every lane keeps its tables in the database it is handed, as before. A pooled
connection goes back when its `with` block ends or it is closed; one whose session was changed (autocommit, read-only,
a session lock taken that way) is ended instead, so nothing it held outlives it. the old platform's own tables (the
mirror, the accounts, the house calendars) are read through intel(), never through the pool."""
from __future__ import annotations

import os
import threading
import time
import weakref
from typing import Any

try:
    import psycopg2
except ImportError:  # the host's checks import the lanes with no driver: nothing here connects until it is used
    psycopg2 = None
try:
    import psycopg2.extensions as _ext
except ImportError:  # no driver, or a stand-in one (the lifted suites): no pool, every lane keeps its tables
    _ext = None

ENV = "HUB_RELAY_DB_DSN"
SCHEMA = "app"
APP_NAME = "asa-hub-snapshot"
SIZE = max(1, int(os.getenv("HUB_RELAY_DB_POOL", "10")))
# a thread already holding one may take this many more without waiting: a lock held while its rows are written
SPARE = max(1, int(os.getenv("HUB_RELAY_DB_SPARE", "10")))
WAIT_S = max(0.1, float(os.getenv("HUB_RELAY_DB_WAIT_S", "15")))
IDLE_PING_S = 30.0
_IDLE = _ext.TRANSACTION_STATUS_IDLE if _ext is not None else 0


class Exhausted(getattr(psycopg2, "OperationalError", Exception)):
    """Every pooled connection stayed taken for WAIT_S."""


def dsn() -> str:
    return os.getenv(ENV, "").strip()


def on() -> bool:
    """Whether the relay's own tables are asa-hub-db's."""
    return bool(dsn()) and _ext is not None


def schema() -> str:
    """The schema a qualified name of the relay's tables names: app in asa-hub-db, public where they were."""
    return SCHEMA if on() else "public"


def _driver() -> Any:
    """psycopg2 as it stands when asked (a sealed rehearsal worker guards its connect)."""
    import psycopg2 as driver  # noqa: PLC0415 - absent on the host's checks until a lane connects
    return driver


def intel(where: str, **kw: Any) -> Any:
    """A connection to the old platform's database, as every lane opened one before."""
    return _driver().connect(where, **kw)


def beside(cur: Any, where: str, sql: str, args: Any = None) -> list[Any]:
    """Rows of one of the old platform's tables read in the middle of the relay's own: on `cur` while they are in
    one database, else on a connection of its own to `where`; rows shaped as `cur` shapes them."""
    if not on():
        cur.execute(sql, args)
        return list(cur.fetchall())
    import psycopg2.extras  # noqa: PLC0415
    dicts = isinstance(cur, psycopg2.extras.RealDictCursor)
    conn = intel(where)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor if dicts else None) as other:
            other.execute(sql, args)
            return list(other.fetchall())
    finally:
        conn.close()


def own(cur: Any, sql: str, args: Any = None) -> list[Any]:
    """Rows of one of the relay's own tables read in the middle of a read of the old platform's: on `cur` while
    they are in one database, else on a pooled connection; rows shaped as `cur` shapes them."""
    if not on():
        cur.execute(sql, args)
        return list(cur.fetchall())
    import psycopg2.extras  # noqa: PLC0415
    dicts = isinstance(cur, psycopg2.extras.RealDictCursor)
    with _POOL.take() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor if dicts else None) as mine:
        mine.execute(sql, args)
        return list(mine.fetchall())


def connect(fallback: str, **kw: Any) -> Any:
    """A connection for the relay's own tables: asa-hub-db's pool, else `fallback` as before."""
    if not on():
        return _driver().connect(fallback, **kw)
    return _POOL.take()


class _Conn(_ext.connection if _ext is not None else object):
    """A pooled connection: leaving its `with` block or closing it hands it back."""

    lease: object | None = None

    def __enter__(self) -> "_Conn":
        self._entered = self.lease
        return self

    def __exit__(self, kind: Any, value: Any, tb: Any) -> None:
        # psycopg2's own: commit, or roll back on an exception; then the pool's: hand it back
        if self.lease is None or self.lease is not getattr(self, "_entered", None):
            return
        try:
            if kind is None:
                self.commit()
            else:
                self.rollback()
        finally:
            self.close()

    def close(self) -> None:
        _POOL.give(self)

    def end(self) -> None:
        try:
            _ext.connection.close(self)
        except Exception:  # noqa: BLE001 - a dead connection ends as it can
            pass


def _clean(conn: _Conn) -> bool:
    """Whether the connection may serve another caller: open, idle, and its session as it was made."""
    try:
        if conn.closed:
            return False
        if conn.get_transaction_status() != _IDLE:
            conn.rollback()
        return (not conn.autocommit and conn.readonly is None and conn.deferrable is None
                and conn.isolation_level is None and conn.get_transaction_status() == _IDLE)
    except Exception:  # noqa: BLE001 - one that cannot say is ended
        return False


class _Pool:
    def __init__(self) -> None:
        # reentrant: a leaked connection's finalizer may run inside this thread's own critical section
        self._lock = threading.RLock()
        self._idle: list[tuple[_Conn, float]] = []
        self._slots = threading.BoundedSemaphore(SIZE)
        self._spare = threading.BoundedSemaphore(SPARE)
        self._depth: dict[int, int] = {}
        self._out: dict[int, tuple[threading.BoundedSemaphore, int, Any]] = {}

    def take(self) -> _Conn:
        me = threading.get_ident()
        with self._lock:
            gate = self._spare if self._depth.get(me, 0) else self._slots
        if not gate.acquire(timeout=WAIT_S):
            raise Exhausted(f"asa-hub-db's pool stayed full for {WAIT_S:g}s")
        try:
            conn = self._reuse() or self._new()
        except BaseException:
            gate.release()
            raise
        with self._lock:
            self._depth[me] = self._depth.get(me, 0) + 1
            fin = weakref.finalize(conn, self._lost, id(conn))
            self._out[id(conn)] = (gate, me, fin)
            conn.lease = object()
        return conn

    def give(self, conn: _Conn) -> None:
        with self._lock:
            held = self._out.pop(id(conn), None)
            if held is None:
                return
            gate, me, fin = held
            fin.detach()
            self._leave(me)
            conn.lease = None
        try:
            if _clean(conn):
                with self._lock:
                    if len(self._idle) < SIZE:
                        self._idle.append((conn, time.monotonic()))
                        return
            conn.end()
        finally:
            gate.release()

    def _lost(self, key: int) -> None:
        with self._lock:
            held = self._out.pop(key, None)
            if held is not None:
                self._leave(held[1])
        if held is not None:
            held[0].release()

    def _leave(self, me: int) -> None:
        left = self._depth.get(me, 0) - 1
        if left > 0:
            self._depth[me] = left
        else:
            self._depth.pop(me, None)

    def _reuse(self) -> _Conn | None:
        while True:
            with self._lock:
                if not self._idle:
                    return None
                conn, since = self._idle.pop()
            if time.monotonic() - since < IDLE_PING_S:
                return conn
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                conn.rollback()
                return conn
            except Exception:  # noqa: BLE001 - asa-hub-db restarted under it: a new one is opened
                conn.end()

    def _new(self) -> _Conn:
        where = dsn()
        opts = str(psycopg2.extensions.parse_dsn(where).get("options") or "")
        if "search_path" not in opts:
            where = psycopg2.extensions.make_dsn(
                where, options=(f"{opts} " if opts else "") + f"-c search_path={SCHEMA}")
        return psycopg2.connect(where, connection_factory=_Conn, connect_timeout=5, application_name=APP_NAME)

    def size(self) -> dict[str, int]:
        with self._lock:
            return {"idle": len(self._idle), "taken": len(self._out), "size": SIZE, "spare": SPARE}


_POOL = _Pool()


def stats() -> dict[str, int]:
    """The pool now: idle and taken connections, and its bounds."""
    return _POOL.size()
