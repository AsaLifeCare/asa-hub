"""The rehearsal's sandbox: one worker process per rehearsed answer, which can reach no real row, no real file……"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
import tempfile
import threading
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import psycopg2
import psycopg2.extensions
import psycopg2.extras
import psycopg2.sql

log = logging.getLogger("hub.rehearsalsandbox")

# asa-hub-db, where the relay's own tables are once moved (server/hub_db.py): the copy's source, never the worker's
HUB_ENV = "HUB_RELAY_DB_DSN"
HUB_SCHEMA = "app"

UTC = timezone.utc
SCHEMA_RE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")
# the marker table: a schema holding it was made by this file, and one without it is never used
META = "asa_shift_rehearsal_meta"
LEDGER = "asa_shift_rehearsal"
META_DDL = ("CREATE TABLE IF NOT EXISTS {schema}.asa_shift_rehearsal_meta ("
            "id INT PRIMARY KEY, filled_at TIMESTAMPTZ, filled_by TEXT NOT NULL DEFAULT '', "
            "since TEXT NOT NULL DEFAULT '', counts JSONB NOT NULL DEFAULT '{{}}'::jsonb)")
# the lanes' advisory lock namespaces, moved clear of the real ones inside the worker
LOCK_SHIFT = 100000
LOCK_ENV = {"HUB_SHIFT_REQUESTS_LOCK_NS": 8213, "HUB_SMS_EARS_LOCK_NS": 8217,
            "HUB_HOUSE_MEDS_LOCK_NS": 8221, "HUB_TIME_OFF_LOCK_NS": 8231}
# a module attribute holding a lock namespace: LOCK_NS, TAB_LOCK_NS, LOCK_NS_ID, LOCK_NS_TAB …
LOCK_ATTR_RE = re.compile(r"(?:^|_)LOCK_NS(?:_|$)")
# the sandbox's own directories hold real staff numbers: nobody but the owner reads them
PRIVATE_MODE = 0o700
# how far back the copy of the estate reaches, by the day a row is about
COPY_DAYS = int(os.getenv("HUB_SHIFT_REHEARSAL_COPY_DAYS", "14"))
RESULT = "REHEARSAL_RESULT "

# The tables the copy takes, and which of their rows.
COPY_RULES: dict[str, str] = {
    "asa_shift_pool": "col_iso >= %(since)s",
    "asa_shift_requests": "col_iso >= %(since)s",
    "asa_shift_handoffs": "col_iso >= %(since)s",
    "asa_house_calendar_claims": "col_iso >= %(since)s",
    "asa_house_calendar_overrides": "TRUE",
    "asa_house_calendar_edits": "col_iso >= %(since)s",
    "asa_house_day_published": "TRUE",
    "asa_open_shift_covered": "col_iso >= %(since)s",
    "asa_open_shift_covered_birth": "TRUE",
    "asa_cal_builder_house_draft": "TRUE",
}
# shadowed and deliberately left empty: the ear hears only the sandbox's own inbox, and the restore trail is written…
LEFT_EMPTY = frozenset({"asa_sms_replies", "asa_sms_reply_start", "asa_cal_builder_publish_log"})
# the tables every rehearsed answer writes; each must resolve INSIDE the sandbox before one runs
MUST_SHADOW = ("asa_shift_pool", "asa_shift_requests", "asa_shift_handoffs",
               "asa_house_calendar_claims", "asa_house_calendar_overrides",
               "asa_house_calendar_edits", "asa_sms_replies", "asa_sms_reply_start",
               "asa_open_shift_covered", "asa_time_off_writes", LEDGER, META)


class SandboxBreach(RuntimeError):
    """Something inside the worker reached for a real row, file or host; it was stopped, not done."""


_STATE: dict[str, Any] = {"sealed": False, "schema": "", "root": None, "dsn": "", "base": "", "source": "",
                          "real": [], "stopped": [], "role": {}}
_STOP_LOCK = threading.Lock()


def sealed() -> bool:
    return bool(_STATE["sealed"])


def role() -> dict[str, Any]:
    """The database role the worker connects as, and whether it is a superuser (None when that could not be…"""
    return dict(_STATE["role"] or {})


def schema() -> str:
    return str(_STATE["schema"])


def root() -> Path:
    return Path(_STATE["root"])


def dsn() -> str:
    return str(_STATE["dsn"])


def stopped() -> list[str]:
    with _STOP_LOCK:
        return list(_STATE["stopped"])


def _stop(what: str) -> str:
    with _STOP_LOCK:
        if what not in _STATE["stopped"]:
            _STATE["stopped"].append(what)
    return what


# ── the database wall ──────────────────────────────────────────────────────

# a quoted name may hold a doubled quote; _lex pads every quoted name with spaces, so a name glued to the word…
_IDENT = r'(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)'
_QNAME = _IDENT + r'(?:\s*\.\s*' + _IDENT + r')?'
_TARGET = re.compile(
    r"\b(?:INSERT\s+INTO|DELETE\s+FROM(?:\s+ONLY)?|MERGE\s+INTO(?:\s+ONLY)?|UPDATE(?:\s+ONLY)?"
    r"|TRUNCATE(?:\s+TABLE)?(?:\s+ONLY)?|COPY"
    r"|ALTER\s+(?:TABLE|INDEX|SEQUENCE|VIEW)(?:\s+IF\s+EXISTS)?(?:\s+ONLY)?"
    r"|LOCK(?:\s+TABLE)?(?:\s+ONLY)?"
    r"|CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+NOT\s+EXISTS)?"
    r"(?:\s+" + _IDENT + r")?\s+ON(?:\s+ONLY)?)"
    r"\s+(" + _QNAME + r")", re.I)
# TRUNCATE and LOCK name a LIST of relations; every one of them is a target, not just the first
_LISTED = re.compile(
    r"\b(?:TRUNCATE|LOCK)(?:\s+TABLE)?\s+((?:ONLY\s+)?" + _QNAME + r"(?:\s*\*)?"
    r"(?:\s*,\s*(?:ONLY\s+)?" + _QNAME + r"(?:\s*\*)?)*)", re.I)
# the kinds of relation a sandbox may make: a CREATE of any other kind is never let through
_MAKES = (r"(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?"
          r"(?:RECURSIVE\s+)?(?:TABLE|SEQUENCE|VIEW|TYPE)\b")
_CREATE_WORD = re.compile(r"\bCREATE\s+", re.I)
_CREATE_OK = re.compile(r"(?:" + _MAKES + r"|(?:UNIQUE\s+)?INDEX\b)", re.I)
_CREATED = re.compile(
    r"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?"
    r"(?:RECURSIVE\s+)?(?:TABLE|SEQUENCE|VIEW|TYPE|MATERIALIZED\s+VIEW)(?:\s+IF\s+NOT\s+EXISTS)?"
    r"\s+(" + _QNAME + r")", re.I)
# the kinds of relation a sandbox may reshape; an ALTER of any other kind is never let through
_ALTER_OK = re.compile(r"^ALTER\s+(?:TABLE|INDEX|SEQUENCE|VIEW)\b", re.I)
# the one DROP the lanes send (a retired index): one name, spelled in the sandbox's own schema
_DROP_INDEX = re.compile(
    r"^DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(" + _QNAME + r")\s*(?:RESTRICT\s*)?;?\s*$", re.I)
# relations a statement ties another one to: a partition, a parent, a foreign key's target
_LINKED = re.compile(
    r"\b(?:PARTITION\s+OF|(?:ATTACH|DETACH)\s+PARTITION|REFERENCES|(?:NO\s+)?INHERIT)"
    r"\s+(" + _QNAME + r")", re.I)
# CREATE TABLE … (LIKE t INCLUDING ALL) copies t's defaults, and with them the sequence t draws from
_LIKE_SOURCE = re.compile(r"[(,]\s*LIKE\s+(" + _QNAME + r")", re.I)
_INHERITS = re.compile(r"\bINHERITS\s*\(([^)]*)\)", re.I)
# whole statements the lanes never send and a sandbox never lets through
_NEVER = re.compile(
    r"^(?:DROP|GRANT|REVOKE|DO|CALL|VACUUM|ANALY[SZ]E|CLUSTER|REINDEX|COMMENT|SECURITY\s+LABEL"
    r"|REFRESH|NOTIFY|LISTEN|IMPORT|REASSIGN|COMMIT|END|ABORT|PREPARE\s+TRANSACTION"
    r"|COMMIT\s+PREPARED|ROLLBACK\s+PREPARED"
    r"|RESET|DISCARD|SET\s+(?:SESSION\s+)?(?:ROLE|AUTHORIZATION)|SET\s+SESSION\s+AUTHORIZATION"
    r"|COPY|LOAD|CHECKPOINT)\b", re.I)
# words that move the connection itself or reach past the tables, wherever they sit outside a string, a quoted name…
_NEVER_ANYWHERE = re.compile(
    r"\bsearch_path\b|\bSET\s+SCHEMA\b|\bALL\s+IN\s+TABLESPACE\b|\bOWNED\s+BY\b"
    r"|\bpg_notify\s*\(|\bset_config\s*\(|\bdblink|\blo_\w+\s*\("
    r"|\bpg_read_(?:binary_)?file|\bpg_file_\w+|\bpg_ls_\w+\s*\("
    r"|\bpg_(?:terminate|cancel)_backend\s*\(|\bpg_reload_conf\s*\(|\bpg_rotate_logfile\s*\("
    r"|\bpg_switch_wal\s*\(|\bpg_promote\s*\(|\bpg_create_restore_point\s*\("
    r"|\bpg_logical_emit_message\s*\(|\bpg_\w*replication_(?:origin|slot)\w*\s*\("
    r"|\bpg_stat_reset\w*\s*\(", re.I)
# a Unicode-escaped name or string (U&"…", U&'…') spells a name the vet cannot read as written
_UNICODE_ESCAPE = re.compile(r"\bU&", re.I)
# the functions that move a sequence; each must name one inside the sandbox, as a literal
_SEQUENCE_CALL = re.compile(r"\b(?:setval|nextval)\s*\(\s*(\x00\d+\x00|[^\s,)]*)", re.I)
# a word the UPDATE of ON CONFLICT, FOR UPDATE or ON UPDATE puts where a table would stand
_NOT_A_TABLE = frozenset({"set", "skip", "nowait", "of", "no", "cascade", "restrict", "only"})


def _text(conn: Any, query: Any) -> str:
    if isinstance(query, (bytes, bytearray, memoryview)):
        return bytes(query).decode("utf-8", errors="replace")
    if isinstance(query, psycopg2.sql.Composable):
        return query.as_string(conn)
    return str(query or "")


# one pass, left to right: a quote inside a comment and a dash inside a string are each read as what they are, so a…
_LEX = re.compile(
    r"(?P<block>/\*.*?\*/)|(?P<line>--[^\n]*)"
    r"|(?P<dollar>\$\$.*?\$\$|\$(?P<tag>[A-Za-z_][A-Za-z0-9_]*)\$.*?\$(?P=tag)\$)"
    r"|(?P<estr>(?<![A-Za-z0-9_$])[Ee]'(?:[^'\\]|''|\\.)*')"
    r"|(?P<str>'(?:[^']|'')*')"
    r"|(?P<ident>\"(?:[^\"]|\"\")*\")", re.S)


def _lex(sql: str) -> tuple[str, list[str]]:
    """The statement with comments gone, every quoted name set apart by spaces, and every string body swapped for…"""
    bodies: list[str] = []

    def one(m: re.Match) -> str:
        if m.group("block") or m.group("line"):
            return " "
        if m.group("ident"):
            return f" {m.group(0)} "
        text = m.group(0)
        if m.group("dollar"):
            body = text[text.index("$", 1) + 1:text.rindex("$", 0, len(text) - 1)]
        else:
            body = text[text.index("'") + 1:-1].replace("''", "'")
        bodies.append(body)
        return f"\x00{len(bodies) - 1}\x00"

    return _LEX.sub(one, sql), bodies


def _bare(sql: str) -> str:
    """The statement without comments or string bodies, so words inside them are not read as SQL."""
    marked, _bodies = _lex(sql)
    return re.sub(r"\x00\d+\x00", "''", marked).strip().lstrip("(").strip()


def _statements(bare: str) -> int:
    """How many statements the text holds: a ';' with more SQL after it starts another."""
    return 1 + len(re.findall(r";\s*(?=[^\s;])", bare))


def linked_names(sql: str) -> list[str]:
    """Every relation a statement makes a partition, a parent, a foreign key's target or the model (LIKE) of."""
    bare = _bare(sql)
    out = [re.sub(r"\s*\.\s*", ".", m.group(1))
           for rx in (_LINKED, _LIKE_SOURCE) for m in rx.finditer(bare)]
    for m in _INHERITS.finditer(bare):
        out += [re.sub(r"\s*\.\s*", ".", n.strip()) for n in m.group(1).split(",") if n.strip()]
    return out


def sequence_args(sql: str) -> list[str | None]:
    """The sequence each setval/nextval names, as the literal spells it; None when it is not a literal."""
    marked, bodies = _lex(sql)
    out: list[str | None] = []
    for m in _SEQUENCE_CALL.finditer(marked):
        arg = m.group(1)
        lit = re.fullmatch(r"\x00(\d+)\x00", arg)
        out.append(bodies[int(lit.group(1))] if lit else None)
    return out


def _selects_into(bare: str) -> bool:
    """SELECT … INTO makes a table; only INSERT INTO and MERGE INTO write one that exists."""
    plain = re.sub(r"\"(?:[^\"]|\"\")*\"", " x ", bare)
    return any(not re.search(r"\b(?:INSERT|MERGE)\s*$", plain[:m.start()], re.I)
               for m in re.finditer(r"\bINTO\b", plain, re.I))


def _unquoted(bare: str) -> str:
    """The statement with quoted identifiers blanked, so a name never reads as a keyword."""
    return re.sub(r"\"(?:[^\"]|\"\")*\"", " x ", bare)


def _dequoted(bare: str) -> str:
    """The statement with every quoted identifier read as the word it spells, so a function or a setting is known…"""
    def word(m: re.Match) -> str:
        return " " + m.group(1).replace('""', '"') + " "

    return re.sub(r"\"((?:[^\"]|\"\")*)\"", word, bare)


def _listed_names(bare: str) -> list[str]:
    out: list[str] = []
    for m in _LISTED.finditer(bare):
        for part in re.findall(r"(?:ONLY\s+)?(" + _QNAME + r")(?:\s*\*)?", m.group(1), re.I):
            name = re.sub(r"\s*\.\s*", ".", part)
            if name.strip('"').upper() not in ("ONLY", "TABLE"):
                out.append(name)
    return out


def write_targets(sql: str) -> list[str]:
    """Every relation a statement may write, lock or reshape, as spelled in it."""
    bare = _bare(sql)
    out = []
    for m in _TARGET.finditer(bare):
        name = re.sub(r"\s*\.\s*", ".", m.group(1))
        if name.strip('"').lower() in _NOT_A_TABLE:
            continue
        out.append(name)
    for name in _listed_names(bare):
        if name not in out and name.strip('"').lower() not in _NOT_A_TABLE:
            out.append(name)
    return out


def created_names(sql: str) -> list[str]:
    return [re.sub(r"\s*\.\s*", ".", m.group(1)) for m in _CREATED.finditer(_bare(sql))]


def dropped_index(sql: str) -> str:
    """The one index a `DROP INDEX` of the lanes' own shape names, or ''."""
    m = _DROP_INDEX.match(_bare(sql))
    return re.sub(r"\s*\.\s*", ".", m.group(1)) if m else ""


def never(sql: str) -> str:
    """Why this statement is never let through, or ''."""
    bare = _bare(sql)
    plain = _unquoted(bare)
    head = re.sub(r"\s+", " ", bare)[:80]
    if _statements(bare) > 1:
        # a second statement would run past every check below, a COMMIT among them
        return f"«{head}» holds more than one statement, and only one is sent at a time"
    if _NEVER.match(bare) and not _DROP_INDEX.match(bare):
        return f"a statement of the kind «{head}» is never sent from the sandbox"
    if re.match(r"^ALTER\b", plain, re.I) and not _ALTER_OK.match(plain):
        return (f"«{head}» alters something other than a table, index, sequence or view, which "
                f"is never sent from the sandbox")
    if re.match(r"^ALTER\b", plain, re.I) and re.search(r"\bRENAME\b", plain, re.I):
        # a name the sandbox gives up falls through the search path to a real relation
        return f"«{head}» renames something, which is never sent from the sandbox"
    for m in _CREATE_WORD.finditer(plain):
        if not _CREATE_OK.match(plain, m.end()):
            return (f"«{head}» makes something other than a table, index, sequence, view or type, "
                    f"which is never sent from the sandbox")
    if re.match(r"^TRUNCATE\b", plain, re.I) and re.search(r"\bCASCADE\b", plain, re.I):
        return f"«{head}» would empty tables it does not name, which is never sent from the sandbox"
    if _UNICODE_ESCAPE.search(plain):
        return (f"«{head}» spells a name or a string in Unicode escapes, which the sandbox cannot "
                f"read as written and never sends")
    if _NEVER_ANYWHERE.search(_dequoted(bare)):
        return f"«{head}» would move the connection out of the sandbox or reach outside it"
    if _selects_into(bare):
        return f"«{head}» makes a table with SELECT … INTO, which is never sent from the sandbox"
    return ""


def _schema_of_name(name: str) -> str:
    """The schema a qualified name spells, as Postgres reads it (a bare word folded to lower case), or '' for an…"""
    parts = re.findall(r'"(?:[^"]|"")+"|[^."]+', name)
    if len(parts) != 2:
        return ""
    first = parts[0]
    return first[1:-1].replace('""', '"') if first.startswith('"') else first.lower()


def _allowed_schema(nsp: str) -> bool:
    return nsp == _STATE["schema"] or nsp.startswith("pg_temp")


# names already proved to resolve inside the sandbox; forgotten after any ALTER or DROP, which can make a name…
_KNOWN_INSIDE: set[str] = set()
_RESHAPES = re.compile(r"^(?:ALTER|DROP)\b", re.I)


def _resolve(conn: Any, name: str) -> str | None:
    """The schema `name` resolves to on this connection, or None when it resolves to nothing."""
    cur = psycopg2.extensions.cursor(conn)
    try:
        cur.execute("SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE c.oid = to_regclass(%s)", (name,))
        got = cur.fetchone()
    finally:
        cur.close()
    return str(got[0]) if got else None


def _inside_or_nothing(conn: Any, name: str, *, what: str) -> None:
    """Refuse `name` unless it is spelled in the sandbox's schema, or resolves inside it or to nothing."""
    if name in _KNOWN_INSIDE:
        return
    nsp = _schema_of_name(name)
    if nsp and not _allowed_schema(nsp):
        raise SandboxBreach(_stop(f"{name} is outside the sandbox and would have been {what}"))
    where = _resolve(conn, name)
    if where is None:
        # names nothing: the statement fails on its own, or creates it inside the sandbox
        return
    if not _allowed_schema(where):
        raise SandboxBreach(_stop(f"{name} resolves to {where}.{name.split('.')[-1]}, a real "
                                  f"relation, and would have been {what}"))
    _KNOWN_INSIDE.add(name)


def vet(conn: Any, query: Any) -> None:
    """Refuse a statement that could write, lock or reshape anything outside the sandbox."""
    sql = _text(conn, query)
    why = never(sql)
    if why:
        raise SandboxBreach(_stop(why))
    try:
        _vet_names(conn, sql)
    finally:
        if _RESHAPES.match(_unquoted(_bare(sql))):
            # what this statement drops or alters may make a remembered name resolve elsewhere
            _KNOWN_INSIDE.clear()


def _current_schema(conn: Any) -> str:
    cur = psycopg2.extensions.cursor(conn)
    try:
        cur.execute("SELECT current_schema()")
        return str((cur.fetchone() or [""])[0] or "")
    finally:
        cur.close()


def _path_holds(conn: Any) -> None:
    """Refuse unless the connection still opens on the sandbox: a remembered name, an unqualified CREATE and…"""
    got = _current_schema(conn)
    if got != _STATE["schema"]:
        _KNOWN_INSIDE.clear()
        raise SandboxBreach(_stop(f"the connection's path now opens on {got or 'no schema'} rather "
                                  f"than the sandbox, so no name on it can be trusted"))


def _vet_names(conn: Any, sql: str) -> None:
    created, index, targets = created_names(sql), dropped_index(sql), write_targets(sql)
    linked, sequences = linked_names(sql), sequence_args(sql)
    if created or index or targets or linked or sequences:
        _path_holds(conn)
    for name in created:
        nsp = _schema_of_name(name)
        if nsp and not _allowed_schema(nsp):
            raise SandboxBreach(_stop(f"{name} would be created outside the sandbox"))
    if index:
        # spelled in the sandbox's own schema, or the search path would carry it to a real one
        nsp = _schema_of_name(index)
        if not nsp or not _allowed_schema(nsp):
            raise SandboxBreach(_stop(f"the index {index} is dropped by a name that is not spelled "
                                      f"in the sandbox's own schema, so it could be a real one"))
        _inside_or_nothing(conn, index, what="dropped")
    for name in targets:
        _inside_or_nothing(conn, name, what="written")
    for name in linked:
        _inside_or_nothing(conn, name, what="tied to a sandbox table")
    for seq in sequences:
        if seq is None:
            raise SandboxBreach(_stop("a sequence named by anything but a literal would be moved, "
                                      "and which one cannot be read before it runs"))
        _inside_or_nothing(conn, seq, what="moved")


_STRAY_SQL = ("SELECT schemaname || '.' || relname FROM pg_stat_xact_user_tables "
              "WHERE (n_tup_ins + n_tup_upd + n_tup_del) > 0 AND schemaname <> %s "
              "AND schemaname NOT LIKE 'pg\\_temp%%' ORDER BY 1")


class _VettedMixin:
    """Every statement vetted as it will be sent; one run under autocommit is given a checked transaction of its…"""

    def _vet(self, query, vars) -> None:  # noqa: A002 — psycopg2's own spelling
        vet(self.connection, query if vars is None else self.mogrify(query, vars))

    def execute(self, query, vars=None):  # noqa: A002 — psycopg2's own spelling
        conn = self.connection
        self._vet(query, vars)
        if not conn.autocommit or getattr(self, "name", None):
            return super().execute(query, vars)
        conn.autocommit = False
        try:
            out = super().execute(query, vars)
            conn.commit()
        except BaseException:
            try:
                psycopg2.extensions.connection.rollback(conn)
            finally:
                conn.autocommit = True
            raise
        conn.autocommit = True
        return out

    def executemany(self, query, vars_list):
        conn = self.connection
        vars_list = list(vars_list)
        for vars in vars_list or [None]:  # noqa: A001 — psycopg2's own spelling
            self._vet(query, vars)
        if not conn.autocommit:
            return super().executemany(query, vars_list)
        conn.autocommit = False
        try:
            out = super().executemany(query, vars_list)
            conn.commit()
        except BaseException:
            try:
                psycopg2.extensions.connection.rollback(conn)
            finally:
                conn.autocommit = True
            raise
        conn.autocommit = True
        return out

    def callproc(self, *args, **kwargs):
        raise SandboxBreach(_stop("a stored procedure call is never sent from the sandbox"))

    def copy_from(self, *args, **kwargs):
        raise SandboxBreach(_stop("COPY is never sent from the sandbox"))

    def copy_to(self, *args, **kwargs):
        raise SandboxBreach(_stop("COPY is never sent from the sandbox"))

    def copy_expert(self, *args, **kwargs):
        raise SandboxBreach(_stop("COPY is never sent from the sandbox"))


_VETTED: dict[type, type] = {}


def _vetted(factory: type) -> type:
    got = _VETTED.get(factory)
    if got is None:
        got = _VETTED[factory] = type(f"Sandbox{factory.__name__}", (_VettedMixin, factory), {})
    return got


class SandboxConnection(psycopg2.extensions.connection):
    """A connection whose cursors are vetted and whose commit refuses a real table's write."""

    def cursor(self, *args, **kwargs):
        factory = kwargs.get("cursor_factory") or self.cursor_factory or psycopg2.extensions.cursor
        kwargs["cursor_factory"] = _vetted(factory)
        return super().cursor(*args, **kwargs)

    def tpc_begin(self, *args, **kwargs):
        # a prepared transaction commits with tpc_commit, past the check commit() makes
        raise SandboxBreach(_stop("a two-phase transaction is never begun in the sandbox — its "
                                  "commit would pass the check every commit makes"))

    tpc_prepare = tpc_commit = tpc_rollback = tpc_recover = tpc_begin

    def stray_writes(self) -> list[str]:
        cur = psycopg2.extensions.cursor(self)
        try:
            cur.execute(_STRAY_SQL, (_STATE["schema"],))
            return [str(r[0]) for r in cur.fetchall()]
        finally:
            cur.close()

    def commit(self):
        # FAIL-CLOSED: a transaction whose writes cannot be listed is rolled back, never committed.
        try:
            stray = self.stray_writes()
        except Exception as exc:
            psycopg2.extensions.connection.rollback(self)
            raise SandboxBreach(_stop(f"the writes of a transaction could not be listed "
                                      f"({type(exc).__name__}), so it was rolled back")) from exc
        if stray:
            psycopg2.extensions.connection.rollback(self)
            raise SandboxBreach(_stop(f"a transaction wrote {', '.join(stray)} outside the sandbox "
                                      f"and was rolled back"))
        return super().commit()


_REAL_CONNECT = psycopg2.connect


def _guarded_connect(dsn=None, connection_factory=None, cursor_factory=None, **kwargs):
    if connection_factory not in (None, SandboxConnection):
        raise SandboxBreach(_stop("a connection of another kind was asked for inside the sandbox"))
    conn = _REAL_CONNECT(dsn, connection_factory=SandboxConnection, cursor_factory=cursor_factory,
                         **kwargs)
    try:
        cur = psycopg2.extensions.cursor(conn)
        cur.execute("SELECT current_schema()")
        got = str((cur.fetchone() or [""])[0] or "")
        cur.close()
        psycopg2.extensions.connection.rollback(conn)
    except Exception:
        conn.close()
        raise
    if got != _STATE["schema"]:
        conn.close()
        raise SandboxBreach(_stop(f"a connection opened on {got or 'no schema'} rather than the "
                                  f"sandbox, and was closed before it was used"))
    return conn


# ── the disk and the wire ──────────────────────────────────────────────────

_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC
_PATH_EVENTS = {"os.remove": (0,), "os.rename": (0, 1), "os.rmdir": (0,), "os.mkdir": (0,),
                "os.truncate": (0,), "os.chmod": (0,), "os.chown": (0,), "os.utime": (0,),
                "os.symlink": (0, 1), "os.link": (0, 1), "os.mkfifo": (0,), "os.mknod": (0,),
                "os.setxattr": (0,), "os.removexattr": (0,), "os.chflags": (0,),
                "os.lchflags": (0,), "shutil.rmtree": (0,), "shutil.copyfile": (1,),
                "shutil.copytree": (1,), "shutil.move": (0, 1), "shutil.chown": (0,)}
_WIRE_EVENTS = frozenset({
    "socket.connect", "socket.bind", "socket.sendto", "socket.sendmsg", "socket.getaddrinfo",
    "socket.gethostbyname", "socket.gethostbyaddr", "socket.gethostbyname_ex",
    "socket.getnameinfo", "subprocess.Popen", "os.system", "os.exec", "os.posix_spawn",
    "os.spawn", "os.fork", "os.forkpty", "os.startfile", "pty.spawn", "urllib.Request",
    "http.client.connect", "smtplib.connect", "ftplib.connect", "imaplib.open",
    "poplib.connect", "nntplib.connect", "telnetlib.Telnet.open", "webbrowser.open"})
_IN_HOOK = threading.local()


def _inside(path: Any, base: Path) -> bool:
    if isinstance(path, int) or path is None:
        return True
    try:
        p = Path(os.fsdecode(path))
    except TypeError:
        return False
    if not p.is_absolute():
        p = Path(os.getcwd()) / p
    real = Path(os.path.realpath(p))
    return real == base or base in real.parents


def install_walls(base: Path) -> None:
    """The disk and wire walls, for the rest of this process's life: an audit hook cannot be removed."""
    base = Path(os.path.realpath(base))

    def hook(event: str, args: tuple) -> None:
        if getattr(_IN_HOOK, "on", False):
            return
        _IN_HOOK.on = True
        try:
            if event == "open":
                path = args[0] if args else None
                mode = str(args[1] or "") if len(args) > 1 else ""
                flags = int(args[2] or 0) if len(args) > 2 and isinstance(args[2], int) else 0
                writes = bool(flags & _WRITE_FLAGS) or any(c in mode for c in "wax+")
                if writes and not _inside(path, base):
                    raise PermissionError(_stop(f"a write to {os.fsdecode(path)} outside the "
                                                f"sandbox directory"))
            elif event in _PATH_EVENTS:
                for i in _PATH_EVENTS[event]:
                    if i < len(args) and not _inside(args[i], base):
                        raise PermissionError(_stop(f"{event} on {args[i]!s} outside the sandbox "
                                                    f"directory"))
            elif event in _WIRE_EVENTS:
                raise PermissionError(_stop(f"{event} — the sandbox reaches no host and starts "
                                            f"no process"))
            elif event == "sqlite3.connect" and args and str(args[0]) != ":memory:" \
                    and not _inside(args[0], base):
                raise PermissionError(_stop(f"a database file {args[0]!s} outside the sandbox"))
        finally:
            _IN_HOOK.on = False

    sys.addaudithook(hook)


# ── sealing a worker ───────────────────────────────────────────────────────

def _real_path(base_dsn: str, name: str) -> list[str]:
    """The real estate's search path, and the sandbox schema made or proved to be the rehearsal's."""
    conn = _REAL_CONNECT(base_dsn)
    try:
        cur = conn.cursor()
        cur.execute("SELECT current_user, session_user, "
                    "(SELECT rolsuper FROM pg_roles WHERE rolname = current_user)")
        got = cur.fetchone() or ("", "", None)
        if name in (str(got[0] or ""), str(got[1] or "")):
            # "$user" on the real estate's path would open on the sandbox the moment it exists
            raise SandboxBreach(f"the schema {name} is named like the database role, so the real "
                                f"estate's own path would open on it — it can never be the sandbox")
        _STATE["role"] = {"name": str(got[0] or ""),
                          "superuser": None if got[2] is None else bool(got[2])}
        cur.execute("SELECT current_schemas(false)")
        real = [str(s) for s in ((cur.fetchone() or [[]])[0] or [])]
        if name in real:
            raise SandboxBreach(f"the schema {name} is on the real estate's own path, so it can "
                                f"never be the sandbox")
        bad = [s for s in real if not SCHEMA_RE.match(s)]
        if bad:
            raise SandboxBreach(f"the real estate's path names {bad[0]!r}, which this file does not "
                                f"spell — no sandbox is opened on it")
        cur.execute("SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=%s)", (name,))
        exists = bool((cur.fetchone() or [False])[0])
        if exists:
            cur.execute("SELECT count(*) FROM pg_class c JOIN pg_namespace n "
                        "ON n.oid = c.relnamespace WHERE n.nspname=%s AND c.relkind IN ('r','p')",
                        (name,))
            tables = int((cur.fetchone() or [0])[0] or 0)
            cur.execute("SELECT to_regclass(%s) IS NOT NULL", (f"{name}.{META}",))
            mine = bool((cur.fetchone() or [False])[0])
            if tables and not mine:
                raise SandboxBreach(f"the schema {name} holds tables that are not the "
                                    f"rehearsal's, so it is never used as its sandbox")
        else:
            cur.execute(psycopg2.sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(
                psycopg2.sql.Identifier(name)))
            # a path that names the schema before it exists shows it only once it does
            cur.execute("SELECT current_schemas(false)")
            if name in [str(s) for s in ((cur.fetchone() or [[]])[0] or [])]:
                conn.rollback()
                raise SandboxBreach(f"once made, the schema {name} stood on the real estate's own "
                                    f"path, so it was never kept and is never the sandbox")
        cur.execute(META_DDL.format(schema=psycopg2.sql.Identifier(name).as_string(conn)))
        conn.commit()
        return real
    finally:
        conn.close()


def sandbox_dsn(base_dsn: str, name: str, real: list[str]) -> str:
    """The same database, with a search path that opens on the sandbox."""
    params = psycopg2.extensions.parse_dsn(base_dsn)
    opts = str(params.get("options") or "")
    opts = re.sub(r"(?:-c\s*|--)search_path=\S+", "", opts).strip()
    path = ",".join([name, *real])
    return psycopg2.extensions.make_dsn(
        base_dsn, options=(f"{opts} " if opts else "") + f"-c search_path={path}")


def private_dirs(base: Path) -> list[Path]:
    """The sandbox directory and its inbox, out and tmp, each readable by the owner alone — like the real inbox…"""
    made = [base, base / "inbox", base / "out", base / "out" / "comm-mock-web", base / "tmp"]
    for d in made:
        d.mkdir(mode=PRIVATE_MODE, parents=True, exist_ok=True)
        # mkdir's mode passes through the umask and never narrows a directory already there
        os.chmod(d, PRIVATE_MODE)
    return made


def seal(*, schema: str, dsn: str, root: Path) -> None:  # noqa: A002 — the names the request carries
    """Seal this process: its database, its disk and its wire, before any lane is imported."""
    if _STATE["sealed"]:
        raise SandboxBreach("a worker is sealed once")
    if not SCHEMA_RE.match(schema or "") or schema == "public" or schema.startswith("pg_"):
        raise SandboxBreach(f"{schema!r} is not a schema the rehearsal may make its own")
    if not dsn:
        raise SandboxBreach("no database was named")
    base = Path(root)
    if not base.is_absolute() or len(base.parts) < 3:
        raise SandboxBreach(f"{base} is not a directory the rehearsal may keep")
    private_dirs(base)
    real = _real_path(dsn, schema)
    inner = sandbox_dsn(dsn, schema, real)
    # Only what a lane WRITES is pointed into the sandbox; what it only reads (the people roster the ear names a…
    # asa-hub-db is never reached from a sealed worker: a lane whose records moved there (Time Off) reads the
    # sandbox's own copy of them, as it did before the move
    # the relay's own tables in asa-hub-db are read once, by the copy, and the lanes write only the sandbox's
    source = os.getenv(HUB_ENV, "").strip()
    env = {"HUB_SNAPSHOT_PG_DSN": inner, "DATABASE_URL": inner, "HUB_HOUSE_MEDS_DSN": "", HUB_ENV: "",
           "HUB_QUO_INBOX_DIR": str(base / "inbox"),
           "HUB_WEB_MOCK_DIR": str(base / "out" / "comm-mock-web"),
           "TMPDIR": str(base / "tmp"), "TEMP": str(base / "tmp"), "TMP": str(base / "tmp")}
    for key, default in LOCK_ENV.items():
        try:
            env[key] = str(int(os.getenv(key, str(default))) + LOCK_SHIFT)
        except ValueError:
            env[key] = str(default + LOCK_SHIFT)
    os.environ.update(env)
    tempfile.tempdir = str(base / "tmp")
    _STATE.update(schema=schema, root=str(Path(os.path.realpath(base))), dsn=inner, base=dsn,
                  real=real, source=source)
    psycopg2.connect = _guarded_connect
    install_walls(base)
    _STATE["sealed"] = True


# ── the lanes, inside ──────────────────────────────────────────────────────

HELD = {"on": True, "readable": True, "word": "rehearsal",
        "why": "the rehearsal's sandbox holds every calendar write"}


class _NoWorkbook:
    """The house calendars workbook as the sandbox sees it: never there."""

    def __getattr__(self, name: str) -> Any:
        raise SandboxBreach(_stop("the house calendars workbook was reached for — the sandbox "
                                  "never writes it"))


def configure_lanes() -> None:
    """The lanes' own hooks, set for this worker: the switch holds, the workbook is absent, the locks are apart."""
    if not sealed():
        raise SandboxBreach("the lanes are configured only inside a sealed worker")
    import calendar_builder_houses  # noqa: PLC0415 — only after the seal
    import effective_roster  # noqa: PLC0415
    effective_roster.use_switch(lambda: dict(HELD))
    calendar_builder_houses.use_workbook(_NoWorkbook())
    here = Path(__file__).resolve().parent
    for mod in list(sys.modules.values()):
        f = getattr(mod, "__file__", None)
        if not f or Path(f).resolve().parent != here:
            continue
        for attr in [a for a in vars(mod) if LOCK_ATTR_RE.search(a)]:
            value = getattr(mod, attr)
            if isinstance(value, int) and not isinstance(value, bool) and value < LOCK_SHIFT:
                setattr(mod, attr, value + LOCK_SHIFT)


def _ident(*parts: str) -> psycopg2.sql.Composable:
    return psycopg2.sql.Identifier(*parts)


def ensure(inner: str, ledger_ddl: Iterable[str]) -> None:
    """Every table a rehearsed answer writes, made INSIDE the sandbox by its own lane, and proved to be there."""
    import calendar_builder_houses  # noqa: PLC0415
    import house_cal_live  # noqa: PLC0415
    import open_shift_covered  # noqa: PLC0415
    import shift_handoff  # noqa: PLC0415
    import shift_requests  # noqa: PLC0415
    import sms_ears  # noqa: PLC0415
    import time_off  # noqa: PLC0415 — a swap's directors list reads its house's overlay
    house_cal_live.ensure_tables(inner)
    calendar_builder_houses.ensure_tables(inner)
    shift_handoff.ensure_tables(inner)
    time_off.ensure_tables(inner)
    sms_ears._ensure(inner)  # noqa: SLF001 — the ear's own DDL, the only one it has
    with psycopg2.connect(inner) as conn, conn.cursor() as cur:
        shift_requests._ddl(cur)  # noqa: SLF001 — the lane's own DDL
        cur.execute(house_cal_live.CLAIMS_DDL)
        open_shift_covered._ddl(cur)  # noqa: SLF001 — the lane's own DDL
        for stmt in ledger_ddl:
            cur.execute(stmt)
        conn.commit()
    with psycopg2.connect(inner) as conn:
        outside = [(t, w) for t in MUST_SHADOW
                   for w in [_resolve(conn, t)] if w != _STATE["schema"]]
        conn.rollback()
    if outside:
        raise SandboxBreach(_stop("; ".join(f"{t} resolves to {w or 'nothing'}, not the sandbox"
                                            for t, w in outside)))
    _own_sequences(inner)


def _own_sequences(inner: str) -> None:
    """A sandbox column that takes its numbers from a real sequence would move it: refused."""
    with psycopg2.connect(inner) as conn:
        cur = psycopg2.extensions.cursor(conn)
        cur.execute(
            "SELECT c.relname, a.attname, pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d "
            "JOIN pg_class c ON c.oid = d.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace "
            "JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum "
            "WHERE n.nspname = %s AND pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%%'",
            (_STATE["schema"],))
        wrong = []
        for rel, col, expr in cur.fetchall():
            m = re.search(r"nextval\('([^']+)'", str(expr))
            seq = m.group(1) if m else ""
            cur.execute("SELECT n.nspname FROM pg_class c JOIN pg_namespace n "
                        "ON n.oid = c.relnamespace WHERE c.oid = to_regclass(%s)", (seq,))
            got = cur.fetchone()
            if not got or str(got[0]) != _STATE["schema"]:
                wrong.append(f"{rel}.{col}")
        cur.close()
        conn.rollback()
    if wrong:
        raise SandboxBreach(_stop(f"{', '.join(wrong)} would number rows from a real sequence"))


def _columns(cur: Any, nsp: str, table: str) -> list[str]:
    cur.execute("SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname=%s AND c.relname=%s "
                "AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' ORDER BY a.attnum",
                (nsp, table))
    return [str(r[0]) for r in cur.fetchall()]


def _real_home(cur: Any, table: str) -> str:
    """The first schema of the real path holding `table`, or '' when the real estate has none."""
    for nsp in _STATE["real"]:
        cur.execute("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname=%s AND c.relname=%s AND c.relkind IN ('r','p')", (nsp, table))
        if cur.fetchone():
            return nsp
    return ""


def _sandbox_tables(cur: Any) -> list[str]:
    cur.execute("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname=%s AND c.relkind IN ('r','p') ORDER BY 1", (_STATE["schema"],))
    return [str(r[0]) for r in cur.fetchall()]


def _since(now: datetime) -> str:
    try:
        from zoneinfo import ZoneInfo  # noqa: PLC0415
        today = now.astimezone(ZoneInfo("America/New_York")).date()
    except Exception:  # noqa: BLE001 — the copy reaches a day further back, never a day less
        today = now.astimezone(UTC).date() - timedelta(days=1)
    return (today - timedelta(days=COPY_DAYS)).isoformat()


def meta(inner: str) -> dict[str, Any]:
    with psycopg2.connect(inner) as conn, conn.cursor() as cur:
        cur.execute(psycopg2.sql.SQL("SELECT filled_at, filled_by, since, counts FROM {} "
                                     "WHERE id=1").format(_ident(_STATE["schema"], META)))
        got = cur.fetchone()
        conn.commit()
    if not got:
        return {}
    return {"filled_at": got[0].isoformat() if got[0] else "", "filled_by": str(got[1] or ""),
            "since": str(got[2] or ""), "counts": got[3] if isinstance(got[3], dict) else {}}


def fill(inner: str, *, by: str, now: datetime | None = None, empty_first: bool = False,
         only: list[str] | None = None) -> dict[str, Any]:
    """Take a copy of the estate into the sandbox — every table a lane made there, filled from its real twin."""
    now = now or datetime.now(UTC)
    before = meta(inner) if only else {}
    since = str(before.get("since") or "") or _since(now)
    nsp = _STATE["schema"]
    counts: dict[str, Any] = dict(before.get("counts") or {})
    hub = _hub_source()
    try:
        _fill(inner, hub, nsp, since, counts, by=by, now=now, empty_first=empty_first, only=only)
    finally:
        if hub is not None:
            hub.close()
    if only:
        return {**before, "counts": counts}
    return {"filled_at": now.isoformat(), "filled_by": str(by or ""), "since": since,
            "counts": counts}


def _hub_source() -> Any:
    """A read-only connection to asa-hub-db for the copy, or None while the relay's tables are not there."""
    if not _STATE.get("source"):
        return None
    conn = _REAL_CONNECT(_STATE["source"])
    conn.set_session(readonly=True)
    # json travels as its text and lands as it
    psycopg2.extras.register_default_json(conn, loads=lambda s: s)
    psycopg2.extras.register_default_jsonb(conn, loads=lambda s: s)
    return conn


def _from_hub(hub: Any, cur: Any, nsp: str, table: str, since: str) -> int | None:
    """The sandbox's copy of one of the relay's own tables, read from asa-hub-db; None when it holds no such table."""
    with hub.cursor() as h:
        twin = set(_columns(h, HUB_SCHEMA, table))
        if not twin:
            return None
        cols = [c for c in _columns(cur, nsp, table) if c in twin]
        if not cols:
            return 0
        rule = COPY_RULES.get(table, "TRUE")
        if "col_iso" in rule and "col_iso" not in cols:
            rule = "TRUE"
        names = psycopg2.sql.SQL(", ").join(_ident(c) for c in cols)
        h.execute(psycopg2.sql.SQL("SELECT {} FROM {} WHERE " + rule).format(names, _ident(HUB_SCHEMA, table)),
                  {"since": since})
        rows = h.fetchall()
    if not rows:
        return 0
    got = psycopg2.extras.execute_values(
        cur, psycopg2.sql.SQL("INSERT INTO {} ({}) VALUES %s ON CONFLICT DO NOTHING RETURNING 1").format(
            _ident(nsp, table), names).as_string(cur), rows, fetch=True)
    return len(got)


def _fill(inner: str, hub: Any, nsp: str, since: str, counts: dict[str, Any], *, by: str, now: datetime,
          empty_first: bool, only: list[str] | None) -> None:
    with psycopg2.connect(inner) as conn, conn.cursor() as cur:
        tables = [t for t in _sandbox_tables(cur) if t not in (LEDGER, META)
                  and (only is None or t in only)]
        if empty_first:
            for t in tables:
                cur.execute(psycopg2.sql.SQL("DELETE FROM {}").format(_ident(nsp, t)))
        for t in tables:
            if t in LEFT_EMPTY:
                counts[t] = 0
                continue
            got = _from_hub(hub, cur, nsp, t, since) if hub is not None else None
            if got is not None:
                counts[t] = got
                continue
            home = _real_home(cur, t)
            if not home:
                counts[t] = 0
                continue
            twin = set(_columns(cur, home, t))
            cols = [c for c in _columns(cur, nsp, t) if c in twin]
            if not cols:
                counts[t] = 0
                continue
            rule = COPY_RULES.get(t, "TRUE")
            if "col_iso" in rule and "col_iso" not in cols:
                rule = "TRUE"
            names = psycopg2.sql.SQL(", ").join(_ident(c) for c in cols)
            cur.execute(
                psycopg2.sql.SQL("INSERT INTO {} ({}) SELECT {} FROM {} WHERE " + rule
                                 + " ON CONFLICT DO NOTHING").format(
                    _ident(nsp, t), names, names, _ident(home, t)),
                {"since": since})
            counts[t] = max(0, cur.rowcount)
        if only is None or "asa_sms_reply_start" in tables:
            # the ear hears every line of the sandbox's own inbox, whatever instant it names
            cur.execute(psycopg2.sql.SQL("INSERT INTO {} (id, since) VALUES (1, %s) "
                                         "ON CONFLICT (id) DO UPDATE SET since = EXCLUDED.since"
                                         ).format(_ident(nsp, "asa_sms_reply_start")),
                        ("2000-01-01T00:00:00Z",))
        _renumber(cur, nsp, tables)
        if only:
            cur.execute(psycopg2.sql.SQL("UPDATE {} SET counts = %s WHERE id=1").format(
                _ident(nsp, META)), (json.dumps(counts),))
        else:
            cur.execute(psycopg2.sql.SQL(
                "INSERT INTO {} (id, filled_at, filled_by, since, counts) "
                "VALUES (1, %s, %s, %s, %s) ON CONFLICT (id) DO UPDATE SET "
                "filled_at = EXCLUDED.filled_at, filled_by = EXCLUDED.filled_by, "
                "since = EXCLUDED.since, counts = EXCLUDED.counts"
            ).format(_ident(nsp, META)), (now, str(by or ""), since, json.dumps(counts)))
        conn.commit()


def top_up(inner: str) -> list[str]:
    """A table a lane made inside the sandbox after its copy was taken is filled now, on its own, so a newer lane…"""
    got = meta(inner)
    known = set((got.get("counts") or {}).keys())
    with psycopg2.connect(inner) as conn, conn.cursor() as cur:
        fresh = [t for t in _sandbox_tables(cur) if t not in (LEDGER, META) and t not in known]
        conn.commit()
    if fresh:
        fill(inner, by=str(got.get("filled_by") or ""), only=fresh)
    return fresh


def _renumber(cur: Any, nsp: str, tables: list[str]) -> None:
    """A copied numbered row must not meet its own number again: each sandbox sequence moves past the copy."""
    cur.execute(
        "SELECT c.relname, a.attname, pg_get_serial_sequence(quote_ident(n.nspname) || '.' || "
        "quote_ident(c.relname), a.attname) FROM pg_attribute a JOIN pg_class c "
        "ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname=%s AND a.attnum > 0 AND NOT a.attisdropped "
        "AND pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), "
        "a.attname) IS NOT NULL", (nsp,))
    for rel, col, seq in list(cur.fetchall()):
        if rel not in tables or not seq or not str(seq).startswith(f"{nsp}."):
            continue
        cur.execute(psycopg2.sql.SQL("SELECT setval(%s, COALESCE((SELECT max({}) FROM {}), 0) + 1, "
                                     "false)").format(_ident(str(col)), _ident(nsp, str(rel))),
                    (str(seq),))


def clear_files() -> list[str]:
    """Empty the sandbox's own inbox and out directories; nothing outside them is looked at."""
    gone = []
    for sub in ("inbox", "out"):
        folder = root() / sub
        for p in sorted(folder.rglob("*"), reverse=True):
            try:
                if p.is_dir():
                    p.rmdir()
                else:
                    p.unlink()
                    gone.append(str(p.relative_to(root())))
            except OSError as exc:
                log.warning("rehearsal sandbox: %s could not be cleared (%s)", p.name,
                            type(exc).__name__)
    return gone


# ── the worker ─────────────────────────────────────────────────────────────

def _emit(obj: dict[str, Any]) -> None:
    sys.stdout.write(RESULT + json.dumps(obj, default=str) + "\n")
    sys.stdout.flush()


def main() -> None:
    """Read one request on stdin, seal, play it, and write one result line on stdout."""
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr,
                        format="%(levelname)s %(name)s: %(message)s")
    try:
        req = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        _emit({"error": {"kind": "failed", "why": "the worker was handed no readable request"}})
        return
    try:
        seal(schema=str(req.get("schema") or ""), dsn=str(req.get("dsn") or ""),
             root=Path(str(req.get("root") or "")))
        import shift_rehearsal_acts as acts  # noqa: PLC0415 — only once the worker is sealed
        data = acts.run(str(req.get("op") or ""), dict(req.get("args") or {}))
        _emit({"data": data, "stopped": stopped()})
    except SandboxBreach as exc:
        _emit({"error": {"kind": "breach", "why": str(exc)}, "stopped": stopped()})
    except Exception as exc:  # noqa: BLE001 — every failure is named in the one result line
        why = getattr(exc, "why", None)
        if why is not None and getattr(exc, "code", None):
            _emit({"error": {"kind": "refused", "why": str(why), "code": str(exc.code),
                             "extra": getattr(exc, "extra", {}) or {}},
                   "stopped": stopped()})
            return
        traceback.print_exc(file=sys.stderr)
        _emit({"error": {"kind": "failed", "why": f"{type(exc).__name__}: {str(exc)[:300]}"},
               "stopped": stopped()})
