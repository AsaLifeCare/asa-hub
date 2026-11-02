"""The hiring outreach (HiringOutreach.gs, CandidateForm.gs candShareLink) on Python: its reads — hiringWhere (where a
person stands, what waits and what stops it) and candShareLink (the signed link to one candidate's form) — the prepare
reads that do the heavy part of a send before its write (hiringShortlistPrepare: the ranking and, off the hiring DB,
the model's reading; hiringCjisRequestPrepare: the CJIS folder; manualResumeAskPrepare: the résumé folders;
hiringOutreachReplyPrepare: the provider's copy of a candidate's texts), and everything the writes
(hiring_outreach_writes) share: the rehearsal's config (hiring_sim_config, its keys read off the facts' subjects), the
cast and its fence, the situations each message speaks through, the words book, the ask book and the ranking."""
from __future__ import annotations

import base64
import functools
import hashlib
import hmac
import json
import re
import threading
import time
import urllib.parse
from typing import Any, Callable

import candidates as CND
import client_care_sweeps as CCS
import gsjs
import hubdb
import interviews as IV
import interviews_writes as IVW
import locations as L
import mail_designs as MD
import opt_outs as OO
import recon as R
import smart_comms as SC
import smart_comms_desk as SCD
from scope import Defer

APP_ID = "hiring"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
CAN_ID = re.compile(r"^CAN_[A-Za-z0-9]{6,}\Z")
SHORTLIST_MAX = 10
LINK_BASE = "https://asamylife.asalifecare.com/candidate.html?t="
NO_SECRET = "Set the INTERVIEW_LINK_SECRET Script Property first — there is no link to mint."
WITHHELD = "[withheld"
ORIGINAL_DOCS_PROP = "HUB_FOLDER_ORIGINAL_DOCS"
SIM_CFG_TAB = "hiring_sim_config"
SIM_ASKS_TAB = "hiring_sim_asks"
TP_CANDIDATES = "tp_candidates"
REFERRALS_TAB = "entity_referrals"
TEAM_CHOSE = "The team chose who to proceed with"
DRIVE_FILES = "https://www.googleapis.com/drive/v3/files"
CJIS_MAX_PAGES = 4
RESUME_MAX_PAGES = 3
CJIS_CACHE_S = 900.0
RESUME_CACHE_S = 300.0
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_LOCK = threading.Lock()
# ResumeInbox.gs RESUME_EXTRA_FOLDERS: the pair the RESUME_EXTRA_FOLDERS property replaces when set
RESUME_EXTRA_FOLDERS = ("1YVyiaMAi4oJ5hUmYGdX1KmXZla6bwHR_",
                        "1igORZ8bHmXECSEFByu6eOdhFDCAfGHlkaaCNmTCrm5oGuJeBMLKPyk6R2ZWq_EKREG9oXjJ2")
RESUME_UNNAMED = re.compile(r"^(new\s*)?resume(\s*\d+)?$|^stna\s*resume$|^cv$", re.I)
# Comms.gs COMMS_TEST_CANDIDATE_IDS and the platform's own test line and address
TEST_CARDS = ("CAN_CFEA7CE713095581517B", "CAN_7DF46D98345D8F032F02", "CAN_FCBBC0985BF468A0FD55")
TEST_LINE, TEST_EMAIL = "3309195558", "asatech@asalifecare.com"
# the purpose each door speaks through: commSituationId_'s binding key and its shipped row
SIT = {"welcome": ("hiring.welcome", "hiring_welcome"), "ask": ("hiring.ask", "hiring_ask"),
       "shortlist": ("hiring.shortlist", "hiring_shortlist"), "outreach": ("hiring.outreach", "hiring_outreach"),
       "cjis_request": ("hiring.cjis.request", "hiring_cjis_request"),
       "decision_ask": ("hiring.decision.request", "hiring_decision_ask"),
       "manual_contact": ("hiring.first_contact", "hiring_first_contact"),
       "screen_call": ("hiring.screen.invitation", "hiring_screen_call"),
       "screen_redo": ("hiring.screen.redo", "hiring_screen_redo"),
       "referral_relay": ("hiring.referral.contact", "hiring_referral_contact"),
       "resume_request": ("hiring.resume.request", "hiring_resume_request"),
       "phone_collect": ("hiring.phone.collect", "hiring_phone_collect"),
       "phone_confirm": ("hiring.phone.confirm", "hiring_phone_confirm")}
# the rows that became situations of their own (hubLaneSituation_): read by id, no binding
THANKS_SIT, ACCEPTED_SIT, LEFT_SIT, MANUAL_RESUME_SIT = (
    "hiring_interest_thanks", "hiring_candidate_accepted", "hiring_candidate_left", "hiring_manual_resume_ask")
# HIRING_SIM_CFG_DEFAULTS for the keys these doors read; a sim_text_* key's floor is the words book's sim.text.*
SIM_DEFAULTS = {
    "sim_mode": "actors", "sim_candidate_email": "asa-hub3@asaop.org", "sim_candidate_phone": "+13309195558",
    "sim_interviewer_email": "asa-hub4@asaop.org", "sim_interviewer_phone": "",
    "sim_cc_emails": "asatech@asalifecare.com, ty.bond@asalifecare.com, arthur.torres@asalifecare.com",
    "sim_watcher_emails": "asatech@asalifecare.com",
    "sim_team_emails": "asatech@asalifecare.com, ty.bond@asalifecare.com, arthur.torres@asalifecare.com",
    "sim_decider_emails": "arthur.torres@asalifecare.com, ty.bond@asalifecare.com",
    "sim_team_sms": "+13309195559, +13309195558, +19377166410, +13309197779",
    "sim_decider_sms": "+13309195559, +19377166410", "sim_attempts": "1", "sim_retry_minutes": "30",
    "sim_attempts_resume_request": "3", "sim_attempts_manual_contact": "7",
    "sim_retry_minutes_manual_contact": "120", "sim_attempts_manual_resume": "3",
    "sim_retry_minutes_manual_resume": "1440", "sim_attempts_phone_collect": "7",
    "sim_retry_minutes_phone_collect": "120", "sim_attempts_phone_confirm": "7",
    "sim_retry_minutes_phone_confirm": "120", "sim_attempts_screen_call": "7", "sim_retry_minutes_screen_call": "120",
    "sim_test_candidate_ids": "", "sim_attempts_ask": "", "sim_attempts_shortlist": "", "sim_attempts_outreach": "7",
    "sim_retry_minutes_outreach": "205", "sim_quo_identify": "yes",
    "sim_quo_intro": "ASA LifeCare hiring (asa-hub platform) — {purpose}. ", "sim_screen_line": "+13307544040",
    "sim_recruiter_name": "", "sim_outbound_guard": "on", "sim_subject_tag": "[TEST] "}
SIM_TEXT_KEYS = frozenset("sim_text_" + k for k in (
    "ask_subject", "ask_body", "outreach_sms", "outreach_email_subject", "outreach_email_body", "accepted_body",
    "screen_call_body", "screen_call_subject", "screen_call_sms", "welcome_subject", "welcome_body",
    "shortlist_subject", "shortlist_body", "thanks_subject", "thanks_body", "accepted_subject", "accepted_sms",
    "resume_request_subject", "resume_request_body", "manual_contact_subject", "manual_contact_body",
    "manual_contact_sms", "manual_resume_sms", "cjis_request_subject", "cjis_request_body", "cjis_nudge_sms",
    "screen_redo_subject", "screen_redo_body", "screen_redo_sms", "decision_ask_subject", "decision_ask_body",
    "decision_ask_sms", "discard_subject", "discard_body"))
_CJIS_NOT_A_NAME = re.compile(r"\b(" + "|".join((
    "cjis", "bci", "fbi", "rapback", "background", "report", "reports", "check", "checks", "result", "results", "copy",
    "of", "the", "and", "dodd", "training", "certificate", "certificates", "cert", "certs", "cpr", "st", "aid", "first",
    "hs", "diploma", "transcripts", "ged", "drivers", "driver", "license", "licence", "oh", "id", "social", "security",
    "card", "birth", "car", "insurance", "med", "del", "mandt", "mandtt")) + r")\b", re.I | re.A)
_LETTERS = "A-Za-zÀ-ÿ'’"

s_ = gsjs.str_


# ---- small pure helpers -------------------------------------------------------------------------------------------

def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and s_((user or {}).get("role")) in ("admin", "manager")


# HUB_POLICY's required params, said as hubPolicyGate_ says them before the door runs
REQUIRED = {a: ("candidate_id",) for a in (
    "hiringWhere", "hiringOutreachSms", "hiringScreenCallSend", "hiringAcceptedNotify", "hiringOutreachReplyCheck",
    "hiringCjisRequestSend", "hiringDecisionAskSend", "manualContactSend", "hiringPhoneCollectAsk",
    "hiringPhoneConfirmSend", "manualResumeAsk")}
REQUIRED["hiringDiscard"] = ("candidate_id", "reason")


def missing(action: str, payload: Any) -> dict[str, Any] | None:
    p = payload if isinstance(payload, dict) else {}
    for key in REQUIRED.get(action, ()):
        if p.get(key) is None or p.get(key) == "":
            return {"status": 400, "message": f"Missing required parameter: {key}."}
    return None


def int_of(v: Any, floor: int) -> int:
    """parseInt(v, 10) || floor."""
    n = SCD.js_parse_int(v)
    return n if n else floor


def digits(v: Any) -> str:
    return re.sub(r"\D", "", gsjs.or_blank(v))


def greet_first(name: Any) -> str:
    """hiringGreetFirst_: the [TEST] tag stripped, the first word."""
    n = gsjs.trim(re.sub(r"^\s*\[test\]\s*", "", s_(name), flags=re.I))
    return re.split(r"[\s,]+", n)[0] or n


def short_name(name: Any) -> str:
    """hiringShortName_: a multi-name rehearsal shortened to its first and how many more."""
    n = gsjs.trim(re.sub(r"^\s*\[test\]\s*", "", s_(name), flags=re.I))
    parts = [p for p in re.split(r"\s*,\s*", n) if p]
    return n if len(parts) <= 1 else parts[0] + " +" + str(len(parts) - 1)


def first_sentence(text: Any) -> str:
    """hiringFirstSentence_."""
    t = gsjs.trim(gsjs.or_blank(text))
    if not t:
        return ""
    m = re.match(r"^[\s\S]*?[.!?](\s|$)", t)
    return gsjs.trim(m.group(0) if m else t)[:200]


def fill(text: Any, said: dict[str, str]) -> str:
    """Each {key} the dict names, filled with its words (a JS .replace(/\\{key\\}/g, v) per key)."""
    out = gsjs.or_blank(text)
    for k, v in said.items():
        out = out.replace("{" + k + "}", v)
    return out


def letter_render(tpl: Any, vars_: dict | None) -> str:
    """hubLetterRender_: {key} filled when the vars name it, left standing when they do not."""
    v = vars_ or {}
    return re.sub(r"\{(\w+)\}", lambda m: gsjs.or_blank(v[m.group(1)]) if m.group(1) in v else m.group(0),
                  gsjs.or_blank(tpl))


def stage_of(status: Any) -> str:
    return CND.stage_of(status) or ""


def archived(c: dict | None) -> bool:
    return s_((c or {}).get("archived")).lower() == "true"


def drive_file_url(fid: str) -> str:
    return "https://drive.google.com/file/d/" + fid + "/view"


# ---- the rehearsal's config (HiringSimConfig.gs) ------------------------------------------------------------------

def sim_cfg(reads: L.Reads) -> dict[str, str]:
    """hiringSimCfg_: key → value. Dissolved, each row's key is its facts' subject (the copy withholds the key
    cells)."""
    def read() -> dict[str, str]:
        out: dict[str, str] = {}
        if reads.db.dissolved(SIM_CFG_TAB):
            by: dict[str, dict[str, str]] = {}
            prefix = "dissolution:" + SIM_CFG_TAB + "."
            for sub, val, src in CND.facts(reads, prefix):
                if sub and src.startswith(prefix):
                    by.setdefault(gsjs.trim(sub), {})[src[len(prefix):]] = gsjs.or_blank(val)
            for k, row in by.items():
                if k and row.get("__deleted", "").lower() != "true":
                    out[k] = row.get("value", "")
            return out
        for r in CND.read_tab(reads, SIM_CFG_TAB):
            k = s_(r.get("key"))
            if k and not k.startswith(WITHHELD):
                out[k] = gsjs.or_blank(r.get("value"))
        return out
    return reads.once("ho:sim_cfg", read)


def cfg_val(reads: L.Reads, key: str) -> str:
    """simCfgVal_: the cell, else the shipped default (a sim_text_* row's own words book line)."""
    v = s_(sim_cfg(reads).get(key))
    if v:
        return v
    if key in SIM_DEFAULTS:
        return s_(SIM_DEFAULTS[key]) or text_default(reads, key)
    if key in SIM_TEXT_KEYS:
        return text_default(reads, key)
    return ""


def text_default(reads: L.Reads, key: str) -> str:
    """simTextDefault_."""
    return book(reads, "sim.text." + key[len("sim_text_"):]) if key.startswith("sim_text_") else ""


def cfg_list(reads: L.Reads, key: str) -> list[str]:
    """simCfgList_."""
    return SCD.cfg_list(cfg_val(reads, key))


def outbound_guard(reads: L.Reads) -> bool:
    """simOutboundGuard_: the fence stands unless the cell says off."""
    return cfg_val(reads, "sim_outbound_guard").lower() != "off"


def one_allowed(reads: L.Reads, dest: Any) -> bool:
    """simOutboundOneAllowed_: one address or number against the cast."""
    d = gsjs.trim(gsjs.or_text(dest)).lower()
    if not d:
        return True
    if "@" in d:
        if re.fullmatch(r"asa-hub[0-9]*@asaop\.org", d):
            return True
        for key in ("sim_candidate_email", "sim_interviewer_email", "sim_cc_emails", "sim_watcher_emails",
                    "sim_team_emails", "sim_decider_emails"):
            if any(a.lower() == d for a in cfg_list(reads, key)):
                return True
        return False
    dd = re.sub(r"[^0-9]", "", d)
    if not dd:
        return False
    nums = cfg_list(reads, "sim_team_sms") + [cfg_val(reads, "sim_candidate_phone"),
                                               cfg_val(reads, "sim_interviewer_phone")]
    for n in nums:
        nd = re.sub(r"[^0-9]", "", gsjs.or_text(n))
        if nd and (nd == dd or "1" + nd == dd or nd == "1" + dd):
            return True
    return False


def test_mode(reads: L.Reads) -> dict[str, Any]:
    """hubTestModeState_; a config that cannot be read holds as on."""
    try:
        return SCD.test_mode_state(reads.config())
    except Exception:  # noqa: BLE001 - an unread switch holds
        return {"on": True, "sms": [], "emails": [], "unreadable": True}


def outbound_allowed(reads: L.Reads, dest: Any) -> dict[str, Any]:
    """simOutboundAllowed_: every part of a destination on the cast while the fence stands. Test mode is the sheet
    position (hubTestRedirect_ lists no tester), so nothing outside the cast is ever carried to one."""
    if not outbound_guard(reads):
        return {"ok": True}
    redir = test_mode(reads)["on"]
    for part in [x for x in (gsjs.trim(p) for p in re.split(r"[,;\n]+", gsjs.or_blank(dest))) if x]:
        if one_allowed(reads, part):
            continue
        mail = "@" in part
        return {"ok": False, "reason": "outside_address_blocked" if mail else "outside_number_blocked",
                "detail": part + " is not on the cast — the fence (sim_outbound_guard) refuses every "
                          + ("address" if mail else "number") + " outside the configured team and actors"
                          + (", and test mode has no tester listed for " + ("e-mail" if mail else "SMS")
                             + " to redirect it to" if redir else
                             ", test mode being off — switch test mode on and the rehearsal reaches the testers "
                             "instead of being refused")}
    return {"ok": True}


def tester_keys() -> dict[str, list[str]]:
    """simTesterKeys_: who else may answer for a card while the redirect is live — test mode is the sheet position,
    whose redirect lists nobody."""
    return {"digits": [], "emails": []}


def sendable_phone(reads: L.Reads, raw: Any) -> str:
    """simSendablePhone_: a person's number, or one of the cast's own shared lines while the fence stands."""
    to = SC.sendable(raw)
    if to:
        return to
    d = re.sub(r"^1", "", digits(raw), count=1)
    if len(d) != 10:
        return ""
    return "+1" + d if outbound_guard(reads) and one_allowed(reads, "+1" + d) else ""


def actors(reads: L.Reads) -> dict[str, Any]:
    """hiringSimActors_: the cast, resolved."""
    team = cfg_list(reads, "sim_team_emails") or team_of(reads)["emails"]
    deciders = [x for x in cfg_list(reads, "sim_decider_emails") if "@" in x] or team[:2]
    return {"mode": "redirect" if cfg_val(reads, "sim_mode").lower() == "redirect" else "actors",
            "screen_line": cfg_val(reads, "sim_screen_line"),
            "watcher_emails": [x for x in cfg_list(reads, "sim_watcher_emails") if "@" in x],
            "candidate_email": cfg_val(reads, "sim_candidate_email"),
            "candidate_phone": sendable_phone(reads, cfg_val(reads, "sim_candidate_phone")),
            "cc_emails": [x for x in cfg_list(reads, "sim_cc_emails") if "@" in x],
            "team_emails": team, "decider_emails": deciders,
            "team_sms": [n for n in (sendable_phone(reads, x) for x in cfg_list(reads, "sim_team_sms")) if n],
            "decider_sms": [n for n in (sendable_phone(reads, x) for x in cfg_list(reads, "sim_decider_sms")) if n]}


def cc_for(reads: L.Reads, to: Any) -> str:
    """simCcFor_: the copy list for one send, nobody already addressed doubled."""
    have = {x.strip().lower() for x in re.split(r"[,;\n]+", gsjs.or_blank(to)) if x.strip()}
    return ", ".join(x for x in actors(reads)["cc_emails"] if x.lower() not in have)


def team_address(reads: L.Reads) -> dict[str, str]:
    """simTeamAddress_: a team letter goes to the deciders, the watchers in copy."""
    a = actors(reads)
    have = {x.lower() for x in a["decider_emails"]}
    return {"to": ", ".join(a["decider_emails"]),
            "cc": ", ".join(x for x in a["watcher_emails"] if x.lower() not in have)}


def tag_subject(reads: L.Reads, subject: Any) -> str:
    """simTagSubject_: the rehearsal tag rides the title while test mode is off."""
    s = gsjs.or_blank(subject)
    tag = cfg_val(reads, "sim_subject_tag")
    if not tag or test_mode(reads)["on"]:
        return s
    if s.startswith(tag) or s.startswith("[TEST]"):
        return s
    return tag + ("" if re.search(r"\s$", tag) else " ") + s


def quo_intro(reads: L.Reads, purpose: Any) -> str:
    """simQuoIntro_: who is writing first, then why."""
    if cfg_val(reads, "sim_quo_identify").lower() != "yes":
        return ""
    tpl = cfg_val(reads, "sim_quo_intro") or "ASA LifeCare hiring (asa-hub platform) — {purpose}. "
    return tpl.replace("{purpose}", gsjs.or_text(purpose) or "about your hiring process")


def attempts_for(reads: L.Reads, step: str) -> dict[str, int]:
    """simAttemptsFor_: the step's own cells, then the global ones."""
    per = SCD.js_parse_int(cfg_val(reads, "sim_attempts_" + step))
    every = SCD.js_parse_int(cfg_val(reads, "sim_attempts"))
    per_min = SCD.js_parse_int(cfg_val(reads, "sim_retry_minutes_" + step))
    minutes = SCD.js_parse_int(cfg_val(reads, "sim_retry_minutes"))
    n = per if per and per > 0 else (every if every and every > 0 else 1)
    return {"attempts": min(n, 50),
            "minutes": per_min if per_min and per_min >= 5 else (minutes if minutes and minutes >= 5 else 30)}


def rehearsal(reads: L.Reads, c: dict | None) -> bool:
    """packetIsRehearsal_ through commsIsTestCandidate_."""
    if not c:
        return False
    cid = s_(c.get("candidateid"))
    if cid in TEST_CARDS:
        return True
    try:
        if cid and cid in cfg_list(reads, "sim_test_candidate_ids"):
            return True
    except Exception:  # noqa: BLE001 - an unreadable cell never widens or narrows the floor
        pass
    if s_(c.get("candidatename")).lower().startswith("[test]"):
        return True
    email = s_(c.get("email")).lower()
    if re.fullmatch(r"asa-hub[0-9]*@asaop\.org", email):
        return True
    return digits(c.get("phone"))[-10:] == TEST_LINE or email == TEST_EMAIL


def ask_rows(reads: L.Reads) -> list[dict]:
    """simAskRows_."""
    return CND.sim_ask_rows(reads)


# ---- the situations each message speaks through -------------------------------------------------------------------

def situations(reads: L.Reads) -> list[dict]:
    return reads.once("ho:situations", lambda: SC.read_situations(reads.db))


def sid(reads: L.Reads, purpose: str) -> str:
    """commSituationId_ for one of this file's purposes."""
    key, shipped = SIT[purpose]
    try:
        rows = situations(reads)
    except Exception:  # noqa: BLE001 - situations unreadable: the binding's cell is trusted, the floor the ship's
        rows = []
    return MD.situation_id(reads, rows, key, shipped)


def allowed(reads: L.Reads, situation: str) -> dict[str, Any]:
    """outreachAllowed_: a row that exists and is off refuses; an absent row is silence, never a no; unreadable
    refuses."""
    try:
        found = SC.situation_row(situations(reads), situation)
    except Exception:  # noqa: BLE001 - a switch nobody could read may be off
        return {"ok": False, "sit": None, "unreadable": True,
                "reason": "the Smart Comms situations could not be read — nothing was sent; try again"}
    if found is None:
        return {"ok": True, "sit": None}
    if not SC.smart_on(found.get("enabled")):
        return {"ok": False, "sit": found, "reason": f'the Smart Comms situation "{situation}" is switched off'}
    return {"ok": True, "sit": found}


def idle_why(allow: dict, off_words: str) -> str:
    """outreachIdleWhy_."""
    return s_(allow.get("reason")) if allow.get("unreadable") else off_words


def sit_cell(allow: dict, field: str) -> str:
    return s_((allow.get("sit") or {}).get(field))


class Lane:
    """hubLaneSituation_: a lane that became a situation — on, why, its words and its channels."""

    def __init__(self, reads: L.Reads, situation: str) -> None:
        self.id = situation
        self.row: dict | None = None
        self.unreadable = False
        try:
            self.row = SC.situation_row(situations(reads), situation)
            on = self.row is not None and SC.smart_on(self.row.get("enabled"))
        except Exception as exc:  # noqa: BLE001 - an unreadable switch is never a yes
            self.unreadable, on = True, False
            self.why = (f"the situations tab could not be read ({str(exc)[:160]}) — {situation} is held, not sent: "
                        "an unreadable switch is never a yes")
        self.on = on
        if not self.unreadable:
            self.why = ("" if on else f"the situation {situation} is not in the situations tab yet — nothing was sent"
                        if self.row is None else
                        f"the situation {situation} is switched off in Smart Comms — nothing was sent")
        chans = s_((self.row or {}).get("channels"))
        self._chans = SC.smart_list(chans) if chans else None

    def word(self, field: str, floor: Any, vars_: dict | None) -> str:
        cell = s_((self.row or {}).get(field))
        return letter_render(cell, vars_) if cell else gsjs.or_blank(floor)

    def leg(self, channel: str) -> bool:
        return self._chans is None or channel in self._chans


def text_row_value(reads: L.Reads, key: str) -> str:
    """simTextRowValue_: a message key's cell on the Smart Comms row that owns it."""
    for suffix, field in (("_email_subject", "email_subject"), ("_subject", "email_subject"),
                          ("_email_body", "email_text"), ("_body", "email_text"), ("_sms", "sms_text")):
        if key.endswith(suffix):
            stem = key[:-len(suffix)]
            break
    else:
        return ""
    if stem not in SIT:
        return ""
    try:
        hit = SC.situation_row(situations(reads), sid(reads, stem))
    except Exception:  # noqa: BLE001 - an unreadable screen never mutes a send
        return ""
    return s_((hit or {}).get(field))


def sim_text(reads: L.Reads, key: str, fallback: str = "") -> str:
    """simText_: the Smart Comms row first, then the config cell, then the fallback."""
    return text_row_value(reads, key) or cfg_val(reads, "sim_text_" + key) or fallback


# ---- the team, the words book, the journey ------------------------------------------------------------------------

def team_of(reads: L.Reads) -> dict[str, Any]:
    """hiringTeamRecipients_: the hiring config's addresses and every account's name by each of its addresses."""
    def read() -> dict[str, Any]:
        try:
            emails = IVW.team_emails(reads)
        except Exception:  # noqa: BLE001 - as Apps Script: an unreadable list is an empty one
            emails = []
        names: dict[str, str] = {}
        try:
            for u in reads.users():
                if s_(u.get("mergedinto")):
                    continue
                mine = [s_(u.get("email"))]
                try:
                    extra = json.loads(s_(u.get("emails")) or "[]")
                    if isinstance(extra, list):
                        mine += [gsjs.js_str(x) for x in extra]
                except ValueError:
                    pass
                for addr in mine:
                    k = addr.strip().lower()
                    if k and k not in names:
                        names[k] = s_(u.get("displayname"))
        except Exception:  # noqa: BLE001 - the names are a courtesy
            pass
        return {"emails": emails, "names": names}
    return reads.once("ho:team", read)


def team_name(reads: L.Reads, email: Any) -> str:
    """hiringTeamName_."""
    return team_of(reads)["names"].get(gsjs.or_blank(email).strip().lower(), "")


def book(reads: L.Reads, key: str, floor: str = "") -> str:
    """bookText_('Strings', key, floor): never throws."""
    try:
        return CND.book_text(reads, "Strings", key, floor)
    except Exception:  # noqa: BLE001 - as Apps Script: the floor answers
        return floor


def words_regex(reads: L.Reads, key: str, shape: str) -> re.Pattern | None:
    """bookWordsRegex_: the words book's list as one pattern, anchored at the head of the reply for 'start'."""
    parts = [re.escape(w) for w in SCD.cfg_list(book(reads, key))]
    if not parts:
        return None
    body = "(" + "|".join(parts) + ")"
    try:
        return re.compile(("^" + body + r"\b") if shape == "start" else (r"\b" + body + r"\b"), re.I | re.A)
    except re.error:
        return None


def journey_title(reads: L.Reads, step: str) -> str:
    """hiringJourneySteps_()[step], soft."""
    try:
        return CND.journey_steps(reads).get(step, "")
    except Exception:  # noqa: BLE001 - the step names itself
        return ""


def chose_line(reads: L.Reads) -> dict | None:
    """The newest team-level line where the team chose who to proceed with."""
    for ln in reversed(CND.journey_for(reads, "") or []):
        if not s_(ln.get("candidate_id")) and s_(ln.get("step")) == "interest" and s_(ln.get("title")) == TEAM_CHOSE:
            return ln
    return None


def original_docs_url(reads: L.Reads) -> str:
    """hiringOriginalDocsUrl_."""
    fid = gsjs.trim(reads.db.prop(ORIGINAL_DOCS_PROP)) or gsjs.trim(reads.db.prop("COMPLIANCE_SHARED_FOLDER_ID"))
    return "https://drive.google.com/drive/folders/" + fid if fid else ""


def referral_book_row(reads: L.Reads, cid: str) -> dict | None:
    """referralLadderBookRow_: the live row wins over informational ones; none when the book is not there."""
    if not cid:
        return None
    try:
        live = anyrow = None
        for r in CND.read_tab(reads, REFERRALS_TAB):
            if s_(r.get("candidateid")) != cid:
                continue
            anyrow = r
            if s_(r.get("state")) in ("received", "contacting", "asking_referrer"):
                live = r
        return live or anyrow
    except Exception:  # noqa: BLE001 - no book, no row
        return None


# ---- the Added Manually door's predicates ----------------------------------------------------------------------------

def manual_card_is(c: dict | None) -> bool:
    """manualCardIs_."""
    if not c or stage_of(c.get("status")) != "new" or archived(c):
        return False
    return bool(s_(c.get("phone")) or s_(c.get("email")))


def manual_origin(c: dict | None) -> str:
    """manualCardOrigin_: what we say depends on how they got here."""
    by = s_((c or {}).get("createdby"))
    src = s_((c or {}).get("source")).lower()
    if "application" in src:
        return "applied"
    if by.startswith("asa-hub-resume:"):
        return "resume"
    if by.startswith("asa-hub-talent-auth:"):
        return "store"
    return "named"


# ---- the ranking (hiringRanked_, the Analysis winners, our reading) -----------------------------------------------

def ranked(reads: L.Reads, ids: list[str], exclude: list[str], stage: str, limit: int) -> dict[str, Any]:
    """hiringRanked_: the hiring DB's own scoring, unscored last, never zero."""
    by_id: dict[str, dict] = {}
    for a in CND.read_tab(reads, CND.TALENT_RESUME_TAB):
        if s_(a.get("candidateid")):
            by_id[s_(a.get("candidateid"))] = a
    want, skip = {s_(i) for i in ids}, {s_(i) for i in exclude}
    rows = []
    for c in CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB):
        cid = s_(c.get("candidateid"))
        if not cid or cid in skip:
            continue
        if ids:
            if cid not in want:
                continue
        else:
            st = stage_of(c.get("status"))
            if not st or (stage and st != stage) or (not stage and st != "new"):
                continue
        a = by_id.get(cid, {})
        raw = s_(a.get("compositescore"))
        score = None if raw == "" else CND.js_parse_float(raw)
        rows.append({"candidate_id": cid, "name": s_(c.get("candidatename")), "score": score,
                     "why": first_sentence(a.get("summary")) or s_(a.get("qualification")),
                     "phone": s_(c.get("phone")), "email": s_(c.get("email")),
                     "city": ", ".join(x for x in (s_(c.get("city")), s_(c.get("state"))) if x),
                     "stage": stage_of(c.get("status"))})

    def order(x: dict, y: dict) -> int:
        if x["score"] is None and y["score"] is None:
            return -1 if x["name"] < y["name"] else 1
        if x["score"] is None:
            return 1
        if y["score"] is None:
            return -1
        return (y["score"] > x["score"]) - (y["score"] < x["score"])
    rows.sort(key=functools.cmp_to_key(order))
    return {"rows": rows[:limit or SHORTLIST_MAX], "total": len(rows),
            "unscored": sum(1 for r in rows if r["score"] is None)}


def _analysis_row(r: dict) -> dict[str, Any]:
    score = IV._rank_score(r)
    return {"candidate_id": s_(r.get("candidate_id")), "name": s_(r.get("name")), "score": score,
            "why": first_sentence(r.get("summary")) or ("Decision: " + s_(r.get("decision")) if s_(r.get("decision"))
                                                        else ""),
            "phone": s_(r.get("phone")), "email": s_(r.get("email")), "city": s_(r.get("city"))}


def winners(reads: L.Reads, p: dict) -> dict[str, Any]:
    """hiringShortlistCore_'s collection: the Talent Pipeline Analysis winners (a retry re-presents the same five),
    the hiring DB as the fallback."""
    want = [s_(i) for i in (p.get("candidate_ids") or []) if s_(i)]
    rows: list[dict] = []
    try:
        joined = IV.tp_joined(reads)
        if joined["migrated"]:
            if want:
                by = {s_(r.get("candidate_id")): r for r in joined["rows"]}
                rows = [_analysis_row(by[i]) for i in want if i in by]
            else:
                skip = {s_(i) for i in (p.get("exclude_ids") or [])}
                seen: set[str] = set()
                limit = p.get("limit") or 5
                for r in IV.tp_rank(joined["rows"]):
                    if len(rows) >= limit:
                        break
                    if s_(r.get("candidate_id")) in skip or s_(r.get("status")).lower() == "duplicate":
                        continue
                    key = re.sub(r"[^a-z]", "", s_(r.get("name")).lower())
                    if not key or key in seen:
                        continue
                    seen.add(key)
                    rows.append(_analysis_row(r))
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - as Apps Script: an unreadable Analysis falls to the hiring DB
        rows = []
    if rows:
        return {"source": "analysis", "rows": rows, "pool": len(rows), "ranked": None}
    got = ranked(reads, want, [s_(i) for i in (p.get("exclude_ids") or [])], "", p.get("limit") or SHORTLIST_MAX)
    rows = [{k: r[k] for k in ("candidate_id", "name", "score", "why", "phone", "email", "city")} for r in got["rows"]]
    return {"source": "hiring db", "rows": rows, "pool": got["total"], "ranked": got}


def reading(reads: L.Reads, got: dict[str, Any], deadline: float) -> str:
    """hiringReading_: the model's paragraph over the ranking, else our own words about it."""
    rows = got.get("rows") or []
    if not rows:
        return ""
    lines = "\n".join("- " + r["name"] + (" (not scored)" if r["score"] is None else " (" + gsjs.js_str(r["score"])
                                          + "/10)") + (": " + r["why"] if r["why"] else "") for r in rows)
    try:
        prompt = CND.book_text(reads, "Prompts", "ai_shortlist_reading", "").replace("{lines}", lines)
    except Exception:  # noqa: BLE001 - the letter is worth sending without the paragraph
        prompt = ""
    if prompt:
        try:
            ai = CCS.ai_chat(reads, prompt, 0.4, "ai_shortlist_reading", deadline)
            if ai.get("ok") and gsjs.trim(s_(ai.get("content"))):
                return gsjs.trim(s_(ai.get("content")))
        except Exception:  # noqa: BLE001 - the letter is worth sending without the paragraph
            pass
    scored = [r for r in rows if r["score"] is not None]
    top = scored[0] if scored else None
    return ("This is our own resume scoring, read straight off the database: " + str(len(scored)) + " of "
            + str(len(rows)) + " in this list carry a score"
            + (", and " + top["name"] + " is the highest at " + gsjs.js_str(top["score"]) + " out of 10" if top else "")
            + ". The rest are listed without one — that is a resume nobody has scored yet, not a low mark.")


# ---- the folders (Cjis.gs, ResumeInbox.gs) ------------------------------------------------------------------------

def cjis_key(name: Any) -> str:
    """cjisKey_ (and resumeInboxKey_): one person keys one way."""
    return re.sub(r"[^a-z]", "", gsjs.or_blank(name).lower())


def _cjis_clean(text: str) -> str:
    """cjisCleanName_: two words or nothing."""
    n = re.sub(r"[_\-.]+", " ", text)
    m = re.match(r"^\s*([" + _LETTERS + r"]+)\s*,\s*([" + _LETTERS + r"]+)", n)
    if m:
        n = m.group(2) + " " + m.group(1) + " " + n.replace(m.group(0), " ", 1)
    n = _CJIS_NOT_A_NAME.sub(" ", n)
    n = re.sub(r"\b\d{1,2}[\s/]\d{1,2}[\s/]\d{2,4}\b", " ", n, flags=re.A)
    n = re.sub(r"\d+", " ", n)
    n = gsjs.trim(re.sub(r"\s+", " ", re.sub(r"[^" + _LETTERS + r" ]+", " ", n)))
    words = [w for w in n.split(" ") if len(w) > 1]
    return " ".join(words[:3]) if len(words) >= 2 else ""


def cjis_name(filename: Any) -> str:
    """cjisNameFrom_: the folder's `<Name> - <Document type> - <YYYYMMDD>` convention first."""
    raw = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", gsjs.or_blank(filename))
    tries = []
    dash = raw.split(" - ")
    if len(dash) > 1:
        tries.append(dash[0])
    tries.append(raw)
    for t in tries:
        got = _cjis_clean(t)
        if got:
            return got
    return ""


def _listing(drive: Any, folder: str, max_pages: int, newest_first: bool) -> list[dict] | None:
    """One folder's files as Drive lists them (folders too), at most max_pages pages; None when it refused."""
    out: list[dict] = []
    page = ""
    for _n in range(max_pages):
        params = {"q": f"'{folder}' in parents and trashed=false",
                  "fields": "nextPageToken,files(id,name,modifiedTime,mimeType)", "pageSize": 1000,
                  "includeItemsFromAllDrives": "true"}
        if newest_first:
            params["orderBy"] = "modifiedTime desc"
        if page:
            params["pageToken"] = page
        try:
            got = drive._get(DRIVE_FILES, params)
        except Exception:  # noqa: BLE001 - one unreadable folder is reported while the others answer
            return None if not out else out
        out.extend(got.get("files") or [])
        page = got.get("nextPageToken") or ""
        if not page:
            break
    return out


def _extra_folders(reads: L.Reads, first: str) -> list[str]:
    """The folder named first, then RESUME_EXTRA_FOLDERS (the shipped pair while the property is unset)."""
    folders = [first] if first else []
    extra = s_(reads.db.prop("RESUME_EXTRA_FOLDERS"))
    for fid in (extra.split(",") if extra else RESUME_EXTRA_FOLDERS):
        fid = fid.strip()
        if fid and fid not in folders:
            folders.append(fid)
    return folders


def _held(name: str, ttl: float, build: Callable[[], dict[str, Any]], fresh: bool) -> dict[str, Any]:
    """An index kept in this process for `ttl` seconds (CacheService's role in Apps Script); an error is not kept."""
    with _CACHE_LOCK:
        got = _CACHE.get(name)
        if got and not fresh and time.monotonic() - got[0] < ttl:
            return got[1]
    built = build()
    if not built.get("error"):
        with _CACHE_LOCK:
            _CACHE[name] = (time.monotonic(), built)
    return built


def cjis_index(reads: L.Reads, fresh: bool = False) -> dict[str, Any]:
    """cjisFolderIndex_: person key → the newest file naming them across the watched folders, kept 15 minutes."""
    def build() -> dict[str, Any]:
        main = (gsjs.trim(reads.db.prop(ORIGINAL_DOCS_PROP)) or gsjs.trim(reads.db.prop("COMPLIANCE_SHARED_FOLDER_ID"))
                or gsjs.trim(reads.db.prop("CJIS_FOLDER_ID")))
        drive = reads.need_drive()
        people: dict[str, dict] = {}
        read_one = 0
        for folder in _extra_folders(reads, main):
            files = _listing(drive, folder, CJIS_MAX_PAGES, False)
            if files is None:
                continue
            read_one += 1
            for f in files:
                key = cjis_key(cjis_name(f.get("name")))
                if not key:
                    continue
                prev = people.get(key)
                if prev is None or s_(f.get("modifiedTime")) > s_(prev.get("at")):
                    people[key] = {"fileId": s_(f.get("id")), "filename": s_(f.get("name")),
                                   "at": s_(f.get("modifiedTime"))}
        if not read_one:
            return {"people": {}, "error": "None of the watched CJIS folder(s) could be read."}
        return {"people": people, "error": ""}
    return _held("cjis", CJIS_CACHE_S, build, fresh)


def cjis_hit(reads: L.Reads, name: str, fresh: bool = False) -> dict[str, Any]:
    """The CJIS folder's file for one person: {hit, error}."""
    idx = cjis_index(reads, fresh)
    return {"hit": idx["people"].get(cjis_key(name)) if cjis_key(name) else None, "error": idx["error"]}


def resume_name(filename: Any) -> str:
    """resumeInboxName_."""
    n = re.sub(r"\.(pdf|docx?|rtf|txt)$", "", gsjs.or_blank(filename), flags=re.I)
    n = re.sub(r"_\d{8}_\d{6}$", "", n)
    return gsjs.trim(re.sub(r"\s+", " ", re.sub(r"[_.]+", " ", n)))


def resume_index(reads: L.Reads, fresh: bool = False) -> dict[str, Any]:
    """resumeInboxFiles_: person key → the newest named file across the résumé folders, kept 5 minutes."""
    def build() -> dict[str, Any]:
        drive = reads.need_drive()
        people: dict[str, dict] = {}
        read_one = 0
        for folder in _extra_folders(reads, gsjs.trim(reads.db.prop("RESUME_INBOX_FOLDER_ID"))):
            files = _listing(drive, folder, RESUME_MAX_PAGES, True)
            if files is None:
                continue
            read_one += 1
            for f in files:
                nm = resume_name(f.get("name"))
                key = cjis_key(nm)
                if not key:
                    continue
                prev = people.get(key)
                if prev is None:
                    people[key] = {"fileId": s_(f.get("id")), "at": s_(f.get("modifiedTime")),
                                   "unnamed": bool(RESUME_UNNAMED.search(nm))}
                elif s_(f.get("modifiedTime")) > prev["at"]:
                    prev.update(fileId=s_(f.get("id")), at=s_(f.get("modifiedTime")))
        if not read_one:
            return {"people": {}, "error": "None of the watched resume folder(s) could be read."}
        return {"people": people, "error": ""}
    return _held("resume", RESUME_CACHE_S, build, fresh)


def resume_hit(reads: L.Reads, name: str, fresh: bool = False) -> str:
    """resumeInboxScan's people matched to one card by resumeInboxKey_: the newest file's link, '' for none."""
    want = cjis_key(re.sub(r"^\s*\[test\]\s*", "", name, flags=re.I))
    hit = resume_index(reads, fresh)["people"].get(want) if want else None
    return drive_file_url(hit["fileId"]) if hit and hit["fileId"] and not hit["unnamed"] else ""


# ---- the provider's copy of a candidate's texts (quoInboundPull_) --------------------------------------------------

def quo_pull(reads: L.Reads, cid: str, name: str, phone: str) -> dict[str, Any]:
    """quoInboundPull_ up to the filing: the Automations line's last twenty messages with this number, each incoming
    one not ours and not filed yet, with its intent. Reads only — the write files them."""
    out: dict[str, Any] = {"pulled": 0, "error": "", "items": [], "line": ""}
    d = re.sub(r"^1", "", digits(phone), count=1)
    if len(d) != 10:
        out["error"] = "no_number"
        return out
    key = SC._key()
    if not key:
        out["error"] = "no_provider_key"
        return out
    try:
        code, text = SC._http("GET", SC.PROVIDER + "/phone-numbers", key)
        listed = json.loads(text or "{}") if code == 200 else {}
    except Exception:  # noqa: BLE001 - no line listed is no line
        listed = {}
    line = next(({"id": s_(p.get("id")), "number": s_(p.get("number"))} for p in (listed.get("data") or [])
                 if isinstance(p, dict) and gsjs.js_str(p.get("name")) == SC.DEFAULT_LINE), None)
    if not line or not line["id"]:
        out["error"] = "no_sending_line"
        return out
    out["line"] = line["number"]
    q = urllib.parse.urlencode([("phoneNumberId", line["id"]), ("participants[]", "+1" + d), ("maxResults", "20")])
    try:
        code, text = SC._http("GET", SC.PROVIDER + "/messages?" + q, key)
    except Exception:  # noqa: BLE001 - the tab still answers
        out["error"] = "provider_unreachable"
        return out
    if code != 200:
        out["error"] = f"provider_{code}"
        return out
    try:
        msgs = (json.loads(text or "{}") or {}).get("data") or []
    except ValueError:
        msgs = []
    if not msgs:
        return out
    try:
        have = {s_(m.get("messageid")) for m in OO.inbound_rows(reads)}
    except Exception:  # noqa: BLE001 - never file twice blind
        out["error"] = "inbound_unreadable"
        return out
    for m in msgs:
        if not isinstance(m, dict) or s_(m.get("direction")) != "incoming":
            continue
        from_digits = digits(m.get("from"))[-10:]
        if OO.is_ours(reads, from_digits):
            continue
        mid = s_(m.get("id"))
        if not mid or mid in have:
            continue
        body = s_(m.get("text") or m.get("content") or m.get("body"))
        out["items"].append({"message_id": mid, "received_at": s_(m.get("createdAt")), "from_number": s_(m.get("from")),
                             "from_key": from_digits, "candidate_id": cid, "person_name": name, "body": body,
                             "intent": OO.opt_out_intent(body, reads.config()) or "reply",
                             "our_number": line["number"]})
        have.add(mid)
    out["pulled"] = len(out["items"])
    return out


# ---- the reads ------------------------------------------------------------------------------------------------------

def where(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringWhere: where this person is, what is waiting and what is stopping it — the switch, the fence, the ask
    book, who may answer for the card, and the stage's gate."""
    reads, user = sess.reads, sess.user
    if not user or (not user.get("is_service") and s_(user.get("role")) not in ("admin", "manager")):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    refused = missing("hiringWhere", p)
    if refused:
        return refused
    cid = s_(p.get("candidate_id"))
    if not CAN_ID.match(cid):
        return {"status": 400, "message": "invalid candidate_id"}
    ev = CND.evidence(reads, cid)
    c = ev.get("cand")
    if not c:
        return {"status": 404, "message": f'No candidate "{cid}".'}
    stage = CND.stage_of(s_(c.get("status")))
    blocked: list[str] = []
    waiting: list[str] = []
    try:
        sit = allowed(reads, sid(reads, "manual_contact"))
    except Exception:  # noqa: BLE001 - said, never raised
        sit = {"ok": False, "unreadable": True, "reason": "the Smart Comms situations could not be read"}
    if not sit["ok"]:
        blocked.append(idle_why(sit, 'the Smart Comms situation "hiring_first_contact" is OFF — nobody standing at '
                                     "New is spoken to"))
    try:
        guard = outbound_guard(reads)
    except Exception:  # noqa: BLE001 - as Apps Script
        guard = False
    test = test_mode(reads)
    if guard and not test["on"]:
        blocked.append("the fence (sim_outbound_guard) is ON and test mode is OFF — only the configured cast can be "
                       "written to")
    asks = []
    try:
        for r in ask_rows(reads):
            if s_(r.get("candidateid")) != cid:
                continue
            sent = int_of(r.get("sentcount"), 0)
            top = int_of(r.get("maxattempts"), 1)
            mins = int_of(r.get("intervalminutes"), 30)
            last = gsjs.date_parse(s_(r.get("lastsentat")) or s_(r.get("createdat")))
            due = "" if last is None else CND.iso_ms(last + mins * 60000)
            asks.append({"step": s_(r.get("step")), "state": s_(r.get("state")), "sent": sent, "of": top,
                         "every_minutes": mins, "last_sent_at": s_(r.get("lastsentat")), "next_due_at": due})
            if s_(r.get("state")) == "open":
                waiting.append(f'"{s_(r.get("step"))}" is on try {sent} of {top}, next one due '
                               + (due or "as soon as the chain passes"))
    except Exception:  # noqa: BLE001 - said, never raised
        blocked.append("the ask book could not be read — no machine presses blind")
    own = re.sub(r"^1", "", digits(c.get("phone")), count=1)[-10:]
    shared = own in SC.SHARED_LINE_DIGITS
    testers = tester_keys()
    email = s_(c.get("email"))
    gate: dict[str, Any] = {"ok": False, "reasons": []}
    try:
        gate = CND.stage_gate(reads, ev) or gate
    except Exception:  # noqa: BLE001 - the gate is said when it can be read
        pass
    for r in gate.get("reasons") or []:
        waiting.append("to advance: " + s_(r))
    return {"status": 200, "data": {
        "candidate": {"id": cid, "name": s_(c.get("candidatename")), "status": s_(c.get("status")), "stage": stage,
                      "archived": archived(c), "phone": s_(c.get("phone")), "email": email,
                      "origin": manual_origin(c)},
        "the_ladder_may_speak": manual_card_is(c),
        "fences": {"situation_on": bool(sit["ok"]), "outbound_guard": guard, "test_mode": bool(test["on"]),
                   "redirects_to": {"sms": test.get("sms") or [], "email": test.get("emails") or []}},
        "asks": asks,
        "a_reply_counts_from": {"sms": ([own] if own and not shared else []) + testers["digits"],
                                "email": ([email.lower()] if "@" in email else []) + testers["emails"]},
        "gate": {"can_advance": bool(gate.get("ok")), "to": s_(gate.get("to") or ""),
                 "needs": gate.get("reasons") or []},
        "blocked_by": blocked, "waiting_for": waiting}}


def form_token(secret: str, cid: str) -> str:
    """candFormTokenFor_: the id and its HMAC under the interview links' secret, prefixed apart from them."""
    sig = hmac.new(secret.encode("utf-8"), ("candform." + cid).encode("utf-8"), hashlib.sha256).digest()
    return cid + "." + base64.urlsafe_b64encode(sig).decode("ascii").rstrip("=")


def share_link(sess: L.Session, payload: dict) -> dict[str, Any]:
    """candShareLink: the signed link to one candidate's form; the link is the authorisation, so minting it takes a
    writer. The secret is the INTERVIEW_LINK_SECRET Apps Script's public form doors verify it with (the copies
    withhold it: HUB_APP_PROP_INTERVIEW_LINK_SECRET holds it here)."""
    if not writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("candidate_id"))
    if not CAN_ID.match(cid):
        return {"status": 400, "message": "invalid candidate_id"}
    secret = gsjs.or_blank(sess.reads.db.prop("INTERVIEW_LINK_SECRET"))
    if not secret or secret.startswith(WITHHELD):
        return {"status": 409, "message": NO_SECRET}
    if not CND.evidence(sess.reads, cid).get("cand"):
        return {"status": 404, "message": f'No candidate "{cid}".'}
    return {"status": 200, "data": {"url": LINK_BASE + form_token(secret, cid)}}


def _candidate(sess: L.Session, payload: dict, write: str) -> tuple[str, dict | None, dict | None]:
    """The writer's candidate for a prepare, refused as its write would refuse it: (id, its evidence, a refusal)."""
    if not writer(sess.user):
        return "", None, dict(DENIED)
    refused = missing(write, payload)
    if refused:
        return "", None, refused
    cid = s_((payload if isinstance(payload, dict) else {}).get("candidate_id"))
    if not CAN_ID.match(cid):
        return cid, None, {"status": 400, "message": "invalid candidate_id"}
    return cid, CND.evidence(sess.reads, cid), None


def shortlist_ready(reads: L.Reads, p: dict, deadline: float) -> dict[str, Any]:
    """What hiringShortlistSend is sent on: the collection and, off the hiring DB, the model's reading of it."""
    got = winners(reads, p)
    text = reading(reads, got["ranked"], deadline) if got["source"] == "hiring db" else ""
    return {"source": got["source"], "rows": got["rows"], "pool": got["pool"], "reading": text}


def cjis_ready(reads: L.Reads, cid: str, ev: dict | None, fresh: bool = False) -> dict[str, Any]:
    """What hiringCjisRequestSend is sent on: the CJIS folder's file for this person, once the record still owes it;
    an unreadable folder never blocks the ask."""
    c = (ev or {}).get("cand")
    a = (ev or {}).get("analysis") or {}
    out: dict[str, Any] = {"candidate_id": cid, "hit": None, "error": ""}
    if c and not CND.cjis_cleared(a) and s_(a.get("cjisstatus")).lower() != "on file":
        try:
            out.update(cjis_hit(reads, s_(c.get("candidatename")), fresh))
        except Exception as exc:  # noqa: BLE001 - an unreadable folder never blocks the ask
            out["error"] = str(exc)[:200] or type(exc).__name__
    return out


def resume_ready(reads: L.Reads, cid: str, c: dict | None, fresh: bool = False) -> dict[str, Any]:
    """What manualResumeAsk is sent on: the résumé folders' file for this card; a folder that cannot be read finds
    nothing."""
    out: dict[str, Any] = {"candidate_id": cid, "hit": "", "error": ""}
    if c and not archived(c) and stage_of(c.get("status")) == "new" and not s_(c.get("resumelink")):
        try:
            out["hit"] = resume_hit(reads, s_(c.get("candidatename")), fresh)
        except Exception as exc:  # noqa: BLE001 - still missing: the ask names it
            out["error"] = str(exc)[:200] or type(exc).__name__
    return out


def shortlist_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringShortlistPrepare: the shortlist's collection and its reading, sealed for hiringShortlistSend."""
    if not writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    return {"status": 200, "data": R.seal("hiringShortlistSend", R.actor(sess.user),
                                          shortlist_ready(sess.reads, p, time.monotonic() + 60.0))}


def cjis_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringCjisRequestPrepare: the folder first (its index kept 15 minutes, as Apps Script keeps it), sealed for
    hiringCjisRequestSend."""
    cid, ev, refused = _candidate(sess, payload, "hiringCjisRequestSend")
    if refused:
        return refused
    return {"status": 200, "data": R.seal("hiringCjisRequestSend", R.actor(sess.user), cjis_ready(sess.reads, cid, ev))}


def resume_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """manualResumeAskPrepare: the résumé folders read now for this card, sealed for manualResumeAsk."""
    cid, ev, refused = _candidate(sess, payload, "manualResumeAsk")
    if refused:
        return refused
    return {"status": 200, "data": R.seal("manualResumeAsk", R.actor(sess.user),
                                          resume_ready(sess.reads, cid, (ev or {}).get("cand"), fresh=True))}


def reply_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringOutreachReplyPrepare: the provider's copy of the candidate's texts first (quoInboundPull_), sealed for
    hiringOutreachReplyCheck; a provider that does not answer leaves the filed log to answer."""
    cid, ev, refused = _candidate(sess, payload, "hiringOutreachReplyCheck")
    if refused:
        return refused
    c = (ev or {}).get("cand")
    pull: dict[str, Any] = {"pulled": 0, "error": "", "items": [], "line": ""}
    if c:
        try:
            pull = quo_pull(sess.reads, cid, s_(c.get("candidatename")), s_(c.get("phone")))
        except Exception:  # noqa: BLE001 - the tab still answers
            pull["error"] = "provider_unreachable"
    return {"status": 200, "data": R.seal("hiringOutreachReplyCheck", R.actor(sess.user), {"candidate_id": cid,
                                                                                            "pull": pull})}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "hiringWhere": where, "candShareLink": share_link, "hiringShortlistPrepare": shortlist_prepare,
    "hiringCjisRequestPrepare": cjis_prepare, "manualResumeAskPrepare": resume_prepare,
    "hiringOutreachReplyPrepare": reply_prepare}
WRITERS = ("admin", "manager")
POLICY: dict[str, dict[str, Any]] = {
    "hiringWhere": {"roles": WRITERS, "params": {"candidate_id": "string"}},
    "candShareLink": {"roles": WRITERS},
    "hiringShortlistPrepare": {"roles": WRITERS, "params": {"candidate_ids": "array", "exclude_ids": "array",
                                                             "limit": "number", "to": "string"}},
    "hiringCjisRequestPrepare": {"roles": WRITERS, "params": {"candidate_id": "string", "to": "string"}},
    "manualResumeAskPrepare": {"roles": WRITERS, "params": {"candidate_id": "string"}},
    "hiringOutreachReplyPrepare": {"roles": WRITERS, "params": {"candidate_id": "string"}}}
