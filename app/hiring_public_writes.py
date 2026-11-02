"""The Hiring pipeline's public pages' writes (InterviewFlow.gs interviewSlotSubmitPub_, interviewSlotsSubmitPub_,
interviewDaysSubmitPub_; CandidateForm.gs candFormSubmitPub_; Referrals.gs referralSubmit_) kept as the hiring rows'
facts: the candidate's pick on their personal calendar — asked of the interviewer, or booked when it is one of the
times she offered — the interviewer's own slots and days from her link, a decision or a gated move pressed on a
candidate's shared form, and a referral from the login page. Each answers as nobody, the link's token or the
referral's throttle its gate (hiring_public); every message is raised through Smart Comms."""
from __future__ import annotations

import json
import logging
import re
import secrets
from datetime import date, timedelta
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import gsjs
import hiring_board as HB
import hiring_board_writes as HBW
import hiring_hired as HH
import hiring_intake_writes as HIW
import hiring_public as HP
import hubdb
import interview_flow as IF
import interview_flow_writes as IFW
import locations as L
import mail_designs as MD
import recon as R
import staff_views
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")
s_ = CND.s_
# the accounts Apps Script pressed the scheduler's own doors as (HUB_ACTIONS.<door>(…, actor))
SLOTS_ACTOR = {"role": "manager", "email": "interview-slots@service.local", "id": "SVC_INTERVIEW_SLOTS"}
DAYS_ACTOR = {"role": "manager", "email": "interview-days@service.local", "id": "SVC_INTERVIEW_DAYS"}
# candFormShareUser_: a link-only identity — it signs no phone screen for anybody
SHARE_USER = {"role": "manager", "email": "shared-form-link", "display_name": "Shared form link", "id": "",
              "is_service": False}
SUPERVISOR_ASK = ("hiring.interview.supervisor_request", "interview_supervisor_ask")
LOG_ACTOR = "interview:public"
_DAY = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def _line(action: str, detail: str, status: int = 200) -> None:
    """hubSysLog_('interview:public', …)."""
    log.info("%s %s: %s", LOG_ACTOR, action, detail[:300])
    staff_views.record({"email": LOG_ACTOR}, action, detail, status)


def _lay(reads: L.Reads, ask_id: str, fields: dict[str, Any], now: str) -> None:
    """What this write just wrote on an ask, laid on the request's own copy of the ask book, so a door it presses
    in-process reads it as Apps Script's re-read the sheet."""
    hit = None
    for r in IF.ask_rows(reads):
        if s_(r.get("askid")) == ask_id:
            hit = r
    if hit is not None:
        hit.update({hubdb.norm_key(k): s_(v) for k, v in {**fields, "updated_at": now}.items()})


def _write(reads: L.Reads, rows: list[dict], ask_id: str, fields: dict[str, Any], now: str) -> list[dict]:
    """interviewAskWrite_: the ask patched, here and on the request's copy."""
    recs = IFW.ask_write(reads, rows, ask_id, fields, now)
    _lay(reads, ask_id, fields, now)
    return recs


def _rows(reads: L.Reads) -> list[dict]:
    return [dict(r) for r in IF.ask_rows(reads)]


# ---- the interviewer asked about the candidate's pick (interviewSupervisorAsk_) ------------------------------------

def candidate_facts(cand: dict | None, analysis: dict | None) -> list[dict[str, str]]:
    """hiringCandidateFacts_: what a letter can print about somebody."""
    c, a = cand or {}, analysis or {}
    where = ", ".join(x for x in (s_(c.get("city")), s_(c.get("state"))) if x)
    out = []
    if s_(c.get("phone")):
        out.append({"label": "Phone", "value": s_(c.get("phone"))})
    if s_(c.get("email")):
        out.append({"label": "E-mail", "value": s_(c.get("email"))})
    if where:
        out.append({"label": "Where", "value": where})
    if s_(a.get("compositescore")):
        out.append({"label": "Resume score", "value": s_(a.get("compositescore")) + " / 10"})
    if s_(c.get("source")):
        out.append({"label": "Source", "value": s_(c.get("source"))})
    return out


def availability_email(o: dict[str, Any]) -> dict[str, str]:
    """interviewerAvailabilityEmail_: an override replaces only the intro — the reply is read for YES or NO."""
    interviewer = s_(o.get("interviewer"))
    first = re.split(r"\s+", interviewer)[0] if interviewer else ""
    name, slot = s_(o.get("name")), s_(o.get("slot"))
    facts = o.get("facts") or []
    body_text = s_(o.get("bodyText"))
    link = gsjs.or_blank(o.get("link"))
    blocks = MD.mail_body_blocks(body_text) if body_text else [
        MD.mail_para(("Hi " + MD.mail_esc(first) + "," if first else "Hello,") + " <strong>" + MD.mail_esc(name) +
                     "</strong> chose a time for their in-person interview and we need your word before it is booked.")]
    blocks.append(MD.mail_fact("They chose", slot or "a time on their calendar"))
    for f in facts:
        blocks.append(MD.mail_fact(gsjs.or_blank(f.get("label")), gsjs.or_blank(f.get("value"))))
    blocks.append(MD.mail_para("<strong>Reply YES if that works and we book it, or NO and we will ask you for three "
                               "times that suit you better.</strong>"))
    text = ((body_text or ("Hi " + first + "," if first else "Hello,") + "\n\n" + name + " chose a time for their "
             "in-person interview and we need your word before it is booked.") + "\n\nThey chose: " +
            (slot or "a time on their calendar") + "\n" +
            "\n".join(gsjs.or_blank(f.get("label")) + ": " + gsjs.or_blank(f.get("value")) for f in facts) +
            "\n\nReply YES if that works and we book it, or NO and we will ask you for three times that suit you "
            "better.\n" + ("\n" + link + "\n" if link else ""))
    return {"subject": s_(o.get("subject")) or ("Can you interview " + name + (" — " + slot if slot else "") + "?"),
            "text": text,
            "html": MD.mail_shell({
                "eyebrow": IF.HIRING_EYEBROW, "title": "Does this interview time work?",
                "preheader": name + " chose " + (slot or "a time") + " — yes or no is all we need.", "blocks": blocks,
                "cta": {"label": "Open the candidate", "href": link} if link else None,
                "footnote": "You are being asked because you hold the INTERVIEWER badge on the platform. A reply of YES "
                            "books the meeting on the hiring calendar and tells the candidate."})}


def supervisor_ask(reads: L.Reads, ask: dict, day: str, tm: str) -> tuple[dict[str, Any], list[dict]]:
    """interviewSupervisorAsk_: '<candidate> picked <slot> — YES or NO', by letter (the candidate's facts beside it)
    and by text, to whoever holds the INTERVIEWER badge — or the simulation's interviewer for a rehearsal."""
    sid = HH.sit_id(reads, SUPERVISOR_ASK)
    sit = HH.situation_on(reads, sid)
    if sit is None:
        return {"sent": False, "reason": "situation_off"}, []
    sup = IF.supervisor_for(reads, ask)
    if not s_(sup.get("email")) and not s_(sup.get("phone")):
        return {"sent": False, "reason": "no_interviewer",
                "detail": s_(sup.get("by")) or "nobody holds the INTERVIEWER badge"}, []
    cid, name, ask_id = s_(ask.get("candidateid")), s_(ask.get("candidatename")), s_(ask.get("askid"))
    slot = IF.slot_label(day, tm)
    v = {"candidate": name, "slot": slot}
    reh = IF.is_rehearsal_ask(ask)
    out: dict[str, Any] = {"sent": False, "emailed": False, "smsed": False, "redirected": False,
                           "interviewer": s_(sup.get("name")), "resolved_by": s_(sup.get("by")), "failures": []}
    if s_(sup.get("email")):
        ev, why = CND.soft(lambda: CND.evidence(reads, cid))
        facts = [] if why else candidate_facts((ev or {}).get("cand"), (ev or {}).get("analysis"))
        letter = availability_email({
            "interviewer": sup.get("name"), "name": name, "slot": slot, "facts": facts,
            "subject": HH.render(s_(sit.get("email_subject")), v),
            "bodyText": HH.render(s_(sit.get("email_text")), v) if s_(sit.get("email_text")) else ""})
        got = HH.send(reads, situation=sid, to=sup["email"], body=letter["text"],
                      key=f"iask_sup_mail_{ask_id}_{day}T{tm}", channel="email",
                      subject=HH.tag_subject(reads, letter["subject"]) if reh else letter["subject"],
                      html=letter["html"], cc=HH.cc_for(reads, sup["email"]) if reh else "", person=name)
        if IFW.ok_sent(got):
            out.update(emailed=True, sent=True, redirected=out["redirected"] or HH.rehearsed(got))
        else:
            out["failures"].append("email: " + HH.why_not(got))
    if s_(sup.get("phone")):
        got = HH.send(reads, situation=sid, to=sup["phone"],
                      body=HH.render(s_(sit.get("sms_text")) or IF.FALLBACK["supervisor_ask"], v),
                      key=f"iask_sup_{ask_id}_{day}T{tm}", person=name)
        if IFW.ok_sent(got):
            out.update(smsed=True, sent=True, redirected=out["redirected"] or HH.rehearsed(got))
        else:
            out["failures"].append("sms: " + HH.why_not(got))
    recs = HH.journey(reads, cid, name, {
        "step": "interviewer_ask",
        "channel": ("email" if out["emailed"] else "") + (("+sms" if out["emailed"] else "sms") if out["smsed"] else ""),
        "to": s_(sup.get("email")) or s_(sup.get("phone")), "ok": out["sent"], "rehearsal": out["redirected"],
        "detail": "asked " + (s_(sup.get("name")) or "the badge holder") + " about " + slot + " (" +
                  s_(sup.get("by")) + ")" + (" · " + " · ".join(out["failures"]) if out["failures"] else ""),
        "ref": ask_id, "by": "asa-hub:interview-flow"})
    if not out["sent"]:
        out["reason"] = " · ".join(out["failures"]) or "send_failed"
    return out, recs


def auto_yes(sess: L.Session, rows: list[dict], today: str) -> list[dict]:
    """simAutoInterviewerYes_: a rehearsal's interviewer actor answers YES by itself, the ask applied as her reply
    would be. Her own letter from the actor mailbox is not written from here: the journey names the injector."""
    reads = sess.reads
    if HH.sim_val(reads, "sim_auto_reply").lower() == "off" or not HH.guard_on(reads):
        return []
    acted, recs = 0, []
    try:
        acted, recs = IFW.apply(sess, rows, {"verdict": "yes", "mid": "sim:auto:" + secrets.token_hex(4).upper(),
                                             "rehearsal": True}, today)
    except (Defer, hubdb.Unreadable):
        raise
    except Exception as exc:  # noqa: BLE001 - as Apps Script: the ask waits for a real reply
        log.info("interview: the interviewer actor's YES was not applied (%s)", type(exc).__name__)
        acted, recs = 0, []
    return recs + HH.journey(reads, "", s_(HH.actors(reads)["interviewer_name"]), {
        "step": "interviewer_ask", "channel": "email", "ok": bool(acted), "rehearsal": True,
        "detail": "the interviewer actor answered YES BY ITSELF (the injector)", "by": "asa-hub:sim-auto"})


# ---- the candidate's pick (interviewSlotSubmitPub_) -------------------------------------------------------------------

def slot_submit(sess: L.Session, payload: dict) -> Decision:
    """interviewSlotSubmit: the candidate's pick, recorded — one of the offered times books it; a pick on the open grid
    asks the interviewer; "none of these" asks her for six others."""
    if HP.throttled("submit"):
        return Decision(dict(HP.TOO_MANY))
    reads = sess.reads
    p = HP.payload_of(payload)
    ask = HP.ask_by_token(reads, p.get("t"))
    if ask is None:
        return W.refuse(404, HP.NOT_VALID)
    day, tm = s_(p.get("date")), s_(p.get("time"))
    ask_id, cid, name = s_(ask.get("askid")), s_(ask.get("candidateid")), s_(ask.get("candidatename"))
    state = s_(ask.get("state"))
    # "none of these" carries no day: it is heard before the pick's own shape is asked of it
    none = state == "slots_offered" and (p.get("none") is True or s_(p.get("none")) == "true")
    if not none and not IF.slot_ok(day, tm):
        return W.refuse(400, "Pick a day and one of the listed hours.")
    if state == "confirmed":
        return Decision({"status": 200, "data": {"received": True,
                                                 "message": "Your interview is already booked — nothing more to do."}})
    allowed = IF.allowed_days(ask)
    if not none and allowed and day not in allowed:
        return W.refuse(409, "That day is not available for the interviewer — please pick one of the open days on the "
                             "calendar.")
    rows = _rows(reads)
    now = W.now_iso(reads)
    if state == "slots_offered":
        if none:
            recs = _write(reads, rows, ask_id, {"state": "slots_requested", "slots_json": "",
                                                "supervisor_reply": "candidate_rejected_slots"}, now)
            try:
                _got, more = IFW.slots_ask(L.Session(reads, dict(SLOTS_ACTOR)), cid, 6, SLOTS_ACTOR["email"])
                recs += more
            except (Defer, hubdb.Unreadable):
                raise
            except Exception as exc:  # noqa: BLE001 - as Apps Script: the retry rung re-asks
                log.info("interview: the six-slot ask did not go (%s)", type(exc).__name__)
            recs += HH.journey(reads, cid, name, {
                "step": "candidate_picked", "channel": "page", "ok": True, "ref": ask_id, "by": "the candidate",
                "detail": "none of the offered slots worked for the candidate — the interviewer is asked for six "
                          "different ones"})
            return W.final({"status": 200, "data": {"received": True, "reoffered": True}}, recs, cid)
        offered = HP.parsed(ask.get("slotsjson"))
        if not any(isinstance(x, dict) and s_(x.get("date")) == day and s_(x.get("time")) == tm
                   for x in (offered if isinstance(offered, list) else [])):
            return W.refuse(400, "That time is not one of the offered slots — pick one of the listed ones.")
        recs = _write(reads, rows, ask_id, {"picked_date": day, "picked_time": tm, "state": "picked2"}, now)
        conf, more = IFW.confirm(sess, rows, ask, day, tm, "candidate picked one of the three")
        recs += more
        if conf["ok"]:
            IFW.tell(reads, ask, day, tm)
        else:
            _line("interview_pick2_confirm_failed", ask_id + " — " + s_(conf.get("reason")), 500)
        return W.final({"status": 200, "data": {"received": True}}, recs, cid)
    # the open grid: a slot another candidate confirmed is not offered twice
    if day + "T" + tm in IF.taken_slots(reads):
        return W.refuse(409, "That time was just taken — please pick another.")
    recs = _write(reads, rows, ask_id, {"picked_date": day, "picked_time": tm, "state": "picked"}, now)
    recs += HH.journey(reads, cid, name, {
        "step": "candidate_picked", "channel": "page", "ok": True, "ref": ask_id, "by": "the candidate",
        "detail": "the candidate chose " + IF.slot_label(day, tm)})
    asked, more = supervisor_ask(reads, ask, day, tm)
    recs += more
    if asked.get("sent"):
        recs += _write(reads, rows, ask_id, {"state": "supervisor_asked", "supervisor_asked_at": now}, now)
        if IF.is_rehearsal_ask(ask):
            recs += auto_yes(sess, rows, IF.today_text(reads))
    else:
        _line("interview_supervisor_ask_skipped", ask_id + " — " + s_(asked.get("reason")))
    return W.final({"status": 200, "data": {"received": True}}, recs, cid)


# ---- the interviewer's own link (interviewSlotsSubmitPub_, interviewDaysSubmitPub_) ---------------------------------

def slots_submit(sess: L.Session, payload: dict) -> Decision:
    """interviewSlotsSubmit: the interviewer's slots from her calendar, one per day — one is enough — offered to the
    candidate on their own link."""
    if HP.throttled("slots"):
        return Decision(dict(HP.TOO_MANY))
    reads = sess.reads
    p = HP.payload_of(payload)
    ask = HP.ask_by_days_token(reads, p.get("t"))
    if ask is None:
        return W.refuse(404, HP.NOT_VALID)
    cid, name, ask_id = s_(ask.get("candidateid")), s_(ask.get("candidatename")), s_(ask.get("askid"))
    raw = p.get("slots") if isinstance(p.get("slots"), list) else []
    valid = IF.slots_valid([{"date": s_(x.get("date")) if isinstance(x, dict) else "",
                             "time": s_(x.get("time")) if isinstance(x, dict) else ""} for x in raw],
                           IF.today_text(reads))
    # different days — the dictation's own requirement
    one_a_day: dict[str, dict[str, str]] = {}
    for x in valid:
        one_a_day.setdefault(x["date"], x)
    valid = list(one_a_day.values())
    wanted = 6 if s_(ask.get("supervisorreply")) == "candidate_rejected_slots" else 3
    if not valid:
        return W.refuse(400, "Please pick at least one valid time — a future weekday, inside our interview hours.")
    valid = valid[:wanted]
    taken = IF.taken_slots(reads)
    for x in valid:
        if x["date"] + "T" + x["time"] in taken:
            return W.refuse(409, IF.slot_label(x["date"], x["time"]) +
                            " was just booked for somebody else — please swap that one.")
    rows = _rows(reads)
    now = W.now_iso(reads)
    recs = _write(reads, rows, ask_id, {"state": "slots_offered", "slots_json": json.dumps(valid, separators=(",", ":")),
                                        "offered_at": now, "supervisor_reply": "slots"}, now)
    recs += HH.sim_answer(reads, ["interview_slots"], "she chose her slots on the calendar", cid, now)
    try:
        IFW.slots_offer(reads, ask, valid)
    except (Defer, hubdb.Unreadable):
        raise
    except Exception as exc:  # noqa: BLE001 - said in the log, as Apps Script said it
        _line("interview_slots_offer_failed", ask_id + " — " + type(exc).__name__, 500)
    recs += HH.journey(reads, cid, name, {
        "step": "interviewer_days", "channel": "page", "ok": True, "ref": ask_id, "by": "the interviewer",
        "detail": f"the interviewer chose {len(valid)} slot(s) on her calendar — the candidate's own link goes out by "
                  "itself"})
    return W.final({"status": 200, "data": {"received": True, "offered": len(valid)}}, recs, cid)


def future_day(d: str, today: str) -> bool:
    """new Date(d + 'T23:59:59') > today's midnight: a month and a day the parser takes (a day past the month's end
    rolls over), on or after today."""
    m = _DAY.fullmatch(d)
    if not m:
        return False
    y, mo, dd = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not 1 <= mo <= 12 or not 1 <= dd <= 31 or y < 1:
        return False
    return (date(y, mo, 1) + timedelta(days=dd - 1)).isoformat() >= today


def days_submit(sess: L.Session, payload: dict) -> Decision:
    """interviewDaysSubmit: the interviewer's open days stored — every other day paints gray and blocked — and the
    candidate's calendar sent by itself, as interviewInviteSend would."""
    if HP.throttled("days"):
        return Decision(dict(HP.TOO_MANY))
    reads = sess.reads
    p = HP.payload_of(payload)
    ask = HP.ask_by_days_token(reads, p.get("t"))
    if ask is None:
        return W.refuse(404, "This link is no longer valid — please ask for a fresh one.")
    raw = p.get("days") if isinstance(p.get("days"), list) else []
    today = IF.today_text(reads)
    days = [d for d in (gsjs.js_str(x) for x in raw) if _DAY.fullmatch(d) and future_day(d, today)]
    if not days:
        return W.refuse(400, "Pick at least one day the interview can happen.")
    cid, name, ask_id = s_(ask.get("candidateid")), s_(ask.get("candidatename")), s_(ask.get("askid"))
    rows = _rows(reads)
    now = W.now_iso(reads)
    recs = _write(reads, rows, ask_id, {"allowed_days_json": json.dumps(days[:31], separators=(",", ":")),
                                        "days_chosen_at": now}, now)
    recs += HH.sim_answer(reads, ["interview_days"], "she chose her days", cid, now)
    recs += HH.journey(reads, cid, name, {
        "step": "interviewer_days", "channel": "web", "ok": True, "by": "asa-hub:interviewer-days",
        "detail": f"the interviewer chose {len(days)} day(s) for the calendar (" + ", ".join(days[:5]) +
                  ("…" if len(days) > 5 else "") + ") — every other day paints gray and blocked"})
    invited = None
    try:
        invited, more = IFW.invite(L.Session(reads, dict(DAYS_ACTOR)), cid, DAYS_ACTOR["email"])
        recs += more
    except (Defer, hubdb.Unreadable) as exc:
        log.info("interview days: the candidate's calendar did not go (%s)", str(exc)[:160])
    sent = bool(((invited or {}).get("data") or {}).get("invited"))
    return W.final({"status": 200, "data": {"saved": True, "days": days, "calendar_sent": sent}}, recs, cid)


# ---- the shared candidate form (candFormSubmitPub_) --------------------------------------------------------------

def unattested(sess: L.Session, cid: str, checkpoint: str, value: str) -> dict[str, Any] | None:
    """hubSetDecisionHeld_ without how.attest: a link signs no phone screen, so an Advance still needs it Completed."""
    if checkpoint != "advance-decision" or value != "Advance":
        return None
    reads = sess.reads
    cand = CW.dissolved_rows(reads, CW.CANDIDATES, [cid]).get(cid)
    if cand is None:
        return None
    CW.marked(cand.get("status"))
    if s_(cand.get("status")).lower() == "not hiring" or HB.screen_closed(cand) is not None:
        return None
    s = CW.dissolved_rows(reads, CW.PHONE, [cid]).get(cid)
    CW.marked((s or {}).get("screenstatus"))
    if s_((s or {}).get("screenstatus")).lower() == "completed":
        return None
    return {"status": 409, "message": "Advance requires the phone screen to be Completed." if s
            else "No phone screen recorded for this candidate yet."}


def cand_form_submit(sess: L.Session, payload: dict) -> Decision:
    """candFormSubmit: a decision or a gated move pressed on a candidate's shared form, as the link's own identity."""
    reads = sess.reads
    p = HP.payload_of(payload)
    cid = HP.cand_form_cid(reads, p.get("t"))
    if not cid:
        return Decision(dict(HP.CAND_GONE))
    share = L.Session(reads, dict(SHARE_USER))
    kind = s_(p.get("kind"))
    if kind == "decision":
        checkpoint, value = s_(p.get("checkpoint")), s_(p.get("value"))
        if checkpoint not in ("resume-decision", "advance-decision"):
            return W.refuse(400, "unknown checkpoint")
        if value not in HB.VALUES:
            return W.refuse(400, "decision must be Advance or Decline")
        _c, _p, refused = HBW._opened(share, {"candidate_id": cid}, CW.RESUME, CW.PHONE, CW.INTERVIEWS, CW.JOURNEY)
        if refused:
            return refused
        held = unattested(share, cid, checkpoint, value)
        if held:
            return Decision(held)
        env, recs = HBW.decide(share, cid, checkpoint, value, "")
        if env.get("status") != 200:
            return Decision(env)
        return W.final(env, recs, cid)
    if kind == "move":
        return HBW.move_stage(share, {"candidate_id": cid, "to_stage": s_(p.get("to_stage"))})
    return W.refuse(400, "unknown kind")


# ---- the login page's referral (referralSubmit_) -----------------------------------------------------------------

def referral(sess: L.Session, payload: dict) -> Decision:
    """referralSubmit: the only unauthenticated write — a card, a recognised person or a warning, and the indications
    book's row for every knock; its résumé was stored and read by referralSubmitPrepare."""
    p = HP.payload_of(payload)
    prep = R.unsealed(HP.REFERRAL, HP.referral_by(p), p.get("prepared"))
    if prep is None:
        raise Defer("referralSubmit's résumé is read by referralSubmitPrepare first")
    env, recs = HIW.referral_submit(sess, p, prep)
    return W.final(env, recs, "")


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "interviewSlotSubmit": slot_submit, "interviewSlotsSubmit": slots_submit, "interviewDaysSubmit": days_submit,
    "candFormSubmit": cand_form_submit, "referralSubmit": referral}
# no HUB_POLICY: each link's token, or the referral's throttle, is the door's gate
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
# what nobody's account may ask; no BUSY_OF: while another write holds the lock, Apps Script answers the door
PUBLIC = frozenset(ACTIONS)
