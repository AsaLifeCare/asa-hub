"""Compliance documents (apps-script/ComplianceDocs.gs) answered off asa-hub-db: the certificate ledger, a filed
paper's bytes through Drive, the record a confirmation is witnessed by, and the confirmation itself kept in app.edits
(the Employee Database Master date and the ledger row's stamp), final. A paper's reading is the relay's lane's
(app.cert_reads, laid over the ledger by cert_reads). Filing a paper is decided here (certDocUploadPlan, then
certDocUpload's ledger row, final); the relay files it in Drive as asatech (server/cert_papers.py)."""
from __future__ import annotations

import base64
import json
import re
import types
import urllib.parse
from datetime import date
from typing import Any, Callable

import client_writes as CW
import drive as dr
import gsjs
import house_tables as HT
import hubdb
import locations as L
import resource_rows as RR
import scope as sc
import staff as SP
import writes as W
from scope import Defer
from writes import Decision

APP_ID = "cert-docs"
APP_NAME = "Compliance documents"
# Settings › Editions: who else reviews another person's filed papers beside the master (app/editions.py)
EDITION = "certDocs.review"
TAB = SP.UPLOADS_TAB
DOC_MAX_BYTES = 15 * 1024 * 1024
FOLDER = "Compliance Docs"
# Props.gs HUB_PLATFORM_FOLDER_ID: the platform's own folder, owned by asatech
PLATFORM_ROOT = "1fNb2-pqSGS-DZcyXAoxPY7Sp9CaPC8-b"
ROLES = ("admin", "manager", "staff")
# ComplianceDocs.gs CERT_READ_WORDS (the doors' own) and CERT_CONFIRM_WORDS
WORDS = {
    "noFile": "The ledger keeps no file for this document.",
    "notYours": "This document is not on your record.",
    "bridged": ("Your account reaches your roster row only through an e-mail written on the roster, so your documents "
                "are not opened from this session — HR opens them, or an administrator gives your account the exact "
                "name on your roster row."),
    "unshown": "This file is not a PDF or a picture, so it is not shown here.",
    "visit": "Submitted documents are listed for their own person and the master only, not during a visit.",
}
CONFIRM_WORDS = {
    "master": "Only the master confirms a date into the record.",
    "earlier": ("This document was filed for another roster row than the one this name finds now, so its date is not "
                "taken for this record."),
}
NO_ROW = "No document with that id is on the ledger."
GONE = "The file behind this document is no longer in the drive."
TOO_BIG = "This file is larger than 15MB, so it is not shown here."
STEP_WORDS = "The record's date and the ledger row's confirmation, kept in the Hub's database."
CACHES = "Staff and My Profile read it from Postgres at once; the relay read this person again."
# emp360PiiBlocked_: a column never read or written
_PII = ("date_of_birth", "dob", "birth_date", "login", "password", "social_security", "social_security_number")
_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


# ---- who reads and confirms ------------------------------------------------------------------------------------------

def denied() -> dict[str, Any]:
    return CW.denied()


def params_gate(payload: dict, params: tuple) -> dict[str, Any] | None:
    """hubPolicyGate_'s params, in their declared order: a required one missing, then a type."""
    for key, required, kind in params:
        val = payload.get(key) if isinstance(payload, dict) else None
        missing = val is None or val == ""
        if required and missing:
            return {"status": 400, "message": f"Missing required parameter: {key}."}
        if not missing:
            actual = ("array" if isinstance(val, list) else "boolean" if isinstance(val, bool)
                      else "number" if isinstance(val, (int, float)) else "string" if isinstance(val, str)
                      else "object")
            if actual != kind:
                return {"status": 400, "message": f"{key} must be {kind}, got {actual}."}
    return None


def visit(user: dict | None) -> bool:
    """complianceDocsVisit_."""
    return bool((user or {}).get("visiting_member"))


def holder(sess: L.Session) -> bool:
    """A holder of the review edition who reads every staff member whole in Staff — the whole team, not their own
    profile alone (Staff's own-profile rule); never the master."""
    user = sess.user
    if sc.is_real_master(user) or not sc.edition_allows(EDITION, user or {}, sess.reads.config()):
        return False
    return SP.whole_gate(sess) is not None and SP.own_only(sess) is None


def sees_all(sess: L.Session) -> bool:
    """Every ledger row: the real master, or a holder of the review edition."""
    return sc.is_real_master(sess.user) or holder(sess)


def refusal(me: dict) -> dict[str, Any]:
    """complianceDocsRefusal_: what this side could not read is Apps Script's to answer."""
    if me.get("status") == 503:
        raise Defer(str(me.get("why") or "whose certificates these are could not be settled here")[:160])
    env: dict[str, Any] = {"status": me["status"], "message": me["why"], "scope": "own"}
    if me.get("found"):
        env["self"] = me["found"]
    return env


def mine(row: dict, me: dict | None) -> bool:
    """complianceDocsMine_: the settled name, then the roster id stamped, the filing session, or filed since the row."""
    if not me or not me.get("key") or SP.fold(row.get("person")) != me["key"]:
        return False
    stamped = SP.roster_id(row.get("rosterid"))
    if stamped:
        return stamped == SP.roster_id(me.get("id"))
    if me.get("mail") and gsjs.str_(row.get("by")).lower() == me["mail"]:
        return True
    return filed_since(row, me) is not False


def filed_since(row: dict, me: dict) -> bool | None:
    """complianceDocsFiledSince_."""
    since, at = SP._js_ms(gsjs.str_(me.get("since"))), SP._js_ms(gsjs.str_(row.get("at")))
    if since is None or at is None:
        return None
    return at >= since


def ledger(reads: L.Reads) -> list[dict]:
    """complianceDocsRows_: the ledger's rows, [] while the tab is unborn."""
    rows = SP.uploads(reads)
    if rows is None:
        raise hubdb.Unreadable("the certificate submissions could not be read")
    return rows


def own_row(sess: L.Session, rid: Any) -> dict[str, Any]:
    """complianceDocsOwnRow_: the master and a review holder open any row; anyone else only a row that is theirs."""
    user = sess.user
    if visit(user):
        return {"refused": {"status": 403, "message": WORDS["notYours"]}}
    every = sees_all(sess)
    me = None if every else SP.compliance_self(sess.reads, user)
    if me is not None and not me["key"]:
        return {"refused": refusal(me)}
    want = gsjs.str_(rid)
    row = next((r for r in ledger(sess.reads) if gsjs.str_(r.get("id")) == want), None)
    if row is None or (me is not None and not mine(row, me)):
        return {"refused": {"status": 404, "message": NO_ROW} if every
                else {"status": 403, "message": WORDS["notYours"]}}
    return {"row": row, "self": me, "all": every}


def session_door(sess: L.Session, payload: dict, params: tuple) -> dict[str, Any] | None:
    """The doors' own first lines: a person's session, then the declared params."""
    user = sess.user
    if not user or user.get("is_service") or gsjs.js_str(user.get("role")) not in ROLES:
        return denied()
    return params_gate(payload, params)


def review_door(sess: L.Session, payload: dict, params: tuple) -> tuple[dict[str, Any] | None, bool]:
    """The confirmation's doors: the master, or a holder of the review edition; (refusal, holder)."""
    user = sess.user or {}
    master = sc.is_real_master(user)
    held = not master and holder(sess)
    if not master and not held and not user.get("is_service") and gsjs.js_str(user.get("role")) != "admin":
        return {"status": 403, "message": "This action is for admin."}, False
    bad = params_gate(payload, params)
    if bad:
        return bad, held
    if not master and not held:
        return {"status": 403, "message": CONFIRM_WORDS["master"]}, False
    return None, held


# ---- the ledger read (certUploadsList) -------------------------------------------------------------------------------

def uploads_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """certUploadsList: every row for the master and a review holder, the caller's own rows for everyone else."""
    shut = session_door(sess, payload, ())
    if shut:
        return shut
    user = sess.user
    if visit(user):
        return {"status": 403, "message": WORDS["visit"], "scope": "own"}
    every = sees_all(sess)
    me = None if every else SP.compliance_self(sess.reads, user)
    if me is not None and not me["key"]:
        return refusal(me)
    out = [SP.upload_out(r) for r in ledger(sess.reads)
           if me is None or (SP.fold(r.get("person")) == me["key"] and mine(r, me))]
    return {"status": 200, "data": {"uploads": out, "scope": "all" if every else "own",
                                    "self": me["name"] if me is not None else ""}}


# ---- a filed paper's bytes (certDocFile) and its kept reading (certDocRead) -----------------------------------------

def _meta(drv: Any, file_id: str, fields: str) -> dict[str, Any]:
    """A Drive item as the account that owns the platform's files sees it; Gone when it cannot see it at all."""
    url = f"{dr.API}/{urllib.parse.quote(file_id)}"
    return json.loads(drv._bytes(url, {"fields": fields, "supportsAllDrives": "true"}, 1 << 20))


def filed_here(drv: Any, f: dict) -> bool:
    """complianceDocsFiledHere_: the file sits in a folder whose own parent is Compliance Docs."""
    for p in f.get("parents") or []:
        try:
            up = _meta(drv, str(p), "id,parents")
        except dr.Gone:
            continue
        for g in up.get("parents") or []:
            try:
                if gsjs.trim(str(_meta(drv, str(g), "id,name").get("name") or "")) == FOLDER:
                    return True
            except dr.Gone:
                continue
    return False


def file_read(reads: L.Reads, file_id: str) -> dict[str, Any]:
    """complianceDocsFileRead_: only a file the store filed, a PDF or a picture up to 15MB, as bytes."""
    drv = reads.need_drive()
    try:
        f = _meta(drv, file_id, "id,name,mimeType,size,parents")
        if not filed_here(drv, f):
            # a service account may not see the folders the owning account files into: Apps Script says stray
            raise Defer("whether the file sits in the compliance folder is the owning account's to say")
        size = int(float(f.get("size") or 0))
        name, stored = gsjs.str_(f.get("name")), gsjs.str_(f.get("mimeType"))
        mime = L.shown_type(stored, name)
        if not mime:
            return {"name": name, "mime": stored, "size": size, "unshown": True}
        if size > DOC_MAX_BYTES:
            return {"name": name, "mime": mime, "size": size, "too_big": True}
        data = drv.media(file_id, DOC_MAX_BYTES)
    except (Defer, dr.Gone):
        raise
    except Exception as e:  # noqa: BLE001 - Drive not answering is Apps Script's to say
        raise Defer(f"Drive did not hand the file over ({type(e).__name__})") from e
    if len(data) > DOC_MAX_BYTES:
        return {"name": name, "mime": mime, "size": size, "too_big": True}
    return {"name": name, "mime": mime, "size": size, "b64": base64.b64encode(data).decode("ascii")}


def doc_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """certDocFile: the paper itself for the eye — the caller's own row, the master's and a review holder's any."""
    shut = session_door(sess, payload, (("id", True, "string"),))
    if shut:
        return shut
    got = own_row(sess, payload.get("id"))
    if got.get("refused"):
        return got["refused"]
    if got["self"] and got["self"].get("bridged"):
        return {"status": 403, "message": WORDS["bridged"]}
    file_id = SP.upload_out(got["row"])["file_id"]
    if not file_id:
        return {"status": 404, "message": WORDS["noFile"]}
    try:
        f = file_read(sess.reads, file_id)
    except dr.Gone:
        return {"status": 404, "message": GONE}
    shown = "" if f.get("unshown") else L.shown_type(f["mime"], "")
    if not shown:
        return {"status": 415, "message": WORDS["unshown"]}
    if f.get("too_big"):
        return {"status": 400, "message": TOO_BIG}
    return {"status": 200, "data": {"id": gsjs.str_(got["row"].get("id")),
                                    "name": f["name"] or gsjs.str_(got["row"].get("name")), "mime": shown,
                                    "size": f["size"], "b64": f["b64"]}}


def doc_read(sess: L.Session, payload: dict) -> dict[str, Any]:
    """certDocRead: the row with its reading; a paper still to read is pending until the relay's lane reads it."""
    shut = session_door(sess, payload, (("id", True, "string"),))
    if shut:
        return shut
    got = own_row(sess, payload.get("id"))
    if got.get("refused"):
        return got["refused"]
    return {"status": 200, "data": SP.upload_out(got["row"])}


# ---- the Employee Database Master a confirmation reads and writes ----------------------------------------------------

def pii(key: str) -> bool:
    """emp360PiiBlocked_."""
    k = (key or "").lower()
    return bool(k) and ("ssn" in k or k in _PII)


def master_sheet(reads: L.Reads) -> dict[str, Any]:
    """emp360MasterRows_ (estateKey_, estateCell_, the last twin column wins, blank rows out), each row's place kept."""
    def read() -> dict[str, Any]:
        sid = SP.emp_db_id(reads)
        ref = HT.tab_of(reads, sid, SP.cert_source_tab(reads, "master"), "the Employee Database's Master")
        if ref is None:
            return {"sid": sid, "ref": None, "raw": [], "rows": []}
        keys = [hubdb.estate_key(h) for h in ref.headers]
        twin = [bool(SP.TWIN_KEY.fullmatch(h)) for h in ref.headers]
        raw_rows = reads.db.rows(ref)
        rows: list[tuple[int, dict]] = []
        for i, (_rn, raw) in enumerate(raw_rows):
            row: dict[str, Any] = {}
            empty = True
            for k, h, t in zip(keys, ref.headers, twin):
                if not k or pii(k):
                    continue
                v = hubdb.estate_cell(hubdb.typed(raw.get(h), "estate"))
                if v:
                    empty = False
                if not t:
                    row[k] = v
            if not empty:
                rows.append((i, row))
        return {"sid": sid, "ref": ref, "raw": raw_rows, "rows": rows}
    return reads.once("cd_master", read)


def find_master_row(reads: L.Reads, name: str, employee_id: str) -> dict[str, Any]:
    """emp360FindMasterRow_: by Employee ID, else by name; a name on several rows takes its one Active row."""
    want_name, want_id = SP.name_norm(name), gsjs.trim(employee_id or "")
    hits: list[tuple[int, dict, str]] = []
    for i, r in master_sheet(reads)["rows"]:
        # Employee, else Name, else First + Last: the copy's Employee column is blank on every row
        row_name = SP.master_name(r, "employee|name")
        if want_id and gsjs.trim(gsjs.or_blank(r.get("employee_id"))) == want_id:
            hits.append((i, r, "employee_id"))
            continue
        if not want_id and want_name and SP.name_norm(row_name) == want_name:
            hits.append((i, r, "name"))
    if len(hits) > 1 and not want_id:
        live = [h for h in hits if SP._status_active(h[1])]
        if len(live) == 1:
            return {"row": live[0][1], "at": live[0][0], "by": "name (Active)"}
    if len(hits) > 1:
        return {"conflict": len(hits)}
    if len(hits) == 1:
        return {"row": hits[0][1], "at": hits[0][0], "by": hits[0][2]}
    return {"row": None, "by": ""}


def master_target(reads: L.Reads, person: Any, known_id: Any) -> dict[str, Any]:
    """complianceMasterTarget_: the one Master row the witness read and the write share, keyed by its Employee ID."""
    name = gsjs.str_(person)
    if not name:
        return {"ok": False, "why": "the review names nobody"}
    eid = gsjs.str_(known_id)
    found = find_master_row(reads, "" if eid else name, eid)
    if found.get("conflict"):
        return {"ok": False, "why": f"{found['conflict']} Master rows match "
                + (f'Employee ID "{eid}"' if eid else f'"{name}"') + " — sort the duplicate out first"}
    row = found.get("row")
    if not row:
        return {"ok": False, "why": f'no Master row carries Employee ID "{eid}", the one the roster gives "{name}"'
                if eid else f'no Master row matches "{name}"'}
    if eid and SP.name_norm(row.get("employee") or row.get("name")) != SP.name_norm(name):
        return {"ok": False, "why": f'the Master row carrying Employee ID "{eid}" names someone other than "{name}"'}
    employee_id = gsjs.str_(row.get("employee_id"))
    if not employee_id:
        return {"ok": False, "row": row,
                "why": f'the Master row for "{name}" has no Employee ID, so a write cannot be keyed to it'}
    return {"ok": True, "employee_id": employee_id, "row": row}


def master_now(reads: L.Reads, person: Any, source: str, known_id: Any) -> dict[str, Any]:
    """complianceMasterNow_: what the record's date column holds for this person now."""
    if not source:
        return {"ok": False, "value": "", "why": "the review names no date column"}
    target = master_target(reads, person, known_id)
    if not target.get("row"):
        return {"ok": False, "value": "", "why": target["why"]}
    key = hubdb.estate_key(source)
    if key not in target["row"]:
        return {"ok": False, "value": "", "why": f'the Master has no "{source}" column'}
    return {"ok": True, "value": gsjs.str_(target["row"][key]), "why": ""}


def master_cell(reads: L.Reads, source: str, employee_id: str, expected: str) -> dict[str, Any]:
    """emp360WriteCell_ by Employee ID, as a kept edit: {edit} for the date column's cell, or why it is not written."""
    field = hubdb.estate_key(source)
    if pii(field):
        return {"why": f'"{field}" is protected — it is never read or written here.'}
    found = find_master_row(reads, "", employee_id)
    if found.get("conflict"):
        return {"why": f'{found["conflict"]} rows in the Employee Database match employee id "{employee_id}". '
                       "Merging people is not something to do automatically — sort the duplicate out first."}
    if not found.get("row"):
        return {"why": "No row in the Employee Database matches this person — nothing to write to."}
    sheet = master_sheet(reads)
    ref = sheet["ref"]
    heads = [h for h in ref.headers if hubdb.estate_key(SP.twin_base(h)) == field]
    if not heads:
        return {"why": f'The Master tab has no "{field}" column — the estate renamed it.'}
    if len(heads) > 1:
        return {"why": f'the Master carries more than one "{source}" column, so the cell to write is not told apart'}
    eid_heads = [h for h in ref.headers if hubdb.estate_key(h) == "employee_id"]
    got = W.row_key_of(sheet["raw"], found["at"], [[eid_heads[-1]]]) if eid_heads else None
    if got is None:
        return {"why": "the Employee Database row cannot be told apart from another row"}
    current = hubdb.estate_cell(hubdb.typed(sheet["raw"][found["at"]][1].get(heads[0]), "estate"))
    if SP._marker(current):
        raise Defer("the copy withholds the record's cell this confirmation rests on")
    if current != expected:
        return {"stale": current}
    head = gsjs.trim(gsjs.js_str(heads[0]))
    return {"sid": sheet["sid"], "tab": ref.tab, "match": got[0], "key": got[1], "head": head, "before": current}


# ---- the confirmation's target, its witness read and the write ------------------------------------------------------

def req_of(reads: L.Reads, req_id: Any, cert: Any) -> dict | None:
    """complianceDocsReqOf_: the enabled requirement the row names by id, else the one whose label its cert carries."""
    rows = SP.requirements(reads)
    rid = gsjs.str_(req_id)
    if rid:
        return next((r for r in rows if gsjs.str_(r.get("req_id")) == rid
                     and gsjs.str_(r.get("enabled")).lower() == "yes"), None)
    key = SP.fold(cert)
    if not key:
        return None
    hits = [r for r in rows if gsjs.str_(r.get("enabled")).lower() == "yes" and SP.fold(r.get("label")) == key]
    return hits[0] if len(hits) == 1 else None


def subject_row(reads: L.Reads, person: Any) -> dict | str | None:
    """complianceDocsSubjectRow_: the one roster row a ledger name folds to; '' when none or two; None unread."""
    key = SP.fold(person)
    if not key:
        return ""
    rows, _w = SP._soft(lambda: SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads))))
    if not rows:
        return None
    same = [p for p in rows if SP.fold((p or {}).get("name")) == key]
    return same[0] if len(same) == 1 else ""


def confirm_target(reads: L.Reads, payload: dict) -> dict[str, Any]:
    """complianceDocsConfirmTarget_: the row, its requirement and why a date may not be confirmed for it."""
    want = gsjs.str_(payload.get("id"))
    row = next((r for r in ledger(reads) if gsjs.str_(r.get("id")) == want), None)
    if row is None:
        return {"refused": {"status": 404, "message": NO_ROW}}
    req = req_of(reads, row.get("reqid"), row.get("cert"))
    stamped, other, employee_id = SP.roster_id(row.get("rosterid")), "", ""
    if stamped:
        found = subject_row(reads, row.get("person"))
        if found is None:
            raise Defer("the staff roster could not be read here")
        if not found or SP.roster_id(found.get("id")) != stamped:
            other = CONFIRM_WORDS["earlier"]
        else:
            employee_id = gsjs.str_(found.get("employee_id"))
    return {"row": row, "req": req, "shut": SP._confirm_shut(req) or other, "employee_id": employee_id}


def upload_record(sess: L.Session, payload: dict) -> dict[str, Any]:
    """certUploadRecord: what the record holds now for a filed document — the witness a confirmation is checked by."""
    shut, _held = review_door(sess, payload, (("id", True, "string"),))
    if shut:
        return shut
    t = confirm_target(sess.reads, payload)
    if t.get("refused"):
        return t["refused"]
    req = t["req"]
    source = gsjs.str_(req.get("date_source")) if req else ""
    data: dict[str, Any] = {"id": gsjs.str_(t["row"].get("id")), "person": gsjs.str_(t["row"].get("person")),
                            "req_id": gsjs.str_(req.get("req_id")) if req else "", "date_source": source,
                            "date_role": SP._date_role(req), "record": "", "record_why": "",
                            "confirm": {"allowed": False, "why": t["shut"]}}
    if t["shut"]:
        return {"status": 200, "data": data}
    now = master_now(sess.reads, t["row"].get("person"), source, t["employee_id"])
    if not now["ok"]:
        data["record_why"] = "The record could not be read for this person: " + now["why"] + "."
        data["confirm"]["why"] = data["record_why"]
        return {"status": 200, "data": data}
    data["record"] = now["value"]
    data["confirm"] = {"allowed": True, "why": ""}
    return {"status": 200, "data": data}


def is_day(s: str) -> bool:
    """complianceDocsIsDay_."""
    m = _DAY.match(s)
    if not m:
        return False
    try:
        date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return False
    return True


def ledger_stamp(reads: L.Reads, row_id: str, cells: dict[str, str]) -> dict[str, Any] | None:
    """complianceDocsPatch_ as a kept edit on the ledger row by its id; None when the copy cannot place it. A ledger
    kept in its own table is stamped there, and the stamp carries no book."""
    if HT.tabled(TAB):
        hits = [(k, c) for k, c in RR.table_rows(reads, HT.resource_of(TAB) or "")
                if gsjs.trim(gsjs.or_blank(c.get("id"))) == row_id]
        if len(hits) != 1:
            return None
        RR.update(reads, HT.resource_of(TAB) or "", hits[0][0], hits[0][1], cells, row_id)
        return {"sid": "", "tab": TAB, "cells": cells, "before": {k: gsjs.or_blank(hits[0][1].get(k)) for k in cells}}
    res = W.tab_of(reads, TAB)
    if res.ref is None:
        return None
    raw_of = {gsjs.trim(gsjs.js_str(h)): h for h in res.ref.headers}
    heads = {k: W.header_of(res.ref, k, norm=True) for k in cells}
    if "id" not in raw_of or any(h is None for h in heads.values()):
        return None
    at = [raw for _rn, raw in reads.db.rows(res.ref) if gsjs.trim(gsjs.or_blank(raw.get(raw_of["id"]))) == row_id]
    if len(at) != 1:
        return None
    sid, tab = W.where_of(res)
    before = {heads[k]: gsjs.cell(hubdb.typed(at[0].get(raw_of[heads[k]]), "hub")) for k in cells}
    return {"sid": sid, "tab": tab, "cells": {heads[k]: v for k, v in cells.items()}, "before": before}


def upload_confirm(sess: L.Session, payload: dict) -> Decision:
    """certUploadConfirm: the date into the Master while it holds `expected`, the ledger row stamped; kept final."""
    shut, held = review_door(sess, payload, (("id", True, "string"), ("date", True, "string"),
                                             ("expected", False, "string")))
    if shut:
        return Decision(shut)
    reads = sess.reads
    day = gsjs.str_(payload.get("date"))
    if not is_day(day):
        return W.refuse(400, "The date must be a calendar day (YYYY-MM-DD).")
    t = confirm_target(reads, payload)
    if t.get("refused"):
        return W.refuse(t["refused"]["status"], t["refused"]["message"], fresh=True)
    if t["shut"]:
        return W.refuse(409, t["shut"] + " Nothing was written.", fresh=True)
    row, req = t["row"], t["req"]
    person, source = gsjs.str_(row.get("person")), gsjs.str_(req.get("date_source"))
    now = master_now(reads, person, source, t["employee_id"])
    if not now["ok"]:
        if "could not be read" in now["why"]:
            raise Defer("the Employee Database could not be read here")
        return W.refuse(409, "The record could not be matched: " + now["why"] + " — nothing was written.", fresh=True)
    expected = gsjs.str_(payload.get("expected"))
    if now["value"] != expected:
        return Decision({"status": 409, "message": 'The record now holds "' + (now["value"] or "nothing")
                         + '", not what was shown — nothing was written.', "data": {"current": now["value"]}},
                        fresh=True)
    # complianceWriteMasterDate_: the Med Del dates are the delegation engine's, and the write is keyed by Employee ID
    if re.match(r"med\s*\d", source, re.I):
        why = "Med Del dates are written by the delegation engine"
    else:
        target = master_target(reads, person, t["employee_id"])
        why = "" if target["ok"] else target["why"]
    cell: dict[str, Any] = {}
    if not why:
        cell = master_cell(reads, source, target["employee_id"], expected)
        if "stale" in cell:
            why = "Someone changed this row since you opened it — reloaded."
        else:
            why = cell.get("why") or ""
    if why:
        return W.refuse(409, "The record was not written: " + why + ".", fresh=True)
    user = sess.user or {}
    by, at = gsjs.str_(user.get("email")), W.now_iso(reads)
    edition = EDITION if held else ""
    subject = SP.fold(person)
    edits = [W.kept_record(cell["sid"], cell["tab"], "edit", cell["match"], cell["key"], subject,
                           {cell["head"]: day}, {cell["head"]: cell["before"]}, edition)]
    stamp = ledger_stamp(reads, gsjs.str_(row.get("id")),
                         {"confirmed_on": day, "confirmed_by": by, "confirmed_at": at})
    if stamp is not None and stamp["sid"]:
        edits.append(W.kept_record(stamp["sid"], stamp["tab"], "edit", "id", gsjs.str_(row.get("id")), subject,
                                   stamp["cells"], stamp["before"], edition))
    stamped = stamp is not None
    data = {"id": gsjs.str_(row.get("id")), "req_id": gsjs.str_(req.get("req_id")), "date_source": source,
            "confirmed_on": day, "confirmed_by": by, "confirmed_at": at, "ledger_stamped": stamped,
            "message": "The record now holds " + day + "; the status follows at the next check."
                       + ("" if stamped else " The ledger row could not be stamped as confirmed.")}
    answer = {"status": 200, "data": W.with_steps(data, W.pg_steps(STEP_WORDS, CACHES, APP_ID))}
    return W.final(answer, edits, subject, edition)


# ---- the doors -------------------------------------------------------------------------------------------------------

# ---- a paper filed (certDocUpload): its plan before Drive, then its ledger row --------------------------------------

LEDGER_HEADER = ("id", "person", "cert", "name", "url", "by", "at", "file_id", "req_id", "read_state", "read_kind",
                 "issued_on", "expires_on", "read_how", "read_confidence", "read_why", "read_at", "read_v",
                 "confirmed_on", "confirmed_by", "confirmed_at", "read_tries", "roster_id")
B64_MAX = 21000000
TYPE_WORDS = "Images and PDFs only — a PDF, or a PNG, JPEG, GIF, WebP or HEIC picture."
NOBODY = ("A document filed from the master's session names whose record it goes on — choose the person first. "
          "Nothing was filed.")
NOT_FILED = "The document could not be filed just now — try again in a minute. Nothing was filed."
FILED_WORDS = "The paper filed in Drive as the platform's account, and its ledger row kept in the Hub's database."
_FILE_ID = re.compile(r"[A-Za-z0-9_-]{10,}")


def _mime(v: Any) -> str:
    return gsjs.trim(gsjs.str_(v).lower().split(";")[0])


def type_ok(mime: Any) -> str:
    """complianceDocsTypeOk_."""
    m = _mime(mime)
    if m in ("image/jpg", "image/pjpeg"):
        m = "image/jpeg"
    return m if m in L.DOC_TYPES.values() else ""


def type_by_name(name: Any) -> str:
    """complianceDocsTypeByName_."""
    m = re.search(r"\.([A-Za-z0-9]{1,5})\Z", gsjs.str_(name))
    return L.DOC_TYPES.get(m.group(1).lower(), "") if m else ""


def file_type(name: Any, mime: Any) -> str:
    """complianceDocsFileType_: FAIL-CLOSED, one of the types the ledger stores or ''."""
    m = _mime(mime)
    loose = not m or m == "application/octet-stream"
    sent = type_ok(mime)
    if not loose and not sent:
        return ""
    by = type_by_name(name)
    heif = ("image/heic", "image/heif")
    if by and sent and not (by == sent or (by in heif and sent in heif)):
        return ""
    return by or sent


def people(reads: L.Reads) -> list[dict] | None:
    """complianceDocsPeople_; None when the roster cannot be read."""
    rows, _w = SP._soft(lambda: SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads))))
    return rows or None


def filing_name(reads: L.Reads, asked: str) -> dict[str, Any]:
    """complianceDocsFilingName_: a paper filed for someone else is kept under the roster's spelling and id."""
    key = SP.fold(asked)
    if not key:
        return {"name": asked, "id": ""}
    rows = people(reads)
    if rows is None:
        return {"error": {"status": 503, "message": "The staff roster could not be read, so whose record this document "
                          "belongs to could not be settled — try again in a minute. Nothing was filed."}}
    same = [p for p in rows if SP.fold((p or {}).get("name")) == key]
    if len(same) > 1:
        return {"error": {"status": 409, "message": f'Two rows on the staff roster carry "{asked}", so a document '
                          "filed under it could not be told apart — an administrator merges the rows or gives one a "
                          "distinguishing name. Nothing was filed."}}
    if len(same) == 1:
        return {"name": gsjs.str_(same[0].get("name")), "id": SP.roster_id(same[0].get("id"))}
    try:
        found = find_master_row(reads, asked, "")
    except (Defer, hubdb.Unreadable):
        return {"error": {"status": 503, "message": "The Employee Database could not be read, so the roster row "
                          f'"{asked}" belongs to could not be found — try again in a minute. Nothing was filed.'}}
    eid = gsjs.str_((found.get("row") or {}).get("employee_id"))
    if eid:
        by_id = [p for p in rows if gsjs.str_((p or {}).get("employee_id")) == eid]
        if len(by_id) == 1 and SP.fold(by_id[0].get("name")):
            return {"name": gsjs.str_(by_id[0].get("name")), "id": SP.roster_id(by_id[0].get("id"))}
    return {"name": asked, "id": ""}


def upload_plan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """certDocUpload's every refusal, in its words, before anything is filed: whose record, which requirement and
    folder, the type and size, and whether the paper is read — from asa-hub-db. The relay asks it first."""
    user = sess.user
    if not user or user.get("is_service") or gsjs.js_str(user.get("role")) not in ROLES:
        return denied()
    try:
        return _upload_plan(sess.reads, user, payload)
    except (Defer, hubdb.Unreadable):
        return {"status": 503, "message": NOT_FILED}


def _upload_plan(reads: L.Reads, user: dict, payload: dict) -> dict[str, Any]:
    import my_profile as MP  # noqa: PLC0415 - App Control's My Requirements row is My Profile's own
    # a badge My Requirements is shut to files no requirement paper (the master always passes)
    if not MP.requirements_open(user, reads):
        return denied()
    cert = gsjs.str_(payload.get("cert"))
    req = None
    if gsjs.str_(payload.get("req_id")):
        # a requirement id names its own label and folder: the payload's text is not asked
        req = req_of(reads, payload.get("req_id"), "")
        if not req:
            return {"status": 400, "message": "That requirement is not in the catalogue. Nothing was filed."}
        shut = SP._req_shut(req)
        if shut:
            return {"status": 400, "message": shut + " Nothing was filed."}
        cert = gsjs.str_(req.get("label"))
    if not cert:
        return {"status": 400, "message": "A certification is required."}
    # a name with no letters or digits names nobody, and is taken as no name at all
    asked = gsjs.str_(payload.get("person")) if SP.fold(gsjs.str_(payload.get("person"))) else ""
    master = sc.is_real_master(user)
    if not asked and master:
        return {"status": 400, "message": NOBODY}
    if asked and (master or gsjs.js_str(user.get("role")) in ("admin", "manager")):
        # a writer naming themselves in another spelling files where their own list reads
        mine = SP.compliance_self(reads, user)
        if mine["key"] and SP.fold(asked) in mine["names"]:
            person, rid = mine["name"], mine["id"]
        else:
            filed_as = filing_name(reads, asked)
            if filed_as.get("error"):
                return filed_as["error"]
            person, rid = filed_as["name"], gsjs.str_(filed_as.get("id"))
    else:
        me = SP.compliance_self(reads, user)
        if not me["key"]:
            return {"status": me["status"], "message": me["why"] + " Nothing was filed."}
        if asked and SP.fold(asked) not in me["names"]:
            return {"status": 403, "message": f'A certificate is filed against your own record — "{asked}" is not the '
                    f'name this account is known by ("{me["name"]}"). Filing for someone else is for an administrator '
                    "or a manager; if this is you, an administrator gives your account the exact name on your roster "
                    "row. Nothing was filed."}
        person, rid = me["name"], me["id"]
    name = gsjs.str_(payload.get("filename")) or "document"
    mime = file_type(name, payload.get("mime"))
    if not mime:
        return {"status": 400, "message": TYPE_WORDS + " Nothing was filed."}
    chars = payload.get("b64_chars")
    chars = chars if isinstance(chars, int) and not isinstance(chars, bool) else 0
    if not chars:
        return {"status": 400, "message": "The file is required."}
    if chars > B64_MAX:
        return {"status": 400, "message": "The file is too large — up to 15MB."}
    root = gsjs.trim(reads.db.prop("HUB_PLATFORM_FOLDER_ID")) or PLATFORM_ROOT
    # a paper filed under a requirement it is read for waits for its reading; filing never waits on the catalogue
    owed = req
    if owed is None:
        try:
            owed = req_of(reads, "", cert)
        except (Defer, hubdb.Unreadable):
            owed = None
    read_owed = bool(owed) and not SP._req_shut(owed) and not visit(user)
    import smart_comms_desk as SCD  # noqa: PLC0415 - the test-mode switch the courtesy copy obeys
    try:
        test_on = SCD.test_mode_state(reads.config())["on"] is not False
    except (Defer, hubdb.Unreadable):
        test_on = True
    return {"status": 200, "data": {
        "person": person, "roster_id": SP.roster_id(rid), "req_id": gsjs.str_(owed.get("req_id")) if owed else "",
        "cert": cert, "folder": cert, "name": name, "mime": mime, "read_owed": read_owed, "platform_root": root,
        "shared_folder": gsjs.trim(reads.db.prop("COMPLIANCE_SHARED_FOLDER_ID")),
        # the courtesy copy in the shared archive: never while test mode is on
        "shared_copy": not test_on}}


def upload(sess: L.Session, payload: dict) -> Decision:
    """certDocUpload, once the relay filed the paper in Drive as asatech: every refusal of the plan decided again,
    then the ledger row appended whole, kept final. Its reading is the lane's (app.cert_reads, laid over the row)."""
    user = sess.user
    if not user or user.get("is_service") or gsjs.js_str(user.get("role")) not in ROLES:
        return Decision(denied())
    try:
        planned = _upload_plan(sess.reads, user, payload)
    except (Defer, hubdb.Unreadable):
        return W.refuse(503, NOT_FILED)
    if planned["status"] != 200:
        return Decision(planned)
    plan, reads = planned["data"], sess.reads
    filed = payload.get("filed") if isinstance(payload.get("filed"), dict) else {}
    file_id = gsjs.str_(filed.get("file_id"))
    if not _FILE_ID.fullmatch(file_id):
        return W.refuse(400, "The relay named no filed file. Nothing was filed.")
    row = {"id": W.mint(), "person": plan["person"], "cert": plan["cert"], "name": plan["name"],
           "url": f"https://drive.google.com/file/d/{file_id}/view", "by": gsjs.str_(user.get("email")),
           "at": W.now_iso(reads), "file_id": file_id, "req_id": plan["req_id"],
           "read_state": "pending" if plan["read_owed"] else "", "roster_id": plan["roster_id"]}
    cells = {h: row.get(h, "") for h in LEDGER_HEADER}
    subject = SP.fold(plan["person"])
    if HT.tabled(TAB):
        # every header kept, a blank one too, so the ledger reads as the sheet's did
        RR.create(reads, HT.resource_of(TAB) or "", {h: W.sheet_text(v) for h, v in cells.items()}, subject)
        rec = None
    else:
        rec = W.append_record(W.tab_of(reads, TAB), LEDGER_HEADER, cells, subject)
    data = {**SP.upload_out({hubdb.norm_key(k): v for k, v in cells.items()}), "id": row["id"], "url": row["url"],
            "by": row["by"], "shared": filed.get("shared") is True, "read_state": row["read_state"],
            "read_owed": plan["read_owed"]}
    answer = {"status": 200, "data": W.with_steps(data, W.pg_steps(FILED_WORDS, CACHES, APP_ID))}
    return W.final(answer, [rec], subject) if rec is not None else Decision(answer, subject=subject, own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "certUploadsList": uploads_list, "certDocFile": doc_file, "certDocRead": doc_read,
    "certUploadRecord": upload_record,
    # the relay's own: a filing's plan, asked before Drive
    "certDocUploadPlan": upload_plan,
}
# HUB_POLICY: the roles each read is declared for; the required params are checked in the door, in their order
POLICY: dict[str, dict[str, Any]] = {
    "certUploadsList": {"roles": ROLES, "params": {}},
    "certDocFile": {"roles": ROLES, "params": {}},
    "certDocRead": {"roles": ROLES, "params": {}},
    # the master's, and a review holder's of any employee role: the door says "for admin" to anyone else
    "certUploadRecord": {"roles": sc.EDITION_ROLES, "params": {}},
    "certDocUploadPlan": {"roles": ROLES, "params": {"req_id": "string"}},
}
WRITE = types.SimpleNamespace(
    ACTIONS={"certUploadConfirm": upload_confirm, "certDocUpload": upload},
    POLICY={"certUploadConfirm": {"roles": sc.EDITION_ROLES, "params": {}},
            "certDocUpload": {"roles": ROLES, "params": {"req_id": "string"}}},
    # the platform's write lock held by another write: Python's own sentence, never a hand-off
    BUSY_OF={a: {"status": 409, "message": W.BUSY} for a in ("certUploadConfirm", "certDocUpload")},
)


class Store(RR.Store):
    """app.cert_docs_writes and app.cert_docs_receipts, beside the other apps' own; the ledger's rows
    (app.resource_rows) taken back with a void."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="cert_docs", label=APP_NAME)
