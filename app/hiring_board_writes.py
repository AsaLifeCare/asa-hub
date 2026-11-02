"""The Hiring pipeline board's writes (HubCore.gs setDecision and moveStage, Onboarding.gs onboardingExtend and
onboardingManualComplete) kept as the hiring rows' facts: a decision on the resume or the phone screen — an Advance
whose gate opens moves the card to Interview with its visit booked, a Decline ends the run (Not Hiring, archived, the
team told through Smart Comms) — a gated stage move with its history and the onboarding calendar's note, an onboarding
window given back, and a manual onboarding that moves the card to Hired or holds it for its packet. The new hire's
login is not minted here: the hiring accounts pass (onboardingUserSweepMaybe_, app/hiring_accounts*) mints and sends
it for every card that entered Onboarding."""
from __future__ import annotations

from typing import Any, Callable

import candidate_papers as CP
import candidate_writes as CW
import candidates as CND
import hiring_board as HB
import hiring_engine_writes as HEW
import hiring_hired as HH
import locations as L
import onboarding as OB
import onboarding_writes as OBW
import staff_views
import writes as W
from scope import Defer
from writes import Decision

s_ = CND.s_


def _log(user: dict | None, action: str, target: str) -> None:
    """hubSysLog_."""
    staff_views.record(user, action, target)


def _dissolved(reads: L.Reads, *tabs: str) -> None:
    for tab in tabs:
        if not reads.db.dissolved(tab):
            raise Defer(f"{tab} is not dissolved: its sheet is Apps Script's to write")


def _opened(sess: L.Session, payload: Any, *tabs: str) -> tuple[str, dict, Decision | None]:
    """hubIsWriter_ and the candidate's id; the rows these doors keep must be facts, and the book-write gate open."""
    p = payload if isinstance(payload, dict) else {}
    if not HH.writer(sess.user):
        return "", p, Decision(dict(HH.DENIED))
    cid = s_(p.get("candidate_id"))
    if not HH.CAN_ID.match(cid):
        return cid, p, W.refuse(400, "invalid candidate_id")
    _dissolved(sess.reads, CW.CANDIDATES, *tabs)
    W.gate(sess.reads)
    return cid, p, None


# ---- hubSetStatus_'s calendar ---------------------------------------------------------------------------------------

def calendar(reads: L.Reads, cid: str, cand: dict, word: str, now: str) -> list[dict]:
    """hubOnboardingCalendarNote_ for a status written over the card's: the account-issued day as it enters Onboarding,
    the completion as it leaves it forward."""
    entering = HB.calendar_entering(cand.get("status"), word)
    if entering is None:
        return []
    return CP.calendar_note(reads, cid, s_(cand.get("candidatename")), now, entering)


# ---- the decision (hubSetDecision_, hubSetDecisionHeld_) ----------------------------------------------------------

def decline(sess: L.Session, cid: str, checkpoint: str, edition: str) -> tuple[dict[str, Any], list[dict]]:
    """hubSetDecisionHeld_ for a Decline: the decision on the resume or the phone screen, then the run ended —
    hubSetStatus_ to Not Hiring and hiringArchiveAndTell_, the team's letter through Smart Comms (hiring_candidate_left);
    a run already ended is told so without a second letter."""
    reads = sess.reads
    cand = CW.dissolved_rows(reads, CW.CANDIDATES, [cid]).get(cid)
    if cand is None:
        return {"status": 404, "message": f'No candidate "{cid}".'}, []
    CW.marked(cand.get("status"), cand.get("candidatename"))
    if s_(cand.get("status")).lower() == "not hiring":
        return {"status": 200, "data": {"value": "Decline", "declined": True, "already": True, "gate_passed": False,
                                        "to_stage": None, "missing": [], "moved_to": None}}, []
    if checkpoint == "advance-decision":
        closed = HB.screen_closed(cand)
        if closed:
            return closed, []
    by = CW.who_email(sess.user)
    now = W.now_iso(reads)
    tab, fields = ((CW.RESUME, {"decision_status": "Decline"}) if checkpoint == "resume-decision"
                   else (CW.PHONE, {"final_result": "Decline"}))
    recs = CW.facts_of(reads, tab, cid, fields, by, cid, edition, at=now)
    # hiringArchiveAndTell_ names the stage it reads once the status is written
    ended, _told = HEW.end_run(sess, cid, cand, HB.DECLINED[checkpoint] + " by " + by, "Not Hiring", by, now)
    recs += ended
    g = CW.gate_after(sess, cid, {tab: fields, CW.CANDIDATES: {"status": "Not Hiring"}})
    return {"status": 200, "data": {"value": "Decline", "declined": True, "gate_passed": False, "to_stage": g["to"],
                                    "missing": g["reasons"], "moved_to": None}}, recs


def decide(sess: L.Session, cid: str, checkpoint: str, value: str, edition: str) -> tuple[dict[str, Any], list[dict]]:
    """hubSetDecisionHeld_ as the signed-in board presses it (the decider's own Accept attests a phone screen nothing
    recorded): an Advance is candidate_writes', a Decline ends the run."""
    refused = HB.decision_refusal(checkpoint, value)
    if refused:
        return refused, []
    if value == "Decline":
        return decline(sess, cid, checkpoint, edition)
    s = CW.dissolved_rows(sess.reads, CW.PHONE, [cid]).get(cid) or {}
    unscreened = checkpoint == "advance-decision" and s_(s.get("screenstatus")).lower() != "completed"
    env, recs = CW.decision(sess, {"key": cid}, {"checkpoint": checkpoint, "value": value}, edition)
    if env.get("status") == 200 and unscreened:
        _log(sess.user, "screen_manual_complete", cid + " — attested by the Accept on the advance decision")
    return env, recs


def set_decision(sess: L.Session, payload: dict) -> Decision:
    """setDecision: hubSetDecision_ with the decider's attestation; the platform's write lock is the candidate's
    claim."""
    cid, p, refused = _opened(sess, payload, CW.RESUME, CW.PHONE, CW.INTERVIEWS, CW.JOURNEY)
    if refused:
        return refused
    env, recs = decide(sess, cid, s_(p.get("checkpoint")), s_(p.get("value")), "")
    if env.get("status") != 200:
        return Decision(env)
    return W.final(env, recs, cid)


# ---- a gated stage move (moveStage, hubSetStatus_) ------------------------------------------------------------------

def move(sess: L.Session, ctx: dict, a: dict, inner: dict[str, str], edition: str) -> tuple[dict[str, Any], list[dict]]:
    """moveStage past the gate `a` carries: hubSetStatus_ — the status and its history row (candidate_writes), and the
    onboarding calendar's note."""
    reads = sess.reads
    key = ctx["key"]
    env, recs = CW.move_stage(sess, ctx, a, inner, edition)
    if env.get("status") != 200:
        return env, recs
    cand = CW.dissolved_rows(reads, CW.CANDIDATES, [key]).get(key) or {}
    to = s_(inner.get("to_stage"))
    return env, recs + calendar(reads, key, cand, CW.STAGE_TO_STATUS.get(to, to), W.now_iso(reads))


def move_stage(sess: L.Session, payload: dict) -> Decision:
    """moveStage: the gate revalidated before writing — the button is convenience, this is the enforcement."""
    cid, p, refused = _opened(sess, payload)
    if refused:
        return refused
    reads = sess.reads
    ev = CND.evidence(reads, cid)
    if not ev.get("cand"):
        return W.refuse(404, f'No candidate "{cid}".')
    gate = CND.stage_gate(reads, ev)
    env, recs = move(sess, {"key": cid}, {"gate": gate}, {"to_stage": s_(p.get("to_stage"))}, "")
    if env.get("status") != 200:
        return Decision(env)
    return W.final(env, recs, cid)


# ---- the onboarding window (onboardingExtend) -----------------------------------------------------------------------

def extend(sess: L.Session, payload: dict) -> Decision:
    """onboardingExtend: the team's answer to a missed window — a date, never a flag; seven days by default."""
    cid, p, refused = _opened(sess, payload)
    if refused:
        return refused
    reads = sess.reads
    cand = CND.evidence(reads, cid).get("cand")
    if not cand:
        return W.refuse(404, f'No candidate "{cid}".')
    until, bad = HB.extend_until(reads, p)
    if bad:
        return Decision(bad)
    by = CW.who_email(sess.user)
    now = W.now_iso(reads)
    recs = CW.facts_of(reads, CW.CANDIDATES, cid, {HB.ACCESS_UNTIL: until}, by, cid, "", at=now)
    _log(sess.user, "onboarding_extend",
         cid + " — " + s_(cand.get("candidatename")) + " may onboard until " + until[:10])
    return W.final({"status": 200, "data": {"candidate_id": cid, "until": until}}, recs, cid)


# ---- manual onboarding (onboardingManualComplete) -------------------------------------------------------------------

def manual(sess: L.Session, cid: str, notes: str, edition: str) -> tuple[dict[str, Any], list[dict]]:
    """onboardingManualComplete: one press attests somebody was walked through the packet — the portal's blanks filled,
    the card marked; with the packet on file the card goes to Hired, without it the card is held at Onboarding
    (packetHoldStart_) until the sweep or a hand-attached copy releases it."""
    reads = sess.reads
    cand = CND.evidence(reads, cid).get("cand")
    if not cand:
        return {"status": 404, "message": f'No candidate "{cid}".'}, []
    CW.marked(cand.get("status"), cand.get("candidatename"), cand.get("email"))
    if CND.stage_of(cand.get("status")) != "onboarding":
        return {"status": 409, "message": HB.MANUAL_ONLY}, []
    by = CW.who_email(sess.user)
    now = W.now_iso(reads)
    # what was true before this press: once the flags are filled a portal visit and a walkthrough look alike
    done, why = CND.soft(lambda: CND.onboarding_done(reads, cand))
    portal = not why and (done or {}).get("how") == "portal"
    recs: list[dict] = []
    found, why = CND.soft(lambda: OB.find_row(reads, s_(cand.get("email")), cid))
    if found and not why:
        recs += OBW._packet_facts(reads, found, HB.packet_cells(found, cid, by, now), now)
    fields = HB.manual_fields(by, now, portal, CW.js_slice(s_(notes), 2000))
    recs += CW.facts_of(reads, CW.CANDIDATES, cid, fields, by, cid, edition, at=now)
    pk, _why = CND.soft(lambda: CND.packet_state(reads, cand))
    state = s_((pk or {}).get("state")) or "unknown"
    if state not in ("signed", "waived"):
        until, held = OBW._hold_start(reads, cid, cand, now)
        if held:
            _log(sess.user, "packet_hold_start", cid + " — " + s_(cand.get("candidatename")) + " finished onboarding "
                 "with the packet " + state + "; held at Onboarding until " + until)
        _log(sess.user, "onboarding_manual_complete",
             cid + " — manual onboarding (by email); held at Onboarding, packet " + state)
        return {"status": 200, "data": {"completed": True, "moved": False, "stage": "onboarding", "held": True,
                                        "hold_until": until, "packet_state": state}}, recs + held
    recs += OBW._to_hired(sess, cid, cand, now) + OBW._hold_clear(reads, cid, now)
    _log(sess.user, "onboarding_manual_complete", cid + " — manual onboarding (by email); moved to Hired")
    return {"status": 200, "data": {"completed": True, "moved": True, "stage": "hired", "packet_state": state}}, recs


def manual_complete(sess: L.Session, payload: dict) -> Decision:
    """onboardingManualComplete: the only way past Onboarding."""
    cid, p, refused = _opened(sess, payload, CND.PACKET_TAB)
    if refused:
        return refused
    env, recs = manual(sess, cid, s_(p.get("notes")), "")
    if env.get("status") != 200:
        return Decision(env)
    return W.final(env, recs, cid)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "setDecision": set_decision, "moveStage": move_stage, "onboardingExtend": extend,
    "onboardingManualComplete": manual_complete}
POLICY: dict[str, dict[str, Any]] = {a: {"roles": HB.WRITERS} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}
