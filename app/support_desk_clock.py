"""Support Requests' clock on Python (SupportDesk.gs supportDeskTick_ → sdTickRun_), rung by the relay instead of Apps
Script's hiring sweep: the rows anybody files — the hotline's requests and incidents, the platform's form, the
estate's Google Form — raised on Support Requests and in My Work once each switch is on (the watermark keeps the first
pass from raising anything older), the texts a request still owes, and My Calendar's vacation requests. The look
(supportDeskClockDue) reads it all off asa-hub-db and judges each ADP · Update Information call; its write
(support_desk_clock_writes) raises what is still unraised and says the texts through Smart Comms."""
from __future__ import annotations

import copy
import re
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import locations as L
import recon as R
import scheduling as SCH
import smart_comms as SC
import support_desk as SD
import support_desk_vacation as SDV
import support_desk_writes as SDW
import support_raise as SR

APP_ID = SD.APP_ID
DOOR = "supportDeskClockDue"
DENIED = {"status": 403, "message": "This is the relay's own door."}
TABS = SDW.TABS
WATERMARK_NOTE = "the first pass of each switch: nothing older is raised"
WATERMARK_BY = "support-desk clock"
VIA_TICK = "tick"
VIA_FORM = "form"
OWED_HOURS = SDW.OWED_HOURS

s_ = SDW.s_


def iso_ms(ms: float) -> str:
    """sdIso_."""
    return gsjs.iso(datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc))


def whole(v: float) -> int | float:
    return int(v) if v == int(v) else v


def num(v: Any) -> float:
    """Number(v || 0)."""
    if isinstance(v, (int, float)):
        return float(v)
    t = s_(v)
    if not t:
        return 0.0
    try:
        return float(t)
    except ValueError:
        return float("nan")


# ---- an incident's key (the one server/my_work.py gives it) --------------------------------------------------------

def instant_text(v: Any) -> str:
    """sdInstantText_ for a cell's text: an instant with its zone as toISOString, anything else as written."""
    ms = SDW.instant_ms(v)
    t = s_(v)
    if ms is not None and re.search(r"(Z|[+-]\d{2}:?\d{2})$", t, re.I):
        return iso_ms(ms)
    return t


def incident_key(row: dict) -> str:
    """sdIncidentKey_: '' when the row has no timestamp (never raised)."""
    ts = instant_text(row.get("timestamp"))
    if not ts or (SDW.instant_ms(ts) is None and not SDW.day_of_(ts)):
        return ""
    return "IN" + SDW.sha10(ts + "|" + s_(row.get("your_name")) + "|" + s_(row.get("client_name")) + "|" +
                            s_(row.get("incident_category")))


INCIDENT_FIELDS = ("timestamp", "your_name", "client_name", "incident_category", "incident_date", "incident_location")
# the copy keeps a sheet's date to the second (rounded), where Apps Script read it to the millisecond
SECOND_MS = 1000.0


def incident_event(reads: L.Reads, row: dict, mine: list[dict] | None = None) -> dict | None:
    """The incident event already raised for this row: its own key, or — the copy having rounded the timestamp Apps
    Script keyed it by — the same reporter and category within the second of the same instant."""
    key = incident_key(row)
    if not key:
        return None
    events = [e for e in SDW.events_list(reads) + (mine or []) if s_(e.get("kind")) == "incident"]
    for e in events:
        if s_(e.get("source_ref")) == key:
            return e
    ms = SDW.instant_ms(row.get("timestamp"))
    if ms is None:
        return None
    who = SDW.text_(row.get("your_name"), 120)
    category = SDW.text_(row.get("incident_category"), 80) or "Incident"
    for e in events:
        at = SDW.instant_ms(e.get("at"))
        if at is not None and abs(at - ms) < SECOND_MS and s_(e.get("person")) == who and \
                s_(SDW.obj_(e.get("details")).get("incident_category")) == category:
            return e
    return None


# ---- the houses as the tick reads them -----------------------------------------------------------------------------

def settings_kv(reads: L.Reads) -> dict[str, str]:
    return {r["key"]: r.get("value", "") for r in SDW.tab_rows(reads, TABS["settings"])}


def watermark_of(raw: Any) -> dict[str, Any]:
    """sdSettings_'s watermark: the stored JSON, its parts always an object."""
    wm = copy.deepcopy(SDW.obj_(raw))
    if not isinstance(wm.get("parts"), dict):
        wm["parts"] = {}
    return wm


def watermark_next(wm: dict, autos: dict, queue: list | None, incidents: list | None, now_iso: str) -> bool:
    """sdTickRun_'s first pass of each switch: the queue's length and newest day, the incidents' newest instant —
    marked once per part. Whether the mark changed."""
    changed = False
    parts = wm["parts"]
    if queue is not None:
        newest = ""
        for q in queue:
            d = SDW.day_of_(q["row"].get("date_received"))
            if d > newest:
                newest = d
        for p in SD.ROUTE_ORDER:
            if not autos.get(p) or parts.get(p):
                continue
            parts[p] = {"rows": len(queue), "day": newest, "at": now_iso}
            if not wm.get("queue"):
                wm["queue"] = newest
            changed = True
    if incidents is not None and not parts.get("incident"):
        newest_ms = 0.0
        for r in incidents:
            ms = SDW.instant_ms(r.get("timestamp"))
            if ms is not None and ms > newest_ms:
                newest_ms = ms
        parts["incident"] = {"ms": whole(newest_ms), "at": now_iso}
        if not wm.get("incidents"):
            wm["incidents"] = iso_ms(newest_ms) if newest_ms else ""
        changed = True
    return changed


def routed(reads: L.Reads, ref: str, mine: list[dict] | None = None) -> bool:
    """sdRouted_: a route or ADP event already names this queue row."""
    return any(s_(e.get("ref")) == ref and s_(e.get("kind")) in ("route", "adp")
               for e in SDW.events_list(reads) + (mine or []))


def route_candidates(reads: L.Reads, queue: list[dict], wm: dict, autos: dict, routes: dict) -> list[dict]:
    """sdTickRun_'s catch-up: each queue row past its switch's mark, routed nowhere yet."""
    out = []
    for q in queue:
        r = q["row"]
        route = SD.route_of(r.get("type_of_request"), routes)
        mark = wm["parts"].get(route) if route else None
        if not isinstance(mark, dict) or not autos.get(route) or SDW.is_call_off(r.get("type_of_request")):
            continue
        day = SDW.day_of_(r.get("date_received"))
        if q["index"] < num(mark.get("rows")) or not day or day < s_(mark.get("day")):
            continue
        if routed(reads, q["ref"]):
            continue
        out.append(q)
    return out


def fresh_incidents(incidents: list[dict], wm: dict) -> list[dict]:
    """The incidents newer than the incident switch's mark."""
    mark = wm["parts"].get("incident")
    if not isinstance(mark, dict):
        return []
    floor = num(mark.get("ms"))
    out = []
    for r in incidents:
        ms = SDW.instant_ms(r.get("timestamp"))
        # the mark's own row, its instant rounded by the copy, is never newer than the mark
        if ms is not None and ms > floor and not ms - floor < SECOND_MS:
            out.append(r)
    return out


def incident_people(reads: L.Reads) -> tuple[list[dict], set[str]]:
    """supportDeskIncidents_'s recipients: the directors and the leads, less whoever turned the alert off."""
    dirs = SDW.directors(reads)["list"]
    people = SR.receivers(reads, SR.union(dirs, SR.leads(reads)["list"]), "incident")
    return people, {s_(d.get("uid")) for d in dirs}


def incident_owed(reads: L.Reads, rows: list[dict]) -> list[dict]:
    """The fresh incidents with something still to raise: their event, or an item a recipient lacks."""
    people, _dirs = incident_people(reads)
    by_ref = SDW.items_by_ref(reads)
    out = []
    for r in rows:
        if not incident_key(r):
            continue
        ev = incident_event(reads, r)
        if ev is None:
            out.append({f: s_(r.get(f)) for f in INCIDENT_FIELDS})
            continue
        eid = s_(ev.get("id"))
        have = {s_(it.get("id")) for it in by_ref.get(eid) or []}
        if any(SR.item_id(eid, "important", p.get("uid")) not in have for p in people if s_(p.get("uid"))):
            out.append({f: s_(r.get(f)) for f in INCIDENT_FIELDS})
    return out


def owed_refs(reads: L.Reads, now: float, quiet: bool) -> list[str]:
    """sdOwedSay_'s items: a text the quiet window held, still within its hours — inside the window only those whose
    request was decided (the drop withdraws what Smart Comms still owes); outside it every one, said again."""
    items = SDW.tab_rows(reads, TABS["inbox"])
    decs = SDW.decisions_by_ref(reads)
    out: list[str] = []
    for it in items:
        if not re.match(r"^text: held:quiet", s_(it.get("note"))):
            continue
        born = gsjs.date_parse(s_(it.get("created_at")))
        if born is None or not now - born < OWED_HOURS * 3600000:
            continue
        ref = s_(it.get("ref"))
        if ref in out:
            continue
        if quiet and not SDW.final_of(decs.get(ref) or []):
            continue
        out.append(ref)
    return out


def vacation_flows(reads: L.Reads) -> list[dict]:
    """My Calendar's time off flows not yet raised on Support Requests."""
    return [f for f in SCH.read_tab(reads, "sched_flows")
            if f.get("kind") == "time_off" and s_(f.get("source_ref")) == "my-calendar"
            and SDW.event_by_id(reads, SR.event_id("vacation", s_(f.get("id")))) is None]


# ---- the look ------------------------------------------------------------------------------------------------------

def look(reads: L.Reads) -> dict[str, Any]:
    """sdTickRun_ up to the raising: what the pass owes, each ADP call judged."""
    now = SDW.now_ms(reads)
    out: dict[str, Any] = {"due": False, "why": [], "watermark": False, "routes": [], "incidents": [], "owed": [],
                           "vacations": [], "quiet": SC.quiet_at(now / 1000.0)}
    autos = SD.autos_read(reads)
    if autos is None:
        out["why"].append("the switches could not be read — nothing runs")
        return out
    st = SDW.settings(reads)
    ready = bool(st["set_up"] and st["readable"])
    if not ready:
        out["why"].append("the settings house cannot hold a watermark — no catch-up runs")
    wm = watermark_of(settings_kv(reads).get("watermark") if ready else "")
    queue = incidents = None
    if any(autos.get(p) for p in SD.ROUTE_ORDER):
        queue = SDW.queue_entries(reads)
        if queue is None:
            out["why"].append("the queue could not be read")
    if autos.get("incident"):
        try:
            incidents = reads.estate("uiIncidents")
        except Exception:  # noqa: BLE001 - sdTickRun_: said, and the rest of the pass runs
            out["why"].append("the incidents could not be read")
    if watermark_next(wm, autos, queue, incidents, SDW.iso_now(reads)):
        if not ready:
            return out
        out["watermark"] = True
    if queue is not None and ready:
        for q in route_candidates(reads, queue, wm, autos, st["routes"]):
            route = SD.route_of(q["row"].get("type_of_request"), st["routes"])
            cand: dict[str, Any] = {"ref": q["ref"], "route": route}
            if route == "adp_update":
                try:
                    cand["judge"] = SDW.adp_judge(reads, q)
                except Exception as exc:  # noqa: BLE001 - sdAdpRaise_: held, judged again on the next pass
                    out["why"].append(q["ref"] + ": " + SDW.text_(str(exc) or type(exc).__name__, 240))
                    continue
            out["routes"].append(cand)
    if incidents is not None and ready:
        out["incidents"] = incident_owed(reads, fresh_incidents(incidents, wm))
    try:
        out["owed"] = owed_refs(reads, now, out["quiet"])
    except Exception as exc:  # noqa: BLE001 - sdOwedSay_ reads nothing it cannot read, and says so
        out["why"].append("owed texts: " + SDW.text_(str(exc) or type(exc).__name__, 240))
    if autos.get("time_off") and SDV.sched_ready(reads):
        try:
            out["vacations"] = [s_(f.get("id")) for f in vacation_flows(reads)]
        except Exception as exc:  # noqa: BLE001 - sdTickRun_ says it and goes on
            out["why"].append("vacations: " + SDW.text_(str(exc) or type(exc).__name__, 240))
    out["due"] = bool(out["watermark"] or out["routes"] or out["incidents"] or out["owed"] or out["vacations"])
    return out


def due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """supportDeskTick_'s look, for the relay's clock: what the pass owes, sealed for supportDeskClockSweep."""
    if (sess.user or {}).get("is_service") is not True:
        return dict(DENIED)
    return {"status": 200, "data": R.seal(DOOR, "service", look(sess.reads))}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"supportDeskClockDue": due}
POLICY: dict[str, dict[str, Any]] = {"supportDeskClockDue": {}}
