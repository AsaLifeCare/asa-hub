"""Staff's reads (apps-script/StaffProfiles.gs), the same answers off asa-hub-db: one staff member at a time, cut to the viewer."""
from __future__ import annotations

import functools
import json
import math
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import clients as C
import gsjs
import house_tables as HT
import hubdb
import locations as L
import photos as P
import resource_rows as RR
import scope as sc
import staff_views as SV
from gsjs import NY, SheetDate, name_key
from scope import Defer

APP_ID = "staff-profiles"
ADDRESS_APP = "my-profile"
# the operator's sheet (10-30): the SSA and Family columns are the same, and neither is ever a whole-team viewer
BASIC_KINDS = ("client", "guardian", "ssa")
WHOLE_KINDS = ("master", "all")
# App Control's rows Staff splits off (src/lib/featureAccess.ts APP_FEATURES): a staff-side viewer whose badges the
# Whole team row does not name opens their own profile alone; each tab row keeps its tab from a badge it does not name,
# their own profile's included. An empty row is the master's alone.
TEAM_FEATURE = "staff-profiles.team"
PERFORMANCE_FEATURE = "staff-profiles.performance"
HR_FEATURE = "staff-profiles.hrAdmin"
PAY_FEATURE = "staff-profiles.employeePay"
ACTIVITY_FEATURE = "staff-profiles.activity"
# the editions that live in a split tab: a holder opens the tab, since an edition only ever adds people
HR_EDITIONS = ("staff.hr",)
PERF_EDITIONS = ("staff.hrIssues", "staff.documentation")
OWN_ONLY_WORDS = "Only your own profile is open to you in Staff."
NO_STAFF = "No staff member with that key."
NOTES_TAB = "staff_notes"
DOC_MARKS_TAB = "staff_doc_marks"
DOC_MARKS_HEADER = ("id", "staff_key", "staff_name", "date", "area", "state", "why", "by", "at")
# the documentation areas whose missing record a person may mark concluded
DOC_MARK_AREAS = ("daily_notes", "time_tracking")
VISITS_TAB = "staff_profile_visits"
EVENTS_TAB = "events"
MEDDEL_TAB = "meddel_flows"
UPLOADS_TAB = "cert_uploads"
REQUIREMENTS_TAB = "requirements"
REQ_STATES_TAB = "requirement_states"
REQ_STATES_HEADER = ("login", "person_key", "person_name", "req_id", "state", "expires", "days_left", "prev_state",
                     "since", "computed_at", "tenant")
PREFS_TAB = "staff_prefs"
PEOPLE_TYPES_TAB = "people_types"
CLEARANCE_TAB = "staff_clearance"
IST_CONFIG_TAB = "ist_config"
CANDIDATES_TAB = "candidates"
CERT_SOURCE_PROP = "CERT_SOURCE_ID"
DRIVER_TAB = "employee driver"
DRIVER_COMPLIANCE_TAB = "Driver Compliance"
ACTIVITY_DAYS = 365
EVENTS_CAP = 60
PAPERS_SHOWN = 10
FLOWS = {"training": "Training renewal", "documents": "Document renewal", "onboarding": "Onboarding paperwork",
         "ist": "IST training", "review": "Certificate review", "meddel": "Med Del renewal"}
MEDDEL_PHASES = {"1": "Application", "2": "Application received", "3": "Relias training", "4": "Skills day",
                 "5": "MAIS check"}
US_STATES = tuple(("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM "
                   "NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP").split(" "))
# server/redaction.py licence_marker: of a licence number the copy keeps only what spLicenceMask_ shows
LICENCE_KEPT = re.compile(r"\[withheld: identifier\] licence:(?:(none)|(short)|(?:([A-Z]{2}) )?([0-9]{4}))")
TWIN_KEY = hubdb.TWIN_KEY

# SP_MASTER_FIELDS: (id, block, headers, secret); read by position, the scorecard before `Status`, the data from it on
MASTER_FIELDS = (
    ("employee", "score", ("Employee", "Employee Name"), False),
    ("status", "data", ("Status",), False),
    ("employee_id", "data", ("Employee ID", "Employee #", "Emp ID"), False),
    ("first_name", "data", ("First Name", "First"), False),
    ("last_name", "data", ("Last Name", "Last"), False),
    ("ssn_last4", "data", ("SSN (Last 4)", "SSN Last 4"), True),
    ("ssn", "data", ("SSN#", "SSN #", "SSN"), True),
    ("dob", "data", ("Date of Birth", "DOB", "Birth Date"), False),
    ("address", "data", ("Address", "Street Address"), False),
    ("city", "data", ("City",), False),
    ("state", "data", ("State", "ST"), False),
    ("zip", "data", ("Zip", "Zip Code", "Zipcode"), False),
    ("phone", "data", ("Phone Number", "Phone", "Cell Phone"), False),
    ("email", "data", ("Email", "Email Address", "E-mail"), False),
    ("referral", "data", ("Referral", "Referred By"), False),
    ("referral_paid", "data", ("Referral Paid?", "Referral Paid"), False),
    ("start_doc", "data", ("Start Date(doc)",), False),
    ("start_first_day", "data", ("Start Date (first day)",), False),
    ("end_last_day", "data", ("End Date (last day)",), False),
    ("job_app_date", "data", ("Job App Date",), False),
    ("resume", "data", ("Resume",), False),
    ("attestation_date", "data", ("Attestation Date",), False),
    ("i9_date", "data", ("I-9 Date", "I9 Date"), False),
    ("i9_completed", "data", ("I-9 Completed", "I9 Completed"), False),
    ("i9_type_1", "data", ("I-9 Type 1",), False),
    ("i9_type_1_exp", "data", ("I-9 1 Exp Date",), False),
    ("i9_type_2", "data", ("I-9 Type 2",), False),
    ("i9_type_2_exp", "data", ("I-9 2 Exp Date",), False),
    ("w4_date", "data", ("W-4 Date", "W4 Date"), False),
    ("hipaa_date", "data", ("HIPAA Form Date",), False),
    ("pay_auth_date", "data", ("Pay Auth Form Date",), False),
    ("hs_diploma", "data", ("HS Diploma",), False),
    ("driver", "data", ("Driver",), False),
    ("dl", "data", ("DL#", "DL #", "DL"), True),
    ("license_exp", "data", ("License Exp Date",), False),
    ("abstract_original", "data", ("Driver's Abstract (Original)",), False),
    ("abstract_latest", "data", ("Driver's Abstract (Latest)",), False),
    ("insurance_exp", "data", ("Insurance Exp Date",), False),
    ("sam", "data", ("SAM", "SAM Database"), False),
    ("oig", "data", ("OIG", "OIG Exclusions"), False),
    ("abuser", "data", ("Abuser Registry", "Abuser"), False),
    ("sex_offender", "data", ("Sex Offender",), False),
    ("offender", "data", ("Offender",), False),
    ("nurse_aide", "data", ("Nurse Aide",), False),
    ("exclusions", "data", ("Exclusions Database", "Exclusions"), False),
    ("bci_fbi", "data", ("BCI/FBI", "BCI / FBI"), True),
    ("bci_check_date", "data", ("BCI Check Date",), False),
    ("rapback_entry_date", "data", ("Rapback Entry Date",), False),
    ("dodd_exp", "data", ("DODD 8-Hour Exp", "DODD 8 Hour Exp"), False),
    ("cpr_exp", "data", ("CPR Exp Date",), False),
    ("mandt_exp", "data", ("Mandt Exp Date", "MANDT Exp Date"), False),
    ("money_mgt_date", "data", ("Money Mgt Date",), False),
    ("flag_job_app", "score", ("Job App",), False),
    ("flag_attestation", "score", ("Attestation",), False),
    ("flag_i9", "score", ("i9 Form", "I-9 Form", "I9 Form"), False),
    ("flag_w4", "score", ("W4", "W-4", "W4 Form"), False),
    ("flag_hipaa", "score", ("HIPAA",), False),
    ("flag_pay_auth", "score", ("Pay Auth",), False),
    ("flag_hs_diploma", "score", ("HS Diploma",), False),
    ("flag_abstract", "score", ("Drive Abstract (last)", "Driver's Abstract"), False),
    ("flag_car_insurance", "score", ("Car Insurance",), False),
    ("flag_sam", "score", ("SAM",), False),
    ("flag_oig", "score", ("OIG",), False),
    ("flag_abuser", "score", ("Abuser", "Abuser Registry"), False),
    ("flag_sex_offender", "score", ("Sex Offender",), False),
    ("flag_offender", "score", ("Offender",), False),
    ("flag_nurse_aide", "score", ("Nurse Aide",), False),
    ("flag_exclusions", "score", ("Exclusions", "Exclusions Database"), False),
    ("flag_bci", "score", ("BCI",), False),
    ("flag_rapback", "score", ("Rapback",), False),
)
# the two SP_PAPERS employment looks a file up by
PAPER_RE = {"resume": re.compile(r"r[eé]sum[eé]|\bcv\b", re.I),
            "hs_diploma": re.compile(r"diploma|\bged\b|high\s*school|\bhs\s+transcript", re.I)}
SCREENS = (("sam", "SAM database", "sam", "flag_sam"), ("oig", "OIG exclusions", "oig", "flag_oig"),
           ("abuser", "Abuser registry", "abuser", "flag_abuser"),
           ("sex_offender", "Sex offender registry", "sex_offender", "flag_sex_offender"),
           ("offender", "Offender registry", "offender", "flag_offender"),
           ("nurse_aide", "Nurse aide registry", "nurse_aide", "flag_nurse_aide"),
           ("exclusions", "Exclusions database", "exclusions", "flag_exclusions"))
EDIT_SECTIONS = {
    "profile": ("first_name", "last_name", "status", "phone", "email", "account_phones", "account_emails", "avatar",
                "login_email"),
    "employment": ("referral", "referral_paid", "job_app_date", "resume", "attestation_date", "start_doc",
                   "start_first_day", "end_last_day", "hs_diploma", "driver"),
    "hr": ("address", "city", "state", "zip", "w4_date", "pay_auth_date", "i9_date", "i9_completed", "i9_type_1",
           "i9_type_1_exp", "i9_type_2", "i9_type_2_exp", "hipaa_date", "license_exp", "abstract_original",
           "abstract_latest", "insurance_exp", "sam", "oig", "abuser", "sex_offender", "offender", "nurse_aide",
           "exclusions", "bci_check_date", "rapback_entry_date"),
    # Compliance: the courses' own dates (Med Delivery's are the MAIS registry check's), the credentials, the screening
    "compliance": ("dodd_exp", "cpr_exp", "mandt_exp", "money_mgt_date", "license_exp", "insurance_exp", "sam", "oig",
                   "abuser", "sex_offender", "offender", "nurse_aide", "exclusions", "bci_check_date",
                   "rapback_entry_date")}
EDIT_ACCOUNT =("account_phones", "account_emails", "avatar", "login_email")
EDIT_RENAME = "A rename re-keys the staff record (its link, notes and visits): it is filed through the rename door."
EDIT_PROTECTED = "Protected: edited only in the Employee Database's own forms."
EDIT_LOCKED = {"first_name": EDIT_RENAME, "last_name": EDIT_RENAME, "name": EDIT_RENAME,
               "employee_id": "The payroll id: read-only here.",
               "role": "Comes from the employee roster sync, which would overwrite an edit made here.",
               "ssn": EDIT_PROTECTED, "ssn_last4": EDIT_PROTECTED, "dob": EDIT_PROTECTED, "dl": EDIT_PROTECTED,
               "bci_fbi": EDIT_PROTECTED}
EDIT_MASTER_IDS = tuple(dict.fromkeys(f for s in EDIT_SECTIONS.values() for f in s if f not in EDIT_ACCOUNT))
# SP_EDITION_FIELDS: the record fields each Staff edition opens; the name, status and sign-in e-mail stay the master's
EDITION_FIELDS = {
    "staff.profile": ("phone", "email", "account_phones", "account_emails", "avatar", "address", "city", "state", "zip"),
    "staff.employment": EDIT_SECTIONS["employment"],
    "staff.hr": tuple(f for f in EDIT_SECTIONS["hr"] if f not in ("address", "city", "state", "zip")),
    "staff.compliance": EDIT_SECTIONS["compliance"]}
EDITION_DRIVING, EDITION_MAIS, EDITION_IST = "staff.driving", "staff.mais", "staff.ist"
EDITION_PREFERENCES, EDITION_NOTES, EDITION_NOTES_EDIT = "staff.preferences", "staff.notes", "staff.notesEdit"
EDITION_HR_ISSUES, EDITION_DOCUMENTATION = "staff.hrIssues", "staff.documentation"
EDIT_MASTER_ONLY = {"status": "The status is changed by the master alone.",
                    "login_email": "The sign-in e-mail is changed by the master alone."}
EDITION_NOT_HELD = "Not a field your editions open."
DRIVER_FIELDS = (("employee", ("Employee",)), ("first_name", ("First Name",)), ("last_name", ("Last Name",)),
                 ("driver", ("Driver",)), ("dl", ("DL #", "DL#")), ("points", ("Points",)),
                 ("license_exp", ("License Exp Date",)), ("abstract_original", ("Driver's Abstract (Original)",)),
                 ("abstract_latest", ("Driver's Abstract (Latest)", "Drivers Abstract Latest")),
                 ("insurance_exp", ("Insurance Exp Date", "Insurance Expiration")))
MAIS_SEARCH = "search_first+search_last"
MAIS_EFFECTIVE = "effective|effective_date"
MAIS_ID = "dd_id"
MAIS_STAMP = "timestamp"
ADDRESS_FIELDS = ("address", "city", "state", "zip")
ADDRESS_WORDS = {
    "session": "An address is read and changed from a person's own session.",
    "visit": "Your address is read and changed from your own session, not inside a visit.",
    "gate": "My Profile is not open to this account in App Control, so no address is read or changed here.",
    "others": "Only your own address is read or changed here.",
    "bridged": ("Your account reaches your roster row only through an e-mail written on the roster, so your address is "
                "not shown or changed from this session — HR updates it, or an administrator gives your account the "
                "exact name on your roster row."),
    "untold": ("Your staff record could not be told apart from another, so your address is not shown or changed here "
               "— HR can settle which record is yours.")}
PREF_SHIFTS = ("morning", "afternoon", "nights")
PREF_PICKUP = ("yes", "no")
PREF_DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
PREF_ALLERGIES = ("cats", "dogs", "birds", "dust", "mold", "fragrances", "other")
PREF_OTHER_MAX = 20
PREFS_UNSET = "Staff preferences are not set up yet."
# Certs.gs, Clearance.gs
CERT_LABELS = {"dodd": "DODD 8-Hour", "cpr": "CPR / First Aid", "med1": "Med Delivery 1", "med2": "Med Delivery 2",
               "med3": "Med Delivery 3", "mais": "MAIS Certification", "money": "Money Management", "mandt": "MANDT"}
CERT_MATRIX_COLUMNS = ("dodd", "cpr", "med1", "med2", "med3", "mais", "money", "mandt")
CERT_MAIS_KEY = "mais"
CLEARANCE_CREDENTIALS = ("dodd", "cpr", "med1", "med2", "med3", "mais", "money", "mandt")
# ComplianceDocs.gs
UPLOADABLE = ("training", "documents")
READ_KIND_WORDS = {
    "dodd_certification": "DODD certificate", "cpr_first_aid": "CPR / First Aid card",
    "med_admin_cert": "medication administration certificate", "crisis_prevention": "crisis prevention certificate",
    "drivers_licence": "driver's license", "state_id": "state ID", "auto_insurance": "car insurance card",
    "training_transcript": "training record", "diploma": "diploma", "ssn_card": "Social Security card",
    "birth_certificate": "birth certificate", "background_check": "background check", "tb_test": "TB test",
    "driver_abstract": "driver's abstract", "passport": "passport", "work_authorization": "work authorization"}
CONFIRM_WORDS = {"med": "Med Delivery dates are written by the MAIS registry check, not here.",
                 "mais": "MAIS has no date column in the record.",
                 "undated": "This requirement keeps no date in the record.",
                 "noReq": ("This document is not filed under a requirement a paper is read for, so no date is taken "
                           "from it.")}
PAPER_FIELDS = ("id", "person", "cert", "name", "at", "req_id", "read_state", "read_kind", "read_kind_words",
                "issued_on", "expires_on", "read_confidence", "read_why")
# IstConfig.gs: the declarations of the cells these reads resolve
# IstConfig.gs's choice cells these reads resolve: the allowed words and the shipped one
CFG_CHOICES: dict[str, tuple[tuple[str, ...], str]] = {"ist_requirements_window": (("own", "ist"), "own")}
CFG_SPECS: dict[str, dict[str, Any]] = {
    "ist_cert_expiring_days": {"type": "int", "min": 1, "max": 365, "unit": "day", "value": "60"},
    "ist_cert_labels": {"type": "pairs", "value": "dodd=DODD 8-Hour, cpr=CPR / First Aid, med1=Med Delivery 1, "
                        "med2=Med Delivery 2, med3=Med Delivery 3, mais=MAIS Certification, money=Money Management, "
                        "mandt=MANDT"},
    "ist_cert_master_columns": {"type": "pairs", "key_pattern": r"^[a-z0-9_]+$", "course_values": True,
                                "value": "cpr_exp_date=cpr, dodd_8_hour_exp=dodd, med_1_exp_date=med1, "
                                "med_2_exp_date=med2, med_3_exp_date=med3, money_mgt_date=money, mandt_exp_date=mandt"},
    "ist_cert_training_keys": {"type": "pairs", "course_values": True,
                               "value": "cpr exp date=cpr, dodd 8-hour exp=dodd, dodd 8 hour exp=dodd, med 1 exp "
                               "date=med1, med 2 exp date=med2, med 3 exp date=med3, money mgt date=money"},
    "ist_cert_source_tabs": {"type": "pairs", "keys": ("trainings", "mais", "master"),
                             "value": "trainings=Trainings Status, mais=Med Del Certs (MAIS), master=Master"},
    "ist_cert_source_fields": {"type": "pairs", "keys": ("master.name", "trainings.name", "trainings.course",
                                                         "trainings.status", "trainings.expires", "mais.name",
                                                         "mais.status", "mais.expires", "mais.category"),
                               "value_pattern": r"^[a-z0-9_]+([|+][a-z0-9_]+)*$",
                               "value": "master.name=employee|name, trainings.name=name, trainings.course=training, "
                               "trainings.status=status, trainings.expires=expiration_date, mais.name=name, "
                               "mais.status=status, mais.expires=expiration, mais.category=cert_type"},
    "ist_cert_tracker_statuses": {"type": "pairs", "values": ("expiring", "expired"),
                                  "value": "expired=expired, *=expiring"},
    "ist_cert_mais_statuses": {"type": "pairs", "values": ("certified", "expired", "skip"), "never_value": "certified",
                               "never_words": ("expired", "revoked", "suspended", "inactive", "lapsed", "denied",
                                               "error"),
                               "value": "certified=certified, ERROR*=skip, *=expired"},
}
CFG_ERROR = re.compile(r"^#(ERROR!|REF!|NAME\?|VALUE!|DIV/0!|N/A|NULL!|NUM!)")
# the date columns of the books the mirror reads unformatted: a Date cell arrives as its serial number
IST_DATES = ("dueDate", "trainedAt", "docAt", "createdAt", "updatedAt", "notifiedAt")
PEOPLE_DATES = ("start_date", "end_date")
REQ_STATE_DATES = ("expires", "since", "computed_at")

by_name = L.by_name


class Said(RuntimeError):
    """An error Apps Script's own code throws here, its words kept."""


def _soft(fn: Callable[[], Any]) -> tuple[Any, str]:
    """A try/catch of the Apps Script code: its own thrown words; a database failure or a bug is never swallowed."""
    try:
        return fn(), ""
    except (hubdb.Unreadable, Defer):
        raise
    except RuntimeError as e:
        return None, L._why(e)


def why_of(what: str, why: str) -> str:
    """spWhy_."""
    return f"{what} could not be read ({why})"


def unknown() -> dict[str, Any]:
    """staffProfilesUnknown_."""
    return {"status": 404, "message": "Unknown action."}


# ---- what JavaScript does to a value ---------------------------------------------------------------------------------

def _or(*vals: Any) -> Any:
    return C._or(*vals)


def _marker(v: Any) -> bool:
    """A cell the copy withholds."""
    return isinstance(v, str) and v.startswith(C.COPY_MARKER)


_KEPT = re.compile(r"\[withheld: [a-z]+\] kept: (\d{4}|on file|none|#[0-9a-f]{16})")


def _kept(v: Any) -> str | None:
    """What the copy kept of a withheld cell (redaction BOOK_KEPT_FACTS): '1234', 'on file', 'none' or a '#' tag."""
    m = _KEPT.fullmatch(v.strip()) if isinstance(v, str) else None
    return m.group(1) if m else None


def _bare(v: Any) -> bool:
    """A cell the copy withholds and keeps nothing of."""
    return _marker(v) and _kept(v) is None


def _is_serial(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and 1 <= v < 2958466


def serial_date(v: float) -> SheetDate:
    """A Sheets day serial as the Date getValues hands back, on New York's clock."""
    return SheetDate(datetime(1899, 12, 30, tzinfo=NY) + timedelta(days=v))


def js_number(v: Any) -> float:
    """Number(v)."""
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = gsjs.trim(gsjs.js_str(v))
    if s == "":
        return 0.0
    for rx, base in ((r"0[xX][0-9a-fA-F]+", 16), (r"0[oO][0-7]+", 8), (r"0[bB][01]+", 2)):
        if re.fullmatch(rx, s):
            return float(int(s[2:], base))
    if re.fullmatch(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", s):
        return float(s)
    if re.fullmatch(r"[+-]?Infinity", s):
        return -math.inf if s[0] == "-" else math.inf
    return math.nan


def js_parse_int(v: Any) -> int | None:
    """parseInt(v, 10); None for NaN."""
    m = re.match(r"^[\s﻿]*([+-]?[0-9]+)", gsjs.or_blank(v))
    return int(m.group(1)) if m else None


def _js_ms(s: Any) -> float | None:
    """Date.parse (V8) in milliseconds; None for NaN."""
    got = C._v8_parse(gsjs.or_blank(s))
    if got is None:
        return None
    year, month0, d, h, mi, sec, ms, offset = got
    days = C._days_from_civil(year + month0 // 12, month0 % 12 + 1, 1) + d - 1
    local_ms = days * 86400000 + h * 3600000 + mi * 60000 + sec * 1000 + ms
    if offset is not None:
        utc = local_ms - offset * 1000
        return float(utc) if abs(utc) <= 8.64e15 else None
    yy, mm, dd = C._civil_from_days(local_ms // 86400000)
    if not 1 <= yy <= 9998:
        return None
    at = datetime(yy, mm, dd, tzinfo=NY) + timedelta(milliseconds=local_ms % 86400000)
    return at.timestamp() * 1000.0


def _ny(ms: float) -> datetime:
    return datetime.fromtimestamp(ms / 1000.0, timezone.utc).astimezone(NY)


def fold(v: Any) -> str:
    """hubNameFold_."""
    return re.sub(r"[^a-z0-9]+", "", gsjs.or_blank(v).lower())


def text(v: Any, max_len: int = 0) -> str:
    """spText_."""
    return gsjs.text(v, max_len)


def sp_head(h: Any) -> str:
    """spHead_: case, runs of whitespace and the space before a parenthesis do not count."""
    s = gsjs.trim(re.sub(r"[\s﻿]+", " ", gsjs.or_blank(h))).lower()
    s = re.sub(r"[\s﻿]*\([\s﻿]*", "(", s)
    return re.sub(r"[\s﻿]*\)", ")", s)


def sp_day(v: Any, tz: Any = None) -> str:
    """spDay_: a Date on its sheet's zone, a US or ISO date at the start; '' otherwise."""
    if isinstance(v, hubdb.SheetTime):
        return ""
    if isinstance(v, SheetDate):
        if v.at.astimezone(NY).year < 1900:
            return ""
        return v.at.astimezone(tz or NY).strftime("%Y-%m-%d")
    s = gsjs.trim(gsjs.or_blank(v))
    us = re.match(r"(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})\b", s, re.A)
    if us:
        y = int(us.group(3))
        if y < 100:
            y += 2000
        return f"{y}-{us.group(1).zfill(2)[-2:]}-{us.group(2).zfill(2)[-2:]}"
    iso = re.match(r"(\d{4})-(\d{2})-(\d{2})", s, re.A)
    return f"{iso.group(1)}-{iso.group(2)}-{iso.group(3)}" if iso else ""


def sp_day_in(v: Any) -> str:
    """spDayIn_: the first date written anywhere in a cell."""
    s = gsjs.or_blank(v)
    m = re.search(r"(\d{1,2}/\d{1,2}/\d{2,4})", s, re.A) or re.search(r"(\d{4}-\d{2}-\d{2})", s, re.A)
    return sp_day(m.group(1)) if m else ""


def sp_instant(v: Any) -> str:
    """spInstant_."""
    if isinstance(v, SheetDate):
        return gsjs.iso(v.at)
    return gsjs.trim(gsjs.or_blank(v))


def days_between(a: Any, b: Any) -> int:
    """spDaysBetween_."""
    x, y = _js_ms(gsjs.or_text(a) + "T12:00:00Z"), _js_ms(gsjs.or_text(b) + "T12:00:00Z")
    return 0 if x is None or y is None else int(gsjs.js_round((y - x) / 86400000))


def digits10(v: Any) -> str:
    """spDigits10_."""
    d = re.sub(r"[^0-9]+", "", gsjs.or_blank(v))
    if len(d) >= 11 and d[0] == "1":
        d = d[1:]
    d = d[-10:]
    return d if len(d) == 10 else ""


def yes_no(v: Any) -> str:
    s = gsjs.trim(gsjs.or_blank(v)).lower()
    if re.fullmatch(r"y|yes|true|x|1", s):
        return "yes"
    if re.fullmatch(r"n|no|false|0", s):
        return "no"
    return ""


def is_na(v: Any) -> bool:
    return bool(re.fullmatch(r"n/?a|na|none|not applicable|not required|n-a", gsjs.trim(gsjs.or_blank(v)), re.I))


def _four(last4: Any) -> str:
    if isinstance(last4, (int, float)) and not isinstance(last4, bool) and math.isfinite(last4) and 0 <= last4 < 10000:
        return ("000" + gsjs.num_str(gsjs.js_round(last4)))[-4:]
    return re.sub(r"[^0-9]", "", gsjs.or_blank(last4))


def ssn_mask(last4: Any, ssn: Any) -> str:
    """spSsnMask_."""
    four = _four(last4)
    if len(four) == 4:
        return "•••-••-" + four
    digits = re.sub(r"[^0-9]", "", gsjs.or_blank(ssn))
    return "•••-••-" + digits[-4:] if len(digits) == 9 else ""


def licence_mask(dl: Any, state: Any) -> str:
    """spLicenceMask_."""
    raw = gsjs.trim(gsjs.or_blank(dl)).upper()
    if not raw or is_na(raw) or raw in ("NO", "NONE"):
        return ""
    st, num = "", raw
    tok = re.fullmatch(r"([A-Z]{2})[\s\-:#.]+(.+)", raw)
    if tok and tok.group(1) in US_STATES and re.search(r"[A-Z]", tok.group(2)) and re.search(r"[0-9]", tok.group(2)):
        st, num = tok.group(1), tok.group(2)
    else:
        ms = gsjs.trim(gsjs.or_blank(state)).upper()
        if ms in US_STATES:
            st = ms
    digits = re.sub(r"[^0-9]", "", num)
    if len(digits) < 6:
        return "On file"
    return (st + " " if st else "") + "•••• " + digits[-4:]


def licence_of(dl: Any, state: Any) -> tuple[str, bool]:
    """(spLicenceMask_, withheld): a copy's licence marker answers from what it kept; a bare marker kept nothing."""
    if not _marker(dl):
        return licence_mask(dl, state), False
    m = LICENCE_KEPT.fullmatch(dl)
    if not m:
        return "", True
    if m.group(1):
        return "", False
    if m.group(2):
        return "On file", False
    st = m.group(3) or ""
    if not st:
        ms = gsjs.trim(gsjs.or_blank(state)).upper()
        st = ms if ms in US_STATES else ""
    return (st + " " if st else "") + "•••• " + m.group(4), False


def bci_mask(cell: Any, tz: Any = None) -> dict[str, str]:
    """spBciMask_."""
    if isinstance(cell, SheetDate):
        return {"ref": "", "date": sp_day(cell, tz)}
    s = re.sub(r"\s+", "", gsjs.trim(gsjs.or_blank(cell)).upper())
    if not s:
        return {"ref": "", "date": ""}
    m = re.fullmatch(r"([A-Z]{2,4})([0-9]{6,})", s)
    if m:
        return {"ref": m.group(1) + "•••••" + m.group(2)[-3:], "date": ""}
    d = sp_day(cell)
    if d:
        return {"ref": "", "date": d}
    return {"ref": "On file" if len(re.sub(r"[^0-9]", "", s)) >= 6 else "", "date": ""}


def master_cell(v: Any, tz: Any = None) -> str:
    """spMasterCell_."""
    if isinstance(v, (SheetDate, hubdb.SheetTime)):
        return sp_day(v, tz)
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return gsjs.num_str(v) if math.isfinite(v) else ""
    return text(v, 200)


def flag(v: Any) -> str:
    """spFlag_."""
    s = gsjs.trim(gsjs.or_blank(v))
    if not s:
        return ""
    n = js_number(s)
    if not math.isnan(n):
        return "1" if n >= 1 else ("0.5" if n > 0 else "0")
    return s.lower()


def screen_state(cell: Any, flag_cell: Any) -> dict[str, str]:
    """spScreenState_."""
    s = gsjs.trim(gsjs.or_blank(cell))
    d = sp_day(s)
    if d:
        return {"state": "clear", "date": d}
    if s and is_na(s):
        return {"state": "na", "date": ""}
    if s and re.fullmatch(r"clear|cleared|pass|passed|ok|yes|none found|no record|no records|not listed|negative", s,
                          re.I):
        return {"state": "clear", "date": ""}
    if s:
        return {"state": "pending", "date": ""}
    f = flag(flag_cell)
    if f in ("1", "0.5"):
        return {"state": "clear", "date": ""}
    if f in ("n/a", "na"):
        return {"state": "na", "date": ""}
    return {"state": "missing", "date": ""}


def screen_join(items: list[dict]) -> dict[str, str]:
    """spScreenJoin_."""
    real = [x for x in items if x["state"] != "na"]
    if not real:
        return {"state": "na", "date": ""}
    worst = "missing" if any(x["state"] == "missing" for x in real) else (
        "pending" if any(x["state"] == "pending" for x in real) else "clear")
    date = ""
    for x in real:
        if x["date"] and x["date"] > date:
            date = x["date"]
    return {"state": worst, "date": date if worst == "clear" else ""}


def not_staff(p: dict | None) -> bool:
    """spNotStaff_."""
    if not p:
        return True
    if gsjs.trim(gsjs.or_text(p.get("guardian_for"))):
        return True
    if re.match(r"PPL_guardian_", gsjs.or_text(p.get("id"))):
        return True
    return gsjs.trim(gsjs.or_text(p.get("role"))).lower() in ("guardian", "entity", "client")


def phones_of(p: dict | None) -> list[str]:
    """spPhonesOf_."""
    out: list[str] = []
    extra = (p or {}).get("phones") if isinstance((p or {}).get("phones"), list) else []
    for v in [(p or {}).get("phone")] + list(extra):
        d = digits10(v)
        if d and d not in out:
            out.append(d)
    return out


def status_of(p: dict | None, mf: dict | None) -> str:
    """Active, pending or inactive, never a fourth word: the Employee Database Master's Admin and Other are people who
    work here, and so are People's admin and other; anything else either book says (archived, unknown, blank, a test
    row) is someone who does not, so Show inactive is what brings them back."""
    r = gsjs.trim(gsjs.or_text((p or {}).get("status"))).lower()
    m = gsjs.trim(gsjs.or_text((mf or {}).get("status"))).lower()
    if r == "active" or m in ("yes", "active"):
        return "active"
    if re.fullmatch(r"pending|onboarding|hired", r) or m in ("hired", "pending"):
        return "pending"
    if re.fullmatch(r"no|inactive|terminated", m):
        return "inactive"
    if m in ("admin", "other") or r in ("admin", "other"):
        return "active"
    return "inactive"


def status_of_rows(rows: list[dict], mf: dict | None) -> str:
    """Two People rows under one name: the best either says with the Master's row, until People keeps one."""
    said = [status_of(x, mf) for x in rows] or [status_of(None, mf)]
    return next((s for s in ("active", "pending") if s in said), "inactive")


SCRUB_KEYS = frozenset({"id", "file_id", "doc_id", "call_id", "user_id", "roster_id", "employee_id", "with"})
_SSN = re.compile(r"(^|[^0-9])[0-9]{3}[\s.-][0-9]{2}[\s.-][0-9]{4}(?=[^0-9]|$)")
_NINE = re.compile(r"(^|[^0-9])[0-9]{9}(?=[^0-9]|$)")


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
        r = v if isinstance(v, int) else gsjs.js_round(v)
        return None if len(gsjs.num_str(abs(r))) == 9 and r == v else v
    if isinstance(v, list):
        return [scrub(x) for x in v]
    if isinstance(v, dict):
        return {k: scrub(x, k) for k, x in v.items()}
    return v


def _shown(data: Any) -> Any:
    """A cell the copy withholds is Apps Script's to show."""
    if C._marked(data):
        raise Defer("the copy withholds a cell this answer shows")
    return data


def serve(what: str, build: Callable[[], Any]) -> dict[str, Any]:
    """spServe_: the read's answer; 503 names the source when the build throws."""
    got, why = _soft(build)
    if got is None:
        return {"status": 503, "message": f"{what} could not be read just now ({why})."}
    return {"status": 200, "data": _shown(scrub(got))}


def _unsure(ctx: dict, ids: tuple | list, what: str) -> None:
    """An answer that reads a Master column the copy cannot place is Apps Script's."""
    if ctx.get("master_read") and any(i in (ctx.get("_unsure") or ()) for i in ids):
        raise Defer(f"{what} reads an Employee Database Master column whose scorecard twin the copy folds into one")


# ---- the IST settings (IstConfig.gs) -------------------------------------------------------------------------------

def _cfg_bits(raw: Any) -> list[str]:
    return [b for b in (gsjs.trim(x) for x in re.split(r"[,;\n]+", gsjs.or_blank(raw))) if b]


def pairs_of(raw: Any) -> dict[str, Any] | None:
    """istCfgPairsOf_: {map, order}, or None when it holds no pair."""
    out: dict[str, str] = {}
    order: list[str] = []
    for bit in _cfg_bits(raw):
        i = bit.find("=")
        if i == -1:
            i = bit.find(":")
        if i <= 0:
            continue
        k, v = gsjs.trim(bit[:i]), gsjs.trim(bit[i + 1:])
        if not k:
            continue
        if k not in out:
            order.append(k)
        out[k] = v
    return {"map": out, "order": order} if order else None


def _cfg_int(key: str, raw: Any) -> int | None:
    m = re.fullmatch(r"(-?[0-9]+)(?:[ \t]*([A-Za-z]+))?", gsjs.trim(gsjs.or_blank(raw)))
    if not m:
        return None
    word = (m.group(2) or "").lower()
    if word:
        unit = str(CFG_SPECS.get(key, {}).get("unit") or "").lower()
        if not unit or word not in (unit, unit + "s"):
            return None
    return int(m.group(1))


def _cfg_shipped_catalogue() -> list[str]:
    return (pairs_of(CFG_SPECS["ist_cert_labels"]["value"]) or {"order": []})["order"]


def _cfg_never(spec: dict, key: str, value: str) -> bool:
    if not spec.get("never_value") or gsjs.trim(value).lower() != spec["never_value"].lower():
        return False
    k = gsjs.trim(key).lower()
    words = [w.lower() for w in spec.get("never_words") or ()]
    if k.endswith("*"):
        p = k[:-1]
        return any(w.startswith(p) or p.startswith(w) for w in words)
    return any(k.startswith(w) for w in words)


def _cfg_check(key: str, raw: Any, catalogue: list[str] | None) -> str:
    """istConfigCheck_ for the cells read here: '' when usable, else why not."""
    spec = CFG_SPECS[key]
    s = gsjs.trim(gsjs.or_blank(raw))
    if not s:
        return ""
    cat = catalogue if catalogue is not None else _cfg_shipped_catalogue()
    if spec["type"] == "int":
        n = _cfg_int(key, s)
        return "" if n is not None and spec["min"] <= n <= spec["max"] else key + " is out of range"
    got = pairs_of(s)
    if not got:
        return key + " holds no key=value pair"
    for bit in _cfg_bits(s):
        at = bit.find("=")
        if at == -1:
            at = bit.find(":")
        if at <= 0 or not gsjs.trim(bit[at + 1:]):
            return "not a key=value pair"
    if spec.get("keys") and any(k not in spec["keys"] for k in got["order"]):
        return "unknown key"
    if spec.get("key_pattern") and any(not re.search(spec["key_pattern"], k) for k in got["order"]):
        return "bad key"
    refs = list(cat) + [k for k in _cfg_shipped_catalogue() if k not in cat]
    if spec.get("values") and any(gsjs.trim(got["map"][k]).lower() not in spec["values"] for k in got["order"]):
        return "bad value"
    if spec.get("value_pattern") and any(not re.search(spec["value_pattern"], gsjs.trim(got["map"][k]))
                                         for k in got["order"]):
        return "bad column"
    if spec.get("course_values") and any(gsjs.trim(got["map"][k]) not in refs for k in got["order"]):
        return "not a course"
    if spec.get("never_value") and any(_cfg_never(spec, k, got["map"][k]) for k in got["order"]):
        return "never"
    return ""


def _cfg_resolve_one(key: str, raw: Any, catalogue: list[str] | None) -> str:
    """istConfigResolveOne_'s value."""
    spec = CFG_SPECS[key]
    s = gsjs.trim(gsjs.or_blank(raw))
    if not s:
        return spec["value"]
    if not _cfg_check(key, s, catalogue):
        return str(_cfg_int(key, s)) if spec["type"] == "int" else s
    if spec["type"] == "pairs":
        kept = [b for b in _cfg_bits(s) if not _cfg_check(key, b, catalogue)]
        if kept:
            return ", ".join(kept)
    return spec["value"]


def cfg(reads: L.Reads) -> dict[str, str]:
    """istConfigResolved_'s values for the certification cells: the tab as read, each cell resolved."""
    def read() -> dict[str, str]:
        res = reads.db.resolve(IST_CONFIG_TAB)
        raw: dict[str, str] = {}
        if res.ref is not None:
            grid = reads.db.grid(res.ref)
            head = [gsjs.trim(gsjs.or_blank(h)) for h in grid[0]]
            ik = head.index("key") if "key" in head else -1
            iv = head.index("value") if "value" in head else -1
            for line in grid[1:]:
                k = gsjs.trim(gsjs.or_text(line[ik] if ik >= 0 else ""))
                if not k:
                    continue
                v = gsjs.or_blank(line[iv] if iv >= 0 else "")
                raw[k] = "" if CFG_ERROR.match(gsjs.trim(v)) else v
        elif not res.book_known:
            raise hubdb.Unreadable("asa-hub-db holds no copy of the book behind ist_config")
        catalogue = (pairs_of(_cfg_resolve_one("ist_cert_labels", raw.get("ist_cert_labels"), None))
                     or {"order": []})["order"]
        out = {k: _cfg_resolve_one(k, raw.get(k), catalogue) for k in CFG_SPECS}
        # istCfgChoice_: a choice cell kept only when it names an allowed word
        for k, (allowed, fallback) in CFG_CHOICES.items():
            got = gsjs.trim(gsjs.or_blank(raw.get(k))).lower()
            out[k] = got if got in allowed else fallback
        return out
    return reads.once("sp_cfg", read)


def cfg_pairs(reads: L.Reads, key: str) -> dict[str, Any]:
    """istCfgPairs_."""
    return pairs_of(cfg(reads)[key]) or pairs_of(CFG_SPECS[key]["value"]) or {"map": {}, "order": []}


def cert_label(reads: L.Reads, key: Any) -> str:
    """certLabel_."""
    k = gsjs.or_text(key)
    pairs = cfg_pairs(reads, "ist_cert_labels")
    labels = pairs["map"] if pairs["order"] else CERT_LABELS
    return labels.get(k) or CERT_LABELS.get(k) or k


def cert_expiring_days(reads: L.Reads) -> int:
    """certExpiringDays_ (istCfgInt_)."""
    n = _cfg_int("ist_cert_expiring_days", cfg(reads)["ist_cert_expiring_days"])
    return n if n is not None and 1 <= n <= 365 else 60


def cert_source_tab(reads: L.Reads, which: str) -> str:
    """certSourceTab_."""
    shipped = {"trainings": "Trainings Status", "mais": "Med Del Certs (MAIS)", "master": "Master"}.get(which, "")
    return gsjs.trim(gsjs.or_text(cfg_pairs(reads, "ist_cert_source_tabs")["map"].get(which))) or shipped


def cert_source_field(reads: L.Reads, fact: str) -> str:
    """certSourceField_: the cell's column for a fact, else its shipped one."""
    named = gsjs.trim(gsjs.or_text(cfg_pairs(reads, "ist_cert_source_fields")["map"].get(fact)))
    if named:
        return named
    shipped = pairs_of(CFG_SPECS["ist_cert_source_fields"]["value"]) or {"map": {}}
    return gsjs.trim(gsjs.or_text(shipped["map"].get(fact)))


def master_name(row: dict, spec: Any) -> str:
    """The Master row's name: the configured field (master.name), else First + Last as the Master index reads it; the
    copy's Employee column is blank on every row."""
    return cert_field_of(row, spec) or text(gsjs.trim(gsjs.or_blank(row.get("first_name"))) + " "
                                            + gsjs.trim(gsjs.or_blank(row.get("last_name"))))


def cert_field_of(row: dict, spec: Any) -> str:
    """certFieldOf_: `|` tries alternatives, `+` joins columns with a space."""
    for alt in gsjs.or_text(spec).split("|"):
        joined = " ".join(x for x in (gsjs.trim(gsjs.or_blank(row.get(gsjs.trim(c)))) for c in alt.split("+")) if x)
        if joined:
            return joined
    return ""


def cert_state_of(reads: L.Reads, key: str, word: Any, fallback: str) -> str:
    """certStateOf_."""
    p = cfg_pairs(reads, key)
    w = gsjs.trim(gsjs.or_blank(word)).lower()
    star = ""
    for k0 in p["order"]:
        k = gsjs.trim(k0).lower()
        v = gsjs.trim(gsjs.or_text(p["map"].get(k0))).lower()
        if k == "*":
            star = star or v
            continue
        if k.endswith("*"):
            if w.startswith(k[:-1]):
                return v
            continue
        if k == w:
            return v
    return star or fallback


def cert_keys(reads: L.Reads) -> list[str]:
    """certKeys_."""
    p = cfg_pairs(reads, "ist_cert_labels")
    return list(p["order"]) if p["order"] else list(CERT_LABELS)


def cert_matrix_columns(reads: L.Reads) -> list[str]:
    """certMatrixColumns_: the floor, then the course list's own."""
    out: list[str] = []
    for k in list(CERT_MATRIX_COLUMNS) + cert_keys(reads):
        if k and k not in out:
            out.append(k)
    return out


# ---- the Employee Database (CERT_SOURCE_ID) --------------------------------------------------------------------------

def emp_db_id(reads: L.Reads) -> str:
    sid = reads.db.prop(CERT_SOURCE_PROP)
    if not sid:
        raise hubdb.Unreadable("no CERT_SOURCE_ID is declared in the depot")
    return sid


def _emp_tab(reads: L.Reads, tab: str) -> tuple[list[str], list[dict]]:
    """One Employee Database tab: its headers and each row's cells as getValues hands them."""
    def read() -> tuple[list[str], list[dict]]:
        ref = HT.tab_of(reads, emp_db_id(reads), tab, f"the Employee Database's {tab}")
        if ref is None:
            raise Said("the Employee Database has no " + tab + " tab")
        got = reads.db.rows(ref)
        heads = list(ref.headers)
        # rows stored without a repeated title's twins hold only its last column: read as the folded copy they are
        twins = [h for h in heads if TWIN_KEY.fullmatch(h)]
        if twins and not all(t in raw for _rn, raw in got for t in twins):
            heads = [h for h in heads if h not in twins]
        rows = [{h: hubdb.typed(raw.get(h), "estate") for h in heads} for _rn, raw in got]
        return heads, rows
    return reads.once("sp_emp:" + tab, read)


def cert_read_tab(reads: L.Reads, tab: str) -> list[dict]:
    """certReadTab_: header keys by estateKey_, cells by estateCell_; a tab not there reads as no rows."""
    def read() -> list[dict]:
        sid = emp_db_id(reads)
        ref = HT.tab_of(reads, sid, tab, f"the Employee Database's {tab}")
        if ref is None:
            return []
        keys = [hubdb.estate_key(h) for h in ref.headers]
        # a repeated header's earlier columns count toward a blank row; the key is the last column's, as in getValues
        twin = [bool(TWIN_KEY.fullmatch(h)) for h in ref.headers]
        out = []
        for _rn, raw in reads.db.rows(ref):
            row: dict[str, Any] = {}
            empty = True
            for k, h, t in zip(keys, ref.headers, twin):
                if not k:
                    continue
                v = hubdb.estate_cell(hubdb.typed(raw.get(h), "estate"))
                if v:
                    empty = False
                if not t:
                    row[k] = v
            if not empty:
                out.append(row)
        return out
    return reads.once("sp_cert:" + tab, read)


twin_base, in_sheet_order = hubdb.twin_base, hubdb.in_sheet_order


def master_columns(headers: list[str], out: dict[str, Any]) -> dict[str, str]:
    """spMasterIndexFrom_'s columns: by position inside the two blocks when the copy keeps the sheet's order…"""
    col: dict[str, str] = {}
    if in_sheet_order(headers):
        heads = [sp_head(twin_base(h)) for h in headers]
        at = heads.index("status") if "status" in heads else -1
        out["status_col"] = at != -1
        for fid, block, alts, _secret in MASTER_FIELDS:
            lo = at if block == "data" and at != -1 else 0
            hi = (0 if at == -1 else at) if block == "score" else len(heads)
            c = next((c for a in alts for c in range(lo, hi) if heads[c] == sp_head(a)), None)
            if c is None:
                out["missing"].append(fid)
            else:
                col[fid] = headers[c]
        return col
    head: dict[str, str] = {}
    for h in headers:
        head.setdefault(sp_head(h), h)
    score_alts = {sp_head(a) for _i, b, alts, _s in MASTER_FIELDS if b == "score" for a in alts}
    data_alts = {sp_head(a) for _i, b, alts, _s in MASTER_FIELDS if b == "data" for a in alts}
    twins = score_alts & data_alts
    # a repeated name keeps its earlier column as "<name> ⟨n⟩" and its last as the name itself: a name met twice is
    # the scorecard's earlier column and the data's later one, placed by name wherever the copy keeps them
    earlier: dict[str, list[str]] = {}
    for h in headers:
        m = hubdb.TWIN_KEY.fullmatch(h)
        if m:
            earlier.setdefault(sp_head(m.group(1)), []).append(h)
    status = "status" in head
    out["status_col"] = status
    # each field's column: a name only its own block uses first (SAM Database, not the scorecard's SAM)
    hits: dict[str, tuple[str, str]] = {}
    for fid, block, alts, _secret in MASTER_FIELDS:
        if block == "score" and not status:
            out["missing"].append(fid)
            continue
        other = data_alts if block == "score" else score_alts
        names = [sp_head(a) for a in alts]
        hit = next((n for n in names if n in head and n not in other), None) or next((n for n in names if n in head), None)
        if hit is None:
            out["missing"].append(fid)
            continue
        hits[fid] = (block, hit)
    blocks_of: dict[str, set[str]] = {}
    for block, hit in hits.values():
        blocks_of.setdefault(hit, set()).add(block)
    for fid, (block, hit) in hits.items():
        if hit in twins and len(earlier.get(hit, ())) == 1:
            col[fid] = earlier[hit][0] if block == "score" else head[hit]
            continue
        col[fid] = head[hit]
        # one column both blocks take: the copy folded the sheet's two into one
        if hit in twins and len(blocks_of[hit]) > 1:
            out["unsure"].add(fid)
    return col


def master_index_from(headers: list[str], rows: list[dict], tz: Any = None) -> dict[str, Any]:
    """spMasterIndexFrom_: rows keyed by First + Last (Employee when blank), masked; `unsure` the folded twins."""
    out: dict[str, Any] = {"rows": {}, "missing": [], "status_col": False, "cols": {}, "unsure": set()}
    col = master_columns(headers, out)
    # the copy keeps no column positions: a write names its column by the header as written
    for fid in EDIT_MASTER_IDS:
        if fid in col:
            out["cols"][fid] = {"at": None, "head": col[fid]}
    seen: dict[str, list[dict]] = {}
    for line in rows:
        fields: dict[str, Any] = {}
        raw: dict[str, Any] = {}
        edit: dict[str, str] = {}
        withheld: list[str] = []
        for fid in EDIT_MASTER_IDS:
            if fid in col:
                edit[fid] = hubdb.estate_cell(line.get(col[fid], ""))
        for fid, _block, _alts, secret in MASTER_FIELDS:
            if fid not in col:
                continue
            v = line.get(col[fid], "")
            if secret:
                raw[fid] = v
                continue
            s = master_cell(v, tz)
            if s:
                fields[fid] = s
        # a kept figure stands for its cell: the last four as they are, a nine-digit SSN by its last four
        k4, k9 = _kept(raw.get("ssn_last4")), _kept(raw.get("ssn"))
        last4 = (k4 if k4 and k4.isdigit() else "") if k4 is not None else raw.get("ssn_last4")
        ssn = ("00000" + k9 if k9 and k9.isdigit() else "") if k9 is not None else raw.get("ssn")
        if _bare(last4) or (len(_four(last4)) != 4 and _bare(ssn)):
            fields["ssn_masked"] = ""
            withheld.append("ssn_masked")
        else:
            fields["ssn_masked"] = ssn_mask(last4, ssn)
        fields["license_masked"], dl_withheld = licence_of(raw.get("dl"), fields.get("state"))
        if dl_withheld:
            withheld.append("license_masked")
        if _marker(raw.get("bci_fbi")):
            fields["bci_ref_masked"], fields["bci_fbi_date"] = "", ""
            withheld.append("bci_ref_masked")
        else:
            bci = bci_mask(raw.get("bci_fbi"), tz)
            fields["bci_ref_masked"], fields["bci_fbi_date"] = bci["ref"], bci["date"]
        name = text(gsjs.or_text(fields.get("first_name")) + " " + gsjs.or_text(fields.get("last_name")))
        if not name_key(name):
            name = fields.get("employee") or ""
        key = name_key(name)
        if not key:
            continue
        seen.setdefault(key, []).append({"key": key, "name": name, "ambiguous": False, "fields": fields, "edit": edit,
                                         "withheld": withheld})
    for k, found in seen.items():
        live = [x for x in found if _status_active(x["fields"])] if len(found) > 1 else found
        out["rows"][k] = live[0] if len(live) == 1 else {"key": k, "name": found[0]["name"], "ambiguous": True,
                                                         "fields": {}}
    return out


def _status_active(row: dict | None) -> bool:
    """emp360StatusActive_."""
    return gsjs.trim(gsjs.or_blank((row or {}).get("status"))).lower() in ("active", "yes")


def master_index(reads: L.Reads) -> dict[str, Any]:
    """spMasterIndex_: the Employee Database Master, masked; throws when its tab is not there."""
    def read() -> dict[str, Any]:
        headers, rows = _emp_tab(reads, cert_source_tab(reads, "master"))
        return master_index_from(headers, rows, NY)
    return reads.once("sp_master", read)


# ---- the People roster and the accounts -------------------------------------------------------------------------------

def _merge_map(reads: L.Reads) -> dict[str, str]:
    """peopleMergeMap_: signed merge decisions, alias → the kept record."""
    def read() -> dict[str, str]:
        if HT.tabled(PEOPLE_TYPES_TAB):
            cols, rows = HT.raw(reads, PEOPLE_TYPES_TAB)
            grid: list[list[Any]] = [list(cols)] + [[c.get(h, "") for h in cols] for _rn, c in rows]
        else:
            res = reads.db.resolve(PEOPLE_TYPES_TAB)
            if res.ref is None:
                if not res.book_known:
                    raise hubdb.Unreadable("asa-hub-db holds no copy of the book behind people_types")
                return {}
            grid = reads.db.grid(res.ref)
        hdr = [gsjs.trim(gsjs.or_blank(h)) for h in grid[0]]
        if not all(c in hdr for c in ("person_id", "duplicate_of", "decision")):
            return {}
        i_id, i_dup, i_dec = hdr.index("person_id"), hdr.index("duplicate_of"), hdr.index("decision")
        out: dict[str, str] = {}
        for line in grid[1:]:
            if gsjs.trim(gsjs.or_blank(line[i_dec])).lower() not in ("merge", "merged", "same", "duplicate"):
                continue
            alias = gsjs.trim(gsjs.or_text(line[i_id]))
            m = re.search(r"\(([^)]+)\)\s*$", gsjs.or_text(line[i_dup]))
            primary = gsjs.trim(m.group(1)) if m else ""
            if alias and primary and alias != primary:
                out[alias] = primary
        for alias in list(out):
            target = out.get(alias)
            if target is not None and out.get(target) == alias:
                if alias < target:
                    out.pop(alias, None)
                else:
                    out.pop(target, None)
        for alias in list(out):
            seen: set[str] = set()
            target, hops = out[alias], 0
            while out.get(target) and target not in seen:
                ok = hops < 5
                hops += 1
                if not ok:
                    break
                seen.add(target)
                target = out[target]
            out[alias] = target
        return out
    return reads.once("sp_merge_map", read)


def _collect(target: dict, field: str, value: Any, key_of: Callable[[Any], str] | None = None) -> None:
    """peopleCollect_."""
    raw = gsjs.trim(gsjs.or_blank(value))
    if not raw:
        return
    items = target.get(field) if not gsjs.falsy(target.get(field)) else []
    if not isinstance(items, list):
        raise Said("list.push is not a function")
    key = key_of(raw) if key_of else raw.lower()
    if not key:
        return
    for x in items:
        if (key_of(x) if key_of else gsjs.js_str(x).lower()) == key:
            return
    items.append(raw)
    target[field] = items


def _phone_key(v: Any) -> str:
    d = re.sub(r"[^0-9]", "", gsjs.or_blank(v))
    return d[-10:] if len(d) > 10 else d


def people_merged(reads: L.Reads, rows: list[dict]) -> list[dict]:
    """peopleMerged_: each alias row folded into its kept record (the rows are this request's own copies)."""
    mmap = _merge_map(reads)
    if not rows or not mmap:
        return rows
    by_id = {gsjs.js_str(r.get("id")): r for r in rows if r and not gsjs.falsy(r.get("id"))}
    out = []
    for row in rows:
        rid = gsjs.or_text((row or {}).get("id"))
        primary_id = mmap.get(rid)
        primary = by_id.get(primary_id) if primary_id else None
        if primary is None:
            out.append(row)
            continue
        primary["merged_from"] = ((gsjs.js_str(primary["merged_from"]) + "; ") if not gsjs.falsy(primary.get("merged_from"))
                                  else "") + gsjs.js_str(_or(row.get("name"), rid)) + " (" + rid + ")"
        _collect(primary, "phones", primary.get("phone"), _phone_key)
        _collect(primary, "emails", primary.get("email"))
        _collect(primary, "phones", row.get("phone"), _phone_key)
        _collect(primary, "emails", row.get("email"))
        _collect(primary, "also_known_as", row.get("name"))
    return out


def without_isp_clients(reads: L.Reads, rows: list[dict]) -> list[dict]:
    """withoutIspClients_: People rows whose name a plan carries are clients."""
    keys: dict[str, bool] = {}
    got, _why = _soft(lambda: C._hub(reads, "isps"))
    for r in got or []:
        k = name_key(r.get("client_name"))
        if k:
            keys[k] = True
    if not rows:
        return rows
    return [r for r in rows if not (name_key((r or {}).get("name")) and keys.get(name_key((r or {}).get("name"))))]


def _people(reads: L.Reads) -> list[dict]:
    """listRows_('people'), each row this request's own copy; a Date kept as its serial read back as a Date."""
    return [{**r, **{f: hubdb.cell_text(serial_date(r[f])) for f in PEOPLE_DATES if _is_serial(r.get(f))}}
            for r in C._hub(reads, "people")]


def roster_index(reads: L.Reads) -> dict[str, Any]:
    """spRosterIndex_: People rows that are staff, by folded name; phones by digits."""
    def read() -> dict[str, Any]:
        rows = people_merged(reads, _people(reads)) or []
        kept, _w = _soft(lambda: without_isp_clients(reads, rows))
        rows = kept if kept is not None else rows
        client_keys: dict[str, bool] = {}

        def clients() -> None:
            for c in C.derived(reads):
                k = name_key(c.get("name"))
                if k:
                    client_keys[k] = True

        _ok, why = _soft(clients)
        if why:
            client_keys.clear()
        by_key: dict[str, list[dict]] = {}
        phones: dict[str, dict[str, bool]] = {}
        for p in rows:
            if not_staff(p):
                continue
            nm = text(p.get("name")) or text(gsjs.or_text(p.get("first_name")) + " " + gsjs.or_text(p.get("last_name")))
            k = name_key(nm)
            if not k or client_keys.get(k):
                continue
            by_key.setdefault(k, []).append(p)
            for d in phones_of(p):
                phones.setdefault(d, {})[k] = True
        return {"by_key": by_key, "phones": phones}
    return reads.once("sp_roster", read)


def _parse_phones(raw: Any) -> list:
    """profileParsePhones_."""
    if isinstance(raw, list):
        return raw
    s = gsjs.str_(raw)
    if not s:
        return []
    try:
        got = json.loads(s)
        return got if isinstance(got, list) else []
    except ValueError:
        out = []
        for part in [x for x in re.split(r"\s*[;,]\s*", s) if x]:
            m = part.split(":")
            out.append({"label": gsjs.trim(m[0]), "number": gsjs.trim(":".join(m[1:]))} if len(m) > 1
                       else {"label": "Phone", "number": gsjs.trim(part)})
        return out


def _clean_phones(items: Any) -> list[dict]:
    """profileCleanPhones_."""
    out = []
    for p in items if isinstance(items, list) else []:
        get = p.get if isinstance(p, dict) else (lambda _k: None)
        number = gsjs.trim(gsjs.str_(get("number"))[:40])
        if not number:
            continue
        out.append({"label": gsjs.trim(gsjs.str_(get("label"))[:24]) or "Phone", "number": number})
    return out[:8]


def _clean_emails(items: Any) -> list[str]:
    """profileCleanEmails_ (profileParseEmails_ first when a cell)."""
    if not isinstance(items, list):
        s = gsjs.str_(items)
        if not s:
            items = []
        else:
            try:
                got = json.loads(s)
                items = got if isinstance(got, list) else []
            except ValueError:
                items = [x for x in re.split(r"\s*[;,]\s*", s) if x]
    out: list[str] = []
    seen: set[str] = set()
    for e in items:
        v = gsjs.trim(gsjs.str_(e))[:120]
        k = v.lower()
        if not v or "@" not in v or k in seen:
            continue
        seen.add(k)
        out.append(v)
    return out[:8]


# the badges Role names over the roster's word: the house manager's and every one above it, as My Info names them
LEAD_BADGES = sc.BADGE_ORDER[:sc.BADGE_ORDER.index("HM") + 1]


def badge_role(u: dict | None) -> str:
    """Role as the account's badges say it: its highest from the house manager's up, else Staff for the staff badge;
    '' when it wears neither, and the roster's word stands."""
    worn = sc.types_from_raw((u or {}).get("types"))
    top = next((b for b in LEAD_BADGES if b in worn), "")
    if top:
        return sc.badge_reads(top).title()
    return "Staff" if "STAFF" in worn else ""


def role_of(people: dict | None, account: dict | None) -> str:
    """The Role a staff profile shows: the badges' word, then the roster's, then the account's."""
    a = account or {}
    return text(_or(a.get("badge_role") if "badge_role" in a else badge_role(a), (people or {}).get("role"),
                    a.get("role"), ""))


def account_row(u: dict) -> dict[str, Any]:
    """spAccountRow_: the account fields this app may hold; a credential column is never copied."""
    return {"user_id": gsjs.str_(u.get("userid")), "email": gsjs.str_(u.get("email")),
            "role": gsjs.str_(u.get("role")) or "staff", "badge_role": badge_role(u),
            "active": gsjs.str_(u.get("active")).lower() != "false",
            "last_login": gsjs.str_(u.get("lastlogin")), "created_at": gsjs.str_(u.get("createdat")),
            "phone": gsjs.str_(u.get("phone")),
            "phones": [{"label": p["label"], "value": p["number"]} for p in _clean_phones(_parse_phones(u.get("phones")))],
            "emails": _clean_emails(u.get("emails")), "avatar": gsjs.str_(u.get("avatar"))}


def account_for(reads: L.Reads, key: str, emails: list) -> dict[str, Any]:
    """spAccountFor_: by e-mail first, else the one account carrying the name."""
    want = {gsjs.trim(gsjs.or_text(e)).lower() for e in emails if gsjs.trim(gsjs.or_text(e))}
    by_mail, named = None, []
    for u in reads.users():
        if gsjs.str_(u.get("mergedinto")) or gsjs.str_(u.get("clientkey")):
            continue
        em = gsjs.str_(u.get("email")).lower()
        if by_mail is None and em and em in want:
            by_mail = u
        if name_key(gsjs.str_(u.get("displayname"))) == key:
            named.append(u)
    pick = by_mail or (named[0] if len(named) == 1 else None)
    return {"account": account_row(pick) if pick else None,
            "candidate_id": gsjs.str_(pick.get("candidateid")) if pick else "",
            "why": "two accounts carry this name, so neither is shown" if not pick and len(named) > 1 else ""}


def person(reads: L.Reads, raw: Any) -> dict[str, Any]:
    """staffProfilesPerson_: 400 malformed, 404 unknown, 409 two records, 503 when the sources cannot say."""
    key = gsjs.trim(gsjs.or_blank(raw))
    if not re.fullmatch(r"[a-z0-9]{3,80}", key):
        return {"refused": {"status": 400, "message": "staff: a staff key."}}
    return reads.once("sp_person:" + key, lambda: _person(reads, key))


def _person(reads: L.Reads, key: str) -> dict[str, Any]:
    roster, why_r = _soft(lambda: roster_index(reads))
    roster_why = why_of("the People roster", why_r) if roster is None else ""
    hits = (roster or {}).get("by_key", {}).get(key) or []
    if len(hits) > 1:
        return {"refused": {"status": 409, "message": "Two staff records share this name — resolve them in People first."}}
    mi, why_m = _soft(lambda: master_index(reads))
    master_why = why_of("the Employee Database Master", why_m) if mi is None else ""
    m = (mi or {}).get("rows", {}).get(key) if mi else None
    master = m if m and not m.get("ambiguous") else None
    if m and m.get("ambiguous"):
        master_why = "two Master rows share this name, so neither is read"
    if not hits and not master:
        if roster is None or mi is None:
            return {"refused": {"status": 503, "message": "The staff sources could not be read just now ("
                                + "; ".join(w for w in (roster_why, master_why) if w)
                                + ") — nothing is said about this key."}}
        if m and m.get("ambiguous"):
            return {"refused": {"status": 409, "message": "Two Master rows share this name — resolve them in the "
                                "Employee Database first."}}
        return {"refused": {"status": 404, "message": NO_STAFF}}
    p = hits[0] if hits else None
    mf = master["fields"] if master else None
    name = ((p and (text(p.get("name")) or text(gsjs.or_text(p.get("first_name")) + " "
                                                + gsjs.or_text(p.get("last_name")))))
            or (master and master["name"]) or key)
    parts = name.split(" ")
    emails = [(p or {}).get("email"), (mf or {}).get("email")] + (list(p["emails"]) if p and isinstance(p.get("emails"), list)
                                                                   else [])
    acct = {"account": None, "candidate_id": "", "why": ""}
    got, why_a = _soft(lambda: account_for(reads, key, emails))
    if got is None:
        acct["why"] = why_of("the accounts", why_a)
    else:
        acct = got
    return {
        "key": key, "name": name,
        "first_name": text(_or((p or {}).get("first_name"), (mf or {}).get("first_name"), parts[0])),
        "last_name": text(_or((p or {}).get("last_name"), (mf or {}).get("last_name"), " ".join(parts[1:]))),
        "people": p, "roster_why": roster_why, "master": mf, "master_why": master_why,
        "master_missing": mi["missing"] if mi else [], "master_read": bool(mi),
        "master_edit": (master.get("edit") or {}) if master else None, "master_cols": (mi or {}).get("cols") or {},
        "account": acct["account"], "account_why": acct["why"], "candidate_id": acct["candidate_id"],
        "phones_shared": roster["phones"] if roster else {}, "status": status_of(p, mf),
        # what the copy cannot tell of this record: the Master columns it folds, the masks it withholds
        "_unsure": set(mi["unsure"]) if mi else set(), "_withheld": list(master.get("withheld") or []) if master else [],
    }


# ---- the gates -----------------------------------------------------------------------------------------------------

def reader(sess: L.Session) -> dict[str, Any]:
    """staffProfilesGate_: FAIL-CLOSED {open, scope}: the real master, or a viewer App Control released Staff to."""
    def read() -> dict[str, Any]:
        try:
            g = sc.profile_app_gate(APP_ID, sess.user, sess.reads.scope_sources())
        except Defer:
            # a client or family viewer is shown no staff member, so the scope the SSA records would draw is not needed
            u = sess.user or {}
            narrow = set(sc.badges_worn(u.get("types"), u.get("role"))) <= set(sc.VIEWER_NARROW)
            if u.get("visiting_member") or not narrow:
                raise
            return {"open": False, "scope": None}
        return g if g and g.get("open") is True and g.get("scope") else {"open": False, "scope": None}
    return sess.reads.once("sp_gate", read)


def basic_gate(gate: dict | None) -> bool:
    """spBasicGate_: a client or family viewer, held to the BASIC profile."""
    return bool(gate and gate.get("open") and gate.get("scope") and gate["scope"].get("kind") in BASIC_KINDS)


def whole_gate(sess: L.Session) -> dict | None:
    """spWholeGate_: the gate of a viewer who sees every staff member whole; else None."""
    g = reader(sess)
    return g if g["open"] and g["scope"].get("kind") in WHOLE_KINDS else None


def feature_open(sess: L.Session, feature: str) -> bool:
    """App Control's row for a part Staff splits off, FAIL-CLOSED: a viewer the row could match only on the SSA records
    (GUARDIAN worn beside a role it names) is not opened by it."""
    try:
        return sc.profile_app_gate(feature, sess.user, sess.reads.scope_sources()).get("open") is True
    except Defer:
        return False


def sees_team(sess: L.Session) -> bool:
    """App Control's Whole team row (TEAM_FEATURE): the master always; else a badge the row names."""
    if sc.is_real_master(sess.user):
        return True
    return sess.reads.once("sp_team", lambda: feature_open(sess, TEAM_FEATURE))


def own_only(sess: L.Session) -> str | None:
    """A staff-side viewer the Whole team row does not name opens their own profile alone: their key ('' when the
    session names no one, so nothing opens). None for a viewer who sees the team (the master, a badge on that row, the
    service) and for a client or family viewer, whom Staff's doors show no one."""
    if not sess.user or sess.user.get("is_service"):
        return None
    g = reader(sess)
    if not g["open"] or g["scope"].get("kind") != "all" or sees_team(sess):
        return None
    return self_key(sess.user)


def tab_open(sess: L.Session, feature: str, editions: tuple | list = ()) -> bool:
    """schedViewGate_'s rule for a tab App Control splits off Staff: the master always; else a viewer Staff shows every
    staff member whole, whose badges the tab's own row names or who holds an edition that lives in the tab (an edition
    only ever adds people). FAIL-CLOSED; the person stays the door's own to ask."""
    if sc.is_real_master(sess.user):
        return True
    if not whole_gate(sess):
        return False

    def read() -> bool:
        return feature_open(sess, feature) or bool(editions_held(sess.reads, sess.user, tuple(editions)))
    return sess.reads.once("sp_tab:" + feature + "|" + ",".join(editions), read)


def person_for(sess: L.Session, raw: Any) -> dict[str, Any]:
    """staffProfilesPerson_ behind the own-profile rule: another staff member's record is not opened to own_only."""
    own = own_only(sess)
    if own is not None and gsjs.trim(gsjs.or_blank(raw)) != own:
        return {"refused": {"status": 403, "message": OWN_ONLY_WORDS}}
    return person(sess.reads, raw)


def self_key(user: dict | None) -> str:
    """spSelfKey_."""
    if not user or user.get("is_service") or user.get("visiting_member"):
        return ""
    return fold(user.get("display_name") if user.get("display_name") is not None else user.get("displayname"))


def calendar_managers(reads: L.Reads) -> dict[str, list[str]] | None:
    """hubCalendarManagers_: folded name → the locations a current ** row names them at."""
    def read() -> dict[str, list[str]] | None:
        got = reads.calendar()
        if not got["cal"]:
            return None
        out: dict[str, list[str]] = {}
        for loc, h in L.managers_by_house(got["cal"]["values"], reads.today()).items():
            for r in h["current"]:
                k = fold(r["name"])
                if k and loc not in out.setdefault(k, []):
                    out[k].append(loc)
        return out
    return reads.once("sp_cal_managers", read)


def calendar_badges(reads: L.Reads, user: dict | None) -> list[str]:
    """hubCalendarBadges_: HM for a current ** row, unless another live account carries the name."""
    if not user or user.get("is_service"):
        return []
    key = fold(user.get("display_name") if user.get("display_name") is not None else user.get("displayname"))
    if not key:
        return []
    mmap = calendar_managers(reads)
    if not mmap or not mmap.get(key):
        return []
    uid = gsjs.js_str(user.get("id") if user.get("id") is not None else user.get("userid") or "")
    for o in reads.users():
        if gsjs.js_str(o.get("userid")) == uid:
            continue
        off = gsjs.trim(gsjs.or_blank(o.get("active"))).upper()
        if off in ("FALSE", "0", "NO") or gsjs.trim(gsjs.or_text(o.get("mergedinto"))):
            continue
        if fold(o.get("displayname")) == key:
            return []
    return ["HM"]


def training_assigner(reads: L.Reads, user: dict | None, staff_key: Any) -> str:
    """spTrainingAssigner_: 'master', 'manager' (a badge ranked HM or above), 'self', or ''."""
    if not user or user.get("is_service") or user.get("visiting_member"):
        return ""
    if sc.is_real_master(user):
        return "master"
    worn = sc.badges_worn(user.get("types"), user.get("role"))
    derived = user.get("derived_types") if isinstance(user.get("derived_types"), list) else calendar_badges(reads, user)
    worn += [b for b in derived if b not in worn]
    floor = sc.USER_TYPES.index("HM")
    if any(gsjs.or_text(b).upper() in sc.USER_TYPES and sc.USER_TYPES.index(gsjs.or_text(b).upper()) <= floor
           for b in worn):
        return "manager"
    key = gsjs.trim(gsjs.or_blank(staff_key))
    mine = self_key(user)
    return "self" if key and mine and key == mine else ""


def _family_week(today: str) -> str:
    """myFamilyWeek_('', today): the Monday of today's week."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", today or ""):
        return ""
    d = datetime.strptime(today, "%Y-%m-%d")
    return gsjs.day_shift(today, -d.weekday())


def scheduled_for_houses(reads: L.Reads, codes_in: list) -> dict[str, Any]:
    """hubStaffScheduledForHouses_: folded staff names on this week's shifts at these houses (Monday to Sunday)."""
    codes = sorted({L.house_code(c) for c in codes_in or [] if L.house_code(c)})
    week = _family_week(reads.today())
    if not codes or not week:
        return {"keys": [], "why": "", "week": week}

    def read() -> dict[str, Any]:
        end = gsjs.day_shift(week, 6)
        seen: set[str] = set()
        why = ""
        got = reads.calendar()
        if not got["cal"]:
            s = got["why"] or "the Calendar Archive could not be read"
            why = s[:1].upper() + s[1:] + "."
        else:
            values = got["cal"]["values"] or []
            head = [gsjs.trim(gsjs.or_text(h)).lower() for h in (values[0] if values else [])]

            def col(n: str, fb: int) -> int:
                return head.index(n) if n in head else fb

            c_loc, c_name, c_date = col("location", 0), col("employee", 1), col("date", 4)
            for line in values[1:]:
                line = line or []

                def at(j: int) -> Any:
                    return line[j] if 0 <= j < len(line) else None

                if L.code_of(at(c_loc)) not in codes:
                    continue
                day = L.broadcast_day(at(c_date), got["cal"].get("tz"))
                if not day or day < week or day > end:
                    continue
                nm = L.text(at(c_name))
                if not reads.is_person(nm):
                    continue
                k = name_key(nm)
                if k:
                    seen.add(k)
        return {"keys": sorted(seen), "why": why, "week": week}
    return reads.once("sp_week:" + ",".join(codes) + "|" + week, read)


def visible_to(reads: L.Reads, scope: dict | None) -> dict[str, Any]:
    """spVisibleTo_: the staff keys a narrowed viewer's houses see; short when a source could not be read."""
    codes = (scope or {}).get("house_codes") or []

    def read() -> dict[str, Any]:
        if scope and scope.get("kind") == "client":
            got, _why = _soft(lambda: scheduled_for_houses(reads, codes))
        else:
            got, _why = _soft(lambda: L.staff_visible(reads, codes))
        keys = {k for k in ((got or {}).get("keys") or []) if k}
        return {"keys": keys, "short": not got or bool(got.get("why"))}
    return reads.once("sp_visible:" + str((scope or {}).get("kind")) + ":" + ",".join(codes), read)


def basic_person(reads: L.Reads, raw: Any, scope: dict | None) -> dict[str, Any]:
    """spBasicPerson_: 400 malformed, 404 outside the staff the viewer's houses see, else the person."""
    key = gsjs.trim(gsjs.or_blank(raw))
    if not re.fullmatch(r"[a-z0-9]{3,80}", key):
        return {"refused": {"status": 400, "message": "staff: a staff key."}}
    if key not in visible_to(reads, scope)["keys"]:
        return {"refused": {"status": 404, "message": NO_STAFF}}
    return person(reads, key)


# ---- the stores ------------------------------------------------------------------------------------------------------

def client_rows(reads: L.Reads) -> list[dict]:
    """spClientRows_: clients narrowed to identity."""
    def read() -> list[dict]:
        return [{"client_key": gsjs.trim(gsjs.or_text(c.get("client_key"))) or name_key(c.get("name")),
                 "client_id": gsjs.or_text(c.get("id")), "name": text(c.get("name")),
                 "house": text(_or(c.get("house"), c.get("houseName"))), "home_address": text(c.get("home_address")),
                 "status": text(c.get("status")), "avatar": gsjs.or_text(c.get("avatar"))} for c in C.derived(reads)]
    return reads.once("sp_client_rows", read)


def ist_rows(reads: L.Reads) -> list[dict]:
    """spIstRows_ (listRows_('istRecords')), a Date the copy keeps as its serial read back as a Date."""
    def read() -> list[dict]:
        return [{**r, **{f: hubdb.cell_text(serial_date(r[f])) for f in IST_DATES if _is_serial(r.get(f))}}
                for r in reads.ist_rows()]
    return reads.once("sp_ist_rows", read)


def ist_mine(reads: L.Reads, ctx: dict) -> list[dict]:
    """spIstMine_."""
    return [r for r in ist_rows(reads) if name_key(r.get("staffName")) == ctx["key"]]


def ist_cell(r: dict, by_key: dict) -> dict[str, Any]:
    """spIstCell_."""
    c = by_key.get(name_key(r.get("clientName")))
    st = L.cell(r.get("status")).lower()
    return {"id": L.cell(r.get("id")), "client_key": c["client_key"] if c else "", "client_name": text(r.get("clientName")),
            "house": L.house_code(r.get("house")) or text(r.get("house")), "status": "done" if st == "done" else "owed",
            "due": sp_day(L.cell(r.get("dueDate"))), "trained_at": sp_day(L.cell(r.get("trainedAt"))),
            "doc_id": L.cell(r.get("docFileId")) or None}


def own_rows(reads: L.Reads, tab: str, key: str) -> list[dict]:
    """spOwnRows_: a tab of ours as rows for one staff key; [] while the tab is unborn; its own table once kept there."""
    res = HT.where(reads, tab)
    if res.runtime:
        raise Defer(f"{tab} lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
    return [r for r in reads.db.locations_rows(res.ref) if gsjs.or_text(r.get("staff_key")) == key]


def _photo_index(reads: L.Reads) -> dict[str, str]:
    got, _why = _soft(lambda: C.photo_index(reads))
    return got or {}


# ---- the roster ----------------------------------------------------------------------------------------------------

def roster_build(reads: L.Reads, with_inactive: bool) -> dict[str, Any]:
    """spRosterBuild_: every staff member from People and the Employee Database Master."""
    why: list[str] = []
    roster, w = _soft(lambda: roster_index(reads))
    if roster is None:
        why.append(why_of("the People roster", w))
    mi, w = _soft(lambda: master_index(reads))
    if mi is None:
        why.append(why_of("the Employee Database Master", w))
    if roster is None and mi is None:
        raise Said("; ".join(why))
    by_mail: dict[str, dict] = {}
    acct_named: dict[str, list[dict]] = {}

    def accounts() -> None:
        for u in reads.users():
            if gsjs.str_(u.get("mergedinto")) or gsjs.str_(u.get("clientkey")):
                continue
            em = gsjs.str_(u.get("email")).lower()
            if em and em not in by_mail:
                by_mail[em] = u
            k = name_key(gsjs.str_(u.get("displayname")))
            if k:
                acct_named.setdefault(k, []).append(u)

    _ok, w = _soft(accounts)
    if w:
        why.append(why_of("the accounts", w))
    photos = _photo_index(reads)
    ist_avatar: dict[str, str] = {}

    def avatars() -> None:
        for r in ist_rows(reads):
            k = name_key(r.get("staffName"))
            if k and k not in ist_avatar and gsjs.or_text(r.get("avatar")):
                ist_avatar[k] = gsjs.or_text(r.get("avatar"))

    _ok, w = _soft(avatars)
    if w:
        ist_avatar = {}
    keys = list(dict.fromkeys(list((roster or {}).get("by_key", {})) + list((mi or {}).get("rows", {}))))
    staff: list[dict] = []
    counts = {"active": 0, "inactive": 0, "ambiguous": 0}
    for k in keys:
        rows = (roster or {}).get("by_key", {}).get(k) or []
        m = (mi or {}).get("rows", {}).get(k)
        mf = m["fields"] if m and not m.get("ambiguous") else None
        ambiguous = len(rows) > 1 or (not rows and bool(m) and bool(m.get("ambiguous")))
        p = rows[0] if len(rows) == 1 else None
        name = (p and text(p.get("name"))) or (m and m["name"]) or (rows[0] and text(rows[0].get("name")) if rows else "") or k
        status = status_of_rows(rows, mf) if ambiguous else status_of(p, mf)
        if ambiguous:
            counts["ambiguous"] += 1
        if status == "inactive":
            counts["inactive"] += 1
        else:
            counts["active"] += 1
        if status == "inactive" and not with_inactive:
            continue
        acct = None
        for e in ((p or {}).get("email"), (mf or {}).get("email")):
            em = gsjs.trim(gsjs.or_text(e)).lower()
            if acct is None and em and em in by_mail:
                acct = by_mail[em]
        if acct is None and len(acct_named.get(k) or []) == 1:
            acct = acct_named[k][0]
        parts = name.split(" ")
        row = {"key": k, "name": name,
               "first_name": text(_or((p or {}).get("first_name"), (mf or {}).get("first_name"), parts[0])),
               "last_name": text(_or((p or {}).get("last_name"), (mf or {}).get("last_name"), " ".join(parts[1:]))),
               "status": status, "role": role_of(p, acct),
               "avatar": P.of(reads, "staff", k, _or(gsjs.str_(acct.get("avatar")) if acct else "",
                                                     gsjs.or_text((p or {}).get("avatar")), photos.get(k),
                                                     ist_avatar.get(k), "")),
               "employee_id": _or((mf or {}).get("employee_id"), gsjs.or_text((p or {}).get("employee_id")) if p else "", "")}
        if ambiguous:
            row["ambiguous"] = True
        staff.append(row)
    staff.sort(key=by_name(lambda r: r["name"]))
    return {"staff": staff, "counts": counts, "why": "; ".join(why), "degraded": len(why) > 0}


def roster_for(reads: L.Reads, data: dict, gate: dict) -> dict[str, Any]:
    """spRosterFor_: the whole roster as 'full'; a narrowed viewer's as 'basic'."""
    if not basic_gate(gate):
        return {**data, "view": "full"}
    seen = visible_to(reads, gate["scope"])
    counts = {"active": 0, "inactive": 0, "ambiguous": 0}
    staff = []
    for r in data.get("staff") or []:
        if r["key"] not in seen["keys"]:
            continue
        if r.get("ambiguous"):
            counts["ambiguous"] += 1
        if r["status"] == "inactive":
            counts["inactive"] += 1
        else:
            counts["active"] += 1
        o = {"key": r["key"], "name": r["name"], "first_name": r["first_name"], "last_name": r["last_name"],
             "status": r["status"], "role": r["role"], "avatar": r["avatar"]}
        if r.get("ambiguous"):
            o["ambiguous"] = True
        staff.append(o)
    short = seen["short"] or bool(data.get("degraded"))
    return {"staff": staff, "counts": counts, "view": "basic", "degraded": short,
            "why": "Not every record of who works at your house could be read just now, so this list may be short."
            if short else ""}


def roster_answer(reads: L.Reads, gate: dict, with_inactive: bool) -> dict[str, Any]:
    """spRosterAnswer_."""
    data, why = _soft(lambda: reads.once("sp_roster_build:" + str(with_inactive),
                                         lambda: scrub(roster_build(reads, with_inactive))))
    if data is None:
        return {"status": 503, "message": f"The staff list could not be read just now ({why})."}
    return {"status": 200, "data": _shown(roster_for(reads, data, gate))}


# ---- shifts --------------------------------------------------------------------------------------------------------

def shift_facts(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spShiftFacts_: the one port of spShiftsBuild_ (staff_comms), held once per request."""
    import staff_comms as SC  # noqa: PLC0415 - the two modules lean on each other
    return reads.once("sp_shifts:" + ctx["key"], lambda: scrub(SC.shifts_build(reads, ctx)))


# ---- driving and MAIS ----------------------------------------------------------------------------------------------

def day_or_words(v: Any, tz: Any = None) -> str:
    """spDayOrWords_."""
    d = sp_day(v, tz)
    return d if (d or isinstance(v, (SheetDate, hubdb.SheetTime)) or is_na(v)) else text(v, 40)


def date_state(expires: str, window: int, today: str) -> str:
    """spDateState_."""
    if not expires:
        return "no_date"
    if expires < today:
        return "expired"
    if days_between(today, expires) <= window:
        return "due_soon"
    return "current"


def day_state(day: Any, today: str, window: int) -> str:
    """spDayState_."""
    return date_state(day, window, today) if today and re.fullmatch(r"\d{4}-\d{2}-\d{2}", gsjs.or_text(day)) else ""


def points(v: Any) -> dict[str, Any]:
    """spPoints_."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return {"n": v if math.isfinite(v) else None, "note": ""}
    s = text(v, 40)
    if not s or is_na(s):
        return {"n": None, "note": ""}
    return {"n": js_number(s), "note": ""} if re.fullmatch(r"\d+(\.\d+)?", s, re.A) else {"n": None, "note": s}


def driver_yes(word: Any) -> bool | None:
    """spDriverYes_."""
    s = text(word)
    if not s:
        return None
    return not (bool(re.fullmatch(r"no|none|not a driver", s, re.I)) or is_na(s))


def standing(word: Any, source: str) -> dict[str, str]:
    """spStanding_."""
    w = text(word, 60)
    s = w.lower()
    state = ("invalid" if re.search(r"suspend|fail|reinstat|revok|expir|cancel|invalid|denied|restrict", s)
             else "valid" if re.fullmatch(r"yes|valid|active|current|ok", s)
             else "none" if re.fullmatch(r"no|none", s) or is_na(w) else "other")
    return {"word": w, "state": state, "source": source}


def driver_index_from(headers: list[str], rows: list[dict], tz: Any = None) -> dict[str, Any]:
    """spDriverIndexFrom_: a driving tab keyed by the folded Employee cell and by First + Last."""
    out: dict[str, Any] = {"rows": {}, "missing": [], "unsure": set()}
    head = {}
    for h in headers:
        head.setdefault(sp_head(h), h)
    col: dict[str, str] = {}
    for fid, alts in DRIVER_FIELDS:
        hit = next((sp_head(a) for a in alts if sp_head(a) in head), None)
        if hit is None:
            out["missing"].append(fid)
        else:
            col[fid] = head[hit]
    for r, line in enumerate(rows, start=1):
        def cell(fid: str) -> Any:
            return line.get(col[fid], "") if fid in col else ""

        pts = points(cell("points"))
        dl_last4, dl_withheld = licence_of(cell("dl"), "")
        fields = {"driver": text(cell("driver"), 60), "dl_last4": dl_last4,
                  "points": pts["n"], "points_note": pts["note"], "license_exp": day_or_words(cell("license_exp"), tz),
                  "abstract_original": day_or_words(cell("abstract_original"), tz),
                  "abstract_latest": day_or_words(cell("abstract_latest"), tz),
                  "insurance_exp": day_or_words(cell("insurance_exp"), tz), "_dl_withheld": dl_withheld}
        said = (fields["driver"] or fields["dl_last4"] or fields["points"] is not None or fields["points_note"]
                or fields["license_exp"] or fields["abstract_original"] or fields["abstract_latest"]
                or fields["insurance_exp"])
        if not said and not dl_withheld:
            continue
        keys: list[str] = []
        for n in (text(gsjs.or_text(cell("first_name")) + " " + gsjs.or_text(cell("last_name"))), text(cell("employee"))):
            k = name_key(n)
            if k and k not in keys:
                keys.append(k)
        for k in keys:
            # a row whose only fact is a withheld licence may be no row at all
            if not said:
                out["unsure"].add(k)
            out["rows"][k] = {"ambiguous": True, "fields": {}} if k in out["rows"] else \
                {"ambiguous": False, "fields": fields, "row": r}
    out["cols"] = col
    return out


def driver_index(reads: L.Reads, tab: str) -> dict[str, Any]:
    """spDriverIndex_: a driving tab's masked index; throws when the tab is not there."""
    def read() -> dict[str, Any]:
        headers, rows = _emp_tab(reads, tab)
        return driver_index_from(headers, rows, NY)
    return reads.once("sp_driver:" + tab, read)


def driving_from(key: str, main: dict, comp: dict, today: str, window: int) -> dict[str, Any]:
    """spDrivingFrom_: employee driver for the facts, Driver Compliance for the licence standing."""
    out: dict[str, Any] = {"found": False, "ambiguous": False, "driver": None, "driver_word": "",
                           "driver_standing": None, "points": None, "points_note": "", "license_expires": "",
                           "license_state": "", "abstract_original": "", "abstract_latest": "", "insurance_expires": "",
                           "insurance_state": "", "license_standing": None, "standing_ambiguous": False,
                           "dl_last4": "", "source": "", "unread": [], "why": "", "degraded": False}
    why: list[str] = []

    def unread(tab: str, line: str) -> None:
        why.append(line)
        out["unread"].append(tab)
        out["degraded"] = True
        return None

    def pick(read: dict, tab: str, matter: tuple) -> Any:
        if not read or not read.get("index"):
            return unread(tab, (read or {}).get("why") or "the " + tab + " tab could not be read")
        missing = read["index"]["missing"]
        if "employee" in missing and ("first_name" in missing or "last_name" in missing):
            return unread(tab, "the " + tab + " tab has no Employee or First and Last Name column, so no row can be "
                               "matched")
        gone = [i for i in missing if i in matter]
        if gone:
            why.append("the " + tab + " tab has no column for " + ", ".join(gone))
        if key in read["index"]["unsure"]:
            raise Defer("the copy withholds the licence number that decides this person's driving row")
        hit = read["index"]["rows"].get(key)
        if hit and hit["ambiguous"]:
            why.append("two rows of the " + tab + " tab carry this name, so neither is read")
            return "ambiguous"
        return hit["fields"] if hit else None

    m = pick(main, DRIVER_TAB, ("driver", "dl", "points", "license_exp", "abstract_original", "abstract_latest",
                                "insurance_exp"))
    c = pick(comp, DRIVER_COMPLIANCE_TAB, ("driver",))
    if m == "ambiguous":
        out["ambiguous"], m = True, None
    if c == "ambiguous":
        out["standing_ambiguous"], c = True, None
    row = None if out["ambiguous"] else (m or c)
    if row:
        if row.get("_dl_withheld"):
            raise Defer("the copy withholds the licence number this driving card shows masked")
        out["found"] = True
        out["source"] = DRIVER_TAB if m else DRIVER_COMPLIANCE_TAB
        out["driver_word"] = row.get("driver") or ""
        out["driver"] = driver_yes(row.get("driver"))
        out["points"] = row["points"] if "points" in row else None
        out["points_note"] = row.get("points_note") or ""
        out["license_expires"] = row.get("license_exp") or ""
        out["abstract_original"] = row.get("abstract_original") or ""
        out["abstract_latest"] = row.get("abstract_latest") or ""
        out["insurance_expires"] = row.get("insurance_exp") or ""
        out["dl_last4"] = row.get("dl_last4") or ""
    if not out["ambiguous"]:
        own = standing(m["driver"], DRIVER_TAB) if (m and m.get("driver") and not re.fullmatch(r"yes|no", m["driver"], re.I)
                                                    and not is_na(m["driver"])) else None
        if c and c.get("driver"):
            out["license_standing"] = standing(c["driver"], DRIVER_COMPLIANCE_TAB)
            if own and own["word"].lower() != out["license_standing"]["word"].lower():
                out["driver_standing"] = own
        else:
            out["license_standing"] = own
    out["license_state"] = day_state(out["license_expires"], today, window)
    out["insurance_state"] = day_state(out["insurance_expires"], today, window)
    out["why"] = "; ".join(w for w in why if w)
    return out


def driving_part(reads: L.Reads, key: str, today: str, window: int) -> dict[str, Any]:
    """spDrivingPart_."""
    def read(tab: str) -> dict[str, Any]:
        got, why = _soft(lambda: driver_index(reads, tab))
        return {"index": got, "why": ""} if got is not None else {"index": None, "why": why_of("the " + tab + " tab", why)}
    return driving_from(key, read(DRIVER_TAB), read(DRIVER_COMPLIANCE_TAB), today, window)


def mais_day(v: Any) -> str:
    """spMaisDay_: an instant on the Ohio clock; a US or ISO date as written."""
    s = gsjs.trim(gsjs.or_blank(v))
    if re.match(r"\d{4}-\d{2}-\d{2}T", s, re.A):
        ms = _js_ms(s)
        if ms is not None:
            return _ny(ms).strftime("%Y-%m-%d")
    return sp_day(s)


def mais_rank(level: Any) -> int:
    """spMaisRank_: the trailing roman or arabic number; 99 when none."""
    m = re.search(r"(?:^|[\s\-])([ivx]+|[0-9]+)\s*\Z", gsjs.trim(gsjs.or_blank(level)), re.I)
    if not m:
        return 99
    if re.fullmatch(r"[0-9]+", m.group(1)):
        return int(m.group(1))
    val = {"i": 1, "v": 5, "x": 10}
    s, n = m.group(1).lower(), 0
    for i, ch in enumerate(s):
        cur, nxt = val[ch], val.get(s[i + 1], 0) if i + 1 < len(s) else 0
        n += -cur if cur < nxt else cur
    return n


def _cmp(a: Any, b: Any) -> int:
    """spCmp_."""
    a, b = gsjs.or_text(a), gsjs.or_text(b)
    return -1 if a < b else (1 if a > b else 0)


def _mais_has(row: dict | None, spec: str) -> bool:
    return any(all(gsjs.trim(c) in (row or {}) for c in alt.split("+")) for alt in gsjs.or_text(spec).split("|"))


def mais_specs(reads: L.Reads) -> dict[str, str]:
    """spMaisSpecs_."""
    return {"name": cert_source_field(reads, "mais.name") or "name",
            "status": cert_source_field(reads, "mais.status") or "status",
            "expires": cert_source_field(reads, "mais.expires") or "expiration",
            "level": cert_source_field(reads, "mais.category") or "cert_type"}


def mais_from(reads: L.Reads, rows: list[dict], key: str, today: str, window: int) -> dict[str, Any]:
    """spMaisFrom_: the person's MAIS certifications, one per level, the newest record speaking."""
    f = mais_specs(reads)
    out: dict[str, Any] = {"certs": [], "history": 0, "matched_by": "", "ambiguous": False, "source": "", "why": "",
                           "degraded": False}
    first = rows[0] if rows else None
    if first:
        gone: list[str] = []
        blind = False
        if not _mais_has(first, f["name"]) and not _mais_has(first, MAIS_SEARCH):
            gone.append(f["name"] + " or " + MAIS_SEARCH)
            blind = True
        if not _mais_has(first, MAIS_ID):
            gone.append(MAIS_ID)
            blind = True
        if not _mais_has(first, f["status"]):
            gone.append(f["status"])
            blind = True
        for spec in (f["level"], f["expires"], MAIS_EFFECTIVE):
            if not _mais_has(first, spec):
                gone.append(spec)
        if gone:
            out["why"] = "the MAIS scrape has no column for " + ", ".join(gone) + (
                ", so no certification is shown" if blind else "")
            out["degraded"] = True
            if blind:
                return out
    by_name_: list[dict] = []
    by_search: list[dict] = []
    for r in rows or []:
        via_name = name_key(cert_field_of(r, f["name"])) == key
        if not via_name and name_key(cert_field_of(r, MAIS_SEARCH)) != key:
            continue
        word = cert_field_of(r, f["status"])
        state = cert_state_of(reads, "ist_cert_mais_statuses", word, "expired")
        if state == "skip":
            continue
        (by_name_ if via_name else by_search).append({
            "level": text(cert_field_of(r, f["level"]), 40), "effective": mais_day(cert_field_of(r, MAIS_EFFECTIVE)),
            "expires": mais_day(cert_field_of(r, f["expires"])), "certified": state == "certified",
            "word": text(word, 60), "id": cert_field_of(r, MAIS_ID), "stamp": cert_field_of(r, MAIS_STAMP),
            "row": r.get("_row")})
    matched = by_name_ + by_search
    # a kept tag tells two records apart as their ids do; only a bare marker cannot
    if len(matched) > 1 and any(_bare(x["id"]) for x in matched):
        # nothing else answers for a profile: the block says why, and the rest of the profile stands
        out["ambiguous"] = True
        out["why"] = "; ".join(w for w in (out["why"], "the copy withholds the DD IDs that tell this person's MAIS "
                                                         "records apart, so none is shown until it carries them again")
                               if w)
        return out

    def ids_of(items: list[dict]) -> dict[str, bool]:
        return {"i:" + x["id"]: True for x in items if x["id"]}

    name_ids, search_ids = ids_of(by_name_), ids_of(by_search)
    if by_name_ and search_ids and not any(k in search_ids for k in name_ids):
        out["ambiguous"] = True
        out["why"] = "; ".join(w for w in (out["why"], "the registry name and the searched name point at different "
                                                         "DODD records, so none is shown") if w)
        return out
    mine = by_name_ or by_search
    out["matched_by"] = "name" if by_name_ else ("search" if by_search else "")
    n = len(name_ids if by_name_ else search_ids)
    if n > 1:
        out["ambiguous"] = True
        out["why"] = "; ".join(w for w in (out["why"], f"{n} DODD registry records (different DD IDs) carry this name, "
                                                         "so none is shown") if w)
        return out
    groups: dict[str, list[dict]] = {}
    for x in mine:
        groups.setdefault("l:" + x["level"], []).append(x)
    certs = []
    for items in groups.values():
        seen: set[str] = set()
        ordered = sorted(items, key=functools.cmp_to_key(
            lambda a, b: _cmp(b["expires"], a["expires"]) or _cmp(b["effective"], a["effective"])
            or _cmp(b["stamp"], a["stamp"])))
        kept = []
        for x in ordered:
            k = "r:" + x["id"] + "|" + x["effective"] + "|" + x["expires"]
            if k in seen:
                continue
            seen.add(k)
            kept.append(x)
        top = kept[0]
        expired = not top["certified"] or (bool(top["expires"]) and top["expires"] < today)
        cert = {"level": top["level"] or "Not stated", "effective": top["effective"], "expires": top["expires"],
                "status": "certified" if top["certified"] else "expired", "word": top["word"], "expired": expired,
                "due_soon": not expired and day_state(top["expires"], today, window) == "due_soon",
                "older": len(kept) - 1}
        if top["row"] is not None:
            cert["row"] = top["row"]
        certs.append(cert)
    certs.sort(key=functools.cmp_to_key(lambda a, b: (mais_rank(a["level"]) - mais_rank(b["level"]))
                                        or _cmp(a["level"], b["level"])))
    out["certs"] = certs
    out["history"] = sum(c["older"] for c in certs)
    return out


def mais_part(reads: L.Reads, key: str, today: str, window: int) -> dict[str, Any]:
    """spMaisPart_."""
    tab = ""

    def read() -> list[dict]:
        nonlocal tab
        tab = cert_source_tab(reads, "mais")
        return cert_read_tab(reads, tab)

    rows, why = _soft(read)
    if rows is None:
        return {"certs": [], "history": 0, "matched_by": "", "ambiguous": False, "source": tab,
                "why": why_of("the " + (tab or "MAIS") + " tab", why), "degraded": True}
    out = mais_from(reads, rows, key, today, window)
    out["source"] = tab
    if not rows:
        out["why"] = "the " + tab + " tab read no rows (missing, renamed or empty)"
        out["degraded"] = True
    return out


# ---- overview ------------------------------------------------------------------------------------------------------

def contacts(ctx: dict) -> dict[str, list]:
    """spContacts_: the account's, then People's, then the Master's; one per number or address."""
    phones: list[dict] = []
    emails: list[dict] = []
    seen_p: set[str] = set()
    seen_e: set[str] = set()

    def add_p(label: Any, value: Any) -> None:
        v = text(value, 40)
        k = digits10(v) or re.sub(r"[^0-9]", "", v)
        if not v or not k or k in seen_p:
            return
        seen_p.add(k)
        phones.append({"label": text(label, 24) or "Phone", "value": v})

    def add_e(label: str, value: Any) -> None:
        v = text(value, 120)
        k = v.lower()
        if not v or "@" not in v or k in seen_e:
            return
        seen_e.add(k)
        emails.append({"label": label, "value": v})

    a, p, m = ctx.get("account"), ctx.get("people"), ctx.get("master")
    if a:
        for x in a.get("phones") or []:
            add_p(x.get("label"), x.get("value"))
        add_p("Phone", a.get("phone"))
        add_e("Sign-in", a.get("email"))
        for e in a.get("emails") or []:
            add_e("Email", e)
    if p:
        add_p("Phone", p.get("phone"))
        for x in p.get("phones") if isinstance(p.get("phones"), list) else []:
            add_p("Phone", x)
        add_e("Email", p.get("email"))
        for e in p.get("emails") if isinstance(p.get("emails"), list) else []:
            add_e("Email", e)
    if m:
        add_p("Phone", m.get("phone"))
        add_e("Email", m.get("email"))
    return {"phones": phones, "emails": emails}


def _window(reads: L.Reads) -> int:
    got, _why = _soft(lambda: cert_expiring_days(reads))
    return 60 if got is None else got


def overview_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spOverviewBuild_: details, every contact, the clients and houses, the ISTs, open notes, driving and MAIS."""
    why = [w for w in (ctx["roster_why"], ctx["master_why"], ctx["account_why"]) if w]
    degraded = bool(ctx["roster_why"]) or not ctx["master_read"]
    m, p, a = ctx.get("master") or {}, ctx.get("people") or {}, ctx.get("account") or {}
    facts, w = _soft(lambda: shift_facts(reads, ctx))
    if facts is None:
        why.append(why_of("the shifts", w))
        degraded = True
    shifts = facts["shifts"] if facts else {"houses": [], "why": ""}
    if facts and facts.get("degraded"):
        degraded = True
    rows, w = _soft(lambda: client_rows(reads))
    if rows is None:
        why.append(why_of("the clients", w))
        degraded = True
    by_key: dict[str, dict] = {}
    for c in rows or []:
        k = name_key(c["name"])
        if k and k not in by_key:
            by_key[k] = c
    ist_rows, w = _soft(lambda: ist_mine(reads, ctx))
    if ist_rows is None:
        why.append(why_of("the IST records", w))
        degraded = True
        ist_rows = []
    ist = sorted((ist_cell(r, by_key) for r in ist_rows), key=by_name(lambda x: x["client_name"]))
    # the clients worked with at least once: a punch of theirs names the client, or they worked a past shift at a home
    # one client alone lives in (the punches begin on 2026-06-07 and miss days the PSI read missed). An IST, a house
    # only scheduled ahead, or a shift at a house several clients share, ties nobody: there only a punch tells who.
    clients: dict[str, dict] = {}
    homes_of: dict[str, list[str]] = {}
    unknown_n = 0

    def add(nm: Any, via: str) -> dict | None:
        nonlocal unknown_n
        c = by_key.get(name_key(nm))
        if not c:
            if rows is not None:
                unknown_n += 1
            return None
        o = clients.setdefault(c["client_key"], {"client_key": c["client_key"], "client_id": c["client_id"],
                                                 "name": c["name"], "avatar": c["avatar"], "house": c["house"],
                                                 "via": []})
        if via not in o["via"]:
            o["via"].append(via)
        return o

    for n in (facts["consumers"] if facts else []):
        add(n, "punches")
    worked = {h["code"]: h for h in shifts.get("houses") or [] if h["first_day"]}
    if rows is not None and worked:
        homes_got, _w = _soft(reads.homes)
        homes = {h["code"]: h for h in homes_got or []}
        for code in worked:
            at = L.clients_at(code, homes.get(code), rows)
            if len(at) == 1:
                o = add(at[0]["name"], "house")
                if o is not None:
                    homes_of.setdefault(o["client_key"], []).append(code)
    if unknown_n:
        why.append(f"{unknown_n} client name(s) on the punches match no client record")
    # the first and the last day worked with each client: the punches that name them and the shifts at their own home
    spans = (facts or {}).get("consumer_days") or {}
    for o in clients.values():
        days = list(spans.get(name_key(o["name"])) or [])
        for code in homes_of.get(o["client_key"], []):
            days += [worked[code]["first_day"], worked[code]["last_day"]]
        days = [d for d in days if d]
        o["first_day"], o["last_day"] = (min(days), max(days)) if days else ("", "")
    notes, w = _soft(lambda: [n for n in own_rows(reads, NOTES_TAB, ctx["key"]) if (n.get("state") or "open") == "open"])
    if notes is None:
        why.append(why_of("the staff notes", w))
    notes_open = len(notes or [])
    cont = contacts(ctx)
    emp_id = m.get("employee_id") or ""
    emp_src = "master" if emp_id else ""
    if not emp_id and not gsjs.falsy(p.get("employee_id")):
        emp_id, emp_src = gsjs.js_str(p.get("employee_id")), "roster"
    photos = _photo_index(reads)
    today, window = reads.today(), _window(reads)
    driving = driving_part(reads, ctx["key"], today, window)
    med_del = mais_part(reads, ctx["key"], today, window)
    if driving["degraded"]:
        why.append("the driving record is not read in full (see Driver)")
        degraded = True
    if med_del["degraded"]:
        why.append("the MAIS record is not read in full (see Med Del (MAIS))")
        degraded = True
    return {
        "person": {"key": ctx["key"], "name": ctx["name"], "first_name": ctx["first_name"], "last_name": ctx["last_name"],
                   "employee_id": emp_id, "employee_id_source": emp_src, "roster_id": gsjs.or_text(p.get("id")),
                   "role": role_of(p, a), "status": ctx["status"],
                   "start_date": sp_day(m.get("start_first_day")) or sp_day(m.get("start_doc")) or sp_day(p.get("start_date")),
                   "end_date": sp_day(m.get("end_last_day")) or sp_day(p.get("end_date")),
                   "avatar": P.of(reads, "staff", ctx["key"],
                                  _or(a.get("avatar"), gsjs.or_text(p.get("avatar")), photos.get(ctx["key"]), "")),
                   "phones": cont["phones"], "emails": cont["emails"]},
        "clients": sorted(clients.values(), key=by_name(lambda x: x["name"])),
        "houses": shifts.get("houses") or [], "ist": ist, "notes_open": notes_open, "driving": driving, "med_del": med_del,
        "why": "; ".join(why + ([shifts["why"]] if shifts.get("why") else [])), "degraded": degraded}


def basic_build(reads: L.Reads, ctx: dict, scope: dict | None) -> dict[str, Any]:
    """spBasicBuild_: name, photo, role, and the ISTs of the viewer's own clients."""
    p, a = ctx.get("people") or {}, ctx.get("account") or {}
    photos = _photo_index(reads)
    mine = {k for k in (scope or {}).get("client_keys") or [] if k}

    def ist_read() -> list[dict]:
        by_key: dict[str, dict] = {}
        for c in client_rows(reads):
            k = name_key(c["name"])
            if k and k not in by_key:
                by_key[k] = c
        cells = [ist_cell(r, by_key) for r in ist_mine(reads, ctx)]
        kept = [{"id": x["id"], "client_key": x["client_key"], "client_name": x["client_name"], "house": x["house"],
                 "status": x["status"], "due": x["due"], "trained_at": x["trained_at"]}
                for x in cells if x["client_key"] and x["client_key"] in mine]
        return sorted(kept, key=by_name(lambda x: x["client_name"]))

    ist, why = _soft(ist_read)
    degraded = ist is None
    return {"person": {"key": ctx["key"], "name": ctx["name"], "first_name": ctx["first_name"],
                       "last_name": ctx["last_name"], "role": role_of(p, a),
                       "status": ctx["status"],
                       "avatar": P.of(reads, "staff", ctx["key"],
                                      _or(a.get("avatar"), gsjs.or_text(p.get("avatar")), photos.get(ctx["key"]), ""))},
            "ist": ist or [], "view": "basic", "why": "The trainings could not be read just now." if degraded else "",
            "degraded": degraded}


def basic_answer(reads: L.Reads, raw: Any, scope: dict | None) -> dict[str, Any]:
    """spBasicAnswer_: the BASIC profile, or the refusal; what the sources failed on is never the viewer's."""
    busy = {"status": 503, "message": "The staff profile could not be read just now — try again in a minute."}
    seen = basic_person(reads, raw, scope)
    if seen.get("refused"):
        return busy if seen["refused"]["status"] == 503 else seen["refused"]
    got, _why = _soft(lambda: basic_build(reads, seen, scope))
    return busy if got is None else {"status": 200, "data": _shown(scrub(got))}


# ---- what the edit door reads back -----------------------------------------------------------------------------------

def account_edit_raw(a: dict) -> dict[str, str]:
    """spAccountEditRaw_."""
    return {"account_phones": ", ".join(gsjs.js_str(p.get("label")) + ": " + gsjs.js_str(p.get("value"))
                                        for p in a.get("phones") or []),
            "account_emails": ", ".join(gsjs.js_str(e) for e in a.get("emails") or []),
            "avatar": gsjs.or_text(a.get("avatar")), "login_email": gsjs.or_text(a.get("email"))}


def edit_raw(ctx: dict, section: str) -> dict[str, str]:
    """spEditRaw_: { field: raw } for what a section edits, as the door's witness reads it."""
    _unsure(ctx, [f for f in EDIT_SECTIONS.get(section, ()) if f not in EDIT_ACCOUNT], "This panel")
    out: dict[str, str] = {}
    acct = account_edit_raw(ctx["account"]) if ctx.get("account") else None
    for f in EDIT_SECTIONS.get(section, ()):
        if f in EDIT_ACCOUNT:
            if acct is not None:
                out[f] = acct[f]
            elif f == "avatar" and ctx.get("people") and not gsjs.falsy(ctx["people"].get("id")):
                out[f] = gsjs.or_text(ctx["people"].get("avatar"))
            continue
        if ctx.get("master_edit") and f in ctx["master_edit"]:
            out[f] = ctx["master_edit"][f]
    return out


def edition_allows(reads: L.Reads, user: dict | None, eid: str) -> bool:
    """hubEditionAllows_ for a Staff edition; one the shared registry does not carry yet is Apps Script's to decide."""
    if sc.is_real_master(user):
        return True
    config = reads.config()
    if eid not in {e for e, _a in sc.EDITIONS}:
        # never named on the stored list: nobody holds it
        if eid not in gsjs.or_blank(config.get(sc.EDITIONS_KEY)):
            return False
        raise Defer("a Staff edition the shared registry does not carry yet is Apps Script's to decide")
    return sc.edition_allows(eid, user or {}, config)


def editions_held(reads: L.Reads, user: dict | None, ids: tuple | list) -> list[str]:
    """spEditionsHeld_."""
    return [e for e in ids if edition_allows(reads, user, e)]


def edit_open(reads: L.Reads, user: dict | None) -> set[str] | None:
    """spEditOpen_: None for the master (every field); a holder's editions' own fields."""
    if sc.is_real_master(user):
        return None
    out: set[str] = set()
    for eid in editions_held(reads, user, tuple(EDITION_FIELDS)):
        out.update(EDITION_FIELDS[eid])
    return out


def edition_shut(open_: set[str] | None, field: str) -> str:
    """spEditionShut_: '' when this session may write the field, or when its own lock or the door's words answer it."""
    if open_ is None or field in open_ or field in EDIT_LOCKED:
        return ""
    if not any(field in s for s in EDIT_SECTIONS.values()):
        return ""
    return EDIT_MASTER_ONLY.get(field, EDITION_NOT_HELD)


def with_edit(env: dict, ctx: dict, user: dict | None, section: str, reads: L.Reads | None = None) -> dict[str, Any]:
    """spWithEdit_: the raw values its section edits — every one for the master, a holder its editions' own."""
    if not env or env.get("status") != 200:
        return env
    open_: set[str] | None = None
    if not sc.is_real_master(user):
        if reads is None:
            return env
        open_ = edit_open(reads, user)
        if not open_:
            return env
    raw = edit_raw(ctx, section)
    if open_ is not None:
        raw = {f: v for f, v in raw.items() if f in open_}
    return {"status": 200, "data": {**(env.get("data") or {}), "edit": _shown(scrub(raw))}}


def edit_refusal(ctx: dict, field: str) -> str:
    """spEditRefusal_: why a field is not written for this person; '' when its store can take it."""
    if field in EDIT_LOCKED:
        return EDIT_LOCKED[field]
    if not any(field in s for s in EDIT_SECTIONS.values()):
        return "Not a field this app edits."
    if field in EDIT_ACCOUNT:
        if ctx.get("account"):
            return ""
        if field == "avatar" and ctx.get("people") and not gsjs.falsy(ctx["people"].get("id")):
            return ""
        return ctx.get("account_why") or "No platform account is matched to this person."
    if not ctx.get("master"):
        return ctx.get("master_why") or "No Employee Database row is read for this person."
    if not ctx["master_cols"].get(field):
        return "The Employee Database has no column for this field."
    if not ctx["master"].get("employee_id") and not (ctx.get("people") and not gsjs.falsy(ctx["people"].get("id"))):
        return "Neither an Employee ID nor a People row points at this person's Employee Database row."
    return ""


def missing_why(ctx: dict, ids: tuple | list) -> str:
    """spMissingWhy_."""
    gone = [i for i in ctx.get("master_missing") or [] if i in ids]
    return "the Employee Database Master has no column for " + ", ".join(gone) if gone else ""


# ---- the ledgers: uploads, requirements, renewals --------------------------------------------------------------------

def uploads(reads: L.Reads) -> list[dict] | None:
    """complianceDocsRows_: FAIL-CLOSED None when the ledger could not be read; [] while it is unborn."""
    def read() -> list[dict]:
        import cert_reads  # noqa: PLC0415 - it reads the requirements and the roster through this module
        if HT.tabled(UPLOADS_TAB):
            return cert_reads.overlay(reads, hubdb.normalize(*HT.raw(reads, UPLOADS_TAB)))
        res = reads.db.resolve(UPLOADS_TAB)
        if res.runtime:
            raise Defer(f"{UPLOADS_TAB} lives in the depot's facts")
        if res.ref is None and not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {UPLOADS_TAB}")
        # a paper still to read carries the reading the relay's lane kept (app.cert_reads), never Apps Script's
        return cert_reads.overlay(reads, reads.db.normalized_rows(res.ref))
    return reads.once("sp_uploads", read)


def upload_day(v: Any) -> str:
    """complianceDocsDay_."""
    m = re.match(r"(\d{4}-\d{2}-\d{2})", gsjs.str_(v))
    return m.group(1) if m else ""


def roster_id(v: Any) -> str:
    """complianceDocsRosterId_."""
    return gsjs.trim(re.sub(r"^people:", "", gsjs.str_(v)))


def upload_out(r: dict) -> dict[str, Any]:
    """complianceDocsOut_."""
    conf = gsjs.str_(r.get("readconfidence"))
    kind = gsjs.str_(r.get("readkind"))
    own = gsjs.str_(_or(r.get("fileid"), r.get("file_id")))
    if not own:
        m = re.search(r"/file/d/([A-Za-z0-9_-]{10,})", gsjs.str_(r.get("url")))
        own = m.group(1) if m else ""
    n = js_number(conf)
    return {"id": gsjs.str_(r.get("id")), "person": gsjs.str_(r.get("person")), "cert": gsjs.str_(r.get("cert")),
            "name": gsjs.str_(r.get("name")), "url": gsjs.str_(r.get("url")), "by": gsjs.str_(r.get("by")),
            "at": gsjs.str_(r.get("at")), "roster_id": roster_id(r.get("rosterid")), "file_id": own,
            "req_id": gsjs.str_(r.get("reqid")), "read_state": gsjs.str_(r.get("readstate")), "read_kind": kind,
            "read_kind_words": READ_KIND_WORDS.get(kind, ""), "issued_on": upload_day(r.get("issuedon")),
            "expires_on": upload_day(r.get("expireson")), "read_how": gsjs.str_(r.get("readhow")),
            "read_confidence": None if conf == "" or math.isnan(n) else n, "read_why": gsjs.str_(r.get("readwhy")),
            "read_at": gsjs.str_(r.get("readat")), "read_v": gsjs.str_(r.get("readv")),
            "confirmed_on": upload_day(r.get("confirmedon")), "confirmed_by": gsjs.str_(r.get("confirmedby")),
            "confirmed_at": gsjs.str_(r.get("confirmedat"))}


def requirements(reads: L.Reads) -> list[dict]:
    """requirementsAll_().rows: the requirements tab, each cell as text, rows with an id and a label — from its owner,
    the Compliance Engine (app/compliance_engine.py), once uploaded to Postgres."""
    def read() -> list[dict]:
        import compliance_engine as CE  # noqa: PLC0415 - the Compliance Engine imports this module
        if CE.owned(reads.db, CE.REQS):
            return CE.catalogue(reads)["rows"]
        res = reads.db.resolve(REQUIREMENTS_TAB)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable("asa-hub-db holds no copy of the book behind requirements")
            raise Defer("the requirements tab is not in the copy: Apps Script seeds it on its first read")
        grid = reads.db.grid(res.ref)
        hdr = [gsjs.trim(gsjs.js_str(h)) for h in grid[0]]
        out = []
        for line in grid[1:]:
            row = {h: gsjs.str_(hubdb.typed(v, "hub")) for h, v in zip(hdr, line)}
            if gsjs.str_(row.get("req_id")) and gsjs.str_(row.get("label")):
                out.append(row)
        if not out:
            raise Defer("the requirements tab holds no row in the copy: Apps Script answers from its own catalogue")
        return out
    return reads.once("sp_requirements", read)


def req_catalog(reads: L.Reads) -> dict[str, Any]:
    """spReqCatalog_: the enabled requirements by req_id, and by the credential they name."""
    out: dict[str, Any] = {"by_id": {}, "by_credential": {}}
    for r in requirements(reads):
        if gsjs.str_(r.get("enabled")).lower() != "yes":
            continue
        rid, cred = gsjs.str_(r.get("req_id")), gsjs.str_(r.get("credential"))
        if rid and rid not in out["by_id"]:
            out["by_id"][rid] = r
        if cred:
            out["by_credential"].setdefault(cred, []).append(r)
    return out


def _req_shut(req: dict | None) -> str:
    """complianceDocsReqShut_."""
    category = gsjs.str_((req or {}).get("category")).lower()
    if category in UPLOADABLE:
        return ""
    return "HR files this form." if category == "onboarding" else "HR records this one."


def _confirm_shut(req: dict | None) -> str:
    """complianceDocsConfirmShut_."""
    if not req:
        return CONFIRM_WORDS["noReq"]
    shut = _req_shut(req)
    if shut:
        return shut
    rid, source = gsjs.str_(req.get("req_id")), gsjs.str_(req.get("date_source"))
    if re.fullmatch(r"med[123]", rid) or re.match(r"med\s*\d", source, re.I):
        return CONFIRM_WORDS["med"]
    if rid == "mais":
        return CONFIRM_WORDS["mais"]
    if not source:
        return CONFIRM_WORDS["undated"]
    return ""


def _date_role(req: dict | None) -> str:
    """complianceDocsDateRole_."""
    source = gsjs.str_((req or {}).get("date_source"))
    if not source:
        return ""
    return "expires" if (gsjs.str_(req.get("credential")) or re.search(r"\bexp", source, re.I)) else "issued"


def filing_of(catalog: dict | None, rid: str) -> dict[str, Any]:
    """spFilingOf_."""
    req = catalog["by_id"].get(rid) if catalog else None
    if req is None and catalog:
        named = catalog["by_credential"].get(rid) or []
        req = named[0] if len(named) == 1 else None
    if not req:
        return {"req_id": "", "master_header": "", "date_role": "", "files": False, "confirm_why": ""}
    return {"req_id": gsjs.str_(req.get("req_id")), "master_header": gsjs.str_(req.get("date_source")),
            "date_role": _date_role(req), "files": not _req_shut(req), "confirm_why": _confirm_shut(req)}


def meddel_course(level: Any) -> str:
    """spMedDelCourse_: "Med 1" is med1."""
    s = gsjs.or_blank(level).lower()
    d = re.search(r"([0-9])", s)
    return "med" + d.group(1) if "med" in s and d else re.sub(r"[^a-z0-9]", "", s)


def meddel_flows(reads: L.Reads, key: str) -> dict[str, dict]:
    """spMedDelFlows_: the person's active Med Del renewals by course — from their owner, Med Delegation's rows in
    Postgres once the app is given to Python (app/med_del.py), else the meddel_flows sheet's copy."""
    import resource_rows as RR  # noqa: PLC0415 - read only when a renewal is asked
    if RR.uploaded(reads.db, "medDelFlows"):
        every = reads.once("sp:medDelFlows", lambda: RR.read_all(reads, "medDelFlows"))
    else:
        res = reads.db.resolve(MEDDEL_TAB)
        if res.ref is None and not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {MEDDEL_TAB}")
        every = reads.db.locations_rows(res.ref)
    out: dict[str, dict] = {}
    for f in every:
        if gsjs.or_text(f.get("nameKey")) != key or gsjs.or_text(f.get("overallStatus")).lower() != "active":
            continue
        course = meddel_course(f.get("medLevel"))
        if not course:
            continue
        n = js_number(f.get("phase"))
        phase = "1" if (math.isnan(n) or n == 0) else gsjs.num_str(n)
        out[course] = {"flow_id": text(f.get("id"), 40), "level": text(f.get("medLevel"), 30), "phase": phase,
                       "phase_label": MEDDEL_PHASES.get(phase, ""), "cert_expires": sp_day(f.get("certExpDate"))}
    return out


def meddel_phase(f: dict) -> str:
    return "Phase " + f["phase"] + (" · " + f["phase_label"] if f["phase_label"] else "")


def req_states(reads: L.Reads) -> dict[str, Any] | None:
    """reqStatesListValues_(0): the stored states { hdr, values } — from the Compliance Engine's rows in Postgres once
    uploaded."""
    def read() -> dict[str, Any]:
        import compliance_engine as CE  # noqa: PLC0415 - the Compliance Engine imports this module
        if CE.owned(reads.db, CE.STATES):
            grid = CE.states_grid(reads)
            dated = {i for i, h in enumerate(grid["hdr"]) if h in REQ_STATE_DATES}
            return {"hdr": grid["hdr"], "values": [[serial_date(v) if i in dated and _is_serial(v) else v
                                                    for i, v in enumerate(line)] for line in grid["values"]]}
        res = reads.db.resolve(REQ_STATES_TAB)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {REQ_STATES_TAB}")
            return {"hdr": list(REQ_STATES_HEADER), "values": []}
        grid = reads.db.grid(res.ref)
        hdr = [gsjs.js_str(h) for h in grid[0] if gsjs.js_str(h) != ""]
        dated = {i for i, h in enumerate(hdr) if h in REQ_STATE_DATES}

        def cell(i: int, v: Any) -> Any:
            v = hubdb.typed(v, "hub")
            return serial_date(v) if i in dated and _is_serial(v) else v

        return {"hdr": hdr, "values": [[cell(i, v) for i, v in enumerate(line)] for line in grid[1:]]}
    return reads.once("sp_req_states", read)


def req_states_from(hdr: list, values: list, key: str, limit: int = 100000) -> list[dict]:
    """reqStatesListFrom_: one person's rows (by the fold of person_key, else person_name), newest first."""
    at: dict[str, int] = {}
    for i, h in enumerate(hdr or []):
        name = gsjs.str_(h)
        if name and name not in at:
            at[name] = i

    def cell(row: list, c: str) -> str:
        return gsjs.str_(row[at[c]]) if c in at and at[c] < len(row) else ""

    out = []
    for row in reversed(values or []):
        if len(out) >= limit:
            break
        if key and (fold(cell(row, "person_key")) or fold(cell(row, "person_name"))) != key:
            continue
        out.append({c: cell(row, c) for c in ("person_key", "person_name", "req_id", "state", "expires", "days_left",
                                              "prev_state", "since", "computed_at", "tenant")})
    return out


# ---- the requirement states, as the rebuild computes them (RequirementStates.gs) -------------------------------------

def _req_from_date(expires_ms: float | None, warn_days: int, now_ms: float) -> dict[str, Any]:
    """reqStateFromDate_."""
    if expires_ms is None:
        return {"state": "missing", "days_left": ""}
    left = math.ceil((expires_ms - now_ms) / 86400000)
    if left < 0:
        return {"state": "expired", "days_left": left}
    if left <= warn_days:
        return {"state": "expiring", "days_left": left}
    return {"state": "ok", "days_left": left}


def _req_flag_ms(raw: Any) -> float | None:
    """reqFlagDateMs_: a US day, an ISO day or a Sheets serial; any other number is a count."""
    s = gsjs.trim(gsjs.or_blank(raw))
    if not s:
        return None
    if re.fullmatch(r"\d{1,6}", s):
        n = int(s)
        if n < 20000 or n > 80000:
            return None
        return (datetime(1899, 12, 30, tzinfo=timezone.utc) + timedelta(days=n)).timestamp() * 1000
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        try:
            return datetime(int(m[3]), int(m[1]), int(m[2]), tzinfo=timezone.utc).timestamp() * 1000
        except ValueError:
            return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        try:
            return datetime(int(m[1]), int(m[2]), int(m[3]), tzinfo=timezone.utc).timestamp() * 1000
        except ValueError:
            return None
    return None


def _req_from_flag(flag: Any) -> dict[str, Any]:
    """reqStateFromFlag_: a yes/no word, n/a, or a date sent back to the day's state."""
    raw = gsjs.trim(gsjs.or_blank(flag))
    v = raw.lower()
    if not v:
        return {"state": "missing", "days_left": ""}
    if v in ("1", "yes", "y", "true", "x"):
        return {"state": "ok", "days_left": ""}
    if v == "0.5":
        return {"state": "expiring", "days_left": ""}
    if v in ("n-a", "na", "n/a"):
        return {"state": "na", "days_left": ""}
    if v in ("0", "no", "n", "false"):
        return {"state": "missing", "days_left": ""}
    ms = _req_flag_ms(raw)
    if ms is not None:
        return {"state": "date", "days_left": "", "date": ms}
    return {"state": "missing", "days_left": ""}


def _req_from_header(master_row: dict, req: dict, warn_days: int, now_ms: float) -> dict[str, Any]:
    """reqStateHeader_: the requirement's own Master column (smartRawColumn_ by estateKey_)."""
    got = _req_from_flag(master_row.get(hubdb.estate_key(gsjs.str_(req.get("header")))))
    if got["state"] != "date":
        return {**got, "expires": ""}
    out = _req_from_date(got["date"], warn_days, now_ms)
    out["expires"] = datetime.fromtimestamp(got["date"] / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    return out


def req_states_live(reads: L.Reads, ctx: dict) -> dict[str, dict[str, Any]]:
    """reqStatesCompute_ for one person on the Master as Python reads it, its kept edits laid: the states the
    six-hourly rebuild would store next, by requirement id in catalogue order."""
    catalog = [r for r in requirements(reads) if gsjs.str_(r.get("enabled")).lower() == "yes"]
    known = (cert_picture(reads, ctx["key"]) or {}).get("certs") or {}
    name_f = cert_source_field(reads, "master.name")
    master_row = next((r for r in cert_read_tab(reads, cert_source_tab(reads, "master"))
                       if name_key(master_name(r, name_f)) == ctx["key"]), None)
    window = cert_expiring_days(reads) if cfg(reads).get("ist_requirements_window") == "ist" else 0
    return req_states_of(catalog, known, master_row, window, reads.now.timestamp() * 1000)


def req_states_all(reads: L.Reads) -> dict[str, dict[str, Any]]:
    """reqStatesCompute_: every person's states (person_key|req_id → the stored row's cells but the stamps), each
    source read once."""
    catalog = [r for r in requirements(reads) if gsjs.str_(r.get("enabled")).lower() == "yes"]
    pictures = cert_pictures(reads)
    name_f = cert_source_field(reads, "master.name")
    masters: dict[str, dict] = {}
    for r in cert_read_tab(reads, cert_source_tab(reads, "master")):
        masters.setdefault(name_key(master_name(r, name_f)), r)
    window = cert_expiring_days(reads) if cfg(reads).get("ist_requirements_window") == "ist" else 0
    now_ms = reads.now.timestamp() * 1000
    out: dict[str, dict[str, Any]] = {}
    for p in without_isp_clients(reads, people_merged(reads, _people(reads))):
        key = name_key(p.get("name"))
        if not key:
            continue
        login = gsjs.str_(p.get("email")).strip().lower() or re.sub(r"\D+", "", gsjs.str_(p.get("phone")))
        states = req_states_of(catalog, (pictures.get(key) or {}).get("certs") or {}, masters.get(key), window, now_ms)
        for rid, st in states.items():
            out[key + "|" + rid] = {"login": login, "person_key": key, "person_name": gsjs.str_(p.get("name")), **st}
    return out


def req_states_of(catalog: list[dict], known: dict, master_row: dict | None, window: int,
                  now_ms: float) -> dict[str, dict[str, Any]]:
    """One person's states against the catalogue (reqStatesCompute_'s inner loop)."""
    out: dict[str, dict[str, Any]] = {}
    for req in catalog:
        rid = gsjs.str_(req.get("req_id"))
        if window and gsjs.str_(req.get("category")) == "training":
            warn = window
        else:
            warn = js_parse_int(gsjs.str_(req.get("warn_days")))
            warn = 30 if warn is None else warn
        cred = gsjs.str_(req.get("credential"))
        if cred:
            cell = known.get(cred)
            expires = gsjs.or_text(cell.get("expires")) if cell and cell.get("expires") else (
                gsjs.or_text(master_row.get(hubdb.estate_key(cred))) if master_row else "")
            if not gsjs.trim(expires) and master_row and gsjs.str_(req.get("header")):
                got = _req_from_header(master_row, req, warn, now_ms)
            else:
                ms = _cert_ms(expires) if expires else None
                got = _req_from_date(ms, warn, now_ms)
                got["expires"] = expires[:10] if ms is not None else ""
        elif master_row and gsjs.str_(req.get("header")):
            got = _req_from_header(master_row, req, warn, now_ms)
        else:
            got = {"state": "missing", "days_left": "", "expires": ""}
        out[rid] = {"req_id": rid, "state": got["state"], "expires": got["expires"],
                    "days_left": gsjs.js_str(got["days_left"])}
    return out


# ---- actions -------------------------------------------------------------------------------------------------------

def actions_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spActionsBuild_: renewals and their Med Del phase, onboarding papers, ISTs and papers waiting for review."""
    why: list[str] = []
    degraded = False
    items: list[dict] = []
    catalog: dict[str, dict] = {}
    got, w = _soft(lambda: requirements(reads))
    if got is None:
        why.append(why_of("the requirements catalogue", w))
    for r in got or []:
        catalog[gsjs.str_(r.get("req_id"))] = r
    ups = uploads(reads)
    if ups is None:
        why.append("the uploads ledger could not be read")
        degraded = True
    mine_up = [upload_out(r) for r in ups or [] if fold(r.get("person")) == ctx["key"]]

    def doc_for(rid: str) -> dict | None:
        hit = None
        for u in mine_up:
            if u["file_id"] and (u["req_id"] == rid or u["cert"] == rid) and (hit is None or u["at"] > hit["at"]):
                hit = u
        return hit

    renewals, w = _soft(lambda: meddel_flows(reads, ctx["key"]))
    if renewals is None:
        why.append(why_of("the Med Del renewals", w))
        degraded = True
        renewals = {}
    placed: dict[str, bool] = {}
    # the states as the Master stands now, a paper's confirmed date included; the stored ones wait for the rebuild
    try:
        live: dict[str, dict] | None = req_states_live(reads, ctx)
    except (Defer, hubdb.Unreadable, RuntimeError):
        live = None
    states, _w = (None, "") if live is not None else _soft(lambda: req_states(reads))
    today = reads.today()
    if live is None and states is None:
        why.append("the requirement states could not be read")
        degraded = True
    else:
        rows = list(live.values()) if live is not None else req_states_from(states["hdr"], states["values"],
                                                                              ctx["key"])
        for r in rows:
            req = catalog.get(r["req_id"]) or {}
            cat = gsjs.str_(req.get("category")).lower()
            if cat not in ("training", "documents", "onboarding"):
                continue
            st = gsjs.str_(r["state"]).lower()
            if st not in ("expired", "expiring", "missing"):
                continue
            days = js_parse_int(r["days_left"])
            phase = ("Expired" if st == "expired" else
                     ("Expiring" if days is None else f"Expires in {days} day{'' if days == 1 else 's'}")
                     if st == "expiring" else "Not on file")
            course = gsjs.str_(req.get("credential")) or r["req_id"]
            flow = renewals.get(course)
            if flow:
                placed[course] = True
            doc = doc_for(r["req_id"])
            items.append({"id": "req:" + r["req_id"], "status": "due_soon" if st == "expiring" else "needs_attention",
                          "item": text(req.get("label")) or r["req_id"], "date": sp_day(r["expires"]),
                          "flow": FLOWS["meddel"] if flow else FLOWS[cat], "phase": meddel_phase(flow) if flow else phase,
                          "action": {"kind": "doc", "doc_id": doc["file_id"]} if doc else {"kind": "none"},
                          # the requirement a paper is filed for here: one a certificate answers, never HR's form
                          "req_id": r["req_id"] if cat in UPLOADABLE and req and not _req_shut(req) else ""})
    for course, f in renewals.items():
        if placed.get(course):
            continue
        label, _w = _soft(lambda: cert_label(reads, course))
        label = label or ""
        doc = doc_for(course)
        items.append({"id": "meddel:" + (f["flow_id"] or course),
                      "status": "needs_attention" if f["cert_expires"] and f["cert_expires"] < today else "due_soon",
                      "item": text(label if label and label != course else f["level"]) or course,
                      "date": f["cert_expires"], "flow": FLOWS["meddel"], "phase": meddel_phase(f),
                      "action": {"kind": "doc", "doc_id": doc["file_id"]} if doc else {"kind": "none"}})

    def ist_items() -> None:
        for r in ist_mine(reads, ctx):
            if L.cell(r.get("status")).lower() == "done":
                continue
            due = sp_day(L.cell(r.get("dueDate")))
            items.append({"id": "ist:" + L.cell(r.get("id")),
                          "status": "needs_attention" if due and due < today else "due_soon",
                          "item": "IST — " + text(r.get("clientName")), "date": due, "flow": FLOWS["ist"],
                          "phase": "Owed" + (" · due " + due if due else ""),
                          "action": {"kind": "none", "house": L.house_code(r.get("house")) or ""}})

    _ok, w = _soft(ist_items)
    if w:
        why.append(why_of("the IST records", w))
        degraded = True
    for u in mine_up:
        if u["confirmed_at"]:
            continue
        label, _w = _soft(lambda u=u: cert_label(reads, u["req_id"] or u["cert"]))
        items.append({"id": "upload:" + u["id"], "status": "in_review",
                      "item": text(_or(label, u["name"], u["cert"])) or "Document", "date": sp_day(u["at"]),
                      "flow": FLOWS["review"], "phase": "In review",
                      "action": {"kind": "doc", "doc_id": u["file_id"]} if u["file_id"] else {"kind": "none"}})
    rank = {"needs_attention": 0, "due_soon": 1, "in_review": 2}
    items.sort(key=functools.cmp_to_key(lambda a, b: (rank[a["status"]] - rank[b["status"]])
                                        or gsjs.locale_cmp(gsjs.js_str(a["date"]), gsjs.js_str(b["date"]))))
    counts = {"needs_attention": 0, "due_soon": 0, "in_review": 0}
    for i in items:
        counts[i["status"]] += 1
    return {"items": items, "counts": counts, "why": "; ".join(w for w in why if w), "degraded": degraded}


# ---- activity ------------------------------------------------------------------------------------------------------

def _column_of(reads: L.Reads, ref: hubdb.TabRef, header: str) -> str:
    """The copy's own column for one header of a tab; '' when it keeps none by that header."""
    for (cols,) in reads.db.query("select columns from catalog.tabs where table_name = %s and gone_at is null",
                                  (ref.table,)):
        for pair in cols if isinstance(cols, list) else json.loads(cols or "[]"):
            if isinstance(pair, list) and len(pair) == 2 and pair[0] == header \
                    and re.fullmatch(r"[a-z0-9_]{1,63}", str(pair[1])):
                return str(pair[1])
    return ""


def events_for(reads: L.Reads, key: str) -> list[dict]:
    """spEventsFor_: the events trail's rows whose subject is this key, newest first, found by the cell (in its own table
    once kept there, by the index on its subject)."""
    resource = HT.resource_of(EVENTS_TAB) if HT.tabled(EVENTS_TAB) else None
    if resource is not None:
        cols = RR.columns(reads, resource)
        subject = "subject_key" if "subject_key" in cols else (cols[4] if len(cols) > 4 else "")
        if not subject:
            return []
        # the column named in the statement itself, so its index serves every plan
        col = "'" + subject.replace("'", "''") + "'"
        rows = [c for (c,) in RR._q(reads, f"select cells from {RR.rows_of(resource)} where resource = %s"  # noqa: S608
                                           f" and removed_at is null and cells->>{col} = %s"
                                           " order by position desc, created_at desc limit %s",
                                    (resource, key, EVENTS_CAP))]
    else:
        rows = _events_copy_rows(reads, key)
    out = []
    for raw in rows:
        if isinstance(raw, str):
            raw = json.loads(raw)
        raw = raw if isinstance(raw, dict) else {}
        try:
            payload = json.loads(gsjs.or_text(raw.get("payload")) or "{}")
        except ValueError:
            payload = {}
        out.append({"type": gsjs.or_text(raw.get("type")), "actor": gsjs.or_text(raw.get("actor")),
                    "at": sp_instant(hubdb.typed(raw.get("at"), "hub")),
                    "payload": payload if isinstance(payload, dict) and payload else {}})
    return out


def _events_copy_rows(reads: L.Reads, key: str) -> list:
    """The copy's rows of the trail whose subject is this key, newest first."""
    res = reads.db.resolve(EVENTS_TAB)
    if res.runtime:
        raise Defer(f"{EVENTS_TAB} lives in the depot's facts")
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {EVENTS_TAB}")
        return []
    ref = res.ref
    if not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table):
        raise hubdb.Unreadable("the catalog names an unusable table for the events trail")
    reads.db.note_book(ref.sheet_id)
    subject = "subject_key" if "subject_key" in ref.headers else (ref.headers[4] if len(ref.headers) > 4 else "")
    if not subject:
        return []
    # the trail is too large to filter its JSON inside the statement timeout: its own column when the copy keeps one
    col = reads.once("sp_events_col:" + ref.table, lambda: _column_of(reads, ref, subject))
    where = f'"{col}" = %s' if col else "_raw->>%s = %s"
    got = reads.db.query(f'select row_number, _raw from {reads.db.from_sql(ref)} where {where}'  # noqa: S608
                         " order by row_number desc limit %s", ((key,) if col else (subject, key)) + (EVENTS_CAP,))
    return [raw for _rn, raw in got]


_DEBURR = re.compile(r"[̀-ͯ]")


def name_norm(v: Any) -> str:
    """nameNorm_."""
    s = _DEBURR.sub("", unicodedata.normalize("NFD", gsjs.or_blank(v))).lower()
    s = re.sub(r"['’`]", "", s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return gsjs.trim(re.sub(r"\s+", " ", s))


def name_hit(cell_v: Any, nm: Any) -> bool:
    """emp360NameHit_: exact per segment, never a substring."""
    want = name_norm(nm)
    if not want:
        return False
    if name_norm(cell_v) == want:
        return True
    return any(name_norm(part) == want for part in re.split(r"[,;+&]|\band\b", gsjs.or_text(cell_v), flags=re.I))


def activity_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spActivityBuild_: the last year's timeline, and who visited the profile."""
    why: list[str] = []
    degraded = False
    since = gsjs.day_shift(reads.today(), -ACTIVITY_DAYS)
    events: list[dict] = []

    def add(at: Any, kind: str, title: str, detail: Any, by: Any) -> None:
        s = sp_instant(at)
        if not s or s[:10] < since:
            return
        events.append({"at": s, "kind": kind, "title": title, "detail": detail or "", "by": by or ""})

    visits: list[dict] = []

    def visit_rows() -> None:
        for v in own_rows(reads, VISITS_TAB, ctx["key"]):
            who = gsjs.or_text(_or(v.get("visitor_name"), v.get("visitor_email")))
            visits.append({"at": gsjs.or_text(v.get("at")), "visitor": who, "section": gsjs.or_text(v.get("section"))})
            add(v.get("at"), "visit", "Profile visited", gsjs.or_text(v.get("section")), who)

    _ok, w = _soft(visit_rows)
    if w:
        why.append(why_of("the profile visits", w))
    visits.sort(key=functools.cmp_to_key(lambda a, b: 1 if a["at"] < b["at"] else (-1 if a["at"] > b["at"] else 0)))

    def note_rows() -> None:
        for n in own_rows(reads, NOTES_TAB, ctx["key"]):
            add(n.get("at"), "note", "Note added" + (" — " + n["category"] if n.get("category") else ""),
                text(n.get("details"), 140), n.get("by"))

    _ok, w = _soft(note_rows)
    if w:
        why.append(why_of("the staff notes", w))

    def ist_rows() -> None:
        for r in ist_mine(reads, ctx):
            where = L.house_code(r.get("house")) or text(r.get("house"))
            add(L.cell(r.get("createdAt")), "ist_assigned", "IST assigned — " + text(r.get("clientName")), where, "")
            if L.cell(r.get("trainedAt")):
                add(L.cell(r.get("trainedAt")), "ist_done", "IST done — " + text(r.get("clientName")), where,
                    text(r.get("trainedBy")))
            if L.cell(r.get("docAt")):
                add(L.cell(r.get("docAt")), "upload", "Training document added — IST " + text(r.get("clientName")), where,
                    text(r.get("docBy")))

    _ok, w = _soft(ist_rows)
    if w:
        why.append(why_of("the IST records", w))
        degraded = True
    labels: dict[str, str] = {}
    got, _w = _soft(lambda: requirements(reads))
    for r in got or []:
        labels[gsjs.str_(r.get("req_id"))] = gsjs.str_(r.get("label"))

    def event_rows() -> None:
        for e in events_for(reads, ctx["key"]):
            if e["type"] == "requirement_state_changed":
                p = e["payload"] or {}
                rid = p.get("req_id")
                head = _or(labels.get(gsjs.js_str(rid)) if rid is not None else None, rid, "Requirement")
                add(e["at"], "requirement", gsjs.js_str(head) + ": " + gsjs.js_str(_or(p.get("prev_state"), "new"))
                    + " → " + gsjs.js_str(_or(p.get("state"), "")),
                    "expires " + gsjs.js_str(p.get("expires")) if not gsjs.falsy(p.get("expires")) else "", "")
            elif e["type"] == "staffProfileHr":
                add(e["at"], "hr_view", "HR record viewed", "", e["actor"])
        # the views Python answered keep their line in asa-hub-db, not on the trail
        for e in SV.rows_for(ctx["key"], "staffProfileHr"):
            add(sp_instant(e["at"]), "hr_view", "HR record viewed", "", e["actor"])

    _ok, w = _soft(event_rows)
    if w:
        why.append(why_of("the events trail", w))
    ups = uploads(reads)
    if ups is None:
        why.append("the uploads ledger could not be read")
        degraded = True
    for r in ups or []:
        if fold(r.get("person")) != ctx["key"]:
            continue
        o = upload_out(r)
        label, _w = _soft(lambda o=o: cert_label(reads, o["req_id"] or o["cert"]))
        add(o["at"], "upload", "Document uploaded — " + gsjs.js_str(_or(label, o["cert"], "document")), "", o["by"])
        if o["confirmed_at"]:
            add(o["confirmed_at"], "upload_confirmed", "Document confirmed — " + gsjs.js_str(_or(label, o["cert"],
                                                                                                  "document")),
                "", o["confirmed_by"])

    def incident_rows() -> None:
        for r in reads.estate("uiIncidents"):
            named = name_hit(r.get("employees_involved"), ctx["name"])
            reporter = name_key(r.get("your_name")) == ctx["key"]
            if not named and not reporter:
                continue
            when = sp_day(r.get("incident_date")) or sp_day(r.get("timestamp"))
            cats = L.categories(r.get("incident_category"))
            add(when or r.get("timestamp"), "incident", "Incident" + (" — " + ", ".join(cats) if cats else ""),
                "named in the report" if named else "filed the report", "")

    _ok, w = _soft(incident_rows)
    if w:
        why.append(why_of("the incidents", w))
        degraded = True

    def scheduled() -> None:
        for p in shift_facts(reads, ctx)["shifts"].get("patterns") or []:
            hours = " · " + "–".join(x for x in (p["start"], p["end"]) if x) if p["start"] or p["end"] else ""
            add(p["from"], "scheduled", "Scheduled — " + p["house"] + " · " + ", ".join(p["weekdays"]) + hours,
                p["from"] if p["from"] == p["to"] else p["from"] + " to " + p["to"], "")

    _ok, w = _soft(scheduled)
    if w:
        why.append(why_of("the schedule", w))
    events.sort(key=functools.cmp_to_key(lambda a, b: 1 if a["at"] < b["at"] else (-1 if a["at"] > b["at"] else 0)))
    return {"events": events, "visits": visits[:200], "visits_total": len(visits), "why": "; ".join(w for w in why if w),
            "degraded": degraded}


# ---- preferences ---------------------------------------------------------------------------------------------------

def _prefs_json(v: Any) -> Any:
    try:
        return json.loads(gsjs.or_blank(v) or "null")
    except ValueError:
        return None


def _prefs_pick(items: Any, allowed: tuple) -> list[str]:
    have = {gsjs.trim(gsjs.or_blank(x)).lower() for x in (items if isinstance(items, list) else [])}
    return [a for a in allowed if a in have]


def prefs_clean(raw: Any) -> dict[str, Any]:
    """spPrefsClean_: preferences in their one shape."""
    p = raw if isinstance(raw, dict) else {}
    days = p.get("unavailable_days") if isinstance(p.get("unavailable_days"), dict) else {}
    codes = {L.house_code(c) for c in (p.get("unavailable_locations") if isinstance(p.get("unavailable_locations"), list)
                                       else []) if L.house_code(c)}
    others: list[str] = []
    seen: set[str] = set()
    for x in p.get("other_locations") if isinstance(p.get("other_locations"), list) else []:
        s = text(x, 80)
        if not s or s.lower() in seen or len(others) >= PREF_OTHER_MAX:
            continue
        seen.add(s.lower())
        others.append(s)
    allergies = _prefs_pick(p.get("allergies"), PREF_ALLERGIES)
    pickup = text(p.get("pickup")).lower()
    return {"shifts": _prefs_pick(p.get("shifts"), PREF_SHIFTS),
            "unavailable_days": {"a": _prefs_pick(days.get("a"), PREF_DAYS), "b": _prefs_pick(days.get("b"), PREF_DAYS)},
            "unavailable_locations": sorted(codes), "other_locations": others, "allergies": allergies,
            "allergy_other": text(p.get("allergy_other"), 200) if "other" in allergies else "",
            "pickup": pickup if pickup in PREF_PICKUP else "", "weekend_work": text(p.get("weekend_work"), 200),
            "note": text(p.get("note"), 500), "shifts_note": text(p.get("shifts_note"), 200)}


def prefs_of(r: dict | None) -> dict[str, Any]:
    """spPrefsOf_."""
    if not r:
        return prefs_clean({})
    return prefs_clean({"shifts": _prefs_json(r.get("shifts")), "unavailable_days": _prefs_json(r.get("unavailable_days")),
                        "unavailable_locations": _prefs_json(r.get("unavailable_locations")),
                        "other_locations": _prefs_json(r.get("other_locations")),
                        "allergies": _prefs_json(r.get("allergies")), "allergy_other": r.get("allergy_other"),
                        "pickup": r.get("pickup"), "weekend_work": r.get("weekend_work"), "note": r.get("note"),
                        "shifts_note": r.get("shifts_note")})


def prefs_find(reads: L.Reads, key: str) -> dict[str, Any]:
    """spPrefsFind_: the house's tab (None while not set up) and the staff key's row."""
    if not reads.db.house_moved(PREFS_TAB):
        return {"sheet": False, "at": 0, "rec": None}
    res = reads.db.resolve(PREFS_TAB)
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the house behind {PREFS_TAB}")
        raise Defer(f"the {PREFS_TAB} house holds no tab in the copy: Apps Script makes it on its first read")
    hit = next((r for r in reads.db.locations_rows(res.ref) if gsjs.trim(gsjs.or_text(r.get("staff_key"))) == key), None)
    return {"sheet": True, "at": hit["_row"] if hit else 0, "rec": hit}


def prefs_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spPrefsBuild_: the preferences and the houses."""
    why: list[str] = []
    houses: list[dict] = []
    got, w = _soft(reads.homes)
    if got is None:
        why.append(why_of("the house registry", w))
    else:
        houses = sorted(({"code": h["code"], "name": h["home_name"] or h["code"]} for h in got),
                        key=by_name(lambda h: h["name"]))
    found, w = _soft(lambda: prefs_find(reads, ctx["key"]))
    if found is None:
        return {"ready": False, "houses": houses, "why": why_of("the staff preferences house", w), "degraded": True}
    if not found["sheet"]:
        return {"ready": False, "houses": houses, "why": PREFS_UNSET, "degraded": True}
    rec = found["rec"]
    return {"ready": True, "houses": houses, "prefs": prefs_of(rec),
            "updated_at": sp_instant(rec.get("updated_at")) if rec else "",
            "updated_by": gsjs.or_text(rec.get("updated_by")) if rec else "",
            "why": "; ".join(why), "degraded": len(why) > 0}


# ---- employment ------------------------------------------------------------------------------------------------------

EMPLOYMENT_IDS = ("referral", "referral_paid", "job_app_date", "resume", "attestation_date", "start_doc",
                  "start_first_day", "end_last_day", "hs_diploma", "flag_hs_diploma", "driver")


def documents_of(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spDocuments_: the documents port's answer (staff_comms); without it the answer is Apps Script's."""
    try:
        import staff_comms as SC  # noqa: PLC0415 - the two modules lean on each other
    except ImportError as exc:
        raise Defer("the documents port is not loaded") from exc
    build = getattr(SC, "documents_build", None)
    if build is None:
        raise Defer("the documents port answers no documents build")
    return reads.once("sp_documents:" + ctx["key"], lambda: scrub(build(reads, ctx)))


def candidate_resume(reads: L.Reads, candidate_id: str) -> str:
    """spCandidateResume_."""
    if not candidate_id:
        return ""
    res = reads.db.resolve(CANDIDATES_TAB)
    if res.runtime:
        raise Defer(f"{CANDIDATES_TAB} lives in the depot's facts")
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {CANDIDATES_TAB}")
        raise Said("Talent tab missing: " + CANDIDATES_TAB)
    link = ""
    for c in reads.db.normalized_rows(res.ref):
        if not link and gsjs.str_(c.get("candidateid")) == candidate_id:
            link = gsjs.str_(c.get("resumelink"))
    return L.drive_id(link)


def employment_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spEmploymentBuild_: hiring, the employment dates and the qualifications, as the Master holds them."""
    _unsure(ctx, EMPLOYMENT_IDS, "Employment")
    m = ctx.get("master") or {}
    why: list[str] = []
    if not ctx.get("master"):
        why.append(ctx.get("master_why") or "this person has no row in the Employee Database Master")
    why.append(missing_why(ctx, EMPLOYMENT_IDS))
    docs, w = _soft(lambda: documents_of(reads, ctx))
    if docs is None:
        why.append(why_of("the documents", w))

    def find(pid: str) -> dict | None:
        items = (docs or {}).get("docs") or []
        hit = next((d for d in items if d.get("id") == pid), None)
        return hit or next((d for d in items if d.get("file_id") and PAPER_RE[pid].search(gsjs.or_text(d.get("title")))),
                           None)

    resume = find("resume")
    resume_id = resume["file_id"] if resume and resume.get("file_id") else None
    if not resume_id and ctx.get("candidate_id"):
        got, w = _soft(lambda: candidate_resume(reads, ctx["candidate_id"]))
        if got is None and w:
            why.append(why_of("the candidate record", w))
        else:
            resume_id = got or None
    hs = find("hs_diploma")
    paid = gsjs.or_text(m.get("referral_paid"))
    paid_day = sp_day(paid) or sp_day_in(paid)
    paid_flag = "yes" if paid_day else yes_no(re.split(r"[\s,;-]+", paid)[0])
    driver = text(m.get("driver"))
    return {"hiring": {"referral": text(m.get("referral")), "referral_paid": paid_day or ("" if paid_flag else text(paid)),
                       "referral_paid_flag": paid_flag, "job_app_date": sp_day(m.get("job_app_date")),
                       "resume": {"flag": yes_no(m.get("resume")), "doc_id": resume_id},
                       "attestation_date": sp_day(m.get("attestation_date"))},
            "dates": {"start_doc": sp_day(m.get("start_doc")), "start_first_day": sp_day(m.get("start_first_day")),
                      "end_last_day": sp_day(m.get("end_last_day"))},
            "qualifications": {"hs_diploma": {"value": text(m.get("hs_diploma")), "flag": flag(m.get("flag_hs_diploma")),
                                              "doc_id": hs["file_id"] if hs and hs.get("file_id") else None,
                                              "doc_date": (hs.get("date") or "") if hs else ""},
                               "driver": {"value": driver, "approved": bool(re.fullmatch(r"yes", driver, re.I))}},
            "on_master": bool(ctx.get("master")), "why": "; ".join(w for w in why if w),
            "degraded": not ctx["master_read"]}


# ---- compliance ------------------------------------------------------------------------------------------------------

COMPLIANCE_IDS = ("driver", "license_exp", "insurance_exp", "sam", "oig", "abuser", "sex_offender", "offender",
                  "nurse_aide", "exclusions", "bci_check_date", "rapback_entry_date", "flag_sam", "flag_oig",
                  "flag_abuser", "flag_sex_offender", "flag_offender", "flag_nurse_aide", "flag_exclusions", "flag_bci")


def _cert_ms(v: Any) -> float | None:
    """certDateMs_."""
    s = gsjs.trim(gsjs.or_text(v))
    return _js_ms(s) if s else None


def _clearance_ms(v: Any) -> float | None:
    """clearanceExpiryMs_: a day at New York midnight; None when unreadable."""
    s = gsjs.trim(gsjs.or_blank(v))
    if not s:
        return None
    m = re.match(r"(\d{4})-?(\d{2})-?(\d{2})", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        u = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
        if not u:
            return _js_ms(s)
        y, mo, d = int(u.group(3)), int(u.group(1)), int(u.group(2))
    if not y or not 1 <= mo <= 12 or not 1 <= d <= 31:
        return None
    try:
        return datetime(y, mo, d, tzinfo=NY).timestamp() * 1000.0
    except ValueError:
        return None


def clearances(reads: L.Reads) -> dict[str, dict[str, dict]]:
    """clearanceOverlay_ for everyone: person key → the last row per credential, as clearance_for reads one."""
    res = reads.db.resolve(CLEARANCE_TAB)
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {CLEARANCE_TAB}")
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
        if not pk or cred not in CLEARANCE_CREDENTIALS:
            continue
        rec = {"decision": at(line, "decision").lower(), "expires_on": at(line, "expireson"),
               "file_id": at(line, "fileid"), "state_ref": at(line, "stateref"), "name": at(line, "personname")}
        if not rec["file_id"] and not rec["state_ref"] and rec["decision"] != "revoked":
            continue
        out.setdefault(pk, {})[cred] = rec
    return out


def clearance_for(reads: L.Reads, key: str) -> dict[str, dict]:
    """clearanceOverlay_ for one person: the last row per credential."""
    res = reads.db.resolve(CLEARANCE_TAB)
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {CLEARANCE_TAB}")
        return {}
    grid = reads.db.grid(res.ref)
    hdr = [hubdb.norm_key(h) for h in grid[0]]

    def at(line: list, k: str) -> str:
        return gsjs.trim(gsjs.or_text(hubdb.typed(line[hdr.index(k)], "hub"))) if k in hdr else ""

    if "personkey" not in hdr or "credential" not in hdr:
        return {}
    out: dict[str, dict] = {}
    for line in grid[1:]:
        pk, cred = at(line, "personkey"), at(line, "credential").lower()
        if pk != key or cred not in CLEARANCE_CREDENTIALS:
            continue
        rec = {"decision": at(line, "decision").lower(), "expires_on": at(line, "expireson"),
               "file_id": at(line, "fileid"), "state_ref": at(line, "stateref"), "name": at(line, "personname")}
        if not rec["file_id"] and not rec["state_ref"] and rec["decision"] != "revoked":
            continue
        out[cred] = rec
    return out


def cert_picture(reads: L.Reads, key: str) -> dict[str, Any] | None:
    """certPicture_ for one person: the Master's dates, the tracker's exceptions, the MAIS record, the clearances."""
    person_: dict[str, Any] | None = None

    def touch(nm: Any) -> dict | None:
        nonlocal person_
        if name_key(nm) != key:
            return None
        if person_ is None:
            person_ = {"name": gsjs.trim(gsjs.js_str(nm)), "certs": {}}
        return person_

    now_ms = reads.now.timestamp() * 1000.0
    soon = now_ms + cert_expiring_days(reads) * 24 * 3600 * 1000
    master_cols = cfg_pairs(reads, "ist_cert_master_columns")["map"]
    training_keys = {gsjs.trim(k.lower()): v for k, v in cfg_pairs(reads, "ist_cert_training_keys")["map"].items()}
    f = {k: cert_source_field(reads, k) for k in ("master.name", "trainings.name", "trainings.course", "trainings.status",
                                                 "trainings.expires", "mais.name", "mais.status", "mais.expires",
                                                 "mais.category")}
    master_rows = cert_read_tab(reads, cert_source_tab(reads, "master"))
    mine = [r for r in master_rows if name_key(master_name(r, f["master.name"])) == key]
    active = any(_status_active(r) for r in mine)
    for r in mine:
        if len(mine) > 1 and active and not _status_active(r):
            continue
        p = touch(master_name(r, f["master.name"]))
        if not p:
            continue
        for label, cred in master_cols.items():
            ms = _cert_ms(r.get(label))
            if ms is None:
                continue
            p["certs"][cred] = {"status": "expired" if ms < now_ms else ("expiring" if ms < soon else "valid"),
                                "expires": gsjs.or_text(r.get(label))}
    for r in cert_read_tab(reads, cert_source_tab(reads, "trainings")):
        course = training_keys.get(gsjs.trim(cert_field_of(r, f["trainings.course"]).lower()))
        if not course:
            continue
        p = touch(cert_field_of(r, f["trainings.name"]))
        if not p:
            continue
        st = cert_state_of(reads, "ist_cert_tracker_statuses", cert_field_of(r, f["trainings.status"]), "expiring")
        p["certs"][course] = {"status": "expired" if st == "expired" else "expiring",
                              "expires": cert_field_of(r, f["trainings.expires"])}
    latest = None
    for r in cert_read_tab(reads, cert_source_tab(reads, "mais")):
        if cert_state_of(reads, "ist_cert_mais_statuses", cert_field_of(r, f["mais.status"]), "expired") == "skip":
            continue
        nm = cert_field_of(r, f["mais.name"])
        if name_key(nm) != key:
            continue
        ms = _cert_ms(cert_field_of(r, f["mais.expires"])) or 0
        if latest is None or ms > latest["ms"]:
            latest = {"ms": ms, "row": r, "name": nm}
    if latest is not None:
        p = touch(latest["name"])
        if p:
            r2 = latest["row"]
            certified = cert_state_of(reads, "ist_cert_mais_statuses", cert_field_of(r2, f["mais.status"]),
                                      "expired") == "certified"
            expires2 = cert_field_of(r2, f["mais.expires"])
            ms2 = _cert_ms(expires2)
            st = ("expired" if not certified or (ms2 is not None and ms2 < now_ms)
                  else "expiring" if ms2 is not None and ms2 < soon else "valid")
            p["certs"][CERT_MAIS_KEY] = {"status": st, "expires": expires2,
                                         "category": cert_field_of(r2, f["mais.category"])}
    overlay = clearance_for(reads, key)
    if overlay:
        today_ms = datetime(*reads.now.astimezone(NY).timetuple()[:3], tzinfo=NY).timestamp() * 1000.0
        if person_ is None:
            person_ = {"name": "", "certs": {c: {"status": "missing", "expires": ""} for c in CLEARANCE_CREDENTIALS}}
        for cred in CLEARANCE_CREDENTIALS:
            rec = overlay.get(cred)
            if not rec:
                continue
            if not person_["name"] and rec["name"]:
                person_["name"] = rec["name"]
            cell_ = person_["certs"].get(cred) or {"status": "missing", "expires": ""}
            if rec["decision"] == "revoked":
                person_["certs"][cred] = {"status": "expired", "expires": cell_.get("expires") or ""}
                continue
            exp = _clearance_ms(rec["expires_on"])
            if exp is not None and exp < today_ms:
                person_["certs"][cred] = {"status": "expired", "expires": rec["expires_on"]}
                continue
            current = gsjs.or_text(cell_.get("status")).lower()
            if current in ("expired", "expiring") or (current and current != "missing"):
                continue
            verified = rec["decision"] == "verified"
            person_["certs"][cred] = {"status": "valid" if verified else "expiring", "expires": rec["expires_on"] or "",
                                      "evidence": "verified" if verified else "submitted"}
    return person_


def cert_pictures(reads: L.Reads) -> dict[str, dict[str, Any]]:
    """certPicture_ for everyone at once: cert_picture's own reading, each source walked once (the requirement
    states' rebuild reads every person's)."""
    out: dict[str, dict[str, Any]] = {}

    def touch(nm: Any) -> dict | None:
        k = name_key(nm)
        if not k:
            return None
        if k not in out:
            out[k] = {"name": gsjs.trim(gsjs.js_str(nm)), "certs": {}}
        return out[k]

    now_ms = reads.now.timestamp() * 1000.0
    soon = now_ms + cert_expiring_days(reads) * 24 * 3600 * 1000
    master_cols = cfg_pairs(reads, "ist_cert_master_columns")["map"]
    training_keys = {gsjs.trim(k.lower()): v for k, v in cfg_pairs(reads, "ist_cert_training_keys")["map"].items()}
    f = {k: cert_source_field(reads, k) for k in ("master.name", "trainings.name", "trainings.course", "trainings.status",
                                                 "trainings.expires", "mais.name", "mais.status", "mais.expires",
                                                 "mais.category")}
    by_key: dict[str, list[dict]] = {}
    for r in cert_read_tab(reads, cert_source_tab(reads, "master")):
        by_key.setdefault(name_key(master_name(r, f["master.name"])), []).append(r)
    for mine in by_key.values():
        active = any(_status_active(r) for r in mine)
        for r in mine:
            if len(mine) > 1 and active and not _status_active(r):
                continue
            p = touch(master_name(r, f["master.name"]))
            if not p:
                continue
            for label, cred in master_cols.items():
                ms = _cert_ms(r.get(label))
                if ms is None:
                    continue
                p["certs"][cred] = {"status": "expired" if ms < now_ms else ("expiring" if ms < soon else "valid"),
                                    "expires": gsjs.or_text(r.get(label))}
    for r in cert_read_tab(reads, cert_source_tab(reads, "trainings")):
        course = training_keys.get(gsjs.trim(cert_field_of(r, f["trainings.course"]).lower()))
        if not course:
            continue
        p = touch(cert_field_of(r, f["trainings.name"]))
        if not p:
            continue
        st = cert_state_of(reads, "ist_cert_tracker_statuses", cert_field_of(r, f["trainings.status"]), "expiring")
        p["certs"][course] = {"status": "expired" if st == "expired" else "expiring",
                              "expires": cert_field_of(r, f["trainings.expires"])}
    latest: dict[str, dict] = {}
    for r in cert_read_tab(reads, cert_source_tab(reads, "mais")):
        if cert_state_of(reads, "ist_cert_mais_statuses", cert_field_of(r, f["mais.status"]), "expired") == "skip":
            continue
        nm = cert_field_of(r, f["mais.name"])
        k = name_key(nm)
        ms = _cert_ms(cert_field_of(r, f["mais.expires"])) or 0
        if k and (k not in latest or ms > latest[k]["ms"]):
            latest[k] = {"ms": ms, "row": r, "name": nm}
    for got in latest.values():
        p = touch(got["name"])
        if not p:
            continue
        r2 = got["row"]
        certified = cert_state_of(reads, "ist_cert_mais_statuses", cert_field_of(r2, f["mais.status"]),
                                  "expired") == "certified"
        expires2 = cert_field_of(r2, f["mais.expires"])
        ms2 = _cert_ms(expires2)
        st = ("expired" if not certified or (ms2 is not None and ms2 < now_ms)
              else "expiring" if ms2 is not None and ms2 < soon else "valid")
        p["certs"][CERT_MAIS_KEY] = {"status": st, "expires": expires2, "category": cert_field_of(r2, f["mais.category"])}
    today_ms = datetime(*reads.now.astimezone(NY).timetuple()[:3], tzinfo=NY).timestamp() * 1000.0
    for k, overlay in clearances(reads).items():
        person_ = out.get(k)
        if person_ is None:
            person_ = out[k] = {"name": "", "certs": {c: {"status": "missing", "expires": ""}
                                                     for c in CLEARANCE_CREDENTIALS}}
        for cred in CLEARANCE_CREDENTIALS:
            rec = overlay.get(cred)
            if not rec:
                continue
            if not person_["name"] and rec["name"]:
                person_["name"] = rec["name"]
            cell_ = person_["certs"].get(cred) or {"status": "missing", "expires": ""}
            if rec["decision"] == "revoked":
                person_["certs"][cred] = {"status": "expired", "expires": cell_.get("expires") or ""}
                continue
            exp = _clearance_ms(rec["expires_on"])
            if exp is not None and exp < today_ms:
                person_["certs"][cred] = {"status": "expired", "expires": rec["expires_on"]}
                continue
            current = gsjs.or_text(cell_.get("status")).lower()
            if current in ("expired", "expiring") or (current and current != "missing"):
                continue
            verified = rec["decision"] == "verified"
            person_["certs"][cred] = {"status": "valid" if verified else "expiring", "expires": rec["expires_on"] or "",
                                      "evidence": "verified" if verified else "submitted"}
    return out


def tracker_words(reads: L.Reads, key: str) -> dict[str, str]:
    """spTrackerWords_: the Trainings Status tracker's own word per course for this person."""
    keys = {gsjs.trim(k.lower()): v for k, v in cfg_pairs(reads, "ist_cert_training_keys")["map"].items()}
    col = {k: cert_source_field(reads, "trainings." + k) for k in ("name", "course", "status")}
    out: dict[str, str] = {}
    for r in cert_read_tab(reads, cert_source_tab(reads, "trainings")):
        if name_key(cert_field_of(r, col["name"])) != key:
            continue
        course = keys.get(gsjs.trim(cert_field_of(r, col["course"]).lower()))
        word = text(cert_field_of(r, col["status"]), 60)
        if course and word:
            out[course] = word
    return out


def bci_state(mf: dict) -> dict[str, str]:
    """spBciState_."""
    d = sp_day(mf.get("bci_check_date")) or gsjs.or_text(mf.get("bci_fbi_date"))
    if d:
        return {"state": "clear", "date": d}
    if mf.get("bci_ref_masked"):
        return {"state": "pending", "date": ""}
    f = flag(mf.get("flag_bci"))
    return {"state": "clear", "date": ""} if f in ("1", "0.5") else {"state": "missing", "date": ""}


def compliance_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """spComplianceBuild_: each course with its renewal and tracker word, the driving credentials, the screening."""
    _unsure(ctx, COMPLIANCE_IDS, "Compliance")
    if "bci_ref_masked" in (ctx.get("_withheld") or []):
        raise Defer("the copy withholds the BCI receipt the screening line reads")
    why: list[str] = []
    degraded = False
    today, window = reads.today(), _window(reads)
    picture, w = _soft(lambda: cert_picture(reads, ctx["key"]))
    if picture is None and w:
        why.append(why_of("the certifications", w))
        degraded = True
    words, w = _soft(lambda: tracker_words(reads, ctx["key"]))
    if words is None:
        why.append(why_of("the Trainings Status tracker", w))
        degraded = True
    renewals, w = _soft(lambda: meddel_flows(reads, ctx["key"]))
    if renewals is None:
        why.append(why_of("the Med Del renewals", w))
        degraded = True
    known = picture is not None
    mine = (picture or {}).get("certs") or {}
    review: dict[str, bool] = {}
    papers: list[dict] = []
    ups = uploads(reads)
    if ups is None:
        why.append("the uploads ledger could not be read")
        degraded = True
    for r in ups or []:
        if fold(r.get("person")) != ctx["key"] or gsjs.str_(r.get("confirmedat")):
            continue
        for k in (gsjs.str_(r.get("reqid")), gsjs.str_(r.get("cert"))):
            if k:
                review[k] = True
        if gsjs.str_(r.get("id")) and gsjs.str_(r.get("reqid")):
            full = upload_out(r)
            papers.append({k: full[k] for k in PAPER_FIELDS})
    papers.sort(key=functools.cmp_to_key(lambda a, b: 1 if a["at"] < b["at"] else (-1 if a["at"] > b["at"] else 0)))
    courses = cert_matrix_columns(reads)
    catalog, w = _soft(lambda: req_catalog(reads))
    if catalog is None:
        why.append(why_of("the requirements catalogue", w))
        degraded = True
    training = []
    for k in courses:
        cell_ = mine.get(k)
        expires = sp_day(cell_.get("expires")) if cell_ else ""
        state = "no_date" if known else "not_on_file"
        if cell_:
            st = gsjs.or_text(cell_.get("status")).lower()
            state = ("expired" if st == "expired" else "no_date" if not expires
                     else "due_soon" if st == "expiring" else date_state(expires, window, today))
        renewal = (renewals or {}).get(k)
        if renewal and state in ("no_date", "not_on_file"):
            state = "renewal_assigned"
        if review.get(k) and state != "current":
            state = "in_review"
        training.append({"id": k, "label": cert_label(reads, k), "expires": expires, "state": state,
                         "source": "upload" if state == "in_review" else ("employee_database" if cell_ else
                                                                          ("meddel_flows" if renewal else "")),
                         "tracker_word": (words or {}).get(k) or "",
                         "renewal": {"phase": renewal["phase"], "phase_label": renewal["phase_label"],
                                     "level": renewal["level"]} if renewal else None,
                         "filing": filing_of(catalog, k)})
    m = ctx.get("master")
    if not m:
        why.append(ctx.get("master_why") or "this person has no row in the Employee Database Master")
        if not ctx["master_read"]:
            degraded = True
    why.append(missing_why(ctx, COMPLIANCE_IDS[:12]))
    mf = m or {}
    driver_na = bool(re.fullmatch(r"no|none", gsjs.or_text(mf.get("driver")), re.I)) or is_na(mf.get("driver"))

    def cred(cid: str, label: str, exp: str) -> dict[str, Any]:
        e = sp_day(mf.get(exp))
        state = "not_on_file" if not m else (date_state(e, window, today) if e else ("na" if driver_na else "not_on_file"))
        return {"id": cid, "label": label, "expires": e, "state": state,
                "note": "Not a driver on the Employee Database" if driver_na and not e else "",
                "filing": filing_of(catalog, cid)}

    credentials = [cred("driver_license", "Driver's license", "license_exp"),
                   cred("car_insurance", "Auto insurance", "insurance_exp"),
                   {"id": "nurse_aide", "label": "Nurse Aide / STNA", "expires": "", "state": "na",
                    "note": "No STNA licence source is on the platform; the Nurse Aide columns of the Employee Database "
                            "are the registry check shown under Screening.", "filing": filing_of(catalog, "nurse_aide")}]
    screens = {sid: screen_state(mf.get(c), mf.get(fl)) for sid, _l, c, fl in SCREENS}
    federal = screen_join([screens["sam"], screens["oig"]])
    registries = screen_join([screens[s] for s in ("abuser", "sex_offender", "offender", "nurse_aide", "exclusions")])
    bci = bci_state(mf)
    screening = [{"id": "federal", "label": "Federal exclusions (SAM + OIG)", "state": federal["state"] if m else "missing",
                  "date": federal["date"]},
                 {"id": "state_registries", "label": "State registries",
                  "state": registries["state"] if m else "missing", "date": registries["date"]},
                 {"id": "bci_fbi", "label": "BCI / FBI", "state": bci["state"] if m else "missing", "date": bci["date"],
                  "rapback_date": sp_day(mf.get("rapback_entry_date"))}]
    return {"training": training, "credentials": credentials, "screening": screening, "window_days": window,
            "papers": papers[:PAPERS_SHOWN], "why": "; ".join(w for w in why if w), "degraded": degraded}


# ---- HR --------------------------------------------------------------------------------------------------------------

HR_IDS = ("ssn", "ssn_last4", "dob", "address", "city", "state", "zip", "w4_date", "pay_auth_date", "i9_date",
          "i9_completed", "i9_type_1", "i9_type_1_exp", "i9_type_2", "i9_type_2_exp", "hipaa_date", "driver", "dl",
          "license_exp", "abstract_original", "abstract_latest", "insurance_exp", "sam", "oig", "abuser",
          "sex_offender", "offender", "nurse_aide", "exclusions", "bci_fbi", "bci_check_date", "rapback_entry_date")


def hr_build(ctx: dict) -> dict[str, Any]:
    """spHrBuild_: the restricted record, masked where it is read."""
    _unsure(ctx, HR_IDS + tuple(fl for _s, _l, _c, fl in SCREENS), "The HR record")
    if ctx.get("_withheld"):
        raise Defer("the copy withholds a cell the HR record shows masked")
    m = ctx.get("master") or {}
    why: list[str] = []
    if not ctx.get("master"):
        why.append(ctx.get("master_why") or "this person has no row in the Employee Database Master")
    why.append(missing_why(ctx, HR_IDS))
    driver = text(m.get("driver"))
    screening = []
    for sid, label, c, fl in SCREENS:
        st = screen_state(m.get(c), m.get(fl))
        screening.append({"id": sid, "label": label, "state": st["state"] if ctx.get("master") else "missing",
                          "date": st["date"]})
    bci = bci_state(m)
    screening.append({"id": "bci_fbi", "label": "BCI / FBI", "state": bci["state"] if ctx.get("master") else "missing",
                      "date": bci["date"], "ref_masked": m.get("bci_ref_masked") or ""})
    return {"personal": {"ssn_masked": m.get("ssn_masked") or "", "dob": sp_day(m.get("dob")), "address": text(m.get("address")),
                         "city": text(m.get("city")), "state": text(m.get("state")), "zip": text(m.get("zip")),
                         "w4_date": sp_day(m.get("w4_date")), "pay_auth_date": sp_day(m.get("pay_auth_date"))},
            "work_auth": {"i9_date": sp_day(m.get("i9_date")), "i9_completed": text(m.get("i9_completed")),
                          "i9_type_1": text(m.get("i9_type_1")),
                          "i9_type_1_exp": sp_day(m.get("i9_type_1_exp")) or ("n/a" if is_na(m.get("i9_type_1_exp")) else ""),
                          "i9_type_2": text(m.get("i9_type_2")),
                          "i9_type_2_exp": sp_day(m.get("i9_type_2_exp")) or ("n/a" if is_na(m.get("i9_type_2_exp")) else ""),
                          "hipaa_date": sp_day(m.get("hipaa_date"))},
            "driver": {"driver": driver, "approved": bool(re.fullmatch(r"yes", driver, re.I)),
                       "license_masked": m.get("license_masked") or "", "license_exp": sp_day(m.get("license_exp")),
                       "abstract_original": sp_day(m.get("abstract_original")) or text(m.get("abstract_original")),
                       "abstract_latest": sp_day(m.get("abstract_latest")) or text(m.get("abstract_latest")),
                       "insurance_exp": sp_day(m.get("insurance_exp"))},
            "screening": screening, "bci_check_date": sp_day(m.get("bci_check_date")),
            "rapback_entry_date": sp_day(m.get("rapback_entry_date")), "why": "; ".join(w for w in why if w),
            "degraded": not ctx["master_read"]}


HR_SHOWN_DAYS = ("w4_date", "pay_auth_date", "i9_date", "hipaa_date", "license_exp", "insurance_exp", "bci_check_date",
                 "rapback_entry_date")
HR_SHOWN_SCREENS = {c: fl for _s, _l, c, fl in SCREENS}


def hr_shown(ctx: dict, field: str) -> str:
    """What spHrBuild_ shows of one editable HR field: the value a holder's HR panel opened on."""
    m = ctx.get("master") or {}
    v = m.get(field)
    if field in HR_SHOWN_SCREENS:
        return screen_state(v, m.get(HR_SHOWN_SCREENS[field]))["date"]
    if field in ("i9_type_1_exp", "i9_type_2_exp"):
        return sp_day(v) or ("n/a" if is_na(v) else "")
    if field in ("abstract_original", "abstract_latest"):
        return sp_day(v) or text(v)
    if field in HR_SHOWN_DAYS:
        return sp_day(v)
    return text(v)


def hr_with_account(data: dict, ctx: dict) -> dict[str, Any]:
    """spHrWithAccount_: the record plus the account as read this call."""
    a = ctx.get("account")
    live = scrub({"account": {"user_id": a["user_id"], "login": a["email"], "role": a["role"], "active": a["active"],
                              "last_login": a["last_login"], "created_at": a["created_at"]} if a else None,
                  "account_why": "" if a else (ctx.get("account_why") or "no platform account carries this person's "
                                                                         "e-mail or name")})
    return {**data, "account": live["account"], "account_why": live["account_why"]}


# ---- the own address (My Profile) ------------------------------------------------------------------------------------

def _live(row: dict | None) -> bool:
    """complianceDocsLive_."""
    off = gsjs.str_((row or {}).get("active")).upper()
    return off not in ("FALSE", "0", "NO") and not gsjs.str_((row or {}).get("mergedinto"))


def roster_mails(p: dict | None) -> list[str]:
    """complianceDocsRosterMails_."""
    out: list[str] = []

    def take(e: Any) -> None:
        k = gsjs.str_(e).lower()
        if "@" in k and k not in out:
            out.append(k)

    take((p or {}).get("email"))
    if p and isinstance(p.get("emails"), list):
        for e in p["emails"]:
            take(e)
    return out


def _link_proof(account: dict | None) -> str:
    """complianceDocsLinkProof_."""
    try:
        cs = json.loads(gsjs.str_((account or {}).get("contactsources")) or "{}")
    except ValueError:
        cs = None
    how = gsjs.str_(cs.get("people_id")) if isinstance(cs, dict) else ""
    return how if how in ("email", "name") else ""


def _self_named(account: dict | None) -> bool:
    return gsjs.trim(gsjs.str_((account or {}).get("nameby"))).lower() == "self"


def _on_staff(reads: L.Reads, row: dict | None) -> bool:
    """complianceDocsOnStaff_ (cgBlockStatuses_)."""
    raw = gsjs.or_text(reads.config().get("staff_guard_block_statuses"))
    statuses = {gsjs.trim(s).lower() for s in re.split(r"[,;\n]+", raw or "active, admin") if gsjs.trim(s)}
    statuses = statuses or {"active", "admin"}
    return gsjs.trim(gsjs.str_((row or {}).get("status"))).lower() in statuses


def compliance_self(reads: L.Reads, user: dict | None) -> dict[str, Any]:
    """complianceDocsSelf_: the caller's own roster row, settled from the account's own row, never the payload."""
    out: dict[str, Any] = {"name": "", "key": "", "names": [], "id": "", "since": "", "mail": "", "bridged": False,
                           "found": "", "why": "", "status": 403}
    if not user or user.get("is_service"):
        out["why"] = "Certificates are read and filed from a person's own session."
        return out
    accounts = reads.users()
    uid = gsjs.str_(user.get("id"))
    me = next((a for a in accounts if uid and gsjs.str_(a.get("userid")) == uid), None)
    if not me or not _live(me):
        out["why"] = "Your account is not among the active accounts, so no certificate can be matched to you."
        return out
    rows, _w = _soft(lambda: without_isp_clients(reads, people_merged(reads, _people(reads))))
    if not rows:
        out["status"] = 503
        out["why"] = ("The staff roster could not be read, so whose certificates these are could not be settled — "
                      "try again in a minute.")
        return out
    pick = None
    by_mail: list[dict] = []
    linked = vouched = False
    shown = gsjs.trim(gsjs.str_(me.get("displayname")))
    shown_key = fold(shown)
    mail = gsjs.str_(me.get("email")).lower()
    pid = roster_id(me.get("peopleid"))
    if pid:
        pick = next((p for p in rows if roster_id((p or {}).get("id")) == pid), None)
        linked = pick is not None
    if linked:
        vouched = bool(_link_proof(me))
        row_has_mail = "@" in mail and mail in roster_mails(pick)
        if not vouched and not row_has_mail:
            out["why"] = ("Your account is linked to a roster row by an older rule, and your sign-in e-mail is not on "
                          "that row, so it is not taken as yours — an administrator puts your sign-in e-mail on your "
                          "roster row.")
            return out
    if linked and shown_key and fold(pick.get("name")) != shown_key and \
            any(p is not pick and fold((p or {}).get("name")) == shown_key for p in rows):
        out["why"] = ("Your account is linked to one row of the staff roster and your name is on another, so which "
                      "record is yours cannot be settled — an administrator makes the two agree, so your account's "
                      "name is the name on your roster row.")
        return out
    if pick is None:
        if "@" in mail:
            by_mail = [p for p in rows if mail in roster_mails(p)]
        by_nm = [p for p in rows if fold((p or {}).get("name")) == shown_key] if shown_key else []
        if len(by_mail) == 1:
            pick = by_mail[0]
            if by_nm and fold(pick.get("name")) != shown_key:
                out["why"] = ("Your sign-in e-mail is on one row of the staff roster and your name is on another, so "
                              "which record is yours cannot be settled — an administrator corrects the e-mail on the "
                              "roster or the name on your account, so both point at your row.")
                return out
        else:
            pick = by_nm[0] if by_nm else None
            if pick is not None and _self_named(me):
                out["why"] = ("Your name was chosen on your own account, and a name can be taken before its roster row "
                              "exists, so it is not taken as proof of which record is yours — an administrator sets "
                              "the name on your account, or puts your sign-in e-mail on your roster row.")
                return out
    if pick is None:
        if len(by_mail) > 1:
            out["why"] = ("Your sign-in e-mail is on more than one row of the staff roster and your name is on none, "
                          "so no certificate can be matched to you — an administrator gives your account the exact "
                          "name on your roster row.")
        elif not shown:
            out["why"] = ("Your account has no name on file, so no certificate can be matched to you — an "
                          "administrator sets the name.")
        elif not shown_key:
            out["why"] = (f'Your name on file, "{shown}", has no letters a–z or digits, and certificates are matched '
                          "to a person by those, so none can be matched to you.")
        else:
            out["why"] = (("The roster row your account is linked to is not on the staff roster" if pid
                           else "Your account is not linked to a roster row")
                          + " and your name is not on the staff roster, so no certificate can be matched to you — an "
                          "administrator gives your account the exact name on your roster row, or puts your sign-in "
                          "e-mail on it.")
        return out
    if not vouched and not _on_staff(reads, pick):
        word = gsjs.trim(gsjs.str_(pick.get("status")))
        out["why"] = ((f'The staff roster row that matches your account is marked "{word}", not on staff' if word
                       else "The staff roster row that matches your account carries no staff status")
                      + ", so it may be someone no longer here — no certificate can be matched to you until your own "
                      "row on the staff roster carries a staff status.")
        return out
    key = fold(pick.get("name"))
    if not key:
        roster_name = gsjs.trim(gsjs.str_(pick.get("name")))
        out["why"] = (f'Your roster row\'s name, "{roster_name}", has no letters a–z or digits, and certificates are '
                      "matched to a person by those, so none can be matched to you." if roster_name else
                      "Your roster row has no name, so no certificate can be matched to you — an administrator sets "
                      "the name on the roster.")
        return out
    if len([p for p in rows if fold((p or {}).get("name")) == key]) > 1:
        out["found"] = gsjs.str_(pick.get("name"))
        out["why"] = ("Two rows on the staff roster carry your name, so certificates filed under it cannot be told "
                      "apart — an administrator merges the rows or gives one a distinguishing name.")
        return out
    twin_id, twin_mails = roster_id(pick.get("id")), roster_mails(pick)
    for o in accounts:
        if gsjs.str_(o.get("userid")) == uid or not _live(o):
            continue
        o_pid, o_mail = roster_id(o.get("peopleid")), gsjs.str_(o.get("email")).lower()
        if fold(o.get("displayname")) == key or (o_pid and o_pid == twin_id) or (o_mail and o_mail in twin_mails):
            out["found"] = gsjs.str_(pick.get("name"))
            out["why"] = ("Your name is shared with another account, so no certificate can be matched to you by name — "
                          "an administrator settles which account is yours.")
            return out
    out.update(name=gsjs.str_(pick.get("name")), key=key, id=twin_id,
               since=gsjs.str_(_or(pick.get("createdAt"), pick.get("createdat"), pick.get("created_at"))),
               mail=gsjs.trim(mail) if "@" in mail else "",
               bridged=not (shown_key == key and not _self_named(me)) and not (linked and _link_proof(me) == "name"),
               names=[key, shown_key] if shown_key and shown_key != key else [key], status=200)
    return out


def address_subject(sess: L.Session, payload: dict) -> dict[str, Any]:
    """spAddressSubject_: FAIL-CLOSED, whose address this call reads, from the session alone."""
    user = sess.user
    if not user or user.get("is_service"):
        return {"refused": {"status": 403, "message": ADDRESS_WORDS["session"]}}
    if user.get("visiting_member"):
        return {"refused": {"status": 403, "message": ADDRESS_WORDS["visit"]}}
    g = sc.profile_app_gate(ADDRESS_APP, user, sess.reads.scope_sources())
    if not g or g.get("open") is not True:
        return {"refused": {"status": 403, "message": ADDRESS_WORDS["gate"]}}
    asked = gsjs.trim(gsjs.or_blank(payload.get("key")))
    if asked:
        if not sc.is_real_master(user):
            return {"refused": {"status": 403, "message": ADDRESS_WORDS["others"]}}
        chosen = person(sess.reads, asked)
        return {"refused": chosen["refused"]} if chosen.get("refused") else {"ctx": chosen, "own": False}
    me = compliance_self(sess.reads, user)
    if not me["key"]:
        return {"refused": {"status": me["status"], "message": me["why"]}}
    if me["bridged"]:
        return {"refused": {"status": 403, "message": ADDRESS_WORDS["bridged"]}}
    ctx = person(sess.reads, me["key"])
    if ctx.get("refused"):
        return {"refused": ctx["refused"]}
    if not ctx.get("people") or roster_id(ctx["people"].get("id")) != me["id"]:
        return {"refused": {"status": 409, "message": ADDRESS_WORDS["untold"]}}
    return {"ctx": ctx, "own": True}


def address_answer(ctx: dict, own: bool) -> dict[str, Any]:
    """spAddressAnswer_: the address as the Master keeps it, the raw cells, and why a field may not be changed."""
    m, raw = ctx.get("master") or {}, ctx.get("master_edit") or {}
    address: dict[str, str] = {}
    edit: dict[str, str] = {}
    locked: dict[str, str] = {}
    for f in ADDRESS_FIELDS:
        address[f] = text(m.get(f), 200)
        if f in raw:
            edit[f] = gsjs.or_blank(raw[f])
        why = edit_refusal(ctx, f)
        if why:
            locked[f] = why
    opened = [f for f in ADDRESS_FIELDS if f not in locked and f in edit]
    shut = next((locked[f] for f in ADDRESS_FIELDS if locked.get(f)), "")
    return {"staff_key": ctx["key"], "name": ctx["name"], "own": own, "read": bool(ctx.get("master")), "address": address,
            "edit": edit, "locked": locked, "allowed": len(opened) > 0,
            "why": "" if opened else (shut or "The Employee Database has no address column.")}


# ---- the actions -----------------------------------------------------------------------------------------------------

def _whole_person(sess: L.Session, payload: dict) -> dict[str, Any]:
    """spWholeGate_ then staffProfilesPerson_: {refused} or the person."""
    if not whole_gate(sess):
        return {"refused": unknown()}
    return person_for(sess, payload.get("staff"))


def staff_profile_roster(sess: L.Session, payload: dict) -> dict[str, Any]:
    gate = reader(sess)
    # a client or family viewer is shown no staff member: their own record and its people are Clients' and Families'
    if not gate["open"] or basic_gate(gate):
        return unknown()
    raw = payload.get("show_inactive")
    with_inactive = raw is True or bool(re.fullmatch(r"true|1|yes|on", gsjs.or_blank(raw), re.I))
    res = roster_answer(sess.reads, gate, with_inactive)
    if res["status"] == 200 and res.get("data"):
        own = own_only(sess)
        if own is not None:
            mine = [r for r in res["data"].get("staff") or [] if own and gsjs.or_text((r or {}).get("key")) == own]
            res["data"] = dict(res["data"], staff=mine, counts={
                "active": sum(1 for r in mine if r.get("status") != "inactive"),
                "inactive": sum(1 for r in mine if r.get("status") == "inactive"),
                "ambiguous": sum(1 for r in mine if r.get("ambiguous"))})
        res["data"]["may"] = {"assign": "any" if training_assigner(sess.reads, sess.user, "") else "",
                              "self_key": self_key(sess.user), "own_only": own is not None}
    return res


def edit_person(ctx: dict) -> dict[str, Any]:
    """The record's own facts the edit panel shows locked: the overview's person without what it reads beside it."""
    m, p, a = ctx.get("master") or {}, ctx.get("people") or {}, ctx.get("account") or {}
    emp_id = m.get("employee_id") or ""
    emp_src = "master" if emp_id else ""
    if not emp_id and not gsjs.falsy(p.get("employee_id")):
        emp_id, emp_src = gsjs.js_str(p.get("employee_id")), "roster"
    return {"key": ctx["key"], "name": ctx["name"], "first_name": ctx["first_name"], "last_name": ctx["last_name"],
            "employee_id": emp_id, "employee_id_source": emp_src, "roster_id": gsjs.or_text(p.get("id")),
            "role": role_of(p, a), "status": ctx["status"]}


EDIT_READ_SECTIONS = ("profile", "employment", "compliance")


def staff_profile_edit_read(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffProfileEditRead (Python's own): an edit panel's read — the raw values a section's editions open to…"""
    section = gsjs.trim(gsjs.or_blank(payload.get("section")))
    if section not in EDIT_READ_SECTIONS:
        return {"status": 400, "message": "section: profile, employment or compliance."}
    ctx = _whole_person(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    data = {"person": edit_person(ctx), "edit_only": True}
    return with_edit({"status": 200, "data": _shown(scrub(data))}, ctx, sess.user, section, sess.reads)


def staff_profile_overview(sess: L.Session, payload: dict) -> dict[str, Any]:
    gate = reader(sess)
    if not gate["open"] or basic_gate(gate):
        return unknown()
    ctx = person_for(sess, payload.get("staff"))
    if ctx.get("refused"):
        return ctx["refused"]
    return with_edit(serve("The staff profile", lambda: overview_build(sess.reads, ctx)), ctx, sess.user, "profile",
                     sess.reads)


def staff_profile_employment(sess: L.Session, payload: dict) -> dict[str, Any]:
    ctx = _whole_person(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return with_edit(serve("The employment record", lambda: employment_build(sess.reads, ctx)), ctx, sess.user,
                     "employment", sess.reads)


def staff_profile_compliance(sess: L.Session, payload: dict) -> dict[str, Any]:
    ctx = _whole_person(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return with_edit(serve("The compliance record", lambda: compliance_build(sess.reads, ctx)), ctx, sess.user,
                     "compliance", sess.reads)


def staff_profile_hr(sess: L.Session, payload: dict) -> dict[str, Any]:
    if not tab_open(sess, HR_FEATURE, HR_EDITIONS):
        return unknown()
    ctx = _whole_person(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    res = serve("The HR record", lambda: hr_build(ctx))
    if res["status"] != 200:
        return res
    # every view is a line in the audit history
    SV.record(sess.user, "staffProfileHr", ctx["key"])
    return with_edit({"status": 200, "data": hr_with_account(res["data"], ctx)}, ctx, sess.user, "hr", sess.reads)


def staff_profile_actions(sess: L.Session, payload: dict) -> dict[str, Any]:
    ctx = _whole_person(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return serve("The pending items", lambda: actions_build(sess.reads, ctx))


def staff_profile_activity(sess: L.Session, payload: dict) -> dict[str, Any]:
    if not tab_open(sess, ACTIVITY_FEATURE):
        return unknown()
    ctx = _whole_person(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return serve("The activity", lambda: activity_build(sess.reads, ctx))


def staff_profile_preferences(sess: L.Session, payload: dict) -> dict[str, Any]:
    ctx = _whole_person(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return serve("The preferences", lambda: prefs_build(sess.reads, ctx))


def staff_profile_address(sess: L.Session, payload: dict) -> dict[str, Any]:
    who = address_subject(sess, payload)
    if who.get("refused"):
        return who["refused"]
    if not who["own"]:
        raise Defer("a read of another person's address is written to the audit history, which Apps Script keeps")
    return {"status": 200, "data": _shown(scrub(address_answer(who["ctx"], True)))}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "staffProfileRoster": staff_profile_roster, "staffProfileOverview": staff_profile_overview,
    "staffProfileEmployment": staff_profile_employment, "staffProfileCompliance": staff_profile_compliance,
    "staffProfileHr": staff_profile_hr, "staffProfileActions": staff_profile_actions,
    "staffProfileActivity": staff_profile_activity, "staffProfileAddress": staff_profile_address,
    "staffProfilePreferences": staff_profile_preferences, "staffProfileEditRead": staff_profile_edit_read,
}

# HUB_POLICY: the roles each read is declared for, and its typed params (Resolver.gs checks both first)
POLICY_ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
POLICY: dict[str, dict[str, Any]] = {a: {"roles": POLICY_ROLES, "params": {"staff": "string"}} for a in ACTIONS}
POLICY["staffProfileRoster"] = {"roles": POLICY_ROLES, "params": {}}
POLICY["staffProfileEditRead"] = {"roles": POLICY_ROLES, "params": {"staff": "string", "section": "string"}}
POLICY["staffProfileAddress"] = {"roles": ("admin", "director", "manager", "staff"), "params": {"key": "string"}}
# Apps Script writes an audit line for these reads (hubSysLog_); their doors here leave every audited answer to it
AUDITED = frozenset({"staffProfileHr"})


def _edit_part(section: str) -> Callable[[L.Reads, dict], dict[str, Any]]:
    return lambda reads, ctx: {"status": 200, "data": _shown(scrub(edit_raw(ctx, section)))}


# spPackDoors_'s parts this module answers: fn(reads, ctx) → the part's answer, as its section door answers a whole viewer
PACK_DOORS: dict[str, Callable[[L.Reads, dict], dict[str, Any]]] = {
    "overview": lambda reads, ctx: serve("The staff profile", lambda: overview_build(reads, ctx)),
    "edit_profile": _edit_part("profile"),
    "actions": lambda reads, ctx: serve("The pending items", lambda: actions_build(reads, ctx)),
    "activity": lambda reads, ctx: serve("The activity", lambda: activity_build(reads, ctx)),
    "preferences": lambda reads, ctx: serve("The preferences", lambda: prefs_build(reads, ctx)),
    "compliance": lambda reads, ctx: serve("The compliance record", lambda: compliance_build(reads, ctx)),
    "employment": lambda reads, ctx: serve("The employment record", lambda: employment_build(reads, ctx)),
    "edit_employment": _edit_part("employment"),
    "edit_compliance": _edit_part("compliance"),
}
