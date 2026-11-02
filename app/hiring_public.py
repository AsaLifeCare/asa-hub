"""The Hiring pipeline's public pages (InterviewFlow.gs interviewSlotContextPub_, CandidateForm.gs candFormContextPub_,
Referrals.gs referralSubmit_'s Drive and model half) read off asa-hub-db: a page somebody opens from a link without an
account — the candidate's or the interviewer's interview calendar, one candidate's shared form, the login page's
referral form — its own HMAC token under INTERVIEW_LINK_SECRET (or the referral's hourly throttle) its gate, never a
session. The writes they lead to are hiring_public_writes'."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import threading
import time
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import hiring_intake as HI
import hiring_intake_writes as HIW
import interview_flow as IF
import locations as L
import recon as R
from scope import Defer

s_ = CND.s_
# interviewPubThrottled_: each kind's knocks an hour, platform-wide
CAPS = {"ctx": 240, "slots": 60, "days": 60, "submit": 60}
THROTTLE_S = 3600.0
TOO_MANY = {"status": 429, "message": "Too many requests right now — please try again in a few minutes."}
NOT_VALID = "This link is no longer valid — please reach out and we will send a fresh one."
_ASK_TOKEN = re.compile(r"(ASK_[A-Z0-9]{6,})\.([A-Za-z0-9_-]{20,})")
# CandidateForm.gs: every failure the same answer, so the page cannot probe which ids exist
CAND_GONE = {"status": 404, "message": "This link is not valid or no longer active."}
CAND_FORM_PREFIX = "candform."
# the write a referral's prepared résumé is sealed for
REFERRAL = "referralSubmit"
REFERRALS_FULL = {"status": 429, "message": "Too many referrals right now — please try again later."}
_KNOCKS: dict[str, tuple[int, float]] = {}
_KNOCKS_LOCK = threading.Lock()


def throttled(kind: str) -> bool:
    """interviewPubThrottled_: the kind's knocks this hour, the window renewed by each one let through."""
    with _KNOCKS_LOCK:
        now = time.time()
        n, until = _KNOCKS.get(kind, (0, 0.0))
        if now > until:
            n = 0
        if n >= CAPS[kind]:
            return True
        _KNOCKS[kind] = (n + 1, now + THROTTLE_S)
        return False


def payload_of(payload: Any) -> dict:
    return payload if isinstance(payload, dict) else {}


def secret(reads: L.Reads) -> str:
    """interviewLinkSecret_; a key the copy withholds is Apps Script's to check."""
    v = s_(reads.db.prop(IF.SECRET_PROP))
    if v.startswith(CW.COPY_MARKER):
        raise Defer("the copy withholds the links' key")
    return v


def sig_equal(a: Any, b: Any) -> bool:
    """interviewSigEqual_: same length, compared in constant time."""
    x, y = "" if a is None else str(a), "" if b is None else str(b)
    return bool(x) and bool(y) and len(x) == len(y) and hmac.compare_digest(x.encode("utf-8"), y.encode("utf-8"))


def _sig(key: str, text: str) -> str:
    mac = hmac.new(key.encode("utf-8"), text.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode("ascii").rstrip("=")


def token_sig(reads: L.Reads, ask_id: str, candidate_id: str) -> str:
    """interviewTokenSig_: '' while no key is set."""
    key = secret(reads)
    return _sig(key, ask_id + "." + candidate_id) if key else ""


def last_ask(reads: L.Reads, ask_id: str) -> dict | None:
    hit = None
    for r in IF.ask_rows(reads):
        if s_(r.get("askid")) == ask_id:
            hit = r
    return hit


def ask_by_days_token(reads: L.Reads, t: Any) -> dict | None:
    """interviewAskByDaysToken_: the interviewer's own link — the HMAC over the ask and the word 'days'."""
    raw = "" if t is None else str(t)
    dot = raw.find(".")
    if dot < 1:
        return None
    ask_id, sig = raw[:dot], raw[dot + 1:]
    if not sig_equal(sig, token_sig(reads, ask_id, "days")):
        return None
    return last_ask(reads, ask_id)


def ask_by_token(reads: L.Reads, t: Any) -> dict | None:
    """interviewAskByToken_: the candidate's personal link — the HMAC over the ask and its candidate."""
    m = _ASK_TOKEN.fullmatch("" if t is None else str(t))
    if not m or not secret(reads):
        return None
    hit = last_ask(reads, m.group(1))
    if hit is None:
        return None
    expected = token_sig(reads, m.group(1), s_(hit.get("candidateid")))
    return hit if expected and sig_equal(m.group(2), expected) else None


def first_word(name: Any) -> str:
    """str_(name).split(/\\s+/)[0] || ''."""
    return re.split(r"\s+", s_(name))[0]


def parsed(text: Any) -> Any:
    """JSON.parse(str_(x) || '[]') || [], a failure read as []."""
    try:
        got = json.loads(s_(text) or "[]")
    except ValueError:
        return []
    return got or []


def booked_when(ask: dict) -> str:
    day = s_(ask.get("confirmeddate"))
    return " for " + IF.slot_label(day, s_(ask.get("confirmedtime"))) if day else ""


# ---- the interview calendar (interviewSlotContextPub_) --------------------------------------------------------------

def slot_context(sess: L.Session, payload: dict) -> dict[str, Any]:
    """interviewSlotContext: what the page draws — the interviewer's own link opens her slot calendar; the candidate's
    the offered times, or the open grid with what is taken and the days she allowed."""
    if throttled("ctx"):
        return dict(TOO_MANY)
    reads = sess.reads
    p = payload_of(payload)
    d_ask = ask_by_days_token(reads, p.get("t"))
    if d_ask is not None:
        if s_(d_ask.get("state")) == "confirmed":
            return {"status": 409, "message": "This interview is already booked" + booked_when(d_ask) +
                    " — it is on the Calendar app, and there is nothing more to pick here."}
        return {"status": 200, "data": {
            "mode": "slots", "candidate_first": first_word(d_ask.get("candidatename")),
            "slots_wanted": 6 if s_(d_ask.get("supervisorreply")) == "candidate_rejected_slots" else 3,
            "chosen_slots": parsed(d_ask.get("slotsjson")), "times": list(IF.SLOT_TIMES),
            "taken": IF.taken_slots(reads), "horizon_days": 30}}
    ask = ask_by_token(reads, p.get("t"))
    if ask is None:
        return {"status": 404, "message": NOT_VALID}
    first = first_word(ask.get("candidatename"))
    state = s_(ask.get("state"))
    if state == "confirmed":
        return {"status": 409, "message": "Your interview is already booked" + booked_when(ask) +
                ". If you need to move it, reply to our message and we will help."}
    if state == "slots_offered":
        got = parsed(ask.get("slotsjson"))
        slots = [{"date": s_(x.get("date")), "time": s_(x.get("time"))} for x in (got if isinstance(got, list) else [])
                 if isinstance(x, dict) and IF.slot_ok(s_(x.get("date")), s_(x.get("time")))]
        if slots:
            return {"status": 200, "data": {"candidate_first": first, "mode": "choose3", "slots": slots,
                                            "times": list(IF.SLOT_TIMES)}}
        # an unreadable offer falls back to the open grid, not to a dead page
    return {"status": 200, "data": {"candidate_first": first, "mode": "pick", "taken": IF.taken_slots(reads),
                                    "times": list(IF.SLOT_TIMES), "allowed_days": IF.allowed_days(ask)}}


# ---- the shared candidate form (candFormContextPub_) ----------------------------------------------------------------

def cand_form_cid(reads: L.Reads, t: Any) -> str:
    """candFormCidByToken_: the candidate a shared link names, its HMAC checked; '' for any other link."""
    raw = "" if t is None else str(t)
    dot = raw.find(".")
    if dot < 1:
        return ""
    cid, sig = raw[:dot], raw[dot + 1:]
    if not re.fullmatch(r"CAN_[A-Za-z0-9]{6,}", cid, re.A):
        return ""
    key = secret(reads)
    return cid if sig_equal(sig, _sig(key, CAND_FORM_PREFIX + cid) if key else "") else ""


CARD_FIELDS = ("id", "name", "role", "stage", "source", "appliedAt", "email", "phone", "city", "state", "resumeLink",
               "resumeFileLabel", "summary", "screenDate", "screenResult", "owner")


def cand_form_context(sess: L.Session, payload: dict) -> dict[str, Any]:
    """candFormContext: the card's picked fields only (a column added to the board never leaks through a minted
    link), and the gate its Move button reads."""
    reads = sess.reads
    cid = cand_form_cid(reads, payload_of(payload).get("t"))
    if not cid:
        return dict(CAND_GONE)
    rec, why = CND.soft(lambda: CND.board(reads)["byId"].get(cid))
    if why or not rec:
        return dict(CAND_GONE)
    gate: dict[str, Any] = {"ok": False, "to": "", "missing": []}
    g, why = CND.soft(lambda: CND.stage_gate(reads, CND.evidence(reads, cid)))
    if not why and isinstance(g, dict):
        # the record still draws; only the Move button dims
        gate = {"ok": bool(g.get("ok")), "to": s_(g.get("to")), "missing": g.get("reasons") or []}
    card = {k: s_(rec.get(k)) for k in CARD_FIELDS}
    CW.marked(*card.values())
    card.update(daysInStage=rec.get("daysInStage"), score=rec.get("score"),
                summaryTimeline=rec.get("summaryTimeline") or [], checklist=rec.get("checklist") or [])
    return {"status": 200, "data": {"candidate": card, "gate": gate}}


# ---- the referral form's Drive and model half (referralSubmit_) ----------------------------------------------------

def referral_by(p: dict) -> str:
    """The referral a prepared résumé is sealed to: its name and contact as the form sent them."""
    f = HI.referral_fields(p)
    return "referral:" + hashlib.sha256("\x1f".join((f["name"], f["phone"], f["email"])).encode()).hexdigest()[:24]


def referrals_full() -> bool:
    """referralSubmit_'s hourly wall, looked at without knocking: the write counts the knock."""
    with HIW._THROTTLE_LOCK:
        return time.time() <= HIW._THROTTLE["until"] and HIW._THROTTLE["count"] >= HIW.REFERRALS_PER_HOUR


def referral_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """referralSubmit's slow half: a résumé stored and read when the form named no contact, the contact it names, and
    the résumé's link once the write would open a card — sealed for the write; the hourly wall says no first."""
    if referrals_full():
        return dict(REFERRALS_FULL)
    p = payload_of(payload)
    return {"status": 200, "data": R.seal(REFERRAL, referral_by(p), HI.referral_prepare(sess.reads, p))}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "interviewSlotContext": slot_context, "candFormContext": cand_form_context,
    "referralSubmitPrepare": referral_prepare}
# no HUB_POLICY: each link's token, or the referral's throttle, is the door's gate
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
# what nobody's account may ask
PUBLIC = frozenset(ACTIONS)
