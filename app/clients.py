"""Clients' reads (apps-script/ClientProfiles.gs), the same answers off asa-hub-db: one client at a time, cut to the reader."""
from __future__ import annotations

import functools
import math
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import dr_book as DB
import drive as dr
import gsjs
import house_tables as HT
import hubdb
import locations as L
import photos as P
import scope as sc
from gsjs import NY, SheetDate, name_key
from scope import Defer

APP_ID = "client-profiles"
# App Control's row Clients splits its Transportation tab off (src/lib/featureAccess.ts APP_FEATURES): Calendar and
# History, the client's trips and the Van Calendar's board lent here. An empty row is the master's alone; a holder of
# the edition that lives in the tab keeps it, since an edition only ever adds people.
TRANSPORT_FEATURE = "client-profiles.transportation"
TRANSPORT_EDITION = "clients.transportation"
SCOPED = ("client", "guardian", "ssa")
NOTE_KINDS = ("daily_note", "client_note", "house_note")
NOTE_COUNTS = ("daily_notes", "client_notes", "house_notes")
SECTIONS_TAB = "isp_sections"
OVERRIDES_TAB = "client_overrides"
REVIEWS_TAB = "incident_reviews"
HOUSE_NOTES_TAB = "house_notes"
OVERRIDE_TABS = ("daily", "health", "goals", "home")
INCIDENT_STATUSES = ("Reported", "Under review", "Closed")
CARE_TABS = ("plans", "team", "daily", "health", "goals", "home")
MEDS_TABS = ("meds",)
CLIENT_DB_PROP, CLIENT_DB_FALLBACK = "HUB_CLIENT_DB_SHEET_ID", "1fTi78ztKDiK3hvYLbI2IQ1TeSrzVLceK5LyXJ4BVPe8"
MASTER_TAB = "Master"
ARCHIVE_TAB = "Archive - Old Clients"
MASTER_DATA_PROP = "EMP360_MASTER_DATA_ID"
MASTER_DATA_TAB = "Client - Database"
# the record's columns the Care team shows
TEAM_FIELDS = frozenset({"guardianName", "guardian_relationship", "guardian_phone", "guardian_email", "ssa_name",
                         "ssa_phone", "ssa_email", "house_manager", "house_manager_phone", "house_manager_email",
                         "payee_rep", "payee_rep_phone", "payee_rep_email"})
SECTION_MAX = 30000
ROW_CAP = 600
RECENT_APPT_DAYS = 60
# Estate.gs ESTATE_SOURCES for the books Locations does not read
ESTATE = {"drAppointments": ("ESTATE_DR_ID", "Dr Master"), "drVisits": ("ESTATE_DR_ID", "Dr Appt Archive"),
          "dailyNotes": ("ESTATE_NOTES_ID", "Notes")}
# ClientFilesIndex.gs CFX_COLS
CFX_COLS = ("id", "client_key", "client_name", "title", "folder", "kind", "doc_kind", "subject", "digest_category",
            "mime_type", "drive_id", "url", "size_bytes", "file_date", "issued_on", "expires_on", "modified_time",
            "createdAt", "digest_state", "digest_text_chars", "text_file")

_A = re.A | re.I
ROUTINES = (("morning", "Morning", re.compile(r"\bmornings?\b", _A)),
            ("afternoon", "Afternoon", re.compile(r"\bafternoons?\b", _A)),
            ("evening", "Evening", re.compile(r"\bevenings?\b", _A)),
            ("bedtime", "Bedtime", re.compile(r"\bbed\s?time\b|\b(goes|going|go) to bed\b", _A)),
            ("overnight", "Overnight", re.compile(r"\bovernights?\b|\bthrough the night\b", _A)),
            ("meals", "Meals", re.compile(r"\b(breakfast|lunch|dinner|supper)\b", _A)),
            ("hygiene", "Hygiene", re.compile(r"\b(showers?|showering|baths?|bathing|hygiene)\b", _A)),
            ("sleep", "Sleep", re.compile(r"\bsleep(s|ing)?\b|\bslept\b", _A)),
            ("wake", "Waking up", re.compile(r"\b(wakes?|waking|woke)\b|\bwake-?up\b", _A)))
PLAN_SECTIONS = (
    {"section": "important_people", "label": "Important people",
     "start": re.compile(r"(^|\n)[ \t]*Important People\b", _A), "keep_head": True},
    {"section": "services", "label": "Paid supports",
     "start": re.compile(r"(^|\n)[ \t]*(Paid Supports|Funding Source)\s*:", _A), "many": True},
    {"section": "home_needs", "label": "Community living",
     "start": re.compile(r"(^|\n)[ \t]*Community Living\b[^\n]*", _A)},
    {"section": "equipment", "label": "Equipment",
     "start": re.compile(r"(^|\n)[ \t]*Assistive/adaptive equipment used\b[^\n]*", _A)},
    {"section": "outcomes", "label": "Outcomes & experiences",
     "start": re.compile(r"(^|\n)[ \t]*Outcomes\s*(?:and|&)?\s*Experiences\b[^\n]*", _A)},
    {"section": "great_things", "label": "Great things about me",
     "start": re.compile(r"(^|\n)[ \t]*Great Things About\b[^\n]*", _A)},
    {"section": "team", "label": "All team members",
     "start": re.compile(r"(^|\n)[ \t]*All Team Members\b[^\n]*", _A), "tail": True})
STOP_LABELS = (r"Important To\b", r"Important For\b", r"Need to Know to Support", r"Great Things About",
               r"Contact Information", r"Assessment Area", r"Discovery Assessment", r"Healthy Living", r"Nutrition\b",
               r"Communication\b", r"Advocacy", r"Safety\s*&\s*Security", r"Social\s*&\s*Spirituality", r"Daily Life",
               r"School and Education", r"Community Living", r"Skills and Abilities", r"Getting Around",
               r"Supervision Considerations", r"Known and Likely Risks", r"Outcomes", r"Services and Supports",
               r"Informed Consent", r"Team Signatures", r"Scope of Service", r"Who is Responsible", r"Support Planning",
               r"What does a healthy lifestyle", r"Does the person\b", r"What kinds of food", r"What physical",
               r"Has the person been to the hospital", r"Do they require", r"Assistive/adaptive equipment used",
               r"Date of Birth", r"Important People", r"Paid Supports\s*:", r"Funding Source\s*:", r"All Team Members")
_STOP_RE = re.compile(r"(^|\n)[ \t]*(?:" + "|".join(STOP_LABELS) + ")", _A)
_HEADING_RE = re.compile(r"^(?:" + "|".join(STOP_LABELS) + ")", _A)
CARE_FIELDS = {
    "daily": (("personal_care", "Personal care"), ("mobility", "Mobility"), ("diet_nutrition", "Diet & nutrition"),
              ("communication", "Communication")),
    "health": (("diagnoses", "Diagnoses"), ("allergies", "Allergies"), ("medications", "Medications in the plan"),
               ("medical_summary", "Medical summary"), ("safety_risks", "Safety & risks"),
               ("behaviors", "Behavior support"), ("supervision_level", "Supervision")),
    "goals": (("goals_outcomes", "Goals & outcomes"), ("important_to", "Important to"),
              ("important_for", "Important for")),
    "home": (), "team": (), "plans": ()}
CARE_SECTIONS = {"daily": (), "health": ("equipment",), "goals": ("outcomes", "great_things"),
                 "home": ("home_needs", "services"), "team": ("team",), "plans": ()}
SAVE_FIELDS = L.CP_SAVE_FIELDS
SAVE_ALIASES = {"guardian_name": "guardianName"}
FIELD_NAMES = L.CP_FIELD_NAMES
# Master and archive headers (folded: lowercase, '#' as 'no', nothing else) → profile field or masked cell
BOOK_FIELDS = {
    "client": "name", "customer": "name", "ama": "ama_date", "isp": "isp_signed_date", "ssa": "ssa_name",
    "ssano": "ssa_phone", "ssaemail": "ssa_email", "house": "house", "status": "status", "address": "home_address",
    "outcome": "outcome", "clientno": "client_number", "guardian": "guardian_name", "initials": "initials",
    "workshop": "workshop", "birthdate": "dob", "payeerep": "payee_rep", "foodstamp": "food_stamp",
    "guardianno": "guardian_phone", "medicaidno": "medicaid_id", "startdate": "start_date",
    "payeerepno": "payee_rep_phone", "housemanager": "house_manager", "mediarelease": "media_release",
    "guardianemail": "guardian_email", "medicalsupply": "medical_supply", "spendinglimit": "spending_limit",
    "transportation": "transportation", "workshopphone": "workshop_phone", "housemanagerno": "house_manager_phone",
    "payeerepemail": "payee_rep_email", "guardianaddress": "guardian_address", "workshopaddress": "workshop_address",
    "housemanageremail": "house_manager_email", "guardianshippapers": "guardianship_papers",
    "guardianrelationship": "guardian_relationship", "selfadminassessment": "self_admin_assessment",
    "transportationphone": "transportation_phone", "truelinkconsentform": "truelink_consent",
    "selfadminexpirationdate": "self_admin_expires"}
BOOK_MASKED = {"ssn": "ssn", "tldebitcardnumber": "tl_card", "dcexpdate": "dc_exp", "dcsecuritycode": "dc_security_code",
               "dcpinno": "dc_pin"}
BOOK_DATES = ("dob", "ama_date", "start_date", "self_admin_expires", "isp_signed_date")
BOOK_PHONES = ("ssa_phone", "guardian_phone", "payee_rep_phone", "house_manager_phone", "workshop_phone",
               "transportation_phone")
ACTIVITY_KINDS = {"daily_note": "Daily note", "client_note": "Client note", "house_note": "House note",
                  "incident": "Incident", "visit": "Doctor visit", "med_added": "Medication added",
                  "med_stopped": "Medication discontinued"}
MEDS_EDIT_COLUMNS = {"name": "PrescriptionName", "dose": "Dosage", "times": "AdministrationTimes", "route": "MedType",
                     "freq": "PRN", "discontinued": "Discountinued"}
SCRUB_KEYS = frozenset({"id", "file_id", "isp_file_id", "receipt_file_id", "drive_id", "person_id", "ssa_person_id",
                        "witness"})
# Clients.gs
GUARDIAN_NON_PERSON = ("self", "none", "n/a", "na", "no guardian", "no legal guardian", "not applicable", "unknown",
                       "tbd", "n a", "-", "--")
ISP_EMAIL_TLDS = ("com", "org", "net", "edu", "gov", "us", "co", "io", "info", "biz", "health", "care", "services")
ISP_PEOPLE_ROLES = ("Guardianship of Person", "Emergency Contact", "Medical Provider", "Power of Attorney",
                    "Home Provider", "Legal Guardian", "Case Manager", "Guardian & Type", "Guardian", "Provider",
                    "Family", "Friend", "Parent", "Sibling", "Advocate", "Payee", "Doctor", "Roommate", "Employer")
ISP_MONTHS = ("january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
              "november", "december")
GUARDIAN_LABELS = ("Guardian", "Legal guardian", "Guardianship of person", "Guardianship")
_CELL_LABEL = re.compile(r"^(e-?mail|phone|cell(?:\s*phone)?|direct\s*line|work(?:\s*phone)?|home\s*phone|mobile|fax|"
                         r"tel(?:ephone)?)\s*[:\-–]\s*(.+)$", re.I)
_NEXT_LABEL = re.compile(r"(^|[\s.;,])(case manager|ssa|physician|pcp|doctor|father|mother|parent|sibling|brother|sister|"
                         r"emergency|payee|provider|home provider|employer|advocate|friend|roommate|nurse|therapist|"
                         r"dentist|pharmacy|other)\s*:", re.I)
_SSN = re.compile(r"(^|\D)\d{3}-\d{2}-\d{4}(?=\D|\Z)", re.A)
_RUN = re.compile(r"(^|\D)(\d{9}|\d{13,19})(?=\D|\Z)", re.A)
_WS_CLASS = r"\s﻿"
_BULLETS = r"•●◦▪*\-–"

# the Hub tabs whose date-looking cells are text in the sheet (a US date there is never a Date to getValues)
TEXT_TABS = {"clients": "raw", "medications": "raw"}
# the copy's withholding markers (server/redaction.py): never shown, never read as a value
COPY_MARKER = "[withheld"
# what a client book's masked cell keeps inside its marker (redaction BOOK_KEPT_FACTS): its last four, on file, none
_KEPT = re.compile(r"\[withheld: [a-z]+\] kept: (\d{4}|on file|none)")


def kept_of(v: Any) -> str | None:
    """The figure the copy kept of a masked cell ('1234', 'on file', 'none'); None for a cell it did not keep one of."""
    m = _KEPT.fullmatch(v.strip()) if isinstance(v, str) else None
    return m.group(1) if m else None
ISP_INDEX_TTL_S = dr.ISP_INDEX_TTL_S
_ISP_HELD: dict[str, Any] = {"at": 0.0, "folder": "", "files": []}

_soft = L._soft
by_name = L.by_name


def _or(*vals: Any) -> Any:
    """a || b || …: the first truthy value, else the last."""
    for v in vals:
        if not gsjs.falsy(v):
            return v
    return vals[-1] if vals else None


def _cat(v: Any) -> str:
    """String(v) inside a concatenation: undefined for a missing value."""
    return "undefined" if v is None else gsjs.js_str(v)


def _why_of(what: str, why: str) -> str:
    """cpWhy_."""
    return f"{what} could not be read ({why})"


def unknown() -> dict[str, Any]:
    """clientProfilesUnknown_."""
    return {"status": 404, "message": "Unknown action."}


def scrub(v: Any, key: str | None = None) -> Any:
    """cpScrub_: a bare 9-digit or 13-19-digit run, or an SSN shape, never leaves."""
    if key and key in SCRUB_KEYS:
        return v
    if isinstance(v, str):
        return _RUN.sub(r"\1[withheld]", _SSN.sub(r"\1[withheld]", v))
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        if isinstance(v, float) and not math.isfinite(v):
            return v
        r = v if isinstance(v, int) else gsjs.js_round(v)
        n = len(gsjs.num_str(abs(r)))
        return None if (n == 9 or 13 <= n <= 19) and r == v else v
    if isinstance(v, list):
        return [scrub(x) for x in v]
    if isinstance(v, dict):
        return {k: scrub(x, k) for k, x in v.items()}
    return v


def _marked(v: Any) -> bool:
    if isinstance(v, str):
        return COPY_MARKER + ":" in v
    if isinstance(v, list):
        return any(_marked(x) for x in v)
    if isinstance(v, dict):
        return any(_marked(x) for x in v.values())
    return False


def answer(data: Any) -> dict[str, Any]:
    """cpAnswer_; a cell the copy withholds is Apps Script's to show."""
    out = scrub(data)
    if _marked(out):
        raise Defer("the copy withholds a cell this answer shows")
    return {"status": 200, "data": out}


# ---- JavaScript's Date.parse, for apptDay_'s last resort ----------------------------------------------------------

_KEYWORDS = {"jan": ("month", 1), "feb": ("month", 2), "mar": ("month", 3), "apr": ("month", 4), "may": ("month", 5),
             "jun": ("month", 6), "jul": ("month", 7), "aug": ("month", 8), "sep": ("month", 9), "oct": ("month", 10),
             "nov": ("month", 11), "dec": ("month", 12), "am": ("ampm", 0), "pm": ("ampm", 12), "ut": ("tz", 0),
             "utc": ("tz", 0), "z": ("tz", 0), "gmt": ("tz", 0), "cdt": ("tz", -5), "cst": ("tz", -6),
             "edt": ("tz", -4), "est": ("tz", -5), "mdt": ("tz", -6), "mst": ("tz", -7), "pdt": ("tz", -7),
             "pst": ("tz", -8), "t": ("sep", 0)}
_NONE = None


def _tokens(s: str) -> list[tuple]:
    """V8's DateStringTokenizer."""
    out: list[tuple] = []
    i, n = 0, len(s)
    while i < n:
        ch = s[i]
        if "0" <= ch <= "9":
            j, v = i, 0
            while j < n and "0" <= s[j] <= "9":
                if v < 2147483647 // 10 - 10:
                    v = v * 10 + ord(s[j]) - 48
                j += 1
            out.append(("num", v, j - i))
            i = j
        elif ch in ":-+.)":
            out.append(("sym", ch))
            i += 1
        elif ord(ch) >= 0x41 and not ch.isspace() and ch != "﻿":
            j = i
            while j < n and ord(s[j]) >= 0x41 and not s[j].isspace() and s[j] != "﻿":
                j += 1
            word = s[i:j]
            pre = "".join(chr(ord(c) | 0x20) for c in word[:3])
            kw = _KEYWORDS.get(pre)
            if kw and not (len(word) > 3 and kw[0] != "month"):
                out.append(("kw", kw[0], kw[1], len(word)))
            else:
                out.append(("kw", "invalid", 0, len(word)))
            i = j
        elif ch.isspace() or ch == "﻿":
            j = i
            while j < n and (s[j].isspace() or s[j] == "﻿"):
                j += 1
            out.append(("ws",))
            i = j
        elif ch == "(":
            depth = 0
            while True:
                if s[i] == ")":
                    depth -= 1
                elif s[i] == "(":
                    depth += 1
                i += 1
                if not (depth > 0 and i < n):
                    break
            out.append(("unknown",))
        else:
            out.append(("unknown",))
            i += 1
    return out


class _Scan:
    def __init__(self, toks: list[tuple]) -> None:
        self.toks, self.i = toks, 0

    def peek(self) -> tuple:
        return self.toks[self.i] if self.i < len(self.toks) else ("end",)

    def next(self) -> tuple:
        t = self.peek()
        self.i += 1
        return t

    def skip(self, sym: str) -> bool:
        if self.peek() == ("sym", sym):
            self.i += 1
            return True
        return False


def _num(t: tuple, length: int | None = None) -> bool:
    return t[0] == "num" and (length is None or t[2] == length)


def _ms_of(t: tuple) -> int:
    n, length = t[1], t[2]
    if length == 1:
        return n * 100
    if length == 2:
        return n * 10
    if length > 3:
        length = min(length, 9)
        f = 1
        while length > 3:
            f *= 10
            length -= 1
        return n // f
    return n


def _v8_parse(s: str) -> tuple | None:
    """DateParser::Parse: (year, month0, day, h, m, s, ms, utc offset seconds or None), or None for NaN."""
    sc_ = _Scan(_tokens(s))
    day: list[int] = []
    named = _NONE
    iso = False
    time: list[int] = []
    ampm = _NONE
    tz = {"sign": _NONE, "hour": _NONE, "minute": _NONE}

    def t_expect(n: int) -> bool:
        k = len(time)
        return (k == 1 and 0 <= n <= 59) or (k == 2 and 0 <= n <= 59) or (k == 3 and 0 <= n <= 999)

    def t_add(n: int) -> bool:
        if len(time) < 4:
            time.append(n)
            return True
        return False

    def t_final(n: int) -> bool:
        if not t_add(n):
            return False
        while len(time) < 4:
            time.append(0)
        return True

    def tz_set(h: int) -> None:
        tz["sign"], tz["hour"], tz["minute"] = (-1 if h < 0 else 1), abs(h), 0

    def tz_utc() -> bool:
        return tz["hour"] == 0 and tz["minute"] == 0

    def es5() -> tuple:
        nonlocal iso
        p = sc_.peek()
        if p[0] == "sym" and p[1] in "+-":
            sign_tok = sc_.next()
            if not _num(sc_.peek(), 6):
                return sign_tok
            year = sc_.next()[1]
            if sign_tok[1] == "-" and year == 0:
                return sign_tok
            day.append(-year if sign_tok[1] == "-" else year)
        elif _num(p, 4):
            day.append(sc_.next()[1])
        else:
            return sc_.next()
        if sc_.skip("-"):
            if not _num(sc_.peek(), 2) or not 1 <= sc_.peek()[1] <= 12:
                return sc_.next()
            day.append(sc_.next()[1])
            if sc_.skip("-"):
                if not _num(sc_.peek(), 2) or not 1 <= sc_.peek()[1] <= 31:
                    return sc_.next()
                day.append(sc_.next()[1])
        p = sc_.peek()
        if not (p[0] == "kw" and p[1] == "sep"):
            if p[0] != "end":
                return sc_.next()
        else:
            sc_.next()
            if not _num(sc_.peek(), 2) or not 0 <= sc_.peek()[1] <= 24:
                return ("invalid",)
            h24 = sc_.peek()[1] == 24
            time.append(sc_.next()[1])
            if not sc_.skip(":"):
                return ("invalid",)
            if not _num(sc_.peek(), 2) or not 0 <= sc_.peek()[1] <= 59 or (h24 and sc_.peek()[1] > 0):
                return ("invalid",)
            time.append(sc_.next()[1])
            if sc_.skip(":"):
                if not _num(sc_.peek(), 2) or not 0 <= sc_.peek()[1] <= 59 or (h24 and sc_.peek()[1] > 0):
                    return ("invalid",)
                time.append(sc_.next()[1])
                if sc_.skip("."):
                    if not _num(sc_.peek()) or (h24 and sc_.peek()[1] > 0):
                        return ("invalid",)
                    time.append(_ms_of(sc_.next()))
            p = sc_.peek()
            if p[0] == "kw" and p[1] == "tz" and p[2] == 0 and p[3] == 1:
                sc_.next()
                tz_set(0)
            elif p[0] == "sym" and p[1] in "+-":
                tz["sign"] = 1 if sc_.next()[1] == "+" else -1
                if _num(sc_.peek(), 4):
                    hm = sc_.next()[1]
                    if not 0 <= hm // 100 <= 23 or not 0 <= hm % 100 <= 59:
                        return ("invalid",)
                    tz["hour"], tz["minute"] = hm // 100, hm % 100
                else:
                    if not _num(sc_.peek(), 2) or not 0 <= sc_.peek()[1] <= 23:
                        return ("invalid",)
                    tz["hour"] = sc_.next()[1]
                    if not sc_.skip(":"):
                        return ("invalid",)
                    if not _num(sc_.peek(), 2) or not 0 <= sc_.peek()[1] <= 59:
                        return ("invalid",)
                    tz["minute"] = sc_.next()[1]
            if sc_.peek()[0] != "end":
                return ("invalid",)
        if tz["hour"] is _NONE and not time:
            tz_set(0)
        iso = True
        return ("end",)

    tok = es5()
    if tok[0] == "invalid":
        return None
    has_num = bool(day)
    while tok[0] != "end":
        if tok[0] == "num":
            has_num = True
            n = tok[1]
            if sc_.skip(":"):
                if sc_.skip(":"):
                    if time:
                        return None
                    time.extend([n, 0])
                else:
                    if not t_add(n):
                        return None
                    if sc_.peek() == ("sym", "."):
                        sc_.next()
            elif sc_.skip(".") and t_expect(n):
                t_add(n)
                if not _num(sc_.peek()):
                    return None
                if not t_final(_ms_of(sc_.next())):
                    return None
            elif tz["hour"] is not _NONE and tz["minute"] is _NONE and 0 <= n <= 59:
                tz["minute"] = n
            elif t_expect(n):
                t_final(n)
                p = sc_.peek()
                if not (p[0] in ("end", "ws") or (p[0] == "kw" and p[1] == "tz" and p[2] == 0 and p[3] == 1)
                        or (p[0] == "sym" and p[1] in "+-")):
                    return None
            else:
                if len(day) >= 3:
                    return None
                day.append(n)
                sc_.skip("-")
        elif tok[0] == "kw":
            kind, val = tok[1], tok[2]
            if kind == "ampm" and time:
                ampm = val
            elif kind == "month":
                named = val
                sc_.skip("-")
            elif kind == "tz" and has_num:
                tz_set(val)
            else:
                if has_num:
                    return None
                if sc_.peek()[0] == "num":
                    return None
        elif tok[0] == "sym" and tok[1] in "+-" and (tz_utc() or time):
            tz["sign"] = -1 if tok[1] == "-" else 1
            n, length = 0, 0
            if sc_.peek()[0] == "num":
                t2 = sc_.next()
                n, length = t2[1], t2[2]
            has_num = True
            if sc_.peek() == ("sym", ":"):
                tz["hour"], tz["minute"] = n, _NONE
            elif length in (1, 2):
                tz["hour"], tz["minute"] = n, 0
            elif length in (3, 4):
                tz["hour"], tz["minute"] = n // 100, n % 100
            else:
                return None
        elif tok[0] == "sym" and tok[1] in "+-)" and has_num:
            return None
        tok = sc_.next()
    # DayComposer::Write
    if not day:
        return None
    comp = day + [1] * (3 - len(day))
    year = 0
    if named is _NONE:
        if iso or not 1 <= comp[0] <= 31:
            year, month, d = comp[0], comp[1], comp[2]
        else:
            month, d, year = comp[0], comp[1], comp[2]
    else:
        month = named
        if not 1 <= comp[0] <= 31:
            year, d = comp[0], comp[1]
        else:
            d, year = comp[0], comp[1]
    if not iso:
        if 0 <= year <= 49:
            year += 2000
        elif 50 <= year <= 99:
            year += 1900
    if not 1 <= month <= 12 or not 1 <= d <= 31:
        return None
    # TimeComposer::Write
    tm = time + [0] * (4 - len(time))
    hour, minute, second, milli = tm
    if ampm is not _NONE:
        if not 0 <= hour <= 12:
            return None
        hour = hour % 12 + ampm
    if not (0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59 and 0 <= milli <= 999):
        if hour != 24 or minute or second or milli:
            return None
    offset = None
    if tz["sign"] is not _NONE:
        offset = (tz["hour"] or 0) * 3600 + (tz["minute"] or 0) * 60
        offset = -offset if tz["sign"] < 0 else offset
    return (year, month - 1, d, hour, minute, second, milli, offset)


def _days_from_civil(y: int, m: int, d: int) -> int:
    y -= m <= 2
    era = (y if y >= 0 else y - 399) // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def _civil_from_days(z: int) -> tuple[int, int, int]:
    z += 719468
    era = (z if z >= 0 else z - 146096) // 146097
    doe = z - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = mp + (3 if mp < 10 else -9)
    return y + (m <= 2), m, d


def _js_local_day(s: str) -> str:
    """apptDay_'s Date.parse branch: the day the parsed instant falls on in New York, '' for NaN (or 0)."""
    got = _v8_parse(s)
    if got is None:
        return ""
    year, month0, d, h, mi, sec, ms, offset = got
    y = year + month0 // 12
    days = _days_from_civil(y, month0 % 12 + 1, 1) + d - 1
    local_ms = days * 86400000 + h * 3600000 + mi * 60000 + sec * 1000 + ms
    if offset is None:
        if abs(local_ms) > 8.64e15 + 864e5:
            return ""
        yy, mm, dd = _civil_from_days(local_ms // 86400000)
    else:
        utc_ms = local_ms - offset * 1000
        if abs(utc_ms) > 8.64e15 or utc_ms == 0:
            return ""
        yy, mm, dd = _civil_from_days(utc_ms // 86400000)
        if 1 <= yy <= 9998:
            at = datetime(yy, mm, dd, tzinfo=timezone.utc) + timedelta(milliseconds=utc_ms % 86400000)
            loc = at.astimezone(NY)
            yy, mm, dd = loc.year, loc.month, loc.day
        else:
            yy, mm, dd = _civil_from_days((utc_ms - 5 * 3600000) // 86400000)
    return f"{yy}-{mm:02d}-{dd:02d}"


# ---- small helpers, as the .gs files write them ------------------------------------------------------------------

def appt_day(v: Any) -> str:
    """apptDay_: a date cut, never re-parsed, unless no known shape holds it."""
    s = gsjs.trim(gsjs.or_text(v))
    m = re.match(r"([0-9]{4}-[0-9]{2}-[0-9]{2})(?:[T" + _WS_CLASS + r"]|\Z)", s)
    if m:
        return m.group(1)
    m = re.match(r"([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})", s)
    if m:
        return f"{m.group(3)}-{('0' + m.group(1))[-2:]}-{('0' + m.group(2))[-2:]}"
    return _js_local_day(s)


def cp_day(v: Any) -> str:
    """cpDay_: a day as yyyy-MM-dd, or ''."""
    if isinstance(v, SheetDate):
        return v.at.astimezone(NY).strftime("%Y-%m-%d")
    s = gsjs.trim(gsjs.or_blank(v))
    return appt_day(s) if s else ""


def isp_phone(value: Any) -> str:
    """ispPhone_."""
    d = re.sub(r"[^0-9]", "", gsjs.or_text(value))
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
    if len(d) != 10:
        return gsjs.trim(gsjs.or_text(value))
    return f"({d[:3]}) {d[3:6]}-{d[6:]}"


def cp_phone(v: Any) -> str:
    s = gsjs.trim(gsjs.or_blank(v))
    return isp_phone(s) if s else ""


def verbatim(v: Any, max_len: int = 0) -> str:
    """cpVerbatim_."""
    s = gsjs.trim(re.sub(r"[ \t]+\n", "\n", gsjs.or_blank(v).replace("\r", "")))
    return s[:max_len] if max_len else s


def gist(v: Any) -> str:
    """cpGist_: the first line of a passage, bullets off."""
    for line in verbatim(v).split("\n"):
        s = gsjs.trim(re.sub(r"^[" + _WS_CLASS + _BULLETS + r"]+", "", line))
        if s:
            return s[:157] + "…" if len(s) > 160 else s
    return ""


def age_of(dob: Any, today: Any) -> int | None:
    b = re.fullmatch(r"([0-9]{4})-([0-9]{2})-([0-9]{2})", gsjs.or_text(dob))
    t = re.fullmatch(r"([0-9]{4})-([0-9]{2})-([0-9]{2})", gsjs.or_text(today))
    if not b or not t:
        return None
    age = int(t.group(1)) - int(b.group(1)) - (1 if (t.group(2) + t.group(3)) < (b.group(2) + b.group(3)) else 0)
    return age if 0 <= age < 130 else None


def initials_of(name: Any) -> str:
    return "".join(w[0].upper() for w in re.split(r"[" + _WS_CLASS + r"]+", gsjs.or_text(name)) if w)[:3]


def statuses_of(rows: list[dict]) -> list[str]:
    out: list[str] = []
    for r in rows or []:
        s = gsjs.or_text((r or {}).get("status"))
        if s and s not in out:
            out.append(s)
    return out


def list_of(v: Any) -> list[str]:
    """cpList_."""
    return [x for x in (gsjs.trim(s) for s in re.split(r"[,;\n]+", gsjs.or_blank(v))) if x]


def fold(header: Any) -> str:
    """cpFold_."""
    return re.sub(r"[^a-z0-9]+", "", gsjs.or_blank(header).lower().replace("#", "no"))


def edit_text(v: Any) -> str:
    """hubEditText_."""
    return "" if v is None or isinstance(v, (dict, list)) else gsjs.js_str(v)


def edit_cleared(cell: Any) -> dict[str, bool]:
    """hubEditCleared_: the columns a record blanked on purpose."""
    out: dict[str, bool] = {}
    for c in edit_text(cell).split(","):
        c = gsjs.trim(c)
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", c):
            out[c] = True
    return out


def client_live(c: dict | None) -> bool:
    """clientLive_: not archived, and a status blank or 'active'."""
    if not c:
        return False
    a = c.get("archived")
    archived = a is True or gsjs.trim(gsjs.or_blank(a)).lower() == "true"
    return not archived and L.client_current(c)


def mask_of(raw: dict | None) -> dict[str, Any]:
    """clientProfileMask_: the only way an SSN, a card number or a DC cell reaches an answer."""
    r = raw or {}

    def digits(v: Any) -> str:
        return re.sub(r"[^0-9]", "", gsjs.or_blank(v))

    def present(v: Any) -> bool:
        k = kept_of(v)
        if k is not None:
            return k != "none"
        s = re.sub(r"[" + _WS_CLASS + r"\-–—./]+", "", gsjs.or_blank(v))
        return bool(s) and not re.fullmatch(r"(na|none|no|null|0+)", s, re.I)

    def last4(v: Any, shown: Callable[[int], bool]) -> tuple[str | None, bool]:
        """(the last four the mask draws, on file) — from the cell, or from what the copy kept of it."""
        k = kept_of(v)
        if k is not None:
            return (k if k.isdigit() else None), k != "none"
        d = digits(v)
        return (d[-4:] if shown(len(d)) else None), len(d) >= 4

    ssn4, ssn_on = last4(r.get("ssn"), lambda n: n in (9, 4))
    card4, _card_on = last4(r.get("tl_card"), lambda n: 12 <= n <= 19 or n == 4)
    return {"ssn_last4": ssn4, "ssn_on_file": ssn_on, "tl_card_last4": card4,
            "dc_exp_on_file": present(r.get("dc_exp")), "dc_security_code_on_file": present(r.get("dc_security_code")),
            "dc_pin_on_file": present(r.get("dc_pin"))}


# ---- Clients.gs: the plan's contact page, the guardians ------------------------------------------------------------

def strip_label(line: Any, labels: tuple) -> str:
    """ispStripLabel_."""
    s = gsjs.trim(gsjs.or_text(line))
    for lb in labels:
        rx = re.compile("^" + re.escape(lb) + r"[" + _WS_CLASS + r"]*:?[" + _WS_CLASS + r"]*", re.I)
        if rx.search(s):
            return gsjs.trim(rx.sub("", s, count=1))
    return s


def _contact_lines(contacts: Any) -> list[str]:
    return [x for x in (gsjs.trim(s) for s in re.split(r"\n+", gsjs.or_text(contacts))) if x]


def guardian_from_contacts(contacts: Any) -> str:
    """parseGuardianFromContacts_."""
    for line in _contact_lines(contacts):
        if re.match(r"guardian", line, re.I) or re.search(r"guardianship", line, re.I):
            return strip_label(line, GUARDIAN_LABELS)
    return ""


def guardian_segment(contacts: Any) -> str:
    """guardianContactSegment_: cut at the next person's label."""
    for line in _contact_lines(contacts):
        if not re.match(r"guardian", line, re.I) and not re.search(r"guardianship", line, re.I):
            continue
        seg = line
        blank = re.sub(r"^guardian[^:]*:", lambda m: " " * len(m.group(0)), seg, count=1, flags=re.I)
        m = _NEXT_LABEL.search(blank)
        if m:
            seg = seg[:m.start()]
        return seg
    return ""


def email_whole(email: Any) -> bool:
    """ispEmailWhole_."""
    e = gsjs.or_text(email)
    dot = e.rfind(".")
    if "@" not in e or dot == -1:
        return False
    return e[dot + 1:].lower() in ISP_EMAIL_TLDS


def guardian_email_from(contacts: Any) -> str:
    m = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", guardian_segment(contacts))
    if not m:
        return ""
    email = re.sub(r"[.,;]+$", "", m.group(0))
    return email if email_whole(email) else ""


def guardian_phone_from(contacts: Any) -> str:
    m = re.search(r"(\+?1[\s.-]?)?\(?[0-9]{3}\)?[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}\b", guardian_segment(contacts), re.A)
    if not m:
        return ""
    digits = re.sub(r"[^0-9]", "", m.group(0))
    if len(digits) == 11 and digits[0] == "1":
        digits = digits[1:]
    return isp_phone(digits) if len(digits) == 10 else ""


def clean_guardian(raw: Any) -> str:
    """cleanGuardianName_."""
    s = gsjs.trim(gsjs.or_text(raw))
    if not s:
        return ""
    if re.search(r"person supported\s*/\s*family", s, re.I):
        return ""
    s = strip_label(s, GUARDIAN_LABELS)
    s = re.split(r"[" + _WS_CLASS + r"]+[-–—][" + _WS_CLASS + r"]+", s)[0]
    s = re.sub(r",\s+(his|her|their|who|and|a|the)\b[\s\S]*$", "", s, count=1, flags=re.I | re.A)
    s = re.sub(r"[.,;:" + _WS_CLASS + r"]+$", "", s)
    return s[:47] + "…" if len(s) > 48 else s


def short_supervision(raw: Any) -> str:
    s = gsjs.trim(gsjs.or_text(raw))
    if not s:
        return ""
    if re.search(r"24\s*/?\s*7|around.the.clock|constant", s, re.I):
        return "24/7 supervision"
    first = gsjs.trim(re.split(r"[.;\n]|\s+per\s+", s, flags=re.I)[0])
    return first[:35] + "…" if len(first) > 36 else first


def isp_bullets(text_: Any, max_n: int = 8, cap: int = 64) -> list[str]:
    """ispBulletList_: split on newlines and bullets, never commas."""
    out = []
    for s in re.split(r"\n+|(?:^|[" + _WS_CLASS + r"])[•·][" + _WS_CLASS + r"]+", gsjs.or_text(text_)):
        s = gsjs.trim(re.sub(r"^[" + _WS_CLASS + r"•·\-–]+", "", s))
        if 3 < len(s) < 200:
            out.append(s[:cap - 1] + "…" if len(s) > cap else s)
    return out[:max_n]


def guardian_is_person(name: Any) -> bool:
    s = re.sub(r"[.]+$", "", gsjs.trim(gsjs.or_text(name)).lower())
    if not s or s in GUARDIAN_NON_PERSON:
        return False
    return not (re.match(r"(no|none|not)\b", s, re.A) and re.search(r"guardian|listed|applicable|assigned", s))


def guardian_display_name(raw: Any) -> str:
    s = clean_guardian(raw)
    s = re.sub(r"[" + _WS_CLASS + r"]*\([^)]*\)[" + _WS_CLASS + r"]*", " ", s)
    s = s.split(",")[0]
    return gsjs.trim(re.sub(r"[\s,;:.\-]+$", "", re.sub(r"[" + _WS_CLASS + r"]{2,}", " ", s)))


def isp_date(value: Any) -> str:
    v = gsjs.trim(gsjs.or_text(value))
    m = re.match(r"([A-Za-z]+)\s+([0-9]{1,2}),?\s+([0-9]{4})", v)
    if m and m.group(1).lower() in ISP_MONTHS:
        return f"{m.group(3)}-{ISP_MONTHS.index(m.group(1).lower()) + 1:02d}-{('0' + m.group(2))[-2:]}"
    m = re.match(r"([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})", v)
    if m:
        return f"{m.group(3)}-{('0' + m.group(1))[-2:]}-{('0' + m.group(2))[-2:]}"
    m = re.match(r"([0-9]{4}-[0-9]{2}-[0-9]{2})", v)
    return m.group(1) if m else v


def _id_digits(value: Any, max_len: int) -> str:
    d = re.sub(r"[^0-9]", "", gsjs.or_text(value))
    return "" if not d or len(d) < 4 or len(d) > max_len else d


def _cell_value(line: Any) -> str:
    s = gsjs.trim(gsjs.or_text(line))
    m = _CELL_LABEL.match(s)
    return gsjs.trim(m.group(2)) if m else s


def _email_glue(email: Any, nxt: Any) -> str:
    frag = gsjs.trim(gsjs.or_text(nxt))
    if not frag or len(frag) > 12 or not re.fullmatch(r"[A-Za-z0-9._\-]+", frag):
        return ""
    joined = gsjs.or_text(email) + frag
    return joined if email_whole(joined) else ""


def _role_line(line: Any) -> str:
    s = gsjs.trim(gsjs.or_text(line))
    if s in ISP_PEOPLE_ROLES:
        return s
    return s if re.match(r"Other\s*[-–—]\s*\S", s) else ""


def isp_people(block: Any) -> list[dict[str, str]]:
    """ispPeople_: the Important People table, one entry per Type cell."""
    b = gsjs.or_text(block)
    start = b.find("Important People")
    if start == -1:
        return []
    skip = ("Important People", "Type", "Name/Relationship", "Address", "Phone")
    lines = [s for s in (gsjs.trim(x) for x in b[start:].split("\n")) if s and re.sub(r":$", "", s) not in skip]
    people: list[dict[str, str]] = []
    cur: dict[str, str] | None = None
    wrapped: dict[str, str] | None = None
    for ln in lines:
        if _role_line(ln):
            if cur is not None and not cur["name"]:
                cur["role"] = cur["role"] + " — " + ln
                continue
            cur = {"role": ln, "name": "", "address": "", "email": "", "phone": ""}
            people.append(cur)
            wrapped = None
            continue
        if cur is None:
            continue
        val = _cell_value(ln)
        if wrapped is cur:
            wrapped = None
            whole = _email_glue(cur["email"], val)
            if whole:
                cur["email"] = whole
                continue
        if re.fullmatch(r"[0-9().+\-" + _WS_CLASS + r"]{7,}", val):
            if not cur["phone"]:
                cur["phone"] = val
        elif "@" in val:
            if not cur["email"]:
                cur["email"] = val
                wrapped = None if email_whole(val) else cur
        elif not cur["name"]:
            cur["name"] = val
        else:
            cur["address"] = gsjs.trim(cur["address"] + " " + val)
    return people


def _guardian_from_consent(text_: str, client_name: str) -> str:
    m = re.search(r"Person Supported/Family/Guardian:\s*([^\n\r  ]+)", text_)
    if not m:
        return ""
    who = re.sub(r"[.,;]+$", "", gsjs.trim(m.group(1)))
    if not who:
        return ""
    return "Self" if name_key(who) == name_key(client_name) else who


def demographics(block: Any, client_name: str) -> dict[str, str]:
    """ispDemographics_: read off the plan's Contact Information page; nothing invented."""
    text_ = gsjs.or_text(block)
    if not text_:
        return {}
    lad = L._ladder(text_)
    people = isp_people(text_)

    def matching(needles: tuple) -> dict[str, str]:
        for p in people:
            hay = (p["role"] + " " + p["name"]).lower()
            if any(n in hay for n in needles):
                return p
        return {}

    ssa = matching(("ssa", "case manager", "support administrator"))
    guardian = matching(("guardian",))
    emergency = matching(("emergency",))
    street = lad.get("Address") or ""
    csz = (lad.get("City, State, Zip") or "").replace(" ,", ",", 1)
    home = re.sub(r",$", "", gsjs.trim(re.sub(r"[" + _WS_CLASS + r"]+", " ", ", ".join(x for x in (street, csz) if x))))
    return {"dob": isp_date(lad.get("Date of Birth") or ""), "home_address": home, "county": lad.get("County") or "",
            "client_phone": isp_phone(lad.get("Phone") or ""), "client_email": lad.get("Email") or "",
            "sex": lad.get("Sex") or "", "marital_status": lad.get("Status") or "",
            "medicaid_id": _id_digits(lad.get("Medicaid #"), 12), "dodd_id": _id_digits(lad.get("DODD #"), 9),
            "funding_source": lad.get("Funding Sources") or "", "best_contact": lad.get("Best way to connect") or "",
            "guardian_name": guardian.get("name") or _guardian_from_consent(text_, client_name),
            "guardian_phone": isp_phone(guardian.get("phone") or ""), "guardian_email": guardian.get("email") or "",
            "ssa_name": ssa.get("name") or "", "ssa_phone": isp_phone(ssa.get("phone") or ""),
            "ssa_email": ssa.get("email") or "", "emergency_name": emergency.get("name") or "",
            "emergency_phone": isp_phone(emergency.get("phone") or "")}


def _care_from_isp(r: dict) -> dict[str, str]:
    personal = gsjs.trim(gsjs.or_text(r.get("personal_care")))
    mobility = gsjs.trim(gsjs.or_text(r.get("mobility")))
    daily = ""
    if personal:
        daily += "Personal care\n" + personal
    if mobility:
        daily += ("\n\n" if daily else "") + "Mobility\n" + mobility
    return {"care_communication": gsjs.trim(gsjs.or_text(r.get("communication"))),
            "care_safety": gsjs.trim(gsjs.or_text(r.get("safety_risks"))), "care_daily_living": daily,
            "care_behavioral": gsjs.trim(gsjs.or_text(r.get("behaviors"))),
            "care_nutrition": gsjs.trim(gsjs.or_text(r.get("diet_nutrition")))}


def normalize_row(row: dict) -> dict:
    """normalizeClientRow_."""
    for k in ("appointments", "recentAppointments", "notes"):
        if not isinstance(row.get(k), list):
            row[k] = []
    for k, n in (("conditions", 8), ("allergies", 6), ("medications", 10)):
        if not isinstance(row.get(k), list):
            row[k] = isp_bullets(row.get(k), n)
    row["conditionCount"] = len(row["conditions"])
    row["medCount"] = len(row["medications"])
    row["upcomingAppts"] = len(row["appointments"])
    if not gsjs.falsy(row.get("guardianName")):
        row["guardianName"] = clean_guardian(row["guardianName"])
    if gsjs.falsy(row.get("guardianName")) and not gsjs.falsy(row.get("contacts")):
        row["guardianName"] = clean_guardian(guardian_from_contacts(row["contacts"]))
    row["supervisionShort"] = short_supervision(row.get("supervision_level"))
    return row


def cleared_apply(row: dict) -> dict:
    """clientClearedApply_."""
    for col in edit_cleared(row.get("cleared_fields")):
        if col in SAVE_FIELDS:
            for c in FIELD_NAMES.get(col, (col,)):
                row[c] = ""
    return row


# ---- the books ---------------------------------------------------------------------------------------------------

def _hub(reads: L.Reads, tab: str) -> list[dict]:
    """listRows_ of a Hub tab (readAll_), once per request; the clients tab's cells are text, as getValues hands them."""
    policy = TEXT_TABS.get(tab, "hub")

    def read() -> list[dict]:
        import sheet_resources  # noqa: PLC0415 — it imports this module's neighbours
        kept = sheet_resources.kept_rows(reads, tab)
        if kept is not None:
            return kept
        res = reads.db.resolve(tab)
        if res.runtime:
            raise Defer(f"{tab} lives in the depot's facts")
        if res.ref is None and not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
        if res.ref is None:
            return []
        out = []
        for _rn, raw in reads.db.rows(res.ref):
            vals = [hubdb.typed(raw.get(h), policy) for h in res.ref.headers]
            if all(v == "" or v is None for v in vals):
                continue
            out.append({h: hubdb.cell_text(v) for h, v in zip(res.ref.headers, vals) if h != ""})
        return out
    return reads.once("cp_hub:" + tab, read)


def own_rows(reads: L.Reads, tab: str) -> list[dict]:
    """cpOwnRows_: a Hub tab of ours as locationsTabRows_ reads it; none while it has not been made; a tab an app keeps
    in Postgres read from there once uploaded."""
    def read() -> list[dict]:
        import sheet_resources  # noqa: PLC0415 — it imports this module's neighbours
        kept = sheet_resources.kept_rows(reads, tab)
        if kept is not None:
            return kept
        res = reads.db.resolve(tab)
        if res.runtime:
            raise Defer(f"{tab} lives in the depot's facts")
        if res.ref is None and not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
        return reads.db.locations_rows(res.ref)
    return reads.once("cp_own:" + tab, read)


def estate(reads: L.Reads, resource: str) -> list[dict]:
    """estateRows_: one estate book's tab, header-keyed; no tab, no rows."""
    if resource in L.ESTATE_SOURCES:
        return reads.estate(resource)

    def read() -> list[dict]:
        if DB.held(reads, resource):
            got = DB.kept(reads, resource)
            return reads.db.estate_rows(got, got.rows)
        prop, tab = ESTATE[resource]
        sid = reads.db.prop(prop)
        if not sid:
            raise hubdb.Unreadable(f"no {prop} is declared in the depot")
        return reads.db.estate_rows(reads.tab_of(sid, tab, f"the estate's {tab}"))
    return reads.once("cp_estate:" + resource, read)


def client_files(reads: L.Reads) -> list[dict]:
    """cfxSheetRows_: client_files without its OCR and digest columns, in sheet order."""
    def read() -> list[dict]:
        if HT.tabled("client_files"):
            headers, rows = HT.raw(reads, "client_files")
        else:
            res = reads.db.resolve("client_files")
            if res.ref is None:
                if not res.book_known:
                    raise hubdb.Unreadable("asa-hub-db holds no copy of the book behind client_files")
                return []
            headers, rows = list(res.ref.headers), reads.db.rows(res.ref)
        cols = [h for h in CFX_COLS if h in headers]
        out = []
        for rn, raw in rows:
            vals = {h: hubdb.typed(raw.get(h), "hub") for h in cols}
            if all(v == "" or v is None for v in vals.values()):
                continue
            o = {h: hubdb.cell_text(v) for h, v in vals.items()}
            o["_row"] = rn
            out.append(o)
        return out
    return reads.once("cp_client_files", read)


def files_for(reads: L.Reads, key: str, nk: str) -> list[dict]:
    """clientFilesFor_ with the reader's own match: this key's rows and every row carrying this folded name."""
    return [r for r in client_files(reads)
            if gsjs.or_text(r.get("client_key")) == key or name_key(r.get("client_name")) == nk]


def book_index_from(values: list[list[Any]]) -> dict[str, Any]:
    """cpBookIndexFrom_: { key → { name, fields, mask } }, only the mapped columns, dates as days, phones shaped."""
    index: dict[str, Any] = {"rows": {}, "order": []}
    if not values or len(values) < 2:
        return index
    head = [fold(h) for h in values[0]]
    for line in values[1:]:
        line = line or []
        fields: dict[str, str] = {}
        raw: dict[str, Any] = {}
        for c, h in enumerate(head):
            v = line[c] if c < len(line) else None
            if v == "" or v is None:
                continue
            if h in BOOK_MASKED:
                raw[BOOK_MASKED[h]] = v
                continue
            f = BOOK_FIELDS.get(h)
            if not f or fields.get(f):
                continue
            if isinstance(v, SheetDate):
                v = v.at.astimezone(NY).strftime("%Y-%m-%d")
            elif isinstance(v, hubdb.SheetTime):
                v = "1899-12-30"
            s = gsjs.text(v, 500)
            if f in BOOK_DATES:
                s = cp_day(s) or s
            if f in BOOK_PHONES:
                s = cp_phone(s)
            if s:
                fields[f] = s
        mask = mask_of(raw)
        # the masked cells the copy holds only as a marker: their figures are not in it
        withheld = sorted(k for k, v in raw.items()
                          if isinstance(v, str) and v.startswith(COPY_MARKER) and kept_of(v) is None)
        key = name_key(fields.get("name"))
        if not key:
            continue
        if key in index["rows"]:
            index["rows"][key] = {"name": fields.get("name"), "key": key, "ambiguous": True, "fields": {},
                                  "mask": mask_of({}), "withheld": []}
            continue
        index["rows"][key] = {"name": fields.get("name"), "key": key, "ambiguous": False, "fields": fields,
                              "mask": mask, "withheld": withheld}
        index["order"].append(key)
    return index


def book_index(reads: L.Reads, sid: str, tab: str) -> dict[str, Any]:
    """cpBookIndex_: one client book tab, masked; throws when the book has no such tab (money cells are numbers there)."""
    def read() -> dict[str, Any]:
        ref = reads.tab_of(sid, tab, f"the client book's {tab}")
        if ref is None:
            raise RuntimeError("the book has no " + tab + " tab")
        grid = reads.db.grid(ref)
        return book_index_from([list(grid[0])] + [[hubdb.typed(v, "estate") for v in line] for line in grid[1:]])
    return reads.once(f"cp_book:{sid}:{tab}", read)


def client_db_id(reads: L.Reads) -> str:
    return reads.prop_book(CLIENT_DB_PROP, CLIENT_DB_FALLBACK)


def master_index(reads: L.Reads) -> dict[str, Any]:
    return book_index(reads, client_db_id(reads), MASTER_TAB)


def archive_index(reads: L.Reads) -> dict[str, Any]:
    return book_index(reads, client_db_id(reads), ARCHIVE_TAB)


def master_data_index(reads: L.Reads) -> dict[str, Any]:
    sid = reads.db.prop(MASTER_DATA_PROP)
    if not sid:
        raise RuntimeError(MASTER_DATA_PROP + " is not set")
    return book_index(reads, sid, MASTER_DATA_TAB)


def photo_index(reads: L.Reads) -> dict[str, str]:
    """clientPhotoIndex_: an avatar only when exactly one photo carries the full name."""
    def read() -> dict[str, str]:
        rows, _why = _soft(lambda: _hub(reads, "photos"))
        if rows is None:
            return {}
        count: dict[str, int] = {}
        src: dict[str, str] = {}
        for r in rows:
            if gsjs.or_text(r.get("kind")) != "avatar" or gsjs.or_text(r.get("hidden")).lower() == "true":
                continue
            k = name_key(r.get("title"))
            if not k or not gsjs.or_text(r.get("src")):
                continue
            count[k] = count.get(k, 0) + 1
            src[k] = gsjs.or_text(r.get("src"))
        return {k: v for k, v in src.items() if count[k] == 1}
    return reads.once("cp_photos", read)


def people_index(reads: L.Reads) -> dict[str, Any]:
    """cpPeopleIndex_."""
    def read() -> dict[str, Any]:
        by_id: dict[str, dict] = {}
        by_key: dict[str, list[dict]] = {}
        for p in _hub(reads, "people"):
            pid = gsjs.or_text(p.get("id"))
            if pid:
                by_id[pid] = p
            k = name_key(p.get("name"))
            if k:
                by_key.setdefault(k, []).append(p)
        return {"by_id": by_id, "by_key": by_key}
    return reads.once("cp_people", read)


def person_id(people: dict | None, name: Any, prefer: str = "") -> str:
    """cpPersonId_."""
    if not people:
        return ""
    if prefer and prefer in people["by_id"]:
        return prefer
    hits = people["by_key"].get(name_key(name)) or []
    return gsjs.or_text(hits[0].get("id")) if len(hits) == 1 else ""


def isp_files(reads: L.Reads) -> list[dict]:
    """ispDocIndex_: the plans folder's files, held six hours; Drive not listing it is Apps Script's to answer."""
    def read() -> list[dict] | Defer:
        try:
            drv = reads.need_drive()
        except Defer as exc:
            return exc
        folder = reads.db.prop("ISP_DOCS_FOLDER_ID")
        held = _ISP_HELD
        if held["folder"] == folder and held["at"] and time.time() - held["at"] < ISP_INDEX_TTL_S:
            return held["files"]
        try:
            files = [{"id": f["id"], "name": f["name"]} for f in drv.children(folder, False, "id,name")]
        except Exception as exc:  # noqa: BLE001 - here a refusal is the credentials', not the folder's
            return Defer(f"Drive did not list the plans folder ({type(exc).__name__})")
        _ISP_HELD.update(at=time.time(), folder=folder, files=files)
        return files
    # a refusal is held for the request too: one Drive round trip, however many doors ask
    got = reads.once("cp_isp_files", read)
    if isinstance(got, Defer):
        raise Defer(str(got))
    return got


def isp_doc(reads: L.Reads, client_name: Any) -> dict[str, str]:
    """ispDocFor_: the one plan file whose name holds the client's, else every word of a file name in theirs."""
    key = name_key(client_name)
    empty = {"id": "", "name": "", "url": ""}
    if not key:
        return empty
    files = isp_files(reads)
    hits = [f for f in files if key in name_key(f["name"])]
    if not hits:
        own = dr.name_words(client_name)
        for f in files:
            want = dr.name_words(f["name"])
            if want and all(w in own for w in want):
                hits.append(f)
    if len(hits) != 1:
        return empty
    return {"id": hits[0]["id"], "name": hits[0]["name"],
            "url": "https://drive.google.com/file/d/" + hits[0]["id"] + "/view"}


def _appt_bucket(day: str, status: str, today: str, floor: str) -> str:
    """apptBucket_."""
    st = gsjs.or_text(status).lower()
    if day and day < today:
        if st in ("cancelled", "canceled"):
            return ""
        return "recent" if day >= floor else ""
    if st and st not in ("scheduled", "rescheduled"):
        return ""
    return "upcoming"


def _appt_window(reads: L.Reads) -> tuple[str, str]:
    def read() -> tuple[str, str]:
        tz_name = gsjs.str_(reads.config().get("hiring_timezone")) or "America/New_York"
        try:
            from zoneinfo import ZoneInfo  # noqa: PLC0415
            zone = ZoneInfo(tz_name)
        except Exception:  # noqa: BLE001 - an unknown zone reads as the platform's own
            zone = NY
        local = reads.now.astimezone(NY)
        today = reads.now.astimezone(zone).strftime("%Y-%m-%d")
        back = local - timedelta(days=RECENT_APPT_DAYS)
        return today, back.astimezone(zone).strftime("%Y-%m-%d")
    return reads.once("cp_appt_window", read)


def appt_buckets(reads: L.Reads, client_name: str) -> dict[str, list[dict]]:
    """clientApptBucketsFromDrTab_: the client's booked visits, upcoming and of the last sixty days."""
    nk = name_key(client_name)
    today, floor = _appt_window(reads)
    upcoming: list[dict] = []
    recent: list[dict] = []

    def index() -> dict[str, list[dict]]:
        def read() -> dict[str, list[dict]]:
            by: dict[str, list[dict]] = {}
            for r in estate(reads, "drVisits"):
                k = name_key(gsjs.trim(gsjs.or_text(r.get("client_name"))))
                if k:
                    by.setdefault(k, []).append(r)
            return by
        return reads.once("cp_appt_index", read)

    def fill() -> None:
        for r in index().get(nk) or []:
            day = gsjs.trim(gsjs.or_text(r.get("appointment_date")))
            if not day:
                continue
            doctor = gsjs.trim(gsjs.or_text(r.get("dr_name")))
            appt = {"id": gsjs.or_text(r.get("id")) or "appt-" + str(len(upcoming) + len(recent)), "date": day,
                    "time": gsjs.trim(gsjs.or_text(r.get("appointment_start_time"))), "title": doctor or "Doctor visit",
                    "doctor": doctor, "location": gsjs.or_text(r.get("appointment_address")),
                    "notes": "Wheelchair van required" if re.match(r"y", gsjs.or_text(r.get("wheelchair_van_required")),
                                                                   re.I) else "",
                    "status": gsjs.or_text(r.get("upcoming"))}
            bucket = _appt_bucket(appt_day(day), "", today, floor)
            if bucket == "upcoming":
                upcoming.append(appt)
            elif bucket == "recent":
                recent.append(appt)

    _soft(fill)
    upcoming.sort(key=by_name(lambda a: gsjs.js_str(a["date"])))
    recent.sort(key=functools.cmp_to_key(lambda a, b: gsjs.locale_cmp(gsjs.js_str(b["date"]), gsjs.js_str(a["date"]))))
    return {"upcoming": upcoming, "recent": recent}


def _detail_from_isp(reads: L.Reads, r: dict, docs: bool) -> dict[str, Any]:
    """clientDetailFromIsp_: the chart the row carries."""
    conditions = isp_bullets(r.get("diagnoses"), 8, 56)
    allergies = isp_bullets(r.get("allergies"), 6, 56)
    medications = isp_bullets(r.get("medications"), 10, 72)
    contacts = gsjs.trim(gsjs.or_text(r.get("contacts")))
    guardian = clean_guardian(guardian_from_contacts(contacts))
    client_name = gsjs.or_text(r.get("client_name"))
    appts = appt_buckets(reads, client_name)

    def t(k: str) -> str:
        return gsjs.trim(gsjs.or_text(r.get(k)))

    out: dict[str, Any] = {
        "clientNumber": t("client_key"), "conditions": conditions, "conditionCount": len(conditions),
        "allergies": allergies, "medications": medications, "medCount": len(medications),
        "upcomingAppts": len(appts["upcoming"]), "guardianName": guardian, "contacts": contacts,
        "isp_year": gsjs.or_text(r.get("isp_year")), "goals_outcomes": t("goals_outcomes"),
        "important_to": t("important_to"), "important_for": t("important_for"), "appointments": appts["upcoming"],
        "recentAppointments": appts["recent"], "summary": t("medical_summary"), "source_file": t("source_file"),
        "allergies_text": t("allergies"), "diagnoses_text": t("diagnoses"), "medications_text": t("medications"),
        "notes": []}
    out.update(_care_from_isp(r))
    out.update(demographics(r.get("contact_block"), client_name))
    if not out.get("guardian_email"):
        out["guardian_email"] = guardian_email_from(contacts)
    if not out.get("guardian_phone"):
        out["guardian_phone"] = guardian_phone_from(contacts)
    if docs:
        doc = isp_doc(reads, client_name)
        out["isp_doc_url"] = doc["url"]
        out["isp_doc_name"] = doc["name"]
    return out


def derived(reads: L.Reads) -> list[dict]:
    """clientsDerived_(null): the plans, the Hub's clients rows layered on top; isp_doc_* only where Drive answers."""
    def read() -> list[dict]:
        try:
            docs = isp_files(reads) is not None
        except Defer:
            docs = False
        photos = photo_index(reads)
        rows: dict[str, dict] = {}
        for r in _hub(reads, "isps"):
            key = gsjs.trim(gsjs.or_text(r.get("client_key")))
            if not key:
                continue
            row = {"id": "CLI_" + key, "name": gsjs.or_text(r.get("client_name")) or key,
                   "avatar": photos.get(name_key(r.get("client_name"))) or "", "client_key": key,
                   "isp_year": gsjs.or_text(r.get("isp_year")), "supervision_level": gsjs.or_text(r.get("supervision_level")),
                   "status": "active", "source": "isp"}
            row.update(_detail_from_isp(reads, r, docs))
            rows[key] = normalize_row(row)
        try:
            for r in _hub(reads, "clients"):
                key = gsjs.trim(gsjs.or_text(r.get("client_key"))) or name_key(r.get("name"))
                if not key:
                    continue
                merged = dict(rows.get(key) or {})
                for k2, v in r.items():
                    if gsjs.or_text(v) != "":
                        merged[k2] = v
                if gsjs.falsy(merged.get("id")):
                    merged["id"] = gsjs.or_text(r.get("id")) or "CLI_" + key
                rows[key] = cleared_apply(normalize_row(merged))
        except (hubdb.Unreadable, Defer):
            raise
        except Exception:  # noqa: BLE001 - as the port: the plans still stand without the Hub rows
            pass
        out = list(rows.values())
        # a photo uploaded on the client's page stands over the books' own
        kept = P.newest(reads, "clients")
        for c in out:
            got = kept.get(gsjs.trim(gsjs.or_text(c.get("client_key"))))
            if got:
                c["avatar"] = got
        out.sort(key=by_name(lambda c: gsjs.js_str(c.get("name"))))
        return out
    return reads.once("cp_derived", read)


# ---- who reads, and which client -------------------------------------------------------------------------------------

def reader(sess: L.Session) -> dict | None:
    """clientProfilesReader_: { kind, keys } — the master, every client, or the reader's own; None when shut."""
    def read() -> dict | None:
        user = sess.user
        if not user or user.get("is_service"):
            return None
        if sc.is_real_master(user):
            return {"kind": "master", "keys": None}
        gate = sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources())
        s = gate.get("scope") if gate.get("open") is True else None
        if not s:
            return None
        if s.get("kind") == "all":
            return {"kind": "all", "keys": None}
        if s.get("kind") not in SCOPED:
            return None
        keys: dict[str, bool] = {}
        for k in s.get("client_keys") or []:
            key = gsjs.trim(gsjs.or_blank(k))
            if key and key not in keys:
                keys[key] = True
        return {"kind": s["kind"], "keys": keys} if keys else None
    return sess.reads.once("cp_reader", read)


def reader_for(sess: L.Session, client: Any) -> dict | None:
    """clientProfilesReaderFor_: the reader for one client; None outside their scope."""
    r = reader(sess)
    if not r or not r.get("keys"):
        return r
    return r if r["keys"].get(gsjs.trim(gsjs.or_blank(client))) is True else None


def own_only(rdr: dict | None) -> bool:
    """clientProfilesOwnOnly_: a client, an SSA or a family member reads their own record, without the notes (the
    operator's sheet gives the SSA and Family columns the same Clients cells)."""
    return bool(rdr) and rdr.get("kind") in ("client", "guardian", "ssa")


def transport_open(sess: L.Session) -> bool:
    """Clients › Transportation (TRANSPORT_FEATURE), FAIL-CLOSED: the master always, before any row is read; else a
    badge the row names, or a holder of TRANSPORT_EDITION. A viewer the row could match only on the SSA records
    (GUARDIAN worn) is not opened by it; the client stays the reader's to ask."""
    if sc.is_real_master(sess.user):
        return True

    def read() -> bool:
        try:
            if sc.profile_app_gate(TRANSPORT_FEATURE, sess.user, sess.reads.scope_sources()).get("open") is True:
                return True
        except Defer:
            pass
        return sc.edition_allows(TRANSPORT_EDITION, sess.user or {}, sess.reads.config())
    return sess.reads.once("cp_transport", read)


def client_ctx(reads: L.Reads, raw: Any) -> dict[str, Any]:
    """clientProfilesClient_: clientsDerived_ by exact key, else the archive of old clients by its key."""
    key = gsjs.trim(gsjs.or_blank(raw))
    if not key or not re.fullmatch(r"[A-Za-z0-9_.\-]{1,120}", key):
        return {"refused": {"status": 400, "message": "client: the client key the roster gives."}}
    rows, why = _soft(lambda: derived(reads))
    if rows is None:
        return {"refused": {"status": 503, "message": f"The clients could not be read just now ({why})."}}
    row = next((c for c in rows if (gsjs.trim(gsjs.or_text(c.get("client_key"))) or name_key(c.get("name"))) == key),
               None)
    if row is not None:
        return {"key": key, "name": gsjs.text(row.get("name")), "row": row, "archived": False, "all": rows}
    arch, why_a = _soft(lambda: archive_index(reads))
    if arch is None:
        return {"refused": {"status": 503, "message": f"The clients archive could not be read just now ({why_a})."}}
    hit = arch["rows"].get(key)
    if hit and not hit["ambiguous"]:
        fields = dict(hit["fields"])
        fields["client_key"] = key
        fields["status"] = "inactive"
        return {"key": key, "name": hit["name"], "row": fields, "archived": True, "archive_mask": hit["mask"],
                "all": rows}
    return {"refused": {"status": 404, "message": f'No client "{key}" is on file.'}}


def roster_row(c: dict, photos: dict | None) -> dict[str, Any]:
    """cpRosterRow_: identity only."""
    name = gsjs.text(c.get("name"))
    return {"client_key": gsjs.trim(gsjs.or_text(c.get("client_key"))) or name_key(name),
            "client_id": gsjs.or_text(c.get("id")), "name": name, "status": "active" if client_live(c) else "inactive",
            "house": gsjs.text(_or(c.get("house"), c.get("houseName"))),
            "avatar": gsjs.or_text(_or(c.get("avatar"), (photos or {}).get(name_key(name)) if photos else None, "")),
            "isp_year": gsjs.text(c.get("isp_year"))}


def with_self_email(reads: L.Reads, out: dict[str, Any]) -> dict[str, Any]:
    """A client who is their own guardian carries their own e-mail, which Client Details draws as the guardian's."""
    own: dict[str, str] = {}
    rows, _w = _soft(lambda: derived(reads))
    for c in rows or []:
        if gsjs.text(_or(c.get("guardianName"), c.get("guardian_name"))).strip().lower() == "self" and c.get("client_email"):
            own[gsjs.trim(gsjs.or_text(c.get("client_key"))) or name_key(c.get("name"))] = gsjs.text(c.get("client_email"))
    out["clients"] = [{**c, "self_email": own[c["client_key"]]} if c.get("client_key") in own else c
                      for c in out.get("clients") or []]
    return out


def isp_row(reads: L.Reads, key: str) -> dict | None:
    """cpIspRow_."""
    return next((r for r in _hub(reads, "isps") if gsjs.trim(gsjs.or_text(r.get("client_key"))) == key), None)


def sections_for(reads: L.Reads, key: str) -> list[dict]:
    """cpSectionsFor_."""
    return [r for r in own_rows(reads, SECTIONS_TAB) if gsjs.or_text(r.get("client_key")) == key]


def overrides_for(reads: L.Reads, key: str, kind: str) -> list[dict]:
    """cpOverridesFor_: this client's override rows of one kind, oldest first."""
    return [r for r in own_rows(reads, OVERRIDES_TAB)
            if gsjs.or_text(r.get("client_key")) == key and gsjs.or_text(r.get("kind")) == kind]


def reviews_for(reads: L.Reads, key: str) -> dict[str, dict]:
    """cpReviewsFor_: the newest review per id."""
    by: dict[str, dict] = {}
    for r in own_rows(reads, REVIEWS_TAB):
        if gsjs.or_text(r.get("client_key")) != key:
            continue
        rid = gsjs.or_text(r.get("id"))
        if rid and (rid not in by or gsjs.or_text(r.get("at")) >= gsjs.or_text(by[rid].get("at"))):
            by[rid] = r
    return by


# ---- the plan's sections (the cut the intake files) --------------------------------------------------------------

def plan_lines(raw: Any) -> list[str]:
    """cpPlanLines_: the plan text without its page furniture."""
    out = []
    for line in gsjs.or_text(raw).replace("\r", "").replace("HCBS -", "").split("\n"):
        s = gsjs.trim(line)
        if not s:
            continue
        if re.match(r"OhioISP\s*-\s", s, re.I) or re.fullmatch(r"Page\s+[0-9]+(\s+of\s+[0-9]+)?", s, re.I):
            continue
        if re.match(r"ISP Span Dates\s*:", s, re.I) or re.match(r"Effective Date\s*:", s, re.I):
            continue
        if re.match(r"Last revised\b", s, _A) or re.match(r"HCBS\b", s, _A) or re.fullmatch(r"[0-9]{1,3}", s):
            continue
        out.append(s)
    return out


def _blocks(text_: str, spec: dict) -> list[str]:
    """cpBlocks_: every block a start heading opens, up to the next section heading."""
    out: list[str] = []
    rx = spec["start"]
    for m in rx.finditer(text_):
        g1 = m.group(1) or ""
        head_at = m.start() + len(g1)
        frm = head_at if spec.get("keep_head") else m.end()
        rest = text_[frm:]
        skip = len(m.group(0)) - len(g1) if spec.get("keep_head") else 0
        body = rest
        if not spec.get("tail"):
            stop = _STOP_RE.search(rest[skip:])
            if stop:
                body = rest[:skip + stop.start()]
        body = verbatim(re.sub(r"^\s*:?\s*", "", body, count=1), SECTION_MAX)
        content = gsjs.trim(rx.sub("", body, count=1)) if spec.get("keep_head") else body
        if len(content) >= 3:
            out.append(body)
        if not spec.get("many") and out:
            break
    return out


def _sentences(lines: list[str]) -> list[str]:
    """cpSentences_: the plan's sentences, questions dropped."""
    segments: list[list[str]] = []
    cur: list[str] = []
    bullet = r"^[" + _BULLETS + r"]\s*"
    for ln in lines:
        if _HEADING_RE.search(ln):
            if cur:
                segments.append(cur)
            cur = []
            continue
        if re.match(bullet, ln) and cur:
            segments.append(cur)
            cur = []
        cur.append(re.sub(bullet, "", ln, count=1))
    if cur:
        segments.append(cur)
    out = []
    for seg in segments:
        whole = gsjs.trim(re.sub(r"\s+", " ", " ".join(seg)))
        for s in re.findall(r"[^.!?]+(?:[.!?]+[\"')\]]*|$)", whole):
            t = gsjs.trim(s)
            if len(t) < 8 or re.search(r"\?[\"')\]]*$", t):
                continue
            out.append(t)
    return out


def isp_cut(raw: Any) -> dict[str, Any]:
    """clientProfileIspCut_: raw plan text → verbatim section rows, and the sections it does not carry."""
    lines = plan_lines(raw)
    text_ = "\n".join(lines)
    rows: list[dict] = []
    absent: list[str] = []
    sentences = _sentences(lines)
    for section, label, rx in ROUTINES:
        hits: list[str] = []
        for s in sentences:
            if rx.search(s) and s not in hits:
                hits.append(s)
        if hits:
            rows.append({"section": section, "record": label, "text": "\n".join(hits)[:SECTION_MAX]})
        else:
            absent.append(section)
    for spec in PLAN_SECTIONS:
        blocks = _blocks(text_, spec)
        if not blocks:
            absent.append(spec["section"])
            continue
        for b in blocks:
            record = spec["label"]
            if spec["section"] == "services":
                first = gist(re.sub(r"^(Paid Supports|Funding Source)\s*:\s*", "", b, count=1, flags=re.I))
                if first:
                    record = first[:80]
            rows.append({"section": spec["section"], "record": record, "text": b})
    return {"rows": rows, "absent": absent}


# ---- Roster -----------------------------------------------------------------------------------------------------------

def roster_build(reads: L.Reads, with_inactive: bool) -> dict[str, Any]:
    """cpRosterBuild_."""
    photos, _w = _soft(lambda: photo_index(reads))
    photos = photos or {}
    seen: dict[str, bool] = {}
    clients = []
    for c in derived(reads):
        r = roster_row(c, photos)
        if not r["client_key"] or seen.get(r["client_key"]):
            continue
        seen[r["client_key"]] = True
        if with_inactive or r["status"] == "active":
            clients.append(r)
    why, degraded = "", False
    if with_inactive:
        def add_archive() -> None:
            arch = archive_index(reads)
            names = {name_key(r["name"]): True for r in clients}
            for k in arch["order"]:
                hit = arch["rows"].get(k)
                if not hit or hit["ambiguous"] or seen.get(k) or names.get(k):
                    continue
                seen[k] = True
                clients.append({"client_key": k, "client_id": "", "name": hit["name"], "status": "inactive",
                                "house": hit["fields"].get("house") or "", "avatar": P.of(reads, "clients", k, photos.get(k)),
                                "isp_year": ""})
        _ok, err = _soft(add_archive)
        if err:
            why, degraded = _why_of("the archive of old clients", err), True
    clients.sort(key=by_name(lambda c: c["name"]))
    return {"clients": clients, "inactive_why": why, "degraded": degraded}


def roster_for(data: dict, rdr: dict) -> dict[str, Any]:
    """cpRosterFor_: the reader's own clients when their scope names some, and who they read as."""
    out = dict(data or {})
    keys = rdr.get("keys")
    out["clients"] = [c for c in (data or {}).get("clients") or [] if not keys or keys.get(c.get("client_key")) is True]
    out["viewer"] = rdr.get("kind")
    return out


def roster_door(reads: L.Reads, with_inactive: bool, rdr: dict) -> dict[str, Any]:
    """cpRosterDoor_: past the gate — the switcher's answer, and the pack's roster_own."""
    part = "inactive" if with_inactive else "active"
    data, why = _soft(lambda: reads.once("cp_roster:" + part, lambda: scrub(roster_build(reads, with_inactive))))
    if data is None:
        return {"status": 503, "message": f"The clients could not be read just now ({why})."}
    return answer(with_self_email(reads, roster_for(data, rdr)))


# ---- Details ------------------------------------------------------------------------------------------------------

def sources_of(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """cpSources_: the client's rows in the Master (or the archive) and Master Data."""
    why: list[str] = []
    degraded = False
    master = tl = None
    nk = name_key(ctx["name"])
    if ctx.get("archived"):
        arch = archive_index(reads)["rows"].get(ctx["key"]) or {}
        master = {"fields": {}, "mask": ctx.get("archive_mask") or mask_of({}), "withheld": arch.get("withheld") or []}
    else:
        mi, err = _soft(lambda: master_index(reads))
        if mi is None:
            degraded = True
            why.append(_why_of("the Asa Client Database", err))
        else:
            master = mi["rows"].get(nk)
            if master and master["ambiguous"]:
                why.append("the Asa Client Database Master has two rows for " + ctx["name"])
                master = None
            elif not master:
                ai, _e = _soft(lambda: archive_index(reads)["rows"].get(nk))
                if ai and not ai["ambiguous"]:
                    master = ai
                else:
                    why.append("the Asa Client Database Master has no row for " + ctx["name"])
    ti, err_t = _soft(lambda: master_data_index(reads))
    tstale = False
    if ti is None:
        degraded = True
        why.append(_why_of("Master Data › " + MASTER_DATA_TAB, err_t))
    else:
        tl = ti["rows"].get(nk)
        if tl and tl["ambiguous"]:
            tl = None
        # stale only when Drive changed the book after its copy was made (HubDb.stale): the Hub reads its own tables,
        # so the copy's age says nothing, and no back end answers a deferred read any more
        tstale = reads.db.stale({reads.db.prop(MASTER_DATA_PROP)})
    return {"mf": (master or {}).get("fields") or {}, "tf": (tl or {}).get("fields") or {},
            "mask": (master or {}).get("mask") or mask_of({}), "tmask": (tl or {}).get("mask") or mask_of({}),
            "mwithheld": (master or {}).get("withheld") or [], "twithheld": (tl or {}).get("withheld") or [],
            "tstale": tstale, "why": why, "degraded": degraded}


def masked_unknown(src: dict) -> list[str]:
    """The masked figures the answer shows that the copy holds only as a marker."""
    mw, tw = set(src["mwithheld"]), set(src["twithheld"])
    out = sorted(mw & {"ssn", "dc_exp", "dc_security_code"})
    if "tl_card" in tw or (not src["tmask"]["tl_card_last4"] and "tl_card" in mw):
        out.append("tl_card")
    if "dc_pin" in mw or (not src["mask"]["dc_pin_on_file"] and "dc_pin" in tw):
        out.append("dc_pin")
    return out


def picker(c: dict | None, mf: dict, tf: dict, by_tf: list[str] | None = None) -> Callable[..., str]:
    """cpPicker_: the Hub row first, then the Master, then Master Data; a cleared column stays blank."""
    cleared = edit_cleared((c or {}).get("cleared_fields"))

    def pick(*names: str) -> str:
        if any(cleared.get(n) for n in names):
            return ""
        for src in (c or {}, mf, tf):
            if src is tf and by_tf is not None:
                by_tf.append(names[0])
            for n in names:
                v = gsjs.text(src.get(n), 500)
                if v:
                    return v
        return ""
    return pick


def start_day(pick: Callable[..., str]) -> str:
    """The day the person became a client of ASA Life Care: Client Details' Start Date, carried by the Home row too."""
    return cp_day(pick("start_date")) or pick("start_date")


def edit_columns() -> dict[str, str]:
    """cpEditColumns_: the save columns under the names the panel sends."""
    out = {col: col for col in SAVE_FIELDS}
    for k, col in SAVE_ALIASES.items():
        out.pop(col, None)
        out[k] = col
    return out


def edit_raw(pick: Callable[..., str]) -> dict[str, str]:
    """cpEditRaw_."""
    return {k: pick(*FIELD_NAMES.get(col, (col,))) for k, col in edit_columns().items()}


def status_word(ctx: dict) -> str:
    return "Active" if not ctx.get("archived") and L.client_current(ctx.get("row")) else "Inactive"


def family_of(reads: L.Reads, ctx: dict, isp: dict | None, people: dict | None) -> list[dict]:
    """cpFamily_: the filed Important People section, else the plan's contact page, with the Hub's corrections."""
    text_ = ""
    year = gsjs.text(isp.get("isp_year")) if isp else ""
    for r in sections_for(reads, ctx["key"]):
        if r.get("section") != "important_people":
            continue
        if not text_ or gsjs.js_str(r.get("isp_year")) == year:
            text_ = gsjs.or_text(r.get("text"))
    if not text_ and isp:
        text_ = gsjs.or_text(isp.get("contact_block"))
    seen: set[str] = set()
    own_key = name_key(ctx["name"])
    members = []
    for p in isp_people(text_):
        k = name_key(p["name"])
        if not k or k in seen or k == own_key:
            continue
        seen.add(k)
        members.append({"key": k, "name": gsjs.text(p["name"]), "relationship": gsjs.text(p["role"]),
                        "phone": cp_phone(p["phone"]), "email": gsjs.text(p["email"])})
    out: list[dict] = []
    mine = overrides_for(reads, ctx["key"], "family")
    by_target = {o["target"]: o for o in mine if o.get("target")}

    def put(m: dict, o: dict | None) -> None:
        if o:
            if o.get("state") == "removed":
                return
            m = {"key": m["key"], "name": gsjs.text(o.get("name")), "relationship": gsjs.text(o.get("relationship")),
                 "phone": cp_phone(o.get("phone")), "email": gsjs.text(o.get("email")), "edited": True}
            if not m["name"]:
                return
        m["person_id"] = person_id(people, m.get("name"))
        m["edit"] = {"name": m.get("name"), "relationship": m.get("relationship"), "phone": m.get("phone"),
                     "email": m.get("email"), "removed": ""}
        out.append(m)

    for m in members:
        put(m, by_target.get(m["key"]))
    for o in mine:
        if not o.get("target"):
            put({"key": gsjs.or_text(o.get("id"))}, o)
    return out


def details_build(reads: L.Reads, ctx: dict, strict: bool = True) -> dict[str, Any]:
    """cpDetailsBuild_ (masked figures only); strict=False is the Care team's read, which shows no plan file or mask."""
    c = ctx.get("row") or {}
    src = sources_of(reads, ctx)
    unknown_masks = masked_unknown(src)
    if strict and unknown_masks:
        raise Defer("the copy withholds the cells behind " + ", ".join(unknown_masks))
    why, degraded = src["why"], src["degraded"]
    by_tf: list[str] = []
    pick = picker(c, src["mf"], src["tf"], by_tf)
    mask, tmask = src["mask"], src["tmask"]
    # a value saved from the Hub (app.client_secrets) draws its own mask before the copies hold it
    import client_secrets as CSE  # noqa: PLC0415 - it reads this module
    saved, _why_s = _soft(lambda: CSE.latest(reads, ctx["key"]))
    if saved:
        mask = {**mask, **({"ssn_last4": saved["ssn"], "ssn_on_file": True} if "ssn" in saved else {}),
                **({"tl_card_last4": saved["tl_card"]} if "tl_card" in saved else {}),
                **({"dc_exp_on_file": True} if "dc_exp" in saved else {}),
                **({"dc_security_code_on_file": True} if "dc_security_code" in saved else {}),
                **({"dc_pin_on_file": True} if "dc_pin" in saved else {})}
        tmask = {**tmask, **({"tl_card_last4": saved["tl_card"]} if "tl_card" in saved else {})}
    today = reads.today()
    dob = cp_day(pick("dob"))
    house = pick("house", "houseName")
    code = L.house_code(house) or L.code_of(house)
    label = house
    houses: list[dict] = []
    homes, _wh = _soft(reads.homes)
    for h in homes or []:
        if code and h["code"] == code and h["home_name"]:
            label = h["home_name"]
        houses.append({"code": h["code"], "name": h["home_name"] or h["code"]})
    people, err_p = _soft(lambda: people_index(reads))
    if people is None and err_p:
        why.append(_why_of("the people roster", err_p))
    g_raw = pick("guardianName", "guardian_name")
    g_name = guardian_display_name(g_raw) if g_raw and guardian_is_person(g_raw) else g_raw
    g_id = "PPL_guardian_" + name_key(g_name) if g_name and guardian_is_person(g_name) else ""
    isp, err_i = _soft(lambda: isp_row(reads, ctx["key"]))
    if err_i:
        why.append(_why_of("the plans", err_i))
    doc, _wd = _soft(lambda: isp_doc(reads, ctx["name"])) if strict else (None, "")
    doc = doc or {"id": ""}
    family, err_f = _soft(lambda: family_of(reads, ctx, isp, people))
    if family is None:
        family = []
        if err_f:
            why.append(_why_of("the plan's important people", err_f))
    roster = roster_row(c, None)
    roster["status"] = "inactive" if ctx.get("archived") else roster["status"]
    roster["avatar"] = P.of(reads, "clients", ctx["key"], roster["avatar"])
    if not roster["avatar"]:
        got, _wa = _soft(lambda: gsjs.or_text(photo_index(reads).get(name_key(ctx["name"]))))
        roster["avatar"] = got or ""
    edit = edit_raw(pick)
    edit["name"] = gsjs.text(ctx["name"])
    edit["status"] = status_word(ctx)
    # Master Data always decides the TL card, and each column the Hub row and the Master leave blank
    if src["tstale"] and (strict or any(f in TEAM_FIELDS for f in by_tf)):
        raise Defer("Drive changed Master Data after the Hub's copy of it was made, and it decides this answer")
    return {
        "client": {"client_key": ctx["key"], "name": ctx["name"], "status": roster["status"], "house": house,
                   "avatar": roster["avatar"], "isp_year": roster["isp_year"], "client_number": pick("client_number"),
                   "initials": pick("initials") or initials_of(ctx["name"]), "dob": dob, "age": age_of(dob, today),
                   "email": pick("client_email")},
        "identity": {"ssn_last4": mask["ssn_last4"], "ssn_on_file": mask["ssn_on_file"],
                     "medicaid_id": pick("medicaid_id")},
        "home": {"house_code": code, "house_label": label, "home_address": pick("home_address"),
                 "house_manager": pick("house_manager"), "house_manager_phone": cp_phone(pick("house_manager_phone")),
                 "house_manager_email": pick("house_manager_email")},
        "guardian": {"name": g_name, "person_id": g_id if g_id and people and g_id in people["by_id"] else "",
                     "relationship": pick("guardian_relationship"), "email": pick("guardian_email"),
                     "address": pick("guardian_address"), "phone": cp_phone(pick("guardian_phone")),
                     "ssa_name": pick("ssa_name"), "ssa_person_id": person_id(people, pick("ssa_name")),
                     "ssa_email": pick("ssa_email"), "ssa_phone": cp_phone(pick("ssa_phone"))},
        "services": {"outcome": pick("outcome"), "ama_date": cp_day(pick("ama_date")) or pick("ama_date"),
                     "isp_year": roster["isp_year"] or gsjs.text(isp.get("isp_year") if isp else None),
                     "isp_file_id": gsjs.or_text(doc.get("id")),
                     "start_date": start_day(pick),
                     "self_admin_assessment": pick("self_admin_assessment"),
                     "self_admin_expires": cp_day(pick("self_admin_expires")) or pick("self_admin_expires"),
                     "media_release": pick("media_release"), "medical_supply": pick("medical_supply"),
                     "truelink_consent": pick("truelink_consent"), "guardianship_papers": pick("guardianship_papers")},
        "day": {"workshop": pick("workshop"), "workshop_phone": cp_phone(pick("workshop_phone")),
                "workshop_address": pick("workshop_address"), "transportation": pick("transportation"),
                "transportation_phone": cp_phone(pick("transportation_phone"))},
        "financial": {"payee_rep": pick("payee_rep"), "payee_rep_phone": cp_phone(pick("payee_rep_phone")),
                      "payee_rep_email": pick("payee_rep_email"),
                      "tl_card_last4": tmask["tl_card_last4"] or mask["tl_card_last4"],
                      "dc_exp_on_file": mask["dc_exp_on_file"], "dc_security_code_on_file": mask["dc_security_code_on_file"],
                      "dc_pin_on_file": mask["dc_pin_on_file"] or tmask["dc_pin_on_file"],
                      "food_stamp": pick("food_stamp"), "spending_limit": pick("spending_limit")},
        "family": family,
        "edit": edit,
        "houses": houses,
        "degraded": degraded,
        "why": "; ".join(why)}


def details_data(reads: L.Reads, ctx: dict, strict: bool = True) -> dict[str, Any]:
    """cpDetails_: the kept (scrubbed) details, once per request."""
    return reads.once(f"cp_details:{ctx['key']}:{int(strict)}", lambda: scrub(details_build(reads, ctx, strict)))


def details_door(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """cpDetailsDoor_ past the gate."""
    if ctx.get("refused"):
        return ctx["refused"]
    return answer(details_data(reads, ctx))


# ---- Care & Support -----------------------------------------------------------------------------------------------

def plan_file(r: dict | None) -> bool:
    """cpPlanFile_: labelled a plan, never an identity paper."""
    if not r or gsjs.trim(gsjs.or_text(r.get("digest_category"))).lower() == "identity" or \
            re.search(r"ssn|social.?security|identity|licen[cs]e|state_id|birth|passport", gsjs.or_text(r.get("doc_kind")),
                      re.I):
        return False
    label = " ".join(gsjs.or_text(r.get(k)) for k in ("title", "folder", "kind", "doc_kind", "subject"))
    return bool(re.search(r"\bisp\b|service plan|support plan|care plan|behavior(al)? support|self.?admin", label, _A))


def plan_docs(reads: L.Reads, ctx: dict, isp: dict | None, plan_source: str, plan_day: str,
              why: list[str]) -> list[dict]:
    """cpPlanDocs_: the filed plan, then the client's plan documents with Current / Expired."""
    rows: list[dict] = []
    today = reads.today()
    if isp:
        doc, _w = _soft(lambda: isp_doc(reads, ctx["name"]))
        doc = doc or {"id": ""}
        pages = isp.get("page_count")
        rows.append({"id": "isp_" + ctx["key"], "record": "Individual Service Plan " + gsjs.text(isp.get("isp_year")),
                     "date": plan_day,
                     "details": gsjs.text(isp.get("source_file")) + (" · " + gsjs.text(pages) + " pages"
                                                                     if not gsjs.falsy(pages) else ""),
                     "status": "Current", "source": plan_source, "file_id": gsjs.or_text(doc.get("id"))})
    nk = name_key(ctx["name"])

    def files() -> None:
        for r in files_for(reads, ctx["key"], nk):
            if not plan_file(r):
                continue
            exp = cp_day(r.get("expires_on"))
            rows.append({"id": gsjs.or_text(r.get("id")), "record": gsjs.text(r.get("title")) or gsjs.text(r.get("folder")),
                         "date": cp_day(r.get("issued_on")) or cp_day(r.get("file_date")),
                         "details": gsjs.text(r.get("folder")) + (" · expires " + exp if exp else ""),
                         "status": ("Expired" if exp < today else "Current") if exp else "No expiry on file",
                         "source": "Client files",
                         "file_id": gsjs.or_text(r.get("drive_id")) or L.drive_id(r.get("url"))})

    _ok, err = _soft(files)
    if err:
        why.append(_why_of("The client files", err) + ".")
    return rows


def team_of(reads: L.Reads, ctx: dict, why: list[str]) -> list[dict]:
    """cpTeam_: the record's people, the plan's important people and the client's doctors, one row a person."""
    d = details_data(reads, ctx, strict=False)
    people, _w = _soft(lambda: people_index(reads))
    out: list[dict] = []
    seen: dict[str, int] = {}

    def add(name: Any, rel: Any, phone: Any, email: Any, pid: Any, source: str) -> None:
        n = gsjs.text(name)
        k = name_key(n)
        if not k or not guardian_is_person(n):
            return
        if k in seen:
            had = out[seen[k]]
            if not had["phone"] and not gsjs.falsy(phone):
                had["phone"] = cp_phone(phone)
            if not had["email"] and not gsjs.falsy(email):
                had["email"] = gsjs.text(email)
            return
        i = pid or person_id(people, n)
        p = people["by_id"].get(i) if i and people else None
        seen[k] = len(out)
        out.append({"name": n, "relationship": gsjs.text(rel), "phone": cp_phone(phone), "email": gsjs.text(email),
                    "avatar": gsjs.or_text(p.get("avatar")) if p else "", "person_id": i or "", "source": source})

    g, h, f = d["guardian"], d["home"], d["financial"]
    add(g["name"], "Guardian · " + g["relationship"] if g["relationship"] else "Guardian", g["phone"], g["email"],
        g["person_id"], "Client record")
    add(g["ssa_name"], "SSA", g["ssa_phone"], g["ssa_email"], g["ssa_person_id"], "Client record")
    add(h["house_manager"], "House manager", h["house_manager_phone"], h["house_manager_email"], "", "Client record")
    add(f["payee_rep"], "Payee representative", f["payee_rep_phone"], f["payee_rep_email"], "", "Client record")
    for m in d["family"]:
        add(m.get("name"), m.get("relationship"), m.get("phone"), m.get("email"), m.get("person_id"),
            "ISP " + (d["services"]["isp_year"] or ""))

    def doctors() -> None:
        nk = name_key(ctx["name"])
        for r in estate(reads, "drAppointments"):
            if name_key(r.get("client")) != nk:
                continue
            if re.search(r"discontinu|cancel", gsjs.or_text(r.get("active_or_discontinued")) + " "
                         + gsjs.or_text(r.get("status")), re.I):
                continue
            add(r.get("dr_name"), gsjs.text(r.get("specialist")) or "Doctor", r.get("phone"), "", "", "Dr Master")

    _ok, err = _soft(doctors)
    if err:
        why.append(_why_of("The doctors (Dr Master)", err) + ".")
    return out


def care_overridden(reads: L.Reads, ctx: dict, tab: str, rows: list[dict]) -> list[dict]:
    """cpCareOverridden_: the plan's care rows with the Hub's own corrections over them."""
    mine = [o for o in overrides_for(reads, ctx["key"], "care") if gsjs.or_text(o.get("tab")) == tab]
    by_target = {o["target"]: o for o in mine if o.get("target")}

    def edited(row: dict, o: dict) -> dict:
        t = verbatim(o.get("text"), SECTION_MAX)
        return {"id": row.get("id"), "record": gsjs.text(o.get("record")), "date": cp_day(o.get("at")),
                "details": gist(t), "status": "Current", "source": "Edited in the Hub", "text": t}

    out = []
    for r in rows:
        o = by_target.get(r.get("id")) if r.get("id") else None
        if o and o.get("state") == "removed":
            continue
        row = edited(r, o) if o else r
        if not re.match(r"home_", gsjs.or_text(row.get("id"))):
            row["edit"] = {"record": row.get("record"), "removed": ""}
        out.append(row)
    for o in mine:
        if o.get("target") or o.get("state") == "removed" or not gsjs.text(o.get("record")):
            continue
        row = edited({"id": gsjs.or_text(o.get("id"))}, o)
        row["edit"] = {"record": row["record"], "removed": ""}
        out.append(row)
    return out


def care_build(reads: L.Reads, ctx: dict, tab: str) -> dict[str, Any]:
    """cpCareBuild_: one Care & Support tab, every row the plan's own words with its plan year's status."""
    isp = isp_row(reads, ctx["key"])
    year = gsjs.text(isp.get("isp_year")) if isp else ""
    plan_source = ("ISP " + (year or "") + (" · " + gsjs.text(isp.get("source_file"))
                                            if not gsjs.falsy(isp.get("source_file")) else "")) if isp else ""
    plan_day = cp_day(isp.get("loaded_at") if isp else None)
    rows: list[dict] = []
    absent: list[str] = []
    why: list[str] = []
    sections = sections_for(reads, ctx["key"])
    filed = len(sections) > 0

    def section_row(r: dict) -> dict:
        t = verbatim(r.get("text"), SECTION_MAX)
        return {"id": gsjs.or_text(r.get("id")), "record": gsjs.text(r.get("record")), "date": cp_day(r.get("loaded_at")),
                "details": gist(t), "status": "Current" if year and gsjs.js_str(r.get("isp_year")) == year else "Past plan",
                "source": "ISP " + gsjs.text(r.get("isp_year")) + (" · " + gsjs.text(r.get("source_file"))
                                                                   if not gsjs.falsy(r.get("source_file")) else ""),
                "text": t}

    if not isp:
        why.append("No plan is filed for " + ctx["name"] + ".")
    if isp and not filed and (tab == "daily" or CARE_SECTIONS.get(tab)):
        why.append("The plan has not been read into sections yet — Read the plans files them.")
    if tab == "daily":
        for section, _label, _rx in ROUTINES:
            mine = [r for r in sections if r.get("section") == section]
            cur = [r for r in mine if year and gsjs.js_str(r.get("isp_year")) == year]
            for r in cur or mine:
                rows.append(section_row(r))
            if not cur and filed:
                absent.append(section)
    for s in CARE_SECTIONS.get(tab) or ():
        mine = [r for r in sections if r.get("section") == s]
        for r in mine:
            rows.append(section_row(r))
        if not mine and filed:
            absent.append(s)
    for field, label in CARE_FIELDS.get(tab) or ():
        t = verbatim(isp.get(field) if isp else None, SECTION_MAX)
        if not t:
            absent.append(field)
            continue
        rows.append({"id": "isp_" + ctx["key"] + "_" + field, "record": label, "date": plan_day, "details": gist(t),
                     "status": "Current", "source": plan_source, "text": t})
    out: dict[str, Any] = {"tab": tab, "rows": rows, "statuses": [], "absent": absent, "why": ""}
    if tab == "plans":
        out["rows"] = plan_docs(reads, ctx, isp, plan_source, plan_day, why)
    if tab == "home":
        c = ctx.get("row") or {}
        house, addr = gsjs.text(_or(c.get("house"), c.get("houseName"))), gsjs.text(c.get("home_address"))
        if house or addr:
            try:
                src = sources_of(reads, ctx)
                mf, tf = src["mf"], src["tf"]
            except (Defer, hubdb.Unreadable):
                # the client books' copy cannot answer just now: the Hub row's own Start Date, and the tab stays here
                mf = tf = {}
            out["rows"].insert(0, {"id": "home_" + ctx["key"], "record": "Home",
                                   "date": start_day(picker(c, mf, tf)),
                                   "details": " · ".join(x for x in (house, addr) if x),
                                   "status": "Past plan" if ctx.get("archived") else "Current",
                                   "source": "Client record", "text": "", "address": addr})
    if tab == "team":
        out["people"] = team_of(reads, ctx, why)
    if tab in OVERRIDE_TABS:
        out["rows"] = care_overridden(reads, ctx, tab, out["rows"])
    out["statuses"] = statuses_of(out["rows"])
    out["why"] = " ".join(why)
    return out


def care_door(reads: L.Reads, ctx: dict, tab_raw: Any) -> dict[str, Any]:
    """cpCareDoor_ past the gate."""
    if ctx.get("refused"):
        return ctx["refused"]
    tab = gsjs.text(tab_raw).lower() or "plans"
    if tab not in CARE_TABS:
        return {"status": 400, "message": "tab: one of " + ", ".join(CARE_TABS) + "."}
    data, why = _soft(lambda: reads.once(f"cp_care:{ctx['key']}:{tab}", lambda: scrub(care_build(reads, ctx, tab))))
    if data is None:
        return {"status": 503, "message": f"Care & Support could not be read just now ({why})."}
    return answer(data)


# ---- Medication ---------------------------------------------------------------------------------------------------

def meds_times(v: Any) -> list[str]:
    """medsTimesOf_."""
    return [("0000" + t)[-4:][:2] + ":" + ("0000" + t)[-4:][2:]
            for t in re.findall(r"[0-9]{3,4}", gsjs.or_blank(v).replace(":", ""))]


def meds_edit_raw(row: dict) -> dict[str, str]:
    """medsEditRaw_: a medication row's edit fields as the panel opens on them."""
    out = {}
    for f, col in MEDS_EDIT_COLUMNS.items():
        v = gsjs.text(row.get(col), 500)
        out[f] = " ".join(meds_times(v)) if f == "times" else v
    return out


def meds_build(reads: L.Reads, ctx: dict, tab: str) -> dict[str, Any]:
    """cpMedsBuild_: the eMAR list with Active / Discontinued."""
    nk = name_key(ctx["name"])
    rows: list[dict] = []
    as_of = ""
    for r in _hub(reads, "medications"):
        if name_key(r.get("Client")) != nk:
            continue
        name = gsjs.text(r.get("PrescriptionName"))
        if not name:
            continue
        times = [("0000" + t)[-4:][:2] + ":" + ("0000" + t)[-4:][2:]
                 for t in re.findall(r"[0-9]{3,4}", gsjs.or_text(r.get("AdministrationTimes")))]
        gone = gsjs.text(r.get("Discountinued"))
        added = cp_day(r.get("Added Date"))
        for d in (added, cp_day(r.get("Discountinued Date")), cp_day(r.get("updatedAt"))):
            if d and d > as_of:
                as_of = d
        auto_id = gsjs.text(r.get("Id - Auto"))
        rows.append({"id": gsjs.or_text(_or(r.get("Id - Auto"), r.get("id"), "")), "record": name, "date": added,
                     "edit": meds_edit_raw(r) if auto_id else {},
                     "details": " · ".join(x for x in (gsjs.text(r.get("Dosage")), gsjs.text(r.get("MedType")),
                                                       gsjs.text(r.get("PRN")), " ".join(times)) if x),
                     "status": "Discontinued" if gone else "Active",
                     "source": "eMAR" + (" · Dr " + gsjs.text(r.get("Dr")) if gsjs.text(r.get("Dr")) else ""),
                     "text": "\n".join(x for x in (verbatim(r.get("PrescriptionInstructions")),
                                                   verbatim(r.get("MedDetails"))) if x)})
    rows.sort(key=functools.cmp_to_key(lambda a, b: (0 if a["status"] == b["status"] else (-1 if a["status"] == "Active"
                                                                                          else 1))
                                       or gsjs.locale_cmp(a["record"], b["record"])))
    why = "" if rows else "The eMAR list names no medication for " + ctx["name"] + "."
    return {"tab": tab, "rows": rows, "statuses": statuses_of(rows), "as_of": as_of, "why": why}


def meds_door(reads: L.Reads, ctx: dict, tab_raw: Any = "meds") -> dict[str, Any]:
    """cpMedsDoor_ past the gate."""
    if ctx.get("refused"):
        return ctx["refused"]
    tab = gsjs.text(tab_raw).lower() or "meds"
    if tab not in MEDS_TABS:
        return {"status": 400, "message": "tab: one of " + ", ".join(MEDS_TABS) + "."}
    data, why = _soft(lambda: reads.once(f"cp_meds:{ctx['key']}:{tab}", lambda: scrub(meds_build(reads, ctx, tab))))
    if data is None:
        return {"status": 503, "message": f"The medications could not be read just now ({why})."}
    return answer(data)


# ---- Incidents ----------------------------------------------------------------------------------------------------

def incidents_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """cpIncidentsBuild_: the client's UI/MUI reports with their review status by client_key|incident_ts."""
    c = ctx.get("row") or {}
    house = gsjs.text(_or(c.get("house"), c.get("houseName")))
    code = L.house_code(house) or L.code_of(house)
    joined = L.incidents_for(estate(reads, "uiIncidents"), [{"client_key": ctx["key"], "name": ctx["name"]}])
    reviews = reviews_for(reads, ctx["key"])
    cats: set[str] = set()
    rows = []
    for j in joined:
        full = j.get("row") or {}
        ts = gsjs.or_text(full.get("timestamp"))
        rv = reviews.get(ctx["key"] + "|" + ts)
        cats.update(j["categories"])
        rows.append({"id": j["id"], "incident_ts": ts, "your_name": j["your_name"], "client_name": j["client_name"],
                     "client_key": ctx["key"], "incident_category": j["incident_category"],
                     "categories": j["categories"], "incident_location": j["incident_location"], "house_code": code,
                     "incident_date": cp_day(j["incident_date"]) or j["incident_date"],
                     "incident_time": j["incident_time"],
                     "incident_reported_date": cp_day(full.get("incident_reported_date"))
                     or gsjs.or_text(full.get("incident_reported_date")),
                     "incident_reported_time": gsjs.or_text(full.get("incident_reported_time")),
                     "employees_involved": list_of(full.get("employees_involved")),
                     "summary_of_incident": gsjs.or_text(full.get("summary_of_incident")),
                     "immediate_action_taken": gsjs.or_text(full.get("immediate_action_taken")),
                     "cause_and_contributing_factors": gsjs.or_text(full.get("cause_and_contributing_factors")),
                     "prevention_plan": gsjs.or_text(full.get("prevention_plan")),
                     # the sheet's cells as filed: the witnesses Locations' edit panel sends, opened from here
                     "row": {k: full.get(k, "") for k in L.INCIDENT_COLUMNS},
                     "status": gsjs.js_str(rv.get("status")) if rv and gsjs.js_str(rv.get("status")) in INCIDENT_STATUSES
                     else "Reported",
                     "status_by": gsjs.or_text(rv.get("by")) if rv else "",
                     "status_at": gsjs.or_text(rv.get("at")) if rv else ""})
    # a timestamp the sheet holds as text is the String() Apps Script keys the status door by; one it holds as a date
    # reaches the copy to the second, while Apps Script's carries the milliseconds
    if any(isinstance((j.get("row") or {}).get("timestamp"), (SheetDate, hubdb.SheetTime)) for j in joined):
        raise Defer("the copy holds the incidents' timestamps to the second, not to the millisecond")
    return {"rows": rows, "categories": sorted(cats), "statuses": list(INCIDENT_STATUSES)}


def incidents_door(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """cpIncidentsDoor_ past the gate."""
    if ctx.get("refused"):
        return ctx["refused"]
    data, why = _soft(lambda: reads.once("cp_incidents:" + ctx["key"], lambda: scrub(incidents_build(reads, ctx))))
    if data is None:
        return {"status": 503, "message": f"The incidents could not be read just now ({why})."}
    return answer(data)


def reviews_door(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """cpReviewsDoor_: the pack's review statuses, by client_key|incident_ts."""
    if ctx.get("refused"):
        return ctx["refused"]
    by = reviews_for(reads, ctx["key"])
    reviews = {i: {"status": gsjs.or_text(r.get("status")), "by": gsjs.or_text(r.get("by")),
                   "at": gsjs.or_text(r.get("at"))} for i, r in by.items()}
    return answer({"client_key": ctx["key"], "reviews": reviews, "statuses": list(INCIDENT_STATUSES)})


# ---- Activity -----------------------------------------------------------------------------------------------------

def activity_build(reads: L.Reads, ctx: dict, own: bool) -> dict[str, Any]:
    """cpActivityBuild_: every client-bearing row, newest first; `own` leaves the staff's and the office's notes out."""
    nk = name_key(ctx["name"])
    rows: list[dict] = []
    why: list[str] = []
    degraded = False
    counts = {"daily_notes": 0, "client_notes": 0, "house_notes": 0, "incidents": 0, "visits": 0, "med_changes": 0}
    if own:
        for k in NOTE_COUNTS:
            counts.pop(k, None)

    def push(kind: str, rid: Any, record: Any, day: str, text_: Any, by: Any, source: str) -> None:
        t = verbatim(text_, 4000)
        rows.append({"id": kind + "_" + _cat(rid), "kind": kind,
                     "record": gsjs.text(record, 160) or ACTIVITY_KINDS[kind], "date": day, "details": gist(t),
                     "status": ACTIVITY_KINDS[kind], "source": source, "by": gsjs.text(by), "text": t})

    def step(label: str, fn: Callable[[], None], note: bool = False) -> None:
        nonlocal degraded
        if own and note:
            return
        _ok, err = _soft(fn)
        if err:
            degraded = True
            why.append(_why_of(label, err) + ".")

    def daily() -> None:
        for r in estate(reads, "dailyNotes"):
            if name_key(r.get("client_name")) != nk:
                continue
            counts["daily_notes"] += 1
            push("daily_note", r.get("id"), r.get("category"), cp_day(r.get("reporting_date")) or cp_day(r.get("timestamp")),
                 r.get("response"), r.get("dsp_name"), "Staff Daily Notes")

    def client_notes() -> None:
        for r in _hub(reads, "client_notes"):
            if gsjs.or_text(r.get("client_key")) != ctx["key"] and name_key(r.get("client_name")) != nk:
                continue
            counts["client_notes"] += 1
            push("client_note", r.get("id"), _or(r.get("source_tab"), "Client note"),
                 cp_day(r.get("entry_date")) or cp_day(r.get("createdAt")), r.get("note"), r.get("contact"),
                 "Client notes")

    def house_notes() -> None:
        for r in own_rows(reads, HOUSE_NOTES_TAB):
            if gsjs.or_text(r.get("client_key")) != ctx["key"] or gsjs.or_text(r.get("state")).lower() == "removed":
                continue
            counts["house_notes"] += 1
            push("house_note", r.get("id"), (gsjs.text(r.get("priority")) or "normal") + " priority · "
                 + gsjs.text(r.get("house")), cp_day(r.get("at")), r.get("details"), r.get("by"), "House notes")

    def incidents() -> None:
        for j in L.incidents_for(estate(reads, "uiIncidents"), [{"client_key": ctx["key"], "name": ctx["name"]}]):
            counts["incidents"] += 1
            full = j.get("row") or {}
            push("incident", j["id"], j["incident_category"],
                 cp_day(j["incident_date"]) or cp_day(full.get("timestamp")), full.get("summary_of_incident"),
                 j["your_name"], "UIs and MUIs")

    def visits() -> None:
        for r in estate(reads, "drVisits"):
            if name_key(r.get("client_name")) != nk:
                continue
            counts["visits"] += 1
            doctor = gsjs.text(r.get("dr_name"))
            push("visit", r.get("id"), "Dr " + doctor if doctor else "Doctor visit", cp_day(r.get("appointment_date")),
                 r.get("appointment_address"), r.get("manager"), "Dr Appt Archive")

    def meds() -> None:
        for r in _hub(reads, "medications"):
            if name_key(r.get("Client")) != nk:
                continue
            rid = gsjs.or_text(_or(r.get("Id - Auto"), r.get("id"), ""))
            added = cp_day(r.get("Added Date"))
            if added:
                counts["med_changes"] += 1
                push("med_added", rid, r.get("PrescriptionName"), added, r.get("Dosage"), r.get("Added"), "eMAR")
            stopped = cp_day(r.get("Discountinued Date"))
            if stopped:
                counts["med_changes"] += 1
                push("med_stopped", rid, r.get("PrescriptionName"), stopped, r.get("Discountinued"), "", "eMAR")

    step("The daily notes", daily, True)
    step("The client notes", client_notes, True)
    step("The house notes", house_notes, True)
    step("The incidents", incidents)
    step("The doctor visits", visits)
    step("The medications", meds)
    rows.sort(key=functools.cmp_to_key(lambda a, b: 1 if a["date"] < b["date"] else (-1 if a["date"] > b["date"] else 0)))
    kinds = [ACTIVITY_KINDS[k] for k in ACTIVITY_KINDS if not own or k not in NOTE_KINDS]
    return {"rows": rows[:ROW_CAP], "kinds": kinds, "counts": counts, "last_date": rows[0]["date"] if rows else "",
            "total": len(rows), "why": " ".join(why), "degraded": degraded}


def activity_door(reads: L.Reads, ctx: dict, own: bool = False) -> dict[str, Any]:
    """cpActivityDoor_ past the gate; `own` leaves the notes out."""
    if ctx.get("refused"):
        return ctx["refused"]
    part = "own" if own else "all"
    return answer(reads.once(f"cp_activity:{ctx['key']}:{part}", lambda: scrub(activity_build(reads, ctx, bool(own)))))


# ---- the actions ----------------------------------------------------------------------------------------------------

def client_profile_roster(sess: L.Session, payload: dict) -> dict[str, Any]:
    rdr = reader(sess)
    if not rdr:
        return unknown()
    raw = payload.get("show_inactive")
    with_inactive = raw is True or bool(re.fullmatch(r"(true|1|yes|on)", gsjs.or_blank(raw), re.I))
    return roster_door(sess.reads, with_inactive, rdr)


def client_profile_details(sess: L.Session, payload: dict) -> dict[str, Any]:
    if not reader_for(sess, payload.get("client")):
        return unknown()
    return details_door(sess.reads, client_ctx(sess.reads, payload.get("client")))


def client_profile_care(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientProfileCare; while Settings › My Work hides Home & equipment, that tab is the master's alone."""
    import editions as E  # noqa: PLC0415 - editions reads the scope this module reads
    if not reader_for(sess, payload.get("client")):
        return unknown()
    if gsjs.text(payload.get("tab")).lower() == "home" and E.hides_for(sess).get("client_care_home"):
        return unknown()
    return care_door(sess.reads, client_ctx(sess.reads, payload.get("client")), payload.get("tab"))


def client_profile_meds(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientProfileMeds; while Settings › My Work hides Clients' Medication, the master's alone."""
    import editions as E  # noqa: PLC0415 - editions reads the scope this module reads
    if not reader_for(sess, payload.get("client")) or E.hides_for(sess).get("client_medication"):
        return unknown()
    return meds_door(sess.reads, client_ctx(sess.reads, payload.get("client")), payload.get("tab"))


def client_profile_incidents(sess: L.Session, payload: dict) -> dict[str, Any]:
    if not reader_for(sess, payload.get("client")):
        return unknown()
    return incidents_door(sess.reads, client_ctx(sess.reads, payload.get("client")))


def client_profile_activity(sess: L.Session, payload: dict) -> dict[str, Any]:
    rdr = reader_for(sess, payload.get("client"))
    if not rdr:
        return unknown()
    return activity_door(sess.reads, client_ctx(sess.reads, payload.get("client")), own_only(rdr))


def doc_known(reads: L.Reads, ctx: dict, file_id: str) -> bool:
    """cpDocKnown_: the client's plan file, or a plan among their client files."""
    if gsjs.or_text(isp_doc(reads, ctx["name"]).get("id")) == file_id:
        return True
    nk = name_key(ctx["name"])
    rows, _w = _soft(lambda: files_for(reads, ctx["key"], nk))
    return any(plan_file(r) and (gsjs.or_text(r.get("drive_id")) == file_id or L.drive_id(r.get("url")) == file_id)
               for r in rows or [])


def client_profile_doc_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientProfileDocFile: one plan document of the client, as bytes for the platform's viewer."""
    if not reader_for(sess, payload.get("client")):
        return unknown()
    ctx = client_ctx(sess.reads, payload.get("client"))
    if ctx.get("refused"):
        return ctx["refused"]
    file_id = gsjs.text(payload.get("file_id"), 120)
    if not L.is_file_id(file_id):
        return {"status": 400, "message": "file_id: a Drive file id."}
    if not doc_known(sess.reads, ctx, file_id):
        return {"status": 404, "message": "This client names no such document."}
    got = L.doc_file(sess.reads, file_id)
    if got.get("refused"):
        return got["refused"]
    return {"status": 200, "data": {"id": file_id, **got}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "clientProfileRoster": client_profile_roster, "clientProfileDetails": client_profile_details,
    "clientProfileCare": client_profile_care, "clientProfileMeds": client_profile_meds,
    "clientProfileIncidents": client_profile_incidents, "clientProfileActivity": client_profile_activity,
    "clientProfileDocFile": client_profile_doc_file,
}


def _care_part(tab: str) -> Callable[[L.Reads, dict], dict[str, Any]]:
    return lambda reads, ctx: care_door(reads, ctx, tab)


# cpPackDoors_'s ClientProfiles parts: fn(reads, ctx) → the part's answer, each its own door past the gate
PACK_DOORS: dict[str, Callable[[L.Reads, dict], dict[str, Any]]] = {
    "roster_own": lambda reads, ctx: ctx["refused"] if ctx.get("refused") else
    roster_door(reads, False, {"kind": "client", "keys": {ctx["key"]: True}}),
    "details": details_door,
    "care_plans": _care_part("plans"), "care_team": _care_part("team"), "care_daily": _care_part("daily"),
    "care_health": _care_part("health"), "care_goals": _care_part("goals"), "care_home": _care_part("home"),
    "meds": lambda reads, ctx: meds_door(reads, ctx, "meds"),
    "reviews": reviews_door,
    "incidents": incidents_door,
    "activity": lambda reads, ctx: activity_door(reads, ctx, False),
    "activity_own": lambda reads, ctx: activity_door(reads, ctx, True),
}

# HUB_POLICY: the roles each read is declared for, and its typed params (Resolver.gs checks both first)
POLICY_ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
POLICY = {"clientProfileRoster": {"roles": POLICY_ROLES, "params": {}},
          "clientProfileDetails": {"roles": POLICY_ROLES, "params": {"client": "string"}},
          "clientProfileCare": {"roles": POLICY_ROLES, "params": {"client": "string", "tab": "string"}},
          "clientProfileMeds": {"roles": POLICY_ROLES, "params": {"client": "string", "tab": "string"}},
          "clientProfileIncidents": {"roles": POLICY_ROLES, "params": {"client": "string"}},
          "clientProfileActivity": {"roles": POLICY_ROLES, "params": {"client": "string"}},
          "clientProfileDocFile": {"roles": POLICY_ROLES, "params": {"client": "string", "file_id": "string"}}}
