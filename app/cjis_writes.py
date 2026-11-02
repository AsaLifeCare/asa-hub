"""The CJIS folder's writes (Cjis.gs cjisApply, cjisFolderSweepNow, and the half-hourly sweep on the relay's clock):
each report the folder holds for a card that did not know of it attached "On file" — on the resume analysis and as a
background-check paper — as the hiring records' facts in Postgres, its line on the journey, and the team told once per
pass through Smart Comms. No filename is allowed to write Clear or Verified."""
from __future__ import annotations

import logging
from typing import Any, Callable

import candidate_writes as CDW
import candidates as CND
import gsjs
import interviews_writes as IVW
import locations as L
import screening as SG
import staff_views
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

s_ = gsjs.str_
SWEEP_ACTOR = "cjis-folder@service.local"
ARRIVED_SIT = "hiring_cjis_report_arrived"
DOC_NOTE = "found in the CJIS folder — the report exists; the verdict is still a person's"


def _prepared(sess: L.Session, door: str, p: dict) -> dict[str, Any]:
    got = SG.unsealed(door, SG.actor(sess.user), p.get("prepared"))
    if got is None:
        raise Defer(f"{door} is recorded only after its reading was prepared by this service")
    return got


def _dissolved(reads: L.Reads) -> None:
    for tab in (CDW.RESUME, CDW.DOCS):
        if not reads.db.dissolved(tab):
            raise Defer(f"{tab} is not dissolved: its sheet is Apps Script's to write")


def attach_records(reads: L.Reads, cid: str, url: str, filename: str, by: str, now: str) -> list[dict]:
    """cjisAttach_: the analysis marked On file (a verdict a person recorded is never overwritten) with the report's
    link where none is, and the background-check paper on the hiring record, its review pending."""
    a = CND.evidence(reads, cid).get("analysis") or {}
    if a:
        st = s_(a.get("cjisstatus")).lower()
        fields: dict[str, str] = {}
        if not st or st in ("pending", "on file"):
            fields["cjis_status"] = "On file"
        if not s_(a.get("cjisreporturl")):
            fields["cjis_report_url"] = url
        recs = CDW.facts_of(reads, CDW.RESUME, cid, fields, "runtime-sheet", cid, "", at=now) if fields else []
    else:
        recs = CDW.facts_of(reads, CDW.RESUME, cid, {"candidate_id": cid, "cjis_status": "On file",
                                                      "cjis_report_url": url, "created_at": now,
                                                      "created_by": "asa-hub:cjis-folder"}, "append", cid, "", at=now)
    row_id = SG.hex_id("DOC_", 16)
    recs += CDW.facts_of(reads, CDW.DOCS, row_id, {
        "doc_row_id": row_id, "candidate_id": cid, "doc_id": "background_check", "doc_label": "Background check (BCI)",
        "status": "uploaded", "review_status": "pending", "file_url": url, "file_name": filename,
        "uploaded_by": "asa-hub:cjis-folder:" + by, "uploaded_at": now, "notes": DOC_NOTE}, "append", cid, "", at=now)
    return recs


def tell(reads: L.Reads, rows: list[dict], orphans: int) -> bool:
    """cjisSweepTell_: one letter per pass, never one per person, while hiring_cjis_report_arrived is on."""
    sit = IVW._situation(reads, ARRIVED_SIT)
    team = IVW.team_emails(reads)
    if sit is None or not team:
        return False
    import smart_comms as SC  # noqa: PLC0415 - every message goes through Smart Comms
    lines = "\n".join("  " + s_(r.get("name")) + " — " + s_(r.get("filename")) for r in rows)
    v = {"count": str(len(rows)), "lines": lines,
         "orphans_line": f"\n\n{orphans} file(s) in that folder match nobody on the board." if orphans else ""}
    body = ("The background check turned up in the folder for "
            + ("one candidate" if len(rows) == 1 else f"{len(rows)} candidates") + ", and it is on their card:\n\n"
            + lines + "\n\nIt is marked ON FILE and nothing stronger. Clear and Verified are what let somebody out of "
            "New, and no filename is allowed to answer that — somebody still reads the report."
            + (f"\n\n{orphans} file(s) in that folder match nobody on the board. That is normal when a candidate "
               "uploads their own — but nobody can see it unless it is said." if orphans else ""))
    subject = CND.render(s_(sit.get("email_subject")) or f"A background check arrived — {len(rows)} candidate(s)", v)
    text = CND.render(s_(sit.get("email_text")) or body, v)
    key = "cjis_sweep_" + "_".join(s_(r.get("candidate_id")) for r in rows)
    sent = False
    for addr in team:
        got = SC.raise_situation(None, situation=ARRIVED_SIT, to=addr, vars={}, key=key + "|" + addr.lower(),
                                 lane="hiring", at_ms=int(reads.now.timestamp() * 1000), prune=False,
                                 channel="email", body=text, subject=subject)
        sent = sent or s_(got.get("state")) in ("sent", "already")
    return sent


def sweep_records(reads: L.Reads, plan: dict, now: str) -> tuple[dict[str, Any], list[dict]]:
    """cjisFolderSweepRun_: each report attached with its cjis_filed line; the team told of the ones never announced."""
    if plan.get("error"):
        return {"error": plan["error"]}, []
    recs: list[dict] = []
    attached = []
    _dissolved(reads)
    for a in plan.get("attach") or []:
        cid = s_(a.get("candidate_id"))
        recs += attach_records(reads, cid, s_(a.get("file_url")), s_(a.get("filename")), SWEEP_ACTOR, now)
        recs += CDW.journey_records(reads, {"key": cid, "name": s_(a.get("name"))}, {
            "step": "cjis_filed", "channel": "drive", "to": "", "ok": True, "ref": s_(a.get("file_id")),
            "detail": 'found in the CJIS folder as "' + s_(a.get("filename")) + '" and attached — the verdict is still '
                      "a person’s", "by": "asa-hub:cjis-folder"}, "")[2]
        attached.append(a)
    orphans = int(plan.get("orphans") or 0)
    fresh = [a for a in attached if not a.get("told")]
    if fresh:
        tell(reads, fresh, orphans)
    if attached or orphans:
        staff_views.record({"email": "auto-cjis-folder"}, "cjis_folder_sweep",
                           f"{len(attached)} attached, {orphans} file(s) matching nobody")
    return {"attached": len(attached), "announced": len(fresh), "orphans": orphans}, recs


def apply(sess: L.Session, payload: dict) -> Decision:
    """cjisApply: the reports cjisApplyPrepare found attached and marked on file; none marked Clear."""
    reads, user = sess.reads, sess.user or {}
    if SG.service(user) or s_(user.get("role")) != "admin":
        return Decision(dict(SG.DENIED))
    prep = _prepared(sess, "cjisApply", payload if isinstance(payload, dict) else {})
    done = []
    recs: list[dict] = []
    if prep.get("attach"):
        _dissolved(reads)
        W.gate(reads)
        now = SG.iso_now(reads)
        for a in prep["attach"]:
            recs += attach_records(reads, s_(a.get("candidate_id")), s_(a.get("file_url")), s_(a.get("filename")),
                                   s_(user.get("email")), now)
            done.append({"candidate_id": a.get("candidate_id"), "name": a.get("name"), "filename": a.get("filename"),
                         "file_url": a.get("file_url")})
    skipped = prep.get("skipped") or []
    staff_views.record(user, "cjis_folder_apply", f"{len(done)} attached, {len(skipped)} skipped")
    message = (f"{len(done)} report(s) attached and marked on file. None was marked Clear — a person still reads the "
               "report and decides." if done else "Nothing to attach.")
    return W.final({"status": 200, "data": {"attached": done, "skipped": skipped, "message": message}}, recs, "")


def sweep_now(sess: L.Session, payload: dict) -> Decision:
    """cjisFolderSweepNow: look now rather than waiting up to half an hour for the clock."""
    reads = sess.reads
    if not SG.writer(sess.user):
        return Decision(dict(SG.DENIED))
    prep = _prepared(sess, "cjisFolderSweepNow", payload if isinstance(payload, dict) else {})
    if prep.get("attach"):
        W.gate(reads)
    out, recs = sweep_records(reads, prep, SG.iso_now(reads))
    return W.final({"status": 200, "data": out}, recs, "")


def sweep(sess: L.Session, payload: dict) -> Decision:
    """The half-hourly sweep on the relay's clock: what cjisSweepDue found, recorded."""
    if not SG.service(sess.user):
        return W.refuse(403, "The CJIS sweep is the relay's alone.")
    p = payload if isinstance(payload, dict) else {}
    if isinstance(p.get("prepared"), dict) and p["prepared"].get("due") is False:
        return Decision({"status": 200, "data": {"attached": 0, "announced": 0,
                                                 "orphans": int(p["prepared"].get("orphans") or 0)}})
    got = SG.unsealed("cjisSweep", "service", p.get("prepared"))
    if got is None:
        raise Defer("cjisSweep is read by cjisSweepDue first")
    reads = sess.reads
    W.gate(reads)
    out, recs = sweep_records(reads, got, SG.iso_now(reads))
    return W.final({"status": 200, "data": out}, recs, "")


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"cjisApply": apply, "cjisFolderSweepNow": sweep_now,
                                                              "cjisSweep": sweep}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["cjisApply"] = {"params": {"candidate_ids": "string"}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.cjis_writes and app.cjis_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="cjis", label="CJIS folder")
