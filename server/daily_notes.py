"""Staff Daily Notes, read-only and mirror first; caller_phone is never read and dates are cut, never zone-shifted."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
import unicodedata
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Callable

import hotline_desk
import hub_rows
from hotline_desk import Book, SourceError, iso_utc, parse_when

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover - Python < 3.9 is not a runtime here
    ZoneInfo = None  # type: ignore[assignment]

try:
    import psycopg2
except Exception:  # pragma: no cover - the caller is told, never guessed at
    psycopg2 = None  # type: ignore[assignment]

try:
    from shift_slices import classify as _classify_cell
except Exception:  # noqa: BLE001 - that one source then says it could not be read
    _classify_cell = None  # type: ignore[assignment]

try:
    import effective_roster as _effective_roster
except Exception:  # noqa: BLE001 - the live calendar then says it could not be read
    _effective_roster = None  # type: ignore[assignment]

log = logging.getLogger("hub.daily_notes")


# ── The books and tables ──
NOTES = Book("daily_notes",
             os.getenv("HUB_DAILY_NOTES_SHEET_ID") or "1y-eDAfTT_S1H1FW_JgQxLEJVUtv0mKlsbDZVP56prJk",
             "Notes", "the Staff Daily Notes book")
# `caller_phone` is deliberately absent.
NOTE_FIELDS = {"timestamp": "timestamp", "call_id": "call_id", "reporting_date": "reporting_date",
               "dsp_name": "dsp_name", "client_name": "client_name", "category": "category",
               "response": "response"}
_NEVER_READ = frozenset({"caller_phone"})
# Used for mirror text until a live read learns the book's zone.
NOTES_DECLARED_ZONE = "America/Sao_Paulo"

CALENDAR_ARCHIVE_SHEET_ID = (os.getenv("HUB_DAILY_CALENDAR_ARCHIVE_SHEET_ID")
                             or "1NYomIa0DXh2bScsa9HB_ax400F-JaDHxzP_MnweU1Rs")
CALENDAR_ARCHIVE_TAB = "Calendar Archive"

BOOK_MAX_AGE_S = float(os.getenv("HUB_DAILY_NOTES_MAX_AGE", "60"))
BOOK_RETRY_S = 10.0

ESTATE_ZONE = "America/New_York"

NOT_DAILY = frozenset({"incidents", "incidents_risk", "admin_tasks", "other", "other_info",
                       "general_update"})
CATEGORY_LABELS = {
    "sleep": "Sleep", "sleep_quality": "Sleep quality", "food_liquids": "Food & liquids",
    "eating_habits": "Eating habits", "hygiene": "Hygiene", "urination": "Urination",
    "bms": "Bowel movements", "bowel_movements": "Bowel movements", "mobility": "Mobility",
    "mental_health": "Mental health", "mental_health_rating": "Mental health rating",
    "physical_health": "Physical health", "physical_wellbeing": "Physical wellbeing",
    "activities_and_interactions": "Activities & interactions", "housekeeping": "Housekeeping",
    "daily_update": "Daily update", "meals": "Meals", "activities": "Activities",
    "medical": "Medical", "behavior": "Behavior", "incidents": "Incidents",
    "incidents_risk": "Incidents & risk", "admin_tasks": "Admin tasks", "other": "Other",
    "other_info": "Other info", "general_update": "General update",
}


class BookUnavailable(RuntimeError):
    """The notes book has never been read — an empty list would read as 'nobody called'."""


class ClientNotFound(KeyError):
    """The client name is not in the clients slice."""


def _zone(name: str):
    if ZoneInfo is not None:
        try:
            return ZoneInfo(name)
        except Exception:  # noqa: BLE001
            pass
    return timezone.utc


def _js_str(value: Any) -> str:
    """A cell as JavaScript's String() writes it: 79.0 is "79", None is ""."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


# ── Names: a line-for-line port of apps-script/Names.gs; change both together ──
NAME_SUFFIXES = frozenset({
    "jr", "sr", "ii", "iii", "iv", "v",
    "md", "rn", "lpn", "stna", "dsp", "phd", "esq",
    "mr", "mrs", "ms", "miss", "dr",
    # Names.gs looks suffixes up on a plain object, so the inherited 'constructor' counts too.
    "constructor",
})

NAME_NICKNAMES = {
    "mike": "michael", "mikey": "michael", "mick": "michael",
    "bob": "robert", "bobby": "robert", "robbie": "robert", "rob": "robert",
    "bill": "william", "billy": "william", "willie": "william",
    "jim": "james", "jimmy": "james",
    "joe": "joseph", "joey": "joseph",
    "tom": "thomas", "tommy": "thomas",
    "dave": "david", "davey": "david",
    "dan": "daniel", "danny": "daniel",
    "chris": "christopher", "kris": "christopher",
    "matt": "matthew", "nick": "nicholas", "tony": "anthony",
    "steve": "steven", "stevie": "steven",
    "eddie": "edward", "ed": "edward",
    "rick": "richard", "ricky": "richard", "rich": "richard",
    "jen": "jennifer", "jenny": "jennifer", "jess": "jessica", "jessie": "jessica",
    "liz": "elizabeth", "lizzie": "elizabeth", "beth": "elizabeth",
    "katie": "katherine", "kathy": "katherine", "kate": "katherine",
    "sue": "susan", "suzy": "susan", "susie": "susan",
    "patty": "patricia", "trish": "patricia",
    "maggie": "margaret", "peggy": "margaret",
    "becky": "rebecca", "debbie": "deborah", "deb": "deborah",
    "cindy": "cynthia", "vicky": "victoria", "angie": "angela", "barb": "barbara",
    "ken": "kenneth", "kenny": "kenneth",
    "larry": "lawrence", "jerry": "gerald", "gerry": "gerald",
    "ron": "ronald", "ronnie": "ronald", "don": "donald", "donnie": "donald",
    "charlie": "charles", "chuck": "charles",
    "hank": "henry", "johnny": "john", "jon": "john", "jack": "john",
    "greg": "gregory", "andy": "andrew", "drew": "andrew",
    "ben": "benjamin", "benny": "benjamin",
    "sam": "samuel", "sammy": "samuel",
    "alex": "alexander", "zach": "zachary", "josh": "joshua",
    "nate": "nathaniel", "gabe": "gabriel", "theo": "theodore",
    "tina": "christina", "chrissy": "christina",
    "shell": "michelle", "shelly": "michelle",
    "toni": "antoinette", "dee": "deandra",
}

NAME_MATCH_MIN = 0.86
NAME_MATCH_GAP = 0.05

# JavaScript's \s, not Python's (adds U+FEFF, drops U+001C–U+001F and U+0085).
_JS_SPACE = "\t\n\f\r    -     　﻿"
_COMBINING = re.compile("[̀-ͯ]")
_APOSTROPHES = re.compile("['’`]")
_NOT_NAME = re.compile(f"[^a-z0-9{_JS_SPACE}]")
_SPACES = re.compile(f"[{_JS_SPACE}]+")


def name_deburr(value: Any) -> str:
    """nameDeburr_: "José" and "Jose" are the same person."""
    return _COMBINING.sub("", unicodedata.normalize("NFD", _js_str(value)))


@lru_cache(maxsize=16384)
def _norm(text: str) -> str:
    s = name_deburr(text).lower()
    s = _APOSTROPHES.sub("", s)
    s = _NOT_NAME.sub(" ", s)
    return _SPACES.sub(" ", s).strip(" ")


def name_norm(value: Any) -> str:
    """nameNorm_: lowercase, no accents, no punctuation, single spaces."""
    return _norm("" if value is None else _js_str(value))


@lru_cache(maxsize=16384)
def _tokens(text: str) -> tuple[tuple[str, ...], tuple[str, ...]]:
    everything = [t for t in _norm(text).split(" ") if t and t not in NAME_SUFFIXES]
    core = [t for t in everything if len(t) > 1]
    if not core:
        core = everything
    if len(core) > 1 and core[0] in NAME_NICKNAMES:
        core = [NAME_NICKNAMES[core[0]]] + core[1:]
    return tuple(everything), tuple(core)


def name_tokens(value: Any) -> dict[str, list[str]]:
    """nameTokens_: {all, core}."""
    everything, core = _tokens("" if value is None else _js_str(value))
    return {"all": list(everything), "core": list(core)}


def name_lev(a: str, b: str) -> int:
    """nameLev_: plain Levenshtein distance."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        ca = a[i - 1]
        for j in range(1, len(b) + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (0 if ca == b[j - 1] else 1))
        prev = cur
    return prev[len(b)]


def name_sim(a: str, b: str) -> float:
    """nameSim_: 0..1, a different first letter weighed down."""
    if a == b:
        return 1
    m = max(len(a), len(b))
    if not m:
        return 0
    sim = 1 - name_lev(a, b) / m
    if a[:1] != b[:1] and sim < 0.85:
        sim *= 0.75
    return 0 if sim < 0 else sim


@lru_cache(maxsize=65536)
def _score(a: str, b: str) -> float:
    a_core, b_core = _tokens(a)[1], _tokens(b)[1]
    if not a_core or not b_core:
        return 0
    an, bn = " ".join(a_core), " ".join(b_core)
    if an == bn:
        return 1
    a_first, a_last = a_core[0], a_core[-1]
    b_first, b_last = b_core[0], b_core[-1]
    if len(a_core) == 1 or len(b_core) == 1:
        return name_sim(an, bn)
    direct = (name_sim(a_first, b_first) + name_sim(a_last, b_last)) / 2
    swapped = (name_sim(a_first, b_last) + name_sim(a_last, b_first)) / 2 * 0.98
    score = max(direct, swapped)
    parts_hold = (min(name_sim(a_first, b_first), name_sim(a_last, b_last)) >= 0.7
                  or min(name_sim(a_first, b_last), name_sim(a_last, b_first)) >= 0.7)
    return max(score, name_sim(an, bn)) if parts_hold else score


def name_score(a: Any, b: Any) -> float:
    """nameScore_: how much two written names look like the same person, 0..1."""
    return _score("" if a is None else _js_str(a), "" if b is None else _js_str(b))


def name_best(typed: Any, items: list[Any], get_name: Callable[[Any], Any]) -> dict[str, Any]:
    """nameBest_: the one clear match or a refusal; the stable sort mirrors V8's."""
    scored = []
    for item in items:
        nm = get_name(item)
        if not name_norm(nm):
            continue
        scored.append({"item": item, "name": nm, "key": " ".join(name_tokens(nm)["core"]),
                       "score": name_score(typed, nm)})
    scored.sort(key=lambda x: -x["score"])
    best = scored[0] if scored else None
    if best is None or best["score"] < NAME_MATCH_MIN:
        return {"ok": False, "reason": "no match", "score": best["score"] if best else 0}
    runner = None
    for other in scored[1:]:
        if other["key"] == best["key"]:
            continue
        if name_score(best["name"], other["name"]) >= NAME_MATCH_MIN:
            continue
        runner = other
        break
    if runner and runner["score"] >= NAME_MATCH_MIN and best["score"] - runner["score"] < NAME_MATCH_GAP:
        return {"ok": False, "reason": "ambiguous", "score": best["score"],
                "candidates": [best["name"], runner["name"]]}
    return {"ok": True, "item": best["item"], "matched_name": best["name"], "key": best["key"],
            "score": best["score"]}


def client_name_key(value: Any) -> str:
    """Clients.gs clientNameKey_: letters and digits only."""
    return re.sub(r"[^a-z0-9]+", "", (_js_str(value) if value else "").lower())


# ── Cells ──
_SHEETS_EPOCH = date(1899, 12, 30)
_ISO_DAY = re.compile(r"^\s*(\d{4})-(\d{2})-(\d{2})(?!\d)")
_MDY_DAY = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\b")
_JS_DAY = re.compile(r"^\s*(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\b")
_MONTHS = {m: i + 1 for i, m in enumerate(
    ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}


def _day(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def reporting_day(value: Any, book_zone: str) -> date | None:
    """The date a reporting_date cell holds, cut and never converted: any offset or GMT tail is ignored."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if not 1.0 < float(value) < 2958465.0:
            return None
        return _SHEETS_EPOCH + timedelta(days=int(float(value) // 1))
    text = str(value).strip()
    if not text:
        return None
    m = _ISO_DAY.match(text)
    if m:
        return _day(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = _JS_DAY.match(text)
    if m and m.group(1).lower() in _MONTHS:
        return _day(int(m.group(3)), _MONTHS[m.group(1).lower()], int(m.group(2)))
    m = _MDY_DAY.match(text)
    if m:
        return _day(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    if re.fullmatch(r"\d{5}(?:\.\d+)?", text):
        return reporting_day(float(text), book_zone)
    return None


def category_label(category: str) -> str:
    key = category.strip().lower()
    if not key:
        return ""
    if key in CATEGORY_LABELS:
        return CATEGORY_LABELS[key]
    words = re.sub(r"[_\s]+", " ", key).strip()
    return words[:1].upper() + words[1:]


# ── Shifts ──
_CLOCK = re.compile(r"^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*$")
# Archive copies split an overnight at midnight; halves are rejoined within one copy only.
_HALF_END = 23 * 60 + 59
# Longer than a day is a misreading and is dropped; real doubles reach exactly this.
MAX_SHIFT_M = 24 * 60
# Which copy answers for a (person, day), first to last.
SCHEDULE_SOURCES = ("live", "archive", "parsed")


def clock_minutes(text: Any) -> int | None:
    """'14:30', '2:30:00 PM', '12:00:00 AM' → minutes after midnight."""
    m = _CLOCK.match(str(text if text is not None else ""))
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2))
    ampm = (m.group(4) or "").lower()
    if ampm:
        if not 1 <= hour <= 12:
            return None
        hour = hour % 12 + (12 if ampm == "pm" else 0)
    if hour > 24 or minute > 59 or (hour == 24 and minute):
        return None
    return hour * 60 + minute


def hhmm(minutes: int) -> str:
    return f"{(minutes // 60) % 24:02d}:{minutes % 60:02d}"


def shift_label(start_m: int, end_m: int) -> str:
    """The part of the day a scheduled shift is, read off its start hour."""
    hour = (start_m // 60) % 24
    if 5 <= hour <= 11:
        return "Morning"
    if 12 <= hour <= 17:
        return "Afternoon"
    if 18 <= hour <= 23:
        return "Overnight" if (end_m % 1440) < (start_m % 1440) else "Evening"
    return "Day"


def call_time_label(call_at: datetime) -> str:
    """The part of the day a call fell in, on the houses' clock."""
    local = call_at.astimezone(_zone(ESTATE_ZONE))
    minutes = local.hour * 60 + local.minute
    if 6 * 60 <= minutes < 14 * 60:
        return "Morning"
    if 14 * 60 <= minutes < 22 * 60:
        return "Afternoon"
    return "Overnight"


def _join_halves(shifts: list[dict]) -> list[dict]:
    """Dedupe, join overnight halves, dedupe again; one copy at a time so copies never cross-join."""
    def dedupe(items: list[dict]) -> list[dict]:
        seen: dict[tuple, dict] = {}
        for s in items:
            seen.setdefault((s["staff"], s["house"], s["date"], s["start_m"], s["end_m"]), s)
        return list(seen.values())

    items = sorted(dedupe(shifts), key=lambda s: (s["staff"], s["house"], s["date"], s["start_m"]))
    mornings = {(s["staff"], s["house"], s["date"]): s for s in items if s["start_m"] == 0}
    used: set[int] = set()
    out = []
    for s in items:
        if id(s) in used:
            continue
        if s["end_m"] == _HALF_END and s["start_m"] > 0:
            tail = mornings.get((s["staff"], s["house"], s["date"] + timedelta(days=1)))
            if tail is not None and id(tail) not in used:
                used.add(id(tail))
                s = dict(s, end_m=1440 + tail["end_m"])
        out.append(s)
    return dedupe([s for s in out if id(s) not in used])


_LIVE_COLUMNS = ("house", "staff_name", "shift_date", "shift_raw", "updated_at")


def _published_over(conn: Any, got: list[tuple] | None, wanted: list[date],
                    failed: list[str]) -> list[tuple] | None:
    """The live calendar's rows with published cells laid in (keep_empty); unreadable publishes mark it unread."""
    if got is None or not wanted:
        return got
    if _effective_roster is None:
        failed.append("The live calendar could not be read (its published cells cannot be laid).")
        return None
    rows = [dict(zip(_LIVE_COLUMNS, r)) for r in got]
    try:
        with conn.cursor() as cur:
            laid = _effective_roster.lay(cur, rows, min(wanted), max(wanted),
                                         table="asa_schedules", keep_empty=True)
    except Exception as exc:  # noqa: BLE001
        failed.append(f"The live calendar's published cells could not be read "
                      f"({type(exc).__name__}).")
        return None
    if laid is rows:
        return got
    days = set(wanted)
    return [tuple(r.get(k) for k in _LIVE_COLUMNS) for r in laid
            if not r.get("published") or r.get("shift_date") in days]


def _read_schedule(pg_dsn: str, days: set[date]) -> tuple[dict[str, Any], int]:
    """Scheduled shifts from live, archive and parsed copies; one copy answers per (person, day), in SCHEDULE_SOURCES order."""
    if psycopg2 is None:
        raise SourceError("The schedule could not be read (psycopg2 is not importable).")
    if not pg_dsn:
        raise SourceError("The schedule could not be read (no database is configured).")
    wanted = sorted({d + timedelta(days=k) for d in days for k in (-1, 0, 1)})
    names: dict[str, dict[str, int]] = {}
    raw: dict[str, list[dict]] = {src: [] for src in SCHEDULE_SOURCES}
    live_days: set[tuple[str, date]] = set()
    live_read = False
    failed: list[str] = []
    rows_read = 0

    def spelled(name: Any, count: int) -> str:
        display = " ".join(str(name or "").split())
        key = client_name_key(display)
        if key:
            names.setdefault(key, {})
            names[key][display] = names[key].get(display, 0) + int(count or 0)
        return key

    try:
        conn = psycopg2.connect(pg_dsn, connect_timeout=8)
    except Exception as exc:  # noqa: BLE001
        raise SourceError(f"The schedule could not be read ({type(exc).__name__}).") from exc
    try:
        conn.set_session(readonly=True, autocommit=True)

        def run(label: str, sql: str, params: tuple) -> list[tuple] | None:
            try:
                with conn.cursor() as cur:
                    cur.execute(sql, params)
                    return cur.fetchall()
            except Exception as exc:  # noqa: BLE001
                failed.append(f"{label} could not be read ({type(exc).__name__}).")
                return None

        got = run("The parsed calendar archive",
                  "select employee_name, count(*) from asa_schedule_parsed "
                  "where coalesce(employee_name, '') <> '' group by 1", ())
        if got is not None:
            for name, count in got:
                spelled(name, count)
            got = run("The parsed calendar archive",
                      "select employee_name, location_code, shift_date, start_time, end_time "
                      "from asa_schedule_parsed where shift_date = any(%s) "
                      "and coalesce(employee_name, '') <> ''", (wanted,))
            for name, house, day, start, end in got or []:
                rows_read += 1
                start_m, end_m = clock_minutes(start), clock_minutes(end)
                key = client_name_key(" ".join(str(name or "").split()))
                if key and house and day and start_m is not None and end_m is not None:
                    raw["parsed"].append({"staff": key, "house": str(house).strip(), "date": day,
                                          "start_m": start_m, "src": "parsed",
                                          "end_m": end_m if end_m >= start_m else end_m + 1440})

        spellings = sorted({d.strftime("%m/%d/%Y") for d in wanted}
                           | {f"{d.month}/{d.day}/{d.year}" for d in wanted})
        def from_copy(label: str, read: Callable[[], list[tuple]]) -> list[tuple] | None:
            try:
                return read()
            except Exception as exc:  # noqa: BLE001
                failed.append(f"{label} could not be read ({type(exc).__name__}).")
                return None

        got = from_copy("The Calendar Archive mirror", lambda: list(hub_rows.counts(
            CALENDAR_ARCHIVE_SHEET_ID, CALENDAR_ARCHIVE_TAB, "Employee").items()))
        if got is not None:
            for name, count in got:
                spelled(name, count)
            got = from_copy("The Calendar Archive mirror", lambda: [
                tuple(hub_rows.cell(d.get(h)) for h in ("Employee", "Location", "Date", "Start Time", "End Time"))
                for d in hub_rows.rows(CALENDAR_ARCHIVE_SHEET_ID, CALENDAR_ARCHIVE_TAB, where={"Date": spellings})])
            for name, location, day_text, start, end in got or []:
                rows_read += 1
                m = _MDY_DAY.match(str(day_text or ""))
                day = _day(int(m.group(3)), int(m.group(1)), int(m.group(2))) if m else None
                house = str(location or "").split(" - ")[-1].strip()
                start_m, end_m = clock_minutes(start), clock_minutes(end)
                key = client_name_key(" ".join(str(name or "").split()))
                if key and house and day and start_m is not None and end_m is not None:
                    raw["archive"].append({"staff": key, "house": house, "date": day,
                                           "start_m": start_m, "src": "archive",
                                           "end_m": end_m if end_m >= start_m else end_m + 1440})

        if _classify_cell is None:
            failed.append("The live calendar could not be read (its cell reader is not loaded).")
        else:
            got = run("The live calendar",
                      "select staff_name, count(*) from asa_schedules where tab_name = 'CALENDAR' "
                      "and coalesce(staff_name, '') <> '' group by 1", ())
            if got is not None:
                for name, count in got:
                    spelled(name, count)
                got = run("The live calendar",
                          "select house, staff_name, shift_date, shift_raw, updated_at "
                          "from asa_schedules where tab_name = 'CALENDAR' "
                          "and shift_date = any(%s) and coalesce(staff_name, '') <> ''",
                          (wanted,))
                got = _published_over(conn, got, wanted, failed)
                live_read = got is not None
                # The feed never deletes an edited cell's old row: the newest write wins.
                newest: dict[tuple, tuple] = {}
                for house, name, day, cell, updated in got or []:
                    rows_read += 1
                    key = client_name_key(" ".join(str(name or "").split()))
                    slot = (str(house or "").strip(), key, day)
                    stamp = updated.timestamp() if updated else 0.0
                    if key and slot[0] and day and (slot not in newest or stamp > newest[slot][0]):
                        newest[slot] = (stamp, cell)
                for (house, key, day), (_, cell) in newest.items():
                    # Any live cell claims the day, so no archive copy puts hours back under an OFF.
                    live_days.add((key, day))
                    parsed = _classify_cell(str(cell or ""))
                    if not parsed or parsed.get("start") is None or parsed.get("end") is None:
                        continue  # off, R/O, or a house token with no hours
                    raw["live"].append({"staff": key, "house": house, "date": day, "src": "live",
                                        "start_m": int(round(float(parsed["start"]) * 60)),
                                        "end_m": int(round(float(parsed["end"]) * 60))})
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass

    if len(failed) >= 3 or (not names and failed):
        raise SourceError(" ".join(failed))
    by_copy: dict[tuple[str, date], dict[str, list[dict]]] = {}
    for src in SCHEDULE_SOURCES:
        for s in _join_halves(raw[src]):
            if s["end_m"] - s["start_m"] > MAX_SHIFT_M:
                continue
            by_copy.setdefault((s["staff"], s["date"]), {}).setdefault(src, []).append(s)
    shifts: dict[tuple[str, date], list[dict]] = {}
    for pair, copies in by_copy.items():
        if pair in live_days:
            chosen = copies.get("live") or []
        else:
            chosen = copies.get("archive") or copies.get("parsed") or []
        if chosen:
            shifts[pair] = chosen
    display = {k: sorted(v.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] for k, v in names.items()}
    return {"names": display, "shifts": shifts, "failed": failed, "live_read": live_read}, rows_read


def _contains(shift: dict, local: datetime | None) -> bool:
    if local is None or shift["end_m"] <= shift["start_m"]:
        return False
    base = datetime(shift["date"].year, shift["date"].month, shift["date"].day)
    offset = (local - base).total_seconds() / 60.0
    return shift["start_m"] <= offset < shift["end_m"]


def _started(shift: dict) -> datetime:
    base = datetime(shift["date"].year, shift["date"].month, shift["date"].day)
    return base + timedelta(minutes=shift["start_m"])


def find_shift(staff_key: str, day: date | None, call_at: datetime | None,
               client_house: str, schedule: dict[str, Any] | None
               ) -> tuple[dict | None, bool | None, bool | None]:
    """(shift, at client's house, covers_call): only a shift whose window holds the call; without a call time, only a sole shift."""
    if not staff_key or day is None or not schedule:
        return None, None, None
    shifts = schedule["shifts"]

    def at_house(got: dict) -> bool | None:
        return (got["house"] == client_house) if client_house else None

    if call_at is not None:
        local = call_at.astimezone(_zone(ESTATE_ZONE)).replace(tzinfo=None)
        dates = {day}
        if abs((local.date() - day).days) <= 1:
            dates.add(local.date())
        dates |= {d - timedelta(days=1) for d in dates}
        holding = [s for d in sorted(dates) for s in shifts.get((staff_key, d), [])
                   if _contains(s, local)]
        if client_house and any(s["house"] == client_house for s in holding):
            holding = [s for s in holding if s["house"] == client_house]
        if not holding:
            return None, None, None
        got = max(holding, key=lambda s: (_started(s), s["end_m"], s["house"]))
        return got, at_house(got), True

    todays = list(shifts.get((staff_key, day), []))
    if client_house:
        mine = [s for s in todays if s["house"] == client_house]
        if len(mine) == 1:
            return mine[0], True, None
        if mine:
            return None, None, None
    if len(todays) == 1:
        return todays[0], at_house(todays[0]), None
    return None, None, None


# ── Sources ──
def _read_notes(svc: Any) -> tuple[dict[str, Any], int]:
    """The Notes tab, by column name, blank rows skipped, ids 'r' + sheet row."""
    if any(name in _NEVER_READ for name in NOTE_FIELDS.values()):
        raise ValueError("the caller's number was asked for in a notes read")
    zone, header = hotline_desk._meta(svc, NOTES)
    if any(name not in header for name in NOTE_FIELDS.values()):
        zone, header = hotline_desk._meta(svc, NOTES, refresh=True)
        missing = [name for name in NOTE_FIELDS.values() if name not in header]
        if missing:
            raise SourceError(f"The Staff Daily Notes book has no "
                              f"{', '.join(repr(m) for m in missing)} column.")
    rows = hotline_desk._read_columns(svc, NOTES, NOTE_FIELDS, required=())
    rows = [r for r in rows if any(_js_str(r.get(k)).strip() for k in NOTE_FIELDS)]
    return {"zone": zone, "rows": rows}, len(rows)


_COPIES = (hotline_desk.mirror_first.Copies("daily-notes")
           if getattr(hotline_desk, "mirror_first", None) is not None else None)


def _read_notes_first(svc: Any, pg_dsn: str) -> tuple[Any, ...]:
    """The Notes tab from the kept copy, the Postgres mirror, then Google; columns asked by name so caller_phone never leaves."""
    if any(name in _NEVER_READ for name in NOTE_FIELDS.values()):
        raise ValueError("the caller's number was asked for in a notes read")
    mf = getattr(hotline_desk, "mirror_first", None)
    if mf is None or _COPIES is None:
        return _read_notes(svc)

    def from_mirror(kept: dict[str, Any] | None) -> tuple[Any, int]:
        rows = mf.mirror_rows(pg_dsn, NOTES.sheet_id, NOTES.tab, NOTE_FIELDS,
                              refuse=_NEVER_READ, required=(), must_have=tuple(NOTE_FIELDS))
        rows = [r for r in rows if any(_js_str(r.get(k)).strip() for k in NOTE_FIELDS)]
        zone = hotline_desk.mirror_zone(NOTES, kept or _COPIES.get(NOTES.key),
                                        default=NOTES_DECLARED_ZONE)
        return {"zone": zone, "rows": rows}, len(rows)

    ans = mf.read(
        NOTES.key, _COPIES, label=NOTES.label, need_after=hotline_desk.news_at(),
        vouch=lambda: mf.vouch(pg_dsn, NOTES.sheet_id, NOTES.tab),
        from_mirror=from_mirror, from_live=lambda: _read_notes(svc),
        paused=lambda: (hotline_desk.quota_hold_sentence(NOTES.label)
                        if hotline_desk.quota_hold_left() > 0 else ""),
        fail=SourceError,
        sentence_of=lambda exc: (str(exc) if isinstance(exc, SourceError)
                                 else f"The daily notes could not be read ({type(exc).__name__})."))
    return {**ans.value, "as_of": ans.as_of}, ans.count, ans.stale


# Older than this, the shift flow is told the book cannot be vouched for.
WRITTEN_FRESH_S = float(os.getenv("HUB_DAILY_NOTES_WRITTEN_FRESH_S", "3600"))


def written_notes(pg_dsn: str, now: float | None = None) -> dict[str, Any]:
    """Who left a daily note and when, for rule 8; never asks Google, and a stale book answers ok False."""
    if any(name in _NEVER_READ for name in NOTE_FIELDS.values()):
        raise ValueError("the caller's number was asked for in a notes read")
    now = time.time() if now is None else now
    mf = getattr(hotline_desk, "mirror_first", None)
    kept = _COPIES.get(NOTES.key) if _COPIES is not None else None
    value, as_of, via = None, 0.0, ""
    if mf is not None and kept and now - float(kept.get("as_of") or 0.0) <= mf.MAX_AGE_S:
        value, as_of, via = kept.get("value"), float(kept.get("as_of") or 0.0), "copy"
    elif mf is not None:
        why = ""
        try:
            v = mf.vouch(pg_dsn, NOTES.sheet_id, NOTES.tab, max_age_s=WRITTEN_FRESH_S)
            if v.has and v.fresh:
                rows = mf.mirror_rows(pg_dsn, NOTES.sheet_id, NOTES.tab, NOTE_FIELDS,
                                      refuse=_NEVER_READ, required=(),
                                      must_have=tuple(NOTE_FIELDS))
                zone = hotline_desk.mirror_zone(NOTES, kept, default=NOTES_DECLARED_ZONE)
                value, as_of, via = {"zone": zone, "rows": rows}, float(v.as_of or 0.0), "mirror"
            else:
                why = v.why
        except Exception as exc:  # noqa: BLE001 — unreadable is not empty
            why = f"the mirror could not be read ({type(exc).__name__})"
        if value is None and kept:
            value, as_of, via = kept.get("value"), float(kept.get("as_of") or 0.0), "copy"
        if value is None:
            return {"ok": False, "notes": [], "as_of": 0.0, "via": "",
                    "why": why or "no copy of the Daily Notes book is kept"}
    else:
        return {"ok": False, "notes": [], "as_of": 0.0, "via": "",
                "why": "the mirror-first reader is not loaded"}
    if not as_of or now - as_of > WRITTEN_FRESH_S:
        return {"ok": False, "notes": [], "as_of": as_of, "via": via,
                "why": (f"the newest copy of the Daily Notes book is of "
                        f"{mf.stamp(as_of, now) if as_of else 'an unknown time'}")}
    zone = (value or {}).get("zone") or NOTES_DECLARED_ZONE
    out: list[dict[str, Any]] = []
    for r in (value or {}).get("rows") or []:
        category = _js_str(r.get("category")).strip()
        if category.lower() in NOT_DAILY:
            continue
        dsp = " ".join(_js_str(r.get("dsp_name")).split())
        if not dsp:
            continue
        call_at = parse_when(r.get("timestamp"), zone)
        day = reporting_day(r.get("reporting_date"), zone)
        out.append({"dsp_name": dsp, "call_at": iso_utc(call_at),
                    "day": day.isoformat() if day else ""})
    return {"ok": True, "notes": out, "as_of": as_of, "via": via, "why": ""}


def _read_clients(clients_path: str) -> tuple[list[dict[str, Any]], int]:
    try:
        with open(clients_path, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:  # noqa: BLE001
        raise SourceError(f"The clients list could not be read ({type(exc).__name__}).") from exc
    rows = data.get("rows") if isinstance(data, dict) else None
    if not isinstance(rows, list) or not rows:
        raise SourceError("The clients list carries no rows.")
    clients = [{"name": " ".join(str(r.get("name") or "").split()),
                "house": str(r.get("house") or "").strip()}
               for r in rows if isinstance(r, dict) and str(r.get("name") or "").strip()]
    if not clients:
        raise SourceError("The clients list carries no names.")
    return clients, len(clients)


def _health(result: tuple[Any, dict[str, Any], float]) -> dict[str, Any]:
    return dict(result[1])


def _version(obj: Any) -> str:
    blob = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def _health_for_version(sources: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {k: {"ok": v.get("ok"), "error": v.get("error")} for k, v in sources.items()}


# ── The book ──
def build_book(sheets: Any, pg_dsn: str, clients_path: str) -> dict[str, Any]:
    """Every note with its client and shift; the pass budget is cleared on exit because desk threads are reused."""
    t0 = time.time()
    hotline_desk._BUDGET.until = t0 + hotline_desk.PASS_BUDGET_S
    try:
        return _build_book(sheets, pg_dsn, clients_path, t0)
    finally:
        hotline_desk._BUDGET.until = None


def _build_book(sheets: Any, pg_dsn: str, clients_path: str, t0: float) -> dict[str, Any]:
    with hotline_desk._Lent(sheets) as svc:
        notes_res = hotline_desk._serve("daily_notes", lambda: _read_notes_first(svc, pg_dsn))
    clients_res = hotline_desk._serve("daily_clients", lambda: _read_clients(clients_path))
    if notes_res[0] is None:
        raise BookUnavailable(notes_res[1]["error"] + " No note can be shown until it has been "
                              "read once.")
    book_zone = notes_res[0].get("zone") or NOTES_DECLARED_ZONE
    source_at = float(notes_res[0].get("as_of") or 0.0)
    clients: list[dict] | None = clients_res[0]

    parsed = []
    days: set[date] = set()
    for r in notes_res[0]["rows"]:
        day = reporting_day(r.get("reporting_date"), book_zone)
        call_at = parse_when(r.get("timestamp"), book_zone)
        # No readable reporting_date: use the call's own day, as Hotline.gs would.
        call_day = call_at.astimezone(_zone(ESTATE_ZONE)).date() if call_at else None
        lookup_day = day or call_day
        if lookup_day:
            days.add(lookup_day)
        if lookup_day and call_day and abs((call_day - lookup_day).days) <= 1:
            days.add(call_day)
        parsed.append((r, day, call_at, lookup_day))

    schedule_res = hotline_desk._serve("daily_schedule", lambda: _read_schedule(pg_dsn, days))
    schedule = schedule_res[0]
    sources = {"notes": _health(notes_res), "clients": _health(clients_res),
               "schedule": _health(schedule_res)}
    if schedule is not None and schedule.get("failed"):
        sources["schedule"]["ok"] = False
        sources["schedule"]["error"] = " ".join(x for x in (
            sources["schedule"]["error"], *schedule["failed"],
            "Shifts only those copies hold are shown by call time.",
            "" if schedule.get("live_read") else
            "Until the live calendar is read, the archive copies answer for the days it would "
            "have answered for.") if x)
    if clients is None:
        sources["clients"]["error"] = " ".join(x for x in (
            sources["clients"]["error"], "No note is matched to a client until it can be read.") if x)

    by_key: dict[str, dict] = {}
    for c in clients or []:
        by_key.setdefault(client_name_key(c["name"]), c)
    client_memo: dict[str, tuple[dict | None, str]] = {}

    def match_client(written: str) -> tuple[dict | None, str]:
        if written in client_memo:
            return client_memo[written]
        key = client_name_key(written)
        got: tuple[dict | None, str] = (None, "none")
        if clients is not None and key:
            if key in by_key:
                got = (by_key[key], "exact")
            else:
                best = name_best(written, clients, lambda c: c["name"])
                if best["ok"]:
                    got = (best["item"], "similar")
        client_memo[written] = got
        return got

    staff_names = (schedule or {}).get("names") or {}
    staff_list = sorted(staff_names.values())
    staff_memo: dict[str, tuple[str, str]] = {}

    def match_staff(written: str) -> tuple[str, str]:
        if written in staff_memo:
            return staff_memo[written]
        key = client_name_key(written)
        got = ("", "")
        if key and key in staff_names:
            got = (key, "exact")
        elif key and staff_list:
            best = name_best(written, staff_list, lambda n: n)
            if best["ok"]:
                got = (client_name_key(best["matched_name"]), "similar")
        staff_memo[written] = got
        return got

    notes: list[dict[str, Any]] = []
    repeats: dict[str, int] = {}
    for r, day, call_at, lookup_day in parsed:  # sheet order: repeats count top down
        written = " ".join(_js_str(r.get("client_name")).split())
        dsp = " ".join(_js_str(r.get("dsp_name")).split())
        category = _js_str(r.get("category")).strip()
        call_id = _js_str(r.get("call_id")).strip()
        reporting = day.isoformat() if day else ""
        content = "|".join((call_id, category, dsp, reporting))
        n = repeats.get(content, 0)
        repeats[content] = n + 1
        client, how = match_client(written)
        staff_key, staff_how = match_staff(dsp) if schedule is not None else ("", "")
        shift, at_house, covers = find_shift(staff_key, lookup_day, call_at,
                                             (client or {}).get("house") or "", schedule)
        if shift is not None:
            shift_out = {"via": "schedule", "label": shift_label(shift["start_m"], shift["end_m"]),
                         "start": hhmm(shift["start_m"]), "end": hhmm(shift["end_m"]),
                         "date": shift["date"].isoformat(), "source": shift["src"],
                         "house": shift["house"], "at_client_house": at_house,
                         "covers_call": covers, "staff_match": staff_how}
        elif call_at is not None:
            shift_out = {"via": "call_time", "label": call_time_label(call_at), "start": "",
                         "end": "", "date": "", "source": "", "house": "", "at_client_house": None,
                         "covers_call": None, "staff_match": staff_how}
        else:
            shift_out = {"via": "none", "label": "", "start": "", "end": "", "date": "",
                         "source": "", "house": "", "at_client_house": None, "covers_call": None,
                         "staff_match": staff_how}
        notes.append({
            "id": f"r{int(r['_row'])}",
            "key": hashlib.sha1(f"{content}|{n}".encode("utf-8")).hexdigest()[:16],
            "call_id": call_id,
            "reporting_date": reporting,
            "call_at": iso_utc(call_at),
            "dsp_name": dsp,
            "category": category,
            "category_label": category_label(category),
            "kind": "not_daily" if category.lower() in NOT_DAILY else "daily",
            "response": _js_str(r.get("response")).strip(),
            "client": (client or {}).get("name") or "",
            "client_match": how,
            "written_as": written,
            "shift": shift_out,
        })

    notes.sort(key=lambda n: (n["reporting_date"], n["call_at"], int(n["id"][1:])), reverse=True)

    if clients is None:
        unmatched: dict[str, Any] = {"rows": None, "names": None}
    else:
        missed = [n for n in notes if n["client_match"] == "none" and n["written_as"]]
        unmatched = {"rows": len(missed),
                     "names": len({client_name_key(n["written_as"]) or n["written_as"] for n in missed})}

    payload = {
        "built_at": iso_utc(datetime.now(timezone.utc)),
        "source_at": iso_utc(datetime.fromtimestamp(source_at, timezone.utc)) if source_at else "",
        "version": _version({"notes": notes, "unmatched": unmatched,
                             "sources": _health_for_version(sources)}),
        "notes": notes,
        "unmatched": unmatched,
        "sources": sources,
    }
    counts = {
        "rows": len(notes),
        "exact": sum(1 for n in notes if n["client_match"] == "exact"),
        "similar": sum(1 for n in notes if n["client_match"] == "similar"),
        "none": sum(1 for n in notes if n["client_match"] == "none"),
        "via_schedule": sum(1 for n in notes if n["shift"]["via"] == "schedule"),
        "via_call_time": sum(1 for n in notes if n["shift"]["via"] == "call_time"),
        "via_none": sum(1 for n in notes if n["shift"]["via"] == "none"),
        "covers_call": sum(1 for n in notes if n["shift"]["covers_call"] is True),
    }
    timings = {"notes": round(notes_res[2]), "clients": round(clients_res[2]),
               "schedule": round(schedule_res[2]), "total": round((time.time() - t0) * 1000)}
    log.info("daily notes book: %d notes (%d exact, %d similar, %d unmatched), shifts %d by "
             "schedule (%d holding the call) / %d by call time / %d none, sources %s, %d ms",
             counts["rows"], counts["exact"], counts["similar"], counts["none"],
             counts["via_schedule"], counts["covers_call"], counts["via_call_time"],
             counts["via_none"],
             ",".join(f"{k}={'ok' if v['ok'] else 'FAILED'}" for k, v in sources.items()),
             timings["total"])
    return {"payload": payload, "clients": clients, "counts": counts, "timings": timings,
            "source_at": source_at}


def client_view(book: dict[str, Any], client: str) -> dict[str, Any]:
    """GET /hub-lanes/clients/daily: the notes matched to one client."""
    payload = book["payload"]
    clients = book.get("clients")
    if clients is None:
        raise BookUnavailable(payload["sources"]["clients"]["error"]
                              or "The clients list could not be read.")
    wanted = " ".join(str(client or "").split())
    row = next((c for c in clients if c["name"] == wanted), None)
    if row is None:
        key = client_name_key(wanted)
        same = [c for c in clients if key and client_name_key(c["name"]) == key]
        row = same[0] if len({c["name"] for c in same}) == 1 else None
    if row is None:
        raise ClientNotFound(wanted)
    notes = [n for n in payload["notes"] if n["client"] == row["name"]]
    return {
        "client": row["name"],
        "built_at": payload["built_at"],
        "version": _version({"client": row["name"], "notes": notes,
                             "unmatched": payload["unmatched"],
                             "sources": _health_for_version(payload["sources"])}),
        "notes": notes,
        "unmatched": dict(payload["unmatched"]),
        "sources": payload["sources"],
    }


# ── The in-process cache: single-flight ── `from` is when the held notes are of (source_at), never when the build…
_BOOK: dict[str, Any] = {"book": None, "at": 0.0, "from": 0.0, "task": None, "task_from": 0.0,
                         "failed_at": 0.0, "failure": ""}


def _landed(task: "asyncio.Future", started: float = 0.0) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is None:
        book = task.result()
        _BOOK["book"], _BOOK["at"], _BOOK["failure"] = book, time.time(), ""
        _BOOK["from"] = float((book or {}).get("source_at") or 0.0) or started
        return
    _BOOK["failed_at"] = time.time()
    _BOOK["failure"] = (str(exc) if isinstance(exc, BookUnavailable)
                        else f"The daily notes could not be read ({type(exc).__name__}).")
    log.warning("daily notes book build failed: %s", _BOOK["failure"])


def _start_book(sheets: Any, pg_dsn: str, clients_path: str, started: float,
                after: "asyncio.Future | None" = None) -> "asyncio.Future":
    """Start the one build, after `after` ends when given."""
    async def run() -> dict[str, Any]:
        if after is not None:
            try:
                # shielded: an ask that goes away never cancels a build others await
                await asyncio.shield(after)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - its failure is its own (_landed); this one builds
                pass
        return await hotline_desk.run_on_desk(build_book, sheets, pg_dsn, clients_path)

    task = asyncio.ensure_future(run())
    task.add_done_callback(lambda t: _landed(t, started))
    _BOOK["task"], _BOOK["task_from"] = task, started
    return task


async def current_book(sheets: Any, pg_dsn: str, clients_path: str,
                       max_age_s: float = BOOK_MAX_AGE_S) -> dict[str, Any]:
    """Single-flight rebuild on the desk's threads (never the default executor /auth uses); a held book always answers."""
    now = time.time()
    held = _BOOK["book"]
    # A filing newer than the held book makes it stale, whatever its age.
    news = float(hotline_desk.news_at()) if hasattr(hotline_desk, "news_at") else 0.0
    if held is not None and now - _BOOK["at"] < max_age_s and _BOOK["from"] >= news:
        return held
    task = _BOOK["task"]
    # A build started before the news cannot hold it: chain a new one after it.
    before_news = task is not None and not task.done() and float(_BOOK["task_from"]) < news
    if task is None or task.done() or before_news:
        paused = hotline_desk.quota_hold_left() > 0
        if held is not None and paused:
            return held
        if (not before_news and held is None and _BOOK["failure"]
                and (now - _BOOK["failed_at"] < BOOK_RETRY_S or paused)):
            raise BookUnavailable(_BOOK["failure"])
        task = _start_book(sheets, pg_dsn, clients_path, now, after=task if before_news else None)
    if held is not None:
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=hotline_desk.HELD_WAIT_S)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - a slow or failed build: the held copy answers
            return held
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        if isinstance(exc, BookUnavailable):
            raise
        raise BookUnavailable(f"The daily notes could not be read ({type(exc).__name__}).") from exc


# ── Who may read a client's notes, beyond the Clients badge ── GUARDIAN and CLIENT are badges in `types`, not…
CLIENTS_REFUSED_TYPES = frozenset({"GUARDIAN", "CLIENT"})


def types_refusal(pg_dsn: str, core_sheet_id: str, uid: str, fresh_s: float, *,
                  is_master: bool | None = None, sheets: Any = None) -> dict[str, Any] | None:
    """None, or a 403 envelope when the recorded types carry a client/guardian badge; blocking, fails closed."""
    def refused(reason: str, message: str) -> dict[str, Any]:
        return {"status": 403, "reason": reason, "message": message}

    if is_master is True:
        return None
    mirror_read = getattr(hotline_desk, "_core_from_mirror", None)
    live_read = getattr(hotline_desk, "_core_live", None)
    words = getattr(hotline_desk, "_words", None)
    if mirror_read is None or live_read is None or words is None:
        return refused("unreadable", "The access record cannot be read on this server, so the "
                       "door stays closed.")
    if not str(uid or "").strip():
        return refused("session", "This session carries no account, so the door stays closed.")
    said = refused("restricted", "Staff daily notes are not open to an account that is, or "
                   "speaks for, a client.")

    def speaks_for_a_client(user: dict[str, Any]) -> bool:
        return bool(CLIENTS_REFUSED_TYPES & set(words(user.get("types"))))

    mirror: dict[str, Any] | None = None
    mirror_error = ""
    try:
        mirror = mirror_read(pg_dsn, core_sheet_id, uid, "clients")
    except Exception as exc:  # noqa: BLE001 - the live copy may still answer
        mirror_error = f"The access record could not be read ({type(exc).__name__})."
    if mirror is not None and mirror.get("user") is not None:
        if speaks_for_a_client(mirror["user"]):
            return said
        if (mirror.get("sync_ok") and mirror.get("age_s") is not None
                and mirror["age_s"] <= fresh_s):
            return None
    try:
        got, live_error = live_read(sheets or hotline_desk.sheets_client, core_sheet_id, fresh_s)
    except Exception as exc:  # noqa: BLE001 - a check that throws stays shut
        got, live_error = None, f"The Core book could not be read ({type(exc).__name__})."
    if got is not None:
        user = (got.get("users") or {}).get(str(uid))
        if user is None:
            return refused("session", "This account is not in the access record, so the door "
                           "stays closed.")
        return said if speaks_for_a_client(user) else None
    if mirror is None:
        return refused("unreadable", f"{mirror_error} {live_error} So the door stays closed.")
    if mirror.get("user") is None:
        return refused("unreadable", "This account is not in the access copy yet, and the live "
                       f"check could not be made: {live_error} So the door stays closed.")
    return refused("stale", "The access record is too old to vouch for this account's badges, "
                   f"and the live check could not be made: {live_error} So the door stays closed.")


if __name__ == "__main__":  # a read-only probe: counts and health — never words, names or numbers
    import sys
    from collections import Counter

    logging.basicConfig(level=logging.INFO)
    _dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not _dsn:
        sys.exit("HUB_SNAPSHOT_PG_DSN is not set")
    built = build_book(hotline_desk.sheets_client, _dsn,
                       os.path.join(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"), "clients.json"))
    p = built["payload"]
    print(json.dumps({
        "counts": built["counts"], "timings_ms": built["timings"], "sources": p["sources"],
        "unmatched": p["unmatched"], "kinds": Counter(n["kind"] for n in p["notes"]),
        "version": p["version"],
    }, indent=2, default=str))
