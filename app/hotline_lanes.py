"""The Hotline screen's three sheet lanes (server/hotline_lanes.py), read-only off asa-hub-db's copy with Python's kept
edits laid, never off Google: each lane placed by the switchboard's facts, its named cells only (the caller's number
never), its date cells as the book showed them, held a short while and read once at a time."""
from __future__ import annotations

import asyncio
import concurrent.futures
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable, NamedTuple

import hotline_desk
import hub_rows
from hotline_desk import Book, SourceError, iso_utc

log = logging.getLogger("asa-hub-app.hotline")


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
    # Declared, never inferred.
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


def switchboard() -> dict[str, str]:
    """The switchboard facts these lanes stand on, one read, held; an unreadable depot keeps what is held."""
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


_HOUSE_SAID: dict[tuple[str, str], bool] = {}


def _house_carries(lane: Lane, sheet_id: str) -> bool | None:
    """A header alone is not the flip: the house must hold a majority of the fields, every `must`, and a row; None
    when the copy cannot vouch for the house."""
    copy = hotline_desk.read_tab(sheet_id, HOUSE_DATA_TAB, rows_needed=False)
    if not copy.vouch.fresh:
        return None
    if not copy.rows:
        return False
    present = _present(lane, sorted(copy.headers))
    if not (all(k in present for k in lane.must) and len(present) * 2 > len(lane.fields)):
        return False
    rows = hotline_desk.table(copy, {k: present[k] for k in lane.must}, refuse=_NEVER_READ)
    carries = any(any(str(r.get(k) or "").strip() for k in lane.must) for r in rows)
    asked = (lane.key, sheet_id)
    if _HOUSE_SAID.get(asked) is not carries:
        _HOUSE_SAID[asked] = carries
        book = _house_book(lane, sheet_id)
        log.info("hotline lanes: %s carries %d of %d named column(s) and %d row(s) — the %s lane reads %s",
                 book.label, len(present), len(lane.fields), len(rows), lane.key,
                 book.label if carries else lane.book.label)
    return carries


def resolve_book(lane: Lane) -> tuple[Book, str, str] | None:
    """(book, pointer, fact): a declared house that carries rows first, else the estate source, else the named book;
    None when the copy cannot say whether the house carries."""
    override = (os.getenv(lane.env_var) or "").strip()
    if override:
        return lane.book._replace(sheet_id=override), "env", lane.env_var
    facts = switchboard()
    house_fact = f"switchboard:props.HUB_HOUSE_{lane.key.upper()}_ID"
    house = facts.get(house_fact, "")
    moved = facts.get(f"switchboard:moved.{lane.key}", "").lower() in _SWITCH_ON
    estate_fact = f"switchboard:props.{lane.estate_prop}" if lane.estate_prop else ""
    estate = facts.get(estate_fact, "") if estate_fact else ""
    if moved and house:
        carries = True if not estate else _house_carries(lane, house)
        if carries is None:
            return None
        if carries:
            return _house_book(lane, house), "house", house_fact
    if estate:
        return lane.book._replace(sheet_id=estate), "estate", estate_fact
    return lane.book, "named", ""


# ── the read ───────────────────────────────────────────────────────────────
LANE_DECLARED_ZONE = "America/New_York"
_CLOCK = re.compile(r"^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*$")


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


def _shown_rows(cells: dict[str, str], rows: list[dict[str, Any]]) -> list[tuple[str, dict[str, Any]]]:
    """(id, row), blank rows skipped; no id column: the row number is the id."""
    out = []
    for r in rows:
        rid = str(r.get("id") or "") or f"r{r['_row']}"
        if not any(str(r.get(k) or "").strip() for k in cells if k != "id"):
            continue
        out.append((rid, r))
    return out


def _read_lane(lane: Lane) -> tuple[Any, ...]:
    """(value, count[, the sentence of a copy that cannot vouch for itself]): one lane's tab, by column name."""
    target = resolve_book(lane)
    if target is None:
        raise SourceError(f"{hotline_desk._sentence(lane.book.label)} could not be placed: the copy cannot say "
                          "whether its data house carries it.")
    book, pointer, fact = target
    copy = hotline_desk.read_tab(book.sheet_id, book.tab)
    if not copy.vouch.has:
        raise SourceError(f"{hotline_desk._sentence(book.label)} could not be read: {copy.vouch.why}.")
    present = _present(lane, sorted(copy.headers))
    if any(k not in present for k in lane.must):
        raise SourceError(f"{hotline_desk._sentence(book.label)}'s copy has no "
                          f"{', '.join(repr(lane.fields[k]) for k in lane.must if k not in present)}"
                          " column.")
    zone = hotline_desk.learned_zone(f"lane:{lane.key}", book.sheet_id) or LANE_DECLARED_ZONE
    rows: list[dict[str, Any]] = []
    for rid, r in _shown_rows(present, hotline_desk.table(copy, present, refuse=_NEVER_READ)):
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
    v = copy.vouch
    value = {"rows": rows, "fields": ["id"] + [k for k in present if k != "id"], "zone": zone,
             "book": book, "pointer": pointer, "fact": fact, "cells": dict(present), "as_of": v.as_of}
    if v.fresh:
        return value, len(rows)
    return value, len(rows), hotline_desk.stale_sentence(book.label, v)


def _version(rows: list[dict[str, Any]] | None, ok: bool, error: str) -> str:
    """Hash of what the screen draws, never the read time, so an unchanged rebuild is not news."""
    blob = json.dumps({"rows": rows, "ok": ok, "error": error},
                      sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def build_lane(key: str) -> dict[str, Any]:
    """One lane, read now."""
    lane = LANE_BY_KEY.get(key)
    if lane is None:
        raise LaneUnknown(key)
    source = f"hotline_lane_{lane.key}"
    value, health, ms = hotline_desk._serve(source, lambda: _read_lane(lane))
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


# ── the lanes' own thread ──────────────────────────────────────────────────
# one, never the desk's: asa-hub-db's reader holds a connection per thread, and its slots are few
_LANE_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="hotline-lanes")


async def run_on_lanes(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Run one blocking lane read on these threads."""
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


def _start_read(key: str) -> "asyncio.Future":
    held = _HELD[key]
    gen = int(held["gen"])
    task = asyncio.ensure_future(run_on_lanes(build_lane, key))
    task.add_done_callback(lambda t: _landed(t, key, gen))
    held["task"] = task
    return task


def _as_copy(payload: dict[str, Any], sentence: str) -> dict[str, Any]:
    """Mark a held payload as a copy (ok false, stale) so minutes-old rows never draw as current."""
    when_read = str(payload.get("read_at") or "")
    if when_read and "Showing the copy" not in sentence:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        when = when_read[11:] if when_read[:10] == today else when_read.replace("T", " ")
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


async def current_lane(key: str, max_age_s: float = LANE_MAX_AGE_S) -> dict[str, Any]:
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
        if copy is None and held["failure"] and now - held["failed_at"] < LANE_RETRY_S:
            return _unreadable(key, held["failure"])
        task = _start_read(key)
    if copy is not None:
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=hotline_desk.HELD_WAIT_S)
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


async def current_lanes(names: tuple[str, ...] = LANE_KEYS,
                        max_age_s: float = LANE_MAX_AGE_S) -> dict[str, Any]:
    """The named lanes side by side; `age_ms` is the age of the rows, not of the last attempt."""
    wanted = tuple(names)
    for key in wanted:
        if key not in _HELD:
            raise LaneUnknown(key)
    got = await asyncio.gather(*(current_lane(key, max_age_s) for key in wanted))
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


def _epoch_of(when: str) -> float:
    """An `iso_utc` stamp back as seconds; 0.0 when there is none."""
    try:
        return datetime.strptime(str(when), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    except (TypeError, ValueError):
        return 0.0


def without_rows(answer: dict[str, Any]) -> dict[str, Any]:
    """The answer with `rows` ABSENT, never null: null means "never read"."""
    lanes = {key: {k: v for k, v in lane.items() if k != "rows"}
             for key, lane in answer["lanes"].items()}
    return {**answer, "lanes": lanes, "unchanged": True}


def invalidate(names: tuple[str, ...] = LANE_KEYS) -> None:
    """A filing landed: the held copies and house verdicts are old now."""
    for key in names:
        held = _HELD.get(key)
        if held is None:
            continue
        held["at"] = 0.0
        held["gen"] = int(held.get("gen") or 0) + 1
    _DEPOT["until"] = 0.0
