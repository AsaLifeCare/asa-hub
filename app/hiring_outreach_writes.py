"""The hiring outreach's sends (HiringOutreach.gs) on Python: every letter and text a person presses — the welcome,
the ask, the shortlist, the thank-you, the outreach, the acceptance, the call instruction, the résumé, CJIS and decision
asks, the discard, the manual first contact and its phone and résumé rungs — decided under the write lock. Each message
goes through Smart Comms (raise_situation, under the situation its door speaks through, the lane's own words as it
wrote them, every brake still deciding); each journey line, each entry of the ask book (hiring_sim_asks), the archive
marks and the collected pool are facts on the dissolved hiring tabs; a filed reply lands in the inbound log (Postgres
once the opt-outs are kept there, its tab through app.edits until then). The folder, résumé, provider and model
readings are done first by the prepare reads (hiring_outreach); a door pressed from another write prepares itself."""
from __future__ import annotations

import json
import re
import secrets
import time
import uuid
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import comms_rpc as CR
import gsjs
import hiring_outreach as HO
import hiring_outreach_letters as HL
import interviews as IV
import locations as L
import opt_outs as OO
import opt_outs_writes as OOW
import recon as R
import resource_rows as RR
import smart_comms as SC
import smart_comms_desk as SCD
import writes as W
from hubdb import Unreadable
from scope import Defer
from writes import Decision

s_ = gsjs.str_
BUSY = "Another hiring send is being decided right now — try again."
STALE = "What this send was prepared on is no longer current — press it again."
OPT_SCOPE = "hiring"
CJIS_DOC = {"doc_id": "background_check", "doc_label": "Background check (BCI)"}
ANALYSIS_READING = ("These are the Analysis winners, in order — the same ranking the Talent Pipeline Analysis screen "
                    "shows, computed by the same formula. Reply with the names you want us to proceed with, OK for all "
                    "of them, or ask for more options.")
ANALYSIS_CRITERIA = [
    "Nota — the resume composite (skills 1.5 · experience 1.5 · job history 1.0 · certifications 0.5) brought to a "
    "0–10 scale",
    "Qualification — +0.5 when the phone-screen qualification passed",
    "Screen checks — +0.25 when all six are true (DODD, CPR, Med Delegation, licence, vehicle, insurance)",
    "Red flags — −0.75 each (short tenure, no certs, stale experience). Eligible: decision Advance, CJIS not failed, "
    "screen not rejected."]
DB_CRITERIA = [
    "Skills — weight 1.5 of the composite (0–10)",
    "Experience — weight 1.5 (years of caregiving, recency, tenure)",
    "Job history — weight 1.0 (consistency, agencies, leadership)",
    "Certifications — weight 0.5 (DODD, CPR, Med, licences). Red flags are named per row; an unscored resume prints a "
    "dash, never a zero."]
MANUAL_LADDER = "asa-hub:manual-ladder"
MANUAL_ACTOR = "manual-ladder@service.local"
# a shortlist pressed from another write reads the model inside it, for this long at most
INLINE_MODEL_S = 3.0


# ---- one door's sends and records -------------------------------------------------------------------------------

class Run:
    """One door's run: each letter and text through Smart Comms (outreachSend_, outreachSms_), each journey line
    (journeyLog_) and each entry of the ask book (simTrackSend_, simAskAnswer_) as the facts it keeps."""

    def __init__(self, sess: L.Session) -> None:
        self.sess = sess
        self.reads = sess.reads
        self.user = sess.user or {}
        self.by = s_(self.user.get("email"))
        self.now = W.now_iso(self.reads)
        self.recs: list[dict] = []
        self._asks: list[dict] | None = None

    def journey(self, line: dict[str, Any]) -> None:
        """journeyLog_: the line's title the steps book's when the caller names none."""
        ln = dict(line)
        if not s_(ln.get("title")):
            ln["title"] = HO.journey_title(self.reads, s_(ln.get("step"))) or s_(ln.get("step"))
        ctx = {"key": s_(ln.get("candidate_id")), "name": s_(ln.get("name"))}
        self.recs += CW.journey_records(self.reads, ctx, ln, "")[2]

    @staticmethod
    def _key(step: str, cid: str) -> str:
        return f"hiring:{step}:{cid or '-'}:{uuid.uuid4().hex[:16]}"

    @staticmethod
    def _shape(out: dict, res: dict) -> None:
        out["sent"] = bool(res.get("sent"))
        out["redirected"] = bool(res.get("redirected"))
        out["rehearsal"] = out["redirected"]
        out["error"] = s_(res.get("error") or ("gated" if res.get("gated") else ""))
        out["detail"] = s_(res.get("detail") or res.get("reason") or "")

    def letter(self, *, step: str, to: Any, letter: dict, reason: str, situation: str, cid: str = "", name: str = "",
               cc: Any = "", ref: str = "", by: str | None = None) -> dict[str, Any]:
        """outreachSend_: one letter, sent, recorded and reported honestly — one per address, the copy list on the
        first."""
        reads = self.reads
        by = self.by if by is None else by
        to, cc = s_(to), s_(cc)
        subject = HO.tag_subject(reads, s_(letter.get("subject")))
        out: dict[str, Any] = {"step": step, "channel": "email", "to": to, "cc": cc, "subject": subject, "sent": False,
                               "redirected": False, "rehearsal": False, "error": "", "detail": ""}
        line = {"candidate_id": cid, "name": name, "step": step, "channel": "email", "by": by}
        if not to:
            out["error"], out["detail"] = "no_recipient", "nobody to write to — the address list resolved empty"
            self.journey({**line, "to": "", "ok": False, "detail": out["detail"]})
            return out
        fence = HO.outbound_allowed(reads, to + ("," + cc if cc else ""))
        if not fence["ok"]:
            out["error"], out["detail"] = fence["reason"], fence["detail"]
            self.journey({**line, "to": to, "ok": False, "detail": "BLOCKED — " + fence["detail"]})
            return out
        key = self._key(step, cid)
        got: list[dict] = []
        for i, addr in enumerate(x.strip() for x in re.split(r"[,;]+", to) if x.strip()):
            told = SC.raise_situation(None, situation=situation, to=addr, vars={}, key=key + "|" + addr.lower(),
                                      person=name or None, person_key=cid or None, lane=reason, prune=False,
                                      channel="email", body=s_(letter.get("text")), subject=subject,
                                      html=s_(letter.get("html")) or None, cc=(cc or None) if i == 0 else None,
                                      transport=True)
            got.append(CR.envelope("emailSend", {"to": addr, "subject": subject, "body": s_(letter.get("text")),
                                                 "reason": reason}, told))
        res = next((g for g in got if g.get("sent")), got[0] if got else {"error": "no_address",
                                                                           "detail": "no address this platform may "
                                                                                     "write to"})
        self._shape(out, res)
        out["delivered_to"] = "the rehearsal address" if out["redirected"] else to
        self.journey({**line, "to": to, "ok": out["sent"], "rehearsal": out["redirected"],
                      "detail": ("sent" if out["sent"] else "not sent") + (" — " + out["error"] if out["error"] else "")
                      + (": " + out["detail"] if out["detail"] else "") + " · subject: " + subject
                      + (" · cc: " + cc if cc and out["sent"] and not out["redirected"] else ""), "ref": ref})
        return out

    def sms(self, *, step: str, to: Any, body: Any, reason: str, situation: str, cid: str = "", name: str = "",
            intro: Any = "", ref: str = "", by: str | None = None) -> dict[str, Any]:
        """outreachSms_: the same contract — the cast's shared lines reach their group's own line."""
        reads = self.reads
        by = self.by if by is None else by
        dest = HO.sendable_phone(reads, s_(to))
        text = (s_(intro) + " " if s_(intro) else "") + s_(body)
        out: dict[str, Any] = {"step": step, "channel": "sms", "to": dest, "sent": False, "redirected": False,
                               "rehearsal": False, "error": "", "detail": "", "body": text}
        line = {"candidate_id": cid, "name": name, "step": step, "channel": "sms", "by": by}
        if not dest:
            out["error"] = "no_phone"
            out["detail"] = "no sendable number on the row — an unsendable number is not a silent skip"
            self.journey({**line, "to": s_(to), "ok": False, "detail": out["detail"]})
            return out
        fence = HO.outbound_allowed(reads, dest)
        if not fence["ok"]:
            out["error"], out["detail"] = fence["reason"], fence["detail"]
            self.journey({**line, "to": dest, "ok": False, "detail": "BLOCKED — " + fence["detail"]})
            return out
        shared = HO.digits(dest)[-10:] in SC.SHARED_LINE_DIGITS
        told = SC.raise_situation(None, situation=situation, to=dest, vars={}, key=self._key(step, cid),
                                  person=name or None, person_key=cid or None, lane=reason, prune=False, channel="sms",
                                  body=text, transport=True, team="group" if shared else False)
        res = CR.envelope("smsSend", {"to": dest, "body": text, "reason": reason}, told)
        self._shape(out, res)
        out["delivered_to"] = "the rehearsal number" if out["redirected"] else dest
        self.journey({**line, "to": dest, "ok": out["sent"], "rehearsal": out["redirected"],
                      "detail": ("sent" if out["sent"] else "not sent") + (" — " + out["error"] if out["error"] else "")
                      + (": " + out["detail"] if out["detail"] else ""), "ref": ref})
        return out

    def asks(self) -> list[dict]:
        if self._asks is None:
            self._asks = [dict(r) for r in HO.ask_rows(self.reads)]
        return self._asks

    def track(self, step: str, cid: str, action: str, payload: dict) -> dict[str, Any]:
        """simTrackSend_: the open ask of this step and card bumped, or a new one entered."""
        cfg = HO.attempts_for(self.reads, step)
        rows = self.asks()
        for r in reversed(rows):
            if s_(r.get("step")) != step or s_(r.get("candidateid")) != (cid or ""):
                continue
            if s_(r.get("state")) != "open":
                break
            n = HO.int_of(r.get("sentcount"), 0) + 1
            self.recs += CW.facts_of(self.reads, HO.SIM_ASKS_TAB, s_(r.get("simaskid")),
                                     {"sent_count": str(n), "last_sent_at": self.now}, "runtime-sheet", cid, "",
                                     at=self.now)
            r.update(sentcount=str(n), lastsentat=self.now)
            return {"id": s_(r.get("simaskid")), "attempt": n, "of": cfg["attempts"]}
        aid = "SIMASK_" + secrets.token_hex(4).upper()
        row = {"sim_ask_id": aid, "step": step, "candidate_id": cid or "", "action": action,
               "payload_json": json.dumps(payload or {}, ensure_ascii=False, separators=(",", ":"))[:4000],
               "sent_count": "1", "max_attempts": str(cfg["attempts"]), "interval_minutes": str(cfg["minutes"]),
               "last_sent_at": self.now, "state": "open", "answered_at": "", "answered_by": "", "created_at": self.now}
        self.recs += CW.facts_of(self.reads, HO.SIM_ASKS_TAB, aid, row, "runtime-sheet:append", cid, "", at=self.now)
        rows.append({k.replace("_", ""): v for k, v in row.items()})
        return {"id": aid, "attempt": 1, "of": cfg["attempts"]}

    def answer(self, steps: tuple[str, ...], by: str, cid: str) -> int:
        """simAskAnswer_: the open (or exhausted) asks of these steps closed."""
        closed = 0
        for r in self.asks():
            if s_(r.get("state")) not in ("open", "exhausted") or s_(r.get("step")) not in steps:
                continue
            if cid and s_(r.get("candidateid")) and s_(r.get("candidateid")) != cid:
                continue
            fields = {"state": "answered", "answered_at": self.now, "answered_by": s_(by)[:120]}
            self.recs += CW.facts_of(self.reads, HO.SIM_ASKS_TAB, s_(r.get("simaskid")), fields, "runtime-sheet", cid,
                                     "", at=self.now)
            r.update(state="answered", answeredat=self.now, answeredby=s_(by)[:120])
            closed += 1
        return closed

    def final(self, data: dict[str, Any], subject: str = "") -> Decision:
        return W.final({"status": 200, "data": data}, self.recs, subject)


def _said(data: dict[str, Any]) -> Decision:
    return Decision({"status": 200, "data": data})


def _open(sess: L.Session, action: str, payload: Any) -> tuple[Run | None, dict, Decision | None]:
    """hubIsWriter_ and the declared required params; the hiring facts must be where these doors keep them."""
    p = payload if isinstance(payload, dict) else {}
    if not HO.writer(sess.user):
        return None, p, Decision(dict(HO.DENIED))
    refused = HO.missing(action, p)
    if refused:
        return None, p, Decision(refused)
    db = sess.reads.db
    if not (db.dissolved(CW.JOURNEY) and db.dissolved(HO.SIM_ASKS_TAB) and db.dissolved(CW.CANDIDATES)):
        raise Defer("the hiring journey, the ask book and the candidates are kept as facts only while dissolved")
    W.gate(sess.reads)
    return Run(sess), p, None


def _cid(p: dict) -> tuple[str, Decision | None]:
    cid = s_(p.get("candidate_id"))
    return cid, None if HO.CAN_ID.match(cid) else W.refuse(400, "invalid candidate_id")


def _cand(reads: L.Reads, cid: str) -> tuple[dict, dict | None, Decision | None]:
    """hubEvidence_ and its 404."""
    ev = CND.evidence(reads, cid)
    c = ev.get("cand")
    return ev, c, None if c else W.refuse(404, f'No candidate "{cid}".')


def _ready(sess: L.Session, door: str, p: dict, cid: str, inline: Callable[[], dict]) -> dict | None:
    """What its prepare read made ready for this write, for this person, just now (None when it is not); pressed
    from another write, as Apps Script re-called HUB_ACTIONS, the same preparation done here."""
    if p.get("prepared") is None:
        return inline()
    got = R.unsealed(door, R.actor(sess.user), p.get("prepared"))
    if got is not None and cid and s_(got.get("candidate_id")) != cid:
        return None
    return got


def _team_to(reads: L.Reads, p: dict) -> tuple[str, str]:
    """The team-letter law: to the deciders, the watchers in copy; an address the caller names gets the copy list."""
    addr = HO.team_address(reads)
    to = s_(p.get("to")) or addr["to"] or ", ".join(HO.team_of(reads)["emails"])
    cc = HO.cc_for(reads, to) if s_(p.get("to")) else addr["cc"]
    return to, cc


def _opted_out(reads: L.Reads, phone: Any) -> str:
    """optOutBlocked_ for this file's conversation (an unreadable list refuses)."""
    return OO.opt_out_blocked(reads, phone, OPT_SCOPE)


def _moved_on(c: dict, stage: str) -> bool:
    return HO.archived(c) or HO.stage_of(s_(c.get("status"))) != stage


# ---- step 0 — the welcome and the ask --------------------------------------------------------------------------------

def welcome_send(sess: L.Session, payload: dict) -> Decision:
    """hiringWelcomeSend: the team told the Hiring Pipeline is open, who reaches it, and how many are already in the
    database."""
    run, p, refused = _open(sess, "hiringWelcomeSend", payload)
    if refused:
        return refused
    reads = run.reads
    situation = HO.sid(reads, "welcome")
    allow = HO.allowed(reads, situation)
    if not allow["ok"]:
        return _said({"sent": False, "reason": allow["reason"]})
    to = s_(p.get("to")) or ", ".join(HO.team_of(reads)["emails"])
    count: Any = sum(1 for c in CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB) if HO.stage_of(c.get("status")))
    letter = HL.welcome({"roles": ["Admin", "Manager", "Interviewer"], "candidateCount": count,
                         "subject": HO.sit_cell(allow, "email_subject") or HO.sim_text(reads, "welcome_subject"),
                         "bodyText": HO.sit_cell(allow, "email_text") or HO.sim_text(reads, "welcome_body")})
    res = run.letter(step="welcome", to=to, letter=letter, situation=situation,
                     reason="hiring: the team is told the pipeline is open")
    return run.final(res)


def ask_send(sess: L.Session, payload: dict) -> Decision:
    """hiringAskSend: is hiring open, and how many already-analysed DSPs do the deciders want?"""
    run, p, refused = _open(sess, "hiringAskSend", payload)
    if refused:
        return refused
    reads = run.reads
    situation = HO.sid(reads, "ask")
    allow = HO.allowed(reads, situation)
    if not allow["ok"]:
        return _said({"sent": False, "reason": allow["reason"]})
    to, cc = _team_to(reads, p)
    joined = IV.tp_joined(reads)
    analyzed = str(len(IV.tp_rank(joined["rows"]))) if joined["migrated"] else ""
    if not analyzed:
        pool = HO.ranked(reads, [], [], "", 0)
        analyzed = str(pool["total"] - pool["unscored"])
    letter = HL.ask({"candidateCount": analyzed,
                     "subject": HO.sit_cell(allow, "email_subject") or HO.sim_text(reads, "ask_subject"),
                     "bodyText": HO.sit_cell(allow, "email_text") or HO.sim_text(reads, "ask_body")})
    res = run.letter(step="ask", to=to, cc=cc, letter=letter, situation=situation,
                     reason="hiring: asking the team whether hiring is open")
    if res["sent"]:
        tracked = run.track("ask", "", "hiringAskSend", {"to": s_(p.get("to"))})
        res["attempt"], res["attempts_max"] = tracked["attempt"], tracked["of"]
    return run.final(res)


# ---- step 1 — the shortlist ------------------------------------------------------------------------------------------

def mark_collected(run: Run, ids: list[str]) -> int:
    """tpMarkCollected_: the five leave the Analysis pool; a row already collected stays as it was."""
    want = set(ids)
    n = 0
    for r in CND.read_tab(run.reads, HO.TP_CANDIDATES):
        cid = s_(r.get("candidateid"))
        if cid not in want or s_(r.get("collectedat")):
            continue
        run.recs += CW.facts_of(run.reads, HO.TP_CANDIDATES, cid, {"collected_at": run.now, "collected_by": run.by},
                                "runtime-sheet", cid, "", at=run.now)
        n += 1
    return n


def shortlist_send(sess: L.Session, payload: dict) -> Decision:
    """hiringShortlistSend (hiringShortlistCore_): the Analysis winners, their criteria and what they mean — to the
    people who decide; a fresh collection's five leave the pool."""
    run, p, refused = _open(sess, "hiringShortlistSend", payload)
    if refused:
        return refused
    reads = run.reads
    situation = HO.sid(reads, "shortlist")
    allow = HO.allowed(reads, situation)
    if not allow["ok"]:
        return _said({"sent": False, "reason": allow["reason"]})
    prep = _ready(sess, "hiringShortlistSend", p, "",
                  lambda: HO.shortlist_ready(reads, p, time.monotonic() + INLINE_MODEL_S))
    if prep is None:
        return W.refuse(409, STALE)
    rows, source = list(prep.get("rows") or []), s_(prep.get("source"))
    if not rows:
        return _said({"sent": False, "reason": "nobody_to_rank",
                      "detail": "neither the Analysis nor the hiring DB has anybody to rank — a letter with an empty "
                                "table says nothing"})
    to, cc = _team_to(reads, p)
    analysis = source == "analysis"
    letter = HL.shortlist({
        "rows": [{"name": r.get("name"), "score": "" if r.get("score") is None else r.get("score"), "why": r.get("why"),
                  "phone": r.get("phone"), "email": r.get("email"), "city": r.get("city")} for r in rows],
        "reading": ANALYSIS_READING if analysis else s_(prep.get("reading")),
        "criteria": ANALYSIS_CRITERIA if analysis else DB_CRITERIA,
        "subject": HO.sit_cell(allow, "email_subject") or HO.sim_text(reads, "shortlist_subject"),
        "bodyText": HO.sit_cell(allow, "email_text") or HO.sim_text(reads, "shortlist_body")})
    res = run.letter(step="shortlist", to=to, cc=cc, letter=letter, situation=situation,
                     reason="hiring: the Analysis winners and our reading of them")
    ids = [s_(r.get("candidate_id")) for r in rows]
    if res["sent"] and analysis and not (p.get("candidate_ids") or []):
        if HO.test_mode(reads)["on"]:
            detail = "five collected from the Talent Pipeline Analysis (rehearsal — the real pool is not consumed)"
        else:
            got = mark_collected(run, ids)
            detail = (f"five collected from the Talent Pipeline Analysis — {got} left the pool; the Analysis re-ranks "
                      "itself and the next collection sees the next five")
        run.journey({"candidate_id": "", "name": "", "step": "shortlist", "channel": "record", "ok": True,
                     "detail": detail, "by": run.by})
    if res["sent"]:
        tracked = run.track("shortlist", "", "hiringShortlistSend",
                            {"limit": p.get("limit") or 5, "exclude_ids": p.get("exclude_ids") or [],
                             "candidate_ids": ids})
        res["attempt"], res["attempts_max"] = tracked["attempt"], tracked["of"]
    res.update(source=source, ranked=rows, unscored=sum(1 for r in rows if r.get("score") is None),
               pool=prep.get("pool") or len(rows))
    for r in rows:
        run.journey({"candidate_id": s_(r.get("candidate_id")), "name": s_(r.get("name")), "step": "shortlist",
                     "channel": "email", "to": to, "ok": res["sent"], "by": run.by,
                     "detail": "named among the winners" + (" (not scored)" if r.get("score") is None else
                                                             " at " + gsjs.js_str(r.get("score")))
                     + " — source: " + source})
    return run.final(res)


# ---- step 3 — thanking whoever answered ------------------------------------------------------------------------------

def interest_thanks_send(sess: L.Session, payload: dict) -> Decision:
    """hiringInterestThanksSend: thank you, and what happens next — the whole group the team chose."""
    run, p, refused = _open(sess, "hiringInterestThanksSend", payload)
    if refused:
        return refused
    reads = run.reads
    lane = HO.Lane(reads, HO.THANKS_SIT)
    if not lane.on or not lane.leg("email"):
        return _said({"sent": False, "reason": lane.why or "the situation hiring_interest_thanks writes no letter"})
    addr = HO.team_address(reads)
    to = s_(p.get("to")) or addr["to"]
    cc = HO.cc_for(reads, to) if s_(p.get("to")) else addr["cc"]
    about = s_(p.get("about"))
    if not about:
        chose = HO.chose_line(reads)
        about = s_((chose or {}).get("name"))
    who = HO.team_name(reads, to.split(",")[0])
    vars_ = {"who": who or "there", "about": about or "them"}
    letter = HL.interest_thanks({
        "who": who, "about": about,
        "subject": lane.word("email_subject", HO.sim_text(reads, "thanks_subject").replace("{about}", about or "them"),
                             vars_),
        "bodyText": lane.word("email_text", HO.fill(HO.sim_text(reads, "thanks_body"),
                                                    {"who": who or "there", "about": about or "them"}), vars_)})
    res = run.letter(step="interest_thanks", to=to, cc=cc, letter=letter, situation=HO.THANKS_SIT,
                     cid=s_(p.get("candidate_id")), name=about, reason="smart comms: hiring_interest_thanks")
    return run.final(res, s_(p.get("candidate_id")))


# ---- step 4 — the outreach ------------------------------------------------------------------------------------------

def _recruiter_floor(reads: L.Reads) -> str:
    team = HO.team_of(reads)
    first = (team["emails"][0] if team["emails"] else "").lower()
    return team["names"].get(first, "") or HO.book(reads, "outreach.recruiter.floor")


def outreach_sms(sess: L.Session, payload: dict) -> Decision:
    """hiringOutreachSms: "a recruiter will call you — are you interested?", by text, the recruiter named."""
    run, p, refused = _open(sess, "hiringOutreachSms", payload)
    if refused:
        return refused
    reads = run.reads
    cid, bad = _cid(p)
    if bad:
        return bad
    situation = HO.sid(reads, "outreach")
    allow = HO.allowed(reads, situation)
    if not allow["ok"]:
        return _said({"sent": False, "reason": allow["reason"]})
    _ev, c, missing = _cand(reads, cid)
    if missing:
        return missing
    name = s_(c.get("candidatename"))
    first = HO.greet_first(name)
    stopped = _opted_out(reads, c.get("phone"))
    if stopped:
        return _said({"sent": False, "reason": "opted_out", "detail": stopped})
    recruiter = s_(p.get("recruiter")) or HO.cfg_val(reads, "sim_recruiter_name")
    if not recruiter:
        chose = HO.chose_line(reads)
        if chose:
            m = re.search(r"reply from ([^\s(]+)", s_(chose.get("detail")))
            if m:
                recruiter = HO.team_name(reads, m.group(1))
    recruiter = recruiter or _recruiter_floor(reads)
    body = HO.sit_cell(allow, "sms_text") or HO.book(reads, "outreach.sms.floor").replace("{first}", first)
    body = HO.fill(body, {"first_name": first, "name": name, "recruiter": recruiter})
    res = run.sms(step="outreach_sms", to=c.get("phone"), body=body, situation=situation, cid=cid, name=name,
                  reason="hiring: first contact by text")
    return run.final(res, cid)


def outreach_send(sess: L.Session, payload: dict) -> Decision:
    """hiringOutreachSend: the first contact by text and by letter, for one card or several (up to 25)."""
    run, p, refused = _open(sess, "hiringOutreachSend", payload)
    if refused:
        return refused
    reads = run.reads
    situation = HO.sid(reads, "outreach")
    allow = HO.allowed(reads, situation)
    if not allow["ok"]:
        return _said({"sent": False, "reason": allow["reason"]})
    ids = [s_(x) for x in p["candidate_ids"]] if isinstance(p.get("candidate_ids"), list) else []
    if s_(p.get("candidate_id")):
        ids.append(s_(p.get("candidate_id")))
    ids = [x for x in ids if HO.CAN_ID.match(x)]
    if not ids:
        card = None
        for c in CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB):
            if s_(c.get("candidatename")).lower().startswith("[test]"):
                card = c
        if card:
            ids = [s_(card.get("candidateid"))]
    if not ids:
        return W.refuse(400, "Which candidate(s)? None was named and no rehearsal card exists.")
    if len(ids) > 25:
        return W.refuse(400, "Up to 25 candidates in one press.")
    recruiter = s_(p.get("recruiter")) or _recruiter_floor(reads)
    intro = HO.quo_intro(reads, HO.book(reads, "purpose.first_contact"))
    results = []
    for cid in ids:
        _ev, c, missing = _cand(reads, cid)
        if missing:
            results.append({"candidate_id": cid, "error": "no such candidate"})
            continue
        name = s_(c.get("candidatename"))
        first = HO.greet_first(name)
        said = {"first_name": first, "name": name, "recruiter": recruiter}
        one: dict[str, Any] = {"candidate_id": cid, "name": name, "sms": None, "email": None}
        stopped = _opted_out(reads, c.get("phone"))
        if stopped:
            one["sms"] = {"sent": False, "reason": "opted_out", "detail": stopped}
        if not one["sms"]:
            body = (HO.sim_text(reads, "outreach_sms") or HO.sit_cell(allow, "sms_text")
                    or HO.book(reads, "outreach.sms.floor").replace("{first}", first))
            one["sms"] = run.sms(step="outreach_sms", to=c.get("phone"), body=HO.fill(body, said), intro=intro,
                                 situation=situation, cid=cid, name=name, reason="hiring: first contact by text")
        email = s_(c.get("email"))
        if "@" in email:
            letter = HL.outreach({"name": name, "recruiter": recruiter,
                                  "subject": HO.fill(HO.sit_cell(allow, "email_subject")
                                                     or HO.sim_text(reads, "outreach_email_subject"), said),
                                  "bodyText": HO.fill(HO.sit_cell(allow, "email_text")
                                                      or HO.sim_text(reads, "outreach_email_body"), said)})
            one["email"] = run.letter(step="outreach_sms", to=email, cc=HO.cc_for(reads, email), letter=letter,
                                      situation=situation, cid=cid, name=name,
                                      reason="hiring: first contact by letter")
        else:
            one["email"] = {"sent": False, "reason": "no_email"}
        if one["sms"].get("sent") or one["email"].get("sent"):
            tracked = run.track("outreach", cid, "hiringOutreachSend", {"candidate_ids": [cid]})
            one["attempt"], one["attempts_max"] = tracked["attempt"], tracked["of"]
        results.append(one)
    legs = [x for r in results for x in (r.get("sms"), r.get("email")) if isinstance(x, dict)]
    return run.final({"sent": any(x.get("sent") for x in legs), "redirected": any(x.get("redirected") for x in legs),
                      "candidates": results}, ids[0] if len(ids) == 1 else "")


# ---- step 4's second half and step 5 — the reply, and the team told -------------------------------------------------

def accepted_tell(run: Run, cid: str, name: str, phone: str, reply: str, by: str) -> dict[str, Any]:
    """hiringAcceptedTell_: the team told by letter, and the deciders by text, that the candidate said yes."""
    reads = run.reads
    name = HO.short_name(name)
    out: dict[str, Any] = {"emailed": False, "smsed": 0}
    lane = HO.Lane(reads, HO.ACCEPTED_SIT)
    if not lane.on:
        out["why"] = lane.why
        return out
    vars_ = {"name": name, "reply": reply[:300], "phone": phone or "(no number on file)"}
    cast = HO.actors(reads)
    addr = HO.team_address(reads)
    to = addr["to"] or ", ".join(HO.team_of(reads)["emails"])
    email = s_((CND.evidence(reads, cid).get("cand") or {}).get("email"))
    letter = HL.accepted({
        "name": name, "reply": reply, "phone": phone, "email": email,
        "subject": lane.word("email_subject", HO.sim_text(reads, "accepted_subject").replace("{name}", name), vars_),
        "bodyText": lane.word("email_text", HO.fill(HO.sim_text(reads, "accepted_body"),
                                                    {"name": name, "reply": reply[:300],
                                                     "phone": phone or "(no number on file)"}), vars_)})
    if lane.leg("email"):
        res = run.letter(step="outreach_reply", to=to, cc=addr["cc"], letter=letter, situation=HO.ACCEPTED_SIT,
                         cid=cid, name=name, reason="smart comms: hiring_candidate_accepted", by=by)
        out["emailed"] = res["sent"]
    numbers = [] if not lane.leg("sms") else (cast["decider_sms"] or cast["team_sms"] or [])
    floor = HO.book(reads, "accepted.sms.floor").replace(
        "{phone_line}", HO.book(reads, "accepted.phone_line.floor").replace("{phone}", phone) if phone else ""
    ).replace("{name}", name)
    body = lane.word("sms_text", HO.fill(HO.sim_text(reads, "accepted_sms"), {"name": name, "phone": phone})
                     or floor, vars_)
    intro = HO.quo_intro(reads, HO.book(reads, "purpose.accepted"))
    for n in numbers:
        r = run.sms(step="outreach_reply", to=n, body=body, intro=intro, situation=HO.ACCEPTED_SIT, cid=cid,
                    name=name, reason="smart comms: hiring_candidate_accepted", by=by)
        if r["sent"]:
            out["smsed"] += 1
    return out


def _tab_append(run: Run, tab: str, match: tuple[str, ...], key: str, row: dict[str, str], subject: str) -> None:
    """hubAppendRow_ on a tab that stays a sheet: the row under the tab's own header, kept in app.edits."""
    res = W.tab_of(run.reads, tab)
    if res.ref is None:
        raise Defer(f"{tab} holds no copy: Apps Script makes it on its first row")
    sid_, name = W.where_of(res)
    by_norm = {CW.norm(k): v for k, v in row.items()}
    cells = {h: by_norm.get(CW.norm(h), "") for h in (gsjs.trim(gsjs.js_str(x)) for x in res.ref.headers) if h}
    run.recs.append(W.kept_record(sid_, name, "append", W.COLS + W.COLS_SEP.join(match), key, subject, cells))


def _opt_out_add(run: Run, kept: bool, target: str, info: dict[str, str]) -> None:
    """optOutAdd_: one row for a target not stopped yet — in Postgres once the list is kept there, else on its tab."""
    if kept:
        OOW.add(run.reads, target, info)
        return
    key = OO.opt_out_key(target)
    if not key:
        return
    idx = OO.opt_out_index(run.reads)
    if not idx["error"] and key in idx["by"]:
        return
    wrong = "wrong" in info.get("source", "").lower()
    row = {"target": target, "kind": OO.opt_out_kind(target), "target_key": key, "person_name": info.get("name", ""),
           "candidate_id": info.get("candidateId", ""), "source": info.get("source", ""),
           "phrase": info.get("phrase", ""), "message_id": info.get("messageId", ""), "at": run.now,
           "by": info.get("by", ""), "released_at": "", "released_by": "",
           "scope": info.get("scope", "") if wrong else ""}
    _tab_append(run, OO.OPT_OUT_TAB, ("target_key", "at"), key + "\x1f" + run.now, row, info.get("candidateId", ""))


def _file_replies(run: Run, items: list[dict], line: str) -> list[dict]:
    """quoInboundPull_'s filing: each pulled reply into the inbound log once, a stop or a wrong number onto the
    opt-out list as the other ears do — in Postgres once both are kept there, else on their tabs."""
    reads = run.reads
    if not items:
        return []
    kept = RR.uploaded(reads.db, OO.OPT_OUT_RESOURCE) and RR.uploaded(reads.db, OO.INBOUND_RESOURCE)
    have = {s_(m.get("messageid")) for m in OO.inbound_rows(reads)}
    testing = OO.comm_test_mode(reads.config())
    out = []
    for it in items:
        mid = s_(it.get("message_id"))
        if not mid or mid in have:
            continue
        intent, body = s_(it.get("intent")), gsjs.or_blank(it.get("body"))
        if intent in ("opt-out", "wrong-number"):
            _opt_out_add(run, kept, s_(it.get("from_number")), {
                "name": s_(it.get("person_name")), "candidateId": s_(it.get("candidate_id")),
                "source": "sms reply" if intent == "opt-out" else "wrong number", "phrase": body[:120],
                "messageId": mid, "by": "asa-hub:outreach",
                "scope": OO.scope_for_line(line, testing) if intent == "wrong-number" else ""})
        out.append({"message_id": mid, "received_at": s_(it.get("received_at")),
                    "from_number": s_(it.get("from_number")), "from_key": s_(it.get("from_key")),
                    "candidate_id": s_(it.get("candidate_id")), "person_name": s_(it.get("person_name")),
                    "body": body, "intent": intent, "our_number": line, "recorded_at": run.now})
        have.add(mid)
    if out and kept:
        RR._widen(reads, OO.INBOUND_RESOURCE, list(OO.INBOUND_COLUMNS))
        RR.create_many(reads, OO.INBOUND_RESOURCE, out, "asa-hub:outreach")
    elif out:
        for row in out:
            _tab_append(run, OO.INBOUND_TAB, ("message_id",), row["message_id"], row, row["candidate_id"])
    return out


def reply_check(sess: L.Session, payload: dict) -> Decision:
    """hiringOutreachReplyCheck (hiringOutreachReplyScan_): the replies read now — the provider's copy filed first,
    then a yes closes the outreach ask and, once, tells the team."""
    run, p, refused = _open(sess, "hiringOutreachReplyCheck", payload)
    if refused:
        return refused
    reads = run.reads
    cid, bad = _cid(p)
    if bad:
        return bad
    prep = _ready(sess, "hiringOutreachReplyCheck", p, cid,
                  lambda: {"candidate_id": cid, "pull": {"pulled": 0, "error": "not_pulled", "items": [], "line": ""}})
    if prep is None:
        return W.refuse(409, STALE)
    out: dict[str, Any] = {"checked": 0, "matched": False, "announced": False, "reply": ""}
    c = CND.evidence(reads, cid).get("cand")
    if not c:
        return run.final(out, cid)
    name, phone = s_(c.get("candidatename")), s_(c.get("phone"))
    pull = prep.get("pull") if isinstance(prep.get("pull"), dict) else {}
    filed = _file_replies(run, [x for x in pull.get("items") or [] if isinstance(x, dict)], s_(pull.get("line")))
    out["pull"] = {"pulled": len(filed), "error": s_(pull.get("error"))}
    already = any(s_(j.get("step")) == "outreach_reply" for j in (CND.journey_for(reads, cid) or []))
    yes_re = HO.words_regex(reads, "words.outreach.yes", "start")
    yes = None
    for m in list(OO.inbound_rows(reads)) + [{"candidateid": f["candidate_id"], "body": f["body"]} for f in filed]:
        if s_(m.get("candidateid")) != cid:
            continue
        out["checked"] += 1
        body = gsjs.trim(re.sub(r"[^a-z0-9 ]+", " ", gsjs.trim(s_(m.get("body"))).lower()))
        if yes_re and yes_re.search(body):
            yes = m
    if not yes:
        return run.final(out, cid)
    out["matched"] = True
    out["reply"] = s_(yes.get("body"))
    run.answer(("outreach",), "the candidate", cid)
    if already:
        return run.final(out, cid)
    told = accepted_tell(run, cid, name, phone, s_(yes.get("body")), run.by or "asa-hub:sweep")
    out["announced"] = bool(told["emailed"])
    out["sms_told"] = told["smsed"]
    return run.final(out, cid)


def accepted_notify(sess: L.Session, payload: dict) -> Decision:
    """hiringAcceptedNotify: the acceptance announced now, their last reply quoted."""
    run, p, refused = _open(sess, "hiringAcceptedNotify", payload)
    if refused:
        return refused
    reads = run.reads
    cid, bad = _cid(p)
    if bad:
        return bad
    _ev, c, missing = _cand(reads, cid)
    if missing:
        return missing
    reply = ""
    for m in OO.inbound_rows(reads):
        if s_(m.get("candidateid")) == cid and s_(m.get("body")):
            reply = s_(m.get("body"))
    told = accepted_tell(run, cid, s_(c.get("candidatename")), s_(c.get("phone")), reply, run.by or "asa-hub:sweep")
    return run.final({"sent": told["emailed"], "emailed": told["emailed"], "sms_told": told["smsed"],
                      "reply_quoted": reply[:120]}, cid)


# ---- step 5.2 — the call instruction ---------------------------------------------------------------------------------

def screen_call_send(sess: L.Session, payload: dict) -> Decision:
    """hiringScreenCallSend: the candidate who said yes told to call the evaluation line, by letter and text."""
    run, p, refused = _open(sess, "hiringScreenCallSend", payload)
    if refused:
        return refused
    reads = run.reads
    cid, bad = _cid(p)
    if bad:
        return bad
    _ev, c, missing = _cand(reads, cid)
    if missing:
        return missing
    situation = HO.sid(reads, "screen_call")
    allow = HO.allowed(reads, situation)
    if not allow["ok"]:
        return _said({"sent": False, "reason": "situation_off", "detail": allow["reason"]})
    if _moved_on(c, "phone-screen"):
        run.answer(("screen_call",), "the card moved on — the machine lets go", cid)
        return run.final({"sent": False, "reason": "card_moved_on"}, cid)
    if any(s_(s.get("candidateid")) == cid for s in CND.read_tab(reads, CND.TALENT_PHONE_TAB)):
        run.answer(("screen_call",), "a screen is already on the record", cid)
        return run.final({"sent": False, "reason": "screen_recorded"}, cid)
    name = s_(c.get("candidatename"))
    first = HO.greet_first(name)
    line = HO.actors(reads)["screen_line"]
    if not line:
        return _said({"sent": False, "reason": "no_screen_line",
                      "detail": "sim_screen_line is empty — there is no number to tell them to call"})
    out: dict[str, Any] = {"sent": False, "email": None, "sms": None, "line": line}
    label = HL.line_label(line) or line

    def words(field: str, cfg_key: str, floor: str) -> str:
        v = HO.sit_cell(allow, field) or HO.sim_text(reads, cfg_key)
        return HO.fill(v or floor, {"first_name": first, "name": name, "screen_line": label, "line": label})
    email = s_(c.get("email"))
    reason = "hiring: telling the candidate to call the evaluation line"
    if "@" in email:
        letter = HL.screen_call({"name": name, "line": line,
                                 "subject": words("email_subject", "screen_call_subject",
                                                  HO.book(reads, "screen_call.subject.floor")),
                                 "bodyText": words("email_text", "screen_call_body",
                                                   HO.book(reads, "screen_call.body.floor"))})
        out["email"] = run.letter(step="screen_call", to=email, cc=HO.cc_for(reads, email), letter=letter,
                                  situation=situation, cid=cid, name=name, reason=reason)
    else:
        out["email"] = {"sent": False, "reason": "no_email"}
    out["sms"] = run.sms(step="screen_call", to=c.get("phone"),
                         body=words("sms_text", "screen_call_sms", HO.book(reads, "screen_call.sms.floor")),
                         intro=HO.quo_intro(reads, HO.book(reads, "purpose.screen_call")), situation=situation,
                         cid=cid, name=name, reason=reason)
    out["sent"] = bool(out["email"].get("sent") or out["sms"].get("sent"))
    out["redirected"] = bool(out["email"].get("redirected") or out["sms"].get("redirected"))
    if out["sent"]:
        run.track("screen_call", cid, "hiringScreenCallSend", {"candidate_id": cid})
    return run.final(out, cid)


# ---- step 5 — the referral who is only an e-mail ---------------------------------------------------------------------

def referral_book_set(run: Run, cid: str, fields: dict[str, str]) -> None:
    """referralBookSet_: the indications book's live row for this card, its cells set; no book or no row, nothing."""
    try:
        res = W.tab_of(run.reads, HO.REFERRALS_TAB)
    except (Defer, Unreadable):
        return
    if res.ref is None:
        return
    row = HO.referral_book_row(run.reads, cid)
    rid = s_((row or {}).get("referralid"))
    if not rid:
        return
    sid_, tab = W.where_of(res)
    heads = {gsjs.trim(gsjs.js_str(h)) for h in res.ref.headers}
    cells = {k: v for k, v in fields.items() if k in heads}
    if cells and "referral_id" in heads:
        run.recs.append(W.kept_record(sid_, tab, "edit", W.COLS + "referral_id", rid, cid, cells))


def resume_request_send(sess: L.Session, payload: dict) -> Decision:
    """hiringResumeRequestSend: the person themselves asked for the two things the process cannot start without — a
    phone and a résumé — and the ask entered in the book."""
    run, p, refused = _open(sess, "hiringResumeRequestSend", payload)
    if refused:
        return refused
    reads = run.reads
    situation = HO.sid(reads, "resume_request")
    allow = HO.allowed(reads, situation)
    if not allow["ok"]:
        return _said({"sent": False, "reason": allow["reason"]})
    cid, to, name = s_(p.get("candidate_id")), s_(p.get("to")), s_(p.get("name"))
    c = None
    if cid:
        _ev, c, missing = _cand(reads, cid)
        if missing:
            return missing
        to = to or s_(c.get("email"))
        name = name or s_(c.get("candidatename"))
    if not to:
        return _said({"sent": False, "reason": "no_email",
                      "detail": "this step is for somebody we can only reach by e-mail — and there is none"})
    who = s_(p.get("referrer"))
    if not who and cid:
        who = s_((HO.referral_book_row(reads, cid) or {}).get("referrername"))
    first = HO.greet_first(name)
    letter = HL.resume_request({
        "name": name, "referrer": who,
        # the Desk's words first, as every outreach door reads them; the simulation's text only under a blank cell
        "subject": HO.fill(HO.sit_cell(allow, "email_subject") or HO.sim_text(reads, "resume_request_subject"),
                           {"first_name": first, "name": name}),
        "bodyText": HO.fill(HO.sit_cell(allow, "email_text") or HO.sim_text(reads, "resume_request_body"),
                            {"first_name": first, "name": name,
                             "referrer": who or HO.book(reads, "resume_request.referrer.floor")})})
    res = run.letter(step="resume_request", to=to, cc=HO.cc_for(reads, to) if c and HO.rehearsal(reads, c) else "",
                     letter=letter, situation=situation, cid=cid, name=name,
                     reason="hiring: asking a referral for a resume and a phone")
    if cid and res["sent"]:
        run.track("resume_request", cid, "hiringResumeRequestSend", {"candidate_id": cid})
        referral_book_set(run, cid, {"state": "contacting"})
        run.journey({"candidate_id": cid, "name": name, "step": "resume_request", "channel": "email", "ok": True,
                     "detail": "the ask entered the book — re-asked on the configured clock; the ear reads their reply "
                               "for a phone, the folder scan for a resume", "by": run.by})
    return run.final(res, cid)


# ---- the background check --------------------------------------------------------------------------------------------

def cjis_attach(run: Run, cid: str, url: str, filename: str) -> None:
    """cjisAttach_: the report on the analysis row (never a verdict a person recorded), and its document row."""
    reads = run.reads
    a = CW.dissolved_rows(reads, CW.RESUME, [cid]).get(cid)
    if a is not None:
        fields = {}
        if s_(a.get("cjisstatus")).lower() in ("", "pending", "on file"):
            fields["cjis_status"] = "On file"
        if not s_(a.get("cjisreporturl")):
            fields["cjis_report_url"] = url
        if fields:
            run.recs += CW.facts_of(reads, CW.RESUME, cid, fields, run.by, cid, "", at=run.now)
    else:
        run.recs += CW.facts_of(reads, CW.RESUME, cid, {"candidate_id": cid, "cjis_status": "On file",
                                                        "cjis_report_url": url, "created_at": run.now,
                                                        "created_by": "asa-hub:cjis-folder"},
                                "runtime-sheet:append", cid, "", at=run.now)
    row_id = "DOC_" + secrets.token_hex(8).upper()
    run.recs += CW.facts_of(reads, CW.DOCS, row_id, {
        "doc_row_id": row_id, "candidate_id": cid, **CJIS_DOC, "status": "uploaded", "review_status": "pending",
        "file_url": url, "file_name": filename, "uploaded_by": "asa-hub:cjis-folder:" + run.by, "uploaded_at": run.now,
        "notes": "found in the CJIS folder — the report exists; the verdict is still a person's"},
        "runtime-sheet:append", cid, "", at=run.now)


def cjis_request_send(sess: L.Session, payload: dict) -> Decision:
    """hiringCjisRequestSend: the folder first; then the team asked for the CJIS result, the deciders nudged by
    text."""
    run, p, refused = _open(sess, "hiringCjisRequestSend", payload)
    if refused:
        return refused
    reads = run.reads
    cid, bad = _cid(p)
    if bad:
        return bad
    situation = HO.sid(reads, "cjis_request")
    allow = HO.allowed(reads, situation)
    if not allow["ok"]:
        return _said({"sent": False, "reason": allow["reason"]})
    ev, c, missing = _cand(reads, cid)
    if missing:
        return missing
    name = s_(c.get("candidatename"))
    a = ev.get("analysis") or {}
    if CND.cjis_cleared(a):
        return _said({"sent": False, "reason": "already_cleared",
                      "detail": name + " is already CJIS cleared with a report attached"})
    if s_(a.get("cjisstatus")).lower() == "on file":
        return _said({"sent": False, "reason": "already_on_file",
                      "detail": "a decider said the candidate sent it — the report lands in the folder whenever it "
                                "lands"})
    prep = _ready(sess, "hiringCjisRequestSend", p, cid, lambda: HO.cjis_ready(reads, cid, ev))
    if prep is None:
        return W.refuse(409, STALE)
    rehearsing = HO.rehearsal(reads, c)
    hit = prep.get("hit") if isinstance(prep.get("hit"), dict) else None
    if hit and s_(hit.get("fileId")):
        fname = s_(hit.get("filename"))
        if not rehearsing:
            cjis_attach(run, cid, HO.drive_file_url(s_(hit.get("fileId"))), fname)
        run.answer(("cjis_request",), "the report is in the folder (" + fname + ")", cid)
        run.journey({"candidate_id": cid, "name": name, "step": "cjis_request", "channel": "folder", "ok": True,
                     "detail": "the report is ALREADY in the designated folder (" + fname + ")"
                     + (" — a rehearsal match is shown, never attached" if rehearsing
                        else " — attached; nobody was asked for what we already have"), "by": run.by})
        return run.final({"sent": False, "reason": "already_in_folder", "filename": fname,
                          "attached": not rehearsing}, cid)
    addr = HO.team_address(reads) if rehearsing else None
    to = s_(p.get("to")) or (addr or {}).get("to") or ", ".join(HO.team_of(reads)["emails"])
    status = s_(a.get("cjisstatus"))
    letter = HL.cjis_request({"name": name, "folderUrl": HO.original_docs_url(reads), "status": status,
                              "subject": (HO.sit_cell(allow, "email_subject")
                                          or HO.sim_text(reads, "cjis_request_subject")).replace("{name}", name),
                              "bodyText": HO.fill(HO.sit_cell(allow, "email_text")
                                                  or HO.sim_text(reads, "cjis_request_body"),
                                                  {"name": name, "status": status})})
    res = run.letter(step="cjis_request", to=to, cc=(addr or {}).get("cc") or "", letter=letter, situation=situation,
                     cid=cid, name=name, reason="hiring: the background check is holding a candidate")
    if res["sent"]:
        body = ((HO.sit_cell(allow, "sms_text") or HO.sim_text(reads, "cjis_nudge_sms")).replace("{name}", name)
                or HO.book(reads, "cjis_request.sms.floor").replace("{name}", name))
        intro = HO.quo_intro(reads, HO.book(reads, "purpose.cjis_request").replace("{name}", name))
        smsed = 0
        for n in HO.actors(reads)["decider_sms"]:
            r = run.sms(step="cjis_request", to=n, body=body, intro=intro, situation=situation, cid=cid, name=name,
                        reason="hiring: asking the deciders whether the CJIS reached them")
            smsed += 1 if r["sent"] else 0
        run.track("cjis_request", cid, "hiringCjisRequestSend", {"candidate_id": cid})
        return run.final({"sent": True, "smsed": smsed, "email": res}, cid)
    return run.final(res, cid)


# ---- step 8 — the decision that belongs to a person ------------------------------------------------------------------

def decision_ask_send(sess: L.Session, payload: dict) -> Decision:
    """hiringDecisionAskSend (hiringDecisionAskCore_): the phone screen is read; the owners asked to advance or
    decline, by letter, and nudged by text."""
    run, p, refused = _open(sess, "hiringDecisionAskSend", payload)
    if refused:
        return refused
    reads = run.reads
    cid, bad = _cid(p)
    if bad:
        return bad
    situation = HO.sid(reads, "decision_ask")
    allow = HO.allowed(reads, situation)
    if not allow["ok"]:
        return _said({"sent": False, "reason": allow["reason"]})
    ev, c, missing = _cand(reads, cid)
    if missing:
        return missing
    s = ev.get("screen") or {}
    name = HO.short_name(c.get("candidatename"))
    rehearsing = HO.rehearsal(reads, c)
    cast = HO.actors(reads) if rehearsing else None
    addr = HO.team_address(reads) if rehearsing else None
    to = (addr or {}).get("to") or ", ".join(HO.team_of(reads)["emails"])
    letter = HL.decision_ask({"name": name, "score": s_(s.get("screenscore")), "summary": s_(s.get("qualification")),
                              "reportUrl": s_(s.get("phonescreenreporturl")),
                              "subject": (HO.sit_cell(allow, "email_subject")
                                          or HO.sim_text(reads, "decision_ask_subject")).replace("{name}", name),
                              "bodyText": (HO.sit_cell(allow, "email_text")
                                           or HO.sim_text(reads, "decision_ask_body")).replace("{name}", name)})
    res = run.letter(step="decision_ask", to=to, cc=(addr or {}).get("cc") or "", letter=letter, situation=situation,
                     cid=cid, name=name, reason="hiring: the owners decide after the phone screen")
    texts = []
    if p.get("sms") is not False:
        if cast and cast["decider_sms"]:
            numbers = cast["decider_sms"]
        elif cast and cast["team_sms"]:
            numbers = cast["team_sms"]
        else:
            numbers = SCD.cfg_list(reads.config().get("sms_recipients"))
        body = ((HO.sit_cell(allow, "sms_text") or HO.sim_text(reads, "decision_ask_sms")).replace("{name}", name)
                or HO.book(reads, "decision_ask.sms.floor").replace("{name}", name))
        intro = HO.quo_intro(reads, HO.book(reads, "purpose.decision_ask")) if rehearsing else ""
        for n in numbers:
            texts.append(run.sms(step="decision_ask", to=n, body=body, intro=intro, situation=situation, cid=cid,
                                 name=name, reason="hiring: nudging the owners for a decision"))
    res["sms"] = texts
    return run.final(res, cid)


# ---- step 11 — somebody leaves the process ---------------------------------------------------------------------------

def archive_and_tell(run: Run, cid: str, c: dict | None, reason: str, stage: str) -> dict[str, Any]:
    """hiringArchiveAndTell_: the archive marks on the card, then the team told by letter while the situation is
    on."""
    reads = run.reads
    out: dict[str, Any] = {"marked": False, "told": False}
    name = s_((c or {}).get("candidatename"))
    when = run.now
    run.recs += CW.facts_of(reads, CW.CANDIDATES, cid, {"archived": "true", "archived_at": when,
                                                        "archived_reason": reason}, run.by, cid, "", at=when)
    out["marked"] = True
    lane = HO.Lane(reads, HO.LEFT_SIT)
    if not lane.on or not lane.leg("email"):
        out["why"] = lane.why or "the situation hiring_candidate_left writes no letter"
        return out
    addr = HO.team_address(reads) if HO.rehearsal(reads, c) else None
    to = (addr or {}).get("to") or ", ".join(HO.team_of(reads)["emails"])
    vars_ = {"name": name or cid, "stage": stage, "reason": reason}
    letter = HL.discard({
        "name": name or cid, "reason": reason, "stage": stage, "when": when, "by": run.by,
        "subject": lane.word("email_subject", HO.sim_text(reads, "discard_subject").replace("{name}", name or cid),
                             vars_),
        "bodyText": lane.word("email_text", HO.sim_text(reads, "discard_body").replace("{name}", name or cid), vars_)})
    res = run.letter(step="discarded", to=to, cc=(addr or {}).get("cc") or "", letter=letter, situation=HO.LEFT_SIT,
                     cid=cid, name=name, reason="smart comms: hiring_candidate_left")
    out["told"], out["send"] = res["sent"], res
    return out


def discard(sess: L.Session, payload: dict) -> Decision:
    """hiringDiscard: out of the process — the status moved to Not Hiring through hubSetStatus_, the reason written on
    the card, the team told."""
    run, p, refused = _open(sess, "hiringDiscard", payload)
    if refused:
        return refused
    reads = run.reads
    cid, bad = _cid(p)
    if bad:
        return bad
    why = s_(p.get("reason"))
    if not why:
        return W.refuse(400, "a reason is required — the Archive is a record, not a bin")
    _ev, c, missing = _cand(reads, cid)
    if missing:
        return missing
    stage = HO.stage_of(c.get("status")) or s_(c.get("status"))
    run.recs += CW.status_move(sess, cid, c, "Not Hiring", "", run.now)
    done = archive_and_tell(run, cid, c, why, stage)
    res = dict(done.get("send") or {"sent": False, "reason": "the notice could not be built"})
    res.update(moved=True, archived=done["marked"], stage_was=stage)
    return run.final(res, cid)


# ---- the Added Manually machine: the first contact and its rungs -----------------------------------------------------

def manual_contact_send(sess: L.Session, payload: dict) -> Decision:
    """manualContactSend: first contact for a hand-added card — the opening chosen by how they got here, by text and
    by letter; a total refusal still enters the book, so the clock governs the retries."""
    run, p, refused = _open(sess, "manualContactSend", payload)
    if refused:
        return refused
    reads = run.reads
    cid, bad = _cid(p)
    if bad:
        return bad
    _ev, c, missing = _cand(reads, cid)
    if missing:
        return missing
    if _moved_on(c, "new"):
        run.answer(("manual_contact", "manual_adder"), "the card moved on — the machine lets go", cid)
        return run.final({"sent": False, "reason": "card_moved_on"}, cid)
    situation = HO.sid(reads, "manual_contact")
    allow = HO.allowed(reads, situation)
    if not allow["ok"]:
        return _said({"sent": False, "reason": "situation_off", "detail": allow["reason"]})
    name = s_(c.get("candidatename"))
    first = HO.greet_first(name)
    out: dict[str, Any] = {"sent": False, "email": None, "sms": None}
    origin = HO.manual_origin(c)
    opening = HO.book(reads, "open." + origin).replace("{first}", first)

    def words(field: str, cfg_key: str, floor: str) -> str:
        v = HO.sit_cell(allow, field) or HO.sim_text(reads, cfg_key)
        return HO.fill(v or floor, {"opening": opening, "first_name": first, "name": name})
    reason = "hiring: first contact for a hand-added card"
    stopped = _opted_out(reads, c.get("phone"))
    if stopped:
        out["sms"] = {"sent": False, "reason": "opted_out", "detail": stopped}
    if not out["sms"]:
        out["sms"] = run.sms(step="manual_contact", to=c.get("phone"),
                             body=words("sms_text", "manual_contact_sms", "{opening}"),
                             intro=HO.quo_intro(reads, HO.book(reads, "purpose.first_contact")), situation=situation,
                             cid=cid, name=name, reason=reason)
    email = s_(c.get("email"))
    if "@" in email:
        applied = origin == "applied"
        body = words("email_text", "manual_contact_body", HO.book(reads, "manual_contact.body.floor"))
        subject = words("email_subject", "manual_contact_subject", HO.book(reads, "manual_contact.subject.floor"))
        letter = HL.plain(subject, body, HO.book(reads, "manual_contact.title." + ("applied" if applied else "talk")),
                          HO.book(reads, "manual_contact.preheader." + ("applied" if applied else "talk")),
                          HO.book(reads, "manual_contact.footnote"))
        out["email"] = run.letter(step="manual_contact", to=email, cc=HO.cc_for(reads, email), letter=letter,
                                  situation=situation, cid=cid, name=name, reason=reason)
    else:
        out["email"] = {"sent": False, "reason": "no_email"}
    out["sent"] = bool(out["email"].get("sent") or out["sms"].get("sent"))
    out["redirected"] = bool(out["email"].get("redirected") or out["sms"].get("redirected"))
    if not out["sent"]:
        run.track("manual_contact", cid, "manualContactSend", {"candidate_id": cid})
        run.journey({"candidate_id": cid, "name": name, "step": "manual_contact", "channel": "record", "ok": False,
                     "title": "Nothing could be sent", "by": run.by,
                     "detail": "both legs refused (" + s_(out["sms"].get("reason") or out["sms"].get("error")) + " / "
                               + s_(out["email"].get("reason") or out["email"].get("error"))
                               + ") — the clock retries on the book, bounded by its attempts"})
    else:
        tracked = run.track("manual_contact", cid, "manualContactSend", {"candidate_id": cid})
        out["attempt"], out["attempts_max"] = tracked["attempt"], tracked["of"]
        if tracked["attempt"] == 1:
            run.journey({"candidate_id": cid, "name": name, "step": "manual_contact", "channel": "record", "ok": True,
                         "title": "The manual first-contact entered the book", "by": run.by,
                         "detail": "a hand-added card — both legs went through the outreach transports; re-asked on "
                                   "the manual clock until they answer, call the screen line, or whoever added them "
                                   "decides"})
    return run.final(out, cid)


def phone_collect_ask(sess: L.Session, payload: dict) -> Decision:
    """hiringPhoneCollectAsk: an e-mail-only candidate at New asked by letter for a number."""
    run, p, refused = _open(sess, "hiringPhoneCollectAsk", payload)
    if refused:
        return refused
    reads = run.reads
    cid, bad = _cid(p)
    if bad:
        return bad
    _ev, c, missing = _cand(reads, cid)
    if missing:
        return missing
    situation = HO.sid(reads, "phone_collect")
    allow = HO.allowed(reads, situation)
    if not allow["ok"]:
        return _said({"sent": False, "reason": "situation_off", "detail": allow["reason"]})
    if _moved_on(c, "new"):
        run.answer(("phone_collect",), "the card moved on — the machine lets go", cid)
        return run.final({"sent": False, "reason": "card_moved_on"}, cid)
    if s_(c.get("phone")):
        run.answer(("phone_collect",), "a phone is already on the card", cid)
        return run.final({"sent": False, "reason": "phone_present"}, cid)
    email = s_(c.get("email"))
    if "@" not in email:
        return _said({"sent": False, "reason": "no_email"})
    name = s_(c.get("candidatename"))
    first = HO.greet_first(name)
    said = {"first_name": first, "name": name}
    subject = HO.fill(HO.sit_cell(allow, "email_subject") or HO.book(reads, "phone_collect.subject.floor"), said)
    body = HO.fill(HO.sit_cell(allow, "email_text")
                   or HO.book(reads, "phone_collect.body.floor").replace("{first}", first), said)
    letter = HL.plain(subject, body, HO.book(reads, "phone_collect.title"), HO.book(reads, "phone_collect.preheader"),
                      HO.book(reads, "phone_collect.footnote"))
    res = run.letter(step="phone_collect", to=email, cc=HO.cc_for(reads, email), letter=letter, situation=situation,
                     cid=cid, name=name, reason="hiring: collecting a phone number by letter")
    if res["sent"]:
        run.track("phone_collect", cid, "hiringPhoneCollectAsk", {"candidate_id": cid})
    return run.final({"sent": res["sent"]}, cid)


def phone_confirm_send(sess: L.Session, payload: dict) -> Decision:
    """hiringPhoneConfirmSend: the number that arrived by letter texted — reply YES to confirm."""
    run, p, refused = _open(sess, "hiringPhoneConfirmSend", payload)
    if refused:
        return refused
    reads = run.reads
    cid, bad = _cid(p)
    if bad:
        return bad
    _ev, c, missing = _cand(reads, cid)
    if missing:
        return missing
    situation = HO.sid(reads, "phone_confirm")
    allow = HO.allowed(reads, situation)
    if not allow["ok"]:
        return _said({"sent": False, "reason": "situation_off", "detail": allow["reason"]})
    if _moved_on(c, "new"):
        run.answer(("phone_confirm",), "the card moved on — the machine lets go", cid)
        return run.final({"sent": False, "reason": "card_moved_on"}, cid)
    if not s_(c.get("phone")):
        return _said({"sent": False, "reason": "no_phone"})
    name = s_(c.get("candidatename"))
    first = HO.greet_first(name)
    body = HO.fill(HO.sit_cell(allow, "sms_text") or HO.book(reads, "phone_confirm.sms.floor"),
                   {"first_name": first, "name": name})
    res = run.sms(step="phone_confirm", to=c.get("phone"), body=body,
                  intro=HO.quo_intro(reads, HO.book(reads, "purpose.phone_confirm")), situation=situation, cid=cid,
                  name=name, reason="hiring: confirming the collected phone number")
    if res["sent"]:
        run.track("phone_confirm", cid, "hiringPhoneConfirmSend", {"candidate_id": cid})
    return run.final({"sent": res["sent"]}, cid)


def _resume_rung(run: Run, cid: str, name: str, c: dict, hit: str) -> dict[str, Any]:
    """manualResumeAskRun_: the folders first (a match attached, nobody asked), then the two legs."""
    reads = run.reads
    have = s_(c.get("resumelink"))
    if not have and hit:
        # resumeAttach (hubAttachResumeLink_): the link filled where the card has none
        run.recs += CW.facts_of(reads, CW.CANDIDATES, cid, {"resume_link": hit}, MANUAL_ACTOR, cid, "", at=run.now)
        have = hit
    if have:
        return {"have": True, "sent": False, "note": "the resume was already in the folders — collected, nobody asked"}
    lane = HO.Lane(reads, HO.MANUAL_RESUME_SIT)
    if not lane.on:
        return {"have": False, "sent": False, "note": lane.why}
    first = HO.greet_first(name)
    vars_ = {"name": name, "first_name": first}
    said = {"first_name": first, "name": name}
    reason = "smart comms: hiring_manual_resume_ask"
    body = lane.word("sms_text", HO.fill(HO.sim_text(reads, "manual_resume_sms"), said) or (
        "Great to hear from you, " + first + "! The next step is your resume — please e-mail it to asa-hub@asaop.org "
        "(replying to our letter works) and we take it from there."), vars_)
    rs = None if not lane.leg("sms") else run.sms(
        step="manual_contact", to=c.get("phone"), body=body,
        intro=HO.quo_intro(reads, HO.book(reads, "purpose.manual_resume")), situation=HO.MANUAL_RESUME_SIT, cid=cid,
        name=name, reason=reason, by=MANUAL_LADDER)
    floor = HO.book(reads, "manual_resume.referrer.floor")
    subject = HO.fill(re.sub(r"^REFERRAL\s*[-—]\s*", "", HO.sim_text(reads, "resume_request_subject"), flags=re.I),
                      {**said, "referrer": floor})
    text = HO.fill(HO.sim_text(reads, "resume_request_body"), {**said, "referrer": floor})
    letter = HL.resume_request({"name": name, "referrer": floor,
                                "subject": lane.word("email_subject",
                                                     subject or HO.book(reads, "manual_resume.subject.floor"), vars_),
                                "bodyText": lane.word("email_text", text, vars_)})
    rm = None if not lane.leg("email") else run.letter(
        step="manual_contact", to=c.get("email"), letter=letter, situation=HO.MANUAL_RESUME_SIT, reason=reason,
        by=MANUAL_LADDER)
    sms_ok, mail_ok = bool(rs and rs["sent"]), bool(rm and rm["sent"])
    return {"have": False, "sent": sms_ok or mail_ok,
            "note": "the resume asked by text" + ("" if sms_ok else " (text refused)") + " and by letter"
                    + ("" if mail_ok else " (letter refused)")}


def manual_resume_ask(sess: L.Session, payload: dict) -> Decision:
    """manualResumeAsk: the résumé ask as a rung — the folders read first, the ask entered in the book only when a
    leg went."""
    run, p, refused = _open(sess, "manualResumeAsk", payload)
    if refused:
        return refused
    reads = run.reads
    cid, bad = _cid(p)
    if bad:
        return bad
    _ev, c, missing = _cand(reads, cid)
    if missing:
        return missing
    if _moved_on(c, "new"):
        run.answer(("manual_resume",), "the card moved on — the machine lets go", cid)
        return run.final({"sent": False, "reason": "card_moved_on"}, cid)
    prep = _ready(sess, "manualResumeAsk", p, cid, lambda: HO.resume_ready(reads, cid, c))
    if prep is None:
        return W.refuse(409, STALE)
    res = _resume_rung(run, cid, s_(c.get("candidatename")), c, s_(prep.get("hit")))
    if res["have"]:
        run.answer(("manual_resume",), "the resume is on the card", cid)
        return run.final({"sent": False, "reason": "resume_present", "note": res["note"]}, cid)
    if res["sent"]:
        run.track("manual_resume", cid, "manualResumeAsk", {"candidate_id": cid})
    return run.final({"sent": res["sent"], "note": res["note"]}, cid)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "hiringWelcomeSend": welcome_send, "hiringAskSend": ask_send, "hiringShortlistSend": shortlist_send,
    "hiringInterestThanksSend": interest_thanks_send, "hiringOutreachSms": outreach_sms,
    "hiringOutreachSend": outreach_send, "hiringOutreachReplyCheck": reply_check,
    "hiringAcceptedNotify": accepted_notify, "hiringScreenCallSend": screen_call_send,
    "hiringResumeRequestSend": resume_request_send, "hiringCjisRequestSend": cjis_request_send,
    "hiringDecisionAskSend": decision_ask_send, "hiringDiscard": discard, "manualContactSend": manual_contact_send,
    "hiringPhoneCollectAsk": phone_collect_ask, "hiringPhoneConfirmSend": phone_confirm_send,
    "manualResumeAsk": manual_resume_ask}
_CID = {"candidate_id": "string"}
POLICY: dict[str, dict[str, Any]] = {a: {"roles": HO.WRITERS, "params": dict(_CID)} for a in ACTIONS}
POLICY["hiringWelcomeSend"]["params"] = {"to": "string"}
POLICY["hiringAskSend"]["params"] = {"to": "string"}
POLICY["hiringShortlistSend"]["params"] = {"candidate_ids": "array", "exclude_ids": "array", "limit": "number",
                                           "to": "string"}
POLICY["hiringInterestThanksSend"]["params"] = {"to": "string", "about": "string", "candidate_id": "string"}
POLICY["hiringOutreachSend"]["params"] = {"candidate_ids": "array", "candidate_id": "string"}
POLICY["hiringResumeRequestSend"]["params"] = {"candidate_id": "string", "to": "string", "name": "string",
                                               "referrer": "string"}
POLICY["hiringCjisRequestSend"]["params"] = {"candidate_id": "string", "to": "string"}
POLICY["hiringDecisionAskSend"]["params"] = {"candidate_id": "string", "sms": "boolean"}
POLICY["hiringDiscard"]["params"] = {"candidate_id": "string", "reason": "string"}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.hiring_outreach_writes and app.hiring_outreach_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="hiring_outreach", label="Hiring outreach")
