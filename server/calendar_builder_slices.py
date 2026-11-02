"""Calendar Builder read side; the grid is read positionally because the mirror folds 28 day-columns into 7."""
from __future__ import annotations

import base64
import json
import logging
import os
import re
from datetime import date as _date, datetime, timedelta, timezone
from typing import Any

import psycopg2
import psycopg2.extras

import hub_db
import hub_rows
import shift_slices

try:  # the estate is Eastern; the container is UTC
    from zoneinfo import ZoneInfo
    ESTATE_TZ = ZoneInfo("America/New_York")
except Exception:  # noqa: BLE001 — fall back to UTC rather than fail to build
    ESTATE_TZ = timezone.utc

log = logging.getLogger("hub.calendarbuilder")

MASTER_SHEET_ID = "1_S62kl6hh0XG_3OK25X-AZYuYo3Apfm5oCAvvmdodfU"
GRID_TAB = "New Calendar"
TABLE_TAB = "New Calendar Table"
PREFS_TAB = "Staff Preferences"
REQUESTS_TAB = "Staff Requests"
HOUSES_TAB = "Houses"

SA_RAW = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "/app/service-account.json")
IMPERSONATE = os.getenv("GOOGLE_IMPERSONATE_USER", "jarvis@asalifecare.com")
GRID_SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

RESOURCES = {
    "calendarGrid",
    "calendarShifts",
    "calendarConflicts",
    "calendarHours",
    "calendarRequests",
    "calendarStaff",
    "calendarHouses",
}

REQUESTS_LOOKBACK_DAYS = 120

_GRID_CACHE: dict[str, Any] = {"at": None, "rows": None}
_GRID_CACHE_TTL_S = 240.0


# Never let the credential value reach an error message.
def _sheets_service():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build as gbuild
    raw = (SA_RAW or "").strip()
    info = None
    if raw.startswith("{"):
        info = json.loads(raw)
    elif not raw.startswith("/") and len(raw) > 512:
        try:
            info = json.loads(base64.b64decode(raw))
        except Exception:  # noqa: BLE001 — not base64 after all; try as a path
            info = None
    if info is not None:
        base = service_account.Credentials.from_service_account_info(info, scopes=GRID_SCOPES)
    else:
        base = service_account.Credentials.from_service_account_file(raw, scopes=GRID_SCOPES)
    creds = base
    try:
        probe = base.with_subject(IMPERSONATE)
        import google.auth.transport.requests as gtr
        probe.refresh(gtr.Request())
        creds = probe
    except Exception:  # noqa: BLE001 — plain SA still sees shared books
        log.info("calendar-builder: DWD as %s refused — plain SA lane", IMPERSONATE)
    return gbuild("sheets", "v4", credentials=creds, cache_discovery=False)


def _mirror_rows(dsn: str, tab: str) -> tuple[list[dict], str | None]:
    """The tab's rows in the sheet's order from asa-hub-db's copy, stamped with the moment its book is known
    current."""
    got = hub_rows.read(MASTER_SHEET_ID, tab)
    at = got["as_of"] if got["rows"] else 0.0
    return ([dict(d) for _rn, d in got["rows"]],
            datetime.fromtimestamp(at, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if at else None)


def _verified_stamp(dsn: str, fallback: str | None) -> str | None:
    """Stamp now only when the copy is known to hold the book as it stands, within the last half hour."""
    try:
        b = hub_rows.book(MASTER_SHEET_ID)
    except Exception:  # noqa: BLE001 — no proof, honest stamp
        return fallback
    now = datetime.now(timezone.utc)
    current = now.timestamp() - float(b.get("as_of") or 0.0) < 1800
    if b.get("status") == "ok" and not b.get("stale") and current:
        return now.strftime("%Y-%m-%dT%H:%M:%SZ")
    return fallback


_MD = re.compile(r"^(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?$")


def _infer_year(month: int, day: int, today: _date) -> int:
    best, best_d = today.year, None
    for y in (today.year - 1, today.year, today.year + 1):
        try:
            d = abs((_date(y, month, day) - today).days)
        except ValueError:
            continue
        if best_d is None or d < best_d:
            best, best_d = y, d
    return best


def _fetch_grid_matrix() -> list[list[str]]:
    sheets = _sheets_service()
    got = sheets.spreadsheets().values().get(
        spreadsheetId=MASTER_SHEET_ID,
        range=f"'{GRID_TAB}'!A1:AE500",
        valueRenderOption="FORMATTED_VALUE").execute()
    return got.get("values") or []


def _parse_grid(matrix: list[list[str]]) -> tuple[list[dict], list[dict]]:
    """Row 2 holds the dates in D..AE; staff rows carry house in A, designation in B, name in C."""
    today = datetime.now(ESTATE_TZ).date()
    dates: list[tuple[int, _date]] = []
    if len(matrix) >= 2:
        for ci, cell in enumerate(matrix[1]):
            m = _MD.match(str(cell).strip())
            if not m or ci < 3:
                continue
            month, day = int(m.group(1)), int(m.group(2))
            year = int(m.group(3)) if m.group(3) else _infer_year(month, day, today)
            if year < 100:
                year += 2000
            try:
                dates.append((ci, _date(year, month, day)))
            except ValueError:
                continue
    cols = [{"index": ci, "iso": d.isoformat(),
             "label": f"{d.month}/{d.day}",
             "weekday": d.strftime("%a").upper()} for ci, d in dates]

    rows: list[dict] = []
    for ri, raw in enumerate(matrix):
        if ri < 3:  # rows 1–3 are the masthead (weekdays, dates, a notes row)
            continue
        cells = [str(c).strip() for c in raw] + [""] * (32 - len(raw))
        house, designation, name = cells[0], cells[1], cells[2]
        if not name or name.lower() in ("employee name",):
            continue
        if house.upper() == "CLIENT":
            continue
        upper = name.upper()
        row_type = ("open" if upper == "OPEN"
                    else "workshop" if "WORKSHOP" in upper
                    else "staff")
        out_cells = []
        for col in cols:
            text = cells[col["index"]] if col["index"] < len(cells) else ""
            got = shift_slices.classify(text) if text else None
            out_cells.append({
                "date": col["iso"],
                "text": text,
                "kind": got["kind"] if got else "empty",
                "start": got.get("start") if got else None,
                "end": got.get("end") if got else None,
                "token": got.get("token") if got else None,
            })
        rows.append({
            "house": house,
            "designation": designation,
            "employee": name,
            "rowType": row_type,
            "sheetRow": ri + 1,
            "cells": out_cells,
        })
    return cols, rows


def forget_grid() -> None:
    """Call after a publish."""
    _GRID_CACHE.update(at=None, rows=None)


def _grid(dsn: str) -> tuple[list[dict], str | None]:
    """A leading period row carries the column layout so the page never infers it."""
    import time as _time
    now = _time.time()
    if _GRID_CACHE["rows"] is not None and _GRID_CACHE["at"] and \
            now - _GRID_CACHE["at"] < _GRID_CACHE_TTL_S:
        return _GRID_CACHE["rows"], None
    matrix = _fetch_grid_matrix()
    cols, rows = _parse_grid(matrix)
    period = {
        "house": "", "designation": "", "employee": "", "rowType": "period",
        "sheetRow": 0,
        "cells": cols,
        "start": cols[0]["iso"] if cols else "",
        "end": cols[-1]["iso"] if cols else "",
        "days": len(cols),
    }
    out = [period] + rows
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    _GRID_CACHE.update(at=now, rows=out)
    return out, stamp


def _appended_runs(dsn: str) -> set[str]:
    """Table Timestamps this hub appended, read off the publish log; unreadable means none."""
    out: set[str] = set()
    try:
        with hub_db.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT table_rows_json->0->>-1 "
                "FROM asa_cal_builder_publish_log "
                "WHERE jsonb_array_length(table_rows_json) > 0")
            out = {str(v[0]) for v in cur.fetchall() if v and v[0]}
    except Exception as exc:  # noqa: BLE001 — no proof of a kind is no claim
        log.warning("calendar-builder: publish log unreadable: %s", exc)
    return out


def _table_rows(dsn: str) -> tuple[list[dict], str | None]:
    """The newest full parse plus the publish appends after it; a lone append is never the roster."""
    rows, stamp = _mirror_rows(dsn, TABLE_TAB)
    if not rows:
        return rows, stamp
    appended = _appended_runs(dsn)
    runs = sorted({str(r.get("Timestamp") or "") for r in rows})
    parses = [t for t in runs if t not in appended]
    if parses:
        base = parses[-1]
        keep = {t for t in runs if t >= base}
    else:
        keep = {runs[-1]}
    current = [r for r in rows if str(r.get("Timestamp") or "") in keep]
    return (current or rows), _verified_stamp(dsn, stamp)


def _minutes(r: dict) -> float:
    """A blank Dur is unwritten, not zero: read the clock; a row with no clock is worth nothing."""
    dur = str(r.get("Dur") or "").strip()
    if dur:
        try:
            return float(dur) * 60.0
        except (TypeError, ValueError):
            pass
    raw_start, raw_end = str(r.get("Start") or "").strip(), str(r.get("End") or "").strip()
    if not raw_start or not raw_end:
        return 0.0
    try:
        sh, sm = (raw_start.split(":") + ["0"])[:2]
        eh, em = (raw_end.split(":") + ["0"])[:2]
        start, end = int(sh) * 60 + int(sm), int(eh) * 60 + int(em)
    except (TypeError, ValueError):
        return 0.0
    if end <= start:
        end += 24 * 60
    return float(end - start)


def _row_datetime(r: dict) -> tuple[datetime | None, datetime | None]:
    try:
        d = datetime.strptime(str(r.get("Date") or ""), "%m/%d/%Y")
    except ValueError:
        return None, None
    def _t(v: str) -> tuple[int, int]:
        parts = str(v or "0:0").split(":")
        return int(parts[0] or 0), int(parts[1] or 0) if len(parts) > 1 else 0
    try:
        sh, sm = _t(r.get("Start"))
        eh, em = _t(r.get("End"))
    except (TypeError, ValueError):
        return None, None
    start = d.replace(hour=sh, minute=sm)
    end = d.replace(hour=eh, minute=em)
    if end <= start:
        end += timedelta(days=1)
    return start, end


def _skip_staff(name: str, house: str) -> bool:
    low = (name or "").lower()
    return (not name or low == "open" or "workshop" in low
            or "workshop" in (house or "").lower())


def _clock(hour: float) -> str:
    """classify counts overnights past 24; the table writes the wall clock and readers restore the day."""
    minute = int(round(hour * 60)) % (24 * 60)
    return f"{minute // 60:02d}:{minute % 60:02d}"


def _period_draft(dsn: str, period_start: str) -> dict[tuple[int, str], str]:
    """(sheet row, date) → staged value via the write lane's own map, imported late to avoid a cycle."""
    if not period_start:
        return {}
    try:
        from calendar_builder_write import _draft_map
        return {(int(sr), str(d)): str(v.get("value") or "")
                for (sr, d), v in _draft_map(dsn, period_start).items()}
    except Exception as exc:  # noqa: BLE001 — the live grid still answers
        log.warning("calendar-builder: draft unreadable, grid alone: %s", exc)
        return {}


def _period_shifts(dsn: str) -> tuple[list[dict], str | None]:
    """The current period's staff cells (draft laid over) in the table's row shape; Dur stays empty."""
    rows, stamp = _grid(dsn)
    period = rows[0] if rows and rows[0].get("rowType") == "period" else {}
    draft = _period_draft(dsn, str(period.get("start") or ""))
    out: list[dict] = []
    for row in rows:
        if row.get("rowType") != "staff":
            continue
        house, staff = str(row.get("house") or ""), str(row.get("employee") or "")
        if _skip_staff(staff, house):
            continue
        sheet_row = int(row.get("sheetRow") or 0)
        for cell in row.get("cells") or []:
            iso = str(cell.get("date") or "")
            text = draft.get((sheet_row, iso), str(cell.get("text") or ""))
            got = shift_slices.classify(text) if text else None
            if not got or got.get("start") is None:
                continue
            try:
                day = _date.fromisoformat(iso)
            except ValueError:
                continue
            out.append({
                "Timestamp": stamp or "",
                "House": house,
                "Staff": staff,
                "D": str(row.get("designation") or ""),
                "Date": f"{day.month:02d}/{day.day:02d}/{day.year}",
                "Start": _clock(got["start"]),
                "End": _clock(got["end"]),
                "Dur": "",
            })
    return out, stamp


def _conflicts(shifts: list[dict], stamp: str | None) -> tuple[list[dict], str | None]:
    """The GAS Find Overlaps test: one person, overlapping intervals, any houses."""
    by_key: dict[str, list[dict]] = {}
    for r in shifts:
        staff = str(r.get("Staff") or "").strip()
        house = str(r.get("House") or "").strip()
        if _skip_staff(staff, house):
            continue
        start, end = _row_datetime(r)
        if start is None:
            continue
        by_key.setdefault(staff, []).append({**r, "_s": start, "_e": end})
    out: list[dict] = []
    for staff, rs in by_key.items():
        rs.sort(key=lambda r: r["_s"])
        for i in range(len(rs)):
            for j in range(i + 1, len(rs)):
                a, b = rs[i], rs[j]
                if b["_s"] >= a["_e"]:
                    break  # sorted: nothing later can still overlap a
                if a["_s"] < b["_e"] and b["_s"] < a["_e"]:
                    out.append({
                        "staff": staff,
                        "date": str(a.get("Date") or ""),
                        "houseA": str(a.get("House") or ""),
                        "startA": str(a.get("Start") or ""),
                        "endA": str(a.get("End") or ""),
                        "houseB": str(b.get("House") or ""),
                        "startB": str(b.get("Start") or ""),
                        "endB": str(b.get("End") or ""),
                    })
    return out, stamp


def _time_off_conflicts(dsn: str, shifts: list[dict], *, iso: bool = False) -> list[dict]:
    """A shift whose hours fall in scheduled time off (the overlap law's whole days), beside the double-bookings."""
    import time_off  # noqa: PLC0415 — lazy: it reads the estate through shift_requests
    away = time_off.away(dsn, [str(r.get("Staff") or "") for r in shifts])
    out: list[dict] = []
    for r in shifts:
        staff = str(r.get("Staff") or "").strip()
        start, end = _row_datetime(r)
        if start is None or end is None:
            continue
        for i in away.get(time_off.fold(staff), []):
            a, b = time_off.day_of(i["col_iso"]), time_off.day_of(i["until"])
            if not (a and b):
                continue
            lo, hi = (datetime.combine(x, datetime.min.time()) for x in (a, b + timedelta(days=1)))
            if start < hi and lo < end:
                out.append({"kind": "time_off", "staff": staff,
                            "date": start.date().isoformat() if iso else str(r.get("Date") or ""),
                            "houseA": str(r.get("House") or ""), "startA": str(r.get("Start") or ""),
                            "endA": str(r.get("End") or ""), "houseB": "Approved time off",
                            "startB": time_off.day_words(a), "endB": time_off.day_words(b),
                            "ref": i["ref"], "from": a.isoformat(), "until": b.isoformat()})
                break
    return out


def _hours(shifts: list[dict], stamp: str | None) -> tuple[list[dict], str | None]:
    per: dict[str, dict[str, Any]] = {}
    for r in shifts:
        staff = str(r.get("Staff") or "").strip()
        house = str(r.get("House") or "").strip()
        if _skip_staff(staff, house):
            continue
        try:
            d = datetime.strptime(str(r.get("Date") or ""), "%m/%d/%Y").date()
        except ValueError:
            continue
        hours = _minutes(r) / 60.0
        if hours <= 0:
            continue
        sat = d - timedelta(days=(d.weekday() + 2) % 7)
        slot = per.setdefault(staff, {"staff": staff, "totalHours": 0.0,
                                      "houses": set(), "weeks": {}})
        slot["totalHours"] += hours
        slot["houses"].add(house)
        wk = slot["weeks"].setdefault(sat.isoformat(), 0.0)
        slot["weeks"][sat.isoformat()] = wk + hours
    out = []
    for slot in per.values():
        weeks = slot["weeks"]
        n = len(weeks) or 1
        out.append({
            "staff": slot["staff"],
            "totalHours": round(slot["totalHours"], 2),
            "weeks": n,
            "perWeekAvg": round(slot["totalHours"] / n, 2),
            "houses": sorted(slot["houses"]),
            "weekly": [{"weekStart": k, "hours": round(v, 2)}
                       for k, v in sorted(weeks.items())],
        })
    out.sort(key=lambda r: -r["totalHours"])
    return out, stamp


_REQ_DATE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})")


def _req_date(value: str) -> _date | None:
    m = _REQ_DATE.match(str(value or "").strip())
    if not m:
        return None
    month, day, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if year < 100:
        year += 2000
    try:
        return _date(year, month, day)
    except ValueError:
        return None


def _requests(dsn: str) -> tuple[list[dict], str | None]:
    """The Time Off house's pending and scheduled rows once migrated; the form's own tab until then."""
    import time_off  # noqa: PLC0415 — lazy: it reads the estate through shift_requests
    if time_off.migrated(time_off.view(dsn)):
        return time_off.for_builder(dsn)
    return _form_requests(dsn)


def _form_requests(dsn: str) -> tuple[list[dict], str | None]:
    rows, stamp = _mirror_rows(dsn, REQUESTS_TAB)
    today = datetime.now(ESTATE_TZ).date()
    floor = today - timedelta(days=REQUESTS_LOOKBACK_DAYS)
    out = []
    for r in rows:
        start = _req_date(r.get("Time off (start date)"))
        end = _req_date(r.get("Time off (end date)")) or start
        ts = str(r.get("Timestamp") or "")
        if start is None:
            continue
        if (end or start) < floor:
            continue
        out.append({
            "timestamp": ts,
            "name": str(r.get("Your Name") or "").strip(),
            "startDate": start.isoformat(),
            "endDate": (end or start).isoformat(),
            "calendarName": str(r.get("Calendar Name") or "").strip(),
            "pending": (end or start) >= today,
            "state": "form", "ref": "",
        })
    out.sort(key=lambda r: r["startDate"])
    return out, _verified_stamp(dsn, stamp)


def _staff(dsn: str) -> tuple[list[dict], str | None]:
    rows, stamp = _mirror_rows(dsn, PREFS_TAB)
    out = [{
        "name": str(r.get("Select Your Name") or "").strip(),
        "shifts": str(r.get("SHIFTS") or "").strip(),
        "pickup": str(r.get("PICK UP Y/N") or "").strip(),
        "weekend": str(r.get("WEEKEND WORK") or "").strip(),
        "allergy": str(r.get("ALLERGY/FEAR") or "").strip(),
        "note": str(r.get("NOTE") or "").strip(),
    } for r in rows if str(r.get("Select Your Name") or "").strip()]
    out.sort(key=lambda r: r["name"].lower())
    return out, _verified_stamp(dsn, stamp)


def _houses(dsn: str) -> tuple[list[dict], str | None]:
    """Live calendar mirror joined by house code to the Houses tab, whose mirror is keyed on its first data row."""
    links: dict[str, dict] = {}
    rows, stamp = _mirror_rows(dsn, HOUSES_TAB)
    for r in rows:
        code = ""
        url = ""
        for key, value in r.items():
            v = str(value or "").strip()
            if key.strip().lower().startswith("http"):
                url = v
            elif not code and v and not v.lower().startswith("http"):
                code = v
        if code:
            m = re.search(r"/spreadsheets/d/([\w-]+)", url)
            links[code.strip().upper()] = {"house": code.strip(), "sheetUrl": url,
                                           "sheetId": m.group(1) if m else ""}
    live: dict[str, dict] = {}
    live_stamp = None
    try:
        with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT location, jsonb_array_length(grid->'rows'), updated_at "
                "FROM asa_house_calendar_live ORDER BY location")
            for location, n_rows, updated_at in cur.fetchall():
                parts = str(location).split(" - ")
                if len(parts) < 2:
                    continue
                code = parts[1].strip().upper()
                live[code] = {"tab": str(location), "staffRows": n_rows or 0,
                              "liveAt": str(updated_at or "")}
                if updated_at and (live_stamp is None or updated_at > live_stamp):
                    live_stamp = updated_at
    except Exception as exc:  # noqa: BLE001 — the links alone still answer
        log.warning("calendar-builder: house live mirror unreadable: %s", exc)
    out = []
    for code in sorted(set(links) | set(live)):
        entry = dict(links.get(code) or {"house": code.title(), "sheetUrl": "", "sheetId": ""})
        entry.update(live.get(code) or {"tab": "", "staffRows": 0, "liveAt": ""})
        entry["hasLiveGrid"] = code in live
        out.append(entry)
    stamp_out = None
    if live_stamp is not None:
        # the live lane upserts every row each pass, so a fresh updated_at proves the copy is current
        age = (datetime.now(timezone.utc) - live_stamp).total_seconds()
        if age < 35 * 60:
            return out, datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        stamp_out = live_stamp.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return out, stamp_out or _verified_stamp(dsn, stamp)


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    if resource == "calendarGrid":
        return _grid(dsn)
    if resource == "calendarShifts":
        return _table_rows(dsn)
    if resource == "calendarConflicts":
        shifts, stamp = _period_shifts(dsn)
        rows, stamp = _conflicts(shifts, stamp)
        return rows + _time_off_conflicts(dsn, shifts), stamp
    if resource == "calendarHours":
        shifts, stamp = _period_shifts(dsn)
        return _hours(shifts, stamp)
    if resource == "calendarRequests":
        return _requests(dsn)
    if resource == "calendarStaff":
        return _staff(dsn)
    if resource == "calendarHouses":
        return _houses(dsn)
    raise KeyError(f"calendar_builder_slices does not serve {resource!r}")
