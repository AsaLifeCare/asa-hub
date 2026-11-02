"""The Compliance Engine (Requirements.gs, RequirementStates.gs) read from Postgres: the obligations catalogue
(app.resource_rows `requirements`, uploaded from the requirements house; the code's catalogue when it holds none) and
the materialized states, one row per person and requirement (`requirementStates`, from requirement_states). Every
reader of either (Staff, My Profile, My Work, Cert Docs) reads them from here once they are uploaded."""
from __future__ import annotations

import re
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import resource_rows as RR
import staff as SP

APP_ID = "compliance-engine"
REQS, STATES = "requirements", "requirementStates"
REQS_TAB, STATES_TAB = "requirements", "requirement_states"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
# REQUIREMENTS_HEADER: append only, positional against the live tab
HEADER = ("req_id", "label", "category", "applies_to", "evidence", "header", "date_source", "credential", "warn_days",
          "consequence", "na_eligible", "enabled", "sms_text", "notes", "updated_at", "updated_by", "max_attempts",
          "frequency")
STATES_HEADER = ("login", "person_key", "person_name", "req_id", "state", "expires", "days_left", "prev_state", "since",
                 "computed_at", "tenant")

_DL_SMS = ("Hi {first_name}, this is {sender}. Your {credential} is about to expire. Once it expires, you're not "
           "legally allowed to drive, and you may have to take additional tests to get it renewed.\n\nHere's what "
           "you'll need to take with you to your nearest BMV:\n\n -Your current driver's license\n -Proof of your "
           "Social Security Number (like your SS card or W-2)\n -Two documents showing your Ohio address (utility "
           "bill, bank statement, etc.)\n\nWhen you're done you can upload your new license to our document portal."
           "\n\nhttps://docs.google.com/forms/d/e/1FAIpQLSeyzahxLs37-qejU19Hynh4jFGwxVsWGgnBPArflgc2bmV3dA/viewform")
_INS_SMS = ("Hi {first_name}, this is {sender}. Your {credential} is about to expire in {days_left} days. Once it "
            "expires, you're not legally allowed to drive our clients in your vehicle.\n\nPlease renew it as soon as "
            "possible. If you do not plan to renew please let us know.\nWhen you're done you can upload your new "
            "insurance card to our document portal.\n\nhttps://docs.google.com/forms/d/e/1FAIpQLSeami3JUtuQXCGHDKXc_"
            "SPbrF10TZYTLunf3ge-ZKSD4DeYqQ/viewform?usp=sf_link")


def _r(req_id: str, label: str, category: str, evidence: str, header: str, date_source: str, credential: str,
       warn_days: str, consequence: str, na: str, sms_text: str = "", notes: str = "") -> dict[str, str]:
    return {"req_id": req_id, "label": label, "category": category, "applies_to": "staff", "evidence": evidence,
            "header": header, "date_source": date_source, "credential": credential, "warn_days": warn_days,
            "consequence": consequence, "na_eligible": na, "enabled": "yes", "sms_text": sms_text, "notes": notes}


# REQUIREMENTS_CATALOG: the fallback when the tab cannot be read or holds no row
CATALOG: tuple[dict[str, str], ...] = (
    _r("dodd", "DODD 8-Hour", "training", "DODD 8-hour certificate", "Train - DODD", "DODD 8-Hour Exp", "dodd", "30",
       "dodd_expiring", "no"),
    _r("cpr", "CPR / First Aid", "training", "CPR / First Aid card", "Train - CPR", "CPR Exp Date", "cpr", "30",
       "cpr_expiring", "no"),
    _r("med1", "Med Delivery 1", "training", "Med Del Level 1 certificate", "Train - Med Del 1", "Med 1 Exp Date",
       "med1", "30", "med1_expiring", "no"),
    _r("med2", "Med Delivery 2", "training", "Med Del Level 2 certificate", "Train - Med Del 2", "Med 2 Exp Date",
       "med2", "30", "med2_expiring", "no"),
    _r("med3", "Med Delivery 3", "training", "Med Del Level 3 certificate", "Train - Med Del 3", "Med 3 Exp Date",
       "med3", "30", "med3_expiring", "no"),
    _r("mandt", "Mandt", "training", "MANDT certificate", "Train - MANDTT", "Mandt Exp Date", "mandt", "30",
       "mandt_expiring", "no"),
    _r("mais", "MAIS Certification", "training", "MAIS certificate", "", "", "mais", "30", "mais_expiring", "no"),
    _r("money", "Money Management", "training", "Money Management certificate", "", "money mgt date", "money", "30",
       "money_expiring", "no"),
    _r("driver_license", "Driver's License", "documents", "valid driver's license", "Driver License",
       "License Exp Date", "Driver License Exp Date", "60", "drivers_license_expiring", "yes", _DL_SMS,
       "OFF. The original sent every one of these to a single hardcoded number instead of to the person — read it, "
       "then enable."),
    _r("car_insurance", "Car Insurance", "documents", "valid auto insurance card", "Car Insurance", "Insurance Exp Date",
       "Insurance Exp Date", "15", "car_insurance_expiring", "yes", _INS_SMS,
       'OFF. The original read "our car insurance is about to expire" — "your" is meant, and it has been going out '
       "that way. Corrected here."),
    _r("i9_type_1", "I-9 Type 1", "documents", "I-9 document (type 1)", "i9 (Type 1)", "I-9 1 Exp Date", "", "", "",
       "no"),
    _r("i9_type_2", "I-9 Type 2", "documents", "I-9 document (type 2)", "i9 (Type 2)", "I-9 2 Exp Date", "", "", "",
       "no"),
    _r("drive_abstract", "Driver's Abstract", "documents", "current driver's abstract", "Drive Abstract (last)",
       "Driver's Abstract (Latest)", "", "", "", "yes"),
    _r("sam", "SAM", "background", "SAM clearance", "SAM", "", "", "", "", "no"),
    _r("oig", "OIG", "background", "OIG clearance", "OIG", "", "", "", "", "no"),
    _r("abuser", "Abuser Registry", "background", "Abuser registry check", "Abuser", "", "", "", "", "no"),
    _r("sex_offender", "Sex Offender", "background", "Sex offender registry check", "Sex Offender", "", "", "", "", "no"),
    _r("offender", "Offender", "background", "Offender registry check", "Offender", "", "", "", "", "no"),
    _r("nurse_aide", "Nurse Aide Registry", "background", "Nurse aide registry check", "Nurse Aide", "", "", "", "",
       "no"),
    _r("exclusions", "Exclusions Database", "background", "Exclusions database check", "Exclusions", "", "", "", "",
       "no"),
    _r("bci", "BCI/FBI", "background", "BCI/FBI check", "BCI", "BCI Check Date", "", "", "", "no"),
    _r("rapback", "Rapback", "background", "Rapback enrollment", "Rapback", "Rapback Entry Date", "", "", "", "no"),
    _r("job_app", "Job Application", "onboarding", "signed application", "Job App", "", "", "", "", "no"),
    _r("attestation", "Attestation", "onboarding", "signed attestation", "Attestation", "", "", "", "", "no"),
    _r("i9_form", "I-9 Form", "onboarding", "completed I-9", "i9 Form", "", "", "", "", "no"),
    _r("w4_form", "W-4 Form", "onboarding", "completed W-4", "W4 Form", "", "", "", "", "no"),
    _r("hipaa_form", "HIPAA Form", "onboarding", "signed HIPAA form", "HIPAA Form", "", "", "", "", "no"),
    _r("pay_auth_form", "Pay Authorization", "onboarding", "signed pay authorization", "Pay Auth Form", "", "", "", "",
       "no"),
    _r("hs_diploma", "HS Diploma", "onboarding", "HS diploma or equivalent", "HS Diploma", "", "", "", "", "yes"),
    _r("referral_paid", "Referral Paid", "admin", "referral bonus paid", "Referral Paid", "", "", "", "", "no"),
)

s_ = gsjs.str_


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and s_((user or {}).get("role")) in ("admin", "manager") and not (user or {}).get("is_service")


def owned(db: Any, resource: str = STATES) -> bool:
    return RR.uploaded(db, resource)


def _text_rows(reads: L.Reads, resource: str) -> list[tuple[str, dict[str, str]]]:
    """(row_key, every cell as text) of the resource's rows, in their order."""
    cols = RR.columns(reads, resource)
    return [(k, {h: s_(hubdb.typed(c.get(h), "hub")) for h in cols if h}) for k, c in RR.table_rows(reads, resource)]


def catalogue(reads: L.Reads) -> dict[str, Any]:
    """requirementsAll_: the tab's valid rows (an id and a label), else the code's catalogue — with its source."""
    rows = [r for _k, r in _text_rows(reads, REQS) if r.get("req_id") and r.get("label")]
    return {"source": "tab", "rows": rows} if rows else {"source": "fallback", "rows": [dict(r) for r in CATALOG]}


def states_grid(reads: L.Reads) -> dict[str, Any]:
    """reqStatesListValues_(0) off Postgres: { hdr, values } as the sheet's copy gives them."""
    cols = RR.columns(reads, STATES)
    return {"hdr": [h for h in cols if h],
            "values": [[hubdb.typed(c.get(h), "hub") for h in cols if h] for _k, c in RR.table_rows(reads, STATES)]}


def list_from(hdr: list, values: list, limit: int, state: str, person: str, key: str) -> list[dict[str, str]]:
    """reqStatesListFrom_: newest first, by header name; `key` keeps one person's rows (the fold of person_key, else of
    person_name)."""
    at: dict[str, int] = {}
    for i, h in enumerate(hdr or []):
        at.setdefault(s_(h), i)

    def cell(row: list, col: str) -> str:
        i = at.get(col)
        return s_(row[i]) if i is not None and i < len(row) else ""

    out: list[dict[str, str]] = []
    for row in reversed(values or []):
        if len(out) >= limit:
            break
        if key and (SP.fold(cell(row, "person_key")) or SP.fold(cell(row, "person_name"))) != key:
            continue
        if state and cell(row, "state").lower() != state:
            continue
        if person and person not in cell(row, "person_name").lower():
            continue
        out.append({c: cell(row, c) for c in ("person_key", "person_name", "req_id", "state", "expires", "days_left",
                                               "prev_state", "since", "computed_at", "tenant")})
    return out


# ---- the doors ----------------------------------------------------------------------------------------------

def requirements_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """requirementsList: the catalogue and where it was read from."""
    if not writer(sess.user):
        return dict(DENIED)
    got = catalogue(sess.reads)
    return {"status": 200, "data": {"source": got["source"], "rows": got["rows"]}}


def states_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """requirementStatesList: the stored states, newest first, filtered by state or person — every person's to the
    real master, the caller's own to anyone else (complianceWhose_)."""
    import cert_docs as CD  # noqa: PLC0415 - complianceDocsRefusal_
    import scope as sc  # noqa: PLC0415
    user = sess.user or {}
    if not writer(user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    if sc.is_real_master(user):
        whose: dict[str, Any] = {"all": True, "scope": "all", "self": None}
    else:
        me = SP.compliance_self(sess.reads, user)
        if not me["key"]:
            return CD.refusal(me)
        whose = {"all": False, "scope": "own", "self": me}
    state, person = s_(p.get("state")).lower(), s_(p.get("person")).lower()
    m = re.match(r"^\s*([+-]?\d+)", gsjs.or_blank(p.get("limit")))
    limit = min(2000, max(1, int(m.group(1)) if m and int(m.group(1)) else 500))
    try:
        grid = states_grid(sess.reads)
    except Exception:  # noqa: BLE001 - nothing listed rather than an empty matrix
        return {"status": 503, "message": "The requirement states could not be read just now — nothing is listed "
                                          "rather than an empty matrix.", "scope": whose["scope"]}
    values = grid["values"][-5000:] if whose["all"] else grid["values"]
    rows = list_from(grid["hdr"], values, limit, state, person, "" if whose["all"] else whose["self"]["key"])
    return {"status": 200, "data": {"rows": rows, "total": len(rows), "scope": whose["scope"],
                                    "self": "" if whose["all"] else whose["self"]["name"]}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "requirementsList": requirements_list, "requirementStatesList": states_list}
POLICY: dict[str, dict[str, Any]] = {"requirementsList": {"roles": ("admin", "manager")},
                                     "requirementStatesList": {"roles": ("admin", "manager")}}
