"""myCalendarVacationFile (apps-script/SupportDesk.gs) on Python, merged into Support Requests' writes
(support_desk_writes) from main.py: the caller's own time off filed from My Calendar into Scheduling's own time-off flow
as schedFlowTimeOffAsk_ (SchedulingFlows.gs) files it — the flow waiting on the directors, an approval item in each
one's My Work — then raised on the Support Requests board as sdVacationRaise_ raises it, an informative to each director
but the asker and the event once. Every row is kept in app.edits as one final write: the flow and its items over
Scheduling's houses, the event and its items over Support Requests' (support_raise). A held lock answers in
schedLock_'s own words; whatever the copy cannot say is answered unwritten, nothing kept."""
from __future__ import annotations

import logging
from typing import Any, Callable

import hubdb
import locations as L
import my_calendar_writes as MCW
import scheduling as SCH
import scheduling_flows as SF
import scheduling_timeoff as STO
import scheduling_writes as SW
import support_desk_writes as SDW
import support_raise as SR
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

FLOWS, INBOX = STO.FLOWS, STO.INBOX
VIA = "my-calendar"
ASKED = "Asked. Both directors have it; the first answer decides."
# Scheduling.gs SCHED_BUSY_SENTENCE
SCHED_BUSY = "Somebody else is changing the calendar right now — try again."
VISITING = "Ask from your own account — not while visiting someone else."
NO_KEY = "Your account is not matched to one person on the calendar."
ASK_BODY = ("Approve to put every shift of theirs in those days up as an open shift; days beyond the last calendar "
            "period are applied when the roll creates them.")

s_ = SDW.s_


def time_off_on(reads: L.Reads) -> bool:
    """hubMyWorkAutoOn_('time_off'): FAIL-CLOSED, a copy that cannot say never taken for off."""
    try:
        return MCW.auto_time_off(reads)
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - hubMyWorkAutoOn_ reads a throw as off
        return False


def sched_ready(reads: L.Reads) -> bool:
    """sdHasSched_: Scheduling's flows and items houses set up."""
    return reads.db.house_moved(FLOWS) and reads.db.house_moved(INBOX)


def time_off_ask(reads: L.Reads, g: dict, p: dict, via: str) -> tuple[dict | None, SW.Plan | None, dict | None]:
    """schedFlowTimeOffAsk_: the refusal, or the plan holding the flow and its approval items, and the flow."""
    frm = SF._text(p.get("from"), 10)
    to = SF._text(p.get("to"), 10) or SF._text(p.get("from"), 10)
    reason = SF._text(p.get("reason"), 500)
    if not SF._ymd(frm) or not SF._ymd(to):
        return {"status": 400, "message": "Pick the first and the last day off."}, None, None
    if to < frm:
        return {"status": 400, "message": "The last day comes before the first."}, None, None
    if to > SF._add_days(frm, SF.TIMEOFF_MAX_DAYS - 1):
        return {"status": 400, "message": f"Time off is asked for at most {SF.TIMEOFF_MAX_DAYS} days at a time."}, \
            None, None
    if not g["key"]:
        return {"status": 403, "message": "Your account is not matched to one person on the calendar, so time off "
                                          "cannot be filed here."}, None, None
    mn = SF._settings(reads)["min_days_ahead"]
    if frm < SF._add_days(reads.today(), mn):
        return {"status": 409, "message": f"Time off needs at least {mn} days' notice — inside that, use Call Off or "
                                          "Swap."}, None, None
    clash = None
    for f in SF._rows(reads, FLOWS):
        if f.get("kind") != "time_off" or s_(f.get("person_key")) != g["key"]:
            continue
        if s_(f.get("state")) not in ("waiting", "approved", "approved_future"):
            continue
        if s_(f.get("date")) <= to and (s_(f.get("date_to")) or s_(f.get("date"))) >= frm:
            clash = f
    if clash:
        return {"status": 409, "message": "You already have time off asked or approved from " +
                                          (clash.get("date") or "") + " to " +
                                          (clash.get("date_to") or clash.get("date") or "") + "."}, None, None
    dirs = SF._directors(reads)
    if not dirs["readable"]:
        return {"status": 503, "message": "Nobody can approve this right now: " + s_(dirs.get("why")) + "."}, None, None
    askable = [d for d in dirs["list"] if d["uid"] != s_(g["uid"])]
    if not askable:
        return {"status": 409, "message": "There is no director who can approve this: " +
                                          (dirs.get("why") or "you are the only one") + "."}, None, None
    W.gate(reads)
    plan = SW.Plan(reads, {"uid": g["uid"], "name": g["name"]})
    seats = [{"seat": "director", "to": askable, "state": "waiting", "by": "", "at": "", "note": "", "why": ""}]
    flow = STO._flow_row(plan, {
        "id": SF._new_id("SF", g["key"] + "|" + frm + "|" + to, SF._now_ms(reads)), "kind": "time_off",
        "state": "waiting", "date": frm, "date_to": to, "row_id": "P:" + g["key"], "person": g["name"],
        "person_key": g["key"], "person_uid": g["uid"], "reason": reason, "source": "platform",
        "source_ref": "my-calendar" if via == "my-calendar" else "", "created_by": g["uid"],
        "seats": STO._json(seats)})
    plan.upsert(FLOWS, flow)
    title = "Time off — " + g["name"] + " · " + SF._day_words(frm) + " to " + SF._day_words(to)
    body = ('"' + reason + '" — ' if reason else "") + ASK_BODY
    STO._inbox(plan, [STO._item(reads, flow, "work", "approval", "director", d, title, body) for d in askable])
    return None, plan, flow


def vacation_raise(rx: SR.Raise, f: dict) -> bool:
    """sdVacationRaise_: an informative to each director but the asker, and the event once."""
    reads = rx.reads
    fid = s_(f.get("id"))
    who = s_(f.get("person"))
    when = SDW.day_words(f.get("date")) + " to " + SDW.day_words(f.get("date_to") or f.get("date"))
    items = [SDW.item_(reads, fid, "info", "director", d, "Vacation request — " + who,
                       when + ". Approve or decline in Support Requests or My Work.", "", f.get("date"))
             for d in SDW.directors(reads)["list"] if d["uid"] != s_(f.get("person_uid"))]
    ev = {"id": SR.event_id("vacation", fid), "kind": "vacation", "ref": fid, "route": "", "source": "my-calendar",
          "source_ref": fid, "title": "Vacation request — " + who, "category": "Schedule - Time Off Request",
          "person": who, "person_key": s_(f.get("person_key")), "person_uid": s_(f.get("person_uid")), "house": "",
          "day": s_(f.get("date")), "at": s_(f.get("created_at")),
          "details": {"from": s_(f.get("date")), "to": s_(f.get("date_to"))}}
    return rx.raise_(ev, items)


def vacation_file(sess: L.Session, payload: dict) -> Decision:
    """myCalendarVacationFile: the caller's own time off filed into Scheduling's time-off flow from My Calendar, and
    raised on Support Requests (when that cannot be written, Apps Script's clock raises it on its next pass)."""
    user = sess.user
    if not user or user.get("is_service"):
        return Decision(SDW.closed())
    if SDW.visiting(user):
        return Decision({"status": 403, "message": VISITING})
    uid = SDW.acting_id(user)
    if not uid:
        return Decision(SDW.closed())
    reads = sess.reads
    if not time_off_on(reads):
        return Decision({"status": 200, "data": {"ok": True, "routed": False, "why": "The switch is off."}})
    if not sched_ready(reads):
        return Decision({"status": 200, "data": {"ok": True, "routed": False,
                                                 "why": "Scheduling's houses are not set up yet."}})
    try:
        key = SCH.key_of(reads, user, uid)
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - schedKeyOf_ in a try reads a throw as no key
        key = ""
    if not key:
        return Decision({"status": 403, "message": NO_KEY})
    g = {"uid": uid, "name": SDW.actor_name(user), "key": key}
    p = payload if isinstance(payload, dict) else {}
    refused, plan, flow = time_off_ask(reads, g, {"from": p.get("from"), "to": p.get("to"),
                                                  "reason": p.get("reason")}, VIA)
    if refused is not None:
        # a refusal of the dates themselves rests on no row; every other on the houses it read
        return Decision(refused, fresh=refused["status"] != 400)
    edits = plan.records(SCH.APP_ID)
    rx = SR.Raise(reads)
    try:
        vacation_raise(rx, flow)
        edits += rx.edits
    except hubdb.Unreadable:
        raise
    except Exception as exc:  # noqa: BLE001 - the clock raises it on its next pass
        log.info("myCalendarVacationFile %s: not raised on Support Requests (%s)", flow["id"], str(exc)[:160])
    log.info("myCalendarVacationFile %s: filed from My Calendar", flow["id"])
    answer = {"status": 200, "data": {"ok": True, "routed": True, "flow_id": flow["id"], "said": ASKED}}
    d = W.final(answer, edits, flow["id"])
    d.fresh = SW.verdict_books(reads) + rx.books()
    return d


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"myCalendarVacationFile": vacation_file}
# HUB_POLICY: SupportDesk.gs's roles and typed params
POLICY: dict[str, dict[str, Any]] = {
    "myCalendarVacationFile": {"roles": ("admin", "director", "manager", "staff"),
                               "params": {"from": "string", "to": "string", "reason": "string"}}}
# schedLock_'s own sentence for its own lock
BUSY_OF: dict[str, dict[str, Any]] = {"myCalendarVacationFile": {"status": 409, "message": SCHED_BUSY}}
