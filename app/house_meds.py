"""HOUSE SUPPLIES — THE PHARMACY'S MEDICATION REPORTS (server/house_meds.py), answered from asa-hub-db.
A dropped file and the pharmacy's folder are read by the import desk and its six-hourly sweep (house_meds_import.py);
what they read waits in hub_med_staged. Here: the
Medications tab and the hero for one reader, one prescription's history, a PatID matched to a client, and the
commit of the staged files — the same tables (schema `app`), the same SQL, under the platform's write lock."""
from __future__ import annotations

import contextlib
import contextvars
import hashlib
import json
import logging
import os
import re
import threading
import time
import types
import unicodedata
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Iterable, Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

import gsjs
import locations as L
import mw_shifts
import scope as sc
import writes as W

log = logging.getLogger("asa-hub-app.house_meds")

APP_ID = "house-supplies"
# the schema the tables live in; the relay's connection reads them with the same search_path
SCHEMA = os.getenv("HUB_HOUSE_MEDS_SCHEMA", "app").strip() or "app"

# ── the report's shape ──────────────────────────────────────────────────────
KEYS = ("report_start", "report_end", "last_name", "first_name", "physician", "drug",
        "dispensed_in_period", "last_dispense", "date_written", "cutoff", "qty_written",
        "qty_remaining", "qty_dispensed_to_date", "sig1", "sig2", "sig3", "facility", "patid")

# A verdict of `invalid` names the parser that gave it: a folder file judged invalid by an older version is read…
PARSER_VERSION = 1

# ── the lane ──────────────────────────────────────────────────────────────── The pharmacy is bound to the source…
PHARMACY = os.getenv("HUB_HOUSE_MEDS_PHARMACY", "A Brighter Dawn").strip() or "A Brighter Dawn"
LOCK_NS = int(os.getenv("HUB_HOUSE_MEDS_LOCK_NS", "8221"))
# The lock keys are hashed with the schema the connection writes in, so a test schema never waits on (or holds up)…
LANE_KEY = "lane"     # every decision and every commit
# A PatID is matched by name only when the pharmacy filed it under one of these facilities at least once: a…
AUTO_FACILITIES = frozenset(f.strip().upper() for f in os.getenv(
    "HUB_HOUSE_MEDS_AUTO_FACILITIES", "ASLIFE").split(",") if f.strip())
PERIOD_DAYS = 15
LOW_LEFT = 7
UNRECOGNISED = "(unrecognised file name)"

# Test hooks: code checks to skip (so the database's own refusal can be proved), and the clients source.
CHECKS_OFF: set[str] = set()
CLIENTS_READER: Callable[[], tuple[list[dict[str, Any]], str]] | None = None


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

# The second key of every lock: the lane's word hashed with the schema.
_KEY_SQL = "hashtext('house_meds|' || %s || '|' || current_schema())"


def _on_schema(cur) -> None:
    """The lane's tables, unqualified as the relay names them: this transaction reads and writes in SCHEMA."""
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", SCHEMA):
        raise RuntimeError("the house meds schema is not a plain name")
    cur.execute(f"SET LOCAL search_path TO {SCHEMA}")


def _lane(cur) -> None:
    """The lane lock, held to the end of this transaction: the relay's folder reads and commits wait on it too."""
    _on_schema(cur)
    cur.execute(f"SELECT pg_advisory_xact_lock(%s, {_KEY_SQL})", (LOCK_NS, LANE_KEY))


def make_tables(cur) -> None:
    """The lane's tables, made when missing (the relay's DDL, unchanged)."""
    _lane(cur)
    for stmt in DDL:
        cur.execute(stmt)


# ═══════════════════════════════════════════════════════════════════════════ NAMES — a report's file name, folded to one key…
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


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def rx_key_of(pharmacy: str, line: dict[str, Any]) -> str:
    return _sha(f"{pharmacy}|{line['patid']}|{line['drug_norm']}|{line['date_written']}")[:20]


def row_id_of(pharmacy: str, line: dict[str, Any]) -> str:
    return "MD-" + _sha(f"{pharmacy}|{line['report_start']}|{line['patid']}|{line['drug_norm']}|"
                        f"{line['date_written']}")[:20]


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
        "detail": Jsonb({**(v.get("detail") or {}),
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


def _staged_src(row: dict[str, Any]) -> dict[str, Any]:
    return {"source": row["source"], "file_name": row["file_name"], "name": name_key(row["file_name"]),
            "drive_file_id": row["drive_file_id"], "drive_revision": row["drive_revision"],
            "md5": row["md5"], "native": row["native"], "modifier": row["modifier"],
            "bytes_sha256": row["bytes_sha256"], "actor_uid": row["actor_uid"],
            "actor_label": row["actor_label"]}


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


def staged_previews(cur) -> list[dict[str, Any]]:
    cur.execute("SELECT * FROM hub_med_staged ORDER BY report_start, stage_id")
    return [preview_of_stage(r) for r in cur.fetchall()]


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
        raise psycopg.IntegrityError("hub_med_imports_revision_once")
    roots = _roots(cur, env["lines"], env["period"]["start"])
    values = []
    for ln, (key, root, maybe) in zip(env["lines"], roots):
        values.append((row_id_of(PHARMACY, ln), key, root, iid, PHARMACY, ln["facility"], ln["report_start"],
                       ln["report_end"], ln["patid"], ln["drug"], ln["drug_norm"], ln["physician"],
                       ln["date_written"], ln["last_dispense"], ln["dispensed_in_period"],
                       ln["qty_written"] or None, ln["qty_remaining"] or None,
                       ln["qty_dispensed_to_date"] or None, ln["cutoff"] or None, ln["sig"], maybe))
    got: list[Any] = []
    for k in range(0, len(values), 500):
        part = values[k:k + 500]
        marks = ", ".join(["(" + ", ".join(["%s"] * 21) + ")"] * len(part))
        cur.execute(
            "INSERT INTO hub_med_dispenses (row_id, rx_key, rx_root, import_id, pharmacy, facility, "
            "report_start, report_end, patid, drug, drug_norm, physician, date_written, last_dispense, "
            "dispensed_in_period, qty_written, qty_remaining, qty_dispensed_to_date, cutoff, sig, maybe_same_as) "
            f"VALUES {marks} ON CONFLICT DO NOTHING RETURNING row_id", [x for row in part for x in row])
        got += cur.fetchall()
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


def commit(cur, stage_ids: Iterable[str], *, actor: dict[str, Any], source: str | None = None) -> dict[str, Any]:
    """Commit staged files in period order, each in its own savepoint of the caller's locked transaction."""
    conn = cur.connection
    wanted = list(dict.fromkeys(str(s).strip() for s in stage_ids if str(s).strip()))
    cur.execute("SELECT stage_id, report_start FROM hub_med_staged WHERE stage_id = ANY(%s)", (wanted,))
    order = {r["stage_id"]: str(r["report_start"] or "") for r in cur.fetchall()}
    wanted.sort(key=lambda s: (order.get(s, "9999"), s))
    results: list[dict[str, Any]] = []
    stopped = False
    for sid in wanted:
        res = _commit_stage(conn, sid, actor, source)
        results.append(res)
        if res.get("verdict") == "failed":
            stopped = True
            break
    if any(r.get("verdict") == "imported" for r in results):
        try:
            with conn.transaction():
                auto_match(conn.cursor(row_factory=dict_row))
        except Exception as exc:  # noqa: BLE001 — the match waits for the next commit
            log.warning("house meds: the auto-match could not run (%s)", type(exc).__name__)
    counts: dict[str, int] = {}
    for r in results:
        counts[r.get("verdict") or "?"] = counts.get(r.get("verdict") or "?", 0) + 1
    return {"results": results, "stopped": stopped, "counts": counts,
            "lines_new": sum(int(r.get("lines_new") or 0) for r in results if r.get("verdict") == "imported")}


def _commit_stage(conn, sid: str, actor: dict[str, Any], source: str | None) -> dict[str, Any]:
    row = None
    try:
        with conn.transaction():
            cur = conn.cursor(row_factory=dict_row)
            cur.execute("SELECT * FROM hub_med_staged WHERE stage_id = %s FOR UPDATE", (sid,))
            row = cur.fetchone()
            if row is None:
                # A RETRY AFTER A LOST ANSWER is answered from the ledger
                cur.execute("SELECT * FROM hub_med_imports WHERE stage_id = %s ORDER BY import_id DESC LIMIT 1",
                            (sid,))
                done = cur.fetchone()
                if done:
                    return {**preview_of(done), "stage_id": sid, "already": True}
                return {"stage_id": sid, "verdict": "unknown", "pill": "Unknown",
                        "reason": "This file is no longer waiting — preview it again."}
            return _import_one(cur, row, actor, source)
    except _LinesOnFile as exc:
        return _second_tx(conn, sid, "lines", "held", exc.known, actor, source)
    except psycopg.IntegrityError as exc:
        diag = getattr(exc, "diag", None)
        name = getattr(diag, "constraint_name", None) or (exc.args[0] if exc.args else "")
        layer, outcome = CONSTRAINT_LAYER.get(str(name), ("database", "held"))
        return _second_tx(conn, sid, layer, outcome, 0, actor, source)
    except Exception as exc:  # noqa: BLE001 — failed, the staging kept for a retry
        log.warning("house meds: the commit of %s failed (%s)", sid, type(exc).__name__)
        return {"stage_id": sid, "verdict": "failed", "pill": PILL["failed"],
                "reason": f"The import could not be written ({type(exc).__name__}). Nothing was imported; "
                          "it can be tried again.", "file_name": (row or {}).get("file_name", "")}


def _second_tx(conn, sid: str, layer: str, outcome: str, known: int, actor: dict[str, Any],
               source: str | None) -> dict[str, Any]:
    with conn.transaction():
        cur = conn.cursor(row_factory=dict_row)
        cur.execute("SELECT * FROM hub_med_staged WHERE stage_id = %s FOR UPDATE", (sid,))
        row = cur.fetchone()
        if row is None:
            return {"stage_id": sid, "verdict": "unknown", "reason": "This file is no longer waiting."}
        return _refused_by_database(cur, row, layer, outcome, known, actor, source)


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


# the reads of the request answering now: the clients and the house registry are asa-hub-db's
_READS: contextvars.ContextVar[Any] = contextvars.ContextVar("house_meds_reads", default=None)


def clients() -> tuple[list[dict[str, Any]], str]:
    """The live clients source: [{client_key, name, house}] and its stamp — the Clients' own rows."""
    if CLIENTS_READER is not None:
        return CLIENTS_READER()
    reads = _READS.get()
    if reads is None:
        raise RuntimeError("no reads are bound for the clients source")
    rows = [{"client_key": gsjs.trim(gsjs.or_text(c.get("client_key"))),
             "name": " ".join(gsjs.or_text(c.get("name")).split()),
             "house": gsjs.trim(gsjs.or_text(c.get("house")))}
            for c in reads.client_rows() if gsjs.trim(gsjs.or_text(c.get("name")))]
    stamp = hashlib.sha1(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]  # noqa: S324
    return rows, stamp


def auto_match(cur) -> int:
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
    return matched


def match(cur, *, patid: str, client_key: str, by: str, same_as: str = "") -> dict[str, Any]:
    """A person's match (`person`), which confirms a `review` too."""
    patid, client_key, same_as = str(patid or "").strip(), str(client_key or "").strip(), str(same_as or "").strip()
    known = {c["client_key"] for c in clients()[0]}
    if client_key and client_key not in known:
        raise ValueError("that client is not in the clients list")
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
    return {"patid": row["patid"], "match": row["match"], "client_key": row["client_key"],
            "same_as": row["same_as"]}


# ═══════════════════════════════════════════════════════════════════════════ THE READ MODEL — rebuilt when the…
# tables changed (here, or in the relay's folder read, sweep and house copy): the stamp is read every time
_MODEL: dict[str, Any] = {}
_MODEL_LOCK = threading.Lock()
_STAMP_SQL = (
    "SELECT md5(coalesce((SELECT string_agg(import_id || outcome || house_state || coalesce(house_at::text, '') "
    "|| received_at::text || superseded_by || tries, ',' ORDER BY import_id) FROM hub_med_imports), '') || '|' || "
    "coalesce((SELECT string_agg(patid || updated_at::text || house_written_ver, ',' ORDER BY patid) "
    "FROM hub_med_patients), '') || '|' || (SELECT count(*) FROM hub_med_dispenses) || '|' || "
    "coalesce((SELECT string_agg(key || at::text, ',' ORDER BY key) FROM hub_med_state), '')) AS stamp")


def _num_out(v: Any) -> str:
    if v is None:
        return ""
    return format(Decimal(v).normalize(), "f")


def rebuild(conn) -> dict[str, Any]:
    """The whole read model from ONE snapshot of the tables (repeatable read)."""
    top = conn.info.transaction_status == psycopg.pq.TransactionStatus.IDLE
    with conn.transaction():
        cur = conn.cursor(row_factory=dict_row)
        if top:
            cur.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        _on_schema(cur)
        cur.execute(_STAMP_SQL)
        db_stamp = cur.fetchone()["stamp"]
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
    model_ = {"imports": imports, "rx": rx, "families": families, "patients": patients, "periods": periods,
              "gaps": _gaps(imported),
              "latest": {"start": _iso(latest["report_start"]), "end": _iso(latest["report_end"])} if latest else None,
              "latest_end": _iso(latest_end), "stamp": max([i["import_id"] for i in imports] or [""]),
              "match_stamp": max([_iso(p["updated_at"]) for p in patients] or [""]),
              "state": state, "built_at": time.time(), "db_stamp": db_stamp}
    with _MODEL_LOCK:
        _MODEL.clear()
        _MODEL.update(model_)
    return model_


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


def model(conn) -> dict[str, Any]:
    with conn.transaction():
        cur = conn.cursor(row_factory=dict_row)
        _on_schema(cur)
        cur.execute(_STAMP_SQL)
        db_stamp = cur.fetchone()["stamp"]
    with _MODEL_LOCK:
        if _MODEL and _MODEL.get("db_stamp") == db_stamp:
            return dict(_MODEL)
    return rebuild(conn)


def _initials(first: str, last: str) -> str:
    return "".join(w[:1].upper() + "." for w in (first.split()[:1] + last.split()[:1]) if w)


def house_code(house: Any) -> str:
    return mw_shifts.house_directory.code_of(house) if house else ""


def _house_labels() -> dict[str, str]:
    """code → label, from the house registry the Locations read (the relay's house_directory, same rows)."""
    reads = _READS.get()
    try:
        return {h["code"]: mw_shifts.house_directory.label_of(h.get("home_name"), h["code"]) or h["code"]
                for h in (reads.homes() if reads is not None else [])}
    except Exception:  # noqa: BLE001 — the code alone is still the house
        return {}


def _visible(m: dict[str, Any], scope: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], str]:
    """patid → the patient as this reader may see them; and the clients stamp."""
    rows, stamp = clients()
    by_key = {c["client_key"]: c for c in rows}
    by_patid = {p["patid"]: p for p in m["patients"]}
    out: dict[str, dict[str, Any]] = {}
    for p in m["patients"]:
        head = by_patid.get(p["same_as"]) if p["same_as"] and p["same_as"] in by_patid else p
        client = by_key.get(head["client_key"]) if head["match"] in ("auto", "person") else None
        house = house_code(client["house"]) if client and client.get("house") else ""
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


def view_for(conn, scope: dict[str, Any], *, since: str = "", client: str = "") -> dict[str, Any]:
    """The Medications tab and the hero, for one reader."""
    m = model(conn)
    visible, stamp = _visible(m, scope)
    client = str(client or "").strip()
    if client:
        visible = {pid: p for pid, p in visible.items() if p["client_key"] == client and p["group"] != "unmatched"}
    version = version_of(m, stamp, scope, client)
    if since and since == version:
        return {"unchanged": True, "version": version}
    labels = _house_labels()
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
        with conn.transaction():
            cur = conn.cursor(row_factory=dict_row)
            _on_schema(cur)
            out["staged"] = staged_previews(cur)
    return out


def rx_history(conn, scope: dict[str, Any], key: str, *, client: str = "") -> dict[str, Any] | None:
    """One prescription family's rows across periods — or None, the SAME None for "not yours" as for "no such…"""
    m = model(conn)
    rows = m["families"].get(str(key or ""))
    if not rows:
        return None
    visible, _stamp = _visible(m, scope)
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


# ═══════════════════════════════════════════════════════════════════════════ THE DOORS — the relay's lane decides
# who reads and with what scope (lane_house_meds*), and hands it here: never a screen's own payload
_BOUND: dict[str, Any] = {"store": None}
# the locked transaction's cursor while a write is decided (main._run_write)
HELD: contextvars.ContextVar[Any] = contextvars.ContextVar("house_meds_held", default=None)
SHUT = {"status": 403, "reason": "badge", "message": "The pharmacy's reports are not open to this account."}
WRITERS_ONLY = {"status": 403, "reason": "badge",
                "message": "Importing the pharmacy's reports is for the badges that decide every house."}


def bind(store: "Store") -> None:
    """The store the doors read and write through (main.py's own)."""
    _BOUND["store"] = store


def _conn():
    store = _BOUND["store"]
    if store is None or not store.ready():
        raise sc.Defer("the medication tables are not ready")
    return store.conn()


def scope_from(payload: dict[str, Any]) -> dict[str, Any] | None:
    """The relay's scope (house_meds.scope_of), as it was handed: None when it opens nothing."""
    s = payload.get("scope")
    if not isinstance(s, dict) or s.get("reader") is not True:
        return None
    return {"reader": True, "writer": s.get("writer") is True, "every_house": s.get("every_house") is True,
            "houses": sorted({str(h).strip().upper() for h in (s.get("houses") or []) if str(h).strip()})[:500],
            "managers_readable": s.get("managers_readable") is not False, "why": str(s.get("why") or "")[:300]}


@contextlib.contextmanager
def _reading(reads: L.Reads) -> Iterator[None]:
    token = _READS.set(reads)
    try:
        yield
    finally:
        _READS.reset(token)


def house_meds_view(sess: L.Session, payload: dict) -> dict[str, Any]:
    """houseMedsView: the Medications tab and the hero, or one client's prescriptions (`client`)."""
    scope = scope_from(payload)
    if scope is None:
        return dict(SHUT)
    with _reading(sess.reads):
        data = view_for(_conn(), scope, since=str(payload.get("since") or "")[:40],
                        client=str(payload.get("client") or "")[:120])
    return {"status": 200, "data": data}


def house_meds_rx(sess: L.Session, payload: dict) -> dict[str, Any]:
    """houseMedsRx: one prescription family across the reports."""
    scope = scope_from(payload)
    if scope is None:
        return dict(SHUT)
    with _reading(sess.reads):
        data = rx_history(_conn(), scope, str(payload.get("key") or "")[:64],
                          client=str(payload.get("client") or "")[:120])
    if data is None:
        return {"status": 404, "reason": "missing", "message": "No such prescription."}
    return {"status": 200, "data": data}


def _house_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """Locations' own door to one house: whoever Locations opens it to reads its residents' prescriptions whole,
    read-only — never a client or guardian account (another resident's prescriptions are not theirs)."""
    door = sess.read_door(payload, empty=True)
    if door.get("refused"):
        return {"refused": door["refused"]}
    if L.cut_viewer(door["scope"]):
        return {"refused": L.unknown()}
    return {"scope": {"reader": True, "writer": False, "every_house": False, "houses": [door["ctx"]["code"]],
                      "managers_readable": True, "why": ""}}


def location_medications(sess: L.Session, payload: dict) -> dict[str, Any]:
    """locationMedications: one house's residents and their prescriptions, for Locations › Supplies."""
    door = _house_door(sess, payload)
    if door.get("refused"):
        return door["refused"]
    with _reading(sess.reads):
        data = view_for(_conn(), door["scope"])
    return {"status": 200, "data": data}


def location_medication_history(sess: L.Session, payload: dict) -> dict[str, Any]:
    """locationMedicationHistory: one prescription of that house's residents, across the reports."""
    door = _house_door(sess, payload)
    if door.get("refused"):
        return door["refused"]
    with _reading(sess.reads):
        data = rx_history(_conn(), door["scope"], str(payload.get("key") or "")[:64])
    if data is None:
        return {"status": 404, "reason": "missing", "message": "No such prescription."}
    return {"status": 200, "data": data}


def house_supplies_inventory(sess: L.Session, payload: dict) -> dict[str, Any]:
    """houseSuppliesInventory: House Supplies › Inventory — every house Locations opens to this reader, each with what
    Locations › Supplies shows it (the consumables ledger and the house's assets), never a client's or guardian's."""
    reads = sess.reads
    houses = []
    for h in reads.homes():
        door = sess.read_door({"house": h["code"]})
        if door.get("refused") or L.cut_viewer(door["scope"]):
            continue
        got, why = L._soft(lambda: L.supplies_cut(L.supplies_part(reads, door["ctx"]), door["scope"]))
        houses.append({"code": h["code"], "title": h.get("home_name") or h["code"], "supplies": got,
                       "why": "" if got is not None else f"The house's supplies could not be read just now ({why})."})
    houses.sort(key=lambda x: x["title"].lower())
    return {"status": 200, "data": {"houses": houses}}


def _held():
    cur = HELD.get()
    if cur is None:
        raise sc.Defer("a medication write is decided only under the write lock")
    return cur


def house_meds_match(sess: L.Session, payload: dict) -> W.Decision:
    """houseMedsMatch: a PatID matched to a client by a person (or unmatched), final in hub_med_patients."""
    scope = scope_from(payload)
    if scope is None or not scope["writer"]:
        return W.Decision(dict(WRITERS_ONLY))
    conn = _held().connection
    by = str(payload.get("by") or "").strip()[:120] or W.who(sess.user)
    try:
        with _reading(sess.reads), conn.transaction():
            cur = conn.cursor(row_factory=dict_row)
            _lane(cur)
            got = match(cur, patid=str(payload.get("patid") or "")[:40],
                        client_key=str(payload.get("client_key") or "")[:120], by=by,
                        same_as=str(payload.get("same_as") or "")[:40])
    except LookupError as exc:
        return W.refuse(404, str(exc))
    except ValueError as exc:
        return W.refuse(400, str(exc))
    return W.Decision({"status": 200, "data": got})


def house_meds_commit(sess: L.Session, payload: dict) -> W.Decision:
    """houseMedsCommit: the staged files imported in period order, each file its own savepoint."""
    scope = scope_from(payload)
    if scope is None or not scope["writer"]:
        return W.Decision(dict(WRITERS_ONLY))
    staged = payload.get("stage_ids")
    staged = [str(s).strip()[:40] for s in staged if str(s).strip()][:50] if isinstance(staged, list) else []
    if not staged:
        return W.refuse(400, "Name the staged files to import.")
    actor = {"uid": str(payload.get("actor_uid") or "")[:80], "label": str(payload.get("actor_label") or "")[:120]}
    conn = _held().connection
    with _reading(sess.reads):
        cur = conn.cursor(row_factory=dict_row)
        _lane(cur)
        got = commit(cur, staged, actor=actor)
    return W.Decision({"status": 200, "data": got})


LANE_ROLES = ("admin", "director", "manager", "staff", "client", "guardian", "onboarding", "interviewer")
ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "houseMedsView": house_meds_view, "houseMedsRx": house_meds_rx,
    "locationMedications": location_medications, "locationMedicationHistory": location_medication_history,
    "houseSuppliesInventory": house_supplies_inventory}
POLICY: dict[str, dict[str, Any]] = {
    "houseMedsView": {"roles": LANE_ROLES, "params": {"scope": "object", "since": "string", "client": "string"}},
    "houseMedsRx": {"roles": LANE_ROLES, "params": {"scope": "object", "key": "string", "client": "string"}},
    # Locations' own roles and door (locations.POLICY): a client's is refused by the door itself
    "locationMedications": {"roles": L.POLICY_ROLES, "params": {"house": "string"}},
    "locationMedicationHistory": {"roles": L.POLICY_ROLES, "params": {"house": "string", "key": "string"}},
    "houseSuppliesInventory": {"roles": L.POLICY_ROLES, "params": {}}}
WRITE = types.SimpleNamespace(
    ACTIONS={"houseMedsMatch": house_meds_match, "houseMedsCommit": house_meds_commit},
    POLICY={"houseMedsMatch": {"roles": LANE_ROLES, "params": {
                "scope": "object", "patid": "string", "client_key": "string", "same_as": "string", "by": "string"}},
            "houseMedsCommit": {"roles": LANE_ROLES, "params": {
                "scope": "object", "stage_ids": "array", "actor_uid": "string", "actor_label": "string"}}})


class Store(W.Store):
    """app.house_meds_receipts beside the other apps' own, and the lane's tables (the relay reads and writes them)."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="house_meds", label="House Supplies")
        self._own = False

    def ensure(self) -> str:
        why = super().ensure()
        if why or self._own:
            return why
        with self._lock:
            if self._own:
                return ""
            try:
                c = self.conn()
                with c.transaction():
                    make_tables(c.cursor())
                self._own = True
            except Exception as exc:  # noqa: BLE001 - said on /healthz; the relay answers the lane meanwhile
                self._drop()
                self._ready = False
                self.why = f"the medication tables are not ready ({type(exc).__name__}: {str(exc)[:120]})"
        return self.why

    @contextlib.contextmanager
    def locked(self) -> Iterator[W.Tx]:
        with super().locked() as tx:
            token = HELD.set(tx.cur)
            try:
                yield tx
            finally:
                HELD.reset(token)
