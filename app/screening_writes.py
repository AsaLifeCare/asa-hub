"""The phone screen's writes (Screening.gs screenSave, screenManualComplete, screenSetDateAccepted, screenForceError,
screenAnalyze; Comms.gs commsSync, and its two clocks) kept as the hiring records' facts in Postgres (the phone screens
and the candidates are dissolved), the Comms mirror's rows in app.edits. What is heavy — the model, the report in
Drive, the Quo tail — was prepared by the read the relay asked first (app/screening.py) and is only recorded here; the
team hears of a report through Smart Comms."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Callable

import candidate_writes as CDW
import candidates as CND
import gsjs
import interviews as IV
import interviews_writes as IVW
import locations as L
import screening as SG
import smart_comms as SC
import staff_views
import writes as W
from gsjs import NY
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

s_ = gsjs.str_
LANE = "screening"
REPORT_BY = "asa-hub:screen-report"
DATE_PERM = "hiring.dateManual"
_DAY_TIME = re.compile(r"^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$", re.A)


def _log(user: dict | None, action: str, target: str) -> None:
    """hubSysLog_."""
    staff_views.record(user, action, target)


def screen_facts(reads: L.Reads, cid: str, fields: dict[str, Any], by: str, at: str) -> list[dict]:
    """hubSetFieldLastRow_ on the dissolved phone screens: hiringLegacyWrite_(tab, cid, fields, by)."""
    return CDW.facts_of(reads, CDW.PHONE, cid, fields, by, cid, "", at=at) if fields else []


def _prepared(sess: L.Session, door: str, p: dict) -> dict[str, Any]:
    got = SG.unsealed(door, SG.actor(sess.user), p.get("prepared"))
    if got is None:
        raise Defer(f"{door} is recorded only after its reading was prepared by this service")
    return got


# ---- who the report reaches (hiringTeamRecipients_, simTeamAddress_) -------------------------------------------------

def rehearsal_addresses(reads: L.Reads) -> list[str]:
    """simTeamAddress_: a rehearsal's report reaches the simulation's deciders, its watchers beside them."""
    try:
        import hiring_sim as HS  # noqa: PLC0415 - the simulation's cast, where it is ported
        a = HS.actors(reads)
        deciders, watchers = list(a.get("decider_emails") or []), list(a.get("watcher_emails") or [])
    except ImportError:
        rows, _why = CND.soft(lambda: CND.read_tab(reads, "hiring_sim_config"))
        cfg = {s_(r.get("key")): s_(r.get("value")) for r in rows or [] if s_(r.get("key"))}

        def listed(k: str) -> list[str]:
            return [x.strip() for x in re.split(r"[,;\n]+", cfg.get(k, "")) if "@" in x]
        team = listed("sim_team_emails") or IVW.team_emails(reads)
        deciders, watchers = listed("sim_decider_emails") or team[:2], listed("sim_watcher_emails")
    low = {x.lower() for x in deciders}
    return deciders + [w for w in watchers if w.lower() not in low]


def desk_to(sit: dict | None, floor: list[str]) -> list[str]:
    """Who the report reaches: the situation's own `to` on the Desk — its addresses by letter, its numbers by text, the
    `directors` keyword as the 5558 group — and the hiring team's addresses only while that cell is blank."""
    import smart_comms_desk as SCD  # noqa: PLC0415 - the Desk's list and keyword rules
    got = [d for d in SCD.smart_list((sit or {}).get("to")) if "@" in d or SCD.to_keyword(d) == "directors"
           or len(SCD.digits(d)) >= 10]
    return got or list(floor)


def tell_desk(reads: L.Reads, sid: str, to: list[str], vars_: dict[str, str], key: str, person: str) -> bool:
    """One letter per address and one text per number through Smart Comms (each held by the situation's own channels);
    whether any of them went (or already had)."""
    import smart_comms_desk as SCD  # noqa: PLC0415 - the Desk's keyword rule
    sent = False
    at_ms = int(reads.now.timestamp() * 1000)
    for dest in to:
        if "@" in dest:
            got = SC.raise_situation(None, situation=sid, to=dest, vars=vars_, key=key + "|" + dest.lower(),
                                     person=person, lane=LANE, at_ms=at_ms, prune=False, channel="email")
        else:
            one = SCD.team_dest(dest)
            if one is None:
                continue
            line, team = one
            got = SC.raise_situation(None, situation=sid, to=line, vars=vars_,
                                     key=key + "|sms|" + SCD.digits(line)[-10:], person=person, lane=LANE,
                                     at_ms=at_ms, prune=False, team=team)
        sent = sent or s_(got.get("state")) in ("sent", "already")
    return sent


# ---- the analysis recorded (screenAnalyze's writes, screenReportAndAdvance_) ----------------------------------------

def report_and_advance(reads: L.Reads, cid: str, cand: dict, score: Any, qual: str, report_url: str,
                       now: str) -> list[dict]:
    """screenReportAndAdvance_: once per candidate (the journey line is the memo) the team is told the report is in,
    and — only from Phone Screen — the card moves to Interview."""
    if s_(cand.get("archived")).lower() == "true" or CND.stage_of(cand.get("status")) != "phone-screen":
        return []
    name = s_(cand.get("candidatename"))
    journey = CND.journey_for(reads, cid)
    if journey is None:
        return []
    ctx = {"key": cid, "name": name}
    recs: list[dict] = []
    sit = IVW._situation(reads, SG.REPORT_SIT)
    if not any(s_(j.get("step")) == "screen_report" for j in journey) and sit:
        vars_ = {"name": name or cid, "score": str(score), "qualification": s_(qual) or "-",
                 "report_url": s_(report_url) or SG.strings(reads, "report.none")}
        # a rehearsal reaches the simulation's deciders; a real card, whoever the Desk's `to` names
        to = rehearsal_addresses(reads) if SG.test_card(reads, cand) else desk_to(sit, IVW.team_emails(reads))
        sent = tell_desk(reads, SG.REPORT_SIT, to, vars_, "screen_report_mail_" + cid, name or cid)
        recs += CDW.journey_records(reads, ctx, {
            "step": "screen_report", "channel": "email+sms", "ok": sent,
            "title": SG.strings(reads, "journey.screen_report.title"),
            "detail": SG.strings(reads, "journey.screen_report.detail", {
                "score": str(score), "qualification": s_(qual), "link": " · " + report_url if report_url else "",
                "unsent": "" if sent else " " + SG.strings(reads, "journey.screen_report.unsent")}),
            "by": REPORT_BY}, "")[2]
    recs += CDW.status_move(L.Session(reads, {"email": REPORT_BY}), cid, cand, "interview", "", now)
    recs += CDW.journey_records(reads, ctx, {
        "step": "phone_screen", "channel": "record", "ok": True,
        "title": SG.strings(reads, "journey.screen_done.title"),
        "detail": SG.strings(reads, "journey.screen_done.detail"), "by": REPORT_BY}, "")[2]
    return recs


def record_analysis(reads: L.Reads, cid: str, cand: dict, plan: dict, by: str, now: str) -> list[dict]:
    """The analysis' fields on the phone screen and, for a full reading, the report and the move."""
    recs = screen_facts(reads, cid, plan.get("fields") or {}, by, now)
    if plan.get("kind") == "full":
        recs += report_and_advance(reads, cid, cand, plan.get("score"), s_(plan.get("qualification")),
                                   s_(plan.get("report_url")), now)
    return recs


# ---- the doors ------------------------------------------------------------------------------------------------------

def save(sess: L.Session, payload: dict) -> Decision:
    """screenSave: the call form on the candidate's phone screen (a first one minted), then the gate read again."""
    reads, user = sess.reads, sess.user or {}
    if not SG.writer(user):
        return Decision(dict(SG.DENIED))
    p = payload if isinstance(payload, dict) else {}
    cid, bad = SG._cid_of(reads, p)
    if bad:
        return Decision(bad)
    cand, s = SG.evidence(reads, cid)
    if not cand:
        return W.refuse(404, SG.strings(reads, "refuse.no_candidate", {"id": cid}))
    SG.dissolved_or_defer(reads)
    W.gate(reads)
    by = s_(user.get("email"))
    now = SG.iso_now(reads)
    fields = {f: s_(p.get(f)) for f in SG.SCREEN_FIELDS if f in p}
    if not fields.get("screen_date"):
        fields["screen_date"] = now[:10]
    fields["screened_by"] = "asa-hub:" + by
    if s:
        recs = screen_facts(reads, cid, fields, by, now)
    else:
        fields.update(candidate_id=cid, candidatename=s_(cand.get("candidatename")),
                      phone_screen_id=SG.hex_id("PS_", 16), attempt_num="1", created_at=now, updated_at=now,
                      created_by="asa-hub:" + by)
        recs = screen_facts(reads, cid, fields, "append", now)
    gate = CND.gate_after(reads, cid, {CDW.PHONE: fields})
    return W.final({"status": 200, "data": {"saved": True, "gate_passed": bool(gate.get("ok")),
                                            "missing": [s_(r) for r in gate.get("reasons") or []]}}, recs, cid)


def manual_complete(sess: L.Session, payload: dict) -> Decision:
    """screenManualComplete: a recruiter screened by voice and one press attests it — the call, never the decision."""
    reads, user = sess.reads, sess.user or {}
    if not SG.writer(user):
        return Decision(dict(SG.DENIED))
    p = payload if isinstance(payload, dict) else {}
    cid, bad = SG._cid_of(reads, p)
    if bad:
        return Decision(bad)
    SG.dissolved_or_defer(reads)
    W.gate(reads)
    env, recs = CDW.screen_manual(sess, {"key": cid}, {"notes": s_(p.get("notes"))}, "")
    if env.get("status") != 200:
        return Decision(env)
    _log(user, "screen_manual_complete", cid + " — " + SG.strings(reads, "manual_screen.logged"))
    return W.final(env, recs, cid)


def _real_day_time(v: str) -> bool:
    """Shape is not truth: the components round-tripped on the script's clock."""
    m = _DAY_TIME.match(v)
    if not m:
        return False
    y, mo, d, hh, mi = (int(m.group(i)) for i in range(1, 6))
    try:
        at = datetime(y, mo, d, hh, mi, tzinfo=NY)
    except ValueError:
        return False
    back = datetime.fromtimestamp(at.timestamp(), timezone.utc).astimezone(NY)
    return (back.year, back.month, back.day, back.hour, back.minute) == (y, mo, d, hh, mi)


def set_date_accepted(sess: L.Session, payload: dict) -> Decision:
    """screenSetDateAccepted: the in-person slot written as typed — an explicit human choice outranks the automatic
    lane's guards; an admin, or anyone granted hiring.dateManual."""
    reads, user = sess.reads, sess.user or {}
    if SG.service(user) or not user or (s_(user.get("role")) != "admin"
                                        and IV._overrides(reads, user).get(DATE_PERM) is not True):
        return W.refuse(403, SG.strings(reads, "refuse.date_manual.access"))
    p = payload if isinstance(payload, dict) else {}
    cid, bad = SG._cid_of(reads, p)
    if bad:
        return Decision(bad)
    day_time = s_(p.get("day_time"))
    if not _DAY_TIME.match(day_time):
        return W.refuse(400, SG.strings(reads, "refuse.date_manual.format"))
    if not _real_day_time(day_time):
        return W.refuse(400, SG.strings(reads, "refuse.date_manual.not_real"))
    cand, s = SG.evidence(reads, cid)
    if not cand:
        return W.refuse(404, SG.strings(reads, "refuse.no_candidate", {"id": cid}))
    if not s:
        return W.refuse(409, SG.strings(reads, "refuse.no_screening_card"))
    SG.dissolved_or_defer(reads)
    W.gate(reads)
    by = s_(user.get("email"))
    recs = screen_facts(reads, cid, {"best_in_person_day_time": day_time,
                                     "date_accepted_manual_by": "asa-hub:manual:" + by}, by, SG.iso_now(reads))
    _log(user, "screen_manual_date", cid + " — " + day_time)
    return W.final({"status": 200, "data": {"set": True, "day_time": day_time}}, recs, cid)


def force_error(sess: L.Session, payload: dict) -> Decision:
    """screenForceError: an admin's rehearsal of the failure path on a test card — every step populated but the
    accepted date, and the card held until Use The Last; the escalation is the team alerts' (app/team_alerts.py)."""
    reads, user = sess.reads, sess.user or {}
    if SG.service(user) or s_(user.get("role")) != "admin":
        return Decision(dict(SG.DENIED))
    p = payload if isinstance(payload, dict) else {}
    cid, bad = SG._cid_of(reads, p)
    if bad:
        return Decision(bad)
    cand, _s = SG.evidence(reads, cid)
    if not cand:
        return W.refuse(404, SG.strings(reads, "refuse.no_candidate", {"id": cid}))
    if CND.stage_of(cand.get("status")) != "phone-screen":
        return W.refuse(409, SG.strings(reads, "refuse.force_error.stage"))
    if not SG.test_card(reads, cand):
        return W.refuse(409, SG.strings(reads, "refuse.force_error.test_only"))
    prep = _prepared(sess, "screenForceError", p)
    if prep.get("cid") != cid:
        raise Defer("the prepared reading names another candidate")
    SG.dissolved_or_defer(reads)
    W.gate(reads)
    now, by = s_(prep.get("now")), s_(user.get("email"))
    fields = {"screen_status": "Completed", "screen_date": now, "transcript_text": s_(prep.get("mock")),
              "transcript_call_id": SG.hex_id("FORCE_ERR_", 10), "transcript_created": now,
              "transcript_pulled_at": now, "screen_score": "7", "qualification": "Qualified",
              "notes": SG.strings(reads, "force_error.notes"), "phone_screen_report_url": "", "final_result": "",
              "best_in_person_day_time": "", "error_hold": "true", "screened_by": "asa-hub:force-error:" + by}
    recs = screen_facts(reads, cid, fields, by, SG.iso_now(reads))
    _log(user, "screen_force_error", cid + " — populated, hold on; alerted=false")
    return W.final({"status": 200, "data": {"forced": True, "alerted": False, "alert": None,
                                            "message": SG.strings(reads, "force_error.said.silent")}}, recs, cid)


def analyze(sess: L.Session, payload: dict) -> Decision:
    """screenAnalyze: the reading screenAnalyzePrepare made — the score, the report's link and the accepted slot on
    the phone screen (a blank never overwritten), then the report told and the card moved from Phone Screen."""
    reads, user = sess.reads, sess.user or {}
    if not SG.writer(user):
        return Decision(dict(SG.DENIED))
    p = payload if isinstance(payload, dict) else {}
    cid, bad = SG._cid_of(reads, p)
    if bad:
        return Decision(bad)
    cand, s = SG.evidence(reads, cid)
    if not cand:
        return W.refuse(404, SG.strings(reads, "refuse.no_candidate", {"id": cid}))
    if not s:
        return W.refuse(409, SG.strings(reads, "refuse.no_screening_saved"))
    prep = _prepared(sess, "screenAnalyze", p)
    if prep.get("cid") != cid or not isinstance(prep.get("plan"), dict):
        raise Defer("the prepared reading names another candidate")
    SG.dissolved_or_defer(reads)
    W.gate(reads)
    plan = prep["plan"]
    recs = record_analysis(reads, cid, cand, plan, s_(user.get("email")), SG.iso_now(reads))
    return W.final({"status": 200, "data": plan.get("data") or {}}, recs, cid)


# ---- the Comms mirror and the screening calls (commsSync) ----------------------------------------------------------

def _mirror_records(reads: L.Reads, prep: dict) -> tuple[list[dict], dict[str, int]]:
    """The window's rows on the Comms mirror (appended, or their moved cells changed), the webhook's messages and the
    new summaries — each tab the copy holds."""
    recs: list[dict] = []
    kept = {"transcripts": 0, "messages": 0, "summaries": 0}
    mirror = prep.get("mirror") or {}
    sid, ref = SG.comms_ref(reads, "transcripts")
    if ref is not None:
        for r in mirror.get("appends") or []:
            recs.append(W.kept_record(sid, ref.tab, "append", "cols:Call ID", s_(r.get("Call ID")), "comms",
                                      {c: r.get(c, "") for c in SG.T_COLS}))
            kept["transcripts"] += 1
        for e in mirror.get("edits") or []:
            recs.append(W.kept_record(sid, ref.tab, "edit", "cols:Call ID", s_(e.get("key")), "comms",
                                      e.get("cells") or {}))
    m_rows = prep.get("m_rows") or []
    if m_rows:
        msid, mref = SG.comms_ref(reads, "messages")
        if mref is not None:
            have = {gsjs.trim(gsjs.or_blank(raw.get("Message ID"))) for _rn, raw in reads.db.rows(mref)}
            for m in m_rows:
                if m[0] and m[0] not in have:
                    recs.append(W.kept_record(msid, mref.tab, "append", "cols:Message ID", m[0], "comms",
                                              dict(zip(SG.M_COLS, m))))
                    kept["messages"] += 1
    s_rows = prep.get("s_rows") or []
    if s_rows:
        ssid, sref = SG.comms_ref(reads, "summaries")
        if sref is not None:
            for r in s_rows:
                recs.append(W.kept_record(ssid, sref.tab, "append", "cols:call_id", s_(r.get("call_id")), "comms",
                                          {c: r.get(c, "") for c in SG.S_COLS}))
                kept["summaries"] += 1
    return recs, kept


def _attached(reads: L.Reads, prep: dict, by: str, now: str, park: bool) -> tuple[list[dict], int, int]:
    """The calls the reading attached (a call another write attached meanwhile is not attached twice), then each
    card's analysis; the drawer's result parked when asked."""
    recs: list[dict] = []
    attaches = prep.get("attaches") or []
    plans = prep.get("plans") or {}
    if not attaches and not plans:
        return recs, 0, 0
    SG.dissolved_or_defer(reads)
    done = SG.screen_index(reads)["done"]
    took = 0
    fresh: dict[str, dict] = {}
    for a in attaches:
        if s_(a.get("call_id")) in done:
            continue
        recs += screen_facts(reads, a["cid"], a.get("fields") or {}, by, now)
        fresh[a["cid"]] = a
        took += 1
    analyzed = 0
    for cid, plan in plans.items():
        if plan.get("status") != 200 or (cid in {x["cid"] for x in attaches} and cid not in fresh):
            continue
        cand, _s = SG.evidence(reads, cid)
        if not cand:
            continue
        recs += record_analysis(reads, cid, cand, plan, by, now)
        analyzed += 1
    if park:
        for cid, a in fresh.items():
            _cand, s = SG.evidence(reads, cid)
            plan = plans.get(cid)
            after = SG.laid(SG.laid(s, a.get("fields") or {}),
                            (plan or {}).get("fields") or {} if (plan or {}).get("status") == 200 else {})
            SG.park(cid, SG.ready_of(a, plan, after))
    return recs, took, analyzed


def _comms(sess: L.Session, prep: dict) -> Decision:
    reads = sess.reads
    W.gate(reads)
    now = SG.iso_now(reads)
    recs, _kept = _mirror_records(reads, prep)
    more, _took, _n = _attached(reads, prep, s_(prep.get("by")) or "trigger", now, False)
    counts = dict(prep.get("counts") or {})
    counts["note"] = SG.comms_note(reads, counts, bool(prep.get("truncated")))
    return W.final({"status": 200, "data": counts}, recs + more, "")


def comms_sync(sess: L.Session, payload: dict) -> Decision:
    """commsSync: the seven-day window, its summaries and the screening calls commsSyncPrepare read, recorded."""
    user = sess.user or {}
    if not SG.writer(user) and not SG.service(user):
        return Decision(dict(SG.DENIED))
    return _comms(sess, _prepared(sess, "commsSync", payload if isinstance(payload, dict) else {}))


def comms_sync_sweep(sess: L.Session, payload: dict) -> Decision:
    """commsAutoSync on the relay's clock: what commsSyncDue read, recorded."""
    if not SG.service(sess.user):
        return W.refuse(403, "The Comms sweep is the relay's alone.")
    p = payload if isinstance(payload, dict) else {}
    got = SG.unsealed("commsSyncSweep", "service", p.get("prepared"))
    if got is None:
        raise Defer("commsSyncSweep is read by commsSyncDue first")
    return _comms(sess, got)


def collect_sweep(sess: L.Session, payload: dict) -> Decision:
    """commsOnQuoChange on the relay's clock: the screening calls screenCollectDue found attached and read, each
    candidate's result parked for the drawer's watch."""
    if not SG.service(sess.user):
        return W.refuse(403, "The screening collection is the relay's alone.")
    p = payload if isinstance(payload, dict) else {}
    if isinstance(p.get("prepared"), dict) and p["prepared"].get("due") is False:
        return Decision({"status": 200, "data": {"attached": 0, "analyzed": 0}})
    got = SG.unsealed("screenCollectSweep", "service", p.get("prepared"))
    if got is None:
        raise Defer("screenCollectSweep is read by screenCollectDue first")
    reads = sess.reads
    W.gate(reads)
    recs, took, analyzed = _attached(reads, got, "quo-trigger", SG.iso_now(reads), True)
    if took:
        log.info("screening: %s call(s) attached by the clock, %s read", took, analyzed)
    return W.final({"status": 200, "data": {"attached": took, "analyzed": analyzed}}, recs, "")


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "screenSave": save, "screenManualComplete": manual_complete, "screenSetDateAccepted": set_date_accepted,
    "screenForceError": force_error, "screenAnalyze": analyze, "commsSync": comms_sync,
    "commsSyncSweep": comms_sync_sweep, "screenCollectSweep": collect_sweep}
# the roles are each door's own gate (screenSetDateAccepted lets an admin or a hiring.dateManual grant in)
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.screening_writes and app.screening_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="screening", label="Phone screens")
