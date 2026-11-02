"""Staff attendance's writes (apps-script/StaffAlerts.gs) decided under the platform's write lock: the time clock's late
and no-call rows told (staffAttendancePunch), the shift flow's messages said (staffShiftReminder), and the mailbox's
pass recorded after staffAttendanceDue looked (staffAttendanceSweep). Every message goes through Smart Comms' one send
door under Apps Script's own keys, each telling is written in its ledger, and the Support Requests warnings these lanes
raise (SupportDesk.gs supportDeskAttendance_, supportDeskAttendanceMail_, supportDeskShiftRow_) are kept in app.edits
beside them."""
from __future__ import annotations

import logging
import re
import time
import uuid
from datetime import date, timedelta
from typing import Any, Callable

import gsjs
import hotline_calloff as HC
import locations as L
import mail_designs as MD
import recon as R
import resource_rows as RR
import smart_comms as SC
import smart_comms_desk as SCD
import staff_alerts as SA
import support_desk_writes as SDW
import writes as W
from gsjs import NY, name_key
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

BUSY = "Another attendance pass is being decided right now — try again."
STALE = "The mailbox look this pass rests on is gone or too old — the next pass looks again."
AUTHOR = "asa-hub:staffalerts"
# the share of the write's budget the messages may take; what is left is offered again by the next pass
PASS_S = 5.0
LANE_PUNCH = "staff attendance (punch)"
LANE_MAIL = "staff attendance"
LANE_SIM = "attendance letter simulation"

SHIFT_MAX_ROWS = 50
# StaffAlerts.gs STAFF_SHIFT_SITUATIONS: each kind the relay plans, and the situation that says it
SITUATIONS = {
    "confirm_ask": "shift_confirm_ask", "confirm_again": "shift_confirm_again",
    "hm_no_show": "shift_no_show_house_manager", "hm_confirm_no": "shift_confirm_no_house_manager",
    "late_call": "late_call_house_manager", "note_due": "daily_note_due", "login_before": "shift_login_before",
    "login_missing": "shift_login_missing", "early_in": "shift_early_in",
    "handoff_ask_staff": "shift_handoff_ask_staff", "handoff_ask_manager": "shift_handoff_ask_manager",
    "handoff_done": "shift_handoff_done", "handoff_declined": "shift_handoff_declined",
    "handoff_ask_above": "shift_handoff_ask_above", "handoff_done_taker": "shift_handoff_done_taker",
    "handoff_done_manager": "shift_handoff_done_manager", "handoff_declined_taker": "shift_handoff_declined_taker",
    "handoff_declined_manager": "shift_handoff_declined_manager",
    "handoff_ask_director": "shift_handoff_ask_director", "handoff_done_director": "shift_handoff_done_director",
    "handoff_declined_director": "shift_handoff_declined_director",
    "open_shift_applicants": "shift_applicants_waiting",
    "sms_reply_applied": "shift_reply_applied", "sms_reply_refused": "shift_reply_refused",
    "sms_reply_unclear": "shift_reply_unclear", "sms_reply_answered": "shift_reply_answered",
    "sms_reply_punch_open": "shift_reply_punch_open", "sms_reply_punch_waiting": "shift_reply_punch_waiting",
    "sms_reply_punch_closed": "shift_reply_punch_closed",
    "timeoff_ask_manager": "time_off_ask_manager", "timeoff_ask_above": "time_off_ask_above",
    "timeoff_ask_director": "time_off_ask_director", "timeoff_scheduled": "time_off_scheduled",
    "timeoff_scheduled_manager": "time_off_scheduled_manager", "timeoff_denied": "time_off_denied",
    "timeoff_cancelled": "time_off_cancelled", "timeoff_cancelled_manager": "time_off_cancelled_manager",
    "timeoff_expired": "time_off_expired",
    "punch_changeover": "shift_punch_changeover", "punch_open_entry": "shift_punch_open_entry",
    "punch_warning": "shift_punch_warning", "punch_warning_by_hand": "shift_punch_warning_by_hand"}
# the kinds told to the house manager of the roster's house, not to the person the row is about
TO_MANAGER = frozenset({"early_in", "hm_no_show", "hm_confirm_no", "late_call", "handoff_ask_manager",
                        "open_shift_applicants", "handoff_done_manager", "handoff_declined_manager"})
# handoff kinds whose recipient is the other half of the pair
HANDOFF_TO = {"handoff_ask_staff": "to_staff", "handoff_done": "from_staff", "handoff_declined": "from_staff",
              "handoff_done_taker": "to_staff", "handoff_declined_taker": "to_staff"}
TO_DIRECTORS = frozenset({"handoff_ask_above"})
# kinds whose e-mail is a situation of its own
MAIL_SITUATIONS = {"login_missing": "shift_login_missing_mail"}
SD_PUNCH_MAX = 200

s_ = gsjs.str_


def _gate(user: dict | None) -> bool:
    u = user or {}
    return u.get("is_service") is True or s_(u.get("role")) == "admin"


def _now_ms() -> int:
    return int(time.time() * 1000)


def _done(answer: dict[str, Any], edits: list[dict]) -> Decision:
    """The door's answer, final: what it kept in app.edits, and its own rows, outbox and ledger beside them."""
    d = W.final(answer, edits, "")
    d.own = True
    return d


def _say(*, sid: str, to: str, key: str, person: str, lane: str, body: str, channel: str = "sms", subject: str = "",
         html: str = "", team: Any = False, person_key: str = "", ledger_key: str = "") -> dict[str, Any]:
    """rpcCall_ through Smart Comms' one send door, in the write being decided: the words as the lane wrote them."""
    return SC.raise_situation(None, situation=sid, to=to, vars={}, key=key, ledger_key=ledger_key or None,
                              person=person, person_key=person_key or None, lane=lane, at_ms=_now_ms(), prune=False,
                              channel=channel, body=body, subject=subject or None, html=html or None, team=team,
                              transport=True)


def _leg(got: dict) -> str:
    """One leg's answer as the attendance lanes read rpcCall_'s: sent (or already asked under its key), quiet, written
    into a house, held by a brake, or failed."""
    state, held = s_(got.get("state")), s_(got.get("held"))
    if state in ("sent", "already"):
        return "sent"
    if state == "held" and held == "quiet":
        return "quiet"
    if state == "held" and held == "recorded":
        return "recorded"
    if state in ("held", "refused"):
        return "gated"
    return "failed"


def _held_rows(reads: L.Reads, *, sid: str, intent: str, person: str, person_key: str, channel: str, to: str,
               subject: str, body: str, sender: str, reasons: str, held_by: str, purpose: str) -> bool:
    """hubRehearsalHeld_: the message written into the rehearsal book and the mock outbox, sent to nobody; whether
    the rehearsal row was kept."""
    try:
        cur = SC._cur(SDW.write_tx())
        try:
            rows = SA.situations(reads)
        except Exception:  # noqa: BLE001 - the rows still stand without the situation's own cells
            rows = []
        b = SC.brakes(reads.db, cur)
        run = SC._Run(time.time())
        c = {"sid": sid, "key": intent, "lane": "staffalerts", "person": person, "person_key": person_key, "to": to,
             "body": body, "sender": sender, "subject": subject, "channel": channel, "rows": rows,
             "write_id": SC.write_id(), "door": "staffShiftReminder", "ask": {}}
        rec = SC.rehearsal_row(run, c, b)
        rec.update(purpose="shift", verdict="recorded", reasons=reasons, pass_by=AUTHOR)
        kept = SC.keep_test_row(cur, c, SC.comm_logs.REHEARSAL, rec)
        mock = SC.mock_row(run, c, b, "held", held_by, reasons or held_by)
        mock["purpose"] = purpose
        SC.keep_test_row(cur, c, SC.comm_logs.MOCK, mock)
        return kept
    except Exception as exc:  # noqa: BLE001 - the answer says the row could not be written
        log.warning("staff alerts: a rehearsal row was not kept (%s)", type(exc).__name__)
        return False


# ---- SupportDesk.gs: the warnings these lanes raise (each hook never throws and never changes its host) ----------

def _sd_memory() -> dict[str, set]:
    """What this write appended to the Support Requests houses already (its reads do not see it yet)."""
    return {"events": set(), "items": set(), "notes": set()}


def _day_add(iso: str, n: int) -> str:
    """sdDayAdd_."""
    try:
        y, m, d = (int(x) for x in s_(iso).split("-"))
        return (date(y, m, d) + timedelta(days=n)).isoformat()
    except ValueError:
        return ""


def _utc_minute(v: Any) -> str:
    """sdUtcMinute_."""
    ms = SDW.instant_ms(v)
    return "" if ms is None else gsjs.iso(SDW._local(ms))[:16] + "Z"


def _js_join(parts: list[Any]) -> str:
    """[…].filter(String).join(' · '): an undefined part survives the filter and joins as nothing."""
    return " · ".join("" if p is None else str(p) for p in parts if p is None or str(p))


def _union(*lists: list[dict]) -> list[dict]:
    """sdUnion_."""
    seen: set[str] = set()
    out = []
    for got in lists:
        for p in got or []:
            uid = s_((p or {}).get("uid"))
            if uid and uid not in seen:
                seen.add(uid)
                out.append(p)
    return out


def _leads(reads: L.Reads) -> list[dict]:
    """sdLeads_."""
    st = SDW.settings(reads)
    return SDW.resolve_emails(reads, st["values"]["leads"])["list"] if st["readable"] else []


def _event_row(reads: L.Reads, f: dict) -> dict[str, str]:
    """sdEventRow_: every column, the details JSON capped."""
    row: dict[str, Any] = {h: "" for h in SDW.HEADERS["support_events"]}
    row.update({k: ("" if v is None else v) for k, v in f.items()})
    d = row["details"] if isinstance(row["details"], str) else SDW.json_text(row["details"] or {})
    if SC._len16(d) > 4000:
        d = SDW.json_text({"cut": True, "why": "the details were longer than 4000 characters"})
    row["details"] = d
    row["status"] = row["status"] or "raised"
    row["test_mode"] = SDW.test_word(reads)
    row["created_at"] = row["created_at"] or SDW.iso_now(reads)
    row["created_by"] = row["created_by"] or "support-desk"
    return {k: gsjs.or_blank(v) for k, v in row.items()}


def _event_record(reads: L.Reads, row: dict) -> dict[str, Any]:
    sid, tab = SDW.where(reads, SDW.TABS["events"])
    return W.kept_record(sid, tab, "append", "id", row["id"], row["ref"],
                         {h: row.get(h, "") for h in SDW.HEADERS["support_events"]})


def _sd_raise(reads: L.Reads, ev: dict, items: list[dict], mem: dict) -> dict[str, Any]:
    """sdRaise_'s verdict: the items absent so far, and whether the event is absent too (raised)."""
    known = {s_(it.get("id")) for it in SDW.items_by_ref(reads).get(ev["ref"]) or []} | mem["items"]
    fresh = []
    for it in items:
        if not it or not it.get("to_uid") or it["id"] in known:
            continue
        known.add(it["id"])
        fresh.append(it)
    raised = ev["id"] not in mem["events"] and SDW.event_by_id(reads, ev["id"]) is None
    return {"raised": raised, "fresh": fresh}


def _sd_keep(reads: L.Reads, ev: dict, got: dict, mem: dict) -> list[dict]:
    """sdRaise_'s appends: the fresh items, then the event when it was absent."""
    edits = [SDW.item_record(reads, None, it, ev["ref"]) for it in got["fresh"]]
    mem["items"].update(it["id"] for it in got["fresh"])
    if got["raised"]:
        edits.append(_event_record(reads, _event_row(reads, ev)))
        mem["events"].add(ev["id"])
    return [e for e in edits if e]


def _attendance_raise(reads: L.Reads, kind: str, source_ref: str, person: str, day: str, facts: dict,
                      mem: dict) -> tuple[bool, list[dict]]:
    """sdAttendanceRaise_: one warning per absence, an item for each director it still reaches."""
    eid = "SE" + SDW.sha10(kind + "|" + source_ref)
    label = "No Call No Show" if kind == "no_call" else "Late Show"
    where = _js_join([facts.get("house"), facts.get("shift_code"), SDW.day_words(day)])
    items = [SDW.item_(reads, eid, "warning", "director", d, label + " — " + person,
                       where + ". Directors, are you aware?", facts.get("house"), day, kind)
             for d in SA.ar_receivers(reads, SDW.directors(reads)["list"], kind)]
    acct = SDW.account_by_name(reads, person)
    ev = {"id": eid, "kind": kind, "ref": eid, "route": "", "source": facts.get("source"), "source_ref": source_ref,
          "title": label + " — " + person, "category": "Attendance · " + label, "person": person,
          "person_key": name_key(person), "person_uid": s_((acct or {}).get("userid")), "house": facts.get("house"),
          "day": day, "at": facts.get("shift_at") or day, "details": facts}
    got = _sd_raise(reads, ev, items, mem)
    return got["raised"], _sd_keep(reads, ev, got, mem)


def sd_attendance(reads: L.Reads, work: list[tuple[str, dict]], today: str, mem: dict) -> list[dict]:
    """supportDeskAttendance_: Late Show and No Call No Show off the relay's clock, as warnings."""
    edits: list[dict] = []
    try:
        on = {"late_show": SA.auto_on(reads, "late_show"), "no_call": SA.auto_on(reads, "no_call")}
        if not on["late_show"] and not on["no_call"]:
            return edits
        day0 = s_(today) or SDW.day_of_ms(SDW.now_ms(reads))
        for kind, r in work:
            if kind not in on or not on[kind]:
                continue
            person = s_(r.get("person"))
            day = s_(r.get("day")) or day0
            if not person or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) or day < _day_add(day0, -1):
                continue
            sid = "staff_no_call" if kind == "no_call" else "staff_late_show"
            facts = {"source": s_(r.get("source")) or "clock", "minutes_late": s_(r.get("minutes_late")),
                     "house": s_(r.get("house")), "shift_code": s_(r.get("shift_code")),
                     "shift_at": s_(r.get("shift_at")), "read_at": s_(r.get("read_at"))}
            edits += _attendance_raise(reads, kind, SA.ledger_key(sid, person, day), person, day, facts, mem)[1]
    except Exception as exc:  # noqa: BLE001 - the hook never changes its host
        log.info("staff alerts: the Support Requests warning was held (%s: %s)", type(exc).__name__, str(exc)[:160])
    return edits


def sd_attendance_mail(reads: L.Reads, kind: str, person: str, key: str, day: str, mem: dict) -> list[dict]:
    """supportDeskAttendanceMail_: the mailbox's report, under the same key as the clock's."""
    try:
        if kind not in ("late_show", "no_call") or not SA.auto_on(reads, kind):
            return []
        day0 = SDW.day_of_ms(SDW.now_ms(reads))
        if not s_(key) or not s_(person) or s_(day) < _day_add(day0, -1):
            return []
        return _attendance_raise(reads, kind, key, s_(person), s_(day), {"source": "mail"}, mem)[1]
    except Exception as exc:  # noqa: BLE001 - the hook never changes its host
        log.info("staff alerts: the mailbox's Support Requests warning was held (%s: %s)", type(exc).__name__,
                 str(exc)[:160])
        return []


def sd_shift_row(reads: L.Reads, kind: str, r: dict, mem: dict) -> list[dict]:
    """supportDeskShiftRow_: a missing punch out (an open entry) or in (a checked login) the shift flow plans."""
    direction = "out" if kind == "punch_open_entry" else "in" if kind == "login_missing" and r.get("checked") is True \
        else ""
    if not direction:
        return []
    return sd_punch_noted(reads, [{
        "id": s_(r.get("id")), "person": s_(r.get("person")), "person_key": s_(r.get("person_key")),
        "house": s_(r.get("house")), "house_name": s_(r.get("house_name")), "shift_code": s_(r.get("shift_code")),
        "shift_at": s_(r.get("shift_at")), "shift_end": s_(r.get("shift_end")),
        "verdict": "missing" if direction == "in" else "open", "pair_fault": True,
        "read_at": s_(r.get("checked_at"))}], "shift", mem)


def _punch_also(reads: L.Reads, ref: str, direction: str, mem: dict) -> list[dict]:
    """sdPunchAlso_: one note per other direction on the same warning."""
    line = "Also not punching " + direction
    if (ref, line) in mem["notes"]:
        return []
    if any(s_(d.get("verdict")) == "note" and s_(d.get("note")) == line
           for d in SDW.decisions_by_ref(reads).get(ref) or []):
        return []
    mem["notes"].add((ref, line))
    row = SDW.decision_row(reads, ref=ref, source="event", verdict="note", note=line, by_uid="",
                           by_name="Support Requests", via="auto")
    return [SDW.decision_record(reads, row, ref)]


def sd_punch_noted(reads: L.Reads, facts: list[dict], via: str, mem: dict) -> list[dict]:
    """supportDeskPunchNoted_: the first missing punch per person per shift — a warning to the directors and the
    leads, and a text to each through Smart Comms."""
    edits: list[dict] = []
    try:
        if not SA.auto_on(reads, "punch"):
            return edits
        day0 = SDW.day_of_ms(SDW.now_ms(reads))
        for f in (facts or [])[:SD_PUNCH_MAX]:
            fact = f or {}
            verdict = s_(fact.get("verdict"))
            if verdict == "not_entered_yet" or fact.get("pair_fault") is not True or verdict not in ("missing", "open"):
                continue
            person = s_(fact.get("person"))
            minute = _utc_minute(fact.get("shift_at"))
            if not person or not minute:
                continue
            day = SDW.day_of_(fact.get("shift_at"))
            if day < _day_add(day0, -1):
                continue
            direction = "in" if verdict == "missing" else "out"
            source_ref = name_key(person) + "|" + minute
            eid = "SE" + SDW.sha10("punch|" + source_ref)
            had = SDW.event_by_id(reads, eid)
            if had is not None or eid in mem["events"]:
                was = s_(SDW.obj_((had or {}).get("details")).get("direction"))
                if was and was != direction:
                    edits += _punch_also(reads, eid, direction, mem)
                continue
            dirs = SDW.directors(reads)["list"]
            leads = [x for x in _leads(reads) if not any(d.get("uid") == x.get("uid") for d in dirs)]
            dirs_told, leads_told = SA.ar_receivers(reads, dirs, "punch"), SA.ar_receivers(reads, leads, "punch")
            house = s_(fact.get("house_name")) or s_(fact.get("house"))
            title = person + " is not punching " + direction
            body = " · ".join(x for x in (house, s_(fact.get("shift_code")), SDW.day_words(day)) if x) + \
                ". Are you aware?"
            items = [SDW.item_(reads, eid, "warning", "director", d, title, body, house, day, "punch")
                     for d in dirs_told] + \
                    [SDW.item_(reads, eid, "warning", "lead", x, title, body, house, day, "punch") for x in leads_told]
            details = {"direction": direction, "house_name": house, "shift_code": s_(fact.get("shift_code")),
                       "shift_at": s_(fact.get("shift_at")), "shift_end": s_(fact.get("shift_end")),
                       "read_at": s_(fact.get("read_at")), "verdict": verdict, "via": via}
            ev = {"id": eid, "kind": "punch", "ref": eid, "route": "", "source": via, "source_ref": source_ref,
                  "title": title, "category": "Attendance · Missing punch", "person": person,
                  "person_key": name_key(person), "person_uid": s_((SDW.account_by_name(reads, person) or {})
                                                                  .get("userid")),
                  "house": s_(fact.get("house")), "day": day, "at": s_(fact.get("shift_at")), "details": details}
            got = _sd_raise(reads, ev, items, mem)
            if not got["raised"]:
                edits += _sd_keep(reads, ev, got, mem)
                continue
            plan = SDW.text_plan(reads, _event_row(reads, ev))
            fresh = {it["id"]: it for it in got["fresh"]}
            have = {s_(it.get("id")): it for it in SDW.items_by_ref(reads).get(eid) or []}
            notes = []
            for p in _union(dirs_told, leads_told):
                word = SDW.outcome(SDW.tell(reads, plan["situation"], p, plan["vars"], eid))
                iid = "SN" + SDW.sha10(eid + "|warning|" + s_(p.get("uid")))
                if iid in fresh:
                    fresh[iid]["note"] = "text: " + word
                elif iid in have:
                    notes.append(SDW.item_record(reads, have[iid], {**have[iid], "note": "text: " + word}, eid))
            edits += _sd_keep(reads, ev, got, mem) + [n for n in notes if n]
    except Exception as exc:  # noqa: BLE001 - the hook never changes its host
        log.info("staff alerts: the missing punch warning was held (%s: %s)", type(exc).__name__, str(exc)[:160])
    return edits


# ---- staffAttendancePunch ----------------------------------------------------------------------------------------

def punch(sess: L.Session, payload: dict) -> Decision:
    """staffAttendancePunch: the time clock's late and no-call rows (the relay's PsiAnywhere check) told by the
    attendance situations' own words and lists — once per person per day per kind, the ledger read first and a ledger
    that cannot be read holding everything."""
    if not _gate(sess.user):
        return Decision(dict(SA.DENIED))
    data = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    out: dict[str, Any] = {"told": 0, "held": 0, "quiet": 0, "skipped": 0, "off": 0, "kinds": {}, "why": []}
    work: list[tuple[str, dict]] = []
    for bucket, kind in (("late", "late_show"), ("no_call", "no_call")):
        for r in data.get(bucket) or []:
            work.append((kind, r if isinstance(r, dict) else {}))
    if not work:
        return Decision({"status": 200, "data": out})
    today = reads.now.astimezone(NY).strftime("%Y-%m-%d")
    mem = _sd_memory()
    edits = sd_attendance(reads, work, today, mem)

    told = SA.ledger_keys(reads)
    if told is None:
        out["held"] = len(work)
        out["why"].append("the Smart Comms ledger could not be read, so nobody was told: telling again what another "
                          "door already said is the one mistake this door cannot take back. The rows wait for the "
                          "next pass.")
        log.warning("staff alerts: %s row(s) held — the ledger could not be read, and a read that failed is not a "
                    "ledger that is empty", len(work))
        return _done({"status": 503, "message": "The Smart Comms ledger could not be read — nothing was sent, and "
                                                  "the next pass tries again", "data": out}, edits)

    sits: dict[str, dict] = {}
    unreadable = ""
    for kind, _r in work:
        if unreadable or kind in sits:
            continue
        sits[kind] = SA.situation(reads, kind)
        unreadable = sits[kind]["unreadable"]
    if unreadable:
        out["held"] = len(work)
        out["why"].append(unreadable + ", so nobody was told; the rows wait for the next pass.")
        log.warning("staff alerts: %s row(s) held — %s", len(work), unreadable)
        return _done({"status": 503, "message": "The Smart Comms situations could not be read — nothing was sent, "
                                                  "and the next pass tries again", "data": out}, edits)

    started = time.time()
    for kind, row in work:
        if time.time() - started > PASS_S:
            out["held"] += 1
            continue
        person = s_(row.get("person"))
        if not person:
            out["skipped"] += 1
            continue
        sid = "staff_no_call" if kind == "no_call" else "staff_late_show"
        day = s_(row.get("day")) or today
        key = SA.ledger_key(sid, person, day)
        if key in told:
            out["skipped"] += 1
            continue
        read = sits[kind]
        if SA.stop_why(read):
            out["held"] += 1
            continue
        shift_words = " · ".join(x for x in (s_(row.get("house")), s_(row.get("shift_code"))) if x)
        when_words = s_(row.get("when")) or (s_(row.get("minutes_late")) + " minutes after the shift began"
                                             if s_(row.get("minutes_late")) else s_(row.get("shift_at")))
        report_words = SC._cut16(s_(row.get("report")), 300) or \
            "No report was written: the time clock has no punch for this shift."
        source = "form" if s_(row.get("source")) == "form" else "time_clock"
        word_vars = {"person": person, "when": when_words, "name": person, "first_name": re.split(r"\s+", person)[0],
                     "shift": shift_words}
        letter = SA.letter(read, {"kind": kind, "person": person, "whenText": when_words,
                                  "shiftText": shift_words or SA.shift_text(reads, person, day),
                                  "arrivedText": s_(row.get("arrived")), "reportWords": report_words,
                                  "source": source}, word_vars)
        mail_to = SA.recipients(read)
        plan = SA.sms_plan(read, word_vars)
        if not mail_to and not plan:
            SA.nobody_say(read)
            out["held"] += 1
            continue
        if plan:
            plan["numbers"] += SA.escalation(reads, person, day)
        mail_to = SA.ar_keep(reads, kind, mail_to)
        text_to = SA.ar_keep(reads, kind, plan["numbers"]) if plan else []
        if not mail_to and not text_to:
            out["off"] += 1
            continue
        sent: list[str] = []
        quiet_leg = False
        for addr in mail_to:
            got = _leg(_say(sid=sid, to=addr, person=person, lane=LANE_PUNCH, channel="email", body=letter["text"],
                            subject=letter["subject"], html=letter["html"], ledger_key=key,
                            key="att_punch_mail_" + sid + "_" + SC._cut16(person, 20) + "_" + day + "_"
                                + gsjs.trim(addr).lower()))
            if got == "sent":
                sent.append(addr)
            elif got == "quiet":
                quiet_leg = True
        if plan:
            texted: set[str] = set()
            for i, raw in enumerate(plan["numbers"]):
                if raw not in text_to:
                    continue
                digits = re.sub(r"\D", "", s_(raw))[-10:]
                if not digits or digits in texted:
                    continue
                texted.add(digits)
                num = SC.team_copy(raw)
                if not num:
                    continue
                got = _leg(_say(sid=sid, to=num, person=person, lane=LANE_PUNCH, body=plan["body"], team=True,
                                ledger_key=key,
                                key="att_punch_sms" + str(i) + "_" + sid + "_" + SC._cut16(person, 20) + "_" + day))
                if got == "sent":
                    sent.append(num)
                elif got == "quiet":
                    quiet_leg = True
        if sent:
            out["told"] += 1
            out["kinds"][kind] = out["kinds"].get(kind, 0) + 1
            SC.record_ledger(key, sid, person, day, "punch", reads.db)
            told.add(key)
        elif quiet_leg:
            out["quiet"] += 1
            out["held"] += 1
        else:
            out["held"] += 1
    log.info("staff alerts: attendance punch — %s told · %s held%s · %s already told today · %s%s", out["told"],
             out["held"], f" ({out['quiet']} of them by the quiet window, until 08:00)" if out["quiet"] else "",
             out["skipped"], f"{out['off']} turned off by every recipient · " if out["off"] else "", out["kinds"])
    return _done({"status": 200, "data": out}, edits)


# ---- staffShiftReminder ------------------------------------------------------------------------------------------

def _mails(kind: str, r: dict) -> bool:
    """staffShiftMails_: the kinds whose words also go by e-mail."""
    if r.get("mail") is True:
        return True
    if r.get("mail") is False:
        return False
    return kind.startswith("handoff_") or kind.startswith("timeoff_") or kind.startswith("punch_")


def _no_show_status(r: dict) -> str:
    """staffShiftNoShowStatus_: what a 'did not go to work' may say, from what backs it."""
    checked, asked = r.get("checked") is not False, r.get("asked") is not False
    if checked and r.get("replied") is True:
        return "did not go to work - replied, but not YES, and no clock-in"
    if checked and asked:
        return "did not go to work - no reply and no clock-in"
    if checked:
        return "did not go to work - no clock-in"
    if asked:
        return "did not reply, and the time clock could not be checked,"
    return "was asked only in the rehearsal book, and the time clock could not be checked,"


def _note_shifts(r: dict) -> str:
    """staffShiftNoteShifts_: the shifts one note reminder is about."""
    got = r.get("shifts")
    shifts = got if isinstance(got, list) and got else [{"shift_at": r.get("shift_at"), "house": r.get("house"),
                                                         "house_name": r.get("house_name")}]

    def one(x: Any) -> str:
        x = x if isinstance(x, dict) else {}
        d, t = SA.shift_day(x.get("shift_at")), SA.shift_time(x.get("shift_at"))
        h = s_(x.get("house_name")) or s_(x.get("house")) or "your house"
        return " ".join(v for v in (d, t) if v) + (" " if d or t else "") + "shift at " + h
    if len(shifts) == 1:
        return "your " + one(shifts[0])
    return str(len(shifts)) + " shifts: " + " and ".join(one(x) for x in shifts)


def _int0(v: Any) -> str:
    """String(Math.max(0, parseInt(v, 10) || 0))."""
    return str(max(0, SCD.js_parse_int(v) or 0))


def _other(r: dict) -> str:
    """staffShiftHandoffOther_: the giver hears the receiver's name; everyone else hears the giver's."""
    kind = s_(r.get("kind"))
    if kind in ("handoff_done", "handoff_declined"):
        return s_(r.get("to_staff"))
    return s_(r.get("from_staff")) if kind.startswith("handoff_") else ""


def _vars(r: dict, sit: dict, sender: str) -> dict[str, str]:
    """staffShiftVars_: one placeholder set for every shift-flow situation."""
    person = s_(r.get("person"))
    handoff = s_(r.get("kind")).startswith("handoff_")
    houses = r.get("houses")
    return {
        "first_name": re.split(r"\s+", person)[0] or person,
        "name": (s_(r.get("taker")) or s_(r.get("to_staff"))) if handoff else person,
        "house": s_(r.get("house_name")) or s_(r.get("house")) or "your house",
        "time": SA.shift_time(r.get("shift_at")) or s_(r.get("shift_code")),
        "day": SA.shift_day(r.get("shift_at")),
        "minutes": _int0(r.get("minutes")),
        "arrived": SA.shift_clock(r.get("arrived")),
        "sender": s_(sit.get("sender")) or sender,
        "login_state": "we could not check PsiAnywhere, so this is a reminder" if r.get("checked") is False
        else "you have not logged in to PsiAnywhere yet",
        "status": (SA.ascii_words(r.get("why")) or "it did not go through") if handoff else _no_show_status(r),
        "shifts": _note_shifts(r),
        "approval": SA.ascii_words(r.get("approval_why")),
        "training": SA.ascii_words(r.get("training")),
        "reply": SA.ascii_words(r.get("reply")),
        "ref": s_(r.get("ref")) or s_(r.get("handoff_id")),
        "other": _other(r),
        "shift": s_(r.get("value")) or s_(r.get("shift_code")),
        "handoff": s_(r.get("handoff_id")),
        "applicants": _int0(r.get("applicants")),
        "to_name": s_(r.get("to_name")),
        "to_first_name": re.split(r"\s+", s_(r.get("to_name")))[0] or "there",
        "requester": s_(r.get("requester")),
        "dates": SA.ascii_words(r.get("dates")),
        "days": s_(r.get("days")),
        "houses": ", ".join(gsjs.or_blank(h) for h in houses) if isinstance(houses, list) else s_(houses),
        "link": MD.mail_platform_url() + s_(r.get("link_path")) if s_(r.get("link_path")) else "",
        "by": s_(r.get("by")),
        "words": SA.ascii_words(r.get("words")),
        "drafts": SA.ascii_words(r.get("drafts")),
        "reason_line": SA.ascii_words(r.get("reason_line")),
        "staff": s_(r.get("staff")),
        "ends": SA.shift_time(r.get("shift_end")),
        "next_shift": s_(r.get("next_shift")),
        "next_house": s_(r.get("next_house")),
        "next_time": SA.shift_time(r.get("next_at")),
        "punched_in": SA.shift_clock(r.get("punched_in")),
        "tells": s_(r.get("tells")),
        "call_off_ref": s_(r.get("call_off_ref")),
        "why": SA.ascii_words(r.get("why"))}


def _safe_id(v: str) -> str:
    return re.sub(r"[^A-Za-z0-9_|:\-]", "", v)[:200]


def _shift_mail(reads: L.Reads, r: dict, sit: dict, vars_: dict, dial: str, person: str, res: dict,
                people: dict | None, sits: list[dict]) -> None:
    """staffShiftMail_: a transfer's, a time off's or a punch's e-mail beside the text; only the text decides what the
    relay records."""
    kind = s_(r.get("kind"))
    if not _mails(kind, r):
        return
    own_sid = MAIL_SITUATIONS.get(kind)
    if own_sid:
        own = SCD.situation_on(sits, own_sid)
        if not own:
            res["email"], res["email_why"] = "held", "the situation " + own_sid + " is off or absent"
            return
        sit = own
        if s_(own.get("sender")):
            vars_ = {**vars_, "sender": s_(own.get("sender"))}
    if "email" not in SC.smart_list(sit.get("channels")) or not s_(sit.get("email_text")):
        return
    if not people or not people.get("readable"):
        res["email"], res["email_why"] = "failed", "the People house could not be read"
        return
    p = people["byKey"].get(name_key(person))
    to = s_((p or {}).get("email"))
    if not to:
        res["email"] = "no_address"
        return
    subject = SC.render(s_(sit.get("email_subject")), vars_)
    body = SC.render(s_(sit.get("email_text")), vars_)
    if dial != "send" or r.get("rehearsal_only") is True:
        _held_rows(reads, sid=s_(sit.get("id")), intent="SHIFT_MAIL|" + res["id"], person=person,
                   person_key=name_key(person), channel="email", to=to, subject=subject, body=body,
                   sender=s_(vars_.get("sender")), reasons="the sending dial stands at `" + dial + "`",
                   held_by="the sending dial stands at `" + dial + "`, not `send`", purpose="shift")
        res["email"] = "recorded"
        return
    got = _say(sid=s_(sit.get("id")), to=to, person=person, lane="shift e-mail", channel="email", body=body,
               subject=subject, key="shift_mail_" + _safe_id(res["id"]))
    state, held = s_(got.get("state")), s_(got.get("held"))
    res["email"] = ("told" if state == "sent" else "recorded" if state == "held" and held in ("test_mode", "recorded")
                    else "refused_quiet" if state == "held" and held == "quiet" else "duplicate" if state == "already"
                    else "held" if state in ("held", "refused") else "failed")


def shift_reminder(sess: L.Session, payload: dict) -> Decision:
    """staffShiftReminder: the shift flow's door — each row the relay plans (the ask before a shift and its repeats,
    the house manager's no-show, the PsiAnywhere login, the hand-offs, the time off, the punch pair, the reply
    ear's acknowledgements) said in its situation's words to the person it names, one answer per row."""
    user = sess.user
    if user and not user.get("is_service") and s_(user.get("role")) != "admin":
        return Decision(dict(SA.DENIED))
    data = payload if isinstance(payload, dict) else {}
    rows = data.get("rows")[:SHIFT_MAX_ROWS] if isinstance(data.get("rows"), list) else []
    out: dict[str, Any] = {"results": [], "counts": {}}
    if not rows:
        return Decision({"status": 200, "data": out})
    reads = sess.reads
    quiet = SA.quiet_now(reads.now)
    people: dict | None = None
    managers: dict = {}
    sender = SC.SENDER_DEFAULT
    try:
        dial_state = SCD.dial(reads.config())
    except Exception:  # noqa: BLE001 - a dial that cannot be read says nothing and closes nothing
        dial_state = {"word": "off", "readable": False}
    dial = s_(dial_state.get("word")) or "off"
    out["dial"] = dial if dial_state["readable"] else "unknown"
    out["test_mode"] = "" if not dial_state["readable"] else "off" if dial == "send" else "on" if dial == "record" \
        else ""
    mem = _sd_memory()
    edits: list[dict] = []
    started = time.time()
    for raw in rows:
        if time.time() - started > PASS_S:
            # unanswered: the relay offers it again
            break
        r = raw if isinstance(raw, dict) else {}
        res: dict[str, Any] = {"id": s_(r.get("id")), "state": "", "why": "", "phone_key": ""}

        def answer(state: str, why: str = "", res: dict = res) -> None:
            res["state"], res["why"] = state, why
            out["counts"][state] = out["counts"].get(state, 0) + 1
            out["results"].append(res)
        kind = s_(r.get("kind"))
        edits += sd_shift_row(reads, kind, r, mem)
        sid = SITUATIONS.get(kind, "")
        if not res["id"] or not sid:
            answer("refused", "not a row this door knows")
            continue
        if quiet:
            answer("refused_quiet", "inside the quiet window (21:31–08:00 New York): nothing is said, and the relay "
                                    "re-plans at 08:00")
            continue
        if not dial_state["readable"]:
            answer("dial_unknown", "the sending dial could not be read: nothing is said or written, and the relay "
                                   "asks again")
            continue
        if dial not in ("send", "record"):
            answer("dial_off", "the sending dial stands at `" + dial + "`: nothing is said or written")
            continue
        try:
            sits = SA.situations(reads)
        except Exception as exc:  # noqa: BLE001 - whether it is on cannot be told
            res["code"] = "situation_unread"
            answer("held", "the situations tab could not be read (" + type(exc).__name__ + "): whether " + sid +
                   " is on cannot be told, so nothing is said, and the relay offers it again")
            continue
        sit = SCD.situation_on(sits, sid)
        if not sit:
            res["code"] = "situation_off"
            answer("held", "the situation " + sid + " is off or absent")
            continue
        if "sms" not in SC.smart_list(sit.get("channels")) or not s_(sit.get("sms_text")):
            res["code"] = "no_words"
            answer("held", "the situation " + sid + " names no SMS words")
            continue
        if kind in HANDOFF_TO:
            r = {**r, "person": s_(r.get(HANDOFF_TO[kind]))}
            r["person_key"] = name_key(r["person"])
        person = s_(r.get("person"))
        key = name_key(person) or s_(r.get("person_key"))
        to, to_name, team = "", "", False
        found: dict | None = None
        if kind in TO_MANAGER:
            if s_(r.get("house_manager")):
                hm_phone = s_(r.get("manager_phone"))
                if not hm_phone:
                    people = people or SA.people_index(reads)
                    if not people["readable"]:
                        answer("failed", "the People house could not be read")
                        continue
                    hm_row = people["byKey"].get(name_key(r.get("house_manager")))
                    hm_phone = s_((hm_row or {}).get("phone"))
                found = {"hm": {"name": s_(r.get("house_manager")), "phone": hm_phone}, "readable": True}
            else:
                found = SA.house_manager(reads, s_(r.get("house")) or s_(r.get("location")), managers)
            if not found["hm"] and not found["readable"]:
                answer("failed", "the hotline calendar could not be read")
                continue
            to = SC.team_copy(found["hm"]["phone"]) if found["hm"] else ""
            if not to:
                answer("no_manager", 'the hotline calendar names no manager with a number for "' +
                       (s_(r.get("house")) or s_(r.get("location"))) + '"')
                continue
            team = True
            to_name = "the house manager" + (" " + s_(found["hm"].get("name")) if s_(found["hm"].get("name")) else "")
        elif kind in TO_DIRECTORS:
            try:
                aud = HC.audience_from(reads, reads.config(), sit, {})
            except Exception as exc:  # noqa: BLE001 - "we cannot see", never "nobody"
                aud = {"readable": False, "why": [type(exc).__name__], "entries": []}
            if not aud.get("readable"):
                answer("failed", " · ".join(aud.get("why") or []) or "the directors could not be resolved")
                continue
            for e in aud.get("entries") or []:
                dest = s_((e or {}).get("to"))
                digits = re.sub(r"\D", "", dest)[-10:] if "@" not in dest else ""
                if len(digits) == 10:
                    to = "+1" + digits
                    break
            if not to:
                answer("no_manager", "the directors audience resolved to no number this platform may text")
                continue
            team = "group"
            to_name = "the directors (5558 group)"
        else:
            people = people or SA.people_index(reads)
            if not people["readable"]:
                answer("failed", "the People house could not be read")
                continue
            p = people["byKey"].get(key)
            if not p:
                res["code"] = "no_person"
                answer("no_contact", "nobody by that name in the People house")
                continue
            if not p["onStaff"]:
                answer("not_staff", "the People house does not mark them on staff")
                continue
            to = SC.sendable(p["phone"])
            if not to:
                answer("no_contact", "no number we may text")
                continue
            res["phone_key"] = SA.phone_key(to)
            to_name = s_(p.get("name")) or person
        vars_ = _vars(r, sit, sender)
        plain_to = (s_(r.get("to_name")) or (s_(found["hm"].get("name")) if found and found.get("hm") else "")) \
            if kind in TO_MANAGER else "" if kind in TO_DIRECTORS else to_name
        vars_["to_name"] = plain_to
        vars_["to_first_name"] = re.split(r"\s+", plain_to)[0] or "there"
        if kind not in TO_DIRECTORS:
            if people is None and _mails(kind, r):
                people = SA.people_index(reads)
            try:
                _shift_mail(reads, r, sit, vars_, dial, (s_(r.get("house_manager")) or person)
                            if kind in TO_MANAGER else person, res, people, sits)
            except Exception:  # noqa: BLE001 - the text's answer stands
                res["email"] = "failed"
        body = SC.render(s_(sit.get("sms_text")), vars_)
        rehearsal_only = r.get("rehearsal_only") is True
        if dial != "send" or rehearsal_only:
            what = "the house manager of this shift" if kind in TO_MANAGER else "the directors (5558 group)" \
                if kind in TO_DIRECTORS else "the staff member of this shift"
            why = ("the person's asks went only into the rehearsal book, so this is written there and NOBODY WAS "
                   "CONTACTED - no manager is told about somebody no ask reached") if rehearsal_only else \
                ("the sending dial stands at `" + dial + "`, not `send`: " + what + " was resolved (1) and written "
                 "down, and NOBODY WAS CONTACTED. The turn is still owed — nothing was claimed, so this row can still "
                 "take it. IT IS NOT A QUEUE: nothing re-sends this one, so turning test mode off — the dial follows "
                 "it — hands over the NEXT call-off or the next caller, and what stands for this one is the mock "
                 "outbox, the rehearsal book and this row.")
            noted = _held_rows(reads, sid=sid, intent="SHIFT|" + res["id"], person=person, person_key=key,
                               channel="sms", to=to, subject="", body=body, sender=s_(vars_.get("sender")),
                               reasons=why, purpose="shift · to " + to_name,
                               held_by="rehearsal only — the asks before it reached nobody" if rehearsal_only
                               else "the sending dial stands at `" + dial + "`, not `send`")
            answer("recorded", ("rehearsal only (the asks reached nobody)" if rehearsal_only
                                else "the sending dial stands at `" + dial + "`") + ": nobody was contacted" +
                   (" — the message is in the rehearsal book" if noted
                    else " — and the rehearsal row could not be written"))
            continue
        got = _say(sid=sid, to=to, person=person, person_key=key, lane="shift · to " + to_name, body=body, team=team,
                   key="shift_rem_" + _safe_id(res["id"]))
        state, held, gwhy = s_(got.get("state")), s_(got.get("held")), s_(got.get("why"))
        if state == "held" and held == "quiet":
            answer("refused_quiet", "the send door's quiet window (" + SCD.quiet_words() + "): nothing is said, and "
                                    "the relay re-plans at 08:00")
        elif state == "sent":
            SC.record_ledger(res["id"], sid, person, s_(r.get("day")), "sms", reads.db)
            answer("told")
        elif state == "held" and held == "test_mode":
            answer("rehearsed", gwhy)
        elif state == "held" and held == "recorded":
            answer("recorded", gwhy)
        elif state == "already":
            answer("duplicate", "this exact message already went")
        elif state == "refused":
            answer("opted_out", gwhy)
        elif state == "held":
            answer("held", gwhy or "the send door held it")
        else:
            answer("failed", gwhy or "the send door gave no answer")
    log.info("staff alerts: shift reminder — %s row(s): %s", len(rows), out["counts"])
    return _done({"status": 200, "data": out}, edits)


# ---- staffAttendanceSweep ----------------------------------------------------------------------------------------

def _table(reads: L.Reads, resource: str) -> list[tuple[str, dict, dict[str, str]]]:
    """A memory resource's rows under the lock: (key, cells as kept, cells as text)."""
    cols = RR.columns(reads, resource)
    out = []
    for k, c in RR.table_rows(reads, resource):
        shown = RR.shown(cols, c)
        if shown is not None:
            out.append((k, c, {h: s_(v) for h, v in shown.items()}))
    return out


def _mark_filed(reads: L.Reads, resource: str, results: list[dict], folder: Callable[[dict], str]) -> int:
    """The filing's answer kept on the rows: 'yes' when moved, 'not-in-inbox' once missed, 'gone' when missed twice."""
    moved_total = 0
    if not results:
        return moved_total
    rows = _table(reads, resource)
    items = []
    for got in results:
        moved, missing = set(got.get("moved") or []), set(got.get("missing") or [])
        moved_total += len(got.get("moved") or [])
        for key, cells, r in rows:
            mark = r.get("filed", "")
            if mark not in ("", "not-in-inbox") or folder(r) != got.get("folder"):
                continue
            mid = r.get("message_id", "")
            if mid in moved:
                items.append((key, cells, {"filed": "yes"}))
            elif mid in missing:
                items.append((key, cells, {"filed": "gone" if mark == "not-in-inbox" else "not-in-inbox"}))
    RR.update_many(reads, resource, items, AUTHOR)
    return moved_total


def _simulate(reads: L.Reads, prep: dict) -> Decision:
    """The simulation: the last reports' letters, marked [SIMULATION], to the Late Show row's addresses."""
    to = SA.recipients(SA.situation(reads, "late_show"))
    sent: list[str] = []
    looked: list[str] = []
    for f in prep.get("letters") or []:
        kind, person, when_iso = s_(f.get("kind")), s_(f.get("person")), s_(f.get("when_iso"))
        looked.append(person + ": " + (s_(f.get("shift")) or "no roster row") +
                      (" / arrived " + s_(f.get("arrived")) if s_(f.get("arrived")) else ""))
        letter = MD.staff_alert_email({
            "kind": kind, "person": person, "whenText": SA.when_text(when_iso), "shiftText": s_(f.get("shift")),
            "arrivedText": s_(f.get("arrived")),
            "reportWords": SA.quote_text(("No Show No Call" if kind == "no_call" else "Late Show") + " — " + person +
                                         " (" + when_iso + ")")})
        for addr in to:
            got = _say(sid="staff_late_show", to=addr, person=person, lane=LANE_SIM, channel="email",
                       body=letter["text"], subject="[SIMULATION] " + letter["subject"], html=letter["html"],
                       key="att_sim_" + uuid.uuid4().hex)
            if s_(got.get("state")) == "sent":
                sent.append(addr)
    return Decision({"status": 200, "data": {"simulated": len(prep.get("letters") or []), "sent": len(sent),
                                             "looked_up": looked}}, subject="", own=True)


def sweep(sess: L.Session, payload: dict) -> Decision:
    """staffAttendanceSweep: what staffAttendanceDue read in the mailbox, recorded — each new report told to its
    situation's list (unless another door already told it, its situation is off, or its message is too old), the
    model's verdicts and the general folders kept, the filing's marks written."""
    if not _gate(sess.user):
        return Decision(dict(SA.DENIED))
    p = payload if isinstance(payload, dict) else {}
    if p.get("prepared") is None:
        raise Defer("staffAttendanceSweep is read by staffAttendanceDue first")
    prep = R.unsealed(SA.SWEEP, R.actor(sess.user), p.get("prepared"))
    if prep is None:
        return W.refuse(409, STALE)
    reads = sess.reads
    if prep.get("simulate"):
        return _simulate(reads, prep)
    out: dict[str, Any] = {"ran": True, "matched": 0, "alerted": 0, "filed_only": 0, "moved": 0,
                           "folders": list(prep.get("folders") or []), "routed": 0, "routed_moved": 0,
                           "route_folders": list(prep.get("route_folders") or []),
                           "held": int(prep.get("held_no_reader") or 0) + int(prep.get("held_refused") or 0),
                           "held_refused": int(prep.get("held_refused") or 0), "already_told": 0, "category_off": 0,
                           "gated_not_sent": 0, "send_failed": 0, "held_quiet": 0, "switch_unreadable": 0,
                           "recipients": []}
    if prep.get("due") is not True:
        return Decision({"status": 200, "data": out}, subject="", own=True)
    stamp = W.now_iso(reads)

    ai_have = {r.get("message_id") for _k, _c, r in _table(reads, "mailAiVerdicts")}
    ai_new = [{h: s_(a.get(h)) for h in SA.AI_HEADER} for a in prep.get("ai_rows") or []
              if s_(a.get("message_id")) and s_(a.get("message_id")) not in ai_have]
    RR.create_many(reads, "mailAiVerdicts", ai_new, AUTHOR)

    seen = {r.get("message_id") for _k, _c, r in _table(reads, "staffAlerts")}
    told = SA.ledger_keys(reads)
    if told is None:
        log.warning("staff alerts: the Smart Comms ledger could not be read; this pass sends without it rather than "
                    "holding the reports")
    mem = _sd_memory()
    edits: list[dict] = []
    alerts_new: list[dict[str, str]] = []
    started = time.time()
    for rep in prep.get("reports") or []:
        mid = s_(rep.get("mid"))
        if not mid or mid in seen:
            continue
        if time.time() - started > PASS_S:
            # left in the inbox, unrecorded: the next pass reads it again
            continue
        kind, person, day = s_(rep.get("kind")), s_(rep.get("person")), s_(rep.get("day"))
        fresh = rep.get("fresh") is True
        lkey, lsid = s_(rep.get("ledger_key")), s_(rep.get("ledger_sid"))
        if fresh and lkey:
            edits += sd_attendance_mail(reads, kind, person, lkey, day, mem)
        held_by_ledger = bool(fresh and lkey and told is not None and lkey in told)
        sit_here = SA.situation(reads, kind) if fresh and not held_by_ledger else None
        if sit_here and sit_here["unreadable"]:
            out["switch_unreadable"] += 1
            if out["switch_unreadable"] == 1:
                log.warning("staff alerts: %s — attendance reports stay in the inbox", SA.stop_why(sit_here))
            continue
        sent_to: list[str] = []
        gated_word = ""
        quiet_any = False
        if held_by_ledger:
            out["already_told"] += 1
        elif sit_here and SA.stop_why(sit_here):
            out["category_off"] += 1
            gated_word = "held-category-off"
        elif fresh:
            mail_vars = {"person": person, "when": s_(rep.get("when_text")), "name": person,
                         "first_name": re.split(r"\s+", person)[0], "shift": s_(rep.get("shift"))}
            letter = SA.letter(sit_here, {
                "kind": kind, "kindLabel": s_(rep.get("label")), "folderName": s_(rep.get("folder")),
                "person": person, "whenText": s_(rep.get("when_text")), "shiftText": s_(rep.get("shift")),
                "arrivedText": s_(rep.get("arrived")) if kind == "late_show" else "",
                "reportWords": s_(rep.get("report_words"))}, mail_vars)
            gated_any = recorded_any = False
            to_here = SA.recipients(sit_here)
            named = len(to_here)
            to_here = SA.ar_keep(reads, kind, to_here)
            for addr in to_here:
                got = _leg(_say(sid=s_(sit_here["id"]), to=addr, person=person, lane=LANE_MAIL, channel="email",
                                body=letter["text"], subject=letter["subject"], html=letter["html"],
                                ledger_key=lkey, key="att_mail_" + _safe_id(mid) + "_" + gsjs.trim(addr).lower()))
                if got == "sent":
                    sent_to.append(addr)
                elif got == "recorded":
                    recorded_any = True
                elif got == "quiet":
                    quiet_any = True
                elif got == "gated":
                    gated_any = True
            plan = SA.sms_plan(sit_here, mail_vars)
            if not named and not plan:
                SA.nobody_say(sit_here)
                out["category_off"] += 1
                gated_word = "held-names-nobody"
            numbers: list[str] = []
            if plan:
                numbers = SA.ar_keep(reads, kind, plan["numbers"] + [s_(n) for n in rep.get("escalation") or []])
                texted: set[str] = set()
                for n in numbers:
                    digits = re.sub(r"\D", "", s_(n))[-10:]
                    if not digits or digits in texted:
                        continue
                    texted.add(digits)
                    num = SC.team_copy(n)
                    if not num:
                        continue
                    got = _leg(_say(sid=s_(sit_here["id"]), to=num, person=person, lane=LANE_MAIL, body=plan["body"],
                                    team=True, ledger_key=lkey, key="att_sms_" + _safe_id(mid) + "_" + digits))
                    if got == "sent":
                        sent_to.append(num)
                    elif got == "recorded":
                        recorded_any = True
                    elif got == "quiet":
                        quiet_any = True
                    elif got == "gated":
                        gated_any = True
            if not gated_word and not to_here and not (plan and numbers):
                gated_word = "held-receivers-off"
            if sent_to:
                out["alerted"] += 1
            elif quiet_any and not recorded_any:
                out["held_quiet"] += 1
            elif recorded_any or gated_any:
                out["gated_not_sent"] += 1
                gated_word = "recorded-not-sent" if recorded_any else "gated-not-sent"
            if lkey and sent_to:
                SC.record_ledger(lkey, lsid, person, day, "mailbox", reads.db)
                told = told if told is not None else set()
                told.add(lkey)
        else:
            out["filed_only"] += 1
        if fresh and not held_by_ledger and not gated_word and not sent_to and out["held_quiet"] and quiet_any:
            continue
        if fresh and not held_by_ledger and not gated_word and not sent_to:
            out["send_failed"] += 1
            log.warning("staff alerts: %s — %s for %s: every leg refused, so it is neither filed nor remembered; the "
                        "next sweep tries again", mid, kind, person)
            continue
        alerts_new.append({
            "message_id": mid, "kind": kind, "person": person, "when_iso": s_(rep.get("when_iso")),
            "when_text": s_(rep.get("when_text")),
            "alerted": ("already-told" if held_by_ledger else (gated_word or "sent")) if fresh else "skipped-old",
            "recipients": ", ".join(sent_to), "filed": "", "seen_at": stamp, "folder": s_(rep.get("folder"))})
        seen.add(mid)
    RR.create_many(reads, "staffAlerts", alerts_new, AUTHOR)
    out["matched"] = out["alerted"] + out["filed_only"]

    routed = {r.get("message_id") for _k, _c, r in _table(reads, "mailRoutes")}
    routes_new = [{h: s_(x.get(h)) for h in SA.ROUTES_HEADER} for x in prep.get("routes") or []
                  if s_(x.get("message_id")) and s_(x.get("message_id")) not in routed]
    RR.create_many(reads, "mailRoutes", routes_new, AUTHOR)
    out["routed"] = len(routes_new)

    out["moved"] = _mark_filed(reads, "staffAlerts", prep.get("filed") or [],
                               lambda r: r.get("folder") or SA.folder_of(r.get("kind", ""), ""))
    out["routed_moved"] = _mark_filed(reads, "mailRoutes", prep.get("route_filed") or [],
                                      lambda r: r.get("folder") or "Mail Other")
    out["recipients"] = SA.recipients(SA.situation(reads, "late_show")) if out["alerted"] else []
    if out["matched"] or out["send_failed"] or out["held"]:
        log.info("staff alerts: sweep — %s", {k: v for k, v in out.items() if isinstance(v, int) and v})
    return _done({"status": 200, "data": out}, edits)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "staffAttendancePunch": punch, "staffShiftReminder": shift_reminder, "staffAttendanceSweep": sweep,
    "staffAlertsUpload": RR.upload_door({r: {"tab": t} for r, t in SA.RESOURCES.items()})}
# the doors gate their own callers: the relay's identity, or an admin pressing them by hand
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.staff_alerts_writes and _receipts; the sweep's memory app.resource_rows', the messages Smart Comms'
    outbox's, the warnings app.edits'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="staff_alerts", label="Staff attendance")
