"""Support Requests (apps-script/SupportDesk.gs) read off asa-hub-db: the board as one viewer sees it
(supportDeskList) and one redirected request as its holder sees it (supportDeskSeat). Read-only — the verdicts, the
ADP change, the inbox answers, the settings save and My Calendar's vacation filing are support_desk_writes' own, kept in
Postgres as the truth; the punch door is app/support_punch.py's and the hooks stay Apps Script's. Every call reads
fresh (no sd_list_v cache): the four houses, the estate Support Queue (the hotline lane, as server/my_work.py reads
it, with its _support_key), Scheduling's own
houses through app/scheduling.py's readers, the calls house, the users directory and the Settings › My Work
switches. Where the code being ported catches a failure and says it in words, this port says it too; a copy that
cannot say what Apps Script would read (hubdb.Unreadable, scope.Defer) is never swallowed — the relay asks Apps
Script instead."""
from __future__ import annotations

import copy
import functools
import json
import math
import re
import urllib.parse
from datetime import date, datetime
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import my_work as MW
import scheduling as SCH
import scope as sc
import smart_comms_desk as SCD
import staff as SP
import staff_perf as SPF
from gsjs import SheetDate
from scope import Defer

APP_ID = "support-desk"
# Settings › Editions: the people who decide the board's requests beside the directors and the master
EDITION_REQUESTS = "support.requests"
TABS = {"events": "support_events", "decisions": "support_decisions", "inbox": "support_inbox",
        "settings": "support_settings"}
UNKNOWN = "Unknown action."
ROLES = ("admin", "director", "manager", "staff")

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
WEEKDAYS = ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
ROUTE_ORDER = ("vehicle", "payroll", "general", "adp_update")
ROUTES_DEFAULT = {
    "vehicle": ["Operations - Vehicle Issue", "Operations - Transportation", "Operations - Transportation Request",
                "Van Calendar"],
    "payroll": ["ADP - Pay Stubs", "Payroll", "PSI - Time Entries", "Finances - Request for Pay Stubs", "Pay Stubs"],
    "general": ["Other - General Requests"],
    "adp_update": ["ADP - Update Information"]}
SETTING_DEFAULTS = {"directors": "ty.bond@abrighterdawninc.com, brittfrench1316@gmail.com",
                    "leads": "arthur.torres@asalifecare.com, admin@abrighterdawninc.com",
                    "payroll_to": "ty.bond@abrighterdawninc.com"}
FINAL = {"approved": "Approved", "denied": "Denied", "resolved": "Resolved"}
STAFF_ROLES = ("admin", "director", "manager", "staff")
WORK_BOX = "work"
SEAT_REF = re.compile(r"^(HQ|SE)[0-9A-F]{10}(-\d+)?$")
WARNING_KINDS = frozenset({"late_show", "no_call", "punch"})
SCHED_KINDS = frozenset({"call_off", "phone", "request_off", "time_off", "swap", "take"})
SCHED_WAITING = frozenset({"waiting", "waiting_staff", "waiting_manager", "waiting_director"})
SCHED_CLOSED = frozenset({"approved", "approved_future", "declined", "expired", "withdrawn", "cancelled", "done",
                          "covered", "stopped"})
SCHED_STATE_WORDS = {"approved": ("Approved", "approved"), "approved_future": ("Approved", "approved"),
                     "declined": ("Declined", "denied"), "expired": ("Expired", "closed"),
                     "withdrawn": ("Withdrawn", "closed"), "cancelled": ("Cancelled", "closed"),
                     "done": ("Done", "resolved"), "covered": ("Covered", "resolved"),
                     "stopped": ("Stopped", "closed"), "needs_human": ("Needs a person", "warning"),
                     "outreach_1": ("Looking for cover", "pending"), "outreach_wait": ("Looking for cover", "pending"),
                     "outreach_2": ("Looking for cover", "pending")}
WATCH_BADGES = ("ADMIN", "ADMINISTRATOR", "DIRECTOR")
# SupportDeskSwitches.gs MYWORK_AUTO_KEYS: Settings › My Work's Support Requests switches
AUTO_KEYS = {"late_show": "mywork_auto_sr_late_show", "no_call": "mywork_auto_sr_no_call_no_show",
             "punch": "mywork_auto_sr_punch_missing", "incident": "mywork_auto_sr_incident",
             "general": "mywork_auto_sr_general_requests", "vehicle": "mywork_auto_sr_vehicle",
             "payroll": "mywork_auto_sr_payroll", "adp_update": "mywork_auto_sr_adp_update",
             "time_off": "mywork_auto_sr_time_off"}
# AlertsCatalog.gs: the catalogue house and its shipped word on the nine switches (all plainly off)
CATALOG_TAB = "hiring_alerts_catalog"
AUTO_SHIPPED = "no"
COMM_CALLS_TAB = "comm_calls"
QUEUE_LANE = "supportQueue"
# Hotline.gs: the call-off type and the type-key machinery sdRouteOf_/sdIsCallOff_ compare by
HOTLINE_CALL_OFF_TYPE = "Schedule - Call Off"
HOTLINE_REQUEST_AREAS = ("Admin", "ADP", "Finances", "Operations", "PSI", "Safety", "Schedule", "Training", "Other")
HOTLINE_CALL_OFF_WORDS = frozenset({"calloff", "calledoff", "callingoff", "callsoff",
                                    "callout", "calledout", "callingout", "callsout"})

OHIO = MW.OHIO
UTC = MW.UTC


# ---- small values --------------------------------------------------------------------------------------------------

def sd_str(v: Any) -> str:
    """sdStr_."""
    return gsjs.trim(gsjs.or_blank(v))


def sd_err(e: BaseException) -> str:
    """sdErr_: the message, cut."""
    return (str(e) or type(e).__name__ or "unknown error")[:240]


def refuse(status: int, message: str) -> dict[str, Any]:
    """sdRefuse_."""
    return {"status": status, "message": message}


def now_iso(reads: L.Reads) -> str:
    """sdIso_(sdNowMs_())."""
    return gsjs.iso(reads.now)


def jjson(raw: Any, fallback: Any) -> Any:
    """sdJson_: an object passes through; text is parsed; only an object (or a list) stands."""
    if isinstance(raw, (dict, list)):
        return raw
    try:
        v = json.loads(gsjs.or_blank(raw))
    except (ValueError, RecursionError):
        return fallback
    return v if isinstance(v, (dict, list)) else fallback


def sha10(text: str) -> str:
    """sdSha10_ (server/my_work.py _sha10)."""
    return MW._sha10(text)


def name_fold(v: Any) -> str:
    """hubNameFold_."""
    return SCH.name_fold(v)


def sd_first(name: Any) -> str:
    """sdFirst_."""
    parts = sd_str(name).split()
    return parts[0] if parts else ""


def mask_phones(text: Any) -> str:
    """sdMaskPhones_."""
    return re.sub(r"\+?\d[\d\s().-]{6,}\d", "[number]", gsjs.or_blank(text))


def digits10(v: Any) -> str:
    """sdDigits10_."""
    d = re.sub(r"\D", "", gsjs.or_blank(v))
    return re.sub(r"^1(?=\d{10}$)", "", d)


def _js_get(v: Any, k: str) -> Any:
    """v && v[k]: the falsy value itself, else the key of a dict (JS undefined → None)."""
    if not v and not isinstance(v, dict):
        return v
    return v.get(k) if isinstance(v, dict) else None


def uri(s: str) -> str:
    """encodeURIComponent."""
    if any(0xD800 <= ord(ch) <= 0xDFFF for ch in s):
        raise Defer("a ref JavaScript refuses to encode")
    return urllib.parse.quote(s, safe="!'()*-._~")


# ---- time, as the screens and the queue's own key read it (server/my_work.py's twins of sdInstantMs_/sdDayOf_) ----

def day_text(v: Any) -> str:
    """sdDayOf_: an instant's Ohio day, an ISO day, a sheet's M/D/YYYY; '' when none."""
    d = MW.day_of(v)
    return d.isoformat() if d else ""


def when_of(v: Any) -> str:
    """sdWhenOf_: an instant as UTC ISO to the second, a day as YYYY-MM-DD, '' when unreadable."""
    return MW.when_of(v)


def utc_minute(v: Any) -> str:
    """sdUtcMinute_."""
    at = MW._instant(v)
    return at.astimezone(UTC).strftime("%Y-%m-%dT%H:%MZ") if at is not None else ""


def day_words(iso: Any) -> str:
    """sdDayWords_: 'Thu 10/1' for an ISO day; the text as it came when it is not one."""
    s = sd_str(iso)
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s)
    if not m:
        return s
    try:
        d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return s
    return f"{WEEKDAYS[(d.weekday() + 1) % 7]} {d.month}/{d.day}"


def stamp_words(v: Any) -> str:
    """sdStampWords_: 'Sep 18, 2026 2:24 PM' in Ohio for an instant, 'Sep 18, 2026' for a day, else the text."""
    at = MW._instant(v)
    day = at.astimezone(OHIO).date() if at is not None else MW.day_of(v)
    if day is None:
        return gsjs.text(v, 60)
    words = f"{MONTHS[day.month - 1]} {day.day}, {day.year}"
    if at is not None:
        local = at.astimezone(OHIO)
        words += f" {local.hour % 12 or 12}:{local.minute:02d} {'AM' if local.hour < 12 else 'PM'}"
    return words


def clock_words(iso: Any) -> str:
    """sdClockWords_."""
    at = MW._instant(iso)
    if at is None:
        return ""
    local = at.astimezone(OHIO)
    return f"{local.hour:02d}:{local.minute:02d}"


# ---- the type key and the routes (Hotline.gs) -----------------------------------------------------------------------

def type_norm(raw: Any) -> str:
    """hotlineRequestTypeNorm_."""
    s = re.sub("[ \t\u00a0\u2007\u202f]+", " ", gsjs.or_blank(raw))
    s = re.sub(" *[\u2012\u2013\u2014\u2015\u2212] *", " - ", s)
    s = re.sub(r" +- *| *- +", " - ", s)
    s = gsjs.trim(re.sub(r"[ .;,]+$", "", s))
    if not s:
        return ""
    m = re.match(r"^([A-Za-z]+) *[-:]+ *(\S.*)$", s)
    if m:
        for a in HOTLINE_REQUEST_AREAS:
            if a.lower() == m.group(1).lower():
                return a + " - " + m.group(2)
    return s


def type_word(w: str) -> str:
    """hotlineRequestTypeWord_."""
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not re.search(r"(?:ss|us|is)$", w):
        return w[:-1]
    return w


def type_key(raw: Any) -> str:
    """sdTypeKey_ (hotlineRequestTypeKey_)."""
    t = type_norm(raw).lower()
    cut = t.find(" - ")
    half = lambda s: "".join(type_word(w) for w in re.split(r"[^a-z0-9]+", s) if w)  # noqa: E731
    return half(t) if cut == -1 else half(t[:cut]) + " - " + half(t[cut + 3:])


def call_off_words(raw: Any) -> bool:
    """hotlineRequestTypeCallOffWords_."""
    words = [w for w in re.split(r"[^a-z]+", gsjs.or_blank(raw).lower().replace("0", "o")) if w]
    grams = []
    for i, w in enumerate(words):
        grams.append(w)
        if i + 1 < len(words):
            grams.append(w + words[i + 1])
    return any(re.sub(r"s$", "", g) in HOTLINE_CALL_OFF_WORDS for g in grams)


def call_offish(raw: Any) -> bool:
    """hotlineRequestTypeCallOffish_."""
    t = type_norm(raw)
    if re.search(r"\bcall(?:ed|ing|s)?[\s-]*(?:off|out)s?\b|\bcall(?:off|out)s?\b", t, re.I):
        return True
    return call_off_words(t)


def is_call_off(raw: Any) -> bool:
    """sdIsCallOff_."""
    if not sd_str(raw):
        return False
    try:
        if type_key(raw) == type_key(HOTLINE_CALL_OFF_TYPE):
            return True
        return call_offish(raw)
    except Exception:  # noqa: BLE001 - the .gs fallback
        return bool(re.search(r"call[\s-]*off", gsjs.or_blank(raw), re.I))


def route_of(raw: Any, routes: dict | None) -> str:
    """sdRouteOf_: the first route whose list holds this type, by the hotline's own type key; '' when none."""
    r = routes or ROUTES_DEFAULT
    k = type_key(raw)
    if not k:
        return ""
    order = list(ROUTE_ORDER) + [x for x in r if x not in ROUTE_ORDER]
    for route in order:
        for t in (r.get(route) or []):
            if type_key(t) == k:
                return route
    return ""


def urgency(v: Any) -> str:
    """sdUrgency_."""
    s = sd_str(v)
    if re.match(r"^(mid|medium)$", s, re.I):
        return "Medium"
    return s[:1].upper() + s[1:] if s else ""


def type_parts(raw: Any) -> dict[str, str]:
    """sdTypeParts_: 'Area - Label' → {raw, area, label, display: 'Area · Label'}."""
    s = sd_str(raw)
    if not s:
        return {"raw": "", "area": "", "label": "Other", "display": "Other"}
    cut = s.find(" - ")
    if cut == -1:
        return {"raw": s, "area": "", "label": s, "display": s}
    area, label = gsjs.trim(s[:cut]), gsjs.trim(s[cut + 3:])
    return {"raw": s, "area": area, "label": label, "display": area + " · " + label}


def type_of_category(cat: Any) -> dict[str, str]:
    """sdTypeOfCategory_: a category the platform wrote ('Attendance · Late Show') as a type."""
    s = sd_str(cat)
    cut = s.find(" · ")
    if cut == -1:
        return type_parts(s)
    return {"raw": s, "area": gsjs.trim(s[:cut]), "label": gsjs.trim(s[cut + 3:]), "display": s}


# ---- the houses (one Data tab each) ---------------------------------------------------------------------------------

class HouseRead(RuntimeError):
    """The .gs sentence for a house that is not set up; caught per source, as sdRead_'s throw is."""


def _cell(v: Any) -> str:
    """sdCellText_ off the copy's text: a Date as cellText_, anything else String().trim()."""
    t = hubdb.typed(v, "hub")
    if isinstance(t, SheetDate):
        return gsjs.trim(gsjs.or_blank(hubdb.cell_text(t)))
    return gsjs.trim(gsjs.js_str(t))


def read_house(reads: L.Reads, tab: str) -> list[dict]:
    """sdRead_: every row of a Support Requests house, header-keyed, in sheet order; a blank id is no row. A house kept
    in its own table (house_tables) is read there."""
    def read() -> list[dict]:
        db = reads.db
        idf = "key" if tab == TABS["settings"] else "id"
        if HT.tabled(tab):
            heads, rows = HT.raw(reads, tab)
            return [row for row in ({h: _cell(raw.get(h)) for h in heads} for _rn, raw in rows) if row.get(idf)]
        if not db.house_moved(tab):
            raise HouseRead(f'The Support Requests house "{tab}" could not be read: The Support Requests house '
                            f'"{tab}" is not set up (no pointer, or moved.{tab} is not on).')
        res = db.resolve(tab)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the Support Requests house {tab}")
            return []
        heads = [gsjs.trim(gsjs.or_blank(h)) for h in res.ref.headers]
        out = []
        for _rn, raw in db.rows(res.ref):
            row = {h: _cell(raw.get(src)) for h, src in zip(heads, res.ref.headers) if h}
            if row.get(idf):
                out.append(row)
        return out
    return reads.once("sd:tab:" + tab, read)


def events_(reads: L.Reads) -> list[dict]:
    """sdEvents_: the events, first row of an id wins."""
    def read() -> list[dict]:
        seen, out = set(), []
        for e in read_house(reads, TABS["events"]):
            if e["id"] in seen:
                continue
            seen.add(e["id"])
            out.append(e)
        return out
    return reads.once("sd:events", read)


def decs_by_ref(reads: L.Reads) -> dict[str, list[dict]]:
    """sdDecisionsByRef_."""
    def read() -> dict[str, list[dict]]:
        by: dict[str, list[dict]] = {}
        for d in read_house(reads, TABS["decisions"]):
            by.setdefault(d.get("ref", ""), []).append(d)
        return by
    return reads.once("sd:decs", read)


def items_by_ref(reads: L.Reads) -> dict[str, list[dict]]:
    """sdItemsByRef_."""
    def read() -> dict[str, list[dict]]:
        by: dict[str, list[dict]] = {}
        for it in read_house(reads, TABS["inbox"]):
            by.setdefault(it.get("ref", ""), []).append(it)
        return by
    return reads.once("sd:items", read)


# ---- settings and people ---------------------------------------------------------------------------------------------

def settings_(reads: L.Reads) -> dict[str, Any]:
    """sdSettings_: the settings house over the shipped defaults; not set up → defaults, unreadable → said."""
    def read() -> dict[str, Any]:
        db = reads.db
        out: dict[str, Any] = {"readable": True, "set_up": db.house_moved(TABS["settings"]), "why": "",
                               "values": {}, "routes": None, "routes_why": ""}
        kv: dict[str, str] = {}
        if out["set_up"]:
            try:
                for r in read_house(reads, TABS["settings"]):
                    kv[r["key"]] = r.get("value", "")
            except hubdb.Unreadable:
                raise
            except Exception as e:  # noqa: BLE001 - sdSettings_ says it and reads the defaults
                out["readable"] = False
                out["why"] = sd_err(e)
        for k in ("directors", "leads", "payroll_to"):
            out["values"][k] = sd_str(kv.get(k)) or SETTING_DEFAULTS[k]
        routes = jjson(kv.get("routes"), None)
        if isinstance(routes, dict):
            out["routes"] = {rk: [x for x in (sd_str(y) for y in rv) if x]
                             for rk, rv in routes.items() if isinstance(rv, list)}
        else:
            if sd_str(kv.get("routes")):
                out["routes_why"] = "The routes setting is not readable JSON — the shipped routes are used."
            out["routes"] = ROUTES_DEFAULT
        return out
    return reads.once("sd:settings", read)


def resolve_emails(reads: L.Reads, csv: Any) -> dict[str, Any]:
    """sdResolveEmails_: e-mails → live accounts, the way the sign-in door finds them (merged rows never answer)."""
    emails = [e for e in (x.strip().lower() for x in re.split(r"[,;\s]+", sd_str(csv))) if e.find("@") > 0]
    out: dict[str, Any] = {"list": [], "missed": [], "why": ""}
    seen: set[str] = set()
    for email in emails:
        try:
            u = SPF.user_by_email(reads, email)
        except hubdb.Unreadable:
            raise
        except Exception:  # noqa: BLE001 - sdResolveEmails_ reads a failed lookup as a miss
            u = None
        if u and SCH.live(u):
            uid = sd_str(u.get("userid"))
            if uid not in seen:
                out["list"].append({"uid": uid, "name": sd_str(u.get("displayname")) or email, "email": email})
            seen.add(uid)
        else:
            out["missed"].append(email)
    if not emails:
        out["why"] = "no e-mail is written"
    elif out["missed"]:
        out["why"] = "no live account answers " + ", ".join(out["missed"])
    return out


def directors_(reads: L.Reads) -> dict[str, Any]:
    """sdDirectors_: ONE LIST WITH SCHEDULING — its directors when readable, the Support Requests setting else."""
    def read() -> dict[str, Any]:
        try:
            sched = SCH.directors(reads)
        except hubdb.Unreadable:
            raise
        except Exception as e:  # noqa: BLE001 - the house not set up reads as not readable (sdDirectors_)
            sched = {"readable": False, "list": [], "why": sd_err(e)}
        if sched and sched.get("readable") and sched.get("list"):
            return {"readable": True, "from": "scheduling", "why": "",
                    "list": [{"uid": sd_str(d.get("uid")), "name": sd_str(d.get("name")),
                              "email": sd_str(d.get("email"))} for d in sched["list"]]}
        st = settings_(reads)
        got = resolve_emails(reads, st["values"]["directors"]) if st["readable"] \
            else {"list": [], "missed": [], "why": st["why"]}
        if got["list"]:
            return {"readable": True, "from": "support", "list": got["list"],
                    "why": "Directors from Support Requests settings — Scheduling's list could not be read" +
                           (" (and " + got["why"] + ")" if got["missed"] else "") + "."}
        return {"readable": False, "from": "", "list": [],
                "why": "Nobody can decide right now: Scheduling's directors could not be read (" +
                       sd_str((sched or {}).get("why")) + ") and the Support Requests settings name no live "
                       "director (" + sd_str(got.get("why")) + ")."}
    return reads.once("sd:dirs", read)


def people_(reads: L.Reads, which: str) -> dict[str, Any]:
    """sdPeople_."""
    def read() -> dict[str, Any]:
        st = settings_(reads)
        return resolve_emails(reads, st["values"][which]) if st["readable"] \
            else {"list": [], "missed": [], "why": st["why"]}
    return reads.once("sd:people:" + which, read)


def leads_(reads: L.Reads) -> dict[str, Any]:
    """sdLeads_."""
    return people_(reads, "leads")


def accounts_(reads: L.Reads) -> dict[str, list[dict]] | None:
    """sdAccounts_: live accounts by display-name fold; None when the accounts cannot be read."""
    def read() -> dict[str, list[dict]] | None:
        try:
            by_key: dict[str, list[dict]] = {}
            for u in reads.users():
                if not SCH.live(u):
                    continue
                k = name_fold(u.get("displayname"))
                if k:
                    by_key.setdefault(k, []).append(u)
            return by_key
        except hubdb.Unreadable:
            raise
        except Exception:  # noqa: BLE001 - sdAccounts_ catches
            return None
    return reads.once("sd:accounts", read)


def account_by_name(reads: L.Reads, name: Any) -> dict | None:
    """sdAccountByName_: the one live account a name folds to; None when none, two or unreadable."""
    all_ = accounts_(reads)
    k = name_fold(name)
    hits = (all_.get(k) or []) if all_ and k else []
    return hits[0] if len(hits) == 1 else None


def uid_by_name(reads: L.Reads, name: Any) -> str:
    """sdUidByName_."""
    u = account_by_name(reads, name)
    return sd_str(u.get("userid")) if u else ""


def user_by_uid(reads: L.Reads, uid: Any) -> dict | None:
    """sdUserByUid_."""
    want = sd_str(uid)
    if not want:
        return None
    try:
        return next((u for u in reads.users() if sd_str(u.get("userid")) == want and SCH.live(u)), None)
    except hubdb.Unreadable:
        raise
    except Exception:  # noqa: BLE001 - sdUserByUid_ catches
        return None


# ---- the switches (Settings › My Work) and test mode -----------------------------------------------------------------

def auto_defaults(reads: L.Reads) -> dict[str, str]:
    """hubMyWorkHideDefaults_ for the nine switches: the catalogue's default_value, the shipped word when the
    catalogue cannot answer (its rows merge over the shipped copy, a blank cell keeps the shipped one)."""
    def read() -> dict[str, str]:
        out = {key: AUTO_SHIPPED for key in AUTO_KEYS.values()}
        db = reads.db
        try:
            if HT.tabled(CATALOG_TAB):
                headers, rows = HT.raw(reads, CATALOG_TAB)
            else:
                if not db.house_moved(CATALOG_TAB):
                    return out
                res = db.resolve(CATALOG_TAB)
                if res.ref is None:
                    return out
                headers, rows = list(res.ref.headers), db.rows(res.ref)
            heads = [gsjs.trim(gsjs.or_blank(h)).lower() for h in headers]
            if "key" not in heads:
                return out
            at_key = headers[heads.index("key")]
            at_value = headers[heads.index("default_value")] if "default_value" in heads else None
            for _rn, raw in rows:
                k = gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(at_key), "hub")))
                if k not in out:
                    continue
                v = gsjs.or_blank(hubdb.typed(raw.get(at_value), "hub")) if at_value is not None else ""
                if gsjs.trim(v):
                    out[k] = v
        except hubdb.Unreadable:
            raise
        except Exception:  # noqa: BLE001 - the catalogue cannot answer → the shipped copy
            pass
        return out
    return reads.once("sd:auto_defaults", read)


def autos_read(reads: L.Reads) -> dict[str, bool] | None:
    """hubMyWorkAutoRead_: each switch plainly on, its catalogue default when it has no cell; None when unreadable."""
    def read() -> dict[str, bool] | None:
        try:
            cfg = reads.config()
            shipped = auto_defaults(reads)
            out: dict[str, bool] = {}
            for part, key in AUTO_KEYS.items():
                raw = cfg[key] if key in cfg else shipped.get(key)
                out[part] = gsjs.trim(gsjs.or_blank(raw)).lower() in ("yes", "on", "true", "1")
            return out
        except Exception:  # noqa: BLE001 - sdBaseBuild_ and the action both read a throw as no switches
            return None
    return reads.once("sd:autos", read)


def test_mode_(reads: L.Reads) -> dict[str, Any]:
    """sdTestMode_ over hubTestModeState_: anything unreadable or unknown is on."""
    def read() -> dict[str, Any]:
        try:
            st = SCD.test_mode_state(reads.config())
        except Exception as e:  # noqa: BLE001 - held as on, said
            return {"on": True, "readable": False, "why": "Test mode could not be read (" + sd_err(e) +
                    ") — held as on."}
        if st.get("unrecognized"):
            return {"on": True, "readable": False,
                    "why": "Test mode reads a word the switch does not know — held as on."}
        return {"on": st["on"], "readable": True,
                "why": "Test mode is on: texts are written to the rehearsal sheet." if st["on"] else ""}
    return reads.once("sd:test_mode", read)


# ---- the hotline queue: its key, its call times, its rows ------------------------------------------------------------

def call_id_of(notes: Any) -> str:
    """sdCallIdOf_."""
    m = re.search(r"Call ID:\s*(AC[0-9a-f]+)", gsjs.or_blank(notes), re.I)
    return m.group(1) if m else ""


def _raw_str(v: Any) -> str:
    """sdStr_ of a raw getValues cell as the copy reconstructs it (a Date reads as its JS date text)."""
    return gsjs.trim(gsjs.js_str(hubdb.typed(v, "hub")))


def call_times(reads: L.Reads) -> dict[str, str]:
    """sdCallTimes_: call_id → the call's own instant, read once per pass; {} when the house cannot be read."""
    def read() -> dict[str, str]:
        out: dict[str, str] = {}
        try:
            db = reads.db
            if not db.house_id(COMM_CALLS_TAB):
                return out
            import sheet_resources  # noqa: PLC0415 - the lane's rows in Postgres once it keeps them
            kept = sheet_resources.kept_rows(reads, COMM_CALLS_TAB)
            if kept is not None:
                for r in kept:
                    cid, at = _raw_str(r.get("call_id")), _raw_str(r.get("call_at"))
                    if cid and at and cid not in out:
                        out[cid] = at
                return out
            res = db.resolve(COMM_CALLS_TAB)
            if res.ref is None:
                if not res.book_known:
                    raise hubdb.Unreadable("asa-hub-db holds no copy of the calls house")
                return out
            heads = list(res.ref.headers)
            if "call_id" not in heads or "call_at" not in heads:
                return out
            ci, ai = heads.index("call_id"), heads.index("call_at")
            for _rn, raw in db.rows(res.ref):
                cid, at = _raw_str(raw.get(heads[ci])), _raw_str(raw.get(heads[ai]))
                if cid and at and cid not in out:
                    out[cid] = at
        except hubdb.Unreadable:
            raise
        except Exception:  # noqa: BLE001 - sdCallTimes_ catches
            return {}
        return out
    return reads.once("sd:call_times", read)


def day_only(v: Any) -> bool:
    """sdDayOnly_: the sheet kept only the day — a midnight Date, M/D/YYYY or YYYY-MM-DD (the lane hands text)."""
    if isinstance(v, datetime):
        return v.hour == 0 and v.minute == 0 and v.second == 0
    return bool(re.match(r"^\s*(\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2})\s*$", sd_str(v)))


def received_of(reads: L.Reads, r: dict) -> Any:
    """sdReceivedOf_: when a queue row was received; a bare day takes the call's own instant, on the same day."""
    raw = r.get("date_received")
    if not day_only(raw):
        return raw
    cid = call_id_of(r.get("notes"))
    at = call_times(reads).get(cid, "") if cid else ""
    return at if at and day_text(at) == day_text(raw) else raw


def queue_lane(reads: L.Reads) -> dict[str, Any]:
    """The Support Queue lane as server/my_work.py reads it off asa-hub-db (the relay's hotline lane read)."""
    def read() -> dict[str, Any]:
        return MW.lanes_for(MW.HubBooks(reads), (QUEUE_LANE,))[QUEUE_LANE]
    return reads.once("sd:queue", read)


def queue_all(rows: list[dict]) -> list[dict]:
    """sdQueueAll_: every queue row in book order with its HQ ref; the key is server/my_work.py _support_key's."""
    nth: dict[str, int] = {}
    out = []
    for i, r in enumerate(rows):
        key = MW._support_key(r.get("requestor"), r.get("type_of_request"), r.get("description_of_request"),
                              r.get("date_received"))
        nth[key] = nth.get(key, 0) + 1
        m = re.fullmatch(r"r(\d+)", sd_str(r.get("id")))
        out.append({"ref": MW._nth_ref("HQ" + sha10(key), nth[key]), "key": key, "row": r, "index": i,
                    "book_row": int(m.group(1)) if m else 0})
    return out


# ---- events, items, decisions ----------------------------------------------------------------------------------------

def final_of(decs: list[dict] | None) -> dict | None:
    """sdFinalOf_: the latest final verdict (approved, denied, resolved) of a ref's decisions, or None."""
    hit = None
    for d in decs or []:
        if d.get("verdict") in FINAL:
            hit = d
    return hit


def last_redirect(decs: list[dict] | None) -> dict | None:
    """sdLastRedirect_."""
    hit = None
    for d in decs or []:
        if d.get("verdict") == "redirected":
            hit = d
    if not hit:
        return None
    w = jjson(hit.get("witness"), {}) or {}
    if not sd_str(w.get("to_uid")):
        return None
    return {"to_uid": sd_str(w.get("to_uid")), "to_name": sd_str(w.get("to_name")) or "someone",
            "by": sd_str(hit.get("by_name")), "at": sd_str(hit.get("at")), "note": sd_str(hit.get("note")),
            "item_id": sd_str(w.get("item_id"))}


def redirect_of(decs: list[dict] | None) -> dict | None:
    """sdRedirectOf_: the redirect a request still waits on — the latest while no final verdict stands."""
    return None if final_of(decs) else last_redirect(decs)


def applied_words(d: dict) -> str:
    """sdAppliedWords_."""
    n = jjson(d.get("note"), None)
    if not isinstance(n, dict) or not n.get("field"):
        return sd_str(d.get("note"))
    return ("Address" if n.get("field") == "address" else "E-mail" if n.get("field") == "email" else "Phone") + \
        " applied on the platform: " + sd_str(n.get("value"))


def history_of(decs: list[dict] | None) -> list[dict]:
    """sdHistoryOf_."""
    out = []
    for d in decs or []:
        line = {"at": d.get("at"), "by": d.get("by_name") or ("Support Requests" if d.get("via") == "auto" else ""),
                "verdict": d.get("verdict"),
                "note": applied_words(d) if d.get("verdict") == "applied" else d.get("note"), "via": d.get("via")}
        if d.get("verdict") == "redirected":
            line["to"] = sd_str((jjson(d.get("witness"), {}) or {}).get("to_name"))
        out.append(line)
    return out


def acks_of(decs: list[dict] | None) -> list[dict]:
    """sdAcksOf_."""
    seen, out = set(), []
    for d in decs or []:
        if d.get("verdict") != "aware" or d.get("by_uid") in seen:
            continue
        seen.add(d.get("by_uid"))
        out.append({"uid": d.get("by_uid"), "name": d.get("by_name"), "at": d.get("at")})
    return out


def detail(list_: list[dict], label: str, value: Any) -> None:
    """sdDetail_."""
    v = gsjs.text(value, 1200)
    if v:
        list_.append({"label": label, "value": v})


def told_words(told: Any) -> str:
    """sdToldWords_."""
    words = []
    for t in (told if isinstance(told, list) else []):
        state = sd_str(_js_get(_js_get(t, "text"), "state"))
        name = sd_str(t.get("name")) if isinstance(t, dict) else ""
        words.append(name + (" (text " + state.replace(":", ": ", 1) + ")" if state else ""))
    return ", ".join(words)


# ---- the ADP block (read side) ---------------------------------------------------------------------------------------

def adp_held(reads: L.Reads, d: dict) -> bool:
    """sdAdpHeld_: the account already holds the prepared e-mail or phone — the same proof over what it holds."""
    uid, field, proof = sd_str(d.get("uid")), sd_str(d.get("field")), sd_str(d.get("proof"))
    if not uid or not proof or field not in ("email", "phone"):
        return False
    u = user_by_uid(reads, uid)
    if not u:
        return False
    if field == "email":
        held = [sd_str(e).lower() for e in [u.get("email"), *SPF.profile_parse_emails(u.get("emails"))]]
    else:
        held = []
        for n in [u.get("phone"), *[_js_get(p, "number") for p in SP._parse_phones(u.get("phones"))]]:
            dd = digits10(n)
            held.append(f"({dd[:3]}) {dd[3:6]}-{dd[6:]}" if len(dd) == 10 else "")
    return any(v and sha10(uid + "|" + field + "|" + v) == proof for v in held)


def adp_of(reads: L.Reads, ev: dict | None, decs: list[dict], on: Any) -> dict | None:
    """sdAdpOf_: the ADP block of a queue row, from its event and the decisions on its ref."""
    if not ev:
        return {"state": "off", "field": "", "words": "", "proof": "", "why": "The ADP updates switch is off."} \
            if on is False else None
    d = jjson(ev.get("details"), {}) or {}
    state = sd_str(d.get("state")) or "refused"
    why = sd_str(d.get("why"))
    approved = None
    for x in decs or []:
        if x.get("verdict") == "applied":
            state = "applied"
        elif x.get("verdict") == "undone":
            state = "undone"
        elif x.get("verdict") == "approved":
            approved = x
    # an e-mail or phone is saved on the person's profile, never here: it reads as applied once the account holds it
    if state == "ready" and adp_held(reads, d):
        state = "applied"
    elif state == "ready" and approved:
        why = "Approved by " + (sd_str(approved.get("by_name")) or "a director") + \
            " — the account changes when Save is pressed on the profile."
    return {"state": state, "field": sd_str(d.get("field")), "words": sd_str(d.get("words")),
            "proof": sd_str(d.get("proof")) if state == "ready" else "", "why": why}


# ---- the rows --------------------------------------------------------------------------------------------------------

def queue_status(book: Any, final: dict | None) -> dict[str, Any]:
    """sdQueueStatus_."""
    if final:
        return {"word": FINAL[final["verdict"]], "tone": final["verdict"], "completed": True}
    s = sd_str(book)
    low = s.lower()
    if not low or low == "new":
        return {"word": s or "New", "tone": "new", "completed": False}
    if low in ("resolved", "closed", "done", "completed"):
        return {"word": s, "tone": "resolved", "completed": True}
    return {"word": s, "tone": "pending", "completed": False}


def queue_rows_(reads: L.Reads, queue: list[dict], decs_by: dict, events_by_ref: dict, routes: dict | None,
                autos: dict | None) -> list[dict]:
    """sdQueueRows_."""
    out_rows = []
    for q in queue:
        r, ref = q["row"], q["ref"]
        decs = decs_by.get(ref) or []
        final = final_of(decs)
        st = queue_status(r.get("status"), final)
        redirect = redirect_of(decs)
        last = last_redirect(decs)
        if redirect and not st["completed"]:
            st = {"word": "Redirected to " + redirect["to_name"], "tone": "waiting", "completed": False}
        route = route_of(r.get("type_of_request"), routes)
        call_off = is_call_off(r.get("type_of_request"))
        call_id = call_id_of(r.get("notes"))
        received = received_of(reads, r)
        details: list[dict] = []
        detail(details, "Urgency", urgency(r.get("urgency")))
        detail(details, "Received", stamp_words(received))
        detail(details, "Call ID", call_id)
        if final:
            detail(details, "Queue status", r.get("status"))
        detail(details, "Notes", mask_phones(re.sub(r"Call ID:\s*AC[0-9a-f]+", "", gsjs.or_blank(r.get("notes")),
                                                    flags=re.I)))
        detail(details, "Processed", r.get("processed"))
        route_ev = next((e for e in (events_by_ref.get(ref) or []) if e.get("kind") == "route"), None)
        if route_ev:
            rd = jjson(route_ev.get("details"), {}) or {}
            detail(details, "Routed", (route.replace("_", " ", 1) if route else "routed") + " — told " +
                   (told_words(rd.get("told")) or "nobody"))
        adp_ev = next((e for e in (events_by_ref.get(ref) or []) if e.get("kind") == "adp"), None)
        out: dict[str, Any] = {
            "ref": ref, "source": "queue",
            "kind": "call_off" if call_off else ("adp" if route == "adp_update" else "request"),
            "status": {"word": st["word"], "tone": st["tone"]}, "date": when_of(received),
            "requestor": {"name": gsjs.text(r.get("requestor"), 120), "uid": uid_by_name(reads, r.get("requestor"))},
            "type": type_parts(r.get("type_of_request")), "urgency": urgency(r.get("urgency")),
            "description": gsjs.text(r.get("description_of_request"), 4000), "route": route,
            "completed": st["completed"], "details": details, "history": history_of(decs), "acks": acks_of(decs),
            "waiting_on": [], "link": "/app/support-desk/requests?ref=" + uri(ref),
            "_vis": "lead" if route == "general" else "director",
            "_final": final["verdict"] if final else "", "_final_by": sd_str(final.get("by_name")) if final else "",
            "_final_at": sd_str(final.get("at")) if final else "", "_call_id": call_id,
            "_book_row": q["book_row"], "_redirect": redirect, "_last_to": last["to_uid"] if last else ""}
        if route == "adp_update":
            adp = adp_of(reads, adp_ev, decs, autos.get("adp_update") if autos else None)
            if adp is not None:
                out["adp"] = adp
        out_rows.append(out)
    return out_rows


def event_status(ev: dict, decs: list[dict], items: list[dict], directors: list[dict]) -> dict[str, Any]:
    """sdEventStatus_."""
    acks = acks_of(decs)
    final = final_of(decs)
    if ev.get("kind") == "incident":
        if final:
            return {"word": FINAL[final["verdict"]], "tone": final["verdict"], "completed": True, "waiting": []}
        return {"word": "Important — incident filed", "tone": "important", "completed": False, "waiting": []}
    addressed = [{"uid": it.get("to_uid"), "name": it.get("to_name")} for it in items or []
                 if it.get("seat") == "director"]
    if not addressed:
        addressed = list(directors)
    acked = {a["uid"]: a for a in acks}
    waiting = [d for d in addressed if d.get("uid") not in acked]
    if addressed and not waiting:
        return {"word": "Aware — " + " · ".join(
            sd_first(d.get("name") or acked[d.get("uid")]["name"]) + " " + clock_words(acked[d.get("uid")]["at"])
            for d in addressed), "tone": "aware", "completed": True, "waiting": []}
    return {"word": "Directors, are you aware?", "tone": "warning", "completed": False,
            "waiting": [d.get("name") for d in waiting]}


def event_rows_(reads: L.Reads, events: list[dict], decs_by: dict, items_by: dict,
                directors: list[dict]) -> list[dict]:
    """sdEventRows_: the warnings and incidents the platform raised (route, adp and vacation events decorate)."""
    out = []
    for ev in events:
        kind = ev.get("kind")
        if kind not in WARNING_KINDS and kind != "incident":
            continue
        d = jjson(ev.get("details"), {}) or {}
        ref = ev.get("ref", "")
        decs = decs_by.get(ref) or []
        st = event_status(ev, decs, items_by.get(ref) or [], directors)
        redirect = redirect_of(decs) if kind == "incident" else None
        last = last_redirect(decs) if kind == "incident" else None
        if redirect and not st["completed"]:
            st = {"word": "Redirected to " + redirect["to_name"], "tone": st["tone"], "completed": False,
                  "waiting": [redirect["to_name"]]}
        details: list[dict] = []
        if kind == "incident":
            detail(details, "Category", d.get("incident_category"))
            detail(details, "Location", d.get("incident_location"))
            detail(details, "Day", day_words(d.get("day")))
            detail(details, "Filed through", d.get("via"))
            detail(details, "Report", "Open Incidents for the report.")
        else:
            detail(details, "House", d.get("house_name") or d.get("house") or ev.get("house"))
            detail(details, "Shift", d.get("shift_code"))
            detail(details, "Day", day_words(ev.get("day")))
            if kind == "punch":
                detail(details, "Not punching", d.get("direction"))
                detail(details, "Clock read", stamp_words(d.get("read_at")))
            else:
                detail(details, "Minutes late", d.get("minutes_late"))
                src = d.get("source")
                detail(details, "Seen by", "the time clock" if src == "clock" else
                       "the call-off form" if src == "form" else "the mailbox" if src == "mail" else src)
        fin = final_of(decs)
        out.append({
            "ref": ref, "source": "event", "kind": kind, "status": {"word": st["word"], "tone": st["tone"]},
            "date": when_of(ev.get("at")) or when_of(ev.get("created_at")),
            "requestor": {"name": sd_str(ev.get("person")), "uid": sd_str(ev.get("person_uid"))},
            "type": type_of_category(ev.get("category")), "urgency": "High" if kind == "incident" else "",
            "description": sd_str(ev.get("title")), "route": "", "completed": st["completed"], "details": details,
            "history": history_of(decs), "acks": acks_of(decs), "waiting_on": st["waiting"],
            "link": "/app/support-desk/requests?ref=" + uri(ref),
            "_vis": "lead" if kind in ("incident", "punch") else "director",
            "_final": fin["verdict"] if fin else "", "_final_by": sd_str(fin.get("by_name")) if fin else "",
            "_final_at": sd_str(fin.get("at")) if fin else "", "_redirect": redirect,
            "_last_to": last["to_uid"] if last else ""})
    return out


# ---- Scheduling's own flows as rows (read through Scheduling's own readers: no copy, no write) ------------------------

def sched_status(f: dict) -> dict[str, Any]:
    """sdSchedStatus_."""
    s = sd_str(f.get("state"))
    seats = jjson(f.get("seats"), [])
    waiting_seat = None
    for x in (seats if isinstance(seats, list) else []):
        if waiting_seat is None and isinstance(x, dict) and x.get("state") == "waiting":
            waiting_seat = x
    to = (waiting_seat or {}).get("to") if waiting_seat else None
    names = [n for n in (sd_str(_js_get(t, "name")) for t in (to if isinstance(to, list) else [])) if n]
    if s in SCHED_WAITING:
        return {"word": "Waiting on " + (", ".join(names) or "an answer"), "tone": "waiting", "completed": False,
                "waiting": names}
    word, tone = SCHED_STATE_WORDS.get(s, (s or "Open", "pending"))
    return {"word": word, "tone": tone, "completed": s in SCHED_CLOSED, "waiting": []}


def sched_type(kind: Any) -> dict[str, str]:
    """sdSchedType_."""
    if kind in ("call_off", "phone"):
        return type_parts("Schedule - Call Off")
    if kind in ("time_off", "request_off"):
        return type_parts("Schedule - Time Off Request")
    return type_parts("Schedule - Shift Changes")


def sched_house(reads: L.Reads, code: Any) -> str:
    """sdSchedHouse_."""
    try:
        return sd_str(SCH.house_label(reads, code)) or sd_str(code)
    except hubdb.Unreadable:
        raise
    except Exception:  # noqa: BLE001 - sdSchedHouse_ catches
        return sd_str(code)


def sched_shift(f: dict) -> str:
    """sdSchedShift_: the code as written (schedShiftWords_ without `long`)."""
    try:
        return sd_str(SCH.shift_words(f.get("shift_text"))) or sd_str(f.get("shift_text"))
    except Exception:  # noqa: BLE001
        return sd_str(f.get("shift_text"))


def sched_exchange_where(reads: L.Reads, ex: dict) -> str:
    """sdSchedExchangeWhere_: the partner shift of an exchange in words ('Wed 10/7 4P-12A at FT')."""
    shift = sched_shift({"shift_text": ex.get("text")})
    return " ".join(x for x in (day_words(ex.get("date")), shift, "at " + sched_house(reads, ex.get("house"))) if x)


def sched_description(reads: L.Reads, f: dict) -> str:
    """sdSchedDescription_."""
    house = sched_house(reads, f.get("house_code")) if f.get("house_code") else ""
    shift = sched_shift(f)
    where = " ".join(x for x in (day_words(f.get("date")), shift, ("at " + house) if house else "") if x)
    ex = SCH.exchange_of(f) if f.get("kind") == "swap" else None
    if ex:
        return "Swap: " + sd_str(f.get("person")) + " ⇄ " + sd_str(f.get("replacement")) + " — " + where + " · " + \
            sched_exchange_where(reads, ex)
    kind = f.get("kind")
    if kind == "call_off":
        return "Called off — " + where
    if kind == "phone":
        return "Called off by phone — a person has to find the shift: " + where
    if kind == "request_off":
        return "Request Off · one shift — " + where
    if kind == "time_off":
        return "Time off " + day_words(f.get("date")) + " to " + day_words(f.get("date_to") or f.get("date"))
    if kind == "swap":
        return "Swap: " + sd_str(f.get("person")) + " to " + sd_str(f.get("replacement")) + " — " + where
    return "Open shift taken by " + sd_str(f.get("person")) + " — " + where


def _sched_seat(reads: L.Reads, s: Any) -> dict[str, Any]:
    """One seat as sdSchedRows_ maps it."""
    to = _js_get(s, "to")
    return {"seat": sd_str(_js_get(s, "seat")), "state": sd_str(_js_get(s, "state")),
            "to": [sd_str(_js_get(t, "name")) for t in (to if isinstance(to, list) else [])],
            "by": sd_str(_js_get(s, "by")), "at": sd_str(_js_get(s, "at")), "note": sd_str(_js_get(s, "note")),
            "house": sched_house(reads, _js_get(s, "house")) if isinstance(s, dict) and s.get("house") else ""}


def sched_rows_(reads: L.Reads, decs_by: dict, events_by_ref: dict, sources: list[dict]) -> dict[str, Any]:
    """sdSchedRows_."""
    db = reads.db
    if not (db.house_moved(SCH.TABS["flows"]) and db.house_moved(SCH.TABS["inbox"])):
        sources.append(source_(reads, "scheduling", "unreadable", "Scheduling's houses are not set up yet"))
        return {"rows": [], "byCall": {}}
    try:
        flows = SCH.read_tab(reads, SCH.TABS["flows"])
        inbox = SCH.read_tab(reads, SCH.TABS["inbox"])
    except hubdb.Unreadable:
        raise
    except Exception as e:  # noqa: BLE001 - sdSchedRows_ says it and the rest of the list answers
        sources.append(source_(reads, "scheduling", "unreadable", sd_err(e)))
        return {"rows": [], "byCall": {}}
    items_by: dict[str, list[dict]] = {}
    for it in inbox:
        items_by.setdefault(it.get("flow_id", ""), []).append(it)
    children: dict[str, list[dict]] = {}
    for f in flows:
        if f.get("kind") == "call_off" and re.fullmatch(r"SF[0-9A-F]{10}", sd_str(f.get("source_ref"))):
            children.setdefault(sd_str(f.get("source_ref")), []).append(f)
    rows, by_call = [], {}
    for f in flows:
        kind = f.get("kind")
        if kind not in SCHED_KINDS:
            continue
        if kind == "call_off" and re.fullmatch(r"SF[0-9A-F]{10}", sd_str(f.get("source_ref"))):
            continue
        st = sched_status(f)
        if kind == "take" and not st["completed"]:
            continue
        seats = jjson(f.get("seats"), [])
        seats = seats if isinstance(seats, list) else []
        ref = f.get("id", "")
        decs = decs_by.get(ref) or []
        details: list[dict] = []
        if f.get("house_code"):
            detail(details, "House", sched_house(reads, f.get("house_code")))
        detail(details, "Days" if kind == "time_off" else "Day",
               day_words(f.get("date")) + " to " + day_words(f.get("date_to") or f.get("date"))
               if kind == "time_off" else day_words(f.get("date")))
        if kind != "time_off":
            detail(details, "Shift", sched_shift(f))
        detail(details, "Filed", "by phone" if f.get("source") == "hotline" else
               "by an editor" if f.get("source") == "editor" else
               "from My Calendar" if f.get("source_ref") == "my-calendar" else "on the platform")
        exch = SCH.exchange_of(f) if kind == "swap" else None
        if exch:
            detail(details, "Swapped with", f.get("replacement"))
            detail(details, "Their shift", sched_exchange_where(reads, exch))
        elif f.get("replacement"):
            detail(details, "Replacement", f.get("replacement"))
        if kind in ("call_off", "phone"):
            detail(details, "Reason", f.get("reason"))
        kids = children.get(ref) or []
        if kids:
            detail(details, "Open shifts", str(len(kids)) + " opened — " + ", ".join(
                day_words(k.get("date")) + " " + sched_status(k)["word"].lower() for k in kids))
        if any(e.get("kind") == "vacation" for e in (events_by_ref.get(ref) or [])):
            detail(details, "My Calendar", "Asked from My Calendar → Vacation Requests")
        history = history_of(decs)
        for s in seats:
            if isinstance(s, dict) and s.get("state") in ("approved", "declined") and s.get("at"):
                history.append({"at": s.get("at"), "by": sd_str(s.get("by")), "verdict": s.get("state"),
                                "note": sd_str(s.get("note")), "via": "scheduling"})
        items = items_by.get(ref) or []
        acks = []
        for it in items:
            if it.get("box") == "inbox" and it.get("kind") == "warning" and sd_str(it.get("answered_at")):
                acks.append({"uid": it.get("to_uid"), "name": it.get("answered_by") or it.get("to_name"),
                             "at": it.get("answered_at")})
                history.append({"at": it.get("answered_at"), "by": it.get("answered_by") or it.get("to_name"),
                                "verdict": "aware", "note": "", "via": "my-inbox"})
        history.sort(key=lambda h: sd_str(h.get("at")))
        row = {
            "ref": ref, "source": "scheduling", "kind": kind, "status": {"word": st["word"], "tone": st["tone"]},
            "date": when_of(f.get("created_at")) or sd_str(f.get("date")),
            "requestor": {"name": sd_str(f.get("person")), "uid": sd_str(f.get("person_uid"))},
            "type": sched_type(kind), "urgency": "", "description": sched_description(reads, f), "route": "",
            "completed": st["completed"], "details": details, "history": history, "acks": acks,
            "waiting_on": st["waiting"],
            "sched": {"flow_id": f.get("id"), "state": sd_str(f.get("state")), "item_id": "", "words": [],
                      "seats": [_sched_seat(reads, s) for s in seats]},
            "link": "/app/scheduling/calendar?house=" + uri(sd_str(f.get("house_code"))) + "&day=" +
                    uri(sd_str(f.get("date"))) if f.get("house_code") else "/app/scheduling/calendar",
            "_vis": "director",
            "_items": [{"id": it.get("id"), "box": it.get("box"), "kind": it.get("kind"),
                        "seat": sd_str(it.get("seat")), "to_uid": it.get("to_uid"), "state": it.get("state"),
                        "answered_at": sd_str(it.get("answered_at")), "answered_by": sd_str(it.get("answered_by"))}
                       for it in items]}
        rows.append(row)
        instance = sd_str(f.get("source_ref"))
        cut = instance.find(":calloff:")
        if cut > 0:
            by_call.setdefault(instance[:cut], []).append(row)
    sources.append(source_(reads, "scheduling", "ready", "", len(rows)))
    return {"rows": rows, "byCall": by_call}


# ---- the base (sdBaseBuild_; nothing cached — every call reads the copy as it now stands) -----------------------------

def source_(reads: L.Reads, key: str, state: str, why: str = "", count: int = 0) -> dict[str, Any]:
    """sdSource_."""
    return {"key": key, "state": state, "why": why or "", "count": count or 0, "as_of": now_iso(reads)}


def base_build(reads: L.Reads) -> dict[str, Any]:
    """sdBaseBuild_: everything about the list, fresh from asa-hub-db on every call."""
    sources: list[dict] = []
    st = settings_(reads)
    autos = autos_read(reads)
    try:
        decs_by = decs_by_ref(reads)
        decs_ok = True
        sources.append(source_(reads, "decisions", "ready", "", len(read_house(reads, TABS["decisions"]))))
    except hubdb.Unreadable:
        raise
    except Exception as e:  # noqa: BLE001 - an unreadable source is said by its own entry in `sources`
        decs_by, decs_ok = {}, False
        sources.append(source_(reads, "decisions", "unreadable", sd_err(e)))
    try:
        events = events_(reads)
        events_by_ref: dict[str, list[dict]] = {}
        for e in events:
            events_by_ref.setdefault(e.get("ref", ""), []).append(e)
        sources.append(source_(reads, "events", "ready", "", len(events)))
    except hubdb.Unreadable:
        raise
    except Exception as e:  # noqa: BLE001
        events, events_by_ref = [], {}
        sources.append(source_(reads, "events", "unreadable", sd_err(e)))
    try:
        items_by = items_by_ref(reads)
        sources.append(source_(reads, "inbox", "ready", "", len(read_house(reads, TABS["inbox"]))))
    except hubdb.Unreadable:
        raise
    except Exception as e:  # noqa: BLE001
        items_by = {}
        sources.append(source_(reads, "inbox", "unreadable", sd_err(e)))
    dirs = directors_(reads)
    sched = sched_rows_(reads, decs_by, events_by_ref, sources)
    queue_rows: list[dict] = []
    lane = queue_lane(reads)
    if not lane.get("ok"):
        sources.insert(0, source_(reads, "queue", "unreadable",
                                  "The Support Queue book could not be read: " + sd_str(lane.get("error"))))
    else:
        queue = queue_all([r for r in (lane.get("rows") or []) if isinstance(r, dict)])
        queue_rows = queue_rows_(reads, queue, decs_by, events_by_ref, st["routes"], autos)
        sources.insert(0, source_(reads, "queue", "ready", "", len(queue)))
    # a phone call-off Scheduling already holds is shown once: as the flow, naming the queue row
    folded: dict[str, str] = {}
    keep: list[dict] = []
    used_by_call: dict[str, int] = {}
    for row in queue_rows:
        flow_row = None
        if row["kind"] == "call_off" and row["_call_id"] and row["_call_id"] in sched["byCall"]:
            n = used_by_call.get(row["_call_id"], 0)
            held = sched["byCall"][row["_call_id"]]
            flow_row = held[n] if n < len(held) else None
            if flow_row is not None:
                used_by_call[row["_call_id"]] = n + 1
        if flow_row is not None:
            flow_row["details"].append({"label": "Phone request", "value": row["ref"]})
            folded[row["ref"]] = flow_row["ref"]
            continue
        keep.append(row)
    dir_names = [d["name"] for d in dirs["list"]]
    for r in keep:
        if not r["completed"]:
            r["waiting_on"] = [r["_redirect"]["to_name"]] if r["_redirect"] else list(dir_names)
    rows = keep + sched["rows"] + event_rows_(reads, events, decs_by, items_by, dirs["list"])
    for r in rows:
        if "_items" not in r:
            r["_items"] = [{"id": it.get("id"), "box": it.get("box"), "kind": it.get("kind"), "seat": it.get("seat"),
                            "to_uid": it.get("to_uid"), "to_name": it.get("to_name"), "state": it.get("state"),
                            "answered_at": sd_str(it.get("answered_at")),
                            "answered_by": sd_str(it.get("answered_by"))} for it in (items_by.get(r["ref"]) or [])]
    rows.sort(key=lambda r: sd_str(r.get("date")), reverse=True)
    return {"now": now_iso(reads), "today": reads.today(), "rows": rows, "sources": sources,
            "decisions_ok": decs_ok, "folded": folded, "test_mode": test_mode_(reads), "directors": dirs,
            "leads": leads_(reads), "autos": autos, "routes_why": st["routes_why"]}


# ---- the gate --------------------------------------------------------------------------------------------------------

def visiting_(user: dict | None) -> bool:
    """sdVisiting_ (HUB_MEMBER_CTX never stands here)."""
    return bool(user and user.get("visiting_member"))


def actor_name(user: dict | None) -> str:
    """sdActorName_."""
    u = user or {}
    return sd_str(u.get("display_name") if u.get("display_name") is not None else u.get("displayname")) or \
        sd_str(u.get("email"))


def acting_uid(user: dict | None) -> str:
    """hubActingUserId_."""
    return sd_str(user.get("id")) if user and not user.get("is_service") else ""


def watches_(user: dict | None) -> bool:
    """sdWatches_: the badges worn (HUB_BADGE_FOLLOWS), never the account role."""
    return any(b in WATCH_BADGES for b in sc.badges_worn((user or {}).get("types"), ""))


def gate_(reads: L.Reads, user: dict | None) -> dict[str, Any]:
    """sdGate_: the App Control gate opens the door, the lists decide the cut."""
    g: dict[str, Any] = {"open": False, "uid": "", "name": "", "email": "", "is_master": False, "is_director": False,
                         "is_lead": False, "is_watcher": False, "can_decide": False}
    try:
        got = sc.profile_app_gate(APP_ID, user, reads.scope_sources())
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - sdGate_ reads a failed gate as closed
        got = None
    if not got or not got.get("open"):
        return g
    g["open"] = True
    g["uid"] = acting_uid(user)
    g["name"] = actor_name(user)
    g["email"] = sd_str((user or {}).get("email")).lower()
    try:
        g["is_master"] = bool(sc.is_real_master(user))
    except Exception:  # noqa: BLE001
        g["is_master"] = False
    dirs = directors_(reads)
    g["is_director"] = bool(g["uid"]) and any(d["uid"] == g["uid"] for d in dirs["list"])
    g["is_lead"] = bool(g["uid"]) and any(d["uid"] == g["uid"] for d in leads_(reads)["list"])
    try:
        g["is_watcher"] = watches_(user)
    except Exception:  # noqa: BLE001
        g["is_watcher"] = False
    # a person support.requests lists decides as the directors do (the writes let them in the same way)
    g["by_edition"] = not (g["is_master"] or g["is_director"]) and \
        sc.edition_allows(EDITION_REQUESTS, user or {}, reads.config())
    g["can_decide"] = g["is_master"] or g["is_director"] or g["by_edition"]
    return g


def seat_gate_(reads: L.Reads, user: dict | None, ref: Any) -> dict[str, Any] | None:
    """sdSeatGate_: the account the latest redirect of a request named reads and answers it, whatever the app's gate."""
    if not user or user.get("is_service") or visiting_(user) or not SEAT_REF.match(sd_str(ref)):
        return None
    uid = acting_uid(user)
    if not uid:
        return None
    try:
        last = last_redirect(decs_by_ref(reads).get(sd_str(ref)) or [])
    except hubdb.Unreadable:
        raise
    except Exception:  # noqa: BLE001 - sdSeatGate_ catches
        return None
    if not last or last["to_uid"] != uid:
        return None
    return {"open": True, "seat": True, "uid": uid, "name": actor_name(user),
            "email": sd_str(user.get("email")).lower(), "is_master": False, "is_director": False, "is_lead": False,
            "can_decide": False}


def pickers_for(reads: L.Reads, uid: str) -> dict[str, Any]:
    """sdPickersFor_: live staff-side accounts a request may be redirected to, the viewer left out."""
    try:
        all_users = reads.users()
    except hubdb.Unreadable:
        raise
    except Exception as e:  # noqa: BLE001
        return {"list": [], "why": "The accounts could not be read (" + sd_err(e) + ")."}
    by_name: dict[str, list[dict]] = {}
    for u in all_users:
        # an SSA or a FAMILY is never an assignee, whatever its role says (scope.role_counts)
        if not SCH.live(u) or sd_str(u.get("role")).lower() not in STAFF_ROLES or not sc.role_counts(u.get("types"), u.get("role")):
            continue
        if sc.is_master_email(u.get("email")):
            continue
        id_, name = sd_str(u.get("userid")), sd_str(u.get("displayname"))
        k = name_fold(name)
        if not id_ or not k:
            continue
        by_name.setdefault(k, []).append({"uid": id_, "name": name})
    lst, twins = [], 0
    for k, group in by_name.items():
        if len(group) > 1:
            twins += 1
            continue
        if group[0]["uid"] != uid:
            lst.append(group[0])
    lst.sort(key=functools.cmp_to_key(lambda a, b: gsjs.locale_cmp(a["name"], b["name"])))
    why = (str(twins) + (" name is" if twins == 1 else " names are") +
           " worn by two live accounts and left out of the list.") if twins else ""
    return {"list": lst, "why": why}


# ---- the viewer's cut ------------------------------------------------------------------------------------------------

def sched_item_for(row: dict, g: dict) -> dict | None:
    """sdSchedItemFor_: the viewer's own Scheduling item for a row — a waiting approval, else an unanswered warning."""
    uid = g.get("uid") or ""
    work = warn = seat = None
    stand_in = bool(g.get("is_master") and uid and (row.get("requestor") or {}).get("uid") != uid)
    for it in (row.get("_items") or []):
        if stand_in and seat is None and it.get("box") == "work" and it.get("state") == "waiting" \
                and it.get("seat") == "director":
            seat = it
        if not uid or it.get("to_uid") != uid:
            continue
        if it.get("box") == "work" and it.get("state") == "waiting":
            work = it
        if it.get("box") == "inbox" and it.get("kind") == "warning" and not it.get("answered_at"):
            warn = it
    return work or seat or warn


def own_item(row: dict, uid: str) -> dict | None:
    """sdOwnItem_."""
    return next((it for it in (row.get("_items") or []) if it.get("to_uid") == uid and it.get("box") != WORK_BOX),
                None)


def holds_(row: dict, g: dict) -> bool:
    """sdHolds_: whether the request waits on this viewer because it was redirected to them."""
    red = row.get("_redirect")
    return bool(red and g.get("uid") and red.get("to_uid") == g.get("uid"))


def may_(row: dict, g: dict, base: dict) -> dict[str, Any]:
    """sdMay_: what this viewer may press on this row, and why not when nothing."""
    may: dict[str, Any] = {"approve": False, "deny": False, "resolve": False, "aware": False, "redirect": False,
                           "why": ""}
    if row["source"] == "scheduling":
        it = sched_item_for(row, g)
        if it and it.get("box") == "work":
            may["approve"] = may["deny"] = True
        elif it:
            may["aware"] = True
        elif row["completed"]:
            may["why"] = "This request is " + row["status"]["word"].lower() + "."
        elif row["waiting_on"]:
            may["why"] = ("Waiting on " + ", ".join(row["waiting_on"]) + " — the first answer decides."
                          if g.get("is_master") and not g.get("is_director")
                          else "This one is waiting on " + ", ".join(row["waiting_on"]) + ".")
        else:
            may["why"] = "Nothing here is waiting on you."
        return may
    if not base["directors"]["readable"]:
        may["why"] = base["directors"]["why"]
        return may
    uid = g.get("uid") or ""
    own = own_item(row, uid)
    acked = any(a.get("uid") == uid for a in (row.get("acks") or []))
    holds = holds_(row, g)
    by_edition = bool(g.get("by_edition"))
    if row["source"] == "event":
        may["aware"] = (not acked) and (bool(own and not own.get("answered_at")) or bool(g.get("is_director")) or
                                        bool(g.get("is_master")) or by_edition)
        if row.get("kind") == "incident" and not row["completed"]:
            may["resolve"] = bool(g.get("is_director") or g.get("is_master") or holds or by_edition)
            may["redirect"] = may["resolve"]
        if not may["aware"] and not may["resolve"]:
            may["why"] = ("You marked this as aware." if acked else "This one is closed." if row["completed"]
                          else "Only the people it was addressed to mark it.")
        return may
    if row.get("_final"):
        may["why"] = "Already " + row["_final"] + " by " + (row.get("_final_by") or "someone") + "."
        return may
    if g.get("is_director") or g.get("is_master") or holds or by_edition:
        may["approve"] = may["deny"] = may["resolve"] = may["redirect"] = True
    else:
        may["why"] = "Only the directors decide requests."
    if row["completed"] and not row.get("_final"):
        may["approve"] = may["deny"] = may["resolve"] = may["redirect"] = False
        may["why"] = "The queue already says " + row["status"]["word"] + "."
    return may


def cut_(base: dict, g: dict, completed: Any = False, since_days: Any = None) -> dict[str, Any]:
    """sdCut_: who sees which rows, what each may press, the internals stripped."""
    want_completed = completed is True
    n = float(since_days) if isinstance(since_days, (int, float)) and not isinstance(since_days, bool) \
        else float("nan")
    since = gsjs.day_shift(base["today"], -math.floor(n)) if n > 0 else ""

    def sees(row: dict) -> bool:
        if g.get("is_master") or g.get("is_director") or g.get("by_edition") or g.get("is_watcher") or \
                holds_(row, g):
            return True
        if g.get("is_lead"):
            return row.get("_vis") == "lead"
        return False

    counts = {"open": 0, "waiting_on_me": 0, "warnings": 0, "completed": 0}
    rows = []
    for row in base["rows"]:
        if not sees(row):
            continue
        if row["completed"]:
            counts["completed"] += 1
        if not want_completed and row["completed"]:
            continue
        if since and sd_str(row.get("date"))[:10] < since:
            continue
        out = {k: v for k, v in row.items() if not k.startswith("_")}
        out["may"] = may_(row, g, base)
        if row["source"] == "scheduling":
            it = sched_item_for(row, g)
            out["sched"] = copy.deepcopy(row["sched"])
            out["sched"]["item_id"] = it.get("id") if it else ""
            out["sched"]["words"] = (["approve", "decline"] if it.get("box") == "work" else ["seen"]) if it else []
        if not row["completed"]:
            counts["open"] += 1
            if row["status"]["tone"] == "warning":
                counts["warnings"] += 1
        if out["may"]["approve"] or out["may"]["deny"] or out["may"]["aware"]:
            counts["waiting_on_me"] += 1
        rows.append(out)
    return {"rows": rows, "counts": counts}


# ---- the actions ------------------------------------------------------------------------------------------------------

def support_desk_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """supportDeskList: the whole Support Requests board, cut for this viewer."""
    reads, user = sess.reads, sess.user or {}
    g = gate_(reads, user)
    if not g["open"]:
        return refuse(404, UNKNOWN)
    p = payload if isinstance(payload, dict) else {}
    try:
        base = base_build(reads)
    except (hubdb.Unreadable, Defer):
        raise
    except Exception as e:  # noqa: BLE001
        return refuse(503, "Support Requests could not be read just now (" + sd_err(e) + ").")
    cut = cut_(base, g, p.get("completed") is True, p.get("since_days"))
    # an unreadable source is said by its own entry in `sources` (the screen draws one line each), never twice here
    notes = []
    if base["directors"].get("from") == "support":
        notes.append(base["directors"]["why"])
    if not base["directors"]["readable"]:
        notes.append(base["directors"]["why"])
    if base["leads"] and base["leads"].get("why"):
        notes.append("Leads: " + base["leads"]["why"] + ".")
    if base["routes_why"]:
        notes.append(base["routes_why"])
    privileged = g["is_master"] or g["is_director"] or g["is_lead"] or g["is_watcher"]
    if not privileged:
        notes = ["Only the requests redirected to you are shown." if cut["rows"]
                 else "Requests are shown to the directors."]
    elif g["is_watcher"] and not g["can_decide"]:
        notes.append("You see every request; the directors decide them.")
    autos = base["autos"]
    automations = {k: (autos[k] is True) if autos else None for k in AUTO_KEYS}
    redirects = g["is_master"] or g["is_director"] or any(r["may"]["redirect"] for r in cut["rows"])
    pickers = pickers_for(reads, g["uid"]) if redirects else {"list": [], "why": ""}
    return {"status": 200, "data": {
        "ok": True, "now": now_iso(reads), "today": base["today"],
        "viewer": {"uid": g["uid"], "name": g["name"], "is_master": g["is_master"], "is_director": g["is_director"],
                   "is_lead": g["is_lead"], "is_watcher": g["is_watcher"], "can_decide": g["can_decide"]},
        "test_mode": test_mode_(reads),
        "directors": [{"uid": d["uid"], "name": d["name"]} for d in base["directors"]["list"]],
        "leads": [{"uid": d["uid"], "name": d["name"]} for d in base["leads"]["list"]],
        "directors_readable": base["directors"]["readable"], "directors_why": base["directors"]["why"],
        "automations": automations,
        "sources": base["sources"] if privileged else [],
        "rows": cut["rows"],
        "counts": cut["counts"],
        "people": pickers["list"], "people_why": pickers["why"],
        "note": " ".join(notes)}}


def support_desk_seat(sess: L.Session, payload: dict) -> dict[str, Any]:
    """supportDeskSeat: one request as its viewer sees it, with the people it may be redirected to."""
    reads, user = sess.reads, sess.user or {}
    p = payload if isinstance(payload, dict) else {}
    ref = gsjs.text(p.get("ref"), 40)
    g = gate_(reads, user)
    if not g["open"]:
        g = seat_gate_(reads, user, ref)
    if not g or not g["open"]:
        return refuse(404, UNKNOWN)
    if not ref:
        return refuse(400, "Which request? The ref is missing.")
    try:
        cut = cut_(base_build(reads), g, True)
    except (hubdb.Unreadable, Defer):
        raise
    except Exception as e:  # noqa: BLE001
        return refuse(503, "Support Requests could not be read just now (" + sd_err(e) + ").")
    row = next((r for r in cut["rows"] if r["ref"] == ref), None)
    if not row:
        return refuse(404, "That request is not waiting on you any more.")
    pickers = pickers_for(reads, g["uid"]) if row["may"]["redirect"] else {"list": [], "why": ""}
    return {"status": 200, "data": {"ok": True, "row": row, "people": pickers["list"], "people_why": pickers["why"],
                                    "viewer": {"uid": g["uid"], "name": g["name"], "is_master": g["is_master"],
                                               "is_director": g["is_director"], "is_lead": g["is_lead"],
                                               "can_decide": g["can_decide"]}}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "supportDeskList": support_desk_list, "supportDeskSeat": support_desk_seat}
# HUB_POLICY: the roles and typed params each door declares
POLICY: dict[str, dict[str, Any]] = {
    "supportDeskList": {"roles": ROLES, "params": {"completed": "boolean", "since_days": "number"}},
    "supportDeskSeat": {"roles": ROLES, "params": {"ref": "string"}}}
