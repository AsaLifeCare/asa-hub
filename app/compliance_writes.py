"""Compliance's write (Compliance.gs complianceReviewResolve): a review's verdict recorded once, in Postgres
(app.resource_rows `complianceReviews`); the legacy queue's row stamped (App Data › PendingReviews) and, on an approval
with a confirmed date, the Employee Database Master's date column written — both books others still read, kept in
app.edits. complianceUpload brings the compliance_reviews tab into Postgres as the app is given to Python."""
from __future__ import annotations

import re
from typing import Any, Callable

import cert_docs as CD
import compliance as CO
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import sheet_resources as SR
import staff as SP
import staff_views
import writes as W
from scope import Defer
from writes import Decision

BUSY = "Somebody else is recording a review right now — try again."
PARAMS = (("id", True, "string"), ("verdict", True, "string"), ("note", False, "string"), ("date", False, "string"),
          ("expected", False, "string"))
# the legacy queue's row, named by a cell that stays (a sheet row number moves under the copy)
PENDING_KEYS = [["FileId"], ["UploadToken"], ["DriveUrl"]]

s_ = gsjs.str_


def _owned(reads: L.Reads) -> None:
    if not RR.uploaded(reads.db, CO.RESOURCE):
        raise Defer(f"{CO.RESOURCE} is not uploaded to Postgres yet")


def stamp_legacy(reads: L.Reads, src: dict, verdict: str, who: str) -> dict[str, Any]:
    """complianceStampLegacy_ as a kept edit: ReviewStatus, ReviewedBy and ReviewedAt on the queue's row; best effort —
    the verdict is already recorded and must not fail on a workbook this app does not own."""
    try:
        sid = gsjs.trim(reads.db.prop(CO.APPDATA_PROP))
        ref = reads.tab_of(sid, CO.PENDING_TAB, "the staff-docs review queue") if sid else None
        if ref is None:
            return {"ok": False, "why": "tab missing"}
        rows = reads.db.rows(ref)
        r = CO._int(src.get("_row")) or 0
        at = next((i for i, (rn, _raw) in enumerate(rows) if rn == r), None)
        if not r or r < 2 or at is None:
            return {"ok": False, "why": "row out of range"}
        heads = {gsjs.trim(gsjs.js_str(h)): h for h in ref.headers}
        cells = {name: v for name, v in (("ReviewStatus", verdict), ("ReviewedBy", who),
                                         ("ReviewedAt", W.now_iso(reads))) if name in heads}
        if not cells:
            return {"ok": False, "wrote": []}
        key = W.row_key_of(rows, at, [[heads.get(h, "") for h in hs] for hs in PENDING_KEYS])
        if key is None:
            return {"ok": False, "why": "the queue's row cannot be told apart from another row"}
        raw = rows[at][1]
        before = {name: hubdb.estate_cell(hubdb.typed(raw.get(heads[name]), "estate")) for name in cells}
        edit = W.kept_record(ref.sheet_id, ref.tab, "edit", key[0], key[1], SP.fold(src.get("SubmitterName")), cells,
                             before)
        return {"ok": True, "wrote": list(cells), "edit": edit}
    except (hubdb.Unreadable, Defer) as e:
        return {"ok": False, "why": str(e)}


def write_master_date(reads: L.Reads, person: str, date_field: str, value: str, expected: Any) -> dict[str, Any]:
    """complianceWriteMasterDate_: only the date (the flag columns are formulas derived from it), through the one
    Master writer (emp360WriteCell_ with the review's permission), as a kept edit."""
    if not date_field:
        return {"ok": False, "why": "the review names no date column"}
    # Med Del dates belong to the Med Del engine; two writers on one cell collide
    if re.match(r"med\s*\d", date_field, re.I):
        return {"ok": False, "why": "Med Del dates are written by the delegation engine"}
    target = CO.master_target(reads, person, "")
    if not target["ok"]:
        return {"ok": False, "why": target["why"]}
    try:
        got = CD.master_cell(reads, date_field, target["employee_id"], s_(expected))
    except (hubdb.Unreadable, Defer, SP.Said) as e:
        return {"ok": False, "why": str(e)}
    if "stale" in got:
        return {"ok": False, "why": "Someone changed this row since you opened it — reloaded."}
    if got.get("why"):
        return {"ok": False, "why": got["why"]}
    edit = W.kept_record(got["sid"], got["tab"], "edit", got["match"], got["key"], SP.fold(person),
                         {got["head"]: s_(value)}, {got["head"]: got["before"]})
    found = CD.find_master_row(reads, "", target["employee_id"])
    row = found.get("row") or {}
    rn = CD.master_sheet(reads)["raw"][found["at"]][0] if found.get("at") is not None else ""
    line = (f"{s_(row.get('employee') or row.get('name'))}: {hubdb.estate_key(date_field)} (row {rn})"
            " · via review")
    return {"ok": True, "edit": edit, "line": line}


def review_resolve(sess: L.Session, payload: dict) -> Decision:
    """complianceReviewResolve: approved or rejected, recorded once; the legacy queue stamped, and on an approval with
    a date the Master's date column written while it holds `expected`. The uploaded file is never moved."""
    p = payload if isinstance(payload, dict) else {}
    bad = CD.params_gate(p, PARAMS)
    if bad:
        return Decision(bad)
    user = sess.user or {}
    if not CO.writer(sess.user):
        return Decision(CD.denied())
    reads = sess.reads
    _owned(reads)
    rid = s_(p.get("id"))
    if not rid:
        return W.refuse(400, "Which review? An id from complianceReviewQueue is required.")
    verdict = s_(p.get("verdict")).lower()
    if verdict not in ("approved", "rejected"):
        return W.refuse(400, f'Verdict must be "approved" or "rejected" — got "{s_(p.get("verdict"))}".')
    source = CO.pending_source(reads)
    if source is None:
        return W.refuse(503, f'The staff-docs review queue could not be read, so the review "{rid}" cannot be verified '
                             "to exist — nothing was recorded.")
    src = next((s for s in source if s["_id"] == rid), None)
    if src is None:
        return W.refuse(404, f'No review "{rid}" in the staff-docs queue.')
    existing = CO.reviews_by_id(reads).get(rid)
    if existing:
        return W.refuse(409, "That review was already resolved "
                        + (f'("{existing["verdict"]}") ' if existing.get("verdict") else "") + "by "
                        + (existing.get("resolvedBy") or "someone")
                        + (" on " + existing["resolvedAt"][:10] if existing.get("resolvedAt") else "")
                        + " — a verdict is recorded once.")
    t = gsjs.or_text
    date_field = t(src.get("DateField"))
    if date_field and CO.pii_blocked(date_field):
        return W.refuse(403, f'This review targets the protected column "{date_field}" — it is never read or written '
                             "here, and its approval is not recorded here either.")
    now, by = W.now_iso(reads), s_(user.get("email"))
    record = {"id": rid, "createdAt": now, "submitter": t(src.get("SubmitterName")), "docType": t(src.get("DocType")),
              "dateField": date_field, "aiExpDate": t(src.get("AIExtractedExpDate")),
              "aiCertDate": t(src.get("AIExtractedCertDate")), "aiConfidence": t(src.get("AIConfidence")),
              "isCandidate": t(src.get("IsCandidate")), "sourceRow": gsjs.js_str(src["_row"]), "verdict": verdict,
              "note": s_(p.get("note")), "resolvedBy": by, "resolvedAt": now}
    RR.create(reads, CO.RESOURCE, {h: record[h] for h in CO.REVIEWS_HEADER}, by)
    stamped = stamp_legacy(reads, src, verdict, by)
    wrote: dict[str, Any] = {"ok": False, "why": "no date confirmed"}
    if verdict == "approved" and s_(p.get("date")):
        wrote = write_master_date(reads, record["submitter"], date_field, s_(p.get("date")), p.get("expected"))
    if wrote.get("line"):
        staff_views.record(user, "emp360WriteCell", wrote["line"])
    staff_views.record(user, "complianceReviewResolve", record["submitter"] + " — " + record["docType"]
                       + (" · legacy stamped" if stamped["ok"] else " · legacy NOT stamped: " + s_(stamped.get("why"))))
    data = {"id": rid, "verdict": verdict, "legacyStamped": bool(stamped["ok"]), "masterWritten": bool(wrote["ok"]),
            "masterWhy": "" if wrote["ok"] else s_(wrote.get("why")),
            "message": "Recorded" + (" and the legacy queue was stamped" if stamped["ok"] else "")
                       + ". The Master date column (" + (date_field or "none named") + ") "
                       + ("was written — the sheet computes the flags from it." if wrote["ok"]
                          else "was NOT written: " + s_(wrote.get("why")) + ".")
                       + " The uploaded file was not moved."
                       + ("" if stamped["ok"] else " The legacy queue could NOT be stamped (" + s_(stamped.get("why"))
                          + "), so the old portal may still offer this review.")}
    edits = [e for e in (stamped.get("edit"), wrote.get("edit")) if e]
    return Decision({"status": 200, "data": data}, edits=edits, subject=SP.fold(record["submitter"]), own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "complianceReviewResolve": review_resolve,
    "complianceUpload": RR.upload_door({CO.RESOURCE: SR.SPECS.get(CO.RESOURCE) or {"tab": CO.REVIEWS_TAB}})}
# the params are the door's own gate (hubPolicyGate_'s order: a required one missing, then a type)
POLICY: dict[str, dict[str, Any]] = {"complianceReviewResolve": {"roles": CO.ROLES, "params": {}},
                                     "complianceUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.compliance_writes and app.compliance_receipts; the verdicts app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="compliance", label="Compliance")
