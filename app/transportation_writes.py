"""Transportation's writes (apps-script/VehicleCalendar*.gs) decided off asa-hub-db and kept in app.edits."""
from __future__ import annotations

import json
import logging
import re
import secrets
from datetime import datetime, timezone
from typing import Any, Callable

import client_writes as CW
import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc
import writes as W
from gsjs import NY
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

APP_ID = "vehicle-calendar"
CP_APP_ID = "client-profiles"
TABS = {"vehicles": "vc_vehicles", "trips": "vc_trips", "inbox": "vc_inbox", "log": "vc_log", "settings": "vc_settings"}
# VehicleCalendar.gs VC_HEADERS
HEADERS = {
    "vc_vehicles": ("id", "name", "description", "seats", "wheelchair_accessible", "availability", "aliases", "tint",
                    "order", "note", "created_at", "updated_at", "updated_by"),
    "vc_trips": ("id", "state", "vehicle_id", "requested_vehicle_id", "start_at", "end_at", "day", "end_known",
                 "wheelchair_required", "trip_type", "purpose", "destination", "details", "client_key", "client_name",
                 "staff_key", "staff_uid", "staff_name", "driver_key", "driver_uid", "driver_name", "requested_by_uid",
                 "requested_by_name", "decided_by_uid", "decided_by_name", "decided_at", "decision_note", "assign_note",
                 "appointment_ref", "source", "source_ref", "told", "test_mode", "created_at", "created_by",
                 "updated_at", "updated_by"),
    "vc_log": ("id", "at", "by_uid", "by_name", "trip_id", "vehicle_id", "via", "was", "now", "note"),
    "vc_settings": ("key", "value", "note", "updated_at", "updated_by"),
}
# Settings › Editions (Editions.gs): who else may make each change, beside the directors and the master
EDITION = {"trips": "transportation.trips", "vehicles": "transportation.vehicles",
           "settings": "transportation.settings"}
CLIENT_EDITION = "clients.transportation"

AVAILABILITY = ("available", "maintenance", "out_of_service")
TINTS = ("blue", "mint", "peach", "lilac", "amber", "rose")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
WEEKDAYS = ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
TRIP_ID = re.compile(r"^VT[0-9A-F]{10}$")
VEHICLE_ID = re.compile(r"^VV[0-9A-F]{10}$")
_WALL = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$")
_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
MAX_SPAN_MS = 14 * 86400000
TRIP_STATUSES = ("scheduled", "needs_assignment", "cancelled")
TRIP_LENS = {"purpose": 200, "destination": 300, "details": 1000, "note": 500}
TRIP_FIELDS = ("state", "vehicle_id", "requested_vehicle_id", "start_at", "end_at", "wheelchair_required", "trip_type",
               "purpose", "destination", "details", "client_key", "staff_key", "driver_key", "assign_note")
VISITING = "Do this from your own account — not while visiting someone else."
BUSY = "Somebody else is changing the vehicle calendar right now — try again."
# the settings an edition holder changes beside the master; the others are the master's alone
SETTINGS_EDITION_KEYS = ("trip_types",)
# the trip types a client's own page offers (Clients › Transportation) beside the settings' list; Other is filled in
CLIENT_TRIP_TYPES = ("Dr Appointment", "Chores", "Community Outing")
OTHER_TRIP = re.compile(r"Other: \S.*")


def trip_type_ok(tt: str, st: dict) -> bool:
    """A trip type the settings list, one a client's page offers, or an Other filled in."""
    return tt in (st.get("trip_types") or []) or tt in CLIENT_TRIP_TYPES or bool(OTHER_TRIP.fullmatch(tt))
SETTING_WORDS = {"directors": "who approves vehicle requests", "text_to": "the approvers' text numbers",
                 "import_minutes": "the import's assumed trip length"}
EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
CLIENT_STEPS = ("The trip's row in the Transportation trips house, and its log line",
                "The vehicle calendar and the client's Transportation, read again.")


# ---- the read module's parts a decision rests on ------------------------------------------------------------------

def _TR() -> Any:
    import transportation as TR  # noqa: PLC0415 - the read module loads beside this one
    return TR


def _TF() -> Any:
    import transportation_flows as TF  # noqa: PLC0415 - the flows module imports this one
    return TF


def _part(name: str) -> Callable[..., Any]:
    fn = getattr(_TR(), name, None)
    if not callable(fn):
        raise Defer(f"the Transportation reads carry no {name}")
    return fn


def gate(sess: L.Session) -> dict[str, Any]:
    """vcGate_."""
    return _part("gate")(sess) or {}


def client_gate(sess: L.Session, g: dict, client: str) -> dict[str, Any]:
    """vcClientGate_: the trip opened from a client's page."""
    if not client:
        return g
    return _part("client_gate")(sess, g, client) or g


def settings(reads: L.Reads) -> dict[str, Any]:
    """vcSettings_."""
    return _part("settings")(reads) or {}


def people(reads: L.Reads) -> dict[str, Any]:
    """vcPeople_, with its index by staff key."""
    got = dict(_part("people")(reads) or {})
    by_key = got.get("by_key") or got.get("byKey")
    if not isinstance(by_key, dict):
        by_key = {p.get("key"): p for p in got.get("rows") or [] if isinstance(p, dict) and p.get("key")}
    got["by_key"] = by_key
    return got


def clients(reads: L.Reads) -> dict[str, Any]:
    """vcClients_."""
    return _part("clients")(reads) or {}


def drivers(reads: L.Reads, keys: list[str]) -> dict[str, Any]:
    """vcDrivers_: each key's driving word from the Employee Database's two reads."""
    return _part("drivers")(reads, keys) or {"readable": False, "map": {}}


# ---- small pure helpers (VehicleCalendar.gs) ----------------------------------------------------------------------

def s_(v: Any) -> str:
    """vcStr_."""
    return gsjs.trim(gsjs.or_blank(v))


def has(p: dict, k: str) -> bool:
    """vcHas_."""
    return k in p and p[k] is not None


def yes(v: Any) -> bool:
    """vcYes_."""
    return v is True or bool(re.fullmatch(r"(yes|true|1|on|y)", s_(v), re.I))


def word(b: bool) -> str:
    return "yes" if b else "no"


def new_id(prefix: str) -> str:
    """vcNewId_: the prefix and ten upper-case hex characters."""
    return prefix + secrets.token_hex(5).upper()


def closed() -> dict[str, Any]:
    return {"status": 404, "message": "Unknown action."}


def js_number(v: Any) -> float | None:
    """Number(v); None for NaN."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if v is None:
        return None
    s = gsjs.trim(gsjs.or_blank(v))
    if not s:
        return 0.0
    try:
        return float(s) if re.fullmatch(r"[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?", s, re.I) else None
    except ValueError:
        return None


def parse_int(v: Any) -> int | None:
    """parseInt(vcStr_(v), 10); None for NaN."""
    m = re.match(r"^[+-]?\d+", s_(v))
    return int(m.group(0)) if m else None


def ms_of(iso: Any) -> float | None:
    """vcMs_."""
    return gsjs.date_parse(s_(iso))


def now_ms(reads: L.Reads) -> float:
    return reads.now.timestamp() * 1000.0


def _local(ms: float) -> datetime:
    return datetime.fromtimestamp(ms / 1000.0, timezone.utc).astimezone(NY)


def day_of(ms: float) -> str:
    """vcDayOf_: the Ohio day of an instant."""
    return _local(ms).strftime("%Y-%m-%d")


def hm_of(ms: float) -> str:
    return _local(ms).strftime("%H:%M")


def clock_words(ms: float) -> str:
    """vcClockWords_: '1:00 PM'."""
    t = _local(ms)
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def iso_valid(day: str) -> bool:
    m = _DAY.match(day or "")
    if not m:
        return False
    try:
        datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        return True
    except ValueError:
        return False


def day_index(day: str) -> int:
    y, mo, d = (int(x) for x in day.split("-"))
    return (datetime(y, mo, d, tzinfo=timezone.utc) - datetime(1970, 1, 1, tzinfo=timezone.utc)).days


def day_words(day: str, weekday: bool) -> str:
    """vcDayWords_: 'Tue Oct 7' or 'Oct 7'."""
    if not iso_valid(day):
        return s_(day)
    y, mo, d = day.split("-")
    out = f"{MONTHS[int(mo) - 1]} {int(d)}"
    return f"{WEEKDAYS[((day_index(day) % 7) + 7 + 4) % 7]} {out}" if weekday else out


def when_words(start: Any, end: Any) -> str:
    """vcWhenWords_."""
    s, e = ms_of(start), ms_of(end)
    if s is None:
        return ""
    dash = " – "
    sd = day_of(s)
    if e is None:
        return day_words(sd, True) + ", " + clock_words(s)
    ed = day_of(e)
    if sd == ed:
        return day_words(sd, True) + ", " + clock_words(s) + dash + clock_words(e)
    return day_words(sd, False) + ", " + clock_words(s) + dash + day_words(ed, False) + ", " + clock_words(e)


def span_words(start: Any, end: Any) -> str:
    """vcSpanWords_."""
    s, e = ms_of(start), ms_of(end)
    if s is None or e is None or day_of(s) != day_of(e):
        return when_words(start, end)
    return clock_words(s) + " – " + clock_words(e)


def iso_of(ms: float) -> str:
    """vcIso_: the minute with the Eastern offset of that moment."""
    t = _local((ms // 60000) * 60000)
    off = int(t.utcoffset().total_seconds() // 60) if t.utcoffset() is not None else 0
    a = abs(off)
    return t.strftime("%Y-%m-%dT%H:%M:00") + ("-" if off < 0 else "+") + f"{a // 60:02d}:{a % 60:02d}"


def wall_ms(wall: Any) -> dict[str, Any]:
    """vcWallToMs_: 'yyyy-MM-ddTHH:mm' on the Eastern wall clock."""
    m = _WALL.match(s_(wall))
    bad = {"status": 400, "message": "Choose a date and a time."}
    if not m:
        return bad
    day = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    if not iso_valid(day) or int(m.group(4)) > 23 or int(m.group(5)) > 59:
        return bad
    base = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)),
                    tzinfo=timezone.utc).timestamp() * 1000.0
    for hours in (4, 5):
        ms = base + hours * 3600000
        if day_of(ms) == day and hm_of(ms) == f"{m.group(4)}:{m.group(5)}":
            return {"ms": ms}
    return {"status": 400, "message": "That time does not exist in Eastern Time (the clocks jump forward)."}


def span_of(t: dict) -> tuple[float | None, float | None]:
    return ms_of(t.get("start_at")), ms_of(t.get("end_at"))


def overlap(a: tuple, b: tuple) -> bool:
    """vcOverlap_, half-open; an unreadable end never overlaps."""
    if None in a or None in b:
        return False
    return a[0] < b[1] and b[0] < a[1]


def availability_of(v: Any) -> str:
    a = s_(v).lower()
    return a if a in AVAILABILITY else "available"


def aliases_of(r: dict) -> list[str]:
    """vcAliasesOf_."""
    out: list[str] = []
    for a in [r.get("name")] + s_(r.get("aliases")).split("|"):
        x = s_(a)
        if x and x not in out:
            out.append(x)
    return out


def index(rows: list[dict]) -> dict[str, dict]:
    return {s_(r.get("id")): r for r in rows}


def vehicle_name(vehicles: list[dict], vid: str) -> str:
    v = index(vehicles).get(vid)
    return s_(v.get("name")) if v else ""


def json_text(v: Any) -> str:
    """JSON.stringify of what a log cell keeps."""
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False)


# ---- the houses as a write sees them --------------------------------------------------------------------------------

def _cell(v: Any) -> str:
    """vcCellText_ off the copy's text."""
    return gsjs.trim(gsjs.or_blank(hubdb.typed(v, "raw")))


def tab_rows(reads: L.Reads, tab: str) -> list[dict]:
    """vcRead_: each row with its id (its key for the settings), every header a key; Python's own edits laid."""
    def read() -> list[dict]:
        db = reads.db
        if HT.tabled(tab):
            idf = "key" if tab == TABS["settings"] else "id"
            got = [{**{h: "" for h in HEADERS.get(tab, ())}, **{h: gsjs.trim(v) for h, v in r.items()}}
                   for r in HT.rows(reads, tab)]
            return [r for r in got if r.get(idf)]
        if not db.house_moved(tab):
            raise Defer(f'the Transportation house "{tab}" is not declared in the copy')
        res = db.resolve(tab)
        if res.runtime:
            raise Defer(f"{tab} lives in the depot's facts")
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the Transportation house {tab}")
            return []
        idf = "key" if tab == TABS["settings"] else "id"
        heads = [gsjs.trim(gsjs.or_blank(h)) for h in res.ref.headers]
        out: list[dict] = []
        for _rn, raw in db.rows(res.ref):
            row = {h: "" for h in HEADERS.get(tab, ())}
            for h, src in zip(heads, res.ref.headers):
                if h:
                    row[h] = _cell(raw.get(src))
            if row.get(idf):
                out.append(row)
        return out
    return [dict(r) for r in reads.once("trw:tab:" + tab, read)]


def books(reads: L.Reads, *tabs: str) -> tuple[str, ...]:
    """The books a verdict on these houses rests on (none for a house kept in its own table)."""
    out: list[str] = []
    for t in tabs:
        sid = "" if HT.tabled(t) else reads.db.resolve(t).sheet_id
        if sid and sid not in out:
            out.append(sid)
    return tuple(out)


def where(reads: L.Reads, tab: str) -> tuple[str, str]:
    """(the book, its tab) a house's rows are written to; ("", the house) for a house kept in its own table."""
    if HT.tabled(tab):
        return "", tab
    res = W.tab_of(reads, tab)
    if res.ref is None:
        raise Defer(f"the {tab} house holds no tab in the copy: Apps Script makes it on its first write")
    return W.where_of(res)


def log_row(g: dict | None, trip_id: str, vehicle_id: str, via: str, was: Any, now: Any, note: str,
            at: str) -> dict[str, str]:
    """vcLogRow_."""
    return {"id": new_id("VL"), "at": at, "by_uid": s_((g or {}).get("uid")) if g else "system",
            "by_name": s_((g or {}).get("name")) if g else "Transportation", "trip_id": trip_id or "",
            "vehicle_id": vehicle_id or "", "via": via, "was": "" if was in ("", None) else json_text(was),
            "now": "" if now in ("", None) else json_text(now), "note": gsjs.text(note, 500)}


def log_record(reads: L.Reads, row: dict, subject: str, edition: str) -> dict[str, Any] | None:
    sid, tab = where(reads, TABS["log"])
    return row_record(sid, tab, HEADERS["vc_log"], row["id"], subject, None, row, edition)


def row_record(sid: str, tab: str, header: tuple, key: str, subject: str, was: dict | None, now: dict,
               edition: str, match: str = "id") -> dict[str, Any] | None:
    """A whole new row appended, or the cells a row's write changes, with what the copy held; a house kept in its own
    table (where gave no book) written there under the write's lock, nothing returned."""
    if not sid and HT.tabled(tab):
        cells = {h: now.get(h, "") for h in header} if was is None else \
            {h: now.get(h, "") for h in header if s_(now.get(h)) != s_(was.get(h))}
        if cells:
            HT.put(None, tab, "key" if match.endswith("key") else "id", key, cells, subject)  # type: ignore[arg-type]
        return None
    if was is None:
        return W.kept_record(sid, tab, "append", match, key, subject, {h: now.get(h, "") for h in header},
                             edition=edition)
    cells = {h: now.get(h, "") for h in header if s_(now.get(h)) != s_(was.get(h))}
    if not cells:
        return None
    return W.kept_record(sid, tab, "edit", match, key, subject, cells, before={h: was.get(h, "") for h in cells},
                         edition=edition)


def kept(answer: dict[str, Any], edits: list[dict | None], subject: str, fresh: tuple[str, ...]) -> Decision:
    """W.final, the verdict resting on the books it read."""
    d = W.final(answer, [e for e in edits if e], subject)
    d.fresh = fresh
    return d


def edition_holds(sess: L.Session, g: dict, eid: str) -> bool:
    """A person the edition lists, who opens Transportation itself (never a lent client page) from their own account."""
    return bool(g.get("open")) and not g.get("lent") and not g.get("visiting") and \
        sc.edition_allows(eid, sess.user or {}, sess.reads.config())


# ---- the booking's rules (VehicleCalendarFlows.gs) ----------------------------------------------------------------

def not_accessible(name: str, vehicles: list[dict]) -> str:
    """vcNotAccessible_."""
    ok = ["the " + s_(v.get("name")) for v in vehicles
          if yes(v.get("wheelchair_accessible")) and availability_of(v.get("availability")) == "available"]
    return f"The {name} is not wheelchair accessible — " + \
        ("choose " + " or ".join(ok) + "." if ok else "no accessible vehicle is in service.")


def schedule_block(trip: dict, vid: str, vehicles: list[dict], trips: list[dict]) -> dict[str, Any] | None:
    """vcScheduleBlock_: why `trip` cannot hold `vid` as a scheduled trip, or None."""
    if not vid:
        return {"status": 400, "message": "Choose a vehicle to schedule the trip.", "phrase": "no vehicle was chosen",
                "fix": "vehicle"}
    v = index(vehicles).get(vid)
    if not v:
        return {"status": 400, "message": "Choose a vehicle.", "phrase": "the requested vehicle is no longer on the list",
                "fix": "vehicle"}
    name, avail = s_(v.get("name")), availability_of(v.get("availability"))
    if avail == "maintenance":
        return {"status": 409, "message": f"The {name} is in maintenance — choose another vehicle.",
                "phrase": f"the {name} is in maintenance", "fix": "vehicle"}
    if avail == "out_of_service":
        return {"status": 409, "message": f"The {name} is out of service — choose another vehicle.",
                "phrase": f"the {name} is out of service", "fix": "vehicle"}
    if yes(trip.get("wheelchair_required")) and not yes(v.get("wheelchair_accessible")):
        return {"status": 400, "message": not_accessible(name, vehicles),
                "phrase": f"the {name} is not wheelchair accessible", "fix": "vehicle"}
    span = span_of(trip)
    hit = next((o for o in trips if o.get("id") != trip.get("id") and o.get("state") == "scheduled"
                and o.get("vehicle_id") == vid and overlap(span, span_of(o))), None)
    if hit:
        return {"status": 409, "message": f"The {name} is booked {when_words(hit.get('start_at'), hit.get('end_at'))}"
                                          " — choose another vehicle or time.",
                "phrase": f"the {name} was booked by then", "fix": "vehicle"}
    if s_(trip.get("driver_key")):
        drv = next((o for o in trips if o.get("id") != trip.get("id") and o.get("state") == "scheduled"
                    and o.get("driver_key") == trip.get("driver_key") and overlap(span, span_of(o))), None)
        if drv:
            who_ = s_(trip.get("driver_name")) or "The driver"
            other = vehicle_name(vehicles, s_(drv.get("vehicle_id"))) or "other vehicle"
            return {"status": 409, "message": f"{who_} already drives the {other} then "
                                              f"({span_words(drv.get('start_at'), drv.get('end_at'))}).",
                    "phrase": f"{who_} already drives another trip then", "fix": "driver"}
    return None


# ---- the directors' trip panel: details, vehicle, driver, status --------------------------------------------------

def trip_save(sess: L.Session, payload: dict) -> Decision:
    """vehicleCalendarTripSave: refused, or kept in app.edits; a requester's cancel is told through Smart Comms."""
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    g = client_gate(sess, gate(sess), gsjs.text(p.get("client"), 120))
    if not g.get("open"):
        return Decision(closed())
    if g.get("visiting"):
        return W.refuse(403, VISITING)
    by_edition = not g.get("can_edit") and edition_holds(sess, g, EDITION["trips"])
    editor = bool(g.get("can_edit")) or by_edition
    client = s_(g.get("client"))
    if not editor and not client:
        return W.refuse(403, "Only the directors assign trips.")
    if not editor and has(p, "client_key") and gsjs.text(p.get("client_key"), 120) != client:
        return W.refuse(403, "A trip changed from a client's page stays with that client.")
    trip_id = gsjs.text(p.get("trip_id"), 20)
    if not TRIP_ID.match(trip_id):
        return W.refuse(400, "Which trip? The trip id is missing.")
    status = s_(p.get("status"))
    if status and status not in TRIP_STATUSES:
        return W.refuse(400, "A trip is set to Scheduled, Needs assignment or Cancelled.")
    for k, n in TRIP_LENS.items():
        if has(p, k) and CW.utf16_len(gsjs.js_str(p[k])) > n:
            return W.refuse(400, f"{k[:1].upper()}{k[1:]} can be at most {n} characters.")
    st = settings(reads)
    need_people = has(p, "staff_key") or has(p, "driver_key")
    staff = people(reads) if need_people else None
    if staff is not None and not staff.get("readable"):
        return W.refuse(503, f"The staff list could not be read just now ({gsjs.or_blank(staff.get('why'))}).")
    client_key = gsjs.text(p.get("client_key"), 120) if has(p, "client_key") else None
    roster = clients(reads) if client_key else None
    if roster is not None and not roster.get("readable"):
        return W.refuse(503, f"The client list could not be read just now ({gsjs.or_blank(roster.get('why'))}).")
    fresh = books(reads, TABS["trips"], TABS["vehicles"], TABS["settings"])
    trips, vehicles = tab_rows(reads, TABS["trips"]), tab_rows(reads, TABS["vehicles"])
    v_by = index(vehicles)
    t = next((r for r in trips if r.get("id") == trip_id), None)
    if t is None:
        return W.refuse(404, "That trip is not on the calendar any more.", fresh=fresh)
    if client and t.get("client_key") != client:
        return W.refuse(409, "This trip is not this client's any more (it has moved) — nothing was changed.", fresh=fresh)
    if t.get("state") in ("declined", "cancelled"):
        return W.refuse(409, f"This trip was {t.get('state')} — nothing to change.", fresh=fresh)
    if t.get("state") == "requested" and status:
        return W.refuse(400, "A waiting request is approved or declined by the directors — not set here.", fresh=fresh)
    was = dict(t)
    warnings: list[str] = []
    informed: list[tuple[dict | None, dict]] = []
    vehicle_id: str | None = None
    if has(p, "vehicle_id"):
        vehicle_id = gsjs.text(p.get("vehicle_id"), 20)
        if vehicle_id and vehicle_id not in v_by:
            return W.refuse(400, "Choose a vehicle.", fresh=fresh)
        if vehicle_id:
            t["requested_vehicle_id"] = vehicle_id
    if has(p, "staff_key"):
        sp = staff["by_key"].get(gsjs.text(p.get("staff_key"), 120))
        if not sp:
            return W.refuse(400, "Choose a staff member.")
        t["staff_key"], t["staff_uid"], t["staff_name"] = s_(sp.get("key")), s_(sp.get("uid")), s_(sp.get("name"))
    if has(p, "driver_key"):
        dk = gsjs.text(p.get("driver_key"), 120)
        dp = staff["by_key"].get(dk) if dk else None
        if dk and not dp:
            return W.refuse(400, "Choose a driver.")
        t["driver_key"], t["driver_uid"], t["driver_name"] = \
            (s_(dp.get("key")), s_(dp.get("uid")), s_(dp.get("name"))) if dp else ("", "", "")
    if s_(p.get("start")) or s_(p.get("end")):
        s = wall_ms(p.get("start")) if s_(p.get("start")) else {"ms": ms_of(t.get("start_at"))}
        if not s.get("ms"):
            m = s.get("message") or ""
            return W.refuse(400, "Choose a pickup date and time." if m == "Choose a date and a time." else m)
        e = wall_ms(p.get("end")) if s_(p.get("end")) else {"ms": ms_of(t.get("end_at"))}
        if not e.get("ms"):
            m = e.get("message") or ""
            return W.refuse(400, "Choose a return date and time." if m == "Choose a date and a time." else m)
        if e["ms"] <= s["ms"]:
            return W.refuse(400, "The end must be after the start.")
        if e["ms"] - s["ms"] > MAX_SPAN_MS:
            return W.refuse(400, "A reservation can be at most 14 days.")
        t["start_at"], t["end_at"], t["day"] = iso_of(s["ms"]), iso_of(e["ms"]), day_of(s["ms"])
        if s_(p.get("end")):
            t["end_known"] = "yes"
    if has(p, "wheelchair_required"):
        t["wheelchair_required"] = word(p.get("wheelchair_required") is True or yes(p.get("wheelchair_required")))
    if has(p, "trip_type"):
        tt = gsjs.text(p.get("trip_type"), 60)
        if tt and not trip_type_ok(tt, st) and tt != t.get("trip_type"):
            return W.refuse(400, "Choose a trip type.", fresh=fresh)
        t["trip_type"] = tt
    if has(p, "purpose"):
        t["purpose"] = gsjs.text(p.get("purpose"), 200)
    if has(p, "destination"):
        t["destination"] = gsjs.text(p.get("destination"), 300)
    if has(p, "details"):
        t["details"] = gsjs.trim(gsjs.js_str(p.get("details")))
    if client_key is not None:
        cl = next((x for x in roster.get("rows") or [] if s_(x.get("key")) == client_key), None) if client_key else None
        if client_key and not cl:
            return W.refuse(400, "Choose a client from the list.")
        t["client_key"], t["client_name"] = (s_(cl.get("key")), s_(cl.get("name"))) if cl else ("", "")
    note = gsjs.text(p.get("note"), 500) if has(p, "note") else None
    target = status or t.get("state")
    said, via = "Saved.", "assign"
    if target == "scheduled":
        vid = vehicle_id if vehicle_id else (t.get("vehicle_id") or t.get("requested_vehicle_id") or "")
        block = schedule_block(t, vid, vehicles, trips)
        if block:
            return W.refuse(block["status"], block["message"], fresh=fresh)
        if s_(t.get("driver_key")):
            keys = [k for k in (gsjs.text(p.get("driver_key"), 120), s_(was.get("driver_key"))) if k]
            dw = (drivers(reads, keys).get("map") or {}).get(t["driver_key"]) if keys else None
            if dw and dw.get("may_drive") is False:
                return W.refuse(409, (s_(t.get("driver_name")) or "The driver") +
                                " is not cleared to drive (Employee Database).", fresh=fresh)
            if not dw or dw.get("may_drive") is None:
                warnings.append((s_(t.get("driver_name")) or "The driver") + "'s driving record could not be confirmed"
                                " in the Employee Database — check it before the trip.")
        else:
            warnings.append("No driver is set for this trip.")
        t["state"], t["vehicle_id"] = "scheduled", vid
        t["assign_note"] = note if note is not None else (t.get("assign_note") if was.get("state") == "scheduled" else "")
        said = f"Saved. The trip is scheduled with the {vehicle_name(vehicles, vid)}."
    elif target == "needs_assignment":
        t["state"], t["vehicle_id"] = "needs_assignment", ""
        if note is not None:
            t["assign_note"] = note
        elif was.get("state") != "needs_assignment":
            t["assign_note"] = f"Returned to Needs assignment by {s_(g.get('name'))}."
        said = "Saved." if was.get("state") == "needs_assignment" else "Saved. The trip is back in Needs assignment."
    elif target == "cancelled":
        t["state"], t["vehicle_id"] = "cancelled", ""
        if note is not None:
            t["assign_note"] = note
        via, said = "cancel", "Cancelled."
        if s_(t.get("requested_by_uid")):
            told = _TF().requester_cancelled(sess, g, t, was, vehicles, note)
            said, informed = told["said"], told["rows"]
            warnings += told["warnings"]
            fresh = fresh + tuple(b for b in told["books"] if b not in fresh)
    elif note is not None:
        t["assign_note"] = note
    a = {f: was.get(f, "") for f in TRIP_FIELDS if s_(was.get(f)) != s_(t.get(f))}
    b = {f: t.get(f, "") for f in a}
    data: dict[str, Any] = {"ok": True, "said": said, "trip_id": trip_id}
    if warnings:
        data["warnings"] = warnings
    if not b:
        data["said"] = "Nothing changed."
        if client:
            data["written"] = []
        return Decision({"status": 200, "data": data}, fresh=fresh)
    stamp = W.now_iso(reads)
    t["updated_at"], t["updated_by"] = stamp, s_(g.get("uid"))
    edition = "" if g.get("can_edit") else EDITION["trips"] if by_edition else CLIENT_EDITION
    W.gate(reads)
    sid, tab = where(reads, TABS["trips"])
    edits = [row_record(sid, tab, HEADERS["vc_trips"], trip_id, trip_id, was, t, edition),
             log_record(reads, log_row(g, trip_id, t.get("vehicle_id") or t.get("requested_vehicle_id") or "", via, a, b,
                                       note or "", stamp), trip_id, edition)]
    edits += _TF().inbox_records(reads, informed, trip_id, edition)
    if client:
        data["written"] = list(b)
        data = W.with_steps(data, W.pg_steps(CLIENT_STEPS[0] + ", kept in the Hub's database.", CLIENT_STEPS[1],
                                             CP_APP_ID))
    return kept({"status": 200, "data": data}, edits, trip_id, fresh)


# ---- vehicles -------------------------------------------------------------------------------------------------------

def unassign(g: dict, vehicle: dict, why: str, only_wheelchair: bool, trips: list[dict], at_ms: float,
             stamp: str) -> list[tuple[dict, dict, str]]:
    """vcUnassignForVehicle_: (as it was, as it is now, why) for each trip still ahead handed back to Needs assignment."""
    moved: list[tuple[dict, dict, str]] = []
    for t in trips:
        if t.get("state") != "scheduled" or t.get("vehicle_id") != vehicle.get("id"):
            continue
        end = ms_of(t.get("end_at"))
        if end is None or not end > at_ms:
            continue
        if only_wheelchair and not yes(t.get("wheelchair_required")):
            continue
        was = dict(t)
        t.update({"state": "needs_assignment", "vehicle_id": "", "assign_note": why, "updated_at": stamp,
                  "updated_by": s_(g.get("uid"))})
        moved.append((was, t, why))
    return moved


def vehicle_save(sess: L.Session, payload: dict) -> Decision:
    """vehicleCalendarVehicleSave: refused, or the vehicle, its log line and each trip handed back kept in app.edits."""
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    g = gate(sess)
    if not g.get("open"):
        return Decision(closed())
    if g.get("visiting"):
        return W.refuse(403, VISITING)
    by_edition = not g.get("can_edit") and edition_holds(sess, g, EDITION["vehicles"])
    if not g.get("can_edit") and not by_edition:
        return W.refuse(403, "Only the directors manage vehicles.")
    vid = gsjs.text(p.get("vehicle_id"), 20)
    name = gsjs.text(p.get("name"), 200)
    description = gsjs.text(p.get("description"), 200)
    seats = js_number(p.get("seats")) if "seats" in p else None
    availability = s_(p.get("availability")).lower() or "available"
    note = None if p.get("note") is None else gsjs.text(p.get("note"), 1000)
    if vid and not VEHICLE_ID.match(vid):
        return W.refuse(400, "Which vehicle? The id is not one this app writes.")
    if not name:
        return W.refuse(400, "Give the vehicle a name.")
    if CW.utf16_len(name) > 40:
        return W.refuse(400, "A vehicle name can be at most 40 characters.")
    if CW.utf16_len(description) > 120:
        return W.refuse(400, "The description can be at most 120 characters.")
    if seats is None or not 1 <= seats <= 60 or gsjs.js_round(seats) != seats:
        return W.refuse(400, "Seats are a whole number from 1 to 60.")
    if availability not in AVAILABILITY:
        return W.refuse(400, "Availability is Available, Maintenance or Out of service.")
    if note is not None and CW.utf16_len(note) > 500:
        return W.refuse(400, "A note can be at most 500 characters.")
    accessible = p.get("wheelchair_accessible") is True or yes(p.get("wheelchair_accessible"))
    fresh = books(reads, TABS["vehicles"], TABS["trips"], TABS["settings"])
    at_ms, stamp = now_ms(reads), W.now_iso(reads)
    rows = tab_rows(reads, TABS["vehicles"])
    was = index(rows).get(vid) if vid else None
    if vid and not was:
        return W.refuse(404, "That vehicle is not on the list any more.", fresh=fresh)
    if any(s_(r.get("id")) != vid and s_(r.get("name")).lower() == name.lower() for r in rows):
        return W.refuse(409, f"Another vehicle is already called {name}.", fresh=fresh)
    if was:
        row = dict(was)
    else:
        used = [s_(r.get("tint")) for r in rows]
        tint = next((t for t in TINTS if t not in used), TINTS[len(rows) % len(TINTS)])
        order = 0.0
        for r in rows:
            order = max(order, js_number(r.get("order")) or 0.0)
        row = {h: "" for h in HEADERS["vc_vehicles"]}
        row.update({"id": new_id("VV"), "aliases": name, "tint": tint, "order": gsjs.num_str(order + 1),
                    "created_at": stamp})
    before: Any = {"name": was.get("name", ""), "description": was.get("description", ""),
                   "seats": was.get("seats", ""), "wheelchair_accessible": was.get("wheelchair_accessible", ""),
                   "availability": availability_of(was.get("availability")), "note": was.get("note", "")} if was else ""
    row.update({"name": name, "description": description, "seats": gsjs.num_str(seats),
                "wheelchair_accessible": word(accessible), "availability": availability})
    if note is not None:
        row["note"] = note
    elif not was:
        row["note"] = ""
    if was and name not in aliases_of(was):
        row["aliases"] = "|".join(aliases_of(was) + [name])
    row["updated_at"], row["updated_by"] = stamp, s_(g.get("uid"))
    edition = "" if g.get("can_edit") else EDITION["vehicles"]
    W.gate(reads)
    vsid, vtab = where(reads, TABS["vehicles"])
    edits: list[dict | None] = [
        row_record(vsid, vtab, HEADERS["vc_vehicles"], row["id"], row["id"], was, row, edition),
        log_record(reads, log_row(g, "", row["id"], "vehicle_edit" if was else "vehicle_add", before, {
            "name": name, "description": description, "seats": gsjs.num_str(seats),
            "wheelchair_accessible": row["wheelchair_accessible"], "availability": availability,
            "note": row.get("note", "")}, "", stamp), row["id"], edition)]
    trips = tab_rows(reads, TABS["trips"]) if availability != "available" or not accessible else []
    moved: list[tuple[dict, dict, str]] = []
    if availability != "available":
        moved += unassign(g, row, f"The {name} went into maintenance — choose another vehicle." if availability ==
                          "maintenance" else f"The {name} was taken out of service — choose another vehicle.",
                          False, trips, at_ms, stamp)
    if not accessible:
        moved += unassign(g, row, f"The {name} is no longer marked wheelchair accessible — choose another vehicle.",
                          True, trips, at_ms, stamp)
    if moved:
        tsid, ttab = where(reads, TABS["trips"])
        for old, now_row, why in moved:
            edits.append(row_record(tsid, ttab, HEADERS["vc_trips"], now_row["id"], row["id"], old, now_row, edition))
            edits.append(log_record(reads, log_row(g, now_row["id"], row["id"], "unassigned_by_vehicle",
                                                   {"state": old.get("state", ""), "vehicle_id": old.get("vehicle_id", "")},
                                                   {"state": "needs_assignment", "vehicle_id": ""}, why, stamp),
                                    row["id"], edition))
    n = len(moved)
    said = f"Saved. {n} scheduled trip{'' if n == 1 else 's'} went back to Needs assignment." if n else "Saved."
    return kept({"status": 200, "data": {"ok": True, "said": said, "vehicle_id": row["id"]}}, edits, row["id"], fresh)


# ---- settings ---------------------------------------------------------------------------------------------------------

def trip_types_value(v: Any) -> dict[str, str]:
    """VC_SETTABLE.trip_types."""
    if isinstance(v, list):
        items: Any = v
    elif isinstance(v, dict):
        items = None
    else:
        try:
            items = json.loads(s_(v)) if s_(v) else None
        except ValueError:
            items = None
    if not isinstance(items, list):
        items = re.split(r"\s*[\n;]\s*", s_(v))
    out: list[str] = []
    for t in items:
        x = gsjs.text(t)
        if x and x not in out:
            out.append(x)
    if not out or len(out) > 20 or any(CW.utf16_len(x) > 40 for x in out):
        return {"error": "Trip types are 1 to 20 names of at most 40 characters."}
    return {"value": json_text(out)}


def import_minutes_value(v: Any) -> dict[str, str]:
    """VC_SETTABLE.import_minutes."""
    n = parse_int(v)
    return {"value": str(n)} if n is not None and 15 <= n <= 720 else {"error": "The assumed length is 15 to 720 minutes."}


def directors_value(reads: L.Reads, v: Any) -> dict[str, str]:
    """VC_SETTABLE.directors: every address a live account answers, through the accounts' e-mail rules."""
    items = [x for x in re.split(r"[,;\s]+", s_(v)) if x]
    if not items or any(not EMAIL.fullmatch(x) for x in items):
        return {"error": "Directors are e-mail addresses, separated by commas."}
    res = _part("resolve_directors")(reads, ", ".join(items))
    if res.get("why"):
        return {"error": f"The {res['why']}."}
    if res["missed"]:
        return {"error": "No live account answers " + ", ".join(res["missed"]) + "."}
    return {"value": ", ".join(x.lower() for x in items)}


def js_keys(d: dict) -> list:
    """Object.keys order: array-index keys ascending first, then the rest as written."""
    idx = sorted((k for k in d if re.fullmatch(r"0|[1-9][0-9]{0,9}", str(k)) and int(k) < 4294967295), key=int)
    return idx + [k for k in d if k not in idx]


def text_to_value(reads: L.Reads, v: Any) -> dict[str, str]:
    """VC_SETTABLE.text_to: each account live, each number one this platform may text (never a shared line)."""
    got = v if isinstance(v, dict) else _part("jparse")(v, None)
    if not isinstance(got, dict):
        return {"error": "Text numbers are a map of account to number."}
    out: dict[str, str] = {}
    bad: list[str] = []
    for uid in js_keys(got):
        i = s_(uid)
        if not s_(got[uid]):
            continue
        n = _part("sendable")(got[uid])
        if not n or not _part("account")(reads, i):
            bad.append(i)
        else:
            out[i] = n
    if bad:
        return {"error": "These need a live account and a number this platform may text: " + ", ".join(bad) + "."}
    return {"value": json_text({k: out[k] for k in js_keys(out)})}


SETTABLE: dict[str, Callable[[L.Reads, Any], dict[str, str]]] = {
    "directors": directors_value, "trip_types": lambda _reads, v: trip_types_value(v), "text_to": text_to_value,
    "import_minutes": lambda _reads, v: import_minutes_value(v)}


def settings_set(sess: L.Session, payload: dict) -> Decision:
    """vehicleCalendarSettingsSet: refused, or kept in app.edits."""
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    g = gate(sess)
    if not g.get("open"):
        return Decision(closed())
    master = bool(g.get("is_master")) and not g.get("visiting")
    by_edition = not master and edition_holds(sess, g, EDITION["settings"])
    if not master and not by_edition:
        return W.refuse(403, "Only the master changes the Transportation settings.")
    values = p.get("values") if isinstance(p.get("values"), dict) else {}
    keys = list(values)
    CW.no_proto(*keys)
    if not master:
        theirs = [SETTING_WORDS[k] for k in keys if k in SETTING_WORDS and k not in SETTINGS_EDITION_KEYS]
        if theirs:
            return W.refuse(403, "Only the master changes " + " and ".join(theirs) + ".")
    rows: list[dict[str, str]] = []
    bad: list[str] = []
    stamp = W.now_iso(reads)
    for k in keys:
        fn = SETTABLE.get(k)
        if fn is None:
            bad.append(f"{k} is not a setting this screen changes.")
            continue
        got = fn(reads, values[k])
        if got.get("error"):
            bad.append(got["error"])
        else:
            rows.append({"key": k, "value": got["value"], "note": "", "updated_at": stamp, "updated_by": s_(g.get("uid"))})
    if bad:
        return W.refuse(400, " ".join(bad))
    if not rows:
        return W.refuse(400, "Nothing to change.")
    fresh = books(reads, TABS["settings"])
    held = {r["key"]: r for r in tab_rows(reads, TABS["settings"])}
    edition = "" if master else EDITION["settings"]
    W.gate(reads)
    sid, tab = where(reads, TABS["settings"])
    edits: list[dict | None] = [row_record(sid, tab, HEADERS["vc_settings"], r["key"], "settings", held.get(r["key"]), r,
                                           edition, match="cols:key") for r in rows]
    edits.append(log_record(reads, log_row(g, "", "", "settings", "", [r["key"] for r in rows], "", stamp), "settings",
                            edition))
    return kept({"status": 200, "data": {"ok": True, "said": "Saved."}}, edits, "settings", fresh)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "vehicleCalendarTripSave": trip_save, "vehicleCalendarVehicleSave": vehicle_save,
    "vehicleCalendarSettingsSet": settings_set,
}
_ROLES = ("admin", "director", "manager", "staff")
# HUB_POLICY: the roles each write is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "vehicleCalendarTripSave": {"roles": _ROLES, "params": {
        "trip_id": "string", "status": "string", "vehicle_id": "string", "staff_key": "string", "driver_key": "string",
        "start": "string", "end": "string", "wheelchair_required": "boolean", "trip_type": "string", "purpose": "string",
        "destination": "string", "details": "string", "client_key": "string", "note": "string", "client": "string"}},
    "vehicleCalendarVehicleSave": {"roles": _ROLES, "params": {
        "vehicle_id": "string", "name": "string", "description": "string", "seats": "number",
        "wheelchair_accessible": "boolean", "availability": "string", "note": "string"}},
    "vehicleCalendarSettingsSet": {"roles": _ROLES, "params": {"values": "object"}},
}
# the platform's write lock held by another write: Apps Script's own sentence for its own lock
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.transportation_writes and app.transportation_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="transportation", label="Transportation")
