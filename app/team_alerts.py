"""The hiring team's alerts Apps Script raised through hubTeamAlert_, raised by Python instead: a card that reached
Hired, all green or with what is missing (Hired.gs hubHiredAlert_, `hiring_hired_complete` / `hiring_hired_missing`),
and a phone screen whose accepted in-person date could not be read (Screening.gs hubDateAcceptedEscalate_,
`hiring_date_accepted`). Each reaches the team list (smartTeamRecipients_) through Smart Comms — a text to each number,
a letter to each address — held in its outbox through the quiet window, and taken back there when the card moved on
overnight. Only what happened after the moment they became Python's is told (app.team_alerts_state), each once by its
key (app.team_alerts_told). teamAlertsDue is the relay's look before its clock rings teamAlertsSweep."""
from __future__ import annotations

import re
import time
from typing import Any, Callable

import candidates as CND
import gsjs
import locations as L
import resource_rows as RR
import smart_comms as SC
import smart_comms_desk as SCD

APP_ID = "team-alerts"
TOLD, STATE = "app.team_alerts_told", "app.team_alerts_state"
HIRED, DATE = "hired", "date_accepted"
HIRED_STAY = ("hired", "becoming-staff", "internal-docs")
# Comms.gs COMMS_TEST_CANDIDATE_IDS and the platform's own test line and address
TEST_CARDS = ("CAN_CFEA7CE713095581517B", "CAN_7DF46D98345D8F032F02", "CAN_FCBBC0985BF468A0FD55")
TEST_LINE, TEST_EMAIL = "3309195558", "asatech@asalifecare.com"
FOOTER = "\n\n(Automated alert from the ASA Hub hiring pipeline.\nSent individually to: "
# hiring_hired_complete's floor: what the alert checked, in its own words — never more than the two portal flags
HIRED_COMPLETE_WORDS = ("Hub: {name} reached Hired. What was checked: {checked}. Uploaded documents are not part of "
                        "this check.\nPhone: {phone} · Email: {email}\nThey stay on the last step of the Hiring "
                        "Pipeline for one more day, then move to Users as staff automatically.")

s_ = gsjs.str_


def _ms(v: Any) -> float | None:
    return gsjs.date_parse(gsjs.or_text(v))


def since_ms(reads: L.Reads) -> float | None:
    got = RR._q(reads, f"select extract(epoch from since) * 1000 from {STATE} where id = 1")
    return float(got[0][0]) if got else None


def told_keys(reads: L.Reads) -> set[str]:
    return {k for (k,) in RR._q(reads, f"select key from {TOLD}")}


def test_card(reads: L.Reads, c: dict) -> bool:
    """commsIsTestCandidate_: a declared test card, the configured list, a [TEST] name, a platform mailbox, the
    platform's own test line or address."""
    cid = s_(c.get("candidateid"))
    if cid in TEST_CARDS:
        return True
    # the copy withholds hiring_sim_config's key cell: the list is read by its fact's subject
    import hiring_sim as HS  # noqa: PLC0415 - the simulator's reader builds on the candidates' modules
    listed = ", ".join(HS._soft(lambda: HS.cfg_list(reads, "sim_test_candidate_ids"), []))
    if cid and cid in [x.strip() for x in listed.replace(";", ",").replace("\n", ",").split(",") if x.strip()]:
        return True
    if s_(c.get("candidatename")).lower().startswith("[test]"):
        return True
    email = s_(c.get("email")).lower()
    if re.fullmatch(r"asa-hub[0-9]*@asaop\.org", email):
        return True
    return SCD.digits(c.get("phone"))[-10:] == TEST_LINE or email == TEST_EMAIL


def _sit(reads: L.Reads, sid: str) -> dict | None:
    """smartSituationOn_."""
    row = SC.situation_row(SC.read_situations(reads.db), sid)
    return row if row is not None and SC.smart_on(row.get("enabled")) else None


def hired_alert(reads: L.Reads, c: dict) -> dict[str, Any]:
    """hubHiredFacts_ and hubHiredAlert_'s words for a card that reached Hired."""
    cid = s_(c.get("candidateid"))
    ob = CND.onboarding_done(reads, c)
    if ob.get("unreadable"):
        # the portal's row could not be read: neither "complete" nor "missing" is known, so nothing is said — the next
        # pass asks again (never told, so still owed)
        return {"kind": HIRED, "ref": cid, "key": "hired_alert|" + cid, "situation": "",
                "wait": "the onboarding portal's row could not be read"}
    manual = ob.get("how") == "manual"
    missing: list[str] = []
    if not manual:
        # onboardingChecklist_ hands its rows back without their `doc`, so no upload is ever named missing here
        if not ob.get("q"):
            missing.append("New Hire Questionnaire — not completed")
        if not ob.get("t"):
            missing.append("New Hire Tutorials — not completed")
    v = {"name": s_(c.get("candidatename")), "phone": e164(c.get("phone")) or "—", "email": s_(c.get("email")) or "—",
         "manual_note": "" if not manual else (" (Confirmed on the card — the portal visit was already complete.)"
                                               if s_(c.get("manualonboardingmethod")) == "portal"
                                               else " (Onboarding was completed manually, by email.)"),
         "missing": "- " + "\n- ".join(missing),
         # exactly what was looked at: the portal's two flags, or the card's own confirmation — no upload is checked
         "checked": ("onboarding was confirmed by hand on the card (the portal visit was already complete)"
                     if manual and s_(c.get("manualonboardingmethod")) == "portal" else
                     "onboarding was confirmed by hand on the card (it was completed by email)" if manual else
                     "the New Hire Questionnaire and the New Hire Tutorials are both complete on the onboarding portal")}
    sid = "hiring_hired_missing" if missing else "hiring_hired_complete"
    fallback = ("Hub: {name} reached Hired, but these items are missing:\n{missing}\nPhone: {phone} · Email: {email}\n"
                "They still stay one more day on the pipeline and then move to Users as staff — chase the missing items "
                "in the Onboarding Tracker." if missing else HIRED_COMPLETE_WORDS)
    subject_floor = "Hub — Hired with items MISSING: {name}" if missing else "Hub — Hired, onboarding checked: {name}"
    return _alert(reads, HIRED, cid, sid, "hired_alert|" + sid + "|" + cid, v, subject_floor, fallback)


def date_alert(reads: L.Reads, c: dict, s: dict) -> dict[str, Any]:
    """hubDateAcceptedEscalate_'s words for a phone screen whose accepted date could not be read."""
    cid = s_(c.get("candidateid"))
    name = s_(c.get("candidatename")) or (s_(c.get("firstname")) + " " + s_(c.get("lastname")))
    score = s_(s.get("screenscore"))
    screen = CND.render(CND.book_text(reads, "Strings", "date_accepted.screen_line", ""), {
        "score": score + "/10 · " if score else "", "qualification": s_(s.get("qualification")) or "—",
        "call": s_(s.get("transcriptcreated")) or s_(s.get("screendate")) or "—"})
    url = s_(s.get("phonescreenreporturl"))
    v = {"name": name, "phone": e164(c.get("phone")) or "—", "email": s_(c.get("email")) or "—", "screen": screen,
         "report": CND.render(CND.book_text(reads, "Strings", "date_accepted.report_line", ""), {"url": url}) + "\n"
         if url else ""}
    return _alert(reads, DATE, cid, "hiring_date_accepted", "date_accepted|" + cid, v,
                  CND.book_text(reads, "Strings", "date_accepted.subject", ""),
                  CND.book_text(reads, "Strings", "date_accepted.body", ""))


def e164(v: Any) -> str:
    """hubPhoneE164_."""
    s = s_(v)
    d = re.sub(r"\D", "", s)
    return "+1" + d if len(d) == 10 else "+" + d if len(d) == 11 and d[0] == "1" else s


def _alert(reads: L.Reads, kind: str, ref: str, sid: str, key: str, v: dict, subject_floor: str,
           fallback: str) -> dict[str, Any]:
    sit = _sit(reads, sid)
    out: dict[str, Any] = {"kind": kind, "ref": ref, "key": key, "situation": sid}
    if sit is None:
        out["off"] = "situation off (" + sid + ")"
        return out
    out["subject"] = CND.render(s_(sit.get("email_subject")) or subject_floor, v)
    out["body"] = CND.render(s_(sit.get("sms_text")) or s_(sit.get("email_text")) or fallback, v)
    out["mail"] = CND.render(s_(sit.get("email_text")) or s_(sit.get("sms_text")) or fallback, v)
    return out


def tell_team(reads: L.Reads, alert: dict[str, Any]) -> dict[str, Any]:
    """hubTeamAlert_ through hubTeamNotify_: a text to each number on the team list, a letter to each address."""
    team = SCD.team_recipients(reads, reads.config())
    if not team["readable"]:
        return {"state": "failed", "why": "the team list could not be read"}
    sms, emails = team["sms"], team["emails"]
    footer = FOOTER + ", ".join(emails) + (" — SMS to: " + ", ".join(sms) if sms else "") + ")"
    states: list[tuple[str, str, str]] = []
    for n in sms:
        got = SC.raise_situation(None, situation=alert["situation"], to=n, vars={},
                                 key=alert["key"] + "|sms|" + SCD.digits(n)[-10:], lane="smart comms",
                                 at_ms=int(time.time() * 1000), prune=False, team="group", body=alert["body"])
        states.append((s_(got.get("state")), s_(got.get("held")), s_(got.get("why"))))
    for e in emails:
        got = SC.raise_situation(None, situation=alert["situation"], to=e, vars={},
                                 key=alert["key"] + "|email|" + e.lower(), lane="smart comms",
                                 at_ms=int(time.time() * 1000), prune=False, channel="email",
                                 body=alert["mail"] + footer, subject=alert["subject"])
        states.append((s_(got.get("state")), s_(got.get("held")), s_(got.get("why"))))
    if not states:
        return {"state": "failed", "why": "nobody is on the team list"}
    for word, test in (("told", lambda st, h: st in ("sent", "already")), ("quiet", lambda st, h: h == "quiet"),
                       ("held", lambda st, h: st in ("held", "refused"))):
        if any(test(st, h) for st, h, _w in states):
            return {"state": word, "why": next((w for st, h, w in states if test(st, h)), "")}
    if all(st == "off" for st, _h, _w in states):
        return {"state": "off", "why": states[0][2]}
    return {"state": "failed", "why": "; ".join(dict.fromkeys(w for _st, _h, w in states if w))[:300]}


def due(reads: L.Reads, since: float, told: set[str]) -> list[dict[str, Any]]:
    """Every alert owed for what happened at or after `since` and not told yet."""
    out: list[dict[str, Any]] = []
    cands = CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB)
    by_cid = {s_(c.get("candidateid")): c for c in cands if s_(c.get("candidateid"))}
    for cid, c in by_cid.items():
        at = _ms(c.get("hiredcompleteat"))
        if at is None or at < since or s_(c.get("archived")).lower() == "true" or test_card(reads, c):
            continue
        if any(k.startswith("hired_alert|") and k.endswith("|" + cid) for k in told):
            continue
        out.append(hired_alert(reads, c))
    for s in CND.read_tab(reads, CND.TALENT_PHONE_TAB):
        cid = s_(s.get("candidateid"))
        c = by_cid.get(cid)
        if c is None or "date_accepted|" + cid in told or s_(c.get("archived")).lower() == "true":
            continue
        if not s_(s.get("screenscore")) or s_(s.get("bestinpersondaytime")) or s_(s.get("dateacceptedalertat")):
            continue
        at = _ms(s.get("updatedat")) or _ms(s.get("transcriptpulledat"))
        if at is None or at < since:
            continue
        out.append(date_alert(reads, c, CND.evidence(reads, cid).get("screen") or s))
    return out


def still(reads: L.Reads, kind: str, cid: str) -> str:
    """Why an owed alert is no longer true ('' while it is): hubHiredQuietCarry_ / hubDateAcceptedQuietCarry_."""
    ev = CND.evidence(reads, cid)
    c = ev.get("cand")
    if not c:
        return cid + " is no longer a candidate"
    if s_(c.get("archived")).lower() == "true":
        return cid + " was archived overnight"
    if kind == HIRED and CND.stage_of(c.get("status")) not in HIRED_STAY:
        return cid + " left the Hired stay overnight (" + s_(c.get("status")) + ")"
    if kind == DATE and s_((ev.get("screen") or {}).get("bestinpersondaytime")):
        return "a date was accepted overnight"
    return ""


def owed(reads: L.Reads) -> list[tuple[str, str, str]]:
    """(key, kind, ref) of every told alert with a text or letter the outbox still owes."""
    return [(k, kd, ref) for k, kd, ref in RR._q(
        reads, f"select t.key, t.kind, t.ref from {TOLD} t where exists (select 1 from {SC.OUTBOX} o where"
               " position(t.key || '|' in o.idem_key) = 1 and o.state = 'owed')")]


def team_alerts_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The relay's look before it rings the sweep."""
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "This is the relay's own read."}
    reads = sess.reads
    since = since_ms(reads)
    if since is None:
        return {"status": 200, "data": {"ready": False, "due": 0, "untrue": 0}}
    untrue = sum(1 for _k, kind, ref in owed(reads) if still(reads, kind, ref))
    return {"status": 200, "data": {"ready": True, "due": len(due(reads, since, told_keys(reads))), "untrue": untrue}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"teamAlertsDue": team_alerts_due}
POLICY: dict[str, dict[str, Any]] = {"teamAlertsDue": {}}
