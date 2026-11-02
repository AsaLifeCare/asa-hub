"""Talent Pipeline (apps-script/TalentPipeline.gs) off asa-hub-db: the legacy recruiting store (tp_candidates, tp_resume
and tp_screens, dissolved into the depot's facts) joined and ranked (talentPipelineList), the crossing queue
(talentCrossingList), and the reads its writes are prepared by — the legacy workbook's new rows off its copy
(talentPipelineMigratePrepare; talentPipelineDue for the relay's clock and an admin's sync), and the leaders' replies
off the platform mailbox, judged by the model (talentAuthorizationDue). The asks (tp_authorizations) and the replies
already judged (tp_auth_ai) live in app.resource_rows."""
from __future__ import annotations

import functools
import hashlib
import hmac
import json
import logging
import math
import os
import re
import secrets
import time
from typing import Any, Callable

import candidates as CND
import client_care_sweeps as CCS
import gsjs
import hubdb
import locations as L
import mail_server as MB
import smart_comms_desk as SCD
import staff_views as SV
import support_desk_writes as SDW
import writes as W
from gsjs import NY
from scope import Defer

log = logging.getLogger("asa-hub-app")

APP_ID = "hiring"
TP_TABS = {"candidates": "tp_candidates", "resume": "tp_resume", "screens": "tp_screens"}
TP_HEADERS = {
    "tp_candidates": ("candidate_id", "name", "first_name", "phone", "email", "city", "state", "languages", "status",
                      "score", "resume_link", "created_at", "src", "migrated_at"),
    "tp_resume": ("candidate_id", "name", "months_since_last", "years_caregiving", "avg_tenure",
                  "highest_responsibility", "availability", "num_agencies", "consistency", "leadership_ratio",
                  "setting_balance", "care_experience", "certifications", "skills_rating", "certs_rating",
                  "experience_rating", "job_history_rating", "composite_score", "flag_short_tenure", "flag_no_certs",
                  "flag_stale", "decision", "summary", "cjis_status", "cjis_report", "analyzed_at", "src",
                  "migrated_at"),
    "tp_screens": ("candidate_id", "name", "attempt", "screen_date", "screen_status", "notes", "qualification",
                   "final_result", "best_day_time", "screened_by", "cert_dodd", "cert_cpr", "cert_meddel", "has_dl",
                   "has_vehicle", "has_insurance", "src", "migrated_at")}
# the asks and the replies judged: Hub tabs once, kept in app.resource_rows (sheet_resources.SPECS)
AUTH_TAB, AUTH_AI_TAB = "tp_authorizations", "tp_auth_ai"
AUTH_RESOURCE, AUTH_AI_RESOURCE = "tpAuthorizations", "tpAuthAi"
AUTH_HEADERS = ("ask_id", "candidate_id", "candidate_name", "rank", "nota", "requested_at", "requested_by",
                "recipients", "state", "reply_message_id", "reply_from", "reply_verdict", "reply_analyzed_at",
                "moved_candidate_id", "moved_at")
AUTH_AI_HEADER = ("message_id", "verdict", "approves", "denies", "via", "seen_at")
SOURCE_PROP = "TP_SOURCE_ID"
OPEN_REFUSED = ("The Talent Pipeline workbook could not be opened — make sure this Google account still has access "
                "to it.")
CANDIDATES, RESUME = CND.TALENT_CANDIDATES_TAB, CND.TALENT_RESUME_TAB
RECRUIT_TAB = CND.RECRUIT_TAB
EXCLUDE_IDS = CND.TALENT_EXCLUDE_IDS
WHY_ON_BOARD = "already a candidate on the hiring board"
CROSS_DECLINED = True
# the legacy columns a crossing carries onto the hiring analysis (TP_CARRY_MAP)
CARRY_MAP = {"months_since_last": "months_since_last_experience", "years_caregiving": "total_years_caregiving",
             "avg_tenure": "avg_tenure_per_job", "highest_responsibility": "highest_responsibility",
             "availability": "schedule_availability", "num_agencies": "num_dsp_agencies",
             "consistency": "consistency_in_field", "leadership_ratio": "leadership_ratio",
             "setting_balance": "setting_balance", "care_experience": "care_experience",
             "certifications": "listed_certifications", "skills_rating": "skills_rating",
             "certs_rating": "certs_rating", "experience_rating": "experience_rating",
             "job_history_rating": "job_history_rating", "composite_score": "composite_score",
             "flag_short_tenure": "red_flag_short_tenure", "flag_no_certs": "red_flag_no_certs",
             "flag_stale": "red_flag_stale_experience", "summary": "summary", "cjis_status": "cjis_status",
             "cjis_report": "cjis_report_url"}
MAILBOX_LIMIT = 50
AI_REPLY_ID = "ai_crossing_reply"
# the model's reading stops starting new replies past this, inside the relay's wait for a prepare
DUE_DEADLINE_S = 80.0
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
STALE = "What was read for this change is out of date or was not read here, so nothing was written. Try again."
PREPARED_MAX_S = 900
_SEAL_KEY = os.getenv("HUB_APP_TOKEN", "").encode() or os.urandom(32)

s_ = gsjs.str_


# ---- small values ------------------------------------------------------------------------------------------------

def manager(user: dict | None) -> bool:
    """tpManager_: an admin or a manager, never the service."""
    u = user or {}
    return bool(u) and not u.get("is_service") and s_(u.get("role")) in ("admin", "manager")


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return s_((user or {}).get("role")) in ("admin", "manager")


def actor(user: dict | None) -> str:
    u = user or {}
    return "service" if u.get("is_service") is True else s_(u.get("email"))


def hex_id(n: int) -> str:
    """randomHex_(n)."""
    return secrets.token_hex((n + 1) // 2)[:n]


def number(x: float) -> float | int:
    """A JS number as JSON writes it."""
    return int(x) if math.isfinite(x) and x == int(x) else x


def parse_float(v: Any) -> float | None:
    """parseFloat; None for NaN."""
    got = CND.js_parse_float(v)
    return None if got is None or math.isnan(got) else got


def parse_int(v: Any) -> int | None:
    """parseInt(v, 10); None for NaN."""
    got = CND.js_parse_int(v)
    return None if math.isnan(got) else int(got)


def secret(reads: L.Reads, key: str) -> str:
    """hubProp_ for a secret, as this service holds it: its own setting (HUB_APP_PROP_<key>, or the bare name), never
    the copy's withheld marker."""
    v = gsjs.trim(gsjs.or_blank(reads.db.prop(key)))
    if not v or v.startswith("[withheld"):
        v = os.getenv(key, "").strip()
    return v


def words(reads: L.Reads, key: str, floor: str, var: dict | None = None) -> str:
    """bookText_('Strings', key) rendered; the floor where the copy withholds the line or lacks it."""
    try:
        got = CND.book_text(reads, "Strings", key, "")
    except (Defer, hubdb.Unreadable):
        got = ""
    if not got or got.startswith("[withheld"):
        got = floor
    return CND.render(got, var or {})


def syslog(who: Any, action: str, detail: str, status: int = 200) -> None:
    """hubSysLog_: a person's act in the platform's log, a machine's in the service's."""
    user = who if isinstance(who, dict) else None
    if user is None:
        email = s_(who)
        user = {"email": email} if "@" in email and not email.startswith("asa-hub") else None
    if user and not user.get("is_service") and s_(user.get("email")):
        SV.record(user, action, detail, status)
    else:
        log.info("%s: %s", action, detail[:400])


# ---- what a read prepares for its write, sealed -------------------------------------------------------------------

def _canon(v: Any) -> Any:
    if isinstance(v, float):
        return int(v) if math.isfinite(v) and v == int(v) and abs(v) < 1e15 else v
    if isinstance(v, dict):
        return {str(k): _canon(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_canon(x) for x in v]
    return v


def _mac(data: dict) -> str:
    text = json.dumps(_canon({k: v for k, v in data.items() if k != "seal"}), sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True)
    return hmac.new(_SEAL_KEY, text.encode(), hashlib.sha256).hexdigest()


def seal(door: str, by: str, data: dict) -> dict[str, Any]:
    """The prepared answer, named for the read that made it and its person, sealed by this service."""
    out = {**data, "door": door, "by": by, "at": int(time.time())}
    out["seal"] = _mac(out)
    return out


def unsealed(door: str, by: str, got: Any) -> dict[str, Any] | None:
    """The prepared answer a write was handed, when this service made it for this person just now."""
    if not isinstance(got, dict) or not isinstance(got.get("seal"), str):
        return None
    if not hmac.compare_digest(got["seal"], _mac(got)):
        return None
    if got.get("door") != door or got.get("by") != by:
        return None
    at = got.get("at")
    if not isinstance(at, (int, float)) or abs(time.time() - at) > PREPARED_MAX_S:
        return None
    return got


# ---- the rows ------------------------------------------------------------------------------------------------------

def soft_rows(reads: L.Reads, tab: str) -> list[dict]:
    """tpReadSoft_: a tab not migrated yet reads as empty."""
    got, why = CND.soft(lambda: CND.read_tab(reads, tab))
    return [] if why else (got or [])


def _kept_rows(reads: L.Reads, tab: str) -> list[dict]:
    got, why = CND.soft(lambda: reads.hub_rows(tab))
    return [] if why else [{hubdb.norm_key(k): s_(v) for k, v in r.items()} for r in got or []]


def auth_rows(reads: L.Reads) -> list[dict]:
    """tpReadSoft_(tp_authorizations), its keys normalised."""
    return _kept_rows(reads, AUTH_TAB)


def ai_rows(reads: L.Reads) -> list[dict]:
    """tpReadSoft_(tp_auth_ai)."""
    return _kept_rows(reads, AUTH_AI_TAB)


def asks_shown(reads: L.Reads) -> list[dict[str, str]]:
    """The asks as talentPipelineList hands them."""
    return [{"ask_id": s_(a.get("askid")), "candidate_id": s_(a.get("candidateid")),
             "candidate_name": s_(a.get("candidatename")), "rank": s_(a.get("rank")), "nota": s_(a.get("nota")),
             "requested_at": s_(a.get("requestedat")), "requested_by": s_(a.get("requestedby")),
             "state": s_(a.get("state")), "reply_from": s_(a.get("replyfrom")),
             "reply_verdict": s_(a.get("replyverdict")), "reply_analyzed_at": s_(a.get("replyanalyzedat")),
             "moved_candidate_id": s_(a.get("movedcandidateid")), "moved_at": s_(a.get("movedat"))}
            for a in auth_rows(reads)]


def is_duplicate(c: dict | None) -> bool:
    """tpIsDuplicate_."""
    return s_((c or {}).get("status")).lower() == "duplicate"


def _yes(v: Any) -> bool:
    return bool(re.fullmatch(r"(yes|true|y|1)", s_(v), re.I))


def joined(reads: L.Reads) -> dict[str, Any]:
    """tpJoinedRows_: every live legacy candidate joined to their scores and latest screen, best first; archived rows
    and the legacy's duplicates leave every reader (the duplicates counted)."""
    def read() -> dict[str, Any]:
        everyone = soft_rows(reads, TP_TABS["candidates"])
        if not everyone:
            return {"rows": [], "migrated": False, "duplicates": 0, "resume": {}}
        duplicates = 0
        cands = []
        for c in everyone:
            if re.fullmatch(r"(true|yes|1)", s_(c.get("archived")), re.I):
                continue
            if not is_duplicate(c):
                cands.append(c)
                continue
            duplicates += 1
        if not cands:
            return {"rows": [], "migrated": True, "duplicates": duplicates, "resume": {}}
        resume = {s_(r.get("candidateid")): r for r in soft_rows(reads, TP_TABS["resume"]) if s_(r.get("candidateid"))}
        screens: dict[str, dict] = {}
        for r in soft_rows(reads, TP_TABS["screens"]):
            i = s_(r.get("candidateid"))
            if not i:
                continue
            att = parse_int(r.get("attempt")) or 1
            if i not in screens or att >= (parse_int(screens[i].get("attempt")) or 1):
                screens[i] = r
        rows = []
        for c in cands:
            i = s_(c.get("candidateid"))
            rz, sc = resume.get(i, {}), screens.get(i, {})
            rows.append({
                "candidate_id": i, "name": s_(c.get("name")) or s_(rz.get("name")) or s_(sc.get("name")) or i,
                "phone": s_(c.get("phone")), "email": s_(c.get("email")), "city": s_(c.get("city")),
                "collected_at": s_(c.get("collectedat")), "status": s_(c.get("status")),
                "resume_link": s_(c.get("resumelink")), "composite_score": s_(rz.get("compositescore")),
                "skills": s_(rz.get("skillsrating")), "certs": s_(rz.get("certsrating")),
                "experience": s_(rz.get("experiencerating")), "job_history": s_(rz.get("jobhistoryrating")),
                "years": s_(rz.get("yearscaregiving")),
                "flags": [f for f in ("short tenure" if s_(rz.get("flagshorttenure")) == "Yes" else "",
                                      "no certs" if s_(rz.get("flagnocerts")) == "Yes" else "",
                                      "stale experience" if s_(rz.get("flagstale")) == "Yes" else "") if f],
                "decision": s_(rz.get("decision")), "summary": s_(rz.get("summary")),
                "cjis": s_(rz.get("cjisstatus")), "cjis_report": s_(rz.get("cjisreport")),
                "certifications": s_(rz.get("certifications")),
                "screen_result": s_(sc.get("finalresult")) or s_(sc.get("screenstatus")),
                "screen_qualification": s_(sc.get("qualification")), "screen_date": s_(sc.get("screendate")),
                "screened_by": s_(sc.get("screenedby")),
                "screen_checks_all": all(_yes(sc.get(k)) for k in ("certdodd", "certcpr", "certmeddel", "hasdl",
                                                                     "hasvehicle", "hasinsurance")),
                "avg_tenure": s_(rz.get("avgtenure")), "months_since_last": s_(rz.get("monthssincelast"))})

        def order(a: dict, b: dict) -> int:
            sa, sb = parse_float(a["composite_score"]), parse_float(b["composite_score"])
            if sa is not None and sb is not None:
                return (sb > sa) - (sb < sa)
            if sb is not None:
                return 1
            if sa is not None:
                return -1
            return gsjs.locale_cmp(a["name"], b["name"])
        rows.sort(key=functools.cmp_to_key(order))
        return {"rows": rows, "migrated": True, "duplicates": duplicates, "resume": resume}
    return reads.once("tp_joined", read)


# ---- the ranking (pure) ------------------------------------------------------------------------------------------

def nota(composite: Any) -> float | int | None:
    """tpNota_: the legacy composite is /12, the nota the same number on 0-10."""
    n = parse_float(composite)
    if n is None:
        return None
    return number(max(0.0, min(10.0, gsjs.js_round((n / 12) * 100) / 10)))


def eligible(r: dict) -> bool:
    """tpRankEligible_: nobody already in the process; Advance (or Review with no red flag), the check not failed, the
    screen not rejected."""
    if CND.stage_of(r["status"]):
        return False
    d = r["decision"]
    if d != "Advance" and not (d == "Review" and not r["flags"]):
        return False
    if re.search(r"fail", r["cjis"], re.I):
        return False
    return not re.search(r"reject", r["screen_result"], re.I)


def rank_score(r: dict) -> float | int | None:
    """tpRankScore_: nota + 0.5 for a qualification pass + 0.25 for all six screen checks − 0.75 per red flag."""
    n = nota(r["composite_score"])
    if n is None:
        return None
    s = float(n)
    if re.search(r"pass", r["screen_qualification"], re.I):
        s += 0.5
    if r["screen_checks_all"] is True:
        s += 0.25
    s -= 0.75 * len(r["flags"])
    return number(gsjs.js_round(s * 100) / 100)


def rank(rows: list[dict]) -> list[dict]:
    """tpRank_: the eligible rows not collected yet, best first; ties by years caregiving."""
    ranked = [r for r in rows if not r["collected_at"] and eligible(r) and rank_score(r) is not None]
    ranked.sort(key=lambda r: (-(rank_score(r) or 0), -(parse_float(r["years"]) or 0)))
    return ranked


def cjis_verdict(v: Any) -> str:
    """tpCjisVerdict_: what the legacy's CJIS column says — never a guess."""
    s = s_(v)
    if not s or re.match(r"^\d{4}-\d{2}-\d{2}T", s):
        return "unreadable"
    low = s.lower()
    if low in ("done", "none") or low.startswith("error"):
        return "unreadable"
    if re.search(r"review", s, re.I):
        return "review"
    if low.startswith("disqualified"):
        return "disqualified"
    if low.startswith("clear") or low.startswith("verified"):
        return "clear"
    return "unreadable"


# ---- who is staff, who is on the board (the contact guard's index) ----------------------------------------------

def staff_index(reads: L.Reads) -> dict | None:
    """tpStaffIndex_: the roster index, or None when it cannot be read — never "nobody is staff"."""
    try:
        idx = SDW.contact_index(reads)
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - as the .gs: an unread roster is no index
        return None
    return idx if idx.get("ok") else None


def staff_hit(idx: dict | None, phone: Any, email: Any) -> dict | None:
    """tpStaffHit_: an active staff record holding this phone or e-mail."""
    if not idx:
        return None

    def live(found: list | None) -> dict | None:
        return next((p for p in found or [] if p and p.get("active")), None)
    pk = W.phone_key(phone)
    if pk:
        hit = live(idx["phones"].get(pk))
        if hit:
            return hit
    for k in SDW.email_keys(email):
        hit = live(idx["emails"].get(k))
        if hit:
            return hit
    return None


def enforces(reads: L.Reads, lane: str) -> bool:
    """cgEnforces_: shadow unless the config says enforce."""
    key = "staff_guard_mode_public" if lane == "public" else "staff_guard_mode"
    return (gsjs.trim(gsjs.or_blank(SDW.guard_config(reads).get(key))).lower() or "shadow") == "enforce"


def contact_guard(reads: L.Reads, phone: Any, email: Any, self_cid: str = "", name: str = "",
                  trusted: bool = False) -> dict[str, Any] | None:
    """contactGuard_: a staff phone or e-mail may not enter the funnel (a [test] name a signed-in caller types is a
    rehearsal; the card's own records never count against it)."""
    if trusted and s_(name).lower().startswith("[test]"):
        return None
    idx = SDW.contact_index(reads)
    if not idx["ok"]:
        return {"severity": "unverified", "hits": []}
    pk = W.phone_key(phone)
    if pk and (pk in SDW.SHARED_LINE_DIGITS or pk in SDW.test_phones(reads)):
        pk = ""
    shared = SDW.shared_emails(reads)
    eks = [k for k in SDW.email_keys(email) if not SDW.test_email(reads, k) and k not in shared]

    def keep(found: list | None) -> list[dict]:
        return [p for p in found or [] if not (self_cid and p.get("cid") == self_cid)]
    hits: list[dict] = []
    if pk and keep(idx["phones"].get(pk)):
        hits.append({"via": "phone", "people": keep(idx["phones"].get(pk))})
    seen: set[str] = set()
    mail = None
    for k in eks:
        for p in keep(idx["emails"].get(k)):
            sig = s_(p.get("src")) + "|" + s_(p.get("name"))
            if sig in seen:
                continue
            seen.add(sig)
            if mail is None:
                mail = {"via": "email", "people": []}
                hits.append(mail)
            mail["people"].append(p)
    if not hits:
        return None
    blocking = any(p.get("active") for h in hits for p in h["people"])
    return {"severity": "block" if blocking else "warn", "hits": hits}


def guard_message(g: dict | None) -> str:
    """contactGuardMessage_: never asserts who somebody is."""
    if not g:
        return ""
    if g["severity"] == "unverified":
        return "Could not verify the staff roster right now — please try again."
    parts = []
    for h in g["hits"]:
        names = list(dict.fromkeys(s_(p.get("name")) for p in h["people"]))
        who = ", ".join(names[:3]) + (" and others" if len(names) > 3 else "")
        parts.append(("That phone number" if h["via"] == "phone" else "That e-mail address") +
                     " is already on the staff roster (" + who + ")")
    return "; ".join(parts) + ". An admin or manager can override with a reason."


def name_key(v: Any) -> str:
    return re.sub(r"[^a-z]", "", s_(v).lower())


def digits10(v: Any) -> str:
    d = re.sub(r"\D", "", s_(v))
    return d[-10:] if len(d) > 10 else d


def on_board_index(reads: L.Reads) -> dict[str, dict[str, str]]:
    """tpOnBoardIndex_: who is on the hiring board, by name and by the last ten digits."""
    def read() -> dict[str, dict[str, str]]:
        by_name: dict[str, str] = {}
        by_phone: dict[str, str] = {}
        for c in soft_rows(reads, CANDIDATES):
            n = s_(c.get("candidatename")) or gsjs.trim(s_(c.get("firstname")) + " " + s_(c.get("lastname")))
            k = name_key(n)
            if k:
                by_name[k] = s_(c.get("candidateid"))
            d = digits10(c.get("phone"))
            if len(d) == 10:
                by_phone[d] = s_(c.get("candidateid"))
        return {"by_name": by_name, "by_phone": by_phone}
    return reads.once("tp_on_board", read)


def already_here(idx: dict, cand: dict) -> str:
    """tpAlreadyHere_."""
    k = name_key(cand.get("name"))
    if k and idx["by_name"].get(k):
        return idx["by_name"][k]
    d = digits10(cand.get("phone"))
    if len(d) == 10 and idx["by_phone"].get(d):
        return idx["by_phone"][d]
    return ""


def crossable(cand: dict, rz: dict, staff: dict | None) -> dict[str, Any]:
    """tpCrossable_: may this legacy row come into the hiring process, and where does it land."""
    status = s_(cand.get("status"))
    if is_duplicate(cand):
        return {"ok": False, "why": "the legacy marked this row a duplicate of somebody else"}
    if not s_(cand.get("name")):
        return {"ok": False, "why": "the row carries no name"}
    if not s_(cand.get("phone")) and not s_(cand.get("email")):
        return {"ok": False, "why": "neither a phone nor an e-mail on the record"}
    if not CROSS_DECLINED and re.fullmatch(r"not hiring", status, re.I):
        return {"ok": False, "why": "the legacy declined them (Not Hiring)"}
    hit = staff_hit(staff, cand.get("phone"), cand.get("email"))
    if hit:
        return {"ok": True, "landing": "ready", "staff_name": s_(hit.get("name")),
                "why": "already on the staff roster as " + s_(hit.get("name")) +
                       " — they land at Ready to start and finish by themselves"}
    if re.fullmatch(r"hired", status, re.I):
        return {"ok": True, "landing": "ready",
                "why": "the legacy already hired them — they land at Ready to start and finish by themselves"}
    cjis = s_((rz or {}).get("cjisstatus"))
    verdict = cjis_verdict(cjis)
    if verdict == "review":
        return {"ok": False, "verdict": verdict, "why": "the background check came back for review — " + cjis}
    if verdict == "disqualified":
        return {"ok": False, "verdict": verdict, "why": "the background check says Disqualified"}
    if verdict == "unreadable":
        return {"ok": True, "verdict": verdict,
                "why": ('no readable verdict in the CJIS column ("' + cjis[:40] + '") — they come in with the check '
                        "still owed") if cjis else
                       "no background check on the legacy record — they come in with it still owed"}
    return {"ok": True, "verdict": verdict, "why": ""}


# ---- the crossing queue ------------------------------------------------------------------------------------------

def envelopes(reads: L.Reads) -> list[dict]:
    """packetMirrorRows_: the application envelopes; none when they cannot be read."""
    return soft_rows(reads, RECRUIT_TAB)


def applications_waiting(reads: L.Reads, board: dict, tp_rows: list[dict], staff: dict | None) -> list[dict]:
    """tpApplicationsWaiting_: a signed application nobody picked up — in no book here, reachable."""
    out: list[dict] = []
    tp_mail: set[str] = set()
    tp_phone: set[str] = set()
    for c in tp_rows or []:
        e = s_(c.get("email")).lower()
        if e:
            tp_mail.add(e)
        d = digits10(c.get("phone"))
        if len(d) == 10:
            tp_phone.add(d)
    for r in envelopes(reads):
        if s_(r.get("status")).lower() != "signed":
            continue
        name = s_(r.get("candidate"))
        if not name:
            continue
        email = s_(r.get("email")).lower()
        d = digits10(r.get("phone"))
        if not email and len(d) != 10:
            continue
        if already_here(board, {"name": name, "phone": r.get("phone")}):
            continue
        if (email and email in tp_mail) or (len(d) == 10 and d in tp_phone):
            continue
        hit = staff_hit(staff, r.get("phone"), email)
        out.append({"srid": s_(r.get("signaturerequestid")), "tp_candidate_id": "", "source": "application",
                    "name": name, "phone": s_(r.get("phone")), "email": email, "legacy_status": "",
                    "applied_at": s_(r.get("applied")), "signed_at": s_(r.get("signed")), "cjis": "", "nota": "",
                    "decision": "", "resume_link": "", "landing": "ready" if hit else "new",
                    "landing_why": ("already on the staff roster as " + s_(hit.get("name")) +
                                    " — they land at Ready to start and finish by themselves") if hit else
                                   "they signed the application form on " +
                                   (s_(r.get("signed")) or "a day the envelope does not carry")})
    return out


def applications_unfinished(reads: L.Reads) -> list[dict]:
    """tpApplicationsUnfinished_: the forms that never came back signed, pending before declined, oldest first."""
    out = []
    for r in envelopes(reads):
        status = s_(r.get("status")).lower()
        if status == "signed" or not s_(r.get("candidate")):
            continue
        out.append({"srid": s_(r.get("signaturerequestid")), "name": s_(r.get("candidate")),
                    "email": s_(r.get("email")).lower(), "phone": s_(r.get("phone")),
                    "location": s_(r.get("location")), "status": "declined" if status == "declined" else "pending",
                    "applied": s_(r.get("applied"))})

    def order(a: dict, b: dict) -> int:
        if (a["status"] == "pending") != (b["status"] == "pending"):
            return -1 if a["status"] == "pending" else 1
        return gsjs.locale_cmp(a["applied"], b["applied"])
    out.sort(key=functools.cmp_to_key(order))
    return out


def crossing(reads: L.Reads) -> dict[str, Any]:
    """tpCrossingCompute_: who may come into the hiring process — the legacy roster's rows and the signed applications
    nobody picked up — and why every other row may not."""
    def read() -> dict[str, Any]:
        cands = soft_rows(reads, TP_TABS["candidates"])
        if not cands:
            return {"migrated": False, "ready": [], "held": {}, "byId": {}}
        resume = {s_(r.get("candidateid")): r for r in soft_rows(reads, TP_TABS["resume"]) if s_(r.get("candidateid"))}
        board = on_board_index(reads)
        staff = staff_index(reads)
        ready: list[dict] = []
        held: dict[str, int] = {}
        by_id: dict[str, str] = {}
        duplicates = here = 0
        for c in cands:
            cid = s_(c.get("candidateid"))
            if is_duplicate(c):
                duplicates += 1
                by_id[cid] = "the legacy marked this row a duplicate"
                continue
            if already_here(board, c):
                here += 1
                by_id[cid] = WHY_ON_BOARD
                continue
            rz = resume.get(cid, {})
            can = crossable(c, rz, staff)
            if can["ok"]:
                by_id[cid] = ""
                ready.append({"tp_candidate_id": cid, "name": s_(c.get("name")), "phone": s_(c.get("phone")),
                              "email": s_(c.get("email")), "legacy_status": s_(c.get("status")),
                              "cjis": s_(rz.get("cjisstatus")), "cjis_report": s_(rz.get("cjisreport")),
                              "nota": s_(rz.get("compositescore")), "decision": s_(rz.get("decision")),
                              "resume_link": s_(c.get("resumelink")), "landing": s_(can.get("landing")) or "new",
                              "landing_why": s_(can.get("why"))})
                continue
            by_id[cid] = s_(can.get("why"))
            bucket = can.get("verdict") or "declined"
            held[bucket] = held.get(bucket, 0) + 1
        forms, _why = CND.soft(lambda: applications_waiting(reads, board, cands, staff))
        forms = forms or []
        ready += forms

        def order(a: dict, b: dict) -> int:
            na, nb = parse_float(a["nota"]) or 0, parse_float(b["nota"]) or 0
            if nb != na:
                return (nb > na) - (nb < na)
            sa, sb = s_(a.get("signed_at")), s_(b.get("signed_at"))
            if sa != sb:
                return gsjs.locale_cmp(sb, sa)
            return gsjs.locale_cmp(a["name"], b["name"])
        ready.sort(key=functools.cmp_to_key(order))
        unfinished, _why = CND.soft(lambda: applications_unfinished(reads))
        return {"migrated": True, "ready": ready, "held": held, "byId": by_id, "unfinished": unfinished or [],
                "from_applications": len(forms), "duplicates_hidden": duplicates, "already_here": here,
                "total": len(cands)}
    return reads.once("tp_crossing", read)


# ---- the reads -----------------------------------------------------------------------------------------------------

def pipeline_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """talentPipelineList: the scoreboard — every legacy candidate with their scores, the canonical rank folded on,
    with `crossing` why each one may or may not come in, and the authorization asks."""
    reads = sess.reads
    if not manager(sess.user):
        return DENIED
    p = payload if isinstance(payload, dict) else {}
    j = joined(reads)
    if not j["migrated"]:
        return {"status": 200, "data": {"rows": [], "migrated": False, "authorizations": []}}
    pos = {r["candidate_id"]: i + 1 for i, r in enumerate(rank(j["rows"]))}
    want = not gsjs.falsy(p.get("crossing"))
    by_id = crossing(reads)["byId"] if want else {}
    rows = []
    for r0 in j["rows"]:
        r = dict(r0)
        r["rank"] = pos.get(r["candidate_id"])
        r["rank_score"] = rank_score(r) if r["rank"] else None
        if want:
            why = by_id.get(r["candidate_id"])
            r["cross_ok"] = why == ""
            r["cross_why"] = "" if why is None else s_(why)
            r["on_board"] = why == WHY_ON_BOARD
            stage = CND.stage_of(r["status"])
            r["in_process"] = bool(stage)
            r["in_process_stage"] = s_(stage)
        rows.append(r)
    return {"status": 200, "data": {"rows": rows, "migrated": True, "authorizations": asks_shown(reads),
                                    "duplicates_hidden": j["duplicates"]}}


def crossing_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """talentCrossingList: the queue into the hiring process, and what it held back."""
    if not manager(sess.user):
        return DENIED
    out = crossing(sess.reads)
    data = {"migrated": out["migrated"], "ready": out["ready"], "held": out["held"]}
    data.update({k: out[k] for k in ("duplicates_hidden", "already_here", "total") if k in out})
    return {"status": 200, "data": data}


# ---- the legacy workbook's new rows (tpMigrateRun_'s reading) ----------------------------------------------------

def _cell(v: Any) -> str:
    """tpVal_: a Date as its New York day, anything else as trimmed text."""
    if isinstance(v, gsjs.SheetDate):
        return v.at.astimezone(NY).strftime("%Y-%m-%d")
    return gsjs.trim(gsjs.or_blank(v))


def _val(row: list, cols: dict[str, int], name: str) -> str:
    i = cols.get(name)
    return "" if i is None or i >= len(row) else _cell(row[i])


def _candidate(row: list, c: dict, key: str, now: str) -> list[str]:
    name = _val(row, c, "CandidateName") or gsjs.trim(_val(row, c, "FirstName") + " (" + key + ")")
    return [key, name, _val(row, c, "FirstName"), _val(row, c, "Phone"), _val(row, c, "Email"), _val(row, c, "City"),
            _val(row, c, "State"), _val(row, c, "Languages"), _val(row, c, "Status"), _val(row, c, "Score"),
            _val(row, c, "ResumeLink"), _val(row, c, "CreatedAt"), key, now]


def _resume(row: list, c: dict, key: str, now: str) -> list[str]:
    return [key] + [_val(row, c, n) for n in (
        "CandidateName", "MonthsSinceLastExperience", "TotalYearsCaregiving", "AvgTenurePerJob",
        "HighestResponsibility", "ScheduleAvailability", "NumDSPAgencies", "ConsistencyInField", "LeadershipRatio",
        "SettingBalance", "CareExperience", "ListedCertifications", "SkillsRating", "CertsRating", "ExperienceRating",
        "JobHistoryRating", "CompositeScore", "RedFlagShortTenure", "RedFlagNoCerts", "RedFlagStaleExperience",
        "DecisionStatus", "Summary", "CJISStatus", "CJISReportUrl", "AnalyzedAt")] + [key, now]


def _screen(row: list, c: dict, key: str, now: str) -> list[str]:
    return [_val(row, c, n) for n in (
        "CandidateId", "CandidateName", "AttemptNum", "ScreenDate", "ScreenStatus", "Notes", "Qualification",
        "FinalResult", "BestInPersonDayTime", "ScreenedBy", "CertDODD", "CertCPRFirstAid", "CertMedDel", "HasDL",
        "HasVehicle", "HasInsurance")] + [key, now]


def _screen_key(row: list, c: dict) -> str:
    cid = _val(row, c, "CandidateId")
    return cid + ":" + (_val(row, c, "AttemptNum") or "1") if cid else ""


COPIES: tuple[tuple[str, str, Callable[[list, dict], str], Callable[[list, dict, str, str], list[str]]], ...] = (
    ("Candidates", "tp_candidates", lambda row, c: _val(row, c, "CandidateId"), _candidate),
    ("ResumeAnalysis", "tp_resume", lambda row, c: _val(row, c, "CandidateId"), _resume),
    ("PhoneScreen", "tp_screens", _screen_key, _screen))


def have_keys(reads: L.Reads, dest: str) -> set[str]:
    """The legacy rows a tab already holds, by the key each was copied under."""
    return {s_(r.get("src")) for r in soft_rows(reads, dest) if s_(r.get("src"))}


def migration(reads: L.Reads) -> dict[str, Any]:
    """tpMigrateRun_'s reading: every legacy row of the three tabs no tp_* tab holds yet, as its write lands it."""
    src = gsjs.trim(reads.db.prop(SOURCE_PROP))
    if not src or reads.db.book(src) is None:
        return {"status": 403, "message": OPEN_REFUSED}
    now = W.now_iso(reads)
    out: dict[str, list] = {}
    for tab, dest, key_of, map_row in COPIES:
        got = CND._book_rows(reads, src, tab)
        if got is None or not got[1]:
            out[dest] = []
            continue
        heads, grid = got
        cols = {h: i for i, h in enumerate(heads)}
        have = have_keys(reads, dest)
        rows = []
        for line in grid:
            key = key_of(line, cols)
            if not key or key in have:
                continue
            rows.append([key, dict(zip(TP_HEADERS[dest], map_row(line, cols, key, now)))])
            have.add(key)
        out[dest] = rows
    return {"status": 200, "data": {"rows": out}}


# ---- the leaders' replies (tpAuthSweepRun_'s reading) --------------------------------------------------------------

def recipients(reads: L.Reads) -> dict[str, list[str]]:
    """hubAlertRecipients_."""
    return SCD.alert_recipients(reads, reads.config())


def read_reply(reads: L.Reads, t: dict, names: list[str], deadline: float) -> dict[str, Any] | None:
    """tpAuthReadReply_: one model read per message — whom it says to proceed with and whom not, from the open asks'
    names alone; None when no provider answered."""
    text = ("FROM: " + s_(t.get("from_addr")) + "\nSUBJECT: " + s_(t.get("subject")) + "\n" +
            s_(t.get("snippet")))[:1500]
    ask = ("A company leader is replying to a hiring-authorization request. The ONLY candidates "
           "with an open ask are: " + "; ".join(names) + ".\n\nMESSAGE:\n" + text + "\n\n"
           "Which of those candidates does the message say to PROCEED with, and which does it say "
           "NOT to proceed with? Use only names from the list, spelled exactly as listed. "
           "If the message decides nothing, both arrays are empty.\n"
           'Reply with JSON only: {"approves":["<name>"],"denies":["<name>"]}')
    try:
        res = CCS.ai_chat(reads, ask, 0.1, AI_REPLY_ID, deadline)
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - no verdict: the next sweep asks again
        return None
    if not res or not res.get("ok"):
        return None
    try:
        parsed = json.loads(s_(res.get("content")))
    except ValueError:
        return None
    if not isinstance(parsed, dict):
        return None

    def arr(v: Any) -> list[str]:
        return [gsjs.or_blank(x) for x in v] if isinstance(v, list) else []
    approves, denies = arr(parsed.get("approves")), arr(parsed.get("denies"))
    both = {n for n in approves if n in denies}
    return {"approves": [n for n in approves if n not in both], "denies": [n for n in denies if n not in both],
            "via": s_(res.get("via"))}


def replies(reads: L.Reads, deadline: float) -> dict[str, Any]:
    """tpAuthSweepRun_'s reading: with an ask open, the newest messages of the platform mailbox from the configured
    leaders (the deterministic gate, before any model), each not judged before read by the model."""
    asks = [a for a in auth_rows(reads) if s_(a.get("state")) == "requested"]
    if not asks:
        return {"status": 200, "data": {"open": 0, "checked": 0, "verdicts": []}}
    allowed = [s_(e).lower() for e in recipients(reads)["emails"]]
    box = MB.creds(None)
    if box is None:
        return {"status": 502, "message": "The mailbox did not answer: PLATFORM_EMAIL is not configured"}
    try:
        threads = MB.inbox(box["user"], box["password"], MAILBOX_LIMIT).get("threads") or []
    except Exception as exc:  # noqa: BLE001 - the class, never the conversation
        return {"status": 502, "message": f"The mailbox did not answer: imap_failed ({type(exc).__name__})"[:150]}
    seen = {s_(r.get("messageid")) for r in ai_rows(reads) if s_(r.get("messageid"))}
    names = [s_(a.get("candidatename")) for a in asks]
    checked = 0
    verdicts = []
    for t in threads:
        mid = s_(t.get("id"))
        if not mid or mid in seen:
            continue
        frm = s_(t.get("from_addr")).lower()
        if not any(a and a in frm for a in allowed):
            continue
        checked += 1
        if time.monotonic() >= deadline:
            continue
        v = read_reply(reads, t, names, deadline)
        if v is not None:
            verdicts.append({"id": mid, "from_addr": s_(t.get("from_addr")), **v})
    return {"status": 200, "data": {"open": len(asks), "checked": checked, "verdicts": verdicts}}


# ---- the notas a crossing carries (tpCarryScores_, tpAuthHealMoved_) -------------------------------------------------

def carried_fields(reads: L.Reads, tp_cid: str) -> dict[str, Any]:
    """tpCarriedFields_: the newest scored tp_resume row of one legacy candidate, on the hiring analysis' columns."""
    rz = None
    for r in soft_rows(reads, TP_TABS["resume"]):
        if s_(r.get("candidateid")) == tp_cid:
            rz = r
    if rz is None:
        return {"found": False, "fields": {}}
    fields = {}
    for src, dest in CARRY_MAP.items():
        v = s_(rz.get(hubdb.norm_key(src)))
        if v:
            fields[dest] = v
    return {"found": True, "fields": fields}


def last_row(reads: L.Reads, tab: str, cid: str) -> dict | None:
    hit = None
    for r in soft_rows(reads, tab):
        if s_(r.get("candidateid")) == cid:
            hit = r
    return hit


def carry(reads: L.Reads, tp_cid: str, hiring_cid: str, plan: dict[tuple[str, str], dict[str, str]]) -> None:
    """tpCarryScores_: the legacy id stamped on the card, and the blank score columns of its analysis filled — a value
    already there is never overwritten; laid on `plan` ({(tab, card): fields})."""
    card = last_row(reads, CANDIDATES, hiring_cid)
    stamp = plan.setdefault((CANDIDATES, hiring_cid), {}) if card else None
    if card is not None and not s_(card.get("tpcandidateid")) and "tp_candidate_id" not in stamp:
        stamp["tp_candidate_id"] = tp_cid
    got = carried_fields(reads, tp_cid)
    if not got["found"]:
        return
    last = last_row(reads, RESUME, hiring_cid) or {}
    fill = plan.setdefault((RESUME, hiring_cid), {})
    for col, v in got["fields"].items():
        if not s_(last.get(hubdb.norm_key(col))) and col not in fill:
            fill[col] = v


def heal(reads: L.Reads) -> dict[tuple[str, str], dict[str, str]]:
    """tpAuthHealMoved_: the cards that crossed through an ask, then every live card a scored legacy row names, given
    their notas; {(tab, card): fields}, nothing when nothing is owed."""
    plan: dict[tuple[str, str], dict[str, str]] = {}
    for a in auth_rows(reads):
        if s_(a.get("state")) != "moved":
            continue
        hid, tid = s_(a.get("movedcandidateid")), s_(a.get("candidateid"))
        if hid and tid:
            carry(reads, tid, hid, plan)
    j = joined(reads)
    if j["migrated"] and j["rows"]:
        scored: dict[str, str] = {}
        for r in j["rows"]:
            n = r["name"].strip().lower()
            f = parse_float(r["composite_score"])
            if n and f is not None and math.isfinite(f):
                scored[n] = r["candidate_id"]
        for c in soft_rows(reads, CANDIDATES):
            if s_(c.get("archived")).lower() == "true" or s_(c.get("tpcandidateid")):
                continue
            if (CANDIDATES, s_(c.get("candidateid"))) in plan and plan[(CANDIDATES, s_(c.get("candidateid")))]:
                continue
            tid = scored.get(s_(c.get("candidatename")).lower())
            if tid:
                carry(reads, tid, s_(c.get("candidateid")), plan)
    return {k: v for k, v in plan.items() if v}


# ---- the prepare reads ---------------------------------------------------------------------------------------------

def _sync_gate(user: dict | None) -> dict[str, Any] | None:
    """talentPipelineSync's and talentAuthorizationSweep's door: the relay's clock, or an admin by hand."""
    u = user or {}
    if not u:
        return DENIED
    if not u.get("is_service") and s_(u.get("role")) != "admin":
        return DENIED
    return None


def migrate_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """talentPipelineMigrate's reading, asked first by the relay."""
    u = sess.user or {}
    if not u or u.get("is_service") or s_(u.get("role")) != "admin":
        return DENIED
    got = migration(sess.reads)
    if got.get("status") != 200:
        return got
    return {"status": 200, "data": seal("talentPipelineMigratePrepare", actor(u), {"migrate": got})}


def pipeline_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """talentPipelineSync's reading (the relay's hourly clock, or an admin by hand): the legacy rows not copied yet,
    and the authorization sweep's reading — the notas owed to cards already crossed, the leaders' replies judged."""
    refused = _sync_gate(sess.user)
    if refused:
        return refused
    reads = sess.reads
    mig = migration(reads)
    data: dict[str, Any] = {"migrate": mig, "auth": None, "heal": False}
    if mig.get("status") == 200:
        data["auth"] = replies(reads, time.monotonic() + DUE_DEADLINE_S)
        data["heal"] = bool(heal(reads))
    rows = (mig.get("data") or {}).get("rows") or {}
    verdicts = ((data["auth"] or {}).get("data") or {}).get("verdicts") or []
    data["due"] = mig.get("status") != 200 or any(rows.values()) or bool(verdicts) or data["heal"]
    return {"status": 200, "data": seal("talentPipelineDue", actor(sess.user), data)}


def authorization_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """talentAuthorizationSweep's reading: the leaders' replies judged by the model."""
    refused = _sync_gate(sess.user)
    if refused:
        return refused
    reads = sess.reads
    data = {"auth": replies(reads, time.monotonic() + DUE_DEADLINE_S), "heal": bool(heal(reads))}
    return {"status": 200, "data": seal("talentAuthorizationDue", actor(sess.user), data)}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "talentPipelineList": pipeline_list, "talentCrossingList": crossing_list,
    "talentPipelineMigratePrepare": migrate_prepare, "talentPipelineDue": pipeline_due,
    "talentAuthorizationDue": authorization_due}
POLICY: dict[str, dict[str, Any]] = {
    "talentPipelineList": {"roles": ("admin", "manager")}, "talentCrossingList": {"roles": ("admin", "manager")},
    "talentPipelineMigratePrepare": {"roles": ("admin",)}, "talentPipelineDue": {}, "talentAuthorizationDue": {}}
