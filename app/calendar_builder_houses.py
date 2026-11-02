"""Calendar Builder houses: every roster edit is a draft; `publish_cells` is the one fail-closed writer to the……"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
import uuid
from datetime import date, datetime, timezone
from typing import Any, Callable, Iterable
from urllib.parse import quote

import effective_roster
import house_cal_live
import lanes_db as hub_db
import lanes_pg as psycopg2
import shift_requests
import shift_slices
from calendar_builder_write import (
    LIVE_HOUSES_SHEET_ID, PUBLISH_LOG_DDL, _norm_name,
)

log = logging.getLogger("hub.calendarbuilder.houses")

OHIO = house_cal_live.OHIO
WorkbookRefused = house_cal_live.WorkbookRefused
Refused = shift_requests.Refused

# one row per drafted cell; `base_value` is re-pinned on every edit
DRAFT_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_cal_builder_house_draft ("
    "location TEXT NOT NULL, employee TEXT NOT NULL, col_iso TEXT NOT NULL, "
    "value TEXT NOT NULL DEFAULT '', base_value TEXT NOT NULL DEFAULT '', "
    "note TEXT NOT NULL DEFAULT '', ist_missing TEXT NOT NULL DEFAULT '', "
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT NOT NULL DEFAULT '', "
    "PRIMARY KEY (location, employee, col_iso))"
)

# one publish per tab at a time
TAB_LOCK_NS = 8215
MAX_VALUE = 100
MAX_NOTE = 500

# Where the Builder opens a house (HashRouter: the route lives after the '#').
BUILDER_PATH = "/app/calendarbuilder/builder"


def _connect(dsn: str):
    return hub_db.connect(dsn)


_READY: set[str] = set()
_READY_LOCK = threading.Lock()


def ensure_tables(dsn: str) -> None:
    """The draft and edits tables, once per database on their own connection."""
    house_cal_live.ensure_tables(dsn)
    if dsn in _READY:
        return
    with _READY_LOCK:
        if dsn in _READY:
            return
        conn = _connect(dsn)
        try:
            conn.autocommit = True
            with conn.cursor() as cur:
                for ddl in (DRAFT_DDL, PUBLISH_LOG_DDL):
                    try:
                        cur.execute(ddl)
                    except psycopg2.Error:
                        pass
        finally:
            conn.close()
        _READY.add(dsn)


def fold(name: Any) -> str:
    return shift_requests.fold(name)


def builder_link(location: str, day: str = "") -> str:
    """The platform path that opens one house in the Builder, on one day."""
    parts = [f"house={quote(location, safe='')}"]
    if day:
        parts.append(f"day={quote(day, safe='')}")
    return f"/#{BUILDER_PATH}?{'&'.join(parts)}"


# the code a time picker writes

def _half(hour: float) -> str:
    """One end of a range the way the houses write it: 8 → '8A', 21.5 → '930P', 0 → '12A', 12 → '12P', 31.25 →…"""
    total = int(round(float(hour) * 60)) % (24 * 60)
    hh, mm = divmod(total, 60)
    ap = "P" if hh >= 12 else "A"
    twelve = hh % 12 or 12
    return f"{twelve}{mm:02d}{ap}" if mm else f"{twelve}{ap}"


def code_of(start: float, end: float) -> str:
    """Two decimal hours → the cell code: (21.5, 31.5) → '930P-730A', as houseCalTypes.codeOf composes it."""
    return f"{_half(start)}-{_half(end)}"


def reads_back(code: str, start: float, end: float) -> bool:
    """Does shift_slices.classify read `code` as exactly these hours?"""
    got = shift_slices.classify(code) or {}
    if got.get("start") is None or got.get("end") is None:
        return False
    want_start = float(start) % 24
    want_len = (float(end) - float(start)) % 24 or 24.0
    return (abs(float(got["start"]) - want_start) < 1e-6
            and abs((float(got["end"]) - float(got["start"])) - want_len) < 1e-6)


def value_from_times(start: Any, end: Any, *, keep_star: bool = False) -> str:
    """'HH:MM' or decimal hours → the code, refused when it would not read back."""
    def hours(v: Any) -> float:
        text = str(v if v is not None else "").strip()
        m = re.fullmatch(r"(\d{1,2}):(\d{2})", text)
        if m:
            return int(m.group(1)) + int(m.group(2)) / 60
        return float(text)
    try:
        s, e = hours(start), hours(end)
    except (TypeError, ValueError):
        raise ValueError("start and end must be times of day") from None
    if not (0 <= s < 24) or not (0 <= e < 24):
        raise ValueError("start and end must be times of day")
    if abs(s - e) < 1e-9:
        raise ValueError("a shift needs a start and an end that differ")
    code = code_of(s, e)
    if not reads_back(code, s, e):
        raise ValueError(f"{code} would not read back as those hours — type the code instead")
    return ("*" if keep_star else "") + code


# test mode's mockup rows for roster cells it held, kept by the relay's one keeper of them (web_gate): (location,
# cells, via, actor, act, switch) → whether the row was kept
HELD_ROSTER: list[Callable[..., bool] | None] = [None]
# the house calendars workbook's copy is written by asa-hub-sheet-sync off this op (app/calendar_carry.py)
HOUSE_OP = "house_cells"


# reading a house tab the way the mirror reads it

_MD = re.compile(r"^(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?$")


def _near_year(month: int, day: int, today: date) -> str:
    best = None
    for y in (today.year - 1, today.year, today.year + 1):
        try:
            d = date(y, month, day)
        except ValueError:
            continue
        if best is None or abs((d - today).days) < abs((best - today).days):
            best = d
    return best.isoformat() if best else ""


def tab_layout(matrix: list[list[Any]], isos: list[str], *,
               today: date | None = None) -> dict[str, Any] | None:
    """Where one house tab keeps its names and days, or None — by the mirror's own parse rules."""
    header = staff_col = None
    for ri, row in enumerate(matrix):
        for ci, cell in enumerate(row):
            if str(cell or "").strip().upper() == "STAFF":
                header, staff_col = ri, ci
                break
        if header is not None:
            break
    if header is None or staff_col is None:
        return None
    today = today or datetime.now(OHIO).date()
    by_md: dict[tuple[int, int], str] = {}
    for iso in isos:
        d = house_cal_live.day_of(iso)
        if d is not None:
            by_md.setdefault((d.month, d.day), iso)
    col_by_iso: dict[str, int] = {}
    head = matrix[header]
    for ci in range(staff_col + 1, len(head)):
        m = _MD.match(str(head[ci] or "").strip())
        if not m:
            continue
        month, day = int(m.group(1)), int(m.group(2))
        iso = by_md.get((month, day)) or _near_year(month, day, today)
        if iso and iso not in col_by_iso:
            col_by_iso[iso] = ci
    if not col_by_iso:
        return None
    date_cols = sorted(col_by_iso.values())
    kept: list[tuple[int, str]] = []
    dropped: list[tuple[int, str]] = []
    last_named = header
    for ri in range(header + 1, len(matrix)):
        row = matrix[ri]
        name = str(row[staff_col] if staff_col < len(row) else "").strip()
        if not name or name.upper() == "STAFF":
            continue
        last_named = ri
        busy = any(ci < len(row) and str(row[ci] or "").strip() for ci in date_cols)
        (kept if busy else dropped).append((ri, name))
    named = house_cal_live.key_rows(
        {"rows": [{"employee": n, "_ri": ri} for ri, n in kept]})["rows"]
    by_name: dict[str, int] = {str(r["employee"]): int(r["_ri"]) for r in named}
    for ri, n in dropped:
        if not house_cal_live.is_open_row(n):
            by_name.setdefault(n, ri)
    by_norm: dict[str, list[int]] = {}
    for ri, n in kept + dropped:
        if not house_cal_live.is_open_row(n):
            by_norm.setdefault(_norm_name(n), []).append(ri)
    return {"header": header, "staff_col": staff_col, "col_by_iso": col_by_iso,
            "by_name": by_name, "by_norm": by_norm, "last_named": last_named}


def resolve_row(layout: dict[str, Any], employee: str) -> tuple[int | None, str]:
    """(row, ''), (None, '') for no row yet, or (None, why) when placing it would be a guess."""
    if employee in layout["by_name"]:
        return layout["by_name"][employee], ""
    if house_cal_live.is_open_row(employee):
        return None, f"the tab has no row {employee} — an OPEN row is never added by the platform"
    hits = layout["by_norm"].get(_norm_name(employee), [])
    if len(hits) == 1:
        return hits[0], ""
    if len(hits) > 1:
        return None, (f"{len(hits)} rows of the tab are called {employee} — which one is meant "
                      f"is a question for the workbook, not a guess")
    return None, ""


class _TabGate:
    """`with _TabGate(dsn, location):` — a session lock on its own connection."""

    def __init__(self, dsn: str, location: str) -> None:
        self.dsn, self.location, self.conn = dsn, location, None

    def __enter__(self) -> "_TabGate":
        key = int(hashlib.sha1(self.location.encode()).hexdigest()[:8], 16) % (2 ** 31)
        self.conn = _connect(self.dsn)
        self.conn.autocommit = True
        with self.conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_lock(%s,%s)", (TAB_LOCK_NS, key))
        return self

    def __exit__(self, *exc: Any) -> None:
        if self.conn is not None:
            try:
                self.conn.close()
            except Exception:  # noqa: BLE001
                pass
        self.conn = None


def _isos_of(dsn: str, location: str) -> list[str]:
    with hub_db.intel(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT grid FROM asa_house_calendar_live WHERE location=%s", (location,))
        row = cur.fetchone()
    if not row:
        raise WorkbookRefused("that house has no calendar here — nothing was written",
                              "no_calendar")
    return house_cal_live.col_isos(house_cal_live._as_dict(row[0]))


def _clean(value: Any, limit: int = MAX_VALUE) -> str:
    return str(value if value is not None else "").strip()[:limit]


# the one writer: the record first, the workbook its copy

def publish_cells(dsn: str, location: str, cells: Iterable[dict[str, Any]], *,
                  actor: str, via: str, act: str = "") -> dict[str, Any]:
    """Publish cells of one house, or nothing: weighed under the tab lock against the house as the platform holds it
    (a cell no longer at its `base` refuses the whole change), kept as published edits, the workbook's copy queued for
    asa-hub-sheet-sync; test mode holds them instead."""
    todo: list[dict[str, Any]] = []
    for c in cells:
        todo.append({"employee": _clean(c.get("employee"), 200),
                     "col_iso": _clean(c.get("col_iso"), 20),
                     "value": _clean(c.get("value")),
                     "base": _clean(c.get("base")),
                     "note": _clean(c.get("note"), MAX_NOTE)})
    if not todo:
        return {"written": 0, "already": 0, "rows_added": [], "cells": [], "tab": location}
    switch = effective_roster.test_mode()
    if switch.get("on"):
        return _hold_cells(dsn, location, todo, actor=actor, via=via, act=act, switch=switch)
    ensure_tables(dsn)
    with _TabGate(dsn, location):
        with _connect(dsn) as conn, conn.cursor() as cur:
            writes, already, blocked, new_names, isos = _weigh(cur, dsn, location, todo)
            if blocked:
                raise WorkbookRefused(
                    f"{len(blocked)} cell{'' if len(blocked) == 1 else 's'} changed on the "
                    f"calendar under this change — nothing was published", "blocked",
                    [{k: b.get(k) for k in ("employee", "col_iso", "value", "base", "live",
                                            "reason")} for b in blocked])
            try:
                _keep_published(cur, location, writes, already, isos, actor=actor, via=via, act=act)
                conn.commit()
            except Exception as exc:  # noqa: BLE001 — the record is the write: none kept, none made
                raise WorkbookRefused(f"the change could not be kept ({type(exc).__name__}) — nothing "
                                      f"was published", "unreachable") from None
    # drop the overlap law's cached picture, and every shift reader re-reads now
    shift_requests.forget_estate()
    effective_roster.announce(location, writes, via=via, actor=str(actor or ""))
    log.info("calendar-builder: published %d cell(s) to %s (%d already there, %d row(s) "
             "added) via %s by %s — the workbook's copy queued", len(writes), location, len(already),
             len(new_names), via, actor)
    return {"written": len(writes), "already": len(already), "rows_added": new_names,
            "tab": location, "recorded": True, "test_mode": False,
            "cells": [{"employee": w["employee"], "col_iso": w["col_iso"],
                       "value": w["value"], "was": w["live"]} for w in writes]}


def _weigh(cur: Any, dsn: str, location: str, todo: list[dict[str, Any]]
           ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[str], list[str]]:
    """Each cell weighed against the house as the platform holds it (the live copy with the publishes it has not read
    back): (writes, already, blocked, names placed new, the house's days)."""
    # read without the house lock, which the caller already holds
    live = hub_db.beside(cur, dsn, "SELECT grid FROM asa_house_calendar_live WHERE location=%s", (location,))
    got = live[0] if live else None
    if not got:
        raise WorkbookRefused("that house has no calendar here — nothing was recorded", "no_calendar")
    grid = house_cal_live._as_dict(got[0])
    isos = house_cal_live.col_isos(grid)
    pend = house_cal_live.pending_publishes(cur, location).get(location, {})
    names = [str(r.get("employee") or "") for r in grid.get("rows") or []]
    names += [e for (e, _i) in pend]
    people = [n for n in dict.fromkeys(names) if n]
    writes: list[dict[str, Any]] = []
    already: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    new_names: list[str] = []
    for c in todo:
        if c["col_iso"] not in isos:
            blocked.append({**c, "live": "", "reason": f"the calendar has no column for {c['col_iso']}"})
            continue
        emp = c["employee"]
        if emp not in people:
            if house_cal_live.is_open_row(emp):
                blocked.append({**c, "live": "", "reason": (
                    f"the calendar has no row {emp} — an OPEN row is never added by the platform")})
                continue
            hits = [p for p in people if not house_cal_live.is_open_row(p) and _norm_name(p) == _norm_name(emp)]
            if len(hits) > 1:
                blocked.append({**c, "live": "", "reason": (
                    f"{len(hits)} rows of the calendar are called {emp} — which one is "
                    f"meant is a question for the workbook, not a guess")})
                continue
            if hits:
                emp = hits[0]
            elif emp not in new_names:
                new_names.append(emp)
        live_text = house_cal_live.workbook_text(grid, isos, pend, emp, c["col_iso"]).strip()
        if live_text == c["value"]:
            already.append({**c, "employee": emp, "live": live_text})
            continue
        if live_text != c["base"]:
            blocked.append({**c, "live": live_text, "reason": (
                f"the calendar says {live_text or 'nothing'} there now, not "
                f"{c['base'] or 'nothing'} as it did when this change was made")})
            continue
        writes.append({**c, "employee": emp, "live": live_text})
    return writes, already, blocked, new_names, isos


def _keep_published(cur: Any, location: str, writes: list[dict[str, Any]], already: list[dict[str, Any]],
                    isos: list[str], *, actor: str, via: str, act: str) -> None:
    """The publish kept, in the caller's transaction: the published edits (the house's record), the overrides they
    replace, the publish log, and the workbook's copy queued (app.book_ops house_cells)."""
    queued: list[dict[str, Any]] = []
    ids: list[int] = []
    for w in writes + [a for a in already if a.get("note")]:
        cur.execute(
            "INSERT INTO asa_house_calendar_edits (location, employee, col_iso, "
            "old_value, new_value, via, actor, stage, note, act) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id, at",
            (location, w["employee"], w["col_iso"], w["live"], w["value"], via,
             str(actor or "")[:200], house_cal_live.STAGE_PUBLISHED, w.get("note") or "", act))
        eid, at = cur.fetchone()
        if any(w is x for x in writes):
            ids.append(int(eid))
            queued.append({"employee": w["employee"], "col_iso": w["col_iso"], "value": w["value"],
                           "base": w["live"], "at": at.isoformat() if hasattr(at, "isoformat") else str(at)})
    for c in writes + already:
        cur.execute("DELETE FROM asa_house_calendar_overrides WHERE location=%s AND employee=%s AND col_iso=%s",
                    (location, c["employee"], c["col_iso"]))
    if not writes:
        return
    cur.execute(
        "INSERT INTO asa_cal_builder_publish_log (period_start, published_by, cells_json, table_rows_json) "
        "VALUES (%s, %s, %s, '[]')",
        (min(w["col_iso"] for w in writes), f"{actor} ({via})",
         json.dumps([{"house": location, "employee": w["employee"], "date": w["col_iso"],
                      "baseValue": w["live"], "value": w["value"], "via": via} for w in writes])))
    cur.execute("INSERT INTO book_ops (write_id, action, subject, sheet_id, tab_name, op, spec, author) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)",
                ("W" + uuid.uuid4().hex[:24], via, location, LIVE_HOUSES_SHEET_ID, location, HOUSE_OP,
                 json.dumps({"isos": isos, "cells": queued, "edit_ids": ids}), str(actor or "")[:200]))
    cur.execute("NOTIFY hub_book_ops")


def _hold_cells(dsn: str, location: str, todo: list[dict[str, Any]], *, actor: str, via: str,
                act: str, switch: dict[str, Any]) -> dict[str, Any]:
    """The writer under test mode: the workbook is untouched; cells are weighed by the same rules against the…"""
    ensure_tables(dsn)
    with _TabGate(dsn, location):
        with _connect(dsn) as conn, conn.cursor() as cur:
            writes, already, blocked, new_names, _isos = _weigh(cur, dsn, location, todo)
            if blocked:
                raise WorkbookRefused(
                    f"{len(blocked)} cell{'' if len(blocked) == 1 else 's'} changed on the "
                    f"calendar under this change — nothing was recorded (test mode holds the "
                    f"workbook)", "blocked",
                    [{k: b.get(k) for k in ("employee", "col_iso", "value", "base", "live",
                                            "reason")} for b in blocked])
            for w in writes + [a for a in already if a.get("note")]:
                cur.execute(
                    "INSERT INTO asa_house_calendar_edits (location, employee, col_iso, "
                    "old_value, new_value, via, actor, stage, note, act) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (location, w["employee"], w["col_iso"], w["live"], w["value"], via,
                     str(actor or "")[:200], house_cal_live.STAGE_TEST_MODE,
                     w.get("note") or "", act))
            conn.commit()
    shift_requests.forget_estate()
    cells = [{"employee": w["employee"], "col_iso": w["col_iso"], "value": w["value"],
              "was": w["live"]} for w in writes]
    mock_row = False
    if cells:
        try:
            keep = HELD_ROSTER[0]
            if keep is None:
                raise RuntimeError("no keeper of the mockup rows was handed to this process")
            mock_row = bool(keep(location, cells, via=via, actor=str(actor or ""), act=act, switch=switch))
            if not mock_row:
                raise RuntimeError("the mockup's keeper did not keep the row")
        except Exception as exc:  # noqa: BLE001 — the platform's record stands; said
            log.warning("calendar-builder: test mode held %d cell(s) at %s but the mockup row "
                        "was not kept (%s)", len(cells), location, type(exc).__name__)
        effective_roster.announce(location, cells, via=via, actor=str(actor or ""))
    log.info("calendar-builder: TEST MODE held %d cell(s) at %s — recorded on the platform, the "
             "workbook was not written (%d already there, %d person/people placed new) via %s "
             "by %s", len(writes), location, len(already), len(new_names), via, actor)
    return {"written": len(writes), "already": len(already), "rows_added": new_names,
            "tab": location, "recorded": True, "test_mode": True, "mock_row": mock_row,
            "held_by": ("test mode is on" if switch.get("readable") else
                        f"test mode could not be read, so it holds ({switch.get('why') or 'no answer'})"),
            "cells": cells}


def publisher(dsn: str, *, actor: str, via: str, note: str = "") -> Callable[
        [str, list[dict[str, Any]]], dict[str, Any]]:
    """The writer as a function of (location, cells), so house_cal_live never imports this file."""
    def run(location: str, cells: list[dict[str, Any]]) -> dict[str, Any]:
        if note:
            cells = [{**c, "note": c.get("note") or note} for c in cells]
        return publish_cells(dsn, location, cells, actor=actor, via=via)
    return run


# the draft picture

class _Picture:
    """One house under its lock: mirror, overrides, publishes since, drafts on top."""

    def __init__(self, grid: dict[str, Any], isos: list[str], ov: dict, pend: dict,
                 drafts: dict[tuple[str, str], dict[str, Any]]) -> None:
        self.grid, self.isos, self.ov, self.pend, self.drafts = grid, isos, ov, pend, drafts
        names = [str(r.get("employee") or "") for r in grid.get("rows") or []]
        names += [e for (e, _i), v in pend.items() if str(v).strip()]
        names += [e for (e, _i) in drafts]
        self.people = {n for n in names if n}
        self.open_rows = [n for n in dict.fromkeys(names) if house_cal_live.is_open_row(n)]

    def published(self, emp: str, iso: str) -> str:
        return house_cal_live.workbook_text(self.grid, self.isos, self.pend, emp, iso)

    def effective(self, emp: str, iso: str) -> str:
        return house_cal_live._cell_text(self.grid, self.isos, self.ov, emp, iso, self.pend)

    def text(self, emp: str, iso: str) -> str:
        d = self.drafts.get((emp, iso))
        return str(d["value"]) if d is not None else self.effective(emp, iso)

    def spelled(self, name: str) -> str:
        """The house's own spelling of a person, when they are already on it."""
        if name in self.people:
            return name
        key = fold(name)
        return next((p for p in sorted(self.people)
                     if fold(p) == key and not house_cal_live.is_open_row(p)), name)


def _drafts(cur, location: str) -> dict[tuple[str, str], dict[str, Any]]:
    cur.execute("SELECT employee, col_iso, value, base_value, note, ist_missing, updated_at, "
                "updated_by FROM asa_cal_builder_house_draft WHERE location=%s", (location,))
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for got in cur.fetchall():
        r = dict(got) if isinstance(got, dict) else dict(zip(
            ("employee", "col_iso", "value", "base_value", "note", "ist_missing", "updated_at",
             "updated_by"), got))
        out[(str(r["employee"]), str(r["col_iso"]))] = r
    return out


def _col(row: Any, name: str, i: int) -> Any:
    """One column of a row from a plain or a dict cursor."""
    return row[name] if isinstance(row, dict) else row[i]


def _table_is_there(cur, table: str) -> bool:
    cur.execute("SELECT to_regclass(%s) IS NOT NULL AS present", (table,))
    got = cur.fetchone()
    return bool(got and _col(got, "present", 0))


def draft_counts_in(cur) -> dict[str, int]:
    """Drafted cells per house, on any cursor; a database that never drafted answers {} and nothing is created."""
    if not _table_is_there(cur, "asa_cal_builder_house_draft"):
        return {}
    cur.execute("SELECT location, count(*) AS n FROM asa_cal_builder_house_draft GROUP BY location")
    return {str(_col(r, "location", 0)): int(_col(r, "n", 1)) for r in cur.fetchall()}


def draft_counts(dsn: str) -> dict[str, int]:
    """The House Calendars rail's draft pills: one read, no table made."""
    with _connect(dsn) as conn, conn.cursor() as cur:
        return draft_counts_in(cur)


def lay_draft_pills(houses: list[dict[str, Any]], counts: dict[str, int] | None) -> None:
    """A count only on a house this reader builds; an unread count (None) lays none, and the rail says why."""
    if counts is None:
        return
    for h in houses:
        if h.get("may_edit"):
            h["drafts"] = int(counts.get(str(h.get("location") or ""), 0))


def _picture(cur, dsn: str, location: str) -> _Picture:
    grid, isos, ov, pend = house_cal_live._load(cur, location, dsn)
    return _Picture(grid, isos, ov, pend, _drafts(cur, location))


def drafts_of_people(cur, people: list[str]) -> list[dict[str, Any]]:
    """Every drafted cell naming one of these people, at every house, in one read."""
    keys = sorted({fold(p) for p in people if fold(p)})
    if not keys:
        return []
    cur.execute("SELECT location, employee, col_iso, value FROM asa_cal_builder_house_draft "
                "WHERE regexp_replace(lower(employee), '[^a-z0-9]+', '', 'g') = ANY(%s)",
                (keys,))
    out = []
    for got in cur.fetchall():
        loc, emp, iso, val = ((got["location"], got["employee"], got["col_iso"], got["value"])
                              if isinstance(got, dict) else got)
        out.append({"location": str(loc), "employee": str(emp), "col_iso": str(iso),
                    "value": str(val or "")})
    return out


def _act() -> str:
    return "BA" + uuid.uuid4().hex[:12].upper()


def _record(cur, location: str, employee: str, col_iso: str, old: str, new: str, *,
            via: str, actor: str, note: str = "", act: str = "", stage: str,
            undone: bool = False) -> None:
    cur.execute(
        "INSERT INTO asa_house_calendar_edits (location, employee, col_iso, old_value, "
        "new_value, via, actor, stage, note, act, undone_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s," + ("now()" if undone else "NULL") + ")",
        (location, employee, col_iso, old, new, via, str(actor or "")[:200], stage,
         note, act))


def _put(cur, pic: _Picture, location: str, employee: str, col_iso: str, value: str, *,
         actor: str, note: str = "", ist_missing: str = "") -> None:
    """Draft one cell; a draft equal to the workbook with no note is dropped."""
    wb = pic.published(employee, col_iso)
    if value == wb and pic.effective(employee, col_iso) == wb and not note:
        cur.execute("DELETE FROM asa_cal_builder_house_draft "
                    "WHERE location=%s AND employee=%s AND col_iso=%s",
                    (location, employee, col_iso))
        pic.drafts.pop((employee, col_iso), None)
        return
    cur.execute(
        "INSERT INTO asa_cal_builder_house_draft (location, employee, col_iso, value, "
        "base_value, note, ist_missing, updated_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
        "ON CONFLICT (location, employee, col_iso) DO UPDATE SET value=EXCLUDED.value, "
        "base_value=EXCLUDED.base_value, note=EXCLUDED.note, ist_missing=EXCLUDED.ist_missing, "
        "updated_at=now(), updated_by=EXCLUDED.updated_by",
        (location, employee, col_iso, value, wb, note, ist_missing, str(actor or "")[:200]))
    pic.drafts[(employee, col_iso)] = {"employee": employee, "col_iso": col_iso,
                                       "value": value, "base_value": wb, "note": note,
                                       "ist_missing": ist_missing}
    pic.people.add(employee)


def _called_off(dsn: str, location: str, employee: str, col_iso: str) -> None:
    """A waiting call-off is never drafted over."""
    if shift_requests.open_call_off_at(dsn, location, employee, col_iso):
        raise Refused(
            "this shift was called off — it waits on its red cell on the "
            f"{shift_requests.CALL_OFF_ROW} line in Calendar Builder → Live, where the applicants and "
            "the house manager's decision are", "called_off")


def _overlap(dsn: str, person: str, location: str, col_iso: str, value: str,
             skip: list[tuple[str, str, str]], *, drafts: str = "plan",
             picture: dict[tuple[str, str, str], str] | None = None,
             approver: str = "") -> dict[str, Any]:
    """The overlap law, IST and trainer for one drafted cell; a clash or a check that could not run refuses."""
    if not person or house_cal_live.is_open_row(person) \
            or (shift_requests.span_of(col_iso, value) is None
                and not shift_requests.unreadable_hours(value)):
        return {"ok": True, "code": "not_a_shift", "why": "", "ist": None}
    try:
        got = shift_requests.check_assignment(
            dsn, person=person, location=location, col_iso=col_iso, value=value,
            skip=skip, drafts=drafts, picture=picture, approver=approver)
    except Exception as exc:  # noqa: BLE001
        raise Refused(f"the overlap check could not be run ({type(exc).__name__}) — nothing "
                      f"was changed; try again in a minute", "guard_unreadable") from None
    if not got.get("ok"):
        raise Refused(str(got.get("why") or "that overlaps another shift"),
                      str(got.get("code") or "overlap"),
                      clash=got.get("clash"))
    return got


def _ist_line(got: dict[str, Any]) -> str:
    """What the draft says about a first shift: the missing IST and who would train it."""
    ist = got.get("ist") or {}
    if not ist or ist.get("ok"):
        return ""
    line = str(ist.get("why") or "no IST for this house")
    training = got.get("training") or {}
    if training.get("why"):
        line += f" — {training['why']}"
    return line


# the draft edits

def stage_cell(dsn: str, *, location: str, employee: str, col_iso: str, value: str,
               actor: str, note: str = "", via: str = "cell",
               admits: Callable[[str], bool] | None = None) -> dict[str, Any]:
    """Draft one cell; `admits(name)` decides whether a person new to this house may be placed."""
    employee, value, note = _clean(employee, 200), _clean(value), _clean(note, MAX_NOTE)
    if not employee:
        raise ValueError("name the person")
    if employee.startswith(shift_requests.CALL_OFF_ROW):
        raise ValueError("the call-off line is drawn by the platform — it is not a row to write on")
    ensure_tables(dsn)
    with shift_requests.person_gate(dsn, employee):
        with _connect(dsn) as conn, conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            pic = _picture(cur, dsn, location)
            employee = pic.spelled(employee)
            people = set(pic.people)
            if employee not in people and admits is not None and admits(employee):
                people.add(employee)
            house_cal_live.check_cell(pic.isos, people, employee, col_iso,
                                      pic.published(employee, col_iso))
            _called_off(dsn, location, employee, col_iso)
            before = pic.text(employee, col_iso)
            prior = pic.drafts.get((employee, col_iso)) or {}
            if value == before and note == str(prior.get("note") or ""):
                conn.commit()
                return {"changed": False, "employee": employee, "col_iso": col_iso,
                        "value": value, "was": before}
            got = _overlap(dsn, employee, location, col_iso, value,
                           [(location, employee, col_iso)], approver=actor)
            act = _act()
            _put(cur, pic, location, employee, col_iso, value, actor=actor, note=note,
                 ist_missing=_ist_line(got))
            _record(cur, location, employee, col_iso, before, value, via=via, actor=actor,
                    note=note, act=act, stage=house_cal_live.STAGE_DRAFT)
            conn.commit()
    return {"changed": True, "employee": employee, "col_iso": col_iso, "value": value,
            "was": before, "act": act, "ist": got.get("ist"),
            "warning": _asked_off(dsn, employee, col_iso, value)}


def _asked_off(dsn: str, person: str, col_iso: str, value: str) -> str:
    """A pending time-off request over this day warns and never refuses."""
    if not person or house_cal_live.is_open_row(person) or shift_requests.span_of(col_iso, value) is None:
        return ""
    try:
        import time_off  # noqa: PLC0415 — lazy: it imports shift_requests back
        return time_off.pending_warning(dsn, person, col_iso)
    except Exception:  # noqa: BLE001 — FAIL-OPEN: a warning that could not be read is not a refusal
        return ""


def stage_move(dsn: str, *, location: str, src_employee: str, src_iso: str,
               dst_employee: str, dst_iso: str, actor: str, swap: bool = False,
               replace: bool = False, value: str | None = None, note: str = "",
               admits: Callable[[str], bool] | None = None) -> dict[str, Any]:
    """Move a shift as one draft act (`swap`, `replace`, `value`); never from or onto an OPEN row or a call-off."""
    src_employee, dst_employee = _clean(src_employee, 200), _clean(dst_employee, 200)
    note = _clean(note, MAX_NOTE)
    if (src_employee, src_iso) == (dst_employee, dst_iso):
        if value is None:
            return {"moved": False, "why": "same cell"}
        return stage_cell(dsn, location=location, employee=src_employee, col_iso=src_iso,
                          value=value, actor=actor, note=note, admits=admits)
    ensure_tables(dsn)
    house_cal_live.check_ends(src_employee, dst_employee)
    _called_off(dsn, location, src_employee, src_iso)
    if swap:
        _called_off(dsn, location, dst_employee, dst_iso)
    people_locked = sorted({dst_employee} | ({src_employee} if swap else set()), key=fold)
    gates = [shift_requests.person_gate(dsn, p) for p in people_locked]
    for g in gates:
        g.__enter__()
    try:
        with _connect(dsn) as conn, conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            pic = _picture(cur, dsn, location)
            dst_employee = pic.spelled(dst_employee)
            people = set(pic.people)
            if dst_employee not in people and admits is not None and admits(dst_employee):
                people.add(dst_employee)
            moving, landing, replacing = house_cal_live.check_move(
                pic.isos, people, pic.text, src_employee, src_iso, dst_employee, dst_iso,
                swap=swap, replace=replace)
            landing_value = _clean(value) if value is not None else moving
            both = [(location, dst_employee, dst_iso), (location, src_employee, src_iso)]
            got = _overlap(dsn, dst_employee, location, dst_iso, landing_value, both,
                           approver=actor)
            back = {"ist": None}
            if swap and landing.strip():
                back = _overlap(dsn, src_employee, location, src_iso, landing, both,
                                approver=actor)
            via = "swap" if swap else ("replace" if replacing else "move")
            act = _act()
            _put(cur, pic, location, dst_employee, dst_iso, landing_value, actor=actor,
                 note=note, ist_missing=_ist_line(got))
            _record(cur, location, dst_employee, dst_iso, landing, landing_value, via=via,
                    actor=actor, note=note, act=act, stage=house_cal_live.STAGE_DRAFT)
            new_src = landing if swap else ""
            _put(cur, pic, location, src_employee, src_iso, new_src, actor=actor,
                 ist_missing=_ist_line(back))
            _record(cur, location, src_employee, src_iso, moving, new_src, via=via,
                    actor=actor, note=note, act=act, stage=house_cal_live.STAGE_DRAFT)
            conn.commit()
    finally:
        for g in reversed(gates):
            g.__exit__(None, None, None)
    warning = _asked_off(dsn, dst_employee, dst_iso, landing_value)
    if swap and landing.strip():
        warning = warning or _asked_off(dsn, src_employee, src_iso, landing)
    return {"moved": True, "value": landing_value, "displaced": landing, "swap": bool(swap),
            "replaced": replacing, "act": act, "employee": dst_employee, "warning": warning}


def request_off(dsn: str, *, location: str, employee: str, col_iso: str, actor: str,
                note: str = "") -> dict[str, Any]:
    """Request Off: R/O, the shift moved to the first free OPEN row; refused when there is none."""
    return _release(dsn, location=location, employee=employee, col_iso=col_iso, actor=actor,
                    note=note, strict=True)


def time_off_release(dsn: str, *, location: str, employee: str, col_iso: str, actor: str,
                     note: str = "") -> dict[str, Any]:
    """Request Off for approved time off: with no free OPEN row the shift stays and `unplaced` says so."""
    return _release(dsn, location=location, employee=employee, col_iso=col_iso, actor=actor,
                    note=note, strict=False)


def _release(dsn: str, *, location: str, employee: str, col_iso: str, actor: str, note: str,
             strict: bool) -> dict[str, Any]:
    employee, note = _clean(employee, 200), _clean(note, MAX_NOTE)
    if house_cal_live.is_open_row(employee):
        raise ValueError("an open row has nobody on it to take off")
    ensure_tables(dsn)
    _called_off(dsn, location, employee, col_iso)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        pic = _picture(cur, dsn, location)
        house_cal_live.check_cell(pic.isos, pic.people, employee, col_iso,
                                  pic.published(employee, col_iso))
        text = pic.text(employee, col_iso)
        if text.strip().upper() in ("R/O", "RO"):
            conn.commit()
            return {"changed": False, "why": "that day is already requested off"}
        if not strict and text.strip() and shift_requests.span_of(col_iso, text) is None:
            conn.commit()
            return {"changed": False, "why": f"the day already reads {text}"}
        moved_to = ""
        act = _act()
        if shift_requests.span_of(col_iso, text) is not None:
            moved_to = next((r for r in pic.open_rows
                             if not r.startswith(shift_requests.CALL_OFF_ROW)
                             and not pic.text(r, col_iso).strip()), "")
            if not moved_to and not strict:
                conn.commit()
                return {"changed": False, "unplaced": True, "value": text,
                        "why": f"no OPEN row at this house is free on {col_iso}, so the {text} shift "
                               f"stays under the name until it is moved"}
            if not moved_to:
                raise Refused(
                    f"no OPEN row at this house is free on {col_iso}, so the {text} shift would "
                    f"have nowhere to go — move it first, then request the day off",
                    "no_open_row")
            _put(cur, pic, location, moved_to, col_iso, text, actor=actor,
                 note=f"{employee} requested the day off")
            _record(cur, location, moved_to, col_iso, "", text, via="request_off",
                    actor=actor, note=f"{employee} requested the day off", act=act,
                    stage=house_cal_live.STAGE_DRAFT)
        _put(cur, pic, location, employee, col_iso, "R/O", actor=actor, note=note)
        _record(cur, location, employee, col_iso, text, "R/O", via="request_off", actor=actor,
                note=note, act=act, stage=house_cal_live.STAGE_DRAFT)
        conn.commit()
    return {"changed": True, "moved_to": moved_to, "value": "R/O", "was": text, "act": act}


def transfer_waiting(cur, location: str, employee: str, col_iso: str) -> bool:
    """A transfer of this person's shift that day still waits (shift_handoff); a database that never offered one has none."""
    if not _table_is_there(cur, "asa_shift_handoffs"):
        return False
    cur.execute("SELECT from_staff FROM asa_shift_handoffs WHERE location=%s AND col_iso=%s AND state='pending'",
                (location, col_iso))
    who = fold(employee)
    return any(fold(_col(r, "from_staff", 0)) == who for r in cur.fetchall())


def mark_call_off(dsn: str, *, location: str, employee: str, col_iso: str, actor: str,
                  note: str = "", now: datetime | None = None) -> dict[str, Any]:
    """Mark Call-Off, not a draft: opens the pool's call-off shift and, in the same transaction, owes the rest of…"""
    import calloff_road  # noqa: PLC0415 — only this act owes the road
    employee, note = _clean(employee, 200), _clean(note, MAX_NOTE)
    now = now or datetime.now(timezone.utc)
    if house_cal_live.is_open_row(employee):
        raise ValueError("an open row has nobody on it to call off")
    # a WORKSHOP row is nobody either: no caller, no Call Off Tracker row, no URGENT to all staff
    if house_cal_live.not_a_person(employee, location):
        raise ValueError("a WORKSHOP row has nobody on it to call off")
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        pic = _picture(cur, dsn, location)
        if (employee, col_iso) in pic.drafts:
            raise Refused("this cell has a draft on it — publish it or undo it first: a call-off "
                          "is about the shift the house was told", "draft_pending")
        if transfer_waiting(cur, location, employee, col_iso):
            raise Refused("a transfer of this shift is waiting — answer it or withdraw it in House "
                          "Calendars first", "transfer_pending")
        text = pic.effective(employee, col_iso)
        span = shift_requests.span_of(col_iso, text)
        if span is None:
            raise Refused("there is no shift with hours in that cell to call off", "no_shift")
        if span[1] <= now:
            raise Refused("that shift has already ended", "ended")
        shift_requests._ddl(cur)
        ref = shift_requests.ref_of(location, employee, col_iso)
        reason = note or f"marked on Calendar Builder by {actor} — no reason was typed"
        cur.execute(
            "INSERT INTO asa_shift_pool (location, open_row, col_iso, kind, value, opened_at, "
            "shift_start, shift_end, called_off_by, reason, ref) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING ref",
            (location, employee, col_iso, shift_requests.KIND_CALLOFF, text, now, span[0],
             span[1], employee, reason, ref))
        if not cur.fetchone():
            raise Refused("this shift is already in the open-shift pool — it is on House "
                          "Calendars' red line", "already_pooled")
        calloff_road.owe(cur, ref=ref, location=location, employee=employee, col_iso=col_iso,
                         value=text, shift_start=span[0], reason=reason, actor=actor)
        # the reason stays on the pool row (REASON_BADGES), never in the cell's history
        _record(cur, location, employee, col_iso, text, text, via="call_off", actor=actor,
                note="", act=_act(), stage=house_cal_live.STAGE_CALL_OFF)
        conn.commit()
    window = shift_requests.window_for(shift_requests.KIND_CALLOFF, opened_at=now,
                                       shift_start=span[0], now=now)
    log.info("calendar-builder: call-off marked %s / %s / %s by %s — the call-off road is owed "
             "to Apps Script", location, employee, col_iso, actor)
    return {"ref": ref, "location": location, "col_iso": col_iso, "value": text,
            "window": window, "path": shift_requests.deep_link(ref, location),
            "road": calloff_road.OWED}


def undo(dsn: str, *, location: str, actor: str) -> dict[str, Any]:
    """Undo this person's last draft act on this house, whole; refused when a cell changed since."""
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT coalesce(max(id), 0) AS id FROM asa_house_calendar_edits "
                    "WHERE location=%s AND ((stage=%s AND via='discard') "
                    "OR (stage=%s AND via='publish'))",
                    (location, house_cal_live.STAGE_DRAFT, house_cal_live.STAGE_PUBLISHED))
        closed = int(cur.fetchone()["id"])
        cur.execute("SELECT act FROM asa_house_calendar_edits WHERE location=%s AND stage=%s "
                    "AND actor=%s AND undone_at IS NULL AND act<>'' AND id > %s "
                    "AND via NOT IN ('undo', 'discard') ORDER BY id DESC LIMIT 1",
                    (location, house_cal_live.STAGE_DRAFT, str(actor or "")[:200], closed))
        got = cur.fetchone()
    if not got:
        raise Refused("nothing of yours on this house is left to undo", "nothing_to_undo")
    act = str(got["act"])
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT employee FROM asa_house_calendar_edits WHERE act=%s", (act,))
        persons = sorted({str(r["employee"]) for r in cur.fetchall()
                          if not house_cal_live.is_open_row(r["employee"])}, key=fold)
    gates = [shift_requests.person_gate(dsn, p) for p in persons]
    for g in gates:
        g.__enter__()
    try:
        with _connect(dsn) as conn, conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            pic = _picture(cur, dsn, location)
            cur.execute("SELECT * FROM asa_house_calendar_edits WHERE act=%s AND undone_at IS NULL "
                        "ORDER BY id DESC", (act,))
            rows = [dict(r) for r in cur.fetchall()]
            if not rows:
                raise Refused("that change was already undone", "nothing_to_undo")
            for r in rows:
                if pic.text(r["employee"], r["col_iso"]) != str(r["new_value"]):
                    raise Refused(
                        f"{r['employee']}'s {r['col_iso']} has changed since — undo it by hand "
                        f"rather than put back what somebody else replaced", "changed")
            cells = [(location, str(r["employee"]), str(r["col_iso"])) for r in rows]
            checks = {}
            for r in rows:
                checks[(r["employee"], r["col_iso"])] = _overlap(
                    dsn, str(r["employee"]), location, str(r["col_iso"]),
                    str(r["old_value"]), cells, approver=actor)
            again = _act()
            for r in rows:
                _put(cur, pic, location, str(r["employee"]), str(r["col_iso"]),
                     str(r["old_value"]), actor=actor,
                     ist_missing=_ist_line(checks[(r["employee"], r["col_iso"])]))
                _record(cur, location, str(r["employee"]), str(r["col_iso"]),
                        str(r["new_value"]), str(r["old_value"]), via="undo", actor=actor,
                        act=again, stage=house_cal_live.STAGE_DRAFT, undone=True)
            cur.execute("UPDATE asa_house_calendar_edits SET undone_at=now() WHERE act=%s",
                        (act,))
            conn.commit()
    finally:
        for g in reversed(gates):
            g.__exit__(None, None, None)
    return {"undone": len(rows), "act": act,
            "cells": [{"employee": r["employee"], "col_iso": r["col_iso"],
                       "value": r["old_value"]} for r in rows]}


def discard(dsn: str, *, location: str, actor: str) -> dict[str, Any]:
    """Discard this house's whole draft."""
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        pic = _picture(cur, dsn, location)
        act = _act()
        for (emp, iso), d in sorted(pic.drafts.items()):
            _record(cur, location, emp, iso, str(d["value"]), pic.effective(emp, iso),
                    via="discard", actor=actor, act=act, stage=house_cal_live.STAGE_DRAFT)
        cur.execute("DELETE FROM asa_cal_builder_house_draft WHERE location=%s", (location,))
        conn.commit()
    return {"discarded": len(pic.drafts)}


def history(dsn: str, location: str, employee: str, col_iso: str,
            limit: int = 40, *, sees_reasons: bool = False) -> list[dict[str, Any]]:
    """One cell's history, newest first; call-off notes only for `sees_reasons`."""
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT id, old_value, new_value, via, actor, at, stage, note, act, undone_at "
                    "FROM asa_house_calendar_edits WHERE location=%s AND employee=%s "
                    "AND col_iso=%s ORDER BY id DESC LIMIT %s",
                    (location, employee, col_iso, int(limit)))
        rows = [dict(r) for r in cur.fetchall()]
    return [{"id": int(r["id"]), "was": r["old_value"], "now": r["new_value"],
             "via": r["via"], "by": r["actor"], "at": _iso(r["at"]),
             "stage": r["stage"] or "override",
             "note": ("" if r["stage"] == house_cal_live.STAGE_CALL_OFF and not sees_reasons
                      else r["note"]),
             "undone": bool(r["undone_at"])} for r in rows]


def _iso(v: Any) -> str:
    return v.isoformat() if hasattr(v, "isoformat") else str(v or "")


# publish — the house's draft into the workbook

def publish_house(dsn: str, *, location: str, actor: str) -> dict[str, Any]:
    """Publish one house's draft: the overlap law and trainers asked again against what is real now, under the…"""
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        persons = sorted({e for (e, _i) in _drafts(cur, location)
                          if not house_cal_live.is_open_row(e)}, key=fold)
    gates = shift_requests.person_gates(
        dsn, [*persons, *shift_requests.trainer_names(dsn, location, approver=actor)])
    gates.__enter__()
    try:
        with _connect(dsn) as conn, conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            pic = _picture(cur, dsn, location)
            if not pic.drafts:
                raise Refused("nothing is drafted for this house", "empty")
            # gates came from a first read; a person drafted since refuses the publish
            gated = {fold(p) for p in persons}
            joined = sorted({e for (e, _i) in pic.drafts
                             if not house_cal_live.is_open_row(e) and fold(e) not in gated})
            if joined:
                raise Refused(f"the draft changed while it was being published ({', '.join(joined)} "
                              f"drafted since) — nothing was written; publish again",
                              "draft_changed")
            picture = {(location, e, i): str(d["value"]) for (e, i), d in pic.drafts.items()}
            refusals: list[dict[str, Any]] = []
            ist_owed: list[tuple[str, str, str, dict[str, Any]]] = []
            for (emp, iso), d in sorted(pic.drafts.items()):
                if shift_requests.open_call_off_at(dsn, location, emp, iso):
                    refusals.append({"employee": emp, "col_iso": iso, "value": d["value"],
                                     "reason": "this shift was called off since it was drafted "
                                               "— it is given from its red cell"})
                    continue
                try:
                    got = _overlap(dsn, emp, location, iso, str(d["value"]),
                                   [(location, emp, iso)], drafts="none", picture=picture,
                                   approver=actor)
                except Refused as exc:
                    refusals.append({"employee": emp, "col_iso": iso, "value": d["value"],
                                     "reason": exc.why})
                    continue
                if got.get("ist") and not got["ist"].get("ok"):
                    trains = got.get("training") or {}
                    if not trains.get("may_approve"):
                        refusals.append({"employee": emp, "col_iso": iso, "value": d["value"],
                                         "reason": (f"{got['ist'].get('why') or 'no IST here'} — "
                                                    f"{trains.get('why') or 'who trains could not be read'}"),
                                         "training": trains})
                        continue
                    waits = shift_requests.unowned_training(
                        dsn, got, location=location, open_row=emp, col_iso=iso,
                        value=str(d["value"]), person=emp)
                    if waits:
                        refusals.append({"employee": emp, "col_iso": iso, "value": d["value"],
                                         "reason": waits, "training": trains})
                        continue
                    ist_owed.append((emp, iso, str(d["value"]), got["ist"], trains))
            if refusals:
                raise Refused(f"{len(refusals)} drafted cell{'' if len(refusals) == 1 else 's'} "
                              f"cannot be published as they stand — nothing was written",
                              "blocked", blocked=refusals)
            act = _act()
            result = publish_cells(
                dsn, location,
                [{"employee": e, "col_iso": i, "value": d["value"], "base": d["base_value"],
                  "note": d.get("note") or ""} for (e, i), d in sorted(pic.drafts.items())],
                actor=actor, via="publish", act=act)
            cur.execute("DELETE FROM asa_cal_builder_house_draft WHERE location=%s", (location,))
            conn.commit()
            # trainings recorded before the trainers' gates open
            training = []
            written = {(c["employee"], c["col_iso"]) for c in result.get("cells") or []}
            for emp, iso, value, verdict, trains in ist_owed:
                if (emp, iso) not in written:
                    continue
                try:
                    training.append(shift_requests.raise_training(
                        dsn, kind=shift_requests.KIND_OPEN, location=location, open_row=emp,
                        col_iso=iso, value=value, person=emp, verdict=verdict,
                        approved_by=actor,
                        trainer=shift_requests.trainer_record(trains, by=actor)))
                except Exception as exc:  # noqa: BLE001 — the shift is published either way
                    log.warning("calendar-builder: training approval for %s at %s not recorded "
                                "(%s)", emp, location, type(exc).__name__)
    finally:
        gates.__exit__(None, None, None)
    shift_requests.forget_estate()
    return {**result, "published": len(pic.drafts), "training": training}


def push_house(dsn: str, *, location: str, cells: Iterable[dict[str, Any]], actor: str,
               via: str = "master_push", dry_run: bool = False) -> dict[str, Any]:
    """The master grid's push into one house by the house publish's law and writer; cells a house draft waits on…"""
    todo = [{"employee": _clean(c.get("employee"), 200), "col_iso": _clean(c.get("col_iso"), 20),
             "value": _clean(c.get("value")), "base": _clean(c.get("base"))} for c in cells]
    if not todo:
        return {"written": 0, "refused": [], "training": [], "cells": []}
    ensure_tables(dsn)
    persons = sorted({c["employee"] for c in todo if not house_cal_live.is_open_row(c["employee"])},
                     key=fold)
    gates = shift_requests.person_gates(
        dsn, [*persons, *shift_requests.trainer_names(dsn, location, approver=actor)])
    training: list[str] = []
    with gates:
        with _connect(dsn) as conn, conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            try:
                pic = _picture(cur, dsn, location)
            except LookupError as exc:
                raise WorkbookRefused(f"{exc} — nothing was written", "no_calendar") from None
            # cells not the master's to write are named and skipped
            left_out: list[dict[str, Any]] = []
            kept: list[dict[str, Any]] = []
            for c in todo:
                emp, iso = c["employee"], c["col_iso"]
                if (emp, iso) in pic.drafts:
                    left_out.append({**c, "reason": "a draft is waiting on this cell in the "
                                                    "house's own Builder"})
                elif house_cal_live.is_open_row(emp) \
                        and shift_requests.span_of(iso, pic.published(emp, iso)) is not None:
                    left_out.append({**c, "reason": "an open shift the house published — it is "
                                                    "applied for and given from Calendar Builder → "
                                                    "Live, never pushed over"})
                else:
                    kept.append(c)
            todo = kept
            picture = {(location, c["employee"], c["col_iso"]): c["value"] for c in todo}
            refusals: list[dict[str, Any]] = []
            ist_owed: list[tuple[str, str, str, dict[str, Any], dict[str, Any]]] = []
            for c in todo:
                emp, iso, value = c["employee"], c["col_iso"], c["value"]
                if not house_cal_live.is_open_row(emp) \
                        and shift_requests.open_call_off_at(dsn, location, emp, iso):
                    refusals.append({"employee": emp, "col_iso": iso, "value": value,
                                     "reason": "this shift was called off and is taking "
                                               "applications on Calendar Builder → Live"})
                    continue
                try:
                    got = _overlap(dsn, emp, location, iso, value, [(location, emp, iso)],
                                   drafts="none", picture=picture, approver=actor)
                except Refused as exc:
                    refusals.append({"employee": emp, "col_iso": iso, "value": value,
                                     "reason": exc.why})
                    continue
                if got.get("ist") and not got["ist"].get("ok"):
                    trains = got.get("training") or {}
                    if not trains.get("may_approve"):
                        refusals.append({"employee": emp, "col_iso": iso, "value": value,
                                         "reason": (f"{got['ist'].get('why') or 'no IST here'} — "
                                                    f"{trains.get('why') or 'who trains could not be read'}")})
                        continue
                    waits = shift_requests.unowned_training(
                        dsn, got, location=location, open_row=emp, col_iso=iso, value=value,
                        person=emp, raise_it=not dry_run)
                    if waits:
                        refusals.append({"employee": emp, "col_iso": iso, "value": value,
                                         "reason": waits})
                        continue
                    ist_owed.append((emp, iso, value, got["ist"], trains))
            conn.commit()
        if refusals:
            raise Refused(f"{len(refusals)} cell{'' if len(refusals) == 1 else 's'} of the master "
                          f"grid cannot be pushed into {location} as they stand — nothing was "
                          f"written there", "blocked", blocked=refusals, left_out=left_out)
        if dry_run or not todo:
            return {"written": 0, "would_write": len(todo), "refused": [], "training": [],
                    "cells": todo, "left_out": left_out}
        result = publish_cells(dsn, location, todo, actor=actor, via=via, act=_act())
        written = {(c["employee"], c["col_iso"]) for c in result.get("cells") or []}
        # trainings recorded before the trainers' gates open
        for emp, iso, value, verdict, trains in ist_owed:
            if (emp, iso) not in written:
                continue
            try:
                training.append(shift_requests.raise_training(
                    dsn, kind=shift_requests.KIND_OPEN, location=location, open_row=emp,
                    col_iso=iso, value=value, person=emp, verdict=verdict, approved_by=actor,
                    trainer=shift_requests.trainer_record(trains, by=actor)))
            except Exception as exc:  # noqa: BLE001 — the shift is published either way
                log.warning("calendar-builder: training approval for %s at %s not recorded (%s)",
                            emp, location, type(exc).__name__)
    return {**result, "refused": [], "training": training, "left_out": left_out}


# What test mode held waits per house for Publish now or Discard; never replayed because the switch moved.

def held_cells(dsn: str, location: str) -> list[dict[str, Any]]:
    """The held cells still waiting at this house; `base` is the value before test mode first touched it."""
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT id, employee, col_iso, old_value, new_value, via, actor, at, note, act "
                    "FROM asa_house_calendar_edits WHERE location=%s AND stage=%s "
                    "AND undone_at IS NULL ORDER BY id", (location, house_cal_live.STAGE_TEST_MODE))
        rows = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT employee, col_iso, max(id) AS id FROM asa_house_calendar_edits "
                    "WHERE location=%s AND stage=%s GROUP BY employee, col_iso",
                    (location, house_cal_live.STAGE_PUBLISHED))
        real = {(str(r["employee"]), str(r["col_iso"])): int(r["id"]) for r in cur.fetchall()}
    per: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        key = (str(r["employee"]), str(r["col_iso"]))
        entry = per.get(key)
        if entry is None:
            entry = per[key] = {"employee": key[0], "col_iso": key[1],
                                "base": str(r["old_value"] or ""), "acts": [], "note": "",
                                shift_requests.REHEARSAL: False}
        entry.update({"value": str(r["new_value"] or ""), "last_id": int(r["id"]),
                      "by": str(r["actor"] or ""), "at": _iso(r["at"]),
                      "via": str(r["via"] or "")})
        # THE MARK on a held cell: the writer's own via.
        if str(r["via"] or "").startswith(shift_requests.REHEARSAL_VIA) \
                and int(r["id"]) > real.get(key, 0):
            entry[shift_requests.REHEARSAL] = True
        if r.get("act") and r["act"] not in entry["acts"]:
            entry["acts"].append(str(r["act"]))
        if r.get("note"):
            entry["note"] = str(r["note"])
    out = [e for k, e in per.items() if real.get(k, 0) < e["last_id"]]
    out.sort(key=lambda e: (e["col_iso"], fold(e["employee"])))
    return out


def publish_held(dsn: str, *, location: str, actor: str) -> dict[str, Any]:
    """Publish what test mode held, only once it is off, weighed as a house publish; one refusal writes nothing."""
    switch = effective_roster.test_mode()
    if switch.get("on"):
        raise Refused("test mode is still on — what it held is published once it is off; until "
                      "then it stays on the platform, marked as test mode", "test_mode_on")
    everything = held_cells(dsn, location)
    # A CELL A REHEARSAL WROTE IS NEVER PUBLISHED WITH THE REST.
    played = [c for c in everything if c.get(shift_requests.REHEARSAL)]
    todo = [c for c in everything if not c.get(shift_requests.REHEARSAL)]
    if not todo:
        raise Refused(
            (f"the {len(played)} cell{'' if len(played) == 1 else 's'} waiting here "
             f"{'was' if len(played) == 1 else 'were'} played in the shift rehearsal — nobody "
             f"really took {'that shift' if len(played) == 1 else 'those shifts'}, so "
             f"{'it is' if len(played) == 1 else 'they are'} never published. The rehearsal plays "
             f"in a sandbox of its own, so {'it' if len(played) == 1 else 'they'} should not be on "
             f"the real calendar at all — nothing was published"
             if played else "nothing test mode held is waiting at this house"),
            "rehearsal_only" if played else "empty",
            blocked=[{k: c.get(k) for k in ("employee", "col_iso", "value", "base")}
                     for c in played])
    persons = sorted({c["employee"] for c in todo if not house_cal_live.is_open_row(c["employee"])},
                     key=fold)
    gates = shift_requests.person_gates(
        dsn, [*persons, *shift_requests.trainer_names(dsn, location, approver=actor)])
    training: list[str] = []
    with gates:
        picture = {(location, c["employee"], c["col_iso"]): c["value"] for c in todo}
        refusals: list[dict[str, Any]] = []
        ist_owed: list[tuple[str, str, str, dict[str, Any], dict[str, Any]]] = []
        for c in todo:
            emp, iso, value = c["employee"], c["col_iso"], c["value"]
            if not house_cal_live.is_open_row(emp) \
                    and shift_requests.open_call_off_at(dsn, location, emp, iso):
                refusals.append({"employee": emp, "col_iso": iso, "value": value,
                                 "reason": "this shift was called off and is taking applications "
                                           "on Calendar Builder → Live"})
                continue
            try:
                got = _overlap(dsn, emp, location, iso, value, [(location, emp, iso)],
                               drafts="none", picture=picture, approver=actor)
            except Refused as exc:
                refusals.append({"employee": emp, "col_iso": iso, "value": value,
                                 "reason": exc.why})
                continue
            if got.get("ist") and not got["ist"].get("ok"):
                trains = got.get("training") or {}
                if not trains.get("may_approve"):
                    refusals.append({"employee": emp, "col_iso": iso, "value": value,
                                     "reason": (f"{got['ist'].get('why') or 'no IST here'} — "
                                                f"{trains.get('why') or 'who trains could not be read'}")})
                    continue
                waits = shift_requests.unowned_training(
                    dsn, got, location=location, open_row=emp, col_iso=iso, value=value,
                    person=emp)
                if waits:
                    refusals.append({"employee": emp, "col_iso": iso, "value": value,
                                     "reason": waits})
                    continue
                ist_owed.append((emp, iso, value, got["ist"], trains))
        if refusals:
            raise Refused(f"{len(refusals)} held cell{'' if len(refusals) == 1 else 's'} cannot be "
                          f"published as {'it stands' if len(refusals) == 1 else 'they stand'} — "
                          f"nothing was written", "blocked", blocked=refusals)
        result = publish_cells(dsn, location,
                               [{"employee": c["employee"], "col_iso": c["col_iso"],
                                 "value": c["value"], "base": c["base"], "note": c["note"]}
                                for c in todo],
                               actor=actor, via="test_mode_publish", act=_act())
        done = {(c["employee"], c["col_iso"]) for c in todo}
        with _connect(dsn) as conn, conn.cursor() as cur:
            for emp, iso in sorted(done):
                last = next(c["last_id"] for c in todo if (c["employee"], c["col_iso"]) == (emp, iso))
                cur.execute("UPDATE asa_house_calendar_edits SET undone_at=now() WHERE location=%s "
                            "AND employee=%s AND col_iso=%s AND stage=%s AND undone_at IS NULL "
                            "AND id <= %s",
                            (location, emp, iso, house_cal_live.STAGE_TEST_MODE, last))
            conn.commit()
        written = {(c["employee"], c["col_iso"]) for c in result.get("cells") or []}
        for emp, iso, value, verdict, trains in ist_owed:
            if (emp, iso) not in written:
                continue
            try:
                training.append(shift_requests.raise_training(
                    dsn, kind=shift_requests.KIND_OPEN, location=location, open_row=emp,
                    col_iso=iso, value=value, person=emp, verdict=verdict, approved_by=actor,
                    trainer=shift_requests.trainer_record(trains, by=actor)))
            except Exception as exc:  # noqa: BLE001 — the shift is published either way
                log.warning("calendar-builder: training approval for %s at %s not recorded (%s)",
                            emp, location, type(exc).__name__)
    shift_requests.forget_estate()
    log.info("calendar-builder: %d cell(s) test mode held at %s published now by %s — %d written "
             "(%d left where they are: the shift rehearsal played them)",
             len(todo), location, actor, int(result.get("written") or 0), len(played))
    return {**result, "published": len(todo), "training": training,
            "rehearsed_left_behind": [{k: c.get(k) for k in ("employee", "col_iso", "value")}
                                      for c in played]}


def discard_held(dsn: str, *, location: str, actor: str,
                 cells: Iterable[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Discard what test mode held here (or only `cells`), withdrawing the trainings it took on; decisions stand."""
    held = held_cells(dsn, location)
    if cells is not None:
        wanted = {(_clean(c.get("employee"), 200), _clean(c.get("col_iso"), 20)) for c in cells}
        held = [h for h in held if (h["employee"], h["col_iso"]) in wanted]
    if not held:
        raise Refused("nothing test mode held is waiting there", "empty")
    act = _act()
    withdrawn = 0
    with _connect(dsn) as conn, conn.cursor() as cur:
        shift_requests._ddl(cur)
        for h in held:
            cur.execute("UPDATE asa_house_calendar_edits SET undone_at=now() WHERE location=%s "
                        "AND employee=%s AND col_iso=%s AND stage=%s AND undone_at IS NULL "
                        "AND id <= %s",
                        (location, h["employee"], h["col_iso"], house_cal_live.STAGE_TEST_MODE,
                         h["last_id"]))
            _record(cur, location, h["employee"], h["col_iso"], h["value"], h["base"],
                    via="test_mode_discard", actor=actor, act=act,
                    stage=house_cal_live.STAGE_TEST_MODE, undone=True)
            if house_cal_live.is_open_row(h["employee"]):
                continue
            cur.execute("UPDATE asa_shift_requests SET state=%s, why=%s, decided_at=now() "
                        "WHERE kind=%s AND location=%s AND open_row=%s AND col_iso=%s "
                        "AND lower(person)=lower(%s) AND state=%s AND ref=%s AND decided_by=%s",
                        (shift_requests.WITHDRAWN,
                         "the shift test mode held was discarded, so there is no first shift to train",
                         shift_requests.KIND_IST, location, h["employee"], h["col_iso"],
                         h["employee"], shift_requests.APPROVED, shift_requests.KIND_OPEN,
                         h["by"]))
            withdrawn += cur.rowcount or 0
        conn.commit()
    shift_requests.forget_estate()
    effective_roster.announce(location, [{"employee": h["employee"], "col_iso": h["col_iso"],
                                          "value": h["base"]} for h in held],
                              via="test_mode_discard", actor=actor)
    log.info("calendar-builder: %d cell(s) test mode held at %s discarded by %s (%d training "
             "approval(s) withdrawn)", len(held), location, actor, withdrawn)
    return {"discarded": len(held), "trainings_withdrawn": withdrawn,
            "cells": [{"employee": h["employee"], "col_iso": h["col_iso"], "value": h["base"],
                       "was": h["value"]} for h in held]}


# the Builder's reads

def draft_grid(dsn: str, location: str, who: dict[str, Any] | None, *,
               now: datetime | None = None) -> dict[str, Any] | None:
    """One house with its draft laid on before the arithmetic, plus each person's week at every house."""
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        drafts = _drafts(cur, location)

    def layer(grid: dict[str, Any]) -> None:
        isos = house_cal_live.col_isos(grid)
        at = {iso: i for i, iso in enumerate(isos)}
        rows = grid.setdefault("rows", [])
        by_name = {str(r.get("employee") or ""): r for r in rows if isinstance(r, dict)}
        for (emp, iso), d in sorted(drafts.items()):
            i = at.get(iso)
            if i is None:
                continue
            row = by_name.get(emp)
            if row is None:
                row = {"employee": emp, "cells": [], "open_row": house_cal_live.is_open_row(emp),
                       "draft_row": True}
                rows.append(row)
                by_name[emp] = row
            cells = row.setdefault("cells", [])
            while len(cells) < len(isos):
                cells.append({"text": "", "color": "transparent"})
            cell = {k: v for k, v in (cells[i] or {}).items() if k not in ("edited", "pending")}
            cell.update({"text": str(d["value"]), "draft": {
                "base": str(d["base_value"]), "note": str(d.get("note") or ""),
                "by": str(d.get("updated_by") or ""), "at": _iso(d.get("updated_at")),
                "ist": str(d.get("ist_missing") or "")}})
            cells[i] = cell

    grid = shift_requests.calendar_grid(dsn, location, who, now=now, layer=layer)
    if grid is None:
        return None
    grid["drafts"] = [{"employee": e, "col_iso": i, "value": d["value"],
                       "base": d["base_value"], "note": d.get("note") or "",
                       "by": d.get("updated_by") or "", "at": _iso(d.get("updated_at")),
                       "ist": d.get("ist_missing") or ""}
                      for (e, i), d in sorted(drafts.items())]
    grid["draft_count"] = len(drafts)
    # what test mode held here, and whether it holds now
    switch = effective_roster.test_mode()
    grid["test_mode"] = {"on": bool(switch.get("on")), "readable": bool(switch.get("readable")),
                         "why": str(switch.get("why") or "")}
    try:
        grid["held"] = held_cells(dsn, location)
        grid["held_readable"] = True
    except Exception as exc:  # noqa: BLE001 — said, never drawn as "nothing held"
        grid["held"] = []
        grid["held_readable"] = False
        log.warning("calendar-builder: what test mode held at %s could not be read (%s)",
                    location, type(exc).__name__)
    names = [str(r.get("employee") or "") for r in grid.get("rows") or []
             if not r.get("open_row") and not r.get("call_off_row")]
    try:
        grid["estate_weeks"] = planned_weeks(dsn, names)
        grid["estate_readable"] = True
    except Exception as exc:  # noqa: BLE001 — said, never drawn as "no other hours"
        grid["estate_weeks"] = {}
        grid["estate_readable"] = False
        log.warning("calendar-builder: the estate could not be totalled (%s)", type(exc).__name__)
    return grid


def planned_weeks(dsn: str, people: Iterable[str]) -> dict[str, dict[str, float]]:
    """{person: {saturday: hours}} over every house, drafts laid on."""
    wanted = {fold(p): p for p in people if p}
    if not wanted:
        return {}
    view = shift_requests.estate(dsn)
    held: dict[str, dict[tuple[str, str], float]] = {k: {} for k in wanted}
    for key in wanted:
        for h in view["spans"].get(key, []):
            a, b = h["span"]
            held[key][(h["location"], h["col_iso"])] = (b - a).total_seconds() / 3600
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT location, employee, col_iso, value FROM asa_cal_builder_house_draft")
        for loc, emp, iso, val in cur.fetchall():
            key = fold(emp)
            if key not in held or house_cal_live.is_open_row(emp):
                continue
            span = shift_requests.span_of(iso, val)
            if span is None:
                held[key].pop((loc, iso), None)
            else:
                held[key][(loc, iso)] = (span[1] - span[0]).total_seconds() / 3600
    out: dict[str, dict[str, float]] = {}
    for key, cells in held.items():
        weeks: dict[str, float] = {}
        for (_loc, iso), hours in cells.items():
            wk = house_cal_live.week_key(iso)
            weeks[wk] = round(weeks.get(wk, 0.0) + hours, 2)
        out[wanted[key]] = weeks
    return out


_DIRECTORY: dict[str, Any] = {"at": 0.0, "rows": None, "accounts": True}
DIRECTORY_TTL_S = 60.0


def staff_directory(dsn: str, *, fresh: bool = False) -> dict[str, Any]:
    """{staff: [{name, houses}], accounts_readable} — everybody a house manager may place."""
    now = time.time()
    if not fresh and _DIRECTORY["rows"] is not None and now - _DIRECTORY["at"] < DIRECTORY_TTL_S:
        return {"staff": _DIRECTORY["rows"], "accounts_readable": _DIRECTORY["accounts"]}
    view = shift_requests.estate(dsn)
    by_key: dict[str, dict[str, Any]] = {}
    for loc in view["locations"]:
        short = shift_requests.short_house(loc)
        for n in view["people"].get(loc, []):
            if house_cal_live.not_a_person(n, loc) or n.startswith(shift_requests.CALL_OFF_ROW):
                continue
            entry = by_key.setdefault(fold(n), {"name": n, "houses": []})
            if short not in entry["houses"]:
                entry["houses"].append(short)
    accounts = True
    try:
        with hub_db.intel(dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT coalesce(nullif(entity_name,''), display_name) FROM asa_users "
                        "WHERE active IS NOT FALSE AND role='staff' "
                        "AND (merged_into IS NULL OR merged_into::text = '')")
            for (name,) in cur.fetchall():
                name = str(name or "").strip()
                if name and fold(name):
                    by_key.setdefault(fold(name), {"name": name, "houses": []})
    except Exception as exc:  # noqa: BLE001 — the calendars still answer, and say so
        accounts = False
        log.warning("calendar-builder: staff accounts unreadable (%s)", type(exc).__name__)
    rows = sorted(by_key.values(), key=lambda r: r["name"].lower())
    _DIRECTORY.update(at=now, rows=rows, accounts=accounts)
    return {"staff": rows, "accounts_readable": accounts}


def admits(dsn: str) -> Callable[[str], bool]:
    """Whether a name may be placed on a house it is not yet a row of."""
    keys = {fold(r["name"]) for r in staff_directory(dsn)["staff"]}
    return lambda name: bool(fold(name)) and fold(name) in keys


def location_for_token(dsn: str, token: str) -> str:
    """The house calendar a master-grid token names ('48TH (B)' → 'CAN - 48TH (B) - ABD1711'), or ''."""
    want = str(token or "").strip().upper()
    if not want:
        return ""
    with hub_db.intel(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT location FROM asa_house_calendar_live")
        for (loc,) in cur.fetchall():
            parts = [p.strip() for p in str(loc or "").split(" - ")]
            if len(parts) >= 2 and parts[1].upper() == want:
                return str(loc)
    return ""
