"""Time Reconciliation's worked side and periods, read from the Hub's own PsiAnywhere record.

The punches are the full punches house (bk1ttZRJPsiPunchesFull: one row per Single_Entry_ID, kept by the attendance
lane and PSI Log's collection), shaped as the detectors' punches (recon_detect.punch_for_detect's keys). Each place is
named by PsiAnywhere's own location table, as PSI Log's collection keeps it (app.psi_harvest places.locations ID→Name,
places.time-entry locationID→shortDescription). A name two codes share goes to the one a house calendar holds.

PsiAnywhere's pay periods (14 days, Sunday to Saturday) are app/psi_periods.py's, re-exported here.

PsiAnywhere splits a shift at midnight (…11:59:59 PM, then 12:00:00 AM…) and writes one entry per consumer for the same
minutes: `punches` stitches the first back into one shift (under its start day) and folds the second into one punch with
every consumer; `worked` keeps each day's own minutes (the split is already the day boundary) and counts a person's
overlapping minutes once."""
from __future__ import annotations

import json
import re
from datetime import timedelta
from typing import Any

import gsjs
import recon_detect as D
import recon_roster as RO
from psi_periods import (PERIOD_ANCHOR, PERIOD_DAYS, day_of, label, period, period_of_id,  # noqa: F401 - re-exported
                         period_start, periods, today_ny, week_start)

PUNCHES = "bk1ttZRJPsiPunchesFull"
# PsiAnywhere's statuses that are not worked time: R rejected, D duplicate
NOT_WORKED = frozenset({"R", "D"})
# the minute-of-day an entry PsiAnywhere split at midnight ends on, and the next one starts on
DAY_END, DAY_START = 1440, 0
GENERAL_ADMIN = "000GEN"
_SPACE = re.compile(r"\s+")

s_ = gsjs.str_


# ---- places --------------------------------------------------------------------------------------------------------

def place_key(name: Any) -> str:
    """A PsiAnywhere location name as compared: lower case, one space."""
    return _SPACE.sub(" ", s_(name).strip().lower())


def _cells(v: Any) -> dict[str, Any]:
    if isinstance(v, dict):
        return v
    try:
        got = json.loads(v or "{}")
    except (TypeError, ValueError):
        return {}
    return got if isinstance(got, dict) else {}


def house_codes(reads: Any) -> set[str]:
    """The codes of the houses whose calendars the roster reads (the live copy's labels)."""
    _alias, code_of = RO.house_aliases([lab for lab, _g in RO.calendars(reads)])
    return set(code_of.values())


def place_map(reads: Any) -> dict[str, str]:
    """PsiAnywhere location name (place_key) → house code, off PSI Log's collection of its location table."""
    def read() -> dict[str, str]:
        got = reads.db.query(
            "select l.cells->>'Name', t.cells->>'shortDescription' from app.psi_harvest l"
            " join app.psi_harvest t on t.kind = 'places.time-entry' and t.cells->>'locationID' = l.cells->>'ID'"
            " where l.kind = 'places.locations'")
        calendars = house_codes(reads)
        codes: dict[str, set[str]] = {}
        for name, code in got:
            if s_(name).strip() and s_(code).strip():
                codes.setdefault(place_key(name), set()).add(s_(code).strip())
        out = {}
        for key, cs in codes.items():
            held = sorted(c for c in cs if c in calendars)
            out[key] = held[0] if held else sorted(cs)[0]
        return out
    return reads.once("recon_psi:places", read)


def house_of(site: Any, kept: Any, places: dict[str, str]) -> str:
    """The house a PsiAnywhere entry was worked at: its location's code; else, for a place PsiAnywhere's table does not
    name, the house the stored copy kept; else Not Found. General Admin is Not Found (no house)."""
    code = places.get(place_key(site), "")
    if code == GENERAL_ADMIN:
        return D.NOT_FOUND
    if code:
        return code
    old = s_(kept).strip()
    return old if old else D.NOT_FOUND


# ---- entries -------------------------------------------------------------------------------------------------------

def consumers_of(c: dict[str, Any]) -> str:
    """Every consumer of an entry, 'First Last, First Last' — PsiAnywhere writes each 'First, Last' and joins them with
    '; ', and the detectors split on ','."""
    names = [s_(c.get(f"consumer_{n}")).strip() for n in (1, 2, 3)]
    names = [x for x in names if x]
    if not names:
        names = [x.strip() for x in s_(c.get("consumers")).split(";") if x.strip()]
    out: list[str] = []
    for n in names:
        flat = _SPACE.sub(" ", n.replace(",", " ")).strip()
        if flat and flat not in out:
            out.append(flat)
    return ", ".join(out)


def _hours(v: Any) -> float:
    t = s_(v).strip().replace(",", ".")
    try:
        return float(t) if t else 0.0
    except ValueError:
        return 0.0


def rows(reads: Any, day_from: str, day_to: str) -> list[dict[str, Any]]:
    """The house's entries whose service day is in [day_from, day_to], one per entry id, worked statuses only."""
    got = reads.db.query(
        "select cells from app.resource_rows where resource = %s and removed_at is null"
        " and cells->>'date_iso' between %s and %s", (PUNCHES, day_from, day_to))
    seen: dict[str, dict[str, Any]] = {}
    for (cells,) in got:
        c = _cells(cells)
        eid = s_(c.get("single_entry_id") or c.get("id")).strip()
        if not eid or s_(c.get("status")).strip().upper() in NOT_WORKED:
            continue
        seen[eid] = c
    return [seen[k] for k in sorted(seen, key=lambda k: (s_(seen[k].get("date_iso")), k))]


def entry(c: dict[str, Any], places: dict[str, str], people: list[dict[str, str]], fp: int) -> dict[str, Any]:
    """One PsiAnywhere entry in the detectors' shape, with its own facts beside them."""
    name = s_(c.get("employee")).strip() or gsjs.trim(s_(c.get("firstname")) + " " + s_(c.get("lastname")))
    who = RO.resolve(name, people, fp)
    start, end = s_(c.get("start_time")).strip(), s_(c.get("end_time")).strip()
    return {"date": s_(c.get("date_iso")).strip(), "matchKey": who["key"],
            "employeeId": who["id"] if who["ok"] else "", "employeeName": who["name"] if who["ok"] else name,
            "location": house_of(c.get("location_name"), c.get("house"), places),
            "startMin": D.parse_time_min(start), "endMin": D.parse_time_min(end), "startTime": start,
            "endTime": end, "consumers": consumers_of(c), "hours": _hours(c.get("hours")),
            "entryIds": [s_(c.get("single_entry_id") or c.get("id")).strip()], "status": s_(c.get("status")).strip(),
            "workCode": s_(c.get("work_code")).strip(), "site": s_(c.get("location_name")).strip(),
            "peopleId": s_(c.get("people_id")).strip()}


def _joined(*lists: str) -> str:
    names = [x.strip() for part in lists for x in part.split(",") if x.strip()]
    return ", ".join(dict.fromkeys(names))


def _merge_same(ps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One punch per person, day, house and minutes: PsiAnywhere's one-entry-per-consumer copies folded, every consumer
    and entry id kept."""
    out: dict[tuple, dict[str, Any]] = {}
    for p in ps:
        k = (p["matchKey"], p["date"], p["location"], p["startMin"], p["endMin"])
        got = out.get(k)
        if got is None:
            out[k] = {**p, "entryIds": list(p["entryIds"])}
            continue
        got["consumers"] = _joined(got["consumers"], p["consumers"])
        got["entryIds"] += [e for e in p["entryIds"] if e not in got["entryIds"]]
    return list(out.values())


def _stitch(ps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A shift PsiAnywhere split at midnight made whole again, under the day it started: an entry ending at the day's
    end, and the same person's entry at the same house starting at 12:00 AM the next day."""
    starts: dict[tuple, list[int]] = {}
    for i, p in enumerate(ps):
        if p["startMin"] == DAY_START:
            starts.setdefault((p["matchKey"], p["location"], p["date"]), []).append(i)
    used: set[int] = set()
    out = []
    for i, p in enumerate(ps):
        if i in used:
            continue
        d = day_of(p["date"])
        if p["endMin"] == DAY_END and d is not None and p["startMin"] not in (None, DAY_START):
            nxt = (d + timedelta(days=1)).isoformat()
            j = next((j for j in starts.get((p["matchKey"], p["location"], nxt), ()) if j not in used and j != i),
                     None)
            if j is not None:
                q = ps[j]
                used.add(j)
                p = {**p, "endMin": q["endMin"], "endTime": q["endTime"], "hours": round(p["hours"] + q["hours"], 2),
                     "consumers": _joined(p["consumers"], q["consumers"]), "entryIds": p["entryIds"] + q["entryIds"],
                     "stitched": True}
        out.append(p)
    return out


def punches(reads: Any, day_from: str, day_to: str) -> list[dict[str, Any]]:
    """The punches the detectors read for [day_from, day_to], from PsiAnywhere's record: per-consumer copies folded,
    midnight splits stitched (the day after the range is read so a shift starting on its last day is whole)."""
    a, b = day_of(day_from), day_of(day_to)
    if a is None or b is None or b < a:
        return []
    people, fp = RO.roster(reads)
    places = place_map(reads)
    raw = [entry(c, places, people, fp) for c in rows(reads, a.isoformat(), (b + timedelta(days=1)).isoformat())]
    whole = _stitch(_merge_same([p for p in raw if p["date"]]))
    return [p for p in whole if a.isoformat() <= p["date"] <= b.isoformat()]


# ---- worked time ---------------------------------------------------------------------------------------------------

def union_minutes(spans: list[tuple[int, int]]) -> int:
    """The minutes a set of [start, end) spans covers, each minute once."""
    total, cur_a, cur_b = 0, 0, None
    for a, b in sorted(spans):
        if cur_b is None or a > cur_b:
            if cur_b is not None:
                total += cur_b - cur_a
            cur_a, cur_b = a, b
        else:
            cur_b = max(cur_b, b)
    if cur_b is not None:
        total += cur_b - cur_a
    return total


def worked(reads: Any, day_from: str, day_to: str) -> dict[str, dict[str, Any]]:
    """Each person's worked hours per day in [day_from, day_to], from PsiAnywhere's entries: a day's minutes are its own
    entries' (PsiAnywhere already splits at midnight), a person's overlapping minutes counted once, every work code
    (ADMIN and TRAIN too). An entry with no clock-out adds no minutes and is listed as open.

    → {matchKey: {"employeeId", "employeeName", "days": {iso: hours}, "open": [entry], "entries": [entry]}}"""
    a, b = day_of(day_from), day_of(day_to)
    if a is None or b is None or b < a:
        return {}
    people, fp = RO.roster(reads)
    places = place_map(reads)
    out: dict[str, dict[str, Any]] = {}
    spans: dict[tuple[str, str], list[tuple[int, int]]] = {}
    for c in rows(reads, a.isoformat(), b.isoformat()):
        e = entry(c, places, people, fp)
        if not e["date"]:
            continue
        who = out.setdefault(e["matchKey"], {"employeeId": e["employeeId"], "employeeName": e["employeeName"],
                                              "days": {}, "open": [], "entries": []})
        who["entries"].append(e)
        if e["startMin"] is None or e["endMin"] is None:
            who["open"].append(e)
            continue
        spans.setdefault((e["matchKey"], e["date"]), []).append((e["startMin"], D.overnight(e["startMin"],
                                                                                            e["endMin"])))
    for (key, day), ss in spans.items():
        out[key]["days"][day] = round(union_minutes(ss) / 60, 2)
    return out
