"""A résumé's writes (ResumeIntake.gs resumeStore, resumeParse, resumeAttach, resumeIntakeCommit; ResumeRubric.gs
resumeScorecardRun; ResumeInbox.gs resumeInboxImport) kept as the hiring records' facts in Postgres — the card, its
résumé link, its scorecard, the inbox's ledger — once their reading was prepared (app/resume_intake.py); a test line's
old screenings retired on the Comms mirror's ignored calls, the decoder's ledger row on form_files (app.edits)."""
from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Callable

import candidate_papers as CP
import candidate_writes as CDW
import candidates as CND
import gsjs
import hubdb
import locations as L
import resume_intake as RI
import screening as SG
import staff_views
import support_desk_writes as SDW
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

s_ = gsjs.str_
GUARD_KEY = "staff_guard_mode"
OPERATOR_LINE, OPERATOR_EMAIL = "3309195558", "asatech@asalifecare.com"


def _prepared(sess: L.Session, door: str, p: dict) -> dict[str, Any]:
    got = SG.unsealed(door, SG.actor(sess.user), p.get("prepared"))
    if got is None:
        raise Defer(f"{door} is recorded only after its reading was prepared by this service")
    return got


def _dissolved(reads: L.Reads, *tabs: str) -> None:
    for tab in tabs:
        if not reads.db.dissolved(tab):
            raise Defer(f"{tab} is not dissolved: its sheet is Apps Script's to write")


# ---- the staff roster's guard (ContactGuard.gs) --------------------------------------------------------------------

def guard_message(g: dict | None) -> str:
    """contactGuardMessage_: never asserts identity — a shared line does not prove who someone is."""
    if not g:
        return ""
    if g["severity"] == "unverified":
        return "Could not verify the staff roster right now — please try again."
    parts = []
    for h in g.get("hits") or []:
        names = list(dict.fromkeys(s_(pp.get("name")) for pp in h.get("people") or []))
        who = ", ".join(names[:3]) + (" and others" if len(names) > 3 else "")
        parts.append(("That phone number" if h.get("via") == "phone" else "That e-mail address")
                     + " is already on the staff roster (" + who + ")")
    return "; ".join(parts) + ". An admin or manager can override with a reason."


def guard(reads: L.Reads, user: dict, p: dict, phone: str, email: str, name: str) -> Decision | None:
    """contactGuard_ while the staff guard enforces: a staff contact never opens a card, unless an admin or manager
    overrides it with a reason; a rehearsal named [test] by a signed-in caller is never held."""
    if name.strip().lower().startswith("[test]"):
        return None
    g = SDW.contact_guard(reads, phone, email)
    mode = gsjs.trim(gsjs.or_blank(SDW.guard_config(reads).get(GUARD_KEY))).lower() or "shadow"
    if not g or g["severity"] == "warn" or mode != "enforce":
        return None
    if g["severity"] == "unverified":
        return Decision({"status": 503, "message": guard_message(g)})
    if not SG.writer(user) or len(s_(p.get("staff_conflict_override"))) <= 3:
        return Decision({"status": 409, "message": guard_message(g), "staff_conflict": True})
    staff_views.record(user, "staff_guard_override",
                       name + " — " + g["severity"] + ": " + s_(p.get("staff_conflict_override"))[:300])
    return None


# ---- what a card's opening writes --------------------------------------------------------------------------------

def operator_card(c: dict) -> bool:
    """commsIsOperatorCard_."""
    return SG.digits(c.get("phone"))[-10:] == OPERATOR_LINE or s_(c.get("email")).lower() == OPERATOR_EMAIL


def purge_operator_screens(reads: L.Reads, keep: str, by: str, now: str) -> list[dict]:
    """commsPurgeOperatorScreens_: a fresh run on the test identity — every other test-identity card's screening
    goes, the call it carried retired on the mirror's ignored calls."""
    cards = {s_(c.get("candidateid")) for c in CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB)
             if s_(c.get("candidateid")) and s_(c.get("candidateid")) != keep and operator_card(c)}
    if not cards:
        return []
    recs: list[dict] = []
    freed: list[str] = []
    removed = 0
    for sr in CND.read_tab(reads, CND.TALENT_PHONE_TAB):
        cid = s_(sr.get("candidateid"))
        if cid not in cards:
            continue
        recs += CDW.facts_of(reads, CDW.PHONE, cid, {"__deleted": "true"}, by, cid, "", at=now)
        removed += 1
        if s_(sr.get("transcriptcallid")):
            freed.append(s_(sr.get("transcriptcallid")))
    if freed:
        recs += retired(reads, freed, "test-lane reset by " + by, now, keep)
    if removed:
        staff_views.record({"email": by}, "test_lane_reset",
                           f"{removed} old test screening(s) on the test identity cleared")
    return recs


def retired(reads: L.Reads, calls: list[str], reason: str, at: str, subject: str) -> list[dict]:
    """ignored_calls' appendRow([id, reason, at]) per call, best effort: a tab the copy lacks keeps nothing."""
    try:
        sid, ref = SG.comms_ref(reads, "ignored_calls")
    except Exception:  # noqa: BLE001 - best effort, as Apps Script's
        return []
    if ref is None:
        return []
    heads = {hubdb.norm_key(h): gsjs.trim(gsjs.js_str(h)) for h in ref.headers if gsjs.trim(gsjs.js_str(h))}
    names = [heads.get(k) for k in ("callid", "reason", "addedat")]
    if any(n is None for n in names):
        return []
    return [W.kept_record(sid, ref.tab, "append", "cols:" + names[0], c, subject,
                          {names[0]: c, names[1]: reason, names[2]: at}) for c in calls]


def decode_row(reads: L.Reads, user: dict, fid: str, cid: str, name: str, filename: str, now: str) -> list[dict]:
    """pipelineQueueDecode_: the decoder's ledger row, anchored on the candidate's id; it never costs the card."""
    if not fid or not cid:
        return []
    try:
        res = None if CP.gate_holds(reads, CP.BOOK_GATE) else W.tab_of(reads, CP.FORM_FILES_TAB)
    except (Defer, hubdb.Unreadable) as why:
        log.info("resume intake: the decoder's ledger row is not written (%s)", str(why)[:120])
        return []
    if res is None or res.ref is None:
        return []
    row = {"form_slug": "(pipeline)", "submission_id": "", "field_key": "resume", "anchor_id": cid,
           "anchor_name": name, "file_id": fid, "file_url": "", "file_name": filename or "resume.bin",
           "mime_type": "", "size_bytes": "", "uploaded_by_name": s_(user.get("display_name") or user.get("name")),
           "uploaded_by_email": s_(user.get("email")), "digest_state": "pending", "digest_kind": "",
           "digest_category": "", "digest_dates": "", "digest_names": "", "digest_text_chars": "", "digest_text": "",
           "digest_json": "", "digest_error": "", "digested_at": "", "id": str(uuid.uuid4()), "createdAt": now,
           "updatedAt": now}
    header = tuple(gsjs.trim(gsjs.js_str(h)) for h in res.ref.headers if gsjs.trim(gsjs.js_str(h)))
    return [W.append_record(res, header, row, cid)]


def rubric_records(reads: L.Reads, cid: str, analysis: dict, by: str, source: str, now: str) -> list[dict]:
    """rubricWrite_: the scorecard appended on the candidate's resume analysis."""
    return CDW.facts_of(reads, CDW.RESUME, cid, RI.rubric_row(reads, cid, analysis, by, source, now), "append", cid,
                        "", at=now)


def commit(sess: L.Session, p: dict, rubric: dict | None,
           opened: list[dict] | None = None) -> tuple[dict[str, Any], list[dict]]:
    """resumeIntakeCommit: a parsed résumé becomes a candidate — first name, last name and phone are the floor, the
    e-mail wanted and never demanded; a match is reported, never absorbed (`opened`: the cards this pass opened
    already, which the copy does not hold yet)."""
    reads, user = sess.reads, sess.user or {}
    first, last = s_(p.get("first_name")), s_(p.get("last_name"))
    phone, email, link = s_(p.get("phone")), s_(p.get("email")).lower(), s_(p.get("resume_link"))
    why = RI.intake_check(first, last, phone, email)
    if why:
        return {"status": 400, "message": why}, []
    d = re.sub(r"^1", "", re.sub(r"\D", "", phone))
    d_key = "" if d in CND.SHARED_LINE_DIGITS else d
    dup = next(({"id": o["id"], "name": o["name"]} for o in opened or []
                if (d_key and o["digits"] == d_key) or (email and o["email"] == email)), None) or \
        RI.find_duplicate(reads, d, email)
    if dup:
        return {"status": 200, "data": {"candidate_id": dup["id"], "candidate_name": dup["name"],
                                        "matched_existing": True}}, []
    name = (first + " " + last).strip()
    held = guard(reads, user, p, phone, email, name)
    if held is not None:
        return dict(held.answer or {}), []
    _dissolved(reads, CDW.CANDIDATES, CDW.RESUME, CDW.PHONE)
    W.gate(reads)
    by = s_(user.get("email"))
    now = SG.iso_now(reads)
    cid = SG.hex_id("CAN_", 20)
    recs = CDW.facts_of(reads, CDW.CANDIDATES, cid, {
        "candidate_id": cid, "candidate_name": name, "first_name": first, "last_name": last, "phone": phone,
        "email": email, "city": s_(p.get("city")), "state": s_(p.get("state")), "status": "New",
        "resume_link": link, "created_at": now, "updated_at": now, "created_by": "asa-hub-resume:" + by},
        "append", cid, "", at=now)
    recs += CDW.facts_of(reads, CDW.RESUME, cid, {
        "candidate_id": cid,
        "summary": SG.strings(reads, "resume.on_file_summary",
                              {"file": s_(p.get("filename")) or SG.strings(reads, "resume.unnamed")}),
        "created_at": now, "updated_at": now, "created_by": "asa-hub:" + by}, "append", cid, "", at=now)
    if operator_card({"phone": phone, "email": email}):
        try:
            recs += purge_operator_screens(reads, cid, by, now)
        except (Defer, hubdb.Unreadable):
            raise
        except Exception as e:  # noqa: BLE001 - never blocks intake
            log.info("resume intake: the test line's old screenings were not retired (%s)", type(e).__name__)
    if rubric and rubric.get("analysis"):
        recs += rubric_records(reads, cid, rubric["analysis"], by, s_(rubric.get("fid")), now)
    fid = s_(p.get("file_id")) or RI.file_id_of(link)
    recs += decode_row(reads, user, fid, cid, name, s_(p.get("filename")) or "resume", now)
    if opened is not None:
        opened.append({"id": cid, "name": name, "digits": d_key, "email": email})
    return {"status": 200, "data": {"candidate_id": cid, "candidate_name": name, "matched_existing": False}}, recs


# ---- the doors ------------------------------------------------------------------------------------------------------

def store(sess: L.Session, payload: dict) -> Decision:
    """resumeStore: the file resumeStorePrepare filed and kept, answered fast."""
    if not SG.writer(sess.user):
        return Decision(dict(SG.DENIED))
    prep = _prepared(sess, "resumeStore", payload if isinstance(payload, dict) else {})
    return Decision({"status": 200, "data": {k: prep[k] for k in ("file_id", "resume_link", "filename")}})


def parse(sess: L.Session, payload: dict) -> Decision:
    """resumeParse: the file filed, and what of the identity its words left missing."""
    if not SG.writer(sess.user):
        return Decision(dict(SG.DENIED))
    prep = _prepared(sess, "resumeParse", payload if isinstance(payload, dict) else {})
    return Decision({"status": 200, "data": {k: prep[k] for k in ("resume_link", "filename", "extracted", "complete",
                                                                     "parsed")}})


def attach(sess: L.Session, payload: dict) -> Decision:
    """resumeAttach: the résumé on the matched candidate (a link already there is kept), then its scorecard when one
    was read."""
    reads, user = sess.reads, sess.user or {}
    if not SG.writer(user):
        return Decision(dict(SG.DENIED))
    p = payload if isinstance(payload, dict) else {}
    cid, link = s_(p.get("candidate_id")), s_(p.get("resume_link"))
    if not SG.CID.match(cid) or not link:
        return W.refuse(400, SG.strings(reads, "refuse.resume.attach_args"))
    prep = _prepared(sess, "resumeAttach", p)
    if prep.get("cid") != cid:
        raise Defer("the prepared reading names another candidate")
    _dissolved(reads, CDW.CANDIDATES, CDW.RESUME)
    cand = CDW.dissolved_rows(reads, CDW.CANDIDATES, [cid]).get(cid)
    if cand is None:
        return W.refuse(404, SG.strings(reads, "refuse.no_candidate", {"id": cid}))
    W.gate(reads)
    now = SG.iso_now(reads)
    recs: list[dict] = []
    if not s_(cand.get("resumelink")):
        recs += CDW.facts_of(reads, CDW.CANDIDATES, cid, {"resume_link": link}, "runtime-sheet", cid, "", at=now)
    rubric = prep.get("rubric") or {}
    if rubric.get("analysis"):
        recs += rubric_records(reads, cid, rubric["analysis"], s_(user.get("email")), s_(rubric.get("fid")), now)
    return W.final({"status": 200, "data": {"candidate_id": cid, "attached": True}}, recs, cid)


def intake_commit(sess: L.Session, payload: dict) -> Decision:
    """resumeIntakeCommit: the card opened (its scorecard as resumeIntakeCommitPrepare read it)."""
    if not SG.writer(sess.user):
        return Decision(dict(SG.DENIED))
    p = payload if isinstance(payload, dict) else {}
    prep = _prepared(sess, "resumeIntakeCommit", p)
    env, recs = commit(sess, p, prep.get("rubric"))
    if env.get("status") != 200:
        return Decision(env)
    return W.final(env, recs, s_((env.get("data") or {}).get("candidate_id")))


def scorecard_run(sess: L.Session, payload: dict) -> Decision:
    """resumeScorecardRun: the scorecard read for one candidate kept; never a gate."""
    reads, user = sess.reads, sess.user or {}
    if not SG.writer(user):
        return Decision(dict(SG.DENIED))
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("candidate_id"))
    if not cid:
        return W.refuse(400, "Missing required parameter: candidate_id.")
    prep = _prepared(sess, "resumeScorecardRun", p)
    if prep.get("cid") != cid:
        raise Defer("the prepared reading names another candidate")
    out = dict(prep.get("out") or {})
    if not out.get("scored") and out.get("reason") == "no such candidate":
        return W.refuse(404, 'No candidate "' + cid + '".')
    if not out.get("scored") and out.get("reason") == "no resume on file":
        return W.refuse(409, "No resume on file — the scorecard needs one.")
    recs: list[dict] = []
    analysis, fid = out.pop("analysis", None), out.pop("fid", "")
    if analysis:
        _dissolved(reads, CDW.RESUME)
        W.gate(reads)
        recs = rubric_records(reads, cid, analysis, s_(user.get("email")), s_(fid), SG.iso_now(reads))
    return W.final({"status": 200, "data": out}, recs, cid)


def _ledger(reads: L.Reads, person: dict, outcome: str, reason: str, cid: str, chars: Any, by: str,
            now: str) -> list[dict]:
    """resumeInboxRecord_: one reading of the folder per person; a ledger row that cannot be kept never undoes a
    card."""
    if not reads.db.dissolved(RI.INBOX_TAB):
        log.info("resume inbox: %s is not dissolved — the reading of %s is not ledgered", RI.INBOX_TAB,
                 s_(person.get("name")))
        return []
    fid = s_(person.get("fileId"))
    row = {"file_id": fid, "person_key": s_(person.get("key")), "person_name": s_(person.get("name")),
           "filename": s_(person.get("filename")), "file_modified_at": s_(person.get("modifiedTime")),
           "outcome": outcome, "reason": reason, "candidate_id": cid,
           "text_chars": "" if chars is None else str(chars), "read_at": now, "read_by": by}
    return CDW.facts_of(reads, RI.INBOX_TAB, fid, row, "append", cid or fid, "", at=now)


def inbox_import(sess: L.Session, payload: dict) -> Decision:
    """resumeInboxImport: each pick resumeInboxImportPrepare read becomes a card (or is said and ledgered why not),
    its scorecard kept; the ledger lets the next press resume."""
    reads, user = sess.reads, sess.user or {}
    if not SG.writer(user):
        return Decision(dict(SG.DENIED))
    p = payload if isinstance(payload, dict) else {}
    prep = _prepared(sess, "resumeInboxImport", p)
    entries = prep.get("read") or []
    if not prep.get("picks"):
        return Decision({"status": 200, "data": {"imported": [], "skipped": [], "message": "Nothing new to import."}})
    W.gate(reads)
    by = s_(user.get("email"))
    now = SG.iso_now(reads)
    imported, skipped, recs = [], [], []
    opened: list[dict] = []
    for e in entries:
        person = e.get("p") or {}
        if e.get("skip"):
            skipped.append({"name": person.get("name"), "fileId": person.get("fileId"), "why": e["skip"]})
            if e.get("ledger"):
                recs += _ledger(reads, person, e["ledger"], e["skip"], "", e.get("chars", 0), by, now)
            continue
        scored = e.get("scored") or {}
        env, made = commit(sess, e.get("commit") or {}, None, opened)
        if env.get("status") == 200 and env.get("data"):
            data = env["data"]
            cid = s_(data.get("candidate_id"))
            recs += made
            if cid:
                recs += rubric_records(reads, cid, scored, by, s_(person.get("fileId")), now)
            imported.append({"name": person.get("name"), "candidate_id": cid,
                             "matchedExisting": bool(data.get("matched_existing")),
                             "score": s_((scored.get("fields") or {}).get("composite_score")),
                             "recommendation": scored.get("recommendation"), "scoring": scored.get("status")})
            recs += _ledger(reads, person, "attached" if data.get("matched_existing") else "imported",
                            "" if s_(scored.get("status")) == "ok" else "not scored: " + s_(scored.get("status")), cid,
                            e.get("chars"), by, now)
        else:
            why = s_(env.get("message")) or "the create door refused"
            skipped.append({"name": person.get("name"), "why": why})
            recs += _ledger(reads, person, "refused", why, "", e.get("chars"), by, now)
    ran_out, seconds = int(prep.get("ran_out") or 0), int(prep.get("seconds") or 0)
    staff_views.record(user, "resume_inbox_import", f"{len(imported)} imported, {len(skipped)} skipped, {ran_out} out "
                                                    f"of time ({seconds}s)")
    message = (f"{len(imported)} imported" + (f", {len(skipped)} left for a person" if skipped else "") + "."
               + (f" {ran_out} did not start — the pass ran out of time. Press again to continue." if ran_out else ""))
    return W.final({"status": 200, "data": {"imported": imported, "skipped": skipped, "outOfTime": ran_out,
                                            "seconds": seconds, "message": message}}, recs, "")


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "resumeStore": store, "resumeParse": parse, "resumeAttach": attach, "resumeIntakeCommit": intake_commit,
    "resumeScorecardRun": scorecard_run, "resumeInboxImport": inbox_import}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["resumeScorecardRun"] = {"params": {"candidate_id": "string"}}
POLICY["resumeInboxImport"] = {"params": {"limit": "number", "fileIds": "string"}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.resume_intake_writes and app.resume_intake_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="resume_intake", label="Résumé intake")
