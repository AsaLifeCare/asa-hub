"""Staff's Performance and Employee Pay reads (StaffProfiles.gs, StaffPerformance.gs, EmployeeLoans.gs) off the copy."""
from __future__ import annotations

import functools
import json
import math
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc
import staff_views as SV
from gsjs import NY, SheetDate, name_key
from scope import Defer

# StaffProfiles.gs: the performance section
PERF_DAYS = 90
TARDY_MIN = 5
MANDATORY = ("cpr", "dodd")
SCOPES = {"med1": "Medication", "med2": "Medication", "med3": "Medication", "mais": "Medication",
          "money": "Funds management", "mandt": "Crisis prevention"}
WEIGHTS = {"attendance": 40, "mandatory": 30, "documentation": 30}
FORMULA = ("Score = 40% attendance reliability + 30% mandatory training compliance + 30% documentation on "
           "time, over the parts with data. Attendance reliability is on-time starts over scheduled shifts worked, "
           "called out or missed with no call. Documentation is on-time records over expected records. Value-add "
           "training is shown separately and never lowers the score. HR matters are never scored.")
HOLDING = ("", "scheduled", "swap_in", "taken", "training")
AWAY = {"requested_off": "Requested off", "time_off": "Time off"}
ROWS_CAP = 200
STATUS_OF = {"call_off": "call_out", "no_show": "ncns", "late_show": "tardy", "sent_home": "sent_home"}
ATT_WORDS = {"tardy": "Tardy recorded", "call_out": "Call-out recorded", "ncns": "No call / no show",
             "sent_home": "Sent home", "time_off": "Time off"}
AREA_WORDS = {"daily_notes": "Daily notes", "time_tracking": "Time tracking", "incidents": "Incident documentation"}
SCRUB_KEYS = frozenset({"id", "file_id", "doc_id", "call_id", "user_id", "roster_id", "employee_id", "with"})
# StaffIssues.gs STAFF_ISSUE_SOURCE and Estate.gs's daily notes
HR_SOURCE = ("ESTATE_HR_ID", "Master")
DAILY_NOTES = ("ESTATE_NOTES_ID", "Notes")
# CommCallOff.gs COMM_CALLOFF_TYPES
CALLOFF_TYPES = {"call off": "call_off", "call-off": "call_off", "calloff": "call_off",
                 "schedule - call off": "call_off", "no show no call": "no_show", "no show / no call": "no_show",
                 "no-show no-call": "no_show", "late show": "late_show", "sent home": "sent_home"}
# Scheduling.gs: the houses this module reads, with the columns hubTabEnsure_ makes sure of
SCHED_SETTINGS = "sched_settings"
SCHED_HEADERS = {
    "sched_cells": ("id", "period_id", "house_code", "date", "row_id", "text", "kind", "start_min", "end_min", "hours",
                    "token", "color", "state", "base", "flow_id", "source", "note", "updated_at", "updated_by"),
    "sched_rows": ("id", "house_code", "location", "row_id", "row_kind", "name", "person_key", "designation", "order",
                   "active", "source", "updated_at", "updated_by"),
    "sched_flows": ("id", "kind", "state", "house_code", "date", "date_to", "row_id", "person", "person_key",
                    "person_uid", "shift_text", "start_min", "end_min", "open_row_id", "replacement",
                    "replacement_key", "replacement_uid", "seats", "reason", "note", "source", "source_ref",
                    "outreach_stage", "outreach_next_at", "outreach_log", "test_mode", "created_at", "created_by",
                    "updated_at", "closed_at", "closed_by"),
    "sched_settings": ("key", "value", "note", "updated_at", "updated_by")}
# StaffPerformance.gs PERF_TABS
PERF = {"staff": "perf_staff", "attendance": "perf_attendance", "incidents": "perf_incidents", "notes": "perf_notes",
        "trainings": "perf_trainings", "ai": "perf_ai", "board": "perf_board"}
DAY_MS = 86400000
# EmployeeLoans.gs
EL_TAB = "employee_loans"
EL_HEADER = ("id", "kind", "loan_id", "staff_key", "staff_name", "staff_uid", "label", "purpose", "amount", "date",
             "method", "state", "box", "seat", "to_uid", "to_email", "to_name", "title", "body", "facts", "answered_by",
             "answered_at", "note", "link", "test_mode", "created_at", "created_by", "created_by_uid", "updated_at")
EL_UNSET = "Employee loans are not set up yet."
EL_METHODS = {"manual": "Manual payment", "payroll": "Payroll deduction"}
# Profile.gs HUB_CALENDAR_BADGE: the ranks from ADMIN down to it manage
CALENDAR_BADGE = "HM"
MANAGER_RANKS = sc.USER_TYPES[:sc.USER_TYPES.index(CALENDAR_BADGE) + 1]


class _Unread(RuntimeError):
    """A source answered as Apps Script's own try/catch would word it."""


def _staff() -> Any:
    import staff as SP  # noqa: PLC0415 - the Staff core loads beside this module
    return SP


def _why(what: str, e: BaseException) -> str:
    return f"{what} could not be read ({L._why(e)})"


def _cmp(fn: Callable[[Any, Any], int]) -> Callable[[Any], Any]:
    return functools.cmp_to_key(fn)


# ---- what Apps Script's helpers do to a value ---------------------------------------------------------------------

def sp_day(v: Any) -> str:
    """spDay_: a Date on its book's clock, a US or ISO date at the start; '' otherwise."""
    if isinstance(v, hubdb.SheetTime):
        return ""
    if isinstance(v, SheetDate):
        local = v.at.astimezone(NY)
        return "" if local.year < 1900 else local.strftime("%Y-%m-%d")
    s = gsjs.trim(gsjs.or_blank(v))
    us = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})\b", s, re.A)
    if us:
        y = int(us.group(3))
        if y < 100:
            y += 2000
        return f"{y}-{us.group(1).zfill(2)}-{us.group(2).zfill(2)}"
    iso = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s, re.A)
    return f"{iso.group(1)}-{iso.group(2)}-{iso.group(3)}" if iso else ""


def sp_ohio_day(v: Any) -> str:
    """spOhioDay_: an instant's New York day; a bare day as written."""
    if isinstance(v, SheetDate):
        return v.at.astimezone(NY).strftime("%Y-%m-%d")
    s = gsjs.trim(gsjs.or_blank(v))
    if re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", s, re.A):
        t = gsjs.date_parse(s)
        if t is not None:
            return datetime.fromtimestamp(t / 1000.0, timezone.utc).astimezone(NY).strftime("%Y-%m-%d")
    return sp_day(v)


def sp_time(v: Any) -> str:
    """spTime_: a clock cell as HH:mm, an ISO instant at New York's clock, else the text's first 20 characters."""
    if isinstance(v, hubdb.SheetTime):
        return f"{v.h:02d}:{v.m:02d}"
    if isinstance(v, SheetDate):
        return v.at.astimezone(NY).strftime("%H:%M")
    s = gsjs.trim(gsjs.or_blank(v))
    if re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", s, re.A):
        t = gsjs.date_parse(s)
        return "" if t is None else datetime.fromtimestamp(t / 1000.0, timezone.utc).astimezone(NY).strftime("%H:%M")
    return s[:20]


def sp_minutes(v: Any) -> int | None:
    """spMinutes_: minutes after midnight of 08:00, 8:00 AM or 8a; None when it is none."""
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?\s*(a|p)?", gsjs.trim(gsjs.or_blank(v)).lower(), re.A)
    if not m:
        return None
    h, mm = int(m.group(1)), int(m.group(2) or 0)
    if m.group(3) == "p" and h < 12:
        h += 12
    if m.group(3) == "a" and h == 12:
        h = 0
    return None if h > 23 or mm > 59 else h * 60 + mm


def _js_number(v: Any) -> float | None:
    """Number(v) for what a cell holds; None for NaN."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return None if isinstance(v, float) and math.isnan(v) else float(v)
    s = gsjs.trim(gsjs.or_blank(v))
    if not s:
        return 0.0
    if re.fullmatch(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?", s, re.A):
        return float(s)
    if re.fullmatch(r"0[xX][0-9a-fA-F]+", s):
        return float(int(s, 16))
    return None


def sp_clock(minutes: Any) -> str:
    """spClock_: minutes after midnight as HH:mm, wrapped to the day; '' for none."""
    if minutes is None or gsjs.trim(gsjs.or_blank(minutes)) == "":
        return ""
    n = _js_number(minutes)
    if n is None or not math.isfinite(n):
        return ""
    k = int(gsjs.js_round(n)) % 1440
    return f"{k // 60:02d}:{k % 60:02d}"


def sp_true(v: Any) -> bool:
    return v is True or bool(re.fullmatch(r"(true|1|yes|y)", gsjs.trim(gsjs.or_blank(v)), re.I))


def sp_instant(v: Any) -> str:
    return gsjs.iso(v.at) if isinstance(v, SheetDate) else gsjs.trim(gsjs.or_blank(v))


def sp_days_between(a: Any, b: Any) -> int:
    x, y = gsjs.date_parse(gsjs.or_text(a) + "T12:00:00Z"), gsjs.date_parse(gsjs.or_text(b) + "T12:00:00Z")
    return 0 if x is None or y is None else int(gsjs.js_round((y - x) / DAY_MS))


def name_fold(v: Any) -> str:
    """hubNameFold_."""
    return re.sub(r"[^a-z0-9]+", "", gsjs.or_blank(v).lower())


def name_norm(v: Any) -> str:
    """nameNorm_: accents dropped, apostrophes closed up, every other mark a space."""
    s = "".join(c for c in unicodedata.normalize("NFD", gsjs.or_blank(v)) if not "̀" <= c <= "ͯ").lower()
    s = re.sub(r"['’`]", "", s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return gsjs.trim(re.sub(r"\s+", " ", s))


def name_hit(cell: Any, name: Any) -> bool:
    """emp360NameHit_: exact per segment, never a substring."""
    want = name_norm(name)
    if not want:
        return False
    if name_norm(cell) == want:
        return True
    return any(name_norm(p) == want for p in re.split(r"[,;+&]|\band\b", gsjs.or_text(cell), flags=re.I | re.A))


def calloff_kind(raw: Any) -> str:
    return CALLOFF_TYPES.get(re.sub(r"\s+", " ", gsjs.trim(gsjs.or_text(raw)).lower()), "")


_SSN = re.compile(r"(^|[^0-9])[0-9]{3}[\s.-][0-9]{2}[\s.-][0-9]{4}(?=[^0-9]|\Z)")
_NINE = re.compile(r"(^|[^0-9])[0-9]{9}(?=[^0-9]|\Z)")


def scrub(v: Any, key: str | None = None) -> Any:
    """spScrub_: an SSN shape or a bare nine-digit run never leaves."""
    if key and key in SCRUB_KEYS:
        return v
    if isinstance(v, str):
        return _NINE.sub(r"\1[withheld]", _SSN.sub(r"\1[withheld]", v))
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        if isinstance(v, float) and not math.isfinite(v):
            return v
        r = gsjs.js_round(float(v))
        return None if r == v and len(gsjs.num_str(abs(r))) == 9 else v
    if isinstance(v, list):
        return [scrub(x) for x in v]
    if isinstance(v, dict):
        return {k: scrub(x, k) for k, x in v.items()}
    return v


def js_parse_float(v: Any) -> float | None:
    """parseFloat as JSON carries it: the longest leading number; None where JSON.stringify writes null."""
    m = re.match(r"[+-]?(Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)", gsjs.or_blank(v).lstrip(gsjs._TRIM), re.A)
    if not m or m.group(1) == "Infinity":
        return None
    got = float(m.group(0))
    return got if math.isfinite(got) else None


# ---- the books ------------------------------------------------------------------------------------------------------

def _hub_rows(reads: L.Reads, tab: str) -> list[dict]:
    """listRows_ of a Hub tab (readAll_); its own table once kept there."""
    def read() -> list[dict]:
        if HT.tabled(tab):
            return reads.hub_rows(tab)
        res = reads.db.resolve(tab)
        if res.runtime:
            raise Defer(f"{tab} lives in the depot's facts")
        if res.ref is None and not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
        return reads.db.sheetdb_rows(res.ref)
    return reads.once("spf_hub:" + tab, read)


def _perf_rows(reads: L.Reads, tab: str) -> list[dict]:
    """perfReadSoft_ (readTabNormalized_ in the tab's own workbook); a tab not made yet reads as none; its own table
    once kept there."""
    def read() -> list[dict]:
        res = HT.where(reads, tab)
        if res.runtime:
            raise Defer(f"{tab} lives in the depot's facts")
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
            return []
        if not isinstance(res.ref, HT.KeptRef) and res.sheet_id == reads.db.prop("HUB_DB_ID"):
            return reads.db.normalized_rows(res.ref)
        keys = [hubdb.norm_key(h) for h in res.ref.headers]
        out = []
        for _rn, raw in HT.tab_rows(reads, res.ref):
            vals = [hubdb.typed(raw.get(h), "hub") for h in res.ref.headers]
            if all(v == "" or v is None for v in vals):
                continue
            out.append({k: hubdb.estate_cell(v) if isinstance(v, (SheetDate, hubdb.SheetTime)) else v
                        for k, v in zip(keys, vals) if k})
        return out
    return reads.once("spf_perf:" + tab, read)


def _sched_read(reads: L.Reads, tab: str) -> list[dict]:
    """schedRead_: a Scheduling house's rows keyed by its header, each cell its text; throws naming the house."""
    def read() -> list[dict]:
        import house_tables as HT  # noqa: PLC0415

        if HT.tabled(tab):
            idf = "key" if tab == SCHED_SETTINGS else "id"
            got = [{**{h: "" for h in SCHED_HEADERS[tab]}, **{h: gsjs.trim(v) for h, v in r.items()}}
                   for r in HT.rows(reads, tab)]
            return [r for r in got if r.get(idf)]
        if not reads.db.house_moved(tab):
            raise _Unread(f'The Scheduling house "{tab}" could not be read: The Scheduling house "{tab}" is not set up '
                          f"(no pointer, or moved.{tab} is not on).")
        res = reads.db.resolve(tab)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the Scheduling house {tab}")
            return []
        idf = "key" if tab == SCHED_SETTINGS else "id"
        heads = [gsjs.trim(gsjs.or_text(h)) for h in res.ref.headers]
        out = []
        for _rn, raw in reads.db.rows(res.ref):
            row = {h: "" for h in SCHED_HEADERS[tab]}
            for h, src in zip(heads, res.ref.headers):
                if h:
                    row[h] = gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(src), "raw")))
            if row.get(idf):
                out.append(row)
        return out
    return reads.once("spf_sched:" + tab, read)


def _estate(reads: L.Reads, resource: str) -> list[dict]:
    """estateRows_ of the incident reports or the hotline's daily notes."""
    if resource in L.ESTATE_SOURCES:
        return reads.estate(resource)

    def read() -> list[dict]:
        prop, tab = DAILY_NOTES
        sid = reads.db.prop(prop)
        if not sid:
            raise hubdb.Unreadable(f"no {prop} is declared in the depot")
        return reads.db.estate_rows(HT.tab_of(reads, sid, tab, f"the estate's {tab}"))
    return reads.once("spf_estate:" + resource, read)


def _calendar_rows(reads: L.Reads) -> list[list[Any]]:
    """The Calendar Archive's rows as getValues() hands them: its dates and clock cells typed."""
    got = reads.calendar()
    values = (got.get("cal") or {}).get("values") or []
    return reads.once("spf_cal", lambda: [[hubdb.typed(c, "estate") for c in (line or [])] for line in values[1:]])


def _sibling_door(part: str) -> Callable[..., dict[str, Any]] | None:
    """The pack door the Staff core (compliance) or its comms module (notes) answers that part with."""
    import staff_comms as SC  # noqa: PLC0415 - the Staff modules load beside this one
    return {**_staff().PACK_DOORS, **SC.PACK_DOORS}.get(part)


# ---- the person's performance ------------------------------------------------------------------------------------

def perf_attendance(reads: L.Reads, ctx: dict, since: str, today: str) -> dict[str, Any]:
    """spPerfAttendance_: scheduled shifts against the punches, the call-off book and Scheduling's call-offs."""
    key = ctx["key"]
    why: list[str] = []
    src = {"schedule": False, "scheduling": False, "punches": False, "calloffs": False}
    shifts: dict[str, dict] = {}
    per_day: dict[str, int] = {}
    away: list[dict] = []
    told: dict[str, list[dict]] = {}
    punches: dict[str, dict] = {}
    punch_days: dict[str, list[str]] = {}
    entries: list[dict] = []

    def add(day: str, code: str, start: str, end: str, source: str) -> None:
        k = day + "|" + code
        if k in shifts and shifts[k]["source"] == "Scheduling" and source != "Scheduling":
            return
        if k not in shifts:
            per_day[day] = per_day.get(day, 0) + 1
        shifts[k] = {"date": day, "house": code, "start": start, "end": end, "source": source}

    def tell(day: str, e: dict) -> None:
        told.setdefault(day, []).append(e)

    got = reads.calendar()
    if got["cal"] and got["cal"].get("values"):
        src["schedule"] = True
        values, tz = got["cal"]["values"], got["cal"]["tz"]
        head = [gsjs.trim(gsjs.or_text(h)).lower() for h in (values[0] or [])]

        def col(names: tuple, fb: int) -> int:
            return next((head.index(n) for n in names if n in head), fb)

        c_loc, c_name, c_date = col(("location",), 0), col(("employee",), 1), col(("date",), 4)
        c_start = col(("start time", "start", "shift start", "time in", "shift"), -1)
        c_end = col(("end time", "end", "shift end", "time out"), -1)
        for line in _calendar_rows(reads):
            def at(j: int) -> Any:
                return line[j] if 0 <= j < len(line) else None

            if name_key(at(c_name)) != key:
                continue
            day = L.broadcast_day(at(c_date), tz)
            code = L.code_of(at(c_loc))
            if not day or day < since or day >= today or not code:
                continue
            add(day, code, "" if c_start == -1 else sp_clock(sp_minutes(sp_time(at(c_start)))),
                "" if c_end == -1 else sp_clock(sp_minutes(sp_time(at(c_end)))), "Calendar Archive")
    elif got["why"]:
        why.append(got["why"])
    try:
        mine: dict[str, bool] = {}
        for row in _sched_read(reads, "sched_rows"):
            if row["person_key"] == key:
                mine[row["house_code"] + "|" + row["row_id"]] = True
        for c in _sched_read(reads, "sched_cells"):
            if not mine.get(c["house_code"] + "|" + c["row_id"]) or not c["date"] or c["date"] < since \
                    or c["date"] >= today:
                continue
            code = L.code_of(c["house_code"]) or c["house_code"]
            timed = c["start_min"] != "" and c["kind"] != "off" and c["kind"] != "ro"
            if timed and c["state"] in HOLDING:
                add(c["date"], code, sp_clock(c["start_min"]), sp_clock(c["end_min"]), "Scheduling")
            elif AWAY.get(c["state"]) or c["kind"] == "ro":
                away.append({"date": c["date"], "house": code, "words": AWAY.get(c["state"]) or "Requested off"})
            elif c["state"] == "called_off":
                tell(c["date"], {"kind": "call_off", "at": "", "note": "", "source": "Scheduling"})
        for f in _sched_read(reads, "sched_flows"):
            if f["kind"] != "call_off" or f["person_key"] != key or not f["date"] or f["date"] < since \
                    or f["date"] > today:
                continue
            tell(f["date"], {"kind": "call_off", "at": sp_instant(f["created_at"]), "note": gsjs.text(f["reason"], 160),
                             "source": "Scheduling"})
        src["scheduling"] = True
    except _Unread as e:
        why.append(_why("the Scheduling board", e))
    psi = reads.punches()
    if psi["rows"] is not None:
        src["punches"] = True
        places = L.psi_places(psi["rows"])
        for p in psi["rows"]:
            who = gsjs.text(p.get("employee")) or \
                gsjs.text(gsjs.or_text(p.get("firstname")) + " " + gsjs.or_text(p.get("lastname")))
            if name_key(who) != key:
                continue
            day = L.broadcast_day(p.get("date_iso")) or L.broadcast_day(p.get("date_service"))
            if not day or day < since or day > today:
                continue
            code = L.code_of(p.get("house")) or places.get(L.loc_key(p.get("location_name"))) or ""
            s, e = sp_minutes(sp_time(p.get("start_time"))), sp_minutes(sp_time(p.get("end_time")))
            entries.append({"date": day, "house": code, "start": s, "end": e,
                            "submitted": sp_ohio_day(p.get("submit_date")),
                            "returned": bool(gsjs.text(p.get("rejected_user")) or gsjs.text(p.get("rejected_time"))),
                            "noted": any(sp_true(p.get(f"consumer_{i}_has_note")) for i in (1, 2, 3))})
            k = day + "|" + code
            pp = punches.get(k)
            if pp is None:
                pp = punches[k] = {"start": None, "end": None}
                punch_days.setdefault(day, []).append(k)
            if s is not None and (pp["start"] is None or s < pp["start"]):
                pp["start"] = s
            if e is not None and (pp["end"] is None or e > pp["end"]):
                pp["end"] = e
    elif psi["why"]:
        why.append(psi["why"])
    for r in _hub_rows(reads, "callOffs") or []:
        if not name_hit(r.get("employee_name"), ctx["name"]):
            continue
        kind = calloff_kind(r.get("type"))
        day = sp_day(r.get("date")) or sp_ohio_day(r.get("timestamp"))
        if not kind or not day or day < since or day > today:
            continue
        tell(day, {"kind": kind, "at": sp_instant(r.get("timestamp")), "late": gsjs.text(r.get("how_late"), 40),
                   "note": gsjs.text(r.get("notes"), 160), "source": "Call-off book"})
    src["calloffs"] = True

    rows: list[dict] = []
    used: dict[str, bool] = {}

    def take(day: str, kind: str) -> dict | None:
        hit = next((e for e in told.get(day, []) if e["kind"] == kind), None)
        if hit:
            used[day + "|" + kind] = True
        return hit

    def row_of(date: str, house: str, start: str, end: str, source: str) -> dict:
        return {"date": date, "house": house, "status": "", "scheduled_start": start or "", "scheduled_end": end or "",
                "actual_start": "", "actual_end": "", "notice": "", "excused": "", "details": "", "source": source}

    def late_words(ev: dict) -> str:
        return "Late by " + ev["late"] if ev.get("late") else "Late show reported"

    for k, s in shifts.items():
        row = row_of(s["date"], s["house"], s["start"], s["end"], s["source"])
        lone = punch_days.get(s["date"]) or []
        p = punches.get(k) or (punches[lone[0]] if per_day.get(s["date"]) == 1 and len(lone) == 1 else None)
        if p:
            row["actual_start"], row["actual_end"] = sp_clock(p["start"]), sp_clock(p["end"])
            row["source"] += " · PSI punches"
            planned = sp_minutes(s["start"])
            late = None if planned is None or p["start"] is None else p["start"] - planned
            shown, home = take(s["date"], "late_show"), take(s["date"], "sent_home")
            if late is not None and late > TARDY_MIN:
                row["status"], row["details"] = "tardy", f"{late} minutes after the scheduled start"
            elif shown:
                row["status"], row["details"] = "tardy", late_words(shown)
                row["source"] += " · " + shown["source"]
            elif home:
                row["status"], row["details"] = "sent_home", home["note"] or "Sent home"
                row["source"] += " · " + home["source"]
            else:
                row["status"] = "worked" if late is None else "present"
        else:
            co = take(s["date"], "call_off")
            ns = None if co else take(s["date"], "no_show")
            ls = None if co or ns else take(s["date"], "late_show")
            ev = co or ns or ls
            row["status"] = "call_out" if co else ("ncns" if ns else ("tardy" if ls else "no_punch"))
            if ev:
                row["notice"] = "" if ev["kind"] == "late_show" else ev["at"]
                row["details"] = late_words(ev) if ev["kind"] == "late_show" else ev["note"]
                row["source"] += " · " + ev["source"]
            else:
                row["details"] = "No punch on record for this shift"
        rows.append(row)
    for day, evs in told.items():
        for e in evs:
            if used.get(day + "|" + e["kind"]):
                continue
            used[day + "|" + e["kind"]] = True
            row = row_of(day, "", "", "", e["source"])
            row["status"] = STATUS_OF[e["kind"]]
            row["notice"] = e["at"] if e["kind"] in ("call_off", "no_show") else ""
            row["details"] = late_words(e) if e["kind"] == "late_show" else e["note"]
            rows.append(row)
    for a in away:
        row = row_of(a["date"], a["house"], "", "", "Scheduling")
        row["status"], row["details"] = "time_off", a["words"]
        rows.append(row)
    rows.sort(key=_cmp(lambda a, b: gsjs.locale_cmp(a["house"], b["house"]) if a["date"] == b["date"]
                       else (1 if a["date"] < b["date"] else -1)))

    def n(st: str) -> int:
        return sum(1 for r in rows if r["status"] == st)

    counts = {"present": n("present"), "worked": n("worked"), "tardy": n("tardy"), "call_outs": n("call_out"),
              "ncns": n("ncns"), "other": n("time_off") + n("sent_home"), "no_punch": n("no_punch"),
              "scheduled": len(shifts)}
    base = counts["present"] + counts["tardy"] + counts["call_outs"] + counts["ncns"]
    return {"connected": src, "counts": counts,
            "reliability": int(gsjs.js_round(counts["present"] * 100 / base)) if base else None,
            "tardy_minutes": TARDY_MIN, "rows": rows[:ROWS_CAP], "entries": entries,
            "why": "; ".join(w for w in why if w)}


def perf_area(aid: str, label: str, source: str, connected: bool, c: dict, why: str) -> dict[str, Any]:
    """spPerfArea_."""
    on_time = max(0, c["complete"] - c["late"])
    return {"id": aid, "label": label, "source": source, "connected": connected, "expected": c["expected"],
            "complete": c["complete"], "late": c["late"], "missing": c["missing"], "on_time": on_time,
            "rate": int(gsjs.js_round(on_time * 100 / c["expected"])) if connected and c["expected"] else None,
            "why": why or ""}


def doc_marks(reads: L.Reads, key: str) -> dict[tuple[str, str], dict]:
    """The person's concluded marks by (day, area), the newest of each; none while the tab is unborn."""
    SP = _staff()
    out: dict[tuple[str, str], dict] = {}
    for r in SP.own_rows(reads, SP.DOC_MARKS_TAB, key):
        if gsjs.or_text(r.get("state")) != "concluded":
            continue
        day, area = sp_day(r.get("date")), gsjs.or_text(r.get("area"))
        if day and area in SP.DOC_MARK_AREAS:
            out[(day, area)] = {"id": gsjs.or_text(r.get("id")), "why": gsjs.or_text(r.get("why")),
                                "by": gsjs.or_text(r.get("by")), "at": sp_instant(r.get("at"))}
    return out


def concluded_words(m: dict) -> str:
    """Concluded by whom and when, then why."""
    head = "Concluded" + (f" by {m['by']}" if m["by"] else "") + (f" on {m['at'][:10]}" if m["at"] else "")
    return head + (f" — {m['why']}" if m["why"] else "") + "."


def perf_documentation(reads: L.Reads, ctx: dict, since: str, today: str, att: dict) -> dict[str, Any]:
    """spPerfDocumentation_: daily notes per worked day, the punches as records, and the incident reports filed; a
    missing one marked concluded counts as complete."""
    exceptions: list[dict] = []
    try:
        marks = doc_marks(reads, ctx["key"])
        marks_why = ""
    except (Defer, hubdb.Unreadable) as exc:
        # a mark that cannot be read is never taken as none made: the areas say so
        marks, marks_why = {}, f"the concluded marks could not be read ({str(exc)[:80]})"

    def flag(date: str, area: str, status: str, source: str, details: str) -> None:
        exceptions.append({"date": date, "area": area, "status": status, "source": source, "details": details})

    def concluded(date: str, area: str, c: dict, source: str) -> bool:
        """A missing record its mark concludes: complete, and its row says by whom, when and why."""
        m = marks.get((date, area))
        if not m:
            return False
        c["complete"] += 1
        exceptions.append({"date": date, "area": area, "status": "concluded", "source": source,
                           "details": concluded_words(m), "mark": m["id"]})
        return True

    punches_read = att["connected"]["punches"]
    worked: dict[str, dict] = {}
    for e in att["entries"]:
        if e["date"] >= today:
            continue
        w = worked.setdefault(e["date"], {"noted": False})
        if e["noted"]:
            w["noted"] = True
    hot: dict[str, dict] = {}
    for r in _estate(reads, "dailyNotes"):
        if not name_hit(r.get("dsp_name"), ctx["name"]):
            continue
        day = sp_day(r.get("reporting_date")) or sp_ohio_day(r.get("timestamp"))
        if not day or day < since or day > today:
            continue
        filed = sp_ohio_day(r.get("timestamp")) or day
        h = hot.setdefault(day, {"on_time": False, "late": False})
        if filed > day:
            h["late"] = True
        else:
            h["on_time"] = True
    dn = {"expected": 0, "complete": 0, "late": 0, "missing": 0}
    if punches_read:
        for day in sorted(worked):
            dn["expected"] += 1
            h = hot.get(day)
            if worked[day]["noted"] or (h and h["on_time"]):
                dn["complete"] += 1
            elif h and h["late"]:
                dn["complete"] += 1
                dn["late"] += 1
                flag(day, "daily_notes", "late", "Employee Hotline", "The daily note was filed on a later day.")
            elif not concluded(day, "daily_notes", dn, "PSI / Employee Hotline"):
                dn["missing"] += 1
                flag(day, "daily_notes", "missing", "PSI / Employee Hotline",
                     "No daily note found for a day with punches.")
    tt = {"expected": 0, "complete": 0, "late": 0, "missing": 0}
    for e in att["entries"]:
        if e["date"] >= today:
            continue
        tt["expected"] += 1
        if e["start"] is None or e["end"] is None:
            if not concluded(e["date"], "time_tracking", tt, "PSI punches"):
                tt["missing"] += 1
                flag(e["date"], "time_tracking", "missing", "PSI punches",
                     "The entry has no clock-in." if e["start"] is None else "The entry has no clock-out.")
            continue
        if e["returned"]:
            tt["missing"] += 1
            flag(e["date"], "time_tracking", "returned", "PSI punches", "The entry was returned by a reviewer.")
            continue
        tt["complete"] += 1
        if e["submitted"] and sp_days_between(e["date"], e["submitted"]) > 1:
            tt["late"] += 1
            flag(e["date"], "time_tracking", "late", "PSI punches",
                 f"Submitted {sp_days_between(e['date'], e['submitted'])} days after the shift.")
    inc = {"expected": 0, "complete": 0, "late": 0, "missing": 0}
    for r in _estate(reads, "uiIncidents"):
        if name_key(r.get("your_name")) != ctx["key"]:
            continue
        day = sp_day(r.get("incident_date")) or sp_ohio_day(r.get("timestamp"))
        if not day or day < since or day > today:
            continue
        inc["expected"] += 1
        if not gsjs.text(r.get("summary_of_incident")) or not gsjs.text(r.get("immediate_action_taken")):
            inc["missing"] += 1
            flag(day, "incidents", "incomplete", "Incident reports",
                 "The summary or the immediate action taken is blank.")
            continue
        inc["complete"] += 1
        filed = sp_day(r.get("incident_reported_date")) or sp_ohio_day(r.get("timestamp"))
        gap = sp_days_between(day, filed) if filed else 0
        if gap > 1:
            inc["late"] += 1
            flag(day, "incidents", "late", "Incident reports", f"Filed {gap} days after the incident.")
    exceptions.sort(key=_cmp(lambda a, b: 1 if a["date"] < b["date"] else (-1 if a["date"] > b["date"] else 0)))
    no_punches = "" if punches_read else "the PSI punches could not be read"
    psi_why = "; ".join(w for w in (no_punches, marks_why) if w)
    areas = [perf_area("daily_notes", "Daily notes", "PSI / Employee Hotline", punches_read, dn, psi_why),
             perf_area("time_tracking", "Time tracking", "PSI punches", punches_read, tt, psi_why),
             perf_area("incidents", "Incident documentation", "Incident reports", True, inc, "")]
    exp = sum(a["expected"] for a in areas if a["connected"])
    ok = sum(a["on_time"] for a in areas if a["connected"])
    return {"areas": areas, "exceptions": exceptions[:ROWS_CAP],
            "rate": int(gsjs.js_round(ok * 100 / exp)) if exp else None}


def _sibling_part(reads: L.Reads, ctx: dict, part: str, what: str) -> dict[str, Any] | None:
    """A Staff part a sibling module answers (staffProfilesCached_ of its build); None when no module does."""
    door = _sibling_door(part)
    if door is None:
        return None
    env = door(reads, ctx)
    if isinstance(env, dict) and env.get("status") == 200 and isinstance(env.get("data"), dict):
        return env["data"]
    raise Defer(f"{what} did not answer here")


def _notes(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    got = _sibling_part(reads, ctx, "notes", "the staff notes")
    if got is None:
        raise Defer("the staff notes are not read by this engine")
    return got


def _compliance(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    got = _sibling_part(reads, ctx, "compliance", "the compliance record")
    if got is None:
        raise Defer("the compliance record is not read by this engine")
    return got


def perf_training(reads: L.Reads, ctx: dict, notes: list[dict], today: str) -> dict[str, Any]:
    """spPerfTraining_: mandatory and value-add courses, the ISTs, and open training requests."""
    comp = _compliance(reads, ctx)
    courses = comp.get("training") or []

    def line(t: dict, scope_: str) -> dict:
        ren = t.get("renewal")
        note = gsjs.or_text(t.get("tracker_word")) or (
            "Renewal: " + (gsjs.or_text(ren.get("phase_label")) or "phase " + gsjs.or_blank(ren.get("phase")))
            if ren else "")
        filing = t.get("filing") or {}
        return {"id": t.get("id"), "label": t.get("label"), "scope": scope_, "state": t.get("state"), "completed": "",
                "expires": t.get("expires") or "", "provider": "", "note": note,
                # the requirement a paper is filed under for this course, when one is
                "req_id": gsjs.or_text(filing.get("req_id")) if filing.get("files") else ""}

    mandatory = []
    for cid in MANDATORY:
        t = next((c for c in courses if c.get("id") == cid), None)
        mandatory.append(line(t, "Organization") if t else
                         {"id": cid, "label": cid.upper(), "scope": "Organization", "state": "not_on_file",
                          "completed": "", "expires": "", "provider": "", "note": ""})
    value_add = [line(c, SCOPES.get(c.get("id")) or "Role development") for c in courses
                 if c.get("id") not in MANDATORY and c.get("state") not in ("not_on_file", "no_date")]
    for r in reads.ist_rows():
        if name_key(r.get("staffName")) != ctx["key"]:
            continue
        done = gsjs.cell(r.get("status")).lower() == "done"
        house = L.house_code(r.get("house")) or gsjs.text(r.get("house"))
        due = sp_day(gsjs.cell(r.get("dueDate")))
        value_add.append({"id": "ist_" + gsjs.cell(r.get("id")), "label": "IST · " + gsjs.text(r.get("clientName")),
                          "scope": "Client / IST" + (" · " + house if house else ""),
                          "state": "current" if done else ("overdue" if due and due < today else "owed"),
                          "completed": sp_day(gsjs.cell(r.get("trainedAt"))) if done else "",
                          "expires": "" if done else due, "provider": gsjs.text(r.get("trainedBy"), 80) if done else "",
                          "note": ""})

    def current(items: list[dict]) -> int:
        return sum(1 for t in items if t["state"] == "current")

    areas: dict[str, bool] = {}
    for t in value_add:
        if t["state"] == "current":
            areas[gsjs.or_text(t["scope"]).split(" · ")[0]] = True
    requests = [{"id": q.get("id"), "priority": q.get("priority"), "details": q.get("details"), "by": q.get("by"),
                 "at": q.get("at"), "self": name_fold(q.get("by")) == ctx["key"]}
                for q in notes or [] if q.get("category") == "training" and q.get("state") == "open"]
    m_cur = current(mandatory)
    window = comp.get("window_days")
    return {"mandatory": mandatory, "value_add": value_add, "requests": requests,
            "window_days": window if not gsjs.falsy(window) else None, "mandatory_current": m_cur,
            "mandatory_pct": int(gsjs.js_round(m_cur * 100 / len(mandatory))), "value_add_current": current(value_add),
            "value_add_areas": len(areas), "connected": True, "why": ""}


def hr_issue_out(r: dict) -> dict[str, Any]:
    """spHrIssueOut_: one HR tracker row, its Category/Severity and Next review lines read back out."""
    meta: dict[str, str] = {}
    body: list[str] = []
    follow: list[str] = []
    review = ""
    for ln in re.split(r"\r?\n", gsjs.or_blank(r.get("situation"))):
        t = gsjs.trim(ln)
        m = re.match(r"^(category|severity):\s*(.+)$", t, re.I)
        if m:
            meta[m.group(1).lower()] = gsjs.trim(m.group(2))
        elif t:
            body.append(t)
    for ln in re.split(r"\r?\n", gsjs.or_blank(r.get("follow_up"))):
        t = gsjs.trim(ln)
        m = re.match(r"^next review:\s*(.+)$", t, re.I)
        if m:
            review = sp_day(m.group(1)) or gsjs.trim(m.group(1))
        elif t:
            follow.append(t)
    result = gsjs.trim(gsjs.or_blank(r.get("result")))
    under = bool(re.match(r"^under review\b", result, re.I))
    first = body[0] if body else ""
    long_ = len(first) > 140
    return {"date": sp_day(r.get("date")), "title": first[:137] + "…" if long_ else (first or "HR record"),
            "description": "\n".join(([first] if long_ else []) + body[1:]), "category": meta.get("category") or "",
            "severity": meta.get("severity") or "", "decision": gsjs.text(r.get("disciplinary_action"), 60),
            "action": "\n".join(follow), "outcome": "" if under else result, "next_review": review,
            "termination": gsjs.text(r.get("termination_summary"), 600),
            "status": "under_review" if under else ("resolved" if result else "open")}


def _hr_rows(reads: L.Reads) -> dict[str, Any]:
    """staffIssueSheet_ and its rows: the tracker's tab keyed by estateKey_, or why it cannot be read."""
    def read() -> dict[str, Any]:
        prop, tab = HR_SOURCE
        sid = reads.db.prop(prop)
        if not sid:
            raise hubdb.Unreadable(f"no {prop} is declared in the depot, so the HR tracker is not read here")
        ref = HT.tab_of(reads, sid, tab, "the HR tracker")
        if ref is None:
            return {"why": f'The HR tracker has no "{tab}" tab.'}
        if not ref.headers:
            return {"why": "The HR tracker's tab has no header row."}
        keys = [hubdb.estate_key(h) for h in ref.headers]
        rows = []
        for _rn, raw in reads.db.rows(ref):
            r: dict[str, Any] = {}
            for k, h in zip(keys, ref.headers):
                if k:
                    r[k] = hubdb._shown(hubdb.typed(raw.get(h), "estate"))
            rows.append(r)
        return {"rows": rows}
    return reads.once("spf_hr", read)


def perf_hr(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spPerfHr_: the HR tracker's rows naming the person, newest first."""
    got = _hr_rows(reads)
    if got.get("why"):
        return {"connected": False, "why": got["why"], "rows": [], "open": 0}
    rows = [hr_issue_out(r) for r in got["rows"] if name_hit(r.get("employees_involved"), ctx["name"])]
    rows.sort(key=_cmp(lambda a, b: 1 if a["date"] < b["date"] else (-1 if a["date"] > b["date"] else 0)))
    return {"connected": True, "why": "", "rows": rows[:60], "open": sum(1 for r in rows if r["status"] != "resolved")}


def perf_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spPerfBuild_: attendance, training, documentation and HR over the last 90 days, and the score."""
    hr = perf_hr(reads, ctx)
    today = reads.today()
    since = gsjs.day_shift(today, -PERF_DAYS)
    att = perf_attendance(reads, ctx, since, today)
    doc = perf_documentation(reads, ctx, since, today, att)
    notes = _notes(reads, ctx).get("notes") or []
    training = perf_training(reads, ctx, notes, today)

    parts = []
    if att["reliability"] is not None:
        parts.append({"id": "attendance", "label": "Attendance reliability", "value": att["reliability"],
                      "weight": WEIGHTS["attendance"]})
    if training["mandatory_pct"] is not None:
        parts.append({"id": "mandatory", "label": "Mandatory training compliance", "value": training["mandatory_pct"],
                      "weight": WEIGHTS["mandatory"]})
    if doc["rate"] is not None:
        parts.append({"id": "documentation", "label": "Documentation on time", "value": doc["rate"],
                      "weight": WEIGHTS["documentation"]})
    wsum = sum(p["weight"] for p in parts)
    vsum = sum(p["value"] * p["weight"] for p in parts)

    needs: list[dict] = []

    def need(title: Any, area: str, status: str, date: Any, tone: str) -> None:
        needs.append({"title": title, "area": area, "status": status, "date": date or "", "tone": tone})

    for t in training["mandatory"] + training["value_add"]:
        area = "Mandatory training" if t["id"] in MANDATORY else "Value-add training"
        if t["state"] in ("expired", "overdue"):
            need(t["label"], area, "Expired" if t["state"] == "expired" else "Overdue", t["expires"], "danger")
        elif t["state"] == "due_soon":
            need(t["label"], area, "Due soon", t["expires"], "amber")
        elif area == "Mandatory training" and t["state"] in ("not_on_file", "no_date"):
            need(t["label"], area, "Not on file", "", "amber")
    for q in training["requests"]:
        need(gsjs.text(q["details"], 80), "Training request", "Open", sp_ohio_day(q["at"]), "blue")
    for r in hr["rows"]:
        if r["status"] != "resolved":
            need(r["title"], "HR & conduct", "Under review" if r["status"] == "under_review" else "Open", r["date"],
                 "amber")
    for r in att["rows"]:
        if r["status"] == "ncns":
            need("No call / no show", "Attendance", "Recorded", r["date"], "danger")
    for x in doc["exceptions"][:3]:
        need(AREA_WORDS.get(x["area"]) or x["area"], "Documentation", x["status"][:1].upper() + x["status"][1:],
             x["date"], "amber")

    activity: list[dict] = []

    def act(at: Any, kind: str, title: str, detail: str) -> None:
        if not gsjs.falsy(at):
            activity.append({"at": at, "kind": kind, "title": title, "detail": detail or ""})

    for n in notes:
        act(n.get("at"), "note", "Training requested" if n.get("category") == "training" else "Note added",
            " · ".join(x for x in (gsjs.or_blank(n.get("by")), gsjs.text(n.get("details"), 160)) if x))
    for r in att["rows"]:
        if r["status"] in ATT_WORDS:
            act(r["date"], "attendance", ATT_WORDS[r["status"]], " · ".join(x for x in (r["house"], r["details"]) if x))
    for x in doc["exceptions"]:
        act(x["date"], "documentation", (AREA_WORDS.get(x["area"]) or x["area"]) + " · " + x["status"], x["details"])
    for r in hr["rows"]:
        word = {"under_review": "Under review", "resolved": "Resolved"}.get(r["status"], "Open")
        act(r["date"], "hr", r["title"], " · ".join(x for x in (r["category"], word) if x))
    for t in training["value_add"]:
        if t["completed"]:
            act(t["completed"], "training", gsjs.or_blank(t["label"]) + " completed", t["provider"])
    activity.sort(key=_cmp(lambda a, b: 1 if a["at"] < b["at"] else (-1 if a["at"] > b["at"] else 0)))

    why = [w for w in (att["why"], training["why"], hr["why"]) if w]
    return {"window_days": PERF_DAYS, "since": since, "today": today, "built_at": gsjs.iso(datetime.now(timezone.utc)),
            "score": {"value": int(gsjs.js_round(vsum / wsum)) if wsum else None, "parts": parts, "formula": FORMULA},
            "attendance": {"connected": att["connected"], "counts": att["counts"], "reliability": att["reliability"],
                           "tardy_minutes": att["tardy_minutes"], "rows": att["rows"]},
            "training": training, "documentation": doc, "hr": hr, "needs": needs[:12], "activity": activity[:20],
            "why": "; ".join(why),
            "degraded": not att["connected"]["punches"] or
            (not att["connected"]["schedule"] and not att["connected"]["scheduling"])}


def performance_door(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """staffProfilePerformance past the gate and the person; never packed (an audited read)."""
    if ctx.get("refused"):
        return ctx["refused"]
    return {"status": 200, "data": reads.once("spf_build:" + ctx["key"], lambda: scrub(perf_build(reads, ctx)))}


def staff_profile_performance(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffProfilePerformance: attendance, training, documentation and HR over the last 90 days; each answer is a line
    in the audit history."""
    SP = _staff()
    if not SP.tab_open(sess, SP.PERFORMANCE_FEATURE, SP.PERF_EDITIONS):
        return SP.unknown()
    ctx = SP.person_for(sess, payload.get("staff"))
    if ctx.get("refused"):
        return ctx["refused"]
    got, why = SP._soft(lambda: performance_door(sess.reads, ctx))
    if got is None:
        return {"status": 503, "message": f"The performance record could not be read just now ({why})."}
    if got.get("status") == 200:
        SV.record(sess.user, "staffProfilePerformance", ctx["key"])
    return got


# ---- Employee Pay: the loans ------------------------------------------------------------------------------------

def el_str(v: Any) -> str:
    return gsjs.trim(gsjs.or_blank(v))


def el_unknown() -> dict[str, Any]:
    return {"status": 404, "message": "Unknown action."}


def el_cents(v: Any) -> int | None:
    s = re.sub(r"[$,\s]", "", gsjs.or_blank(v))
    if not re.fullmatch(r"\d+(\.\d{1,2})?", s, re.A):
        return None
    return int(gsjs.js_round(float(s) * 100))


def el_dollars(c: int) -> str:
    return f"{gsjs.js_round(c) / 100:.2f}"


def profile_parse_emails(raw: Any) -> list[Any]:
    """profileParseEmails_."""
    if isinstance(raw, list):
        return raw
    s = gsjs.str_(raw)
    if not s:
        return []
    try:
        got = json.loads(s)
    except ValueError:
        return [x for x in re.split(r"\s*[;,]\s*", s) if x]
    return got if isinstance(got, list) else []


def user_by_email(reads: L.Reads, email: Any) -> dict | None:
    """userByEmail_: the sign-in address, else the one account listing it among its extras."""
    needle = gsjs.trim(gsjs.or_text(email)).lower()
    if not needle:
        return None
    users = reads.users()
    for u in users:
        if not gsjs.str_(u.get("mergedinto")) and gsjs.str_(u.get("email")).lower() == needle:
            return u
    hits = [u for u in users if not gsjs.str_(u.get("mergedinto"))
            and needle in [gsjs.trim(gsjs.str_(e)).lower() for e in profile_parse_emails(u.get("emails"))]]
    return hits[0] if len(hits) == 1 else None


def _live(u: dict | None) -> bool:
    """schedLive_."""
    off = gsjs.trim(gsjs.or_blank((u or {}).get("active"))).upper()
    return bool(u) and off not in ("FALSE", "0", "NO") and not gsjs.trim(gsjs.or_blank(u.get("mergedinto")))


def sched_directors(reads: L.Reads) -> dict[str, Any]:
    """schedFlowDirectors_ over schedSettings_: the live accounts the settings name as directors."""
    def read() -> dict[str, Any]:
        readable, why, directors, why_dir = True, "", [], ""
        kv: dict[str, Any] = {}
        try:
            for r in _sched_read(reads, SCHED_SETTINGS):
                kv[r["key"]] = r.get("value")
        except _Unread as e:
            readable, why = False, str(e)[:200]
        if not readable:
            why_dir = "The Scheduling settings could not be read, so nobody is known to be a director: " + why
        else:
            emails = [x for x in (gsjs.trim(s).lower() for s in re.split(r"[,;\s]+", gsjs.trim(gsjs.or_blank(kv.get(
                "directors"))))) if x.find("@") > 0]
            if not emails:
                why_dir = "No directors are written in the Scheduling settings."
            else:
                missed = []
                for email in emails:
                    u = user_by_email(reads, email)
                    if u and _live(u):
                        directors.append({"email": email, "uid": el_str(u.get("userid")),
                                          "name": el_str(u.get("displayname"))})
                    else:
                        missed.append(email)
                if missed:
                    why_dir = "No live account answers " + ", ".join(missed) + "."
        if not directors:
            return {"readable": False, "list": [], "why": why_dir or "the Scheduling directors list could not be read"}
        listed = [{"uid": gsjs.str_(d["uid"]), "name": gsjs.str_(d["name"]) or gsjs.str_(d["email"]),
                   "email": gsjs.str_(d["email"])} for d in directors if gsjs.str_(d["uid"])]
        return {"readable": True, "list": listed,
                "why": "" if listed else "no director on the Scheduling list has an account yet"}
    return reads.once("spf_directors", read)


def calendar_managers(reads: L.Reads) -> dict[str, list[str]] | None:
    """hubCalendarManagers_: each current ** manager's folded name and the locations they manage."""
    def read() -> dict[str, list[str]] | None:
        got = reads.calendar()
        if not got["cal"]:
            return None
        out: dict[str, list[str]] = {}
        for loc, by in L.managers_by_house(got["cal"]["values"], reads.today()).items():
            for r in by["current"]:
                k = name_fold(r["name"])
                if k and loc not in out.setdefault(k, []):
                    out[k].append(loc)
        return out
    return reads.once("spf_hm_map", read)


def calendar_badges(reads: L.Reads, user: dict | None) -> list[str]:
    """hubCalendarBadges_: HM for a current ** manager no other live account shares a name with."""
    if not user or user.get("is_service"):
        return []
    k = name_fold(user["display_name"] if user.get("display_name") is not None else user.get("displayname"))
    if not k:
        return []
    managed = calendar_managers(reads)
    if not managed or not managed.get(k):
        return []
    uid = gsjs.or_blank(user["id"] if user.get("id") is not None else user.get("userid"))
    for o in reads.users():
        if gsjs.or_blank(o.get("userid")) == uid:
            continue
        if not _live(o):
            continue
        if name_fold(o.get("displayname")) == k:
            return []
    return [CALENDAR_BADGE]


def badges_worn_by(reads: L.Reads, user: dict) -> list[str]:
    """userBadgesWornBy_: the badges worn, and the one the calendar derives."""
    worn = sc.badges_worn((user or {}).get("types"), (user or {}).get("role"))
    derived = user.get("derived_types") if isinstance(user.get("derived_types"), list) else calendar_badges(reads, user)
    for b in derived:
        if b not in worn:
            worn.append(b)
    return worn


def el_gate(reads: L.Reads, user: dict | None) -> dict[str, Any]:
    """elGate_: the session's id, and whether it is the master, a Scheduling director or a manager."""
    g = {"uid": "", "visiting": True, "master": False, "director": False, "manager": False}
    if not user or user.get("is_service"):
        return g
    g["visiting"] = bool(user.get("visiting_member"))
    g["uid"] = gsjs.str_(user.get("id"))
    g["master"] = sc.is_real_master(user)
    dirs = sched_directors(reads)
    g["director"] = not g["visiting"] and bool(g["uid"]) and any(d["uid"] == g["uid"] for d in dirs["list"])
    g["manager"] = not g["visiting"] and (g["master"] or any(gsjs.js_str(b).upper() in MANAGER_RANKS
                                                             for b in badges_worn_by(reads, user)))
    return g


EL_RESOURCE = "employeeLoans"


def el_rows(reads: L.Reads) -> list[dict] | None:
    """elRows_: every loan and payment row — Postgres's while Employee Loans runs there (app/resource_rows.py), the
    house's copy otherwise; None while the house is not set up."""
    import resource_rows as RR  # noqa: PLC0415 - the rows Postgres holds once the app is given to Python
    if RR.uploaded(reads.db, EL_RESOURCE):
        return [row for row in ({h: el_str(c.get(h)) for h in EL_HEADER} for _k, c in RR.table_rows(reads, EL_RESOURCE))
                if row["id"] and row["kind"]]
    if not reads.db.house_moved(EL_TAB):
        return None
    res = reads.db.resolve(EL_TAB)
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable("asa-hub-db holds no copy of the employee loans house")
        return []
    return [{h: el_str(r.get(h)) for h in EL_HEADER} for r in reads.db.locations_rows(res.ref)
            if el_str(r.get("id")) and el_str(r.get("kind"))]


def el_ledger(rows: list[dict], keep: Callable[[dict], bool]) -> dict[str, Any]:
    """elLedger_: open loans, requests, and the history newest first."""
    mine = [r for r in rows if r["kind"] == "loan" and keep(r)]
    loans, requests, history, total = [], [], [], 0
    for ln in mine:
        amount = el_cents(ln["amount"]) or 0
        if ln["state"] != "approved":
            requests.append({"id": ln["id"], "label": ln["label"], "amount": el_dollars(amount), "date": ln["date"],
                             "state": ln["state"], "answered_by": ln["answered_by"], "note": ln["note"],
                             "created_at": ln["created_at"]})
            continue
        events = [{"at": ln["date"], "seq": ln["answered_at"] or ln["created_at"], "type": "disbursement",
                   "amount": amount, "id": ln["id"] + ":d"}]
        for p in rows:
            if p["kind"] == "payment" and p["loan_id"] == ln["id"]:
                events.append({"at": p["date"], "seq": p["created_at"], "type": "payment",
                               "amount": el_cents(p["amount"]) or 0, "id": p["id"], "method": p["method"]})

        def order(a: dict, b: dict) -> int:
            if a["type"] != b["type"] and "disbursement" in (a["type"], b["type"]):
                return -1 if a["type"] == "disbursement" else 1
            if a["at"] != b["at"]:
                return -1 if a["at"] < b["at"] else 1
            return -1 if a["seq"] < b["seq"] else (1 if a["seq"] > b["seq"] else 0)

        events.sort(key=_cmp(order))
        bal = 0
        for e in events:
            bal = e["amount"] if e["type"] == "disbursement" else max(0, bal - e["amount"])
            method = e.get("method")
            history.append({"id": e["id"], "loan_id": ln["id"], "label": ln["label"], "date": e["at"],
                            "type": e["type"], "amount": el_dollars(e["amount"]), "balance_after": el_dollars(bal),
                            "method": (EL_METHODS.get(method) or method) if method else "", "seq": e["seq"]})
        total += bal
        loans.append({"id": ln["id"], "label": ln["label"], "amount": el_dollars(amount),
                      "outstanding": el_dollars(bal), "date": ln["date"], "paid_off": bal == 0})
    history.sort(key=_cmp(lambda a, b: (1 if a["date"] < b["date"] else -1) if a["date"] != b["date"]
                          else (1 if a["seq"] < b["seq"] else (-1 if a["seq"] > b["seq"] else 0))))
    for h in history:
        del h["seq"]
    requests.sort(key=_cmp(lambda a, b: 1 if a["created_at"] < b["created_at"] else -1))
    return {"loans": loans, "requests": requests, "history": history, "outstanding": el_dollars(total)}


def el_answer(rows: list[dict] | None, keep: Callable[[dict], bool], g: dict, full: bool,
              self_: bool) -> dict[str, Any]:
    """elAnswer_: whole where `full` (the person, and in Staff's Employee Pay every badge its App Control row names);
    the payable loans alone otherwise."""
    if rows is None:
        return {"status": 200, "data": {"ready": False, "why": EL_UNSET, "full": full, "can_pay": False}}
    led = el_ledger(rows, keep)
    payable = [{"id": ln["id"], "label": ln["label"], "outstanding": ln["outstanding"]}
               for ln in led["loans"] if not ln["paid_off"]]
    can = g["master"] or g["director"] or g["manager"] or self_
    if not full:
        return {"status": 200, "data": {"ready": True, "full": False, "payable": payable, "can_pay": can}}
    return {"status": 200, "data": {"ready": True, "full": True, "outstanding": led["outstanding"],
                                    "loans": led["loans"], "requests": led["requests"], "history": led["history"],
                                    "payable": payable,
                                    "can_pay": can, "can_request": (g["master"] or g["director"]) and not g["visiting"],
                                    "methods": [{"id": k, "label": v} for k, v in EL_METHODS.items()]}}


def employee_loan_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """employeeLoanList: one staff member's loans and payments, as the Staff page's Employee Pay reads them, for whom
    App Control opens that tab (the person's own loans are My Profile's, employeeLoanMine)."""
    reads = sess.reads
    SP = _staff()
    if not SP.tab_open(sess, SP.PAY_FEATURE):
        return el_unknown()
    g = el_gate(reads, sess.user)
    if not g["uid"] and not g["master"]:
        return el_unknown()
    ctx = SP.person_for(sess, payload.get("staff"))
    if ctx.get("refused"):
        return ctx["refused"]
    acct = ctx.get("account") or {}
    self_ = not g["visiting"] and bool(g["uid"]) and bool(acct) and acct.get("user_id") == g["uid"]
    # App Control's Employee Pay row opens the whole record to every badge it names (tab_open above, the operator's
    # sheet of 2026-10-29); filing a loan stays the master's and the Scheduling directors' (can_request)
    return el_answer(el_rows(reads), lambda r: r["staff_key"] == ctx["key"], g, True, self_)


# ---- StaffPerformance.gs: the board and the record ----------------------------------------------------------------

def perf_is_manager(user: dict | None) -> bool:
    return bool(user) and not user.get("is_service") and gsjs.or_blank(user.get("role")) in ("admin", "manager")


def hub_denied() -> dict[str, Any]:
    return {"status": 403, "message": "Requires an admin or manager account"}


def perf_grade(att90: int, att_old: int, majors: int, minors: int, expired: int, expiring: int) -> dict[str, Any]:
    """perfGrade_: arithmetic the screen can explain."""
    parts: list[dict] = []

    def take(label: str, count: int, per: float, cap: float) -> float:
        if not count:
            return 0
        cut = min(count * per, cap)
        parts.append({"label": label, "count": count, "cut": -(gsjs.js_round(cut * 100) / 100)})
        return cut

    total = 10.0
    total -= take("call-offs in the last 90 days", att90, 0.75, 3)
    total -= take("older call-offs", att_old, 0.15, 1)
    total -= take("major HR incidents", majors, 1.5, 3)
    total -= take("other incidents", minors, 0.5, 2)
    total -= take("expired certifications", expired, 1, 2.5)
    total -= take("certifications expiring", expiring, 0.25, 0.5)
    return {"grade": max(0.0, gsjs.js_round(total * 10) / 10), "parts": parts}


def perf_cert_status(exp: Any, now_ms: float) -> str:
    t = gsjs.date_parse(gsjs.or_text(exp))
    if not t:
        return "current"
    if t < now_ms:
        return "expired"
    return "expiring" if t <= now_ms + 30 * DAY_MS else "current"


def _now_ms(reads: L.Reads) -> float:
    return reads.now.timestamp() * 1000.0


def perf_board_build(reads: L.Reads) -> list[dict] | None:
    """staffPerfBoardBuild_: every migrated staff member's counts and arithmetic grade."""
    staff = _perf_rows(reads, PERF["staff"])
    if not staff:
        return None
    now = _now_ms(reads)
    floor90 = now - 90 * DAY_MS
    by_emp: dict[str, dict] = {}
    for s in staff:
        i = gsjs.str_(s.get("empid"))
        if not i or i in by_emp:
            continue
        by_emp[i] = {"emp_id": i, "name": gsjs.str_(s.get("name")), "status": gsjs.str_(s.get("status")),
                     "phone": gsjs.str_(s.get("phone")), "email": gsjs.str_(s.get("email")),
                     "hire_date": gsjs.str_(s.get("hiredate")), "attendance_90d": 0, "attendance_all": 0,
                     "incidents": 0, "incidents_major": 0, "certs_expired": 0, "certs_expiring": 0, "grade": 10}
    names = {r["name"].lower(): i for i, r in by_emp.items()}

    def find(r: dict) -> dict | None:
        return by_emp.get(gsjs.str_(r.get("empid"))) or by_emp.get(names.get(gsjs.str_(r.get("name")).lower(), ""))

    for r in _perf_rows(reads, PERF["attendance"]):
        hit = find(r)
        if hit:
            hit["attendance_all"] += 1
            t = gsjs.date_parse(gsjs.str_(r.get("date")))
            if t and t >= floor90:
                hit["attendance_90d"] += 1
    for r in _perf_rows(reads, PERF["incidents"]):
        hit = find(r)
        if hit:
            hit["incidents"] += 1
            if gsjs.str_(r.get("severity")) == "Major":
                hit["incidents_major"] += 1
    for r in _perf_rows(reads, PERF["trainings"]):
        hit = find(r)
        if hit:
            st = perf_cert_status(r.get("expires"), now)
            if st == "expired":
                hit["certs_expired"] += 1
            elif st == "expiring":
                hit["certs_expiring"] += 1
    rows = list(by_emp.values())
    for r in rows:
        r["grade"] = perf_grade(r["attendance_90d"], r["attendance_all"] - r["attendance_90d"], r["incidents_major"],
                                r["incidents"] - r["incidents_major"], r["certs_expired"], r["certs_expiring"])["grade"]
    rank = {"Active": 0, "Pending": 1}
    rows.sort(key=_cmp(lambda a, b: (rank.get(a["status"], 2) - rank.get(b["status"], 2))
                       or gsjs.locale_cmp(a["name"], b["name"])))
    return rows


def perf_board_stored(reads: L.Reads) -> dict[str, Any] | None:
    """staffPerfBoardStored_: the board the recompute kept, its JSON across rows; None when there is none."""
    res = reads.db.resolve(PERF["board"])
    if res.runtime:
        raise Defer("perf_board lives in the depot's facts")
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable("asa-hub-db holds no copy of the book behind perf_board")
        return None
    heads = list(res.ref.headers)
    c_json = "json" if "json" in heads else (heads[0] if heads else "")
    c_at = "computed_at" if "computed_at" in heads else (heads[1] if len(heads) > 1 else "")
    text, at = "", ""
    for _rn, raw in reads.db.rows(res.ref):
        text += gsjs.or_blank(hubdb.typed(raw.get(c_json), "raw"))
        if not at:
            at = gsjs.str_(hubdb.typed(raw.get(c_at), "raw"))
    if not text:
        return None
    try:
        rows = json.loads(text)
    except ValueError:
        return None
    return {"rows": rows, "computed_at": at} if isinstance(rows, list) else None


def staff_perf_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffPerfList: the kept performance board, else one built now."""
    if not perf_is_manager(sess.user):
        return hub_denied()
    stored = perf_board_stored(sess.reads)
    if stored:
        return {"status": 200, "data": {"rows": stored["rows"], "migrated": True, "computed_at": stored["computed_at"]}}
    rows = perf_board_build(sess.reads)
    if rows is None:
        return {"status": 200, "data": {"rows": [], "migrated": False}}
    return {"status": 200,
            "data": {"rows": rows, "migrated": True, "computed_at": gsjs.iso(datetime.now(timezone.utc))}}


def staff_perf_record(reads: L.Reads, emp_id: str) -> dict[str, Any]:
    """staffPerfRecord_: one staff member's rows, the arithmetic grade, the record's shape and the kept paragraph."""
    staff = next((s for s in _perf_rows(reads, PERF["staff"]) if gsjs.str_(s.get("empid")) == emp_id), None)
    if not staff:
        return {"error": {"status": 404, "message": f'No migrated staff row "{emp_id}".'}}
    name = gsjs.str_(staff.get("name"))
    nk = name.lower()

    def mine(r: dict) -> bool:
        return gsjs.str_(r.get("empid")) == emp_id or gsjs.str_(r.get("name")).lower() == nk

    def when(r: dict) -> float:
        return gsjs.date_parse(gsjs.str_(r.get("date")) or gsjs.str_(r.get("createdat"))) or 0

    att = sorted((r for r in _perf_rows(reads, PERF["attendance"]) if mine(r)), key=lambda r: -when(r))
    inc = sorted((r for r in _perf_rows(reads, PERF["incidents"]) if mine(r)), key=lambda r: -when(r))
    notes = sorted((r for r in _perf_rows(reads, PERF["notes"]) if mine(r)), key=lambda r: -when(r))
    now = _now_ms(reads)
    certs = [{"cert": gsjs.str_(r.get("cert")), "expires": gsjs.str_(r.get("expires")),
              "status": perf_cert_status(r.get("expires"), now)}
             for r in _perf_rows(reads, PERF["trainings"]) if mine(r)]
    floor90 = now - 90 * DAY_MS
    att90 = sum(1 for r in att if (gsjs.date_parse(gsjs.str_(r.get("date"))) or 0) >= floor90)
    majors = sum(1 for r in inc if gsjs.str_(r.get("severity")) == "Major")
    expired = sum(1 for c in certs if c["status"] == "expired")
    expiring = sum(1 for c in certs if c["status"] == "expiring")
    graded = perf_grade(att90, len(att) - att90, majors, len(inc) - majors, expired, expiring)
    shape = ["g2", gsjs.num_str(graded["grade"]), str(len(att)), str(len(inc)), str(len(notes)), str(len(certs)),
             gsjs.str_(att[0].get("date")) if att else "", gsjs.str_(inc[0].get("date")) if inc else ""]
    kept = next((r for r in _perf_rows(reads, PERF["ai"]) if gsjs.str_(r.get("empid")) == emp_id), None)
    return {"staff": staff, "name": name, "att": att, "inc": inc, "notes": notes, "certs": certs, "graded": graded,
            "hash": "|".join(shape), "kept": kept}


def staff_perf_profile(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffPerfProfile: one staff member's record, the arithmetic grade and the last kept AI paragraph."""
    raw = payload.get("emp_id")
    if raw is None or raw == "":
        return {"status": 400, "message": "Missing required parameter: emp_id."}
    if not perf_is_manager(sess.user):
        return hub_denied()
    emp_id = gsjs.str_(raw)
    if not emp_id:
        return {"status": 400, "message": "emp_id is required."}
    rec = staff_perf_record(sess.reads, emp_id)
    if rec.get("error"):
        return rec["error"]
    kept, s = rec["kept"], rec["staff"]
    ai_grade = gsjs.str_(kept.get("grade")) if kept else ""
    has_rows = bool(rec["att"] or rec["inc"] or rec["notes"] or rec["certs"])
    return {"status": 200, "data": {
        "staff": {"emp_id": emp_id, "name": rec["name"], "status": gsjs.str_(s.get("status")),
                  "phone": gsjs.str_(s.get("phone")), "email": gsjs.str_(s.get("email")),
                  "hire_date": gsjs.str_(s.get("hiredate")), "driver": gsjs.str_(s.get("driver")),
                  "hs_diploma": gsjs.str_(s.get("hsdiploma"))},
        "attendance": [{"date": gsjs.str_(r.get("date")), "kind": gsjs.str_(r.get("kind")),
                        "notes": gsjs.str_(r.get("notes")), "by": gsjs.str_(r.get("loggedby"))}
                       for r in rec["att"][:100]],
        "incidents": [{"date": gsjs.str_(r.get("date")), "type": gsjs.str_(r.get("type")),
                       "severity": gsjs.str_(r.get("severity")), "category": gsjs.str_(r.get("category")),
                       "summary": gsjs.str_(r.get("summary")), "action": gsjs.str_(r.get("actiontaken")),
                       "status": gsjs.str_(r.get("status"))} for r in rec["inc"][:60]],
        "notes": [{"at": gsjs.str_(r.get("createdat")), "category": gsjs.str_(r.get("category")),
                   "text": gsjs.str_(r.get("text"))} for r in rec["notes"][:60]],
        "certs": rec["certs"],
        "grade": {"value": rec["graded"]["grade"], "parts": rec["graded"]["parts"],
                  "ai": js_parse_float(ai_grade) if ai_grade != "" else None},
        "ai": {"summary": gsjs.str_(kept.get("summary")) if kept else "",
               "tags": [t for t in gsjs.str_(kept.get("tags")).split("|") if t] if kept else [],
               "made_at": gsjs.str_(kept.get("madeat")) if kept else ""},
        "ai_stale": gsjs.str_(kept.get("hash")) != rec["hash"] if kept else has_rows}}


# ---- the doors --------------------------------------------------------------------------------------------------

ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "staffProfilePerformance": staff_profile_performance, "employeeLoanList": employee_loan_list}
# Apps Script writes an audit line for these reads (hubSysLog_); their doors here leave every audited answer to it
AUDITED = frozenset({"staffProfilePerformance"})
# spPackDoors_ packs neither part: Performance is audited and Employee Pay is not a pack part
PACK_DOORS: dict[str, Callable[[L.Reads, dict], dict[str, Any]]] = {}
POLICY_ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
POLICY = {"staffProfilePerformance": {"roles": POLICY_ROLES, "params": {"staff": "string"}},
          "employeeLoanList": {"roles": ("admin", "director", "manager", "staff"), "params": {"staff": "string"}}}
# StaffPerformance.gs's own reads (Leadership, Employee Tracker, User Support): not the Staff app's switch
PERF_ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "staffPerfList": staff_perf_list, "staffPerfProfile": staff_perf_profile}
PERF_POLICY = {"staffPerfList": {"roles": ("admin", "manager"), "params": {}},
               "staffPerfProfile": {"roles": ("admin", "manager"), "params": {"emp_id": "string"}}}
