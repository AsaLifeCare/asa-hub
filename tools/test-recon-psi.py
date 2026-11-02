#!/usr/bin/env python3
"""
TIME RECONCILIATION ON PSIANYWHERE'S RECORD, asserted offline against the real functions.

  periods     PsiAnywhere's pay periods: 14 days, Sunday to Saturday, on the grid its Imported batches follow (06-07,
              08-02, 10-11, 10-25 start one); their text ("10/25/26 – 11/07/26"); their two weeks; the twelve before the
              current one; an id that is not one of the grid's Sundays refused
  the record  recon_psi's punches out of the full punches house: every consumer of an entry joined; the place by
              PsiAnywhere's own location table (General Admin is no house; a name two codes share goes to the one with
              a calendar); the per-consumer copies folded; a shift split at midnight stitched, never across houses;
              rejected and duplicate entries out; worked hours with a person's overlapping minutes counted once
  detectors   one dupe card per cluster of overlapping punches (never n(n-1)/2); a missing shift judged only on a day
              with entries at a real house and at a house the run holds, saying where its person punched instead; gaps
              found day by day; an overlap only past the staff the roster planned; the roster's placeholder rows
              skipped
  today       a run judged in the middle of a day (the record's last change, never past now): a shift is judged only
              an hour after it is over, a person still on the clock (an open entry under 16 hours old) is no missing
              end and covers their shift — an overnight one stitched to an open 12:00 AM entry too
  the run     its range (the current pay period by default, 35 days at most, refusals in plain words); the period's
              text; the two periods the daily run covers; the anomaly key a resolution is carried by; a decimal comma
              read as a point on the workbook path

HOW IT STAYS OFFLINE. The modules are imported from app/ and every read goes through a stand-in: the reads' memo holds
the roster and the calendars, and the stand-in database answers the two queries recon_psi asks from rows in hand.
Nothing reaches Postgres, PsiAnywhere or Google.

    python3 tools/test-recon-psi.py
"""
from __future__ import annotations

import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))

import psi_periods as PP  # noqa: E402
import recon as R  # noqa: E402
import recon_detect as D  # noqa: E402
import recon_psi as PSI  # noqa: E402
import recon_report as REP  # noqa: E402
import recon_roster as RO  # noqa: E402

out: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: object = "") -> None:
    out.append((name, bool(ok), "" if ok else str(detail)[:400]))


# ---- the stand-ins -------------------------------------------------------------------------------------------------

PEOPLE = [{"id": "P1", "name": "Jane Doe"}, {"id": "P2", "name": "Rick Roe"}, {"id": "P3", "name": "Ann Poe"}]
PLACES = [("1711 48th St NW", "ABD1711"), ("2005 38th St", "ABD2005"), ("General Admin", "000GEN"),
          ("4060 Orchard Dale Dr NW", "TO4060"), ("4060 Orchard Dale Dr NW", "BM4060")]


def grid(days: list[str], rows: list[tuple[str, list[str]]]) -> dict:
    return {"cols": [{"iso": d} for d in days], "rows": [{"employee": e, "cells": cells} for e, cells in rows]}


CALENDARS = [("CAN - 48TH - ABD1711", grid([], [])), ("CAN - 38TH - ABD2005", grid([], [])),
             ("BM - ORCHARD - BM4060", grid([], []))]


class DB:
    def __init__(self, entries: list[dict]) -> None:
        self.entries = entries

    def query(self, sql: str, params: tuple = ()) -> list[tuple]:
        if "psi_harvest" in sql:
            return list(PLACES)
        if "resource_rows" in sql and params and params[0] == PSI.PUNCHES:
            return [(c,) for c in self.entries if params[1] <= c["date_iso"] <= params[2]]
        raise AssertionError("a query the stand-in does not answer: " + sql[:80])


class Reads:
    def __init__(self, entries: list[dict] | None = None, calendars: list | None = None) -> None:
        self.db = DB(entries or [])
        self.now = datetime(2026, 10, 29, 16, 0, tzinfo=timezone.utc)
        self.memo = {"recon:roster": (PEOPLE, hash(tuple((p["id"], p["name"]) for p in PEOPLE))),
                     "recon:calendars": calendars if calendars is not None else CALENDARS}

    def once(self, name: str, read):  # noqa: ANN001
        if name not in self.memo:
            self.memo[name] = read()
        return self.memo[name]


_seq = [0]


def entry(day: str, who: str, start: str, end: str, site: str = "1711 48th St NW", consumer: str = "Smith, Ann",
          status: str = "P", hours: str = "8.00") -> dict:
    _seq[0] += 1
    return {"single_entry_id": f"E{_seq[0]}", "date_iso": day, "employee": who, "start_time": start,
            "end_time": end, "hours": hours, "location_name": site, "status": status, "consumer_1": consumer,
            "work_code": "HPC"}


# ---- periods -------------------------------------------------------------------------------------------------------

def periods() -> None:
    starts = [PP.period_start(d).isoformat() for d in (date(2026, 6, 7), date(2026, 6, 20), date(2026, 8, 10),
                                                         date(2026, 10, 24), date(2026, 10, 25), date(2026, 11, 7))]
    check("the grid starts its periods on 06-07, 08-02, 10-11 and 10-25 (each day lands in its own)",
          starts == ["2026-06-07", "2026-06-07", "2026-08-02", "2026-10-11", "2026-10-25", "2026-10-25"], starts)
    cur = PP.period(date(2026, 10, 29), date(2026, 10, 29))
    check("the current period is P2026-10-25: 10-25 to 11-07, PsiAnywhere's text, current",
          (cur["id"], cur["from"], cur["to"], cur["label"], cur["current"]) ==
          ("P2026-10-25", "2026-10-25", "2026-11-07", "10/25/26 – 11/07/26", True), cur)
    check("its two weeks run Sunday to Saturday",
          cur["weeks"] == [{"from": "2026-10-25", "to": "2026-10-31", "label": "10/25/26 – 10/31/26"},
                           {"from": "2026-11-01", "to": "2026-11-07", "label": "11/01/26 – 11/07/26"}], cur["weeks"])
    check("a label is MM/DD/YY – MM/DD/YY", PP.label(date(2026, 10, 11), date(2026, 10, 24)) == "10/11/26 – 10/24/26")
    ps = PP.periods(date(2026, 10, 29))
    check("thirteen periods, newest first, only the first current, each 14 days apart",
          len(ps) == 13 and ps[0]["id"] == "P2026-10-25" and ps[1]["id"] == "P2026-10-11"
          and ps[-1]["id"] == "P2026-05-10" and [p["current"] for p in ps].count(True) == 1 and ps[0]["current"],
          [p["id"] for p in ps])
    check("a grid Sunday is a period id; any other day, or no P, is refused",
          (PP.period_of_id("P2026-10-25", date(2026, 10, 29)) or {}).get("to") == "2026-11-07"
          and PP.period_of_id("P2026-10-26", date(2026, 10, 29)) is None
          and PP.period_of_id("P2026-10-18", date(2026, 10, 29)) is None
          and PP.period_of_id("2026-10-25", date(2026, 10, 29)) is None
          and PP.period_of_id("Pnope", date(2026, 10, 29)) is None)
    check("a week starts on its Sunday", [PP.week_start(date(2026, 10, d)).isoformat() for d in (25, 29, 31)] ==
          ["2026-10-25"] * 3)
    check("New York's day, not UTC's", PP.today_ny(datetime(2026, 10, 30, 3, 0, tzinfo=timezone.utc)) ==
          date(2026, 10, 29))
    check("recon_psi re-exports the grid", PSI.period is PP.period and PSI.periods is PP.periods)


# ---- the record ----------------------------------------------------------------------------------------------------

def record() -> None:
    check("every consumer of an entry, 'First Last', joined with ', ' and each once",
          PSI.consumers_of({"consumer_1": "Smith, Ann", "consumer_2": "Lee, Bo", "consumer_3": "Smith, Ann"})
          == "Smith Ann, Lee Bo"
          and PSI.consumers_of({"consumers": "Smith, Ann; Lee,  Bo"}) == "Smith Ann, Lee Bo"
          and PSI.consumers_of({}) == "")
    reads = Reads()
    places = PSI.place_map(reads)
    check("a place is named by PsiAnywhere's code (case and spacing aside)",
          PSI.house_of("1711  48TH st nw", "", places) == "ABD1711")
    check("General Admin (000GEN) is no house", PSI.house_of("General Admin", "ABD1711", places) == D.NOT_FOUND)
    check("a name two codes share goes to the one a house calendar holds",
          PSI.house_of("4060 Orchard Dale Dr NW", "", places) == "BM4060", places)
    check("a place the table does not name keeps the stored copy's house, else Not Found",
          PSI.house_of("Somewhere Else", "XY12", places) == "XY12"
          and PSI.house_of("Somewhere Else", "", places) == D.NOT_FOUND)

    a = PSI.entry(entry("2026-10-12", "Jane Doe", "08:00:00 AM", "04:00:00 PM", consumer="Smith, Ann"), places,
                  PEOPLE, 1)
    b = PSI.entry(entry("2026-10-12", "Jane Doe", "08:00:00 AM", "04:00:00 PM", consumer="Lee, Bo"), places, PEOPLE, 1)
    merged = PSI._merge_same([a, b])
    check("an entry is the detectors' punch: the person resolved, the house, the minutes",
          (a["matchKey"], a["employeeId"], a["location"], a["startMin"], a["endMin"]) ==
          ("P1", "P1", "ABD1711", 480, 960), a)
    check("PsiAnywhere's per-consumer copies fold into one punch with every consumer and entry id",
          len(merged) == 1 and merged[0]["consumers"] == "Smith Ann, Lee Bo" and len(merged[0]["entryIds"]) == 2,
          merged)

    night = PSI.entry(entry("2026-10-12", "Jane Doe", "11:00:00 PM", "11:59:59 PM", hours="1.00"), places, PEOPLE, 1)
    tail = PSI.entry(entry("2026-10-13", "Jane Doe", "12:00:00 AM", "07:00:00 AM", hours="7.00"), places, PEOPLE, 1)
    away = PSI.entry(entry("2026-10-13", "Jane Doe", "12:00:00 AM", "07:00:00 AM", site="2005 38th St", hours="7.00"),
                     places, PEOPLE, 1)
    whole = PSI._stitch([night, tail])
    check("a shift split at midnight is whole again, under the day it started",
          len(whole) == 1 and whole[0]["date"] == "2026-10-12" and whole[0]["endMin"] == 420
          and whole[0]["hours"] == 8.0 and whole[0].get("stitched") is True and len(whole[0]["entryIds"]) == 2, whole)
    apart = PSI._stitch([night, away])
    check("never across houses", len(apart) == 2 and not any(p.get("stitched") for p in apart), apart)

    rows = [entry("2026-10-12", "Jane Doe", "11:00:00 PM", "11:59:59 PM", hours="1.00"),
            entry("2026-10-13", "Jane Doe", "12:00:00 AM", "07:00:00 AM", hours="7.00"),
            entry("2026-10-12", "Rick Roe", "08:00:00 AM", "04:00:00 PM", status="R"),
            entry("2026-10-12", "Rick Roe", "09:00:00 AM", "05:00:00 PM", status="D"),
            entry("2026-10-12", "Ann Poe", "08:00:00 AM", "12:00:00 PM", status="I")]
    got = PSI.punches(Reads(rows), "2026-10-12", "2026-10-12")
    check("the range's punches: the next day read to stitch, then left out; R and D never; I counts",
          sorted((p["employeeName"], p["startTime"], p["endTime"]) for p in got) ==
          [("Ann Poe", "08:00:00 AM", "12:00:00 PM"), ("Jane Doe", "11:00:00 PM", "07:00:00 AM")], got)
    check("a range backwards or not days reads nothing",
          PSI.punches(Reads(rows), "2026-10-13", "2026-10-12") == [] and PSI.punches(Reads(rows), "x", "y") == [])

    check("union minutes count each minute once", PSI.union_minutes([(0, 60), (30, 90), (120, 180)]) == 150
          and PSI.union_minutes([]) == 0 and PSI.union_minutes([(10, 20), (20, 30)]) == 20)
    w = PSI.worked(Reads([entry("2026-10-12", "Jane Doe", "08:00:00 AM", "04:00:00 PM"),
                          entry("2026-10-12", "Jane Doe", "02:00:00 PM", "06:00:00 PM", site="2005 38th St"),
                          entry("2026-10-13", "Jane Doe", "08:00:00 AM", ""),
                          entry("2026-10-13", "Rick Roe", "08:00:00 AM", "12:00:00 PM", status="R")]),
                   "2026-10-12", "2026-10-13")
    jane = w.get("P1") or {}
    check("worked hours: a person's overlapping minutes once, an open entry listed and adding nothing, R out",
          jane.get("days") == {"2026-10-12": 10.0} and len(jane.get("open") or []) == 1 and "P2" not in w, w)


# ---- the detectors -------------------------------------------------------------------------------------------------

CFG = {"gapMin": 5, "overlapMin": 45, "missingCoveragePct": 15}


def punch(day: str, key: str, name: str, loc: str, a: int | None, b: int | None, consumers: str = "") -> dict:
    return {"date": day, "matchKey": key, "employeeId": key if not key.startswith("name:") else "",
            "employeeName": name, "location": loc, "startMin": a, "endMin": b, "startTime": D.min_to_time(a),
            "endTime": D.min_to_time(b), "consumers": consumers, "hours": 0}


def shift(day: str, key: str, name: str, loc: str, a: int, b: int) -> dict:
    return {"date": day, "matchKey": key, "employeeId": key, "employeeName": name, "location": loc, "startMin": a,
            "endMin": b, "startTime": D.min_to_time(a), "endTime": D.min_to_time(b), "raw": ""}


def detectors() -> None:
    copies = [punch("2026-10-12", "P1", "Jane Doe", "ABD2005", 480, 960) for _ in range(3)]
    copies.append(punch("2026-10-12", "P1", "Jane Doe", "ABD1711", 840, 1320))
    copies.append(punch("2026-10-12", "P1", "Jane Doe", "ABD1711", 1380, 1430))
    got = D.detect_dupes(copies)
    check("dupes: three copies and an overlapping punch are ONE card, the lone punch none",
          len(got) == 1, [g["detail"] for g in got])
    g = got[0] if got else {}
    check("the card stands at its first punch, from the earliest start to the latest end, the doubled minutes its "
          "hours, every punch named",
          (g.get("location"), g.get("startTime"), g.get("endTime"), g.get("hours")) ==
          ("ABD2005", "8:00 AM", "10:00 PM", 8)
          and g.get("detail") == "Overlapping entries: 8:00 AM–4:00 PM at ABD2005; 8:00 AM–4:00 PM at ABD2005; "
                                 "8:00 AM–4:00 PM at ABD2005; 2:00 PM–10:00 PM at ABD1711", g)
    check("punches that only touch are no dupe",
          D.detect_dupes([punch("2026-10-12", "P1", "J", "A1", 480, 600), punch("2026-10-12", "P1", "J", "A1", 600,
                                                                               700)]) == [])

    punches = [punch("2026-10-12", "P2", "Rick Roe", "ABD1711", 480, 960),
               punch("2026-10-12", "P1", "Jane Doe", "ABD2005", 420, 900),
               punch("2026-10-13", "P1", "Jane Doe", D.NOT_FOUND, 480, 960)]
    shifts = [shift("2026-10-12", "P1", "Jane Doe", "ABD1711", 480, 960),
              shift("2026-10-13", "P2", "Rick Roe", "ABD1711", 480, 960),
              shift("2026-10-12", "P3", "Ann Poe", "BM4060", 480, 960)]
    got = D.detect_missing(punches, shifts, CFG)
    check("missing: judged only on a day with entries at a real house, at a house the run holds",
          [(m["date"], m["location"], m["employeeName"]) for m in got] == [("2026-10-12", "ABD1711", "Jane Doe")],
          [(m["date"], m["location"]) for m in got])
    check("and says where its person punched instead",
          bool(got) and got[0]["detail"] == "Scheduled 8:00 AM-4:00 PM (8.0h missing) · punched at ABD2005 "
                                            "7:00 AM–3:00 PM", got and got[0]["detail"])

    spans = [punch("2026-10-12", "P1", "Jane Doe", "ABD1711", 480, 720, "Smith Ann"),
             punch("2026-10-12", "P2", "Rick Roe", "ABD1711", 780, 1020, "Smith Ann"),
             punch("2026-10-13", "P1", "Jane Doe", "ABD1711", 300, 600, "Smith Ann"),
             punch("2026-10-13", "P2", "Rick Roe", "ABD1711", 360, 900, "Smith Ann"),
             punch("2026-10-13", "P3", "Ann Poe", "ABD1711", 610, 1000, "Smith Ann")]
    gaps, folded = D.detect_gaps(spans, [], [], CFG)
    check("gaps: found day by day in a run of several days, each span against the furthest end so far",
          [(x["date"], x["startTime"], x["endTime"], x["hours"]) for x in gaps] ==
          [("2026-10-12", "12:00 PM", "1:00 PM", 1)] and folded == [],
          [(x["date"], x["startTime"], x["endTime"]) for x in gaps])

    two = [punch("2026-10-12", "P1", "Jane Doe", "ABD1711", 480, 960, "Smith Ann"),
           punch("2026-10-12", "P2", "Rick Roe", "ABD1711", 480, 960, "Smith Ann")]
    planned = [shift("2026-10-12", "P1", "Jane Doe", "ABD1711", 480, 960),
               shift("2026-10-12", "P2", "Rick Roe", "ABD1711", 480, 960)]
    got, quiet = D.detect_overlaps(two, CFG, planned)
    check("overlaps: a planned 2:1 is no overlap (counted as suppressed)", got == [] and quiet == 1, (got, quiet))
    got, quiet = D.detect_overlaps(two, CFG, planned[:1])
    check("two staff where the roster planned one is an overlap, said against the plan",
          len(got) == 1 and got[0]["detail"] == "8.0h overstaffed (2 employees vs 1 scheduled) 8:00 AM – 4:00 PM"
          and got[0]["employeeName"] == "Jane Doe, Rick Roe", got)
    got, _q = D.detect_overlaps(two, CFG)
    check("with no roster given, one is expected", len(got) == 1 and "vs 1 scheduled" in got[0]["detail"], got)
    handover = [punch("2026-10-12", "P1", "Jane Doe", "ABD1711", 480, 960, "Smith Ann"),
                punch("2026-10-12", "P2", "Rick Roe", "ABD1711", 960, 1440, "Smith Ann")]
    check("staff handing over on the minute are never two", D.detect_overlaps(handover, CFG) == ([], 0))
    found = D.detect_all(two, planned[:1], CFG)
    check("detect_all weighs the overlaps against the roster", len(found["overlap"]) == 1)

    names = ["WORKSHOP (KC)", "Family", "Nurse", "OPEN", "tbd", "Vacant shift", "none"]
    people = ["Nursey Smith", "Openshaw Kim", "Jane Doe"]
    check("the roster's placeholder rows are no person, any spelling after the word",
          all(RO.PLACEHOLDER.match(n) for n in names) and not any(RO.PLACEHOLDER.match(n) for n in people))
    cal = [("CAN - 48TH - ABD1711", grid(["2026-10-12"], [("WORKSHOP (KC)", ["8a-4p"]), ("Family", ["8a-4p"]),
                                                          ("Nurse", ["9a-1p"]), ("Jane Doe", ["8a-4p"])]))]
    got = RO.load_shifts(Reads(calendars=cal), "2026-10-12", "2026-10-12")
    check("so load_shifts plans the person alone",
          [(s["employeeName"], s["location"], s["startMin"], s["endMin"]) for s in got] ==
          [("Jane Doe", "ABD1711", 480, 960)], got)


def in_progress() -> None:
    """A run judged at 10:15 AM on 10-29 (New York), the day still running: only what should already be over."""
    now = datetime(2026, 10, 29, 14, 15, tzinfo=timezone.utc)  # 10:15 AM in New York (EDT)
    today, yesterday, before = "2026-10-29", "2026-10-28", "2026-10-27"
    punches = [punch(today, "P1", "Jane Doe", "ABD1711", 420, None),             # clocked in at 7:00, still on
               punch(today, "P2", "Rick Roe", "ABD1711", 0, 480),                # 12:00 AM to 8:00 AM, done
               punch(yesterday, "P4", "Pat Moe", "ABD1711", 1380, None),         # 11:00 PM, stitched to an open 12:00
               punch(yesterday, "P2", "Rick Roe", "ABD1711", 480, 960),
               punch(before, "P1", "Jane Doe", "ABD1711", 480, None)]            # open since two days back
    shifts = [shift(today, "P1", "Jane Doe", "ABD1711", 420, 900),               # 7 AM-3 PM: still running
              shift(today, "P2", "Rick Roe", "ABD1711", 0, 480),                 # over at 8:00, covered
              shift(today, "P3", "Ann Poe", "ABD1711", 360, 540),                # over at 9:00, nobody came
              shift(today, "P5", "Bo Lee", "ABD1711", 540, 600),                 # over at 10:00: within the hour
              shift(today, "P6", "Cy Fay", "ABD1711", 840, 1320),                # not started yet
              shift(yesterday, "P4", "Pat Moe", "ABD1711", 1380, 420)]           # 11 PM-7 AM, on the clock all night
    check("10:15 AM in New York is the moment counted", D.now_minute(now) == D.minute_of(today, 615)
          and D.now_minute(datetime(2026, 10, 29, 10, 15)) == D.minute_of(today, 615))
    got = D.detect_missing(punches, shifts, CFG, now)
    check("missing at 10:15: only a shift over an hour before with nobody on it — never one still to start, still "
          "running or just over, and an overnight shift still on the clock is covered",
          [(m["date"], m["employeeName"]) for m in got] == [(today, "Ann Poe")],
          [(m["date"], m["employeeName"]) for m in got])
    every = D.detect_missing(punches, shifts, CFG)
    check("judged at no moment, every shift is judged as before (the running ones missing)",
          sorted(m["employeeName"] for m in every) == ["Ann Poe", "Bo Lee", "Cy Fay", "Jane Doe", "Pat Moe"],
          sorted(m["employeeName"] for m in every))
    ends = D.detect_no_end(punches, now)
    check("no end at 10:15: only an entry open past 16 hours — never a person still on the clock",
          [(x["date"], x["employeeName"]) for x in ends] == [(before, "Jane Doe")],
          [(x["date"], x["employeeName"]) for x in ends])
    check("judged at no moment, every open entry is a missing end",
          len(D.detect_no_end(punches)) == 3)
    found = D.detect_all(punches, shifts, CFG, now)
    check("detect_all judges the missing shifts and the ends at its moment",
          len(found["missing"]) == 1 and len(found["noEnd"]) == 1, {k: len(found[k]) for k in R.TYPES})
    late = datetime(2026, 10, 29, 19, 30)  # 7:30 PM: Pat's 11 PM entry has run past 16 hours
    check("an entry left open past 16 hours is a missing end, and covers its shift no more",
          [x["employeeName"] for x in D.detect_no_end(punches, late)] == ["Pat Moe", "Jane Doe"]
          and "Pat Moe" in [m["employeeName"] for m in D.detect_missing(punches, shifts, CFG, late)])


class AsOfDB:
    def __init__(self, last) -> None:  # noqa: ANN001
        self.last = last

    def query(self, sql: str, params: tuple = ()) -> list[tuple]:
        assert "max(updated_at)" in sql and params == (PSI.PUNCHES,), sql
        return [(self.last,)]


def as_of() -> None:
    class At:
        now = datetime(2026, 10, 29, 18, 0, tzinfo=timezone.utc)

        def __init__(self, last) -> None:  # noqa: ANN001
            self.db = AsOfDB(last)

    got = R.record_as_of(At(datetime(2026, 10, 29, 14, 15, tzinfo=timezone.utc)))
    check("a run judges as of the record's last change when that is before now, in New York's clock",
          got.isoformat() == "2026-10-29T10:15:00-04:00", got)
    check("never past now", R.record_as_of(At(datetime(2026, 10, 30, 1, 0, tzinfo=timezone.utc))).isoformat() ==
          "2026-10-29T14:00:00-04:00")
    check("and now when the record holds nothing", R.record_as_of(At(None)).isoformat() == "2026-10-29T14:00:00-04:00")


# ---- the run -------------------------------------------------------------------------------------------------------

def the_run() -> None:
    today = date(2026, 10, 29)
    check("no dates: the current pay period", R.run_range({}, today) == ("2026-10-25", "2026-11-07"))
    check("a range of 35 days is one run", R.run_range({"dateFrom": "2026-10-01", "dateTo": "2026-11-04"}, today) ==
          ("2026-10-01", "2026-11-04"))
    refusals = [R.run_range(p, today) for p in ({"dateFrom": "2026-10-11"}, {"dateTo": "2026-10-24"},
                                                {"dateFrom": "10/11/2026", "dateTo": "2026-10-24"},
                                                {"dateFrom": "2026-10-24", "dateTo": "2026-10-11"},
                                                {"dateFrom": "2026-08-02", "dateTo": "2026-10-23"})]
    check("one end alone, not a day, backwards or over 35 days: 400 in plain words",
          all(isinstance(x, dict) and x.get("status") == 400 and x.get("message") for x in refusals)
          and "83 days" in refusals[-1]["message"], refusals)
    check("a range that is one pay period is named by its text, any other is not",
          R.period_label("2026-10-11", "2026-10-24") == "10/11/26 – 10/24/26"
          and R.period_label("2026-10-11", "2026-10-23") == "")
    check("the daily run covers the previous and the current period, oldest first",
          [p["id"] for p in R.auto_periods(today)] == ["P2026-10-11", "P2026-10-25"])
    miss = {"type": "missing", "date": "2026-08-03T00:00:00.000Z", "location": "ABD1711", "employeeId": "",
            "employeeName": "Jane DOE", "startTime": "1899-12-30T08:00:00.000Z", "consumers": "Smith Ann"}
    gap = {**miss, "type": "gap", "date": "2026-08-03", "startTime": "8:00:00 AM"}
    check("an anomaly's key: type, day, place, person, start; the consumers only for a gap or an overlap; stamps "
          "healed",
          R.anomaly_key(miss) == "missing|2026-08-03|ABD1711|jane doe|8:00:00 AM|"
          and R.anomaly_key(gap) == "gap|2026-08-03|ABD1711|jane doe|8:00:00 AM|Smith Ann"
          and R.anomaly_key({**miss, "employeeId": "P1"}).split("|")[3] == "P1",
          (R.anomaly_key(miss), R.anomaly_key(gap)))
    check("the workbook path reads a decimal comma as a point",
          (REP._hours("2,63"), REP._hours(" 7,5 "), REP._hours("2.5"), REP._hours(3), REP._hours("")) ==
          (2.63, 7.5, 2.5, 3.0, 0.0))
    errs = [{"location": "B1", "date": "2026-10-12", "startTime": "10:00 AM"},
            {"location": "A1", "date": "2026-10-13", "startTime": "8:00 AM"},
            {"location": "A1", "date": "2026-10-12", "startTime": "10:00 AM"},
            {"location": "A1", "date": "2026-10-12", "startTime": "9:00 AM"}]
    check("the queue's order: place, day, then the clock by its minutes",
          [(e["location"], e["date"], e["startTime"]) for e in R.by_place(errs)] ==
          [("A1", "2026-10-12", "9:00 AM"), ("A1", "2026-10-12", "10:00 AM"), ("A1", "2026-10-13", "8:00 AM"),
           ("B1", "2026-10-12", "10:00 AM")])


def main() -> int:
    for part in (periods, record, detectors, in_progress, as_of, the_run):
        try:
            part()
        except Exception as exc:  # noqa: BLE001 - said as a failed check
            check(part.__name__ + ": ran to the end", False, f"{type(exc).__name__}: {exc}")
    failed = 0
    for name, ok, detail in out:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1
    print(f"{len(out) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
