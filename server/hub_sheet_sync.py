"""The platform's OWN sheets⇄Postgres keeper.
THE RULE IT ANSWERS TO: the code takes its data straight from Postgres; it keeps the sheets updated the way…"""
from __future__ import annotations

import asyncio
import base64
import collections
import contextlib
import fcntl
import hashlib
import json
import logging
import os
import re
import signal
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from zoneinfo import ZoneInfo

import redaction

try:
    import psycopg2
    import psycopg2.extras
except Exception:  # pragma: no cover - the keeper's own image always carries it
    psycopg2 = None  # type: ignore[assignment]

log = logging.getLogger("hub.sheetsync")

PG_DSN = os.getenv("HUB_PG_DSN") or os.getenv("PG_DSN") or ""
SA_PATH = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "/app/service-account.json")
IMPERSONATE = os.getenv("GOOGLE_IMPERSONATE_USER", "jarvis@asalifecare.com")
SCOPES = ["https://www.googleapis.com/auth/drive.readonly",
          "https://www.googleapis.com/auth/spreadsheets.readonly"]
SYNC_EVERY_S = float(os.getenv("HUB_SHEET_SYNC_EVERY_S", "180"))
# THE MIRROR LEFT WITH the old platform (2026-10-27): the keeper no longer copies every book into the old platform's database.
# Off (the default), a pass keeps only the calendars' grids and the house calendars' live copy, both in asa-hub-db
# (grids_pass); the books people still post to are swept by asa-hub-app (app/essential_sheets.py). "on" brings the
# old pass back, and with it the old platform's database (HUB_PG_DSN).
MIRROR_ON = (os.getenv("HUB_SHEET_SYNC_MIRROR") or "off").strip().lower() in ("1", "on", "true", "yes")
KEEPER_STATE = "app.sheet_keeper_state"
# the relay's wake (SIGUSR1, after a change of who reads what): the next pass at once, this long after the last began
WAKE_GAP_S = 5.0
# the channel every pass's commit is said on (asa-hub-db-sync listens on it)
MIRROR_MOVED = "hub_mirror_moved"
# the least room between two requests of this keeper, whatever the budget
PER_REQUEST_DELAY_S = float(os.getenv("HUB_SHEET_SYNC_DELAY_S", "1.1"))
# THE KEEPER'S SHARE OF THE BUCKET.
REQUESTS_PER_MINUTE = int(os.getenv("HUB_SHEET_SYNC_RPM", "30"))
# oldest change first; the rest wait for the next pass, owed, never dropped
BOOKS_PER_PASS = int(os.getenv("HUB_SHEET_SYNC_BOOKS_PER_PASS", "40"))
# a tab this long is kept by appends; a shorter one is read whole
GIANT_TAB_ROWS = int(os.getenv("HUB_SHEET_SYNC_GIANT_ROWS", "5000"))
# a giant tab is read whole at most this often — and at least this often once its book has changed (the bound on an…
WHOLE_EVERY_S = float(os.getenv("HUB_SHEET_SYNC_WHOLE_EVERY_S", "10800"))
# the tab list of a book is asked again at most this often (a renamed or deleted tab is caught at once by its range…
TITLES_EVERY_S = float(os.getenv("HUB_SHEET_SYNC_TITLES_EVERY_S", "3600"))
# how many rows at each end of a giant tab must match the mirror
HEAD_ROWS = 3
TAIL_ROWS = 5
# the largest shift the tail check is proved able to see: a last-rows window that equals itself this many rows away…
SHIFT_GUARD_ROWS = 50
# a book whose last sync failed is retried at most this many a pass, least recently tried first — it never takes a…
RETRY_FAILED_PER_PASS = int(os.getenv("HUB_SHEET_SYNC_RETRY_FAILED", "3"))
# an owed read (the due sweep) that failed waits this long before asking again
DUE_RETRY_S = float(os.getenv("HUB_SHEET_SYNC_DUE_RETRY_S", "3600"))
# a refusal breathes the whole width of the per-minute bucket
QUOTA_BREATHE_S = 60.0
# the watermark steps back this far on every pass so a clock-skewed edit cannot fall between two passes
WATERMARK_LAP_S = 60.0
SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet"

# BOOKS THE MIRROR NEVER COPIES, WHOEVER THEY ARE SHARED WITH AND WHEREVER THEY ARE MOVED.
KEEP_OUT_TITLES = frozenset({"ASA Data — PsiPunchesFull", "ASA Data — MedDispenses",
                             "ASA Data — MedPatients"})
KEEP_OUT_POINTERS = ("switchboard:props.HUB_HOUSE_PSI_PUNCHES_FULL_ID",
                     "switchboard:props.HUB_HOUSE_MED_DISPENSES_ID",
                     "switchboard:props.HUB_HOUSE_MED_PATIENTS_ID")
KEEP_OUT_PARENTS = frozenset(
    p.strip() for p in os.getenv("HUB_HOUSE_MEDS_FOLDER_ID", "1DMU5OIAC-QChkNgGJsZKw7n3IqN9Im-G").split(",")
    if p.strip())
ESSENCIAL_ID = os.getenv("HUB_ESSENCIAL_ID", "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug")
KEEP_OUT_EVERY_S = float(os.getenv("HUB_SHEET_SYNC_KEEP_OUT_EVERY_S", "3600"))
_KEEP_OUT: dict[str, Any] = {"at": 0.0, "ids": frozenset(), "said": set()}

# BOOKS THE HUB OWNS: read again on their own clock even when Drive's modifiedTime does not move (a formula changes…
OWNED_POINTERS = ("switchboard:props.CERT_SOURCE_ID",)
# csrBookId_: the Missing Medications form book its prop names, else the one Apps Script falls back to — the live
# form repeats a client's medications title, and Clients › Refills reads both columns by position
MISSING_MEDS_POINTER = "switchboard:props.HUB_MISSING_MEDS_SHEET_ID"
MISSING_MEDS_FALLBACK = "19Umc82evptvKj7GLG2RNdr6VhKDnX0Mp6C1paX6Gw1w"
OWNED_EVERY_S = float(os.getenv("HUB_SHEET_SYNC_OWNED_EVERY_S", "1800"))
_OWNED: dict[str, Any] = {"at": 0.0, "ids": frozenset(), "read": {}}
# BOOKS POSTGRES KEEPS THE RECORD OF (asa-hub-db app.record_books): their copy is asa-hub-db's own daily check's;
# with HUB_SHEET_SYNC_RECORD_OUT=on this keeper never reads them, and the mirror's rows of them stand as they are
RECORD_OUT = (os.getenv("HUB_SHEET_SYNC_RECORD_OUT") or "").strip().lower() in ("1", "on", "true", "yes")
_RECORD: dict[str, Any] = {"at": 0.0, "ids": frozenset()}


def record_ids(now: float) -> frozenset[str]:
    """The record books whose copy their daily check holds, asked of asa-hub-db at most every KEEP_OUT_EVERY_S."""
    if not RECORD_OUT or not GRID_DSN or psycopg2 is None:
        return frozenset()
    if _RECORD["at"] and now - float(_RECORD["at"]) < KEEP_OUT_EVERY_S:
        return _RECORD["ids"]
    conn = None
    try:
        conn = psycopg2.connect(GRID_DSN, connect_timeout=10)
        with conn.cursor() as cur:
            cur.execute("select sheet_id from app.record_books where held_since is not null")
            _RECORD.update(at=now, ids=frozenset(r[0] for r in cur.fetchall()))
    except Exception as exc:  # noqa: BLE001 — the ids read last stand; asked again next pass
        log.warning("sheet-sync: the record books could not be read (%s) — the ids read last stand", type(exc).__name__)
    finally:
        if conn is not None:
            conn.close()
    return _RECORD["ids"]
# the books whose copy already holds what the rule keeps of them (ruled_books)
_RULED: dict[str, Any] = {"clean": set()}

# THE EMPLOYEE DATABASE'S SSN MATCH (EmployeeDb.gs empdbSsnKey_): the salted fingerprint of the SSN# cell, kept in a
# column of its own beside the cell's marker, only while the keeper holds the salt Apps Script fingerprints with. Its
# name carries "ssn" inside a word: the rule (whole words) keeps it, the readers that drop SSN columns by substring
# (compliancePiiBlocked_, emp360PiiBlocked_) never show it
FINGERPRINT_SOURCE = "SSN#"
FINGERPRINT_KIND = "ssn9"
FINGERPRINT_COLUMN = "Hub SSNfingerprint"
PII_SALT_ENV = "HUB_PII_SALT"
_SALT_SAID: dict[str, bool] = {"said": False}

# THE HOUSE CALENDARS' GRIDS (Scheduling's seed, schedSeedRead_ / reconCalendarLinks_): the Dashboard index's links and
# each linked book's CALENDAR tab as shown — text, real dates, backgrounds — kept in asa-hub-db's app.sheet_grids
GRID_INDEX_POINTER = "switchboard:props.RECON_INDEX_ID"
GRID_TAB = "CALENDAR"
GRID_DSN = (os.getenv("HUB_SHEET_GRID_DSN") or os.getenv("HUB_HOUSE_MEDS_DSN") or "").strip()
GRID_TABLE = "app.sheet_grids"
GRIDS_PER_PASS = int(os.getenv("HUB_SHEET_SYNC_GRIDS_PER_PASS", "6"))
# THE CALENDARS ARE READ THREE TIMES A DAY (the operator, 2026-10-28): the house calendars and the grids are still
# edited in Google, so they are read into asa-hub-db at the essential sweep's times, New York time, and never between
# them; a wake reads nothing. Every screen reads asa-hub-db alone.
NY = ZoneInfo("America/New_York")
READ_AT = tuple(t.strip() for t in (os.getenv("HUB_CALENDARS_READ_AT") or os.getenv("HUB_ESSENTIAL_SWEEP_AT")
                                    or "07:00,13:00,19:00").split(",") if t.strip())
# the passes one of those times runs at most, and the breath between two of them
SLOT_PASSES = 10
SLOT_GAP_S = 30.0


def next_read_at(now: datetime | None = None) -> datetime:
    """The next of the day's calendar reads, New York time."""
    now = (now or datetime.now(NY)).astimezone(NY)
    for day in (0, 1):
        for hhmm in sorted(READ_AT):
            h, m = (int(x) for x in hhmm.split(":"))
            at = (now + timedelta(days=day)).replace(hour=h, minute=m, second=0, microsecond=0)
            if at > now:
                return at
    return now + timedelta(hours=8)
GRID_LINK = re.compile(r"/d/([a-zA-Z0-9_-]{20,})")
GRID_WHITE = "#ffffff"
_GRID_EPOCH = datetime(1899, 12, 30)
_GRID_CELL = ("formattedValue,effectiveValue(numberValue),effectiveFormat(numberFormat(type)),"
              "userEnteredFormat(backgroundColor,backgroundColorStyle(rgbColor))")

# THE HOUSE CALENDARS' LIVE COPY (the old platform's app/intranet/house_calendar_live.py, translated): the live
# workbook, one tab per house, each house tab's staff × day grid with every cell's text and background, kept in
# asa-hub-db's app.asa_house_calendar_live; read again once the book moved past it, and at least every LIVE_EVERY_S
LIVE_BOOK_ID = os.getenv("HUB_HOUSE_CALENDARS_LIVE_ID", "1ZL5EHUfx627VFJ9rRlv8D1J8ljZJvns8TZsUKj_oAe0").strip()
LIVE_TABLE = "app.asa_house_calendar_live"
LIVE_EVERY_S = int(os.getenv("HUB_HOUSE_CALENDARS_LIVE_EVERY_S", "1800"))
LIVE_TABS_PER_READ = 3
_LIVE_CELL = "formattedValue,effectiveFormat(backgroundColor)"
_LIVE_MD = re.compile(r"^(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?$")
_LINK_CELL = "formattedValue,hyperlink,textFormatRuns(format(link(uri)))"
_GRIDS: dict[str, Any] = {"store": None, "said": False}
# the Calendar Builder's master grid (calendar_builder_slices), kept as `master` beside the house calendars: its
# "New Calendar" tab as far as the builder reads it (A..AE, 500 rows), its 28 day-columns apart
MASTER_GRID_ID = os.getenv("HUB_CAL_BUILDER_SHEET_ID", "1_S62kl6hh0XG_3OK25X-AZYuYo3Apfm5oCAvvmdodfU").strip()
MASTER_GRID_TAB = "New Calendar"
MASTER_GRID_RANGE = "A1:AE500"
# a grid kept is told to asa-hub-app: the house grids as the slices read off them (its /notify), rebuilt there at once;
# the master grid as the master record's sync (its /calendar-builder/master-sync), which folds the grid into the record
# the Builder reads (app/cal_builder_master.py) — no slice is read off the master grid itself
HUB_APP_URL = os.getenv("HUB_APP_URL", "http://asa-hub-app:8080").rstrip("/")
MASTER_SYNC = "calendarMasterSync"
CALENDAR_GRID_SLICES = ("shifts", "shiftCards", "shiftMatrix", "shiftTimeline")

# ── WHAT NEVER REACHES THE MIRROR ────────────────────────────────────────── A card or bank cell, a government…
_withheld_so_far = collections.Counter()


def _redact(data: dict, count: bool = True) -> dict:
    row, withheld = redaction.redact_row(data)
    if count:
        _withheld_so_far["cells"] += withheld
    return row


# ── header detection — copied VERBATIM from the old scan (drive_sheet_backup.py).

def _looks_like_label(cell) -> bool:
    """A cell looks like a column header when it's a non-empty string that contains at least one alphabetic…"""
    if cell is None:
        return False
    s = str(cell).strip()
    if not s:
        return False
    if re.fullmatch(r"-?\d+(\.\d+)?", s):
        return False
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}.*)?", s):
        return False
    return bool(re.search(r"[A-Za-z]", s))


def _detect_header(values: list[list]) -> tuple[int | None, list[str]]:
    """The real header row in the first 8 rows: ≥2 non-empty cells, ≥1 of them label-shaped; (None, []) sends the…"""
    limit = min(len(values), 8)
    for i in range(limit):
        row = values[i] or []
        non_empty = [c for c in row if c is not None and str(c).strip() != ""]
        if len(non_empty) < 2:
            continue
        if not any(_looks_like_label(c) for c in non_empty):
            continue
        last_non_empty = max(
            (j for j, c in enumerate(row) if c is not None and str(c).strip() != ""),
            default=-1)
        header = [str(c).strip() for c in row[: last_non_empty + 1]]
        return i, header
    return None, []


def _header_of(values: list[list]) -> tuple[int, list[str]]:
    """(header row index, header) — the detected one, else row 0 as it stands."""
    hi, header = _detect_header(values)
    if hi is None:
        hi, header = 0, [str(h).strip() for h in (values[0] if values else [])]
    return hi, header


def twin_keys(header: list[str]) -> list[str]:
    """An owned book's row keys: a repeated name's last column keeps the name, each earlier one is "<name> ⟨n⟩"."""
    total = collections.Counter(h for h in header if h)
    seen: collections.Counter = collections.Counter()
    out = []
    for h in header:
        if h and total[h] > 1:
            seen[h] += 1
            out.append(h if seen[h] == total[h] else f"{h} ⟨{seen[h]}⟩")
        else:
            out.append(h)
    return out


def header_record(matrix: list[list], rows: list, now: float) -> dict | None:
    """An owned tab's header as its rows are keyed, in the sheet's order, named as the copies name it."""
    if len(matrix) < 2:
        return None
    hi, header = _header_of(matrix)
    keys = [k for k in twin_keys(header) if k]
    return {"header_row": hi, "header": list(_redact(dict.fromkeys(keys), False)), "extent": _extent(matrix, len(header)),
            "rows": len(rows), "whole_at": now}


def _parse_row(row: list | None, header: list[str], count: bool = True, twins: bool = False) -> dict | None:
    """One sheet row as the mirror stores it — the ONE rule both lanes use, so a row appended and the same row…"""
    row = row or []
    keys = twin_keys(header) if twins else header
    data = {h: (str(row[i]) if i < len(row) else "") for i, h in enumerate(keys) if h}
    if not data or not any(v.strip() for v in data.values()):
        return None
    _fingerprinted(data)
    return _redact(data, count)


def pii_salt() -> str:
    """The salt Apps Script fingerprints SSNs with (hubPiiSalt_), when this process was given it; '' otherwise."""
    salt = (os.getenv(PII_SALT_ENV) or "").strip()
    return "" if len(salt) < 16 or salt.startswith("[withheld") else salt


def ssn_fingerprint(value: Any, salt: str) -> str:
    """hubSsnFingerprint_: '' unless the cell holds exactly nine digits."""
    digits = re.sub(r"\D", "", str(value if value is not None else ""))
    if len(digits) != 9 or not salt:
        return ""
    return base64.b64encode(hashlib.sha256((salt + ":" + digits).encode("utf-8")).digest()).decode("ascii")[:22]


def _fingerprinted(data: dict) -> None:
    """The book being copied keeps its SSN# as a match fingerprint (FINGERPRINT_COLUMN), never inside the marker."""
    if FINGERPRINT_SOURCE not in data or redaction.kept_fact_kind(FINGERPRINT_SOURCE) != FINGERPRINT_KIND:
        return
    salt = pii_salt()
    if not salt:
        if not _SALT_SAID["said"]:
            _SALT_SAID["said"] = True
            log.info("sheet-sync: %s is not set in this process — no SSN fingerprint is kept, so the Employee "
                     "Database's SSN match is not available", PII_SALT_ENV)
        return
    data[FINGERPRINT_COLUMN] = ssn_fingerprint(data[FINGERPRINT_SOURCE], salt)


def fingerprint_books() -> list[str]:
    """The books whose SSN# the rule keeps as a figure (BOOK_KEPT_FACTS 'ssn9'): the ones a fingerprint is kept for."""
    return [sid for sid, facts in redaction.BOOK_KEPT_FACTS.items()
            if facts.get(FINGERPRINT_SOURCE) == FINGERPRINT_KIND]


def _extent(matrix: list[list], width: int) -> int:
    """The last sheet row (1-based) holding a cell in the header's columns — what a read bounded to those columns…"""
    for i in range(len(matrix) - 1, -1, -1):
        if any(c not in (None, "") for c in (matrix[i] or [])[:width]):
            return i + 1
    return 0


def _col_letter(n: int) -> str:
    """1 → A, 27 → AA."""
    out = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out or "A"


def _quote(title: str) -> str:
    """A tab name as A1 notation wants it: quoted, its own quotes doubled."""
    return "'" + str(title).replace("'", "''") + "'"


def _clients():
    """Drive + Sheets clients on the mounted service account."""
    import base64
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    raw = (SA_PATH or "").strip()
    info = None
    if raw.startswith("{"):
        info = json.loads(raw)
    elif not raw.startswith("/") and len(raw) > 512:
        try:
            info = json.loads(base64.b64decode(raw))
        except Exception:  # noqa: BLE001 — not base64 after all; try as a path
            info = None
    if info is not None:
        base = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    else:
        base = service_account.Credentials.from_service_account_file(raw, scopes=SCOPES)
    creds = base
    if not (IMPERSONATE or "").strip():
        # NOT A DELEGATION AT ALL.
        log.info("sheet-sync: GOOGLE_IMPERSONATE_USER is empty — the keeper IS the service"
                 " account, and a book shared with nobody else is in no mirror")
    else:
        try:
            probe = base.with_subject(IMPERSONATE)
            import google.auth.transport.requests as gtr
            probe.refresh(gtr.Request())
            creds = probe
        except Exception as exc:  # noqa: BLE001 — plain SA still sees shared books
            log.warning("sheet-sync: DWD as %s refused (%s) — plain SA lane", IMPERSONATE, exc)
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    sheets = build("sheets", "v4", credentials=creds, cache_discovery=False)
    return drive, sheets


# The reasons Google gives a quota refusal that answers 403 rather than 429.
_QUOTA_REASONS = ("rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED",
                  "RESOURCE_EXHAUSTED", "quotaExceeded", "Quota exceeded")


def _status(exc: Exception) -> int | None:
    """The HTTP status of a googleapiclient error; None for anything else."""
    status = getattr(getattr(exc, "resp", None), "status", None)
    try:
        return int(status) if status is not None else None
    except (TypeError, ValueError):
        return None


def _said(exc: Exception) -> str:
    """What Google itself said — the reason, the details, the body — and never the error's text, which carries…"""
    content = getattr(exc, "content", b"") or b""
    if isinstance(content, bytes):
        content = content.decode("utf-8", "replace")
    return " ".join(str(x or "") for x in (getattr(exc, "reason", ""),
                                            getattr(exc, "error_details", ""), content))


def _is_429(exc: Exception) -> bool:
    """A QUOTA REFUSAL IS DECIDED BY THE STATUS, NEVER BY THE TEXT."""
    status = _status(exc)
    if status == 429:
        return True
    if status == 403:
        said = _said(exc)
        return any(r in said for r in _QUOTA_REASONS)
    return False


def _is_gone(exc: Exception) -> bool:
    """The book cannot be read at all any more: deleted (404) or no longer shared with this identity (a 403 that…"""
    status = _status(exc)
    return status == 404 or (status == 403 and not _is_429(exc))


def _is_range_error(exc: Exception) -> bool:
    """A range the book no longer has: a tab renamed or deleted, columns gone."""
    status = _status(exc)
    s = _said(exc) + " " + str(exc)
    return (status == 400 or "HttpError 400" in s) and (
        "Unable to parse range" in s or "exceeds grid limits" in s)


def _ts(value: Any) -> float:
    """A Drive modifiedTime, a timestamptz or an epoch as seconds; 0.0 when none."""
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).timestamp()
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _iso(epoch: float) -> str:
    """Seconds as Drive writes a modifiedTime, to the millisecond."""
    dt = datetime.fromtimestamp(epoch, timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _parents(raw: Any) -> list[str]:
    """A meta row's parents_json as a list of folder ids; [] when unknown."""
    if isinstance(raw, list):
        return [str(p) for p in raw if p]
    try:
        got = json.loads(raw) if raw else []
    except (TypeError, ValueError):
        return []
    return [str(p) for p in got if p] if isinstance(got, list) else []


# ═══════════════════════════════════════════════════════════════════════════ The bucket…
class QuotaShut(RuntimeError):
    """Google refused twice in a row for quota: the pass stops, keeping what landed."""


class Pace:
    """Every Sheets request this keeper makes waits here first: at least PER_REQUEST_DELAY_S after the one…"""

    def __init__(self, per_minute: int = REQUESTS_PER_MINUTE,
                 spacing: float = PER_REQUEST_DELAY_S,
                 clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep) -> None:
        self.per_minute = max(1, int(per_minute))
        self.spacing = max(0.0, float(spacing))
        self.clock, self.sleep = clock, sleep
        self.sent: collections.deque[float] = collections.deque()
        self.count = 0

    def wait(self) -> None:
        now = self.clock()
        while self.sent and now - self.sent[0] >= 60.0:
            self.sent.popleft()
        delay = 0.0
        if self.sent:
            delay = max(delay, self.spacing - (now - self.sent[-1]))
        if len(self.sent) >= self.per_minute:
            delay = max(delay, 60.0 - (now - self.sent[0]))
        if delay > 0:
            self.sleep(delay)
        self.sent.append(self.clock())
        self.count += 1


def _ask(pace: Pace, make: Callable[[], Any]) -> dict:
    """One Sheets request, paced."""
    for attempt in range(2):
        pace.wait()
        try:
            return make().execute()
        except Exception as exc:  # noqa: BLE001
            if not _is_429(exc):
                raise
            if attempt:
                raise QuotaShut(f"refused twice for quota: {type(exc).__name__}") from exc
            log.warning("sheet-sync: Google refused a read for quota — breathing %.0fs",
                        QUOTA_BREATHE_S)
            pace.sleep(QUOTA_BREATHE_S)
    raise QuotaShut("unreachable")  # pragma: no cover


def _read_titles(sheets: Any, pace: Pace, sid: str) -> list[str]:
    got = _ask(pace, lambda: sheets.spreadsheets().get(
        spreadsheetId=sid, fields="sheets.properties.title"))
    titles = [s["properties"]["title"] for s in got.get("sheets", [])]
    if not titles:
        raise RuntimeError("workbook answered with no tabs")
    return titles


def _batch(sheets: Any, pace: Pace, sid: str, ranges: list[str]) -> list[list[list]]:
    """The values of every range asked, in the order asked."""
    got = _ask(pace, lambda: sheets.spreadsheets().values().batchGet(
        spreadsheetId=sid, ranges=ranges, valueRenderOption="FORMATTED_VALUE"))
    out = [vr.get("values") or [] for vr in got.get("valueRanges", [])]
    if len(out) != len(ranges):
        raise RuntimeError(f"asked {len(ranges)} range(s), answered {len(out)}")
    return out


# ═══════════════════════════════════════════════════════════════════════════ One tab…
def whole_tab(matrix: list[list], now: float, twins: bool = False) -> tuple[list[tuple[int, dict]], dict | None]:
    """A tab read whole → (rows as the mirror keys them, the giant state or None)."""
    if len(matrix) < 2:
        return [], None
    hi, header = _header_of(matrix)
    rows: list[tuple[int, dict]] = []
    for idx, row in enumerate(matrix[hi + 1:], start=hi + 2):
        data = _parse_row(row, header, twins=twins)
        if data is not None:
            rows.append((idx, data))
    if len(rows) < GIANT_TAB_ROWS:
        return rows, None
    return rows, {"header_row": hi, "header": header, "extent": _extent(matrix, len(header)),
                  "rows": len(rows), "whole_at": now, "dirty_since": None}


def tail_ranges(title: str, st: dict) -> list[str]:
    """The two ranges a giant tab is checked and extended through: every column of the rows down to HEAD_ROWS…"""
    hi, width, extent = int(st["header_row"]), len(st["header"]), int(st["extent"])
    start = max(hi + 2, extent - TAIL_ROWS + 1)
    return [f"{_quote(title)}!1:{hi + 1 + HEAD_ROWS}",
            f"{_quote(title)}!A{start}:{_col_letter(width)}"]


def tail_window(st: dict) -> tuple[tuple[int, int], tuple[int, int]]:
    """The sheet rows the check compares with the mirror: (head lo, hi), (tail lo, hi)."""
    hi, extent = int(st["header_row"]), int(st["extent"])
    first = hi + 2
    start = max(first, extent - TAIL_ROWS + 1)
    return (first, min(first + HEAD_ROWS - 1, extent)), (start, extent)


def mirror_windows(st: dict) -> list[tuple[int, int]]:
    """The mirror rows the check needs: the head window, and the tail window with SHIFT_GUARD_ROWS above it (what…"""
    (h_lo, h_hi), (t_lo, t_hi) = tail_window(st)
    return [(h_lo, h_hi), (max(int(st["header_row"]) + 2, t_lo - SHIFT_GUARD_ROWS), t_hi)]


def shift_blind(mirrored: dict[int, dict], t_lo: int, t_hi: int) -> int:
    """The smallest shift (1..SHIFT_GUARD_ROWS) the tail check could NOT see, or 0."""
    for s in range(1, SHIFT_GUARD_ROWS + 1):
        if all(mirrored.get(rn - s) == mirrored.get(rn) for rn in range(t_lo, t_hi + 1)):
            return s
        if s <= t_hi - t_lo and all(mirrored.get(rn) == mirrored.get(rn + s)
                                    for rn in range(t_lo, t_hi - s + 1)):
            return s
    return 0


@dataclass
class TailVerdict:
    ok: bool
    why: str = ""
    appended: list[tuple[int, dict]] = field(default_factory=list)
    extent: int = 0


def tail_verdict(st: dict, head: list[list], tail: list[list],
                 mirrored: dict[int, dict], twins: bool = False) -> TailVerdict:
    """Is everything the mirror holds of this tab still what the tab says, as far as its two ends can tell — and…"""
    hi, header, extent = int(st["header_row"]), list(st["header"]), int(st["extent"])
    if _header_of(head) != (hi, header):
        return TailVerdict(False, "the header changed")
    (h_lo, h_hi), (t_lo, t_hi) = tail_window(st)
    for rn in range(h_lo, h_hi + 1):
        i = rn - 1
        # count=False: this parse is a COMPARISON, not a write. See _redact.
        if _parse_row(head[i] if i < len(head) else None, header, False, twins) != mirrored.get(rn):
            return TailVerdict(False, f"row {rn} under the header is not the mirror's")
    known = t_hi - t_lo + 1
    if len(tail) < known:
        return TailVerdict(False, "rows at the end went away")
    for k in range(known):
        rn = t_lo + k
        if _parse_row(tail[k], header, False, twins) != mirrored.get(rn):
            return TailVerdict(False, f"row {rn} at the end is not the mirror's")
    blind = shift_blind(mirrored, t_lo, t_hi)
    if blind:
        return TailVerdict(False, f"the last rows repeat {blind} row(s) apart, so rows"
                                  " inserted or deleted above them would not show")
    appended = []
    for k in range(known, len(tail)):
        data = _parse_row(tail[k], header, twins=twins)
        if data is not None:
            appended.append((t_lo + k, data))
    return TailVerdict(True, "", appended, max(extent, t_lo + len(tail) - 1))


# ═══════════════════════════════════════════════════════════════════════════ The mirror's side…
@dataclass
class BookChange:
    """Everything one book's sync writes, in one transaction."""
    sid: str
    name: str
    mtime: str
    # set when the tab list was read this time: a tab not in it leaves the mirror
    titles: list[str] | None = None
    # tab → every row it holds now (read whole): the tab's rows are replaced
    replace: dict[str, list[tuple[int, dict]]] = field(default_factory=dict)
    # tab → rows below the last covered one (a giant tab's appends)
    append: dict[str, list[tuple[int, dict]]] = field(default_factory=dict)
    # tab → its giant state now, or None when it is no longer giant
    giants: dict[str, dict | None] = field(default_factory=dict)
    # an owned book: tab → its header record (None drops it); None for any other book, whose records are dropped
    headers: dict[str, dict | None] | None = None


class PgStore:
    """The keeper's Postgres: the mirror tables and its own state."""

    def __init__(self, dsn: str = "") -> None:
        self.dsn = dsn or PG_DSN

    def _conn(self):
        return psycopg2.connect(self.dsn)

    def ensure(self) -> None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "create table if not exists hub_sheet_sync_state ("
                " id int primary key default 1,"
                " watermark timestamptz,"
                " last_pass_at timestamptz,"
                " last_pass_books int not null default 0,"
                " last_pass_errors int not null default 0)")
            cur.execute("insert into hub_sheet_sync_state (id) values (1) on conflict do nothing")
            # WHAT THE READERS ASK (mirror_first.py): the moment the last pass listed Drive's changes, and the books…
            cur.execute("alter table hub_sheet_sync_state"
                        " add column if not exists listed_at timestamptz")
            cur.execute("alter table hub_sheet_sync_state"
                        " add column if not exists pending jsonb")
            cur.execute(
                "create table if not exists hub_sheet_sync_books ("
                " sheet_id text primary key,"
                " titles jsonb not null,"
                " titles_at timestamptz not null)")
            cur.execute(
                "create table if not exists hub_sheet_sync_tabs ("
                " sheet_id text not null,"
                " tab_name text not null,"
                " header_row int not null,"
                " header jsonb not null,"
                " extent int not null,"
                " rows int not null default 0,"
                " whole_at timestamptz not null,"
                " dirty_since timestamptz,"
                " primary key (sheet_id, tab_name))")
            # false: not a giant, only an owned tab's header in the sheet's order (the copies' column order)
            cur.execute("alter table hub_sheet_sync_tabs"
                        " add column if not exists giant boolean not null default true")

    def watermark(self) -> datetime:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("select watermark from hub_sheet_sync_state where id = 1")
            row = cur.fetchone()
            if row and row[0]:
                return row[0]
            # first boot: continue where the OLD scan stopped, not from zero
            cur.execute("select max(modified_time) from asa_drive_sheets_meta")
            row = cur.fetchone()
            if row and row[0]:
                return row[0]
        return datetime.now(timezone.utc) - timedelta(days=1)

    def known(self, ids: list[str]) -> dict[str, tuple[float, str, float]]:
        """sheet id → (the modifiedTime its mirror copy is of, its last status, when that status was written)."""
        if not ids:
            return {}
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("select sheet_id, modified_time, last_sync_status, last_sync_at"
                        " from asa_drive_sheets_meta where sheet_id = any(%s)", (list(ids),))
            return {sid: (_ts(mt), str(st or ""), _ts(at)) for sid, mt, st, at in cur.fetchall()}

    def titles(self, sid: str) -> tuple[list[str], float] | None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("select titles, titles_at from hub_sheet_sync_books where sheet_id = %s",
                        (sid,))
            row = cur.fetchone()
        return (list(row[0] or []), _ts(row[1])) if row else None

    def giants(self, sid: str) -> dict[str, dict]:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("select tab_name, header_row, header, extent, rows, whole_at, dirty_since"
                        " from hub_sheet_sync_tabs where sheet_id = %s and giant", (sid,))
            return {t: {"header_row": hr, "header": list(h or []), "extent": ex, "rows": n,
                        "whole_at": _ts(wa), "dirty_since": _ts(ds) or None}
                    for t, hr, h, ex, n, wa, ds in cur.fetchall()}

    def rows_in(self, sid: str, tab: str, windows: list[tuple[int, int]]) -> dict[int, dict]:
        clauses = " or ".join("row_number between %s and %s" for _ in windows)
        params: list[Any] = [sid, tab]
        for lo, hi in windows:
            params += [lo, hi]
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("select row_number, data from asa_drive_sheets_rows"
                        f" where sheet_id = %s and tab_name = %s and ({clauses})",  # noqa: S608 - fixed text
                        params)
            return {int(rn): dict(data or {}) for rn, data in cur.fetchall()}

    def prior_count(self, sid: str) -> int:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("select count(*) from asa_drive_sheets_rows where sheet_id = %s", (sid,))
            return int((cur.fetchone() or [0])[0])

    def due(self, now: float, exclude: set[str]) -> list[dict]:
        """Books owed a read nobody listed: a giant tab whose whole read is due (dirty, or its book changed…"""
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "select sheet_id, name, modified_time, parents from ("
                " select m.sheet_id, m.name, m.modified_time, m.last_sync_status, m.last_sync_at,"
                "        m.parents_json::text as parents"
                " from hub_sheet_sync_tabs t join asa_drive_sheets_meta m using (sheet_id)"
                " where t.giant and t.whole_at < to_timestamp(%s)"
                "   and (t.dirty_since is not null or m.modified_time > t.whole_at)"
                " union"
                " select m.sheet_id, m.name, m.modified_time, m.last_sync_status, m.last_sync_at,"
                "        m.parents_json::text as parents"
                " from hub_sheet_sync_books b join asa_drive_sheets_meta m using (sheet_id)"
                " where b.titles_at < to_timestamp(%s) and m.modified_time > b.titles_at"
                ") owed where not (coalesce(last_sync_status, '') = 'error'"
                "                  and last_sync_at > to_timestamp(%s))",
                (now - WHOLE_EVERY_S, now - TITLES_EVERY_S, now - DUE_RETRY_S))
            got = cur.fetchall()
        return [{"id": sid, "name": name, "modifiedTime": _iso(_ts(mt)) if mt else "",
                 "parents": _parents(parents)}
                for sid, name, mt, parents in got if sid not in exclude]

    def pointer_ids(self, sources: tuple[str, ...]) -> set[str]:
        """The ids the depot's pointers name, last row wins — read from the mirror's copy of the Essencial's…"""
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("select distinct on (data->>'Source') data->>'Value'"
                        " from asa_drive_sheets_rows"
                        " where sheet_id = %s and tab_name = 'Facts' and data->>'Source' = any(%s)"
                        " order by data->>'Source', row_number desc",
                        (ESSENCIAL_ID, list(sources)))
            return {str(v).strip() for (v,) in cur.fetchall() if v and str(v).strip()}

    def owned_ids(self) -> set[str]:
        meds = self.pointer_ids((MISSING_MEDS_POINTER,)) or {MISSING_MEDS_FALLBACK}
        return self.pointer_ids(OWNED_POINTERS) | meds

    def held_bare(self, sid: str, columns: list[str]) -> bool:
        """Does the mirror still hold, under one of these columns, a marker written before the rule kept more of it?"""
        if not columns:
            return False
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("select 1 from asa_drive_sheets_rows r, jsonb_each_text(r.data) e"
                        " where r.sheet_id = %s and jsonb_typeof(r.data) = 'object'"
                        " and e.key = any(%s) and e.value = any(%s) limit 1",
                        (sid, columns, list(redaction.MARKERS)))
            return cur.fetchone() is not None

    def unprinted(self, sid: str) -> bool:
        """Does the mirror hold a row of this book with an SSN# and no match fingerprint beside it?"""
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("select 1 from asa_drive_sheets_rows where sheet_id = %s and jsonb_typeof(data) = 'object'"
                        " and data ? %s and not data ? %s limit 1", (sid, FINGERPRINT_SOURCE, FINGERPRINT_COLUMN))
            return cur.fetchone() is not None

    def books(self, ids: list[str]) -> dict[str, dict]:
        """sheet id → the book as a listing names it, from the mirror's own record of it."""
        if not ids:
            return {}
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("select sheet_id, name, modified_time, parents_json::text from asa_drive_sheets_meta"
                        " where sheet_id = any(%s)", (list(ids),))
            got = cur.fetchall()
        return {sid: {"id": sid, "name": name or "", "modifiedTime": _iso(_ts(mt)) if mt else "",
                      "parents": _parents(parents)} for sid, name, mt, parents in got}

    def forget(self, sid: str) -> None:
        """A BOOK THAT CANNOT BE READ ANY MORE (deleted, unshared) owes nothing: its tab list and its tabs'…"""
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("delete from hub_sheet_sync_tabs where sheet_id = %s", (sid,))
            cur.execute("delete from hub_sheet_sync_books where sheet_id = %s", (sid,))

    def apply(self, change: BookChange) -> tuple[int, int]:
        """Write one book's change atomically → (tabs holding rows, rows)."""
        sid = change.sid
        with self._conn() as conn, conn.cursor() as cur:
            if change.titles is not None:
                cur.execute("delete from asa_drive_sheets_rows where sheet_id = %s"
                            " and not (tab_name = any(%s))", (sid, change.titles))
                cur.execute("delete from hub_sheet_sync_tabs where sheet_id = %s"
                            " and not (tab_name = any(%s))", (sid, change.titles))
                cur.execute(
                    "insert into hub_sheet_sync_books (sheet_id, titles, titles_at)"
                    " values (%s, %s::jsonb, now()) on conflict (sheet_id) do update set"
                    " titles = excluded.titles, titles_at = excluded.titles_at",
                    (sid, json.dumps(change.titles)))
            for tab, rows in change.replace.items():
                cur.execute("delete from asa_drive_sheets_rows where sheet_id = %s"
                            " and tab_name = %s", (sid, tab))
                self._insert(cur, sid, tab, rows)
            for tab, rows in change.append.items():
                self._insert(cur, sid, tab, rows)
            for tab, st in change.giants.items():
                if st is None:
                    cur.execute("delete from hub_sheet_sync_tabs where sheet_id = %s"
                                " and tab_name = %s", (sid, tab))
                    continue
                cur.execute(
                    "insert into hub_sheet_sync_tabs (sheet_id, tab_name, header_row, header,"
                    " extent, rows, whole_at, dirty_since, giant)"
                    " values (%s, %s, %s, %s::jsonb, %s, %s, to_timestamp(%s), to_timestamp(%s), true)"
                    " on conflict (sheet_id, tab_name) do update set"
                    " header_row = excluded.header_row, header = excluded.header,"
                    " extent = excluded.extent, rows = excluded.rows,"
                    " whole_at = excluded.whole_at, dirty_since = excluded.dirty_since, giant = true",
                    (sid, tab, st["header_row"], json.dumps(st["header"]), st["extent"],
                     st.get("rows") or 0, st["whole_at"], st.get("dirty_since")))
            if change.headers is None:
                cur.execute("delete from hub_sheet_sync_tabs where sheet_id = %s and not giant", (sid,))
            for tab, rec in (change.headers or {}).items():
                if rec is None:
                    cur.execute("delete from hub_sheet_sync_tabs where sheet_id = %s and tab_name = %s"
                                " and not giant", (sid, tab))
                    continue
                cur.execute(
                    "insert into hub_sheet_sync_tabs (sheet_id, tab_name, header_row, header,"
                    " extent, rows, whole_at, dirty_since, giant)"
                    " values (%s, %s, %s, %s::jsonb, %s, %s, to_timestamp(%s), null, false)"
                    " on conflict (sheet_id, tab_name) do update set"
                    " header_row = excluded.header_row, header = excluded.header,"
                    " extent = excluded.extent, rows = excluded.rows,"
                    " whole_at = excluded.whole_at, dirty_since = null, giant = false",
                    (sid, tab, rec["header_row"], json.dumps(rec["header"]), rec["extent"],
                     rec["rows"], rec["whole_at"]))
            cur.execute("select count(*), count(distinct tab_name) from asa_drive_sheets_rows"
                        " where sheet_id = %s", (sid,))
            total, tabs = cur.fetchone() or (0, 0)
            cur.execute(
                "insert into asa_drive_sheets_meta"
                " (sheet_id, name, modified_time, last_sync_at, last_sync_status,"
                "  last_sync_error, tab_count, row_count, is_curated)"
                " values (%s, %s, %s, now(), 'ok', null, %s, %s, true)"
                " on conflict (sheet_id) do update set"
                " name = excluded.name, modified_time = excluded.modified_time,"
                " last_sync_at = now(), last_sync_status = 'ok', last_sync_error = null,"
                " tab_count = excluded.tab_count, row_count = excluded.row_count",
                (sid, change.name or "(untitled)", change.mtime or None, int(tabs), int(total)))
        return int(tabs), int(total)

    @staticmethod
    def _insert(cur: Any, sid: str, tab: str, rows: list[tuple[int, dict]]) -> None:
        if not rows:
            return
        psycopg2.extras.execute_values(
            cur,
            "insert into asa_drive_sheets_rows (sheet_id, tab_name, row_number, data)"
            " values %s"
            " on conflict (sheet_id, tab_name, row_number)"
            " do update set data = excluded.data, ingested_at = now()",
            [(sid, tab, rn, json.dumps(data)) for rn, data in rows],
            template="(%s, %s, %s, %s::jsonb)")

    def mark_error(self, sid: str, name: str, mtime: str, err: str) -> None:
        try:
            with self._conn() as conn, conn.cursor() as cur:
                cur.execute(
                    "insert into asa_drive_sheets_meta"
                    " (sheet_id, name, modified_time, last_sync_at, last_sync_status, last_sync_error)"
                    " values (%s, %s, %s, now(), 'error', %s)"
                    " on conflict (sheet_id) do update set"
                    " last_sync_at = now(), last_sync_status = 'error',"
                    " last_sync_error = excluded.last_sync_error",
                    (sid, name, mtime or None, err[:400]))
        except Exception:  # noqa: BLE001
            pass

    def save_pass(self, mark: datetime | None, books: int, errors: int,
                  listed_at: float, pending: list[str]) -> None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "update hub_sheet_sync_state set watermark = coalesce(%s, watermark),"
                " last_pass_at = now(), last_pass_books = %s, last_pass_errors = %s,"
                " listed_at = to_timestamp(%s), pending = %s::jsonb where id = 1",
                (mark, books, errors, listed_at, json.dumps(sorted(set(pending)))))
            # heard by asa-hub-db-sync when this commits: it copies the pass now, not on its own minute
            cur.execute("select pg_notify(%s, '')", (MIRROR_MOVED,))


# ═══════════════════════════════════════════════════════════════════════════ One book…
@dataclass
class BookResult:
    tabs: int = 0
    rows: int = 0
    tail_tabs: int = 0
    whole_tabs: int = 0
    giant_whole: int = 0
    dirty: int = 0
    appended: int = 0


def _plan(titles: list[str], giants: dict[str, dict], now: float,
          only: set[str] | None) -> list[tuple[str, str, dict | None]]:
    """[(tab, 'whole' | 'tail', its giant state)] — a giant tab whose whole read is due (WHOLE_EVERY_S) is read…"""
    plan = []
    for t in titles:
        if only is not None and t not in only:
            continue
        st = giants.get(t)
        if st is not None and now - float(st["whole_at"] or 0.0) < WHOLE_EVERY_S:
            plan.append((t, "tail", st))
        else:
            plan.append((t, "whole", st))
    return plan


def sync_book(sheets: Any, store: Any, pace: Pace, f: dict, *, now: float | None = None,
              due: bool = False, owned: bool = False) -> BookResult:
    """One workbook → the mirror, atomically, the rule told which book it copies (redaction.reading)."""
    with redaction.reading(f.get("id")):
        return _sync_book(sheets, store, pace, f, now=now, due=due, owned=owned)


def _sync_book(sheets: Any, store: Any, pace: Pace, f: dict, *, now: float | None = None,
               due: bool = False, owned: bool = False) -> BookResult:
    """One workbook → the mirror, atomically; an owned book keeps its repeated headers' columns and its header order."""
    now = time.time() if now is None else now
    sid, name, mtime = f["id"], f.get("name") or "", f.get("modifiedTime") or ""
    held = store.titles(sid)
    giants = store.giants(sid) if held else {}
    fetched: list[str] | None = None
    if held is None or now - held[1] >= TITLES_EVERY_S:
        fetched = _read_titles(sheets, pace, sid)
        titles = fetched
    else:
        titles = held[0]

    def owed(ts: list[str]) -> set[str] | None:
        if not due:
            return None
        out = {t for t, st in giants.items()
               if t in ts and now - float(st["whole_at"] or 0.0) >= WHOLE_EVERY_S}
        if fetched is not None and held is not None:
            out |= {t for t in ts if t not in held[0]}   # a tab the list just showed
        return out

    def ranges_of(p: list[tuple[str, str, dict | None]]) -> list[str]:
        out: list[str] = []
        for t, how, st in p:
            out += [_quote(t)] if how == "whole" else tail_ranges(t, st)
        return out

    plan = _plan(titles, giants, now, owed(titles))
    try:
        values = _batch(sheets, pace, sid, ranges_of(plan)) if plan else []
    except Exception as exc:  # noqa: BLE001
        # A RANGE THE BOOK NO LONGER HAS: a tab renamed or deleted (the held list is stale) or columns deleted under…
        if not _is_range_error(exc):
            raise
        fetched = titles = _read_titles(sheets, pace, sid)
        giants = {t: {**s, "whole_at": 0.0} for t, s in giants.items() if t in titles}
        plan = _plan(titles, giants, now, set(titles) if due else None)
        values = _batch(sheets, pace, sid, ranges_of(plan)) if plan else []

    change = BookChange(sid=sid, name=name, mtime=mtime, titles=fetched, headers={} if owned else None)
    result = BookResult()
    rewhole: list[str] = []
    cursor = 0
    for t, how, st in plan:
        if how == "whole":
            rows, state = whole_tab(values[cursor], now, owned)
            if owned:
                change.headers[t] = None if state is not None else header_record(values[cursor], rows, now)
            cursor += 1
            change.replace[t] = rows
            if state is not None or t in giants:
                change.giants[t] = state
            result.whole_tabs += 1
            result.giant_whole += 1 if t in giants else 0
            continue
        head, tail = values[cursor], values[cursor + 1]
        cursor += 2
        mirrored = store.rows_in(sid, t, mirror_windows(st))
        verdict = tail_verdict(st, head, tail, mirrored, owned)
        if verdict.ok:
            change.append[t] = verdict.appended
            change.giants[t] = {**st, "extent": verdict.extent,
                                "rows": int(st.get("rows") or 0) + len(verdict.appended),
                                "dirty_since": None}
            result.tail_tabs += 1
            result.appended += len(verdict.appended)
        elif now - float(st["whole_at"] or 0.0) >= WHOLE_EVERY_S:
            rewhole.append(t)
        else:
            # KNOWN STALE, SAID SO: the whole read waits for its turn and the due sweep brings it; readers are told…
            change.giants[t] = {**st, "dirty_since": st.get("dirty_since") or now}
            result.dirty += 1
            log.info("sheet-sync: %s / %s — %s; read whole when its turn comes",
                     name[:40], t[:40], verdict.why)
    if rewhole:
        for t, matrix in zip(rewhole, _batch(sheets, pace, sid, [_quote(t) for t in rewhole])):
            rows, state = whole_tab(matrix, now, owned)
            if owned:
                change.headers[t] = None if state is not None else header_record(matrix, rows, now)
            change.replace[t] = rows
            change.giants[t] = state
            result.whole_tabs += 1
            result.giant_whole += 1

    parsed = sum(len(r) for r in change.replace.values())
    if not due and plan and not result.tail_tabs and not result.dirty and parsed == 0:
        # A FETCH THAT PARSED TO NOTHING must not wipe a prior good copy — but a book that never HAD a copy is just…
        if store.prior_count(sid):
            raise RuntimeError("parsed to 0 usable rows — refusing to wipe the prior mirror")
    result.tabs, result.rows = store.apply(change)
    return result


# ═══════════════════════════════════════════════════════════════════════════ One pass…
def _list_changed(drive: Any, stamp: str) -> list[dict]:
    changed: list[dict] = []
    tok = None
    while True:
        resp = drive.files().list(
            q=f"mimeType='{SPREADSHEET_MIME}' and trashed=false and modifiedTime > '{stamp}'",
            fields="nextPageToken, files(id,name,modifiedTime,parents)",
            pageSize=200, pageToken=tok,
            includeItemsFromAllDrives=True, supportsAllDrives=True).execute()
        changed.extend(resp.get("files", []))
        tok = resp.get("nextPageToken")
        if not tok:
            break
    return changed


def keep_out_ids(store: Any, now: float) -> frozenset[str]:
    """The ids the mirror never copies (KEEP_OUT_POINTERS and the env list), asked of the store at most every…"""
    if _KEEP_OUT["at"] and now - float(_KEEP_OUT["at"]) < KEEP_OUT_EVERY_S:
        return _KEEP_OUT["ids"]
    ids = {s.strip() for s in os.getenv("HUB_SHEET_SYNC_KEEP_OUT_IDS", "").split(",") if s.strip()}
    ask = getattr(store, "pointer_ids", None)
    if ask is None:
        _KEEP_OUT.update(at=now, ids=frozenset(ids))
        return _KEEP_OUT["ids"]
    try:
        ids |= set(ask(KEEP_OUT_POINTERS))
    except Exception as exc:  # noqa: BLE001 — the ids read last stand; asked again next pass
        log.warning("sheet-sync: the kept-out pointers could not be read (%s) — the ids read last "
                    "stand", type(exc).__name__)
        return frozenset(set(_KEEP_OUT["ids"]) | ids)
    _KEEP_OUT.update(at=now, ids=frozenset(ids))
    return _KEEP_OUT["ids"]


def owned_ids(store: Any, now: float) -> frozenset[str]:
    """The books the Hub owns (OWNED_POINTERS and the env list), asked of the store at most every KEEP_OUT_EVERY_S."""
    if _OWNED["at"] and now - float(_OWNED["at"]) < KEEP_OUT_EVERY_S:
        return _OWNED["ids"]
    ids = {s.strip() for s in os.getenv("HUB_SHEET_SYNC_OWNED_IDS", "").split(",") if s.strip()}
    ask = getattr(store, "owned_ids", None)
    if ask is not None:
        try:
            ids |= set(ask())
        except Exception as exc:  # noqa: BLE001 — the ids read last stand; asked again next pass
            log.warning("sheet-sync: the owned books' pointers could not be read (%s) — the ids read last stand",
                        type(exc).__name__)
            return frozenset(set(_OWNED["ids"]) | ids)
    _OWNED.update(at=now, ids=frozenset(ids))
    return _OWNED["ids"]


def kept_books(store: Any, owned: frozenset[str], busy: set[str], room: int, now: float,
               shut_ids: frozenset[str] | set[str]) -> list[dict]:
    """Owned books no read of this pass covers, unread for OWNED_EVERY_S, longest first, as many as the pass has room for."""
    stale = sorted((float(_OWNED["read"].get(sid, 0.0)), sid) for sid in owned
                   if sid not in busy and now - float(_OWNED["read"].get(sid, 0.0)) >= OWNED_EVERY_S)
    ask = getattr(store, "books", None)
    if not stale or room <= 0 or ask is None:
        return []
    try:
        known = ask([sid for _at, sid in stale])
    except Exception as exc:  # noqa: BLE001 — read on a later pass
        log.warning("sheet-sync: the owned books could not be named (%s)", type(exc).__name__)
        return []
    out = [known[sid] for _at, sid in stale if sid in known and not kept_out(known[sid], shut_ids)]
    return out[:room]


def ruled_books(store: Any, busy: set[str], room: int, shut_ids: frozenset[str] | set[str]) -> list[dict]:
    """Books whose copy predates what the rule now keeps of them (redaction BOOK_KEPT_COLUMNS / BOOK_KEPT_FACTS): read
    once more under it, whatever Drive's modifiedTime says; a book found clean is not asked again by this process."""
    held, ask = getattr(store, "held_bare", None), getattr(store, "books", None)
    if room <= 0 or held is None or ask is None:
        return []
    wanted = {sid: sorted(set(cols) | set(redaction.BOOK_KEPT_FACTS.get(sid, {})))
              for sid, cols in redaction.BOOK_KEPT_COLUMNS.items()}
    wanted.update({sid: sorted(cols) for sid, cols in redaction.BOOK_KEPT_FACTS.items() if sid not in wanted})
    # a book whose SSN# has no fingerprint beside it yet, now that the salt is here
    printed = set(fingerprint_books()) if pii_salt() else set()
    unprinted = getattr(store, "unprinted", None)
    due: list[str] = []
    for sid, cols in wanted.items():
        if sid in busy or sid in _RULED["clean"]:
            continue
        try:
            if held(sid, cols) or (sid in printed and unprinted is not None and unprinted(sid)):
                due.append(sid)
            else:
                _RULED["clean"].add(sid)
        except Exception as exc:  # noqa: BLE001 — asked again next pass
            log.warning("sheet-sync: a book's copy could not be checked against the rule (%s)", type(exc).__name__)
    if not due:
        return []
    try:
        known = ask(due)
    except Exception as exc:  # noqa: BLE001 — read on a later pass
        log.warning("sheet-sync: the ruled books could not be named (%s)", type(exc).__name__)
        return []
    return [known[sid] for sid in due if sid in known and not kept_out(known[sid], shut_ids)][:room]


def kept_out(f: dict, ids: frozenset[str] | set[str]) -> bool:
    """Is this listed book one the mirror never copies?"""
    return ((f.get("id") or "") in ids or str(f.get("name") or "").strip() in KEEP_OUT_TITLES
            or bool(set(f.get("parents") or []) & KEEP_OUT_PARENTS))


def next_watermark(old: datetime, landed: list[str], owed: list[str]) -> datetime | None:
    """THE WATERMARK NEVER PASSES A BOOK STILL OWED — and never stays behind the books that landed."""
    if not landed:
        return None
    candidate = max(_ts(m) for m in landed)
    if owed:
        candidate = min(candidate, min(_ts(m) for m in owed) - 0.001)
    if candidate <= _ts(old):
        return None
    return datetime.fromtimestamp(candidate, timezone.utc)


# ═══════════════════════════════════════════════════════════════════════════ The house calendars' grids…
def _hex(color: Any) -> str:
    """A Sheets colour as getBackgrounds() names it ('#rrggbb'); white when none is set."""
    if not isinstance(color, dict):
        return GRID_WHITE
    parts = [max(0, min(255, int(round(float(color.get(k) or 0.0) * 255)))) for k in ("red", "green", "blue")]
    return "#" + "".join(f"{p:02x}" for p in parts)


def _background(cell: dict) -> str:
    fmt = cell.get("userEnteredFormat") or {}
    if isinstance(fmt.get("backgroundColor"), dict):
        return _hex(fmt["backgroundColor"])
    style = fmt.get("backgroundColorStyle") or {}
    return _hex(style.get("rgbColor")) if isinstance(style.get("rgbColor"), dict) else GRID_WHITE


def _serial_day(cell: dict) -> str:
    """A cell getValues() hands back as a Date: its day, 'yyyy-MM-dd'; '' for anything else."""
    kind = ((cell.get("effectiveFormat") or {}).get("numberFormat") or {}).get("type")
    number = (cell.get("effectiveValue") or {}).get("numberValue")
    if kind not in ("DATE", "DATE_TIME") or not isinstance(number, (int, float)):
        return ""
    try:
        return (_GRID_EPOCH + timedelta(days=int(number // 1))).strftime("%Y-%m-%d")
    except (OverflowError, ValueError):
        return ""


def _rows_of(sheet: dict) -> list[list[dict]]:
    out: list[list[dict]] = []
    for block in sheet.get("data") or []:
        out.extend([list(r.get("values") or []) for r in block.get("rowData") or []])
    return out


def calendar_grid(sheet: dict) -> dict[str, Any]:
    """One CALENDAR tab as getDataRange() reads it: the cells as shown, the real dates, the background of each cell
    that shows something (white left out)."""
    rows = _rows_of(sheet)
    shown = [[str(c.get("formattedValue") or "") for c in r] for r in rows]
    height = max((i + 1 for i, r in enumerate(shown) if any(v != "" for v in r)), default=0)
    width = max((max((j + 1 for j, v in enumerate(r) if v != ""), default=0) for r in shown[:height]), default=0)
    grid: list[list[str]] = []
    dates: list[list[Any]] = []
    colors: list[list[Any]] = []
    for i in range(height):
        line = shown[i][:width]
        while line and line[-1] == "":
            line.pop()
        grid.append(line)
        for j, cell in enumerate(rows[i][:width]):
            day = _serial_day(cell)
            if day:
                dates.append([i, j, day])
            if shown[i][j].strip():
                bg = _background(cell)
                if bg != GRID_WHITE:
                    colors.append([i, j, bg])
    return {"tab": (sheet.get("properties") or {}).get("title") or "", "rows": height, "cols": width,
            "shown": grid, "dates": dates, "colors": colors}


def _live_hex(bg: Any) -> str:
    """A cell's background as '#rrggbb'; white and all-zero (the API's 'no fill') are none."""
    if not bg:
        return ""
    r, g, b = (int(round(float(bg.get(k, 0)) * 255)) for k in ("red", "green", "blue"))
    if (r, g, b) in ((255, 255, 255), (0, 0, 0)):
        return ""
    return f"#{r:02x}{g:02x}{b:02x}"


def _live_day(s: str, this_year: int) -> Any:
    """'5/23' or '5/23/26' as a date: the year the pass's own when none is written, a year on when that lands more
    than 120 days back (the December → January turn); None for anything else."""
    m = _LIVE_MD.match((s or "").strip())
    if not m:
        return None
    mo, da = int(m.group(1)), int(m.group(2))
    yr = m.group(3)
    if yr:
        yr = int(yr)
        yr += 2000 if yr < 100 else 0
    else:
        yr = this_year
    try:
        d = datetime(yr, mo, da).date()
    except ValueError:
        return None
    if m.group(3) is None and (datetime.now(timezone.utc).date() - d).days > 120:
        try:
            d = datetime(yr + 1, mo, da).date()
        except ValueError:
            pass
    return d


def live_grid(sheet: dict, this_year: int) -> dict[str, Any] | None:
    """One house tab as the live copy keeps it: {cols, rows, staff, total_shifts}, each person's line with a cell per
    dated column ({text, color}); None for a tab with no STAFF header or no dated column (a helper tab)."""
    cells = [[{"v": str(c.get("formattedValue") or ""), "c": _live_hex((c.get("effectiveFormat") or {})
                                                                       .get("backgroundColor"))} for c in row]
             for row in _rows_of(sheet)]
    header_idx = staff_col = None
    for ri, row in enumerate(cells):
        for ci, cell in enumerate(row):
            if cell["v"].strip().upper() == "STAFF":
                header_idx, staff_col = ri, ci
                break
        if header_idx is not None:
            break
    if header_idx is None or staff_col is None:
        return None
    header = cells[header_idx]
    date_cols = [(ci, d) for ci in range(staff_col + 1, len(header))
                 for d in [_live_day(header[ci]["v"], this_year)] if d]
    if not date_cols:
        return None
    weekday_row = cells[header_idx - 1] if header_idx > 0 else []
    cols = [{"date": d.strftime("%-m/%-d"), "iso": d.isoformat(),
             "weekday": (weekday_row[ci]["v"].strip() if ci < len(weekday_row) else "") or d.strftime("%a"),
             "short": d.strftime("%b %-d")} for ci, d in date_cols]
    grid_rows = []
    for row in cells[header_idx + 1:]:
        name = row[staff_col]["v"].strip() if staff_col < len(row) else ""
        if not name or name.upper() == "STAFF":
            continue
        out_cells, nonempty = [], 0
        for ci, _d in date_cols:
            txt, color = (row[ci]["v"].strip(), row[ci]["c"]) if ci < len(row) else ("", "")
            nonempty += 1 if txt else 0
            out_cells.append({"text": txt, "color": color or "transparent"})
        if nonempty:
            grid_rows.append({"employee": name, "total": nonempty, "cells": out_cells})
    return {"cols": cols, "rows": grid_rows, "staff": len(grid_rows),
            "total_shifts": sum(r["total"] for r in grid_rows)}


def read_live(sheets: Any, pace: Pace, sid: str) -> dict[str, dict[str, Any]]:
    """The live workbook: house tab title → its grid, with its gid. Each tab's values first (they stop at the last
    cell that shows something), then its grid with backgrounds inside that box alone, LIVE_TABS_PER_READ tabs a read:
    a whole tab's empty cells, each carrying its background, make an answer the client refuses to inflate."""
    titles = _read_titles(sheets, pace, sid)
    boxes = [f"{_quote(t)}!A1:{_col_letter(max(len(r) for r in rows))}{len(rows)}"
             for t, rows in zip(titles, _batch(sheets, pace, sid, [_quote(t) for t in titles]))
             if rows and max(len(r) for r in rows)]
    this_year = datetime.now(timezone.utc).year
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(boxes), LIVE_TABS_PER_READ):
        got = _ask(pace, lambda part=boxes[i:i + LIVE_TABS_PER_READ]: sheets.spreadsheets().get(
            spreadsheetId=sid, ranges=part, includeGridData=True,
            fields=f"sheets(properties(title,sheetId),data(rowData(values({_LIVE_CELL}))))"))
        for sheet in got.get("sheets") or []:
            props = sheet.get("properties") or {}
            grid = live_grid(sheet, this_year)
            if grid is not None:
                out[props.get("title") or ""] = {**grid, "gid": props.get("sheetId")}
    return out


def index_links(sheets_data: list[dict]) -> dict[str, Any]:
    """The index book's cells that link a book (reconCalendarLinks_): each with its text and its link, every tab in
    order; the reader takes the link first, then a URL typed as the text."""
    out: list[list[Any]] = []
    for sheet in sheets_data:
        tab = (sheet.get("properties") or {}).get("title") or ""
        for i, row in enumerate(_rows_of(sheet)):
            for j, cell in enumerate(row):
                label = str(cell.get("formattedValue") or "").strip()
                link = str(cell.get("hyperlink") or "")
                if not link:
                    runs = {str(((r.get("format") or {}).get("link") or {}).get("uri") or "")
                            for r in cell.get("textFormatRuns") or []}
                    runs.discard("")
                    link = runs.pop() if len(runs) == 1 else ""
                if link or GRID_LINK.search(label):
                    out.append([tab, i, j, label, link])
    return {"links": out}


def linked_ids(cells: dict | None, index_id: str) -> list[str]:
    """The books the index links, in its order, the index itself left out."""
    seen: list[str] = []
    for _tab, _i, _j, label, link in (cells or {}).get("links") or []:
        for url in (link, label):
            m = GRID_LINK.search(str(url or ""))
            if not m:
                continue
            if m.group(1) != index_id and m.group(1) not in seen:
                seen.append(m.group(1))
            break
    return seen


class GridStore:
    """app.sheet_grids in asa-hub-db, written as the relay's lane role (GRID_DSN): one connection a pass, closed after
    it, each book's grid its own commit."""

    def __init__(self, dsn: str = "", table: str = GRID_TABLE, connect: Callable[[], Any] | None = None) -> None:
        self.dsn = dsn or GRID_DSN
        self.table = table
        self.connect = connect
        self._c: Any = None

    def _run(self, statements: list[tuple[str, tuple]], fetch: bool = False) -> Any:
        """The statements in one transaction; the last one's rows (fetch) or its row count."""
        if self.connect is not None:
            conn = self.connect()
        else:
            if self._c is None or self._c.closed:
                self._c = psycopg2.connect(self.dsn)
            conn = self._c
        try:
            with conn.cursor() as cur:
                for sql, params in statements:
                    cur.execute(sql, params)
                got = cur.fetchall() if fetch else cur.rowcount
            if self.connect is None:
                conn.commit()
            return got
        except Exception:
            if self.connect is None:
                conn.rollback()
            raise

    def close(self) -> None:
        if self._c is not None:
            try:
                self._c.close()
            except Exception:  # noqa: BLE001 - a dead connection closes as it can
                pass
            self._c = None

    def held(self) -> dict[str, dict[str, Any]]:
        """sheet id → {kind, tab, modified (epoch), cells for the index}."""
        got = self._run([(f"select sheet_id, tab_name, kind, extract(epoch from modified_time),"  # noqa: S608
                          f" case when kind = 'links' then cells end from {self.table}", ())], fetch=True)
        return {sid: {"tab": tab, "kind": kind, "modified": float(mt or 0.0),
                      "cells": cells if isinstance(cells, dict) else (json.loads(cells) if cells else None)}
                for sid, tab, kind, mt, cells in got}

    def put(self, sid: str, tab: str, kind: str, cells: dict, modified: str) -> None:
        self._run([(f"delete from {self.table} where sheet_id = %s and tab_name <> %s", (sid, tab)),  # noqa: S608
                   (f"insert into {self.table} (sheet_id, tab_name, kind, cells, modified_time, read_at)"  # noqa: S608
                    " values (%s, %s, %s, %s::jsonb, %s, now()) on conflict (sheet_id, tab_name) do update set"
                    " kind = excluded.kind, cells = excluded.cells, modified_time = excluded.modified_time,"
                    " read_at = excluded.read_at", (sid, tab, kind, json.dumps(cells), modified or None))])

    def live_stamp(self) -> tuple[float, int]:
        """The live copy's newest read (epoch) and how many houses it holds."""
        got = self._run([(f"select extract(epoch from max(updated_at)), count(*) from {LIVE_TABLE}", ())],  # noqa: S608
                        fetch=True)
        return (float(got[0][0] or 0.0), int(got[0][1] or 0)) if got else (0.0, 0)

    def put_live(self, tabs: dict[str, dict[str, Any]]) -> int:
        """Every house read, in one commit: each upserted with this read's stamp, a house no longer in the workbook
        gone."""
        now = datetime.now(timezone.utc)
        statements = [(f"insert into {LIVE_TABLE} (location, gid, grid, updated_at)"  # noqa: S608
                       " values (%s, %s, %s::jsonb, %s) on conflict (location) do update set gid = excluded.gid,"
                       " grid = excluded.grid, updated_at = excluded.updated_at",
                       (loc, grid.get("gid"), json.dumps({k: v for k, v in grid.items() if k != "gid"}), now))
                      for loc, grid in tabs.items()]
        statements.append((f"delete from {LIVE_TABLE} where location <> all(%s)", (list(tabs),)))  # noqa: S608
        self._run(statements)
        return len(tabs)

    def keep_only(self, ids: list[str]) -> int:
        return int(self._run([(f"delete from {self.table} where not (sheet_id = any(%s))",  # noqa: S608
                               (list(ids),))]) or 0)


def grid_store() -> GridStore | None:
    """The one GridStore of this process; None (said once) when the lane role's door into asa-hub-db is not set."""
    if _GRIDS["store"] is None and GRID_DSN and psycopg2 is not None:
        _GRIDS["store"] = GridStore()
    if _GRIDS["store"] is None and not _GRIDS["said"]:
        _GRIDS["said"] = True
        log.info("sheet-sync: HUB_HOUSE_MEDS_DSN is not set — the house calendars' grids are not kept")
    return _GRIDS["store"]


def read_grid(sheets: Any, store: Any, pace: Pace, sid: str, kind: str) -> tuple[str, dict]:
    """One book read for its grid: the index's every tab (links), the master's New Calendar (master), or the CALENDAR
    tab — else the first — as shown."""
    if kind == "master":
        got = _ask(pace, lambda: sheets.spreadsheets().get(
            spreadsheetId=sid, ranges=[f"{_quote(MASTER_GRID_TAB)}!{MASTER_GRID_RANGE}"], includeGridData=True,
            fields=f"sheets(properties(title),data(rowData(values({_GRID_CELL}))))"))
        sheets_data = got.get("sheets") or []
        if not sheets_data:
            raise RuntimeError("the master book answered with no grid")
        return MASTER_GRID_TAB, calendar_grid(sheets_data[0])
    if kind == "links":
        got = _ask(pace, lambda: sheets.spreadsheets().get(
            spreadsheetId=sid, includeGridData=True,
            fields=f"sheets(properties(title),data(rowData(values({_LINK_CELL}))))"))
        sheets_data = got.get("sheets") or []
        return ((sheets_data[0].get("properties") or {}).get("title") or "" if sheets_data else ""), \
            index_links(sheets_data)
    held = store.titles(sid) if hasattr(store, "titles") else None
    titles = held[0] if held else _read_titles(sheets, pace, sid)
    for attempt in range(2):
        tab = GRID_TAB if GRID_TAB in titles else titles[0]
        try:
            got = _ask(pace, lambda: sheets.spreadsheets().get(
                spreadsheetId=sid, ranges=[_quote(tab)], includeGridData=True,
                fields=f"sheets(properties(title),data(rowData(values({_GRID_CELL}))))"))
        except Exception as exc:  # noqa: BLE001
            if attempt or not _is_range_error(exc):
                raise
            titles = _read_titles(sheets, pace, sid)
            continue
        sheets_data = got.get("sheets") or []
        if not sheets_data:
            raise RuntimeError("the book answered with no grid")
        return tab, calendar_grid(sheets_data[0])
    raise RuntimeError("unreachable")  # pragma: no cover


def _app_token() -> str:
    held = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".hub-app-token")
    return os.getenv("HUB_APP_TOKEN", "") or (open(held).read().strip() if os.path.isfile(held) else "")


def tell_app(names: list[str] | tuple[str, ...]) -> None:
    """Never raises: asa-hub-app's /notify, so the slices read off a grid just kept are rebuilt now, and its master
    record's sync once the master grid was kept."""
    import urllib.request  # noqa: PLC0415

    slices = [n for n in names if n != MASTER_SYNC]
    asks: list[tuple[str, dict[str, Any], dict[str, str]]] = []
    if MASTER_SYNC in names:
        asks.append(("/calendar-builder/master-sync", {}, {"x-hub-token": _app_token()}))
    if slices:
        asks.append(("/notify", {"resources": slices}, {}))
    for path, body, headers in asks:
        try:
            req = urllib.request.Request(HUB_APP_URL + path, data=json.dumps(body).encode(),
                                         headers={"content-type": "application/json", **headers}, method="POST")
            with urllib.request.urlopen(req, timeout=5):  # noqa: S310 - asa-hub-app's own address
                pass
        except Exception as exc:  # noqa: BLE001 - the app's floor rebuilds them; its record looks daily
            log.warning("sheet-sync: asa-hub-app was not told of the grids kept at %s (%s)", path,
                        type(exc).__name__)


def keep_grids(sheets: Any, store: Any, grids: Any, pace: Pace, shut_ids: frozenset[str] | set[str],
               budget: int = GRIDS_PER_PASS, tell: Callable[[list[str]], None] = tell_app) -> dict[str, int]:
    """The master grid, the index's links, then each linked book's CALENDAR grid, each read again once the mirror says
    the book moved past the grid kept (at most `budget` house books a pass); a book no longer linked leaves the table,
    and the slices read off the grids kept are told to asa-hub-app. A quota refusal stops."""
    out = {"grids": 0, "grid_errors": 0, "grids_dropped": 0, "master_grids": 0, "calendar_grids": 0}
    if grids is None:
        return out
    try:
        return _keep_grids(sheets, store, grids, pace, shut_ids, budget, out)
    finally:
        names = ([MASTER_SYNC] if out["master_grids"] else []) + \
            (list(CALENDAR_GRID_SLICES) if out["calendar_grids"] else [])
        if names:
            tell(names)


def _keep_grids(sheets: Any, store: Any, grids: Any, pace: Pace, shut_ids: frozenset[str] | set[str],
                budget: int, out: dict[str, int]) -> dict[str, int]:
    held = grids.held()
    master = [MASTER_GRID_ID] if MASTER_GRID_ID else []
    books = store.books(master) if master else {}
    master = [sid for sid in master if not kept_out(books.get(sid) or {"id": sid}, shut_ids)]

    def due(sid: str) -> bool:
        have = held.get(sid)
        mt = _ts((books.get(sid) or {}).get("modifiedTime"))
        return have is None or (mt > 0 and mt > float(have["modified"] or 0.0))

    def read(sid: str, kind: str) -> bool:
        """One book's grid kept; False when the quota shut."""
        try:
            tab, cells = read_grid(sheets, store, pace, sid, kind)
            grids.put(sid, tab, kind, cells, (books.get(sid) or {}).get("modifiedTime") or "")
            held[sid] = {"tab": tab, "kind": kind, "modified": 0.0, "cells": cells if kind == "links" else None}
            out["grids"] += 1
            if kind in ("master", "calendar"):
                out[f"{kind}_grids"] += 1
        except QuotaShut:
            log.warning("sheet-sync: quota window shut while reading the calendars' grids — the rest next pass")
            return False
        except Exception as exc:  # noqa: BLE001 — one book's grid never stops the others
            out["grid_errors"] += 1
            log.warning("sheet-sync: the grid of %s… could not be read: %s", sid[:12],
                        f"{type(exc).__name__}: {str(exc)[:160]}")
        return True

    going = True
    for sid in [s for s in master if due(s)]:
        going = read(sid, "master")
    try:
        index = sorted(store.pointer_ids((GRID_INDEX_POINTER,)))
    except Exception as exc:  # noqa: BLE001 — asked again next pass
        log.warning("sheet-sync: the calendar index pointer could not be read (%s)", type(exc).__name__)
        return out
    if not index:
        return out
    index_id = index[-1]
    books.update(store.books([index_id]))
    if going and due(index_id) and not kept_out(books.get(index_id) or {"id": index_id}, shut_ids):
        going = read(index_id, "links")
    if index_id not in held:
        return out
    linked = linked_ids(held[index_id].get("cells"), index_id)
    books.update(store.books(linked))
    houses = [sid for sid in linked if sid not in master and not kept_out(books.get(sid) or {"id": sid}, shut_ids)]
    for sid in [s for s in houses if due(s)][: max(0, budget)]:
        if not going:
            break
        going = read(sid, "calendar")
    out["grids_dropped"] = grids.keep_only(master + [index_id] + houses)
    if out["grids"] or out["grids_dropped"]:
        log.info("sheet-sync: %d calendar grid(s) read, %d dropped, %d failed", out["grids"], out["grids_dropped"],
                 out["grid_errors"])
    return out


def keep_live(sheets: Any, store: Any, grids: Any, pace: Pace, shut_ids: frozenset[str] | set[str],
              tell: Callable[[list[str]], None] = tell_app, now: Callable[[], float] = time.time) -> dict[str, int]:
    """The house calendars' live copy, read again once the workbook moved past it or LIVE_EVERY_S after the last read;
    the shift slices laid over it are told to asa-hub-app. A refusal keeps the copy as it stands."""
    out = {"live_houses": 0, "live_errors": 0}
    if grids is None or not LIVE_BOOK_ID:
        return out
    book = store.books([LIVE_BOOK_ID]).get(LIVE_BOOK_ID) or {"id": LIVE_BOOK_ID}
    if kept_out(book, shut_ids):
        return out
    read_at, houses = grids.live_stamp()
    if houses and _ts(book.get("modifiedTime")) <= read_at and now() - read_at < LIVE_EVERY_S:
        return out
    try:
        tabs = read_live(sheets, pace, LIVE_BOOK_ID)
    except QuotaShut:
        log.warning("sheet-sync: quota window shut before the house calendars' live copy — next pass")
        return out
    except Exception as exc:  # noqa: BLE001 — the copy kept stands until a read lands
        out["live_errors"] = 1
        log.warning("sheet-sync: the house calendars' live copy could not be read: %s",
                    f"{type(exc).__name__}: {str(exc)[:160]}")
        return out
    if not tabs:
        out["live_errors"] = 1
        log.warning("sheet-sync: the live workbook answered with no house tab — the copy kept stands")
        return out
    out["live_houses"] = grids.put_live(tabs)
    log.info("sheet-sync: the house calendars' live copy read again (%d houses)", out["live_houses"])
    tell(list(CALENDAR_GRID_SLICES))
    return out


def one_pass(drive: Any = None, sheets: Any = None, store: Any = None,
             pace: Pace | None = None, now: Callable[[], float] = time.time, grids: Any = None) -> dict[str, Any]:
    if drive is None or sheets is None:
        drive, sheets = _clients()
    store = store or PgStore()
    pace = pace or Pace()
    listed_at = now()
    old = store.watermark()
    mark = old - timedelta(seconds=WATERMARK_LAP_S)
    stamp = mark.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    listed = _list_changed(drive, stamp)
    # KEPT OUT BEFORE ANYTHING IS ASKED OF THEM (KEEP_OUT_TITLES): never read, never held, and nothing owed — their…
    record = record_ids(listed_at)
    shut_ids = frozenset(keep_out_ids(store, listed_at) | record)
    shut_out = [f for f in listed if kept_out(f, shut_ids)]
    if shut_out:
        listed = [f for f in listed if not kept_out(f, shut_ids)]
        for f in shut_out:
            if f.get("id") not in _KEEP_OUT["said"] and f.get("id") not in record:
                _KEEP_OUT["said"].add(f.get("id"))
                log.info("sheet-sync: %s (%s) is kept out of the mirror — it carries client data "
                         "the mirror's readers may not hold", (f.get("name") or "?")[:40],
                         (f.get("id") or "")[:12])
    held = store.known([f["id"] for f in listed])
    work, failing, current = [], [], []
    for f in listed:
        mt = _ts(f.get("modifiedTime"))
        hit = held.get(f["id"])
        if hit and hit[1] == "ok" and mt and hit[0] >= mt:
            current.append(f)
        elif hit and hit[1] == "error":
            failing.append(f)
        else:
            work.append(f)
    # A BOOK THAT KEEPS FAILING NEVER HOLDS THE PLACES OF THE OTHERS.
    work.sort(key=lambda f: (_ts(f.get("modifiedTime")), f["id"]))
    failing.sort(key=lambda f: (held[f["id"]][2], _ts(f.get("modifiedTime")), f["id"]))
    retry = min(len(failing), max(0, RETRY_FAILED_PER_PASS), max(0, BOOKS_PER_PASS - len(work)))
    todo = work[:BOOKS_PER_PASS] + failing[:retry]
    deferred = work[BOOKS_PER_PASS:] + failing[retry:]
    try:
        due = [f for f in store.due(listed_at, {f["id"] for f in work + failing})
               if not kept_out(f, shut_ids)][: max(0, BOOKS_PER_PASS - len(todo))]
    except Exception as exc:  # noqa: BLE001 — the owed whole reads wait for the next pass
        log.warning("sheet-sync: the due sweep could not be asked (%s)", type(exc).__name__)
        due = []
    owned = owned_ids(store, listed_at)
    kept = kept_books(store, owned, {f["id"] for f in todo + due + deferred},
                      BOOKS_PER_PASS - len(todo) - len(due), listed_at, shut_ids)
    ruled = ruled_books(store, {f["id"] for f in todo + due + deferred + kept},
                        BOOKS_PER_PASS - len(todo) - len(due) - len(kept), shut_ids)

    stats = collections.Counter()
    landed = [f.get("modifiedTime") or "" for f in current + shut_out]
    owed = [f.get("modifiedTime") or "" for f in deferred]
    pending = [f["id"] for f in deferred]
    shut = False
    queue = ([(f, "listed") for f in todo] + [(f, "due") for f in due] + [(f, "kept") for f in kept]
             + [(f, "ruled") for f in ruled])
    for i, (f, kind) in enumerate(queue):
        # an owed or owned read never moves the watermark and is never owed by it
        is_due = kind != "listed"
        mt = f.get("modifiedTime") or ""
        if shut:
            if not is_due:
                owed.append(mt)
                pending.append(f["id"])
            continue
        try:
            # WHAT THIS BOOK HAD WITHHELD, counted by the one place that can see it: the redaction runs a cell at a…
            held_before = _withheld_so_far["cells"]
            r = sync_book(sheets, store, pace, f, now=now(), due=kind == "due", owned=f["id"] in owned)
            if f["id"] in owned:
                _OWNED["read"][f["id"]] = now()
            if _withheld_so_far["cells"] > held_before:
                stats["withheld"] += _withheld_so_far["cells"] - held_before
                stats["withheld_books"] += 1
            stats["books"] += 1
            stats["kept"] += 1 if kind == "kept" else 0
            if kind == "ruled":
                _RULED["clean"].add(f["id"])
                stats["ruled"] += 1
            stats["rows"] += r.rows
            stats["tail_tabs"] += r.tail_tabs
            stats["whole_tabs"] += r.whole_tabs
            stats["giant_whole"] += r.giant_whole
            stats["dirty"] += r.dirty
            stats["appended"] += r.appended
            if not is_due:
                landed.append(mt)
        except Exception as exc:  # noqa: BLE001 — one broken book never stops the pass
            stats["errors"] += 1
            if not is_due:
                owed.append(mt)
                pending.append(f["id"])
            log.warning("sheet-sync: %s (%s) failed: %s",
                        (f.get("name") or "?")[:40], (f.get("id") or "")[:12],
                        f"{type(exc).__name__}: {str(exc)[:160]}")
            if isinstance(exc, QuotaShut):
                # THE BUCKET SHUT, NOT THE BOOK: its copy is not marked failed (that is what sends a book to the…
                shut = True
                log.warning("sheet-sync: quota window shut — %d book(s) left to the next pass,"
                            " every one already landed kept", len(queue) - i - 1)
                continue
            if f.get("id") in owned:
                _OWNED["read"][f["id"]] = now()
            store.mark_error(f.get("id") or "", f.get("name") or "", mt, repr(exc))
            if _is_gone(exc):
                # Deleted or unshared: nothing is owed a book nobody can read.
                try:
                    store.forget(f.get("id") or "")
                except Exception as exc2:  # noqa: BLE001 - asked again on its next failure
                    log.warning("sheet-sync: a gone book's state could not be dropped (%s)",
                                type(exc2).__name__)
    if not shut:
        # the books' own reads first: a calendar's grid follows the copy of its book
        lane = grids if grids is not None else grid_store()
        try:
            stats.update(keep_grids(sheets, store, lane, pace, shut_ids))
        except Exception as exc:  # noqa: BLE001 — the grids wait for the next pass; the copies stand
            log.warning("sheet-sync: the calendars' grids were not kept (%s: %.120s)", type(exc).__name__, str(exc))
        try:
            stats.update(keep_live(sheets, store, lane, pace, shut_ids))
        except Exception as exc:  # noqa: BLE001 — the live copy waits for the next pass; the one kept stands
            log.warning("sheet-sync: the house calendars' live copy was not kept (%s: %.120s)", type(exc).__name__,
                        str(exc))
        finally:
            if lane is not None and hasattr(lane, "close"):
                lane.close()
    new_mark = next_watermark(old, [m for m in landed if m], [m for m in owed if m])
    store.save_pass(new_mark, stats["books"], stats["errors"], listed_at, pending)
    return {"listed": len(listed), "current": len(current), "kept_out": len(shut_out),
            "books": stats["books"], "kept": stats["kept"], "ruled": stats["ruled"],
            "due": len(due), "deferred": len(pending), "failing": len(failing),
            "rows": stats["rows"], "appended": stats["appended"],
            "tail_tabs": stats["tail_tabs"], "whole_tabs": stats["whole_tabs"],
            "giant_whole": stats["giant_whole"], "dirty": stats["dirty"],
            "withheld": stats["withheld"], "withheld_books": stats["withheld_books"],
            "errors": stats["errors"], "requests": pace.count, "shut": shut, "grids": stats["grids"]}


# The name the relay's older callers and the probes know.
_one_pass = one_pass


class HubStore:
    """What keep_grids and keep_live ask of a store, with no mirror: a book's name, modified time and parents from
    Drive, the depot's pointers from asa-hub-db's own Facts (app.depot_facts, read as HUB_RELAY_DB_DSN's role)."""

    def __init__(self, drive: Any, dsn: str = "") -> None:
        self.drive = drive
        self.dsn = dsn or os.getenv("HUB_RELAY_DB_DSN", "").strip()

    def books(self, ids: list[str]) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for sid in dict.fromkeys(i for i in ids if i):
            try:
                f = self.drive.files().get(fileId=sid, fields="id,name,modifiedTime,parents",
                                           supportsAllDrives=True).execute()
            except Exception as exc:  # noqa: BLE001 — a book Drive does not answer for is asked again next pass
                log.warning("sheet-sync: Drive did not name %s… (%s)", sid[:12], type(exc).__name__)
                continue
            out[sid] = {"id": sid, "name": f.get("name") or "", "modifiedTime": f.get("modifiedTime") or "",
                        "parents": list(f.get("parents") or [])}
        return out

    def pointer_ids(self, sources: tuple[str, ...]) -> set[str]:
        """The ids the depot's pointers name, last row wins."""
        conn = psycopg2.connect(self.dsn, connect_timeout=10)
        try:
            with conn, conn.cursor() as cur:
                cur.execute("select distinct on (cells->>'Source') cells->>'Value' from app.depot_facts"
                            " where removed_at is null and cells->>'Source' = any(%s)"
                            " order by cells->>'Source', position desc", (list(sources),))
                return {str(v).strip() for (v,) in cur.fetchall() if v and str(v).strip()}
        finally:
            conn.close()


# THE MASTER'S RELOAD (Scheduling › House calendars, the operator 2026-10-29): the live copy read between the clock's
# times, on his press, only when the workbook moved past it — a copy as new as the workbook is left as it stands. One
# reader of the calendars at a time in this container: the clock's pass waits for a reload, a reload never waits.
READ_LOCK = os.getenv("HUB_CALENDARS_READ_LOCK", "/tmp/hub-calendars-read.lock")  # noqa: S108 - the container's own


class Reading(RuntimeError):
    """The calendars are being read already: the clock's pass, or another reload."""


@contextlib.contextmanager
def one_reader(wait: bool):
    """This container's one reader of the calendars (an flock on READ_LOCK); Reading at once when not `wait`."""
    with open(READ_LOCK, "a") as fh:
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | (0 if wait else fcntl.LOCK_NB))
        except BlockingIOError as exc:
            raise Reading("the house calendars are being read right now") from exc
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def read_live_now(drive: Any = None, sheets: Any = None, pace: Pace | None = None,
                  now: Callable[[], float] = time.time) -> dict[str, Any]:
    """The master's reload: the workbook's last change against the copy's last read, and the copy read again — every
    house of it — only when the workbook is the newer; nothing else is read. Raises Reading while the calendars are
    being read."""
    with one_reader(wait=False):
        if drive is None or sheets is None:
            drive, sheets = _clients()
        store = HubStore(drive)
        pace = pace or Pace()
        lane = grid_store()
        if lane is None:
            raise RuntimeError("asa-hub-db's grids are not reachable (HUB_SHEET_GRID_DSN / HUB_HOUSE_MEDS_DSN)")
        try:
            book = store.books([LIVE_BOOK_ID]).get(LIVE_BOOK_ID) if LIVE_BOOK_ID else None
            read_at, houses = lane.live_stamp()
            out: dict[str, Any] = {"sheet_at": (book or {}).get("modifiedTime") or "",
                                   "copy_at": _iso(read_at) if read_at else "", "ahead": False, "live_houses": 0,
                                   "live_errors": 0, "why": ""}
            if book is None:
                out.update(live_errors=1, why="Drive did not name the house calendars' workbook")
            elif not houses or _ts(book.get("modifiedTime")) > read_at:
                out["ahead"] = True
                out.update(keep_live(sheets, store, lane, pace, frozenset(keep_out_ids(store, now()) | record_ids(now())),
                                     now=now))
                if out["live_houses"]:
                    lane._run([(f"insert into {KEEPER_STATE} (id, live_read_at) values (1, now())"  # noqa: S608
                                " on conflict (id) do update set live_read_at = excluded.live_read_at", ())])
                    out["copy_at"] = _iso(lane.live_stamp()[0])
                elif not out["live_errors"]:
                    out["why"] = "the workbook is kept out of the keeper's reads"
                else:
                    out["why"] = "the workbook could not be read just now"
        finally:
            lane.close()
    out["requests"] = pace.count
    return out


def grids_pass(drive: Any = None, sheets: Any = None, pace: Pace | None = None,
               now: Callable[[], float] = time.time) -> dict[str, Any]:
    """A pass with the mirror off: the calendars' grids and the house calendars' live copy kept in asa-hub-db, the
    pass stamped in app.sheet_keeper_state — once a reload of the master's has let the calendars go."""
    with one_reader(wait=True):
        return _grids_pass(drive, sheets, pace, now)


def _grids_pass(drive: Any, sheets: Any, pace: Pace | None, now: Callable[[], float]) -> dict[str, Any]:
    if drive is None or sheets is None:
        drive, sheets = _clients()
    store = HubStore(drive)
    pace = pace or Pace()
    stats: dict[str, Any] = {"grids": 0, "grid_errors": 0, "live_houses": 0, "live_errors": 0}
    shut_ids = frozenset(keep_out_ids(store, now()) | record_ids(now()))
    lane = grid_store()
    if lane is None:
        raise RuntimeError("asa-hub-db's grids are not reachable (HUB_SHEET_GRID_DSN / HUB_HOUSE_MEDS_DSN)")
    try:
        try:
            stats.update(keep_grids(sheets, store, lane, pace, shut_ids))
        except Exception as exc:  # noqa: BLE001 — the grids wait for the next pass; the ones kept stand
            stats["grid_errors"] += 1
            log.warning("sheet-sync: the calendars' grids were not kept (%s: %.120s)", type(exc).__name__, str(exc))
        try:
            stats.update(keep_live(sheets, store, lane, pace, shut_ids))
        except Exception as exc:  # noqa: BLE001 — the live copy waits for the next pass; the one kept stands
            stats["live_errors"] += 1
            log.warning("sheet-sync: the house calendars' live copy was not kept (%s: %.120s)", type(exc).__name__,
                        str(exc))
        lane._run([(f"insert into {KEEPER_STATE} (id, last_pass_at, last_pass_grids, last_pass_errors, live_read_at)"
                    " values (1, now(), %s, %s, case when %s then now() end) on conflict (id) do update set"
                    " last_pass_at = excluded.last_pass_at, last_pass_grids = excluded.last_pass_grids,"
                    " last_pass_errors = excluded.last_pass_errors,"
                    f" live_read_at = coalesce(excluded.live_read_at, {KEEPER_STATE}.live_read_at)",
                    (int(stats["grids"]), int(stats["grid_errors"]) + int(stats["live_errors"]),
                     bool(stats["live_houses"])))])
    finally:
        lane.close()
    stats["requests"] = pace.count
    return stats


async def grids_loop(wake: asyncio.Event) -> None:
    """The lane with the mirror off: grids_pass at each of READ_AT, New York time, every day; a wake reads nothing."""
    log.info("sheet-sync: the mirror is off (it left the old platform) — the calendars' grids and the house"
             " calendars' live copy are read into asa-hub-db at %s New York time, never between; the books people"
             " post to are swept by asa-hub-app", ", ".join(sorted(READ_AT)))
    pace = Pace()
    while True:
        at = next_read_at()
        log.info("sheet-sync: the calendars are read next at %s", at.strftime("%Y-%m-%d %H:%M %Z"))
        await asyncio.sleep(max(1.0, (at - datetime.now(NY)).total_seconds()))
        wake.clear()
        # a pass reads at most GRIDS_PER_PASS house books: the read goes on, pass after pass, while one still finds a
        # book that moved, so every calendar that changed is in by the end of its time
        for _ in range(SLOT_PASSES):
            started = time.monotonic()
            pace.count = 0
            try:
                out = await asyncio.to_thread(grids_pass, None, None, pace)
                if out["grids"] or out["live_houses"] or out["grid_errors"] or out["live_errors"]:
                    log.info("sheet-sync: %d grid(s) read, %d house(s) of the live copy, %d error(s), %d request(s)"
                             " in %.1fs", out["grids"], out["live_houses"], out["grid_errors"] + out["live_errors"],
                             out["requests"], time.monotonic() - started)
            except Exception as exc:  # noqa: BLE001 — the pass failed whole; the next time retries
                log.warning("sheet-sync: pass failed (%s: %.120s) — the next time retries",
                            type(exc).__name__, str(exc).splitlines()[0] if str(exc) else "")
                break
            if not out["grids"]:
                break
            await asyncio.sleep(SLOT_GAP_S)


async def sync_loop() -> None:
    """The lane. Started by the snapshot service; never exits, never disables."""
    wake = asyncio.Event()
    try:
        asyncio.get_running_loop().add_signal_handler(signal.SIGUSR1, wake.set)
    except (NotImplementedError, RuntimeError, ValueError) as exc:
        log.warning("sheet-sync: the relay's wake is not heard (%s); passes keep their own clock", type(exc).__name__)
    if not MIRROR_ON:
        await grids_loop(wake)
        return
    store = PgStore()
    try:
        await asyncio.to_thread(store.ensure)
    except Exception as exc:  # noqa: BLE001
        log.warning("sheet-sync: state table ensure failed: %s", exc)
    pace = Pace()
    # THE MASTER JSON (master_json.py): after every pass, the mirror as it now stands is written to the relay's disk…
    master = None
    try:
        import master_json
        source = master_json.PgSource(store.dsn)
        # a book Postgres keeps the record of is written from that record (asa-hub-app), never from the mirror
        if (os.getenv("HUB_MASTER_JSON_RECORD") or "on").strip().lower() not in ("0", "off", "false", "no"):
            source = master_json.RecordSource(source)
        master = master_json.MasterKeeper(source)
    except Exception as exc:  # noqa: BLE001
        log.warning("master-json: not armed (%s: %.120s)", type(exc).__name__, str(exc))
    while True:
        started = time.monotonic()
        # a wake while this pass runs asks for the next one: its listing may have begun before the change
        wake.clear()
        pace.count = 0
        try:
            out = await asyncio.to_thread(one_pass, None, None, store, pace)
            if out["listed"] or out["due"] or out["kept"]:
                log.info("sheet-sync: %d listed (%d already held) → %d book(s) read, %d owed"
                         " whole, %d owned read again, %d read again under the rule; tabs: %d by appends (+%d rows),"
                         " %d whole (%d giant), %d dirty;"
                         " %d row(s) held, %d cell(s) withheld in %d book(s), %d request(s),"
                         " %d error(s), %d left for the next pass in %.1fs",
                         out["listed"], out["current"], out["books"], out["due"], out["kept"], out["ruled"],
                         out["tail_tabs"], out["appended"], out["whole_tabs"],
                         out["giant_whole"], out["dirty"], out["rows"],
                         out["withheld"], out["withheld_books"], out["requests"],
                         out["errors"], out["deferred"], time.monotonic() - started)
        except Exception as exc:  # noqa: BLE001 — the pass failed whole; the next one retries
            # type + first line only: an exception that swallowed a credential value must never reach the log whole…
            log.warning("sheet-sync: pass failed (%s: %.120s) — next pass retries",
                        type(exc).__name__, str(exc).splitlines()[0] if str(exc) else "")
        if master is not None:
            try:
                await asyncio.to_thread(master.round)
            except Exception as exc:  # noqa: BLE001 — the previous round stands; the next pass writes it
                log.warning("master-json: round failed (%s: %.120s) — the next pass tries again",
                            type(exc).__name__, str(exc).splitlines()[0] if str(exc) else "")
        try:
            await asyncio.wait_for(wake.wait(), max(30.0, SYNC_EVERY_S - (time.monotonic() - started)))
            await asyncio.sleep(max(0.0, WAKE_GAP_S - (time.monotonic() - started)))
        except asyncio.TimeoutError:
            pass


if __name__ == "__main__":
 # A PROCESS OF ITS OWN, NEVER A TASK IN THE RELAY'S LOOP ( paid live within the hour): armed as an in-process task…
    logging.basicConfig(level=logging.INFO)
    if "--live-now" in sys.argv[1:]:
        # THE MASTER'S RELOAD, a process of its own spawned by hub_worker.py's /calendars/live-now: its answer is the
        # one line it writes on stdout
        try:
            said = {"status": 200, "data": read_live_now()}
        except Reading:
            said = {"status": 409, "message": "The house calendars are being read right now — try again in a minute."}
        except Exception as exc:  # noqa: BLE001 - the type and its first line only, never a credential
            log.warning("sheet-sync: the master's reload failed (%s: %.120s)", type(exc).__name__,
                        str(exc).splitlines()[0] if str(exc) else "")
            said = {"status": 503, "message": "The house calendars could not be read just now — try again in a minute."}
        print(json.dumps(said), flush=True)
        sys.exit(0)
    # a wake before the loop hears it is a pass on its own clock, never the end of the process
    signal.signal(signal.SIGUSR1, signal.SIG_IGN)
    asyncio.run(sync_loop())
