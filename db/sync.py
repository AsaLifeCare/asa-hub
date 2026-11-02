"""asa-hub-db sync: copies every ASA spreadsheet the mirror (old_platform) holds into asa-hub-db, one table per tab.
A tab is looked at only when the mirror's row count or newest ingested_at for it moved; then its rows are compared by
keyed hash and only the rows whose content changed are written, in one transaction. New columns reload it whole.
A book Postgres keeps the record of (app/record_books.py) is the exception: once its daily check (app/sheet_check.py)
has been stored here, its copy is that check's alone — the mirror never loads it again — and each check staged in
app.sheet_pulls is stored as the book's copy, in one transaction."""
from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import os
import re
import signal
import sys
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
except ImportError:  # the unit checks import this file without the driver
    psycopg = sql = dict_row = Jsonb = None  # type: ignore[assignment]

log = logging.getLogger("asa-hub-db-sync")

HERE = Path(__file__).resolve().parent
# server/redaction.py, the one withholding rule of every copy; without it nothing is copied
for _rules in (os.getenv("HUB_RULES_DIR") or "/rules", str(HERE.parent / "server")):
    if (Path(_rules) / "redaction.py").is_file():
        sys.path.insert(0, _rules)
        break
try:
    import redaction as R
except ImportError:
    R = None  # type: ignore[assignment]
import sheets_source as S

# a book is read straight from Google when its sheet is newer than the copy by this much, settled this long
DIRECT_GRACE_S = 120.0
DIRECT_SETTLE_S = 60.0
# the clone reads Postgres, never Google: the direct pass stays off unless explicitly asked for
DIRECT_GOOGLE = os.getenv("HUB_DB_DIRECT_GOOGLE", "").strip().lower() in ("1", "true", "yes")
DIRECT_MAX = int(os.getenv("HUB_DB_DIRECT_MAX") or 4)
DIRECT_REFRESH_S = float(os.getenv("HUB_DB_DIRECT_REFRESH_S") or 24 * 3600)
# seconds between two books, so the clone never bursts on the quota the relay reads with
DIRECT_GAP_S = 10.0
# a book whose copy holds more rows is never read whole from Google (the keeper read such a tab by its ends)
DIRECT_MAX_ROWS = int(os.getenv("HUB_DB_DIRECT_MAX_ROWS") or 100000)
# a direct read is stored as the sheet shows it; "direct" marks a copy read before that, whose cells are raw values
DIRECT_STATUS = "direct_formatted"
DIRECT_HELD = ("direct", DIRECT_STATUS)
EVERY_S = float(os.getenv("HUB_DB_SYNC_EVERY_S") or 60)
# THE MIRROR LEFT WITH the old platform (2026-10-27): the copies are no longer loaded from the keeper's mirror in the
# the old platform's database (MIRROR_DSN). Off (the default), a pass only stores the record books' staged checks (load_pulls); the
# copies already here stay as they are, none is dropped. "on" asks the old platform again.
MIRROR_ON = (os.getenv("HUB_DB_MIRROR") or "off").strip().lower() in ("1", "on", "true", "yes")
# the keeper says each pass's commit on this channel (hub_sheet_sync.MIRROR_MOVED): a pass copies it then, not on the
# minute — what lets a change of who reads what reach Python's copy before the relay stops answering 503 for it
MIRROR_MOVED = "hub_mirror_moved"
FULL_EVERY_S = float(os.getenv("HUB_DB_FULL_EVERY_S") or 1800)
PROGRESS_S = 60.0
MAX_IDENT = 63
# Postgres caps a table at 1600 columns; headers past this cap live only in _raw
MAX_COLUMNS = 1200
FETCH_ROWS = 2000
HASH_FETCH_ROWS = 20000
LOCK_KEY = 4130011
# the columns a Python door finds rows by, the cell equal to a key (Staff's events trail, by subject_key): indexed in
# every copied tab that keeps one, so the lookup is no scan of the whole trail inside asa-hub-app's statement timeout
INDEXED_COLUMNS = frozenset({"subject_key"})
RESERVED = frozenset({"row_number", "_raw", "_ingested_at", "_hash",
                      "oid", "tableoid", "xmin", "xmax", "cmin", "cmax", "ctid"})
# a licence number column now keeps what the Staff mask shows: the tabs holding one are loaded again once
LICENCE_RELOAD = "licence-mask-kept"
# a client book's masked columns keep what the Clients masks draw, and its Medicaid number stays whole: loaded again once
KEPT_RELOAD = "client-masks-kept"
# a book the mirror holds as copied: the Hub's keeper wrote it ('ok'), or the other backup left it to the keeper and
# says so over the keeper's word ('skipped_by_policy', which that backup itself counts as copied)
COPIED_STATUSES = frozenset({"ok", "skipped_by_policy"})
# a book whose copy is its daily check's (app/record_books.py RECORD_STATUS): the mirror never loads it
RECORD_STATUS = "record"
# the daily checks staged by asa-hub-sheet-sync, and the record books (db/postgres_record.sql)
PULLS = os.getenv("HUB_DB_PULLS_TABLE") or "app.sheet_pulls"
PULL_ROWS = os.getenv("HUB_DB_PULL_ROWS_TABLE") or "app.sheet_pull_rows"
RECORD_BOOKS = os.getenv("HUB_DB_RECORD_BOOKS_TABLE") or "app.record_books"
# how often, while waiting for the keeper, a staged check is looked for
PULL_POLL_S = 5.0
PULL_ROWS_SQL = ("select row_number, data, decode(md5(data::text), 'hex') from {t} where pull_id = %s and tab_name = %s"
                 " order by row_number")
RECORD_BOOK = ("insert into catalog.books (sheet_id, name, owners, modified_time, synced_at, status, tab_count,"
               " row_count, gone_at, checked_at) values (%s, %s, '[]'::jsonb, null, %s, %s, %s, %s, null, now())"
               " on conflict (sheet_id) do update set name = coalesce(nullif(excluded.name, ''), catalog.books.name),"
               " synced_at = excluded.synced_at, status = excluded.status, tab_count = excluded.tab_count,"
               " row_count = excluded.row_count, gone_at = null, checked_at = now()")

KEYS_SQL = ("select t.k from asa_drive_sheets_rows r"
            " cross join lateral jsonb_object_keys(case when jsonb_typeof(r.data) = 'object'"
            " then r.data else '{}'::jsonb end) with ordinality as t(k, i)"
            " where r.sheet_id = %s and r.tab_name = %s"
            " group by t.k order by min(r.row_number), min(t.i)")

ROWS_SQL = ("select row_number, data, ingested_at, decode(md5(data::text), 'hex') from asa_drive_sheets_rows"
            " where sheet_id = %s and tab_name = %s")
HASHES_SQL = ("select row_number, decode(md5(data::text), 'hex'), ingested_at from asa_drive_sheets_rows"
              " where sheet_id = %s and tab_name = %s order by row_number")
# the same text on both sides: md5 over "row:hash" in row order, with the row count and the newest ingest
DIGEST_SQL = ("select md5(string_agg(row_number::text || ':' || encode({h}, 'hex'), ',' order by row_number)),"
              " count(*), max({at}) from {t}")
MIRROR_ROWS = "_mirror_rows"

UPSERT_TAB = ("insert into catalog.tabs (sheet_id, tab_name, table_name, columns, row_count,"
              " source_synced_at, loaded_at, gone_at, guarded, digest, keys)"
              " values (%s, %s, %s, %s, %s, %s, now(), null, true, %s, %s)"
              " on conflict (sheet_id, tab_name) do update set table_name = excluded.table_name,"
              " columns = excluded.columns, row_count = excluded.row_count,"
              " source_synced_at = excluded.source_synced_at, loaded_at = now(), gone_at = null,"
              " guarded = true, digest = excluded.digest, keys = excluded.keys")

UPSERT_BOOK = ("insert into catalog.books (sheet_id, name, owners, modified_time, synced_at, status,"
               " tab_count, row_count, gone_at) values (%s, %s, %s, %s, %s, %s, %s, %s, null)"
               " on conflict (sheet_id) do update set name = excluded.name, owners = excluded.owners,"
               " modified_time = excluded.modified_time, synced_at = excluded.synced_at,"
               " status = excluded.status, tab_count = excluded.tab_count,"
               " row_count = excluded.row_count, gone_at = null")


def slug(text: Any) -> str:
    """Lowercase ASCII, every other run of characters one underscore."""
    s = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def _cut(name: str, limit: int = MAX_IDENT) -> str:
    return name[:limit].rstrip("_")


def table_name(sheet_id: str, tab: str, book: str, digits: int = 8) -> str:
    h = hashlib.sha1(f"{sheet_id}{tab}".encode("utf-8")).hexdigest()[:digits]
    return _cut(f"t_{h}_{slug(f'{book}_{tab}')}")


def pick_table_name(sheet_id: str, tab: str, book: str, taken: set[str]) -> str:
    """A longer hash only when another tab already owns the short name."""
    for digits in (8, 16, 40):
        name = table_name(sheet_id, tab, book, digits)
        if name not in taken:
            return name
    raise RuntimeError(f"no free table name for {sheet_id} / {tab!r}")


def column_name(header: str, used: set[str]) -> str:
    base = slug(header) or "col"
    if base[0].isdigit():
        base = "c_" + base
    base = _cut(base)
    name, n = base, 1
    while name in used or name in RESERVED:
        n += 1
        sfx = f"_{n}"
        name = _cut(base, MAX_IDENT - len(sfx)) + sfx
    return name


def map_columns(headers: Iterable[str], existing: list | None = None) -> list[list[str]]:
    """Known headers keep their column; new ones are appended, never renamed later."""
    pairs = [[str(h), str(c)] for h, c in (existing or [])]
    known = {h for h, _ in pairs}
    used = {c for _, c in pairs}
    for h in headers:
        h = str(h)
        if h in known or len(pairs) >= MAX_COLUMNS:
            continue
        c = column_name(h, used)
        pairs.append([h, c])
        known.add(h)
        used.add(c)
    return pairs


def order_headers(keys: Iterable[str], sheet_header: Iterable[str] | None) -> list[str]:
    """The sheet's own column order where the keeper kept it, then the mirror's remaining keys."""
    keys = [str(k) for k in keys]
    present = set(keys)
    out: list[str] = []
    for h in [str(h) for h in (sheet_header or [])] + keys:
        if h in present and h not in out:
            out.append(h)
    return out


def in_sheet_order(pairs: list[list[str]], ordered: list[str]) -> list[list[str]]:
    """The catalog's pairs in the sheet's order; a header the sheet no longer names keeps its place after them."""
    rank = {h: i for i, h in enumerate(ordered)}
    return sorted(pairs, key=lambda p: rank.get(p[0], len(rank)))


def licence_tab(columns: Iterable[Any], _sid: str = "") -> bool:
    return any(R.is_licence_column(h) for h, _c in columns or [])


def kept_tab(columns: Iterable[Any], sid: str) -> bool:
    """A tab of a book whose column the rule now keeps whole (BOOK_KEPT_COLUMNS) or keeps the figure of (BOOK_KEPT_FACTS)."""
    kept = set(getattr(R, "BOOK_KEPT_COLUMNS", {}).get(sid, ())) | set(getattr(R, "BOOK_KEPT_FACTS", {}).get(sid, {}))
    return bool(kept) and any(h in kept for h, _c in columns or [])


def needs_load(cat: dict | None, rows: int, newest: Any) -> bool:
    return (cat is None or cat.get("gone_at") is not None or not cat.get("guarded")
            or cat.get("row_count") != rows or cat.get("source_synced_at") != newest)


def comparable(cat: dict | None) -> bool:
    """A tab stored with row hashes under the rule may be compared row by row instead of reloaded."""
    return (cat is not None and cat.get("gone_at") is None and bool(cat.get("guarded"))
            and cat.get("digest") is not None and isinstance(cat.get("keys"), list))


def _hash_key() -> bytes:
    """Keyed by the sync's own secrets, so a stored hash never stands in for a withheld cell."""
    material = "\0".join(os.getenv(k) or "" for k in ("HUB_DB_HASH_KEY", "MIRROR_DSN", "POSTGRES_PASSWORD"))
    return hashlib.sha256(("asa-hub-db rows\0" + material).encode("utf-8")).digest()


HASH_KEY = _hash_key()


def row_hash(md5: Any) -> bytes | None:
    """The mirror's md5 of a row's data, keyed: what _hash holds."""
    return None if md5 is None else hashlib.blake2b(bytes(md5), key=HASH_KEY, digest_size=16).digest()


def plan_columns(cat: dict | None, keys: list[str], order: list,
                 exact: bool) -> tuple[list[str], list[list[str]], list[str]]:
    """The headers the rule leaves, the catalog's [header, column] pairs, and the credential columns to drop."""
    headers = list(R.redact_row(dict.fromkeys(keys))[0])
    # a credential that was a header never stays a column
    before = (cat or {}).get("columns") or []
    dropped = [c for h, c in before if R.is_secret_name(h)]
    ordered = order_headers(headers, order)
    pairs = map_columns(ordered, [p for p in before if not R.is_secret_name(p[0])])
    if exact:
        # an owned tab's catalog lists its columns as the sheet does, so a read by position reads the sheet's
        pairs = in_sheet_order(pairs, ordered)
    return headers, pairs, dropped


def guard_hits(headers: Iterable[str]) -> bool:
    """Whether the rule can withhold anything under these headers (key/value tabs decide per row)."""
    row = dict.fromkeys(str(h) for h in headers)
    keys, values = R._key_and_value_columns(row)
    return bool(R.withheld_columns(row) or R.secret_named_columns(row) or (keys and values))


def reading(sid: str) -> Any:
    """The rule told which book a tab belongs to (redaction.reading); a rule mounted without it withholds as before."""
    told = getattr(R, "reading", None)
    return told(sid) if told is not None else contextlib.nullcontext()


def withhold(data: Any, keys: list[str]) -> dict:
    """The row as the rule lets a copy keep it: a withheld cell marked, a credential header renamed."""
    if not isinstance(data, dict):
        return {}
    red, _n = R.redact_row({k: data.get(k) for k in keys})
    return {h: v for k, h, v in zip(keys, red, red.values()) if k in data}


def cell(v: Any) -> str | None:
    """What data->>key gives: text as is, any other JSON value as its JSON text."""
    if v is None or isinstance(v, str):
        return v
    return json.dumps(v, ensure_ascii=False)


def book_row(meta: dict) -> dict:
    return {"name": meta.get("name") or "(untitled)", "modified_time": meta.get("modified_time"),
            "synced_at": meta.get("last_sync_at"), "status": meta.get("last_sync_status"),
            "tab_count": int(meta.get("tab_count") or 0), "row_count": int(meta.get("row_count") or 0)}


def book_changed(meta: dict, cat: dict | None) -> bool:
    if cat is None or cat.get("gone_at") is not None:
        return True
    want = book_row(meta)
    return any(want[k] != cat.get(k) for k in want)


def held_by_record(book: dict | None) -> bool:
    """A book whose copy its daily check holds: the mirror never loads it, nor marks it or its tabs gone."""
    return (book or {}).get("status") == RECORD_STATUS


def direct_newer(book: dict | None, meta: dict | None) -> bool:
    """Whether the copy last read this book straight from Google, after the other source last read it."""
    b = book or {}
    last = (meta or {}).get("last_sync_at")
    return b.get("status") in DIRECT_HELD and b.get("synced_at") is not None and (last is None or last < b["synced_at"])


def index_name(table: str, column: str) -> str:
    """An indexed column's index, named by a hash: a table's own name may already fill Postgres' 63 characters."""
    return "ix_" + hashlib.sha1(f"{table}.{column}".encode()).hexdigest()[:24]


def index_sql(table: str, column: str) -> Any:
    return sql.SQL("create index if not exists {} on {} ({})").format(
        sql.Identifier(index_name(table, column)), sql.Identifier("sheets", table), sql.Identifier(column))


def first_line(exc: BaseException) -> str:
    text = str(exc).strip()
    return text.splitlines()[0][:300] if text else ""


class _Whole(Exception):
    """A row-by-row refresh that must give way to a whole load; its transaction rolls back."""


class Sync:
    def __init__(self) -> None:
        self.hub: Any = None
        self.mirror: Any = None
        # its own line to the mirror, waiting on the keeper's word between passes
        self.listener: Any = None
        self.keeper_ok = True
        self.listing_ok = True
        self.keeper: dict | None = None
        # the tabs whose keeper header is a whole header in the sheet's order (an owned book), not a giant's
        self.keeper_exact: set = set()
        self.reloaded: set[str] = set()
        self.google = S.Google()

    def connect(self) -> None:
        if self.hub is None or self.hub.closed:
            dsn = os.getenv("HUB_DB_DSN") or ""
            kw = {} if dsn else {"host": os.getenv("HUB_DB_HOST") or "asa-hub-db",
                                 "port": os.getenv("HUB_DB_PORT") or "5432",
                                 "dbname": os.getenv("POSTGRES_DB") or "asa_hub",
                                 "user": os.getenv("POSTGRES_USER") or "asa_hub",
                                 "password": os.getenv("POSTGRES_PASSWORD") or ""}
            self.hub = psycopg.connect(dsn, autocommit=True, application_name="asa-hub-db-sync", **kw)
            if not self.hub.execute("select pg_try_advisory_lock(%s)", (LOCK_KEY,)).fetchone()[0]:
                self.close()
                raise RuntimeError("another asa-hub-db-sync holds the lock")
            self.hub.execute((HERE / "schema.sql").read_text(encoding="utf-8"))
            self.ensure_indexes()
        if MIRROR_ON and (self.mirror is None or self.mirror.closed):
            dsn = os.getenv("MIRROR_DSN") or ""
            if not dsn:
                raise RuntimeError("MIRROR_DSN is not set")
            self.mirror = psycopg.connect(dsn, autocommit=True, application_name="asa-hub-db-sync")
            # the mirror is read, never written, whatever role the DSN names
            self.mirror.execute("set session characteristics as transaction read only")
            self.mirror.execute("set statement_timeout = '15min'")

    def ensure_indexes(self) -> None:
        """Every copied tab that keeps an indexed column carries its index, a tab copied before the column was too."""
        have = {r[0] for r in self.hub.execute("select indexname from pg_indexes where schemaname = 'sheets'")}
        for table, cols in self.hub.execute("select table_name, columns from catalog.tabs where gone_at is null"):
            for pair in cols or []:
                column = pair[1] if isinstance(pair, list) and len(pair) == 2 else None
                if column not in INDEXED_COLUMNS or index_name(table, column) in have:
                    continue
                try:
                    self.hub.execute(index_sql(table, column))
                    log.info("index on %s (%s) made", table, column)
                except psycopg.Error as exc:
                    log.warning("index on %s (%s) not made: %s", table, column, first_line(exc))

    def wait(self, seconds: float) -> None:
        """Until the keeper says a pass committed, a daily check is staged, or `seconds` pass."""
        end = time.monotonic() + seconds
        while True:
            left = end - time.monotonic()
            if left <= 0 or self._heard(min(left, PULL_POLL_S)):
                return
            try:
                if self.hub is not None and not self.hub.closed and self.pulls_ready() and self.hub.execute(
                        f"select 1 from {PULLS} where state = 'staged' limit 1").fetchone():
                    return
            except Exception as exc:  # noqa: BLE001 - the next pass connects again
                log.warning("staged checks not looked for (%s)", type(exc).__name__)
                return

    def _heard(self, seconds: float) -> bool:
        """Until the keeper says a pass committed (True), or `seconds` pass; with no line to listen on, the clock
        alone. With the mirror off there is no keeper to hear: the clock."""
        if not MIRROR_ON:
            time.sleep(seconds)
            return False
        try:
            if self.listener is None or self.listener.closed:
                dsn = os.getenv("MIRROR_DSN") or ""
                if not dsn:
                    raise RuntimeError("MIRROR_DSN is not set")
                self.listener = psycopg.connect(dsn, autocommit=True, application_name="asa-hub-db-sync")
                self.listener.execute("set session characteristics as transaction read only")
                self.listener.execute(sql.SQL("listen {}").format(sql.Identifier(MIRROR_MOVED)))
                log.info("listening for the keeper's passes on %s", MIRROR_MOVED)
            for _note in self.listener.notifies(timeout=seconds, stop_after=1):
                return True
        except Exception as exc:  # noqa: BLE001 - the clock still drives the passes
            log.warning("the keeper's passes are not heard (%s: %s); the next pass waits for the clock",
                        type(exc).__name__, first_line(exc))
            try:
                if self.listener is not None:
                    self.listener.close()
            except Exception:  # noqa: BLE001
                pass
            self.listener = None
            time.sleep(seconds)
        return False

    def close(self) -> None:
        for conn in (self.hub, self.mirror):
            try:
                if conn is not None:
                    conn.close()
            except Exception:  # noqa: BLE001
                pass
        self.hub = self.mirror = None

    def broken(self) -> bool:
        return any(c is None or c.closed or c.broken for c in (self.hub, self.mirror))

    def _dicts(self, conn: Any, query: str, params: Any = None) -> list[dict]:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(query, params)
            return cur.fetchall()

    def aggregate(self, sids: list[str] | None) -> dict[str, dict[str, tuple[int, Any]]]:
        query = "select sheet_id, tab_name, count(*), max(ingested_at) from asa_drive_sheets_rows"
        params = None
        if sids is not None:
            query += " where sheet_id = any(%s)"
            params = (sids,)
        out: dict[str, dict[str, tuple[int, Any]]] = {}
        for sid, tab, n, newest in self.mirror.execute(query + " group by sheet_id, tab_name", params):
            out.setdefault(sid, {})[tab] = (int(n), newest)
        return out

    def keeper_header(self, sid: str, tab: str) -> list:
        """The mirror's jsonb loses column order; the keeper's tracked tabs still carry it."""
        return self.keeper_tabs().get((sid, tab)) or []

    def owned_books(self) -> set[str]:
        """The books the keeper owns: each keeps a tab's header in the sheet's order, which it records for no other."""
        self.keeper_tabs()
        return {s for s, _t in self.keeper_exact}

    def keeper_tabs(self) -> dict:
        """(sheet, tab) -> the keeper's header, read once a pass; keeper_exact the owned tabs among them."""
        if self.keeper is None:
            self.keeper = {}
            self.keeper_exact = set()
            if self.keeper_ok:
                try:
                    # giant is read through the row so a keeper that has not added it yet still answers
                    for s, t, h, giant in self.mirror.execute(
                            "select sheet_id, tab_name, header, to_jsonb(k) ->> 'giant' from hub_sheet_sync_tabs k"):
                        self.keeper[(s, t)] = h if isinstance(h, list) else []
                        if giant == "false":
                            self.keeper_exact.add((s, t))
                except Exception as exc:  # noqa: BLE001
                    self.keeper_ok = False
                    log.info("no sheet column order from hub_sheet_sync_tabs (%s); mirror key order used",
                             type(exc).__name__)
        return self.keeper

    def keeper_listing(self) -> tuple[Any, set[str]] | None:
        """When the keeper last listed Drive's changes and the books that listing still owes; None when unreadable."""
        try:
            row = self.mirror.execute("select listed_at, pending from hub_sheet_sync_state where id = 1").fetchone()
        except Exception as exc:  # noqa: BLE001
            if self.broken():
                raise
            if self.listing_ok:
                log.info("no keeper listing time from hub_sheet_sync_state (%s); books checked without it",
                         type(exc).__name__)
            self.listing_ok = False
            return None
        self.listing_ok = True
        if not row or row[0] is None:
            return None
        return row[0], {str(s) for s in (row[1] if isinstance(row[1], list) else [])}

    def feed_rows(self, sid: str, tab: str, only: list[int] | None = None) -> Any:
        """The mirror's rows of a tab in row order (only: these row numbers), each with its keyed hash."""
        query = ROWS_SQL + (" and row_number = any(%s)" if only is not None else "") + " order by row_number"
        params = (sid, tab) if only is None else (sid, tab, only)

        def feed(put: Any) -> None:
            with self.mirror.transaction(), self.mirror.cursor(name="asa_hub_tab") as src:
                src.itersize = FETCH_ROWS
                src.execute(query, params)
                for rn, data, ingested, md5 in src:
                    put(rn, data, ingested, row_hash(md5))
        return feed

    def load_tab(self, sid: str, tab: str, book: str, cat: dict | None, taken: set[str]) -> int:
        keys = [r[0] for r in self.mirror.execute(KEYS_SQL, (sid, tab))]
        order = self.keeper_header(sid, tab)
        return self.store_tab(sid, tab, book, cat, taken, keys, order, self.feed_rows(sid, tab),
                              exact=(sid, tab) in self.keeper_exact)

    @staticmethod
    def _copy_sql(tbl: Any, cols: list[str]) -> Any:
        return sql.SQL("copy {} ({}) from stdin").format(
            tbl, sql.SQL(", ").join(map(sql.Identifier, ["row_number", "_raw", "_ingested_at", "_hash", *cols])))

    @staticmethod
    def _writer(cp: Any, keys: list[str], pairs: list[list[str]], seen: dict) -> Any:
        """put(row, data, ingested, hash): one row through the withholding rule into the copy."""
        def put(rn: int, data: Any, ingested: Any, h: bytes | None = None) -> None:
            raw = withhold(data, keys)
            cp.write_row((rn, json.dumps(raw, ensure_ascii=False), ingested, h,
                          *[cell(raw.get(hd)) for hd, _ in pairs]))
            seen["rows"] += 1
            if ingested is not None and (seen["newest"] is None or ingested > seen["newest"]):
                seen["newest"] = ingested
        return put

    def store_tab(self, sid: str, tab: str, book: str, cat: dict | None, taken: set[str], keys: list[str],
                  order: list, feed: Any, newest_at: Any = None, exact: bool = False,
                  vacuum: list | None = None) -> int:
        with reading(sid):
            return self._store_tab(sid, tab, book, cat, taken, keys, order, feed, newest_at, exact, vacuum)

    def _store_tab(self, sid: str, tab: str, book: str, cat: dict | None, taken: set[str], keys: list[str],
                   order: list, feed: Any, newest_at: Any = None, exact: bool = False,
                   vacuum: list | None = None) -> int:
        """One tab replaced whole, in one transaction, every row through the withholding rule; inside a caller's
        transaction (`vacuum` a list), the table to vacuum is named there instead."""
        headers, pairs, dropped = plan_columns(cat, keys, order, exact)
        name = cat["table_name"] if cat else pick_table_name(sid, tab, book, taken)
        cols = [c for _, c in pairs]
        tbl = sql.Identifier("sheets", name)
        create = sql.SQL("create table if not exists {} (row_number integer primary key{},"
                         " _raw jsonb, _ingested_at timestamptz, _hash bytea)").format(
            tbl, sql.SQL("").join(sql.SQL(", {} text").format(sql.Identifier(c)) for c in cols))
        seen: dict[str, Any] = {"rows": 0, "newest": None}
        with self.hub.transaction(), self.hub.cursor() as cur:
            cur.execute(create)
            cur.execute("select column_name from information_schema.columns"
                        " where table_schema = 'sheets' and table_name = %s", (name,))
            have = {r[0] for r in cur.fetchall()}
            for c in dropped:
                if c in have and c not in cols:
                    cur.execute(sql.SQL("alter table {} drop column {}").format(tbl, sql.Identifier(c)))
            for c in cols:
                if c not in have:
                    cur.execute(sql.SQL("alter table {} add column {} text").format(tbl, sql.Identifier(c)))
                if c in INDEXED_COLUMNS:
                    cur.execute(index_sql(name, c))
            if "_hash" not in have:
                cur.execute(sql.SQL("alter table {} add column if not exists _hash bytea").format(tbl))
            cur.execute(sql.SQL("delete from {}").format(tbl))
            with cur.copy(self._copy_sql(tbl, cols)) as cp:
                feed(self._writer(cp, keys, pairs, seen))
            cur.execute(sql.SQL(DIGEST_SQL).format(h=sql.Identifier("_hash"), at=sql.Identifier("_ingested_at"),
                                                   t=tbl))
            digest = cur.fetchone()[0]
            newest = newest_at if newest_at is not None else seen["newest"]
            cur.execute(UPSERT_TAB, (sid, tab, name, Jsonb(pairs), seen["rows"], newest, digest, Jsonb(keys)))
        if guard_hits(headers):
            # the rows a reload replaced are gone from the pages too, not only from the table
            if vacuum is not None:
                vacuum.append(name)
            else:
                self.hub.execute(sql.SQL("vacuum {}").format(tbl))
        taken.add(name)
        return seen["rows"]

    def refresh_tab(self, sid: str, tab: str, cat: dict) -> tuple[str, int] | None:
        with reading(sid):
            return self._refresh_tab(sid, tab, cat)

    def _refresh_tab(self, sid: str, tab: str, cat: dict) -> tuple[str, int] | None:
        """A moved tab compared row by row with the mirror by keyed hash: ('same' | 'patched', rows written);
        None when it must load whole (its keys or columns changed, or most of its rows did)."""
        name = cat["table_name"]
        tbl = sql.Identifier("sheets", name)
        m = sql.Identifier(MIRROR_ROWS)
        order = self.keeper_header(sid, tab)
        exact = (sid, tab) in self.keeper_exact
        try:
            with self.hub.transaction(), self.hub.cursor() as cur:
                cur.execute(sql.SQL("create temp table if not exists {} (row_number integer primary key,"
                                    " h bytea not null, ing timestamptz) on commit delete rows").format(m))
                with cur.copy(sql.SQL("copy {} (row_number, h, ing) from stdin").format(m)) as cp, \
                        self.mirror.transaction(), self.mirror.cursor(name="asa_hub_hashes") as src:
                    src.itersize = HASH_FETCH_ROWS
                    src.execute(HASHES_SQL, (sid, tab))
                    for rn, md5, ing in src:
                        cp.write_row((rn, row_hash(md5), ing))
                cur.execute(sql.SQL("analyze {}").format(m))
                cur.execute(sql.SQL(DIGEST_SQL).format(h=sql.Identifier("h"), at=sql.Identifier("ing"), t=m))
                digest, n, newest = cur.fetchone()
                same = digest == cat["digest"]
                keys = cat["keys"]
                changed: list[int] = []
                gone = 0
                if not same:
                    keys = [r[0] for r in self.mirror.execute(KEYS_SQL, (sid, tab))]
                headers, pairs, dropped = plan_columns(cat, keys, order, exact)
                if keys != cat["keys"] or dropped or {c for _, c in pairs} != {c for _, c in cat["columns"] or []}:
                    raise _Whole("its keys changed")
                if not same:
                    cur.execute(sql.SQL("delete from {} c where not exists (select 1 from {} r"
                                        " where r.row_number = c.row_number)").format(tbl, m))
                    gone = cur.rowcount
                    cur.execute(sql.SQL("select r.row_number from {} r left join {} c on c.row_number = r.row_number"
                                        " where c.row_number is null or c._hash is distinct from r.h"
                                        " order by 1").format(m, tbl))
                    changed = [r[0] for r in cur.fetchall()]
                    if 2 * len(changed) > n:
                        raise _Whole(f"{len(changed)} of {n} rows changed")
                    if changed:
                        cur.execute(sql.SQL("delete from {} where row_number = any(%s)").format(tbl), (changed,))
                        seen: dict[str, Any] = {"rows": 0, "newest": None}
                        with cur.copy(self._copy_sql(tbl, [c for _, c in pairs])) as cp:
                            self.feed_rows(sid, tab, changed)(self._writer(cp, keys, pairs, seen))
                # the same rows the keeper wrote again: only when it wrote them moves
                cur.execute(sql.SQL("update {} c set _ingested_at = r.ing from {} r where r.row_number = c.row_number"
                                    " and c._hash = r.h and c._ingested_at is distinct from r.ing").format(tbl, m))
                if not same:
                    # what the table now holds, rows fetched after the hashes included
                    cur.execute(sql.SQL(DIGEST_SQL).format(h=sql.Identifier("_hash"),
                                                           at=sql.Identifier("_ingested_at"), t=tbl))
                    digest, n, newest = cur.fetchone()
                cur.execute(UPSERT_TAB, (sid, tab, name, Jsonb(pairs), n, newest, digest, Jsonb(keys)))
        except (_Whole, psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn) as why:
            log.info("tab %s / %r loads whole: %s", sid, tab, first_line(why))
            return None
        if guard_hits(headers) and (gone or changed):
            # the rows a reload replaced are gone from the pages too, not only from the table
            self.hub.execute(sql.SQL("vacuum {}").format(tbl))
        return ("same", 0) if same else ("patched", len(changed))

    def direct_pass(self, meta: dict, books: dict, tabs: dict, taken: set[str]) -> set[str]:
        """A book whose sheet moved past what the copy holds is read straight from Google and stored now; a book
        whose copy holds Drive's last change is stamped current as of this listing. The books so stamped."""
        if self.google is None or not self.google.available:
            return set()
        listed_at = datetime.now(timezone.utc)
        try:
            seen = self.google.modified()
        except Exception as exc:  # noqa: BLE001
            log.info("direct: Google's list not read (%s: %s)", type(exc).__name__, first_line(exc))
            return set()
        now = datetime.now(timezone.utc)
        moved, aged, current = [], [], []
        for sid, (name, mod) in seen.items():
            b = books.get(sid)
            if b is None or b.get("gone_at") is not None or held_by_record(b):
                continue
            if int(b.get("row_count") or 0) > DIRECT_MAX_ROWS:
                continue
            held = [t for t in (b.get("direct_modified"), (meta.get(sid) or {}).get("modified_time"),
                                b.get("modified_time")) if t is not None]
            if not held or mod > max(held) + timedelta(seconds=DIRECT_GRACE_S):
                if (now - mod).total_seconds() >= DIRECT_SETTLE_S:
                    moved.append((mod, sid, name))
                continue
            own = [t for t in (b.get("direct_modified"), b.get("modified_time")) if t is not None]
            if own and mod <= max(own) + timedelta(seconds=DIRECT_GRACE_S):
                # the copy holds the change Drive last saw: it holds what this listing saw
                current.append(sid)
            # formulas change a sheet's values without moving its modifiedTime: a book unread this long is read again
            read = b.get("synced_at")
            if read is None or (now - read).total_seconds() > DIRECT_REFRESH_S:
                aged.append((read or datetime.min.replace(tzinfo=timezone.utc), sid, name, mod))
        if current:
            self.hub.execute("update catalog.books set checked_at = %s, listed_at = %s where gone_at is null"
                             " and sheet_id = any(%s)", (listed_at, listed_at, current))
        moved.sort(reverse=True)
        aged.sort()
        stale = moved + [(mod, sid, name) for _r, sid, name, mod in aged]
        # an owned book is stored as its keeper stores it: every column of a repeated header, the catalog in sheet order
        owned = self.owned_books() if stale else set()
        done = rows = 0
        for n, (mod, sid, name) in enumerate(stale[:DIRECT_MAX]):
            if n:
                time.sleep(DIRECT_GAP_S)
            try:
                got = self.google.book(sid, twins=sid in owned)
            except S.Refused as exc:
                log.info("direct: %s not read (%s)", sid, first_line(exc))
                if time.monotonic() < self.google.quiet_until:
                    break
                continue
            try:
                for tab, keys, data in got:
                    cat = tabs.get((sid, tab))
                    rows += self.store_tab(sid, tab, name, cat, taken, keys, keys,
                                           lambda put, data=data: [put(rn, d, now) for rn, d in data], newest_at=now,
                                           exact=(sid, tab) in self.keeper_exact)
            except Exception as exc:  # noqa: BLE001
                if self.broken():
                    raise
                log.error("direct: %s not stored: %s: %s", sid, type(exc).__name__, first_line(exc))
                continue
            gone = [(sid, t) for (s, t), r in tabs.items() if s == sid and r["gone_at"] is None
                    and t not in {g[0] for g in got}]
            self.mark_tabs_gone(gone)
            self.hub.execute("update catalog.books set direct_modified = %s, synced_at = now(), status = %s,"
                             " name = %s, tab_count = %s, gone_at = null where sheet_id = %s",
                             (mod, DIRECT_STATUS, name or books[sid]["name"], len(got), sid))
            books[sid].update(direct_modified=mod, status=DIRECT_STATUS, synced_at=datetime.now(timezone.utc))
            done += 1
        if stale:
            log.info("direct: %d book(s) behind their sheet, %d unread too long; %d read from Google (%d rows), "
                     "%d left for later", len(moved), len(aged), done, rows, len(stale) - done)
        return set(current)

    # -- the record books' daily checks (app/sheet_check.py), staged in asa-hub-db --
    def pulls_ready(self) -> bool:
        got = self.hub.execute("select to_regclass(%s) is not null and to_regclass(%s) is not null",
                               (PULLS, PULL_ROWS)).fetchone()
        return bool(got and got[0])

    def load_pulls(self) -> int:
        """Every check staged, oldest first, stored as its book's copy; how many were."""
        if not self.pulls_ready():
            return 0
        staged = self._dicts(self.hub, f"select id, sheet_id, name, read_at, partial, tabs from {PULLS}"
                                       " where state = 'staged' order by id")
        stored = 0
        for p in staged:
            tabs = {(r["sheet_id"], r["tab_name"]): r for r in self._dicts(
                self.hub, "select sheet_id, tab_name, table_name, columns, row_count, source_synced_at, gone_at,"
                          " guarded, digest, keys from catalog.tabs where sheet_id = %s", (p["sheet_id"],))}
            taken = {r[0] for r in self.hub.execute("select table_name from catalog.tabs")}
            try:
                self.store_pull(p, tabs, taken)
                stored += 1
            except Exception as exc:  # noqa: BLE001 - this check is told failed; the book is checked again
                if self.broken():
                    raise
                log.error("check %s of %s not stored: %s: %s", p["id"], p["sheet_id"], type(exc).__name__,
                          first_line(exc))
                self.hub.execute(f"update {PULLS} set state = 'failed', why = %s where id = %s",
                                 (f"{type(exc).__name__}: {first_line(exc)}"[:400], p["id"]))
        return stored

    def pull_feed(self, pull_id: int, tab: str, read_at: Any) -> Any:
        """A staged tab's rows in row order, each with the keyed hash the copy keeps — read before the copy is written,
        on the same connection."""
        got = self.hub.execute(PULL_ROWS_SQL.format(t=PULL_ROWS), (pull_id, tab)).fetchall()

        def feed(put: Any) -> None:
            for rn, data, md5 in got:
                put(rn, data, read_at, row_hash(md5))
        return feed

    def store_pull(self, p: dict, tabs: dict, taken: set[str]) -> None:
        """One check as its book's copy, in one transaction: each tab it read stored whole (a tab it kept, Postgres
        owing it a change the sheet no longer has, left as it was), a tab it did not find gone unless it read only
        some, the book named the record's — from then on the mirror never loads it."""
        sid, name, read_at = p["sheet_id"], p["name"] or "", p["read_at"]
        listed = p["tabs"] if isinstance(p["tabs"], list) else json.loads(p["tabs"] or "[]")
        vacuum: list[str] = []
        rows = 0
        with self.hub.transaction():
            for t in listed:
                if t.get("kept"):
                    continue
                keys = [str(k) for k in t.get("keys") or []]
                rows += self.store_tab(sid, t["tab"], name, tabs.get((sid, t["tab"])), taken, keys, keys,
                                       self.pull_feed(p["id"], t["tab"], read_at), newest_at=read_at,
                                       exact=bool(t.get("exact")), vacuum=vacuum)
            if not p["partial"]:
                names = {t["tab"] for t in listed}
                gone = [k for k, r in tabs.items() if r["gone_at"] is None and k[1] not in names]
                if gone:
                    with self.hub.cursor() as cur:
                        cur.executemany("update catalog.tabs set gone_at = now() where sheet_id = %s"
                                        " and tab_name = %s and gone_at is null", gone)
            n, total = self.hub.execute("select count(*), coalesce(sum(row_count), 0) from catalog.tabs"
                                        " where sheet_id = %s and gone_at is null", (sid,)).fetchone()
            self.hub.execute(RECORD_BOOK, (sid, name, read_at, RECORD_STATUS, int(n), int(total)))
            self.hub.execute(f"update {PULLS} set state = 'stored', stored_at = now() where id = %s", (p["id"],))
            self.hub.execute(f"delete from {PULL_ROWS} where pull_id = %s", (p["id"],))
            self.hub.execute(f"update {RECORD_BOOKS} set held_since = coalesce(held_since, now()) where sheet_id = %s",
                             (sid,))
        for table in vacuum:
            self.hub.execute(sql.SQL("vacuum {}").format(sql.Identifier("sheets", table)))
        log.info("check %s stored: %s (%s), %d tab(s), %d row(s)%s", p["id"], sid, name[:40],
                 sum(1 for t in listed if not t.get("kept")), rows, " (some tabs)" if p["partial"] else "")

    def reload_once(self, name: str, tabs: dict, reaches: Any) -> None:
        """The tabs a change of the rule reaches are unguarded, so they load again under it; once, whatever restarts."""
        if name in self.reloaded:
            return
        if self.hub.execute("select 1 from catalog.reloads where name = %s", (name,)).fetchone():
            self.reloaded.add(name)
            return
        keys = [k for k, r in tabs.items() if r["guarded"] and r["gone_at"] is None and reaches(r["columns"], k[0])]
        with self.hub.transaction(), self.hub.cursor() as cur:
            if keys:
                cur.executemany("update catalog.tabs set guarded = false where sheet_id = %s and tab_name = %s", keys)
            cur.execute("insert into catalog.reloads (name) values (%s) on conflict do nothing", (name,))
        for k in keys:
            tabs[k]["guarded"] = False
        self.reloaded.add(name)
        log.info("reload %s: %d tab(s) load again under the rule", name, len(keys))

    def mark_tabs_gone(self, keys: list[tuple[str, str]]) -> None:
        if keys:
            with self.hub.transaction(), self.hub.cursor() as cur:
                cur.executemany("update catalog.tabs set gone_at = now()"
                                " where sheet_id = %s and tab_name = %s and gone_at is null", keys)

    def run_pass(self, full: bool) -> None:
        t0 = time.monotonic()
        self.connect()
        self.keeper = None
        # read before the mirror's books: everything the keeper listed by then is in what this pass reads
        read_at = datetime.now(timezone.utc)
        listing = self.keeper_listing()
        meta = {r["sheet_id"]: r for r in self._dicts(
            self.mirror, "select sheet_id, name, owners_json, modified_time, last_sync_at,"
                         " last_sync_status, tab_count, row_count from asa_drive_sheets_meta")}
        books = {r["sheet_id"]: r for r in self._dicts(
            self.hub, "select sheet_id, name, modified_time, synced_at, status, tab_count, row_count,"
                      " gone_at, direct_modified from catalog.books")}
        tabs = {(r["sheet_id"], r["tab_name"]): r for r in self._dicts(
            self.hub, "select sheet_id, tab_name, table_name, columns, row_count, source_synced_at,"
                      " gone_at, guarded, digest, keys from catalog.tabs")}
        if hasattr(R, "is_licence_column"):
            self.reload_once(LICENCE_RELOAD, tabs, licence_tab)
        if hasattr(R, "BOOK_KEPT_FACTS"):
            self.reload_once(KEPT_RELOAD, tabs, kept_tab)
        # a tab loaded before the rule ran is reloaded under it only when the rule could withhold something there
        clean = [k for k, r in tabs.items() if not r["guarded"] and not guard_hits(h for h, _ in r["columns"] or [])]
        if clean:
            with self.hub.transaction(), self.hub.cursor() as cur:
                cur.executemany("update catalog.tabs set guarded = true where sheet_id = %s and tab_name = %s", clean)
            for k in clean:
                tabs[k]["guarded"] = True
            log.info("guard: %d tab(s) hold nothing the rule withholds; %d to reload under it", len(clean),
                     sum(1 for r in tabs.values() if not r["guarded"]))
        if full:
            agg = self.aggregate(None)
            scope = set(agg) | set(meta)
        else:
            scope = {sid for sid, m in meta.items() if book_changed(m, books.get(sid))}
            agg = self.aggregate(sorted(scope)) if scope else {}
        taken = {r["table_name"] for r in tabs.values()}
        # stamped current by Google's own listing: the keeper's listing, older, never stamps them back
        listed_now = self.direct_pass(meta, books, tabs, taken) if DIRECT_GOOGLE else set()
        st = {"checked": 0, "loaded": 0, "patched": 0, "same": 0, "rows": 0, "gone": 0, "errors": 0}
        unsettled: set[str] = set(listed_now)
        # the books whose copy is their daily check's: the mirror never loads them
        record = {s for s, b in books.items() if held_by_record(b)}
        last_note = t0
        for done, sid in enumerate(sorted(scope), 1):
            if sid in record:
                unsettled.add(sid)
                continue
            if direct_newer(books.get(sid), meta.get(sid)):
                unsettled.add(sid)
                continue
            ok = True
            book = (meta.get(sid) or books.get(sid) or {}).get("name") or ""
            present = agg.get(sid, {})
            for tab, (n, newest) in sorted(present.items()):
                st["checked"] += 1
                cat = tabs.get((sid, tab))
                if not needs_load(cat, n, newest):
                    continue
                try:
                    got = self.refresh_tab(sid, tab, cat) if comparable(cat) else None
                    if got is None:
                        st["rows"] += self.load_tab(sid, tab, book, cat, taken)
                        st["loaded"] += 1
                    else:
                        st[got[0]] += 1
                        st["rows"] += got[1]
                except Exception as exc:  # noqa: BLE001
                    if self.broken():
                        raise
                    ok = False
                    st["errors"] += 1
                    log.error("tab %s / %r not loaded: %s: %s", sid, tab, type(exc).__name__, first_line(exc))
                if time.monotonic() - last_note >= PROGRESS_S:
                    last_note = time.monotonic()
                    log.info("loading: %d/%d books, %d tabs loaded, %d patched, %d rows, %.0fs",
                             done, len(scope), st["loaded"], st["patched"], st["rows"], last_note - t0)
            if not ok:
                unsettled.add(sid)
            gone = [k for k, r in tabs.items() if k[0] == sid and r["gone_at"] is None and k[1] not in present]
            # an empty full read of the mirror is a fault, never a reason to mark everything gone
            if gone and (agg or not full):
                self.mark_tabs_gone(gone)
                st["gone"] += len(gone)
            if ok and sid in meta and (full or book_changed(meta[sid], books.get(sid))):
                b = book_row(meta[sid])
                self.hub.execute(UPSERT_BOOK, (sid, b["name"], Jsonb(meta[sid].get("owners_json") or []),
                                               b["modified_time"], b["synced_at"], b["status"],
                                               b["tab_count"], b["row_count"]))
        if full and agg:
            gone = [k for k, r in tabs.items() if k[0] not in scope and k[0] not in record and r["gone_at"] is None]
            self.mark_tabs_gone(gone)
            st["gone"] += len(gone)
        if meta:
            self.hub.execute("update catalog.books set gone_at = now() where gone_at is null"
                             " and status is distinct from %s and not (sheet_id = any(%s))",
                             (RECORD_STATUS, list(meta)))
            self.stamp_books(meta, unsettled, read_at, listing)
        log.info("pass %s: books %d, tabs checked %d, loaded %d, patched %d, same %d, rows %d, gone %d, errors %d,"
                 " %.1fs", "full" if full else "changed", len(scope), st["checked"], st["loaded"], st["patched"],
                 st["same"], st["rows"], st["gone"], st["errors"], time.monotonic() - t0)

    def stamp_books(self, meta: dict, unsettled: set[str], read_at: datetime,
                    listing: tuple[Any, set[str]] | None) -> None:
        """Each book whose copy now equals the mirror as read at read_at says so (checked_at), and, when the keeper's
        listing was read and owes it nothing, the listing it holds (listed_at): what Python's freshness rests on."""
        owed = listing[1] if listing else set()
        held = [sid for sid, m in meta.items()
                if sid not in unsettled and sid not in owed and m.get("last_sync_status") in COPIED_STATUSES]
        self.hub.execute("update catalog.books set checked_at = %s, listed_at = coalesce(%s, listed_at)"
                         " where gone_at is null and sheet_id = any(%s)",
                         (read_at, listing[0] if listing else None, held))


def _stop(signum: int, frame: Any) -> None:
    raise SystemExit(0)


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, stream=sys.stdout,
                        format="%(asctime)s %(levelname)s %(message)s")
    if psycopg is None:
        log.error("psycopg is not installed")
        return 2
    if R is None:
        log.error("the withholding rule (redaction.py) is not mounted; nothing is copied without it")
        return 2
    signal.signal(signal.SIGTERM, _stop)
    once = "--once" in argv
    sync = Sync()
    last_full: float | None = None
    while True:
        t0 = time.monotonic()
        full = once or last_full is None or t0 - last_full >= FULL_EVERY_S
        try:
            sync.connect()
            # the record books' checks first: the pass leaves those books alone
            sync.load_pulls()
            if MIRROR_ON:
                sync.run_pass(full)
            if full:
                last_full = t0
        except Exception as exc:  # noqa: BLE001
            log.error("pass failed: %s: %s", type(exc).__name__, first_line(exc))
            sync.close()
            if once:
                return 1
        if once:
            return 0
        sync.wait(max(5.0, EVERY_S - (time.monotonic() - t0)))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
