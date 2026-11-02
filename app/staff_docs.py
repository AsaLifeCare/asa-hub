"""The staff documents' and the clearance overlay's reads (apps-script/StaffDocs.gs, apps-script/Clearance.gs) off
asa-hub-db and Drive: staffDocsScan (the compliance archive's files by person, the documentation form's dated
entries) and clearanceReadPrepare, clearanceReadDates' reading half — each document waiting for a date copied into a
Google Doc and read for its expiry, the relay asking it before the write that records the dates (BACKEND_WRITE_PREPARE).
The writes are in app/staff_docs_writes.py; the two cursors Apps Script kept in its Script Properties live in
app.staff_docs_state (db/staff_docs.sql)."""
from __future__ import annotations

import functools
import math
import os
import re
import threading
import time
import urllib.error
from typing import Any, Callable

import candidates as CND
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import staff as SP
import staff_comms as SC
from scope import Defer

APP_ID = "staff-docs"
STATE = "app.staff_docs_state"
APPLY_CURSOR = "STAFF_DOCS_APPLY_CURSOR"
OCR_CURSOR = "CLEARANCE_OCR_CURSOR"
FORM_TAB = "Responses"
ARCHIVE_PROP = "COMPLIANCE_SHARED_FOLDER_ID"
FORM_PROP = "STAFF_DOCS_SHEET_ID"
# StaffDocs.gs STAFF_DOCS_CACHE_SECONDS and STAFF_DOCS_MAX_PAGES
INDEX_TTL_S = 900.0
MAX_PAGES = 4
# StaffDocs.gs STAFF_DOC_TYPES: the form's document words, each paper's id, its course and its Master column
DOC_TYPES = (
    {"prior": "DODD Training Certificate", "id": "dodd_8hr", "course": "dodd", "col": "dodd_8_hour_exp"},
    {"prior": "CPR / 1st Aid Certificate", "id": "cpr", "course": "cpr", "col": "cpr_exp_date"},
    {"prior": "Drivers License / OH ID", "id": "drivers_license", "col": "license_exp_date"},
    {"prior": "Car Insurance Card", "id": "car_insurance", "col": "insurance_exp_date"},
    {"prior": "HS Diploma / Transcripts / GED", "id": "hs_diploma", "col": ""},
    {"prior": "Social Security Card / Birth Certificate", "id": "ss_birth_cert", "col": ""},
    {"prior": "Med Del Cert", "id": "med_del", "col": "", "refuse": "the delegation engine owns the Med Del dates"},
)
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
FORM_UNREAD = "The staff documentation form could not be read."

# Clearance.gs: the overlay's tab and resource, the matrix's credentials, the documents' reading
CLEARANCE_TAB, CLEARANCE = "staff_clearance", "staffClearance"
CLEARANCE_HEADER = ("clearance_id", "person_key", "person_name", "candidate_id", "credential", "evidence_kind",
                    "file_id", "state_ref", "issued_on", "expires_on", "decision", "verified_by", "verified_at",
                    "source")
CREDENTIALS = ("dodd", "cpr", "med1", "med2", "med3", "mais", "money", "mandt")
DECISIONS = ("submitted", "verified", "revoked")
# CLEARANCE_OCR_BUDGET_MS kept its run under Apps Script's ceiling; here the ceiling is the relay's wait for a prepare
# read (BACKEND_PREPARE_TIMEOUT_S)
OCR_BUDGET_S = float(os.getenv("HUB_CLEARANCE_OCR_BUDGET_S", "100"))
OCR_TEXT_CAP = 1 << 20
MISSING_COLUMNS = "staff_clearance is missing columns."

_WS = L._JS_WS
_DATE = r"([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})"
# Order matters: a labelled expiry always beats "Date Completed" and bare dates.
EXPIRY_LABEL = re.compile(
    r"(?:expir[A-Za-z0-9_]*|valid[" + _WS + r"]+(?:through|until|thru)|good[" + _WS + r"]+(?:through|thru|until)|"
    r"renew(?:al)?[" + _WS + r"]*(?:by|date)?|\bexp\b)[^0-9]{0,20}" + _DATE, re.I | re.A)
COMPLETED_LABEL = re.compile(
    r"(?:date[" + _WS + r"]+completed|completion[" + _WS + r"]+date|completed[" + _WS + r"]+on)[^0-9]{0,10}" + _DATE,
    re.I | re.A)
NOT_EXPIRY = re.compile(
    r"(?:d\.?o\.?b\.?|date[" + _WS + r"]+of[" + _WS + r"]+birth|birth[" + _WS + r"]*date|\biss\b|issued?(?:[" + _WS
    + r"]+on)?)[^0-9]{0,10}\Z", re.I | re.A)
BARE_DATE = re.compile(_DATE, re.A)

s_ = gsjs.str_
_held: dict[str, tuple[float, Any]] = {}
_held_lock = threading.Lock()


def is_writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and gsjs.js_str((user or {}).get("role")) in ("admin", "manager")


def js_mod(a: int, b: int) -> int:
    """a % b as JavaScript gives it: the sign of the dividend."""
    return int(math.fmod(a, b))


def cursor(reads: L.Reads, key: str) -> int:
    """parseInt(hubProp_(key) || '0', 10) || 0, from app.staff_docs_state (inside a write, through its own cursor)."""
    got = RR._q(reads, f"select value from {STATE} where key = %s", (key,))
    n = CND.js_parse_int((s_(got[0][0]) if got else "") or "0")
    return 0 if math.isnan(n) or n == 0 else int(n)


# ---- the archive and the form (StaffDocs.gs) -------------------------------------------------------------------------

def doc_type(label: Any) -> dict | None:
    """staffDocType_."""
    want = gsjs.trim(gsjs.or_blank(label)).lower()
    return next((t for t in DOC_TYPES if t["prior"].lower() == want), None)


def master_columns_for(reads: L.Reads, course: str) -> list[str]:
    """certMasterColumnsFor_: the Master columns ist_cert_master_columns names for a course, in the cell's order."""
    return [col for col, c in SP.cfg_pairs(reads, "ist_cert_master_columns")["map"].items() if c == course]


def doc_col(reads: L.Reads, known: dict | None) -> str:
    """staffDocsCol_: the course's column in the settings first; the typed one is the floor."""
    if not known:
        return ""
    if known.get("course"):
        named = master_columns_for(reads, known["course"])
        if named:
            return named[0]
    return known.get("col") or ""


def archive(reads: L.Reads) -> dict[str, Any]:
    """staffDocsIndex_: the compliance archive's files named '<person> - <type>', by person, held as Apps Script's cache
    holds them; an archive Drive refuses is said with its HTTP code, never held, and never read as empty."""
    folder = s_(reads.db.prop(ARCHIVE_PROP))
    with _held_lock:
        got = _held.get(folder)
    if got is not None and time.time() - got[0] < INDEX_TTL_S:
        return got[1]
    drv = reads.need_drive()
    by: dict[str, dict] = {}
    page, pages, seen, truncated = "", 0, 0, False
    while True:
        params = {"q": f"'{folder}' in parents and trashed=false",
                  "fields": "nextPageToken,files(id,name,modifiedTime)", "pageSize": 1000,
                  "includeItemsFromAllDrives": "true"}
        if page:
            params["pageToken"] = page
        try:
            body = drv._get(SC.DRIVE_FILES, params)
        except urllib.error.HTTPError as exc:
            # Unreadable is not empty: "no documents" would ask for papers already handed in.
            return {"error": f"The document archive could not be read (HTTP {exc.code})."}
        for f in body.get("files") or []:
            seen += 1
            p = SC._staff_docs_parse(f.get("name"))
            if not p:
                continue
            known = doc_type(p["type"])
            key = SC._staff_docs_key(p["name"])
            if not key:
                continue
            by.setdefault(key, {"name": p["name"], "docs": []})["docs"].append({
                "type": p["type"], "id": known["id"] if known else "", "col": doc_col(reads, known),
                "refuse": (known or {}).get("refuse") or "", "fileId": s_(f.get("id")),
                "at": s_(f.get("modifiedTime"))})
        page = s_(body.get("nextPageToken"))
        pages += 1
        if page and pages >= MAX_PAGES:
            truncated = True
            break
        if not page:
            break
    out = {"people": by, "filesSeen": seen, "truncated": truncated}
    with _held_lock:
        _held[folder] = (time.time(), out)
    return out


def dated(reads: L.Reads) -> dict[str, Any]:
    """staffDocsDated_: the form's entries with an expiry and a Master column, the newest expiry per person and
    column; the dates come from the form, never from a filename."""
    sid = s_(reads.db.prop(FORM_PROP))
    if not sid:
        return {"error": FORM_UNREAD}
    import house_tables as HT  # noqa: PLC0415 - kept in Postgres since 10-27
    ref = HT.tab_of(reads, sid, FORM_TAB, "the staff documentation form")
    if ref is None:
        return {"error": FORM_UNREAD}
    rows = SC._normalized(reads, ref, SC._is_hub_db(reads, sid))
    out: list[dict] = []
    cert_only = undated = unknown_type = 0
    for r in rows:
        name, label = s_(r.get("yourname")), s_(r.get("selectdocument"))
        if not name or not label:
            continue
        known = doc_type(label)
        if not known:
            unknown_type += 1
            continue
        exp = SC._staff_docs_day(r.get("dateofexpiration"))
        cert = SC._staff_docs_day(r.get("dateofcertification"))
        if not exp:
            if cert:
                cert_only += 1
            else:
                undated += 1
            continue
        col = doc_col(reads, known)
        if not col or known.get("refuse"):
            continue
        out.append({"key": SC._staff_docs_key(name), "name": name, "type": label, "field": col, "expires": exp,
                    "certified": cert, "link": s_(r.get("uploadyourdocumentonedocumentperphoto"))})
    # Newest expiry LAST per person+field wins: a renewal supersedes.
    out.sort(key=functools.cmp_to_key(lambda a, b: gsjs.locale_cmp(s_(a["expires"]), s_(b["expires"]))))
    best: dict[str, dict] = {}
    for d in out:
        best[d["key"] + "|" + d["field"]] = d
    return {"dated": list(best.values()), "certOnly": cert_only, "undated": undated, "unknownType": unknown_type}


def staff_docs_scan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffDocsScan: one person's papers in the archive, or what the form can date for the Master."""
    if not is_writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    idx = archive(sess.reads)
    if idx.get("error"):
        return {"status": 503, "message": idx["error"]}
    one = s_(p.get("name"))
    if one:
        mine = idx["people"].get(SC._staff_docs_key(one))
        return {"status": 200, "data": {"name": one, "found": bool(mine), "docs": mine["docs"] if mine else [],
                                        "message": f"{len(mine['docs'])} document(s) on file." if mine
                                        else "Nothing on file under that name."}}
    got = dated(sess.reads)
    if got.get("error"):
        return {"status": 503, "message": got["error"]}
    fillable = sorted(got["dated"], key=functools.cmp_to_key(
        lambda a, b: gsjs.locale_cmp(s_(b["expires"]), s_(a["expires"]))))
    return {"status": 200, "data": {
        "people": len(idx["people"]), "filesSeen": idx["filesSeen"], "truncated": bool(idx["truncated"]),
        "fillable": fillable[:400], "fillableTotal": len(fillable),
        # A certification date is never written as an expiry.
        "certOnlyNoExpiry": got["certOnly"], "undated": got["undated"], "unknownType": got["unknownType"],
        "message": f"{len(fillable)} expiry date(s) come from the form. {got['certOnly']} submission(s) carry only a "
                   "certification date and date nothing. The Master keeps whatever it already has; only blanks are "
                   "filled."}}


# ---- the clearance overlay (Clearance.gs) ----------------------------------------------------------------------------

def _cell(v: Any) -> str:
    return gsjs.trim(gsjs.or_text(hubdb.typed(v, "hub")))


def clearance_rows(reads: L.Reads) -> dict[str, Any]:
    """clearanceSheet_'s rows in sheet order: Postgres's once the overlay is kept there (each row's key), else the copy
    of the Hub tab with the kept edits laid (each row's place); its normKey_'d header."""
    if RR.uploaded(reads.db, CLEARANCE):
        cols = RR.columns(reads, CLEARANCE)
        rows = [(k, cells) for k, cells in RR.table_rows(reads, CLEARANCE)]
        return {"kept": True, "hdr": [hubdb.norm_key(h) for h in cols], "heads": cols, "rows": rows, "ref": None,
                "res": None}
    res = reads.db.resolve(CLEARANCE_TAB)
    if res.runtime:
        raise Defer(f"{CLEARANCE_TAB} lives in the depot's facts")
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {CLEARANCE_TAB}")
        # hubTabEnsure_ makes the tab with its header: nothing waits on it yet
        return {"kept": False, "hdr": list(CLEARANCE_HEADER), "heads": list(CLEARANCE_HEADER), "rows": [],
                "ref": None, "res": res}
    rows = reads.db.rows(res.ref)
    return {"kept": False, "hdr": [hubdb.norm_key(h) for h in res.ref.headers], "heads": list(res.ref.headers),
            "rows": rows, "ref": res.ref, "res": res}


def at(got: dict, cells: dict, key: str) -> str:
    """String(values[r][col] || '').trim() for a normKey_'d column; '' for a column the tab lacks."""
    for h in got["heads"]:
        if hubdb.norm_key(h) == key:
            return _cell(cells.get(h))
    return ""


def ocr_queue(got: dict) -> list[int] | None:
    """clearanceReadDates' order: the rows with a document and no expiry, from the last row up; None when the tab lacks
    the file or the expiry column."""
    hdr = got["hdr"]
    if "fileid" not in hdr or "expireson" not in hdr:
        return None
    kind = "evidencekind" in hdr
    order = []
    for i in range(len(got["rows"]) - 1, -1, -1):
        cells = got["rows"][i][1]
        if not at(got, cells, "fileid") or at(got, cells, "expireson"):
            continue
        if kind and at(got, cells, "evidencekind") != "document":
            continue
        order.append(i)
    return order


def iso_date(raw: str) -> str:
    """clearanceIsoDate_."""
    parts = raw.replace("-", "/").split("/")
    mm, dd, yy = CND.js_parse_int(parts[0]), CND.js_parse_int(parts[1]), parts[2]
    if len(yy) == 2:
        yy = "20" + yy
    yyyy = CND.js_parse_int(yy)
    if not (1 <= mm <= 12) or not (1 <= dd <= 31) or not (2000 <= yyyy <= 2100):
        return ""
    return f"{int(yyyy)}-{int(mm):02d}-{int(dd):02d}"


def date_from_text(text: Any, credential: str) -> str:
    """clearanceDateFromText_: '' rather than a guess, since a wrong expiry is believed."""
    s = gsjs.or_blank(text)
    if not s:
        return ""
    m = EXPIRY_LABEL.search(s)
    if m:
        return iso_date(m.group(1))
    if credential == "cpr":
        m = COMPLETED_LABEL.search(s)
        if m:
            return iso_date(m.group(1))
    # An ID's first bare date is the holder's DOB.
    if credential == "id":
        return ""
    for hit in BARE_DATE.finditer(s):
        before = s[max(0, hit.start() - 24):hit.start()]
        if NOT_EXPIRY.search(before):
            continue
        iso = iso_date(hit.group(1))
        if iso:
            return iso
    return ""


def ocr_text(reads: L.Reads, file_id: str) -> str:
    """clearanceOcrText_: the file copied into a Google Doc as asatech, its text read and the copy put in the bin; ''
    for a file Drive will not read."""
    drv = reads.need_drive()
    try:
        return drv.converted_text(file_id, OCR_TEXT_CAP)
    except Defer:
        raise
    except Exception:  # noqa: BLE001 - as the catch around the copy: an unreadable document reads as no text
        return ""


def clearance_read_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clearanceReadDates' reading half, before its write: the queue from the saved cursor, up to `limit` documents
    read (OCR is slow, and kept out of the upload so it never costs somebody their document), each date found; the
    write records them and moves the cursor."""
    if not is_writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    lim = CND.js_parse_int(s_(p.get("limit")))
    limit = min(10 if math.isnan(lim) or lim == 0 else lim, 25)
    reads = sess.reads
    got = clearance_rows(reads)
    order = ocr_queue(got)
    if order is None:
        return {"status": 500, "message": MISSING_COLUMNS}
    # A saved cursor rotates the queue: unreadable documents must not hold its front forever.
    cur = cursor(reads, OCR_CURSOR)
    if cur >= len(order):
        cur = 0
    ordered = order[cur:] + order[:cur]
    read, found = 0, []
    deadline = time.monotonic() + OCR_BUDGET_S
    for i in ordered:
        if read >= limit:
            break
        if time.monotonic() > deadline:
            break
        cells = got["rows"][i][1]
        read += 1
        fid = at(got, cells, "fileid")
        iso = date_from_text(ocr_text(reads, fid), at(got, cells, "credential"))
        if not iso:
            continue
        found.append({"clearance_id": at(got, cells, "clearanceid"), "file_id": fid, "expires_on": iso,
                      "key": got["rows"][i][0] if got["kept"] else ""})
    return {"status": 200, "data": {"cursor": cur, "total": len(order), "read": read, "found": found}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "staffDocsScan": staff_docs_scan, "clearanceReadPrepare": clearance_read_prepare}
# HUB_POLICY: staffDocsScan's roles and typed name; the prepare read is clearanceReadDates' own (its roles)
POLICY: dict[str, dict[str, Any]] = {
    "staffDocsScan": {"roles": ("admin", "manager"), "params": {"name": "string"}},
    "clearanceReadPrepare": {"roles": ("admin", "manager")}}
