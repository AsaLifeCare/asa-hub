"""Scheduling's flows (apps-script/SchedulingFlows.gs): refused off asa-hub-db, each allowed write made final in
Python (scheduling_flow_writes)."""
from __future__ import annotations

import hashlib
import json
import math
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc
import staff as SP
import staff_perf as SPF
from gsjs import NY
from scope import Defer
from writes import Decision

APP_ID = "scheduling"
SETTINGS = "sched_settings"
UNKNOWN = "Unknown action."
TIMED = ("day", "morning", "afternoon", "evening", "overnight")
HOLDING = ("scheduled", "swap_in", "taken", "training")
WAITING = ("waiting", "waiting_staff", "waiting_manager", "waiting_director")
SWAPPABLE = ("scheduled", "swap_in", "taken", "training")
STATE_WORDS = {"called_off": "called off", "requested_off": "requested off", "time_off": "time off",
               "swapped_out": "swapped away already", "open": "an open shift"}
OFF_STATES = ("called_off", "requested_off", "time_off", "swapped_out")
TIMEOFF_MAX_DAYS = 60
FIRST_PERIOD = {"id": "P2026-09-28", "first": "2026-09-28", "last": "2026-10-25"}
WEEKDAYS = ("SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT")
WEEKDAY_ABBR = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
PREF_DAY_WORDS = ("Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays")
NOT_WORKING = frozenset({"OFF", "R/O", "C/O", "RO", "R\\O", "R/0", "NCNS", "NO WORKSHOP"})
NO_ACCOUNT = "Pick somebody with a platform account — they answer in My Work."
NOT_PEOPLE_ROWS = "A swap is between two people's shifts — never an OPEN, workshop or other row."
SAME_PERSON = "Both shifts are the same person's — pick somebody else's shift."

# JavaScript's \s, so a cell reads here as String.prototype.split and RegExp read it there
_WS = "[" + "".join(map(chr, (0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F,
                                0x3000, 0xFEFF))) + chr(0x2000) + "-" + chr(0x200A) + "]"
_WS_RUN = re.compile(_WS + "+")
_SPAN = (r"([0-9]{1,2})(?::?([0-9]{2}))?" + _WS + r"*([AaPp])?[Mm]?" + _WS + r"*[-–]" + _WS +
         r"*([0-9]{1,2})(?::?([0-9]{2}))?" + _WS + r"*([AaPp])[Mm]?")
_TIME_RANGE = re.compile(r"^\*?" + _WS + "*" + _SPAN + r"(?:" + _WS + r"+[A-Za-z]{1,4})?" + _WS + r"*\Z")
_TIME_INSIDE = re.compile(_SPAN + r"(?![A-Za-z0-9])")
_CHAIN = re.compile(_WS + r"*[><]" + _WS + "*")
_PERSON_ROW = re.compile("^P:[^\n\r" + chr(0x2028) + chr(0x2029) + "]")
_YMD = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})$")
_NUM = re.compile(r"^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$")
_INT_HEAD = re.compile(r"^[+-]?[0-9]+")
_FLOW_ID = re.compile(r"SF[0-9A-F]{10}")
_ITEM_ID = re.compile(r"SI[0-9A-F]{10}")


# ---- small values, as the JavaScript reads them ---------------------------------------------------------------

def _s(v: Any) -> str:
    """String(v == null ? '' : v).trim()."""
    return gsjs.trim(gsjs.or_blank(v))


def _fold(v: Any) -> str:
    """hubNameFold_."""
    return re.sub(r"[^a-z0-9]+", "", gsjs.or_blank(v).lower())


def _slice16(s: str, n: int) -> str:
    """String.prototype.slice(0, n), counted in UTF-16 units."""
    units = s.encode("utf-16-le", "surrogatepass")
    if len(units) <= 2 * n:
        return s
    cut = units[:2 * n]
    if 0xD800 <= int.from_bytes(cut[-2:], "little") <= 0xDBFF:
        raise Defer("a text's cut falls inside a character, which only Apps Script's answer can carry")
    return cut.decode("utf-16-le", "surrogatepass")


def _text(v: Any, n: int = 0) -> str:
    """schedFlowText_."""
    s = gsjs.trim(_WS_RUN.sub(" ", gsjs.or_blank(v)))
    return _slice16(s, n) if n else s


def _num(v: Any) -> float:
    """Number(v)."""
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = gsjs.trim(gsjs.js_str(v))
    if not s:
        return 0.0
    if s in ("Infinity", "+Infinity", "-Infinity"):
        return -math.inf if s[0] == "-" else math.inf
    return float(s) if _NUM.match(s) else math.nan


def _int_of(v: Any, fallback: int) -> int:
    """schedIntOf_: parseInt of the trimmed text."""
    m = _INT_HEAD.match(_s(v))
    return int(m.group(0)) if m else fallback


def _json(raw: Any, fallback: Any) -> Any:
    """schedFlowJson_."""
    if isinstance(raw, (dict, list)):
        return raw
    try:
        v = json.loads(gsjs.or_text(raw))
    except ValueError:
        return fallback
    return v if isinstance(v, (dict, list)) else fallback


def _ymd(iso: Any) -> tuple[int, int, int] | None:
    """schedFlowYmd_."""
    m = _YMD.match(_s(iso))
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def _utc_day(y: int, month: int, d: int) -> date | None:
    """Date.UTC(y, month - 1, d) as a day, months and days rolling over as there."""
    try:
        return date(y + (month - 1) // 12, (month - 1) % 12 + 1, 1) + timedelta(days=d - 1)
    except (ValueError, OverflowError):
        return None


def _add_days(iso: Any, n: int) -> str:
    """schedFlowAddDays_."""
    p = _ymd(iso)
    d = _utc_day(p[0], p[1], p[2] + int(n or 0)) if p else None
    return f"{d.year:04d}-{d.month:02d}-{d.day:02d}" if d else ""


def _iso_valid(iso: Any) -> bool:
    """schedIsoValid_."""
    p = _ymd(iso)
    if not p:
        return False
    try:
        date(*p)
    except ValueError:
        return False
    return True


def _day_index(iso: Any) -> int | None:
    """schedDayIndex_; None where it is NaN."""
    m = re.fullmatch(r"([0-9]{1,4})-([0-9]{1,2})-([0-9]{1,2})", _s(iso))
    d = _utc_day(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None
    return (d - date(1970, 1, 1)).days if d else None


def _dow(iso: Any) -> int:
    return ((_day_index(iso) or 0) % 7 + 7 + 4) % 7


def _now_ms(reads: L.Reads) -> float:
    return reads.now.timestamp() * 1000.0


def _midnight_ms(iso: Any) -> float:
    """schedFlowMidnightMs_: the instant an Ohio day begins."""
    p = _ymd(iso)
    d = _utc_day(*p) if p else None
    if d is None:
        return math.nan
    probe = datetime(d.year, d.month, d.day, 5, tzinfo=timezone.utc)
    local = probe.astimezone(NY)
    return probe.timestamp() * 1000.0 - (local.hour * 60 + local.minute) * 60000.0


def _at_min(iso: Any, minutes: float) -> float:
    return _midnight_ms(iso) + minutes * 60000.0


def _ended(iso: Any, end_min: Any, now_ms: float) -> bool:
    """schedFlowEnded_."""
    return not (_at_min(iso, _num(end_min)) > now_ms)


def _day_words(iso: Any) -> str:
    """schedFlowDayWords_: EEE M/d."""
    p = _ymd(iso)
    d = _utc_day(*p) if p else None
    if d is None:
        return gsjs.or_text(iso)
    return f"{WEEKDAY_ABBR[d.weekday()]} {d.month}/{d.day}"


# ---- the cell grammar (Scheduling.gs schedClassify_) --------------------------------------------------------------

def _hour(h: str, m: str | None, ap: str | None) -> float:
    return int(h) % 12 + (12 if (ap or "").upper() == "P" else 0) + (int(m) / 60 if m else 0)


def _span_of(m: re.Match) -> list[float]:
    start, end = _hour(m.group(1), m.group(2), m.group(3) or m.group(6)), _hour(m.group(4), m.group(5), m.group(6))
    if m.group(3) is None and start >= end:
        start = ((start - 12) % 24 + 24) % 24
    if end <= start:
        end += 24
    return [start, end]


def _range(segment: str) -> list[float] | None:
    m = _TIME_RANGE.match(_s(segment))
    return _span_of(m) if m else None


def _kind_for(start: float, end: float) -> str:
    if start >= 19 or end > 24:
        return "overnight"
    if end - start >= 11 and start <= 10:
        return "day"
    if start < 11:
        return "morning"
    return "afternoon" if start < 16 else "evening"


def _classify(raw: Any) -> dict[str, Any] | None:
    """schedClassify_: {kind, code, token, start, end}; None for an empty cell."""
    code = _s(raw)
    if not code:
        return None
    hours = token = None
    for seg in (x for x in _CHAIN.split(code) if gsjs.trim(x)):
        got = _range(seg)
        if got and hours is None:
            hours = got
        elif not got and token is None:
            if gsjs.trim(re.sub(r"^\*+", "", gsjs.trim(seg).upper())) not in NOT_WORKING:
                token = gsjs.trim(seg)
    shown = gsjs.trim(re.sub(r"^\*+", "", code))
    if hours:
        return {"kind": _kind_for(hours[0], hours[1]), "code": shown, "token": token, "start": hours[0],
                "end": hours[1]}
    up = shown.upper()
    if up == "OFF":
        return {"kind": "off", "code": "OFF", "token": None, "start": None, "end": None}
    if up in NOT_WORKING:
        return {"kind": "ro", "code": up, "token": None, "start": None, "end": None}
    return {"kind": "alias", "code": shown, "token": shown, "start": None, "end": None}


def _time_inside(text: Any) -> list[float] | None:
    m = _TIME_INSIDE.search(gsjs.or_blank(text))
    return _span_of(m) if m else None


def _shift_words(text: Any) -> str:
    """schedShiftWords_ (short)."""
    return gsjs.trim(re.sub(r"^\*+", "", _s(text)))


def _timed(cell: dict | None) -> bool:
    """schedFlowTimed_."""
    if not cell or _s(cell.get("kind")) not in TIMED:
        return False
    if _s(cell.get("start_min")) == "" or _s(cell.get("end_min")) == "":
        return False
    s, e = _num(cell.get("start_min")), _num(cell.get("end_min"))
    return not math.isnan(s) and not math.isnan(e) and e > s


def _holds(cell: dict | None) -> bool:
    """schedFlowHolds_."""
    return _timed(cell) and (_s(cell.get("state")) or "scheduled") in HOLDING


# ---- the houses, as the copy holds them ---------------------------------------------------------------------------

def _rows(reads: L.Reads, tab: str) -> list[dict]:
    """schedRead_: a Scheduling house's rows keyed by its header, each cell its text."""
    def read() -> list[dict]:
        db = reads.db
        if HT.tabled(tab):
            idf = "key" if tab == SETTINGS else "id"
            return [r for r in ({h: gsjs.trim(v) for h, v in row.items()} for row in HT.rows(reads, tab))
                    if r.get(idf)]
        if not db.house_moved(tab):
            raise Defer(f'the Scheduling house "{tab}" is not set up in the copy')
        res = db.resolve(tab)
        if res.runtime:
            raise Defer(f"{tab} lives in the depot's facts")
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the Scheduling house {tab}")
            raise Defer(f"the Scheduling house {tab} holds no tab in the copy")
        idf = "key" if tab == SETTINGS else "id"
        heads = [gsjs.trim(gsjs.or_blank(h)) for h in res.ref.headers]
        out = []
        for _rn, raw in db.rows(res.ref):
            row = {h: gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(src), "raw")))
                   for h, src in zip(heads, res.ref.headers) if h}
            if row.get(idf):
                out.append(row)
        return out
    return reads.once("schf:" + tab, read)


def _settings(reads: L.Reads) -> dict[str, Any]:
    """schedSettings_: the parts a flow's refusal reads."""
    def read() -> dict[str, Any]:
        kv: dict[str, Any] = {}
        for r in _rows(reads, SETTINGS):
            kv[r["key"]] = r.get("value")
        periods = []
        got = _json_any(kv.get("periods"))
        if isinstance(got, list):
            for p in got:
                if isinstance(p, dict) and _iso_valid(p.get("first")) and _iso_valid(p.get("last")) and \
                        p["first"] <= p["last"]:
                    periods.append({"id": _s(p.get("id")) or "P" + p["first"], "first": p["first"], "last": p["last"]})
            periods.sort(key=lambda p: p["first"])
        houses = []
        hs = _json_any(kv.get("houses"))
        if isinstance(hs, list):
            for h in hs:
                if h and _s(h.get("code") if isinstance(h, dict) else None):
                    houses.append({"code": _s(h.get("code")), "location": _s(h.get("location")),
                                   "short": _s(h.get("short")) or _s(h.get("code"))})
        return {"min_days_ahead": max(0, _int_of(kv.get("min_days_ahead"), 7)), "periods": periods or [FIRST_PERIOD],
                "houses": houses}
    return reads.once("schf:settings", read)


def _json_any(text: Any) -> Any:
    """schedJson_."""
    s = _s(text)
    if not s:
        return None
    try:
        return json.loads(s)
    except ValueError:
        return None


def _period_of(reads: L.Reads, iso: str) -> dict | None:
    return next((p for p in _settings(reads)["periods"] if p["first"] <= iso <= p["last"]), None)


def _house_list(reads: L.Reads) -> list[dict]:
    """schedHouseList_."""
    def read() -> list[dict]:
        listed = _settings(reads)["houses"]
        if listed:
            return listed
        seen: set[str] = set()
        out = []
        for r in _rows(reads, "sched_rows"):
            code = r.get("house_code") or ""
            if code and code not in seen:
                seen.add(code)
                out.append({"code": code, "location": r.get("location") or "", "short": code})
        return out
    return reads.once("schf:houses", read)


def _house_word(reads: L.Reads, code: Any) -> str:
    """schedFlowHouseWord_ (schedHouseLabel_)."""
    c = _s(code)
    hit = next((h for h in _house_list(reads) if h["code"] == c), None)
    return (hit["short"] or c) if hit else c


def _tokens(reads: L.Reads) -> dict[str, str]:
    """schedHouseTokens_."""
    def read() -> dict[str, str]:
        out: dict[str, str] = {}
        for h in _house_list(reads):
            for t in (h["code"], h["short"], h["location"]):
                up = _s(t).upper()
                if up:
                    out[up] = h["code"]
                tight = re.sub(_WS + "+", "", up)
                if tight:
                    out[tight] = h["code"]
        return out
    return reads.once("schf:tokens", read)


def _names_house(text: Any, tokens: dict[str, str]) -> str:
    """schedNamesHouse_."""
    for part in _CHAIN.split(re.sub(r"^\*+", "", gsjs.or_blank(text))):
        up = gsjs.trim(part).upper()
        if not up:
            continue
        hit = tokens.get(up) or tokens.get(re.sub(_WS + "+", "", up))
        if hit:
            return hit
    return ""


def _cell_id(house: str, row: str, iso: str) -> str:
    return "SC_" + hashlib.sha1(f"{house}|{row}|{iso}".encode("utf-8")).hexdigest()[:16]


def _cell_at(reads: L.Reads, house: str, row: str, iso: str) -> dict | None:
    """schedCellAt_: the first row with the cell's id."""
    def read() -> dict[str, dict]:
        out: dict[str, dict] = {}
        for c in _rows(reads, "sched_cells"):
            out.setdefault(c["id"], c)
        return out
    return reads.once("schf:cell_ids", read).get(_cell_id(house, row, iso))


def _flow_by_id(reads: L.Reads, fid: str) -> dict | None:
    """schedFlowFlowById_: the last row with the id."""
    hit = None
    for f in _rows(reads, "sched_flows"):
        if _s(f.get("id")) == fid:
            hit = f
    return hit


# ---- accounts, directors, house managers ---------------------------------------------------------------------------

def _live(u: dict | None) -> bool:
    """schedLive_."""
    return bool(u) and _s(u.get("active")).upper() not in ("FALSE", "0", "NO") and not _s(u.get("mergedinto"))


def _accounts(reads: L.Reads) -> dict[str, list[dict]]:
    """schedAccounts_: live accounts by display-name fold."""
    def read() -> dict[str, list[dict]]:
        out: dict[str, list[dict]] = {}
        for u in reads.users():
            k = _fold(u.get("displayname")) if _live(u) else ""
            if k:
                out.setdefault(k, []).append(u)
        return out
    return reads.once("schf:accounts", read)


def _user_by_key(reads: L.Reads, key: Any) -> dict | None:
    """schedUserByKey_."""
    hits = _accounts(reads).get(_s(key)) or []
    if len(hits) != 1:
        return None
    u = hits[0]
    return {"uid": _s(u.get("userid")), "email": _s(u.get("email")).lower(), "name": _s(u.get("displayname"))}


def _directors(reads: L.Reads) -> dict[str, Any]:
    """schedFlowDirectors_ over schedSettings_."""
    return SPF.sched_directors(reads)


def _house_managers(reads: L.Reads, code: str) -> list[dict]:
    """schedHouseManagers_."""
    out = []
    for r in _rows(reads, "sched_rows"):
        if r.get("house_code") == code and r.get("active") != "no" and r.get("row_kind") == "person" and \
                r.get("designation") == "**":
            u = _user_by_key(reads, r.get("person_key"))
            out.append({"name": r.get("name") or "", "key": r.get("person_key") or "", "uid": u["uid"] if u else "",
                        "email": u["email"] if u else ""})
    return out


# ---- the viewer (schedGate_ → schedCtxFor_) ------------------------------------------------------------------------

def _key_of(reads: L.Reads, user: dict, uid: str) -> str:
    """schedKeyOf_."""
    key = _fold(user.get("display_name"))
    if not key:
        return ""
    hits = _accounts(reads).get(key) or []
    if len(hits) > 1 or (len(hits) == 1 and _s(hits[0].get("userid")) != uid):
        return ""
    return key


def _ctx(sess: L.Session) -> dict | None:
    """schedFlowGate_: Scheduling's gate (scheduling.gate), then who the viewer is; None while closed."""
    try:
        import scheduling as SCH  # noqa: PLC0415 - the board module loads beside this one
    except ImportError:
        SCH = None
    if SCH is not None and callable(getattr(SCH, "gate", None)):
        g = SCH.gate(sess)
        if not g.get("open"):
            return None
        return {"uid": _s(g.get("uid")), "name": _s(g.get("name")), "key": _s(g.get("key")),
                "is_master": bool(g.get("is_master")), "is_director": bool(g.get("is_director")),
                "editor_of": g.get("editor_of"), "swaps": bool(g.get("swaps_edition"))}
    gate = sc.profile_app_gate(APP_ID, sess.user, sess.reads.scope_sources())
    if not gate.get("open"):
        return None
    user, reads = sess.user or {}, sess.reads
    uid = "" if user.get("is_service") else gsjs.str_(user.get("id"))
    dirs = _directors(reads)
    return {"uid": uid, "name": gsjs.str_(user.get("display_name")) or gsjs.str_(user.get("email")),
            "key": _key_of(reads, user, uid), "is_master": sc.is_real_master(user),
            "is_director": bool(uid) and any(d["uid"] == uid for d in dirs["list"]), "editor_of": None, "swaps": False}


def _editor_of(reads: L.Reads, g: dict, house: str) -> bool:
    if g["is_master"] or g["is_director"]:
        return True
    if callable(g.get("editor_of")):
        return bool(g["editor_of"](house))
    return bool(g["key"]) and any(m["key"] == g["key"] for m in _house_managers(reads, house))


def _sees_why(reads: L.Reads, g: dict | None, key: str, house: str) -> bool:
    """schedSeesWhy_."""
    if not g:
        return False
    if g["is_master"] or g["is_director"] or (key and g["key"] and g["key"] == key):
        return True
    return bool(house) and _editor_of(reads, g, house)


# ---- the overlap law (schedHoldIndex_ / schedClash_) ---------------------------------------------------------------

def _hold_of(cell: dict, tokens: dict[str, str]) -> dict | None:
    """schedHoldOf_."""
    text, state = _s(cell.get("text")), _s(cell.get("state"))
    if not text and state not in OFF_STATES:
        return None
    di = _day_index(cell.get("date"))
    if di is None or state == "swapped_out":
        return None
    day = di * 1440
    cls = _classify(text)
    if state in OFF_STATES or (cls and cls["kind"] == "ro"):
        private = state in ("called_off", "time_off") or bool(cls and cls["kind"] == "ro" and cls["code"] == "C/O")
        return {"s": day, "e": day + 1440, "whole": True, "why": "off", "private": private, "named": ""}
    if not cls or cls["kind"] == "off":
        return None
    if cls["start"] is not None:
        return {"s": day + gsjs.js_round(cls["start"] * 60), "e": day + gsjs.js_round(cls["end"] * 60),
                "why": "overlap"}
    inside = _time_inside(text)
    if inside:
        return {"s": day + gsjs.js_round(inside[0] * 60), "e": day + gsjs.js_round(inside[1] * 60), "why": "overlap"}
    return {"s": day, "e": day + 1440, "whole": True, "why": "unreadable", "named": _names_house(text, tokens)}


def _hold_index(reads: L.Reads) -> dict[str, list[dict]]:
    """schedHoldsNow_: every hold of every person."""
    def read() -> dict[str, list[dict]]:
        person_of = {}
        for r in _rows(reads, "sched_rows"):
            if r.get("row_kind") == "person" and r.get("person_key"):
                person_of[(r.get("house_code") or "") + "|" + (r.get("row_id") or "")] = r["person_key"]
        tokens = _tokens(reads)
        out: dict[str, list[dict]] = {}
        for c in _rows(reads, "sched_cells"):
            key = person_of.get((c.get("house_code") or "") + "|" + (c.get("row_id") or ""))
            h = _hold_of(c, tokens) if key else None
            if h:
                h.update({"house_code": c.get("house_code") or "", "date": c.get("date") or "",
                          "text": c.get("text") or c.get("base") or "", "cell_id": c.get("id") or ""})
                out.setdefault(key, []).append(h)
        for f in _rows(reads, "sched_flows"):
            if f.get("kind") != "time_off" or f.get("state") not in ("approved", "approved_future") or \
                    not f.get("person_key") or not _iso_valid(f.get("date")):
                continue
            to = f["date_to"] if _iso_valid(f.get("date_to")) else f["date"]
            n, last = _day_index(f["date"]), _day_index(to)
            while n is not None and last is not None and n <= last:
                d = date(1970, 1, 1) + timedelta(days=n)
                out.setdefault(f["person_key"], []).append(
                    {"s": n * 1440, "e": n * 1440 + 1440, "whole": True, "why": "time_off", "house_code": "",
                     "date": d.isoformat(), "text": "time off", "cell_id": "", "private": True, "named": ""})
                n += 1
        return out
    return reads.once("schf:holds", read)


def _clash(reads: L.Reads, key: Any, iso: str, start_min: float, end_min: float, house: str,
           ignore: tuple = ()) -> dict | None:
    """schedClash_: null when free, else the first thing held against [start, end)."""
    key = _s(key)
    if not key or not _iso_valid(iso):
        return None
    day = _day_index(iso) * 1440
    s, e = day + start_min, day + end_min
    for h in _hold_index(reads).get(key) or []:
        if h.get("cell_id") and h["cell_id"] in ignore:
            continue
        if h.get("whole") and h.get("named") and house and h["named"] == house:
            continue
        if h["s"] < e and s < h["e"]:
            return {"house_code": h["house_code"], "date": h["date"], "text": h["text"], "why": h["why"],
                    "private": bool(h.get("private"))}
    return None


def _clash_words(reads: L.Reads, name: str, clash: dict, g: dict | None, key: str) -> str:
    """schedFlowClashWords_ (schedClashSentence_)."""
    if clash["private"] and not _sees_why(reads, g, key, clash["house_code"]):
        return "Not possible: " + name + " is not free that day."
    if clash["why"] == "time_off":
        return "Not possible: " + name + " has approved time off that day."
    return ("Not possible: " + name + " is already at " + _house_word(reads, clash["house_code"]) + " " +
            _shift_words(clash["text"]) + " that day.")


# ---- the checks every flow shares ------------------------------------------------------------------------------------

def _no(status: int, message: str, *, fresh: bool = True, data: dict | None = None) -> Decision:
    """A refusal in the .gs words; one resting on the copy's rows is answered only while the copy is current."""
    env: dict[str, Any] = {"status": status, "message": message}
    if data is not None:
        env["data"] = data
    return Decision(env, fresh=fresh)


def _unknown() -> Decision:
    return Decision({"status": 404, "message": UNKNOWN})


def _fw() -> Any:
    import scheduling_flow_writes as FW  # noqa: PLC0415 - the writes build on this module
    return FW


def _hold_bar(reads: L.Reads, cell: dict | None) -> Decision | None:
    """schedFlowHoldBar_."""
    if cell and _s(cell.get("state")) == "called_off":
        return _no(409, "This shift is already called off.")
    if not cell or not _timed(cell):
        return _no(400, "There is no timed shift in that cell.")
    if not _holds(cell):
        return _no(409, "Nobody holds this shift right now (" + _s(cell.get("state")) + ").")
    if _ended(cell.get("date"), cell.get("end_min"), _now_ms(reads)):
        return _no(409, "This shift has already ended.")
    return None


def _exchange_of(flow: dict | None) -> dict | None:
    """schedFlowExchangeOf_."""
    if not flow or flow.get("kind") != "swap":
        return None
    ex = _json(flow.get("outreach_log"), {})
    ex = ex.get("exchange") if isinstance(ex, dict) else None
    if not isinstance(ex, dict) or not gsjs.str_(ex.get("house")) or \
            not _PERSON_ROW.match(gsjs.str_(ex.get("row_id"))) or not _ymd(ex.get("date")):
        return None
    return ex


def _cell_busy(reads: L.Reads, house: str, row: str, iso: str, except_id: str = "") -> dict | None:
    """schedFlowCellBusy_: a waiting Request Off, swap or training on the cell (a swap's partner shift counts)."""
    hit = None
    for f in _rows(reads, "sched_flows"):
        if except_id and _s(f.get("id")) == except_id:
            continue
        if f.get("kind") not in ("request_off", "swap", "training") or _s(f.get("state")) not in WAITING:
            continue
        ex = _exchange_of(f)
        here = _s(f.get("house_code")) == house and _s(f.get("row_id")) == row and _s(f.get("date")) == iso
        there = ex is not None and gsjs.str_(ex.get("house")) == house and gsjs.str_(ex.get("row_id")) == row and \
            gsjs.str_(ex.get("date")) == iso
        if here or there:
            hit = f
    return hit


def _busy_words(busy: dict) -> Decision:
    return _no(409, "This shift is waiting on a training approval." if busy.get("kind") == "training"
               else "This shift already has a request waiting.")


def _same_house_bar(reads: L.Reads, house: str, key: str, iso: str, name: str | None) -> Decision | None:
    """schedFlowSameHouseBar_: a row holds one cell a day."""
    had = _cell_at(reads, house, "P:" + key, iso)
    cls = _classify(had.get("text")) if had and _s(had.get("text")) else None
    if not cls or cls["kind"] == "off":
        return None
    return _no(409, ("You already have " if name is None else name + " already has ") + _s(had.get("text")) + " at " +
               _house_word(reads, house) + " that day — a row holds one shift a day.")


def _prefs_index(reads: L.Reads) -> dict[str, dict]:
    """spPrefsIndex_: what placements read of every staff key's preferences."""
    def read() -> dict[str, dict]:
        if not reads.db.house_moved(SP.PREFS_TAB):
            return {}
        res = reads.db.resolve(SP.PREFS_TAB)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the house behind {SP.PREFS_TAB}")
            raise Defer(f"the {SP.PREFS_TAB} house holds no tab in the copy: Apps Script makes it on its first read")
        out: dict[str, dict] = {}
        for r in reads.db.locations_rows(res.ref):
            k = gsjs.trim(gsjs.or_text(r.get("staff_key")))
            if not k:
                continue
            p = SP.prefs_of(r)
            if p["unavailable_locations"] or p["unavailable_days"]["a"] or p["unavailable_days"]["b"]:
                out[k] = {"houses": p["unavailable_locations"], "days": p["unavailable_days"]}
        return out
    return reads.once("schf:prefs", read)


def _prefs_against(reads: L.Reads, key: Any, name: str, house: str, iso: str) -> dict | None:
    """schedPrefsAgainst_: { why, fields } or None."""
    key = _s(key)
    p = _prefs_index(reads).get(key) if key else None
    if not p:
        return None
    says, fields = [], []
    if house and house in (p.get("houses") or []):
        says.append("cannot work at " + _house_word(reads, house))
        fields.append("unavailable_locations")
    period = _period_of(reads, iso) if iso and _iso_valid(iso) else None
    if period:
        week = "b" if ((_day_index(iso) - _day_index(period["first"])) // 7) % 2 else "a"
        dow = _dow(iso)
        if WEEKDAYS[dow].lower() in ((p.get("days") or {}).get(week) or []):
            says.append("are unavailable on " + PREF_DAY_WORDS[dow] + " in Week " + week.upper())
            fields.append("unavailable_days")
    if not says:
        return None
    return {"why": _s(name) + "'s Staff Preferences say they " + " and ".join(says) + ".", "fields": fields}


def _prefs_refusal(why: str) -> Decision:
    """schedPrefsRefusal_: the 409 the panel turns into a confirm."""
    return _no(409, why, data={"needs_override": True, "reason": why})


def _unapproved(reads: L.Reads, what: str) -> Decision | None:
    """schedFlowDirectors_ unreadable: nobody can approve `what` right now."""
    dirs = _directors(reads)
    if dirs["readable"]:
        return None
    return _no(503, "Nobody can approve " + what + " right now: " + gsjs.or_blank(dirs.get("why")) + ".")


def _approvers(reads: L.Reads, *, but: tuple = ()) -> list[dict]:
    """The directors who can be asked, past those named."""
    return [d for d in _directors(reads)["list"] if d["uid"] not in but]


def _shift_params(p: dict) -> dict[str, str]:
    """schedFlowShiftParams_."""
    return {"house": _text(p.get("house"), 40), "row": _text(p.get("row_id"), 120), "date": _text(p.get("date"), 10)}


# ---- the doors -------------------------------------------------------------------------------------------------------

def call_off(sess: L.Session, payload: dict) -> Decision:
    """schedulingCallOff: refused here, or the shift opened and the call-off's outreach started."""
    g = _ctx(sess)
    if g is None:
        return _unknown()
    reads, s = sess.reads, _shift_params(payload or {})
    if not s["house"] or not _ymd(s["date"]) or not s["row"].startswith("P:"):
        return _no(400, "Pick the person's shift to call off: its house, row and day.", fresh=False)
    own = bool(g["key"]) and s["row"] == "P:" + g["key"]
    if not own and not _editor_of(reads, g, s["house"]):
        return _no(403, "Only your own shift can be called off here.")
    return _hold_bar(reads, _cell_at(reads, s["house"], s["row"], s["date"])) or \
        _fw().call_off(sess, g, s, payload or {})


def request_off(sess: L.Session, payload: dict) -> Decision:
    """schedulingRequestOff: refused here, or filed and the directors asked in My Work."""
    g = _ctx(sess)
    if g is None:
        return _unknown()
    reads, s = sess.reads, _shift_params(payload or {})
    if not s["house"] or not _ymd(s["date"]):
        return _no(400, "Pick your shift: its house, row and day.", fresh=False)
    if not g["key"] or s["row"] != "P:" + g["key"]:
        return _no(403, "Request Off is for your own shift.")
    mn = _settings(reads)["min_days_ahead"]
    if s["date"] < _add_days(reads.today(), mn):
        return _no(409, f"Request Off needs at least {mn} days' notice — inside that, use Call Off or Swap.")
    bar = _hold_bar(reads, _cell_at(reads, s["house"], s["row"], s["date"]))
    if bar:
        return bar
    busy = _cell_busy(reads, s["house"], s["row"], s["date"])
    if busy:
        return _busy_words(busy)
    unread = _unapproved(reads, "this")
    if unread:
        return unread
    askable = _approvers(reads, but=(g["uid"],))
    if not askable:
        return _no(409, "There is no director who can approve this: " + (_directors(reads)["why"] or
                                                                          "you are the only one") + ".")
    return _fw().request_off(sess, g, s, payload or {}, askable)


def time_off(sess: L.Session, payload: dict) -> Decision:
    """schedulingTimeOff: refused, or filed and the directors asked in My Work (schedFlowTimeOffAsk_)."""
    g = _ctx(sess)
    if g is None:
        return _unknown()
    return _fw().time_off(sess, g, payload or {})


def swap_propose(sess: L.Session, payload: dict) -> Decision:
    """schedulingSwapPropose: refused here, or filed and the one asked told in My Work and by text."""
    g = _ctx(sess)
    if g is None:
        return _unknown()
    reads, p = sess.reads, payload or {}
    s = _shift_params(p)
    rep = _text(p.get("replacement"), 120)
    if not s["house"] or not _ymd(s["date"]):
        return _no(400, "Pick your shift: its house, row and day.", fresh=False)
    if gsjs.str_(p.get("partner_house")) or gsjs.str_(p.get("partner_row_id")) or gsjs.str_(p.get("partner_date")):
        return _exchange_propose(sess, g, s, p)
    own = bool(g["key"]) and s["row"] == "P:" + g["key"]
    seated = g["is_master"] or g["is_director"]
    behalf = not own and bool(_PERSON_ROW.match(s["row"])) and (seated or g.get("swaps"))
    if not own and not behalf:
        return _no(403, "A swap is for your own shift.")
    holder_key = g["key"] if own else s["row"][2:]
    if not rep or rep == holder_key:
        return _no(400, "Pick who takes the shift — somebody other than the person on it.")
    cell = _cell_at(reads, s["house"], s["row"], s["date"])
    bar = _hold_bar(reads, cell)
    if bar:
        return bar
    busy = _cell_busy(reads, s["house"], s["row"], s["date"])
    if busy:
        return _busy_words(busy)
    who = _user_by_key(reads, rep)
    if not who or not who["uid"]:
        return _no(400, NO_ACCOUNT)
    held = {"uid": g["uid"], "name": g["name"]} if own else (_user_by_key(reads, holder_key) or {})
    holder_uid = _s(held.get("uid"))
    if holder_uid and who["uid"] == holder_uid:
        return _no(400, "Pick somebody other than the person on the shift.")
    name = who["name"] or rep
    clash = _clash(reads, rep, s["date"], _num(cell.get("start_min")), _num(cell.get("end_min")), s["house"])
    if clash:
        return _no(409, _clash_words(reads, name, clash, g, rep))
    twice = _same_house_bar(reads, s["house"], rep, s["date"], name)
    if twice:
        return twice
    crossed = _prefs_against(reads, rep, name, s["house"], s["date"])
    if crossed and p.get("override") is not True:
        return _prefs_refusal(crossed["why"])
    unread = _unapproved(reads, "a swap")
    if unread:
        return unread
    if not _approvers(reads, but=(g["uid"], who["uid"], holder_uid)):
        return _no(409, "There is no director outside this swap who can approve it.")
    import scheduling as SCH  # noqa: PLC0415 - the board module loads beside this one
    # Settings › Editions › Swaps files it for somebody else's shift as the master and the directors do
    return _fw().swap(sess, g, s, cell, who, {"key": holder_key, "uid": holder_uid,
                                              "name": _s(held.get("name")) or holder_key}, p, crossed, own,
                      "" if own or seated else SCH.SWAPS_EDITION)


PLATFORM_URL = "https://asamylife.asalifecare.com"


def _new_id(prefix: str, seed: str, now_ms: float) -> str:
    """schedFlowNewId_: ten upper-case hex of the seed, the instant and a random part."""
    raw = f"{seed}|{int(now_ms)}|{uuid.uuid4().hex}"
    return prefix + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:10].upper()


def _hour_word(minutes: Any) -> str:
    """schedFlowHourWord_."""
    if _s(minutes) == "":
        return ""
    n = _num(minutes)
    if math.isnan(n):
        return ""
    h, m = int(n // 60) % 24, int(gsjs.js_round(n % 60))
    return f"{(h % 12) or 12}{(':' + str(m).zfill(2)) if m else ''}{'am' if h < 12 else 'pm'}"


def _day_word(iso: str, today: str) -> str:
    """schedFlowDayWord_."""
    p = _ymd(iso)
    d = _utc_day(*p) if p else None
    if d is None:
        return ""
    if iso == today:
        return "today"
    if iso == _add_days(today, 1):
        return "tomorrow"
    return ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")[d.weekday()]


def _side(reads: L.Reads, house: str, row: str, iso: str, name: str, uid: str) -> dict[str, Any]:
    """schedFlowSide_."""
    cell = _cell_at(reads, house, row, iso)
    return {"house": house, "row": row, "date": iso, "key": row[2:], "name": name, "uid": uid, "cell": cell,
            "text": _s(cell.get("text")) if cell else "", "start": _num(cell.get("start_min") if cell else None),
            "end": _num(cell.get("end_min") if cell else None)}


def _side_words(reads: L.Reads, side: dict) -> str:
    return (_house_word(reads, side["house"]) + " " + _day_words(side["date"]) + " " +
            (_shift_words(side["text"]) or side["text"]))


def _exchange_bar(reads: L.Reads, x: dict, y: dict, g: dict | None, self_id: str) -> Decision | None:
    """schedFlowExchangeBar_: why two shifts cannot change hands."""
    if not all(_PERSON_ROW.match(sd["row"]) for sd in (x, y)):
        return _no(400, NOT_PEOPLE_ROWS)
    if x["key"] == y["key"]:
        return _no(400, "Both shifts are " + x["name"] + "'s — pick somebody else's shift.")
    now = _now_ms(reads)
    for sd in (x, y):
        if not sd["cell"] or not _timed(sd["cell"]):
            return _no(400, sd["name"] + " has no timed shift at " + _house_word(reads, sd["house"]) + " on " +
                       _day_words(sd["date"]) + ".")
        at = sd["name"] + "'s " + _side_words(reads, sd)
        st = _s(sd["cell"].get("state")) or "scheduled"
        if st not in SWAPPABLE:
            return _no(409, at + " is " + (STATE_WORDS.get(st) or st) + ", so it cannot be swapped.")
        if not (_at_min(sd["date"], sd["start"]) > now):
            return _no(409, at + " has already started.")
        busy = _cell_busy(reads, sd["house"], sd["row"], sd["date"], self_id)
        if busy:
            return _no(409, at + (" is waiting on a training approval." if busy.get("kind") == "training"
                                  else " already has a request waiting on it."))
    for me, take in ((x, y), (y, x)):
        own_id = _s(me["cell"].get("id"))
        clash = _clash(reads, me["key"], take["date"], take["start"], take["end"], take["house"], (own_id,))
        if clash:
            return _no(409, _clash_words(reads, me["name"], clash, g, me["key"]))
        had = _cell_at(reads, take["house"], me["row"], take["date"])
        cls = _classify(had.get("text")) if had and _s(had.get("id")) != own_id and _s(had.get("text")) else None
        if cls and cls["kind"] != "off":
            return _no(409, me["name"] + " already has " + _s(had.get("text")) + " at " +
                       _house_word(reads, take["house"]) + " that day — a row holds one shift a day.")
    return None


def _exchange_propose(sess: L.Session, g: dict, s: dict, p: dict) -> Decision:
    """schedFlowExchangePropose_: refused here, or filed and the partner asked in My Work and by text."""
    reads = sess.reads
    y0 = {"house": _text(p.get("partner_house"), 40), "row": _text(p.get("partner_row_id"), 120),
          "date": _text(p.get("partner_date"), 10)}
    if not y0["house"] or not y0["row"] or not _ymd(y0["date"]):
        return _no(400, "Pick their shift: its house, row and day.", fresh=False)
    if not _PERSON_ROW.match(s["row"]) or not _PERSON_ROW.match(y0["row"]):
        return _no(400, NOT_PEOPLE_ROWS, fresh=False)
    own = bool(g["key"]) and s["row"] == "P:" + g["key"]
    if not own and not (g["is_master"] or g["is_director"]):
        return _no(403, "A swap is for your own shift.")
    a_key, b_key = s["row"][2:], y0["row"][2:]
    if a_key == b_key:
        return _no(400, SAME_PERSON, fresh=False)
    held = {"uid": g["uid"], "name": g["name"]} if own else (_user_by_key(reads, a_key) or {})
    who = _user_by_key(reads, b_key)
    if not who or not who["uid"]:
        return _no(400, NO_ACCOUNT)
    x = _side(reads, s["house"], s["row"], s["date"], _s(held.get("name")) or a_key, _s(held.get("uid")))
    y = _side(reads, y0["house"], y0["row"], y0["date"], who["name"] or b_key, who["uid"])
    if x["uid"] and x["uid"] == y["uid"]:
        return _no(400, SAME_PERSON)
    bar = _exchange_bar(reads, x, y, g, "")
    if bar:
        return bar
    crossed = []
    for me, take_ in ((x, y), (y, x)):
        c = _prefs_against(reads, me["key"], me["name"], take_["house"], take_["date"])
        if c:
            crossed.append({"key": me["key"], "house": take_["house"], "date": take_["date"], "against": c})
    if crossed and p.get("override") is not True:
        return _prefs_refusal(" ".join(c["against"]["why"] for c in crossed))
    unread = _unapproved(reads, "a swap")
    if unread:
        return unread
    if not _approvers(reads, but=(g["uid"], x["uid"], y["uid"])):
        return _no(409, "There is no director outside this swap who can approve it.")
    return _fw().exchange(sess, g, s, x, y, who, p, crossed, own)


def take(sess: L.Session, payload: dict) -> Decision:
    """schedulingTake: refused here, or the person placed and the call-off's outreach stopped (a training when they
    are new to the house without its IST)."""
    g = _ctx(sess)
    if g is None:
        return _unknown()
    reads, p = sess.reads, payload or {}
    s = _shift_params(p)
    if not s["house"] or not _ymd(s["date"]) or not s["row"].startswith("OPEN:"):
        return _no(400, "Pick an open shift.", fresh=False)
    if not g["key"]:
        return _no(403, "Your account is not matched to one person on the calendar, so you cannot take a shift here.")
    cell = _cell_at(reads, s["house"], s["row"], s["date"])
    if not cell or _s(cell.get("state")) != "open" or not _s(cell.get("text")):
        return _no(409, "Somebody else took this shift a moment ago.")
    if not _timed(cell):
        return _no(409, "This open cell has no readable hours, so it cannot be taken here.")
    if _ended(s["date"], cell.get("end_min"), _now_ms(reads)):
        return _no(409, "This shift has already ended.")
    clash = _clash(reads, g["key"], s["date"], _num(cell.get("start_min")), _num(cell.get("end_min")), s["house"])
    if clash:
        return _no(409, _clash_words(reads, g["name"], clash, g, g["key"]))
    twice = _same_house_bar(reads, s["house"], g["key"], s["date"], None)
    if twice:
        return twice
    crossed = _prefs_against(reads, g["key"], g["name"], s["house"], s["date"])
    if crossed and p.get("override") is not True:
        return _prefs_refusal(crossed["why"])
    return _fw().take(sess, g, s, p, crossed)


def withdraw(sess: L.Session, payload: dict) -> Decision:
    """schedulingWithdraw: refused here, or the request closed and its My Work items with it."""
    g = _ctx(sess)
    if g is None:
        return _unknown()
    fid = _text((payload or {}).get("flow_id"), 20)
    if not _FLOW_ID.fullmatch(fid):
        return _no(400, "Which request? The flow id is missing.", fresh=False)
    f = _flow_by_id(sess.reads, fid)
    if not f:
        return _no(404, "That request is not on the calendar.")
    if f.get("kind") == "training":
        return _no(409, "A training is not withdrawn: Call Off gives the shift up, and an editor can take it off the "
                        "calendar.")
    mine = g["uid"]
    if not mine or (_s(f.get("created_by")) != mine and _s(f.get("person_uid")) != mine):
        return _no(403, "Only the person who asked can withdraw it.")
    if _s(f.get("state")) not in WAITING:
        return _no(409, "This request is no longer waiting (" + _s(f.get("state")) + ").")
    return _fw().withdraw(sess, g, fid)


def answer(sess: L.Session, payload: dict) -> Decision:
    """schedulingAnswer, gated by the seat: refused or already answered here, else decided (scheduling_flow_writes)."""
    user, reads, p = sess.user, sess.reads, payload or {}
    if not user or user.get("is_service"):
        return _unknown()
    if user.get("visiting_member"):
        return _no(403, "Answer from your own account — not while visiting someone else.", fresh=False)
    me = gsjs.str_(user.get("id"))
    if not me:
        return _unknown()
    item_id, word = _text(p.get("item_id"), 20), _text(p.get("word"), 10).lower()
    if not _ITEM_ID.fullmatch(item_id):
        return _no(400, "Which item? The item id is missing.", fresh=False)
    if word not in ("approve", "decline", "seen"):
        return _no(400, "Answer with approve or decline.", fresh=False)
    item = None
    for r in _rows(reads, "sched_inbox"):
        if _s(r.get("id")) == item_id:
            item = r
    if not item:
        return _no(404, "This item is not on the calendar any more.")
    to = _s(item.get("to_uid"))
    director_seat = item.get("box") == "work" and item.get("seat") == "director"
    stand_in = to != me and director_seat and (sc.is_real_master(user) or _time_off_answerer(sess, item, me))
    if to != me and not stand_in:
        return _no(403, "This item is waiting on someone else.")
    if item.get("box") == "inbox":
        if word != "seen":
            return _no(400, "An alert is only marked as seen.")
        if _s(item.get("answered_at")):
            return _said("Already marked as seen.", item)
        return _fw().answer(sess, item_id, word, p.get("note"), stand_in)
    if word == "seen":
        return _no(400, "Approve or decline this one.")
    if item.get("state") != "waiting":
        return _said("Already answered by " + (_s(item.get("answered_by")) or "someone") + ".", item)
    flow = _flow_by_id(reads, _s(item.get("flow_id")))
    if not flow:
        return _no(404, "The request behind this item is gone.")
    if _s(flow.get("person_uid")) == me:
        return _no(403, "Nobody answers their own request.")
    if item.get("seat") != "staff" and _s(flow.get("replacement_uid")) == me:
        return _no(403, "The person taking the shift cannot approve the swap too.")
    if _exchange_of(flow) is not None and item.get("seat") != "staff" and _s(flow.get("created_by")) == me:
        return _no(403, "Whoever asked for the swap cannot approve it too.")
    if stand_in:
        seats = _json(flow.get("seats"), [])
        if not isinstance(seats, list):
            raise Defer("the request's seats are not a list")
        if any(isinstance(x, dict) and gsjs.str_(x.get("by_uid")) == me for x in seats):
            return _no(403, "You already answered another seat of this request.")
    return _fw().answer(sess, item_id, word, p.get("note"), stand_in)


def _time_off_answerer(sess: L.Session, item: dict, me: str) -> bool:
    """Who answers a time off's director seat beside its addressee and the master: a director the Scheduling settings
    list, or a holder of Settings › Editions › Time off approvals."""
    flow = _flow_by_id(sess.reads, _s(item.get("flow_id")))
    if not flow or flow.get("kind") != "time_off" or not me:
        return False
    if any(_s(d.get("uid")) == me for d in _directors(sess.reads)["list"]):
        return True
    import scheduling as SCH  # noqa: PLC0415 - the board module loads beside this one
    return SCH.TIME_OFF_EDITION in SCH.editions_held(sess.reads, sess.user)


def _said(words: str, item: dict) -> Decision:
    """An answer that changes nothing, in the envelope schedulingAnswer gives it."""
    data = {"ok": True, "changed": False, "said": words, "state": item.get("state") or ""}
    return Decision({"status": 200, "data": data}, fresh=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "schedulingCallOff": call_off, "schedulingRequestOff": request_off, "schedulingTimeOff": time_off,
    "schedulingSwapPropose": swap_propose, "schedulingTake": take, "schedulingWithdraw": withdraw,
    "schedulingAnswer": answer}
# HUB_POLICY: the roles each door is declared for, and its typed params
_ROLES = ("admin", "director", "manager", "staff")
_SHIFT = {"house": "string", "row_id": "string", "date": "string"}
POLICY: dict[str, dict[str, Any]] = {a: {"roles": _ROLES, "params": prm} for a, prm in {
    "schedulingCallOff": {**_SHIFT, "reason": "string"},
    "schedulingRequestOff": {**_SHIFT, "note": "string"},
    "schedulingTimeOff": {"from": "string", "to": "string", "reason": "string"},
    "schedulingSwapPropose": {**_SHIFT, "replacement": "string", "partner_house": "string", "partner_row_id": "string",
                              "partner_date": "string", "note": "string", "override": "boolean"},
    "schedulingTake": {**_SHIFT, "override": "boolean"},
    "schedulingWithdraw": {"flow_id": "string"},
    "schedulingAnswer": {"item_id": "string", "word": "string", "note": "string"},
}.items()}
# every door keeps its write in app.edits: the texts are owed to the flow clock, the items are Scheduling's own
KEPT: frozenset[str] = frozenset(ACTIONS)
# schedLock_'s own sentence for its own lock
BUSY = "Somebody else is changing the calendar right now — try again."
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}
