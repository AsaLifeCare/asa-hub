"""A paper's records on a candidate's hiring record (HubCore.gs resumeUpload, cjisUpload; TableDocs.gs tableDocUpload's
résumé, CJIS and no-document paths), kept as the hiring records' facts in Postgres once the relay's read filed the file
(app/hiring_papers.py): the résumé link filled where blank and its scorecard, the background result on the candidate's
analysis, the line on the hiring journey, and — when the Hiring table filed it — the decoder's ledger row on form_files
(app.edits, pipelineQueueDecode_)."""
from __future__ import annotations

import logging
import uuid
from typing import Any, Callable

import candidate_papers as CP
import candidate_writes as CDW
import candidates as CND
import gsjs
import hubdb
import locations as L
import resume_intake_writes as RIW
import screening as SG
import staff_views
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

s_ = gsjs.str_
TABLE_DOOR = "tableDocUpload"
CJIS_STATUSES = ("Pending", "Clear", "Verified", "Disqualified")


def _prepared(sess: L.Session, door: str, p: dict) -> dict[str, Any]:
    got = SG.unsealed(door, SG.actor(sess.user), p.get("prepared"))
    if got is None:
        raise Defer(f"{door} is recorded only after its file was filed by this service")
    return got


def _dissolved(reads: L.Reads, *tabs: str) -> None:
    for tab in tabs:
        if not reads.db.dissolved(tab):
            raise Defer(f"{tab} is not dissolved: its sheet is Apps Script's to write")


def _title(reads: L.Reads, step: str) -> str:
    """hiringJourneySteps_()[step], soft: the step names itself when the book cannot be read."""
    got, _why = CND.soft(lambda: CND.journey_steps(reads).get(step, ""))
    return s_(got)


def journey(reads: L.Reads, cid: str, name: str, line: dict[str, Any]) -> list[dict]:
    """journeyLog_: one line on the hiring journey, titled by the book's Steps."""
    return CDW.journey_records(reads, {"key": cid, "name": name},
                               {**line, "title": _title(reads, s_(line.get("step")))}, "")[2]


def decode_records(sess: L.Session, fid: str, cid: str, name: str, item: str, filename: str,
                   now: str) -> tuple[str, list[dict]]:
    """pipelineQueueDecode_: the decoder's ledger row on form_files, anchored on the candidate's id; it never costs the
    upload. (what became of it, the records)"""
    if not fid:
        return "no file id", []
    if not cid:
        return "no candidate", []
    reads, user = sess.reads, sess.user or {}
    try:
        res = None if CP.gate_holds(reads, CP.BOOK_GATE) else W.tab_of(reads, CP.FORM_FILES_TAB)
    except (Defer, hubdb.Unreadable) as why:
        log.info("hiring papers: the decoder's ledger row is not written (%s)", str(why)[:120])
        return "no ledger", []
    if res is None:
        return "ledger row refused", []
    if res.ref is None:
        return "no ledger", []
    file_name = filename or (item + ".bin")
    row = {"form_slug": "(pipeline)", "submission_id": "", "field_key": item[:80], "anchor_id": cid,
           "anchor_name": name, "file_id": fid, "file_url": "", "file_name": file_name, "mime_type": "",
           "size_bytes": "", "uploaded_by_name": s_(user.get("display_name") or user.get("name")),
           "uploaded_by_email": s_(user.get("email")), "digest_state": "pending", "digest_kind": "",
           "digest_category": "", "digest_dates": "", "digest_names": "", "digest_text_chars": "", "digest_text": "",
           "digest_json": "", "digest_error": "", "digested_at": "", "id": str(uuid.uuid4()), "createdAt": now,
           "updatedAt": now}
    header = tuple(gsjs.trim(gsjs.js_str(h)) for h in res.ref.headers if gsjs.trim(gsjs.js_str(h)))
    staff_views.record(user, "table_doc_queued_for_decode", item + " — " + file_name + " for " + cid)
    return "queued", [W.append_record(res, header, row, cid)]


# ---- resumeUpload ---------------------------------------------------------------------------------------------------

def _resume(sess: L.Session, p: dict, door: str) -> tuple[dict[str, Any], list[dict], dict[str, Any]]:
    """resumeUpload past its file: the link filled only where blank, who touched the card, the scorecard read with
    it, and the journey's line. (the answer, the records, what was prepared)"""
    reads, user = sess.reads, sess.user or {}
    if not SG.writer(user):
        return dict(SG.DENIED), [], {}
    cid = s_(p.get("candidate_id"))
    if not SG.CID.match(cid):
        return {"status": 400, "message": "invalid candidate_id"}, [], {}
    prep = _prepared(sess, door, p)
    if prep.get("cid") != cid or prep.get("item") != "resume":
        raise Defer("the prepared file names another candidate")
    _dissolved(reads, CDW.CANDIDATES, CDW.RESUME, CDW.JOURNEY)
    cand = CDW.dissolved_rows(reads, CDW.CANDIDATES, [cid]).get(cid)
    if cand is None:
        return {"status": 404, "message": 'No candidate "' + cid + '".'}, [], {}
    held = CP.book_gate(reads)
    if held:
        return held, [], {}
    by = s_(user.get("email"))
    now = W.now_iso(reads)
    url = s_(prep.get("url"))
    recs: list[dict] = []
    if not s_(cand.get("resumelink")):
        recs += CDW.facts_of(reads, CDW.CANDIDATES, cid, {"resume_link": url}, "runtime-sheet", cid, "", at=now)
    recs += CDW.facts_of(reads, CDW.CANDIDATES, cid, {"updated_at": now, "updated_by": "asa-hub:" + by},
                         "runtime-sheet", cid, "", at=now)
    rubric = prep.get("rubric") or {}
    if rubric.get("analysis"):
        recs += RIW.rubric_records(reads, cid, rubric["analysis"], by, s_(rubric.get("fid")), now)
    recs += journey(reads, cid, s_(cand.get("candidatename")),
                    {"step": "resume_on_file", "channel": "record", "ok": True, "detail": by + " uploaded the resume",
                     "ref": url, "by": "asa-hub:" + by})
    return {"status": 200, "data": {"resume_link": url}}, recs, prep


def resume_upload(sess: L.Session, payload: dict) -> Decision:
    """resumeUpload: the résumé resumeUploadPrepare filed, on the candidate (a link already there is kept)."""
    p = payload if isinstance(payload, dict) else {}
    env, recs, _prep = _resume(sess, p, "resumeUpload")
    if env.get("status") != 200:
        return Decision(env)
    return W.final(env, recs, s_(p.get("candidate_id")))


# ---- cjisUpload -----------------------------------------------------------------------------------------------------

def _cjis(sess: L.Session, p: dict, door: str) -> tuple[dict[str, Any], list[dict]]:
    """cjisUpload past its file: the result and the report on the candidate's analysis (appended when there is none) —
    the engine's vocabulary, never a verdict read off the file — and the journey's line."""
    reads, user = sess.reads, sess.user or {}
    if not SG.writer(user):
        return dict(SG.DENIED), []
    cid = s_(p.get("candidate_id"))
    if not SG.CID.match(cid):
        return {"status": 400, "message": "invalid candidate_id"}, []
    status = s_(p.get("status")) or "Clear"
    if status not in CJIS_STATUSES:
        return {"status": 400, "message": "invalid status — engine vocabulary is Pending/Clear/Verified/Disqualified"}, []
    prep = _prepared(sess, door, p)
    if prep.get("cid") != cid or prep.get("item") != "cjis" or prep.get("status") != status:
        raise Defer("the prepared file names another candidate or result")
    _dissolved(reads, CDW.RESUME, CDW.JOURNEY)
    held = CP.book_gate(reads)
    if held:
        return held, []
    by = s_(user.get("email"))
    now = W.now_iso(reads)
    url = s_(prep.get("url"))
    if CDW.dissolved_rows(reads, CDW.RESUME, [cid]).get(cid) is not None:
        recs = CDW.facts_of(reads, CDW.RESUME, cid, {"cjis_status": status, "cjis_report_url": url, "updated_at": now,
                                                      "updated_by": "asa-hub:" + by}, "runtime-sheet", cid, "", at=now)
    else:
        recs = CDW.facts_of(reads, CDW.RESUME, cid, {"candidate_id": cid, "cjis_status": status, "cjis_report_url": url,
                                                      "created_at": now, "updated_at": now,
                                                      "created_by": "asa-hub:" + by}, "append", cid, "", at=now)
    recs += journey(reads, cid, "", {"step": "cjis_filed", "channel": "record", "ok": True,
                                     "detail": by + " uploaded the CJIS report (" + status +
                                               ") — the verdict is still a person’s",
                                     "ref": url, "by": "asa-hub:" + by})
    return {"status": 200, "data": {"cjis_status": status, "cjis_report_url": url}}, recs


def cjis_upload(sess: L.Session, payload: dict) -> Decision:
    """cjisUpload: the report cjisUploadPrepare filed, recorded with the result a person picked."""
    p = payload if isinstance(payload, dict) else {}
    env, recs = _cjis(sess, p, "cjisUpload")
    if env.get("status") != 200:
        return Decision(env)
    return W.final(env, recs, s_(p.get("candidate_id")))


# ---- tableDocUpload's own paths ------------------------------------------------------------------------------------

def _item(sess: L.Session, p: dict) -> tuple[dict[str, Any], list[dict], dict[str, Any]]:
    """tableDocUpload for an item with no catalog document: its file in Uploads, and its line on the journey."""
    reads, user = sess.reads, sess.user or {}
    cid, item = s_(p.get("candidate_id")), s_(p.get("item_id"))
    if not cid:
        return {"status": 400, "message": "candidate_id is required."}, [], {}
    prep = _prepared(sess, TABLE_DOOR, p)
    if prep.get("cid") != cid or prep.get("item") != item:
        raise Defer("the prepared file names another candidate or item")
    _dissolved(reads, CDW.JOURNEY)
    held = CP.book_gate(reads)
    if held:
        return held, [], {}
    by = s_(user.get("email"))
    url, name = s_(prep.get("url")), s_(prep.get("label"))
    recs = journey(reads, cid, s_(p.get("candidate_name")),
                   {"step": "document", "channel": "record", "ok": True,
                    "detail": by + " uploaded " + name + " for " + item, "ref": url, "by": "asa-hub:" + by})
    return {"status": 200, "data": {"url": url, "id": s_(prep.get("file_id")), "item": item}}, recs, prep


def table_upload(sess: L.Session, payload: dict) -> Decision:
    """tableDocUpload's résumé, CJIS and no-document paths (app/files_docs_writes.py hands them here past its own
    gate): the door's records, then the Hiring table's shortcuts said and the decoder's ledger row queued on the
    file's id (a CJIS answer carries no link it reads one from)."""
    p = payload if isinstance(payload, dict) else {}
    item = s_(p.get("item_id"))
    if item == "cjis":
        env, recs = _cjis(sess, p, TABLE_DOOR)
        if env.get("status") != 200:
            return Decision(env)
        return W.final({**env, "data": {**env["data"], "mirrored": 0, "decoding": "no file id"}}, recs,
                       s_(p.get("candidate_id")))
    env, recs, prep = _resume(sess, p, TABLE_DOOR) if item == "resume" else _item(sess, p)
    if env.get("status") != 200:
        return Decision(env)
    cid = s_(p.get("candidate_id"))
    decoding, rows = decode_records(sess, s_(prep.get("file_id")), cid, s_(p.get("candidate_name")), item,
                                    s_(p.get("filename")), W.now_iso(sess.reads))
    data = {**env["data"], "mirrored": int(prep.get("mirrored") or 0), "decoding": decoding}
    return W.final({**env, "data": data}, recs + rows, cid)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"resumeUpload": resume_upload, "cjisUpload": cjis_upload}
POLICY: dict[str, dict[str, Any]] = {a: {"roles": ("admin", "manager")} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}
