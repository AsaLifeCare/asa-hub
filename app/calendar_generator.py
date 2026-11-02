"""Calendar Builder generator (the relay's server/calendar_generator.py): stages draft cells into empty cells only;
OPEN and placeholder rows are never staffed. The grid is the one asa-hub-db keeps (calendar_builder_write)."""
from __future__ import annotations

import logging
import re
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, NamedTuple

import ist_config
import lanes_db as hub_db
import shift_slices
from calendar_builder_slices import (
    PREFS_TAB, _mirror_rows, ESTATE_TZ,
)
from calendar_builder_write import (
    DRAFT_DDL, PERIODS_DDL, _grid_context, _cell_text, _draft_map, _fold, nights_before, time_off_windows,
)

log = logging.getLogger("hub.calendarbuilder.generate")

FULL_TIME_WEEK_H = 40.0

# A wrong preference is worse than none: a kind is asserted only when every word before it was understood.
_KIND_SHIFT = {  # preference word → (the estate's spelling, the cell kinds it covers)
    "night": ("10P-8A", ("overnight",)),
    "midnight": ("10P-8A", ("overnight",)),
    "overnight": ("10P-8A", ("overnight",)),
    "afternoon": ("230P-10P", ("afternoon", "evening")),
    "evening": ("230P-10P", ("afternoon", "evening")),
    "day": ("7A-230P", ("day", "morning")),
    "morning": ("7A-230P", ("day", "morning")),
}
_DAY_WEEKDAY = {
    "monday": 0, "mon": 0, "tuesday": 1, "tue": 1, "tues": 1,
    "wednesday": 2, "wed": 2, "thursday": 3, "thu": 3, "thur": 3,
    "friday": 4, "fri": 4, "saturday": 5, "sat": 5, "sunday": 6, "sun": 6,
}
_DENY = frozenset({"no", "not", "never", "non", "none", "cannot", "cant",
                   "without", "except"})
_DAY_OFF = frozenset({"off"})
_ANY = frozenset({"any", "anything", "all", "whatever", "flexible", "open"})
_FILLER = frozenset({
    "a", "am", "an", "and", "at", "after", "also", "before", "both", "but",
    "can", "do", "either", "for", "get", "gets", "hour", "hours", "i", "in",
    "is", "just", "like", "me", "my", "need", "needs", "of", "on", "only",
    "or", "p", "please", "plus", "pm", "prefer", "preference", "preferred",
    "prefers", "s", "shift", "shifts", "the", "to", "week", "weeks",
    "weekend", "weekends", "will", "work", "working", "works", "would",
})
# A comma or "and" does not end a denial: "no mon, tue and wed" denies all three.
_BREAK = frozenset(".;:/()[]-\n")
_WORD = re.compile(r"[a-z]+|\d+|[.;:/()\[\]\-\n]")


class _Read(NamedTuple):
    asserted: tuple[tuple[str, tuple[str, ...]], ...]
    refused: frozenset[str]
    days_off: frozenset[int]
    names_days: bool            # a weekday stands beside an asserted shift
    says_any: bool


def _read(text: str) -> _Read:
    """One preference field → what it says, and nothing it does not say."""
    asserted: list[tuple[str, tuple[str, ...]]] = []
    refused: set[str] = set()
    days_off: set[int] = set()
    names_days = says_any = False
    clause_read = True          # every word since the last break was understood
    denying = False
    span: list[str] = []
    span_read = True

    def close() -> None:
        nonlocal denying, span, span_read
        if denying and span_read:
            kinds = [w for w in span if w in _KIND_SHIFT]
            days = [w for w in span if w in _DAY_WEEKDAY]
            # A denial naming both a kind and a day ("no Fridays on afternoons") yields nothing.
            if not (kinds and days):
                for w in kinds:
                    refused.update(_KIND_SHIFT[w][1])
                for w in days:
                    days_off.add(_DAY_WEEKDAY[w])
        denying, span, span_read = False, [], True

    for raw in _WORD.findall((text or "").lower().replace("'", "")):
        if raw in _BREAK:
            close()
            clause_read = True
            continue
        word = raw[:-1] if len(raw) > 3 and raw.endswith("s") else raw
        was_read = (word in _KIND_SHIFT or word in _DAY_WEEKDAY or word in _FILLER
                    or word in _ANY or word in _DENY or word in _DAY_OFF
                    or raw.isdigit())
        if denying:
            span.append(word)
            span_read = span_read and was_read
        says_any = says_any or word in _ANY
        if word in _DENY or word in _DAY_OFF:
            close()
            denying = True
            continue
        if not denying:
            if word in _KIND_SHIFT and clause_read:
                asserted.append(_KIND_SHIFT[word])
            elif word in _DAY_WEEKDAY:
                names_days = True
        clause_read = clause_read and was_read
    close()
    return _Read(tuple(asserted), frozenset(refused), frozenset(days_off),
                 names_days, says_any)


def _pref_shift(shifts_text: str) -> tuple[str | None, frozenset[str]]:
    """(fallback shift, refused kinds); the fallback is the first kind written, None whenever uncertain."""
    read = _read(shifts_text)
    if read.says_any or read.names_days:
        return None, read.refused
    for spelling, kinds in read.asserted:
        if not read.refused.intersection(kinds):
            return spelling, read.refused
    return None, read.refused


def _pref_days_off(*texts: str) -> set[int]:
    """NOTE is read only for days off: a day off can only make the generator do less."""
    out: set[int] = set()
    for text in texts:
        out |= _read(text).days_off
    return out


# The role words are the IST settings' coverage labels (ist_non_person_names / _contains).
def _role_words() -> tuple[frozenset[str], tuple[str, ...]]:
    names, words = ist_config.held_labels()
    return frozenset(n.lower() for n in names), tuple(w.lower() for w in words)


# FAMILY and Nurse rows are typed as staff, so a person is recognised by a two-word name.
def _is_person(row: dict) -> bool:
    if row["rowType"] != "staff":
        return False  # OPEN and WORKSHOP: coverage slots, never staffed here
    parts = [p for p in re.split(r"[^A-Za-z']+", row["employee"] or "") if p]
    if len(parts) < 2:
        return False  # one word is a role, not somebody's name
    names, words = _role_words()
    return not any(p.lower() in names or any(w in p.lower() for w in words) for p in parts)


def _own_shift(cells: list[dict]) -> str | None:
    """The shift text worked most often this period, in the house's own spelling."""
    counts: Counter = Counter()
    for c in cells:
        got = shift_slices.classify(c["text"]) if c["text"] else None
        if got and got.get("start") is not None:
            counts[c["text"]] += 1
    return counts.most_common(1)[0][0] if counts else None


def _interval(date_iso: str, got: dict) -> tuple[datetime, datetime]:
    """A cell's absolute interval: its day plus its hours, so 20.0-32.25 ends the next morning."""
    day = datetime.strptime(date_iso, "%Y-%m-%d")
    return day + timedelta(hours=float(got["start"])), day + timedelta(hours=float(got["end"]))


def generate(dsn: str, actor: str) -> dict:
    ctx = _grid_context()
    if not ctx["period_start"]:
        return {"status": 502, "message": "the grid has no period to fill"}
    draft = _draft_map(dsn, ctx["period_start"])
    try:
        before = {k: [e["span"] for e in v] for k, v in nights_before(dsn, ctx["period_start"]).items()}
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: the first morning cannot be checked against the night before
        return {"status": 503, "message": f"the live calendars could not be read ({type(exc).__name__}), so the "
                                          f"night before the period cannot be checked — nothing was generated"}

    prefs_rows, _ = _mirror_rows(dsn, PREFS_TAB)
    prefs = {str(r.get("Select Your Name") or "").strip().lower(): r for r in prefs_rows}
    today = datetime.now(ESTATE_TZ).date()
    try:
        scheduled, pending = time_off_windows(dsn)
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: nobody is placed over time off that could not be read
        return {"status": 503, "message": f"the time off could not be read ({type(exc).__name__}) — "
                                          f"nothing was generated"}
    days_off: dict[str, list[tuple]] = {}
    asked: dict[str, list[tuple]] = {}
    for bucket, source in ((days_off, scheduled), (asked, pending)):
        for name, start, end in source:
            if _fold(name) and start and end and end >= today:
                bucket.setdefault(_fold(name), []).append((start, end))

    def over(windows: list[tuple], d, got: dict) -> bool:
        s = datetime.combine(d, datetime.min.time()) + timedelta(hours=got["start"])
        e = datetime.combine(d, datetime.min.time()) + timedelta(hours=got["end"])
        return any(s < datetime.combine(b + timedelta(days=1), datetime.min.time())
                   and datetime.combine(a, datetime.min.time()) < e for a, b in windows)

    # Live grid AND draft, so two generated cells never collide either.
    busy: dict[str, list[tuple[datetime, datetime]]] = {k: list(v) for k, v in before.items()}
    weekly_hours: dict[str, Counter] = {}
    for row in ctx["rows"]:
        if not _is_person(row):
            continue
        person = row["employee"].strip().lower()
        for cell in row["cells"]:
            key = (row["sheetRow"], cell["date"])
            text = draft[key]["value"] if key in draft else cell["text"]
            got = shift_slices.classify(text) if text else None
            if got and got.get("start") is not None:
                busy.setdefault(_fold(row["employee"]), []).append(_interval(cell["date"], got))
                sat = datetime.strptime(cell["date"], "%Y-%m-%d").date()
                sat = sat - timedelta(days=(sat.weekday() + 2) % 7)
                weekly_hours.setdefault(person, Counter())[sat.isoformat()] += \
                    got["end"] - got["start"]

    staged = 0
    skipped_conflict = skipped_loaded = skipped_refused = skipped_asked = 0
    with hub_db.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(DRAFT_DDL)
        cur.execute(PERIODS_DDL)
        cur.execute(
            "INSERT INTO asa_cal_builder_periods (period_start) VALUES (%s) "
            "ON CONFLICT DO NOTHING", (ctx["period_start"],))

        def stage(row: dict, date_iso: str, value: str) -> None:
            cur.execute(
                "INSERT INTO asa_cal_builder_draft "
                "(period_start, sheet_row, date_iso, house, employee, value, base_value, updated_by) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (period_start, sheet_row, date_iso) DO UPDATE "
                "SET value = EXCLUDED.value, base_value = EXCLUDED.base_value, "
                "updated_at = now(), updated_by = EXCLUDED.updated_by",
                (ctx["period_start"], row["sheetRow"], date_iso, row["house"],
                 row["employee"], value, _cell_text(ctx, row["sheetRow"], date_iso),
                 f"generator ({actor})"))

        for row in ctx["rows"]:
            if not _is_person(row):
                continue
            person = row["employee"].strip().lower()
            pref = prefs.get(person, {})
            shifts_text = str(pref.get("SHIFTS") or "")
            no_days = _pref_days_off(shifts_text, str(pref.get("NOTE") or ""))
            fallback, refused = _pref_shift(shifts_text)
            usual = _own_shift(row["cells"]) or fallback
            if usual and refused:
                # the row's own habit is not consent to a refused kind
                got = shift_slices.classify(usual)
                if got and got.get("kind") in refused:
                    skipped_refused += 1
                    usual = None
            for cell in row["cells"]:
                key = (row["sheetRow"], cell["date"])
                current = draft[key]["value"] if key in draft else cell["text"]
                if current.strip():
                    continue  # never touch a cell that already says something
                d = datetime.strptime(cell["date"], "%Y-%m-%d").date()
                sat = (d - timedelta(days=(d.weekday() + 2) % 7)).isoformat()
                pkey = _fold(row["employee"])
                req = next((r for r in days_off.get(pkey, []) if r[0] <= d <= r[1]), None)
                if req:
                    stage(row, cell["date"], "R/O")
                    staged += 1
                    continue
                if any(r[0] <= d <= r[1] for r in asked.get(pkey, [])):
                    skipped_asked += 1
                    continue
                if d.weekday() in no_days:
                    continue
                if not usual:
                    continue
                if weekly_hours.get(person, Counter()).get(sat, 0.0) >= FULL_TIME_WEEK_H:
                    skipped_loaded += 1
                    continue
                got = shift_slices.classify(usual)
                if not got or got.get("start") is None:
                    continue
                if over(days_off.get(pkey, []), d, got):
                    skipped_conflict += 1
                    continue
                if over(asked.get(pkey, []), d, got):
                    skipped_asked += 1
                    continue
                s, e = _interval(cell["date"], got)
                if any(a < e and s < b for a, b in busy.get(pkey, [])):
                    skipped_conflict += 1
                    continue
                stage(row, cell["date"], usual)
                staged += 1
                busy.setdefault(pkey, []).append((s, e))
                weekly_hours.setdefault(person, Counter())[sat] += got["end"] - got["start"]
        conn.commit()
    log.info("calendar-builder: generator staged %d cells (%d conflicts avoided, "
             "%d full-week skips, %d rows left blank over a refused shift) by %s",
             staged, skipped_conflict, skipped_loaded, skipped_refused, actor)
    return {"status": 200, "data": {
        "staged": staged,
        "skippedConflicts": skipped_conflict,
        "skippedFullWeeks": skipped_loaded,
        "skippedRefusedShift": skipped_refused,
        "skippedTimeOffAsked": skipped_asked,
        "period": ctx["period_start"],
        "note": "Everything is a draft edit — review the grid, then Publish.",
    }}
