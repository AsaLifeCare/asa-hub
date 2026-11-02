"""Files' writes (Files.gs docUpload, docReview; TableDocs.gs tableDocUpload) decided off asa-hub-db and kept as the
dissolved candidate_documents' facts in app.edits: a paper the relay's read filed (docUploadPrepare) recorded — a
re-upload supersedes, nothing is deleted — with the candidate's folder on their row when it was made for them, and a
reviewer's verdict (uploaded means a file arrived, verified means a person checked it). tableDocUpload files a catalog
document as docUpload does; its other paths (resumeUpload, cjisUpload, an amber item's shared uploads file) are
recorded by Hiring's own doors (app/hiring_papers_writes.py)."""
from __future__ import annotations

import logging
from typing import Any, Callable

import candidate_papers as CP
import candidate_writes as CW
import drive_files as DF
import files_docs as FD
import gsjs
import hiring_papers_writes as HPW
import locations as L
import staff_views
import writes as W
from writes import Decision

log = logging.getLogger("asa-hub-app")

BUSY = "Somebody else is filing a document right now — try again."
NOT_FILED = "The document could not be filed just now — nothing was saved. Try again in a minute."
REVIEWS = ("verified", "returned")

s_ = gsjs.str_


def _filed(p: dict, cid: str, did: str) -> dict[str, Any] | None:
    """What the relay's read filed, when it is the paper this write records: kept on the server under its Drive id."""
    prep = p.get("prepared")
    if s_(p.get("base64")) != "kept" or not isinstance(prep, dict):
        return None
    if s_(prep.get("candidate_id")) != cid or s_(prep.get("doc_id")) != did or \
            DF.kept(FD.KEPT_DIR, s_(prep.get("file_id"))) is None:
        return None
    return prep


def upload(sess: L.Session, payload: dict) -> Decision:
    """docUpload: one paper recorded on the candidate's documents — the older one of its kind superseded, nothing
    deleted — its expiry the day given, else the issue day and the catalog's renewal months."""
    p = payload if isinstance(payload, dict) else {}
    reads, user = sess.reads, sess.user
    _cat, refused = FD.upload_checked(reads, user, p)
    if refused:
        return Decision(refused)
    if not str(p.get("base64") or ""):
        return W.refuse(400, "No file attached")
    cid, did = s_(p.get("candidate_id")), s_(p.get("doc_id"))
    prep = _filed(p, cid, did)
    if prep is None:
        return W.refuse(503, NOT_FILED)
    now = W.now_iso(reads)
    rows = FD.doc_rows(reads, cid)
    data, recs = CP._doc_records(sess, {"candidate": cid, "file": {"name": s_(prep.get("name")),
                                                                    "mime": s_(prep.get("mime"))}},
                                 {"doc_id": did, "issued_on": p.get("issued_on"), "expires_on": p.get("expires_on"),
                                  "notes": p.get("notes")},
                                 {"file_id": s_(prep.get("file_id")), "size": int(prep.get("size") or 0),
                                  "folder_id": s_(prep.get("folder_id"))}, now, "")
    vals = data["doc"]
    for r in rows:
        if s_(r.get("docid")) == did and not s_(r.get("supersededby")):
            rows = FD.laid(rows, {"superseded_by": vals["doc_row_id"]}, s_(r.get("docrowid")))
    staff_views.record(user, "doc_upload", f"{cid}:{did}")
    return W.final({"status": 200, "data": {"doc": vals, "state": FD.doc_state(reads, cid, FD.laid(rows, vals))}},
                   recs, cid)


def review(sess: L.Session, payload: dict) -> Decision:
    """docReview: the reviewer's verdict on the candidate's current paper of that kind, with who and when, and the
    dates and notes they corrected."""
    user = sess.user
    if not FD.writer(user):
        return Decision(dict(FD.DENIED))
    p = payload if isinstance(payload, dict) else {}
    cid, did, decision = s_(p.get("candidate_id")), s_(p.get("doc_id")), s_(p.get("decision")).lower()
    if not cid or not did:
        return W.refuse(400, "candidate_id and doc_id are required")
    if decision not in REVIEWS:
        return W.refuse(400, 'decision must be "verified" or "returned"')
    reads = sess.reads
    rows = FD.doc_rows(reads, cid)
    hit = None
    for r in rows:
        if s_(r.get("docid")) == did and not s_(r.get("supersededby")):
            hit = r
    if hit is None:
        return W.refuse(404, "No document on file for " + did)
    now = W.now_iso(reads)
    cells: dict[str, Any] = {"status": "verified" if decision == "verified" else "returned", "review_status": decision,
                             "verified_by": "asa-hub:" + s_((user or {}).get("email")), "verified_at": now}
    for k in ("issued_on", "expires_on", "notes"):
        if s_(p.get(k)):
            cells[k] = s_(p.get(k))
    row_id = s_(hit.get("docrowid"))
    recs = CW.facts_of(reads, CW.DOCS, row_id, cells, "runtime-sheet", cid, "", at=now)
    staff_views.record(user, "doc_review:" + decision, f"{cid}:{did}")
    return W.final({"status": 200, "data": {"state": FD.doc_state(reads, cid, FD.laid(rows, cells, row_id))}}, recs,
                   cid)


def table_upload(sess: L.Session, payload: dict) -> Decision:
    """tableDocUpload: a catalog document filed as docUpload files it — the Hiring table's mirror and the decoder's
    queue find no file id in its answer, and say so; a résumé, a CJIS report or an item with no catalog document is
    recorded by Hiring's own doors (app/hiring_papers_writes.py)."""
    p = payload if isinstance(payload, dict) else {}
    refused = FD.table_refused(sess.user, p)
    if refused:
        return Decision(refused)
    if FD.table_handed(p):
        return HPW.table_upload(sess, p)
    d = upload(sess, p)
    a = d.answer or {}
    if a.get("status") == 200 and isinstance(a.get("data"), dict):
        d.answer = {**a, "data": {**a["data"], "mirrored": 0, "decoding": "no file id"}}
    return d


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"docUpload": upload, "docReview": review,
                                                             "tableDocUpload": table_upload}
POLICY: dict[str, dict[str, Any]] = {
    "docUpload": {"roles": FD._DOC_ROLES}, "docReview": {"roles": ("admin", "manager")},
    "tableDocUpload": {"roles": ("admin", "manager"),
                       "params": {k: "string" for k in ("candidate_id", "item_id", "filename", "base64",
                                                        "candidate_name")}}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.files_writes and app.files_receipts, beside the other apps' own; the facts app.edits'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="files", label="Files")
