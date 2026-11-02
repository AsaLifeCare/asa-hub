"""Staff's notes, texts, calls, documents and shifts (apps-script/StaffProfiles.gs), the same answers off asa-hub-db."""
from __future__ import annotations

import functools
import json
import logging
import queue
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import staff_views as SV
from gsjs import NY, SheetDate, locale_cmp
from scope import Defer

log = logging.getLogger("asa-hub-app")
_soft = L._soft

SP_TEXT_PAGE = 150
SP_TEXT_CAP = 3000
SP_SHIFT_PAST_DAYS = 180
SP_CLIENT_DAYS = 92
SP_CURRENT_DAYS = 30
SP_GAP_DAYS = 30
SP_DOC_DEPTH = 3
SP_DOC_CAP = 200
SP_WEEKDAYS = ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
WEEK_ORDER = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
NOTES_TAB = "staff_notes"
PERF_NOTES_TAB = "perf_notes"
QUO_MESSAGES_TAB = "quo_messages"
QUO_TRANSCRIPTS_TAB = "quo_transcripts"
COMM_CALLS_TAB = "comm_calls"
COMM_WORK_ITEMS_TAB = "comm_work_items"
HOTLINE_TRANSCRIPTS_TAB = "Transcripts"
HOTLINE_COLS = {"CALL_ID": 0, "EVENT_TS": 2, "PARTICIPANTS": 5, "TEAM": 6}
COMPLIANCE_DOCS_TAB = "cert_uploads"
DOCS_TAB = "candidate_documents"
RECRUIT_TAB = "recruitment_contracts"
IST_CONFIG_TAB = "ist_config"
STAFF_DOCS_TAB = "Responses"
STAFF_DOCS_MAX_PAGES = 4
USER_DOCS_LOOSE_CAP = 500
DEEP_FILES_CAP = 40
DEEP_ROOT_PROPS = ("COMPLIANCE_SHARED_FOLDER_ID", "PENDING_DOCS_FOLDER_ID")
# ProfileDeep.gs PROFILE_DEEP_CACHE_SECONDS and StaffDocs.gs STAFF_DOCS_CACHE_SECONDS: how long Apps Script holds each index
DRIVE_INDEX_TTL_S = 6 * 3600.0
ARCHIVE_TTL_S = 900.0
DRIVE_WORKERS = 8
_HELD: dict[str, tuple[float, Any]] = {}
_HELD_LOCK = threading.Lock()
FOLDER_MIME = "application/vnd.google-apps.folder"
DRIVE_FILES = "https://www.googleapis.com/drive/v3/files"
# HiringMatrix.gs HIRING_TAB_KEY, for the two dissolved tabs these reads open
HIRING_TAB_KEY = {RECRUIT_TAB: "signaturerequestid", DOCS_TAB: "docrowid"}
SCRUB_KEYS = frozenset({"id", "file_id", "doc_id", "call_id", "user_id", "roster_id", "employee_id", "with"})
# Certs.gs CERT_LABELS and IstConfig.gs's shipped ist_cert_labels
CERT_LABELS = {"dodd": "DODD 8-Hour", "cpr": "CPR / First Aid", "med1": "Med Delivery 1", "med2": "Med Delivery 2",
               "med3": "Med Delivery 3", "mais": "MAIS Certification", "money": "Money Management", "mandt": "MANDT"}
CERT_LABELS_SHIPPED = ("dodd=DODD 8-Hour, cpr=CPR / First Aid, med1=Med Delivery 1, med2=Med Delivery 2, "
                       "med3=Med Delivery 3, mais=MAIS Certification, money=Money Management, mandt=MANDT")
IST_CONFIG_ERROR = re.compile(r"^#(ERROR!|REF!|NAME\?|VALUE!|DIV/0!|N/A|NULL!|NUM!)")
# ContactGuard.gs, Comms.gs and Talent.gs: who is never matched to an envelope
CG_TEST_EMAIL_FLOOR = ("asatech*@asalifecare.com", "asatechjk@gmail.com", "silvajhonatanbrito@gmail.com")
COMMS_OPERATOR_TEST_EMAIL = "asatech@asalifecare.com"
SHARED_LINE_DIGITS = ("3307544040", "3309195558", "3309195559")
COPY_MARKER = "[withheld"
# LineDirectory.gs LINE_DIR_NEVER: a person's own number, never a line
LINE_DIR_NEVER = ("3303440430",)
# LineDirectory.gs LINE_ROLE_WORDS (CommCalls.gs COMM_LINE_ROLE_WORDS): each line's declared name
LINE_ROLE_WORDS = {"3307544040": "Manager", "3309195558": "Software Specialist", "3309195559": "Administration",
                   "3309197595": "HR-Administration", "3309197779": "Director", "9377166410": "Director"}
PROVIDER_ID = re.compile(r"PN[A-Za-z0-9]{6,}")
USER_ID = re.compile(r"US[A-Za-z0-9]{6,}")
FILE_ID = re.compile(r"[A-Za-z0-9_-]{10,}")

_JS_S = L._JS_WS
_A = re.A | re.I
_DOC_PAPERS = (
    {"id": "job_app", "title": "Job application", "category": "hiring", "date": "job_app_date", "flag": "flag_job_app",
     "kind": "form", "re": re.compile(r"job[" + _JS_S + r"]*app|application", _A)},
    {"id": "resume", "title": "Resume", "category": "hiring", "kind": "resume",
     "re": re.compile(r"r[eéÉ]sum[eéÉ]|\bcv\b", _A)},
    {"id": "attestation", "title": "Employee attestation", "category": "hiring", "date": "attestation_date",
     "flag": "flag_attestation", "kind": "form", "re": re.compile(r"attestation", _A)},
    {"id": "i9", "title": "Form I-9", "category": "work_authorization", "date": "i9_date", "expires": "i9_type_1_exp",
     "flag": "flag_i9", "kind": "verify", "re": re.compile(r"\bi-?9\b", _A)},
    {"id": "w4", "title": "Form W-4", "category": "tax", "date": "w4_date", "flag": "flag_w4", "kind": "form",
     "re": re.compile(r"\bw-?4\b", _A)},
    {"id": "hipaa", "title": "HIPAA form", "category": "hiring", "date": "hipaa_date", "flag": "flag_hipaa",
     "kind": "form", "re": re.compile(r"hipaa", _A)},
    {"id": "pay_auth", "title": "Pay authorization form", "category": "tax", "date": "pay_auth_date",
     "flag": "flag_pay_auth", "kind": "form",
     "re": re.compile(r"pay[" + _JS_S + r"]*auth|direct[" + _JS_S + r"]*deposit", _A)},
    {"id": "hs_diploma", "title": "HS diploma / GED", "category": "hiring", "flag": "flag_hs_diploma", "kind": "verify",
     "re": re.compile(r"diploma|\bged\b|high[" + _JS_S + r"]*school|\bhs[" + _JS_S + r"]+transcript", _A)},
    {"id": "drivers_license", "title": "Driver's license", "category": "driving", "expires": "license_exp",
     "kind": "record", "driving": True,
     "re": re.compile(r"driver'?s?[" + _JS_S + r"]*licen[sc]e|\boh[" + _JS_S + r"]*id\b|state[" + _JS_S + r"]*id",
                      _A)},
    {"id": "car_insurance", "title": "Car insurance card", "category": "driving", "expires": "insurance_exp",
     "flag": "flag_car_insurance", "kind": "record", "driving": True, "re": re.compile(r"insurance", _A)},
    {"id": "drivers_abstract", "title": "Driver's abstract", "category": "driving", "date": "abstract_latest",
     "flag": "flag_abstract", "kind": "record", "driving": True, "re": re.compile(r"abstract", _A)},
)
_CATEGORY_TITLE = (
    ("work_authorization", re.compile(r"\bi-?9\b|social security|ss card|birth cert|passport|work auth", re.A)),
    ("tax", re.compile(r"\bw-?4\b|pay[" + _JS_S + r"]*auth|direct deposit|tax", re.A)),
    ("driving", re.compile(r"driver|licen[sc]e|insurance|abstract|\boh id\b|state id", re.A)),
    ("background", re.compile(r"bci|fbi|background|rapback|\bsam\b|\boig\b|registry|exclusion", re.A)),
    ("medical", re.compile(r"\btb\b|physical|medical|immuni|vaccin|health", re.A)),
    ("training", re.compile(r"dodd|cpr|first aid|med ?del|mandt|money|training|certificat|\bist\b|mais", re.A)),
    ("hiring", re.compile(r"r[eé]sum[eé]|application|attestation|hipaa|diploma|\bged\b|offer|hire", re.A)),
)
_SSN = re.compile(r"(^|[^0-9])[0-9]{3}[" + _JS_S + r".-][0-9]{2}[" + _JS_S + r".-][0-9]{4}(?=[^0-9]|\Z)")
_NINE = re.compile(r"(^|[^0-9])[0-9]{9}(?=[^0-9]|\Z)")
_PHONE_RUN = re.compile(r"\+?[0-9][0-9" + _JS_S + r"().-]{8,}[0-9]")
_LOCATION_IMAGE = re.compile(r"^https://[A-Za-z0-9.-]+(:\d{1,5})?/hub-lanes/locations/image/([A-Z]{2,4}\d{3,6})/"
                             r"\d{8}T\d{9}Z\.(jpg|png|webp)\Z", re.A)
_ISO_T = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", re.A)
_NUMBER = re.compile(r"-?\d+(\.\d+)?([eE][-+]?\d+)?", re.A)
# a copy read straight from Google before db-sync stored the sheet's text keeps raw values; every other copy is text
DIRECT_STATUS = "direct"
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_JS_DATE = re.compile(r"^[A-Z][a-z]{2} (" + "|".join(_MONTHS) + r") (\d{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) "
                      r"GMT([+-]\d{4})( \([^)]*\))?\Z", re.A)
_DRIVE_FILE_ID = re.compile(r"^[A-Za-z0-9_-]{10,}\Z", re.A)


# ---- pure helpers ---------------------------------------------------------------------------------------------------

def _cmp(fn: Callable[[Any, Any], int]) -> Callable[[Any], Any]:
    return functools.cmp_to_key(fn)


def _newest_first(field: str) -> Callable[[Any], Any]:
    """sort(a.f < b.f ? 1 : a.f > b.f ? -1 : 0)."""
    return _cmp(lambda a, b: 1 if a[field] < b[field] else (-1 if a[field] > b[field] else 0))


def _text(v: Any, max_len: int = 0) -> str:
    """spText_."""
    return gsjs.text(v, max_len)


def _js_slice(s: str, n: int) -> str:
    """String.prototype.slice(0, n), counted in UTF-16 units."""
    units = s.encode("utf-16-le", "surrogatepass")
    if len(units) <= 2 * n:
        return s
    cut = units[:2 * n]
    if 0xD800 <= int.from_bytes(cut[-2:], "little") <= 0xDBFF:
        raise Defer("a text's cut falls inside a character, which only Apps Script's answer can carry")
    return cut.decode("utf-16-le", "surrogatepass")


def _fold(v: Any) -> str:
    """hubNameFold_."""
    return re.sub(r"[^a-z0-9]+", "", gsjs.or_blank(v).lower())


def _js_keys(o: dict) -> list:
    """Object.keys: array-index keys ascending first, then the rest as inserted."""
    idx = [k for k in o if isinstance(k, str) and re.fullmatch(r"0|[1-9][0-9]*", k) and int(k) < 4294967295]
    if not idx:
        return list(o)
    held = set(idx)
    return sorted(idx, key=int) + [k for k in o if k not in held]


def _serial(n: float, zone: str = "") -> SheetDate:
    """A Sheets serial number (days since 30 Dec 1899, the sheet's wall clock) as the Date getValues() hands back."""
    tz = gsjs.zone(zone) if zone else NY
    at = datetime(1899, 12, 30, tzinfo=tz) + timedelta(milliseconds=round(n * 86400000))
    return SheetDate(at.replace(tzinfo=tz))


def _typed(v: Any, direct: bool = False) -> Any:
    """A copy cell as getValues() hands it back: a keeper book's formatted text, or a straight read's raw value."""
    if not direct:
        return hubdb.typed(v, "hub")
    if not isinstance(v, str):
        return "" if v is None else v
    if _NUMBER.fullmatch(v):
        return int(v) if re.fullmatch(r"-?\d+", v) else float(v)
    if v in ("True", "False"):
        return v == "True"
    return v


def _js_text(v: Any, direct: bool = False) -> str:
    """String(cell == null ? '' : cell) of the cell getValues() hands back."""
    return gsjs.or_blank(_typed(v, direct))


def _dated(v: Any, direct: bool = False, zone: str = "") -> Any:
    """A Date column's cell as getValues() hands it back: a straight read's serial, or the copy's wall-clock…"""
    t = _typed(v, direct)
    if direct:
        return _serial(t, zone) if isinstance(t, (int, float)) and not isinstance(t, bool) else t
    if not zone or not isinstance(t, SheetDate):
        return t
    at = gsjs.parse_when(v, zone)
    if at is None:
        at = t.at.astimezone(NY).replace(tzinfo=gsjs.zone(zone))
    return SheetDate(at)


def _instant(v: Any, direct: bool = False, zone: str = "") -> str:
    """spInstant_: a Date as ISO, anything else as trimmed text."""
    if isinstance(v, str) and _ISO_T.match(v):
        return gsjs.trim(v)
    t = _dated(v, direct, zone)
    if isinstance(t, SheetDate):
        return gsjs.iso(t.at)
    return gsjs.trim(gsjs.or_blank(t))


def _day(v: Any, tz: Any = None) -> str:
    """spDay_: a Date on its zone, a US or ISO date at the start; '' otherwise."""
    if isinstance(v, SheetDate):
        local = v.at.astimezone(tz or NY)
        return "" if local.year < 1900 else local.strftime("%Y-%m-%d")
    s = gsjs.trim(gsjs.or_blank(v))
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})\b", s, re.A)
    if m:
        y = int(m.group(3))
        if y < 100:
            y += 2000
        return f"{y}-{('0' + m.group(1))[-2:]}-{('0' + m.group(2))[-2:]}"
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s, re.A)
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else ""


def _clock(v: Any, tz: Any = None) -> str:
    """spTime_: a Date or a time cell as HH:mm; an ISO instant on New York's clock; else the text."""
    if isinstance(v, hubdb.SheetTime):
        return f"{v.h:02d}:{v.m:02d}"
    if isinstance(v, SheetDate):
        return v.at.astimezone(tz or NY).strftime("%H:%M")
    s = gsjs.trim(gsjs.or_blank(v))
    if _ISO_T.match(s):
        t = gsjs.date_parse(s)
        if t is None:
            return ""
        return datetime.fromtimestamp(t / 1000.0, timezone.utc).astimezone(NY).strftime("%H:%M")
    return s[:20]


def _days_between(a: str, b: str) -> int:
    x, y = gsjs.date_parse(f"{a or ''}T12:00:00Z"), gsjs.date_parse(f"{b or ''}T12:00:00Z")
    return 0 if x is None or y is None else int(gsjs.js_round((y - x) / 86400000))


def _weekday(iso_day: str) -> str:
    t = gsjs.date_parse(f"{iso_day or ''}T12:00:00Z")
    if t is None:
        return ""
    d = datetime.fromtimestamp(t / 1000.0, timezone.utc)
    return SP_WEEKDAYS[(d.weekday() + 1) % 7]


def _gaps(days: dict, least: int) -> list[dict]:
    """spGaps_: runs of `least` days or more with no day present between the first and the last one."""
    got = sorted(d for d in _js_keys(days) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d, re.A))
    out = []
    for i in range(1, len(got)):
        if _days_between(got[i - 1], got[i]) - 1 >= (least or SP_GAP_DAYS):
            out.append({"from": gsjs.day_shift(got[i - 1], 1), "to": gsjs.day_shift(got[i], -1)})
    return out


def _digits10(v: Any) -> str:
    """spDigits10_."""
    d = re.sub(r"[^0-9]+", "", gsjs.or_blank(v))
    if len(d) >= 11 and d[0] == "1":
        d = d[1:]
    d = d[-10:]
    return d if len(d) == 10 else ""


def _numbers(v: Any) -> list[str]:
    """spNumbers_: every phone number written in a cell, as last-ten digits."""
    out: list[str] = []
    for m in _PHONE_RUN.findall(gsjs.or_blank(v)):
        d = _digits10(m)
        if d and d not in out:
            out.append(d)
    return out


def _yes_no(v: Any) -> str:
    s = gsjs.trim(gsjs.or_blank(v)).lower()
    if re.fullmatch(r"y|yes|true|x|1", s):
        return "yes"
    if re.fullmatch(r"n|no|false|0", s):
        return "no"
    return ""


def _is_na(v: Any) -> bool:
    return bool(re.fullmatch(r"n/?a|na|none|not applicable|not required|n-a", gsjs.trim(gsjs.or_blank(v)), re.I))


def _flag(v: Any) -> str:
    """spFlag_."""
    s = gsjs.trim(gsjs.or_blank(v))
    if not s:
        return ""
    n = _js_number(s)
    if n is not None:
        return "1" if n >= 1 else ("0.5" if n > 0 else "0")
    return s.lower()


def _js_number(s: str) -> float | None:
    """Number(s) for a trimmed, non-empty text; None for NaN."""
    t = s.strip()
    try:
        if re.fullmatch(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?", t):
            return float(t)
        if re.fullmatch(r"0[xX][0-9a-fA-F]+", t):
            return float(int(t, 16))
        if re.fullmatch(r"0[bB][01]+", t):
            return float(int(t, 2))
        if re.fullmatch(r"0[oO][0-7]+", t):
            return float(int(t, 8))
        if t in ("Infinity", "+Infinity"):
            return float("inf")
        if t == "-Infinity":
            return float("-inf")
    except ValueError:
        return None
    return None


def _scrub(v: Any, key: str | None = None) -> Any:
    """spScrub_: an SSN shape or a bare nine-digit run never leaves."""
    if key and key in SCRUB_KEYS:
        return v
    if isinstance(v, str):
        return _NINE.sub(r"\1[withheld]", _SSN.sub(r"\1[withheld]", v))
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        if isinstance(v, float) and v != v:
            return v
        if isinstance(v, float) and v in (float("inf"), float("-inf")):
            return v
        r = v if isinstance(v, int) else gsjs.js_round(v)
        return None if len(gsjs.num_str(abs(r))) == 9 and r == v else v
    if isinstance(v, list):
        return [_scrub(x) for x in v]
    if isinstance(v, dict):
        return {k: _scrub(x, k) for k, x in v.items()}
    return v


def _obj(v: Any) -> dict | None:
    """A JavaScript object value (truthy even when empty); None for anything else."""
    return v if isinstance(v, dict) else None


def _marked(v: Any) -> bool:
    if isinstance(v, str):
        return COPY_MARKER + ":" in v
    if isinstance(v, list):
        return any(_marked(x) for x in v)
    if isinstance(v, dict):
        return any(_marked(x) for x in v.values())
    return False


def _shown(data: Any) -> Any:
    """An answer showing a cell the copy withholds is Apps Script's to give."""
    if _marked(data):
        raise Defer("the copy withholds a cell this answer shows")
    return data


def _master_sure(ctx: dict, ids: list[str] | tuple) -> None:
    """An answer reading a Master column the copy cannot place is Apps Script's."""
    if ctx.get("master_read") and any(i in (ctx.get("_unsure") or ()) for i in ids):
        raise Defer("this read takes an Employee Database Master column whose scorecard twin the copy folds into one")


def _contacts(ctx: dict) -> dict[str, list[dict]]:
    """spContacts_: every phone and e-mail once — the account's, then People's, then the Master's."""
    phones: list[dict] = []
    emails: list[dict] = []
    seen_p: set[str] = set()
    seen_e: set[str] = set()

    def add_p(label: Any, value: Any) -> None:
        v = _text(value, 40)
        k = _digits10(v) or re.sub(r"[^0-9]", "", v)
        if not v or not k or k in seen_p:
            return
        seen_p.add(k)
        phones.append({"label": _text(label, 24) or "Phone", "value": v})

    def add_e(label: str, value: Any) -> None:
        v = _text(value, 120)
        k = v.lower()
        if not v or "@" not in v or k in seen_e:
            return
        seen_e.add(k)
        emails.append({"label": label, "value": v})

    def field(o: Any, k: str) -> Any:
        return o.get(k) if isinstance(o, dict) else None

    def items(v: Any) -> list:
        return v if isinstance(v, list) else []

    a, p, m = _obj(ctx.get("account")), _obj(ctx.get("people")), _obj(ctx.get("master"))
    if a is not None:
        for x in items(a.get("phones")):
            add_p(field(x, "label"), field(x, "value"))
        add_p("Phone", a.get("phone"))
        add_e("Sign-in", a.get("email"))
        for e in items(a.get("emails")):
            add_e("Email", e)
    if p is not None:
        add_p("Phone", p.get("phone"))
        for x in p.get("phones") if isinstance(p.get("phones"), list) else []:
            add_p("Phone", x)
        add_e("Email", p.get("email"))
        for e in p.get("emails") if isinstance(p.get("emails"), list) else []:
            add_e("Email", e)
    if m is not None:
        add_p("Phone", m.get("phone"))
        add_e("Email", m.get("email"))
    return {"phones": phones, "emails": emails}


# ---- the books ------------------------------------------------------------------------------------------------------

def _tab(reads: L.Reads, tab: str) -> hubdb.TabRef | None:
    """hubTabSheet_: the tab where the router opens it; None while it is unborn. A house kept in its own table is its
    table's reference (house_tables.KeptRef), which _project and the copy's row readers read."""
    if HT.tabled(tab):
        return HT.kept_ref(reads, tab)
    res = reads.db.resolve(tab)
    if res.runtime:
        raise Defer(f"{tab} lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
    return res.ref


def _is_hub_db(reads: L.Reads, sheet_id: str) -> bool:
    return bool(sheet_id) and sheet_id == reads.db.prop("HUB_DB_ID")


def _direct(reads: L.Reads, sheet_id: str) -> bool:
    """A book whose copy was read straight from Google: its cells are raw values, a Date one a serial number."""
    b = reads.db.book(sheet_id)
    return b is not None and b.status == DIRECT_STATUS


def _normalized(reads: L.Reads, ref: hubdb.TabRef | None, hub_db: bool) -> list[dict]:
    """readTabNormalized_: headers normKey_'d; a Date as cellText_ in HUB_DB, as estateCell_ elsewhere."""
    if ref is None:
        return []
    return _normalized_rows(ref.headers, reads.db.rows(ref), hub_db)


def _normalized_rows(headers: Any, rows: Any, hub_db: bool) -> list[dict]:
    """_normalized of (row number, cells) rows under these headers, wherever they were read."""
    if hub_db:
        return hubdb.normalize(headers, rows)
    keys = [hubdb.norm_key(h) for h in headers]
    out = []
    for _rn, raw in rows:
        vals = [_typed(raw.get(h)) for h in headers]
        if all(v == "" or v is None for v in vals):
            continue
        o: dict[str, Any] = {}
        for k, v in zip(keys, vals):
            if not k:
                continue
            if isinstance(v, hubdb.SheetTime):
                v = f"{v.h:02d}:{v.m:02d}"
            elif isinstance(v, SheetDate):
                local = v.at.astimezone(NY)
                v = local.strftime("%H:%M") if local.year < 1900 else gsjs.iso(v.at)
            o[k] = v
        out.append(o)
    return out


def _kept_columns(reads: L.Reads, tab: str, spec: dict[str, tuple]) -> tuple[bool, list[tuple[int, dict]]] | None:
    """_read_columns' answer for a Hub tab an app keeps in Postgres (sheet_resources); None while the copy holds it."""
    import sheet_resources  # noqa: PLC0415 - it imports this module's neighbours
    kept = sheet_resources.kept_rows(reads, tab)
    if kept is None:
        return None
    return False, [(i + 2, {cid: next((r[n] for n in names if n in r), None) for cid, (names, _at) in spec.items()})
                   for i, r in enumerate(kept)]


def _project(reads: L.Reads, ref: hubdb.TabRef, headers: list[str],
             near: tuple[str, list[str], list[str]] | None = None) -> list[tuple[int, dict]]:
    """(sheet row, {header: text}) of a few columns only: a long tab is never held whole for them. near = (how,
    headers, values) narrows the rows in the database to a superset of the ones the caller keeps: "digits" a row whose
    digits in those columns hold one of the ten-digit values, "contains" a row whose cell holds one of the values."""
    if isinstance(ref, HT.KeptRef):
        return HT.project(reads, ref, headers, near)
    own = hubdb.OWN.get()
    # the write's own rows, or a kept edit on the tab, are laid only over the full rows
    if ref.row_count < 0 or any(w.get("sheet_id") == ref.sheet_id and w.get("tab_name") == ref.tab
                                for w in getattr(own, "items", None) or []) \
            or (ref.sheet_id, ref.tab) in (getattr(own, "edits", None) or {}):
        return [(rn, {h: raw.get(h) for h in headers}) for rn, raw in reads.db.rows(ref)]
    got = reads.db.query("select columns from catalog.tabs where sheet_id = %s and tab_name = %s and gone_at is null",
                         (ref.sheet_id, ref.tab))
    cols = got[0][0] if got else []
    cols = cols if isinstance(cols, list) else json.loads(cols or "[]")
    by = {str(h): str(c) for h, c in cols}
    want = [h for h in headers if h in by]
    if any(not re.fullmatch(r"[a-z0-9_]{1,63}", by[h]) for h in want) or \
            not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table):
        raise hubdb.Unreadable(f"the catalog names an unusable column of {ref.tab}")
    reads.db.note_book(ref.sheet_id)
    sel = "".join(f', "{by[h]}"' for h in want)
    where, params = _near(near, by)
    rows = reads.db.query(f'select row_number{sel} from {reads.db.from_sql(ref)}{where} order by row_number',  # noqa: S608
                          params)
    return [(int(r[0]), {h: r[i + 1] for i, h in enumerate(want)}) for r in rows]


def _near(near: tuple[str, list[str], list[str]] | None, by: dict[str, str]) -> tuple[str, tuple | None]:
    """_project's narrowing clause; none (every row) when it cannot be said safely."""
    if not near:
        return "", None
    how, heads, values = near
    cols = [by[h] for h in heads if h in by and re.fullmatch(r"[a-z0-9_]{1,63}", by[h])]
    if not cols or not values:
        return "", None
    if how == "digits" and all(re.fullmatch(r"\d{10}", v, re.A) for v in values):
        hay = " || ' ' || ".join(f"coalesce(\"{c}\", '')" for c in cols)
        return f" where regexp_replace({hay}, '[^0-9]+', '', 'g') ~ %s", ("|".join(values),)
    if how == "contains":
        held = " or ".join(f"strpos(coalesce(\"{c}\", ''), %s) > 0" for c in cols for _v in values)
        return f" where {held}", tuple(v for _c in cols for v in values)
    return "", None


def _read_columns(reads: L.Reads, ref: hubdb.TabRef, spec: dict[str, tuple], near: tuple[str, tuple, list] | None = None
                  ) -> tuple[bool, list[tuple[int, dict]]]:
    """spReadColumns_: named columns, each by its first header present; a missing one reads as blanks. near = (how,
    column ids, values) narrows the rows as _project does."""
    picked: dict[str, str | None] = {}
    for cid, (names, at) in spec.items():
        found = next((n for n in names if n in ref.headers), None)
        if found is None and at is not None and at < len(ref.headers):
            # the sheet's own column at that position answers, and the copy keeps no column order
            raise Defer(f"{ref.tab} has no {names[0]} column and its position in the sheet is not in the copy")
        picked[cid] = found
    narrow = (near[0], [picked[c] for c in near[1] if picked.get(c)], list(near[2])) if near else None
    got = _project(reads, ref, [h for h in picked.values() if h], narrow)
    rows = [(rn, {cid: (raw.get(h) if h else None) for cid, h in picked.items()}) for rn, raw in got]
    return _direct(reads, ref.sheet_id), rows


def _hub(reads: L.Reads, tab: str) -> list[dict]:
    """listRows_ (readAll_): header-keyed, Dates as cellText_, JSON-looking text parsed."""
    def read() -> list[dict]:
        ref = _tab(reads, tab)
        return reads.db.sheetdb_rows(ref)
    return reads.once("spc_hub:" + tab, read)


def _facts(reads: L.Reads, source: str, prefix: bool) -> list[tuple[str, str, str]]:
    """hiringBookTab_(runtime, Facts): (subject, value, source) of the facts naming `source`, in sheet order."""
    rid = reads.db.prop("HUB_APPS_RUNTIME_ID") or hubdb.ESSENCIAL_ID
    ref = reads.tab_of(rid, "Facts", "the depot's Facts")
    if ref is None:
        return []
    if not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table):
        raise hubdb.Unreadable("the catalog names an unusable table for the depot's Facts")
    if prefix:
        got = reads.db.query(f'select row_number, subject_id, value, source from {reads.db.from_sql(ref)}'  # noqa: S608
                             " where left(source, %s) = %s order by row_number", (len(source), source))
    else:
        got = reads.db.query(f'select row_number, subject_id, value, source from {reads.db.from_sql(ref)}'  # noqa: S608
                             " where source = %s order by row_number", (source,))
    direct = _direct(reads, rid)
    return [(gsjs.trim(_js_text(sub, direct)), gsjs.trim(_js_text(val, direct)), gsjs.trim(_js_text(src, direct)))
            for _rn, sub, val, src in got]


def _legacy_rows(reads: L.Reads, tab: str) -> list[dict] | None:
    """hiringLegacyRows_: a dissolved tab rebuilt from the depot's facts; None when it holds none."""
    def read() -> list[dict] | None:
        want = "dissolution:" + tab + "."
        by: dict[str, dict] = {}
        for sub, val, src in _facts(reads, want, True):
            if not src.startswith(want) or not sub:
                continue
            by.setdefault(sub, {})[src[len(want):]] = val
        if not by:
            return None
        key_col = HIRING_TAB_KEY.get(tab, "candidateid")
        rows = []
        for sub, row in by.items():
            if row.get("__deleted", "").lower() == "true":
                continue
            if not row.get(key_col):
                row[key_col] = sub
            rows.append(row)
        return rows
    return reads.once("spc_legacy:" + tab, read)


def _legacy_header(reads: L.Reads, tab: str) -> list[str] | None:
    """hiringLegacyHeader_: the tab's raw header, captured at dissolution."""
    def read() -> list[str] | None:
        for _sub, val, _src in _facts(reads, "schema:" + tab + ".header", False):
            try:
                got = json.loads(val)
            except ValueError:
                return None
            return [gsjs.js_str(h) if h is not None else "null" for h in got] if isinstance(got, list) else None
        return None
    return reads.once("spc_legacy_header:" + tab, read)


def _dissolved(reads: L.Reads, tab: str) -> bool:
    return reads.db.dissolved(tab)


def _runtime_rows(reads: L.Reads, tab: str) -> list[dict]:
    """locationsTabRows_ over runtimeSheetFor_: the dissolved tab's grid, keyed by its raw header."""
    rows = _legacy_rows(reads, tab) or []
    header: list[str] = []
    seen: set[str] = set()
    for h in _legacy_header(reads, tab) or []:
        k = hubdb.norm_key(h)
        if k and k not in seen:
            seen.add(k)
            header.append(h)
    if not header:
        seen.add("candidateid")
        header.append("candidateid")
    for r in rows:
        for k in r:
            if k not in seen:
                seen.add(k)
                header.append(k)
    out = []
    for i, r in enumerate(rows):
        o: dict[str, Any] = {"_row": i + 2}
        empty = True
        for h in header:
            hh = gsjs.trim(h)
            if not hh:
                continue
            v = r.get(hubdb.norm_key(h))
            v = gsjs.trim("" if v is None else str(v))
            if v:
                empty = False
            o[hh] = v
        if not empty:
            out.append(o)
    return out


# ---- notes ----------------------------------------------------------------------------------------------------------

def _perf_notes(reads: L.Reads) -> list[dict]:
    """perfReadSoft_(HUB_DB, perf_notes): readTabNormalized_ where the router keeps it; a missing tab reads as none."""
    res = reads.db.resolve(PERF_NOTES_TAB)
    if res.runtime:
        raise Defer(f"{PERF_NOTES_TAB} lives in the depot's facts")
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {PERF_NOTES_TAB}")
        return []
    return _normalized(reads, res.ref, _is_hub_db(reads, res.sheet_id))


def notes_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spNotesBuild_: the person's staff notes newest first, and the manager notes written before this app."""
    why: list[str] = []
    notes = []
    for r in reads.db.locations_rows(_tab(reads, NOTES_TAB)):
        if gsjs.or_text(r.get("staff_key")) != ctx["key"]:
            continue
        notes.append({"id": gsjs.or_text(r.get("id")), "category": gsjs.or_text(r.get("category")) or "general",
                      "priority": gsjs.or_text(r.get("priority")) or "normal",
                      "details": gsjs.or_text(r.get("details")), "state": gsjs.or_text(r.get("state")) or "open",
                      "by": gsjs.or_text(r.get("by")), "at": gsjs.or_text(r.get("at")),
                      "state_by": gsjs.or_text(r.get("state_by")), "state_at": gsjs.or_text(r.get("state_at"))})
    notes.sort(key=_newest_first("at"))
    earlier: list[dict] = []

    def read_earlier() -> None:
        for r in _perf_notes(reads):
            if gsjs.str_(r.get("category")) != "Manager note" or gsjs.name_key(gsjs.str_(r.get("name"))) != ctx["key"]:
                continue
            earlier.append({"at": gsjs.str_(r.get("createdat")), "by": re.sub(r"^hub:", "", gsjs.str_(r.get("src"))),
                            "details": gsjs.str_(r.get("text"))})

    _ok, why_e = _soft(read_earlier)
    if why_e:
        why.append(f"the earlier manager notes could not be read ({why_e})")
    earlier.sort(key=_newest_first("at"))
    return {"notes": notes, "earlier": earlier, "why": "; ".join(why)}


def notes_door(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spServe_('staffProfileNotes'): the notes part, as the section door answers a whole viewer."""
    if ctx.get("refused"):
        return ctx["refused"]
    data = reads.once("spc_notes:" + ctx["key"], lambda: _shown(_scrub(notes_build(reads, ctx))))
    return {"status": 200, "data": data}


# ---- shifts ---------------------------------------------------------------------------------------------------------

def _calendar_managers(reads: L.Reads) -> dict[str, list[str]] | None:
    """hubCalendarManagers_: folded name → the locations whose current ** rows carry it."""
    def read() -> dict[str, list[str]] | None:
        got = reads.calendar()
        if not got["cal"]:
            return None
        by, _why_m = _soft(lambda: L.managers_by_house(got["cal"]["values"], reads.today()))
        if by is None:
            return None
        out: dict[str, list[str]] = {}
        for loc in _js_keys(by):
            for r in by[loc]["current"]:
                k = _fold(r["name"])
                if not k:
                    continue
                if loc not in out.setdefault(k, []):
                    out[k].append(loc)
        return out
    return reads.once("spc_calendar_managers", read)


def _house_photos(reads: L.Reads) -> dict[str, str]:
    """spHousePhotos_: Image Bank photos titled with a house code, the first one kept."""
    rows, _why_p = _soft(lambda: _hub(reads, "photos"))
    out: dict[str, str] = {}
    for r in rows or []:
        if gsjs.or_text(r.get("hidden")).lower() == "true":
            continue
        code = L.house_code(r.get("title"))
        if code and code not in out and gsjs.or_text(r.get("src")):
            out[code] = gsjs.or_text(r.get("src"))
    return out


def _house_image(v: Any, code: str) -> bool:
    """locationsHouseImage_."""
    m = _LOCATION_IMAGE.match(gsjs.or_text(v))
    return bool(m) and m.group(2) == code


def shifts_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spShiftsBuild_: every house worked with first and last day, the last months day by day, and what is ahead."""
    key = ctx["key"]
    today = reads.today()
    since = gsjs.day_shift(today, -SP_SHIFT_PAST_DAYS)
    lead_since = gsjs.day_shift(today, -SP_CLIENT_DAYS)
    got = reads.calendar()
    psi = reads.punches()
    hm_codes: dict[str, bool] = {}
    for loc in (_calendar_managers(reads) or {}).get(_fold(ctx["name"])) or []:
        c = L.code_of(loc)
        if c:
            hm_codes[c] = True
    houses: dict[str, dict] = {}
    days: dict[str, dict] = {}
    upcoming: list[dict] = []
    consumers: dict[str, bool] = {}
    # each client a punch names, by name key: the first and the last day worked with them
    consumer_days: dict[str, list[str]] = {}
    archive_days: dict[str, bool] = {}
    counts = {"archive": 0, "punches": 0}

    def house(code: str) -> dict:
        if code not in houses:
            houses[code] = {"code": code, "days": {}, "first_day": "", "last_day": "", "hm": bool(hm_codes.get(code)),
                            "lead": False, "upcoming": False}
        return houses[code]

    def mark(code: str, day: str) -> None:
        h = house(code)
        h["days"][day] = True
        if not h["first_day"] or day < h["first_day"]:
            h["first_day"] = day
        if not h["last_day"] or day > h["last_day"]:
            h["last_day"] = day

    cal = got["cal"]
    if cal and cal.get("values"):
        values, tz = cal["values"], cal.get("tz")
        head = [gsjs.trim(gsjs.or_text(h)).lower() for h in (values[0] or [])]
        direct = _direct(reads, reads.db.prop("HOTLINE_CALENDAR_ID"))

        def cell(v: Any, clock: bool) -> Any:
            if direct:
                t = _typed(v, True)
                return _serial(t) if isinstance(t, (int, float)) and not isinstance(t, bool) else t
            return hubdb.typed(v, "estate") if clock else v

        def col(names: tuple, fb: int) -> int:
            for n in names:
                if n in head:
                    return head.index(n)
            if fb != -1:
                raise Defer("the Calendar Archive lacks a column read by position, and the copy keeps no column order")
            return fb

        c_loc, c_name, c_des, c_date = col(("location",), 0), col(("employee",), 1), col(("designation",), 2), \
            col(("date",), 4)
        c_start = col(("start time", "start", "shift start", "time in", "shift"), -1)
        c_end = col(("end time", "end", "shift end", "time out"), -1)
        for line in values[1:]:
            line = line or []

            def at(j: int) -> Any:
                return line[j] if 0 <= j < len(line) else None

            day = L.broadcast_day(cell(at(c_date), False), tz)
            if day:
                archive_days[day] = True
            if gsjs.name_key(at(c_name)) != key or not day:
                continue
            code = L.code_of(at(c_loc))
            if not code:
                continue
            des = gsjs.trim(gsjs.or_text(at(c_des)))
            start = "" if c_start == -1 else _clock(cell(at(c_start), True), tz)
            end = "" if c_end == -1 else _clock(cell(at(c_end), True), tz)
            counts["archive"] += 1
            if day > today:
                house(code)["upcoming"] = True
                upcoming.append({"date": day, "house": code, "start": start, "end": end})
                continue
            mark(code, day)
            if des == "***" and day >= lead_since:
                house(code)["lead"] = True
            if day >= since:
                k1 = day + "|" + code
                e1 = days.get(k1)
                if e1 is None:
                    e1 = days[k1] = {"date": day, "house": code, "start": start, "end": end, "designation": "",
                                     "source": "archive"}
                if des == "**":
                    e1["designation"] = "hm"
                elif des == "***" and not e1["designation"]:
                    e1["designation"] = "lead"
    if psi["rows"]:
        places = L.psi_places(psi["rows"])
        for p in psi["rows"]:
            who = _text(p.get("employee")) or _text(gsjs.or_text(p.get("firstname")) + " " +
                                                    gsjs.or_text(p.get("lastname")))
            if gsjs.name_key(who) != key:
                continue
            code = L.code_of(p.get("house")) or places.get(L.loc_key(p.get("location_name"))) or ""
            day = L.broadcast_day(p.get("date_iso")) or L.broadcast_day(p.get("date_service"))
            if not code or not day or day > today:
                continue
            counts["punches"] += 1
            mark(code, day)
            for c in (p.get("consumer_1"), p.get("consumer_2"), p.get("consumer_3")):
                n = _text(c, 120)
                if n:
                    consumers[n] = True
                    span = consumer_days.setdefault(gsjs.name_key(n), [day, day])
                    span[0], span[1] = min(span[0], day), max(span[1], day)
            if day < since:
                continue
            k2 = day + "|" + code
            start, end = _clock(p.get("start_time")), _clock(p.get("end_time"))
            e2 = days.get(k2)
            if e2 is None:
                days[k2] = {"date": day, "house": code, "start": start, "end": end, "designation": "",
                            "source": "punches"}
                continue
            first_punch = e2["source"] != "punches"
            e2["source"] = "punches"
            if start and (first_punch or not e2["start"] or start < e2["start"]):
                e2["start"] = start
            if end and (first_punch or not e2["end"] or end > e2["end"]):
                e2["end"] = end
    homes: dict[str, dict] = {}
    got_homes, why_h = _soft(reads.homes)
    homes_why = f"the house registry could not be read ({why_h})" if got_homes is None else ""
    for h in got_homes or []:
        homes[h["code"]] = h
    photos = _house_photos(reads)
    recent = gsjs.day_shift(today, -SP_CURRENT_DAYS)
    house_list = []
    for code in _js_keys(houses):
        h, home = houses[code], homes.get(code) or {}
        thumb = home.get("thumbnail_url") or ""
        house_list.append({"code": code, "home_name": home.get("home_name") or "", "address": home.get("address") or "",
                           "photo": (thumb if _house_image(thumb, code) else "") or photos.get(code) or thumb or "",
                           "current": h["upcoming"] or (bool(h["last_day"]) and h["last_day"] >= recent),
                           "days": len(h["days"]), "first_day": h["first_day"], "last_day": h["last_day"],
                           "hm": h["hm"], "lead": h["lead"]})

    def by_house(a: dict, b: dict) -> int:
        if a["current"] != b["current"]:
            return -1 if a["current"] else 1
        if a["last_day"] == b["last_day"]:
            return locale_cmp(a["code"], b["code"])
        return 1 if a["last_day"] < b["last_day"] else -1

    house_list.sort(key=_cmp(by_house))
    upcoming.sort(key=_cmp(lambda a, b: locale_cmp(a["house"], b["house"]) if a["date"] == b["date"]
                           else (-1 if a["date"] < b["date"] else 1)))
    pat: dict[str, dict] = {}
    for u in upcoming:
        k = u["house"] + "|" + u["start"] + "|" + u["end"]
        g = pat.get(k)
        if g is None:
            g = pat[k] = {"house": u["house"], "weekdays": {}, "start": u["start"], "end": u["end"], "from": u["date"],
                          "to": u["date"]}
        g["weekdays"][_weekday(u["date"])] = True
        if u["date"] > g["to"]:
            g["to"] = u["date"]
    patterns = [{"house": g["house"], "weekdays": [d for d in WEEK_ORDER if g["weekdays"].get(d)], "start": g["start"],
                 "end": g["end"], "from": g["from"], "to": g["to"]} for g in (pat[k] for k in _js_keys(pat))]
    patterns.sort(key=_cmp(lambda a, b: -1 if a["from"] < b["from"] else (1 if a["from"] > b["from"] else 0)))
    day_list = [days[k] for k in _js_keys(days)]
    day_list.sort(key=_cmp(lambda a, b: locale_cmp(a["house"], b["house"]) if a["date"] == b["date"]
                           else (1 if a["date"] < b["date"] else -1)))
    why = [w for w in (got["why"], psi["why"], homes_why) if w]
    degraded = not got["cal"] or psi["rows"] is None
    return {
        "shifts": {
            "houses": house_list, "days": day_list, "upcoming": upcoming, "patterns": patterns,
            "sources": {"archive": {"readable": bool(got["cal"]), "why": got["why"] or "", "rows": counts["archive"]},
                        "punches": {"readable": psi["rows"] is not None, "why": psi["why"] or "",
                                    "rows": counts["punches"]}},
            "gaps": _gaps(archive_days, SP_GAP_DAYS), "why": "; ".join(why), "degraded": degraded,
        },
        "consumers": _js_keys(consumers), "consumer_days": consumer_days, "degraded": degraded,
    }


def shifts_door(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spShiftFacts_(ctx).shifts: where they worked, day by day, and what is scheduled ahead."""
    if ctx.get("refused"):
        return ctx["refused"]
    import staff as SP  # noqa: PLC0415 - the two modules lean on each other
    return {"status": 200, "data": _shown(_scrub(SP.shift_facts(reads, ctx)["shifts"]))}


# ---- texts and calls ------------------------------------------------------------------------------------------------

_KEPT: dict[str, tuple[Any, Any]] = {}
_KEPT_LOCK = threading.Lock()
_KEPT_DUE: set[str] = set()
_KEPT_JOBS: queue.Queue = queue.Queue()
_KEPT_WORKER: dict[str, threading.Thread] = {}


def _kept(reads: L.Reads, name: str, stamp: Callable[[L.Reads], Any], build: Callable[[L.Reads], Any]) -> Any:
    """A person-blind answer held across requests until the copy under it is loaded again. While one worker builds it
    anew the held answer still serves, so only a process's first build is waited on."""
    now = stamp(reads)
    with _KEPT_LOCK:
        held = _KEPT.get(name)
        if held is not None:
            if held[0] != now and name not in _KEPT_DUE:
                _KEPT_DUE.add(name)
                _KEPT_JOBS.put((L.Reads(reads.db, reads.drive), name, stamp, build))
                worker = _KEPT_WORKER.get("t")
                if worker is None or not worker.is_alive():
                    _KEPT_WORKER["t"] = threading.Thread(target=_kept_work, name="staff-comms-kept", daemon=True)
                    _KEPT_WORKER["t"].start()
            return held[1]
    value = build(reads)
    with _KEPT_LOCK:
        _KEPT[name] = (now, value)
    return value


def _kept_work() -> None:
    """_kept's one builder: a failed build keeps the held answer and is tried again by the next request."""
    while True:
        reads, name, stamp, build = _KEPT_JOBS.get()
        try:
            now = stamp(reads)
            value = build(reads)
            with _KEPT_LOCK:
                _KEPT[name] = (now, value)
        except Exception as exc:  # noqa: BLE001 - the held answer stays; the next request asks again
            log.warning("staff_comms: %s not built again (%s: %s)", name, type(exc).__name__, str(exc)[:160])
        finally:
            with _KEPT_LOCK:
                _KEPT_DUE.discard(name)


def _line_sources(reads: L.Reads) -> tuple:
    """When each webhook tab was last loaded: the line list is built again only when one of them moved."""
    sid = gsjs.trim(reads.db.prop("QUO_SYNC_SHEET_ID"))
    refs = [_tab(reads, QUO_MESSAGES_TAB), _tab(reads, QUO_TRANSCRIPTS_TAB)]
    refs += [reads.db.tab(sid, t) if sid else None for t in ("Transcripts", "Messages")]
    return tuple(str(r.loaded_at) if r else "" for r in refs)


def _line_directory(reads: L.Reads) -> list[dict]:
    """hubLines_().lines, held across requests until a webhook tab is loaded again."""
    return reads.once("spc_line_directory", lambda: _kept(reads, "lines", _line_sources, _line_directory_build))


def _hub_columns(reads: L.Reads, tab: str, headers: tuple[str, ...]) -> list[dict]:
    """_hub's cells (readAll_'s Dates and JSON) of a few columns only: a long tab is never held whole for them."""
    ref = _tab(reads, tab)
    if ref is None:
        return []
    got = _project(reads, ref, [h for h in headers if h in ref.headers])
    return [{h: hubdb.cell_text(hubdb.typed(v, "hub")) for h, v in raw.items()} for _rn, raw in got]


def _line_directory_build(reads: L.Reads) -> list[dict]:
    """hubLines_().lines from the webhook rows asa-hub-db holds, read as server/hotline_desk.py reads them."""
    def read() -> list[dict]:
        lines: dict[str, dict] = {}
        by_id: dict[str, str] = {}

        def add(number: Any, provider_id: Any = "", team: Any = "", sure: bool = True) -> None:
            d = _digits10(number)
            if not d or d in LINE_DIR_NEVER:
                return
            ln = lines.setdefault(d, {"ids": set(), "users": set(), "sure": False})
            ln["sure"] = ln["sure"] or sure
            pid = gsjs.trim(gsjs.or_blank(provider_id))
            if PROVIDER_ID.fullmatch(pid):
                ln["ids"].add(pid)
                by_id.setdefault(pid, d)
            for u in re.split(r"[,;|/\n]+", gsjs.or_blank(team)):
                if USER_ID.fullmatch(u.strip()):
                    ln["users"].add(u.strip())

        # quo_messages: the provider id of the line, and its number on our side of the text
        for r in _hub_columns(reads, QUO_MESSAGES_TAB, ("direction", "to_number", "from_number", "quo_number",
                                                         "team_members", "user_id")):
            inbound = gsjs.trim(gsjs.or_blank(r.get("direction"))).lower() == "incoming"
            add(r.get("to_number") if inbound else r.get("from_number"), r.get("quo_number"),
                f"{gsjs.or_blank(r.get('team_members'))},{gsjs.or_blank(r.get('user_id'))}")
        # the webhook book: Quo Number is the line's own number
        sid = gsjs.trim(reads.db.prop("QUO_SYNC_SHEET_ID"))
        for tab, team in (("Transcripts", "Team Member(s)"), ("Messages", "Team Member")):
            ref = reads.db.tab(sid, tab) if sid else None
            for _rn, raw in (_project(reads, ref, ["Quo Number", team]) if ref else []):
                # a text row alone never makes a line: a malformed batch put outside numbers in its Quo Number
                add(raw.get("Quo Number"), "", raw.get(team), sure=tab == "Transcripts")
        # quo_transcripts: a line named by its provider id takes the number the texts gave that id
        for r in _hub_columns(reads, QUO_TRANSCRIPTS_TAB, ("quo_number", "team_members")):
            q = gsjs.trim(gsjs.or_blank(r.get("quo_number")))
            add(by_id.get(q, "") if PROVIDER_ID.fullmatch(q) else q, q, r.get("team_members"))
        if not lines:
            raise Defer("no webhook row in asa-hub-db names a company line")
        # a line held by one person: the staff directory names them by the number on their record
        import staff as SP  # noqa: PLC0415 - the two modules lean on each other
        idx, _why = _soft(lambda: SP.roster_index(reads))
        out = []
        for d, ln in sorted(lines.items()):
            if not (ln["sure"] or ln["ids"] or d in LINE_ROLE_WORDS):
                continue
            humans = len(ln["users"])
            role = LINE_ROLE_WORDS.get(d, "")
            held = list(((idx or {}).get("phones") or {}).get(d) or {})
            person = gsjs.trim(gsjs.or_blank(((idx or {}).get("by_key") or {}).get(held[0], [{}])[0].get("name"))) \
                if len(held) == 1 else ""
            shared = humans > 1 or d in SHARED_LINE_DIGITS
            out.append({"digits": d, "e164": "+1" + d, "id": sorted(ln["ids"])[0] if ln["ids"] else "",
                        "name": role or person, "role": role, "role_known": bool(role),
                        "owner": person if not shared else "", "humans": humans or (1 if person else 0),
                        "forward_to": "", "shared": shared})
        return out
    return reads.once("spc_lines", read)


def _line_key(v: Any) -> str:
    """hubLineKey_."""
    return _digits10(v)


def _line_ours(reads: L.Reads, v: Any) -> bool:
    """hubLineOurs_: one of the lines the company holds."""
    k = _line_key(v)
    return bool(k) and any(r.get("digits") == k for r in _line_directory(reads))


def _line_row(reads: L.Reads, v: Any) -> dict | None:
    """hubLineRow_: one line by its digits or by its provider id."""
    raw = gsjs.trim(gsjs.or_blank(v))
    if not raw:
        return None
    k = _line_key(raw)
    for r in _line_directory(reads):
        if k and r.get("digits") == k:
            return r
        if not k and r.get("id") and r.get("id") == raw:
            return r
    return None


def _own_phones(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spOwnPhones_: the person's phones that name them alone."""
    mine: dict[str, bool] = {}
    shared = 0
    if _obj(ctx.get("master")) is not None:
        _master_sure(ctx, ("phone", "email"))
    for p in _contacts(ctx)["phones"]:
        d = _digits10(p["value"])
        if not d or d in mine:
            continue
        others = [k for k in _js_keys(_obj((ctx.get("phones_shared") or {}).get(d)) or {}) if k != ctx["key"]]
        if others or _line_ours(reads, d):
            shared += 1
            continue
        mine[d] = True
    return {"mine": mine, "shared": shared}


def _line_of(reads: L.Reads, line_id: str, quo: str) -> dict[str, str]:
    """spLineOf_."""
    row = (_line_row(reads, quo) if quo else None) or (_line_row(reads, line_id) if line_id else None)
    digits = line_id if re.fullmatch(r"\d{10}", line_id or "", re.A) else ""
    label = (row.get("name") or row.get("e164")) if row else ("+1" + digits if digits else (line_id or "Unknown line"))
    owner = gsjs.or_text(row.get("owner")) if row and not row.get("shared") and row.get("humans") == 1 else ""
    return {"label": gsjs.or_blank(label), "owner": owner}


_TEXT_AT: dict[str, tuple] = {"created": (("message_created",), None), "event": (("event_at",), None),
                              "received": (("received_at",), None)}


def _texts_stamp(reads: L.Reads) -> tuple:
    """When the texts house's copy was last loaded."""
    ref = _tab(reads, QUO_MESSAGES_TAB)
    return (ref.table, str(ref.loaded_at), ref.row_count) if ref else ()


def _texts_days(reads: L.Reads) -> dict[str, bool]:
    """Every day the texts house holds a text on: the same for everyone, so held across requests (_kept)."""
    ref = _tab(reads, QUO_MESSAGES_TAB)
    if ref is None:
        return {}
    direct, rows = _read_columns(reads, ref, _TEXT_AT)
    days: dict[str, bool] = {}
    for _rn, c in rows:
        day = _day(_instant(c["created"], direct) or _instant(c["event"], direct) or _instant(c["received"], direct))
        if day:
            days[day] = True
    return days


def texts_facts(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spTextsFacts_: every text with the person's own numbers, by company line; the texts house's gaps named."""
    own = _own_phones(reads, ctx)
    mine = own["mine"]
    count = len(mine)
    why: list[str] = []
    if own["shared"]:
        why.append(f"{own['shared']} phone number(s) on this record also belong to someone else or to a company line, "
                   "so texts to them are not attributed")
    if not count:
        why.append("no phone number on this record names this person alone")
    ref = _tab(reads, QUO_MESSAGES_TAB)
    if ref is None:
        return {"counterparts": [], "messages": [], "coverage": {"from": "", "to": "", "gaps": []},
                "phones_matched": count, "why": "; ".join(why + ["the texts house could not be opened"]),
                "degraded": True}
    all_days = _kept(reads, "texts_days", _texts_stamp, _texts_days)
    lines: dict[str, dict] = {}
    msgs: list[dict] = []
    spec = dict(_TEXT_AT, **{"id": (("message_id",), None), "dir": (("direction",), None),
                             "from": (("from_number",), None), "to": (("to_number",), None), "body": (("body",), None),
                             "quo": (("quo_number",), None)})
    # only the rows whose numbers hold one of the person's are read; the checks below still decide each one
    direct, rows = _read_columns(reads, ref, spec, ("digits", ("from", "to"), list(mine))) if count else (False, [])
    for rn, c in rows:
        at = _instant(c["created"], direct) or _instant(c["event"], direct) or _instant(c["received"], direct)
        direction = gsjs.trim(gsjs.or_text(_typed(c["dir"], direct))).lower()
        incoming = direction in ("incoming", "inbound")
        side = _numbers(_js_text(c["from"] if incoming else c["to"], direct))
        if not any(d in mine for d in side):
            continue
        quo = gsjs.trim(gsjs.or_text(_typed(c["quo"], direct)))
        line = next((d for d in _numbers(_js_text(c["to"] if incoming else c["from"], direct)) if d not in mine), "") \
            or quo or "unknown"
        lr = lines.get(line)
        if lr is None:
            lr = lines[line] = {"id": line, "quo": quo, "count": 0, "first_at": at, "last_at": at}
        lr["count"] += 1
        if at and (not lr["first_at"] or at < lr["first_at"]):
            lr["first_at"] = at
        if at and (not lr["last_at"] or at > lr["last_at"]):
            lr["last_at"] = at
        msgs.append({"id": gsjs.or_text(_typed(c["id"], direct)) or f"row{rn}", "at": at,
                     "dir": "in" if incoming else "out", "body": _js_slice(_js_text(c["body"], direct), 2000),
                     "line": line})
    msgs.sort(key=_newest_first("at"))
    counterparts = []
    for k in _js_keys(lines):
        lr = lines[k]
        who = _line_of(reads, k, lr["quo"])
        counterparts.append({"id": k, "label": who["label"], "owner": who["owner"], "count": lr["count"],
                             "first_at": lr["first_at"], "last_at": lr["last_at"]})
    counterparts.sort(key=_newest_first("last_at"))
    owners = {x["id"]: x["owner"] for x in counterparts}
    dlist = sorted(_js_keys(all_days))
    return {
        "counterparts": counterparts,
        "messages": [{"id": m["id"], "at": m["at"], "dir": m["dir"], "body": m["body"],
                      "by": ctx["name"] if m["dir"] == "in" else (owners.get(m["line"]) or ""), "line": m["line"]}
                     for m in msgs[:SP_TEXT_CAP]],
        "coverage": {"from": dlist[0] if dlist else "", "to": dlist[-1] if dlist else "",
                     "gaps": _gaps(all_days, SP_GAP_DAYS)},
        "phones_matched": count, "why": "; ".join(why), "degraded": False,
    }


def transcripts_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spTranscriptsBuild_: the person's calls by date and category, metadata only."""
    own = _own_phones(reads, ctx)
    mine = own["mine"]
    why: list[str] = []
    degraded = False
    if own["shared"]:
        why.append(f"{own['shared']} phone number(s) on this record also belong to someone else or to a company line, "
                   "so calls from them are not attributed")
    calls: dict[str, dict] = {}

    def take(cid: str, rec: dict) -> None:
        if not cid:
            return
        c = calls.get(cid)
        if c is None:
            c = calls[cid] = {"call_id": cid, "at": "", "secs": "", "direction": "", "line": "", "turns": "", "kind": "",
                              "categories": []}
        for k, v in rec.items():
            if not c.get(k) and v != "" and v is not None:
                c[k] = v

    def ours(cell: Any, direct: bool) -> bool:
        return any(d in mine for d in _numbers(_js_text(cell, direct)))

    hot_days: dict[str, bool] = {}
    hot_id = gsjs.str_(reads.db.prop("HOTLINE_TRANSCRIPTS_ID"))
    hot = reads.tab_of(hot_id, HOTLINE_TRANSCRIPTS_TAB, "the hotline transcripts") if hot_id else None
    if hot is None:
        why.append("the hotline transcripts book could not be opened")
        degraded = True
    else:
        hd, hot_rows = _read_columns(reads, hot, {
            "id": (("Call ID",), HOTLINE_COLS["CALL_ID"]), "created": (("Transcript Created",), 1),
            "event": (("Event Timestamp",), HOTLINE_COLS["EVENT_TS"]), "secs": (("Duration (sec)",), 3),
            "who": (("Participant(s)",), HOTLINE_COLS["PARTICIPANTS"]),
            "team": (("Team Member(s)",), HOTLINE_COLS["TEAM"]), "dir": (("Direction",), None),
            "turns": (("# Turns",), 8)})
        hz = gsjs.book_zone(hot.sheet_id, reads.db.prop)
        for _rn, h in hot_rows:
            at = _instant(h["event"], hd, hz) or _instant(h["created"], hd, hz)
            day = _day(at)
            if day:
                hot_days[day] = True
            if not ours(h["who"], hd):
                continue
            team = next(iter(_numbers(_js_text(h["team"], hd))), "")
            take(gsjs.trim(gsjs.or_text(_typed(h["id"], hd))),
                 {"at": at, "secs": _js_text(h["secs"], hd), "direction": gsjs.or_text(_typed(h["dir"], hd)).lower(),
                  "line": "+1" + team if team else "", "turns": _js_text(h["turns"], hd)})

    def quo_transcripts() -> None:
        ref = _tab(reads, QUO_TRANSCRIPTS_TAB)
        if ref is None:
            return
        qd, qrows = _read_columns(reads, ref, {
            "id": (("call_id",), None), "created": (("transcript_created",), None), "event": (("event_at",), None),
            "secs": (("duration_s",), None), "dir": (("direction",), None), "turns": (("turns",), None),
            "who": (("participants",), None), "team": (("team_members",), None)})
        for _rn, q in qrows:
            if not ours(q["who"], qd):
                continue
            team = next(iter(_numbers(_js_text(q["team"], qd))), "")
            take(gsjs.trim(gsjs.or_text(_typed(q["id"], qd))),
                 {"at": _instant(q["created"], qd) or _instant(q["event"], qd), "secs": _js_text(q["secs"], qd),
                  "direction": gsjs.or_text(_typed(q["dir"], qd)).lower(), "line": "+1" + team if team else "",
                  "turns": _js_text(q["turns"], qd)})

    _ok, why_q = _soft(quo_transcripts)
    if why_q:
        why.append(f"the transcripts house could not be read ({why_q})")
        degraded = True

    def comm_calls() -> None:
        spec = {"id": (("call_id",), None), "at": (("call_at",), None), "line": (("line",), None),
                "dir": (("direction",), None), "secs": (("duration_sec",), None), "turns": (("turns",), None),
                "person": (("person_key",), None)}
        got = _kept_columns(reads, COMM_CALLS_TAB, spec)
        if got is None:
            ref = _tab(reads, COMM_CALLS_TAB)
            if ref is None:
                return
            got = _read_columns(reads, ref, spec)
        cd, crows = got
        for _rn, k in crows:
            if _fold(_typed(k["person"], cd)) != ctx["key"]:
                continue
            cl = next(iter(_numbers(_js_text(k["line"], cd))), "")
            take(gsjs.trim(gsjs.or_text(_typed(k["id"], cd))),
                 {"at": _instant(k["at"], cd), "secs": _js_text(k["secs"], cd),
                  "direction": gsjs.or_text(_typed(k["dir"], cd)).lower(), "line": "+1" + cl if cl else "",
                  "turns": _js_text(k["turns"], cd)})

    _ok, why_c = _soft(comm_calls)
    if why_c:
        why.append(f"the calls house could not be read ({why_c})")
        degraded = True

    def work_items() -> None:
        if not calls:
            return
        spec = {"id": (("call_id",), None), "type": (("work_type",), None), "cat": (("category",), None)}
        got = _kept_columns(reads, COMM_WORK_ITEMS_TAB, spec)
        if got is None:
            ref = _tab(reads, COMM_WORK_ITEMS_TAB)
            if ref is None:
                return
            got = _read_columns(reads, ref, spec)
        wd, wrows = got
        for _rn, w in wrows:
            call = calls.get(gsjs.trim(gsjs.or_text(_typed(w["id"], wd))))
            if call is None:
                continue
            kind, cat = _text(_typed(w["type"], wd), 40), _text(_typed(w["cat"], wd), 80)
            if kind and not call["kind"]:
                call["kind"] = kind
            if cat and cat not in call["categories"]:
                call["categories"].append(cat)

    _ok, why_w = _soft(work_items)
    if why_w:
        why.append(f"the call work items could not be read ({why_w})")
    out = []
    for cid in _js_keys(calls):
        c = calls[cid]
        if not c["categories"] and c["kind"]:
            c["categories"] = [c["kind"]]
        out.append(c)
    out.sort(key=_newest_first("at"))
    cat_count: dict[str, int] = {}
    for c in out:
        for cat in c["categories"]:
            cat_count[cat] = cat_count.get(cat, 0) + 1
    return {"calls": out, "categories": [{"name": n, "count": cat_count[n]} for n in sorted(_js_keys(cat_count))],
            "gaps": _gaps(hot_days, SP_GAP_DAYS), "why": "; ".join(why), "degraded": degraded}


def _transcripts(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spTranscripts_."""
    return reads.once("spc_transcripts:" + ctx["key"], lambda: _shown(_scrub(transcripts_build(reads, ctx))))


# commCallsTranscriptRead_'s fields, each by the first spelling either inbox gives it
_WORDS: dict[str, tuple[str, ...]] = {
    "id": ("call_id", "Call ID"),
    "at": ("event_timestamp", "Event Timestamp", "transcript_created", "event_at", "received_at", "Received At"),
    "line": ("team_member_s", "Team Member(s)", "team_members"), "direction": ("direction", "Direction"),
    "secs": ("duration_sec", "Duration (sec)", "duration_s"), "full": ("full_transcript", "Full Transcript"),
    "spoken": ("speaker_transcript", "Speaker Transcript")}


def _words_cell(raw: dict, names: tuple[str, ...]) -> str:
    """str_(row.a || row.b || …) over readAll_'s cells: the first one JavaScript holds true."""
    for n in names:
        v = hubdb.typed(raw.get(n), "hub")
        if v is None or v is False or v == "" or (isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0):
            continue
        return gsjs.str_(hubdb.cell_text(v))
    return ""


def transcript_read(reads: L.Reads, call_id: str, user: dict | None) -> dict[str, Any]:
    """commCallsTranscriptRead_: one call's words, the best copy of the two inboxes, the read kept with who asked."""
    hot_id = gsjs.str_(reads.db.prop("HOTLINE_TRANSCRIPTS_ID"))
    refs = [_tab(reads, QUO_TRANSCRIPTS_TAB),
            reads.tab_of(hot_id, HOTLINE_TRANSCRIPTS_TAB, "the hotline transcripts") if hot_id else None]
    best: tuple[dict, str, str, int] | None = None
    for ref in refs:
        if ref is None:
            continue
        heads = [h for names in _WORDS.values() for h in names if h in ref.headers]
        near = ("contains", [h for h in _WORDS["id"] if h in ref.headers], [call_id])
        for _rn, raw in _project(reads, ref, heads, near):
            if _words_cell(raw, _WORDS["id"]) != call_id:
                continue
            full, spoken = _words_cell(raw, _WORDS["full"]), _words_cell(raw, _WORDS["spoken"])
            # the dialogue counts double: the same call can sit in both inboxes, one of them without its turns
            score = len(spoken) * 2 + len(full)
            if best is None or score > best[3]:
                best = (raw, full, spoken, score)
    if best is None:
        return {"status": 404, "message": "no transcript on file for that call"}
    raw, full, spoken, _score = best
    SV.record(user, "comm_calls_transcript_read", call_id)
    return {"status": 200, "data": {
        "call_id": call_id, "at": _words_cell(raw, _WORDS["at"]), "line": _words_cell(raw, _WORDS["line"]),
        "direction": _words_cell(raw, _WORDS["direction"]), "duration_sec": _words_cell(raw, _WORDS["secs"]),
        "full_transcript": full, "speaker_transcript": spoken, "has_words": bool(full or spoken)}}


# ---- documents --------------------------------------------------------------------------------------------------------

def _held(name: str, ttl_s: float, read: Callable[[], Any]) -> Any:
    """A Drive index kept as long as Apps Script's own cache keeps it; a refusal is never kept."""
    with _HELD_LOCK:
        got = _HELD.get(name)
    if got is not None and time.time() - got[0] < ttl_s:
        return got[1]
    value = read()
    with _HELD_LOCK:
        _HELD[name] = (time.time(), value)
    return value


def _together(jobs: list[Callable[[], Any]]) -> list[Any]:
    """Drive round trips at once, answers in order; the first refusal is raised."""
    if len(jobs) <= 1:
        return [j() for j in jobs]
    with ThreadPoolExecutor(max_workers=min(DRIVE_WORKERS, len(jobs))) as pool:
        return list(pool.map(lambda j: j(), jobs))


def _drive_query(drv: Any, q: str, fields: str, what: str) -> list[dict]:
    """Every file a Drive query lists, page after page, through the platform's own credentials."""
    out: list[dict] = []
    page = ""
    while True:
        params = {"q": q, "fields": f"nextPageToken,files({fields})", "pageSize": 1000,
                  "includeItemsFromAllDrives": "true"}
        if page:
            params["pageToken"] = page
        try:
            got = drv._get(DRIVE_FILES, params)
        except Defer:
            raise
        except Exception as exc:  # noqa: BLE001 - Drive not listing it here says nothing of what Apps Script sees
            raise Defer(f"Drive did not list {what} ({type(exc).__name__})") from exc
        out.extend(got.get("files") or [])
        page = got.get("nextPageToken") or ""
        if not page:
            return out


def _drive_list(drv: Any, folder_id: str, folders: bool, what: str, live_only: bool = False) -> list[dict]:
    """A folder's children as DriveApp iterates them; a trashed child DriveApp may count is Apps Script's to read."""
    kind = "=" if folders else "!="
    q = f"'{folder_id}' in parents and mimeType {kind} '{FOLDER_MIME}'" + (" and trashed = false" if live_only else "")
    out = _drive_query(drv, q, "id,name,mimeType,modifiedTime,trashed", what)
    if not live_only and any(f.get("trashed") for f in out):
        raise Defer(f"{what} holds a trashed item, which DriveApp's own listing may count")
    return out


def _drive_trashed(drv: Any, folder_id: str, folders: bool, what: str) -> list[dict]:
    """The trashed children of a folder: DriveApp's iterators may hand them back too."""
    kind = "=" if folders else "!="
    return _drive_query(drv, f"'{folder_id}' in parents and mimeType {kind} '{FOLDER_MIME}' and trashed = true",
                        "id,name", what)


def _drive_day(modified: Any) -> str:
    """spDay_(file.getLastUpdated()): the day on New York's clock."""
    t = gsjs.date_parse(modified)
    if t is None:
        return ""
    return datetime.fromtimestamp(t / 1000.0, timezone.utc).astimezone(NY).strftime("%Y-%m-%d")


def _drive_utc_day(modified: Any) -> str:
    """file.getLastUpdated().toISOString().slice(0, 10)."""
    t = gsjs.date_parse(modified)
    if t is None:
        return ""
    return gsjs.iso(datetime.fromtimestamp(t / 1000.0, timezone.utc))[:10]


def _root_listing(drv: Any, root: str, what: str) -> dict[str, Any] | None:
    """One root's live and trashed subfolders; None when the root is no folder."""
    try:
        meta = drv.file(root, "id,mimeType,trashed")
    except Defer:
        raise
    except Exception as exc:  # noqa: BLE001 - a root this account cannot open says nothing of asatech's
        raise Defer(f"Drive did not open {what} ({type(exc).__name__})") from exc
    if meta.get("mimeType") != FOLDER_MIME:
        return None
    live, gone = _together([lambda: _drive_list(drv, root, True, what, live_only=True),
                            lambda: _drive_trashed(drv, root, True, what)])
    return {"live": live, "gone": gone}


def _folder_index(drv: Any, roots: list[str], what: str) -> dict[str, Any]:
    """profileDriveIndex_ / userDocsIndex_: the subfolders of the roots by folded name; a name seen twice is ambiguous."""
    def read() -> dict[str, Any]:
        idx: dict[str, Any] = {"folders": {}, "unreadable": [], "trashed": set()}
        for root, got in zip(roots, _together([functools.partial(_root_listing, drv, r, what) for r in roots])):
            if got is None:
                idx["unreadable"].append(root[:12] + "…")
                continue
            for f in got["live"]:
                k = gsjs.name_key(f.get("name"))
                if not k:
                    continue
                if idx["folders"].get(k):
                    idx["folders"][k] = {"ambiguous": True}
                    continue
                idx["folders"][k] = {"name": gsjs.or_blank(f.get("name")), "id": gsjs.or_blank(f.get("id")),
                                     "root": root}
            for f in got["gone"]:
                k = gsjs.name_key(f.get("name"))
                if k:
                    idx["trashed"].add(k)
        return idx
    return _held("index:" + ",".join(roots), DRIVE_INDEX_TTL_S, read)


def _loose(drv: Any, root: str) -> dict[str, list[dict]]:
    """userDocsLooseAll_: the files lying directly in the staff documents room, live and trashed."""
    what = "the staff documents room"
    return _held("loose:" + root, DRIVE_INDEX_TTL_S, lambda: dict(zip(("live", "gone"), _together([
        lambda: _drive_list(drv, root, False, what, live_only=True), lambda: _drive_trashed(drv, root, False, what)]))))


def _hit(idx: dict, key: str) -> dict | None:
    """A folder for this key, never one a trashed namesake could make ambiguous."""
    if key in idx["trashed"]:
        raise Defer("a trashed folder carries this person's name, and DriveApp's own index may count it")
    return idx["folders"].get(key)


def _name_in(name: Any, title: Any) -> bool:
    """spNameIn_: the name as whole words in a title."""
    words = [w for w in re.split(r"[" + _JS_S + r"]+", gsjs.trim(gsjs.or_blank(name).lower())) if w]
    if not words:
        return False
    body = (r"[" + _JS_S + r"]+").join(re.escape(w) for w in words)
    return bool(re.search(r"(^|[^a-z0-9])" + body + r"(?![a-z0-9])", gsjs.or_blank(title).lower()))


def _tree(drv: Any, root_id: str) -> list[tuple[dict, str]]:
    """spDriveDocs_'s walk: (file, top folder) three levels down, in DriveApp's depth-first order."""
    what = "the staff documents folder"
    listed: dict[str, dict[str, list]] = {}
    level, total = [(root_id, 0)], 0
    while level:
        jobs: list[Callable[[], Any]] = []
        for fid, depth in level:
            jobs.append(functools.partial(_drive_list, drv, fid, False, what))
            if depth < SP_DOC_DEPTH:
                jobs.append(functools.partial(_drive_list, drv, fid, True, what))
        got = iter(_together(jobs))
        nxt = []
        for fid, depth in level:
            files = next(got)
            folders = next(got) if depth < SP_DOC_DEPTH else []
            listed[fid] = {"files": files, "folders": folders}
            total += len(files)
            nxt.extend((gsjs.or_blank(s.get("id")), depth + 1) for s in folders)
        if total > SP_DOC_CAP:
            raise Defer("the staff documents folder holds more files than the read takes, in DriveApp's own order")
        level = nxt
    out: list[tuple[dict, str]] = []

    def walk(fid: str, top: str, depth: int) -> None:
        held = listed.get(fid) or {"files": [], "folders": []}
        out.extend((f, top) for f in held["files"])
        if depth >= SP_DOC_DEPTH:
            return
        for s in held["folders"]:
            walk(gsjs.or_blank(s.get("id")), top or gsjs.or_blank(s.get("name")), depth + 1)

    walk(root_id, "", 0)
    return out


def _drive_docs(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spDriveDocs_: the person's folder in the staff documents room, their loose files there, and the deep folder."""
    out: dict[str, Any] = {"files": [], "why": [], "failed": False}
    drv = reads.need_drive()
    root = gsjs.str_(reads.db.prop("PROFILE_USER_DOCS_ROOT"))
    roots = [r for r in (gsjs.str_(reads.db.prop(p)) for p in DEEP_ROOT_PROPS) if r]
    archive = gsjs.str_(reads.db.prop("COMPLIANCE_SHARED_FOLDER_ID"))
    named = len(ctx["name"]) >= 5
    # the indexes first, all at once: Apps Script keeps each in its cache as long as they are held here
    idx, loose, deep, _arch = _together([
        (lambda: _folder_index(drv, [root], "the staff documents room")) if root else (lambda: None),
        (lambda: _loose(drv, root)) if root and named else (lambda: None),
        lambda: _folder_index(drv, roots, "the compliance folders"),
        (lambda: _archive_index(drv, archive)) if archive else (lambda: None)])
    hit = None
    if idx is None or idx["unreadable"]:
        out["failed"] = True
        out["why"].append("the staff documents room could not be read")
    else:
        hit = _hit(idx, ctx["key"])
        if hit and hit.get("ambiguous"):
            out["why"].append("two folders in the staff documents room carry this name, so neither is read")
            hit = None
    d = _hit(deep, ctx["key"])
    d = d if d and not d.get("ambiguous") else None
    walked, deep_files = _together([
        (lambda: _tree(drv, hit["id"])) if hit else (lambda: []),
        (lambda: _drive_list(drv, d["id"], False, "the compliance folder")) if d else (lambda: [])])
    for f, top in walked:
        out["files"].append({"file_id": gsjs.or_blank(f.get("id")), "title": gsjs.or_blank(f.get("name")),
                             "mime": gsjs.or_blank(f.get("mimeType")), "date": _drive_day(f.get("modifiedTime")),
                             "folder": top, "source": "drive"})
    if loose is not None and idx is not None and not idx["unreadable"]:
        if len(loose["live"]) + len(loose["gone"]) > USER_DOCS_LOOSE_CAP or \
                any(_name_in(ctx["name"], f.get("name")) for f in loose["gone"]):
            raise Defer("the staff documents room's loose files are not all read, or a trashed one names this person")
        for f in loose["live"]:
            if not _name_in(ctx["name"], f.get("name")):
                continue
            out["files"].append({"file_id": gsjs.or_blank(f.get("id")), "title": gsjs.or_blank(f.get("name")),
                                 "mime": gsjs.or_blank(f.get("mimeType")), "date": _drive_utc_day(f.get("modifiedTime")),
                                 "folder": "", "source": "drive"})
    if d:
        if len(deep_files) > DEEP_FILES_CAP:
            raise Defer("the compliance folder holds more files than the read takes, in DriveApp's own order")
        listed = [{"name": gsjs.or_blank(f.get("name")), "id": gsjs.or_blank(f.get("id")),
                   "mime": gsjs.or_blank(f.get("mimeType")), "updated": _drive_utc_day(f.get("modifiedTime"))}
                  for f in deep_files]
        listed.sort(key=_cmp(lambda a, b: 1 if a["updated"] < b["updated"] else -1))
        for f in listed:
            out["files"].append({"file_id": f["id"], "title": f["name"], "mime": f["mime"], "date": _day(f["updated"]),
                                 "folder": "", "source": "drive"})
    return out


def _staff_docs_key(name: Any) -> str:
    """staffDocsKey_: letters only."""
    return re.sub(r"[^a-z]", "", gsjs.or_text(name).lower())


def _staff_docs_day(v: Any) -> str:
    """staffDocsDay_."""
    s = gsjs.str_(v)
    if not s:
        return ""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s, re.A)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s, re.A)
    if m:
        return f"{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"
    return ""


def _staff_docs_parse(filename: Any) -> dict | None:
    """staffDocsParse_: '<name> - <type>[ - yyyymmdd].ext'."""
    base = re.sub(r"\.[a-z0-9]{2,5}\Z", "", gsjs.or_text(filename), flags=re.I | re.A)
    parts = base.split(" - ")
    if len(parts) < 2:
        return None
    name = gsjs.trim(parts[0])
    if re.fullmatch(r"\d{8}", gsjs.trim(parts[-1]), re.A):
        parts.pop()
    kind = gsjs.trim(" - ".join(parts[1:]))
    return {"name": name, "type": kind} if name and kind else None


def _staff_docs_form(reads: L.Reads) -> dict[str, dict]:
    """staffDocsFormIndex_: the documentation form's rows by person; a form that cannot be read names nobody."""
    def read() -> dict[str, dict]:
        sid = gsjs.str_(reads.db.prop("STAFF_DOCS_SHEET_ID"))
        if not sid:
            return {}
        ref = HT.tab_of(reads, sid, STAFF_DOCS_TAB, "the staff documentation form")
        if ref is None:
            return {}
        people: dict[str, dict] = {}
        for r in _normalized(reads, ref, _is_hub_db(reads, sid)):
            k = _staff_docs_key(r.get("yourname"))
            if not k:
                continue
            people.setdefault(k, {"name": gsjs.str_(r.get("yourname")), "rows": []})["rows"].append(r)
        return people
    return reads.once("spc_staff_docs_form", read)


def _archive_index(drv: Any, folder: str) -> dict[str, dict]:
    """staffDocsIndex_: the compliance archive's files named '<person> - <type>', by person."""
    def read() -> dict[str, dict]:
        by: dict[str, dict] = {}
        page, pages = "", 0
        while True:
            params = {"q": f"'{folder}' in parents and trashed=false", "fields": "nextPageToken,files(id,name,modifiedTime)",
                      "pageSize": 1000, "includeItemsFromAllDrives": "true"}
            if page:
                params["pageToken"] = page
            try:
                got = drv._get(DRIVE_FILES, params)
            except Defer:
                raise
            except Exception as exc:  # noqa: BLE001 - Drive not listing it here says nothing of what Apps Script sees
                raise Defer(f"Drive did not list the document archive ({type(exc).__name__})") from exc
            for f in got.get("files") or []:
                p = _staff_docs_parse(f.get("name"))
                if not p:
                    continue
                k = _staff_docs_key(p["name"])
                if not k:
                    continue
                by.setdefault(k, {"name": p["name"], "docs": []})["docs"].append(
                    {"type": p["type"], "fileId": gsjs.or_blank(f.get("id"))})
            page = got.get("nextPageToken") or ""
            pages += 1
            if page and pages >= STAFF_DOCS_MAX_PAGES:
                raise Defer("the document archive holds more files than the read takes, in Drive's own order")
            if not page:
                return by
    return _held("archive:" + folder, ARCHIVE_TTL_S, read)


def _staff_docs_archive(reads: L.Reads) -> dict[str, dict]:
    """staffDocsIndex_ for this request."""
    folder = gsjs.str_(reads.db.prop("COMPLIANCE_SHARED_FOLDER_ID"))
    return _archive_index(reads.need_drive(), folder) if folder else {}


def _staff_docs_for(reads: L.Reads, name: Any) -> dict | None:
    """staffDocsFor_: the form's papers, then the archive's the form never saw."""
    key = _staff_docs_key(name)
    if not key:
        return None
    docs: list[dict] = []
    who = gsjs.str_(name)
    mine = _staff_docs_form(reads).get(key)
    if mine:
        who = mine["name"] or who
        for r in mine["rows"]:
            docs.append({"type": gsjs.str_(r.get("selectdocument")), "from": "form",
                         "link": gsjs.str_(r.get("uploadyourdocumentonedocumentperphoto")),
                         "expires": _staff_docs_day(r.get("dateofexpiration")),
                         "certified": _staff_docs_day(r.get("dateofcertification"))})
    arch = _staff_docs_archive(reads).get(key)
    if arch:
        who = arch["name"] or who
        for d in arch["docs"]:
            if any(gsjs.or_text(x["type"]).lower() == gsjs.or_text(d["type"]).lower() for x in docs):
                continue
            docs.append({"type": d["type"], "from": "archive", "fileId": d["fileId"]})
    return {"name": who, "docs": docs} if docs else None


def _cert_labels(reads: L.Reads) -> dict[str, str]:
    """certLabels_: the course list as ist_cert_labels resolves, else the shipped one."""
    def bits(raw: str) -> list[str]:
        return [gsjs.trim(s) for s in re.split(r"[,;\n]+", raw) if gsjs.trim(s)]

    def pairs_of(raw: str) -> dict | None:
        out: dict[str, str] = {}
        for bit in bits(raw):
            i = bit.find("=")
            if i == -1:
                i = bit.find(":")
            if i <= 0:
                continue
            k = gsjs.trim(bit[:i])
            if k:
                out[k] = gsjs.trim(bit[i + 1:])
        return out or None

    def refused(raw: str) -> bool:
        if not pairs_of(raw):
            return True
        for bit in bits(raw):
            i = bit.find("=")
            if i == -1:
                i = bit.find(":")
            if i <= 0 or not gsjs.trim(bit[i + 1:]):
                return True
        return False

    def read() -> dict[str, str]:
        ref = _tab(reads, IST_CONFIG_TAB)
        raw = ""
        for r in reads.db.sheetdb_rows(ref):
            if gsjs.trim(gsjs.or_text(r.get("key"))) == "ist_cert_labels":
                raw = gsjs.or_blank(r.get("value"))
        if IST_CONFIG_ERROR.match(gsjs.trim(raw)):
            raw = ""
        s = gsjs.trim(raw)
        if not s:
            value = CERT_LABELS_SHIPPED
        elif not refused(s):
            value = s
        else:
            kept = [b for b in bits(s) if not refused(b)]
            value = ", ".join(kept) if kept else CERT_LABELS_SHIPPED
        got = pairs_of(value) or pairs_of(CERT_LABELS_SHIPPED) or {}
        return got if got else dict(CERT_LABELS)
    return reads.once("spc_cert_labels", read)


def _cert_label(reads: L.Reads, k: str) -> str:
    """certLabel_."""
    return _cert_labels(reads).get(k) or CERT_LABELS.get(k) or k


def _uploads(reads: L.Reads) -> list[dict] | None:
    """complianceDocsRows_: None when the ledger cannot be read, [] while its tab is unborn."""
    if HT.tabled(COMPLIANCE_DOCS_TAB):
        return _normalized_rows(*HT.raw(reads, COMPLIANCE_DOCS_TAB), True)
    res = reads.db.resolve(COMPLIANCE_DOCS_TAB)
    if res.runtime:
        raise Defer(f"{COMPLIANCE_DOCS_TAB} lives in the depot's facts")
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {COMPLIANCE_DOCS_TAB}")
        return []
    return _normalized(reads, res.ref, _is_hub_db(reads, res.sheet_id))


def _upload_out(r: dict) -> dict[str, Any]:
    """complianceDocsOut_, the fields this read takes."""
    def day(v: Any) -> str:
        m = re.match(r"^(\d{4}-\d{2}-\d{2})", gsjs.str_(v), re.A)
        return m.group(1) if m else ""

    own = gsjs.str_(r.get("fileid") or r.get("file_id"))
    if not own:
        m = re.search(r"/file/d/([A-Za-z0-9_-]{10,})", gsjs.str_(r.get("url")), re.A)
        own = m.group(1) if m else ""
    return {"cert": gsjs.str_(r.get("cert")), "name": gsjs.str_(r.get("name")), "at": gsjs.str_(r.get("at")),
            "file_id": own, "req_id": gsjs.str_(r.get("reqid")), "issued_on": day(r.get("issuedon")),
            "expires_on": day(r.get("expireson")), "confirmed_at": gsjs.str_(r.get("confirmedat"))}


def _hiring_docs(reads: L.Reads, candidate_id: str) -> list[dict]:
    """spHiringDocs_: the documents filed for the person during hiring, the latest of each."""
    if not candidate_id:
        return []
    if _dissolved(reads, DOCS_TAB):
        rows = _runtime_rows(reads, DOCS_TAB)
    else:
        rows = reads.db.locations_rows(_tab(reads, DOCS_TAB))
    latest: dict[str, dict] = {}
    for r in rows:
        if gsjs.or_text(r.get("candidate_id")) != candidate_id or gsjs.or_text(r.get("superseded_by")):
            continue
        latest[gsjs.or_text(r.get("doc_id") or r.get("doc_row_id"))] = r
    out = []
    for k in _js_keys(latest):
        r = latest[k]
        fid = gsjs.or_text(r.get("file_id")) or L.drive_id(r.get("file_url"))
        if not fid:
            continue
        out.append({"file_id": fid, "title": _text(r.get("doc_label") or r.get("file_name") or r.get("doc_id")),
                    "mime": gsjs.or_text(r.get("mime_type")),
                    "date": _day(r.get("issued_on")) or _day(r.get("uploaded_at")), "expires": _day(r.get("expires_on")),
                    "folder": "", "source": "hiring", "confirmed": gsjs.or_text(r.get("status")).lower() == "verified"})
    return out


def _email_keys(v: Any) -> list[str]:
    """contactEmailKeys_: an address and its Gmail canonical alias."""
    e = gsjs.trim(gsjs.or_blank(v)).lower()
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


def _test_email(reads: L.Reads, k: str) -> bool:
    """cgTestEmails_: an exempt test address, a trailing wildcard allowed."""
    k = (k or "").lower()
    if not k:
        return False
    pats = [COMMS_OPERATOR_TEST_EMAIL, *CG_TEST_EMAIL_FLOOR]
    for raw in re.split(r"[,;\n]+", gsjs.or_text(reads.config().get("staff_guard_test_emails"))):
        v = gsjs.trim(raw).lower()
        if v:
            pats.append(v)
    for p in pats:
        if not p:
            continue
        if "*" not in p:
            if p == k:
                return True
            continue
        if re.match("^" + ".*".join(re.escape(s) for s in p.split("*")) + r"\Z", k):
            return True
    return False


def _packet_rows(reads: L.Reads) -> list[dict]:
    """packetMirrorRows_: every Dropbox Sign envelope; [] when it cannot be read."""
    def read() -> list[dict]:
        if _dissolved(reads, RECRUIT_TAB):
            rows = _legacy_rows(reads, RECRUIT_TAB)
            if rows is not None:
                return rows
            hub = reads.db.prop("HUB_DB_ID")
            return reads.db.normalized_rows(reads.tab_of(hub, RECRUIT_TAB, "the envelopes")) if hub else []
        res = reads.db.resolve(RECRUIT_TAB)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {RECRUIT_TAB}")
            return []
        return reads.db.normalized_rows(res.ref)
    return reads.once("spc_packet_rows", read)


def _withheld(v: Any) -> bool:
    return isinstance(v, str) and v.startswith(COPY_MARKER)


def _envelope(reads: L.Reads, who: dict) -> dict | None:
    """applicationFor_(who, packetMirrorRows_(), null): the envelope the person signed, matched by e-mail then phone."""
    rows = _packet_rows(reads)
    if not rows:
        return None
    email_keys = {k for k in _email_keys(gsjs.str_(who.get("email"))) if not _test_email(reads, k)}
    phone_key = _digits10(gsjs.str_(who.get("phone")))
    if phone_key in SHARED_LINE_DIGITS:
        phone_key = ""
    hits = []
    for r in rows:
        if any(_withheld(r.get(f)) for f in ("email", "signeremails", "phone", "status", "signaturerequestid")):
            raise Defer("the copy withholds an envelope's contact or status")
        by = ""
        if email_keys:
            for addr in [gsjs.str_(r.get("email"))] + gsjs.or_text(r.get("signeremails")).split("|"):
                if any(k in email_keys for k in _email_keys(addr)):
                    by = "email"
                    break
        if not by and phone_key and _digits10(r.get("phone")) == phone_key and \
                gsjs.or_text(r.get("status")).lower() == "signed":
            by = "phone"
        if by:
            hits.append(r)
    if not hits:
        return None
    rank = {"signed": 3, "pending": 2, "declined": 1}
    top = max(rank.get(gsjs.or_text(r.get("status")).lower(), 0) for r in hits)

    def outcome(r: dict) -> tuple | None:
        srid = gsjs.str_(r.get("signaturerequestid"))
        hit = next((x for x in rows if gsjs.str_(x.get("signaturerequestid")) == srid), None) if srid else None
        return None if hit is None else (gsjs.str_(hit.get("status")), gsjs.or_blank(hit.get("signed")))

    seen = {outcome(r) for r in hits if rank.get(gsjs.or_text(r.get("status")).lower(), 0) == top}
    if len(seen) > 1:
        # a tie goes to the latest `applied` as String() of the cell reads, which the copy cannot vouch for
        raise Defer("two envelopes tie for this person and their order rests on how the sheet holds a date")
    got = next(iter(seen))
    return None if got is None else {"status": got[0], "signed_raw": got[1]}


def _iso_day_of(raw: Any) -> str:
    """talentIsoDay_ for the shapes the copy can vouch for; anything else is Apps Script's to parse."""
    if raw is None:
        return ""
    s = gsjs.trim(gsjs.or_blank(raw))
    if not s:
        return ""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s, re.A):
        return s
    t = gsjs.date_parse(s) if _ISO_T.match(s) and re.search(r"(Z|[+-]\d{2}:?\d{2})\Z", s) else None
    m = _JS_DATE.match(s)
    if t is None and m:
        # String() of a Date cell: "Mon Dec 08 2025 00:00:00 GMT-0500 (Eastern Standard Time)"
        off = int(m.group(7)[1:3]) * 60 + int(m.group(7)[3:5])
        at = datetime(int(m.group(3)), _MONTHS.index(m.group(1)) + 1, int(m.group(2)), int(m.group(4)),
                      int(m.group(5)), int(m.group(6)), tzinfo=timezone.utc)
        t = (at.timestamp() + (off if m.group(7)[0] == "-" else -off) * 60) * 1000.0
    if t is None:
        raise Defer("an envelope's signed day is written in a shape only Apps Script's Date parser reads")
    return datetime.fromtimestamp(t / 1000.0, timezone.utc).astimezone(NY).strftime("%Y-%m-%d")


def _doc_category(title: Any, folder: Any) -> str:
    """spDocCategory_."""
    f = gsjs.or_text(folder).lower()
    if "background" in f:
        return "background"
    if "medical" in f:
        return "medical"
    if "driv" in f:
        return "driving"
    if "training" in f:
        return "training"
    t = gsjs.or_text(title).lower()
    for cat, rx in _CATEGORY_TITLE:
        if rx.search(t):
            return cat
    return "other"


def documents_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spDocumentsBuild_: every paper the platform holds for the person, each with its category, dates and status."""
    why: list[str] = []
    degraded = False
    files: list[dict] = []
    by_id: dict[str, dict] = {}
    if _obj(ctx.get("master")) is not None:
        _master_sure(ctx, [c for paper in _DOC_PAPERS for c in (paper.get("date"), paper.get("expires"),
                                                                 paper.get("flag")) if c]
                     + ["driver", "resume", "hs_diploma", "email", "phone"])

    def put(f: dict) -> None:
        fid = f.get("file_id") or ""
        if not fid or not _DRIVE_FILE_ID.match(fid):
            return
        had = by_id.get(fid)
        if had is not None:
            if f.get("confirmed"):
                had["confirmed"] = True
            if f.get("expires") and not had.get("expires"):
                had["expires"] = f["expires"]
            if f.get("date") and not had.get("date"):
                had["date"] = f["date"]
            return
        by_id[fid] = f
        files.append(f)

    drive = _drive_docs(reads, ctx)
    for f in drive["files"]:
        put(f)
    why.extend(drive["why"])
    if drive["failed"]:
        degraded = True
    sd = _staff_docs_for(reads, ctx["name"])
    for d in (sd or {}).get("docs") or []:
        put({"file_id": gsjs.or_text(d.get("fileId")) or L.drive_id(d.get("link")), "title": _text(d.get("type")) or
             "Document", "mime": "", "date": _day(d.get("certified")), "expires": _day(d.get("expires")), "folder": "",
             "source": "archive" if d.get("from") == "archive" else "form"})
    uploads = _uploads(reads)
    if uploads is None:
        why.append("the uploads ledger could not be read")
        degraded = True
    for r in uploads or []:
        if _fold(r.get("person")) != ctx["key"]:
            continue
        o = _upload_out(r)
        label = _cert_label(reads, o["req_id"] or o["cert"])
        put({"file_id": o["file_id"], "title": _text(label or o["name"] or o["cert"]) or "Document", "mime": "",
             "date": o["issued_on"] or _day(o["at"]), "expires": o["expires_on"], "folder": "", "source": "upload",
             "confirmed": bool(o["confirmed_at"])})
    for f in _hiring_docs(reads, gsjs.or_text(ctx.get("candidate_id"))):
        put(f)
    for r in reads.ist_rows():
        if gsjs.name_key(r.get("staffName")) != ctx["key"]:
            continue
        fid = gsjs.cell(r.get("docFileId"))
        if fid:
            put({"file_id": fid, "title": "IST — " + _text(r.get("clientName")), "mime": "",
                 "date": _day(gsjs.cell(r.get("docAt"))), "expires": "", "folder": "Training", "source": "upload"})
    acct, people, m = _obj(ctx.get("account")) or {}, _obj(ctx.get("people")) or {}, _obj(ctx.get("master"))
    master = m or {}
    who = {"email": gsjs.or_text(acct.get("email")) or gsjs.or_text(people.get("email")) or
           gsjs.or_text(master.get("email")) or "",
           "phone": gsjs.or_text(people.get("phone")) or gsjs.or_text(master.get("phone")) or ""}
    files.sort(key=_cmp(lambda a, b: -1 if gsjs.or_text(b.get("date")) < gsjs.or_text(a.get("date"))
                        else (1 if gsjs.or_text(b.get("date")) > gsjs.or_text(a.get("date")) else 0)))
    used: dict[str, bool] = {}
    docs: list[dict] = []
    if m is not None:
        driver_na = bool(re.fullmatch(r"no|none", gsjs.or_text(m.get("driver")), re.I)) or _is_na(m.get("driver"))
        cols = [c for paper in _DOC_PAPERS for c in (paper.get("date"), paper.get("expires"), paper.get("flag")) if c]
        gone = [i for i in ctx.get("master_missing") or [] if i in cols]
        why.append("the Employee Database Master has no column for " + ", ".join(gone) if gone else "")
        envelope: dict | None = None
        envelope_read = False
        for paper in _DOC_PAPERS:
            if paper.get("driving") and driver_na:
                continue
            file = next((f for f in files if not used.get(f["file_id"]) and paper["re"].search(f.get("title") or "")),
                        None)
            if file:
                used[file["file_id"]] = True
            date = _day(m.get(paper["date"])) if paper.get("date") else ""
            expires = _day(m.get(paper["expires"])) if paper.get("expires") else ""
            flag = _flag(m.get(paper["flag"])) if paper.get("flag") else ""
            status = "missing"
            if paper["kind"] == "form":
                if flag == "0.5" or (flag == "0" and date):
                    status = "partial"
                elif date and flag != "0":
                    status = "signed"
                elif file:
                    status = "on_file"
                if paper["id"] == "job_app" and status != "partial":
                    if not envelope_read:
                        envelope_read = True
                        if who["email"] or who["phone"]:
                            envelope, _w = _soft(lambda: _envelope(reads, who))
                    if envelope and envelope["status"].lower() == "signed":
                        status = "signed"
                        date = date or _iso_day_of(envelope["signed_raw"])
            elif paper["kind"] == "verify":
                none = paper["id"] == "hs_diploma" and bool(re.match(r"^no\b", gsjs.or_text(m.get("hs_diploma")), re.I))
                if not none and flag == "1":
                    status = "verified"
                elif not none and flag == "0.5":
                    status = "partial"
                elif file:
                    status = "on_file"
                elif not none and date:
                    status = "signed"
            elif paper["kind"] == "resume":
                if file or _yes_no(m.get("resume")) == "yes":
                    status = "on_file"
            else:
                if flag == "0.5":
                    status = "partial"
                elif file or expires or date:
                    status = "on_file"
            if file and file.get("confirmed"):
                status = "verified"
            docs.append({"id": file["file_id"] if file else "master:" + paper["id"],
                         "file_id": file["file_id"] if file else None, "title": paper["title"],
                         "category": paper["category"], "date": date or ((file.get("date") or "") if file else ""),
                         "expires": expires or ((file.get("expires") or "") if file else ""), "status": status,
                         "source": file["source"] if file else "master",
                         "mime": (file.get("mime") or "") if file else ""})
    else:
        why.append(ctx.get("master_why") or "this person has no row in the Employee Database Master")
        if not ctx.get("master_read"):
            degraded = True
    for f in files:
        if used.get(f["file_id"]):
            continue
        docs.append({"id": f["file_id"], "file_id": f["file_id"], "title": f.get("title"),
                     "category": _doc_category(f.get("title"), f.get("folder")), "date": f.get("date") or "",
                     "expires": f.get("expires") or "", "status": "verified" if f.get("confirmed") else "on_file",
                     "source": f.get("source"), "mime": f.get("mime") or ""})
    with_file = len([d for d in docs if d["file_id"]])
    return {"docs": docs,
            "counts": {"total": len(docs), "with_file": with_file,
                       "missing": len([d for d in docs if d["status"] == "missing"])},
            "why": "; ".join(w for w in why if w), "degraded": degraded}


def documents_door(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spDocuments_: the documents part (metadata; the bytes open through Apps Script's own door)."""
    if ctx.get("refused"):
        return ctx["refused"]
    data = reads.once("spc_documents:" + ctx["key"], lambda: _shown(_scrub(documents_build(reads, ctx))))
    return {"status": 200, "data": data}


# ---- the actions ------------------------------------------------------------------------------------------------------

def _person(sess: L.Session, payload: dict) -> dict:
    """spWholeGate_ then staffProfilesPerson_: {'refused': env} or the person."""
    import staff as SP  # noqa: PLC0415 - the two modules lean on each other
    if not SP.whole_gate(sess):
        return {"refused": SP.unknown()}
    return SP.person_for(sess, payload.get("staff"))


def _activity_person(sess: L.Session, payload: dict) -> dict:
    """An Activity view's door (Shifts, Texts, Transcripts): App Control's Activity row, then _person."""
    import staff as SP  # noqa: PLC0415 - the two modules lean on each other
    if not SP.tab_open(sess, SP.ACTIVITY_FEATURE):
        return {"refused": SP.unknown()}
    return _person(sess, payload)


def staff_profile_notes(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffProfileNotes."""
    ctx = _person(sess, payload)
    return ctx["refused"] if ctx.get("refused") else notes_door(sess.reads, ctx)


def staff_profile_shifts(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffProfileShifts."""
    ctx = _activity_person(sess, payload)
    return ctx["refused"] if ctx.get("refused") else shifts_door(sess.reads, ctx)


def staff_profile_documents(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffProfileDocuments."""
    ctx = _person(sess, payload)
    return ctx["refused"] if ctx.get("refused") else documents_door(sess.reads, ctx)


def staff_profile_doc_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffProfileDocFile: one of the person's documents as bytes; only a file their Documents or Employment name."""
    ctx = _person(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    file_id = _text(payload.get("id"), 120)
    if not FILE_ID.fullmatch(file_id):
        return {"status": 400, "message": "id: a Drive file id."}
    reads = sess.reads
    try:
        docs = documents_door(reads, ctx)["data"]
        known = any(d.get("file_id") == file_id for d in docs.get("docs") or [])
        if not known:
            import staff as SP  # noqa: PLC0415 - the two modules lean on each other
            emp = SP.employment_build(reads, ctx)
            known = (((emp.get("hiring") or {}).get("resume") or {}).get("doc_id") == file_id
                     or ((emp.get("qualifications") or {}).get("hs_diploma") or {}).get("doc_id") == file_id)
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - spDocKnown_'s catch
        return {"status": 503, "message": "The documents could not be read just now — try again in a minute."}
    if not known:
        return {"status": 404, "message": "This staff member names no such document."}
    got = L.doc_file(reads, file_id)
    if got.get("refused"):
        return got["refused"]
    return {"status": 200, "data": {"id": file_id, **got}}


def staff_profile_texts(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffProfileTexts: one conversation per company line, newest first, a page at a time."""
    ctx = _activity_person(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    reads = sess.reads
    facts = reads.once("spc_texts:" + ctx["key"], lambda: _shown(_scrub(texts_facts(reads, ctx))))
    want = _text(payload.get("with"), 60)
    ids = [x["id"] for x in facts["counterparts"]]
    with_id = want if want in ids else (ids[0] if ids else "")
    before = _text(payload.get("before"), 40)
    thread = [m for m in facts["messages"] if m["line"] == with_id and (not before or m["at"] < before)]
    page = [{"id": m["id"], "at": m["at"], "dir": m["dir"], "body": m["body"], "by": m["by"]}
            for m in thread[:SP_TEXT_PAGE]]
    return {"status": 200, "data": {"counterparts": facts["counterparts"], "with": with_id, "messages": page,
                                    "more": len(thread) > SP_TEXT_PAGE, "coverage": facts["coverage"],
                                    "phones_matched": facts["phones_matched"], "why": facts["why"],
                                    "degraded": bool(facts["degraded"])}}


def staff_profile_transcripts(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffProfileTranscripts: the person's calls by date and category, metadata only."""
    ctx = _activity_person(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return {"status": 200, "data": _transcripts(sess.reads, ctx)}


def staff_profile_transcript(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffProfileTranscript: one listed call's words, the read kept with who asked."""
    ctx = _activity_person(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    call_id = _text(payload.get("call_id"), 60)
    if not call_id:
        return {"status": 400, "message": "call_id: which call."}
    calls = _transcripts(sess.reads, ctx).get("calls") or []
    if not any(c["call_id"] == call_id for c in calls):
        return {"status": 404, "message": "This staff member has no such call."}
    return transcript_read(sess.reads, call_id, sess.user)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "staffProfileNotes": staff_profile_notes, "staffProfileTexts": staff_profile_texts,
    "staffProfileTranscripts": staff_profile_transcripts, "staffProfileTranscript": staff_profile_transcript,
    "staffProfileDocuments": staff_profile_documents, "staffProfileShifts": staff_profile_shifts,
    "staffProfileDocFile": staff_profile_doc_file,
}

# spPackDoors_'s parts this module answers: fn(reads, ctx) → the part's answer
PACK_DOORS: dict[str, Callable[[L.Reads, dict], dict[str, Any]]] = {
    "notes": notes_door, "shifts": shifts_door, "documents": documents_door,
}

POLICY_ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
POLICY = {"staffProfileNotes": {"roles": POLICY_ROLES, "params": {"staff": "string"}},
          "staffProfileTexts": {"roles": POLICY_ROLES, "params": {"staff": "string", "with": "string",
                                                                  "before": "string"}},
          "staffProfileTranscripts": {"roles": POLICY_ROLES, "params": {"staff": "string"}},
          "staffProfileTranscript": {"roles": POLICY_ROLES, "params": {"staff": "string", "call_id": "string"}},
          "staffProfileDocuments": {"roles": POLICY_ROLES, "params": {"staff": "string"}},
          "staffProfileShifts": {"roles": POLICY_ROLES, "params": {"staff": "string"}},
          "staffProfileDocFile": {"roles": POLICY_ROLES, "params": {"staff": "string", "id": "string"}}}
