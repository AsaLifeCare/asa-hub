"""Transportation's flows (apps-script/VehicleCalendarFlows.gs) decided off asa-hub-db: kept in app.edits, told through Smart Comms."""
from __future__ import annotations

import hashlib
import logging
import re
from typing import Any, Callable

import client_writes as CW
import gsjs
import hubdb
import locations as L
import scope as sc
import smart_comms as SC
import transportation as TR
import transportation_writes as TW
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

TABS = TW.TABS
INBOX = TABS["inbox"]
# VehicleCalendar.gs VC_HEADERS.vc_inbox: no copy of the tab carries it until its first row lands
INBOX_HEADER = ("id", "trip_id", "box", "kind", "seat", "to_uid", "to_email", "to_name", "title", "body", "facts", "date",
                "when", "state", "answered_by", "answered_at", "note", "link", "test_mode", "created_at")
ASK, DECIDED, CANCELLED = "transport_request_ask", "transport_request_decided", "transport_trip_cancelled"
LANE = "transportation"
ITEM_ID = re.compile(r"^VI[0-9A-F]{10}$")
LATE_MS = 15 * 60000
# MailTemplates.gs mailPlatformUrl_
PLATFORM_URL = "https://asamylife.asalifecare.com"
OWN_ACCOUNT = "Answer from your own account — not while visiting someone else."
# the names a JavaScript object answers on its own: a lookup by one of them is Apps Script's to make
JS_OWN = frozenset({"constructor", "__proto__", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
                    "toLocaleString", "toString", "valueOf", "__defineGetter__", "__defineSetter__", "__lookupGetter__",
                    "__lookupSetter__"})

s_ = TW.s_


# ---- small values (VehicleCalendar.gs) ------------------------------------------------------------------------------

def vtext(v: Any, n: int = 0) -> str:
    """vcText_: whitespace runs as one space, trimmed, cut to n UTF-16 units."""
    t = gsjs.text(v)
    return SC._cut16(t, n) if n else t


def sha10(text: str) -> str:
    """vcSha10_."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:10].upper()


def when_words(start: Any, end: Any, ascii_dash: bool = False) -> str:
    """vcWhenWords_, with its plain-hyphen form for a text."""
    s, e = TW.ms_of(start), TW.ms_of(end)
    if s is None:
        return ""
    dash = " - " if ascii_dash else " – "
    sd = TW.day_of(s)
    if e is None:
        return TW.day_words(sd, True) + ", " + TW.clock_words(s)
    ed = TW.day_of(e)
    if sd == ed:
        return TW.day_words(sd, True) + ", " + TW.clock_words(s) + dash + TW.clock_words(e)
    return TW.day_words(sd, False) + ", " + TW.clock_words(s) + dash + TW.day_words(ed, False) + ", " + TW.clock_words(e)


def names_words(names: list[str]) -> str:
    """vcNamesWords_."""
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


def link(path: str) -> str:
    """vcLink_."""
    return PLATFORM_URL + "/#" + path


def trip_link(trip_id: str) -> str:
    """vcTripLink_."""
    return "/app/vehicle-calendar/calendar?trip=" + trip_id


def key_of(sit: str, trip_id: Any, uid: Any) -> str:
    """vcOwed_'s key: the one Smart Comms holds the text under."""
    return f"vc|{sit}|{gsjs.or_blank(trip_id)}|{gsjs.or_blank(uid)}"


def facts_of(pairs: list[tuple[Any, Any]]) -> list[dict[str, str]]:
    """vcFactsOf_."""
    out: list[dict[str, str]] = []
    for label_, value_ in pairs:
        if len(out) >= 12:
            break
        label, value = vtext(label_, 40), vtext(value_, 240)
        if label and value:
            out.append({"label": label, "value": value})
    return out


def no_js_own(*names: str) -> None:
    if any(n in JS_OWN for n in names):
        raise Defer("a name JavaScript's own objects answer")


def last(rows: list[dict], field: str, value: str) -> dict | None:
    """The forEach lookup: the last row whose field holds the value."""
    hit = None
    for r in rows:
        if r.get(field) == value:
            hit = r
    return hit


# ---- the items house: its own Data tab, which no copy holds until its first row ------------------------------------

def inbox_ref(reads: L.Reads) -> tuple[hubdb.Resolved, hubdb.TabRef | None]:
    """hubTabSheet_ for vc_inbox: the copy's tab, else the rows Python's own edits appended under the house's Data tab."""
    if not reads.db.house_moved(INBOX):
        raise Defer(f'the Transportation house "{INBOX}" is not declared in the copy')
    res = W.tab_of(reads, INBOX)
    ref = res.ref
    if ref is None and res.sheet_id:
        virtual = getattr(hubdb.OWN.get(), "virtual", None)
        ref = virtual(res.sheet_id, hubdb.HOUSE_DATA_TAB) if virtual is not None else None
    return res, ref


def inbox_where(reads: L.Reads) -> tuple[str, str]:
    """Where an item lands: ("", the house) once it is kept in its own table, else the tab the sheet keeps it in (the
    house's Data tab), never the house's name."""
    if TW.HT.tabled(INBOX):
        return "", INBOX
    res, ref = inbox_ref(reads)
    return res.sheet_id, (ref.tab if ref is not None else hubdb.HOUSE_DATA_TAB)


def inbox_rows(reads: L.Reads) -> list[dict]:
    """vcRead_(VC_TABS.inbox): each item with its id, every header a key, Python's own edits laid."""
    def read() -> list[dict]:
        if TW.HT.tabled(INBOX):
            got = [{**{h: "" for h in INBOX_HEADER}, **{h: gsjs.trim(v) for h, v in r.items()}}
                   for r in TW.HT.rows(reads, INBOX)]
            return [r for r in got if r.get("id")]
        _res, ref = inbox_ref(reads)
        if ref is None:
            return []
        heads = [gsjs.trim(gsjs.or_blank(h)) for h in ref.headers]
        out: list[dict] = []
        for _rn, raw in reads.db.rows(ref):
            row = {h: "" for h in INBOX_HEADER}
            for h, src in zip(heads, ref.headers):
                if h:
                    row[h] = TW._cell(raw.get(src))
            if row.get("id"):
                out.append(row)
        return out
    return [dict(r) for r in reads.once("trf:inbox", read)]


def inbox_row(reads: L.Reads, trip: dict, box: str, kind: str, seat: str, to: dict, title: str, body: str,
              facts: list, link_: str) -> dict[str, str]:
    """vcInboxRow_: one row per recipient per trip per kind; a second telling of the same kind replaces the first."""
    return {"id": "VI" + sha10(f"{trip['id']}|{box}|{kind}|{gsjs.or_blank(to.get('uid'))}"), "trip_id": trip["id"],
            "box": box, "kind": kind, "seat": seat, "to_uid": s_(to.get("uid")), "to_email": s_(to.get("email")),
            "to_name": s_(to.get("name")), "title": vtext(title, 200), "body": vtext(body, 300),
            "facts": TW.json_text(facts or []), "date": trip.get("day", ""),
            "when": when_words(trip.get("start_at"), trip.get("end_at")),
            "state": "waiting" if box == "work" else "posted", "answered_by": "", "answered_at": "", "note": "",
            "link": link_, "test_mode": TR.test_word(reads), "created_at": W.now_iso(reads)}


def requester_item(reads: L.Reads, trip: dict, title: str, body: str) -> dict[str, str] | None:
    """vcRequesterItem_: the requester's My Inbox informative about their trip."""
    if not s_(trip.get("requested_by_uid")):
        return None
    return inbox_row(reads, trip, "inbox", "info", "requester",
                     {"uid": trip.get("requested_by_uid"), "name": trip.get("requested_by_name"), "email": ""},
                     title, body, [], trip_link(trip["id"]))


def upserts(inbox: list[dict], rows: list[dict]) -> list[tuple[dict | None, dict]]:
    """vcUpsert_ by id: (the row the sheet holds first under that id, or None, and the row written)."""
    out: list[tuple[dict | None, dict]] = []
    for r in rows:
        was = next((x for x in inbox if x.get("id") == r["id"]), None)
        out.append((was, r))
    return out


def inbox_records(reads: L.Reads, rows: list[tuple[dict | None, dict]], subject: str,
                  edition: str = "") -> list[dict | None]:
    """The items as app.edits keeps them: a new one appended whole, a known one by the cells it changes."""
    if not rows:
        return []
    sid, tab = inbox_where(reads)
    return [TW.row_record(sid, tab, INBOX_HEADER, now["id"], subject, was, now, edition) for was, now in rows]


# ---- the texts: raised through Smart Comms, only their outcome on the trip ------------------------------------------

def write_tx() -> Any:
    """The transaction main.py names around this decision (smart_comms.deciding)."""
    held = SC._WRITE.get() or {}
    tx = held.get("tx")
    if tx is None:
        raise Defer("Smart Comms is not deciding this write, so its texts would be kept nowhere: nothing is written")
    return tx


def say(reads: L.Reads, sit: str, trip_id: str, to: dict, vars_: dict) -> dict[str, Any]:
    """vcSay_: the text handed to Smart Comms under vcOwed_'s key, the number vcPhoneOf_ picks."""
    write_tx()
    return SC.raise_situation(None, situation=sit, to=TR.phone_of(reads, to.get("uid")), vars=vars_,
                              key=key_of(sit, trip_id, to.get("uid")), person=s_(to.get("name")), lane=LANE,
                              at_ms=int(TW.now_ms(reads)), prune=True)


def told_of(raw: Any) -> dict:
    """vcJson_(trip.told, {})."""
    got = TR.jparse(raw, {})
    return got if isinstance(got, dict) else {}


def told_apply(told: dict, bucket: str, uid: Any, res: dict, at: str) -> None:
    """vcToldApply_'s record: the outcome under its bucket; what is still owed stays in Smart Comms' outbox."""
    held = told.get(bucket)
    if not isinstance(held, dict):
        held = told[bucket] = {}
    held[s_(uid)] = {"state": s_(res.get("state")), "held": s_(res.get("held")), "why": vtext(res.get("why"), 200),
                     "at": at}


def drop_asks(told: dict) -> None:
    """The asks a trip still owed (an older Apps Script entry) dropped once the request is no longer waiting."""
    if isinstance(told.get("owed"), list):
        told["owed"] = [o for o in told["owed"] if not (isinstance(o, dict) and o.get("bucket") == "ask")]


def cancel_asks(trip_id: str) -> int:
    """Every ask text Smart Comms still owes for this request withdrawn: said only while still true."""
    return SC.cancel_owed(write_tx(), key_of(ASK, trip_id, ""), "the request is no longer waiting")


def text_words(results: list[tuple[str, dict]]) -> str:
    """vcTextWords_: what the texts did, in one sentence for the panel; '' when every one went out."""
    parts: list[str] = []

    def by(state: str) -> list[tuple[str, dict]]:
        return [r for r in results if r[1].get("state") == state]
    test = [r for r in results if r[1].get("held") == "test_mode"]
    quiet = [r for r in results if r[1].get("held") == "quiet"]
    if test:
        parts.append("Test mode is on: the text" + (" was" if len(test) == 1 else "s were") +
                     " written to the rehearsal book — nobody was contacted.")
    if quiet:
        parts.append("It is quiet hours: the text" + (" goes" if len(quiet) == 1 else "s go") + " out at 08:00.")
    for name, _res in by("no_phone"):
        parts.append(name + " has no number this platform may text.")
    if by("off"):
        parts.append("No text went out: " + s_(by("off")[0][1].get("why")) + ".")
    for name, res in by("failed") + by("refused"):
        parts.append(name + " could not be texted (" + vtext(res.get("why"), 120) + ").")
    for name, res in results:
        if res.get("state") == "held" and res.get("held") not in ("test_mode", "quiet"):
            parts.append("The text to " + name + " was held (" + vtext(res.get("why") or res.get("held"), 120) + ").")
    return " ".join(parts)


# ---- the request's refusals (vcRequestCheck_) -----------------------------------------------------------------------

def refusal(status: int, message: str) -> dict[str, Any]:
    return {"status": status, "message": message}


def request_check(f: dict, vehicles: list[dict], trips: list[dict], people: dict, clients: dict | None, st: dict,
                  now: float) -> dict[str, Any]:
    """vcRequestCheck_: the request's refusals in their order, or {ok, vehicle, staff, client, s, e, warnings}."""
    v = TW.index(vehicles).get(f["vehicle_id"])
    if not f["vehicle_id"] or not v:
        return refusal(400, "Choose a vehicle.")
    if not people or not people.get("readable"):
        return refusal(503, f"The staff list could not be read just now ({s_((people or {}).get('why'))}).")
    staff = (people.get("by_key") or {}).get(f["staff_key"])
    if not f["staff_key"] or not staff:
        return refusal(400, "Choose a staff member.")
    if not f["trip_type"] or not TW.trip_type_ok(f["trip_type"], st):
        return refusal(400, "Choose a trip type.")
    s = TW.wall_ms(f["start"])
    if not s.get("ms"):
        m = s.get("message") or ""
        return refusal(400, "Choose a start date and time." if m == "Choose a date and a time." else m)
    e = TW.wall_ms(f["end"])
    if not e.get("ms"):
        m = e.get("message") or ""
        return refusal(400, "Choose an end date and time." if m == "Choose a date and a time." else m)
    if e["ms"] <= s["ms"]:
        return refusal(400, "The end must be after the start.")
    if e["ms"] - s["ms"] > TW.MAX_SPAN_MS:
        return refusal(400, "A reservation can be at most 14 days.")
    if s["ms"] < now - LATE_MS:
        return refusal(400, "That start has already passed.")
    name, avail = s_(v.get("name")), TW.availability_of(v.get("availability"))
    if avail == "maintenance":
        return refusal(409, f"The {name} is in maintenance — choose another vehicle.")
    if avail == "out_of_service":
        return refusal(409, f"The {name} is out of service — choose another vehicle.")
    if f["wheelchair_required"] and not TW.yes(v.get("wheelchair_accessible")):
        return refusal(400, TW.not_accessible(name, vehicles))
    span = (s["ms"], e["ms"])
    booked = pending = mine = None
    for t in trips:
        if not TW.overlap(span, TW.span_of(t)):
            continue
        if booked is None and t.get("state") == "scheduled" and t.get("vehicle_id") == v.get("id"):
            booked = t
        if pending is None and t.get("state") == "requested" and t.get("requested_vehicle_id") == v.get("id"):
            pending = t
        if mine is None and t.get("state") in ("scheduled", "requested") and \
                (t.get("staff_key") == staff.get("key") or t.get("driver_key") == staff.get("key")):
            mine = t
    if booked is not None:
        return refusal(409, f"The {name} is booked {when_words(booked.get('start_at'), booked.get('end_at'))}"
                            " — choose another vehicle or time.")
    if mine is not None:
        other = TW.vehicle_name(vehicles, mine.get("vehicle_id") if mine.get("state") == "scheduled"
                                else mine.get("requested_vehicle_id")) or "a vehicle"
        return refusal(409, f"{staff.get('name')} already has a trip then "
                            f"({other}, {TW.span_words(mine.get('start_at'), mine.get('end_at'))}).")
    client = None
    if f["client_key"]:
        if not clients or not clients.get("readable"):
            return refusal(503, f"The client list could not be read just now ({s_((clients or {}).get('why'))}).")
        client = last(clients.get("rows") or [], "key", f["client_key"])
        if client is None:
            return refusal(400, "Choose a client from the list.")
    if CW.utf16_len(f["details"]) > 1000:
        return refusal(400, "Trip details can be at most 1000 characters.")
    warnings = []
    if pending is not None:
        warnings.append(f"Another request for the {name} is waiting for the same time — the first one approved gets it.")
    return {"ok": True, "vehicle": v, "staff": staff, "client": client, "s": s["ms"], "e": e["ms"], "warnings": warnings}


# ---- the request ----------------------------------------------------------------------------------------------------

def request(sess: L.Session, payload: dict) -> Decision:
    """vehicleCalendarRequest: refused, or the trip, the directors' My Work items and the log line kept in app.edits,
    each director's text raised through Smart Comms."""
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    g = TW.gate(sess)
    if not g.get("open"):
        return Decision(TW.closed())
    if g.get("visiting"):
        return W.refuse(403, TW.VISITING)
    form = {"vehicle_id": vtext(p.get("vehicle_id"), 20), "staff_key": vtext(p.get("staff_key"), 120),
            "start": s_(p.get("start")), "end": s_(p.get("end")), "client_key": vtext(p.get("client_key"), 120),
            "trip_type": vtext(p.get("trip_type"), 60), "details": gsjs.trim(gsjs.or_blank(p.get("details"))),
            "wheelchair_required": p.get("wheelchair_required") is True or TW.yes(p.get("wheelchair_required"))}
    no_js_own(form["vehicle_id"], form["staff_key"])
    st = TW.settings(reads)
    if not st.get("directors_readable"):
        return W.refuse(503, "Nobody is set to approve vehicle requests: " +
                        (s_(st.get("directors_why")) or "the list is empty."), fresh=TW.books(reads, TABS["settings"]))
    people = TW.people(reads)
    roster = TW.clients(reads) if form["client_key"] else None
    phone = (TR.account_phones(TR.account(reads, g.get("uid"))) or [""])[0]
    fresh = TW.books(reads, TABS["trips"], TABS["vehicles"], TABS["settings"])
    vehicles, trips = TW.tab_rows(reads, TABS["vehicles"]), TW.tab_rows(reads, TABS["trips"])
    ok = request_check(form, vehicles, trips, people, roster, st, TW.now_ms(reads))
    if ok.get("status"):
        return Decision(refusal(ok["status"], ok["message"]), fresh=fresh)
    askable = [d for d in st.get("directors") or [] if d.get("uid") != g.get("uid")]
    if not askable:
        return W.refuse(409, "Nobody else can approve this request.", fresh=fresh)
    stamp = W.now_iso(reads)
    v, staff, client = ok["vehicle"], ok["staff"], ok["client"]
    trip = {h: "" for h in TW.HEADERS["vc_trips"]}
    trip.update({
        "id": TW.new_id("VT"), "state": "requested", "vehicle_id": "", "requested_vehicle_id": v.get("id", ""),
        "start_at": TW.iso_of(ok["s"]), "end_at": TW.iso_of(ok["e"]), "day": TW.day_of(ok["s"]), "end_known": "yes",
        "wheelchair_required": TW.word(form["wheelchair_required"]), "trip_type": form["trip_type"],
        "purpose": form["trip_type"], "destination": "", "details": s_(form["details"]),
        "client_key": client["key"] if client else "", "client_name": client["name"] if client else "",
        "staff_key": staff["key"], "staff_uid": staff["uid"], "staff_name": staff["name"], "driver_key": staff["key"],
        "driver_uid": staff["uid"], "driver_name": staff["name"], "requested_by_uid": g.get("uid", ""),
        "requested_by_name": g.get("name", ""), "source": "platform", "told": "{}", "test_mode": TR.test_word(reads),
        "created_at": stamp, "created_by": g.get("uid", ""), "updated_at": stamp, "updated_by": g.get("uid", "")})
    trip_id = trip["id"]
    vname = s_(v.get("name"))
    when = when_words(trip["start_at"], trip["end_at"])
    facts = facts_of([("Requested by", g.get("name", "") + (" · " + TR.phone_words(phone) if phone else "")),
                      ("Vehicle", vname), ("When", when), ("Staff", staff["name"]), ("Client", trip["client_name"]),
                      ("Trip type", trip["trip_type"]),
                      ("Wheelchair-accessible vehicle", "Yes" if form["wheelchair_required"] else "No"),
                      ("Details", trip["details"])])
    items = [inbox_row(reads, trip, "work", "approval", "director", d, "Vehicle request — " + g.get("name", ""),
                       f"{vname} · {when} · {trip['trip_type']}", facts, "/app/my-work") for d in askable]
    vars_ = {"requester": g.get("name", ""), "requester_phone": TR.phone_words(phone) if phone else "", "vehicle": vname,
             "when": when_words(trip["start_at"], trip["end_at"], True), "staff": staff["name"],
             "client": trip["client_name"], "trip_type": trip["trip_type"],
             "wheelchair": "Yes" if form["wheelchair_required"] else "No", "details": vtext(trip["details"], 140),
             "link": link("/app/my-work")}
    W.gate(reads)
    tsid, ttab = TW.where(reads, TABS["trips"])
    inbox_where(reads)
    told: dict = {}
    results: list[tuple[str, dict]] = []
    for d in askable:
        res = say(reads, ASK, trip_id, d, dict(vars_))
        told_apply(told, "ask", d.get("uid"), res, stamp)
        results.append((s_(d.get("name")), res))
    trip["told"] = TW.json_text(told)
    edits: list[dict | None] = [TW.row_record(tsid, ttab, TW.HEADERS["vc_trips"], trip_id, trip_id, None, trip, "")]
    edits += inbox_records(reads, [(None, it) for it in items], trip_id)
    edits.append(TW.log_record(reads, TW.log_row(g, trip_id, v.get("id", ""), "request", "", {
        "state": "requested", "vehicle": vname, "start_at": trip["start_at"], "end_at": trip["end_at"]}, "", stamp),
        trip_id, ""))
    said = "Requested. " + names_words([s_(d.get("name")) for d in askable]) + \
        (" has it." if len(askable) == 1 else " have it — the first answer decides.")
    warnings = list(ok["warnings"])
    words = text_words(results)
    if words:
        warnings.append(words)
    data: dict[str, Any] = {"ok": True, "said": said, "trip_id": trip_id}
    if warnings:
        data["warnings"] = warnings
    log.info("vehicleCalendarRequest %s: %s", trip_id, ", ".join(r[1].get("state") or "?" for r in results))
    return TW.kept({"status": 200, "data": data}, edits, trip_id, fresh)


# ---- the answer: gated by the seat, never by the app -----------------------------------------------------------------

def answer(sess: L.Session, payload: dict) -> Decision:
    """vehicleCalendarAnswer (vcAnswerItem_): a director's approve or decline from My Work, My Inbox or the trip panel;
    the first answer decides, the requester's item and text follow."""
    p = payload if isinstance(payload, dict) else {}
    reads, user = sess.reads, sess.user
    item_id = vtext(p.get("item_id"), 20)
    if not ITEM_ID.match(item_id):
        return W.refuse(400, "Unknown item.")
    if TR.visiting(user):
        return W.refuse(403, OWN_ACCOUNT)
    me = TR.acting_id(user)
    if not me:
        return W.refuse(403, OWN_ACCOUNT)
    w = s_(p.get("word")).lower()
    if w not in ("approve", "decline"):
        return W.refuse(400, "Answer with approve or decline.")
    n = gsjs.trim(gsjs.or_blank(p.get("note")))
    if CW.utf16_len(n) > 500:
        return W.refuse(400, "A note can be at most 500 characters.")
    name = TR.user_name(user)
    master = sc.is_real_master(user)
    note = vtext(n, 500)
    fresh = TW.books(reads, TABS["inbox"], TABS["trips"], TABS["vehicles"])
    stamp = W.now_iso(reads)
    inbox = inbox_rows(reads)
    item = last(inbox, "id", item_id)
    if item is None or item.get("box") != "work":
        return W.refuse(404, "This request is not on the calendar any more.", fresh=fresh)
    # the master is an eligible decider on every director seat, the answer recorded as the master's
    if s_(item.get("to_uid")) != me and not (master and s_(item.get("seat")) == "director"):
        return W.refuse(403, "This one is waiting on " + (s_(item.get("to_name")) or "someone else") + ".", fresh=fresh)
    trips = TW.tab_rows(reads, TABS["trips"])
    trip = last(trips, "id", item.get("trip_id"))
    if trip is None:
        return W.refuse(404, "The request behind this item is gone.", fresh=fresh)
    if s_(trip.get("requested_by_uid")) == me:
        return W.refuse(403, "Nobody answers their own request.", fresh=fresh)
    if item.get("state") != "waiting" or trip.get("state") != "requested":
        return answered_before(reads, item, trip, stamp, fresh)
    vehicles = TW.tab_rows(reads, TABS["vehicles"])
    vname = TW.vehicle_name(vehicles, trip.get("requested_vehicle_id", "")) or "vehicle"
    when = when_words(trip.get("start_at"), trip.get("end_at"))
    t = dict(trip)
    was = {"state": trip.get("state", ""), "vehicle_id": trip.get("vehicle_id", "")}
    if w == "approve":
        block = TW.schedule_block(t, t.get("requested_vehicle_id", ""), vehicles, trips)
        if not block:
            t.update({"state": "scheduled", "vehicle_id": t.get("requested_vehicle_id", ""), "assign_note": ""})
            said = f"Approved. The trip is on the calendar with the {vname}."
            body = f"{vname} · {when}. Approved by {name}."
            result = "approved"
        else:
            t.update({"state": "needs_assignment", "vehicle_id": "",
                      "assign_note": f"Approved, but {block['phrase']} — choose a "
                                     f"{'driver' if block.get('fix') == 'driver' else 'vehicle'}."})
            said = f"Approved, but {block['phrase']} — the trip waits in Needs assignment."
            body = f"{vname} · {when}. Approved by {name}. A vehicle will be assigned."
            result = "approved - a vehicle will be assigned"
        title = "Your vehicle request was approved"
    else:
        t.update({"state": "declined", "vehicle_id": ""})
        said = "Declined." + (f" {t.get('requested_by_name')} is told." if s_(t.get("requested_by_name")) else "")
        title = "Your vehicle request was declined"
        body = f"{vname} · {when}. Declined by {name}." + (f" Note: {note}" if note else "")
        result = "declined"
    t.update({"decided_by_uid": me, "decided_by_name": name, "decided_at": stamp, "decision_note": note,
              "updated_at": stamp, "updated_by": me})
    state = "approved" if w == "approve" else "declined"
    settle = [{**item, "state": state, "answered_by": name, "answered_at": stamp, "note": note}]
    for r in inbox:
        if r.get("id") == item["id"] or r.get("trip_id") != trip["id"] or r.get("box") != "work" or \
                r.get("state") != "waiting":
            continue
        settle.append({**r, "state": "superseded", "answered_by": name, "answered_at": stamp})
    info = requester_item(reads, t, title, body)
    if info is not None:
        settle.append(info)
    W.gate(reads)
    tsid, ttab = TW.where(reads, TABS["trips"])
    inbox_where(reads)
    results: list[tuple[str, dict]] = []
    told = told_of(t.get("told"))
    cancel_asks(trip["id"])
    drop_asks(told)
    if s_(t.get("requested_by_uid")):
        to = {"uid": t.get("requested_by_uid"), "name": t.get("requested_by_name")}
        res = say(reads, DECIDED, trip["id"], to, {
            "vehicle": vname, "when": when_words(t.get("start_at"), t.get("end_at"), True), "result": result,
            "by": name, "note": note, "link": link(trip_link(trip["id"]))})
        told_apply(told, "decided", to["uid"], res, stamp)
        results.append((s_(to["name"]), res))
        t["told"] = TW.json_text(told)
    edits: list[dict | None] = [TW.row_record(tsid, ttab, TW.HEADERS["vc_trips"], trip["id"], trip["id"], trip, t, "")]
    edits += inbox_records(reads, upserts(inbox, settle), trip["id"])
    edits.append(TW.log_record(reads, TW.log_row({"uid": me, "name": name}, trip["id"],
                                                 trip.get("requested_vehicle_id", ""), "answer", was,
                                                 {"answer": state, "state": t["state"], "vehicle_id": t["vehicle_id"]},
                                                 note, stamp), trip["id"], ""))
    words = text_words(results)
    if words:
        said += " " + words
    log.info("vehicleCalendarAnswer %s %s: %s", item_id, w, ", ".join(r[1].get("state") or "?" for r in results))
    return TW.kept({"status": 200, "data": {"ok": True, "changed": True, "said": said, "state": state,
                                            "trip_state": t["state"], "trip_id": trip["id"]}}, edits, trip["id"], fresh)


def answered_before(reads: L.Reads, item: dict, trip: dict, stamp: str, fresh: tuple) -> Decision:
    """vcAnswerLocked_'s late answer: a still-waiting item closed (withdrawn) or superseded (answered), changed: false."""
    gone = item.get("state") == "closed" or trip.get("state") == "cancelled"
    now = item
    edits: list[dict | None] = []
    if item.get("state") == "waiting":
        now = {**item, "state": "closed" if gone else "superseded",
               "answered_by": s_(trip.get("requested_by_name")) if gone else s_(trip.get("decided_by_name")),
               "answered_at": stamp}
        W.gate(reads)
        edits = inbox_records(reads, [(item, now)], trip["id"])
    said = "The request was withdrawn." if gone else \
        "Already answered by " + (s_(now.get("answered_by")) or s_(trip.get("decided_by_name")) or "someone") + "."
    return TW.kept({"status": 200, "data": {"ok": True, "changed": False, "said": said, "state": now.get("state", ""),
                                            "trip_id": trip["id"]}}, edits, trip["id"], fresh)


# ---- the requester withdraws ----------------------------------------------------------------------------------------

def withdraw(sess: L.Session, payload: dict) -> Decision:
    """vehicleCalendarWithdraw: the requester takes back a request nobody answered yet; the waiting items close, the
    asks Smart Comms still owes are withdrawn; nobody is texted."""
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    g = TW.gate(sess)
    if not g.get("open"):
        return Decision(TW.closed())
    if g.get("visiting"):
        return W.refuse(403, TW.VISITING)
    trip_id = vtext(p.get("trip_id"), 20)
    if not TW.TRIP_ID.match(trip_id):
        return W.refuse(400, "Which request? The trip id is missing.")
    fresh = TW.books(reads, TABS["trips"], TABS["inbox"])
    trip = last(TW.tab_rows(reads, TABS["trips"]), "id", trip_id)
    if trip is None:
        return W.refuse(404, "That request is not on the calendar any more.", fresh=fresh)
    if not g.get("uid") or s_(trip.get("requested_by_uid")) != g.get("uid"):
        return W.refuse(403, "Only the person who asked can withdraw it.", fresh=fresh)
    if trip.get("state") != "requested":
        return W.refuse(409, f"This request is no longer waiting ({TR.trip_word(trip, TW.now_ms(reads))['word']}).",
                        fresh=fresh)
    stamp = W.now_iso(reads)
    t = {**trip, "state": "cancelled", "vehicle_id": "", "updated_at": stamp, "updated_by": g.get("uid", "")}
    told = told_of(t.get("told"))
    drop_asks(told)
    if "owed" in told:
        t["told"] = TW.json_text(told)
    inbox = inbox_rows(reads)
    closed = [(r, {**r, "state": "closed", "answered_by": g.get("name", ""), "answered_at": stamp}) for r in inbox
              if r.get("trip_id") == trip_id and r.get("box") == "work" and r.get("state") == "waiting"]
    W.gate(reads)
    tsid, ttab = TW.where(reads, TABS["trips"])
    if closed:
        inbox_where(reads)
    withdrawn = cancel_asks(trip_id)
    edits: list[dict | None] = [TW.row_record(tsid, ttab, TW.HEADERS["vc_trips"], trip_id, trip_id, trip, t, "")]
    edits += inbox_records(reads, closed, trip_id)
    edits.append(TW.log_record(reads, TW.log_row(g, trip_id, trip.get("requested_vehicle_id", ""), "withdraw",
                                                 {"state": "requested"}, {"state": "cancelled"}, "", stamp), trip_id, ""))
    log.info("vehicleCalendarWithdraw %s: %s owed ask(s) withdrawn", trip_id, withdrawn)
    return TW.kept({"status": 200, "data": {"ok": True, "said": "Withdrawn.", "trip_id": trip_id}}, edits, trip_id,
                   fresh)


# ---- TripSave's cancel of a trip someone asked for (VehicleCalendarFlows.gs, the cancelled branch) -------------------

def requester_cancelled(sess: L.Session, g: dict, t: dict, was: dict, vehicles: list[dict],
                        note: str | None) -> dict[str, Any]:
    """The requester's My Inbox item and text when their trip is cancelled, the outcome on the trip's told:
    {said, rows (for inbox_records), warnings, books}; t carries its told."""
    reads = sess.reads
    stamp = W.now_iso(reads)
    uid = s_(t.get("requested_by_uid"))
    vname = TW.vehicle_name(vehicles, was.get("vehicle_id") or t.get("requested_vehicle_id") or "") or "vehicle"
    rows: list[tuple[dict | None, dict]] = []
    info = requester_item(reads, t, "Your trip was cancelled",
                          f"{vname} · {when_words(t.get('start_at'), t.get('end_at'))}. Cancelled by {g.get('name', '')}.")
    if info is not None:
        rows = upserts(inbox_rows(reads), [info])
        inbox_where(reads)
    W.gate(reads)
    results: list[tuple[str, dict]] = []
    if uid:
        to = {"uid": t.get("requested_by_uid"), "name": t.get("requested_by_name")}
        res = say(reads, CANCELLED, t["id"], to, {
            "vehicle": vname, "when": when_words(t.get("start_at"), t.get("end_at"), True), "by": g.get("name", ""),
            "note": note or ""})
        told = told_of(t.get("told"))
        told_apply(told, "cancelled", to["uid"], res, stamp)
        t["told"] = TW.json_text(told)
        results.append((s_(to["name"]), res))
    said = "Cancelled." + (f" {t.get('requested_by_name')} is told." if s_(t.get("requested_by_name")) and uid else "")
    words = text_words(results)
    return {"said": said, "rows": rows, "warnings": [words] if words else [],
            "books": TW.books(reads, TABS["inbox"]) if rows else ()}


# ---- the doors --------------------------------------------------------------------------------------------------------

ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "vehicleCalendarRequest": request, "vehicleCalendarAnswer": answer, "vehicleCalendarWithdraw": withdraw}
_ROLES = ("admin", "director", "manager", "staff")
# HUB_POLICY: the roles each write is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "vehicleCalendarRequest": {"roles": _ROLES, "params": {
        "vehicle_id": "string", "staff_key": "string", "start": "string", "end": "string", "client_key": "string",
        "trip_type": "string", "details": "string", "wheelchair_required": "boolean"}},
    "vehicleCalendarAnswer": {"roles": _ROLES, "params": {"item_id": "string", "word": "string", "note": "string"}},
    "vehicleCalendarWithdraw": {"roles": _ROLES, "params": {"trip_id": "string"}},
}
# vcLock_'s own sentence for its own lock
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": TW.BUSY} for a in ACTIONS}
# the texts these doors raise, each under vcOwed_'s key
SITUATIONS = (ASK, DECIDED, CANCELLED)
