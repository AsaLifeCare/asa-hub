"""Calendar Builder master grid: drafts with a pinned base, a fail-closed publish, a GAS-shaped table append."""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import psycopg2
import psycopg2.extras

import effective_roster
import hub_db
import shift_slices
from calendar_builder_slices import (
    MASTER_SHEET_ID, GRID_TAB, TABLE_TAB, REQUESTS_TAB,
    _fetch_grid_matrix, _parse_grid, _mirror_rows, _req_date,
    _skip_staff, _clock, ESTATE_TZ,
)

log = logging.getLogger("hub.calendarbuilder.write")

SA_RAW = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "/app/service-account.json")
IMPERSONATE = os.getenv("GOOGLE_IMPERSONATE_USER", "jarvis@asalifecare.com")
WRITE_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

# The live house-calendars workbook, one tab per house, mirrored into asa_house_calendar_live.
LIVE_HOUSES_SHEET_ID = "1ZL5EHUfx627VFJ9rRlv8D1J8ljZJvns8TZsUKj_oAe0"

DRAFT_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_cal_builder_draft ("
    "period_start DATE NOT NULL, "
    "sheet_row INT NOT NULL, "
    "date_iso DATE NOT NULL, "
    "house TEXT NOT NULL, "
    "employee TEXT NOT NULL, "
    "value TEXT NOT NULL DEFAULT '', "
    "base_value TEXT NOT NULL DEFAULT '', "
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "updated_by TEXT NOT NULL DEFAULT '', "
    "PRIMARY KEY (period_start, sheet_row, date_iso))"
)
PERIODS_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_cal_builder_periods ("
    "period_start DATE PRIMARY KEY, "
    "status TEXT NOT NULL DEFAULT 'draft', "
    "published_at TIMESTAMPTZ, "
    "published_by TEXT NOT NULL DEFAULT '')"
)
# Every publish lands here first, with each cell's prior value: the restore trail.
PUBLISH_LOG_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_cal_builder_publish_log ("
    "id BIGSERIAL PRIMARY KEY, "
    "period_start DATE NOT NULL, "
    "published_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "published_by TEXT NOT NULL DEFAULT '', "
    "cells_json JSONB NOT NULL DEFAULT '[]', "
    "table_rows_json JSONB NOT NULL DEFAULT '[]')"
)


def _sheets_write_service():
    import base64
    import json
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
        base = service_account.Credentials.from_service_account_info(info, scopes=WRITE_SCOPES)
    else:
        base = service_account.Credentials.from_service_account_file(raw, scopes=WRITE_SCOPES)
    creds = base
    try:
        probe = base.with_subject(IMPERSONATE)
        import google.auth.transport.requests as gtr
        probe.refresh(gtr.Request())
        creds = probe
    except Exception:  # noqa: BLE001 — plain SA still sees shared books
        log.info("calendar-builder write: DWD refused — plain SA lane")
    return gbuild("sheets", "v4", credentials=creds, cache_discovery=False)


def _col_letter(index: int) -> str:
    out = ""
    n = index + 1
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def _current_grid() -> tuple[list[dict], list[dict]]:
    """No slice cache: a write door never validates against minutes-old data."""
    return _parse_grid(_fetch_grid_matrix())


def _grid_context() -> dict[str, Any]:
    cols, rows = _current_grid()
    by_row = {r["sheetRow"]: r for r in rows}
    period_start = cols[0]["iso"] if cols else ""
    return {"cols": cols, "rows": rows, "by_row": by_row, "period_start": period_start}


def _draft_map(dsn: str, period_start: str) -> dict[tuple, dict]:
    with hub_db.connect(dsn) as conn, conn.cursor(
        cursor_factory=psycopg2.extras.RealDictCursor
    ) as cur:
        cur.execute(DRAFT_DDL)
        cur.execute(
            # publish needs house/employee to check the grid row still names the same person
            "SELECT sheet_row, date_iso, house, employee, value, base_value, "
            "updated_at, updated_by "
            "FROM asa_cal_builder_draft WHERE period_start = %s", (period_start,))
        return {(r["sheet_row"], str(r["date_iso"])): dict(r) for r in cur.fetchall()}


def merged_grid(dsn: str) -> dict[str, Any]:
    ctx = _grid_context()
    draft = _draft_map(dsn, ctx["period_start"]) if ctx["period_start"] else {}
    conflicts, hours = _assess(ctx["rows"], draft)
    try:
        import calendar_builder_slices  # noqa: PLC0415
        conflicts += calendar_builder_slices._time_off_conflicts(dsn, _time_off_rows_of(ctx, draft), iso=True)
    except Exception as exc:  # noqa: BLE001 — FAIL-OPEN: the grid draws; publish still refuses time off
        log.warning("calendar-builder: time-off conflicts could not be read (%s)", type(exc).__name__)
    edited = sum(1 for (sr, d), v in draft.items() if _cell_text(ctx, sr, d) != v["value"])
    return {
        "period": {"start": ctx["period_start"],
                   "end": ctx["cols"][-1]["iso"] if ctx["cols"] else "",
                   "days": len(ctx["cols"]), "cols": ctx["cols"]},
        "rows": ctx["rows"],
        "draft": [{"sheetRow": sr, "date": d, "value": v["value"],
                   "baseValue": v["base_value"], "updatedBy": v["updated_by"],
                   "updatedAt": str(v["updated_at"])}
                  for (sr, d), v in sorted(draft.items())],
        "draftCount": edited,
        "conflicts": conflicts,
        "hours": hours,
    }


def _cell_text(ctx: dict, sheet_row: int, date_iso: str) -> str:
    row = ctx["by_row"].get(sheet_row)
    if not row:
        return ""
    for cell in row["cells"]:
        if cell["date"] == date_iso:
            return cell["text"]
    return ""


def _effective_cells(ctx: dict, draft: dict) -> list[dict]:
    out = []
    for row in ctx["rows"]:
        if row["rowType"] != "staff":
            continue
        for cell in row["cells"]:
            d = draft.get((row["sheetRow"], cell["date"]))
            text = d["value"] if d else cell["text"]
            got = shift_slices.classify(text) if text else None
            out.append({
                "house": row["house"], "employee": row["employee"], "sheetRow": row["sheetRow"],
                "date": cell["date"], "text": text,
                "start": got.get("start") if got else None,
                "end": got.get("end") if got else None,
            })
    return out


def _assess(rows: list[dict], draft: dict) -> tuple[list[dict], list[dict]]:
    """Intervals are absolute (date + hour), so a Monday overnight collides with a Tuesday morning."""
    ctx = {"rows": rows}
    cells = _effective_cells(ctx, draft)
    # One person under one key, however each house's row spells the name.
    by_person: dict[str, list[dict]] = {}
    for c in cells:
        if c["start"] is None or _skip_staff(c["employee"], c["house"]):
            continue
        try:
            day = datetime.strptime(c["date"], "%Y-%m-%d")
        except ValueError:
            continue
        by_person.setdefault(_fold(c["employee"]), []).append({
            **c,
            "_s": day + timedelta(hours=c["start"]),
            "_e": day + timedelta(hours=c["end"]),
        })
    conflicts: list[dict] = []
    for cs in by_person.values():
        cs.sort(key=lambda c: c["_s"])
        for i in range(len(cs)):
            for j in range(i + 1, len(cs)):
                a, b = cs[i], cs[j]
                if b["_s"] >= a["_e"]:
                    break
                conflicts.append({
                    "staff": a["employee"], "date": a["date"],
                    "houseA": a["house"], "startA": a["text"], "endA": "",
                    "houseB": b["house"], "startB": b["text"], "endB": "",
                    "dateB": b["date"], "sheetRowA": a["sheetRow"], "sheetRowB": b["sheetRow"],
                })
    hours_map: dict[str, dict[str, Any]] = {}
    for c in cells:
        if c["start"] is None or _skip_staff(c["employee"], c["house"]):
            continue
        d = datetime.strptime(c["date"], "%Y-%m-%d").date()
        sat = d - timedelta(days=(d.weekday() + 2) % 7)
        slot = hours_map.setdefault(c["employee"], {"staff": c["employee"],
                                                    "totalHours": 0.0, "weeks": {}})
        dur = max(c["end"] - c["start"], 0.0)
        slot["totalHours"] += dur
        slot["weeks"][sat.isoformat()] = slot["weeks"].get(sat.isoformat(), 0.0) + dur
    hours = [{
        "staff": s["staff"], "totalHours": round(s["totalHours"], 2),
        "weeks": len(s["weeks"]),
        "perWeekAvg": round(s["totalHours"] / max(len(s["weeks"]), 1), 2),
        "weekly": [{"weekStart": k, "hours": round(v, 2)} for k, v in sorted(s["weeks"].items())],
    } for s in hours_map.values()]
    hours.sort(key=lambda r: -r["totalHours"])
    return conflicts, hours


def _time_off_refusal(dsn: str, person: str, house: str, date_iso: str, value: str,
                      away: dict[str, list[dict]] | None = None) -> str:
    """Hours that fall in a person's scheduled time off are refused; an unreadable house refuses too."""
    got = shift_slices.classify(value) if value else None
    if not got or got.get("start") is None or _skip_staff(person, house):
        return ""
    import time_off  # noqa: PLC0415 — lazy: it reads the estate through shift_requests
    try:
        held = (away if away is not None else time_off.away(dsn, [person])).get(time_off.fold(person), [])
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: nothing is allowed on a read that failed
        return (f"who is on approved time off could not be read ({type(exc).__name__}) — nothing was "
                f"changed; try again in a minute")
    for i in held:
        a, b = time_off.day_of(i["col_iso"]), time_off.day_of(i["until"])
        if a and b and time_off.clashes(date_iso, value, a, b):
            return (f"{person} is on approved time off from {time_off.day_words(a)} to "
                    f"{time_off.day_words(b)} ({i['ref']}) — nothing was changed")
    return ""


def _time_off_rows_of(ctx: dict, draft: dict) -> list[dict]:
    out = []
    for c in _effective_cells(ctx, draft):
        if c["start"] is None:
            continue
        try:
            d = datetime.strptime(c["date"], "%Y-%m-%d").date()
        except ValueError:
            continue
        out.append({"Staff": c["employee"], "House": c["house"], "Date": f"{d.month:02d}/{d.day:02d}/{d.year}",
                    "Start": _clock(c["start"]), "End": _clock(c["end"])})
    return out


def set_cell(dsn: str, actor: str, sheet_row: int, date_iso: str, value: str) -> dict:
    ctx = _grid_context()
    row = ctx["by_row"].get(sheet_row)
    if row is None:
        return {"status": 404, "message": "that row is not on the live grid anymore — reload"}
    if not any(c["date"] == date_iso for c in row["cells"]):
        return {"status": 400, "message": "that date is outside the current period"}
    value = value.strip()[:100]
    refusal = _time_off_refusal(dsn, row["employee"], row["house"], date_iso, value)
    if refusal:
        return {"status": 409, "reason": "time_off", "message": refusal}
    base = _cell_text(ctx, sheet_row, date_iso)
    if value == base:
        with hub_db.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute(DRAFT_DDL)
            cur.execute(
                "DELETE FROM asa_cal_builder_draft "
                "WHERE period_start = %s AND sheet_row = %s AND date_iso = %s",
                (ctx["period_start"], sheet_row, date_iso))
            conn.commit()
        return {"status": 200, "data": {"cleared": True}}
    with hub_db.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(DRAFT_DDL)
        cur.execute(PERIODS_DDL)
        cur.execute(
            "INSERT INTO asa_cal_builder_periods (period_start) VALUES (%s) "
            "ON CONFLICT DO NOTHING", (ctx["period_start"],))
        # the base re-pins on every explicit edit, or a blocked publish's 409 could never clear
        cur.execute(
            "INSERT INTO asa_cal_builder_draft "
            "(period_start, sheet_row, date_iso, house, employee, value, base_value, updated_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (period_start, sheet_row, date_iso) DO UPDATE "
            "SET value = EXCLUDED.value, base_value = EXCLUDED.base_value, "
            "updated_at = now(), updated_by = EXCLUDED.updated_by",
            (ctx["period_start"], sheet_row, date_iso, row["house"], row["employee"],
             value, base, actor))
        conn.commit()
    log.info("calendar-builder: cell %s/%s/%s -> %r by %s",
             row["house"], row["employee"], date_iso, value, actor)
    return {"status": 200, "data": {"sheetRow": sheet_row, "date": date_iso, "value": value}}


def time_off_windows(dsn: str) -> tuple[list[tuple[str, Any, Any]], list[tuple[str, Any, Any]]]:
    """(scheduled, pending) as (name, start, end): the Time Off house once migrated, the form's tab until then."""
    import time_off  # noqa: PLC0415 — lazy: it reads the estate through shift_requests
    v = time_off.view(dsn)
    if time_off.migrated(v):
        got: dict[str, list[tuple[str, Any, Any]]] = {time_off.SCHEDULED: [], time_off.PENDING: []}
        for r in v["rows"]:
            a, b = time_off.day_of(r.get("start_date")), time_off.day_of(r.get("end_date"))
            if r.get("status") in got and a and b and b >= a:
                got[r["status"]].append((str(r.get("person") or ""), a, b))
        return got[time_off.SCHEDULED], got[time_off.PENDING]
    out = []
    for req in _mirror_rows(dsn, REQUESTS_TAB)[0]:
        start = _req_date(req.get("Time off (start date)"))
        end = _req_date(req.get("Time off (end date)")) or start
        if start and end:
            out.append((str(req.get("Your Name") or "").strip(), start, end))
    return out, []


def _fold(name: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())


def apply_requests(dsn: str, actor: str) -> dict:
    """Scheduled time off becomes R/O; a shift already there moves to the house's first blank OPEN row, as GAS does."""
    ctx = _grid_context()
    if not ctx["period_start"]:
        return {"status": 502, "message": "the grid has no period"}
    draft = _draft_map(dsn, ctx["period_start"])
    try:
        requests, _pending = time_off_windows(dsn)
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: nothing staged from a read that failed
        return {"status": 503, "message": f"the time off could not be read ({type(exc).__name__}) — "
                                          f"nothing was staged"}
    p_start = datetime.strptime(ctx["period_start"], "%Y-%m-%d").date()
    p_end = datetime.strptime(ctx["cols"][-1]["iso"], "%Y-%m-%d").date()
    today = datetime.now(ESTATE_TZ).date()

    applied: list[dict] = []
    staged_ro = 0
    for name, start, end in requests:
        if not name or start is None or end is None or end < today:
            continue
        lo, hi = max(start, p_start), min(end, p_end)
        if lo > hi:
            continue
        staff_rows = [r for r in ctx["rows"]
                      if r["rowType"] == "staff" and _fold(r["employee"]) == _fold(name)]
        if not staff_rows:
            continue
        d = lo
        while d <= hi:
            iso = d.isoformat()
            for row in staff_rows:
                current = draft.get((row["sheetRow"], iso), {}).get("value") \
                    if (row["sheetRow"], iso) in draft else _cell_text(ctx, row["sheetRow"], iso)
                got = shift_slices.classify(current) if current else None
                if got and got.get("start") is not None:
                    open_row = _first_open(ctx, draft, row["house"], row["sheetRow"], iso)
                    if open_row is not None:
                        _stage(dsn, actor, ctx, open_row["sheetRow"], iso, current)
                        applied.append({"moved": current, "to": "OPEN",
                                        "house": row["house"], "date": iso})
                if (current or "").strip().upper() != "R/O":
                    _stage(dsn, actor, ctx, row["sheetRow"], iso, "R/O")
                    staged_ro += 1
            d += timedelta(days=1)
    log.info("calendar-builder: time off reflected as %d R/O and %d moves by %s", staged_ro,
             len(applied), actor)
    return {"status": 200, "data": {"applied": staged_ro + len(applied), "staged_ro": staged_ro,
                                    "moved": len(applied), "moves": applied[:50]}}


def _first_open(ctx: dict, draft: dict, house: str, after_row: int, date_iso: str) -> dict | None:
    for row in ctx["rows"]:
        if row["house"] != house or row["rowType"] != "open" or row["sheetRow"] <= after_row:
            continue
        key = (row["sheetRow"], date_iso)
        current = draft[key]["value"] if key in draft else _cell_text(ctx, row["sheetRow"], date_iso)
        if not current.strip():
            return row
    return None


def _stage(dsn: str, actor: str, ctx: dict, sheet_row: int, date_iso: str, value: str) -> None:
    row = ctx["by_row"][sheet_row]
    base = _cell_text(ctx, sheet_row, date_iso)
    with hub_db.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(DRAFT_DDL)
        cur.execute(PERIODS_DDL)
        cur.execute(
            "INSERT INTO asa_cal_builder_periods (period_start) VALUES (%s) "
            "ON CONFLICT DO NOTHING", (ctx["period_start"],))
        cur.execute(
            "INSERT INTO asa_cal_builder_draft "
            "(period_start, sheet_row, date_iso, house, employee, value, base_value, updated_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (period_start, sheet_row, date_iso) DO UPDATE "
            "SET value = EXCLUDED.value, base_value = EXCLUDED.base_value, "
            "updated_at = now(), updated_by = EXCLUDED.updated_by",
            (ctx["period_start"], sheet_row, date_iso, row["house"], row["employee"],
             value, base, actor))
        conn.commit()


_TIME_PAIR = re.compile(r"(\d{1,2}(?:\d{2})?[AP])-?(\d{1,2}(?:\d{2})?[AP])", re.I)


def _draft_base(draft: dict, w: dict) -> str:
    d = draft.get((w["_row"]["sheetRow"], w["_date"]))
    return d["base_value"] if d else ""


def _fmt_time(raw: str) -> str | None:
    m = re.match(r"(\d{1,2})(\d{2})?([AP])", raw.strip(), re.I)
    if not m:
        return None
    hour = int(m.group(1)) % 12 + (12 if m.group(3).upper() == "P" else 0)
    return f"{hour:02d}:{m.group(2) or '00'}"


def _table_rows_for(house: str, employee: str, designation: str,
                    grid_date_iso: str, text: str, timestamp: str) -> list[list]:
    """Rows in the GAS parser's exact shape, including its table date one day past the grid column."""
    out: list[list] = []
    grid_date = datetime.strptime(grid_date_iso, "%Y-%m-%d").date()
    for segment in text.split(">"):
        m = _TIME_PAIR.search(segment.strip())
        if not m:
            continue
        start, end = _fmt_time(m.group(1)), _fmt_time(m.group(2))
        if start is None or end is None:
            continue
        sh, sm = int(start[:2]), int(start[3:])
        eh, em = int(end[:2]), int(end[3:])
        duration = (eh * 60 + em) - (sh * 60 + sm)
        table_date = (grid_date + timedelta(days=1)).strftime("%m/%d/%Y")
        next_date = (grid_date + timedelta(days=2)).strftime("%m/%d/%Y")
        if sh > eh or (sh == 12 and eh == 12) or duration <= 120:
            out.append([house, employee, designation, table_date, start, "23:59:00", timestamp])
            out.append([house, employee, designation, next_date, "00:00:00", end, timestamp])
        else:
            out.append([house, employee, designation, table_date, start, end, timestamp])
    return out


def nights_before(dsn: str, period_start: str) -> dict[str, list[dict]]:
    """Live shifts filed before the period that reach into it, by folded name; raises when unreadable."""
    import shift_requests  # noqa: PLC0415 — lazy: it reads the estate, which asks this file back
    start = datetime.strptime(period_start, "%Y-%m-%d")
    out: dict[str, list[dict]] = {}
    for key, spans in (shift_requests.estate(dsn).get("spans") or {}).items():
        for h in spans:
            if str(h.get("col_iso") or "") >= period_start:
                continue
            a, b = (t.replace(tzinfo=None) for t in h["span"])
            if b > start:
                out.setdefault(key, []).append({"span": (a, b), "location": str(h.get("location") or ""),
                                                "value": str(h.get("value") or ""),
                                                "col_iso": str(h.get("col_iso") or "")})
    return out


def _overlap_blocks(ctx: dict, draft: dict, writes: list[dict],
                    before: dict[str, list[dict]]) -> list[dict]:
    """A blocked entry for every cell about to be written that overlaps another of the same person's."""
    written = {(w["_row"]["sheetRow"], w["_date"]): w for w in writes}
    conflicts, _hours = _assess(ctx["rows"], draft)
    out: list[dict] = []
    seen: set[tuple] = set()

    def block(w: dict, other_house: str, other_text: str, other_date: str) -> None:
        key = (w["_row"]["sheetRow"], w["_date"], other_house, other_date)
        if key in seen:
            return
        seen.add(key)
        out.append({"sheetRow": w["_row"]["sheetRow"], "date": w["_date"], "house": w["_row"]["house"],
                    "employee": w["_row"]["employee"],
                    "reason": f"overlaps {other_house} {other_text} on {other_date} — nothing was published"})

    for c in conflicts:
        for sheet_row, date_iso, other in (
                (c["sheetRowA"], c["date"], (c["houseB"], c["startB"], c["dateB"])),
                (c["sheetRowB"], c["dateB"], (c["houseA"], c["startA"], c["date"]))):
            w = written.get((sheet_row, date_iso))
            if w is not None:
                block(w, *other)
    for w in writes:
        got = shift_slices.classify(w["_value"]) if w["_value"] else None
        if not got or got.get("start") is None or _skip_staff(w["_row"]["employee"], w["_row"]["house"]):
            continue
        day = datetime.strptime(w["_date"], "%Y-%m-%d")
        s, e = day + timedelta(hours=got["start"]), day + timedelta(hours=got["end"])
        for h in before.get(_fold(w["_row"]["employee"]), []):
            a, b = h["span"]
            if a < e and s < b:
                block(w, h["location"], h["value"], h["col_iso"])
    return out


def publish(dsn: str, actor: str) -> dict:
    """Fail-closed on a moved row, a moved base or an empty draft; test mode publishes nothing."""
    switch = effective_roster.test_mode()
    if switch.get("on"):
        return {"status": 409, "reason": "test_mode",
                "message": ("test mode is on, and it holds roster writes — the master grid was not "
                            "published and its draft is kept as it is; publish it once test mode "
                            "is off")}
    ctx = _grid_context()
    if not ctx["period_start"]:
        return {"status": 502, "message": "the grid has no period to publish"}
    draft = _draft_map(dsn, ctx["period_start"])
    if not draft:
        return {"status": 400, "message": "the draft is empty — nothing to publish"}

    blocked: list[dict] = []
    writes: list[dict] = []
    for (sheet_row, date_iso), d in sorted(draft.items()):
        row = ctx["by_row"].get(sheet_row)
        if row is None or row["house"] != d["house"] or row["employee"] != d["employee"]:
            blocked.append({"sheetRow": sheet_row, "date": date_iso,
                            "reason": "the grid row moved — it no longer names "
                                      f"{d['employee']} at {d['house']}"})
            continue
        live = _cell_text(ctx, sheet_row, date_iso)
        if live != d["base_value"] and live != d["value"]:
            blocked.append({"sheetRow": sheet_row, "date": date_iso,
                            "house": d["house"], "employee": d["employee"],
                            "reason": f"the sheet changed since the draft "
                                      f"(base {d['base_value']!r}, now {live!r})"})
            continue
        if live == d["value"]:
            continue
        col = next((c["index"] for c in ctx["cols"] if c["iso"] == date_iso), None)
        if col is None:
            continue
        writes.append({"range": f"'{GRID_TAB}'!{_col_letter(col)}{sheet_row}",
                       "values": [[d["value"]]],
                       "_row": row, "_date": date_iso, "_value": d["value"]})
    import time_off  # noqa: PLC0415 — lazy: it reads the estate through shift_requests
    try:
        away = time_off.away(dsn, [w["_row"]["employee"] for w in writes])
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: nothing is published past a check that could not run
        return {"status": 503, "message": f"who is on approved time off could not be read "
                                          f"({type(exc).__name__}) — nothing was published"}
    for w in writes:
        why = _time_off_refusal(dsn, w["_row"]["employee"], w["_row"]["house"], w["_date"], w["_value"],
                                away=away)
        if why:
            blocked.append({"sheetRow": w["_row"]["sheetRow"], "date": w["_date"], "house": w["_row"]["house"],
                            "employee": w["_row"]["employee"], "reason": why})
    try:
        before = nights_before(dsn, ctx["period_start"]) if writes else {}
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: the first morning cannot be checked against the night before
        return {"status": 503, "message": f"the live calendars could not be read ({type(exc).__name__}), so the "
                                          f"night before the period cannot be checked — nothing was published"}
    blocked.extend(_overlap_blocks(ctx, draft, writes, before))
    if blocked:
        return {"status": 409, "message": f"{len(blocked)} cell(s) need a human look "
                "before anything is published", "data": {"blocked": blocked}}
    if not writes:
        return {"status": 200, "data": {"written": 0, "appended": 0,
                                        "note": "the sheet already says what the draft says"}}

    sheets = _sheets_write_service()
    sheets.spreadsheets().values().batchUpdate(
        spreadsheetId=MASTER_SHEET_ID,
        body={"valueInputOption": "RAW",
              "data": [{"range": w["range"], "values": w["values"]} for w in writes]},
    ).execute()

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    table_rows: list[list] = []
    for w in writes:
        got = shift_slices.classify(w["_value"]) if w["_value"] else None
        if not got or got.get("start") is None:
            continue
        table_rows.extend(_table_rows_for(w["_row"]["house"], w["_row"]["employee"],
                                          w["_row"]["designation"], w["_date"],
                                          w["_value"], timestamp))
    appended = 0
    if table_rows:
        res = sheets.spreadsheets().values().append(
            spreadsheetId=MASTER_SHEET_ID,
            range=f"'{TABLE_TAB}'!A1",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": table_rows},
        ).execute()
        appended = len(table_rows)

    with hub_db.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(PERIODS_DDL)
        cur.execute(PUBLISH_LOG_DDL)
        cur.execute(
            "INSERT INTO asa_cal_builder_publish_log "
            "(period_start, published_by, cells_json, table_rows_json) "
            "VALUES (%s, %s, %s, %s)",
            (ctx["period_start"], actor,
             json.dumps([{"range": w["range"], "house": w["_row"]["house"],
                          "employee": w["_row"]["employee"], "date": w["_date"],
                          "baseValue": _draft_base(draft, w), "value": w["_value"]}
                         for w in writes]),
             json.dumps(table_rows)))
        cur.execute(
            "INSERT INTO asa_cal_builder_periods (period_start, status, published_at, published_by) "
            "VALUES (%s, 'published', now(), %s) "
            "ON CONFLICT (period_start) DO UPDATE "
            "SET status = 'published', published_at = now(), published_by = EXCLUDED.published_by",
            (ctx["period_start"], actor))
        cur.execute("DELETE FROM asa_cal_builder_draft WHERE period_start = %s",
                    (ctx["period_start"],))
        conn.commit()
    log.info("calendar-builder: PUBLISHED %d cells + %d table rows for %s by %s",
             len(writes), appended, ctx["period_start"], actor)
    return {"status": 200, "data": {"written": len(writes), "appended": appended,
                                    "period": ctx["period_start"]}}


_MDATE = re.compile(r"^(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?$")


MASTER_PUSH_VIA = "master_push"


def _house_own_cells(dsn: str, tab: str) -> dict[tuple[str, str], str]:
    """(name key, day) → road for cells the house changed itself, which the push leaves alone; raises if unreadable."""
    import house_cal_live  # noqa: PLC0415 — the edits table is the calendar's
    house_cal_live.ensure_tables(dsn)
    with hub_db.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT DISTINCT ON (employee, col_iso) employee, col_iso, via "
                    "FROM asa_house_calendar_edits WHERE location=%s AND stage=%s "
                    "ORDER BY employee, col_iso, id DESC",
                    (tab, house_cal_live.STAGE_PUBLISHED))
        rows = cur.fetchall()
    return {(_norm_name(emp), str(iso)): str(via or "") for emp, iso, via in rows
            if str(via or "") != MASTER_PUSH_VIA}


def _norm_name(name: str) -> str:
    return re.sub(r"[^a-z]", "", (name or "").lower())


def _house_layout(matrix: list[list[str]], today) -> dict | None:
    """Header row = the one with 7+ dates; names sit two columns left of the first date; None, never a guess."""
    from calendar_builder_slices import _infer_year
    for ri, raw in enumerate(matrix[:12]):
        cells = [str(c).strip() for c in raw]
        dates = []
        for ci, cell in enumerate(cells):
            m = _MDATE.match(cell)
            if not m:
                continue
            month, day = int(m.group(1)), int(m.group(2))
            year = int(m.group(3)) if m.group(3) else _infer_year(month, day, today)
            if year < 100:
                year += 2000
            try:
                from datetime import date as _d
                dates.append((ci, _d(year, month, day).isoformat()))
            except ValueError:
                continue
        if len(dates) >= 7 and dates[0][0] >= 2:
            return {"header_row": ri, "name_col": dates[0][0] - 2, "dates": dates}
    return None


def _push_house(dsn: str, tab: str, matrix: list[list[Any]], writes: list[dict], entry: dict,
                *, actor: str, dry_run: bool) -> None:
    import calendar_builder_houses as cbh  # noqa: PLC0415 — it imports this file
    import house_cal_live  # noqa: PLC0415
    try:
        tl = cbh.tab_layout(matrix, cbh._isos_of(dsn, tab))
        own = _house_own_cells(dsn, tab)
    except house_cal_live.WorkbookRefused as exc:
        entry.update(status="skipped")
        entry["skipped"].append(exc.why)
        return
    except Exception as exc:  # noqa: BLE001 — a push that cannot tell whose a cell is writes none
        entry.update(status="skipped")
        entry["skipped"].append(f"which cells are the house's own could not be read "
                                f"({type(exc).__name__}) — nothing was written")
        return
    if tl is None:
        entry.update(status="skipped")
        entry["skipped"].append("the house's writer finds no STAFF header on this tab")
        return
    key_of_row = {ri: name for name, ri in tl["by_name"].items()}
    cells: list[dict[str, Any]] = []
    landing: dict[tuple[str, str], str] = {}
    for w in writes:
        key = key_of_row.get(int(w["_ri"]))
        value = str(w["values"][0][0] or "")
        if not key:
            entry["skipped"].append(f"{w['_employee'] or 'a row'} on {w['_date']}: the house's "
                                    f"writer cannot address that row")
            continue
        via = own.get((_norm_name(key), w["_date"]))
        if via:
            entry["skipped"].append(f"{key} on {w['_date']}: changed on the house's own calendar "
                                    f"({via}) since — the push leaves it; change it in Calendar "
                                    f"Builder → House calendars")
            continue
        if landing.setdefault((key, w["_date"]), value) != value:
            entry["skipped"].append(f"{key} on {w['_date']}: two rows of the master land on this "
                                    f"one cell with different shifts — neither is pushed")
            cells = [c for c in cells if (c["employee"], c["col_iso"]) != (key, w["_date"])]
            continue
        cells.append({"employee": key, "col_iso": w["_date"], "value": value, "base": w["_live"]})
    try:
        got = cbh.push_house(dsn, location=tab, cells=cells, actor=actor, via=MASTER_PUSH_VIA,
                             dry_run=dry_run)
    except cbh.Refused as exc:
        entry.update(status="refused", refused=exc.extra.get("blocked") or [], why=exc.why)
        entry["skipped"] += [f"{c['employee']} on {c['col_iso']}: {c['reason']}"
                             for c in exc.extra.get("left_out") or []]
        return
    except house_cal_live.WorkbookRefused as exc:
        entry.update(status="refused", refused=exc.blocked, why=exc.why)
        return
    entry["skipped"] += [f"{c['employee']} on {c['col_iso']}: {c['reason']}"
                         for c in got.get("left_out") or []]
    entry["written"] = int(got.get("would_write" if dry_run else "written") or 0)
    if got.get("test_mode"):
        entry["test_mode"] = True
    if got.get("training"):
        entry["training"] = got["training"]
    if dry_run:
        entry["preview"] = [{"range": f"{c['employee']} · {c['col_iso']}", "from": c["base"],
                             "to": c["value"]} for c in (got.get("cells") or [])[:20]]
        entry["dryRun"] = True


def publish_houses(dsn: str, actor: str, dry_run: bool = False) -> dict:
    """Master house blocks → live house tabs by date, fail-closed per house, through _push_house."""
    ctx = _grid_context()
    if not ctx["period_start"]:
        return {"status": 502, "message": "the master grid has no period"}
    draft = _draft_map(dsn, ctx["period_start"])
    sheets = _sheets_write_service()
    today = datetime.now(ESTATE_TZ).date()

    try:
        meta = sheets.spreadsheets().get(
            spreadsheetId=LIVE_HOUSES_SHEET_ID,
            fields="sheets.properties.title").execute()
        tab_by_code = {}
        for s in meta.get("sheets", []):
            title = s["properties"]["title"]
            parts = title.split(" - ")
            if len(parts) >= 2:
                tab_by_code[parts[1].strip().upper()] = title
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"the live houses workbook is unreadable ({type(exc).__name__})"}

    blocks: dict[str, list[dict]] = {}
    for row in ctx["rows"]:
        if row["rowType"] not in ("staff", "open"):
            continue
        cells = {}
        for cell in row["cells"]:
            key = (row["sheetRow"], cell["date"])
            cells[cell["date"]] = draft[key]["value"] if key in draft else cell["text"]
        blocks.setdefault(row["house"].strip().upper(), []).append(
            {"employee": row["employee"], "cells": cells})

    results = []
    for code, block in sorted(blocks.items()):
        tab = tab_by_code.get(code)
        entry = {"house": code, "tab": tab or "", "written": 0,
                 "skipped": [], "status": "ok"}
        results.append(entry)
        if not tab:
            entry["status"] = "skipped"
            entry["skipped"].append("no tab for this house in the live workbook")
            continue
        try:
            got = sheets.spreadsheets().values().get(
                spreadsheetId=LIVE_HOUSES_SHEET_ID, range=f"'{tab}'!A1:AZ80",
                valueRenderOption="FORMATTED_VALUE").execute()
            matrix = got.get("values") or []
        except Exception as exc:  # noqa: BLE001
            entry["status"] = "skipped"
            entry["skipped"].append(f"tab unreadable ({type(exc).__name__})")
            continue
        layout = _house_layout(matrix, today)
        if layout is None:
            entry["status"] = "skipped"
            entry["skipped"].append("no roster grid found (no row with 7+ dates)")
            continue
        col_by_date = {iso: ci for ci, iso in layout["dates"]}
        rows_by_name: dict[str, int] = {}
        for ri in range(layout["header_row"] + 1, len(matrix)):
            raw = matrix[ri]
            name = str(raw[layout["name_col"]]).strip() if layout["name_col"] < len(raw) else ""
            if name:
                rows_by_name.setdefault(_norm_name(name), ri + 1)
        writes = []
        for person in block:
            sheet_row = rows_by_name.get(_norm_name(person["employee"]))
            if sheet_row is None:
                if person["employee"].strip().upper() != "OPEN":
                    entry["skipped"].append(f"no row named {person['employee']!r}")
                continue
            for date_iso, value in person["cells"].items():
                ci = col_by_date.get(date_iso)
                if ci is None:
                    continue
                live = ""
                raw = matrix[sheet_row - 1] if sheet_row - 1 < len(matrix) else []
                if ci < len(raw):
                    live = str(raw[ci]).strip()
                if live == (value or "").strip():
                    continue
                name_cell = raw[layout["name_col"]] if layout["name_col"] < len(raw) else ""
                writes.append({"range": f"'{tab}'!{_col_letter(ci)}{sheet_row}", "values": [[value]],
                               "_live": live, "_employee": str(name_cell).strip(),
                               "_date": date_iso, "_ri": sheet_row - 1})
        _push_house(dsn, tab, matrix, writes, entry, actor=actor, dry_run=dry_run)

    if not dry_run:
        with hub_db.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute(PUBLISH_LOG_DDL)
            cur.execute(
                "INSERT INTO asa_cal_builder_publish_log "
                "(period_start, published_by, cells_json, table_rows_json) "
                "VALUES (%s, %s, %s, %s)",
                (ctx["period_start"], f"houses ({actor})", "[]", json.dumps(results)))
    written = sum(r["written"] for r in results)
    skipped = sum(1 for r in results if r["status"] == "skipped")
    held = any(r.get("test_mode") for r in results)
    log.info("calendar-builder: houses publish — %d cells across %d house tabs, "
             "%d tab(s) skipped, by %s%s", written, len(results) - skipped, skipped, actor,
             " — TEST MODE: recorded on the platform, the workbook was not written" if held else "")
    return {"status": 200, "data": {"written": written, "houses": results, "test_mode": held}}
