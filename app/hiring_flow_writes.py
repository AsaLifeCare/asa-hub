"""The Hiring flow's writes (HiringFlow.gs, HiringMatrix.gs): an appointment scheduled for one candidate
(hiringScheduleCreate) — its row on the dissolved hiring calendar, the in-person interview booked or restamped, and the
candidate's letter raised through Smart Comms — and a parallel flow minted (hiringFlowMint): the template's copy, made
by its prepare read, registered off in the runtime's Registry. Every record kept as the runtime's facts or rows in
Postgres."""
from __future__ import annotations

import secrets
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import gsjs
import hiring_flow as HF
import locations as L
import recon as RC
import resource_rows as RR
import smart_comms as SC
import staff_views
import writes as W
from scope import Defer
from writes import Decision

EVENTS_TAB = CND.HIRING_EVENTS_TAB
OPEN_INTERVIEW = ("", "scheduled", "to schedule")

s_ = gsjs.str_


def _hex(n: int) -> str:
    """randomHex_(n), upper-cased as the ids take it."""
    return secrets.token_hex((n + 1) // 2)[:n].upper()


def _dissolved(reads: L.Reads, *tabs: str) -> None:
    for t in tabs:
        if not reads.db.dissolved(t):
            raise Defer(f"{t} is written as the runtime's facts only while it is dissolved")


def _notify(reads: L.Reads, cand: dict, ev: dict, eid: str, prepared: dict | None) -> dict[str, Any]:
    """hiringEventNotify_: one letter per day and time, through Smart Comms; fail closed on a situation that is off."""
    words = HF.event_mail(reads, cand, ev)
    if words["reason"]:
        return {"emailed": False, "reason": words["reason"]}
    body = words["body"]
    if prepared and prepared.get("body") == body and s_(prepared.get("rewritten")):
        body = s_(prepared["rewritten"])
    # keyed by candidate, type, day and time: a moved meeting is told again
    who = ev["candidate_id"] + ":" + ev["event_type"] + (":" + ev["time"] if ev["time"] else "")
    key = f"{words['sid']}|{who}|{ev['date'][:10]}"
    if key in (HF._soft(lambda: HF.ledger_keys(reads), set()) or set()):
        return {"emailed": False, "reason": "already_told"}
    got = SC.raise_situation(None, situation=words["sid"], to=words["to"], vars=words["vars"], key="hevmail_" + eid,
                             ledger_key=key, person=words["vars"]["name"], ledger_person=who, occasion=ev["date"],
                             lane="hiring schedule", at_ms=int(reads.now.timestamp() * 1000), channel="email",
                             subject=words["subject"], body=body)
    state = s_(got.get("state"))
    if state == "sent":
        return {"emailed": True, "redirected": False, "receipt": s_(got.get("receipt"))}
    if state == "already":
        return {"emailed": False, "reason": "already_told"}
    if state == "off":
        return {"emailed": False, "reason": "situation_off"}
    return {"emailed": False, "reason": s_(got.get("why")) or s_(got.get("held")) or state or "send_failed"}


def schedule_create(sess: L.Session, payload: dict) -> Decision:
    """hiringScheduleCreate: one appointment for one candidate — its calendar row, the in-person interview booked
    (or its open row restamped, or a new row after a closed one), and the candidate's letter riding on it."""
    reads, user = sess.reads, sess.user or {}
    if not HF.writer(user):
        return Decision(dict(HF.DENIED))
    p = payload if isinstance(payload, dict) else {}
    why = HF.event_valid(p)
    if why:
        return W.refuse(400, why)
    cid = s_(p.get("candidate_id"))
    cand = CND.evidence(reads, cid).get("cand")
    if not cand:
        return W.refuse(404, f'No candidate "{cid}".')
    _dissolved(reads, EVENTS_TAB, CW.INTERVIEWS)
    W.gate(reads)
    ev = HF.event_of(p, cand)
    kind, date, tm = ev["event_type"], ev["date"], ev["time"]
    by = s_(user.get("email"))
    now = W.now_iso(reads)
    eid = "HEV_" + _hex(10)
    # assembled, never parsed — a string of parts cannot cross midnight
    starts = date + "T" + tm + ":00" if tm else date
    row = {"event_id": eid, "candidate_id": cid, "candidate_name": ev["candidate_name"], "event_type": kind,
           "date": date, "time": tm, "starts_at": starts, "location": ev["location"], "with_name": ev["with_name"],
           "notes": ev["notes"], "status": "scheduled", "created_at": now, "created_by": "asa-hub:" + by,
           "email_receipt": ""}
    recs = CW.facts_of(reads, EVENTS_TAB, eid, row, "runtime-sheet:append", cid, "", at=now)
    if kind == "in_person_interview":
        # the interviews row is what opens the interviewer's scorecard window
        iv = CND.interview_for(reads, cid)
        made_by = "asa-hub:" + (by or "system")
        if iv is None:
            recs += CW.facts_of(reads, CW.INTERVIEWS, cid, {
                "interview_id": "INT_" + _hex(10), "candidate_id": cid, "candidate_name": ev["candidate_name"],
                "scheduled_for": starts, "source": "phone-screen", "status": "Scheduled" if starts else "To Schedule",
                "created_at": now, "created_by": made_by}, "runtime-sheet:append", cid, "", at=now)
        elif s_(iv.get("score")) == "" and s_(iv.get("status")).lower() in OPEN_INTERVIEW:
            recs += CW.facts_of(reads, CW.INTERVIEWS, cid, {"scheduled_for": starts, "status": "Scheduled"},
                                "runtime-sheet", cid, "", at=now)
        else:
            # a completed or scored row is history: a new row after it
            recs += CW.facts_of(reads, CW.INTERVIEWS, cid, {
                "interview_id": "INT_" + _hex(10), "candidate_id": cid, "candidate_name": ev["candidate_name"],
                "scheduled_for": starts, "source": "flow-calendar", "status": "Scheduled", "created_at": now,
                "created_by": made_by}, "runtime-sheet:append", cid, "", at=now)
    prepared = None
    if p.get("auto") is True or s_(p.get("auto")) == "kept":
        prepared = RC.unsealed("hiringScheduleCreate", RC.actor(user), p.get("prepared"))
        prepared = prepared if prepared and s_(prepared.get("candidate_id")) == cid else None
    mail = _notify(reads, cand, ev, eid, prepared)
    if mail.get("emailed") or mail.get("receipt"):
        recs += CW.facts_of(reads, EVENTS_TAB, eid, {"email_receipt": s_(mail.get("receipt")) or "sent"},
                            by or "runtime-write", cid, "", at=now)
    staff_views.record(user, "hiring_event_create", f"{ev['candidate_name']} — {kind} {date}")
    return W.final({"status": 200, "data": {"event": {
        "id": eid, "candidate_id": cid, "name": ev["candidate_name"], "type": kind,
        "type_label": CND.HIRING_EVENT_TYPES.get(kind), "date": date, "time": tm, "location": ev["location"],
        "with_name": ev["with_name"], "notes": ev["notes"], "status": "scheduled", "source": "calendar"},
        "mail": mail}}, recs, cid)


def flow_mint(sess: L.Session, payload: dict) -> Decision:
    """hiringFlowMint: the template's copy (made by hiringFlowMintPrepare) registered in the runtime's Registry, off."""
    reads, user = sess.reads, sess.user or {}
    p = payload if isinstance(payload, dict) else {}
    refused, name, _tpl = HF.mint_refusal(reads, user, p.get("name"))
    if refused:
        return Decision(refused)
    prep = RC.unsealed("hiringFlowMint", RC.actor(user), p.get("prepared"))
    copy = s_((prep or {}).get("book"))
    if not prep or s_(prep.get("context")) != name or not copy:
        return W.refuse(409, "The template's copy is not at hand — mint the flow again.")
    W.gate(reads)
    rid = CND.runtime_id(reads)
    ref = reads.tab_of(rid, HF.REGISTRY_TAB, "the runtime's Registry")
    if ref is None:
        return W.refuse(502, f"the book was copied ({copy}) but the Registry row could not be written — add it by hand.")
    vals = {"Context": name, "Spreadsheet ID": copy, "Status": "off",
            "Notes": f"flow minted by {s_(user.get('email'))} {W.now_iso(reads)}"}
    heads = [gsjs.trim(gsjs.js_str(h)) for h in ref.headers]
    rec = W.kept_record(rid, ref.tab, "append", W.COLS + "Context", name, name,
                        {h: vals[h] for h in heads if h in vals})
    return W.final({"status": 200, "data": {"context": name, "book": copy, "status": "off"}}, [rec], name)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "hiringScheduleCreate": schedule_create, "hiringFlowMint": flow_mint}
POLICY: dict[str, dict[str, Any]] = {
    "hiringScheduleCreate": {"roles": ("admin", "manager")},
    "hiringFlowMint": {"roles": ("admin",)}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.hiring_flow_writes and app.hiring_flow_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="hiring_flow", label="Hiring flow")
