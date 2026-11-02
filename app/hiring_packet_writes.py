"""The New Hire packet's writes (Packet.gs; Hired.gs hubPacketHoldSweep_) kept as the hiring rows' facts: the packet
attached by hand and retracted (packetWaive, packetUnwaive), an envelope bound by a person (packetBind), the name
check of a packet a recruiter attached (packetAttach, after its prepare read filed and read it), the request to sign it
(packetRequestRun, and its sweep on the relay's clock) through Smart Comms, and the hold released when it lands."""
from __future__ import annotations

import logging
import time
from typing import Any, Callable

import candidate_papers as CP
import candidate_writes as CW
import candidates as CND
import hiring_hired as HH
import hiring_packet as HP
import hubdb
import locations as L
import mail_designs as MD
import onboarding_writes as OBW
import recon as R
import smart_comms as SC
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")
s_ = CND.s_
STALE = "The file this answer rests on was not filed by this service just now — attach it again."
SWEEP_BUDGET_S = 4.0


def _cid(p: dict) -> str:
    return s_(p.get("candidate_id"))


def _done(answer: dict[str, Any], recs: list[dict], subject: str = "") -> Decision:
    return W.final(answer, recs, subject)


# ---- the manual lane (packetWaive, packetUnwaive, packetBind) ------------------------------------------------------

def waive(sess: L.Session, payload: dict) -> Decision:
    """packetWaive: the signed packet attached by hand, and the hold released the moment it is."""
    if not HH.writer(sess.user):
        return Decision(dict(HH.DENIED))
    p = payload if isinstance(payload, dict) else {}
    cid = _cid(p)
    if not HH.CAN_ID.match(cid):
        return W.refuse(400, "invalid candidate_id")
    env, recs = CP.packet_waive(sess, cid, s_(p.get("note")), s_(p.get("file_id")), "")
    if env.get("status") != 200:
        return Decision(env)
    log.info("packet_waive: %s — %s", cid, CW.js_slice(s_(p.get("note")), 200))
    return _done(env, recs, cid)


def unwaive(sess: L.Session, payload: dict) -> Decision:
    """packetUnwaive: an attestation given by mistake retracted — the card is checked again."""
    user = sess.user or {}
    if not HH.writer(user):
        return Decision(dict(HH.DENIED))
    p = payload if isinstance(payload, dict) else {}
    cid = _cid(p)
    if not HH.CAN_ID.match(cid):
        return W.refuse(400, "invalid candidate_id")
    reads = sess.reads
    now = W.now_iso(reads)
    recs = HH.card_facts(reads, cid, {"packet_waived_by": "", "packet_status": "", "packet_srid": ""},
                         s_(user.get("email")), now)
    log.info("packet_unwaive: %s", cid)
    return _done({"status": 200, "data": {"candidate_id": cid, "state": "recheck"}}, recs, cid)


def bind(sess: L.Session, payload: dict) -> Decision:
    """packetBind: the envelope a person chose bound to the card — one envelope, one card — and a signed one releases
    the hold; an unsigned one only names the signature still awaited."""
    user = sess.user or {}
    if not HH.writer(user):
        return Decision(dict(HH.DENIED))
    p = payload if isinstance(payload, dict) else {}
    cid = _cid(p)
    if not HH.CAN_ID.match(cid):
        return W.refuse(400, "invalid candidate_id")
    srid = s_(p.get("srid"))
    if not srid:
        return W.refuse(400, "Which envelope? An srid is required.")
    reads = sess.reads
    env = None
    for r in CND.packet_rows(reads):
        if s_(r.get("signaturerequestid")) == srid:
            env = r
    if env is None:
        return W.refuse(404, "No envelope " + srid + " in the contracts mirror. Run the recruitment sync if it was "
                                                    "signed in the last few minutes.")
    try:
        every = HH.cands(reads)
    except (Defer, hubdb.Unreadable, RuntimeError):
        return W.refuse(502, "The candidate tab could not be read, so it is not possible to tell whether this envelope "
                             "belongs to somebody else. Nothing was changed.")
    clash = ""
    for c in every:
        if s_(c.get("packetsrid")) == srid and s_(c.get("candidateid")) != cid:
            clash = s_(c.get("candidatename")) or s_(c.get("candidateid"))
    if clash:
        return W.refuse(409, "That envelope is already bound to " + clash +
                        ". Unbind it there first — one signature cannot be two people's.")
    status = s_(env.get("status")).lower()
    by = s_(user.get("email"))
    now = W.now_iso(reads)
    note = s_(p.get("note"))
    state = "signed" if status == "signed" else "unsigned"
    fields = {"packet_srid": srid, "packet_status": state,
              "packet_matched_by": "confirmed by " + by + (" — " + note[:200] if note else ""),
              "packet_checked_at": now}
    recs = HH.card_facts(reads, cid, fields, by, now)
    log.info('packet_bind: %s → %s (%s, envelope names "%s")', cid, srid, status, s_(env.get("candidate")))
    released, stage = False, ""
    if status == "signed":
        released, stage, more = OBW._hold_release(sess, cid, now)
        recs += more
    return _done({"status": 200, "data": {
        "candidate_id": cid, "srid": srid, "state": state, "name_on_envelope": s_(env.get("candidate")),
        "released": released, "stage": stage,
        "message": "Bound and released — the signed packet is on file." if status == "signed"
        else "Bound. The envelope is " + status + ", so the card stays held until it is signed."}}, recs, cid)


# ---- the name check of a packet attached by hand (packetAttach) ---------------------------------------------------

def attach(sess: L.Session, payload: dict) -> Decision:
    """packetAttach: what packetAttachPrepare filed and read, answered — nothing is bound to a card here; the intake
    form carries the file id into packetWaive."""
    user = sess.user or {}
    if not HH.writer(user):
        return Decision(dict(HH.DENIED))
    p = payload if isinstance(payload, dict) else {}
    if s_(p.get("base64")) != "kept" or p.get("prepared") is None:
        raise Defer("packetAttach is read by packetAttachPrepare first")
    prep = R.unsealed("packetAttach", R.actor(user), p.get("prepared"))
    if prep is None or not HP._FILE_ID.fullmatch(s_(prep.get("file_id"))) or not HP.kept_dir(
            s_(prep.get("file_id"))).is_dir():
        return W.refuse(409, STALE)
    expected, v, found = s_(prep.get("expected")), s_(prep.get("verdict")), s_(prep.get("name_in_document"))
    log.info("packet_attach: %s — %s%s", expected, v, f' (document reads "{found}")' if found and v == "mismatch" else "")
    return Decision({"status": 200, "data": {
        "file_id": s_(prep.get("file_id")), "verdict": v, "name_in_document": found, "where": s_(prep.get("where")),
        "message": "The document names " + expected + "." if v == "match"
        else 'The document appears to name "' + found + '", not ' + expected + ". Attach it anyway if you know it is "
                                                                              "right." if v == "mismatch"
        else "The document could not be read automatically — nothing was checked."}})


# ---- the request to sign it (packetRequestSweep_, packetRequestRun) -----------------------------------------------

def _packet_words(reads: L.Reads, sit: dict | None, name: str) -> dict[str, str]:
    """rpcPacketMessage_ and rpcPacketEmail_: the situation's words, the shipped ones under an empty cell."""
    v = {"name": name}
    row = sit or {}
    subject = HH.render(s_(row.get("email_subject")) or "Your signed New Hire packet — ASA Lifecare", v)
    body = HH.render(s_(row.get("email_text")) or ("Hi DSP,\n\nTo finish your onboarding we still need your signed New "
                                                    "Hire packet.\nPlease check your inbox for your New Hire packet and "
                                                    "complete it.\n\nASA Lifecare"), v)
    sms = HH.render(s_(row.get("sms_text")) or ("Hi DSP, this is ASA Lifecare. To finish your onboarding we still need "
                                                 "your signed New Hire packet. Please check your inbox for your New Hire "
                                                 "packet and complete it."), v)
    return {"subject": subject, "body": body, "sms": sms,
            "html": MD.packet_request_email({"subject": subject, "bodyText": body})["html"]}


def request_pass(sess: L.Session) -> tuple[dict[str, Any], list[dict]]:
    """packetRequestSweep_: everybody at Onboarding without the packet asked, once per rung — by text and by letter;
    a rehearsal reaches the nominated rehearsal number only. The row is stamped after a send, never before."""
    reads = sess.reads
    plan = HP.request_plan(reads)
    if plan.get("none"):
        return {"asked": 0, "alerted": 0, "skipped": 0}, []
    sid = plan["situation"]
    if not plan["on"]:
        log.info("packet_request_situation_off: hiring_packet_request is OFF — nobody is asked this pass")
    sit = HH.situation_on(reads, sid)
    by_id = {s_(c.get("candidateid")): c for c in HH.cands(reads)}
    asked = skipped = 0
    would_ask: list[str] = []
    recs: list[dict] = []
    started = time.time()
    for card in plan["cards"]:
        if card.get("skip"):
            skipped += 1
            continue
        if time.time() - started > SWEEP_BUDGET_S or sit is None:
            break
        cid = card["cid"]
        c = by_id[cid]
        name = s_(c.get("candidatename"))
        rehearsal = HH.is_rehearsal(reads, c)
        to = HP.rehearsal_number(reads) if rehearsal else SC.sendable(c.get("phone"))
        mail_to = s_(c.get("email")) if "@" in s_(c.get("email")) else ""
        if rehearsal and mail_to and not HH.test_on(reads):
            log.info("packet_request_rehearsal_email_skipped: %s — %s: a rehearsal only e-mails while test mode is on",
                     cid, name)
            mail_to = ""
        if rehearsal and not to and not mail_to:
            skipped += 1
            log.info("packet_request_rehearsal_no_target: %s — %s: set %s in Settings, or switch test mode on",
                     cid, name, HP.REHEARSAL_KEY)
            continue
        if not to and not mail_to:
            skipped += 1
            log.info("packet_request_no_contact: %s — %s: no number we can text and no e-mail address", cid, name)
            continue
        n = card["sent"] + 1
        w = _packet_words(reads, sit, name)
        legs: list[tuple[str, dict]] = []
        if to:
            legs.append(("sms", HH.send(reads, situation=sid, to=to, body=w["sms"], key=f"packet_request_{cid}_{n}",
                                        person=name)))
        if mail_to:
            legs.append(("email", HH.send(reads, situation=sid, to=mail_to, body=w["body"],
                                          key=f"packet_request_mail_{cid}_{n}", channel="email", subject=w["subject"],
                                          html=w["html"], person=name)))
        went, failed, rehearsed, gated = [], [], [], False
        for label, got in legs:
            if HH.rehearsed(got):
                rehearsed.append(label)
            elif s_(got.get("state")) == "already":
                went.append(label + " (already sent)")
            elif s_(got.get("state")) == "sent":
                went.append(label)
            elif s_(got.get("state")) == "held":
                gated = True
            else:
                failed.append(label + ": " + HH.why_not(got))
        if went:
            now = W.now_iso(reads)
            recs += HH.card_facts(reads, cid, {"packet_requested_at": now}, "auto-packet-request", now)
            recs += HH.sim_track(reads, "packet_request", cid, "", {"candidate_id": cid}, now)
            asked += 1
            log.info("packet_requested: %s — %s by %s (try %d of %d)%s", cid, name, " + ".join(went), n, card["of"],
                     " — " + "; ".join(failed) + " did NOT go" if failed else "")
        elif rehearsed:
            log.info("packet_request_test_only: %s — %s: %s reached the rehearsal book, so the row was NOT stamped",
                     cid, name, " + ".join(rehearsed))
        elif gated:
            would_ask.append(name)
            log.info("packet_request_would_send: %s — %s: held by a brake", cid, name)
        else:
            skipped += 1
            log.warning("packet_request_failed: %s — %s: %s", cid, name, "; ".join(failed))
    return {"asked": asked, "alerted": 0, "skipped": skipped,
            "recorded_not_sent": {"asked": would_ask, "alerted": []}}, recs


def request_run(sess: L.Session, payload: dict) -> Decision:
    """packetRequestRun: the request sweep, on purpose (admins)."""
    user = sess.user or {}
    if not user or s_(user.get("role")) != "admin":
        return Decision(dict(HH.DENIED))
    out, recs = request_pass(sess)
    log.info("packet_request_run: asked %s, alerted %s, skipped %s", out["asked"], out["alerted"], out["skipped"])
    return _done({"status": 200, "data": out}, recs)


def request_sweep(sess: L.Session, payload: dict) -> Decision:
    """The request sweep on the relay's clock."""
    if not HH.service(sess):
        return Decision(dict(HH.SERVICE_ONLY))
    out, recs = request_pass(sess)
    return _done({"status": 200, "data": out}, recs)


# ---- the one door out of the hold (hubPacketHoldSweep_) -----------------------------------------------------------

def hold_sweep(sess: L.Session, payload: dict) -> Decision:
    """A held card whose signed packet is on file now: the conclusion frozen on the card (packetStamp_), the card
    moved to Hired, the hold's stamps wiped."""
    if not HH.service(sess):
        return Decision(dict(HH.SERVICE_ONLY))
    reads = sess.reads
    plan = HP.hold_plan(reads)
    by_id = {s_(c.get("candidateid")): c for c in HH.cands(reads)}
    recs: list[dict] = []
    who = "auto-packet-hold"
    for h in plan["release"]:
        cid, res = h["cid"], h["res"]
        c = by_id[cid]
        now = W.now_iso(reads)
        stamp = {"packet_status": res["state"], "packet_checked_at": now}
        if res["srid"]:
            stamp["packet_srid"] = res["srid"]
        if res["by"]:
            stamp["packet_matched_by"] = res["by"]
        if res["signed"]:
            stamp["packet_signed_at"] = res["signed"]
        recs += HH.card_facts(reads, cid, stamp, who, now)
        recs += HH.move(sess, cid, c, "hired", who, now)
        recs += HH.card_facts(reads, cid, {"packet_hold_since": "", "packet_hold_until": ""}, who, now)
        log.info("packet_hold_released: %s — %s: packet %s%s — moved to Hired", cid, s_(c.get("candidatename")),
                 res["state"], f" (matched by {res['by']})" if res["by"] else "")
    return _done({"status": 200, "data": {"released": len(plan["release"])}}, recs)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "packetWaive": waive, "packetUnwaive": unwaive, "packetBind": bind, "packetAttach": attach,
    "packetRequestRun": request_run, "packetRequestSweep": request_sweep, "packetHoldSweep": hold_sweep}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}
