"""The hiring simulator (HiringSim.gs, HiringSimConfig.gs) off asa-hub-db: its config and resolved cast
(hiringSimConfigGet), the one read that draws the simulator screen (hiringSimState), and the reads that prepare its
writes — the teardown's Drive half (hiringSimResetPrepare: the "(SIM)" files the rehearsal dropped in the docs folder,
put in the bin), and the deciders' replies read out of the platform mailbox and judged by the rule, else the model
(hiringInterestScanPrepare, hiringSimRetryDue for the retry pass and its clock, hiringSimPretendReplyPrepare for a
typed reply). The config is the dissolved hiring_sim_config tab, read off the runtime's facts by subject — the copy
withholds its key cell."""
from __future__ import annotations

import json
import re
import time
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import client_care_sweeps as CCS
import gsjs
import hiring_sim_defaults as D
import interviews_writes as IW
import locations as L
import mail_server as MB
import recon as RC
import smart_comms as SC
import smart_comms_desk as SCD
import team_alerts as TA
from scope import Defer

APP_ID = "hiring"
CFG_TAB, ASKS_TAB, AI_TAB = "hiring_sim_config", "hiring_sim_asks", "hiring_sim_ai"
# simInterestVerdictRule_: a whole-message OK; partial phrases go to the model
INTEREST_OK = re.compile(r"(ok|okay|yes|sim|go ahead|proceed|pode seguir|aprovado|approved)")
INTEREST_VERDICTS = ("ok", "selected", "more", "other")
INTEREST_PROMPT, INTEREST_PROMPT_NONE = "ai_interest_reply", "ai_interest_reply_none"
SCAN_LIMIT = 30
MODEL_BUDGET_S = 90.0
SIM_FIRST, SIM_LAST = "[TEST]", "Rehearsal Candidate"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
CAN_ID = re.compile(r"^CAN_[A-Za-z0-9]{6,}$")
ACTOR_MAILBOX = re.compile(r"^asa-hub[0-9]*@asaop\.org$")
SCREEN_DIGITS = "3307544040"
# cjisFolderId_'s properties, in its order
CJIS_FOLDER_PROPS = ("HUB_FOLDER_ORIGINAL_DOCS", "COMPLIANCE_SHARED_FOLDER_ID", "CJIS_FOLDER_ID")
SIM_FILE_MARK = "(SIM)"
# HIRING_SIM_TABS: every tab a rehearsal files rows in, by the column that names the card
TABS = (("entity_candidates", "candidate_id"), ("entity_resume_analyses", "candidate_id"),
        ("entity_phone_screens", "candidate_id"), ("entity_in_person_interviews", "candidate_id"),
        ("entity_inbound_messages", "candidate_id"), ("interview_asks", "candidate_id"),
        ("hiring_journey", "candidate_id"), ("entity_hiring_events", "candidate_id"), ("hiring_sim_asks", "candidate_id"))
ATTEMPT_STEPS = ("ask", "shortlist", "outreach", "invite")

# HIRING_SIM_STEPS: structure only (the words live in the book's Steps tab); a step with no action is only observed
STEPS: tuple[dict[str, Any], ...] = (
    {"id": "ask", "n": 0, "pretend": {"channel": "team", "preset": "sim_pretend_ask_reply"},
     "action": "hiringAskSend", "to": "team", "channel": "email"},
    {"id": "shortlist", "n": 1, "action": "hiringShortlistSend", "to": "team", "channel": "email"},
    {"id": "interest", "n": 2, "pretend": {"channel": "team", "preset": "sim_pretend_interest_reply"},
     "action": "hiringInterestScan", "to": "team", "channel": "email"},
    {"id": "interest_thanks", "n": 3, "action": "hiringInterestThanksSend", "to": "team", "channel": "email"},
    {"id": "outreach_sms", "n": 4, "action": "hiringOutreachSend", "to": "candidate", "channel": "email+sms"},
    {"id": "outreach_reply", "n": 4.5, "pretend": {"channel": "candidate", "preset": "sim_pretend_outreach_reply"},
     "action": "hiringOutreachReplyCheck", "to": "team", "channel": "email"},
    {"id": "accepted", "n": 5, "action": "hiringAcceptedNotify", "to": "team", "channel": "email+sms"},
    {"id": "screen_call", "n": 5.2, "action": "hiringScreenCallSend", "to": "candidate", "channel": "email+sms"},
    {"id": "screen_watch", "n": 5.4, "loop": True, "action": "hiringSimScreenEvaluate", "to": "team",
     "channel": "email+sms"},
    {"id": "resume_request", "n": 5.5, "action": "hiringResumeRequestSend", "to": "candidate", "channel": "email"},
    {"id": "cjis_request", "n": 6, "action": "hiringCjisRequestSend", "to": "team", "channel": "email"},
    {"id": "cjis_scan", "n": 6.5, "action": "cjisFolderSweepNow", "to": "card", "channel": "drive"},
    {"id": "resume_scan", "n": 6.6, "action": "resumeInboxScan", "to": "card", "channel": "drive"},
    {"id": "phone_screen", "n": 7, "action": "moveStage", "to": "card", "channel": "gate"},
    {"id": "screen_seed", "n": 8, "action": "hiringSimTranscriptSeed", "to": "card", "channel": "record"},
    {"id": "screen_analyze", "n": 8.3, "action": "screenAnalyze", "to": "card", "channel": "record"},
    {"id": "decision_ask", "n": 8.7, "action": "hiringDecisionAskSend", "to": "team", "channel": "email+sms"},
    {"id": "cjis_recheck", "n": 8.9, "action": "hiringCjisRequestSend", "to": "team", "channel": "email+sms"},
    {"id": "schedule_invite", "n": 9, "pretend": {"channel": "pick"}, "action": "interviewInviteSend",
     "to": "candidate", "channel": "email+sms"},
    {"id": "interviewer_ask", "n": 10,
     "pretend": {"channel": "interviewer", "preset": "sim_pretend_interviewer_reply"},
     "action": "interviewAskSweepNow", "to": "interviewer", "channel": "email+sms"},
    {"id": "referral_arrives", "n": 0.1, "action": "hiringSimReferralSeed", "to": "card", "channel": "record"},
    {"id": "manual_add", "n": 0.2, "action": "hiringSimSeed", "to": "card", "channel": "record"},
    {"id": "manual_contact", "n": 0.3, "action": "manualContactSend", "to": "candidate", "channel": "email+sms"},
    {"id": "director_add", "n": 0.4, "action": "", "to": "card", "channel": "record"},
    {"id": "director_docs", "n": 0.5, "action": "", "to": "team", "channel": "email+sms"},
    {"id": "sim_evidence", "n": 6.8, "action": "hiringSimEvidenceFill", "to": "card", "channel": "record"},
    {"id": "discarded", "n": 11, "action": "hiringDiscard", "to": "team", "channel": "email"},
    {"id": "journey", "n": 13, "action": "", "to": "card", "channel": "record"},
    {"id": "interview_scored", "n": 14, "action": "", "to": "card", "channel": "gate"},
    {"id": "onboarding", "n": 15, "action": "", "to": "candidate", "channel": "email"},
    {"id": "first_login", "n": 15.1, "action": "", "to": "candidate", "channel": "email+sms"},
    {"id": "portal_finale", "n": 15.2, "action": "", "to": "candidate", "channel": "web"},
    {"id": "ready_ask", "n": 15.3, "action": "", "to": "team", "channel": "email+sms"},
    {"id": "ready_move", "n": 15.4, "action": "", "to": "card", "channel": "record"},
    {"id": "ready_parked", "n": 15.5, "action": "", "to": "team", "channel": "email+sms"},
    {"id": "talent_cross", "n": 15.6, "action": "", "to": "card", "channel": "record"},
    {"id": "application", "n": 15.7, "action": "", "to": "card", "channel": "record"},
    {"id": "application_unfinished", "n": 15.8, "action": "", "to": "card", "channel": "record"},
    {"id": "talent_autocross", "n": 15.9, "action": "", "to": "card", "channel": "record"},
    {"id": "talent_autofill", "n": "15.95", "action": "", "to": "card", "channel": "record"},
    {"id": "talent_store_remove", "n": "16", "action": "", "to": "card", "channel": "record"})

# each flow is an ordered reading of this one shared spine (appended, never inserted: numbering is positional)
MAIN_STEPS = ("ask", "shortlist", "cjis_request", "cjis_scan", "interest", "interest_thanks", "outreach_sms",
              "outreach_reply", "accepted", "resume_scan", "phone_screen", "screen_call", "screen_watch",
              "screen_analyze", "decision_ask", "cjis_recheck", "schedule_invite", "interviewer_ask", "discarded",
              "journey", "interview_scored", "onboarding", "first_login", "portal_finale", "ready_ask", "ready_move",
              "ready_parked", "talent_cross", "application", "application_unfinished", "talent_autocross",
              "talent_autofill", "talent_store_remove")
FLOWS = (("main", MAIN_STEPS),
         ("referral", ("referral_arrives", "resume_request") + MAIN_STEPS[2:]),
         ("manual", ("manual_add", "manual_contact") + MAIN_STEPS[2:]),
         ("director", ("director_add", "director_docs") + MAIN_STEPS[MAIN_STEPS.index("onboarding"):]))
GATE_STAGES = ("new", "phone-screen", "interview", "onboarding", "hired", "ready")

s_ = gsjs.str_


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and s_((user or {}).get("role")) in ("admin", "manager")


def _int(v: Any) -> int | None:
    """parseInt(v, 10); None for NaN."""
    n = CND.js_parse_int(v)
    return None if n != n else int(n)


def _soft(fn: Callable[[], Any], fallback: Any) -> Any:
    got, why = CND.soft(fn)
    return fallback if why else got


# ---- the config (hiringSimCfg_, simCfgVal_) ------------------------------------------------------------------------

def cfg(reads: L.Reads) -> dict[str, str]:
    """hiringSimCfg_: the whole config as {key: value}, each row of the dissolved tab under its subject."""
    def read() -> dict[str, str]:
        if not reads.db.dissolved(CFG_TAB):
            raise Defer("the hiring simulation config is read from the runtime's facts only while its tab is dissolved")
        out: dict[str, str] = {}
        for sub, row in CW.dissolved_rows(reads, CFG_TAB).items():
            k = gsjs.trim(sub)
            if k:
                out[k] = s_(row.get("value"))
        return out
    return reads.once("hsim:cfg", read)


def laid(reads: L.Reads, values: dict[str, str]) -> None:
    """The config as it reads once these cells are saved (the cache Apps Script drops after a save)."""
    reads.memo["hsim:cfg"] = {**cfg(reads), **values}


def default_of(key: str) -> tuple[str | None, str] | None:
    for k, v, note in D.CFG_DEFAULTS:
        if k == key:
            return v, note
    return None


def text_default(reads: L.Reads, key: str) -> str:
    """simTextDefault_: the shipped words of a sim_text_* row, off the book's Strings tab."""
    if not key.startswith("sim_text_"):
        return ""
    return CND.book_text(reads, "Strings", "sim.text." + key[9:], "")


def val(reads: L.Reads, key: str) -> str:
    """simCfgVal_: one value, the shipped default as the floor."""
    v = s_(cfg(reads).get(key))
    if v:
        return v
    d = default_of(key)
    if d is None:
        return ""
    return s_(d[0]) or text_default(reads, key)


def cfg_list(reads: L.Reads, key: str) -> list[str]:
    """simCfgList_."""
    return [x for x in (p.strip() for p in re.split(r"[,;\n]+", val(reads, key))) if x]


def cfg_rows(reads: L.Reads) -> dict[str, tuple[str, str]]:
    """Each default's value as a save would use it (a blank cell shows the shipped words) and its default."""
    have = cfg(reads)
    out: dict[str, tuple[str, str]] = {}
    for k, v, _note in D.CFG_DEFAULTS:
        cell = have.get(k, "")
        dv = s_(v) or text_default(reads, k)
        out[k] = (cell if cell != "" else dv, dv)
    return out


# ---- the fence and the cast (simOutboundGuard_, hiringSimActors_) ---------------------------------------------------

def outbound_guard(reads: L.Reads) -> bool:
    return val(reads, "sim_outbound_guard").lower() != "off"


def outbound_one_allowed(reads: L.Reads, dest: Any) -> bool:
    """simOutboundOneAllowed_: one address or number against the cast."""
    d = gsjs.trim(gsjs.or_text(dest)).lower()
    if not d:
        return True
    if "@" in d:
        if ACTOR_MAILBOX.match(d):
            return True
        for key in ("sim_candidate_email", "sim_interviewer_email", "sim_cc_emails", "sim_watcher_emails",
                    "sim_team_emails", "sim_decider_emails"):
            if any(a.lower() == d for a in cfg_list(reads, key)):
                return True
        return False
    dg = re.sub(r"[^0-9]", "", d)
    if not dg:
        return False
    nums = cfg_list(reads, "sim_team_sms") + [val(reads, "sim_candidate_phone"), val(reads, "sim_interviewer_phone")]
    for n in nums:
        nd = re.sub(r"[^0-9]", "", n)
        if nd and (nd == dg or "1" + nd == dg or nd == "1" + dg):
            return True
    return False


def sendable_phone(reads: L.Reads, raw: Any) -> str:
    """simSendablePhone_: a number we may text, or one of the cast's own shared lines while the fence stands."""
    to = SC.sendable(raw)
    if to:
        return to
    d = re.sub(r"^1", "", re.sub(r"\D", "", gsjs.or_text(raw)), count=1)
    if len(d) != 10:
        return ""
    return "+1" + d if outbound_guard(reads) and outbound_one_allowed(reads, "+1" + d) else ""


def actors(reads: L.Reads) -> dict[str, Any]:
    """hiringSimActors_: everything the simulation needs to address a message, in one shape."""
    team = cfg_list(reads, "sim_team_emails")
    if not team:
        team = list(_soft(lambda: IW.team_emails(reads), []) or [])
    deciders = [x for x in cfg_list(reads, "sim_decider_emails") if "@" in x] or team[:2]
    return {
        "mode": "redirect" if val(reads, "sim_mode").lower() == "redirect" else "actors",
        "screen_line": val(reads, "sim_screen_line"),
        "watcher_emails": [x for x in cfg_list(reads, "sim_watcher_emails") if "@" in x],
        "candidate_email": val(reads, "sim_candidate_email"),
        "candidate_phone": sendable_phone(reads, val(reads, "sim_candidate_phone")),
        "interviewer_name": val(reads, "sim_interviewer_name"),
        "interviewer_email": val(reads, "sim_interviewer_email"),
        "interviewer_phone": sendable_phone(reads, val(reads, "sim_interviewer_phone")),
        "cc_emails": [x for x in cfg_list(reads, "sim_cc_emails") if "@" in x],
        "team_emails": team, "decider_emails": deciders,
        "team_sms": [n for n in (sendable_phone(reads, x) for x in cfg_list(reads, "sim_team_sms")) if n],
        "decider_sms": [n for n in (sendable_phone(reads, x) for x in cfg_list(reads, "sim_decider_sms")) if n]}


def attempts_for(reads: L.Reads, step: str) -> dict[str, int]:
    """simAttemptsFor_: the step's own cells, then the global ones."""
    per, every = _int(val(reads, "sim_attempts_" + step)), _int(val(reads, "sim_attempts"))
    per_min, minutes = _int(val(reads, "sim_retry_minutes_" + step)), _int(val(reads, "sim_retry_minutes"))
    n = per if per is not None and per > 0 else (every if every is not None and every > 0 else 1)
    return {"attempts": min(n, 50),
            "minutes": per_min if per_min is not None and per_min >= 5 else
            (minutes if minutes is not None and minutes >= 5 else 30)}


def attempts(reads: L.Reads) -> dict[str, dict[str, int]]:
    return {k: attempts_for(reads, k) for k in ATTEMPT_STEPS}


def contacts(reads: L.Reads) -> dict[str, Any]:
    """hiringSimContacts_: actors mode sends for real to the cast; redirect mode needs test mode on."""
    a, why = CND.soft(lambda: actors(reads))
    mode = "redirect" if why else a["mode"]
    st = _soft(lambda: SCD.test_mode_state(reads.config()), None)
    if mode == "actors":
        a = actors(reads)
        return {"phone": a["candidate_phone"], "email": a["candidate_email"],
                "on": bool(a["candidate_phone"] and a["candidate_email"]), "mode": "actors",
                "test_mode_on": bool(st and st["on"])}
    sms, emails = (st or {}).get("sms") or [], (st or {}).get("emails") or []
    return {"phone": sms[0] if sms else "", "email": emails[0] if emails else "", "on": bool(st and st["on"]),
            "mode": "redirect", "test_mode_on": bool(st and st["on"])}


# ---- the rehearsal card ------------------------------------------------------------------------------------------

def is_test_card(reads: L.Reads, c: dict | None) -> bool:
    """commsIsTestCandidate_ (and packetIsRehearsal_, which it covers): a declared test card, the configured list, a
    [TEST] name, a platform actor mailbox, the platform's own test line or address."""
    if not c:
        return False
    cid = s_(c.get("candidateid"))
    if cid in TA.TEST_CARDS:
        return True
    if cid and cid in _soft(lambda: cfg_list(reads, "sim_test_candidate_ids"), []):
        return True
    if s_(c.get("candidatename")).lower().startswith("[test]"):
        return True
    email = s_(c.get("email")).lower()
    if ACTOR_MAILBOX.match(email):
        return True
    return SCD.digits(c.get("phone"))[-10:] == TA.TEST_LINE or email == TA.TEST_EMAIL


def is_rehearsal(reads: L.Reads, cid: str) -> bool:
    """simIsRehearsalCid_."""
    if not cid:
        return False
    ev = _soft(lambda: CND.evidence(reads, cid), None)
    return bool(ev and ev.get("cand") and is_test_card(reads, ev["cand"]))


def sim_card(reads: L.Reads) -> dict | None:
    """hiringSimCard_: the last card whose name opens with [TEST]."""
    rows = _soft(lambda: CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB), None)
    hit = None
    for c in rows or []:
        if s_(c.get("candidatename")).lower().startswith("[test]"):
            hit = c
    return hit


# ---- the people (hiringTeamRecipients_, hiringInterviewersByBadge_, hiringInterviewerPick_) ---------------------------

def team_recipients(reads: L.Reads) -> dict[str, Any]:
    """hiringTeamRecipients_: the team's addresses, and every account's name by each of its addresses."""
    emails = list(_soft(lambda: IW.team_emails(reads), []) or [])
    names: dict[str, str] = {}

    def read() -> None:
        for u in reads.users():
            if s_(u.get("mergedinto")):
                continue
            mine = [s_(u.get("email"))]
            try:
                extra = json.loads(s_(u.get("emails")) or "[]")
                if isinstance(extra, list) and extra:
                    mine += [gsjs.js_str(x) for x in extra]
            except ValueError:
                pass
            for addr in mine:
                key = gsjs.trim(addr).lower()
                if key and key not in names:
                    names[key] = s_(u.get("displayname"))
    CND.soft(read)
    return {"emails": emails, "names": names}


def interviewers_by_badge(reads: L.Reads) -> list[dict[str, str]]:
    """hiringInterviewersByBadge_: the active accounts with the role or the INTERVIEWER badge."""
    def read() -> list[dict[str, str]]:
        out = []
        for u in reads.users():
            if s_(u.get("mergedinto")) or s_(u.get("active")).lower() != "true":
                continue
            types = s_(u.get("types")).upper()
            role = s_(u.get("role")).lower()
            if role != "interviewer" and not any(t.strip() == "INTERVIEWER" for t in re.split(r"[,;|]+", types)):
                continue
            phone = s_(u.get("phone"))
            if not phone:
                try:
                    lst = json.loads(s_(u.get("phones")) or "[]")
                    phone = s_((lst[0] or {}).get("number")) if isinstance(lst, list) and lst and \
                        isinstance(lst[0], dict) else ""
                except ValueError:
                    phone = ""
            out.append({"user_id": s_(u.get("userid")), "name": s_(u.get("displayname")), "email": s_(u.get("email")),
                        "phone": SC.sendable(phone), "role": role, "types": s_(u.get("types"))})
        return out
    return _soft(read, [])


def interviewer_pick(reads: L.Reads, prefer: str = "") -> dict[str, str]:
    """hiringInterviewerPick_: the config name orders the badge holders; it never grants the right to interview."""
    every = interviewers_by_badge(reads)
    if not every:
        return {"name": "", "email": "", "phone": "", "by": "nobody holds the INTERVIEWER badge"}
    want = s_(prefer) or _soft(lambda: s_(reads.config().get("interview_supervisor_name")), "")
    override = ""
    m = re.search(r"[+\d][\d\s().-]{9,}", want)
    if m:
        override = SC.sendable(m.group(0))
        want = want.replace(m.group(0), "", 1)
    want = re.sub(r"[,;]+\s*$", "", want).strip()
    picked = next((p for p in every if want and p["name"] and p["name"].lower() == want.lower()), None)
    by = "named in interview_supervisor_name and holds the badge"
    if picked is None:
        picked = next((p for p in every if p["email"]), every[0])
        by = (f'"{want}" does not hold the INTERVIEWER badge — asked the badge holder instead' if want
              else "holds the INTERVIEWER badge")
    return {"name": picked["name"], "email": picked["email"], "phone": override or picked["phone"],
            "user_id": picked["user_id"], "by": by}


# ---- the ladder, rung by rung (hubGateFor_) -------------------------------------------------------------------------

def gate_for(reads: L.Reads, ev: dict, stage: str) -> dict[str, Any]:
    """hubGateFor_: one rung's code verdict, the board book's while it is on."""
    code = CND.gate_code(reads, ev, stage)
    if not code.get("from") or not code.get("to"):
        return code

    def ride() -> dict[str, Any]:
        mode = CND.registry(reads).get("board") or {"id": "", "status": ""}
        if not mode["id"] or mode["status"] not in ("shadow", "on"):
            return code
        book = CND.gate_eval(CND.matrix_tab(reads, "board", "Transitions"),
                             CND.matrix_tab(reads, "board", "Flow Bindings"),
                             CND.matrix_tab(reads, "board", "Conditions"),
                             CND.facts_from_evidence(reads, "board", ev), code["from"], code["to"])
        if book is None:
            return code
        return book if mode["status"] == "on" else code
    return _soft(ride, code)


# ---- the attempt book and the words ------------------------------------------------------------------------------

def asks_out(reads: L.Reads) -> list[dict[str, str]]:
    """simAskRows_, as the screens draw them."""
    return [{"id": s_(r.get("simaskid")), "step": s_(r.get("step")), "candidate_id": s_(r.get("candidateid")),
             "sent": s_(r.get("sentcount")), "max": s_(r.get("maxattempts")),
             "interval_minutes": s_(r.get("intervalminutes")), "last_sent_at": s_(r.get("lastsentat")),
             "state": s_(r.get("state")), "answered_by": s_(r.get("answeredby"))} for r in CND.sim_ask_rows(reads)]


def steps_with_words(reads: L.Reads) -> list[dict[str, Any]]:
    """hiringSimStepsWithWords_: each step's words from the book's Steps tab."""
    words = CND.book_kv(reads, "Steps")
    out = []
    for st in STEPS:
        o = dict(st)
        o["title"] = s_(words.get(st["id"] + ".title"))
        o["about"] = s_(words.get(st["id"] + ".about"))
        more = s_(words.get(st["id"] + ".more"))
        if more:
            o["more"] = more.split("\n")
        if st.get("loop"):
            o["loop"] = s_(words.get(st["id"] + ".loop"))
        if st.get("pretend"):
            o["pretend"] = {**st["pretend"], "label": s_(words.get(st["id"] + ".pretend.label")),
                            "hint": s_(words.get(st["id"] + ".pretend.hint"))}
        out.append(o)
    return out


def flows_with_words(reads: L.Reads) -> list[dict[str, Any]]:
    """hiringSimFlowsWithWords_."""
    words = CND.book_kv(reads, "Steps")
    return [{"id": fid, "steps": list(steps), "title": s_(words.get(f"flow.{fid}.title")),
             "about": s_(words.get(f"flow.{fid}.about"))} for fid, steps in FLOWS]


# ---- the doors ---------------------------------------------------------------------------------------------------

def config_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringSimConfigGet: every row with its note and default, the resolved cast, the clocks and the ask book."""
    reads = sess.reads
    if not writer(sess.user):
        return dict(DENIED)
    rows = cfg_rows(reads)
    return {"status": 200, "data": {
        "rows": [{"key": k, "value": rows[k][0], "note": note, "default_value": rows[k][1]}
                 for k, _v, note in D.CFG_DEFAULTS],
        "actors": actors(reads), "attempts": attempts(reads), "asks": asks_out(reads)}}


def sim_state(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringSimState: everything the simulator draws, in one read."""
    reads = sess.reads
    cid = s_((payload or {}).get("candidate_id"))
    card = None
    if cid:
        ev0 = _soft(lambda: CND.evidence(reads, cid), None)
        card = (ev0 or {}).get("cand")
    else:
        card = sim_card(reads)
        cid = s_((card or {}).get("candidateid"))
    con = contacts(reads)
    team = team_recipients(reads)
    gate = gates = None
    stage = ""
    evidence = None
    if card:
        ev, why = CND.soft(lambda: CND.evidence(reads, s_(card.get("candidateid"))))
        if not why:
            evidence = ev
            stage = CND.stage_of(card.get("status")) or s_(card.get("status"))
            gate = _soft(lambda: CND.stage_gate(reads, ev), None)
            if gate is not None:
                gates = _soft(lambda: [{"from": s_(x.get("from")) or rung, "to": s_(x.get("to")),
                                        "ok": bool(x.get("ok")), "reasons": x.get("reasons") or []}
                                       for rung, x in ((r, gate_for(reads, ev, r) or {}) for r in GATE_STAGES)], None)
    ask = None
    if cid:
        for r in CND.ask_rows(reads):
            if s_(r.get("candidateid")) == cid:
                ask = r
    journey = CND.journey_for(reads, cid) if cid else []
    if journey is not None:
        every = CND.journey_for(reads, "")
        team_lines = [x for x in every or [] if not s_(x.get("candidate_id"))]
        if team_lines:
            journey = sorted(journey + team_lines, key=lambda x: x["at"])

    def sim_of() -> dict[str, Any]:
        return {"actors": actors(reads), "attempts": attempts(reads), "asks": asks_out(reads),
                "cfg": {k: v for k, (v, _d) in cfg_rows(reads).items()}}
    sim = _soft(sim_of, None)
    a = (evidence or {}).get("analysis") or {}
    sc_ = (evidence or {}).get("screen") or {}
    return {"status": 200, "data": {
        "steps": steps_with_words(reads), "flows": flows_with_words(reads),
        "test_mode": {"on": con["on"], "sms": con["phone"], "email": con["email"], "mode": con["mode"] or "redirect",
                      "test_redirect_on": bool(con["test_mode_on"])},
        "sim": sim, "team": {"emails": team["emails"], "names": team["names"]},
        "interviewer": interviewer_pick(reads, ""), "interviewers": interviewers_by_badge(reads),
        "candidate": {"id": s_(card.get("candidateid")), "name": s_(card.get("candidatename")),
                      "phone": s_(card.get("phone")), "email": s_(card.get("email")), "status": s_(card.get("status")),
                      "stage": stage, "resume_link": s_(card.get("resumelink")), "cjis": s_(a.get("cjisstatus")),
                      "decision": s_(a.get("decisionstatus")), "screen_status": s_(sc_.get("screenstatus")),
                      "screen_result": s_(sc_.get("finalresult"))} if card else None,
        "gate": {"from": gate.get("from"), "to": gate.get("to"), "ok": bool(gate.get("ok")),
                 "reasons": gate.get("reasons") or []} if gate else None,
        "gates": gates,
        "ask": {"ask_id": s_(ask.get("askid")), "state": s_(ask.get("state")), "picked_date": s_(ask.get("pickeddate")),
                "picked_time": s_(ask.get("pickedtime")), "supervisor_reply": s_(ask.get("supervisorreply")),
                "confirmed_date": s_(ask.get("confirmeddate")), "confirmed_time": s_(ask.get("confirmedtime"))}
        if ask else None,
        "journey": journey, "journey_unreadable": journey is None,
        "link_secret": bool(gsjs.trim(reads.db.prop("INTERVIEW_LINK_SECRET")))}}


# ---- the teardown's Drive half ------------------------------------------------------------------------------------

def reset_refusal(reads: L.Reads, user: dict | None, cid: str) -> tuple[dict | None, dict | None]:
    """hiringSimReset's gates, the card read once: (its refusal, the card)."""
    if not writer(user):
        return dict(DENIED), None
    if not CAN_ID.match(cid):
        return {"status": 400, "message": "invalid candidate_id"}, None
    rows, why = CND.soft(lambda: CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB))
    if why:
        return {"status": 500, "message": "could not read the candidates tab"}, None
    card = None
    for c in rows or []:
        if s_(c.get("candidateid")) == cid:
            card = c
    if card is None:
        return {"status": 404, "message": f'No candidate "{cid}".'}, None
    if not s_(card.get("candidatename")).lower().startswith("[test]"):
        return {"status": 409, "message": f'That card is not a rehearsal: "{s_(card.get("candidatename"))}" does not '
                                          "begin with [TEST]. This door only removes rehearsals — a real candidate is "
                                          "archived with a reason (hiringDiscard), never deleted."}, None
    return None, card


def cjis_folder(reads: L.Reads) -> str:
    """cjisFolderId_."""
    for k in CJIS_FOLDER_PROPS:
        v = gsjs.trim(reads.db.prop(k))
        if v:
            return v
    return ""


def reset_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """simCjisCleanup_ before hiringSimReset records the teardown: every "(SIM)" file the rehearsal dropped in the
    designated docs folder put in Drive's bin, as the platform's account; the teardown never fails over a folder."""
    reads = sess.reads
    cid = s_((payload or {}).get("candidate_id"))
    refused, _card = reset_refusal(reads, sess.user, cid)
    if refused:
        return refused
    removed = 0
    folder = cjis_folder(reads)
    drv = reads.drive
    if folder and drv is not None and getattr(drv, "available", False):
        try:
            for f in drv.children(folder, False, "id,name"):
                if SIM_FILE_MARK not in s_(f.get("name")):
                    continue
                try:
                    drv.trash(s_(f.get("id")))
                    removed += 1
                except Exception:  # noqa: BLE001 - one file the bin refused leaves the rest to go
                    continue
        except Exception:  # noqa: BLE001 - the teardown never fails over a folder
            pass
    return {"status": 200, "data": RC.seal("hiringSimReset", RC.actor(sess.user), {"candidate_id": cid,
                                                                                    "sim_files_trashed": removed})}


# ---- the deciders' replies, read (hiringInterestScanRun_'s reading half) ---------------------------------------------

def shortlist_names(reads: L.Reads) -> list[dict[str, str]]:
    """simShortlistNames_: the names the last shortlists carried, off the journey's lines, once each."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for line in CND.journey_for(reads, "") or []:
        if line.get("step") != "shortlist" or not line.get("name"):
            continue
        k = line["name"].lower()
        if k not in seen:
            seen.add(k)
            out.append({"name": line["name"], "candidate_id": line["candidate_id"]})
    return out


def verdict_rule(body: Any) -> str:
    """simInterestVerdictRule_: a whole-message OK, the opt-out grammar."""
    s = re.sub(r"[!.\s]+$", "", gsjs.trim(gsjs.or_text(body)).lower())
    return "ok" if INTEREST_OK.fullmatch(s) else ""


def classify_ai(reads: L.Reads, text: str, names: list[str], deadline: float) -> dict[str, Any] | None:
    """simInterestClassifyAi_: one model look per message; the names it gives are the caller's to check."""
    tpl = _soft(lambda: CND.book_text(reads, "Prompts", INTEREST_PROMPT, ""), "")
    if not tpl:
        return None
    listed = "; ".join(names) if names else _soft(lambda: CND.book_text(reads, "Prompts", INTEREST_PROMPT_NONE, ""), "")
    ask = tpl.replace("{names}", listed).replace("{message}", gsjs.or_text(text)[:1500])
    res = _soft(lambda: CCS.ai_chat(reads, ask, 0.1, INTEREST_PROMPT, deadline), None)
    if not res or not res.get("ok"):
        return None
    try:
        parsed = json.loads(s_(res.get("content")))
    except ValueError:
        return None
    if not isinstance(parsed, dict):
        return None
    v = s_(parsed.get("verdict")).lower()
    if v not in INTEREST_VERDICTS:
        return None
    got = [gsjs.js_str(x) for x in parsed["names"]] if isinstance(parsed.get("names"), list) else []
    return {"verdict": v, "names": got, "via": s_(res.get("via")) or "ai"}


def listed_only(names: list[str], listed: list[str]) -> list[str]:
    """The anti-invention gate: only names on the shortlist survive."""
    return [n for n in names if any(x.lower() == n.lower() for x in listed)]


def judged(reads: L.Reads) -> dict[str, str]:
    """The verdict book (hiring_sim_ai): one verdict per message, ever."""
    rows = CW.dissolved_rows(reads, AI_TAB)
    return {s_(r.get("messageid")) or sub: s_(r.get("verdict")) for sub, r in rows.items()}


def interest_read(reads: L.Reads, deadline: float) -> dict[str, Any]:
    """hiringInterestScanRun_'s reading: the deciders' replies in the platform mailbox, each new one judged by the
    rule, else by the model (a message no model would read waits for the next pass)."""
    out: dict[str, Any] = {"read": 0, "verdicts": []}
    a = actors(reads)
    allowed = [e.lower() for e in a["decider_emails"] + a["team_emails"]]
    if not allowed:
        return out
    box = MB.creds("")
    if box is None:
        out["error"] = "mailbox: PLATFORM_EMAIL is not configured"
        return out
    try:
        threads = MB.inbox(box["user"], box["password"], SCAN_LIMIT, "INBOX")["threads"]
    except Exception as exc:  # noqa: BLE001 - the class, never the conversation
        out["error"] = f"mailbox: imap_failed ({type(exc).__name__})"
        return out
    seen = judged(reads)
    listed = [x["name"] for x in shortlist_names(reads)]
    for t in threads:
        frm = s_(t.get("from_addr")).lower()
        if not any(x and x in frm for x in allowed):
            continue
        out["read"] += 1
        mid = "sim:" + (s_(t.get("id")) or (s_(t.get("date")) + "|" + s_(t.get("subject"))))
        body = s_(t.get("snippet"))
        if mid in seen or not body:
            continue
        verdict, names, via = verdict_rule(body), [], "rule"
        if not verdict:
            ai = classify_ai(reads, body, listed, deadline)
            if not ai:
                continue
            verdict, via, names = ai["verdict"], ai["via"], listed_only(ai["names"], listed)
        seen[mid] = verdict
        out["verdicts"].append({"mid": mid, "verdict": verdict, "names": names, "via": via, "from": frm})
    return out


def interest_scan_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The deciders' replies read now (the simulator's step 2 button), before hiringInterestScan acts on them."""
    if not writer(sess.user):
        return dict(DENIED)
    scan = interest_read(sess.reads, time.monotonic() + MODEL_BUDGET_S)
    return {"status": 200, "data": RC.seal("hiringInterestScan", RC.actor(sess.user), {"scan": scan})}


def retry_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The retry pass's ears, read before hiringSimRetryNow (a button, or the relay's clock every fifteen minutes):
    the deciders' replies judged, so a reply already in the mailbox stops a retry that would go out this same pass."""
    if not writer(sess.user):
        return dict(DENIED)
    scan = interest_read(sess.reads, time.monotonic() + MODEL_BUDGET_S)
    opened = sum(1 for r in CND.sim_ask_rows(sess.reads) if s_(r.get("state")) == "open")
    return {"status": 200, "data": RC.seal("hiringSimRetryNow", RC.actor(sess.user), {"scan": scan, "open": opened})}


def pretend_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """A typed team reply read as the mailbox scan reads one ({names}/{top} written from the current shortlist):
    the rule, else the model, before hiringSimPretendReply acts on the verdict."""
    reads = sess.reads
    if not writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    channel = s_(p.get("channel")).lower()
    if channel != "team":
        return {"status": 200, "data": RC.seal("hiringSimPretendReply", RC.actor(sess.user), {"channel": channel})}
    text = s_(p.get("text"))
    if not text:
        return {"status": 400, "message": "Type the reply you are pretending — the machine reads the words."}
    listed = [x["name"] for x in shortlist_names(reads)]
    text = text.replace("{names}", ", ".join(listed)).replace("{top}", listed[0] if listed else "")
    verdict, names, via = verdict_rule(text), [], "rule:pretend"
    if not verdict:
        ai = classify_ai(reads, text, listed, time.monotonic() + MODEL_BUDGET_S)
        if not ai:
            return {"status": 502, "message": "No model would read the message — try again, or write a plain OK."}
        verdict, via, names = ai["verdict"], ai["via"] + ":pretend", listed_only(ai["names"], listed)
    return {"status": 200, "data": RC.seal("hiringSimPretendReply", RC.actor(sess.user), {
        "channel": channel, "verdict": verdict, "names": names, "via": via})}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "hiringSimConfigGet": config_get, "hiringSimState": sim_state, "hiringSimResetPrepare": reset_prepare,
    "hiringInterestScanPrepare": interest_scan_prepare, "hiringSimRetryDue": retry_due,
    "hiringSimPretendReplyPrepare": pretend_prepare}
POLICY: dict[str, dict[str, Any]] = {
    "hiringSimConfigGet": {"roles": ("admin", "manager")},
    "hiringSimState": {"roles": ("admin", "manager"), "params": {"candidate_id": "string"}},
    "hiringSimResetPrepare": {"roles": ("admin",), "params": {"candidate_id": "string"}},
    "hiringInterestScanPrepare": {"roles": ("admin", "manager")},
    "hiringSimRetryDue": {"roles": ("admin", "manager")},
    "hiringSimPretendReplyPrepare": {"roles": ("admin", "manager"),
                                     "params": {"channel": "string", "text": "string", "from": "string",
                                                "candidate_id": "string"}}}
