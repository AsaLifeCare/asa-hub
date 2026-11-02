"""The hiring sweep's clock riders recorded (talent_riders reads what is due): each a service-only write under the
platform's lock, the cards and the store rows written as facts on the dissolved hiring tabs, each journey line and
each closed ask too, the team told through Smart Comms. The crossings go through the Talent Pipeline's own doors
(talent_pipeline_writes)."""
from __future__ import annotations

import logging
import re
from typing import Any, Callable

import candidates as CND
import gsjs
import hiring_hired as HH
import locations as L
import mail_designs as MD
import smart_comms as SC
import talent_pipeline as TP
import talent_pipeline_writes as TPW
import talent_riders as TR
import writes as W
from hubdb import Unreadable
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")
s_ = gsjs.str_


def _service(sess: L.Session) -> Decision | None:
    return None if HH.service(sess) else Decision(dict(TR.SERVICE_ONLY))


def _done(answer: dict[str, Any], recs: list[dict], own: bool = False) -> Decision:
    kept = [e for e in recs if e and e.get("cells")]
    if not kept and not own:
        return Decision(answer)
    return Decision(answer, edits=kept or None, own=own)


def _said(who: str, action: str, detail: str) -> None:
    """hubSysLog_ for a machine: the service's own log."""
    log.info("%s: %s — %s", who, action, detail[:400])


def _keys(phone: Any, email: Any) -> set[str]:
    d = TP.digits10(phone)
    e = s_(email).lower()
    return {k for k in (("p:" + d) if len(d) == 10 else "", ("e:" + e) if "@" in e else "") if k}


# ---- the finisher ------------------------------------------------------------------------------------------------

def finish_sweep(sess: L.Session, payload: dict) -> Decision:
    """talentFinishSweepMaybe_: a card that stood at Ready to start for the configured minutes closes itself — archived
    with its finish reason, the mark cleared, a line on its journey."""
    refused = _service(sess)
    if refused:
        return refused
    reads = sess.reads
    W.gate(reads)
    now = W.now_iso(reads)
    recs: list[dict] = []
    done = 0
    for f in TR.finish_plan(reads)["finish"]:
        why = f["why"]
        recs += HH.card_facts(reads, f["cid"], {"archived": "true", "archived_at": now,
                                                "archived_reason": why or TR.FINISH_WHY, "talent_finish_at": ""},
                              TR.FINISH_BY, now)
        recs += HH.journey(reads, f["cid"], f["name"], {
            "step": "talent_finish", "channel": "record", "ok": True, "title": "Their record closed by itself",
            "detail": "they stood at Ready to start for the configured minutes and the platform finished them — " +
                      (why or "they already work here"), "by": TR.FINISH_BY})
        done += 1
    return _done({"status": 200, "data": {"finished": done}}, recs)


# ---- the automatic crossing ----------------------------------------------------------------------------------------

def autocross_sweep(sess: L.Session, payload: dict) -> Decision:
    """tpAutoCrossSweepMaybe_: armed on its first pass (applications signed before stay a press in Actions); then each
    signed application talentAutoCrossDue found becomes a card through the press's own door — at Ready to start, marked
    for the finisher, for somebody the company already employs."""
    refused = _service(sess)
    if refused:
        return refused
    p = payload if isinstance(payload, dict) else {}
    prep = TP.unsealed("talentAutoCrossSweep", "service", p.get("prepared"))
    if prep is None:
        return W.refuse(409, TP.STALE)
    reads = sess.reads
    W.gate(reads)
    if prep.get("arm"):
        if HH.mark(reads, TR.AUTOCROSS_ARMED):
            return Decision({"status": 200, "data": {"armed_at": "", "brought_in": 0}})
        armed = W.now_iso(reads)
        HH.mark_set(TR.AUTOCROSS_ARMED, armed)
        _said(TR.AUTOCROSS_BY, "talent_autocross_armed",
              f"the automatic crossing is armed from {armed} — applications signed before it stay a press in Actions")
        return _done({"status": 200, "data": {"armed_at": armed, "brought_in": 0}}, [], own=True)
    budget = int(prep.get("budget") or 0)
    at = W.now_iso(reads)
    recs: list[dict] = []
    done = 0
    crossed: set[str] = set()
    for item in prep.get("items") or []:
        if done >= budget:
            break
        name, landing = s_(item.get("name")), s_(item.get("landing")) or "new"
        keys = _keys(item.get("phone"), item.get("email"))
        if keys & crossed:
            # the card this pass already made holds them (hubFindDuplicate_)
            done += 1
            continue
        env = {"candidate": name, "phone": s_(item.get("phone")), "email": s_(item.get("email")),
               "location": s_(item.get("location")), "signaturerequestid": s_(item.get("srid"))}
        try:
            out, got = TPW.move_from_application(reads, env, landing, TR.AUTOCROSS_BY, at)
        except (Unreadable, Defer, W.NotKept):
            raise
        except Exception as exc:  # noqa: BLE001 - one refusal, said; the others still cross
            out, got = {"moved": False, "reason": str(exc)}, []
        if not out.get("moved"):
            _said(TR.AUTOCROSS_BY, "talent_autocross_refused", f"{name} — {s_(out.get('reason'))}")
            continue
        recs += got
        done += 1
        crossed |= keys
        if out.get("matched_existing"):
            continue
        hid = s_(out.get("candidate_id"))
        if landing == "ready":
            landed, _why = CND.soft(lambda: TPW.land_ready(sess, hid, name, s_(item.get("landing_why")), "", at,
                                                           who=TR.AUTOCROSS_BY))
            recs += landed or []
        signed = s_(item.get("signed"))
        recs += HH.journey(reads, hid, name, {
            "step": "talent_autocross", "channel": "record", "ok": True,
            "title": "They came in on their own signed application",
            "detail": "the platform brought them in without anybody pressing: they signed the application form on " +
                      (signed or "a day the envelope does not carry") + " and were in no other book — landing at " +
                      ("Ready to start" if landing == "ready" else "New")})
    skipped = int(prep.get("skipped") or 0)
    if done:
        _said(TR.AUTOCROSS_BY, "talent_autocross_pass",
              f"{done} brought in, {skipped} left for the queue" +
              (" (backlog included)" if prep.get("backlog") else f" (armed {s_(prep.get('armed_day'))}, backlog "
                                                                  "excluded)"))
    else:
        TR.idle("talent-autocross", f"ran and took nobody — {int(prep.get('waiting') or 0)} waiting, {skipped} skipped"
                + (" (backlog included)" if prep.get("backlog") else
                   f" (armed {s_(prep.get('armed_day'))}; everything signed before that day is a press in Actions, "
                   "and sim_talent_autocross_backlog is off)"))
    return _done({"status": 200, "data": {"brought_in": done, "skipped": skipped}}, recs)


# ---- the store's no-contact archive --------------------------------------------------------------------------------

def nocontact_sweep(sess: L.Session, payload: dict) -> Decision:
    """tpArchiveNoContactMaybe_: only reachable people wait in the store — a row with no phone and no e-mail is
    archived (never deleted)."""
    refused = _service(sess)
    if refused:
        return refused
    reads = sess.reads
    W.gate(reads)
    now = W.now_iso(reads)
    recs: list[dict] = []
    names = []
    for r in TR.nocontact_plan(reads)["rows"]:
        recs += TPW.facts(reads, TR.STORE, r["id"], {"archived": "true", "archived_at": now,
                                                     "archived_by": TR.NOCONTACT_BY,
                                                     "archived_reason": TR.NOCONTACT_WHY}, "runtime-sheet", now)
        names.append(r["name"])
    if names:
        _said(TR.NOCONTACT_BY, "talent_nocontact_archived",
              f"{len(names)} store row(s) archived for having no contact at all: " + ", ".join(names)[:400])
    return _done({"status": 200, "data": {"archived": len(names)}}, recs)


# ---- the rehearsal cards -------------------------------------------------------------------------------------------

def test_cards_sweep(sess: L.Session, payload: dict) -> Decision:
    """testCardArchiveMaybe_: rehearsal cards do not hold the queue — one untouched for sim_archive_test_days is
    archived so it stops counting against the release floor."""
    refused = _service(sess)
    if refused:
        return refused
    reads = sess.reads
    W.gate(reads)
    plan = TR.test_cards_plan(reads)
    days = plan["days"]
    now = W.now_iso(reads)
    recs: list[dict] = []
    names = []
    for c in plan["cards"]:
        recs += HH.card_facts(reads, c["cid"], {
            "archived": "true", "archived_at": now, "archived_by": TR.TEST_CARDS_BY,
            "archived_reason": f"a rehearsal card, untouched for {days} day(s) — archived so it stops counting against "
                               "the release floor. Nothing was deleted."}, TR.TEST_CARDS_BY, now)
        names.append(c["name"])
    if names:
        _said(TR.TEST_CARDS_BY, "test_cards_archived",
              f"{len(names)} rehearsal card(s) archived after {days} quiet day(s): " + ", ".join(names)[:300])
    return _done({"status": 200, "data": {"archived": len(names)}}, recs)


# ---- seven tries and nothing back ------------------------------------------------------------------------------------

def _fill(text: str, vars_: dict[str, str]) -> str:
    for k, v in vars_.items():
        text = text.replace("{" + k + "}", v)
    return text


def _tell(reads: L.Reads, sid: str, sit: dict, item: dict, reason: str, said: str, when: str) -> int:
    """The team told once, by letter (hiringTeamRecipients_; a rehearsal's to the deciders, the watchers in copy),
    through Smart Comms under the situation; the letters raised."""
    cid = item["cid"]
    name = item["name"] or cid
    vars_ = {"name": name, "candidate": name, "tries": said, "phone": item["phone"], "email": item["email"]}
    addr = HH.team_address(reads) if item.get("rehearsal") else None
    to = (addr or {}).get("to") or ", ".join(HH.team_emails(reads))
    letter = MD.hiring_discard_email({
        "name": name, "reason": reason, "stage": "Outreach", "when": when, "by": "the platform, after " + said,
        "subject": _fill(s_(sit.get("email_subject")), vars_), "bodyText": _fill(s_(sit.get("email_text")), vars_)})
    subject = HH.tag_subject(reads, s_(letter.get("subject")))
    cc = (addr or {}).get("cc") or ""
    lane = f"hiring: nobody could reach {name} — archived"
    raised = 0
    for i, a in enumerate(x.strip() for x in re.split(r"[,;]+", to) if x.strip()):
        SC.raise_situation(None, situation=sid, to=a, vars={}, key=f"unreach_mail_{cid}|{a.lower()}", person=name,
                           person_key=cid, lane=lane, prune=False, channel="email", body=s_(letter.get("text")),
                           subject=subject, html=s_(letter.get("html")) or None, cc=(cc or None) if i == 0 else None,
                           transport=True)
        raised += 1
    return raised


def _contact_failed(reads: L.Reads, plan: dict[str, Any]) -> tuple[list[dict], int]:
    """hiring_contact_failed: a card whose phone-collect or phone-confirm tries ran out, told once to whoever the
    Desk's `to` names (the hiring team while it is blank; a rehearsal's deciders for a rehearsal card); the card stays
    at New. The journey line is the memo that it was told."""
    import screening_writes as SGW  # noqa: PLC0415 - the Desk's own `to`, as the screen report reads it
    recs: list[dict] = []
    sit = HH.situation_on(reads, plan["failed_sid"]) if plan.get("failed_on") else None
    if sit is None:
        return recs, 0
    told = 0
    for item in plan.get("failed") or []:
        cid, name = item["cid"], item["name"] or item["cid"]
        if item.get("rehearsal"):
            to = [x.strip() for x in re.split(r"[,;]+", HH.team_address(reads).get("to") or "") if x.strip()]
        else:
            to = SGW.desk_to(sit, HH.team_emails(reads))
        vars_ = {"name": name, "email": item["email"] or "no e-mail", "phone": item["phone"] or "no phone"}
        try:
            sent = SGW.tell_desk(reads, plan["failed_sid"], to, vars_, "contact_failed_" + cid, name)
        except (Unreadable, Defer, W.NotKept):
            raise
        except Exception as exc:  # noqa: BLE001 - not told now, asked again on the next pass
            log.warning("%s: contact_failed_notice_failed — %s — %s", TR.UNREACHABLE_BY, cid, str(exc)[:200])
            continue
        which = "phone confirmation" if item["step"] == "phone_confirm" else "phone collection"
        recs += HH.journey(reads, cid, name, {
            "step": TR.CONTACT_FAILED_STEP, "channel": "record", "ok": sent,
            "title": "Could not reach them — the team was told",
            "detail": f"the {which} ran out after {item['tries']} with no answer; the card stays at New"
                      + ("" if sent else " (the telling was held: " + ", ".join(to)[:120] + ")"),
            "by": TR.UNREACHABLE_BY})
        told += 1
    return recs, told


def unreachable_sweep(sess: L.Session, payload: dict) -> Decision:
    """unreachableArchiveSweepMaybe_: a card still at New whose outreach (or manual first-contact) ask ran out of tries
    is archived, the team told once, its asks closed so no ear or retry revisits it — just before the floor under
    New."""
    refused = _service(sess)
    if refused:
        return refused
    reads = sess.reads
    W.gate(reads)
    plan = TR.unreachable_plan(reads)
    when = W.now_iso(reads)
    recs, failed_told = _contact_failed(reads, plan)
    sit = HH.situation_on(reads, plan["sid"]) if plan["on"] else None
    if sit is None:
        return _done({"status": 200, "data": {"archived": 0, "contact_failed": failed_told}}, recs,
                     own=bool(failed_told))
    names = []
    told = 0
    for item in plan["items"]:
        cid, name, said = item["cid"], item["name"], item["tries"]
        reason = f"nobody could reach them — {said} on every contact we hold, no answer"
        recs += HH.card_facts(reads, cid, {"archived": "true", "archived_at": when, "archived_by": TR.UNREACHABLE_BY,
                                           "archived_reason": reason}, TR.UNREACHABLE_BY, when)
        try:
            told += _tell(reads, plan["sid"], sit, item, reason, said, when)
        except (Unreadable, Defer, W.NotKept):
            raise
        except Exception as exc:  # noqa: BLE001 - the archive stands either way
            log.warning("%s: unreachable_notice_failed — %s — %s", TR.UNREACHABLE_BY, cid, str(exc)[:200])
        recs += HH.sim_answer(reads, TR.TRIED_STEPS, "archived — nobody could reach them", cid, when)
        recs += HH.journey(reads, cid, name, {
            "step": "outreach", "channel": "record", "ok": True, "title": "Nobody could reach them — archived",
            "detail": reason + ". The team was told once, and the next name in the queue comes in on this same pass.",
            "by": TR.UNREACHABLE_BY})
        names.append(name or cid)
    if names:
        _said(TR.UNREACHABLE_BY, "unreachable_archived",
              f"{len(names)} archived after every configured try with no answer: " + ", ".join(names)[:300])
    return _done({"status": 200, "data": {"archived": len(names), "letters": told, "contact_failed": failed_told}},
                 recs, own=bool(told) or bool(failed_told))


# ---- the floor under New -------------------------------------------------------------------------------------------

def autofill_sweep(sess: L.Session, payload: dict) -> Decision:
    """tpAutoFillNewMaybe_: the board does not starve while nobody is watching — the queue's next names come in
    through talentCrossIn, the same door a press uses, as talentAutoFillDue read them."""
    refused = _service(sess)
    if refused:
        return refused
    p = payload if isinstance(payload, dict) else {}
    prep = TP.unsealed("talentAutoFillSweep", "service", p.get("prepared"))
    if prep is None:
        return W.refuse(409, TP.STALE)
    reads = sess.reads
    W.gate(reads)
    take = int(prep.get("take") or 0)
    at_new, floor, idle_hours = prep.get("at_new"), prep.get("floor"), prep.get("idle_hours")
    actor = L.Session(reads, {"role": "admin", "email": TR.AUTOFILL_BY})
    recs: list[dict] = []
    done = refused_n = 0
    crossed: set[str] = set()
    for q in prep.get("ready") or []:
        if done >= take:
            break
        tid, srid, name = s_(q.get("tp_candidate_id")), s_(q.get("srid")), s_(q.get("name"))
        keys = _keys(q.get("phone"), q.get("email")) | ({"n:" + TP.name_key(name)} if TP.name_key(name) else set())
        if keys & crossed:
            # the card this pass already made holds them (tpAlreadyHere_)
            done += 1
            continue
        try:
            d = TPW.cross_in(actor, {"tp_candidate_id": tid} if tid else {"srid": srid})
            res = dict(d.answer or {})
            recs += [e for e in d.edits or [] if e]
        except (Unreadable, Defer, W.NotKept):
            raise
        except Exception as exc:  # noqa: BLE001 - one refusal; the next name is tried
            res = {"status": 500, "message": str(exc)}
        got = res.get("data") if isinstance(res.get("data"), dict) else {}
        if res.get("status") == 200 and (got.get("moved") or got.get("matched_existing")):
            done += 1
            crossed |= keys
            if got.get("matched_existing"):
                continue
            recs += HH.journey(reads, s_(got.get("candidate_id")), name, {
                "step": "talent_autofill", "channel": "record", "ok": True,
                "title": "The platform started them because the board had run dry",
                "detail": f"only {at_new} card(s) stood at New and no person had moved one for {idle_hours} hours, so "
                          "the queue's next name came in"})
        else:
            refused_n += 1
    if not done and not refused_n:
        TR.idle("talent-autofill", "every condition held and yet nobody came in — worth looking at")
    if done or refused_n:
        _said(TR.AUTOFILL_BY, "talent_autofill_pass",
              f"{done} started (New had {at_new} of {floor}, idle {idle_hours}h)" +
              (f", {refused_n} refused" if refused_n else ""))
    return _done({"status": 200, "data": {"started": done, "refused": refused_n}}, recs)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "talentFinishSweep": finish_sweep, "talentAutoCrossSweep": autocross_sweep,
    "talentNoContactSweep": nocontact_sweep, "testCardsSweep": test_cards_sweep,
    "unreachableSweep": unreachable_sweep, "talentAutoFillSweep": autofill_sweep}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}
