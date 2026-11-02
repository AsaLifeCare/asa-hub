"""My Calendar's own doors beside the lane's two reads (app/my_calendar.py): the vacation route
(apps-script/SupportDesk.gs myCalendarVacationRoute), read off asa-hub-db. Every write the page sends stays where it
is: Time Off's request and withdrawal publish their notices on the relay, and a vacation filed into Scheduling raises
the directors' items on Apps Script, so nothing here is kept in app.edits and no write store is opened."""
from __future__ import annotations

import json
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import my_calendar as MC
import my_work as mw
import scheduling as SCH
from scope import Defer

APP_ID = MC.APP_ID
APP_NAME = "My Calendar"
# Settings › Editions: another person's calendar opened here, its time off filed as Time Off lets the holder
EDITIONS = (MC.EDITION,)
_ROLES = ("admin", "director", "manager", "staff")


# ---- the vacation route (SupportDesk.gs) ---------------------------------------------------------------------------

# SupportDeskSwitches.gs MYWORK_AUTO_KEYS.time_off: Settings › My Work's switch that files own time off into Scheduling
AUTO_TIME_OFF_KEY = "mywork_auto_sr_time_off"
# AlertsCatalog.gs HIRING_ALERTS_CATALOG_SHIPPED: its default when the catalogue sheet leaves it blank or out
AUTO_SHIPPED = "no"
AUTO_ON = ("yes", "on", "true", "1")
SOURCE_REF = "my-calendar"
VACATION_WORDS = {"waiting": "Waiting on the directors", "approved": "Approved", "approved_future": "Approved",
                  "declined": "Declined", "expired": "Expired", "withdrawn": "Withdrawn"}
ROUTE_OFF = "Vacation requests go to the Time Off app."
ROUTE_NO_SCHED = "Scheduling's houses are not set up yet — vacation requests go to the Time Off app."
ROUTE_NO_KEY = "Your account is not matched to one person on the calendar — vacation requests go to the Time Off app."
VISITING = "Ask from your own account — not while visiting someone else."
UNKNOWN = "Unknown action."


def _s(v: Any) -> str:
    """sdStr_."""
    return gsjs.trim(gsjs.or_blank(v))


def _json(raw: Any, fallback: Any) -> Any:
    """sdJson_: an object or an array parsed from the cell, else the fallback."""
    if isinstance(raw, (dict, list)):
        return raw
    try:
        v = json.loads(gsjs.or_text(raw))
    except (ValueError, RecursionError):
        return fallback
    return v if isinstance(v, (dict, list)) else fallback


def _catalogue_default(reads: L.Reads) -> str:
    """The switch's default as hubMyWorkHideDefaults_ gives it: the catalogue sheet's, a blank or no row the shipped."""
    db = reads.db
    if HT.tabled(mw.HIDE_CATALOG_TAB):
        headers, rows = HT.raw(reads, mw.HIDE_CATALOG_TAB)
    else:
        if not db.house_moved(mw.HIDE_CATALOG_TAB):
            return AUTO_SHIPPED
        res = db.resolve(mw.HIDE_CATALOG_TAB)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable("asa-hub-db holds no copy of the configuration catalogue's book")
            return AUTO_SHIPPED
        headers, rows = list(res.ref.headers), db.rows(res.ref)
    head = [gsjs.trim(gsjs.or_blank(h)).lower() for h in headers]
    if "key" not in head or "default_value" not in head:
        return AUTO_SHIPPED
    at_key = headers[head.index("key")]
    at_value = headers[head.index("default_value")]
    out = AUTO_SHIPPED
    for _rn, raw in rows:
        if gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(at_key), "hub"))) != AUTO_TIME_OFF_KEY:
            continue
        v = gsjs.or_blank(hubdb.typed(raw.get(at_value), "hub"))
        out = v if gsjs.trim(v) else AUTO_SHIPPED
    return out


def auto_time_off(reads: L.Reads) -> bool:
    """hubMyWorkAutoOn_('time_off'): only a plain yes is on; a config this service cannot read defers."""
    cfg = reads.config()
    raw = cfg[AUTO_TIME_OFF_KEY] if AUTO_TIME_OFF_KEY in cfg else _catalogue_default(reads)
    return gsjs.trim(gsjs.or_blank(raw)).lower() in AUTO_ON


def vacation_route(sess: L.Session, payload: dict) -> dict[str, Any]:
    """myCalendarVacationRoute: whether the caller's own time off files into Scheduling, and what they filed there."""
    user = sess.user or {}
    if not user or user.get("is_service"):
        raise Defer("the vacation route is a person's own, never the service's")
    if user.get("visiting_member"):
        return {"status": 403, "message": VISITING}
    uid = gsjs.trim(gsjs.or_text(user.get("id")))
    if not uid:
        return {"status": 404, "message": UNKNOWN}
    reads = sess.reads
    out: dict[str, Any] = {"on": False, "readable": True, "why": "", "mine": []}
    if not auto_time_off(reads):
        out["why"] = ROUTE_OFF
        return {"status": 200, "data": out}
    if not (reads.db.house_moved(SCH.TABS["flows"]) and reads.db.house_moved(SCH.TABS["inbox"])):
        out.update(readable=False, why=ROUTE_NO_SCHED)
        return {"status": 200, "data": out}
    key = SCH.key_of(reads, user, uid)
    if not key:
        out["why"] = ROUTE_NO_KEY
        return {"status": 200, "data": out}
    for f in SCH.read_tab(reads, SCH.TABS["flows"]):
        if f.get("kind") != "time_off" or _s(f.get("source_ref")) != SOURCE_REF or _s(f.get("person_key")) != key:
            continue
        seats = _json(f.get("seats"), [])
        seat = next((s for s in (seats if isinstance(seats, list) else [])
                     if isinstance(s, dict) and s.get("seat") == "director"), {})
        state = f.get("state")
        out["mine"].append({"flow_id": f.get("id"), "from": _s(f.get("date")),
                            "to": _s(f.get("date_to")) or _s(f.get("date")), "state": _s(state),
                            "word": VACATION_WORDS.get(state) or _s(state), "decided_by": _s(seat.get("by")),
                            "decided_at": _s(seat.get("at")), "note": _s(seat.get("note"))})
    out["on"] = True
    return {"status": 200, "data": out}


# a /gas read routed under My Calendar's switch, answered by the read module's door (main.APPS)
READS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"myCalendarVacationRoute": vacation_route}
# HUB_POLICY: SupportDesk.gs's roles; it takes no params
READ_POLICY: dict[str, dict[str, Any]] = {"myCalendarVacationRoute": {"roles": _ROLES}}

# what each door the page sends is, read to its leaf (tools/test-my-calendar-python.py pins it)
DOORS: dict[str, dict[str, str]] = {
    "myCalendarView": {"where": "python", "why": "the lane's read, for the scope the relay decided"},
    "myCalendarCheck": {"where": "python", "why": "the pencil's dry run, nothing written"},
    "myCalendarVacationRoute": {"where": "python", "why": "a read of Settings › My Work and Scheduling's flows"},
    "/hub-lanes/time-off/request": {"where": "relay", "why": "Time Off's door: files the row and publishes the "
                                                             "time_off_asked notice to the house manager and directors"},
    "/hub-lanes/time-off/withdraw": {"where": "relay", "why": "Time Off's door: closes the row and publishes the "
                                                              "time_off_ended notice"},
    "myCalendarVacationFile": {"where": "python", "why": "Support Desk's (app/support_desk_vacation.py): files a "
                                                         "Scheduling time-off flow with the directors' approval items "
                                                         "and raises a Support Requests event"},
}
