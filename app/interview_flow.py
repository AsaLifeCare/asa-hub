"""The interview scheduler (InterviewFlow.gs) off asa-hub-db: the ask book (interview_asks, a dissolved tab), the
personal links (HMAC over the ask), the company's three periods and the letters, shared with its writes
(interview_flow_writes); and the looks the relay's clock asks first — who at Interview is waiting to be asked
(interviewStartDue) and the interviewer's replies read off the Quo mirror and the platform mailbox, each judged by the
rule or the model (interviewAskDue, interviewAskPrepare for interviewAskSweepNow)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
from datetime import date
from typing import Any, Callable

import candidates as CND
import gsjs
import hiring_hired as HH
import hubdb
import locations as L
import mail_designs as MD
import recon as R
import staff_comms as SCM

log = logging.getLogger("asa-hub-app")
s_ = CND.s_
ASKS = CND.INTERVIEW_ASKS_TAB
ASKS_HEADER = ("ask_id", "candidate_id", "candidate_name", "candidate_email", "candidate_phone", "state", "invited_at",
               "invited_by", "picked_date", "picked_time", "supervisor_asked_at", "supervisor_reply", "slots_json",
               "offered_at", "confirmed_date", "confirmed_time", "confirmed_at", "updated_at", "days_asked_at",
               "allowed_days_json", "days_chosen_at")
AI_TAB = "interview_ask_ai"
SECRET_PROP = "INTERVIEW_LINK_SECRET"
CURSOR = "HUB_INTERVIEW_ASK_CURSOR"
BATCH_ROWS = 800
SLOT_TIMES = ("10:00", "14:00", "17:00")
LINK_BASE = "https://asamylife.asalifecare.com/interview.html?t="
START_PER_PASS = 5
QUO_TAB = "Messages"
# InterviewFlow.gs INTERVIEW_ASK_FALLBACK: the floor under the Smart Comms cells
FALLBACK = {
    "invite_sms": "Hi {first_name}, this is ASA Lifecare — time to book your in-person interview. Pick the day and hour "
                  "here: {link} (this link is personal to you).",
    "supervisor_ask": "{candidate} picked {slot} for the in-person interview — reply YES to confirm or NO to propose "
                      "times.",
    "slots_request": "Could you give me three day/time slots that work best for you?",
    "slots_offer_sms": "Hi {first_name}, our supervisor offered three times for your interview: {slots}. Pick yours "
                       "here: {link}",
    "confirmed_sms": "Booked: {candidate} — {slot}. Thank you!",
    "confirmed_subject": "Interview booked — {candidate}",
}
# the situations each message speaks through (commSituationId_'s keys and shipped ids)
INVITE = ("hiring.interview.invitation", "interview_invite")
SLOTS_ASK = ("hiring.interview.slots_request", "interview_slots_ask")
DAYS_ASK = ("hiring.interview.days_request", "interview_days_ask")
SLOTS_REQUEST = ("hiring.interview.supervisor_slots", "interview_supervisor_slots_request")
CONFIRMED = ("hiring.interview.confirmed", "interview_confirmed")
SLOTS_OFFER = ("hiring.interview.slots_offer", "interview_slots_offer")
CANDIDATE_CONFIRMED = ("hiring.interview.candidate_confirmed", "interview_candidate_confirmed")
HIRING_EYEBROW = "ASA LifeCare · Hiring"
_WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


# ---- the ask book -------------------------------------------------------------------------------------------------

def ask_rows(reads: L.Reads) -> list[dict]:
    """interviewAskRows_: no tab yet is no asks."""
    return CND.ask_rows(reads)


def open_for(rows: list[dict], cid: str) -> dict | None:
    """interviewAskOpenFor_: the candidate's open ask (last wins)."""
    hit = None
    for r in rows:
        if s_(r.get("candidateid")) == cid and s_(r.get("state")) != "confirmed":
            hit = r
    return hit


def is_rehearsal_ask(ask: dict | None) -> bool:
    """interviewAskIsRehearsal_."""
    return s_((ask or {}).get("candidatename")).lower().startswith("[test]")


def waiting(rows: list[dict], states: tuple[str, ...], want_rehearsal: bool | None) -> dict | None:
    """interviewAskWaiting_: the ask most recently waiting in one of these states."""
    hit = None
    for r in rows:
        if s_(r.get("state")) not in states:
            continue
        if want_rehearsal is True and not is_rehearsal_ask(r):
            continue
        if want_rehearsal is False and is_rehearsal_ask(r):
            continue
        if hit is None or s_(r.get("updatedat")) > s_(hit.get("updatedat")):
            hit = r
    return hit


def allowed_days(ask: dict | None) -> list[str]:
    """interviewAllowedDays_: [] is every day open."""
    try:
        got = json.loads(s_((ask or {}).get("alloweddaysjson")) or "[]") or []
    except ValueError:
        return []
    return [d for d in got if isinstance(d, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", d)] if isinstance(got, list) \
        else []


# ---- the personal links (HMAC over the ask) -------------------------------------------------------------------------

def secret(reads: L.Reads) -> str:
    """INTERVIEW_LINK_SECRET as this service holds it (the copy withholds it): the same key Apps Script signs with."""
    v = s_(reads.db.prop(SECRET_PROP))
    return "" if v.startswith("[withheld") else v


def token_sig(reads: L.Reads, ask_id: str, candidate_id: str) -> str:
    """interviewTokenSig_: base64url HMAC-SHA256 over ask_id + '.' + candidate_id, unpadded."""
    key = secret(reads)
    if not key:
        return ""
    mac = hmac.new(key.encode("utf-8"), (ask_id + "." + candidate_id).encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode("ascii").rstrip("=")


def token_for(reads: L.Reads, ask_id: str, candidate_id: str) -> str:
    sig = token_sig(reads, ask_id, candidate_id)
    return ask_id + "." + sig if sig else ""


def days_token_for(reads: L.Reads, ask_id: str) -> str:
    """interviewDaysTokenFor_: the interviewer's own link."""
    sig = token_sig(reads, ask_id, "days")
    return ask_id + "." + sig if sig else ""


# ---- the slots ------------------------------------------------------------------------------------------------------

def slot_ok(day: str, time: str) -> bool:
    """interviewSlotShapeOk_."""
    return bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", s_(day))) and s_(time) in SLOT_TIMES


def time_label(t: str) -> str:
    """interviewTimeLabel_."""
    m = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)", s_(t))
    if not m:
        return s_(t)
    h = int(m.group(1))
    return f"{h % 12 or 12}:{m.group(2)} {'PM' if h >= 12 else 'AM'}"


def slot_label(day: str, time: str) -> str:
    """interviewSlotLabel_: 'Tuesday, Sep 1 at 2:00 PM', built from parts."""
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s_(day))
    if not m:
        return s_(day) + (" at " + time if time else "")
    try:
        d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return s_(day) + (" at " + time if time else "")
    return f"{_WEEKDAYS[d.weekday()]}, {_MONTHS[d.month - 1]} {d.day}" + (" at " + time_label(time) if time else "")


def today_text(reads: L.Reads) -> str:
    """interviewTodayText_: today where the company is."""
    return reads.now.astimezone(CND._zone_of(reads)).strftime("%Y-%m-%d")


def slots_valid(slots: Any, today: str) -> list[dict[str, str]]:
    """interviewSlotsValid_: one to six future weekdays inside the company's periods, no duplicate — else none."""
    if not isinstance(slots, list) or not slots or len(slots) > 6:
        return []
    out, seen = [], set()
    for s in slots:
        s = s if isinstance(s, dict) else {}
        day, time = s_(s.get("date")), s_(s.get("time"))
        if not slot_ok(day, time) or day <= s_(today):
            return []
        try:
            d = date(int(day[:4]), int(day[5:7]), int(day[8:10]))
        except ValueError:
            return []
        if d.weekday() >= 5 or day + "T" + time in seen:
            return []
        seen.add(day + "T" + time)
        out.append({"date": day, "time": time})
    return out


def _events(reads: L.Reads) -> list[dict]:
    got, why = CND.soft(lambda: CND.read_tab(reads, CND.HIRING_EVENTS_TAB))
    return [] if why else got or []


def taken_slots(reads: L.Reads) -> list[str]:
    """interviewTakenSlots_."""
    out = []
    for r in _events(reads):
        if s_(r.get("eventtype")) != "in_person_interview" or s_(r.get("status")).lower() == "cancelled":
            continue
        day, tm = CND.hiring_date(r.get("date")), CND.hiring_time(r.get("time"))
        if day and tm:
            out.append(day + "T" + tm)
    return out


def last_location(reads: L.Reads) -> str:
    """interviewLastLocation_: the last confirmed one's place, or Office."""
    loc = ""
    for r in _events(reads):
        if s_(r.get("eventtype")) == "in_person_interview" and s_(r.get("location")):
            loc = s_(r.get("location"))
    return loc or "Office"


# ---- who is asked -------------------------------------------------------------------------------------------------

def supervisor(reads: L.Reads) -> dict[str, str]:
    """interviewSupervisor_: the badge decides."""
    return HH.interviewer_pick(reads, "")


def supervisor_for(reads: L.Reads, ask: dict | None) -> dict[str, str]:
    """interviewSupervisorFor_: a rehearsal's ask goes to the simulation's interviewer actor."""
    if is_rehearsal_ask(ask):
        a = HH.actors(reads)
        if a["interviewer_email"] or a["interviewer_phone"]:
            return {"name": a["interviewer_name"] or "the simulation interviewer", "email": a["interviewer_email"],
                    "phone": a["interviewer_phone"], "user_id": "",
                    "by": "the simulation interviewer actor — this ask is about a rehearsal card"}
    return supervisor(reads)


# ---- the letters (MailTemplates.gs, MailTemplatesHiring.gs) --------------------------------------------------------

def invite_email(o: dict[str, Any]) -> dict[str, str]:
    """interviewInviteEmail_: the candidate's calendar link, or the offered three."""
    name = s_(o.get("name")).strip()
    first = (name.split() or [""])[0] or name
    link = s_(o.get("link"))
    slots = list(o.get("slots") or [])
    body_text = s_(o.get("bodyText"))
    greeting = "Hi " + first + "," if first else "Hello,"
    if body_text:
        blocks = [MD.mail_para(MD.mail_esc(p).replace("\n", "<br>")) for p in re.split(r"\n{2,}", body_text)]
        text = body_text + "\n"
    else:
        blocks = [MD.mail_para(MD.mail_esc(greeting) + " thank you for talking with ASA LifeCare — the next step in our "
                               "conversation about the role is your in-person interview.")]
        if slots:
            blocks.append(MD.mail_para("Our supervisor offered these times. Open your calendar and choose the one that "
                                       "works for you:"))
            blocks.append(MD.mail_steps([MD.mail_esc(x) for x in slots]))
        else:
            blocks.append(MD.mail_para("Pick the day and the hour that suit you best — it takes under a minute, and our "
                                       "team confirms it right away."))
        text = (greeting + "\n\nThank you for talking with ASA LifeCare — the next step in our conversation about the "
                "role is your in-person interview.\n\n" +
                ("Our supervisor offered these times:\n" + "\n".join(f"  {i + 1}. {x}" for i, x in enumerate(slots)) +
                 "\n\nChoose yours here: " + link + "\n\n" if slots else
                 "Pick the day and the hour that suit you best here: " + link + "\n\n") +
                "This link is personal to you — please do not forward it.\n")
    return {"subject": s_(o.get("subject")) or ("Three times for your interview — pick one" if slots
                                                 else "Pick your interview time — ASA LifeCare"),
            "text": text,
            "html": MD.mail_shell({"eyebrow": "ASA LifeCare",
                                   "title": "Choose your interview time" if slots else "Pick your interview time",
                                   "preheader": "Choose the day and hour of your in-person interview.", "blocks": blocks,
                                   "cta": {"label": "Choose a time" if slots else "Pick my time", "href": link},
                                   "footnote": "This link is personal to you — it opens your own appointment and nobody "
                                               "else's. If you did not expect it, you can ignore it."})}


def thanks_email(o: dict[str, Any]) -> dict[str, str]:
    """interviewerThanksEmail_: the interviewer told it is booked."""
    interviewer = s_(o.get("interviewer")).strip()
    first = (interviewer.split() or [""])[0]
    name, slot, where = s_(o.get("name")).strip(), s_(o.get("slot")).strip(), s_(o.get("location")).strip()
    body_text = s_(o.get("bodyText")).strip()
    blocks = MD.mail_body_blocks(body_text) if body_text else [
        MD.mail_para(("Thank you, " + MD.mail_esc(first) + "." if first else "Thank you.") + " It is booked and <strong>" +
                     MD.mail_esc(name) + "</strong> has been told.")]
    blocks.append(MD.mail_fact("Interview", name + (" — " + slot if slot else "")))
    if where:
        blocks.append(MD.mail_fact("Where", where))
    if not body_text:
        blocks.append(MD.mail_para("It is on the hiring calendar and on your own. The scorecard opens on the platform the "
                                   "day before and stays open for two days afterwards."))
    text = ((body_text or "Thank you" + (", " + first if first else "") + ". It is booked and " + name +
             " has been told.") + "\n\nInterview: " + name + (" — " + slot if slot else "") + "\n" +
            ("Where: " + where + "\n" if where else "") +
            ("" if body_text else "\nIt is on the hiring calendar. The scorecard opens the day before and stays open "
                                  "for two days afterwards.\n"))
    return {"subject": s_(o.get("subject")) or ("Booked — " + name + (", " + slot if slot else "")), "text": text,
            "html": MD.mail_shell({"eyebrow": HIRING_EYEBROW, "title": "The interview is booked",
                                   "preheader": name + (" — " + slot if slot else "") + " is on the calendar.",
                                   "blocks": blocks, "footnote": "Nothing else is needed from you until the interview "
                                                                 "itself."})}


# ---- the replies: the rule, then the model (interviewReplyVerdict_, interviewAskClassifyAi_) -----------------------

def reply_verdict(body: Any) -> str:
    """Whole-message YES/NO; anything partial goes to the model."""
    s = re.sub(r"[!.…\s]+$", "", s_(body).strip().lower())
    if re.fullmatch(r"(yes|y|yep|yeah|confirm|confirmed|ok|okay|sounds good|that works|works|sim)", s):
        return "yes"
    if re.fullmatch(r"(no|n|nope|nao|não|does not work|doesnt work)", s):
        return "no"
    return ""


def classify_ai(reads: L.Reads, body: str, today: str) -> dict[str, Any] | None:
    """One model look per message: {verdict, slots, via}, or None when no provider answered."""
    import hotline as HL  # noqa: PLC0415 - the model door (Groq)
    tpl, why = CND.soft(lambda: CND.book_kv(reads, "Prompts").get("ai_interview_reply", ""))
    if why or not tpl:
        return None
    ask = tpl.replace("{today}", today).replace("{message}", s_(body)[:800])
    content, via = HL.answer(ask)
    if not content:
        return None
    m = re.search(r"\{[\s\S]*\}", content)
    try:
        parsed = json.loads(m.group(0) if m else content)
    except ValueError:
        return None
    if not isinstance(parsed, dict):
        return None
    v = s_(parsed.get("verdict")).lower()
    if v not in ("yes", "no", "slots", "other"):
        return None
    slots = parsed.get("slots")[:3] if v == "slots" and isinstance(parsed.get("slots"), list) else None
    return {"verdict": v, "slots": slots, "via": via or "ai"}


def judged(reads: L.Reads) -> dict[str, str]:
    """The memo of verdicts already given (interview_ask_ai), by message id."""
    rows, why = CND.soft(lambda: CND.read_tab(reads, AI_TAB))
    return {} if why else {s_(r.get("messageid")): s_(r.get("verdict")) for r in rows or [] if s_(r.get("messageid"))}


def mail_scan(reads: L.Reads, sup: dict, rehearsal: bool, memo: dict[str, str], today: str) -> dict[str, Any]:
    """interviewAskMailScan_ up to its writes: the interviewer's letters in the platform mailbox, each judged once."""
    out: dict[str, Any] = {"read": 0, "judged": 0, "acted": 0, "source": "mailbox", "rehearsal": rehearsal, "items": []}
    hers = s_(sup.get("email")).strip().lower()
    if not hers:
        return out
    threads = HH.mailbox_threads(30)
    if threads is None:
        log.warning("interview_ask_mailbox_unreadable")
        out["unreadable"] = True
        return out
    for t in threads:
        frm = s_(t.get("from_addr")).lower()
        if not frm or hers not in frm:
            continue
        out["read"] += 1
        mid = "mail:" + (s_(t.get("id")) or (s_(t.get("date")) + "|" + s_(t.get("subject"))))
        if mid in memo:
            continue
        body = s_(t.get("snippet"))
        if not body:
            continue
        verdict, slots, via = reply_verdict(body), None, "rule:mail"
        if not verdict:
            ai = classify_ai(reads, body, today)
            if ai is None:
                continue
            verdict, slots, via = ai["verdict"], ai["slots"], s_(ai["via"]) + ":mail"
        memo[mid] = verdict
        out["judged"] += 1
        out["items"].append({"mid": mid, "verdict": verdict, "slots": slots, "via": via, "rehearsal": rehearsal})
    return out


def ask_look(reads: L.Reads) -> dict[str, Any]:
    """interviewAskSweepRun_ up to its writes: the waiting asks' interviewers heard by e-mail and on the Quo mirror past
    the cursor, every new reply judged; the cursor never passes a message the model has not judged."""
    rows = ask_rows(reads)
    waiting_rows = [r for r in rows if s_(r.get("state")) in ("supervisor_asked", "slots_requested")]
    if not waiting_rows:
        return {"waiting": 0, "items": []}
    real = [r for r in waiting_rows if not is_rehearsal_ask(r)]
    sim = [r for r in waiting_rows if is_rehearsal_ask(r)]
    ears = []
    if real:
        ears.append({"sup": supervisor(reads), "rehearsal": False})
    if sim:
        ears.append({"sup": supervisor_for(reads, sim[0]), "rehearsal": True})
    memo = judged(reads)
    today = today_text(reads)
    out: dict[str, Any] = {"waiting": len(waiting_rows), "items": [], "mail": []}
    for ear in ears:
        m = mail_scan(reads, ear["sup"], ear["rehearsal"], memo, today)
        out["items"] += m.pop("items")
        out["mail"].append(m)
    digits_for: dict[str, bool] = {}
    for ear in ears:
        d = re.sub(r"\D", "", s_(ear["sup"].get("phone")))[-10:]
        if d:
            digits_for[d] = ear["rehearsal"]
    if not digits_for:
        if not any(s_(ear["sup"].get("email")) for ear in ears):
            log.info("interview_ask_no_supervisor: nobody holds the INTERVIEWER badge with a phone or an address — %s",
                     s_(ears[0]["sup"].get("by")) if ears else "no ask waiting")
        return out
    sid = gsjs.trim(gsjs.or_blank(reads.db.prop("QUO_SYNC_SHEET_ID")))
    ref = reads.db.tab(sid, QUO_TAB) if sid else None
    if ref is None:
        out["mirror"] = False
        return out
    import opt_outs as OO  # noqa: PLC0415 - the Quo mirror's window as the inbound lane reads it
    last = OO._last_row(reads, ref)
    if last < 2:
        out["rows"] = 0
        return out
    cursor = HH.mark(reads, CURSOR)
    n = CND.js_parse_int(cursor)
    if not cursor or n != n or n < 0:
        out["init_cursor"] = last
        return out
    frm = max(2, int(n) + 1)
    if frm > last:
        out["behind"] = 0
        return out
    heads = {hubdb.norm_key(h): h for h in ref.headers}
    i_id, i_status, i_ext, i_body = (heads.get("messageid"), heads.get("status"), heads.get("externalparticipants"),
                                     heads.get("body"))
    if i_id is None or i_status is None or i_body is None:
        out["mirror"] = False
        return out
    count = min(BATCH_ROWS, last - frm + 1)
    window = OO._window(reads, ref, frm, frm + count - 1)
    direct = SCM._direct(reads, sid)

    def g(r: dict, h: str | None) -> str:
        return "" if h is None else s_(SCM._typed(r.get(h), direct))
    first_unjudged = -1
    for i in range(count):
        r = window.get(frm + i) or {}
        if g(r, i_status).lower() != "received":
            continue
        digits = re.sub(r"\D", "", g(r, i_ext))[-10:]
        if digits not in digits_for:
            continue
        mid = g(r, i_id)
        if not mid or mid in memo:
            continue
        body = g(r, i_body)
        verdict, slots, via = reply_verdict(body), None, "rule"
        if not verdict:
            ai = classify_ai(reads, body, today)
            if ai is None:
                if first_unjudged == -1:
                    first_unjudged = frm + i
                continue
            verdict, slots, via = ai["verdict"], ai["slots"], ai["via"]
        memo[mid] = verdict
        out["items"].append({"mid": mid, "verdict": verdict, "slots": slots, "via": via,
                             "rehearsal": digits_for[digits]})
    reached = frm + count - 1
    out["cursor"] = reached if first_unjudged == -1 else first_unjudged - 1
    out["reached"] = reached
    return out


# ---- the doors the relay asks first --------------------------------------------------------------------------------

def start_plan(reads: L.Reads) -> list[str]:
    """interviewStartSweepMaybe_'s look: the cards at Interview nobody has asked about yet (five a pass)."""
    booked = {s_(r.get("candidateid")) for r in CND.read_tab(reads, ASKS) if s_(r.get("candidateid"))}
    out: list[str] = []
    for c in HH.cands(reads):
        if len(out) >= START_PER_PASS:
            break
        cid = s_(c.get("candidateid"))
        if HH.archived(c) or CND.stage_of(c.get("status")) != "interview" or not cid or cid in booked:
            continue
        booked.add(cid)
        out.append(cid)
    return out


def start_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    if not HH.service(sess):
        return dict(HH.SERVICE_ONLY)
    cids = start_plan(sess.reads)
    return {"status": 200, "data": {"cards": cids, "due": len(cids)}}


def ask_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The ear's look on the relay's clock, sealed for interviewAskSweep."""
    if not HH.service(sess):
        return dict(HH.SERVICE_ONLY)
    look = ask_look(sess.reads)
    due = len(look.get("items") or []) + (1 if look.get("init_cursor") or look.get("cursor") is not None else 0)
    return {"status": 200, "data": R.seal("interviewAskSweep", "service", {**look, "due": due})}


def ask_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """interviewAskSweepNow's heavy half: the same look, for a writer pressing it."""
    if not HH.writer(sess.user):
        return dict(HH.DENIED)
    return {"status": 200, "data": R.seal("interviewAskSweepNow", R.actor(sess.user), ask_look(sess.reads))}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "interviewStartDue": start_due, "interviewAskDue": ask_due, "interviewAskPrepare": ask_prepare}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
