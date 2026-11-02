"""Transportation's setup (apps-script/VehicleCalendar.gs) decided off asa-hub-db and kept in app.edits: the master's
seed of the three vehicles and the default settings (vehicleCalendarSeed), and the one-time import of the Van
Calendar's trips (vehicleCalendarImport), never written back. Both are a dry run unless dry_run is false."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable

import client_sources as CS
import gsjs
import locations as L
import smart_comms as SC
import staff_views
import transportation_flows as TF
import transportation_writes as TW
import writes as W
from writes import Decision

TABS = TW.TABS
# VehicleCalendar.gs VC_SETTING_DEFAULTS
SETTING_DEFAULTS = {
    "directors": "ty.bond@asalifecare.com, brittfrench1316@gmail.com",
    "trip_types": '["Doctor appointment","Grocery shopping","Chores / errands","Social / outing","Day program","Work",'
                  '"Other"]',
    "text_to": "{}",
    "import_minutes": "120",
}
# VehicleCalendar.gs VC_SEED_VEHICLES
SEED_VEHICLES = (
    {"name": "Van", "description": "Wheelchair-accessible van", "seats": 6, "wheelchair_accessible": "yes",
     "availability": "available", "aliases": "Van|Wheelchair Van - 1|Wheelchair Van", "tint": "blue", "order": 1},
    {"name": "Mazda", "description": "Mazda CX-5", "seats": 5, "wheelchair_accessible": "no",
     "availability": "available", "aliases": "Mazda|Mazda Van|Mazda CX-5", "tint": "mint", "order": 2},
    {"name": "Ford", "description": "Ford Escape", "seats": 5, "wheelchair_accessible": "no",
     "availability": "available", "aliases": "Ford|Ford Escape", "tint": "peach", "order": 3},
)
_BOOK_STAMP = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})")

s_ = TW.s_


def _dry(p: dict) -> bool:
    return not (isinstance(p, dict) and p.get("dry_run") is False)


def _answer(said: str, report: dict, dry_run: bool) -> dict[str, Any]:
    """vcAnswerAfter_'s data: the sentence, the report and whether nothing was written."""
    return {"status": 200, "data": {"ok": True, "said": said, "report": report, "dry_run": dry_run}}


def _kv(reads: L.Reads) -> dict[str, str]:
    return {r["key"]: r.get("value", "") for r in TW.tab_rows(reads, TABS["settings"])}


def _setting_edits(reads: L.Reads, rows: list[dict[str, str]], subject: str) -> list[dict | None]:
    """vcUpsert_ on the settings house: a key's row changed in place, or appended."""
    held = {r["key"]: r for r in TW.tab_rows(reads, TABS["settings"])}
    sid, tab = TW.where(reads, TABS["settings"])
    return [TW.row_record(sid, tab, TW.HEADERS["vc_settings"], r["key"], subject, held.get(r["key"]), r, "",
                          match="cols:key") for r in rows]


# ---- the seed -------------------------------------------------------------------------------------------------------

def seed_id(name: str) -> str:
    """vcSeedId_."""
    return "VV" + TF.sha10("seed|" + s_(name).lower())


def _by_name(rows: list[dict], name: str, except_id: str) -> dict | None:
    """vcVehicleByName_."""
    want = s_(name).lower()
    return next((r for r in rows if s_(r.get("id")) != except_id and s_(r.get("name")).lower() == want), None)


def seed_plan(vehicle_rows: list[dict], settings_kv: dict[str, Any], now_iso: str, by: str) -> dict[str, Any]:
    """vcSeedPlan_: what the seed would add, given the vehicles and settings already there; nothing present is
    rewritten."""
    report: dict[str, Any] = {"vehicles": {"add": [], "kept": []}, "settings": {"add": [], "kept": []}}
    vehicles: list[dict[str, str]] = []
    settings: list[dict[str, str]] = []
    ids = TW.index(vehicle_rows)
    for s in SEED_VEHICLES:
        vid = seed_id(s["name"])
        if vid in ids or _by_name(vehicle_rows, s["name"], ""):
            report["vehicles"]["kept"].append(s["name"])
            continue
        report["vehicles"]["add"].append(s["name"])
        vehicles.append({"id": vid, "name": s["name"], "description": s["description"], "seats": str(s["seats"]),
                         "wheelchair_accessible": s["wheelchair_accessible"], "availability": s["availability"],
                         "aliases": s["aliases"], "tint": s["tint"], "order": str(s["order"]), "note": "",
                         "created_at": now_iso, "updated_at": now_iso, "updated_by": by})
    for k, v in SETTING_DEFAULTS.items():
        if s_(settings_kv.get(k)):
            report["settings"]["kept"].append(k)
            continue
        report["settings"]["add"].append(k)
        settings.append({"key": k, "value": v, "note": "seed", "updated_at": now_iso, "updated_by": by})
    if s_(settings_kv.get("seeded_at")):
        report["settings"]["kept"].append("seeded_at")
    else:
        report["settings"]["add"].append("seeded_at")
    return {"report": report, "vehicles": vehicles, "settings": settings}


def seed(sess: L.Session, payload: dict) -> Decision:
    """vehicleCalendarSeed: the master's seed — the Van, the Mazda and the Ford and the default settings."""
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    g = TW.gate(sess)
    if not g.get("open"):
        return Decision(TW.closed())
    if not g.get("is_master") or g.get("visiting"):
        return W.refuse(403, "Only the master seeds the vehicles.")
    fresh = TW.books(reads, TABS["vehicles"], TABS["settings"])
    stamp = W.now_iso(reads)
    by = s_(g.get("uid"))
    plan = seed_plan(TW.tab_rows(reads, TABS["vehicles"]), _kv(reads), stamp, by)
    report = plan["report"]
    if _dry(p):
        said = (f"Dry run: nothing was written. {len(report['vehicles']['add'])} vehicle(s) and "
                f"{len(report['settings']['add'])} setting(s) to add.")
        return Decision(_answer(said, report, True), fresh=fresh)
    W.gate(reads)
    edits: list[dict | None] = []
    if plan["vehicles"]:
        held = TW.index(TW.tab_rows(reads, TABS["vehicles"]))
        sid, tab = TW.where(reads, TABS["vehicles"])
        edits += [TW.row_record(sid, tab, TW.HEADERS["vc_vehicles"], v["id"], "seed", held.get(v["id"]), v, "")
                  for v in plan["vehicles"]]
    srows = list(plan["settings"])
    if "seeded_at" in report["settings"]["add"]:
        srows.append({"key": "seeded_at", "value": stamp, "note": "seed", "updated_at": stamp, "updated_by": by})
    if srows:
        edits += _setting_edits(reads, srows, "seed")
    edits.append(TW.log_record(reads, TW.log_row(g, "", "", "seed", "", report, "", stamp), "seed", ""))
    said = (f"Seeded: {len(report['vehicles']['add'])} vehicle(s) and {len(report['settings']['add'])} setting(s) "
            "added; nothing already there was rewritten.")
    return TW.kept(_answer(said, report, False), edits, "seed", fresh)


# ---- the Van Calendar, imported once and never written back ---------------------------------------------------------

def book_stamp_iso(raw: Any) -> str:
    """vcBookStampIso_: the Van Calendar's timestamp (M/D/YYYY H:mm:ss on the Eastern clock) as an instant, or ''."""
    m = _BOOK_STAMP.match(s_(raw))
    if not m:
        return ""
    got = TW.wall_ms(f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}T{int(m.group(4)):02d}:{m.group(5)}")
    ms = got.get("ms")
    return gsjs.iso(datetime.fromtimestamp(ms / 1000.0, timezone.utc)) if ms else ""


def _clock_wall(day: str, mins: int) -> str:
    return f"{day}T{mins // 60:02d}:{mins % 60:02d}"


def import_plan(book: dict, vehicle_rows: list[dict], trip_rows: list[dict], roster: dict, staff: dict,
                minutes: int, now_ms: float) -> dict[str, Any]:
    """vcImportPlan_: pure over what it is handed — the Van Calendar book, the vehicles, the trips already there, the
    clients, the staff and the assumed length of a trip with no end."""
    report: dict[str, Any] = {"read": book.get("total") or 0, "realigned": book.get("realigned") or 0,
                              "unread": book.get("unread") or 0, "add": 0, "already": 0, "skipped": [],
                              "conflicts": [], "end_assumed": 0, "vehicles_unmatched": [], "clients_unmatched": [],
                              "first_day": "", "last_day": "", "from_today": 0}
    alias: dict[str, dict] = {}
    for v in vehicle_rows:
        for a in TW.aliases_of(v):
            k = CS._base_key(a)
            if k and k not in alias:
                alias[k] = v
    have: dict[str, bool] = {}
    busy: dict[str, list[tuple]] = {}
    for t in trip_rows:
        if t.get("source_ref"):
            have[t["source_ref"]] = True
        if t.get("state") == "scheduled" and t.get("vehicle_id"):
            busy.setdefault(t["vehicle_id"], []).append(TW.span_of(t))
    known = {c["key"]: c for c in (roster or {}).get("rows") or []}
    by_key = (staff or {}).get("by_key") or {}
    cand: list[dict[str, Any]] = []
    for r in book.get("requests") or []:
        ref = "van_calendar:r" + str(r["row"])
        if have.get(ref):
            report["already"] += 1
            continue
        v = alias.get(CS._base_key(r.get("vehicle")))
        if not v:
            nm = s_(r.get("vehicle")) or "(blank)"
            if nm not in report["vehicles_unmatched"]:
                report["vehicles_unmatched"].append(nm)
            report["skipped"].append({"row": r["row"], "why": "no vehicle on the list is called " + nm})
            continue
        s_min = CS.transport_clock(r.get("start"))
        if s_min is None:
            report["skipped"].append({"row": r["row"], "why": "no start time"})
            continue
        s = TW.wall_ms(_clock_wall(r["date"], s_min))
        if not s.get("ms"):
            report["skipped"].append({"row": r["row"], "why": s.get("message")})
            continue
        e_min = CS.transport_clock(r.get("end"))
        e = TW.wall_ms(_clock_wall(r["date"], e_min)) if e_min is not None and e_min > s_min else None
        assumed = not (e and e.get("ms"))
        cand.append({"r": r, "ref": ref, "v": v, "s": s["ms"], "e": s["ms"] + minutes * 60000 if assumed else e["ms"],
                     "assumed": assumed})
    cand.sort(key=lambda c: (c["s"], c["r"]["row"]))
    today = TW.day_of(now_ms)
    now_iso = gsjs.iso(datetime.fromtimestamp(now_ms / 1000.0, timezone.utc))
    trips: list[dict[str, str]] = []
    for c in cand:
        r, v = c["r"], c["v"]
        busy_v = busy.setdefault(v["id"], [])
        span = (c["s"], c["e"])
        clash = any(TW.overlap(span, b) for b in busy_v)
        if not clash:
            busy_v.append(span)
        client = known.get(gsjs.name_key(r.get("client")))
        if not client and s_(r.get("client")) and s_(r.get("client")) not in report["clients_unmatched"]:
            report["clients_unmatched"].append(s_(r.get("client")))
        sk = gsjs.name_key(r.get("staff"))
        person = by_key.get(sk) if sk else None
        day = TW.day_of(c["s"])
        staff_name = TF.vtext(r.get("staff"), 120)
        trips.append({
            "id": "VT" + TF.sha10(c["ref"]), "state": "needs_assignment" if clash else "scheduled",
            "vehicle_id": "" if clash else v["id"], "requested_vehicle_id": v["id"], "start_at": TW.iso_of(c["s"]),
            "end_at": TW.iso_of(c["e"]), "day": day, "end_known": "no" if c["assumed"] else "yes",
            "wheelchair_required": "yes" if TW.yes(v.get("wheelchair_accessible")) else "no", "trip_type": "",
            "purpose": TF.vtext(r.get("reason"), 200), "destination": TF.vtext(r.get("destination"), 300),
            "details": "", "client_key": client["key"] if client else "", "client_name": TF.vtext(r.get("client"), 120),
            "staff_key": person["key"] if person else "", "staff_uid": person["uid"] if person else "",
            "staff_name": staff_name, "driver_key": person["key"] if person else "",
            "driver_uid": person["uid"] if person else "", "driver_name": staff_name, "requested_by_uid": "",
            "requested_by_name": "Van Calendar", "decided_by_uid": "", "decided_by_name": "", "decided_at": "",
            "decision_note": "", "assign_note": "Overlapped another Van Calendar booking" if clash else "",
            "appointment_ref": "", "source": "import:van_calendar", "source_ref": c["ref"], "told": "{}",
            "test_mode": "no", "created_at": book_stamp_iso(r.get("requested_at")) or now_iso, "created_by": "import",
            "updated_at": now_iso, "updated_by": "import"})
        report["add"] += 1
        if c["assumed"]:
            report["end_assumed"] += 1
        if day >= today:
            report["from_today"] += 1
        if not report["first_day"] or day < report["first_day"]:
            report["first_day"] = day
        if not report["last_day"] or day > report["last_day"]:
            report["last_day"] = day
    for cf in book.get("conflicts") or []:
        for t in trips:
            if t["day"] != cf.get("date"):
                continue
            names = {k: True for k in CS.name_keys(t["client_name"])}
            if not CS._list_names(names, cf.get("clients")):
                continue
            note = (f"Van Calendar conflict ({s_(cf.get('status')) or 'Listed'}"
                    f"{', ' + s_(cf.get('time')) if cf.get('time') else ''})"
                    f"{': ' + TF.vtext(cf.get('notes'), 200) if cf.get('notes') else ''}")
            t["assign_note"] = t["assign_note"] + " · " + note if t["assign_note"] else note
            report["conflicts"].append({"row": cf.get("row"), "with": t["source_ref"], "note": note})
    return {"trips": trips, "report": report}


def import_van_calendar(sess: L.Session, payload: dict) -> Decision:
    """vehicleCalendarImport: the master's one-time import of the Van Calendar's trips; never written back."""
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    g = TW.gate(sess)
    if not g.get("open"):
        return Decision(TW.closed())
    if not g.get("is_master") or g.get("visiting"):
        return W.refuse(403, "Only the master imports the Van Calendar.")
    book = CS._van_book(reads)
    if not book or book.get("requests") is None:
        return W.refuse(503, f"The Van Calendar could not be read: {s_((book or {}).get('requests_why'))}.")
    staff, roster, st = TW.people(reads), TW.clients(reads), TW.settings(reads)
    fresh = TW.books(reads, TABS["vehicles"], TABS["trips"], TABS["settings"])
    trip_rows = TW.tab_rows(reads, TABS["trips"])
    plan = import_plan(book, TW.tab_rows(reads, TABS["vehicles"]), trip_rows, roster, staff, st["import_minutes"],
                       TW.now_ms(reads))
    report = plan["report"]
    if not roster.get("readable"):
        report["clients_why"] = roster.get("why")
    if _dry(p):
        said = (f"Dry run: nothing was written. {report['read']} rows read, {report['add']} trips to add, "
                f"{report['already']} already in.")
        return Decision(_answer(said, report, True), fresh=fresh)
    W.gate(reads)
    stamp = W.now_iso(reads)
    edits: list[dict | None] = []
    if plan["trips"]:
        held = TW.index(trip_rows)
        sid, tab = TW.where(reads, TABS["trips"])
        edits += [TW.row_record(sid, tab, TW.HEADERS["vc_trips"], t["id"], "import", held.get(t["id"]), t, "")
                  for t in plan["trips"]]
    text = SC._cut16(TW.json_text(report), 45000)
    edits += _setting_edits(reads, [
        {"key": "imported_at", "value": stamp, "note": "import", "updated_at": stamp, "updated_by": s_(g.get("uid"))},
        {"key": "import_report", "value": text, "note": "import", "updated_at": stamp, "updated_by": s_(g.get("uid"))}],
        "import")
    edits.append(TW.log_record(reads, TW.log_row(g, "", "", "import", "", {
        "add": report["add"], "already": report["already"], "skipped": len(report["skipped"]),
        "first_day": report["first_day"], "last_day": report["last_day"]}, "", stamp), "import", ""))
    n = report["add"]
    said = (f"Imported {n} trip{'' if n == 1 else 's'} from the Van Calendar; {report['already']} were already in. "
            "Nothing was written back to the Van Calendar.")
    staff_views.record(sess.user, "vehicleCalendarImport", str(n))
    return TW.kept(_answer(said, report, False), edits, "import", fresh)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "vehicleCalendarSeed": seed, "vehicleCalendarImport": import_van_calendar}
_ROLES = ("admin", "director", "manager", "staff")
# HUB_POLICY: the roles each door is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {a: {"roles": _ROLES, "params": {"dry_run": "boolean"}} for a in ACTIONS}
# vcLock_'s own sentence for its own lock
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": TW.BUSY} for a in ACTIONS}
