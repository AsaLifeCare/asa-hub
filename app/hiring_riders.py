"""The hiring sweep's riders (HiringOutreach.gs) on Python: the looks the relay's clock asks before each write that
records them (hiring_riders_writes) — the cut screening call asked again (screenRedoSweepMaybe_), the referral ladder's
mouth (referralRelaySweepMaybe_), the Added Manually machine with its adder relay and its 4040 door
(manualContactSweepMaybe_, manualAdderSweepMaybe_, manualCallDoorRun_), the director fast lane's collector
(directorDocsSweepMaybe_) and the call nobody was asked for (screenCallSweepMaybe_). Each look reads the ask book, the
cards, the comms transcripts and — where a door needs them — the résumé and CJIS folders, and seals what is due for its
write."""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from typing import Any, Callable

import candidates as CND
import gsjs
import hiring_hired as HH
import hiring_outreach as HO
import hiring_outreach_letters as HL
import hiring_sim as HS
import hiring_sim_writes as HSW
import locations as L
import recon as R
import resume_intake as RI
import screening as SG
import smart_comms as SC

log = logging.getLogger("asa-hub-app")
s_ = gsjs.str_

SERVICE_ONLY = HH.SERVICE_ONLY
# the marks Apps Script kept in Script Properties (app.hiring_marks)
REDO_SEEN = "SCREEN_REDO_SEEN"
CALL_SEEN = "MANUAL_CALL_SEEN"
ARMED_AT = "MANUAL_MACHINE_ARMED_AT"
# who presses each door the riders press, as Apps Script named them
LADDER_ACTOR = {"role": "manager", "email": "manual-ladder@service.local"}
MANUAL_SWEEP_ACTOR = {"role": "manager", "email": "hiring-manual-sweep@service.local", "id": "SVC_HIRING_SIM"}
DOCS_ACTOR = {"role": "manager", "email": "director-docs-sweep@service.local", "id": "SVC_HIRING_SIM"}
SCREEN_CALL_ACTOR = {"role": "manager", "email": "screen-call-sweep@service.local", "id": "SVC_SCREEN_CALL"}
MANUAL_PER_PASS = 10
SCREEN_CALL_PER_PASS = 5
# a folder's résumé is scored before it is attached; each scoring may take a model's time
ATTACH_PER_PASS = 1
IDLE_EVERY_S = 21600.0
_IDLE: dict[str, float] = {}
_IDLE_LOCK = threading.Lock()
_RUN = re.compile(r"\+?\d[\d\s().\/-]{7,}\d")


def service(sess: L.Session) -> bool:
    return HH.service(sess)


def idle(name: str, why: str) -> None:
    """tpSweepIdle_: a pass that did nothing says why, once in six hours."""
    with _IDLE_LOCK:
        at = _IDLE.get(name, 0.0)
        if time.time() - at < IDLE_EVERY_S:
            return
        _IDLE[name] = time.time()
    log.info("asa-hub:%s %s_idle: %s", name, name, why[:400])


def sim_text(reads: L.Reads, key: str, fallback: str = "") -> str:
    """simText_: the Smart Comms row first, then the config cell (its shipped words as the floor), then the
    fallback."""
    return HO.text_row_value(reads, key) or HS._soft(lambda: HS.val(reads, "sim_text_" + key), "") or fallback


def book(reads: L.Reads) -> list[dict] | None:
    """simAskRows_, None when the book cannot be read (no machine presses blind)."""
    got, why = CND.soft(lambda: HH.sim_rows(reads))
    return None if why else list(got or [])


def ms(v: Any) -> float | None:
    """new Date(str_(v)).getTime(), None for NaN."""
    got, why = CND.soft(lambda: HH.ms_of(v))
    return None if why else got


def num(v: Any, floor: int) -> int:
    """parseInt(str_(v), 10) || floor."""
    return HH._int(v) or floor


def quiet_past(reads: L.Reads, row: dict | None, fallback: int) -> bool:
    """The grace clock: the asking sat quiet its own interval past its last send."""
    if not row:
        return True
    mins = num(row.get("intervalminutes"), fallback or 30)
    last = ms(s_(row.get("lastsentat")) or s_(row.get("createdat")))
    if last is None:
        return True
    return HH.now_ms(reads) - last >= mins * 60000


def due_again(reads: L.Reads, row: dict, fallback: int) -> int:
    """A rider's own re-ask: the next attempt's number, or 0 while it ran out or its clock has not come."""
    count = num(row.get("sentcount"), 0)
    most = num(row.get("maxattempts"), 1)
    mins = num(row.get("intervalminutes"), fallback)
    last = ms(row.get("lastsentat"))
    if count >= most:
        return 0
    if last is not None and HH.now_ms(reads) - last < mins * 60000:
        return 0
    return count + 1


def ten(v: Any) -> str:
    """The digits, a leading 1 dropped, the last ten."""
    return re.sub(r"^1", "", re.sub(r"\D", "", s_(v)))[-10:]


def marks(reads: L.Reads, key: str) -> dict[str, str]:
    """A seen-once memo kept as one JSON mark."""
    try:
        got = json.loads(HH.mark(reads, key) or "{}")
    except ValueError:
        return {}
    return got if isinstance(got, dict) else {}


def transcripts(reads: L.Reads) -> list[dict] | None:
    """readTabNormalized_(HUB_COMMS_ID, 'transcripts'), None when it cannot be read."""
    got, why = CND.soft(lambda: SG.comms_rows(reads, "transcripts"))
    return None if why else got


def cand_of(reads: L.Reads, cid: str) -> dict | None:
    """hubEvidence_(cid).cand, None when it throws or there is none."""
    ev, why = CND.soft(lambda: CND.evidence(reads, cid))
    return None if why or not ev else ev.get("cand")


def adder_for(reads: L.Reads, cand: dict | None) -> dict[str, str] | None:
    """manualAdderFor_: whoever added the card, by the address after created_by's last ':'."""
    cb = s_((cand or {}).get("createdby"))
    email = gsjs.trim(cb[cb.rfind(":") + 1:])
    if "@" not in email:
        return None
    out = {"email": email, "name": email, "phone": ""}
    try:
        for u in reads.users():
            if s_(u.get("email")).lower() != email.lower():
                continue
            out["name"] = s_(u.get("displayname")) or email
            out["phone"] = s_(u.get("phone"))
    except Exception:  # noqa: BLE001 - the address alone still carries the letter
        pass
    return out


def screen_line(reads: L.Reads) -> str:
    """The screen line a letter offers: the cast's, else the phone-screen door's own."""
    return HO.actors(reads)["screen_line"] or ("+1" + SG.SCREEN_LINES[0] if SG.SCREEN_LINES else "")


def label(line: str) -> str:
    return HL.line_label(line) or line


def _newest(trans: list[dict], keys: list[str], keep: Callable[[dict], bool]) -> dict | None:
    """The newest transcript whose participants carry one of the keys."""
    newest = None
    for t in trans:
        if not keep(t):
            continue
        who = re.sub(r"\D", "", s_(t.get("participants")))
        if not any(k and k in who for k in keys):
            continue
        at = s_(t.get("transcriptcreated")) or s_(t.get("receivedat"))
        if newest is None or at > newest["at"]:
            newest = {"at": at, "id": s_(t.get("callid")), "row": t}
    return newest


def _sealed(sweep: str, plan: dict[str, Any], due: int) -> dict[str, Any]:
    return {"status": 200, "data": R.seal(sweep, "service", {**plan, "due": due})}


# ---- the cut call, asked again (screenRedoSweepMaybe_) --------------------------------------------------------------

def screen_redo_plan(reads: L.Reads) -> dict[str, Any]:
    """Each open screen_call ask: a complete call rests it; a newer cut call not nudged yet is asked again."""
    allow = HO.allowed(reads, HO.sid(reads, "screen_redo"))
    if not allow["ok"]:
        idle("screen-redo", HO.idle_why(allow, "hiring_screen_redo is OFF in Smart Comms — a cut call is not answered "
                                               "with a fresh invitation to call again"))
        return {"on": False, "items": []}
    rows = book(reads)
    open_ = [r for r in rows or [] if s_(r.get("state")) == "open" and s_(r.get("step")) == "screen_call"]
    if not open_:
        return {"on": True, "items": []}
    seen = marks(reads, REDO_SEEN)
    trans = transcripts(reads)
    if trans is None:
        return {"on": True, "items": []}
    items: list[dict] = []
    done: set[str] = set()
    for r in open_:
        cid = s_(r.get("candidateid"))
        if not cid or cid in done:
            continue
        done.add(cid)
        c = cand_of(reads, cid)
        if not c:
            continue
        d = re.sub(r"^1", "", re.sub(r"\D", "", s_(c.get("phone"))))
        keys = [d] if len(d) == 10 else []
        keys += [k for k in HO.tester_keys()["digits"] if k not in keys]
        if not keys:
            continue
        newest = _newest(trans, keys, lambda t: True)
        if newest is None:
            continue
        text = s_(newest["row"].get("speakertranscript")) or s_(newest["row"].get("fulltranscript"))
        rest = HSW.call_complete(reads, text)
        if not rest and newest["id"] in seen:
            continue
        items.append({"cid": cid, "name": s_(c.get("candidatename")), "call": newest["id"], "rest": rest})
    return {"on": True, "items": items}


def screen_redo_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    if not service(sess):
        return dict(SERVICE_ONLY)
    plan = screen_redo_plan(sess.reads)
    return _sealed("screenRedoSweep", plan, len(plan["items"]))


# ---- the referral ladder's mouth (referralRelaySweepMaybe_) ---------------------------------------------------------

def referral_relay_plan(reads: L.Reads) -> dict[str, Any]:
    """Each referral whose own asking ran out: the referrer asked (first, again, a second day), or the card
    discarded once nobody could be asked or nobody answered."""
    rows = book(reads)
    if rows is None:
        return {"items": []}
    by: dict[str, dict[str, Any]] = {}
    for r in rows:
        cid, step = s_(r.get("candidateid")), s_(r.get("step"))
        if not cid or step not in ("resume_request", "referral_relay"):
            continue
        slot = by.setdefault(cid, {})
        slot[step] = s_(r.get("state"))
        if step == "referral_relay":
            slot["relay"] = r
            slot["rounds"] = slot.get("rounds", 0) + 1
        else:
            slot["person"] = r
    items: list[dict] = []
    now = HH.now_ms(reads)
    for cid, slot in by.items():
        if slot.get("resume_request") != "exhausted":
            continue
        c = cand_of(reads, cid)
        if not c or HO.archived(c):
            continue
        if len(re.sub(r"\D", "", s_(c.get("phone")))) >= 10 or s_(c.get("resumelink")):
            continue
        row = HO.referral_book_row(reads, cid)
        if not row:
            continue
        state = s_(row.get("state"))
        if state in ("discarded", "resolved"):
            continue
        ref_d = ten(row.get("referrerphone"))
        if ref_d in SC.SHARED_LINE_DIGITS:
            ref_d = ""
        has_contact = len(ref_d) == 10 or "@" in s_(row.get("referreremail"))
        relay = slot.get("referral_relay", "")
        item = {"cid": cid, "name": s_(c.get("candidatename"))}
        if not relay and state in ("contacting", "received") and has_contact:
            if quiet_past(reads, slot.get("person"), 0):
                items.append({**item, "kind": "first", "attempt": 1})
            continue
        if relay == "open" and slot.get("relay"):
            n = due_again(reads, slot["relay"], 30)
            if n:
                items.append({**item, "kind": "again", "attempt": n})
            continue
        if relay == "exhausted" and has_contact and slot.get("rounds", 1) < 2:
            last = ms(s_(slot["relay"].get("lastsentat")) or s_(slot["relay"].get("createdat")))
            if last is not None and HH.ohio_morning_after(last, now):
                items.append({**item, "kind": "day2", "attempt": 1})
            continue
        if relay == "exhausted" or (not relay and not has_contact):
            if quiet_past(reads, slot.get("relay") if relay == "exhausted" else slot.get("person"), 0):
                items.append({**item, "kind": "discard"})
    return {"items": items}


def referral_relay_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    if not service(sess):
        return dict(SERVICE_ONLY)
    plan = referral_relay_plan(sess.reads)
    return _sealed("referralRelaySweep", plan, len(plan["items"]))


# ---- the Added Manually machine (manualContactSweepMaybe_, manualAdderSweepMaybe_, manualCallDoorRun_) ---------------

def adder_plan(reads: L.Reads, rows: list[dict]) -> list[dict]:
    """manualAdderSweepMaybe_'s look: each card whose first contact ran out — whoever added them asked, or the card
    discarded."""
    by: dict[str, dict[str, Any]] = {}
    for r in rows:
        cid, step = s_(r.get("candidateid")), s_(r.get("step"))
        if not cid or step not in ("manual_contact", "manual_adder"):
            continue
        slot = by.setdefault(cid, {})
        slot[step] = s_(r.get("state"))
        slot["contact" if step == "manual_contact" else "adder"] = r
    items: list[dict] = []
    for cid, slot in by.items():
        if slot.get("manual_contact") != "exhausted":
            continue
        c = cand_of(reads, cid)
        if not c or HO.archived(c):
            continue
        adder = adder_for(reads, c)
        state = slot.get("manual_adder", "")
        if not state:
            if not quiet_past(reads, slot.get("contact"), 60):
                continue
            if adder is None:
                items.append({"cid": cid, "kind": "discard", "why": "the created_by stamp names no address to ask"})
            else:
                items.append({"cid": cid, "kind": "ask", "attempt": 1})
            continue
        if state == "open" and slot.get("adder") and adder is not None:
            n = due_again(reads, slot["adder"], 720)
            if n:
                items.append({"cid": cid, "kind": "ask", "attempt": n})
            continue
        if state == "exhausted" and quiet_past(reads, slot.get("adder"), 720):
            items.append({"cid": cid, "kind": "discard",
                          "why": "seven tries, then the person who added them was asked twice and could not help"})
    return items


def door_plan(reads: L.Reads, rows: list[dict]) -> list[dict]:
    """manualCallDoorRun_'s look: a card still at New whose own number called the screen line — a complete, usable
    call never entered before — with the résumé and CJIS asks its entry fires prepared."""
    cids: list[str] = []
    for r in rows:
        if s_(r.get("state")) in ("open", "exhausted", "answered") and \
                s_(r.get("step")) in ("manual_contact", "manual_adder", "manual_resume"):
            cid = s_(r.get("candidateid"))
            if cid and cid not in cids:
                cids.append(cid)
    if not cids:
        return []
    seen = marks(reads, CALL_SEEN)
    trans = transcripts(reads)
    if trans is None:
        return []
    by = R.actor(LADDER_ACTOR)
    items: list[dict] = []
    for cid in cids:
        ev, why = CND.soft(lambda cid=cid: CND.evidence(reads, cid))
        c = None if why else (ev or {}).get("cand")
        if not c or HO.archived(c) or CND.stage_of(c.get("status")) != "new":
            continue
        d = ten(c.get("phone"))
        keys = [d] if len(d) == 10 and d not in SC.SHARED_LINE_DIGITS else []
        keys += HO.tester_keys()["digits"]
        if not keys:
            continue
        newest = _newest(trans, keys, lambda t: SG.screen_line(re.sub(r"\D", "", s_(t.get("quonumber")))[-10:])
                         and bool(s_(t.get("callid"))) and s_(t.get("callid")) not in seen)
        if newest is None:
            continue
        row = newest["row"]
        text = s_(row.get("speakertranscript")) or s_(row.get("fulltranscript"))
        if not text or not HSW.call_complete(reads, s_(row.get("fulltranscript")) or text):
            continue
        if not SG.usable(row.get("durationsec"), text)["ok"]:
            continue
        screens, why = CND.soft(lambda: CND.read_tab(reads, CND.TALENT_PHONE_TAB))
        have = not why and any(s_(p.get("transcriptcallid")) == newest["id"] and s_(p.get("candidateid")) == cid
                               for p in screens or [])
        items.append({"cid": cid, "name": s_(c.get("candidatename")), "call": newest["id"], "have_row": have,
                      "created": s_(row.get("transcriptcreated")), "text": SG.cap(text),
                      "resume": R.seal("manualResumeAsk", by, HO.resume_ready(reads, cid, c, fresh=True)),
                      "cjis": R.seal("hiringCjisRequestSend", by, HO.cjis_ready(reads, cid, ev))})
    return items


def manual_contact_plan(reads: L.Reads) -> dict[str, Any]:
    """manualContactSweepMaybe_'s look: the hand-added cards born after the arming not asked yet (a phone gets the
    invitation, an e-mail only the phone collection), then the adder relay's and the 4040 door's."""
    allow = HO.allowed(reads, HO.sid(reads, "manual_contact"))
    if not allow["ok"]:
        idle("manual-ladder", HO.idle_why(allow, "hiring_first_contact is OFF in Smart Comms — nobody standing at New "
                                                 "is spoken to, and the queue stays blocked behind them"))
        return {"on": False, "presses": [], "adder": [], "calls": []}
    rows = book(reads)
    if rows is None:
        return {"on": True, "presses": [], "adder": [], "calls": [], "why": "the ask book could not be read"}
    booked = {s_(r.get("candidateid")) for r in rows
              if s_(r.get("step")) in ("manual_contact", "phone_collect", "phone_confirm") and s_(r.get("candidateid"))}
    armed = HH.mark(reads, ARMED_AT)
    cell = s_(HS._soft(lambda: HS.val(reads, "sim_manual_armed_from"), ""))
    if cell:
        armed = cell + "T00:00:00.000Z" if re.fullmatch(r"\d{4}-\d{2}-\d{2}", cell) else cell
    arm = ""
    if not armed:
        arm = armed = gsjs.iso(reads.now)
    presses: list[dict] = []
    cards, why = CND.soft(lambda: CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB))
    for c in [] if why else cards or []:
        if len(presses) >= MANUAL_PER_PASS:
            break
        if not HO.manual_card_is(c) or s_(c.get("createdat")) < armed:
            continue
        cid = s_(c.get("candidateid"))
        if not cid or cid in booked:
            continue
        booked.add(cid)
        presses.append({"cid": cid, "door": "manualContactSend" if s_(c.get("phone")) else "hiringPhoneCollectAsk"})
    if not presses and not why:
        idle("manual-ladder", "ran and spoke to nobody — every card at New is already in the ask book, or was born "
                              "before " + armed)
    return {"on": True, "arm": arm, "armed_at": armed, "presses": presses, "adder": adder_plan(reads, rows),
            "calls": door_plan(reads, rows)}


def manual_contact_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    if not service(sess):
        return dict(SERVICE_ONLY)
    plan = manual_contact_plan(sess.reads)
    due = len(plan["presses"]) + len(plan["adder"]) + len(plan["calls"]) + (1 if plan.get("arm") else 0)
    return _sealed("manualContactSweep", plan, due)


# ---- the director fast lane's collector (directorDocsSweepMaybe_) ---------------------------------------------------

def director_docs_plan(reads: L.Reads) -> dict[str, Any]:
    """Each director card (fast-laned straight into Onboarding): the folders' résumé made ready to attach, the ask
    closed once both pieces stand, else the team asked — the first time, then on its own clock."""
    cards_all, why = CND.soft(lambda: CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB))
    if why:
        return {"items": []}
    by_id = {s_(c.get("candidateid")): c for c in cards_all or [] if s_(c.get("candidateid"))}
    cards = [c for cid, c in by_id.items() if cid not in CND.TALENT_EXCLUDE_IDS and not HO.archived(c)
             and s_(c.get("fastlaneat")) == "onboarding" and CND.stage_of(c.get("status")) == "onboarding"]
    if not cards:
        return {"items": []}
    rows, why = CND.soft(lambda: CND.read_tab(reads, CND.TALENT_RESUME_TAB))
    if why:
        return {"items": []}
    analyses = {s_(a.get("candidateid")): a for a in rows or [] if s_(a.get("candidateid"))}
    asks = {s_(r.get("candidateid")): r for r in book(reads) or []
            if s_(r.get("step")) == "director_docs" and s_(r.get("candidateid"))}
    attaching = 0
    items: list[dict] = []
    for c in cards:
        cid = s_(c.get("candidateid"))
        name = s_(c.get("candidatename")) or cid
        have_resume = bool(s_(c.get("resumelink")))
        attach = None
        if not have_resume and attaching < ATTACH_PER_PASS:
            hit, why = CND.soft(lambda name=name: HO.resume_hit(reads, name))
            if hit and not why:
                got = RI.attach_prepare(L.Session(reads, DOCS_ACTOR), {"candidate_id": cid, "resume_link": hit})
                if got.get("status") == 200:
                    attach = {"link": hit, "prepared": got["data"]}
                    attaching += 1
        a = analyses.get(cid) or {}
        have_cjis = CND.cjis_cleared(a) or bool(s_(a.get("cjisreporturl")))
        row = asks.get(cid)
        state = s_(row.get("state")) if row else ""
        attempt = 1 if not state else due_again(reads, row, 720) if state == "open" else 0
        both = (have_resume or attach is not None) and have_cjis
        if attach is None and not (both and state in ("open", "exhausted")) and not (not both and attempt):
            continue
        items.append({"cid": cid, "name": name, "attach": attach, "have_resume": have_resume, "have_cjis": have_cjis,
                      "attempt": attempt})
    return {"items": items}


def director_docs_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    if not service(sess):
        return dict(SERVICE_ONLY)
    plan = director_docs_plan(sess.reads)
    return _sealed("directorDocsSweep", plan, len(plan["items"]))


# ---- the call nobody was asked for (screenCallSweepMaybe_) ----------------------------------------------------------

def screen_call_plan(reads: L.Reads) -> dict[str, Any]:
    """Every card at Phone Screen with no screen on the record and never asked to call the line, in board order."""
    allow = HO.allowed(reads, HO.sid(reads, "screen_call"))
    if not allow["ok"]:
        idle("screen-call", HO.idle_why(allow, "hiring_screen_call is OFF in Smart Comms — nobody standing at Phone "
                                               "Screen is told to call the line, and nothing ages them out"))
        return {"on": False, "items": []}
    rows = book(reads)
    if rows is None:
        return {"on": True, "items": []}
    booked = {s_(r.get("candidateid")) for r in rows if s_(r.get("step")) == "screen_call" and s_(r.get("candidateid"))}
    screens, why = CND.soft(lambda: CND.read_tab(reads, CND.TALENT_PHONE_TAB))
    if why:
        return {"on": True, "items": []}
    screened = {s_(r.get("candidateid")) for r in screens or [] if s_(r.get("candidateid"))}
    cards, why = CND.soft(lambda: CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB))
    if why:
        return {"on": True, "items": []}
    items: list[dict] = []
    for c in cards or []:
        cid = s_(c.get("candidateid"))
        if HO.archived(c) or CND.stage_of(c.get("status")) != "phone-screen":
            continue
        if not cid or cid in booked or cid in screened or not (s_(c.get("phone")) or s_(c.get("email"))):
            continue
        booked.add(cid)
        items.append({"cid": cid, "name": s_(c.get("candidatename")) or cid})
    if not items:
        idle("screen-call", "nobody at Phone Screen is waiting to be asked — each one already has a screen on the "
                            "record, or is already in the ask book")
    return {"on": True, "items": items}


def screen_call_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    if not service(sess):
        return dict(SERVICE_ONLY)
    plan = screen_call_plan(sess.reads)
    return _sealed("screenCallSweep", plan, len(plan["items"]))


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "screenRedoDue": screen_redo_due, "referralRelayDue": referral_relay_due, "manualContactDue": manual_contact_due,
    "directorDocsDue": director_docs_due, "screenCallDue": screen_call_due}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
