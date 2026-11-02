"""Published calendar cells laid over every shift reader's copy of public.asa_schedules."""
from __future__ import annotations

import contextlib
import logging
import os
import re
import threading
from datetime import date, datetime, timezone
from typing import Any, Callable, Iterable, Iterator

import hub_db

log = logging.getLogger("hub.effective_roster")

# the old platform's database, where the house calendars' live copy is; the edit trail is the relay's own
INTEL_DSN = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL", "")

SCHEDULES = "public.asa_schedules"
SCHEDULE_TAB = "CALENDAR"

STATE_PENDING = "pending"
STATE_CONFIRMED = "confirmed"
STATE_CHANGED = "changed"
STATE_UNDRAWN = "undrawn"
# changed while test mode held roster writes; never written to the workbook
STATE_TEST_MODE = "test_mode"

# spelled here, not imported: house_cal_live imports this file
_PUBLISHED = "published"
_TEST_MODE = "test_mode"
_SETTLE_DEFAULT_S = 180


def _settle_s() -> int:
    try:
        import house_cal_live  # noqa: PLC0415
        return int(house_cal_live.PUBLISH_SETTLE_S)
    except Exception:  # noqa: BLE001
        return _SETTLE_DEFAULT_S


# test mode holds roster writes; a switch never handed in, or unreadable, holds too
_SWITCH: dict[str, Any] = {"fn": None}


def use_switch(fn: Callable[[], dict[str, Any]] | None) -> None:
    _SWITCH["fn"] = fn


def test_mode() -> dict[str, Any]:
    fn = _SWITCH.get("fn")
    if fn is None:
        return {"on": True, "readable": False, "word": "unreadable",
                "why": "no switch was handed to this process"}
    try:
        got = fn()
    except Exception as exc:  # noqa: BLE001
        return {"on": True, "readable": False, "word": "unreadable",
                "why": f"the switch could not be read ({type(exc).__name__})"}
    if not isinstance(got, dict) or got.get("on") is not False:
        return {"on": True, "readable": bool(isinstance(got, dict) and got.get("readable")),
                "word": str((got or {}).get("word") or "on") if isinstance(got, dict) else "unreadable",
                "why": str((got or {}).get("why") or "") if isinstance(got, dict) else "no answer"}
    return {"on": False, "readable": True, "word": str(got.get("word") or "off"), "why": ""}


def test_mode_said() -> dict[str, Any]:
    """The switch as a read door tells a screen: on, readable and why; an unreadable switch holds."""
    switch = test_mode()
    return {"on": bool(switch.get("on")), "readable": bool(switch.get("readable")),
            "why": str(switch.get("why") or "")}


def fold(name: Any) -> str:
    return " ".join(str(name or "").lower().split())


def house_code(location: Any) -> str:
    text = str(location or "").strip()
    return text.split(" - ")[-1].strip() if text else ""


def _day(v: Any) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v or "")[:10])
    except ValueError:
        return None


def _dict_cursor(cur):
    import psycopg2.extras  # noqa: PLC0415
    return cur.connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor)


def _pooled(cur) -> bool:
    return isinstance(getattr(cur, "connection", None), hub_db._Conn)  # noqa: SLF001 - the pool's own class


@contextlib.contextmanager
def _edits(cur) -> Iterator[Any]:
    """A dict cursor where the edit trail is: `cur` itself unless it moved to asa-hub-db and `cur` is not there."""
    if not hub_db.on() or _pooled(cur):
        with _dict_cursor(cur) as dc:
            yield dc
        return
    import psycopg2.extras  # noqa: PLC0415
    with hub_db.connect(INTEL_DSN) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as dc:
        yield dc


@contextlib.contextmanager
def _live(cur) -> Iterator[Any]:
    """A dict cursor on the old platform's database, where the house calendars' live copy is."""
    if not _pooled(cur):
        with _dict_cursor(cur) as dc:
            yield dc
        return
    import psycopg2.extras  # noqa: PLC0415
    conn = hub_db.intel(INTEL_DSN)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as dc:
            yield dc
    finally:
        conn.close()


def ready(cur) -> bool:
    """Missing tables answer False; only an unaskable database raises."""
    with _edits(cur) as dc:
        dc.execute(
            "SELECT to_regclass('asa_house_calendar_edits') IS NOT NULL "
            "AND EXISTS (SELECT 1 FROM pg_attribute "
            "WHERE attrelid = to_regclass('asa_house_calendar_edits') "
            "AND attname = 'stage' AND NOT attisdropped) AS ok")
        got = dc.fetchone()
    if not (got and got["ok"]):
        return False
    with _live(cur) as dc:
        dc.execute("SELECT to_regclass('asa_house_calendar_live') IS NOT NULL AS ok")
        got = dc.fetchone()
    return bool(got and got["ok"])


# THE MARK on a calendar cell: the writer's via, which every reader above already carries.
REHEARSAL = "rehearsal"
REHEARSAL_VIA = f"{REHEARSAL}:"


def published(cur, day_from: date | None = None, day_to: date | None = None, *,
              location: str | None = None,
              held: bool | None = None) -> list[dict[str, Any]]:
    """Pending = newer than the mirror's stamp less the settle time; while `held`, test mode's cells too."""
    if not ready(cur):
        return []
    held = bool(test_mode().get("on")) if held is None else bool(held)
    # the live copy's stamps, read where it is, joined to the edit trail where that is
    with _live(cur) as dc:
        dc.execute("SELECT location, updated_at FROM asa_house_calendar_live"
                   + (" WHERE location = %s" if location is not None else ""),
                   (location,) if location is not None else None)
        stamps = dc.fetchall()
    if not stamps:
        return []
    # the mark is weighed on the newest write of each cell only, after DISTINCT ON has chosen it
    sql = ("SELECT p.*, CASE WHEN p.stage = %s THEN EXISTS (SELECT 1 "
           "FROM asa_house_calendar_edits r WHERE r.location = p.location "
           "AND r.employee = p.employee AND r.col_iso = p.col_iso AND r.stage = %s "
           "AND r.undone_at IS NULL AND r.via LIKE %s AND NOT EXISTS (SELECT 1 "
           "FROM asa_house_calendar_edits q WHERE q.location = r.location "
           "AND q.employee = r.employee AND q.col_iso = r.col_iso AND q.stage = %s "
           "AND q.id > r.id)) ELSE FALSE END AS rehearsed FROM ("
           "SELECT DISTINCT ON (e.location, e.employee, e.col_iso) "
           "e.id, e.location, e.employee, e.col_iso, e.new_value, e.at, e.actor, e.via, "
           "e.stage, l.updated_at AS mirror_at, "
           "(e.stage = %s OR e.at > l.updated_at - make_interval(secs => %s)) AS pending "
           "FROM asa_house_calendar_edits e "
           "JOIN unnest(%s::text[], %s::timestamptz[]) AS l(location, updated_at) ON l.location = e.location "
           "WHERE (e.stage = %s OR (%s AND e.stage = %s AND e.undone_at IS NULL))")
    args: list[Any] = [_TEST_MODE, _TEST_MODE, f"{REHEARSAL_VIA}%", _PUBLISHED,
                       _TEST_MODE, _settle_s(), [str(s["location"]) for s in stamps],
                       [s["updated_at"] for s in stamps], _PUBLISHED, bool(held), _TEST_MODE]
    if day_from is not None:
        sql += " AND e.col_iso >= %s"
        args.append(day_from.isoformat())
    if day_to is not None:
        sql += " AND e.col_iso <= %s"
        args.append(day_to.isoformat())
    if location is not None:
        sql += " AND e.location = %s"
        args.append(location)
    sql += (" ORDER BY e.location, e.employee, e.col_iso, e.id DESC) p "
            "ORDER BY p.location, p.employee, p.col_iso")
    with _edits(cur) as dc:
        dc.execute(sql, tuple(args))
        got = dc.fetchall()
    return [{"id": int(r["id"]), "location": str(r["location"]),
             "employee": str(r["employee"]), "col_iso": str(r["col_iso"]),
             "value": str(r["new_value"] or "").strip(), "at": r["at"],
             "actor": str(r["actor"] or ""), "via": str(r["via"] or ""),
             "mirror_at": r["mirror_at"], "pending": bool(r["pending"]),
             "test_mode": str(r.get("stage") or "") == _TEST_MODE,
             REHEARSAL: bool(r.get("rehearsed"))} for r in got]


def on_mirror(cur, location: str | None = None) -> dict[str, dict[str, Any]]:
    """The pending, held and rehearsed cells per house, from ONE read of published()."""
    pending: dict[str, dict[tuple[str, str], str]] = {}
    held: dict[str, set[tuple[str, str]]] = {}
    played: dict[str, set[tuple[str, str]]] = {}
    for c in published(cur, location=location):
        key = (c["employee"], c["col_iso"])
        if c["pending"]:
            pending.setdefault(c["location"], {})[key] = c["value"]
        if c["test_mode"]:
            held.setdefault(c["location"], set()).add(key)
            if c[REHEARSAL]:
                played.setdefault(c["location"], set()).add(key)
    return {"pending": pending, "held": held, "rehearsed": played}


def pending_on_mirror(cur, location: str | None = None) -> dict[str, dict[tuple[str, str], str]]:
    return on_mirror(cur, location)["pending"]


def held_on_mirror(cur, location: str | None = None) -> dict[str, set[tuple[str, str]]]:
    return on_mirror(cur, location)["held"]


def rehearsed_on_mirror(cur, location: str | None = None) -> dict[str, set[tuple[str, str]]]:
    """Held cells the staff-answers rehearsal wrote — so a real grid says which squares are played."""
    return on_mirror(cur, location)["rehearsed"]


def _mirror_cells(cur, locations: Iterable[str]) -> dict[str, tuple[set[str], dict[tuple[str, str], str]]]:
    import house_cal_live  # noqa: PLC0415
    wanted = sorted(set(locations))
    if not wanted:
        return {}
    with _live(cur) as dc:
        dc.execute("SELECT location, grid FROM asa_house_calendar_live WHERE location = ANY(%s)",
                   (wanted,))
        got = dc.fetchall()
    out: dict[str, tuple[set[str], dict[tuple[str, str], str]]] = {}
    for r in got:
        grid = house_cal_live._as_dict(r["grid"])
        isos = house_cal_live.col_isos(grid)
        cells: dict[tuple[str, str], str] = {}
        for row in grid.get("rows", []) or []:
            if not isinstance(row, dict):
                continue
            emp = str(row.get("employee") or "").strip()
            for i, cell in enumerate(row.get("cells", []) or []):
                if i < len(isos) and isinstance(cell, dict):
                    cells[(emp, isos[i])] = str(cell.get("text") or "").strip()
        out[str(r["location"])] = (set(isos), cells)
    return out


def effective_cells(cur, day_from: date, day_to: date) -> list[dict[str, Any]]:
    import house_cal_live  # noqa: PLC0415
    rows = published(cur, day_from, day_to)
    if not rows:
        return []
    mirror = _mirror_cells(cur, {r["location"] for r in rows if not r["pending"]})
    out: list[dict[str, Any]] = []
    for r in rows:
        if house_cal_live.not_a_person(r["employee"], r["location"]):
            continue
        day = _day(r["col_iso"])
        code = house_code(r["location"])
        if day is None or not code:
            continue
        if r["test_mode"]:
            value, state = r["value"], STATE_TEST_MODE
        elif r["pending"]:
            value, state = r["value"], STATE_PENDING
        else:
            drawn, cells = mirror.get(r["location"], (set(), {}))
            if r["col_iso"] not in drawn:
                value, state = r["value"], STATE_UNDRAWN
            else:
                value = cells.get((r["employee"], r["col_iso"]), "")
                state = STATE_CONFIRMED if value == r["value"] else STATE_CHANGED
        out.append({"location": r["location"], "house": code, "employee": r["employee"],
                    "day": day, "value": value, "published_value": r["value"],
                    "state": state, "at": r["at"], "actor": r["actor"], "via": r["via"],
                    "id": r["id"]})
    return out


Key = tuple[str, str, date]


def row_key(row: Any) -> Key:
    return (str(row.get("house") or "").strip().upper(), fold(row.get("staff_name")),
            _day(row.get("shift_date")))


def cell_key(cell: dict[str, Any]) -> Key:
    return (str(cell["house"]).strip().upper(), fold(cell["employee"]), cell["day"])


def decide(cells: Iterable[dict[str, Any]],
           newest: dict[Key, tuple[Any, str]]) -> dict[Key, dict[str, Any]]:
    """Every published cell is laid unless the copy said something else since."""
    laid: dict[Key, dict[str, Any]] = {}
    for c in cells:
        k = cell_key(c)
        seen = newest.get(k)
        if seen is not None:
            at, text = seen
            if at is not None and c.get("at") is not None and at >= c["at"] \
                    and str(text or "").strip() != c["value"]:
                continue
        held = laid.get(k)
        if held is None or int(c.get("id") or 0) > int(held.get("id") or 0):
            laid[k] = c
    return laid


def _mark(cell: dict[str, Any]) -> dict[str, Any]:
    at = cell.get("at")
    return {"at": at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            if isinstance(at, datetime) else str(at or ""),
            "by": str(cell.get("actor") or ""), "via": str(cell.get("via") or ""),
            "state": str(cell.get("state") or ""), "location": str(cell.get("location") or "")}


def cell_marks(cells: Iterable[dict[str, Any]],
               shown: dict[tuple[str, str], str]) -> dict[tuple[str, str], dict[str, Any]]:
    """{(employee, col_iso): mark} for one house's published cells, judged against what its grid draws."""
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for c in cells:
        key = (str(c.get("employee") or ""), str(c.get("col_iso") or ""))
        if key not in shown:
            continue
        if c.get("test_mode"):
            state = STATE_TEST_MODE
        elif c.get("pending"):
            state = STATE_PENDING
        elif str(shown[key]).strip() == str(c.get("value") or "").strip():
            state = STATE_CONFIRMED
        else:
            state = STATE_CHANGED
        out[key] = _mark({**c, "state": state})
    return out


def lay_marks(grid: dict[str, Any], isos: list[str], cells: Iterable[dict[str, Any]]) -> int:
    """Lay each published cell's mark on the grid cell it names; a draft, the call-off line and an undrawn day get none."""
    shown: dict[tuple[str, str], str] = {}
    where: dict[tuple[str, str], dict[str, Any]] = {}
    for row in grid.get("rows") or []:
        if not isinstance(row, dict) or row.get("call_off_row"):
            continue
        emp = str(row.get("employee") or "")
        drawn = row.get("cells") or []
        for i, iso in enumerate(isos):
            cell = drawn[i] if i < len(drawn) else None
            if isinstance(cell, dict) and not cell.get("draft"):
                shown[(emp, iso)] = str(cell.get("text") or "")
                where[(emp, iso)] = cell
    marks = cell_marks(cells, shown)
    for key, mark in marks.items():
        where[key]["published"] = mark
    return len(marks)


def synthetic(cell: dict[str, Any], facts: dict[tuple[str, str], dict[str, Any]] | None = None,
              template: Any = None) -> dict[str, Any]:
    k = cell_key(cell)
    fact = (facts or {}).get((k[0], k[1])) or {}
    def pick(name: str, default: Any = "") -> Any:
        if template is not None and isinstance(template, dict) and template.get(name):
            return template[name]
        return fact.get(name) or default
    return {"id": f"pub-{cell.get('id')}", "source_id": pick("source_id", "platform:publish"),
            "house": pick("house", cell["house"]), "staff_name": pick("staff_name", cell["employee"]),
            "phone": pick("phone", ""), "shift_date": cell["day"], "shift_raw": cell["value"],
            "shift_start": "", "shift_end": "", "location_code": "", "tab_name": SCHEDULE_TAB,
            "updated_at": cell.get("at"), "published": _mark(cell)}


def lay_rows(rows: list, laid: dict[Key, dict[str, Any]], *, keep_empty: bool = False,
             facts: dict[tuple[str, str], dict[str, Any]] | None = None) -> list:
    """With nothing laid, the same list object is returned."""
    if not laid:
        return rows
    out: list = []
    emitted: set[Key] = set()
    for r in rows:
        k = row_key(r)
        cell = laid.get(k)
        if cell is None:
            out.append(r)
            continue
        if k in emitted:
            continue
        emitted.add(k)
        if cell["value"] or keep_empty:
            out.append(synthetic(cell, facts, template=r))
    for k, cell in laid.items():
        if k not in emitted and (cell["value"] or keep_empty):
            out.append(synthetic(cell, facts))
    return out


def _copies(cur, table: str, keys: Iterable[Key]
            ) -> tuple[dict[Key, tuple[Any, str]], dict[tuple[str, str], dict[str, Any]]]:
    keys = list(keys)
    houses = sorted({k[0] for k in keys})
    people = sorted({k[1] for k in keys})
    newest: dict[Key, tuple[Any, str]] = {}
    facts: dict[tuple[str, str], dict[str, Any]] = {}
    if not houses or not people:
        return newest, facts
    with _live(cur) as dc:
        dc.execute(
            f"SELECT house, staff_name, phone, source_id, shift_date, shift_raw, updated_at "  # noqa: S608
            f"FROM {table} WHERE tab_name = %s AND upper(btrim(house)) = ANY(%s) "
            "AND btrim(lower(regexp_replace(staff_name, '\\s+', ' ', 'g'))) = ANY(%s) "
            "ORDER BY updated_at NULLS FIRST, id",
            (SCHEDULE_TAB, houses, people))
        got = dc.fetchall()
    wanted = set(keys)
    pairs = {(w[0], w[1]) for w in wanted}
    for r in got:
        k = row_key(r)
        if (k[0], k[1]) not in pairs:
            continue
        facts[(k[0], k[1])] = {"staff_name": str(r["staff_name"] or "").strip(),
                               "phone": str(r["phone"] or ""), "source_id": r["source_id"],
                               "house": str(r["house"] or "").strip()}
        if k in wanted:
            newest[k] = (r["updated_at"], str(r["shift_raw"] or ""))
    return newest, facts


def lay(cur, rows: list, day_from: Any, day_to: Any, *, table: str | None = None,
        keep_empty: bool = False) -> list:
    lo, hi = _day(day_from), _day(day_to)
    if lo is None or hi is None:
        return rows
    cells = effective_cells(cur, lo, hi)
    if not cells:
        return rows
    newest, facts = _copies(cur, table or SCHEDULES, [cell_key(c) for c in cells])
    return lay_rows(rows, decide(cells, newest), keep_empty=keep_empty, facts=facts)


# the lens: comm_when.py's roster reads get published cells laid; every other statement passes through
_ROSTER_READ = re.compile(r"\bFROM\s+((?:public\.)?asa_schedules)\b", re.IGNORECASE)
_BETWEEN = re.compile(r"\bshift_date\s+BETWEEN\s+%s\s+AND\s+%s", re.IGNORECASE)


def roster_read(sql: Any, args: Any) -> tuple[str, Any, Any] | None:
    text = str(sql or "")
    table = _ROSTER_READ.search(text)
    between = _BETWEEN.search(text)
    if not table or not between or "shift_raw" not in text or not isinstance(args, (list, tuple)):
        return None
    at = text[:between.start()].count("%s")
    if at + 1 >= len(args):
        return None
    return table.group(1), args[at], args[at + 1]


class _LensCursor:
    def __init__(self, cur: Any) -> None:
        self._cur = cur
        self._read: tuple[str, Any, Any] | None = None

    def __getattr__(self, name: str) -> Any:
        return getattr(self._cur, name)

    def __enter__(self) -> "_LensCursor":
        self._cur.__enter__()
        return self

    def __exit__(self, *exc: Any) -> Any:
        return self._cur.__exit__(*exc)

    def __iter__(self):
        return iter(self.fetchall())

    def execute(self, sql: Any, args: Any = None) -> Any:
        self._read = roster_read(sql, args)
        return self._cur.execute(sql, args)

    def fetchall(self) -> list:
        rows = self._cur.fetchall()
        if self._read is not None:
            table, lo, hi = self._read
            self._read = None
            return lay(self._cur, list(rows), lo, hi, table=table)
        return rows


class _LensConnection:
    def __init__(self, conn: Any) -> None:
        self._conn = conn

    def __getattr__(self, name: str) -> Any:
        return getattr(self._conn, name)

    def __enter__(self) -> "_LensConnection":
        self._conn.__enter__()
        return self

    def __exit__(self, *exc: Any) -> Any:
        return self._conn.__exit__(*exc)

    def cursor(self, *a: Any, **k: Any) -> _LensCursor:
        return _LensCursor(self._conn.cursor(*a, **k))


class _LensDriver:
    def __init__(self, real: Any) -> None:
        self._real = real

    def __getattr__(self, name: str) -> Any:
        return getattr(self._real, name)

    def connect(self, *a: Any, **k: Any) -> _LensConnection:
        return _LensConnection(self._real.connect(*a, **k))


def lens(module: Any) -> Any:
    real = getattr(module, "psycopg2", None)
    if real is not None and not isinstance(real, _LensDriver):
        module.psycopg2 = _LensDriver(real)
    return module


_LISTENERS: list[Callable[[dict[str, Any]], None]] = []
_LISTENERS_LOCK = threading.Lock()


def on_change(fn: Callable[[dict[str, Any]], None]) -> None:
    with _LISTENERS_LOCK:
        if fn not in _LISTENERS:
            _LISTENERS.append(fn)


def announce(location: str, cells: Iterable[dict[str, Any]], *, via: str = "",
             actor: str = "") -> int:
    changed = [{"employee": str(c.get("employee") or ""), "col_iso": str(c.get("col_iso") or ""),
                "value": str(c.get("value") or "")} for c in cells]
    if not changed:
        return 0
    event = {"location": location, "house": house_code(location), "cells": changed,
             "via": via, "actor": actor,
             "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    with _LISTENERS_LOCK:
        listeners = list(_LISTENERS)
    heard = 0
    for fn in listeners:
        try:
            fn(event)
            heard += 1
        except Exception as exc:  # noqa: BLE001
            log.warning("effective roster: a reader could not be told of %d published cell(s) "
                        "at %s (%s: %s)", len(changed), location, type(exc).__name__,
                        str(exc)[:160])
    return heard
