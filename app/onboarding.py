"""Onboarding (Onboarding.gs, Seat.gs, Packet.gs) off asa-hub-db: the new hire's six steps as the record holds them
(obFlow), the six packet forms (packetState), a candidate's access window (onboardingWindowGet), the rows a seat holds
(seatStatus) and a paper the portal filed, read off the server's copy (obDocFile). A file's heavy half is done by a read
the relay asks before the write that records it: obDocPrepare keeps an upload on the server and files it in Drive as
the platform's account (and in the staff archive once live), obPacketPrepare the signed New Hire packet, and
obDocTrash puts a removed upload in Drive's bin."""
from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import candidates as CND
import gsjs
import hubdb
import location_docs as LD
import locations as L
import names as N
import scope as sc
from scope import Defer

log = logging.getLogger("asa-hub-app")

APP_ID = "onboarding"
PACKET_TAB = CND.PACKET_TAB
# Seat.gs SEAT_FLOWS: a seat is an account, never a role
SEAT_ACCOUNTS = ("onboarding@asalifecare.com",)
SEAT_FLOWS = {"onboarding": {"seat_email": "HubEmail", "seat_id": "HubCandidateId", "label": "FullName",
                             "label_fallback": "CandidateName", "finished": "CompletedAt", "released_at": "ReleasedAt",
                             "released_by": "ReleasedBy", "durable_id": "GradCandidateId"},
              "interview": None}
# Onboarding.gs PACKET_ITEMS
PACKET_ITEMS = (("job_app", "Job Application", "JobApp", "JobAppFileId"),
                ("attestation", "Attestation", "Attestation", "AttestationFileId"),
                ("i9", "I-9 Form", "I9Form", "I9FormFileId"), ("w4", "W-4 Form", "W4Form", "W4FormFileId"),
                ("hipaa", "HIPAA Form", "HIPAAForm", "HIPAAFormFileId"),
                ("pay_auth", "Pay Authorization", "PayAuthForm", "PayAuthFormFileId"))
# Onboarding.gs ID_DOCS: this list's id, the platform's catalogue id, the tracker's columns and the old form's words
ID_DOCS = (
    {"id": "drivers_license", "label": "Driver's License", "cat": "drivers_id", "col": "DLID", "file": "DLIDFileId",
     "prior": "Drivers License / OH ID"},
    {"id": "car_insurance", "label": "Car Insurance Card", "cat": "car_insurance", "col": "CarInsurance",
     "file": "CarInsuranceFileId", "prior": "Car Insurance Card"},
    {"id": "hs_diploma", "label": "High School Diploma", "cat": "hs_diploma", "col": "HSDiploma",
     "file": "HSDiplomaFileId", "prior": "HS Diploma / Transcripts / GED"},
    {"id": "cpr", "label": "CPR Certification", "cat": "cpr_first_aid", "col": "CertCPRFirstAid",
     "file": "CertCPRFirstAidFileId", "prior": "CPR / 1st Aid Certificate"},
    {"id": "dodd_8hr", "label": "8 Hour DODD Training Certificate", "cat": "dodd_8hr", "col": "EightHrTrain",
     "file": "EightHrTrainFileId", "prior": "DODD Training Certificate"},
    {"id": "ss_birth", "label": "Social Security Card / Birth Certificate", "cat": "ss_birth", "col": "SSBirth",
     "file": "SSBirthFileId", "prior": "Social Security Card / Birth Certificate"},
    {"id": "med_del", "label": "Med Delegation Certificate", "cat": "med_del", "col": "MedDel", "file": "MedDelFileId",
     "prior": "Med Del Cert"})
DOC_OF = {d["id"]: d for d in ID_DOCS}
PRIOR_PROP, PRIOR_TAB = "PRIOR_DOCS_SHEET_ID", "Responses"
TARGET_PROP, PENDING_PROP = "ONBOARDING_DOCS_TARGET", "PENDING_DOCS_FOLDER_ID"
# StaffDocs.gs staffDocsFolderId_: the staff archive a live upload is copied into
ARCHIVE_PROP = "COMPLIANCE_SHARED_FOLDER_ID"
TEST_FOLDER = "Pending Documents (test)"
# Files.gs: the platform folder (pinned, else remembered) and its Uploads branch
ROOT_PROPS = ("HUB_PLATFORM_FOLDER_ID", "HUB_FOLDER_ROOT_ID")
UPLOADS_PROP, UPLOADS_NAME = "HUB_FOLDER_UPLOADS_ID", "Uploads"
WINDOW_BEFORE_DAYS, WINDOW_AFTER_DAYS = 0, 30
MAX_BYTES = 15 * 1024 * 1024
PACKET_DOC = "new_hire_packet"
DOC_DIR = "onboarding"
OCTET = "application/octet-stream"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
SHUT = {"status": 403, "message": "Onboarding is not open to this account."}
NOT_LISTED = "You are not on the onboarding list yet."
NAME_FIRST = "Give your full name in step 1 first — that is what opens your record."
_FILE_ID = re.compile(r"^[A-Za-z0-9_-]{10,}\Z")
_SAFE = re.compile(r"[^A-Za-z0-9 ._()\-]+")
_PRIOR_HELD: dict[tuple[str, str], dict[str, Any]] = {}
_PRIOR_LOCK = threading.Lock()

s_ = CND.s_


def drive_url(fid: str) -> str:
    return "https://drive.google.com/file/d/" + fid + "/view"


# ---- who may ask (Onboarding.gs obMayAddressOther_, Seat.gs seatIsSeatAccount_) -------------------------------------

def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and s_((user or {}).get("role")) in ("admin", "manager")


def seat_account(user: dict | None) -> bool:
    mail = s_((user or {}).get("email")).lower()
    return bool(mail) and mail in SEAT_ACCOUNTS


def may_address_other(user: dict | None) -> bool:
    """obMayAddressOther_: the machine, a writer, or the shared onboarding seat."""
    if not user:
        return False
    return bool(user.get("is_service")) or writer(user) or seat_account(user)


def candidate_id(reads: L.Reads, user: dict | None) -> str:
    """userPublic_'s candidate_id: the users row's own, else the first candidate filed under the account's address."""
    u = user or {}
    if u.get("is_service"):
        return ""

    def read() -> str:
        uid = s_(u.get("id"))
        row = next((r for r in reads.users() if s_(r.get("userid")) == uid), None) if uid else None
        own = s_((row or {}).get("candidateid"))
        if own:
            return own
        mail = s_(u.get("email")).lower()
        if not mail:
            return ""
        rows, why = CND.soft(lambda: CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB))
        for c in [] if why else rows or []:
            if s_(c.get("email")).lower() == mail:
                return s_(c.get("candidateid"))
        return ""
    return reads.once("onb:cid:" + s_(u.get("id")), read)


def lane(sess: L.Session) -> dict[str, Any] | None:
    """Who may use the portal's doors: the seat, a trainee, the machine and anyone with a packet row of their own, as
    Apps Script lets them; anyone else only as App Control opens the app (the master always)."""
    user = sess.user
    if not user:
        return dict(DENIED)
    if user.get("is_service") or seat_account(user) or s_(user.get("role")).lower() == "onboarding":
        return None
    if sc.is_real_master(user):
        return None
    reads = sess.reads
    if find_row(reads, s_(user.get("email")), candidate_id(reads, user)) is not None:
        return None
    return None if sc.profile_app_gate(APP_ID, user, reads.scope_sources()).get("open") is True else dict(SHUT)


def asked_for(sess: L.Session, payload: dict) -> tuple[str, str]:
    """The e-mail and candidate id a read answers about: the payload's only for a caller entitled to name another."""
    user = sess.user or {}
    p = payload if isinstance(payload, dict) else {}
    may = may_address_other(user)
    email = (s_(p.get("email")) if may else "") or s_(user.get("email"))
    cid = (s_(p.get("candidate_id")) if may else "") or candidate_id(sess.reads, user)
    return email, cid


# ---- the packet row (Onboarding.gs packetFindRow_, obField_) --------------------------------------------------------

def header(reads: L.Reads) -> list[str]:
    """packetSheet_'s header: the row's columns, PACKET_OWN_COLUMNS ensured."""
    return [gsjs.trim(h) for h in CND.shim(reads, PACKET_TAB, CND.PACKET_OWN_COLUMNS)[0]]


def _subject(hdr: list[str], values: list[str]) -> str:
    """hiringRowKey_: the row's CandidateId, the subject its facts are kept under."""
    for name in ("CandidateId", "candidateid"):
        if name in hdr:
            i = hdr.index(name)
            return gsjs.trim(values[i]) if i < len(values) else ""
    return ""


def rows(reads: L.Reads) -> list[dict[str, Any]]:
    """Every packet row as {hdr, values, subject}."""
    hdr_raw, grid = CND.shim(reads, PACKET_TAB, CND.PACKET_OWN_COLUMNS)
    hdr = [gsjs.trim(h) for h in hdr_raw]
    return [{"hdr": hdr, "values": list(line), "subject": _subject(hdr, line)} for line in grid]


def find_row(reads: L.Reads, email: Any, cid: Any, include_finished: bool = False) -> dict[str, Any] | None:
    """packetFindRow_, with the row's subject."""
    got = CND.packet_find_row(reads, email, cid, include_finished)
    if got is None:
        return None
    return {"hdr": got["hdr"], "values": list(got["values"]), "subject": _subject(got["hdr"], got["values"])}


def field(found: dict | None, name: str) -> str:
    return CND.ob_field(found, name)


def laid(found: dict, cells: dict[str, str]) -> dict[str, Any]:
    """The row with these cells written (obSetField_: a column the row lacks is never written)."""
    values = list(found["values"])
    for k, v in cells.items():
        if k in found["hdr"]:
            i = found["hdr"].index(k)
            values += [""] * (i + 1 - len(values))
            values[i] = v
    return {**found, "values": values}


# ---- what the person already sent (obPriorSubmissions_, obCanonicalHave_) ----------------------------------------

def _prior_index(reads: L.Reads) -> dict[str, Any] | None:
    """The old form's submissions, one entry per person, held while the copy of the book is the same one."""
    sid = gsjs.trim(reads.db.prop(PRIOR_PROP))
    if not sid:
        return None
    import house_tables as HT  # noqa: PLC0415 - kept in Postgres since 10-27
    ref = HT.book_tab(reads, sid, PRIOR_TAB)
    reads.db.note_book(sid)
    if ref is None:
        return None
    key = (ref.table, str(ref.loaded_at))
    with _PRIOR_LOCK:
        held = _PRIOR_HELD.get(key)
    if held is not None:
        return held
    got = CND._book_rows(reads, sid, PRIOR_TAB)
    if got is None:
        return None
    hdr, values = got
    i_name = hdr.index("Your Name") if "Your Name" in hdr else -1
    i_doc = hdr.index("Select Document") if "Select Document" in hdr else -1
    i_url = i_exp = i_cert = -1
    for h, name in enumerate(hdr):
        if name.startswith("Upload your document"):
            i_url = h
        if name == "Date of Expiration":
            i_exp = h
        if name == "Date of Certification":
            i_cert = h
    def at(line: list, i: int) -> str:
        return gsjs.or_text(line[i]) if 0 <= i < len(line) else ""

    people: list[dict[str, Any]] = []
    seen: dict[str, dict[str, Any]] = {}
    if i_name != -1 and i_doc != -1:
        for line in values:
            raw = gsjs.trim(at(line, i_name))
            k = " ".join(N.tokens(raw)["core"])
            if not k:
                continue
            if k not in seen:
                seen[k] = {"name": raw, "key": k, "rows": []}
                people.append(seen[k])
            seen[k]["rows"].append({"doc": gsjs.trim(at(line, i_doc)), "url": gsjs.trim(at(line, i_url)),
                                    "submitted": at(line, 0), "expires": at(line, i_exp),
                                    "certified": at(line, i_cert), "name": raw})
    index = {"ok": i_name != -1 and i_doc != -1, "people": people}
    with _PRIOR_LOCK:
        _PRIOR_HELD.clear()
        _PRIOR_HELD[key] = index
    return index


def prior_submissions(reads: L.Reads, full_name: str) -> dict[str, Any]:
    """obPriorSubmissions_: what this person sent through the old form, by a tolerant name match that refuses two close
    names; an unreadable form gives no head start."""
    empty: dict[str, Any] = {"docs": {}, "matched_name": "", "score": 0, "ambiguous": None}
    if not N.norm(full_name):
        return empty
    index, why = CND.soft(lambda: _prior_index(reads))
    if why or not index or not index["ok"]:
        return empty
    people = index["people"]
    best = N.best(full_name, people, lambda p: p["name"])
    if not best["ok"]:
        return {"docs": {}, "matched_name": "", "score": best.get("score") or 0,
                "ambiguous": best.get("candidates") if best.get("reason") == "ambiguous" else None}
    claimed: list[dict] = []
    for p in people:
        if p["key"] == best["item"]["key"] or N.score(best["matched_name"], p["name"]) >= N.NAME_MATCH_MIN:
            claimed += p["rows"]
    by_prior: dict[str, dict] = {}
    for r in claimed:
        if not r["doc"]:
            continue
        entry = {k: r[k] for k in ("url", "submitted", "expires", "certified", "name")}
        if r["doc"] not in by_prior or entry["submitted"] > by_prior[r["doc"]]["submitted"]:
            by_prior[r["doc"]] = entry
    return {"docs": by_prior, "matched_name": best["matched_name"], "score": best["score"], "ambiguous": None}


def canonical_have(reads: L.Reads, cid: str) -> dict[str, dict]:
    """obCanonicalHave_: the catalogue ids this person has an uploaded or verified document row for."""
    if not cid:
        return {}
    index, why = CND.soft(lambda: CND.onboarding_doc_index(reads))
    mine = {} if why else (index or {}).get(cid) or {}
    return {k: v for k, v in mine.items() if s_(v.get("status")) in ("uploaded", "verified")}


# ---- the pipeline the portal reads (obStageHasCandidates_, seatFindCandidateId_) ---------------------------------

def stage_open(reads: L.Reads) -> bool:
    """obStageHasCandidates_: is anybody at the onboarding stage right now."""
    for c in CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB):
        if not s_(c.get("candidateid")) or s_(c.get("archived")).lower() == "true":
            continue
        if CND.stage_of(c.get("status")) == "onboarding":
            return True
    return False


def find_candidate_id(reads: L.Reads, name: str) -> str:
    """seatFindCandidateId_: the live candidate this typed name is, '' when none or two fit."""
    if not N.norm(name):
        return ""
    live = [c for c in CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB)
            if s_(c.get("candidateid")) and s_(c.get("archived")).lower() != "true"]
    best = N.best(name, live, lambda c: s_(c.get("candidatename")))
    return s_(best["item"].get("candidateid")) if best["ok"] else ""


def person_id(reads: L.Reads, found: dict | None) -> str:
    """The candidate this row's visit is: its graduation id, else the one its typed name resolves to."""
    grad = field(found, "GradCandidateId")
    if grad:
        return grad
    full = field(found, "FullName")
    got, why = CND.soft(lambda: find_candidate_id(reads, full)) if full else ("", "")
    return "" if why else got or ""


# ---- the server's copy of what the portal filed ------------------------------------------------------------------

def base() -> Path:
    return LD.ROOT / DOC_DIR


def _safe(v: str, n: int = 150) -> str:
    return _SAFE.sub("_", v)[:n].strip() or "file"


def kept_dir(subject: str, doc: str, drive_id: str) -> Path:
    return base() / _safe(subject, 80) / doc / drive_id


def kept_find(drive_id: str) -> Path | None:
    """The folder a Drive file's server copy is kept in, or None."""
    if not _FILE_ID.fullmatch(drive_id or ""):
        return None
    hits = [p for p in base().glob(f"*/*/{drive_id}") if p.is_dir()]
    return hits[0] if hits else None


def keep(subject: str, doc: str, drive_id: str, name: str, mime: str, data: bytes, by: str) -> str:
    """The bytes on the server's disk beside what they are; the path under the documents root."""
    folder = kept_dir(subject, doc, drive_id)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / _safe(name)
    tmp = target.with_name(target.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, target)
    (folder / "meta.json").write_text(json.dumps({"name": name, "file": target.name, "mime": mime, "size": len(data),
                                                  "by": by, "at": gsjs.iso(datetime.now(timezone.utc))}),
                                      encoding="utf-8")
    return str(target.relative_to(LD.ROOT))


def kept_id(fid: str) -> str:
    return fid if fid and kept_find(fid) is not None else ""


# ---- the flow (Onboarding.gs obFlow) -----------------------------------------------------------------------------

def flow_of(reads: L.Reads, found: dict | None) -> dict[str, Any]:
    """obFlow's data for one row: the six steps, each document and where it came from, the packet and the window,
    resolved from the name typed and failing open."""
    full = field(found, "FullName")
    prior = prior_submissions(reads, full) if full else {"docs": {}, "matched_name": "", "ambiguous": None}
    prior_docs = prior.get("docs") or {}
    pcid = person_id(reads, found) if found else ""
    on_record = canonical_have(reads, field(found, "GradCandidateId") or pcid)
    docs = []
    for d in ID_DOCS:
        mine = field(found, d["file"])
        signed = CND.packet_truthy(field(found, d["col"]))
        early = prior_docs.get(d["prior"])
        kept = on_record.get(d["cat"]) if d["cat"] else None
        if not mine and kept:
            url = s_(kept.get("file_url"))
            docs.append({"id": d["id"], "label": d["label"], "status": "uploaded", "source": "you sent this here",
                         "file_url": url, "expires": s_(kept.get("expires_on")), "kept_id": kept_id(L.drive_id(url))})
        elif mine:
            docs.append({"id": d["id"], "label": d["label"], "status": "uploaded", "source": "you sent this here",
                         "file_url": drive_url(mine), "kept_id": kept_id(mine)})
        elif early and early.get("url"):
            docs.append({"id": d["id"], "label": d["label"], "status": "on_file", "source": "already on file",
                         "file_url": early["url"], "submitted": early["submitted"], "expires": early["expires"],
                         "certified": early["certified"]})
        elif signed:
            docs.append({"id": d["id"], "label": d["label"], "status": "claimed",
                         "source": "marked done, no copy attached", "file_url": ""})
        else:
            docs.append({"id": d["id"], "label": d["label"], "status": "missing", "source": "", "file_url": ""})
    done = sum(1 for d in docs if d["status"] in ("uploaded", "on_file"))
    packet = {"state": "unknown", "on_file": False}
    window: dict[str, Any] = {"open": True, "reason": "", "until": "", "anchored_on": ""}
    if pcid:
        def read() -> tuple[dict, dict | None]:
            cand = CND.evidence(reads, pcid).get("cand")
            return CND.packet_state(reads, cand), cand
        got, why = CND.soft(read)
        if not why and got:
            pres, cand = got
            packet = {"state": s_(pres.get("state")) or "unknown", "on_file": pres.get("state") in ("signed", "waived")}
            if cand:
                w, why_w = CND.soft(lambda: CND.onboarding_window(reads, cand))
                if not why_w and w:
                    window = w
    flag = (lambda col: CND.packet_truthy(field(found, col)))
    return {"found": bool(found), "packet_state": packet["state"], "packet_on_file": packet["on_file"],
            "stage_open": stage_open(reads), "window_open": window.get("open") is not False,
            "window_until": s_(window.get("until")), "window_reason": s_(window.get("reason")),
            "window_anchored_on": s_(window.get("anchored_on")), "full_name": full,
            "packet_acknowledged": flag("PacketAcknowledged"), "background_done": flag("BackgroundCheck"),
            "documents_done": flag("DocumentsComplete"), "training_done": flag("CompleteTraining"),
            "questionnaire_done": flag("QuestionnaireComplete"), "tutorials_done": flag("TutorialsComplete"),
            "docs": docs, "docs_done": done, "docs_total": len(docs), "prior_count": len(prior_docs),
            "matched_name": prior.get("matched_name") or "", "name_ambiguous": prior.get("ambiguous") or None}


def ob_flow(sess: L.Session, payload: dict) -> dict[str, Any]:
    """obFlow: the whole flow in one read, about the caller (another person only for those entitled to name one)."""
    shut = lane(sess)
    if shut:
        return shut
    email, cid = asked_for(sess, payload)
    return {"status": 200, "data": flow_of(sess.reads, find_row(sess.reads, email, cid))}


def packet_state(sess: L.Session, payload: dict) -> dict[str, Any]:
    """packetState: the six packet forms — signed only with a file attached."""
    shut = lane(sess)
    if shut:
        return shut
    email, cid = asked_for(sess, payload)
    found = find_row(sess.reads, email, cid)
    items = []
    for iid, label, col, fcol in PACKET_ITEMS:
        if not found:
            items.append({"id": iid, "label": label, "status": "missing", "file_url": ""})
            continue
        signed = CND.packet_truthy(field(found, col))
        fid = field(found, fcol)
        items.append({"id": iid, "label": label, "status": ("signed" if fid else "claimed") if signed else "missing",
                      "file_url": drive_url(fid) if fid else ""})
    return {"status": 200, "data": {"found": bool(found), "candidate_name": field(found, "CandidateName"),
                                    "items": items, "done": sum(1 for i in items if i["status"] == "signed"),
                                    "total": len(items)}}


# ---- the access window on the onboarding row (Onboarding.gs onboardingWindow_) -----------------------------------

def _window_days(reads: L.Reads, key: str, fallback: int) -> int:
    """onboardingWindowDays_: the script property, else the floor."""
    m = re.match(r"^\s*[+-]?\d+", s_(reads.db.prop(key)))
    n = int(m.group(0)) if m else -1
    return fallback if n < 0 else n


def _bounds(local: datetime, end: bool) -> float:
    """onboardingDayBounds_: the start or end of that day on the script's clock."""
    x = local.replace(hour=23, minute=59, second=59, microsecond=999000) if end else \
        local.replace(hour=0, minute=0, second=0, microsecond=0)
    return x.timestamp() * 1000.0


def access_window(reads: L.Reads, ob: dict | None) -> dict[str, Any]:
    """onboardingWindow_: the row's own edges, else the day they entered onboarding widened by the window's days."""
    if not ob:
        return {"open": True, "from": "", "until": "", "reason": "no onboarding row yet"}
    af, au = s_(ob.get("accessfrom")), s_(ob.get("accessuntil"))
    frm = CND.js_date_ms(af) if af else None
    until = CND.js_date_ms(au) if au else None
    if (af and frm is None) or (au and until is None):
        frm = until = None
    if frm is None or until is None:
        moved = s_(ob.get("datemovedtoonboarding"))
        anchor = CND.js_date_ms(moved) if moved else None
        if anchor is None:
            return {"open": True, "from": "", "until": "", "reason": "no onboarding date"}
        if frm is None:
            frm = _bounds(CND._shift_days(anchor, -_window_days(reads, "ONBOARDING_WINDOW_BEFORE_DAYS",
                                                               WINDOW_BEFORE_DAYS)), False)
        if until is None:
            until = _bounds(CND._shift_days(anchor, _window_days(reads, "ONBOARDING_WINDOW_AFTER_DAYS",
                                                                WINDOW_AFTER_DAYS)), True)
    now = CND.now_ms(reads)
    is_open = frm <= now <= until
    return {"open": is_open, "from": CND.iso_ms(frm), "until": CND.iso_ms(until),
            "reason": "" if is_open else ("not open yet" if now < frm else "window closed")}


def onboarding_row(reads: L.Reads, cid: str) -> dict | None:
    """onboardingRowFor_: the person's onboarding row; onboardingSheet_ makes the tab, so one not born holds none."""
    try:
        return CND.onboarding_row(reads, cid)
    except (Defer, hubdb.Unreadable):
        raise
    except RuntimeError:
        return None


def window_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """onboardingWindowGet: one person's window, read by a writer, the seat, or that person."""
    user = sess.user
    if not user:
        return dict(DENIED)
    reads = sess.reads
    cid = s_((payload or {}).get("candidate_id")) if isinstance(payload, dict) else ""
    if not cid:
        return {"status": 400, "message": "candidate_id is required"}
    if not may_address_other(user) and cid != candidate_id(reads, user):
        return dict(DENIED)
    w = access_window(reads, onboarding_row(reads, cid))
    return {"status": 200, "data": {"window_open": w["open"], "window_from": w["from"], "window_until": w["until"],
                                    "window_reason": w["reason"],
                                    "window_applies": s_(user.get("role")) == "onboarding",
                                    "can_extend": writer(user)}}


# ---- the seat (Seat.gs seatHeldRows_, seatStatus) ------------------------------------------------------------------

def held_rows(reads: L.Reads, user: dict | None) -> list[dict[str, Any]]:
    """seatHeldRows_: the rows this account's seat columns name — never the person's own address."""
    flow = SEAT_FLOWS["onboarding"]
    mail = s_((user or {}).get("email")).lower()
    cid = candidate_id(reads, user)
    out = []
    for r in rows(reads):
        by_mail = bool(mail) and field(r, flow["seat_email"]).lower() == mail
        by_id = bool(cid) and field(r, flow["seat_id"]) == cid
        if by_mail or by_id:
            out.append(r)
    return out


def seat_status(sess: L.Session, payload: dict) -> dict[str, Any]:
    """seatStatus: who this seat holds, changing nothing; a flow with no seat holds nothing, for anyone."""
    if not sess.user:
        return dict(DENIED)
    name = s_((payload or {}).get("flow")) if isinstance(payload, dict) else ""
    if name not in SEAT_FLOWS:
        return {"status": 400, "message": f'Unknown seat flow: "{name}".'}
    flow = SEAT_FLOWS[name]
    if not flow:
        return {"status": 200, "data": {"held": 0, "people": [], "server_side": False}}
    shut = lane(sess)
    if shut:
        return shut
    got = held_rows(sess.reads, sess.user)
    return {"status": 200, "data": {"held": len(got), "server_side": True,
                                    "people": [field(r, flow["label"]) or field(r, flow["label_fallback"])
                                               for r in got]}}


# ---- a filed paper off the server's copy -------------------------------------------------------------------------

def doc_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """obDocFile: a paper the portal filed, off the server's copy — to the person whose row it is, the seat holding
    that row, a writer or the master."""
    shut = lane(sess)
    if shut:
        return shut
    reads, user = sess.reads, sess.user or {}
    fid = s_((payload or {}).get("file_id")) if isinstance(payload, dict) else ""
    folder = kept_find(fid)
    if folder is None:
        return {"status": 404, "message": "This paper is not kept on the server — open it in Drive."}
    if not (user.get("is_service") or writer(user) or sc.is_real_master(user)):
        found = find_row(reads, s_(user.get("email")), candidate_id(reads, user))
        if found is None or _safe(found["subject"], 80) != folder.parent.parent.name:
            return {"status": 403, "message": "This paper is not yours to open."}
    try:
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
        data = (folder / s_(meta.get("file"))).read_bytes()
    except (OSError, ValueError):
        return {"status": 503, "message": "The kept copy could not be read from the server's disk just now."}
    return {"status": 200, "data": {"name": s_(meta.get("name")), "mime": s_(meta.get("mime")) or OCTET,
                                    "size": len(data), "b64": base64.b64encode(data).decode("ascii")}}


# ---- the heavy halves the relay asks before a write --------------------------------------------------------------

def _bytes(p: dict) -> bytes | None:
    """The upload's bytes; None when there are none to read."""
    b64 = s_(p.get("base64"))
    if not b64 or b64 == "kept":
        return None
    try:
        return base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError):
        return None


def stamp_date(v: Any) -> str:
    """obStampDate_: a date as YYYYMMDD (UTC), '' when absent or unreadable."""
    s = s_(v)
    if not s:
        return ""
    try:
        ms = CND.js_date_ms(s)
    except Defer:
        ms = None
    return "" if ms is None else datetime.fromtimestamp(ms / 1000.0, timezone.utc).strftime("%Y%m%d")


def files_root(reads: L.Reads) -> str:
    """filesRoot_: the pinned platform folder, else the one remembered."""
    return next((gsjs.trim(reads.db.prop(k)) for k in ROOT_PROPS if gsjs.trim(reads.db.prop(k))), "")


def docs_target(reads: L.Reads, drv: Any) -> dict[str, Any]:
    """obDocsTarget_: the reviewer's Pending Documents once ONBOARDING_DOCS_TARGET says live, else the test folder."""
    if s_(reads.db.prop(TARGET_PROP)).lower() == "live":
        fid = gsjs.trim(reads.db.prop(PENDING_PROP))
        if not fid:
            raise ValueError(PENDING_PROP + " is not set")
        return {"folder": fid, "live": True, "where": "Pending Documents"}
    root = files_root(reads)
    if not root:
        raise ValueError("no platform folder is declared")
    return {"folder": drv.child_folder(root, TEST_FOLDER), "live": False, "where": TEST_FOLDER}


def _person(sess: L.Session) -> tuple[dict | None, dict[str, Any] | None]:
    """The caller's own packet row, or the refusal the portal's writes give."""
    user = sess.user or {}
    found = find_row(sess.reads, s_(user.get("email")), candidate_id(sess.reads, user))
    if found is None:
        return None, {"status": 404, "message": NOT_LISTED}
    return found, None


def doc_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """obDocUpload's heavy half: the paper named the way the review folder works, filed in Drive as the platform's
    account (Pending Documents once live, else its test folder), kept on the server, and copied into the staff archive
    once live; the write then records it."""
    shut = lane(sess)
    if shut:
        return shut
    p = payload if isinstance(payload, dict) else {}
    doc = DOC_OF.get(s_(p.get("doc_id")))
    if doc is None:
        return {"status": 400, "message": "Unknown document: " + s_(p.get("doc_id"))}
    found, refused = _person(sess)
    if refused:
        return refused
    full = field(found, "FullName")
    if not full:
        return {"status": 400, "message": "Give your full name in step 1 first — your documents are filed under it."}
    data = _bytes(p)
    if data is None:
        return {"status": 400, "message": "No file attached"}
    if not data:
        return {"status": 400, "message": "The file is empty"}
    if len(data) > MAX_BYTES:
        return {"status": 400, "message": "The file is over 15MB"}
    original = s_(p.get("filename"))
    dot = original.rfind(".")
    ext = original[dot:] if dot > 0 else ""
    stamp = stamp_date(p.get("expires"))
    name = full + " - " + doc["prior"] + (" - " + stamp if stamp else "") + ext
    mime = s_(p.get("mime_type")) or OCTET
    try:
        drv = sess.reads.need_drive()
        target = docs_target(sess.reads, drv)
    except Exception as exc:  # noqa: BLE001 - nothing was saved, said
        log.info("onboarding: the documents folder could not be opened (%s)", type(exc).__name__)
        return {"status": 502, "message": "The documents folder could not be opened — nothing was saved."}
    try:
        filed = drv.upload_into(target["folder"], name, mime, data)
    except Exception as exc:  # noqa: BLE001 - nothing was saved, said
        log.warning("onboarding: an upload was not filed in Drive (%s)", type(exc).__name__)
        return {"status": 502, "message": "The document could not be filed just now — nothing was saved."}
    fid = s_(filed.get("id"))
    path = keep(found["subject"], doc["id"], fid, name, mime, data, s_((sess.user or {}).get("email")))
    archive = ""
    if target["live"]:
        try:
            folder = gsjs.trim(sess.reads.db.prop(ARCHIVE_PROP))
            archive = drv.copy_into(fid, folder, name) if folder else ""
        except Exception as exc:  # noqa: BLE001 - obArchiveCopy_ never blocks the upload
            log.warning("onboarding: the archive copy of %s was not made (%s)", doc["id"], type(exc).__name__)
    return {"status": 200, "data": {"doc_id": doc["id"], "drive_id": fid, "name": s_(filed.get("name")) or name,
                                    "mime": s_(filed.get("mimeType")) or mime,
                                    "size": int(s_(filed.get("size")) or len(data)), "path": path,
                                    "live": target["live"], "where": target["where"], "archive_id": archive}}


def uploads_folder(reads: L.Reads, drv: Any) -> str:
    """filesUploadsFolder_: the platform folder's Uploads branch."""
    pinned = gsjs.trim(reads.db.prop(UPLOADS_PROP))
    if pinned:
        return pinned
    root = files_root(reads)
    if not root:
        raise ValueError("no platform folder is declared")
    return drv.child_folder(root, UPLOADS_NAME)


def packet_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """obPacketUpload's heavy half: the signed packet filed in the platform's Uploads folder in Drive and kept on the
    server; the write then records it on the card."""
    shut = lane(sess)
    if shut:
        return shut
    p = payload if isinstance(payload, dict) else {}
    found, refused = _person(sess)
    if refused:
        return refused
    full = field(found, "FullName")
    if not full:
        return {"status": 400, "message": NAME_FIRST}
    data = _bytes(p)
    if not data or len(data) > MAX_BYTES:
        return {"status": 400, "message": "The file could not be saved — please try again."}
    name = "NewHirePacket - " + full[:60] + " - signed"
    mime = s_(p.get("mime_type")) or OCTET
    try:
        drv = sess.reads.need_drive()
        filed = drv.upload_into(uploads_folder(sess.reads, drv), name, mime, data)
    except Exception as exc:  # noqa: BLE001 - nothing was saved, said
        log.warning("onboarding: a signed packet was not filed in Drive (%s)", type(exc).__name__)
        return {"status": 502, "message": "The file could not be saved — please try again."}
    fid = s_(filed.get("id"))
    path = keep(found["subject"], PACKET_DOC, fid, name, mime, data, s_((sess.user or {}).get("email")))
    return {"status": 200, "data": {"drive_id": fid, "url": drive_url(fid), "name": name, "mime": mime,
                                    "size": len(data), "path": path}}


def doc_trash(sess: L.Session, payload: dict) -> dict[str, Any]:
    """obDocRemove's Drive half: the file the Hub filed put in the bin (never erased); the row is cleared by the write
    whether or not Drive answered."""
    shut = lane(sess)
    if shut:
        return shut
    p = payload if isinstance(payload, dict) else {}
    doc = DOC_OF.get(s_(p.get("doc_id")))
    if doc is None:
        return {"status": 400, "message": "Unknown document: " + s_(p.get("doc_id"))}
    found, refused = _person(sess)
    if refused:
        return refused
    fid = field(found, doc["file"])
    if not fid:
        return {"status": 400, "message": "There is nothing here that we filed for you."}
    trashed = False
    try:
        sess.reads.need_drive().trash(fid)
        trashed = True
    except Exception as exc:  # noqa: BLE001 - a pointer nobody can reach is cleared anyway
        log.info("onboarding: %s was not put in the bin (%s)", doc["id"], type(exc).__name__)
    return {"status": 200, "data": {"doc_id": doc["id"], "file_id": fid, "trashed": trashed}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "obFlow": ob_flow, "packetState": packet_state, "onboardingWindowGet": window_get, "seatStatus": seat_status,
    "obDocFile": doc_file, "obDocPrepare": doc_prepare, "obPacketPrepare": packet_prepare, "obDocTrash": doc_trash}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
