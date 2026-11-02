"""Time Reconciliation's punches coming in (apps-script/Recon.gs reconUploadReport, reconImportLatest): a location
report kept on the server (documents/recon/reports/<id>/) and read — a CSV as it is, an .xlsx by openpyxl, anything
else through a Google Sheet made from its bytes, exported as CSV and deleted at once — or the master workbook's tabs
read off asa-hub-db; each punch cleaned, placed in its house, its person resolved and shaped as its time_punches row."""
from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, datetime, time as dtime, timezone
from pathlib import Path
from typing import Any

import drive as dr
import gsjs
import hubdb
import location_docs as LD
import locations as L
import names as N
import recon_detect as D
import recon_roster as RO
from gsjs import NY
from scope import Defer

REPORT_MAX = 15 * 1024 * 1024
SHEET_MIME = "application/vnd.google-apps.spreadsheet"
UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"
CONVERT_FAILED = "Could not convert the report to a Sheet (Drive copy failed)"
_SAFE_FILE = re.compile(r"[^A-Za-z0-9 ._()\-]+")
_FLOAT = re.compile(r"^[+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)")
_US_CELL = re.compile(r"^([0-9]{1,2})/([0-9]{1,2})/([0-9]{4}|[0-9]{2})"
                      r"(?:,?\s+([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?\s*([AaPp][Mm])?)?$")
_ISO_CELL = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[ T]([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?)?$")
_CLOCK = re.compile(r"^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?\s*([AaPp][Mm])?$")
_NUMBER = re.compile(r"^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$")
_DECIMAL_COMMA = re.compile(r"^\s*[+-]?[0-9]+,[0-9]+\s*$")

s_ = gsjs.str_


def base() -> Path:
    return LD.ROOT / "recon"


def js_parse_float(v: Any) -> float:
    """parseFloat(v)."""
    m = _FLOAT.match(gsjs.or_blank(v).lstrip(gsjs._TRIM) if v is not None else "undefined")
    if not m:
        return math.nan
    t = m.group(0)
    return math.copysign(math.inf, -1 if t.startswith("-") else 1) if t.lstrip("+-") == "Infinity" else float(t)


def _truthy(v: Any) -> bool:
    return not gsjs.falsy(v)


def _text(v: Any) -> str:
    """String(v) for a cell a report or a workbook handed over."""
    if isinstance(v, (datetime, date, dtime)):
        return str(v)
    return gsjs.js_str(v)


# ---- the report kept, then read ------------------------------------------------------------------------------------

def keep(data: bytes, filename: str, now: datetime) -> tuple[str, str]:
    """The original on the server before anything reads it (the archive Recon.gs kept in Drive): its id and path."""
    fid = uuid.uuid4().hex
    stamp = now.astimezone(NY).strftime("%Y-%m-%d_%H%M%S")
    name = _SAFE_FILE.sub("_", f"{stamp} - {filename}").strip(" ._")[:150] or stamp
    rel = f"reports/{fid}/{name}"
    target = base() / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, target)
    return fid, rel


def _cell(s: str) -> Any:
    """A converted book's CSV text as getValues would have handed the cell: a day or a moment, a clock, a number."""
    t = gsjs.trim(s)
    if not t:
        return ""
    m = _US_CELL.match(t)
    if m:
        y = int(m.group(3))
        y += (2000 if y < 50 else 1900) if len(m.group(3)) == 2 else 0
        h = int(m.group(4) or 0)
        if m.group(7):
            h = h % 12 + (12 if m.group(7).upper() == "PM" else 0)
        try:
            return datetime(y, int(m.group(1)), int(m.group(2)), h, int(m.group(5) or 0), int(m.group(6) or 0))
        except ValueError:
            return s
    m = _ISO_CELL.match(t)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4) or 0),
                            int(m.group(5) or 0), int(m.group(6) or 0))
        except ValueError:
            return s
    m = _CLOCK.match(t)
    if m:
        h = int(m.group(1))
        if m.group(4):
            h = h % 12 + (12 if m.group(4).upper() == "PM" else 0)
        if h < 24 and int(m.group(2)) < 60 and int(m.group(3) or 0) < 60:
            return dtime(h, int(m.group(2)), int(m.group(3) or 0))
        return s
    if _NUMBER.match(t):
        return float(t) if "." in t else int(t)
    return s


def _csv_rows(text: str) -> list[list[str]]:
    return [list(r) for r in csv.reader(io.StringIO(text))]


def converted_rows(text: str) -> list[list[Any]]:
    """A Google Sheet's CSV export, each cell typed back as getValues hands it."""
    return [[_cell(c) for c in r] for r in _csv_rows(text)]


def _xlsx_rows(data: bytes) -> list[list[Any]] | None:
    """The first sheet's values by openpyxl; None where openpyxl is not installed."""
    try:
        import openpyxl  # noqa: PLC0415 - asa-hub-app has it, the tools' containers may not
    except ImportError:
        return None
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001 - said as the parse's failure
        raise ValueError(f"the workbook could not be opened ({type(exc).__name__})") from exc
    try:
        return [list(r) for r in wb.worksheets[0].iter_rows(values_only=True)] if wb.worksheets else []
    finally:
        wb.close()


def drive_csv(drv: Any, data: bytes, mime: str) -> str:
    """The bytes made a Google Sheet once (asatech's own token, as Drive's OCR copy is made), its first sheet exported
    as CSV, the Sheet deleted at once."""
    owner = next((w for w in drv._usable() if drv._creds[w] == "owner"), None)
    tok = drv._token_or_none(owner) if owner is not None else ""
    if not tok:
        raise Defer("a report is converted only with asatech's own Drive token, and it gives none")
    auth = {"Authorization": f"Bearer {tok}"}
    boundary = "hub" + os.urandom(12).hex()
    meta = json.dumps({"name": f"_recon_tmp_{int(time.time() * 1000)}", "mimeType": SHEET_MIME}).encode()
    body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode() + meta +
            f"\r\n--{boundary}\r\nContent-Type: {mime}\r\n\r\n".encode() + data + f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request(UPLOAD_URL, data=body, method="POST",
                                 headers={**auth, "Content-Type": f"multipart/related; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req, timeout=dr.CONVERT_TIMEOUT_S) as res:
            tmp = str(json.loads(res.read()).get("id") or "")
    except (urllib.error.URLError, ValueError) as exc:
        dr.log.info("recon: a report was not converted (%s)", type(exc).__name__)
        raise ValueError(CONVERT_FAILED) from exc
    if not tmp:
        raise ValueError(CONVERT_FAILED)
    try:
        req = urllib.request.Request(f"{dr.API}/{urllib.parse.quote(tmp)}/export?mimeType=text%2Fcsv", headers=auth)
        try:
            with urllib.request.urlopen(req, timeout=dr.CONVERT_TIMEOUT_S) as res:
                return res.read(REPORT_MAX * 4 + 1).decode("utf-8", "replace")
        except urllib.error.URLError as exc:
            raise ValueError(f"the converted report could not be exported ({type(exc).__name__})") from exc
    finally:
        gone = urllib.request.Request(f"{dr.API}/{urllib.parse.quote(tmp)}", headers=auth, method="DELETE")
        try:
            urllib.request.urlopen(gone, timeout=dr.BYTES_TIMEOUT_S).close()
        except Exception as exc:  # noqa: BLE001 - the copy stays; nothing reads it
            dr.log.warning("recon: a report's reading copy was not deleted (%s)", type(exc).__name__)


def report_rows(reads: L.Reads, data: bytes, filename: str) -> list[list[Any]]:
    """reconReadReportRows_: a CSV parsed as it is (every cell text); an .xlsx read here; anything else through a
    Google Sheet, its cells typed back as getValues hands them."""
    if re.search(r"\.csv$", filename, re.IGNORECASE):
        return _csv_rows(data.decode("utf-8", "replace"))
    if data[:4] == b"PK\x03\x04":
        got = _xlsx_rows(data)
        if got is not None:
            return got
    return converted_rows(drive_csv(reads.need_drive(), data, "application/vnd.ms-excel"))


def report_time(v: Any) -> str:
    """reconReportTime_: a moment as 'hh:mm:ss AM' on its own clock, a day's fraction as 'h:mm:ss AM'."""
    if v is None or v == "":
        return ""
    if isinstance(v, (datetime, dtime)) or isinstance(v, date):
        h, m, sec = (v.hour, v.minute, v.second) if isinstance(v, (datetime, dtime)) else (0, 0, 0)
        return f"{(h % 12 or 12):02d}:{m:02d}:{sec:02d} {'PM' if h >= 12 else 'AM'}"
    if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v < 1:
        return _fraction(v)
    return gsjs.trim(_text(v))


def _fraction(v: float) -> str:
    total = int(gsjs.js_round(v * 86400))
    h = total // 3600
    ap = "PM" if h >= 12 else "AM"
    return f"{h % 12 or 12}:{D.pad2((total % 3600) // 60)}:{D.pad2(total % 60)} {ap}"


def _hours(v: Any) -> float:
    """typeof v === 'number' ? v : parseFloat(v) || 0 — a decimal comma read as the point it is ("2,63" is 2.63 hours,
    never parseFloat's 2: hours never reach the thousands a comma would group)."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    if isinstance(v, str) and _DECIMAL_COMMA.match(v):
        v = v.replace(",", ".")
    n = js_parse_float(v)
    return 0.0 if n != n or n == 0 else n


def _at(row: list, i: int) -> Any:
    return row[i] if i < len(row) else None


def clean_report_rows(rows: list[list[Any]], client_map: dict[str, str]) -> list[dict[str, Any]]:
    """reconCleanReportRows_: Location Report rows → cleaned punches (the day in B, the person in N past its nine-digit
    number, the clock in X and AA, the hours in AG, the consumers in AO, the work code in S)."""
    out = []
    for row in rows:
        day = _at(row, 1)
        if gsjs.falsy(day):
            continue
        d = day.date() if isinstance(day, datetime) else day if isinstance(day, date) else D.parse_date(day)
        if d is None or d.year < 2020:
            continue
        emp = gsjs.trim(_text(_at(row, 13))) if _truthy(_at(row, 13)) else ""
        if not emp:
            continue
        if len(emp) > 9:
            emp = gsjs.trim(emp[9:])
        start, end = report_time(_at(row, 23)), report_time(_at(row, 26))
        consumers = gsjs.trim(_text(_at(row, 40))) if _truthy(_at(row, 40)) else ""
        out.append({"date": d.isoformat(), "employeeRaw": emp,
                    "workCode": _text(_at(row, 18)) if _truthy(_at(row, 18)) else "", "startTime": start,
                    "endTime": end, "startMin": D.parse_time_min(start), "endMin": D.parse_time_min(end),
                    "hours": D.round2(_hours(_at(row, 32))), "consumers": consumers,
                    "location": locate(consumers, client_map)})
    return out


# ---- the houses ----------------------------------------------------------------------------------------------------

def client_house_map(reads: L.Reads) -> dict[str, str]:
    """reconClientHouseMap_: istHouses' client, house name and code (lower case) → the house code; inactive rows out."""
    out: dict[str, str] = {}
    for r in reads.hub_rows("ist_houses"):
        if gsjs.or_text(r.get("active") or "yes").lower() == "no":
            continue
        house = s_(r.get("house"))
        if not house:
            continue
        for v in (r.get("clientName"), r.get("houseName"), r.get("house")):
            k = s_(v).lower()
            if k:
                out[k] = house
    return out


def locate(consumers: Any, client_map: dict[str, str]) -> str:
    """reconLocate_: the first consumer on the punch that names a known client."""
    for part in gsjs.or_text(consumers).split(","):
        con = gsjs.trim(part).lower()
        if con and client_map.get(con):
            return client_map[con]
    return D.NOT_FOUND


# ---- the master workbook, off asa-hub-db ---------------------------------------------------------------------------

def _norm_head(h: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", gsjs.or_blank(h).lower())


def cell_time(raw: Any) -> str:
    """reconCellTime_ over the copy's text: a moment by its UTC clock, a time cell by its own clock ('h:mm:ss AM'), a
    day's fraction; anything else trimmed."""
    if raw is None or raw == "":
        return ""
    v = hubdb.typed(raw, "hub")
    if isinstance(v, gsjs.SheetDate):
        at = v.at.astimezone(timezone.utc)
        return f"{at.hour % 12 or 12}:{D.pad2(at.minute)}:{D.pad2(at.second)} {'PM' if at.hour >= 12 else 'AM'}"
    if isinstance(v, str):
        m = _CLOCK.match(gsjs.trim(v))
        if m:
            h = int(m.group(1))
            if m.group(4):
                h = h % 12 + (12 if m.group(4).upper() == "PM" else 0)
            if h < 24 and int(m.group(2)) < 60:
                return f"{h % 12 or 12}:{m.group(2)}:{D.pad2(int(m.group(3) or 0))} {'PM' if h >= 12 else 'AM'}"
    if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v < 1:
        return _fraction(v)
    return gsjs.trim(gsjs.or_blank(v))


def _cell_day(raw: Any) -> date | None:
    v = hubdb.typed(raw, "hub")
    if isinstance(v, gsjs.SheetDate):
        return v.at.astimezone(NY).date()
    return D.parse_date(v)


def master_rows(ref: hubdb.TabRef, rows: list[tuple[int, dict]], client_map: dict[str, str]) -> list[dict[str, Any]]:
    """reconMasterRows_: `Cleaned Location` rows → cleaned punches, each keyed by its sheet row (the import's
    idempotency key)."""
    heads = [h for h in ref.headers if h != ""]

    def col(name: str) -> str | None:
        return next((h for h in heads if _norm_head(h) == name), None)
    c_date, c_emp, c_work, c_start, c_end, c_hours, c_cons, c_loc = (
        col(n) for n in ("dateofservice", "employee", "workcode", "starttime", "endtime", "totalhours", "consumers",
                         "location"))
    if c_date is None or c_emp is None:
        return []
    out = []
    for rn, raw in rows:
        d = _cell_day(raw.get(c_date))
        if d is None or d.year < 2020:
            continue
        emp = gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(c_emp), "hub")))
        if not emp:
            continue
        start = cell_time(raw.get(c_start)) if c_start else ""
        end = cell_time(raw.get(c_end)) if c_end else ""
        hours = _hours(hubdb.typed(raw.get(c_hours), "hub")) if c_hours else 0.0
        consumers = gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(c_cons), "hub"))) if c_cons else ""
        own = gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(c_loc), "hub"))) if c_loc else ""
        out.append({"date": d.isoformat(), "employeeRaw": emp,
                    "workCode": gsjs.or_blank(hubdb.typed(raw.get(c_work), "hub")) if c_work else "",
                    "startTime": start, "endTime": end, "startMin": D.parse_time_min(start),
                    "endMin": D.parse_time_min(end), "hours": D.round2(hours), "consumers": consumers,
                    "location": own or locate(consumers, client_map), "sourceKey": str(rn)})
    return out


def master_client_map(ref: hubdb.TabRef, rows: list[tuple[int, dict]]) -> dict[str, str]:
    """reconMasterClientMap_: `Client to Location` → {consumer lower case → house}; 'None' names no house."""
    heads = [h for h in ref.headers if h != ""]
    con_h = next((h for h in heads if _norm_head(h) == "consumers"), heads[0] if heads else None)
    loc_h = next((h for h in heads if _norm_head(h) == "location"), heads[1] if len(heads) > 1 else None)
    out: dict[str, str] = {}
    for _rn, raw in rows:
        con = gsjs.trim(gsjs.or_blank(raw.get(con_h))).lower() if con_h else ""
        loc = gsjs.trim(gsjs.or_blank(raw.get(loc_h))) if loc_h else ""
        if not con or not loc or loc.lower() == "none":
            continue
        out[con] = loc
    return out


def staff_map(ref: hubdb.TabRef, rows: list[tuple[int, dict]]) -> dict[str, dict[str, str]]:
    """reconStaffMapPairs_ then reconStaffMap_: `Staff Mapping`'s spellings side by side, read both ways."""
    heads = [h for h in ref.headers if h != ""]
    by_cal: dict[str, str] = {}
    by_sys: dict[str, str] = {}
    for values in [heads] + [[raw.get(h) for h in heads] for _rn, raw in rows]:
        for c in range(0, len(values) - 1, 2):
            cal, sys_ = gsjs.trim(gsjs.or_blank(values[c])), gsjs.trim(gsjs.or_blank(values[c + 1]))
            if not cal or not sys_ or re.match(r"^employee\s", cal, re.I) or re.match(r"^employee\s", sys_, re.I):
                continue
            ck, sk = N.norm(cal), N.norm(sys_)
            if ck:
                by_cal[ck] = sys_
            if sk:
                by_sys[sk] = cal
    return {"byCal": by_cal, "bySys": by_sys}


def translate_name(name: str, mapping: dict[str, dict[str, str]] | None) -> str:
    """reconTranslateName_."""
    if not mapping:
        return name
    k = N.norm(name)
    return mapping["byCal"].get(k) or mapping["bySys"].get(k) or name


def filter_new(cleaned: list[dict], existing: set[str]) -> tuple[list[dict], int]:
    """reconFilterNew_: the rows already stored (by sourceKey) skipped."""
    fresh = [c for c in cleaned if not (c.get("sourceKey") and c["sourceKey"] in existing)]
    return fresh, len(cleaned) - len(fresh)


def find_import(rows: list[dict], file_id: str) -> dict[str, Any]:
    """reconFindImport_: whether this source was stored before, and over which days."""
    lo, hi, n = "", "", 0
    for r in rows:
        if s_(r.get("sourceFile")) != file_id:
            continue
        n += 1
        d = s_(r.get("date"))
        if d and (not lo or d < lo):
            lo = d
        if d and (not hi or d > hi):
            hi = d
    return {"found": n > 0, "entries": n, "period": {"from": lo, "to": hi}}


# ---- the punches, as their rows -------------------------------------------------------------------------------------

def shape_punches(reads: L.Reads, cleaned: list[dict], source_file: str,
                  name_map: dict[str, dict[str, str]] | None = None) -> dict[str, Any]:
    """reconStorePunches_ before its writes: each punch's person resolved (the mapped spelling first, then the sheet's
    own), its time_punches row, and what the answer reports."""
    people, fp = RO.roster(reads)
    rows, unmapped, places = [], [], set()
    lo = hi = ""
    for c in cleaned:
        raw = c["employeeRaw"]
        translated = translate_name(raw, name_map) if name_map else raw
        who = RO.resolve(translated, people, fp)
        if not who["ok"] and translated != raw:
            again = RO.resolve(raw, people, fp)
            if again["ok"]:
                who = again
        if not who["ok"]:
            unmapped.append({"employeeRaw": raw, "reason": who["reason"], "candidates": who.get("candidates") or []})
        if c["location"] != D.NOT_FOUND:
            places.add(c["location"])
        if not lo or c["date"] < lo:
            lo = c["date"]
        if not hi or c["date"] > hi:
            hi = c["date"]
        rec = {"date": c["date"], "employeeRaw": raw, "employeeId": who["id"] if who["ok"] else "",
               "employeeName": who["name"] if who["ok"] else raw, "workCode": c["workCode"], "start": c["startTime"],
               "end": c["endTime"], "totalHours": D.num(c["hours"]), "consumers": c["consumers"],
               "location": c["location"], "sourceFile": c.get("sourceFile") or source_file}
        if c.get("sourceKey"):
            rec["sourceKey"] = c["sourceKey"]
        rows.append(rec)
    return {"rows": rows, "entries": len(rows), "locations": sorted(places), "unmapped": unmapped,
            "period": {"from": lo, "to": hi}}
