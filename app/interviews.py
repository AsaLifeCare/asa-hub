"""Interviews (Interview.gs) off asa-hub-db: the interviewer's desk — interviewMineList (the candidates at the
interview stage with their slot and scorecard), interviewGet (one scorecard and its access window) and
candidateProfileGet (the one board row every profile screen reads, with its Talent Pipeline row and its interview and
onboarding records). The scorecard itself (interviewSave) stays Apps Script's: it ends the run or moves the card into
Onboarding, which mints the new hire's login and e-mails them."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Callable

import candidates as CND
import gsjs
import locations as L
import scope as sc

APP_ID = "interviews"
# App Control's row the HM badge needs to count for hiring (hm_hires)
HIRING_APP = "staff-candidates"
SCORE_MIN, SCORE_MAX = 0, 10
WINDOW_BEFORE_DAYS, WINDOW_AFTER_DAYS = 1, 2
CAN_ID = re.compile(r"^CAN_[A-Za-z0-9]{6,}$")
TP_TABS = {"candidates": "tp_candidates", "resume": "tp_resume", "screens": "tp_screens"}
TP_AUTH_TAB = "tp_authorizations"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}

s_ = CND.s_


def strings(reads: L.Reads, key: str, var: dict | None = None) -> str:
    """bookText_('Strings', key) rendered as hiringRenderMail_ does."""
    return CND.render(CND.book_text(reads, "Strings", key, ""), var or {})


# ---- who signs a scorecard (interviewCanRecord_) -------------------------------------------------------------------

def scorecard_emails(reads: L.Reads) -> list[str]:
    """hiringAlerts_().interview_scorecard_emails."""
    got, why = CND.soft(lambda: reads.config().get("interview_scorecard_emails"))
    if why:
        return []
    return [x.strip().lower() for x in re.split(r"[,;\n]+", s_(got)) if "@" in x]


def _overrides(reads: L.Reads, user: dict) -> dict:
    """The account's permoverrides, as the session carries them (user.overrides)."""
    if isinstance(user.get("overrides"), dict):
        return user["overrides"]
    uid = s_(user.get("id"))
    row = next((u for u in reads.users() if s_(u.get("userid")) == uid), None) if uid else None
    try:
        got = json.loads(s_((row or {}).get("permoverrides")) or "{}")
    except ValueError:
        got = {}
    return got if isinstance(got, dict) else {}


def hm_hires(reads: L.Reads | None, user: dict) -> bool:
    """The HM badge counts for hiring only where App Control's Staff Candidates row opens to the account: the
    operator's sheet (2026-10-29) shuts candidates to House Managers. FAIL-CLOSED; the master passes first."""
    if reads is None:
        return False
    try:
        return sc.profile_app_gate(HIRING_APP, user, reads.scope_sources()).get("open") is True
    except sc.Defer:
        return False


def can_record(reads: L.Reads, user: dict | None) -> bool:
    """interviewCanRecord_: the interviewer role, the hiring.interview grant, the INTERVIEWER badge, the HM badge
    where Staff Candidates opens to it (hm_hires), or an address on the scorecard list — never hubIsWriter_, since the
    scorecard attests that a person sat with them."""
    if not user or user.get("is_service"):
        return False
    if s_(user.get("role")) == "interviewer":
        return True
    if _overrides(reads, user).get("hiring.interview") is True:
        return True
    types = user.get("types") or []
    if "INTERVIEWER" in types or ("HM" in types and hm_hires(reads, user)):
        return True
    email = s_(user.get("email")).lower()
    return bool(email) and email in scorecard_emails(reads)


def is_master(user: dict | None) -> bool:
    return bool(user) and sc.is_master_email((user or {}).get("email"))


def hiring_team(user: dict | None, reads: L.Reads | None = None) -> bool:
    """talentLiveAllowed_: the service, the hiring roles, or a badge that interviews (HM only where Staff Candidates
    opens to it: hm_hires, which needs the request's reads)."""
    if not user:
        return False
    if user.get("is_service"):
        return True
    if s_(user.get("role")) in ("admin", "director", "manager", "interviewer"):
        return True
    types = user.get("types") or []
    return "INTERVIEWER" in types or ("HM" in types and hm_hires(reads, user))


# ---- the access window (interviewWindow_) --------------------------------------------------------------------------

def _days(reads: L.Reads, key: str, fallback: int) -> int:
    """interviewWindowDays_: Settings, then the script property, then the floor."""
    cfg = CND.cfg_int(reads, key.lower(), None, 0, 365)
    if cfg is not None:
        return int(cfg)
    try:
        n = int(float(s_(reads.db.prop(key))))
    except ValueError:
        return fallback
    return fallback if n < 0 else n


def window(reads: L.Reads, iv: dict | None) -> dict[str, Any]:
    """interviewWindow_: the row's own edges, else the scheduled day widened by the window's days."""
    if not iv:
        return {"open": True, "from": "", "until": "", "reason": "no interview row yet"}
    frm = CND.js_date_ms(iv.get("accessfrom")) if s_(iv.get("accessfrom")) else None
    until = CND.js_date_ms(iv.get("accessuntil")) if s_(iv.get("accessuntil")) else None
    if (s_(iv.get("accessfrom")) and frm is None) or (s_(iv.get("accessuntil")) and until is None):
        frm = until = None
    if frm is None or until is None:
        sched = CND.js_date_ms(iv.get("scheduledfor")) if s_(iv.get("scheduledfor")) else None
        if sched is None:
            return {"open": True, "from": "", "until": "", "reason": "no scheduled date"}
        if frm is None:
            frm = CND._day_edge(reads, CND._shift_days(sched, -_days(reads, "INTERVIEW_WINDOW_BEFORE_DAYS",
                                                                        WINDOW_BEFORE_DAYS)), False)
        if until is None:
            until = CND._day_edge(reads, CND._shift_days(sched, _days(reads, "INTERVIEW_WINDOW_AFTER_DAYS",
                                                                       WINDOW_AFTER_DAYS)), True)
    now = CND.now_ms(reads)
    is_open = frm <= now <= until
    return {"open": is_open, "from": CND.iso_ms(frm), "until": CND.iso_ms(until),
            "reason": "" if is_open else ("not open yet" if now < frm else "window closed")}


# ---- the doors -----------------------------------------------------------------------------------------------------

def interview_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """interviewGet: one candidate's scorecard and window, and whether this session may sign or widen it."""
    reads, user = sess.reads, sess.user or {}
    role = s_(user.get("role"))
    if not user or user.get("is_service") or (role not in ("admin", "manager", "interviewer", "director")
                                              and not can_record(reads, user)):
        return DENIED
    cid = s_((payload or {}).get("candidate_id"))
    if not CAN_ID.match(cid):
        return {"status": 400, "message": strings(reads, "refuse.candidate_id")}
    ev = CND.evidence(reads, cid)
    if not ev.get("cand"):
        return {"status": 404, "message": strings(reads, "refuse.no_candidate", {"id": cid})}
    iv = CND.interview_for(reads, cid)
    win = window(reads, iv)
    limited = role == "interviewer"
    g = (lambda k: s_((iv or {}).get(k)))
    return {"status": 200, "data": {
        "exists": bool(iv), "candidate_name": s_(ev["cand"].get("candidatename")), "scheduled_for": g("scheduledfor"),
        "status": g("status"), "interviewer_name": g("interviewername"), "score": g("score"), "comments": g("comments"),
        "recommendation": g("recommendation"), "interviewed_at": g("interviewedat"), "window_open": win["open"],
        "window_from": win["from"], "window_until": win["until"], "window_reason": win["reason"],
        "window_applies": limited, "can_extend": role in ("admin", "manager"),
        "can_record": can_record(reads, user) and (not limited or win["open"])}}


def interview_mine_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """interviewMineList: the interview-stage candidates, each with its slot and its scorecard state."""
    reads, user = sess.reads, sess.user or {}
    if not can_record(reads, user) and not is_master(user):
        return DENIED
    try:
        rows = CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB)
    except Exception:  # noqa: BLE001 - the tab could not be read, said
        return {"status": 500, "message": strings(reads, "refuse.candidates_tab_unreadable")}
    asks: dict[str, dict] = {}
    got, _why = CND.soft(lambda: CND.read_tab(reads, CND.INTERVIEW_ASKS_TAB))
    for a in got or []:
        if s_(a.get("candidateid")):
            asks[s_(a.get("candidateid"))] = a
    out = []
    for c in rows:
        if s_(c.get("archived")).lower() == "true" or CND.stage_of(s_(c.get("status"))) != "interview":
            continue
        cid = s_(c.get("candidateid"))
        iv, _w = CND.soft(lambda cid=cid: CND.interview_for(reads, cid))
        ask = asks.get(cid)
        slot = ""
        if ask:
            slot = (s_(ask.get("confirmeddate")) + " " + s_(ask.get("confirmedtime"))) if s_(ask.get("confirmeddate")) \
                else ((s_(ask.get("pickeddate")) + " " + s_(ask.get("pickedtime"))) if s_(ask.get("pickeddate")) else "")
        out.append({"candidate_id": cid, "name": s_(c.get("candidatename")), "slot": slot,
                    "ask_state": s_(ask.get("state")) if ask else "", "scored": CND.interview_scored(iv),
                    "score": s_((iv or {}).get("score")), "interviewer_name": s_((iv or {}).get("interviewername"))})
    return {"status": 200, "data": {"rows": out, "can_record": can_record(reads, user)}}


# ---- the Talent Pipeline row (TalentPipeline.gs candidateTpRow_) -------------------------------------------------

def _soft_tab(reads: L.Reads, tab: str) -> list[dict]:
    """tpReadSoft_: a tab not migrated yet reads as empty."""
    got, why = CND.soft(lambda: CND.read_tab(reads, tab))
    return [] if why else (got or [])


def _yes(v: Any) -> bool:
    return bool(re.fullmatch(r"(yes|true|y|1)", s_(v), re.I))


def _float(v: Any) -> float | None:
    return CND.js_parse_float(v)


def tp_joined(reads: L.Reads) -> dict[str, Any]:
    """tpJoinedRows_: every live legacy candidate joined to their resume scores and latest screen, best first."""
    all_rows = _soft_tab(reads, TP_TABS["candidates"])
    if not all_rows:
        return {"rows": [], "migrated": False}
    cands = [c for c in all_rows if not _yes(c.get("archived")) and s_(c.get("status")).strip().lower() != "duplicate"]
    if not cands:
        return {"rows": [], "migrated": True}
    resume = {s_(r.get("candidateid")): r for r in _soft_tab(reads, TP_TABS["resume"]) if s_(r.get("candidateid"))}
    screens: dict[str, dict] = {}
    for r in _soft_tab(reads, TP_TABS["screens"]):
        i = s_(r.get("candidateid"))
        if not i:
            continue
        att = int(_float(r.get("attempt")) or 1) or 1
        if i not in screens or att >= (int(_float(screens[i].get("attempt")) or 1) or 1):
            screens[i] = r
    rows = []
    for c in cands:
        i = s_(c.get("candidateid"))
        rz, scr = resume.get(i, {}), screens.get(i, {})
        rows.append({
            "candidate_id": i, "name": s_(c.get("name")) or s_(rz.get("name")) or s_(scr.get("name")) or i,
            "phone": s_(c.get("phone")), "email": s_(c.get("email")), "city": s_(c.get("city")),
            "collected_at": s_(c.get("collectedat")), "status": s_(c.get("status")),
            "resume_link": s_(c.get("resumelink")), "composite_score": s_(rz.get("compositescore")),
            "skills": s_(rz.get("skillsrating")), "certs": s_(rz.get("certsrating")),
            "experience": s_(rz.get("experiencerating")), "job_history": s_(rz.get("jobhistoryrating")),
            "years": s_(rz.get("yearscaregiving")),
            "flags": [f for f in ("short tenure" if s_(rz.get("flagshorttenure")) == "Yes" else "",
                                  "no certs" if s_(rz.get("flagnocerts")) == "Yes" else "",
                                  "stale experience" if s_(rz.get("flagstale")) == "Yes" else "") if f],
            "decision": s_(rz.get("decision")), "summary": s_(rz.get("summary")), "cjis": s_(rz.get("cjisstatus")),
            "cjis_report": s_(rz.get("cjisreport")), "certifications": s_(rz.get("certifications")),
            "screen_result": s_(scr.get("finalresult")) or s_(scr.get("screenstatus")),
            "screen_qualification": s_(scr.get("qualification")), "screen_date": s_(scr.get("screendate")),
            "screened_by": s_(scr.get("screenedby")),
            "screen_checks_all": all(_yes(scr.get(k)) for k in ("certdodd", "certcpr", "certmeddel", "hasdl",
                                                                  "hasvehicle", "hasinsurance")),
            "avg_tenure": s_(rz.get("avgtenure")), "months_since_last": s_(rz.get("monthssincelast"))})

    def order(r: dict) -> tuple:
        sc_ = _float(r["composite_score"])
        return (0, -sc_, "") if sc_ is not None else (1, 0.0, r["name"])
    rows.sort(key=order)
    return {"rows": rows, "migrated": True}


def _nota(composite: Any) -> float | None:
    n = _float(composite)
    if n is None:
        return None
    return max(0.0, min(10.0, round((n / 12) * 100) / 10))


def _rank_score(r: dict) -> float | None:
    """tpRankScore_: nota + 0.5 qualification pass + 0.25 all six screen checks − 0.75 per red flag."""
    nota = _nota(r["composite_score"])
    if nota is None:
        return None
    s = nota + (0.5 if re.search(r"pass", r["screen_qualification"], re.I) else 0.0) + \
        (0.25 if r["screen_checks_all"] else 0.0) - 0.75 * len(r["flags"])
    return round(s * 100) / 100


def _eligible(r: dict) -> bool:
    """tpRankEligible_."""
    if CND.stage_of(r["status"]):
        return False
    d = r["decision"]
    if d != "Advance" and not (d == "Review" and not r["flags"]):
        return False
    return not re.search(r"fail", r["cjis"], re.I) and not re.search(r"reject", r["screen_result"], re.I)


def tp_rank(rows: list[dict]) -> list[dict]:
    """tpRank_: eligible, uncollected rows, best first; ties by years caregiving."""
    ranked = [r for r in rows if not r["collected_at"] and _eligible(r) and _rank_score(r) is not None]
    ranked.sort(key=lambda r: (-(_rank_score(r) or 0), -(_float(r["years"]) or 0)))
    return ranked


def tp_row(reads: L.Reads, cid: str, name: str, tp_id: str) -> dict | None:
    """candidateTpRow_: the legacy row this card is — by its stamp, its own id, the id it moved from, then its name;
    a scored row before an unscored one; with its rank."""
    joined = tp_joined(reads)
    if not joined["migrated"] or not joined["rows"]:
        return None
    moved = ""
    import talent_pipeline as TPL  # noqa: PLC0415 - the asks follow Postgres once Hiring keeps them there
    for a in TPL.auth_rows(reads):
        if s_(a.get("movedcandidateid")) == cid:
            moved = s_(a.get("candidateid"))
    want = s_(name).strip().lower()
    keyed: list[dict | None] = [None, None, None, None]

    def scored(r: dict | None) -> bool:
        return bool(r) and _float(r["composite_score"]) is not None
    for r in joined["rows"]:
        for idx, match in ((0, bool(tp_id) and r["candidate_id"] == tp_id), (1, r["candidate_id"] == cid),
                           (2, bool(moved) and r["candidate_id"] == moved),
                           (3, bool(want) and r["name"].strip().lower() == want)):
            if match and (keyed[idx] is None or (scored(r) and not keyed[idx]["composite_score"])):
                keyed[idx] = r
    hit = next((k for k in keyed if scored(k)), None) or next((k for k in keyed if k), None)
    if hit is None:
        return None
    hit = dict(hit)
    for m, r in enumerate(tp_rank(joined["rows"])):
        if r["candidate_id"] == hit["candidate_id"]:
            hit["rank"] = m + 1
            break
    return hit


# ---- one candidate (candidateProfileGet) ---------------------------------------------------------------------------

def candidate_profile_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """candidateProfileGet: the board row (an archived candidate's minimal card off the raw tab), its Talent Pipeline
    row, and its interview and onboarding records."""
    reads, user = sess.reads, sess.user or {}
    team = hiring_team(user, reads)
    if not can_record(reads, user) and not is_master(user) and not team:
        return DENIED
    cid = s_((payload or {}).get("candidate_id"))
    if not cid:
        return {"status": 400, "message": strings(reads, "refuse.candidate_id_required")}
    try:
        b = CND.board(reads)
    except Exception:  # noqa: BLE001 - the board could not be read, said
        return {"status": 500, "message": strings(reads, "refuse.candidates_board_unreadable")}
    ctx = {"key": cid, "memo": {}}
    raw_rows, why = CND.soft(lambda: CND.raw_rows(reads))
    cand = next((r for r in raw_rows or [] if s_(r.get("candidateid")) == cid), None) if not why else None
    row = b["byId"].get(cid)
    if row is None:
        if why:
            return {"status": 500, "message": strings(reads, "refuse.candidates_tab_unreadable")}
        if cand is None:
            return {"status": 404, "message": strings(reads, "refuse.no_candidate", {"id": cid})}
        name = s_(cand.get("candidatename")) or gsjs.trim(s_(cand.get("firstname")) + " " +
                                                         s_(cand.get("lastname"))) or cid
        row = {"id": cid, "name": name, "avatar": "", "role": "Direct Support Professional",
               "stage": CND.stage_of(s_(cand.get("status"))) or "", "status": s_(cand.get("status")),
               "archived": s_(cand.get("archived")).lower() == "true", "archived_at": s_(cand.get("archivedat")),
               "archived_reason": s_(cand.get("archivedreason")), "email": s_(cand.get("email")),
               "phone": s_(cand.get("phone")), "city": s_(cand.get("city")), "state": s_(cand.get("state")),
               "source": s_(cand.get("source")), "appliedAt": s_(cand.get("createdat")), "score": None,
               "resumeLink": s_(cand.get("resumelink")),
               "resumeFileLabel": "Open resume" if s_(cand.get("resumelink")) else "",
               "tpCandidateId": s_(cand.get("tpcandidateid")), "summaryTimeline": [], "checklist": []}
        name_for_tp, tp_id = name, s_(cand.get("tpcandidateid"))
    else:
        name_for_tp, tp_id = s_(row.get("name")), s_(row.get("tpCandidateId"))
    tp, _w = CND.soft(lambda: tp_row(reads, cid, name_for_tp, tp_id))
    x = CND.extras(reads, ctx, {"cand": cand})
    return {"status": 200, "data": {"row": row, "tp": tp, "interview": x["interview"], "onboarding": x["onboarding"]}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "interviewGet": interview_get, "interviewMineList": interview_mine_list,
    "candidateProfileGet": candidate_profile_get}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
