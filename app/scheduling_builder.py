"""Scheduling's Builder (apps-script/SchedulingBuilder.gs) off asa-hub-db: the draft read, kept and published in app.edits."""
from __future__ import annotations

import copy
import functools
import hashlib
import json
import math
import re
import secrets
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import resource_rows as RR
import scope as sc
import writes as W
from scope import Defer
from writes import Decision

APP_ID = "scheduling"
FEATURE = "scheduling.builder"
# Editions.gs: the Builder of every house, for the people the master lists
EDITION = "scheduling.builder"
TABS = {"cells": "sched_cells", "rows": "sched_rows", "flows": "sched_flows", "log": "sched_log",
        "settings": "sched_settings", "drafts": "sched_drafts"}
# Scheduling.gs SCHED_HEADERS: the columns each house is written with
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
    "sched_log": ("id", "at", "by_uid", "by_name", "house_code", "date", "row_id", "was", "now", "via", "flow_id", "note",
                  "undone_at"),
    "sched_settings": ("key", "value", "note", "updated_at", "updated_by"),
    "sched_drafts": ("id", "house_code", "first", "last", "state", "rev", "body", "body_2", "body_3", "body_4",
                     "approved_at", "approved_by", "published_at", "updated_at", "updated_by")}
MAX_WEEKS = 26
MAX_ROWS = 80
REPORT = 80
PART = 45000
PARTS = ("body", "body_2", "body_3", "body_4")
STATES = ("pattern", "approved", "published")
NO_STORE = "Drafts cannot be kept yet: the Scheduling drafts house is not set up."
CONFLICT = "Somebody else changed this draft a moment ago — it was read again."
TOO_LARGE = "This draft is too large to keep — build fewer weeks at a time."
REREAD = "Saved — but the calendar could not be read back just now; refresh to see it."
UNKNOWN = {"status": 404, "message": "Unknown action."}
FIRST_PERIOD = {"id": "P2026-09-28", "first": "2026-09-28", "last": "2026-10-25", "state": "live",
                "rolled_from": "", "rolled_at": "", "by": ""}
OFF_STATES = frozenset({"called_off", "requested_off", "time_off", "swapped_out"})
ONE_OFF_STATES = OFF_STATES | {"swap_in", "taken", "training"}
FLOW_WAITING = ("waiting", "waiting_staff", "waiting_manager", "waiting_director")
NOT_WORKING = frozenset({"OFF", "R/O", "C/O", "RO", "R\\O", "R/0", "NCNS", "NO WORKSHOP"})
# IstConfig.gs: the two first-shift settings the IST check reads
IST_SCOPES = ("house", "client")
IST_DAYS_MAX = 3650
IST_DONE = "done"
IST_CONFIG_ERROR = re.compile(r"^#(ERROR!|REF!|NAME\?|VALUE!|DIV/0!|N/A|NULL!|NUM!)")
# AlertsConfig.gs and Rpc.gs: the words test mode is read by
TEST_ON = ("on", "true", "1", "test")
TEST_OFF = ("off", "false", "0", "production")
TEST_REHEARSAL = ("sheet", "rehearsal", "paper")
ROLES = ("admin", "director", "manager", "staff")

# JavaScript's \s, never Python's
_S = "[\t\n\x0b\x0c\r \xa0  -     　﻿]"
_TIME_RANGE = re.compile(r"^\*?" + _S + r"*([0-9]{1,2})(?::?([0-9]{2}))?" + _S + r"*([AaPp])?[Mm]?" + _S + r"*[-–]"
                         + _S + r"*([0-9]{1,2})(?::?([0-9]{2}))?" + _S + r"*([AaPp])[Mm]?(?:" + _S
                         + r"+[A-Za-z]{1,4})?" + _S + r"*\Z")
_TIME_INSIDE = re.compile(r"([0-9]{1,2})(?::?([0-9]{2}))?" + _S + r"*([AaPp])?[Mm]?" + _S + r"*[-–]" + _S
                          + r"*([0-9]{1,2})(?::?([0-9]{2}))?" + _S + r"*([AaPp])[Mm]?(?![A-Za-z0-9])")
_CHAIN = re.compile(_S + r"*[><]" + _S + "*")
_SPACES = re.compile(_S + "+")
_SPACE = re.compile(_S)
_SPLIT_BAD = re.compile(_S[:-1] + "=+\\-@]")
_ROW_KEY = re.compile(r"[a-z0-9]{1,80}")
_ISO = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})$")
_INDEX = re.compile(r"0|[1-9][0-9]{0,9}")


class _Unread(RuntimeError):
    """A Scheduling house Apps Script would throw on, its words kept."""


def _sch() -> Any:
    try:
        import scheduling as SCH  # noqa: PLC0415 - the board module loads beside this one
    except ImportError:
        return None
    return SCH


def _staff() -> Any:
    import staff as SP  # noqa: PLC0415 - the Staff core loads beside this module
    return SP


def _staff_perf() -> Any:
    import staff_perf as SPF  # noqa: PLC0415
    return SPF


# ---- what Apps Script's own JavaScript does to a value ----------------------------------------------------------------

def _s(v: Any) -> str:
    """schedStr_."""
    return gsjs.trim(gsjs.or_blank(v))


def _int_of(v: Any, fallback: int) -> int:
    """schedIntOf_: parseInt, else the fallback."""
    m = re.match(r"^[+-]?[0-9]+", _s(v))
    return int(m.group(0)) if m else fallback


def _float_of(v: Any) -> float:
    """parseFloat(v) || 0."""
    m = re.match(r"^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", _s(v))
    try:
        n = float(m.group(0)) if m else 0.0
    except ValueError:
        n = 0.0
    return n if math.isfinite(n) and n else 0.0


def _prop(o: Any, k: str) -> Any:
    """o[k] as JavaScript reads it off a parsed payload."""
    if isinstance(o, dict):
        return o.get(k)
    if isinstance(o, (list, str)):
        if _INDEX.fullmatch(k) and int(k) < len(o):
            return o[int(k)]
        return len(o) if k == "length" else None
    return None


def _and(o: Any, k: str) -> Any:
    """o && o[k]."""
    return o if gsjs.falsy(o) else _prop(o, k)


def _is_obj(v: Any) -> bool:
    return isinstance(v, (dict, list))


def _keys(o: Any) -> list[str]:
    """Object.keys: array indexes first, ascending, then the rest as written."""
    if isinstance(o, list):
        return [str(i) for i in range(len(o))]
    if not isinstance(o, dict):
        return []
    ks = [str(k) for k in o]
    idx = sorted((k for k in ks if _INDEX.fullmatch(k) and int(k) < 4294967295), key=int)
    return idx + [k for k in ks if k not in set(idx)]


def _js_order(v: Any) -> Any:
    """A parsed value laid out as JSON.stringify writes it."""
    if isinstance(v, dict):
        return {k: _js_order(v[k]) for k in _keys(v)}
    if isinstance(v, list):
        return [_js_order(x) for x in v]
    if isinstance(v, float) and math.isfinite(v) and v == int(v) and abs(v) < 1e15:
        return int(v)
    return v


def _stringify(v: Any) -> str:
    return json.dumps(_js_order(v), separators=(",", ":"), ensure_ascii=False)


def _json(text: Any, fallback: Any) -> Any:
    """schedJson_."""
    if _is_obj(text):
        return text
    s = _s(text)
    if not s:
        return fallback
    try:
        return json.loads(s)
    except ValueError:
        return fallback


def _fixed2(x: float) -> str:
    """Number.prototype.toFixed(2)."""
    return str(Decimal(x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _round(x: float) -> int:
    return int(gsjs.js_round(x))


def _sha16(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


def _new_id(prefix: str) -> str:
    """schedNewId_."""
    return prefix + secrets.token_hex(5).upper()


def _cmp(fn: Callable[[Any, Any], float]) -> Callable[[Any], Any]:
    return functools.cmp_to_key(lambda a, b: (fn(a, b) > 0) - (fn(a, b) < 0))


# ---- days: a UTC calendar index, never a time zone --------------------------------------------------------------------

def _iso_valid(iso: Any) -> bool:
    m = _ISO.match(_s(iso))
    if not m:
        return False
    try:
        date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return False
    return True


def _day_index(iso: Any) -> float:
    """schedDayIndex_; NaN for what Date.UTC cannot read."""
    p = _s(iso).split("-")
    if len(p) < 3 or not all(re.fullmatch(r"[0-9]+", x) for x in p[:3]):
        return math.nan
    y, mo, d = int(p[0]), int(p[1]) - 1, int(p[2])
    y, mo = y + mo // 12, mo % 12
    try:
        return float((date(y, mo + 1, 1) - date(1970, 1, 1)).days + d - 1)
    except ValueError:
        return math.nan


def _iso_of_index(n: float) -> str:
    return (date(1970, 1, 1) + timedelta(days=int(n))).isoformat()


def _iso_add(iso: str, days: int) -> str:
    return _iso_of_index(_day_index(iso) + days)


def _dow(iso: str) -> int:
    return int((_day_index(iso) % 7 + 7 + 4) % 7)


def _dates(first: str, last: str) -> list[str]:
    if not _iso_valid(first) or not _iso_valid(last):
        return []
    a, b = int(_day_index(first)), int(_day_index(last))
    return [_iso_of_index(n) for n in range(a, b + 1)]


def _next_monday(iso: str) -> str:
    d = iso
    while _dow(d) != 1:
        d = _iso_add(d, 1)
    return d


def _range(first: str, last: str) -> dict[str, Any]:
    """schedBldRange_: whole Monday–Sunday weeks, or the refusal."""
    if not _iso_valid(first) or not _iso_valid(last):
        return {"error": "Pick a start and an end date."}
    if _dow(first) != 1:
        return {"error": "The start date is a Monday."}
    if _dow(last) != 0:
        return {"error": "The end date is a Sunday."}
    days = int(_day_index(last) - _day_index(first)) + 1
    if days < 7:
        return {"error": "The end date comes after the start date."}
    if days / 7 > MAX_WEEKS:
        return {"error": f"At most {MAX_WEEKS} weeks at a time."}
    return {"first": first, "last": last, "weeks": days // 7}


# ---- the cell grammar (Scheduling.gs, from server/shift_slices.py) ----------------------------------------------------

def _hour(h: str, m: str | None, ap: str | None) -> float:
    return int(h) % 12 + (12 if (ap or "").upper() == "P" else 0) + (int(m) / 60 if m else 0)


def _span_of(m: re.Match) -> list[float]:
    start = _hour(m.group(1), m.group(2), m.group(3) or m.group(6))
    end = _hour(m.group(4), m.group(5), m.group(6))
    if m.group(3) is None and start >= end:
        start = math.fmod(math.fmod(start - 12, 24) + 24, 24)
    if end <= start:
        end += 24
    return [start, end]


def _range_of(segment: Any) -> list[float] | None:
    m = _TIME_RANGE.match(_s(segment))
    return _span_of(m) if m else None


def _kind_for(start: float, end: float) -> str:
    if start >= 19 or end > 24:
        return "overnight"
    if end - start >= 11 and start <= 10:
        return "day"
    if start < 11:
        return "morning"
    if start < 16:
        return "afternoon"
    return "evening"


def _classify(text: Any) -> dict[str, Any] | None:
    """schedClassify_: { kind, code, token, start, end, hours }; None for an empty cell."""
    code = _s(text)
    if not code:
        return None
    hours = token = None
    for seg in (x for x in _CHAIN.split(code) if gsjs.trim(x)):
        got = _range_of(seg)
        if got and hours is None:
            hours = got
        elif not got and token is None:
            up = gsjs.trim(re.sub(r"^\*+", "", gsjs.trim(seg).upper(), count=1))
            if up not in NOT_WORKING:
                token = gsjs.trim(seg)
    shown = gsjs.trim(re.sub(r"^\*+", "", code, count=1))
    if hours:
        return {"kind": _kind_for(hours[0], hours[1]), "code": shown, "token": token, "start": hours[0],
                "end": hours[1], "hours": gsjs.js_round((hours[1] - hours[0]) * 100) / 100}
    up = shown.upper()
    if up == "OFF":
        return {"kind": "off", "code": "OFF", "token": None, "start": None, "end": None, "hours": 0}
    if up in NOT_WORKING:
        return {"kind": "ro", "code": up, "token": None, "start": None, "end": None, "hours": 0}
    return {"kind": "alias", "code": shown, "token": shown, "start": None, "end": None, "hours": 0}


def _time_inside(text: Any) -> list[float] | None:
    m = _TIME_INSIDE.search(gsjs.or_blank(text))
    return _span_of(m) if m else None


def _value_span(cls: dict | None, value: Any) -> list[int] | None:
    if cls and cls["start"] is not None:
        return [_round(cls["start"] * 60), _round(cls["end"] * 60)]
    inside = _time_inside(value)
    return [_round(inside[0] * 60), _round(inside[1] * 60)] if inside else None


def _shift_words(text: Any) -> str:
    return gsjs.trim(re.sub(r"^\*+", "", _s(text), count=1))


# ---- the houses (ASA Data, one Data tab each) -------------------------------------------------------------------------

def _not_set_up(tab: str) -> str:
    return (f'The Scheduling house "{tab}" could not be read: The Scheduling house "{tab}" is not set up '
            f"(no pointer, or moved.{tab} is not on).")


def _ready(reads: L.Reads, tab: str) -> bool:
    """schedHouseReady_."""
    return reads.db.house_moved(tab)


def _read(reads: L.Reads, tab: str) -> list[dict]:
    """schedRead_: every row keyed by its header, each cell its text, rows with no id dropped."""
    def read() -> list[dict]:
        if HT.tabled(tab):
            idf = "key" if tab == TABS["settings"] else "id"
            got = [{**{h: "" for h in HEADERS[tab]}, **{h: gsjs.trim(v) for h, v in r.items()}}
                   for r in HT.rows(reads, tab)]
            return [r for r in got if r.get(idf)]
        if not reads.db.house_moved(tab):
            raise _Unread(_not_set_up(tab))
        res = reads.db.resolve(tab)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the Scheduling house {tab}")
            return []
        idf = "key" if tab == TABS["settings"] else "id"
        heads = [gsjs.trim(gsjs.or_text(h)) for h in res.ref.headers]
        out = []
        for _rn, raw in reads.db.rows(res.ref):
            row = {h: "" for h in HEADERS[tab]}
            for h, src in zip(heads, res.ref.headers):
                if h:
                    row[h] = gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(src), "raw")))
            if row.get(idf):
                out.append(row)
        return out
    return reads.once("sbld:" + tab, read)


def _periods_of(raw: Any) -> list[dict] | None:
    """schedPeriodsOf_."""
    got = _json(raw, None)
    if not isinstance(got, list):
        return None
    out = [{"id": _s(_prop(p, "id")) or "P" + gsjs.or_blank(_prop(p, "first")), "first": _prop(p, "first"),
            "last": _prop(p, "last"), "state": _s(_prop(p, "state")) or "live", "rolled_from": _s(_prop(p, "rolled_from")),
            "rolled_at": _s(_prop(p, "rolled_at")), "by": _s(_prop(p, "by"))}
           for p in got if not gsjs.falsy(p) and isinstance(_prop(p, "first"), str) and isinstance(_prop(p, "last"), str)
           and _iso_valid(_prop(p, "first")) and _iso_valid(_prop(p, "last")) and _prop(p, "first") <= _prop(p, "last")]
    out.sort(key=lambda p: p["first"])
    return out


def _settings(reads: L.Reads) -> dict[str, Any]:
    """schedSettings_ without its directors (read where a gate asks for them)."""
    def read() -> dict[str, Any]:
        out: dict[str, Any] = {"readable": True, "why": "", "periods": [dict(FIRST_PERIOD)], "houses": [], "raw": {}}
        kv: dict[str, str] = {}
        try:
            for r in _read(reads, TABS["settings"]):
                kv[r["key"]] = r.get("value", "")
        except _Unread as e:
            out["readable"], out["why"] = False, str(e)[:200]
        out["raw"] = kv
        periods = _periods_of(kv.get("periods"))
        if periods:
            out["periods"] = periods
        houses = _json(kv.get("houses"), None)
        if isinstance(houses, list):
            out["houses"] = [{"code": _s(_prop(h, "code")), "location": _s(_prop(h, "location")),
                              "short": _s(_prop(h, "short")) or _s(_prop(h, "code")), "book_id": _s(_prop(h, "book_id"))}
                             for h in houses if not gsjs.falsy(h) and _s(_prop(h, "code"))]
        return out
    return reads.once("sbld:settings!", read)


def _period_of(periods: list[dict], day: str) -> dict | None:
    return next((p for p in periods if p["first"] <= day <= p["last"]), None)


def _current_period(periods: list[dict], today: str) -> dict:
    hit = _period_of(periods, today)
    if hit:
        return hit
    if not periods:
        return dict(FIRST_PERIOD)
    return periods[0] if today < periods[0]["first"] else periods[-1]


def _houses(reads: L.Reads, settings: dict) -> list[dict]:
    """schedHouseList_."""
    if settings["houses"]:
        return settings["houses"]
    seen: set[str] = set()
    out = []
    for r in _read(reads, TABS["rows"]):
        if not r["house_code"] or r["house_code"] in seen:
            continue
        seen.add(r["house_code"])
        out.append({"code": r["house_code"], "location": r["location"], "short": r["house_code"], "book_id": ""})
    return out


def _label(houses: list[dict], code: Any) -> str:
    c = _s(code)
    return next((h.get("short") or c for h in houses if h["code"] == c), c)


def _tokens(houses: list[dict]) -> dict[str, str]:
    """schedHouseTokens_."""
    out: dict[str, str] = {}
    for h in houses:
        for t in (h.get("code"), h.get("short"), h.get("location")):
            up = _s(t).upper()
            if up:
                out[up] = h["code"]
            tight = _SPACES.sub("", up)
            if tight:
                out[tight] = h["code"]
    return out


def _names_house(text: Any, tokens: dict[str, str]) -> str:
    for part in _CHAIN.split(re.sub(r"^\*+", "", gsjs.or_blank(text), count=1)):
        up = gsjs.trim(part).upper()
        if not up:
            continue
        if up in tokens:
            return tokens[up]
        if _SPACES.sub("", up) in tokens:
            return tokens[_SPACES.sub("", up)]
    return ""


def _open_n(row_id: Any) -> int:
    m = re.fullmatch(r"OPEN:([0-9]+)", _s(row_id))
    return int(m.group(1)) if m else 0


def _row_order(a: dict, b: dict) -> float:
    """schedRowOrder_: OPEN rows first, then people in roster order, then the rest."""
    def rank(r: dict) -> int:
        return 0 if r["row_kind"] == "open" else (1 if r["row_kind"] == "person" else 2)
    ra, rb = rank(a), rank(b)
    if ra != rb:
        return ra - rb
    if ra == 0:
        return _open_n(a["row_id"]) - _open_n(b["row_id"])
    return _float_of(a["order"]) - _float_of(b["order"])


def _house_rows(rows: list[dict], house: str) -> list[dict]:
    return sorted((r for r in rows if r["house_code"] == house and r["active"] != "no"), key=_cmp(_row_order))


def _hm_keys(rows: list[dict], house: str) -> list[str]:
    """The house's ** rows, as the board names its managers."""
    return [r["person_key"] for r in rows if r["house_code"] == house and r["active"] != "no"
            and r["row_kind"] == "person" and r["designation"] == "**" and r["person_key"]]


# ---- the overlap law ------------------------------------------------------------------------------------------------

def _hold_of(c: dict, tokens: dict[str, str]) -> dict | None:
    """schedHoldOf_."""
    text, state = _s(c.get("text")), _s(c.get("state"))
    if not text and state not in OFF_STATES:
        return None
    day = _day_index(c.get("date")) * 1440
    cls = _classify(text)
    whole: dict[str, Any] = {"s": day, "e": day + 1440, "whole": True}
    if state == "swapped_out":
        return None
    if state in OFF_STATES or (cls and cls["kind"] == "ro"):
        whole["why"] = "off"
        whole["private"] = state in ("called_off", "time_off") or bool(cls and cls["kind"] == "ro" and cls["code"] == "C/O")
        return whole
    if not cls or cls["kind"] == "off":
        return None
    if cls["start"] is not None:
        return {"s": day + _round(cls["start"] * 60), "e": day + _round(cls["end"] * 60), "why": "overlap"}
    inside = _time_inside(text)
    if inside:
        return {"s": day + _round(inside[0] * 60), "e": day + _round(inside[1] * 60), "why": "overlap"}
    whole["why"] = "unreadable"
    whole["named"] = _names_house(text, tokens)
    return whole


def _hold_index(cells: list[dict], rows: list[dict], flows: list[dict], tokens: dict[str, str]) -> dict[str, list]:
    """schedHoldIndex_: every hold of every person."""
    person_of = {r["house_code"] + "|" + r["row_id"]: r["person_key"] for r in rows
                 if r["row_kind"] == "person" and r["person_key"]}
    out: dict[str, list] = {}
    for c in cells:
        key = person_of.get(c["house_code"] + "|" + c["row_id"])
        if not key:
            continue
        h = _hold_of(c, tokens)
        if not h:
            continue
        h.update({"house_code": c["house_code"], "date": c["date"], "text": c["text"] or c["base"] or "",
                  "cell_id": c["id"]})
        out.setdefault(key, []).append(h)
    for f in flows:
        if f["kind"] != "time_off" or f["state"] not in ("approved", "approved_future") or not f["person_key"]:
            continue
        if not _iso_valid(f["date"]):
            continue
        for d in _dates(f["date"], f["date_to"] if _iso_valid(f["date_to"]) else f["date"]):
            day = _day_index(d) * 1440
            out.setdefault(f["person_key"], []).append(
                {"s": day, "e": day + 1440, "whole": True, "why": "time_off", "house_code": "", "date": d,
                 "text": "time off", "cell_id": "", "flow_id": f["id"], "private": True})
    return out


def _clash(key: Any, day_iso: str, start: int | None, end: int | None, holds: dict, house: str, value: str,
           tokens: dict[str, str]) -> dict | None:
    """schedClash_: None when the person is free, else the first thing they hold against the span."""
    k = _s(key)
    if not k or not _iso_valid(day_iso):
        return None
    day = _day_index(day_iso) * 1440
    unread = start is None
    s, e = (day, day + 1440) if unread else (day + start, day + end)
    named = _names_house(value, tokens) if value else ""
    for h in holds.get(k) or []:
        if h.get("whole") and h.get("named") and house and h["named"] == house:
            continue
        if unread and named and h["house_code"] == named:
            continue
        if h["s"] < e and s < h["e"]:
            return {"house_code": h["house_code"], "date": h["date"], "text": h["text"],
                    "why": "unreadable" if unread and h["why"] == "overlap" else h["why"], "private": bool(h.get("private"))}
    return None


def _flow_exchange(f: dict) -> dict | None:
    """schedFlowExchangeOf_: a swap's partner shift, or None."""
    if f.get("kind") != "swap":
        return None
    got = f.get("outreach_log")
    try:
        log = got if _is_obj(got) else json.loads(gsjs.or_text(got))
    except ValueError:
        log = None
    ex = _prop(log, "exchange") if _is_obj(log) else None
    if not isinstance(ex, dict) or not gsjs.str_(ex.get("house")) or not re.match(r"^P:.", gsjs.str_(ex.get("row_id"))) \
            or not _ISO.match(gsjs.trim(gsjs.or_blank(ex.get("date")))):
        return None
    return ex


# ---- who is looking ---------------------------------------------------------------------------------------------------

def _live(u: dict | None) -> bool:
    """schedLive_."""
    off = _s((u or {}).get("active")).upper()
    return bool(u) and off not in ("FALSE", "0", "NO") and not _s(u.get("mergedinto"))


def _accounts(reads: L.Reads) -> dict[str, list[dict]]:
    """schedAccounts_: live accounts by display-name fold."""
    def read() -> dict[str, list[dict]]:
        out: dict[str, list[dict]] = {}
        for u in reads.users():
            if not _live(u):
                continue
            k = gsjs.name_key(u.get("displayname"))
            if k:
                out.setdefault(k, []).append(u)
        return out
    return reads.once("sbld:accounts", read)


def _own_gate(sess: L.Session) -> dict[str, Any]:
    """schedGate_ (schedCtxFor_) where the board module offers none."""
    reads, user = sess.reads, sess.user or {}
    ctx: dict[str, Any] = {"open": False, "uid": "", "name": "", "key": "", "is_master": False, "is_director": False,
                           "builder_edition": False}
    got = sc.profile_app_gate(APP_ID, sess.user, reads.scope_sources())
    if not got.get("open"):
        return ctx
    uid = "" if user.get("is_service") else gsjs.str_(user.get("id"))
    fold = gsjs.name_key(user.get("display_name"))
    key = ""
    if fold:
        hits = _accounts(reads).get(fold) or []
        key = "" if len(hits) > 1 or (len(hits) == 1 and _s(hits[0].get("userid")) != uid) else fold
    directors = _staff_perf().sched_directors(reads).get("list") or []
    ctx.update({"open": True, "uid": uid, "name": _s(user.get("display_name")) or _s(user.get("email")), "key": key,
                "is_master": sc.is_real_master(sess.user),
                "is_director": bool(uid) and any(d.get("uid") == uid for d in directors),
                "builder_edition": not user.get("is_service") and sc.edition_allows(EDITION, user, reads.config())})
    return ctx


def _field(got: Any, name: str) -> Any:
    if isinstance(got, dict):
        return got.get(name)
    return getattr(got, name, None)


def _gate(sess: L.Session) -> dict[str, Any]:
    """schedBldGate_ (schedViewGate_): Scheduling's gate, then the Builder's own release for anyone but the master."""
    SCH = _sch()
    fn = getattr(SCH, "gate", None) if SCH is not None else None
    got = fn(sess) if callable(fn) else _own_gate(sess)
    inner = _field(got, "ctx")
    got = inner if inner is not None and _field(got, "open") is None else got
    if _field(got, "open") is None:
        raise Defer("the Scheduling gate answered no context")
    ctx = {"open": bool(_field(got, "open")), "uid": _s(_field(got, "uid")), "name": _s(_field(got, "name")),
           "key": _s(_field(got, "key")), "is_master": bool(_field(got, "is_master")),
           "is_director": bool(_field(got, "is_director")), "builder_edition": bool(_field(got, "builder_edition"))}
    if not ctx["open"] or ctx["is_master"]:
        return ctx
    row = sc.profile_app_gate(FEATURE, sess.user, sess.reads.scope_sources())
    if not row.get("open"):
        ctx["open"] = False
    # the badges the Builder's row names build every house when the row opens the whole view to them (the operator,
    # 10-30: "Faça de acordo os badges, se elas precisarem de mais acesso tem que trocar o badge")
    ctx["row_all"] = bool(ctx["open"]) and (row.get("scope") or {}).get("kind") == "all"
    return ctx


def _own_editor(ctx: dict, rows: list[dict], house: str) -> bool:
    """ctx.editorOf / schedBaseEditor_: the master, a director, or the house's ** row."""
    if ctx["is_master"] or ctx["is_director"]:
        return True
    return bool(ctx["key"]) and ctx["key"] in _hm_keys(rows, house)


def _editor(ctx: dict, rows: list[dict], house: str) -> bool:
    """A house's own editors, or every house for the Builder edition and for the badges the Builder's row names."""
    return _own_editor(ctx, rows, house) or bool(ctx.get("builder_edition")) or bool(ctx.get("row_all"))


def _edition_of(ctx: dict, reads: L.Reads, house: str) -> str:
    """The edition a Builder write is kept under: '' for the house's own editors and for a badge the row names."""
    return EDITION if ctx.get("builder_edition") and not _own_editor(ctx, _read(reads, TABS["rows"]), house) else ""


# ---- IST, preferences and the staff list, read where their apps read them ---------------------------------------------

def _ist_config(reads: L.Reads) -> dict[str, str]:
    """istConfig_ as the tab holds it; a tab not there is made with the shipped values."""
    res = reads.db.resolve("ist_config")
    if res.runtime:
        raise Defer("ist_config lives in the depot's facts")
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable("asa-hub-db holds no copy of the IST settings")
        return {}
    kh = next((h for h in res.ref.headers if gsjs.trim(gsjs.or_text(h)) == "key"), None)
    vh = next((h for h in res.ref.headers if gsjs.trim(gsjs.or_text(h)) == "value"), None)
    out: dict[str, str] = {}
    for _rn, raw in reads.db.rows(res.ref):
        k = gsjs.trim(gsjs.or_text(hubdb.typed(raw.get(kh), "hub"))) if kh else ""
        if not k:
            continue
        v = gsjs.or_blank(hubdb.typed(raw.get(vh), "hub")) if vh else ""
        out[k] = "" if IST_CONFIG_ERROR.match(gsjs.trim(v)) else v
    return out


def _ist_days(raw: Any) -> int:
    """istCfgInt_('ist_valid_days')."""
    m = re.fullmatch(r"(-?[0-9]+)(?:[ \t]*([A-Za-z]+))?", gsjs.trim(gsjs.or_blank(raw)))
    if not m or (m.group(2) and m.group(2).lower() not in ("day", "days")):
        return 0
    n = int(m.group(1))
    return n if 0 <= n <= IST_DAYS_MAX else 0


def _ist_warm(reads: L.Reads) -> dict[str, Any]:
    """schedIstWarm_: the IST book and its settings, once a request."""
    def read() -> dict[str, Any]:
        out: dict[str, Any] = {"readable": False, "why": "", "by": {}, "scope": "house", "valid_days": 0, "mapped": {},
                               "mapped_readable": False, "today": reads.today()}
        cfg = _ist_config(reads)
        scope = gsjs.trim(gsjs.or_blank(cfg.get("ist_trained_scope"))).lower()
        out["scope"] = scope if scope in IST_SCOPES else "house"
        out["valid_days"] = _ist_days(cfg.get("ist_valid_days"))
        rows, why = L._soft(lambda: _staff().ist_rows(reads))
        if rows is None:
            out["why"] = f"the IST record could not be read ({why})"
            return out
        if not rows:
            out["why"] = "the IST record holds no rows, so nobody can be shown to be trained"
            return out
        for d in rows:
            who, code = gsjs.name_key(d.get("staffName")), _s(d.get("house")).upper()
            if not who or not code:
                continue
            slot = out["by"].setdefault(who, {}).setdefault(code, {"done": [], "owed": 0})
            at = _s(d.get("trainedAt"))[:10]
            if _s(d.get("status")).lower() == IST_DONE or at:
                slot["done"].append({"client": _s(d.get("clientName")), "at": at})
            else:
                slot["owed"] += 1
        if out["scope"] == "client":
            import ist  # noqa: PLC0415 - the house map's owner, IST Records
            got, _w = L._soft(lambda: ist.houses(reads))
            if got is not None:
                for r in got:
                    if (_s(r.get("active")) if not gsjs.falsy(r.get("active")) else "yes").lower() == "no":
                        continue
                    code, client = _s(r.get("house")).upper(), _s(r.get("clientName"))
                    if not code or not client:
                        continue
                    kept = out["mapped"].setdefault(code, [])
                    if client not in kept:
                        kept.append(client)
                out["mapped_readable"] = len(got) > 0
        out["readable"] = True
        return out
    return reads.once("sbld:ist", read)


def _lapsed(at: str, days: int, today: str) -> bool:
    if not days or not _iso_valid(at) or not _iso_valid(today):
        return False
    return _day_index(today) > _day_index(at) + days


def _ist_for(idx: dict, houses: list[dict], key: Any, code_raw: Any) -> dict[str, Any]:
    """schedIstFor_: { has, state, why }, never naming a client."""
    key, code = _s(key), _s(code_raw).upper()
    house = _label(houses, code) or code

    def say(has: bool | None, state: str, why: str) -> dict[str, Any]:
        return {"has": has, "state": state, "why": why}
    if not key or not code:
        return say(None, "unreadable", "no person or house to check the IST against")
    if not idx["readable"]:
        return say(None, "unreadable", idx["why"] + " — so no IST at " + house + " can be shown")
    slot = (idx["by"].get(key) or {}).get(code)
    done = slot["done"] if slot else []
    current = [r for r in done if not _lapsed(r["at"], idx["valid_days"], idx["today"])]
    lapsed = [r for r in done if _lapsed(r["at"], idx["valid_days"], idx["today"])]
    if idx["scope"] == "client":
        if not idx["mapped_readable"]:
            return say(None, "unreadable", "the house to client map could not be read, and the IST settings ask for an "
                       "IST on every client at " + house)
        need = idx["mapped"].get(code) or []
        have = {gsjs.name_key(r["client"]) for r in current}
        short = [c for c in need if gsjs.name_key(c) not in have]
        if need and not short:
            return say(True, "ok", "trained at " + house + " on every client there")
        if need:
            return say(False, "owed" if slot else "missing", "no IST at " + house + " for every client there")
    if current:
        return say(True, "ok", "trained at " + house)
    if lapsed:
        return say(False, "owed", "the IST for " + house + " has lapsed")
    if slot and slot["owed"]:
        return say(False, "owed", "the IST for " + house + " is still owed")
    return say(False, "missing", "no IST for " + house + " on file")


def _on_roster(rows: list[dict], cells: list[dict], house: str, key: Any) -> bool:
    """schedOnRoster_."""
    k = _s(key)
    if not k:
        return False
    row = None
    for r in rows:
        if r["house_code"] == house and r["row_kind"] == "person" and r["person_key"] == k and r["active"] != "no":
            row = r
    if not row:
        return False
    if re.match(r"^seed:", _s(row["source"])):
        return True
    for c in cells:
        if c["house_code"] != house or c["row_id"] != row["row_id"] or c["state"] == "training":
            continue
        a, b = _classify(c["text"]), _classify(c["base"])
        if (a and a["start"] is not None) or (b and b["start"] is not None):
            return True
    return False


def _prefs_index(reads: L.Reads) -> dict[str, Any]:
    """spPrefsIndex_: every staff key's unavailable houses and days; {} while not set up."""
    SP = _staff()
    if not reads.db.house_moved(SP.PREFS_TAB):
        return {}
    res = reads.db.resolve(SP.PREFS_TAB)
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the house behind {SP.PREFS_TAB}")
        return {}
    out: dict[str, Any] = {}
    for r in reads.db.locations_rows(res.ref):
        k = gsjs.trim(gsjs.or_blank(r.get("staff_key")))
        if not k:
            continue
        p = SP.prefs_of(r)
        if not p["unavailable_locations"] and not p["unavailable_days"]["a"] and not p["unavailable_days"]["b"]:
            continue
        out[k] = {"houses": p["unavailable_locations"], "days": p["unavailable_days"]}
    return out


def _staff_list(reads: L.Reads) -> dict[str, Any]:
    """schedBldStaff_: active staff by the Staff roster, or None with why."""
    SP = _staff()

    def build() -> Any:
        return reads.once("sp_roster_build:False", lambda: SP.scrub(SP.roster_build(reads, False)))
    data, why = L._soft(build)
    if why:
        return {"list": None, "why": f"the staff list could not be read ({why[:200]})"}
    if not isinstance(data, dict) or not isinstance(data.get("staff"), list):
        return {"list": None, "why": "the staff list gave no answer"}
    return {"list": [{"key": s["key"], "name": _s(s.get("name")) or s["key"]} for s in data["staff"]
                     if isinstance(s, dict) and s.get("status") == "active" and not s.get("ambiguous")
                     and _ROW_KEY.fullmatch(_s(s.get("key")))], "why": ""}


# ---- the draft's shape ------------------------------------------------------------------------------------------------

def _bld_id(house: str, first: str) -> str:
    return "SD_" + _sha16(house + "|" + first)


def _text60(v: Any) -> str:
    return _s(v)[:60]


def _week(v: Any) -> list[str]:
    a = v if isinstance(v, list) else []
    return [_text60(a[i] if i < len(a) else None) for i in range(7)]


def _open_week(v: Any) -> list[list[str]]:
    a = v if isinstance(v, list) else []
    out = []
    for i in range(7):
        day = a[i] if i < len(a) and isinstance(a[i], list) else []
        out.append([t for t in (_text60(x) for x in day) if t][:20])
    return out


def _clean(raw: Any, rng: dict) -> dict[str, Any]:
    """schedBldClean_: the draft as kept."""
    d = raw if _is_obj(raw) else {}
    rows: list[dict] = []
    seen: set[str] = set()
    got_rows = _prop(d, "rows")
    for r in got_rows if isinstance(got_rows, list) else []:
        key = _s(_and(r, "key"))
        if not _ROW_KEY.fullmatch(key) or key in seen or len(rows) >= MAX_ROWS:
            continue
        seen.add(key)
        rows.append({"key": key, "name": _s(_prop(r, "name"))[:120] or key})

    def week(w: str) -> dict[str, list[str]]:
        src = _prop(d, w)
        src = src if not gsjs.falsy(src) and _is_obj(src) else {}
        return {r["key"]: _week(_prop(src, r["key"])) for r in rows}
    in_range = set(_dates(rng["first"], rng["last"]))
    cells: dict[str, dict] = {}
    src_cells = _prop(d, "cells")
    src_cells = src_cells if _is_obj(src_cells) else {}
    for r in rows:
        line = _prop(src_cells, r["key"])
        line = line if _is_obj(line) else {}
        out: dict[str, str] = {}
        for iso in _keys(line):
            t = _text60(_prop(line, iso)) if iso in in_range else ""
            if t:
                out[iso] = t
        cells[r["key"]] = out
    opened: dict[str, list] = {}
    src_open = _prop(d, "open")
    src_open = src_open if _is_obj(src_open) else {}
    for iso in _keys(src_open):
        day = _prop(src_open, iso)
        if iso not in in_range or not isinstance(day, list):
            continue
        kept = [t for t in (_text60(x) for x in day) if t][:20]
        if kept:
            opened[iso] = kept
    return {"rows": rows, "a": week("a"), "b": week("b"), "open_a": _open_week(_prop(d, "open_a")),
            "open_b": _open_week(_prop(d, "open_b")), "cells": cells, "open": opened, "applied": _prop(d, "applied") is True}


def _split(text: str) -> list[str] | None:
    """schedBldSplit_: cell-sized parts, never cut beside a space or before what a sheet reads as a formula."""
    parts, rest = [], text
    while len(rest) > PART:
        at = PART
        while at > 1 and (_SPACE.match(rest[at - 1]) or _SPLIT_BAD.match(rest[at])):
            at -= 1
        parts.append(rest[:at])
        rest = rest[at:]
    parts.append(rest)
    return None if len(parts) > len(PARTS) else parts


def _from_row(r: dict) -> dict[str, Any]:
    """schedBldFromRow_."""
    return {"id": r["id"], "house": r["house_code"], "first": r["first"], "last": r["last"],
            "state": r["state"] if r["state"] in STATES else "pattern", "rev": _int_of(r["rev"], 0),
            "body": _json("".join(r.get(p) or "" for p in PARTS), None), "approved_at": r["approved_at"],
            "approved_by": r["approved_by"], "published_at": r["published_at"], "updated_at": r["updated_at"],
            "updated_by": r["updated_by"]}


def _meta(d: dict) -> dict[str, Any]:
    """schedBldMeta_, the draft itself left out as the answers leave it."""
    return {k: d[k] for k in ("state", "rev", "last", "updated_at", "updated_by", "approved_at", "approved_by",
                              "published_at")}


def _draft_row(d: dict) -> dict[str, str] | None:
    """The row schedBldPut_ writes; None when the draft is too large to keep."""
    parts = _split(_stringify(d["body"] if not gsjs.falsy(d["body"]) else {}))
    if parts is None:
        return None
    row = {"id": d["id"], "house_code": d["house"], "first": d["first"], "last": d["last"], "state": d["state"],
           "rev": str(d["rev"]), "approved_at": d["approved_at"] or "", "approved_by": d["approved_by"] or "",
           "published_at": d["published_at"] or "", "updated_at": d["updated_at"], "updated_by": d["updated_by"]}
    for i, p in enumerate(PARTS):
        row[p] = parts[i] if i < len(parts) else ""
    return row


def _drafts_list(rows: list[dict], house: str) -> list[dict]:
    """schedBldListPut_: the house's drafts, newest first."""
    out = [{"first": r["first"], "last": r["last"], "state": r["state"] if r["state"] in STATES else "pattern",
            "updated_at": r["updated_at"]} for r in rows if r["house_code"] == house]
    out.sort(key=lambda x: x["first"], reverse=True)
    return out[:30]


def _draft_of(rows: list[dict], did: str) -> dict | None:
    row = None
    for r in rows:
        if r["id"] == did:
            row = r
    return _from_row(row) if row else None


# ---- what the screen reads beside the draft ---------------------------------------------------------------------------

def _context(reads: L.Reads, settings: dict, houses: list[dict], house: str, rng: dict) -> dict[str, Any]:
    """schedBldContext_: staff with their IST here, the roster, preferences, time off, shifts elsewhere, the weeks before."""
    out: dict[str, Any] = {"staff": None, "staff_why": "", "roster": [], "prefs": {}, "time_off": [], "elsewhere": {},
                           "prev": None}
    short = {h["code"]: h.get("short") or h["code"] for h in houses}
    got = _staff_list(reads)
    out["staff_why"] = got["why"]
    if got["list"] is not None:
        idx = _ist_warm(reads)
        out["staff"] = []
        for s in got["list"]:
            ist = _ist_for(idx, houses, s["key"], house)
            out["staff"].append({"key": s["key"], "name": s["name"], "ist": True, "ist_why": ""} if ist["has"] is True
                                else {"key": s["key"], "name": s["name"], "ist": False if ist["has"] is False else None,
                                      "ist_why": ist["why"]})
    prefs, _why = L._soft(lambda: _prefs_index(reads))
    for k, p in (prefs or {}).items():
        here = house in (p.get("houses") or [])
        a, b = (p.get("days") or {}).get("a") or [], (p.get("days") or {}).get("b") or []
        if here or a or b:
            out["prefs"][k] = {"here": here, "a": a, "b": b}

    rows, cells, flows = _read(reads, TABS["rows"]), _read(reads, TABS["cells"]), _read(reads, TABS["flows"])
    periods = settings["periods"]
    codes = {h["code"] for h in houses}
    grid_rows = _house_rows(rows, house) if house in codes else []
    out["roster"] = [{"key": r["person_key"], "name": r["name"]} for r in grid_rows
                     if r["row_kind"] == "person" and r["person_key"]]
    current = _current_period(periods, reads.today())
    since = _iso_add(current["first"], -7)
    for f in flows:
        if not (_s(f["date_to"] or f["date"]) >= since or re.match(r"^(waiting|outreach|approved_future)", f["state"])):
            continue
        if f["kind"] != "time_off" or f["state"] not in ("approved", "approved_future") or not f["person_key"]:
            continue
        to = f["date_to"] if _iso_valid(f["date_to"]) else f["date"]
        if not _iso_valid(f["date"]) or f["date"] > rng["last"] or to < rng["first"]:
            continue
        out["time_off"].append({"key": f["person_key"], "name": _s(f["person"]), "from": f["date"], "to": to})

    tokens = _tokens(houses)
    for p in periods:
        if p["last"] < rng["first"] or p["first"] > rng["last"]:
            continue
        col = set(_dates(p["first"], p["last"]))
        holds = _hold_index([c for c in cells if c["date"] in col], rows, flows, tokens)
        for k, hs in holds.items():
            for h in hs:
                if h["date"] not in col or h["why"] != "overlap" or not h["house_code"] or h["house_code"] == house \
                        or h["date"] < rng["first"] or h["date"] > rng["last"]:
                    continue
                day = _day_index(h["date"]) * 1440
                out["elsewhere"].setdefault(k, []).append(
                    [h["date"], int(h["s"] - day), int(h["e"] - day), short.get(h["house_code"]) or h["house_code"]])

    cell_at = {}
    for c in cells:
        if c["house_code"] == house:
            cell_at[c["row_id"] + "|" + c["date"]] = c

    def week(start: str) -> dict[str, Any]:
        w: dict[str, Any] = {"rows": {}, "open": [[] for _ in range(7)], "names": {}}
        for i in range(7):
            iso = _iso_add(start, i)
            if not _period_of(periods, iso) or house not in codes:
                continue
            for r in grid_rows:
                c = cell_at.get(r["row_id"] + "|" + iso)
                text = c["text"] if c and c["text"] and c["state"] in ("", "scheduled", "open") else ""
                if r["row_kind"] == "open":
                    if text:
                        w["open"][i].append(text)
                    continue
                if r["row_kind"] != "person" or not r["person_key"]:
                    continue
                if r["person_key"] not in w["rows"]:
                    w["rows"][r["person_key"]] = ["", "", "", "", "", "", ""]
                    w["names"][r["person_key"]] = r["name"]
                w["rows"][r["person_key"]][i] = text
        return w
    out["prev"] = {"a": week(_iso_add(rng["first"], -14)), "b": week(_iso_add(rng["first"], -7))}
    return out


# ---- the read ---------------------------------------------------------------------------------------------------------

def _unreadable(e: BaseException) -> dict[str, Any]:
    return {"status": 503, "message": "The Scheduling calendar could not be read just now — " + str(e)[:200]}


def builder_read(sess: L.Session, payload: dict) -> dict[str, Any]:
    """schedulingBuilderRead: the houses this editor builds, the draft for one house and first Monday, what it checks."""
    ctx = _gate(sess)
    if not ctx["open"]:
        return dict(UNKNOWN)
    payload = payload or {}
    reads = sess.reads
    try:
        settings = _settings(reads)
        houses_all = _houses(reads, settings)
        rows = _read(reads, TABS["rows"]) if not (ctx["is_master"] or ctx["is_director"]) else []
        houses = [h for h in houses_all if _editor(ctx, rows, h["code"])]
        if not houses:
            return {"status": 403, "message": "The Builder is for the house managers, the Scheduling directors and the master."}
        asked = _s(payload.get("house"))
        house = next((h for h in houses if h["code"] == asked), houses[0])["code"]
        store = "" if _ready(reads, TABS["drafts"]) else NO_STORE
        draft_rows = [] if store else _read(reads, TABS["drafts"])
        drafts = [] if store else _drafts_list(draft_rows, house)
        first, last = _s(payload.get("first")), _s(payload.get("last"))
        if not first:
            opened = next((x for x in drafts if x["state"] != "published"), None)
            if opened:
                first = opened["first"]
                last = last or opened["last"]
        today = reads.today()
        if not first:
            last_p = settings["periods"][-1] if settings["periods"] else None
            first = _next_monday(_iso_add(last_p["last"], 1) if last_p and last_p["last"] >= today else today)
        d = None if store or not _iso_valid(first) else _draft_of(draft_rows, _bld_id(house, first))
        if not last:
            last = d["last"] if d else (_iso_add(first, 27) if _iso_valid(first) else "")
        rng = _range(first, last)
        if rng.get("error"):
            return {"status": 400, "message": rng["error"]}
        c = _context(reads, settings, houses_all, house, rng)
        data = {"ok": True, "today": today, "house": house, "first": rng["first"], "last": rng["last"],
                "weeks": rng["weeks"], "store": store,
                "houses": [{"code": h["code"], "short": h.get("short") or h["code"], "location": h["location"]}
                           for h in houses],
                "periods": [{"id": p["id"], "first": p["first"], "last": p["last"]} for p in settings["periods"]],
                "drafts": drafts, "staff": c["staff"], "staff_why": c["staff_why"], "roster": c["roster"],
                "prefs": c["prefs"], "time_off": c["time_off"], "elsewhere": c["elsewhere"], "prev": c["prev"],
                "state": d["state"] if d else "pattern", "rev": d["rev"] if d else 0, "draft": d["body"] if d else None,
                "updated_at": d["updated_at"] if d else "", "updated_by": d["updated_by"] if d else "",
                "approved_at": d["approved_at"] if d else "", "approved_by": d["approved_by"] if d else "",
                "published_at": d["published_at"] if d else ""}
        return {"status": 200, "data": data}
    except _Unread as e:
        return _unreadable(e)


# ---- the writes: each decided here and kept in app.edits ---------------------------------------------------------------

def _refused(status: int, message: str, **kw: Any) -> Decision:
    """A 503 is Apps Script's to word; any other refusal is answered here."""
    if status == 503:
        raise Defer(message[:160])
    return W.refuse(status, message, **kw)


def _editor_refusal(ctx: dict, reads: L.Reads, house: str) -> Decision | None:
    """schedBldEditor_."""
    if not house:
        return _refused(400, "Pick a house.")
    if not any(h["code"] == house for h in _houses(reads, _settings(reads))):
        return _refused(404, "There is no such house.")
    if not _editor(ctx, _read(reads, TABS["rows"]), house):
        return _refused(403, "Only the house manager, the Scheduling directors and the master build this calendar.")
    return None


def _house_res(reads: L.Reads, tab: str) -> hubdb.Resolved:
    res = W.tab_of(reads, tab)
    if res.ref is None:
        raise Defer(f"the {tab} house holds no tab in the copy yet")
    return res


def _upserts(reads: L.Reads, tab: str, new_rows: list[dict], subject: str) -> list[dict]:
    """schedUpsert_: a row by its id (key for settings) edited where it stands, else appended — in the house's own table
    when it has one (nothing returned), else as kept edits."""
    idf = "key" if tab == TABS["settings"] else "id"
    if HT.tabled(tab):
        for row in new_rows:
            k = _s(row.get(idf))
            if not k:
                raise RuntimeError(f"A {tab} row needs its {idf}.")
            HT.put(reads, tab, idf, k, {h: gsjs.or_blank(row.get(h)) for h in HEADERS[tab]}, subject)
        return []
    res = _house_res(reads, tab)
    sid, name = W.where_of(res)
    match = "cols:key" if idf == "key" else "id"
    first_of: dict[str, dict] = {}
    for r in _read(reads, tab):
        first_of.setdefault(r[idf], r)
    order: list[str] = []
    by_id: dict[str, dict] = {}
    for row in new_rows:
        k = _s(row.get(idf))
        if not k:
            raise RuntimeError(f"A {tab} row needs its {idf}.")
        if k not in by_id:
            order.append(k)
        by_id[k] = row
    out = []
    for k in order:
        line = {h: gsjs.or_blank(by_id[k].get(h)) for h in HEADERS[tab]}
        was = first_of.get(k)
        if was is None:
            out.append(W.kept_record(sid, name, "append", match, k, subject, {h: v for h, v in line.items() if v != ""}))
            continue
        changed = {h: v for h, v in line.items() if v != was.get(h, "")}
        if changed:
            out.append(W.kept_record(sid, name, "edit", match, k, subject, changed, {h: was.get(h, "") for h in changed}))
    return out


def _appends(reads: L.Reads, tab: str, new_rows: list[dict], subject: str) -> list[dict]:
    """schedAppend_: in the house's own table when it has one (nothing returned), else as kept edits."""
    if HT.tabled(tab):
        RR.create_many(reads, HT.resource_of(tab) or "", [
            {h: gsjs.or_blank(r.get(h)) for h in HEADERS[tab] if gsjs.or_blank(r.get(h)) != ""} for r in new_rows],
            subject)
        return []
    sid, name = W.where_of(_house_res(reads, tab))
    return [W.kept_record(sid, name, "append", "id", r["id"], subject,
                          {h: gsjs.or_blank(r.get(h)) for h in HEADERS[tab] if gsjs.or_blank(r.get(h)) != ""})
            for r in new_rows]


def builder_save(sess: L.Session, payload: dict) -> Decision:
    """schedulingBuilderSave: the draft for { house, first }, 'approved' once the pattern check is, else 'pattern'."""
    ctx = _gate(sess)
    if not ctx["open"]:
        return Decision(dict(UNKNOWN))
    payload = payload or {}
    reads = sess.reads
    house = _s(payload.get("house"))
    rng = _range(_s(payload.get("first")), _s(payload.get("last")))
    if rng.get("error"):
        return _refused(400, rng["error"])
    state = "approved" if _s(payload.get("state")) == "approved" else "pattern"
    try:
        refused = _editor_refusal(ctx, reads, house)
        if refused:
            return refused
        if not _ready(reads, TABS["drafts"]):
            return _refused(503, NO_STORE)
        body = _clean(payload.get("draft"), rng)
        if state == "approved" and not body["applied"]:
            return _refused(409, "Apply the patterns to the period before approving.")
        W.gate(reads)
        did = _bld_id(house, rng["first"])
        was = _draft_of(_read(reads, TABS["drafts"]), did)
        if (was["rev"] if was else 0) != _int_of(payload.get("rev"), 0):
            return _refused(409, CONFLICT, data={"conflict": True})
        now = W.now_iso(reads)
        kept = state == "approved" and was and was["state"] != "pattern" and was["approved_at"]
        d = {"id": did, "house": house, "first": rng["first"], "last": rng["last"], "state": state,
             "rev": (was["rev"] if was else 0) + 1, "body": body,
             "approved_at": (was["approved_at"] if kept else now) if state == "approved" else "",
             "approved_by": (was["approved_by"] if kept else ctx["name"]) if state == "approved" else "",
             "published_at": was["published_at"] if was else "", "updated_at": now, "updated_by": ctx["name"]}
        row = _draft_row(d)
        if row is None:
            return _refused(503, "The Scheduling calendar could not be read just now — " + TOO_LARGE)
        edits = _upserts(reads, TABS["drafts"], [row], house)
        edition = _edition_of(ctx, reads, house)
    except _Unread as e:
        return _refused(503, _unreadable(e)["message"])
    data: dict[str, Any] = {**_meta(d), "ok": True, "said": "Pattern approved." if state == "approved" else "Draft saved."}
    return W.final({"status": 200, "data": data}, edits, house, edition)


def _plan(reads: L.Reads, ctx: dict, house: str, rng: dict, body: Any, periods: list[dict], now: str) -> dict[str, Any]:
    """schedBldPlan_: the cells a publish writes, every person row of the draft and its OPEN shifts, from today on."""
    today = reads.today()
    rows, cells, flows = _read(reads, TABS["rows"]), _read(reads, TABS["cells"]), _read(reads, TABS["flows"])
    houses = _houses(reads, _settings(reads))
    tokens = _tokens(houses)
    label = _label(houses, house)
    location = next((h["location"] for h in houses if h["code"] == house), "")
    ist = _ist_warm(reads)
    dates = [d for d in _dates(rng["first"], rng["last"]) if d >= today]
    cell_at: dict[str, dict] = {}
    for c in cells:
        if c["house_code"] == house and rng["first"] <= c["date"] <= rng["last"]:
            cell_at[c["row_id"] + "|" + c["date"]] = c
    pending: set[str] = set()
    for f in flows:
        if f["kind"] not in ("request_off", "swap", "training") or _s(f["state"]) not in FLOW_WAITING:
            continue
        if f["house_code"] == house:
            pending.add(f["row_id"] + "|" + f["date"])
        ex = _flow_exchange(f)
        if ex and ex.get("house") == house:
            pending.add(gsjs.or_blank(ex.get("row_id")) + "|" + gsjs.or_blank(ex.get("date")))
    holds = {k: [h for h in hs if h["house_code"] != house] for k, hs in _hold_index(cells, rows, flows, tokens).items()}
    out: dict[str, Any] = {"rows": [], "cells": [], "remove": [], "log": [], "skipped": [], "keys": [], "written": 0,
                           "cleared": 0}
    house_rows = [r for r in rows if r["house_code"] == house]
    row_of: dict[str, dict] = {}
    max_order, max_open = 0.0, 0
    for r in house_rows:
        row_of[r["row_id"]] = r
        if r["row_kind"] == "person":
            max_order = max(max_order, _float_of(r["order"]))
        if r["row_kind"] == "open":
            max_open = max(max_open, _open_n(r["row_id"]))

    def skip(name: str, day: str, text: str, why: str) -> None:
        out["skipped"].append({"name": name, "date": day, "text": text, "why": why})

    def cell_row(row_id: str, day: str, text: str, state: str, color: str) -> dict[str, str]:
        cls = _classify(text)
        p = _period_of(periods, day)
        return {"id": "SC_" + _sha16(house + "|" + row_id + "|" + day), "period_id": p["id"] if p else "",
                "house_code": house, "date": day, "row_id": row_id, "text": text, "kind": cls["kind"] if cls else "",
                "start_min": str(_round(cls["start"] * 60)) if cls and cls["start"] is not None else "",
                "end_min": str(_round(cls["end"] * 60)) if cls and cls["end"] is not None else "",
                "hours": _fixed2(cls["hours"]) if cls else "0.00", "token": cls["token"] if cls and cls["token"] else "",
                "color": color, "state": state, "base": "", "flow_id": "", "source": "builder", "note": "",
                "updated_at": now, "updated_by": ctx["uid"]}

    def put(row_id: str, day: str, was: dict | None, text: str, state: str) -> None:
        if not text:
            if not was:
                return
            out["remove"].append(was["id"])
            out["cleared"] += 1
        else:
            out["cells"].append(cell_row(row_id, day, text, state, was["color"] if was else ""))
            out["written"] += 1
        out["log"].append({"id": _new_id("SL"), "at": now, "by_uid": ctx["uid"], "by_name": ctx["name"],
                           "house_code": house, "date": day, "row_id": row_id, "was": was["text"] if was else "",
                           "now": text, "via": "builder", "flow_id": "", "note": "Builder", "undone_at": ""})

    def held(key: str, was: dict | None) -> str:
        if key in pending:
            return "a request is waiting on it"
        if was and (_s(was["state"]) in ONE_OFF_STATES or _s(was["flow_id"])):
            return "kept: " + (_s(was["state"]) or "a flow holds it")
        return ""

    body_rows = _prop(body, "rows")
    body_cells = _prop(body, "cells")
    body_open = _prop(body, "open")
    for br in body_rows if isinstance(body_rows, list) else []:
        key, name = _s(_prop(br, "key")), _s(_prop(br, "name"))
        row_id = "P:" + key
        rec = row_of.get(row_id)
        need = None if _on_roster(rows, cells, house, key) else _ist_for(ist, houses, key, house)
        need = None if need and need["has"] is True else need
        no_ist = 0
        if not rec or rec["active"] == "no":
            if rec:
                rec = dict(rec)
            else:
                max_order += 1
                rec = {"id": "SR_" + _sha16(house + "|" + row_id), "house_code": house, "location": "",
                       "row_id": row_id, "row_kind": "person", "name": name, "person_key": key, "designation": "",
                       "order": gsjs.num_str(max_order), "source": "builder"}
            if not rec.get("location"):
                rec["location"] = location
            rec.update({"active": "yes", "updated_at": now, "updated_by": ctx["uid"]})
            out["rows"].append(rec)
            row_of[row_id] = rec
        name = rec["name"] or name
        out["keys"].append(key)
        line = _prop(body_cells, key) if not gsjs.falsy(body_cells) else None
        for d in dates:
            text = _s(_prop(line, d)) if not gsjs.falsy(line) else ""
            was = cell_at.get(row_id + "|" + d)
            if _s(was["text"] if was else "") == text:
                continue
            why = held(row_id + "|" + d, was)
            if why:
                skip(name, d, text, why)
                continue
            cls = _classify(text)
            if text and cls and cls["kind"] not in ("off", "ro"):
                if need and cls["start"] is not None:
                    no_ist += 1
                    continue
                span = _value_span(cls, text)
                clash = _clash(key, d, span[0] if span else None, span[1] if span else None, holds, house, text, tokens)
                if clash:
                    skip(name, d, text, "approved time off" if clash["why"] == "time_off" else
                         "already at " + _label(houses, clash["house_code"]) + " " + _shift_words(clash["text"]))
                    continue
            put(row_id, d, was, text, "scheduled")
        if no_ist:
            skip(name, "", f"{no_ist} shift{'' if no_ist == 1 else 's'}",
                 "no IST at " + label + " — place them from House Calendars so the training is asked for")

    open_rows = sorted((r for r in house_rows if r["row_kind"] == "open" and r["active"] != "no"), key=_cmp(_row_order))
    for d in dates:
        day_open = _prop(body_open, d) if not gsjs.falsy(body_open) else None
        left = [t for t in (_s(x) for x in (day_open if isinstance(day_open, list) else [])) if t]
        free: list[str] = []
        for r in list(open_rows):
            c = cell_at.get(r["row_id"] + "|" + d)
            if not c or (not _s(c["text"]) and not _s(c["base"])):
                free.append(r["row_id"])
                continue
            if _s(c["text"]) in left:
                left.remove(_s(c["text"]))
                continue
            if _s(c["state"]) == "open" and not held(r["row_id"] + "|" + d, c):
                put(r["row_id"], d, c, "", "")
                free.append(r["row_id"])
        free.sort(key=_open_n)
        for text in left:
            row_id = free.pop(0) if free else ""
            if not row_id:
                max_open += 1
                row_id = "OPEN:" + str(max_open)
                rec = {"id": "SR_" + _sha16(house + "|" + row_id), "house_code": house, "location": location,
                       "row_id": row_id, "row_kind": "open", "name": "OPEN" if max_open == 1 else f"OPEN {max_open}",
                       "person_key": "", "designation": "", "order": str(max_open), "active": "yes", "source": "builder",
                       "updated_at": now, "updated_by": ctx["uid"]}
                out["rows"].append(rec)
                open_rows.append(rec)
            was = cell_at.get(row_id + "|" + d)
            put(row_id, d, was if was and _s(was["text"]) else None, text, "open")
    return out


def _cleared(cell: dict, now: str, uid: str) -> dict[str, str]:
    """A cell schedRemove_ takes off: kept as a row that holds nothing (app.edits has no delete)."""
    out = {h: "" for h in HEADERS["sched_cells"] if h not in ("id", "period_id", "house_code", "date", "row_id")}
    out.update({"state": "scheduled", "source": "builder", "updated_at": now, "updated_by": uid})
    return {**{h: cell.get(h, "") for h in ("id", "period_id", "house_code", "date", "row_id")}, **out}


def _overlaid(own: Any, edits: list[dict]) -> W.Own:
    """This request's own-write layer with a decision's edits laid on top, as the next read will find them."""
    base = own if own is not None else W.Own([])
    out = copy.copy(base)
    out.held, out.done = set(), {}
    groups = {k: [{**g, "cells": dict(g["cells"])} for g in v] for k, v in base.edits.items()}
    top = max((i for gs in groups.values() for g in gs for (i, _v, _b) in g["cells"].values()), default=0)
    for e in edits:
        gs = groups.setdefault((e["sheet_id"], e["tab_name"]), [])
        g = next((x for x in gs if (x["match"], x["keyed"], x["row_key"]) == (e["match"], e["keyed"], e["row_key"])),
                 None)
        if g is None:
            g = {"match": e["match"], "keyed": e["keyed"], "row_key": e["row_key"], "appended": False, "cells": {},
                 "first": top + 1}
            gs.append(g)
        g["appended"] = g["appended"] or e["kind"] == "append"
        for f, v in e["cells"].items():
            top += 1
            g["cells"][f] = (top, v, g["cells"][f][2] if f in g["cells"] else top)
    out.edits = groups
    return out


def _test_mode(reads: L.Reads) -> dict[str, Any]:
    """schedTestMode_ over hubTestModeState_: fail closed."""
    cfg = reads.config()

    def items(raw: Any) -> list[str]:
        return [x for x in (gsjs.trim(s) for s in re.split(r"[,;\n]+", gsjs.or_blank(raw))) if x]
    sms = [p for p in ("+1" + re.sub(r"^1", "", re.sub(r"[^0-9]", "", r), count=1)
                       for r in items(cfg.get("test_redirect_sms"))) if len(p) == 12]
    mails = [m for m in items(cfg.get("test_redirect_email")) if re.fullmatch(r"[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+", m)]
    raw = gsjs.trim(gsjs.or_blank(cfg.get("test_mode"))).lower()
    if raw in TEST_ON or raw in TEST_REHEARSAL:
        on = True
    elif raw in TEST_OFF:
        on = False
    elif not raw:
        on = len(sms) + len(mails) > 0
    else:
        return {"on": True, "readable": False,
                "why": f'test_mode reads "{raw[:40]}", a word the switch does not know (on or off) — held as on until '
                       "it is saved as one of them"}
    return {"on": on, "readable": True, "why": "Test mode is on: texts are held." if on else ""}


def _board_part(sess: L.Session, own: W.Own, period_id: str, houses: list[str], keys: list[str]) -> dict[str, Any]:
    """schedBoardPart_: the board module's board after this write, cut to the house and the people it named."""
    SCH = _sch()
    board = getattr(SCH, "ACTIONS", {}).get("schedulingBoard") if SCH is not None else None
    if not callable(board):
        raise RuntimeError("the board module is not here")
    token = hubdb.OWN.set(own)
    try:
        env = board(L.Session(L.Reads(sess.reads.db, sess.reads.drive, sess.reads.now), sess.user),
                    {"period_id": period_id})
    finally:
        hubdb.OWN.reset(token)
    data = env.get("data") if isinstance(env, dict) and env.get("status") == 200 else None
    if not isinstance(data, dict):
        raise RuntimeError("the board did not answer")
    grids = data.get("grids") or {}
    busy = data.get("busy") or {}
    part = {"grids": {h: grids[h] for h in houses if h in grids}, "busy": {k: v for k, v in busy.items() if k in keys},
            "mine": data.get("mine"), "waiting_on_me": data.get("waiting_on_me"), "test_mode": data.get("test_mode")}
    log = data.get("log") or {}
    if any(h in log for h in houses):
        part["log"] = {h: log[h] for h in houses if h in log}
    return part


def builder_publish(sess: L.Session, payload: dict) -> Decision:
    """schedulingBuilderPublish: the approved draft into the house's calendar, the period its last weeks need added."""
    ctx = _gate(sess)
    if not ctx["open"]:
        return Decision(dict(UNKNOWN))
    payload = payload or {}
    reads = sess.reads
    house, first = _s(payload.get("house")), _s(payload.get("first"))
    try:
        refused = _editor_refusal(ctx, reads, house)
        if refused:
            return refused
        if not _ready(reads, TABS["drafts"]):
            return _refused(503, NO_STORE)
        W.gate(reads)
        drafts_sid = _house_res(reads, TABS["drafts"]).sheet_id
        d = _draft_of(_read(reads, TABS["drafts"]), _bld_id(house, first))
        if not d or gsjs.falsy(d["body"]):
            return _refused(404, "There is no draft for these weeks.", fresh=(drafts_sid,))
        if d["state"] == "pattern":
            return _refused(409, "Approve the pattern check before publishing.", fresh=(drafts_sid,))
        if _s(payload.get("rev")) != "" and d["rev"] != _int_of(payload.get("rev"), -1):
            return _refused(409, CONFLICT, data={"conflict": True}, fresh=(drafts_sid,))
        rng = _range(d["first"], d["last"])
        if rng.get("error"):
            return _refused(409, rng["error"], fresh=(drafts_sid,))
        settings = _settings(reads)
        if not settings["readable"]:
            return _refused(503, "The Scheduling settings could not be read: " + settings["why"])
        periods = settings["periods"]
        last_p = periods[-1]
        if rng["first"] < periods[0]["first"]:
            return _refused(409, "These weeks start before the first calendar period.", fresh=True)
        now = W.now_iso(reads)
        added = None
        edits: list[dict] = []
        if rng["last"] > last_p["last"]:
            start = _iso_add(last_p["last"], 1)
            added = {"id": "P" + start, "first": start, "last": rng["last"], "state": "live", "rolled_from": "",
                     "rolled_at": now, "by": ctx["uid"]}
            periods = periods + [added]
            edits += _upserts(reads, TABS["settings"], [{"key": "periods", "value": _stringify(periods), "note": "builder",
                                                         "updated_at": now, "updated_by": ctx["uid"]}], house)
            periods = _periods_of(_stringify(periods)) or periods
        plan = _plan(reads, ctx, house, rng, d["body"], periods, now)
        if plan["rows"]:
            edits += _upserts(reads, TABS["rows"], plan["rows"], house)
        written = {c["id"] for c in plan["cells"]}
        gone = {c["id"]: c for c in _read(reads, TABS["cells"])}
        wipes = [_cleared(gone[i], now, ctx["uid"]) for i in dict.fromkeys(plan["remove"]) if i in gone and i not in written]
        if wipes or plan["cells"]:
            edits += _upserts(reads, TABS["cells"], wipes + plan["cells"], house)
        if plan["log"]:
            edits += _appends(reads, TABS["log"], plan["log"], house)
        d.update({"state": "published", "rev": d["rev"] + 1, "published_at": now, "updated_at": now,
                  "updated_by": ctx["name"]})
        row = _draft_row(d)
        if row is None:
            return _refused(503, "The Scheduling calendar could not be read just now — " + TOO_LARGE)
        edits += _upserts(reads, TABS["drafts"], [row], house)
        period = _period_of(periods, rng["first"]) or periods[0]
        label = _label(_houses(reads, settings), house)
        books = tuple(dict.fromkeys(_house_res(reads, TABS[t]).sheet_id for t in ("cells", "rows", "flows", "settings")))
        edition = _edition_of(ctx, reads, house)
    except _Unread as e:
        return _refused(503, _unreadable(e)["message"])
    said = (f"Published {label}: {plan['written']} shift{'' if plan['written'] == 1 else 's'} written"
            + (f", {plan['cleared']} cleared" if plan["cleared"] else "")
            + (f", {len(plan['skipped'])} left as they were" if plan["skipped"] else "") + ".")
    extra = {"builder": {"written": plan["written"], "cleared": plan["cleared"], "skipped": plan["skipped"][:REPORT],
                         "skipped_count": len(plan["skipped"]), "period_added": added["id"] if added else "",
                         "meta": _meta(d)}}
    try:
        part = _board_part(sess, _overlaid(hubdb.OWN.get(), edits), period["id"], [house], plan["keys"])
        data: dict[str, Any] = {"ok": True, "said": said, "period_id": period["id"], "grids": part["grids"],
                                "busy": part["busy"], "mine": part["mine"], "waiting_on_me": part["waiting_on_me"],
                                "test_mode": part["test_mode"]}
        if "log" in part:
            data["log"] = part["log"]
    except Exception:  # noqa: BLE001 - schedAnswerAfter_: saved, the calendar read back later
        data = {"ok": True, "said": said, "period_id": period["id"], "grids": {}, "busy": {}, "reread": REREAD,
                "test_mode": _test_mode(reads)}
    data.update(extra)
    out = W.final({"status": 200, "data": data}, edits, house, edition)
    # the other Scheduling doors still write these houses in the sheet: a plan read off a copy the sheet has moved past waits
    out.fresh = books
    return out


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"schedulingBuilderRead": builder_read}
WRITE_ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"schedulingBuilderSave": builder_save,
                                                                  "schedulingBuilderPublish": builder_publish}
# HUB_POLICY: the roles each action is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "schedulingBuilderRead": {"roles": ROLES, "params": {"house": "string", "first": "string", "last": "string"}},
    "schedulingBuilderSave": {"roles": ROLES, "params": {"house": "string", "first": "string", "last": "string",
                                                         "draft": "object", "state": "string", "rev": "string"}},
    "schedulingBuilderPublish": {"roles": ROLES, "params": {"house": "string", "first": "string", "rev": "string"}}}
# the doors take the lock before refusals this side cannot order: a held lock is Apps Script's to answer
BUSY_OF: dict[str, dict[str, Any]] = {}
