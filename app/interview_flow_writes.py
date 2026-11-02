"""The interview scheduler's writes (InterviewFlow.gs) kept as the hiring rows' facts (interview_asks,
interview_ask_ai, the journey, the ask book), every message through Smart Comms: the candidate's personal link
(interviewInviteSend), the interviewer asked for her days or her slots (interviewDaysAskSend, interviewSlotsAsk), and
her replies acted on (interviewAskSweepNow, and the relay's clock: interviewAskSweep, interviewStartSweep). A booking
is made through the one scheduling writer, hiringScheduleCreate, wherever this service decides it."""
from __future__ import annotations

import json
import logging
import re
import secrets
import sys
import time
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import hiring_hired as HH
import hubdb
import interview_flow as IF
import locations as L
import mail_designs as MD
import recon as R
import smart_comms as SC
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")
s_ = CND.s_
STALE = "The look this sweep was pressed with is not this service's, or it is too old — press it again."
FLOW_ACTOR = {"role": "manager", "email": "interview-flow@service.local", "id": "SVC_INTERVIEW_FLOW"}
SWEEP_BUDGET_S = 4.0


def _done(answer: dict[str, Any], recs: list[dict], subject: str = "", own: bool = False) -> Decision:
    kept = [e for e in recs if e and e.get("cells")]
    if not kept and not own:
        return Decision(answer)
    return Decision(answer, edits=kept or None, subject=subject, own=own)


def other_door(name: str) -> Callable[[L.Session, dict], Decision] | None:
    """Another write door this service decides, called in-process as Apps Script re-called HUB_ACTIONS; None when no
    loaded write module answers it."""
    for mod in list(sys.modules.values()):
        acts = getattr(mod, "ACTIONS", None)
        if isinstance(acts, dict) and name in acts and getattr(mod, "BUSY_OF", None) is not None:
            return acts[name]
    return None


def ok_sent(got: dict | None) -> bool:
    """res.ok && res.sent: gone, deduplicated, or written down for the testers (a redirected send was sent)."""
    return HH.went(got) or HH.rehearsed(got)


def failed(got: dict | None) -> bool:
    """res && !res.ok: not a brake holding it."""
    return s_((got or {}).get("state")) not in ("sent", "already", "held")


# ---- the ask book's facts ------------------------------------------------------------------------------------------

def ask_append(reads: L.Reads, rows: list[dict], row: dict[str, Any], now: str) -> list[dict]:
    """interviewAskAppend_: one ask row, every column, as the runtime's facts; laid into this write's rows."""
    full = {h: s_(row.get(h)) for h in IF.ASKS_HEADER}
    rows.append({hubdb.norm_key(k): v for k, v in full.items()})
    return CW.facts_of(reads, IF.ASKS, full["ask_id"], full, "interview-ask:append", full["candidate_id"], "", at=now)


def ask_write(reads: L.Reads, rows: list[dict], ask_id: str, fields: dict[str, Any], now: str) -> list[dict]:
    """interviewAskWrite_: one ask patched by name, updated_at stamped with every change."""
    fields = {**fields, "updated_at": now}
    row = None
    for r in rows:
        if s_(r.get("askid")) == ask_id:
            row = r
    if row is None:
        return []
    row.update({hubdb.norm_key(k): s_(v) for k, v in fields.items()})
    return CW.facts_of(reads, IF.ASKS, ask_id, fields, "interview-ask", s_(row.get("candidateid")), "", at=now)


def memo(reads: L.Reads, item: dict[str, Any], now: str) -> list[dict]:
    """One verdict per message, ever — the memo tab remembers even the "other"s."""
    return CW.facts_of(reads, IF.AI_TAB, item["mid"], {
        "message_id": item["mid"], "verdict": item["verdict"],
        "slots_json": json.dumps(item["slots"], separators=(",", ":")) if item.get("slots") else "",
        "via": s_(item.get("via")), "seen_at": now}, "interview-ask-ai", "", "", at=now)


def _new_ask_id() -> str:
    """'ASK_' + randomHex_(10)."""
    return "ASK_" + secrets.token_hex(5).upper()


# ---- the interviewer asked for her days (interviewDaysAskSend) ----------------------------------------------------

def days_ask(sess: L.Session, cid: str, by: str) -> tuple[dict[str, Any], list[dict], str]:
    """The interviewer's days come first: her days-link by e-mail and text, the ask booked so her answer lands on it,
    and the asking enters the ask book. (answer, records, ask id)"""
    reads = sess.reads
    if not IF.secret(reads):
        return {"status": 200, "data": {"sent": False, "reason": "no_link_secret"}}, [], ""
    cand = CND.evidence(reads, cid).get("cand")
    if not cand:
        return {"status": 404, "message": f'No candidate "{cid}".'}, [], ""
    name = s_(cand.get("candidatename"))
    rows = [dict(r) for r in IF.ask_rows(reads)]
    ask = IF.open_for(rows, cid)
    ask_id = s_(ask.get("askid")) if ask else _new_ask_id()
    now = W.now_iso(reads)
    if ask is None:
        recs = ask_append(reads, rows, {"ask_id": ask_id, "candidate_id": cid, "candidate_name": name,
                                        "candidate_email": s_(cand.get("email")),
                                        "candidate_phone": HH.sendable_phone(reads, cand.get("phone")),
                                        "state": "days_asked", "days_asked_at": now, "updated_at": now}, now)
    else:
        recs = ask_write(reads, rows, ask_id, {"days_asked_at": now}, now)
    sup = IF.supervisor_for(reads, IF.open_for(rows, cid) or {"candidatename": name})
    if not sup.get("email") and not sup.get("phone"):
        return ({"status": 200, "data": {"sent": False, "reason": "no_interviewer",
                                         "detail": s_(sup.get("by")) or "nobody holds the INTERVIEWER badge"}},
                recs, ask_id)
    link = IF.LINK_BASE + IF.days_token_for(reads, ask_id) + "&m=days"
    rehearsal = HH.is_rehearsal(reads, cand)
    sid = HH.sit_id(reads, IF.DAYS_ASK)
    id_sit = HH.situation_on(reads, sid)

    def say(sit_key: str, cfg_key: str, floor: str) -> str:
        v = s_((id_sit or {}).get(sit_key)) or HH.sim_text(reads, cfg_key)
        return (v or floor).replace("{name}", name).replace("{interviewer}", s_(sup.get("name"))).replace("{link}",
                                                                                                         link)
    subject = say("email_subject", "interviewer_days_subject",
                  "{name} is ready for an interview — which days can you take?")
    body = say("email_text", "interviewer_days_body",
               "Hi {interviewer},\n\n{name} has finished the phone screening and is ready to meet you.\n\nOpen {link} "
               "and choose the days that suit you. The candidate picks a time inside the days you choose, so nothing "
               "lands on you unannounced.")
    out: dict[str, Any] = {"sent": False, "emailed": False, "smsed": False, "link": link,
                           "interviewer": s_(sup.get("name")), "failures": []}
    if sup.get("email"):
        html = MD.mail_shell({"eyebrow": "ASA Hub — Hiring", "title": "Which days work for you?",
                              "preheader": name + " is ready to book — choose the open days first.",
                              "blocks": [MD.mail_para(MD.mail_esc(p).replace("\n", "<br>"))
                                         for p in re.split(r"\n{2,}", body)],
                              "cta": {"label": "Choose my days", "href": link},
                              "footnote": "Days you do not choose paint gray and blocked on the candidate's calendar."})
        got = HH.send(reads, situation=sid, to=sup["email"], body=body, key="iask_days_mail_" + ask_id, channel="email",
                      subject=HH.tag_subject(reads, subject) if rehearsal else subject, html=html,
                      cc=HH.cc_for(reads, sup["email"]) if rehearsal else "", person=name)
        if ok_sent(got):
            out["emailed"] = out["sent"] = True
        else:
            out["failures"].append("email: " + HH.why_not(got))
    if sup.get("phone"):
        sms = say("sms_text", "interviewer_days_sms",
                  "ASA LifeCare hiring — {name} is ready for an interview. Open {link} and pick the days you can take; "
                  "the candidate then chooses a time inside them.")
        got = HH.send(reads, situation=sid, to=sup["phone"], body=sms, key="iask_days_sms_" + ask_id, person=name)
        if ok_sent(got):
            out["smsed"] = out["sent"] = True
        else:
            out["failures"].append("sms: " + HH.why_not(got))
    recs += HH.journey(reads, cid, name, {
        "step": "interviewer_days", "channel": "email+sms", "ok": out["sent"], "rehearsal": rehearsal, "by": by,
        "detail": "the interviewer (" + s_(sup.get("name")) + ") was sent her days-link — e-mail and OpenPhone text "
                  "together; the candidate's calendar WAITS for her choice" if out["sent"]
        else "nothing went — " + "; ".join(out["failures"])})
    if out["sent"]:
        recs += HH.sim_track(reads, "interview_days", cid, "interviewDaysAskSend", {"candidate_id": cid}, now)
    return {"status": 200, "data": out}, recs, ask_id


def days_ask_door(sess: L.Session, payload: dict) -> Decision:
    """interviewDaysAskSend."""
    user = sess.user or {}
    if not HH.writer(user):
        return Decision(dict(HH.DENIED))
    cid = s_((payload or {}).get("candidate_id"))
    if not HH.CAN_ID.match(cid):
        return W.refuse(400, "invalid candidate_id")
    answer, recs, _ask = days_ask(sess, cid, s_(user.get("email")))
    return _done(answer, recs, cid)


# ---- the candidate's personal link (interviewInviteSend) ---------------------------------------------------------

def _cjis_reask(sess: L.Session, cid: str, name: str, ev: dict, by: str) -> list[dict]:
    """Before the invite, still without the CJIS: the request asked again, non-blocking — where its door is decided
    here."""
    reads = sess.reads
    a = ev.get("analysis") or {}
    have = CND.cjis_cleared(a) or s_(a.get("cjisstatus")).lower() == "on file" or bool(s_(a.get("cjisreporturl")))
    if have:
        return []
    asked, why = CND.soft(lambda: any(s_(r.get("state")) == "open" and s_(r.get("step")) == "cjis_request" and
                                      s_(r.get("candidateid")) == cid for r in HH.sim_rows(reads)))
    door = other_door("hiringCjisRequestSend")
    if asked or door is None:
        return []
    try:
        dec = door(sess, {"candidate_id": cid, "no_auto": True})
    except (Defer, hubdb.Unreadable) as exc:
        log.info("interview invite: the CJIS re-ask did not go (%s)", str(exc)[:120])
        return []
    if (dec.answer or {}).get("status") != 200:
        log.info("interview invite: the CJIS re-ask was refused (%s)", s_((dec.answer or {}).get("message"))[:120])
        return []
    return list(dec.edits or []) + HH.journey(reads, cid, name, {
        "step": "schedule_invite", "channel": "email", "ok": True, "by": by,
        "detail": "still no CJIS before the interview invite — Arthur was asked AGAIN (e-mail + Quo together), "
                  "non-blocking: the invite goes out either way"})


def invite(sess: L.Session, cid: str, by: str) -> tuple[dict[str, Any], list[dict]]:
    """interviewInviteSend's body: one appointment, one link — the interviewer's days first, then the personal
    scheduling link by e-mail and text, once a day per ask."""
    reads = sess.reads
    if not IF.secret(reads):
        return {"status": 200, "data": {"invited": False, "reason": "no_link_secret"}}, []
    sid = HH.sit_id(reads, IF.INVITE)
    sit = HH.situation_on(reads, sid)
    if sit is None:
        return {"status": 200, "data": {"invited": False, "reason": "situation_off"}}, []
    ev = CND.evidence(reads, cid)
    cand = ev.get("cand")
    if not cand:
        return {"status": 404, "message": f'No candidate "{cid}".'}, []
    name = s_(cand.get("candidatename"))
    email = s_(cand.get("email"))
    phone = HH.sendable_phone(reads, cand.get("phone"))
    if not email and not phone:
        return {"status": 200, "data": {"invited": False, "reason": "no_email_no_phone"}}, []
    rows = [dict(r) for r in IF.ask_rows(reads)]
    early = IF.open_for(rows, cid)
    st = s_((early or {}).get("state"))
    if early and st in ("picked", "picked2", "supervisor_asked", "slots_offered", "confirmed"):
        return {"status": 200, "data": {"invited": False, "reason": "already_scheduled",
                                        "detail": f"this candidate already moved past the link ({st}) — one "
                                                  "appointment, one link", "ask_id": s_(early.get("askid"))}}, []
    if not IF.allowed_days(early):
        if early and s_(early.get("daysaskedat")):
            return {"status": 200, "data": {"invited": False, "reason": "waiting_interviewer_days",
                                            "detail": "the interviewer was asked to choose the days and has not answered "
                                                      "yet — the candidate's calendar goes out by itself the moment she "
                                                      "does", "ask_id": s_(early.get("askid"))}}, []
        got, recs, ask_id = days_ask(sess, cid, by)
        dd = got.get("data") or {}
        return {"status": 200, "data": {
            "invited": False, "reason": "interviewer_days_asked",
            "detail": "the calendar went to the interviewer FIRST (" + (s_(dd.get("interviewer")) or "by badge") +
                      ", e-mail + OpenPhone) — the candidate's calendar goes out by itself the moment she chooses her "
                      "days", "interviewer": s_(dd.get("interviewer")), "ask_id": ask_id}}, recs
    recs = _cjis_reask(sess, cid, name, ev, by)
    ask = IF.open_for(rows, cid)
    ask_id = s_(ask.get("askid")) if ask else _new_ask_id()
    now = W.now_iso(reads)
    if ask is None:
        recs += ask_append(reads, rows, {"ask_id": ask_id, "candidate_id": cid, "candidate_name": name,
                                         "candidate_email": email, "candidate_phone": phone, "state": "invited",
                                         "invited_at": now, "invited_by": "asa-hub:" + by, "updated_at": now}, now)
    link = IF.LINK_BASE + IF.token_for(reads, ask_id, cid)
    today = IF.today_text(reads)
    import smart_clock as SCK  # noqa: PLC0415 - the ledger as the clock reads it
    key = SCK.ledger_key(sid, cid + ":" + ask_id, today)
    told, _w = CND.soft(lambda: key in SCK.ledger_stats(reads)["sent"])
    if told:
        return {"status": 200, "data": {"invited": False, "reason": "already_told"}}, recs
    v = {"name": name, "first_name": HH.greet_first(name), "link": link}
    emailed = smsed = redirected = False
    failures: list[str] = []
    f = HH.fence(reads, email)
    if email and not f["ok"]:
        failures.append("email: " + f["detail"])
        email = ""
    f = HH.fence(reads, phone)
    if phone and not f["ok"]:
        failures.append("sms: " + f["detail"])
        phone = ""
    rehearsal = HH.is_rehearsal(reads, cand)
    if email:
        built = IF.invite_email({"name": name, "link": link,
                                 "subject": HH.render(s_(sit.get("email_subject")), v) if s_(sit.get("email_subject"))
                                 else "",
                                 "bodyText": HH.render(s_(sit.get("email_text")), v) if s_(sit.get("email_text"))
                                 else ""})
        got = HH.send(reads, situation=sid, to=email, body=built["text"], key=f"iask_inv_mail_{ask_id}_{today}",
                      channel="email", subject=HH.tag_subject(reads, built["subject"]) if rehearsal else built["subject"],
                      html=built["html"], cc=HH.cc_for(reads, email) if rehearsal else "", person=name)
        if ok_sent(got):
            emailed, redirected = True, redirected or HH.rehearsed(got)
        elif failed(got):
            failures.append("email: " + HH.why_not(got))
    if phone:
        got = HH.send(reads, situation=sid, to=phone, body=HH.render(s_(sit.get("sms_text")) or
                                                                     IF.FALLBACK["invite_sms"], v),
                      key=f"iask_inv_sms_{ask_id}_{today}", person=name)
        if ok_sent(got):
            smsed, redirected = True, redirected or HH.rehearsed(got)
        elif failed(got):
            failures.append("sms: " + HH.why_not(got))
    if emailed or smsed:
        import smart_clock as SCK2  # noqa: PLC0415 - smartRehearsalKey_
        SC.record_ledger(SCK2.rehearsal_key(key) if redirected else key, sid, cid + ":" + ask_id, today,
                         "rehearsal" if redirected else ("email+sms" if emailed and smsed else
                                                         "email" if emailed else "sms"))
        recs += ask_write(reads, rows, ask_id, {}, now)
        if rehearsal:
            recs += HH.sim_track(reads, "invite", cid, "interviewInviteSend", {"candidate_id": cid}, now)
    log.info("interview_invite_send: %s — %s%s%s", cid, name, " email" if emailed else "", " sms" if smsed else "")
    recs += HH.journey(reads, cid, name, {
        "step": "schedule_invite", "channel": ("email" if emailed else "") + (("+sms" if emailed else "sms")
                                                                             if smsed else ""),
        "to": email or phone, "ok": emailed or smsed, "rehearsal": redirected, "ref": ask_id, "by": by,
        "detail": "sent their personal scheduling link" if emailed or smsed
        else "nothing went — " + ("; ".join(failures) or "gated")})
    if not emailed and not smsed:
        return {"status": 200, "data": {"invited": False, "reason": "; ".join(failures) or "gated",
                                        "ask_id": ask_id}}, recs
    return {"status": 200, "data": {"invited": True, "emailed": emailed, "smsed": smsed, "redirected": redirected,
                                    "ask_id": ask_id, "first_name": v["first_name"], "link": link}}, recs


def invite_door(sess: L.Session, payload: dict) -> Decision:
    """interviewInviteSend."""
    user = sess.user or {}
    if not HH.writer(user):
        return Decision(dict(HH.DENIED))
    cid = s_((payload or {}).get("candidate_id"))
    if not HH.CAN_ID.match(cid):
        return W.refuse(400, "invalid candidate_id")
    answer, recs = invite(sess, cid, s_(user.get("email")))
    return _done(answer, recs, cid)


# ---- the interviewer asked for slots (interviewSlotsAsk) ---------------------------------------------------------

def slots_ask(sess: L.Session, cid: str, wanted: int, by: str) -> tuple[dict[str, Any], list[dict]]:
    """The dictated opening of the interview: the interviewer asked, by text and letter, for slots on different days;
    the candidate picks among what she sends."""
    reads = sess.reads
    cand = CND.evidence(reads, cid).get("cand")
    if not cand:
        return {"status": 404, "message": f'No candidate "{cid}".'}, []
    sid = HH.sit_id(reads, IF.SLOTS_ASK)
    sit = HH.situation_on(reads, sid)
    if sit is None:
        return {"status": 200, "data": {"sent": False, "reason": "situation_off"}}, []
    now = W.now_iso(reads)
    if HH.archived(cand) or CND.stage_of(cand.get("status")) != "interview":
        return ({"status": 200, "data": {"sent": False, "reason": "card_moved_on"}},
                HH.sim_answer(reads, ["interview_slots"], "the card moved on — the machine lets go", cid, now))
    name = s_(cand.get("candidatename"))
    rows = [dict(r) for r in IF.ask_rows(reads)]
    ask = IF.open_for(rows, cid)
    ask_id = s_(ask.get("askid")) if ask else _new_ask_id()
    recs: list[dict] = []
    if ask is None:
        recs += ask_append(reads, rows, {"ask_id": ask_id, "candidate_id": cid, "candidate_name": name,
                                         "candidate_email": s_(cand.get("email")),
                                         "candidate_phone": HH.sendable_phone(reads, cand.get("phone")),
                                         "state": "slots_requested", "updated_at": now}, now)
    elif s_(ask.get("state")) not in ("slots_offered", "confirmed"):
        recs += ask_write(reads, rows, ask_id, {"state": "slots_requested"}, now)
    sup = IF.supervisor_for(reads, ask or {"candidatename": name})
    if not s_(sup.get("email")) and not s_(sup.get("phone")):
        return {"status": 200, "data": {"sent": False, "reason": "no_interviewer"}}, recs
    link = IF.LINK_BASE + IF.days_token_for(reads, ask_id) + "&m=days"

    def fill(t: str) -> str:
        return (s_(t).replace("{name}", name).replace("{interviewer}", s_(sup.get("name")) or "there")
                .replace("{slots_wanted}", str(wanted)).replace("{link}", link))
    sent_any = False
    if s_(sup.get("phone")):
        body = fill(s_(sit.get("sms_text")))
        if body:
            got = HH.send(reads, situation=sid, to=sup["phone"], body=HH.tag_subject(reads, body),
                          key=f"islots_sms_{ask_id}_{wanted}", person=name)
            sent_any = sent_any or ok_sent(got)
    if "@" in s_(sup.get("email")):
        body = fill(s_(sit.get("email_text")))
        if body:
            got = HH.send(reads, situation=sid, to=sup["email"], body=body, key=f"islots_mail_{ask_id}_{wanted}",
                          channel="email", subject=HH.tag_subject(reads, fill(s_(sit.get("email_subject")))),
                          person=name)
            sent_any = sent_any or ok_sent(got)
    if sent_any:
        recs += HH.sim_track(reads, "interview_slots", cid, "interviewSlotsAsk",
                             {"candidate_id": cid, "slots_wanted": str(wanted)}, now)
    recs += HH.journey(reads, cid, name, {
        "step": "interviewer_ask", "channel": "email+sms", "ok": sent_any, "ref": ask_id, "by": by,
        "title": f"The interviewer was asked for {wanted} slots" if sent_any else "The slots ask could not be sent",
        "detail": s_(sup.get("name")) + f" was asked for {wanted} time slots on different days — date and time; the "
                                        "candidate picks among what she sends" if sent_any
        else "neither leg went out — the retry rung re-asks on its clock"})
    return {"status": 200, "data": {"sent": sent_any, "ask_id": ask_id, "slots_wanted": wanted}}, recs


def slots_ask_door(sess: L.Session, payload: dict) -> Decision:
    """interviewSlotsAsk."""
    user = sess.user or {}
    if not HH.writer(user):
        return Decision(dict(HH.DENIED))
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("candidate_id"))
    if not HH.CAN_ID.match(cid):
        return W.refuse(400, "invalid candidate_id")
    n = CND.js_parse_int(p.get("slots_wanted"))
    wanted = int(n) if n == n and n else 3
    answer, recs = slots_ask(sess, cid, wanted, s_(user.get("email")))
    return _done(answer, recs, cid)


# ---- the supervisor conversation (interviewSupervisorTell_, interviewSlotsRequest_, interviewSlotsOffer_) ----------

def tell(reads: L.Reads, ask: dict, day: str, tm: str) -> None:
    """The thank-you and the booking to the interviewer, by text and letter."""
    sid = HH.sit_id(reads, IF.CONFIRMED)
    sit = HH.situation_on(reads, sid)
    if sit is None:
        return
    sup = IF.supervisor_for(reads, ask)
    slot = IF.slot_label(day, tm)
    v = {"candidate": s_(ask.get("candidatename")), "slot": slot}
    ask_id = s_(ask.get("askid"))
    if sup.get("phone"):
        HH.send(reads, situation=sid, to=sup["phone"], body=HH.render(s_(sit.get("sms_text")) or
                                                                       IF.FALLBACK["confirmed_sms"], v),
                key="iask_conf_sms_" + ask_id, person=v["candidate"])
    if sup.get("email"):
        letter = IF.thanks_email({"interviewer": sup.get("name"), "name": v["candidate"], "slot": slot,
                                  "location": IF.last_location(reads),
                                  "subject": HH.render(s_(sit.get("email_subject")) or IF.FALLBACK["confirmed_subject"],
                                                       v),
                                  "bodyText": HH.render(s_(sit.get("email_text")), v) if s_(sit.get("email_text")) else ""})
        reh = IF.is_rehearsal_ask(ask)
        HH.send(reads, situation=sid, to=sup["email"], body=letter["text"], key="iask_conf_mail_" + ask_id,
                channel="email", subject=HH.tag_subject(reads, letter["subject"]) if reh else letter["subject"],
                html=letter["html"], cc=HH.cc_for(reads, sup["email"]) if reh else "", person=v["candidate"])


def slots_request(reads: L.Reads, ask: dict) -> None:
    """After a NO: the interviewer asked for three slots, by text."""
    sid = HH.sit_id(reads, IF.SLOTS_REQUEST)
    sit = HH.situation_on(reads, sid)
    if sit is None:
        return
    sup = IF.supervisor_for(reads, ask)
    if not sup.get("phone"):
        return
    HH.send(reads, situation=sid, to=sup["phone"],
            body=HH.render(s_(sit.get("sms_text")) or IF.FALLBACK["slots_request"],
                           {"candidate": s_(ask.get("candidatename"))}),
            key="iask_slotreq_" + s_(ask.get("askid")), person=s_(ask.get("candidatename")))


def slots_offer(reads: L.Reads, ask: dict, slots: list[dict]) -> None:
    """The slots to the candidate — the same personal link, the page turned to a choice."""
    sid = HH.sit_id(reads, IF.SLOTS_OFFER)
    sit = HH.situation_on(reads, sid)
    if sit is None:
        return
    tok = IF.token_for(reads, s_(ask.get("askid")), s_(ask.get("candidateid")))
    if not tok:
        return
    link = IF.LINK_BASE + tok
    labels = [IF.slot_label(s["date"], s["time"]) for s in slots]
    name = s_(ask.get("candidatename"))
    v = {"name": name, "first_name": HH.greet_first(name), "link": link, "slots": " · ".join(labels)}
    mail_v = {**v, "slots": "\n".join("  " + x for x in labels)}
    ask_id = s_(ask.get("askid"))
    email = s_(ask.get("candidateemail"))
    phone = HH.sendable_phone(reads, ask.get("candidatephone"))
    if email and not HH.fence(reads, email)["ok"]:
        email = ""
    if phone and not HH.fence(reads, phone)["ok"]:
        phone = ""
    reh = IF.is_rehearsal_ask(ask)
    if email:
        built = IF.invite_email({"name": name, "link": link, "slots": labels,
                                 "subject": HH.render(s_(sit.get("email_subject")), mail_v)
                                 if s_(sit.get("email_subject")) else "",
                                 "bodyText": HH.render(s_(sit.get("email_text")), mail_v)
                                 if s_(sit.get("email_text")) else ""})
        HH.send(reads, situation=sid, to=email, body=built["text"], key="iask_offer_mail_" + ask_id, channel="email",
                subject=HH.tag_subject(reads, built["subject"]) if reh else built["subject"], html=built["html"],
                cc=HH.cc_for(reads, email) if reh else "", person=name)
    if phone:
        HH.send(reads, situation=sid, to=phone, body=HH.render(s_(sit.get("sms_text")) or
                                                               IF.FALLBACK["slots_offer_sms"], v),
                key="iask_offer_sms_" + ask_id, person=name)


def confirm(sess: L.Session, rows: list[dict], ask: dict, day: str, tm: str,
            how: str) -> tuple[dict[str, Any], list[dict]]:
    """interviewAskConfirm_: booked through the one scheduling writer, the ask confirmed, the candidate told."""
    reads = sess.reads
    door = other_door("hiringScheduleCreate")
    if door is None:
        return {"ok": False, "reason": "hiringScheduleCreate is not decided by this service"}, []
    sup = IF.supervisor(reads)
    cid = s_(ask.get("candidateid"))
    try:
        dec = door(L.Session(reads, dict(FLOW_ACTOR)), {
            "candidate_id": cid, "event_type": "in_person_interview", "date": day, "time": tm,
            "location": IF.last_location(reads), "with_name": sup.get("name"),
            "notes": "Booked by the interview scheduler — " + s_(how) + "."})
    except (Defer, hubdb.Unreadable) as exc:
        return {"ok": False, "reason": str(exc)[:200]}, []
    env = dec.answer or {}
    if dec.engine or env.get("status") != 200:
        return {"ok": False, "reason": s_(env.get("message")) or "schedule_failed"}, []
    now = W.now_iso(reads)
    recs = list(dec.edits or [])
    ask_id = s_(ask.get("askid"))
    recs += ask_write(reads, rows, ask_id, {"state": "confirmed", "confirmed_date": day, "confirmed_time": tm,
                                            "confirmed_at": now}, now)
    name = s_(ask.get("candidatename"))
    when = IF.slot_label(day, tm)
    csid = HH.sit_id(reads, IF.CANDIDATE_CONFIRMED)
    c_sit = HH.situation_on(reads, csid)
    if c_sit is not None:
        def fill(t: str) -> str:
            return s_(t).replace("{name}", name).replace("{first_name}", HH.greet_first(name)).replace("{when}", when)
        email = s_(ask.get("candidateemail"))
        phone = HH.sendable_phone(reads, ask.get("candidatephone"))
        if email and not HH.fence(reads, email)["ok"]:
            email = ""
        if phone and not HH.fence(reads, phone)["ok"]:
            phone = ""
        if email:
            subject = fill(s_(c_sit.get("email_subject")))
            HH.send(reads, situation=csid, to=email, body=fill(s_(c_sit.get("email_text"))),
                    key="iask_cconf_mail_" + ask_id, channel="email",
                    subject=HH.tag_subject(reads, subject) if IF.is_rehearsal_ask(ask) else subject, person=name)
        sms = fill(s_(c_sit.get("sms_text")))
        if phone and sms:
            HH.send(reads, situation=csid, to=phone, body=sms, key="iask_cconf_sms_" + ask_id, person=name)
    recs += HH.journey(reads, cid, name, {
        "step": "interview_booked", "channel": "email+sms", "ok": True, "ref": ask_id, "by": "asa-hub:interview-flow",
        "title": "Interview booked — " + when,
        "detail": "the candidate picked it (" + s_(how) + "); confirmations went to the interviewer and the candidate, "
                  "and it is on the Calendar app"})
    return {"ok": True}, recs


def apply(sess: L.Session, rows: list[dict], item: dict[str, Any], today: str) -> tuple[int, list[dict]]:
    """interviewAskApply_: what a verdict does, forward only."""
    reads = sess.reads
    verdict, want = item["verdict"], item.get("rehearsal")
    now = W.now_iso(reads)
    recs: list[dict] = []
    if verdict == "yes":
        ask = IF.waiting(rows, ("supervisor_asked",), want)
        if ask is None or not IF.slot_ok(s_(ask.get("pickeddate")), s_(ask.get("pickedtime"))):
            return 0, []
        day, tm = s_(ask.get("pickeddate")), s_(ask.get("pickedtime"))
        recs += ask_write(reads, rows, s_(ask.get("askid")), {"supervisor_reply": "yes"}, now)
        conf, more = confirm(sess, rows, ask, day, tm, "the interviewer said YES")
        recs += more
        if not conf["ok"]:
            log.warning("interview_confirm_failed: %s — %s", s_(ask.get("askid")), conf["reason"])
            return 0, recs
        tell(reads, ask, day, tm)
        recs += HH.journey(reads, s_(ask.get("candidateid")), s_(ask.get("candidatename")), {
            "step": "interview_booked", "channel": "calendar", "to": "", "ok": True, "ref": s_(ask.get("askid")),
            "by": "asa-hub:interview-flow", "detail": "booked " + day + " " + tm + " after the interviewer said yes"})
        return 1, recs
    if verdict == "no":
        ask = IF.waiting(rows, ("supervisor_asked",), want)
        if ask is None:
            return 0, []
        recs += ask_write(reads, rows, s_(ask.get("askid")), {"state": "slots_requested", "supervisor_reply": "no"}, now)
        slots_request(reads, ask)
        recs += HH.journey(reads, s_(ask.get("candidateid")), s_(ask.get("candidatename")), {
            "step": "interviewer_reply", "channel": "sms", "ok": True, "ref": s_(ask.get("askid")),
            "by": "asa-hub:interview-flow", "detail": "the interviewer said no — asked for three times instead"})
        return 1, recs
    if verdict == "slots" and item.get("slots"):
        ask = IF.waiting(rows, ("slots_requested", "supervisor_asked"), want)
        if ask is None:
            return 0, []
        valid = IF.slots_valid(item["slots"], today)
        if not valid:
            log.info("interview_slots_invalid: %s — the proposed slots did not validate (future weekdays, company "
                     "hours)", item["mid"])
            return 0, []
        recs += ask_write(reads, rows, s_(ask.get("askid")), {"state": "slots_offered", "slots_json":
                                                              json.dumps(valid, separators=(",", ":")),
                                                              "offered_at": now, "supervisor_reply": "slots"}, now)
        slots_offer(reads, ask, valid)
        recs += HH.sim_answer(reads, ["interview_slots"], "she sent her slots", s_(ask.get("candidateid")), now)
        return 1, recs
    return 0, []


def ear(sess: L.Session, prep: dict[str, Any]) -> tuple[dict[str, Any], list[dict], bool]:
    """interviewAskSweepRun_'s writes: each judged reply remembered and acted on, the mirror's cursor moved."""
    reads = sess.reads
    if prep.get("init_cursor"):
        HH.mark_set(IF.CURSOR, str(int(prep["init_cursor"])))
        return {"waiting": prep.get("waiting", 0), "initialized": prep["init_cursor"]}, [], True
    rows = [dict(r) for r in IF.ask_rows(reads)]
    today = IF.today_text(reads)
    seen = IF.judged(reads)
    recs: list[dict] = []
    acted = 0
    started = time.time()
    for item in prep.get("items") or []:
        if not isinstance(item, dict) or not s_(item.get("mid")) or item["mid"] in seen:
            continue
        if time.time() - started > SWEEP_BUDGET_S:
            break
        seen[item["mid"]] = s_(item.get("verdict"))
        recs += memo(reads, item, W.now_iso(reads))
        n, more = apply(sess, rows, item, today)
        acted += n
        recs += more
    own = False
    if prep.get("cursor") is not None:
        HH.mark_set(IF.CURSOR, str(int(prep["cursor"])))
        own = True
    if acted:
        log.info("interview_ask_sweep: %d reply(ies) acted on, %s ask(s) waiting", acted, prep.get("waiting"))
    return {"waiting": prep.get("waiting", 0), "acted": acted, "reached": prep.get("reached"),
            "mail": prep.get("mail") or []}, recs, own


def ask_sweep_now(sess: L.Session, payload: dict) -> Decision:
    """interviewAskSweepNow: the ear run on purpose, after interviewAskPrepare read and judged the replies."""
    user = sess.user or {}
    if not HH.writer(user):
        return Decision(dict(HH.DENIED))
    p = payload if isinstance(payload, dict) else {}
    if p.get("prepared") is None:
        raise Defer("interviewAskSweepNow is read by interviewAskPrepare first")
    prep = R.unsealed("interviewAskSweepNow", R.actor(user), p.get("prepared"))
    if prep is None:
        return W.refuse(409, STALE)
    out, recs, own = ear(sess, prep)
    return _done({"status": 200, "data": out}, recs, own=own)


def ask_sweep(sess: L.Session, payload: dict) -> Decision:
    """The ear on the relay's clock, after interviewAskDue."""
    if not HH.service(sess):
        return Decision(dict(HH.SERVICE_ONLY))
    p = payload if isinstance(payload, dict) else {}
    if p.get("prepared") is None:
        raise Defer("interviewAskSweep is read by interviewAskDue first")
    prep = R.unsealed("interviewAskSweep", "service", p.get("prepared"))
    if prep is None:
        return W.refuse(409, STALE)
    out, recs, own = ear(sess, prep)
    return _done({"status": 200, "data": out}, recs, own=own)


def start_sweep(sess: L.Session, payload: dict) -> Decision:
    """interviewStartSweepMaybe_: each card at Interview nobody asked about has its interviewer asked for slots."""
    if not HH.service(sess):
        return Decision(dict(HH.SERVICE_ONLY))
    reads = sess.reads
    actor = HH.as_actor(sess, "interview-start@service.local")
    recs: list[dict] = []
    pressed: list[str] = []
    for cid in IF.start_plan(reads):
        got, more = slots_ask(actor, cid, 3, "interview-start@service.local")
        recs += more
        d = got.get("data") or {}
        if d.get("sent") is False or got.get("status") != 200:
            log.info("interview_start_refused: %s — %s", cid, s_(d.get("reason")) or s_(got.get("message")) or
                     "the door refused")
            continue
        pressed.append(cid)
    if pressed:
        log.info("interview_started: %d card(s) at Interview had their interviewer asked: %s", len(pressed),
                 ", ".join(pressed)[:300])
    return _done({"status": 200, "data": {"pressed": len(pressed)}}, recs)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "interviewInviteSend": invite_door, "interviewDaysAskSend": days_ask_door, "interviewSlotsAsk": slots_ask_door,
    "interviewAskSweepNow": ask_sweep_now, "interviewAskSweep": ask_sweep, "interviewStartSweep": start_sweep}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
for _a in ("interviewInviteSend", "interviewDaysAskSend"):
    POLICY[_a] = {"params": {"candidate_id": "string"}}
POLICY["interviewSlotsAsk"] = {"params": {"candidate_id": "string", "slots_wanted": "string"}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}
