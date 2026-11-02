"""Staff Candidates' papers (CandidateProfiles.gs cndDocumentDoor_, and the Hiring doors behind a paper: tableDocUpload,
docUpload, cjisUpload, resumeUpload, packetWaive), decided off asa-hub-db. The relay reads the paper and files it in
Drive as asatech; this side plans the press, gives the verdict on the reading and keeps every record in app.edits."""
from __future__ import annotations

import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from zoneinfo import ZoneInfo

import candidate_writes as CDW
import candidates as CND
import cert_docs as CD
import gsjs
import house_tables as HT
import hubdb
import locations as L
import resource_rows as RR
import scope as sc
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

NY = ZoneInfo("America/New_York")
s_ = CDW.s_
EDITION = CDW.EDITION
# CandidateProfiles.gs
PACKET_SHOWS = (("offer_letter",), ("work_authorization", "tax_form"))
PAPER_FLOOR = 10
WORD_TYPE_WORDS = "A PDF, a Word document, or a PNG, JPEG, GIF, WebP or HEIC picture."
TYPE_WORDS = CD.TYPE_WORDS
# ComplianceDocs.gs CERT_DOC_MAX_BYTES, and the base64 that carries it (4/3 of the bytes)
MAX_BYTES = 15 * 1024 * 1024
B64_MAX = -(-MAX_BYTES // 3) * 4
EMPTY_WORDS = "No words could be read from this file."
OCTET = "application/octet-stream"
# Files.gs
DOCS_HEADER = ("doc_row_id", "candidate_id", "candidate_name", "doc_id", "doc_label", "status", "review_status", "file_id",
               "file_url", "file_name", "mime_type", "size_bytes", "issued_on", "expires_on", "uploaded_by", "uploaded_at",
               "verified_by", "verified_at", "superseded_by", "notes")
DOCS_NAME, UPLOADS_NAME = "Onboarding Documents", "Uploads"
# TableDocs.gs: where a résumé's shortcut is placed beside the Hiring table
TABLE_DOCS_FOLDER_ID = "1WG2BpkRX-PQXe427Ku-o6JV9ALJQKe_b"
TABLE_DOCS_SIBLING_FILES = ("1TBx2U6gVyoQk6ijr72Wr67S-e-hkUIoS", "1Fm9VRgH_kgsgXTsgu3qumT9i4Ag02axL")
FORM_FILES_TAB = "form_files"
# SmartGate.gs: the gates a filing passes
GRANT_GATE, BOOK_GATE = "gate_drive_grant_reader", "gate_book_write_funnel"
# Digest.gs digestVocabRows_: the words book the decoder reads by
VOCAB_TABS = ("Digest Kinds", "Digest Categories", "Digest Expects", "Digest Labels", "Digest Issuers", "Digest Drawers",
              "Digest Zip", "Digest Settings", "Form File Types", "Digest Answer Facts", "Digest Credentials")
# Packet.gs
PACKET_HOLD_SINCE, PACKET_HOLD_UNTIL = "packet_hold_since", "packet_hold_until"
# ResumeRubric.gs
RUBRIC_PROMPT_ID = "resume_analysis_v1"
RUBRIC_FIELDS = ("months_since_last_experience", "total_years_caregiving", "avg_tenure_per_job",
                 "highest_responsibility", "schedule_availability", "num_dsp_agencies", "consistency_in_field",
                 "leadership_ratio", "setting_balance", "care_experience", "listed_certifications", "skills_rating",
                 "certs_rating", "experience_rating", "job_history_rating", "composite_score", "red_flag_short_tenure",
                 "red_flag_no_certs", "red_flag_stale_experience", "summary", "zip", "gender", "languages",
                 "first_name", "phone", "email", "city", "state")
NOT_NOW = "The hiring record could not be read just now — try again in a minute. Nothing was written."
FILED_WORDS = "The paper filed in Drive as the platform's account, and its Hiring records kept in the Hub's database."
_FILE_ID = re.compile(r"^[A-Za-z0-9_-]{10,}\Z")
_DAY = re.compile(r"^(\d{4}-\d{2}-\d{2})")


def _f(p: dict) -> dict:
    f = p.get("fields")
    return f if isinstance(f, dict) else {}


def _refuse(status: int, message: str) -> dict[str, Any]:
    return {"status": status, "message": message}


def _chars(p: dict) -> int:
    n = p.get("b64_chars")
    return n if isinstance(n, int) and not isinstance(n, bool) and n > 0 else 0


# ---- the gates (SmartGate.gs hubGateHolds_) ------------------------------------------------------------------------

def gate_holds(reads: L.Reads, gid: str) -> str:
    """Why the gate holds this door now, '' when it does not: armed (or unread, for a door that reaches a person)
    while the send switch holds."""
    import smart_comms_desk as SCD  # noqa: PLC0415 - the situations and the switch, as the Desk reads them
    spec = next((g for g in SCD.HUB_GATES if g["id"] == gid), None)
    unreadable = ""
    try:
        armed = SCD.situation_on(SCD.situations(reads), gid) is not None
    except (Defer, hubdb.Unreadable):
        armed, unreadable = False, "the situations could not be read"
    if not armed and not (unreadable and spec and spec.get("person")):
        return ""
    word = SCD.switch_word(reads.config())
    if word == "off":
        return ""
    what = spec["label"] if spec else gid
    if not armed:
        return (unreadable + " while the send switch is holding — " + what + " hands something to a person that "
                "cannot be taken back, so it is held rather than done")
    if word == "unreadable":
        return "the send switch cannot be read — " + what + " is held rather than done"
    return "the send switch is on, and " + what + " is gated with it (" + gid + ")"


def book_gate(reads: L.Reads) -> dict[str, Any] | None:
    """sheetDbGateHolds_(…, 'create'): the funnel's own 409."""
    why = gate_holds(reads, BOOK_GATE)
    return _refuse(409, why) if why else None


# ---- the reading's words (pure) ------------------------------------------------------------------------------------

def day(v: Any) -> str:
    """complianceDocsDay_."""
    m = _DAY.match(s_(v))
    return m.group(1) if m else ""


def word_type(name: str, mime: Any) -> str:
    """cndWordType_: FAIL-CLOSED, the name's extension decides and a type sent must agree with it."""
    m = re.search(r"\.([a-z0-9]+)$", s_(name), re.I)
    ext = m.group(1).lower() if m else ""
    sent = gsjs.trim(s_(mime).lower().split(";")[0])
    own = CND.CND_WORD_TYPES.get(ext, "")
    if own:
        return own if (not sent or sent == OCTET or sent == own) else ""
    if ext:
        return ""
    return sent if sent in CND.CND_WORD_TYPES.values() else ""


def verdict(found: dict, reading: dict, who: str) -> dict[str, Any]:
    """cndPaperVerdict_: whether the reading is the paper the step asks for — FAIL-CLOSED."""
    p = reading.get("paper") if isinstance(reading.get("paper"), dict) else {}
    kind = s_(p.get("kind"))
    named = s_(reading.get("named")) or "unread"
    read_as = CND.kind_words(kind) if kind else ""
    out: dict[str, Any] = {
        "verified": False, "reason": "", "read_as": read_as, "why": "",
        "reading": {"state": s_(p.get("state")) or "error", "kind": kind, "kind_words": read_as,
                    "person_seen": s_(p.get("person_seen")), "name_check": named, "issued_on": day(p.get("issued_on")),
                    "expires_on": day(p.get("expires_on")), "result": s_(reading.get("result"))}}

    def no(reason: str, why: str) -> dict[str, Any]:
        out["reason"], out["why"] = reason, why
        return out
    state = p.get("state")
    if state == "heic":
        return no("unread", "This photo format cannot be read — a JPG or a PDF of the same paper can.")
    if state == "error":
        return no("unread", "The decoder could not read this file" + (" (" + s_(p.get("why")) + ")" if p.get("why")
                                                                      else "") +
                  ". A smaller scan or a clearer photo of the same paper may read.")
    chars = CND.js_number(p.get("chars"))
    if state != "read" or not chars or chars != chars:
        return no("unread", EMPTY_WORDS)
    kinds = found.get("kinds") or []
    if not kinds:
        return no("untaught", "The decoder is not taught what " + found["label"] + " looks like, so it cannot tell.")
    if not kind:
        return no("kind", "What this paper is could not be told from its words.")
    if kind not in kinds:
        return no("kind", "This reads as " + read_as + " — not " + found["label"] + ".")
    if CND.js_number(p.get("kind_score") or 0) < PAPER_FLOOR:
        return no("faint", "This reads only faintly as " + read_as + ", so it is not taken as " + found["label"] + ".")
    if named == "other":
        return no("person", "This paper names " + s_(p.get("person_seen")) + ", not " + who + ".")
    out["verified"] = True
    out["why"] = "No name could be read on it." if named == "unread" else ""
    return out


def cjis_kept(on_file: str, v: dict, taken: bool) -> str:
    """cndCjisKept_: never a Clear the reading made — Disqualified stays, a person's Clear stays unless it reads records."""
    if on_file == "Disqualified":
        return on_file
    if on_file in ("Clear", "Verified") and taken and v["reading"]["result"] != "records":
        return on_file
    return "Pending"


def cjis_suggested(on_file: str, v: dict, taken: bool) -> str:
    """cndCjisSuggested_: what the panel pre-selects for the person to confirm or change."""
    kept = cjis_kept(on_file, v, taken)
    if kept != "Pending":
        return kept
    return "Clear" if taken and v["reading"]["name_check"] == "match" and v["reading"]["result"] == "clear" else "Pending"


def closes(found: dict, reading: dict, taken: bool, status: str) -> dict[str, Any]:
    """cndPaperCloses_: whether filing the paper closes its step on the Hiring board, and why not."""
    if found["other"]:
        return {"closes": None, "why": ""}
    step = found["step"]
    if step == "cjis":
        done = status in ("Clear", "Verified")
        return {"closes": done, "why": "" if done else "A " + status + " background result leaves the step open."}
    if step != "new-hire-packet":
        return {"closes": True, "why": ""}
    if taken and reading.get("packet") is True:
        return {"closes": True, "why": ""}
    return {"closes": False,
            "why": ("It reads as one form of the packet, not the whole signed packet (an offer letter with its I-9 or "
                    "W-4)" if taken else "It is not read as the signed packet") +
                   ", so it is deposited in Onboarding Documents and the step stays open until Mark complete says the "
                   "signed packet is on file."}


def files_expiry(issued: Any, months_raw: Any, given: Any) -> str:
    """filesExpiry_: the day given, else the issue day plus the catalog's renewal months, as the script's clock adds them
    (America/New_York) and UTC writes the day."""
    if s_(given):
        return s_(given)
    months = CND.js_number(months_raw)
    if not s_(issued) or not months or months != months or months in (float("inf"), float("-inf")):
        return ""
    ms = CND.js_date_ms(s_(issued))
    if ms is None:
        return ""
    local = datetime.fromtimestamp(ms / 1000.0, timezone.utc).astimezone(NY)
    total = local.month - 1 + int(months)
    first = datetime(local.year + total // 12, total % 12 + 1, 1, local.hour, local.minute, local.second,
                     local.microsecond)
    moved = (first + timedelta(days=local.day - 1)).replace(tzinfo=NY)
    return moved.astimezone(timezone.utc).strftime("%Y-%m-%d")


# ---- what the hiring records say -----------------------------------------------------------------------------------

def catalog(reads: L.Reads) -> dict[str, dict[str, Any]]:
    """filesCatalog_: the document catalog by id, with each paper's renewal months."""
    def read() -> dict[str, dict[str, Any]]:
        rows = [r for r in CND.doc_catalog_rows(reads) if gsjs.trim(gsjs.or_text(r.get("doc_id")))]
        if not rows:
            rows = [dict(r) for r in CND.DOC_CATALOG_DEFAULT]
        return {gsjs.trim(gsjs.js_str(r.get("doc_id"))): {"label": gsjs.js_str(r.get("label")),
                                                           "renewal_months": r.get("renewal_months")} for r in rows}
    return reads.once("cndp:catalog", read)


def vocab(reads: L.Reads) -> dict[str, list[dict[str, str]]]:
    """digestVocabRows_ for each of the words book's tabs: headers folded to a_b, cells trimmed text, empty rows out."""
    def read() -> dict[str, list[dict[str, str]]]:
        sid = gsjs.trim(reads.db.prop("HUB_GENERIC_CONFIG_ID")) or CND.GENERIC_CONFIG_FALLBACK
        out: dict[str, list[dict[str, str]]] = {}
        for tab in VOCAB_TABS:
            ref = HT.tab_of(reads, sid, tab, "the decoder's words book")
            rows = []
            for r in reads.db.locations_rows(ref):
                row = {re.sub(r"[^a-z0-9]+", "_", gsjs.trim(str(h)).lower()): gsjs.trim(gsjs.or_text(v))
                       for h, v in r.items() if h != "_row" and gsjs.trim(str(h))}
                if any(row.values()):
                    rows.append(row)
            out[tab] = rows
        return out
    return reads.once("cndp:vocab", read)


def cand_row(reads: L.Reads, key: str) -> dict[str, str]:
    return CDW.dissolved_rows(reads, CDW.CANDIDATES, [key]).get(key) or {}


def admins(reads: L.Reads) -> list[str]:
    """hubAdminEmails_: every admin's address on the users tab."""
    out: list[str] = []
    for u in reads.users():
        if gsjs.trim(gsjs.or_text(u.get("role"))).lower() != "admin":
            continue
        mail = gsjs.trim(gsjs.or_text(u.get("email")))
        if mail and "@" in mail and mail not in out:
            out.append(mail)
    return out


def folders(reads: L.Reads) -> dict[str, str]:
    """filesRoot_ and its two branches, by the ids the props hold (the relay finds a branch by name where none is)."""
    root = gsjs.trim(reads.db.prop("HUB_PLATFORM_FOLDER_ID")) or gsjs.trim(reads.db.prop("HUB_FOLDER_ROOT_ID")) \
        or CD.PLATFORM_ROOT
    return {"root": root, "docs": gsjs.trim(reads.db.prop("HUB_FOLDER_DOCS_ID")),
            "uploads": gsjs.trim(reads.db.prop("HUB_FOLDER_UPLOADS_ID"))}


# ---- the press found -----------------------------------------------------------------------------------------------

def paper_find(ctx: dict, a: dict, item: str, doc_id: str) -> dict[str, Any]:
    """cndPaperFind_: the paper a document press is for, on the candidate's own answer as it stands now."""
    hit = next((i for i in a.get("items") or [] if s_(i.get("id")) == item), None)
    if hit is None:
        return {"refused": _refuse(400, "This step is not on " + ctx["name"] + "'s hiring record.")}
    paper = hit.get("paper")
    if not paper:
        done = CND.CND_STEP_PAPERS.get(s_(hit.get("id"))) and not hit.get("open")
        return {"refused": _refuse(409, s_(hit.get("label")) + (" is already complete on the hiring record." if done
                                                                 else " takes no document from here.") +
                                   " Nothing was written.")}
    spec = CND.CND_STEP_PAPERS[s_(hit.get("id"))]
    signed = CND.packet_signed(ctx["row"])
    if paper.get("choices"):
        chosen = next((c for c in paper["choices"] if c.get("doc_id") == doc_id), None)
        if chosen is None:
            return {"refused": _refuse(400, "doc: which of the new hire's documents this is.")}
        return {"step": s_(hit.get("id")), "doc_id": chosen["doc_id"], "label": s_(chosen.get("label")),
                "kinds": list(CND.CND_PAPER_KINDS.get(chosen["doc_id"]) or []), "pdf": False, "word": False,
                "where": paper.get("where"), "signed": signed, "other": True}
    return {"step": s_(hit.get("id")), "doc_id": spec["doc"], "label": s_(paper.get("asks")),
            "kinds": list(spec.get("kinds") or CND.CND_PAPER_KINDS.get(spec["doc"]) or []), "pdf": bool(spec.get("pdf")),
            "word": bool(spec.get("word")), "where": paper.get("where"), "signed": signed, "other": False}


def paper_file(found: dict, f: dict, chars: int) -> dict[str, Any]:
    """cndPaperFile_: a picture or a PDF up to 15MB, or a Word file where the step takes one."""
    def no(message: str) -> dict[str, Any]:
        return {"refused": _refuse(400, message + " Nothing was written.")}
    name = gsjs.text(f.get("filename"), 200) or "document"
    mime = CD.file_type(name, f.get("mime_type")) or (word_type(name, f.get("mime_type")) if found["word"] else "")
    if not mime:
        return no(WORD_TYPE_WORDS if found["word"] else TYPE_WORDS)
    if found["pdf"] and mime != "application/pdf":
        return no("The Hiring record keeps " + found["label"] + " as a PDF — a PDF of the paper, please.")
    if not chars:
        return no("The file is required.")
    if chars > B64_MAX:
        return no("The file is too large — up to 15MB.")
    return {"name": name, "mime": mime}


def cjis_on_file(reads: L.Reads, key: str) -> str:
    """cndCjisOnFile_: the background result on the Hiring record now, in the engine's own words."""
    now = s_(((CND.evidence(reads, key) or {}).get("analysis") or {}).get("cjisstatus")).lower()
    return next((s for s in CND.CND_CJIS_STATUSES if s.lower() == now), "")


# ---- the plan: every refusal before the paper is read or filed -----------------------------------------------------

def _contexts(sess: L.Session, p: dict, press: str) -> dict[str, Any]:
    reads = sess.reads
    master = sc.is_real_master(sess.user)
    paper = press in ("document", "upload")
    shut = None if master else CDW.edit_door(sess, EDITION["documents" if paper else "pipeline"])
    if shut:
        return {"refused": shut}
    own = CDW.own_ctx(reads, p.get("candidate"))
    if own.get("refused"):
        if own["refused"].get("status") == 503:
            raise Defer(s_(own["refused"].get("message"))[:160])
        return own
    ctx = CDW.reads_candidate(sess, own["key"])
    if ctx.get("refused"):
        if ctx["refused"].get("status") == 503:
            raise Defer(s_(ctx["refused"].get("message"))[:160])
        return ctx
    return {"own": own, "ctx": ctx, "edition": CDW.edition_of(sess, EDITION["documents" if paper else "pipeline"])}


def _plan(sess: L.Session, p: dict) -> dict[str, Any]:
    user = sess.user or {}
    if not user or user.get("is_service"):
        return CND.unknown()
    press, item, f = s_(p.get("press")), gsjs.text(p.get("item"), 120), _f(p)
    if press not in ("document", "upload", "complete"):
        return _refuse(400, "press: complete, stage, upload or document.")
    got = _contexts(sess, p, press)
    if got.get("refused"):
        return got["refused"]
    ctx, reads = got["ctx"], sess.reads
    base = {"press": press, "candidate": ctx["key"], "name": ctx["name"], "who": ctx["name"], "item": item,
            "edition": got["edition"], "folders": folders(reads), "today": reads.today(),
            "uploader": CDW.who_email(user)}
    if press == "document":
        return _plan_document(sess, ctx, base, item, f, _chars(p))
    return _plan_upload(sess, ctx, base, press, item, f, _chars(p))


def _plan_document(sess: L.Session, ctx: dict, base: dict, item: str, f: dict, chars: int) -> dict[str, Any]:
    """cndDocumentDoor_ up to the reading."""
    reads = sess.reads
    found = paper_find(ctx, CDW.reads_actions(sess, ctx), item, s_(f.get("doc")))
    if found.get("refused"):
        return found["refused"]
    file = paper_file(found, f, chars)
    if file.get("refused"):
        return file["refused"]
    cjis = found["step"] == "cjis" and not found["other"]
    picked = s_(f.get("cjis_status")) if cjis else ""
    if picked and picked not in CND.CND_CJIS_STATUSES:
        return _refuse(400, "cjis_status: " + ", ".join(CND.CND_CJIS_STATUSES) + ". Nothing was written.")
    check = f.get("check") is True
    if not check:
        held = book_gate(reads)
        if held:
            return held
    on_file = ""
    if cjis:
        try:
            on_file = cjis_on_file(reads, ctx["key"])
        except (Defer, hubdb.Unreadable) as e:
            # a result nobody picked is never written over one that could not be read
            if not check and not picked:
                return _refuse(503, CND.why_of("The background result on file", str(e)[:120]) +
                               " Pick the result, or try again. Nothing was written.")
    return {"status": 200, "data": {
        **base, **found, "file": file, "check": check, "cjis": cjis, "picked": picked, "on_file": on_file,
        "override_asked": f.get("confirm_mismatch") is True, "read": True,
        "packet_whole": found["step"] == "new-hire-packet" and not found["other"],
        "packet_shows": [list(g) for g in PACKET_SHOWS], "vocab": vocab(reads)}}


def _plan_upload(sess: L.Session, ctx: dict, base: dict, press: str, item: str, f: dict,
                 chars: int) -> dict[str, Any]:
    """cndPressFind_ for an upload (or a step's upload door), then tableDocUpload's own choice of door."""
    reads = sess.reads
    if press == "upload":
        docs = CND.documents_build(sess, ctx).get("docs") or []
        doc = next((d for d in docs if d.get("id") == item), None)
        if doc is None:
            return _refuse(400, "This document is not on " + ctx["name"] + "'s hiring record.")
        if not doc.get("upload"):
            return _refuse(409, s_(doc.get("title")) + (" is already on file." if doc.get("status") == "on_file"
                                                         else " is not filed from here.") + " Nothing was written.")
        found = {"door": doc["upload"], "ref": "upload:" + s_(doc.get("id")), "detail": s_(doc.get("title"))}
    else:
        found = CDW.press_find(ctx, CDW.reads_actions(sess, ctx), "complete", item)
        if found.get("refused"):
            return found["refused"]
        if s_(found["door"].get("action")) != "tableDocUpload":
            return _refuse(409, "This step files no paper. Nothing was written.")
    inner = CDW.press_payload(ctx, found["door"], f)
    if inner is None:
        return _refuse(409, "This screen does not open that door; the Hiring card does.")
    held = book_gate(reads)
    if held:
        return held
    if not chars:
        return _refuse(400, "No file attached")
    if chars > B64_MAX:
        return _refuse(400, "The file is over 15MB")
    name = s_(inner.get("filename"))
    if not name:
        return _refuse(400, "filename is required.")
    target = s_(inner.get("item_id"))
    mime = s_(inner.get("mime_type")) or OCTET
    if target == "resume":
        door = {"door": "resumeUpload"}
    elif target == "cjis":
        status = s_(inner.get("status")) or "Clear"
        if status not in CND.CND_CJIS_STATUSES:
            return _refuse(400, "invalid status — engine vocabulary is Pending/Clear/Verified/Disqualified")
        door = {"door": "cjisUpload", "status": status}
    elif s_(inner.get("doc_id")):
        if s_(inner["doc_id"]) not in catalog(reads):
            return _refuse(400, "Unknown document type: " + s_(inner["doc_id"]))
        door = {"door": "docUpload", "doc_id": s_(inner["doc_id"]), "dated": False}
    else:
        return _refuse(409, "This step has no paper filed from here. Nothing was written.")
    return {"status": 200, "data": {**base, "found": found, "file": {"name": name, "mime": mime},
                                    "doors": [door], "read": target == "resume", "check": False}}


def plan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The relay's first ask: every refusal of the press, in its words, before the paper is read or filed."""
    try:
        got = _plan(sess, payload if isinstance(payload, dict) else {})
    except (Defer, hubdb.Unreadable) as why:
        log.info("candidate papers: the plan could not be read (%s)", str(why)[:160])
        return _refuse(503, NOT_NOW)
    if got.get("status") == 200 and got["data"]["press"] != "document":
        got["data"]["placements"] = placements(sess.reads, got["data"], got["data"]["doors"])
    return got


# ---- the verdict, and the doors that file the paper ----------------------------------------------------------------

def _judged(plan_: dict, reading: dict) -> dict[str, Any]:
    """cndDocumentDoor_ past the reading: the verdict, the result kept, whether the step closes, and the answer."""
    v = verdict(plan_, reading, plan_["who"])
    override = plan_["override_asked"] and not v["verified"]
    taken = v["verified"] and not override
    on_file, cjis = plan_["on_file"], plan_["cjis"]
    status = "" if not cjis else (cjis_suggested(on_file, v, taken) if plan_["check"]
                                  else (plan_["picked"] or cjis_kept(on_file, v, taken)))
    shut = closes(plan_, reading, taken, status)
    answer = {"candidate": plan_["candidate"], "item": plan_["step"], "doc_id": plan_["doc_id"], "asks": plan_["label"],
              "expects": CND.expects(plan_["kinds"]), "where": plan_["where"],
              "file_name": CND.scrub(plan_["file"]["name"]), "verified": v["verified"], "reason": v["reason"],
              "read_as": v["read_as"], "why": CND.scrub(v["why"]), "reading": CND.scrub(v["reading"]),
              "cjis_status": status, "cjis_on_file": on_file, "closes": shut["closes"], "closes_why": shut["why"],
              "check": plan_["check"], "filed": False, "override": False}
    return {"v": v, "override": override, "taken": taken, "status": status, "shut": shut, "answer": answer}


def paper_doors(plan_: dict, j: dict) -> list[dict[str, Any]]:
    """cndPaperDoors_: the doors that file the paper, in order (tableDocUpload already resolved to its own door)."""
    v, override, status = j["v"], j["override"], j["status"]
    taken = v["verified"] and not override
    said = "Filed from Staff Candidates" + ("; read as " + v["read_as"] if v["read_as"] else "") + \
        ("; override" if override else "")
    dated = {"dated": True, "issued_on": v["reading"]["issued_on"] if taken else "",
             "expires_on": v["reading"]["expires_on"] if taken else "", "notes": said}
    step = plan_["step"]
    if plan_["other"]:
        # the Hiring table's upload files these two on the Hiring record itself, never in Onboarding Documents
        item = CND.CND_ITEM_OF_DOC.get(plan_["doc_id"]) or plan_["doc_id"]
        action = "docUpload" if item in ("cjis", "resume") else "tableDocUpload"
        return [{"door": "docUpload", "action": action, "doc_id": plan_["doc_id"], **dated}]
    if step == "cjis":
        doors = [{"door": "cjisUpload", "action": "tableDocUpload", "status": status}]
        if plan_["signed"]:
            doors.append({"door": "docUpload", "action": "docUpload", "doc_id": plan_["doc_id"], **dated})
        return doors
    if step == "new-hire-packet":
        doors = [{"door": "docUpload", "action": "tableDocUpload", "doc_id": plan_["doc_id"], **dated}]
        if j["shut"]["closes"]:
            doors.append({"door": "packetWaive", "action": "packetWaive", "file_of": 0,
                          "note": "Signed packet filed from Staff Candidates: " + plan_["file"]["name"] +
                                  " (read as the whole packet: " + v["read_as"] + " and its forms)"})
        return doors
    return [{"door": "resumeUpload", "action": "tableDocUpload"}]


def cjis_name(name: str) -> str:
    """cjisUpload: the report's name always starts with CJIS."""
    n = s_(name) or "cjis-report.pdf"
    return n if n.lower().startswith("cjis") else "CJIS_" + n


def placements(reads: L.Reads, plan_: dict, doors: list[dict]) -> list[dict[str, Any]]:
    """Where each Drive door files the paper (docUpload: the candidate's own folder; cjisUpload and resumeUpload: the
    uploads folder, shared with the admins and the uploader in silence unless the grant gate holds)."""
    out: list[dict[str, Any]] = []
    fo = plan_["folders"]
    name, mime = plan_["file"]["name"], plan_["file"]["mime"]
    grants: list[str] | None = None
    held = ""
    for d in doors:
        if d["door"] == "docUpload":
            c = cand_row(reads, plan_["candidate"])
            who = s_(c.get("candidatename")) or plan_["candidate"]
            out.append({"door": "docUpload", "where": "candidate", "folder_id": s_(c.get("docsfolderid")),
                        "folder_name": who + " — " + plan_["candidate"], "parent_id": fo["docs"],
                        "parent_name": DOCS_NAME, "root": fo["root"],
                        "name": d["doc_id"] + "__" + W.now_iso(reads)[:10] + "__" + name,
                        "mime": mime or OCTET, "max_bytes": MAX_BYTES})
        elif d["door"] in ("cjisUpload", "resumeUpload"):
            if grants is None:
                held = gate_holds(reads, GRANT_GATE)
                grants = [] if held else admins(reads)
            spot = {"door": d["door"], "where": "uploads", "folder_id": fo["uploads"], "parent_name": UPLOADS_NAME,
                    "root": fo["root"], "grants": list(grants), "uploader": "" if held else s_(plan_.get("uploader")),
                    "grants_held": held,
                    "max_bytes": MAX_BYTES}
            if d["door"] == "cjisUpload":
                spot.update(name=cjis_name(name), mime="application/pdf")
            else:
                spot.update(name=name or "resume.pdf", mime=mime or OCTET,
                            shortcuts={"folder": TABLE_DOCS_FOLDER_ID, "siblings": list(TABLE_DOCS_SIBLING_FILES)})
            out.append(spot)
    return out


def _carried(sess: L.Session, p: dict) -> dict[str, Any]:
    """The plan the relay carries back from its first ask, held to the press it names and to who presses it now (the
    hiring board is not read again: the write's budget is seconds)."""
    plan_ = p.get("plan") if isinstance(p.get("plan"), dict) else None
    press = s_(p.get("press"))
    if plan_ is None or plan_.get("press") != press or plan_.get("item") != gsjs.text(p.get("item"), 120) or \
            s_(plan_.get("candidate")) != gsjs.trim(gsjs.or_blank(p.get("candidate"))) or \
            s_(plan_.get("uploader")) != CDW.who_email(sess.user):
        return {"refused": _refuse(400, "The relay carried no plan for this press. Nothing was written.")}
    user = sess.user or {}
    if not user or user.get("is_service"):
        return {"refused": CND.unknown()}
    paper = press in ("document", "upload")
    master = sc.is_real_master(user)
    shut = None if master else CDW.edit_door(sess, EDITION["documents" if paper else "pipeline"])
    if shut:
        return {"refused": shut}
    own = CDW.own_ctx(sess.reads, plan_["candidate"])
    if own.get("refused"):
        if own["refused"].get("status") == 503:
            raise Defer(s_(own["refused"].get("message"))[:160])
        return own
    return {"plan": {**plan_, "edition": CDW.edition_of(sess, EDITION["documents" if paper else "pipeline"])}}


def decide(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The relay's second ask, the paper read: the answer when nothing is filed (a read only, or not taken), else where
    each door files it."""
    p = payload if isinstance(payload, dict) else {}
    try:
        got = _carried(sess, p)
        if got.get("refused"):
            return got["refused"]
        plan_ = got["plan"]
        if plan_["press"] != "document":
            return _refuse(400, "Only Add document is read before it is filed.")
        reading = p.get("reading") if isinstance(p.get("reading"), dict) else {}
        j = _judged(plan_, reading)
        if plan_["check"]:
            return {"status": 200, "data": {"done": j["answer"]}}
        if not j["v"]["verified"] and not j["override"]:
            a = j["answer"]
            a["why"] = (a["why"] + " " if a["why"] else "") + "Nothing was written."
            return {"status": 200, "data": {"done": a}}
        doors = paper_doors(plan_, j)
        for d in doors:
            if d["door"] == "docUpload" and d["doc_id"] not in catalog(sess.reads):
                return _refuse(400, "Unknown document type: " + d["doc_id"])
        return {"status": 200, "data": {"doors": doors, "placements": placements(sess.reads, plan_, doors)}}
    except (Defer, hubdb.Unreadable) as why:
        log.info("candidate papers: the verdict could not be given (%s)", str(why)[:160])
        return _refuse(503, NOT_NOW)


# ---- the records each door keeps -----------------------------------------------------------------------------------

def _journey(reads: L.Reads, key: str, name: str, line: dict, edition: str) -> list[dict]:
    return CDW.journey_records(reads, {"key": key, "name": name}, line, edition)[2]


def _doc_records(sess: L.Session, plan_: dict, d: dict, filed: dict, now: str, edition: str) -> tuple[dict, list]:
    """docUpload: the paper's row on candidate_documents (a re-upload supersedes, nothing is deleted)."""
    reads, key = sess.reads, plan_["candidate"]
    by = CDW.who_email(sess.user)
    cat = catalog(reads)[d["doc_id"]]
    c = cand_row(reads, key)
    recs: list[dict] = []
    row_id = "DOC_" + secrets.token_hex(8).upper()
    for r in CDW.dissolved_rows(reads, CDW.DOCS).values():
        if s_(r.get("candidateid")) == key and s_(r.get("docid")) == d["doc_id"] and not s_(r.get("supersededby")):
            recs += CDW.facts_of(reads, CDW.DOCS, s_(r.get("docrowid")), {"superseded_by": row_id}, "runtime-sheet",
                                 key, edition, at=now)
    issued = s_(d.get("issued_on"))
    file_id = filed["file_id"]
    vals = {"doc_row_id": row_id, "candidate_id": key, "candidate_name": s_(c.get("candidatename")) or key,
            "doc_id": d["doc_id"], "doc_label": cat["label"], "status": "uploaded", "review_status": "pending",
            "file_id": file_id, "file_url": "https://drive.google.com/file/d/" + file_id + "/view",
            "file_name": plan_["file"]["name"], "mime_type": plan_["file"]["mime"] or OCTET,
            "size_bytes": int(filed.get("size") or 0), "issued_on": issued,
            "expires_on": files_expiry(issued, cat.get("renewal_months"), d.get("expires_on")),
            "uploaded_by": "asa-hub:" + (by or "unknown"), "uploaded_at": now, "verified_by": "", "verified_at": "",
            "superseded_by": "", "notes": s_(d.get("notes"))}
    recs += CDW.facts_of(reads, CDW.DOCS, row_id, vals, "runtime-sheet:append", key, edition, at=now)
    folder = s_(filed.get("folder_id"))
    if folder and folder != s_(c.get("docsfolderid")):
        recs += CDW.facts_of(reads, CDW.CANDIDATES, key, {"docs_folder_id": folder}, "runtime-sheet", key, edition,
                             at=now)
    return {"doc": vals}, recs


def _cjis_records(sess: L.Session, plan_: dict, d: dict, filed: dict, now: str, edition: str) -> tuple[dict, list]:
    """cjisUpload: the result and the report on the candidate's analysis row (one appended when none), and its line."""
    reads, key = sess.reads, plan_["candidate"]
    by = CDW.who_email(sess.user)
    url = "https://drive.google.com/file/d/" + filed["file_id"] + "/view"
    status = d["status"]
    if CDW.dissolved_rows(reads, CDW.RESUME, [key]).get(key) is not None:
        recs = []
        for col, v in (("cjis_status", status), ("cjis_report_url", url), ("updated_at", now),
                       ("updated_by", "asa-hub:" + by)):
            recs += CDW.facts_of(reads, CDW.RESUME, key, {col: v}, "runtime-sheet", key, edition, at=now)
    else:
        recs = CDW.facts_of(reads, CDW.RESUME, key, {"candidate_id": key, "cjis_status": status, "cjis_report_url": url,
                                                     "created_at": now, "updated_at": now,
                                                     "created_by": "asa-hub:" + by},
                            "runtime-sheet:append", key, edition, at=now)
    recs += _journey(reads, key, "", {"step": "cjis_filed", "channel": "record", "ok": True,
                                      "detail": by + " uploaded the CJIS report (" + status +
                                                ") — the verdict is still a person’s",
                                      "ref": url, "by": "asa-hub:" + by}, edition)
    return {"cjis_status": status, "cjis_report_url": url, "mirrored": 0, "decoding": "no file id"}, recs


def _resume_records(sess: L.Session, plan_: dict, filed: dict, now: str, edition: str) -> tuple[dict, list]:
    """resumeUpload (the link filled only where blank, and its line), then the Hiring table's shortcut and the decoder's
    ledger row (tableDocsMirror_, pipelineQueueDecode_)."""
    reads, key = sess.reads, plan_["candidate"]
    by = CDW.who_email(sess.user)
    url = "https://drive.google.com/file/d/" + filed["file_id"] + "/view"
    c = cand_row(reads, key)
    recs: list[dict] = []
    if not s_(c.get("resumelink")):
        recs += CDW.facts_of(reads, CDW.CANDIDATES, key, {"resume_link": url}, "runtime-sheet", key, edition, at=now)
    for col, v in (("updated_at", now), ("updated_by", "asa-hub:" + by)):
        recs += CDW.facts_of(reads, CDW.CANDIDATES, key, {col: v}, "runtime-sheet", key, edition, at=now)
    recs += _journey(reads, key, s_(c.get("candidatename")),
                     {"step": "resume_on_file", "channel": "record", "ok": True, "detail": by + " uploaded the resume",
                      "ref": url, "by": "asa-hub:" + by}, edition)
    # the decoder's row never costs the upload
    decoding = "ledger row refused" if gate_holds(reads, BOOK_GATE) else "queued"
    if decoding == "queued":
        row = {"form_slug": "(pipeline)", "submission_id": "", "field_key": "resume", "anchor_id": key,
               "anchor_name": plan_["name"], "file_id": filed["file_id"], "file_url": "",
               "file_name": plan_["file"]["name"] or "resume.bin", "mime_type": "", "size_bytes": "",
               "uploaded_by_name": s_((sess.user or {}).get("name")), "uploaded_by_email": by,
               "digest_state": "pending", "digest_kind": "", "digest_category": "", "digest_dates": "",
               "digest_names": "", "digest_text_chars": "", "digest_text": "", "digest_json": "", "digest_error": "",
               "digested_at": "", "id": str(uuid.uuid4()), "createdAt": now, "updatedAt": now}
        import forms as F  # noqa: PLC0415 - the decoder's ledger is Forms' own table
        import resource_rows as RR  # noqa: PLC0415

        RR.create(reads, F.resource_of(FORM_FILES_TAB), row, by)
    return {"resume_link": url, "mirrored": int(filed.get("shortcuts") or 0), "decoding": decoding}, recs


def calendar_note(reads: L.Reads, key: str, name: str, now: str, entering: bool) -> list[dict]:
    """hubOnboardingCalendarNote_: one row on the events tab as a card enters Onboarding (the account issued) or leaves
    it (completed), never twice. The tab is the whole events trail, so its id is looked for in the statement, never
    by reading the trail; a column it lacks is added after its own (hubAppendRow_'s ensureHeader_)."""
    ev_id = ("ev-onb-in-" if entering else "ev-onb-out-") + key
    try:
        res = W.tab_of(reads, "events")
    except (Defer, hubdb.Unreadable) as why:
        log.info("candidate papers: the onboarding calendar is not written (%s)", str(why)[:120])
        return []
    ref = res.ref
    kept = HT.resource_of("events") if HT.tabled("events") else None
    if kept is not None:
        # its own table: the id looked for by the index on it, the header its columns
        sid, tab = W.where_of(res)
        by_id = RR.TRIMMED.format(col="'id'")
        if RR._q(reads, f"select 1 from {RR.rows_of(kept)} where resource = %s and removed_at is null"  # noqa: S608
                        f" and {by_id} = %s limit 1", (kept, ev_id)):
            return []
        heads: tuple = tuple(RR.columns(reads, kept))
    else:
        if ref is None or not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table or ""):
            return []
        sid, tab = W.where_of(res)
        if reads.db.query(f'select 1 from {reads.db.from_sql(ref)} where _raw->>\'id\' = %s limit 1', (ev_id,)) or \
                reads.db.query(f"select 1 from {W.EDITS_TABLE} where sheet_id = %s and tab_name = %s"
                               " and row_key = %s limit 1", (sid, tab, ev_id)):
            return []
        heads = tuple(ref.headers)
    row = {"id": ev_id, "title": ("Onboarding started — " + name + " (account issued)") if entering
           else "Onboarding completed — " + name, "personId": key, "personName": name, "date": now[:10],
           "start": "09:00" if entering else "17:00", "durationMin": 30, "type": "onboarding", "attendees": "[]",
           "notes": "hiring pipeline · " + ("entered onboarding" if entering else "onboarding finished"),
           "readOnly": "TRUE"}
    header = tuple(gsjs.trim(gsjs.js_str(h)) for h in heads if gsjs.trim(gsjs.js_str(h)))
    return [W.append_record(res, header + tuple(k for k in row if k not in header), row, key)]


def _calendar_note(reads: L.Reads, key: str, name: str, now: str, edition: str) -> list[dict]:
    """hubOnboardingCalendarNote_ for a card leaving Onboarding."""
    return calendar_note(reads, key, name, now, False)


def packet_waive(sess: L.Session, key: str, note: str, file_id: str, edition: str) -> tuple[dict, list]:
    """packetWaive: the signed packet attached by hand, and the hold released the moment it is (packetHoldRelease_)."""
    reads = sess.reads
    by = CDW.who_email(sess.user)
    note = s_(note)
    if len(note) < 3:
        return {"status": 400, "message": "Say where the signed packet is — a note is required."}, []
    now = W.now_iso(reads)
    fields = {"packet_waived_by": by + " — " + CDW.js_slice(note, 300), "packet_status": "waived",
              "packet_checked_at": now}
    if s_(file_id):
        fields["packet_srid"] = "file:" + s_(file_id)
    recs = CDW.facts_of(reads, CDW.CANDIDATES, key, fields, by, key, edition, at=now)
    cand = cand_row(reads, key)
    released, stage = False, ""
    if cand and s_(cand.get("packetholduntil")):
        clear = CDW.facts_of(reads, CDW.CANDIDATES, key, {PACKET_HOLD_SINCE: "", PACKET_HOLD_UNTIL: ""}, by, key,
                             edition, at=now)
        stage = CDW.stage_of(cand.get("status"))
        if stage != "onboarding":
            recs += clear
        else:
            CDW.marked(cand.get("status"), cand.get("candidatename"))
            recs += CDW.status_move(sess, key, cand, "hired", edition, now)
            recs += _calendar_note(reads, key, s_(cand.get("candidatename")), now, edition)
            recs += clear
            released, stage = True, "hired"
    return {"status": 200, "data": {"candidate_id": key, "state": "waived", "released": released, "stage": stage}}, recs


def score_owed(reads: L.Reads, key: str) -> dict[str, Any] | None:
    """rubricEnsureForCandidate_ before its reading: the words the scorecard is asked in, or None when it is scored."""
    last = CDW.dissolved_rows(reads, CDW.RESUME, [key]).get(key) or {}
    if s_(last.get("compositescore")):
        return None
    doc = gsjs.trim(reads.db.prop("RUBRIC_DOC_ID"))
    try:
        wrap = CND.book_kv(reads, "Prompts").get("ai_resume_rubric_wrap", "")
    except (Defer, hubdb.Unreadable):
        wrap = ""
    return {"candidate": key, "rubric_doc": doc, "wrap": wrap}


def _filed_ok(doors: list[dict], filed: Any) -> list[dict] | None:
    """One filed file per Drive door, in order (packetWaive files none)."""
    drive_doors = [d for d in doors if d["door"] != "packetWaive"]
    if not isinstance(filed, list) or len(filed) != len(drive_doors):
        return None
    for f in filed:
        if not isinstance(f, dict) or not _FILE_ID.fullmatch(s_(f.get("file_id"))):
            return None
    return filed


def keep(sess: L.Session, payload: dict) -> Decision:
    """The relay's last ask, the paper filed in Drive: who presses held to the plan again, then each door's records and
    the press's line on the hiring journey, kept final."""
    p = payload if isinstance(payload, dict) else {}
    try:
        got = _carried(sess, p)
        if got.get("refused"):
            return Decision(got["refused"])
        plan_ = got["plan"]
        reads = sess.reads
        j = None
        if plan_["press"] == "document":
            if plan_["check"]:
                return W.refuse(400, "A read only files nothing.")
            reading = p.get("reading") if isinstance(p.get("reading"), dict) else {}
            j = _judged(plan_, reading)
            if not j["v"]["verified"] and not j["override"]:
                return W.refuse(409, "The paper was not taken as " + plan_["label"] + ". Nothing was written.")
            doors = paper_doors(plan_, j)
        else:
            doors = plan_["doors"]
        filed = _filed_ok(doors, p.get("filed"))
        if filed is None:
            return W.refuse(400, "The relay named no filed file for each door. Nothing was written.")
        held = book_gate(reads)
        if held:
            return Decision(held)
        now = W.now_iso(reads)
        edition = plan_["edition"]
        recs: list[dict] = []
        ran: list[dict] = []
        outs: list[dict] = []
        owed = None
        drive_files = iter(filed)
        for d in doors:
            if d["door"] == "docUpload":
                out, r = _doc_records(sess, plan_, d, next(drive_files), now, edition)
            elif d["door"] == "cjisUpload":
                out, r = _cjis_records(sess, plan_, d, next(drive_files), now, edition)
            elif d["door"] == "resumeUpload":
                out, r = _resume_records(sess, plan_, next(drive_files), now, edition)
                owed = score_owed(reads, plan_["candidate"])
            else:
                fid = s_(((outs[d["file_of"]] or {}).get("doc") or {}).get("file_id")) if d["file_of"] < len(outs) else ""
                env, r = packet_waive(sess, plan_["candidate"], d["note"], fid, edition)
                if env.get("status") != 200:
                    return Decision(env)
                out = env["data"]
            outs.append(out)
            recs += r
            ran.append({"action": d.get("action") or "tableDocUpload", "status": 200})
        by = CDW.who_email(sess.user)
        if plan_["press"] == "document":
            answer = j["answer"]
            cjis = plan_["cjis"]
            whole = plan_["packet_whole"]
            detail = CND.scrub(plan_["label"] + " — " + plan_["file"]["name"] + " (" +
                               ("read as " + j["v"]["read_as"] if j["v"]["read_as"] else "not read") +
                               (", override" if j["override"] else "") + ")" +
                               ("; background result " + j["status"] if cjis else "") +
                               (("; New Hire packet on file" if j["shut"]["closes"] else "; the step stays open")
                                if whole else ""))
            ref = "document:" + plan_["step"] + (":" + plan_["doc_id"] if plan_["other"] else "")
            title = CDW.PRESS_TITLES["document"]
        else:
            found = plan_["found"]
            detail = found["detail"] + (": " + gsjs.text(plan_["file"]["name"], 120)
                                        if plan_["press"] == "upload" and plan_["file"]["name"] else "") + \
                CDW.press_outcome(plan_["press"], outs[0])
            ref = found["ref"]
            title = CDW.PRESS_TITLES[plan_["press"]]
        jid, at, line = CDW.journey_records(reads, {"key": plan_["candidate"], "name": plan_["name"]},
                                            {"step": CDW.PRESS_STEP, "title": title, "ok": True, "detail": detail,
                                             "ref": ref, "by": by}, edition)
        recs += line
        entry = {"id": "jrn_" + jid, "at": at, "by": by, "title": title, "body": detail}
        if plan_["press"] == "document":
            data = {**answer, "filed": True, "override": j["override"], "doors": ran, "logged": True,
                    "entry": entry, "filing_why": ""}
        else:
            data = {"candidate": plan_["candidate"], "door": "tableDocUpload", "answer": CND.scrub(outs[0]),
                    "logged": True, "entry": entry, "why": ""}
        if owed:
            data["score_owed"] = owed
        answer_env = {"status": 200, "data": W.with_steps(data, W.pg_steps(FILED_WORDS, CDW.CACHES, CDW.APP_ID))}
        return W.final(answer_env, recs, plan_["candidate"])
    except (Defer, hubdb.Unreadable) as why:
        log.info("candidate papers: the records could not be kept (%s)", str(why)[:160])
        return W.refuse(503, "The document reached Drive, but its record could not be kept just now — file it again "
                             "in a minute.")


# ---- the résumé's scorecard (ResumeRubric.gs rubricWrite_) ---------------------------------------------------------

def resume_score(sess: L.Session, payload: dict) -> Decision:
    """The scorecard the relay read off the résumé, kept as the candidate's analysis row; a scored candidate keeps its."""
    p = payload if isinstance(payload, dict) else {}
    try:
        user = sess.user or {}
        if not user or user.get("is_service"):
            return Decision(CND.unknown())
        shut = None if sc.is_real_master(user) else CDW.edit_door(sess, EDITION["documents"])
        if shut:
            return Decision(shut)
        own = CDW.own_ctx(sess.reads, p.get("candidate"))
        if own.get("refused"):
            return CDW.refused(own["refused"])
        got = {"edition": CDW.edition_of(sess, EDITION["documents"])}
        reads, key = sess.reads, own["key"]
        if score_owed(reads, key) is None:
            return Decision({"status": 200, "data": {"scored": True, "reason": "already scored"}})
        raw = p.get("fields") if isinstance(p.get("fields"), dict) else {}
        fields = {k: gsjs.js_str(raw[k]) for k in RUBRIC_FIELDS if k in raw and raw[k] is not None and raw[k] != ""}
        if not fields:
            return W.refuse(400, "The scorecard carried no field.")
        now = W.now_iso(reads)
        doc = gsjs.trim(reads.db.prop("RUBRIC_DOC_ID"))
        by = CDW.who_email(sess.user)
        row = {"candidate_id": key, **fields, "analyzed_at": now, "created_at": now, "updated_at": now,
               "created_by": "asa-hub-rubric:" + by, "prompt_id": RUBRIC_PROMPT_ID, "prompt_doc_id": doc,
               "prompt_doc_url": "https://docs.google.com/document/d/" + doc + "/edit",
               "prompt_content_hash": s_(p.get("hash")), "prompt_last_fetched_at": now, "prompt_parse_status": "ok",
               "prompt_error": s_(p.get("error")), "raw_prompt_output_json": CDW.js_slice(s_(p.get("raw")), 45000)}
        if s_(p.get("source_asset_id")):
            row["source_asset_id"] = s_(p.get("source_asset_id"))
        held = book_gate(reads)
        if held:
            return Decision(held)
        recs =CDW.facts_of(reads, CDW.RESUME, key, row, "runtime-sheet:append", key, got["edition"], at=now)
        comp = CND.js_parse_float(fields.get("composite_score"))
        return W.final({"status": 200, "data": {"scored": True, "reason": "ok", "composite": comp}}, recs, key)
    except (Defer, hubdb.Unreadable) as why:
        log.info("candidate papers: the scorecard could not be kept (%s)", str(why)[:160])
        return W.refuse(503, "The scorecard could not be kept just now.")


READS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"candidatePaperPlan": plan,
                                                                  "candidatePaperDecide": decide}
READ_POLICY: dict[str, dict[str, Any]] = {a: {"roles": sc.EDITION_ROLES, "params": {"candidate": "string"}}
                                          for a in READS}
ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"candidatePaperKeep": keep,
                                                              "candidateResumeScore": resume_score}
POLICY: dict[str, dict[str, Any]] = {a: {"roles": sc.EDITION_ROLES, "params": {"candidate": "string"}}
                                     for a in ACTIONS}
