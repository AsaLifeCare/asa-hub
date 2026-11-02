"""Staff Candidates (apps-script/CandidateProfiles.gs) answered off asa-hub-db, read from the Hiring app's own records."""
from __future__ import annotations

import functools
import json
import logging
import math
import os
import re
import threading
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import call_prefs as CP
import drive as DRV
import editions
import gsjs
import house_tables as HT
import hubdb
import locations as L
import photos as P
import scope as sc
import ssa as SSA
import staff_comms as SC
import staff_views as SV
from gsjs import NY
from scope import Defer

log = logging.getLogger("asa-hub-app")

APP_ID = "staff-candidates"
UNKNOWN = "Unknown action."
# CandidateProfiles.gs
CND_PACK_PARTS = ("overview", "actions", "interviews", "documents", "activity", "texts", "transcripts")
CND_NOTE_MAX = 900
CND_ACTIVITY_CAP = 400
CND_RECENT = 5
CND_STATUS_TAB = "log_status_history"
CND_STAGE_LABELS = {"new": "New", "phone-screen": "Phone Screen", "interview": "Interview", "onboarding": "Onboarding",
                    "hired": "Hired", "ready": "Ready to start"}
CND_ONBOARDING_STAGES = ("onboarding", "hired", "ready")
CND_DOORS: dict[str, dict[str, Any]] = {
    "resume-decision": {"action": "setDecision", "fields": {"checkpoint": "resume-decision", "value": "Advance"}},
    "advance-decision": {"action": "setDecision", "fields": {"checkpoint": "advance-decision", "value": "Advance"},
                         "stage": "phone-screen"},
    "transcript": {"action": "screenManualComplete", "form": "notes", "stage": "phone-screen"},
    "ai-report": {"action": "screenManualComplete", "form": "notes", "stage": "phone-screen"},
    "screen-details": {"action": "screenManualComplete", "form": "notes", "stage": "phone-screen"},
    "interview-scheduled": {"action": "hiringScheduleCreate", "form": "schedule",
                            "fields": {"event_type": "in_person_interview"}, "stage": "interview"},
    "interview-scorecard": {"action": "interviewSave", "form": "scorecard", "stage": "interview"},
    "interview-recommendation": {"action": "interviewSave", "form": "scorecard", "stage": "interview"},
    "new-hire-packet": {"action": "packetWaive", "form": "note"},
    "onboarding-complete": {"action": "onboardingManualComplete", "form": "notes", "stage": "onboarding"},
    "resume": {"action": "tableDocUpload", "form": "upload", "fields": {"item_id": "resume"}},
    "cjis": {"action": "tableDocUpload", "form": "upload", "fields": {"item_id": "cjis"}},
}
CND_MACHINE_ITEMS = ("application", "staff-account", "internal-docs-fill")
CND_PRESS_STEP = "staff_candidates"
CND_PRESS_ECHO_MS = 600000
CND_PRESS_TITLES = {"complete": "Mark complete", "stage": "Update stage", "upload": "Document filed",
                    "document": "Document filed"}
CND_DOOR_TITLES = {"setDecision": "Advance", "screenManualComplete": "Manual phone screen",
                   "hiringScheduleCreate": "Schedule the interview", "interviewSave": "Interview scorecard",
                   "packetWaive": "New Hire packet on file", "onboardingManualComplete": "Manual onboarding",
                   "tableDocUpload": "Upload the file", "moveStage": "Move the stage", "hiringDiscard": "Not hiring",
                   "docUpload": "Onboarding Documents"}
CND_DOOR_FIELDS: dict[str, dict[str, str]] = {
    "setDecision": {}, "moveStage": {},
    "screenManualComplete": {"notes": "notes"},
    "hiringScheduleCreate": {"date": "date", "time": "time", "location": "location", "with_name": "with_name",
                             "notes": "notes"},
    "interviewSave": {"interviewer_name": "interviewer_name", "score": "score", "recommendation": "recommendation",
                      "notes": "comments"},
    "packetWaive": {"notes": "note"},
    "onboardingManualComplete": {"notes": "notes"},
    "hiringDiscard": {"notes": "reason"},
    "tableDocUpload": {"filename": "filename", "mime_type": "mime_type", "base64": "base64"},
}
CND_ITEM_OF_DOC = {"dropbox_packet": "new-hire-packet", "dodd_8hr": "dodd-cert", "cpr_first_aid": "cpr-cert",
                   "med_del": "med-cert", "drivers_id": "drivers-license", "hs_diploma": "diploma",
                   "ss_birth": "ss-card", "background_check": "cjis"}
CND_PAPER_KINDS = {
    "dropbox_packet": ("offer_letter", "work_authorization", "tax_form", "agreement"),
    "background_check": ("background_check",), "dodd_8hr": ("dodd_certification",),
    "cpr_first_aid": ("cpr_first_aid",), "med_del": ("med_admin_cert",), "drivers_id": ("drivers_licence", "state_id"),
    "hs_diploma": ("diploma",), "ss_birth": ("ssn_card", "birth_certificate"), "car_insurance": ("auto_insurance",)}
CND_STEP_PAPERS: dict[str, dict[str, Any]] = {
    "resume": {"doc": "", "label": "Resume", "kinds": ("application_resume",), "word": True},
    "cjis": {"doc": "background_check", "pdf": True},
    "new-hire-packet": {"doc": "dropbox_packet"},
}
CND_PAPER_EXTS = ("pdf", "jpg", "jpeg", "png", "gif")
CND_WORD_TYPES = {"doc": "application/msword",
                  "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
CND_CJIS_STATUSES = ("Pending", "Clear", "Verified", "Disqualified")
CND_KIND_WORDS = {"application_resume": "resume or application", "offer_letter": "offer letter", "tax_form": "tax form",
                  "agreement": "signed agreement"}
CND_WHERE = {"hiring": "the Hiring record", "onboarding": "Onboarding Documents",
             "both": "Onboarding Documents and the Hiring record"}
CND_SCRUB_KEYS = frozenset({"id", "key", "candidate_id", "file_id", "call_id", "srid", "doc_id", "with", "line"})
CND_NARROW_WHY = "Not every hiring record could be read just now, so a candidate tied to these houses may be missing."
CND_EVENT_DONE = re.compile(r"^(completed?|done|held|attended)\Z")
# ComplianceDocs.gs CERT_READ_KIND_WORDS
CERT_READ_KIND_WORDS = {
    "dodd_certification": "DODD certificate", "cpr_first_aid": "CPR / First Aid card",
    "med_admin_cert": "medication administration certificate", "crisis_prevention": "crisis prevention certificate",
    "drivers_licence": "driver's license", "state_id": "state ID", "auto_insurance": "car insurance card",
    "training_transcript": "training record", "diploma": "diploma", "ssn_card": "Social Security card",
    "birth_certificate": "birth certificate", "background_check": "background check", "tb_test": "TB test",
    "driver_abstract": "driver's abstract", "passport": "passport", "work_authorization": "work authorization"}
# Talent.gs, HubCore.gs, Packet.gs, Interview.gs, Onboarding.gs, Files.gs, HiringFlow.gs, OptOut.gs
TALENT_CANDIDATES_TAB = "entity_candidates"
TALENT_RESUME_TAB = "entity_resume_analyses"
TALENT_PHONE_TAB = "entity_phone_screens"
TALENT_STAGE_ORDER = ("new", "phone-screen", "interview", "onboarding", "hired", "ready")
TALENT_EXCLUDE_IDS = ("CAN_7DF46D98345D8F032F02", "CAN_24A360F6398D5015B3CD")
SHARED_LINE_DIGITS = SC.SHARED_LINE_DIGITS
TALENT_STAGE_MAP = {"new": "new", "phone screen": "phone-screen", "phone-screen": "phone-screen", "in person": "interview",
                    "interview": "interview", "onboarding": "onboarding", "ready": "ready", "ready to start": "ready",
                    "hired": "hired", "becoming staff": "hired", "becoming-staff": "hired",
                    "minimal internal documentation ready": "hired", "internal-docs": "hired"}
HUB_STAGE_TO_STATUS = {"new": "New", "phone-screen": "Phone Screen", "interview": "In Person",
                       "onboarding": "Onboarding", "hired": "Hired", "ready": "Ready to Start"}
HUB_INTERVIEWS_TAB = "entity_in_person_interviews"
INTERVIEW_SCORE_MAX = 10
INTERVIEW_ASKS_TAB = "interview_asks"
HIRING_SIM_ASKS_TAB = "hiring_sim_asks"
HIRING_JOURNEY_TAB = "hiring_journey"
HIRING_JOURNEY_MAX = 400
HIRING_EVENTS_TAB = "entity_hiring_events"
HIRING_EVENT_TYPES = {"phone_screen": "Phone screen", "in_person_interview": "In-person interview",
                      "orientation": "Orientation", "start_date": "Start date", "doc_help": "Document Q&A"}
ONBOARDING_TAB = "entity_onboardings"
PACKET_TAB = "onboarding_packet"
PACKET_OWN_COLUMNS = ("FullName", "PacketAcknowledged", "DocumentsComplete", "HubEmail", "HubCandidateId",
                      "GradCandidateId", "BackgroundCheck", "CompleteTraining", "QuestionnaireComplete",
                      "TutorialsComplete", "CompletedAt", "ReleasedAt", "ReleasedBy", "source", "cloned_at",
                      "updated_by", "updated_at")
PACKET_CHIP = {"signed": "Application signed", "waived": "Application on file", "unsigned": "Application not signed",
               "ambiguous": "Application — needs checking", "unknown": "Application not found"}
RECRUIT_TAB = "recruitment_contracts"
RECRUIT_DOCS_TAB = "recruitment_docs"
DOCS_TAB = "candidate_documents"
DOC_CATALOG_TAB = "document_catalog"
# the document catalog's own table (sheet_resources.SPECS)
DOC_CATALOG_RESOURCE = "documentCatalog"
DOC_CATALOG_DEFAULT = (
    {"doc_id": "dropbox_packet", "label": "New Hire Packet (Dropbox Sign)", "required": "yes", "sort": 1},
    {"doc_id": "dodd_8hr", "label": "8-Hr DODD Training Certificate", "required": "yes", "sort": 2},
    {"doc_id": "cpr_first_aid", "label": "CPR / First Aid Certificate", "required": "yes", "sort": 3},
    {"doc_id": "med_del", "label": "Med Delegation Certificate", "required": "no", "sort": 4},
    {"doc_id": "drivers_id", "label": "Driver's License / State ID", "required": "yes", "sort": 5},
    {"doc_id": "hs_diploma", "label": "HS Diploma / GED", "required": "no", "sort": 6},
    {"doc_id": "ss_birth", "label": "SS Card / Birth Certificate", "required": "yes", "sort": 7},
    {"doc_id": "background_check", "label": "Background check (BCI)", "required": "yes", "sort": 8},
    {"doc_id": "car_insurance", "label": "Car Insurance Card", "required": "no", "sort": 9})
ONB_STAGES = ("packet", "background", "documents", "training", "ready")
ONB_CHECKLIST = (
    {"id": "new-hire-packet", "label": "New Hire Packet (offer, I-9, W-4, policies)", "owner": "HR", "stage": "packet",
     "doc": "dropbox_packet"},
    {"id": "questionnaire", "label": "New Hire Questionnaire", "owner": "Candidate", "stage": "packet", "doc": ""},
    {"id": "background-check", "label": "Background Check (BCI/FBI)", "owner": "HR", "stage": "background",
     "doc": "background_check"},
    {"id": "dropbox-link", "label": "Dropbox folder link", "owner": "Auto", "stage": "documents", "doc": ""},
    {"id": "drivers-license", "label": "Driver's License / ID", "owner": "Candidate", "stage": "documents",
     "doc": "drivers_id"},
    {"id": "diploma", "label": "HS Diploma / GED", "owner": "Candidate", "stage": "documents", "doc": "hs_diploma"},
    {"id": "ss-card", "label": "SS Card / Birth Certificate", "owner": "Candidate", "stage": "documents",
     "doc": "ss_birth"},
    {"id": "dodd-cert", "label": "8-Hr DODD Training Certificate", "owner": "Candidate", "stage": "training",
     "doc": "dodd_8hr"},
    {"id": "cpr-cert", "label": "CPR / First Aid Certificate", "owner": "Candidate", "stage": "training",
     "doc": "cpr_first_aid"},
    {"id": "med-cert", "label": "Med Delivery Certificate", "owner": "Candidate", "stage": "training", "doc": "med_del"},
    {"id": "training-assign", "label": "Training assigned (DODD orientation)", "owner": "HR", "stage": "training",
     "doc": ""},
    {"id": "tutorials", "label": "Tutorials — asa. walkthrough", "owner": "Auto", "stage": "training", "doc": ""})
ONB_CERT_ROWS = {"dodd-cert": "dodd", "cpr-cert": "cpr", "med-cert": "med1"}
OB_WINDOW_BEFORE_DEFAULT = 1
OB_WINDOW_AFTER_DEFAULT = 7
# HiringMatrix.gs HIRING_TAB_KEY
HIRING_TAB_KEY = {"hiring_sim_config": "key", "hiring_alerts_config": "key", "recruitment_config": "key",
                  "hiring_policy": "key", "recruitment_contracts": "signaturerequestid",
                  "recruitment_docs": "signaturerequestid", "hiring_sim_ai": "messageid", "interview_ask_ai": "messageid",
                  "entity_resume_inbox": "fileid", "candidate_documents": "docrowid", "entity_hiring_events": "eventid",
                  "hiring_journey": "journeyid", "hiring_sim_asks": "simaskid", "interview_asks": "askid"}
GENERIC_CONFIG_FALLBACK = "1Ky7FPu876WavnMTzsO6zejDXtI1I4b2xebuMdsBMMgg"
# Python's own facts in the runtime book: an appended row keyed by its subject, its source and the write that made it
FACT_HEADS = editions.FACT_HEADS
FACT_KEY_MATCH = editions.KEY_MATCH
FACT_RECORDED_BY = "asa-hub-app"
FACT_EVIDENCE = "asa-hub-app "
# the bulk dissolution wrote its facts as text; every later append is typed by Sheets as it lands
FACT_DISSOLUTION_BY = "dissolution"
# the relay waits HUB_APP_PACK_TIMEOUT_S (60 s) for a whole pack
PACK_BUDGET_S = float(os.getenv("HUB_APP_CANDIDATE_PACK_BUDGET_S", "40"))
NOT_GATHERED = "This part was not gathered in this pack; it is read on its own."
# why a part was left, in the pack's log, when no door said why
PAST_BUDGET = "past the pack's budget"
FACTS_HELD_MAX = 48

_WS = "[" + L._JS_WS + "]"
_A = re.A
_DOB_RE = re.compile(r"\b(DOB|D\.O\.B\.?|date of birth|birth ?date|born(?: on)?)" + _WS + r"*[:#-]?" + _WS
                     + r"*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4})",
                     re.I | _A)
_CJIS_RE = re.compile(r"\b(CJIS|BCI|FBI)(" + _WS + r"*(?:report|case|ref(?:erence)?|no\.?|number|id|#))?" + _WS
                      + r"*[:#-]?" + _WS + r"*#?" + _WS + r"*(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{4,}", re.I | _A)
_BY_PREFIX = re.compile(r"^asa-hub:(manual-screen:|manual-onboarding:)?", re.I | _A)
_MARK_CUT = re.compile("[" + L._JS_WS + ".,'’\"()_-]+")
_CAN_KEY = re.compile(r"^CAN_[A-Za-z0-9]{6,80}\Z", _A)
_FILE_ID = re.compile(r"^[A-Za-z0-9_-]{10,}\Z", _A)
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}\Z", _A)
_JS_DATE_STR = re.compile(r"^(?:[A-Z][a-z]{2},? )?([A-Z][a-z]{2}) (\d{1,2}) (\d{4}) (\d{1,2}):(\d{2}):(\d{2}) "
                          r"GMT([+-]\d{4})(?: \([^)]*\))?\Z", _A)
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_ENTERED_DAY = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\Z", _A)
_ENTERED_US = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4}|\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?\Z",
                         _A)
_ENTERED_TIME = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\Z", _A)
_SERIAL_DAY = re.compile(r"^\d{5}(?:\.\d+)?\Z", _A)
_FACTS_HELD: OrderedDict[tuple, list] = OrderedDict()
_FACTS_LOCK = threading.Lock()
_EVIDENCE_HELD: dict[str, Any] = {"key": None, "held": frozenset()}


# ---- small values ----------------------------------------------------------------------------------------------------

s_ = gsjs.str_


def text(v: Any, max_len: int = 0) -> str:
    """locationsText_."""
    return gsjs.text(v, max_len)


def _why(e: BaseException) -> str:
    return str(e)[:120]


def soft(fn: Callable[[], Any]) -> tuple[Any, str]:
    """A try/catch of the code being ported: its own failures become words; the database's are never swallowed."""
    try:
        return fn(), ""
    except (hubdb.Unreadable, Defer):
        raise
    except Exception as e:  # noqa: BLE001 - the code being ported says why in words
        return None, _why(e)


def why_of(what: str, why: str) -> str:
    """cndWhy_."""
    return f"{what} could not be read ({why})."


def unknown() -> dict[str, Any]:
    """candidateProfilesUnknown_."""
    return {"status": 404, "message": UNKNOWN}


def _cmp(fn: Callable[[Any, Any], int]) -> Callable[[Any], Any]:
    return functools.cmp_to_key(fn)


def _newest(a: dict, b: dict) -> int:
    """ssaNewest_."""
    return 1 if a["at"] < b["at"] else (-1 if a["at"] > b["at"] else 0)


def js_number(v: Any) -> float:
    """Number(v): '' and blanks are 0, words NaN."""
    if v is None:
        return math.nan
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    t = gsjs.trim(gsjs.js_str(v))
    if not t:
        return 0.0
    got = SC._js_number(t)
    return math.nan if got is None else got


def js_parse_int(v: Any) -> float:
    """parseInt(v, 10)."""
    m = re.match(r"^[+-]?\d+", gsjs.trim(gsjs.or_blank(v)))
    return float(int(m.group(0))) if m else math.nan


def js_parse_float(v: Any) -> float | None:
    """parseFloat(v); None for NaN."""
    m = re.match(r"^[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|Infinity)", gsjs.trim(gsjs.or_blank(v)))
    if not m:
        return None
    s = m.group(0)
    if s.lstrip("+-") == "Infinity":
        return -math.inf if s.startswith("-") else math.inf
    try:
        return float(s)
    except ValueError:
        return None


def js_date_ms(v: Any) -> float | None:
    """new Date(s).getTime() for the shapes the records hold; None for NaN, Apps Script's own parser for the rest."""
    s = gsjs.trim(gsjs.or_blank(v))
    if not s:
        return None
    t = gsjs.date_parse(s)
    if t is not None:
        return t
    m = _JS_DATE_STR.match(s)
    if m and m.group(1) in _MONTHS:
        off = int(m.group(7)[1:3]) * 60 + int(m.group(7)[3:5])
        try:
            at = datetime(int(m.group(3)), _MONTHS.index(m.group(1)) + 1, int(m.group(2)), int(m.group(4)),
                          int(m.group(5)), int(m.group(6)), tzinfo=timezone.utc)
        except ValueError:
            return None
        return (at.timestamp() + (off if m.group(7)[0] == "-" else -off) * 60) * 1000.0
    if _SERIAL_DAY.match(s):
        # the copy keeps a Date cell of the Etc/GMT runtime book as its serial; getValues() hands back the Date
        return float(round((float(s) - 25569.0) * 86400000.0))
    if re.match(r"^\d{4}-\d{2}-\d{2}(T[\d:.]*(Z|[+-]\d{2}:?\d{2})?)?\Z", s) or \
            re.match(r"^\d{1,2}/\d{1,2}/\d{2,4}\Z", s) or not re.search(r"\d", s):
        return None
    raise Defer("a hiring record holds a date written in a shape only Apps Script's Date parser reads")


def ny_day(ms: float) -> str:
    return datetime.fromtimestamp(ms / 1000.0, timezone.utc).astimezone(NY).strftime("%Y-%m-%d")


def iso_day(v: Any) -> str:
    """talentIsoDay_: a bare day untouched; a value with a clock resolved on New York's day."""
    if v is None:
        return ""
    s = gsjs.trim(gsjs.js_str(v))
    if not s:
        return ""
    if _ISO_DAY.match(s):
        return s
    t = js_date_ms(s)
    return "" if t is None else ny_day(t)


def now_ms(reads: L.Reads) -> float:
    return reads.now.timestamp() * 1000.0


def days_since(reads: L.Reads, iso: Any) -> int:
    """daysSince_."""
    if not iso:
        return 0
    t = js_date_ms(iso)
    if t is None:
        return 0
    return max(0, math.floor((now_ms(reads) - t) / 86400000))


def iso_ms(ms: float) -> str:
    return gsjs.iso(datetime.fromtimestamp(ms / 1000.0, timezone.utc))


def stage_of(status: Any) -> str | None:
    """talentStage_."""
    return TALENT_STAGE_MAP.get(s_(status).lower())


def stage_label(stage: Any) -> str:
    """cndStageLabel_."""
    return (CND_STAGE_LABELS.get(stage) if isinstance(stage, str) else None) or gsjs.or_text(stage)


def by_of(v: Any) -> str:
    """cndBy_: who a hiring record names, without the platform's prefix or the time it appends."""
    s = _BY_PREFIX.sub("", text(v, 200), count=1)
    return gsjs.trim(s.split(" at ")[0].split(" — ")[0])


def due_state(due: str, today: str) -> str:
    """cndDueState_."""
    if not due:
        return ""
    if due < today:
        return "overdue"
    return "today" if due == today else "upcoming"


def render(tpl: Any, var: dict[str, Any]) -> str:
    """hiringRenderMail_: known keys substituted even when empty; a typo stays visible."""
    return re.sub(r"\{(\w+)\}", lambda m: gsjs.js_str(var[m.group(1)]) if m.group(1) in var else m.group(0),
                  gsjs.or_blank(tpl))


def mark(v: Any) -> str:
    """cndMark_: a name or an e-mail as a person's mark; '' when too short to say."""
    s = gsjs.trim(_MARK_CUT.sub(" ", gsjs.or_blank(v).lower()))
    return s if len(s) >= 3 else ""


def _scrub_text(s: str) -> str:
    return _CJIS_RE.sub(r"\1\2 [withheld]", _DOB_RE.sub(r"\1 [withheld]", s))


def scrub(v: Any, key: str | None = None) -> Any:
    """cndScrub_: the SSA guard, and a date of birth or a background-check reference never leaves."""
    if key and key in CND_SCRUB_KEYS:
        return v
    if isinstance(v, str):
        return SSA.scrub(_scrub_text(v))
    if isinstance(v, list):
        return [scrub(x) for x in v]
    if isinstance(v, dict):
        return {k: scrub(v[k], k) for k in SC._js_keys(v)}
    return SSA.scrub(v)


def shown(data: Any) -> Any:
    """An answer showing a cell the copy withholds is Apps Script's to give."""
    return SC._shown(data)


def serve(what: str, get: Callable[[], Any]) -> dict[str, Any]:
    """cndServe_: 503 names the source when the build throws."""
    try:
        return {"status": 200, "data": get()}
    except (hubdb.Unreadable, Defer):
        raise
    except Exception as e:  # noqa: BLE001 - the door's own catch
        return {"status": 503, "message": f"{what} could not be read just now ({_why(e)})."}


def open_item(item: dict | None) -> bool:
    """cndOpen_."""
    return bool(item) and item.get("status") in ("pending", "missing")


# ---- the runtime's facts: the dissolved hiring tabs, with Python's own facts laid ------------------------------------

def runtime_id(reads: L.Reads) -> str:
    """hubRuntimeId_."""
    rid = gsjs.trim(reads.db.prop("HUB_APPS_RUNTIME_ID")) or gsjs.trim(reads.db.prop("HUB_HIRING_RUNTIME_ID"))
    if not rid:
        raise Defer("no runtime book is declared for the dissolved hiring tabs")
    return rid


def facts_ref(reads: L.Reads) -> tuple[str, hubdb.TabRef]:
    """The runtime book's Facts, as the copy holds them."""
    rid = runtime_id(reads)
    ref = reads.tab_of(rid, hubdb.FACTS_TAB, "the depot's Facts")
    if ref is None:
        raise hubdb.Unreadable("the runtime book's Facts are not in asa-hub-db")
    if not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table):
        raise hubdb.Unreadable("the catalog names an unusable table for the depot's Facts")
    return rid, ref


def entered_text(v: Any) -> str:
    """String() of the cell Sheets makes of appended text in the Etc/GMT runtime book; an ISO instant stays text."""
    s = gsjs.trim(gsjs.or_blank(v))
    if not s:
        return ""
    m = _ENTERED_DAY.match(s) or _ENTERED_US.match(s)
    t = _ENTERED_TIME.match(s)
    try:
        if m and m.re is _ENTERED_DAY:
            at = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4) or 0), int(m.group(5) or 0),
                          int(m.group(6) or 0), tzinfo=timezone.utc)
            return gsjs.js_str(gsjs.SheetDate(at))
        if m:
            y = int(m.group(3))
            if len(m.group(3)) == 2:
                y += 2000 if y < 30 else 1900
            hh = int(m.group(4) or 0)
            if m.group(7):
                hh = hh % 12 + (12 if m.group(7).upper() == "PM" else 0)
            at = datetime(y, int(m.group(1)), int(m.group(2)), hh, int(m.group(5) or 0), int(m.group(6) or 0),
                          tzinfo=timezone.utc)
            return gsjs.js_str(gsjs.SheetDate(at))
        if t:
            hh = int(t.group(1))
            if t.group(4):
                hh = hh % 12 + (12 if t.group(4).upper() == "PM" else 0)
            at = datetime(1899, 12, 30, hh, int(t.group(2)), int(t.group(3) or 0), tzinfo=timezone.utc)
            return gsjs.js_str(gsjs.SheetDate(at))
    except ValueError:
        return s
    return gsjs.trim(SC._js_text(s))


def _copy_facts(reads: L.Reads, ref: hubdb.TabRef, prefix: str) -> list[tuple[str, str, str]]:
    """(subject, value, source) of the copy's facts under `prefix`, in sheet order, each as Apps Script reads it."""
    key = (ref.table, str(ref.loaded_at), prefix)
    with _FACTS_LOCK:
        held = _FACTS_HELD.get(key)
        if held is not None:
            _FACTS_HELD.move_to_end(key)
            return held
    got = reads.db.query(f'select row_number, subject_id, value, source, recorded_by from {reads.db.from_sql(ref)}'  # noqa: S608
                         " where left(source, %s) = %s order by row_number", (len(prefix), prefix))
    direct = SC._direct(reads, ref.sheet_id)

    def value(val: Any, by: Any) -> str:
        if direct:
            return gsjs.trim(SC._js_text(val, True))
        if gsjs.trim(gsjs.or_blank(by)) == FACT_DISSOLUTION_BY:
            return gsjs.trim(gsjs.or_blank(val))
        return entered_text(val)

    out = [(gsjs.trim(gsjs.or_blank(sub)), value(val, by), gsjs.trim(gsjs.or_blank(src)))
           for _rn, sub, val, src, by in got]
    with _FACTS_LOCK:
        _FACTS_HELD[key] = out
        while len(_FACTS_HELD) > FACTS_HELD_MAX:
            _FACTS_HELD.popitem(last=False)
    return out


def _evidence_held(reads: L.Reads, ref: hubdb.TabRef, wanted: set[str]) -> frozenset[str]:
    """The writes (their evidence) the Facts copy already holds: there, the copy's own order decides."""
    if not wanted:
        return frozenset()
    key = (ref.table, str(ref.loaded_at), frozenset(wanted))
    if _EVIDENCE_HELD["key"] == key:
        return _EVIDENCE_HELD["held"]
    got = reads.db.query(f'select distinct evidence from {reads.db.from_sql(ref)}'  # noqa: S608
                         " where evidence = any(%s)", (sorted(wanted),))
    held = frozenset(str(r[0] or "") for r in got)
    _EVIDENCE_HELD.update(key=key, held=held)
    return held


def _pending_facts(reads: L.Reads, rid: str, ref: hubdb.TabRef, prefix: str) -> list[tuple[str, str, str]]:
    """Python's own facts (app.edits) whose source starts with `prefix`, the copy does not hold yet, oldest first."""
    groups = (getattr(hubdb.OWN.get(), "edits", None) or {}).get((rid, ref.tab)) or ()
    mine: list[tuple[str, str, str, str]] = []
    for g in groups:
        if not g.get("appended") or g.get("match") != FACT_KEY_MATCH:
            continue
        cells = {f: v for f, (_id, v, _born) in g["cells"].items()}
        src = gsjs.trim(gsjs.or_blank(cells.get("Source")))
        sub = gsjs.trim(gsjs.or_blank(cells.get("Subject ID")))
        ev = gsjs.trim(gsjs.or_blank(cells.get("Evidence")))
        if not src.startswith(prefix) or not sub or not ev:
            continue
        mine.append((sub, entered_text(cells.get("Value")), src, ev))
    if not mine:
        return []
    held = _evidence_held(reads, ref, {ev for *_r, ev in mine})
    return [(sub, val, src) for sub, val, src, ev in mine if ev not in held]


def facts(reads: L.Reads, prefix: str) -> list[tuple[str, str, str]]:
    """hiringBookTab_(runtime, Facts) narrowed to a source prefix, Python's own facts after the copy's."""
    def read() -> list[tuple[str, str, str]]:
        rid, ref = facts_ref(reads)
        return _copy_facts(reads, ref, prefix) + _pending_facts(reads, rid, ref, prefix)
    return reads.once("cnd_facts:" + prefix, read)


def legacy_rows(reads: L.Reads, tab: str) -> list[dict] | None:
    """hiringLegacyRows_: a dissolved tab rebuilt from the runtime's facts (normalised keys, text); None for none."""
    def read() -> list[dict] | None:
        want = "dissolution:" + tab + "."
        by: dict[str, dict] = {}
        for sub, val, src in facts(reads, want):
            if not src.startswith(want) or not sub:
                continue
            by.setdefault(sub, {})[src[len(want):]] = val
        if not by:
            return None
        key_col = HIRING_TAB_KEY.get(tab, "candidateid")
        rows = []
        for sub, row in by.items():
            if gsjs.or_text(row.get("__deleted")).lower() == "true":
                continue
            if not row.get(key_col):
                row[key_col] = sub
            rows.append(row)
        return rows
    return reads.once("cnd_legacy:" + tab, read)


def legacy_header(reads: L.Reads, tab: str) -> list[str] | None:
    """hiringLegacyHeader_."""
    return SC._legacy_header(reads, tab)


def dissolved(reads: L.Reads, tab: str) -> bool:
    return reads.db.dissolved(tab)


def read_tab(reads: L.Reads, tab: str) -> list[dict]:
    """readTabNormalized_(HUB_DB, tab): a dissolved tab's facts, else the tab where the router keeps it."""
    def read() -> list[dict]:
        if dissolved(reads, tab):
            rows = legacy_rows(reads, tab)
            if rows is not None:
                return rows
            hub = reads.db.prop("HUB_DB_ID")
            ref = reads.tab_of(hub, tab, "HUB_DB") if hub else None
            if ref is None:
                raise RuntimeError("Talent tab missing: " + tab)
            return SC._normalized(reads, ref, True)
        if HT.tabled(tab):
            return SC._normalized_rows(*HT.raw(reads, tab), True)
        res = reads.db.resolve(tab)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
            raise RuntimeError("Talent tab missing: " + tab)
        return SC._normalized(reads, res.ref, True)
    return reads.once("cnd_tab:" + tab, read)


def status_rows(reads: L.Reads) -> list[dict]:
    """log_status_history as readTabNormalized_ hands it: its own table once kept there, else the tab; [] while
    unborn."""
    if HT.tabled(CND_STATUS_TAB):
        return SC._normalized_rows(*HT.raw(reads, CND_STATUS_TAB), True)
    ref = hub_tab(reads, CND_STATUS_TAB)
    return SC._normalized(reads, ref, True) if ref is not None else []


def hub_tab(reads: L.Reads, tab: str) -> hubdb.TabRef | None:
    """hubTabSheet_ for a tab that is not dissolved: None while it is unborn."""
    res = reads.db.resolve(tab)
    if res.runtime:
        raise Defer(f"{tab} lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
    return res.ref


def shim(reads: L.Reads, tab: str, ensure: tuple[str, ...] = ()) -> tuple[list[str], list[list[str]]]:
    """runtimeSheetFor_(tab).getDataRange().getValues(): the header (ensureHeader_ widened by `ensure`) and the grid."""
    def read() -> tuple[list[str], list[list[str]]]:
        rows = legacy_rows(reads, tab) or []
        header: list[str] = []
        seen: set[str] = set()
        for h in legacy_header(reads, tab) or []:
            k = hubdb.norm_key(h)
            if k and k not in seen:
                seen.add(k)
                header.append(gsjs.js_str(h))
        if not header:
            seen.add("candidateid")
            header.append("candidateid")
        for r in rows:
            for k in r:
                if k not in seen:
                    seen.add(k)
                    header.append(k)
        grid = [[gsjs.js_str(r[hubdb.norm_key(h)]) if hubdb.norm_key(h) in r else "" for h in header] for r in rows]
        return header, grid
    header, grid = reads.once("cnd_shim:" + tab, read)
    missing = [k for k in ensure if k not in header]
    wide = header + missing
    return wide, [line + [""] * len(missing) for line in grid]


def shim_rows(reads: L.Reads, tab: str) -> list[dict]:
    """locationsTabRows_(runtimeSheetFor_(tab)): keyed by the trimmed raw header, every cell trimmed text."""
    def read() -> list[dict]:
        header, grid = shim(reads, tab)
        head = [gsjs.trim(h) for h in header]
        out = []
        for r, line in enumerate(grid, start=1):
            o: dict[str, Any] = {"_row": r + 1}
            empty = True
            for c, h in enumerate(head):
                if not h:
                    continue
                v = gsjs.trim(line[c]) if c < len(line) else ""
                if v:
                    empty = False
                o[h] = v
            if not empty:
                out.append(o)
        return out
    return reads.once("cnd_shim_rows:" + tab, read)


def tab_rows(reads: L.Reads, tab: str) -> list[dict]:
    """locationsTabRows_(hubTabSheet_(tab)): the shim of a dissolved tab, else the tab itself; [] while unborn."""
    if dissolved(reads, tab):
        return shim_rows(reads, tab)
    return reads.db.locations_rows(hub_tab(reads, tab))


# ---- the books the Hiring app reads its words and rules from --------------------------------------------------------

def _book_rows(reads: L.Reads, sid: str, tab: str) -> tuple[list[str], list[list[Any]]] | None:
    """A tab's header (trimmed) and rows (each cell as getValues() hands it back); None when the copy has no such tab."""
    ref = HT.book_tab(reads, sid, tab)
    reads.db.note_book(sid)
    if ref is None:
        if reads.db.book(sid) is None:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
        return None
    direct = SC._direct(reads, sid)
    heads = [gsjs.trim(gsjs.js_str(h)) for h in ref.headers]
    rows = [[SC._typed(raw.get(h), direct) for h in ref.headers] for _rn, raw in reads.db.rows(ref)]
    return heads, rows


def book_kv(reads: L.Reads, tab: str) -> dict[str, str]:
    """bookKv_: one text tab of the words book, key → value."""
    def read() -> dict[str, str]:
        sid = gsjs.trim(reads.db.prop("HUB_WORDS_BOOK_ID")) or gsjs.trim(reads.db.prop("HUB_GENERIC_CONFIG_ID")) \
            or GENERIC_CONFIG_FALLBACK
        got = _book_rows(reads, sid, tab)
        if got is None or "key" not in got[0] or "value" not in got[0]:
            raise Defer(f"the words book's {tab} tab is not in the copy; Apps Script reads its compiled floor")
        heads, rows = got
        i_key, i_val = heads.index("key"), heads.index("value")
        out: dict[str, str] = {}
        for line in rows:
            k = gsjs.trim(gsjs.or_text(line[i_key]))
            if k and not k.startswith("#"):
                out[k] = gsjs.or_blank(line[i_val])
        if not out:
            raise Defer(f"the words book's {tab} tab is empty; Apps Script reads its compiled floor")
        return out
    return reads.once("cnd_kv:" + tab, read)


def book_text(reads: L.Reads, tab: str, key: str, floor: str = "") -> str:
    """bookText_."""
    v = book_kv(reads, tab).get(key)
    return v if v is not None and v != "" else floor


def cp_word(reads: L.Reads, key: str) -> str:
    return book_text(reads, "Strings", "checkpoint." + key)


def cp_owner(reads: L.Reads, key: str) -> str:
    return book_text(reads, "Strings", "owner." + key)


def registry(reads: L.Reads) -> dict[str, dict[str, str]]:
    """hiringRegistry_: context → {id, status} from every runtime's Registry tab, ours first."""
    def read() -> dict[str, dict[str, str]]:
        ids: list[str] = []
        for k in ("HUB_APPS_RUNTIME_ID", "HUB_HIRING_RUNTIME_ID"):
            v = gsjs.trim(reads.db.prop(k))
            if v and v not in ids:
                ids.append(v)
        out: dict[str, dict[str, str]] = {}
        read_n = 0
        for rid in ids:
            got = _book_rows(reads, rid, "Registry")
            if got is None:
                continue
            heads, rows = got
            if "Context" not in heads or "Spreadsheet ID" not in heads or "Status" not in heads:
                continue
            read_n += 1
            i_ctx, i_id, i_st = heads.index("Context"), heads.index("Spreadsheet ID"), heads.index("Status")
            for line in rows:
                ctx = gsjs.trim(gsjs.or_text(line[i_ctx])).lower()
                if not ctx or ctx.startswith("#") or ctx in out:
                    continue
                out[ctx] = {"id": gsjs.trim(gsjs.or_text(line[i_id])), "status": gsjs.trim(gsjs.or_text(line[i_st])).lower()}
        if not read_n:
            raise Defer("no runtime's Registry tab is in the copy; Apps Script reads its compiled shadow")
        return out
    return reads.once("cnd_registry", read)


def matrix_tab(reads: L.Reads, context: str, tab: str) -> list[dict[str, str]]:
    """hiringMatrixTab_: one module book tab as rows of String() cells; [] whenever it cannot answer."""
    def read() -> list[dict[str, str]]:
        mode = registry(reads).get(context) or {"id": "", "status": ""}
        if not mode["id"] or mode["status"] not in ("on", "shadow"):
            return []
        got = _book_rows(reads, mode["id"], tab)
        if got is None:
            return []
        heads, rows = got
        out = []
        for line in rows:
            row: dict[str, str] = {}
            anyv = False
            for j, h in enumerate(heads):
                if not h:
                    continue
                v = gsjs.or_blank(line[j]) if j < len(line) else ""
                if v:
                    anyv = True
                row[h] = v
            if anyv:
                out.append(row)
        return out
    return reads.once(f"cnd_matrix:{context}:{tab}", read)


# ---- the Hiring app's own readers --------------------------------------------------------------------------------------

def raw_rows(reads: L.Reads) -> list[dict]:
    """cndRawRows_: every candidate row the Hiring app keeps, archived ones too."""
    return read_tab(reads, TALENT_CANDIDATES_TAB)


def evidence(reads: L.Reads, cid: str) -> dict[str, Any]:
    """hubEvidence_: the latest candidate, resume analysis and phone screen rows."""
    def read() -> dict[str, Any]:
        cand = analysis = screen = None
        for c in read_tab(reads, TALENT_CANDIDATES_TAB):
            if s_(c.get("candidateid")) == cid:
                cand = c
        for a in read_tab(reads, TALENT_RESUME_TAB):
            if s_(a.get("candidateid")) == cid:
                analysis = a
        for s in read_tab(reads, TALENT_PHONE_TAB):
            if s_(s.get("candidateid")) == cid:
                screen = s
        return {"cand": cand, "analysis": analysis or {}, "screen": screen}
    return reads.once("cnd_ev:" + cid, read)


def cjis_cleared(a: dict | None) -> bool:
    """hubCjisCleared_."""
    st = s_((a or {}).get("cjisstatus")).lower()
    return st in ("clear", "verified") and bool(s_((a or {}).get("cjisreporturl")))


def interview_for(reads: L.Reads, cid: Any) -> dict | None:
    """interviewFor_: the candidate's interview row (last wins)."""
    def read() -> dict[str, dict]:
        by: dict[str, dict] = {}
        for r in read_tab(reads, HUB_INTERVIEWS_TAB):
            by[s_(r.get("candidateid"))] = r
        return by
    return reads.once("cnd_iv_index", read).get(s_(cid))


def interview_scored(iv: dict | None) -> bool:
    """interviewScored_."""
    return bool(iv) and bool(s_(iv.get("interviewername"))) and s_(iv.get("score")) != ""


def onboarding_row(reads: L.Reads, cid: str) -> dict | None:
    """onboardingRowFor_."""
    hit = None
    for r in read_tab(reads, ONBOARDING_TAB):
        if s_(r.get("candidateid")) == cid:
            hit = r
    return hit


def packet_truthy(v: Any) -> bool:
    """packetTruthy_."""
    return gsjs.trim(gsjs.or_blank(v)).lower() in ("true", "yes", "y", "1")


def packet_find_row(reads: L.Reads, email: Any, cid: Any, include_finished: bool) -> dict | None:
    """packetFindRow_: this person's onboarding packet row by e-mail, then by id; a finished row is an archive."""
    hdr_raw, values = shim(reads, PACKET_TAB, PACKET_OWN_COLUMNS)
    hdr = [gsjs.trim(h) for h in hdr_raw]
    mail = gsjs.trim(gsjs.or_blank(email)).lower()
    cand = gsjs.trim(gsjs.or_blank(cid))

    def at(name: str) -> int:
        return hdr.index(name) if name in hdr else -1

    cols = [[at("CandidateEmail"), mail, True], [at("HubEmail"), mail, True], [at("CandidateId"), cand, False],
            [at("HubCandidateId"), cand, False], [at("GradCandidateId"), cand, False]]
    if re.fullmatch(r"asatech[0-9]*@asalifecare\.com", mail, _A) or re.fullmatch(r"asa-hub[0-9]*@asaop\.org", mail, _A) \
            or mail == "silvajhonatanbrito@gmail.com":
        cols[0][1] = ""
        cols[1][1] = ""
    i_done = at("CompletedAt")
    for line in values:
        if not include_finished and i_done != -1 and gsjs.trim(line[i_done]):
            continue
        for i, want, lower in cols:
            if i == -1 or not want:
                continue
            cell = gsjs.trim(line[i])
            if lower:
                cell = cell.lower()
            if cell == want:
                return {"hdr": hdr, "values": line}
    return None


def ob_field(found: dict | None, name: str) -> str:
    """obField_."""
    if not found or name not in found["hdr"]:
        return ""
    i = found["hdr"].index(name)
    return gsjs.trim(found["values"][i]) if i < len(found["values"]) else ""


def onboarding_done(reads: L.Reads, cand: dict | None) -> dict[str, Any]:
    """hubOnboardingDone_: the portal's two flags, or a manual attestation; an unreadable tab opens."""
    if s_((cand or {}).get("manualonboarding")).lower() == "true":
        return {"ok": True, "how": "manual", "q": True, "t": True}
    got, why = soft(lambda: packet_find_row(reads, s_((cand or {}).get("email")), s_((cand or {}).get("candidateid")),
                                            True))
    if why:
        return {"ok": True, "how": "unreadable", "unreadable": True}
    if not got:
        return {"ok": False, "how": "", "q": False, "t": False}
    q = packet_truthy(ob_field(got, "QuestionnaireComplete"))
    t = packet_truthy(ob_field(got, "TutorialsComplete"))
    return {"ok": q and t, "how": "portal" if q and t else "", "q": q, "t": t}


def packet_rows(reads: L.Reads) -> list[dict]:
    """packetMirrorRows_: every Dropbox Sign envelope; [] when unreadable."""
    rows, _why_p = soft(lambda: read_tab(reads, RECRUIT_TAB))
    return rows or []


def packet_match(reads: L.Reads, cand: dict, rows: list[dict]) -> dict[str, Any]:
    """packetMatch_: which envelope a card owns — e-mail first, then a signed one by phone."""
    email_keys = {k: True for k in SC._email_keys(s_(cand.get("email"))) if not SC._test_email(reads, k)}
    phone_key = SC._digits10(s_(cand.get("phone")))
    if phone_key in SHARED_LINE_DIGITS:
        phone_key = ""
    hits = []
    for r in rows:
        by = ""
        if email_keys:
            addrs = [s_(r.get("email"))] + gsjs.or_text(r.get("signeremails")).split("|")
            for addr in addrs:
                if by:
                    break
                for k in SC._email_keys(addr):
                    if email_keys.get(k):
                        by = "email"
        if not by and phone_key and SC._digits10(r.get("phone")) == phone_key and \
                gsjs.or_text(r.get("status")).lower() == "signed":
            by = "phone"
        if by:
            hits.append({"row": r, "by": by})
    if not hits:
        return {"state": "unknown", "srid": "", "by": "", "signed": ""}
    if len(hits) > 1:
        rank = {"signed": 3, "pending": 2, "declined": 1}
        hits.sort(key=_cmp(lambda x, y: (rank.get(gsjs.or_text(y["row"].get("status")).lower(), 0)
                                         - rank.get(gsjs.or_text(x["row"].get("status")).lower(), 0))
                           or gsjs.locale_cmp(gsjs.or_text(y["row"].get("applied")),
                                              gsjs.or_text(x["row"].get("applied")))))
    best = hits[0]
    status = gsjs.or_text(best["row"].get("status")).lower()
    return {"state": "signed" if status == "signed" else "unsigned", "srid": s_(best["row"].get("signaturerequestid")),
            "by": best["by"], "signed": s_(best["row"].get("signed"))}


def packet_settled_signed(cand: dict, rows: list[dict] | None) -> str:
    """packetSettledSigned_."""
    stored = s_(cand.get("packetsignedat"))
    if stored:
        return stored
    srid = s_(cand.get("packetsrid"))
    if not srid or rows is None:
        return ""
    day = ""
    for r in rows:
        if not day and s_(r.get("signaturerequestid")) == srid:
            day = s_(r.get("signed"))
    return day


def packet_state(reads: L.Reads, cand: dict | None, rows: list[dict] | None = None) -> dict[str, Any]:
    """packetState_: a hand-attached packet, a frozen signed envelope, else the match."""
    if not cand:
        return {"state": "unknown", "srid": "", "by": "", "signed": "", "reason": "no candidate row"}
    waived = s_(cand.get("packetwaivedby"))
    if waived:
        return {"state": "waived", "srid": s_(cand.get("packetsrid")), "by": "manual", "waived_by": waived,
                "signed": packet_settled_signed(cand, rows)}
    frozen, known = s_(cand.get("packetsrid")), s_(cand.get("packetstatus"))
    if frozen and known == "signed":
        return {"state": "signed", "srid": frozen, "by": s_(cand.get("packetmatchedby")) or "frozen",
                "signed": packet_settled_signed(cand, rows)}
    return packet_match(reads, cand, rows if rows is not None else packet_rows(reads))


def application_for(cand: dict | None, rows: list[dict], already: dict | None, reads: L.Reads) -> dict | None:
    """applicationFor_: the application envelope the card signed, through the match already made."""
    if not cand or not rows:
        return None
    srid = s_((already or {}).get("srid"))
    if not srid:
        srid = s_(packet_match(reads, cand, rows).get("srid"))
    hit = next((r for r in rows if s_(r.get("signaturerequestid")) == srid), None) if srid else None
    if not hit:
        return None
    return {"srid": s_(hit.get("signaturerequestid")), "title": s_(hit.get("title")), "status": s_(hit.get("status")),
            "appliedAt": iso_day(hit.get("applied")), "signedAt": iso_day(hit.get("signed"))}


def packet_hold(reads: L.Reads, cand: dict | None) -> dict | None:
    """packetHold_: onboarding done, packet missing — amber from the first moment."""
    until_raw = s_((cand or {}).get("packetholduntil"))
    if not until_raw:
        return None
    until = js_date_ms(until_raw)
    if until is None:
        return None
    return {"since": s_((cand or {}).get("packetholdsince")), "until": until_raw, "phase": "overdue",
            "escalate": now_ms(reads) >= until}


def packet_chip(state: str) -> dict[str, str]:
    """packetChip_."""
    return {"state": state, "label": PACKET_CHIP.get(state) or PACKET_CHIP["unknown"]}


def becoming_staff_done(reads: L.Reads, c: dict) -> dict[str, Any]:
    """hubBecomingStaffDone_: the account, its password, and the Employee Database."""
    missing: list[str] = []
    uid = s_(c.get("staffuserid"))
    armed = False
    if not uid and s_(c.get("graduationheld")):
        missing.append("staff account held: " + s_(c.get("graduationheld")))
    elif not uid:
        missing.append("staff account not created yet")
    else:
        def read() -> bool:
            u = next((x for x in reads.users() if s_(x.get("userid")) == uid), None)
            return bool(u and s_(u.get("passhash")))
        got, why = soft(read)
        if why:
            missing.append("could not read the users tab to check the password")
        else:
            armed = bool(got)
        if not armed and not missing:
            missing.append("no password set — they cannot sign in")
    id_at, id_note = s_(c.get("internaldocsat")), s_(c.get("internaldocsnote")).lower()
    if not id_at:
        missing.append("ASA Employee Database not written yet")
    elif id_note.startswith("not filled"):
        missing.append("ASA Employee Database: " + s_(c.get("internaldocsnote"))[:90])
    return {"done": not missing, "missing": missing}


def card_urgency(reads: L.Reads, cand: dict | None) -> dict[str, str]:
    """hubCardUrgency_: none, amber or red, and why."""
    if not cand:
        return {"level": "none", "why": "", "source": ""}
    out = {"level": "none", "why": "", "source": ""}
    hold, _w = soft(lambda: packet_hold(reads, cand))
    if hold:
        out = {"level": "amber", "source": "packet-hold",
               "why": "onboarding finished and the signed New Hire packet is not on file"}
    if stage_of(cand.get("status")) == "hired":
        done, _w2 = soft(lambda: becoming_staff_done(reads, cand))
        if done and done["done"] is False and done["missing"]:
            out = {"level": "amber", "source": "arrival", "why": "still at the last step owing: " + "; ".join(done["missing"])}
    granted = s_(cand.get("onboardingaccessuntil"))
    if granted:
        g = js_date_ms(granted)
        if g is not None and now_ms(reads) > g:
            return {"level": "red", "source": "onboarding-extension",
                    "why": "their onboarding was extended to " + granted[:10] + " and that has now passed"}
    if stage_of(cand.get("status")) == "interview":
        def read() -> dict | None:
            iv = interview_for(reads, s_(cand.get("candidateid")))
            au = s_(iv.get("accessuntil")) if iv else ""
            if au:
                a = js_date_ms(au)
                if a is not None and now_ms(reads) > a:
                    return {"level": "red", "source": "interview-extension",
                            "why": "their interview access was extended to " + au[:10] + " and that has now passed"}
            return None
        red, _w3 = soft(read)
        if red:
            return red
    return out


def cfg_int(reads: L.Reads, key: str, fallback: Any, lo: int | None = None, hi: int | None = None) -> Any:
    """hubCfgInt_."""
    got, why = soft(lambda: reads.config().get(key))
    if why:
        return fallback
    s = gsjs.trim(gsjs.or_blank(got))
    if not s:
        return fallback
    n = js_parse_int(s)
    if math.isnan(n):
        return fallback
    if lo is not None and n < lo:
        return fallback
    if hi is not None and n > hi:
        return fallback
    return int(n)


def _zone_of(reads: L.Reads) -> Any:
    """hiringTimeZone_."""
    got, _w = soft(lambda: s_(reads.config().get("hiring_timezone")))
    z = gsjs.zone(got) if got else None
    return z or NY


def _day_edge(reads: L.Reads, local: datetime, end: bool) -> float:
    """hubTzDayEdge_: the day `local` falls on in the company's zone, at that instant's offset; milliseconds."""
    tz = _zone_of(reads)
    at = local.astimezone(tz)
    off = at.utcoffset() or timedelta(0)
    edge = datetime(at.year, at.month, at.day, 23 if end else 0, 59 if end else 0, 59 if end else 0,
                    999000 if end else 0, tzinfo=timezone(off))
    return edge.timestamp() * 1000.0


def _shift_days(ms: float, days: int) -> datetime:
    """new Date(ms) then setDate(getDate() + days) on the script's clock (America/New_York)."""
    local = datetime.fromtimestamp(ms / 1000.0, timezone.utc).astimezone(NY)
    naive = local.replace(tzinfo=None) + timedelta(days=days)
    return naive.replace(tzinfo=NY)


def onboarding_window(reads: L.Reads, cand: dict | None) -> dict[str, Any]:
    """obOnboardingWindow_: the extension wins; else the onboarding or interview day with its window."""
    if not cand:
        return {"open": True, "reason": "no card", "anchored_on": ""}
    now = now_ms(reads)
    granted = s_(cand.get("onboardingaccessuntil"))
    if granted:
        g = js_date_ms(granted)
        if g is not None:
            open_g = now <= g
            return {"open": open_g, "from": "", "until": iso_ms(g), "anchored_on": "extension",
                    "reason": "" if open_g else "the extension ran out on " + granted[:10]}
    sched = s_(cand.get("onboardingscheduledfor"))
    anchor = "onboarding date" if sched else ""
    if not sched:
        iv, _w = soft(lambda: interview_for(reads, s_(cand.get("candidateid"))))
        sched = s_(iv.get("scheduledfor")) if iv else ""
        if sched:
            anchor = "the in-person visit"
    if not sched:
        return {"open": True, "reason": "no onboarding date to anchor to", "anchored_on": ""}
    d = js_date_ms(sched)
    if d is None:
        return {"open": True, "reason": "the onboarding date could not be read", "anchored_on": ""}
    before = cfg_int(reads, "onboarding_window_before_days", None, 0, 365)
    after = cfg_int(reads, "onboarding_window_after_days", None, 0, 365)
    before = OB_WINDOW_BEFORE_DEFAULT if before is None else before
    after = OB_WINDOW_AFTER_DEFAULT if after is None else after
    frm = _day_edge(reads, _shift_days(d, -before), False)
    until = _day_edge(reads, _shift_days(d, after), True)
    open_w = frm <= now <= until
    return {"open": open_w, "from": iso_ms(frm), "until": iso_ms(until), "anchored_on": anchor,
            "reason": "" if open_w else ("your onboarding opens on " + iso_ms(frm)[:10] if now < frm
                                         else "your onboarding closed on " + iso_ms(until)[:10]
                                         + " — ask the hiring team to extend it and you can carry on")}


def opt_out_index(reads: L.Reads) -> dict[str, Any]:
    """optOutIndex_: target key → its stop; an unreadable list says so and suppresses nobody here."""
    def read() -> dict[str, Any]:
        def rows() -> list[dict]:
            # the list's owner: Postgres once the opt-outs are kept there, else the tab where the router keeps it
            import opt_outs  # noqa: PLC0415 - it reads through this module's neighbours
            return opt_outs.opt_out_rows(reads)
        got, why = soft(rows)
        if why:
            return {"by": {}, "error": "The opt-out list could not be read: " + why}
        by: dict[str, dict] = {}
        for r in got or []:
            key = s_(r.get("targetkey")) or _opt_out_key(r.get("target"))
            if not key:
                continue
            if s_(r.get("releasedat")):
                by.pop(key, None)
                continue
            by[key] = {"target": s_(r.get("target")), "source": s_(r.get("source")), "at": s_(r.get("at")),
                       "scope": s_(r.get("scope"))}
        return {"by": by, "error": ""}
    return reads.once("cnd_optouts", read)


def _opt_out_key(target: Any) -> str:
    """optOutKey_."""
    s = gsjs.trim(gsjs.or_text(target))
    if not s:
        return ""
    if "@" in s:
        return s.lower()
    d = re.sub(r"\D", "", s, flags=_A)
    return d[-10:] if len(d) >= 10 else ""


def opted_out(reads: L.Reads, target: Any) -> str:
    """optOutIsSuppressed_ inside a Staff Candidates action, whose file names no conversation scope."""
    key = _opt_out_key(target)
    if not key:
        return ""
    idx = opt_out_index(reads)
    if idx["error"]:
        return ""
    hit = idx["by"].get(key)
    if not hit:
        return ""
    return "Asked us to stop" + (" on " + hit["at"][:10] if hit["at"] else "") + "."


def journey_steps(reads: L.Reads) -> dict[str, str]:
    """hiringJourneySteps_: each step's words from the book's Steps tab."""
    return {k[len("journey."):]: gsjs.or_text(v) for k, v in book_kv(reads, "Steps").items() if k.startswith("journey.")}


def journey_for(reads: L.Reads, cid: str) -> list[dict] | None:
    """journeyFor_: the candidate's hiring journey, oldest first, the last 400; None when it cannot be read."""
    def read() -> list[dict]:
        out = []
        steps: dict[str, str] | None = None
        for r in read_tab(reads, HIRING_JOURNEY_TAB):
            if cid and s_(r.get("candidateid")) != s_(cid):
                continue
            title = s_(r.get("title"))
            if not title:
                if steps is None:
                    steps = journey_steps(reads)
                title = steps.get(s_(r.get("step"))) or s_(r.get("step"))
            out.append({"id": s_(r.get("journeyid")), "candidate_id": s_(r.get("candidateid")),
                        "name": s_(r.get("candidatename")), "step": s_(r.get("step")), "title": title,
                        "channel": s_(r.get("channel")), "to": s_(r.get("to")),
                        "ok": s_(r.get("ok")).lower() != "no", "detail": s_(r.get("detail")), "ref": s_(r.get("ref")),
                        "rehearsal": s_(r.get("rehearsal")).lower() == "yes", "at": s_(r.get("at")),
                        "by": s_(r.get("by"))})
        out.sort(key=_cmp(lambda a, b: -1 if a["at"] < b["at"] else (1 if a["at"] > b["at"] else 0)))
        return out[-HIRING_JOURNEY_MAX:]
    got, why = soft(read)
    return None if why else got


def ask_rows(reads: L.Reads) -> list[dict]:
    """interviewAskRows_: soft — no tab is no asks."""
    got, _w = soft(lambda: read_tab(reads, INTERVIEW_ASKS_TAB))
    return got or []


def sim_ask_rows(reads: L.Reads) -> list[dict]:
    """simAskRows_."""
    got, _w = soft(lambda: read_tab(reads, HIRING_SIM_ASKS_TAB))
    return got or []


# ---- the gate and its book ---------------------------------------------------------------------------------------------

def gate_code(reads: L.Reads, ev: dict, stage: str | None) -> dict[str, Any]:
    """hubGateCode_: the transition rules as the code states them."""
    if not ev.get("cand"):
        return {"from": None, "to": None, "ok": False, "reasons": ["candidate not found"]}
    a = ev.get("analysis") or {}
    cand = ev["cand"]
    if stage == "new":
        reasons = [] if s_(a.get("decisionstatus")).lower() == "advance" else ["resume decision Advance"]
        return {"from": "new", "to": "phone-screen", "ok": not reasons, "reasons": reasons}
    if stage == "phone-screen":
        s = ev.get("screen") or {}
        r2 = []
        if s_(s.get("screenstatus")).lower() != "completed":
            r2.append("screen Completed")
        if s_(s.get("finalresult")).lower() != "advance":
            r2.append("advance decision Advance")
        return {"from": "phone-screen", "to": "interview", "ok": not r2, "reasons": r2}
    if stage == "interview":
        iv = interview_for(reads, s_(cand.get("candidateid")))
        r3 = []
        if not interview_scored(iv):
            r3.append("interview scorecard (score + comments)")
        elif s_(iv.get("recommendation")).lower() != "advance":
            r3.append('interviewer recommendation Advance — it reads "' + s_(iv.get("recommendation")) + '"')
        return {"from": "interview", "to": "onboarding", "ok": not r3, "reasons": r3}
    if stage == "onboarding":
        ob = onboarding_done(reads, cand)
        lack = []
        if not ob.get("q"):
            lack.append("the New Hire Questionnaire")
        if not ob.get("t"):
            lack.append("the New Hire Tutorials")
        return {"from": "onboarding", "to": "hired", "ok": False, "reasons": [
            'Onboarding is completed with the "Manual onboarding" button on the card, never by dragging — the button '
            "records who says it was done and when, and a drag records nothing"
            + (". Still outstanding on the portal: " + " and ".join(lack) if lack else "")]}
    if stage == "hired":
        g5: list[str] = []
        if not s_(cand.get("hiredcompleteat")):
            g5.append("the graduation has not finished (hired_complete_at is empty)")
        else:
            gs = becoming_staff_done(reads, cand)
            if not gs["done"]:
                g5 = g5 + (gs["missing"] or ["graduation checklist open"])
        return {"from": "hired", "to": "ready", "ok": not g5, "reasons": g5}
    if stage == "ready":
        return {"from": "ready", "to": "working", "ok": False, "reasons": [
            "a schedule on the Shift Board — the watch releases them from Ready to Start by itself the moment they "
            "appear there"]}
    idx = TALENT_STAGE_ORDER.index(stage) if stage in TALENT_STAGE_ORDER else -1
    nxt = TALENT_STAGE_ORDER[idx + 1] if 0 <= idx < len(TALENT_STAGE_ORDER) - 1 else None
    return {"from": stage, "to": nxt, "ok": bool(nxt), "reasons": [] if nxt else ["final stage"]}


def _id_list(cell: Any) -> list[str]:
    """hiringIdList_."""
    s = s_(cell)
    if not s:
        return []
    try:
        arr = json.loads(s)
        if isinstance(arr, list):
            return [gsjs.js_str(x) if x is not None else "null" for x in arr]
    except ValueError:
        pass
    return [s]


def cell_truthy(raw: Any) -> bool:
    """hiringCellTruthy_."""
    s = gsjs.trim(gsjs.or_blank(raw))
    return s != "" and not re.fullmatch(r"false|no|0", s, re.I | _A)


def _fact_value(raw: Any, typ: str) -> Any:
    """hiringFactValue_."""
    s = gsjs.or_blank(raw)
    if typ == "boolean":
        return cell_truthy(s)
    if typ == "number":
        n = js_number(s)
        return n if math.isfinite(n) else s
    return s


def _evidence_holder(reads: L.Reads, tab: str, ev: dict) -> dict | None:
    """HIRING_EVIDENCE_TABS."""
    if tab == "entity_candidates":
        return ev.get("cand")
    if tab == "entity_resume_analyses":
        return ev.get("analysis")
    if tab in ("entity_phone_screens", "entity_screens"):
        return ev.get("screen")
    if tab == "recruitment_contracts":
        return ev.get("app")
    if tab in ("entity_interviews", "entity_in_person_interviews"):
        return _evidence_interview(reads, ev)
    return None


_KNOWN_TABS = ("entity_candidates", "entity_resume_analyses", "entity_phone_screens", "entity_screens",
               "recruitment_contracts", "entity_interviews", "entity_in_person_interviews")


def _evidence_interview(reads: L.Reads, ev: dict) -> dict:
    """hiringEvidenceInterview_."""
    if not ev.get("__iv"):
        got, why = soft(lambda: interview_for(reads, s_((ev.get("cand") or {}).get("candidateid"))) or {})
        ev["__iv"] = {} if why else got
    return ev["__iv"]


def _evidence_cell(reads: L.Reads, source: Any, ev: dict) -> tuple[bool, Any]:
    """hiringEvidenceCell_."""
    src = s_(source)
    dot = src.find(".")
    if dot == -1 or src[:dot] not in _KNOWN_TABS:
        return False, None
    holder = _evidence_holder(reads, src[:dot], ev)
    if not holder:
        return False, None
    col = re.sub(r"[^A-Za-z0-9]+", "", src[dot + 1:]).lower()
    if col not in holder:
        return False, None
    return True, holder[col]


def _fact_from_row(reads: L.Reads, row: dict, ev: dict) -> tuple[bool, Any]:
    """hiringFactFromRow_: resolver first, then the source list, then the single source."""
    resolver = s_(row.get("Current Resolver"))
    if resolver:
        if resolver == "interviewScored_":
            return True, bool(interview_scored(_evidence_interview(reads, ev)))
        if resolver == "hubCjisCleared_":
            return True, cjis_cleared(ev.get("analysis") or {})
        return False, None
    many = _id_list(row.get("Current Sources"))
    if many:
        any_true, first = False, ""
        for m in many:
            ok, v = _evidence_cell(reads, m, ev)
            if ok and cell_truthy(v):
                any_true = True
                if not first:
                    first = gsjs.or_blank(v)
        return True, (any_true if s_(row.get("Type")) == "boolean" else first)
    ok, v = _evidence_cell(reads, row.get("Current Source"), ev)
    if not ok:
        return False, None
    return True, _fact_value(v, s_(row.get("Type")))


def facts_from_evidence(reads: L.Reads, context: str, ev: dict) -> dict[str, Any]:
    """hiringFactsFromEvidence_."""
    out: dict[str, Any] = {}
    for row in matrix_tab(reads, context, "Facts"):
        fid = s_(row.get("Fact ID"))
        if not fid:
            continue
        ok, v = _fact_from_row(reads, row, ev)
        if ok:
            out[fid] = v
    return out


_RULE_OPS = ("equals", "equals_ci", "not_equals", "not_equals_ci", "in", "in_ci", "not_in", "not_in_ci", "starts_with",
             "starts_with_ci", "contains_ci", "matches", "gte", "gt", "lte", "lt", "present", "equals_fact",
             "equals_ci_fact", "gte_fact", "lt_fact", "in_fact", "in_ci_fact")


def rule_ok(rule: Any, fact_map: dict[str, Any]) -> bool:
    """hiringRuleOk_: the matrix rule grammar."""
    if rule is None or rule == "":
        return True
    if isinstance(rule, str):
        t = rule.strip()
        if not t:
            return True
        try:
            rule = json.loads(t)
        except ValueError:
            return False
    if not isinstance(rule, (dict, list)) or rule is None:
        return False
    if isinstance(rule, list):
        return False
    if "all" in rule:
        return all(rule_ok(x, fact_map) for x in (rule["all"] or []))
    if "any" in rule:
        return any(rule_ok(x, fact_map) for x in (rule["any"] or []))
    if "fact" in rule:
        return _compare(rule, fact_map.get(gsjs.js_str(rule["fact"])), fact_map)
    return False


def _compare(rule: dict, got: Any, fact_map: dict[str, Any]) -> bool:
    """hiringCompare_."""
    s = "" if got is None else gsjs.js_str(got)
    low = gsjs.trim(s).lower()
    num = js_number(s)

    def lst(v: Any) -> list:
        return v if isinstance(v, list) else [v]

    def in_list(v: Any, ci: bool) -> bool:
        for one in lst(v):
            o = gsjs.js_str(one)
            if (gsjs.trim(o).lower() == low) if ci else o == s:
                return True
        return False

    def other(key: str) -> str:
        v = fact_map.get(gsjs.js_str(rule.get(key)))
        return "" if v is None else gsjs.js_str(v)

    def fin(n: float) -> bool:
        return math.isfinite(n)

    if "equals" in rule:
        if isinstance(rule["equals"], bool):
            return (got is True or low == "true") == rule["equals"]
        return s == gsjs.js_str(rule["equals"])
    if "equals_ci" in rule:
        return low == gsjs.trim(gsjs.js_str(rule["equals_ci"])).lower()
    if "not_equals" in rule:
        return s != gsjs.js_str(rule["not_equals"])
    if "not_equals_ci" in rule:
        return low != gsjs.trim(gsjs.js_str(rule["not_equals_ci"])).lower()
    if "in" in rule:
        return in_list(rule["in"], False)
    if "in_ci" in rule:
        return in_list(rule["in_ci"], True)
    if "not_in" in rule:
        return not in_list(rule["not_in"], False)
    if "not_in_ci" in rule:
        return not in_list(rule["not_in_ci"], True)
    if "starts_with" in rule:
        return s.startswith(gsjs.js_str(rule["starts_with"]))
    if "starts_with_ci" in rule:
        return low.startswith(gsjs.trim(gsjs.js_str(rule["starts_with_ci"])).lower())
    if "contains_ci" in rule:
        return gsjs.trim(gsjs.js_str(rule["contains_ci"])).lower() in low
    if "matches" in rule:
        raise Defer("a matrix rule matches by a JavaScript pattern, which only Apps Script runs")
    if "gte" in rule:
        return fin(num) and num >= js_number(rule["gte"])
    if "gt" in rule:
        return fin(num) and num > js_number(rule["gt"])
    if "lte" in rule:
        return fin(num) and num <= js_number(rule["lte"])
    if "lt" in rule:
        return fin(num) and num < js_number(rule["lt"])
    if "present" in rule:
        return (gsjs.trim(s) != "") == (rule["present"] is not False)
    if "equals_fact" in rule:
        return s == other("equals_fact")
    if "equals_ci_fact" in rule:
        return low == gsjs.trim(other("equals_ci_fact")).lower()
    if "gte_fact" in rule:
        g = js_number(other("gte_fact"))
        return fin(num) and fin(g) and num >= g
    if "lt_fact" in rule:
        lv = js_number(other("lt_fact"))
        return fin(num) and fin(lv) and num < lv
    if "in_fact" in rule or "in_ci_fact" in rule:
        exact = "in_fact" in rule
        raw = other("in_fact" if exact else "in_ci_fact")
        for part in re.split(r"[,;|]", raw):
            one = gsjs.trim(part)
            if (one == s) if exact else one.lower() == low:
                return True
        return False
    for op in rule:
        if op in ("fact", "otherwise"):
            continue
        if op not in _RULE_OPS:
            return False
    return got is not None and s != "" and low != "false"


def condition_status(row: dict, fact_map: dict[str, Any]) -> str:
    """hiringConditionStatus_."""
    app = s_(row.get("Applicability Rule"))
    if app and not rule_ok(app, fact_map):
        return "not_applicable"
    if s_(row.get("Terminal Rule")) and rule_ok(row.get("Terminal Rule"), fact_map):
        return "terminal"
    if s_(row.get("Failure Rule")) and rule_ok(row.get("Failure Rule"), fact_map):
        return "failed"
    sat = s_(row.get("Satisfies Rule"))
    if not sat:
        return "satisfied"
    return "satisfied" if rule_ok(sat, fact_map) else "open"


def gate_eval(transitions: list[dict], bindings: list[dict], conditions: list[dict], fact_map: dict[str, Any],
              frm: str, to: str) -> dict[str, Any] | None:
    """hiringGateEval_: the book's verdict for one rung."""
    t = next((x for x in transitions if s_(x.get("From")) in (frm, "*") and s_(x.get("To")) == to), None)
    if t is None:
        return None
    hop = {s_(b.get("Binding ID")): s_(b.get("Condition ID")) for b in bindings if s_(b.get("Binding ID"))}
    by_id: dict[str, dict] = {}
    for c in conditions:
        by_id[s_(c.get("Condition ID"))] = c
    reasons: list[str] = []

    def need(cid: str) -> bool:
        c = by_id.get(hop.get(cid) or cid)
        if c is None:
            reasons.append('condition "' + cid + '" is not in the book')
            return False
        st = condition_status(c, fact_map)
        if st in ("satisfied", "not_applicable"):
            return True
        reasons.append(s_(c.get("Truth")) or cid)
        return False

    ok = True
    for a in _id_list(t.get("Requires All")):
        if not need(a):
            ok = False
    req_any = _id_list(t.get("Requires Any"))
    if req_any:
        before = len(reasons)
        any_ok = False
        for b in req_any:
            if need(b):
                any_ok = True
        if any_ok:
            del reasons[before:]
        else:
            ok = False
    if s_(t.get("When Rule")) and not rule_ok(t.get("When Rule"), fact_map):
        ok = False
        reasons.append("when: " + s_(t.get("When Rule")))
    return {"from": frm, "to": to, "ok": ok, "reasons": reasons, "transition": s_(t.get("Transition ID"))}


def stage_gate(reads: L.Reads, ev: dict) -> dict[str, Any]:
    """hubGate_ through hiringGateRide_: the board book's verdict while it is on, the code's otherwise."""
    if not ev.get("cand"):
        return {"from": None, "to": None, "ok": False, "reasons": ["candidate not found"]}
    code = gate_code(reads, ev, stage_of(ev["cand"].get("status")))
    if not code.get("from") or not code.get("to"):
        return code

    def ride() -> dict[str, Any]:
        mode = registry(reads).get("board") or {"id": "", "status": ""}
        if not mode["id"] or mode["status"] not in ("shadow", "on"):
            return code
        fact_map = facts_from_evidence(reads, "board", ev)
        book = gate_eval(matrix_tab(reads, "board", "Transitions"), matrix_tab(reads, "board", "Flow Bindings"),
                         matrix_tab(reads, "board", "Conditions"), fact_map, code["from"], code["to"])
        if book is None:
            return code
        return book if mode["status"] == "on" else code
    got, why = soft(ride)
    return code if why else got


# ---- the board -----------------------------------------------------------------------------------------------------

def talent_source(c: dict) -> str:
    """talentSource_."""
    explicit = s_(c.get("source"))
    if explicit:
        return explicit
    email, made_by = s_(c.get("email")).lower(), s_(c.get("createdby")).lower()
    if "@lead.asalifecare.com" in email or "sweep" in made_by:
        return "SMS"
    return "Direct"


def referrer_from_source(source: str) -> str:
    """talentReferrerFromSource_."""
    m = re.match(r"^\s*referral\s*[—-]\s*(.+)$", source or "", re.I)
    return gsjs.trim(m.group(1)) if m else ""


def checklist(reads: L.Reads, c: dict, a: dict, ps: dict | None, stage: str, app: dict | None) -> list[dict]:
    """talentChecklist_: the card's squares by stage, the fast lane's skipped ones auto."""
    resume_on_file = bool(s_(c.get("resumelink")) or s_(a.get("analyzedat")) or s_(a.get("compositescore"))
                          or s_(a.get("summary")))
    cjis = s_(a.get("cjisstatus")).lower()
    cjis_report = s_(a.get("cjisreporturl"))
    decision = s_(a.get("decisionstatus")).lower()
    items: list[dict] = []
    if app and app.get("srid"):
        st = s_(app.get("status")).lower()
        items.append({"id": "application", "label": cp_word(reads, "application"), "owner": cp_owner(reads, "candidate"),
                      "stage": "new", "status": "done" if st == "signed" else ("missing" if st == "declined" else "pending")})
    items += [
        {"id": "resume", "label": cp_word(reads, "resume"), "owner": cp_owner(reads, "candidate"), "stage": "new",
         "upload": True, "status": "done" if resume_on_file else "missing"},
        {"id": "cjis", "label": cp_word(reads, "cjis"), "owner": cp_owner(reads, "hr"), "stage": "new", "upload": True,
         "status": "done" if cjis_cleared(a) else ("pending" if cjis in ("clear", "verified", "on file") or cjis_report
                                                   else "missing")},
        {"id": "resume-decision", "label": cp_word(reads, "resume_decision"), "owner": cp_owner(reads, "recruiter"),
         "stage": "new", "status": "done" if decision == "advance" else "pending"}]
    at = TALENT_STAGE_ORDER.index(stage) if stage in TALENT_STAGE_ORDER else -1
    if at >= TALENT_STAGE_ORDER.index("phone-screen"):
        s = ps or {}
        completed = s_(s.get("screenstatus")).lower() == "completed"
        final = s_(s.get("finalresult")).lower()
        manual = s_(s.get("manualscreen")).lower() == "true"
        items += [
            {"id": "transcript", "label": cp_word(reads, "transcript"), "owner": cp_owner(reads, "auto"),
             "stage": "phone-screen",
             "status": "done" if manual else ("auto" if s_(s.get("transcripturl")) or s_(s.get("transcripttext"))
                                              else "pending")},
            {"id": "ai-report", "label": cp_word(reads, "ai_report"), "owner": cp_owner(reads, "auto"),
             "stage": "phone-screen",
             "status": "done" if manual else ("auto" if s_(s.get("phonescreenreporturl")) or s_(s.get("screenscore"))
                                              else "pending")},
            {"id": "screen-details", "label": cp_word(reads, "screen_details"), "owner": cp_owner(reads, "recruiter"),
             "stage": "phone-screen", "status": "done" if manual or completed else "pending"},
            {"id": "advance-decision", "label": cp_word(reads, "advance_decision"), "owner": cp_owner(reads, "recruiter"),
             "stage": "phone-screen", "status": "done" if final == "advance" else "pending"}]
    if at >= TALENT_STAGE_ORDER.index("interview"):
        iv = interview_for(reads, s_(c.get("candidateid"))) or {}
        rec = s_(iv.get("recommendation")).lower()
        items += [
            {"id": "interview-scheduled", "label": cp_word(reads, "interview_scheduled"),
             "owner": cp_owner(reads, "recruiter"), "stage": "interview",
             "status": "done" if s_(iv.get("scheduledfor")) else "pending"},
            {"id": "interview-scorecard", "label": cp_word(reads, "interview_scorecard"),
             "owner": cp_owner(reads, "interviewer"), "stage": "interview",
             "status": "done" if interview_scored(iv) else "pending"},
            {"id": "interview-recommendation", "label": cp_word(reads, "interview_recommendation"),
             "owner": cp_owner(reads, "interviewer"), "stage": "interview",
             "status": "done" if rec == "advance" else "pending"}]
    if at >= TALENT_STAGE_ORDER.index("onboarding"):
        pk, _w = soft(lambda: packet_state(reads, c))
        if pk:
            pk_status = "done" if pk["state"] in ("signed", "waived") else ("missing" if pk["state"] == "unsigned"
                                                                           else "pending")
            label = cp_word(reads, "packet")
            if pk["state"] == "signed":
                label += cp_word(reads, "packet.signed")
            elif pk["state"] == "waived":
                label += cp_word(reads, "packet.on_file") + (" (" + s_(pk.get("waived_by")).split(" — ")[0] + ")"
                                                              if pk.get("waived_by") else "")
            elif pk["state"] == "unsigned":
                label += cp_word(reads, "packet.unsigned")
            elif pk["state"] == "ambiguous":
                label += cp_word(reads, "packet.ambiguous")
            else:
                label += cp_word(reads, "packet.not_found")
            hold = packet_hold(reads, c)
            if hold and pk_status != "done":
                label = cp_word(reads, "packet.held_late" if hold["escalate"] else "packet.held")
                pk_status = "missing"
            items.append({"id": "new-hire-packet", "label": label, "owner": cp_owner(reads, "hr"), "stage": "onboarding",
                          "status": pk_status, "packetState": pk["state"], "packetHold": hold["phase"] if hold else ""})
        ob, _w2 = soft(lambda: onboarding_done(reads, c))
        if ob and not ob.get("unreadable"):
            left = []
            if not ob.get("q"):
                left.append(cp_word(reads, "onboarding.questionnaire"))
            if not ob.get("t"):
                left.append(cp_word(reads, "onboarding.tutorials"))
            items.append({"id": "onboarding-complete", "stage": "onboarding", "owner": cp_owner(reads, "candidate"),
                          "label": (cp_word(reads, "onboarding.done")
                                    + (cp_word(reads, "onboarding.manual") if ob.get("how") == "manual" else ""))
                          if ob.get("ok") else cp_word(reads, "onboarding.open")
                          + (" (" + ", ".join(left) + ")" if left else ""),
                          "status": "done" if ob.get("ok") else "pending"})
    if stage == "hired":
        held, acct = s_(c.get("graduationheld")), s_(c.get("staffuserid"))
        items.append({"id": "staff-account", "owner": cp_owner(reads, "auto"), "stage": "hired",
                      "label": render(cp_word(reads, "account.held"), {"why": held}) if held
                      else (cp_word(reads, "account.created") if acct else cp_word(reads, "account.creating")),
                      "status": "missing" if held else ("done" if acct else "pending")})
        if acct:
            armed = s_(c.get("staffuserarmed")).lower() == "true"
            items.append({"id": "staff-account-armed", "owner": cp_owner(reads, "hr"), "stage": "hired",
                          "label": cp_word(reads, "signin.armed" if armed else "signin.no_password"),
                          "status": "done" if armed else "missing"})
        id_at, id_note = s_(c.get("internaldocsat")), s_(c.get("internaldocsnote"))
        id_low = id_note.lower()
        items.append({"id": "internal-docs-fill",
                      "label": cp_word(reads, "empdb.filling") if not id_at
                      else cp_word(reads, "empdb.taken") if id_low.startswith("left alone")
                      else render(cp_word(reads, "empdb.failed"), {"why": id_note[:120]})
                      if id_low.startswith("not filled") else cp_word(reads, "empdb.on_file"),
                      "owner": cp_owner(reads, "hr"), "stage": "hired",
                      "status": "pending" if not id_at else "missing" if id_low.startswith("not filled")
                      else "auto" if id_low.startswith("left alone") else "done"})
    fast_at = s_(c.get("fastlaneat"))
    if fast_at:
        cut = TALENT_STAGE_ORDER.index(fast_at) if fast_at in TALENT_STAGE_ORDER else -1
        by_whom = s_(c.get("fastlaneby")).split(" at ")[0]
        if cut > 0:
            for it in items:
                st_at = TALENT_STAGE_ORDER.index(s_(it.get("stage"))) if s_(it.get("stage")) in TALENT_STAGE_ORDER else -1
                if st_at == -1 or st_at >= cut or it["status"] in ("done", "auto"):
                    continue
                it["status"] = "auto"
                it["label"] = it["label"] + render(cp_word(reads, "skipped"),
                                                   {"stage": HUB_STAGE_TO_STATUS.get(fast_at) or fast_at})
                it["skippedBy"] = by_whom
    return items


def _stage_arrivals(reads: L.Reads) -> dict[str, dict[str, str]]:
    """talentStageArrivals_: the latest arrival at each stage per candidate."""
    def read() -> dict[str, dict[str, str]]:
        out: dict[str, dict[str, str]] = {}
        for h in status_rows(reads):
            hid, to, at = s_(h.get("candidateid")), stage_of(s_(h.get("tostatus"))), s_(h.get("timestamp"))
            if not hid or not to or not at:
                continue
            slot = out.setdefault(hid, {})
            if not slot.get(to) or at > slot[to]:
                slot[to] = at
        return out
    got, why = soft(read)
    return {} if why else got


def _replies(reads: L.Reads) -> dict[str, dict]:
    """The board's replies: each candidate's last reply and how many are unread."""
    def read() -> dict[str, dict]:
        import opt_outs  # noqa: PLC0415 - the inbound log's owner: Postgres once kept there, else the tab
        out: dict[str, dict] = {}
        for m in opt_outs.inbound_rows(reads):
            cid = s_(m.get("candidateid"))
            if not cid or s_(m.get("intent")) != "reply":
                continue
            prev = out.get(cid)
            at = s_(m.get("receivedat"))
            if prev is None:
                prev = out[cid] = {"at": "", "body": "", "unread": 0}
            if not s_(m.get("seenat")):
                prev["unread"] += 1
            if at >= prev["at"]:
                prev["at"], prev["body"] = at, s_(m.get("body"))
        return out
    got, why = soft(read)
    return {} if why else got


def _docs_on_file(reads: L.Reads) -> dict[str, list[str]]:
    """The files actually on this platform per candidate (uploaded or verified, with a file)."""
    def read() -> dict[str, list[str]]:
        out: dict[str, list[str]] = {}
        for d in read_tab(reads, DOCS_TAB):
            cid, doc = s_(d.get("candidateid")), s_(d.get("docid"))
            if not cid or not doc or s_(d.get("supersededby")):
                continue
            if s_(d.get("status")).lower() not in ("uploaded", "verified") or not s_(d.get("fileurl")):
                continue
            out.setdefault(cid, []).append(doc)
        return out
    got, why = soft(read)
    return {} if why else got


def _parked(reads: L.Reads) -> dict[str, dict]:
    """The Ready to start parking machine's notices per candidate (last row wins)."""
    out: dict[str, dict] = {}
    for a in sim_ask_rows(reads):
        if s_(a.get("step")) != "ready_parked":
            continue
        pid = s_(a.get("candidateid"))
        if not pid:
            continue
        n, of = js_parse_int(s_(a.get("sentcount"))), js_parse_int(s_(a.get("maxattempts")))
        out[pid] = {"notices": 0 if math.isnan(n) else int(n), "of": 0 if math.isnan(of) else int(of),
                    "lastAt": s_(a.get("lastsentat")), "openedAt": s_(a.get("createdat"))}
    return out


HUB_MONTH_NAMES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_BARE_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}\Z")


def _day_only(v: Any) -> str:
    """hubDayOnlyLabel_: a bare day as `Mon d, yyyy`, else ''."""
    s = gsjs.trim(gsjs.js_str(v)) if v is not None else ""
    if not _BARE_DAY.match(s):
        return ""
    m, d = int(s[5:7]), int(s[8:10])
    return f"{HUB_MONTH_NAMES[m - 1]} {d}, {int(s[:4])}" if 1 <= m <= 12 and 1 <= d <= 31 else ""


def _ny(v: Any) -> datetime | None:
    t = js_date_ms(gsjs.js_str(v))
    return None if t is None else datetime.fromtimestamp(t / 1000.0, timezone.utc).astimezone(NY)


def day_label(v: Any) -> str:
    """hubDayLabel_: a bare day as itself, a moment as its day on New York's clock, unreadable text cut to ten."""
    if v is None or v == "":
        return ""
    bare = _day_only(v)
    if bare:
        return bare
    at = _ny(v)
    if at is None:
        return gsjs.js_str(v)[:10]
    return f"{HUB_MONTH_NAMES[at.month - 1]} {at.day}, {at.year}"


def when_label(v: Any) -> str:
    """hubWhenLabel_: a bare day as itself, a moment on New York's clock with its time unless it is midnight."""
    if v is None or v == "":
        return ""
    bare = _day_only(v)
    if bare:
        return bare
    at = _ny(v)
    if at is None:
        return gsjs.js_str(v)
    day = f"{HUB_MONTH_NAMES[at.month - 1]} {at.day}, {at.year}"
    if at.hour == 0 and at.minute == 0:
        return day
    return f"{day} · {at.hour % 12 or 12}:{at.minute:02d} {'AM' if at.hour < 12 else 'PM'}"


def timeline(c: dict, a: dict, ps: dict | None) -> list[dict[str, str]]:
    """talentTimeline_: applied, the resume's analysis, the CJIS result, the resume decision, the phone screen."""
    out = [{"time": day_label(c.get("createdat")), "text": "Applied via " + talent_source(c), "tint": "blue"}]
    summary = s_(a.get("summary"))
    if summary:
        out.append({"time": "Resume analysis", "text": summary[:420] + "…" if len(summary) > 420 else summary,
                    "tint": "lavender"})
    cjis = s_(a.get("cjisstatus"))
    if cjis:
        out.append({"time": "CJIS", "text": "Background result: " + cjis, "tint": "amber"})
    decision = s_(a.get("decisionstatus"))
    if decision:
        out.append({"time": "Resume decision", "text": decision, "tint": "mint"})
    if ps:
        bits = []
        if s_(ps.get("screenstatus")):
            bits.append(s_(ps.get("screenstatus")))
        if s_(ps.get("bestinpersondaytime")):
            bits.append("in-person " + when_label(ps.get("bestinpersondaytime")))
        if s_(ps.get("finalresult")):
            bits.append("decision: " + s_(ps.get("finalresult")))
        out.append({"time": "Phone screen" + (" · " + day_label(ps.get("screendate")) if s_(ps.get("screendate"))
                                              else ""),
                    "text": " · ".join(bits) if bits else "Screening opened", "tint": "peach"})
    return out


def record(reads: L.Reads, c: dict, a: dict, ps: dict | None, stage: str, reply: dict | None, docs: list[str],
           since: str, parked: dict | None, recruit: list[dict]) -> dict[str, Any]:
    """talentRecord_: one card as the board draws it."""
    cid = s_(c.get("candidateid"))
    name = s_(c.get("candidatename")) or gsjs.trim(s_(c.get("firstname")) + " " + s_(c.get("lastname"))) or cid
    created, updated = s_(c.get("createdat")), s_(c.get("updatedat"))
    score = js_parse_float(s_(c.get("score")))
    urg, _w = soft(lambda: card_urgency(reads, c))
    urg = urg or {"level": "none", "why": "", "source": ""}
    pk, _w2 = soft(lambda: packet_state(reads, c, recruit))
    app, _w3 = soft(lambda: application_for(c, recruit, pk, reads))
    window = None
    if stage == "onboarding":
        w, _w4 = soft(lambda: onboarding_window(reads, c))
        if w is not None and not (w.get("open") and not s_(w.get("until"))):
            window = {"open": w.get("open") is not False, "until": s_(w.get("until")), "reason": s_(w.get("reason")),
                      "anchored_on": s_(w.get("anchored_on"))}
    composite = js_parse_float(s_(a.get("compositescore")))
    id_at, id_note = s_(c.get("internaldocsat")), s_(c.get("internaldocsnote"))
    internal = {"state": "pending", "note": "", "at": ""} if not id_at else {
        "state": "left_alone" if id_note.lower().startswith("left alone")
        else "failed" if id_note.lower().startswith("not filled") else "filled", "note": id_note, "at": id_at}
    hold, _w5 = soft(lambda: packet_hold(reads, c))
    out = {
        "id": cid, "name": name, "urgency": urg["level"], "urgencyWhy": urg["why"], "urgencySource": urg.get("source") or "",
        "onboardingWindow": window, "role": "Direct Support Professional", "avatar": "", "stage": stage,
        "source": talent_source(c), "docsOnFile": docs or [],
        "referralName": s_(c.get("referralname")) or referrer_from_source(s_(c.get("source"))),
        "referralPhone": s_(c.get("referralphone")), "addedBy": s_(c.get("createdby")),
        "daysInStage": days_since(reads, created if stage == "new" else (updated or created)),
        "stageSince": s_(since), "daysAtStage": days_since(reads, s_(since)) if s_(since) else None,
        "parked": {"notices": parked.get("notices") or 0, "of": parked.get("of") or 0, "lastAt": s_(parked.get("lastAt"))}
        if parked else None,
        "score": None if score is None else (5 if score > 0 else 0) if math.isinf(score)
        else max(0, min(5, int(gsjs.js_round(score / 2)))),
        "appliedAt": created, "email": s_(c.get("email")), "phone": s_(c.get("phone")), "city": s_(c.get("city")),
        "state": s_(c.get("state")), "owner": s_(c.get("assignedto")), "ownerAvatar": "",
        "resumeLink": s_(c.get("resumelink")), "resumeFileLabel": "Open resume" if s_(c.get("resumelink")) else "",
        "tpCandidateId": s_(c.get("tpcandidateid")),
        "resumeScorecard": None if composite is None else composite,
        "summary": s_(a.get("summary")), "summaryTimeline": timeline(c, a, ps),
        "screenDate": iso_day(ps.get("screendate")) if ps else "", "screenResult": s_(ps.get("finalresult")) if ps else "",
        "screenStatus": s_(ps.get("screenstatus")) if ps else "",
        "packetSignedAt": iso_day(pk.get("signed")) if pk else "",
        "application": app or None,
        "checklist": checklist(reads, c, a, ps, stage, app),
        "packet": packet_chip(pk["state"]) if pk else None,
        "internalDocs": internal, "packetHold": hold,
        "lastReply": {"at": reply["at"], "body": reply["body"], "unread": reply["unread"]} if reply and reply["at"]
        else None,
        "optedOut": soft(lambda: opted_out(reads, s_(c.get("phone"))) or "")[0] or ""}
    return out


def board(reads: L.Reads) -> dict[str, Any]:
    """talentCandidatesRead_ (the board, no sweep rider): every card on it, and each by its id."""
    def read() -> dict[str, Any]:
        cands = read_tab(reads, TALENT_CANDIDATES_TAB)
        analyses = read_tab(reads, TALENT_RESUME_TAB)
        screens = read_tab(reads, TALENT_PHONE_TAB)
        by_a: dict[str, dict] = {}
        for x in analyses:
            if s_(x.get("candidateid")):
                by_a[s_(x.get("candidateid"))] = x
        by_s: dict[str, dict] = {}
        for x in screens:
            if s_(x.get("candidateid")):
                by_s[s_(x.get("candidateid"))] = x
        replies, docs, since = _replies(reads), _docs_on_file(reads), _stage_arrivals(reads)
        recruit = packet_rows(reads)
        parked = _parked(reads)
        rows = []
        for c in cands:
            cid = s_(c.get("candidateid"))
            if not cid or cid in TALENT_EXCLUDE_IDS or s_(c.get("archived")).lower() == "true":
                continue
            stage = stage_of(c.get("status"))
            if not stage:
                continue
            arrival = (since.get(cid) or {}).get(stage) or ""
            park = parked.get(cid)
            if park and arrival and s_(park.get("openedAt")) < arrival:
                park = None
            rows.append(record(reads, c, by_a.get(cid) or {}, by_s.get(cid), stage, replies.get(cid),
                               docs.get(cid) or [], arrival, park, recruit))
        # a photo uploaded on the candidate's page
        kept = P.newest(reads, "candidates")
        for r in rows:
            if kept.get(r["id"]):
                r["avatar"] = kept[r["id"]]
        return {"rows": rows, "byId": {r["id"]: r for r in rows if r["id"]}}
    return reads.once("cnd_board", read)


# ---- one candidate -------------------------------------------------------------------------------------------------

def archived_row(cid: str, raw: dict) -> dict[str, Any]:
    """cndArchivedRow_: the minimal card for a candidate the board no longer carries."""
    name = s_(raw.get("candidatename")) or gsjs.trim(s_(raw.get("firstname")) + " " + s_(raw.get("lastname"))) or cid
    return {"id": cid, "name": name, "avatar": "", "role": "Direct Support Professional",
            "stage": stage_of(s_(raw.get("status"))) or "", "status": s_(raw.get("status")),
            "archived": s_(raw.get("archived")).lower() == "true", "archived_at": s_(raw.get("archivedat")),
            "archived_reason": s_(raw.get("archivedreason")), "email": s_(raw.get("email")), "phone": s_(raw.get("phone")),
            "city": s_(raw.get("city")), "state": s_(raw.get("state")), "source": s_(raw.get("source")),
            "appliedAt": s_(raw.get("createdat")), "owner": s_(raw.get("assignedto")), "score": None,
            "resumeLink": s_(raw.get("resumelink")), "tpCandidateId": s_(raw.get("tpcandidateid")), "application": None,
            "packet": None, "summary": "", "summaryTimeline": [], "checklist": []}


def candidate_of(reads: L.Reads, raw: Any) -> dict[str, Any]:
    """cndCandidate_: 400 when no hiring record carries the id, 503 when the records cannot say."""
    key = gsjs.trim("" if raw is None else gsjs.js_str(raw))
    none = {"refused": {"status": 400, "message": f'No candidate "{key[:120]}" is on file.'}}
    if not _CAN_KEY.match(key) or key in TALENT_EXCLUDE_IDS:
        return none
    b, why = soft(lambda: board(reads))
    if why:
        return {"refused": {"status": 503, "message": "The hiring board could not be read just now (" + why
                            + ") — nothing is said about this candidate."}}
    row = b["byId"].get(key)
    archived = False
    if row is None:
        rows, why_r = soft(lambda: raw_rows(reads))
        if why_r:
            return {"refused": {"status": 503, "message": "The candidate records could not be read just now (" + why_r
                                + ") — nothing is said about this candidate."}}
        hit = None
        for r in rows or []:
            if s_(r.get("candidateid")) == key:
                hit = r
        if hit is None:
            return none
        row = archived_row(key, hit)
        archived = True
    return {"key": key, "name": s_(row.get("name")) or key, "row": row, "archived": archived, "memo": {}}


def ev_or(reads: L.Reads, ctx: dict, sink: dict) -> dict[str, Any]:
    """cndEvidenceOr_."""
    got, why = soft(lambda: evidence(reads, ctx["key"]))
    if why:
        sink["why"].append(why_of("The hiring records", why))
        sink["degraded"] = True
        return {"cand": None, "analysis": {}, "screen": None}
    return got or {"cand": None, "analysis": {}, "screen": None}


def extras(reads: L.Reads, ctx: dict, ev: dict) -> dict[str, Any]:
    """candidateProfileExtras_: the interview scorecard and the onboarding record."""
    def build() -> dict[str, Any]:
        cand = ev.get("cand")
        interview = None
        iv, _w = soft(lambda: interview_for(reads, ctx["key"]))
        if iv:
            interview = {"interviewer_name": s_(iv.get("interviewername")), "score": s_(iv.get("score")),
                         "comments": s_(iv.get("comments")), "recommendation": s_(iv.get("recommendation")),
                         "scheduled_for": s_(iv.get("scheduledfor")), "interviewed_at": s_(iv.get("interviewedat"))}
        ob, _w2 = soft(lambda: onboarding_row(reads, ctx["key"]))
        done = None
        if cand:
            done, _w3 = soft(lambda: onboarding_done(reads, cand))
        q, t = bool(done and done.get("q")), bool(done and done.get("t"))
        ready_at, ready_by = s_((cand or {}).get("approvedreadyat")), s_((cand or {}).get("approvedreadyby"))
        onboarding = None
        if ob or q or t or ready_at or ready_by:
            onboarding = {"starting_status": s_(ob.get("startingstatus")) if ob else "",
                          "earliest_start_date": s_(ob.get("earlieststartdate")) if ob else "",
                          "start_date": s_(ob.get("startdate")) if ob else "", "house": s_(ob.get("house")) if ob else "",
                          "notes": s_(ob.get("notes")) if ob else "",
                          "date_moved": s_(ob.get("datemovedtoonboarding")) if ob else "",
                          "questionnaire_done": q, "tutorials_done": t, "approved_ready_at": ready_at,
                          "approved_ready_by": ready_by}
        return {"interview": interview, "onboarding": onboarding}
    if "extras" not in ctx["memo"]:
        ctx["memo"]["extras"] = build()
    return ctx["memo"]["extras"] or {"interview": None, "onboarding": None}


def data_of(reads: L.Reads, action: str, ctx: dict, build: Callable[[], Any]) -> Any:
    """cndData_: one part's scrubbed answer, built once per request and shared by every part that shows it."""
    slot = "a:" + action
    if slot not in ctx["memo"]:
        ctx["memo"][slot] = shown(scrub(build()))
    return ctx["memo"][slot]


# ---- the roster ------------------------------------------------------------------------------------------------------

def next_steps(row: dict) -> dict[str, Any]:
    """cndNextSteps_: the first open item of the phase they stand in, else the first one left behind."""
    in_phase = {c.get("id") for c in row.get("checklist") or [] if c.get("stage") == row.get("stage")}
    opened = [c for c in row.get("checklist") or [] if open_item(c)]
    nxt = [c for c in opened if c.get("id") in in_phase]
    behind = [c for c in opened if c.get("id") not in in_phase]
    return {"next": nxt, "behind": behind, "head": (nxt or behind or [None])[0]}


def attention(row: dict) -> list[str]:
    """cndAttention_: what needs a person beyond the checklist."""
    out = []
    if row.get("urgency") and row.get("urgency") != "none":
        out.append(("Needs a decision" if row["urgency"] == "red" else "Running late")
                   + (" — " + gsjs.or_blank(row["urgencyWhy"]) if row.get("urgencyWhy") else ""))
    last = row.get("lastReply")
    if last and last.get("unread"):
        n = last["unread"]
        out.append(f"{gsjs.js_str(n)} unread repl" + ("y" if n == 1 else "ies"))
    if row.get("optedOut"):
        out.append("Opted out of texts — no message may leave for them")
    parked = row.get("parked")
    if parked and parked.get("notices"):
        n = parked["notices"]
        out.append(f"Parked at Ready to start — the deciders have been told {gsjs.js_str(n)} time" + ("" if n == 1 else "s"))
    resume = next((c for c in row.get("checklist") or [] if c.get("id") == "resume"), None)
    if resume and resume.get("status") in ("done", "auto") and row.get("resumeScorecard") is None:
        out.append("Resume on file and not scored")
    return out


def status_word(row: dict, steps: dict) -> str:
    """cndStatusWord_."""
    if attention(row):
        return "needs_you"
    if not steps["head"]:
        return "clear"
    return "missing" if steps["head"].get("status") == "missing" else "waiting"


def roster_row(row: dict) -> dict[str, Any]:
    """cndRosterRow_."""
    steps = next_steps(row)
    head = steps["head"]
    das = row.get("daysAtStage")
    return {"key": gsjs.js_str(row.get("id")), "name": s_(row.get("name")),
            "position": s_(row.get("role")) or "Direct Support Professional", "stage": s_(row.get("stage")),
            "stage_label": stage_label(row.get("stage")),
            "location": ", ".join(x for x in (s_(row.get("city")), s_(row.get("state"))) if x),
            "next_step": s_(head.get("label")) if head else "", "next_owner": s_(head.get("owner")) if head else "",
            "next_id": s_(head.get("id")) if head else "",
            "packet": s_(row["packet"].get("state")) if row.get("packet") else "", "recruiter": by_of(row.get("owner")),
            "status": status_word(row, steps), "urgency": s_(row.get("urgency")) or "none",
            "applied_at": iso_day(row.get("appliedAt")),
            "days_at_stage": das if das is not None else (row.get("daysInStage") or 0), "avatar": s_(row.get("avatar"))}


def roster_of(rows: list[dict], shape: Callable[[dict], dict], extra: dict | None = None) -> dict[str, Any]:
    """cndRosterOf_: the roster in the board's stage order, and how many stand at each stage."""
    counts: dict[str, int] = {}
    out = []
    for r in rows:
        counts[r.get("stage")] = counts.get(r.get("stage"), 0) + 1
        out.append(shape(r))

    def idx(s: Any) -> int:
        return TALENT_STAGE_ORDER.index(s) if s in TALENT_STAGE_ORDER else -1

    out.sort(key=_cmp(lambda a, b: (idx(a["stage"]) - idx(b["stage"])) or gsjs.locale_cmp(a["name"], b["name"])))
    answer = {"candidates": out,
              "stages": [{"id": s, "label": stage_label(s), "count": counts.get(s, 0)} for s in TALENT_STAGE_ORDER],
              "why": [], "degraded": False}
    for k, v in (extra or {}).items():
        answer[k] = v
    return answer


# ---- a narrowed reader -----------------------------------------------------------------------------------------------

def house_of(v: Any, homes: list[dict], addr: dict) -> str:
    """cndHouseOf_: a place a hiring record names, as a house code."""
    s = text(v, 200)
    if not s:
        return ""
    code = L.house_code(s) or L.code_of(s)
    if code:
        return code
    up, fold = s.upper(), gsjs.name_key(s)
    named = [h for h in homes or [] if re.search(r"(^|[^A-Z0-9])" + re.escape(h["code"]) + r"(?![0-9])", up)
             or (bool(fold) and gsjs.name_key(h.get("home_name")) == fold)]
    if named:
        return named[0]["code"] if len(named) == 1 else ""
    return L.addr_owner(addr or {}, s)["code"]


def ties(reads: L.Reads, codes: list[str], b: dict) -> dict[str, Any]:
    """cndTies_ (FAIL-CLOSED): the board's candidates the Hiring app ties to one of these houses."""
    want = {L.house_code(c) for c in codes or [] if L.house_code(c)}
    houses = sorted(want)
    out: dict[str, Any] = {"keys": {}, "events": {}, "places": {}, "degraded": False}
    if not houses:
        return out
    on_board: dict[str, bool] = {}
    by_name: dict[str, list[str]] = {}
    for r in b["rows"]:
        k = gsjs.js_str(r["id"])
        on_board[k] = True
        n = gsjs.name_key(r.get("name"))
        if len(n) >= 3:
            by_name.setdefault(n, []).append(k)

    def tie(k: str) -> None:
        if on_board.get(k):
            out["keys"][k] = True

    def tie_name(fold: str) -> None:
        for k in by_name.get(fold) or []:
            tie(k)

    homes, why_h = soft(reads.homes)
    if why_h:
        out["degraded"] = True
    homes = homes or []
    for h in homes:
        if h["code"] in want:
            out["places"][h["code"]] = text(h.get("home_name"), 120) or h["code"]
    addr = L.addr_index(homes, [])

    def tab(name: str, each: Callable[[dict], None]) -> None:
        def run() -> None:
            for r in read_tab(reads, name):
                each(r)
        _ok, why_t = soft(run)
        if why_t:
            out["degraded"] = True

    def onboarding(r: dict) -> None:
        if house_of(r.get("house"), homes, addr) in want:
            tie(s_(r.get("candidateid")))

    def event(r: dict) -> None:
        cid, status = s_(r.get("candidateid")), s_(r.get("status")).lower()
        if not s_(r.get("eventid")) or not on_board.get(cid) or status == "cancelled":
            return
        code = house_of(r.get("location"), homes, addr)
        if code not in want:
            return
        tie(cid)
        out["events"].setdefault(cid, []).append({
            "id": s_(r.get("eventid")), "type": s_(r.get("eventtype")), "date": hiring_date(r.get("date")),
            "time": hiring_time(r.get("time")), "house": code, "with_name": text(r.get("withname"), 120),
            "status": status})

    tab(ONBOARDING_TAB, onboarding)
    tab(HIRING_EVENTS_TAB, event)
    cal = reads.calendar().get("cal")
    if cal and cal.get("values"):
        today = reads.today()
        head = [gsjs.trim(gsjs.or_blank(h)).lower() for h in (cal["values"][0] or [])]

        def col(name: str, fb: int) -> int:
            return head.index(name) if name in head else fb

        c_loc, c_name, c_date = col("location", 0), col("employee", 1), col("date", 4)
        for line in cal["values"][1:]:
            line = line or []

            def at(j: int) -> Any:
                return line[j] if j < len(line) else None

            if L.code_of(at(c_loc)) not in want:
                continue
            day = L.broadcast_day(at(c_date), cal.get("tz"))
            if day and day > today:
                tie_name(gsjs.name_key(text(at(c_name))))
    else:
        out["degraded"] = True
    seen, why_s = soft(lambda: L.staff_visible(reads, houses))
    if why_s or not seen or seen.get("why"):
        out["degraded"] = True
    for k in (seen or {}).get("keys") or []:
        tie_name(k)
    return out


def narrow_row(row: dict) -> dict[str, Any]:
    """cndNarrowRow_."""
    return {"key": gsjs.js_str(row.get("id")), "name": s_(row.get("name")),
            "position": s_(row.get("role")) or "Direct Support Professional", "stage": s_(row.get("stage")),
            "stage_label": stage_label(row.get("stage")), "avatar": s_(row.get("avatar"))}


def narrow_why(t: dict) -> list[str]:
    return [CND_NARROW_WHY] if t["degraded"] else []


def narrow_view(reads: L.Reads, scope: dict) -> dict[str, Any]:
    """cndNarrowView_."""
    def read() -> dict[str, Any]:
        b = board(reads)
        return {"board": b, "ties": ties(reads, scope.get("house_codes") or [], b)}
    return reads.once("cnd_narrow", read)


def narrow_roster(reads: L.Reads, scope: dict) -> dict[str, Any]:
    """cndNarrowRoster_."""
    v = narrow_view(reads, scope)
    rows = [r for r in v["board"]["rows"] if v["ties"]["keys"].get(gsjs.js_str(r["id"]))]
    return roster_of(rows, narrow_row, {"viewer": scope["kind"], "why": narrow_why(v["ties"]),
                                        "degraded": v["ties"]["degraded"]})


def narrow_candidate(reads: L.Reads, scope: dict, raw: Any) -> dict[str, Any]:
    """cndNarrowCandidate_: one on the board tied to their houses, else the app's own 404."""
    key = gsjs.trim("" if raw is None else gsjs.js_str(raw))
    v, why = soft(lambda: narrow_view(reads, scope))
    if why:
        return {"refused": {"status": 503, "message": "The hiring board could not be read just now."}}
    row = v["board"]["byId"].get(key) if v["ties"]["keys"].get(key) else None
    if not row:
        return {"refused": unknown()}
    return {"key": key, "row": row, "ties": v["ties"]}


def narrow_overview(scope: dict, hit: dict) -> dict[str, Any]:
    """cndNarrowOverview_: the basic card."""
    c = narrow_row(hit["row"])
    return {"candidate": {"key": c["key"], "name": c["name"], "position": c["position"], "stage": c["stage"],
                          "stage_label": c["stage_label"], "status_label": c["stage_label"], "archived": False,
                          "avatar": c["avatar"]},
            "information": {"full_name": c["name"], "stage_label": c["stage_label"], "position": c["position"]},
            "viewer": scope["kind"], "why": narrow_why(hit["ties"]), "degraded": hit["ties"]["degraded"]}


def narrow_interviews(scope: dict, hit: dict) -> dict[str, Any]:
    """cndNarrowInterviews_: the interviews booked at the reader's houses, by day; never a score or a note."""
    evs = list(hit["ties"]["events"].get(hit["key"]) or [])

    def when(e: dict) -> str:
        return e["date"] + "T" + (e["time"] or "00:00")

    evs.sort(key=_cmp(lambda a, b: -1 if when(a) < when(b) else (1 if when(a) > when(b) else 0)))
    plan = [{"id": "event_" + e["id"], "title": HIRING_EVENT_TYPES.get(e["type"]) or "Meeting", "date": e["date"],
             "owner": e["with_name"], "status": "completed" if CND_EVENT_DONE.match(e["status"]) else "scheduled",
             "detail": " · ".join(x for x in (hit["ties"]["places"].get(e["house"]) or e["house"], e["time"]) if x),
             "result": "", "comments": ""} for e in evs]
    return {"plan": plan, "preferences": {}, "viewer": scope["kind"], "why": narrow_why(hit["ties"]),
            "degraded": hit["ties"]["degraded"]}


def narrow_serve(reads: L.Reads, scope: dict, payload: dict, build: Callable[[dict, dict], Any]) -> dict[str, Any]:
    """cndNarrowServe_."""
    hit = narrow_candidate(reads, scope, payload.get("candidate"))
    if hit.get("refused"):
        return hit["refused"]
    return serve("The candidate", lambda: shown(scrub(build(scope, hit))))


# ---- actions ---------------------------------------------------------------------------------------------------------

def door_of(ctx: dict, item: dict) -> dict[str, Any]:
    """cndDoor_: a checklist item's Hiring door, or why it has none here."""
    if ctx["archived"]:
        return {"door": None, "why": "This candidate is out of the Hiring pipeline."}
    d = CND_DOORS.get(gsjs.or_blank(item.get("id")))
    if not d:
        if item.get("id") == "staff-account-armed":
            return {"door": None, "why": "An admin sets the first password on the account in Users."}
        return {"door": None, "why": "The platform does this by itself." if item.get("id") in CND_MACHINE_ITEMS
                else "The Hiring app has no door for this step."}
    if d.get("stage") and d["stage"] != ctx["row"].get("stage"):
        return {"door": None, "why": "Its door opens at " + stage_label(d["stage"]) + "."}
    payload = {"candidate_id": ctx["key"], **(d.get("fields") or {})}
    return {"door": {"action": d["action"], "form": d.get("form") or "", "payload": payload}, "why": ""}


def packet_signed(row: dict | None) -> bool:
    """cndPacketSigned_."""
    return bool(row) and bool(row.get("packet")) and row["packet"].get("state") in ("signed", "waived")


def kind_words(kind: Any) -> str:
    """cndKindWords_: "a background check"."""
    k = s_(kind)
    w = CND_KIND_WORDS.get(k) or CERT_READ_KIND_WORDS.get(k) or k.replace("_", " ")
    return ("an " if re.match(r"^[aeiou]", w, re.I) else "a ") + w


def expects(kinds: Any) -> str:
    """cndExpects_."""
    return " or ".join(kind_words(k) for k in (kinds or ()))


def paper_exts(spec: dict | None) -> list[str]:
    """cndPaperExts_."""
    if spec and spec.get("pdf"):
        return ["pdf"]
    return list(CND_PAPER_EXTS) + (list(CND_WORD_TYPES) if spec and spec.get("word") else [])


def step_paper(ctx: dict, item: dict, catalog: list[dict]) -> dict | None:
    """cndStepPaper_: what a checklist step takes as a paper, or None."""
    spec = CND_STEP_PAPERS.get(gsjs.or_blank(item.get("id")))
    if not spec or ctx["archived"]:
        return None
    signed = packet_signed(ctx["row"])
    if item.get("id") == "new-hire-packet" and signed:
        held = {spec["doc"]: True}
        for c in ctx["row"].get("checklist") or []:
            own = CND_STEP_PAPERS.get(gsjs.or_blank(c.get("id")))
            if own and own.get("doc") and open_item(c):
                held[own["doc"]] = True
        choices = [{"doc_id": c["doc_id"], "label": c["label"], "expects": expects(CND_PAPER_KINDS.get(c["doc_id"]))}
                   for c in catalog or [] if not held.get(c["doc_id"])]
        return {"asks": "The new hire's documents", "expects": "", "where": CND_WHERE["onboarding"], "pdf_only": False,
                "exts": paper_exts(None), "statuses": [], "choices": choices} if choices else None
    if not open_item(item):
        return None
    label = spec.get("label")
    for c in catalog or []:
        if spec["doc"] and c["doc_id"] == spec["doc"]:
            label = c["label"]
    where = CND_WHERE["hiring"] if not spec["doc"] else (
        (CND_WHERE["both"] if signed else CND_WHERE["hiring"]) if item.get("id") == "cjis" else CND_WHERE["onboarding"])
    return {"asks": label or spec["doc"], "expects": expects(spec.get("kinds") or CND_PAPER_KINDS.get(spec["doc"])),
            "where": where, "pdf_only": bool(spec.get("pdf")), "exts": paper_exts(spec),
            "statuses": list(CND_CJIS_STATUSES) if item.get("id") == "cjis" else [], "choices": []}


def dues(reads: L.Reads, ctx: dict) -> dict[str, str]:
    """cndDues_: the day each open item falls due."""
    row, out = ctx["row"], {}
    win = row.get("onboardingWindow")
    until = iso_day(win["until"]) if win and win.get("until") else ""
    if until and row.get("stage") == "onboarding":
        out["new-hire-packet"] = until
        out["onboarding-complete"] = until
    if row.get("stage") == "interview":
        iv = interview_for(reads, ctx["key"])
        when = iso_day(iv.get("scheduledfor")) if iv and s_(iv.get("scheduledfor")) else ""
        if when:
            out["interview-scorecard"] = when
            out["interview-recommendation"] = when
    return out


def stage_moves(ctx: dict, g: dict | None) -> list[dict]:
    """cndStageMoves_: where the card may go from here, and out of the process."""
    stage = ctx["row"].get("stage")
    moves = []
    for s in TALENT_STAGE_ORDER:
        o: dict[str, Any] = {"id": s, "label": stage_label(s), "current": s == stage, "reachable": False, "door": None,
                             "why": ""}
        if o["current"]:
            moves.append(o)
            continue
        if ctx["archived"]:
            o["why"] = "This candidate is out of the Hiring pipeline."
        elif not g:
            o["why"] = "The stage gate could not be read just now."
        elif s != g.get("to"):
            o["why"] = ("The Hiring pipeline moves one stage at a time — from " + stage_label(stage)
                        + " the next stage is " + stage_label(g.get("to")) + ".") if g.get("to") in TALENT_STAGE_ORDER \
                else ("From " + stage_label(stage) + " the next step is " + "; ".join(g.get("reasons") or []) + ".")
        elif stage == "onboarding":
            o["reachable"] = True
            o["door"] = {"action": "onboardingManualComplete", "form": "notes", "payload": {"candidate_id": ctx["key"]}}
            o["why"] = "Onboarding is completed with Manual onboarding, which records who attests it and when."
        else:
            o["reachable"] = bool(g.get("ok"))
            if g.get("ok"):
                o["door"] = {"action": "moveStage", "form": "", "payload": {"candidate_id": ctx["key"], "to_stage": s}}
            else:
                o["why"] = "Still needed: " + "; ".join(g.get("reasons") or []) + "."
        moves.append(o)
    moves.append({"id": "not-hiring", "label": "Not hiring", "current": False, "reachable": not ctx["archived"],
                  "door": None if ctx["archived"] else {"action": "hiringDiscard", "form": "reason",
                                                         "payload": {"candidate_id": ctx["key"]}},
                  "why": "This candidate is out of the Hiring pipeline." if ctx["archived"]
                  else "Takes them out of the process; the reason is required and the team is told."})
    return moves


def actions_build(reads: L.Reads | L.Session, ctx: dict) -> dict[str, Any]:
    """cndActionsBuild_: the Hiring checklist, its next step, each open item's door and where the card may move."""
    reads = reads_of(reads)
    row, sink = ctx["row"], {"why": [], "degraded": False}
    steps = next_steps(row)
    head_id = steps["head"].get("id") if steps["head"] else ""
    due_map, why_d = soft(lambda: dues(reads, ctx))
    if why_d:
        sink["why"].append(why_of("The interview date", why_d))
        sink["degraded"] = True
        due_map = {}
    today = reads.today()
    catalog: list[dict] | None = None

    def paper_of(c: dict) -> dict | None:
        nonlocal catalog
        if gsjs.or_blank(c.get("id")) not in CND_STEP_PAPERS or ctx["archived"]:
            return None
        if catalog is None:
            got, why_c = soft(lambda: catalog_of(reads))
            if why_c:
                catalog = []
                sink["why"].append(why_of("The document catalog", why_c))
                sink["degraded"] = True
            else:
                catalog = got
        return step_paper(ctx, c, catalog)

    items = []
    for c in row.get("checklist") or []:
        opened = open_item(c)
        due = (due_map or {}).get(c.get("id"), "") if opened else ""
        door = door_of(ctx, c) if opened else {"door": None, "why": ""}
        items.append({"id": s_(c.get("id")), "label": s_(c.get("label")), "status": s_(c.get("status")), "open": opened,
                      "owner": s_(c.get("owner")), "stage": s_(c.get("stage")), "stage_label": stage_label(c.get("stage")),
                      "in_phase": c.get("stage") == row.get("stage"), "is_next": c.get("id") == head_id, "due": due,
                      "due_state": due_state(due, today), "complete": door["door"], "complete_why": door["why"],
                      "skipped_by": s_(c.get("skippedBy")), "paper": paper_of(c)})
    g = None
    if not ctx["archived"]:
        g, why_g = soft(lambda: stage_gate(reads, evidence(reads, ctx["key"])))
        if why_g:
            g = None
            sink["why"].append(why_of("The stage gate", why_g))
            sink["degraded"] = True
    return {"stage": s_(row.get("stage")), "stage_label": stage_label(row.get("stage")), "archived": ctx["archived"],
            "items": items, "next": next((i for i in items if i["is_next"]), None),
            "open": sum(1 for i in items if i["open"]), "attention": attention(row), "status": status_word(row, steps),
            "gate": {"from": s_(g.get("from")), "to": s_(g.get("to")), "ok": bool(g.get("ok")),
                     "reasons": g.get("reasons") or []} if g else None,
            "stages": stage_moves(ctx, g), "why": sink["why"], "degraded": sink["degraded"]}


def actions_part(reads: L.Reads, ctx: dict) -> Any:
    return data_of(reads, "candidateProfileActions", ctx, lambda: actions_build(reads, ctx))


# ---- interviews ------------------------------------------------------------------------------------------------------

def ask_for(reads: L.Reads, key: str) -> dict | None:
    """cndAskFor_: the candidate's interview ask (last wins)."""
    hit = None
    for a in ask_rows(reads):
        if s_(a.get("candidateid")) == key:
            hit = a
    return hit


def yes_no(v: Any) -> str:
    """spYesNo_."""
    return SC._yes_no(v)


def preferences(s: dict, a: dict, ob: dict | None) -> dict[str, Any]:
    """cndPreferences_."""
    def yes(v: Any) -> bool:
        return yes_no(v) == "yes"

    shifts = [w for w, k in (("Day", "shiftday"), ("Afternoon", "shiftafternoon"), ("Night", "shiftnight")) if yes(s.get(k))]
    hours = [w for w, k in (("Full time", "hoursft"), ("Part time", "hourspt"), ("PRN", "hoursprn")) if yes(s.get(k))]
    return {"shifts": shifts, "hours": hours, "every_other_weekend": yes_no(s.get("everyotherweekend")),
            "male_care": yes_no(s.get("malecare")), "behavioral_care": yes_no(s.get("behavioralcare")),
            "drivers_license": yes_no(s.get("hasdl")), "vehicle": yes_no(s.get("hasvehicle")),
            "insurance": yes_no(s.get("hasinsurance")),
            "certificates": {"dodd": yes_no(s.get("certdodd")), "cpr_first_aid": yes_no(s.get("certcprfirstaid")),
                             "med_del": yes_no(s.get("certmeddel"))},
            "best_in_person": s_(s.get("bestinpersondaytime")), "availability": s_(a.get("scheduleavailability")),
            "earliest_start": iso_day(ob.get("earliest_start_date")) if ob else "",
            "preferred_location": s_(ob.get("house")) if ob else ""}


def slot_of(v: Any) -> dict[str, str]:
    """cndSlot_: a slot as the Ohio day and clock it names."""
    s = s_(v)
    m = re.match(r"^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?", s, _A)
    if not m:
        return {"day": iso_day(s), "time": ""}
    if re.search(r"T\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})\Z", s, _A):
        t = js_date_ms(s)
        if t is not None:
            return {"day": iso_day(s),
                    "time": datetime.fromtimestamp(t / 1000.0, timezone.utc).astimezone(NY).strftime("%H:%M")}
    return {"day": m.group(1), "time": (("0" + m.group(2)) if len(m.group(2)) == 1 else m.group(2)) + ":" + m.group(3)
            if m.group(2) else ""}


def hiring_date(v: Any) -> str:
    """hiringDateText_."""
    m = re.match(r"^\d{4}-\d{2}-\d{2}", s_(v), _A)
    return m.group(0) if m else ""


def hiring_time(v: Any) -> str:
    """hiringTimeText_."""
    m = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)", s_(v), _A)
    if not m:
        return ""
    return ("0" + m.group(1) if len(m.group(1)) == 1 else m.group(1)) + ":" + m.group(2)


def interview_event(reads: L.Reads, key: str) -> dict | None:
    """cndInterviewEvent_: the latest in-person interview on the hiring calendar, or None."""
    hit = None
    for r in tab_rows(reads, HIRING_EVENTS_TAB):
        if s_(r.get("candidate_id")) != key or s_(r.get("event_type")) != "in_person_interview":
            continue
        if s_(r.get("status")).lower() == "cancelled":
            continue
        hit = r
    if not hit:
        return None
    return {"day": hiring_date(hit.get("date")), "time": hiring_time(hit.get("time")),
            "location": text(hit.get("location"), 160), "with_name": text(hit.get("with_name"), 120)}


def interviews_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """cndInterviewsBuild_: the phone screen, the structured interview and the onboarding handoff."""
    row, sink = ctx["row"], {"why": [], "degraded": False}
    ev = ev_or(reads, ctx, sink)
    x = extras(reads, ctx, ev)
    ask, why_a = soft(lambda: ask_for(reads, ctx["key"]))
    if why_a:
        ask = None
        sink["why"].append(why_of("The interview asks", why_a))
        sink["degraded"] = True
    booked, why_e = soft(lambda: interview_event(reads, ctx["key"]))
    if why_e:
        booked = None
        sink["why"].append(why_of("The hiring calendar", why_e))
        sink["degraded"] = True
    s, a, iv, ob = ev.get("screen"), ev.get("analysis") or {}, x["interview"], x["onboarding"]
    at = TALENT_STAGE_ORDER.index(row.get("stage")) if row.get("stage") in TALENT_STAGE_ORDER else -1
    screen_done = bool(s) and (s_(s.get("screenstatus")).lower() == "completed"
                               or s_(s.get("manualscreen")).lower() == "true")
    screen = {"id": "phone_screen", "title": "Phone screen",
              "date": (iso_day(s.get("screendate")) or iso_day(s.get("transcriptcreated"))) if s else "",
              "owner": by_of(s.get("screenedby")) if s else "",
              "status": "completed" if screen_done else ("awaiting_confirmation" if s else "pending"),
              "result": " · ".join(x2 for x2 in (s_(s.get("finalresult")) or ("Decision pending" if screen_done else ""),
                                                 s_(s.get("qualification"))) if x2) if s else "",
              "comments": s_(s.get("notes")) if s else ""}
    scored = bool(iv) and bool(s_(iv.get("interviewer_name"))) and s_(iv.get("score")) != ""
    slot = ""
    if ask:
        slot = (s_(ask.get("confirmeddate")) + " " + s_(ask.get("confirmedtime"))) if s_(ask.get("confirmeddate")) \
            else ((s_(ask.get("pickeddate")) + " " + s_(ask.get("pickedtime"))) if s_(ask.get("pickeddate")) else "")
    iv_date = (s_(iv.get("scheduled_for")) if iv else "") or gsjs.trim(slot)
    in_flight = bool(iv_date) or bool(ask and s_(ask.get("state"))) or bool(booked)
    when = slot_of(iv_date)
    if booked and booked["day"] and (not when["day"] or (when["day"] == booked["day"] and not when["time"])):
        when = {"day": booked["day"], "time": booked["time"]}
    interview = {
        "id": "interview", "title": "Structured interview",
        "date": (iso_day(iv_date) or iv_date) if iv_date else when["day"],
        "owner": s_(iv.get("interviewer_name")) if iv else "",
        "status": "completed" if scored else ("awaiting_confirmation" if in_flight else "pending"),
        "detail": "" if scored else ("The slot is not confirmed yet." if ask and s_(ask.get("state"))
                                     and s_(ask.get("state")) != "confirmed"
                                     else ("Booked — the scorecard completes it." if iv_date or booked else "")),
        "result": " · ".join(x2 for x2 in (s_(iv.get("recommendation")),
                                           "score " + s_(iv.get("score")) + "/" + str(INTERVIEW_SCORE_MAX)) if x2)
        if scored else "",
        "comments": s_(iv.get("comments")) if iv else "", "day": when["day"], "time": when["time"],
        "interviewed_at": s_(iv.get("interviewed_at")) if iv else "", "score": s_(iv.get("score")) if iv else "",
        "score_max": INTERVIEW_SCORE_MAX, "recommendation": s_(iv.get("recommendation")) if iv else "",
        "with_name": booked["with_name"] if booked else "", "location": booked["location"] if booked else ""}
    ob_done = at > TALENT_STAGE_ORDER.index("onboarding") or bool(ob and ob.get("questionnaire_done")
                                                                   and ob.get("tutorials_done"))
    raw = ev.get("cand") or {}
    handoff = {"id": "onboarding", "title": "Onboarding handoff",
               "date": (iso_day(ob.get("start_date")) or iso_day(ob.get("date_moved"))) if ob else "",
               "owner": by_of(raw.get("manualonboardingby")),
               "status": "completed" if ob_done else ("awaiting_confirmation" if row.get("stage") == "onboarding"
                                                      else "pending"),
               "result": " · ".join(x2 for x2 in ("Questionnaire done" if ob.get("questionnaire_done") else "",
                                                  "Tutorials done" if ob.get("tutorials_done") else "",
                                                  "Attested by e-mail" if s_(raw.get("manualonboardingmethod"))
                                                  == "attested" else "") if x2) if ob else "",
               "comments": s_(ob.get("notes")) if ob else ""}
    try:
        answers = heard_on_calls(reads, ctx)
    except Exception as exc:  # noqa: BLE001 - what a call said is an extra: the record's preferences stand alone
        answers = []
        log.info("candidate %s: the calls' preferences were not read (%s)", ctx["key"], _why(exc))
    prefs, from_call = CP.overlay(preferences(s or {}, a, ob), answers)
    files, why_f = soft(lambda: hiring_docs(reads, ctx["key"]))
    if why_f:
        sink["why"].append(why_of("The hiring documents", why_f))
        sink["degraded"] = True
    prefs, on_file = papers_on_file(prefs, files or {})
    return {"plan": [screen, interview, handoff], "preferences": prefs, "from_call": from_call, "on_file": on_file,
            "why": sink["why"], "degraded": sink["degraded"]}


# the preferences a filed paper answers: the certificate itself, the driver's license itself
PREF_PAPERS = {"dodd": "dodd_8hr", "cpr_first_aid": "cpr_first_aid", "med_del": "med_del"}
PREF_LICENSE_PAPER = "drivers_id"


def papers_on_file(prefs: dict[str, Any], files: dict[str, dict]) -> tuple[dict[str, Any], list[str]]:
    """The preferences as the filed papers (Documents) prove them: a certificate or a license on file answers Yes, and
    the lines a paper answers are named so the screen says the paper is on file."""
    def here(doc: str) -> bool:
        return gsjs.or_text((files.get(doc) or {}).get("status")).lower() in ("uploaded", "verified")

    out, lines = dict(prefs), []
    certs = dict(out.get("certificates") or {})
    held = [k for k, doc in PREF_PAPERS.items() if here(doc)]
    for k in held:
        certs[k] = "yes"
    out["certificates"] = certs
    if held:
        lines.append("certificates")
    if here(PREF_LICENSE_PAPER):
        out["drivers_license"] = "yes"
        lines.append("drivers_license")
    return out, lines


def heard_on_calls(reads: L.Reads, ctx: dict) -> list[dict[str, Any]]:
    """What the candidate's newest calls said, as the lane read it (app.candidate_call_prefs), newest first; a call
    the lane has not been asked about is owed to it with the two inboxes' copies (commCallsTranscriptRead_'s)."""
    calls = transcripts_part(reads, ctx).get("calls") or []
    ids = [s_(c.get("call_id")) for c in calls if s_(c.get("call_id")) and c.get("call_id") != "screen"][:CP.CALLS_CAP]
    kept = CP.kept(reads, ids)
    owed = [cid for cid in ids if cid not in kept]
    if owed:
        hot_id = s_(reads.db.prop("HOTLINE_TRANSCRIPTS_ID"))
        refs = [reads.db.resolve(SC.QUO_TRANSCRIPTS_TAB).ref,
                reads.tab_of(hot_id, SC.HOTLINE_TRANSCRIPTS_TAB, "the hotline transcripts") if hot_id else None]
        CP.owe(ctx["key"], owed, [[r.sheet_id, r.tab] for r in refs if r is not None])
    return [p for p in (kept.get(cid) for cid in ids) if p]


def interviews_part(reads: L.Reads, ctx: dict) -> Any:
    return data_of(reads, "candidateProfileInterviews", ctx, lambda: interviews_build(reads, ctx))


# ---- documents -------------------------------------------------------------------------------------------------------

def docs_rows(reads: L.Reads) -> list[dict]:
    """cndDocsRows_: the hiring documents' rows; [] while the tab is unborn."""
    return tab_rows(reads, DOCS_TAB)


def hiring_docs(reads: L.Reads, key: str) -> dict[str, dict]:
    """cndHiringDocs_: the latest, not superseded, document row per catalog id."""
    out: dict[str, dict] = {}
    for r in docs_rows(reads):
        if gsjs.or_text(r.get("candidate_id")) != key or gsjs.or_text(r.get("superseded_by")):
            continue
        did = gsjs.or_text(r.get("doc_id"))
        if did:
            out[did] = r
    return out


def doc_catalog_rows(reads: L.Reads) -> list[dict]:
    """The document catalog's rows off its own table, a whole number in renewal_months or sort read as one."""
    import sheet_resources as SR  # noqa: PLC0415 - it imports this module

    out = []
    for r in SR.rows(reads, DOC_CATALOG_RESOURCE):
        row = dict(r)
        for k in ("renewal_months", "sort"):
            v = gsjs.trim(gsjs.or_text(row.get(k)))
            if re.fullmatch(r"-?\d+", v):
                row[k] = int(v)
        out.append(row)
    return out


def catalog_of(reads: L.Reads) -> list[dict]:
    """cndCatalog_: the document catalog as the Hiring app keeps it, else its shipped copy."""
    def read() -> list[dict]:
        rows = [r for r in doc_catalog_rows(reads) if gsjs.trim(gsjs.or_text(r.get("doc_id")))]
        if not rows:
            rows = [dict(r) for r in DOC_CATALOG_DEFAULT]
        out = []
        for r in rows:
            srt = js_number(r.get("sort"))
            out.append({"doc_id": gsjs.trim(gsjs.js_str(r.get("doc_id"))),
                        "label": text(r.get("label"), 120) or gsjs.js_str(r.get("doc_id")),
                        "required": r.get("required") is True or gsjs.or_blank(r.get("required")).lower() == "yes",
                        "sort": srt if math.isfinite(srt) and srt else 99})
        out.sort(key=lambda c: c["sort"])
        for c in out:
            if isinstance(c["sort"], float) and c["sort"] == int(c["sort"]):
                c["sort"] = int(c["sort"])
        return out
    return reads.once("cnd_catalog", read)


def application_file(reads: L.Reads, srid: str) -> str:
    """cndApplicationFile_: the Drive copy of a signed application the Hiring app already fetched."""
    if not srid:
        return ""
    fid = ""
    for r in tab_rows(reads, RECRUIT_DOCS_TAB):
        if gsjs.trim(gsjs.or_text(r.get("signature_request_id"))) == srid:
            fid = L.drive_id(r.get("doc_url")) or fid
    return fid


def onboarding_doc_index(reads: L.Reads) -> dict[str, dict[str, dict]]:
    """onboardingDocIndex_: the latest non-superseded document row per candidate and catalog id."""
    hdr_raw, values = shim(reads, DOCS_TAB)
    hdr = [gsjs.trim(h) for h in hdr_raw]

    def at(n: str) -> int:
        return hdr.index(n) if n in hdr else -1

    i_cid, i_doc, i_status, i_sup, i_exp, i_url = (at("candidate_id"), at("doc_id"), at("status"), at("superseded_by"),
                                                   at("expires_on"), at("file_url"))

    def cell(line: list[str], i: int) -> str:
        return line[i] if 0 <= i < len(line) else ""

    out: dict[str, dict[str, dict]] = {}
    for line in values:
        cid = gsjs.trim(cell(line, i_cid))
        if not cid:
            continue
        if i_sup != -1 and gsjs.trim(cell(line, i_sup)):
            continue
        out.setdefault(cid, {})[gsjs.trim(cell(line, i_doc))] = {
            "status": gsjs.trim(cell(line, i_status)), "expires_on": "" if i_exp == -1 else s_(cell(line, i_exp)),
            "file_url": "" if i_url == -1 else s_(cell(line, i_url))}
    return out


def onboarding_stage_of(status: Any, docs: dict, start_date: Any) -> str:
    """onboardingStageOf_."""
    def have(i: str) -> bool:
        d = docs.get(i)
        return bool(d) and d.get("status") in ("uploaded", "verified")

    if gsjs.js_str(status).lower() == "hired":
        return "ready"
    identity = have("drivers_id") and have("ss_birth")
    training = have("dodd_8hr") and have("cpr_first_aid")
    if identity and training and have("background_check") and s_(start_date):
        return "ready"
    if identity and have("background_check"):
        return "training"
    if have("background_check"):
        return "documents"
    if have("dropbox_packet"):
        return "background"
    return "packet"


def onboarding_checklist(docs: dict, stage: str, cjis: Any, packet: dict | None, certs: dict) -> list[dict]:
    """onboardingChecklist_: the tracker's twelve rows, each a reading."""
    depth = ONB_STAGES.index(stage) if stage in ONB_STAGES else -1
    out = []
    for row in ONB_CHECKLIST:
        status, label = "pending", row["label"]
        if row["doc"]:
            d = docs.get(row["doc"])
            if d and d.get("status") == "verified":
                status = "done"
            elif d and d.get("status") == "uploaded":
                status = "auto"
            elif d and d.get("status") == "returned":
                status = "missing"
            else:
                status = "missing" if ONB_STAGES.index(row["stage"]) <= depth else "pending"
            if row["id"] == "background-check" and status != "done":
                if gsjs.or_text(cjis).lower() in ("clear", "verified"):
                    status = "done"
            if row["id"] == "new-hire-packet" and packet:
                if packet.get("state") == "signed":
                    status, label = "done", label + " — signed in Dropbox Sign"
                elif packet.get("state") == "waived":
                    status, label = "done", label + " — signed copy on file"
                elif packet.get("state") == "unsigned":
                    status, label = "missing", label + " — sent, not signed yet"
                elif packet.get("state") == "ambiguous" and status != "done":
                    label += " — more than one envelope matches"
                elif status not in ("done", "auto"):
                    label += " — no envelope found"
            cred_key = ONB_CERT_ROWS.get(row["id"])
            if cred_key and certs and certs.get(cred_key) and status != "done":
                cred = certs[cred_key]
                if cred.get("status") == "valid":
                    status = "done"
                    label += (" — valid to " + gsjs.js_str(cred["expires"])) if cred.get("expires") else " — on file"
                elif cred.get("status") == "expiring":
                    status = "done"
                    label += " — expires " + (gsjs.js_str(cred["expires"]) if cred.get("expires") else "soon")
                elif cred.get("status") == "expired":
                    status = "missing"
                    label += " — EXPIRED " + (gsjs.js_str(cred["expires"]) if cred.get("expires") else "")
        elif row["id"] == "dropbox-link":
            status = "auto" if docs.get("__folder") else "pending"
        out.append({"id": row["id"], "label": label, "status": status, "owner": row["owner"], "stage": row["stage"]})
    return out


def onboarding_list(reads: L.Reads, ctx: dict, ev: dict, ob: dict | None) -> list[dict] | None:
    """cndOnboardingChecklist_: the Onboarding app's twelve rows for this candidate."""
    c = ev.get("cand")
    if not c:
        return None
    docs = dict(onboarding_doc_index(reads).get(ctx["key"]) or {})
    if s_(c.get("docsfolderid")):
        docs["__folder"] = True
    stage = onboarding_stage_of(c.get("status"), docs, ob.get("start_date") if ob else "")
    packet, _w = soft(lambda: packet_state(reads, c))
    certs: dict = {}

    def pic() -> dict:
        import staff as SP  # noqa: PLC0415 - the Staff core reads the certificates
        k = gsjs.name_key(s_(c.get("candidatename")))
        got = SP.cert_picture(reads, k) if k else None
        return (got or {}).get("certs") or {}
    got, _w2 = soft(pic)
    certs = got or {}
    return onboarding_checklist(docs, stage, (ev.get("analysis") or {}).get("cjisstatus"), packet, certs)


def documents_build(reads: L.Reads | L.Session, ctx: dict) -> dict[str, Any]:
    """cndDocumentsBuild_: the application and resume, the interview papers, the background check, the onboarding."""
    reads = reads_of(reads)
    row, sink, docs = ctx["row"], {"why": [], "degraded": False}, []
    ev = ev_or(reads, ctx, sink)
    x = extras(reads, ctx, ev)
    a = ev.get("analysis") or {}
    files, why_f = soft(lambda: hiring_docs(reads, ctx["key"]))
    if why_f:
        files = {}
        sink["why"].append(why_of("The hiring documents", why_f))
        sink["degraded"] = True

    def file_of(r: dict | None) -> str:
        return (gsjs.or_text(r.get("file_id")) or L.drive_id(r.get("file_url"))) if r else ""

    def here(r: dict | None) -> bool:
        return gsjs.or_text((r or {}).get("status")).lower() in ("uploaded", "verified")

    def upload(item_id: str, doc_id: str) -> dict | None:
        if ctx["archived"]:
            return None
        p = {"candidate_id": ctx["key"], "item_id": item_id}
        if doc_id:
            p["doc_id"] = doc_id
        return {"action": "tableDocUpload", "form": "upload", "payload": p}

    def item(i: str) -> dict | None:
        return next((c for c in row.get("checklist") or [] if c.get("id") == i), None)

    app = row.get("application")
    if app and s_(app.get("srid")):
        signed = s_(app.get("status")).lower() == "signed"
        app_file, why_a = soft(lambda: application_file(reads, s_(app.get("srid"))))
        if why_a:
            app_file = ""
            sink["why"].append(why_of("The fetched applications", why_a))
        docs.append({"id": "application", "title": "Application", "group": "application",
                     "status": "on_file" if signed else "pending",
                     "date": iso_day(app.get("signedAt") or app.get("appliedAt")), "expires": "", "file_id": app_file,
                     "mime": "application/pdf" if app_file else "", "srid": s_(app.get("srid")) if signed else "",
                     "source": "Dropbox Sign", "verified": False, "upload": None})
    resume_id = L.drive_id(row.get("resumeLink"))
    resume_item = item("resume")
    resume_here = bool(s_(row.get("resumeLink"))) or (bool(resume_item) and resume_item.get("status") in ("done", "auto"))
    docs.append({"id": "resume", "title": "Resume", "group": "application",
                 "status": "on_file" if resume_here else "pending", "date": iso_day(a.get("analyzedat")), "expires": "",
                 "file_id": resume_id, "mime": "", "url": "" if resume_id else s_(row.get("resumeLink")),
                 "source": "Hiring", "verified": False, "upload": None if resume_here else upload("resume", "")})
    s = ev.get("screen")
    if s:
        report = L.drive_id(s.get("phonescreenreporturl"))
        docs.append({"id": "screen_report", "title": "Phone screen report", "group": "interview",
                     "status": "on_file" if report else "pending", "date": iso_day(s.get("screendate")), "expires": "",
                     "file_id": report, "mime": "", "source": "Phone screen", "verified": False, "upload": None})
    iv = x["interview"]
    scored = bool(iv) and bool(s_(iv.get("interviewer_name"))) and s_(iv.get("score")) != ""
    docs.append({"id": "interview_notes", "title": "Interview notes", "group": "interview",
                 "status": "on_file" if scored else "pending",
                 "date": (iso_day(iv.get("interviewed_at")) or iso_day(iv.get("scheduled_for"))) if iv else "",
                 "expires": "", "file_id": "", "mime": "", "source": "Interview scorecard", "verified": False,
                 "upload": None,
                 "record": {"interviewer": s_(iv.get("interviewer_name")), "score": s_(iv.get("score")),
                            "recommendation": s_(iv.get("recommendation")), "comments": s_(iv.get("comments")),
                            "interviewed_at": s_(iv.get("interviewed_at"))} if scored else None})
    cj = files.get("background_check") if files.get("background_check") and here(files.get("background_check")) else None
    cj_file = file_of(cj) or L.drive_id(a.get("cjisreporturl"))
    cleared = cjis_cleared(a)
    cj_here = cleared or bool(cj_file)
    docs.append({"id": "cjis", "title": "Background check (CJIS)", "group": "screening",
                 "status": "on_file" if cj_here else "pending", "result": s_(a.get("cjisstatus")),
                 "date": iso_day(cj.get("uploaded_at")) if cj else "", "expires": "", "file_id": cj_file,
                 "mime": s_(cj.get("mime_type")) if cj else "", "source": "Hiring", "verified": cleared,
                 "upload": None if cj_here else upload("cjis", "")})
    reached = row.get("stage") in CND_ONBOARDING_STAGES
    signed_packet = packet_signed(row)
    for c in catalog_of(reads):
        if c["doc_id"] == "background_check":
            continue
        r = files.get(c["doc_id"]) if files.get(c["doc_id"]) and here(files.get(c["doc_id"])) else None
        by_envelope = c["doc_id"] == "dropbox_packet" and signed_packet
        if not reached and not r:
            continue
        on_file = bool(r) or by_envelope
        docs.append({"id": "doc_" + c["doc_id"], "doc_id": c["doc_id"], "title": c["label"], "group": "onboarding",
                     "status": "on_file" if on_file else "pending", "required": c["required"],
                     "date": (iso_day(r.get("issued_on")) or iso_day(r.get("uploaded_at"))) if r else "",
                     "expires": iso_day(r.get("expires_on")) if r else "", "file_id": file_of(r),
                     "mime": s_(r.get("mime_type")) if r else "",
                     "source": "Onboarding documents" if r else ("Dropbox Sign" if by_envelope else "Onboarding documents"),
                     "verified": bool(r) and gsjs.js_str(r.get("status")).lower() == "verified",
                     "upload": None if on_file else upload(CND_ITEM_OF_DOC.get(c["doc_id"]) or c["doc_id"], c["doc_id"])})
    if reached:
        lst, why_o = soft(lambda: onboarding_list(reads, ctx, ev, x["onboarding"]))
        if why_o:
            sink["why"].append(why_of("The onboarding checklist", why_o))
            sink["degraded"] = True
        elif lst:
            docs.append({"id": "onboarding_checklist", "title": "Onboarding checklist", "group": "onboarding",
                         "status": "on_file" if all(i["status"] in ("done", "auto") for i in lst) else "pending",
                         "date": "", "expires": "", "file_id": "", "mime": "", "source": "Onboarding", "verified": False,
                         "upload": None, "items": lst})
    on_file_n = sum(1 for d in docs if d["status"] == "on_file")
    return {"docs": docs, "counts": {"total": len(docs), "on_file": on_file_n,
                                     "with_file": sum(1 for d in docs if d.get("file_id"))},
            "why": sink["why"], "degraded": sink["degraded"]}


def documents_part(reads: L.Reads, ctx: dict) -> Any:
    return data_of(reads, "candidateProfileDocuments", ctx, lambda: documents_build(reads, ctx))


# ---- activity --------------------------------------------------------------------------------------------------------

def status_history(reads: L.Reads, key: str) -> list[dict]:
    """cndStatusHistory_: the candidate's stage moves, as every status write files them."""
    return [{"at": s_(h.get("timestamp")), "from": s_(h.get("fromstatus")), "to": s_(h.get("tostatus")),
             "by": s_(h.get("actor"))} for h in status_rows(reads) if s_(h.get("candidateid")) == key]


def activity_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """cndActivityBuild_: every hiring step, note and stage move, newest first."""
    sink, items = {"why": [], "degraded": False}, []
    journey = journey_for(reads, ctx["key"])
    if journey is None:
        sink["why"].append("The hiring journey could not be read, so its steps are not listed.")
        sink["degraded"] = True
    moves = []
    for j in journey or []:
        ref, kind = s_(j.get("ref")), "note" if j.get("step") == "note" else "step"
        if j.get("step") == CND_PRESS_STEP:
            kind = "stage" if ref.startswith("stage:") else ("document" if ref.startswith(("upload:", "document:"))
                                                             else "record")
            if kind == "stage":
                moves.append({"to": ref[6:], "at": js_date_ms(s_(j.get("at"))) or 0})
        items.append({"id": "jrn_" + s_(j.get("id")), "at": s_(j.get("at")), "kind": kind, "step": s_(j.get("step")),
                      "title": s_(j.get("title")) or s_(j.get("step")), "body": text(j.get("detail"), 900),
                      "channel": s_(j.get("channel")), "ok": j.get("ok") is not False, "rehearsal": bool(j.get("rehearsal")),
                      "by": by_of(j.get("by"))})

    def echo(h: dict) -> bool:
        to = stage_of(h["to"]) or re.sub(r"[^a-z]+", "-", s_(h["to"]).lower())
        at = js_date_ms(h["at"]) or 0
        return any(m["to"] == to and abs(m["at"] - at) <= CND_PRESS_ECHO_MS for m in moves)

    def history() -> None:
        for i, h in enumerate(status_history(reads, ctx["key"])):
            if echo(h):
                continue
            frm, to = stage_of(h["from"]), stage_of(h["to"])
            items.append({"id": f"stage_{i + 1}", "at": h["at"], "kind": "stage", "step": "stage",
                          "title": "Stage: " + (stage_label(frm) if frm else (h["from"] or "New")) + " → "
                          + (stage_label(to) if to else h["to"]),
                          "body": "", "channel": "", "ok": True, "rehearsal": False, "by": by_of(h["by"])})
    _ok, why_h = soft(history)
    if why_h:
        sink["why"].append(why_of("The stage history", why_h))
        sink["degraded"] = True
    items.sort(key=_cmp(_newest))
    return {"items": items[:CND_ACTIVITY_CAP], "total": len(items), "why": sink["why"], "degraded": sink["degraded"]}


def activity_part(reads: L.Reads, ctx: dict) -> Any:
    return data_of(reads, "candidateProfileActivity", ctx, lambda: activity_build(reads, ctx))


# ---- overview --------------------------------------------------------------------------------------------------------

def overview_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """cndOverviewBuild_: at a glance, information, the counts, the next step and the recent activity."""
    row, sink = ctx["row"], {"why": [], "degraded": False}
    ev = ev_or(reads, ctx, sink)
    x = extras(reads, ctx, ev)
    a, ob = ev.get("analysis") or {}, x["onboarding"]

    def part(what: str, get: Callable[[], Any]) -> Any:
        d, why = soft(get)
        if why:
            sink["why"].append(why_of(what, why))
            sink["degraded"] = True
            return None
        for w in d.get("why") or []:
            if w not in sink["why"]:
                sink["why"].append(w)
        if d.get("degraded"):
            sink["degraded"] = True
        return d

    actions = part("The hiring actions", lambda: actions_part(reads, ctx))
    docs = part("The documents", lambda: documents_part(reads, ctx))
    activity = part("The activity", lambda: activity_part(reads, ctx))
    years = s_(a.get("totalyearscaregiving"))
    das = row.get("daysAtStage")
    candidate = {
        "key": ctx["key"], "name": ctx["name"], "position": s_(row.get("role")) or "Direct Support Professional",
        "stage": s_(row.get("stage")), "stage_label": stage_label(row.get("stage")),
        "status_label": (s_(row.get("status")) or "Archived") if ctx["archived"] else stage_label(row.get("stage")),
        "archived": ctx["archived"], "archived_reason": s_(row.get("archived_reason")) if ctx["archived"] else "",
        "location": ", ".join(v for v in (s_(row.get("city")), s_(row.get("state"))) if v),
        "recruiter": by_of(row.get("owner")), "source": s_(row.get("source")), "applied_at": iso_day(row.get("appliedAt")),
        "phone": s_(row.get("phone")), "email": s_(row.get("email")),
        "avatar": P.of(reads, "candidates", ctx["key"], row.get("avatar")),
        "days_at_stage": das if das is not None else None}
    nxt = actions.get("next") if actions else None
    return {
        "candidate": candidate,
        "information": {
            "full_name": ctx["name"], "stage_label": candidate["status_label"], "phone": candidate["phone"],
            "email": candidate["email"], "source": candidate["source"], "applied_at": candidate["applied_at"],
            "position": candidate["position"], "availability": s_(a.get("scheduleavailability")),
            "experience": years + " years caregiving" if years else s_(a.get("careexperience")),
            "preferred_location": s_(ob.get("house")) if ob else "",
            "earliest_start": (iso_day(ob.get("earliest_start_date")) or iso_day(ob.get("start_date"))) if ob else "",
            "recruiter": candidate["recruiter"]},
        "summary": s_(row.get("summary")) or s_(a.get("summary")),
        "tiles": {"stage_label": candidate["status_label"], "open_actions": actions["open"] if actions else None,
                  "docs_on_file": docs["counts"]["on_file"] if docs else None,
                  "docs_total": docs["counts"]["total"] if docs else None},
        "next": {"id": nxt["id"], "label": nxt["label"], "owner": nxt["owner"], "status": nxt["status"],
                 "due": nxt["due"], "due_state": nxt["due_state"]} if nxt else None,
        "attention": actions["attention"] if actions else [],
        "recent": activity["items"][:CND_RECENT] if activity else [],
        "why": sink["why"], "degraded": sink["degraded"]}


def overview_part(reads: L.Reads, ctx: dict) -> Any:
    return data_of(reads, "candidateProfileOverview", ctx, lambda: overview_build(reads, ctx))


# ---- texts and calls -------------------------------------------------------------------------------------------------

def phone_index(reads: L.Reads) -> dict[str, Any]:
    """cndPhoneIndex_: every phone the candidate rows carry, who carries it, and each candidate's names and e-mails."""
    def read() -> dict[str, Any]:
        out: dict[str, Any] = {"index": {}, "own": {}, "who": {}, "why": ""}

        def take(cid: str, v: Any, name: Any, email: Any) -> None:
            w = out["who"].setdefault(cid, {"names": {}, "emails": {}})
            if mark(name):
                w["names"][mark(name)] = True
            if mark(email):
                w["emails"][mark(email)] = True
            if not s_(v):
                return
            out["own"].setdefault(cid, []).append(s_(v))
            for d in SC._numbers(v):
                out["index"].setdefault(d, {})[cid] = True

        for r in board(reads)["rows"]:
            take(gsjs.js_str(r["id"]), r.get("phone"), r.get("name"), r.get("email"))

        def raw() -> None:
            for r in raw_rows(reads):
                if not s_(r.get("candidateid")):
                    continue
                take(s_(r.get("candidateid")), r.get("phone"),
                     s_(r.get("candidatename")) or (s_(r.get("firstname")) + " " + s_(r.get("lastname"))), r.get("email"))
        _ok, why = soft(raw)
        if why:
            out["why"] = ("the candidate records could not be read (" + why
                          + "), so a phone another candidate also carries is not known")
        return out
    return reads.once("cnd_phones", read)


def staff_ctx(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """cndStaffCtx_: the candidate in the shape the Staff app's text and call readers take."""
    found = phone_index(reads)
    mine = found["who"].get(ctx["key"]) or {"names": {}, "emails": {}}
    names, emails = dict(mine["names"]), dict(mine["emails"])
    if mark(ctx["name"]):
        names[mark(ctx["name"])] = True
    if mark(ctx["row"].get("email")):
        emails[mark(ctx["row"].get("email"))] = True

    def same(k: str) -> bool:
        w = found["who"].get(k)
        if not w:
            return False
        return any(names.get(n) for n in w["names"]) or any(emails.get(m) for m in w["emails"])

    shared: dict[str, dict] = {}
    for d in SC._js_keys(found["index"]):
        shared[d] = {k: True for k in SC._js_keys(found["index"][d]) if k == ctx["key"] or not same(k)}
    for d in SHARED_LINE_DIGITS:
        o = {"company": True}
        for k in SC._js_keys(shared.get(d) or {}):
            o[k] = True
        shared[d] = o
    return {"key": ctx["key"], "name": ctx["name"], "account": None, "master": None,
            "people": {"phone": s_(ctx["row"].get("phone")), "phones": found["own"].get(ctx["key"]) or [],
                       "email": s_(ctx["row"].get("email")), "emails": []},
            "phones_shared": shared, "why": found["why"]}


def staff_read(reads: L.Reads, ctx: dict, read: Callable[[L.Reads, dict], dict]) -> dict[str, Any]:
    """cndStaffRead_: a Staff reader's answer, with what the phone index could not say added to its why."""
    sctx = staff_ctx(reads, ctx)
    out = read(reads, sctx)
    if sctx["why"]:
        out["why"] = "; ".join(x for x in (out.get("why") or "", sctx["why"]) if x)
        out["degraded"] = True
    return out


def texts_facts(reads: L.Reads, ctx: dict) -> Any:
    """cndTextsFacts_."""
    return data_of(reads, "candidateProfileTexts", ctx, lambda: staff_read(reads, ctx, SC.texts_facts))


def texts_door(reads: L.Reads, ctx: dict, payload: dict) -> dict[str, Any]:
    """cndTextsDoor_: one page of one conversation, as the Staff app pages it."""
    f, why = soft(lambda: texts_facts(reads, ctx))
    if why:
        return {"status": 503, "message": f"The texts could not be read just now ({why})."}
    # each company line is named by the directory the Staff app reads (the webhook rows asa-hub-db holds)
    want = text(payload.get("with"), 60)
    ids = [x["id"] for x in f["counterparts"]]
    with_id = want if want in ids else (ids[0] if ids else "")
    before = text(payload.get("before"), 40)
    thread = [m for m in f["messages"] if m["line"] == with_id and (not before or m["at"] < before)]
    page = [{"id": m["id"], "at": m["at"], "dir": m["dir"], "body": m["body"], "by": m["by"]}
            for m in thread[:SC.SP_TEXT_PAGE]]
    return {"status": 200, "data": {"counterparts": f["counterparts"], "with": with_id, "messages": page,
                                    "more": len(thread) > SC.SP_TEXT_PAGE, "coverage": f["coverage"],
                                    "phones_matched": f["phones_matched"], "why": f["why"],
                                    "degraded": bool(f.get("degraded"))}}


def transcripts_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """cndTranscriptsBuild_: the calls with the candidate's own phones, and the phone screen; metadata only."""
    sink = {"why": [], "degraded": False}
    out = staff_read(reads, ctx, SC.transcripts_build)
    ev = ev_or(reads, ctx, sink)
    s = ev.get("screen")
    calls = out.get("calls") or []
    if s and (s_(s.get("transcripttext")) or s_(s.get("transcripturl"))):
        call_id = s_(s.get("transcriptcallid"))
        hit = next((c for c in calls if c.get("call_id") == call_id), None) if call_id else None
        if hit:
            hit["kind"] = "Phone screen"
            if "Phone screen" not in hit["categories"]:
                hit["categories"].insert(0, "Phone screen")
        else:
            calls.append({"call_id": "screen", "at": s_(s.get("transcriptcreated")) or s_(s.get("screendate")), "secs": "",
                          "direction": "", "line": "", "turns": "", "kind": "Phone screen",
                          "categories": ["Phone screen"]})
        calls.sort(key=_cmp(lambda a, b: 1 if a["at"] < b["at"] else (-1 if a["at"] > b["at"] else 0)))
        count: dict[str, int] = {}
        for c in calls:
            for cat in c.get("categories") or []:
                count[cat] = count.get(cat, 0) + 1
        out["categories"] = [{"name": n, "count": count[n]} for n in sorted(SC._js_keys(count))]
    out["calls"] = calls
    if sink["why"]:
        out["why"] = "; ".join(x for x in [out.get("why") or ""] + sink["why"] if x)
    if sink["degraded"]:
        out["degraded"] = True
    return out


def transcripts_part(reads: L.Reads, ctx: dict) -> Any:
    return data_of(reads, "candidateProfileTranscripts", ctx, lambda: transcripts_build(reads, ctx))


# ---- the resume ------------------------------------------------------------------------------------------------------

_RESUME_CAP = {"work": 12, "education": 6, "items": 30, "item": 90, "summary": 700}
_STREET_RE = re.compile(
    r"\b\d{1,6}" + _WS + r"+(?:[NSEW]\.?" + _WS + r"+)?(?:[A-Z0-9][A-Za-z0-9.'-]*" + _WS + r"+){0,4}"
    r"(?:St|ST|Street|STREET|Ave|AVE|Avenue|AVENUE|Rd|RD|Road|ROAD|Blvd|BLVD|Boulevard|Dr|DR|Drive|DRIVE|Ln|LN|Lane|"
    r"LANE|Ct|CT|Court|COURT|Way|WAY|Pl|PL|Place|Pkwy|Parkway|Cir|Circle|Ter|Terrace|Hwy|Highway|Trl|Trail)\b\.?"
    r"(?:" + _WS + r"*,?" + _WS + r"*(?:Apt|APT|Apartment|Unit|UNIT|Suite|Ste|#)\.?" + _WS + r"*[\w-]+)?", _A)
_PO_BOX_RE = re.compile(r"\bP\.?" + _WS + r"*O\.?" + _WS + r"*Box" + _WS + r"+\d+", re.I | _A)
_STATE_ZIP_RE = re.compile(r"\b([A-Z]{2})" + _WS + r"+\d{5}(?:-\d{4})?\b", _A)
_ZIP4_RE = re.compile(r"\b\d{5}-\d{4}\b", _A)
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", _A)
_PHONE_RE = re.compile(r"(\+?1[" + L._JS_WS + r".-]?)?\(?\d{3}\)?[" + L._JS_WS + r".-]?\d{3}[" + L._JS_WS
                       + r".-]\d{4}\b", _A)
_LICENCE_RE = re.compile(r"\b(licen[cs]e|lic\.?|permit|number|no\.)" + _WS + r"*(?:#|:|no\.?)?" + _WS
                         + r"*[A-Z]{0,3}\d[A-Z0-9-]{4,}", re.I | _A)
_EDGE_RE = re.compile(r"^[" + L._JS_WS + r",;|:–—-]+|[" + L._JS_WS + r",;|:–—-]+$")
_WITHHELD_RE = re.compile(r"\[(?:address|e-mail|phone) withheld\]")


def resume_clean(v: Any) -> str:
    """cndResumeClean_: no street, box or ZIP, no e-mail, phone or licence number."""
    s = gsjs.or_blank(v)
    s = _STREET_RE.sub("[address withheld]", s)
    s = _PO_BOX_RE.sub("[address withheld]", s)
    s = _STATE_ZIP_RE.sub(r"\1", s)
    s = _ZIP4_RE.sub("", s)
    s = _EMAIL_RE.sub("[e-mail withheld]", s)
    s = _PHONE_RE.sub("[phone withheld]", s)
    s = _LICENCE_RE.sub(r"\1 [withheld]", s)
    s = re.sub(_WS + "+", " ", s)
    return gsjs.trim(_EDGE_RE.sub("", s))


def _resume_raw_list(v: Any) -> list:
    """cndResumeRawList_."""
    if isinstance(v, list):
        return v
    s = s_(v)
    return re.split(r"[" + L._JS_WS + r"]*[,;][" + L._JS_WS + r"]*", s) if s else []


def _resume_union(lst: list, more: list) -> list:
    """cndResumeUnion_."""
    out = list(lst or [])
    for m in more or []:
        low = gsjs.js_str(m).lower()
        if not any(low in gsjs.js_str(x).lower() for x in out):
            out.append(m)
    return out[:_RESUME_CAP["items"]]


def _js_re(src: str, flags: int = 0) -> re.Pattern:
    """A pattern as the code being ported writes it: \\s and \\S JavaScript's whitespace (in a class too), \\b \\d
    ASCII, and `$` the text's end alone unless the pattern is multiline."""
    out: list[str] = []
    i, cls = 0, False
    while i < len(src):
        c = src[i]
        if c == "\\" and i + 1 < len(src):
            n = src[i + 1]
            out.append((L._JS_WS if cls else "[" + L._JS_WS + "]") if n == "s"
                       else "[^" + L._JS_WS + "]" if n == "S" and not cls else c + n)
            i += 2
            continue
        if c == "[" and not cls:
            cls = True
        elif c == "]" and cls:
            cls = False
        elif c == "$" and not cls and not flags & re.M:
            c = r"\Z"
        out.append(c)
        i += 1
    return re.compile("".join(out), flags | re.A)


# CND_RESUME_TTL_S: one file's reading is kept this long under its id and its modified time
_RESUME_TTL_S = 21600
# the text a résumé file gives is read this far (hubExtractResumeText_), its bytes at most this far
_RESUME_TEXT_CAP = 20000
_RESUME_BYTES_CAP = 15 << 20
_RESUME_HELD: OrderedDict[tuple, tuple[float, dict]] = OrderedDict()
_RESUME_HELD_MAX = 64
_RESUME_LOCK = threading.Lock()
_RESUME_HEADS = tuple((name, _js_re(src, re.I)) for name, src in (
    ("summary", r"^(?:(?:professional|career|personal)\s+)?(?:summary|profile|objective|about me|overview)"
                r"(?:\s+of qualifications)?$"),
    ("work", r"^(?:(?:professional|work|employment|relevant|career|job|caregiving)\s+)?(?:experience|history|employment)"
             r"(?:\s+history)?$"),
    ("certifications", r"^(?:certifications?|certificates?|licen[cs]es?|credentials|(?:certifications?|licen[cs]es?)\s*"
                       r"(?:and|&)\s*(?:certifications?|licen[cs]es?)|training\s*(?:and|&)\s*certifications?)$"),
    ("education", r"^(?:education(?:al background)?|academic background|schooling|education\s*(?:and|&)\s*training)$"),
    ("skills", r"^(?:(?:key|core|professional|technical|relevant)\s+)?(?:skills|competencies|qualifications|abilities|"
               r"strengths)(?:\s*(?:and|&)\s*(?:abilities|qualifications|strengths))?$"),
    ("languages", r"^languages?(?:\s+spoken)?$"),
    ("availability", r"^availability$"),
    ("other", r"^(?:references?|volunteer(?:\s+(?:experience|work))?|activities|interests|hobbies|awards?|honors|"
              r"achievements?|accomplishments|projects?|contact(?:\s+information)?|personal\s+information|"
              r"additional\s+information)$")))
_RESUME_MON = (r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|"
               r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?")
_RESUME_WHEN = r"(?:" + _RESUME_MON + r"\s*,?\s*\d{4}|\d{1,2}\s*/\s*\d{4}|\d{1,2}\s*/\s*\d{2}(?!\d)|(?:19|20)\d{2})"
_RESUME_RANGE = _js_re(r"\(?(" + _RESUME_WHEN + r")\s*(?:-|–|—|to|until|thru|through)\s*(" + _RESUME_WHEN
                       + r"|present|current|now|today)\)?", re.I)
_RESUME_ROLE = _js_re(r"\b(?:aide|assistant|professional|dsp|caregiver|care ?giver|nurse|technician|tech|manager|"
                      r"supervisor|coordinator|specialist|associate|cashier|clerk|driver|cook|server|attendant|worker|"
                      r"representative|counselou?r|teacher|lead|director|stna|cna|hha|lpn|rn|provider|helper|"
                      r"housekeeper|companion|intern|agent|operator|officer|trainer|instructor|administrator|"
                      r"receptionist|secretary|stocker|sitter|nanny|therapist|mentor|advocate|volunteer|crew)\b", re.I)
_RESUME_ORG = _js_re(r"\b(?:inc|llc|ltd|corp|corporation|company|services?|care|health|healthcare|homes?|hospital|"
                     r"center|centre|agency|group|living|residential|school|university|college|stores?|restaurant|"
                     r"clinic|facility|nursing|rehab|foundation|church|academy|department|county|ministries|solutions|"
                     r"partners|enterprises|systems|community|village|manor|gardens|walmart|kroger|target|amazon|"
                     r"mcdonald'?s)\b", re.I)
_RESUME_ORG_ONLY = _js_re(r"\b(?:inc|llc|ltd|corp|corporation|company|hospital|center|centre|agency|school|university|"
                          r"college|stores?|restaurant|clinic|foundation|church|department|county|walmart|kroger|target|"
                          r"amazon|mcdonald'?s)\b", re.I)
_RESUME_PLACE = _js_re(r"^[A-Za-z][A-Za-z .'-]{1,40},\s*[A-Z]{2}\.?$")
_RESUME_DEGREE = _js_re(r"\b(?:diploma|g\.?e\.?d|associate'?s?|bachelor'?s?|master'?s?|doctorate|ph\.?d|degree|"
                        r"certificate|coursework|program|stna|cna|lpn|nursing|a\.a\.s?|b\.s\.n?|b\.a|m\.s|m\.b\.a)\b",
                        re.I)
_RESUME_SCHOOL = _js_re(r"\b(?:school|college|university|academy|institute|community|polytechnic|vocational|jvs|univ)\b",
                        re.I)
_RESUME_CREDENTIALS = tuple((name, _js_re(src, fl)) for name, src, fl in (
    ("CPR", r"\bCPR\b", re.I), ("First Aid", r"\bfirst[\s-]aid\b", re.I), ("BLS", r"\bBLS\b|basic life support", re.I),
    ("STNA", r"\bSTNA\b|state[\s-]tested nurs(?:e|ing) aide", re.I),
    ("CNA", r"\bCNA\b|certified nurs(?:e|ing) (?:aide|assistant)", re.I), ("HHA", r"\bHHA\b", 0),
    ("DODD", r"\bDODD\b", re.I),
    # a duty ("medication administration") is not a credential: only the delegation, the aide, or a certified pass
    ("Medication administration", r"\bmed(?:ication)?s?\.?\s*(?:del(?:egation)?|aide)\b|\bQMA\b|\bmed(?:ication)?s?\.?\s*"
                                  r"(?:pass|admin(?:istration)?)\s+(?:certif|cert\b|trained|training)", re.I),
    ("MUI", r"\bMUI\b", 0), ("Driver's license", r"driver'?s'?\s+licen[cs]e|\bvalid\s+(?:ohio\s+)?(?:DL|driver)", re.I),
    ("CDL", r"\bCDL\b", 0), ("Food handler", r"\bserv\s?safe\b|food handler", re.I), ("LPN", r"\bLPN\b", 0),
    ("RN", r"\bRN\b", 0), ("Crisis prevention", r"\bCPI\b|crisis prevention|\bMANDT\b", re.I)))
_RESUME_LANGS = tuple((name, _js_re(r"\b" + name + r"\b", re.I)) for name in (
    "English", "Spanish", "French", "Arabic", "Somali", "Nepali", "Swahili", "Portuguese", "Haitian Creole",
    "Vietnamese", "Mandarin", "Cantonese", "Chinese", "Russian", "Ukrainian", "German", "Italian", "Hindi", "Urdu",
    "Tagalog", "American Sign Language", "Amharic", "Yoruba", "Twi", "Korean", "Japanese", "Polish", "Romanian",
    "Turkish", "Farsi", "Bengali", "Punjabi", "Kinyarwanda", "Burmese", "Albanian", "Bosnian", "Greek", "Hebrew",
    "Hmong", "Tigrinya", "Oromo", "Wolof", "Lingala", "Pashto", "Dari"))
_RESUME_BULLET = _js_re(r"^(?:[•·▪●◦○■□➢►>*]|[-–—](?=\s))\s*")
_RESUME_HEAD_EDGE = _js_re(r"^[\s#*•·=_|-]+|[\s:*•·=_|-]+$")
_RESUME_INLINE = _js_re(r"^\s*([A-Za-z][A-Za-z &/]{2,40}?)\s*:\s*(\S.*)$")
_RESUME_FACT = _js_re(r"^\s*(?:availab(?:ility|le)[^:]{0,24}|(?:earliest )?start(?:ing)? date|preferred (?:work )?"
                      r"location|location preference|willing to (?:work|relocate)[^:]{0,24})\s*:", re.I)
_RESUME_FACT_NOW = _js_re(r"^\s*available\s+(?:to start\s+)?(?:immediately|now|asap|right away)\b", re.I)
_RESUME_SPLIT = _js_re(r"\s*(?:\||•|·|\t|\s{3,}|\s[–—-]\s)\s*")
_RESUME_PART_EDGE = _js_re(r"^[\s,;:()–—-]+|[\s,;:()–—-]+$")
_RESUME_AT = _js_re(r"^(.+?)\s+at\s+(.+)$", re.I)
_RESUME_PART_PLACE = _js_re(r"^(.*?),\s*([A-Za-z][A-Za-z .'-]{1,40},\s*[A-Z]{2})\.?$")
_RESUME_YEAR = _js_re(r"\b(?:19|20)\d{2}\b")
_RESUME_SCHOOL_WORDS = _js_re(r"\b(?:graduated|expected|completed|class of)\b:?", re.I)
_RESUME_ITEM_SPLIT = _js_re(r"\s*[,;•·|]\s*")
_RESUME_LANG_LINE = _js_re(r"\b(?:bilingual|fluent|languages?|speaks?|native)\b", re.I)
_RESUME_AVAIL = _js_re(r"^\s*(?:availability|available)\s*[:–—-]\s*(.{3,160})$", re.I | re.M)
_RESUME_START = _js_re(r"\b(?:available to start|availability date|start date|can start|able to start|available "
                       r"(?:starting|from|beginning))\b\s*[:–—-]?\s*(immediately|asap|right away|now|[A-Za-z]{3,9}\.? "
                       r"\d{1,2},? \d{4}|\d{1,2}/\d{1,2}/\d{2,4}|[A-Za-z]{3,9}\.? \d{4})", re.I)
_RESUME_SOON = _js_re(r"\bavailable\s+(?:to start\s+)?(immediately|right away|asap)\b", re.I)
_RESUME_WANTS = _js_re(r"\b(?:preferred (?:work )?location|location preference|willing to (?:work|relocate) (?:in|to)|"
                       r"seeking (?:an? )?(?:[A-Za-z]+ ){0,3}(?:position|role|job|work) in|open to work(?:ing)? in)\s*"
                       r"[:–—-]?\s*([A-Za-z][A-Za-z ,'-]{2,60})", re.I)
_RESUME_WANTS_CUT = _js_re(r"[.;]|\s+(?:where|to|that|so|which|with|and I)\b", re.I)
_RESUME_NOW = _js_re(r"^(asap|right away|now|immediately)$", re.I)
_RESUME_CITY = _js_re(r"([A-Za-z .]{2,30}),\s*([A-Z]{2})\b")
_RESUME_FROM_YEAR = _js_re(r"\b((?:19|20)\d{2})\b")
_RESUME_FROM_YY = _js_re(r"/\s*(\d{2})$")


def resume_bullet(line: Any) -> dict[str, Any]:
    """cndResumeBullet_: a line without its bullet, and whether it had one."""
    s = gsjs.trim(gsjs.or_blank(line).replace("\xa0", " "))
    m = _RESUME_BULLET.match(s)
    return {"text": gsjs.trim(s[m.end():]) if m else s, "bullet": bool(m)}


def resume_head(line: Any) -> str:
    """cndResumeHead_: the section a line opens, or ''."""
    t = re.sub(_WS + "+", " ", _RESUME_HEAD_EDGE.sub("", gsjs.or_blank(line)))
    if not t or len(t) > 48:
        return ""
    return next((name for name, pat in _RESUME_HEADS if pat.search(t)), "")


def resume_sections(text: str) -> dict[str, list[str]]:
    """cndResumeSections_: the text's lines by the section they stand under; before the first heading is `head`."""
    out: dict[str, list[str]] = {"head": []}
    at = "head"
    for raw in re.split(r"\r?\n", text or ""):
        line = re.sub(_WS + r"+\Z", "", raw.replace("\xa0", " "))
        if not gsjs.trim(line):
            continue
        h = resume_head(line)
        if h:
            at = h
            out.setdefault(at, [])
            continue
        m = _RESUME_INLINE.match(line)
        inline = resume_head(m.group(1)) if m else ""
        if inline:
            out.setdefault(inline, []).append(gsjs.trim(m.group(2)))
            continue
        # "Available to start: …", "Preferred location: …" — facts, never a list's items
        if _RESUME_FACT.search(line) or _RESUME_FACT_NOW.search(line):
            out.setdefault("facts", []).append(gsjs.trim(line))
            continue
        out.setdefault(at, []).append(gsjs.trim(line))
    return out


def resume_parts(s: Any) -> list[str]:
    """cndResumeParts_: a header line's pieces, split on the separators résumés use, a trailing "City, ST" its own."""
    out: list[str] = []
    for p in _RESUME_SPLIT.split(gsjs.or_blank(s)):
        t = _RESUME_PART_EDGE.sub("", p)
        if not t:
            continue
        at = _RESUME_AT.match(t)
        if at and _RESUME_ROLE.search(at.group(1)):
            out.append(at.group(1))
            t = at.group(2)
        place = _RESUME_PART_PLACE.match(t)
        if place and place.group(1):
            out.extend((gsjs.trim(place.group(1)), gsjs.trim(place.group(2))))
            continue
        out.append(t)
    return out


def resume_job(parts: list[str], start: Any, end: Any) -> dict[str, str]:
    """cndResumeJob_: a job's role, employer and place from its pieces, and its span as written."""
    job = {"role": "", "employer": "", "place": "", "from": resume_clean(start), "to": resume_clean(end)}
    rest: list[str] = []
    for p in parts:
        if not job["place"] and _RESUME_PLACE.search(p):
            job["place"] = re.sub(r"\.\Z", "", p, count=1)
            continue
        if not job["role"] and _RESUME_ROLE.search(p) and not _RESUME_ORG_ONLY.search(p):
            job["role"] = p
            continue
        rest.append(p)
    job["employer"] = next((p for p in rest if _RESUME_ORG.search(p)), rest[0] if rest else "")
    if not job["role"]:
        job["role"] = next((p for p in rest if p != job["employer"]), "")
    job["role"] = resume_clean(job["role"])[:_RESUME_CAP["item"]]
    job["employer"] = resume_clean(job["employer"])[:_RESUME_CAP["item"]]
    job["place"] = resume_clean(job["place"])
    if _WITHHELD_RE.search(job["employer"]):
        job["employer"] = ""
    return job


def resume_work(lines: list | None) -> list[dict[str, str]]:
    """cndResumeWork_: each job the work section dates — its role, employer and place from the lines it heads."""
    rows = [resume_bullet(x) for x in lines or []]
    used: set[int] = set()
    jobs: list[dict[str, str]] = []

    def usable(j: int) -> bool:
        return (0 <= j < len(rows) and j not in used and not rows[j]["bullet"]
                and not _RESUME_RANGE.search(rows[j]["text"]) and len(rows[j]["text"]) <= 90)

    for i, r in enumerate(rows):
        m = _RESUME_RANGE.search(r["text"])
        if not m or len(jobs) >= _RESUME_CAP["work"]:
            continue
        used.add(i)
        parts = resume_parts(r["text"].replace(m.group(0), " ", 1))
        j = i - 1
        while j >= i - 2 and usable(j):
            parts = resume_parts(rows[j]["text"]) + parts
            used.add(j)
            j -= 1
        k = i + 1
        while len(parts) < 2 and k <= i + 2 and usable(k):
            parts = parts + resume_parts(rows[k]["text"])
            used.add(k)
            k += 1
        job = resume_job(parts, m.group(1), m.group(2))
        if job["role"] or job["employer"]:
            jobs.append(job)
    return jobs


def resume_education(lines: list | None) -> list[dict[str, str]]:
    """cndResumeEducation_: each school, degree or course in the education section, with its year."""
    out: list[dict[str, str]] = []
    cur: dict[str, str] | None = None

    def push() -> None:
        nonlocal cur
        if cur and (cur["school"] or cur["degree"]) and len(out) < _RESUME_CAP["education"]:
            out.append(cur)
        cur = None

    for raw in lines or []:
        text = resume_bullet(raw)["text"]
        years = _RESUME_YEAR.findall(text)
        bare = _RESUME_YEAR.sub(" ", _RESUME_SCHOOL_WORDS.sub(" ", _RESUME_RANGE.sub(" ", text, count=1)))
        for p in resume_parts(bare):
            if _RESUME_PLACE.search(p):
                if cur and not cur["place"]:
                    cur["place"] = re.sub(r"\.\Z", "", p, count=1)
                continue
            degree = bool(_RESUME_DEGREE.search(p))
            school = not degree and bool(_RESUME_SCHOOL.search(p))
            if not degree and not school:
                continue
            if not cur or (degree and cur["degree"]) or (school and cur["school"]):
                push()
                cur = {"school": "", "degree": "", "year": "", "place": ""}
            cur["degree" if degree else "school"] = resume_clean(p)[:_RESUME_CAP["item"]]
        if cur and not cur["year"] and years:
            cur["year"] = years[-1]
    push()
    return out


def resume_items(lines: list | None, split: bool) -> list[str]:
    """cndResumeItems_: a list section's items — bullets and commas split, each kept short, each once."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in lines or []:
        text = resume_bullet(raw)["text"]
        for p in (_RESUME_ITEM_SPLIT.split(text) if split else [text]):
            t = resume_clean(p)[:_RESUME_CAP["item"]]
            k = t.lower()
            if len(t) < 2 or k in seen or len(out) >= _RESUME_CAP["items"] or _WITHHELD_RE.search(t):
                continue
            seen.add(k)
            out.append(t)
    return out


def resume_home(text: str) -> str:
    """hubParseResumeIdentity_'s city and state: the first "City, ST" in the text's first fifteen lines."""
    lines = [x for x in (gsjs.trim(x) for x in re.split(r"\r?\n", text)) if x]
    for line in lines[:15]:
        cs = _RESUME_CITY.search(line)
        if cs:
            return ", ".join(v for v in (gsjs.trim(cs.group(1)), cs.group(2)) if v)
    return ""


def resume_parse(text: str) -> dict[str, Any]:
    """cndResumeParse_: a résumé's text read deterministically — the summary, each job the work section dates, the
    schools, the credentials and languages it names, availability, the earliest start and a stated location."""
    text = re.sub(r"\r\n?", "\n", text or "")
    sec = resume_sections(text)
    cred_text = "\n".join(sec.get("certifications", []) + sec.get("summary", []) + sec.get("skills", [])
                          + sec.get("education", []) + sec.get("head", []))
    creds = [name for name, pat in _RESUME_CREDENTIALS if pat.search(cred_text)]
    lang_text = "\n".join(sec.get("languages", []) + [x for x in text.split("\n") if _RESUME_LANG_LINE.search(x)])
    langs = [name for name, pat in _RESUME_LANGS if pat.search(lang_text)]
    work = resume_work(sec.get("work"))
    avail = " ".join(sec.get("availability", []))
    if not avail:
        am = _RESUME_AVAIL.search(text)
        avail = am.group(1) if am else ""
    start = _RESUME_START.search(text)
    soon = _RESUME_SOON.search(text)
    wants = _RESUME_WANTS.search(text)
    years = []
    for j in work:
        y = _RESUME_FROM_YEAR.search(j["from"]) or _RESUME_FROM_YY.search(j["from"])
        if y:
            years.append(int("20" + y.group(1) if len(y.group(1)) == 2 else y.group(1)))
    latest = work[0] if work else None
    experience = ""
    if work:
        experience = (f"{len(work)} job{'' if len(work) == 1 else 's'} listed"
                      + (f" since {min(years)}" if years else "")
                      + (" — latest: " + (latest["role"] or latest["employer"])
                         + (" at " + latest["employer"] if latest["role"] and latest["employer"] else "")))
    return {"summary": resume_clean(" ".join(resume_bullet(x)["text"] for x in sec.get("summary", [])))
                       [:_RESUME_CAP["summary"]],
            "work": work, "education": resume_education(sec.get("education")),
            "certifications": _resume_union(resume_items(sec.get("certifications"), False), creds),
            "skills": resume_items(sec.get("skills"), True),
            "languages": _resume_union([x for x in resume_items(sec.get("languages"), True) if len(x) <= 40], langs),
            "experience": experience,
            "availability": resume_clean(avail)[:160],
            "earliest_start": (_RESUME_NOW.sub("Immediately", resume_clean(start.group(1))) if start
                               else "Immediately" if soon else ""),
            "preferred_location": resume_clean(_RESUME_WANTS_CUT.split(wants.group(1))[0])[:60] if wants else "",
            "home": resume_home(text)}


def _resume_word_text(raw: bytes) -> tuple[str, str]:
    """A Word file's paragraphs as lines, its tabs and breaks kept; ('', why) when it is no Word file."""
    import io  # noqa: PLC0415
    import xml.etree.ElementTree as ET  # noqa: PLC0415, S405 - a Word file's own XML, size-capped
    import zipfile  # noqa: PLC0415
    w = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            info = z.getinfo("word/document.xml")
            if info.file_size > _RESUME_BYTES_CAP:
                return "", "the Word file is larger than the platform reads"
            root = ET.fromstring(z.read(info))  # noqa: S314
    except Exception as e:  # noqa: BLE001 - a file the reader cannot open says so, as a refused conversion does
        return "", f"the file could not be opened as a Word document ({type(e).__name__})"
    lines = []
    for para in root.iter(w + "p"):
        bits = []
        for el in para.iter():
            if el.tag == w + "t":
                bits.append(el.text or "")
            elif el.tag == w + "tab":
                bits.append("\t")
            elif el.tag in (w + "br", w + "cr"):
                bits.append("\n")
        lines.append("".join(bits))
    text = "\n".join(lines)
    return (text[:_RESUME_TEXT_CAP], "") if text.strip() else ("", "the Word file holds no text")


def resume_file_text(drv: Any, fid: str, meta: dict) -> tuple[str, str]:
    """hubExtractResumeText_ without Drive's conversion (the file is read, never copied): a Google Doc's own text, a
    PDF's text layer, a Word file's paragraphs, plain text; ('', why) for anything else or no text at all."""
    mime = s_(meta.get("mimeType"))
    if mime == "application/vnd.google-apps.document":
        return drv.export(fid, "text/plain", _RESUME_BYTES_CAP).decode("utf-8", "replace")[:_RESUME_TEXT_CAP], ""
    if mime.startswith("application/vnd.google-apps."):
        return "", f"a {mime.rsplit('.', 1)[-1]} file holds no résumé text"
    raw = drv.media(fid, _RESUME_BYTES_CAP)
    if len(raw) > _RESUME_BYTES_CAP:
        return "", "the file is larger than the platform reads"
    if mime == "application/pdf" or raw[:5] == b"%PDF-":
        try:
            import pypdf  # noqa: PLC0415 - only a résumé held as a PDF needs it
        except ImportError:
            return "", "the PDF reader is not installed on this server"
        import io  # noqa: PLC0415
        try:
            pages = pypdf.PdfReader(io.BytesIO(raw)).pages
            text = "\n".join((pg.extract_text() or "") for pg in pages[:20])
        except Exception as e:  # noqa: BLE001 - a file the reader cannot open says so, as a refused conversion does
            return "", f"the PDF could not be opened ({type(e).__name__})"
        return (text[:_RESUME_TEXT_CAP], "") if text.strip() else ("", "the PDF is a scan, with no text layer")
    if mime.endswith("wordprocessingml.document") or raw[:2] == b"PK":
        return _resume_word_text(raw)
    if mime.startswith("text/"):
        text = raw.decode("utf-8", "replace")
        return (text[:_RESUME_TEXT_CAP], "") if text.strip() else ("", "the file is empty")
    return "", f"its kind, {mime or 'unknown'}, carries no text the platform reads without OCR"


def resume_scan(meta: dict, why: str) -> bool:
    """A résumé whose words are only in its picture: a PDF with no text layer, or an image."""
    mime = s_(meta.get("mimeType"))
    return (mime == "application/pdf" and why == "the PDF is a scan, with no text layer") or mime.startswith("image/")


def resume_scan_text(reads: L.Reads, fid: str, modified: str, candidate: str) -> tuple[str, str]:
    """A scan's words as the relay's OCR lane kept them (app.resume_texts), the file owed to it when they are not
    kept for this modified time; ('', why) until they are."""
    import resume_texts as RT  # noqa: PLC0415 - the lane's store, read only where a scan needs it
    got = RT.kept(reads, fid)
    if got and got["state"] == "read" and got["text"].strip() and (not got["modified_time"] or
                                                                     got["modified_time"] == modified):
        return got["text"][:_RESUME_TEXT_CAP], ""
    if got is None or got["modified_time"] != modified:
        RT.owe(fid, modified, candidate)
        return "", "the scan is being read by OCR"
    if got["state"] == "failed":
        return "", "the scan could not be read by OCR: " + got["error"][:100] + "; it is tried again"
    return "", "the scan is being read by OCR"


def resume_text(reads: L.Reads, fid: str, candidate: str = "") -> dict[str, Any]:
    """cndResumeText_: a résumé file's reading, kept per file id and modified time; {"unreadable": why} when the file
    gives no text or Drive refuses it (said, never kept). A scan is read by the relay's OCR lane, and said unread until
    it is. Drive not answering is raised for the caller to say."""
    drv = reads.need_drive()
    try:
        meta = drv.file_meta(fid, fields="id,mimeType,modifiedTime,size,trashed")
    except (Defer, DRV.Gone) as e:
        return {"unreadable": f"The résumé file holds no text the platform can read ({_why(e)})."}
    key = (fid, s_(meta.get("modifiedTime")))
    now = time.time()
    with _RESUME_LOCK:
        held = _RESUME_HELD.get(key)
        if held and now - held[0] < _RESUME_TTL_S:
            _RESUME_HELD.move_to_end(key)
            return held[1]
    try:
        text, why = resume_file_text(drv, fid, meta)
    except (Defer, DRV.Gone) as e:
        return {"unreadable": f"The résumé file holds no text the platform can read ({_why(e)})."}
    if not text.strip() and resume_scan(meta, why):
        text, why = resume_scan_text(reads, fid, s_(meta.get("modifiedTime")), candidate)
        if not text.strip():
            # never held: the lane's words arrive within minutes
            return {"unreadable": "The résumé file holds no text the platform can read yet (" + why[:160] + ")."}
    out = resume_parse(text) if text.strip() else {
        "unreadable": "The résumé file holds no text the platform can read" + (f" ({why[:120]})" if why else "") + "."}
    with _RESUME_LOCK:
        _RESUME_HELD[key] = (now, out)
        while len(_RESUME_HELD) > _RESUME_HELD_MAX:
            _RESUME_HELD.popitem(last=False)
    return out


def resume_stored(a: dict) -> dict[str, Any]:
    """cndResumeStored_: what the scored analysis already read from the resume."""
    try:
        raw = json.loads(s_(a.get("rawpromptoutputjson")) or "{}") or {}
    except ValueError:
        raw = {}
    if not isinstance(raw, dict):
        raw = {}

    def get(o: dict, keys: tuple[str, ...]) -> str:
        for k in keys:
            if s_(o.get(k)):
                return s_(o.get(k))
        return ""

    def first(*vals: Any) -> Any:
        for v in vals:
            if not gsjs.falsy(v):
                return v
        return vals[-1]

    work = []
    for x in _resume_raw_list(first(raw.get("WorkHistory"), raw.get("work_history"), raw.get("Jobs"))):
        if isinstance(x, str):
            # a job written as a line is read by the work section's own reading
            work.extend(resume_work([x])[:1])
            continue
        o = x if isinstance(x, dict) else {}
        job = {"role": resume_clean(get(o, ("Role", "Title", "Position", "JobTitle", "role", "title"))),
               "employer": resume_clean(get(o, ("Employer", "Company", "Organization", "employer", "company"))),
               "place": resume_clean(get(o, ("Location", "City", "location"))),
               "from": resume_clean(get(o, ("Start", "StartDate", "From", "start", "from"))),
               "to": resume_clean(get(o, ("End", "EndDate", "To", "end", "to")))}
        if job["role"] or job["employer"]:
            work.append(job)
    work = work[:_RESUME_CAP["work"]]
    education = []
    for x in _resume_raw_list(first(raw.get("Education"), raw.get("education"))):
        if isinstance(x, str):
            education.extend(resume_education([x])[:1])
            continue
        o = x if isinstance(x, dict) else {}
        ed = {"school": resume_clean(get(o, ("School", "Institution", "school"))),
              "degree": resume_clean(get(o, ("Degree", "Program", "degree"))),
              "year": get(o, ("Year", "GraduationYear", "year"))[:4], "place": ""}
        if ed["school"] or ed["degree"]:
            education.append(ed)
    education = education[:_RESUME_CAP["education"]]
    years = s_(a.get("totalyearscaregiving"))

    def clean(lst: list) -> list[str]:
        out = [resume_clean(x)[:_RESUME_CAP["item"]] for x in lst]
        return [x for x in out if len(x) >= 2 and not _WITHHELD_RE.search(x)][:_RESUME_CAP["items"]]

    return {"summary": resume_clean(a.get("summary"))[:_RESUME_CAP["summary"]], "work": work, "education": education,
            "certifications": clean(_resume_raw_list(a.get("listedcertifications"))),
            "skills": clean(_resume_raw_list(first(raw.get("Skills"), raw.get("skills")))),
            "languages": [x for x in clean(_resume_raw_list(a.get("languages"))) if len(x) <= 40],
            "experience": years + " years caregiving" if years else resume_clean(a.get("careexperience")),
            "availability": resume_clean(a.get("scheduleavailability")),
            "home": ", ".join(v for v in (s_(a.get("city")), s_(a.get("state"))) if v),
            "analysis": {"highest_responsibility": resume_clean(a.get("highestresponsibility")),
                         "dsp_agencies": s_(a.get("numdspagencies")), "avg_tenure": s_(a.get("avgtenureperjob")),
                         "months_since_last": s_(a.get("monthssincelastexperience"))}}


def resume_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """cndResumeBuild_: what the scored analysis holds first; the file's own text only for what it lacks."""
    row, sink = ctx["row"], {"why": [], "degraded": False}
    ev = ev_or(reads, ctx, sink)
    a = ev.get("analysis") or {}
    fid = L.drive_id(row.get("resumeLink")) or (s_(a.get("sourceassetid")) if _FILE_ID.match(s_(a.get("sourceassetid")))
                                                else "")
    stored = resume_stored(a)
    scored = bool(s_(a.get("analyzedat")) or s_(a.get("compositescore")) or stored["summary"])
    parsed = None
    if fid and not (stored["work"] and stored["education"] and stored["skills"]):
        try:
            parsed = resume_text(reads, fid, ctx["key"])
        except Exception as e:  # noqa: BLE001 - Drive not answering is said, as the try/catch of the code ported
            sink["why"].append(why_of("The résumé file", _why(e)))
            sink["degraded"] = True
        if parsed and parsed.get("unreadable"):
            sink["why"].append(parsed["unreadable"])
            parsed = None
    p = parsed or {}
    wants = s_(p.get("preferred_location"))
    home = s_(p.get("home")) or stored["home"]
    return {"on_file": bool(fid) or scored, "file_read": bool(parsed), "analyzed_at": s_(a.get("analyzedat")),
            "fields": {"experience": stored["experience"] or s_(p.get("experience")),
                       "availability": stored["availability"] or s_(p.get("availability")),
                       "preferred_location": wants or home,
                       "preferred_basis": "stated" if wants else ("home" if home else ""),
                       "earliest_start": s_(p.get("earliest_start"))},
            "summary": stored["summary"] or s_(p.get("summary")),
            "work": stored["work"] or p.get("work") or [], "education": stored["education"] or p.get("education") or [],
            "certifications": _resume_union(stored["certifications"], p.get("certifications") or []),
            "skills": stored["skills"] or p.get("skills") or [],
            "languages": _resume_union(stored["languages"], p.get("languages") or []), "analysis": stored["analysis"],
            "why": sink["why"], "degraded": sink["degraded"]}


# ---- the gate --------------------------------------------------------------------------------------------------------

def viewer(sess: L.Session) -> dict | None:
    """cndViewer_ (FAIL-CLOSED): the reader's scope when App Control opens the app to them; None otherwise."""
    got = sc.profile_app_gate(APP_ID, sess.user, sess.reads.scope_sources())
    s = got.get("scope") if got.get("open") is True else None
    return s if s and s.get("kind") != "none" else None


def wide(scope: dict | None) -> bool:
    """cndWide_: the master and every released badge that does not narrow."""
    return bool(scope) and scope.get("kind") in ("master", "all")


def gate(sess: L.Session) -> dict[str, Any]:
    """The session as the writes take it: who it is, whether the app opens to it, how far, and the real master."""
    user = sess.user or {}
    scope = viewer(sess)
    why = "" if scope is not None else "App Control does not open Staff Candidates to this account."
    return {"open": scope is not None, "is_master": sc.is_real_master(user), "wide": wide(scope), "scope": scope,
            "viewer": (scope or {}).get("kind") or "", "uid": gsjs.trim(gsjs.or_text(user.get("id"))),
            "name": s_(user.get("display_name")), "email": s_(user.get("email")).lower(),
            "visiting": bool(user.get("visiting_member")), "service": user.get("is_service") is True, "why": why}


def reads_of(x: L.Reads | L.Session) -> L.Reads:
    """A session's reads, or the reads themselves."""
    return x.reads if isinstance(x, L.Session) else x


def candidate(sess_or_reads: L.Reads | L.Session, key: Any) -> dict[str, Any]:
    """cndCandidate_ for a session or a request's reads: the candidate context, or {'refused': env}."""
    return candidate_of(reads_of(sess_or_reads), key)


# ---- the doors -------------------------------------------------------------------------------------------------------

def _wide_candidate(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The whole-app gate, then the candidate the request names."""
    if not wide(viewer(sess)):
        return {"refused": unknown()}
    return candidate_of(sess.reads, payload.get("candidate"))


def candidate_profile_roster(sess: L.Session, payload: dict) -> dict[str, Any]:
    """candidateProfileRoster: every candidate on the board with its next step; a narrowed reader its houses' only."""
    scope = viewer(sess)
    if not scope:
        return unknown()
    reads = sess.reads
    return serve("The hiring board", lambda: shown(scrub(
        roster_of(board(reads)["rows"], roster_row) if wide(scope) else narrow_roster(reads, scope))))


def candidate_profile_overview(sess: L.Session, payload: dict) -> dict[str, Any]:
    """candidateProfileOverview."""
    scope = viewer(sess)
    if not scope:
        return unknown()
    if not wide(scope):
        return narrow_serve(sess.reads, scope, payload, narrow_overview)
    ctx = candidate_of(sess.reads, payload.get("candidate"))
    if ctx.get("refused"):
        return ctx["refused"]
    return serve("The candidate", lambda: overview_part(sess.reads, ctx))


def candidate_profile_actions(sess: L.Session, payload: dict) -> dict[str, Any]:
    """candidateProfileActions."""
    ctx = _wide_candidate(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return serve("The hiring actions", lambda: actions_part(sess.reads, ctx))


def candidate_profile_interviews(sess: L.Session, payload: dict) -> dict[str, Any]:
    """candidateProfileInterviews."""
    scope = viewer(sess)
    if not scope:
        return unknown()
    if not wide(scope):
        return narrow_serve(sess.reads, scope, payload, narrow_interviews)
    ctx = candidate_of(sess.reads, payload.get("candidate"))
    if ctx.get("refused"):
        return ctx["refused"]
    return serve("The interview plan", lambda: interviews_part(sess.reads, ctx))


def candidate_profile_documents(sess: L.Session, payload: dict) -> dict[str, Any]:
    """candidateProfileDocuments."""
    ctx = _wide_candidate(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return serve("The documents", lambda: documents_part(sess.reads, ctx))


def candidate_profile_doc_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """candidateProfileDocFile: one of the candidate's documents as bytes; only a file their Documents list names."""
    ctx = _wide_candidate(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    fid = text(payload.get("file_id"), 120)
    if not _FILE_ID.match(fid):
        return {"status": 400, "message": "file_id: a Drive file id."}
    docs, why = soft(lambda: documents_part(sess.reads, ctx).get("docs") or [])
    if why:
        return {"status": 503, "message": "The documents could not be read just now — try again in a minute."}
    if not any(d.get("file_id") == fid for d in docs):
        return {"status": 404, "message": "This candidate names no such document."}
    got = L.doc_file(sess.reads, fid)
    if got.get("refused"):
        return got["refused"]
    return {"status": 200, "data": {"id": fid, "name": got["name"], "mime": got["mime"], "size": got["size"],
                                    "exported": got["exported"], "b64": got["b64"]}}


def candidate_profile_activity(sess: L.Session, payload: dict) -> dict[str, Any]:
    """candidateProfileActivity."""
    ctx = _wide_candidate(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return serve("The activity", lambda: activity_part(sess.reads, ctx))


def candidate_profile_texts(sess: L.Session, payload: dict) -> dict[str, Any]:
    """candidateProfileTexts: one conversation per company line, newest first, a page at a time."""
    ctx = _wide_candidate(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return texts_door(sess.reads, ctx, payload)


def candidate_profile_transcripts(sess: L.Session, payload: dict) -> dict[str, Any]:
    """candidateProfileTranscripts."""
    ctx = _wide_candidate(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    return serve("The calls", lambda: transcripts_part(sess.reads, ctx))


# COMMS_SCREEN_LINES (Comms.gs): the line the screening bot speaks from
SCREEN_LINES = ("3307544040",)
# "[0:05] +13305550142: Hello" — a line the speaker transcript writes per turn
_TURN_RE = re.compile(r"^" + _WS + r"*\[\d{1,3}:\d{2}(?::\d{2})?\]" + _WS + r"*[^:\n]{0,80}?" + _WS + r"*:",
                      re.M | _A)


def _line_named(reads: L.Reads, data: Any) -> dict[str, Any]:
    """cndLineNamed_: a transcript answer with its company line's name, when the platform's line book names it."""
    d = data if isinstance(data, dict) else {}
    if d.get("line_name") or not s_(d.get("line")):
        return d
    out = dict(d)
    row, _why = soft(lambda: SC._line_row(reads, (SC._numbers(d.get("line")) or [d.get("line")])[0]))
    if row and row.get("name"):
        out["line_name"] = s_(row.get("name"))
    return out


def _screen_words(reads: L.Reads, s: dict, cid: str) -> dict[str, Any]:
    """cndScreenWords_: the phone screen's words as the Hiring record filed them, turn by turn when the text carries
    its speakers, with the screening line when one of them speaks."""
    words = s_(s.get("transcripttext"))
    turns = bool(_TURN_RE.search(words))
    line = ""
    if turns:
        sep = "[" + L._JS_WS + "().-]*"
        for d in SCREEN_LINES:
            spoken = re.compile(r"^" + _WS + r"*\[[^\]]*\]" + _WS + r"*\+?1?" + sep + sep.join(d) + _WS + r"*:",
                                re.M | _A)
            if not line and spoken.search(words):
                line = "+1" + d
    return _line_named(reads, {"call_id": cid, "at": s_(s.get("transcriptcreated")) or s_(s.get("screendate")),
                               "line": line, "direction": "", "duration_sec": "", "full_transcript": words,
                               "speaker_transcript": words if turns else "", "has_words": bool(words),
                               "kind": "Phone screen"})


def candidate_profile_transcript(sess: L.Session, payload: dict) -> dict[str, Any]:
    """candidateProfileTranscript: the words of one listed call through the transcript read, or of the phone screen
    the Hiring record keeps."""
    ctx = _wide_candidate(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    cid = text(payload.get("id"), 60)
    if not cid:
        return {"status": 400, "message": "id: which call."}
    calls, why = soft(lambda: transcripts_part(sess.reads, ctx).get("calls") or [])
    if why:
        return {"status": 503, "message": "The calls could not be read just now — try again in a minute."}
    hit = next((c for c in calls if c.get("call_id") == cid), None)
    if hit is None:
        return {"status": 404, "message": "This candidate has no such call."}
    got = None
    if cid != "screen":
        got = SC.transcript_read(sess.reads, cid, sess.user)
        spoke = got.get("status") == 200 and bool(got.get("data")) and got["data"].get("has_words") is not False
        if spoke or hit.get("kind") != "Phone screen":
            if got.get("status") != 200:
                return got
            return {"status": 200, "data": scrub(_line_named(sess.reads, got["data"]))}
    # the phone screen: the words the Hiring record filed, when the call's own inboxes no longer hold them
    ev, why = soft(lambda: evidence(sess.reads, ctx["key"]))
    if why:
        return {"status": 503, "message": "The phone screen could not be read just now — try again in a minute."}
    s = (ev or {}).get("screen") or {}
    if not s_(s.get("transcripttext")) and got:
        return {"status": 200, "data": scrub(got["data"])} if got.get("status") == 200 else got
    # the words are a call's words: the read is kept with who asked, as the transcript read keeps its own
    SV.record(sess.user, "candidateProfileTranscript", ctx["key"])
    return {"status": 200, "data": scrub(_screen_words(sess.reads, s, cid))}


def candidate_profile_resume(sess: L.Session, payload: dict) -> dict[str, Any]:
    """candidateProfileResume: the fields the hiring record lacks and the resume answers."""
    ctx = _wide_candidate(sess, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    reads = sess.reads
    return serve("The resume", lambda: data_of(reads, "candidateProfileResume", ctx, lambda: resume_build(reads, ctx)))


def _pack_doors(reads: L.Reads, ctx: dict) -> dict[str, Callable[[], dict[str, Any]]]:
    """cndPackDoors_: each part's door, past its gate, for one candidate."""
    return {"overview": lambda: serve("The candidate", lambda: overview_part(reads, ctx)),
            "actions": lambda: serve("The hiring actions", lambda: actions_part(reads, ctx)),
            "interviews": lambda: serve("The interview plan", lambda: interviews_part(reads, ctx)),
            "documents": lambda: serve("The documents", lambda: documents_part(reads, ctx)),
            "activity": lambda: serve("The activity", lambda: activity_part(reads, ctx)),
            "texts": lambda: texts_door(reads, ctx, {}),
            "transcripts": lambda: serve("The calls", lambda: transcripts_part(reads, ctx))}


def candidate_pack(sess: L.Session, payload: dict) -> dict[str, Any]:
    """candidatePack: every section of one candidate, each its own door's answer; the relay's service or the master."""
    user = sess.user
    if not user or not (user.get("is_service") is True or sc.is_real_master(user)):
        return unknown()
    started = time.monotonic()
    reads = sess.reads
    ctx = candidate_of(reads, payload.get("candidate"))
    if ctx.get("refused"):
        return ctx["refused"]
    doors = _pack_doors(reads, ctx)
    parts: dict[str, Any] = {}
    status: dict[str, Any] = {}
    left: list[str] = []
    for name in CND_PACK_PARTS:
        if time.monotonic() - started > PACK_BUDGET_S:
            status[name] = {"status": 503, "message": NOT_GATHERED}
            left.append(f"{name} ({PAST_BUDGET})")
            continue
        try:
            got = doors[name]()
        except (Defer, hubdb.Unreadable) as e:
            status[name] = {"status": 503, "message": NOT_GATHERED}
            left.append(f"{name} ({str(e)[:120]})")
            continue
        except Exception as e:  # noqa: BLE001 - the pack's own catch
            status[name] = {"status": 503, "message": f"This part could not be read just now ({_why(e)})."}
            continue
        if isinstance(got, dict) and got.get("status") == 200 and got.get("data") is not None:
            parts[name] = got["data"]
            status[name] = {"status": 200}
        else:
            said = got.get("status") if isinstance(got, dict) else None
            status[name] = {"status": int(said) if isinstance(said, (int, float)) and not isinstance(said, bool) and said
                            else 503,
                            "message": gsjs.js_str((got or {}).get("message") or "This part did not answer.")[:200]}
    if not parts:
        raise Defer("no part of this pack could be read here")
    if left:
        log.info("candidatePack: %d part(s) left to their own reads: %s", len(left), "; ".join(left))
    return {"status": 200, "data": {"candidate": ctx["key"], "built_at": gsjs.iso(reads.now), "parts": parts,
                                    "part_status": status}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "candidateProfileRoster": candidate_profile_roster, "candidateProfileOverview": candidate_profile_overview,
    "candidateProfileActions": candidate_profile_actions, "candidateProfileInterviews": candidate_profile_interviews,
    "candidateProfileDocuments": candidate_profile_documents, "candidateProfileDocFile": candidate_profile_doc_file,
    "candidateProfileActivity": candidate_profile_activity, "candidateProfileTexts": candidate_profile_texts,
    "candidateProfileTranscripts": candidate_profile_transcripts,
    "candidateProfileTranscript": candidate_profile_transcript, "candidateProfileResume": candidate_profile_resume,
    "candidatePack": candidate_pack}
POLICY_ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
POLICY: dict[str, dict[str, Any]] = {
    "candidateProfileRoster": {"roles": POLICY_ROLES, "params": {}},
    "candidateProfileOverview": {"roles": POLICY_ROLES, "params": {"candidate": "string"}},
    "candidateProfileActions": {"roles": POLICY_ROLES, "params": {"candidate": "string"}},
    "candidateProfileInterviews": {"roles": POLICY_ROLES, "params": {"candidate": "string"}},
    "candidateProfileDocuments": {"roles": POLICY_ROLES, "params": {"candidate": "string"}},
    "candidateProfileDocFile": {"roles": POLICY_ROLES, "params": {"candidate": "string", "file_id": "string"}},
    "candidateProfileActivity": {"roles": POLICY_ROLES, "params": {"candidate": "string"}},
    "candidateProfileTexts": {"roles": POLICY_ROLES, "params": {"candidate": "string", "with": "string",
                                                                "before": "string"}},
    "candidateProfileTranscripts": {"roles": POLICY_ROLES, "params": {"candidate": "string"}},
    "candidateProfileTranscript": {"roles": POLICY_ROLES, "params": {"candidate": "string", "id": "string"}},
    "candidateProfileResume": {"roles": POLICY_ROLES, "params": {"candidate": "string"}},
    "candidatePack": {"roles": ("admin",), "params": {"candidate": "string"}}}
# the reads each press retires: every section's own action (CND_PART_ACTIONS)
PART_ACTIONS = ("candidateProfileOverview", "candidateProfileActions", "candidateProfileInterviews",
                "candidateProfileDocuments", "candidateProfileActivity", "candidateProfileTexts",
                "candidateProfileTranscripts", "candidateProfileResume")


# ---- for the writes: the records a change lands on, and Python's own facts -------------------------------------------

def records(reads: L.Reads | L.Session, ctx: dict) -> dict[str, Any]:
    """The candidate's Hiring records as the writes change them: each dissolved row and where its facts land."""
    reads = reads_of(reads)
    rid, ref = facts_ref(reads)
    ev = evidence(reads, ctx["key"])
    journey = [r for r in (legacy_rows(reads, HIRING_JOURNEY_TAB) or []) if s_(r.get("candidateid")) == ctx["key"]]
    docs = [r for r in (legacy_rows(reads, DOCS_TAB) or []) if s_(r.get("candidateid")) == ctx["key"]]
    return {"book": rid, "tab": ref.tab, "cand": ev.get("cand"), "analysis": ev.get("analysis") or {},
            "screen": ev.get("screen"), "interview": interview_for(reads, ctx["key"]), "journey": journey,
            "documents": docs}


_EVIDENCE_SLOTS = {TALENT_CANDIDATES_TAB: "cand", TALENT_RESUME_TAB: "analysis", TALENT_PHONE_TAB: "screen"}


def gate_after(reads: L.Reads | L.Session, key: str, changes: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """hubGate_(hubEvidence_(cid)) once these fields are written: {tab: {column: value}} laid over the evidence."""
    reads = reads_of(reads)
    ev = {k: v for k, v in evidence(reads, key).items() if k != "__iv"}
    for tab, fields in (changes or {}).items():
        slot = _EVIDENCE_SLOTS.get(tab)
        if slot is None:
            raise ValueError("the gate reads the candidate, the resume analysis and the phone screen, not " + tab)
        row = dict(ev.get(slot) or {})
        for col, v in (fields or {}).items():
            row["__deleted" if col == "__deleted" else hubdb.norm_key(col)] = entered_text(v)
        ev[slot] = row
    return stage_gate(reads, ev)


def subject_key(tab: str) -> str:
    """hiringRowKey_'s column: the normalised column a dissolved tab's rows are keyed by (the candidate by default)."""
    return HIRING_TAB_KEY.get(tab, "candidateid")


def fact_edits(reads: L.Reads, tab: str, subject: str, fields: dict[str, Any], by: str, evidence_tag: str,
               recorded_at: str) -> list[dict[str, Any]]:
    """hiringLegacyWrite_ as app.edits keeps it: one appended fact per field, laid here until the copy holds it."""
    import writes as W  # noqa: PLC0415 - the writes module reads the scope this module feeds
    rid, ref = facts_ref(reads_of(reads))
    sub = s_(subject)
    ev = gsjs.trim(evidence_tag)
    if not tab or not sub or not ev.startswith(FACT_EVIDENCE):
        raise ValueError("a fact needs its tab, its subject and this engine's evidence")
    have = {gsjs.trim(gsjs.js_str(h)) for h in ref.headers}
    missing = [h for h in FACT_HEADS if h not in have]
    if missing:
        raise hubdb.Unreadable("the runtime book's Facts have no " + ", ".join(missing) + " column")
    out = []
    for col, val in fields.items():
        if not col:
            continue
        key = "__deleted" if col == "__deleted" else hubdb.norm_key(col)
        source = "dissolution:" + tab + "." + key
        cells = {"Fact Key": "legacy." + tab + "." + key, "Subject ID": sub,
                 "Value": "" if val is None else gsjs.js_str(val), "Source": source, "Evidence": ev,
                 "Recorded At": recorded_at,
                 "Recorded By": s_(by) if s_(by) and s_(by) != FACT_DISSOLUTION_BY else FACT_RECORDED_BY}
        out.append(W.kept_record(rid, ref.tab, "append", FACT_KEY_MATCH, "\x1f".join((sub, source, ev)), sub, cells))
    return out
