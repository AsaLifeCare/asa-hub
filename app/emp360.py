"""Employee 360 (apps-script/Emp360.gs) answered off asa-hub-db: emp360Detail's six tabs for one employee — the
Employee Database Master row (cert_docs' reading of it), the staff documentation, call-off, HR, daily-notes and request
tabs of the estate, and the certification matrix's own picture. A cell the copy withholds is Apps Script's to show."""
from __future__ import annotations

from typing import Any, Callable

import cert_docs as CD
import gsjs
import house_tables as HT
import hubdb
import locations as L
import staff as SP
from scope import Defer

APP_ID = "emp360"
STAFF_DOCS_TAB = "Employee - Staff Documentation"
CALL_OFF_TAB = "Employee - Call Off"
HR_TAB = "Employee - HR"
DAILY_NOTES_TAB = "Employee - Daily Notes"
REQUESTS_TAB = "Requests"
MASTER_DATA_PROP = "EMP360_MASTER_DATA_ID"
WORK_QUEUE_PROP = "EMP360_WORK_QUEUE_ID"
DETAIL_TABS = ("info", "docs", "training", "background", "hr", "activity")
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
WITHHELD = "[withheld"
# EMP360_DATA_COLUMNS: (key, label, group, edit); the legacy Login/Password are left out on purpose
DATA_COLUMNS: tuple[tuple[str, str, str, bool], ...] = (
    ("status", "Status", "employment", True),
    ("employee_id", "Employee ID", "employment", True),
    ("first_name", "First Name", "employment", True),
    ("last_name", "Last Name", "employment", True),
    ("address", "Address", "contact", True),
    ("city", "City", "contact", True),
    ("state", "State", "contact", True),
    ("zip", "Zip", "contact", True),
    ("phone_number", "Phone Number", "contact", True),
    ("email", "Email", "contact", True),
    ("referral", "Referral", "employment", True),
    ("referral_paid", "Referral Paid?", "employment", True),
    ("start_date_doc", "Start Date (doc)", "employment", True),
    ("start_date_first_day", "Start Date (first day)", "employment", True),
    ("end_date_last_day", "End Date (last day)", "employment", True),
    ("job_app_date", "Job App Date", "docs", True),
    ("resume", "Resume", "docs", True),
    ("attestation_date", "Attestation Date", "docs", True),
    ("i_9_date", "I-9 Date", "docs", True),
    ("i_9_completed", "I-9 Completed", "docs", True),
    ("i_9_type_1", "I-9 Type 1", "docs", True),
    ("i_9_1_exp_date", "I-9 1 Exp Date", "docs", True),
    ("i_9_type_2", "I-9 Type 2", "docs", True),
    ("i_9_2_exp_date", "I-9 2 Exp Date", "docs", True),
    ("w_4_date", "W-4 Date", "docs", True),
    ("hipaa_form_date", "HIPAA Form Date", "docs", True),
    ("pay_auth_form_date", "Pay Auth Form Date", "docs", True),
    ("hs_diploma", "HS Diploma", "docs", True),
    ("driver", "Driver", "docs", True),
    ("dl", "DL#", "docs", False),  # withheld in the copy and the table: never typed here
    ("license_exp_date", "License Exp Date", "docs", True),
    ("driver_s_abstract_original", "Driver's Abstract (Original)", "docs", True),
    ("driver_s_abstract_latest", "Driver's Abstract (Latest)", "docs", True),
    ("insurance_exp_date", "Insurance Exp Date", "docs", True),
    ("sam", "SAM", "background", True),
    ("oig", "OIG", "background", True),
    ("abuser_registry", "Abuser Registry", "background", True),
    ("sex_offender", "Sex Offender", "background", True),
    ("offender", "Offender", "background", True),
    ("nurse_aide", "Nurse Aide", "background", True),
    ("exclusions_database", "Exclusions Database", "background", True),
    ("bci_fbi", "BCI/FBI", "background", True),
    ("bci_check_date", "BCI Check Date", "background", True),
    ("rapback_entry_date", "Rapback Entry Date", "background", True),
    ("dodd_8_hour_exp", "DODD 8-Hour Exp", "training", True),
    ("cpr_exp_date", "CPR Exp Date", "training", True),
    ("med_1_exp_date", "Med 1 Exp Date", "training", True),
    ("med_2_exp_date", "Med 2 Exp Date", "training", True),
    ("med_3_exp_date", "Med 3 Exp Date", "training", True),
    ("mandt_exp_date", "Mandt Exp Date", "training", True),
    ("money_mgt_date", "Money Mgt Date", "training", True),
)
COLUMN = {c[0]: c for c in DATA_COLUMNS}
# Certs.gs CERT_MASTER_COLUMNS: the floor when ist_cert_master_columns names none
CERT_MASTER_COLUMNS = {"cpr_exp_date": "cpr", "dodd_8_hour_exp": "dodd", "med_1_exp_date": "med1",
                       "med_2_exp_date": "med2", "med_3_exp_date": "med3", "money_mgt_date": "money",
                       "mandt_exp_date": "mandt"}
DOCS_SCORE = ("job_app", "attestation", "i9_form", "i9_type_1", "i9_type_2", "w4_form", "hipaa_form", "pay_auth_form",
              "hs_diploma", "driver_license", "drive_abstract_last", "car_insurance")
BACKGROUND_SCORE = ("sam", "oig", "abuser", "sex_offender", "offender", "nurse_aide", "exclusions", "bci", "rapback")
SHOWN = 50

s_ = gsjs.str_


def is_writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and gsjs.js_str((user or {}).get("role")) in ("admin", "manager")


def editable(key: str) -> bool:
    """emp360EditableField_."""
    if CD.pii(key):
        return False
    col = COLUMN.get(key)
    return bool(col and col[3])


# ---- who this is: the roster person and the Master row --------------------------------------------------------------

def roster_person(reads: L.Reads, person_id: str) -> dict | None:
    """emp360RosterPerson_: the merged roster without the plans' clients, else the raw roster."""
    try:
        people = SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads)))
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - the raw roster answers, as Apps Script's catch has it
        people = SP._people(reads)
    rid = gsjs.or_text(person_id)
    return next((p for p in people or [] if ("undefined" if p.get("id") is None else gsjs.js_str(p["id"])) == rid),
                None)


def master_id(reads: L.Reads, found: dict) -> str | None:
    """The Master row's id as emp360ReadTab_ names it: 'r' and its sheet row."""
    if not found.get("row"):
        return None
    return "r" + str(CD.master_sheet(reads)["raw"][found["at"]][0])


def resolve(reads: L.Reads, payload: dict) -> dict[str, Any]:
    """emp360Resolve_: a roster personId or an estate employeeId, never a loose name; two rows on one key refuse."""
    person_id = s_(SP._or(payload.get("personId"), payload.get("person_id")))
    employee_id = s_(SP._or(payload.get("employeeId"), payload.get("employee_id")))
    person = None
    if person_id:
        person = roster_person(reads, person_id)
        if person is None:
            return {"error": {"status": 404, "message": f'No person "{person_id}" in the roster.'}}
    name = s_(person.get("name")) if person else ""
    if not person_id and not employee_id:
        return {"error": {"status": 400, "message": "A personId (roster) or an employeeId (estate) is required — never "
                                                    "a loose name."}}
    found = CD.find_master_row(reads, name, "" if person_id else employee_id)
    if found.get("conflict"):
        who = f'employee id "{employee_id}"' if employee_id and not person_id else f'"{name}"'
        return {"error": {"status": 409, "message": f"{found['conflict']} rows in the Employee Database match {who}. "
                                                    "Merging people is not something to do automatically — sort the "
                                                    "duplicate out first."}}
    m = found.get("row") or {}
    header = {"personId": s_(person.get("id")) if person else "",
              "name": name if person else s_(SP._or(m.get("employee"), m.get("name"))),
              "role": s_(person.get("role")) if person else "",
              "status": s_(person.get("status")) if person else "",
              "avatar": s_(person.get("avatar")) if person else "",
              "email": s_(person.get("email")) if person else s_(m.get("email")),
              "phone": s_(person.get("phone")) if person else s_(m.get("phone_number")),
              "employeeId": s_(m.get("employee_id")) or employee_id}
    return {"person": header, "master": found.get("row"), "at": found.get("at"), "matchedBy": found.get("by") or "",
            "id": master_id(reads, found)}


# ---- the tabs -------------------------------------------------------------------------------------------------------

def read_tab(reads: L.Reads, prop: str, tab: str) -> list[dict]:
    """emp360ReadTab_: estateKey_ keys, estateCell_ cells, the protected columns dropped at read, blank rows out."""
    def read() -> list[dict]:
        sid = reads.db.prop(prop)
        if not sid:
            raise hubdb.Unreadable(f"no {prop} is declared in the depot")
        ref = HT.tab_of(reads, sid, tab, f"the estate's {tab}")
        if ref is None:
            return []
        keys = [hubdb.estate_key(h) for h in ref.headers]
        # a repeated header's earlier columns count toward a blank row; the key is the last column's, as in getValues
        twin = [bool(SP.TWIN_KEY.fullmatch(h)) for h in ref.headers]
        out = []
        for rn, raw in reads.db.rows(ref):
            row: dict[str, Any] = {"id": f"r{rn}"}
            empty = True
            for k, h, t in zip(keys, ref.headers, twin):
                if not k or CD.pii(k):
                    continue
                v = hubdb.estate_cell(hubdb.typed(raw.get(h), "estate"))
                if v:
                    empty = False
                if not t:
                    row[k] = v
            if not empty:
                out.append(row)
        return out
    return reads.once(f"e360:{prop}:{tab}", read)


def mine(rows: list[dict], key: str, name: str) -> list[dict]:
    return [r for r in rows if SP.name_hit(r.get(key), name)][:SHOWN]


def scorecard(row: dict) -> list[dict]:
    """emp360Scorecard_: every column that is not a raw data column is a flag, so a renamed flag still shows."""
    out = []
    for k, v0 in row.items():
        if k in ("id", "employee", "name") or CD.pii(k) or k in COLUMN:
            continue
        v = gsjs.trim(gsjs.or_blank(v0))
        state = "ok" if v == "1" else "warning" if v == "0.5" else "missing" if v == "0" else ""
        out.append({"key": k, "label": k.replace("_", " "), "value": v, "state": state})
    return out


def training_columns(reads: L.Reads) -> list[tuple[str, str, str, bool]]:
    """emp360TrainingColumns_: the Master date columns ist_cert_master_columns names, schema order first."""
    schema = [c for c in DATA_COLUMNS if c[2] == "training"]
    try:
        pairs = SP.cfg_pairs(reads, "ist_cert_master_columns")
        cols = pairs["map"] if pairs["order"] else CERT_MASTER_COLUMNS
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - certMasterColumns_'s own floor, as its catch has it
        cols = CERT_MASTER_COLUMNS
    out = [c for c in schema if c[0] in cols]
    for key, course in cols.items():
        if any(c[0] == key for c in out):
            continue
        out.append((key, SP.cert_label(reads, course) + " Exp", "training", False))
    return out or schema


def fields(reads: L.Reads, row: dict, group: str, edit: bool) -> list[dict]:
    """emp360Fields_."""
    columns = training_columns(reads) if group == "training" else DATA_COLUMNS
    return [{"key": k, "label": label, "value": s_(row.get(k)), "editable": edit and on}
            for k, label, g, on in columns if g == group]


def build_docs(reads: L.Reads, name: str, row: dict) -> dict[str, Any]:
    """emp360BuildDocs_."""
    return {"fields": fields(reads, row, "docs", True),
            "scorecard": [s for s in scorecard(row) if s["key"] in DOCS_SCORE],
            "staffDocs": mine(read_tab(reads, MASTER_DATA_PROP, STAFF_DOCS_TAB), "name", name)}


def build_training(reads: L.Reads, name: str, row: dict) -> dict[str, Any]:
    """emp360BuildTraining_: the certification matrix's own picture, never a second derivation."""
    certs: dict[str, Any] = {}
    try:
        k = gsjs.name_key(name)
        pic = SP.cert_picture(reads, k) if k else None
        for c, got in ((pic or {}).get("certs") or {}).items():
            certs[c] = {"label": SP.cert_label(reads, c), "status": got.get("status"),
                        "expires": gsjs.or_text(got.get("expires")), "category": gsjs.or_text(got.get("category"))}
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - no picture, as Apps Script's catch has it
        certs = {}
    return {"certs": certs, "fields": fields(reads, row, "training", True)}


def build_background(reads: L.Reads, row: dict) -> dict[str, Any]:
    """emp360BuildBackground_."""
    return {"fields": fields(reads, row, "background", True),
            "scorecard": [s for s in scorecard(row) if s["key"] in BACKGROUND_SCORE]}


def build_hr(reads: L.Reads, name: str) -> dict[str, Any]:
    """emp360BuildHr_."""
    return {"callOffs": mine(read_tab(reads, MASTER_DATA_PROP, CALL_OFF_TAB), "employee_name", name),
            "hrRecords": mine(read_tab(reads, MASTER_DATA_PROP, HR_TAB), "employees_involved", name)}


def build_activity(reads: L.Reads, name: str) -> dict[str, Any]:
    """emp360BuildActivity_."""
    return {"supportRequests": mine(read_tab(reads, WORK_QUEUE_PROP, REQUESTS_TAB), "requestor", name),
            "dailyNotes": mine(read_tab(reads, MASTER_DATA_PROP, DAILY_NOTES_TAB), "dsp_name", name)}


def withholds(v: Any) -> bool:
    """A cell the copy withholds, anywhere in an answer: Apps Script shows it whole."""
    if isinstance(v, str):
        return v.startswith(WITHHELD)
    if isinstance(v, dict):
        return any(withholds(x) for x in v.values())
    if isinstance(v, list):
        return any(withholds(x) for x in v)
    return False


def detail(sess: L.Session, payload: dict) -> dict[str, Any]:
    """emp360Detail: one 360 tab for one employee; an unknown tab is a 400, never a guess."""
    if not is_writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    tab = s_(p.get("tab")) or "info"
    if tab not in DETAIL_TABS:
        return {"status": 400, "message": f'Unknown tab "{tab}". Valid: {", ".join(DETAIL_TABS)}.'}
    reads = sess.reads
    got = resolve(reads, p)
    if got.get("error"):
        return got["error"]
    row = got["master"]
    data: dict[str, Any] = {"person": got["person"], "matched": bool(row), "matchedBy": got["matchedBy"],
                            "masterRow": got["id"] if row else None, "tab": tab}
    if not row:
        data["message"] = "No row in the Employee Database matches this person."
        return {"status": 200, "data": data}
    name = got["person"]["name"]
    if tab == "info":
        data["info"] = {"contact": fields(reads, row, "contact", True),
                        "employment": fields(reads, row, "employment", True)}
    elif tab == "docs":
        data["docs"] = build_docs(reads, name, row)
    elif tab == "training":
        data["training"] = build_training(reads, name, row)
    elif tab == "background":
        data["background"] = build_background(reads, row)
    elif tab == "hr":
        data["hr"] = build_hr(reads, name)
    else:
        data["activity"] = build_activity(reads, name)
    if withholds(data.get(tab)) or withholds(data["person"]):
        raise Defer("the copy withholds a cell this Employee 360 tab shows whole")
    return {"status": 200, "data": data}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"emp360Detail": detail}
POLICY: dict[str, dict[str, Any]] = {"emp360Detail": {"roles": ("admin", "manager")}}
