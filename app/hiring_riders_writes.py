"""The hiring sweep's riders (HiringOutreach.gs) recorded on Python, each after its look (hiring_riders) on the relay's
clock: the cut call asked again, the referral ladder's relay and its discard, the Added Manually machine (its first
presses, the adder relay and discard, the 4040 door and the next step it fires), the director cards' collector and the
call instruction nobody was given. Every message goes through Smart Comms — the outreach transports for the candidate's
own (HiringOutreach's Run), its idempotency key for a lane that wrote its words whole; every journey line, ask, archive
mark, status move and phone-screen row is a fact on the dissolved hiring tabs; the seen-once memos are hiring marks."""
from __future__ import annotations

import json
import logging
import re
import secrets
import time
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import gsjs
import hiring_hired as HH
import hiring_hired_writes as HHW
import hiring_outreach as HO
import hiring_outreach_letters as HL
import hiring_outreach_writes as HOW
import hiring_riders as HR
import hiring_sim as HS
import hiring_sim_writes as HSW
import locations as L
import mail_designs as MD
import recon as R
import resume_intake_writes as RIW
import smart_comms as SC
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")
s_ = gsjs.str_
STALE = HHW.STALE
REDO_BY = "asa-hub:screen-redo"
REDO_REASON = "hiring: the screening call was cut — asking for one more try"
LADDER_BY = "asa-hub:referral-ladder"
MANUAL_BY = "asa-hub:manual-ladder"
DOCS_BY = "asa-hub:director-docs"
DISCARD_REASON = "The referral could not be reached — nobody had a phone or a resume"
MANUAL_DISCARD = "Nobody could reach them — seven tries and the person who added them could not help"


class Pass(HOW.Run):
    """One rider's pass as the machine: the outreach transports, the journey and the ask book of HiringOutreach's
    Run, under the rider's own name; the book read whole (never blind), a new ask's attempts from the simulator's
    whole config."""

    def __init__(self, sess: L.Session, by: str) -> None:
        super().__init__(sess)
        self.by = by

    def asks(self) -> list[dict]:
        if self._asks is None:
            self._asks = [dict(r) for r in HH.sim_rows(self.reads)]
        return self._asks

    def track(self, step: str, cid: str, action: str, payload: dict) -> dict[str, Any]:
        """simTrackSend_: the open ask of this step and card bumped, or a new one entered."""
        cfg = HS.attempts_for(self.reads, step)
        rows = self.asks()
        for r in reversed(rows):
            if s_(r.get("step")) != step or s_(r.get("candidateid")) != (cid or ""):
                continue
            if s_(r.get("state")) != "open":
                break
            n = HO.int_of(r.get("sentcount"), 0) + 1
            self.recs += CW.facts_of(self.reads, HO.SIM_ASKS_TAB, s_(r.get("simaskid")),
                                     {"sent_count": str(n), "last_sent_at": self.now}, "runtime-sheet", cid, "",
                                     at=self.now)
            r.update(sentcount=str(n), lastsentat=self.now)
            return {"id": s_(r.get("simaskid")), "attempt": n, "of": cfg["attempts"]}
        aid = "SIMASK_" + secrets.token_hex(4).upper()
        row = {"sim_ask_id": aid, "step": step, "candidate_id": cid or "", "action": action,
               "payload_json": json.dumps(payload or {}, ensure_ascii=False, separators=(",", ":"))[:4000],
               "sent_count": "1", "max_attempts": str(cfg["attempts"]), "interval_minutes": str(cfg["minutes"]),
               "last_sent_at": self.now, "state": "open", "answered_at": "", "answered_by": "", "created_at": self.now}
        self.recs += CW.facts_of(self.reads, HO.SIM_ASKS_TAB, aid, row, "runtime-sheet:append", cid, "", at=self.now)
        rows.append({k.replace("_", ""): v for k, v in row.items()})
        return {"id": aid, "attempt": 1, "of": cfg["attempts"]}

    def line(self, cid: str, name: str, step: str, channel: str, ok: bool, detail: str, **more: Any) -> None:
        self.journey({"candidate_id": cid, "name": name, "step": step, "channel": channel, "ok": ok, "detail": detail,
                      "by": self.by, **more})

    def archive(self, cid: str, reason: str) -> None:
        """The house soft-archive (manualSoftArchive_, the ladder's discard): the marks on the card, nothing deleted."""
        self.recs += CW.facts_of(self.reads, CW.CANDIDATES, cid, {"archived": "true", "archived_at": self.now,
                                                                   "archived_by": self.by, "archived_reason": reason},
                                 self.by, cid, "", at=self.now)


def _done(answer: dict[str, Any], recs: list[dict], own: bool = False) -> Decision:
    kept = [e for e in recs if e and e.get("cells")]
    if not kept and not own:
        return Decision(answer)
    return Decision(answer, edits=kept or None, own=own)


def _open(sess: L.Session, payload: Any, door: str) -> tuple[dict | None, Decision | None]:
    """The relay's own write, handed its look's sealed answer; the hiring facts must be where these doors keep them."""
    if not HH.service(sess):
        return None, Decision(dict(HR.SERVICE_ONLY))
    p = payload if isinstance(payload, dict) else {}
    if p.get("prepared") is None:
        raise Defer(f"{door} is read by its look first")
    prep = R.unsealed(door, "service", p.get("prepared"))
    if prep is None:
        return None, W.refuse(409, STALE)
    db = sess.reads.db
    if not (db.dissolved(CW.JOURNEY) and db.dissolved(HO.SIM_ASKS_TAB) and db.dissolved(CW.CANDIDATES)):
        raise Defer("the hiring journey, the ask book and the candidates are kept as facts only while dissolved")
    W.gate(sess.reads)
    return prep, None


def press(reads: L.Reads, door: Callable[[L.Session, dict], Decision], actor: dict,
          payload: dict) -> tuple[dict | None, list[dict], str]:
    """HUB_ACTIONS[door](payload, actor) inside this write, in Apps Script's try/catch: its answer and its records, or
    None and why, every row it kept taken back."""
    try:
        got, why = HSW.softly(lambda: door(L.Session(reads, actor), payload))
    except Defer as exc:
        return None, [], str(exc)[:200] or "deferred"
    if got is None:
        return None, [], why
    if got.engine or got.lay or got.deliver or got.record:
        return None, [], "the door hands its write elsewhere"
    return dict(got.answer or {}), list(got.edits or []), ""


def tell(reads: L.Reads, situation: str, to: str, body: str, key: str, name: str, channel: str = "sms",
         subject: str = "", html: str = "", cc: str = "") -> dict[str, Any]:
    """rpcCall_('smsSend' | 'emailSend', …, {idempotency_key}) for a lane that wrote its words whole: through Smart
    Comms, every brake deciding; a letter to a list goes once per address, the copy list on the first."""
    if channel == "sms":
        return HH.send(reads, situation=situation, to=to, body=body, key=key, person=name)
    got: dict[str, Any] | None = None
    for i, addr in enumerate(a.strip() for a in re.split(r"[,;]+", to) if a.strip()):
        one = HH.send(reads, situation=situation, to=addr, body=body, key=key + "|" + addr.lower(), channel="email",
                      subject=subject, html=html, cc=cc if i == 0 else "", person=name)
        if got is None or (HH.went(one) and not HH.went(got)):
            got = one
    return got or {"state": "no_address", "why": "nobody to write to"}


def said(got: dict[str, Any]) -> str:
    """rs.error || rs.reason, else 'refused'."""
    return HH.why_not(got) or "refused"


def paras(text: str) -> list[str]:
    return [MD.mail_para(MD.mail_esc(p).replace("\n", "<br>")) for p in re.split(r"\n{2,}", text)]


def _late(started: float) -> bool:
    return time.monotonic() - started > HHW.SWEEP_BUDGET_S


# ---- the cut call, asked again (screenRedoSweepMaybe_) --------------------------------------------------------------

def screen_redo_sweep(sess: L.Session, payload: dict) -> Decision:
    """Each open screen_call ask its look read: a complete call rests the loop; a cut one not nudged yet asks the
    candidate to call again, letter and text together, once per call."""
    prep, refused = _open(sess, payload, "screenRedoSweep")
    if refused:
        return refused
    if not prep.get("on") or not prep.get("items"):
        return Decision({"status": 200, "data": {"on": bool(prep.get("on")), "rested": 0, "asked": 0}})
    reads = sess.reads
    sid = HO.sid(reads, "screen_redo")
    allow = HO.allowed(reads, sid)
    if not allow["ok"]:
        return Decision({"status": 200, "data": {"on": False, "rested": 0, "asked": 0}})
    run = Pass(sess, REDO_BY)
    seen = HR.marks(reads, HR.REDO_SEEN)
    # the number as a person reads it, as the first screening invitation says it
    line = HL.line_label(HO.actors(reads)["screen_line"]) or HO.actors(reads)["screen_line"]
    rested = asked = 0
    started = time.monotonic()
    for it in prep["items"]:
        if _late(started):
            break
        cid, name, call = s_(it.get("cid")), s_(it.get("name")), s_(it.get("call"))
        if it.get("rest"):
            run.answer(("screen_call",), "a complete call arrived (" + call + ")", cid)
            run.line(cid, name, "screen_watch", "record", True,
                     "the candidate's call reached its goodbye — the loop rests; the evaluation reads it next")
            rested += 1
            continue
        if call in seen:
            continue
        c = HR.cand_of(reads, cid)
        if not c:
            continue
        first = HO.greet_first(name)

        def words(field: str, key: str, floor: str, first: str = first) -> str:
            v = HO.sit_cell(allow, field) or HR.sim_text(reads, key)
            return HO.fill(v or floor, {"first_name": first, "screen_line": line, "line": line})
        subject = words("email_subject", "screen_redo_subject", HO.book(reads, "screen_redo.subject.floor"))
        body = words("email_text", "screen_redo_body", HO.book(reads, "screen_redo.body.floor"))
        html = MD.mail_shell({"eyebrow": "ASA LifeCare", "title": HO.book(reads, "screen_redo.title"),
                              "preheader": HO.book(reads, "screen_redo.preheader"),
                              "blocks": [MD.mail_para(MD.mail_esc(p).replace("\n", "<br>")) for p in body.split("\n\n")],
                              "cta": None, "footnote": HO.book(reads, "screen_redo.footnote")})
        sent = False
        email = s_(c.get("email"))
        if "@" in email:
            rm = run.letter(step="screen_watch", to=email, cc="", letter={"subject": subject, "text": body, "html": html},
                            reason=REDO_REASON, situation=sid, cid=cid, name=name, by=REDO_BY)
            sent = sent or rm["sent"]
        phone = HO.sendable_phone(reads, s_(c.get("phone")))
        if phone:
            rs = run.sms(step="screen_watch", to=phone,
                         body=words("sms_text", "screen_redo_sms", HO.book(reads, "screen_redo.sms.floor")),
                         intro=HO.quo_intro(reads, HO.book(reads, "purpose.screen_redo")), reason=REDO_REASON,
                         situation=sid, cid=cid, name=name, by=REDO_BY)
            sent = sent or rs["sent"]
        if sent:
            seen[call] = run.now
            asked += 1
            run.line(cid, name, "screen_watch", "email", True,
                     "THE LOOP: the call (" + call + ") ended without a goodbye — cut. The candidate was asked to call "
                     "again, e-mail and text together; the watch continues.")
    if asked:
        HH.mark_set(HR.REDO_SEEN, json.dumps(seen, separators=(",", ":")))
    return _done({"status": 200, "data": {"rested": rested, "asked": asked}}, run.recs, own=bool(asked))


# ---- the referral ladder's mouth (referralRelaySweepMaybe_) ---------------------------------------------------------

def _relay_send(run: Pass, c: dict, cid: str, book: dict, attempt: int, rehearsal: bool) -> bool:
    """One relay round to the referrer — text and/or letter, whichever the book holds; off, nothing leaves."""
    reads = run.reads
    lane = HO.Lane(reads, "hiring_referral_relay")
    if not lane.on:
        return False
    name = s_(c.get("candidatename"))
    ref = s_(book.get("referrername")) or HO.book(reads, "referral_relay.referrer.floor")
    ref_email = s_(book.get("referreremail"))
    d = HR.ten(book.get("referrerphone"))
    ref_phone = "+1" + d if len(d) == 10 and d not in SC.SHARED_LINE_DIGITS else ""
    vars_ = {"name": name, "first_name": HO.greet_first(name), "referrer": ref}
    suffix = f"_a{attempt}" if attempt > 1 else ""
    sent = False
    if ref_phone and lane.leg("sms"):
        body = lane.word("sms_text", HO.fill(HR.sim_text(reads, "referral_relay_sms"), vars_)
                         or HO.book(reads, "referral_relay.sms.floor").replace("{name}", name), vars_)
        body = HO.tag_subject(reads, body)
        if rehearsal:
            run.line(cid, name, "resume_request", "sms", True, "THE LADDER (rehearsal): the text to " + ref +
                     " is narrated, never sent — a rehearsal reaches no real referrer", rehearsal=True)
            sent = True
        else:
            got = tell(reads, "hiring_referral_relay", ref_phone, body, "ref_relay_sms_" + cid + suffix, name)
            ok = HH.went(got)
            sent = sent or ok
            run.line(cid, name, "resume_request", "sms", ok, "THE LADDER: " + name + " never answered — " + ref +
                     " is asked by text for a phone or a resume (attempt " + str(attempt) + ")" +
                     ("" if ok else " — not sent: " + said(got)), to=ref_phone)
    if "@" in ref_email and lane.leg("email"):
        subject = HO.tag_subject(reads, lane.word(
            "email_subject", HO.fill(HR.sim_text(reads, "referral_relay_subject"), vars_)
            or HO.book(reads, "referral_relay.subject.floor").replace("{name}", name), vars_))
        body = lane.word("email_text", HO.fill(HR.sim_text(reads, "referral_relay_body"), vars_)
                         or HO.book(reads, "referral_relay.body.floor").replace("{referrer}", ref).replace("{name}", name),
                         vars_)
        html = MD.mail_shell({"eyebrow": "ASA LifeCare",
                              "title": HO.book(reads, "referral_relay.title").replace("{name}", name),
                              "preheader": HO.book(reads, "referral_relay.preheader"), "blocks": paras(body),
                              "cta": None, "footnote": HO.book(reads, "referral_relay.footnote")})
        to = ref_email
        if rehearsal:
            to = HO.team_address(reads)["to"]
            if not to:
                run.line(cid, name, "resume_request", "email", False, "THE LADDER (rehearsal): no actor mailbox "
                         "(sim_team_email) — the letter leg is skipped", rehearsal=True)
        if to:
            got = tell(reads, "hiring_referral_relay", to, body, "ref_relay_mail_" + cid + suffix, name, "email",
                       subject, html)
            ok = HH.went(got)
            sent = sent or ok
            run.line(cid, name, "resume_request", "email", ok, "THE LADDER: " + name + " never answered — " + ref +
                     " is asked by letter for a phone or a resume (attempt " + str(attempt) + ")" +
                     (" (rehearsal — redirected to the actor mailbox)" if rehearsal else "") +
                     ("" if ok else " — not sent: " + said(got)), to=to)
    return sent


def _relay_discard(run: Pass, c: dict, cid: str, book: dict) -> None:
    """The ladder's end: soft-archived, the book discarded, the team told once by letter, both asks closed."""
    reads = run.reads
    name = s_(c.get("candidatename"))
    when = run.now
    run.archive(cid, DISCARD_REASON)
    HOW.referral_book_set(run, cid, {"state": "discarded", "state_detail": DISCARD_REASON[:500], "resolved_at": when})
    lane = HO.Lane(reads, "hiring_referral_discarded")
    if lane.on and lane.leg("email"):
        ref = s_(book.get("referrername")) or HO.book(reads, "referral_relay.referrer.floor")
        first = HO.greet_first(name)
        fills = {"name": name, "first_name": first, "referrer": ref}
        vars_ = {"name": name or cid, "first_name": first, "referrer": ref, "reason": DISCARD_REASON}
        addr = HO.team_address(reads) if HS.is_rehearsal(reads, cid) else None
        to = (addr or {}).get("to") or ", ".join(HO.team_of(reads)["emails"])
        letter = HL.discard({
            "name": name or cid, "reason": DISCARD_REASON, "stage": "Referral outreach", "when": when, "by": LADDER_BY,
            "subject": lane.word("email_subject", HO.fill(HR.sim_text(reads, "referral_discard_subject"), fills)
                                 or (name + " was discarded from our selection processes"), vars_),
            "bodyText": lane.word("email_text", HO.fill(HR.sim_text(reads, "referral_discard_body"), fills), vars_)})
        got = tell(reads, "hiring_referral_discarded", to, s_(letter["text"]), "ref_discard_" + cid, name, "email",
                   HO.tag_subject(reads, s_(letter["subject"])), s_(letter["html"]), (addr or {}).get("cc", ""))
        ok = HH.went(got)
        run.line(cid, name, "resume_request", "email", ok, DISCARD_REASON + " — soft-archived; Arthur and Ty told once" +
                 ("" if ok else " (the letter did not go: " + said(got) + ")"), to=to,
                 title="The ladder ended — the referral was discarded")
    run.answer(("resume_request", "referral_relay"), "the ladder ended — discarded", cid)


def referral_relay_sweep(sess: L.Session, payload: dict) -> Decision:
    """Each referral its look found due: the referrer asked (first after the person's quiet, again on the relay's
    clock, a second day the next Ohio morning), or the card discarded."""
    prep, refused = _open(sess, payload, "referralRelaySweep")
    if refused:
        return refused
    reads = sess.reads
    run = Pass(sess, LADDER_BY)
    out = {"asked": 0, "discarded": 0}
    started = time.monotonic()
    for it in prep.get("items") or []:
        if _late(started):
            break
        cid, kind = s_(it.get("cid")), s_(it.get("kind"))
        c = HR.cand_of(reads, cid)
        book = HO.referral_book_row(reads, cid)
        if not c or not book:
            continue
        if kind == "discard":
            _relay_discard(run, c, cid, book)
            out["discarded"] += 1
            continue
        rehearsal = HH.is_test(reads, c)
        if not _relay_send(run, c, cid, book, 1 if kind != "again" else int(it.get("attempt") or 1), rehearsal):
            continue
        out["asked"] += 1
        run.track("referral_relay", cid, "referralRelaySweepMaybe_", {"candidate_id": cid})
        if kind == "first":
            HOW.referral_book_set(run, cid, {"state": "asking_referrer"})
        elif kind == "day2":
            ref = s_(book.get("referrername")) or HO.book(reads, "referral_relay.referrer.floor")
            run.line(cid, s_(c.get("candidatename")), "resume_request", "record", True,
                     "yesterday's seven to " + ref + " went unanswered — a fresh seven starts this Ohio morning, "
                     "asking for any contact they hold", title="The second day of asking begins")
    return _done({"status": 200, "data": out}, run.recs)


# ---- the Added Manually machine (manualContactSweepMaybe_, manualAdderSweepMaybe_, manualCallDoorRun_) ---------------

def _adder_send(run: Pass, c: dict, cid: str, adder: dict, attempt: int, lbl: str) -> bool:
    """One adder round — the letter always, the text when a number exists; off, nothing leaves."""
    reads = run.reads
    lane = HO.Lane(reads, "hiring_manual_adder_ask")
    if not lane.on:
        return False
    name = s_(c.get("candidatename"))
    lines = ["Name: " + (name or cid)]
    for label, key in (("Phone: ", "phone"), ("E-mail: ", "email"), ("Source: ", "source")):
        if s_(c.get(key)):
            lines.append(label + s_(c.get(key)))
    if s_(c.get("createdat")):
        lines.append("Applied: " + s_(c.get("createdat"))[:10])
    data = "\n".join(lines)
    vars_ = {"name": name, "first_name": HO.greet_first(name), "adder": adder["name"] or "you", "data": data,
             "screen_line": lbl}
    rehearsal = HH.is_test(reads, c)
    suffix = f"_a{attempt}" if attempt > 1 else ""
    sent = False
    subject = HO.tag_subject(reads, lane.word(
        "email_subject", HO.fill(HR.sim_text(reads, "manual_adder_subject"), vars_)
        or HO.book(reads, "manual_adder.subject.floor").replace("{name}", name), vars_))
    body = lane.word("email_text", HO.fill(HR.sim_text(reads, "manual_adder_body"), vars_) or HO.book(
        reads, "manual_adder.body.floor").replace("{adder}", adder["name"] or HO.book(reads, "manual_adder.greeting.floor"))
        .replace("{name}", name).replace("{line}", lbl).replace("{data}", data), vars_)
    html = MD.mail_shell({"eyebrow": "ASA LifeCare", "title": HO.book(reads, "manual_adder.title").replace("{name}", name),
                          "preheader": HO.book(reads, "manual_adder.preheader"), "blocks": paras(body), "cta": None,
                          "footnote": HO.book(reads, "manual_adder.footnote")})
    to = adder["email"] if lane.leg("email") else ""
    if rehearsal and to:
        to = HO.team_address(reads)["to"]
        if not to:
            run.line(cid, name, "manual_contact", "email", False, "THE ADDER ASK (rehearsal): no actor mailbox "
                     "(sim_team_email) — the letter leg is skipped", rehearsal=True)
    if to:
        got = tell(reads, "hiring_manual_adder_ask", to, body, "man_adder_mail_" + cid + suffix, name, "email", subject,
                   html)
        ok = HH.went(got)
        sent = sent or ok
        run.line(cid, name, "manual_contact", "email", ok, "nobody could reach " + name + " — " + adder["name"] +
                 " (who added them) is asked by letter: withdraw, or reach them yourself; the screen line starts the "
                 "phone screening (attempt " + str(attempt) + ")" +
                 (" (rehearsal — redirected to the actor mailbox)" if rehearsal else "") +
                 ("" if ok else " — not sent: " + said(got)), to=to, title="The adder is asked")
    d = HR.ten(adder["phone"])
    if len(d) == 10 and d not in SC.SHARED_LINE_DIGITS and lane.leg("sms"):
        sms = HO.tag_subject(reads, lane.word("sms_text", HO.fill(HR.sim_text(reads, "manual_adder_sms"), vars_) or HO.book(
            reads, "manual_adder.sms.floor").replace("{name}", name).replace("{line}", lbl), vars_))
        if rehearsal:
            run.line(cid, name, "manual_contact", "sms", True, "THE ADDER ASK (rehearsal): the text to " + adder["name"] +
                     " is narrated, never sent — a rehearsal reaches no real adder", rehearsal=True)
            sent = True
        else:
            got = tell(reads, "hiring_manual_adder_ask", "+1" + d, sms, "man_adder_sms_" + cid + suffix, name)
            ok = HH.went(got)
            sent = sent or ok
            run.line(cid, name, "manual_contact", "sms", ok, "the adder ask by text to " + adder["name"] + " (attempt " +
                     str(attempt) + ")" + ("" if ok else " — not sent: " + said(got)), to="+1" + d)
    return sent


def _adder_pass(run: Pass, items: list[dict], started: float) -> int:
    """Mouth #2: whoever added an unreachable card asked, or the card discarded (silently, the dictated end)."""
    reads = run.reads
    lbl = HR.label(HR.screen_line(reads))
    acted = 0
    for it in items:
        if _late(started):
            break
        cid = s_(it.get("cid"))
        c = HR.cand_of(reads, cid)
        if not c or HO.archived(c):
            continue
        name = s_(c.get("candidatename"))
        if it.get("kind") == "discard":
            run.archive(cid, MANUAL_DISCARD)
            run.answer(("manual_contact", "manual_adder"), "the machine ended — discarded", cid)
            run.line(cid, name, "manual_contact", "record", True, "nobody could reach them — " + s_(it.get("why")) +
                     ". Soft-archived with everything the card carried; no letter (the dictation archives silently "
                     "here).", title="The manual machine ended — discarded")
            acted += 1
            continue
        adder = HR.adder_for(reads, c)
        if adder is not None and _adder_send(run, c, cid, adder, int(it.get("attempt") or 1), lbl):
            run.track("manual_adder", cid, "manualAdderSweepMaybe_", {"candidate_id": cid})
            acted += 1
    return acted


def _next_steps(run: Pass, cid: str, name: str, it: dict) -> None:
    """manualNextStepAsks_: the résumé (folders first) and the CJIS, each through its own door, prepared by the
    look."""
    reads = run.reads
    notes = []
    ans, recs, _why = press(reads, HOW.manual_resume_ask, HR.LADDER_ACTOR, {"candidate_id": cid,
                                                                             "prepared": it.get("resume")})
    if ans is None:
        notes.append("the resume ask did not run — the retry rung re-asks")
    else:
        run.recs += recs
        notes.append(s_((ans.get("data") or {}).get("note")) or "the resume ask did not run")
    ans, recs, _why = press(reads, HOW.cjis_request_send, HR.LADDER_ACTOR, {"candidate_id": cid, "no_auto": True,
                                                                             "prepared": it.get("cjis")})
    if ans is None:
        notes.append("the CJIS ask did not run — the recheck rung retries")
    else:
        run.recs += recs
        d = ans.get("data") if isinstance(ans.get("data"), dict) else {}
        notes.append("CJIS: " + (s_(d.get("state")) or ("asked from Arthur" if d.get("sent") else s_(d.get("reason")))
                                 or "asked"))
    run.line(cid, name, "manual_contact", "record", True, " · ".join(notes),
             title="The next step fires — resume and CJIS")


def _door_pass(run: Pass, items: list[dict], started: float) -> int:
    """The 4040 door: the phone-screen row first (once per call), then the move to Phone Screen, the asks settled,
    the next step fired, and the call spent."""
    reads, sess = run.reads, run.sess
    seen = HR.marks(reads, HR.CALL_SEEN)
    line = HO.actors(reads)["screen_line"]
    lbl = HL.line_label(line) or line or "the screen line"
    entered = 0
    for it in items:
        if _late(started):
            break
        cid, call = s_(it.get("cid")), s_(it.get("call"))
        c = HR.cand_of(reads, cid)
        if call in seen or not c or HO.archived(c) or CND.stage_of(c.get("status")) != "new":
            continue
        name = s_(c.get("candidatename"))
        if not it.get("have_row"):
            run.recs += CW.facts_of(reads, CW.PHONE, cid, {
                "candidate_id": cid, "screen_status": "Completed", "screen_date": s_(it.get("created")),
                "screened_by": MANUAL_BY, "transcript_text": s_(it.get("text")), "transcript_call_id": call,
                "transcript_created": s_(it.get("created")), "transcript_pulled_at": run.now,
                "phone_screen_id": "PS_" + secrets.token_hex(8).upper()}, "append", cid, "", at=run.now)
        run.recs += HH.move(sess, cid, c, "phone-screen", "manual-ladder", run.now)
        run.answer(("manual_contact", "manual_adder"), "they called the screen line (" + call + ")", cid)
        run.line(cid, name, "manual_contact", "record", True, "they called the " + lbl + " (" + call + ") — entered by "
                 "the phone screening door; the screen machinery takes it from here", title="They called the screen line")
        _next_steps(run, cid, name, it)
        seen[call] = run.now
        entered += 1
    if entered:
        HH.mark_set(HR.CALL_SEEN, json.dumps(seen, separators=(",", ":")))
    return entered


def manual_contact_sweep(sess: L.Session, payload: dict) -> Decision:
    """The Added Manually machine on its clock: the arming (once), the first presses (an invitation for a card with a
    phone, the phone collection for an e-mail only one), then mouth #2 and the 4040 door."""
    prep, refused = _open(sess, payload, "manualContactSweep")
    if refused:
        return refused
    if not prep.get("on") or prep.get("why"):
        return Decision({"status": 200, "data": {"on": bool(prep.get("on")), "why": s_(prep.get("why"))}})
    reads = sess.reads
    run = Pass(sess, MANUAL_BY)
    own = False
    if s_(prep.get("arm")):
        HH.mark_set(HR.ARMED_AT, s_(prep["arm"]))
        own = True
        log.info("asa-hub:manual-ladder manual_machine_armed: cards born after %s enter the contact machine",
                 s_(prep["arm"]))
    started = time.monotonic()
    pressed = 0
    for pr in prep.get("presses") or []:
        if _late(started):
            break
        cid = s_(pr.get("cid"))
        door = HOW.manual_contact_send if pr.get("door") == "manualContactSend" else HOW.phone_collect_ask
        ans, recs, why = press(reads, door, HR.MANUAL_SWEEP_ACTOR, {"candidate_id": cid})
        if ans is None:
            log.warning("asa-hub:manual-ladder manual_contact_press_failed: %s — %s", cid, why[:200])
            continue
        run.recs += recs
        pressed += 1
    if prep.get("presses") and not pressed:
        HR.idle("manual-ladder", "ran and spoke to nobody — every card at New is already in the ask book, or was born "
                                 "before " + s_(prep.get("armed_at")))
    adder = _adder_pass(run, prep.get("adder") or [], started)
    entered = _door_pass(run, prep.get("calls") or [], started)
    return _done({"status": 200, "data": {"pressed": pressed, "adder": adder, "entered": entered}}, run.recs,
                 own=own or bool(entered))


# ---- the director fast lane's collector (directorDocsSweepMaybe_) ---------------------------------------------------

def _docs_send(run: Pass, c: dict, cid: str, missing: str, attempt: int) -> bool:
    """One director-docs round — the letter to the team, the texts to the deciders; off, nothing leaves."""
    reads = run.reads
    lane = HO.Lane(reads, "hiring_director_docs_missing")
    if not lane.on:
        return False
    name = s_(c.get("candidatename")) or cid
    rehearsal = HH.is_test(reads, c)
    addr = HO.team_address(reads) if rehearsal else None
    to = (addr or {}).get("to") or ", ".join(HO.team_of(reads)["emails"])
    vars_ = {"name": name, "missing": missing}

    def fill(t: str) -> str:
        return s_(t).replace("{name}", name).replace("{missing}", missing)
    suffix = f"_a{attempt}" if attempt > 1 else ""
    sent = False
    subject = lane.word("email_subject", fill(HR.sim_text(reads, "director_docs_subject")) or
                        fill(HO.book(reads, "director_docs.subject.floor")), vars_)
    body = lane.word("email_text", fill(HR.sim_text(reads, "director_docs_body")) or
                     fill(HO.book(reads, "director_docs.body.floor")), vars_)
    link = MD.mail_platform_url() + "/app/hiring/candidate?id=" + cid
    html = MD.mail_shell({
        "eyebrow": "ASA Hub — Hiring", "title": fill(HO.book(reads, "director_docs.title")),
        "preheader": HO.book(reads, "director_docs.preheader"),
        "blocks": [MD.mail_fact(HO.book(reads, "notice.fact.candidate"), name, False),
                   MD.mail_fact(HO.book(reads, "director_docs.fact.missing_label"), missing, False)] + paras(body),
        "cta": {"label": HO.book(reads, "notice.cta.open_candidate"), "href": link},
        "footnote": HO.book(reads, "director_docs.footnote")})
    if to and lane.leg("email"):
        got = tell(reads, "hiring_director_docs_missing", to, body, "director_docs_mail_" + cid + suffix, name, "email",
                   HO.tag_subject(reads, subject) if rehearsal else subject, html, (addr or {}).get("cc", ""))
        ok = HH.went(got)
        sent = sent or ok
        run.line(cid, name, "director_docs", "email", ok, "the director card is missing " + missing + " — asked by "
                 "letter, both return paths named (attempt " + str(attempt) + ")" +
                 (" (rehearsal — redirected to the actor mailbox)" if rehearsal else "") +
                 ("" if ok else " — not sent: " + said(got)), to=to, rehearsal=rehearsal,
                 title="Arthur and Ty are asked for the pieces")
    sms = lane.word("sms_text", fill(HR.sim_text(reads, "director_docs_sms")) or (
        "ASA LifeCare hiring — " + name + " entered onboarding on the director fast lane and we are missing " + missing +
        ". Reply to the e-mail with the file(s), or drop them in the special folder — the folder is instant."), vars_)
    if not lane.leg("sms"):
        pass
    elif rehearsal:
        run.line(cid, name, "director_docs", "sms", True, "THE DIRECTOR ASK (rehearsal): the Quo texts to the deciders "
                 "are narrated, never sent — a rehearsal pages nobody", rehearsal=True)
        sent = True
    else:
        for n in HO.actors(reads)["decider_sms"]:
            got = tell(reads, "hiring_director_docs_missing", n, sms,
                       "director_docs_sms_" + cid + "_" + re.sub(r"\D", "", n) + suffix, name)
            sent = HH.went(got) or sent
    return sent


def director_docs_sweep(sess: L.Session, payload: dict) -> Decision:
    """Each director card its look read: the folders' résumé attached first (fill-blank, scored), the ask closed once
    both pieces stand, else the team asked — the first send books it, the rider re-asks on its own clock."""
    prep, refused = _open(sess, payload, "directorDocsSweep")
    if refused:
        return refused
    reads = sess.reads
    run = Pass(sess, DOCS_BY)
    out = {"attached": 0, "closed": 0, "asked": 0}
    started = time.monotonic()
    for it in prep.get("items") or []:
        if _late(started):
            break
        cid = s_(it.get("cid"))
        c = HR.cand_of(reads, cid)
        if not c:
            continue
        name = s_(c.get("candidatename")) or cid
        have_resume = bool(it.get("have_resume"))
        attach = it.get("attach") if isinstance(it.get("attach"), dict) else None
        if not have_resume and attach:
            ans, recs, _why = press(reads, RIW.attach, HR.DOCS_ACTOR, {"candidate_id": cid,
                                                                       "resume_link": s_(attach.get("link")),
                                                                       "prepared": attach.get("prepared")})
            if ans is not None and ans.get("status") == 200:
                run.recs += recs
                have_resume = True
                out["attached"] += 1
                run.line(cid, name, "director_docs", "drive", True, "the special folders held " + name + "'s resume — "
                         "attached to the card (fill-blank); nobody had to be asked for it",
                         title="The resume came out of the folders")
        have_cjis = bool(it.get("have_cjis"))
        if have_resume and have_cjis:
            if run.answer(("director_docs",), "collected", cid):
                out["closed"] += 1
                run.line(cid, name, "director_docs", "record", True, "collected from the folders — the onboarding mint "
                         "gate has what it needs", title="Both pieces stand")
            continue
        attempt = int(it.get("attempt") or 0)
        if not attempt:
            continue
        missing = ("the resume and the CJIS report" if not have_resume and not have_cjis
                   else "the resume" if not have_resume else "the CJIS report")
        if _docs_send(run, c, cid, missing, attempt):
            run.track("director_docs", cid, "directorDocsSweepMaybe_", {"candidate_id": cid})
            out["asked"] += 1
    return _done({"status": 200, "data": out}, run.recs)


# ---- the call nobody was asked for (screenCallSweepMaybe_) ----------------------------------------------------------

def screen_call_sweep(sess: L.Session, payload: dict) -> Decision:
    """Up to five cards at Phone Screen told to call the evaluation line through its own door; a door that answers
    without sending is said, never counted."""
    prep, refused = _open(sess, payload, "screenCallSweep")
    if refused:
        return refused
    if not prep.get("on"):
        return Decision({"status": 200, "data": {"on": False, "asked": 0}})
    reads = sess.reads
    run = Pass(sess, "asa-hub:screen-call")
    pressed, names = 0, []
    started = time.monotonic()
    for it in prep.get("items") or []:
        if pressed >= HR.SCREEN_CALL_PER_PASS or _late(started):
            break
        cid = s_(it.get("cid"))
        ans, recs, why = press(reads, HOW.screen_call_send, HR.SCREEN_CALL_ACTOR, {"candidate_id": cid})
        if ans is None:
            log.warning("asa-hub:screen-call screen_call_press_failed: %s — %s", cid, why[:200])
            continue
        run.recs += recs
        d = ans.get("data") if isinstance(ans.get("data"), dict) else {}
        if not d.get("sent"):
            log.info("asa-hub:screen-call screen_call_refused: %s — %s", cid, s_(d.get("reason")) or "nothing went out")
            continue
        pressed += 1
        names.append(s_(it.get("name")) or cid)
    if pressed:
        log.info("asa-hub:screen-call screen_call_asked: %d card(s) at Phone Screen were asked to call the line: %s",
                 pressed, ", ".join(names)[:300])
    else:
        HR.idle("screen-call", "nobody at Phone Screen is waiting to be asked — each one already has a screen on the "
                               "record, or is already in the ask book")
    return _done({"status": 200, "data": {"asked": pressed}}, run.recs)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "screenRedoSweep": screen_redo_sweep, "referralRelaySweep": referral_relay_sweep,
    "manualContactSweep": manual_contact_sweep, "directorDocsSweep": director_docs_sweep,
    "screenCallSweep": screen_call_sweep}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}
