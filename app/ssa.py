"""SSA's reads (apps-script/SsaProfiles.gs) off asa-hub-db: one Service and Support Administrator at a time."""
from __future__ import annotations

import functools
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import client_sources as CS
import clients as C
import gsjs
import house_tables as HT
import hubdb
import locations as L
import photos as P
import scope as sc
import staff_comms as SC
from gsjs import NY, SheetDate, name_key
from scope import Defer

log = logging.getLogger("asa-hub-app")

APP_ID = "ssa-profiles"
NOTES_TAB = "ssa_notes"
NOTES_HEADER = ("id", "ssa_key", "ssa_name", "body", "by", "at")
NOTE_MAX = 4000
# SSA_PACK_PARTS, in its order: the client views read the parts gathered before them
PACK_PARTS = ("overview", "documents", "activity", "notes", "client_views")
# SSA_PACK_BUDGET_MS for this engine: the relay waits HUB_APP_PACK_TIMEOUT_S (60 s) for a whole pack
PACK_BUDGET_S = float(os.getenv("HUB_APP_SSA_PACK_BUDGET_S", "40"))
NOT_GATHERED = "This part was not gathered in this pack; it is read on its own."
# why a part was left, in the pack's log, when no door said why
PAST_BUDGET = "past the pack's budget"
FOLLOWUP_DAYS = 60
ACTIVITY_DAYS = 365
ACTIVITY_CAP = 400
AGENCIES = {"starkdd.org": "Stark County Board of DD", "stardd.org": "Stark County Board of DD"}
FREE_MAIL = ("gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com", "live.com", "msn.com",
             "att.net", "sbcglobal.net")
MIMES = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
         "doc": "application/msword",
         "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
# SSA_HIDE_PARTS through AlertsConfig.gs MYWORK_HIDE_KEYS; AlertsCatalog.gs ships each as "yes"
HIDE_KEYS = (("updated", "mywork_hide_ssa_updated"), ("county", "mywork_hide_ssa_county"),
             ("count", "mywork_hide_ssa_count"), ("role", "mywork_hide_ssa_role"))
HIDE_SHIPPED = "yes"
CATALOG_TAB = "hiring_alerts_catalog"
MAIL_LOG_TAB = "mail"
POLICY_ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
# SSA_EDITION_PROFILE, SSA_EDITION_NOTES, SSA_EDIT_COLUMNS and SSA_EDIT_LOCKED
EDITION = "ssa.profile"
EDITION_NOTES = "ssa.notes"
# the admin notes: the master, and whom App Control's Notes row names; with no badges on it, a badge from ADMIN up
# (Supervisor, Director…)
NOTES_FEATURE = "ssa-profiles.notes"
NOTES_FLOOR = "ADMIN"
EDIT_COLUMNS = {"name": "ssa_name", "phone": "ssa_phone", "email": "ssa_email"}
# what no client record holds: the SSA's own row beside the notes, one per SSA; each field's longest value
DETAILS_TAB = "ssa_details"
DETAILS_HEADER = ("id", "ssa_key", "ssa_name", "agency", "office_address", "by", "at")
EDIT_OWN = {"agency": 120, "office_address": 300}
EDIT_LOCKED = {
    "name": {"why": "No current client's Hub record names this SSA, so the name is changed on the client's record.",
             "door": "Clients, on each client's record"}}
NAME_MAX = 120
# an entry of the Documents or the Activity edited or removed: one row per SSA, list and entry, laid over each read
LIST_TAB = "ssa_list_edits"
LIST_HEADER = ("id", "ssa_key", "ssa_name", "list", "item", "fields", "title", "date", "body", "state", "by", "at")
LISTS = {"documents": {"edition": "ssa.documents", "fields": ("title", "date"), "what": "The documents"},
         "activity": {"edition": "ssa.activity", "fields": ("title", "body"), "what": "The activity"}}
LIST_REMOVED = "removed"
LIST_STATES = ("shown", LIST_REMOVED)
LIST_TITLE_MAX = 200
NOTE_ITEM = "note_"

_WS = L._JS_WS
_KEY = re.compile(r"ssa_[a-z0-9]{3,120}")
_EMAIL = re.compile(r"[^" + _WS + r"@]+@[^" + _WS + r"@]+\.[a-z]{2,}")
_AGENCY = re.compile(r"@([a-z0-9.-]+\.[a-z]{2,})\Z")
_MIME = re.compile(r"\.([a-z0-9]{2,5})[" + _WS + r"]*\Z", re.I | re.A)
_ADDRESS = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I | re.A)
_ISO_DAY = re.compile(r"\d{4}-\d{2}-\d{2}", re.A)
_SEP_SSN = re.compile(r"(^|\D)\d{3}[" + _WS + r".-]\d{2}[" + _WS + r".-]\d{4}(?=\D|\Z)", re.A)
_SEP_CARD = re.compile(r"(^|\D)\d(?:[ -]?\d){12,18}(?=\D|\Z)", re.A)


# ---- pure helpers ------------------------------------------------------------------------------------------------

def unknown() -> dict[str, Any]:
    """ssaProfilesUnknown_."""
    return {"status": 404, "message": "Unknown action."}


def _said(what: str, why: str) -> str:
    """ssaWhy_."""
    return f"{what} could not be read ({why})."


def _caught(fn: Callable[[], Any]) -> str | None:
    """A try/catch of the .gs: None when it ran, else its words; what the copy cannot answer is never swallowed."""
    try:
        fn()
    except (hubdb.Unreadable, Defer):
        raise
    except Exception as e:  # noqa: BLE001 - the code being ported says why in words
        return L._why(e)
    return None


def _cmp(fn: Callable[[Any, Any], int]) -> Callable[[Any], Any]:
    return functools.cmp_to_key(fn)


def _newest(a: dict, b: dict) -> int:
    """ssaNewest_."""
    return 1 if a["at"] < b["at"] else (-1 if a["at"] > b["at"] else 0)


def key_of(name: Any) -> str:
    """ssaKeyOf_: 'ssa_' + the folded name; '' for a blank or a non-person."""
    n = gsjs.text(name, 200)
    if not n or not C.guardian_is_person(n):
        return ""
    fold = name_key(n)
    return "ssa_" + fold if len(fold) >= 3 else ""


def email_of(v: Any) -> str:
    """ssaEmail_."""
    s = gsjs.text(v, 200).lower()
    return s if _EMAIL.fullmatch(s) else ""


def agency_of(email: Any) -> str:
    """ssaAgency_: a board's domain names its agency; a free mailbox names none."""
    m = _AGENCY.search(gsjs.trim(gsjs.or_text(email)).lower())
    if not m:
        return ""
    if m.group(1) in AGENCIES:
        return AGENCIES[m.group(1)]
    return m.group(1) if m.group(1) not in FREE_MAIL else ""


def most(values: list[Any]) -> str:
    """ssaMost_: the most common non-blank value, the first seen on a tie."""
    count: dict[str, int] = {}
    best, n = "", 0
    for v in values or []:
        s = gsjs.or_text(v)
        if not s:
            continue
        count[s] = count.get(s, 0) + 1
        if count[s] > n:
            best, n = s, count[s]
    return best


def pick(items: list[dict]) -> str:
    """ssaPick_: what the active clients' records say most, else what any record says."""
    return most([x["v"] for x in items if x["active"]]) or most([x["v"] for x in items])


def mime_of(name: Any) -> str:
    """ssaMime_."""
    m = _MIME.search(gsjs.or_text(name))
    return MIMES.get(m.group(1).lower(), "") if m else ""


def _v8_ms(s: str) -> int | None:
    """Date.parse past the ISO shapes: V8's legacy reading, a time with no zone on New York's clock."""
    got = C._v8_parse(s)
    if got is None:
        return None
    year, month0, d, h, mi, sec, ms, offset = got
    days = C._days_from_civil(year + month0 // 12, month0 % 12 + 1, 1) + d - 1
    local_ms = days * 86400000 + h * 3600000 + mi * 60000 + sec * 1000 + ms
    if offset is not None:
        out = local_ms - offset * 1000
    else:
        yy, mm, dd = C._civil_from_days(local_ms // 86400000)
        if not 1 <= yy <= 9998:
            raise Defer("a date the code reads outside the years this port carries")
        rest = local_ms % 86400000
        wall = datetime(yy, mm, dd, rest // 3600000, rest // 60000 % 60, rest // 1000 % 60, tzinfo=NY)
        out = local_ms - int(wall.utcoffset().total_seconds()) * 1000
    return out if abs(out) <= 8.64e15 else None


_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def when_text(v: Any) -> str:
    """ssaWhen_ of a value: a Date as ISO, an ISO text as written, any other date text parsed; '' otherwise."""
    if isinstance(v, SheetDate):
        return gsjs.iso(v.at)
    s = gsjs.trim(gsjs.or_blank(v))
    if not s or _ISO_DAY.match(s):
        return s
    t = _v8_ms(s)
    if t is None:
        return ""
    if not -62135596800000 <= t <= 253402300799999:
        raise Defer("an instant toISOString writes in its extended year form")
    return gsjs.iso(_EPOCH + timedelta(milliseconds=t))


def when_cell(v: Any, direct: bool = False, zone: str = "") -> str:
    """ssaWhen_ of a copy cell, as getValues() hands it back on its book's clock (a straight read keeps a serial)."""
    return when_text(SC._dated(v, direct, zone))


def scrub(v: Any, key: str | None = None) -> Any:
    """ssaScrub_: cpScrub_, and an SSN or a card number written with separators never leaves either."""
    if key and key in C.SCRUB_KEYS:
        return v
    if isinstance(v, str):
        return C.scrub(_SEP_CARD.sub(r"\1[withheld]", _SEP_SSN.sub(r"\1[withheld]", v)))
    if isinstance(v, list):
        return [scrub(x) for x in v]
    if isinstance(v, dict):
        return {k: scrub(x, k) for k, x in v.items()}
    return C.scrub(v)


def addresses(cells: list[Any]) -> dict[str, bool]:
    """ssaAddresses_: every e-mail address written in these cells, lower case."""
    out: dict[str, bool] = {}
    for c in cells or []:
        for a in _ADDRESS.findall(gsjs.or_blank(c)):
            out[a.lower()] = True
    return out


def followup_state(end: str, today: str) -> str:
    """ssaFollowupState_: overdue, to_schedule inside the window, current; '' with no span."""
    left = CS.csf_days(today, end) if end else None
    if left is None:
        return ""
    if left < 0:
        return "overdue"
    return "to_schedule" if left <= FOLLOWUP_DAYS else "current"


def js_number(s: Any) -> float:
    """Number(s) of a text; NaN as nan."""
    t = gsjs.trim(gsjs.or_blank(s))
    if not t:
        return 0.0
    n = SC._js_number(t)
    return float("nan") if n is None else n


def _with(data: dict, over: dict) -> dict:
    """ssaWith_."""
    return {**(data or {}), **(over or {})}


def _marked_answer(data: Any) -> Any:
    """A cell the copy withholds is Apps Script's to show."""
    if C._marked(data):
        raise Defer("the copy withholds a cell this answer shows")
    return data


# ---- who reads, and how far --------------------------------------------------------------------------------------

def ssas_of(reads: L.Reads, keys: list[str]) -> list[str]:
    """hubViewerSsasOf_: the SSAs whose records name these clients while they are live."""
    want = {k for k in keys or [] if k}
    idx, _why = L._soft(lambda: index(reads))
    if idx is None:
        return []
    out = [k for k, s in idx["ssas"].items()
           if any(C.client_live(c) and c.get("client_key") in want for c in s.get("clients") or [])]
    return sorted(out)


def gate(sess: L.Session) -> dict[str, Any]:
    """ssaProfilesGate_: the master always; anyone else only as App Control releases the app. FAIL-CLOSED."""
    user = sess.user
    if sc.is_real_master(user):
        return {"open": True, "scope": sc.scope_of("master")}
    try:
        got = sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources())
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - a gate that throws is shut, as the .gs catch
        got = None
    if not got or got.get("open") is not True or not got.get("scope"):
        return {"open": False, "scope": None}
    scope = got["scope"]
    # the operator's access sheet (10-29): SSA is open to the SSA badge, shut to Family (CLIENT and FAMILY on a
    # client's or a family member's scope), whatever badge App Control's row names
    if scope.get("kind") in ("client", "guardian"):
        return {"open": False, "scope": None}
    return {"open": True, "scope": scope}


def notes_open(sess: L.Session, g: dict[str, Any] | None = None) -> bool:
    """Who reads the admin notes (their tab, their lines in the Activity, their filing): the master; an uncut viewer
    App Control's Notes row names when it names badges, else one wearing NOTES_FLOOR or above."""
    if sc.is_real_master(sess.user):
        return True
    g = g or gate(sess)
    if not g["open"] or cut_of(g["scope"]):
        return False
    src = sess.reads.scope_sources()
    if (src.rules().get("rules") or {}).get(NOTES_FEATURE):
        return sc.profile_app_gate(NOTES_FEATURE, sess.user, src).get("open") is True
    return sc.wears_from(sess.user or {}, NOTES_FLOOR)


def notes_out(data: dict) -> dict:
    """An activity answer without its admin notes."""
    items = [i for i in data.get("items") or [] if not (isinstance(i, dict) and i.get("kind") == "note")]
    return _with(data, {"items": items, "total": max(0, int(data.get("total") or 0)
                                                    - (len(data.get("items") or []) - len(items)))})


def cut_of(scope: dict | None) -> dict | None:
    """ssaProfilesCut_: None for the master and every widening badge; else the SSAs and the clients it names."""
    kind = gsjs.str_((scope or {}).get("kind"))
    if kind in ("master", "all"):
        return None
    known = kind in ("client", "guardian", "ssa")

    def keys(items: Any) -> dict[str, bool]:
        out: dict[str, bool] = {}
        if known and isinstance(items, list):
            for k in items:
                if gsjs.str_(k):
                    out[gsjs.str_(k)] = True
        return out

    return {"kind": kind, "ssas": keys((scope or {}).get("ssa_keys")), "clients": keys((scope or {}).get("client_keys"))}


def outside(cut: dict | None, payload: dict) -> bool:
    """ssaProfilesOutside_."""
    if not cut:
        return False
    return cut["ssas"].get(gsjs.trim(gsjs.or_blank((payload or {}).get("ssa")))) is not True


def mine(cut: dict, key: Any) -> bool:
    """ssaMine_."""
    return cut["clients"].get(gsjs.or_text(key)) is True


def cut_answer(got: dict, cut: dict | None, fn: Callable[[dict, dict], dict]) -> dict:
    """ssaCutAnswer_."""
    if not cut or not got or got.get("status") != 200 or got.get("data") is None:
        return got
    return {"status": 200, "data": fn(got["data"], cut)}


# ---- Settings > My Work's SSA parts -----------------------------------------------------------------------------

def _hide_defaults(reads: L.Reads) -> dict[str, str]:
    """hubMyWorkHideDefaults_ for the SSA keys: the catalogue's default, a blank one or no row the shipped one."""
    out = {key: HIDE_SHIPPED for _p, key in HIDE_KEYS}
    db = reads.db
    if HT.tabled(CATALOG_TAB):
        headers, rows = HT.raw(reads, CATALOG_TAB)
    else:
        if not db.house_moved(CATALOG_TAB):
            return out
        res = db.resolve(CATALOG_TAB)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable("asa-hub-db holds no copy of the configuration catalogue's book")
            return out
        headers, rows = list(res.ref.headers), db.rows(res.ref)
    head = [gsjs.trim(gsjs.or_blank(h)).lower() for h in headers]
    if "key" not in head:
        return out
    at_key = headers[head.index("key")]
    at_value = headers[head.index("default_value")] if "default_value" in head else None
    wanted = set(out)
    for _rn, raw in rows:
        k = gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(at_key), "hub")))
        if k not in wanted:
            continue
        v = gsjs.or_blank(hubdb.typed(raw.get(at_value), "hub")) if at_value is not None else ""
        out[k] = v if gsjs.trim(v) else HIDE_SHIPPED
    return out


def hide_read(reads: L.Reads) -> dict[str, bool]:
    """hubMyWorkHideRead_ for the four SSA switches: anything not plainly yes hides nothing."""
    cfg = reads.config()
    defaults: dict[str, str] | None = None
    out: dict[str, bool] = {}
    for part, key in HIDE_KEYS:
        if key in cfg:
            raw = cfg[key]
        else:
            if defaults is None:
                defaults = _hide_defaults(reads)
            raw = defaults.get(key, "")
        out[part] = gsjs.trim(gsjs.or_blank(raw)).lower() in ("yes", "on", "true", "1")
    return out


def display(reads: L.Reads) -> dict | None:
    """ssaDisplay_: what every session but the master's own leaves out — the same for every caller."""
    try:
        read = hide_read(reads)
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - switches that cannot be read put no display on the answer
        return None
    return {"hidden": {part: read.get(part) is True for part, _k in HIDE_KEYS}}


def shown(reads: L.Reads, got: dict) -> dict:
    """ssaShown_: a read's answer with the display on it."""
    if not got or got.get("status") != 200 or got.get("data") is None:
        return got
    d = display(reads)
    return {"status": 200, "data": _with(got["data"], {"display": d})} if d else got


# ---- the index ---------------------------------------------------------------------------------------------------

def _index_build(reads: L.Reads) -> dict[str, Any]:
    """ssaIndexBuild_: every SSA the client records name — the active clients, then the archive's old ones."""
    why: list[str] = []
    degraded = False
    active, w = L._soft(lambda: C.derived(reads))
    if active is None:
        why.append(_said("The client records", w))
        degraded = True
    master, w = L._soft(lambda: C.master_index(reads))
    if master is None:
        why.append(_said("The Asa Client Database", w))
        degraded = True
    arch, w = L._soft(lambda: C.archive_index(reads))
    if arch is None:
        why.append(_said("The archive of old clients", w))
        degraded = True
    if active is None and arch is None:
        raise RuntimeError(" ".join(why))
    photos, _w = L._soft(lambda: C.photo_index(reads))
    photos = photos or {}
    own, w = L._soft(lambda: details_all(reads))
    if own is None:
        why.append(_said("The SSA details", w))
        degraded = True
    own = own or {}
    ssas: dict[str, dict] = {}
    seen: dict[str, bool] = {}
    names: dict[str, bool] = {}

    def take(rec: dict, client: dict) -> None:
        key = key_of(rec.get("ssa_name"))
        if not key:
            return
        s = ssas.setdefault(key, {"names": [], "phones": [], "emails": [], "counties": [], "clients": []})
        live = C.client_live(client)
        s["names"].append({"v": gsjs.text(rec.get("ssa_name"), 120), "active": live})
        phone = C.cp_phone(rec.get("ssa_phone"))
        if SC._digits10(phone):
            s["phones"].append({"v": phone, "active": live})
        em = email_of(rec.get("ssa_email"))
        if em:
            s["emails"].append({"v": em, "active": live})
        county = gsjs.text(rec.get("county"), 80)
        if county:
            s["counties"].append({"v": county, "active": live})
        client["ssa_email"] = em
        s["clients"].append(client)

    for c in active or []:
        row = C.roster_row(c, photos)
        if not row["client_key"] or row["client_key"] in seen:
            continue
        seen[row["client_key"]] = True
        names[name_key(row["name"])] = True
        m = master["rows"].get(name_key(row["name"])) if master else None
        # set inactive, its Master row went to the archive: that row still names its SSA
        if not m and arch and not C.client_live(row):
            m = arch["rows"].get(name_key(row["name"])) or None
        mf = m["fields"] if m and not m["ambiguous"] else {}
        src = c if gsjs.text(c.get("ssa_name")) else mf
        named = name_key(src.get("ssa_name"))
        a = c if name_key(c.get("ssa_name")) == named else {}
        b = mf if name_key(mf.get("ssa_name")) == named else {}
        take({"ssa_name": src.get("ssa_name"), "ssa_phone": C._or(a.get("ssa_phone"), b.get("ssa_phone")),
              "ssa_email": C._or(a.get("ssa_email"), b.get("ssa_email")), "county": c.get("county")},
             {"client_key": row["client_key"], "name": row["name"], "house": row["house"], "status": row["status"],
              "avatar": row["avatar"], "isp_year": row["isp_year"],
              "isp_signed": C.cp_day(C._or(c.get("isp_signed_date"), mf.get("isp_signed_date"))), "archived": False})
    if arch:
        for k in arch["order"]:
            hit = arch["rows"].get(k)
            if not hit or hit["ambiguous"] or k in seen or k in names:
                continue
            seen[k] = True
            f = hit.get("fields") or {}
            take({"ssa_name": f.get("ssa_name"), "ssa_phone": f.get("ssa_phone"), "ssa_email": f.get("ssa_email"),
                  "county": ""},
                 {"client_key": k, "name": gsjs.text(hit.get("name")), "house": gsjs.text(f.get("house")),
                  "status": "inactive", "avatar": P.of(reads, "clients", k, photos.get(k)), "isp_year": "",
                  "isp_signed": C.cp_day(f.get("isp_signed_date")), "archived": True})
    out: dict[str, dict] = {}
    phones: dict[str, dict[str, bool]] = {}
    for k, s in ssas.items():
        s["clients"].sort(key=_cmp(lambda x, y: (0 if x["status"] == y["status"] else (-1 if x["status"] == "active"
                                                                                      else 1))
                                   or gsjs.locale_cmp(x["name"], y["name"])))
        digits: dict[str, bool] = {}
        emails: dict[str, bool] = {}
        for p in s["phones"]:
            digits[SC._digits10(p["v"])] = True
        for e in s["emails"]:
            emails[e["v"]] = True
        for d in SC._js_keys(digits):
            phones.setdefault(d, {})[k] = True
        em = pick(s["emails"])
        d = own.get(details_id(k)) or {}
        out[k] = {"key": k, "name": pick(s["names"]), "phone": pick(s["phones"]), "email": em,
                  "agency": gsjs.text(d.get("agency"), EDIT_OWN["agency"]) or agency_of(em),
                  "office_address": gsjs.text(d.get("office_address"), EDIT_OWN["office_address"]),
                  "county": pick(s["counties"]), "avatar": P.of(reads, "ssa", k, photos.get(k[4:])),
                  "status": "active" if any(C.client_live(c) for c in s["clients"]) else "inactive",
                  "clients": s["clients"], "phones": SC._js_keys(digits), "emails": list(emails)}
    return {"ssas": out, "phones": phones, "why": why, "degraded": degraded}


def index(reads: L.Reads) -> dict[str, Any]:
    """ssaIndex_, once per request."""
    return reads.once("ssa_index", lambda: _index_build(reads))


def details_id(key: str) -> str:
    """The id of an SSA's own details row, made from the key: one row per SSA."""
    return "SSAD_" + key


def details_all(reads: L.Reads) -> dict[str, dict]:
    """ssa_details by row id, once per request; none while the tab is unborn."""
    def read() -> dict[str, dict]:
        res = reads.db.resolve(DETAILS_TAB)
        if res.runtime:
            raise Defer(f"{DETAILS_TAB} lives in the depot's facts")
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {DETAILS_TAB}")
            return {}
        out: dict[str, dict] = {}
        for r in reads.db.locations_rows(res.ref):
            rid = gsjs.trim(gsjs.or_text(r.get("id")))
            if rid and rid not in out:
                out[rid] = r
        return out
    return reads.once("ssa_details", read)


def list_id(key: str, lst: str, item: str) -> str:
    """The id of an entry's own edit row, made from the SSA, the list and the entry: one row each."""
    return "SSAX_" + hashlib.sha256(f"{lst}|{key}|{item}".encode()).hexdigest()[:32]


def list_edits(reads: L.Reads) -> dict[str, dict[str, dict[str, dict]]]:
    """ssa_list_edits as {ssa key: {list: {entry id: row}}}, once per request; none while the tab is unborn."""
    def read() -> dict[str, dict[str, dict[str, dict]]]:
        res = reads.db.resolve(LIST_TAB)
        if res.ref is None:
            if res.runtime or not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {LIST_TAB}")
            return {}
        out: dict[str, dict[str, dict[str, dict]]] = {}
        for r in reads.db.locations_rows(res.ref):
            key, lst, item = (gsjs.trim(gsjs.or_text(r.get(f))) for f in ("ssa_key", "list", "item"))
            if key and lst in LISTS and item:
                # the newest row of an entry stands: a renamed SSA's later edit is a row of its new key
                out.setdefault(key, {}).setdefault(lst, {})[item] = r
        return out
    return reads.once("ssa_list_edits", read)


def list_laid(reads: L.Reads, key: str, lst: str) -> dict[str, dict]:
    """One SSA's edited entries of one list, by entry id."""
    return list_edits(reads).get(key, {}).get(lst, {})


def list_fields(row: dict | None) -> list[str]:
    """The fields an entry's edit row carries."""
    return [f for f in sc.list_cell((row or {}).get("fields")) if f in ("title", "date", "body")]


def lay(entry: dict, row: dict | None) -> dict | None:
    """An entry as its edit row leaves it: None once removed, else with each field the row carries."""
    if row is None:
        return entry
    if gsjs.trim(gsjs.or_text(row.get("state"))) == LIST_REMOVED:
        return None
    return {**entry, **{f: gsjs.or_text(row.get(f)) for f in list_fields(row) if f in entry}}


def ssa_ctx(reads: L.Reads, raw: Any) -> dict[str, Any]:
    """ssaProfilesSsa_: 400 when no client record names the key, 503 when the records cannot say."""
    key = gsjs.trim(gsjs.or_blank(raw))
    none = {"refused": {"status": 400, "message": f'No SSA "{SC._js_slice(key, 120)}" is on file.'}}
    if not _KEY.fullmatch(key):
        return none
    try:
        idx = index(reads)
    except (Defer, hubdb.Unreadable):
        raise
    except Exception as e:  # noqa: BLE001 - the port's own words
        return {"refused": {"status": 503, "message": "The client records could not be read just now ("
                            + L._why(e) + ") — nothing is said about this SSA."}}
    s = idx["ssas"].get(key)
    if not s:
        if idx["degraded"]:
            return {"refused": {"status": 503, "message": "Not every client record could be read just now ("
                                + SC._js_slice(" ".join(idx["why"]), 200) + ") — nothing is said about this SSA."}}
        return none
    return {"key": key, "name": s["name"], "ssa": s, "index": idx, "why": list(idx["why"]),
            "degraded": bool(idx["degraded"])}


def serve(reads: L.Reads, what: str, data: Callable[[], dict]) -> dict[str, Any]:
    """ssaServe_: one read's answer; 503 names the source when the build throws."""
    try:
        got = data()
    except (Defer, hubdb.Unreadable):
        raise
    except Exception as e:  # noqa: BLE001 - the port's own words
        return {"status": 503, "message": f"{what} could not be read just now ({L._why(e)})."}
    return {"status": 200, "data": got}


def _kept(reads: L.Reads, action: str, ctx: dict, build: Callable[[], dict]) -> Callable[[], dict]:
    """ssaCached_ for this request: the scrubbed build, once per SSA and read."""
    return lambda: reads.once(f"ssa_{action}:{ctx['key']}", lambda: _marked_answer(scrub(build())))


def isps_by_key(reads: L.Reads) -> dict[str, dict]:
    """ssaIspsByKey_: the first plan row of each client."""
    def read() -> dict[str, dict]:
        out: dict[str, dict] = {}
        for r in C._hub(reads, "isps"):
            k = gsjs.trim(gsjs.or_text(r.get("client_key")))
            if k and k not in out:
                out[k] = r
        return out
    return reads.once("ssa_isps", read)


# ---- the roster --------------------------------------------------------------------------------------------------

def roster_build(reads: L.Reads, cut: dict | None) -> dict[str, Any]:
    """ssaRosterBuild_: every SSA, or with a cut only the SSAs in it, each counting only the clients in it."""
    idx = index(reads)
    keys = [k for k in idx["ssas"] if not cut or cut["ssas"].get(k) is True]
    rows = []
    for k in keys:
        s = idx["ssas"][k]
        n = sum(1 for c in s["clients"] if mine(cut, c.get("client_key"))) if cut else len(s["clients"])
        rows.append({"key": s["key"], "name": s["name"], "phone": s["phone"], "email": s["email"], "agency": s["agency"],
                     "county": s["county"], "clients": n, "status": s["status"], "avatar": s["avatar"]})
    rows.sort(key=L.by_name(lambda r: r["name"]))
    return {"ssas": rows, "why": list(idx["why"]), "degraded": bool(idx["degraded"])}


def ssa_profile_roster(sess: L.Session, payload: dict) -> dict[str, Any]:
    """ssaProfileRoster: every SSA the session may see; `viewer` says how far it sees."""
    g = gate(sess)
    if not g["open"]:
        return unknown()
    cut = cut_of(g["scope"])
    try:
        data = _marked_answer(scrub(roster_build(sess.reads, cut)))
    except (Defer, hubdb.Unreadable):
        raise
    except Exception as e:  # noqa: BLE001 - the port's own words
        return {"status": 503, "message": f"The SSA list could not be read just now ({L._why(e)})."}
    return {"status": 200, "data": _with(data, {"viewer": gsjs.str_(g["scope"].get("kind")),
                                                "notes": notes_open(sess, g)})}


# ---- overview ----------------------------------------------------------------------------------------------------

def overview_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """ssaOverviewBuild_."""
    s = ctx["ssa"]
    why = list(ctx["why"])
    degraded = ctx["degraded"]
    labels: dict[str, str] = {}
    homes, w = L._soft(reads.homes)
    if homes is None:
        why.append(_said("The house registry", w))
        degraded = True
    for h in homes or []:
        if h.get("code") and h.get("home_name"):
            labels[h["code"]] = h["home_name"]
    clients = []
    for c in s["clients"]:
        code = L.house_code(c.get("house")) or L.code_of(c.get("house"))
        clients.append({"client_key": c["client_key"], "name": c["name"], "house": c["house"],
                        "house_label": (labels.get(code) if code else "") or c["house"], "avatar": c["avatar"],
                        "status": c["status"]})
    return {"ssa": {"key": s["key"], "name": s["name"], "phone": s["phone"], "email": s["email"],
                    "agency": s["agency"], "county": s["county"], "office_address": s.get("office_address") or "",
                    "avatar": s["avatar"], "status": s["status"]},
            "clients": clients, "why": why, "degraded": degraded}


def overview_cut(data: dict, cut: dict) -> dict:
    """ssaOverviewCut_: the SSA's details and only the clients in scope."""
    return _with(data, {"clients": [c for c in data.get("clients") or [] if mine(cut, c.get("client_key"))]})


def overview_door(reads: L.Reads, ctx: dict, cut: dict | None = None) -> dict[str, Any]:
    """ssaOverviewDoor_ past the gate."""
    if ctx.get("refused"):
        return ctx["refused"]
    got = serve(reads, "The SSA", _kept(reads, "ssaProfileOverview", ctx, lambda: overview_build(reads, ctx)))
    return shown(reads, cut_answer(got, cut, overview_cut))


def ssa_profile_overview(sess: L.Session, payload: dict) -> dict[str, Any]:
    """ssaProfileOverview: the SSA's details and every client whose record names them, the active ones first."""
    g = gate(sess)
    if not g["open"]:
        return unknown()
    cut = cut_of(g["scope"])
    if outside(cut, payload):
        return unknown()
    return overview_door(sess.reads, ssa_ctx(sess.reads, payload.get("ssa")), cut)


def ssa_profile_edit_read(sess: L.Session, payload: dict) -> dict[str, Any]:
    """ssaProfileEditRead (Python's own): the edit panel's read — the overview with the fields its save is…"""
    g = gate(sess)
    if not g["open"] or cut_of(g["scope"]):
        return unknown()
    return overview_edit(sess, payload)


# ---- documents ---------------------------------------------------------------------------------------------------

def documents_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """ssaDocumentsBuild_: each client's plan, and the plan files the Clients app lists for them, newest first."""
    s = ctx["ssa"]
    why = list(ctx["why"])
    degraded = ctx["degraded"]
    docs: list[dict] = []
    seen: dict[str, bool] = {}
    edited = list_laid(reads, s["key"], "documents")

    def add(d: dict) -> None:
        k = "f:" + d["file_id"] if d["file_id"] else "r:" + d["id"]
        if k in seen:
            return
        # a removed entry keeps its file's place: another entry naming the same file stays out too
        seen[k] = True
        laid = lay(d, edited.get(d["id"]))
        if laid is not None:
            docs.append(laid)

    by_key: dict[str, dict] = {}
    by_name: dict[str, dict] = {}
    for c in s["clients"]:
        by_key[c["client_key"]] = c
        by_name[name_key(c["name"])] = c
    isps: dict[str, dict] = {}
    got, w = L._soft(lambda: isps_by_key(reads))
    if got is None:
        why.append(_said("The plans", w))
        degraded = True
    else:
        isps = got
    # Drive not listing the plans folder here is Apps Script's to answer: isp_files defers
    C.isp_files(reads)
    for c in s["clients"]:
        isp = isps.get(c["client_key"])
        doc, _w = L._soft(lambda c=c: C.isp_doc(reads, c["name"]))
        doc = doc or {"id": ""}
        if not doc.get("id") and not isp:
            continue
        year = gsjs.text((isp or {}).get("isp_year"), 80)
        add({"id": "isp_" + c["client_key"],
             "title": (gsjs.text(doc.get("name")) if doc.get("id") else "")
             or ("Individual Service Plan" + (" " + year if year else "")),
             "kind": "isp", "client_key": c["client_key"], "client_name": c["name"],
             "date": c["isp_signed"] or C.cp_day((isp or {}).get("loaded_at")),
             "file_id": gsjs.or_text(doc.get("id")), "mime": mime_of(doc.get("name")) if doc.get("id") else "",
             "source": "Plans folder" if doc.get("id") else "Plan on file"})

    def files() -> None:
        for r in C.client_files(reads):
            c = by_key.get(gsjs.trim(gsjs.or_text(r.get("client_key")))) or by_name.get(name_key(r.get("client_name")))
            if not c or not C.plan_file(r):
                continue
            fid = gsjs.or_text(r.get("drive_id")) or L.drive_id(r.get("url"))
            folder = gsjs.text(r.get("folder"))
            add({"id": "cf_" + (gsjs.or_text(r.get("id")) or fid),
                 "title": gsjs.text(r.get("title")) or folder or "Client document",
                 "kind": "client_doc", "client_key": c["client_key"], "client_name": c["name"],
                 "date": C.cp_day(r.get("issued_on")) or C.cp_day(r.get("file_date")), "file_id": fid,
                 "mime": gsjs.text(r.get("mime_type")) or mime_of(r.get("title")),
                 "source": "Client files" + (" · " + folder if folder else "")})

    w = _caught(files)
    if w is not None:
        why.append(_said("The client files", w))
        degraded = True
    docs.sort(key=_cmp(lambda a, b: (1 if a["date"] < b["date"] else (-1 if a["date"] > b["date"] else 0))
                       or gsjs.locale_cmp(a["title"], b["title"])))
    return {"docs": docs, "why": why, "degraded": degraded}


def documents_data(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """ssaDocuments_."""
    return _kept(reads, "ssaProfileDocuments", ctx, lambda: documents_build(reads, ctx))()


def documents_cut(data: dict, cut: dict) -> dict:
    """ssaDocumentsCut_: only those of the clients in scope."""
    return _with(data, {"docs": [d for d in data.get("docs") or [] if mine(cut, d.get("client_key"))]})


def documents_door(reads: L.Reads, ctx: dict, cut: dict | None = None) -> dict[str, Any]:
    """ssaDocumentsDoor_ past the gate."""
    if ctx.get("refused"):
        return ctx["refused"]
    got = serve(reads, "The documents", lambda: documents_data(reads, ctx))
    return cut_answer(got, cut, documents_cut)


def ssa_profile_documents(sess: L.Session, payload: dict) -> dict[str, Any]:
    """ssaProfileDocuments; while Settings › My Work hides SSA's Documents, the master's alone."""
    import editions as E  # noqa: PLC0415 - editions reads the scope this module reads
    g = gate(sess)
    if not g["open"] or E.hides_for(sess).get("ssa_documents"):
        return unknown()
    cut = cut_of(g["scope"])
    if outside(cut, payload):
        return unknown()
    return documents_door(sess.reads, ssa_ctx(sess.reads, payload.get("ssa")), cut)


def ssa_profile_doc_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """ssaProfileDocFile: one document the SSA's own Documents list names, as bytes for the platform's viewer."""
    g = gate(sess)
    if not g["open"]:
        return unknown()
    cut = cut_of(g["scope"])
    if outside(cut, payload):
        return unknown()
    reads = sess.reads
    ctx = ssa_ctx(reads, payload.get("ssa"))
    if ctx.get("refused"):
        return ctx["refused"]
    fid = gsjs.text(payload.get("file_id"), 120)
    if not L.is_file_id(fid):
        return {"status": 400, "message": "file_id: a Drive file id."}
    try:
        docs = documents_data(reads, ctx).get("docs") or []
        if cut:
            docs = documents_cut({"docs": docs}, cut)["docs"]
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - the port's own words
        return {"status": 503, "message": "The documents could not be read just now — try again in a minute."}
    if not any(d.get("file_id") == fid for d in docs):
        return {"status": 404, "message": "This SSA names no such document."}
    got = L.doc_file(reads, fid)
    if got.get("refused"):
        return got["refused"]
    return {"status": 200, "data": {"id": fid, **got}}


# ---- activity ----------------------------------------------------------------------------------------------------

def own_phones(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """ssaOwnPhones_: the SSA's phones that name them alone; another SSA's or a company line is dropped."""
    owned: dict[str, bool] = {}
    shared = 0
    for d in ctx["ssa"].get("phones") or []:
        others = [k for k in SC._js_keys((ctx["index"].get("phones") or {}).get(d) or {}) if k != ctx["key"]]
        ours = False
        if not others:
            try:
                ours = bool(SC._line_ours(reads, d))
            except (Defer, hubdb.Unreadable):
                raise
            except Exception:  # noqa: BLE001 - as the .gs catch: not a company line
                ours = False
        if others or ours:
            shared += 1
            continue
        owned[d] = True
    return {"mine": owned, "shared": shared}


def _texts_rows(reads: L.Reads, ref: hubdb.TabRef, spec: dict[str, tuple],
                owned: dict[str, bool]) -> tuple[bool, list[tuple[int, dict]]]:
    """spReadColumns_ of the texts house, only the rows whose number cells hold one of these phones' ten digits."""
    if isinstance(ref, HT.KeptRef):
        return SC._read_columns(reads, ref, spec, ("sides", ("from", "to"), sorted(owned)) if owned else None)
    own = hubdb.OWN.get()
    if not owned or ref.row_count < 0 or SC._direct(reads, ref.sheet_id) or any(
            w.get("sheet_id") == ref.sheet_id and w.get("tab_name") == ref.tab for w in getattr(own, "items", None) or []):
        return SC._read_columns(reads, ref, spec)
    picked: dict[str, str | None] = {}
    for cid, (names, at) in spec.items():
        found = next((n for n in names if n in ref.headers), None)
        if found is None and at is not None and at < len(ref.headers):
            raise Defer(f"{ref.tab} has no {names[0]} column and its position in the sheet is not in the copy")
        picked[cid] = found
    got = reads.db.query("select columns from catalog.tabs where sheet_id = %s and tab_name = %s and gone_at is null",
                         (ref.sheet_id, ref.tab))
    cols = got[0][0] if got else []
    cols = cols if isinstance(cols, list) else json.loads(cols or "[]")
    by = {str(h): str(c) for h, c in cols}
    want = [h for h in dict.fromkeys(h for h in picked.values() if h) if h in by]
    if any(not re.fullmatch(r"[a-z0-9_]{1,63}", by[h]) for h in want) or not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table):
        raise hubdb.Unreadable(f"the catalog names an unusable column of {ref.tab}")
    sides = [by[picked[c]] for c in ("from", "to") if picked.get(c) in want]
    reads.db.note_book(ref.sheet_id)
    if not sides:
        return False, []
    digits = sorted(owned)
    where = " or ".join(f"""regexp_replace(coalesce("{s}"::text, ''), '[^0-9]', '', 'g') like %s"""
                        for s in sides for _d in digits)
    sel = "".join(f', "{by[h]}"' for h in want)
    rows = reads.db.query(f'select row_number{sel} from {reads.db.from_sql(ref)} where {where} order by row_number',  # noqa: S608
                          tuple(f"%{d}%" for _s in sides for d in digits))
    out = []
    for r in rows:
        raw = {h: r[i + 1] for i, h in enumerate(want)}
        out.append((int(r[0]), {cid: (raw.get(h) if h else None) for cid, h in picked.items()}))
    return False, out


def texts(reads: L.Reads, own: dict, since: str) -> list[dict]:
    """ssaTexts_: texts on the company lines to or from the SSA's own phones since `since`."""
    ref = SC._tab(reads, SC.QUO_MESSAGES_TAB)
    if ref is None:
        raise RuntimeError("the texts house (quo_messages) could not be opened")
    owned = own["mine"]
    direct, rows = _texts_rows(reads, ref, {
        "id": (("message_id",), None), "created": (("message_created",), None), "event": (("event_at",), None),
        "received": (("received_at",), None), "dir": (("direction",), None), "from": (("from_number",), None),
        "to": (("to_number",), None), "body": (("body",), None), "quo": (("quo_number",), None)}, owned)
    out = []
    for rn, c in rows:
        d = gsjs.trim(gsjs.or_text(SC._typed(c["dir"], direct))).lower()
        incoming = d in ("incoming", "inbound")
        if not any(x in owned for x in SC._numbers(SC._js_text(c["from"] if incoming else c["to"], direct))):
            continue
        at = when_cell(c["created"], direct) or when_cell(c["event"], direct) or when_cell(c["received"], direct)
        if not at or at[:10] < since:
            continue
        quo = gsjs.trim(gsjs.or_text(SC._typed(c["quo"], direct)))
        line = next((x for x in SC._numbers(SC._js_text(c["to"] if incoming else c["from"], direct)) if x not in owned),
                    "") or quo
        who = SC._line_of(reads, line, quo)
        out.append({"id": "sms_" + (gsjs.or_text(SC._typed(c["id"], direct)) or f"row{rn}"), "at": at,
                    "incoming": incoming, "line": who["label"], "owner": who["owner"],
                    "body": SC._js_text(c["body"], direct)})
    return out


def calls(reads: L.Reads, own: dict, since: str, why: list[str]) -> dict[str, Any]:
    """ssaCalls_: calls with the SSA's own phones in the hotline book and the transcripts house; never the words."""
    found: dict[str, dict] = {}
    degraded = False
    owned = own["mine"]

    def take(cid: str, at: str, secs: str, direction: str, team: str) -> None:
        if not cid or cid in found or not at or at[:10] < since:
            return
        found[cid] = {"id": "call_" + cid, "at": at, "secs": secs, "direction": direction.lower(),
                      "line": "+1" + team if team else ""}

    hot_id = gsjs.str_(reads.db.prop("HOTLINE_TRANSCRIPTS_ID"))
    hot = reads.tab_of(hot_id, SC.HOTLINE_TRANSCRIPTS_TAB, "the hotline transcripts") if hot_id else None
    if hot is None:
        why.append("The hotline transcripts book could not be opened, so its calls are not listed.")
        degraded = True
    else:
        cols = SC.HOTLINE_COLS
        hd, rows = SC._read_columns(reads, hot, {
            "id": (("Call ID",), cols["CALL_ID"]), "created": (("Transcript Created",), 1),
            "event": (("Event Timestamp",), cols["EVENT_TS"]), "secs": (("Duration (sec)",), 3),
            "who": (("Participant(s)",), cols["PARTICIPANTS"]), "team": (("Team Member(s)",), cols["TEAM"]),
            "dir": (("Direction",), None)})
        hz = gsjs.book_zone(hot.sheet_id, reads.db.prop)
        for _rn, h in rows:
            if not any(d in owned for d in SC._numbers(SC._js_text(h["who"], hd))):
                continue
            at = when_cell(h["event"], hd, hz) or when_cell(h["created"], hd, hz)
            take(gsjs.trim(gsjs.or_text(SC._typed(h["id"], hd))), at, SC._js_text(h["secs"], hd),
                 gsjs.or_text(SC._typed(h["dir"], hd)), next(iter(SC._numbers(SC._js_text(h["team"], hd))), ""))

    def quo() -> None:
        ref = SC._tab(reads, SC.QUO_TRANSCRIPTS_TAB)
        if ref is None:
            return
        qd, qrows = SC._read_columns(reads, ref, {
            "id": (("call_id",), None), "created": (("transcript_created",), None), "event": (("event_at",), None),
            "secs": (("duration_s",), None), "dir": (("direction",), None), "who": (("participants",), None),
            "team": (("team_members",), None)})
        for _rn, q in qrows:
            if not any(d in owned for d in SC._numbers(SC._js_text(q["who"], qd))):
                continue
            take(gsjs.trim(gsjs.or_text(SC._typed(q["id"], qd))),
                 when_cell(q["created"], qd) or when_cell(q["event"], qd), SC._js_text(q["secs"], qd),
                 gsjs.or_text(SC._typed(q["dir"], qd)), next(iter(SC._numbers(SC._js_text(q["team"], qd))), ""))

    w = _caught(quo)
    if w is not None:
        why.append(_said("The transcripts house", w))
        degraded = True
    return {"calls": [found[k] for k in SC._js_keys(found)], "degraded": degraded}


def mail(reads: L.Reads, emails: list[str], since: str) -> list[dict]:
    """ssaMail_: the mail log's envelopes to, from or copying one of the SSA's addresses since `since`."""
    ref = SC._tab(reads, MAIL_LOG_TAB)
    if ref is None:
        raise RuntimeError(f"the mail log ({MAIL_LOG_TAB}) could not be opened")
    md, rows = SC._read_columns(reads, ref, {
        "id": (("id",), None), "at": (("at",), None), "dir": (("direction",), None), "from": (("from",), None),
        "to": (("to",), None), "cc": (("cc",), None), "subject": (("subject",), None),
        "preview": (("preview",), None)})
    out = []
    for rn, c in rows:
        frm, to, cc = (SC._js_text(c[k], md) for k in ("from", "to", "cc"))
        seen = addresses([frm, to, cc])
        if not any(e in seen for e in emails):
            continue
        at = when_cell(c["at"], md)
        if not at or at[:10] < since:
            continue
        sender = addresses([frm])
        out.append({"id": "mail_" + (gsjs.or_text(SC._typed(c["id"], md)) or f"row{rn}"), "at": at,
                    "from_ssa": any(e in sender for e in emails), "from": gsjs.text(SC._typed(c["from"], md), 200),
                    "subject": gsjs.text(SC._typed(c["subject"], md), 200), "preview": SC._js_text(c["preview"], md)})
    return out


def notes_for(reads: L.Reads, key: str) -> list[dict]:
    """ssaNotesFor_: one SSA's notes, newest first; none while the tab is unborn."""
    res = reads.db.resolve(NOTES_TAB)
    if res.runtime:
        raise Defer(f"{NOTES_TAB} lives in the depot's facts")
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {NOTES_TAB}")
        return []
    # a note is an entry of the Activity: its text edited there is the note's, and removed there it leaves the notes
    edited = list_laid(reads, key, "activity")
    out = []
    for r in reads.db.locations_rows(res.ref):
        if gsjs.or_text(r.get("ssa_key")) != key:
            continue
        n = {"id": gsjs.or_text(r.get("id")), "at": gsjs.or_text(r.get("at")), "by": gsjs.or_text(r.get("by")),
             "body": gsjs.or_text(r.get("body"))}
        laid = lay(n, edited.get(NOTE_ITEM + n["id"]))
        if laid is not None:
            out.append(laid)
    out.sort(key=_cmp(_newest))
    return out


def activity_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """ssaActivityBuild_: notes, texts, calls, e-mails and the records naming the SSA, newest first; ISP reviews."""
    s = ctx["ssa"]
    why = list(ctx["why"])
    degraded = ctx["degraded"]
    since = gsjs.day_shift(reads.today(), -ACTIVITY_DAYS)
    items: list[dict] = []
    edited = list_laid(reads, s["key"], "activity")

    def add(iid: str, at: Any, kind: str, title: str, body: Any, by: Any, client_key: str) -> None:
        w = when_text(at)
        if not w:
            return
        laid = lay({"title": title, "body": body}, edited.get(iid))
        if laid is None:
            return
        items.append({"id": iid, "at": w, "kind": kind, "title": laid["title"], "body": gsjs.text(laid["body"], 240),
                      "by": gsjs.or_text(by), "client_key": client_key or ""})

    def notes() -> None:
        for n in notes_for(reads, s["key"]):
            add("note_" + n["id"], n["at"], "note", "Admin note", n["body"], n["by"], "")

    w = _caught(notes)
    if w is not None:
        why.append(_said("The SSA notes", w))
        degraded = True
    isps: dict[str, dict] = {}
    got, w = L._soft(lambda: isps_by_key(reads))
    if got is None:
        why.append(_said("The plans", w))
        degraded = True
    else:
        isps = got
    for c in s["clients"]:
        isp = isps.get(c["client_key"])
        year = gsjs.text(C._or((isp or {}).get("isp_year"), c.get("isp_year")), 80)
        add("record_" + c["client_key"], c["isp_signed"] or C.cp_day((isp or {}).get("loaded_at")), "record",
            "Named SSA — " + c["name"], ("ISP signed" if c["isp_signed"] else "ISP on file") + (" · " + year if year
                                                                                               else ""),
            "", c["client_key"])
    own = own_phones(reads, ctx)
    count = len(own["mine"])
    if own["shared"]:
        why.append(f"{own['shared']} phone number(s) on the records also belong to another SSA or to a company line, "
                   "so texts and calls on them are not attributed.")
    if count:
        def sms() -> None:
            for t in texts(reads, own, since):
                add(t["id"], t["at"], "sms", ("Text from " if t["incoming"] else "Text to ") + s["name"] + " · "
                    + t["line"], t["body"], s["name"] if t["incoming"] else t["owner"], "")

        w = _caught(sms)
        if w is not None:
            why.append(_said("The texts", w))
            degraded = True

        def phone() -> None:
            nonlocal degraded
            got = calls(reads, own, since, why)
            if got["degraded"]:
                degraded = True
            for k in got["calls"]:
                n = js_number(k["secs"])
                mins = f"{int(max(1.0, gsjs.js_round(n / 60)))} min" if n > 0 else ""
                add(k["id"], k["at"], "call", ("Call to " if k["direction"] == "outgoing" else "Call with ") + s["name"],
                    " · ".join(x for x in (k["line"], mins) if x), "", "")

        w = _caught(phone)
        if w is not None:
            why.append(_said("The calls", w))
            degraded = True
    if s["emails"]:
        def envelopes() -> None:
            for m in mail(reads, s["emails"], since):
                add(m["id"], m["at"], "mail", m["subject"] or "(no subject)", m["preview"],
                    s["name"] if m["from_ssa"] else m["from"], "")

        w = _caught(envelopes)
        if w is not None:
            why.append(_said("The mail log", w))
            degraded = True
    items.sort(key=_cmp(_newest))
    today = reads.today()
    rank = {"overdue": 0, "to_schedule": 1, "current": 2, "": 3}
    followups = []
    for c in s["clients"]:
        if not C.client_live(c):
            continue
        isp = isps.get(c["client_key"])
        span = CS.csf_span(C._or((isp or {}).get("isp_year"), c.get("isp_year")))
        due = span["end"] if span else ""
        followups.append({"client_key": c["client_key"], "name": c["name"], "what": "ISP review", "due": due,
                          "status": followup_state(due, today)})
    followups.sort(key=_cmp(lambda a, b: (rank[a["status"]] - rank[b["status"]])
                            or (-1 if a["due"] < b["due"] else (1 if a["due"] > b["due"] else 0))
                            or gsjs.locale_cmp(a["name"], b["name"])))
    return {"items": items[:ACTIVITY_CAP], "total": len(items), "followups": followups, "phones_matched": count,
            "why": why, "degraded": degraded}


def activity_cut(data: dict, cut: dict, ctx: dict, viewer_email: str = "") -> dict:
    """ssaActivityCut_: never the admin notes; the records and follow-ups in scope; the texts, calls and e-mails only
    to the SSA the record is about (the viewer's own e-mail, the record's one e-mail): a cut viewer also reads the SSA
    records of its own clients, which may be another SSA's."""
    emails = [gsjs.str_(e).lower() for e in ((ctx or {}).get("ssa") or {}).get("emails") or []]
    own = bool(viewer_email) and viewer_email.lower() in emails
    comms = own and len(emails) <= 1
    items = [i for i in data.get("items") or []
             if i.get("kind") != "note" and (mine(cut, i.get("client_key")) if i.get("kind") == "record" else comms)]
    why = list(data.get("why") or [])
    if own and not comms:
        why.append("The client records give this SSA more than one e-mail, so texts, calls and e-mails are not shown.")
    return _with(data, {"items": items, "total": len(items), "why": why,
                        **({} if comms else {"phones_matched": 0}),
                        "followups": [f for f in data.get("followups") or [] if mine(cut, f.get("client_key"))]})


def activity_data(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """ssaActivity_."""
    return _kept(reads, "ssaProfileActivity", ctx, lambda: activity_build(reads, ctx))()


def activity_door(reads: L.Reads, ctx: dict, cut: dict | None = None, viewer_email: str = "") -> dict[str, Any]:
    """ssaActivityDoor_ past the gate."""
    if ctx.get("refused"):
        return ctx["refused"]
    got = serve(reads, "The activity", lambda: activity_data(reads, ctx))
    return cut_answer(got, cut, lambda d, c: activity_cut(d, c, ctx, viewer_email))


def ssa_profile_activity(sess: L.Session, payload: dict) -> dict[str, Any]:
    """ssaProfileActivity: a cut viewer (an SSA) sees the records and follow-ups of its own clients, and its own
    correspondence on its own record alone."""
    g = gate(sess)
    if not g["open"]:
        return unknown()
    cut = cut_of(g["scope"])
    if cut and cut["kind"] != "ssa":
        return unknown()
    if outside(cut, payload):
        return unknown()
    got = activity_door(sess.reads, ssa_ctx(sess.reads, payload.get("ssa")), cut,
                        gsjs.str_((sess.user or {}).get("email")) if cut else "")
    if cut or notes_open(sess, g) or not got or got.get("status") != 200:
        return got
    return {**got, "data": notes_out(got["data"])}


# ---- notes -------------------------------------------------------------------------------------------------------

def notes_door(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """ssaNotesDoor_ past the gate."""
    if ctx.get("refused"):
        return ctx["refused"]
    got = serve(reads, "The SSA notes", _kept(reads, "ssaProfileNotes", ctx,
                                              lambda: {"notes": notes_for(reads, ctx["key"])}))
    return shown(reads, got)


def ssa_profile_notes(sess: L.Session, payload: dict) -> dict[str, Any]:
    """ssaProfileNotes: admin notes about the SSA, newest first; never to a cut viewer, only to whom they are open."""
    g = gate(sess)
    if not g["open"] or cut_of(g["scope"]) or not notes_open(sess, g):
        return unknown()
    return notes_door(sess.reads, ssa_ctx(sess.reads, payload.get("ssa")))


# ---- the SSA's details, as the edit panel opens on them ----------------------------------------------------------

def edit_door(sess: L.Session, edition: str = EDITION) -> dict[str, Any] | None:
    """ssaProfileEditDoor_: the master; else a listed holder of the write's edition who reads SSA uncut. FAIL-CLOSED."""
    if sc.is_real_master(sess.user):
        return None
    if not sc.edition_allows(edition, sess.user or {}, sess.reads.config()):
        return unknown()
    g = gate(sess)
    return None if g["open"] and not cut_of(g["scope"]) else unknown()


def edit_rows(reads: L.Reads) -> dict[str, dict]:
    """ssaEditRows_: the clients' records by key, as the index read them."""
    out: dict[str, dict] = {}
    for c in C.derived(reads):
        k = C.roster_row(c, None)["client_key"]
        if k and k not in out:
            out[k] = c
    return out


def edit_tie_lock(c: dict, rows: dict[str, dict], key: str) -> dict[str, str] | None:
    """ssaEditTieLock_: why a client's record does not take the SSA's details; None when its own record names them."""
    if c.get("archived"):
        return {"why": "The archive of old clients names this SSA; the archive is not edited here.", "door": ""}
    row = rows.get(c["client_key"])
    if not row or key_of(row.get("ssa_name")) != key:
        return {"why": "Only the Asa Client Database Master names this SSA, not the client's Hub record.",
                "door": "Clients"}
    return None


def edit_of(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """ssaEditOf_: each field as the overview shows it (the witness), what is not edited here and why."""
    s, rows = ctx["ssa"], edit_rows(reads)
    raw = {"name": s["name"], "phone": s["phone"], "email": s["email"], "agency": s["agency"],
           "office_address": s.get("office_address") or ""}
    locked: dict[str, dict] = {}
    ties: list[dict] = []
    records: list[str] = []
    for c in s["clients"]:
        lock = edit_tie_lock(c, rows, ctx["key"])
        if not lock:
            records.append(c["client_key"])
        ties.append({"client_key": c["client_key"], "name": c["name"], "status": c["status"],
                     "why": lock["why"] if lock else ""})
    if not records:
        none = {"why": "No current client's Hub record names this SSA, so their details are edited on the client's "
                       "record.", "door": "Clients"}
        locked["name"] = dict(EDIT_LOCKED["name"])
        locked["phone"] = dict(none)
        locked["email"] = dict(none)
    return scrub({"raw": raw, "locked": locked, "ties": ties, "records": records,
                  "clients": association(reads, ctx, rows)})


def association(reads: L.Reads, ctx: dict, rows: dict[str, dict]) -> list[dict]:
    """Every active client, ticked when its Hub record names this SSA; a tie only the Master holds is ticked and kept
    (it is not taken off here)."""
    ties = {c["client_key"] for c in ctx["ssa"]["clients"]}
    out = []
    for ck, c in rows.items():
        r = C.roster_row(c, None)
        if r["status"] != "active":
            continue
        named = key_of(c.get("ssa_name")) == ctx["key"]
        why = "" if named or ck not in ties else "Only the Asa Client Database Master names this SSA for this client."
        out.append({"client_key": ck, "name": r["name"], "on": named or ck in ties, "why": why})
    out.sort(key=lambda x: x["name"].lower())
    return out


def edit_check(field: str, value: str) -> str:
    """ssaEditCheck_: why `value` is refused for `field`; '' when it may be written."""
    if field == "name":
        if not key_of(value):
            return "A name is required."
        if len(value) > NAME_MAX:
            return f"Up to {NAME_MAX} characters."
    if field == "phone" and value and not SC._digits10(value):
        return "A phone number has ten digits."
    if field == "email" and value and not email_of(value):
        return "Not an email address."
    if field in EDIT_OWN:
        if len(value.encode("utf-16-le")) // 2 > EDIT_OWN[field]:
            return f"Up to {EDIT_OWN[field]} characters."
        if scrub(value) != value:
            return "It holds a number the platform withholds (an SSN or a card number), so it is not kept."
    return ""


def overview_edit(sess: L.Session, payload: dict) -> dict[str, Any]:
    """ssaOverviewEdit_: the overview with the edit panel's fields for a session the edit door lets in."""
    reads = sess.reads
    got = overview_door(reads, ssa_ctx(reads, payload.get("ssa")))
    if not got or got.get("status") != 200 or edit_door(sess):
        return got
    ctx = ssa_ctx(reads, payload.get("ssa"))
    if ctx.get("refused"):
        return ctx["refused"]
    try:
        edit = edit_of(reads, ctx)
    except (Defer, hubdb.Unreadable):
        raise
    except Exception as e:  # noqa: BLE001 - the port's own words
        return {"status": 503, "message": "The client records could not be read just now (" + L._why(e)
                + "), so nothing is offered to edit."}
    return {"status": 200, "data": _with(got["data"], {"edit": _marked_answer(edit)})}


# ---- the relay's pack --------------------------------------------------------------------------------------------

def client_views(reads: L.Reads, ctx: dict, parts: dict) -> dict[str, Any]:
    """ssaClientViews_: each live client's own view of the SSA, cut from the parts gathered before it."""
    if parts.get("overview") is None or parts.get("documents") is None:
        return {"status": 503, "message": "Not cut: the overview or the documents did not answer."}
    if ctx.get("refused"):
        return ctx["refused"]
    key = ctx["key"]
    out: dict[str, Any] = {}
    for c in ctx["ssa"].get("clients") or []:
        k = gsjs.or_text((c or {}).get("client_key"))
        if not k or not C.client_live(c) or k in out:
            continue
        cut = {"kind": "client", "ssas": {key: True}, "clients": {k: True}}
        out[k] = {"roster": _with(_marked_answer(scrub(roster_build(reads, cut))), {"viewer": "client"}),
                  "overview": overview_cut(parts["overview"], cut),
                  "documents": documents_cut(parts["documents"], cut)}
    return {"status": 200, "data": out}


# ssaPackDoors_: fn(reads, ctx, parts) → the part's answer, each its own door past the gate
PACK_DOORS: dict[str, Callable[[L.Reads, dict, dict], dict[str, Any]]] = {
    "overview": lambda reads, ctx, _parts: overview_door(reads, ctx),
    "documents": lambda reads, ctx, _parts: documents_door(reads, ctx),
    "activity": lambda reads, ctx, _parts: activity_door(reads, ctx),
    "notes": lambda reads, ctx, _parts: notes_door(reads, ctx),
    "client_views": client_views,
}


def _take(parts: dict, status: dict, name: str, got: Any) -> None:
    """The pack's take: a 200 with data is the part, anything else its status and words."""
    if isinstance(got, dict) and got.get("status") == 200 and got.get("data") is not None:
        parts[name] = got["data"]
        status[name] = {"status": 200}
        return
    said = got.get("status") if isinstance(got, dict) else None
    status[name] = {"status": int(said) if isinstance(said, (int, float)) and not isinstance(said, bool) and said
                    else 503,
                    "message": gsjs.js_str((got or {}).get("message") or "This part did not answer.")[:200]}


def ssa_pack(sess: L.Session, payload: dict) -> dict[str, Any]:
    """ssaPack: overview, documents, activity, notes and the client views of one SSA, for the relay or the master."""
    user = sess.user
    if not user or not (user.get("is_service") is True or sc.is_real_master(user)):
        return unknown()
    started = time.monotonic()
    reads = sess.reads
    ctx = ssa_ctx(reads, payload.get("ssa"))
    if ctx.get("refused"):
        return ctx["refused"]
    parts: dict[str, Any] = {}
    status: dict[str, Any] = {}
    left: list[str] = []
    for name in PACK_PARTS:
        if time.monotonic() - started > PACK_BUDGET_S:
            status[name] = {"status": 503, "message": NOT_GATHERED}
            left.append(f"{name} ({PAST_BUDGET})")
            continue
        try:
            got = PACK_DOORS[name](reads, ctx, parts)
        except (Defer, hubdb.Unreadable) as e:
            # not this engine's answer: the section reads on its own door, which says why
            status[name] = {"status": 503, "message": NOT_GATHERED}
            left.append(f"{name} ({str(e)[:120]})")
            continue
        except Exception as e:  # noqa: BLE001 - the port's own words, as the pack's try/catch
            status[name] = {"status": 503, "message": f"This part could not be read just now ({L._why(e)})."}
            continue
        _take(parts, status, name, got)
    if not parts:
        raise Defer("no part of this pack could be read here")
    if left:
        log.info("ssaPack: %d part(s) left to their own reads: %s", len(left), "; ".join(left))
    return {"status": 200, "data": {"ssa": ctx["key"], "built_at": gsjs.iso(reads.now), "parts": parts,
                                    "part_status": status}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "ssaProfileRoster": ssa_profile_roster, "ssaProfileOverview": ssa_profile_overview,
    "ssaProfileDocuments": ssa_profile_documents, "ssaProfileActivity": ssa_profile_activity,
    "ssaProfileNotes": ssa_profile_notes, "ssaProfileDocFile": ssa_profile_doc_file, "ssaPack": ssa_pack,
    "ssaProfileEditRead": ssa_profile_edit_read,
}

# HUB_POLICY: the roles each read is declared for, and its typed params (Resolver.gs checks both first)
POLICY: dict[str, dict[str, Any]] = {
    "ssaProfileRoster": {"roles": POLICY_ROLES, "params": {}},
    "ssaProfileOverview": {"roles": POLICY_ROLES, "params": {"ssa": "string"}},
    "ssaProfileEditRead": {"roles": POLICY_ROLES, "params": {"ssa": "string"}},
    "ssaProfileDocuments": {"roles": POLICY_ROLES, "params": {"ssa": "string"}},
    "ssaProfileActivity": {"roles": POLICY_ROLES, "params": {"ssa": "string"}},
    "ssaProfileNotes": {"roles": POLICY_ROLES, "params": {"ssa": "string"}},
    "ssaProfileDocFile": {"roles": POLICY_ROLES, "params": {"ssa": "string", "file_id": "string"}},
    "ssaPack": {"roles": ("admin",), "params": {"ssa": "string"}},
}
