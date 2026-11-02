"""Clients' source reads (ClientSourceAppointments.gs, ClientSourceTransport.gs, ClientSourceFinance.gs) off asa-hub-db."""
from __future__ import annotations

import functools
import json
import math
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Callable

import dr_book as DB
import drive as drv_mod
import gsjs
import house_tables as HT
import hubdb
import locations as L
from gsjs import NY, SheetDate, locale_cmp, name_key, text
from scope import Defer

_soft = L._soft

# ---- ClientSourceAppointments.gs --------------------------------------------------------------------------------

CS_APPT_ARCHIVE = "Dr Appt Archive"
CS_APPT_FUTURE = "Future Apts"
CS_APPT_MASTER = "Dr Master"
CS_APPT_STATUSES = ("Upcoming", "Past")
CS_APPT_NOT_A_NAME = frozenset((
    "dr", "doctor", "md", "do", "np", "pa", "pac", "dds", "dmd", "od", "phd", "aprn", "cnp", "fnp", "rn", "lpn", "the",
    "and", "of", "at", "in", "for", "with", "clinic", "health", "healthcare", "medical", "medicine", "center", "centre",
    "family", "practice", "group", "associates", "office", "hospital", "care", "services", "dental", "dentistry",
    "dentist", "therapy", "physical", "eye", "vision", "foot", "ankle", "podiatry", "orthopedic", "orthopedics", "urgent",
    "statcare", "partners", "inc", "llc", "lab", "labs", "st", "ave", "rd", "nw", "ne", "sw", "se", "suite", "ste"))
# Estate.gs ESTATE_SOURCES for the three these doors read
ESTATE = {"drVisits": ("ESTATE_DR_ID", CS_APPT_ARCHIVE), "drAppointments": ("ESTATE_DR_ID", CS_APPT_MASTER),
          "workOrders": ("ESTATE_REPAIRS_ID", "Repairs")}

# ---- ClientSourceTransport.gs -----------------------------------------------------------------------------------

CS_TRANSPORT_VAN_PROP, CS_TRANSPORT_VAN_FALLBACK = "HUB_VAN_CALENDAR_SHEET_ID", "15W2-gLb-Sn3ScLXxzdjZyDuVIZELNlhLK3C1rP21ngg"
CS_TRANSPORT_REQUESTS_TAB = "Requests"
CS_TRANSPORT_CONFLICTS_TAB = "Conflicts"
CS_TRANSPORT_FORM_SLUG = "van-calendar"
CS_TRANSPORT_STATUSES = ("Needs assignment", "Scheduled", "Completed", "Check date", "No booking", "Cancelled")
CS_TRANSPORT_AVAILABILITY = ("Available", "Partly Booked", "Booked", "Maintenance")
CS_TRANSPORT_RULE = ("Scheduled: a booked van on a day still ahead. Completed: a booked day that has passed — the "
                     "Van Calendar records no drop-off. Needs assignment: a van-required day ahead with no vehicle booked, "
                     "or one listed in an open conflict. No booking: a past van-required visit the Van Calendar never "
                     "booked. Check date: the day is earlier than the request that booked it.")
CS_TRANSPORT_AVAILABILITY_RULE = ("Booked when the day's bookings cover the van's whole observed window (the earliest start "
                                  "to the latest end on any request); Partly Booked with any booking; Maintenance while an "
                                  "open repair names the vehicle.")
# the Requests tab's column order, which the copy does not keep; a row written one column short is realigned on it
VAN_REQUESTS_ORDER = ("Status", "Event ID", "Select Vehicle", "Timestamp", "Your Name", "Client Name",
                      "Date (Day Client Needs the Van)", "Start Time", "End Time", "Why does the client need the van?",
                      "Destination Address")
CS_TRANSPORT_OFFICE_TABS = ("vehicles", "mileage")
CS_TRANSPORT_OFFICE_SOURCES = ("repairs", "fleet", "psi_punches")
# VehicleCalendar.gs: the two houses a client's trips read
VC_TABS = {"vehicles": "vc_vehicles", "trips": "vc_trips"}
VC_AVAILABILITY = ("available", "maintenance", "out_of_service")

# ---- ClientSourceFinance.gs -------------------------------------------------------------------------------------

CSF_PAWS_PROP, CSF_PAWS_FALLBACK, CSF_PAWS_TAB = "HUB_PAWS_BOOK_ID", "1C81euMJk7rHL3DCymerYk0gG__5Rg9sNVwJFmxD5bIw", "Sheet1"
CSF_CLIENT_DB_PROP, CSF_CLIENT_DB_FALLBACK = "HUB_CLIENT_DB_SHEET_ID", "1fTi78ztKDiK3hvYLbI2IQ1TeSrzVLceK5LyXJ4BVPe8"
CSF_SPANS_TAB = "Sheet6"
CSF_MBS_PROP, CSF_MBS_FALLBACK, CSF_MBS_TAB = "HUB_BILLING_ERRORS_BOOK_ID", "1wEMjXy9LcOjsZgGY3Z8m6VbLcLTFNw-BCXQpIcZUKpA", "Sheet1"
CSF_EVV_TAB = "EVV Fixes"
CSF_MBS_PATH = ("Billing", "Billing Errors")
CSF_MBS_MAX = 60
CSF_RENEWAL_DAYS = 60
CSF_NOT_SERVICE = ("ADMIN", "TRAIN")
CSF_TXN_STATUSES = ("Recorded", "Receipt On File", "Missing receipt")
CSF_RECEIPT_STATUSES = ("Receipt On File", "Needs review", "Missing receipt", "No receipt expected", "Filed")
CSF_AUTH_STATUSES = ("Current", "Renewal due", "Expired", "Unknown")
CSF_CLAIM_STATUSES = ("Draft", "Submitted", "Rejected", "Denied", "Paid")
CSF_REVIEW_VERDICTS = ("MISMATCH", "POSSIBLE_MATCH", "UNREADABLE")
CSF_RECEIPT_KINDS = ("receipt", "invoice", "packing_slip")
CSF_STATEMENT_KINDS = ("bank_statement", "benefit_letter", "paystub", "tax_form", "utility_bill")
CSF_SOURCE_WORDS = {"truelink": "TrueLink card", "manual": "Spending log", "hub": "Client Finances"}
CSF_MONTHS = ("january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
              "november", "december")
CSF_MBS_CLAIM = re.compile(r"^\s*(\d{7})\s+(\S+)\s+(\S+)\s+(\d{12})\s+(\d\d/\d\d/\d{4})\s+(\d\d/\d\d/\d{4})\s+([A-Z0-9]{3})"
                           r"\s+(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(-?[\d.]+)")
CSF_MBS_ERROR = re.compile(r"^\s*\(\s*(\d+)\s*\)\s*(.+?)\s*$")
CSF_MBS_CYCLE = re.compile(r"BILLING CYCLE\s+([A-Z]{3}\d{2}[A-Z])")
CSF_EVV_LINE = re.compile(r"(\d{12})\s+(\d\d/\d\d/\d{2,4})\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(\d+)\s*$")
PSI_PUNCHES_FULL_TAB = "psi_punches_full"
FOLDER_MIME = "application/vnd.google-apps.folder"
# Clients.gs: the plan's people table, for the SSA's name
ISP_EMAIL_TLDS = ("com", "org", "net", "edu", "gov", "us", "co", "io", "info", "biz", "health", "care", "services")
ISP_PEOPLE_ROLES = ("Guardianship of Person", "Emergency Contact", "Medical Provider", "Power of Attorney", "Home Provider",
                    "Legal Guardian", "Case Manager", "Guardian & Type", "Guardian", "Provider", "Family", "Friend",
                    "Parent", "Sibling", "Advocate", "Payee", "Doctor", "Roommate", "Employer")
ISP_CELL_LABEL = re.compile(r"^(e-?mail|phone|cell(?:\s*phone)?|direct\s*line|work(?:\s*phone)?|home\s*phone|mobile|fax|"
                            r"tel(?:ephone)?)\s*[:\-–]\s*(.+)$", re.I)
ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")

_MBS_PARSED: dict[tuple, dict] = {}
_MBS_LOCK = threading.Lock()


# ---- what JavaScript does to a value ----------------------------------------------------------------------------

def _truthy(v: Any) -> bool:
    return isinstance(v, (dict, list)) or not gsjs.falsy(v)


def _s(v: Any) -> str:
    """String(v == null ? '' : v)."""
    return gsjs.or_blank(v)


def _jtrim(v: Any) -> str:
    return gsjs.trim(_s(v))


def _cmp(fn: Callable[[Any, Any], int]) -> Any:
    return functools.cmp_to_key(fn)


def _js_number(v: Any) -> float:
    """Number(v): blank is 0, anything unreadable NaN."""
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = gsjs.trim(gsjs.js_str(v))
    if s == "":
        return 0.0
    if re.fullmatch(r"[+-]?Infinity", s):
        return -math.inf if s[0] == "-" else math.inf
    for rx, base in ((r"0[xX][0-9a-fA-F]+", 16), (r"0[oO][0-7]+", 8), (r"0[bB][01]+", 2)):
        if re.fullmatch(rx, s):
            return float(int(s[2:], base))
    if re.fullmatch(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", s):
        return float(s)
    return math.nan


def _finite(v: Any) -> Any:
    """JSON.stringify's NaN and Infinity: null."""
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if isinstance(v, dict):
        return {k: _finite(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_finite(x) for x in v]
    return v


def _num_s(n: Any) -> str:
    return gsjs.js_str(n)


def _join(items: list, sep: str) -> str:
    """Array.prototype.join: null and undefined as ''."""
    return sep.join("" if x is None else gsjs.js_str(x) for x in items)


def _round2(n: Any) -> float:
    """csfRound_ / Math.round(n * 100) / 100."""
    x = _js_number(n) if not isinstance(n, (int, float)) else float(n)
    if not math.isfinite(x):
        return x
    return gsjs.js_round(x * 100) / 100


def _to_fixed2(x: float) -> str:
    """Number.prototype.toFixed(2) for a non-negative number."""
    return str(Decimal(x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _js_keys(d: dict) -> list:
    """Object.keys order: integer-like keys ascending, then the rest as inserted."""
    ints = sorted((k for k in d if re.fullmatch(r"0|[1-9]\d{0,9}", k) and int(k) < 4294967295), key=int)
    return ints + [k for k in d if k not in ints]


_MONTH3 = {m[:3]: i + 1 for i, m in enumerate(CSF_MONTHS)}
_DAYS3 = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def _legacy_parse(s: str) -> float | None:
    """Date.parse for 'Weekday, Month D, YYYY [h:mm[:ss] [AM|PM]]' and 'D Month YYYY': local time, in ms."""
    words = [w for w in re.split(r"[\s,]+", s.strip()) if w]
    if words and words[0].rstrip(".").lower()[:3] in _DAYS3 and words[0].rstrip(".").isalpha():
        words = words[1:]
    month = day = year = None
    clock = None
    half = ""
    rest = []
    for w in words:
        bare = w.rstrip(".")
        if bare.isalpha() and len(bare) >= 3 and bare.lower()[:3] in _MONTH3 and month is None:
            month = _MONTH3[bare.lower()[:3]]
        elif re.fullmatch(r"\d{1,2}:\d{2}(?::\d{2})?", w):
            clock = [int(x) for x in w.split(":")]
        elif re.fullmatch(r"(?i)[ap]\.?m\.?", w):
            half = w[0].upper()
        elif re.fullmatch(r"\d+", w):
            rest.append(int(w))
        else:
            return None
    if month is None or len(rest) != 2:
        return None
    a, b = rest
    if a <= 31 and b > 31:
        day, year = a, b
    elif b <= 31 and a > 31:
        year, day = a, b
    else:
        return None
    hh, mi, ss = (clock + [0, 0, 0])[:3] if clock else (0, 0, 0)
    if half:
        hh = hh % 12 + (12 if half == "P" else 0)
    try:
        return datetime(year, month, day, hh, mi, ss, tzinfo=NY).timestamp() * 1000.0
    except ValueError:
        return None


def _date_parse(s: Any) -> float | None:
    """Date.parse: the forms gsjs reads, then the long English ones."""
    raw = gsjs.trim(gsjs.or_blank(s))
    if not raw:
        return None
    t = gsjs.date_parse(raw)
    return t if t is not None else _legacy_parse(raw)


def _ny_day(ms: float) -> str:
    return datetime.fromtimestamp(ms / 1000.0, timezone.utc).astimezone(NY).strftime("%Y-%m-%d")


def appt_day(v: Any) -> str:
    """apptDay_: an ISO or US day cut, anything else through Date.parse."""
    s = gsjs.trim(gsjs.or_text(v))
    m = re.match(r"^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)", s)
    if m:
        return m.group(1)
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        return f"{m.group(3)}-{m.group(1).zfill(2)[-2:]}-{m.group(2).zfill(2)[-2:]}"
    t = _date_parse(s)
    return _ny_day(t) if t else ""


# ---- the stores -------------------------------------------------------------------------------------------------

def _tab(reads: L.Reads, sid: str, tab: str, what: str) -> hubdb.TabRef | None:
    """A book's tab, or None when the book holds no such tab; a book not in the copy is never Apps Script's failure."""
    if not sid:
        return None
    return HT.tab_of(reads, sid, tab, what)


def _book_tz(reads: L.Reads, sid: str, ref: hubdb.TabRef | None) -> Any:
    """The book's own clock, from the 'GMT-3' its text timestamps carry; New York when none does."""
    def read() -> Any:
        seen: dict[str, int] = {}
        if ref is not None:
            for _rn, raw in _rows_of(reads, ref):
                for v in raw.values():
                    m = re.search(r"\bGMT([+-])(\d{1,2})(?::?(\d{2}))?$", str(v or ""))
                    if m:
                        seen[m.group(0)] = seen.get(m.group(0), 0) + 1
        if not seen:
            return NY
        best = max(seen, key=lambda k: seen[k])
        m = re.search(r"GMT([+-])(\d{1,2})(?::?(\d{2}))?$", best)
        off = timedelta(hours=int(m.group(2)), minutes=int(m.group(3) or 0))
        return timezone(-off if m.group(1) == "-" else off)
    return reads.once("cs:tz:" + sid, read)


def _zoned(v: Any, tz: Any) -> Any:
    """getValues() in a book on another clock: the date the mirror's text shows, on that book's wall clock."""
    if isinstance(v, str):
        bare = hubdb._LINKED.match(v)
        s = (bare.group(1) if bare else v).strip()
        if re.match(r"^[A-Za-z]+,?\s+[A-Za-z]{3,}\.?\s+\d{1,2},?\s+\d{4}$", s) or \
                re.match(r"^[A-Za-z]{3,}\.?\s+\d{1,2},?\s+\d{4}$", s):
            t = _legacy_parse(s)
            if t is not None:
                wall = datetime.fromtimestamp(t / 1000.0, timezone.utc).astimezone(NY).replace(tzinfo=None)
                return SheetDate(wall.replace(tzinfo=tz))
    got = hubdb.typed(v, "estate")
    if isinstance(got, SheetDate) and tz is not NY:
        wall = got.at.astimezone(NY).replace(tzinfo=None)
        return SheetDate(wall.replace(tzinfo=tz))
    return got


def _estate_cell(v: Any, tz: Any) -> str:
    """estateCell_(v, tz): a time-only cell as HH:mm on the book's clock, a Date as ISO, anything else String()."""
    if isinstance(v, SheetDate) and v.at.astimezone(NY).year < 1900:
        local = v.at.astimezone(tz)
        return f"{local.hour:02d}:{local.minute:02d}"
    return hubdb.estate_cell(v)


def _rows_of(reads: L.Reads, ref: Any) -> list[tuple[int, dict]]:
    """A tab's (row number, cells): a kept tab's own, else the copy's with the kept edits laid."""
    return ref.rows if isinstance(ref, DB.KeptTab) else reads.db.rows(ref)


def _dr_tab(reads: L.Reads, sid: str, resource: str) -> Any:
    """A tab of the Dr Appointments book: its table once Postgres holds it, else the book's copy."""
    if DB.held(reads, resource):
        return DB.kept(reads, resource)
    tab = DB.TABS[resource]
    return _tab(reads, sid, tab, f"the {tab}")


def dr_tz(reads: L.Reads, sid: str) -> Any:
    """The Dr Appointments book's clock, read off its visits."""
    return _book_tz(reads, sid, _dr_tab(reads, sid, "drVisits"))


def _estate_rows_of(reads: L.Reads, ref: Any, tz: Any) -> list[dict]:
    """estateRows_ for one tab: keys from estateKey_, id r<sheet row>, cells by estateCell_; blank rows dropped."""
    if ref is None:
        return []
    keys = [hubdb.estate_key(h) for h in ref.headers]
    out = []
    for rn, raw in _rows_of(reads, ref):
        row: dict[str, Any] = {"id": f"r{rn}"}
        empty = True
        for k, src in zip(keys, ref.headers):
            if not k:
                continue
            v = _estate_cell(_zoned(raw.get(src), tz), tz)
            if v:
                empty = False
            row[k] = v
        if not empty:
            out.append(row)
    return out


def estate_rows(reads: L.Reads, resource: str) -> list[dict]:
    """estateRows_ for drVisits, drAppointments and workOrders."""
    if resource == "workOrders":
        return reads.estate("workOrders")

    def read() -> list[dict]:
        prop, _tab_name = ESTATE[resource]
        sid = reads.db.prop(prop)
        if not sid:
            raise hubdb.Unreadable(f"no {prop} is declared in the depot")
        return _estate_rows_of(reads, _dr_tab(reads, sid, resource), dr_tz(reads, sid))
    return reads.once("cs:estate:" + resource, read)


def hub_rows(reads: L.Reads, tab: str) -> list[dict]:
    """listRows_ (readAll_ of the routed tab); one the copy does not hold reads as none, as sheetFor_ makes it."""
    def read() -> list[dict]:
        res = reads.db.resolve(tab)
        if res.runtime:
            raise Defer(f"{tab} lives in the depot's facts")
        if res.ref is None and not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
        return reads.db.sheetdb_rows(res.ref)
    return reads.once("cs:hub:" + tab, read)


def kept_hub_rows(reads: L.Reads, tab: str) -> list[dict]:
    """hub_rows of a tab its app keeps in Postgres (sheet_resources), from there once uploaded."""
    import sheet_resources as SR  # noqa: PLC0415 - it imports this module's neighbours
    kept = SR.kept_rows(reads, tab)
    return kept if kept is not None else hub_rows(reads, tab)


def _tab_sheet(reads: L.Reads, tab: str) -> Any:
    """hubTabSheet_: the routed tab; None when the copy holds none, which it never does for a tab without a row."""
    res = reads.db.resolve(tab)
    if res.runtime:
        raise Defer(f"{tab} lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
    return res.ref


def _isp_people(block: Any) -> list[dict]:
    """ispPeople_: the plan's Important People table."""
    whole = gsjs.or_text(block)
    start = whole.find("Important People")
    if start == -1:
        return []
    skip = ("Important People", "Type", "Name/Relationship", "Address", "Phone")
    lines = [s for s in (gsjs.trim(x) for x in whole[start:].split("\n")) if s and re.sub(r":$", "", s) not in skip]

    def role_line(s: str) -> str:
        s = gsjs.trim(s)
        return s if s in ISP_PEOPLE_ROLES or re.match(r"^Other\s*[-–—]\s*\S", s) else ""

    def whole_email(e: str) -> bool:
        dot = e.rfind(".")
        return "@" in e and dot != -1 and e[dot + 1:].lower() in ISP_EMAIL_TLDS

    def glue(email: str, nxt: str) -> str:
        frag = gsjs.trim(nxt)
        if not frag or len(frag) > 12 or not re.fullmatch(r"[A-Za-z0-9._\-]+", frag):
            return ""
        joined = email + frag
        return joined if whole_email(joined) else ""

    people: list[dict] = []
    cur = wrapped = None
    for ln in lines:
        if role_line(ln):
            if cur is not None and not cur["name"]:
                cur["role"] = cur["role"] + " — " + ln
                continue
            cur = {"role": ln, "name": "", "address": "", "email": "", "phone": ""}
            people.append(cur)
            wrapped = None
            continue
        if cur is None:
            continue
        m = ISP_CELL_LABEL.match(gsjs.trim(ln))
        val = gsjs.trim(m.group(2)) if m else gsjs.trim(ln)
        if wrapped is cur:
            wrapped = None
            joined = glue(cur["email"], val)
            if joined:
                cur["email"] = joined
                continue
        if re.fullmatch(r"[\d().+\-\s]{7,}", val):
            if not cur["phone"]:
                cur["phone"] = val
        elif "@" in val:
            if not cur["email"]:
                cur["email"] = val
                wrapped = None if whole_email(val) else cur
        elif not cur["name"]:
            cur["name"] = val
        else:
            cur["address"] = gsjs.trim(cur["address"] + " " + val)
    return people


def _isp_ids(reads: L.Reads) -> dict[str, dict[str, str]]:
    """clientDetailFromIsp_'s medicaid_id and ssa_name, per plan key."""
    def read() -> dict[str, dict[str, str]]:
        out: dict[str, dict[str, str]] = {}
        for r in reads.hub_rows("isps"):
            key = gsjs.trim(gsjs.or_text(r.get("client_key")))
            if not key:
                continue
            block = r.get("contact_block")
            if not gsjs.or_text(block):
                out[key] = {}
                continue
            lad = L._ladder(block)
            d = re.sub(r"\D", "", gsjs.or_text(lad.get("Medicaid #")))
            ssa: dict = {}
            for p in _isp_people(block):
                hay = (p["role"] + " " + p["name"]).lower()
                if any(n in hay for n in ("ssa", "case manager", "support administrator")):
                    ssa = p
                    break
            out[key] = {"medicaid_id": d if d and 4 <= len(d) <= 12 else "", "ssa_name": ssa.get("name") or ""}
        return out
    return reads.once("cs:isp_ids", read)


def derived(reads: L.Reads) -> list[dict]:
    """clientsDerived_(null), the fields these doors read: the plans, then the Hub's clients rows over them."""
    def read() -> list[dict]:
        ids = _isp_ids(reads)
        out = []
        for row in reads.clients_derived():
            got = dict(row)
            plan = ids.get(gsjs.trim(gsjs.or_text(row.get("client_key")))) or {}
            for f in ("medicaid_id", "ssa_name"):
                if f not in got and f in plan:
                    got[f] = plan[f]
            out.append(got)
        return out
    return reads.once("cs:derived", read)


def identity_names(reads: L.Reads, key: str) -> dict[str, bool]:
    """hubClientIdentity_(key).names."""
    names = {key: True}
    for r in derived(reads):
        if gsjs.str_(r.get("client_key")) != key:
            continue
        n = name_key(gsjs.str_(r.get("name")))
        if n:
            names[n] = True
    return names


# ---- Appointments -------------------------------------------------------------------------------------------------

def appt_clock(v: Any) -> dict[str, str]:
    """csApptClock_: '2:00:00 PM', a time cell or an instant → label and 24 h clock."""
    s = text(v)
    if not s:
        return {"label": "", "hm": ""}
    h, m = -1, 0
    ampm = re.match(r"^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])\.?\s*m\.?$", s, re.I)
    bare = re.match(r"^(\d{1,2}):(\d{2})(?::\d{2})?$", s)
    if ampm:
        h = int(ampm.group(1)) % 12 + (12 if ampm.group(3).lower() == "p" else 0)
        m = int(ampm.group(2))
    elif bare:
        h, m = int(bare.group(1)), int(bare.group(2))
    elif re.match(r"^\d{4}-\d{2}-\d{2}T", s) and gsjs.date_parse(s) is not None:
        at = datetime.fromtimestamp(gsjs.date_parse(s) / 1000.0, timezone.utc).astimezone(NY)
        h, m = at.hour, at.minute
    if h < 0 or h > 23 or m > 59:
        return {"label": s, "hm": ""}
    return {"label": f"{(h % 12) or 12}:{m:02d} {'AM' if h < 12 else 'PM'}", "hm": f"{h:02d}:{m:02d}"}


def appt_client(reads: L.Reads, raw: Any) -> dict[str, Any]:
    """csApptClient_: the client a request names, with every name key the platform spells them by."""
    key = text(raw)
    if not key or len(key) > 120:
        return {"refused": {"status": 400, "message": "client: a client key, as the Clients app names it."}}
    rows, why = _soft(lambda: derived(reads))
    if rows is None:
        return {"refused": {"status": 503, "message": f"The clients could not be read ({why})."}}
    hit = next((r for r in rows if text(r.get("client_key")) == key), None)
    if hit is None:
        return {"refused": {"status": 404, "message": "No client with that key is on file."}}
    names = dict(identity_names(reads, key))
    own = name_key(hit.get("name"))
    if own:
        names[own] = True
    return {"key": key, "name": text(hit.get("name")), "names": names}


def _appt_tab_rows(reads: L.Reads, tab: str) -> list[dict]:
    """csApptTabRows_: one tab of the Dr Appointments book; a missing tab throws, never answers []. Future Apts, the
    book's view of its visits, has nothing to add once Postgres keeps the visits."""
    def read() -> list[dict]:
        sid = reads.db.prop(ESTATE["drVisits"][0])
        if not sid:
            raise RuntimeError("the Dr Appointments book is not configured")
        if tab == DB.FUTURE_TAB and DB.held(reads, "drVisits"):
            return []
        ref = _tab(reads, sid, tab, f"the {tab} tab")
        if ref is None:
            raise RuntimeError(f'the book has no "{tab}" tab')
        return _estate_rows_of(reads, ref, dr_tz(reads, sid))
    return reads.once("cs:appt:" + tab, read)


def _appt_source(what: str, read: Callable[[], list], whole_may_be_empty: bool) -> dict[str, Any]:
    rows, why = _soft(read)
    if rows is None:
        return {"rows": None, "why": f"{what} could not be read ({why})"}
    if not rows and not whole_may_be_empty:
        return {"rows": None, "why": what + " answered no row at all"}
    return {"rows": rows, "why": ""}


def _appt_mine(rows: list | None, col: str, names: dict) -> list[dict]:
    out = []
    for r in rows or []:
        k = name_key(text(r.get(col)))
        if k and names.get(k) is True:
            out.append(r)
    return out


def _appt_visit(r: dict, source: str, today: str) -> dict[str, Any]:
    day = appt_day(r.get("appointment_date"))
    clock = appt_clock(r.get("appointment_start_time"))
    dr, address = text(r.get("dr_name")), text(r.get("appointment_address"))
    van = text(r.get("wheelchair_van_required"))
    archived = source == CS_APPT_ARCHIVE
    return {"id": ("" if archived else "future:") + gsjs.or_text(r.get("id")), "record": dr or "Doctor visit",
            "date": day, "details": address, "status": "Past" if day and day < today else "Upcoming",
            "client_name": text(r.get("client_name")), "time": clock["label"], "time_24": clock["hm"],
            "dr_name": dr, "dr_address": address, "van": bool(re.match(r"^y", van, re.I)), "van_answer": van,
            "date_written": text(r.get("appointment_date")), "submitted": text(r.get("timestamp")),
            "source": source, "also_in": [], "editable": archived, "witness": _s(r.get("client_name")), "doctor_id": ""}


def _appt_same(v: dict) -> str:
    return "|".join([name_key(v["client_name"]), v["date"], v["time_24"] or name_key(v["time"]), name_key(v["dr_name"])])


def _appt_order(a: dict, b: dict) -> int:
    if a["status"] != b["status"]:
        return -1 if a["status"] == "Upcoming" else 1
    ka = (a["date"] or "9999-99-99") + " " + (a["time_24"] or "99:99")
    kb = (b["date"] or "9999-99-99") + " " + (b["time_24"] or "99:99")
    if ka == kb:
        return 0
    return -1 if (a["status"] == "Upcoming") == (ka < kb) else 1


def _appt_visits(archive: list, future: list, today: str) -> list[dict]:
    """csApptVisits_: the archive with every Future Apts row it does not already carry."""
    rows = [_appt_visit(r, CS_APPT_ARCHIVE, today) for r in archive or []]
    by_key: dict[str, list] = {}
    for v in rows:
        by_key.setdefault(_appt_same(v), []).append(v)
    for r in future or []:
        v = _appt_visit(r, CS_APPT_FUTURE, today)
        twin = next((t for t in by_key.get(_appt_same(v)) or [] if CS_APPT_FUTURE not in t["also_in"]), None)
        if twin is not None:
            twin["also_in"].append(CS_APPT_FUTURE)
        else:
            rows.append(v)
    rows.sort(key=_cmp(_appt_order))
    return rows


def _appt_words(name: Any) -> list[str]:
    return [w for w in re.split(r"[^a-z]+", gsjs.or_text(name).lower()) if len(w) >= 2 and w not in CS_APPT_NOT_A_NAME]


def _appt_doctor(r: dict) -> dict[str, Any]:
    written = text(r.get("next_visit"))
    nxt = appt_day(written)
    return {"id": gsjs.or_text(r.get("id")), "record": text(r.get("dr_name")) or "Doctor", "date": nxt,
            "details": text(r.get("specialist")),
            "status": text(r.get("status")) or text(r.get("active_or_discontinued")),
            "specialist": text(r.get("specialist")), "dr_name": text(r.get("dr_name")), "address": text(r.get("address")),
            "phone": text(r.get("phone")), "fax": text(r.get("fax")), "next_visit": written,
            "next_visit_source": "sheet" if nxt else "", "next_booked": None, "last_visit": text(r.get("last_visit")),
            "last_seen": "", "standard_freq": text(r.get("standard_freq")), "notes": text(r.get("notes")),
            "active_or_discontinued": text(r.get("active_or_discontinued"))}


def _appt_join(doctors: list[dict], visits: list[dict]) -> None:
    """csApptJoin_: a visit names a doctor whose last name-word is in it and no other doctor's."""
    marks: dict[str, int] = {}
    mark_of: list[str] = []
    for d in doctors:
        w = _appt_words(d["dr_name"])
        mark = w[-1] if w else ""
        mark_of.append(mark)
        if mark:
            marks[mark] = marks.get(mark, 0) + 1
    by_id = {d["id"]: d for d in doctors}
    for v in visits:
        words = _appt_words(v["dr_name"])
        hits = [d for d, mk in zip(doctors, mark_of) if mk and marks.get(mk) == 1 and mk in words]
        if len(hits) == 1:
            v["doctor_id"] = hits[0]["id"]
    for v in visits:
        d = by_id.get(v["doctor_id"]) if v["doctor_id"] else None
        if not d or not v["date"]:
            continue
        if v["status"] == "Upcoming" and (not d["next_booked"] or v["date"] < d["next_booked"]["date"]):
            d["next_booked"] = {"date": v["date"], "time": v["time"], "id": v["id"]}
        if v["status"] == "Past" and v["date"] > d["last_seen"]:
            d["last_seen"] = v["date"]
    for d in doctors:
        if not d["date"] and d["next_booked"]:
            d["date"] = d["next_booked"]["date"]
            d["next_visit_source"] = "visits"


def _appt_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """csApptBuild_: a source that did not answer says why on its tab, and its figures stay null."""
    as_of = gsjs.iso(reads.now)
    today = reads.today()
    archive = _appt_source("The Dr Appt Archive", lambda: estate_rows(reads, "drVisits"), False)
    future = _appt_source("The Future Apts tab", lambda: _appt_tab_rows(reads, CS_APPT_FUTURE), True)
    master = _appt_source("The Dr Master tab", lambda: estate_rows(reads, "drAppointments"), False)
    visits = _appt_visits(_appt_mine(archive["rows"], "client_name", ctx["names"]),
                          _appt_mine(future["rows"], "client_name", ctx["names"]), today)
    doctors = [_appt_doctor(r) for r in _appt_mine(master["rows"], "client", ctx["names"])]
    _appt_join(doctors, visits)

    def active(d: dict) -> int:
        return 0 if re.fullmatch(r"active", d["status"], re.I) else 1

    doctors.sort(key=_cmp(lambda a, b: (active(a) - active(b)) or locale_cmp(a["specialist"], b["specialist"])
                          or locale_cmp(a["dr_name"], b["dr_name"])))
    visit_why = "; ".join(w for w in (archive["why"], future["why"]) if w)
    kpis = None
    if archive["rows"] is not None:
        up = [v for v in visits if v["status"] == "Upcoming"]
        past = [v for v in visits if v["status"] == "Past"]
        nxt = next((v for v in up if v["date"]), None)
        last = next((v for v in past if v["date"]), None)
        kpis = {"total": len(visits), "upcoming": len(up), "past": len(past),
                "upcoming_van": sum(1 for v in up if v["van"]), "next_date": nxt["date"] if nxt else "",
                "last_date": last["date"] if last else ""}
    visit_tab: dict[str, Any] = {"rows": visits, "kpis": kpis, "statuses": list(CS_APPT_STATUSES), "as_of": as_of}
    if visit_why:
        visit_tab["why"] = visit_why + "."
    dkpis = None
    if master["rows"] is not None:
        on = sum(1 for d in doctors if re.fullmatch(r"active", d["status"], re.I))
        dkpis = {"total": len(doctors), "active": on, "other": len(doctors) - on}
    statuses: list[str] = []
    for d in doctors:
        if d["status"] and d["status"] not in statuses:
            statuses.append(d["status"])
    doctor_tab: dict[str, Any] = {"rows": doctors, "kpis": dkpis, "statuses": sorted(statuses), "as_of": as_of}
    if master["why"]:
        doctor_tab["why"] = master["why"] + "."
    return {"client": {"client_key": ctx["key"], "name": ctx["name"]}, "tabs": {"visits": visit_tab, "doctors": doctor_tab},
            "degraded": bool(visit_why or master["why"])}


def appt_door(reads: L.Reads, payload: dict) -> dict[str, Any]:
    """csApptDoor_: past the gate — the door's answer, and the pack's part."""
    ctx = appt_client(reads, (payload or {}).get("client"))
    if ctx.get("refused"):
        return ctx["refused"]
    data, why = _soft(lambda: _appt_build(reads, ctx))
    if data is None:
        return {"status": 503, "message": f"The appointments could not be read ({why})."}
    return {"status": 200, "data": _finite(data)}


def client_source_appointments(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientSourceAppointments (csApptGate_: the Clients reader for this client)."""
    import clients as C  # noqa: PLC0415 - the two modules lean on each other
    if not C.reader_for(sess, (payload or {}).get("client")):
        return C.unknown()
    return appt_door(sess.reads, payload)


# ---- Transportation -------------------------------------------------------------------------------------------------

def transport_day(v: Any) -> str:
    """csTransportDay_: a day in New York as yyyy-MM-dd; '' otherwise."""
    if isinstance(v, SheetDate):
        return v.at.astimezone(NY).strftime("%Y-%m-%d")
    s = _jtrim(v)
    if not s:
        return ""
    if re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$", s):
        t = gsjs.date_parse(s)
        if t is not None:
            return _ny_day(t)
    iso = re.match(r"^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)", s)
    us = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4}|\d{2})(?:\s|,|$)", s)
    if iso:
        y, m, d = int(iso.group(1)), int(iso.group(2)), int(iso.group(3))
    elif us:
        m, d, y = int(us.group(1)), int(us.group(2)), int(us.group(3))
        if y < 100:
            y += 2000
    elif re.match(r"^(?:[A-Za-z]+,\s*)?[A-Za-z]{3,}\.?\s+\d{1,2},?\s+\d{4}$", s):
        t = _legacy_parse(re.sub(r"^[A-Za-z]+,\s*(?=[A-Za-z]{3,}\.?\s+\d)", "", s))
        if t is None:
            return ""
        at = datetime.fromtimestamp(t / 1000.0, timezone.utc).astimezone(NY)
        y, m, d = at.year, at.month, at.day
    else:
        return ""
    if m < 1 or m > 12 or d < 1 or d > 31 or y < 2000 or y > 2100:
        return ""
    return f"{y}-{m:02d}-{d:02d}"


def transport_clock(v: Any) -> int | None:
    """csTransportClock_: '9:45:00 AM', '9:45 am', '14:05' → minutes after midnight."""
    m = re.match(r"^(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:([AaPp])\.?\s*[Mm]\.?)?$", _jtrim(v))
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if mi > 59:
        return None
    if m.group(3):
        if h < 1 or h > 12:
            return None
        h = h % 12 + (12 if m.group(3).lower() == "p" else 0)
    elif h > 23:
        return None
    return h * 60 + mi


def clock_label(mins: int | None) -> str:
    if mins is None:
        return ""
    h, mm = mins // 60, mins % 60
    return f"{(h % 12) or 12}:{mm:02d} {'AM' if h < 12 else 'PM'}"


def _span(v: Any) -> dict[str, Any]:
    parts = re.split(r"\s*[-–—]\s*|\s+to\s+", _s(v), flags=re.I)
    return {"start": transport_clock(parts[0]), "end": transport_clock(parts[1]) if len(parts) > 1 else None}


def name_keys(v: Any) -> list[str]:
    """csTransportNameKeys_: a person's folded name both ways round for 'Last, First'."""
    s = _jtrim(v)
    out = []
    k = name_key(s)
    if k:
        out.append(k)
    parts = s.split(",")
    if len(parts) == 2:
        r = name_key(parts[1] + " " + parts[0])
        if r and r not in out:
            out.append(r)
    return out


def named(names: dict, v: Any) -> bool:
    return any(names.get(k) for k in name_keys(v))


def transport_client(reads: L.Reads, raw: Any) -> dict[str, Any]:
    """csTransportClient_: 400 blank, 503 unreadable, 404 unknown; never a guess."""
    key = _jtrim(raw)
    if not key:
        return {"refused": {"status": 400, "message": "client: a client_key."}}
    rows, why = _soft(lambda: derived(reads))
    if rows is None:
        return {"refused": {"status": 503, "message": f"The clients could not be read ({why})."}}
    hit = next((r for r in rows if r and (gsjs.trim(gsjs.or_text(r.get("client_key"))) or name_key(r.get("name"))) == key),
               None)
    if hit is None:
        return {"refused": {"status": 404, "message": "No client with that client_key is on file."}}
    client = {"client_key": key, "name": text(hit.get("name")) or key}
    names: dict[str, bool] = {}
    for v in (client["name"], key):
        for n in name_keys(v):
            names[n] = True
    for n in identity_names(reads, key):
        names[n] = True
    return {"client": client, "names": names}


def _head_index(head: list[str], patterns: dict[str, re.Pattern]) -> dict[str, int]:
    """csTransportHeadIndex_; the copy keeps no column order, so a header two columns answer is not this port's."""
    at = {}
    for k, rx in patterns.items():
        hits = [i for i, h in enumerate(head) if rx.search(h)]
        if len(hits) > 1:
            raise Defer(f"two Van Calendar columns answer '{k}' and the copy keeps no column order")
        at[k] = hits[0] if hits else -1
    return at


def _display_grid(reads: L.Reads, ref: hubdb.TabRef) -> tuple[list[str], list[tuple[int, list[str]]]]:
    """getDisplayValues(): the header, then each row's shown text, with its sheet row."""
    heads = [_jtrim(h).lower() for h in ref.headers]
    rows = [(rn, [hubdb.typed(raw.get(h), "raw") for h in ref.headers]) for rn, raw in reads.db.rows(ref)]
    return heads, rows


def _realign(head: list[str], line: list[str], event: int) -> list[str]:
    """line.slice(0, event).concat([''], line.slice(event)) on the sheet's own column order."""
    order = [h.lower() for h in VAN_REQUESTS_ORDER]
    if sorted(h for h in head if h) != sorted(order):
        raise Defer("a Van Calendar request sits one column off and the Requests columns are not the ones whose order "
                    "this port knows")
    by = dict(zip(head, line))
    at = order.index(head[event])
    moved = {h: (by.get(h, "") if p < at else "" if p == at else by.get(order[p - 1], "")) for p, h in enumerate(order)}
    return [moved.get(h, "") if h else "" for h in head]


def _requests(reads: L.Reads, ref: hubdb.TabRef) -> dict[str, Any]:
    """csTransportRequests_: the Requests tab as display text."""
    head, grid = _display_grid(reads, ref)
    c = _head_index(head, {"status": re.compile(r"^status$"), "event": re.compile(r"^event id$"),
                           "vehicle": re.compile(r"^select vehicle$"), "ts": re.compile(r"^timestamp$"),
                           "staff": re.compile(r"^your name$"), "client": re.compile(r"^client name$"),
                           "date": re.compile(r"^date\b"), "start": re.compile(r"^start time$"),
                           "end": re.compile(r"^end time$"), "why": re.compile(r"^why\b"),
                           "dest": re.compile(r"^destination")})
    if c["client"] < 0 or c["date"] < 0:
        raise RuntimeError("the Requests tab has no Client Name or Date column")
    out: dict[str, Any] = {"rows": [], "total": 0, "realigned": 0, "unread": 0}
    for rn, cells in grid:
        line = [gsjs.trim(_s(v)) for v in cells]
        if not any(v != "" for v in line):
            continue
        out["total"] += 1
        shifted = c["event"] >= 0 and bool(transport_day(line[c["client"]])) and not transport_day(line[c["date"]]) \
            and transport_clock(line[c["date"]]) is not None
        if shifted:
            line = _realign(head, line, c["event"])
            out["realigned"] += 1

        def get(k: str, line: list = line) -> str:
            return text(line[c[k]]) if c[k] >= 0 else ""

        day = transport_day(get("date"))
        if not day or not get("client"):
            out["unread"] += 1
            continue
        out["rows"].append({"row": rn, "status": get("status"), "event_id": get("event"), "vehicle": get("vehicle"),
                            "requested_at": get("ts"), "staff": get("staff"), "client": get("client"), "date": day,
                            "start": get("start"), "end": get("end"), "reason": get("why"), "destination": get("dest"),
                            "realigned": shifted})
    return out


def _conflicts(reads: L.Reads, ref: hubdb.TabRef) -> list[dict]:
    head, grid = _display_grid(reads, ref)
    c = _head_index(head, {"status": re.compile(r"^status$"), "date": re.compile(r"^date$"),
                           "clients": re.compile(r"^clients? in conflict"), "time": re.compile(r"^conflict time"),
                           "notes": re.compile(r"^notes?$")})
    if c["clients"] < 0 or c["date"] < 0:
        raise RuntimeError("the Conflicts tab has no Date or Clients in Conflict column")
    rows = []
    for rn, line in grid:
        def get(k: str, line: list = line) -> str:
            return text(line[c[k]]) if c[k] >= 0 else ""

        day = transport_day(get("date"))
        if not day or not get("clients"):
            continue
        rows.append({"row": rn, "status": get("status"), "date": day, "clients": get("clients"), "time": get("time"),
                     "notes": text(line[c["notes"]], 300) if c["notes"] >= 0 else ""})
    return rows


def _van_book(reads: L.Reads) -> dict[str, Any]:
    """csTransportBook_: both tabs; a tab that did not read carries its sentence."""
    def read() -> dict[str, Any]:
        sid = reads.prop_book(CS_TRANSPORT_VAN_PROP, CS_TRANSPORT_VAN_FALLBACK)
        out: dict[str, Any] = {"id": sid, "requests": None, "conflicts": None, "requests_why": "", "conflicts_why": "",
                               "total": 0, "realigned": 0, "unread": 0, "degraded": False}

        def requests() -> dict:
            ref = _tab(reads, sid, CS_TRANSPORT_REQUESTS_TAB, "the Van Calendar")
            if ref is None:
                raise RuntimeError("the book has no " + CS_TRANSPORT_REQUESTS_TAB + " tab")
            return _requests(reads, ref)

        got, why = _soft(requests)
        if got is None:
            out["requests_why"] = f"the Van Calendar requests could not be read ({why})"
            out["degraded"] = True
        else:
            out["requests"], out["total"], out["realigned"], out["unread"] = \
                got["rows"], got["total"], got["realigned"], got["unread"]

        def conflicts() -> list:
            ref = _tab(reads, sid, CS_TRANSPORT_CONFLICTS_TAB, "the Van Calendar")
            if ref is None:
                raise RuntimeError("the book has no " + CS_TRANSPORT_CONFLICTS_TAB + " tab")
            return _conflicts(reads, ref)

        got2, why2 = _soft(conflicts)
        if got2 is None:
            out["conflicts_why"] = f"the Van Calendar conflicts could not be read ({why2})"
            out["degraded"] = True
        else:
            out["conflicts"] = got2
        return out
    return reads.once("cs:van_book", read)


def _form_rows(reads: L.Reads) -> dict[str, Any]:
    """csTransportFormRows_: the Hub form's own submissions (slug van-calendar, van-calendar-2, …)."""
    rows, why = _soft(lambda: kept_hub_rows(reads, "form_submissions"))
    if rows is None:
        return {"rows": None, "why": f"the Hub form submissions could not be read ({why})"}
    out = []
    for s in rows:
        slug = gsjs.trim(gsjs.or_text((s or {}).get("form_slug"))).lower()
        if slug != CS_TRANSPORT_FORM_SLUG and not slug.startswith(CS_TRANSPORT_FORM_SLUG + "-"):
            continue
        try:
            a = json.loads(gsjs.js_str(s.get("answers") if _truthy(s.get("answers")) else "{}"))
        except ValueError:
            a = {}
        a = a if isinstance(a, dict) else {}
        day = transport_day(a.get("date_day_client_needs_the_van"))
        if not day or not gsjs.trim(gsjs.or_text(a.get("client_name"))):
            continue
        out.append({"id": gsjs.or_text(s.get("id")), "status": gsjs.or_text(s.get("state")),
                    "vehicle": text(a.get("select_vehicle")), "requested_at": gsjs.or_text(s.get("submitted_at")),
                    "staff": text(a.get("your_name") or s.get("name")), "client": text(a.get("client_name")),
                    "date": day, "start": text(a.get("start_time")), "end": text(a.get("end_time")),
                    "reason": text(a.get("why_does_the_client_need_the_van")),
                    "destination": text(a.get("destination_address"), 300)})
    return {"rows": out, "why": ""}


def _visit_rows(reads: L.Reads) -> dict[str, Any]:
    rows, why = _soft(lambda: estate_rows(reads, "drVisits"))
    if rows is None:
        return {"rows": None, "why": f"the Dr Appt Archive could not be read ({why})"}
    return {"rows": [r for r in rows if re.match(r"^y", gsjs.trim(gsjs.or_text((r or {}).get("wheelchair_van_required"))),
                                                  re.I)], "why": ""}


def _repair_rows(reads: L.Reads) -> dict[str, Any]:
    rows, why = _soft(lambda: estate_rows(reads, "workOrders"))
    return {"rows": rows or [], "why": ""} if rows is not None else \
        {"rows": None, "why": f"the repairs could not be read ({why})"}


def _fleet_rows(reads: L.Reads) -> dict[str, Any]:
    rows, why = _soft(lambda: kept_hub_rows(reads, "fleetVehicles"))
    return {"rows": rows or [], "why": ""} if rows is not None else \
        {"rows": None, "why": f"the fleet list could not be read ({why})"}


def _punch_rows(reads: L.Reads) -> dict[str, Any]:
    """csTransportPunchRows_: only the punches that logged units, with the feed's newest day."""
    def read() -> dict[str, Any]:
        got = reads.punches()
        if got["rows"] is None:
            return {"rows": None, "why": got["why"], "degraded": True}
        newest, rows = "", []
        for p in got["rows"]:
            d = transport_day(p.get("date_iso"))
            if d > newest:
                newest = d
            if not _js_number(_s(p.get("transportation_units")).replace(",", "")) > 0:
                continue
            rows.append({"id": gsjs.or_text(p.get("id") or p.get("single_entry_id")), "employee": p.get("employee"),
                         "date_iso": p.get("date_iso"), "date_service": p.get("date_service"),
                         "start_time": p.get("start_time"), "end_time": p.get("end_time"), "hours": p.get("hours"),
                         "transportation_units": p.get("transportation_units"), "work_code": p.get("work_code"),
                         "status": p.get("status"), "consumer_1": p.get("consumer_1"), "consumer_2": p.get("consumer_2"),
                         "consumer_3": p.get("consumer_3")})
        return {"rows": rows, "newest": newest, "why": ""}
    return reads.once("cs:punch_rows", read)


def _trip(src: str, tid: str, r: dict) -> dict[str, Any]:
    start, end = transport_clock(r.get("start")), transport_clock(r.get("end"))
    return {"id": tid, "source": src, "sheet_row": r.get("row") or 0, "date": r.get("date"), "start": start, "end": end,
            "time": clock_label(start) or r.get("start") or "", "end_time": clock_label(end) or r.get("end") or "",
            "reason": r.get("reason") or "", "destination": r.get("destination") or "", "staff": r.get("staff") or "",
            "requested_at": r.get("requested_at") or "", "requested_on": transport_day(r.get("requested_at")),
            "vehicle": r.get("vehicle") or "", "event_id": r.get("event_id") or "", "book_status": r.get("status") or "",
            "realigned": bool(r.get("realigned")), "requests": 1, "dr_name": "", "dr_address": "", "visit_id": "",
            "conflict": "", "conflict_time": "", "conflict_open": False}


def _trip_key(t: dict) -> str:
    return t["date"] + "|" + (gsjs.js_str(t["time"]) if t["start"] is None else str(t["start"])) + "|" + name_key(t["vehicle"])


def _trip_status(t: dict, today: str) -> str:
    if re.search(r"cancel", t["book_status"], re.I):
        return "Cancelled"
    ahead = t["date"] >= today
    if not t["vehicle"]:
        return "Needs assignment" if ahead else "No booking"
    if ahead:
        return "Needs assignment" if t["conflict_open"] else "Scheduled"
    if t["requested_on"] and t["requested_on"] > t["date"]:
        return "Check date"
    return "Completed"


def _null_key(n: int | None) -> str:
    return "null" if n is None else str(n)


def _form_only(requests: list | None, form: list | None) -> list[dict]:
    """csTransportFormOnly_: Hub form requests the book does not already carry."""
    seen: set[str] = set()
    for r in requests or []:
        ck = (name_keys(r["client"]) or [""])[0]
        seen.add(ck + "|" + r["date"] + "|" + _null_key(transport_clock(r["start"])))
        seen.add(ck + "|" + r["date"] + "|any")
    out = []
    for r in form or []:
        ck = (name_keys(r["client"]) or [""])[0]
        start = transport_clock(r["start"])
        if ck + "|" + r["date"] + "|" + _null_key(start) in seen or (start is None and ck + "|" + r["date"] + "|any" in seen):
            continue
        out.append(r)
    return out


def _list_names(names: dict, cell: Any) -> bool:
    return named(names, cell) or any(named(names, p) for p in
                                     re.split(r"\s*(?:,|;|&|/|\n|\band\b)\s*", gsjs.or_text(cell), flags=re.I))


def _trips(names: dict, src: dict, today: str) -> list[dict]:
    """csTransportTrips_: book requests, then Hub form requests, then van visits no request covers."""
    trips: list[dict] = []
    by_key: dict[str, dict] = {}
    booked_day: dict[str, list] = {}
    by_day: dict[str, list] = {}

    def add(t: dict) -> None:
        k = _trip_key(t)
        was = by_key.get(k)
        if was is None:
            by_key[k] = t
            trips.append(t)
            return
        was["requests"] += 1
        for f in ("end", "end_time", "staff", "destination", "reason", "event_id"):
            if (was[f] == "" or was[f] is None) and t[f] != "" and t[f] is not None:
                was[f] = t[f]

    vc = src.get("vc")
    for t in (vc or {}).get("rows") or []:
        trips.append(t)
    for r in src.get("requests") or []:
        if vc and (vc.get("refs") or {}).get("van_calendar:r" + str(r["row"])):
            continue
        if named(names, r["client"]):
            add(_trip("van_calendar", "vc" + str(r["row"]), r))
    for r in src.get("form") or []:
        if named(names, r["client"]):
            add(_trip("hub_form", "hf" + r["id"], r))
    for t in trips:
        booked_day.setdefault(t["date"], []).append(t)
    for v in src.get("visits") or []:
        if not named(names, v.get("client_name")):
            continue
        day = transport_day(v.get("appointment_date"))
        if not day:
            continue
        dr, where = text(v.get("dr_name")), text(v.get("appointment_address"), 300)
        at = transport_clock(v.get("appointment_start_time"))
        booked = booked_day.get(day)
        if booked:
            free = [t for t in booked if not t["visit_id"]]
            free.sort(key=_cmp(lambda a, b: (0 if a["start"] is None or at is None else abs(a["start"] - at))
                               - (0 if b["start"] is None or at is None else abs(b["start"] - at))))
            if free:
                free[0]["visit_id"], free[0]["dr_name"], free[0]["dr_address"] = gsjs.or_text(v.get("id")), dr, where
            continue
        t = _trip("dr_visits", "dv" + gsjs.or_text(v.get("id")),
                  {"date": day, "start": gsjs.or_text(v.get("appointment_start_time")), "end": "", "reason": "",
                   "destination": where, "staff": text(v.get("manager")), "requested_at": gsjs.or_text(v.get("timestamp")),
                   "vehicle": "", "status": ""})
        t["visit_id"], t["dr_name"], t["dr_address"] = gsjs.or_text(v.get("id")), dr, where
        trips.append(t)
    for t in trips:
        by_day.setdefault(t["date"], []).append(t)
    for c in src.get("conflicts") or []:
        if not _list_names(names, c["clients"]):
            continue
        sp = _span(c["time"])
        for t in by_day.get(c["date"]) or []:
            overlaps = sp["start"] is None or t["start"] is None or (
                t["start"] <= (sp["start"] if sp["end"] is None else sp["end"])
                and (t["start"] if t["end"] is None else t["end"]) >= sp["start"])
            if not overlaps:
                continue
            t["conflict"] = c["status"] or "Listed"
            t["conflict_time"] = c["time"]
            t["conflict_open"] = bool(re.search(r"unresolv", c["status"], re.I)) or \
                not re.search(r"resolv|closed|done|cleared|fixed", c["status"], re.I)
    for t in trips:
        if t["source"] == "vehicle_calendar":
            continue
        t["status"] = _trip_status(t, today)
        t["record"] = t["reason"] or (t["dr_name"] if t["dr_name"] else "") or "Van trip"
        t["assignment"] = t["vehicle"]
        t["reserved_time"] = (t["time"] + " – " + t["end_time"] if t["end_time"] else t["time"]) if t["time"] else ""
        t["details"] = " · ".join(x for x in (t["vehicle"] or "No vehicle booked", t["reserved_time"],
                                              t["destination"] or t["dr_address"]) if x)
    return trips


def _by_day(direction: int) -> Any:
    def cmp(a: dict, b: dict) -> int:
        if a["date"] != b["date"]:
            return direction * (-1 if a["date"] < b["date"] else 1)
        x = 9999 if a["start"] is None else a["start"]
        y = 9999 if b["start"] is None else b["start"]
        return direction * (x - y)
    return _cmp(cmp)


def _window(requests: list) -> dict | None:
    lo = hi = None
    for r in requests or []:
        s, e = transport_clock(r["start"]), transport_clock(r["end"])
        if s is None or e is None or e <= s:
            continue
        if lo is None or s < lo:
            lo = s
        if hi is None or e > hi:
            hi = e
    return None if lo is None else {"start": lo, "end": hi}


def _covers(bookings: list, win: dict | None) -> bool:
    if not win:
        return False
    spans = sorted(([b["start"], b["end"]] for b in bookings
                    if b["start"] is not None and b["end"] is not None and b["end"] > b["start"]), key=lambda s: s[0])
    reach = win["start"]
    for s in spans:
        if s[0] > reach:
            return False
        if s[1] > reach:
            reach = s[1]
        if reach >= win["end"]:
            return True
    return reach >= win["end"]


def _base_key(name: Any) -> str:
    return name_key(re.sub(r"\s*(?:[-#–]\s*|\bno\.?\s*|\bunit\s*)\d+\s*$", "", gsjs.or_text(name), flags=re.I))


def _vehicles(names: dict, src: dict, date: str, trip_ids: dict) -> dict[str, Any]:
    """csTransportVehicles_: every vehicle any request names or the fleet list holds, with its day."""
    by_key: dict[str, dict] = {}
    order: list[str] = []

    def vehicle_for(name: Any) -> dict | None:
        key = name_key(name)
        if not key:
            return None
        if key not in by_key:
            by_key[key] = {"key": key, "name": text(name), "requests": 0, "clients": {}, "first": "", "last": "",
                           "bookings": [], "seen": {}, "fleet": None, "repairs": [], "open": []}
            order.append(key)
        return by_key[key]

    reqs = list(src.get("requests") or []) + list(src.get("form") or [])
    for r in reqs:
        v = vehicle_for(r["vehicle"])
        if v is None:
            continue
        v["requests"] += 1
        ck = (name_keys(r["client"]) or [""])[0]
        if ck:
            v["clients"][ck] = True
        if not v["first"] or r["date"] < v["first"]:
            v["first"] = r["date"]
        if not v["last"] or r["date"] > v["last"]:
            v["last"] = r["date"]
        if r["date"] != date:
            continue
        start, end = transport_clock(r["start"]), transport_clock(r["end"])
        seen_key = ck + "|" + (gsjs.js_str(r["start"]) if start is None else str(start))
        if v["seen"].get(seen_key):
            continue
        v["seen"][seen_key] = True
        mine = named(names, r["client"])
        trip_key = r["date"] + "|" + (text(r["start"]) if start is None else str(start)) + "|" + v["key"]
        v["bookings"].append({"start": start, "end": end, "time": clock_label(start) or r["start"],
                              "end_time": clock_label(end) or r["end"], "mine": mine,
                              "trip_id": (trip_ids.get(trip_key) or "") if mine else "",
                              "record": r["reason"] if mine else "", "destination": r["destination"] if mine else "",
                              "who": "This client" if mine else "Another client"})
    for b in (src.get("vc") or {}).get("bookings") or []:
        if b["date"] != date:
            continue
        hit = ""
        for a in [b["vehicle"]] + list(b.get("aliases") or []):
            k = name_key(a)
            if not hit and k and k in by_key:
                hit = k
        v = by_key[hit] if hit else vehicle_for(b["vehicle"])
        if v is None:
            continue
        mine = named(names, b["client"])
        v["bookings"].append({"start": b["start"], "end": b["end"], "time": b["time"], "end_time": b["end_time"],
                              "mine": mine, "trip_id": b["id"] if mine else "", "record": b["record"] if mine else "",
                              "destination": b["destination"] if mine else "",
                              "who": "This client" if mine else "Another client"})
    for f in src.get("fleet") or []:
        if re.search(r"retired", gsjs.or_text(f.get("status")), re.I):
            continue
        keys = [k for k in (name_key(f.get("unit")), name_key(f.get("vehicle"))) if k]
        for a in f.get("aliases") or []:
            k = name_key(a)
            if k and k not in keys:
                keys.append(k)
        v = None
        for k in keys:
            if v is None and k in by_key:
                v = by_key[k]
        if v is None:
            v = vehicle_for(f.get("unit") or f.get("vehicle"))
        if v is None:
            continue
        v["fleet"] = {"unit": text(f.get("unit")), "vehicle": text(f.get("vehicle")), "year": text(f.get("year")),
                      "plate": text(f.get("plate")), "status": text(f.get("status"))}
    bases: dict[str, list] = {}
    for k in order:
        b = _base_key(by_key[k]["name"])
        if b:
            bases.setdefault(b, []).append(k)
    for r in src.get("repairs") or []:
        target = name_key(r.get("select_address_vehicle"))
        if not target:
            continue
        key = target if target in by_key else (bases[target][0] if len(bases.get(target) or []) == 1 else "")
        if not key:
            continue
        v = by_key[key]
        status = text(r.get("status"))
        rep = {"id": gsjs.or_text(r.get("id")), "date": transport_day(r.get("timestamp")),
               "issue": text(r.get("please_describe_the_issue"), 300), "repair_type": text(r.get("repair_type")),
               "status": status or "Open", "resolution": text(r.get("resolution_notes"), 300)}
        v["repairs"].append(rep)
        if not re.search(r"complet|cancel|closed|done|resolved", status, re.I) and (not rep["date"] or rep["date"] <= date):
            v["open"].append(rep)
    win = _window(reqs)
    rows = []
    for k in order:
        v = by_key[k]
        v["bookings"].sort(key=lambda b: 9999 if b["start"] is None else b["start"])
        if v["open"] or (v["fleet"] and re.search(r"service|shop|repair", v["fleet"]["status"], re.I)):
            status = "Maintenance"
        elif not v["bookings"]:
            status = "Available"
        else:
            status = "Booked" if _covers(v["bookings"], win) else "Partly Booked"
        clients = len(v["clients"])
        facts = []
        if v["fleet"]:
            facts.append(" · ".join(x for x in (v["fleet"]["vehicle"], v["fleet"]["year"], v["fleet"]["plate"]) if x))
        if v["requests"]:
            facts.append(f"Named on {v['requests']} request{'' if v['requests'] == 1 else 's'} for {clients} client"
                         f"{'' if clients == 1 else 's'}, {v['first']} to {v['last']}")
        v["repairs"].sort(key=_cmp(lambda a, b: 1 if a["date"] < b["date"] else (-1 if a["date"] > b["date"] else 0)))
        rows.append({"id": "veh_" + k, "record": v["name"], "vehicle": v["name"], "date": date, "status": status,
                     "details": "; ".join(x for x in facts if x) or "On the fleet list", "requests_total": v["requests"],
                     "clients_total": clients, "first_date": v["first"], "last_date": v["last"], "bookings": v["bookings"],
                     "maintenance": v["open"], "repairs": v["repairs"][:10], "fleet": v["fleet"]})
    rows.sort(key=_cmp(lambda a, b: (b["requests_total"] - a["requests_total"]) or locale_cmp(a["vehicle"], b["vehicle"])))
    return {"rows": rows, "window": {"start": clock_label(win["start"]), "end": clock_label(win["end"])} if win else None}


def _miles(names: dict, punches: list) -> list[dict]:
    """csTransportMiles_: the shifts that logged units with this client."""
    rows: list[dict] = []
    for p in punches or []:
        units = _js_number(_s(p.get("transportation_units")).replace(",", ""))
        if not units > 0:
            continue
        if not any(named(names, c) for c in (p.get("consumer_1"), p.get("consumer_2"), p.get("consumer_3"))):
            continue
        day = transport_day(p.get("date_iso")) or transport_day(p.get("date_service"))
        if not day:
            continue
        start, end = text(p.get("start_time")), text(p.get("end_time"))
        rows.append({"id": "psi" + gsjs.js_str(p.get("id") or p.get("single_entry_id") or len(rows)),
                     "record": text(p.get("employee")) or "Shift", "date": day, "status": "Logged",
                     "units": _round2(units),
                     "details": _num_s(units) + " transportation unit" + ("" if units == 1 else "s")
                     + ((" · " + start + (" – " + end if end else "")) if start else "")
                     + (" · " + text(p.get("work_code")) if _truthy(p.get("work_code")) else ""),
                     "employee": text(p.get("employee")), "start_time": start, "end_time": end,
                     "hours": text(p.get("hours")), "work_code": text(p.get("work_code")),
                     "psi_status": text(p.get("status"))})
    rows.sort(key=_cmp(lambda a, b: 1 if a["date"] < b["date"] else (-1 if a["date"] > b["date"] else 0)))
    return rows


def _semi(items: list) -> str:
    return "; ".join(x for x in items if x)


def transport_answer(ctx: dict) -> dict[str, Any]:
    """csTransportAnswer_: every source in hand (rows, or null with why) → the four tabs."""
    today, date, book = ctx["today"], ctx["date"], ctx["book"]
    src: dict[str, Any] = {"requests": book["requests"], "conflicts": book["conflicts"],
                           "form": _form_only(book["requests"], ctx["form"]["rows"]), "visits": ctx["visits"]["rows"],
                           "repairs": ctx["repairs"]["rows"], "fleet": ctx["fleet"]["rows"]}
    if ctx.get("vc"):
        src["vc"] = ctx["vc"]
        if ctx["vc"].get("vehicles"):
            src["fleet"] = list(src["fleet"] or []) + list(ctx["vc"]["vehicles"])
    trips = _trips(ctx["names"], src, today)
    trip_ids = {_trip_key(t): t["id"] for t in trips}
    book_read = book["requests"] is not None
    read_note = (f"{book['unread']} Van Calendar request row{'' if book['unread'] == 1 else 's'} carried no readable day "
                 "or client and are not shown") if book_read and book["unread"] else ""
    trip_why = _semi([book["requests_why"], book["conflicts_why"], ctx["visits"]["why"], ctx["form"]["why"]])
    newest = ""
    for r in list(book["requests"] or []) + list(ctx["form"]["rows"] or []):
        d = transport_day(r["requested_at"])
        if d > newest:
            newest = d

    def count(s: str) -> int:
        return sum(1 for t in trips if t["status"] == s)

    statuses = [s for s in CS_TRANSPORT_STATUSES if count(s) > 0]
    seen_vehicles: list[str] = []
    for t in trips:
        if t["vehicle"] and t["vehicle"] not in seen_vehicles:
            seen_vehicles.append(t["vehicle"])
    history = sorted(trips, key=_by_day(-1))
    calendar = [{"id": t["id"], "record": t["record"], "date": t["date"], "details": t["details"], "status": t["status"],
                 "time": t["time"], "end_time": t["end_time"], "vehicle": t["vehicle"],
                 "destination": t["destination"] or t["dr_address"]} for t in sorted(trips, key=_by_day(1))]
    conflicts = [{"date": c["date"], "time": c["time"], "status": c["status"] or "Listed", "notes": c["notes"]}
                 for c in book["conflicts"] or [] if _list_names(ctx["names"], c["clients"])]
    fleet = _vehicles(ctx["names"], src, date, trip_ids) if book_read else {"rows": [], "window": None}

    def vkpi(s: str) -> int:
        return sum(1 for v in fleet["rows"] if v["status"] == s)

    vehicles_why = _semi([ctx["repairs"]["why"] + ", so no repair is shown as maintenance" if ctx["repairs"]["why"] else "",
                          ctx["fleet"]["why"], ctx["form"]["why"]]) if book_read else book["requests_why"]
    punches = ctx["punches"]["rows"]
    miles = [] if punches is None else _miles(ctx["names"], punches)
    units = 0.0
    for m in miles:
        units += m["units"]
    miles_as_of = ctx["punches"].get("newest") or ""
    if not miles_as_of:
        for p in punches or []:
            d = transport_day(p.get("date_iso"))
            if d > miles_as_of:
                miles_as_of = d

    def tab(body: dict, why: str, as_of: str, note: str = "") -> dict:
        if why:
            body["why"] = why
        if as_of:
            body["as_of"] = as_of
        if note:
            body["note"] = note
        return body

    def rows_or_null(rows: list | None) -> int | None:
        return None if rows is None else len(rows)

    answer = {
        "client": ctx["client"], "today": today, "date": date, "rule": CS_TRANSPORT_RULE,
        "degraded": (not book_read or book["conflicts"] is None or ctx["visits"]["rows"] is None
                     or ctx["form"]["rows"] is None or ctx["repairs"]["rows"] is None or ctx["fleet"]["rows"] is None
                     or punches is None),
        "sources": [
            {"id": "van_requests", "label": "Van Calendar › Requests", "rows": book["total"] if book_read else None,
             "realigned": book["realigned"] or 0, "why": book["requests_why"]},
            {"id": "van_conflicts", "label": "Van Calendar › Conflicts", "rows": rows_or_null(book["conflicts"]),
             "why": book["conflicts_why"]},
            {"id": "hub_form", "label": "Hub form › Van Calendar", "rows": rows_or_null(ctx["form"]["rows"]),
             "why": ctx["form"]["why"]},
            {"id": "dr_visits", "label": "Dr Appt Archive › van required", "rows": rows_or_null(ctx["visits"]["rows"]),
             "why": ctx["visits"]["why"]},
            {"id": "repairs", "label": "Repairs", "rows": rows_or_null(ctx["repairs"]["rows"]), "why": ctx["repairs"]["why"]},
            {"id": "fleet", "label": "Fleet vehicles", "rows": rows_or_null(ctx["fleet"]["rows"]), "why": ctx["fleet"]["why"]},
            {"id": "psi_punches", "label": "PSI punches › transportation units", "rows": rows_or_null(punches),
             "why": ctx["punches"]["why"]}],
        "tabs": {
            "calendar": tab({"rows": calendar,
                             "kpis": {"trips": len(calendar), "upcoming": sum(1 for t in calendar if t["date"] >= today),
                                      "vehicles": len(seen_vehicles)} if book_read else None,
                             "vehicles": seen_vehicles,
                             "range": {"first": calendar[0]["date"], "last": calendar[-1]["date"]} if calendar else None},
                            trip_why, newest, read_note),
            "history": tab({"rows": history,
                            "kpis": {"needs_assignment": count("Needs assignment"), "scheduled": count("Scheduled"),
                                     "completed": count("Completed")} if book_read else None,
                            "statuses": statuses, "conflicts": conflicts, "rule": CS_TRANSPORT_RULE},
                           trip_why, newest, read_note),
            "vehicles": tab({"rows": fleet["rows"],
                             "kpis": {"vehicles": len(fleet["rows"]), "available": vkpi("Available"),
                                      "partly_booked": vkpi("Partly Booked"), "booked": vkpi("Booked"),
                                      "maintenance": vkpi("Maintenance")} if book_read else None,
                             "date": date, "window": fleet["window"], "statuses": list(CS_TRANSPORT_AVAILABILITY),
                             "rule": CS_TRANSPORT_AVAILABILITY_RULE}, vehicles_why, newest),
            "mileage": tab({"rows": miles,
                            "kpis": None if punches is None else {
                                "shifts": len(miles), "units": _round2(units),
                                "first": miles[-1]["date"] if miles else "", "last": miles[0]["date"] if miles else ""}},
                           ctx["punches"]["why"], miles_as_of)}}
    if ctx.get("vc"):
        answer["sources"].append({"id": "vehicle_calendar", "label": "Transportation › Trips",
                                  "rows": None if ctx["vc"].get("why") else len(ctx["vc"].get("rows") or []),
                                  "why": ctx["vc"].get("why") or ""})
    return answer


# -- VehicleCalendar.gs: the trips Clients › Transportation reads --

def _vc_ms(v: Any) -> float:
    t = gsjs.date_parse(gsjs.trim(_s(v)))
    return math.nan if t is None else t


def _vc_at(ms: float) -> datetime:
    return datetime.fromtimestamp(ms / 1000.0, timezone.utc).astimezone(NY)


def _vc_rows(reads: L.Reads, key: str) -> list[dict]:
    """vcRead_: every row of a Transportation house keyed by its header; throws (naming the house) when unreadable."""
    tab = VC_TABS[key]
    if HT.tabled(tab):
        got = [{h: gsjs.trim(v) for h, v in r.items()} for r in HT.rows(reads, tab)]
        return [r for r in got if r.get("id")]
    if not reads.db.house_moved(tab):
        raise RuntimeError(f'The Transportation house "{tab}" is not set up (no pointer, or moved.{tab} is not on).')
    res = reads.db.resolve(tab)
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the Transportation house {tab}")
    out = []
    if res.ref is not None:
        heads = [gsjs.trim(gsjs.or_text(h)) for h in res.ref.headers]
        for _rn, raw in reads.db.rows(res.ref):
            row = {h: gsjs.trim(_s(hubdb.typed(raw.get(src), "raw"))) for h, src in zip(heads, res.ref.headers) if h}
            if row.get("id"):
                out.append(row)
    return out


def _vc_aliases(r: dict) -> list[str]:
    out: list[str] = []
    for a in [r.get("name")] + _jtrim(r.get("aliases")).split("|"):
        s = _jtrim(a)
        if s and s not in out:
            out.append(s)
    return out


def _vc_trip_out(t: dict, by_id: dict, now_ms: float) -> dict[str, Any]:
    """vcClientTripOut_: one vc trip in the Clients transport tab's own trip shape."""
    s, e = _vc_ms(t.get("start_at")), _vc_ms(t.get("end_at"))
    veh = by_id.get(t.get("vehicle_id") if t.get("state") == "scheduled" else "")
    start = None if math.isnan(s) else _vc_at(s).hour * 60 + _vc_at(s).minute
    same_day = not math.isnan(s) and not math.isnan(e) and _vc_at(s).date() == _vc_at(e).date()
    end = _vc_at(e).hour * 60 + _vc_at(e).minute if t.get("end_known") != "no" and same_day else None

    def words(ms: float) -> str:
        at = _vc_at(ms)
        return f"{(at.hour % 12) or 12}:{at.minute:02d} {'AM' if at.hour < 12 else 'PM'}"

    time = "" if math.isnan(s) else words(s)
    end_time = "" if end is None else words(e)
    reason = _jtrim(t.get("purpose")) or _jtrim(t.get("trip_type"))
    vehicle = _jtrim(veh.get("name")) if veh else ""
    if t.get("state") in ("requested", "needs_assignment"):
        status = "Needs assignment"
    elif t.get("state") == "scheduled":
        status = "Completed" if _vc_ms(t.get("end_at")) <= now_ms else "Scheduled"
    else:
        status = "Cancelled"
    reserved = (time + " – " + end_time if end_time else time) if time else ""
    created = t.get("created_at")
    created_ms = _vc_ms(created)
    return {"id": t.get("id"), "source": "vehicle_calendar", "sheet_row": 0, "date": t.get("day"), "start": start,
            "end": end, "time": time, "end_time": end_time, "reason": reason, "destination": _jtrim(t.get("destination")),
            "staff": _jtrim(t.get("staff_name")), "requested_at": created,
            "requested_on": _ny_day(0 if math.isnan(created_ms) else created_ms) if created else "",
            "vehicle": vehicle, "event_id": "", "book_status": "", "realigned": False, "requests": 1, "dr_name": "",
            "dr_address": "", "visit_id": "", "conflict": "", "conflict_time": "", "conflict_open": False,
            "status": status, "record": reason or "Van trip", "assignment": vehicle, "reserved_time": reserved,
            "details": " · ".join(x for x in (vehicle or "No vehicle booked", reserved, _jtrim(t.get("destination"))) if x)}


def vc_client_trips(reads: L.Reads, client_key: str, name: str, names: dict) -> dict[str, Any]:
    """vcClientTrips_: the client's trips from vc_trips, every imported row's source_ref, the platform's bookings."""
    vehicles = reads.once("cs:vc:vehicles", lambda: _vc_rows(reads, "vehicles"))
    trips = reads.once("cs:vc:trips", lambda: _vc_rows(reads, "trips"))
    by_id = {_jtrim(r.get("id")): r for r in vehicles}
    now_ms = reads.now.timestamp() * 1000.0
    fold = names or {}
    if not fold and name:
        fold = {name_key(name): True}
    out: dict[str, Any] = {"rows": [], "refs": {}, "vehicles": [], "bookings": [], "why": ""}
    for r in vehicles:
        a = _jtrim(r.get("availability")).lower()
        a = a if a in VC_AVAILABILITY else "available"
        out["vehicles"].append({"unit": _jtrim(r.get("name")), "vehicle": _jtrim(r.get("description")), "year": "",
                                "plate": "", "status": "active" if a == "available" else
                                ("service" if a == "maintenance" else "out of service"), "aliases": _vc_aliases(r)})
    for t in trips:
        if t.get("source_ref"):
            out["refs"][t["source_ref"]] = True
        mine = (bool(client_key) and t.get("client_key") == client_key) or \
            (not t.get("client_key") and bool(_jtrim(t.get("client_name"))) and named(fold, t.get("client_name")))
        if t.get("state") == "scheduled" and t.get("source") == "platform" and t.get("vehicle_id") in by_id:
            b = _vc_trip_out(t, by_id, now_ms)
            veh = by_id[t["vehicle_id"]]
            out["bookings"].append({"id": t.get("id"), "date": t.get("day"), "start": b["start"], "end": b["end"],
                                    "time": b["time"], "end_time": b["end_time"], "vehicle": _jtrim(veh.get("name")),
                                    "aliases": _vc_aliases(veh), "client": _jtrim(t.get("client_name")),
                                    "record": b["reason"], "destination": b["destination"]})
        if mine:
            out["rows"].append(_vc_trip_out(t, by_id, now_ms))
    return out


def _vc_part(reads: L.Reads, client: dict, names: dict) -> dict[str, Any]:
    """csTransportVcPart_: failing, today's answer stands and one source says why."""
    got, why = _soft(lambda: vc_client_trips(reads, client["client_key"], client["name"], names))
    if got is None:
        return {"rows": [], "refs": {}, "vehicles": [], "bookings": [],
                "why": f"the Transportation trips could not be read ({why})"}
    return got


def transport_own(data: dict) -> dict[str, Any]:
    """csTransportOwn_: a client's or a family's answer — their trips, without the fleet, the miles or their books."""
    out = dict(data or {})
    out["tabs"] = {t: v for t, v in ((data or {}).get("tabs") or {}).items() if t not in CS_TRANSPORT_OFFICE_TABS}
    out["sources"] = [s for s in (data or {}).get("sources") or [] if (s or {}).get("id") not in CS_TRANSPORT_OFFICE_SOURCES]
    return out


def transport_door(reads: L.Reads, payload: dict) -> dict[str, Any]:
    """csTransportDoor_: past the gate — the door's answer, and the pack's part (today's)."""
    payload = payload or {}
    who = transport_client(reads, payload.get("client"))
    if who.get("refused"):
        return who["refused"]
    today = reads.today()
    raw_date = gsjs.trim(gsjs.or_text(payload.get("date")))
    date = transport_day(raw_date) if raw_date else today
    if not date or (raw_date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw_date)):
        return {"status": 400, "message": "date: a day as yyyy-mm-dd."}
    data = transport_answer({"client": who["client"], "names": who["names"], "today": today, "date": date,
                             "book": _van_book(reads), "form": _form_rows(reads), "visits": _visit_rows(reads),
                             "repairs": _repair_rows(reads), "fleet": _fleet_rows(reads), "punches": _punch_rows(reads),
                             "vc": _vc_part(reads, who["client"], who["names"])})
    return {"status": 200, "data": _finite(data)}


def client_source_transport(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientSourceTransport (csTransportGate_); a client or a family member is answered their own cut. Calendar and
    History both stand on this answer, so App Control's Transportation row shuts the tab here."""
    import clients as C  # noqa: PLC0415
    reader = C.reader_for(sess, (payload or {}).get("client"))
    if not reader or not C.transport_open(sess):
        return {"status": 404, "message": "Unknown action."}
    got = transport_door(sess.reads, payload)
    if got.get("status") == 200 and reader.get("kind") in ("client", "guardian", "ssa"):
        return {"status": 200, "data": transport_own(got["data"])}
    return got


# ---- Funds and Billing ------------------------------------------------------------------------------------------

def csf_iso(y: int, m: int, d: int) -> str:
    if not (1900 <= y <= 2200 and 1 <= m <= 12 and 1 <= d <= 31):
        return ""
    return f"{y}-{m:02d}-{d:02d}"


def csf_serial_day(n: float) -> str:
    if not (20000 < n < 80000):
        return ""
    return (datetime(1899, 12, 30, tzinfo=timezone.utc) + timedelta(days=gsjs.js_round(n))).strftime("%Y-%m-%d")


def csf_day(v: Any) -> str:
    """csfDay_: a Date on Ohio's clock, ISO text, M/D/YY(YY), MM-DD-YYYY or a Sheets serial."""
    if isinstance(v, SheetDate):
        return v.at.astimezone(NY).strftime("%Y-%m-%d")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return csf_serial_day(float(v))
    s = _jtrim(v)
    if re.fullmatch(r"\d{5}(\.\d+)?", s):
        return csf_serial_day(float(s))
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return csf_iso(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.fullmatch(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})", s)
    if not m:
        return ""
    return csf_iso(int("20" + m.group(3) if len(m.group(3)) == 2 else m.group(3)), int(m.group(1)), int(m.group(2)))


def csf_days(start: str, end: str) -> int | None:
    a, b = gsjs.date_parse(f"{start}T12:00:00Z"), gsjs.date_parse(f"{end}T12:00:00Z")
    return None if a is None or b is None else int(gsjs.js_round((b - a) / 86400000))


def csf_span(value: Any) -> dict | None:
    """csfSpan_: 'Month D, YYYY - Month D, YYYY' or 'M/D/YY-M/D/YY' anywhere in the text."""
    s = _s(value)
    m = re.search(r"([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})\s*[-–—]+\s*([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})", s)
    if m:
        i = CSF_MONTHS.index(m.group(1).lower()) if m.group(1).lower() in CSF_MONTHS else -1
        j = CSF_MONTHS.index(m.group(4).lower()) if m.group(4).lower() in CSF_MONTHS else -1
        a = "" if i == -1 else csf_iso(int(m.group(3)), i + 1, int(m.group(2)))
        b = "" if j == -1 else csf_iso(int(m.group(6)), j + 1, int(m.group(5)))
        if a and b:
            return {"start": a, "end": b}
    m = re.search(r"(\d{1,2}/\d{1,2}/\d{2,4})\s*[-–—]+\s*(\d{1,2}/\d{1,2}/\d{2,4})", s)
    if m:
        c, d = csf_day(m.group(1)), csf_day(m.group(2))
        if c and d:
            return {"start": c, "end": d}
    return None


def csf_span_status(end: str, today: str) -> str:
    left = csf_days(today, end) if end else None
    if left is None:
        return "Unknown"
    if left < 0:
        return "Expired"
    return "Renewal due" if left <= CSF_RENEWAL_DAYS else "Current"


def csf_money(v: Any) -> float | None:
    """csfMoney_: '$ (483.72)' is -483.72, an accounting '$ -' is 0, a blank or a word is null."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return _round2(v) if math.isfinite(v) else None
    s = re.sub(r"[$,\s‎]", "", _s(v))
    if not s:
        return None
    if s == "-":
        return 0.0
    neg = False
    p = re.fullmatch(r"\((.*)\)", s)
    if p:
        neg, s = True, p.group(1)
    if not re.fullmatch(r"-?\d+(\.\d+)?", s):
        return None
    return _round2(-float(s) if neg else float(s))


def csf_number(v: Any) -> float | None:
    return L.num(re.sub(r"[\s,‎]", "", _s(v)))


def csf_percent(v: Any) -> float | None:
    s = _jtrim(v)
    if not s:
        return None
    pct = s.endswith("%")
    n = csf_number(re.sub(r"%$", "", s))
    if n is None:
        return None
    return _round2(n if pct or abs(n) > 1 else n * 100)


def csf_safe(v: Any, max_len: int = 0) -> str:
    """csfSafe_: any 9-digit or 12+-digit run cut to its last four."""
    return re.sub(r"\d{9,}", lambda m: m.group(0) if len(m.group(0)) in (10, 11)
                  else "•" * (len(m.group(0)) - 4) + m.group(0)[-4:], text(v, max_len))


def _unwithheld(v: Any, what: str) -> Any:
    """A cell the copies withhold (server/redaction.py) is Apps Script's to read."""
    if isinstance(v, str) and re.fullmatch(r"\s*\[withheld: [a-z]+\](?:\s.*)?", v, re.S):
        raise Defer(f"the copy withholds {what}")
    return v


def csf_last4(v: Any) -> str:
    # what the copy kept of the card (redaction BOOK_KEPT_FACTS): its last four, or that it holds none
    m = re.fullmatch(r"\s*\[withheld: [a-z]+\] kept: (\d{4}|on file|none)\s*", v) if isinstance(v, str) else None
    if m:
        return m.group(1) if m.group(1).isdigit() else ""
    d = re.sub(r"\D", "", _s(_unwithheld(v, "the card number whose last four the answer shows")))
    return d[-4:] if len(d) >= 4 else ""


def csf_money_words(n: Any) -> str:
    if n is None or not isinstance(n, (int, float)) or not math.isfinite(n):
        return ""
    whole = _to_fixed2(abs(n))
    head, _, frac = whole.partition(".")
    head = re.sub(r"\B(?=(\d{3})+(?!\d))", ",", head)
    return ("-$" if n < 0 else "$") + head + "." + frac


def csf_words(v: Any) -> list[str]:
    return [w for w in re.split(r"\s+", re.sub(r"[^a-z\s]", " ", _s(v).lower())) if w]


def _near_name(cell: Any, name: Any) -> bool:
    a, b = csf_words(cell), csf_words(name)
    if len(a) < 2 or len(b) < 2:
        return False
    af, al, bf, bl = a[0], a[-1], b[0], b[-1]
    if al == bl and len(af) >= 3 and len(bf) >= 3 and (af.startswith(bf) or bf.startswith(af)):
        return True
    if af != bf or len(al) != len(bl) or len(al) < 4:
        return False
    return sum(1 for x, y in zip(al, bl) if x != y) == 1


def name_match(cell: Any, c: dict) -> str:
    """csfNameMatch_: 'exact', 'near' (and no other client on file is as near), or ''."""
    k = name_key(cell)
    if not k:
        return ""
    if k == c["name_key"]:
        return "exact"
    if any(r["name_key"] == k for r in c["roster"]):
        return ""
    if not _near_name(cell, c["name"]):
        return ""
    return "" if any(r["client_key"] != c["client_key"] and _near_name(cell, r["name"]) for r in c["roster"]) else "near"


def _drive_id_of(v: Any) -> str:
    s = _jtrim(v)
    return s if re.fullmatch(r"[A-Za-z0-9_-]{20,}", s) else L.drive_id(s)


def _receipt_id(file_cell: Any, name_cell: Any) -> str:
    got = _drive_id_of(file_cell)
    if got:
        return got
    s = _jtrim(name_cell)
    m = re.fullmatch(r"form-receipt-([A-Za-z0-9_-]{20,})", s)
    return m.group(1) if m else L.drive_id(s)


def csf_client(reads: L.Reads, raw: Any) -> dict[str, Any]:
    """csfClient_: 400 malformed, 404 unknown, 503 unreadable."""
    key = _jtrim(raw)
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", key):
        return {"refused": {"status": 400, "message": "client: a client key, as the Clients app names it."}}
    rows, why = _soft(lambda: derived(reads))
    if rows is None:
        return {"refused": {"status": 503, "message": f"The clients could not be read just now ({why})."}}
    roster = []
    for r in rows:
        nm = text(r.get("name"))
        roster.append({"client_key": gsjs.trim(gsjs.or_text(r.get("client_key"))) or name_key(nm), "name": nm,
                       "name_key": name_key(nm), "row": r})
    hit = next((r for r in roster if r["client_key"] == key), None)
    if hit is None:
        return {"refused": {"status": 404, "message": f'No client "{key}" is on file.'}}
    row = hit["row"] or {}
    words = csf_words(hit["name"])
    last = words[-1] if words else ""
    mcd = gsjs.or_text(row.get("medicaid_id"))
    return {"client_key": key, "name": hit["name"], "name_key": hit["name_key"], "last_name": last,
            "shared": bool(hit["name_key"]) and sum(1 for r in roster if r["name_key"] == hit["name_key"]) > 1,
            "last_name_shared": any(r["client_key"] != key and csf_words(r["name"]) and csf_words(r["name"])[-1] == last
                                    for r in roster),
            "medicaid_id": mcd if re.fullmatch(r"\d{12}", mcd) else "", "medicaid_raw": mcd,
            "isp_year": text(row.get("isp_year"), 300),
            "ssa_name": text(row.get("ssa_name"), 80),
            "roster": [{"client_key": r["client_key"], "name": r["name"], "name_key": r["name_key"]} for r in roster]}


def _who(c: dict) -> dict[str, str]:
    return {"client_key": c["client_key"], "name": c["name"]}


def _shared_why(c: dict, holder: str) -> str:
    return f"more than one client on file is named {c['name']} and {holder} only by name, so the two cannot be told apart"


def _fin_num(v: Any) -> float:
    n = _js_number(re.sub(r"[,$\s]", "", "" if v is None else gsjs.js_str(v)))
    return n if math.isfinite(n) else 0.0


def _fin_src_day(v: Any) -> str:
    t = gsjs.str_(v)
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r"^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})", t)
    if not m:
        return ""
    y = "20" + m.group(3) if len(m.group(3)) == 2 else m.group(3)
    return f"{y}-{m.group(1).zfill(2)[-2:]}-{m.group(2).zfill(2)[-2:]}"


def _month_of(day: Any) -> str:
    m = re.match(r"^(\d{4})-(\d{2})", gsjs.trim(gsjs.or_text(day)))
    return f"{m.group(1)}-{m.group(2)}" if m else ""


def csf_txn(x: dict) -> dict[str, Any]:
    """csfTxn_: one ledger line."""
    amount = _round2(_fin_num(x.get("amount")))
    date = csf_day(x.get("date")) or _fin_src_day(x.get("date"))
    fund = text(x.get("fund")) or "Debit Card"
    verdict = text(x.get("verdict")).upper()
    receipt_cell = text(x.get("receipt_name"), 200)
    file_id = _receipt_id(x.get("receipt_file"), receipt_cell)
    receipt_name = "Spending log receipt" if receipt_cell.startswith("form-receipt-") else csf_safe(receipt_cell, 200)
    has = bool(receipt_name or file_id)
    exempt = verdict == "EXEMPT"
    spend = amount < 0
    status = "Recorded" if not spend or (exempt and not has) else ("Receipt On File" if has else "Missing receipt")
    if not spend:
        receipt = ""
    elif exempt and not has:
        receipt = "No receipt expected"
    elif not has:
        receipt = "Missing receipt"
    else:
        receipt = "Needs review" if verdict in CSF_REVIEW_VERDICTS else "Receipt On File"
    vendor = csf_safe(x.get("vendor"), 120)
    kind = text(x.get("type")) or ("Spending" if spend else "Deposit")
    category = csf_safe(x.get("category"), 80)
    description = csf_safe(x.get("description"), 200)
    staff = text(x.get("staff"), 80)
    note = csf_safe(x.get("note"), 240)
    src_key = text(x.get("source")).lower()
    return {"id": x.get("id"), "record": vendor or kind, "date": date,
            "details": " · ".join(p for p in (category, fund, description, "by " + staff if staff else "",
                                              "No receipt: " + note if exempt and not has and note else "") if p),
            "status": status, "amount": amount, "type": kind, "fund": fund, "vendor": vendor, "category": category,
            "description": description, "staff": staff,
            "source": CSF_SOURCE_WORDS.get(src_key) or text(x.get("source")) or "Client Finances", "month": _month_of(date),
            "receipt": {"status": receipt, "name": receipt_name, "file_id": file_id, "verdict": verdict, "note": note},
            "card_last4": csf_last4(x.get("last4"))}


def _other_book_rows(reads: L.Reads, sid: str, tab: str) -> list[dict]:
    """readTabNormalized_ on a book that is not HUB_DB: headers normKey_'d, a Date as estateCell_ makes it."""
    ref = _tab(reads, sid, tab, f"the {tab} tab")
    if ref is None:
        raise RuntimeError("Talent tab missing: " + tab)
    keys = [hubdb.norm_key(h) for h in ref.headers]
    out = []
    for _rn, raw in reads.db.rows(ref):
        vals = [hubdb.typed(raw.get(h), "hub") for h in ref.headers]
        if all(v == "" or v is None for v in vals):
            continue
        o: dict[str, Any] = {}
        for k, v in zip(keys, vals):
            if k:
                o[k] = hubdb.estate_cell(v) if isinstance(v, (SheetDate, hubdb.SheetTime)) else v
        out.append(o)
    return out


def _ledger(reads: L.Reads, c: dict) -> dict[str, Any]:
    """csfLedger_: finance_transactions under this client's name, then TrueLink rows it has not imported."""
    out: dict[str, Any] = {"rows": [], "why": "", "tl_why": ""}
    ft, why = _soft(lambda: hub_rows(reads, "finance_transactions"))
    if ft is None:
        out["why"] = f"the Client Finances ledger (finance_transactions) could not be read ({why})"
        return out
    seen: set[str] = set()
    for r in ft:
        k = gsjs.str_(r.get("legacyRowKey"))
        if k:
            seen.add(k)
        if name_key(r.get("client")) != c["name_key"]:
            continue
        out["rows"].append(csf_txn({"id": gsjs.str_(r.get("id")), "date": r.get("date"), "amount": r.get("amount"),
                                    "type": r.get("type"), "fund": r.get("fundType"), "vendor": r.get("vendor"),
                                    "category": r.get("category"), "description": r.get("description"),
                                    "staff": r.get("staffMember"), "source": r.get("source"),
                                    "receipt_name": r.get("receiptName"), "receipt_file": r.get("receiptFileId"),
                                    "verdict": r.get("receiptVerdict"), "note": r.get("receiptNote"),
                                    "last4": r.get("accountLast4")}))
    tl_id = gsjs.trim(reads.db.prop("FIN_TRUELINK_SHEET_ID"))
    if not tl_id:
        out["tl_why"] = "the TrueLink Reconciliation book is not configured (FIN_TRUELINK_SHEET_ID)"
    else:
        def truelink() -> None:
            for i, r in enumerate(_other_book_rows(reads, tl_id, "Transactions")):
                k = gsjs.str_(r.get("rowkey"))
                if k and k in seen:
                    continue
                if name_key(r.get("cardholdername")) != c["name_key"]:
                    continue
                out["rows"].append(csf_txn({"id": f"tl-{i + 2}", "date": r.get("transactiondate"), "amount": r.get("amount"),
                                            "type": r.get("type"), "fund": r.get("fundtype"), "vendor": r.get("vendor"),
                                            "category": r.get("category"), "description": r.get("description"),
                                            "staff": r.get("staffmember"), "source": r.get("source") or "truelink",
                                            "receipt_name": r.get("receipt"), "receipt_file": "",
                                            "verdict": r.get("receiptai"), "note": r.get("receiptainote"),
                                            "last4": r.get("accountlast4")}))
        _ok, why_t = _soft(truelink)
        if why_t:
            out["tl_why"] = f"the TrueLink Reconciliation book could not be read ({why_t})"
    out["rows"].sort(key=_cmp(lambda a, b: 1 if a["date"] < b["date"] else
                              (-1 if a["date"] > b["date"] else (-1 if gsjs.js_str(a["id"]) < gsjs.js_str(b["id"]) else 1))))
    return out


def _balances_on_file(c: dict, rows: list[dict]) -> dict[str, Any]:
    """csfBalancesOnFile_: the Client Fund Tracking row (on file) and the months Client Finances closed."""
    on_file = None
    closed: dict[str, dict] = {}
    for b in rows:
        ck = gsjs.trim(gsjs.str_(b.get("client_key")))
        mine = ck == c["client_key"] if ck else name_key(b.get("client_name") or b.get("client")) == c["name_key"]
        if not mine:
            continue
        if gsjs.str_(b.get("fundType")) and re.fullmatch(r"\d{4}-\d{2}", gsjs.str_(b.get("month"))):
            if gsjs.str_(b.get("status")) != "Closed":
                continue
            f = gsjs.str_(b.get("fundType"))
            if f not in closed or gsjs.str_(b.get("month")) > closed[f]["month"]:
                closed[f] = {"month": gsjs.str_(b.get("month")), "closing": csf_money(b.get("closing"))}
            continue
        if on_file:
            continue
        on_file = {"total": csf_money(b.get("total")), "house": csf_money(b.get("house")),
                   "office": csf_money(b.get("office")), "as_of": text(b.get("as_of"), 40),
                   "note": csf_safe(b.get("note"), 200), "card_last4": csf_last4(b.get("debit_card"))}
    return {"on_file": on_file, "closed": closed}


def _fund_key(fund: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", gsjs.or_text(fund).lower())


def _balance_rows(c: dict, ledger: list[dict], held: dict, missing: int | None) -> list[dict]:
    funds: dict[str, dict] = {}

    def bucket(f: str) -> dict:
        if f not in funds:
            funds[f] = {"fund": f, "deposits": 0.0, "spending": 0.0, "count": 0, "first": "", "last": "", "missing": 0,
                        "after": 0.0}
        return funds[f]

    for t in ledger:
        f = bucket(t["fund"])
        f["count"] += 1
        if t["amount"] >= 0:
            f["deposits"] += t["amount"]
        else:
            f["spending"] += t["amount"]
        if t["status"] == "Missing receipt":
            f["missing"] += 1
        if t["date"] and (not f["first"] or t["date"] < f["first"]):
            f["first"] = t["date"]
        if t["date"] and t["date"] > f["last"]:
            f["last"] = t["date"]
        cl = held["closed"].get(t["fund"])
        if cl and t["month"] > cl["month"]:
            f["after"] += t["amount"]
    for k in _js_keys(held["closed"]):
        bucket(k)
    rows = []
    of = held["on_file"]
    if of:
        rows.append({"id": "bal-on-file", "record": c["name"], "client": c["name"], "fund": "", "date": "",
                     "personal_balance": of["total"], "missing_receipts": missing, "status": "On file",
                     "as_of": of["as_of"], "source": "Client Finances › balances",
                     "details": " · ".join(x for x in (
                         "House " + csf_money_words(of["house"]) if of["house"] is not None else "",
                         "Office " + csf_money_words(of["office"]) if of["office"] is not None else "",
                         "as of " + of["as_of"] if of["as_of"] else "no as-of date on the row",
                         "card ending " + of["card_last4"] if of["card_last4"] else "", of["note"]) if x),
                     "card_last4": of["card_last4"]})
    for k in sorted(funds):
        f, cl = funds[k], held["closed"].get(k)
        net = _round2(f["deposits"] + f["spending"])
        balance = _round2(cl["closing"] + f["after"]) if cl and cl["closing"] is not None else None
        rows.append({"id": "bal-" + _fund_key(k), "record": c["name"] + " · " + k, "client": c["name"], "fund": k,
                     "date": f["last"], "personal_balance": balance, "missing_receipts": f["missing"],
                     "recorded_net": net, "deposits": _round2(f["deposits"]), "spending": _round2(f["spending"]),
                     "transactions": f["count"],
                     "status": "Closed through " + cl["month"] if balance is not None else "Opening unknown",
                     "source": "Client Finances ledger",
                     "details": (f"Recorded since {f['first']}: deposits {csf_money_words(f['deposits'])}, spending "
                                 f"{csf_money_words(f['spending'])}, net {csf_money_words(net)}" if f["count"]
                                 else "No transaction recorded")
                                + ("" if balance is not None else " — no month is closed, so the opening balance is not known")})
    return rows


def _columns(reads: L.Reads, ref: hubdb.TabRef | str, names: tuple, policy: str) -> list[dict]:
    """csfColumns_: only the named columns, as objects; a column the header lacks reads ''. A house named by its tab
    is read off its own table."""
    if isinstance(ref, str):
        headers, rows = HT.raw(reads, ref)
    else:
        headers, rows = list(ref.headers), reads.db.rows(ref)
    at: dict[str, str] = {}
    for h in headers:
        th = gsjs.trim(h)
        if th in names and th not in at:
            at[th] = h
    out = []
    for _rn, raw in rows:
        out.append({n: gsjs.cell(hubdb._shown(hubdb.typed(raw.get(at[n]), policy))) if n in at else "" for n in names})
    return out


def _funds_docs(reads: L.Reads, c: dict) -> dict[str, Any]:
    """csfFundsDocs_: the client's Funds folder in client_files."""
    ref = "client_files" if HT.tabled("client_files") else _tab_sheet(reads, "client_files")
    rows, why = _soft(lambda: _columns(reads, ref, ("drive_id", "title", "folder", "doc_kind", "digest_category",
                                                    "client_key", "client_name", "file_date", "modified_time"), "hub")
                      if ref is not None else [])
    if rows is None:
        return {"receipts": None, "statements": None, "why": f"the client files could not be read ({why})"}
    receipts, statements = [], []
    for r in rows:
        ck = gsjs.trim(gsjs.or_text(r.get("client_key")))
        mine = ck == c["client_key"] if ck else name_key(r.get("client_name")) == c["name_key"]
        if not mine or not re.match(r"^(funds|receipts)\b", gsjs.trim(gsjs.or_text(r.get("folder"))), re.I):
            continue
        fid = _drive_id_of(r.get("drive_id"))
        if not fid:
            continue
        kind = gsjs.trim(gsjs.or_text(r.get("doc_kind"))).lower()
        title = csf_safe(r.get("title"), 160)
        doc = {"id": "doc-" + fid, "file_id": fid, "record": title,
               "date": csf_day(r.get("file_date")) or csf_day(r.get("modified_time")), "kind": kind,
               "folder": text(r.get("folder"), 60), "source": "Client files › " + text(r.get("folder"), 60)}
        if kind in CSF_RECEIPT_KINDS or _s(r.get("digest_category")) == "receipt_invoice" or \
                re.search(r"\b(receipts?|invoices?|bill)\b", title, re.I):
            receipts.append(doc)
        elif kind in CSF_STATEMENT_KINDS:
            statements.append(doc)

    def newest(a: dict, b: dict) -> int:
        return 1 if a["date"] < b["date"] else (-1 if a["date"] > b["date"] else 0)

    return {"receipts": sorted(receipts, key=_cmp(newest)), "statements": sorted(statements, key=_cmp(newest)), "why": ""}


def _analytics(ledger: list[dict]) -> dict[str, Any]:
    by_cat: dict[str, dict] = {}
    by_month: dict[str, dict] = {}
    by_vendor: dict[str, dict] = {}
    spends = with_receipt = exempt = 0
    for t in ledger:
        m = by_month.setdefault(t["month"], {"month": t["month"], "spent": 0.0, "deposits": 0.0})
        if t["amount"] >= 0:
            m["deposits"] += t["amount"]
            continue
        m["spent"] += -t["amount"]
        spends += 1
        if t["receipt"]["status"] == "No receipt expected":
            exempt += 1
        elif t["receipt"]["status"] != "Missing receipt":
            with_receipt += 1
        cat = t["category"] or "Uncategorized"
        by_cat.setdefault(cat, {"category": cat, "spent": 0.0, "count": 0})
        by_cat[cat]["spent"] += -t["amount"]
        by_cat[cat]["count"] += 1
        vk = re.sub(r"[^a-z0-9]", "", gsjs.or_text(t["vendor"]).lower())
        if vk:
            by_vendor.setdefault(vk, {"vendor": t["vendor"], "spent": 0.0, "count": 0})
            by_vendor[vk]["spent"] += -t["amount"]
            by_vendor[vk]["count"] += 1

    def listed(o: dict) -> list[dict]:
        return [o[k] for k in _js_keys(o)]

    def money(x: dict) -> dict:
        x = dict(x)
        x["spent"] = _round2(x["spent"])
        if "deposits" in x:
            x["deposits"] = _round2(x["deposits"])
        return x

    def by_spent(a: dict, b: dict) -> float:
        d = b["spent"] - a["spent"]
        return -1 if d < 0 else (1 if d > 0 else 0)

    return {"by_category": [money(x) for x in sorted(listed(by_cat), key=_cmp(by_spent))],
            "monthly": [money(x) for x in sorted((m for m in listed(by_month) if m["month"]),
                                                  key=_cmp(lambda a, b: -1 if a["month"] < b["month"] else 1))[-12:]],
            "top_vendors": [money(x) for x in sorted(listed(by_vendor), key=_cmp(by_spent))[:8]],
            "compliance": {"spends": spends, "with_receipt": with_receipt, "exempt": exempt,
                           "missing": spends - with_receipt - exempt}}


def _funds_build(reads: L.Reads, c: dict) -> dict[str, Any]:
    """csfFundsBuild_: Balances, Transactions and Receipts."""
    sources: list[dict] = []
    ledger: list[dict] = []
    if c["shared"]:
        ledger_why = _shared_why(c, "Client Finances keeps its ledger")
    else:
        got = _ledger(reads, c)
        ledger_why, ledger = got["why"], got["rows"]
        sources.append({"name": "Client Finances ledger", "app": "Client Finances", "readable": not got["why"],
                        "why": got["why"], "rows": None if got["why"] else len(ledger)})
        sources.append({"name": "TrueLink Reconciliation", "app": "Client Finances", "readable": not got["tl_why"],
                        "why": got["tl_why"], "rows": None})
    held: dict[str, Any] = {"on_file": None, "closed": {}}
    got_b, why_b = _soft(lambda: _balances_on_file(c, kept_hub_rows(reads, "finance_balances")))
    held_why = "" if got_b is not None else \
        f"the Client Finances balances (finance_balances) could not be read ({why_b})"
    if got_b is not None:
        held = got_b
    sources.append({"name": "Client Finances balances", "app": "Client Finances", "readable": not held_why, "why": held_why,
                    "rows": None if held_why else (1 if held["on_file"] else 0) + len(held["closed"])})
    docs = _funds_docs(reads, c)
    sources.append({"name": "Funds folder", "app": "Clients (Drive) · Invoices", "readable": not docs["why"],
                    "why": docs["why"], "rows": None if docs["why"] else len(docs["receipts"]) + len(docs["statements"])})
    ledger_ok = not ledger_why
    as_of = ledger[0]["date"] if ledger else ""
    txns = ledger
    spends = [t for t in txns if t["amount"] < 0]
    missing = sum(1 for t in txns if t["status"] == "Missing receipt") if ledger_ok else None
    balances = _balance_rows(c, txns, held, missing) if ledger_ok else \
        _balance_rows(c, [], {"on_file": held["on_file"], "closed": {}}, None)
    balance_why = "; ".join(w for w in ("" if ledger_ok else ledger_why, held_why) if w)
    receipt_rows = [{"id": "rc-" + gsjs.js_str(t["id"]), "txn_id": t["id"], "record": t["record"] + " · " + t["fund"],
                     "date": t["date"], "amount": t["amount"], "status": t["receipt"]["status"],
                     "file_id": t["receipt"]["file_id"], "receipt_name": t["receipt"]["name"],
                     "verdict": t["receipt"]["verdict"], "note": t["receipt"]["note"], "source": t["source"],
                     "details": " · ".join(x for x in (t["receipt"]["name"], t["receipt"]["verdict"]
                                                       if t["receipt"]["verdict"] and t["receipt"]["verdict"] != "NONE"
                                                       else "", t["receipt"]["note"]) if x)} for t in spends]
    for d in docs["receipts"] or []:
        receipt_rows.append({"id": d["id"], "txn_id": "", "record": d["record"], "date": d["date"], "amount": None,
                             "status": "Filed", "file_id": d["file_id"], "receipt_name": d["record"], "verdict": "",
                             "note": "", "source": d["source"],
                             "details": " · ".join([d["kind"].replace("_", " ") if d["kind"] else "document", d["source"]])})
    receipt_rows.sort(key=_cmp(lambda a, b: 1 if a["date"] < b["date"] else (-1 if a["date"] > b["date"] else 0)))
    receipt_why = "; ".join(w for w in ("" if ledger_ok else ledger_why, docs["why"]) if w)

    def count(rows: list, status: str) -> int:
        return sum(1 for r in rows if r["status"] == status)

    of = held["on_file"]
    kpis: dict[str, Any] = {"personal_balance": None, "personal_balance_basis": "", "personal_balance_as_of": "",
                            "personal_balance_why": "", "missing_receipts": missing,
                            "transactions": len(txns) if ledger_ok else None}
    fund_rows = [b for b in balances if b["fund"]]
    if of and of["total"] is not None:
        kpis["personal_balance"], kpis["personal_balance_basis"], kpis["personal_balance_as_of"] = \
            of["total"], "on_file", of["as_of"]
    elif ledger_ok and fund_rows and all(b["personal_balance"] is not None for b in fund_rows):
        total = 0.0
        for b in fund_rows:
            total += b["personal_balance"]
        kpis["personal_balance"], kpis["personal_balance_basis"], kpis["personal_balance_as_of"] = \
            _round2(total), "closed_months", as_of
    else:
        kpis["personal_balance_why"] = held_why or (
            f"no balance is on file for {c['name']} and no month is closed in Client Finances, so the ledger has no "
            "opening balance" if ledger_ok else ledger_why)
    spent = 0.0
    for t in spends:
        spent -= t["amount"]
    deposits = 0.0
    for t in txns:
        deposits += t["amount"] if t["amount"] > 0 else 0
    tabs: dict[str, Any] = {
        "balances": {"rows": balances, "kpis": {"funds": len(fund_rows), "on_file": 1 if of else 0},
                     "as_of": of["as_of"] if of and of["as_of"] else as_of},
        "transactions": {"rows": txns, "statuses": list(CSF_TXN_STATUSES), "as_of": as_of,
                         "kpis": {"count": len(txns), "missing": missing, "spent": _round2(spent),
                                  "deposits": _round2(deposits), "first_date": txns[-1]["date"] if txns else "",
                                  "last_date": as_of} if ledger_ok else {}},
        "receipts": {"rows": receipt_rows, "statuses": list(CSF_RECEIPT_STATUSES), "as_of": as_of,
                     "kpis": {"on_file": count(receipt_rows, "Receipt On File"), "review": count(receipt_rows, "Needs review"),
                              "missing": count(receipt_rows, "Missing receipt"),
                              "exempt": count(receipt_rows, "No receipt expected"), "filed": count(receipt_rows, "Filed")}}}
    if balance_why:
        tabs["balances"]["why"] = balance_why
    if not ledger_ok:
        tabs["transactions"]["why"] = ledger_why
    if receipt_why:
        tabs["receipts"]["why"] = receipt_why
    documents: dict[str, Any] = {"rows": [{"id": d["id"], "file_id": d["file_id"], "record": d["record"], "date": d["date"],
                                           "status": "Filed", "source": d["source"],
                                           "details": (d["kind"].replace("_", " ") if d["kind"] else "document")
                                           + " · " + d["source"]} for d in docs["statements"] or []]}
    if docs["why"]:
        documents["why"] = docs["why"]
    return {"client": _who(c), "as_of": as_of, "kpis": kpis, "tabs": tabs, "documents": documents,
            "analytics": _analytics(txns) if ledger_ok else None, "sources": sources,
            "degraded": any(not s["readable"] for s in sources)}


def _units(reads: L.Reads, c: dict) -> dict[str, Any]:
    """csfUnits_: PSI punches naming this client, as units (a quarter hour each) per day, and the first day covered."""
    if c["shared"]:
        return {"days": None, "first": "", "punches": 0, "shared": True,
                "why": _shared_why(c, "the PSI punches record their consumers")}
    if not reads.db.house_moved(PSI_PUNCHES_FULL_TAB):
        return {"days": None, "first": "", "punches": 0, "why": "the PSI punch house is not declared"}
    res = reads.db.resolve(PSI_PUNCHES_FULL_TAB)
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable("asa-hub-db holds no copy of the PSI punch house")
        return {"days": None, "first": "", "punches": 0, "why": "the PSI punch house is not declared"}
    rows, why = _soft(lambda: _columns(reads, res.ref, ("date_iso", "date_service", "hours", "work_code", "consumer_1",
                                                        "consumer_2", "consumer_3"), "raw"))
    if rows is None:
        return {"days": None, "first": "", "punches": 0, "why": f"the PSI punches could not be read ({why})"}
    days: dict[str, float] = {}
    first, punches = "", 0
    for r in rows:
        day = csf_day(r["date_iso"]) or csf_day(r["date_service"])
        if not day:
            continue
        if not first or day < first:
            first = day
        code = gsjs.trim(gsjs.or_text(r["work_code"])).upper()
        if not code or code in CSF_NOT_SERVICE:
            continue
        if not any(name_key(n) == c["name_key"] for n in (r["consumer_1"], r["consumer_2"], r["consumer_3"])):
            continue
        h = _js_number(re.sub(r"[^\d.]", "", gsjs.or_text(r["hours"])))
        if not h > 0:
            continue
        days[day] = days.get(day, 0) + h * 4
        punches += 1
    return {"days": days, "first": first, "punches": punches, "why": ""}


def _units_in(units: dict, start: str, end: str, today: str) -> dict[str, Any]:
    if units.get("days") is None or not units.get("first") or not start:
        return {"used": None, "from": ""}
    stop = end if end and end < today else today
    if stop < units["first"]:
        return {"used": None, "from": ""}
    frm = units["first"] if start < units["first"] else start
    total = 0.0
    for d in _js_keys(units["days"]):
        if frm <= d <= stop:
            total += units["days"][d]
    return {"used": gsjs.js_round(total), "from": frm}


def _auth_row(x: dict, today: str, units: dict) -> dict[str, Any]:
    """csfAuthRow_."""
    sp = x.get("span")
    start, end = (sp["start"], sp["end"]) if sp else ("", "")
    status = csf_span_status(end, today) if end else "Unknown"
    u = {"used": None, "from": ""} if x["kind"] == "isp" else _units_in(units, start, end, today)
    parts = []
    if not sp and x.get("span_text"):
        parts.append("Span as written: " + x["span_text"])
    if x.get("amount_authorized") is not None:
        parts.append("Authorized " + csf_money_words(x["amount_authorized"]))
    if x.get("units_projected") is not None:
        parts.append("Projected " + _num_s(gsjs.js_round(x["units_projected"])) + " units"
                     + (" (" + csf_money_words(x.get("amount_projected")) + ")" if x.get("amount_projected") is not None else "")
                     + (", " + _num_s(x["percent"]) + "% over" if x.get("percent") is not None else ""))
    if x.get("ssa"):
        parts.append("SSA " + x["ssa"])
    if x.get("match") == "near":
        parts.append('Matched "' + x["cell"] + '" by a near spelling')
    if u["from"] and u["from"] != start:
        parts.append("Units used counted from " + u["from"] + ", the first PSI punch on the platform")
    if x.get("notes"):
        parts.append(x["notes"])
    return {"id": x["id"], "record": x["record"], "date": start, "span_start": start, "span_end": end,
            "days_left": csf_days(today, end) if end else None, "units_used": u["used"], "units_used_from": u["from"],
            "units_authorized": x.get("units_authorized"), "amount_authorized": x.get("amount_authorized"),
            "units_projected": x.get("units_projected"), "amount_projected": x.get("amount_projected"),
            "percent": x.get("percent"), "ssa": x.get("ssa") or "", "notes": x.get("notes") or "", "status": status,
            "kind": x["kind"], "source": x["source"], "match": x.get("match") or "exact", "renewal_due": False,
            "details": " · ".join(parts)}


def _hand_rows(reads: L.Reads, sid: str, tab: str, must: tuple) -> list[dict]:
    """csfTab_ / csfHeaderRows_: a hand-kept tab keyed by the first row naming every `must` column."""
    def read() -> list[dict]:
        ref = _tab(reads, sid, tab, f"the {tab} tab")
        if ref is None:
            raise RuntimeError("the book has no " + tab + " tab")
        grid: list[tuple[int, list[str]]] = [(1, [gsjs.trim(h) for h in ref.headers])]
        for rn, raw in reads.db.rows(ref):
            grid.append((rn, [gsjs.cell(hubdb._shown(hubdb.typed(raw.get(h), "hub"))) for h in ref.headers]))
        at = -1
        for i in range(min(len(grid), 20)):
            cells = [gsjs.trim(x) for x in grid[i][1]]
            if all(m in cells for m in must):
                at = i
                break
        if at == -1:
            raise RuntimeError("no header row names " + ", ".join(must))
        head = [gsjs.trim(x) for x in grid[at][1]]
        rows = []
        for rn, line in grid[at + 1:]:
            o: dict[str, Any] = {"_row": rn}
            empty = True
            for h, v in zip(head, line):
                if not h or h in o:
                    continue
                if v:
                    empty = False
                o[h] = v
            if not empty:
                rows.append(o)
        return rows
    return reads.once(f"cs:hand:{sid}:{tab}:{'_'.join(must)}", read)


def _authorizations(reads: L.Reads, c: dict, today: str, units: dict) -> dict[str, Any]:
    """csfAuthorizations_: PAWS spans, the ISP span, units used from PSI."""
    rows: list[dict] = []
    whys: list[str] = []
    sources: list[dict] = []
    paws_whys: list[str] = []
    if c["shared"]:
        paws_whys.append(_shared_why(c, "PAWS Adjustments and Client Database › Sheet6 keep their spans"))
    else:
        paws_id = reads.prop_book(CSF_PAWS_PROP, CSF_PAWS_FALLBACK)

        def paws() -> int:
            n = 0
            for r in _hand_rows(reads, paws_id, CSF_PAWS_TAB, ("Name", "Span")):
                match = name_match(r.get("Name"), c)
                if not match:
                    continue
                n += 1
                rows.append(_auth_row({"id": f"paws-{r['_row']}", "kind": "paws", "record": "PAWS authorization",
                                       "span": csf_span(r.get("Span")), "span_text": text(r.get("Span"), 60),
                                       "units_authorized": csf_number(r.get("Authorized (un)")),
                                       "amount_authorized": csf_money(r.get("Authorized $")),
                                       "units_projected": csf_number(r.get("Projected (un)")),
                                       "amount_projected": csf_money(r.get("Projected $")),
                                       "percent": csf_percent(r.get("%")), "notes": csf_safe(r.get("Notes"), 400),
                                       "match": match, "cell": text(r.get("Name"), 80), "source": "PAWS Adjustments"},
                                      today, units))
            return n

        got, why = _soft(paws)
        if got is None:
            w = f"PAWS Adjustments could not be read ({why})"
            paws_whys.append(w)
            sources.append({"name": "PAWS Adjustments", "app": "Finances › Internal Analysis", "readable": False, "why": w,
                            "rows": None})
        else:
            sources.append({"name": "PAWS Adjustments", "app": "Finances › Internal Analysis", "readable": True, "why": "",
                            "rows": got})
        db_id = reads.prop_book(CSF_CLIENT_DB_PROP, CSF_CLIENT_DB_FALLBACK)

        def spans() -> int:
            m = 0
            for r in _hand_rows(reads, db_id, CSF_SPANS_TAB, ("Client", "Span")):
                if gsjs.trim(gsjs.or_text(r.get("Client"))).lower() == "client":
                    continue
                match = name_match(r.get("Client"), c)
                if not match:
                    continue
                m += 1
                rows.append(_auth_row({"id": f"span-{r['_row']}", "kind": "paws", "record": "PAWS span",
                                       "span": csf_span(r.get("Span")), "span_text": text(r.get("Span"), 60),
                                       "units_authorized": csf_number(r.get("Units")),
                                       "amount_authorized": csf_money(r.get("$")), "units_projected": None,
                                       "amount_projected": None, "percent": None, "ssa": text(r.get("SSA"), 80),
                                       "notes": "", "match": match, "cell": text(r.get("Client"), 80),
                                       "source": "Client Database › Sheet6"}, today, units))
            return m

        got2, why2 = _soft(spans)
        if got2 is None:
            w2 = f"Client Database › Sheet6 could not be read ({why2})"
            paws_whys.append(w2)
            sources.append({"name": "Client Database › Sheet6", "app": "Clients (Asa Client Database)", "readable": False,
                            "why": w2, "rows": None})
        else:
            sources.append({"name": "Client Database › Sheet6", "app": "Clients (Asa Client Database)", "readable": True,
                            "why": "", "rows": got2})
    whys.extend(paws_whys)
    isp = csf_span(c["isp_year"])
    if isp:
        rows.append(_auth_row({"id": "isp", "kind": "isp", "record": "ISP span", "span": isp, "span_text": "",
                               "ssa": c["ssa_name"], "notes": "", "source": "ISP"}, today, units))
    sources.append({"name": "ISP span", "app": "Clients", "readable": True, "rows": 1 if isp else 0,
                    "why": "" if isp else ('the ISP span could not be read from "' + c["isp_year"][:80] + '"'
                                           if c["isp_year"] else "no ISP span is on file")})
    if not units.get("shared"):
        if units["why"]:
            whys.append("units used are unknown: " + units["why"])
        sources.append({"name": "PSI punches", "app": "PSI Punches", "readable": not units["why"], "why": units["why"],
                        "rows": units["punches"] if units["days"] is not None else None, "from": units["first"]})
    latest: dict[str, dict] = {}
    for r in rows:
        if not r["span_end"]:
            continue
        if r["kind"] not in latest or r["span_end"] > latest[r["kind"]]["span_end"]:
            latest[r["kind"]] = r
    due = None
    if not paws_whys:
        due = 0
        for k in latest:
            if latest[k]["status"] in ("Renewal due", "Expired"):
                latest[k]["renewal_due"] = True
                due += 1
    rows.sort(key=_cmp(lambda a, b: 1 if (a["span_end"] or "") < (b["span_end"] or "") else
                       (-1 if (a["span_end"] or "") > (b["span_end"] or "") else 0)))
    return {"rows": rows, "whys": whys, "sources": sources, "renewals_due": due,
            "renewals_due_why": "not counted, because " + "; ".join(paws_whys) if paws_whys else ""}


def mbs_parse(lines: list) -> dict[str, list]:
    """csfMbsParse_: DODD MBS report text as claim lines and EVV lines."""
    claims: list[dict] = []
    evv: list[dict] = []
    cycle, last = "", None
    for raw in lines or []:
        line = _s(raw)
        cy = CSF_MBS_CYCLE.search(line)
        if cy:
            cycle, last = cy.group(1), None
            continue
        m = CSF_MBS_CLAIM.search(line)
        if m:
            rate, units = _js_number(m.group(11)), _js_number(m.group(12))
            last = {"mcd": m.group(4), "cycle": cycle, "billing_date": csf_day(m.group(5)),
                    "service_date": csf_day(m.group(6)), "service_code": m.group(7), "group_size": _js_number(m.group(8)),
                    "staff_size": _js_number(m.group(9)), "county": m.group(10), "unit_rate": rate, "units": units,
                    "amount": _round2(rate * units), "errors": []}
            claims.append(last)
            continue
        er = CSF_MBS_ERROR.search(line)
        if er and last:
            last["errors"].append({"code": er.group(1), "text": text(er.group(2), 160)})
            continue
        if re.match(r"^\s*-{10,}", line):
            last = None
            continue
        ev = CSF_EVV_LINE.search(line)
        if ev:
            evv.append({"mcd": ev.group(1), "cycle": cycle, "service_date": csf_day(ev.group(2)),
                        "units_billed": csf_number(ev.group(3)), "evv_units": csf_number(ev.group(4)),
                        "additional_needed": csf_number(ev.group(5)), "error_code": ev.group(6)})
    return {"claims": claims, "evv": evv}


def _mbs_sheet(reads: L.Reads, sid: str) -> dict[str, list]:
    """csfMbsSheet_: the Billing Errors book's first column, one report line a row."""
    def read() -> dict[str, list]:
        ref = _tab(reads, sid, CSF_MBS_TAB, "the Billing Errors book")
        if ref is None:
            raise RuntimeError("the book has no " + CSF_MBS_TAB + " tab")
        if len(ref.headers) != 1:
            raise Defer("the Billing Errors sheet has more than one column and the copy keeps no column order")
        h = ref.headers[0]
        lines = [h] + [_s(hubdb.typed(raw.get(h), "raw")) for _rn, raw in reads.db.rows(ref)]
        return mbs_parse(lines)
    return reads.once("cs:mbs_sheet:" + sid, read)


def _drive_call(fn: Callable[[], Any]) -> Any:
    """A Drive read: a file Drive says is not there is Apps Script's words too; any other failure is Apps Script's to answer."""
    try:
        return fn()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise RuntimeError("No item with the given ID could be found, or you do not have permission to access it.") from e
        raise Defer(f"Drive answered {e.code}") from e
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError) as e:
        raise Defer(f"Drive did not answer ({type(e).__name__})") from e


def _drive_list(drv: Any, folder_id: str, folders: bool) -> list[dict]:
    """A folder's children as DriveApp iterates them (the trash included)."""
    kind = "=" if folders else "!="
    q = f"'{folder_id}' in parents and mimeType {kind} '{FOLDER_MIME}'"
    out: list[dict] = []
    page = ""
    while True:
        params = {"q": q, "fields": "nextPageToken,files(id,name,modifiedTime)", "pageSize": 1000,
                  "includeItemsFromAllDrives": "true"}
        if page:
            params["pageToken"] = page
        got = drv._get(drv_mod.API, params)
        out.extend(got.get("files") or [])
        page = got.get("nextPageToken") or ""
        if not page:
            return out


def _drive_text(drv: Any, file_id: str) -> str:
    """Blob.getDataAsString(): the file's bytes as UTF-8."""
    q = urllib.parse.urlencode({"alt": "media", "supportsAllDrives": "true"})
    req = urllib.request.Request(f"{drv_mod.API}/{urllib.parse.quote(file_id)}?{q}",
                                 headers={"Authorization": f"Bearer {drv._access()}"})
    with urllib.request.urlopen(req, timeout=20) as res:
        return res.read().decode("utf-8", "replace")


def _mbs_reports(reads: L.Reads) -> dict[str, Any]:
    """csfMbsReports_: Finances › Billing › Billing Errors; at most CSF_MBS_MAX reports parsed."""
    def read() -> dict[str, Any]:
        root = gsjs.trim(reads.db.prop("FIN_DRIVE_ROOT_ID"))
        if not root:
            return {"reports": None, "left": 0, "why": "the Finances folder is not configured (FIN_DRIVE_ROOT_ID)"}
        drv = reads.need_drive()
        _drive_call(lambda: drv.file(root, "id"))
        folder = root
        for i, name in enumerate(CSF_MBS_PATH):
            kids = [k for k in _drive_call(lambda f=folder: _drive_list(drv, f, True)) if str(k.get("name") or "") == name]
            if not kids:
                return {"reports": None, "left": 0, "why": "Finances › " + " › ".join(CSF_MBS_PATH[:i + 1]) + " is not there"}
            if len(kids) > 1:
                raise Defer(f"two folders named {name} sit side by side and DriveApp's pick cannot be told")
            folder = kids[0]["id"]
        out, left = [], 0
        for f in _drive_call(lambda: _drive_list(drv, folder, False)):
            name = str(f.get("name") or "")
            if not re.match(r"^(ERROR_DETAIL|EVV_INFO)_", name, re.I):
                continue
            if len(out) >= CSF_MBS_MAX:
                left += 1
                continue
            fid = str(f["id"])
            stamp = gsjs.date_parse(str(f.get("modifiedTime") or ""))
            modified = gsjs.iso(datetime.fromtimestamp((stamp or 0) / 1000.0, timezone.utc))
            key = (fid, modified)
            with _MBS_LOCK:
                parsed = _MBS_PARSED.get(key)
            if parsed is None:
                body = _drive_call(lambda i=fid: _drive_text(drv, i))
                parsed = mbs_parse(re.split(r"\r?\n", body))
                with _MBS_LOCK:
                    if len(_MBS_PARSED) > 256:
                        _MBS_PARSED.clear()
                    _MBS_PARSED[key] = parsed
            out.append({"id": fid, "name": name, "modified": modified, "parsed": parsed})
        return {"reports": out, "left": left, "why": ""}
    return reads.once("cs:mbs_reports", read)


def _claim_row(x: dict, n: int, source: str) -> dict[str, Any]:
    errors = [{"code": e["code"], "text": e["text"]} for e in x.get("errors") or []]
    return {"id": f"mbs-{n}", "record": x["service_code"] + " · " + (x["cycle"] or "billed " + x["billing_date"]),
            "date": x["service_date"], "amount": x["amount"], "units": x["units"], "unit_rate": x["unit_rate"],
            "cycle": x["cycle"], "billing_date": x["billing_date"], "service_code": x["service_code"],
            "group_size": x["group_size"], "staff_size": x["staff_size"], "errors": errors, "status": "Rejected",
            "source": source, "evv": None, "evv_fix": None,
            "details": " · ".join(f"({e['code']}) {e['text']}" for e in errors) or "Rejected by MBS"}


def _claims(reads: L.Reads, c: dict) -> dict[str, Any]:
    """csfClaims_: the MBS error reports and billing_claims; while `partial` holds a reason the unpaid sum is null."""
    rows: list[dict] = []
    whys: list[str] = []
    partial: list[str] = []
    sources: list[dict] = []
    evv: list[dict] = []
    seen: dict[str, str] = {}
    n = [0]

    def take(items: list, source: str, frm: str) -> None:
        for x in items or []:
            if x["mcd"] != c["medicaid_id"]:
                continue
            key = _join([x["billing_date"], x["service_date"], x["service_code"], x["units"], x["unit_rate"],
                         "+".join(e["code"] for e in x.get("errors") or [])], "|")
            if seen.get(key) and seen[key] != frm:
                continue
            seen[key] = frm
            n[0] += 1
            rows.append(_claim_row(x, n[0], source))

    def miss(w: str) -> None:
        whys.append(w)
        partial.append(w)

    _unwithheld(c["medicaid_raw"], "the Medicaid number the MBS claim lines join on")
    if not c["medicaid_id"]:
        miss(f"the ISP carries no Medicaid number for {c['name']}, so the MBS claim lines cannot be joined")
    else:
        rep, why_r = _soft(lambda: _mbs_reports(reads))
        if rep is None:
            wr = f"the MBS reports in Finances › Billing could not be read ({why_r})"
            miss(wr)
            sources.append({"name": "MBS reports", "app": "Finances › Billing", "readable": False, "why": wr, "rows": None})
        elif rep["reports"] is None:
            miss(rep["why"])
            sources.append({"name": "MBS reports", "app": "Finances › Billing", "readable": False, "why": rep["why"],
                            "rows": None})
        else:
            reports = sorted(rep["reports"], key=_cmp(lambda a, b: 1 if a["modified"] < b["modified"] else -1))
            for r in reports:
                before, evv_before = len(rows), len(evv)
                take(r["parsed"]["claims"], r["name"], "file:" + r["id"])
                evv.extend(e for e in r["parsed"]["evv"] if e["mcd"] == c["medicaid_id"])
                sources.append({"name": r["name"], "app": "Finances › Billing › Billing Errors", "readable": True, "why": "",
                                "rows": len(rows) - before + len(evv) - evv_before, "as_of": r["modified"][:10]})
            if rep["left"]:
                wl = (f"{rep['left']} more MBS report(s) in Finances › Billing › Billing Errors were not read (the read "
                      f"stops at {CSF_MBS_MAX})")
                miss(wl)
                sources.append({"name": "MBS reports", "app": "Finances › Billing", "readable": False, "why": wl,
                                "rows": None})
        mbs_id = reads.prop_book(CSF_MBS_PROP, CSF_MBS_FALLBACK)
        before2 = len(rows)
        sheet, why_s = _soft(lambda: _mbs_sheet(reads, mbs_id))
        if sheet is None:
            ws = f"the Billing Errors book could not be read ({why_s})"
            miss(ws)
            sources.append({"name": "Billing Errors", "app": "Finances › Billing", "readable": False, "why": ws,
                            "rows": None})
        else:
            take(sheet["claims"], "Billing Errors", "sheet:" + mbs_id)
            sources.append({"name": "Billing Errors", "app": "Finances › Billing", "readable": True, "why": "",
                            "rows": len(rows) - before2})
    for e in evv:
        for r in rows:
            if r["date"] == e["service_date"] and (not e["cycle"] or not r["cycle"] or e["cycle"] == r["cycle"]):
                r["evv"] = {"units_billed": e["units_billed"], "evv_units": e["evv_units"],
                            "additional_needed": e["additional_needed"], "error_code": e["error_code"]}
    if c["last_name"] and not c["last_name_shared"]:
        def fixes() -> int:
            k = 0
            for f in _hand_rows(reads, reads.prop_book(CSF_MBS_PROP, CSF_MBS_FALLBACK), CSF_EVV_TAB, ("Client", "Date")):
                if gsjs.trim(gsjs.or_text(f.get("Client"))).lower() != c["last_name"]:
                    continue
                day = csf_day(f.get("Date"))
                k += 1
                for r in rows:
                    if r["date"] != day:
                        continue
                    r["evv_fix"] = {"billed": csf_number(f.get("Billed")), "evv": csf_number(f.get("EVV")),
                                    "additional_needed": csf_number(f.get("Additional Needed")),
                                    "notes": csf_safe(f.get("Notes"), 240)}
                    r["details"] += " · on the EVV Fixes list"
            return k

        got_f, why_f = _soft(fixes)
        if got_f is None:
            sources.append({"name": "EVV Fixes", "app": "Finances › Billing", "readable": False,
                            "why": f"the EVV Fixes tab could not be read ({why_f})", "rows": None})
        else:
            sources.append({"name": "EVV Fixes", "app": "Finances › Billing", "readable": True, "why": "", "rows": got_f})
    import sheet_resources  # noqa: PLC0415 - it imports this module's neighbours
    # the claims Billing & Payers keeps in Postgres once uploaded; else the copy's tab
    kept = sheet_resources.kept_rows(reads, "billing_claims")
    table, why_t = (None, "") if kept is not None else _soft(lambda: _tab_sheet(reads, "billing_claims"))
    table_why = f"billing_claims could not be opened ({why_t})" if why_t else ""
    # the copy holds no tab without a row: a billing_claims it does not hold is read as an empty one
    present = kept is not None or table is not None or (not why_t)
    drafts = None
    shared_why = ""
    if present and c["shared"]:
        shared_why = _shared_why(c, "billing_claims keeps its claims")
        miss(shared_why)
    elif present:
        drafts = 0
        words = {"draft": "Draft", "submitted": "Submitted", "paid": "Paid", "denied": "Denied", "rejected": "Rejected"}
        for r in kept if kept is not None else reads.db.locations_rows(table) if table else []:
            if name_match(r.get("client"), c) != "exact":
                continue
            st = words.get(gsjs.trim(gsjs.or_text(r.get("status"))).lower()) or "Submitted"
            if st == "Draft":
                drafts += 1
            start, end = csf_day(r.get("spanStart")), csf_day(r.get("spanEnd"))
            rows.append({"id": "claim-" + text(r.get("id") or r.get("_row"), 60),
                         "record": "Claim · " + (csf_safe(r.get("payer"), 60) or "payer not named"), "date": start,
                         "amount": csf_money(r.get("amount")), "units": csf_number(r.get("units")), "unit_rate": None,
                         "cycle": "", "billing_date": "", "service_code": "", "errors": [], "status": st,
                         "source": "billing_claims", "evv": None, "evv_fix": None,
                         "details": " · ".join(x for x in (start + " to " + end if start and end else "",
                                                           csf_safe(r.get("payer"), 60)) if x)})
    sources.append({"name": "billing_claims", "app": "Billing & Payers", "readable": present,
                    "why": shared_why if present else (table_why or "no claims table exists yet"),
                    "rows": sum(1 for r in rows if r["source"] == "billing_claims") if drafts is not None else None})
    rows.sort(key=_cmp(lambda a, b: 1 if a["date"] < b["date"] else (-1 if a["date"] > b["date"] else 0)))
    as_of = ""
    for r in rows:
        if r["billing_date"] and r["billing_date"] > as_of:
            as_of = r["billing_date"]
    return {"rows": rows, "whys": whys, "partial": partial, "sources": sources, "drafts": drafts, "as_of": as_of,
            "drafts_why": shared_why if present else
            "no claim is drafted on the platform — the billing_claims table does not exist yet"}


def _billing_build(reads: L.Reads, c: dict) -> dict[str, Any]:
    """csfBillingBuild_: Authorizations and Claims."""
    today = reads.today()
    units = _units(reads, c)
    auth = _authorizations(reads, c, today, units)
    claims = _claims(reads, c)
    unpaid_rows = [r for r in claims["rows"] if r["status"] in ("Rejected", "Submitted", "Denied")]
    whole = not claims["partial"]
    unpaid = None
    if whole:
        total = 0.0
        for r in unpaid_rows:
            total += r["amount"] or 0
        unpaid = _round2(total)
    tabs: dict[str, Any] = {
        "authorizations": {"rows": auth["rows"], "statuses": list(CSF_AUTH_STATUSES), "as_of": today,
                           "kpis": {"renewals_due": auth["renewals_due"], "spans": len(auth["rows"])}},
        "claims": {"rows": claims["rows"], "statuses": list(CSF_CLAIM_STATUSES), "as_of": claims["as_of"],
                   "kpis": {"rejected": sum(1 for r in claims["rows"] if r["status"] == "Rejected") if whole else None,
                            "drafts": claims["drafts"], "unpaid": unpaid}}}
    if auth["whys"]:
        tabs["authorizations"]["why"] = "; ".join(auth["whys"])
    if claims["whys"]:
        tabs["claims"]["why"] = "; ".join(claims["whys"])
    sources = auth["sources"] + claims["sources"]
    return {"client": _who(c), "today": today,
            "kpis": {"renewals_due": auth["renewals_due"], "renewals_due_why": auth["renewals_due_why"],
                     "draft_claims": claims["drafts"], "draft_claims_why": claims["drafts_why"],
                     "unpaid_claims": unpaid,
                     "unpaid_claims_why": "" if whole else "not summed, because " + "; ".join(claims["partial"]),
                     "unpaid_claims_basis": "rejected MBS lines and unpaid claims; no remittance is on the platform"},
            "tabs": tabs, "sources": sources,
            "degraded": any(not s["readable"] and s["name"] not in ("billing_claims", "ISP span") for s in sources)}


def funds_door(reads: L.Reads, payload: dict) -> dict[str, Any]:
    """csfFundsDoor_: past the gate — the door's answer, and the pack's part."""
    c = csf_client(reads, (payload or {}).get("client"))
    if c.get("refused"):
        return c["refused"]
    data, why = _soft(lambda: _funds_build(reads, c))
    if data is None:
        return {"status": 503, "message": f"Client Funds could not be read just now ({why})."}
    return {"status": 200, "data": _finite(data)}


def billing_door(reads: L.Reads, payload: dict) -> dict[str, Any]:
    """csfBillingDoor_: past the gate — the door's answer, and the pack's part."""
    c = csf_client(reads, (payload or {}).get("client"))
    if c.get("refused"):
        return c["refused"]
    data, why = _soft(lambda: _billing_build(reads, c))
    if data is None:
        return {"status": 503, "message": f"Billing could not be read just now ({why})."}
    return {"status": 200, "data": _finite(data)}


def _csf_gate(sess: L.Session, client: Any, office: bool = False) -> bool:
    """csfGate_: the Clients reader for this client; an office read never to a client or a family."""
    import clients as C  # noqa: PLC0415
    user = sess.user
    if not user or user.get("is_service"):
        return False
    reader = C.reader_for(sess, client)
    return bool(reader) and not (office and reader.get("kind") in ("client", "guardian", "ssa"))


def client_source_funds(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientSourceFunds."""
    if not _csf_gate(sess, (payload or {}).get("client")):
        return {"status": 404, "message": "Unknown action."}
    return funds_door(sess.reads, payload)


def client_source_billing(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientSourceBilling: an office read."""
    if not _csf_gate(sess, (payload or {}).get("client"), True):
        return {"status": 404, "message": "Unknown action."}
    return billing_door(sess.reads, payload)


def _file_known(funds: dict, file_id: str) -> bool:
    """csfFileKnown_: a receipt, a funds document or a transaction's receipt of this client."""
    tabs = (funds or {}).get("tabs") or {}

    def in_rows(rows: Any) -> bool:
        return any(r.get("file_id") == file_id for r in rows or [])

    if in_rows((tabs.get("receipts") or {}).get("rows")) or in_rows(((funds or {}).get("documents") or {}).get("rows")):
        return True
    return any((t.get("receipt") or {}).get("file_id") == file_id
               for t in (tabs.get("transactions") or {}).get("rows") or [])


def client_source_finance_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientSourceFinanceFile: one receipt or funds document of the client, as bytes for the platform's viewer."""
    if not _csf_gate(sess, payload.get("client")):
        return {"status": 404, "message": "Unknown action."}
    reads = sess.reads
    c = csf_client(reads, payload.get("client"))
    if c.get("refused"):
        return c["refused"]
    file_id = text(payload.get("id"), 120)
    if not L.is_file_id(file_id):
        return {"status": 400, "message": "id: a Drive file id."}
    funds, why = _soft(lambda: _funds_build(reads, c))
    if funds is None:
        return {"status": 503, "message": f"Client Funds could not be read just now ({why})."}
    if not _file_known(funds, file_id):
        return {"status": 404, "message": "This client's funds name no such document."}
    got = L.doc_file(reads, file_id)
    if got.get("refused"):
        return got["refused"]
    return {"status": 200, "data": {"id": file_id, "name": csf_safe(got["name"], 200), "mime": got["mime"],
                                    "size": got["size"], "exported": got["exported"], "b64": got["b64"]}}


# ---- the pack's parts (cpPackDoors_) and the actions ---------------------------------------------------------------

def _key_of(ctx: Any) -> str:
    return ctx if isinstance(ctx, str) else str((ctx or {}).get("key") or "")


def pack_appointments(reads: L.Reads, ctx: Any) -> dict[str, Any]:
    return appt_door(reads, {"client": _key_of(ctx)})


def pack_transport(reads: L.Reads, ctx: Any) -> dict[str, Any]:
    return transport_door(reads, {"client": _key_of(ctx)})


def pack_transport_own(reads: L.Reads, ctx: Any, parts: dict | None = None) -> dict[str, Any]:
    """cpPackDoors_ transport_own: a client's own cut of the transport part, gathered already or read."""
    got = {"status": 200, "data": parts["transport"]} if parts and parts.get("transport") else pack_transport(reads, ctx)
    return {"status": 200, "data": transport_own(got["data"])} if got.get("status") == 200 and got.get("data") else got


def pack_funds(reads: L.Reads, ctx: Any) -> dict[str, Any]:
    return funds_door(reads, {"client": _key_of(ctx)})


def pack_billing(reads: L.Reads, ctx: Any) -> dict[str, Any]:
    return billing_door(reads, {"client": _key_of(ctx)})


PACK_DOORS: dict[str, Callable[..., dict[str, Any]]] = {
    "appointments": pack_appointments, "transport": pack_transport, "transport_own": pack_transport_own,
    "funds": pack_funds, "billing": pack_billing,
}

ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "clientSourceAppointments": client_source_appointments, "clientSourceTransport": client_source_transport,
    "clientSourceFunds": client_source_funds, "clientSourceBilling": client_source_billing,
    "clientSourceFinanceFile": client_source_finance_file,
}

# HUB_POLICY: the roles each read is declared for, and its typed params
POLICY = {a: {"roles": ROLES, "params": {"client": "string"}} for a in ACTIONS}
POLICY["clientSourceTransport"] = {"roles": ROLES, "params": {"client": "string", "date": "string"}}
POLICY["clientSourceFinanceFile"] = {"roles": ROLES, "params": {"client": "string", "id": "string"}}
