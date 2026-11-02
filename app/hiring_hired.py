"""Hired (Hired.gs) on Python: the last column's clock — the Hired stay's first pass and its congratulation, the exit to
Ready to start, the Ready watch, the parking notices, the deciders' ready ask and their answer, the finish-your-
onboarding ladder — each a service read the relay's clock asks (`…Due`) before the write that records it
(hiring_hired_writes). The machine helpers the hiring modules share live here too: the simulation's config and its ask
book (HiringSimConfig.gs), the fence, the interviewer by badge (HiringJourney.gs), one send through Smart Comms.
The staff account a graduation makes and the onboarding login are hiring_accounts' (hubHiredGraduate_,
onboardingEnsureUser_)."""
from __future__ import annotations

import json
import logging
import math
import re
import secrets
from datetime import datetime, timezone
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import gsjs
import hubdb
import locations as L
import mail_designs as MD
import recon as R
import smart_comms as SC
import smart_comms_desk as SCD
import team_alerts as TA
import writes as W
from gsjs import NY
from scope import Defer

log = logging.getLogger("asa-hub-app")

APP_ID = "hiring"
s_ = CND.s_
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
SERVICE_ONLY = {"status": 403, "message": "This is the relay's own door."}
CAN_ID = re.compile(r"^CAN_[A-Za-z0-9]{6,}$")
DAY_MS = 86400000.0
# Hired.gs HIRED_SHOWCASE_MS
SHOWCASE_MS = 24 * 3600 * 1000.0
LANE = "hiring"

# HiringSimConfig.gs HIRING_SIM_ASKS_TAB / HEADER, and the shipped floor under every config cell these doors read
SIM_ASKS = CND.HIRING_SIM_ASKS_TAB
SIM_ASKS_HEADER = ("sim_ask_id", "step", "candidate_id", "action", "payload_json", "sent_count", "max_attempts",
                   "interval_minutes", "last_sent_at", "state", "answered_at", "answered_by", "created_at")
SIM_DEFAULTS = {
    "sim_candidate_email": "asa-hub3@asaop.org", "sim_candidate_phone": "+13309195558",
    "sim_interviewer_name": "[TEST] Interviewer", "sim_interviewer_email": "asa-hub4@asaop.org",
    "sim_interviewer_phone": "",
    "sim_cc_emails": "asatech@asalifecare.com, ty.bond@asalifecare.com, arthur.torres@asalifecare.com",
    "sim_watcher_emails": "asatech@asalifecare.com",
    "sim_team_emails": "asatech@asalifecare.com, ty.bond@asalifecare.com, arthur.torres@asalifecare.com",
    "sim_decider_emails": "arthur.torres@asalifecare.com, ty.bond@asalifecare.com",
    "sim_team_sms": "+13309195559, +13309195558, +19377166410, +13309197779",
    "sim_decider_sms": "+13309195559, +19377166410",
    "sim_attempts": "1", "sim_retry_minutes": "30",
    "sim_attempts_interview_days": "7", "sim_retry_minutes_interview_days": "30",
    "sim_attempts_interview_slots": "7", "sim_retry_minutes_interview_slots": "120",
    "sim_attempts_onboarding_finish": "7", "sim_retry_minutes_onboarding_finish": "120",
    "sim_attempts_packet_request": "7", "sim_retry_minutes_packet_request": "1440",
    "sim_attempts_ready_ask": "7", "sim_retry_minutes_ready_ask": "1440",
    "sim_attempts_ready_parked": "4", "sim_retry_minutes_ready_parked": "10080",
    "sim_test_candidate_ids": "", "sim_quo_identify": "yes",
    "sim_quo_intro": "ASA LifeCare hiring (asa-hub platform) — {purpose}. ",
    "sim_outbound_guard": "on", "sim_subject_tag": "[TEST] ",
}
# Comms.gs COMMS_OPERATOR_TEST_LINE / COMMS_OPERATOR_TEST_EMAIL
OPERATOR_TEST_LINE, OPERATOR_TEST_EMAIL = "3309195558", "asatech@asalifecare.com"
# Hired.gs: the situations each lane speaks through (commSituationId_'s keys and shipped ids)
CONGRATS = ("hiring.hired.congratulations", "hiring_hired_congrats")
READY_DONE = ("hiring.ready.notification", "hiring_ready_to_start")
FINISH = ("hiring.onboarding.finish_request", "hiring_onboarding_finish")
STALLED = ("hiring.onboarding.stalled", "hiring_onboarding_stalled")
PARKED, READY_ASK = "hiring_ready_parked", "hiring_ready_ask"
FINISH_PER_PASS = 5
PARKED_PER_PASS = 10
# the marks Apps Script kept in Script Properties (db/hiring_hired.sql)
MARKS = "app.hiring_marks"
PARKED_ARMED = "READY_PARKED_ARMED_AT"


def service(sess: L.Session) -> bool:
    return (sess.user or {}).get("is_service") is True


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and s_((user or {}).get("role")) in ("admin", "manager")


def now_ms(reads: L.Reads) -> float:
    return CND.now_ms(reads)


def iso_ms(ms: float) -> str:
    return CND.iso_ms(ms)


def ms_of(v: Any) -> float | None:
    """new Date(str_(v)).getTime(), None for NaN."""
    return CND.js_date_ms(v) if s_(v) else None


def as_actor(sess: L.Session, email: str) -> L.Session:
    """The session a machine writer acts as (hubSetStatus_'s { email: … })."""
    return L.Session(sess.reads, {**(sess.user or {}), "email": email})


def cands(reads: L.Reads) -> list[dict]:
    return CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB)


def archived(c: dict) -> bool:
    return s_(c.get("archived")).lower() == "true"


def greet_first(name: Any) -> str:
    """hiringGreetFirst_."""
    n = re.sub(r"^\s*\[test\]\s*", "", s_(name), flags=re.I).strip()
    return (re.split(r"[\s,]+", n)[0] if n else "") or n


def render(tpl: Any, vars_: dict[str, Any]) -> str:
    """hiringRenderMail_ / hubLetterRender_: a {key} the vars carry, else left as written."""
    return re.sub(r"\{(\w+)\}", lambda m: s_(vars_[m.group(1)]) if m.group(1) in vars_ else m.group(0), s_(tpl))


def words(reads: L.Reads, key: str, floor: str = "") -> str:
    """bookText_('Strings', key, floor); a book not in the copy is the floor."""
    got, why = CND.soft(lambda: CND.book_text(reads, "Strings", key, floor))
    return floor if why else got


def word_list(reads: L.Reads, key: str) -> list[str]:
    """bookWordList_."""
    return [x.strip() for x in re.split(r"[,;\n]+", words(reads, key)) if x.strip()]


def words_regex(reads: L.Reads, key: str, shape: str) -> re.Pattern | None:
    """bookWordsRegex_."""
    parts = [re.escape(w) for w in word_list(reads, key)]
    if not parts:
        return None
    body = "(" + "|".join(parts) + ")"
    try:
        return re.compile(("^" + body + r"\b") if shape == "start" else (r"\b" + body + r"\b"), re.I)
    except re.error:
        return None


# ---- the situations ------------------------------------------------------------------------------------------------

def situations(reads: L.Reads) -> list[dict]:
    return reads.once("hh:situations", lambda: SC.read_situations(reads.db))


def sit_id(reads: L.Reads, pair: tuple[str, str]) -> str:
    """commSituationId_."""
    got, why = CND.soft(lambda: MD.situation_id(reads, situations(reads), pair[0], pair[1]))
    return pair[1] if why or not got else got


def situation_on(reads: L.Reads, sid: str) -> dict | None:
    """smartSituationOn_: the row while it is on; unreadable is off."""
    rows, why = CND.soft(lambda: situations(reads))
    if why:
        return None
    row = SC.situation_row(rows or [], sid)
    return row if row is not None and SC.smart_on(row.get("enabled")) else None


class Lane:
    """hubLaneSituation_: {on, why, row, word(field, floor, vars), leg(channel)}."""

    def __init__(self, reads: L.Reads, sid: str) -> None:
        self.id = sid
        rows, why = CND.soft(lambda: situations(reads))
        row = None if why else SC.situation_row(rows or [], sid)
        self.row = row
        self.on = bool(row) and SC.smart_on(row.get("enabled"))
        self.why = ("the situations tab could not be read — " + sid + " is held, not sent" if why else
                    "the situation " + sid + " is not in the situations tab yet — nothing was sent" if row is None else
                    "the situation " + sid + " is switched off in Smart Comms — nothing was sent" if not self.on else "")
        self._chans = SC.smart_list(row.get("channels")) if row and s_(row.get("channels")) else None

    def word(self, field: str, floor: str, vars_: dict[str, Any]) -> str:
        cell = s_((self.row or {}).get(field))
        return render(cell, vars_) if cell else floor

    def leg(self, channel: str) -> bool:
        return self._chans is None or channel in self._chans


# ---- the simulation's config and its ask book (HiringSimConfig.gs) --------------------------------------------------

def sim_cfg(reads: L.Reads) -> dict[str, str]:
    """hiringSimCfg_: key → value. The copy withholds the tab's key column, so each key is its row's subject."""
    def read() -> dict[str, str]:
        rows: dict[str, dict[str, str]] = {}
        prefix = "dissolution:hiring_sim_config."
        for sub, val, src in CND.facts(reads, prefix):
            if sub and src.startswith(prefix):
                rows.setdefault(sub, {})[src[len(prefix):]] = s_(val)
        return {k: r.get("value", "") for k, r in rows.items() if r.get("__deleted", "").lower() != "true"}
    got, why = CND.soft(lambda: reads.once("hh:sim_cfg", read))
    return {} if why else got


def sim_val(reads: L.Reads, key: str) -> str:
    """simCfgVal_: the cell, else the shipped floor."""
    return s_(sim_cfg(reads).get(key)) or SIM_DEFAULTS.get(key, "")


def sim_list(reads: L.Reads, key: str) -> list[str]:
    """simCfgList_."""
    return [x.strip() for x in re.split(r"[,;\n]+", sim_val(reads, key)) if x.strip()]


def sim_text(reads: L.Reads, key: str) -> str:
    """simText_ for a key no situation row owns: the config cell, else the book's shipped words."""
    return s_(sim_cfg(reads).get("sim_text_" + key)) or words(reads, "sim.text." + key)


def attempts_for(reads: L.Reads, step: str) -> dict[str, int]:
    """simAttemptsFor_: the step's own cell, then the global; the interval at least five minutes."""
    def n(key: str) -> float:
        return CND.js_parse_int(sim_val(reads, key))
    per, every = n("sim_attempts_" + step), n("sim_attempts")
    per_min, minutes = n("sim_retry_minutes_" + step), n("sim_retry_minutes")
    attempts = int(per) if not math.isnan(per) and per > 0 else (int(every) if not math.isnan(every) and every > 0
                                                                  else 1)
    mins = int(per_min) if not math.isnan(per_min) and per_min >= 5 else (
        int(minutes) if not math.isnan(minutes) and minutes >= 5 else 30)
    return {"attempts": min(attempts, 50), "minutes": mins}


def sim_rows(reads: L.Reads) -> list[dict]:
    """simAskRows_; an unreadable book is never read as an empty one (nobody is asked twice off it)."""
    return CND.read_tab(reads, SIM_ASKS)


def _int(v: Any) -> int:
    n = CND.js_parse_int(v)
    return 0 if math.isnan(n) else int(n)


def ladder_due(reads: L.Reads, step: str, cid: str) -> dict[str, Any]:
    """simLadderDue_: is this rung due, and has it run out?"""
    cfg = attempts_for(reads, step)
    row = None
    for r in sim_rows(reads):
        if s_(r.get("step")) == step and s_(r.get("candidateid")) == cid:
            row = r
    if row is None:
        return {"due": True, "sent": 0, "of": cfg["attempts"], "why": "never asked"}
    sent = _int(row.get("sentcount"))
    top = _int(row.get("maxattempts")) or cfg["attempts"]
    if s_(row.get("state")) == "answered":
        return {"due": False, "sent": sent, "of": top, "why": "they answered"}
    if sent >= top:
        return {"due": False, "sent": sent, "of": top, "why": f"the asking ended — {sent} of {top}"}
    mins = _int(row.get("intervalminutes")) or cfg["minutes"]
    last = ms_of(s_(row.get("lastsentat")) or s_(row.get("createdat")))
    if last is not None and now_ms(reads) - last < mins * 60000:
        return {"due": False, "sent": sent, "of": top, "why": f"not yet — one every {mins} minutes"}
    return {"due": True, "sent": sent, "of": top, "why": "due"}


def sim_track(reads: L.Reads, step: str, cid: str, action: str, payload: dict, now: str) -> list[dict]:
    """simTrackSend_: the open row of this step and card bumped, else a new one — the book's facts."""
    cfg = attempts_for(reads, step)
    for r in reversed(sim_rows(reads)):
        if s_(r.get("step")) != step or s_(r.get("candidateid")) != cid:
            continue
        if s_(r.get("state")) != "open":
            break
        return CW.facts_of(reads, SIM_ASKS, s_(r.get("simaskid")),
                           {"sent_count": str(_int(r.get("sentcount")) + 1), "last_sent_at": now}, "asa-hub:sim", cid,
                           "", at=now)
    sid = "SIMASK_" + secrets.token_hex(4).upper()
    row = {"sim_ask_id": sid, "step": step, "candidate_id": cid, "action": action,
           "payload_json": json.dumps(payload or {}, separators=(",", ":"))[:4000], "sent_count": "1",
           "max_attempts": str(cfg["attempts"]), "interval_minutes": str(cfg["minutes"]), "last_sent_at": now,
           "state": "open", "answered_at": "", "answered_by": "", "created_at": now}
    return CW.facts_of(reads, SIM_ASKS, sid, row, "asa-hub:sim", cid, "", at=now)


def sim_answer(reads: L.Reads, steps: tuple[str, ...] | list[str], by: str, cid: str, now: str) -> list[dict]:
    """simAskAnswer_: the open (or exhausted) asks of these steps closed — a reply arrived."""
    out: list[dict] = []
    for r in sim_rows(reads):
        if s_(r.get("state")) not in ("open", "exhausted") or s_(r.get("step")) not in steps:
            continue
        if cid and s_(r.get("candidateid")) and s_(r.get("candidateid")) != cid:
            continue
        out += CW.facts_of(reads, SIM_ASKS, s_(r.get("simaskid")),
                           {"state": "answered", "answered_at": now, "answered_by": s_(by)[:120]}, "asa-hub:sim",
                           s_(r.get("candidateid")), "", at=now)
    return out


# ---- the cast, the fence and the rehearsal (HiringSimConfig.gs, Packet.gs) -------------------------------------------

def test_on(reads: L.Reads) -> bool:
    """hubTestModeState_().on: the dial at any on or sheet word, a blank one with a tester listed, an unknown word."""
    cfg, why = CND.soft(reads.config)
    if why:
        return True
    raw = s_(cfg.get("test_mode")).strip().lower()
    if raw in SC.TEST_ON or raw in SC.TEST_SHEET:
        return True
    if raw in SC.TEST_OFF:
        return False
    if not raw:
        listed = [x for x in re.split(r"[,;\n]+", s_(cfg.get("test_redirect_sms")) + "," +
                                      s_(cfg.get("test_redirect_email"))) if x.strip()]
        return bool(listed)
    return True


def guard_on(reads: L.Reads) -> bool:
    """simOutboundGuard_."""
    return sim_val(reads, "sim_outbound_guard").lower() != "off"


def in_cast(reads: L.Reads, d: str) -> bool:
    """simOutboundOneAllowed_."""
    d = s_(d).strip().lower()
    if not d:
        return True
    if "@" in d:
        if re.fullmatch(r"asa-hub[0-9]*@asaop\.org", d):
            return True
        for key in ("sim_candidate_email", "sim_interviewer_email", "sim_cc_emails", "sim_watcher_emails",
                    "sim_team_emails", "sim_decider_emails"):
            if any(a.lower() == d for a in sim_list(reads, key)):
                return True
        return False
    digits = re.sub(r"[^0-9]", "", d)
    if not digits:
        return False
    nums = sim_list(reads, "sim_team_sms") + [sim_val(reads, "sim_candidate_phone"),
                                              sim_val(reads, "sim_interviewer_phone")]
    for n in nums:
        nd = re.sub(r"[^0-9]", "", s_(n))
        if nd and (nd == digits or "1" + nd == digits or nd == "1" + digits):
            return True
    return False


def fence(reads: L.Reads, dest: str) -> dict[str, Any]:
    """simOutboundAllowed_: every part of a destination on the cast while the guard is on (test mode keeps no
    testers to carry it, hubTestRedirect_)."""
    if not guard_on(reads):
        return {"ok": True}
    on = test_on(reads)
    for part in [p.strip() for p in re.split(r"[,;\n]+", s_(dest)) if p.strip()]:
        if in_cast(reads, part):
            continue
        mail = "@" in part
        return {"ok": False, "reason": "outside_address_blocked" if mail else "outside_number_blocked",
                "detail": part + " is not on the cast — the fence (sim_outbound_guard) refuses every " +
                          ("address" if mail else "number") + " outside the configured team and actors" +
                          (", and test mode has no tester listed for " + ("e-mail" if mail else "SMS") +
                           " to redirect it to" if on else
                           ", test mode being off — switch test mode on and the rehearsal reaches the testers instead "
                           "of being refused")}
    return {"ok": True}


def sendable_phone(reads: L.Reads, raw: Any) -> str:
    """simSendablePhone_: a number we may text, or one of the cast's own shared lines while the fence is on."""
    to = SC.sendable(raw)
    if to:
        return to
    d = re.sub(r"^1", "", re.sub(r"[^0-9]", "", s_(raw)), count=1)
    if len(d) != 10:
        return ""
    return "+1" + d if guard_on(reads) and in_cast(reads, "+1" + d) else ""


def tag_subject(reads: L.Reads, subject: str) -> str:
    """simTagSubject_: the rehearsal tag on a title, quiet while test mode is on."""
    s = s_(subject)
    tag = sim_val(reads, "sim_subject_tag")
    if not tag or test_on(reads):
        return s
    if s.startswith(tag) or s.startswith("[TEST]"):
        return s
    return tag + ("" if re.search(r"\s$", tag) else " ") + s


def quo_intro(reads: L.Reads, purpose: str) -> str:
    """simQuoIntro_."""
    if sim_val(reads, "sim_quo_identify").lower() != "yes":
        return ""
    tpl = sim_val(reads, "sim_quo_intro") or "ASA LifeCare hiring (asa-hub platform) — {purpose}. "
    return tpl.replace("{purpose}", s_(purpose) or "about your hiring process")


def actors(reads: L.Reads) -> dict[str, Any]:
    """hiringSimActors_, the parts these doors read."""
    team = sim_list(reads, "sim_team_emails")
    if not team:
        team = team_emails(reads)
    deciders = [x for x in sim_list(reads, "sim_decider_emails") if "@" in x] or team[:2]
    return {"interviewer_name": sim_val(reads, "sim_interviewer_name"),
            "interviewer_email": sim_val(reads, "sim_interviewer_email"),
            "interviewer_phone": sendable_phone(reads, sim_val(reads, "sim_interviewer_phone")),
            "cc_emails": [x for x in sim_list(reads, "sim_cc_emails") if "@" in x],
            "watcher_emails": [x for x in sim_list(reads, "sim_watcher_emails") if "@" in x],
            "team_emails": team, "decider_emails": deciders,
            "decider_sms": [n for n in (sendable_phone(reads, x) for x in sim_list(reads, "sim_decider_sms")) if n]}


def cc_for(reads: L.Reads, to: str) -> str:
    """simCcFor_: the copy list, nobody already addressed."""
    have = {x.strip().lower() for x in re.split(r"[,;\n]+", s_(to)) if x.strip()}
    return ", ".join(x for x in actors(reads)["cc_emails"] if x.lower() not in have)


def team_address(reads: L.Reads) -> dict[str, str]:
    """simTeamAddress_: the deciders, the watchers in copy."""
    a = actors(reads)
    have = {x.lower() for x in a["decider_emails"]}
    return {"to": ", ".join(a["decider_emails"]),
            "cc": ", ".join(x for x in a["watcher_emails"] if x.lower() not in have)}


def team_emails(reads: L.Reads) -> list[str]:
    """hiringTeamRecipients_().emails."""
    import interviews_writes as IW  # noqa: PLC0415 - the hiring team as the scorecard reads it
    got, why = CND.soft(lambda: IW.team_emails(reads))
    return [] if why else got


def is_test(reads: L.Reads, c: dict | None) -> bool:
    """commsIsTestCandidate_, the configured list read by its rows' subjects."""
    if not c:
        return False
    if TA.test_card(reads, c):
        return True
    return s_(c.get("candidateid")) in sim_list(reads, "sim_test_candidate_ids")


def is_rehearsal(reads: L.Reads, c: dict | None) -> bool:
    """packetIsRehearsal_."""
    if not c:
        return False
    if is_test(reads, c):
        return True
    if s_(c.get("candidatename")).lower().startswith("[test]"):
        return True
    if re.sub(r"\D", "", s_(c.get("phone")))[-10:] == OPERATOR_TEST_LINE:
        return True
    return s_(c.get("email")).lower() == OPERATOR_TEST_EMAIL


# ---- one send through Smart Comms, and the hiring outreach's two transports (HiringOutreach.gs) --------------------

def send(reads: L.Reads, *, situation: str, to: str, body: str, key: str, channel: str = "sms", subject: str = "",
         html: str = "", cc: str = "", person: str = "", withhold: list[str] | None = None) -> dict[str, Any]:
    """rpcCall_('smsSend' | 'emailSend') for a lane that wrote its words whole: through Smart Comms' one send door,
    every brake deciding; {state, held, why}."""
    return SC.raise_situation(None, situation=situation, to=to, vars={}, key=key, person=person, lane=LANE,
                              at_ms=int(reads.now.timestamp() * 1000), prune=False, channel=channel, body=body,
                              subject=subject if channel == "email" else None, html=html or None, cc=cc or None,
                              transport=True, withhold=withhold)


def went(got: dict | None) -> bool:
    """res.ok && res.sent — or the same request already went."""
    return s_((got or {}).get("state")) in ("sent", "already")


def rehearsed(got: dict | None) -> bool:
    """res.redirected: test mode wrote it down for the testers, nobody contacted."""
    return s_((got or {}).get("state")) == "held" and s_((got or {}).get("held")) == "test_mode"


def why_not(got: dict | None) -> str:
    g = got or {}
    return s_(g.get("held")) or s_(g.get("state")) or "send_failed"


def holding(reads: L.Reads, prefixes: list[str], claimed: bool = True) -> set[str]:
    """The prefixes whose message Smart Comms already holds: claimed (owed, sending, sent — unless `claimed` is
    False), refused, deduplicated, or held by a brake that still holds — so a rehearsal or a held text is never asked
    for again each ring. A look outside a write reads a held one as released; the write decides on the brakes."""
    import resource_rows as RR  # noqa: PLC0415 - the write's own cursor inside a write
    want = [p for p in prefixes if p]
    if not want:
        return set()
    likes = [re.sub(r"([\\%_])", r"\\\1", p) + "%" for p in want]
    got = RR._q(reads, f"select idem_key, state, held_by from {SC.OUTBOX} where idem_key like any(%s)", (likes,))
    cur = W.HELD.get()
    b = SC.brakes(reads.db, cur) if cur is not None else {"hold": False, "sending": True}
    out: set[str] = set()
    for key, state, held_by in got:
        st, hb = s_(state), s_(held_by)
        if (claimed and (st in SC.CLAIMS or st in ("refused", "already"))) or (st == "held" and (
                (hb == "test_mode" and b["hold"]) or (hb != "test_mode" and not b["sending"]) or hb == "recorded")):
            out.update(p for p in want if s_(key).startswith(p))
    return out


def journey(reads: L.Reads, cid: str, name: str, line: dict[str, Any]) -> list[dict]:
    """journeyLog_."""
    return CW.journey_records(reads, {"key": cid, "name": name}, line, "")[2]


def card_facts(reads: L.Reads, cid: str, fields: dict[str, Any], by: str, now: str) -> list[dict]:
    """hubSetFieldLastRow_ on the candidate's card: one fact per field."""
    return CW.facts_of(reads, CW.CANDIDATES, cid, fields, by, cid, "", at=now)


def move(sess: L.Session, cid: str, cand: dict, to: str, by: str, now: str) -> list[dict]:
    """hubSetStatus_ to a stage that mints no login, as `by`: the status, its history row, and the calendar's
    completion when the card leaves Onboarding."""
    import candidate_papers as CP  # noqa: PLC0415 - the onboarding calendar note every move out of Onboarding writes
    CW.marked(cand.get("status"), cand.get("candidatename"))
    recs = CW.status_move(as_actor(sess, by), cid, cand, to, "", now)
    if CND.stage_of(cand.get("status")) == "onboarding" and to != "onboarding":
        recs += CP.calendar_note(sess.reads, cid, s_(cand.get("candidatename")), now, False)
    return recs


def outreach_send(reads: L.Reads, o: dict[str, Any]) -> tuple[dict[str, Any], list[dict]]:
    """outreachSend_: one letter, fenced, tagged, recorded on the journey whatever came of it."""
    letter = o.get("letter") or {}
    to, cc = s_(o.get("to")), s_(o.get("cc"))
    subject = tag_subject(reads, s_(letter.get("subject")))
    out = {"step": s_(o.get("step")), "channel": "email", "to": to, "cc": cc, "subject": subject, "sent": False,
           "redirected": False, "rehearsal": False, "error": "", "detail": ""}
    base = {"step": o.get("step"), "channel": "email", "by": o.get("by")}
    if not to:
        out.update(error="no_recipient", detail="nobody to write to — the address list resolved empty")
        return out, journey(reads, o["candidate_id"], s_(o.get("name")), {**base, "to": "", "ok": False,
                                                                           "detail": out["detail"]})
    f = fence(reads, to + ("," + cc if cc else ""))
    if not f["ok"]:
        out.update(error=f["reason"], detail=f["detail"])
        return out, journey(reads, o["candidate_id"], s_(o.get("name")), {**base, "to": to, "ok": False,
                                                                           "detail": "BLOCKED — " + f["detail"]})
    got = send(reads, situation=o["situation"], to=to, body=s_(letter.get("text")), key=o["key"], channel="email",
               subject=subject, html=s_(letter.get("html")), cc=cc, person=s_(o.get("name")))
    out["sent"] = went(got)
    out["redirected"] = out["rehearsal"] = rehearsed(got)
    out["error"] = "" if out["sent"] else why_not(got)
    out["detail"] = s_(got.get("why"))
    detail = (("sent" if out["sent"] else "not sent") + (" — " + out["error"] if out["error"] else "") +
              (": " + out["detail"] if out["detail"] else "") + " · subject: " + subject +
              (" · cc: " + cc if cc and out["sent"] and not out["redirected"] else ""))
    return out, journey(reads, o["candidate_id"], s_(o.get("name")),
                        {**base, "to": to, "ok": out["sent"], "rehearsal": out["redirected"], "detail": detail,
                         "ref": s_(o.get("ref"))})


def outreach_sms(reads: L.Reads, o: dict[str, Any]) -> tuple[dict[str, Any], list[dict]]:
    """outreachSms_: one text, fenced, recorded on the journey whatever came of it."""
    to = sendable_phone(reads, o.get("to"))
    body = s_(o.get("body"))
    if s_(o.get("intro")):
        body = re.sub(r"\s*$", " ", s_(o.get("intro")), count=1) + body
    out = {"step": s_(o.get("step")), "channel": "sms", "to": to, "sent": False, "redirected": False,
           "rehearsal": False, "error": "", "detail": "", "body": body}
    base = {"step": o.get("step"), "channel": "sms", "by": o.get("by")}
    if not to:
        out.update(error="no_phone", detail="no sendable number on the row — an unsendable number is not a silent skip")
        return out, journey(reads, o["candidate_id"], s_(o.get("name")), {**base, "to": s_(o.get("to")), "ok": False,
                                                                           "detail": out["detail"]})
    f = fence(reads, to)
    if not f["ok"]:
        out.update(error=f["reason"], detail=f["detail"])
        return out, journey(reads, o["candidate_id"], s_(o.get("name")), {**base, "to": to, "ok": False,
                                                                           "detail": "BLOCKED — " + f["detail"]})
    got = send(reads, situation=o["situation"], to=to, body=body, key=o["key"], person=s_(o.get("name")))
    out["sent"] = went(got)
    out["redirected"] = out["rehearsal"] = rehearsed(got)
    out["error"] = "" if out["sent"] else why_not(got)
    out["detail"] = s_(got.get("why"))
    detail = (("sent" if out["sent"] else "not sent") + (" — " + out["error"] if out["error"] else "") +
              (": " + out["detail"] if out["detail"] else ""))
    return out, journey(reads, o["candidate_id"], s_(o.get("name")),
                        {**base, "to": to, "ok": out["sent"], "rehearsal": out["redirected"], "detail": detail,
                         "ref": s_(o.get("ref"))})


def letter_html(reads: L.Reads, body_text: str, prefix: str, eyebrow: str = "ASA LifeCare",
                cta: dict | None = None, blocks: list[str] | None = None) -> str:
    """mailShell_ over a body's paragraphs, with the book's title, preheader and footnote under `prefix`."""
    paras = blocks if blocks is not None else [MD.mail_para(MD.mail_esc(p).replace("\n", "<br>"))
                                               for p in re.split(r"\n{2,}", body_text)]
    return MD.mail_shell({"eyebrow": eyebrow, "title": words(reads, prefix + ".title"),
                          "preheader": words(reads, prefix + ".preheader"), "blocks": paras, "cta": cta,
                          "footnote": words(reads, prefix + ".footnote")})


def tell_team(reads: L.Reads, situation: str, key: str, subject: str, sms: str, mail: str, html: str) -> dict[str, Any]:
    """hubTeamAlert_ through hubTeamNotify_: a text to each number of the team list, a letter to each address with
    the whole distribution named — {done, state, why}."""
    team = SCD.team_recipients(reads, reads.config())
    if not team["readable"]:
        return {"done": False, "state": "failed", "why": "the team list could not be read"}
    numbers, emails = team["sms"], team["emails"]
    footer = TA.FOOTER + ", ".join(emails) + (" — SMS to: " + ", ".join(numbers) if numbers else "") + ")"
    states: list[tuple[str, str, str]] = []
    at_ms = int(reads.now.timestamp() * 1000)
    for n in numbers:
        got = SC.raise_situation(None, situation=situation, to=n, vars={}, key=key + "|sms|" + SCD.digits(n)[-10:],
                                 lane="smart comms", at_ms=at_ms, prune=False, team="group", body=sms)
        states.append((s_(got.get("state")), s_(got.get("held")), s_(got.get("why"))))
    for e in emails:
        got = SC.raise_situation(None, situation=situation, to=e, vars={}, key=key + "|email|" + e.lower(),
                                 lane="smart comms", at_ms=at_ms, prune=False, channel="email", body=mail + footer,
                                 subject=subject, html=html or None)
        states.append((s_(got.get("state")), s_(got.get("held")), s_(got.get("why"))))
    if not states:
        return {"done": False, "state": "failed", "why": "nobody is on the team list"}
    if any(st in ("sent", "already") for st, _h, _w in states):
        return {"done": True, "state": "told", "why": ""}
    for word, test in (("quiet", lambda st, h: h == "quiet"), ("held", lambda st, h: st in ("held", "refused"))):
        if any(test(st, h) for st, h, _w in states):
            return {"done": False, "state": word, "why": next((w for st, h, w in states if test(st, h)), "")}
    if all(st == "off" for st, _h, _w in states):
        return {"done": False, "state": "off", "why": states[0][2]}
    return {"done": False, "state": "failed", "why": "; ".join(dict.fromkeys(w for _st, _h, w in states if w))[:300]}


# ---- who interviews (HiringJourney.gs) ------------------------------------------------------------------------------

def interviewers(reads: L.Reads) -> list[dict[str, str]]:
    """hiringInterviewersByBadge_: the active accounts with the interviewer role or the INTERVIEWER badge."""
    out = []
    for u in reads.users():
        if s_(u.get("mergedinto")) or s_(u.get("active")).lower() != "true":
            continue
        role = s_(u.get("role")).lower()
        if role != "interviewer" and "INTERVIEWER" not in [t.strip() for t in re.split(r"[,;|]+",
                                                                                      s_(u.get("types")).upper())]:
            continue
        phone = s_(u.get("phone"))
        if not phone:
            try:
                got = json.loads(s_(u.get("phones")) or "[]")
                phone = s_((got[0] or {}).get("number")) if isinstance(got, list) and got and isinstance(got[0], dict) \
                    else ""
            except ValueError:
                phone = ""
        out.append({"user_id": s_(u.get("userid")), "name": s_(u.get("displayname")), "email": s_(u.get("email")),
                    "phone": SC.sendable(phone), "role": role, "types": s_(u.get("types"))})
    return out


def interviewer_pick(reads: L.Reads, prefer: str = "") -> dict[str, str]:
    """hiringInterviewerPick_: the badge holder the config names, else the first one with an address."""
    every, why = CND.soft(lambda: interviewers(reads))
    every = [] if why else every
    if not every:
        return {"name": "", "email": "", "phone": "", "user_id": "", "by": "nobody holds the INTERVIEWER badge"}
    want = s_(prefer)
    if not want:
        cfg, _w = CND.soft(reads.config)
        want = s_((cfg or {}).get("interview_supervisor_name"))
    override = ""
    m = re.search(r"[+\d][\d\s().-]{9,}", want)
    if m:
        override = SC.sendable(m.group(0))
        want = want.replace(m.group(0), "")
    want = re.sub(r"[,;]+\s*$", "", want).strip()
    picked = next((p for p in every if want and p["name"] and p["name"].lower() == want.lower()), None)
    by = "named in interview_supervisor_name and holds the badge"
    if picked is None:
        picked = next((p for p in every if p["email"]), None) or every[0]
        by = (f'"{want}" does not hold the INTERVIEWER badge — asked the badge holder instead' if want
              else "holds the INTERVIEWER badge")
    return {"name": picked["name"], "email": picked["email"], "phone": override or picked["phone"],
            "user_id": picked["user_id"], "by": by}


# ---- the marks Apps Script kept in its properties ---------------------------------------------------------------

def mark(reads: L.Reads, key: str) -> str:
    """One mark (db/hiring_hired.sql), '' when none — the copy's Script Property until Python keeps its own."""
    sql = f"select value from {MARKS} where key = %s"
    cur = W.HELD.get()
    try:
        if cur is None:
            got = reads.db.query(sql, (key,))
        else:
            # a savepoint: a table not made yet never aborts the write's transaction
            with SC._guard(cur):
                cur.execute(sql, (key,))
                got = list(cur.fetchall())
    except Exception as exc:  # noqa: BLE001 - a table not made yet holds no mark
        log.info("hiring: the mark %s could not be read (%s)", key, type(exc).__name__)
        got = []
    if got and s_(got[0][0]):
        return s_(got[0][0])
    v = s_(reads.db.prop(key))
    return "" if v.startswith("[withheld") else v


def mark_set(key: str, value: str) -> None:
    """The mark kept under the write's lock."""
    import resource_rows as RR  # noqa: PLC0415 - the write's own cursor
    RR._cur().execute(f"insert into {MARKS} (key, value, updated_at) values (%s, %s, now()) on conflict (key) do update"
                      " set value = excluded.value, updated_at = now()", (key, value))


# ---- the plans the clock reads and its writes carry out ---------------------------------------------------------

def hired_facts(reads: L.Reads, c: dict) -> dict[str, Any]:
    """hubHiredFacts_: what is still owed at Hired (the questionnaire and tutorials, unless attested by hand)."""
    ob = CND.onboarding_done(reads, c)
    manual = ob.get("how") == "manual"
    missing: list[str] = []
    if not manual:
        if not ob.get("q"):
            missing.append("New Hire Questionnaire — not completed")
        if not ob.get("t"):
            missing.append("New Hire Tutorials — not completed")
    return {"missing": missing, "manual": manual}


def hired_stay_plan(reads: L.Reads) -> dict[str, Any]:
    """hubHiredSweep_'s look: the cards at Hired with no clock yet (first pass), and those whose day ran out (the
    graduation, hiring_accounts': it makes the staff account)."""
    first, graduating = [], []
    now = now_ms(reads)
    for c in cands(reads):
        cid = s_(c.get("candidateid"))
        if not cid or cid in CW.EXCLUDE_IDS or archived(c) or CND.stage_of(c.get("status")) != "hired":
            continue
        stamp = ms_of(c.get("hiredcompleteat"))
        if s_(c.get("hiredcompleteat")) and stamp is not None:
            if now - stamp >= SHOWCASE_MS:
                graduating.append(cid)
            continue
        first.append(cid)
    return {"first": first, "graduating": graduating}


def becoming_plan(reads: L.Reads) -> dict[str, Any]:
    """hubBecomingStaffSweep_'s look: the graduated cards that are staff now, and those still waiting."""
    ready, waiting = [], 0
    for c in cands(reads):
        cid = s_(c.get("candidateid"))
        if not cid or archived(c) or CND.stage_of(c.get("status")) != "hired" or not s_(c.get("hiredcompleteat")):
            continue
        if not CND.becoming_staff_done(reads, c)["done"]:
            waiting += 1
        elif not holding(reads, ["ready_to_start|" + cid + "|"], claimed=False):
            ready.append(cid)
    return {"ready": ready, "waiting": waiting}


def shift_names(reads: L.Reads) -> dict[str, str] | None:
    """readyToStartSweepMaybe_'s board: name key → the name on a shift card; None when the board cannot be read."""
    rows, why = CND.soft(lambda: CND.read_tab(reads, "shiftCards"))
    if why:
        return None
    out: dict[str, str] = {}
    for r in rows or []:
        n = s_(r.get("personname")) or s_(r.get("staffname")) or s_(r.get("staff")) or s_(r.get("name"))
        k = re.sub(r"[^a-z]", "", n.lower())
        if k:
            out[k] = n
    return out


def ready_key(name: Any) -> str:
    return re.sub(r"[^a-z]", "", re.sub(r"^\s*\[test\]\s*", "", s_(name), flags=re.I).lower())


def ready_watch_plan(reads: L.Reads) -> dict[str, Any]:
    """readyToStartSweepMaybe_'s look: who at Ready to start is already on the Shift Board."""
    ready = [c for c in cands(reads) if not archived(c) and CND.stage_of(c.get("status")) == "ready"]
    if not ready:
        return {"found": []}
    board = shift_names(reads)
    if board is None:
        return {"found": [], "unreadable": True}
    found = []
    for c in ready:
        if is_test(reads, c):
            continue
        k = ready_key(c.get("candidatename"))
        if k and k in board:
            found.append({"cid": s_(c.get("candidateid")), "on_board": board[k]})
    return {"found": found}


def parked_plan(reads: L.Reads) -> dict[str, Any]:
    """readyParkedSweepMaybe_'s look: who stood at Ready to start past the clock, and the asks whose card left."""
    lane = Lane(reads, PARKED)
    if not lane.on:
        return {"on": False, "due": [], "closing": [], "why": lane.why}
    cfg = attempts_for(reads, "ready_parked")
    length = max(5, cfg["minutes"]) * 60000
    book: dict[str, dict] = {}
    for a in sim_rows(reads):
        if s_(a.get("step")) == "ready_parked" and s_(a.get("candidateid")):
            book[s_(a.get("candidateid"))] = a
    armed_at = mark(reads, PARKED_ARMED)
    arrivals = CND._stage_arrivals(reads)
    standing: set[str] = set()
    due = []
    now = now_ms(reads)
    for c in cands(reads):
        cid = s_(c.get("candidateid"))
        if not cid or archived(c) or CND.stage_of(c.get("status")) != "ready":
            continue
        standing.add(cid)
        since = s_((arrivals.get(cid) or {}).get("ready"))
        if not armed_at or not since or since < armed_at:
            continue
        ask = book.get(cid)
        if ask is not None and s_(ask.get("createdat")) < since:
            ask = None
        if ask is not None and s_(ask.get("state")) != "open":
            continue
        sent = _int(ask.get("sentcount")) if ask else 0
        if sent >= cfg["attempts"]:
            continue
        frm = ms_of(s_((ask or {}).get("lastsentat")) or since)
        if frm is None or now - frm < length:
            continue
        due.append({"cid": cid, "since": since, "sent": sent})
    closing = [cid for cid, a in book.items() if cid not in standing and s_(a.get("state")) == "open"]
    return {"on": True, "armed_at": armed_at, "due": due[:PARKED_PER_PASS], "closing": closing,
            "of": cfg["attempts"]}


def ready_ask_plan(reads: L.Reads) -> dict[str, Any]:
    """onboardingDoneAskSweepMaybe_'s look: who finished onboarding and is due the deciders' ask."""
    lane = Lane(reads, READY_ASK)
    if not lane.on:
        return {"on": False, "due": [], "why": lane.why}
    due = []
    for c in cands(reads):
        cid = s_(c.get("candidateid"))
        if not cid or archived(c) or CND.stage_of(c.get("status")) != "onboarding":
            continue
        rung = ladder_due(reads, "ready_ask", cid)
        if not rung["due"]:
            continue
        ob = CND.onboarding_done(reads, c)
        if not ob.get("q") or not ob.get("t"):
            continue
        n = rung["sent"] + 1
        if holding(reads, [f"ready_ask_mail_{cid}_{n}|", f"ready_ask_sms_{cid}_{n}_"]):
            continue
        due.append({"cid": cid, "sent": rung["sent"], "of": rung["of"]})
    return {"on": True, "due": due}


def inbound(reads: L.Reads) -> list[dict]:
    """The inbound log (INBOUND_TAB) as the opt-out lane keeps it."""
    import opt_outs as OO  # noqa: PLC0415 - the inbound log's owner
    return OO.inbound_rows(reads)


def ready_ear_plan(reads: L.Reads) -> dict[str, Any]:
    """readyAskScanRun_'s look: each open ready ask a decider answered since it went, and how."""
    rows = [r for r in sim_rows(reads) if s_(r.get("step")) == "ready_ask" and s_(r.get("state")) in ("open",
                                                                                                    "exhausted")]
    out: dict[str, Any] = {"checked": len(rows), "verdicts": []}
    if not rows:
        return out
    keys = {re.sub(r"\D", "", n)[-10:] for n in actors(reads)["decider_sms"] if re.sub(r"\D", "", n)[-10:]}
    msgs = inbound(reads)
    yes, no = words_regex(reads, "words.ready.yes", "start"), words_regex(reads, "words.ready.no", "start")
    for r in rows:
        since = s_(r.get("lastsentat")) or s_(r.get("createdat"))
        verdict, by = "", ""
        for m in msgs:
            if s_(m.get("fromkey")) not in keys or s_(m.get("receivedat")) < since:
                continue
            said = re.sub(r"[!.\s]+$", "", s_(m.get("body")).strip().lower())
            if yes is not None and yes.search(said):
                verdict, by = "yes", s_(m.get("fromnumber"))
            elif no is not None and no.search(said):
                verdict, by = "no", s_(m.get("fromnumber"))
        if verdict:
            out["verdicts"].append({"cid": s_(r.get("candidateid")), "verdict": verdict, "by": by})
    return out


def finish_plan(reads: L.Reads) -> dict[str, Any]:
    """onboardingFinishSweepMaybe_'s look: who at Onboarding stopped — first presses, the stalled to tell the team
    about, the parked ones waiting on the team's word."""
    sit = situation_on(reads, sit_id(reads, FINISH))
    if sit is None:
        return {"on": False}
    by_cid: dict[str, dict] = {}
    for r in sim_rows(reads):
        if s_(r.get("step")) == "onboarding_finish" and s_(r.get("candidateid")):
            by_cid[s_(r.get("candidateid"))] = r
    mins = attempts_for(reads, "onboarding_finish")["minutes"]
    users = {s_(u.get("email")).lower(): u for u in reads.users() if s_(u.get("email"))}
    first, stalled, parked = [], [], []
    now = now_ms(reads)
    for c in cands(reads):
        if len(first) + len(stalled) >= FINISH_PER_PASS:
            break
        cid = s_(c.get("candidateid"))
        if not cid or archived(c) or CND.stage_of(c.get("status")) != "onboarding":
            continue
        ob = CND.onboarding_done(reads, c)
        if ob.get("q") and ob.get("t"):
            continue
        email = s_(c.get("email"))
        if "@" not in email:
            continue
        u = users.get(email.lower())
        if u is None:
            continue
        row = by_cid.get(cid)
        if row is None:
            born = ms_of(u.get("createdat"))
            if born and now - born < mins * 60000:
                continue
            if holding(reads, ["ob_finish_mail_" + cid + "_"], claimed=False):
                continue
            first.append(cid)
        elif s_(row.get("state")) == "exhausted":
            stalled.append(cid)
        elif s_(row.get("state")) == "answered":
            parked.append({"cid": cid, "name": s_(c.get("candidatename")),
                           "since": s_(row.get("lastsentat")) or s_(row.get("createdat"))})
    return {"on": True, "first": first, "stalled": stalled, "parked": parked}


def tente_mais_at(reads: L.Reads, threads: list[dict], name: str) -> float:
    """obTenteMaisAt_: the newest "tente mais" from the hiring team about this candidate, as ms; 0 when none."""
    team = [e.lower() for e in team_emails(reads)]
    tm = word_list(reads, "words.ob.tente_mais")
    if not tm:
        return 0.0
    needle = s_(name).lower()
    best = 0.0
    for t in threads:
        frm = s_(t.get("from_addr")).lower()
        if not any(e and e in frm for e in team):
            continue
        text = (s_(t.get("snippet")) + " " + s_(t.get("subject"))).lower()
        if not any(w.lower() in text for w in tm):
            continue
        if needle and needle not in text:
            continue
        at = ms_of(t.get("date"))
        if at is not None and at > best:
            best = at
    return best


def ohio_morning_after(word_at: float, now: float) -> bool:
    """referralOhioMorningAfter_: a later New York day than the word's, and past 08:00 there."""
    today = datetime.fromtimestamp(now / 1000.0, NY)
    if today.strftime("%Y-%m-%d") <= datetime.fromtimestamp(word_at / 1000.0, NY).strftime("%Y-%m-%d"):
        return False
    return today.hour >= 8


def mailbox_threads(limit: int) -> list[dict] | None:
    """platformMailPost_('/mail/inbox'): the platform mailbox's newest threads; None when it cannot be read."""
    import mail_server as MB  # noqa: PLC0415 - the IMAP read, in a prepare read only
    box = MB.creds("")
    if box is None:
        return None
    try:
        return MB.inbox(box["user"], box["password"], limit)["threads"]
    except Exception as exc:  # noqa: BLE001 - an unreadable mailbox is not an empty one
        log.info("hiring: the platform mailbox could not be read (%s)", type(exc).__name__)
        return None


# ---- the doors the relay's clock asks first -------------------------------------------------------------------------

def _due(build: Callable[[L.Reads], dict[str, Any]], count: Callable[[dict], int]) -> Callable[[L.Session, dict],
                                                                                              dict[str, Any]]:
    def door(sess: L.Session, payload: dict) -> dict[str, Any]:
        if not service(sess):
            return dict(SERVICE_ONLY)
        plan = build(sess.reads)
        return {"status": 200, "data": {**plan, "due": count(plan)}}
    return door


def finish_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The finish ladder's look, the mailbox read once for the parked (sealed for onboardingFinishSweep)."""
    if not service(sess):
        return dict(SERVICE_ONLY)
    reads = sess.reads
    plan = finish_plan(reads)
    if plan.get("on") and plan.get("parked"):
        threads = mailbox_threads(50)
        plan["tente"] = {p["cid"]: tente_mais_at(reads, threads or [], p["name"]) for p in plan["parked"]}
        plan["mailbox"] = threads is not None
    due = len(plan.get("first") or []) + len(plan.get("stalled") or []) + len(plan.get("parked") or [])
    return {"status": 200, "data": R.seal("onboardingFinishSweep", "service", {**plan, "due": due})}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "hiredStayDue": _due(hired_stay_plan, lambda p: len(p["first"])),
    "becomingStaffDue": _due(becoming_plan, lambda p: len(p["ready"])),
    "readyWatchDue": _due(ready_watch_plan, lambda p: len(p["found"])),
    "readyParkedDue": _due(parked_plan, lambda p: len(p["due"]) + len(p.get("closing") or [])),
    "readyAskDue": _due(ready_ask_plan, lambda p: len(p["due"])),
    "readyEarDue": _due(ready_ear_plan, lambda p: len(p["verdicts"])),
    "onboardingFinishDue": finish_due,
}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
