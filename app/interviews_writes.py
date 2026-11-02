"""Interviews' writes (Interview.gs): interviewSetWindow — a recruiter widens or shortens one candidate's access window,
both edges pinned, so the stored window is the one the recruiter saw — and interviewSave, the scorecard and what it
decides; each kept as the hiring rows' facts in Postgres (the tabs are dissolved), its messages through Smart Comms."""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import hubdb
import interviews as IV
import locations as L
import writes as W
from scope import Defer
from writes import Decision

s_ = CND.s_


def _local(ms: float) -> datetime:
    return datetime.fromtimestamp(ms / 1000.0, timezone.utc)


def set_window(sess: L.Session, payload: dict) -> Decision:
    """interviewSetWindow: extend_days / open_earlier_days / access_from / access_until on one interview row."""
    reads, user = sess.reads, sess.user or {}
    if s_(user.get("role")) not in ("admin", "manager"):
        return Decision(IV.DENIED)
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("candidate_id"))
    if not IV.CAN_ID.match(cid):
        return W.refuse(400, IV.strings(reads, "refuse.candidate_id"))
    iv = CND.interview_for(reads, cid)
    if not iv:
        return W.refuse(404, IV.strings(reads, "refuse.iv.none_scheduled"))
    now = CND.now_ms(reads)
    cur = IV.window(reads, iv)
    fields: dict[str, str] = {}

    def days(key: str) -> int | None:
        try:
            n = int(float(s_(p.get(key))))
        except ValueError:
            return None
        return n if 0 <= n <= 365 else None
    if p.get("extend_days") is not None:
        n = days("extend_days")
        if n is None:
            return W.refuse(400, IV.strings(reads, "refuse.iv.extend_days"))
        base = CND.js_date_ms(cur["until"]) if cur["until"] else now
        base = now if base is None or base < now else base
        fields["access_until"] = CND.iso_ms(CND._day_edge(reads, CND._shift_days(base, n), True))
    if p.get("open_earlier_days") is not None:
        n = days("open_earlier_days")
        if n is None:
            return W.refuse(400, IV.strings(reads, "refuse.iv.open_earlier_days"))
        start = (CND.js_date_ms(cur["from"]) if cur["from"] else None) or now
        fields["access_from"] = CND.iso_ms(CND._day_edge(reads, CND._shift_days(start, -n), False))
    if p.get("access_from") is not None:
        f = CND.js_date_ms(p.get("access_from"))
        if f is None:
            return W.refuse(400, IV.strings(reads, "refuse.iv.access_from"))
        fields["access_from"] = CND.iso_ms(CND._day_edge(reads, _local(f), False))
    if p.get("access_until") is not None and p.get("extend_days") is None:
        u = CND.js_date_ms(p.get("access_until"))
        if u is None:
            return W.refuse(400, IV.strings(reads, "refuse.iv.access_until"))
        fields["access_until"] = CND.iso_ms(CND._day_edge(reads, _local(u), True))
    if not fields:
        return W.refuse(400, IV.strings(reads, "refuse.iv.nothing_to_change"))
    # both edges pinned, so the stored window is the one the recruiter saw
    if "access_from" in fields and "access_until" not in fields and cur["until"]:
        fields["access_until"] = cur["until"]
    if "access_until" in fields and "access_from" not in fields and cur["from"]:
        fields["access_from"] = cur["from"]
    stamp = W.now_iso(reads)
    by = s_(user.get("email"))
    fields.update(updated_at=stamp, updated_by="asa-hub:" + by)
    W.gate(reads)
    if reads.db.dissolved(CW.INTERVIEWS):
        recs = CW.facts_of(reads, CW.INTERVIEWS, cid, fields, by, cid, "", at=stamp)
    else:
        res = W.tab_of(reads, CW.INTERVIEWS)
        if res.ref is None or "candidate_id" not in res.ref.headers:
            return W.refuse(404, IV.strings(reads, "refuse.iv.row_not_found"))
        sid, tab = W.where_of(res)
        keep = {k: v for k, v in fields.items() if k in res.ref.headers}
        recs = [W.kept_record(sid, tab, "edit", W.COLS + "candidate_id", cid, cid, keep,
                              before={k: s_(iv.get(k.replace("_", ""))) for k in keep})]
    after = IV.window(reads, {**iv, "accessfrom": fields.get("access_from", s_(iv.get("accessfrom"))),
                              "accessuntil": fields.get("access_until", s_(iv.get("accessuntil")))})
    return W.final({"status": 200, "data": {"window_open": after["open"], "window_from": after["from"],
                                            "window_until": after["until"], "window_reason": after["reason"]}},
                   recs, cid)


# ---- the scorecard (Interview.gs interviewSave) ----------------------------------------------------------------

SCORE_MIN, SCORE_MAX = 0, 10
RECOMMENDATIONS = ("Advance", "Decline", "Hold")
# the Smart Comms rows each message owns (commSituationId_'s shipped ids)
SCORECARD_SIT, LEFT_SIT, CJIS_SIT, LATE_SHOW_SIT = (
    "hiring_scorecard_report", "hiring_candidate_left", "hiring_cjis_gate", "staff_late_show")
SAVE_ROLES = ("admin", "manager", "interviewer")
SAVE_PERM = "hiring.interview"
LANE = "interviews"


def _situation(reads: L.Reads, sid: str) -> dict | None:
    """smartSituationOn_: the situation's row while it is on."""
    import smart_comms_desk as SCD  # noqa: PLC0415 - the situations as the Desk reads them
    return SCD.situation_on(SCD.situations(reads), sid)


def team_emails(reads: L.Reads) -> list[str]:
    """hiringTeamRecipients_().emails: the hiring config's list, else the late-show alert's addresses while it is on."""
    raw = s_(reads.config().get("hiring_team_emails"))
    emails = [x.strip() for x in re.split(r"[,;]+", raw) if "@" in x]
    if emails:
        return emails
    row = _situation(reads, LATE_SHOW_SIT)
    return [x.strip() for x in re.split(r"[,;]+", s_((row or {}).get("to"))) if "@" in x] if row else []


def _tell(reads: L.Reads, sid: str, to: list[str], vars_: dict[str, str], key: str, person: str) -> bool:
    """One letter per address through Smart Comms; whether any of them went out."""
    import smart_comms as SC  # noqa: PLC0415 - every message goes through Smart Comms
    sent = False
    at_ms = int(reads.now.timestamp() * 1000)
    for addr in to:
        got = SC.raise_situation(None, situation=sid, to=addr, vars=vars_, key=key + "|" + addr.lower(),
                                 person=person, lane=LANE, at_ms=at_ms, prune=False, channel="email")
        sent = sent or s_(got.get("state")) == "sent"
    return sent


def save(sess: L.Session, payload: dict) -> Decision:
    """interviewSave: the scorecard on the interview row; Decline ends the run (Not Hiring, archived, the team told),
    Advance with a green gate moves the card into Onboarding (its login is minted by the hiring sweep), and the team
    gets the scorecard — every message through Smart Comms, every fact in Postgres."""
    reads, user = sess.reads, sess.user or {}
    role = s_(user.get("role"))
    # hubPolicyGate_: the roles, or the hiring.interview grant
    if not user.get("is_service") and role not in SAVE_ROLES and IV._overrides(reads, user).get(SAVE_PERM) is not True:
        return Decision({"status": 403, "message": "This action is for admin or manager or interviewer, or anyone "
                                                   f'granted "{SAVE_PERM}" in Settings → Access control.'})
    if not IV.can_record(reads, user):
        return Decision(IV.DENIED)
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("candidate_id"))
    if not IV.CAN_ID.match(cid):
        return W.refuse(400, IV.strings(reads, "refuse.candidate_id"))
    ev = CND.evidence(reads, cid)
    cand = ev.get("cand")
    if not cand:
        return W.refuse(404, IV.strings(reads, "refuse.no_candidate", {"id": cid}))
    if CW.stage_of(cand.get("status")) != "interview":
        return W.refuse(409, IV.strings(reads, "refuse.iv.wrong_stage"))
    iv = CND.interview_for(reads, cid)
    if role == "interviewer":
        win = IV.window(reads, iv)
        if not win["open"]:
            if win["reason"] == "not open yet":
                return W.refuse(403, IV.strings(reads, "refuse.iv.window_not_open", {"date": s_(win["from"])[:10]}))
            return W.refuse(403, IV.strings(reads, "refuse.iv.window_closed", {"date": s_(win["until"])[:10]}))
    name = s_(p.get("interviewer_name"))
    if not name:
        return W.refuse(400, IV.strings(reads, "refuse.iv.name_required"))
    n = CND.js_parse_int(p.get("score"))
    if n != n or n < SCORE_MIN or n > SCORE_MAX:
        return W.refuse(400, IV.strings(reads, "refuse.iv.score_range", {"min": str(SCORE_MIN), "max": str(SCORE_MAX)}))
    score = int(n)
    comments = s_(p.get("comments"))
    if len(comments) < 10:
        return W.refuse(400, IV.strings(reads, "refuse.iv.comments_required"))
    rec = s_(p.get("recommendation"))
    if rec not in RECOMMENDATIONS:
        return W.refuse(400, IV.strings(reads, "refuse.iv.recommendation"))
    if not reads.db.dissolved(CW.INTERVIEWS) or not reads.db.dissolved(CW.CANDIDATES):
        raise Defer("the interview and candidate rows are written as facts only while their tabs are dissolved")

    by = s_(user.get("email"))
    now = W.now_iso(reads)
    declined = rec == "Decline"
    fields = {"interviewer_name": name[:120], "score": str(score), "comments": comments[:4000],
              "recommendation": rec, "interviewed_at": now, "status": "Declined" if declined else "Completed",
              "updated_at": now, "updated_by": "asa-hub:" + by}
    # a blank scheduled_for is filled from the signature; a booked slot is never overwritten
    if not iv or not s_(iv.get("scheduledfor")):
        fields["scheduled_for"] = now
    row = dict(fields)
    if not iv:
        row.update(interview_id="INT_" + secrets.token_hex(5).upper(), candidate_id=cid,
                   candidate_name=s_(cand.get("candidatename")), source="manual", created_at=now,
                   created_by="asa-hub:" + by)
        recs = CW.facts_of(reads, CW.INTERVIEWS, cid, row, "runtime-sheet:append", cid, "", at=now)
    else:
        recs = CW.facts_of(reads, CW.INTERVIEWS, cid, fields, by, cid, "", at=now)
    cand_name = s_(cand.get("candidatename")) or cid
    ctx = {"key": cid, "name": cand_name}
    # hubGate_(hubEvidence_(cid)) read again after the writes: the scorecard laid over the interview row it reads
    after = {k: v for k, v in ev.items() if k != "__iv"}
    after["__iv"] = {**(iv or {}), **{hubdb.norm_key(k): CND.entered_text(v) for k, v in row.items()}}

    if declined:
        reason = f"Interview declined by {name[:120]} — score {score}. {comments[:300]}"
        recs += CW.status_move(sess, cid, cand, "Not Hiring", "", now)
        archive = {"archived": "true", "archived_at": now, "archived_reason": reason}
        recs += CW.facts_of(reads, CW.CANDIDATES, cid, archive, by, cid, "", at=now)
        after["cand"] = {**cand, "status": "Not Hiring", **{hubdb.norm_key(k): v for k, v in archive.items()}}
        if _situation(reads, LEFT_SIT) is not None:
            told = _tell(reads, LEFT_SIT, team_emails(reads), {"name": cand_name, "stage": "interview",
                                                              "reason": reason}, "left|" + cid, cand_name)
            recs += CW.journey_records(reads, ctx, {"step": "discarded", "channel": "email", "ok": told,
                                                    "detail": reason, "by": by}, "")[2]

    # the scorecard to whoever the Desk's `to` names (the hiring team while it is blank)
    import screening_writes as SGW  # noqa: PLC0415 - the Desk's own `to`, as the screen report reads it
    team = team_emails(reads)
    score_sit = _situation(reads, SCORECARD_SIT)
    score_to = SGW.desk_to(score_sit, team) if score_sit is not None else []
    if score_to:
        SGW.tell_desk(reads, SCORECARD_SIT, score_to, {"name": cand_name, "interviewer": name, "score": str(score),
                                                       "decision": rec, "comments": comments or "-"},
                      f"iv_done_{cid}_{score}", cand_name)
        recs += CW.journey_records(reads, ctx, {
            "step": "interview_scored", "channel": "email", "ok": True, "by": by,
            "detail": IV.strings(reads, "journey.interview_scored.detail",
                                 {"interviewer": name, "score": str(score), "recommendation": rec})}, "")[2]

    got = CND.stage_gate(reads, after)
    gate = {"to": s_(got.get("to")) or None, "ok": bool(got.get("ok")),
            "reasons": [s_(r) for r in got.get("reasons") or []]}
    advanced = False
    if not declined and rec == "Advance" and gate["ok"]:
        # the card moves; the hiring accounts pass (app/hiring_accounts*) mints the onboarding login, as for any move in
        recs += CW.status_move(sess, cid, cand, "onboarding", "", now)
        import candidate_papers as CP  # noqa: PLC0415 - the onboarding calendar note both moves write
        recs += CP.calendar_note(reads, cid, cand_name, now, True)
        advanced = True
        a = ev.get("analysis") or {}
        if not (CND.cjis_cleared(a) or s_(a.get("cjisreporturl"))):
            told_before = any(s_(j.get("step")) == "cjis_gate" for j in (CND.journey_for(reads, cid) or []))
            cjis_sit = _situation(reads, CJIS_SIT)
            if not told_before and cjis_sit is not None:
                sent = SGW.tell_desk(reads, CJIS_SIT, SGW.desk_to(cjis_sit, team), {"name": cand_name},
                                     "cjis_gate_mail_" + cid, cand_name)
                recs += CW.journey_records(reads, ctx, {
                    "step": "cjis_gate", "channel": "email+sms", "ok": sent, "by": "asa-hub:cjis-gate",
                    "title": IV.strings(reads, "journey.cjis_gate.title"),
                    "detail": IV.strings(reads, "journey.cjis_gate.sent" if sent else "journey.cjis_gate.unsent")}, "")[2]
    return W.final({"status": 200, "data": {"saved": True, "declined": declined, "advanced": advanced,
                                            "gate_passed": not declined and gate["ok"], "to_stage": gate["to"],
                                            "missing": gate["reasons"]}}, recs, cid)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"interviewSetWindow": set_window, "interviewSave": save}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.interviews_writes and app.interviews_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="interviews", label="Interviews")
