"""HOUSE SUPPLIES — THE IMPORT DESK AND THE SWEEP (server/house_meds.py preview_upload, folder_read and sweep),
answered from asa-hub-db. A dropped report is parsed once, judged, and staged when new or recorded when not; the
pharmacy's Drive folder is read with every file already decided or staged skipped without a download and at most a
batch of new ones downloaded. Each decision is its own transaction under the lane lock, and one folder read runs at a
time under the lane's folder lock (the relay's own keys on the same tables, schema `app`). The six-hourly sweep
(app/clocks.py) reads the folder the same way and imports only the next trusted report. The folder is read as the
relay read it: the living-brain service account, delegated to GOOGLE_IMPERSONATE_USER."""
from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import zipfile
from contextlib import contextmanager
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Iterable, Iterator

from psycopg.rows import dict_row, tuple_row
from psycopg.types.json import Jsonb

import house_meds as HM
from house_meds import (CHECKS_OFF, KEYS, LANE_KEY, LOCK_NS, PARSER_VERSION, _decision_on_file, _iso, _sentence,
                        _sha, _staged_src, judge, name_key, preview_of, preview_of_stage, record)

log = logging.getLogger("asa-hub-app.house_meds")

# ── the report's shape ──────────────────────────────────────────────────────
SHEET = "KDP"
HEADER = ("Report Start", "Report End", "PatLName", "PatFName", "Physician", "DrugLabelName",
          "Sum of Dispenses", "Last Dispense Dt", "Date Written", "CutoffDt",
          "Total Quantity Written", "Quantity Remaining", "TotalQtyDispensed", "Sig", "Sig cont2",
          "Sig cont3", "FacID", "PatID")
DATE_KEYS = frozenset({"report_start", "report_end", "last_dispense", "date_written", "cutoff"})
NUM_KEYS = frozenset({"dispensed_in_period", "qty_written", "qty_remaining", "qty_dispensed_to_date"})
LABEL = dict(zip(KEYS, HEADER))

# ── the lane ────────────────────────────────────────────────────────────────
FOLDER_ID = os.getenv("HUB_HOUSE_MEDS_FOLDER_ID", "1DMU5OIAC-QChkNgGJsZKw7n3IqN9Im-G").strip()
FOLDER_KEY = "folder"
MAX_BYTES = 5 * 1024 * 1024
MAX_UNZIPPED = 40 * 1024 * 1024
MAX_MEMBERS = 200
FOLDER_BATCH = int(os.getenv("HUB_HOUSE_MEDS_FOLDER_BATCH", "6"))
UPLOAD_STAGE_TTL_S = 24 * 3600
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
GSHEET_MIME = "application/vnd.google-apps.spreadsheet"
# a lane transaction may wait on a commit holding the lane lock; the writer connection's own ceiling is shorter
LANE_STATEMENT_TIMEOUT = "120s"

# ── Drive ───────────────────────────────────────────────────────────────────
SA_FILE = os.getenv("HUB_HOUSE_MEDS_SA_FILE", "/app/.sa-living-brain.json").strip()
IMPERSONATE = os.getenv("GOOGLE_IMPERSONATE_USER", "jarvis@asalifecare.com").strip()
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
DRIVE_API = "https://www.googleapis.com/drive/v3/files"
DRIVE_TIMEOUT_S = 60.0

# Test hook: the Drive client.
DRIVE_FACTORY: Callable[[], Any] | None = None


class DriveUnavailable(RuntimeError):
    """The folder could not be read. Never "nothing new"."""


def is_report_name(name: Any) -> bool:
    return str(name or "").strip().lower().endswith(".xlsx")


# ═══════════════════════════════════════════════════════════════════════════ PARSE — once, into a JSON envelope
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


def content_fp(lines: Iterable[dict[str, Any]]) -> str:
    """sha256 over the SORTED lines, each the 18 normalized fields."""
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
        return ""
    if len(members) > MAX_MEMBERS:
        return f"The workbook holds {len(members)} parts — not a pharmacy report."
    if sum(max(0, m.file_size) for m in members) > MAX_UNZIPPED:
        return "The workbook unpacks to more than 40 MB — not a pharmacy report."
    return ""


def parse(data: bytes) -> dict[str, Any]:
    """The envelope — {ok, v, period, facility, lines, patients, content_fp, counts} — or {ok: False, reason…}."""
    import openpyxl  # noqa: PLC0415 - a missing one is a crash, not a verdict
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
    except Exception as exc:  # noqa: BLE001 - a workbook openpyxl refuses is not a report
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
    """The shape validation over parsed lines, and the envelope."""
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


# ═══════════════════════════════════════════════════════════════════════════ DECIDING — staged or recorded
def _rank(src: dict[str, Any]) -> int:
    """The batch tie-break: a folder file with a real extension and an md5, then a folder file, then an upload."""
    if src.get("source") in ("folder", "sweep"):
        return 3 if (src.get("md5") and not src.get("native")) else 2
    return 1


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
    """Judge one parsed file and either STAGE it (new — it waits for the Import button) or RECORD it."""
    fid, rev = src.get("drive_file_id") or "", src.get("drive_revision") or ""
    known = _decided_or_staged(cur, fid, rev)
    if known:
        return known
    if _retire_revisions(cur, src):
        return _decided_or_staged(cur, fid, rev) or {}
    v = judge(cur, env, src)
    if v["verdict"] != "new":
        return preview_of(record(cur, src, env, v), v)
    cur.execute("SELECT * FROM hub_med_staged WHERE content_fp = %s ORDER BY stage_id", (env["content_fp"],))
    twins = cur.fetchall()
    loser_twins = []
    for twin in twins:
        if _rank(src) > _rank(_staged_src(twin)):
            loser_twins.append(twin)
        else:
            bv = _batch_verdict(twin, _mine(src, env))
            return preview_of(record(cur, src, env, bv), bv)
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
         env["period"]["start"], env["period"]["end"], env["v"], Jsonb(env),
         Jsonb({k: v[k] for k in ("verdict", "layers", "kind", "reason", "lines_new")}),
         str(src.get("actor_uid") or ""), str(src.get("actor_label") or "")))
    got = cur.fetchone()
    return got["stage_id"] if isinstance(got, dict) else got[0]


# ═══════════════════════════════════════════════════════════════════════════ THE LANE'S TRANSACTIONS
@contextmanager
def _lane_tx(conn) -> Iterator[Any]:
    """One transaction whose first statements take the lane lock."""
    with conn.transaction():
        cur = conn.cursor(row_factory=dict_row)
        cur.execute(f"SET LOCAL statement_timeout = '{LANE_STATEMENT_TIMEOUT}'")
        HM._lane(cur)
        yield cur


def _expire_uploads(cur) -> int:
    cur.execute("DELETE FROM hub_med_staged WHERE source = 'upload' AND drive_file_id = '' "
                "AND created_at < now() - make_interval(secs => %s)", (float(UPLOAD_STAGE_TTL_S),))
    return cur.rowcount or 0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _save_state(conn, key: str, value: dict[str, Any]) -> None:
    try:
        with conn.transaction():
            cur = conn.cursor()
            HM._on_schema(cur)
            cur.execute("INSERT INTO hub_med_state (key, value, at) VALUES (%s, %s, now()) "
                        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()", (key, Jsonb(value)))
    except Exception as exc:  # noqa: BLE001 - the footer is a courtesy; the ledger is the record
        log.warning("house meds: the %s state could not be written (%s)", key, type(exc).__name__)


def staged_previews(conn) -> list[dict[str, Any]]:
    with conn.transaction():
        cur = conn.cursor(row_factory=dict_row)
        HM._on_schema(cur)
        return HM.staged_previews(cur)


# ═══════════════════════════════════════════════════════════════════════════ A DROPPED FILE
def preview_upload(conn, *, name: str, data: bytes, actor: dict[str, Any]) -> dict[str, Any]:
    """Parse once, judge, and stage (new) or record (everything else)."""
    name = " ".join(str(name or "").split())[:300] or "unnamed.xlsx"
    if not is_report_name(name):
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
        except Exception as exc:  # noqa: BLE001 - a parser that crashed is FAILED, never invalid
            log.warning("house meds: the parser crashed on an upload (%s)", type(exc).__name__)
            env = {"ok": False, "v": PARSER_VERSION, "crash": type(exc).__name__}
    with _lane_tx(conn) as cur:
        _expire_uploads(cur)
        if env.get("crash"):
            fv = {"kind": "failed", "why": f"the parser failed: {env['crash']}"}
            return preview_of(record(cur, src, env, {"verdict": "failed", "layers": ["parser"], "kind": "failed",
                                                     "reason": _sentence(fv), "public_reason": _sentence(fv, True),
                                                     "detail": {}}))
        cur.execute("SELECT * FROM hub_med_staged WHERE md5 = %s ORDER BY stage_id LIMIT 1", (src["md5"],))
        waiting = cur.fetchone()
        if waiting:
            return preview_of(record(cur, src, env, _batch_verdict(waiting, _mine(src, env))))
        return decide(cur, src, env)


# ═══════════════════════════════════════════════════════════════════════════ THE DRIVE FOLDER
_IDENTITY_SAID: set[str] = set()


class _Drive:
    """Drive, read-only, as the delegated account: the folder's listing and a file's bytes."""

    def __init__(self, creds: Any) -> None:
        self._creds, self._lock = creds, threading.Lock()

    def _token(self) -> str:
        with self._lock:
            if not self._creds.valid:
                from google.auth.transport.requests import Request  # noqa: PLC0415
                self._creds.refresh(Request())
            return str(self._creds.token)

    def _get(self, url: str, params: dict[str, Any], cap: int | None = None) -> bytes:
        req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}",
                                     headers={"Authorization": f"Bearer {self._token()}"})
        with urllib.request.urlopen(req, timeout=DRIVE_TIMEOUT_S) as res:
            return res.read() if cap is None else res.read(cap)

    def list_folder(self) -> list[dict[str, Any]]:
        files: list[dict[str, Any]] = []
        token = ""
        while True:
            params = {"q": f"'{FOLDER_ID}' in parents and trashed = false",
                      "fields": "nextPageToken, files(id,name,mimeType,md5Checksum,size,modifiedTime,"
                                "lastModifyingUser(emailAddress,permissionId))",
                      "pageSize": 200, "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}
            if token:
                params["pageToken"] = token
            resp = json.loads(self._get(DRIVE_API, params))
            files.extend(resp.get("files") or [])
            token = resp.get("nextPageToken") or ""
            if not token:
                return files

    def download(self, f: dict[str, Any]) -> bytes:
        # one byte past the ceiling is enough for the parser to refuse it whole
        fid = urllib.parse.quote(str(f["id"]))
        if f.get("mimeType") == GSHEET_MIME:
            return self._get(f"{DRIVE_API}/{fid}/export", {"mimeType": XLSX_MIME}, MAX_BYTES + 1)
        return self._get(f"{DRIVE_API}/{fid}", {"alt": "media", "supportsAllDrives": "true"}, MAX_BYTES + 1)


def _drive() -> Any:
    """Drive, read-only, as the relay reads the folder: the service account delegated to GOOGLE_IMPERSONATE_USER."""
    if DRIVE_FACTORY is not None:
        return DRIVE_FACTORY()
    try:
        from google.oauth2 import service_account  # noqa: PLC0415
        base = service_account.Credentials.from_service_account_file(SA_FILE, scopes=DRIVE_SCOPES)
        creds = base.with_subject(IMPERSONATE) if IMPERSONATE else base
    except Exception as exc:  # noqa: BLE001 - the type only: a message may carry the key
        raise DriveUnavailable(f"the Drive credential could not be used ({type(exc).__name__})") from None
    said = "delegated" if IMPERSONATE else "service account"
    if said not in _IDENTITY_SAID:
        _IDENTITY_SAID.add(said)
        log.info("house meds: the pharmacy folder is read as the %s", said)
    return _Drive(creds)


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
# the relay hashes the folder key with its connection's schema, which is SCHEMA
_FOLDER_LOCK_SQL = "hashtext('house_meds|' || %s || '|' || %s)"


def folder_read(conn, *, actor: dict[str, Any], sweep: bool = False, limit: int | None = None) -> dict[str, Any]:
    """List the folder, skip every file already decided or staged WITHOUT downloading it, download at most a batch
    of the new ones."""
    limit = FOLDER_BATCH if limit is None else limit
    with _FolderGate(conn) as gate:
        if not gate.held:
            return {"busy": True, "by": _FOLDER_HOLDER.get("by") or "another reader"}
        _FOLDER_HOLDER.update(by=actor.get("label") or "someone", since=time.time())
        try:
            return _folder_read_locked(conn, actor=actor, sweep=sweep, limit=limit, still_held=gate.alive)
        finally:
            _FOLDER_HOLDER.clear()


class _FolderGate:
    """One folder read at a time, on a SESSION lock of the thread's own connection, outside any transaction: no
    transaction sits open while Drive is read. An unlock that fails closes the connection, which lets it go."""

    def __init__(self, conn) -> None:
        self.conn, self.held = conn, False

    def __enter__(self) -> "_FolderGate":
        got = self.conn.cursor(row_factory=tuple_row).execute(
            f"SELECT pg_try_advisory_lock(%s, {_FOLDER_LOCK_SQL})", (LOCK_NS, FOLDER_KEY, HM.SCHEMA)).fetchone()
        self.held = bool((got or [False])[0])
        return self

    def alive(self) -> bool:
        try:
            self.conn.cursor(row_factory=tuple_row).execute("SELECT 1").fetchone()
            return True
        except Exception:  # noqa: BLE001 - a dead gate is said by stopping, never by raising
            return False

    def __exit__(self, *exc: Any) -> None:
        if not self.held:
            return
        try:
            self.conn.cursor(row_factory=tuple_row).execute(
                f"SELECT pg_advisory_unlock(%s, {_FOLDER_LOCK_SQL})", (LOCK_NS, FOLDER_KEY, HM.SCHEMA)).fetchone()
        except Exception:  # noqa: BLE001 - closing the session releases it too
            try:
                self.conn.close()
            except Exception:  # noqa: BLE001
                pass
        self.held = False


def _md5_verdict(same: dict[str, Any]) -> dict[str, Any]:
    """The folder file whose bytes a trusted ledger row already judged."""
    mv = {"kind": "md5", "other": HM._other(same)}
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


def _folder_read_locked(conn, *, actor: dict[str, Any], sweep: bool, limit: int,
                        still_held: Callable[[], bool] = lambda: True) -> dict[str, Any]:
    source = "sweep" if sweep else "folder"
    out: dict[str, Any] = {"busy": False, "listed": 0, "reports": 0, "ignored": 0, "known": 0,
                           "staged": 0, "decided": [], "failed": 0, "remaining": 0, "downloaded": 0,
                           "empty_warning": False, "error": ""}
    try:
        drive = _drive()
        listed = drive.list_folder()
    except DriveUnavailable as exc:
        out["error"] = str(exc)
        _save_state(conn, "folder", {"at": _now_iso(), "by": actor.get("label"), "error": out["error"]})
        return out
    except Exception as exc:  # noqa: BLE001 - a read that failed is a failure, never "nothing new"
        out["error"] = f"the folder could not be listed ({type(exc).__name__})"
        _save_state(conn, "folder", {"at": _now_iso(), "by": actor.get("label"), "error": out["error"]})
        return out
    out["listed"] = len(listed)
    files = [f for f in listed if f.get("mimeType") == GSHEET_MIME or is_report_name(f.get("name"))]
    out["reports"] = len(files)
    out["ignored"] = len(listed) - len(files)
    todo: list[dict[str, Any]] = []
    with _lane_tx(conn) as cur:
        _expire_uploads(cur)
        cur.execute("SELECT count(*) AS n FROM hub_med_imports WHERE drive_file_id <> ''")
        had = int(cur.fetchone()["n"])
        if not listed and had:
            out["empty_warning"] = True
        for f in files:
            src = _folder_src(f, source, actor)
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

    # TWINS TOGETHER: files that share a name key are downloaded in the same call, the binary before its native twin
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
            out["remaining"] += len(batch) - n
            out["gate_lost"] = True
            log.warning("house meds: the folder gate was lost mid-read; %d file(s) wait", len(batch) - n)
            break
        f, src = item["f"], item["src"]
        env: dict[str, Any] | None = None
        failure = ""
        try:
            data = drive.download(f)
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
        except Exception as exc:  # noqa: BLE001 - Drive or the parser: retried, never `invalid`
            failure = f"{type(exc).__name__}"
        with _lane_tx(conn) as cur:
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
    out["previews"] = staged_previews(conn)
    _save_state(conn, "folder", {"at": _now_iso(), "by": actor.get("label") or "", "listed": out["listed"],
                                 "known": out["known"], "new": len(out["previews"]), "failed": out["failed"],
                                 "remaining": out["remaining"], "error": "",
                                 "empty_warning": out["empty_warning"], "sweep": sweep})
    return out


# ═══════════════════════════════════════════════════════════════════════════ THE SWEEP — unattended, and only the
# next trusted report imported
SWEEP_S = float(os.getenv("HUB_HOUSE_MEDS_SWEEP_S", "21600"))
SWEEP_ACTOR = {"uid": "", "label": "the six-hourly sweep"}
SWEEP_IMPORTS = 8


def sweep_due(conn, now: float | None = None) -> bool:
    now = time.time() if now is None else now
    with conn.transaction():
        cur = conn.cursor(row_factory=tuple_row)
        HM._on_schema(cur)
        got = cur.execute("SELECT extract(epoch FROM at) FROM hub_med_state WHERE key = 'sweep'").fetchone()
    return not got or now - float(got[0]) >= SWEEP_S


def prepare(conn, reads: Any) -> int:
    """At the clock's start: the expired drops let go and the matches still owed made."""
    with _lane_tx(conn) as cur:
        _expire_uploads(cur)
    with HM._reading(reads), _lane_tx(conn) as cur:  # noqa: SLF001 - the clients the match reads
        return HM.auto_match(cur)


def _next_trusted(conn) -> str:
    """The next report after the latest imported one, a binary .xlsx with an md5 from a modifier whose folder reports
    were already imported; '' when there is none."""
    with conn.transaction():
        cur = conn.cursor(row_factory=dict_row)
        HM._on_schema(cur)
        latest = cur.execute("SELECT max(report_end) AS e FROM hub_med_imports WHERE outcome = 'imported'"
                             ).fetchone()["e"]
        trusted = {r["modifier"] for r in cur.execute(
            "SELECT DISTINCT modifier FROM hub_med_imports WHERE outcome = 'imported' AND modifier <> '' "
            "AND source IN ('folder', 'sweep')").fetchall()}
        if latest is None or not trusted:
            return ""
        nxt = cur.execute("SELECT stage_id FROM hub_med_staged WHERE drive_file_id <> '' AND NOT native AND md5 <> '' "
                          "AND modifier = ANY(%s) AND report_start > %s::date ORDER BY report_start, stage_id LIMIT 1",
                          (sorted(trusted), latest)).fetchone()
    return str(nxt["stage_id"]) if nxt else ""


def sweep(conn, reads: Any) -> dict[str, Any]:
    """Read the folder unattended, then import ONLY the next binary report whose uploader already sent the reports
    on file, one after another; the rest wait for a person on the Import tab."""
    with _lane_tx(conn) as cur:
        _expire_uploads(cur)
    read = folder_read(conn, actor=SWEEP_ACTOR, sweep=True)
    imported: list[str] = []
    if not read.get("busy") and not read.get("error"):
        for _ in range(SWEEP_IMPORTS):
            sid = _next_trusted(conn)
            if not sid:
                break
            with HM._reading(reads), _lane_tx(conn) as cur:  # noqa: SLF001
                res = HM.commit(cur, [sid], actor=SWEEP_ACTOR, source="sweep")
            if not res["results"] or res["results"][0].get("verdict") != "imported":
                break
            imported.append(res["results"][0].get("import_id", ""))
    _save_state(conn, "sweep", {"at": _now_iso(), "imported": imported, "busy": bool(read.get("busy")),
                                "error": read.get("error") or "", "remaining": read.get("remaining", 0)})
    return {"read": {k: v for k, v in read.items() if k != "previews"}, "imported": imported}


# ═══════════════════════════════════════════════════════════════════════════ THE DOORS' BLOCKING HALVES
def ready() -> bool:
    store = HM._BOUND["store"]
    return store is not None and store.ready()


def preview_now(*, name: str, data: bytes, actor: dict[str, Any]) -> dict[str, Any]:
    return preview_upload(HM._conn(), name=name, data=data, actor=actor)


def folder_now(*, actor: dict[str, Any]) -> dict[str, Any]:
    return folder_read(HM._conn(), actor=actor)
