"""House Calendars: cell identity (location, employee, col_iso), meaning (shift_slices.classify) and arithmetic.
This screen no longer edits (Calendar Builder does); published cells are laid over the mirror until it catches…"""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from datetime import date, datetime, timedelta
from typing import Any, Callable
from zoneinfo import ZoneInfo

import effective_roster
import lanes_db as hub_db
import lanes_pg as psycopg2
import shift_slices
from calendar_builder_slices import _skip_staff

# every house is in Ohio; the UTC date flips when night shifts begin
OHIO = ZoneInfo("America/New_York")

# WHO IS NOT A PERSON, decided in one place.

# The claims ledger.
CLAIMS_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_house_calendar_claims ("
    "location TEXT NOT NULL, open_row TEXT NOT NULL, col_iso TEXT NOT NULL, "
    "value TEXT NOT NULL DEFAULT '', claimed_by TEXT NOT NULL, "
    "claimed_via TEXT NOT NULL DEFAULT 'app', "
    "claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "PRIMARY KEY (location, open_row, col_iso))"
)

# The overrides table, exactly as snapshot_service has always declared it.
OVERRIDES_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_house_calendar_overrides ("
    "location TEXT NOT NULL, employee TEXT NOT NULL, col_iso TEXT NOT NULL, "
    "value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "PRIMARY KEY (location, employee, col_iso))"
)

# one row per cell change, with what it said before, in the change's transaction
EDITS_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_house_calendar_edits ("
    "id BIGSERIAL PRIMARY KEY, location TEXT NOT NULL, employee TEXT NOT NULL, "
    "col_iso TEXT NOT NULL, old_value TEXT NOT NULL DEFAULT '', "
    "new_value TEXT NOT NULL DEFAULT '', via TEXT NOT NULL DEFAULT '', "
    "actor TEXT NOT NULL DEFAULT '', at TIMESTAMPTZ NOT NULL DEFAULT now())"
)
# additive Builder columns: stage (draft | published | call_off | test_mode), note, act (one per action), undone_at
EDITS_COLUMNS_DDL = (
    "ALTER TABLE asa_house_calendar_edits ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE asa_house_calendar_edits ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE asa_house_calendar_edits ADD COLUMN IF NOT EXISTS act TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE asa_house_calendar_edits ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ",
    "CREATE INDEX IF NOT EXISTS asa_house_calendar_edits_cell "
    "ON asa_house_calendar_edits (location, employee, col_iso, id)",
    # read every minute by effective_roster.published
    "CREATE INDEX IF NOT EXISTS asa_house_calendar_edits_published "
    "ON asa_house_calendar_edits (col_iso) WHERE stage = 'published'",
    # and the cells test mode held, read beside them while it holds roster writes
    "CREATE INDEX IF NOT EXISTS asa_house_calendar_edits_test_mode "
    "ON asa_house_calendar_edits (location, col_iso) WHERE stage = 'test_mode'",
)
STAGE_DRAFT = "draft"
STAGE_PUBLISHED = "published"
STAGE_CALL_OFF = "call_off"
# a roster write test mode held; the workbook was never sent it
STAGE_TEST_MODE = "test_mode"

# the mirror stamps a pass after its read, so a publish during the read still counts this long past the stamp
PUBLISH_SETTLE_S = int(os.getenv("HUB_HOUSECAL_PUBLISH_SETTLE_S", "180"))


class WorkbookRefused(Exception):
    """The workbook was not written, and why; `blocked` names cells that moved under the change."""

    def __init__(self, why: str, code: str = "workbook",
                 blocked: list[dict[str, Any]] | None = None) -> None:
        super().__init__(why)
        self.why, self.code, self.blocked = why, code, list(blocked or [])

# The estate's overtime line.
WEEKLY_OT_HOURS = 40.0

# Two shifts on one day at one house are not a conflict — a split shift is ordinary.
CONFLICT_SAME_DAY_TWO_HOUSES = "two-houses"
CONFLICT_BACK_TO_BACK = "back-to-back"
CONFLICT_OVER_WEEK = "over-week"


def _connect(dsn: str):
    return hub_db.connect(dsn)


def _as_dict(grid: Any) -> dict[str, Any]:
    """Decode the `grid` column; every grid reader comes through here, so OPEN rows are keyed here."""
    if isinstance(grid, str):
        try:
            return key_rows(dict(json.loads(grid)))
        except Exception:  # noqa: BLE001 — a torn grid is an empty grid, not a 500
            return {}
    return key_rows(dict(grid or {}))


# OPEN, OPEN 2, Open (B) — but a name that merely begins with "Open" is a person
_OPEN_ROW = re.compile(r"^\s*open(?![a-z])", re.IGNORECASE)


def is_open_row(name: Any) -> bool:
    """Is this an OPEN row rather than a person? The one test for every reader."""
    return bool(_OPEN_ROW.match(str(name or "")))


def not_a_person(name: Any, location: Any = "") -> bool:
    """OPEN and WORKSHOP rows; `_skip_staff` plus the numbered OPEN rows."""
    return _skip_staff(str(name or ""), str(location or "")) or is_open_row(name)


def key_rows(grid: dict[str, Any]) -> dict[str, Any]:
    """Give each repeated OPEN row a unique name in sheet order (OPEN, OPEN 2, …), since every key is (row, day)."""
    rows = grid.get("rows")
    if not isinstance(rows, list):
        return grid
    taken = {str((r or {}).get("employee") or "").strip() for r in rows if isinstance(r, dict)}
    seen: set[str] = set()
    out = []
    for r in rows:
        if not isinstance(r, dict):
            out.append(r)
            continue
        name = str(r.get("employee") or "").strip()
        if name and is_open_row(name):
            if name in seen:
                n = 2
                while f"{name} {n}" in taken:
                    n += 1
                fresh = f"{name} {n}"
                taken.add(fresh)
                r = {**r, "employee": fresh, "sheet_name": r.get("sheet_name") or name}
                name = fresh
            seen.add(name)
        out.append(r)
    grid["rows"] = out
    return grid


def house_tokens(dsn: str) -> set[str]:
    """The short codes the estate uses for its own houses, READ OFF the houses."""
    with hub_db.intel(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT location FROM asa_house_calendar_live")
        out: set[str] = set()
        for (loc,) in cur.fetchall():
            parts = [p.strip() for p in str(loc or "").split(" - ")]
            if len(parts) >= 2 and parts[1]:
                out.add(parts[1].upper())
        return out


def col_isos(grid: dict[str, Any]) -> list[str]:
    """The column key for every drawn day, in order."""
    out: list[str] = []
    for i, c in enumerate(grid.get("cols", []) or []):
        out.append(str(c.get("iso") or c.get("date") or i))
    return out


# -------------------------------------------------------------------------- READ — the merged picture…

def pending_publishes(cur, location: str | None = None) -> dict[str, dict[tuple[str, str], str]]:
    """Published cells the mirror has not read back yet (effective_roster.pending_on_mirror)."""
    return effective_roster.pending_on_mirror(cur, location)


def held_publishes(cur, location: str | None = None) -> dict[str, set[tuple[str, str]]]:
    """The pending cells test mode held (effective_roster.held_on_mirror)."""
    return effective_roster.held_on_mirror(cur, location)


def mirror_publishes(cur, location: str | None = None) -> dict[str, dict[str, Any]]:
    """Pending, held and rehearsed cells from one read (effective_roster.on_mirror); a rehearsed one is held and…"""
    return effective_roster.on_mirror(cur, location)


def lay_published(grid: dict[str, Any], isos: list[str],
                  pending: dict[tuple[str, str], str],
                  held: set[tuple[str, str]] | None = None,
                  rehearsed: set[tuple[str, str]] | None = None) -> None:
    """Lay pending published cells onto one grid (new rows at the foot); cells say `pending`, held ones…"""
    rows = grid.setdefault("rows", [])
    by_name = {str(r.get("employee") or ""): r for r in rows if isinstance(r, dict)}
    at = {iso: i for i, iso in enumerate(isos)}
    for (emp, iso), value in sorted(pending.items()):
        i = at.get(iso)
        if i is None:
            continue
        row = by_name.get(emp)
        if row is None:
            if not str(value).strip():
                continue  # emptying a row the mirror never drew shows nothing
            row = {"employee": emp, "cells": [], "open_row": is_open_row(emp),
                   "pending_row": True}
            rows.append(row)
            by_name[emp] = row
        cells = row.setdefault("cells", [])
        while len(cells) < len(isos):
            cells.append({"text": "", "color": "transparent"})
        cell = cells[i] if isinstance(cells[i], dict) else {}
        cell = {k: v for k, v in cell.items() if k != "edited"}
        cell.update({"text": str(value), "pending": True})
        if held and (emp, iso) in held:
            cell["test_mode"] = True
        if rehearsed and (emp, iso) in rehearsed:
            cell[effective_roster.REHEARSAL] = True
        cells[i] = cell


def merged_grid(dsn: str, location: str, *,
                before_compute: Callable[[dict[str, Any]], Any] | None = None
                ) -> dict[str, Any] | None:
    """One house's merged grid (mirror, overrides, pending publishes) and its arithmetic, or None without a…"""
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor() as cur:
        got = hub_db.beside(cur, dsn, "SELECT grid, updated_at FROM asa_house_calendar_live WHERE location=%s",
                            (location,))
        row = got[0] if got else None
        if not row:
            return None
        grid = _as_dict(row[0])
        grid["updated_at"] = str(row[1] or "")
        cur.execute("SELECT employee, col_iso, value FROM asa_house_calendar_overrides "
                    "WHERE location=%s", (location,))
        overrides = list(cur.fetchall())
        cur.execute(CLAIMS_DDL)
        cur.execute("SELECT open_row, col_iso, claimed_by, claimed_via, claimed_at "
                    "FROM asa_house_calendar_claims WHERE location=%s", (location,))
        claims = {f"{row}|{iso}": {"claimed_by": by, "claimed_via": via,
                                   "claimed_at": str(at or "")}
                  for row, iso, by, via, at in cur.fetchall()}
        # one read of the published cells serves all three, on every grid read
        mirror = mirror_publishes(cur, location)
        pending = mirror["pending"].get(location, {})
        held = mirror["held"].get(location, set())
        rehearsed = mirror["rehearsed"].get(location, set())

    isos = col_isos(grid)
    ovmap = {(e, ciso): v for e, ciso, v in overrides}
    for r in grid.get("rows", []) or []:
        emp = str(r.get("employee") or "")
        # the screen is told, so it never re-implements the rule
        r["open_row"] = is_open_row(emp)
        cells = r.get("cells", []) or []
        # pad short rows so every drawn column is addressable
        while len(cells) < len(isos):
            cells.append({"text": "", "color": "transparent"})
        r["cells"] = cells
        for i, cell in enumerate(cells):
            iso = isos[i] if i < len(isos) else str(i)
            if (emp, iso) in ovmap:
                cell["text"] = ovmap[(emp, iso)]
                cell["edited"] = True
    lay_published(grid, isos, pending, held, rehearsed)
    grid["location"] = location
    grid["_claims"] = claims
    if before_compute is not None:
        before_compute(grid)
    grid["computed"] = compute(grid, houses=house_tokens(dsn))
    grid.pop("_claims", None)  # the claims ride inside `computed`, not twice
    return grid


# -------------------------------------------------------------------------- MEANING + ARITHMETIC…

def week_key(iso: str) -> str:
    """The week a day belongs to, keyed by ITS SATURDAY (a Monday maps to the Saturday two days before)."""
    day = day_of(iso)
    if day is None:
        return iso
    return (day - timedelta(days=(day.weekday() + 2) % 7)).isoformat()


def _hours(shift: dict[str, Any] | None) -> float:
    if not shift or shift.get("start") is None or shift.get("end") is None:
        return 0.0
    return round(float(shift["end"]) - float(shift["start"]), 2)


def _names_a_house(token: str | None, houses: set[str]) -> bool:
    """Does this token name one of the estate's own houses?"""
    if not token:
        return False
    if not houses:
        return False
    for part in str(token).replace(">", ";").replace("<", ";").split(";"):
        if part.strip().upper() in houses:
            return True
    return False


def day_of(iso: str) -> date | None:
    """A column key as a calendar day, or None when the column is not a day."""
    try:
        y, m, d = (int(p) for p in str(iso).split("-")[:3])
        return date(y, m, d)
    except Exception:  # noqa: BLE001 — a malformed column has no day
        return None


def starts_at(iso: str, start_hour: Any) -> datetime | None:
    """The Ohio instant a cell's shift begins; an hour past 24 is the next morning."""
    day = day_of(iso)
    if day is None or start_hour is None:
        return None
    try:
        return datetime.combine(day, datetime.min.time(), tzinfo=OHIO) + timedelta(
            hours=float(start_hour))
    except (TypeError, ValueError):
        return None


def ohio_now() -> datetime:
    return datetime.now(OHIO)


def compute(grid: dict[str, Any], houses: set[str] | None = None, *,
            now: datetime | None = None) -> dict[str, Any]:
    """Read every cell through the estate's grammar and total what it means."""
    now = now or ohio_now()
    isos = col_isos(grid)
    rows = grid.get("rows", []) or []

    cells: dict[str, dict[str, Any]] = {}
    per_person: dict[str, dict[str, Any]] = {}
    per_day: dict[str, dict[str, Any]] = {iso: {"working": 0, "off": 0, "elsewhere": 0,
                                                "hours": 0.0, "names": []} for iso in isos}

    location = str(grid.get("location") or "")
    claims: dict[str, dict[str, Any]] = grid.get("_claims") or {}
    open_shifts: list[dict[str, Any]] = []

    for r in rows:
        emp = str(r.get("employee") or "")
        if not emp:
            continue
        # A row named OPEN is not a person — it is the estate's own way of writing "this shift has nobody on it"…
        nobody = not_a_person(emp, location)
        person = None if nobody else per_person.setdefault(emp, {
            "employee": emp, "hours": 0.0, "shifts": 0, "off": 0, "elsewhere": 0,
            "by_week": {}, "conflicts": [],
        })
        for i, cell in enumerate(r.get("cells", []) or []):
            if i >= len(isos):
                break
            iso = isos[i]
            raw = str(cell.get("text") or "")
            shift = shift_slices.classify(raw)
            if not shift:
                continue
            hours = _hours(shift)
            entry = {
                "employee": emp, "col_iso": iso, "raw": raw,
                "kind": str(shift.get("kind") or ""), "code": str(shift.get("code") or ""),
                "start": shift.get("start"), "end": shift.get("end"),
                "token": shift.get("token"), "hours": hours,
                "overnight": bool(shift.get("end") is not None and float(shift["end"]) > 24),
                "edited": bool(cell.get("edited")),
            }
            # before, running or done, on Ohio's clock
            begins = starts_at(iso, entry["start"])
            ends = starts_at(iso, entry["end"])
            if begins is not None and ends is not None:
                entry["starts_at"] = begins.isoformat()
                entry["ends_at"] = ends.isoformat()
                entry["state"] = ("past" if ends <= now
                                  else "in_progress" if begins <= now else "upcoming")
            if cell.get("draft"):
                entry["draft"] = True
            if cell.get("pending"):
                entry["pending"] = True
            cells[f"{emp}|{iso}"] = entry
            kind = entry["kind"]
            if nobody:
                # THE OPEN SHIFTS.
                if is_open_row(emp) and kind not in ("off", "ro", "alias"):
                    claim = claims.get(f"{emp}|{iso}")
                    entry["open"] = True
                    if claim:
                        entry["claimed_by"] = claim.get("claimed_by")
                        entry["claimed_via"] = claim.get("claimed_via")
                        entry["claimed_at"] = claim.get("claimed_at")
                    # a started shift is no longer offered
                    begins = starts_at(iso, entry["start"])
                    shift = {
                        "key": f"{emp}|{iso}", "location": location, "open_row": emp,
                        "col_iso": iso, "raw": raw, "code": entry["code"],
                        "start": entry["start"], "end": entry["end"],
                        "hours": hours, "kind": kind, "overnight": entry["overnight"],
                        "starts_at": begins.isoformat() if begins else "",
                        "started": bool(begins and begins <= now),
                        "claimed_by": (claim or {}).get("claimed_by"),
                        "claimed_via": (claim or {}).get("claimed_via"),
                        "claimed_at": (claim or {}).get("claimed_at"),
                    }
                    # a pool cell carries its own ref; the line's name is not the pool key
                    if cell.get("ref"):
                        shift["ref"] = str(cell["ref"])
                        shift["kind_of_open"] = str(cell.get("kind_of_open") or "")
                        if cell.get("called_off_by"):
                            shift["called_off_by"] = str(cell["called_off_by"])
                    open_shifts.append(shift)
                continue
            assert person is not None
            if kind in ("off", "ro"):
                person["off"] += 1
                per_day[iso]["off"] += 1
            elif kind == "alias":
                # Rostered, but under another house's token: their hours belong to that house's grid, not this one.
                person["elsewhere"] += 1
                per_day[iso]["elsewhere"] += 1
            else:
                person["shifts"] += 1
                person["hours"] = round(person["hours"] + hours, 2)
                wk = week_key(iso)
                person["by_week"][wk] = round(person["by_week"].get(wk, 0.0) + hours, 2)
                per_day[iso]["working"] += 1
                per_day[iso]["hours"] = round(per_day[iso]["hours"] + hours, 2)
                per_day[iso]["names"].append(emp)
                # A cell that carries hours AND another HOUSE's token is a transfer: they work these hours, but…
                if _names_a_house(entry["token"], houses or set()):
                    entry["transfer"] = True

    conflicts = _conflicts(cells, per_person, isos)
    for c in conflicts:
        p = per_person.setdefault(c["employee"], {"employee": c["employee"], "hours": 0.0,
                                                  "shifts": 0, "off": 0, "elsewhere": 0,
                                                  "by_week": {}, "conflicts": []})
        p.setdefault("conflicts", []).append(c["key"])

    open_shifts.sort(key=lambda s: (s["col_iso"], s["open_row"]))
    return {
        "now": now.astimezone(OHIO).isoformat(),
        "running": sorted(k for k, c in cells.items() if c.get("state") == "in_progress"),
        "cells": cells,
        "people": sorted(per_person.values(),
                         key=lambda p: (-float(p.get("hours") or 0), p["employee"])),
        "days": [{"col_iso": iso, **per_day[iso]} for iso in isos],
        "conflicts": conflicts,
        "open_shifts": open_shifts,
        "window": window_of(isos, today=now.astimezone(OHIO).date()),
        "weekly_ot_hours": WEEKLY_OT_HOURS,
        "totals": {
            "hours": round(sum(float(p.get("hours") or 0) for p in per_person.values()), 2),
            "shifts": sum(int(p.get("shifts") or 0) for p in per_person.values()),
            "people": len(per_person),
            "open": sum(1 for s in open_shifts if not s["claimed_by"]),
        },
    }


def window_of(isos: list[str], *, today: date | None = None) -> dict[str, Any]:
    """The days this grid draws and whether Ohio's today is one; some tabs are not kept as rosters."""
    today_iso = (today or ohio_now().date()).isoformat()
    days = sorted(i for i in isos if len(i) == 10 and i[4] == "-")
    if not days:
        return {"first": "", "last": "", "days": 0, "covers_today": False, "today": today_iso}
    return {"first": days[0], "last": days[-1], "days": len(days),
            "covers_today": days[0] <= today_iso <= days[-1], "today": today_iso}


def _conflicts(cells: dict[str, dict[str, Any]], per_person: dict[str, dict[str, Any]],
               isos: list[str]) -> list[dict[str, Any]]:
    """The three the desk can act on, each named where it happened."""
    out: list[dict[str, Any]] = []
    idx = {iso: i for i, iso in enumerate(isos)}

    for key, c in cells.items():
        # A transfer cell names another house on a day this house also rosters them for hours — the person cannot be…
        if c.get("transfer"):
            out.append({"key": key, "employee": c["employee"], "col_iso": c["col_iso"],
                        "kind": CONFLICT_SAME_DAY_TWO_HOUSES,
                        "why": f"hours here and {c['token']} on the same day"})

    # An overnight runs past midnight; a shift the next morning that starts before it ends is the person working…
    for c in list(cells.values()):
        if not c.get("overnight") or c.get("end") is None:
            continue
        i = idx.get(c["col_iso"])
        if i is None or i + 1 >= len(isos):
            continue
        nxt = cells.get(f"{c['employee']}|{isos[i + 1]}")
        if not nxt or nxt.get("start") is None:
            continue
        if float(c["end"]) - 24.0 > float(nxt["start"]):
            out.append({"key": f"{c['employee']}|{isos[i + 1]}", "employee": c["employee"],
                        "col_iso": isos[i + 1], "kind": CONFLICT_BACK_TO_BACK,
                        "why": f"starts before the overnight of {c['col_iso']} ends"})

    for emp, p in per_person.items():
        for wk, hours in (p.get("by_week") or {}).items():
            if hours > WEEKLY_OT_HOURS:
                out.append({"key": f"{emp}|{wk}", "employee": emp, "col_iso": "",
                            "kind": CONFLICT_OVER_WEEK, "why": f"{hours:g} h in {wk}"})
    return out


# what a change may do — asked by the Builder of its draft picture

class Occupied(ValueError):
    """A plain drop onto a filled cell; carries what is there."""

    def __init__(self, employee: str, col_iso: str, value: str) -> None:
        super().__init__(
            f"{employee} already has {value.strip() or 'something'} on {col_iso} — say "
            f"replace to put the dragged shift there instead, or hold Shift to swap the two")
        self.employee, self.col_iso, self.value = employee, col_iso, value


class OpenShiftCell(ValueError):
    """An OPEN row's shift, which only an assignment may take off the calendar."""


# writes to one house are serialised per transaction (check-then-write is two steps)
HOUSE_LOCK_NS = 8214


def _lock_house(cur, location: str) -> None:
    key = int(hashlib.sha1(str(location).encode()).hexdigest()[:8], 16) % (2 ** 31)
    cur.execute("SELECT pg_advisory_xact_lock(%s,%s)", (HOUSE_LOCK_NS, key))


def lock_house(cur, location: str) -> None:
    """The house's lock, for another lane's transaction on the same house."""
    _lock_house(cur, location)


def overrides_of(cur, location: str) -> dict[tuple[str, str], str]:
    """{(employee, col_iso): value} for one house, from either kind of cursor."""
    cur.execute("SELECT employee, col_iso, value FROM asa_house_calendar_overrides "
                "WHERE location=%s", (location,))
    ov: dict[tuple[str, str], str] = {}
    for got in cur.fetchall():
        e, i, v = (got["employee"], got["col_iso"], got["value"]) if isinstance(got, dict) else got
        ov[(e, i)] = v
    return ov


def layers_of(cur, location: str) -> tuple[dict[tuple[str, str], str], dict[tuple[str, str], str]]:
    """(overrides, pending publishes) — the two layers laid over the mirror, in that order."""
    return overrides_of(cur, location), pending_publishes(cur, location).get(location, {})


_TABLES_READY: set[str] = set()
_TABLES_LOCK = threading.Lock()


def ensure_tables(dsn: str) -> None:
    """The overrides and edits tables, once per process per database, behind a lock on their own connection…"""
    if dsn in _TABLES_READY:
        return
    with _TABLES_LOCK:
        if dsn in _TABLES_READY:
            return
        conn = _connect(dsn)
        try:
            conn.autocommit = True
            with conn.cursor() as cur:
                for ddl in (OVERRIDES_DDL, EDITS_DDL, *EDITS_COLUMNS_DDL):
                    try:
                        cur.execute(ddl)
                    except psycopg2.Error:
                        pass
        finally:
            conn.close()
        _TABLES_READY.add(dsn)


def _load(cur, location: str, dsn: str) -> tuple[dict[str, Any], list[str],
                                                 dict[tuple[str, str], str],
                                                 dict[tuple[str, str], str]]:
    """The house's grid, columns, overrides and pending publishes, under the caller's lock."""
    ensure_tables(dsn)
    _lock_house(cur, location)
    got = hub_db.beside(cur, dsn, "SELECT grid FROM asa_house_calendar_live WHERE location=%s", (location,))
    row = got[0] if got else None
    if not row:
        raise LookupError("no calendar for that house")
    grid = _as_dict(row.get("grid") if isinstance(row, dict) else row[0])
    ov, pend = layers_of(cur, location)
    return grid, col_isos(grid), ov, pend


def _base_text(grid: dict[str, Any], isos: list[str], emp: str, iso: str) -> str:
    """What the mirrored workbook says in that cell, with nothing laid on it."""
    for r in grid.get("rows") or []:
        if str(r.get("employee") or "") != emp:
            continue
        cells = r.get("cells") or []
        for i, key in enumerate(isos):
            if key == iso and i < len(cells):
                return str((cells[i] or {}).get("text") or "")
        return ""
    return ""


def workbook_text(grid: dict[str, Any], isos: list[str], pending: dict, emp: str,
                  iso: str) -> str:
    """What the workbook says in that cell as far as the platform knows — the base, never an override."""
    if (emp, iso) in pending:
        return str(pending[(emp, iso)])
    return _base_text(grid, isos, emp, iso)


def _cell_text(grid: dict[str, Any], isos: list[str], ov: dict, emp: str, iso: str,
               pending: dict | None = None) -> str:
    """What that cell says now: pending publish, else override, else mirror (rows by `key_rows` name)."""
    if pending and (emp, iso) in pending:
        return str(pending[(emp, iso)])
    if (emp, iso) in ov:
        return str(ov[(emp, iso)])
    return _base_text(grid, isos, emp, iso)


def check_cell(isos: list[str], people: set[str], employee: str, col_iso: str,
               published: str) -> None:
    """May a value land on this cell? Raises the reason: undrawn day, person not admitted, or a published OPEN shift."""
    if col_iso not in isos:
        raise ValueError(f"{col_iso} is not a column of this calendar")
    if employee not in people:
        raise ValueError(f"{employee} is not on this calendar")
    if is_open_row(employee) and str(published or "").strip():
        raise OpenShiftCell(
            "this is an open shift — it is not typed over or cleared; it leaves the calendar "
            "only when somebody is assigned to it")


def check_ends(src_employee: str, dst_employee: str) -> None:
    if is_open_row(src_employee) or is_open_row(dst_employee):
        raise OpenShiftCell("an open shift is assigned from its panel — it is never dragged, "
                            "and nothing is dropped on it")


def check_move(isos: list[str], people: set[str], text_of: Callable[[str, str], str],
               src_employee: str, src_iso: str, dst_employee: str, dst_iso: str, *,
               swap: bool, replace: bool) -> tuple[str, str, bool]:
    """(moving, landing, replacing) on `text_of`'s picture, or the refusal; a filled target needs `replace` or `swap`."""
    check_ends(src_employee, dst_employee)
    for iso in (src_iso, dst_iso):
        if iso not in isos:
            raise ValueError(f"{iso} is not a column of this calendar")
    for emp in (src_employee, dst_employee):
        if emp not in people:
            raise ValueError(f"{emp} is not on this calendar")
    moving = text_of(src_employee, src_iso)
    landing = text_of(dst_employee, dst_iso)
    if not moving.strip():
        # Moving nothing onto a cell is clearing it by another name.
        raise ValueError("there is no shift in that cell to move")
    replacing = bool(landing.strip()) and not swap
    if replacing and not replace:
        raise Occupied(dst_employee, dst_iso, landing)
    return moving, landing, replacing


def free_for_a_shift(text: str) -> bool:
    """May a shift be written into a cell that says this? Only empty or OFF."""
    t = str(text or "").strip()
    return not t or (shift_slices.classify(t) or {}).get("kind") == "off"


# call-off marks, overwritten only when the caller is given that shift back
TAKEN_BACK_MARKS = frozenset({"C/O", "NCNS"})


def _fold(name: Any) -> str:
    """The platform's name key (shift_requests.fold), without importing it."""
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())


# -------------------------------------------------------------------------- THE CLAIM — first one through, and the…

class AlreadyTaken(Exception):
    """Somebody got there first. Carries who, so the loser hears a fact."""

    def __init__(self, by: str, at: str, via: str) -> None:
        super().__init__(f"already taken by {by}")
        self.by, self.at, self.via = by, at, via


def open_shifts(dsn: str, *,
                before_compute: Callable[[dict[str, Any]], Any] | None = None
                ) -> list[dict[str, Any]]:
    """Every open shift in the estate, newest day first, in one read; `before_compute` as in `merged_grid`."""
    out: list[dict[str, Any]] = []
    tokens = house_tokens(dsn)
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor() as cur:
        rows = hub_db.beside(cur, dsn, "SELECT location, grid FROM asa_house_calendar_live ORDER BY location")
        cur.execute(CLAIMS_DDL)
        cur.execute("SELECT location, open_row, col_iso, claimed_by, claimed_via, claimed_at "
                    "FROM asa_house_calendar_claims")
        claims: dict[str, dict[str, Any]] = {}
        for loc, orow, iso, by, via, at in cur.fetchall():
            claims.setdefault(loc, {})[f"{orow}|{iso}"] = {
                "claimed_by": by, "claimed_via": via, "claimed_at": str(at or "")}
        cur.execute("SELECT location, employee, col_iso, value FROM asa_house_calendar_overrides")
        ov: dict[str, dict[tuple[str, str], str]] = {}
        for loc, emp, iso, val in cur.fetchall():
            ov.setdefault(loc, {})[(emp, iso)] = val
        mirror = mirror_publishes(cur)

    for loc, raw_grid in rows:
        grid = _as_dict(raw_grid)
        grid["location"] = loc
        isos = col_isos(grid)
        for r in grid.get("rows", []) or []:
            emp = str(r.get("employee") or "")
            cells = r.get("cells", []) or []
            for i in range(len(isos)):
                cell = cells[i] if i < len(cells) else {}
                key = (emp, isos[i])
                if key in ov.get(loc, {}):
                    cell = {**cell, "text": ov[loc][key], "edited": True}
                    if i < len(cells):
                        cells[i] = cell
                    else:
                        cells.append(cell)
        # A cell the rehearsal played is nobody's shift and is never published, so the estate's open shifts are…
        played = mirror["rehearsed"].get(loc, set())
        lay_published(grid, isos,
                      {k: v for k, v in mirror["pending"].get(loc, {}).items() if k not in played},
                      mirror["held"].get(loc, set()))
        grid["_claims"] = claims.get(loc, {})
        if before_compute is not None:
            before_compute(grid)
        for s in compute(grid, houses=tokens).get("open_shifts", []):
            out.append(s)
    out.sort(key=lambda s: (s["col_iso"], s["location"], s["open_row"]))
    return out


def claim_open_shift(dsn: str, location: str, open_row: str, col_iso: str,
                     claimed_by: str, *, via: str = "app",
                     assign_to_row: bool = True,
                     clear_open_row: bool = False,
                     value: str | None = None,
                     publish: Callable[[str, list[dict[str, Any]]], dict[str, Any]] | None = None
                     ) -> dict[str, Any]:
    """Take an open shift; the claims ledger's primary key makes the first INSERT win."""
    if not claimed_by.strip():
        raise ValueError("a claim needs a name")
    name = claimed_by.strip()

    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(CLAIMS_DDL)
        grid, isos, ov, pend = _load(cur, location, dsn)
        if col_iso not in isos:
            raise ValueError(f"{col_iso} is not a column of this calendar")
        held = _cell_text(grid, isos, ov, open_row, col_iso, pend)
        value = held if value is None else str(value)
        if not value.strip():
            raise LookupError("that open shift is no longer on the calendar")
        existing = _cell_text(grid, isos, ov, name, col_iso, pend) if assign_to_row else ""
        taking_back = _fold(name) == _fold(open_row) \
            and existing.strip().upper() in TAKEN_BACK_MARKS
        writable = free_for_a_shift(existing) or taking_back
        if assign_to_row and publish is not None and not writable \
                and existing.strip() != value.strip():
            raise WorkbookRefused(
                f"{name}'s own cell on {col_iso} already says {existing.strip()}, and a calendar "
                f"cell holds one shift — so the {value.strip()} shift was not given (it would "
                f"have been on no calendar and in no reminder). Change that cell in Calendar "
                f"Builder first, or give the shift to somebody else", "row_holds")

        cur.execute(
            "INSERT INTO asa_house_calendar_claims "
            "(location, open_row, col_iso, value, claimed_by, claimed_via) "
            "VALUES (%s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (location, open_row, col_iso) DO NOTHING "
            "RETURNING claimed_at",
            (location, open_row, col_iso, value, name, via))
        won = cur.fetchone()
        if not won:
            cur.execute("SELECT claimed_by, claimed_at, claimed_via FROM asa_house_calendar_claims "
                        "WHERE location=%s AND open_row=%s AND col_iso=%s",
                        (location, open_row, col_iso))
            other = cur.fetchone() or ("somebody", "", "")
            conn.rollback()
            raise AlreadyTaken(str(other[0]), str(other[1] or ""), str(other[2] or ""))

        cells: list[dict[str, Any]] = []
        kept = ""
        if assign_to_row:
            if writable:
                cells.append({"employee": name, "col_iso": col_iso, "value": value,
                              "base": workbook_text(grid, isos, pend, name, col_iso)})
            elif existing.strip() != value.strip():
                kept = existing
        if clear_open_row and open_row.strip() != name \
                and held.strip() and held.strip() == value.strip():
            cells.append({"employee": open_row, "col_iso": col_iso, "value": "",
                          "base": workbook_text(grid, isos, pend, open_row, col_iso)})
        wrote: dict[str, Any] = {}
        if cells and publish is not None:
            # raises WorkbookRefused: the `with` rolls the claim back with it
            wrote = publish(location, cells)
        conn.commit()

    landed = publish is not None
    return {"claimed": True, "location": location, "open_row": open_row,
            "col_iso": col_iso, "value": value, "claimed_by": name,
            "claimed_via": via,
            "assigned_to_row": landed and any(c["employee"] == name for c in cells),
            "open_row_cleared": landed and any(c["employee"] == open_row for c in cells),
            "row_kept": kept,
            "published": {k: wrote.get(k) for k in ("written", "rows_added", "already",
                                                    "test_mode")
                          if k in wrote}}


def release_claim(dsn: str, location: str, open_row: str, col_iso: str) -> bool:
    """Undo a claim; the shift on the claimer's row is left for the house manager to remove in the Builder."""
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(CLAIMS_DDL)
        cur.execute("DELETE FROM asa_house_calendar_claims "
                    "WHERE location=%s AND open_row=%s AND col_iso=%s",
                    (location, open_row, col_iso))
        gone = cur.rowcount > 0
        conn.commit()
    return gone
