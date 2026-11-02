"""Onboarding's writes (Onboarding.gs obSetName, obStepDone, obDocUpload, obDocRemove, onboardingSetWindow; Packet.gs
obPacketUpload; Seat.gs seatRelease) kept in Postgres: the packet row, the onboarding row, the candidate card and the
document record as the hiring rows' facts (every hiring tab is dissolved), a DODD or CPR paper's clearance row in
app.resource_rows, and a finished visit's report kept there too (onboardingReports), where Smart Comms' sweep reads
it. A file arrives already filed: the relay asks its read first (obDocPrepare, obPacketPrepare,
obDocTrash) and the write records what it did."""
from __future__ import annotations

import logging
import math
import re
import secrets
import uuid
from datetime import timedelta
from typing import Any, Callable

import candidate_papers as CP
import candidate_writes as CW
import candidates as CND
import gsjs
import hubdb
import locations as L
import names as N
import onboarding as OB
import resource_rows as RR
import sheet_resources as SR
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

s_ = CND.s_
# Onboarding.gs obStepDone: every step the screen marks, and the column that proves it
STEPS = {"packet": "PacketAcknowledged", "background": "BackgroundCheck", "documents": "DocumentsComplete",
         "training": "CompleteTraining", "questionnaire": "QuestionnaireComplete", "tutorials": "TutorialsComplete"}
# Clearance.gs: only DODD and CPR papers reach the matrix, as a receipt never a verdict
CLEARANCE, CLEARANCE_TAB = "staffClearance", "staff_clearance"
CLEARANCE_FROM_DOC = {"dodd_8hr": "dodd", "cpr": "cpr"}
CLEARANCE_CREDENTIALS = ("dodd", "cpr", "med1", "med2", "med3", "mais", "money", "mandt")
# Onboarding.gs OB_REPORT_TAB / OB_REPORT_HEADER
REPORTS, REPORT_TAB = "onboardingReports", "onboarding_reports"
REPORT_HEADER = ("id", "createdAt", "candidate_id", "full_name", "phone", "email", "step1_packet", "step2_background",
                 "step3_documents", "step4_training", "step5_questionnaire", "step6_tutorials", "report_text")
HOLD_SINCE, HOLD_UNTIL = CP.PACKET_HOLD_SINCE, CP.PACKET_HOLD_UNTIL
SEAT_CLOSED = "No candidate is at the onboarding phase of the process right now — this seat is closed."
NOT_FILED = "The document could not be filed just now — nothing was saved."
MISMATCH = "The filed copy does not match this upload — nothing was recorded. Send it again."


def _who(sess: L.Session) -> str:
    return s_((sess.user or {}).get("email"))


def _final(answer: dict[str, Any], recs: list[dict], subject: str, own: bool = False) -> Decision:
    """W.final, and a row kept in app.resource_rows under this write as well."""
    kept = [e for e in recs if e and e.get("cells")]
    if not kept and not own:
        return Decision(answer)
    return Decision(answer, edits=kept or None, subject=subject, own=own)


def _packet_facts(reads: L.Reads, found: dict, cells: dict[str, str], at: str) -> list[dict]:
    """obSetField_ for each cell: a column the row lacks is never written, a row without its key never."""
    keep = {k: v for k, v in cells.items() if k in found["hdr"]}
    if not keep or not found.get("subject"):
        return []
    return CW.facts_of(reads, OB.PACKET_TAB, found["subject"], keep, "runtime-sheet", found["subject"], "", at=at)


def _flow(reads: L.Reads, found: dict) -> dict[str, Any]:
    return {"status": 200, "data": OB.flow_of(reads, found)}


def _own_row(sess: L.Session) -> tuple[dict | None, Decision | None]:
    user = sess.user or {}
    found = OB.find_row(sess.reads, s_(user.get("email")), OB.candidate_id(sess.reads, user))
    return (found, None) if found is not None else (None, W.refuse(404, OB.NOT_LISTED))


def _cid_now(sess: L.Session, found: dict) -> str:
    """The candidate a paper is filed against: the account's own (never the seat's, which belongs to the furniture),
    else the row's graduation id, else the candidate the typed name resolves to."""
    user = sess.user or {}
    own = "" if OB.seat_account(user) else OB.candidate_id(sess.reads, user)
    return own or OB.person_id(sess.reads, found)


# ---- step 1: the name (obSetName, packetClaim_, packetCreateRow_) ------------------------------------------------

def _claim(sess: L.Session, name: str, now: str) -> tuple[dict | None, list[dict], dict | None]:
    """packetClaim_: the free row this typed name fits, bound to this seat; none close enough is a new record; two
    near-equal fits claim nothing."""
    reads, user = sess.reads, sess.user or {}
    mail = s_(user.get("email")).lower()
    cid = OB.candidate_id(reads, user)
    free = []
    for r in OB.rows(reads):
        if OB.field(r, "CompletedAt"):
            continue
        held = OB.field(r, "HubEmail").lower()
        if held and held != mail:
            continue
        label = OB.field(r, "FullName") or OB.field(r, "CandidateName")
        if N.norm(label):
            free.append({**r, "label": label})
    best = N.best(name, free, lambda r: r["label"])
    if not best["ok"] and best.get("reason") == "ambiguous":
        return None, [], {"status": 409, "message": "That name is close to more than one record (" +
                          " and ".join(best["candidates"]) + "). Ask your recruiter to open your onboarding — "
                          "we will not guess which one is you."}
    if best["ok"]:
        row = {k: v for k, v in best["item"].items() if k != "label"}
        cells = {"HubEmail": mail, "HubCandidateId": cid}
        log.info("onboarding: %s claimed the record of %s (%d%%)", name, best["matched_name"],
                 round(best["score"] * 100))
        return OB.laid(row, cells), _packet_facts(reads, row, cells, now), None
    new_id = "OB-" + str(int(reads.now.timestamp() * 1000))
    seed = {"CandidateId": new_id, "CandidateName": name, "FullName": name, "HubEmail": mail, "HubCandidateId": cid,
            "source": "hub:self-serve", "cloned_at": now, "updated_by": s_(user.get("email")), "updated_at": now}
    hdr = OB.header(reads)
    found = {"hdr": hdr, "values": [seed.get(h, "") for h in hdr], "subject": new_id}
    recs = CW.facts_of(reads, OB.PACKET_TAB, new_id, {h: seed[h] for h in hdr if h in seed}, "runtime-sheet:append",
                       new_id, "", at=now)
    log.info("onboarding: %s is a new record %s", name, new_id)
    return found, recs, None


def set_name(sess: L.Session, payload: dict) -> Decision:
    """obSetName: the name unlocks the steps and is what the document match uses; a seat with nobody bound claims (or
    makes) the record it names; an empty onboarding stage refuses the visit."""
    shut = OB.lane(sess)
    if shut:
        return Decision(shut)
    reads, user = sess.reads, sess.user or {}
    if not OB.stage_open(reads):
        return W.refuse(409, SEAT_CLOSED)
    p = payload if isinstance(payload, dict) else {}
    name = gsjs.trim(s_(p.get("full_name"))[:120])
    if len(re.split(r"\s+", name)) < 2:
        return W.refuse(400, "Please give your first and last name — that is how we find documents you already sent.")
    now = W.now_iso(reads)
    found = OB.find_row(reads, s_(user.get("email")), OB.candidate_id(reads, user))
    recs: list[dict] = []
    if found is None:
        if not OB.may_address_other(user):
            return W.refuse(403, "Your account is not on the onboarding list.")
        found, recs, refused = _claim(sess, name, now)
        if refused:
            return Decision(refused)
    cells = {"FullName": name, "updated_by": s_(user.get("email")), "updated_at": now}
    recs += _packet_facts(reads, found, cells, now)
    after = OB.laid(found, cells)
    return _final(_flow(reads, after), recs, after["subject"])


def step_done(sess: L.Session, payload: dict) -> Decision:
    """obStepDone: a step's column set (or cleared with done: false) on the caller's own record."""
    shut = OB.lane(sess)
    if shut:
        return Decision(shut)
    p = payload if isinstance(payload, dict) else {}
    col = STEPS.get(s_(p.get("step")))
    if not col:
        return W.refuse(400, "Unknown step: " + s_(p.get("step")))
    found, refused = _own_row(sess)
    if refused:
        return refused
    if not OB.field(found, "FullName"):
        return W.refuse(400, OB.NAME_FIRST)
    reads = sess.reads
    now = W.now_iso(reads)
    cells = {col: "FALSE" if p.get("done") is False else "TRUE", "updated_by": _who(sess), "updated_at": now}
    after = OB.laid(found, cells)
    return _final(_flow(reads, after), _packet_facts(reads, found, cells, now), found["subject"])


# ---- step 3: a document (obDocUpload, clearanceRecordUpload_, obRecordCanonical_, obDocRemove) -------------------

def _clearance(sess: L.Session, doc_id: str, name: str, cid: str, fid: str, expires: str) -> tuple[list[dict], bool]:
    """clearanceRecordUpload_: a DODD or CPR paper's receipt ('submitted') on the clearance overlay — in Postgres once
    it is kept there, else appended to its tab; it never costs the upload. (the tab's records, whether Postgres took
    the row)"""
    cred = CLEARANCE_FROM_DOC.get(doc_id) or (doc_id if doc_id in CLEARANCE_CREDENTIALS else "")
    if not cred:
        return [], False
    reads = sess.reads
    row = {"clearance_id": "CLR_" + secrets.token_hex(8).upper(), "person_key": gsjs.name_key(name),
           "person_name": name, "candidate_id": cid, "credential": cred, "evidence_kind": "document", "file_id": fid,
           "state_ref": "", "issued_on": "", "expires_on": expires, "decision": "submitted", "verified_by": "",
           "verified_at": "", "source": "hub:onboarding"}
    try:
        if RR.uploaded(reads.db, CLEARANCE):
            RR.create(reads, CLEARANCE, {k: v for k, v in row.items() if v != ""}, _who(sess))
            return [], True
        res = W.tab_of(reads, CLEARANCE_TAB)
        sid, tab = W.where_of(res)
        return [W.kept_record(sid, tab, "append", W.COLS + "clearance_id", row["clearance_id"], cid, row)], False
    except (Defer, hubdb.Unreadable) as why:
        log.warning("onboarding: the clearance receipt for %s was not kept (%s)", cred, str(why)[:120])
        return [], False


def _canonical(reads: L.Reads, doc: dict, cid: str, name: str, prep: dict, expires: str, by: str,
               now: str) -> list[dict]:
    """obRecordCanonical_: the paper's row on candidate_documents, where the Employee Database is filled from; never
    costs the upload."""
    if not doc["cat"] or not cid:
        return []
    try:
        cat = next((c for c in CND.catalog_of(reads) if c["doc_id"] == doc["cat"]), None)
        fid = s_(prep.get("drive_id"))
        vals = {"doc_row_id": "DOC_" + secrets.token_hex(8).upper(), "candidate_id": cid, "candidate_name": name,
                "doc_id": doc["cat"], "doc_label": s_((cat or {}).get("label")) or doc["label"], "status": "uploaded",
                "review_status": "pending", "file_id": fid, "file_url": OB.drive_url(fid),
                "file_name": s_(prep.get("name")), "mime_type": s_(prep.get("mime")),
                "size_bytes": int(prep.get("size") or 0), "issued_on": "", "expires_on": expires,
                "uploaded_by": "asa-hub:onboarding:" + by, "uploaded_at": now, "verified_by": "", "verified_at": "",
                "superseded_by": "", "notes": "handed in through the onboarding portal"}
        return CW.facts_of(reads, CW.DOCS, vals["doc_row_id"], vals, "runtime-sheet:append", cid, "", at=now)
    except (Defer, hubdb.Unreadable) as why:
        log.warning("onboarding: the document record for %s was not kept (%s)", doc["cat"], str(why)[:120])
        return []


def _prepared(p: dict, field: str, subject: str, doc: str) -> dict | None:
    """What the relay's read filed, when it is the file this write records: kept on the server under this row."""
    prep = p.get("prepared")
    if s_(p.get(field)) != "kept" or not isinstance(prep, dict):
        return None
    fid = s_(prep.get("drive_id"))
    if not OB._FILE_ID.fullmatch(fid) or not OB.kept_dir(subject, doc, fid).is_dir():
        return None
    return prep


def doc_upload(sess: L.Session, payload: dict) -> Decision:
    """obDocUpload: the file the relay filed (obDocPrepare) recorded — its id, then the step's flag — with a DODD or
    CPR paper's clearance receipt and the platform's document row."""
    shut = OB.lane(sess)
    if shut:
        return Decision(shut)
    p = payload if isinstance(payload, dict) else {}
    doc = OB.DOC_OF.get(s_(p.get("doc_id")))
    if doc is None:
        return W.refuse(400, "Unknown document: " + s_(p.get("doc_id")))
    found, refused = _own_row(sess)
    if refused:
        return refused
    full = OB.field(found, "FullName")
    if not full:
        return W.refuse(400, "Give your full name in step 1 first — your documents are filed under it.")
    if not s_(p.get("base64")):
        return W.refuse(400, "No file attached")
    if s_(p.get("base64")) != "kept":
        return W.refuse(503, NOT_FILED)
    prep = _prepared(p, "base64", found["subject"], doc["id"])
    if prep is None or s_(prep.get("doc_id")) != doc["id"]:
        return W.refuse(409, MISMATCH)
    reads = sess.reads
    now = W.now_iso(reads)
    fid = s_(prep.get("drive_id"))
    cells = {doc["file"]: fid, doc["col"]: "TRUE", "updated_by": _who(sess), "updated_at": now}
    recs = _packet_facts(reads, found, cells, now)
    cid = _cid_now(sess, found)
    clr, own = _clearance(sess, doc["id"], full, cid, fid, OB.stamp_date(p.get("expires")))
    recs += clr
    record = _canonical(reads, doc, cid, full, prep, s_(p.get("expires")), _who(sess), now)
    recs += record
    log.info("onboarding: %s → %s", doc["label"], s_(prep.get("where")))
    answer = _flow(reads, OB.laid(found, cells))
    if record and doc["file"] not in found["hdr"]:
        # a paper with no tracker column is on file through its document row, which this answer cannot read yet
        data = answer["data"]
        data["docs"] = [{"id": d["id"], "label": d["label"], "status": "uploaded", "source": "you sent this here",
                         "file_url": OB.drive_url(fid), "expires": s_(p.get("expires")), "kept_id": fid}
                        if d["id"] == doc["id"] else d for d in data["docs"]]
        data["docs_done"] = sum(1 for d in data["docs"] if d["status"] in ("uploaded", "on_file"))
    return _final(answer, recs, found["subject"], own)


def doc_remove(sess: L.Session, payload: dict) -> Decision:
    """obDocRemove: a document the Hub filed taken back — Drive's bin by the relay's read (obDocTrash), the row
    cleared whether or not Drive answered; a submission from the old form is not ours to touch."""
    shut = OB.lane(sess)
    if shut:
        return Decision(shut)
    p = payload if isinstance(payload, dict) else {}
    doc = OB.DOC_OF.get(s_(p.get("doc_id")))
    if doc is None:
        return W.refuse(400, "Unknown document: " + s_(p.get("doc_id")))
    found, refused = _own_row(sess)
    if refused:
        return refused
    fid = OB.field(found, doc["file"])
    if not fid:
        return W.refuse(400, "There is nothing here that we filed for you.")
    prep = p.get("prepared") if s_(p.get("trash")) == "kept" and isinstance(p.get("prepared"), dict) else {}
    if s_(prep.get("file_id")) != fid or prep.get("trashed") is not True:
        log.info("onboarding: %s cleared without Drive's bin", doc["id"])
    reads = sess.reads
    now = W.now_iso(reads)
    cells = {doc["file"]: "", doc["col"]: "", "updated_by": _who(sess), "updated_at": now}
    return _final(_flow(reads, OB.laid(found, cells)), _packet_facts(reads, found, cells, now), found["subject"])


# ---- the access window (onboardingSetWindow) ----------------------------------------------------------------------

def set_window(sess: L.Session, payload: dict) -> Decision:
    """onboardingSetWindow: a writer moves one edge of a person's window — writing one edge pins the other."""
    user = sess.user or {}
    if not OB.writer(user):
        return Decision(dict(OB.DENIED))
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("candidate_id"))
    if not cid:
        return W.refuse(400, "candidate_id is required")

    def days(key: str) -> float:
        m = re.match(r"^\s*[+-]?\d+", s_(p.get(key)))
        return int(m.group(0)) if m else math.nan
    ext, earlier = days("extend_days"), days("open_earlier_days")
    if (math.isnan(ext) or ext == 0) and (math.isnan(earlier) or earlier == 0):
        return W.refuse(400, "Send extend_days (later) or open_earlier_days (earlier).")
    reads = sess.reads
    row = OB.onboarding_row(reads, cid)
    if row is None:
        return W.refuse(404, "No onboarding row for " + cid + " yet.")
    w = OB.access_window(reads, row)
    if not w["from"] or not w["until"]:
        return W.refuse(400, "This person has no onboarding date to anchor a window to.")
    frm, until = CND.js_date_ms(w["from"]), CND.js_date_ms(w["until"])
    if not math.isnan(earlier) and earlier > 0:
        frm = CND._shift_days(frm, -int(earlier)).timestamp() * 1000.0
    if not math.isnan(ext) and ext > 0:
        until = CND._shift_days(until, int(ext)).timestamp() * 1000.0
    fields = {"access_from": CND.iso_ms(OB._bounds(CND._shift_days(frm, 0), False)),
              "access_until": CND.iso_ms(OB._bounds(CND._shift_days(until, 0), True))}
    now = W.now_iso(reads)
    recs = CW.facts_of(reads, CND.ONBOARDING_TAB, cid, fields, "runtime-sheet", cid, "", at=now)
    fresh = OB.access_window(reads, {**row, "accessfrom": fields["access_from"], "accessuntil": fields["access_until"]})
    log.info("onboarding: %s window %sd earlier / +%sd", cid, 0 if math.isnan(earlier) else earlier,
             0 if math.isnan(ext) else ext)
    return _final({"status": 200, "data": {"window_open": fresh["open"], "window_from": fresh["from"],
                                           "window_until": fresh["until"]}}, recs, cid)


# ---- the card: hold, release, Hired (Packet.gs packetHoldStart_ / packetHoldRelease_, HubCore.gs hubSetStatus_) ---

def _to_hired(sess: L.Session, cid: str, cand: dict, now: str) -> list[dict]:
    """hubSetStatus_ to Hired: the status, its history row, and the calendar's completion when it leaves Onboarding."""
    CW.marked(cand.get("status"), cand.get("candidatename"))
    recs = CW.status_move(sess, cid, cand, "hired", "", now)
    if CND.stage_of(cand.get("status")) == "onboarding":
        recs += CP.calendar_note(sess.reads, cid, s_(cand.get("candidatename")), now, False)
    return recs


def _hold_clear(reads: L.Reads, cid: str, now: str) -> list[dict]:
    """packetHoldClear_."""
    return CW.facts_of(reads, CW.CANDIDATES, cid, {HOLD_SINCE: "", HOLD_UNTIL: ""}, "runtime-sheet", cid, "", at=now)


def _hold_start(reads: L.Reads, cid: str, cand: dict | None, now: str) -> tuple[str, list[dict]]:
    """packetHoldStart_: the clock starts once — a card already held keeps its deadline."""
    open_ = s_((cand or {}).get("packetholduntil"))
    if open_:
        return open_, []
    hours = CND.cfg_int(reads, "packet_hold_hours", 24, 1, 336)
    until = gsjs.iso(reads.now + timedelta(hours=hours))
    if cand is None:
        return until, []
    return until, CW.facts_of(reads, CW.CANDIDATES, cid, {HOLD_SINCE: now, HOLD_UNTIL: until}, "runtime-sheet", cid,
                              "", at=now)


def _hold_release(sess: L.Session, cid: str, now: str) -> tuple[bool, str, list[dict]]:
    """packetHoldRelease_: a held card goes to Hired the moment its packet is on file; one that moved on its own only
    loses the stamp."""
    reads = sess.reads
    cand = CND.evidence(reads, cid).get("cand")
    if not cand or not s_(cand.get("packetholduntil")):
        return False, "", []
    stage = CND.stage_of(cand.get("status")) or ""
    if stage != "onboarding":
        return False, stage, _hold_clear(reads, cid, now)
    return True, "hired", _to_hired(sess, cid, cand, now) + _hold_clear(reads, cid, now)


def packet_upload(sess: L.Session, payload: dict) -> Decision:
    """obPacketUpload: the signed packet the relay filed (obPacketPrepare) set on the card its typed name resolves to,
    as a hand-attached packet, and a held card released; a packet no card matches stays on file for the recruiter."""
    shut = OB.lane(sess)
    if shut:
        return Decision(shut)
    p = payload if isinstance(payload, dict) else {}
    found, refused = _own_row(sess)
    if refused:
        return refused
    full = OB.field(found, "FullName")
    if not full:
        return W.refuse(400, OB.NAME_FIRST)
    if s_(p.get("base64")) != "kept":
        return W.refuse(503 if s_(p.get("base64")) else 400, "The file could not be saved — please try again.")
    prep = _prepared(p, "base64", found["subject"], OB.PACKET_DOC)
    if prep is None:
        return W.refuse(409, MISMATCH)
    reads = sess.reads
    now = W.now_iso(reads)
    by = _who(sess)
    url = OB.drive_url(s_(prep.get("drive_id")))
    recs = _packet_facts(reads, found, {"updated_by": by, "updated_at": now}, now)
    cid, why = CND.soft(lambda: OB.find_candidate_id(reads, full))
    if why or not cid:
        log.info("onboarding: %s uploaded their signed packet, but no card matches that name", full)
        return _final({"status": 200, "data": {"state": "unknown", "file_url": url, "released": False,
                                               "message": "Your packet is saved. Your recruiter will file it against "
                                                          "your record."}}, recs, found["subject"])
    fields = {"packet_waived_by": full + " — uploaded by the new hire in the portal", "packet_status": "waived",
              "packet_checked_at": now, "packet_srid": "file:" + s_(prep.get("drive_id"))}
    recs += CW.facts_of(reads, CW.CANDIDATES, cid, fields, by, cid, "", at=now)
    released, _stage, moved = _hold_release(sess, cid, now)
    recs += moved
    return _final({"status": 200, "data": {"state": "waived", "file_url": url, "released": released,
                                           "candidate_id": cid}}, recs, cid)


# ---- the end of a visit (Seat.gs seatRelease, seatResolveCandidate_, SEAT_COMPLETE_HOOKS; obReportWrite_) --------

def _resolve(reads: L.Reads, typed: str, bound: str) -> dict[str, str]:
    """seatResolveCandidate_: the typed name decides; the seat's bound id counts only when its name matches."""
    by_name, why = CND.soft(lambda: OB.find_candidate_id(reads, typed)) if typed else ("", "")
    if by_name and not why:
        if bound and bound != by_name:
            log.info("onboarding: %s → %s by name, but the seat was bound to %s — the name wins", typed, by_name, bound)
        return {"id": by_name, "how": "name"}
    if not bound:
        return {"id": "", "reason": f'no pipeline record matches "{typed or "this person"}"'}
    cand, _w = CND.soft(lambda: CND.evidence(reads, bound).get("cand"))
    bound_name = s_((cand or {}).get("candidatename"))
    if typed and bound_name and N.score(typed, bound_name) < N.NAME_MATCH_MIN:
        return {"id": "", "reason": f"the record linked to this screen belongs to {bound_name}, not to {typed} — a "
                                    "recruiter has to link the right one"}
    return {"id": bound, "how": "seat"}


def _report_lines(reads: L.Reads, row: dict, p: dict, pcid: str) -> dict[str, str]:
    """obReportLines_: the six lines; steps 5 and 6 come from the browser, absent they read "Not reported"."""
    cand, _w = CND.soft(lambda: CND.evidence(reads, pcid or OB.field(row, "CandidateId")).get("cand"))
    pk, _w2 = CND.soft(lambda: CND.packet_state(reads, cand))
    packet_on = s_((pk or {}).get("state")) in ("signed", "waived")
    full = OB.field(row, "FullName")
    prior = (OB.prior_submissions(reads, full).get("docs") or {}) if full else {}
    on_record = OB.canonical_have(reads, OB.field(row, "GradCandidateId") or pcid)
    missing = [d["label"] for d in OB.ID_DOCS
               if not OB.field(row, d["file"]) and not (d["cat"] and on_record.get(d["cat"]))
               and not (prior.get(d["prior"]) and prior[d["prior"]].get("url"))]
    q_ans, q_tot = p.get("questionnaire_answered"), p.get("questionnaire_total")
    t_seen, t_tot = p.get("tutorials_seen"), p.get("tutorials_total")
    have_q = q_ans is not None and not gsjs.falsy(q_tot)
    have_t = t_seen is not None and not gsjs.falsy(t_tot)
    seen_all = have_t and CND.js_number(t_seen) >= CND.js_number(t_tot)
    return {"step1": "Delivered" if packet_on else "Not Delivered",
            "step2": "Done" if CND.packet_truthy(OB.field(row, "BackgroundCheck")) else "Not Done",
            "step3": "Done" if not missing else "Missing " + ", ".join(missing),
            "step4": "Person Check as Done" if CND.packet_truthy(OB.field(row, "CompleteTraining")) else "Not Done",
            "step5": f"Answer {gsjs.js_str(q_ans)} from {gsjs.js_str(q_tot)}" if have_q else "Not reported",
            "step6": (f"See the {gsjs.js_str(t_tot)} videos." if seen_all
                      else f"Saw {gsjs.js_str(t_seen)} of {gsjs.js_str(t_tot)} videos.") if have_t else "Not reported"}


def _report(sess: L.Session, row: dict, name: str, bound: str, pcid: str, p: dict) -> list[dict]:
    """obReportWrite_: one onboarding_reports row for a finished visit, read off the row being released; nothing here
    sends — Smart Comms sweeps the rows. Never costs the visit."""
    reads = sess.reads
    try:
        cid = pcid or bound
        who = OB.field(row, "FullName") or name or OB.field(row, "CandidateName")
        phone = OB.field(row, "Phone") or OB.field(row, "CandidatePhone")
        email = OB.field(row, "CandidateEmail")
        if (not phone or not email) and cid:
            cand, _w = CND.soft(lambda: CND.evidence(reads, cid).get("cand"))
            phone = phone or s_((cand or {}).get("phone"))
            email = email or s_((cand or {}).get("email"))
        ln = _report_lines(reads, row, p, pcid)
        text = ("Onboarding Report" + (" - " + who if who else "") + "\n" +
                "Step 1 - New Hire Packet - " + ln["step1"] + "\n" +
                "Step 2 - Background Check - " + ln["step2"] + "\n" +
                "Step 3 - Upload Documents - " + ln["step3"] + "\n" +
                "Step 4 - Complete Training - " + ln["step4"] + "\n" +
                "Step 5 - Questionnaire - " + ln["step5"] + "\n" +
                "Step 6 - New Hire Tutorials - " + ln["step6"])
        rec = {"id": "OBR_" + uuid.uuid4().hex[:16].upper(), "createdAt": W.now_iso(reads), "candidate_id": cid,
               "full_name": who, "phone": phone, "email": email, "step1_packet": ln["step1"],
               "step2_background": ln["step2"], "step3_documents": ln["step3"], "step4_training": ln["step4"],
               "step5_questionnaire": ln["step5"], "step6_tutorials": ln["step6"], "report_text": text}
        # the tab never existed in the Hub's book: Postgres is the report's record from the first one
        RR.create(reads, REPORTS, {h: rec[h] for h in REPORT_HEADER}, _who(sess))
        return []
    except Exception as exc:  # noqa: BLE001 - a failed report must not cost somebody their onboarding
        log.warning("onboarding: the report was not written (%s: %s)", type(exc).__name__, str(exc)[:120])
        return []


def _complete(sess: L.Session, name: str, resolved: dict[str, str], now: str) -> tuple[dict[str, Any], list[dict]]:
    """SEAT_COMPLETE_HOOKS.onboarding: with the packet on file the card goes to Hired; without it the card is held at
    Onboarding until the packet arrives."""
    if not resolved.get("id"):
        return {"moved": False, "reason": resolved.get("reason", "")}, []
    reads = sess.reads
    cid = resolved["id"]
    cand = CND.evidence(reads, cid).get("cand")
    pk, why = CND.soft(lambda: CND.packet_state(reads, cand))
    state = "unknown" if why or not pk else s_(pk.get("state")) or "unknown"
    if state not in ("signed", "waived"):
        until, recs = _hold_start(reads, cid, cand, now)
        log.info("onboarding: %s — %s finished with the packet %s; held until %s", cid, name, state, until)
        return {"moved": False, "held": True, "hold_until": until, "candidate_id": cid, "stage": "onboarding",
                "packet_state": state, "reason": "the signed New Hire packet is not on file yet"}, recs
    if cand is None:
        return {"moved": False, "candidate_id": cid, "stage": "hired", "packet_state": state,
                "reason": "candidate " + cid + " is not on the board"}, []
    recs = _to_hired(sess, cid, cand, now) + _hold_clear(reads, cid, now)
    return {"moved": True, "candidate_id": cid, "stage": "hired", "packet_state": state, "reason": ""}, recs


def seat_release(sess: L.Session, payload: dict) -> Decision:
    """seatRelease: the visit ends — stamped finished only when completed (never twice), the seat's link cleared last;
    a finished visit writes its report and moves (or holds) the card. A flow with no seat (the interviewer's) releases
    nothing, for anyone."""
    if not sess.user:
        return Decision(dict(OB.DENIED))
    p = payload if isinstance(payload, dict) else {}
    name = s_(p.get("flow"))
    if name not in OB.SEAT_FLOWS:
        return W.refuse(400, f'Unknown seat flow: "{name}".')
    flow = OB.SEAT_FLOWS[name]
    if not flow:
        return Decision({"status": 200, "data": {"released": 0, "people": [], "server_side": False}})
    shut = OB.lane(sess)
    if shut:
        return Decision(shut)
    reads = sess.reads
    held = OB.held_rows(reads, sess.user)
    if not held:
        return Decision({"status": 200, "data": {"released": 0, "people": [], "server_side": True}})
    now = W.now_iso(reads)
    who = _who(sess)
    recs: list[dict] = []
    people: list[str] = []
    followed: list[dict] = []
    for row in held:
        typed = OB.field(row, flow["label"]) or OB.field(row, flow["label_fallback"])
        bound = OB.field(row, flow["seat_id"])
        try:
            resolved = _resolve(reads, typed, bound)
        except Exception:  # noqa: BLE001 - a wrongly stamped row is worse than none
            resolved = {"id": "", "reason": "the seat was released without resolving"}
        finishing = p.get("completed") is True and not OB.field(row, flow["finished"])
        cells: dict[str, str] = {}
        if finishing:
            cells[flow["finished"]] = now
        cells[flow["released_at"]] = now
        cells[flow["released_by"]] = who
        if finishing and resolved.get("id"):
            cells[flow["durable_id"]] = resolved["id"]
        if finishing:
            recs += _report(sess, OB.laid(row, cells), typed, bound, resolved.get("id", ""), p)
        cells[flow["seat_email"]] = ""
        cells[flow["seat_id"]] = ""
        recs += _packet_facts(reads, row, cells, now)
        people.append(typed or "(unnamed)")
        if finishing:
            try:
                got, more = _complete(sess, typed, resolved, now)
                recs += more
            except Exception as exc:  # noqa: BLE001 - reported, never rolled back
                got = {"moved": False, "reason": str(exc)[:200] or type(exc).__name__}
            followed.append(got)
    log.info("onboarding: seat_release %s · %s%s", name, ", ".join(people),
             " · completed" if p.get("completed") is True else " · handover")
    return _final({"status": 200, "data": {"released": len(held), "people": people, "server_side": True,
                                           "followed": followed}}, recs, "")


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "obSetName": set_name, "obStepDone": step_done, "obDocUpload": doc_upload, "obDocRemove": doc_remove,
    "obPacketUpload": packet_upload, "seatRelease": seat_release, "onboardingSetWindow": set_window,
    "onboardingUpload": RR.upload_door({CLEARANCE: SR.SPECS[CLEARANCE], REPORTS: SR.SPECS[REPORTS]})}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.onboarding_writes and app.onboarding_receipts, beside the other apps' own; a clearance row
    app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="onboarding", label="Onboarding")
