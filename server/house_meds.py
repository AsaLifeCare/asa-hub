"""HOUSE SUPPLIES — THE PHARMACY'S MEDICATION REPORTS, READ ONCE.
The pharmacy (A Brighter Dawn) drops a "Key Data Points" workbook into one Drive folder every fifteen days…"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import os
import re
import threading
import time
import unicodedata
import zipfile
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Iterable

import psycopg2
import psycopg2.errors
import psycopg2.extras

log = logging.getLogger("hub.house_meds")

# ── the report's shape ──────────────────────────────────────────────────────
SHEET = "KDP"
HEADER = ("Report Start", "Report End", "PatLName", "PatFName", "Physician", "DrugLabelName",
          "Sum of Dispenses", "Last Dispense Dt", "Date Written", "CutoffDt",
          "Total Quantity Written", "Quantity Remaining", "TotalQtyDispensed", "Sig", "Sig cont2",
          "Sig cont3", "FacID", "PatID")
KEYS = ("report_start", "report_end", "last_name", "first_name", "physician", "drug",
        "dispensed_in_period", "last_dispense", "date_written", "cutoff", "qty_written",
        "qty_remaining", "qty_dispensed_to_date", "sig1", "sig2", "sig3", "facility", "patid")
DATE_KEYS = frozenset({"report_start", "report_end", "last_dispense", "date_written", "cutoff"})
NUM_KEYS = frozenset({"dispensed_in_period", "qty_written", "qty_remaining", "qty_dispensed_to_date"})
LABEL = dict(zip(KEYS, HEADER))

# A verdict of `invalid` names the parser that gave it: a folder file judged invalid by an older version is read…
PARSER_VERSION = 1

# ── the lane ──────────────────────────────────────────────────────────────── The pharmacy is bound to the source…
PHARMACY = os.getenv("HUB_HOUSE_MEDS_PHARMACY", "A Brighter Dawn").strip() or "A Brighter Dawn"
FOLDER_ID = os.getenv("HUB_HOUSE_MEDS_FOLDER_ID", "1DMU5OIAC-QChkNgGJsZKw7n3IqN9Im-G").strip()
SWEEP_S = float(os.getenv("HUB_HOUSE_MEDS_SWEEP_S", "21600"))
LOCK_NS = int(os.getenv("HUB_HOUSE_MEDS_LOCK_NS", "8221"))
# The lock keys are hashed with the schema the connection writes in, so a test schema never waits on (or holds up)…
LANE_KEY = "lane"     # every decision and every commit
FOLDER_KEY = "folder"  # one folder read at a time
MAX_BYTES = 5 * 1024 * 1024
# What the zip may unpack to: openpyxl holds every shared string in memory, so a small file that unpacks huge is…
MAX_UNZIPPED = 40 * 1024 * 1024
MAX_MEMBERS = 200
# A PatID is matched by name only when the pharmacy filed it under one of these facilities at least once: a…
AUTO_FACILITIES = frozenset(f.strip().upper() for f in os.getenv(
    "HUB_HOUSE_MEDS_AUTO_FACILITIES", "ASLIFE").split(",") if f.strip())
FOLDER_BATCH = int(os.getenv("HUB_HOUSE_MEDS_FOLDER_BATCH", "6"))
PERIOD_DAYS = 15
UPLOAD_STAGE_TTL_S = 24 * 3600
LOW_LEFT = 7
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
GSHEET_MIME = "application/vnd.google-apps.spreadsheet"
SA_PATH = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "/app/service-account.json")
IMPERSONATE = os.getenv("GOOGLE_IMPERSONATE_USER", "jarvis@asalifecare.com")
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
CLIENTS_PATH = os.path.join(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"), "clients.json")
DOOR = "houseMedsIngest"
UNRECOGNISED = "(unrecognised file name)"
SWEEP_ACTOR = {"uid": "", "label": "the six-hourly sweep"}

# The badge a current ** manager wears (shift_requests.CALENDAR_BADGE), and the role and badge words this lane…
HM_BADGE = "HM"
REFUSED_ROLES = frozenset({"client", "guardian"})
REFUSED_BADGES = frozenset({"CLIENT", "GUARDIAN"})

# Test hooks: code checks to skip (so the database's own refusal can be proved), the Drive client, and the clients…
CHECKS_OFF: set[str] = set()
DRIVE_FACTORY: Callable[[], Any] | None = None
CLIENTS_READER: Callable[[], tuple[list[dict[str, Any]], str]] | None = None
# The house directory stays in the relay's own database when the lane's tables are asa-hub-db's (HUB_HOUSE_MEDS_DSN)
DIRECTORY_DSN = ""


class DriveUnavailable(RuntimeError):
    """The folder could not be read. Never "nothing new"."""


# ═══════════════════════════════════════════════════════════════════════════ THE GATE — Postgres (DDL as constants…
DDL = (
    "CREATE SEQUENCE IF NOT EXISTS hub_med_stage_seq",
    "CREATE SEQUENCE IF NOT EXISTS hub_med_import_seq",
    """CREATE TABLE IF NOT EXISTS hub_med_imports (
        import_id TEXT PRIMARY KEY DEFAULT ('MI-' || lpad(nextval('hub_med_import_seq')::text, 6, '0')),
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        source TEXT NOT NULL CHECK (source IN ('folder', 'upload', 'sweep')),
        actor_uid TEXT NOT NULL DEFAULT '',
        actor_label TEXT NOT NULL DEFAULT '',
        file_name TEXT NOT NULL DEFAULT '',
        name_key TEXT NOT NULL DEFAULT '',
        stage_id TEXT NOT NULL DEFAULT '',
        drive_file_id TEXT NOT NULL DEFAULT '',
        drive_revision TEXT NOT NULL DEFAULT '',
        md5 TEXT NOT NULL DEFAULT '',
        native BOOLEAN NOT NULL DEFAULT false,
        modifier TEXT NOT NULL DEFAULT '',
        parser_version INTEGER NOT NULL,
        bytes_sha256 TEXT NOT NULL DEFAULT '',
        content_fp TEXT NOT NULL DEFAULT '',
        pharmacy TEXT NOT NULL DEFAULT '',
        facility TEXT NOT NULL DEFAULT '',
        report_start DATE,
        report_end DATE,
        period DATERANGE,
        lines INTEGER NOT NULL DEFAULT 0,
        lines_new INTEGER NOT NULL DEFAULT 0,
        patients INTEGER NOT NULL DEFAULT 0,
        outcome TEXT NOT NULL CHECK (outcome IN ('imported', 'duplicate', 'held', 'invalid', 'failed')),
        layers TEXT[] NOT NULL DEFAULT '{}',
        reason TEXT NOT NULL DEFAULT '',
        duplicate_of TEXT NOT NULL DEFAULT '',
        detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        superseded_by TEXT NOT NULL DEFAULT '',
        tries INTEGER NOT NULL DEFAULT 0,
        retry_at TIMESTAMPTZ,
        house_state TEXT NOT NULL DEFAULT 'pending' CHECK (house_state IN ('pending', 'written', 'failed')),
        house_at TIMESTAMPTZ,
        house_error TEXT NOT NULL DEFAULT '',
        house_tries INTEGER NOT NULL DEFAULT 0,
        house_next TIMESTAMPTZ,
        CONSTRAINT hub_med_imports_whole CHECK (outcome <> 'imported' OR (
            period IS NOT NULL AND content_fp <> '' AND pharmacy <> '' AND name_key <> '')),
        CONSTRAINT hub_med_imports_overlap EXCLUDE USING gist (period WITH &&) WHERE (outcome = 'imported')
    )""",
    "CREATE UNIQUE INDEX IF NOT EXISTS hub_med_imports_name_once ON hub_med_imports (name_key) "
    "WHERE outcome = 'imported'",
    "CREATE UNIQUE INDEX IF NOT EXISTS hub_med_imports_content_once ON hub_med_imports (content_fp) "
    "WHERE outcome = 'imported'",
    "CREATE UNIQUE INDEX IF NOT EXISTS hub_med_imports_period_once ON hub_med_imports "
    "(pharmacy, report_start, report_end) WHERE outcome = 'imported'",
    "CREATE UNIQUE INDEX IF NOT EXISTS hub_med_imports_bytes_once ON hub_med_imports (bytes_sha256) "
    "WHERE outcome = 'imported' AND bytes_sha256 <> ''",
    "CREATE UNIQUE INDEX IF NOT EXISTS hub_med_imports_revision_once ON hub_med_imports "
    "(drive_file_id, drive_revision) WHERE drive_file_id <> '' AND outcome <> 'failed' AND superseded_by = ''",
    "CREATE INDEX IF NOT EXISTS hub_med_imports_md5 ON hub_med_imports (md5) WHERE md5 <> ''",
    "CREATE INDEX IF NOT EXISTS hub_med_imports_stage ON hub_med_imports (stage_id) WHERE stage_id <> ''",
    """CREATE TABLE IF NOT EXISTS hub_med_staged (
        stage_id TEXT PRIMARY KEY DEFAULT ('MS-' || lpad(nextval('hub_med_stage_seq')::text, 6, '0')),
        source TEXT NOT NULL,
        file_name TEXT NOT NULL DEFAULT '',
        name_key TEXT NOT NULL DEFAULT '',
        drive_file_id TEXT NOT NULL DEFAULT '',
        drive_revision TEXT NOT NULL DEFAULT '',
        md5 TEXT NOT NULL DEFAULT '',
        native BOOLEAN NOT NULL DEFAULT false,
        modifier TEXT NOT NULL DEFAULT '',
        bytes_sha256 TEXT NOT NULL DEFAULT '',
        content_fp TEXT NOT NULL,
        report_start DATE,
        report_end DATE,
        parser_version INTEGER NOT NULL,
        envelope JSONB NOT NULL,
        verdict JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        actor_uid TEXT NOT NULL DEFAULT '',
        actor_label TEXT NOT NULL DEFAULT ''
    )""",
    "CREATE UNIQUE INDEX IF NOT EXISTS hub_med_staged_revision ON hub_med_staged "
    "(drive_file_id, drive_revision) WHERE drive_file_id <> ''",
    """CREATE TABLE IF NOT EXISTS hub_med_dispenses (
        row_id TEXT PRIMARY KEY,
        rx_key TEXT NOT NULL,
        rx_root TEXT NOT NULL,
        import_id TEXT NOT NULL REFERENCES hub_med_imports (import_id),
        pharmacy TEXT NOT NULL,
        facility TEXT NOT NULL DEFAULT '',
        report_start DATE NOT NULL,
        report_end DATE NOT NULL,
        patid TEXT NOT NULL,
        drug TEXT NOT NULL,
        drug_norm TEXT NOT NULL,
        physician TEXT NOT NULL DEFAULT '',
        date_written DATE NOT NULL,
        last_dispense DATE NOT NULL,
        dispensed_in_period NUMERIC NOT NULL,
        qty_written NUMERIC,
        qty_remaining NUMERIC,
        qty_dispensed_to_date NUMERIC,
        cutoff DATE,
        sig TEXT NOT NULL DEFAULT '',
        maybe_same_as TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT hub_med_dispense_once UNIQUE NULLS NOT DISTINCT
            (pharmacy, patid, drug_norm, date_written, last_dispense),
        CONSTRAINT hub_med_row_once UNIQUE NULLS NOT DISTINCT
            (pharmacy, report_start, patid, drug_norm, date_written)
    )""",
    "CREATE INDEX IF NOT EXISTS hub_med_dispenses_root ON hub_med_dispenses (rx_root)",
    "CREATE INDEX IF NOT EXISTS hub_med_dispenses_import ON hub_med_dispenses (import_id)",
    """CREATE TABLE IF NOT EXISTS hub_med_patients (
        pharmacy TEXT NOT NULL,
        patid TEXT NOT NULL,
        last_name TEXT NOT NULL DEFAULT '',
        first_name TEXT NOT NULL DEFAULT '',
        name_seen TEXT NOT NULL DEFAULT '',
        first_seen DATE,
        last_seen DATE,
        facilities TEXT[] NOT NULL DEFAULT '{}',
        client_key TEXT NOT NULL DEFAULT '',
        match TEXT NOT NULL DEFAULT 'none' CHECK (match IN ('auto', 'person', 'none', 'ambiguous', 'review')),
        match_note TEXT NOT NULL DEFAULT '',
        same_as TEXT NOT NULL DEFAULT '',
        matched_by TEXT NOT NULL DEFAULT '',
        matched_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        house_ver BIGINT NOT NULL DEFAULT 1,
        house_written_ver BIGINT NOT NULL DEFAULT 0,
        house_tries INTEGER NOT NULL DEFAULT 0,
        house_next TIMESTAMPTZ,
        house_error TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (pharmacy, patid)
    )""",
    # every change to a patient bumps house_ver; the house copy owes the row until the door has it at that version
    "ALTER TABLE hub_med_patients ADD COLUMN IF NOT EXISTS house_ver BIGINT NOT NULL DEFAULT 1",
    "ALTER TABLE hub_med_patients ADD COLUMN IF NOT EXISTS house_written_ver BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE hub_med_patients ADD COLUMN IF NOT EXISTS house_tries INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE hub_med_patients ADD COLUMN IF NOT EXISTS house_next TIMESTAMPTZ",
    "ALTER TABLE hub_med_patients ADD COLUMN IF NOT EXISTS house_error TEXT NOT NULL DEFAULT ''",
    """CREATE TABLE IF NOT EXISTS hub_med_state (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}'::jsonb,
        at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
)

# Which layer a database refusal speaks for, by the constraint's name.
CONSTRAINT_LAYER = {
    "hub_med_imports_name_once": ("name", "held"),
    "hub_med_imports_content_once": ("content", "duplicate"),
    "hub_med_imports_period_once": ("period", "held"),
    "hub_med_imports_bytes_once": ("bytes", "duplicate"),
    "hub_med_imports_revision_once": ("file", "duplicate"),
    "hub_med_imports_overlap": ("overlap", "held"),
    "hub_med_dispense_once": ("lines", "held"),
    "hub_med_row_once": ("lines", "held"),
    "hub_med_dispenses_pkey": ("lines", "held"),
}

_READY: set[str] = set()
_READY_LOCK = threading.Lock()


def _connect(dsn: str):
    return psycopg2.connect(dsn, connect_timeout=5)


# The second key of every lock: the lane's word hashed with the schema.
_KEY_SQL = "hashtext('house_meds|' || %s || '|' || current_schema())"


def ensure_schema(dsn: str) -> None:
    with _READY_LOCK:
        if dsn in _READY:
            return
        conn = _connect(dsn)
        try:
            try:
                with conn, conn.cursor() as cur:
                    cur.execute(f"SELECT pg_advisory_xact_lock(%s, {_KEY_SQL})", (LOCK_NS, LANE_KEY))
                    for stmt in DDL:
                        cur.execute(stmt)
            except psycopg2.errors.InsufficientPrivilege:
                # the tables are asa-hub-db's writer's (asa-hub-app makes them): this role only reads and writes rows
                with conn, conn.cursor() as cur:
                    cur.execute("SELECT to_regclass('hub_med_imports'), to_regclass('hub_med_staged'), "
                                "to_regclass('hub_med_dispenses'), to_regclass('hub_med_patients'), "
                                "to_regclass('hub_med_state')")
                    if not all(cur.fetchone() or ()):
                        raise
        finally:
            conn.close()
        _READY.add(dsn)


def forget_schema() -> None:
    """Tests only: the next call creates the tables again (a new schema)."""
    with _READY_LOCK:
        _READY.clear()
    with _MODEL_LOCK:
        _MODEL.clear()


# ═══════════════════════════════════════════════════════════════════════════ NAMES — the operator's check…
_EXT = re.compile(r"\.(xlsx|xlsm|xls|csv)$", re.I)
_EXPORT_MARK = re.compile(r"\.gsheet$", re.I)
_COPY_HEAD = re.compile(r"^copy of\s+", re.I)
_COPY_TAIL = re.compile(r"(?:\s*\(\d+\)|\s*-\s*copy|\s+copy|(?<=[^\d\s_-])[ _-]\d{1,2})$", re.I)
_KDP = re.compile(r"^key\s+data\s+points\s*,\s*(?P<pharmacy>[^,]+?)\s*,\s*"
                  r"(?P<date>\d{4}-\d{2}-\d{2})(?:[ _-]?(?P<time>\d{6}))?", re.I)


def _fold(text: Any) -> str:
    s = unicodedata.normalize("NFKC", str(text or ""))
    s = "".join("-" if unicodedata.category(c) == "Pd" else c for c in s)
    return " ".join(s.split()).casefold()


def name_key(name: Any) -> dict[str, Any]:
    """{key, kdp, pharmacy, date}."""
    s = unicodedata.normalize("NFKC", str(name or ""))
    s = s.replace("\\", "/").split("/")[-1]
    s = "".join("-" if unicodedata.category(c) == "Pd" else c for c in s)
    s = " ".join(s.split())
    s = _EXT.sub("", s)
    s = _EXPORT_MARK.sub("", s).strip()
    while _COPY_HEAD.match(s):
        s = _COPY_HEAD.sub("", s, count=1).strip()
    m = _KDP.match(s)
    if m:
        try:
            day = date.fromisoformat(m.group("date")).isoformat()
        except ValueError:
            day = ""
        if day:
            pharmacy = _fold(m.group("pharmacy"))
            return {"key": f"kdp|{pharmacy}|{day}", "kdp": True, "pharmacy": pharmacy, "date": day,
                    "time": m.group("time") or ""}
    while True:
        cut = _COPY_TAIL.sub("", s).strip()
        if cut == s or not cut:
            break
        s = cut
    return {"key": f"raw|{_fold(s)}", "kdp": False, "pharmacy": "", "date": "", "time": ""}


def public_name(name: Any) -> str:
    """The name a mirrored book or another house's reader may carry: a KDP name REBUILT from its key (the lane's…"""
    nk = name_key(name)
    if not nk["kdp"]:
        return UNRECOGNISED
    pharmacy = PHARMACY if nk["pharmacy"] == _fold(PHARMACY) else "another pharmacy"
    ext = ".xlsx" if str(name or "").strip().lower().endswith(".xlsx") else ""
    return f"Key Data Points, {pharmacy}, {nk['date']}{'_' + nk['time'] if nk.get('time') else ''}{ext}"


def is_report_name(name: Any) -> bool:
    return str(name or "").strip().lower().endswith(".xlsx")


# ═══════════════════════════════════════════════════════════════════════════ PARSE — once, into a JSON envelope…
_DATE_SLASH = re.compile(r"^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$")


def _text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return " ".join(str(v).split())


def _date(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = " ".join(str(v).split())
    if not s:
        return ""
    m = _DATE_SLASH.match(s)
    if not m:
        raise ValueError("date")
    return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()


def _num(v: Any) -> str:
    if v is None or isinstance(v, bool):
        if v is None:
            return ""
        raise ValueError("number")
    s = repr(v) if isinstance(v, float) else str(v).strip()
    if not s:
        return ""
    try:
        d = Decimal(s)
    except InvalidOperation as exc:
        raise ValueError("number") from exc
    if not d.is_finite():
        raise ValueError("number")
    out = format(d.normalize(), "f")
    return "0" if out in ("-0", "") else out


def _patid(v: Any) -> str:
    if isinstance(v, bool) or v is None:
        return _text(v)
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)
    return " ".join(str(v).split())


def drug_norm(drug: Any) -> str:
    return " ".join(str(drug or "").split()).upper()


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def rx_key_of(pharmacy: str, line: dict[str, Any]) -> str:
    return _sha(f"{pharmacy}|{line['patid']}|{line['drug_norm']}|{line['date_written']}")[:20]


def row_id_of(pharmacy: str, line: dict[str, Any]) -> str:
    return "MD-" + _sha(f"{pharmacy}|{line['report_start']}|{line['patid']}|{line['drug_norm']}|"
                        f"{line['date_written']}")[:20]


def content_fp(lines: Iterable[dict[str, Any]]) -> str:
    """sha256 over the SORTED lines, each the 18 normalized fields: blind to the file's format, its width, its…"""
    rows = sorted([line[k] for k in KEYS] for line in lines)
    return _sha(json.dumps(rows, separators=(",", ":"), ensure_ascii=False))


def _invalid(reason: str, problem: str, *, unopenable: bool = False) -> dict[str, Any]:
    # An invalid envelope holds NO cell values: a dropped file may be any spreadsheet, and only the reason is kept.
    return {"ok": False, "v": PARSER_VERSION, "reason": reason, "problem": problem,
            "unopenable": unopenable}


def _unzipped_too_big(data: bytes) -> str:
    """Why the archive may not be opened, or ''."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            members = z.infolist()
    except (zipfile.BadZipFile, OSError, ValueError):
        return ""  # not a zip: openpyxl names it below
    if len(members) > MAX_MEMBERS:
        return f"The workbook holds {len(members)} parts — not a pharmacy report."
    if sum(max(0, m.file_size) for m in members) > MAX_UNZIPPED:
        return "The workbook unpacks to more than 40 MB — not a pharmacy report."
    return ""


def parse(data: bytes) -> dict[str, Any]:
    """The envelope — {ok, v, period, facility, lines, patients, content_fp, counts} — or {ok: False, reason…"""
    import openpyxl  # noqa: PLC0415 — the relay image has it; a missing one is a crash, not a verdict
    if len(data) > MAX_BYTES:
        return _invalid("The file is larger than 5 MB — not a pharmacy report.", "too_large")
    bomb = _unzipped_too_big(data)
    if bomb:
        return _invalid(bomb, "too_large_unzipped")
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except (zipfile.BadZipFile, KeyError, OSError) as exc:
        return _invalid(f"The file is not an .xlsx workbook ({type(exc).__name__}).", "not_xlsx",
                        unopenable=True)
    except Exception as exc:  # noqa: BLE001 — a workbook openpyxl refuses is not a report
        return _invalid(f"The workbook could not be opened ({type(exc).__name__}).", "unopenable",
                        unopenable=True)
    lines: list[dict[str, Any]] = []
    try:
        if SHEET not in wb.sheetnames:
            return _invalid(f"The sheet “{SHEET}” is missing.", "no_sheet")
        rows = wb[SHEET].iter_rows(values_only=True)
        head = next(rows, None)
        if head is None:
            return _invalid("The sheet “KDP” is empty.", "empty_sheet")
        got = [_text(c) for c in head]
        got += [""] * (len(HEADER) - len(got))
        for want, have in zip(HEADER, got[:len(HEADER)]):
            if want != have:
                return _invalid(f"Column “{want}” is missing.", "header")
        if any(h for h in got[len(HEADER):]):
            return _invalid("The header carries columns after “PatID”.", "header_extra")
        for n, row in enumerate(rows, start=2):
            cells = list(row[:len(HEADER)]) + [None] * max(0, len(HEADER) - len(row))
            if all(_text(c) == "" for c in cells):
                continue
            line: dict[str, Any] = {}
            for key, value in zip(KEYS, cells):
                try:
                    if key in DATE_KEYS:
                        line[key] = _date(value)
                    elif key in NUM_KEYS:
                        line[key] = _num(value)
                    elif key == "patid":
                        line[key] = _patid(value)
                    else:
                        line[key] = _text(value)
                except ValueError:
                    kind = "date" if key in DATE_KEYS else "number"
                    return _invalid(f"Column “{LABEL[key]}” on row {n} is not a {kind}.", "cell")
            lines.append(line)
    finally:
        try:
            wb.close()
        except Exception:  # noqa: BLE001
            pass
    return envelope_of(lines)


def envelope_of(lines: list[dict[str, Any]]) -> dict[str, Any]:
    """The shape validation (layer j) over parsed lines, and the envelope."""
    if not lines:
        return _invalid("The report holds no lines, so it has no period.", "no_lines")
    periods = {(ln["report_start"], ln["report_end"]) for ln in lines}
    if len(periods) != 1:
        return _invalid("The file holds two report periods.", "two_periods")
    start, end = next(iter(periods))
    if not start or not end:
        return _invalid("A line carries no report period.", "no_period")
    if end < start:
        return _invalid("The report ends before it starts.", "period_backwards")
    for key in ("patid", "drug", "date_written", "last_dispense", "dispensed_in_period"):
        blank = sum(1 for ln in lines if not ln[key])
        if blank:
            return _invalid(f"“{LABEL[key]}” is blank on {blank} line(s).", "blank_key")
    outside = sum(1 for ln in lines if not (start <= ln["last_dispense"] <= end))
    if outside:
        return _invalid(f"{outside} line(s) were dispensed outside the report's period.", "outside")
    negative = sum(1 for ln in lines for k in NUM_KEYS if ln[k].startswith("-"))
    if negative:
        return _invalid(f"{negative} number(s) are negative.", "negative")
    for ln in lines:
        ln["drug_norm"] = drug_norm(ln["drug"])
        ln["sig"] = " ".join((ln["sig1"] + ln["sig2"] + ln["sig3"]).split())
    rows = [(ln["patid"], ln["drug_norm"], ln["date_written"]) for ln in lines]
    dispenses = [(ln["patid"], ln["drug_norm"], ln["date_written"], ln["last_dispense"]) for ln in lines]
    if len(set(rows)) != len(rows) or len(set(dispenses)) != len(dispenses):
        return _invalid("A line is repeated inside the file.", "repeated")
    patients: dict[str, dict[str, Any]] = {}
    for ln in lines:
        p = patients.setdefault(ln["patid"], {"patid": ln["patid"], "last_name": ln["last_name"],
                                              "first_name": ln["first_name"], "facilities": set()})
        if ln["facility"]:
            p["facilities"].add(ln["facility"])
    facilities = sorted({ln["facility"] for ln in lines if ln["facility"]})
    return {
        "ok": True, "v": PARSER_VERSION,
        "period": {"start": start, "end": end},
        "facility": "/".join(facilities),
        "lines": lines,
        "patients": [{**p, "facilities": sorted(p["facilities"])} for p in patients.values()],
        "content_fp": content_fp(lines),
        "counts": {"lines": len(lines), "patients": len(patients),
                   "prescriptions": len({(ln["patid"], ln["drug_norm"], ln["date_written"])
                                         for ln in lines})},
    }


# ═══════════════════════════════════════════════════════════════════════════ WORDS — the sentence a person reads…
def _d(iso: Any) -> date | None:
    if isinstance(iso, datetime):
        return iso.date()
    if isinstance(iso, date):
        return iso
    try:
        return date.fromisoformat(str(iso)[:10])
    except ValueError:
        return None


def _day(iso: Any) -> str:
    d = _d(iso)
    return f"{d:%b} {d.day}" if d else ""


def span(start: Any, end: Any) -> str:
    a, b = _d(start), _d(end)
    if not a or not b:
        return "no period"
    if a.year == b.year:
        return f"{a:%b} {a.day} – {b:%b} {b.day}, {b.year}"
    return f"{a:%b} {a.day}, {a.year} – {b:%b} {b.day}, {b.year}"


def _quote(name: Any, public: bool) -> str:
    return f"“{public_name(name) if public else name}”"


HELD_TAIL = "Nothing was imported. Ask the pharmacy which report is right."


def _sentence(v: dict[str, Any], public: bool = False) -> str:
    """One sentence per verdict (design §7)."""
    kind = v.get("kind")
    q = lambda n: _quote(n, public)  # noqa: E731
    other = v.get("other") or {}
    here = v.get("here") or {}
    if kind == "new":
        return (f"{span(here.get('start'), here.get('end'))} · {here.get('lines', 0)} lines for "
                f"{here.get('patients', 0)} patients · all new.")
    if kind == "invalid":
        return str(v.get("why") or "Not a pharmacy report.")
    if kind == "failed":
        return f"Could not be read ({v.get('why') or 'unknown'}). It will be tried again."
    if kind == "same":
        fired = [w for w, on in (("same name", v.get("name")), ("same content", v.get("content")),
                                 ("same period", v.get("period"))) if on]
        if v.get("name"):
            return (f"Same report as {q(other.get('file_name'))}, imported {_day(other.get('at'))} by "
                    f"{other.get('by') or 'the sweep'} — {', '.join(fired)} "
                    f"({span(other.get('start'), other.get('end'))}). It will not be read again.")
        return (f"Same content as {q(other.get('file_name'))} (imported {_day(other.get('at'))}) — "
                "the lines are identical although the file name differs. It will not be read again.")
    if kind == "md5":
        return (f"The same bytes as {q(other.get('file_name'))} ({other.get('outcome') or 'on file'}) — "
                "not downloaded again.")
    if kind == "batch":
        return (f"Same report as {q(other.get('file_name'))}, found in the same batch — that file is "
                "imported instead. It will not be read again.")
    if kind == "revision":
        return ("An older version of this Drive file, replaced in Drive before it was imported — the newer "
                "version is read instead. Nothing of this version was imported.")
    if kind == "staged":
        what = {"name": "the same name", "period": "the same period", "overlap": "an overlapping period"}
        return (f"Another report waiting to be imported, {q(other.get('file_name'))}, has "
                f"{what.get(v.get('layer'), 'the same period')} "
                f"({span(other.get('start'), other.get('end'))}) but different lines. Neither was imported. "
                "Ask the pharmacy which report is right, then drop that one here.")
    if kind == "period":
        return (f"A different report for a period already on file: "
                f"{span(other.get('start'), other.get('end'))} came from {q(other.get('file_name'))} "
                f"({other.get('lines', 0)} lines); this file has {here.get('lines', 0)} lines, "
                f"{v.get('differ', 0)} of them different. Nothing was imported. Reports are never merged.")
    if kind == "name":
        return (f"Same name as {q(other.get('file_name'))} (imported {_day(other.get('at'))}) but a "
                f"different report inside (period {span(here.get('start'), here.get('end'))}). "
                "Nothing was imported.")
    if kind == "overlap":
        return (f"This report's period ({span(here.get('start'), here.get('end'))}) overlaps "
                f"{q(other.get('file_name'))} ({span(other.get('start'), other.get('end'))}), already "
                "on file. Nothing was imported. Reports are never merged.")
    if kind == "lines":
        return (f"{v.get('known', 0)} lines of this report are already on file from "
                f"{q(other.get('file_name'))} (period {span(other.get('start'), other.get('end'))}). "
                "Nothing was imported.")
    if kind == "pharmacy":
        return (f"The file name names the pharmacy “{v.get('named')}”, but this lane reads {PHARMACY}'s "
                f"reports. {HELD_TAIL}")
    if kind == "length":
        return (f"The period {span(here.get('start'), here.get('end'))} is {v.get('days')} days long, "
                f"not {PERIOD_DAYS}. {HELD_TAIL}")
    if kind == "name_date":
        return (f"The file name's date ({v.get('named')}) is not the day after the report ends "
                f"({v.get('expected')}). {HELD_TAIL}")
    if kind == "database":
        return (f"The database refused this report ({v.get('layer')}): "
                f"{'it is already on file' if v.get('outcome') == 'duplicate' else HELD_TAIL}")
    return str(v.get("why") or "")


# ═══════════════════════════════════════════════════════════════════════════ THE JUDGE — every layer, under the…
def _other(row: dict[str, Any]) -> dict[str, Any]:
    return {"import_id": row.get("import_id") or row.get("stage_id") or "",
            "file_name": row.get("file_name") or "",
            "at": (row.get("received_at") or row.get("created_at") or ""),
            "by": row.get("actor_label") or "",
            "start": row.get("report_start"), "end": row.get("report_end"),
            "lines": row.get("lines") or 0, "outcome": row.get("outcome") or ""}


def _signature(line: dict[str, Any]) -> tuple:
    return (line["patid"], line["drug_norm"], line["date_written"], line["last_dispense"],
            line["dispensed_in_period"], line["qty_written"], line["qty_remaining"],
            line["qty_dispensed_to_date"], line["cutoff"], line["physician"].upper(), line["sig"])


def _db_signature(r: dict[str, Any]) -> tuple:
    num = lambda v: "" if v is None else format(Decimal(v).normalize(), "f")  # noqa: E731
    iso = lambda v: v.isoformat() if v else ""  # noqa: E731
    return (r["patid"], r["drug_norm"], iso(r["date_written"]), iso(r["last_dispense"]),
            num(r["dispensed_in_period"]), num(r["qty_written"]), num(r["qty_remaining"]),
            num(r["qty_dispensed_to_date"]), iso(r["cutoff"]), str(r["physician"] or "").upper(),
            r["sig"] or "")


def judge(cur, env: dict[str, Any], src: dict[str, Any]) -> dict[str, Any]:
    """{verdict, layers, kind, reason, duplicate_of, lines_new, detail} — the whole answer about one file against…"""
    if not env.get("ok"):
        v = {"kind": "invalid", "why": env.get("reason")}
        return {"verdict": "invalid", "layers": ["shape"], "kind": "invalid", "reason": _sentence(v),
                "public_reason": _sentence(v, True), "duplicate_of": "", "lines_new": 0, "detail": {}}
    start, end = env["period"]["start"], env["period"]["end"]
    lines = env["lines"]
    here = {"start": start, "end": end, "lines": len(lines), "patients": env["counts"]["patients"]}
    nk = src.get("name") or name_key(src.get("file_name"))
    cols = ("import_id, file_name, received_at, actor_label, report_start, report_end, lines, "
            "content_fp, bytes_sha256, name_key, pharmacy")

    def verdict(outcome: str, layers: list[str], v: dict[str, Any], other: dict | None = None,
                lines_new: int = 0) -> dict[str, Any]:
        v = {**v, "here": here, "other": other or {}}
        return {"verdict": outcome, "layers": layers, "kind": v["kind"], "reason": _sentence(v),
                "public_reason": _sentence(v, True),
                "duplicate_of": (other or {}).get("import_id", ""), "lines_new": lines_new,
                "detail": {"other": _jsonable_one(other or {}), "differ": v.get("differ"),
                           "known": v.get("known")}}

    # ── identity: the same report, recorded and never read again ──
    if not ({"content", "bytes"} <= CHECKS_OFF):
        cur.execute(f"SELECT {cols} FROM hub_med_imports WHERE outcome = 'imported' AND "  # noqa: S608
                    "(content_fp = %s OR (bytes_sha256 <> '' AND bytes_sha256 = %s)) "
                    "ORDER BY import_id LIMIT 1",
                    (env["content_fp"] if "content" not in CHECKS_OFF else "~",
                     (src.get("bytes_sha256") or "~") if "bytes" not in CHECKS_OFF else "~"))
        got = cur.fetchone()
        if got:
            same = {"content": got["content_fp"] == env["content_fp"],
                    "bytes": bool(src.get("bytes_sha256")) and got["bytes_sha256"] == src.get("bytes_sha256"),
                    "name": got["name_key"] == nk["key"],
                    "period": str(got["report_start"]) == start and str(got["report_end"]) == end}
            layers = [k for k in ("name", "content", "period", "bytes") if same[k]]
            return verdict("duplicate", layers, {"kind": "same", **same}, _other(got))

    # ── conflicts: a different report where one is already on file ──
    if "name" not in CHECKS_OFF:
        cur.execute(f"SELECT {cols} FROM hub_med_imports WHERE outcome = 'imported' AND name_key = %s "  # noqa: S608
                    "LIMIT 1", (nk["key"],))
        got = cur.fetchone()
        if got:
            return verdict("held", ["name"], {"kind": "name"}, _other(got))
    if "period" not in CHECKS_OFF:
        cur.execute(f"SELECT {cols} FROM hub_med_imports WHERE outcome = 'imported' AND pharmacy = %s "  # noqa: S608
                    "AND report_start = %s AND report_end = %s LIMIT 1", (PHARMACY, start, end))
        got = cur.fetchone()
        if got:
            cur.execute("SELECT * FROM hub_med_dispenses WHERE import_id = %s", (got["import_id"],))
            there = {_db_signature(r) for r in cur.fetchall()}
            mine = {_signature(ln) for ln in lines}
            differ = len(mine - there)
            return verdict("held", ["period"], {"kind": "period", "differ": differ}, _other(got))
    if "overlap" not in CHECKS_OFF:
        cur.execute(f"SELECT {cols} FROM hub_med_imports WHERE outcome = 'imported' AND "  # noqa: S608
                    "period && daterange(%s::date, %s::date, '[]') ORDER BY report_start LIMIT 1",
                    (start, end))
        got = cur.fetchone()
        if got:
            return verdict("held", ["overlap"], {"kind": "overlap"}, _other(got))
    if nk["kdp"] and "pharmacy" not in CHECKS_OFF and nk["pharmacy"] != _fold(PHARMACY):
        named = re.match(_KDP, " ".join(unicodedata.normalize("NFKC", str(src.get("file_name") or "")).split()))
        return verdict("held", ["pharmacy"], {"kind": "pharmacy",
                                              "named": (named.group("pharmacy") if named else nk["pharmacy"])})
    if "shape-period" not in CHECKS_OFF:
        days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
        if days != PERIOD_DAYS:
            return verdict("held", ["length"], {"kind": "length", "days": days})
        if nk["kdp"]:
            expected = (date.fromisoformat(end) + timedelta(days=1)).isoformat()
            if nk["date"] != expected:
                return verdict("held", ["name-date"], {"kind": "name_date", "named": nk["date"],
                                                       "expected": expected})
    if "lines" not in CHECKS_OFF:
        ids = [row_id_of(PHARMACY, ln) for ln in lines]
        keys = [(ln["patid"], ln["drug_norm"], ln["date_written"], ln["last_dispense"]) for ln in lines]
        cur.execute(
            "SELECT d.import_id, count(*) AS n FROM hub_med_dispenses d "
            "WHERE d.pharmacy = %s AND (d.row_id = ANY(%s) OR (d.patid, d.drug_norm, d.date_written::text, "
            "d.last_dispense::text) IN (SELECT * FROM unnest(%s::text[], %s::text[], %s::text[], %s::text[]))) "
            "GROUP BY d.import_id ORDER BY n DESC",
            (PHARMACY, ids, [k[0] for k in keys], [k[1] for k in keys], [k[2] for k in keys],
             [k[3] for k in keys]))
        hits = cur.fetchall()
        if hits:
            known = sum(int(h["n"]) for h in hits)
            cur.execute(f"SELECT {cols} FROM hub_med_imports WHERE import_id = %s",  # noqa: S608
                        (hits[0]["import_id"],))
            return verdict("held", ["lines"], {"kind": "lines", "known": min(known, len(lines))},
                           _other(cur.fetchone() or {}))
    return verdict("new", [], {"kind": "new"}, None, lines_new=len(lines))


def _jsonable_one(row: dict[str, Any]) -> dict[str, Any]:
    return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in row.items()}


# ═══════════════════════════════════════════════════════════════════════════ RECORDING AND STAGING…
IMPORT_COLS = ("source", "actor_uid", "actor_label", "file_name", "name_key", "stage_id", "drive_file_id",
               "drive_revision", "md5", "native", "modifier", "parser_version", "bytes_sha256",
               "content_fp", "pharmacy", "facility", "report_start", "report_end", "lines",
               "lines_new", "patients", "outcome", "layers", "reason", "duplicate_of", "detail")


def _src_row(src: dict[str, Any], env: dict[str, Any], v: dict[str, Any], outcome: str,
             stage_id: str = "") -> dict[str, Any]:
    ok = bool(env.get("ok"))
    return {
        "source": src.get("source") or "upload",
        "actor_uid": str(src.get("actor_uid") or ""),
        "actor_label": str(src.get("actor_label") or ""),
        "file_name": str(src.get("file_name") or ""),
        "name_key": (src.get("name") or name_key(src.get("file_name")))["key"],
        "stage_id": stage_id,
        "drive_file_id": str(src.get("drive_file_id") or ""),
        "drive_revision": str(src.get("drive_revision") or ""),
        "md5": str(src.get("md5") or ""),
        "native": bool(src.get("native")),
        "modifier": str(src.get("modifier") or ""),
        "parser_version": int(env.get("v") or PARSER_VERSION),
        "bytes_sha256": str(src.get("bytes_sha256") or ""),
        "content_fp": env.get("content_fp", "") if ok else "",
        "pharmacy": PHARMACY if ok else "",
        "facility": env.get("facility", "") if ok else "",
        "report_start": env["period"]["start"] if ok else None,
        "report_end": env["period"]["end"] if ok else None,
        "lines": env["counts"]["lines"] if ok else 0,
        "lines_new": int(v.get("lines_new") or 0) if outcome == "imported" else 0,
        "patients": env["counts"]["patients"] if ok else 0,
        "outcome": outcome,
        "layers": list(v.get("layers") or []),
        "reason": str(v.get("reason") or ""),
        "duplicate_of": str(v.get("duplicate_of") or ""),
        "detail": psycopg2.extras.Json({**(v.get("detail") or {}),
                                        "public_reason": v.get("public_reason") or "",
                                        "kind": v.get("kind") or ""}),
    }


def _insert_import(cur, row: dict[str, Any]) -> str | None:
    """One ledger row."""
    if row["drive_file_id"] and row["outcome"] != "failed":
        cur.execute("UPDATE hub_med_imports SET superseded_by = 'reread' WHERE drive_file_id = %s "
                    "AND drive_revision = %s AND outcome = 'invalid' AND parser_version < %s "
                    "AND superseded_by = ''", (row["drive_file_id"], row["drive_revision"], PARSER_VERSION))
    cols = ", ".join(IMPORT_COLS) + ", period"
    marks = ", ".join(["%s"] * len(IMPORT_COLS)) + (
        ", CASE WHEN %s::date IS NULL THEN NULL ELSE daterange(%s::date, %s::date, '[]') END")
    values = [row[c] for c in IMPORT_COLS] + [row["report_start"], row["report_start"], row["report_end"]]
    quiet = "" if row["outcome"] == "imported" else "ON CONFLICT DO NOTHING "
    cur.execute(f"INSERT INTO hub_med_imports ({cols}) VALUES ({marks}) "  # noqa: S608
                f"{quiet}RETURNING import_id", values)
    got = cur.fetchone()
    iid = (got["import_id"] if isinstance(got, dict) else got[0]) if got else None
    if iid and row["drive_file_id"] and row["outcome"] != "failed":
        cur.execute("UPDATE hub_med_imports SET superseded_by = %s WHERE drive_file_id = %s "
                    "AND drive_revision = %s AND superseded_by = 'reread'",
                    (iid, row["drive_file_id"], row["drive_revision"]))
    return iid


def _decision_on_file(cur, drive_file_id: str, revision: str) -> dict[str, Any] | None:
    cur.execute("SELECT * FROM hub_med_imports WHERE drive_file_id = %s AND drive_revision = %s "
                "AND outcome <> 'failed' AND superseded_by = '' ORDER BY import_id LIMIT 1",
                (drive_file_id, revision))
    return cur.fetchone()


def record(cur, src: dict[str, Any], env: dict[str, Any], v: dict[str, Any], stage_id: str = "") -> dict:
    """A decision that needs no person, written down so the file is never read again."""
    outcome = v["verdict"]
    if outcome == "new":
        raise ValueError("a new file is staged, never recorded")
    row = _src_row(src, env, v, outcome, stage_id)
    if outcome == "failed" and row["drive_file_id"]:
        cur.execute("SELECT import_id FROM hub_med_imports WHERE drive_file_id = %s AND drive_revision = %s "
                    "AND outcome = 'failed' ORDER BY import_id DESC LIMIT 1",
                    (row["drive_file_id"], row["drive_revision"]))
        was = cur.fetchone()
        if was:
            cur.execute("UPDATE hub_med_imports SET tries = tries + 1, received_at = now(), reason = %s, "
                        "retry_at = now() + make_interval(secs => LEAST(21600, 600 * power(2, tries))) "
                        "WHERE import_id = %s RETURNING *", (row["reason"], was["import_id"]))
            return dict(cur.fetchone())
    iid = _insert_import(cur, row)
    if iid is None:
        on_file = _decision_on_file(cur, row["drive_file_id"], row["drive_revision"]) \
            if row["drive_file_id"] else None
        if on_file:
            if stage_id:
                cur.execute("DELETE FROM hub_med_staged WHERE stage_id = %s", (stage_id,))
            return {**dict(on_file), "already": True}
        raise RuntimeError("the decision could not be written and none is on file")
    if stage_id:
        cur.execute("DELETE FROM hub_med_staged WHERE stage_id = %s", (stage_id,))
    cur.execute("SELECT * FROM hub_med_imports WHERE import_id = %s", (iid,))
    return dict(cur.fetchone())


def _rank(src: dict[str, Any]) -> int:
    """The batch tie-break: a folder file with a real extension and an md5, then a folder file, then an upload…"""
    if src.get("source") in ("folder", "sweep"):
        return 3 if (src.get("md5") and not src.get("native")) else 2
    return 1


def _staged_src(row: dict[str, Any]) -> dict[str, Any]:
    return {"source": row["source"], "file_name": row["file_name"], "name": name_key(row["file_name"]),
            "drive_file_id": row["drive_file_id"], "drive_revision": row["drive_revision"],
            "md5": row["md5"], "native": row["native"], "modifier": row["modifier"],
            "bytes_sha256": row["bytes_sha256"], "actor_uid": row["actor_uid"],
            "actor_label": row["actor_label"]}


def _batch_verdict(other: dict[str, Any], mine: dict[str, Any] | None = None) -> dict[str, Any]:
    """Same report as another file waiting in this batch."""
    v = {"kind": "batch", "other": {"file_name": other.get("file_name")}}
    layers = ["batch"]
    if mine:
        if name_key(other.get("file_name"))["key"] == name_key(mine.get("file_name"))["key"]:
            layers.append("name")
        if other.get("content_fp") and other.get("content_fp") == mine.get("content_fp"):
            layers.append("content")
        if other.get("report_start") and _iso(other.get("report_start")) == _iso(mine.get("report_start")) \
                and _iso(other.get("report_end")) == _iso(mine.get("report_end")):
            layers.append("period")
        if other.get("md5") and other.get("md5") == mine.get("md5"):
            layers.append("md5")
    return {"verdict": "duplicate", "layers": layers, "kind": "batch", "reason": _sentence(v),
            "public_reason": _sentence(v, True), "duplicate_of": other.get("stage_id", ""),
            "lines_new": 0, "detail": {"other": {"stage_id": other.get("stage_id"),
                                                  "file_name": other.get("file_name")}}}


def _mine(src: dict[str, Any], env: dict[str, Any]) -> dict[str, Any]:
    ok = bool(env.get("ok"))
    return {"file_name": src.get("file_name"), "md5": src.get("md5"),
            "content_fp": env.get("content_fp") if ok else "",
            "report_start": env["period"]["start"] if ok else "", "report_end": env["period"]["end"] if ok else ""}


def _decided_or_staged(cur, fid: str, rev: str) -> dict[str, Any] | None:
    """The preview of a Drive revision already decided or waiting, or None."""
    if not fid:
        return None
    on_file = _decision_on_file(cur, fid, rev)
    if on_file and not (on_file["outcome"] == "invalid" and on_file["parser_version"] < PARSER_VERSION):
        return {**preview_of(on_file), "already": True}
    cur.execute("SELECT * FROM hub_med_staged WHERE drive_file_id = %s AND drive_revision = %s", (fid, rev))
    mine = cur.fetchone()
    return preview_of_stage(mine) if mine else None


def _retire_revisions(cur, src: dict[str, Any]) -> int:
    """A Drive file's staging at any OTHER revision is stale: Drive holds only the newer one."""
    fid, rev = src.get("drive_file_id") or "", src.get("drive_revision") or ""
    if not fid:
        return 0
    cur.execute("SELECT * FROM hub_med_staged WHERE drive_file_id = %s AND drive_revision <> %s "
                "ORDER BY stage_id", (fid, rev))
    followed = 0
    for old in cur.fetchall():
        if src.get("md5") and not src.get("native") and old["md5"] == src["md5"] and not followed:
            cur.execute("UPDATE hub_med_staged SET drive_revision = %s, file_name = %s, name_key = %s, "
                        "modifier = %s WHERE stage_id = %s",
                        (rev, src.get("file_name") or "", (src.get("name") or name_key(src.get("file_name")))["key"],
                         src.get("modifier") or "", old["stage_id"]))
            followed = 1
            continue
        rv = {"kind": "revision"}
        record(cur, _staged_src(old), old["envelope"],
               {"verdict": "duplicate", "layers": ["revision"], "kind": "revision", "reason": _sentence(rv),
                "public_reason": _sentence(rv, True), "duplicate_of": "", "detail": {"revision": rev}},
               stage_id=old["stage_id"])
    return followed


def _staged_conflicts(cur, src: dict[str, Any], env: dict[str, Any]) -> list[tuple[dict[str, Any], str]]:
    """Waiting files that are a DIFFERENT report for this one's name or period — (row, layer)."""
    if "staged" in CHECKS_OFF:
        return []
    nk = (src.get("name") or name_key(src.get("file_name")))["key"]
    start, end = env["period"]["start"], env["period"]["end"]
    cur.execute("SELECT * FROM hub_med_staged WHERE content_fp <> %s "
                "AND NOT (drive_file_id <> '' AND drive_file_id = %s) "
                "AND (name_key = %s OR (report_start <= %s::date AND report_end >= %s::date)) ORDER BY stage_id",
                (env["content_fp"], src.get("drive_file_id") or "", nk, end, start))
    out = []
    for row in cur.fetchall():
        same_period = _iso(row["report_start"]) == start and _iso(row["report_end"]) == end
        out.append((row, "name" if row["name_key"] == nk else "period" if same_period else "overlap"))
    return out


def _staged_verdict(other: dict[str, Any], layer: str) -> dict[str, Any]:
    sv = {"kind": "staged", "layer": layer,
          "other": {"file_name": other.get("file_name"), "start": other.get("report_start"),
                    "end": other.get("report_end")}}
    return {"verdict": "held", "layers": ["batch", layer], "kind": "staged", "reason": _sentence(sv),
            "public_reason": _sentence(sv, True), "duplicate_of": other.get("stage_id") or "",
            "lines_new": 0, "detail": {"other": {"stage_id": other.get("stage_id"),
                                                 "file_name": other.get("file_name")}}}


def decide(cur, src: dict[str, Any], env: dict[str, Any]) -> dict[str, Any]:
    """Judge one parsed file and either STAGE it (new — it waits for the Import button) or RECORD it (everything…"""
    fid, rev = src.get("drive_file_id") or "", src.get("drive_revision") or ""
    known = _decided_or_staged(cur, fid, rev)
    if known:
        return known
    if _retire_revisions(cur, src):
        return _decided_or_staged(cur, fid, rev) or {}
    v = judge(cur, env, src)
    if v["verdict"] != "new":
        return preview_of(record(cur, src, env, v), v)
    # THE BATCH TIE-BREAK: two waiting files that are the same report
    cur.execute("SELECT * FROM hub_med_staged WHERE content_fp = %s ORDER BY stage_id", (env["content_fp"],))
    twins = cur.fetchall()
    loser_twins = []
    for twin in twins:
        if _rank(src) > _rank(_staged_src(twin)):
            loser_twins.append(twin)
        else:
            bv = _batch_verdict(twin, _mine(src, env))
            return preview_of(record(cur, src, env, bv), bv)
    # TWO DIFFERENT REPORTS WAITING FOR ONE PERIOD OR NAME: neither is chosen by the order they arrived in — both…
    conflicts = _staged_conflicts(cur, src, env)
    if conflicts:
        mine = {**_mine(src, env), "stage_id": ""}
        for row, layer in conflicts:
            record(cur, _staged_src(row), row["envelope"], _staged_verdict(mine, layer), stage_id=row["stage_id"])
        first, layer = conflicts[0]
        hv = _staged_verdict(first, layer)
        return preview_of(record(cur, src, env, hv), hv)
    sid = _stage(cur, src, env, v)
    for twin in loser_twins:
        winner = {**_mine(src, env), "stage_id": sid}
        record(cur, _staged_src(twin), twin["envelope"], _batch_verdict(winner, _mine(twin, twin["envelope"])),
               stage_id=twin["stage_id"])
    cur.execute("SELECT * FROM hub_med_staged WHERE stage_id = %s", (sid,))
    return preview_of_stage(cur.fetchone())


def _stage(cur, src: dict[str, Any], env: dict[str, Any], v: dict[str, Any]) -> str:
    cur.execute(
        "INSERT INTO hub_med_staged (source, file_name, name_key, drive_file_id, drive_revision, md5, "
        "native, modifier, bytes_sha256, content_fp, report_start, report_end, parser_version, envelope, "
        "verdict, actor_uid, actor_label) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
        "RETURNING stage_id",
        (src.get("source") or "upload", src.get("file_name") or "",
         (src.get("name") or name_key(src.get("file_name")))["key"], src.get("drive_file_id") or "",
         src.get("drive_revision") or "", src.get("md5") or "", bool(src.get("native")),
         src.get("modifier") or "", src.get("bytes_sha256") or "", env["content_fp"],
         env["period"]["start"], env["period"]["end"], env["v"], psycopg2.extras.Json(env),
         psycopg2.extras.Json({k: v[k] for k in ("verdict", "layers", "kind", "reason", "lines_new")}),
         str(src.get("actor_uid") or ""), str(src.get("actor_label") or "")))
    got = cur.fetchone()
    return got["stage_id"] if isinstance(got, dict) else got[0]


PILL = {"new": "New", "imported": "Imported", "duplicate": "Already on file", "held": "Held — needs a person",
        "invalid": "Not a pharmacy report", "failed": "Could not be read"}


def preview_of(row: dict[str, Any], v: dict[str, Any] | None = None) -> dict[str, Any]:
    """A ledger row as the Import tab draws it."""
    outcome = row.get("outcome") or (v or {}).get("verdict")
    return {"stage_id": row.get("stage_id") or "", "import_id": row.get("import_id") or "",
            "file_name": row.get("file_name") or "", "source": row.get("source") or "",
            "verdict": outcome, "pill": PILL.get(outcome, outcome), "reason": row.get("reason") or "",
            "layers": list(row.get("layers") or []), "duplicate_of": row.get("duplicate_of") or "",
            "start": _iso(row.get("report_start")), "end": _iso(row.get("report_end")),
            "lines": int(row.get("lines") or 0), "lines_new": int(row.get("lines_new") or 0),
            "patients": int(row.get("patients") or 0), "already": bool(row.get("already")),
            "native": bool(row.get("native"))}


def preview_of_stage(row: dict[str, Any]) -> dict[str, Any]:
    env = row["envelope"]
    v = row.get("verdict") or {}
    return {"stage_id": row["stage_id"], "import_id": "", "file_name": row["file_name"],
            "source": row["source"], "verdict": "new", "pill": PILL["new"], "reason": v.get("reason") or "",
            "layers": [], "duplicate_of": "", "start": _iso(row.get("report_start")),
            "end": _iso(row.get("report_end")), "lines": env["counts"]["lines"],
            "lines_new": int(v.get("lines_new") or env["counts"]["lines"]),
            "patients": env["counts"]["patients"], "already": False, "native": bool(row["native"])}


def _iso(v: Any) -> str:
    if v is None:
        return ""
    return v.isoformat() if hasattr(v, "isoformat") else str(v)


def _lane_tx(dsn: str):
    """A connection whose first statement takes the lane lock (transaction form: a lock left on a pooled…"""
    conn = _connect(dsn)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(f"SELECT pg_advisory_xact_lock(%s, {_KEY_SQL})", (LOCK_NS, LANE_KEY))
    return conn, cur


def _expire_uploads(cur) -> int:
    cur.execute("DELETE FROM hub_med_staged WHERE source = 'upload' AND drive_file_id = '' "
                "AND created_at < now() - make_interval(secs => %s)", (UPLOAD_STAGE_TTL_S,))
    return cur.rowcount or 0


def expire_uploads(dsn: str) -> int:
    """A dropped file nobody imported leaves no parse behind: asked by every sweep and at start, whether or not…"""
    ensure_schema(dsn)
    conn, cur = _lane_tx(dsn)
    try:
        gone = _expire_uploads(cur)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    if gone:
        _changed()
    return gone


# ═══════════════════════════════════════════════════════════════════════════ A DROPPED FILE…
def preview_upload(dsn: str, *, name: str, data: bytes, actor: dict[str, Any]) -> dict[str, Any]:
    """Parse once, judge, and stage (new) or record (everything else)."""
    ensure_schema(dsn)
    name = " ".join(str(name or "").split())[:300] or "unnamed.xlsx"
    if not is_report_name(name):
        # NOT A REPORT BY ITS NAME: answered, never recorded — the ledger keeps no row (no name, no fingerprint) of…
        iv = {"kind": "invalid", "why": "Only .xlsx pharmacy reports are read — it was not kept."}
        return {**preview_of({"file_name": name, "source": "upload", "outcome": "invalid",
                              "reason": _sentence(iv), "layers": ["name"]}), "recorded": False}
    src = {"source": "upload", "file_name": name, "name": name_key(name),
           "md5": hashlib.md5(data).hexdigest(), "bytes_sha256": hashlib.sha256(data).hexdigest(),  # noqa: S324
           "actor_uid": actor.get("uid", ""), "actor_label": actor.get("label", "")}
    if len(data) > MAX_BYTES:
        env = _invalid("The file is larger than 5 MB — not a pharmacy report.", "too_large")
    else:
        try:
            env = parse(data)
        except Exception as exc:  # noqa: BLE001 — a parser that crashed is FAILED, never invalid
            log.warning("house meds: the parser crashed on an upload (%s)", type(exc).__name__)
            env = {"ok": False, "v": PARSER_VERSION, "crash": type(exc).__name__}
    conn, cur = _lane_tx(dsn)
    try:
        _expire_uploads(cur)
        if env.get("crash"):
            fv = {"kind": "failed", "why": f"the parser failed: {env['crash']}"}
            out = preview_of(record(cur, src, env, {"verdict": "failed", "layers": ["parser"], "kind": "failed",
                                                     "reason": _sentence(fv), "public_reason": _sentence(fv, True),
                                                     "detail": {}}))
        else:
            cur.execute("SELECT * FROM hub_med_staged WHERE md5 = %s ORDER BY stage_id LIMIT 1", (src["md5"],))
            waiting = cur.fetchone()
            if waiting:
                out = preview_of(record(cur, src, env, _batch_verdict(waiting, _mine(src, env))))
            else:
                out = decide(cur, src, env)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    _changed()
    return out


# ═══════════════════════════════════════════════════════════════════════════ THE DRIVE FOLDER — listed, and each…
_IDENTITY_SAID: set[str] = set()


def _drive() -> Any:
    """Drive, read-only, as the identity the relay is configured with: the delegated GOOGLE_IMPERSONATE_USER when…"""
    if DRIVE_FACTORY is not None:
        return DRIVE_FACTORY()
    try:
        from google.oauth2 import service_account  # noqa: PLC0415
        from googleapiclient.discovery import build  # noqa: PLC0415
        raw = (SA_PATH or "").strip()
        info = None
        if raw.startswith("{"):
            info = json.loads(raw)
        elif not raw.startswith("/") and len(raw) > 512:
            info = json.loads(base64.b64decode(raw))
        base = (service_account.Credentials.from_service_account_info(info, scopes=DRIVE_SCOPES)
                if info is not None else
                service_account.Credentials.from_service_account_file(raw, scopes=DRIVE_SCOPES))
        subject = (IMPERSONATE or "").strip()
        creds = base.with_subject(subject) if subject else base
        said = "delegated" if subject else "service account"
        if said not in _IDENTITY_SAID:
            _IDENTITY_SAID.add(said)
            log.info("house meds: the pharmacy folder is read as the %s", said)
        return build("drive", "v3", credentials=creds, cache_discovery=False)
    except Exception as exc:  # noqa: BLE001 — the type only: a message may carry the key
        raise DriveUnavailable(f"the Drive credential could not be used ({type(exc).__name__})") from None


def list_folder(drive: Any) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    token = None
    while True:
        resp = drive.files().list(
            q=f"'{FOLDER_ID}' in parents and trashed = false",
            fields="nextPageToken, files(id,name,mimeType,md5Checksum,size,modifiedTime,"
                   "lastModifyingUser(emailAddress,permissionId))",
            pageSize=200, pageToken=token, supportsAllDrives=True,
            includeItemsFromAllDrives=True).execute()
        files.extend(resp.get("files") or [])
        token = resp.get("nextPageToken")
        if not token:
            return files


def _download(drive: Any, f: dict[str, Any]) -> bytes:
    if f.get("mimeType") == GSHEET_MIME:
        return drive.files().export(fileId=f["id"], mimeType=XLSX_MIME).execute()
    return drive.files().get_media(fileId=f["id"], supportsAllDrives=True).execute()


def _folder_src(f: dict[str, Any], source: str, actor: dict[str, Any]) -> dict[str, Any]:
    native = f.get("mimeType") == GSHEET_MIME
    who = f.get("lastModifyingUser") or {}
    return {"source": source, "file_name": str(f.get("name") or ""), "name": name_key(f.get("name")),
            "drive_file_id": str(f.get("id") or ""), "drive_revision": str(f.get("modifiedTime") or ""),
            "md5": "" if native else str(f.get("md5Checksum") or ""), "native": native,
            "modifier": str(who.get("emailAddress") or who.get("permissionId") or ""),
            "size": int(f.get("size") or 0) if not native else 0,
            "actor_uid": actor.get("uid", ""), "actor_label": actor.get("label", "")}


def _failed_verdict(why: str, layer: str) -> dict[str, Any]:
    fv = {"kind": "failed", "why": why}
    return {"verdict": "failed", "layers": [layer], "kind": "failed", "reason": _sentence(fv),
            "public_reason": _sentence(fv, True), "duplicate_of": "", "detail": {}}


_FOLDER_HOLDER: dict[str, Any] = {}


def folder_read(dsn: str, *, actor: dict[str, Any], sweep: bool = False,
                limit: int | None = None) -> dict[str, Any]:
    """List the folder, skip every file already decided or staged WITHOUT downloading it, download at most…"""
    ensure_schema(dsn)
    limit = FOLDER_BATCH if limit is None else limit
    with _FolderGate(dsn) as gate:
        if not gate.held:
            return {"busy": True, "by": _FOLDER_HOLDER.get("by") or "another reader"}
        _FOLDER_HOLDER.update(by=actor.get("label") or "someone", since=time.time())
        try:
            return _folder_read_locked(dsn, actor=actor, sweep=sweep, limit=limit, still_held=gate.alive)
        finally:
            _FOLDER_HOLDER.clear()


class _FolderGate:
    """One folder read at a time, on a SESSION lock of an autocommit connection: no transaction sits open while…"""

    def __init__(self, dsn: str) -> None:
        self.dsn, self.conn, self.held = dsn, None, False

    def __enter__(self) -> "_FolderGate":
        self.conn = _connect(self.dsn)
        self.conn.autocommit = True
        with self.conn.cursor() as cur:
            cur.execute(f"SELECT pg_try_advisory_lock(%s, {_KEY_SQL})", (LOCK_NS, FOLDER_KEY))
            self.held = bool((cur.fetchone() or [False])[0])
        return self

    def alive(self) -> bool:
        try:
            with self.conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
            return True
        except Exception:  # noqa: BLE001 — a dead gate is said by stopping, never by raising
            return False

    def __exit__(self, *exc: Any) -> None:
        if self.conn is not None:
            try:
                if self.held:
                    with self.conn.cursor() as cur:
                        cur.execute(f"SELECT pg_advisory_unlock(%s, {_KEY_SQL})", (LOCK_NS, FOLDER_KEY))
            except Exception:  # noqa: BLE001 — closing releases it too
                pass
            try:
                self.conn.close()
            except Exception:  # noqa: BLE001
                pass
        self.conn, self.held = None, False


def _md5_verdict(same: dict[str, Any]) -> dict[str, Any]:
    """The folder file whose bytes a trusted ledger row already judged: an import (or a refusal as that import's…"""
    mv = {"kind": "md5", "other": _other(same)}
    if same["outcome"] == "invalid":
        return {"verdict": "invalid", "layers": ["md5", "shape"], "kind": "invalid", "reason": same["reason"],
                "public_reason": (same.get("detail") or {}).get("public_reason") or same["reason"],
                "duplicate_of": same["import_id"], "detail": {}}
    return {"verdict": "duplicate", "layers": ["md5"], "kind": "md5", "reason": _sentence(mv),
            "public_reason": _sentence(mv, True),
            "duplicate_of": same["duplicate_of"] if same["outcome"] == "duplicate" and same["duplicate_of"]
            else same["import_id"], "detail": {}}


# A ledger row whose md5 settles a folder file WITHOUT a download: only a verdict about the BYTES.
_MD5_TRUSTED = ("SELECT * FROM hub_med_imports WHERE md5 = %s AND superseded_by = '' AND ("
                " outcome = 'imported'"
                " OR (outcome = 'duplicate' AND detail->>'kind' = 'same')"
                " OR (outcome = 'invalid' AND drive_file_id <> '' AND parser_version >= %s"
                "     AND 'shape' = ANY(layers)))"
                " ORDER BY (outcome = 'imported') DESC, import_id LIMIT 1")


def _folder_read_locked(dsn: str, *, actor: dict[str, Any], sweep: bool, limit: int,
                        still_held: Callable[[], bool] = lambda: True) -> dict[str, Any]:
    source = "sweep" if sweep else "folder"
    out: dict[str, Any] = {"busy": False, "listed": 0, "reports": 0, "ignored": 0, "known": 0,
                           "staged": 0, "decided": [], "failed": 0, "remaining": 0, "downloaded": 0,
                           "empty_warning": False, "error": ""}
    try:
        drive = _drive()
        listed = list_folder(drive)
    except DriveUnavailable as exc:
        out["error"] = str(exc)
        _save_state(dsn, "folder", {"at": _now_iso(), "by": actor.get("label"), "error": out["error"]})
        return out
    except Exception as exc:  # noqa: BLE001 — a read that failed is a failure, never "nothing new"
        out["error"] = f"the folder could not be listed ({type(exc).__name__})"
        _save_state(dsn, "folder", {"at": _now_iso(), "by": actor.get("label"), "error": out["error"]})
        return out
    out["listed"] = len(listed)
    files = [f for f in listed if f.get("mimeType") == GSHEET_MIME or is_report_name(f.get("name"))]
    out["reports"] = len(files)
    out["ignored"] = len(listed) - len(files)
    todo: list[dict[str, Any]] = []
    conn, cur = _lane_tx(dsn)
    try:
        _expire_uploads(cur)
        cur.execute("SELECT count(*) AS n FROM hub_med_imports WHERE drive_file_id <> ''")
        had = int(cur.fetchone()["n"])
        if not listed and had:
            out["empty_warning"] = True
        for f in files:
            src = _folder_src(f, source, actor)
            # the file changed in Drive since it was staged: the old staging never outlives it (the same bytes…
            _retire_revisions(cur, src)
            on_file = _decision_on_file(cur, src["drive_file_id"], src["drive_revision"])
            if on_file and not (on_file["outcome"] == "invalid" and on_file["parser_version"] < PARSER_VERSION):
                out["known"] += 1
                continue
            cur.execute("SELECT stage_id FROM hub_med_staged WHERE drive_file_id = %s AND drive_revision = %s",
                        (src["drive_file_id"], src["drive_revision"]))
            if cur.fetchone():
                out["staged"] += 1
                continue
            if src["md5"]:
                cur.execute(_MD5_TRUSTED, (src["md5"], PARSER_VERSION))
                same = cur.fetchone()
                if same:
                    v = _md5_verdict(same)
                    out["decided"].append(preview_of(record(cur, src, {"ok": False, "v": PARSER_VERSION}, v)))
                    continue
                cur.execute("SELECT * FROM hub_med_staged WHERE md5 = %s ORDER BY stage_id LIMIT 1", (src["md5"],))
                waiting = cur.fetchone()
                if waiting and waiting["source"] == "upload" and not waiting["drive_file_id"]:
                    # the same bytes were dropped and wait: the staging becomes the folder file's (never…
                    cur.execute("UPDATE hub_med_staged SET source = %s, drive_file_id = %s, drive_revision = %s, "
                                "modifier = %s, file_name = %s, name_key = %s WHERE stage_id = %s",
                                (source, src["drive_file_id"], src["drive_revision"], src["modifier"],
                                 src["file_name"], src["name"]["key"], waiting["stage_id"]))
                    out["staged"] += 1
                    continue
                if waiting:
                    bv = _batch_verdict(waiting, {"md5": src["md5"], "file_name": src["file_name"]})
                    out["decided"].append(preview_of(record(cur, src, {"ok": False, "v": PARSER_VERSION}, bv)))
                    continue
            if src["size"] > MAX_BYTES:
                out["decided"].append(preview_of(record(cur, src, _invalid(
                    "The file is larger than 5 MB — not a pharmacy report.", "too_large"),
                    judge(cur, _invalid("The file is larger than 5 MB — not a pharmacy report.", "too_large"),
                          src))))
                continue
            if sweep:
                cur.execute("SELECT retry_at FROM hub_med_imports WHERE drive_file_id = %s AND drive_revision = %s "
                            "AND outcome = 'failed' AND retry_at > now() LIMIT 1",
                            (src["drive_file_id"], src["drive_revision"]))
                if cur.fetchone():
                    out["failed"] += 1
                    continue
            todo.append({"f": f, "src": src})
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    # TWINS TOGETHER: files that share a name key are downloaded in the same call, the binary before its native…
    groups: dict[str, list[dict[str, Any]]] = {}
    for item in todo:
        groups.setdefault(item["src"]["name"]["key"], []).append(item)
    ordered = [sorted(g, key=lambda it: (it["src"]["native"], it["src"]["file_name"]))
               for _, g in sorted(groups.items())]
    batch: list[dict[str, Any]] = []
    for g in ordered:
        if batch and len(batch) + len(g) > limit:
            break
        batch.extend(g)
    out["remaining"] = len(todo) - len(batch)
    for n, item in enumerate(batch):
        if not still_held():
            # THE GATE'S SESSION DIED: another reader may hold the folder now, so the rest waits for the next read…
            out["remaining"] += len(batch) - n
            out["gate_lost"] = True
            log.warning("house meds: the folder gate was lost mid-read; %d file(s) wait", len(batch) - n)
            break
        f, src = item["f"], item["src"]
        env: dict[str, Any] | None = None
        failure = ""
        try:
            data = _download(drive, f)
            out["downloaded"] += 1
            if not isinstance(data, (bytes, bytearray)):
                failure = "the download returned no bytes"
            elif not src["native"] and (len(data) != src["size"] or
                                        (src["md5"] and hashlib.md5(data).hexdigest() != src["md5"])):  # noqa: S324
                failure = f"the download was {len(data)} of {src['size']} bytes or its md5 differs"
            else:
                src["bytes_sha256"] = "" if src["native"] else hashlib.sha256(data).hexdigest()
                env = parse(bytes(data))
                if src["native"] and not env.get("ok") and env.get("unopenable"):
                    failure = "the export could not be opened"
                    env = None
        except Exception as exc:  # noqa: BLE001 — Drive or the parser: retried, never `invalid`
            failure = f"{type(exc).__name__}"
        conn, cur = _lane_tx(dsn)
        try:
            if failure or env is None:
                row = record(cur, src, {"ok": False, "v": PARSER_VERSION},
                             _failed_verdict(failure or "unknown", "download"))
                out["failed"] += 1
                out["decided"].append(preview_of(row))
            else:
                p = decide(cur, src, env)
                if p["verdict"] == "new":
                    out["staged"] += 1
                else:
                    out["decided"].append(p)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    out["previews"] = staged_previews(dsn, folder_only=False)
    _save_state(dsn, "folder", {"at": _now_iso(), "by": actor.get("label") or "", "listed": out["listed"],
                                "known": out["known"], "new": len(out["previews"]), "failed": out["failed"],
                                "remaining": out["remaining"], "error": "",
                                "empty_warning": out["empty_warning"], "sweep": sweep})
    _changed()
    return out


def staged_previews(dsn: str, *, folder_only: bool = False) -> list[dict[str, Any]]:
    ensure_schema(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM hub_med_staged " + ("WHERE drive_file_id <> '' " if folder_only else "")
                    + "ORDER BY report_start, stage_id")
        rows = cur.fetchall()
    return [preview_of_stage(r) for r in rows]


# ═══════════════════════════════════════════════════════════════════════════ THE COMMIT — one transaction per file…
class _LinesOnFile(Exception):
    def __init__(self, known: int):
        super().__init__(known)
        self.known = known


def _patient_group(cur, patid: str) -> list[str]:
    cur.execute("SELECT patid, same_as FROM hub_med_patients WHERE pharmacy = %s AND "
                "(patid = %s OR same_as = %s)", (PHARMACY, patid, patid))
    group = {patid}
    for r in cur.fetchall():
        group.add(r["patid"])
        if r["same_as"]:
            group.add(r["same_as"])
    return sorted(group)


def _roots(cur, lines: list[dict[str, Any]], start: str) -> list[tuple[str, str, str]]:
    """(rx_key, rx_root, maybe_same_as) per line."""
    keys = [rx_key_of(PHARMACY, ln) for ln in lines]
    cur.execute("SELECT rx_key, min(rx_root) AS rx_root FROM hub_med_dispenses WHERE rx_key = ANY(%s) "
                "GROUP BY rx_key", (keys,))
    known = {r["rx_key"]: r["rx_root"] for r in cur.fetchall()}
    here = set(keys)
    out = []
    for ln, key in zip(lines, keys):
        if key in known:
            out.append((key, known[key], ""))
            continue
        cur.execute(
            "SELECT DISTINCT ON (rx_key) rx_key, rx_root, qty_dispensed_to_date FROM hub_med_dispenses "
            "WHERE pharmacy = %s AND patid = ANY(%s) AND date_written = %s AND upper(physician) = %s "
            "AND qty_written IS NOT DISTINCT FROM %s::numeric AND report_end < %s AND NOT (rx_key = ANY(%s)) "
            "ORDER BY rx_key, report_end DESC",
            (PHARMACY, _patient_group(cur, ln["patid"]), ln["date_written"], ln["physician"].upper(),
             ln["qty_written"] or None, start, list(here)))
        cands = cur.fetchall()
        root, maybe = key, ""
        if cands:
            try:
                before = Decimal(ln["qty_dispensed_to_date"] or "0") - Decimal(ln["dispensed_in_period"] or "0")
            except InvalidOperation:
                before = None
            proven = {c["rx_root"] for c in cands
                      if before is not None and c["qty_dispensed_to_date"] is not None
                      and Decimal(c["qty_dispensed_to_date"]) == before}
            if len(proven) == 1:
                root = next(iter(proven))
            else:
                maybe = sorted(proven or {c["rx_root"] for c in cands})[0]
        out.append((key, root, maybe))
    return out


def _upsert_patients(cur, env: dict[str, Any]) -> None:
    end = env["period"]["end"]
    start = env["period"]["start"]
    for p in env["patients"]:
        seen = _fold(f"{p['first_name']} {p['last_name']}")
        cur.execute("SELECT * FROM hub_med_patients WHERE pharmacy = %s AND patid = %s FOR UPDATE",
                    (PHARMACY, p["patid"]))
        was = cur.fetchone()
        if not was:
            cur.execute("INSERT INTO hub_med_patients (pharmacy, patid, last_name, first_name, name_seen, "
                        "first_seen, last_seen, facilities) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                        (PHARMACY, p["patid"], p["last_name"], p["first_name"], seen, start, end,
                         p["facilities"]))
            continue
        later = str(was["last_seen"] or "") <= end
        facilities = sorted(set(was["facilities"] or []) | set(p["facilities"]))
        match, note = was["match"], was["match_note"]
        if later and seen != was["name_seen"] and match in ("auto", "person"):
            # the reported name stopped matching: a person confirms before any house manager sees these rows again
            match, note = "review", "this PatID now reports a different name"
        cur.execute("UPDATE hub_med_patients SET last_name = %s, first_name = %s, name_seen = %s, "
                    "first_seen = LEAST(first_seen, %s::date), last_seen = GREATEST(last_seen, %s::date), "
                    "facilities = %s, match = %s, match_note = %s, updated_at = now(), house_ver = house_ver + 1 "
                    "WHERE pharmacy = %s AND patid = %s",
                    (p["last_name"] if later else was["last_name"], p["first_name"] if later else was["first_name"],
                     seen if later else was["name_seen"], start, end, facilities, match, note,
                     PHARMACY, p["patid"]))


def _import_one(cur, row: dict[str, Any], actor: dict[str, Any], source: str | None) -> dict[str, Any]:
    env = row["envelope"]
    src = _staged_src(row)
    # a file the sweep found and a person imports is a folder import
    src["source"] = source or ("folder" if src["source"] == "sweep" else src["source"])
    if actor.get("label"):
        src["actor_uid"], src["actor_label"] = actor.get("uid", ""), actor.get("label", "")
    v = judge(cur, env, src)
    if v["verdict"] != "new":
        return {**preview_of(record(cur, src, env, v, stage_id=row["stage_id"])), "stage_id": row["stage_id"]}
    irow = _src_row(src, env, v, "imported", row["stage_id"])
    iid = _insert_import(cur, irow)
    if iid is None:
        raise psycopg2.IntegrityError("hub_med_imports_revision_once")
    roots = _roots(cur, env["lines"], env["period"]["start"])
    values = []
    for ln, (key, root, maybe) in zip(env["lines"], roots):
        values.append((row_id_of(PHARMACY, ln), key, root, iid, PHARMACY, ln["facility"], ln["report_start"],
                       ln["report_end"], ln["patid"], ln["drug"], ln["drug_norm"], ln["physician"],
                       ln["date_written"], ln["last_dispense"], ln["dispensed_in_period"],
                       ln["qty_written"] or None, ln["qty_remaining"] or None,
                       ln["qty_dispensed_to_date"] or None, ln["cutoff"] or None, ln["sig"], maybe))
    got = psycopg2.extras.execute_values(
        cur, "INSERT INTO hub_med_dispenses (row_id, rx_key, rx_root, import_id, pharmacy, facility, "
             "report_start, report_end, patid, drug, drug_norm, physician, date_written, last_dispense, "
             "dispensed_in_period, qty_written, qty_remaining, qty_dispensed_to_date, cutoff, sig, maybe_same_as) "
             "VALUES %s ON CONFLICT DO NOTHING RETURNING row_id", values, page_size=1000, fetch=True)
    if len(got) != len(values):
        raise _LinesOnFile(len(values) - len(got))
    cur.execute("UPDATE hub_med_imports SET lines_new = %s WHERE import_id = %s", (len(got), iid))
    _upsert_patients(cur, env)
    cur.execute("DELETE FROM hub_med_staged WHERE stage_id = %s", (row["stage_id"],))
    cur.execute("SELECT * FROM hub_med_imports WHERE import_id = %s", (iid,))
    return {**preview_of(cur.fetchone()), "stage_id": row["stage_id"]}


def _refused_by_database(cur, row: dict[str, Any], layer: str, outcome: str, known: int = 0,
                         actor: dict[str, Any] | None = None, source: str | None = None) -> dict[str, Any]:
    env = row["envelope"]
    src = _staged_src(row)
    src["source"] = source or ("folder" if src["source"] == "sweep" else src["source"])
    if actor and actor.get("label"):
        src["actor_uid"], src["actor_label"] = actor.get("uid", ""), actor.get("label", "")
    start, end = env["period"]["start"], env["period"]["end"]
    cur.execute("SELECT * FROM hub_med_imports WHERE outcome = 'imported' AND (content_fp = %s OR name_key = %s "
                "OR period && daterange(%s::date, %s::date, '[]')) ORDER BY import_id LIMIT 1",
                (env["content_fp"], row["name_key"], start, end))
    other = cur.fetchone()
    if layer == "lines" and other is None:
        cur.execute("SELECT i.* FROM hub_med_imports i JOIN hub_med_dispenses d USING (import_id) "
                    "WHERE d.pharmacy = %s AND d.patid = ANY(%s) ORDER BY i.import_id DESC LIMIT 1",
                    (PHARMACY, [ln["patid"] for ln in env["lines"]]))
        other = cur.fetchone()
    if layer == "lines":
        dv = {"kind": "lines", "known": known or env["counts"]["lines"], "other": _other(other or {}),
              "here": {"start": start, "end": end}}
    else:
        dv = {"kind": "database", "layer": layer, "outcome": outcome}
    v = {"verdict": outcome, "layers": [layer, "database"], "kind": dv["kind"], "reason": _sentence(dv),
         "public_reason": _sentence(dv, True), "duplicate_of": (other or {}).get("import_id", ""),
         "detail": {"database": True}}
    return {**preview_of(record(cur, src, env, v, stage_id=row["stage_id"])), "stage_id": row["stage_id"]}


def commit(dsn: str, stage_ids: Iterable[str], *, actor: dict[str, Any],
           source: str | None = None) -> dict[str, Any]:
    """Commit staged files in period order, one transaction each."""
    ensure_schema(dsn)
    wanted = list(dict.fromkeys(str(s).strip() for s in stage_ids if str(s).strip()))
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT stage_id, report_start FROM hub_med_staged WHERE stage_id = ANY(%s)", (wanted,))
        order = {r["stage_id"]: str(r["report_start"] or "") for r in cur.fetchall()}
    conn.close()
    wanted.sort(key=lambda s: (order.get(s, "9999"), s))
    results: list[dict[str, Any]] = []
    stopped = False
    for sid in wanted:
        res = _commit_stage(dsn, sid, actor, source)
        results.append(res)
        if res.get("verdict") == "failed":
            stopped = True
            break
    if any(r.get("verdict") == "imported" for r in results):
        try:
            auto_match(dsn)
        except Exception as exc:  # noqa: BLE001 — the match waits for the next rebuild
            log.warning("house meds: the auto-match could not run (%s)", type(exc).__name__)
    _changed()
    counts: dict[str, int] = {}
    for r in results:
        counts[r.get("verdict") or "?"] = counts.get(r.get("verdict") or "?", 0) + 1
    return {"results": results, "stopped": stopped, "counts": counts,
            "lines_new": sum(int(r.get("lines_new") or 0) for r in results if r.get("verdict") == "imported")}


def _commit_stage(dsn: str, sid: str, actor: dict[str, Any], source: str | None) -> dict[str, Any]:
    conn, cur = _lane_tx(dsn)
    row = None
    try:
        cur.execute("SELECT * FROM hub_med_staged WHERE stage_id = %s FOR UPDATE", (sid,))
        row = cur.fetchone()
        if row is None:
            # A RETRY AFTER A LOST ANSWER is answered from the ledger
            cur.execute("SELECT * FROM hub_med_imports WHERE stage_id = %s ORDER BY import_id DESC LIMIT 1", (sid,))
            done = cur.fetchone()
            conn.rollback()
            if done:
                return {**preview_of(done), "stage_id": sid, "already": True}
            return {"stage_id": sid, "verdict": "unknown", "pill": "Unknown",
                    "reason": "This file is no longer waiting — preview it again."}
        res = _import_one(cur, row, actor, source)
        conn.commit()
        return res
    except _LinesOnFile as exc:
        conn.rollback()
        return _second_tx(dsn, sid, "lines", "held", exc.known, actor, source)
    except psycopg2.IntegrityError as exc:
        conn.rollback()
        name = getattr(getattr(exc, "diag", None), "constraint_name", None) or (exc.args[0] if exc.args else "")
        layer, outcome = CONSTRAINT_LAYER.get(str(name), ("database", "held"))
        return _second_tx(dsn, sid, layer, outcome, 0, actor, source)
    except Exception as exc:  # noqa: BLE001 — failed, the staging kept for a retry
        conn.rollback()
        log.warning("house meds: the commit of %s failed (%s)", sid, type(exc).__name__)
        return {"stage_id": sid, "verdict": "failed", "pill": PILL["failed"],
                "reason": f"The import could not be written ({type(exc).__name__}). Nothing was imported; "
                          "it can be tried again.", "file_name": (row or {}).get("file_name", "")}
    finally:
        conn.close()


def _second_tx(dsn: str, sid: str, layer: str, outcome: str, known: int, actor: dict[str, Any],
               source: str | None) -> dict[str, Any]:
    conn, cur = _lane_tx(dsn)
    try:
        cur.execute("SELECT * FROM hub_med_staged WHERE stage_id = %s FOR UPDATE", (sid,))
        row = cur.fetchone()
        if row is None:
            conn.rollback()
            return {"stage_id": sid, "verdict": "unknown", "reason": "This file is no longer waiting."}
        res = _refused_by_database(cur, row, layer, outcome, known, actor, source)
        conn.commit()
        return res
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════ PATIENTS — by PatID, matched to a…
_NAME_APOS = re.compile("['’`]")
_NAME_NOT = re.compile(r"[^a-z0-9 ]")


def name_norm(value: Any) -> str:
    """Names.gs nameNorm_: lowercase, no accents, no punctuation, one space."""
    s = unicodedata.normalize("NFD", str(value or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = _NAME_APOS.sub("", s)
    s = _NAME_NOT.sub(" ", s)
    return " ".join(s.split())


_CLIENTS: dict[str, Any] = {"at": 0.0, "rows": None, "stamp": ""}


def clients() -> tuple[list[dict[str, Any]], str]:
    """The live clients source: [{client_key, name, house}] and its stamp."""
    if CLIENTS_READER is not None:
        return CLIENTS_READER()
    now = time.time()
    if _CLIENTS["rows"] is not None and now - _CLIENTS["at"] < 60:
        return _CLIENTS["rows"], _CLIENTS["stamp"]
    with open(CLIENTS_PATH, encoding="utf-8") as fh:
        data = json.load(fh)
    rows = [{"client_key": str(r.get("client_key") or r.get("id") or ""),
             "name": " ".join(str(r.get("name") or "").split()),
             "house": str(r.get("house") or "").strip()}
            for r in (data.get("rows") or []) if isinstance(r, dict) and str(r.get("name") or "").strip()]
    stamp = str(data.get("source_at") or data.get("built_at") or "")
    _CLIENTS.update(at=now, rows=rows, stamp=stamp)
    return rows, stamp


def auto_match(dsn: str) -> int:
    """Match PatIDs still `none` — filed under one of AUTO_FACILITIES at least once, and on EXACT normalized…"""
    try:
        rows, _stamp = clients()
    except Exception as exc:  # noqa: BLE001 — unmatched stays unmatched
        log.warning("house meds: the clients source could not be read (%s)", type(exc).__name__)
        return 0
    by_name: dict[str, list[dict[str, Any]]] = {}
    for c in rows:
        by_name.setdefault(name_norm(c["name"]), []).append(c)
    matched = 0
    conn, cur = _lane_tx(dsn)
    try:
        cur.execute("SELECT * FROM hub_med_patients WHERE pharmacy = %s ORDER BY patid", (PHARMACY,))
        patients = cur.fetchall()
        taken = {p["client_key"]: p["patid"] for p in patients if p["client_key"] and p["match"] != "none"}
        for p in patients:
            if p["match"] != "none":
                continue
            if not {str(f).strip().upper() for f in (p["facilities"] or [])} & AUTO_FACILITIES:
                # a name is not enough for a patient the pharmacy never filed under our facility: a person matches it
                continue
            hits = by_name.get(name_norm(f"{p['first_name']} {p['last_name']}"), [])
            if len(hits) == 1:
                key = hits[0]["client_key"]
                holder = taken.get(key)
                if holder and holder != p["patid"]:
                    cur.execute("UPDATE hub_med_patients SET match = 'ambiguous', client_key = %s, "
                                "match_note = %s, updated_at = now(), house_ver = house_ver + 1 "
                                "WHERE pharmacy = %s AND patid = %s",
                                (key, f"another PatID ({holder}) is matched to this client", PHARMACY, p["patid"]))
                    continue
                cur.execute("UPDATE hub_med_patients SET match = 'auto', client_key = %s, match_note = '', "
                            "matched_by = 'auto', matched_at = now(), updated_at = now(), house_ver = house_ver + 1 "
                            "WHERE pharmacy = %s AND patid = %s", (key, PHARMACY, p["patid"]))
                taken[key] = p["patid"]
                matched += 1
            elif len(hits) > 1:
                cur.execute("UPDATE hub_med_patients SET match = 'ambiguous', match_note = %s, updated_at = now(), "
                            "house_ver = house_ver + 1 WHERE pharmacy = %s AND patid = %s",
                            (f"{len(hits)} clients carry this name", PHARMACY, p["patid"]))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    if matched:
        _changed()
    return matched


def match(dsn: str, *, patid: str, client_key: str, by: str, same_as: str = "") -> dict[str, Any]:
    """A person's match (`person`), which confirms a `review` too."""
    ensure_schema(dsn)
    patid, client_key, same_as = str(patid or "").strip(), str(client_key or "").strip(), str(same_as or "").strip()
    known = {c["client_key"] for c in clients()[0]}
    if client_key and client_key not in known:
        raise ValueError("that client is not in the clients list")
    conn, cur = _lane_tx(dsn)
    try:
        cur.execute("SELECT * FROM hub_med_patients WHERE pharmacy = %s AND patid = %s FOR UPDATE", (PHARMACY, patid))
        was = cur.fetchone()
        if not was:
            raise LookupError("no such PatID")
        if same_as:
            cur.execute("SELECT 1 FROM hub_med_patients WHERE pharmacy = %s AND patid = %s", (PHARMACY, same_as))
            if not cur.fetchone() or same_as == patid:
                raise ValueError("the other PatID is not on file")
        cur.execute("UPDATE hub_med_patients SET client_key = %s, match = %s, match_note = '', same_as = %s, "
                    "matched_by = %s, matched_at = now(), name_seen = %s, updated_at = now(), "
                    "house_ver = house_ver + 1 WHERE pharmacy = %s AND patid = %s RETURNING *",
                    (client_key, "person" if client_key else "none", same_as, by,
                     _fold(f"{was['first_name']} {was['last_name']}"), PHARMACY, patid))
        row = dict(cur.fetchone())
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    _changed()
    return {"patid": row["patid"], "match": row["match"], "client_key": row["client_key"],
            "same_as": row["same_as"]}


# ═══════════════════════════════════════════════════════════════════════════ THE READ MODEL — rebuilt after a…
_MODEL: dict[str, Any] = {}
_MODEL_LOCK = threading.Lock()
# Bumped by every change: a rebuild that started before a change never installs what it read.
_MODEL_GEN = [0]


def _changed() -> None:
    with _MODEL_LOCK:
        _MODEL.clear()
        _MODEL_GEN[0] += 1


def _num_out(v: Any) -> str:
    if v is None:
        return ""
    return format(Decimal(v).normalize(), "f")


def rebuild(dsn: str) -> dict[str, Any]:
    """The whole read model from ONE snapshot of the tables (repeatable read), installed only when nothing…"""
    ensure_schema(dsn)
    with _MODEL_LOCK:
        gen = _MODEL_GEN[0]
    conn = _connect(dsn)
    conn.set_session(isolation_level="REPEATABLE READ", readonly=True)
    with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT import_id, received_at, source, actor_label, file_name, name_key, stage_id, "
                    "drive_file_id, md5, native, parser_version, pharmacy, facility, report_start, report_end, "
                    "lines, lines_new, patients, outcome, layers, reason, duplicate_of, house_state, house_at, "
                    "house_error, tries, superseded_by, detail->>'kind' AS kind FROM hub_med_imports "
                    "ORDER BY import_id")
        imports = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT * FROM hub_med_dispenses ORDER BY report_end, row_id")
        dispenses = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT * FROM hub_med_patients WHERE pharmacy = %s ORDER BY patid", (PHARMACY,))
        patients = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT key, value, at FROM hub_med_state")
        state = {r["key"]: {**(r["value"] or {}), "at": r["value"].get("at") if r["value"] else ""}
                 for r in cur.fetchall()}
    conn.close()
    imported = sorted((i for i in imports if i["outcome"] == "imported"), key=lambda i: i["report_start"])
    ends = sorted({i["report_end"] for i in imported})
    latest_end = ends[-1] if ends else None
    latest = imported[-1] if imported else None
    last_two = set(ends[-2:])
    families: dict[str, list[dict[str, Any]]] = {}
    for d in dispenses:
        families.setdefault(d["rx_root"], []).append(d)
    rx = []
    for root, rows in families.items():
        rows.sort(key=lambda r: (r["report_end"], r["row_id"]))
        last = rows[-1]
        ended = bool(last["cutoff"] and latest and last["cutoff"] < latest["report_start"])
        rx.append({
            "rx_root": root, "patid": last["patid"], "drug": last["drug"], "physician": last["physician"],
            "sig": last["sig"], "date_written": _iso(last["date_written"]),
            "last_dispense": _iso(last["last_dispense"]),
            "dispensed_in_period": _num_out(last["dispensed_in_period"]),
            "qty_written": _num_out(last["qty_written"]), "qty_remaining": _num_out(last["qty_remaining"]),
            "qty_dispensed_to_date": _num_out(last["qty_dispensed_to_date"]), "cutoff": _iso(last["cutoff"]),
            "report_end": _iso(last["report_end"]), "first_report_end": _iso(rows[0]["report_end"]),
            "reports_seen": len({r["import_id"] for r in rows}),
            "labels": sorted({r["drug"] for r in rows}),
            "sum_dispensed": _num_out(sum((Decimal(r["dispensed_in_period"]) for r in rows), Decimal(0))),
            "current": bool(last["report_end"] in last_two and not ended),
            "maybe_same_as": next((r["maybe_same_as"] for r in rows if r["maybe_same_as"]), ""),
            "facility": last["facility"],
        })
    # every medication reader gets the periods, so they carry the public name; the raw one stays in the writers'…
    periods = [{"import_id": i["import_id"], "start": _iso(i["report_start"]), "end": _iso(i["report_end"]),
                "file_name": public_name(i["file_name"]), "lines": i["lines"], "facility": i["facility"]}
               for i in imported]
    gaps = _gaps(imported)
    stamp = max([i["import_id"] for i in imports] or [""])
    match_stamp = max([_iso(p["updated_at"]) for p in patients] or [""])
    model = {"imports": imports, "rx": rx, "families": families, "patients": patients, "periods": periods,
             "gaps": gaps, "latest": {"start": _iso(latest["report_start"]), "end": _iso(latest["report_end"])}
             if latest else None, "latest_end": _iso(latest_end), "stamp": stamp, "match_stamp": match_stamp,
             "state": state, "built_at": time.time(), "dsn": dsn}
    with _MODEL_LOCK:
        if _MODEL_GEN[0] == gen:
            _MODEL.clear()
            _MODEL.update(model)
    return model


def _gaps(imported: list[dict[str, Any]]) -> list[dict[str, str]]:
    """The 15-day periods missing between the first report and the latest."""
    if not imported:
        return []
    first, last = imported[0]["report_start"], imported[-1]["report_end"]
    have = [(i["report_start"], i["report_end"]) for i in imported]
    gaps = []
    cur = first
    while cur <= last:
        end = cur + timedelta(days=PERIOD_DAYS - 1)
        if not any(s <= end and cur <= e for s, e in have):
            gaps.append({"start": cur.isoformat(), "end": end.isoformat()})
        cur = end + timedelta(days=1)
    return gaps


def model(dsn: str) -> dict[str, Any]:
    with _MODEL_LOCK:
        if _MODEL and _MODEL.get("dsn") == dsn:
            return dict(_MODEL)
    return rebuild(dsn)


def scope_of(who: dict[str, Any]) -> dict[str, Any]:
    """What a reader may see (who: shift_requests.viewer)."""
    role = str(who.get("role") or "").strip().lower()
    badges = {str(b).strip().upper() for b in (who.get("badges") or [])}
    base = {"reader": False, "writer": False, "every_house": False, "houses": [],
            "managers_readable": bool(who.get("managers_readable", True)), "why": ""}
    if role in REFUSED_ROLES or badges & REFUSED_BADGES:
        return {**base, "why": "The pharmacy's reports are not open to client or guardian accounts."}
    every = bool(who.get("decides_everywhere"))
    houses = sorted({str(h).strip().upper() for h in (who.get("manages") or []) if str(h).strip()})
    hm = HM_BADGE in badges or bool(houses)
    if every:
        return {**base, "reader": True, "writer": True, "every_house": True}
    if hm:
        why = "" if houses else ("The house managers could not be read, so no house is shown."
                                 if not base["managers_readable"] else
                                 "The hotline calendar names you as the manager of no house today.")
        return {**base, "reader": True, "houses": houses, "why": why}
    return {**base, "why": "The pharmacy's reports are open to the house managers of their houses and to "
                           "the badges that decide every house."}


def _initials(first: str, last: str) -> str:
    return "".join(w[:1].upper() + "." for w in (first.split()[:1] + last.split()[:1]) if w)


def _house_labels(dsn: str) -> dict[str, str]:
    try:
        import house_directory  # noqa: PLC0415
        return {code: row.get("label") or code for code, row in house_directory.read(DIRECTORY_DSN or dsn).items()}
    except Exception:  # noqa: BLE001 — the code alone is still the house
        return {}


def _visible(dsn: str, m: dict[str, Any], scope: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], str]:
    """patid → the patient as this reader may see them; and the clients stamp."""
    import house_directory  # noqa: PLC0415
    rows, stamp = clients()
    by_key = {c["client_key"]: c for c in rows}
    by_patid = {p["patid"]: p for p in m["patients"]}
    out: dict[str, dict[str, Any]] = {}
    for p in m["patients"]:
        head = by_patid.get(p["same_as"]) if p["same_as"] and p["same_as"] in by_patid else p
        client = by_key.get(head["client_key"]) if head["match"] in ("auto", "person") else None
        house = house_directory.code_of(client["house"]) if client and client.get("house") else ""
        sure = head["match"] in ("auto", "person") and p["match"] != "review"
        if scope.get("every_house"):
            ok = True
        else:
            ok = bool(sure and client and house and house in set(scope.get("houses") or []))
        if not ok:
            continue
        group = ("house" if sure and client and house else "nohouse" if sure and client else "unmatched")
        out[p["patid"]] = {
            "patid": p["patid"], "key": head["patid"], "group": group, "house": house,
            "client_key": client["client_key"] if client else "",
            "client_name": client["name"] if client else "",
            "initials": _initials(p["first_name"], p["last_name"]),
            "match": p["match"], "note": p["match_note"], "same_as": p["same_as"],
            "last_seen": _iso(p["last_seen"]), "facilities": list(p["facilities"] or []),
        }
    return out, stamp


def version_of(m: dict[str, Any], clients_stamp: str, scope: dict[str, Any], client: str = "") -> str:
    basis = json.dumps([m["stamp"], m["match_stamp"], clients_stamp,
                        bool(scope.get("every_house")), sorted(scope.get("houses") or []),
                        bool(scope.get("writer"))] + ([client] if client else []), separators=(",", ":"))
    return hashlib.sha1(basis.encode()).hexdigest()[:16]  # noqa: S324 — a change stamp, not a secret


def view_for(dsn: str, scope: dict[str, Any], *, since: str = "", client: str = "") -> dict[str, Any]:
    """The Medications tab and the hero, for one reader."""
    m = model(dsn)
    visible, stamp = _visible(dsn, m, scope)
    client = str(client or "").strip()
    if client:
        visible = {pid: p for pid, p in visible.items() if p["client_key"] == client and p["group"] != "unmatched"}
    version = version_of(m, stamp, scope, client)
    if since and since == version:
        return {"unchanged": True, "version": version}
    labels = _house_labels(dsn)
    rx = [r for r in m["rx"] if r["patid"] in visible]
    imports = m["imports"]
    counted = [i for i in imports if not i["superseded_by"]]
    ledger_summary = {
        "reports": sum(1 for i in counted if i["outcome"] == "imported"),
        "duplicates": sum(1 for i in counted if i["outcome"] == "duplicate"),
        "held": sum(1 for i in counted if i["outcome"] == "held"),
        "invalid": sum(1 for i in counted if i["outcome"] == "invalid"),
        "failed": sum(1 for i in counted if i["outcome"] == "failed"),
        "house_pending": sum(1 for i in counted if i["outcome"] != "failed" and i["house_state"] != "written")
        + sum(1 for p in m["patients"] if int(p.get("house_written_ver") or 0) < int(p.get("house_ver") or 0)),
    }
    facilities = []
    for p in m["periods"]:
        for fac in (p["facility"] or "").split("/"):
            if fac and (not facilities or facilities[-1]["facility"] != fac):
                facilities.append({"facility": fac, "from": p["start"]})
    patients = sorted(visible.values(), key=lambda p: (p["group"], p["house"], p["client_name"], p["patid"]))
    for p in patients:
        p["house_label"] = labels.get(p["house"], p["house"])
    out = {
        "version": version, "pharmacy": PHARMACY,
        "scope": {"every_house": bool(scope.get("every_house")), "houses": list(scope.get("houses") or []),
                  "writer": bool(scope.get("writer")), "why": scope.get("why") or ""},
        "latest": m["latest"], "periods": m["periods"], "gaps": m["gaps"], "facilities": facilities,
        "summary": ledger_summary, "patients": patients,
        "rx": [{**r, "patient": visible[r["patid"]]["key"]} for r in rx],
        "folder": (m["state"].get("folder") or {}), "sweep": (m["state"].get("sweep") or {}),
        "low_left": LOW_LEFT, "period_days": PERIOD_DAYS,
    }
    if scope.get("writer") and not client:
        out["ledger"] = [{k: _iso(v) if k in ("received_at", "report_start", "report_end", "house_at") else v
                          for k, v in i.items()} for i in reversed(imports)]
        out["clients"] = [{"client_key": c["client_key"], "name": c["name"],
                           "house": house_code(c.get("house"))} for c in clients()[0]]
        out["staged"] = staged_previews(dsn)
    return out


def house_code(house: Any) -> str:
    import house_directory  # noqa: PLC0415
    return house_directory.code_of(house) if house else ""


def rx_history(dsn: str, scope: dict[str, Any], key: str, *, client: str = "") -> dict[str, Any] | None:
    """One prescription family's rows across periods — or None, the SAME None for "not yours" as for "no such…"""
    m = model(dsn)
    rows = m["families"].get(str(key or ""))
    if not rows:
        return None
    visible, _stamp = _visible(dsn, m, scope)
    head = visible.get(rows[-1]["patid"])
    if head is None:
        return None
    client = str(client or "").strip()
    if client and (head["client_key"] != client or head["group"] == "unmatched"):
        return None
    hist = [{"report_start": _iso(r["report_start"]), "report_end": _iso(r["report_end"]), "drug": r["drug"],
             "physician": r["physician"], "date_written": _iso(r["date_written"]),
             "last_dispense": _iso(r["last_dispense"]), "dispensed_in_period": _num_out(r["dispensed_in_period"]),
             "qty_written": _num_out(r["qty_written"]), "qty_remaining": _num_out(r["qty_remaining"]),
             "qty_dispensed_to_date": _num_out(r["qty_dispensed_to_date"]), "cutoff": _iso(r["cutoff"]),
             "sig": r["sig"], "import_id": r["import_id"]} for r in rows]
    total = sum((Decimal(r["dispensed_in_period"]) for r in rows), Decimal(0))
    cumulative = rows[-1]["qty_dispensed_to_date"]
    return {"rx_root": key, "patient": visible[rows[-1]["patid"]]["key"], "rows": hist,
            "sum_dispensed": _num_out(total), "cumulative": _num_out(cumulative),
            "not_in_reports": _num_out((Decimal(cumulative) - total) if cumulative is not None else None)}


# ═══════════════════════════════════════════════════════════════════════════ THE SWEEP — unattended, and only the…
def _save_state(dsn: str, key: str, value: dict[str, Any]) -> None:
    try:
        with _connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("INSERT INTO hub_med_state (key, value, at) VALUES (%s, %s, now()) "
                        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()",
                        (key, psycopg2.extras.Json(value)))
        conn.close()
    except Exception as exc:  # noqa: BLE001 — the footer is a courtesy; the ledger is the record
        log.warning("house meds: the %s state could not be written (%s)", key, type(exc).__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sweep_due(dsn: str, now: float | None = None) -> bool:
    now = time.time() if now is None else now
    ensure_schema(dsn)
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT extract(epoch FROM at) FROM hub_med_state WHERE key = 'sweep'")
        got = cur.fetchone()
    conn.close()
    return not got or now - float(got[0]) >= SWEEP_S


def sweep(dsn: str) -> dict[str, Any]:
    """Read the folder unattended, then import ONLY a binary .xlsx with an md5 whose uploader already sent the…"""
    ensure_schema(dsn)
    expire_uploads(dsn)
    read = folder_read(dsn, actor=SWEEP_ACTOR, sweep=True)
    imported: list[str] = []
    if not read.get("busy") and not read.get("error"):
        for _ in range(8):
            with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT max(report_end) AS e FROM hub_med_imports WHERE outcome = 'imported'")
                latest = (cur.fetchone() or {}).get("e")
                cur.execute("SELECT DISTINCT modifier FROM hub_med_imports WHERE outcome = 'imported' "
                            "AND modifier <> '' AND source IN ('folder', 'sweep')")
                trusted = {r["modifier"] for r in cur.fetchall()}
                # the next report after the latest, a missing period between them or not: the data stays current, and
                # the gap stays said as missing on the strip
                cur.execute("SELECT stage_id FROM hub_med_staged WHERE drive_file_id <> '' AND NOT native "
                            "AND md5 <> '' AND modifier = ANY(%s) AND report_start > %s::date "
                            "ORDER BY report_start, stage_id LIMIT 1", (list(trusted), latest))
                nxt = cur.fetchone()
            conn.close()
            if latest is None or not trusted or not nxt:
                break
            res = commit(dsn, [nxt["stage_id"]], actor=SWEEP_ACTOR, source="sweep")
            if not res["results"] or res["results"][0].get("verdict") != "imported":
                break
            imported.append(res["results"][0].get("import_id", ""))
    _save_state(dsn, "sweep", {"at": _now_iso(), "imported": imported, "busy": bool(read.get("busy")),
                               "error": read.get("error") or "", "remaining": read.get("remaining", 0)})
    _changed()
    return {"read": {k: v for k, v in read.items() if k != "previews"}, "imported": imported}


# ═══════════════════════════════════════════════════════════════════════════ THE HOUSE COPY — ASA Data books, after…
HOUSE_HEADERS = {
    "med_imports": ["id", "received_at", "source", "actor", "file_name", "name_key", "drive_file_id",
                    "drive_revision", "md5", "parser_version", "bytes_sha256", "content_fp", "pharmacy",
                    "facility", "report_start", "report_end", "lines", "lines_new", "patients", "outcome",
                    "layers", "reason", "duplicate_of"],
    "med_dispenses": ["id", "rx_key", "rx_root", "import_id", "pharmacy", "facility", "report_start",
                      "report_end", "patid", "drug", "physician", "date_written", "last_dispense",
                      "dispensed_in_period", "qty_written", "qty_remaining", "qty_dispensed_to_date",
                      "cutoff", "sig"],
    "med_patients": ["id", "pharmacy", "patid", "last_name", "first_name", "first_seen", "last_seen",
                     "facilities", "client_key", "match", "same_as"],
}
HOUSE_BATCH = 50


def _cell(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, Decimal):
        return format(v.normalize(), "f")
    if isinstance(v, (list, tuple)):
        return ", ".join(str(x) for x in v)
    return v.isoformat() if hasattr(v, "isoformat") else str(v)


def _import_row(i: dict[str, Any]) -> list[str]:
    nk = name_key(i["file_name"])
    detail = i.get("detail") or {}
    return [_cell(x) for x in (
        i["import_id"], i["received_at"], i["source"], i["actor_label"], public_name(i["file_name"]),
        i["name_key"] if nk["kdp"] else "", i["drive_file_id"], i["drive_revision"], i["md5"],
        i["parser_version"], i["bytes_sha256"], i["content_fp"], i["pharmacy"], i["facility"],
        i["report_start"], i["report_end"], i["lines"], i["lines_new"], i["patients"], i["outcome"],
        i["layers"], detail.get("public_reason") or "", i["duplicate_of"])]


def _patient_row(p: dict[str, Any]) -> list[str]:
    return [_cell(x) for x in (
        f"{p['pharmacy']}|{p['patid']}", p["pharmacy"], p["patid"], p["last_name"], p["first_name"],
        p["first_seen"], p["last_seen"], p["facilities"], p["client_key"], p["match"], p["same_as"])]


def house_offer(dsn: str, now: float | None = None) -> list[dict[str, Any]]:
    """What the house copy still owes, as offers: an imported report with its lines, one per offer; refusals…"""
    ensure_schema(dsn)
    offers: list[dict[str, Any]] = []
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM hub_med_imports WHERE house_state <> 'written' AND outcome <> 'failed' "
                    "AND (house_next IS NULL OR house_next <= now()) ORDER BY import_id LIMIT 200")
        owed = cur.fetchall()
        refusals = [i for i in owed if i["outcome"] != "imported"]
        for i in owed:
            if i["outcome"] != "imported":
                continue
            cur.execute("SELECT * FROM hub_med_dispenses WHERE import_id = %s ORDER BY row_id", (i["import_id"],))
            lines = cur.fetchall()
            offers.append({"import_ids": [i["import_id"]], "patients": [], "tabs": {
                "med_imports": {"header": HOUSE_HEADERS["med_imports"], "rows": [_import_row(i)]},
                "med_dispenses": {"header": HOUSE_HEADERS["med_dispenses"], "rows": [[_cell(x) for x in (
                    d["row_id"], d["rx_key"], d["rx_root"], d["import_id"], d["pharmacy"], d["facility"],
                    d["report_start"], d["report_end"], d["patid"], d["drug"], d["physician"],
                    d["date_written"], d["last_dispense"], d["dispensed_in_period"], d["qty_written"],
                    d["qty_remaining"], d["qty_dispensed_to_date"], d["cutoff"], d["sig"])] for d in lines]},
            }})
        for k in range(0, len(refusals), HOUSE_BATCH):
            part = refusals[k:k + HOUSE_BATCH]
            offers.append({"import_ids": [i["import_id"] for i in part], "patients": [], "tabs": {
                "med_imports": {"header": HOUSE_HEADERS["med_imports"], "rows": [_import_row(i) for i in part]}}})
        cur.execute("SELECT * FROM hub_med_patients WHERE pharmacy = %s AND house_written_ver < house_ver "
                    "AND (house_next IS NULL OR house_next <= now()) ORDER BY patid LIMIT 200", (PHARMACY,))
        pats = cur.fetchall()
        for k in range(0, len(pats), HOUSE_BATCH):
            part = pats[k:k + HOUSE_BATCH]
            offers.append({"import_ids": [], "patients": [[p["patid"], int(p["house_ver"])] for p in part],
                           "tabs": {"med_patients": {"header": HOUSE_HEADERS["med_patients"],
                                                     "rows": [_patient_row(p) for p in part]}}})
    conn.close()
    return offers


def house_payload(offer: dict[str, Any]) -> dict[str, Any]:
    return {"tabs": offer["tabs"]}


def house_mark(dsn: str, offer: dict[str, Any], said: dict[str, Any] | None, failure: str = "") -> str:
    """`written` only when the door says every row sent is PRESENT (inserted, or already identical) in every tab…"""
    sent = {tab: len(part["rows"]) for tab, part in offer["tabs"].items()}
    present = (said or {}).get("present") or {}
    conflicts = (said or {}).get("conflicts") or {}
    ok = not failure and bool(said) and all(int(present.get(t) or 0) == n for t, n in sent.items()) \
        and not any(int(v or 0) for v in conflicts.values())
    why = "" if ok else (failure or str((said or {}).get("why") or "")
                         or f"present {present} of sent {sent}" + (f", conflicts {conflicts}" if conflicts else ""))
    state = "written" if ok else ("failed" if said else "pending")
    pats = [(str(p), int(v)) for p, v in (offer.get("patients") or [])]
    with _connect(dsn) as conn, conn.cursor() as cur:
        if ok:
            cur.execute("UPDATE hub_med_imports SET house_state = 'written', house_at = now(), house_error = '', "
                        "house_next = NULL WHERE import_id = ANY(%s)", (offer["import_ids"],))
            for patid, ver in pats:
                # the version SENT: a change made while the door wrote stays owed
                cur.execute("UPDATE hub_med_patients SET house_written_ver = GREATEST(house_written_ver, %s), "
                            "house_tries = 0, house_next = NULL, house_error = '' "
                            "WHERE pharmacy = %s AND patid = %s", (ver, PHARMACY, patid))
        else:
            cur.execute("UPDATE hub_med_imports SET house_state = %s, house_error = %s, "
                        "house_tries = house_tries + 1, house_next = now() + make_interval(secs => "
                        "LEAST(21600, 60 * power(2, house_tries))) WHERE import_id = ANY(%s)",
                        (state, why[:300], offer["import_ids"]))
            if pats:
                cur.execute("UPDATE hub_med_patients SET house_error = %s, house_tries = house_tries + 1, "
                            "house_next = now() + make_interval(secs => LEAST(21600, 60 * power(2, house_tries))) "
                            "WHERE pharmacy = %s AND patid = ANY(%s)", (why[:300], PHARMACY, [p for p, _v in pats]))
    conn.close()
    _changed()
    return state


def prepare(dsn: str) -> None:
    """At the relay's start: the tables, the expired drops, the matches still owed, the model."""
    ensure_schema(dsn)
    for step in (expire_uploads, auto_match):
        try:
            step(dsn)
        except Exception as exc:  # noqa: BLE001
            log.warning("house meds: %s could not run at start (%s)", step.__name__, type(exc).__name__)
    rebuild(dsn)
