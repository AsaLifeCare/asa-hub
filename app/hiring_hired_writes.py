"""Hired's writes (Hired.gs) kept in Postgres: hiredStart, hiredGraduateRun, hiringOnboardingFinishAsk, and the last
column's clock — each sweep the relay rings after its look (hiring_hired) — as the hiring rows' facts, every message
through Smart Comms. The staff account a graduation makes (hubHiredGraduate_) and the onboarding login
(onboardingEnsureUser_) are hiring_accounts_writes'."""
from __future__ import annotations

import logging
import re
import time
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import hiring_hired as HH
import hubdb
import locations as L
import mail_designs as MD
import recon as R
import resource_rows as RR
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")
s_ = HH.s_
# a sweep stops here and leaves the rest for the next ring (the write decides within WRITE_BUDGET_S)
SWEEP_BUDGET_S = 4.0
STALE = "The look this sweep was rung with is not this service's, or it is too old — nothing was written."


def _ev(reads: L.Reads, cid: str) -> dict:
    return CND.evidence(reads, cid)


def _done(answer: dict[str, Any], recs: list[dict], subject: str = "", own: bool = False) -> Decision:
    kept = [e for e in recs if e and e.get("cells")]
    if not kept and not own:
        return Decision(answer)
    return Decision(answer, edits=kept or None, subject=subject, own=own)


# ---- hiredStart -----------------------------------------------------------------------------------------------------

def hired_start(sess: L.Session, payload: dict) -> Decision:
    """hiredStart: a manager begins the activities of a card at Ready to start, and it leaves the board."""
    user = sess.user or {}
    if not HH.writer(user):
        return Decision(dict(HH.DENIED))
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("candidate_id"))
    if not HH.CAN_ID.match(cid):
        return W.refuse(400, "invalid candidate_id")
    reads = sess.reads
    cand = _ev(reads, cid).get("cand")
    if not cand:
        return W.refuse(404, f'No candidate "{cid}".')
    if CND.stage_of(cand.get("status")) != "ready":
        return W.refuse(409, 'Only a card at Ready to start can begin activities — this one is at "' +
                        s_(cand.get("status")) + '".')
    now = W.now_iso(reads)
    recs = HH.card_facts(reads, cid, {"archived": "true"}, s_(user.get("email")), now)
    log.info("hired_start: %s — activities started; card left the board", s_(cand.get("candidatename")))
    return _done({"status": 200, "data": {"started": True}}, recs, cid)


# ---- the Hired stay's first pass and its congratulation (hubHiredSweep_, hiredCongratsMaybe_) -----------------------

def congrats(sess: L.Session, cid: str, cand: dict) -> list[dict]:
    """hiredCongratsMaybe_: hired with everything green — the candidate told by letter and text, once."""
    reads = sess.reads
    sid = HH.sit_id(reads, HH.CONGRATS)
    sit = HH.situation_on(reads, sid)
    if sit is None:
        return []
    seen = CND.journey_for(reads, cid)
    if seen is None or any(s_(j.get("step")) == "hired_congrats" for j in seen):
        return []
    name = s_(cand.get("candidatename")) or cid
    v = {"first_name": HH.greet_first(name), "name": name}
    recs: list[dict] = []
    sent_any = False
    email = s_(cand.get("email"))
    by = "asa-hub:hired-congrats"
    if "@" in email:
        body = HH.render(s_(sit.get("email_text")), v)
        out, more = HH.outreach_send(reads, {
            "candidate_id": cid, "name": name, "step": "hired_congrats", "to": email, "cc": HH.cc_for(reads, email),
            "letter": {"subject": HH.render(s_(sit.get("email_subject")), v) or
                       HH.words(reads, "hired_congrats.subject.floor"),
                       "text": body, "html": HH.letter_html(reads, body, "hired_congrats")},
            "situation": sid, "key": "hired_congrats_mail_" + cid, "by": by})
        recs += more
        sent_any = sent_any or out["sent"]
    sms = HH.render(s_(sit.get("sms_text")), v)
    if sms:
        out, more = HH.outreach_sms(reads, {
            "candidate_id": cid, "name": name, "step": "hired_congrats", "to": s_(cand.get("phone")), "body": sms,
            "intro": HH.quo_intro(reads, HH.words(reads, "purpose.hired_congrats")), "situation": sid,
            "key": "hired_congrats_sms_" + cid, "by": by})
        recs += more
        sent_any = sent_any or out["sent"]
    recs += HH.journey(reads, cid, name, {
        "step": "hired_congrats", "channel": "email+sms", "ok": sent_any,
        "title": "Congratulated — hired" if sent_any else "The congratulation could not go out",
        "detail": "told by letter and text: hired, and our team makes the next contact" if sent_any
        else "neither leg went out — it retries on the next graduation pass", "by": by})
    return recs


def stay_pass(sess: L.Session) -> tuple[dict[str, Any], list[dict]]:
    """hubHiredSweep_ up to the graduation: the one-day clock started on each card new at Hired, the congratulation
    when nothing is owed; the team's alert is raised from the stamp (team_alerts). A card whose day ran out graduates
    in hiring_accounts_writes, where its staff account is made."""
    reads = sess.reads
    plan = HH.hired_stay_plan(reads)
    by_id = {s_(c.get("candidateid")): c for c in HH.cands(reads)}
    started = time.time()
    recs: list[dict] = []
    stamped = 0
    for cid in plan["first"]:
        if time.time() - started > SWEEP_BUDGET_S:
            break
        c = by_id[cid]
        now = W.now_iso(reads)
        recs += HH.card_facts(reads, cid, {"hired_complete_at": now}, "auto-graduate", now)
        facts = HH.hired_facts(reads, c)
        if not facts["missing"]:
            try:
                recs += congrats(sess, cid, c)
            except (Defer, hubdb.Unreadable) as why:
                log.warning("hired congrats: %s — %s", cid, str(why)[:160])
        stamped += 1
        log.info("hired_complete: %s — %s%s", cid, s_(c.get("candidatename")),
                 " (test card; team not notified)" if HH.is_test(reads, c) else
                 ("; MISSING: " + " | ".join(facts["missing"])[:300] if facts["missing"] else "; all green"))
    return {"stamped": stamped, "graduating": plan["graduating"]}, recs


def hired_stay_sweep(sess: L.Session, payload: dict) -> Decision:
    """The Hired stay's first pass on the relay's clock."""
    if not HH.service(sess):
        return Decision(dict(HH.SERVICE_ONLY))
    out, recs = stay_pass(sess)
    return _done({"status": 200, "data": out}, recs)


# ---- the exit to Ready to start (hubBecomingStaffSweep_) -----------------------------------------------------------

def becoming_pass(sess: L.Session) -> tuple[dict[str, Any], list[dict]]:
    """hubBecomingStaffSweep_: a graduated card whose account is armed and whose Employee Database row is written moves
    to Ready to start once the team has been told (a rehearsal leaves quietly)."""
    reads = sess.reads
    plan = HH.becoming_plan(reads)
    by_id = {s_(c.get("candidateid")): c for c in HH.cands(reads)}
    moved, waiting = 0, plan["waiting"]
    recs: list[dict] = []
    started = time.time()
    for cid in plan["ready"]:
        if time.time() - started > SWEEP_BUDGET_S:
            break
        c = by_id[cid]
        name = s_(c.get("candidatename"))
        test = HH.is_test(reads, c)
        told, held_why = True, ""
        if not test:
            sid = HH.sit_id(reads, HH.READY_DONE)
            sit = HH.situation_on(reads, sid)
            if sit is None:
                log.info("ready_alert_skipped: %s — %s: situation_off (%s)", cid, name, sid)
            else:
                v = {"name": name}
                fallback = HH.words(reads, "ready_done.body.floor")
                subject = HH.render(s_(sit.get("email_subject")) or HH.words(reads, "ready_done.subject.floor"), v)
                sms = HH.render(s_(sit.get("sms_text")) or s_(sit.get("email_text")) or fallback, v)
                mail = HH.render(s_(sit.get("email_text")) or s_(sit.get("sms_text")) or fallback, v)
                letter = MD.hiring_notice_email({"title": subject, "preheader": HH.words(reads, "ready_done.preheader"),
                                                 "bodyText": mail})
                reach = HH.tell_team(reads, sid, "ready_to_start|" + cid, subject, sms, mail, letter["html"])
                told = reach["done"]
                held_why = reach["state"] + (": " + reach["why"] if reach["why"] else "")
        if not told:
            log.warning("staff_complete_not_announced: %s — %s: finished, but no alert reached anybody (%s); card kept",
                        cid, name, (held_why or "no answer")[:160])
            waiting += 1
            continue
        now = W.now_iso(reads)
        recs += HH.move(sess, cid, c, "ready", "auto-becoming-staff", now)
        moved += 1
        log.info("staff_complete: %s — %s: account armed, Employee Database written, %s; card moved to Ready to start",
                 cid, name, "test card (team not notified)" if test else "team notified")
    return {"archived": moved, "still_waiting": waiting}, recs


def becoming_sweep(sess: L.Session, payload: dict) -> Decision:
    if not HH.service(sess):
        return Decision(dict(HH.SERVICE_ONLY))
    out, recs = becoming_pass(sess)
    return _done({"status": 200, "data": out}, recs)


# ---- hiredGraduateRun ---------------------------------------------------------------------------------------------

def graduate_run(sess: L.Session, payload: dict) -> Decision:
    """hiredGraduateRun: the last column's two passes on demand — the Hired stay with its graduations (the staff
    account, hiring_accounts_writes) and the exit to Ready to start."""
    import hiring_accounts_writes as HAW  # noqa: PLC0415 - it imports the hiring store, which imports this module
    user = sess.user or {}
    if not user or s_(user.get("role")) != "admin":
        return Decision(dict(HH.DENIED))
    out: dict[str, Any] = {"graduated": None, "completed": None}
    recs: list[dict] = []
    try:
        _got, more = stay_pass(sess)
        recs += more
        out["accounts"], more = HAW.graduate_pass(sess)
        recs += more
        out["graduated"] = "ran"
    except (Defer, hubdb.Unreadable) as why:
        out["graduated"] = "failed: " + str(why)[:200]
    try:
        out["completed"], more = becoming_pass(sess)
        recs += more
    except (Defer, hubdb.Unreadable) as why:
        out["completed"] = "failed: " + str(why)[:200]
    log.info("hired_graduate_run: %s", str(out)[:200])
    return _done({"status": 200, "data": out}, recs)


# ---- the Ready watch (readyToStartSweepMaybe_) ---------------------------------------------------------------------

def ready_watch_sweep(sess: L.Session, payload: dict) -> Decision:
    """A card at Ready to start found with a schedule on the Shift Board leaves the board by itself."""
    if not HH.service(sess):
        return Decision(dict(HH.SERVICE_ONLY))
    reads = sess.reads
    plan = HH.ready_watch_plan(reads)
    names = {s_(c.get("candidateid")): s_(c.get("candidatename")) for c in HH.cands(reads)}
    recs: list[dict] = []
    for f in plan["found"]:
        now = W.now_iso(reads)
        recs += HH.card_facts(reads, f["cid"], {"archived": "true"}, "asa-hub:ready-watch", now)
        recs += HH.journey(reads, f["cid"], names.get(f["cid"], ""), {
            "step": "ready", "channel": "record", "ok": True, "by": "asa-hub:ready-watch",
            "detail": "found on the Shift Board with a schedule (" + f["on_board"] +
                      ") — Ready to Start released by itself"})
        log.info("ready_to_start_released: %s — %s is scheduled on the Shift Board", f["cid"], names.get(f["cid"], ""))
    return _done({"status": 200, "data": {"released": len(plan["found"]), "unreadable": bool(plan.get("unreadable"))}},
                 recs)


# ---- the parking notices (readyParkedSweepMaybe_, readyParkedNotify_) -----------------------------------------------

def _team_letters(reads: L.Reads, sid: str, to: str, cc: str, subject: str, body: str, html: str, key: str,
                  name: str) -> bool:
    """One rpcCall_('emailSend') to a list: a letter per address, the copy list on each."""
    sent = False
    for addr in [a.strip() for a in to.split(",") if a.strip()]:
        got = HH.send(reads, situation=sid, to=addr, body=body, key=key + "|" + addr.lower(), channel="email",
                      subject=subject, html=html, cc=cc, person=name)
        sent = HH.went(got) or sent
    return sent


def _decider_texts(reads: L.Reads, sid: str, numbers: list[str], body: str, key: str, name: str) -> bool:
    sent = False
    for n in numbers:
        got = HH.send(reads, situation=sid, to=n, body=body, key=key + "_" + "".join(ch for ch in n if ch.isdigit()),
                      person=name)
        sent = HH.went(got) or sent
    return sent


def parked_notify(sess: L.Session, c: dict, cid: str, since: str, attempt: int, of: int) -> list[dict]:
    """readyParkedNotify_: the deciders told, letter and Quo together, then the book and the journey."""
    reads = sess.reads
    lane = HH.Lane(reads, HH.PARKED)
    if not lane.on:
        return []
    name = s_(c.get("candidatename"))
    since_ms = HH.ms_of(since) or HH.now_ms(reads)
    days = max(1, int((HH.now_ms(reads) - since_ms) // HH.DAY_MS))
    day = CND.iso_day(since) or since[:10]
    rehearsal = HH.is_test(reads, c)
    addr = HH.team_address(reads) if rehearsal else None
    to = (addr or {}).get("to") or ", ".join(HH.team_emails(reads))
    link = MD.mail_platform_url() + "/app/hiring/candidate?id=" + cid

    def fill(t: str) -> str:
        return t.replace("{name}", name).replace("{days}", str(days)).replace("{since}", day).replace("{link}", link)
    v = {"name": name, "days": str(days), "since": day, "link": link}
    subject = lane.word("email_subject", fill(HH.sim_text(reads, "ready_parked_subject")) or
                        fill(HH.words(reads, "ready_parked.subject.floor")), v)
    body = lane.word("email_text", fill(HH.sim_text(reads, "ready_parked_body")) or
                     fill(HH.words(reads, "ready_parked.body.floor")), v)
    html = MD.mail_shell({
        "eyebrow": "ASA Hub — Hiring", "title": fill(HH.words(reads, "ready_parked.title")),
        "preheader": fill(HH.words(reads, "ready_parked.preheader")),
        "blocks": [MD.mail_fact(HH.words(reads, "notice.fact.candidate"), name),
                   MD.mail_fact(HH.words(reads, "ready_parked.fact.since_label"), day + " — " + str(days) + " days"),
                   MD.mail_para(HH.words(reads, "ready_parked.para"))],
        "cta": {"label": HH.words(reads, "notice.cta.open_candidate"), "href": link},
        "footnote": HH.words(reads, "ready_parked.footnote").replace("{attempt}", str(attempt)).replace("{of}", str(of))})
    sent = False
    if to and lane.leg("email"):
        sent = _team_letters(reads, HH.PARKED, to, (addr or {}).get("cc", ""),
                             HH.tag_subject(reads, subject) if rehearsal else subject, body, html,
                             f"ready_parked_mail_{cid}_{attempt}", name)
    numbers = HH.actors(reads)["decider_sms"] if lane.leg("sms") else []
    sms = lane.word("sms_text", fill(HH.sim_text(reads, "ready_parked_sms")) or
                    (name + " has been at Ready to Start for " + str(days) + " days with nobody scheduling them. "
                     "Nothing to answer — this stops when they are on the Shift Board."), v)
    sent = _decider_texts(reads, HH.PARKED, numbers, sms, f"ready_parked_sms_{cid}_{attempt}", name) or sent
    now = W.now_iso(reads)
    recs = HH.sim_track(reads, "ready_parked", cid, "", {"candidate_id": cid}, now)
    recs += HH.journey(reads, cid, name, {
        "step": "ready_parked", "channel": "email+sms", "ok": sent, "rehearsal": rehearsal, "by": "asa-hub:ready-parked",
        "detail": ("parked at Ready to Start since " + day + " (" + str(days) + " days) — the deciders were told "
                   "(letter + Quo), notice " + str(attempt) + " of " + str(of) + "; the clock is renewed for another turn")
        if sent else "parked at Ready to Start since " + day + " — the notice could not leave"})
    return recs


def parked_sweep(sess: L.Session, payload: dict) -> Decision:
    """readyParkedSweepMaybe_ on the relay's clock: armed once (only arrivals after it count), the asks whose card
    left closed, and each card parked past the clock told about."""
    if not HH.service(sess):
        return Decision(dict(HH.SERVICE_ONLY))
    reads = sess.reads
    plan = HH.parked_plan(reads)
    if not plan["on"]:
        return Decision({"status": 200, "data": {"on": False, "why": plan.get("why", "")}})
    if not plan["armed_at"]:
        armed = W.now_iso(reads)
        HH.mark_set(HH.PARKED_ARMED, armed)
        log.info("ready_parked_machine_armed: only people who reach Ready to Start after %s enter the parking clock",
                 armed)
        return _done({"status": 200, "data": {"armed_at": armed, "told": 0, "closed": 0}}, [], own=True)
    now = W.now_iso(reads)
    recs: list[dict] = []
    for cid in plan["closing"]:
        recs += HH.sim_answer(reads, ["ready_parked"], "the card left Ready to Start — the machine lets go", cid, now)
    by_id = {s_(c.get("candidateid")): c for c in HH.cands(reads)}
    told = 0
    for d in plan["due"]:
        try:
            recs += parked_notify(sess, by_id[d["cid"]], d["cid"], d["since"], d["sent"] + 1, plan["of"])
            told += 1
        except (Defer, hubdb.Unreadable) as why:
            log.warning("ready_parked_notify_failed: %s — %s", d["cid"], str(why)[:160])
    return _done({"status": 200, "data": {"told": told, "closed": len(plan["closing"])}}, recs)


# ---- the deciders' ready ask (onboardingDoneAskSweepMaybe_) ---------------------------------------------------------

def ready_ask_sweep(sess: L.Session, payload: dict) -> Decision:
    """Onboarding finished → the deciders asked, letter and Quo together, whether to move the card to Ready to start
    (seven times, not once)."""
    if not HH.service(sess):
        return Decision(dict(HH.SERVICE_ONLY))
    reads = sess.reads
    plan = HH.ready_ask_plan(reads)
    if not plan["on"]:
        return Decision({"status": 200, "data": {"on": False, "why": plan.get("why", "")}})
    lane = HH.Lane(reads, HH.READY_ASK)
    by_id = {s_(c.get("candidateid")): c for c in HH.cands(reads)}
    recs: list[dict] = []
    asked = 0
    started = time.time()
    for d in plan["due"]:
        if time.time() - started > SWEEP_BUDGET_S:
            break
        cid = d["cid"]
        c = by_id[cid]
        name = s_(c.get("candidatename"))
        rehearsal = HH.is_test(reads, c)
        addr = HH.team_address(reads) if rehearsal else None
        to = (addr or {}).get("to") or ", ".join(HH.team_emails(reads))
        if not to:
            continue
        notes = "New Hire Questionnaire: done · Tutorials: done" + (
            " · Employee Database: written" if s_(c.get("internaldocsat")) else "")
        iv, _w = CND.soft(lambda cid=cid: CND.interview_for(reads, cid))
        if CND.interview_scored(iv):
            notes += (" · Interview: " + s_(iv.get("score")) + "/10 by " + s_(iv.get("interviewername")) +
                      (" — " + s_(iv.get("recommendation")) if s_(iv.get("recommendation")) else ""))
        ob, _w2 = CND.soft(lambda cid=cid: CND.onboarding_row(reads, cid))
        if ob and s_(ob.get("notes")):
            notes += " · Notes: " + s_(ob.get("notes"))
        link = MD.mail_platform_url() + "/app/hiring/candidate?id=" + cid

        def fill(t: str, name: str = name, notes: str = notes, link: str = link) -> str:
            return t.replace("{name}", name).replace("{notes}", notes).replace("{link}", link)
        v = {"name": name, "notes": notes, "link": link}
        subject = lane.word("email_subject", fill(HH.sim_text(reads, "ready_ask_subject")) or
                            fill(HH.words(reads, "ready_ask.subject.floor")), v)
        body = lane.word("email_text", fill(HH.sim_text(reads, "ready_ask_body")) or
                         fill(HH.words(reads, "ready_ask.body.floor")), v)
        html = MD.mail_shell({
            "eyebrow": "ASA Hub — Hiring", "title": fill(HH.words(reads, "ready_ask.title")),
            "preheader": HH.words(reads, "ready_ask.preheader"),
            "blocks": [MD.mail_fact(HH.words(reads, "notice.fact.candidate"), name),
                       MD.mail_fact(HH.words(reads, "ready_ask.fact.notes_label"), notes),
                       MD.mail_para(HH.words(reads, "ready_ask.para"))],
            "cta": {"label": HH.words(reads, "notice.cta.open_candidate"), "href": link},
            "footnote": HH.words(reads, "ready_ask.footnote")})
        sent = False
        n = d["sent"] + 1
        if lane.leg("email"):
            sent = _team_letters(reads, HH.READY_ASK, to, (addr or {}).get("cc", ""),
                                 HH.tag_subject(reads, subject) if rehearsal else subject, body, html,
                                 f"ready_ask_mail_{cid}_{n}", name)
        numbers = HH.actors(reads)["decider_sms"] if lane.leg("sms") else []
        sms = lane.word("sms_text", HH.sim_text(reads, "ready_ask_sms").replace("{name}", name).replace("{link}", link)
                        or (name + " finished onboarding — may I move them to Ready to Start? A YES here does it."), v)
        sent = _decider_texts(reads, HH.READY_ASK, numbers, sms, f"ready_ask_sms_{cid}_{n}", name) or sent
        now = W.now_iso(reads)
        if sent:
            recs += HH.sim_track(reads, "ready_ask", cid, "", {"candidate_id": cid}, now)
            asked += 1
        recs += HH.journey(reads, cid, name, {
            "step": "ready_ask", "channel": "email+sms", "ok": sent, "rehearsal": rehearsal, "by": "asa-hub:ready-ask",
            "detail": ("onboarding finished — the deciders were asked (letter + Quo together): may I move " + name +
                       " to Ready to Start? A YES makes the move by itself") if sent
            else "onboarding finished but the ask could not leave"})
    return _done({"status": 200, "data": {"asked": asked, "due": len(plan["due"])}}, recs)


# ---- the deciders' answer (readyAskScanRun_, readyApprovalStamp_) --------------------------------------------------

def approval_stamp(reads: L.Reads, cid: str, cand: dict, by: str, now: str) -> list[dict]:
    """readyApprovalStamp_: the interview score and the onboarding results on the profile, once, blanks only."""
    if s_(cand.get("approvedreadyat")):
        return []
    iv, _w = CND.soft(lambda: CND.interview_for(reads, cid))
    ob, _w2 = CND.soft(lambda: CND.onboarding_done(reads, cand))
    result = ("New Hire Questionnaire: " + ("done" if ob and ob.get("q") else "open") + " · Tutorials: " +
              ("done" if ob and ob.get("t") else "open") +
              (" · Employee Database: written" if s_(cand.get("internaldocsat")) else ""))
    fields = {"interview_score": s_((iv or {}).get("score")), "interview_recommendation": s_((iv or {}).get(
        "recommendation")), "interview_by": s_((iv or {}).get("interviewername")), "onboarding_result": result,
        "approved_ready_at": now, "approved_ready_by": s_(by)}
    keep = {k: v for k, v in fields.items() if not s_(cand.get(k.replace("_", "")))}
    return HH.card_facts(reads, cid, keep, "asa-hub:ready-ask-ear", now) if keep else []


def ready_ear_sweep(sess: L.Session, payload: dict) -> Decision:
    """A decider's YES moves the card to Ready to start and stamps the approval; a NO archives the profile (no letter
    to the candidate). The inbound log is the inbound lane's; no conversation is pulled here."""
    if not HH.service(sess):
        return Decision(dict(HH.SERVICE_ONLY))
    reads = sess.reads
    plan = HH.ready_ear_plan(reads)
    out = {"checked": plan["checked"], "moved": 0, "stays": 0}
    recs: list[dict] = []
    by_id = {s_(c.get("candidateid")): c for c in HH.cands(reads)}
    ear = "asa-hub:ready-ask-ear"
    for v in plan["verdicts"]:
        cid, by = v["cid"], v["by"]
        cand = by_id.get(cid)
        name = s_((cand or {}).get("candidatename"))
        now = W.now_iso(reads)
        if v["verdict"] == "yes":
            out["moved"] += 1
            if cand:
                recs += HH.move(sess, cid, cand, "ready", ear, now)
            recs += HH.sim_answer(reads, ["ready_ask"], "a decider answered YES (" + by + ") — moved to Ready to Start",
                                  cid, now)
            recs += HH.journey(reads, cid, name, {
                "step": "ready_ask", "channel": "sms", "ok": True, "by": ear,
                "detail": "the decider said YES — moved to Ready to Start by the word alone; the Shift Board watch "
                          "takes it from here"})
            stamp = approval_stamp(reads, cid, cand, by, now) if cand else []
            if stamp:
                recs += stamp + HH.journey(reads, cid, name, {
                    "step": "ready_ask", "channel": "record", "ok": True, "by": ear,
                    "detail": "the interview score and the onboarding results are stamped on the profile"})
            recs += HH.journey(reads, cid, name, {
                "step": "ready_ask", "channel": "record", "ok": True, "by": ear,
                "detail": "the Asa Employee Database (Master) write follows on the sweep's arm — blanks only, a row a "
                          "person started is left alone, a rehearsal never touches the real book"})
        else:
            out["stays"] += 1
            recs += HH.sim_answer(reads, ["ready_ask"],
                                  "a decider answered NO (" + by + ") — the profile moves to the Archive", cid, now)
            recs += HH.card_facts(reads, cid, {"archived": "TRUE", "archived_at": now, "archived_by": ear,
                                               "archived_reason": "A decider said NO to Ready to Start"}, ear, now)
            recs += HH.journey(reads, cid, name, {
                "step": "ready_ask", "channel": "sms", "ok": True, "by": ear,
                "detail": "the decider said NO — the profile moves to the Archive (a click on the name still opens the "
                          "whole person)"})
    return _done({"status": 200, "data": out}, recs)


# ---- the finish-your-onboarding ladder (hiringOnboardingFinishAsk, onboardingFinishSweepMaybe_) -------------------

def _password(reads: L.Reads) -> str:
    """ONBOARDING_USER_PASSWORD (or FIRST_USER_PASSWORD) as this service holds it; the copy withholds it."""
    for key in ("ONBOARDING_USER_PASSWORD", "FIRST_USER_PASSWORD"):
        v = s_(reads.db.prop(key))
        if v and not v.startswith("[withheld"):
            return v
    return ""


def finish_ask(sess: L.Session, cid: str, by: str) -> tuple[dict[str, Any], list[dict]]:
    """hiringOnboardingFinishAsk's body: a stalled onboarding asked to finish, the login link and first password in
    the letter; the card moved on or finished lets the machine go."""
    reads = sess.reads
    cand = _ev(reads, cid).get("cand")
    if not cand:
        return {"status": 404, "message": f'No candidate "{cid}".'}, []
    sid = HH.sit_id(reads, HH.FINISH)
    sit = HH.situation_on(reads, sid)
    if sit is None:
        return {"status": 200, "data": {"sent": False, "reason": "situation_off"}}, []
    now = W.now_iso(reads)
    if HH.archived(cand) or CND.stage_of(cand.get("status")) != "onboarding":
        return ({"status": 200, "data": {"sent": False, "reason": "card_moved_on"}},
                HH.sim_answer(reads, ["onboarding_finish"], "the card moved on — the machine lets go", cid, now))
    ob = CND.onboarding_done(reads, cand)
    if ob.get("q") and ob.get("t"):
        return ({"status": 200, "data": {"sent": False, "reason": "already_done"}},
                HH.sim_answer(reads, ["onboarding_finish"], "the onboarding is finished", cid, now))
    email = s_(cand.get("email"))
    if "@" not in email:
        return {"status": 200, "data": {"sent": False, "reason": "no_email"}}, []
    name = s_(cand.get("candidatename"))
    first = HH.greet_first(name)
    pw = _password(reads)

    def fill(t: str) -> str:
        return (s_(t).replace("{first_name}", first).replace("{name}", name)
                .replace("{login_link}", HH.words(reads, "onboarding_finish.login_link"))
                .replace("{password}", pw or HH.words(reads, "onboarding_finish.password.floor")))
    subject = fill(s_(sit.get("email_subject"))) or HH.words(reads, "onboarding_finish.subject.floor")
    body = fill(s_(sit.get("email_text")))
    html = MD.mail_shell({"eyebrow": "ASA LifeCare", "title": HH.words(reads, "onboarding_finish.title"),
                          "preheader": HH.words(reads, "onboarding_finish.preheader"),
                          "blocks": [MD.mail_para(MD.mail_esc(p).replace("\n", "<br>")) for p in re.split(r"\n{2,}", body)],
                          "cta": None, "footnote": HH.words(reads, "onboarding_finish.footnote")})
    out, recs = HH.outreach_send(reads, {
        "candidate_id": cid, "name": name, "step": "onboarding_finish", "to": email, "cc": HH.cc_for(reads, email),
        "letter": {"subject": subject, "text": body, "html": html}, "situation": sid,
        "key": f"ob_finish_mail_{cid}_{int(HH.now_ms(reads))}", "by": by})
    if out["sent"]:
        recs += HH.sim_track(reads, "onboarding_finish", cid, "hiringOnboardingFinishAsk", {"candidate_id": cid}, now)
    return {"status": 200, "data": {"sent": out["sent"]}}, recs


def finish_ask_door(sess: L.Session, payload: dict) -> Decision:
    """hiringOnboardingFinishAsk."""
    user = sess.user or {}
    if not HH.writer(user):
        return Decision(dict(HH.DENIED))
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("candidate_id"))
    if not HH.CAN_ID.match(cid):
        return W.refuse(400, "invalid candidate_id")
    answer, recs = finish_ask(sess, cid, s_(user.get("email")))
    return _done(answer, recs, cid)


def finish_sweep(sess: L.Session, payload: dict) -> Decision:
    """onboardingFinishSweepMaybe_ on the relay's clock: the first press (never minutes after the login letter), the
    team told once about a ladder that ran out, and a parked one restarted on the team's "tente mais" the next Ohio
    morning — after onboardingFinishDue read the mailbox."""
    if not HH.service(sess):
        return Decision(dict(HH.SERVICE_ONLY))
    p = payload if isinstance(payload, dict) else {}
    if p.get("prepared") is None:
        raise Defer("onboardingFinishSweep is read by onboardingFinishDue first")
    prep = R.unsealed("onboardingFinishSweep", "service", p.get("prepared"))
    if prep is None:
        return W.refuse(409, STALE)
    if not prep.get("on"):
        return Decision({"status": 200, "data": {"on": False}})
    reads = sess.reads
    actor = HH.as_actor(sess, "ob-finish@service.local")
    by_id = {s_(c.get("candidateid")): c for c in HH.cands(reads)}
    recs: list[dict] = []
    pressed = told = 0
    for cid in prep.get("first") or []:
        got, more = finish_ask(actor, cid, "ob-finish@service.local")
        recs += more
        pressed += 1 if (got.get("data") or {}).get("sent") else 0
    stall_sid = HH.sit_id(reads, HH.STALLED)
    st_sit = HH.situation_on(reads, stall_sid)
    for cid in prep.get("stalled") or []:
        if st_sit is None:
            continue
        c = by_id.get(cid) or {}
        name = s_(c.get("candidatename")) or cid
        now = W.now_iso(reads)
        reh = HH.is_test(reads, c)
        addr = HH.team_address(reads) if reh else None
        # a letter to each address the Desk's `to` names; the hiring team's only while that cell is blank
        import screening_writes as SGW  # noqa: PLC0415 - the Desk's own `to`, as the screen report reads it
        to = (addr or {}).get("to") or ", ".join(d for d in SGW.desk_to(st_sit, HH.team_emails(reads)) if "@" in d)
        if to:
            subject = s_(st_sit.get("email_subject")).replace("{name}", name)
            _team_letters(reads, stall_sid, to, (addr or {}).get("cc", ""), HH.tag_subject(reads, subject),
                          s_(st_sit.get("email_text")).replace("{name}", name), "", "ob_stalled_mail_" + cid, name)
        recs += HH.sim_answer(reads, ["onboarding_finish"], "the team was told — waiting for their word", cid, now)
        recs += HH.journey(reads, cid, name, {
            "step": "onboarding_finish", "channel": "email", "ok": True, "by": "asa-hub:ob-finish",
            "title": "The team was told — onboarding begun and abandoned",
            "detail": 'seven finish-your-onboarding letters went unanswered; a reply of "tente mais" restarts a fresh '
                      "seven the next Ohio morning"})
        told += 1
    tente = prep.get("tente") if isinstance(prep.get("tente"), dict) else {}
    now_ms = HH.now_ms(reads)
    for pk in prep.get("parked") or []:
        word_at = float(tente.get(pk["cid"]) or 0)
        last = HH.ms_of(pk.get("since"))
        if not word_at or (last is not None and word_at <= last) or not HH.ohio_morning_after(word_at, now_ms):
            continue
        got, more = finish_ask(actor, pk["cid"], "ob-finish@service.local")
        recs += more
        if (got.get("data") or {}).get("sent"):
            pressed += 1
            recs += HH.journey(reads, pk["cid"], pk["name"], {
                "step": "onboarding_finish", "channel": "record", "ok": True, "by": "asa-hub:ob-finish",
                "title": "Tente mais — a fresh seven begins",
                "detail": "the team asked for another round; it starts this Ohio morning"})
    if not pressed and not told:
        log.info("ob-finish: nobody at Onboarding is standing still — each one is finished, unminted, already in the "
                 "ask book, or parked awaiting the team")
    return _done({"status": 200, "data": {"pressed": pressed, "told": told}}, recs)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "hiredStart": hired_start, "hiredGraduateRun": graduate_run, "hiringOnboardingFinishAsk": finish_ask_door,
    "hiredStaySweep": hired_stay_sweep, "becomingStaffSweep": becoming_sweep, "readyWatchSweep": ready_watch_sweep,
    "readyParkedSweep": parked_sweep, "readyAskSweep": ready_ask_sweep, "readyEarSweep": ready_ear_sweep,
    "onboardingFinishSweep": finish_sweep}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["hiringOnboardingFinishAsk"] = {"params": {"candidate_id": "string"}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


def ddl() -> tuple[str, ...]:
    """The marks Apps Script kept in Script Properties (db/hiring_hired.sql), made here too."""
    return (f"create table if not exists {HH.MARKS} (key text primary key, value text not null default '',"
            " updated_at timestamptz not null default now())",
            f"grant select on {HH.MARKS} to asa_hub_app_ro")


class Store(RR.Store):
    """app.hiring_writes and app.hiring_receipts, beside the other apps' own; the marks app.hiring_marks."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="hiring", label="Hiring")
        self._own = False

    def ensure(self) -> str:
        why = super().ensure()
        if why or self._own:
            return why
        with self._lock:
            if self._own:
                return ""
            try:
                c = self.conn()
                for stmt in ddl():
                    c.execute(stmt)
                self._own = True
            except Exception as exc:  # noqa: BLE001 - said on /healthz; the doors defer meanwhile
                self._drop()
                self._ready = False
                self.why = f"the hiring marks are not ready ({type(exc).__name__}: {str(exc)[:120]})"
        return self.why
