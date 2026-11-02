"""Support Requests' writes (apps-script/SupportDesk.gs) decided off asa-hub-db and kept in app.edits: a verdict on a
request (approve, deny, resolve, redirect, aware), an ADP · Update Information change approved or undone, a My Inbox
item marked aware or seen, the settings saved — every text through Smart Comms, under sdTell_'s own key."""
from __future__ import annotations

import hashlib
import json
import logging
import re
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import my_work as MW
import scope as sc
import smart_comms as SC
import writes as W
from gsjs import NY
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

APP_ID = "support-desk"
TABS = {"events": "support_events", "decisions": "support_decisions", "inbox": "support_inbox",
        "settings": "support_settings"}
# SupportDesk.gs SD_HEADERS
HEADERS = {
    "support_events": ("id", "kind", "ref", "route", "source", "source_ref", "title", "category", "person",
                       "person_key", "person_uid", "house", "day", "at", "details", "status", "test_mode",
                       "created_at", "created_by"),
    "support_decisions": ("id", "ref", "source", "verdict", "note", "by_uid", "by_name", "at", "via", "witness",
                          "test_mode"),
    "support_inbox": ("id", "ref", "box", "kind", "seat", "to_uid", "to_email", "to_name", "title", "body",
                      "house_label", "date", "state", "answered_by", "answered_at", "note", "link", "test_mode",
                      "created_at", "alert"),
    "support_settings": ("key", "value", "note", "updated_at", "updated_by"),
}
# Settings › Editions (Editions.gs): who else may decide, beside the directors and the master
EDITION = {"requests": "support.requests", "settings": "support.settings"}


def _CM() -> Any:
    import staff_comms as CM  # noqa: PLC0415 - the comms houses' readers load beside this one
    return CM

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
WEEKDAYS = ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
# SD_SETTING_DEFAULTS / SD_ROUTES_DEFAULT: the lists the settings house ships over
SETTING_DEFAULTS = {"directors": "ty.bond@abrighterdawninc.com, brittfrench1316@gmail.com",
                    "leads": "arthur.torres@asalifecare.com, admin@abrighterdawninc.com",
                    "payroll_to": "ty.bond@abrighterdawninc.com"}
ROUTES_DEFAULT = {"vehicle": ["Operations - Vehicle Issue", "Operations - Transportation",
                              "Operations - Transportation Request", "Van Calendar"],
                  "payroll": ["ADP - Pay Stubs", "Payroll", "PSI - Time Entries", "Finances - Request for Pay Stubs",
                              "Pay Stubs"],
                  "general": ["Other - General Requests"],
                  "adp_update": ["ADP - Update Information"]}
SETTABLE = ("leads", "payroll_to", "routes", "directors")
FINAL = {"approved": "Approved", "denied": "Denied", "resolved": "Resolved"}
VERDICT_OF = {"approve": "approved", "deny": "denied", "resolve": "resolved", "aware": "aware",
              "redirect": "redirected"}
STAFF_ROLES = ("admin", "director", "manager", "staff")
WORK_BOX = "work"
REDIRECT = "redirect"
SEAT_REF = re.compile(r"^(HQ|SE)[0-9A-F]{10}(-\d+)?$")
ADP_REF = re.compile(r"^HQ[0-9A-F]{10}(-\d+)?$")
ITEM_ID = re.compile(r"^SN[0-9A-F]{10}$")
WARNING_KINDS = frozenset({"late_show", "no_call", "punch"})
SCHED_KINDS = frozenset({"call_off", "phone", "request_off", "time_off", "swap", "take"})
SCHED_WAITING = frozenset({"waiting", "waiting_staff", "waiting_manager", "waiting_director"})
SCHED_CLOSED = frozenset({"approved", "approved_future", "declined", "expired", "withdrawn", "cancelled", "done",
                          "covered", "stopped"})
FLOW_ID = re.compile(r"^SF[0-9A-F]{10}$")
# the situations every text of these doors speaks (SD_SITUATIONS), and Smart Comms' lane for them
SR_VEHICLE, SR_PAYROLL = "sr_vehicle_request", "sr_payroll_request"
SR_PUNCH, SR_ADP = "sr_punch_aware", "sr_adp_applied"
SITUATIONS = (SR_VEHICLE, SR_PAYROLL, SR_PUNCH, SR_ADP)
LANE = "support requests"
# MailTemplates.gs mailPlatformUrl_
PLATFORM_URL = "https://asamylife.asalifecare.com"
OWED_HOURS = 36
BUSY = "Somebody else is answering this request right now — try again."
UNKNOWN = "Unknown action."
OWN_ACCOUNT = "Answer from your own account — not while visiting someone else."
READ_FAIL = "Support Requests could not be read just now ({}) — nothing was changed."
WRITE_FAIL = "Support Requests could not be written just now ({}) — nothing was changed."
# ContactGuard.gs: the callers' words that are no name, and the guard's floors (a config only adds to them)
NO_NAME_WORDS = frozenset({"undetermined", "unknown", "unclear", "anonymous", "caller", "notspecified",
                           "notspecifiedintranscript", "nonamegiven", "namenotgiven", "nonameprovided", "notgiven",
                           "na", "none", "nobody"})
TEST_PHONE_FLOOR = ("3309195558",)
TEST_EMAIL_FLOOR = ("asatech*@asalifecare.com", "asatechjk@gmail.com", "silvajhonatanbrito@gmail.com")
SHARED_EMAIL_FLOOR = ("info@asalifecare.com", "hr@asalifecare.com", "admin@asalifecare.com", "support@asalifecare.com")
OPERATOR_TEST_EMAIL = "asatech@asalifecare.com"  # Comms.gs COMMS_OPERATOR_TEST_EMAIL
SHARED_LINE_DIGITS = SC.SHARED_LINE_DIGITS
ADP_ONLY = re.compile(r"pay\s*rate|\bw-?4\b|\bbank\b|direct\s*deposit|routing\s*number|account\s*number|\btax|\bssn\b"
                      r"|social\s*security|date\s*of\s*birth|\bdob\b|birth\s*day|legal\s*name|sign[\s-]*in\s*e-?mail"
                      r"|login\s*e-?mail|salary|\bwage", re.I)
READBACK = re.compile(r"(new|updated)\s+(home\s+|mailing\s+)?(address|e-?mail(\s+address)?|phone(\s+number)?)\s+"
                      r"(as|is|to)\s+(.+?)[.?]\s*(is that (correct|right)|did i get that right)", re.I)
YES_RE = re.compile(r"^\s*(yes|yeah|correct|that'?s right)\b", re.I)
SPELLED = re.compile(r"(?:\b[a-z0-9]\b[\s-]+){3,}", re.I)
TURN = re.compile(r"^\s*\[(\d+:\d{2})\]\s*([^:]+?):\s*(.*)$")
CALL_ID = re.compile(r"Call ID:\s*(AC[0-9a-f]+)", re.I)
_INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}")
_DAY_ONLY = re.compile(r"^\s*(\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2})\s*$")
# JavaScript's \s, so sdText_ cuts and folds what the sheet shows (scheduling_flows' own set)
_WS = "[" + "".join(map(chr, (0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F,
                                0x3000, 0xFEFF))) + chr(0x2000) + "-" + chr(0x200A) + "]"
_WS_RUN = re.compile(_WS + "+")


class JudgeFailed(Exception):
    """The ADP proof could not be read to the leaf here: the door's 503, never an approval (sdAdpJudge_'s throw)."""


# ---- the read modules' parts a decision rests on (lazy: the flows import their own world) --------------------------

def _SP() -> Any:
    import staff as SP  # noqa: PLC0415 - the Staff core loads beside this one
    return SP


def _SCH() -> Any:
    import scheduling as SCH  # noqa: PLC0415 - Scheduling's reads load beside this one
    return SCH


def _SF() -> Any:
    import scheduling_flows as SF  # noqa: PLC0415 - the flows carry the Python schedulingAnswer
    return SF


# ---- small values (SupportDesk.gs) ---------------------------------------------------------------------------------

def s_(v: Any) -> str:
    """sdStr_."""
    return gsjs.trim(gsjs.or_blank(v))


def text_(v: Any, max_len: int = 0) -> str:
    """sdText_: whitespace runs as one space, trimmed, cut to max UTF-16 units."""
    t = gsjs.trim(_WS_RUN.sub(" ", gsjs.or_blank(v)))
    return SC._cut16(t, max_len) if max_len else t


def json_(raw: Any, fallback: Any) -> Any:
    """sdJson_."""
    if isinstance(raw, (dict, list)):
        return raw
    try:
        v = json.loads(gsjs.or_text(raw))
    except (ValueError, RecursionError):
        return fallback
    return v if isinstance(v, (dict, list)) else fallback


def obj_(raw: Any) -> dict:
    """sdJson_(raw, {}) as the .gs reads it: an array's named keys are undefined there, so a dict here."""
    got = json_(raw, {})
    return got if isinstance(got, dict) else {}


def sha10(text: str) -> str:
    """sdSha10_."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:10].upper()


def json_text(v: Any) -> str:
    """JSON.stringify of the witness and the routes a cell keeps."""
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False)


def now_ms(reads: L.Reads) -> float:
    return reads.now.timestamp() * 1000.0


def iso_now(reads: L.Reads) -> str:
    """sdIso_(sdNowMs_)."""
    return gsjs.iso(reads.now)


def _local(ms: float) -> datetime:
    return datetime.fromtimestamp(ms / 1000.0, timezone.utc).astimezone(NY)


def instant_ms(v: Any) -> float | None:
    """sdInstantMs_ for a cell's text (no zone reads as UTC)."""
    s = s_(v)
    if not _INSTANT.match(s):
        return None
    t = s[:10] + "T" + s[11:] if s[10:11] == " " else s
    if not re.search(r"(Z|[+-]\d{2}:?\d{2})$", t, re.I):
        t += "Z"
    return gsjs.date_parse(t)


def day_of_ms(ms: float) -> str:
    """sdDayOfMs_."""
    return _local(ms).strftime("%Y-%m-%d")


def _valid_ymd(y: int, m: int, d: int) -> bool:
    """sdValidYmd_."""
    try:
        datetime(y, m, d)
        return True
    except ValueError:
        return False


def day_of_(v: Any) -> str:
    """sdDayOf_: an instant's Ohio day, an ISO day, a sheet's M/D/YYYY; '' when none."""
    ms = instant_ms(v)
    if ms is not None:
        return day_of_ms(ms)
    s = s_(v)
    m = re.match(r"^\s*(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if _valid_ymd(int(m.group(1)), int(m.group(2)),
                                                                      int(m.group(3))) else ""
    m = re.match(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\b", s)
    if m:
        return (f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
                if _valid_ymd(int(m.group(3)), int(m.group(1)), int(m.group(2))) else "")
    return ""


def when_of(v: Any) -> str:
    """sdWhenOf_: an instant as UTC ISO to the second, a day as YYYY-MM-DD, '' when unreadable."""
    ms = instant_ms(v)
    if ms is not None:
        return datetime.fromtimestamp(ms / 1000.0, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S") + "Z"
    return day_of_(v)


def day_words(iso: Any) -> str:
    """sdDayWords_: 'Thu 10/1' for an ISO day; the text as it came when it is not one."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s_(iso))
    if not m or not _valid_ymd(int(m.group(1)), int(m.group(2)), int(m.group(3))):
        return s_(iso)
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    wd = datetime(y, mo, d, tzinfo=timezone.utc).weekday()  # Monday 0 → Sun..Sat
    return f"{WEEKDAYS[(wd + 1) % 7]} {mo}/{d}"


def stamp_words(v: Any) -> str:
    """sdStampWords_: 'Sep 18, 2026 2:24 PM' in Ohio for an instant, 'Sep 18, 2026' for a day."""
    ms = instant_ms(v)
    day = day_of_ms(ms) if ms is not None else day_of_(v)
    if not day:
        return text_(v, 60)
    y, mo, d = day.split("-")
    words = MONTHS[int(mo) - 1] + " " + str(int(d)) + ", " + y
    if ms is not None:
        t = _local(ms)
        words += f" {t.hour % 12 or 12}:{t.minute:02d} " + ("AM" if t.hour < 12 else "PM")
    return words


def clock_words(v: Any) -> str:
    """sdClockWords_."""
    ms = instant_ms(v)
    return "" if ms is None else _local(ms).strftime("%H:%M")


def first_(name: Any) -> str:
    """sdFirst_."""
    return re.split(r"\s+", s_(name))[0] or s_(name)


def mask_phones(v: Any) -> str:
    """sdMaskPhones_."""
    return re.sub(r"\+?\d[\d\s().-]{6,}\d", "[number]", str(v or ""))


def urgency_(v: Any) -> str:
    """sdUrgency_."""
    s = s_(v)
    if re.fullmatch(r"(mid|medium)", s, re.I):
        return "Medium"
    return s[:1].upper() + s[1:] if s else ""


def type_parts(raw: Any) -> dict[str, str]:
    """sdTypeParts_."""
    s = s_(raw)
    if not s:
        return {"raw": "", "area": "", "label": "Other", "display": "Other"}
    cut = s.find(" - ")
    if cut == -1:
        return {"raw": s, "area": "", "label": s, "display": s}
    area, label = s[:cut].strip(), s[cut + 3:].strip()
    return {"raw": s, "area": area, "label": label, "display": area + " · " + label}


def type_of_category(cat: Any) -> dict[str, str]:
    """sdTypeOfCategory_."""
    s = s_(cat)
    cut = s.find(" · ")
    if cut == -1:
        return type_parts(s)
    return {"raw": s, "area": s[:cut].strip(), "label": s[cut + 3:].strip(), "display": s}


def call_id_of(notes: Any) -> str:
    """sdCallIdOf_."""
    m = CALL_ID.search(str(notes or ""))
    return m.group(1) if m else ""


def digits10(v: Any) -> str:
    """sdDigits10_."""
    return re.sub(r"^1(?=\d{10}$)", "", re.sub(r"\D", "", str(v or "")))


def name_key(v: Any) -> str:
    """hubNameFold_ (gsjs.name_key)."""
    return gsjs.name_key(v)


def live(u: dict | None) -> bool:
    """sdLive_."""
    off = s_((u or {}).get("active")).upper()
    return bool(u) and off not in ("FALSE", "0", "NO") and not s_(u.get("mergedinto"))


def acting_id(user: dict | None) -> str:
    """hubActingUserId_."""
    return gsjs.str_(user.get("id")) if user and not user.get("is_service") else ""


def actor_name(user: dict | None) -> str:
    """sdActorName_."""
    u = user or {}
    shown = u.get("display_name") if u.get("display_name") is not None else u.get("displayname")
    return s_(shown) or s_(u.get("email"))


def visiting(user: dict | None) -> bool:
    """sdVisiting_ (HUB_MEMBER_CTX never reaches this service: the relay names no member context)."""
    return bool((user or {}).get("visiting_member"))


def closed() -> dict[str, Any]:
    return {"status": 404, "message": UNKNOWN}


def test_word(reads: L.Reads) -> str:
    """sdTestWord_ over hubTestModeState_, Scheduling's port of the switch."""
    return "no" if _SCH().test_mode(reads).get("on") is False else "yes"


def link(path: str) -> str:
    """sdLink_."""
    return PLATFORM_URL + "/#" + path


def quote(v: str) -> str:
    """encodeURIComponent."""
    return urllib.parse.quote(v, safe="!*'()")


def write_tx() -> Any:
    """The transaction main.py names around this decision (smart_comms.deciding)."""
    held = SC._WRITE.get() or {}
    tx = held.get("tx")
    if tx is None:
        raise Defer("Smart Comms is not deciding this write, so its texts would be kept nowhere: nothing is written")
    return tx


# ---- is it a call off? (Hotline.gs, the type's one spelling and its letter-grams) ----------------------------------

def _lev(a: str, b: str) -> int:
    """nameLev_."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (0 if ca == cb else 1)))
        prev = cur
    return prev[len(b)]


def type_norm(raw: Any) -> str:
    """hotlineRequestTypeNorm_."""
    s = re.sub(r"[ \t   ]+", " ", str(raw or "")).strip()
    s = re.sub(r" *[‐–—―−] *", " - ", s)
    s = re.sub(r" +- *| *- +", " - ", s)
    s = re.sub(r"[ .;,]+$", "", s)
    if not s:
        return ""
    m = re.match(r"^([A-Za-z]+) *[-:] *(\S.*)$", s)
    if m:
        for a in ("Admin", "ADP", "Finances", "Operations", "PSI", "Safety", "Schedule", "Training", "Other"):
            if a.lower() == m.group(1).lower():
                return a + " - " + m.group(2)
    return s


def _type_word(w: str) -> str:
    """hotlineRequestTypeWord_."""
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not re.search(r"(?:ss|us|is)$", w):
        return w[:-1]
    return w


def _type_half(s: str) -> str:
    """hotlineRequestTypeHalf_."""
    return "".join(_type_word(w) for w in re.split(r"[^a-z0-9]+", s) if w)


def type_key(raw: Any) -> str:
    """hotlineRequestTypeKey_."""
    t = type_norm(raw).lower()
    cut = t.find(" - ")
    if cut == -1:
        return _type_half(t)
    return _type_half(t[:cut]) + " - " + _type_half(t[cut + 3:])


_CALL_OFF_WORDS = ("calloff", "calledoff", "callingoff", "callsoff", "callout", "calledout", "callingout", "callsout")


def _call_off_words(raw: Any) -> bool:
    """hotlineRequestTypeCallOffWords_."""
    words = [w for w in re.split(r"[^a-z]+", str(raw or "").lower().replace("0", "o")) if w]
    grams = []
    for i, w in enumerate(words):
        grams.append(w)
        if i + 1 < len(words):
            grams.append(w + words[i + 1])
    for g in grams:
        s = re.sub(r"s$", "", g)
        if s in _CALL_OFF_WORDS:
            return True
        if not s.startswith("c") or not 6 <= len(s) <= 8:
            continue
        if _lev(s, "calloff") <= 1 or _lev(s, "callout") <= 1:
            return True
    return False


def is_call_off(raw: Any) -> bool:
    """sdIsCallOff_."""
    if not s_(raw):
        return False
    if type_key(raw) == type_key("Schedule - Call Off"):
        return True
    t = type_norm(raw)
    if re.search(r"\bcall(?:ed|ing|s)?[\s-]*(?:off|out)s?\b|\bcall(?:off|out)s?\b", t, re.I):
        return True
    return _call_off_words(t)


# ---- the houses (ASA Data, one Data tab each): the copy's rows, Python's own edits laid ----------------------------

def _cell(v: Any) -> str:
    """sdCellText_ off the copy's text."""
    return gsjs.trim(gsjs.or_blank(hubdb.typed(v, "raw")))


def tab_rows(reads: L.Reads, tab: str) -> list[dict]:
    """sdRead_: each row with its id (its key for the settings), every header a key; a house whose tab the copy does
    not hold yet reads empty (hubTabEnsure_ would make it). A house kept in its own table (house_tables) is read there,
    and its writes land there (writes.into_tables)."""
    def read() -> list[dict]:
        db = reads.db
        if HT.tabled(tab):
            cols, rows = HT.raw(reads, tab)
            pairs = [(h, h) for h in cols]
        else:
            if not db.house_moved(tab):
                raise Defer(f'the Support Requests house "{tab}" is not set up (no pointer, or moved.{tab} is not on)')
            res = db.resolve(tab)
            if res.runtime:
                raise Defer(f"{tab} lives in the depot's facts")
            if res.ref is None:
                if not res.book_known:
                    raise hubdb.Unreadable(f"asa-hub-db holds no copy of the Support Requests house {tab}")
                return []
            pairs = list(zip((gsjs.trim(gsjs.or_blank(h)) for h in res.ref.headers), res.ref.headers))
            rows = db.rows(res.ref)
        idf = "key" if tab == TABS["settings"] else "id"
        out: list[dict] = []
        for _rn, raw in rows:
            row = {h: "" for h in HEADERS.get(tab, ())}
            for h, src in pairs:
                if h:
                    row[h] = _cell(raw.get(src))
            if row.get(idf):
                out.append(row)
        return out
    return [dict(r) for r in reads.once("sdw:tab:" + tab, read)]


def where(reads: L.Reads, tab: str) -> tuple[str, str]:
    """Where a write lands: the tab the sheet keeps — the house's Data tab while the copy holds none
    (hubHouseTabIn_)."""
    return W.where_of(W.tab_of(reads, tab))


def decisions_by_ref(reads: L.Reads) -> dict[str, list[dict]]:
    """sdDecisionsByRef_."""
    def read() -> dict[str, list[dict]]:
        by: dict[str, list[dict]] = {}
        for d in tab_rows(reads, TABS["decisions"]):
            by.setdefault(s_(d.get("ref")), []).append(d)
        return by
    return reads.once("sdw:decs", read)


def decisions_part(reads: L.Reads) -> tuple[dict[str, list[dict]], bool]:
    """The decisions with the house's own word: not set up is the 503, never an empty truth."""
    try:
        return decisions_by_ref(reads), True
    except Defer:
        return {}, False


def events_list(reads: L.Reads) -> list[dict]:
    """sdEvents_: first row of an id wins."""
    def read() -> list[dict]:
        seen: set[str] = set()
        out = []
        for e in tab_rows(reads, TABS["events"]):
            if e["id"] in seen:
                continue
            seen.add(e["id"])
            out.append(e)
        return out
    return reads.once("sdw:events", read)


def events_soft(reads: L.Reads) -> list[dict]:
    """The events when the list can have them; a house not set up is none (sdBaseBuild_'s unreadable source)."""
    try:
        return events_list(reads)
    except Defer:
        return []


def event_by_id(reads: L.Reads, eid: str) -> dict | None:
    """sdEventById_."""
    return next((e for e in events_list(reads) if s_(e.get("id")) == eid), None)


def items_by_ref(reads: L.Reads) -> dict[str, list[dict]]:
    """sdItemsByRef_."""
    def read() -> dict[str, list[dict]]:
        by: dict[str, list[dict]] = {}
        for it in tab_rows(reads, TABS["inbox"]):
            by.setdefault(s_(it.get("ref")), []).append(it)
        return by
    return reads.once("sdw:items", read)


def items_soft(reads: L.Reads) -> dict[str, list[dict]]:
    try:
        return items_by_ref(reads)
    except Defer:
        return {}


# ---- settings and people ------------------------------------------------------------------------------------------

def settings(reads: L.Reads) -> dict[str, Any]:
    """sdSettings_: the settings house over the shipped defaults; not set up reads as the defaults."""
    def read() -> dict[str, Any]:
        out: dict[str, Any] = {"readable": True, "set_up": reads.db.house_moved(TABS["settings"]), "why": "",
                               "values": {}, "routes": None, "routes_why": ""}
        kv: dict[str, str] = {}
        if out["set_up"]:
            try:
                for r in tab_rows(reads, TABS["settings"]):
                    kv[r["key"]] = r["value"]
            except Defer as exc:
                out["readable"], out["why"] = False, str(exc)[:240]
        for k in ("directors", "leads", "payroll_to"):
            out["values"][k] = s_(kv.get(k)) or SETTING_DEFAULTS[k]
        routes = json_(kv.get("routes"), None)
        if isinstance(routes, dict):
            out["routes"] = {rk: [s_(x) for x in v if s_(x)] for rk, v in routes.items() if isinstance(v, list)}
        else:
            if s_(kv.get("routes")):
                out["routes_why"] = "The routes setting is not readable JSON — the shipped routes are used."
            out["routes"] = ROUTES_DEFAULT
        return out
    return dict(reads.once("sdw:settings", read))


def resolve_emails(reads: L.Reads, csv: Any) -> dict[str, Any]:
    """sdResolveEmails_: e-mails → live accounts, the way the sign-in door finds them (merged rows never answer)."""
    emails = [e.strip().lower() for e in re.split(r"[,;\s]+", s_(csv)) if "@" in e and e.find("@") > 0]
    out: dict[str, Any] = {"list": [], "missed": [], "why": ""}
    seen: set[str] = set()
    users = reads.users()

    def by_email(needle: str) -> dict | None:
        """userByEmail_: one account from any of the person's e-mails."""
        hit, hits = None, 0
        for u in users:
            if s_(u.get("mergedinto")):
                continue
            if s_(u.get("email")).lower() == needle:
                return u
        for u in users:
            if s_(u.get("mergedinto")):
                continue
            extras = [s_(e).lower() for e in parse_emails(u.get("emails"))]
            if needle in extras:
                hit, hits = u, hits + 1
        return hit if hits == 1 else None

    for email in emails:
        u = by_email(email)
        if u is not None and live(u):
            uid = s_(u.get("userid"))
            if uid not in seen:
                out["list"].append({"uid": uid, "name": s_(u.get("displayname")) or email, "email": email})
            seen.add(uid)
        else:
            out["missed"].append(email)
    if not emails:
        out["why"] = "no e-mail is written"
    elif out["missed"]:
        out["why"] = "no live account answers " + ", ".join(out["missed"])
    return out


def directors(reads: L.Reads) -> dict[str, Any]:
    """sdDirectors_: ONE LIST WITH SCHEDULING — its directors when readable, the Support Requests setting else."""
    def read() -> dict[str, Any]:
        try:
            sched = _SCH().directors(reads)
        except (Defer, hubdb.Unreadable) as exc:
            sched = {"readable": False, "list": [], "why": str(exc)[:240]}
        if sched.get("readable") and sched.get("list"):
            return {"readable": True, "from": "scheduling", "why": "",
                    "list": [{"uid": s_(d.get("uid")), "name": s_(d.get("name")), "email": s_(d.get("email"))}
                             for d in sched["list"]]}
        st = settings(reads)
        got = resolve_emails(reads, st["values"]["directors"]) if st["readable"] else \
            {"list": [], "missed": [], "why": st["why"]}
        if got["list"]:
            return {"readable": True, "from": "support", "list": got["list"],
                    "why": "Directors from Support Requests settings — Scheduling's list could not be read" +
                           (" (and " + got["why"] + ")" if got["missed"] else "") + "."}
        return {"readable": False, "from": "", "list": [],
                "why": "Nobody can decide right now: Scheduling's directors could not be read (" +
                       s_(sched.get("why")) + ") and the Support Requests settings name no live director (" +
                       s_(got.get("why")) + ")."}
    return dict(reads.once("sdw:directors", read))


def accounts_by_name(reads: L.Reads) -> dict[str, list[dict]]:
    """sdAccounts_: live accounts by display-name fold."""
    def read() -> dict[str, list[dict]]:
        by: dict[str, list[dict]] = {}
        for u in reads.users():
            if not live(u):
                continue
            k = name_key(u.get("displayname"))
            if k:
                by.setdefault(k, []).append(u)
        return by
    return reads.once("sdw:accounts", read)


def account_by_name(reads: L.Reads, name: Any) -> dict | None:
    """sdAccountByName_: the one live account a name folds to; None when none or two."""
    hits = accounts_by_name(reads).get(name_key(name)) or []
    return hits[0] if len(hits) == 1 else None


def account(reads: L.Reads, uid: Any) -> dict | None:
    """sdUserByUid_."""
    want = s_(uid)
    if not want:
        return None
    return next((u for u in reads.users() if s_(u.get("userid")) == want and live(u)), None)


def parse_phones(raw: Any) -> list:
    """profileParsePhones_."""
    return _SP()._parse_phones(raw)


def parse_emails(raw: Any) -> list:
    """profileParseEmails_."""
    if isinstance(raw, list):
        return raw
    s = gsjs.str_(raw)
    if not s:
        return []
    try:
        got = json.loads(s)
        return got if isinstance(got, list) else []
    except ValueError:
        return [x for x in re.split(r"\s*[;,]\s*", s) if x]


def sendable(raw: Any) -> str:
    """packetSendableNumber_."""
    d = re.sub(r"^1", "", re.sub(r"\D", "", gsjs.or_text(raw)))
    if len(d) != 10 or d in SHARED_LINE_DIGITS:
        return ""
    return "+1" + d


def phone_of(u: dict | None) -> str:
    """sdPhoneOf_: the account's own phone a text may go to — `phone`, then `phones`, the first the send door
    accepts."""
    if not u:
        return ""
    tries = [u.get("phone")]
    for p in parse_phones(u.get("phones")):
        tries.append(p.get("number") if isinstance(p, dict) else p)
    for t in tries:
        n = sendable(t)
        if n:
            return n
    return ""


# ---- the gate -----------------------------------------------------------------------------------------------------

def gate(sess: L.Session) -> dict[str, Any]:
    """sdGate_: {open, uid, name, email, is_master, is_director}; a closed app reads as Unknown action."""
    user = sess.user

    def read() -> dict[str, Any]:
        g: dict[str, Any] = {"open": False, "uid": "", "name": "", "email": "", "is_master": False,
                             "is_director": False}
        got = sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources())
        if not got or not got.get("open"):
            return g
        g["open"] = True
        g["uid"] = acting_id(user)
        g["name"] = actor_name(user)
        g["email"] = s_((user or {}).get("email")).lower()
        g["is_master"] = sc.is_real_master(user)
        g["is_director"] = bool(g["uid"]) and any(d["uid"] == g["uid"] for d in directors(sess.reads)["list"])
        return g
    return dict(sess.reads.once("sdw:gate:" + acting_id(user), read))


def seat_gate(sess: L.Session, ref: str) -> dict[str, Any] | None:
    """sdSeatGate_: the account the latest redirect named reads and answers that one request, whatever the app's
    access."""
    user = sess.user
    if not user or user.get("is_service") or visiting(user) or not SEAT_REF.match(s_(ref)):
        return None
    uid = acting_id(user)
    if not uid:
        return None
    try:
        last = last_redirect(decisions_by_ref(sess.reads).get(s_(ref)) or [])
    except Defer:
        return None
    if not last or last["to_uid"] != uid:
        return None
    return {"open": True, "seat": True, "uid": uid, "name": actor_name(user),
            "email": s_(user.get("email")).lower(), "is_master": False, "is_director": False}


# ---- the hotline queue (Estate.gs supportQueue, read off the copy's own text) --------------------------------------

def queue_key(person: Any, rtype: Any, details: Any, received: Any) -> str:
    """sdQueueKey_ — byte-identical to server/my_work.py _support_key."""
    day = day_of_(received)
    return "|".join([s_(person).lower(), s_(rtype).lower(), SC._cut16(s_(details).lower(), 120),
                     day or s_(received)])


def nth_ref(base: str, n: int) -> str:
    """sdNthRef_."""
    return base if n <= 1 else f"{base}-{n}"


def queue_entries(reads: L.Reads) -> list[dict] | None:
    """sdQueueAll_ over the queue book's copy rows (their own text, never re-typed): each with its HQ ref, in book
    order; None when the book cannot be read (sdBaseBuild_'s unreadable queue)."""
    def read() -> list[dict] | None:
        db = MW.HubBooks(reads)
        lane = MW.LANE_BY_KEY["supportQueue"]
        try:
            facts = db.switchboard(MW._facts_of(lane))
        except hubdb.Unreadable:
            facts = {}
        book, _pointer, _fact = MW._lane_target(db, lane, facts)
        present = MW._present(lane, sorted(db.header(book.sheet_id, book.tab)))
        if any(k not in present for k in lane.must):
            return None
        nth: dict[str, int] = {}
        out = []
        for i, r in enumerate(db.cells(book.sheet_id, book.tab, present)):
            if not any(str(r.get(k) or "").strip() for k in present if k != "id"):
                continue
            row = {"id": str(r.get("id") or "") or f"r{r['_row']}"}
            for k in present:
                if k != "id":
                    row[k] = str(r.get(k) or "")
            key = queue_key(row.get("requestor"), row.get("type_of_request"), row.get("description_of_request"),
                            row.get("date_received"))
            nth[key] = nth.get(key, 0) + 1
            m = re.fullmatch(r"r(\d+)", s_(row.get("id")))
            out.append({"ref": nth_ref("HQ" + sha10(key), nth[key]), "key": key, "row": row, "index": i,
                        "book_row": int(m.group(1)) if m else 0, "sheet_id": book.sheet_id})
        return out
    return reads.once("sdw:queue", read)


def day_only(v: Any) -> bool:
    """sdDayOnly_ for a cell's text."""
    return bool(_DAY_ONLY.match(s_(v)))


def call_times(reads: L.Reads) -> dict[str, str]:
    """sdCallTimes_: call_id → the call's own instant, from the calls house; {} when it cannot be read."""
    def read() -> dict[str, str]:
        out: dict[str, str] = {}
        try:
            CM = _CM()
            ref = CM._tab(reads, CM.COMM_CALLS_TAB)
            if ref is None:
                return out
            d, rows = CM._read_columns(reads, ref, {"id": (("call_id",), None), "at": (("call_at",), None)})
            for _rn, r in rows:
                cid, at = s_(CM._js_text(r["id"], d)), s_(CM._js_text(r["at"], d))
                if cid and at and cid not in out:
                    out[cid] = at
        except Exception:  # noqa: BLE001 - sdCallTimes_ catches everything: the raw day stands
            return {}
        return out
    return dict(reads.once("sdw:calltimes", read))


def received_of(reads: L.Reads, r: dict) -> str:
    """sdReceivedOf_: the sheet kept only the day — the call's own instant, when it names the same day."""
    raw = r.get("date_received")
    if not day_only(raw):
        return s_(raw)
    cid = call_id_of(r.get("notes"))
    at = call_times(reads).get(cid, "") if cid else ""
    return at if at and day_of_(at) == day_of_(raw) else s_(raw)


# ---- decisions over a ref --------------------------------------------------------------------------------------------

def final_of(decs: list[dict]) -> dict | None:
    """sdFinalOf_."""
    hit = None
    for d in decs or []:
        if s_(d.get("verdict")) in FINAL:
            hit = d
    return hit


def last_redirect(decs: list[dict]) -> dict[str, str] | None:
    """sdLastRedirect_."""
    hit = None
    for d in decs or []:
        if s_(d.get("verdict")) == "redirected":
            hit = d
    if hit is None:
        return None
    w = obj_(hit.get("witness"))
    if not s_(w.get("to_uid")):
        return None
    return {"to_uid": s_(w.get("to_uid")), "to_name": s_(w.get("to_name")) or "someone", "by": s_(hit.get("by_name")),
            "at": s_(hit.get("at")), "note": s_(hit.get("note")), "item_id": s_(w.get("item_id"))}


def redirect_of(decs: list[dict]) -> dict[str, str] | None:
    """sdRedirectOf_."""
    return None if final_of(decs) else last_redirect(decs)


def acks_of(decs: list[dict]) -> list[dict]:
    """sdAcksOf_."""
    seen: set[str] = set()
    out = []
    for d in decs or []:
        if s_(d.get("verdict")) != "aware" or s_(d.get("by_uid")) in seen:
            continue
        seen.add(s_(d.get("by_uid")))
        out.append({"uid": s_(d.get("by_uid")), "name": s_(d.get("by_name")), "at": s_(d.get("at"))})
    return out


def queue_status(book: Any, final: dict | None) -> dict[str, Any]:
    """sdQueueStatus_."""
    if final:
        return {"word": FINAL[s_(final.get("verdict"))], "tone": s_(final.get("verdict")), "completed": True}
    s, low = s_(book), s_(book).lower()
    if not low or low == "new":
        return {"word": s or "New", "tone": "new", "completed": False}
    if re.fullmatch(r"(resolved|closed|done|completed)", low):
        return {"word": s, "tone": "resolved", "completed": True}
    return {"word": s, "tone": "pending", "completed": False}


# ---- Scheduling's rows as the list shows them (sdSchedRows_'s filter; the answer itself is Scheduling's door) ------

def sched_status(f: dict) -> dict[str, Any]:
    """sdSchedStatus_."""
    s = s_(f.get("state"))
    seats = json_(f.get("seats"), [])
    seats = seats if isinstance(seats, list) else []
    waiting_seat = next((x for x in seats if isinstance(x, dict) and x.get("state") == "waiting"), None)
    names = [s_(t.get("name")) for t in ((waiting_seat or {}).get("to") or [])
             if isinstance(t, dict) and s_(t.get("name"))]
    if s in SCHED_WAITING:
        return {"word": "Waiting on " + (", ".join(names) or "an answer"), "completed": False, "waiting": names}
    m = {"approved": ("Approved", "approved"), "approved_future": ("Approved", "approved"),
         "declined": ("Declined", "denied"), "expired": ("Expired", "closed"), "withdrawn": ("Withdrawn", "closed"),
         "cancelled": ("Cancelled", "closed"), "done": ("Done", "resolved"), "covered": ("Covered", "resolved"),
         "stopped": ("Stopped", "closed"), "needs_human": ("Needs a person", "warning"),
         "outreach_1": ("Looking for cover", "pending"), "outreach_wait": ("Looking for cover", "pending"),
         "outreach_2": ("Looking for cover", "pending")}
    word, tone = m.get(s, (s or "Open", "pending"))
    return {"word": word, "tone": tone, "completed": s in SCHED_CLOSED, "waiting": []}


def sched_rows(reads: L.Reads) -> dict[str, Any]:
    """The flows the list would show (by id), and the phone call-offs by their call id; Scheduling not set up is
    none."""
    def read() -> dict[str, Any]:
        try:
            flows = _SF()._rows(reads, "sched_flows")
        except Defer:
            return {"flows": {}, "by_call": {}}
        out: dict[str, Any] = {"flows": {}, "by_call": {}}
        for f in flows:
            kind = s_(f.get("kind"))
            if kind not in SCHED_KINDS:
                continue
            src = s_(f.get("source_ref"))
            if kind == "call_off" and FLOW_ID.fullmatch(src):
                continue
            if kind == "take" and not sched_status(f)["completed"]:
                continue
            fid = s_(f.get("id"))
            out["flows"][fid] = f
            cut = src.find(":calloff:")
            if cut > 0:
                out["by_call"].setdefault(src[:cut], []).append(fid)
        return out
    return reads.once("sdw:schedrows", read)


def sched_books(reads: L.Reads) -> tuple[str, ...]:
    out: list[str] = []
    for t in ("sched_flows", "sched_inbox"):
        sid = "" if HT.tabled(t) else reads.db.resolve(t).sheet_id
        if sid and sid not in out:
            out.append(sid)
    return tuple(out)


# ---- one row as the decide door needs it (sdFindBaseRow_'s parts of sdBase_) ---------------------------------------

def queue_row(reads: L.Reads, ent: dict, decs: list[dict], g: dict) -> dict[str, Any]:
    """The queue row's parts sdMay_ and the verdicts use."""
    r = ent["row"]
    final = final_of(decs)
    st = queue_status(r.get("status"), final)
    redirect = redirect_of(decs)
    last = last_redirect(decs)
    if redirect and not st["completed"]:
        st = {"word": "Redirected to " + redirect["to_name"], "tone": "waiting", "completed": False}
    return {"ref": ent["ref"], "source": "queue",
            "kind": "call_off" if is_call_off(r.get("type_of_request")) else "request",
            "requestor": {"name": text_(r.get("requestor"), 120), "uid": ""},
            "type": type_parts(r.get("type_of_request")), "description": text_(r.get("description_of_request"), 4000),
            "status_word": st["word"], "completed": st["completed"], "acks": acks_of(decs),
            "_final": s_(final.get("verdict")) if final else "",
            "_final_by": s_(final.get("by_name")) if final else "",
            "_final_at": s_(final.get("at")) if final else "",
            "_redirect": redirect, "_last_to": last["to_uid"] if last else "",
            "_holds": bool(redirect and g["uid"] and redirect["to_uid"] == g["uid"]),
            "_call_id": call_id_of(r.get("notes")), "_book_row": ent["book_row"],
            "date": when_of(received_of(reads, r)), "_own": None}


def event_row(reads: L.Reads, ev: dict, decs: list[dict], items: list[dict], dirs: dict, g: dict) -> dict[str, Any]:
    """The event row's parts (sdEventRows_ + sdEventStatus_): who it waits on, and whether it is complete."""
    kind = s_(ev.get("kind"))
    acks = acks_of(decs)
    final = final_of(decs)
    waiting: list[str] = []
    if kind == "incident":
        if final:
            word, completed = FINAL[s_(final.get("verdict"))], True
        else:
            word, completed = "Important — incident filed", False
    else:
        addressed = [{"uid": s_(it.get("to_uid")), "name": s_(it.get("to_name"))} for it in items
                     if s_(it.get("seat")) == "director"]
        if not addressed:
            addressed = [{"uid": d["uid"], "name": d["name"]} for d in dirs["list"]]
        acked = {a["uid"]: a for a in acks}
        left = [d for d in addressed if d["uid"] not in acked]
        if addressed and not left:
            word = "Aware — " + " · ".join(first_(d["name"] or acked[d["uid"]]["name"]) + " " +
                                            clock_words(acked[d["uid"]]["at"]) for d in addressed)
            completed = True
        else:
            word, completed = "Directors, are you aware?", False
            waiting = [d["name"] for d in left]
    redirect = redirect_of(decs) if kind == "incident" else None
    last = last_redirect(decs) if kind == "incident" else None
    if redirect and not completed:
        word, completed, waiting = "Redirected to " + redirect["to_name"], False, [redirect["to_name"]]
    own = next((it for it in items if s_(it.get("to_uid")) == g["uid"] and s_(it.get("box")) != WORK_BOX), None)
    return {"ref": s_(ev.get("ref")), "source": "event", "kind": kind,
            "requestor": {"name": s_(ev.get("person")), "uid": s_(ev.get("person_uid"))},
            "type": type_of_category(ev.get("category")), "description": s_(ev.get("title")),
            "status_word": word, "completed": completed, "acks": acks, "waiting_on": waiting,
            "_final": s_(final.get("verdict")) if final else "",
            "_final_by": s_(final.get("by_name")) if final else "",
            "_final_at": s_(final.get("at")) if final else "",
            "_redirect": redirect, "_last_to": last["to_uid"] if last else "",
            "_holds": bool(redirect and g["uid"] and redirect["to_uid"] == g["uid"]),
            "_call_id": "", "_book_row": 0, "date": when_of(ev.get("at")) or when_of(ev.get("created_at")),
            "_own": own}


def find_row(reads: L.Reads, ref: str, g: dict) -> tuple[dict | None, bool]:
    """sdFindBaseRow_ for one ref: the queue row (a call-off's folds into its Scheduling flow), the event, or the flow;
    (row, the decisions house's own word)."""
    decs_by, decs_ok = decisions_part(reads)
    queue = queue_entries(reads) or []
    events = events_soft(reads)
    items_by = items_soft(reads)
    sched = sched_rows(reads)
    folded: dict[str, str] = {}
    used: dict[str, int] = {}
    for ent in queue:
        r = ent["row"]
        cid = call_id_of(r.get("notes"))
        if not is_call_off(r.get("type_of_request")) or not cid or cid not in sched["by_call"]:
            continue
        n = used.get(cid, 0)
        fids = sched["by_call"][cid]
        if n < len(fids):
            used[cid] = n + 1
            folded[ent["ref"]] = fids[n]
    target = folded.get(ref, ref)
    decs = decs_by.get(target) or []
    if target.startswith("SF"):
        f = sched["flows"].get(target)
        if f is None:
            return None, decs_ok
        return {"ref": target, "source": "scheduling", "flow": f}, decs_ok
    if target.startswith("SE"):
        ev = next((e for e in events if s_(e.get("ref")) == target and
                   (s_(e.get("kind")) in WARNING_KINDS or s_(e.get("kind")) == "incident")), None)
        if ev is None:
            return None, decs_ok
        return event_row(reads, ev, decs, items_by.get(target) or [], directors(reads), g), decs_ok
    ent = next((x for x in queue if x["ref"] == target), None)
    if ent is None:
        return None, decs_ok
    return queue_row(reads, ent, decs, g), decs_ok


def may_of(row: dict, g: dict, by_edition: bool) -> dict[str, Any]:
    """sdMay_ for a queue or an event row (the scheduling branch is answered before this; the directors' unreadable
    word the door itself says)."""
    may = {"approve": False, "deny": False, "resolve": False, "aware": False, "redirect": False, "why": ""}
    acked = any(a["uid"] == g["uid"] for a in row["acks"])
    if row["source"] == "event":
        own = row.get("_own")
        may["aware"] = (not acked) and (bool(own and not s_(own.get("answered_at"))) or g["is_director"] or
                                        g["is_master"] or by_edition)
        if row["kind"] == "incident" and not row["completed"]:
            may["resolve"] = g["is_director"] or g["is_master"] or row["_holds"] or by_edition
            may["redirect"] = may["resolve"]
        if not may["aware"] and not may["resolve"]:
            may["why"] = ("You marked this as aware." if acked else
                          "This one is closed." if row["completed"] else "Only the people it was addressed to mark it.")
        return may
    if row["_final"]:
        may["why"] = "Already " + row["_final"] + " by " + (row["_final_by"] or "someone") + "."
        return may
    if g["is_director"] or g["is_master"] or row["_holds"] or by_edition:
        may.update(approve=True, deny=True, resolve=True, redirect=True)
    else:
        may["why"] = "Only the directors decide requests."
    if row["completed"] and not row["_final"]:
        may.update(approve=False, deny=False, resolve=False, redirect=False)
        may["why"] = "The queue already says " + row["status_word"] + "."
    return may


# ---- the kept records: what app.edits holds of each write ----------------------------------------------------------

def decision_row(reads: L.Reads, *, ref: str, source: str, verdict: str, note: Any, by_uid: Any, by_name: Any,
                 via: str, at: str = "", witness: Any = None) -> dict[str, str]:
    """sdDecisionRow_."""
    at = at or iso_now(reads)
    return {"id": "SD" + sha10(ref + "|" + verdict + "|" + s_(by_uid) + "|" + at), "ref": ref, "source": source,
            "verdict": verdict, "note": text_(note, 2000), "by_uid": s_(by_uid), "by_name": s_(by_name), "at": at,
            "via": via or "support-desk", "witness": json_text(witness) if witness else "",
            "test_mode": test_word(reads)}


def item_(reads: L.Reads, ref: str, kind: str, seat: str, to: dict, title: Any, body: Any, house_label: Any,
          date: Any, alert: Any = "") -> dict[str, str]:
    """sdItem_."""
    return {"id": "SN" + sha10(ref + "|" + kind + "|" + s_(to.get("uid"))), "ref": ref, "box": "inbox", "kind": kind,
            "seat": seat, "to_uid": s_(to.get("uid")), "to_email": s_(to.get("email")), "to_name": s_(to.get("name")),
            "title": text_(title, 200), "body": text_(mask_phones(body), 300), "house_label": text_(house_label, 80),
            "date": s_(date), "state": "posted", "answered_by": "", "answered_at": "", "note": "",
            "link": "/app/support-desk/requests?ref=" + quote(ref), "test_mode": test_word(reads),
            "created_at": iso_now(reads), "alert": s_(alert)}


def work_item(reads: L.Reads, row: dict, to: dict, decision_id: str, by_name: str, note: str) -> dict[str, str]:
    """sdWorkItem_: the My Work item a redirect opens for its holder, one per redirect."""
    title = row["type"]["display"] + " from " + (row["requestor"]["name"] or "an unknown caller")
    it = item_(reads, row["ref"], REDIRECT, REDIRECT, to, title, row["description"], "", "")
    it["id"] = "SN" + sha10(row["ref"] + "|" + REDIRECT + "|" + s_(to.get("uid")) + "|" + decision_id)
    it["box"] = WORK_BOX
    it["state"] = "waiting"
    it["note"] = text_("Redirected by " + by_name + (": " + note if note else ""), 300)
    return it


def decision_record(reads: L.Reads, row: dict, subject: str, edition: str = "") -> dict[str, Any]:
    """A decision appended, kept whole in app.edits."""
    sid, tab = where(reads, TABS["decisions"])
    return W.kept_record(sid, tab, "append", "id", row["id"], subject,
                         {h: row.get(h, "") for h in HEADERS["support_decisions"]}, edition=edition)


def item_record(reads: L.Reads, was: dict | None, now: dict, subject: str, edition: str = "") -> dict[str, Any] | None:
    """An item appended whole, or the cells its write changes (sdUpsert_'s line as the diff the copy shows)."""
    sid, tab = where(reads, TABS["inbox"])
    header = HEADERS["support_inbox"]
    if was is None:
        return W.kept_record(sid, tab, "append", "id", now["id"], subject, {h: now.get(h, "") for h in header},
                             edition=edition)
    cells = {h: now.get(h, "") for h in header if s_(now.get(h)) != s_(was.get(h))}
    if not cells:
        return None
    return W.kept_record(sid, tab, "edit", "id", now["id"], subject, cells,
                         before={h: was.get(h, "") for h in cells}, edition=edition)


def seats_close(reads: L.Reads, ref: str, state: str, by: str, at: str, edition: str = "",
                guarded: bool = False) -> list[dict]:
    """sdSeatsClose_: the request's waiting My Work items, each marked with what closed it; `guarded` for the callers
    whose .gs wraps it in try (sdDecideFinal_, supportDeskAdp) — a house not set up closes nothing."""
    try:
        items = items_by_ref(reads).get(ref) or []
    except Defer:
        if not guarded:
            raise
        items = []
    out = []
    for it in items:
        if s_(it.get("box")) != WORK_BOX or s_(it.get("state")) != "waiting":
            continue
        now = {**it, "state": state, "answered_by": by, "answered_at": at}
        rec = item_record(reads, it, now, ref, edition)
        if rec:
            out.append(rec)
    return out


def books(reads: L.Reads) -> tuple[str, ...]:
    """The books a verdict on these rows rests on (a house kept in its own table rests on none)."""
    out: list[str] = []
    for t in TABS.values():
        sid = "" if HT.tabled(t) else reads.db.resolve(t).sheet_id
        if sid and sid not in out:
            out.append(sid)
    queue = queue_entries(reads)
    if queue:
        sid = queue[0]["sheet_id"]
        if sid and sid not in out:
            out.append(sid)
    return tuple(out)


def kept(answer: dict[str, Any], edits: list[dict | None], subject: str, fresh: tuple[str, ...],
         edition: str = "") -> Decision:
    """W.final, the verdict resting on the books it read."""
    d = W.final(answer, [e for e in edits if e], subject, edition)
    d.fresh = fresh
    return d


# ---- the verdicts' writes (each under the platform's lock; sdLock_'s sentence is the store's BUSY) -----------------

def aware_locked(reads: L.Reads, ref: str, source: str, uid: str, name: str, via: str,
                 edition: str = "") -> tuple[dict[str, Any], list[dict]]:
    """sdAwareLocked_: the person's own items answered with it, then one 'aware' decision per person per request."""
    decs = decisions_by_ref(reads).get(ref) or []
    mine = next((d for d in decs if s_(d.get("verdict")) == "aware" and s_(d.get("by_uid")) == uid), None)
    now = iso_now(reads)
    edits: list[dict] = []
    for it in items_by_ref(reads).get(ref) or []:
        if s_(it.get("to_uid")) != uid or s_(it.get("box")) == WORK_BOX or s_(it.get("answered_at")):
            continue
        now_it = {**it, "answered_by": name, "answered_at": now,
                  "state": "seen" if s_(it.get("kind")) == "info" else "aware"}
        rec = item_record(reads, it, now_it, ref, edition)
        if rec:
            edits.append(rec)
    if mine:
        return {"changed": False, "said": "Already marked by you at " + stamp_words(mine.get("at")) + "."}, edits
    edits.append(decision_record(reads, decision_row(reads, ref=ref, source=source, verdict="aware", note="",
                                                     by_uid=uid, by_name=name, via=via, at=now), ref, edition))
    return {"changed": True, "said": "Marked — you are aware."}, edits


def decide_final(reads: L.Reads, row: dict, verdict: str, note: str, g: dict,
                 edition: str = "") -> tuple[dict[str, Any] | None, dict[str, Any], list[dict]]:
    """sdDecideFinal_: one final verdict per request (Requests.gs requestResolve's law)."""
    decs = decisions_by_ref(reads).get(row["ref"]) or []
    final = final_of(decs)
    if final:
        who = s_(final.get("by_name")) or "someone"
        if s_(final.get("verdict")) == verdict:
            return None, {"changed": False, "said": "Already " + verdict + " by " + who + "."}, []
        return W.refuse(409, "Already " + s_(final.get("verdict")) + " by " + who + " at " +
                        stamp_words(final.get("at")) + ".").answer, {}, []
    witness = None
    if row["source"] == "queue":
        witness = {"row": row["_book_row"] or 0, "requestor": row["requestor"]["name"], "type": row["type"]["raw"],
                   "call_id": row["_call_id"] or "", "date_received": row["date"]}
    dec = decision_row(reads, ref=row["ref"], source=row["source"], verdict=verdict, note=note, by_uid=g["uid"],
                       by_name=g["name"], via="support-desk", witness=witness)
    edits = [decision_record(reads, dec, row["ref"], edition)]
    # the decision stands on its own; a My Work item left waiting only answers "Already …" when pressed
    edits += seats_close(reads, row["ref"], verdict, g["name"], dec["at"], edition, guarded=True)
    return None, {"changed": True, "said": FINAL[verdict] + "."}, edits


def redirect_target(reads: L.Reads, uid: Any) -> dict[str, Any]:
    """sdRedirectTarget_: the account a redirect hands a request to — live and staff-side, or a refusal."""
    want = text_(uid, 80)
    if not want:
        return {"status": 400, "message": "Choose who to redirect it to."}
    hit = next((u for u in reads.users() if s_(u.get("userid")) == want and live(u)), None)
    if hit is None:
        return {"status": 400, "message": "That account is not a live account on the platform — choose another person."}
    # an SSA or a FAMILY is never staff, whatever its role says (scope.role_counts)
    if s_(hit.get("role")).lower() not in STAFF_ROLES or not sc.role_counts(hit.get("types"), hit.get("role")):
        return {"status": 400, "message": "A request is redirected to a staff account only — choose another person."}
    name = s_(hit.get("displayname"))
    if not name:
        return {"status": 400, "message": "That account carries no name — choose another person."}
    return {"uid": want, "name": name, "email": s_(hit.get("email")).lower()}


def redirect_do(reads: L.Reads, row: dict, to: dict, note: str, g: dict,
                edition: str = "") -> tuple[dict[str, Any] | None, dict[str, Any], list[dict]]:
    """sdRedirect_: recorded like every verdict but never final — the request stays open in the holder's My Work."""
    decs = decisions_by_ref(reads).get(row["ref"]) or []
    final = final_of(decs)
    if final:
        return W.refuse(409, "Already " + s_(final.get("verdict")) + " by " +
                        (s_(final.get("by_name")) or "someone") + " at " + stamp_words(final.get("at")) + ".").answer, \
            {}, []
    open_ = redirect_of(decs)
    seated = any(s_(it.get("box")) == WORK_BOX and s_(it.get("state")) == "waiting" and
                 s_(it.get("to_uid")) == to["uid"] for it in items_by_ref(reads).get(row["ref"]) or [])
    if open_ and open_["to_uid"] == to["uid"] and seated:
        return None, {"changed": False, "said": "Already redirected to " + to["name"] + "."}, []
    at = iso_now(reads)
    dec = decision_row(reads, ref=row["ref"], source=row["source"], verdict="redirected", note=note,
                       by_uid=g["uid"], by_name=g["name"], via="support-desk", at=at)
    it = work_item(reads, row, to, dec["id"], g["name"], note)
    w: dict[str, Any] = {"to_uid": to["uid"], "to_name": to["name"], "item_id": it["id"]}
    if row["source"] == "queue":
        w.update({"row": row["_book_row"] or 0, "requestor": row["requestor"]["name"], "type": row["type"]["raw"],
                  "call_id": row["_call_id"] or "", "date_received": row["date"]})
    dec["witness"] = json_text(w)
    edits = [decision_record(reads, dec, row["ref"], edition)]
    edits += seats_close(reads, row["ref"], "redirected", g["name"], at, edition)
    edits.append(item_record(reads, None, it, row["ref"], edition))
    return None, {"changed": True, "said": "Redirected to " + to["name"] + " — it waits in their My Work."}, edits


# ---- the texts a request still owes (sdOwedSay_), through Smart Comms alone ----------------------------------------

def field_words(field: Any) -> str:
    """sdFieldWords_."""
    f = s_(field)
    return "home address" if f == "address" else "e-mail" if f == "email" else "phone" if f == "phone" else f


def route_vars(q: dict, ref: str) -> dict[str, str]:
    """sdRouteVars_."""
    return {"requestor": text_(q.get("requestor"), 80) or "an unknown caller",
            "callback": text_(q.get("requestor_phone"), 30) or "no number on file",
            "type": text_(q.get("type_of_request"), 80), "summary": text_(q.get("description_of_request"), 120),
            "urgency": urgency_(q.get("urgency")) or "Low",
            # sdRouteVars_: the ref goes in raw (only sdItem_'s own link encodes it)
            "link": link("/app/support-desk/requests?ref=" + ref)}


def text_plan(reads: L.Reads, ev: dict) -> dict[str, Any] | None:
    """sdTextPlan_: the situation and its values for an event that owes texts; None when it owes none."""
    d = obj_(ev.get("details"))
    kind = s_(ev.get("kind"))
    if kind == "punch":
        return {"situation": SR_PUNCH,
                "vars": {"person": s_(ev.get("person")), "direction": s_(d.get("direction")),
                         "house": s_(d.get("house_name")) or s_(ev.get("house")), "shift": s_(d.get("shift_code")),
                         "date": day_words(ev.get("day")), "link": link("/app/my-inbox/alerts")}}
    if kind == "adp":
        return {"situation": SR_ADP,
                "vars": {"requestor": s_(ev.get("person")), "field": field_words(d.get("field")),
                         "link": link("/app/support-desk/requests?ref=" + s_(ev.get("ref")))}}
    if kind == "route" and s_(ev.get("route")) in ("vehicle", "payroll"):
        ref = s_(ev.get("ref"))
        ent = next((x for x in queue_entries(reads) or [] if x["ref"] == ref), None)
        if ent is None:
            return None
        return {"situation": SR_VEHICLE if s_(ev.get("route")) == "vehicle" else SR_PAYROLL,
                "vars": route_vars(ent["row"], ref)}
    return None


def ref_event(reads: L.Reads, ref: str) -> dict | None:
    """The event of a ref that a text plan reads (route, punch or adp), the first in sheet order."""
    return next((e for e in events_soft(reads)
                 if s_(e.get("ref")) == ref and s_(e.get("kind")) in ("route", "punch", "adp")), None)


def outcome(r: dict) -> str:
    """sdOutcome_."""
    s = s_(r.get("state"))
    return "held:" + (s_(r.get("held")) or "gated") if s == "held" else s or "failed"


def tell(reads: L.Reads, situation: str, to: dict, vars_: dict, ref: str) -> dict[str, Any]:
    """sdTell_: one text to one recipient's own phone through Smart Comms, under sdTell_'s own key."""
    phone = phone_of(account(reads, to.get("uid")))
    if not phone:
        return {"state": "no_phone", "held": "", "why": "no phone of their own the send door accepts"}
    return SC.raise_situation(None, situation=situation, to=phone, vars=vars_ or {},
                              key="sr|" + situation + "|" + ref + "|" + s_(to.get("uid")),
                              person=s_(to.get("name")), lane=LANE, at_ms=int(now_ms(reads)), prune=True)


def owed_say(reads: L.Reads, ref: str, final_exists: bool, edition: str) -> list[dict]:
    """sdOwedSay_ for one ref: a quiet-held text is said again while the request is open, dropped once it is decided.
    Smart Comms' outbox owes a held text itself (the drain says it at 08:00), so a re-say names the same key and
    dedups, and a decided request's owed rows are withdrawn here — the item's note saying what happened, as the
    sheet said it."""
    try:
        items = [it for it in tab_rows(reads, TABS["inbox"]) if s_(it.get("ref")) == ref]
    except Defer:
        return []
    now = now_ms(reads)
    owed = []
    for it in items:
        if not re.match(r"^text: held:quiet", s_(it.get("note"))):
            continue
        born = gsjs.date_parse(it.get("created_at"))
        if born is not None and now - born < OWED_HOURS * 3600000:
            owed.append(it)
    if not owed:
        return []
    ev = ref_event(reads, ref)
    if ev is None:
        return []
    if final_exists:
        edits = []
        for it in owed:
            rec = item_record(reads, it, {**it, "note": "text: dropped: the request was decided first"}, ref, edition)
            if rec:
                edits.append(rec)
        plan = text_plan(reads, ev)
        if plan is not None:
            SC.cancel_owed(write_tx(), "sr|" + plan["situation"] + "|" + ref + "|", "the request was decided first")
        return edits
    plan = text_plan(reads, ev)
    if plan is None:
        return []
    edits = []
    for it in owed:
        r = tell(reads, plan["situation"], {"uid": it.get("to_uid"), "name": it.get("to_name")}, plan["vars"], ref)
        rec = item_record(reads, it, {**it, "note": "text: " + outcome(r)}, ref, edition)
        if rec:
            edits.append(rec)
    return edits


# ---- supportDeskDecide ---------------------------------------------------------------------------------------------

def decide(sess: L.Session, payload: dict) -> Decision:
    """supportDeskDecide: approve, deny, resolve, redirect or aware — the decision row, the seats and the owed texts
    kept in app.edits; a Scheduling row is answered by Scheduling's own (Python) door."""
    p = payload if isinstance(payload, dict) else {}
    reads, user = sess.reads, sess.user
    ref = text_(p.get("ref"), 40)
    g = gate(sess)
    app_open = bool(g.get("open"))
    if not app_open:
        # the account a redirect named answers that request from My Work, whatever the app's access
        g = seat_gate(sess, ref) or g
    if not g.get("open"):
        return Decision(closed())
    if not user or user.get("is_service") or visiting(user):
        return W.refuse(403, OWN_ACCOUNT)
    word = text_(p.get("verdict"), 10).lower()
    note = text_(p.get("note"), 500)
    if not ref:
        return W.refuse(400, "Which request? The ref is missing.")
    verdict = VERDICT_OF.get(word)
    if verdict is None:
        return W.refuse(400, "Answer with approve, deny, resolve, redirect or aware.")
    row, decs_ok = find_row(reads, ref, g)
    if row is None:
        return W.refuse(404, "That request is not on the queue any more.", fresh=books(reads) + sched_books(reads))
    if row["source"] == "scheduling":
        return decide_sched(sess, row, word, note, g)
    dirs = directors(reads)
    if not dirs["readable"]:
        return W.refuse(503, dirs["why"])
    if not decs_ok:
        return W.refuse(503, "The decisions house could not be read, so nothing can be decided right now.")
    # the last account a redirect named keeps its seat after a verdict lands, so a late answer meets the 409 law
    holder = bool(g["uid"]) and row["_last_to"] == g["uid"]
    by_edition = app_open and not (g["is_director"] or g["is_master"] or holder) and \
        W.edition_allows(sess, EDITION["requests"])
    if verdict != "aware" and not (g["is_director"] or g["is_master"] or holder or by_edition):
        return W.refuse(403, "Only the directors decide requests.")
    # a request already decided answers by the one-verdict law (same verdict: unchanged; another: 409), never by `may`
    decided = verdict != "aware" and bool(row["_final"])
    may = may_of(row, g, by_edition)
    if not decided and not may.get(word):
        return W.refuse(400, may["why"] or "That answer is not offered on this request.")
    to = None
    if verdict == "redirected":
        to = redirect_target(reads, p.get("to"))
        if to.get("status"):
            return Decision(to)
        if to["uid"] == g["uid"]:
            return W.refuse(400, "Redirect it to someone else — it is already yours to answer.")
    edition = EDITION["requests"] if by_edition else ""
    W.gate(reads)
    try:
        if verdict == "aware":
            res, edits = aware_locked(reads, row["ref"], row["source"], g["uid"], g["name"], "support-desk", edition)
            refused = None
        elif verdict == "redirected":
            refused, res, edits = redirect_do(reads, row, to, note, g, edition)
        else:
            refused, res, edits = decide_final(reads, row, verdict, note, g, edition)
    except Defer as exc:
        return W.refuse(503, WRITE_FAIL.format(str(exc)[:240]))
    if refused is not None:
        return Decision(refused)
    edits += owed_say(reads, row["ref"], verdict in FINAL or bool(row["_final"]), edition)
    log.info("supportDeskDecide %s %s: %s", row["ref"], verdict, res["said"])
    # the .gs answers the row read again; the panel re-reads the list after a write, so the row is None here
    answer = {"status": 200, "data": {"ok": True, "changed": res["changed"] is not False, "said": res["said"],
                                      "row": None}}
    return kept(answer, edits, row["ref"], books(reads) + sched_books(reads), edition)


def decide_sched(sess: L.Session, row: dict, word: str, note: str, g: dict) -> Decision:
    """sdDecideSched_: a Scheduling row is answered by Scheduling's own door — the Python schedulingAnswer, its
    verdict honored (an allowed write is Apps Script's, so this one hands too); a note lands on the ref's decisions."""
    reads = sess.reads
    f = row["flow"]
    uid = g["uid"]
    SF = _SF()
    stand_in = bool(g["is_master"] and uid and s_(f.get("person_uid")) != uid)
    work = warn = seat = None
    for it in SF._rows(reads, "sched_inbox"):
        if s_(it.get("flow_id")) != row["ref"]:
            continue
        if stand_in and seat is None and s_(it.get("box")) == "work" and s_(it.get("state")) == "waiting" and \
                s_(it.get("seat")) == "director":
            seat = it
        if not uid or s_(it.get("to_uid")) != uid:
            continue
        if s_(it.get("box")) == "work" and s_(it.get("state")) == "waiting":
            work = it
        if s_(it.get("box")) == "inbox" and s_(it.get("kind")) == "warning" and not s_(it.get("answered_at")):
            warn = it
    item = work or seat or warn
    if item is None:
        waiting = sched_status(f)["waiting"]
        return W.refuse(403, "This one is waiting on " + (", ".join(waiting) or "someone else") + ".")
    sched_word = "approve" if word == "approve" else "decline" if word == "deny" else "seen" if word == "aware" else ""
    if not sched_word:
        return W.refuse(400, "A Scheduling request is approved, declined or marked as seen here.")
    if s_(item.get("box")) == "work" and sched_word == "seen":
        return W.refuse(400, "Approve or decline this one.")
    if s_(item.get("box")) == "inbox" and sched_word != "seen":
        return W.refuse(400, "An alert is only marked as aware.")
    sub = SF.ACTIONS["schedulingAnswer"](sess, {"item_id": s_(item.get("id")), "word": sched_word, "note": note})
    env = sub.answer or {"status": 503, "message": "Scheduling did not answer."}
    if env.get("status") != 200:
        return Decision(env, fresh=sub.fresh)
    d = env.get("data") or {}
    # Scheduling's own records (the answer, its inbox rows, the flow) are this write's too; a note joins them
    edits: list[dict] = list(sub.edits or [])
    if note:
        dec = decision_row(reads, ref=row["ref"], source="scheduling", verdict="note", note=note, by_uid=g["uid"],
                           by_name=g["name"], via="support-desk")
        edits.append(decision_record(reads, dec, row["ref"]))
    answer = {"status": 200, "data": {"ok": True, "changed": d.get("changed") is not False, "said": d.get("said"),
                                      "state": d.get("state"), "row": None}}
    out = W.final(answer, edits, row["ref"])
    # a Scheduling answer kept in its own tables is final here too
    out.own, out.subject = bool(sub.own), out.subject or row["ref"]
    out.fresh = sub.fresh
    return out


# ---- ADP · Update Information: the proof (sdAdpJudge_ to the leaf) -------------------------------------------------

def name_missing(name: Any) -> bool:
    """contactNameMissing_."""
    n = re.sub(r"[^a-z]", "", s_(name).lower())
    return not n or n in NO_NAME_WORDS


def email_keys(v: Any) -> list[str]:
    """contactEmailKeys_: Gmail dots and +tags are one mailbox."""
    e = s_(v).lower()
    if e.find("@") < 1:
        return []
    at = e.rfind("@")
    local, domain = e[:at], e[at + 1:]
    if not local or not domain or "." not in domain:
        return []
    keys = [e]
    plus = local.find("+")
    canon = local[:plus] if plus > 0 else local
    if domain in ("gmail.com", "googlemail.com"):
        canon = canon.replace(".", "")
        domain = "gmail.com"
    alias = canon + "@" + domain
    if alias != e and canon:
        keys.append(alias)
    return keys


def guard_config(reads: L.Reads) -> dict[str, str]:
    """hiringAlerts_ for the guard; unreadable reads as its floors alone, as the .gs's try does."""
    try:
        return reads.config()
    except (Defer, hubdb.Unreadable):
        return {}


def _cfg_split(reads: L.Reads, key: str) -> list[str]:
    return [v.strip() for v in re.split(r"[,;\n]+", guard_config(reads).get(key, "")) if v.strip()]


def test_phones(reads: L.Reads) -> set[str]:
    """cgTestPhones_."""
    def read() -> set[str]:
        out = set(TEST_PHONE_FLOOR)
        for raw in _cfg_split(reads, "staff_guard_test_phones"):
            k = W.phone_key(raw)
            if k:
                out.add(k)
        return out
    return set(reads.once("sdw:testphones", read))


def shared_emails(reads: L.Reads) -> set[str]:
    """cgSharedEmails_."""
    def read() -> set[str]:
        out = {v.lower() for v in SHARED_EMAIL_FLOOR}
        out |= {v.lower() for v in _cfg_split(reads, "staff_guard_shared_emails")}
        return out
    return set(reads.once("sdw:sharedmails", read))


def block_statuses(reads: L.Reads) -> set[str]:
    """cgBlockStatuses_."""
    raw = guard_config(reads).get("staff_guard_block_statuses", "").strip() or "active, admin"
    return {v for v in (x.strip().lower() for x in re.split(r"[,;\n]+", raw)) if v}


def test_email(reads: L.Reads, key: Any) -> bool:
    """cgTestEmails_: one trailing wildcard per pattern."""
    k = s_(key).lower()
    if not k:
        return False
    pats = [OPERATOR_TEST_EMAIL, *TEST_EMAIL_FLOOR]
    pats += [v.lower() for v in _cfg_split(reads, "staff_guard_test_emails")]
    for pat in pats:
        if not pat:
            continue
        if "*" not in pat:
            if pat == k:
                return True
            continue
        rx = "^" + ".*".join(re.escape(seg) for seg in pat.split("*")) + "$"
        if re.match(rx, k):
            return True
    return False


def who_decide(rows: list[dict] | None) -> dict[str, Any]:
    """contactWhoDecide_."""
    people: list[dict] = []
    seen: dict[str, dict] = {}
    for p in rows or []:
        nm = s_(p.get("name"))
        k = re.sub(r"[^a-z0-9]", "", nm.lower())
        if not nm or not k:
            continue
        if k in seen:
            if p.get("active"):
                seen[k]["active"] = True
            continue
        seen[k] = {"name": nm, "active": bool(p.get("active")), "src": s_(p.get("src"))}
        people.append(seen[k])
    if not people:
        return {"state": "unknown", "name": "", "people": []}
    if len(people) > 1:
        return {"state": "shared", "name": "", "people": people}
    return {"state": "sole", "name": people[0]["name"], "people": people}


def contact_index(reads: L.Reads) -> dict[str, Any]:
    """staffContactIndex_: every phone and e-mail the people roster and the accounts hold; a build that could not be
    read whole is not ok, and a failed build is never stored."""
    def read() -> dict[str, Any]:
        idx: dict[str, Any] = {"phones": {}, "emails": {}, "ok": True}
        block = block_statuses(reads)
        tphones, smail = test_phones(reads), shared_emails(reads)

        def add(name: Any, active: bool, src: str, cid: Any, phone: Any, email: Any) -> None:
            who = {"name": s_(name) or "a staff record", "active": bool(active), "src": src, "cid": s_(cid)}
            pk = W.phone_key(phone)
            if pk and pk not in SHARED_LINE_DIGITS and pk not in tphones:
                idx["phones"].setdefault(pk, []).append(who)
            for k in email_keys(email):
                if test_email(reads, k) or k in smail:
                    continue
                idx["emails"].setdefault(k, []).append(who)
        try:
            SP = _SP()
            for p in SP.people_merged(reads, SP._people(reads)) or []:
                act = s_(p.get("status")).lower() in block
                add(p.get("name"), act, "people", "", p.get("phone"), p.get("email"))
                for v in p.get("phones") or []:
                    add(p.get("name"), act, "people", "", v, "")
                for v in p.get("emails") or []:
                    add(p.get("name"), act, "people", "", "", v)
        except Exception:  # noqa: BLE001 - idx.ok = false, as the .gs says
            idx["ok"] = False
        try:
            for u in reads.users():
                role = s_(u.get("role")).lower()
                if role in ("client", "onboarding", "interviewer") or s_(u.get("systemtype")):
                    continue
                act = s_(u.get("active")).lower() == "true"
                cid = s_(u.get("candidateid"))
                add(u.get("displayname"), act, "users", cid, u.get("phone"), u.get("email"))
                for v in parse_phones(u.get("phones")):
                    add(u.get("displayname"), act, "users", cid,
                        (v.get("number") or v.get("value")) if isinstance(v, dict) else v, "")
                for v in parse_emails(u.get("emails")):
                    add(u.get("displayname"), act, "users", cid, "",
                        (v.get("value") or v.get("email")) if isinstance(v, dict) else v)
        except Exception:  # noqa: BLE001 - idx.ok = false, as the .gs says
            idx["ok"] = False
        return idx
    return dict(reads.once("sdw:contactidx", read))


def phone_who(reads: L.Reads, phone: Any) -> dict[str, Any]:
    """contactPhoneWho_: never asserts identity — a shared line names nobody."""
    key = W.phone_key(phone)
    if not key:
        return {"state": "unknown", "name": "", "people": [], "via": "", "why": "no ten-digit number to ask with"}
    if key in SHARED_LINE_DIGITS or key in test_phones(reads):
        return {"state": "unknown", "name": "", "people": [], "via": "",
                "why": "a company or test line — the number many people call from names none of them"}
    idx = contact_index(reads)
    if not idx["ok"]:
        return {"state": "unknown", "name": "", "people": [], "via": "",
                "why": "the staff roster could not be read — nobody is named off a roster we did not see"}
    ans = who_decide(idx["phones"].get(key) or [])
    ans["via"] = "" if ans["state"] == "unknown" else "phone"
    ans["why"] = ("one person on the staff roster holds this line" if ans["state"] == "sole" else
                  str(len(ans["people"])) + " people on the staff roster hold this line — it names none of them"
                  if ans["state"] == "shared" else "the number is not on the staff roster")
    return ans


def contact_guard(reads: L.Reads, phone: Any, email: Any) -> dict[str, Any] | None:
    """contactGuard_(phone, email, {}): the staff roster's own word on a value already held."""
    idx = contact_index(reads)
    if not idx["ok"]:
        return {"severity": "unverified", "hits": []}
    pk = W.phone_key(phone)
    if pk and (pk in SHARED_LINE_DIGITS or pk in test_phones(reads)):
        pk = ""
    eks = [k for k in email_keys(email) if not test_email(reads, k) and k not in shared_emails(reads)]
    hits: list[dict] = []
    if pk and idx["phones"].get(pk):
        hits.append({"via": "phone", "people": idx["phones"][pk]})
    seen: set[str] = set()
    mail = None
    for k in eks:
        for p in idx["emails"].get(k) or []:
            sig = p["src"] + "|" + p["name"]
            if sig in seen:
                continue
            seen.add(sig)
            if mail is None:
                mail = {"via": "email", "people": []}
                hits.append(mail)
            mail["people"].append(p)
    if not hits:
        return None
    blocking = any(pp.get("active") for h in hits for pp in h["people"])
    return {"severity": "block" if blocking else "warn", "hits": hits}


def held_elsewhere(reads: L.Reads, uid: str, field: str, value: str) -> str:
    """sdHeldElsewhere_: another live account already holds this e-mail or phone — then it can never be added here."""
    want = s_(value).lower() if field == "email" else digits10(value)
    hit = ""
    for u in reads.users():
        if hit or not live(u) or s_(u.get("userid")) == uid:
            continue
        if field == "email":
            mails = [s_(u.get("email")).lower()] + [s_(e).lower() for e in parse_emails(u.get("emails"))]
            if want in mails:
                hit = s_(u.get("displayname"))
        else:
            nums = [digits10(u.get("phone"))] + [digits10(p.get("number") if isinstance(p, dict) else p)
                                                 for p in parse_phones(u.get("phones"))]
            if want in nums:
                hit = s_(u.get("displayname"))
    if hit:
        return hit
    guard = contact_guard(reads, value if field == "phone" else "", value if field == "email" else "")
    if guard and guard["severity"] == "unverified":
        # a roster that cannot be read is not a roster without holders: the request is judged again
        raise JudgeFailed("the staff roster could not be read")
    me = account(reads, uid)
    mine = name_key(me.get("displayname")) if me else ""
    other = ""
    for h in (guard or {}).get("hits", []):
        for pp in h.get("people", []):
            if not other and name_key(pp.get("name")) != mine:
                other = s_(pp.get("name"))
    return other


def transcript_read(reads: L.Reads, want: str) -> tuple[dict[str, str] | None, bool]:
    """commCallsTranscriptRead_: the best copy of the two transcript inboxes (the dialogue counts double);
    (the row, whether an inbox this side cannot read was left out — then no verdict of the words is safe)."""
    refs = []
    skipped = False
    CM = _CM()
    try:
        refs.append(CM._tab(reads, CM.QUO_TRANSCRIPTS_TAB))
    except (Defer, hubdb.Unreadable):
        skipped = True
    hot_id = gsjs.str_(reads.db.prop("HOTLINE_TRANSCRIPTS_ID"))
    if hot_id:
        try:
            refs.append(reads.tab_of(hot_id, CM.HOTLINE_TRANSCRIPTS_TAB, "the hotline transcripts"))
        except (Defer, hubdb.Unreadable):
            skipped = True
    best = None
    for ref in refs:
        if ref is None:
            continue
        d, rows = CM._read_columns(reads, ref, {"id": (("call_id", "Call ID"), None),
                                                "full": (("full_transcript", "Full Transcript"), None),
                                                "spoken": (("speaker_transcript", "Speaker Transcript"), None)})
        for _rn, r in rows:
            if s_(CM._js_text(r["id"], d)) != want:
                continue
            full, spoken = CM._js_text(r["full"], d), CM._js_text(r["spoken"], d)
            score = len(spoken) * 2 + len(full)
            if best is None or score > best[0]:
                best = (score, full, spoken)
    return (None if best is None else {"full": best[1], "spoken": best[2]}), skipped


def turns_of(spoken: Any) -> list[dict[str, str]]:
    """sdTurns_."""
    out = []
    for line in str(spoken or "").split("\n"):
        m = TURN.match(line)
        if m:
            out.append({"who": m.group(2).strip(), "said": m.group(3)})
    return out


def _pick(m: re.Match) -> dict[str, str]:
    """sdReadBack_'s pick."""
    w = m.group(3).lower()
    field = "address" if w.startswith("address") else "phone" if w.startswith("phone") else "email"
    return {"field": field, "value": re.sub(r"[\s,;:]+$", "", s_(m.group(7)))}


def read_back(spoken: Any, full: Any) -> dict[str, str] | None:
    """sdReadBack_: the value the agent read back and the caller confirmed, deterministic; None when the call
    does not prove one."""
    turns = turns_of(spoken)
    if turns:
        for i, t in enumerate(turns):
            m = READBACK.search(t["said"])
            if not m:
                continue
            for j in range(i + 1, len(turns)):
                if turns[j]["who"] == turns[i]["who"]:
                    continue
                if YES_RE.match(turns[j]["said"]):
                    return _pick(m)
                break
        return None
    text = str(full or "")
    for m in READBACK.finditer(text):
        if YES_RE.match(re.sub(r"^[\s?.!,]+", "", text[m.end():])):
            return _pick(m)
    return None


def spelled_out(value: str, field: str) -> bool:
    """sdSpelledOut_: a value said letter by letter, or an e-mail said in words — never taken as written."""
    if SPELLED.search(value):
        return True
    return field == "email" and (re.search(r"\bdot\b|\bat\b", value, re.I) is not None or
                                 re.search(r"\s", s_(value)) is not None)


def adp_judge(reads: L.Reads, q: dict) -> dict[str, Any]:
    """sdAdpJudge_ to the leaf: who called is proven by two keys, the value by the call's own read-back — fail closed,
    never approve what Apps Script would refuse."""
    r = q["row"]
    out: dict[str, Any] = {"state": "refused", "field": "", "value": "", "words": "", "why": "", "uid": "", "name": "",
                           "call_id": call_id_of(r.get("notes")), "proof": "", "value_shape": ""}

    def refuse(why: str) -> dict[str, Any]:
        out["why"] = why
        return out

    desc = s_(r.get("description_of_request"))
    only = ADP_ONLY.search(desc) is not None
    if only and not re.search(r"address|e-?mail|phone", desc, re.I):
        out["state"] = "refused_auto"
        return refuse("ADP only — a person must make this change in ADP.")
    if not out["call_id"]:
        return refuse("No Call ID on the request, so the call cannot be read back.")
    who = s_(r.get("requestor"))
    if not who or who.startswith("*") or name_missing(who):
        return refuse("The caller did not say who they are.")
    line = digits10(r.get("requestor_phone"))
    if not line:
        return refuse("The request carries no caller number.")
    if line in SHARED_LINE_DIGITS:
        return refuse("The call came from a company line, which names nobody.")
    holder = phone_who(reads, r.get("requestor_phone"))
    if holder["state"] != "sole":
        return refuse("The caller's line does not name one person: " + s_(holder.get("why")) + ".")
    if name_key(holder["name"]) != name_key(who):
        return refuse("The caller's line belongs to " + holder["name"] + ", not " + who + ".")
    acct = account_by_name(reads, who)
    if acct is None:
        return refuse("No single live account is called " + who + ".")
    out["uid"] = s_(acct.get("userid"))
    out["name"] = s_(acct.get("displayname"))
    t, skipped = transcript_read(reads, out["call_id"])
    if skipped:
        # an inbox the .gs would read is out of reach here: no verdict of the call's words is safe
        raise JudgeFailed("a transcript inbox is not in the copy, so the call cannot be told from unread")
    if t is None:
        return refuse("No transcript is on file for that call.")
    rb = read_back(t["spoken"], t["full"])
    if not rb or not rb["value"]:
        if only:
            out["state"] = "refused_auto"
            return refuse("ADP only — a person must make this change in ADP.")
        return refuse("The call never read the new value back and heard a yes.")
    if spelled_out(rb["value"], rb["field"]):
        return refuse("The value was spelled out on the call, so it cannot be taken as written.")
    out["field"] = rb["field"]
    out["value_shape"] = rb["field"]
    if rb["field"] == "address":
        if not re.search(r"\d", rb["value"]) or not re.search(r"[a-z]", rb["value"], re.I) or len(rb["value"]) > 200:
            return refuse("The address read back is not a street address.")
        out["value"] = rb["value"]
        out["state"] = "applied"
        out["words"] = "Home address set to " + rb["value"] + " on the platform. ADP still needs the change."
    elif rb["field"] == "email":
        em = rb["value"].lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", em):
            return refuse("The e-mail read back is not a valid address.")
        mails = [s_(acct.get("email")).lower()] + [s_(e).lower() for e in parse_emails(acct.get("emails"))]
        if em in mails:
            return refuse("That e-mail is already on " + out["name"] + "'s account.")
        elsewhere = held_elsewhere(reads, out["uid"], "email", em)
        if elsewhere:
            return refuse("That e-mail is already held elsewhere (" + elsewhere + ").")
        out["value"] = em
        out["state"] = "ready"
        out["words"] = "Add " + em + " to " + out["name"] + "'s e-mails"
    else:
        d = digits10(rb["value"])
        if len(d) != 10:
            return refuse("The phone read back is not a 10-digit US number.")
        if d in SHARED_LINE_DIGITS:
            return refuse("That number is a company line.")
        nums = [digits10(acct.get("phone"))] + [digits10(p.get("number") if isinstance(p, dict) else p)
                                                for p in parse_phones(acct.get("phones"))]
        if d in nums:
            return refuse("That phone is already on " + out["name"] + "'s account.")
        elsewhere = held_elsewhere(reads, out["uid"], "phone", d)
        if elsewhere:
            return refuse("That phone is already held elsewhere (" + elsewhere + ").")
        out["value"] = "(" + d[:3] + ") " + d[3:6] + "-" + d[6:]
        out["state"] = "ready"
        out["words"] = "Add " + out["value"] + " to " + out["name"] + "'s phones"
    out["proof"] = sha10(out["uid"] + "|" + out["field"] + "|" + out["value"])
    return out


def adp_held(reads: L.Reads, d: dict) -> bool:
    """sdAdpHeld_: the account already holds the prepared e-mail or phone — the same proof over what it holds."""
    uid, field, proof = s_(d.get("uid")), s_(d.get("field")), s_(d.get("proof"))
    if not uid or not proof or field not in ("email", "phone"):
        return False
    u = account(reads, uid)
    if u is None:
        return False
    if field == "email":
        held = [s_(u.get("email")).lower()] + [s_(e).lower() for e in parse_emails(u.get("emails"))]
    else:
        held = []
        for n in [u.get("phone")] + [p.get("number") if isinstance(p, dict) else p
                                     for p in parse_phones(u.get("phones"))]:
            dd = digits10(n)
            held.append("(" + dd[:3] + ") " + dd[3:6] + "-" + dd[6:] if len(dd) == 10 else "")
    return any(v and sha10(uid + "|" + field + "|" + v) == proof for v in held)


def adp_of(reads: L.Reads, ev: dict, decs: list[dict]) -> dict[str, Any]:
    """sdAdpOf_ with the switch on: the ADP block of a queue row, from its event and the decisions on its ref."""
    d = obj_(ev.get("details"))
    state = s_(d.get("state")) or "refused"
    why = s_(d.get("why"))
    approved = None
    for x in decs:
        v = s_(x.get("verdict"))
        if v == "applied":
            state = "applied"
        elif v == "undone":
            state = "undone"
        elif v == "approved":
            approved = x
    # an e-mail or phone is saved on the person's profile, never here: it reads as applied once the account holds it
    if state == "ready" and adp_held(reads, d):
        state = "applied"
    elif state == "ready" and approved:
        why = "Approved by " + (s_(approved.get("by_name")) or "a director") + \
            " — the account changes when Save is pressed on the profile."
    return {"state": state, "field": s_(d.get("field")), "words": s_(d.get("words")),
            "proof": s_(d.get("proof")) if state == "ready" else "", "why": why}


def adp_open(j: dict) -> dict[str, Any]:
    """sdAdpOpen_."""
    add = "add_email" if j["field"] == "email" else "add_phone"
    return {"uid": j["uid"], "field": j["field"], "value": j["value"],
            "href": "/app/users/profile?u=" + quote(j["uid"]) + "&contacts=1&" + add + "=" + quote(j["value"])}


def adp(sess: L.Session, payload: dict) -> Decision:
    """supportDeskAdp: approve an ADP change the call proves (its proof checked again to the leaf), or undo an
    address the platform applied; the approval kept in app.edits, the account itself saved by the profile's own Save."""
    p = payload if isinstance(payload, dict) else {}
    reads, user = sess.reads, sess.user
    g = gate(sess)
    if not g.get("open"):
        return Decision(closed())
    if not user or user.get("is_service") or visiting(user):
        return W.refuse(403, OWN_ACCOUNT)
    by_edition = not (g["is_director"] or g["is_master"]) and W.edition_allows(sess, EDITION["requests"])
    if not (g["is_director"] or g["is_master"] or by_edition):
        return W.refuse(403, "Only the directors decide requests.")
    ref = text_(p.get("ref"), 40)
    op = text_(p.get("op"), 10).lower()
    proof = text_(p.get("proof"), 20).upper()
    if not ADP_REF.match(ref):
        return W.refuse(400, "Which request? The ref is missing.")
    if op not in ("approve", "undo"):
        return W.refuse(400, "Approve or undo the change.")
    try:
        ev = event_by_id(reads, "SE" + sha10("adp|" + ref))
        decs = decisions_by_ref(reads).get(ref) or []
        entries = queue_entries(reads)
        q = next((x for x in entries or [] if x["ref"] == ref), None)
    except Defer as exc:
        return W.refuse(503, READ_FAIL.format(str(exc)[:240]))
    if entries is None:
        return W.refuse(503, READ_FAIL.format("the Support Queue book could not be read"))
    if ev is None or q is None:
        return W.refuse(404, "That request is not on the queue any more.", fresh=books(reads))
    state = adp_of(reads, ev, decs)
    if op == "undo":
        return adp_undo(sess, ref, state, g, by_edition)
    if state["state"] == "applied":
        return Decision({"status": 200, "data": {"ok": True, "changed": False, "said": "Already applied.",
                                                 "row": None}})
    if state["state"] != "ready":
        return W.refuse(400, "There is nothing waiting for approval on this request.")
    d = obj_(ev.get("details"))
    if not proof or proof != s_(d.get("proof")):
        return W.refuse(409, "The change in front of you is no longer the one on file — reopen it.")
    try:
        j = adp_judge(reads, q)
    except JudgeFailed as exc:
        return W.refuse(503, "The call could not be read again just now (" + str(exc)[:240] +
                      ") — nothing was changed.")
    if j["state"] != "ready" or j["proof"] != proof:
        return W.refuse(409, "The change in front of you is no longer the one on file — reopen it." +
                      (" " + j["why"] if j["why"] else ""))
    final = final_of(decs)
    by = (s_(final.get("by_name")) or "someone") if final else ""
    if final and s_(final.get("verdict")) != "approved":
        return W.refuse(409, "Already " + s_(final.get("verdict")) + " by " + by + " at " +
                        stamp_words(final.get("at")) + ".")
    if final:
        return Decision({"status": 200, "data": {"ok": True, "changed": False,
                                                 "said": "Already approved by " + by + " — save it on " + j["name"] +
                                                         "'s profile.",
                                                 "row": None, "open": adp_open(j)}})
    edition = EDITION["requests"] if by_edition else ""
    W.gate(reads)
    try:
        # the approval is recorded here; the account itself is written only by the profile's own Save (userUpdate)
        dec = decision_row(reads, ref=ref, source="queue", verdict="approved",
                           note=j["words"] + " — saved on the profile.", by_uid=g["uid"], by_name=g["name"],
                           via="support-desk",
                           witness={"row": q["book_row"] or 0, "requestor": s_(q["row"].get("requestor")),
                                    "type": s_(q["row"].get("type_of_request")), "call_id": j["call_id"],
                                    "date_received": when_of(q["row"].get("date_received"))})
        edits = [decision_record(reads, dec, ref, edition)]
        edits += seats_close(reads, ref, "approved", g["name"], iso_now(reads), edition, guarded=True)
    except Defer as exc:
        return W.refuse(503, WRITE_FAIL.format(str(exc)[:240]))
    said = "Approved. " + j["name"] + "'s profile opens with the new " + \
        ("e-mail" if j["field"] == "email" else "phone") + " filled in — Save there adds it."
    log.info("supportDeskAdp %s %s approved for %s", ref, j["field"], j["uid"])
    answer = {"status": 200, "data": {"ok": True, "changed": True, "said": said, "row": None, "open": adp_open(j)}}
    return kept(answer, edits, ref, books(reads), edition)


def adp_undo(sess: L.Session, ref: str, state: dict, g: dict, by_edition: bool) -> Decision:
    """sdAdpUndo_: only an address the platform applied is undone here; the verdict kept in app.edits."""
    reads = sess.reads
    if state["state"] == "undone":
        return Decision({"status": 200, "data": {"ok": True, "changed": False, "said": "Already undone.",
                                                 "row": None}})
    if state["state"] != "applied" or state["field"] != "address":
        return W.refuse(400, "An added e-mail or phone is removed on the person's profile."
                        if state["state"] == "applied" else "Nothing was applied on this request.")
    edition = EDITION["requests"] if by_edition else ""
    W.gate(reads)
    try:
        dec = decision_row(reads, ref=ref, source="queue", verdict="undone", note="address", by_uid=g["uid"],
                           by_name=g["name"], via="support-desk")
        edits = [decision_record(reads, dec, ref, edition)]
    except Defer as exc:
        return W.refuse(503, WRITE_FAIL.format(str(exc)[:240]))
    answer = {"status": 200, "data": {"ok": True, "changed": True,
                                      "said": "Undone. The address on the platform is the one before this request.",
                                      "row": None}}
    log.info("supportDeskAdp %s undo", ref)
    return kept(answer, edits, ref, books(reads), edition)


# ---- supportInboxAnswer (gated by the seat, never by the app) ------------------------------------------------------

def source_of_ref(ref: str) -> str:
    """sdSourceOfRef_."""
    if ref.startswith("SF"):
        return "scheduling"
    if ref.startswith("SE"):
        return "event"
    return "queue"


def inbox_answer(sess: L.Session, payload: dict) -> Decision:
    """supportInboxAnswer: mark a My Inbox item aware or seen — the session's own account must be its recipient."""
    user = sess.user
    if not user or user.get("is_service"):
        return Decision(closed())
    if visiting(user):
        return W.refuse(403, OWN_ACCOUNT)
    me = acting_id(user)
    if not me:
        return Decision(closed())
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    item_id = text_(p.get("item_id"), 20)
    word = text_(p.get("word"), 10).lower()
    if not ITEM_ID.match(item_id):
        return W.refuse(400, "Which item? The item id is missing.")
    if word not in ("aware", "seen"):
        return W.refuse(400, "Mark it as aware or seen.")
    name = actor_name(user)
    try:
        item = next((r for r in tab_rows(reads, TABS["inbox"]) if s_(r.get("id")) == item_id), None)
    except Defer as exc:
        return W.refuse(503, WRITE_FAIL.format(str(exc)[:240]))
    if item is None:
        return W.refuse(404, "This item is not here any more.", fresh=books(reads))
    if s_(item.get("to_uid")) != me:
        return W.refuse(403, "This item is waiting on someone else.")
    if s_(item.get("box")) == WORK_BOX:
        return W.refuse(400, "A redirected request is answered in My Work.")
    if s_(item.get("answered_at")):
        return Decision({"status": 200, "data": {"ok": True, "changed": False,
                                                 "said": "Already marked by " +
                                                         (s_(item.get("answered_by")) or "someone") + ".",
                                                 "state": item.get("state") or ""}}, fresh=books(reads))
    want = "seen" if s_(item.get("kind")) == "info" else "aware"
    if word != want:
        return W.refuse(400, "This one is marked as " + want + ".")
    W.gate(reads)
    ref = s_(item.get("ref"))
    if want == "aware":
        try:
            res, edits = aware_locked(reads, ref, source_of_ref(ref), me, name, "my-inbox")
        except Defer as exc:
            return W.refuse(503, WRITE_FAIL.format(str(exc)[:240]))
        answer = {"status": 200, "data": {"ok": True, "changed": True,
                                          "said": "Marked — you are aware." if res["changed"] else res["said"],
                                          "state": "aware"}}
        return kept(answer, edits, ref, books(reads))
    now_it = {**item, "answered_by": name, "answered_at": iso_now(reads), "state": "seen"}
    rec = item_record(reads, item, now_it, ref)
    answer = {"status": 200, "data": {"ok": True, "changed": True, "said": "Marked as seen.", "state": "seen"}}
    return kept(answer, [rec] if rec else [], ref, books(reads))


# ---- supportDeskSettingsSet (the master's; a support.settings edition beside) --------------------------------------

def settings_record(sid: str, tab: str, row: dict, was: dict | None, edition: str) -> dict[str, Any] | None:
    """A setting upserted by its key (sdUpsert_ over the key column), kept in app.edits."""
    header = HEADERS["support_settings"]
    if was is None:
        return W.kept_record(sid, tab, "append", "cols:key", row["key"], "settings",
                             {h: row.get(h, "") for h in header}, edition=edition)
    cells = {h: row.get(h, "") for h in header if s_(row.get(h)) != s_(was.get(h))}
    if not cells:
        return None
    return W.kept_record(sid, tab, "edit", "cols:key", row["key"], "settings", cells,
                         before={h: was.get(h, "") for h in cells}, edition=edition)


def settings_answer(kv: dict[str, str]) -> dict[str, Any]:
    """sdSettings_'s public shape over the keys as saved."""
    values = {k: s_(kv.get(k)) or SETTING_DEFAULTS[k] for k in ("directors", "leads", "payroll_to")}
    routes = json_(kv.get("routes"), None)
    if isinstance(routes, dict):
        out = {rk: [s_(x) for x in v if s_(x)] for rk, v in routes.items() if isinstance(v, list)}
    else:
        out = ROUTES_DEFAULT
    return {"directors": values["directors"], "leads": values["leads"], "payroll_to": values["payroll_to"],
            "routes": out}


def settings_set(sess: L.Session, payload: dict) -> Decision:
    """supportDeskSettingsSet: the master's own door — the leads, payroll_to, routes and directors, kept in app.edits;
    a support.settings edition beside, like the other doors' settings."""
    user = sess.user
    reads = sess.reads
    g = gate(sess)
    master = sc.is_real_master(user) and not visiting(user)
    by_edition = not master and bool(g.get("open")) and W.edition_allows(sess, EDITION["settings"])
    if not master and not by_edition:
        return Decision(closed())
    p = payload if isinstance(payload, dict) else {}
    values = p.get("values") if isinstance(p.get("values"), dict) else {}
    keys = [k for k in values if k in SETTABLE]
    if not keys:
        return W.refuse(400, "Nothing to save: only " + ", ".join(SETTABLE) + " are set here.")
    now, by = iso_now(reads), actor_name(user)
    rows: list[dict[str, str]] = []
    refused: list[str] = []
    for k in keys:
        v = values[k]
        if k == "routes":
            obj = v if isinstance(v, dict) else json_(v, None)
            ok = isinstance(obj, dict) and all(isinstance(t, list) and all(isinstance(x, str) and s_(x) for x in t)
                                               for t in obj.values())
            if not ok:
                refused.append("routes must map each route to a list of request types")
                continue
            rows.append({"key": k, "value": json_text(obj), "note": "", "updated_at": now, "updated_by": by})
            continue
        got = resolve_emails(reads, v)
        if not got["list"] or got["missed"]:
            refused.append(k + ": " + (got["why"] or "no live account"))
            continue
        rows.append({"key": k, "value": ", ".join(x["email"] for x in got["list"]), "note": "", "updated_at": now,
                     "updated_by": by})
    if refused:
        return W.refuse(400, "Nothing was saved — " + "; ".join(refused) + ".")
    edition = "" if master else EDITION["settings"]
    W.gate(reads)
    try:
        sid, tab = where(reads, TABS["settings"])
        held = {r["key"]: r for r in tab_rows(reads, TABS["settings"])}
    except Defer as exc:
        return W.refuse(503, "The settings could not be written (" + str(exc)[:240] + ") — nothing was changed.")
    edits = []
    for r in rows:
        rec = settings_record(sid, tab, r, held.get(r["key"]), edition)
        if rec:
            edits.append(rec)
    kv = {r["key"]: r["value"] for r in held.values()}
    kv.update({r["key"]: r["value"] for r in rows})
    log.info("supportDeskSettingsSet %s", ",".join(keys))
    answer = {"status": 200, "data": {"ok": True, "settings": settings_answer(kv)}}
    return kept(answer, edits, "settings", books(reads), edition)


# ---- the doors -----------------------------------------------------------------------------------------------------

ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "supportDeskDecide": decide, "supportDeskAdp": adp, "supportInboxAnswer": inbox_answer,
    "supportDeskSettingsSet": settings_set,
}
_ROLES = ("admin", "director", "manager", "staff")
# HUB_POLICY: the roles each write is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "supportDeskDecide": {"roles": _ROLES,
                          "params": {"ref": "string", "verdict": "string", "note": "string", "to": "string"}},
    "supportDeskAdp": {"roles": _ROLES, "params": {"ref": "string", "op": "string", "proof": "string"}},
    "supportInboxAnswer": {"roles": _ROLES, "params": {"item_id": "string", "word": "string"}},
    "supportDeskSettingsSet": {"roles": _ROLES, "params": {"values": "object"}},
}
# sdLock_'s own sentence for its own lock
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.support_desk_writes and app.support_desk_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="support_desk", label="Support Requests")
