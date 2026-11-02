"""Per-person reachable window and suggested supervisor from the cortex; never a contact value, never a decision."""
from __future__ import annotations

import re
from typing import Any

import psycopg2
import psycopg2.extras

RESOURCES = ("commRoutes",)

FACT_TYPES = ("contact", "schedule_entry")

# Substring match: real sources are long composites like "cortex|synthetic_inject:…".
SYNTHETIC_MARKS = ("synthetic", "bank_teaching", "sandbox", "fixture")

_TIME = re.compile(r"(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])[Mm]")

# Mirrors COMM_POLICY_FLOOR in CommPolicy.gs; if the floor moves, move it here too.
PLATFORM_QUIET_FROM = 21
PLATFORM_QUIET_TO = 8

CLOCK_MIN_ENTRIES = 5

CLOCK_NIGHT_BEFORE = 6
CLOCK_FINISH_FROM, CLOCK_FINISH_TO = 4, 12

CLOCK_SLEEP_HOURS = 8

CLOCK_MIN_NIGHTS = 3

CLOCK_MIN_REACH = 3


def _key(v: Any) -> str:
    """`clientNameKey_` — the platform's own flattened name."""
    return re.sub(r"[^a-z0-9]+", "", str(v or "").strip().lower())


def _synthetic(source: Any) -> bool:
    s = str(source or "").lower()
    return any(m in s for m in SYNTHETIC_MARKS)


def _hour24(raw: str) -> int | None:
    m = _TIME.search(raw or "")
    if not m:
        return None
    hour = int(m.group(1)) % 12
    if m.group(3).lower() == "p":
        hour += 12
    return hour


def _minute_of_day(raw: str) -> int | None:
    m = _TIME.search(raw or "")
    if not m:
        return None
    hour = int(m.group(1)) % 12
    if m.group(3).lower() == "p":
        hour += 12
    return hour * 60 + int(m.group(2))


def _safe_window(lo: Any, hi: Any) -> tuple[int, int] | None:
    """Clamp inside the permitted band; the Hub takes min/max, so a pair outside it deletes the quiet hours."""
    try:
        lo, hi = int(lo), int(hi)
    except (TypeError, ValueError):
        return None
    lo = max(PLATFORM_QUIET_TO, lo)
    hi = min(PLATFORM_QUIET_FROM, hi)
    if hi <= lo:
        return None
    return lo, hi


def routes(dsn: str) -> dict[str, dict]:
    """Every person the cortex can name, with the shift hours it holds, by key."""
    out: dict[str, dict] = {}
    with psycopg2.connect(dsn) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT entity_name, fact_type, fact_value, source, state, needs_resolution "
            "FROM asa_entity_facts WHERE fact_type = ANY(%s) "
            # superseded shifts still count as evidence of waking hours; only contacts need 'active'
            "AND (fact_type <> 'contact' OR coalesce(state, 'active') = 'active') "
            "ORDER BY (needs_resolution IS TRUE), id", (list(FACT_TYPES),))
        for r in cur.fetchall():
            if _synthetic(r["source"]):
                continue
            who = _key(r["entity_name"])
            if not who:
                continue
            slot = out.setdefault(who, {
                "person_key": who, "name": str(r["entity_name"] or ""),
                "starts": [], "ends": [],
            })
            if r["fact_type"] == "contact":
                # Presence only; the text is never parsed, contacts belong to contacts_slices.
                continue
            text = str(r["fact_value"] or "")
            # Rows are split mid-value ("End Time: 8" / "0 PM"), so start and end are read apart.
            for label, bucket in (("start", "starts"), ("end", "ends")):
                m = re.search(label + r"[^:]*:\s*([^|\n]+)", text, re.I)
                if not m:
                    continue
                h = _hour24(m.group(1))
                if h is not None:
                    slot[bucket].append(h)
    return out


def clock(dsn: str) -> dict[str, dict]:
    """Worked/slept 24-hour rings per person, counted in days since PsiAnywhere cuts nights at midnight."""
    rings: dict[str, dict] = {}
    with psycopg2.connect(dsn) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        # No status filter: the question is hours, not payroll.
        cur.execute(
            "SELECT employee, people_id, date_service, start_time, end_time "
            "FROM asa_psi_time_entries "
            "WHERE coalesce(start_time, '') <> '' AND coalesce(end_time, '') <> ''")
        rows = cur.fetchall()

    # Grouped by people_id, published under every name key the person was filed as.
    by_day: dict[str, dict[str, list[tuple[int, int]]]] = {}
    names: dict[str, dict[str, str]] = {}
    for r in rows:
        who = str(r["people_id"] or "").strip() or _key(r["employee"])
        key = _key(r["employee"])
        if not who or not key:
            continue
        start = _minute_of_day(str(r["start_time"] or ""))
        end = _minute_of_day(str(r["end_time"] or ""))
        if start is None or end is None or end <= start:
            continue
        names.setdefault(who, {})[key] = str(r["employee"] or "")
        by_day.setdefault(who, {}).setdefault(
            str(r["date_service"] or ""), []).append((start, end))

    for who, days in by_day.items():
        worked = [0] * 24
        slept = [0] * 24
        nights = 0
        entries = sum(len(v) for v in days.values())
        for spans in days.values():
            hours = set()
            for start, end in spans:
                for h in range(start // 60, (end - 1) // 60 + 1):
                    hours.add(h % 24)
            for h in hours:
                worked[h] += 1
            tails = [e for s, e in spans if s < CLOCK_NIGHT_BEFORE * 60]
            if not tails:
                continue
            finish = max(tails) // 60
            if not CLOCK_FINISH_FROM <= finish <= CLOCK_FINISH_TO:
                continue
            nights += 1
            for k in range(CLOCK_SLEEP_HOURS):
                slept[(finish + k) % 24] += 1
        slot = {"worked": worked, "slept": slept,
                "entries": entries, "days": len(days), "nights": nights}
        for key, shown in names[who].items():
            rings[key] = dict(slot, person_key=key, name=shown)
    return rings


def _clock_window(slot: dict) -> dict:
    """The permitted band with night-finish sleep eaten from the front only."""
    entries = int(slot.get("entries") or 0)
    if entries < CLOCK_MIN_ENTRIES:
        return {"from": None, "to": None, "source": "clock",
                "why": f"the clock holds only {entries} entry(s) for them — not a pattern"}
    worked = slot.get("worked") or [0] * 24
    slept = slot.get("slept") or [0] * 24
    lo, hi = PLATFORM_QUIET_TO, PLATFORM_QUIET_FROM
    asleep = []
    while lo < hi and slept[lo] >= CLOCK_MIN_NIGHTS and slept[lo] > worked[lo]:
        asleep.append(lo)
        lo += 1
    lo = min(lo, PLATFORM_QUIET_FROM - CLOCK_MIN_REACH)
    safe = _safe_window(lo, hi)
    if not safe:
        return {"from": None, "to": None, "source": "clock",
                "why": "the clock leaves them no reachable hour"}
    lo, hi = safe
    nights = int(slot.get("nights") or 0)
    if not asleep:
        why = (f"measured on the clock: {entries} shift(s) over "
               f"{int(slot.get('days') or 0)} day(s), none of them ending a night "
               f"in the morning — the platform's own hours stand")
    else:
        why = (f"measured on the clock: {nights} night(s) finishing in the "
               f"morning out of {int(slot.get('days') or 0)} day(s), so "
               f"{asleep[0]}:00-{asleep[-1] + 1}:00 is when they sleep; "
               f"reachable {lo}:00-{hi}:00")
    return {"from": lo, "to": hi, "source": "clock", "why": why}


# MANAGED_BY edges are regex-extracted, so both ends must resolve to a known person.
SUPERVISOR_FLOOR = 0.80
SUPERVISOR_MIN_SEEN = 3
_SUPERVISOR_JUNK = ("por ", "is ", "addressing ", "the ", "a ", "de ")


def supervisors(dsn: str, known: dict[str, str]) -> dict[str, dict]:
    """person_key -> {name, confidence, seen} for the best edge whose both ends are in `known`."""
    out: dict[str, dict] = {}
    with psycopg2.connect(dsn) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT entity_a, entity_b, confidence, occurrence_count "
            "FROM asa_entity_relationships WHERE relation_type = 'MANAGED_BY' "
            "AND confidence >= %s AND coalesce(occurrence_count, 0) >= %s "
            "ORDER BY confidence DESC, occurrence_count DESC",
            (SUPERVISOR_FLOOR, SUPERVISOR_MIN_SEEN))
        for r in cur.fetchall():
            who, boss = str(r["entity_a"] or ""), str(r["entity_b"] or "")
            if any(boss.lower().startswith(j) for j in _SUPERVISOR_JUNK):
                continue
            wk, bk = _key(who), _key(boss)
            if not wk or not bk or wk == bk:
                continue
            if wk not in known or bk not in known:
                continue
            if wk in out:
                continue
            out[wk] = {"name": known[bk], "key": bk,
                       "confidence": round(float(r["confidence"] or 0), 2),
                       "seen": int(r["occurrence_count"] or 0)}
    return out


def window_of(slot: dict) -> dict:
    """Awake span from parsed prose, widened an hour each side; the weaker source."""
    starts = sorted(slot.get("starts") or [])
    ends = sorted(slot.get("ends") or [])
    if not starts and not ends:
        return {"from": None, "to": None, "source": "facts",
                "why": "the cortex holds no shift for them"}
    seen = len(starts) + len(ends)
    safe = _safe_window((starts[0] if starts else 8) - 1,
                        (ends[-1] if ends else 20) + 1)
    if not safe:
        return {"from": None, "to": None, "source": "facts",
                "why": "the parsed shift falls outside the platform's own hours — the default stands"}
    lo, hi = safe
    return {"from": lo, "to": hi, "source": "facts",
            "why": f"parsed from the graph's prose: awake {lo}:00-{hi}:00, "
                   f"from {seen} shift record(s)"}


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    """The slice: one row per person the cortex has a window or a boss for."""
    if resource not in RESOURCES:
        raise ValueError(f"Unknown resource {resource!r}")
    found = routes(dsn)
    try:
        rings = clock(dsn)
    except Exception:  # noqa: BLE001 — the PsiAnywhere table is frozen, not guaranteed
        rings = {}

    for who, ring in rings.items():
        if who not in found:
            found[who] = {"person_key": who, "name": ring["name"],
                          "starts": [], "ends": []}

    known = {k: str(v.get("name") or "") for k, v in found.items()}
    try:
        bosses = supervisors(dsn, known)
    except Exception:  # noqa: BLE001 — a graph that cannot be read suggests nobody
        bosses = {}
    rows = []
    for who, slot in found.items():
        # The clock wins; the parsed window is the fallback when the clock refuses.
        win = _clock_window(rings[who]) if who in rings else window_of(slot)
        if win["from"] is None and who in rings:
            fallback = window_of(slot)
            if fallback["from"] is not None:
                fallback["why"] = fallback["why"] + " (" + win["why"] + ")"
                win = fallback
        boss = bosses.get(who) or {}
        if win["from"] is None and not boss:
            continue
        rows.append({
            "id": "RT_" + who[:40],
            "person_key": who,
            "name": slot["name"],
            "window_from": "" if win["from"] is None else win["from"],
            "window_to": "" if win["to"] is None else win["to"],
            "window_why": win["why"],
            # commRoutesIngest copies fields one by one: adding this to COMM_ROUTES_HEADER alone leaves it empty.
            "window_source": win.get("source", ""),
            "supervisor": boss.get("name", ""),
            "supervisor_key": boss.get("key", ""),
            "supervisor_confidence": boss.get("confidence", ""),
        })
    rows.sort(key=lambda r: r["person_key"])
    return rows, None


if __name__ == "__main__":
    import json
    import os
    import sys

    _dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not _dsn:
        sys.exit("HUB_SNAPSHOT_PG_DSN is not set")
    _rows, _ = build("commRoutes", _dsn)
    _rings = clock(_dsn)
    print(json.dumps({
        "rows": len(_rows),
        "named_by_the_graph": len(routes(_dsn)),
        "named_by_the_clock": len(_rings),
        "with_window": sum(1 for r in _rows if r["window_from"] != ""),
        "measured_window": sum(1 for r in _rows if r["window_source"] == "clock"
                               and r["window_from"] != ""),
        "parsed_window": sum(1 for r in _rows if r["window_source"] == "facts"
                             and r["window_from"] != ""),
        "narrowed_by_sleep": sum(1 for r in _rows if r["window_source"] == "clock"
                                 and r["window_from"] != ""
                                 and int(r["window_from"]) > PLATFORM_QUIET_TO),
        "clock_refused": sum(1 for k in _rings
                             if _clock_window(_rings[k])["from"] is None),
        "with_supervisor": sum(1 for r in _rows if r["supervisor"]),
    }, indent=1))
