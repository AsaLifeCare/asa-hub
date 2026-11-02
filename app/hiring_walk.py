"""The hiring walk (HiringWalk.gs hiringWalkRun) on Python alone: the whole walk in one call, each step pressed through
its own Python door as the caller by the relay, which asks hiringWalkNext between presses — the pre-flight first, then
each step's answer checked as hiringWalkRun_ checks it and the next press named, until the walk is done, refused or
out of its budget. hiringWalkRun raises the report to the caller through Smart Comms, as rpcCall_'s emailSend did;
every send the steps make goes through Smart Comms and its test mode, as each door's own does."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable

import candidates as CND
import client_writes as CW
import comms_rpc as CR
import gsjs
import hiring_sim as HS
import hubdb
import interview_flow as IF
import locations as L
import mail_designs as MD
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

NEXT, RUN = "hiringWalkNext", "hiringWalkRun"
# HIRING_WALK_BUDGET_MS: overruns return truncated: true; the relay may name a shorter one (its own wait)
BUDGET_MS = 240000
ROLES = ("admin", "manager")
# HUB_POLICY.hiringWalkRun params
PARAMS = {"candidate_id": "string", "include_discard": "boolean", "tear_down": "boolean", "dry_docs": "boolean",
          "fresh": "boolean"}
UNREAD = {"status": 503, "message": "The walk could not be run just now — try again in a moment."}
# hiringWalkRun_'s order: each step and the door it presses (a step with no door is a check of its own)
STAGES = ("card", "card_checks", "ask", "shortlist", "outreach_sms", "resume_request", "cjis_request",
          "outreach_reply", "cjis_scan", "resume_scan", "schedule_invite", "interviewer_ask", "discarded", "journey",
          "tear_down", "finish")
PRESSES = {"card": "hiringSimSeed", "ask": "hiringAskSend", "shortlist": "hiringShortlistSend",
           "outreach_sms": "hiringOutreachSend", "resume_request": "hiringResumeRequestSend",
           "cjis_request": "hiringCjisRequestSend", "outreach_reply": "hiringOutreachReplyCheck",
           "cjis_scan": "cjisFolderSweepNow", "resume_scan": "resumeInboxScan",
           "schedule_invite": "interviewInviteSend", "interviewer_ask": "interviewAskSweepNow",
           "discarded": "hiringDiscard", "tear_down": "hiringSimReset"}
_UNDEF = object()

s_ = gsjs.str_


def _payload(payload: Any) -> dict:
    return payload if isinstance(payload, dict) else {}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _truthy(v: Any) -> bool:
    return v is not _UNDEF and not gsjs.falsy(v)


def _get(d: Any, k: str) -> Any:
    """d[k] of a parsed answer: _UNDEF when it has no such member."""
    return d.get(k, _UNDEF) if isinstance(d, dict) else _UNDEF


def _obj(v: Any) -> dict:
    return v if isinstance(v, dict) else {}


def _str(v: Any) -> str:
    return "" if v is _UNDEF else s_(v)


def _cat(v: Any) -> str:
    """A value joined into a string with +."""
    return "undefined" if v is _UNDEF else gsjs.js_str(v)


def _num(v: Any) -> str:
    """Number(v || 0), as + writes it."""
    if not _truthy(v):
        return "0"
    if isinstance(v, bool):
        return "1"
    if isinstance(v, (int, float)):
        return gsjs.num_str(v)
    if isinstance(v, str):
        try:
            return gsjs.num_str(float(gsjs.trim(v)) if gsjs.trim(v) else 0.0)
        except ValueError:
            return "NaN"
    return "NaN"


def _check(out: dict, name: str, ok: Any, detail: Any) -> bool:
    """walkCheck_."""
    good = bool(ok)
    out["checks"].append({"name": name, "ok": good, "detail": s_(detail)})
    if not good:
        out["failed"] += 1
    return good


def _late(st: dict) -> bool:
    """walkOutOfTime_."""
    out = st["out"]
    if _now_ms() - int(out["started_ms"]) < int(st["budget_ms"]):
        return False
    out["truncated"] = True
    return True


def _row(step: str, last: dict) -> tuple[dict, dict]:
    """walkPress_'s line for one press, and the answer's data ({} when there is none)."""
    err = s_(last.get("error"))
    env = None if err else last
    data = _obj((env or {}).get("data")) if env and not gsjs.falsy(env.get("data")) else {}
    status = (env or {}).get("status")
    status = status if env and not gsjs.falsy(status) else (500 if err else 0)
    reason = _get(data, "reason")
    row = {"step": step, "action": PRESSES[step], "status": int(status) if isinstance(status, (int, float)) else 0,
           "ms": int(last.get("ms") or 0),
           "sent": None if "sent" not in data else _truthy(data.get("sent")),
           "redirected": _truthy(_get(data, "redirected")), "to": _str(_get(data, "to")),
           "delivered_to": _str(_get(data, "delivered_to")),
           "reason": _str(reason if _truthy(reason) else _get(data, "error")),
           "message": s_((env or {}).get("message")), "error": err}
    return row, data


# ---- before the first press (the pre-flight) ----------------------------------------------------------------------

def _fresh_out() -> dict[str, Any]:
    return {"started_ms": _now_ms(), "started_at": gsjs.iso(datetime.now(timezone.utc)), "checks": [], "steps": [],
            "failed": 0, "truncated": False, "candidate_id": "", "card_created": False, "torn_down": False}


def _preflight(reads: L.Reads, o: dict, st: dict) -> str:
    """The safety checked before anything is pressed; the first stage, or '' when the walk stops here."""
    out = st["out"]
    contacts = HS.contacts(reads)
    st["mode"] = contacts["mode"]
    if contacts["mode"] == "actors":
        if not _check(out, "the actor contacts are configured", contacts["on"],
                      "candidate → " + (contacts["email"] or "(none)") + " · " + (contacts["phone"] or "(none)")):
            out["refused"] = ("actors mode with no candidate mailbox/phone configured — fill sim_candidate_email and "
                              "sim_candidate_phone in the simulation config")
            return ""
        actors = HS.actors(reads)
        _check(out, "the copy list resolves", len(actors["cc_emails"]) > 0,
               ", ".join(actors["cc_emails"]) or
               "sim_cc_emails is empty — nobody rides in copy, and the team rides in copy on every letter")
        _check(out, "the interviewer actor is set", bool(actors["interviewer_email"] or actors["interviewer_phone"]),
               (actors["interviewer_email"] or actors["interviewer_phone"] or "(none)") +
               " — a rehearsal ask with no actor would fall to nobody, never to the real badge holder")
        if contacts["test_mode_on"]:
            out["checks"].append({"name": "note: test mode is ALSO on", "ok": True,
                                  "detail": "the redirect folds every actor into the listed testers — switch it off "
                                            "to see each mailbox receive its own half"})
    else:
        if not _check(out, "test mode is ON", contacts["on"],
                      "sms → " + (contacts["phone"] or "(none)") + " · email → " + (contacts["email"] or "(none)")):
            out["refused"] = ("test mode is off — every step below sends a real message, and the redirect is the "
                              "only thing between this walk and a real candidate")
            return ""
        _check(out, "both rehearsal endpoints are set", bool(contacts["phone"] and contacts["email"]),
               "a channel with nobody on it refuses every send, so half the walk would look broken rather than "
               "tested")
    iv = HS.interviewer_pick(reads, "")
    _check(out, "somebody holds the INTERVIEWER badge", bool(iv["name"]),
           (iv["name"] or "(nobody)") + " · " + (iv["email"] or "no address") + " — " + iv["by"])
    team = HS.team_recipients(reads)
    _check(out, "the hiring team resolves to at least one address", len(team["emails"]) > 0,
           ", ".join(team["emails"]))
    secret = bool(IF.secret(reads))
    st["secret"] = secret
    _check(out, "INTERVIEW_LINK_SECRET is set", secret,
           "" if secret else "without it the scheduling invite refuses with no_link_secret and the scheduling half "
                             "cannot be walked")
    if out["failed"]:
        return ""
    st["cid"] = s_(o.get("candidate_id"))
    return "card_checks" if st["cid"] else "card"


def _card_checks(reads: L.Reads, st: dict) -> str:
    """The rehearsal card: there, a rehearsal by the platform's own rule, and held by the gate."""
    out, cid = st["out"], st["cid"]
    if not _check(out, "a rehearsal card exists", bool(cid), cid):
        return ""
    out["candidate_id"] = cid
    try:
        card = CND.evidence(reads, cid).get("cand")
    except Exception:  # noqa: BLE001 - an unreadable card is no card, as the walk reads it
        card = None
    _check(out, "the card is a rehearsal by the platform’s own rule", bool(card and HS.is_test_card(reads, card)),
           "its name must begin with [TEST] — that is what stops the graduation minting a staff account from it")
    try:
        gate = CND.stage_gate(reads, CND.evidence(reads, cid))
    except Exception:  # noqa: BLE001 - no verdict is no gate checks
        gate = None
    if gate:
        _check(out, "a fresh card cannot move", gate.get("ok") is False,
               s_(gate.get("from")) + " → " + s_(gate.get("to")))
        reasons = " · ".join(gsjs.or_blank(r) for r in gate.get("reasons") or [])
        _check(out, "the gate asks for the resume decision and nothing else",
               "resume decision Advance" in reasons and "resume on file" not in reasons and "CJIS" not in reasons,
               reasons)
        _check(out, "no gate asks for a Date accepted any more", "date accepted" not in reasons.lower(),
               "the candidate picks their own interview time now")
    return "ask"


def _due(st: dict, o: dict, stage: str) -> bool:
    """Whether the step is pressed: each behind the budget, the invite behind the key, the discard and the teardown
    behind their options."""
    if stage == "card":
        return True
    if stage == "schedule_invite":
        return bool(st.get("secret")) and not _late(st)
    if stage == "discarded":
        return _truthy(o.get("include_discard")) and not _late(st)
    if stage == "tear_down":
        return _truthy(o.get("tear_down"))
    return not _late(st)


def _press(st: dict, o: dict, stage: str) -> dict[str, Any]:
    cid = st["cid"]
    payload: dict[str, Any] = {
        "card": {"fresh": _truthy(o.get("fresh"))}, "ask": {}, "shortlist": {"limit": 5},
        "resume_request": {"candidate_id": cid, "referrer": "the walk"}, "cjis_scan": {}, "resume_scan": {},
        "interviewer_ask": {}, "discarded": {"candidate_id": cid, "reason": "The walk exercised the discard path"},
    }.get(stage, {"candidate_id": cid})
    return {"step": stage, "action": PRESSES[stage], "payload": payload}


# ---- after each press (hiringWalkRun_'s checks of what came back) --------------------------------------------------

def _after(reads: L.Reads, st: dict, stage: str, last: dict) -> None:
    """The press's line kept and its answer checked."""
    out = st["out"]
    row, data = _row(stage, last)
    out["steps"].append(row)
    sent = _get(data, "sent") is True
    to_line = _str(_get(data, "to")) + " → " + _str(_get(data, "delivered_to"))
    if stage == "card":
        st["cid"] = _str(_get(data, "candidate_id"))
        out["card_created"] = _truthy(_get(data, "created"))
    elif stage == "ask":
        cc = _get(data, "cc")
        _check(out, "step 0 · the ask went", sent, to_line + (" · cc: " + _str(cc) if _truthy(cc) else ""))
        if st.get("mode") == "actors":
            _check(out, "step 0 · the team rides in copy", bool(_str(cc)) or not sent,
                   "the copy list rides on every letter; empty means To already covers everybody on it")
        else:
            _check(out, "step 0 · test mode redirected it", _get(data, "redirected") is True,
                   "a rehearsal that reaches the real team is not a rehearsal")
    elif stage == "shortlist":
        if _str(_get(data, "reason")) == "nobody_to_rank":
            _check(out, "step 1 · the shortlist had somebody to rank", False,
                   "no candidate sits at `new` with a scored resume — the letter was not sent, and an empty table "
                   "says nothing")
        else:
            ranked = _get(data, "ranked")
            named = (str(len(ranked)) if isinstance(ranked, (list, str)) else "undefined") if _truthy(ranked) else "0"
            unscored = _get(data, "unscored")
            _check(out, "step 1 · the shortlist went", sent,
                   named + " named · " + _cat(unscored) + " unscored of " + _cat(_get(data, "pool")))
            _check(out, "step 1 · unscored candidates are counted, not zeroed",
                   isinstance(unscored, (int, float)) and not isinstance(unscored, bool),
                   "the letter prints a dash for them and the count says how many")
    elif stage == "outreach_sms":
        cands = _get(data, "candidates")
        first = cands[0] if isinstance(cands, list) and cands else None
        one = first if _truthy(first) else {}
        sms, email = _get(one, "sms"), _get(one, "email")
        if _truthy(sms) and _str(_get(sms, "reason")) == "opted_out":
            _check(out, "step 4 · the rehearsal number can be texted", False,
                   "it has opted out — send START from it to reverse")
        else:
            _check(out, "step 4 · the outreach text went", _truthy(sms) and _truthy(_get(sms, "sent")),
                   _str(_get(sms, "to")) + " → " + _str(_get(sms, "delivered_to")) if _truthy(sms) else "no sms leg")
        cc = _get(email, "cc")
        _check(out, "step 4 · the outreach letter went too", _truthy(email) and _truthy(_get(email, "sent")),
               (_str(_get(email, "to")) + (" · cc: " + _str(cc) if _truthy(cc) else "") if _truthy(email)
                else "no email leg") + " — both channels since 2026-08-23")
    elif stage == "resume_request":
        _check(out, "step 5 · the resume request went", sent, to_line)
    elif stage == "cjis_request":
        if _str(_get(data, "reason")) == "already_cleared":
            out["checks"].append({"name": "step 6 · nothing asked for — already cleared", "ok": True,
                                  "detail": "asking for a document that is on file is how a team learns to ignore "
                                            "the platform"})
        else:
            _check(out, "step 6 · the CJIS request went", sent, to_line)
    elif stage == "outreach_reply":
        out["checks"].append({
            "name": "step 4b · the inbound reply was read on demand", "ok": row["status"] == 200,
            "detail": "a yes was found: " + CW.js_cut(_str(_get(data, "reply")), 80) if _truthy(_get(data, "matched"))
            else "no reply on the card yet (" + _num(_get(data, "checked")) + " inbound row(s) read). Text YES from "
                 "the rehearsal number and run the walk again — the sweep is NOT waited for, it is called."})
    elif stage == "cjis_scan":
        ok = row["status"] == 200
        out["checks"].append({
            "name": "step 6b · the CJIS folder was looked at", "ok": ok,
            "detail": _num(_get(data, "attached")) + " attached · " + _num(_get(data, "orphans")) +
            " file(s) matching nobody — and NOTHING was marked Clear, which is the line this lane does not cross"
            if ok else row["message"] or row["error"]})
    elif stage == "resume_scan":
        ok = row["status"] == 200
        out["checks"].append({"name": "step 6c · the resume folder was read", "ok": ok,
                              "detail": "the folder answered" if ok else row["message"] or row["error"]})
    elif stage == "schedule_invite":
        _check(out, "step 9 · the scheduling invite went", _get(data, "invited") is True,
               _str(_get(data, "reason")) or ("ask " + _str(_get(data, "ask_id"))))
        _check(out, "step 9 · e-mail always, SMS only when a phone exists", _get(data, "emailed") is True,
               "an address is something everybody has and a phone is not")
        out["link"] = _str(_get(data, "link"))
        ask = None
        try:
            for r in CND.ask_rows(reads):
                if s_(r.get("candidateid")) == st["cid"]:
                    ask = r
        except Exception:  # noqa: BLE001 - an unreadable book is no ask row
            ask = None
        _check(out, "step 9 · the ask row says invited", bool(ask) and s_(ask.get("state")) == "invited",
               "state: " + s_(ask.get("state")) if ask else "no ask row was written")
        out["ask_state"] = s_(ask.get("state")) if ask else ""
        out["next"] = ("Open the link above and pick a time. Then run the walk again — it reads the reply and asks "
                       "the interviewer without waiting for any throttle.")
    elif stage == "interviewer_ask":
        ok = row["status"] == 200
        out["checks"].append({
            "name": "step 10 · the interviewer sweep ran on demand", "ok": ok,
            "detail": "waiting: " + _num(_get(data, "waiting")) + " · acted on: " + _num(_get(data, "acted")) +
            " — the 900-second throttle was NOT waited for" if ok else row["message"] or row["error"]})
    elif stage == "discarded":
        _check(out, "step 11 · the discard told the team", sent, _str(_get(data, "reason")))
        _check(out, "step 11 · the card was marked archived", _get(data, "archived") is True,
               "archived / archived_at / archived_reason — the Archive’s own column names")
    elif stage == "tear_down":
        out["torn_down"] = row["status"] == 200
        _check(out, "the rehearsal was removed", out["torn_down"],
               "a card left at hired is picked up by the graduation sweep on the next service read")


def _journey(reads: L.Reads, st: dict) -> None:
    """Every step wrote a line, and the record says which sends were rehearsals."""
    out = st["out"]
    journey = CND.journey_for(reads, st["cid"])
    if journey is None:
        _check(out, "the record is readable", False,
               "the hiring_journey tab could not be read — that is NOT an empty journey")
        return
    _check(out, "every step wrote a line", len(journey) > 0, str(len(journey)) + " line(s)")
    rehearsals = sum(1 for line in journey if line.get("rehearsal"))
    _check(out, "the record says which sends were rehearsals", rehearsals > 0,
           f"{rehearsals} of {len(journey)} marked as a rehearsal")
    out["journey"] = len(journey)


def _following(stage: str) -> str:
    i = STAGES.index(stage)
    return STAGES[i + 1] if i + 1 < len(STAGES) else ""


# ---- the doors ----------------------------------------------------------------------------------------------------

def walk_next(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiringWalkRun_ between presses: the step just pressed checked (or, first, the pre-flight), then the next press
    named — {walk, press} — or the walk done — {walk, out, report}."""
    if not HS.writer(sess.user):
        return dict(HS.DENIED)
    o = _payload(payload)
    said = o.get("walk") if isinstance(o.get("walk"), dict) else {}
    try:
        return _next(sess.reads, o, said)
    except (Defer, hubdb.Unreadable) as exc:
        log.info("hiring walk: not read (%s)", exc)
        return dict(UNREAD)


def _next(reads: L.Reads, o: dict, said: dict) -> dict[str, Any]:
    asked = said.get("budget_ms")
    budget = min(BUDGET_MS, int(asked)) if isinstance(asked, (int, float)) and not isinstance(asked, bool) and \
        asked > 0 else BUDGET_MS
    if not said.get("stage"):
        st: dict[str, Any] = {"budget_ms": budget, "out": _fresh_out(), "cid": "", "mode": "", "secret": False}
        stage = _preflight(reads, o, st)
    else:
        st = {k: v for k, v in said.items() if k != "last"}
        stage = s_(said.get("stage"))
        if stage not in PRESSES or not isinstance(st.get("out"), dict):
            return {"status": 400, "message": "The walk's state could not be read."}
        last = said.get("last") if isinstance(said.get("last"), dict) else {"error": "the press was not made"}
        _after(reads, st, stage, last)
        stage = _following(stage)
    while stage:
        st["stage"] = stage
        if stage in PRESSES:
            if _due(st, o, stage):
                return {"status": 200, "data": {"walk": st, "press": _press(st, o, stage)}}
            stage = _following(stage)
        elif stage == "card_checks":
            stage = _card_checks(reads, st)
        elif stage == "journey":
            _journey(reads, st)
            stage = _following(stage)
        else:
            out = st["out"]
            out["ms"] = _now_ms() - int(out["started_ms"])
            out["ok"] = out["failed"] == 0 and not out["truncated"]
            return {"status": 200, "data": {"walk": st, "out": out, "report": o.get("notify") is not False}}
    return {"status": 200, "data": {"walk": st, "out": st["out"], "report": False}}


def letter(out: dict) -> dict[str, str]:
    """hiringWalkTell_'s letter: every check, and the result."""
    checks = out.get("checks") or []
    failed = int(out.get("failed") or 0)
    passed = len(checks) - failed
    lines = "\n".join(("  ok   " if c.get("ok") else "  FAIL ") + gsjs.or_text(c.get("name")) +
                      ("\n         " + gsjs.or_text(c.get("detail")) if not gsjs.falsy(c.get("detail")) else "")
                      for c in checks)
    title = f"{failed} of {len(checks)} checks failed" if failed else f"the walk passed — {passed} checks"
    blocks = [MD.mail_para("The hiring walk ran against the rehearsal card <strong>" +
                           MD.mail_esc(s_(out.get("candidate_id"))) + "</strong> and asserted every step."),
              MD.mail_fact("Result", title),
              MD.mail_fact("Time spent", gsjs.num_str(gsjs.js_round(float(out.get("ms") or 0) / 1000)) +
                           " seconds, one execution")]
    if out.get("truncated"):
        blocks.append(MD.mail_para("<strong>It stopped early</strong> against its own four-minute budget. What is "
                                   "below is what finished, and it says so rather than looking complete."))
    if not gsjs.falsy(out.get("link")):
        blocks.append(MD.mail_fact("The candidate’s page", s_(out.get("link"))))
    if not gsjs.falsy(out.get("next")):
        blocks.append(MD.mail_para(MD.mail_esc(s_(out.get("next")))))
    blocks.append('<pre style="margin:0;padding:12px 14px;background:' + MD.MAIL_PAPER + ";border:1px solid " +
                  MD.MAIL_LINE + ";border-radius:10px;font-family:'Courier New',Courier,monospace;font-size:12px;"
                  "line-height:18px;color:" + MD.MAIL_INK + ';white-space:pre-wrap;">' + MD.mail_esc(lines) + "</pre>")
    nxt = gsjs.or_text(out.get("next"))
    return {"subject": "[walk] " + title,
            "text": "The hiring walk ran against " + s_(out.get("candidate_id")) + ".\n\n" + title + "\n\n" + lines +
                    "\n" + ("\n" + nxt + "\n" if nxt else ""),
            "html": MD.mail_shell({"eyebrow": "ASA LifeCare · Hiring", "title": "The hiring walk", "preheader": title,
                                   "blocks": blocks, "barColor": MD.MAIL_DANGER if failed else MD.MAIL_ACCENT,
                                   "footnote": "Every step above pressed the real action against a rehearsal card. "
                                               "Test mode redirected every message it sent."})}


def walk_report(sess: L.Session, payload: dict) -> Decision:
    """hiringWalkRun's last part (hiringWalkTell_): the walk the relay ran, reported to the caller — else to the hiring
    team's first address — through Smart Comms; reported_to names who was told."""
    user = sess.user or {}
    if not HS.writer(user):
        return Decision(dict(HS.DENIED))
    p = _payload(payload)
    out = p.get("prepared")
    if not isinstance(out, dict) or not isinstance(out.get("checks"), list):
        return W.refuse(503, UNREAD["message"])
    out = dict(out)
    to = s_(user.get("email"))
    if not to:
        try:
            to = (HS.team_recipients(sess.reads)["emails"] or [""])[0]
        except Exception:  # noqa: BLE001 - nobody to tell is told nothing
            to = ""
    if not to:
        out["reported_to"] = ""
        return Decision({"status": 200, "data": out})
    said = letter(out)
    got = CR.call(sess.reads, "emailSend", {"to": to, "subject": said["subject"], "body": said["text"],
                                            "html": said["html"], "reason": "hiring walk: the report of a rehearsal"},
                  {"quiet_exempt": "asked_now"})
    out["reported_to"] = to if got.get("sent") else ""
    return Decision({"status": 200, "data": out}, subject="", own=True)


READS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {NEXT: walk_next}
READ_POLICY: dict[str, dict[str, Any]] = {NEXT: {"roles": ROLES, "params": PARAMS}}
ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {RUN: walk_report}
POLICY: dict[str, dict[str, Any]] = {RUN: {"roles": ROLES, "params": PARAMS}}
BUSY_OF: dict[str, dict[str, Any]] = {RUN: {"status": 409, "message": W.BUSY}}
