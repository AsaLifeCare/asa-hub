"""Files (Files.gs) on Python behind its switch (`files`): the onboarding documents — the requirement catalog
(document_catalog), a candidate's papers on the dissolved candidate_documents (their facts, Python's own laid), who a
signed-in trainee is (myCandidate) — and the platform folder's organisers, which act in Drive as the platform's account
(filesSetup, filesGatherSheets, filesGatherScreenReports, filesSurveyFolder). A paper's file is filed by the read the
relay asks before the write (docUploadPrepare, also tableDocUpload's): in the candidate's own folder under Onboarding
Documents, and kept on the server (onboarding-documents/<Drive id>/); the writes are in app/files_docs_writes.py."""
from __future__ import annotations

import base64
import binascii
import re
from typing import Any, Callable

import candidate_papers as CP
import candidate_writes as CW
import candidates as CND
import drive as dr
import drive_files as DF
import gsjs
import hiring_papers as HP
import hubdb
import locations as L
import onboarding as OB
import staff_perf as SPF
import staff_views
from scope import Defer

APP_ID = "files"
DOCS_NAME, UPLOADS_NAME, SCREEN_NAME = "Onboarding Documents", "Uploads", "Screen Reports"
DOCS_PROP, UPLOADS_PROP, SCREEN_PROP = "HUB_FOLDER_DOCS_ID", "HUB_FOLDER_UPLOADS_ID", "HUB_FOLDER_SCREEN_ID"
# Main.gs UPLOADS_FOLDER: the uploads folder of before, adopted into the platform folder
LEGACY_UPLOADS = "ASA Hub Uploads"
CATALOG_TAB = "document_catalog"
CATALOG_KEYS = ("doc_id", "label", "kind", "required", "renewal_months", "applies_to", "sort")
CATALOG_DEFAULT = (
    {"doc_id": "dropbox_packet", "label": "New Hire Packet (Dropbox Sign)", "kind": "signature", "required": "yes",
     "renewal_months": "", "applies_to": "everyone", "sort": 1},
    {"doc_id": "dodd_8hr", "label": "8-Hr DODD Training Certificate", "kind": "certificate", "required": "yes",
     "renewal_months": 12, "applies_to": "everyone", "sort": 2},
    {"doc_id": "cpr_first_aid", "label": "CPR / First Aid Certificate", "kind": "certificate", "required": "yes",
     "renewal_months": 24, "applies_to": "everyone", "sort": 3},
    {"doc_id": "med_del", "label": "Med Delegation Certificate", "kind": "certificate", "required": "no",
     "renewal_months": 12, "applies_to": "med del role", "sort": 4},
    {"doc_id": "drivers_id", "label": "Driver's License / State ID", "kind": "document", "required": "yes",
     "renewal_months": "", "applies_to": "everyone", "sort": 5},
    {"doc_id": "hs_diploma", "label": "HS Diploma / GED", "kind": "document", "required": "no", "renewal_months": "",
     "applies_to": "everyone", "sort": 6},
    {"doc_id": "ss_birth", "label": "SS Card / Birth Certificate", "kind": "document", "required": "yes",
     "renewal_months": "", "applies_to": "everyone", "sort": 7},
    {"doc_id": "background_check", "label": "Background check (BCI)", "kind": "screening", "required": "yes",
     "renewal_months": "", "applies_to": "everyone", "sort": 8},
    {"doc_id": "car_insurance", "label": "Car Insurance Card", "kind": "document", "required": "no",
     "renewal_months": 12, "applies_to": "drivers", "sort": 9})
MAX_BYTES = 15 * 1024 * 1024
OCTET = "application/octet-stream"
KEPT_DIR = "onboarding-documents"
SCREEN_RE = re.compile(r"screen\s*report", re.I)
OURS_RE = re.compile(r"^ASA\s*Hub", re.I)
OWN_IDS = ("HUB_DB_ID", "HUB_PREFS_ID", "HUB_DIRECTORY_ID", "HUB_LOGS_ID", "HUB_COMMS_ID")
ESTATE_IDS = ("CERT_SOURCE_ID", "LEGACY_TALENT_SHEET_ID", "LEGACY_PORTAL_SHEET_ID", "QUO_SYNC_SHEET_ID",
              "PRIOR_DOCS_SHEET_ID")
OWN_SHEETS = (("HUB_PREFS_ID", "Prefs"), ("HUB_DIRECTORY_ID", "Directory"), ("HUB_LOGS_ID", "Logs"),
              ("HUB_COMMS_ID", "Comms"))
FILE_FIELDS = "id,name,mimeType,parents"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
SETUP_NOTE = ("Everything sits inside the platform folder and is addressed by id — moving or renaming it in Drive is "
              "safe.")

s_ = gsjs.str_


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and s_((user or {}).get("role")) in ("admin", "manager")


def admin(user: dict | None) -> bool:
    return bool(user) and s_((user or {}).get("role")) == "admin"


def _err(e: BaseException) -> str:
    """String((e && e.message) || e)."""
    return str(e) or type(e).__name__


# ---- the catalog and a candidate's papers ---------------------------------------------------------------------------

def catalog(reads: L.Reads) -> list[dict[str, Any]]:
    """filesCatalog_: every requirement with a doc_id, required as a yes, by sort (99 when it has none); a catalog not
    born yet is the shipped one (Apps Script plants it as it makes the tab)."""
    def read() -> list[dict[str, Any]]:
        rows = [r for r in CND.doc_catalog_rows(reads) if gsjs.trim(gsjs.or_text(r.get("doc_id")))]
        if not rows:
            rows = [dict(c) for c in CATALOG_DEFAULT]
        for r in rows:
            r["required"] = gsjs.js_str(r.get("required")).lower() == "yes" or r.get("required") is True
        return sorted(rows, key=_sort_of)
    return [dict(r) for r in reads.once("files:catalog", read)]


def _sort_of(r: dict) -> float:
    """Number(sort) || 99."""
    n = CND.js_number(r.get("sort"))
    return n if n == n and n else 99.0


def doc_rows(reads: L.Reads, cid: str) -> list[dict[str, str]]:
    """filesDocRows_: the candidate's papers on candidate_documents, in the tab's order (Python's own laid)."""
    return [dict(r) for r in CW.dissolved_rows(reads, CW.DOCS).values() if s_(r.get("candidateid")) == cid]


def doc_state(reads: L.Reads, cid: str, rows: list[dict[str, str]] | None = None) -> list[dict[str, Any]]:
    """filesDocState_: each requirement with the candidate's latest paper for it that nothing superseded."""
    latest: dict[str, dict] = {}
    for r in doc_rows(reads, cid) if rows is None else rows:
        if s_(r.get("supersededby")):
            continue
        latest[s_(r.get("docid"))] = r
    out = []
    for c in catalog(reads):
        row = latest.get(c.get("doc_id"))
        out.append({"doc_id": c.get("doc_id"), "label": c.get("label"), "kind": c.get("kind"),
                    "required": c.get("required"), "applies_to": c.get("applies_to"),
                    "renewal_months": c.get("renewal_months"),
                    "status": s_(row.get("status")) if row else "missing",
                    "review_status": s_(row.get("reviewstatus")) if row else "",
                    "file_url": s_(row.get("fileurl")) if row else "",
                    "file_name": s_(row.get("filename")) if row else "",
                    "issued_on": s_(row.get("issuedon")) if row else "",
                    "expires_on": s_(row.get("expireson")) if row else "",
                    "uploaded_at": s_(row.get("uploadedat")) if row else "",
                    "uploaded_by": s_(row.get("uploadedby")) if row else ""})
    return out


def laid(rows: list[dict[str, str]], cells: dict[str, Any], row_id: str = "") -> list[dict[str, str]]:
    """The candidate's papers with a write's cells laid: on the row it names, or as a new row."""
    norm = {hubdb.norm_key(k): gsjs.or_blank(v) for k, v in cells.items()}
    if not row_id:
        return rows + [norm]
    return [{**r, **norm} if s_(r.get("docrowid")) == row_id else r for r in rows]


def candidate_id_by_email(reads: L.Reads, email: Any) -> str:
    """candidateIdByEmail_: the first candidate filed under the address; '' when the tab cannot be read."""
    needle = gsjs.trim(gsjs.or_blank(email)).lower()
    if not needle:
        return ""
    rows, why = CND.soft(lambda: CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB))
    for c in [] if why else rows or []:
        if s_(c.get("email")).lower() == needle:
            return s_(c.get("candidateid"))
    return ""


def linked_candidate(reads: L.Reads, email: Any) -> str:
    """The users row an address signs in as, and the candidate it names (or that its address is filed under)."""
    u = SPF.user_by_email(reads, s_(email))
    return (s_(u.get("candidateid")) or candidate_id_by_email(reads, s_(u.get("email")))) if u else ""


def may_write(reads: L.Reads, user: dict | None, cid: str) -> bool:
    """filesMayWrite_: a writer; a trainee their own papers alone, while the onboarding window is open."""
    if writer(user):
        return True
    if user and s_(user.get("role")) == "onboarding":
        u = SPF.user_by_email(reads, s_(user.get("email")))
        if not u or (s_(u.get("candidateid")) or candidate_id_by_email(reads, s_(u.get("email")))) != cid:
            return False
        return bool(OB.access_window(reads, OB.onboarding_row(reads, cid)).get("open"))
    return False


def candidate_folder(reads: L.Reads, cid: str, drv: Any = None) -> dict[str, Any] | None:
    """The folder the candidate's row names, while Drive still opens it as one; None for an unknown candidate or a
    folder not made yet (filesCandidateFolder_ makes it as a paper is filed)."""
    c = CP.cand_row(reads, cid)
    fid = s_(c.get("docsfolderid"))
    if not c or not fid or drv is None:
        return None
    return DF.folder(drv, fid)


# ---- the reads ----------------------------------------------------------------------------------------------------

def doc_catalog(sess: L.Session, payload: dict) -> dict[str, Any]:
    """docCatalog: the requirement catalog the onboarding step draws."""
    return {"status": 200, "data": {"catalog": catalog(sess.reads)}}


def my_candidate(sess: L.Session, payload: dict) -> dict[str, Any]:
    """myCandidate: which candidate the signed-in account is, read fresh from the users tab."""
    user = sess.user
    if not user:
        return {"status": 401, "message": "Sign in first"}
    return {"status": 200, "data": {"candidate_id": linked_candidate(sess.reads, user.get("email"))}}


def doc_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """docList: the catalog with this candidate's state, and a link to their Drive folder."""
    cid = s_((payload or {}).get("candidate_id"))
    if not cid:
        return {"status": 400, "message": "candidate_id is required"}
    reads, user = sess.reads, sess.user
    if not may_write(reads, user, cid) and not writer(user):
        return dict(DENIED)
    items = doc_state(reads, cid)
    try:
        folder = candidate_folder(reads, cid, reads.drive if getattr(reads.drive, "available", False) else None)
    except (Defer, OSError, ValueError):
        folder = None
    fid = s_((folder or {}).get("id"))
    done = ("uploaded", "verified")
    return {"status": 200, "data": {
        "candidate_id": cid, "items": items, "uploaded": sum(1 for i in items if i["status"] in done),
        "total": len(items),
        "required_missing": [i["label"] for i in items if i["required"] and i["status"] not in done],
        "folder_id": fid, "folder_url": DF.folder_url(fid) if fid else ""}}


def upload_checked(reads: L.Reads, user: dict | None, p: dict) -> tuple[dict | None, dict[str, Any] | None]:
    """docUpload's refusals before the file is read: both ids, who may file, a document type the catalog knows.
    (the catalog row, the refusal)"""
    cid, did = s_(p.get("candidate_id")), s_(p.get("doc_id"))
    if not cid or not did:
        return None, {"status": 400, "message": "candidate_id and doc_id are required"}
    if not may_write(reads, user, cid):
        return None, dict(DENIED)
    cat = next((c for c in catalog(reads) if c.get("doc_id") == did), None)
    if cat is None:
        return None, {"status": 400, "message": "Unknown document type: " + did}
    return cat, None


def upload_bytes(p: dict) -> tuple[bytes, dict[str, Any] | None]:
    """docUpload's file: attached, not empty, 15MB at most."""
    b64 = str(p.get("base64") or "")
    if not b64:
        return b"", {"status": 400, "message": "No file attached"}
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError):
        data = b""
    if not data:
        return b"", {"status": 400, "message": "The file is empty"}
    if len(data) > MAX_BYTES:
        return b"", {"status": 400, "message": "The file is over 15MB"}
    return data, None


def upload_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """docUpload's slow half: the paper filed in the candidate's own folder under Onboarding Documents (the folder made
    when the row names none Drive still opens) as the platform's account, named doc__day__file, and kept on the
    server; the write then records it. No sharing is set: identity documents inherit the folder's access."""
    p = payload if isinstance(payload, dict) else {}
    reads, user = sess.reads, sess.user
    _cat, refused = upload_checked(reads, user, p)
    if refused:
        return refused
    data, refused = upload_bytes(p)
    if refused:
        return refused
    cid, did = s_(p.get("candidate_id")), s_(p.get("doc_id"))
    c = CP.cand_row(reads, cid)
    if not c:
        return {"status": 500, "message": "Unknown candidate: " + cid}
    drv = reads.need_drive()
    folder = DF.folder(drv, c.get("docsfolderid"))
    if folder is None:
        name = s_(c.get("candidatename")) or cid
        folder = DF.child(drv, s_(DF.branch(reads, drv, DOCS_NAME, DOCS_PROP).get("id")), name + " — " + cid)
    original = s_(p.get("filename")) or (did + ".bin")
    stored = did + "__" + reads.now.strftime("%Y-%m-%d") + "__" + original
    mime = s_(p.get("mime_type")) or OCTET
    made = drv.upload_into(s_(folder.get("id")), stored, mime, data)
    fid = s_(made.get("id"))
    DF.keep(KEPT_DIR, fid, stored, mime, data, s_((user or {}).get("email")))
    return {"status": 200, "data": {"candidate_id": cid, "doc_id": did, "file_id": fid, "size": len(data),
                                    "folder_id": s_(folder.get("id")), "name": original, "mime": mime}}


TABLE_HANDED = ("resume", "cjis")


def table_handed(p: dict) -> bool:
    """tableDocUpload's paths that are other doors' (resumeUpload, cjisUpload, an amber item's uploads file shared
    with the admins and the uploader): Hiring's own (app/hiring_papers.py)."""
    return s_(p.get("item_id")) in TABLE_HANDED or not s_(p.get("doc_id"))


TABLE_REQUIRED = ("candidate_id", "item_id", "filename", "base64")


def table_refused(user: dict | None, p: dict) -> dict[str, Any] | None:
    """tableDocUpload's declared params, then its own gate and item."""
    for k in TABLE_REQUIRED:
        if p.get(k) is None or p.get(k) == "":
            return {"status": 400, "message": f"Missing required parameter: {k}."}
    if not user or user.get("is_service") or s_(user.get("role")) not in ("admin", "manager"):
        return dict(DENIED)
    if not s_(p.get("item_id")):
        return {"status": 400, "message": "item_id is required."}
    return None


def table_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """tableDocUpload's slow half: a paper with a catalog document filed as docUpload files it; a résumé, a CJIS
    report or an item with no catalog document as Hiring's own doors file it (app/hiring_papers.py)."""
    p = payload if isinstance(payload, dict) else {}
    refused = table_refused(sess.user, p)
    if refused:
        return refused
    if table_handed(p):
        return HP.table_prepare(sess, p)
    return upload_prepare(sess, p)


# ---- the platform folder's organisers -------------------------------------------------------------------------------

def _dry(v: Any) -> bool:
    return v is True or gsjs.js_str(v) == "true"


def _limit(v: Any, fallback: int) -> int:
    """parseInt(v, 10) || fallback."""
    n = CND.js_parse_int(v)
    return fallback if n != n or not n else int(n)


def _line(user: dict | None, action: str, said: str) -> None:
    """hubSysLog_."""
    staff_views.record(user, action, said)


def setup(sess: L.Session, payload: dict) -> dict[str, Any]:
    """filesSetup: the platform folder and its two branches (made when missing), and every stray uploads folder of
    before adopted into it. The tabs it prepared are no longer the sheet's: the catalog is read where it lives, and a
    dissolved tab has no row 1 to widen."""
    if not writer(sess.user):
        return dict(DENIED)
    reads = sess.reads
    drv = reads.need_drive()
    root = DF.root(reads, drv)
    docs = DF.branch(reads, drv, DOCS_NAME, DOCS_PROP)
    uploads = DF.branch(reads, drv, UPLOADS_NAME, UPLOADS_PROP)
    adopted: list[str] = []
    try:
        q = f"mimeType = '{dr.FOLDER_MIME}' and trashed = false and name = '{LEGACY_UPLOADS}'"
        for lf in DF.search(drv, q):
            if s_(lf.get("id")) == s_(uploads.get("id")):
                continue
            if not DF.in_folder(lf, s_(root.get("id"))):
                DF.move(drv, lf, s_(root.get("id")))
                adopted.append(s_(lf.get("name")))
    except Exception:  # noqa: BLE001 - filesSetup's catch: the adoption is a courtesy, never the setup's failure
        pass
    rid, did, uid = s_(root.get("id")), s_(docs.get("id")), s_(uploads.get("id"))
    return {"status": 200, "data": {"platform_folder": {"id": rid, "name": s_(root.get("name")),
                                                        "url": DF.folder_url(rid)},
                                    "documents": {"id": did, "url": DF.folder_url(did)},
                                    "uploads": {"id": uid, "url": DF.folder_url(uid)}, "adopted": adopted,
                                    "note": SETUP_NOTE}}


def gather_sheets(sess: L.Session, payload: dict) -> dict[str, Any]:
    """filesGatherSheets: the Hub's own spreadsheets moved into the platform folder — the name is the permission: only
    an "ASA Hub …" file is ours to move."""
    user = sess.user
    if not admin(user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    dry = _dry(p.get("dry_run"))
    reads = sess.reads
    drv = reads.need_drive()
    root = DF.root(reads, drv)
    home = s_(root.get("id"))
    moved: list[str] = []
    already: list[str] = []
    refused: list[str] = []
    unreachable: list[str] = []
    for prop, label in OWN_SHEETS:
        sid = gsjs.trim(gsjs.or_blank(reads.db.prop(prop)))
        if not sid:
            unreachable.append(label + " — no spreadsheet id is defined for it in the code")
            continue
        try:
            f = drv.file(sid, FILE_FIELDS)
        except Exception as e:  # noqa: BLE001 - the file Drive will not open is said, the others go on
            unreachable.append(label + " — " + _err(e))
            continue
        name = s_(f.get("name"))
        if not OURS_RE.search(name):
            refused.append(name + " — not an ASA Hub sheet; left where it is")
            continue
        if DF.in_folder(f, home):
            already.append(name)
            continue
        if dry:
            moved.append(name + " (would move)")
            continue
        try:
            DF.move(drv, f, home)
            moved.append(name)
        except Exception as e:  # noqa: BLE001 - said on its own line
            unreachable.append(name + " — could not move: " + _err(e))
    _line(user, "files_gather_sheets", f"root={s_(root.get('name'))}; moved {len(moved)}, already there "
                                       f"{len(already)}, refused {len(refused)}" + (" (dry run)" if dry else ""))
    return {"status": 200, "data": {"dry_run": dry, "folder": s_(root.get("name")), "folder_id": home, "moved": moved,
                                    "already_there": already, "not_ours": refused, "could_not_read": unreachable}}


def gather_screen_reports(sess: L.Session, payload: dict) -> dict[str, Any]:
    """filesGatherScreenReports: every Screen Report the platform's account can open moved into Screen Reports, in
    batches (run again until left_to_do is 0)."""
    user = sess.user
    if not admin(user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    dry = _dry(p.get("dry_run"))
    limit = _limit(p.get("limit"), 60)
    reads = sess.reads
    drv = reads.need_drive()
    home = DF.branch(reads, drv, SCREEN_NAME, SCREEN_PROP)
    hid = s_(home.get("id"))
    moved: list[str] = []
    failed: list[str] = []
    skipped = seen = more = 0
    q = f"name contains 'Screen Report' and trashed = false and mimeType != '{dr.FOLDER_MIME}'"
    for f in DF.search(drv, q):
        name = s_(f.get("name"))
        if not SCREEN_RE.search(name):
            continue
        seen += 1
        if len(moved) >= limit:
            more += 1
            continue
        if DF.in_folder(f, hid):
            skipped += 1
            continue
        if dry:
            moved.append(name + " (would move)")
            continue
        try:
            DF.move(drv, f, hid)
            moved.append(name)
        except Exception as e:  # noqa: BLE001 - said on its own line
            failed.append(name + " — " + _err(e))
    _line(user, "files_gather_screen_reports", f"{seen} found; moved {len(moved)}, already there {skipped}, failed "
                                               f"{len(failed)}, left {more}" + (" (dry run)" if dry else ""))
    return {"status": 200, "data": {"dry_run": dry, "folder": SCREEN_NAME, "folder_id": hid, "found": seen,
                                    "moved": len(moved), "already_there": skipped, "left_to_do": more,
                                    "could_not_move": failed, "names": moved[:40]}}


def classify(reads: L.Reads, f: dict) -> str:
    """filesClassify_: only 'ours' may move; the estate's and the unknown are reported and left alone."""
    fid, name = s_(f.get("id")), s_(f.get("name"))
    def ids(props: tuple[str, ...]) -> list[str]:
        return [i for i in (gsjs.trim(gsjs.or_blank(reads.db.prop(k))) for k in props) if i]
    if fid in ids(OWN_IDS):
        return "ours"
    if fid in ids(ESTATE_IDS):
        return "estate"
    if OURS_RE.search(name) or SCREEN_RE.search(name):
        return "ours"
    return "unknown"


def survey_folder(sess: L.Session, payload: dict) -> dict[str, Any]:
    """filesSurveyFolder: a folder walked three levels down, the platform's own files moved home (a Screen Report to
    its own folder), the estate's and the unknown left alone and said; a dry run unless told otherwise."""
    user = sess.user
    if not admin(user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    dry = p.get("dry_run") is not False and gsjs.js_str(p.get("dry_run")) != "false"
    raw = s_(p.get("folder_id")) or s_(p.get("url"))
    m = re.search(r"[-\w]{25,}", raw)
    fid = m.group(0) if m else ""
    if not fid:
        return {"status": 400, "message": "Give the folder id or its Drive link."}
    reads = sess.reads
    drv = reads.need_drive()
    folder = DF.folder(drv, fid)
    if folder is None:
        f = DF.file(drv, fid, "id,parents")
        parents = (f or {}).get("parents") or []
        folder = DF.folder(drv, parents[0]) if parents else None
    if folder is None:
        return {"status": 404, "message": "That id is neither a folder I can open nor a file with a parent I can read."}
    home = DF.root(reads, drv)
    screens: list[dict | None] = []

    def screens_dest() -> dict | None:
        # lazy: a dry run never makes the destination
        if not screens:
            screens.append(DF.branch_if_any(reads, drv, SCREEN_NAME, SCREEN_PROP) if dry else
                           DF.branch(reads, drv, SCREEN_NAME, SCREEN_PROP))
        return screens[0]

    limit = _limit(p.get("limit"), 120)
    moved: list[str] = []
    estate: list[str] = []
    unknown: list[str] = []
    failed: list[str] = []
    n = {"seen": 0, "not_reached": 0}

    def walk(dir_id: str, depth: int) -> None:
        if depth > 3:
            n["not_reached"] += 1
            return
        for f in drv.children(dir_id, False, FILE_FIELDS):
            n["seen"] += 1
            if len(moved) >= limit:
                n["not_reached"] += 1
                continue
            kind, name = classify(reads, f), s_(f.get("name"))
            if kind == "estate":
                estate.append(name)
                continue
            if kind == "unknown":
                unknown.append(name + "  [" + s_(f.get("mimeType")).split(".")[-1] + "]")
                continue
            dest = screens_dest() if SCREEN_RE.search(name) else home
            if dest is None:
                moved.append(name + " → " + SCREEN_NAME + " (would move)")
                continue
            if DF.in_folder(f, s_(dest.get("id"))):
                continue
            if dry:
                moved.append(name + " → " + s_(dest.get("name")) + " (would move)")
                continue
            try:
                DF.move(drv, f, s_(dest.get("id")))
                moved.append(name + " → " + s_(dest.get("name")))
            except Exception as e:  # noqa: BLE001 - said on its own line
                failed.append(name + " — " + _err(e))
        for sub in drv.children(dir_id, True, "id,name"):
            walk(s_(sub.get("id")), depth + 1)

    walk(s_(folder.get("id")), 0)
    _line(user, "files_survey_folder", f"{s_(folder.get('name'))}: {n['seen']} file(s); {len(moved)} ours, "
                                       f"{len(estate)} estate, {len(unknown)} unknown" + (" (dry run)" if dry else ""))
    return {"status": 200, "data": {"dry_run": dry, "surveyed": s_(folder.get("name")), "files_seen": n["seen"],
                                    "moved": moved, "could_not_move": failed, "estate_left_alone": estate,
                                    "unknown_left_alone": unknown[:80], "unknown_total": len(unknown),
                                    "not_reached": n["not_reached"]}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "docCatalog": doc_catalog, "myCandidate": my_candidate, "docList": doc_list, "docUploadPrepare": upload_prepare,
    "tableDocUploadPrepare": table_prepare, "filesSetup": setup, "filesGatherSheets": gather_sheets,
    "filesGatherScreenReports": gather_screen_reports, "filesSurveyFolder": survey_folder}
_DOC_ROLES = ("admin", "manager", "onboarding")
POLICY: dict[str, dict[str, Any]] = {
    "docCatalog": {}, "myCandidate": {}, "docList": {"roles": _DOC_ROLES}, "docUploadPrepare": {"roles": _DOC_ROLES},
    "tableDocUploadPrepare": {"roles": ("admin", "manager"),
                              "params": {k: "string" for k in ("candidate_id", "item_id", "filename", "base64",
                                                               "candidate_name")}},
    "filesSetup": {"roles": ("admin", "manager")}, "filesGatherSheets": {"roles": ("admin",)},
    "filesGatherScreenReports": {"roles": ("admin",)}, "filesSurveyFolder": {"roles": ("admin",)}}
