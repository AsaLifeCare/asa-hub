"""Support Requests' clock, its write (SupportDesk.gs sdTickRun_ after its reads: the watermark, sdRoute_ and
sdAdpRaise_, supportDeskIncidents_, sdOwedSay_, sdVacationRaise_), after supportDeskClockDue planned it: each switch's
first pass marked, each queue row past its mark routed to its people (items, then the texts, then the event that
remembers both), each fresh incident raised, the texts a request still owes said again or dropped, My Calendar's
vacation requests raised. Every row kept in app.edits as one final write over the Support Requests houses, every text
through Smart Comms under sdTell_'s own key, in the same transaction."""
from __future__ import annotations

import logging
import time
from typing import Any, Callable

import locations as L
import recon as R
import scheduling as SCH
import support_desk as SD
import support_desk_clock as SDK
import support_desk_vacation as SDV
import support_desk_writes as SDW
import support_raise as SR
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

TABS = SDW.TABS
STALE = "What the clock read is out of date or was not read here, so nothing was written. The next pass reads again."
BUSY = "Another write holds the platform's lock — the next pass tries again."
BY = "Support Requests"
# the raising this write does, inside main.py's WRITE_BUDGET_S (sdTickRun_'s deadline)
BUDGET_S = 4.0

s_ = SDW.s_


# ---- sdRaise_ in its two halves (sdRoute_ says its texts between them) -------------------------------------------

def items_add(rx: SR.Raise, ref: str, items: list[dict]) -> int:
    """The items absent so far, appended."""
    known = {s_(it.get("id")) for it in rx.items_of(ref)}
    fresh = []
    for it in items:
        if not it or not it.get("to_uid") or it["id"] in known:
            continue
        known.add(it["id"])
        fresh.append(it)
    if fresh:
        rx._write(TABS["inbox"])
    for it in fresh:
        rec = SDW.item_record(rx.reads, None, it, ref)
        rx.appended[it["id"]] = (it, rec)
        rx.edits.append(rec)
    return len(fresh)


def event_add(rx: SR.Raise, ev: dict) -> bool:
    """The event, when its id is absent."""
    if rx.event(ev["id"]):
        return False
    rx._write(TABS["events"])
    row = rx.event_row(ev)
    sid, tab = SDW.where(rx.reads, TABS["events"])
    rx.edits.append(W.kept_record(sid, tab, "append", "id", row["id"], ev["ref"],
                                  {h: row.get(h, "") for h in SDW.HEADERS["support_events"]}))
    rx.events[row["id"]] = row
    return True


def decision_add(rx: SR.Raise, ref: str, verdict: str, note: str) -> None:
    """sdDecisionRow_ appended, by Support Requests itself."""
    rx._write(TABS["decisions"])
    row = SDW.decision_row(rx.reads, ref=ref, source="queue", verdict=verdict, note=note, by_uid="", by_name=BY,
                           via="auto")
    rx.edits.append(SDW.decision_record(rx.reads, row, ref))


# ---- the people ------------------------------------------------------------------------------------------------------

def payroll_to(reads: L.Reads) -> dict[str, Any]:
    """sdPayrollTo_ (sdPeople_('payroll_to'))."""
    def read() -> dict[str, Any]:
        st = SDW.settings(reads)
        return SDW.resolve_emails(reads, st["values"]["payroll_to"]) if st["readable"] else \
            {"list": [], "missed": [], "why": st["why"]}
    return reads.once("sdk:payroll_to", read)


def uid_by_name(reads: L.Reads, name: Any) -> str:
    """sdUidByName_."""
    return s_((SDW.account_by_name(reads, name) or {}).get("userid"))


# ---- a queue row to its route ----------------------------------------------------------------------------------------

def adp_raise(rx: SR.Raise, q: dict, via: str, j: dict) -> dict[str, Any]:
    """sdAdpRaise_ with the look's judgement: the directors' items, the event, and — an address applied — the
    applied decision and the directors told; an ADP-only request refused on the record."""
    reads, r, ref = rx.reads, q["row"], q["ref"]
    who = SDW.text_(r.get("requestor"), 80) or "an unknown caller"
    day = SDW.day_of_(r.get("date_received"))
    dirs = SDW.directors(reads)["list"]
    state = s_(j.get("state"))
    items: list[dict] = []
    if state == "applied":
        fw = SDW.field_words(j.get("field"))
        items = [SDW.item_(reads, ref, "info", "director", d, "Update information from " + who + " applied automatically",
                           fw[:1].upper() + fw[1:] + " changed on the platform. ADP still needs the change.", "", day)
                 for d in dirs]
    elif state == "ready":
        items = [SDW.item_(reads, ref, "info", "director", d, "Update information from " + who + " is ready to approve",
                           "A new " + ("e-mail" if s_(j.get("field")) == "email" else "phone") +
                           " waits for one-click approval.", "", day) for d in dirs]
    ev = {"id": SR.event_id("adp", ref), "kind": "adp", "ref": ref, "route": "adp_update", "source": via,
          "source_ref": ref, "title": "Update information from " + who, "category": s_(r.get("type_of_request")),
          "person": who, "person_key": SDW.name_key(r.get("requestor")), "person_uid": s_(j.get("uid")), "house": "",
          "day": day, "at": SDW.when_of(r.get("date_received")),
          "details": {"proof": j.get("proof"), "field": j.get("field"), "words": j.get("words"),
                      "value_shape": j.get("value_shape"), "why": j.get("why"), "uid": j.get("uid"),
                      "call_id": j.get("call_id"), "state": "refused" if state == "refused_auto" else state}}
    if not rx.raise_(ev, items):
        return {"raised": False, "already": True}
    if state == "applied":
        decision_add(rx, ref, "applied", SDW.json_text({"field": j.get("field"), "value": j.get("value")}))
        plan = SDW.text_plan(reads, rx.events[ev["id"]])
        told = rx.tell_all(plan["situation"], dirs, plan["vars"], ref, "info") if plan else []
        log.info("support_adp_applied %s %s told %s", ref, s_(j.get("field")), len(told))
    elif state == "refused_auto":
        decision_add(rx, ref, "refused_auto", s_(j.get("why")))
    return {"raised": True, "already": False}


def route_one(rx: SR.Raise, q: dict, route: str, via: str, judge: dict | None) -> dict[str, Any]:
    """sdRoute_: the items, then the texts, then the event that remembers both."""
    reads, r, ref = rx.reads, q["row"], q["ref"]
    if SDK.routed(reads, ref, list(rx.events.values())):
        return {"raised": False, "already": True}
    if route == "adp_update":
        if not isinstance(judge, dict):
            return {"raised": False, "held": True}
        return adp_raise(rx, q, via, judge)
    typ = SDW.type_parts(r.get("type_of_request"))
    who = SDW.text_(r.get("requestor"), 80) or "an unknown caller"
    title = typ["display"] + " from " + who
    body = (SDW.urgency_(r.get("urgency")) or "Low") + " · " + SDW.text_(r.get("description_of_request"), 140)
    people = SDW.directors(reads)["list"] if route == "vehicle" else payroll_to(reads)["list"] \
        if route == "payroll" else SR.leads(reads)["list"]
    seat = "lead" if route == "general" else "payroll" if route == "payroll" else "director"
    day = SDW.day_of_(r.get("date_received"))
    items_add(rx, ref, [SDW.item_(reads, ref, "info", seat, p, title, body, "", day) for p in people])
    told: list[dict] = [{"uid": p.get("uid"), "name": p.get("name"), "inbox_id": SR.item_id(ref, "info", p.get("uid")),
                         "text": None} for p in people]
    if route in ("vehicle", "payroll"):
        told = rx.tell_all(SDW.SR_VEHICLE if route == "vehicle" else SDW.SR_PAYROLL, people, SDW.route_vars(r, ref),
                           ref, "info")
    raised = event_add(rx, {
        "id": SR.event_id("route", ref), "kind": "route", "ref": ref, "route": route, "source": via, "source_ref": ref,
        "title": title, "category": s_(r.get("type_of_request")), "person": who,
        "person_key": SDW.name_key(r.get("requestor")), "person_uid": uid_by_name(reads, r.get("requestor")),
        "house": "", "day": day, "at": SDW.when_of(SDW.received_of(reads, r)),
        "details": {"told": told, "nobody": "" if people else "nobody on the " + route + " list has a live account"}})
    return {"raised": raised, "already": not raised}


# ---- incidents -------------------------------------------------------------------------------------------------------

def incidents_raise(rx: SR.Raise, rows: list[dict], via: str) -> dict[str, Any]:
    """supportDeskIncidents_: a pointer to each incident for the directors and the leads, never the report."""
    reads = rx.reads
    if not SR.auto_on(reads, "incident"):
        return {"off": True}
    out = {"raised": 0, "already": 0, "skipped": 0}
    people, dir_ids = SDK.incident_people(reads)
    for row in rows:
        ts = SDK.instant_text(row.get("timestamp"))
        key = SDK.incident_key(row)
        if not key:
            out["skipped"] += 1
            continue
        # an incident Apps Script raised keeps its own event (its key read the instant to the millisecond)
        had = SDK.incident_event(reads, row, list(rx.events.values()))
        eid = s_(had.get("id")) if had else SR.event_id("incident", key)
        category = SDW.text_(row.get("incident_category"), 80) or "Incident"
        day = SDW.day_of_(row.get("incident_date")) or SDW.day_of_(row.get("timestamp"))
        location = SDW.text_(row.get("incident_location"), 80)
        title = "Incident filed — " + category
        body = " · ".join(x for x in (location, SDW.day_words(day)) if x) + ". Open Incidents for the report."
        items = [SDW.item_(reads, eid, "important", "director" if s_(p.get("uid")) in dir_ids else "lead", p, title,
                           body, location, day, "incident") for p in people]
        got = rx.raise_({"id": eid, "kind": "incident", "ref": eid, "route": "", "source": via, "source_ref": key,
                         "title": title, "category": "Incident · " + category,
                         "person": SDW.text_(row.get("your_name"), 120), "person_key": SDW.name_key(row.get("your_name")),
                         "person_uid": uid_by_name(reads, row.get("your_name")), "house": location, "day": day,
                         "at": ts, "details": {"incident_category": category, "incident_location": location,
                                               "day": day, "via": via}}, items)
        out["raised" if got else "already"] += 1
    return out


# ---- the door ------------------------------------------------------------------------------------------------------

def sweep(sess: L.Session, payload: dict) -> Decision:
    """supportDeskTick_'s write, after supportDeskClockDue: the watermark, the routes, the incidents, the owed texts
    and the vacations, in sdTickRun_'s order and inside its budget."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision(dict(SDK.DENIED))
    p = payload if isinstance(payload, dict) else {}
    if p.get("prepared") is None:
        raise Defer("supportDeskClockSweep is read by supportDeskClockDue first")
    prep = R.unsealed(SDK.DOOR, "service", p.get("prepared"))
    if prep is None:
        return W.refuse(409, STALE)
    out: dict[str, Any] = {"ran": True, "watermark": False, "routed": 0, "incidents": 0, "owed": 0, "vacations": 0,
                           "why": []}
    if not prep.get("due"):
        out["why"] = list(prep.get("why") or [])
        return Decision({"status": 200, "data": out})
    reads = sess.reads
    deadline = time.time() + BUDGET_S
    # an armed book-write funnel stops the whole pass, never one part of it
    W.gate(reads)
    rx = SR.Raise(reads)
    autos = SD.autos_read(reads)
    if autos is None:
        out["why"].append("the switches could not be read — nothing runs")
        return Decision({"status": 200, "data": out})
    st = SDW.settings(reads)
    ready = bool(st["set_up"] and st["readable"])
    if not ready:
        out["why"].append("the settings house cannot hold a watermark — no catch-up runs")
    held = {r["key"]: r for r in SDW.tab_rows(reads, TABS["settings"])} if ready else {}
    wm = SDK.watermark_of((held.get("watermark") or {}).get("value"))
    queue = None
    if any(autos.get(x) for x in SD.ROUTE_ORDER):
        queue = SDW.queue_entries(reads)
        if queue is None:
            out["why"].append("the queue could not be read")
    incidents = None
    if autos.get("incident"):
        try:
            incidents = reads.estate("uiIncidents")
        except Exception:  # noqa: BLE001 - sdTickRun_: said, and the rest of the pass runs
            out["why"].append("the incidents could not be read")
    now_iso = SDW.iso_now(reads)
    if SDK.watermark_next(wm, autos, queue, incidents, now_iso):
        if not ready:
            return Decision({"status": 200, "data": out})
        wm["set_at"] = wm.get("set_at") or now_iso
        rx._write(TABS["settings"])
        sid, tab = SDW.where(reads, TABS["settings"])
        rec = SDW.settings_record(sid, tab, {"key": "watermark", "value": SDW.json_text(wm), "note": SDK.WATERMARK_NOTE,
                                             "updated_at": now_iso, "updated_by": SDK.WATERMARK_BY},
                                  held.get("watermark"), "")
        if rec:
            rx.edits.append(rec)
            out["watermark"] = True
    if queue is not None and ready:
        by_ref = {q["ref"]: q for q in queue}
        for cand in prep.get("routes") or []:
            if time.time() > deadline:
                out["why"].append("out of time — the next pass continues")
                break
            q = by_ref.get(s_((cand or {}).get("ref")))
            if q is None:
                continue
            typ = q["row"].get("type_of_request")
            route = SD.route_of(typ, st["routes"])
            if route != s_(cand.get("route")) or not isinstance(wm["parts"].get(route), dict) or \
                    not autos.get(route) or SDW.is_call_off(typ):
                continue
            try:
                if route_one(rx, q, route, SDK.VIA_TICK, cand.get("judge")).get("raised"):
                    out["routed"] += 1
            except Exception as exc:  # noqa: BLE001 - sdTickRun_ says it and goes on
                out["why"].append(SDW.text_(str(exc) or type(exc).__name__, 240))
    rows = prep.get("incidents") or []
    if rows and incidents is not None and isinstance(wm["parts"].get("incident"), dict) and ready and \
            time.time() < deadline:
        try:
            out["incidents"] = incidents_raise(rx, rows, SDK.VIA_FORM).get("raised", 0)
        except Exception as exc:  # noqa: BLE001 - supportDeskIncidents_ holds and says why
            out["why"].append("incidents: " + SDW.text_(str(exc) or type(exc).__name__, 240))
    if prep.get("owed") and time.time() < deadline:
        try:
            decs = SDW.decisions_by_ref(reads)
            for ref in prep["owed"]:
                if time.time() > deadline:
                    break
                got = SDW.owed_say(reads, s_(ref), bool(SDW.final_of(decs.get(s_(ref)) or [])), "")
                rx.edits += got
                out["owed"] += len(got)
        except Exception as exc:  # noqa: BLE001 - sdTickRun_ says it and goes on
            out["why"].append("owed texts: " + SDW.text_(str(exc) or type(exc).__name__, 240))
    vac_books: tuple[str, ...] = ()
    if prep.get("vacations") and autos.get("time_off") and time.time() < deadline and SDV.sched_ready(reads):
        try:
            flows = {s_(f.get("id")): f for f in SCH.read_tab(reads, "sched_flows")}
            for fid in prep["vacations"]:
                f = flows.get(s_(fid))
                if time.time() > deadline or f is None or f.get("kind") != "time_off" or \
                        s_(f.get("source_ref")) != "my-calendar" or rx.event(SR.event_id("vacation", s_(fid))):
                    continue
                if SDV.vacation_raise(rx, f):
                    out["vacations"] += 1
            vac_books = SCH.books_of(reads, "sched_flows")
        except Exception as exc:  # noqa: BLE001 - sdTickRun_ says it and goes on
            out["why"].append("vacations: " + SDW.text_(str(exc) or type(exc).__name__, 240))
    log.info("supportDeskClockSweep: watermark %s, %s routed, %s incident(s), %s owed, %s vacation(s)%s",
             out["watermark"], out["routed"], out["incidents"], out["owed"], out["vacations"],
             (" — " + "; ".join(out["why"])[:300]) if out["why"] else "")
    fresh = tuple(dict.fromkeys(SDW.books(reads) + rx.books() + vac_books))
    return SDW.kept({"status": 200, "data": out}, rx.edits, SDK.APP_ID, fresh)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"supportDeskClockSweep": sweep}
POLICY: dict[str, dict[str, Any]] = {"supportDeskClockSweep": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"supportDeskClockSweep": {"status": 409, "message": BUSY}}
