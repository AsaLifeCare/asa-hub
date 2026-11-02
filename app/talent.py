"""The hiring board's own reads (apps-script/Talent.gs, HiringJourney.gs) off asa-hub-db: the candidates nobody can
phone and the archive (talentNoNumberList), what happened along the hiring journey (hiringJourneyList), and who the
platform would write to right now (hiringTeamDirectory). The candidates and the journey are the dissolved hiring tabs'
facts."""
from __future__ import annotations

import functools
import json
import re
from typing import Any, Callable

import candidates as CND
import gsjs
import interviews_writes as IW
import locations as L
import smart_comms_desk as SCD
import talent_pipeline as TP
import team_alerts as TA

CANDIDATES = CND.TALENT_CANDIDATES_TAB
# HiringJourney.gs HIRING_JOURNEY_STEP_IDS: the steps the journey names, each worded by the book's Steps tab
JOURNEY_STEP_IDS = ("welcome", "ask", "shortlist", "interest", "sim_retry", "interest_thanks", "outreach_sms",
                    "outreach_reply", "screen_call", "resume_request", "resume_on_file", "cjis_request", "cjis_filed",
                    "phone_screen", "screen_done", "decision_ask", "decision", "schedule_invite", "candidate_picked",
                    "interviewer_ask", "interviewer_reply", "interview_booked", "interview_scored", "onboarding",
                    "onboarding_account", "discarded", "hired")
UNREADABLE_JOURNEY = "the hiring_journey tab could not be read — this is not an empty journey"

s_ = gsjs.str_


# ---- the candidates nobody can phone (talentNoNumberList) ------------------------------------------------------

def no_number_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """talentNoNumberList: every live card without a number we may text, and every archived card (a discarded one
    with a phone appears nowhere else), newest first, with the counts."""
    reads = sess.reads
    if not TP.writer(sess.user):
        return dict(TP.DENIED)
    rows: list[dict] = []
    counts = {"total": 0, "with_email": 0, "with_referral": 0, "nothing": 0, "archived": 0, "discarded_with_phone": 0}
    got, why = CND.soft(lambda: CND.read_tab(reads, CANDIDATES))
    if why:
        return {"status": 500, "message": TP.words(reads, "refuse.talent.unreadable",
                                                   "The candidates tab could not be read: {error}", {"error": why})}
    for c in got or []:
        cid = s_(c.get("candidateid"))
        if not cid or cid in CND.TALENT_EXCLUDE_IDS:
            continue
        name = s_(c.get("candidatename"))
        if not name:
            continue
        email = s_(c.get("email"))
        ref_phone = s_(c.get("referralphone"))
        archived = s_(c.get("archived")).lower() == "true"
        phone_ok = bool(SCD.sendable(s_(c.get("phone"))))
        if not archived and phone_ok:
            continue
        counts["total"] += 1
        if email:
            counts["with_email"] += 1
        if SCD.sendable(ref_phone):
            counts["with_referral"] += 1
        if not email and not SCD.sendable(ref_phone):
            counts["nothing"] += 1
        if archived:
            counts["archived"] += 1
            if phone_ok:
                counts["discarded_with_phone"] += 1
        rows.append({"id": cid, "name": name, "status": s_(c.get("status")),
                     "stage": CND.stage_of(s_(c.get("status"))) or "", "email": email, "phone_raw": s_(c.get("phone")),
                     "referral_name": s_(c.get("referralname")) or CND.referrer_from_source(s_(c.get("source"))),
                     "referral_phone": ref_phone, "source": s_(c.get("source")), "applied_at": s_(c.get("createdat")),
                     "phone_status": s_(c.get("phonestatus")), "phone_ask_at": s_(c.get("phoneaskat")),
                     "archived": archived, "archived_at": s_(c.get("archivedat")),
                     "archived_reason": s_(c.get("archivedreason")), "resume_link": s_(c.get("resumelink")),
                     "is_test": bool(TA.test_card(reads, c))})
    rows.sort(key=functools.cmp_to_key(lambda a, b: gsjs.locale_cmp(s_(b["applied_at"]), s_(a["applied_at"]))))
    return {"status": 200, "data": {"rows": rows, "counts": counts}}


# ---- the hiring journey (hiringJourneyList) ---------------------------------------------------------------------

def journey_steps(reads: L.Reads) -> dict[str, str]:
    """hiringJourneySteps_: each step's words from the book's Steps tab, '' where it names none."""
    got, why = CND.soft(lambda: CND.book_kv(reads, "Steps"))
    if why or got is None:
        got = {}
    return {sid: s_(got.get("journey." + sid)) for sid in JOURNEY_STEP_IDS}


def journey_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringJourneyList: what happened in the hiring journey, for one candidate or across the pipeline, oldest first;
    an unreadable journey said as such, never as an empty one."""
    reads = sess.reads
    cid = s_((payload or {}).get("candidate_id"))
    rows = CND.journey_for(reads, cid)
    if rows is None:
        return {"status": 200, "data": {"journey": None, "unreadable": True, "note": UNREADABLE_JOURNEY}}
    return {"status": 200, "data": {"journey": rows, "steps": journey_steps(reads)}}


# ---- who the platform writes to (hiringTeamDirectory) -----------------------------------------------------------

def _json_list(raw: Any) -> list:
    try:
        got = json.loads(s_(raw) or "[]")
    except ValueError:
        return []
    return got if isinstance(got, list) else []


def team_names(reads: L.Reads) -> dict[str, str]:
    """hiringTeamRecipients_().names: every live account's addresses, the extra ones too, to its name."""
    names: dict[str, str] = {}
    for u in reads.users():
        if s_(u.get("mergedinto")):
            continue
        for addr in [s_(u.get("email"))] + [gsjs.or_blank(x) for x in _json_list(u.get("emails"))]:
            key = addr.strip().lower()
            if key and key not in names:
                names[key] = s_(u.get("displayname"))
    return names


def interviewers(reads: L.Reads) -> list[dict[str, str]]:
    """hiringInterviewersByBadge_: the live accounts with the interviewer role or the INTERVIEWER badge."""
    out = []
    for u in reads.users():
        if s_(u.get("mergedinto")) or s_(u.get("active")).lower() != "true":
            continue
        types = s_(u.get("types")).upper()
        role = s_(u.get("role")).lower()
        if role != "interviewer" and "INTERVIEWER" not in [t.strip() for t in re.split(r"[,;|]+", types)]:
            continue
        phone = s_(u.get("phone"))
        if not phone:
            first = (_json_list(u.get("phones")) or [None])[0]
            phone = s_(first.get("number")) if isinstance(first, dict) else ""
        out.append({"user_id": s_(u.get("userid")), "name": s_(u.get("displayname")), "email": s_(u.get("email")),
                    "phone": SCD.sendable(phone), "role": role, "types": s_(u.get("types"))})
    return out


def interviewer_pick(reads: L.Reads, everyone: list[dict[str, str]], prefer: str = "") -> dict[str, str]:
    """hiringInterviewerPick_: the badge holder the config names, else the first with an e-mail; the config's name only
    orders the badge holders, a phone after it overrides theirs."""
    if not everyone:
        return {"name": "", "email": "", "phone": "", "by": "nobody holds the INTERVIEWER badge"}
    want = s_(prefer)
    if not want:
        got, why = CND.soft(lambda: reads.config().get("interview_supervisor_name"))
        want = "" if why else s_(got)
    override = ""
    m = re.search(r"[+\d][\d\s().-]{9,}", want)
    if m:
        override = SCD.sendable(m.group(0))
        want = want.replace(m.group(0), "", 1)
    want = re.sub(r"[,;]+\s*$", "", want).strip()
    picked = next((p for p in everyone if want and p["name"] and p["name"].lower() == want.lower()), None)
    by = "named in interview_supervisor_name and holds the badge"
    if picked is None:
        picked = next((p for p in everyone if p["email"]), None) or everyone[0]
        by = (f'"{want}" does not hold the INTERVIEWER badge — asked the badge holder instead' if want
              else "holds the INTERVIEWER badge")
    return {"name": picked["name"], "email": picked["email"], "phone": override or picked["phone"],
            "user_id": picked["user_id"], "by": by}


def team_directory(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringTeamDirectory: who the platform would write to right now — the hiring team, the interviewers, the one it
    would ask, and where test mode sends instead."""
    reads = sess.reads
    team, why = CND.soft(lambda: IW.team_emails(reads))
    everyone = interviewers(reads)
    st, why_t = CND.soft(lambda: SCD.test_mode_state(reads.config()))
    return {"status": 200, "data": {
        "team": [] if why else team, "team_names": team_names(reads), "interviewers": everyone,
        "interviewer": interviewer_pick(reads, everyone),
        "test_mode": {"on": bool(st["on"]), "sms": st["sms"] or [], "emails": st["emails"] or []}
        if st and not why_t else None}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "talentNoNumberList": no_number_list, "hiringJourneyList": journey_list, "hiringTeamDirectory": team_directory}
POLICY: dict[str, dict[str, Any]] = {
    "talentNoNumberList": {"roles": ("admin", "manager")},
    "hiringJourneyList": {"roles": ("admin", "manager", "interviewer"), "params": {"candidate_id": "string"}},
    "hiringTeamDirectory": {"roles": ("admin", "manager")}}
