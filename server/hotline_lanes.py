"""The Hotline screen's three sheet lanes read live (read-only), plus a watch on the sweep's processing log."""
from __future__ import annotations

import asyncio
import concurrent.futures
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, NamedTuple

import re

import hotline_desk
import hub_rows
from hotline_desk import Book, SourceError, iso_utc

try:
    import psycopg2
except Exception:  # pragma: no cover - the caller is told, never guessed at
    psycopg2 = None  # type: ignore[assignment]

mirror_first = getattr(hotline_desk, "mirror_first", None)

log = logging.getLogger("hub.hotline")


# ── the books ────────────────────────────────────────────────────────────── Last fallback only, when the depot…
QUEUE_BOOK = Book("hotline_queue",
                  "1nALj7QPqBYuEw-2RKrY2oEFcE73RKfvVaa4YoESgJw0",
                  "Requests", "the Employee Support Queue")
INCIDENTS_BOOK = Book("hotline_incidents",
                      "1cocsVO1HDHIPTNOQUq7A9M4qWTTqvSnCLiz0B2b-QyQ",
                      "UIs and MUIs", "the UI/MUI incidents book")
CALLOFFS_BOOK = Book("hotline_calloffs",
                     "1Dl_69R0c0oUgKUfI0ME5sA3HOusrlQHZA7TYYKa9F-0",
                     "Data", "the Call Offs house")

ESSENCIAL_SHEET_ID = os.getenv("HUB_ESSENCIAL_SHEET_ID",
                               "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug")
HOUSE_PTR_TTL_S = 600.0
DEPOT_RETRY_S = 30.0
# HouseFlip.gs HOUSE_DATA_TAB.
HOUSE_DATA_TAB = "Data"
# Switchboard.gs switchboardOn_: an explicit yes, nothing inferred.
_SWITCH_ON = frozenset({"on", "true", "1", "yes"})

LANE_MAX_AGE_S = float(os.getenv("HUB_HOTLINE_LANES_MAX_AGE", "30"))
LANE_RETRY_S = 10.0
LANE_BUDGET_S = 12.0
# A tab missing a named column (the writer appends call_id later) is re-read once after this age, then believed.
LANE_HEADER_TTL_S = float(os.getenv("HUB_HOTLINE_LANES_HEADER_TTL", "300"))

# The caller's number never travels; `Requestor Phone` is the queue's own column and is allowed.
_NEVER_READ = frozenset({"caller", "caller_phone", "phone", "phone_number",
                         "Caller", "Caller Phone", "Phone", "Phone Number"})


class Lane(NamedTuple):
    key: str
    label: str
    book: Book
    estate_prop: str
    env_var: str
    # our key → the estate header; the house spelling is the key itself, and both are accepted.
    fields: dict[str, str]
    must: tuple[str, ...]
    # Declared, never inferred: the API flattens a date cell to a number.
    dates: frozenset[str]


LANES: tuple[Lane, ...] = (
    Lane("callOffs", "Call Offs", CALLOFFS_BOOK, "", "HUB_HOTLINE_CALLOFFS_SHEET_ID",
         {"id": "id", "createdAt": "createdAt", "updatedAt": "updatedAt",
          "timestamp": "timestamp", "employee_name": "employee_name", "date": "date",
          "type": "type", "how_late": "how_late", "notes": "notes",
          "your_name": "your_name", "call_id": "call_id", "name_from": "name_from"},
         ("id",), frozenset()),
    Lane("supportQueue", "Support Queue", QUEUE_BOOK, "EMP360_WORK_QUEUE_ID",
         "HUB_HOTLINE_QUEUE_SHEET_ID",
         {"id": "id", "status": "Status", "urgency": "Urgency",
          "date_received": "Date Received", "requestor": "Requestor",
          "requestor_phone": "Requestor Phone", "type_of_request": "Type of Request",
          "description_of_request": "Description of Request", "notes": "Notes",
          "processed": "Processed"},
         ("date_received", "requestor"), frozenset({"date_received"})),
    Lane("uiIncidents", "Incidents", INCIDENTS_BOOK, "ESTATE_UI_ID",
         "HUB_HOTLINE_INCIDENTS_SHEET_ID",
         {"id": "id", "timestamp": "Timestamp", "your_name": "Your Name",
          "client_name": "Client Name",
          "incident_category": "Incident Category", "incident_location": "Incident Location",
          "incident_date": "Incident Date", "incident_time": "Incident Time",
          "incident_reported_date": "Incident Reported Date",
          "incident_reported_time": "Incident Reported Time",
          "employees_involved": "Employees Involved",
          "summary_of_incident": "Summary of Incident",
          "immediate_action_taken": "Immediate Action Taken",
          "cause_and_contributing_factors": "Cause and Contributing Factors",
          "prevention_plan": "Prevention Plan"},
         ("timestamp",),
         frozenset({"timestamp", "incident_date", "incident_time",
                    "incident_reported_date", "incident_reported_time"})),
)

LANE_BY_KEY = {lane.key: lane for lane in LANES}
LANE_KEYS = tuple(lane.key for lane in LANES)


class LaneUnknown(KeyError):
    """A name that is not one of this screen's three lanes."""


def lane_named(name: str) -> str:
    """The lane key for what the screen asked for, case-insensitively."""
    asked = str(name or "").strip()
    for key in LANE_KEYS:
        if key.lower() == asked.lower():
            return key
    raise LaneUnknown(asked)


# ── cells: Estate.gs estateCell_, in Python ────────────────────────────────
def _js_str(value: Any) -> str:
    """A cell as JavaScript's String() writes it: 79.0 is "79", None is ""."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


# A serial below 2.0 is a time-only cell: print the typed hour, never convert it (1899 offsets are 5h32m).
_SHEETS_EPOCH = datetime(1899, 12, 30)
_TIME_ONLY_BELOW = 2.0
_SERIAL_MAX = 2958465.0


def _clock_text(days: float) -> str:
    """A fraction of a day as the hour somebody typed, on the book's own face."""
    minutes = int(round((days % 1.0) * 1440.0)) % 1440
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _instant_text(days: float, zone: str) -> str:
    """To the millisecond, as toISOString does; whole seconds would move some stamps to the next minute."""
    if not _TIME_ONLY_BELOW <= days < _SERIAL_MAX:
        return ""
    naive = _SHEETS_EPOCH + timedelta(milliseconds=round(days * 86400000.0))
    dt = naive.replace(tzinfo=hotline_desk._zone(zone)).astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _cell(value: Any, *, date: bool, zone: str) -> str:
    """One cell as estateCell_ shapes it; only a declared date column is read as a date."""
    if date and isinstance(value, (int, float)) and not isinstance(value, bool):
        days = float(value)
        return _clock_text(days) if days < _TIME_ONLY_BELOW else _instant_text(days, zone)
    return _js_str(value)


def _epoch_of(stamp: str) -> float:
    """An `iso_utc` stamp back as seconds; 0.0 when there is none."""
    try:
        return datetime.strptime(str(stamp), "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc).timestamp()
    except (TypeError, ValueError):
        return 0.0


# ── where each lane's rows live ────────────────────────────────────────────
_DEPOT: dict[str, Any] = {"until": 0.0, "facts": {}}


def _facts_of(lane: Lane) -> tuple[str, ...]:
    """The depot rows one lane's address is made of."""
    wanted = [f"switchboard:moved.{lane.key}",
              f"switchboard:props.HUB_HOUSE_{lane.key.upper()}_ID"]
    if lane.estate_prop:
        wanted.append(f"switchboard:props.{lane.estate_prop}")
    return tuple(wanted)


_WANTED_FACTS: tuple[str, ...] = tuple(sorted({f for lane in LANES for f in _facts_of(lane)}))


def switchboard(pg_dsn: str) -> dict[str, str]:
    """The switchboard facts these lanes stand on, one query, held; an unreadable depot keeps what is held."""
    now = time.time()
    if now < float(_DEPOT["until"]):
        return dict(_DEPOT["facts"])
    try:
        rows = [(hub_rows.cell(d.get("Source")), hub_rows.cell(d.get("Value")))
                for d in hub_rows.rows(ESSENCIAL_SHEET_ID, "Facts", where={"Source": list(_WANTED_FACTS)})]
    except Exception as exc:  # noqa: BLE001 - the named ids still answer
        log.warning("hotline lanes: the switchboard could not be read: %s", type(exc).__name__)
        _DEPOT["until"] = now + DEPOT_RETRY_S
        return dict(_DEPOT["facts"])
    # Last row of a repeated fact stands.
    facts = {str(source): str(value).strip() for source, value in rows if str(value or "").strip()}
    _DEPOT.update(until=now + HOUSE_PTR_TTL_S, facts=facts)
    return dict(facts)


def _present(lane: Lane, header: list[str]) -> dict[str, str]:
    """our key → the header cell this book spells it with (either spelling)."""
    present: dict[str, str] = {}
    for key, name in lane.fields.items():
        for cell in (name, key):
            if cell in header:
                present[key] = cell
                break
    return present


def _house_book(lane: Lane, sheet_id: str) -> Book:
    """The data house under its own label, so logs and refusals name the right book."""
    return lane.book._replace(sheet_id=sheet_id, tab=HOUSE_DATA_TAB,
                              label=f"the {lane.label} data house")


_HOUSE_SAID: dict[tuple[str, str], tuple[float, bool]] = {}


def _house_carries(svc: Any, lane: Lane, sheet_id: str) -> bool:
    """A header alone is not the flip: the house must hold a majority of the fields, every `must`, and a row."""
    now = time.time()
    asked = (lane.key, sheet_id)
    said = _HOUSE_SAID.get(asked)
    if said is not None and now - said[0] < LANE_HEADER_TTL_S:
        return said[1]
    book = _house_book(lane, sheet_id)
    try:
        _, _, present = _lane_meta(svc, lane, book)
        enough = (all(k in present for k in lane.must)
                  and len(present) * 2 > len(lane.fields))
        rows = (hotline_desk._read_columns(svc, book, {k: present[k] for k in lane.must},
                                           required=()) if enough else [])
    except Exception as exc:  # noqa: BLE001 - an unreadable house is not the truth
        log.warning("hotline lanes: %s could not be asked: %s", book.label, type(exc).__name__)
        _HOUSE_SAID[asked] = (now, False)
        return False
    carries = bool(enough and rows)
    _HOUSE_SAID[asked] = (now, carries)
    log.info("hotline lanes: %s carries %d of %d named column(s) and %d row(s) — the %s lane "
             "reads %s", book.label, len(present), len(lane.fields), len(rows), lane.key,
             book.label if carries else lane.book.label)
    return carries


def resolve_book(svc: Any, lane: Lane, pg_dsn: str) -> tuple[Book, str, str]:
    """(book, pointer, fact): an estate source intercepts first, otherwise a declared house that carries rows."""
    override = (os.getenv(lane.env_var) or "").strip()
    if override:
        return lane.book._replace(sheet_id=override), "env", lane.env_var
    facts = switchboard(pg_dsn)
    house_fact = f"switchboard:props.HUB_HOUSE_{lane.key.upper()}_ID"
    house = facts.get(house_fact, "")
    moved = facts.get(f"switchboard:moved.{lane.key}", "").lower() in _SWITCH_ON
    estate_fact = f"switchboard:props.{lane.estate_prop}" if lane.estate_prop else ""
    estate = facts.get(estate_fact, "") if estate_fact else ""
    if moved and house and (not estate or _house_carries(svc, lane, house)):
        return _house_book(lane, house), "house", house_fact
    if estate:
        return lane.book._replace(sheet_id=estate), "estate", estate_fact
    return lane.book, "named", ""


# ── the read ───────────────────────────────────────────────────────────────
_HEADER_AT: dict[tuple[str, str], float] = {}
_HEADER_GAPS: dict[tuple[str, str], tuple[frozenset[str], bool]] = {}


def _gaps_of(lane: Lane, present: dict[str, str]) -> frozenset[str]:
    """The columns this lane names and that tab does not carry."""
    return frozenset(k for k in lane.fields if k not in present)


def _lane_meta(svc: Any, lane: Lane, book: Book) -> tuple[str, list[str], dict[str, str]]:
    """(zone, header, present); a gap is re-read once past its age, then believed until `invalidate`."""
    key = (book.sheet_id, book.tab)
    now = time.time()
    first = key not in _HEADER_AT
    zone, header = hotline_desk._meta(svc, book)
    present = _present(lane, header)
    if first:
        _HEADER_AT[key] = now
        _HEADER_GAPS[key] = (_gaps_of(lane, present), False)
        return zone, header, present
    gaps, settled = _HEADER_GAPS.get(key, (frozenset(), False))
    if gaps and not settled and now - _HEADER_AT[key] >= LANE_HEADER_TTL_S:
        zone, header = hotline_desk._meta(svc, book, refresh=True)
        _HEADER_AT[key] = now
        present = _present(lane, header)
        fresh = _gaps_of(lane, present)
        _HEADER_GAPS[key] = (fresh, fresh == gaps)
    return zone, header, present


def _read_lane(svc: Any, lane: Lane, pg_dsn: str) -> tuple[dict[str, Any], int]:
    """One lane's tab, by column name, blank rows skipped."""
    if any(name in _NEVER_READ for name in lane.fields.values()):
        raise ValueError(f"a caller's phone column was asked for in the {lane.key} lane")
    book, pointer, fact = resolve_book(svc, lane, pg_dsn)
    zone, header, present = _lane_meta(svc, lane, book)
    if any(k not in present for k in lane.must):
        zone, header = hotline_desk._meta(svc, book, refresh=True)
        _HEADER_AT[(book.sheet_id, book.tab)] = time.time()
        present = _present(lane, header)
        _HEADER_GAPS[(book.sheet_id, book.tab)] = (_gaps_of(lane, present), False)
        missing = [lane.fields[k] for k in lane.must if k not in present]
        if missing:
            raise SourceError(f"{hotline_desk._sentence(book.label)} has no "
                              f"{', '.join(repr(m) for m in missing)} column.")
    raw = hotline_desk._read_columns(svc, book, present, required=())
    rows: list[dict[str, Any]] = []
    for r in raw:
        out: dict[str, Any] = {}
        for key in present:
            out[key] = _cell(r.get(key), date=key in lane.dates, zone=zone)
        # No id column: the row number is the id.
        out["id"] = str(out.get("id") or "") or f"r{r['_row']}"
        if not any(str(v).strip() for k, v in out.items() if k != "id"):
            continue
        rows.append({"id": out["id"], **{k: out[k] for k in present if k != "id"}})
    return {"rows": rows, "fields": ["id"] + [k for k in present if k != "id"],
            "zone": zone, "book": book, "pointer": pointer, "fact": fact,
            "cells": dict(present)}, len(rows)


# ── the order: kept copy confirmed by the mirror, else Google ──────────────
_COPIES = mirror_first.Copies("hotline-lanes") if mirror_first is not None else None
# When the relay last rang for a filing into each lane; a copy confirmed before that cannot hold it.
_NEWS: dict[str, float] = {lane.key: (mirror_first.STARTED_AT if mirror_first is not None
                                      else time.time()) for lane in LANES}
LANE_DECLARED_ZONE = "America/New_York"
_ISO_INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
_HHMM = re.compile(r"^\d{2}:\d{2}$")
_CLOCK = re.compile(r"^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*$")


def _storable(value: dict[str, Any]) -> dict[str, Any]:
    """A lane's value as plain JSON (its Book as a dict) for the kept copy."""
    book = value.get("book")
    return {**value, "book": book._asdict() if isinstance(book, Book) else book}


def _restored(value: dict[str, Any]) -> dict[str, Any]:
    book = value.get("book")
    if isinstance(book, dict):
        book = Book(**{k: book.get(k, "") for k in Book._fields})
    elif isinstance(book, list):
        book = Book(*book)
    return {**value, "book": book}


def _clock_seconds(text: str) -> int | None:
    """'1:10:00 PM', '13:10:00' or '13:10' → seconds after midnight."""
    m = _CLOCK.match(text)
    if not m:
        return None
    hour, minute, second = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    ampm = (m.group(4) or "").lower()
    if ampm:
        if not 1 <= hour <= 12:
            return None
        hour = hour % 12 + (12 if ampm == "pm" else 0)
    if hour > 23 or minute > 59 or second > 59:
        return None
    return hour * 3600 + minute * 60 + second


def _date_equiv(kept: str, shown: str, zone: str) -> bool:
    """Mirror text vs a live-shaped cell: same second for instants, same rounded minute for time-only cells."""
    if kept == shown:
        return True
    if not kept or not shown:
        return False
    if _ISO_INSTANT.match(kept):
        at = hotline_desk.parse_when(shown, zone)
        if at is None:
            return False
        exact = datetime.strptime(kept, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
        return abs((exact - at).total_seconds()) < 1.0
    if _HHMM.match(kept):
        secs = _clock_seconds(shown)
        if secs is None:
            return False
        want = int(kept[:2]) * 60 + int(kept[3:])
        got = secs / 60.0
        return round(got) % 1440 == want or (secs % 60 == 30 and abs(got - want) <= 0.5)
    return False


def _shown_rows(lane: Lane, cells: dict[str, str],
                rows: list[dict[str, Any]]) -> list[tuple[str, dict[str, Any]]]:
    """Mirror rows as _read_lane keeps them: (id, row), blank rows skipped."""
    out = []
    for r in rows:
        rid = str(r.get("id") or "") or f"r{r['_row']}"
        if not any(str(r.get(k) or "").strip() for k in cells if k != "id"):
            continue
        out.append((rid, r))
    return out


def _same_rows(lane: Lane, value: dict[str, Any], mirrored: list[dict[str, Any]]) -> bool:
    """Does the mirror show the book the kept copy was read from, row for row?"""
    cells, zone = value.get("cells") or {}, value.get("zone") or LANE_DECLARED_ZONE
    kept_rows = value.get("rows") or []
    shown = _shown_rows(lane, cells, mirrored)
    if len(shown) != len(kept_rows):
        return False
    for (rid, r), kr in zip(shown, kept_rows):
        if str(kr.get("id") or "") != rid:
            return False
        for k in cells:
            if k == "id":
                continue
            text, held = str(r.get(k) or ""), str(kr.get(k, ""))
            if k in lane.dates:
                if not _date_equiv(held, text, zone):
                    return False
            elif held != text:
                return False
    return True


def _house_carries_mirror(lane: Lane, sheet_id: str, pg_dsn: str) -> bool | None:
    """_house_carries asked of the mirror; None when the mirror cannot vouch."""
    v = mirror_first.vouch(pg_dsn, sheet_id, HOUSE_DATA_TAB, rows_needed=False)
    if not v.fresh:
        return None
    if not mirror_first.vouch(pg_dsn, sheet_id, HOUSE_DATA_TAB).has:
        return False
    present = _present(lane, sorted(mirror_first.mirror_header(pg_dsn, sheet_id, HOUSE_DATA_TAB)))
    if not (all(k in present for k in lane.must) and len(present) * 2 > len(lane.fields)):
        return False
    rows = mirror_first.mirror_rows(pg_dsn, sheet_id, HOUSE_DATA_TAB,
                                    {k: present[k] for k in lane.must}, refuse=_NEVER_READ)
    return any(any(str(r.get(k) or "").strip() for k in lane.must) for r in rows)


def _resolve_from_mirror(lane: Lane, pg_dsn: str) -> tuple[Book, str, str] | None:
    """resolve_book with the house asked of the mirror; None when it cannot say."""
    override = (os.getenv(lane.env_var) or "").strip()
    if override:
        return lane.book._replace(sheet_id=override), "env", lane.env_var
    facts = switchboard(pg_dsn)
    house_fact = f"switchboard:props.HUB_HOUSE_{lane.key.upper()}_ID"
    house = facts.get(house_fact, "")
    moved = facts.get(f"switchboard:moved.{lane.key}", "").lower() in _SWITCH_ON
    estate_fact = f"switchboard:props.{lane.estate_prop}" if lane.estate_prop else ""
    estate = facts.get(estate_fact, "") if estate_fact else ""
    if moved and house:
        carries = True if not estate else _house_carries_mirror(lane, house, pg_dsn)
        if carries is None:
            return None
        if carries:
            return _house_book(lane, house), "house", house_fact
    if estate:
        return lane.book._replace(sheet_id=estate), "estate", estate_fact
    return lane.book, "named", ""


def _lane_from_mirror(lane: Lane, target: tuple[Book, str, str], pg_dsn: str,
                      zone: str) -> tuple[dict[str, Any], int]:
    """The lane from the mirror alone, only ever served as a copy said to be one."""
    book, pointer, fact = target
    present = _present(lane, sorted(mirror_first.mirror_header(pg_dsn, book.sheet_id, book.tab)))
    if any(k not in present for k in lane.must):
        raise SourceError(f"{hotline_desk._sentence(book.label)}'s mirrored copy has no "
                          f"{', '.join(repr(lane.fields[k]) for k in lane.must if k not in present)}"
                          " column.")
    mirrored = mirror_first.mirror_rows(pg_dsn, book.sheet_id, book.tab, present,
                                        refuse=_NEVER_READ)
    rows: list[dict[str, Any]] = []
    for rid, r in _shown_rows(lane, present, mirrored):
        out: dict[str, Any] = {"id": rid}
        for k in present:
            if k == "id":
                continue
            text = str(r.get(k) or "")
            if k in lane.dates and text:
                secs = _clock_seconds(text)
                if secs is not None:
                    minutes = int(round(secs / 60.0)) % 1440
                    text = f"{minutes // 60:02d}:{minutes % 60:02d}"
                elif not re.match(r"^\d{4}-\d{2}-\d{2}", text):
                    at = hotline_desk.parse_when(text, zone)
                    if at is not None:
                        text = at.strftime("%Y-%m-%dT%H:%M:%S.000Z")
            out[k] = text
        rows.append(out)
    return {"rows": rows, "fields": ["id"] + [k for k in present if k != "id"], "zone": zone,
            "book": book, "pointer": pointer, "fact": fact, "cells": dict(present)}, len(rows)


def _read_lane_first(svc: Any, lane: Lane, pg_dsn: str) -> tuple[Any, ...]:
    """(value, count[, stale sentence]) via mirror_first; the value carries `as_of`."""
    if mirror_first is None or _COPIES is None or not pg_dsn:
        return _read_lane(svc, lane, pg_dsn)
    source = f"lane:{lane.key}"
    try:
        target = _resolve_from_mirror(lane, pg_dsn)
    except Exception as exc:  # noqa: BLE001 - the lane reads Google, which places itself
        log.warning("hotline lane %s: not placed from the mirror (%s)", lane.key, type(exc).__name__)
        target = None

    def vouch() -> Any:
        if target is None:
            return mirror_first.Vouch(False, False, 0.0, "the lane could not be placed")
        return mirror_first.vouch(pg_dsn, target[0].sheet_id, target[0].tab)

    def confirm(kept: dict[str, Any] | None) -> tuple[Any, int]:
        if kept is None or target is None:
            raise mirror_first.MirrorDiffers("there is no copy to confirm")
        value = kept["value"]
        was = value.get("book") or {}
        if not isinstance(was, dict) or (was.get("sheet_id"), was.get("tab")) != (
                target[0].sheet_id, target[0].tab):
            raise mirror_first.MirrorDiffers("the lane points at another book now")
        cells = dict(value.get("cells") or {})
        if not cells:
            raise mirror_first.MirrorDiffers("the copy does not say which columns it read")
        keys, mirrored = mirror_first.mirror_table(pg_dsn, target[0].sheet_id, target[0].tab,
                                                   cells, refuse=_NEVER_READ)
        if _present(lane, sorted(keys)) != cells:
            raise mirror_first.MirrorDiffers("the book's columns changed")
        if not _same_rows(lane, value, mirrored):
            raise mirror_first.MirrorDiffers("the book's rows changed")
        return value, int(kept["count"])

    def from_mirror_only() -> tuple[Any, int]:
        if target is None:
            raise SourceError("the lane could not be placed from the mirror")
        kept = _COPIES.get(source)
        zone = ((kept or {}).get("value") or {}).get("zone") or hotline_desk._ZONES.get(
            target[0].sheet_id) or LANE_DECLARED_ZONE
        value, count = _lane_from_mirror(lane, target, pg_dsn, zone)
        return _storable(value), count

    def live() -> tuple[Any, int]:
        value, count = _read_lane(svc, lane, pg_dsn)
        return _storable(value), count

    label = target[0].label if target is not None else lane.book.label
    ans = mirror_first.read(
        source, _COPIES, label=label, need_after=_NEWS.get(lane.key, 0.0),
        vouch=vouch, from_mirror=confirm, from_live=live,
        paused=lambda: (hotline_desk.quota_hold_sentence(label)
                        if hotline_desk.quota_hold_left() > 0 else ""),
        fail=SourceError,
        sentence_of=lambda exc: (str(exc) if isinstance(exc, SourceError)
                                 else f"{hotline_desk._sentence(label)} could not be read "
                                      f"({type(exc).__name__})."),
        stale_from_mirror=from_mirror_only)
    value = _restored(ans.value)
    value["as_of"] = ans.as_of
    return (value, ans.count, ans.stale) if ans.stale else (value, ans.count)


def _version(rows: list[dict[str, Any]] | None, ok: bool, error: str) -> str:
    """Hash of what the screen draws, never the read time, so an unchanged rebuild is not news."""
    blob = json.dumps({"rows": rows, "ok": ok, "error": error},
                      sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def build_lane(sheets: Any, key: str, pg_dsn: str = "") -> dict[str, Any]:
    """One lane, read now; the thread's budget is always cleared, since the threads are reused."""
    lane = LANE_BY_KEY.get(key)
    if lane is None:
        raise LaneUnknown(key)
    source = f"hotline_lane_{lane.key}"
    t0 = time.time()
    hotline_desk._BUDGET.until = t0 + LANE_BUDGET_S
    try:
        with hotline_desk._Lent(sheets, _LANE_SERVICES) as svc:
            value, health, ms = hotline_desk._serve(source,
                                                    lambda: _read_lane_first(svc, lane, pg_dsn))
    finally:
        hotline_desk._BUDGET.until = None
    rows = value["rows"] if value else None
    ok = bool(health["ok"])
    error = str(health["error"] or "")
    # Dated by when these rows were read, never by this pass.
    with hotline_desk._LAST_GOOD_LOCK:
        last = hotline_desk._LAST_GOOD.get(source)
    as_of = float((value or {}).get("as_of") or 0.0)
    if as_of:
        read_at = iso_utc(datetime.fromtimestamp(as_of, timezone.utc))
    else:
        read_at = iso_utc(datetime.fromtimestamp(last[1], timezone.utc)) if last else ""
    book = value["book"] if value else lane.book
    payload = {
        "name": lane.key,
        "label": lane.label,
        "ok": ok,
        "reason": "" if ok else "unreadable",
        "error": error,
        "stale": bool(rows is not None and not ok),
        "rows": rows,
        "count": len(rows) if rows is not None else None,
        "version": _version(rows, ok, error),
        "read_at": read_at,
        "at": read_at,
        "source": {"book": book.label, "tab": book.tab,
                   "fields": value["fields"] if value
                   else ["id"] + [k for k in lane.fields if k != "id"],
                   "pointer": value["pointer"] if value else "",
                   "fact": value["fact"] if value else ""},
    }
    log.info("hotline lane %s: %s row(s) from %s (%s), %d ms%s", lane.key,
             payload["count"] if payload["count"] is not None else "no",
             book.label, payload["source"]["pointer"] or "none", round(ms),
             "" if ok else f" — {error}")
    return payload


# ── the lanes' own threads and services ──────────────────────────────────── Never the desk's pool, so a lane read…
_LANE_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=len(LANES) + 1,
                                                   thread_name_prefix="hotline-lanes")
_LANE_SERVICES: list[Any] = []


async def run_on_lanes(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Run one blocking lane read — or the log watch's own — on these threads."""
    return await asyncio.get_running_loop().run_in_executor(
        _LANE_POOL, lambda: fn(*args, **kwargs))


_HELD: dict[str, dict[str, Any]] = {
    lane.key: {"lane": None, "at": 0.0, "task": None, "gen": 0, "failure": "", "failed_at": 0.0}
    for lane in LANES
}


def _landed(task: "asyncio.Future", key: str, gen: int) -> None:
    held = _HELD[key]
    if task.cancelled():
        return
    exc = task.exception()
    if exc is None:
        # A read that started before an invalidate answers as held but is not fresh.
        fresh = gen == held["gen"]
        held["lane"], held["at"], held["failure"] = (task.result(),
                                                     time.time() if fresh else 0.0, "")
        return
    held["failed_at"] = time.time()
    held["failure"] = (f"{hotline_desk._sentence(LANE_BY_KEY[key].label)} could not be read "
                       f"({type(exc).__name__}).")
    log.warning("hotline lane %s: read failed: %s", key, held["failure"])


def _start_read(sheets: Any, key: str, pg_dsn: str) -> "asyncio.Future":
    held = _HELD[key]
    gen = int(held["gen"])
    task = asyncio.ensure_future(run_on_lanes(build_lane, sheets, key, pg_dsn))
    task.add_done_callback(lambda t: _landed(t, key, gen))
    held["task"] = task
    return task


def _as_copy(payload: dict[str, Any], sentence: str) -> dict[str, Any]:
    """Mark a held payload as a copy (ok false, stale) so minutes-old rows never draw as current."""
    stamp = str(payload.get("read_at") or "")
    if stamp and "Showing the copy" not in sentence:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        when = stamp[11:] if stamp[:10] == today else stamp.replace("T", " ")
        sentence = f"{sentence} Showing the copy read at {when}."
    return {**payload, "ok": False, "reason": "unreadable", "stale": True, "error": sentence,
            "version": _version(payload["rows"], False, sentence)}


def _unreadable(key: str, sentence: str) -> dict[str, Any]:
    lane = LANE_BY_KEY[key]
    return {"name": lane.key, "label": lane.label, "ok": False, "reason": "unreadable",
            "error": sentence, "stale": False, "rows": None, "count": None,
            "version": _version(None, False, sentence),
            "read_at": "", "at": "",
            "source": {"book": lane.book.label, "tab": lane.book.tab,
                       "fields": ["id"] + [k for k in lane.fields if k != "id"],
                       "pointer": "", "fact": ""}}


async def current_lane(sheets: Any, key: str, pg_dsn: str = "",
                       max_age_s: float = LANE_MAX_AGE_S) -> dict[str, Any]:
    """One lane, single-flight and shielded; a held copy answers marked as a copy, never an exception."""
    if key not in _HELD:
        raise LaneUnknown(key)
    held = _HELD[key]
    now = time.time()
    copy = held["lane"]
    if copy is not None and now - held["at"] < max_age_s:
        return copy
    label = (copy or {}).get("source", {}).get("book") or LANE_BY_KEY[key].book.label
    task = held["task"]
    if task is None or task.done():
        paused = hotline_desk.quota_hold_left() > 0
        if paused and copy is not None:
            # The quota pause is desk-wide: another reader's 429 can freeze this lane.
            pause = hotline_desk.quota_hold_sentence(label)
            return _as_copy(copy, pause) if copy["rows"] is not None else _unreadable(key, pause)
        if copy is None and held["failure"] and (now - held["failed_at"] < LANE_RETRY_S or paused):
            return _unreadable(key, hotline_desk.quota_hold_sentence(label) if paused
                               else held["failure"])
        # During the pause this costs no request: hotline_desk._execute refuses before asking.
        task = _start_read(sheets, key, pg_dsn)
    if copy is not None:
        try:
            return await asyncio.wait_for(asyncio.shield(task),
                                          timeout=hotline_desk.HELD_WAIT_S)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - a slow or failed read: the held copy answers
            if copy["rows"] is None:
                return copy
            return _as_copy(copy, held["failure"] or f"{hotline_desk._sentence(label)} "
                            f"did not answer in {hotline_desk.HELD_WAIT_S:.0f} seconds.")
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        return _unreadable(key, f"{hotline_desk._sentence(LANE_BY_KEY[key].label)} could not "
                                f"be read ({type(exc).__name__}).")


async def current_lanes(sheets: Any, names: tuple[str, ...] = LANE_KEYS,
                        pg_dsn: str = "", max_age_s: float = LANE_MAX_AGE_S) -> dict[str, Any]:
    """The named lanes side by side; `age_ms` is the age of the rows, not of the last attempt."""
    wanted = tuple(names)
    for key in wanted:
        if key not in _HELD:
            raise LaneUnknown(key)
    got = await asyncio.gather(*(current_lane(sheets, key, pg_dsn, max_age_s) for key in wanted))
    now = time.time()
    lanes: dict[str, Any] = {}
    for key, payload in zip(wanted, got):
        entry = dict(payload)
        at = _epoch_of(entry.get("read_at") or "")
        entry["age_ms"] = round(max(0.0, now - at) * 1000) if at else None
        lanes[key] = entry
    version = hashlib.sha256(json.dumps(
        [[k, lanes[k]["version"], lanes[k]["ok"]] for k in wanted],
        separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()[:16]
    return {"built_at": iso_utc(datetime.now(timezone.utc)), "version": version,
            "unchanged": False, "lanes": lanes}


def without_rows(answer: dict[str, Any]) -> dict[str, Any]:
    """The answer with `rows` ABSENT, never null: null means "never read"."""
    lanes = {key: {k: v for k, v in lane.items() if k != "rows"}
             for key, lane in answer["lanes"].items()}
    return {**answer, "lanes": lanes, "unchanged": True}


def invalidate(names: tuple[str, ...] = LANE_KEYS) -> None:
    """A filing landed: held copies, header ages and house verdicts are all old now."""
    for key in names:
        held = _HELD.get(key)
        if held is None:
            continue
        held["at"] = 0.0
        held["gen"] = int(held.get("gen") or 0) + 1
        _NEWS[key] = time.time()
    # Dated old, not forgotten: a forgotten header would count as freshly read.
    for tab in _HEADER_AT:
        _HEADER_AT[tab] = 0.0
    for tab, (gaps, _settled) in list(_HEADER_GAPS.items()):
        _HEADER_GAPS[tab] = (gaps, False)
    _HOUSE_SAID.clear()


# ── the sweep's own log, while a call is being filed ─────────────────────── The log line lands when the rows do…
LOG_FIELDS = {"call_id": "call_id", "at": "at", "items": "items", "kinds": "kinds",
              "status": "status", "via": "via"}
LOG_READ_EVERY_S = 4.0
_LOG: dict[str, Any] = {"at": 0.0, "by_call": {}, "task": None, "failure": "", "failed_at": 0.0}


def _log_landed(task: "asyncio.Future") -> None:
    """Retrieves the exception even with no watcher left, or asyncio prints "never retrieved"."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc is None:
        _LOG["failure"] = ""
        return
    _LOG["failure"] = f"The sweep's processing log could not be read ({type(exc).__name__})."
    _LOG["failed_at"] = time.time()
    log.warning("hotline log: %s", _LOG["failure"])


def _read_log(sheets: Any) -> dict[str, dict[str, Any]]:
    """call id → what the sweep last wrote about it (`processed` or `blocked`)."""
    if any(name in _NEVER_READ for name in LOG_FIELDS.values()):
        raise ValueError("the caller's column was asked for in the processing log")
    t0 = time.time()
    hotline_desk._BUDGET.until = t0 + LANE_BUDGET_S
    try:
        with hotline_desk._Lent(sheets, _LANE_SERVICES) as svc:
            zone = hotline_desk.book_zone(svc, hotline_desk.HOTLINE_LOG)
            rows = hotline_desk._read_columns(svc, hotline_desk.HOTLINE_LOG, LOG_FIELDS)
    finally:
        hotline_desk._BUDGET.until = None
    by_call: dict[str, dict[str, Any]] = {}
    for r in rows:
        cid = str(r.get("call_id") or "").strip()
        status = str(r.get("status") or "").strip().lower()
        if not cid or status not in ("processed", "blocked"):
            continue
        when = hotline_desk.parse_when(r.get("at"), zone)
        said = {"status": status,
                "kinds": [k.strip() for k in str(r.get("kinds") or "").split(",") if k.strip()],
                "items": hotline_desk._int_or_none(r.get("items")),
                "via": str(r.get("via") or "").strip(),
                "at": hotline_desk.iso_utc(when),
                "at_epoch": when.timestamp() if when else 0.0,
                "row": int(r.get("_row") or 0)}
        held = by_call.get(cid)
        # A filing outranks a refusal; between equals the later row stands.
        if (held is None
                or (said["status"] == "processed" and held["status"] != "processed")
                or (said["status"] == held["status"] and said["row"] > held["row"])):
            by_call[cid] = said
    _LOG.update(at=time.time(), by_call=by_call)
    return by_call


async def call_verdict(sheets: Any, call_id: str, since_epoch: float = 0.0,
                       min_interval_s: float | None = None) -> dict[str, Any] | None:
    """What the sweep wrote about one call since `since_epoch`, or None."""
    interval = LOG_READ_EVERY_S if min_interval_s is None else float(min_interval_s)
    now = time.time()
    by_call = _LOG["by_call"] if now - float(_LOG["at"]) < interval else None
    if by_call is None:
        task = _LOG["task"]
        if task is None or task.done():
            if hotline_desk.quota_hold_left() > 0:
                return None
            task = asyncio.ensure_future(run_on_lanes(_read_log, sheets))
            task.add_done_callback(_log_landed)
            _LOG["task"] = task
        try:
            by_call = await asyncio.shield(task)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - the answer still comes from the execution
            return None
    said = by_call.get(str(call_id))
    if not said:
        return None
    if since_epoch and float(said["at_epoch"]) < float(since_epoch):
        return None
    return dict(said)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    _dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    _said = {key: {k: v for k, v in build_lane(hotline_desk.sheets_client, key, _dsn).items()
                   if k != "rows"} for key in LANE_KEYS}
    print(json.dumps(_said, indent=2, default=str))
