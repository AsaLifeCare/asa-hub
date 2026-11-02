"""Scheduling (apps-script/Scheduling.gs, SchedulingViews.gs) answered off asa-hub-db: the board, the staff calendars and the time off asks."""
from __future__ import annotations

import copy
import functools
import hashlib
import json
import re
import secrets
from datetime import date
from typing import Any, Callable, NamedTuple

import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc
from gsjs import SheetDate, NY
from scope import Defer

APP_ID = "scheduling"
TABS = {"cells": "sched_cells", "rows": "sched_rows", "flows": "sched_flows", "inbox": "sched_inbox",
        "log": "sched_log", "settings": "sched_settings", "drafts": "sched_drafts"}
HEADERS = {
    "sched_cells": ("id", "period_id", "house_code", "date", "row_id", "text", "kind", "start_min", "end_min", "hours",
                    "token", "color", "state", "base", "flow_id", "source", "note", "updated_at", "updated_by"),
    "sched_rows": ("id", "house_code", "location", "row_id", "row_kind", "name", "person_key", "designation", "order",
                   "active", "source", "updated_at", "updated_by"),
    "sched_flows": ("id", "kind", "state", "house_code", "date", "date_to", "row_id", "person", "person_key",
                    "person_uid", "shift_text", "start_min", "end_min", "open_row_id", "replacement",
                    "replacement_key", "replacement_uid", "seats", "reason", "note", "source", "source_ref",
                    "outreach_stage", "outreach_next_at", "outreach_log", "test_mode", "created_at", "created_by",
                    "updated_at", "closed_at", "closed_by"),
    "sched_inbox": ("id", "flow_id", "box", "kind", "seat", "to_uid", "to_email", "to_name", "title", "body",
                    "house_code", "house_label", "date", "shift_text", "state", "answered_by", "answered_at", "note",
                    "link", "test_mode", "created_at"),
    "sched_log": ("id", "at", "by_uid", "by_name", "house_code", "date", "row_id", "was", "now", "via", "flow_id",
                  "note", "undone_at"),
    "sched_settings": ("key", "value", "note", "updated_at", "updated_by"),
    "sched_drafts": ("id", "house_code", "first", "last", "state", "rev", "body", "body_2", "body_3", "body_4",
                     "approved_at", "approved_by", "published_at", "updated_at", "updated_by")}
UNKNOWN = "Unknown action."
LOG_KEEP = 100
REPORT_LIST = 60
SETTING_DEFAULTS = {"directors": "ty.bond@asalifecare.com, brittfrench1316@gmail.com", "cycle_days": "28",
                    "roll_lead_days": "7", "outreach_wait_min": "7", "min_days_ahead": "7"}
FIRST_PERIOD = {"id": "P2026-09-28", "first": "2026-09-28", "last": "2026-10-25", "state": "live", "rolled_from": "",
                "rolled_at": "", "by": ""}
OFF_STATES = frozenset({"called_off", "requested_off", "time_off", "swapped_out"})
ONE_OFF_STATES = frozenset({"called_off", "requested_off", "time_off", "swapped_out", "swap_in", "taken", "training"})
HELD_ONE_OFF = frozenset({"swap_in", "taken", "training"})
STAFF_ROLES = ("admin", "director", "manager", "staff")
NOT_PEOPLE = frozenset({"nurse", "family"})
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
WEEKDAYS = ("SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT")
PREF_DAY_WORDS = ("Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays")
PREFS_OVERRIDE_NOTE = "Override: placed against Staff Preferences"
# SchedulingViews.gs
STAFF_FEATURE = "scheduling.staffCalendars"
TIMEOFF_FEATURE = "scheduling.timeOffRequests"
VIA_STAFF = "staff"
ASK_KINDS = frozenset({"time_off", "request_off"})
ASK_STATES = frozenset({"waiting", "approved", "approved_future"})
# SchedulingFlows.gs
FLOW_TIMED = frozenset({"day", "morning", "afternoon", "evening", "overnight"})
FLOW_HOLDING = frozenset({"scheduled", "swap_in", "taken", "training"})
FLOW_WAITING = frozenset({"waiting", "waiting_staff", "waiting_manager", "waiting_director"})
TO_SOURCE = "time_off_house"
# AlertsConfig.gs: the hours switch (fail-closed) and test mode's words
HOURS_KEY = "mywork_hide_sched_hours"
HIDE_CATALOG_TAB = "hiring_alerts_catalog"
HIDE_SHIPPED = "yes"
TEST_ON = ("on", "true", "1", "test")
TEST_OFF = ("off", "false", "0", "production")
REHEARSAL = ("sheet", "rehearsal", "paper")
EDITORS_ONLY = "Only the house manager, the Scheduling directors and the master edit this calendar."
# Editions.gs: what the master lists people for in Scheduling; each only adds people to a door's own editors
CALENDAR_EDITION = "scheduling.calendar"
BUILDER_EDITION = "scheduling.builder"
SETTINGS_EDITION = "scheduling.settings"
# the people who answer a time off ask beside the listed directors and the master (scheduling_timeoff decides it)
TIME_OFF_EDITION = "scheduling.timeOffApprove"
# a swap asked on anybody's shift, filed by Python (Apps Script's own gate never reads an edition)
SWAPS_EDITION = "scheduling.swaps"
EDITIONS = (CALENDAR_EDITION, BUILDER_EDITION, SETTINGS_EDITION, TIME_OFF_EDITION, SWAPS_EDITION)

_ISO = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})$")
_EPOCH_ORD = date(1970, 1, 1).toordinal()


# ---- small values ----------------------------------------------------------------------------------------------------

def s_(v: Any) -> str:
    """schedStr_."""
    return gsjs.trim(gsjs.or_blank(v))


def refuse(status: int, message: str, data: dict | None = None) -> dict[str, Any]:
    env: dict[str, Any] = {"status": status, "message": message}
    if data is not None:
        env["data"] = data
    return env


def closed() -> dict[str, Any]:
    return refuse(404, UNKNOWN)


def now_iso(reads: L.Reads) -> str:
    return gsjs.iso(reads.now)


def jparse(raw: Any, fallback: Any) -> Any:
    """schedJson_."""
    if isinstance(raw, (dict, list)):
        return raw
    s = s_(raw)
    if not s:
        return fallback
    try:
        return json.loads(s)
    except ValueError:
        return fallback


def int_of(v: Any, fallback: int) -> int:
    """schedIntOf_ (parseInt's leading integer)."""
    m = re.match(r"^[+-]?[0-9]+", s_(v))
    return int(m.group(0)) if m else fallback


def pfloat(v: Any) -> float:
    """parseFloat(v) || 0."""
    m = re.match(r"^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", gsjs.trim(gsjs.or_blank(v)))
    try:
        return float(m.group(0)) if m else 0.0
    except ValueError:
        return 0.0


def js_num(v: Any) -> float | None:
    """Number(v) for a cell's text; None for NaN."""
    t = s_(v)
    if t == "":
        return 0.0
    if not re.fullmatch(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", t):
        return None
    return float(t)


def round2(x: float) -> float:
    return gsjs.js_round(x * 100) / 100


def u16(s: str, n: int) -> str:
    """String.prototype.slice(0, n) on UTF-16 units."""
    b = s.encode("utf-16-le")
    return s if len(b) <= n * 2 else b[:n * 2].decode("utf-16-le", "ignore")


def fold(v: Any) -> str:
    """schedFold_ (clientNameKey_)."""
    return gsjs.name_key(v)


def name_fold(v: Any) -> str:
    """hubNameFold_."""
    return re.sub(r"[^a-z0-9]+", "", gsjs.or_blank(v).lower())


def slug(name: Any) -> str:
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", s_(name).lower()))


def sha16(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


def cell_id(house: str, row_id: str, day: str) -> str:
    return "SC_" + sha16(f"{house}|{row_id}|{day}")


def row_id_of(house: str, row_id: str) -> str:
    return "SR_" + sha16(f"{house}|{row_id}")


def new_id(prefix: str) -> str:
    """schedNewId_: ten upper-case hex after the prefix."""
    return prefix + secrets.token_hex(5).upper()


def js_keys(d: dict) -> list[str]:
    """Object.keys order: array-index keys ascending first, then the rest as written."""
    idx = sorted((k for k in d if re.fullmatch(r"0|[1-9][0-9]{0,9}", str(k)) and int(k) < 4294967295), key=int)
    return idx + [k for k in d if k not in idx]


# ---- days, cut not parsed ----------------------------------------------------------------------------------------------

def iso_valid(iso: Any) -> bool:
    m = _ISO.match(s_(iso))
    if not m:
        return False
    try:
        date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        return True
    except ValueError:
        return False


def day_index(iso: Any) -> int | None:
    m = _ISO.match(s_(iso))
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).toordinal() - _EPOCH_ORD
    except ValueError:
        return None


def iso_of_index(n: int) -> str:
    return date.fromordinal(n + _EPOCH_ORD).isoformat()


def iso_add(iso: Any, days: int) -> str:
    n = day_index(iso)
    return "" if n is None else iso_of_index(n + days)


def dow(iso: Any) -> int:
    n = day_index(iso)
    return 0 if n is None else (n + 4) % 7


def week_key(iso: str) -> str:
    """The estate's week starts on Saturday."""
    if not iso_valid(iso):
        return iso
    return iso_add(iso, -((dow(iso) + 1) % 7))


def dates(first: Any, last: Any) -> list[str]:
    if not iso_valid(first) or not iso_valid(last):
        return []
    a, b = day_index(first), day_index(last)
    return [iso_of_index(n) for n in range(a, b + 1)]


def col_of(iso: str) -> dict[str, str]:
    p = iso.split("-")
    return {"iso": iso, "date": f"{int(p[1])}/{int(p[2])}", "short": f"{MONTHS[int(p[1]) - 1]} {int(p[2])}",
            "weekday": WEEKDAYS[dow(iso)]}


def day_words(iso: Any) -> str:
    if not iso_valid(iso):
        return s_(iso)
    p = s_(iso).split("-")
    wd = WEEKDAYS[dow(iso)]
    return f"{wd[0]}{wd[1:].lower()} {int(p[1])}/{int(p[2])}"


def flow_day_words(iso: Any) -> str:
    """schedFlowDayWords_: EEE M/d."""
    if not iso_valid(iso):
        return gsjs.or_text(iso)
    p = s_(iso).split("-")
    return f"{WEEKDAYS[dow(iso)][0]}{WEEKDAYS[dow(iso)][1:].lower()} {int(p[1])}/{int(p[2])}"


# ---- the cell grammar (server/shift_slices.py classify) -------------------------------------------------------------

_RANGE = re.compile(r"^\*?\s*([0-9]{1,2})(?::?([0-9]{2}))?\s*([AP])?M?\s*[-–]\s*([0-9]{1,2})(?::?([0-9]{2}))?\s*([AP])M?"
                    r"(?:\s+[A-Za-z]{1,4})?\s*$", re.I)
_INSIDE = re.compile(r"([0-9]{1,2})(?::?([0-9]{2}))?\s*([AP])?M?\s*[-–]\s*([0-9]{1,2})(?::?([0-9]{2}))?\s*([AP])M?"
                     r"(?![A-Za-z0-9])", re.I)
NOT_WORKING = frozenset({"OFF", "R/O", "C/O", "RO", "R\\O", "R/0", "NCNS", "NO WORKSHOP"})
_CHAIN = re.compile(r"\s*[><]\s*")


class Cls(NamedTuple):
    kind: str
    code: str
    token: str | None
    start: float | None
    end: float | None
    hours: float


def _hour(h: str, m: str | None, ap: str | None) -> float:
    return int(h) % 12 + (12 if (ap or "").upper() == "P" else 0) + (int(m) / 60 if m else 0)


def _span(m: re.Match) -> tuple[float, float]:
    ap1 = m.group(3) or m.group(6)
    start, end = _hour(m.group(1), m.group(2), ap1), _hour(m.group(4), m.group(5), m.group(6))
    if m.group(3) is None and start >= end:
        start = ((start - 12) % 24 + 24) % 24
    if end <= start:
        end += 24
    return start, end


def _range(segment: str) -> tuple[float, float] | None:
    m = _RANGE.match(s_(segment))
    return _span(m) if m else None


def kind_for(start: float, end: float) -> str:
    if start >= 19 or end > 24:
        return "overnight"
    if end - start >= 11 and start <= 10:
        return "day"
    if start < 11:
        return "morning"
    if start < 16:
        return "afternoon"
    return "evening"


@functools.lru_cache(maxsize=16384)
def _classify(code: str) -> Cls | None:
    if not code:
        return None
    hours = None
    token = None
    for seg in [x for x in _CHAIN.split(code) if gsjs.trim(x)]:
        got = _range(seg)
        if got and hours is None:
            hours = got
        elif not got and token is None:
            up = gsjs.trim(re.sub(r"^\*+", "", gsjs.trim(seg).upper()))
            if up not in NOT_WORKING:
                token = gsjs.trim(seg)
    shown = gsjs.trim(re.sub(r"^\*+", "", code))
    if hours:
        return Cls(kind_for(hours[0], hours[1]), shown, token, hours[0], hours[1], round2(hours[1] - hours[0]))
    up = shown.upper()
    if up == "OFF":
        return Cls("off", "OFF", None, None, None, 0)
    if up in NOT_WORKING:
        return Cls("ro", up, None, None, None, 0)
    return Cls("alias", shown, shown, None, None, 0)


def classify(text: Any) -> Cls | None:
    """schedClassify_: None for an empty cell."""
    return _classify(gsjs.trim(gsjs.or_blank(text)))


def time_inside(text: Any) -> tuple[float, float] | None:
    m = _INSIDE.search(gsjs.or_blank(text))
    return _span(m) if m else None


def range_count(text: Any) -> int:
    return sum(1 for x in _CHAIN.split(gsjs.or_blank(text)) if gsjs.trim(x) and _range(x))


def half(hour: float) -> str:
    total = (int(gsjs.js_round(hour * 60)) % 1440 + 1440) % 1440
    hh, mm = total // 60, total % 60
    return f"{hh % 12 or 12}{(('0' if mm < 10 else '') + str(mm)) if mm else ''}{'P' if hh >= 12 else 'A'}"


def code_of(start: float, end: float) -> str:
    return half(start) + "-" + half(end)


def time_hours(v: Any) -> float | None:
    t = s_(v)
    m = re.fullmatch(r"([0-9]{1,2}):([0-9]{2})", t)
    if m:
        return int(m.group(1)) + int(m.group(2)) / 60
    if not re.fullmatch(r"[0-9]+(\.[0-9]+)?", t):
        return None
    return float(t)


def value_from_times(start: Any, end: Any) -> dict[str, str]:
    """schedValueFromTimes_."""
    s, e = time_hours(start), time_hours(end)
    if s is None or e is None or s < 0 or s >= 24 or e < 0 or e >= 24:
        return {"error": "Start and end must be times of day."}
    if abs(s - e) < 1e-9:
        return {"error": "A shift needs a start and an end that differ."}
    code = code_of(s, e)
    got = classify(code)
    want = ((e - s) % 24 + 24) % 24 or 24
    if not got or got.start is None or abs(got.start - s) > 1e-6 or abs((got.end - got.start) - want) > 1e-6:
        return {"error": code + " would not read back as those hours — type the code instead."}
    return {"code": code}


def clock(hour: float) -> str:
    total = (int(gsjs.js_round(hour * 60)) % 1440 + 1440) % 1440
    hh, mm = total // 60, total % 60
    return f"{hh % 12 or 12}:{mm:02d} {'PM' if hh >= 12 else 'AM'}"


def shift_words(text: Any, long: bool = False) -> str:
    t = gsjs.trim(re.sub(r"^\*+", "", s_(text)))
    if not long:
        return t
    got = classify(t)
    if not got or got.start is None:
        return t
    return clock(got.start) + " – " + clock(got.end)


def row_kind_of(name: Any) -> str:
    s = s_(name)
    if re.match(r"^\s*open(?![a-z])", s, re.I):
        return "open"
    if re.search(r"workshop", s, re.I):
        return "workshop"
    if fold(s) in NOT_PEOPLE:
        return "other"
    return "person"


def open_n(row_id: Any) -> int:
    m = re.fullmatch(r"OPEN:([0-9]+)", s_(row_id))
    return int(m.group(1)) if m else 0


def _row_cmp(a: dict, b: dict) -> float:
    def rank(r: dict) -> int:
        return 0 if r.get("row_kind") == "open" else (1 if r.get("row_kind") == "person" else 2)
    ra, rb = rank(a), rank(b)
    if ra != rb:
        return ra - rb
    if ra == 0:
        return open_n(a.get("row_id")) - open_n(b.get("row_id"))
    return pfloat(a.get("order")) - pfloat(b.get("order"))


def row_sorted(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=functools.cmp_to_key(lambda a, b: (_row_cmp(a, b) > 0) - (_row_cmp(a, b) < 0)))


# ---- the houses (one Data tab each) ------------------------------------------------------------------------------------

def _cell(v: Any) -> str:
    """schedCellText_ off the copy's text."""
    return gsjs.trim(gsjs.or_blank(hubdb.typed(v, "raw")))


def read_tab(reads: L.Reads, tab: str) -> list[dict]:
    """schedRead_: the house's rows, every header a key; a cleared cell (no text, no base) is no cell."""
    def read() -> list[dict]:
        db = reads.db
        if HT.tabled(tab):
            idf = "key" if tab == TABS["settings"] else "id"
            got = [{**{h: "" for h in HEADERS[tab]}, **{h: gsjs.trim(v) for h, v in r.items()}}
                   for r in HT.rows(reads, tab)]
            kept_gone: dict[str, dict] = {}
            if tab == TABS["cells"]:
                # a cleared cell (no text, no base) is no cell, as the copy reads it
                for r in got:
                    if r.get(idf) and not r["text"] and not r["base"]:
                        kept_gone.setdefault(r["id"], r)
                got = [r for r in got if r["text"] or r["base"]]
            reads.memo["sch:gone:" + tab] = kept_gone
            return [r for r in got if r.get(idf)]
        if not db.house_moved(tab):
            raise Defer(f'the Scheduling house "{tab}" is not declared in the copy')
        res = db.resolve(tab)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the Scheduling house {tab}")
            return []
        idf = "key" if tab == TABS["settings"] else "id"
        heads = [gsjs.trim(gsjs.or_blank(h)) for h in res.ref.headers]
        out: list[dict] = []
        gone: dict[str, dict] = {}
        for _rn, raw in db.rows(res.ref):
            row = {h: "" for h in HEADERS[tab]}
            for h, src in zip(heads, res.ref.headers):
                if h:
                    row[h] = _cell(raw.get(src))
            if not row.get(idf):
                continue
            if tab == TABS["cells"] and not row["text"] and not row["base"]:
                gone.setdefault(row["id"], row)
                continue
            out.append(row)
        reads.memo["sch:gone:" + tab] = gone
        return out
    return reads.once("sch:tab:" + tab, read)


def gone_rows(reads: L.Reads, tab: str) -> dict[str, dict]:
    """The cleared rows the copy still holds, by id."""
    read_tab(reads, tab)
    return reads.memo.get("sch:gone:" + tab) or {}


def forget(reads: L.Reads) -> None:
    """Every answer built from the houses read again from the rows as they now stand."""
    for k in [k for k in reads.memo if k.startswith("sch:d:")]:
        del reads.memo[k]


def derived(reads: L.Reads, name: str, fn: Callable[[], Any]) -> Any:
    return reads.once("sch:d:" + name, fn)


def books_of(reads: L.Reads, *tabs: str) -> tuple[str, ...]:
    """The books a verdict on these tabs rests on (none for a house kept in its own table)."""
    out: list[str] = []
    for t in tabs:
        sid = "" if HT.tabled(t) else reads.db.resolve(t).sheet_id
        if sid and sid not in out:
            out.append(sid)
    return tuple(out)


# ---- settings ------------------------------------------------------------------------------------------------------

def live(u: dict | None) -> bool:
    """schedLive_."""
    off = s_((u or {}).get("active")).upper()
    return bool(u) and off not in ("FALSE", "0", "NO") and not s_(u.get("mergedinto"))


def user_by_email(reads: L.Reads, email: str) -> dict | None:
    import staff_perf as SPF  # noqa: PLC0415 - the Staff modules load beside this one
    return SPF.user_by_email(reads, email)


def periods_of(raw: Any) -> list[dict] | None:
    got = jparse(raw, None)
    if not isinstance(got, list):
        return None
    out = []
    for p in got:
        if not isinstance(p, dict) or not iso_valid(p.get("first")) or not iso_valid(p.get("last")):
            continue
        first, last = gsjs.or_blank(p.get("first")), gsjs.or_blank(p.get("last"))
        if not first <= last:
            continue
        out.append({"id": s_(p.get("id")) or "P" + first, "first": first, "last": last,
                    "state": s_(p.get("state")) or "live", "rolled_from": s_(p.get("rolled_from")),
                    "rolled_at": s_(p.get("rolled_at")), "by": s_(p.get("by"))})
    out.sort(key=functools.cmp_to_key(lambda a, b: -1 if a["first"] < b["first"] else (1 if a["first"] > b["first"] else 0)))
    return out


def settings(reads: L.Reads) -> dict[str, Any]:
    """schedSettings_: the settings house over the shipped defaults; directors are never defaulted."""
    def read() -> dict[str, Any]:
        out: dict[str, Any] = {"readable": True, "why": "", "directors": [], "directors_readable": False,
                               "directors_why": "", "cycle_days": 28, "roll_lead_days": 7, "outreach_wait_min": 7,
                               "min_days_ahead": 7, "periods": [dict(FIRST_PERIOD)], "houses": [], "seeded_at": "",
                               "raw": {}}
        kv: dict[str, str] = {}
        for r in read_tab(reads, TABS["settings"]):
            kv[r["key"]] = r.get("value", "")
        out["raw"] = kv
        cyc = int_of(kv.get("cycle_days"), 28)
        out["cycle_days"] = cyc if cyc >= 7 and cyc % 7 == 0 else 28
        out["roll_lead_days"] = max(0, int_of(kv.get("roll_lead_days"), 7))
        out["outreach_wait_min"] = max(1, int_of(kv.get("outreach_wait_min"), 7))
        out["min_days_ahead"] = max(0, int_of(kv.get("min_days_ahead"), 7))
        periods = periods_of(kv.get("periods"))
        if periods:
            out["periods"] = periods
        houses = jparse(kv.get("houses"), None)
        if isinstance(houses, list):
            out["houses"] = [{"code": s_(h.get("code")), "location": s_(h.get("location")),
                              "short": s_(h.get("short")) or s_(h.get("code")), "book_id": s_(h.get("book_id"))}
                             for h in houses if isinstance(h, dict) and s_(h.get("code"))]
        out["seeded_at"] = s_(kv.get("seeded_at"))
        emails = [x for x in (gsjs.trim(t).lower() for t in re.split(r"[,;\s]+", s_(kv.get("directors"))))
                  if x.find("@") > 0]
        missed = []
        for email in emails:
            u = user_by_email(reads, email)
            if u and live(u):
                out["directors"].append({"email": email, "uid": s_(u.get("userid")), "name": s_(u.get("displayname"))})
            else:
                missed.append(email)
        # a live Platform Lead is a director here too, written in the settings or not (the operator's rule)
        held = {d["uid"] for d in out["directors"]}
        for u in reads.users():
            uid = s_(u.get("userid"))
            if uid and uid not in held and live(u) and sc.platform_lead(u):
                held.add(uid)
                out["directors"].append({"email": s_(u.get("email")).lower(), "uid": uid,
                                         "name": s_(u.get("displayname"))})
        out["directors_readable"] = len(out["directors"]) > 0
        if not out["directors"]:
            out["directors_why"] = "No directors are written in the Scheduling settings."
        if missed:
            out["directors_why"] = "No live account answers " + ", ".join(missed) + "."
        return out
    return derived(reads, "settings", read)


def period_of(reads: L.Reads, day: str) -> dict | None:
    return next((p for p in settings(reads)["periods"] if p["first"] <= day <= p["last"]), None)


def period_by_id(reads: L.Reads, pid: str) -> dict | None:
    return next((p for p in settings(reads)["periods"] if p["id"] == pid), None)


def current_period(reads: L.Reads) -> dict:
    """The period holding Ohio's today; before the first, the first; after the last, the last."""
    periods, today = settings(reads)["periods"], reads.today()
    hit = period_of(reads, today)
    if hit:
        return hit
    if not periods:
        return dict(FIRST_PERIOD)
    return periods[0] if today < periods[0]["first"] else periods[-1]


def house_list(reads: L.Reads) -> list[dict]:
    def read() -> list[dict]:
        s = settings(reads)
        if s["houses"]:
            return s["houses"]
        seen: set[str] = set()
        out = []
        for r in read_tab(reads, TABS["rows"]):
            if not r["house_code"] or r["house_code"] in seen:
                continue
            seen.add(r["house_code"])
            out.append({"code": r["house_code"], "location": r["location"], "short": r["house_code"], "book_id": ""})
        return out
    return derived(reads, "houses", read)


def house_label(reads: L.Reads, code: Any) -> str:
    c = s_(code)
    h = next((h for h in house_list(reads) if h["code"] == c), None)
    return (h["short"] or c) if h else c


def house_ctx(reads: L.Reads, raw: Any) -> dict[str, Any]:
    """A Scheduling house by its code: {code, location, short, label, book_id}, or {refused}."""
    code = s_(raw)
    if not code:
        return {"refused": refuse(400, "Pick a house.")}
    h = next((h for h in house_list(reads) if h["code"] == code), None)
    if not h:
        return {"refused": refuse(404, "There is no such house.")}
    return {"code": code, "location": h["location"], "short": h["short"] or code, "label": h["short"] or code,
            "book_id": h["book_id"]}


def house_tokens(reads: L.Reads) -> dict[str, str]:
    """Upper short name, code and location → code, for reading an alias that names a house."""
    def read() -> dict[str, str]:
        out: dict[str, str] = {}
        for h in house_list(reads):
            for t in (h["code"], h["short"], h["location"]):
                up = s_(t).upper()
                if up:
                    out[up] = h["code"]
                tight = re.sub(r"\s+", "", up)
                if tight:
                    out[tight] = h["code"]
        return out
    return derived(reads, "tokens", read)


def names_house(text: Any, tokens: dict[str, str]) -> str:
    for part in _CHAIN.split(re.sub(r"^\*+", "", gsjs.or_blank(text))):
        up = gsjs.trim(part).upper()
        if not up:
            continue
        if up in tokens:
            return tokens[up]
        tight = re.sub(r"\s+", "", up)
        if tight in tokens:
            return tokens[tight]
    return ""


# ---- accounts ----------------------------------------------------------------------------------------------------

def accounts(reads: L.Reads) -> dict[str, list[dict]]:
    """schedAccounts_: live accounts by display-name fold."""
    def read() -> dict[str, list[dict]]:
        out: dict[str, list[dict]] = {}
        for u in reads.users():
            if not live(u):
                continue
            k = name_fold(u.get("displayname"))
            if k:
                out.setdefault(k, []).append(u)
        return out
    return reads.once("sch:accounts", read)


def phone_of(accts: list[dict] | None) -> str:
    """The phone on the person's one account; none when the name folds to no account or to several."""
    return s_(accts[0].get("phone")) if accts and len(accts) == 1 else ""


def user_by_key(reads: L.Reads, key: Any) -> dict | None:
    hits = accounts(reads).get(s_(key)) or []
    if len(hits) != 1:
        return None
    u = hits[0]
    return {"uid": s_(u.get("userid")), "email": s_(u.get("email")).lower(), "name": s_(u.get("displayname")),
            "role": s_(u.get("role")), "types": u.get("types")}


def key_of(reads: L.Reads, user: dict | None, uid: str) -> str:
    """schedKeyOf_: the display-name fold, only when no other live account folds the same."""
    u = user or {}
    key = name_fold(u.get("display_name") if u.get("display_name") is not None else u.get("displayname"))
    if not key:
        return ""
    hits = accounts(reads).get(key) or []
    if len(hits) > 1:
        return ""
    if len(hits) == 1 and s_(hits[0].get("userid")) != uid:
        return ""
    return key


# ---- the gate ------------------------------------------------------------------------------------------------------

def test_mode(reads: L.Reads) -> dict[str, Any]:
    """schedTestMode_ over hubTestModeState_: anything unreadable or unknown is on."""
    cfg = reads.config()
    raw = gsjs.trim(gsjs.or_blank(cfg.get("test_mode"))).lower()

    def items(v: Any) -> list[str]:
        return [x for x in (t.strip() for t in re.split(r"[,;\n]+", gsjs.or_blank(v))) if x]

    if raw in TEST_ON or raw in REHEARSAL:
        on, unknown = True, ""
    elif raw in TEST_OFF:
        on, unknown = False, ""
    elif not raw:
        sms = {"+1" + d for d in (re.sub(r"^1", "", re.sub(r"\D", "", x)) for x in items(cfg.get("test_redirect_sms")))
               if len(d) == 10}
        mails = {x for x in items(cfg.get("test_redirect_email")) if re.fullmatch(r"[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+", x)}
        on, unknown = (len(sms) + len(mails)) > 0, ""
    else:
        on, unknown = True, raw
    if unknown:
        return {"on": True, "readable": False,
                "why": 'test_mode reads "' + unknown[:40] + '", a word the switch does not know (on or off) — held as '
                       "on until it is saved as one of them"}
    return {"on": on, "readable": True, "why": "Test mode is on: texts are held." if on else ""}


def _hide_default(reads: L.Reads) -> str:
    """hubMyWorkHideDefaults_ for the hours key: the catalogue's default, else the shipped one."""
    db = reads.db
    if HT.tabled(HIDE_CATALOG_TAB):
        headers, rows = HT.raw(reads, HIDE_CATALOG_TAB)
    else:
        if not db.house_moved(HIDE_CATALOG_TAB):
            return HIDE_SHIPPED
        res = db.resolve(HIDE_CATALOG_TAB)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable("asa-hub-db holds no copy of the configuration catalogue's book")
            return HIDE_SHIPPED
        headers, rows = list(res.ref.headers), db.rows(res.ref)
    head = [gsjs.trim(gsjs.or_blank(h)).lower() for h in headers]
    if "key" not in head:
        return HIDE_SHIPPED
    at_key = headers[head.index("key")]
    at_value = headers[head.index("default_value")] if "default_value" in head else None
    out = HIDE_SHIPPED
    for _rn, raw in rows:
        if gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(at_key), "hub"))) != HOURS_KEY:
            continue
        v = gsjs.or_blank(hubdb.typed(raw.get(at_value), "hub")) if at_value is not None else ""
        out = v if gsjs.trim(v) else HIDE_SHIPPED
    return out


def hours_hidden(reads: L.Reads, ctx: dict | None) -> bool:
    """Hours travel to the master always, to everyone else only when the switch reads plainly no (fail-closed)."""
    if ctx and ctx.get("is_master"):
        return False

    def read() -> bool:
        cfg = reads.config()
        try:
            raw = cfg[HOURS_KEY] if HOURS_KEY in cfg else _hide_default(reads)
        except hubdb.Unreadable:
            raise
        except Exception:  # noqa: BLE001 - a switch that cannot be read hides
            return True
        return gsjs.trim(gsjs.or_blank(raw)).lower() not in ("no", "off", "false", "0")
    return reads.once("sch:hours_hidden", read)


def house_managers(reads: L.Reads, code: str) -> list[dict]:
    return [{"name": r["name"], "key": r["person_key"]} for r in read_tab(reads, TABS["rows"])
            if r["house_code"] == code and r["active"] != "no" and r["row_kind"] == "person" and r["designation"] == "**"]


def editions_held(reads: L.Reads, user: dict | None) -> list[str]:
    """The Scheduling editions this session makes (scope.edition_allows), in catalogue order."""
    if not user or user.get("is_service"):
        return []
    cfg = reads.config()
    return [e for e in EDITIONS if sc.edition_allows(e, user, cfg)]


def ctx_for(reads: L.Reads, user: dict | None, got: dict | None) -> dict[str, Any]:
    """schedCtxFor_: the viewer's context behind an open gate; closed for any other. `edits` adds the calendar edition."""
    ctx: dict[str, Any] = {"open": False, "scope": None, "user": user, "uid": "", "name": "", "key": "",
                           "is_master": False, "is_director": False, "editor_of": lambda _code: False,
                           "editions": [], "calendar_edition": False, "builder_edition": False,
                           "settings_edition": False, "swaps_edition": False, "edits": lambda _code: False}
    if not got or not got.get("open"):
        return ctx
    u = user or {}
    ctx["open"] = True
    ctx["scope"] = got.get("scope")
    ctx["uid"] = "" if u.get("is_service") else s_(u.get("id"))
    ctx["name"] = s_(u.get("display_name") if u.get("display_name") is not None else u.get("displayname")) or \
        s_(u.get("email"))
    ctx["key"] = key_of(reads, user, ctx["uid"])
    ctx["is_master"] = sc.is_real_master(user)
    ctx["is_director"] = bool(ctx["uid"] and any(d["uid"] == ctx["uid"] for d in settings(reads)["directors"]))

    def editor_of(code: str) -> bool:
        if ctx["is_master"] or ctx["is_director"]:
            return True
        if not ctx["key"]:
            return False
        return any(m["key"] == ctx["key"] for m in house_managers(reads, code))
    ctx["editor_of"] = editor_of
    held = editions_held(reads, user)
    ctx["editions"] = held
    ctx["calendar_edition"] = CALENDAR_EDITION in held
    ctx["builder_edition"] = BUILDER_EDITION in held
    ctx["settings_edition"] = SETTINGS_EDITION in held
    ctx["swaps_edition"] = SWAPS_EDITION in held

    def edits(code: str) -> bool:
        return editor_of(code) or ctx["calendar_edition"]
    ctx["edits"] = edits
    return ctx


def gate(sess: L.Session) -> dict[str, Any]:
    """schedGate_: hubProfileAppGate_ for Scheduling, then the viewer's context."""
    def read() -> dict[str, Any]:
        got = sc.profile_app_gate(APP_ID, sess.user, sess.reads.scope_sources())
        return ctx_for(sess.reads, sess.user, got)
    return sess.reads.once("sch:gate", read)


def view_gate(sess: L.Session, feature: str) -> dict[str, Any]:
    """schedViewGate_: Scheduling's gate, then the screen's own App Control row (the master always)."""
    ctx = dict(gate(sess))
    if not ctx["open"] or ctx["is_master"]:
        return ctx
    got = sc.profile_app_gate(feature, sess.user, sess.reads.scope_sources())
    if not got or not got.get("open"):
        ctx["open"] = False
    return ctx


def staff_gate(sess: L.Session) -> dict[str, Any]:
    """schedViewStaffGate_: a viewer Staff shows every staff member whole; Staff's view, never widened by an edition."""
    import staff as SP  # noqa: PLC0415 - the Staff core loads beside this module
    ctx = ctx_for(sess.reads, sess.user, SP.whole_gate(sess))
    ctx.update({"editions": [], "calendar_edition": False, "builder_edition": False, "settings_edition": False,
                "swaps_edition": False, "edits": ctx["editor_of"]})
    return ctx


# ---- the overlap law ---------------------------------------------------------------------------------------------

def cell_private(cell: dict) -> bool:
    state = s_(cell.get("state"))
    if state in ("called_off", "time_off"):
        return True
    c = classify(cell.get("text"))
    return bool(c and c.kind == "ro" and c.code == "C/O")


def hold_of(cell: dict, tokens: dict[str, str]) -> dict | None:
    """schedHoldOf_: what one stored cell holds against its person."""
    text, state = s_(cell.get("text")), s_(cell.get("state"))
    if not text and state not in OFF_STATES:
        return None
    n = day_index(cell.get("date"))
    if n is None:
        return None
    day = n * 1440
    c = classify(text)
    whole: dict[str, Any] = {"s": day, "e": day + 1440, "whole": True}
    if state == "swapped_out":
        return None
    if state in OFF_STATES or (c and c.kind == "ro"):
        whole["why"] = "off"
        whole["private"] = cell_private(cell)
        return whole
    if not c or c.kind == "off":
        return None
    if c.start is not None:
        return {"s": day + int(gsjs.js_round(c.start * 60)), "e": day + int(gsjs.js_round(c.end * 60)), "why": "overlap"}
    inside = time_inside(text)
    if inside:
        return {"s": day + int(gsjs.js_round(inside[0] * 60)), "e": day + int(gsjs.js_round(inside[1] * 60)),
                "why": "overlap"}
    whole["why"] = "unreadable"
    whole["named"] = names_house(text, tokens)
    return whole


def hold_index(cells: list[dict], rows: list[dict], flows: list[dict], tokens: dict[str, str]) -> dict[str, list[dict]]:
    """Every hold of every person: {key: [{house_code, date, text, s, e, whole, named, why, cell_id}]}."""
    person_of = {r["house_code"] + "|" + r["row_id"]: r["person_key"] for r in rows
                 if r.get("row_kind") == "person" and r.get("person_key")}
    out: dict[str, list[dict]] = {}
    for c in cells:
        key = person_of.get(c["house_code"] + "|" + c["row_id"])
        if not key:
            continue
        h = hold_of(c, tokens)
        if not h:
            continue
        h.update({"house_code": c["house_code"], "date": c["date"], "text": c["text"] or c["base"] or "",
                  "cell_id": c["id"]})
        out.setdefault(key, []).append(h)
    for f in flows or []:
        if f.get("kind") != "time_off" or f.get("state") not in ("approved", "approved_future") or not f.get("person_key"):
            continue
        if not iso_valid(f.get("date")):
            continue
        to = f["date_to"] if iso_valid(f.get("date_to")) else f["date"]
        for d in dates(f["date"], to):
            day = day_index(d) * 1440
            out.setdefault(f["person_key"], []).append({"s": day, "e": day + 1440, "whole": True, "why": "time_off",
                                                        "house_code": "", "date": d, "text": "time off", "cell_id": "",
                                                        "flow_id": f["id"], "private": True})
    return out


def holds_now(reads: L.Reads) -> dict[str, list[dict]]:
    return derived(reads, "holds", lambda: hold_index(read_tab(reads, TABS["cells"]), read_tab(reads, TABS["rows"]),
                                                      read_tab(reads, TABS["flows"]), house_tokens(reads)))


def clash(reads: L.Reads, person_key: Any, day: str, start_min: Any, end_min: Any, *, ignore: tuple = (),
          house_code: str = "", value: str = "") -> dict | None:
    """schedClash_: None when the person is free, or the first thing they hold against the span."""
    key = s_(person_key)
    if not key or not iso_valid(day):
        return None
    holds = holds_now(reads).get(key) or []
    base = day_index(day) * 1440
    unread = start_min is None or start_min == ""
    s, e = (base, base + 1440) if unread else (base + float(start_min), base + float(end_min))
    placing = s_(house_code)
    tokens = house_tokens(reads)
    named = names_house(value, tokens) if value else ""
    for h in holds:
        if h.get("cell_id") and h["cell_id"] in ignore:
            continue
        if h.get("whole") and h.get("named") and placing and h["named"] == placing:
            continue
        if unread and named and h["house_code"] == named:
            continue
        if h["s"] < e and s < h["e"]:
            return {"house_code": h["house_code"], "date": h["date"], "text": h["text"],
                    "why": "unreadable" if unread and h["why"] == "overlap" else h["why"], "private": bool(h.get("private"))}
    return None


def sees_why(ctx: dict | None, key: str, code: str) -> bool:
    if not ctx:
        return False
    if ctx.get("is_master") or ctx.get("is_director"):
        return True
    if key and ctx.get("key") and ctx["key"] == key:
        return True
    if not code:
        return False
    try:
        return bool((ctx.get("edits") or ctx["editor_of"])(code))
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - as Apps Script's try
        return False


def clash_sentence(reads: L.Reads, name: str, hit: dict, ctx: dict | None, key: str) -> str:
    if hit.get("private") and ctx is not None and not sees_why(ctx, key, hit["house_code"]):
        return "Not possible: " + name + " is not free that day."
    if hit["why"] == "time_off":
        return "Not possible: " + name + " has approved time off that day."
    return ("Not possible: " + name + " is already at " + house_label(reads, hit["house_code"]) + " " +
            shift_words(hit["text"]) + " that day.")


def value_span(c: Cls | None, value: str) -> tuple[int, int] | None:
    if c and c.start is not None:
        return int(gsjs.js_round(c.start * 60)), int(gsjs.js_round(c.end * 60))
    inside = time_inside(value)
    return (int(gsjs.js_round(inside[0] * 60)), int(gsjs.js_round(inside[1] * 60))) if inside else None


# ---- Staff Preferences ---------------------------------------------------------------------------------------------

def prefs_index(reads: L.Reads) -> dict[str, dict]:
    """spPrefsIndex_: what placements read, for every staff key; {} while not set up."""
    def read() -> dict[str, dict]:
        import staff as SP  # noqa: PLC0415 - the Staff core loads beside this module
        db = reads.db
        if not db.house_moved(SP.PREFS_TAB):
            return {}
        res = db.resolve(SP.PREFS_TAB)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the house behind {SP.PREFS_TAB}")
            raise Defer(f"the {SP.PREFS_TAB} house holds no tab in the copy: Apps Script makes it on its first read")
        out: dict[str, dict] = {}
        for r in db.locations_rows(res.ref):
            k = gsjs.trim(gsjs.or_text(r.get("staff_key")))
            if not k:
                continue
            p = SP.prefs_of(r)
            if not p["unavailable_locations"] and not p["unavailable_days"]["a"] and not p["unavailable_days"]["b"]:
                continue
            out[k] = {"houses": p["unavailable_locations"], "days": p["unavailable_days"]}
        return out
    return reads.once("sch:prefs", read)


def prefs_against(reads: L.Reads, person_key: Any, name: Any, code: str, day: str) -> dict | None:
    """schedPrefsAgainst_: what the person's Staff Preferences say against working at `code` on `day`."""
    key = s_(person_key)
    if not key:
        return None
    p = prefs_index(reads).get(key)
    if not p:
        return None
    says, fields = [], []
    if code and code in (p.get("houses") or []):
        says.append("cannot work at " + house_label(reads, code))
        fields.append("unavailable_locations")
    period = period_of(reads, day) if day and iso_valid(day) else None
    if period:
        week = "b" if ((day_index(day) - day_index(period["first"])) // 7) % 2 else "a"
        d = dow(day)
        if WEEKDAYS[d].lower() in ((p.get("days") or {}).get(week) or []):
            says.append("are unavailable on " + PREF_DAY_WORDS[d] + " in Week " + week.upper())
            fields.append("unavailable_days")
    if not says:
        return None
    return {"why": s_(name) + "'s Staff Preferences say they " + " and ".join(says) + ".", "fields": fields}


def prefs_refusal(against: dict) -> dict[str, Any]:
    return {"status": 409, "message": against["why"], "data": {"needs_override": True, "reason": against["why"]}}


# ---- badges ------------------------------------------------------------------------------------------------------

def med_levels(certs: dict | None) -> list[int]:
    """Every Medication Administration level held (valid or expiring, its evidence approved), lowest first."""
    out: list[int] = []
    for n in (1, 2, 3):
        c = (certs or {}).get(f"med{n}")
        if not isinstance(c, dict) or not s_(c.get("expires")) or c.get("evidence") == "submitted":
            continue
        if c.get("status") in ("valid", "expiring"):
            out.append(n)
    return out


def med_level(certs: dict | None) -> int:
    levels = med_levels(certs)
    return levels[-1] if levels else 0


def _cert_picture(reads: L.Reads) -> dict[str, dict]:
    """certPicture_ for everyone in one pass (staff.cert_picture's rules): the Master, the tracker, MAIS, the clearances."""
    import staff as SP  # noqa: PLC0415 - the Staff core loads beside this module
    by: dict[str, dict] = {}

    def touch(nm: Any) -> dict | None:
        k = gsjs.name_key(nm)
        if not k:
            return None
        if k not in by:
            by[k] = {"name": gsjs.trim(gsjs.js_str(nm)), "certs": {}}
        return by[k]

    now_ms = reads.now.timestamp() * 1000.0
    soon = now_ms + SP.cert_expiring_days(reads) * 24 * 3600 * 1000
    master_cols = SP.cfg_pairs(reads, "ist_cert_master_columns")["map"]
    training_keys = {gsjs.trim(k.lower()): v for k, v in SP.cfg_pairs(reads, "ist_cert_training_keys")["map"].items()}
    f = {k: SP.cert_source_field(reads, k) for k in ("master.name", "trainings.name", "trainings.course",
                                                    "trainings.status", "trainings.expires", "mais.name",
                                                    "mais.status", "mais.expires", "mais.category")}
    master_rows = SP.cert_read_tab(reads, SP.cert_source_tab(reads, "master"))
    rows_of: dict[str, int] = {}
    active_of: set[str] = set()
    # the row's name as staff.master_name reads it: the configured field, else First + Last
    for r in master_rows:
        k = gsjs.name_key(SP.master_name(r, f["master.name"]))
        if k:
            rows_of[k] = rows_of.get(k, 0) + 1
            if SP._status_active(r):
                active_of.add(k)
    for r in master_rows:
        k = gsjs.name_key(SP.master_name(r, f["master.name"]))
        if k and rows_of[k] > 1 and k in active_of and not SP._status_active(r):
            continue
        p = touch(SP.master_name(r, f["master.name"]))
        if not p:
            continue
        for label, cred in master_cols.items():
            ms = SP._cert_ms(r.get(label))
            if ms is None:
                continue
            p["certs"][cred] = {"status": "expired" if ms < now_ms else ("expiring" if ms < soon else "valid"),
                                "expires": gsjs.or_text(r.get(label))}
    for r in SP.cert_read_tab(reads, SP.cert_source_tab(reads, "trainings")):
        course = training_keys.get(gsjs.trim(SP.cert_field_of(r, f["trainings.course"]).lower()))
        if not course:
            continue
        p = touch(SP.cert_field_of(r, f["trainings.name"]))
        if not p:
            continue
        st = SP.cert_state_of(reads, "ist_cert_tracker_statuses", SP.cert_field_of(r, f["trainings.status"]), "expiring")
        p["certs"][course] = {"status": "expired" if st == "expired" else "expiring",
                              "expires": SP.cert_field_of(r, f["trainings.expires"])}
    latest: dict[str, dict] = {}
    for r in SP.cert_read_tab(reads, SP.cert_source_tab(reads, "mais")):
        if SP.cert_state_of(reads, "ist_cert_mais_statuses", SP.cert_field_of(r, f["mais.status"]), "expired") == "skip":
            continue
        nm = SP.cert_field_of(r, f["mais.name"])
        k = gsjs.name_key(nm)
        if not k:
            continue
        ms = SP._cert_ms(SP.cert_field_of(r, f["mais.expires"])) or 0
        if k not in latest or ms > latest[k]["ms"]:
            latest[k] = {"ms": ms, "row": r, "name": nm}
    for k, got in latest.items():
        p = touch(got["name"])
        if not p:
            continue
        r2 = got["row"]
        certified = SP.cert_state_of(reads, "ist_cert_mais_statuses", SP.cert_field_of(r2, f["mais.status"]),
                                     "expired") == "certified"
        expires2 = SP.cert_field_of(r2, f["mais.expires"])
        ms2 = SP._cert_ms(expires2)
        st = ("expired" if not certified or (ms2 is not None and ms2 < now_ms)
              else "expiring" if ms2 is not None and ms2 < soon else "valid")
        p["certs"][SP.CERT_MAIS_KEY] = {"status": st, "expires": expires2,
                                        "category": SP.cert_field_of(r2, f["mais.category"])}
    overlay = _clearances(reads, SP)
    if overlay:
        local = reads.now.astimezone(NY)
        today_ms = local.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000.0
        for k, recs in overlay.items():
            person = by.get(k)
            if person is None:
                person = by[k] = {"name": "", "certs": {c: {"status": "missing", "expires": ""}
                                                         for c in SP.CLEARANCE_CREDENTIALS}}
            for cred in SP.CLEARANCE_CREDENTIALS:
                rec = recs.get(cred)
                if not rec:
                    continue
                if not person["name"] and rec["name"]:
                    person["name"] = rec["name"]
                cur = person["certs"].get(cred) or {"status": "missing", "expires": ""}
                if rec["decision"] == "revoked":
                    person["certs"][cred] = {"status": "expired", "expires": cur.get("expires") or ""}
                    continue
                exp = SP._clearance_ms(rec["expires_on"])
                if exp is not None and exp < today_ms:
                    person["certs"][cred] = {"status": "expired", "expires": rec["expires_on"]}
                    continue
                now_word = gsjs.or_text(cur.get("status")).lower()
                if now_word in ("expired", "expiring") or (now_word and now_word != "missing"):
                    continue
                verified = rec["decision"] == "verified"
                person["certs"][cred] = {"status": "valid" if verified else "expiring", "expires": rec["expires_on"] or "",
                                         "evidence": "verified" if verified else "submitted"}
    return by


def _clearances(reads: L.Reads, SP: Any) -> dict[str, dict[str, dict]]:
    """clearanceOverlay_ for everyone: person key → the last row per credential."""
    res = reads.db.resolve(SP.CLEARANCE_TAB)
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {SP.CLEARANCE_TAB}")
        return {}
    grid = reads.db.grid(res.ref)
    hdr = [hubdb.norm_key(h) for h in grid[0]]
    if "personkey" not in hdr or "credential" not in hdr:
        return {}

    def at(line: list, k: str) -> str:
        return gsjs.trim(gsjs.or_text(hubdb.typed(line[hdr.index(k)], "hub"))) if k in hdr else ""

    out: dict[str, dict[str, dict]] = {}
    for line in grid[1:]:
        pk, cred = at(line, "personkey"), at(line, "credential").lower()
        if not pk or cred not in SP.CLEARANCE_CREDENTIALS:
            continue
        rec = {"decision": at(line, "decision").lower(), "expires_on": at(line, "expireson"),
               "file_id": at(line, "fileid"), "state_ref": at(line, "stateref"), "name": at(line, "personname")}
        if not rec["file_id"] and not rec["state_ref"] and rec["decision"] != "revoked":
            continue
        out.setdefault(pk, {})[cred] = rec
    return out


def meds_of(reads: L.Reads, key: str) -> list[int]:
    """certPicture_'s Medication Administration levels, every one held; none at all when the certificates fail."""
    def read() -> dict[str, list[int]]:
        try:
            return {k: med_levels(p.get("certs")) for k, p in _cert_picture(reads).items()}
        except (Defer, hubdb.Unreadable):
            raise
        except Exception:  # noqa: BLE001 - Apps Script's badges carry no level when the certificates fail
            return {}
    return reads.once("sch:meds", read).get(key, [])


def med_of(reads: L.Reads, key: str) -> int:
    """The highest Medication Administration level held, 0 for none."""
    levels = meds_of(reads, key)
    return levels[-1] if levels else 0


def leads(reads: L.Reads) -> set[str]:
    """The live accounts wearing TEAMLEAD, by display-name fold."""
    def read() -> set[str]:
        out: set[str] = set()
        for u in reads.users():
            if live(u) and "TEAMLEAD" in sc.badges_worn(u.get("types"), u.get("role")):
                k = name_fold(u.get("displayname"))
                if k:
                    out.add(k)
        return out
    return reads.once("sch:leads", read)


# ---- the board -----------------------------------------------------------------------------------------------------

def exchange_of(f: dict) -> dict | None:
    """An exchange's partner shift (outreach_log.exchange), or None."""
    if not f or f.get("kind") != "swap":
        return None
    log = jparse(f.get("outreach_log"), {})
    ex = log.get("exchange") if isinstance(log, dict) else None
    if not isinstance(ex, dict) or not s_(ex.get("house")) or not re.match(r"^P:.", s_(ex.get("row_id"))) or \
            not iso_valid(ex.get("date")):
        return None
    return ex


def _seat_out(reads: L.Reads, s: Any) -> dict[str, Any]:
    """One seat as schedFlowOut_ writes it ({seat: s && s.seat, …}, undefined keys dropped)."""
    if not isinstance(s, dict):
        return {"seat": s, "state": s, "at": s, "why": s, "to": []} if gsjs.falsy(s) else {"to": []}
    o: dict[str, Any] = {k: s[k] for k in ("seat", "state", "at", "why") if k in s}
    to = s.get("to") if isinstance(s.get("to"), list) else []
    o["to"] = [({"name": t["name"]} if "name" in t else {}) if isinstance(t, dict)
               else ({"name": t} if gsjs.falsy(t) else {}) for t in to]
    if not gsjs.falsy(s.get("house")):
        o["house"] = s["house"]
        o["house_label"] = house_label(reads, s["house"])
    return o


def flow_out(reads: L.Reads, f: dict, with_reason: bool) -> dict[str, Any]:
    """schedFlowOut_."""
    seats = jparse(f.get("seats"), [])
    ex = exchange_of(f)
    o: dict[str, Any] = {"id": f["id"], "kind": f["kind"], "state": f["state"], "house_code": f["house_code"],
                         "house_label": house_label(reads, f["house_code"]), "date": f["date"], "date_to": f["date_to"],
                         "row_id": f["row_id"], "person": f["person"], "shift_text": f["shift_text"],
                         "open_row_id": f["open_row_id"], "replacement": f["replacement"],
                         "seats": [_seat_out(reads, s) for s in seats] if isinstance(seats, list) else []}
    if ex:
        o["exchange"] = {"house_code": ex["house"], "house_label": house_label(reads, ex["house"]), "date": ex["date"],
                         "row_id": ex["row_id"], "shift_text": s_(ex.get("text"))}
    if with_reason:
        o["reason"] = f["reason"]
    o.update({"note": f["note"], "source": f["source"], "test_mode": f["test_mode"], "created_at": f["created_at"],
              "updated_at": f["updated_at"], "closed_at": f["closed_at"]})
    return o


def build_base(reads: L.Reads, period: dict) -> dict[str, Any]:
    """schedBuildBase_: everything about a period nobody's eyes change."""
    st = settings(reads)
    houses = house_list(reads)
    rows = read_tab(reads, TABS["rows"])
    all_cells = read_tab(reads, TABS["cells"])
    flows = read_tab(reads, TABS["flows"])
    inbox = read_tab(reads, TABS["inbox"])
    log = read_tab(reads, TABS["log"])
    tokens = house_tokens(reads)
    accts = accounts(reads)
    lead = leads(reads)
    days_ = dates(period["first"], period["last"])
    col = {d: i for i, d in enumerate(days_)}
    cells = [c for c in all_cells if c["date"] in col]

    flow_by_id: dict[str, dict] = {}
    flow_at: dict[str, dict] = {}
    time_off: dict[str, dict[str, str]] = {}
    for f in flows:
        flow_by_id[f["id"]] = {"id": f["id"], "kind": f["kind"], "state": f["state"]}
        if f["state"].startswith("waiting") and f["house_code"] and f["row_id"] and f["date"]:
            def mark(other: Any, f: dict = f) -> dict:
                m = {"id": f["id"], "kind": f["kind"], "state": f["state"]}
                if f["kind"] == "swap" and s_(other):
                    m["with"] = s_(other)
                return m
            flow_at[f["house_code"] + "|" + f["row_id"] + "|" + f["date"]] = mark(f["replacement"])
            ex = exchange_of(f)
            if ex:
                flow_at[s_(ex.get("house")) + "|" + s_(ex.get("row_id")) + "|" + s_(ex.get("date"))] = mark(f["person"])
        if f["kind"] == "time_off" and f["person_key"] and iso_valid(f["date"]):
            word = "asked" if f["state"] == "waiting" else ("approved" if f["state"] in ("approved", "approved_future")
                                                             else "")
            if not word:
                continue
            for d in dates(f["date"], f["date_to"] if iso_valid(f["date_to"]) else f["date"]):
                if d not in col:
                    continue
                mine = time_off.setdefault(f["person_key"], {})
                if mine.get(d) != "approved":
                    mine[d] = word

    holds = hold_index(cells, rows, flows, tokens)
    person_of = {r["house_code"] + "|" + r["row_id"]: r["person_key"] for r in rows
                 if r["row_kind"] == "person" and r["person_key"]}
    timed_at: dict[str, dict[str, list[str]]] = {}
    for c in cells:
        key = person_of.get(c["house_code"] + "|" + c["row_id"])
        if not key or c["state"] in OFF_STATES:
            continue
        k = classify(c["text"])
        if not k or k.start is None:
            continue
        at = timed_at.setdefault(key, {}).setdefault(c["date"], [])
        if c["house_code"] not in at:
            at.append(c["house_code"])
    short_of = {h["code"]: h["short"] or h["code"] for h in houses}
    cell_at = {c["house_code"] + "|" + c["row_id"] + "|" + c["date"]: c for c in cells}

    # a Saturday week can straddle two periods: its hours are counted from every cell of the week
    week_from, week_to = week_key(period["first"]), iso_add(week_key(period["last"]), 6)
    week_hours: dict[str, dict[str, float]] = {}
    for c in all_cells:
        if not c["date"] or c["date"] < week_from or c["date"] > week_to or \
                not person_of.get(c["house_code"] + "|" + c["row_id"]):
            continue
        if c["state"] in OFF_STATES:
            continue
        k = classify(c["text"])
        if not k or k.start is None:
            continue
        wk = week_key(c["date"])
        by = week_hours.setdefault(c["house_code"] + "|" + c["row_id"], {})
        by[wk] = round2(by.get(wk, 0) + k.hours)

    grids: dict[str, dict] = {}
    people: dict[str, dict] = {}
    managers: dict[str, list] = {}
    hm_keys: dict[str, list] = {}
    for h in houses:
        code = h["code"]
        hr = row_sorted([r for r in rows if r["house_code"] == code and r["active"] != "no"])
        day_out = [{"iso": d, "working": 0, "hours": 0} for d in days_]
        managers[code] = []
        hm_keys[code] = []
        out_rows = []
        for r in hr:
            is_person = r["row_kind"] == "person"
            key = r["person_key"] if is_person else ""
            if is_person and key and key not in people:
                people[key] = {"key": key, "name": r["name"], "has_account": len(accts.get(key) or []) == 1,
                               "phone": phone_of(accts.get(key))}
            if is_person and r["designation"] == "**":
                managers[code].append(r["name"])
                if key:
                    hm_keys[code].append(key)
            total = 0.0
            by_week = dict(week_hours.get(code + "|" + r["row_id"]) or {}) if is_person else {}
            line: list[dict | None] = []
            for i, d in enumerate(days_):
                c = cell_at.get(code + "|" + r["row_id"] + "|" + d)
                word = (time_off.get(key) or {}).get(d, "") if key else ""
                if not c or (not c["text"] and not word):
                    elsewhere = [x for x in (timed_at.get(key) or {}).get(d, []) if x != code] if key else []
                    if c and not c["text"]:
                        empty: dict[str, Any] = {"text": "", "kind": "", "state": c["state"]}
                        if c["flow_id"] and c["flow_id"] in flow_by_id:
                            empty["flow"] = dict(flow_by_id[c["flow_id"]])
                        if elsewhere:
                            empty["kind"] = "alias"
                            empty["echo"] = short_of.get(elsewhere[0]) or elsewhere[0]
                        line.append(empty if (empty.get("echo") or empty.get("flow")) else None)
                        continue
                    if word:
                        line.append({"text": "", "kind": "", "state": "scheduled", "time_off": word})
                        continue
                    if is_person and elsewhere:
                        line.append({"text": "", "kind": "alias", "state": "scheduled",
                                     "echo": short_of.get(elsewhere[0]) or elsewhere[0]})
                        continue
                    line.append(None)
                    continue
                k = classify(c["text"])
                cell: dict[str, Any] = {"text": c["text"], "kind": k.kind if k else "", "state": c["state"] or "scheduled"}
                if k and k.start is not None:
                    cell["start"], cell["end"], cell["hours"] = k.start, k.end, k.hours
                flow = flow_at.get(code + "|" + r["row_id"] + "|" + d) or \
                    (flow_by_id.get(c["flow_id"]) if c["flow_id"] else None)
                if flow:
                    cell["flow"] = dict(flow)
                if c["state"] == "called_off" or (k and k.kind == "ro" and k.code == "C/O"):
                    cell["private"] = True
                if c["state"] == "time_off":
                    cell["time_off_state"] = True
                if word:
                    cell["time_off"] = word
                if k and k.start is not None and is_person and c["state"] not in OFF_STATES:
                    total += k.hours
                    # a trainee works the shift beside the DSP: their own hours, never the day's coverage
                    if c["state"] != "training":
                        day_out[i]["working"] += 1
                        day_out[i]["hours"] = round2(day_out[i]["hours"] + k.hours)
                line.append(cell)
            out_rows.append({
                "row_id": r["row_id"], "kind": r["row_kind"], "name": r["name"], "key": key,
                "designation": r["designation"],
                "badges": {"hm": is_person and r["designation"] == "**",
                           "lead": is_person and (r["designation"] == "***" or bool(key and key in lead)),
                           "med": med_of(reads, key) if is_person and key else 0,
                           "meds": meds_of(reads, key) if is_person and key else []},
                "hours": {"period": round2(total), "by_week": by_week} if is_person else None,
                "cells": line})
        grids[code] = {"code": code, "cols": [col_of(d) for d in days_], "rows": out_rows, "days": day_out}

    # [date, start, end, house, 'work' | 'day', private]: the cut drops the sixth, and a private one's house and span
    busy: dict[str, list] = {}
    for key, hs in holds.items():
        busy[key] = []
        for h in hs:
            if h["date"] not in col:
                continue
            day = day_index(h["date"]) * 1440
            busy[key].append([h["date"], h["s"] - day, h["e"] - day, h["house_code"],
                              "work" if h["why"] == "overlap" else "day", 1 if h.get("private") else 0])

    # whoever can be placed but is on no house's rows yet: every live staff-side account a name names alone
    for k, lst in accts.items():
        if k in people or len(lst) != 1:
            continue
        # an SSA or a FAMILY is never staff to place, whatever its role says (scope.role_counts)
        if s_(lst[0].get("role")).lower() not in STAFF_ROLES or not sc.role_counts(lst[0].get("types"), lst[0].get("role")):
            continue
        if sc.is_master_email(lst[0].get("email")):
            continue
        people[k] = {"key": k, "name": s_(lst[0].get("displayname")), "has_account": True, "phone": phone_of(lst)}

    week_back = iso_add(period["first"], -7)
    recent = [f for f in flows if s_(f["date_to"] or f["date"]) >= week_back
              or re.match(r"^(waiting|outreach|approved_future)", f["state"])]
    log_by: dict[str, list] = {}
    for item in sorted(log, key=functools.cmp_to_key(lambda a, b: 1 if a["at"] < b["at"] else (-1 if a["at"] > b["at"] else 0))):
        if not item["house_code"]:
            continue
        lst = log_by.setdefault(item["house_code"], [])
        if len(lst) < LOG_KEEP:
            lst.append({k: item[k] for k in ("id", "at", "by_uid", "by_name", "house_code", "date", "row_id", "was",
                                             "now", "via", "flow_id", "note", "undone_at")})
    periods = st["periods"]
    last_p = periods[-1] if periods else None
    flows_out = []
    for f in recent:
        o = flow_out(reads, f, True)
        o.update({"person_key": f["person_key"], "person_uid": f["person_uid"], "replacement_key": f["replacement_key"],
                  "replacement_uid": f["replacement_uid"]})
        flows_out.append(o)
    return {
        "period": {k: period[k] for k in ("id", "first", "last", "state")},
        "periods": [{k: p[k] for k in ("id", "first", "last", "state")} for p in periods],
        "houses": [{"code": h["code"], "location": h["location"], "short": h["short"] or h["code"]} for h in houses],
        "managers": managers, "hm_keys": hm_keys,
        "settings": {"min_days_ahead": st["min_days_ahead"], "outreach_wait_min": st["outreach_wait_min"],
                     "cycle_days": st["cycle_days"], "roll_lead_days": st["roll_lead_days"],
                     "directors": [d["name"] for d in st["directors"]], "directors_readable": st["directors_readable"],
                     "next_roll_on": iso_add(last_p["last"], -st["roll_lead_days"]) if last_p else ""},
        "grids": grids, "busy": busy,
        "people": [people[k] for k in sorted(people)],
        "flows": flows_out,
        "waiting": [{k: i[k] for k in ("id", "flow_id", "kind", "seat", "to_uid", "title", "body", "house_code",
                                       "house_label", "date", "shift_text", "link", "test_mode", "created_at")}
                    for i in inbox if i["box"] == "work" and i["state"] == "waiting"],
        "log": log_by}


def board_base(reads: L.Reads, period: dict) -> dict[str, Any]:
    return derived(reads, "base:" + period["id"], lambda: build_base(reads, period))


def base_editor(base: dict, ctx: dict, code: str) -> bool:
    """Editor of a house by the rows the base was built from: master, a director, or its ** row."""
    if ctx.get("is_master") or ctx.get("is_director"):
        return True
    return bool(ctx.get("key") and ctx["key"] in ((base.get("hm_keys") or {}).get(code) or []))


def base_edits(base: dict, ctx: dict, code: str) -> bool:
    """What the viewer edits on the board: a house's own editors, or every house for the calendar edition."""
    return base_editor(base, ctx, code) or bool(ctx.get("calendar_edition"))


def _in_flow(f: dict, ctx: dict) -> bool:
    return bool((ctx.get("key") and (f.get("person_key") == ctx["key"] or f.get("replacement_key") == ctx["key"])) or
                (ctx.get("uid") and (f.get("person_uid") == ctx["uid"] or f.get("replacement_uid") == ctx["uid"])))


def cut(reads: L.Reads, base: dict, ctx: dict, house_codes: list | None, person_keys: list | None) -> dict[str, Any]:
    """schedCut_: the viewer's cut — hours, C/O privacy, flows and time off for the privileged, own items."""
    hidden = hours_hidden(reads, ctx)
    in_mine = {f["id"] for f in base["flows"] if _in_flow(f, ctx)}
    grids: dict[str, dict] = {}
    for code, g0 in base["grids"].items():
        if house_codes is not None and code not in house_codes:
            continue
        g = copy.deepcopy(g0)
        privileged = base_edits(base, ctx, code)
        for r in g["rows"]:
            r["me"] = bool(ctx.get("key") and r["kind"] == "person" and r["key"] == ctx["key"])
            own = privileged or r["me"]
            if hidden or r.get("hours") is None:
                r.pop("hours", None)
            kept: list[dict | None] = []
            for c in r["cells"]:
                if not c or (c.get("private") and not own):
                    kept.append(None)
                    continue
                if c.get("time_off_state") and not own:
                    c["state"] = "scheduled"
                for k in ("private", "time_off_state", "flow_id"):
                    c.pop(k, None)
                if not own:
                    fl = c.get("flow")
                    if not (fl and fl.get("kind") == "swap" and fl.get("id") in in_mine):
                        c.pop("flow", None)
                    c.pop("time_off", None)
                if hidden:
                    c.pop("hours", None)
                kept.append(c if (c.get("text") or c.get("echo") or c.get("time_off") or c.get("flow")) else None)
            r["cells"] = kept
        if hidden:
            for d in g["days"]:
                d.pop("hours", None)
        grids[code] = g
    busy: dict[str, list] = {}
    for k, items in base["busy"].items():
        if person_keys is not None and k not in person_keys:
            continue
        out = []
        for b in items:
            sees = not b[5] or (ctx.get("key") and k == ctx["key"]) or ctx.get("is_master") or ctx.get("is_director") or \
                (b[3] and base_edits(base, ctx, b[3]))
            out.append([b[0], b[1], b[2], b[3], b[4] or "work"] if sees else [b[0], 0, 1440, "", "day"])
        busy[k] = out
    mine = []
    for f in base["flows"]:
        if not _in_flow(f, ctx):
            continue
        o = copy.deepcopy(f)
        subject = (ctx.get("key") and f.get("person_key") == ctx["key"]) or (ctx.get("uid") and f.get("person_uid") == ctx["uid"])
        if not subject:
            o.pop("reason", None)
        for k in ("person_key", "person_uid", "replacement_key", "replacement_uid"):
            o.pop(k, None)
        mine.append(o)
    wait_rows: list[dict] = []
    if ctx.get("uid"):
        held: set[str] = set()
        for i in base["waiting"]:
            if i["to_uid"] == ctx["uid"]:
                wait_rows.append(i)
                held.add(i["flow_id"])
        # the master stands in on every director seat: one item per request, never the master's own
        if ctx.get("is_master"):
            for f in base["flows"]:
                if f.get("person_uid") and f["person_uid"] == ctx["uid"]:
                    held.add(f["id"])
            for i in base["waiting"]:
                if i["seat"] != "director" or i["flow_id"] in held:
                    continue
                held.add(i["flow_id"])
                wait_rows.append(i)
    waiting = [{k: v for k, v in i.items() if k != "to_uid"} for i in wait_rows]
    log: dict[str, list] = {}
    logged = False
    for code in grids:
        if not base_edits(base, ctx, code):
            continue
        log[code] = (base.get("log") or {}).get(code) or []
        logged = True
    return {"grids": grids, "busy": busy, "mine": mine, "waiting_on_me": waiting, "hidden": hidden,
            "log": log if logged else None}


def board_part(reads: L.Reads, ctx: dict, period_id: str, house_codes: list | None,
               person_keys: list | None) -> dict[str, Any]:
    """What every write answers with: the named houses and people, cut for this viewer."""
    period = (period_by_id(reads, period_id) if period_id else None) or current_period(reads)
    c = cut(reads, board_base(reads, period), ctx, house_codes, person_keys)
    part = {"grids": c["grids"], "busy": c["busy"], "mine": c["mine"], "waiting_on_me": c["waiting_on_me"]}
    if c["log"]:
        part["log"] = c["log"]
    return part


def answer(reads: L.Reads, ctx: dict, said: str, period_id: str, house_codes: list | None, person_keys: list | None,
           extra: dict | None = None) -> dict[str, Any]:
    """schedAnswer_: the write answer every Scheduling write gives."""
    part = board_part(reads, ctx, period_id, house_codes, person_keys)
    out = {"ok": True, "said": said, "period_id": period_id, "grids": part["grids"], "busy": part["busy"],
           "mine": part["mine"], "waiting_on_me": part["waiting_on_me"], "test_mode": test_mode(reads)}
    if part.get("log"):
        out["log"] = part["log"]
    out.update(extra or {})
    return {"status": 200, "data": out}


def board(reads: L.Reads, ctx: dict, period: dict) -> dict[str, Any]:
    """schedBoard_."""
    base = board_base(reads, period)
    c = cut(reads, base, ctx, None, None)
    editor_of = [h["code"] for h in base["houses"] if base_editor(base, ctx, h["code"])]
    edited = [h["code"] for h in base["houses"] if base_edits(base, ctx, h["code"])]
    today = reads.today()
    houses = []
    for h in base["houses"]:
        g = c["grids"].get(h["code"])
        staff = opened = 0
        for r in (g["rows"] if g else []):
            if r["kind"] == "person":
                staff += 1
            if r["kind"] != "open":
                continue
            for i, cell in enumerate(r["cells"]):
                if cell and cell.get("state") == "open" and "start" in cell and g["cols"][i]["iso"] >= today:
                    opened += 1
        houses.append({"code": h["code"], "location": h["location"], "short": h["short"], "staff": staff,
                       "managers": base["managers"].get(h["code"]) or [], "open": opened})
    display: dict[str, Any] = {"hidden": {"hours": c["hidden"]}}
    if ctx.get("is_master"):
        display["hidden_from_others"] = {"hours": hours_hidden(reads, None)}
    out: dict[str, Any] = {
        "ok": True, "now": now_iso(reads), "today": today, "period": base["period"], "periods": base["periods"],
        "houses": houses,
        "viewer": {"uid": ctx["uid"], "name": ctx["name"], "key": ctx["key"], "is_master": ctx["is_master"],
                   "is_director": ctx["is_director"], "editor_of": editor_of,
                   "can_edit_any": bool(ctx["is_master"] or ctx["is_director"])},
        "test_mode": test_mode(reads), "display": display, "settings": base["settings"],
        "grids": c["grids"], "busy": c["busy"], "people": base["people"], "mine": c["mine"],
        "waiting_on_me": c["waiting_on_me"]}
    # said only to a listed person: the master's board, and everyone else's, stay Apps Script's word for word
    if ctx.get("editions") and not ctx["is_master"]:
        out["viewer"]["editions"] = list(ctx["editions"])
    # the houses where a dropped shift moves at once (House Calendars' drag and drop), said only when there is one
    import scheduling_drag as DR  # noqa: PLC0415 - the drag and drop builds on this module
    moved = DR.houses_for(reads, ctx, [h["code"] for h in base["houses"]])
    if moved:
        out["viewer"]["drag_move"] = moved
    if edited:
        out["log"] = {code: base["log"].get(code) or [] for code in edited}
    return out


def week_hours(reads: L.Reads, person_key: str, day: str) -> float:
    """schedWeekHours_: week hours across every house, for the 40-hour warning."""
    wk, total = week_key(day), 0.0
    person_of = {r["house_code"] + "|" + r["row_id"]: r["person_key"] for r in read_tab(reads, TABS["rows"])
                 if r["row_kind"] == "person"}
    for c in read_tab(reads, TABS["cells"]):
        if person_of.get(c["house_code"] + "|" + c["row_id"]) != person_key or c["state"] in OFF_STATES:
            continue
        if not iso_valid(c["date"]) or week_key(c["date"]) != wk:
            continue
        k = classify(c["text"])
        if k and k.start is not None:
            total += k.hours
    return round2(total)


# ---- the screens beside the house calendars ------------------------------------------------------------------------

def residents(reads: L.Reads) -> dict[str, list[str]] | None:
    """schedViewResidents_: each house's current clients by name, as Locations lists them."""
    try:
        homes: dict[str, dict | None] = {h["code"]: h for h in reads.homes() if h.get("code")}
        clients = reads.client_rows()
        for c in clients:
            hc = L.house_code(c.get("house"))
            if hc and hc not in homes:
                homes[hc] = None
        out: dict[str, list[str]] = {}
        for code, home in homes.items():
            names = [c["name"] for c in L.clients_at(code, home, clients) if c.get("name")]
            if names:
                out[code] = sorted(names)
        return out
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - as Apps Script's try: the clients are left unsaid
        return None


def view_edits(base: dict, ctx: dict) -> dict[str, bool]:
    return {h["code"]: True for h in base.get("houses") or [] if base_editor(base, ctx, h["code"])}


def view_periods(reads: L.Reads) -> list[dict]:
    current = current_period(reads)
    later = [p for p in settings(reads)["periods"] if p["first"] >= current["first"]]
    return later or [current]


def _shift_cmp(a: dict, b: dict) -> int:
    if a["date"] != b["date"]:
        return -1 if a["date"] < b["date"] else 1
    sa, sb = a.get("start", 99), b.get("start", 99)
    if sa != sb:
        return -1 if sa < sb else 1
    return -1 if a["house_code"] < b["house_code"] else (1 if a["house_code"] > b["house_code"] else 0)


def active_staff(reads: L.Reads, base: dict) -> tuple[list[str] | None, str]:
    """Whom Staff Calendars' dropdown lists: the board's people Staff's roster holds as active staff. Pending, inactive
    and archived people, and anyone the roster does not hold as staff (a client, a guardian, a service account), are
    left out. None, with why, when the roster could not be read."""
    import staff as SP  # noqa: PLC0415 - the Staff core loads beside this module
    data, why = L._soft(lambda: reads.once("sp_roster_build:False", lambda: SP.scrub(SP.roster_build(reads, False))))
    if why or not isinstance(data, dict) or not isinstance(data.get("staff"), list):
        return None, f"the staff list could not be read ({(why or 'it gave no answer')[:200]})"
    active = {s_(r.get("key")) for r in data["staff"] if isinstance(r, dict) and r.get("status") == "active"}
    short = "not every staff record could be read just now, so this list may be short" if data.get("degraded") else ""
    return [p["key"] for p in base.get("people") or [] if p["key"] in active], short


def staff_shifts(sess: L.Session, payload: dict) -> dict[str, Any]:
    """schedulingStaffShifts: one person's shifts (or every open one) across every house; { person } is a key, 'open' or ''."""
    reads = sess.reads
    via_staff = s_(payload.get("via")) == VIA_STAFF
    ctx = staff_gate(sess) if via_staff else view_gate(sess, STAFF_FEATURE)
    if not ctx["open"]:
        return closed()
    asked = s_(payload.get("person"))
    is_open = not via_staff and asked.lower() == "open"
    key = "" if is_open else (asked if via_staff else (asked or ctx["key"]))
    if via_staff and not re.fullmatch(r"[a-z0-9]{3,80}", key):
        return refuse(400, "person: a staff key.")
    if via_staff:
        import staff as SP  # noqa: PLC0415 - the Staff core loads beside this module
        # Staff's own-profile rule: a viewer it opens to their own profile alone reads no one else's shifts here
        own = SP.own_only(sess)
        if own is not None and key != own:
            return refuse(403, SP.OWN_ONLY_WORDS)
    periods = view_periods(reads)
    first = board_base(reads, periods[0])
    edits = view_edits(first, ctx)
    anyone = bool(via_staff or ctx["is_master"] or ctx["is_director"] or edits or ctx.get("calendar_edition"))
    if not is_open and not key:
        return refuse(400, "Your account is not matched to one person on the calendar — choose Open.")
    if not is_open and key != ctx["key"] and not anyone:
        return refuse(403, "You can see your own shifts and the open ones.")
    today = reads.today()
    shifts = []
    for p in periods:
        c = cut(reads, board_base(reads, p), ctx, None, None)
        for code, g in c["grids"].items():
            for r in g["rows"]:
                if (r["kind"] != "open") if is_open else (r["kind"] != "person" or r["key"] != key):
                    continue
                for i, cell in enumerate(r["cells"]):
                    iso = g["cols"][i]["iso"] if i < len(g["cols"]) else ""
                    if not cell or not cell.get("text") or not iso or cell.get("kind") == "off":
                        continue
                    if is_open and (iso < today or cell.get("state") == "taken"):
                        continue
                    # Staff's Calendar: the shifts from today on that carry a time — a cell naming another house ("MS",
                    # "48th (A)") or a word with no hours (OFF, R/O) is no shift of this row
                    if via_staff and (iso < today or "start" not in cell):
                        continue
                    s: dict[str, Any] = {"period_id": p["id"], "house_code": code, "row_id": r["row_id"], "date": iso,
                                         "text": cell["text"], "kind": cell["kind"], "state": cell["state"]}
                    if "start" in cell:
                        s["start"], s["end"] = cell["start"], cell["end"]
                    if "hours" in cell:
                        s["hours"] = cell["hours"]
                    if cell.get("flow"):
                        s["flow"] = cell["flow"]
                    if cell.get("time_off"):
                        s["time_off"] = cell["time_off"]
                    b = r.get("badges")
                    if b and (b.get("hm") or b.get("lead") or b.get("med")):
                        s["badges"] = dict(b)
                    shifts.append(s)
    shifts.sort(key=functools.cmp_to_key(_shift_cmp))
    name = ""
    for p in first.get("people") or []:
        if p["key"] == key:
            name = p["name"]
    data: dict[str, Any] = {"ok": True, "today": today, "person": "open" if is_open else key,
                            "name": "Open" if is_open else (name or key), "anyone": anyone,
                            "periods": [{"id": p["id"], "first": p["first"], "last": p["last"]} for p in periods],
                            "shifts": shifts}
    if anyone and not via_staff:
        data["active_staff"], data["active_staff_why"] = active_staff(reads, first)
    if via_staff:
        res = residents(reads)
        codes = {s["house_code"] for s in shifts}
        data["houses"] = [{"code": h["code"], "short": h["short"] or h["code"], "location": h["location"] or "",
                           "clients": (res.get(h["code"]) or []) if res is not None else None}
                          for h in first.get("houses") or [] if h["code"] in codes]
    return {"status": 200, "data": data}


def flow_timed(cell: dict) -> bool:
    if not cell or s_(cell.get("kind")) not in FLOW_TIMED:
        return False
    if s_(cell.get("start_min")) == "" or s_(cell.get("end_min")) == "":
        return False
    a, b = js_num(cell.get("start_min")), js_num(cell.get("end_min"))
    return a is not None and b is not None and b > a


def flow_holds(cell: dict) -> bool:
    """schedFlowHolds_: a person holds this timed shift."""
    return flow_timed(cell) and (s_(cell.get("state")) or "scheduled") in FLOW_HOLDING


def directors(reads: L.Reads, st: dict | None = None) -> dict[str, Any]:
    """schedFlowDirectors_: the directors who can be asked."""
    s = st or settings(reads)
    if not s or s.get("directors_readable") is False:
        return {"readable": False, "list": [], "why": s_((s or {}).get("directors_why")) or
                "the Scheduling directors list could not be read"}
    lst = [{"uid": s_(d["uid"]), "name": s_(d["name"]) or s_(d["email"]), "email": s_(d["email"])}
           for d in s.get("directors") or [] if d and s_(d.get("uid"))]
    return {"readable": True, "list": lst, "why": "" if lst else "no director on the Scheduling list has an account yet"}


def _held_index(cells: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for c in cells or []:
        if not re.match(r"^P:", s_(c.get("row_id"))) or not flow_holds(c):
            continue
        out.setdefault(c["row_id"], []).append(c)
    return out


def _view_holds(reads: L.Reads, held: dict, person_key: str, frm: str, to: str) -> list[dict]:
    got = [c for c in held.get("P:" + s_(person_key)) or [] if frm <= c["date"] <= to]

    def cmp(a: dict, b: dict) -> int:
        if a["date"] != b["date"]:
            return -1 if a["date"] < b["date"] else 1
        d = (js_num(a.get("start_min")) or 0) - (js_num(b.get("start_min")) or 0)
        return (d > 0) - (d < 0)
    got.sort(key=functools.cmp_to_key(cmp))
    return [{"date": c["date"], "house_code": c["house_code"], "house_label": house_label(reads, c["house_code"]),
             "text": c["text"]} for c in got]


def view_asks(reads: L.Reads) -> list[dict]:
    """schedViewAsks_: every time-off and Request Off ask still standing."""
    def read() -> list[dict]:
        homes: dict[str, list[str]] = {}
        for r in read_tab(reads, TABS["rows"]):
            if r["row_kind"] != "person" or not r["person_key"] or r["active"] == "no":
                continue
            lst = homes.setdefault(r["person_key"], [])
            if r["house_code"] not in lst:
                lst.append(r["house_code"])
        items: dict[str, list] = {}
        for i in read_tab(reads, TABS["inbox"]):
            if i["box"] != "work" or i["state"] != "waiting" or not i["flow_id"]:
                continue
            items.setdefault(i["flow_id"], []).append({k: i[k] for k in ("id", "to_uid", "seat", "title", "body",
                                                                         "test_mode", "created_at")})
        held = _held_index(read_tab(reads, TABS["cells"]))
        dir_names = {d["uid"]: d["name"] for d in directors(reads)["list"]}
        asks = []
        for f in read_tab(reads, TABS["flows"]):
            if f["kind"] not in ASK_KINDS or f["state"] not in ASK_STATES or not iso_valid(f["date"]):
                continue
            to = f["date_to"] if f["kind"] == "time_off" and iso_valid(f["date_to"]) and f["date_to"] >= f["date"] \
                else f["date"]
            seats = jparse(f["seats"], [])
            seats = seats if isinstance(seats, list) else []
            decided = None
            for s in seats:
                if isinstance(s, dict) and s.get("seat") == "director" and s.get("state") == "approved":
                    decided = s
            log = jparse(f["outreach_log"], {})
            log = log if isinstance(log, dict) else {}
            req = f["kind"] == "request_off"
            codes = [f["house_code"]] if req else (homes.get(f["person_key"]) or [])
            carried = f["source"] == TO_SOURCE
            asks.append({
                "id": f["id"], "kind": f["kind"], "state": f["state"], "person": f["person"],
                "person_key": f["person_key"], "person_uid": f["person_uid"],
                "house_code": f["house_code"] if req else "",
                "house_label": house_label(reads, f["house_code"]) if req and f["house_code"] else "",
                "homes": codes, "houses": [{"code": c, "label": house_label(reads, c)} for c in codes if c],
                "from": f["date"], "to": to, "days": day_index(to) - day_index(f["date"]) + 1,
                "shift_text": f["shift_text"] if req else "", "reason": f["note"] if req else f["reason"],
                "requested_at": f["created_at"],
                "filed_by": "" if carried else (f["person"] if f["created_by"] and f["created_by"] == f["person_uid"]
                                                else dir_names.get(f["created_by"], "") if f["created_by"] else ""),
                "filed_via": ("Carried over from the Time Off app" + (f" ({f['source_ref']})" if f["source_ref"] else ""))
                if carried else ("From My Calendar" if f["source_ref"] == "my-calendar" else "On the platform"),
                "decided_by": s_(decided.get("by")) if decided else s_(f["closed_by"]),
                "decided_at": s_(decided.get("at")) if decided else s_(f["closed_at"]),
                "seats": [{"seat": s_(s.get("seat")), "state": s_(s.get("state")), "by": s_(s.get("by")),
                           "at": s_(s.get("at")), "note": s_(s.get("note")), "why": s_(s.get("why")),
                           "asked": [x for x in (s_(t.get("name") if isinstance(t, dict) else (t if gsjs.falsy(t) else None))
                                                 for t in (s.get("to") if isinstance(s.get("to"), list) else [])) if x]}
                          for s in seats if isinstance(s, dict) and not gsjs.falsy(s.get("seat"))],
                "holds": _view_holds(reads, held, f["person_key"], f["date"], to),
                "applied": [{"date": s_(x.get("date") if isinstance(x, dict) else None),
                             "house_label": house_label(reads, s_(x.get("house") if isinstance(x, dict) else None))}
                            for x in (log.get("applied") if isinstance(log.get("applied"), list) else [])],
                "future_days": len(log["future"]) if isinstance(log.get("future"), list) else 0,
                "test_mode": f["test_mode"], "items": items.get(f["id"]) or []})
        return asks
    return derived(reads, "asks", read)


def asks_cut(asks: list[dict], ctx: dict, edits: dict, past: bool, today: str) -> dict[str, Any]:
    """schedViewAsksCut_: the master and the directors the Scheduling settings list see every ask; so does anyone
    wearing HM or a badge above it while Settings › My Work shows them every ask (ctx `asks_all`); a house manager
    otherwise sees those of their houses, and anyone their own. The list alone decides whose seat an ask waits on.
    Whoever answers a time off (the master, a listed director, a holder of Time off approvals) sees every ask and is
    handed its director item."""
    answers = bool(ctx.get("is_master") or ctx.get("is_director") or TIME_OFF_EDITION in (ctx.get("editions") or ()))
    every = bool(answers or ctx.get("asks_all"))
    pending, approved, hidden = [], [], 0
    for a in asks:
        own = bool((ctx.get("key") and a["person_key"] == ctx["key"]) or (ctx.get("uid") and a["person_uid"] == ctx["uid"]))
        theirs = any(edits.get(c) for c in a.get("homes") or [])
        if not every and not own and not theirs:
            continue
        ended = a["to"] < today
        if a["state"] != "waiting" and ended and not past:
            hidden += 1
            continue
        o = {"id": a["id"], "kind": a["kind"], "state": a["state"], "person": a["person"], "house_code": a["house_code"],
             "house_label": a["house_label"], "from": a["from"], "to": a["to"], "days": a["days"],
             "shift_text": a["shift_text"], "requested_at": a["requested_at"], "decided_by": a["decided_by"],
             "decided_at": a["decided_at"], "own": own, "ended": ended, "houses": a.get("houses") or [],
             "filed_by": a.get("filed_by") or "", "filed_via": a.get("filed_via") or "", "holds": a.get("holds") or [],
             "applied": a.get("applied") or [], "future_days": a.get("future_days") or 0,
             # an ask's Edit, waiting or approved: whoever answers a time off, never the person on it
             "may_edit": bool(answers and not own)}
        o["seats"] = [{"seat": s["seat"], "state": s["state"], "by": s["by"], "at": s["at"], "why": s["why"],
                       "asked": s.get("asked") or [], "note": s["note"] if (every or own) else ""}
                      for s in a.get("seats") or []]
        if every or own:
            o["reason"] = a["reason"]
        seat = None
        if a["state"] == "waiting" and not own and ctx.get("uid"):
            seat = next((i for i in a.get("items") or [] if i["to_uid"] == ctx["uid"]), None) or \
                (next((i for i in a.get("items") or [] if i["seat"] == "director"), None) if answers else None)
        if seat:
            o["item"] = {k: seat[k] for k in ("id", "title", "body", "test_mode", "created_at")}
        (pending if a["state"] == "waiting" else approved).append(o)
    pending.sort(key=functools.cmp_to_key(lambda a, b: -1 if a["from"] < b["from"] else (1 if a["from"] > b["from"] else 0)))

    def cmp(a: dict, b: dict) -> int:
        if a["ended"] != b["ended"]:
            return 1 if a["ended"] else -1
        if a["from"] == b["from"]:
            return 0
        return -1 if (a["from"] < b["from"]) == (not a["ended"]) else 1
    approved.sort(key=functools.cmp_to_key(cmp))
    return {"pending": pending, "approved": approved, "past_hidden": hidden, "sees_all": every}


# ---- the doors -----------------------------------------------------------------------------------------------------

def board_read(sess: L.Session, payload: dict) -> dict[str, Any]:
    """schedulingBoard."""
    ctx = gate(sess)
    if not ctx["open"]:
        return closed()
    reads = sess.reads
    pid = s_(payload.get("period_id"))
    period = period_by_id(reads, pid) if pid else current_period(reads)
    if not period:
        return refuse(404, "That calendar period does not exist.")
    return {"status": 200, "data": board(reads, ctx, period)}


def time_off_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """schedulingTimeOffList: the asks waiting on a director, and the approved ones."""
    ctx = view_gate(sess, TIMEOFF_FEATURE)
    if not ctx["open"]:
        return closed()
    import editions as E  # noqa: PLC0415 - editions reads the scope this module reads
    reads = sess.reads
    past = payload.get("past") is True or payload.get("past") == "true"
    today = reads.today()
    edits = view_edits(board_base(reads, current_period(reads)), ctx)
    # a house manager and every badge above see every ask while Settings › My Work shows it (it ships shown)
    ctx = {**ctx, "asks_all": sc.wears_from(sess.user, "HM") and not E.hides_for(sess).get("sched_time_off_all")}
    asks = view_asks(reads)
    c = asks_cut(asks, ctx, edits, past, today)
    import time_off_approved as TA  # noqa: PLC0415 - it reads this module
    keys = {a["id"]: a["person_key"] for a in asks}
    # the operator's panel, on the approvers' side (waiting) and once approved, for every ask
    for o in c["pending"] + c["approved"]:
        o["approved"] = TA.facts(reads, person=o["person"], person_key=keys.get(o["id"], ""), first=o["from"],
                                 last=o["to"], flow_id=o["id"])
    return {"status": 200, "data": {"ok": True, "today": today, "past": past, "pending": c["pending"],
                                    "approved": c["approved"], "past_hidden": c["past_hidden"],
                                    "sees_all": c["sees_all"], "test_mode": test_mode(reads)}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "schedulingBoard": board_read, "schedulingStaffShifts": staff_shifts, "schedulingTimeOffList": time_off_list}
_READERS = ("admin", "director", "manager", "staff")
# HUB_POLICY: the roles each read is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "schedulingBoard": {"roles": _READERS, "params": {"period_id": "string"}},
    "schedulingStaffShifts": {"roles": _READERS + ("onboarding", "interviewer"),
                              "params": {"person": "string", "via": "string"}},
    "schedulingTimeOffList": {"roles": _READERS, "params": {"past": "boolean"}}}
