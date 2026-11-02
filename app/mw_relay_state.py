"""The relay's own state tables My Work reads: the one door to them, the rows the relay handed in or asa-hub-db's readers.
Since 2026-10-27 nothing is read from the old platform: the accounts are the Hub's own (db/lane_tables.sql), and `query`
reads every other statement written for the old platform's database on asa-hub-db (lane_tables.here)."""
from __future__ import annotations

import contextlib
import contextvars
import functools
import os
import re
import threading
from datetime import date, datetime, timezone
from typing import Any, Callable, Iterator

from scope import Defer

TABLES = frozenset({
    "asa_shift_requests", "asa_shift_handoffs", "asa_shift_pool", "asa_house_calendar_live",
    "asa_house_calendar_claims", "asa_house_calendar_overrides", "asa_house_day_published", "asa_house_worked_days",
    "asa_time_off_said", "asa_time_off_writes", "asa_users", "asa_calendar_calloff_road"})
META = frozenset({"asa_drive_sheets_meta", "hub_sheet_sync_state"})
# the house calendars' live copy, kept in asa-hub-db's schema app by the sheet keeper (db/house_calendar_live.sql),
# and the accounts, taken from the old platform (db/lane_tables.sql): read there always
HUB_KEPT = frozenset({"asa_house_calendar_live", "asa_users"})
# the relay's own of them, in asa-hub-db's schema app once moved there (db/relay_tables.sql, MOVED_ENV on);
# the mirror's stamps (META) are the sheet keeper's and are not read here
MOVED = frozenset({
    "asa_shift_requests", "asa_shift_handoffs", "asa_shift_pool", "asa_house_calendar_claims",
    "asa_house_calendar_overrides", "asa_house_day_published", "asa_house_worked_days", "asa_time_off_said",
    "asa_time_off_writes", "asa_calendar_calloff_road"})
MOVED_ENV = "HUB_RELAY_TABLES_IN_HUB_DB"
HUB_SCHEMA = "app"
# a table read with these columns alone (never a password, an owner list or an error text); the rest are read whole
COLUMNS: dict[str, tuple[str, ...]] = {
    "asa_users": ("id", "display_name", "entity_name", "role", "active", "merged_into", "email", "phone",
                  "tenant_id", "created_at"),
    "asa_drive_sheets_meta": ("sheet_id", "modified_time", "last_sync_at", "last_sync_status"),
    "hub_sheet_sync_state": ("id", "watermark", "last_pass_at", "listed_at", "last_pass_books", "last_pass_errors"),
}
META_KEY = {"asa_drive_sheets_meta": "sheet_id", "hub_sheet_sync_state": "id"}
# the old platform's read-only DSN, named only so the checks can clear it: nothing here reads it any more
DSN_ENV = "HUB_RELAY_RO_DSN"
STATEMENT_TIMEOUT_MS = int(os.getenv("HUB_RELAY_RO_TIMEOUT_MS", "5000"))
# the payload field the relay hands its rows in
PAYLOAD_KEY = "relay_state"
NO_SOURCE = ("the relay's state is not readable here (no stand-in connection and the relay handed none), "
             "so the relay answers")

_IDENT = re.compile(r"[a-z_][a-z0-9_]*")


class _Request:
    __slots__ = ("handed", "memo")

    def __init__(self, handed: dict[str, Any] | None) -> None:
        self.handed = handed
        self.memo: dict[tuple, list[dict[str, Any]]] = {}


_REQ: contextvars.ContextVar[_Request | None] = contextvars.ContextVar("mw_relay_state", default=None)
_LOCAL = threading.local()
# a stand-in connection (the checks, the sealed sandbox); None reads asa-hub-db
CONNECT: list[Callable[[], Any] | None] = [None]


# ---- the request ---------------------------------------------------------------

@contextlib.contextmanager
def use(given: Any = None) -> Iterator[None]:
    """This request's rows: the relay's handed state (a payload's relay_state, or the state itself), else the DSN."""
    state = None
    if isinstance(given, dict) and PAYLOAD_KEY in given:
        state = given.get(PAYLOAD_KEY)
    elif isinstance(given, dict) and ("tables" in given or any(k in TABLES or k in META for k in given)):
        state = given
    token = _REQ.set(_Request(_decode(state) if state else None))
    try:
        yield
    finally:
        _REQ.reset(token)


def bound(fn: Callable[[Any, dict], Any]) -> Callable[[Any, dict], Any]:
    """An ACTIONS handler (sess, payload) run with its payload's relay state bound."""
    @functools.wraps(fn)
    def run(sess: Any, payload: dict) -> Any:
        with use(payload if isinstance(payload, dict) else None):
            return fn(sess, payload)
    return run


def moved() -> bool:
    """Whether the relay's own tables are read from asa-hub-db (the relay writes them there)."""
    return os.getenv(MOVED_ENV, "").strip().lower() in ("1", "on", "yes", "true")


def source() -> str:
    """Which path answers this request: 'relay' (handed rows), 'dsn', or '' (neither: every read defers)."""
    req = _REQ.get()
    if req is not None and req.handed is not None:
        return "relay"
    return "dsn"


def _decode(state: Any) -> dict[str, dict[str, Any]]:
    """{table: {columns, rows as dicts}} from the relay's {tables: {t: {columns, types, rows}}} or plain {t: [rows]}."""
    if not isinstance(state, dict):
        raise Defer("the relay's handed state is not a table map")
    tables = state.get("tables") if isinstance(state.get("tables"), dict) else state
    out: dict[str, dict[str, Any]] = {}
    for table, got in tables.items():
        if table not in TABLES and table not in META:
            continue
        if isinstance(got, list):
            rows = [dict(r) for r in got if isinstance(r, dict)]
            cols = list(COLUMNS.get(table) or (rows[0].keys() if rows else ()))
            out[table] = {"columns": cols, "rows": rows, "known": bool(rows) or table in COLUMNS}
            continue
        if not isinstance(got, dict) or not isinstance(got.get("columns"), list):
            raise Defer(f"the relay handed {table} in a shape this reader does not know")
        cols = [str(c) for c in got["columns"]]
        types = got.get("types") if isinstance(got.get("types"), dict) else {}
        conv = [(i, _TYPED.get(str(types.get(c) or ""))) for i, c in enumerate(cols)]
        conv = [(i, f) for i, f in conv if f is not None]
        rows = []
        for raw in got.get("rows") or []:
            vals = list(raw)
            for i, f in conv:
                if vals[i] is not None:
                    vals[i] = f(vals[i])
            rows.append(dict(zip(cols, vals)))
        out[table] = {"columns": cols, "rows": rows, "known": True}
    return out


def _ts(v: Any) -> datetime:
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


_TYPED: dict[str, Callable[[Any], Any]] = {"ts": _ts, "date": lambda v: date.fromisoformat(str(v)[:10])}


# ---- the reads -----------------------------------------------------------------

def rows(table: str, where: Any = None, params: Any = (), *, order: str | None = None, limit: int | None = None,
         columns: tuple[str, ...] | None = None) -> list[dict[str, Any]]:
    """The table's rows matching `where` (a WHERE in the accessor's SQL subset, or {column: value | list}); copies."""
    if table not in TABLES and table not in META:
        raise ValueError(f"mw_relay_state reads the relay's state tables alone, not {table!r}")
    plan = _plan(table, where, tuple(params or ()), order, limit, columns)
    req = _REQ.get()
    key = (table, plan.sql_key, _freeze(plan.params))
    if req is not None and key in req.memo:
        return [dict(r) for r in req.memo[key]]
    if req is not None and req.handed is not None:
        got = _from_handed(req.handed, table, plan)
    else:
        got = _from_dsn(table, plan)
    if req is not None:
        req.memo[key] = got
    return [dict(r) for r in got]


def freshness(table: str, key: Any = None) -> dict[str, Any] | None:
    """One row of the relay's sync state: a book's (asa_drive_sheets_meta, by sheet id) or the keeper's (id 1)."""
    if table not in META:
        raise ValueError(f"freshness reads {sorted(META)}, not {table!r}")
    if table == "hub_sheet_sync_state" and key is None:
        key = 1
    got = rows(table, {META_KEY[table]: key}, limit=1)
    return got[0] if got else None


class _Plan:
    __slots__ = ("cond", "order", "limit", "columns", "params", "sql_key")

    def __init__(self, cond: Any, order: list[tuple[str, bool, bool]], limit: Any, columns: tuple[str, ...],
                 params: tuple, sql_key: tuple) -> None:
        self.cond, self.order, self.limit, self.columns, self.params, self.sql_key = \
            cond, order, limit, columns, params, sql_key


def _plan(table: str, where: Any, params: tuple, order: str | None, limit: int | None,
          columns: tuple[str, ...] | None) -> _Plan:
    cond, w_order, w_limit = None, [], None
    if isinstance(where, dict):
        parts = []
        for col, val in where.items():
            _ident(col)
            if isinstance(val, (list, tuple, set, frozenset)):
                parts.append(("any", "=", ("col", col), ("lit", list(val))))
            elif val is None:
                parts.append(("is", False, ("col", col), "null"))
            else:
                parts.append(("cmp", "=", ("col", col), ("lit", val)))
        cond = ("and", parts) if parts else None
    elif isinstance(where, str) and where.strip():
        cond, w_order, w_limit = _parse(re.sub(r"^\s*where\s+", "", where, flags=re.I))
    elif where not in (None, ""):
        raise ValueError("where is a WHERE text or a {column: value} map")
    if order:
        if w_order:
            raise ValueError("the order is given twice")
        toks = _tokens(order)
        w_order, end = _parse_order(toks, 0)
        if end != len(toks):
            raise ValueError(f"the order does not read past {toks[end:end + 2]!r}")
    if limit is not None:
        if w_limit is not None:
            raise ValueError("the limit is given twice")
        w_limit = ("lit", int(limit))
    cols = tuple(columns) if columns else COLUMNS.get(table, ())
    for c in cols:
        _ident(c)
    if table in COLUMNS and not set(cols) <= set(COLUMNS[table]):
        raise ValueError(f"{table} is read with {COLUMNS[table]} alone")
    return _Plan(cond, w_order, w_limit, cols, params,
                 (repr(cond), repr(w_order), repr(w_limit), cols))


def _ident(name: Any) -> str:
    if not isinstance(name, str) or not _IDENT.fullmatch(name):
        raise ValueError(f"not a column name: {name!r}")
    return name


def _freeze(v: Any) -> Any:
    if isinstance(v, (list, tuple, set, frozenset)):
        return tuple(_freeze(x) for x in v)
    if isinstance(v, dict):
        return tuple(sorted((k, _freeze(x)) for k, x in v.items()))
    return v


# ---- the WHERE subset: comparisons, ANY/ALL, IN, IS, LIKE, AND/OR/NOT, lower/btrim/coalesce/nullif/regexp_replace

_TOKEN = re.compile(r"\s*(?:(?P<str>'(?:[^']|'')*')|(?P<num>\d+(?:\.\d+)?)|(?P<param>%s)"
                    r"|(?P<ident>[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)"
                    r"|(?P<op><>|!=|<=|>=|::|[=<>(),]))")
_FUNCS = {"lower": (1, 1), "upper": (1, 1), "btrim": (1, 1), "trim": (1, 1), "coalesce": (1, 9), "nullif": (2, 2),
          "regexp_replace": (3, 4)}
_CASTS = {"text": "text", "varchar": "text", "int": "int", "integer": "int", "bigint": "int", "date": "date"}
_SQL_CAST = {"text": "text", "int": "bigint", "date": "date"}
_KEYWORDS = {"and", "or", "not", "is", "null", "true", "false", "in", "any", "all", "like", "ilike", "order", "by",
             "asc", "desc", "nulls", "first", "last", "limit", "some"}


def _tokens(text: str) -> list[tuple[str, Any]]:
    out, pos, n = [], 0, len(text)
    while pos < n:
        if text[pos:].strip() == "":
            break
        m = _TOKEN.match(text, pos)
        if not m or m.end() == pos:
            raise ValueError(f"the accessor's WHERE subset stops at {text[pos:pos + 24]!r}")
        pos = m.end()
        kind = m.lastgroup
        val = m.group(kind)
        if kind == "str":
            out.append(("lit", val[1:-1].replace("''", "'")))
        elif kind == "num":
            out.append(("lit", float(val) if "." in val else int(val)))
        elif kind == "param":
            out.append(("param", None))
        elif kind == "ident" and val.lower() in _KEYWORDS:
            out.append(("kw", val.lower()))
        elif kind == "ident":
            out.append(("ident", val.split(".")[-1].lower()))
        else:
            out.append(("op", val))
    return out


def _parse(text: str) -> tuple[Any, list, Any]:
    toks = _tokens(text)
    p = _Parser(toks)
    cond = None if p.peek() == ("kw", "order") or p.peek() == ("kw", "limit") else p.or_expr()
    order: list = []
    lim = None
    if p.peek() == ("kw", "order"):
        order, p.i = _parse_order(toks, p.i)
    if p.peek() == ("kw", "limit"):
        p.i += 1
        lim = p.primary()
        if lim[0] not in ("param", "lit"):
            raise ValueError("LIMIT takes %s or a number")
    if p.i != len(toks):
        raise ValueError(f"the accessor's WHERE subset does not read {toks[p.i:p.i + 3]!r}")
    return cond, order, lim


def _parse_order(toks: list, i: int) -> tuple[list[tuple[str, bool, bool]], int]:
    if toks[i:i + 2] == [("kw", "order"), ("kw", "by")]:
        i += 2
    out = []
    while True:
        if i >= len(toks) or toks[i][0] != "ident":
            raise ValueError("ORDER BY takes plain columns")
        col = _ident(toks[i][1])
        i += 1
        desc = False
        if i < len(toks) and toks[i] in (("kw", "asc"), ("kw", "desc")):
            desc = toks[i][1] == "desc"
            i += 1
        nulls_last = not desc
        if i < len(toks) and toks[i] == ("kw", "nulls"):
            if i + 1 >= len(toks) or toks[i + 1] not in (("kw", "first"), ("kw", "last")):
                raise ValueError("NULLS takes FIRST or LAST")
            nulls_last = toks[i + 1][1] == "last"
            i += 2
        out.append((col, desc, nulls_last))
        if i < len(toks) and toks[i] == ("op", ","):
            i += 1
            continue
        return out, i


class _Parser:
    def __init__(self, toks: list) -> None:
        self.toks, self.i, self.n_params = toks, 0, 0

    def peek(self, k: int = 0) -> tuple[str, Any] | None:
        return self.toks[self.i + k] if self.i + k < len(self.toks) else None

    def take(self, tok: tuple[str, Any]) -> None:
        if self.peek() != tok:
            raise ValueError(f"expected {tok[1]!r} at {self.peek()!r}")
        self.i += 1

    def or_expr(self) -> Any:
        parts = [self.and_expr()]
        while self.peek() == ("kw", "or"):
            self.i += 1
            parts.append(self.and_expr())
        return parts[0] if len(parts) == 1 else ("or", parts)

    def and_expr(self) -> Any:
        parts = [self.not_expr()]
        while self.peek() == ("kw", "and"):
            self.i += 1
            parts.append(self.not_expr())
        return parts[0] if len(parts) == 1 else ("and", parts)

    def not_expr(self) -> Any:
        if self.peek() == ("kw", "not"):
            self.i += 1
            return ("not", self.not_expr())
        return self.predicate()

    def predicate(self) -> Any:
        if self.peek() == ("op", "("):
            self.i += 1
            inner = self.or_expr()
            self.take(("op", ")"))
            return inner
        left = self.value()
        tok = self.peek()
        if tok is not None and tok[0] == "op" and tok[1] in ("=", "<>", "!=", "<", "<=", ">", ">="):
            op = "<>" if tok[1] == "!=" else tok[1]
            self.i += 1
            if self.peek() in (("kw", "any"), ("kw", "some"), ("kw", "all")):
                which = "all" if self.peek() == ("kw", "all") else "any"
                self.i += 1
                self.take(("op", "("))
                right = self.value()
                self.take(("op", ")"))
                return (which, op, left, right)
            return ("cmp", op, left, self.value())
        negate = False
        if tok == ("kw", "not") and self.peek(1) in (("kw", "in"), ("kw", "like"), ("kw", "ilike")):
            negate = True
            self.i += 1
            tok = self.peek()
        if tok == ("kw", "in"):
            self.i += 1
            self.take(("op", "("))
            vals = [self.value()]
            while self.peek() == ("op", ","):
                self.i += 1
                vals.append(self.value())
            self.take(("op", ")"))
            return ("in", negate, left, vals)
        if tok in (("kw", "like"), ("kw", "ilike")):
            self.i += 1
            return ("like", negate, tok[1] == "ilike", left, self.value())
        if tok == ("kw", "is"):
            self.i += 1
            neg = False
            if self.peek() == ("kw", "not"):
                neg = True
                self.i += 1
            what = self.peek()
            if what not in (("kw", "null"), ("kw", "true"), ("kw", "false")):
                raise ValueError("IS takes NULL, TRUE or FALSE")
            self.i += 1
            return ("is", neg, left, what[1])
        return ("bool", left)

    def value(self) -> Any:
        node = self.primary()
        while self.peek() == ("op", "::"):
            self.i += 1
            tok = self.peek()
            if tok is None or tok[0] != "ident" or tok[1] not in _CASTS:
                raise ValueError(f"the accessor casts to {sorted(_CASTS)} alone")
            self.i += 1
            node = ("cast", node, _CASTS[tok[1]])
        return node

    def primary(self) -> Any:
        tok = self.peek()
        if tok is None:
            raise ValueError("the WHERE ends too soon")
        self.i += 1
        if tok[0] == "param":
            node = ("param", self.n_params)
            self.n_params += 1
            return node
        if tok[0] == "lit":
            return ("lit", tok[1])
        if tok in (("kw", "true"), ("kw", "false")):
            return ("lit", tok[1] == "true")
        if tok == ("kw", "null"):
            return ("lit", None)
        if tok[0] == "ident" and self.peek() == ("op", "("):
            name = tok[1]
            if name not in _FUNCS:
                raise ValueError(f"the accessor knows {sorted(_FUNCS)}, not {name}()")
            self.i += 1
            args = [self.value()]
            while self.peek() == ("op", ","):
                self.i += 1
                args.append(self.value())
            self.take(("op", ")"))
            lo, hi = _FUNCS[name]
            if not lo <= len(args) <= hi:
                raise ValueError(f"{name}() takes {lo}..{hi} arguments")
            return ("fn", name, args)
        if tok[0] == "ident":
            return ("col", tok[1])
        if tok == ("op", "("):
            inner = self.value()
            self.take(("op", ")"))
            return inner
        raise ValueError(f"the accessor's WHERE subset does not read {tok!r}")


# ---- the DSN: the same plan rendered as SQL ----------------------------------------

def _sql(node: Any, params: tuple, out: list) -> str:
    kind = node[0]
    if kind == "col":
        return f'"{_ident(node[1])}"'
    if kind == "param":
        out.append(_param(params, node[1]))
        return "%s"
    if kind == "lit":
        if node[1] is None:
            return "NULL"
        if isinstance(node[1], bool):
            return "TRUE" if node[1] else "FALSE"
        out.append(node[1])
        return "%s"
    if kind == "fn":
        return f"{node[1]}(" + ", ".join(_sql(a, params, out) for a in node[2]) + ")"
    if kind == "cast":
        return f"({_sql(node[1], params, out)})::{_SQL_CAST[node[2]]}"
    if kind == "cmp":
        left = _sql(node[2], params, out)
        return f"({left} {node[1]} {_sql(node[3], params, out)})"
    if kind in ("any", "all"):
        left = _sql(node[2], params, out)
        return f"({left} {node[1]} {node[0].upper()}({_sql(node[3], params, out)}))"
    if kind == "in":
        left = _sql(node[2], params, out)
        vals = ", ".join(_sql(v, params, out) for v in node[3])
        return f"({left} {'NOT ' if node[1] else ''}IN ({vals}))"
    if kind == "like":
        left = _sql(node[3], params, out)
        return f"({left} {'NOT ' if node[1] else ''}{'ILIKE' if node[2] else 'LIKE'} {_sql(node[4], params, out)})"
    if kind == "is":
        return f"({_sql(node[2], params, out)} IS {'NOT ' if node[1] else ''}{node[3].upper()})"
    if kind == "bool":
        return f"({_sql(node[1], params, out)})"
    if kind in ("and", "or"):
        return "(" + f" {kind.upper()} ".join(_sql(p, params, out) for p in node[1]) + ")"
    if kind == "not":
        return f"(NOT {_sql(node[1], params, out)})"
    raise ValueError(f"unknown node {kind}")


def _param(params: tuple, i: int) -> Any:
    if i >= len(params):
        raise ValueError("the WHERE names more %s than it was given")
    v = params[i]
    return list(v) if isinstance(v, (tuple, set, frozenset)) else v


def _connect() -> Any:
    held = getattr(_LOCAL, "conn", None)
    if held is not None and not getattr(held, "closed", False):
        return held
    if CONNECT[0] is None:
        # the old platform is never connected to: every read without a stand-in goes through query / _from_hub
        raise Defer(NO_SOURCE)
    conn = CONNECT[0]()
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("set session characteristics as transaction read only")
        cur.execute(f"set statement_timeout = {int(STATEMENT_TIMEOUT_MS)}")
    _LOCAL.conn = conn
    return conn


def _drop() -> None:
    held, _LOCAL.conn = getattr(_LOCAL, "conn", None), None
    try:
        if held is not None:
            held.close()
    except Exception:  # noqa: BLE001 - a dead connection closes as it can
        pass


def _from_hub(table: str, sql: str, args: list) -> list[dict[str, Any]]:
    """A read of asa-hub-db through the process's one reader (hubdb.shared), never a connection of its own."""
    import hubdb  # noqa: PLC0415 - the checks run without the driver
    try:
        return hubdb.shared().dict_rows(sql, args)
    except Exception as exc:  # noqa: BLE001 - the relay's state not answering is said, never an empty list
        raise Defer(f"the relay's {table} could not be read ({type(exc).__name__}), so the relay answers") from exc


def query(sql: str, args: Any = None) -> list[dict[str, Any]]:
    """One read written for the old platform's database: on a stand-in's connection (the checks), else on asa-hub-db's
    readers with its tables named in schema app."""
    if CONNECT[0] is None:
        import lane_tables  # noqa: PLC0415
        import hubdb  # noqa: PLC0415 - the checks run without the driver
        return hubdb.shared().dict_rows(lane_tables.here(sql), args)
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            names = [d[0] for d in cur.description or ()]
            return [dict(r) if isinstance(r, dict) else dict(zip(names, r)) for r in cur.fetchall()]
    except Exception:
        _drop()
        raise


def _from_dsn(table: str, plan: _Plan) -> list[dict[str, Any]]:
    args: list = []
    picked = ", ".join(f'"{c}"' for c in plan.columns) or "*"
    if table in META and CONNECT[0] is None:
        raise Defer(f"the sheet keeper's {table} is not read here")
    hub = CONNECT[0] is None
    sql = f'SELECT {picked} FROM {HUB_SCHEMA + "." if hub else ""}"{table}"'
    if plan.cond is not None:
        sql += " WHERE " + _sql(plan.cond, plan.params, args)
    if plan.order:
        sql += " ORDER BY " + ", ".join(f'"{c}" {"DESC" if d else "ASC"} NULLS {"LAST" if nl else "FIRST"}'
                                        for c, d, nl in plan.order)
    if plan.limit is not None:
        sql += " LIMIT " + _sql(plan.limit, plan.params, args)
    if hub:
        return _from_hub(table, sql, args)
    try:
        conn = _connect()
        with conn.cursor() as cur:
            cur.execute(sql, args)
            names = [d[0] for d in cur.description]
            return [dict(zip(names, r)) if not isinstance(r, dict) else dict(r) for r in cur.fetchall()]
    except Defer:
        raise
    except Exception as exc:  # noqa: BLE001 - the relay's state not answering is said, never an empty list
        _drop()
        raise Defer(f"the relay's {table} could not be read ({type(exc).__name__}), so the relay answers") from exc


# ---- the handed rows: the same plan, evaluated as Postgres would --------------------

def _from_handed(handed: dict[str, dict[str, Any]], table: str, plan: _Plan) -> list[dict[str, Any]]:
    got = handed.get(table)
    if got is None:
        raise Defer(f"the relay handed no {table}, so the relay answers")
    cols = set(got["columns"])
    if got.get("known"):
        for c in _columns_of(plan):
            if c not in cols:
                raise Defer(f"the relay handed {table} without {c}, so the relay answers")
    try:
        out = [r for r in got["rows"] if plan.cond is None or _truth(plan.cond, r, plan.params) is True]
        if plan.order:
            for col, desc, nulls_last in reversed(plan.order):
                rank = 1 if nulls_last != desc else -1
                out.sort(key=lambda r, c=col, k=rank: (k, 0) if r.get(c) is None else (0, _sortable(r.get(c))),
                         reverse=desc)
        if plan.limit is not None:
            n = _value(plan.limit, {}, plan.params)
            out = out[:max(0, int(n))] if n is not None else out
    except Defer:
        raise
    except (TypeError, ValueError) as exc:
        raise Defer(f"the relay's {table} could not be read as asked ({exc}), so the relay answers") from exc
    if plan.columns and plan.columns != tuple(got["columns"]):
        return [{c: r.get(c) for c in plan.columns} for r in out]
    return out


def _columns_of(plan: _Plan) -> set[str]:
    found: set[str] = set(plan.columns) | {c for c, _d, _n in plan.order}

    def walk(node: Any) -> None:
        if isinstance(node, tuple):
            if node and node[0] == "col":
                found.add(node[1])
                return
            for x in node[1:]:
                walk(x)
        elif isinstance(node, list):
            for x in node:
                walk(x)
    walk(plan.cond)
    return found


def _value(node: Any, row: dict[str, Any], params: tuple) -> Any:
    kind = node[0]
    if kind == "col":
        return row.get(node[1])
    if kind == "param":
        return _param(params, node[1])
    if kind == "lit":
        return node[1]
    if kind == "cast":
        return _cast(_value(node[1], row, params), node[2])
    name, args = node[1], [_value(a, row, params) for a in node[2]]
    if name == "coalesce":
        return next((a for a in args if a is not None), None)
    if name == "nullif":
        return None if args[0] is not None and args[1] is not None and _cmp("=", args[0], args[1]) else args[0]
    if args[0] is None:
        return None
    s = _text(args[0])
    if name == "lower":
        return s.lower()
    if name == "upper":
        return s.upper()
    if name in ("btrim", "trim"):
        return s.strip(" ")
    if name == "regexp_replace":
        if args[1] is None or args[2] is None:
            return None
        flags = str(args[3] or "") if len(args) > 3 else ""
        if set(flags) - {"g", "i"}:
            raise ValueError(f"regexp_replace flags {flags!r}")
        rep = re.sub(r"\\(\d)", r"\\\1", str(args[2])).replace("\\&", "&")
        return re.sub(str(args[1]), rep, s, count=0 if "g" in flags else 1,
                      flags=re.IGNORECASE if "i" in flags else 0)
    raise ValueError(f"unknown function {name}")


def _text(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, datetime):
        s = v.isoformat(sep=" ")
        return s[:-3] if s.endswith(":00") and len(s) > 6 and s[-6] in "+-" else s
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, (dict, list)):
        raise ValueError("a json value read as text")
    return str(v)


def _cast(v: Any, to: str) -> Any:
    if v is None:
        return None
    if to == "text":
        return _text(v)
    if to == "int":
        if isinstance(v, bool):
            raise ValueError("a boolean cast to an integer")
        return int(str(v).strip()) if not isinstance(v, int) else v
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).date()
    if isinstance(v, date):
        return v
    return date.fromisoformat(str(v).strip()[:10])


def _aligned(a: Any, b: Any) -> tuple[Any, Any]:
    if isinstance(a, bool) or isinstance(b, bool):
        if isinstance(a, str):
            a = a.strip().lower() in ("t", "true", "yes", "on", "1")
        if isinstance(b, str):
            b = b.strip().lower() in ("t", "true", "yes", "on", "1")
        return a, b
    if isinstance(a, (int, float)) and isinstance(b, str):
        return a, float(b) if "." in b else int(b)
    if isinstance(b, (int, float)) and isinstance(a, str):
        return float(a) if "." in a else int(a), b
    if isinstance(a, datetime) or isinstance(b, datetime):
        return _instant(a), _instant(b)
    if isinstance(a, date) and isinstance(b, str):
        return a, date.fromisoformat(b.strip()[:10])
    if isinstance(b, date) and isinstance(a, str):
        return date.fromisoformat(a.strip()[:10]), b
    if isinstance(a, (dict, list)) or isinstance(b, (dict, list)):
        raise ValueError("a json value compared")
    if type(a) is not type(b) and not (isinstance(a, (int, float)) and isinstance(b, (int, float))):
        return _text(a), _text(b)
    return a, b


def _instant(v: Any) -> datetime:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day, tzinfo=timezone.utc)
    got = _ts(str(v).strip())
    return got if got.tzinfo else got.replace(tzinfo=timezone.utc)


def _cmp(op: str, a: Any, b: Any) -> bool | None:
    if a is None or b is None:
        return None
    a, b = _aligned(a, b)
    if isinstance(a, str) and isinstance(b, str) and op not in ("=", "<>"):
        a, b = _sortable(a), _sortable(b)
    return {"=": a == b, "<>": a != b, "<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b}[op]


def _sortable(v: Any) -> Any:
    """en_US.utf8's order, near enough: letters and digits first, case after; any other value as it is."""
    if isinstance(v, str):
        return (re.sub(r"[^0-9a-z]", "", v.lower()), v.swapcase())
    if isinstance(v, (dict, list)):
        raise ValueError("a json value ordered")
    return v


def _three(values: list[bool | None], any_: bool) -> bool | None:
    if any_:
        return True if True in values else None if None in values else False
    return False if False in values else None if None in values else True


def _like(s: Any, pat: Any, ci: bool) -> bool | None:
    if s is None or pat is None:
        return None
    out, esc = [], False
    for ch in str(pat):
        if esc:
            out.append(re.escape(ch))
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == "%":
            out.append(".*")
        elif ch == "_":
            out.append(".")
        else:
            out.append(re.escape(ch))
    return re.fullmatch("".join(out), _text(s), re.S | (re.I if ci else 0)) is not None


def _truth(node: Any, row: dict[str, Any], params: tuple) -> bool | None:
    kind = node[0]
    if kind == "and":
        return _three([_truth(p, row, params) for p in node[1]], False)
    if kind == "or":
        return _three([_truth(p, row, params) for p in node[1]], True)
    if kind == "not":
        got = _truth(node[1], row, params)
        return None if got is None else not got
    if kind == "cmp":
        return _cmp(node[1], _value(node[2], row, params), _value(node[3], row, params))
    if kind in ("any", "all"):
        left, arr = _value(node[2], row, params), _value(node[3], row, params)
        if arr is None:
            return None
        if not isinstance(arr, (list, tuple, set, frozenset)):
            raise ValueError("ANY/ALL takes a list")
        if not arr:
            return kind == "all"
        return _three([_cmp(node[1], left, x) for x in arr], kind == "any")
    if kind == "in":
        left = _value(node[2], row, params)
        got = _three([_cmp("=", left, _value(v, row, params)) for v in node[3]], True)
        return None if got is None else (not got if node[1] else got)
    if kind == "like":
        got = _like(_value(node[3], row, params), _value(node[4], row, params), node[2])
        return None if got is None else (not got if node[1] else got)
    if kind == "is":
        v = _value(node[2], row, params)
        if node[3] == "null":
            hit = v is None
        else:
            if v is not None and not isinstance(v, bool):
                v = _aligned(v, True)[0]
            hit = v is (node[3] == "true")
        return not hit if node[1] else hit
    if kind == "bool":
        v = _value(node[1], row, params)
        if v is None:
            return None
        return v if isinstance(v, bool) else _aligned(v, True)[0]
    raise ValueError(f"unknown predicate {kind}")
