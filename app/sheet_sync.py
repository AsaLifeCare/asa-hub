"""asa-hub-sheet-sync: Postgres is the record, the sheets its backup. Each round, the book changes queued (app.book_ops),
then a paced, resumable backup of every cell owed to Google, book by book, oldest owed first (a cell only Postgres
changed is written; one both sides changed goes to the newer side, judged by when the sheet's value can have come —
Google keeps no time per cell — Postgres on a tie, every such decision logged in app.edit_conflicts); then the daily
check of the record books whose turn it is (app/sheet_check.py), then the kept edits a stored check made redundant
compacted (app/record_books.py). A quota refusal stops the round and backs off, doubling; nothing a door does ever
waits on it."""
from __future__ import annotations

import json
import logging
import os
import re
import signal
import sys
import time
import urllib.parse
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

# server/redaction.py, the one withholding rule of every copy; without it nothing is compared
for _rules in (os.getenv("HUB_RULES_DIR") or "/rules", str(Path(__file__).resolve().parent.parent / "server")):
    if (Path(_rules) / "redaction.py").is_file():
        sys.path.insert(0, _rules)
        break
try:
    import redaction as R
except ImportError:
    R = None  # type: ignore[assignment]

import book_ops as BO
import client_writes as CW
import gsjs
import hubdb
import record_books as RB
import writes as W
from gsjs import NY, SheetDate

log = logging.getLogger("asa-hub-sheet-sync")

EVERY_S = float(os.getenv("HUB_TWO_WAY_EVERY_S") or 120)
WRITES_PER_MIN = max(1, int(os.getenv("HUB_TWO_WAY_WRITES_PER_MIN") or 20))
READS_PER_CYCLE = max(1, int(os.getenv("HUB_TWO_WAY_READS_PER_CYCLE") or 10))
# the back-off after a quota refusal: from this, doubling at each refusal in a row, up to HUB_TWO_WAY_BACKOFF_S
BACKOFF_MIN_S = float(os.getenv("HUB_BACKUP_BACKOFF_MIN_S") or 60)
BACKOFF_S = float(os.getenv("HUB_TWO_WAY_BACKOFF_S") or 1800)
# a cell owed on a row or a column the sheet lacked is asked again this long after
MISSING_EVERY_S = float(os.getenv("HUB_BACKUP_MISSING_EVERY_S") or 6 * 3600)
# a book Google answered with an error (not a refusal) is asked again this long after
BOOK_RETRY_S = float(os.getenv("HUB_BACKUP_RETRY_S") or 900)
# the daily checks a round runs at most, after the backup
CHECKS_PER_ROUND = max(0, int(os.getenv("HUB_CHECKS_PER_ROUND") or 1))
# on | dry-run (decides and logs, writes nothing) | off
MODE = (os.getenv("HUB_TWO_WAY_MODE") or "on").strip().lower()
SA_FILE = os.getenv("HUB_TWO_WAY_SA_FILE") or "/app/.sa-living-brain.json"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
API = "https://sheets.googleapis.com/v4/spreadsheets"
HEARTBEAT = Path(os.getenv("HUB_TWO_WAY_HEARTBEAT") or "/tmp/sheet-sync.json")
KEEP_DAYS = 14
# a tab past this many rows is never loaded whole from the copy to bound a race (the container holds 1 GiB)
COPY_BOUND_MAX_ROWS = int(os.getenv("HUB_TWO_WAY_COPY_BOUND_MAX_ROWS") or 5000)
QUOTA_REASONS =("rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED", "RESOURCE_EXHAUSTED",
                 "quotaExceeded", "Quota exceeded")

# a cell both sides changed (TabMerge.newer): every conflict row's why starts with one of these
WHY_PG_NEWER = "Postgres is newer"
WHY_SHEET_NEWER = "the sheet is newer"
WHY_AMBIGUOUS = "ambiguous"
WHY_GONE = "the row left the sheet; the daily check decides it"
WHY_GONE_OWED = "the row left the sheet while a change to it was owed; written again as a new row"
WHY_REMOVED = "a book change of Postgres' own took the row off the tab; it is never written back"
WHY_OWED_ROW = "owed to the sheet as a new row"


# ---- the tab as the keeper reads it (server/hub_sheet_sync.py), so every value compares with the copy's ----------

def _looks_like_label(c: Any) -> bool:
    s = "" if c is None else str(c).strip()
    if not s or re.fullmatch(r"-?\d+(\.\d+)?", s) or re.fullmatch(r"\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}.*)?", s):
        return False
    return bool(re.search(r"[A-Za-z]", s))


def header_of(values: list[list]) -> tuple[int, list[str]]:
    """(header row index, header): the first of 8 rows with 2+ cells, one label-shaped; else row 0."""
    for i in range(min(len(values), 8)):
        row = values[i] or []
        filled = [c for c in row if c is not None and str(c).strip() != ""]
        if len(filled) < 2 or not any(_looks_like_label(c) for c in filled):
            continue
        last = max(j for j, c in enumerate(row) if c is not None and str(c).strip() != "")
        return i, [str(c).strip() for c in row[: last + 1]]
    return 0, [str(h).strip() for h in (values[0] if values else [])]


def twin_keys(header: list[str]) -> list[str]:
    """A repeated name's last column keeps the name, each earlier one is "<name> ⟨n⟩" (the copy's keys)."""
    total: dict[str, int] = {}
    for h in header:
        if h:
            total[h] = total.get(h, 0) + 1
    seen: dict[str, int] = {}
    out = []
    for h in header:
        if h and total[h] > 1:
            seen[h] = seen.get(h, 0) + 1
            out.append(h if seen[h] == total[h] else f"{h} ⟨{seen[h]}⟩")
        else:
            out.append(h)
    return out


def parse_row(row: list | None, keys: list[str]) -> dict | None:
    row = row or []
    data = {k: (str(row[i]) if i < len(row) and row[i] is not None else "") for i, k in enumerate(keys) if k}
    return data if data and any(v.strip() for v in data.values()) else None


def col_letter(n: int) -> str:
    out = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out or "A"


def quote(title: str) -> str:
    return "'" + str(title).replace("'", "''") + "'"


# ---- cell values: equal by meaning, written as a person would type them ------------------------------------------

_ISO_Z = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$")
_RISKY = re.compile(r"^[=+\-@']|\d|%|^(true|false)$", re.I)


def _instant(s: str) -> SheetDate | None:
    m = _ISO_Z.match(s)
    if not m:
        return None
    try:
        return SheetDate(datetime.fromisoformat(s.replace("Z", "+00:00")))
    except ValueError:
        return None


def canon(v: Any) -> Any:
    """What a cell means (a number, an instant, a clock, a yes/no); None for plain text."""
    s = gsjs.trim(str(v or ""))
    if not s:
        return None
    got = _instant(s)
    if got is not None:
        return ("d", got.at)
    if s.lower() in ("true", "false"):
        return ("b", s.lower() == "true")
    t = hubdb.typed(s, "estate")
    if isinstance(t, SheetDate):
        return ("d", t.at)
    if isinstance(t, hubdb.SheetTime):
        return ("t", t.h, t.m, t.s)
    if isinstance(t, bool):
        return ("b", t)
    if isinstance(t, (int, float)):
        return ("n", float(t))
    return None


def same(a: Any, b: Any, keyed: str = "header") -> bool:
    sa, sb = gsjs.trim(str(a or "")), gsjs.trim(str(b or ""))
    if sa == sb:
        return True
    ca, cb = canon(sa), canon(sb)
    if ca is not None and ca == cb:
        return True
    return W.same_cell(sa, sb, keyed)


def entered(v: Any) -> str:
    """The text USER_ENTERED turns into what the edit means: numbers and dates typed, text quoted if it could parse."""
    s = str(v or "")
    if not gsjs.trim(s):
        return ""
    at = _instant(gsjs.trim(s))
    if at is not None:
        loc = at.at.astimezone(NY)
        day = f"{loc.month}/{loc.day}/{loc.year}"
        if (loc.hour, loc.minute, loc.second) == (0, 0, 0):
            return day
        return f"{day} {loc.hour}:{loc.minute:02d}:{loc.second:02d}"
    if canon(s) is not None:
        return gsjs.trim(s)
    return "'" + s if _RISKY.search(s) else s


def marker(v: Any) -> bool:
    return R is not None and R.is_marker_value(v)


def _when(t: float | None) -> str:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%fZ") if t else "unknown"


# ---- Google: one paced client, a refusal stops everything ------------------------------------------------------

class Refused(RuntimeError):
    """Google refused for quota: the cycle stops and the service backs off."""


class GoogleError(RuntimeError):
    def __init__(self, status: int, said: str) -> None:
        super().__init__(f"Google answered {status}")
        self.status, self.said = status, said


def _sa_token(path: str) -> Callable[[], str]:
    from google.auth.transport.requests import Request  # noqa: PLC0415
    from google.oauth2 import service_account  # noqa: PLC0415
    cred = service_account.Credentials.from_service_account_file(path, scopes=SCOPES)

    def token() -> str:
        if not cred.valid:
            cred.refresh(Request())
        return str(cred.token)
    return token


class Sheets:
    """values:batchGet / batchUpdate / append, every request at least 60/HUB_TWO_WAY_WRITES_PER_MIN s after the last."""

    def __init__(self, http: Any = None, token: Callable[[], str] | None = None,
                 clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep) -> None:
        if http is None:
            import requests  # noqa: PLC0415
            http = requests.Session()
        self.http, self._token = http, token or _sa_token(SA_FILE)
        self.clock, self.sleep = clock, sleep
        self.spacing = 60.0 / WRITES_PER_MIN
        self.last: float | None = None
        self.reads = self.writes = 0

    def _call(self, method: str, path: str, write: bool, params: dict | None = None, body: dict | None = None) -> dict:
        if self.last is not None:
            gap = self.spacing - (self.clock() - self.last)
            if gap > 0:
                self.sleep(gap)
        self.last = self.clock()
        if write:
            self.writes += 1
        else:
            self.reads += 1
        try:
            r = self.http.request(method, API + path, params=params, json=body, timeout=60,
                                  headers={"Authorization": "Bearer " + self._token()})
        except Exception as exc:  # noqa: BLE001 - a dropped call is reconciled by the next read
            raise GoogleError(0, type(exc).__name__) from exc
        if r.status_code == 200:
            return r.json()
        said = str(getattr(r, "text", "") or "")[:2000]
        if r.status_code == 429 or (r.status_code == 403 and any(q in said for q in QUOTA_REASONS)):
            raise Refused(f"Google refused for quota ({r.status_code})")
        raise GoogleError(r.status_code, said)

    def titles(self, sid: str) -> list[str]:
        got = self._call("GET", f"/{sid}", False, {"fields": "sheets.properties.title"})
        return [s["properties"]["title"] for s in got.get("sheets", [])]

    def sheet_props(self, sid: str) -> dict[str, dict]:
        """Each tab's id and how many rows and columns its grid holds, by title."""
        got = self._call("GET", f"/{sid}", False, {
            "fields": "sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))"})
        return {p["title"]: {"id": p.get("sheetId", 0), "rows": (p.get("gridProperties") or {}).get("rowCount", 0),
                             "cols": (p.get("gridProperties") or {}).get("columnCount", 0)}
                for p in (s.get("properties") or {} for s in got.get("sheets", []))}

    def book_props(self, sid: str) -> tuple[str, dict[str, dict]]:
        """The book's title, and each tab's id and grid size by title, in the sheet's order."""
        got = self._call("GET", f"/{sid}", False, {
            "fields": "properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))"})
        tabs = {p["title"]: {"id": p.get("sheetId", 0), "rows": (p.get("gridProperties") or {}).get("rowCount", 0),
                             "cols": (p.get("gridProperties") or {}).get("columnCount", 0)}
                for p in (s.get("properties") or {} for s in got.get("sheets", []))}
        return str((got.get("properties") or {}).get("title") or ""), tabs

    def structure(self, sid: str, requests: list[dict]) -> None:
        """spreadsheets:batchUpdate: every request applied, or none."""
        self._call("POST", f"/{sid}:batchUpdate", True, None, {"requests": requests})

    def batch_get(self, sid: str, ranges: list[str], render: str = "FORMATTED_VALUE") -> list[list[list]]:
        got = self._call("GET", f"/{sid}/values:batchGet", False,
                         {"ranges": ranges, "valueRenderOption": render, "majorDimension": "ROWS"})
        out = [vr.get("values") or [] for vr in got.get("valueRanges", [])]
        if len(out) != len(ranges):
            raise GoogleError(200, f"asked {len(ranges)} range(s), answered {len(out)}")
        return out

    def batch_update(self, sid: str, data: list[dict]) -> list[str]:
        """Each cell written, then what the sheet shows in it."""
        got = self._call("POST", f"/{sid}/values:batchUpdate", True, None, {
            "valueInputOption": "USER_ENTERED", "includeValuesInResponse": True,
            "responseValueRenderOption": "FORMATTED_VALUE", "data": data})
        res = got.get("responses") or []
        out = []
        for i in range(len(data)):
            vals = ((res[i] if i < len(res) else {}).get("updatedData") or {}).get("values") or [[]]
            out.append(str(vals[0][0]) if vals[0] else "")
        return out

    def append(self, sid: str, rng: str, rows: list[list[str]]) -> list[list[str]]:
        """Rows written after the last one the tab holds (never inserted between), then what the sheet shows in them."""
        got = self._call("POST", f"/{sid}/values/{urllib.parse.quote(rng, safe='')}:append", True, {
            "valueInputOption": "USER_ENTERED", "insertDataOption": "OVERWRITE", "includeValuesInResponse": "true",
            "responseValueRenderOption": "FORMATTED_VALUE"}, {"values": rows, "majorDimension": "ROWS"})
        upd = got.get("updates") or {}
        if not re.search(r"!A\d", str(upd.get("updatedRange") or "")):
            log.warning("%s…: rows appended at %s, not from column A", sid[:8], str(upd.get("updatedRange"))[-24:])
        vals = (upd.get("updatedData") or {}).get("values") or []
        return [[str(c) for c in (vals[i] if i < len(vals) else [])] for i in range(len(rows))]


# ---- Postgres: app.edits read, the sync's own tables written (the writer role); the copy read (read-only role) ------

def ddl() -> tuple[str, ...]:
    c, y = W.beside("edit_conflicts"), W.beside("edit_sync_cycles")
    return W.edits_ddl() + BO.ddl() + RB.ddl() + (
        f"create table if not exists {c} ("
        " id bigserial primary key, sheet_id text not null, tab_name text not null, match_by text not null,"
        " keyed_by text not null, row_key text not null, field text not null, edit_id bigint not null,"
        " base_value text not null default '', pg_value text not null default '', sheet_value text not null default '',"
        " winner text not null check (winner in ('postgres', 'sheet')), why text not null default '',"
        " edit_at timestamptz, sheet_seen_at timestamptz, at timestamptz not null default now(),"
        " reviewed_at timestamptz, reviewed_by text not null default '')",
        f"create index if not exists edit_conflicts_at on {c} (at desc)",
        f"create table if not exists {y} ("
        " id bigserial primary key, started_at timestamptz not null, finished_at timestamptz not null default now(),"
        " mode text not null default 'on', books int not null default 0, tabs int not null default 0,"
        " written int not null default 0, accepted int not null default 0, conflicts int not null default 0,"
        " appended int not null default 0, skipped int not null default 0, reads int not null default 0,"
        " writes int not null default 0, refused boolean not null default false, backoff_until timestamptz,"
        " why text not null default '')",
    )


CELL_KEY = ("sheet_id", "tab_name", "match_by", "keyed_by", "row_key", "field")


def cells_sql(owed: bool = True, book: bool = False, row: bool = False) -> str:
    """The newest edit of each cell (with the oldest edit's `before` — the sheet's value before any edit of it — and
    whether its row was ever appended) and the cell's sync state. `owed`: only the cells Google does not hold yet — no
    state, a newer edit than the one agreed, owed (pending), or a row or column the sheet lacked asked again after
    MISSING_EVERY_S (one param), or a withheld cell edited since; `book`: one book (a param); `row`: one row (its tab,
    match, keyed and key as params)."""
    part = "partition by " + ", ".join(CELL_KEY)
    where = []
    if book or row:
        where.append("sheet_id = %s")
    if row:
        where.append("tab_name = %s and match_by = %s and keyed_by = %s and row_key = %s")
    on = " and ".join(f"s.{k} = x.{k}" for k in CELL_KEY)
    sql = ("select x.id, x.sheet_id, x.tab_name, x.match_by, x.keyed_by, x.row_key, x.field, x.value, x.before,"
           " extract(epoch from x.at), x.kind, x.appended, x.first_before, s.edit_id, s.state, s.base_value,"
           " s.sheet_value, extract(epoch from s.sheet_seen_at), extract(epoch from s.checked_at) from ("
           " select id, sheet_id, tab_name, match_by, keyed_by, row_key, field, value, before, at, kind,"
           f" row_number() over ({part} order by id desc) as rn,"
           " bool_or(kind = 'append') over (partition by sheet_id, tab_name, match_by, keyed_by, row_key) as appended,"
           f" first_value(before) over ({part} order by id) as first_before from {W.EDITS_TABLE}"
           + (" where " + " and ".join(where) if where else "") + f") x left join {W.beside('edit_sync')} s on {on}"
           " where x.rn = 1")
    if owed:
        sql += (" and (s.sheet_id is null or s.state = 'pending'"
                " or s.state in ('synced', 'superseded') and s.edit_id < x.id"
                " or s.state = 'missing' and (x.at > s.checked_at or s.checked_at < now() - make_interval(secs => %s))"
                " or s.state = 'withheld' and x.at > s.checked_at)")
    return sql + " order by x.sheet_id, x.tab_name, x.id"


@dataclass
class Cell:
    sheet_id: str
    tab: str
    match: str
    keyed: str
    row_key: str
    field: str
    edit_id: int
    value: str
    before: str
    at: float
    kind: str
    appended: bool
    first_before: str

    @property
    def key(self) -> tuple:
        return (self.sheet_id, self.tab, self.match, self.keyed, self.row_key, self.field)


class Db:
    def __init__(self, rw: Callable[[], Any] | None = None, ro: Callable[[], Any] | None = None) -> None:
        self._rw, self._ro = rw, ro
        self.rw_conn: Any = None
        self.ro_conn: Any = None

    @staticmethod
    def _open(env: str, name: str) -> Any:
        import psycopg  # noqa: PLC0415
        dsn = os.getenv(env, "").strip() or (hubdb._dsn() if env == "HUB_DB_DSN" else "")
        if not dsn:
            raise RuntimeError(f"{env} is not set")
        c = psycopg.connect(dsn, autocommit=True, connect_timeout=5, application_name=name)
        c.execute("set statement_timeout = '30s'")
        return c

    def rw(self) -> Any:
        if self.rw_conn is None or self.rw_conn.closed:
            self.rw_conn = self._rw() if self._rw else self._open("HUB_DB_WRITE_DSN", "asa-hub-sheet-sync")
        return self.rw_conn

    def ro(self) -> Any:
        if self.ro_conn is None or self.ro_conn.closed:
            self.ro_conn = self._ro() if self._ro else self._open("HUB_DB_DSN", "asa-hub-sheet-sync-ro")
        return self.ro_conn

    def close(self) -> None:
        for c in (self.rw_conn, self.ro_conn):
            try:
                if c is not None and self._rw is None:
                    c.close()
            except Exception:  # noqa: BLE001 - a dead connection closes as it can
                pass
        if self._rw is None:
            self.rw_conn = self.ro_conn = None

    def ensure(self) -> None:
        c = self.rw()
        for stmt in ddl():
            c.execute(stmt)

    def listener(self, held: Any = None) -> Any:
        """A connection of its own that hears a book change queued (book_ops.CHANNEL) or a check asked
        (record_books.CHANNEL), kept across cycles."""
        if held is not None and not held.closed:
            return held
        try:
            c = self._rw() if self._rw else self._open("HUB_DB_WRITE_DSN", "asa-hub-sheet-sync-listen")
            c.execute(f"listen {BO.CHANNEL}")
            c.execute(f"listen {RB.CHANNEL}")
            return c
        except Exception as exc:  # noqa: BLE001 - no listener, the ops wait for the next cycle
            log.warning("the book changes are not listened for (%s)", type(exc).__name__)
            return None

    @staticmethod
    def _cells(rows: list[tuple]) -> list[tuple[Cell, dict | None]]:
        out = []
        for r in rows:
            c = Cell(r[1], r[2], r[3], r[4], r[5], r[6], int(r[0]), r[7] or "", r[8] or "", float(r[9] or 0), r[10],
                     bool(r[11]), r[12] or "")
            st = None if r[14] is None else {"edit_id": int(r[13] or 0), "state": r[14], "base": r[15] or "",
                                             "sheet_value": r[16] or "", "seen_at": float(r[17] or 0),
                                             "checked_at": float(r[18] or 0)}
            out.append((c, st))
        return out

    def owed(self) -> list[tuple[Cell, dict | None]]:
        """Every cell owed to Google, with its state."""
        return self._cells(self.rw().execute(cells_sql(), (MISSING_EVERY_S,)).fetchall())

    def book_cells(self, sid: str) -> list[tuple[Cell, dict | None]]:
        """Every kept cell of one book, owed or not, with its state."""
        return self._cells(self.rw().execute(cells_sql(owed=False, book=True), (sid,)).fetchall())

    def row_cells(self, c: Cell) -> list[Cell]:
        """Every kept cell of one row the record lays (a cell the sheet superseded is the copy's)."""
        return [x for x, st in self._cells(self.rw().execute(
            cells_sql(owed=False, row=True), (c.sheet_id, c.tab, c.match, c.keyed, c.row_key)).fetchall())
            if st is None or not (st["state"] == "superseded" and x.edit_id <= st["edit_id"])]

    def book_name(self, sid: str) -> str | None:
        """The book's name as the copy holds it; None when the copy holds no such book."""
        got = self.ro().execute("select name from catalog.books where sheet_id = %s", (sid,)).fetchone()
        return str(got[0] or "") if got else None

    def book_modified(self, sid: str) -> float | None:
        """The book's modifiedTime the copy is of; None for a record book, whose catalog time stopped moving when its
        check took the copy over (db/sync.py RECORD_BOOK), or when the catalog holds none."""
        got = self.ro().execute("select status, extract(epoch from greatest(modified_time, direct_modified))"
                                " from catalog.books where sheet_id = %s", (sid,)).fetchone()
        return None if not got or got[0] == RB.RECORD_STATUS or got[1] is None else float(got[1])

    def copied_tabs(self, sid: str) -> list[str]:
        """The tabs of a book its copy holds now."""
        return [r[0] for r in self.ro().execute(
            "select tab_name from catalog.tabs where sheet_id = %s and gone_at is null", (sid,)).fetchall()]

    def held_books(self) -> set[str]:
        """The record books whose copy is the daily check's."""
        return {r[0] for r in self.rw().execute(f"select sheet_id from {RB.books_table()} where held_since is not null")}

    # -- a check's read, staged for asa-hub-db-sync --
    def pull_open(self, sid: str, name: str, partial: bool) -> int:
        return int(self.rw().execute(f"insert into {RB.pulls_table()} (sheet_id, name, read_at, partial)"
                                     " values (%s, %s, now(), %s) returning id", (sid, name, partial)).fetchone()[0])

    def pull_rows(self, pid: int, tab: str, rows: list[tuple[int, dict]]) -> None:
        c = self.rw()
        with c.transaction():
            c.cursor().executemany(f"insert into {RB.pull_rows_table()} (pull_id, tab_name, row_number, data)"
                                   " values (%s, %s, %s, %s::jsonb)",
                                   [(pid, tab, rn, json.dumps(d, ensure_ascii=False)) for rn, d in rows])

    def pull_staged(self, pid: int, tabs: list[dict], compact: list[tuple[tuple, int]]) -> None:
        """The read whole: its tabs and the kept edits it makes redundant; told to asa-hub-db-sync once it commits."""
        c = self.rw()
        with c.transaction():
            cur = c.cursor()
            if compact:
                best: dict[tuple, int] = {}
                for key, upto in compact:
                    best[key] = max(best.get(key, 0), int(upto))
                cur.executemany(
                    f"insert into {RB.compactions_table()} (pull_id, {', '.join(CELL_KEY)}, upto_id)"
                    " values (%s, %s, %s, %s, %s, %s, %s, %s) on conflict do nothing",
                    [(pid, *key, upto) for key, upto in best.items()])
            cur.execute(f"update {RB.pulls_table()} set tabs = %s::jsonb, state = 'staged' where id = %s",
                        (json.dumps(tabs), pid))
            cur.execute(f"notify {RB.STAGED}")

    def pull_failed(self, pid: int, why: str) -> None:
        try:
            c = self.rw()
            with c.transaction():
                c.execute(f"delete from {RB.pull_rows_table()} where pull_id = %s", (pid,))
                c.execute(f"update {RB.pulls_table()} set state = 'failed', why = %s where id = %s", (why[:400], pid))
        except Exception as exc:  # noqa: BLE001 - a pull left reading is never stored
            log.warning("pull %s was not marked failed (%s)", pid, type(exc).__name__)

    def copy(self, sid: str, tab: str) -> tuple[tuple, list[tuple[int, dict, float]]] | None:
        """The copy of a tab in asa-hub-db: its headers and (row, cells, when the keeper ingested it)."""
        got = self.ro().execute("select table_name, columns from catalog.tabs where sheet_id = %s and tab_name = %s"
                                " and gone_at is null", (sid, tab)).fetchone()
        if not got or not re.fullmatch(r"[a-z0-9_]{1,63}", got[0] or ""):
            return None
        cols = got[1] if isinstance(got[1], list) else json.loads(got[1] or "[]")
        rows = self.ro().execute(f'select row_number, _raw, extract(epoch from _ingested_at) from sheets."{got[0]}"'
                                 " order by row_number").fetchall()  # noqa: S608
        return (tuple(str(h) for h, _c in cols),
                [(int(rn), raw if isinstance(raw, dict) else json.loads(raw or "{}"), float(at or 0))
                 for rn, raw, at in rows])

    def save(self, states: list[dict], conflicts: list[dict], touched: list[tuple[str, str]] | None = None) -> None:
        """Every state and conflict decided for a tab, in one transaction (each state's cell checked now)."""
        c = self.rw()
        with c.transaction():
            cur = c.cursor()
            if states:
                # synced_at moves only when the agreed value or the state does
                cur.executemany(
                    f"insert into {W.beside('edit_sync')} as t (sheet_id, tab_name, match_by, keyed_by, row_key, field,"
                    " edit_id, state, base_value, sheet_value, sheet_seen_at, checked_at, synced_at, why)"
                    " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, to_timestamp(%s), now(),"
                    " case when %s then now() end, %s)"
                    " on conflict (sheet_id, tab_name, match_by, keyed_by, row_key, field) do update set"
                    " edit_id = excluded.edit_id, state = excluded.state, base_value = excluded.base_value,"
                    " sheet_value = excluded.sheet_value, sheet_seen_at = excluded.sheet_seen_at, checked_at = now(),"
                    " synced_at = case when t.base_value is distinct from excluded.base_value"
                    " or t.state is distinct from excluded.state then coalesce(excluded.synced_at, t.synced_at)"
                    " else t.synced_at end, why = excluded.why",
                    [(*s["key"], s["edit_id"], s["state"], s["base"], s["sheet_value"], s["seen_at"] or None,
                      s["state"] in ("synced", "superseded"), s.get("why", "")[:400]) for s in states])
            if conflicts:
                cur.executemany(
                    f"insert into {W.beside('edit_conflicts')} (sheet_id, tab_name, match_by, keyed_by, row_key, field,"
                    " edit_id, base_value, pg_value, sheet_value, winner, why, edit_at, sheet_seen_at)"
                    " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, to_timestamp(%s), to_timestamp(%s))",
                    [(*k["key"], k["edit_id"], k["base"], k["pg"], k["sheet"], k["winner"], k["why"][:400],
                      k["edit_at"] or None, k["seen_at"] or None) for k in conflicts])

    def cycle(self, started: float, st: "Stats", backoff_until: float) -> None:
        c = self.rw()
        y = W.beside("edit_sync_cycles")
        c.execute(f"insert into {y} (started_at, mode, books, tabs, written, accepted, conflicts, appended, skipped,"
                  " reads, writes, refused, backoff_until, why) values (to_timestamp(%s), %s, %s, %s, %s, %s, %s, %s,"
                  " %s, %s, %s, %s, to_timestamp(%s), %s)",
                  (started, st.mode, st.books, st.tabs, st.written, st.accepted, st.conflicts, st.appended, st.skipped,
                   st.reads, st.writes, st.refused, backoff_until or None, st.why[:400]))
        c.execute(f"delete from {y} where started_at < now() - make_interval(days => %s)", (KEEP_DAYS,))


# ---- the merge ------------------------------------------------------------------------------------------------

@dataclass
class Stats:
    mode: str = "on"
    books: int = 0
    tabs: int = 0
    written: int = 0
    accepted: int = 0
    conflicts: int = 0
    appended: int = 0
    skipped: int = 0
    reads: int = 0
    writes: int = 0
    refused: bool = False
    why: str = ""
    ops: int = 0
    owed: int = 0
    checks: int = 0
    compacted: int = 0
    # of the conflicts, the ones the sheet won
    sheet_won: int = 0

    def line(self) -> str:
        return (f"{self.books} book(s), {self.tabs} tab(s) of {self.owed} owed cell(s): written {self.written}, "
                f"accepted from the sheet {self.accepted}, conflicts {self.conflicts} (won by Postgres "
                f"{self.conflicts - self.sheet_won}, by the sheet {self.sheet_won}), appended {self.appended}, "
                f"skipped {self.skipped}, book changes {self.ops}, checks {self.checks}, compacted {self.compacted}; "
                f"requests {self.reads} read + {self.writes} write"
                + (" — REFUSED, backing off" if self.refused else "") + (f" ({self.why})" if self.why else ""))


@dataclass
class Live:
    """A tab read once: its header row, keys, rows (sheet row, cells), the columns each row withholds, its last row."""
    header_row: int
    keys: list[str]
    rows: list[tuple[int, dict]]
    withheld: dict[int, set]
    extent: int


def live_tab(matrix: list[list]) -> Live:
    hi, header = header_of(matrix)
    keys = twin_keys(header)
    rows: list[tuple[int, dict]] = []
    held: dict[int, set] = {}
    for rn, line in enumerate(matrix[hi + 1:], start=hi + 2):
        data = parse_row(line, keys)
        if data is None:
            continue
        rows.append((rn, data))
        held[rn] = set(R.withheld_columns(data)) | set(R.secret_named_columns(data)) if R is not None else set()
    return Live(hi + 1, keys, rows, held, len(matrix))


@dataclass
class Plan:
    """A tab's decisions: cells to write, rows to append, states and conflicts to keep (some only once written)."""
    updates: list[dict] = field(default_factory=list)
    appends: list[dict] = field(default_factory=list)
    states: list[dict] = field(default_factory=list)
    conflicts: list[dict] = field(default_factory=list)
    accepted: int = 0
    skipped: int = 0


def _state(c: Cell, state: str, base: str, sheet: str, seen: float, edit_id: int, why: str = "") -> dict:
    return {"key": c.key, "state": state, "base": base, "sheet_value": sheet, "seen_at": seen, "edit_id": edit_id,
            "why": why}


def _conflict(c: Cell, base: str, sheet: str, winner: str, why: str, seen: float) -> dict:
    return {"key": c.key, "edit_id": c.edit_id, "base": base, "pg": c.value, "sheet": sheet, "winner": winner,
            "why": why, "edit_at": c.at, "seen_at": seen}


class TabMerge:
    """One tab of the backup: each owed row found by its key on the live sheet, each cell decided — what only Postgres
    changed is written, what only the sheet changed is the sheet's, what both changed goes to the newer side."""

    def __init__(self, sid: str, tab: str, live: Live | None, cells: list[Cell], states: dict[tuple, dict],
                 copy: Callable[[], Any], now: float, row_cells: Callable[[Cell], list[Cell]] | None = None,
                 modified: Callable[[], float | None] | None = None) -> None:
        self.sid, self.tab, self.live, self.cells, self.states, self.now = sid, tab, live, cells, states, now
        self._copy, self._copied = copy, None
        self._row_cells = row_cells
        self._modified_of, self._modified_at, self._modified_read = modified, None, False
        # the book changes that take rows off this tab (book_ops.removing): a row one of them took is never put back
        self.removing: list[tuple[str, dict]] = []
        self._copy_index: dict[str, dict[str, list[int]]] = {}
        self.plan = Plan()
        self.ref = hubdb.TabRef(sid, tab, "", tuple(k for k in live.keys if k) if live else (), None,
                                len(live.rows) if live else 0)
        self.own = CW.Own([])

    def _rows_by(self, match: str, rows: list[tuple[int, dict]], ref: hubdb.TabRef) -> dict[str, list[int]]:
        of = self.own._keyer(ref, match)
        out: dict[str, list[int]] = {}
        for i, (rn, raw) in enumerate(rows):
            k = of(rn, raw)
            if k:
                out.setdefault(k, []).append(i)
        return out

    def _column(self, f: str, keyed: str) -> int | None:
        h = self.own._header(self.ref, f, keyed)
        return self.live.keys.index(h) if h is not None and h in self.live.keys else None

    def _copy_held(self, c: Cell) -> tuple[dict, float] | None:
        """The row as the copy holds it now, found by the same key, and when its source read it from Google; None
        when the copy names none or several."""
        if self._copied is None:
            try:
                self._copied = self._copy() or ((), [])
            except Exception as exc:  # noqa: BLE001 - no copy, the edits alone carry the row
                log.warning("%s… / %s: the copy was not read (%s)", self.sid[:8], self.tab[:40], type(exc).__name__)
                self._copied = ((), [])
        heads, rows = self._copied
        if not heads:
            return None
        ref = self.ref._replace(headers=heads, row_count=len(rows))
        if c.match not in self._copy_index:
            self._copy_index[c.match] = self._rows_by(c.match, [(rn, raw) for rn, raw, _i in rows], ref)
        at = self._copy_index[c.match].get(c.row_key) or []
        return (dict(rows[at[0]][1]), float(rows[at[0]][2] or 0)) if len(at) == 1 else None

    def _copy_row(self, c: Cell) -> dict | None:
        got = self._copy_held(c)
        return got[0] if got else None

    def _copy_cell(self, c: Cell) -> tuple[str, float] | None:
        """The cell as the copy holds it, and when that was read; None when the copy holds no such cell, or when the
        tab is past COPY_BOUND_MAX_ROWS (the whole copy would sit in memory beside the sheet's read: Python's own
        reads and the book's time bound the race instead)."""
        if self.ref.row_count > COPY_BOUND_MAX_ROWS:
            return None
        got = self._copy_held(c)
        if got is None or not got[1]:
            return None
        h = self.own._header(self.ref._replace(headers=self._copied[0]), c.field, c.keyed)
        v = got[0].get(h) if h is not None else None
        return None if v is None or marker(v) else (str(v), got[1])

    def _modified(self) -> float | None:
        if not self._modified_read:
            self._modified_read = True
            try:
                self._modified_at = self._modified_of() if self._modified_of else None
            except Exception as exc:  # noqa: BLE001 - not known: an open race stays Postgres'
                log.warning("%s…: the book's modified time was not read (%s)", self.sid[:8], type(exc).__name__)
        return self._modified_at

    def _seen(self, c: Cell, s: str) -> float:
        """When Python first saw the sheet hold this value: the state's time while it saw the same, else now."""
        st = self.states.get(c.key)
        return st["seen_at"] if st and same(st["sheet_value"], s, c.keyed) and st["seen_at"] else self.now

    def newer(self, c: Cell, s: str, b: str, seen: float) -> tuple[str, str]:
        """A cell both sides changed: the newer side ('postgres' or 'sheet') and why. Google keeps no time per cell, so
        the sheet's change is bounded. It came after a moment the sheet still held another value (the copy's read
        holding the agreed value; Python's own last read of it), and by a moment it held this one (the copy's read,
        capped by the book's modifiedTime that copy is of; Python's first sight of it). An open race goes by the book's
        modifiedTime. A tie is Postgres'."""
        at, st = c.at, self.states.get(c.key)
        held = self._copy_cell(c)
        book = self._modified()
        edit = f"the edit at {_when(at)}"
        if held is not None and held[1] > at and same(held[0], b, c.keyed) and not same(held[0], s, c.keyed):
            return "sheet", (f"{WHY_SHEET_NEWER}: its copy read at {_when(held[1])} still held the agreed value,"
                             f" after {edit}")
        if st is not None and st["seen_at"] and not same(st["sheet_value"], s, c.keyed):
            # a value read and kept (synced, pending) was there at the state's last check, any other at its first sight
            read = st["checked_at"] if st["state"] in ("synced", "pending") else st["seen_at"]
            if read > at:
                return "sheet", f"{WHY_SHEET_NEWER}: Python read another value there at {_when(read)}, after {edit}"
        if held is not None and same(held[0], s, c.keyed):
            by = min(held[1], book) if book else held[1]
            if by <= at:
                return "postgres", (f"{WHY_PG_NEWER}: the copy read at {_when(held[1])} already held the sheet's value"
                                    + (f" (the book modified at {_when(book)})" if book else "") + f", by {edit}")
        if seen <= at:
            return "postgres", f"{WHY_PG_NEWER}: Python saw the sheet's value at {_when(seen)}, by {edit}"
        if book is None:
            return "postgres", f"{WHY_AMBIGUOUS}: the book's modified time is not known here, {edit}; Postgres kept"
        if book > at:
            return "sheet", f"{WHY_AMBIGUOUS}: the book modified at {_when(book)}, after {edit}"
        return "postgres", f"{WHY_AMBIGUOUS}: the book modified at {_when(book)}, by {edit}"

    def removed(self, held: dict | None, cells: list[Cell]) -> bool:
        """A book change of Postgres' own took this row off the tab (as the copy holds it, the kept cells laid)."""
        if not self.removing:
            return False
        row = dict(held or {})
        row.update({c.field: c.value for c in cells})
        return any(BO.removes(op, spec, row) for op, spec in self.removing)

    def changed(self, c: Cell) -> bool:
        """Postgres changed the cell since Google last agreed with it."""
        st = self.states.get(c.key)
        b = st["base"] if st else c.first_before
        return (st is None or c.edit_id > st["edit_id"]) and not same(c.value, b, c.keyed)

    def run(self) -> Plan:
        groups: dict[tuple, list[Cell]] = {}
        for c in self.cells:
            groups.setdefault((c.match, c.keyed, c.row_key), []).append(c)
        index: dict[str, dict[str, list[int]]] = {}
        for (match, _keyed, key), cells in groups.items():
            if self.live is None:
                self._gone_or_missing(cells, "the sheet has no tab of that name", can_append=False)
                continue
            if match not in index:
                index[match] = self._rows_by(match, self.live.rows, self.ref)
            at = index[match].get(key) or []
            if len(at) > 1:
                for c in cells:
                    self._keep(c, "missing", f"the key names {len(at)} rows on the sheet")
                continue
            if not at:
                self._gone_or_missing(cells, "the row is not on the sheet", can_append=True)
                continue
            rn, raw = self.live.rows[at[0]]
            for c in cells:
                self._cell(c, rn, raw, self.live.withheld.get(rn, set()))
        return self.plan

    def _settled(self, c: Cell) -> bool:
        """The sheet already superseded this cell's newest edit: it stays superseded until a newer edit comes."""
        st = self.states.get(c.key)
        return st is not None and st["state"] == "superseded" and c.edit_id <= st["edit_id"]

    def _keep(self, c: Cell, state: str, why: str) -> None:
        """Nothing done to the cell this cycle: its base and reconciled edit stay as they were."""
        st = self.states.get(c.key)
        self.plan.states.append(_state(c, "superseded" if self._settled(c) else state,
                                       st["base"] if st else c.first_before, st["sheet_value"] if st else "",
                                       st["seen_at"] if st else 0.0, st["edit_id"] if st else 0, why))
        self.plan.skipped += 1

    def _gone_or_missing(self, cells: list[Cell], why: str, can_append: bool) -> None:
        # a row an edit (never an append) names stood in the copy when it was kept
        was_there = not any(c.appended for c in cells) or any(
            (self.states.get(c.key) or {}).get("state") in ("synced", "superseded") for c in cells)
        if was_there:
            owed = [c for c in cells if not self._settled(c) and self.changed(c)]
            if not owed or not can_append:
                # nothing Postgres still owes the row: whether it stays gone is the daily check's to say
                for c in cells:
                    self._keep(c, "missing", WHY_GONE if can_append else why)
                return
            self._again(cells, owed)
            return
        if not can_append or not any(c.appended for c in cells):
            for c in cells:
                self._keep(c, "missing", why)
            return
        self._line(cells, {})

    def _line(self, cells: list[Cell], held: dict, owed: list[Cell] | None = None) -> None:
        """A new row on the sheet: what the copy held of it (`held`, by the copy's header) under the kept cells."""
        line = [""] * len(self.live.keys)
        for col, k in enumerate(self.live.keys):
            v = held.get(k)
            if k and v is not None and not marker(v):
                line[col] = entered(v)
        placed: list[tuple[Cell, int]] = []
        for c in cells:
            col = self._column(c.field, c.keyed)
            if col is None:
                self._keep(c, "missing", "the sheet has no column " + c.field[:80])
            elif marker(c.value):
                self._keep(c, "withheld", "a withheld value is never written")
            else:
                line[col] = entered(c.value)
                placed.append((c, col))
        if placed:
            prior = {c.key: (self.states[c.key]["base"], self.states[c.key]["edit_id"]) if c.key in self.states
                     else (c.first_before, 0) for c, _col in placed}
            self.plan.appends.append({"line": line, "cells": placed, "owed": owed or [], "prior": prior})

    def _again(self, cells: list[Cell], owed: list[Cell]) -> None:
        """A row that left the sheet while Postgres owed it a change: written again whole, from the record — what the
        copy holds of it, every kept cell of it over that — the conflict logged."""
        held = self._copy_row(cells[0])
        if held is None and not any(c.appended for c in cells):
            # the copy no longer holds the row either: its kept cells alone are no row to write
            for c in cells:
                self._keep(c, "missing", "the row left the sheet and the copy; it is not written again in part")
            return
        if self.removed(held, cells):
            for c in cells:
                self._keep(c, "missing", WHY_REMOVED)
            return
        row = self._row_cells(cells[0]) if self._row_cells is not None else cells
        self._line(row or cells, held or {}, owed)

    def _cell(self, c: Cell, rn: int, raw: dict, withheld: set) -> None:
        col = self._column(c.field, c.keyed)
        if col is None:
            self._keep(c, "missing", "the sheet has no column " + c.field[:80])
            return
        key = self.live.keys[col]
        if key in withheld or key not in raw:
            self._keep(c, "withheld", "a withheld column is never compared or written")
            return
        s = raw.get(key, "")
        st = self.states.get(c.key)
        b = st["base"] if st else c.first_before
        if marker(s) or marker(c.value) or marker(b):
            self._keep(c, "withheld", "a withheld value is never compared or written")
            return
        seen = self._seen(c, s)
        if same(s, c.value, c.keyed):
            self.plan.states.append(_state(c, "superseded" if self._settled(c) else "synced", s, s, seen,
                                           max(c.edit_id, st["edit_id"] if st else 0)))
            return
        if self._settled(c):
            self._keep(c, "superseded", "")
            return
        if self.changed(c):
            if same(s, b, c.keyed):
                self._write(c, rn, col, s, seen, b, None)
                return
            # both changed it: the newer side wins
            winner, why = self.newer(c, s, b, seen)
            if winner == "sheet":
                self._accept(c, s, seen, (b, why))
            else:
                self._write(c, rn, col, s, seen, b, why)
            return
        # Postgres did not change it since Google agreed: the sheet's value stands
        self._accept(c, s, seen)

    def _accept(self, c: Cell, s: str, seen: float, conflict: tuple[str, str] | None = None) -> None:
        """The sheet's value is the truth again: kept as the base, the edit no longer laid over the copy."""
        why = conflict[1] if conflict else "the sheet changed after the last sync"
        if conflict:
            self.plan.conflicts.append(_conflict(c, conflict[0], s, "sheet", why, seen))
        self.plan.states.append(_state(c, "superseded", s, s, seen, c.edit_id, why))
        self.plan.accepted += 1

    def _write(self, c: Cell, rn: int, col: int, s: str, seen: float, b: str, conflict: str | None) -> None:
        st = self.states.get(c.key)
        self.plan.updates.append({"cell": c, "rn": rn, "col": col, "value": entered(c.value), "sheet": s, "seen": seen,
                                  "base": b, "conflict": conflict, "prior_id": st["edit_id"] if st else 0})


# ---- the cycle ------------------------------------------------------------------------------------------------

class Syncer:
    def __init__(self, db: Db, sheets: Sheets, clock: Callable[[], float] = time.time, dry: bool = False,
                 hub: hubdb.HubDb | None = None) -> None:
        self.db, self.sheets, self.clock, self.dry = db, sheets, clock, dry
        # the depot's pointers the check asks (the books no copy holds, the owned books), over the read connection
        self.hub = hub
        self.backoff_until = 0.0
        self.backoff_s = BACKOFF_MIN_S
        self._r0 = self._w0 = 0

    def refused(self, e: Exception, st: "Stats") -> None:
        """A quota refusal: the round stops, and the next waits, a little longer at each refusal in a row."""
        st.refused, st.why = True, str(e)
        self.backoff_until = self.clock() + self.backoff_s
        self.backoff_s = min(self.backoff_s * 2, BACKOFF_S)

    def reads_left(self) -> int:
        return READS_PER_CYCLE - (self.sheets.reads - self._r0)

    def writes_left(self) -> int:
        return WRITES_PER_MIN - (self.sheets.writes - self._w0)

    def _read_book(self, sid: str, tabs: list[str]) -> dict[str, list[list] | None]:
        """Every edited tab of a book in one read; a tab the book lacks costs one more read (its tab list)."""
        try:
            got = self.sheets.batch_get(sid, [quote(t) for t in tabs])
            return dict(zip(tabs, got))
        except GoogleError as e:
            if e.status != 400 or "Unable to parse range" not in e.said or self.reads_left() < 2:
                raise
        titles = set(self.sheets.titles(sid))
        held = [t for t in tabs if t in titles]
        got = self.sheets.batch_get(sid, [quote(t) for t in held]) if held else []
        out: dict[str, list[list] | None] = {t: None for t in tabs}
        out.update(zip(held, got))
        return out

    def cycle(self) -> Stats:
        started = self.clock()
        st = Stats(mode="dry-run" if self.dry else "on")
        self._r0, self._w0 = self.sheets.reads, self.sheets.writes
        if R is None:
            st.why = "server/redaction.py is not mounted; nothing is compared without it"
            return self._finish(started, st)
        rw = self.db.rw()
        if not self.dry:
            try:
                RB.enroll(rw)
            except Exception as exc:  # noqa: BLE001 - the books already enrolled stand
                log.warning("the record books were not enrolled (%s: %s)", type(exc).__name__, str(exc)[:160])
        try:
            st.ops = self.ops()
        except Refused as e:
            self.refused(e, st)
            return self._finish(started, st)
        books: dict[str, dict[str, list[Cell]]] = {}
        states: dict[tuple, dict] = {}
        owed: dict[str, tuple[int, float]] = {}
        for c, s in self.db.owed():
            books.setdefault(c.sheet_id, {}).setdefault(c.tab, []).append(c)
            if s is not None:
                states[c.key] = s
            n, since = owed.get(c.sheet_id, (0, c.at))
            owed[c.sheet_id] = (n + 1, min(since, c.at))
        st.owed = sum(n for n, _s in owed.values())
        if not self.dry:
            RB.owed_now(rw, owed)
        # oldest owed first, a book waiting out a refusal or an error left for its time
        order = [s for s in RB.backups_due(rw) if s in books] if not self.dry else sorted(books)
        for i, sid in enumerate(order):
            if self.reads_left() < 1:
                st.skipped += sum(len(books[s][t]) for s in order[i:] for t in books[s])
                st.why = st.why or "the read budget ran out; the rest waits for the next round"
                break
            try:
                done, left = self._book(sid, books[sid], states, st)
                if not self.dry:
                    RB.backup_said(rw, sid, True, done, left=left)
            except Refused as e:
                self.refused(e, st)
                if not self.dry:
                    RB.backup_said(rw, sid, False, str(e), self.backoff_until)
                break
            except GoogleError as e:
                st.skipped += sum(len(v) for v in books[sid].values())
                log.warning("book %s…: %s %s", sid[:8], e, e.said[:160].replace("\n", " "))
                if not self.dry:
                    RB.backup_said(rw, sid, False, f"{e}: {e.said[:200]}", self.clock() + BOOK_RETRY_S)
        if not st.refused and not self.dry:
            self.checks(st)
        if not self.dry:
            try:
                st.compacted = RB.compact(rw)["edits"]
            except Exception as exc:  # noqa: BLE001 - compacted next round
                log.warning("the kept edits were not compacted (%s: %s)", type(exc).__name__, str(exc)[:160])
        if not st.refused and self.sheets.reads + self.sheets.writes > self._r0 + self._w0:
            self.backoff_s = BACKOFF_MIN_S
        return self._finish(started, st)

    def checks(self, st: "Stats", partial_only: bool = False) -> None:
        """The checks due: every one asked for some tabs, then CHECKS_PER_ROUND whole books."""
        import sheet_check as SCK  # noqa: PLC0415 - it builds on this module
        rw = self.db.rw()
        due = RB.checks_due(rw)
        picked = [d for d in due if d[1]] + ([] if partial_only else [d for d in due if not d[1]][:CHECKS_PER_ROUND])
        check = SCK.Check(self.db, self.sheets, self.hub, self.clock)
        for sid, tabs in picked:
            try:
                got = check.book(sid, tabs)
                st.checks += 1 if got.get("ok") else 0
            except Refused as e:
                self.refused(e, st)
                return
            except GoogleError as e:
                log.warning("check %s…: %s %s", sid[:8], e, e.said[:160].replace("\n", " "))
            except Exception as exc:  # noqa: BLE001 - this book is tried again later; the others go on
                log.warning("check %s… failed (%s: %s)", sid[:8], type(exc).__name__, str(exc)[:200])
                try:
                    RB.check_said(rw, sid, False, f"the check failed ({type(exc).__name__})",
                                  retry_at=self.clock() + SCK.RETRY_S)
                except Exception:  # noqa: BLE001 - said in the log
                    pass

    def ops(self) -> int:
        """The book changes queued (book_ops), carried before the cells; Refused is raised. A change carried into a
        record book asks a check of its tab at once, so the copy holds it."""
        done: list[dict] = []
        try:
            return BO.run(self.db.rw(), self.sheets, quote, col_letter, entered, Refused, GoogleError, dry=self.dry,
                          done_ops=done, ro=self.db.ro)
        finally:
            if done and not self.dry:
                held = self.db.held_books()
                for op in done:
                    if op["sheet_id"] not in held:
                        continue
                    to = (op.get("spec") or {}).get("to") if op["op"] == "move" else None
                    RB.ask_check(self.db.rw(), op["sheet_id"], [op["tab"]] + ([str(to)] if to else []))

    def _finish(self, started: float, st: Stats) -> Stats:
        st.reads, st.writes = self.sheets.reads - self._r0, self.sheets.writes - self._w0
        if not self.dry:
            try:
                self.db.cycle(started, st, self.backoff_until if st.refused else 0.0)
            except Exception as exc:  # noqa: BLE001 - the log line still says it
                log.warning("the cycle row was not kept (%s)", type(exc).__name__)
        log.info("two-way sync (%s): %s", st.mode, st.line())
        return st

    def _book(self, sid: str, tabs: dict[str, list[Cell]], states: dict[tuple, dict], st: Stats) -> tuple[str, int]:
        """One book's owed cells carried: one read of its owed tabs, then per tab one write of its cells and one
        append of its new rows; what was done, in words, and how many cells it still owes."""
        before = (st.written, st.appended, st.accepted, st.skipped)
        matrices = self._read_book(sid, list(tabs))
        st.books += 1
        for tab, cells in tabs.items():
            st.tabs += 1
            m = matrices.get(tab)
            live = live_tab(m) if m is not None else None
            merge = TabMerge(sid, tab, live, cells, states, lambda t=tab: self.db.copy(sid, t), self.clock(),
                             self.db.row_cells, lambda: self.db.book_modified(sid))
            merge.removing = BO.removing(self.db.rw(), sid, tab)
            plan = merge.run()
            if plan.conflicts and not self.dry:
                self._bring_in(sid, tab)
            self._apply(sid, tab, live, plan, st)
        w, a, acc, sk = (x - y for x, y in zip((st.written, st.appended, st.accepted, st.skipped), before))
        return f"{w} cell(s) written, {a} row(s) appended, {acc} left to the sheet, {sk} not carried this round", sk

    def _bring_in(self, sid: str, tab: str) -> None:
        """The sheet won a cell both changed: a record book's tab is checked at once, so its copy, which every read
        shows under the edits still laid, holds the sheet's value."""
        try:
            if sid in self.db.held_books():
                RB.ask_check(self.db.rw(), sid, [tab])
        except Exception as exc:  # noqa: BLE001 - the daily check brings it in
            log.warning("%s… / %s: no check asked (%s)", sid[:8], tab[:40], type(exc).__name__)

    def _apply(self, sid: str, tab: str, live: Live | None, plan: Plan, st: Stats) -> None:
        states, conflicts = list(plan.states), list(plan.conflicts)
        st.accepted += plan.accepted
        st.skipped += plan.skipped
        st.conflicts += len(plan.conflicts)
        # the plan's own conflicts are the cells the sheet won (_accept); Postgres' are logged once written
        st.sheet_won += len(plan.conflicts)
        refused: Refused | None = None
        if plan.updates:
            # two edits naming one cell: the newer is written
            best: dict[tuple[int, int], dict] = {}
            for u in plan.updates:
                k = (u["rn"], u["col"])
                if k not in best or u["cell"].edit_id > best[k]["cell"].edit_id:
                    best[k] = u
            ups = list(best.values())
            data = [{"range": f"{quote(tab)}!{col_letter(u['col'] + 1)}{u['rn']}", "values": [[u["value"]]]}
                    for u in ups]
            shown: list[str] | None = None
            if self.dry:
                shown = [u["value"].lstrip("'") for u in ups]
            elif self.writes_left() >= 1:
                try:
                    shown = self.sheets.batch_update(sid, data)
                except Refused as e:
                    refused = e
                except GoogleError as e:
                    log.warning("%s / %s: the cells were not written (%s)", sid[:8], tab[:40], e)
            for i, u in enumerate(ups):
                c = u["cell"]
                if shown is None:
                    states.append(_state(c, "pending", u["base"], u["sheet"], u["seen"], u["prior_id"],
                                         "owed to the sheet; written next cycle"))
                    st.skipped += 1
                    continue
                states.append(_state(c, "synced", shown[i], shown[i], self.clock(), c.edit_id))
                st.written += 1
                if u["conflict"]:
                    conflicts.append(_conflict(c, u["base"], u["sheet"], "postgres", u["conflict"], u["seen"]))
                    st.conflicts += 1
        if plan.appends and live is not None and refused is None:
            rows = [a["line"] for a in plan.appends]
            got: list[list[str]] | None = None
            if self.dry:
                got = [[v.lstrip("'") for v in r] for r in rows]
            elif self.writes_left() >= 1:
                try:
                    at = max(live.extent, live.header_row) + 1
                    got = self.sheets.append(sid, f"{quote(tab)}!A{at}:{col_letter(len(live.keys))}{at}", rows)
                except Refused as e:
                    refused = e
                except GoogleError as e:
                    log.warning("%s / %s: the rows were not appended (%s)", sid[:8], tab[:40], e)
            for i, a in enumerate(plan.appends):
                for c, col in a["cells"]:
                    if got is None:
                        base, prior = a["prior"][c.key]
                        states.append(_state(c, "pending", base, "", 0.0, prior, WHY_OWED_ROW))
                        st.skipped += 1
                        continue
                    v = got[i][col] if col < len(got[i]) else ""
                    states.append(_state(c, "synced", v, v, self.clock(), c.edit_id))
                if got is not None:
                    st.appended += 1
                    for c in a["owed"]:
                        conflicts.append(_conflict(c, a["prior"].get(c.key, (c.first_before, 0))[0], "", "postgres",
                                                   WHY_GONE_OWED, self.clock()))
                        st.conflicts += 1
        elif plan.appends:
            for a in plan.appends:
                for c, _col in a["cells"]:
                    base, prior = a["prior"][c.key]
                    states.append(_state(c, "pending", base, "", 0.0, prior, WHY_OWED_ROW))
                    st.skipped += 1
        if not self.dry:
            self.db.save(states, conflicts)
        if refused is not None:
            raise refused


def heartbeat(st: Stats, backoff_until: float) -> None:
    try:
        HEARTBEAT.write_text(json.dumps({"at": time.time(), "refused": st.refused, "backoff_until": backoff_until,
                                         "line": st.line()}))
    except OSError:
        pass


def status(db: Db | None = None) -> dict[str, Any]:
    """The last round, every record book's backup and check, and the conflicts still unreviewed, for Settings › Hub
    containers or a docker exec."""
    db = db or Db()
    c = db.rw()
    y, k = W.beside("edit_sync_cycles"), W.beside("edit_conflicts")
    last = c.execute("select started_at, finished_at, mode, books, tabs, written, accepted, conflicts, appended,"
                     " skipped, reads, writes, refused, backoff_until, why"
                     f" from {y} order by id desc limit 1").fetchone()
    states = dict(c.execute(f"select state, count(*) from {W.beside('edit_sync')} group by 1").fetchall())
    open_conflicts = c.execute(f"select count(*) from {k} where reviewed_at is null").fetchone()[0]
    names = ("started_at", "finished_at", "mode", "books", "tabs", "written", "accepted", "conflicts", "appended",
             "skipped", "reads", "writes", "refused", "backoff_until", "why")
    pulls = dict(c.execute(f"select state, count(*) from {RB.pulls_table()} group by 1").fetchall())
    return {"last_cycle": {n: (v.isoformat() if isinstance(v, datetime) else v) for n, v in zip(names, last)}
            if last else None, "cells": states, "conflicts_unreviewed": int(open_conflicts),
            "books": RB.status(c), "pulls": pulls, "every_s": EVERY_S, "writes_per_min": WRITES_PER_MIN,
            "reads_per_cycle": READS_PER_CYCLE}


_STOP = {"now": False}


def _stop(_signum: int, _frame: Any) -> None:
    _STOP["now"] = True


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if "--status" in argv:
        print(json.dumps(status(), default=str))
        return 0
    if "--check" in argv:
        # a check asked now: `--check SHEET_ID [TAB …]`, the running service hears it
        rest = argv[argv.index("--check") + 1:]
        if not rest:
            print("--check SHEET_ID [TAB …]")
            return 2
        db = Db()
        RB.ask_check(db.rw(), rest[0], rest[1:] or None)
        print(json.dumps({"asked": rest[0], "tabs": rest[1:] or "the whole book"}))
        return 0
    dry = MODE == "dry-run" or "--dry-run" in argv
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    if MODE == "off" and "--dry-run" not in argv:
        log.info("two-way sync is off (HUB_TWO_WAY_MODE=off)")
        while not _STOP["now"]:
            heartbeat(Stats(mode="off", why="HUB_TWO_WAY_MODE=off"), 0.0)
            time.sleep(60)
        return 0
    db = Db()
    syncer = Syncer(db, Sheets(), dry=dry, hub=hubdb.HubDb(connect=db.ro))
    ear = None
    while not _STOP["now"]:
        began = time.time()
        if began < syncer.backoff_until:
            heartbeat(Stats(refused=True, why="backing off after a refusal"), syncer.backoff_until)
            time.sleep(min(30.0, syncer.backoff_until - began))
            continue
        try:
            db.ensure()
            st = syncer.cycle()
            heartbeat(st, syncer.backoff_until)
        except Exception as exc:  # noqa: BLE001 - one bad cycle never ends the service
            log.warning("the cycle failed (%s: %s)", type(exc).__name__, str(exc)[:200])
            heartbeat(Stats(why=type(exc).__name__), syncer.backoff_until)
        finally:
            db.close()
        if "--once" in argv:
            return 0
        while not _STOP["now"] and time.time() - began < EVERY_S:
            ear = db.listener(ear) if not dry else None
            if ear is None:
                time.sleep(min(5.0, EVERY_S - (time.time() - began)))
            elif BO.wait(ear, min(5.0, EVERY_S - (time.time() - began))) and time.time() >= syncer.backoff_until:
                # a book change queued, or a check asked, meanwhile: carried at once, the cells at the round's time
                carry_ops(db, syncer)
    return 0


def carry_ops(db: Db, syncer: Syncer) -> None:
    st = Stats()
    try:
        n = syncer.ops()
        if n:
            log.info("book changes carried between rounds: %s", n)
        if time.time() >= syncer.backoff_until:
            syncer.checks(st, partial_only=True)
    except Refused as e:
        syncer.refused(e, st)
        log.warning("book changes refused (%s); backing off", e)
    except Exception as exc:  # noqa: BLE001 - what is left waits for the round
        log.warning("book changes not carried (%s: %s)", type(exc).__name__, str(exc)[:200])
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
