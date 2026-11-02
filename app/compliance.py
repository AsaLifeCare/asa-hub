"""Compliance (Compliance.gs) read off asa-hub-db: the scorecard and the documents matrix counted over the Employee
Database Master's active rows (the real master's every row, anyone else's own), and the staff-docs review queue (App
Data › PendingReviews) with each review's Master date beside it. The verdicts are kept in Postgres (app.resource_rows
`complianceReviews`, uploaded from the compliance_reviews tab); the verdict's door is in app/compliance_writes.py."""
from __future__ import annotations

import functools
import math
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

import candidates as CND
import cert_docs as CD
import client_writes as CW
import gsjs
import house_tables as HT
import hubdb
import locations as L
import resource_rows as RR
import scope as sc
import staff as SP
from gsjs import NY, SheetDate
from scope import Defer

APP_ID = "compliance"
MASTER_TAB = "Master"
PENDING_TAB = "PendingReviews"
APPDATA_PROP = "COMPLIANCE_APPDATA_ID"
REVIEWS_TAB = "compliance_reviews"
RESOURCE = "complianceReviews"
# positional: new columns are appended and only blank header cells are ever named
REVIEWS_HEADER = ("id", "createdAt", "submitter", "docType", "dateField", "aiExpDate", "aiCertDate", "aiConfidence",
                  "isCandidate", "sourceRow", "verdict", "note", "resolvedBy", "resolvedAt")
# 'ssn' is a prefix block: the sheet grows derived SSN columns
PII_EXACT = ("date of birth", "dob", "birth date", "login", "password", "social security", "social security number")
ROLES = ("admin", "manager")


def _item(id_: str, header: str, label: str, category: str, date_header: str, na: bool) -> dict[str, Any]:
    return {"id": id_, "header": header, "label": label, "category": category, "dateHeader": date_header,
            "naEligible": na}


# COMPLIANCE_ITEMS: headers match exactly, never normalized ('i9 (Type 1)' is not 'i9 (Type 2)')
ITEMS: tuple[dict[str, Any], ...] = (
    _item("referral_paid", "Referral Paid", "Referral Paid", "admin", "", False),
    _item("job_app", "Job App", "Job Application", "onboarding", "", False),
    _item("attestation", "Attestation", "Attestation", "onboarding", "", False),
    _item("i9_form", "i9 Form", "I-9 Form", "onboarding", "", False),
    _item("w4_form", "W4 Form", "W-4 Form", "onboarding", "", False),
    _item("hipaa_form", "HIPAA Form", "HIPAA Form", "onboarding", "", False),
    _item("pay_auth_form", "Pay Auth Form", "Pay Authorization", "onboarding", "", False),
    _item("hs_diploma", "HS Diploma", "HS Diploma", "onboarding", "", True),
    _item("i9_type_1", "i9 (Type 1)", "I-9 Type 1", "documents", "I-9 1 Exp Date", False),
    _item("i9_type_2", "i9 (Type 2)", "I-9 Type 2", "documents", "I-9 2 Exp Date", False),
    _item("driver_license", "Driver License", "Driver's License", "documents", "License Exp Date", True),
    _item("drive_abstract", "Drive Abstract (last)", "Driver's Abstract", "documents", "Driver's Abstract (Latest)",
          True),
    _item("car_insurance", "Car Insurance", "Car Insurance", "documents", "Insurance Exp Date", True),
    _item("sam", "SAM", "SAM", "background", "", False),
    _item("oig", "OIG", "OIG", "background", "", False),
    _item("abuser", "Abuser", "Abuser Registry", "background", "", False),
    _item("sex_offender", "Sex Offender", "Sex Offender", "background", "", False),
    _item("offender", "Offender", "Offender", "background", "", False),
    _item("nurse_aide", "Nurse Aide", "Nurse Aide Registry", "background", "", False),
    _item("exclusions", "Exclusions", "Exclusions Database", "background", "", False),
    _item("bci", "BCI", "BCI/FBI", "background", "BCI Check Date", False),
    _item("rapback", "Rapback", "Rapback", "background", "Rapback Entry Date", False),
    _item("train_dodd", "Train - DODD", "DODD 8-Hour", "training", "DODD 8-Hour Exp", False),
    _item("train_cpr", "Train - CPR", "CPR / First Aid", "training", "CPR Exp Date", False),
    _item("train_med_1", "Train - Med Del 1", "Med Del Level 1", "training", "Med 1 Exp Date", False),
    _item("train_med_2", "Train - Med Del 2", "Med Del Level 2", "training", "Med 2 Exp Date", False),
    _item("train_med_3", "Train - Med Del 3", "Med Del Level 3", "training", "Med 3 Exp Date", False),
    _item("train_mandt", "Train - MANDTT", "Mandt", "training", "Mandt Exp Date", False),
)
MATRIX_TABS = ("onboarding", "documents", "background", "training")
ACTIVE_STATUSES = ("yes", "other", "active")
# skipped and named in every answer: a silent skip looks like a missed person
NON_PERSON_LABELS = ("OPEN", "WORKSHOP", "FAMILY", "NURSE", "LOCATION", "NEW", "TBD", "VACANT", "N/A", "NA", "TEST")
STATE_KEYS = ("ok", "warning", "missing", "na", "other", "blank")
_ISO_HEAD = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})")
_US_HEAD = re.compile(r"^([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})")

s_ = gsjs.str_


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and (user or {}).get("role") in ROLES


def pii_blocked(header: Any) -> bool:
    """compliancePiiBlocked_: separators collapse first, so 'Date_of_Birth' cannot slip past."""
    h = gsjs.trim(re.sub(r"[^a-z0-9]+", " ", gsjs.or_text(header).lower()))
    if not h:
        return False
    return "ssn" in h or h in PII_EXACT


def non_person(name: Any) -> bool:
    """complianceNonPerson_."""
    n = gsjs.trim(gsjs.or_text(name)).upper()
    return not n or n in NON_PERSON_LABELS


# ---- the pure helpers ------------------------------------------------------------------------------------------------

def _local_ms(y: int, m0: int, d: int) -> float | None:
    """new Date(y, m0, d): local midnight in the script's zone, an overflow rolled as JavaScript rolls it."""
    if 0 <= y <= 99:
        y += 1900
    y, m0 = y + m0 // 12, m0 % 12
    try:
        day = date(y, m0 + 1, 1) + timedelta(days=d - 1)
        return datetime(day.year, day.month, day.day, tzinfo=NY).timestamp() * 1000.0
    except (ValueError, OverflowError):
        return None


def date_ms(v: Any) -> float | None:
    """complianceDateMs_: local dates — new Date('yyyy-MM-dd') parses as UTC and loses a day west of Greenwich."""
    if v is None or v == "":
        return None
    if isinstance(v, SheetDate):
        return v.at.timestamp() * 1000.0
    s = gsjs.trim(gsjs.js_str(v))
    if not s:
        return None
    m = _ISO_HEAD.match(s)
    if m:
        return _local_ms(int(m.group(1)), int(m.group(2)) - 1, int(m.group(3)))
    m = _US_HEAD.match(s)
    if m:
        return _local_ms(int(m.group(3)), int(m.group(1)) - 1, int(m.group(2)))
    return SP._js_ms(s)


def days(ms: float, now_ms: float) -> int:
    """complianceDays_."""
    return math.floor((ms - now_ms) / 86400000)


def iso_day(ms: float) -> str:
    """complianceIsoDay_."""
    return gsjs.iso(datetime.fromtimestamp(ms / 1000.0, timezone.utc))[:10]


def state(v: Any) -> str:
    """complianceState_: anything but 1 / 0.5 / 0 / n/a is 'other' — reported, never counted as compliant."""
    s = gsjs.trim("" if v is None else gsjs.js_str(v))
    if s == "":
        return "blank"
    if s == "1":
        return "ok"
    if s == "0.5":
        return "warning"
    if s == "0":
        return "missing"
    if s.lower() in ("n/a", "na"):
        return "na"
    return "other"


def now_ms(reads: L.Reads) -> float:
    return reads.now.timestamp() * 1000.0


# ---- the Employee Database Master ------------------------------------------------------------------------------------

def master_tab(reads: L.Reads) -> str:
    """complianceMasterTab_: the `ist_cert_source_tabs` cell wins, so Certs and Emp360 move with any rename."""
    try:
        return SP.cert_source_tab(reads, "master") or MASTER_TAB
    except Exception:  # noqa: BLE001 - complianceMasterTab_'s catch
        return MASTER_TAB


def master_table(reads: L.Reads) -> dict[str, Any]:
    """complianceMasterTable_: every non-blank row by its trimmed header (the protected columns never read, a Date as
    estateCell_ writes it, the last of a repeated header winning); throws when the Master cannot be opened."""
    def read() -> dict[str, Any]:
        sid = SP.emp_db_id(reads)
        tab = master_tab(reads)
        ref = HT.tab_of(reads, sid, tab, "the Employee Database's Master")
        if ref is None:
            raise SP.Said(f'the Employee Database has no "{tab}" tab')
        heads = [(h, gsjs.trim(gsjs.js_str(hubdb.twin_base(h))), bool(hubdb.TWIN_KEY.fullmatch(h)))
                 for h in ref.headers]
        heads = [(h, name, twin) for h, name, twin in heads if name and not pii_blocked(name)]
        rows: list[dict] = []
        for rn, raw in reads.db.rows(ref):
            row: dict[str, Any] = {"_row": rn}
            empty = True
            for h, name, twin in heads:
                v = hubdb.estate_cell(hubdb.typed(raw.get(h), "estate"))
                if v:
                    empty = False
                # a repeated header's earlier columns: the copy names the last one plainly, and it wins
                if not twin:
                    row[name] = v
            if not empty:
                rows.append(row)
        return {"headers": [name for _h, name, _t in heads], "rows": rows}
    return reads.once("compliance:master", read)


def active_rows(reads: L.Reads) -> dict[str, Any]:
    """complianceActiveRows_: nobody active is a 503 — a scorecard over nobody would render as everyone compliant."""
    try:
        table = master_table(reads)
    except (hubdb.Unreadable, Defer, SP.Said) as e:
        return {"error": {"status": 503, "message": "The Employee Database Master could not be read (" + str(e)
                          + ") — no compliance answer is possible right now."}}
    if not table["rows"]:
        return {"error": {"status": 503, "message": "The Employee Database Master answered with no rows at all — a "
                          "scorecard over nobody would read as fully compliant, so this refuses instead."}}
    headers = table["headers"]
    if "Status" not in headers:
        return {"error": {"status": 503, "message": 'The Master has no "Status" column — without it active staff '
                          "cannot be told from former staff, and the scorecard would count everyone who ever worked "
                          "here."}}
    name_header = "Employee" if "Employee" in headers else (headers[0] if headers else "")
    if not name_header:
        return {"error": {"status": 503, "message": "The Master has no readable name column — nobody can be "
                          "identified, so nothing can be counted."}}
    active: list[dict] = []
    skipped: list[str] = []
    for r in table["rows"]:
        name = gsjs.trim(gsjs.or_text(r.get(name_header)))
        if not name:
            continue
        if non_person(name):
            skipped.append(name)
            continue
        if gsjs.trim(gsjs.or_text(r.get("Status"))).lower() not in ACTIVE_STATUSES:
            continue
        active.append({**r, "_name": name})
    if not active:
        return {"error": {"status": 503, "message": "The Master has rows but not one active employee (Status "
                          "yes/other/active). An all-inactive read is a broken read wearing the clothes of a clean "
                          "result — nothing is counted."}}
    return {"headers": headers, "rows": active, "skippedLabels": skipped}


def cell(row: dict, item: dict, headers: list[str], now: float) -> dict[str, Any]:
    """complianceCell_."""
    if item["header"] not in headers:
        return {"state": "unreadable", "value": "", "date": "", "daysLeft": None}
    v = row.get(item["header"])
    out: dict[str, Any] = {"state": state(v), "value": "" if v is None else gsjs.js_str(v), "date": "",
                           "daysLeft": None}
    if item["dateHeader"] and item["dateHeader"] in headers:
        ms = date_ms(row.get(item["dateHeader"]))
        if ms is not None:
            out["date"] = iso_day(ms)
            out["daysLeft"] = days(ms, now)
    return out


# ---- whose rows ------------------------------------------------------------------------------------------------------

def refusal(me: dict) -> dict[str, Any]:
    """complianceDocsRefusal_."""
    env: dict[str, Any] = {"status": me["status"], "message": me["why"], "scope": "own"}
    if me.get("found"):
        env["self"] = me["found"]
    return env


def whose(sess: L.Session) -> dict[str, Any]:
    """complianceWhose_: all of the Master for the real master in its own session; anyone else their own row."""
    if sc.is_real_master(sess.user):
        return {"all": True, "scope": "all", "self": None}
    me = SP.compliance_self(sess.reads, sess.user)
    if not me["key"]:
        return {"refusal": refusal(me)}
    return {"all": False, "scope": "own", "self": me}


def own_rows(who: dict, rows: list[dict]) -> dict[str, Any]:
    """complianceOwnRows_: every row, or the one carrying the caller's name; two with that name refuse."""
    if who["all"]:
        return {"rows": rows}
    mine = [r for r in rows if SP.fold(r.get("_name")) == who["self"]["key"]]
    if len(mine) > 1:
        return {"refusal": {"status": 409, "scope": "own", "self": who["self"]["name"],
                            "message": "Two active rows of the Employee Database carry your name, so which one is "
                                       "yours cannot be settled — an administrator merges them or gives one a "
                                       "distinguishing name."}}
    return {"rows": mine}


def own_note(who: dict, rows: list[dict]) -> str:
    """complianceOwnNote_: an own answer with no row of the caller's says so, rather than counting nobody."""
    if not who["all"] and not rows:
        return "Your name is not on an active row of the Employee Database Master, so nothing is counted for you."
    return ""


def _counted(sess: L.Session) -> dict[str, Any]:
    """The doors' shared opening: whose rows, the active Master, then the caller's own."""
    who = whose(sess)
    if who.get("refusal"):
        return {"refused": who["refusal"]}
    got = active_rows(sess.reads)
    if got.get("error"):
        return {"refused": {**got["error"], "scope": who["scope"]}}
    own = own_rows(who, got["rows"])
    if own.get("refusal"):
        return {"refused": own["refusal"]}
    return {"who": who, "headers": got["headers"], "rows": own["rows"], "skipped": got["skippedLabels"]}


def _tail(c: dict[str, Any]) -> dict[str, Any]:
    who = c["who"]
    return {"skippedLabels": c["skipped"] if who["all"] else [], "scope": who["scope"],
            "self": "" if who["all"] else who["self"]["name"], "note": own_note(who, c["rows"])}


# ---- the doors -------------------------------------------------------------------------------------------------------

def scorecard(sess: L.Session, payload: dict) -> dict[str, Any]:
    """complianceScorecard: counted over every active employee for the real master, over the caller's own row for
    anyone else; 'unreadable' decided once per item from the header — a renamed column is gone for every row."""
    if not writer(sess.user):
        return CW.denied()
    c = _counted(sess)
    if c.get("refused"):
        return c["refused"]
    headers, rows = c["headers"], c["rows"]
    now = now_ms(sess.reads)
    items: list[dict] = []
    states: dict[str, list[str]] = {}
    for item in ITEMS:
        readable = item["header"] in headers
        entry: dict[str, Any] = {
            "id": item["id"], "label": item["label"], "category": item["category"],
            "source": (f"Employee Database › Master › '{item['header']}'" if readable
                       else f"Employee Database › Master — no '{item['header']}' column"),
            "state": "readable" if readable else "unreadable",
            "counts": {k: 0 for k in STATE_KEYS}, "expired": [], "expiring": []}
        states[item["id"]] = []
        if readable:
            for r in rows:
                got = cell(r, item, headers, now)
                entry["counts"][got["state"]] = entry["counts"].get(got["state"], 0) + 1
                states[item["id"]].append(got["state"])
                if got["state"] == "missing" and len(entry["expired"]) < 25:
                    entry["expired"].append({"name": r["_name"], "date": got["date"], "daysLeft": got["daysLeft"]})
                elif got["state"] == "warning" and len(entry["expiring"]) < 25:
                    entry["expiring"].append({"name": r["_name"], "date": got["date"], "daysLeft": got["daysLeft"]})
        items.append(entry)
    # rolled up from the same states counted above, so tiles and items always agree
    metrics = {"activeEmployees": len(rows), "fullyCompliant": 0, "withWarnings": 0, "withExpired": 0}
    for e in range(len(rows)):
        expired = warning = 0
        for item in ITEMS:
            got = states[item["id"]]
            st = got[e] if e < len(got) else None
            if st == "missing":
                expired += 1
            elif st == "warning":
                warning += 1
        if expired > 0:
            metrics["withExpired"] += 1
        elif warning > 0:
            metrics["withWarnings"] += 1
        else:
            metrics["fullyCompliant"] += 1
    unreadable = [i["label"] for i in items if i["state"] == "unreadable"]
    return {"status": 200, "data": {"metrics": metrics, "items": items, "unreadableItems": unreadable, **_tail(c)}}


def _int(v: Any) -> int | None:
    """parseInt(v, 10); None for NaN."""
    n = CND.js_parse_int(v)
    return None if n != n else int(n)


def matrix(sess: L.Session, payload: dict) -> dict[str, Any]:
    """complianceMatrix: one category per call, paged — no click pays for the whole 28-column grid."""
    if not writer(sess.user):
        return CW.denied()
    p = payload if isinstance(payload, dict) else {}
    tab = s_(p.get("tab")) or "documents"
    if tab not in MATRIX_TABS:
        return {"status": 400, "message": f'Unknown tab "{tab}". Valid: ' + ", ".join(MATRIX_TABS) + "."}
    limit = _int(p.get("limit"))
    if limit is None or limit < 1:
        limit = 50
    limit = min(limit, 200)
    offset = _int(p.get("offset"))
    if offset is None or offset < 0:
        offset = 0
    c = _counted(sess)
    if c.get("refused"):
        return c["refused"]
    headers, rows = c["headers"], c["rows"]
    now = now_ms(sess.reads)
    items = [i for i in ITEMS if i["category"] == tab]
    employees: list[dict] = []
    for r in rows:
        cells: dict[str, dict] = {}
        expired = warning = 0
        for item in items:
            got = cell(r, item, headers, now)
            cells[item["id"]] = got
            if got["state"] == "missing":
                expired += 1
            elif got["state"] == "warning":
                warning += 1
        employees.append({"name": r["_name"], "phone": gsjs.or_text(r.get("Phone Number")),
                          "email": gsjs.or_text(r.get("Email")), "allCompleted": gsjs.or_text(r.get("All Completed")),
                          "expired": expired, "warning": warning, "cells": cells})

    def order(a: dict, b: dict) -> int:
        if b["expired"] != a["expired"]:
            return b["expired"] - a["expired"]
        if b["warning"] != a["warning"]:
            return b["warning"] - a["warning"]
        return gsjs.locale_cmp(a["name"], b["name"])
    employees.sort(key=functools.cmp_to_key(order))
    unreadable = [i["label"] for i in items if i["header"] not in headers]
    return {"status": 200, "data": {
        "tab": tab,
        "items": [{"id": i["id"], "label": i["label"], "dateHeader": i["dateHeader"], "naEligible": i["naEligible"],
                   "source": f"Employee Database › Master › '{i['header']}'"} for i in items],
        "employees": employees[offset:offset + limit], "total": len(employees), "offset": offset, "limit": limit,
        "unreadableItems": unreadable, **_tail(c)}}


# ---- the review queue ------------------------------------------------------------------------------------------------

def pending_source(reads: L.Reads) -> list[dict] | None:
    """compliancePendingSource_: None when the source could not be asked, a list (maybe empty) when it answered; each
    row keyed cr_<FileId>, else cr_r<its sheet row>."""
    def read() -> list[dict] | None:
        sid = gsjs.trim(reads.db.prop(APPDATA_PROP))
        if not sid:
            return None
        try:
            ref = reads.tab_of(sid, PENDING_TAB, "the staff-docs review queue")
        except hubdb.Unreadable:
            return None
        if ref is None:
            return None
        heads = [(h, gsjs.trim(gsjs.js_str(h))) for h in ref.headers]
        heads = [(h, name) for h, name in heads if name and not pii_blocked(name)]
        out: list[dict] = []
        for rn, raw in reads.db.rows(ref):
            row: dict[str, Any] = {"_row": rn}
            empty = True
            for h, name in heads:
                v = hubdb.estate_cell(hubdb.typed(raw.get(h), "estate"))
                if v:
                    empty = False
                row[name] = v
            if empty:
                continue
            row["_id"] = "cr_" + row["FileId"] if row.get("FileId") else f"cr_r{rn}"
            out.append(row)
        return out
    try:
        return reads.once("compliance:pending", read)
    except (hubdb.Unreadable, Defer):
        return None


def _review_cell(v: Any) -> str:
    """A verdict row's cell as complianceReviewsById_ reads it: a Date as cellText_, anything else String()."""
    t = hubdb.typed(v, "hub")
    if isinstance(t, SheetDate):
        t = hubdb.cell_text(t)
    return gsjs.or_blank(t)


def reviews_by_id(reads: L.Reads) -> dict[str, dict]:
    """complianceReviewsById_: the verdicts recorded here, by review id — Postgres once uploaded, the tab's copy until
    then (a tab not there yet holds none)."""
    def read() -> dict[str, dict]:
        if RR.uploaded(reads.db, RESOURCE):
            cols = RR.columns(reads, RESOURCE)
            rows = [cells for _k, cells in RR.table_rows(reads, RESOURCE)]
        else:
            res = reads.db.resolve(REVIEWS_TAB)
            if res.runtime:
                raise Defer(f"{REVIEWS_TAB} lives in the depot's facts")
            if res.ref is None:
                if not res.book_known:
                    raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {REVIEWS_TAB}")
                return {}
            cols = list(res.ref.headers)
            rows = [raw for _rn, raw in reads.db.rows(res.ref)]
        heads = [(h, gsjs.trim(gsjs.js_str(h))) for h in cols]
        by: dict[str, dict] = {}
        for raw in rows:
            row = {name: _review_cell(raw.get(h)) for h, name in heads if name}
            if row.get("id"):
                by[row["id"]] = row
        return by
    return reads.once("compliance:reviews", read)


def master_target(reads: L.Reads, person: Any, known_id: Any = "") -> dict[str, Any]:
    """complianceMasterTarget_ (cert_docs.master_target): a Master that cannot be read is said in its own words."""
    try:
        return CD.master_target(reads, person, known_id)
    except (hubdb.Unreadable, Defer, SP.Said):
        return {"ok": False, "why": "the Employee Database could not be read"}


def master_now(reads: L.Reads, person: Any, date_field: str, known_id: Any = "") -> dict[str, Any]:
    """complianceMasterNow_: what the review's date column holds for this person now."""
    if not date_field:
        return {"ok": False, "value": "", "why": "the review names no date column"}
    target = master_target(reads, person, known_id)
    if not target.get("row"):
        return {"ok": False, "value": "", "why": target["why"]}
    key = hubdb.estate_key(date_field)
    if key not in target["row"]:
        return {"ok": False, "value": "", "why": f'the Master has no "{date_field}" column'}
    return {"ok": True, "value": s_(target["row"][key]), "why": ""}


def queue_item(reads: L.Reads, src: dict) -> dict[str, Any]:
    """complianceQueueItem_: masterNow is echoed back as `expected`, so a row edited underneath refuses."""
    t = gsjs.or_text
    now = master_now(reads, t(src.get("SubmitterName")), t(src.get("DateField")))
    return {"id": src["_id"], "submitter": t(src.get("SubmitterName")), "docType": t(src.get("DocType")),
            "dateField": t(src.get("DateField")), "masterNow": now["value"], "masterNowWhy": now["why"],
            "aiConfidence": t(src.get("AIConfidence")), "aiExpDate": t(src.get("AIExtractedExpDate")),
            "aiCertDate": t(src.get("AIExtractedCertDate")), "aiName": t(src.get("AIExtractedName")),
            "readability": t(src.get("AIReadability")), "docTypeMatch": t(src.get("AIDocTypeMatch")) == "true",
            "isCandidate": t(src.get("IsCandidate")) == "yes", "thumbnail": t(src.get("ThumbnailUrl")),
            "uploadedAt": t(src.get("UploadedAt")) or t(src.get("SubmittedAt")) or t(src.get("Timestamp"))}


def review_queue(sess: L.Session, payload: dict) -> dict[str, Any]:
    """complianceReviewQueue: the reviewers' door by design — a writer approves other people's submitted documents
    here, the on-behalf work certDocUpload also allows them."""
    if not writer(sess.user):
        return CW.denied()
    reads = sess.reads
    source = pending_source(reads)
    if source is None:
        return {"status": 503, "message": f"The staff-docs review queue (App Data › {PENDING_TAB}) could not be read "
                "— the workbook or the tab did not answer. Nothing is pending is NOT what this means; try again once "
                "the sheet is back."}
    resolved = reviews_by_id(reads)
    pending: list[dict] = []
    resolved_n = legacy = 0
    for src in source:
        status = gsjs.trim(gsjs.or_text(src.get("ReviewStatus"))).lower()
        if src["_id"] in resolved:
            resolved_n += 1
            continue
        if status and status != "pending":
            legacy += 1
            continue
        pending.append(queue_item(reads, src))
    pending.reverse()
    return {"status": 200, "data": {
        "pending": pending,
        "counts": {"pending": len(pending), "resolvedHere": resolved_n, "resolvedInLegacyPortal": legacy},
        "message": "" if pending else "The queue answered and it is empty — nothing waits for review."}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "complianceScorecard": scorecard, "complianceMatrix": matrix, "complianceReviewQueue": review_queue}
# HUB_POLICY: the roles, then the declared params' types (none of them required)
POLICY: dict[str, dict[str, Any]] = {
    "complianceScorecard": {"roles": ROLES},
    "complianceMatrix": {"roles": ROLES, "params": {"tab": "string", "limit": "number", "offset": "number"}},
    "complianceReviewQueue": {"roles": ROLES}}
