"""asa-hub-db as Apps Script reads the sheets: the tab router, the depot's pointers and switches, and each reader's cells."""
from __future__ import annotations

import contextlib
import contextvars
import json
import os
import re
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Callable, Iterator, NamedTuple

import gsjs
from gsjs import NY, SheetDate

ESSENCIAL_ID = os.getenv("HUB_ESSENCIAL_SHEET_ID", "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug")
FACTS_TAB = "Facts"
# the depot's Facts once kept in a table of their own (db/depot_facts_table.sql): read there by facts(), tab(), rows()
# and from_sql(); its mark (the upload, the newest change) read again at most every FACTS_MARK_TTL_S
FACTS_RESOURCE, FACTS_TABLE = "depotFacts", "app.depot_facts"
FACTS_MARK_TTL_S = 2.0
_FACTS_MARK: dict[str, Any] = {"at": 0.0, "mark": None}


def facts_touched() -> None:
    """A write laid on the depot's Facts table: their mark read again on the next look."""
    _FACTS_MARK["at"] = 0.0
HOUSE_DATA_TAB = "Data"
# a house kept in its own table: house_tables.KeptRef names its table so
KEPT_TABLE = "kept:"
# every tab kept in Postgres (app.resource_columns, uploaded) is read from its table by whoever names its book and tab
# (HubDb.tab); a caller that must read the copy itself (an upload and its proof) says so here
COPY: contextvars.ContextVar[bool] = contextvars.ContextVar("hubdb_copy", default=False)
KEPT_MAP_TTL_S = 5.0
KEPT_REF_TTL_S = 2.0
_KEPT_MAP: dict[str, Any] = {"at": 0.0, "map": {}}
CATALOG_TTL_S = float(os.getenv("HUB_APP_CATALOG_TTL_S", "10"))
# Drive stamps an edit's modifiedTime a little after the edit, so a listing vouches for a minute before it
LISTING_MARGIN_S = 60.0
# the mirror's share when the keeper's listing time is unknown: its 180 s listing period, its longest pass, Drive's margin
KEEPER_LAG_S = float(os.getenv("HUB_APP_KEEPER_LAG_S", "540"))
# asa-hub-db's share: a pass starts HUB_DB_SYNC_EVERY_S (60) after the last and runs its worst measured length
CLONE_LAG_S = float(os.getenv("HUB_APP_CLONE_LAG_S", "120"))
# a book the clone never checked: both shares
LAG_S = float(os.getenv("HUB_APP_LAG_S") or KEEPER_LAG_S + CLONE_LAG_S)
ROWS_HELD = int(os.getenv("HUB_APP_ROWS_HELD", "96"))
# the tabs that decide who reads what: the accounts, App Control, the clients and their plans (the hidden apps are the
# depot's config, in the Essencial's Facts)
PEOPLE_TABS = ("users", "app_badge_access", "app_tenant_access", "clients", "isps")
# catalog.books.status of a book Postgres keeps the record of (app/record_books.py): its copy and the kept edits are the
# record, never behind Google, so no read of it waits on Google
RECORD_STATUS = "record"

# the pointers Props.gs holds and the depot does not; HUB_APP_PROP_<KEY> overrides any of them
PROP_FALLBACKS = {
    "HUB_CARE_BOOK_ID": "1oTtiGLOB9gEDqK_pOHHlHlzfJkY3HCnxokFpqBZ4Kog",
    # MyLife OS — Client Entities, the house registry's book (locations.ENTITIES_FALLBACK)
    "HUB_CLIENT_ENTITIES_SHEET_ID": "1yIc3f9S9ZRlAJ3drUinFmm0gTflO-GUx0BVaFVYVopI",
    "HUB_DB_ID": "1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts",
    # the Employee HR Tracker (StaffIssues.gs reads and appends its Master tab)
    "ESTATE_HR_ID": "1yTOPeLof_eY66SHQ-acUXZlzOlE7wF-3Z841_iKFqq0",
    # the division's task lists (one tab a person), kept in Postgres and edited in the Division Tasks app
    "DIVISION_TASKS_ID": "1sLcDZMMXP__uqWl7ABYq559vq5tM6gz_EVMxlCew8is",
    # the Upload Documents form's responses (kept in Postgres, followed hourly)
    "UPLOAD_DOCS_ID": "1u0QFpouXCRyINC_2j9WoR9UmmDNq2qfdoSXCzqtrtx4",
    # the Missing Medications book (client_meds, client_rename), kept in Postgres and followed hourly
    "HUB_MISSING_MEDS_SHEET_ID": "19Umc82evptvKj7GLG2RNdr6VhKDnX0Mp6C1paX6Gw1w",
    # the In-Person Screening Notes form's responses (kept in Postgres, swept by app/essential_sheets.py)
    "SCREENING_NOTES_ID": "16sW3lPz28OW-MGL6D-u8LxMVs9QgFuuNPVmQrm_uuYw",
    # the Voice Bot's employee support structure (kept in Postgres, swept by app/essential_sheets.py)
    "VOICE_BOT_ID": "191zBO7kqw5Yq2pG3uSH0cJRqtQ2Ucl_JdpFEgrIRgoI",
    # the last books people touched in Google (sheet_resources.SWEPT_BOOKS), kept in Postgres and swept
    "ABD_CRISIS_TRAINING_ID": "1ttbmePAMqvZ_mlR14yR8aC5Ikfk_6Xi-RRw_Z8iSr5A",
    "RSVP_FORM_ID": "13HG5K2Mi_CE463V-MUjn3v3ST5ZfMLT6C8wNEmyBYIw",
    "DAILY_SCHEDULE_ID": "1lPi24N3mTsQagwujGkueINcwvI4wOKVwszHHGd-bj0Q",
    "HUB_COMMON_DATA_SHEET_ID": "1-XgGNQMkHAlGQjqvhg3Ao89pO-8DJoqjIr9ggjAXprE",
    "TALENT_APP_DATA_ID": "1gkpJ4BrvLu4K6QS-qoFXyEuOLUZnOef-WEjd2HUovww",
    "MYLIFE_OS_REGISTRY_ID": "1zarOrNJl0GtpTD3MPg5JkmE_uSSQ2vbA76ePImlv49c",
    # the company's credentials list ("Address and Email Updates"): its accounts kept in Postgres for the master's
    # Credentials app, the usernames and passwords never read (the copy withholds them)
    "CREDENTIALS_BOOK_ID": "1w4jEKZyn6JqxFyJ7k7m9tcntptWQp-ufNIRz0VvHEUQ",
    # the books living-brain wrote until 10-27 (their history kept in Postgres by tools/upload-copied-books.py; never
    # read from Google again: sheet_resources.LIVING_BRAIN_BOOKS)
    "COMM_REHEARSAL_BOOK_ID": "172eYxmzY0aDGJpC7hwi9zmk_3m0lXIzqIf4MyJo8eMc",
    "COMM_MOCK_BOOK_ID": "1M9_nxXEgAIr-21UsQdjpkEJB6nXrtTFJGdpPtaNo9vQ",
    "PSI_PUNCHES_FULL_BOOK_ID": "1ttZRJPyLFkSJ0ANKXoD9twt8NDn-ZeFRYDQpuVqUbmw",
}

# SheetDb.gs HUB_TAB_HOME: headquarters' tabs that live in a book of their own
HUB_TAB_HOME = {
    "shopper_items": "HUB_APPS_BOOK_ID", "shopper_prices": "HUB_APPS_BOOK_ID", "meal_profile": "HUB_APPS_BOOK_ID",
    "meal_log": "HUB_APPS_BOOK_ID", "learn_skills": "HUB_APPS_BOOK_ID", "learn_attempts": "HUB_APPS_BOOK_ID",
    "travel_trips": "HUB_APPS_BOOK_ID", "mail": "HUB_APPS_BOOK_ID", "helpful_contacts": "HUB_APPS_BOOK_ID",
    "audits": "HUB_APPS_BOOK_ID", "equipment": "HUB_APPS_BOOK_ID", "expenseReports": "HUB_APPS_BOOK_ID",
    "fleetVehicles": "HUB_APPS_BOOK_ID", "inventoryItems": "HUB_APPS_BOOK_ID", "leads": "HUB_APPS_BOOK_ID",
    "mileageLogs": "HUB_APPS_BOOK_ID", "routes": "HUB_APPS_BOOK_ID", "truelink_runs": "HUB_APPS_BOOK_ID",
    "sheet_tasks": "HUB_APPS_BOOK_ID", "week_items": "HUB_APPS_BOOK_ID", "team_tasks": "HUB_APPS_BOOK_ID",
    "team_projects": "HUB_APPS_BOOK_ID", "project_work_items": "HUB_APPS_BOOK_ID", "reminders": "HUB_APPS_BOOK_ID",
    "policyAcks": "HUB_APPS_BOOK_ID", "finance_config": "HUB_APPS_BOOK_ID", "finance_balances": "HUB_APPS_BOOK_ID",
    "notifications": "HUB_APPS_BOOK_ID", "staff_notes": "HUB_APPS_BOOK_ID", "staff_profile_visits": "HUB_APPS_BOOK_ID",
    # Python's own: a missing documentation record marked concluded (Staff › Performance)
    "staff_doc_marks": "HUB_APPS_BOOK_ID",
    "ssa_notes": "HUB_APPS_BOOK_ID", "family_notes": "HUB_APPS_BOOK_ID",
    # Directors.gs directorsSheet_: the Directory's one tab
    "directors": "HUB_DIRECTORY_ID",
    "mealPlans": "HUB_CARE_BOOK_ID", "shiftTimeline": "HUB_CARE_BOOK_ID", "visits": "HUB_CARE_BOOK_ID",
    "med_catalog": "HUB_CARE_BOOK_ID", "client_notes": "HUB_CARE_BOOK_ID", "mar_errors": "HUB_CARE_BOOK_ID",
    "missing_medications": "HUB_CARE_BOOK_ID", "client_files": "HUB_CARE_BOOK_ID", "med_deliveries": "HUB_CARE_BOOK_ID",
    "care_docs": "HUB_CARE_BOOK_ID", "billing_claims": "HUB_CARE_BOOK_ID", "ist_records": "HUB_CARE_BOOK_ID",
    "house_notes": "HUB_CARE_BOOK_ID", "isp_sections": "HUB_CARE_BOOK_ID", "incident_reviews": "HUB_CARE_BOOK_ID",
    "client_overrides": "HUB_CARE_BOOK_ID",
    # Prefs.gs prefsSheet_: the preferences workbook's one tab
    "user_prefs": "HUB_PREFS_ID",
    # the comms mirror's own tabs (ssOpen_(hubId_('HUB_COMMS_ID')))
    "ignored_calls": "HUB_COMMS_ID", "summaries": "HUB_COMMS_ID", "transcripts": "HUB_COMMS_ID",
}

# HiringMatrix.gs HIRING_DISSOLVABLE_TABS: tabs the depot's facts may hold instead of a sheet
HIRING_DISSOLVABLE = frozenset({
    "entity_candidates", "entity_resume_analyses", "entity_phone_screens", "entity_in_person_interviews",
    "entity_onboardings", "entity_hiring_events", "entity_resume_inbox", "hiring_journey", "hiring_sim_asks",
    "hiring_sim_ai", "hiring_sim_config", "hiring_policy", "hiring_alerts_config", "interview_asks",
    "interview_ask_ai", "onboarding_packet", "recruitment_config", "recruitment_contracts", "recruitment_docs",
    "candidate_documents", "candidates", "tp_candidates", "tp_resume", "tp_screens"})

# the books each request read, for how old its answer may be
READ_BOOKS: contextvars.ContextVar[set | None] = contextvars.ContextVar("read_books", default=None)
# the writes Python accepted that the copy may not hold yet, laid over each tab a request reads (writes.Own)
OWN: contextvars.ContextVar[Any] = contextvars.ContextVar("own_writes", default=None)


class Unreadable(RuntimeError):
    """A source Apps Script would read is not in asa-hub-db, or the database did not answer."""


class TabRef(NamedTuple):
    sheet_id: str
    tab: str
    table: str
    headers: tuple
    loaded_at: Any
    row_count: int


class Book(NamedTuple):
    sheet_id: str
    name: str
    modified_time: Any
    synced_at: Any
    status: str
    # when the clone's copy last equalled the mirror, and the keeper's Drive listing that copy holds
    checked_at: Any = None
    listed_at: Any = None


class Resolved(NamedTuple):
    """Where Apps Script's hubTabSheet_ would open a tab: its book, the names it tries, and the tab when it holds rows."""
    sheet_id: str
    names: tuple
    ref: TabRef | None
    declared_house: bool
    book_known: bool
    runtime: bool = False


def _dsn() -> str:
    dsn = os.getenv("HUB_DB_DSN", "").strip()
    if dsn:
        return dsn
    parts = {"host": os.getenv("HUB_DB_HOST", "asa-hub-db"), "port": os.getenv("HUB_DB_PORT", "5432"),
             "dbname": os.getenv("POSTGRES_DB", "asa_hub"), "user": os.getenv("POSTGRES_USER", "asa_hub"),
             "password": os.getenv("POSTGRES_PASSWORD", "")}
    return " ".join(f"{k}={v}" for k, v in parts.items() if v)


def _epoch(v: Any) -> float:
    if v is None:
        return 0.0
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).timestamp()
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


# ---- the cells -------------------------------------------------------------

_US_DT = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4}|\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?)?$")
# the mirror writes a linked cell as "text [url]"; getValues() hands back the text alone
_LINKED = re.compile(r"^(.*?) ?\[(https?://[^\]\s]+)\]$", re.S)
_ISO_D = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_ISO_DT = re.compile(r"^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$")
_TIME = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?$")
_INT = re.compile(r"^-?(?:0|[1-9]\d{0,14})$")
_DEC = re.compile(r"^-?(?:0|[1-9]\d{0,14})\.\d*[1-9]$")
_MONEY = re.compile(r"^-?\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?$|^-?\$\d+(?:\.\d+)?$|^-?\d+\.\d*0$")


class SheetTime:
    """A time-only cell (Sheets' 30 Dec 1899): the clock it shows."""
    __slots__ = ("h", "m", "s")

    def __init__(self, h: int, m: int, s: int) -> None:
        self.h, self.m, self.s = h, m, s


def _clock(h: int, half: str) -> int:
    return h % 12 + (12 if half.upper() == "PM" else 0) if half else h


def _date(y: int, mo: int, d: int, hh: int = 0, mi: int = 0, ss: int = 0) -> SheetDate | None:
    try:
        return SheetDate(datetime(y, mo, d, hh, mi, ss, tzinfo=NY))
    except ValueError:
        return None


def typed(v: Any, policy: str) -> Any:
    """The value getValues() would have handed back for the text the mirror kept (one policy per kind of book)."""
    if v is None:
        return ""
    if isinstance(v, (bool, int, float)):
        return v
    if not isinstance(v, str):
        return json.dumps(v)
    linked = _LINKED.match(v)
    if linked:
        v = linked.group(1)
    if policy == "raw" or not v:
        return v
    s = v.strip()
    if s in ("TRUE", "FALSE"):
        return s == "TRUE"
    m = _US_DT.match(s)
    if m:
        hh = _clock(int(m.group(4) or 0), m.group(7) or "")
        y = int(m.group(3))
        if len(m.group(3)) == 2:
            y += 2000 if y < 70 else 1900
        got = _date(y, int(m.group(1)), int(m.group(2)), hh, int(m.group(5) or 0), int(m.group(6) or 0))
        return got if got is not None else v
    m = _ISO_DT.match(s)
    if m:
        got = _date(int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)),
                    int(m.group(6) or 0))
        return got if got is not None else v
    if _INT.match(s):
        return int(s)
    if _DEC.match(s):
        return float(s)
    if policy != "estate":
        return v
    m = _ISO_D.match(s)
    if m:
        got = _date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        return got if got is not None else v
    m = _TIME.match(s)
    if m:
        h = _clock(int(m.group(1)), m.group(4) or "")
        if h < 24 and int(m.group(2)) < 60:
            return SheetTime(h, int(m.group(2)), int(m.group(3) or 0))
    if _MONEY.match(s):
        try:
            return float(s.replace("$", "").replace(",", ""))
        except ValueError:
            return v
    return v


def estate_cell(v: Any) -> str:
    """estateCell_: a time-only cell as HH:mm, a Date as ISO, anything else String()."""
    if isinstance(v, SheetTime):
        return f"{v.h:02d}:{v.m:02d}"
    if isinstance(v, SheetDate):
        local = v.at.astimezone(NY)
        return f"{local.hour:02d}:{local.minute:02d}" if local.year < 1900 else gsjs.iso(v.at)
    return gsjs.or_blank(v)


def cell_text(v: Any) -> Any:
    """deserialize_ / cellText_ (SheetDb.gs): a Date as the text it means; JSON-looking text parsed."""
    v = _shown(v)
    if isinstance(v, SheetDate):
        at = v.at
        if at.year < 1900:
            return f"{at.hour % 12 or 12}:{at.minute:02d}:{at.second:02d} {'PM' if at.hour >= 12 else 'AM'}"
        if at.hour == 0 and at.minute == 0 and at.second == 0 and at.microsecond == 0:
            return at.strftime("%Y-%m-%d")
        return gsjs.iso(at)
    if isinstance(v, str):
        t = v.strip()
        if len(t) > 1 and t[0] in "{[":
            try:
                return json.loads(t)
            except ValueError:
                return v
    return v


def estate_key(header: Any) -> str:
    """estateKey_: '(…)' dropped, lower case, every other run one underscore."""
    s = re.sub(r"\([^)]*\)", " ", str(header or "")).lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def norm_key(header: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(header).lower())


def normalize(headers: Any, rows: Any) -> list[dict]:
    """readTabNormalized_ on HUB_DB of (row number, cells) rows: headers normKey_'d, Dates as cellText_, a row of
    blanks left out."""
    keys = [norm_key(h) for h in headers]
    out = []
    for _rn, raw in rows:
        vals = [typed(raw.get(h), "hub") for h in headers]
        if all(v == "" or v is None for v in vals):
            continue
        o: dict[str, Any] = {}
        for k, v in zip(keys, vals):
            if not k:
                continue
            o[k] = cell_text(v) if isinstance(v, (SheetDate, SheetTime)) else v
        out.append(o)
    return out


# server/hub_sheet_sync.py twin_keys: an owned book's repeated header, each column before the last as "<name> ⟨n⟩"
TWIN_KEY = re.compile(r"(.*) ⟨([0-9]+)⟩", re.S)


def twin_base(h: str) -> str:
    m = TWIN_KEY.fullmatch(h)
    return m.group(1) if m else h


def in_sheet_order(headers: list[str]) -> bool:
    """Whether the copy's headers are an owned tab's, in the sheet's order: a repeated name's columns are all…"""
    at = {h: i for i, h in enumerate(headers)}
    seen = False
    for i, h in enumerate(headers):
        m = TWIN_KEY.fullmatch(h)
        if not m:
            continue
        seen = True
        after = at.get(f"{m.group(1)} ⟨{int(m.group(2)) + 1}⟩", at.get(m.group(1)))
        if after is None or after < i:
            return False
    return seen


# ---- the database ------------------------------------------------------------

# asa-hub-db has 100 connection slots and every thread keeps a connection of its own: threads gone quiet held half of
# them, and the next burst of new threads was refused. The server closes a connection the Hub opens once it sits idle
# IDLE_CLOSE_S; a thread lets go of its own a while sooner, so it never reuses one the server already closed.
IDLE_CLOSE_S = 120
IDLE_LET_GO_S = 90.0
# a burst of requests is a burst of threads, each with a writer and a reader: the reads (query, dict_rows) share a few
# connections instead, each lent for one statement, so a burst holds READERS_LENT readers at most (conn() still keeps a
# thread's own, for a cursor held across statements)
READERS_LENT = max(2, int(os.getenv("HUB_DB_READERS", "16")))
READER_WAIT_S = 8.0


def _close(c: Any) -> None:
    try:
        c.close()
    except Exception:  # noqa: BLE001 - a dead connection closes as it can
        pass


def gone_quiet(c: Any, used: float) -> bool:
    """A connection with no transaction open, unused past IDLE_LET_GO_S: the thread opens another. It is let go, never
    closed here — a cursor still reading it keeps it until done."""
    try:
        idle = int(c.info.transaction_status) == 0  # psycopg's TransactionStatus.IDLE
    except Exception:  # noqa: BLE001 - a connection that cannot say stays as it is
        return False
    return idle and time.monotonic() - used > IDLE_LET_GO_S


class HubDb:
    """One reader of asa-hub-db: the catalog every few seconds, a tab's rows once per load."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        self.dsn = dsn or _dsn()
        self._connect = connect
        self._local = threading.local()
        self._lock = threading.Lock()
        self._cat: dict[str, Any] = {"at": 0.0, "tabs": {}, "books": {}}
        self._rows: OrderedDict[tuple, tuple] = OrderedDict()
        self._facts: dict[str, Any] = {"loaded": None}
        self._kept_refs: dict[str, tuple[float, Any]] = {}
        self._idle: list[tuple[Any, float]] = []
        self._idle_lock = threading.Lock()
        self._lendable = threading.BoundedSemaphore(READERS_LENT)

    # -- plumbing --
    def _open(self) -> Any:
        import psycopg  # noqa: PLC0415 - the unit checks run without the driver
        c = psycopg.connect(self.dsn, autocommit=True, connect_timeout=5, application_name="asa-hub-app")
        c.execute("set session characteristics as transaction read only")
        c.execute("set statement_timeout = '8s'")
        c.execute(f"set idle_session_timeout = '{IDLE_CLOSE_S}s'")
        return c

    def conn(self) -> Any:
        """The thread's own connection: for a cursor held across statements (a named cursor in a transaction)."""
        c = getattr(self._local, "conn", None)
        if c is not None and not c.closed and not getattr(c, "broken", False):
            if self._connect is not None or not gone_quiet(c, getattr(self._local, "used", 0.0)):
                self._local.used = time.monotonic()
                return c
        c = self._connect() if self._connect is not None else self._open()
        self._local.conn = c
        self._local.used = time.monotonic()
        return c

    @contextlib.contextmanager
    def _lent(self) -> Iterator[Any]:
        """A connection for one statement: one of the shared few (READERS_LENT), or the thread's own under a connect of
        its own (a check's, the sandbox's, the sheet sync's). One that failed is closed, never lent again."""
        if self._connect is not None:
            yield self.conn()
            return
        if not self._lendable.acquire(timeout=READER_WAIT_S):
            raise Unreadable("asa-hub-db did not answer (every reader busy)")
        c, stale = None, []
        try:
            with self._idle_lock:
                while self._idle and c is None:
                    held, used = self._idle.pop()
                    if held.closed or getattr(held, "broken", False) or gone_quiet(held, used):
                        stale.append(held)
                    else:
                        c = held
            for s in stale:
                _close(s)
            if c is None:
                c = self._open()
            yield c
        except BaseException:
            if c is not None:
                _close(c)
                c = None
            raise
        finally:
            if c is not None:
                with self._idle_lock:
                    self._idle.append((c, time.monotonic()))
            self._lendable.release()

    def query(self, sql_text: str, params: Any = None) -> list[tuple]:
        try:
            with self._lent() as c:
                return list(c.execute(sql_text, params).fetchall())
        except Unreadable:
            raise
        except Exception as exc:  # noqa: BLE001 - the database not answering is said, never an empty answer
            if self._connect is not None:
                self._drop()
            raise Unreadable(f"asa-hub-db did not answer ({type(exc).__name__})") from exc

    def dict_rows(self, sql_text: str, params: Any = None) -> list[dict[str, Any]]:
        """query(), each row as {column: value}."""
        try:
            with self._lent() as c:
                cur = c.execute(sql_text, params)
                names = [d[0] for d in cur.description or ()]
                return [dict(zip(names, r)) for r in cur.fetchall()]
        except Unreadable:
            raise
        except Exception as exc:  # noqa: BLE001 - the database not answering is said, never an empty answer
            if self._connect is not None:
                self._drop()
            raise Unreadable(f"asa-hub-db did not answer ({type(exc).__name__})") from exc

    def _drop(self) -> None:
        held, self._local.conn = getattr(self._local, "conn", None), None
        try:
            if held is not None:
                held.close()
        except Exception:  # noqa: BLE001 - a dead connection closes as it can
            pass

    def note_book(self, sheet_id: str) -> None:
        held = READ_BOOKS.get()
        if held is not None and sheet_id:
            held.add(sheet_id)

    # -- the catalog --
    def catalog(self) -> dict[str, Any]:
        now = time.time()
        if now - self._cat["at"] < CATALOG_TTL_S:
            return self._cat
        tabs: dict[tuple, TabRef] = {}
        for sid, tab, table, cols, rows, loaded, gone in self.query(
                "select sheet_id, tab_name, table_name, columns, row_count, loaded_at, gone_at from catalog.tabs"):
            if gone is not None:
                continue
            cols = cols if isinstance(cols, list) else json.loads(cols or "[]")
            tabs[(sid, tab)] = TabRef(sid, tab, table, tuple(str(h) for h, _c in cols), loaded, int(rows or 0))
        books: dict[str, Book] = {}
        # the stamps are read through the row so a catalog the sync has not widened yet still answers
        for sid, name, modified, synced, status, gone, checked, listed in self.query(
                "select sheet_id, name, modified_time, synced_at, status, gone_at,"
                " to_jsonb(b) ->> 'checked_at', to_jsonb(b) ->> 'listed_at' from catalog.books b"):
            if gone is None:
                books[sid] = Book(sid, name or "", modified, synced, status or "", checked, listed)
        with self._lock:
            self._cat = {"at": now, "tabs": tabs, "books": books}
        return self._cat

    def kept_of(self, sheet_id: str, tab: str) -> str | None:
        """The house a book's tab is kept as in Postgres (app.resource_columns, uploaded), read every KEPT_MAP_TTL_S;
        None for a tab whose copy is still the record, a table of its own (resource_rows.OWN_TABLES) or the Facts."""
        now = time.time()
        if now - float(_KEPT_MAP["at"]) >= KEPT_MAP_TTL_S:
            import resource_rows as RR  # noqa: PLC0415 - it imports this module
            try:
                got = self.query("select sheet_id, tab_name, resource from app.resource_columns"
                                 " where uploaded_at is not null and sheet_id <> '' order by resource")
            except Unreadable:
                got = None
            if got is not None:
                held: dict[tuple[str, str], str] = {}
                for sid, name, resource in got:
                    if resource not in RR.OWN_TABLES and resource != FACTS_RESOURCE:
                        held.setdefault((str(sid), str(name)), str(resource))
                _KEPT_MAP.update(at=now, map=held)
        return _KEPT_MAP["map"].get((sheet_id, tab))

    def _kept_ref(self, sheet_id: str, tab: str, resource: str) -> Any:
        """A kept tab's house_tables.KeptRef, naming its book, held KEPT_REF_TTL_S (its mark moves with every write)."""
        now = time.monotonic()
        held = self._kept_refs.get(resource)
        if held is not None and now - held[0] < KEPT_REF_TTL_S and held[1].sheet_id == sheet_id:
            return held[1]
        import house_tables as HT  # noqa: PLC0415 - it imports this module
        import locations as L  # noqa: PLC0415
        ref = HT.KeptRef(L.Reads(self, None), tab, resource)
        ref.sheet_id = sheet_id
        self._kept_refs[resource] = (now, ref)
        return ref

    def tab(self, sheet_id: str, tab: str) -> TabRef | None:
        if not COPY.get():
            kept = self.kept_of(sheet_id, tab)
            if kept is not None:
                # a tab kept in Postgres is read from its table by every reader that names its book and tab: the copy
                # is frozen since the keeper left the ERP (10-27)
                return self._kept_ref(sheet_id, tab, kept)
        ref = self.catalog()["tabs"].get((sheet_id, tab))
        if ref is not None and self.facts_kept(ref):
            # the depot's Facts kept in their table: its newest change is their load, so every cache keyed on it
            # follows a write
            return ref._replace(loaded_at=self.facts_mark())
        # a column only Python's kept edits have written is read as the tab's own, after the sheet's
        widen = getattr(OWN.get(), "widen", None)
        return widen(ref) if ref is not None and widen is not None else ref

    # -- the depot's Facts, once kept in a table of their own --
    def facts_mark(self) -> Any:
        """The Facts table's mark — its upload, its newest change and how many it has had (each write moves it, whatever
        its clock) — None while the copy is the record."""
        now = time.time()
        if now - float(_FACTS_MARK["at"]) < FACTS_MARK_TTL_S:
            return _FACTS_MARK["mark"]
        got = self.query("select c.uploaded_at, s.newest, s.n from app.resource_columns c, (select max(id) as newest,"
                         " count(*) as n from app.resource_changes where resource = %s) s"
                         " where c.resource = %s and c.uploaded_at is not null", (FACTS_RESOURCE, FACTS_RESOURCE))
        mark = "kept|" + "|".join(str(x) for x in got[0]) if got else None
        _FACTS_MARK.update(at=now, mark=mark)
        return mark

    def facts_kept(self, ref: Any) -> bool:
        """Whether a tab is the depot's Facts kept in their table."""
        return ref.sheet_id == ESSENCIAL_ID and ref.tab == FACTS_TAB and self.facts_mark() is not None

    def from_sql(self, ref: Any) -> str:
        """The FROM of a statement over a tab's copy (its table in schema sheets); the depot's Facts, once kept in a table
        of their own, that table shaped as the copy's: row_number its position, each header its column, _raw its cells,
        _ingested_at when the row was made."""
        if self.facts_kept(ref):
            cols = self.query("select columns from catalog.tabs where table_name = %s and gone_at is null",
                              (ref.table,))
            pairs = cols[0][0] if cols else []
            pairs = pairs if isinstance(pairs, list) else json.loads(pairs or "[]")
            heads = ", ".join("t.cells->>'" + str(h).replace("'", "''") + "' as \"" + str(c) + '"'
                              for h, c in pairs if re.fullmatch(r"[a-z0-9_]{1,63}", str(c)))
            return (f"(select t.position as row_number, {heads}{', ' if heads else ''}t.cells as _raw,"
                    f" t.created_at as _ingested_at from {FACTS_TABLE} t where t.resource = '{FACTS_RESOURCE}'"
                    " and t.removed_at is null)")
        if str(getattr(ref, "table", "")).startswith(KEPT_TABLE):
            # a tab kept in Postgres: its table shaped as the copy's, each header under the column the copy named it
            import resource_rows as RR  # noqa: PLC0415 - it imports this module
            resource = str(ref.resource)
            cols = self.query("select columns from catalog.tabs where sheet_id = %s and tab_name = %s"
                              " order by gone_at nulls first limit 1", (ref.sheet_id, ref.tab)) if ref.sheet_id else []
            pairs = cols[0][0] if cols else []
            pairs = pairs if isinstance(pairs, list) else json.loads(pairs or "[]")
            heads = ", ".join("t.cells->>'" + str(h).replace("'", "''") + "' as \"" + str(c) + '"'
                              for h, c in pairs if re.fullmatch(r"[a-z0-9_]{1,63}", str(c)))
            return (f"(select t.position as row_number, {heads}{', ' if heads else ''}t.cells as _raw,"
                    f" t.created_at as _ingested_at from {RR.rows_of(resource)} t"
                    f" where t.resource = '{resource.replace(chr(39), chr(39) * 2)}' and t.removed_at is null)")
        if not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table or ""):
            raise Unreadable(f"the catalog names an unusable table for {ref.tab}")
        return f'sheets."{ref.table}"'

    def book(self, sheet_id: str) -> Book | None:
        return self.catalog()["books"].get(sheet_id)

    def rows(self, ref: TabRef) -> list[tuple[int, dict]]:
        """(sheet row, {header: text}) in sheet order, as the mirror kept them, with this request's own writes laid; a
        house kept in its own table (house_tables.KeptRef) its table's rows, the record itself."""
        if getattr(ref, "resource", "") == FACTS_RESOURCE:
            # the depot's Facts as a house reader holds them: the rows held per mark below
            facts = self.tab(ESSENCIAL_ID, FACTS_TAB)
            if facts is not None and self.facts_kept(facts):
                return self.rows(facts)
        if str(getattr(ref, "table", "")).startswith(KEPT_TABLE):
            import house_tables as HT  # noqa: PLC0415 - it imports this module
            import locations as L  # noqa: PLC0415
            # held per mark, as a copy's rows are per load: every write moves the mark — but inside a write two
            # changes in one transaction share its clock, so a write reads them afresh
            import writes as W  # noqa: PLC0415 - it imports this module
            if W.HELD.get() is not None:
                return HT.raw(L.Reads(self, None), ref.tab, ref.resource)[1]
            key = (ref.table, str(getattr(ref, "loaded_at", "")), int(getattr(ref, "row_count", 0) or 0))
            with self._lock:
                held = self._rows.get(key)
                if held is not None:
                    self._rows.move_to_end(key)
                    return list(held)
            got = HT.raw(L.Reads(self, None), ref.tab, ref.resource)[1]
            with self._lock:
                self._rows[key] = tuple(got)
                while len(self._rows) > ROWS_HELD:
                    self._rows.popitem(last=False)
            return got
        if self.facts_kept(ref):
            # the depot's Facts kept in their table: its rows, held per mark as a copy's are per load
            key = (FACTS_TABLE, ref.loaded_at)
            with self._lock:
                held = self._rows.get(key)
            if held is None:
                held = (ref.loaded_at, [(int(p or 0), c if isinstance(c, dict) else json.loads(c or "{}"))
                                        for p, c in self.query(
                                            f"select position, cells from {FACTS_TABLE} where resource = %s"  # noqa: S608
                                            " and removed_at is null order by position, created_at, row_key",
                                            (FACTS_RESOURCE,))])
                with self._lock:
                    self._rows[key] = held
                    while len(self._rows) > ROWS_HELD:
                        self._rows.popitem(last=False)
            return held[1]
        # a tab Python's own write makes (row_count -1) has no copy yet
        got = [] if ref.row_count < 0 else self._copy_rows(ref)
        own = OWN.get()
        return own.merge(ref, got) if own is not None else got

    def _copy_rows(self, ref: TabRef) -> list[tuple[int, dict]]:
        self.note_book(ref.sheet_id)
        key = (ref.table,)
        with self._lock:
            held = self._rows.get(key)
            if held is not None and held[0] == ref.loaded_at:
                self._rows.move_to_end(key)
                return held[1]
        if not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table):
            raise Unreadable(f"the catalog names an unusable table for {ref.tab}")
        got = self.query(f'select row_number, _raw from sheets."{ref.table}" order by row_number')  # noqa: S608
        out = []
        for rn, raw in got:
            if isinstance(raw, str):
                raw = json.loads(raw)
            out.append((int(rn), raw if isinstance(raw, dict) else {}))
        with self._lock:
            self._rows[key] = (ref.loaded_at, out)
            while len(self._rows) > ROWS_HELD:
                self._rows.popitem(last=False)
        return out

    # -- the depot: pointers, switches, dissolved tabs --
    def facts(self) -> dict[str, Any]:
        ref = self.tab(ESSENCIAL_ID, FACTS_TAB)
        if ref is None:
            raise Unreadable("the depot's Facts are not in asa-hub-db")
        self.note_book(ESSENCIAL_ID)
        held = self._facts
        if held.get("loaded") == ref.loaded_at and held.get("table") == ref.table:
            return held
        got = self.query(
            f"select row_number, subject_id, value, source from {self.from_sql(ref)} t"  # noqa: S608
            " where source like %s or source like %s or subject_id like %s or subject_id like %s"
            " order by row_number",
            ("switchboard:%", "dissolution:hiring_alerts_config.%", "HUB\\_%", "%\\_ID"))
        areas: dict[str, dict[str, str]] = {}
        subjects: dict[str, str] = {}
        cfg_rows: dict[str, dict[str, str]] = {}
        cfg_order: list[str] = []
        for _rn, subject, value, source in got:
            subject, value, source = str(subject or "").strip(), str(value or ""), str(source or "")
            m = re.match(r"^switchboard:([^.]+)\.(.*)$", source)
            if m:
                key = m.group(2) or subject
                if key:
                    areas.setdefault(m.group(1), {})[key] = value
            elif source.startswith("dissolution:hiring_alerts_config."):
                if subject:
                    if subject not in cfg_rows:
                        cfg_rows[subject] = {}
                        cfg_order.append(subject)
                    cfg_rows[subject][source[len("dissolution:hiring_alerts_config."):]] = gsjs.str_(value)
            if subject and value.strip():
                subjects[subject] = value.strip()
        # the subject is the row's key: the copies withhold the `key` facts themselves
        held = {"loaded": ref.loaded_at, "table": ref.table, "areas": areas, "subjects": subjects,
                "config": [cfg_rows[s] | {"key": s} for s in cfg_order
                           if str(cfg_rows[s].get("__deleted") or "").lower() != "true"]}
        self._facts = held
        return held

    def switchboard(self, area: str) -> dict[str, str]:
        return dict(self.facts()["areas"].get(area) or {})

    def prop(self, key: str) -> str:
        """hubProp_: an override, the switchboard's props, the depot's own fact, then what Props.gs is known to hold."""
        env = os.getenv("HUB_APP_PROP_" + key, "").strip()
        if env:
            return env
        facts = self.facts()
        got = str((facts["areas"].get("props") or {}).get(key) or "").strip()
        return got or facts["subjects"].get(key, "") or PROP_FALLBACKS.get(key, "")

    def hiring_config(self) -> dict[str, str]:
        """hiringAlerts_: the dissolved config rows, key → value."""
        out: dict[str, str] = {}
        for row in self.facts()["config"]:
            k = gsjs.trim(str(row.get("key") or ""))
            if k:
                out[k] = str(row.get("value") or "")
        return out

    @staticmethod
    def on(value: Any) -> bool:
        return str(value or "").strip().lower() in ("on", "true", "1", "yes")

    def house_id(self, tab: str) -> str:
        return self.prop("HUB_HOUSE_" + str(tab or "").upper() + "_ID") if tab else ""

    def house_moved(self, tab: str) -> bool:
        """houseMoved_: the depot's pointer and an explicit moved.<tab> yes."""
        return bool(tab) and self.on(self.switchboard("moved").get(tab)) and bool(self.house_id(tab))

    def dissolved(self, tab: str) -> bool:
        if tab not in HIRING_DISSOLVABLE:
            return False
        kv = self.switchboard("dissolved")
        return self.on(kv.get("*")) or self.on(kv.get(tab))

    def resolve(self, tab: str) -> Resolved:
        """hubTabSheet_ at headquarters: dissolved, moved, homed, else HUB_DB."""
        if self.dissolved(tab):
            return Resolved("", (tab,), None, False, False, runtime=True)
        if self.house_moved(tab):
            sid = self.house_id(tab)
            names: tuple = (tab, HOUSE_DATA_TAB)
            declared = True
        else:
            home = HUB_TAB_HOME.get(tab)
            sid = self.prop(home) if home else ""
            sid = sid or self.prop("HUB_DB_ID")
            names, declared = (tab,), False
        ref = next((r for r in (self.tab(sid, n) for n in names) if r is not None), None)
        virtual = getattr(OWN.get(), "virtual", None)
        if ref is None and sid and virtual is not None:
            # rows Python appended before any copy of the tab: under the name the house keeps them in (its Data tab)
            ref = next((r for r in (virtual(sid, n) for n in names) if r is not None), None)
        if sid:
            self.note_book(sid)
        return Resolved(sid, names, ref, declared, self.book(sid) is not None)

    def people_as_of(self, books: set[str]) -> float | None:
        """as_of of the books read here that decide who reads what (PEOPLE_TABS, the depot); None when none was read."""
        token = READ_BOOKS.set(None)
        try:
            people = {self.resolve(t).sheet_id for t in PEOPLE_TABS} | {ESSENCIAL_ID}
        finally:
            READ_BOOKS.reset(token)
        held = set(books or ()) & {s for s in people if s}
        return self.as_of(held) if held else None

    def as_of(self, books: set[str], now: float | None = None) -> float:
        """The moment every book read is known to hold what Google held: its last sync when Drive changed it since,
        else the keeper's listing its copy holds, else the clone's check less the mirror's share, else LAG_S ago."""
        now = time.time() if now is None else now
        out = now
        for sid in books or ():
            b = self.book(sid)
            if b is None:
                out = min(out, now - LAG_S)
                continue
            if b.status == RECORD_STATUS:
                continue
            synced, modified = _epoch(b.synced_at), _epoch(b.modified_time)
            if synced and modified > synced + 60:
                out = min(out, synced)
                continue
            checked, listed = _epoch(b.checked_at), _epoch(b.listed_at)
            if checked and listed:
                out = min(out, min(checked, listed - LISTING_MARGIN_S))
            elif checked:
                out = min(out, checked - KEEPER_LAG_S)
            else:
                out = min(out, now - LAG_S)
        return out

    def stale(self, books: set[str]) -> bool:
        """Drive changed a book read here after the copy of it was made (or the copy holds no such book)."""
        for sid in books or ():
            b = self.book(sid)
            if b is None:
                return True
            if b.status == RECORD_STATUS:
                continue
            synced, modified = _epoch(b.synced_at), _epoch(b.modified_time)
            if not synced or modified > synced + 60:
                return True
        return False

    # -- the readers, each as its Apps Script twin --
    def locations_rows(self, ref: TabRef | None) -> list[dict]:
        """locationsTabRows_: header-keyed, Dates as ISO, every cell trimmed; blank rows dropped."""
        if ref is None:
            return []
        heads = [gsjs.trim(h) for h in ref.headers]
        out = []
        for rn, raw in self.rows(ref):
            o: dict[str, Any] = {"_row": rn}
            empty = True
            for h, src in zip(heads, ref.headers):
                if not h:
                    continue
                v = gsjs.cell(_shown(typed(raw.get(src), "hub")))
                if v:
                    empty = False
                o[h] = v
            if not empty:
                out.append(o)
        return out

    def estate_rows(self, ref: Any, rows: list[tuple[int, dict]] | None = None) -> list[dict]:
        """estateRows_: keys from estateKey_, id r<sheet row>, cells by estateCell_; blank rows dropped. `rows`: a kept
        tab's own, in place of the copy's."""
        if ref is None:
            return []
        keys = [estate_key(h) for h in ref.headers]
        out = []
        for rn, raw in self.rows(ref) if rows is None else rows:
            row: dict[str, Any] = {"id": f"r{rn}"}
            empty = True
            for k, src in zip(keys, ref.headers):
                if not k:
                    continue
                v = estate_cell(typed(raw.get(src), "estate"))
                if v:
                    empty = False
                row[k] = v
            if not empty:
                out.append(row)
        return out

    def sheetdb_rows(self, ref: TabRef | None) -> list[dict]:
        """readAll_: header-keyed, Dates as cellText_, JSON-looking text parsed; rows of nothing but blanks dropped."""
        if ref is None:
            return []
        out = []
        for _rn, raw in self.rows(ref):
            vals = [typed(raw.get(h), "hub") for h in ref.headers]
            if all(v == "" or v is None for v in vals):
                continue
            out.append({h: cell_text(v) for h, v in zip(ref.headers, vals) if h != ""})
        return out

    def normalized_rows(self, ref: TabRef | None) -> list[dict]:
        """readTabNormalized_ on HUB_DB: headers normKey_'d, Dates as cellText_."""
        if ref is None:
            return []
        return normalize(ref.headers, self.rows(ref))

    def grid(self, ref: TabRef | None) -> list[list[Any]]:
        """getDataRange().getValues(): the header, then each row's text in the header's order."""
        if ref is None:
            return []
        out: list[list[Any]] = [list(ref.headers)]
        for _rn, raw in self.rows(ref):
            out.append([raw.get(h, "") if raw.get(h) is not None else "" for h in ref.headers])
        return out


_SHARED: list[HubDb | None] = [None]
_SHARED_LOCK = threading.Lock()


def shared() -> HubDb:
    """The process's one reader of asa-hub-db: a module reads through its connection, never one of its own."""
    with _SHARED_LOCK:
        if _SHARED[0] is None:
            _SHARED[0] = HubDb()
        return _SHARED[0]


def _shown(v: Any) -> Any:
    """A time-only cell where locationsCell_ reads it: the Date of 30 Dec 1899 at that clock."""
    if isinstance(v, SheetTime):
        return SheetDate(datetime(1899, 12, 30, v.h, v.m, v.s, tzinfo=NY))
    return v
