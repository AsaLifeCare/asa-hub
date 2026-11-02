#!/usr/bin/env python3
"""Locations' writes in Python (app/writes.py, app/main.py) over a fake asa-hub-db: every door, laid writes, the lane."""
from __future__ import annotations

import json
import sys
import time
import types
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))

import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import scope as sc  # noqa: E402
import writes as W  # noqa: E402

# the fixture's App Control row (a test double, not a grant)
LOCATIONS_APP = "locations"

FAILED: list[str] = []
PASSED = 0


def check(name: str, ok: bool, detail: Any = "") -> None:
    global PASSED
    if ok:
        PASSED += 1
    else:
        FAILED.append(f"{name} — {str(detail)[:600]}")


NOW = datetime(2026, 10, 8, 15, 0, tzinfo=timezone.utc)
SYNCED = "2026-10-08T14:58:00+00:00"
HUB, CARE, ENT, SUP, UI, REP, CAL = "BOOK_HUB", "BOOK_CARE", "BOOK_ENT", "BOOK_SUP", "BOOK_UI", "BOOK_REP", "BOOK_CAL"
EDITIONS = [{"id": "locations.house", "on": True, "people": ["u-ann"]},
            {"id": "locations.notesAny", "on": False, "people": ["u-ann"]},
            {"id": "locations.staffRemove", "on": True, "people": ["u-ann"]},
            {"id": "locations.incidents", "on": True, "people": ["u-ann"]},
            {"id": "locations.clientsAdd", "on": True, "people": ["u-ann"]}]
NOTE_ROW = {"id": "HN_1", "house": "ABD2704", "client_key": "", "priority": "normal", "details": "Fix the door",
            "state": "open", "by": "Ann Lee", "at": "2026-10-01T10:00:00.000Z", "state_by": "", "state_at": ""}
INC_HEAD = ["Timestamp", "Your Name:", "Client Name", "Incident Category", "Incident Location", "Incident Date",
            "Incident Time", "Summary of Incident"]
REP_HEAD = ["Timestamp", "Select Address/Vehicle", "Repair Type", "Urgency Level (1-Low : 5-High)",
            "Please describe the issue", "Status", "Resolution Notes"]


def world(over: dict | None = None) -> dict[tuple[str, str], tuple[list[str], list[dict]]]:
    """(book, tab) -> (headers, rows): the books Locations' doors read."""
    w: dict[tuple[str, str], tuple[list[str], list[dict]]] = {
        (HUB, "users"): (["userId", "email", "displayName", "role", "types", "appDenials", "homeTenant", "clientKey",
                          "mergedInto"],
                         [{"userId": "u-boss", "email": "asatech@asalifecare.com", "displayName": "Asa Tech",
                           "role": "admin"},
                          {"userId": "u-ann", "email": "ann@example.org", "displayName": "Ann Lee", "role": "staff",
                           "types": "STAFF"},
                          {"userId": "u-bob", "email": "bob@example.org", "displayName": "Bob Ray", "role": "staff",
                           "types": "STAFF"},
                          {"userId": "u-kay", "email": "kay@example.org", "displayName": "Kenny Marsh",
                           "role": "client", "types": "CLIENT", "clientKey": "kmarsh"}]),
        (HUB, "app_badge_access"): (["appId", "badges"], [{"appId": LOCATIONS_APP, "badges": "STAFF, CLIENT"}]),
        (HUB, "clients"): (["client_key", "name", "house", "status", "home_address"],
                           [{"client_key": "kmarsh", "name": "Kenny Marsh", "house": "ABD2704", "status": "Active"},
                            {"client_key": "jdoe", "name": "Jane Doe", "house": "ABD2704", "status": "Active"},
                            {"client_key": "zz", "name": "Zed Zane", "status": "Active",
                             "home_address": "5 Far Rd, Akron"},
                            {"client_key": "old", "name": "Olive Old", "status": "Inactive"},
                            {"client_key": "other", "name": "Otto Other", "house": "ABD9999", "status": "Active"}]),
        (HUB, "smart_comms"): (["id", "enabled", "kind"], [{"id": W.GATE_ID, "enabled": "no", "kind": "gate"}]),
        (ENT, "house_staff_off"): (list(W.STAFF_OFF_HEADER),
                                   [{"id": "HS_1", "house": "ABD2704", "staff_key": "carlcook", "name": "Carl Cook",
                                     "state": "off", "by": "Ann Lee", "at": "2026-10-03T10:00:00.000Z"}]),
        (ENT, "entity_homes"): (["abbreviation", "home_name", "address", "region", "telephone", "manager_name",
                                 "manager_phone", "calendar_link", "thumbnail_url"],
                                [{"abbreviation": "ABD2704", "home_name": "CAN - JH - ABD2704",
                                  "address": "12 Elm St NW, Canton", "region": "Canton"},
                                 {"abbreviation": "ABD9999", "home_name": "CAN - X - ABD9999",
                                  "address": "99 Oak St, Canton", "region": "Canton"}]),
        (CARE, "house_notes"): (list(W.NOTES_HEADER),
                                [NOTE_ROW, {**NOTE_ROW, "id": "HN_2", "by": "Bob Ray", "priority": "high",
                                            "details": "Bob's note"},
                                 {**NOTE_ROW, "id": "HN_9", "house": "ABD9999", "details": "Elsewhere"}]),
        (SUP, "houseSupplies"): (list(W.SUPPLY_HEADER),
                                 [{"id": "LS_d", "house": "ABD2704", "item": "Gloves", "qty": "40", "kind": "delivery",
                                   "category": "Care", "on_hand_after": "50", "at": "2026-10-01T00:00:00.000Z",
                                   "by": "Ann Lee"},
                                  {"id": "LS_c", "house": "ABD2704", "item": "Gloves", "qty": "30", "kind": "count",
                                   "at": "2026-10-04T00:00:00.000Z", "by": "Ann Lee"}]),
        (UI, "UIs and MUIs"): (INC_HEAD,
                               [{"Timestamp": "10/2/2026 9:00:00", "Your Name:": "Ann Lee", "Client Name": "Kenny Marsh",
                                 "Incident Category": "Fall", "Summary of Incident": "Slipped"},
                                {"Timestamp": "10/3/2026 9:00:00", "Your Name:": "Bob Ray", "Client Name": "Otto Other",
                                 "Incident Category": "Fall"},
                                {},
                                {"Timestamp": "10/4/2026 9:00:00", "Your Name:": "Ann Lee", "Client Name": "Jane Doe",
                                 "Incident Category": "Med"}]),
        (REP, "Repairs"): (REP_HEAD,
                           [{"Timestamp": "10/2/2026 9:00:00", "Select Address/Vehicle": "12 Elm St NW, Canton",
                             "Repair Type": "Plumbing", "Status": "Open"},
                            {"Timestamp": "10/3/2026 9:00:00", "Select Address/Vehicle": "99 Oak St, Canton",
                             "Repair Type": "Roof", "Status": "Open"}]),
        (CAL, "Calendar Archive"): (["Location", "Employee", "Designation", "Phone", "Date"],
                                    [{"Location": "CAN - JH - ABD2704", "Employee": "Ann Lee", "Date": "10/01/2026"},
                                     {"Location": "CAN - JH - ABD2704", "Employee": "Carl Cook", "Date": "10/02/2026"},
                                     {"Location": "CAN - JH - ABD2704", "Employee": "Mia Manager", "Designation": "**",
                                      "Phone": "330-555-0101", "Date": "10/01/2026"}]),
    }
    w.update(over or {})
    return w


def facts(editions: list | None = None, moved: str = "yes") -> list[tuple[str, str, str]]:
    props = {"HUB_DB_ID": HUB, "HUB_CARE_BOOK_ID": CARE, "HUB_CLIENT_ENTITIES_SHEET_ID": ENT, "ESTATE_UI_ID": UI,
             "ESTATE_REPAIRS_ID": REP, "HOTLINE_CALENDAR_ID": CAL, "HUB_HOUSE_HOUSESUPPLIES_ID": SUP}
    out = [(k, v, f"switchboard:props.{k}") for k, v in props.items()]
    out.append(("houseSupplies", moved, "switchboard:moved.houseSupplies"))
    out.append(("mywork_editions", json.dumps(EDITIONS if editions is None else editions),
                "dissolution:hiring_alerts_config.value"))
    return out


class FakeCursor:
    def __init__(self, rows: list[tuple]) -> None:
        self.rows = rows

    def fetchall(self) -> list[tuple]:
        return list(self.rows)

    def fetchone(self) -> tuple | None:
        return self.rows[0] if self.rows else None


class FakeConn:
    """asa-hub-db as hubdb.HubDb asks it: the catalog, one table per tab, the depot's facts."""
    closed = False
    broken = False

    def __init__(self, books: dict, fact_rows: list, stale: tuple = ()) -> None:
        self.tables: dict[str, tuple[str, str, list[str], list[dict]]] = {}
        for i, ((sid, tab), (heads, rows)) in enumerate(books.items()):
            self.tables[f"t_{i}"] = (sid, tab, heads, rows)
        self.tables["t_facts"] = (hubdb.ESSENCIAL_ID, hubdb.FACTS_TAB, ["subject_id", "value", "source"], [])
        self.facts = fact_rows
        self.sids = {sid for sid, _t, _h, _r in self.tables.values()}
        self.stale = set(stale)

    def execute(self, sql: str, params: Any = None) -> FakeCursor:
        if "from catalog.tabs" in sql:
            return FakeCursor([(sid, tab, name, [[h, h] for h in heads], len(rows), SYNCED, None)
                               for name, (sid, tab, heads, rows) in self.tables.items() if rows or tab == "Facts"])
        if "from catalog.books" in sql:
            return FakeCursor([(sid, sid, "2026-10-08T15:30:00+00:00" if sid in self.stale else "2026-10-08T14:00:00+00:00",
                                SYNCED, "ok", None) for sid in self.sids])
        if "subject_id" in sql:
            return FakeCursor([(i + 2, s, v, src) for i, (s, v, src) in enumerate(self.facts)])
        name = sql.split('sheets."')[1].split('"')[0]
        _sid, _tab, heads, rows = self.tables[name]
        return FakeCursor([(i + 2, {h: r.get(h, "") for h in heads}) for i, r in enumerate(rows)])


def db_of(books: dict | None = None, fact_rows: list | None = None, stale: tuple = ()) -> hubdb.HubDb:
    conn = FakeConn(books if books is not None else world(), fact_rows if fact_rows is not None else facts(), stale)
    return hubdb.HubDb(dsn="fake", connect=lambda: conn)


def user(db: hubdb.HubDb, uid: str) -> dict:
    reads = L.Reads(db, None, now=NOW)
    row = next(u for u in reads.users() if gsjs.str_(u.get("userid")) == uid)
    return sc.user_from_row(row)


def decide(action: str, payload: dict, uid: str = "u-boss", db: hubdb.HubDb | None = None,
           own: W.Own | None = None) -> W.Decision:
    db = db or db_of()
    token = hubdb.OWN.set(own)
    try:
        reads = L.Reads(db, None, now=NOW)
        return W.ACTIONS[action](L.Session(reads, user(db, uid)), payload)
    finally:
        hubdb.OWN.reset(token)


def deferred(fn: Any) -> str:
    try:
        fn()
    except (sc.Defer, hubdb.Unreadable) as exc:
        return str(exc) or type(exc).__name__
    return ""


UNKNOWN = {"status": 404, "message": "Unknown action."}


def doors() -> None:
    """The edit door: the master anywhere, an edition holder past the read door, never a client, never a key off."""
    payload = {"house": "ABD2704", "details": "Water heater", "priority": "high"}
    got = decide("locationNoteAdd", payload)
    check("the master files a note at any house", got.answer["status"] == 200 and got.lay is not None, got.answer)
    got = decide("locationNoteAdd", payload, "u-ann")
    check("a person the edition names files one too", got.answer["status"] == 200 and got.record is not None, got.answer)
    check("…someone the edition does not name is told the action does not exist",
          decide("locationNoteAdd", payload, "u-bob").answer == UNKNOWN)
    check("…and so is a client, whatever any list says", decide("locationNoteAdd", payload, "u-kay").answer == UNKNOWN)
    off = db_of(fact_rows=facts([{**e, "on": False} if e["id"] == "locations.house" else e for e in EDITIONS]))
    check("an edition whose key is off opens nothing for its people",
          decide("locationNoteAdd", payload, "u-ann", off).answer == UNKNOWN)
    got = decide("locationNoteAdd", {**payload, "house": "ZZ1234"})
    check("a house no registry row or client carries is 404, a verdict on the copy",
          got.answer["status"] == 404 and got.fresh is True and "ZZ1234" in got.answer["message"], got.answer)
    check("a malformed house is 400", decide("locationNoteAdd", {**payload, "house": "nope"}).answer["status"] == 400)
    armed = db_of(world({(HUB, "smart_comms"): (["id", "enabled"], [{"id": W.GATE_ID, "enabled": "Yes"}])}))
    check("while the book-write funnel is armed Apps Script answers (it holds, says and logs it)",
          "armed" in deferred(lambda: decide("locationNoteAdd", payload, db=armed)))
    check("the policy: these writes are for admin, manager or staff",
          W.POLICY["locationNoteAdd"]["roles"] == ("admin", "manager", "staff")
          and W.POLICY["locationHouseSave"]["params"]["changes"] == "array")


def notes() -> None:
    base = {"house": "ABD2704", "details": "  Water heater  ", "priority": "HIGH", "client_key": "kmarsh"}
    got = decide("locationNoteAdd", base, "u-ann")
    note = got.answer["data"]["note"]
    check("a new note: trimmed, priority folded, filed by the session, the client's name beside it",
          note["details"] == "Water heater" and note["priority"] == "high" and note["by"] == "Ann Lee"
          and note["client_name"] == "Kenny Marsh" and note["state"] == "open" and note["id"].startswith("HN_")
          and note["at"] == "2026-10-08T15:00:00.000Z", note)
    check("…its steps name the sheet as Apps Script's do",
          got.answer["data"]["steps"][0]["words"] == "A new row on house_notes." and got.answer["data"]["app"] == "locations")
    check("…the relay lays the row and delivers the payload under the same minted id",
          got.lay["kind"] == "append" and got.lay["key"] == note["id"] == got.deliver["id"]
          and got.lay["row"]["client_name"] == "Kenny Marsh")
    check("…and the copy is laid with the row as the sheet will hold it",
          got.record["tab_name"] == "house_notes" and got.record["sheet_id"] == CARE
          and got.record["cells"]["details"] == "Water heater" and "client_name" not in got.record["cells"])
    mint = "HN_" + str(uuid.uuid4())
    check("a relay-minted id is kept", decide("locationNoteAdd", {**base, "id": mint}).lay["key"] == mint)
    check("an id that is not the relay's is not", decide("locationNoteAdd", {**base, "id": "HN_x"}).lay["key"] != "HN_x")
    had = db_of(world({(CARE, "house_notes"): (list(W.NOTES_HEADER), [{**NOTE_ROW, "id": mint}])}))
    got = decide("locationNoteAdd", {**base, "id": mint}, db=had)
    check("an id the sheet already holds landed before: already, nothing laid",
          got.answer["data"].get("already") is True and got.lay is None and "steps" not in got.answer["data"], got.answer)
    for bad, words in (({"details": " "}, "details: what the note says."),
                       ({"priority": "soon"}, "priority: one of low, normal, high, urgent."),
                       ({"client_key": "other"}, "client_key: not a current client of ABD2704.")):
        got = decide("locationNoteAdd", {**base, **bad})
        check(f"a note refused: {words}", got.answer == {"status": 400, "message": words} and got.lay is None, got.answer)

    got = decide("locationNoteState", {"id": "HN_1", "state": "Resolved"})
    check("the master resolves a note with no house sent: the row's own house",
          got.answer["status"] == 200 and got.answer["data"]["note"]["house"] == "ABD2704"
          and got.lay["fields"]["state"] == "resolved" and got.lay["prior"]["state"] == "open", got.answer)
    got = decide("locationNoteState", {"id": "HN_1", "state": "resolved", "house": "ABD9999"})
    check("a state change whose house is not the row's: moved, 409",
          got.answer == {"status": 409, "message": "That note has moved since it was opened — reload the house."}
          and got.fresh == (CARE,), got.answer)
    check("…an unknown note is 404", decide("locationNoteState", {"id": "HN_x", "state": "open"}).answer
          == {"status": 404, "message": 'No house note "HN_x".'})
    check("…a state that is not open or resolved is 400",
          decide("locationNoteState", {"id": "HN_1", "state": "removed"}).answer["status"] == 400)
    check("…a person with no edition is refused before anything is read",
          decide("locationNoteState", {"id": "HN_1", "state": "open", "house": "ABD2704"}, "u-bob").answer == UNKNOWN)

    edit = {"house": "ABD2704", "id": "HN_1", "changes": [
        {"field": "details", "value": "Fixed door", "expected": "Fix the door"},
        {"field": "priority", "value": "URGENT", "expected": "Normal"}]}
    got = decide("locationNoteEdit", edit, "u-ann")
    check("its author edits a note: details and priority (folded), written",
          got.answer["status"] == 200 and got.answer["data"]["written"] == ["details", "priority"]
          and got.lay["fields"] == {"details": "Fixed door", "priority": "urgent"}, got.answer)
    got = decide("locationNoteEdit", {**edit, "id": "HN_2"}, "u-ann")
    check("somebody else's note is not hers to edit (403)", got.answer["status"] == 403 and got.lay is None, got.answer)
    anyone = db_of(fact_rows=facts([{**e, "on": True} if e["id"] == "locations.notesAny" else e for e in EDITIONS]))
    got = decide("locationNoteEdit", {**edit, "id": "HN_2", "changes": [
        {"field": "state", "value": "removed", "expected": "open"}]}, "u-ann", anyone)
    check("…with the any-note edition on, she removes it; who and when ride along",
          got.answer["status"] == 200 and got.lay["fields"]["state"] == "removed"
          and got.lay["fields"]["state_by"] == "Ann Lee" and got.record["cells"]["state_at"] == "2026-10-08T15:00:00.000Z",
          got.lay)
    got = decide("locationNoteEdit", {**edit, "changes": [
        {"field": "details", "value": "x", "expected": "Fix the door"},
        {"field": "priority", "value": "low", "expected": "high"}]}, "u-ann")
    check("a stale witness: 409 carrying what the row holds, the others written",
          got.answer["status"] == 409 and got.answer["data"]["current"] == {"priority": "normal"}
          and got.answer["data"]["written"] == ["details"] and got.lay["fields"] == {"details": "x"}
          and got.deliver["changes"] == [{"field": "details", "value": "x", "expected": "Fix the door"}]
          and got.fresh == (CARE,)
          and got.answer["message"] == "Some fields changed since the panel was opened — reloaded; the others were saved.",
          got.answer)
    got = decide("locationNoteEdit", {**edit, "changes": [{"field": "priority", "value": "low", "expected": "high"}]},
                 "u-ann")
    check("…every witness stale: nothing written, nothing laid",
          got.answer["status"] == 409 and got.lay is None
          and got.answer["message"] == "Changed since the panel was opened — reloaded, nothing was written.")
    got = decide("locationNoteEdit", {**edit, "changes": [
        {"field": "client_key", "value": "jdoe", "expected": ""}, {"field": "by", "value": "x", "expected": "Ann Lee"},
        {"field": "details", "value": "", "expected": "Fix the door"}]}, "u-ann")
    check("a client set (its name laid beside it), a column the note has not, and an emptied note refused",
          got.answer["data"]["written"] == ["client_key"] and got.lay["fields"]["client_name"] == "Jane Doe"
          and [r["field"] for r in got.answer["data"]["refused"]] == ["by", "details"], got.answer)
    check("a note at another house is 'moved' at this one",
          decide("locationNoteEdit", {**edit, "id": "HN_9"}).answer["status"] == 409)
    check("malformed changes are 400 in the door's words",
          decide("locationNoteEdit", {**edit, "changes": [{"field": "A"}]}).answer
          == {"status": 400, "message": "changes: a field name is malformed."}
          and decide("locationNoteEdit", {**edit, "changes": []}).answer["status"] == 400)


def supplies_and_house() -> None:
    entry = {"house": "ABD2704", "item": "Gloves", "kind": "Delivery", "qty": "20", "on_hand_after": 45,
             "category": "Care"}
    got = decide("locationSupplyEntry", entry, "u-ann")
    rec = got.answer["data"]["entry"]
    check("a delivery: numbers kept as numbers, the count after it beside it",
          got.answer["status"] == 200 and rec["qty"] == 20 and rec["on_hand_after"] == 45 and rec["kind"] == "delivery"
          and rec["id"].startswith("LS_") and got.record["cells"]["qty"] == "20", rec)
    for bad, words in (({"qty": "-1"}, "qty: a number, zero or more."), ({"kind": "gift"}, "kind: one of count, delivery, par."),
                       ({"item": ""}, "item: what is counted or delivered."),
                       ({"on_hand_after": "lots"}, "on_hand_after: a number, zero or more.")):
        check(f"a supplies line refused: {words}",
              decide("locationSupplyEntry", {**entry, **bad}).answer == {"status": 400, "message": words})
    undeclared = db_of(fact_rows=facts(moved="no"))
    check("no supplies house declared: 503 in the door's words",
          decide("locationSupplyEntry", entry, db=undeclared).answer["status"] == 503)
    got = decide("locationSupplyEdit", {"house": "ABD2704", "id": "LS_c", "changes": [
        {"field": "qty", "value": "28", "expected": "30"}, {"field": "kind", "value": "par", "expected": "count"}]},
        "u-ann")
    check("a count corrected; its kind stays as recorded",
          got.answer["data"]["written"] == ["qty"] and got.lay["fields"] == {"qty": 28.0}
          and got.answer["data"]["refused"][0]["why"] == "An entry's item, kind and time stay as recorded.", got.answer)
    got = decide("locationSupplyEdit", {"house": "ABD2704", "id": "LS_c", "changes": [
        {"field": "qty", "value": "28", "expected": "31"}]}, "u-ann")
    check("…against a stale count: 409 with what the ledger holds",
          got.answer["status"] == 409 and got.answer["data"]["current"] == {"qty": "30"})

    save = {"house": "ABD2704", "home_name": "CAN - JH - ABD2704", "changes": [
        {"field": "telephone", "value": "330.555.0199", "expected": ""},
        {"field": "abbreviation", "value": "ABD2705", "expected": "ABD2704"},
        {"field": "calendar_link", "value": "http://cal", "expected": ""},
        {"field": "manager_phone", "value": "555", "expected": ""}]}
    got = decide("locationHouseSave", save, "u-ann")
    check("the house row: a phone written as (330) 555-0199; the code, an http link and a short phone refused",
          got.answer["data"]["written"] == ["telephone"] and got.lay["fields"] == {"telephone": "(330) 555-0199"}
          and [r["field"] for r in got.answer["data"]["refused"]] == ["abbreviation", "calendar_link", "manager_phone"]
          and got.answer["data"]["slices"] == [] and got.answer["data"]["mirror"] == ["houses"]
          and got.record["match"] == "code", got.answer)
    got = decide("locationHouseSave", {**save, "home_name": "Old name"}, "u-ann")
    check("a house row opened on another name has changed: 409",
          got.answer == {"status": 409, "message": "That house row has changed since it was opened — reload the house."})
    got = decide("locationHouseSave", {**save, "changes": [{"field": "region", "value": "Akron", "expected": "Kent"}]})
    check("a stale region: 409 with the registry's", got.answer["data"]["current"] == {"region": "Canton"})
    check("no home_name sent is 400", decide("locationHouseSave", {"house": "ABD2704", "changes": []}).answer
          == {"status": 400, "message": "home_name: the house name the panel was opened on."})


def estate() -> None:
    edit = {"house": "ABD2704", "id": "r2", "changes": [
        {"field": "incident_category", "value": "Fall, Injury", "expected": "Fall"}]}
    got = decide("locationIncidentEdit", edit, "u-ann")
    check("an incident of the house's client edited by an incidents edition holder",
          got.answer["status"] == 200 and got.lay["key"] == "r2" and got.record["keyed"] == "estate"
          and got.answer["data"]["slices"] == ["uiIncidents"], got.answer)
    check("…an incident of another house's client has moved",
          decide("locationIncidentEdit", {**edit, "id": "r3"}).answer["status"] == 409)
    check("…a blank row inside the sheet has moved; one past its end is 404",
          decide("locationIncidentEdit", {**edit, "id": "r4"}).answer["status"] == 409
          and decide("locationIncidentEdit", {**edit, "id": "r99"}).answer
          == {"status": 404, "message": 'No row "r99" in uiIncidents.'})
    check("…a row id that is not r<n> is 400",
          decide("locationIncidentEdit", {**edit, "id": "7"}).answer == {"status": 400, "message": 'id: a row id like "r42".'})
    got = decide("locationIncidentEdit", {**edit, "changes": [{"field": "incident_category", "value": "x",
                                                               "expected": "Burn"}]})
    check("…a stale category: 409 carrying the sheet's", got.answer["data"]["current"] == {"incident_category": "Fall"})
    got = decide("locationIncidentEdit", {**edit, "changes": [{"field": "client_name", "value": "Jane Doe",
                                                               "expected": "Kenny Marsh"}]})
    check("…moving it to another current client is Apps Script's to write (no overlay lays it)", got.engine is True)
    got = decide("locationIncidentEdit", {**edit, "changes": [{"field": "client_name", "value": "Otto Other",
                                                               "expected": "Kenny Marsh"}]})
    check("…to someone not a client here is refused",
          got.answer["data"]["refused"] == [{"field": "client_name", "why": "Not a current client of ABD2704."}])
    no_incidents = db_of(fact_rows=facts([e for e in EDITIONS if e["id"] != "locations.incidents"]))
    check("…without the incidents edition: Unknown action", decide("locationIncidentEdit", edit, "u-ann",
                                                                    no_incidents).answer == UNKNOWN)
    rep = {"house": "ABD2704", "id": "r2", "changes": [{"field": "status", "value": "Completed", "expected": "Open"}]}
    got = decide("locationRepairEdit", rep, "u-ann")
    check("a repair on the house's street completed", got.answer["status"] == 200 and got.lay["fields"] == {"status": "Completed"})
    check("…one on another street has moved", decide("locationRepairEdit", {**rep, "id": "r3"}).answer["status"] == 409)


def handed_on() -> None:
    got = decide("locationStaffRemove", {"house": "ABD2704", "staff": "Ann Lee"}, "u-ann")
    check("taking someone off the Staff list: decided, written by Apps Script, its row laid once it answers",
          got.engine is True and got.record["cells"]["state"] == "off" and got.record["cells"]["staff_key"] == "annlee"
          and got.answer["data"]["staff"] == {"key": "annlee", "name": "Ann Lee", "state": "off"}, got.answer)
    check("…nobody of that name is listed: 404", decide("locationStaffRemove", {"house": "ABD2704", "staff": "Nobody"}).answer
          == {"status": 404, "message": "Nobody is not on ABD2704's Staff list."})
    got = decide("locationStaffRemove", {"house": "ABD2704", "staff": "Carl Cook", "back": True})
    check("…someone taken off is put back", got.engine is True and got.record["cells"]["state"] == "back", got.answer)
    check("…put back someone never taken off: 404",
          decide("locationStaffRemove", {"house": "ABD2704", "staff": "Ann Lee", "back": True}).answer["status"] == 404)
    off = db_of(fact_rows=facts([e for e in EDITIONS if e["id"] != "locations.staffRemove"]))
    check("…its own edition off: Unknown action",
          decide("locationStaffRemove", {"house": "ABD2704", "staff": "Ann Lee"}, "u-ann", off).answer == UNKNOWN)

    add = {"house": "ABD2704", "clients": ["zz"]}
    check("a client of no house is added through the client's own record (Apps Script)",
          decide("locationClientsAdd", add, "u-ann").engine is True)
    got = decide("locationClientsAdd", {"house": "ABD2704", "clients": ["kmarsh", "old", "other", "nope", "kmarsh"]},
                 "u-ann")
    check("clients already here, inactive, at another house or unknown: 409, each said, nothing written",
          got.answer["status"] == 409 and [r["client_key"] for r in got.answer["data"]["refused"]]
          == ["kmarsh", "old", "other", "nope"]
          and got.answer["message"] == "Kenny Marsh is already a client of ABD2704. Nothing was written."
          and got.answer["data"]["refused"][2]["why"].startswith("Otto Other is a current client of ABD9999"), got.answer)
    check("taking a client off is never this door's",
          decide("locationClientsAdd", {**add, "remove": ["kmarsh"]}).answer["status"] == 400)
    check("more than 20 at once is 400",
          decide("locationClientsAdd", {**add, "clients": [str(i) for i in range(21)]}).answer["status"] == 400)

    got = decide("locationIncidentFile", {"house": "ABD2704", "row": {"client_name": "kenny marsh",
                                                                      "incident_category": "Fall"}}, "u-ann")
    check("an incident filed for a client of the house: the estate's create (Apps Script) files it", got.engine is True)
    check("…for someone not a client here: 400",
          decide("locationIncidentFile", {"house": "ABD2704", "row": {"client_name": "Otto Other",
                                                                      "incident_category": "Fall"}}).answer
          == {"status": 400, "message": "client_name: one of ABD2704's current clients."})
    check("…with no category: 400",
          decide("locationIncidentFile", {"house": "ABD2704", "row": {"client_name": "Kenny Marsh"}}).answer
          == {"status": 400, "message": "incident_category: what kind of incident."})
    got = decide("locationRepairFile", {"house": "ABD2704", "row": {"select_address_vehicle": "12 Elm St NW",
                                                                    "repair_type": "Leak"}})
    check("a repair filed from the house's own street goes to the estate's create", got.engine is True)
    check("…from another house's street: 400",
          decide("locationRepairFile", {"house": "ABD2704", "row": {"select_address_vehicle": "99 Oak St",
                                                                    "repair_type": "Leak"}}).answer["status"] == 400)


def own_writes() -> None:
    """A write Python accepted is in Python's next read at once, and leaves when the copy holds it."""
    db = db_of()
    got = decide("locationNoteAdd", {"house": "ABD2704", "details": "New one"}, db=db)
    rec = {**got.record, "write_id": "Wnote1", "state": "accepted", "accepted_at": NOW.timestamp(), "written_at": 0.0,
           "action": "locationNoteAdd"}
    own = W.Own([rec], book=db.book, now=NOW.timestamp())
    token = hubdb.OWN.set(own)
    try:
        reads = L.Reads(db, None, now=NOW)
        ctx = L.house(reads, "ABD2704")
        part = L.notes_part(reads, ctx)
    finally:
        hubdb.OWN.reset(token)
    check("the new note is in the house's notes, and the answer names the write it holds",
          any(n["id"] == got.lay["key"] and n["details"] == "New one" for n in part["notes"]) and own.held == {"Wnote1"},
          part["notes"])
    edit = decide("locationNoteEdit", {"house": "ABD2704", "id": "HN_1", "changes": [
        {"field": "details", "value": "Fixed", "expected": "Fix the door"}]}, db=db)
    rec2 = {**edit.record, "write_id": "Wedit1", "state": "queued", "accepted_at": NOW.timestamp(), "written_at": 0.0,
            "action": "locationNoteEdit"}
    again = decide("locationNoteEdit", {"house": "ABD2704", "id": "HN_1", "changes": [
        {"field": "details", "value": "Fixed twice", "expected": "Fix the door"}]}, db=db,
        own=W.Own([rec2], book=db.book, now=NOW.timestamp()))
    check("a second edit against the first one's witness sees the first: stale, 409",
          again.answer["status"] == 409 and again.answer["data"]["current"] == {"details": "Fixed"}, again.answer)
    later = NOW.timestamp() + 7200
    stale_own = W.Own([{**rec2, "state": "written", "written_at": NOW.timestamp() - 7200}], book=db.book, now=later)
    token = hubdb.OWN.set(stale_own)
    try:
        notes = L.notes_part(L.Reads(db, None, now=NOW), ctx)["notes"]
    finally:
        hubdb.OWN.reset(token)
    check("a written edit no copy confirmed in an hour leaves the reads, marked retired",
          next(n for n in notes if n["id"] == "HN_1")["details"] == "Fix the door" and stale_own.done == {"Wedit1": "retired"})
    shown = W.Own([{**rec2, "cells": {"details": "Fix the door"}, "state": "written", "written_at": NOW.timestamp()}],
                  book=db.book, now=NOW.timestamp())
    token = hubdb.OWN.set(shown)
    try:
        L.notes_part(L.Reads(db, None, now=NOW), ctx)
    finally:
        hubdb.OWN.reset(token)
    check("a written edit the copy already shows is retired, and still named as held",
          shown.done == {"Wedit1": "retired"} and shown.held == {"Wedit1"})
    unbound = W.Own([{**rec, "accepted_at": NOW.timestamp() - 600}], book=db.book, now=NOW.timestamp())
    token = hubdb.OWN.set(unbound)
    try:
        L.notes_part(L.Reads(db, None, now=NOW), ctx)
    finally:
        hubdb.OWN.reset(token)
    check("an accepted write never queued in two minutes is dropped", unbound.done == {"Wnote1": "refused"})
    sav = decide("locationHouseSave", {"house": "ABD2704", "home_name": "CAN - JH - ABD2704", "changes": [
        {"field": "telephone", "value": "3305550199", "expected": ""}]}, db=db)
    rec3 = {**sav.record, "write_id": "Whouse", "state": "queued", "accepted_at": NOW.timestamp(), "written_at": 0.0}
    inc = decide("locationIncidentEdit", {"house": "ABD2704", "id": "r2", "changes": [
        {"field": "summary_of_incident", "value": "Slipped on ice", "expected": "Slipped"}]}, db=db)
    rec4 = {**inc.record, "write_id": "Winc", "state": "queued", "accepted_at": NOW.timestamp(), "written_at": 0.0}
    sup = decide("locationSupplyEntry", {"house": "ABD2704", "item": "Gloves", "kind": "count", "qty": 10}, db=db)
    rec5 = {**sup.record, "write_id": "Wsup", "state": "queued", "accepted_at": NOW.timestamp(), "written_at": 0.0}
    many = W.Own([rec3, rec4, rec5], book=db.book, now=NOW.timestamp())
    token = hubdb.OWN.set(many)
    try:
        reads = L.Reads(db, None, now=NOW)
        ctx = L.house(reads, "ABD2704")
        over = L.overview_part(reads, ctx)
        r2 = next(r for r in L.incidents_part(reads, ctx)["rows"] if r["id"] == "r2")
        gloves = next(c for c in L.supplies_part(reads, ctx)["consumables"] if c["item"] == "Gloves")
    finally:
        hubdb.OWN.reset(token)
    check("the registry's new phone, an incident's new summary and a new count are read back at once",
          over["house"]["phone"] == "(330) 555-0199" and r2["row"]["summary_of_incident"] == "Slipped on ice"
          and gloves["in_stock"] == 10 and many.held == {"Whouse", "Winc", "Wsup"}, [over["house"], r2["row"], gloves])


class FakeTx:
    def __init__(self, store: "FakeStore") -> None:
        self.store = store

    def receipt(self, write_id: str) -> dict | None:
        return self.store.receipts.get(write_id)

    def live(self) -> list[dict]:
        return [dict(w) for w in self.store.writes.values()]

    def edits(self) -> list[dict]:
        return []

    def record(self, write_id: str, action: str, env: dict, decision: W.Decision, author: str) -> None:
        self.store.receipts.setdefault(write_id, json.loads(json.dumps(env)))
        if decision.record is not None:
            self.store.writes[write_id] = {**decision.record, "write_id": write_id, "action": action,
                                           "state": "decided" if decision.engine else "accepted",
                                           "accepted_at": time.time(), "written_at": 0.0}


class FakeStore:
    available = True
    why = ""

    def __init__(self) -> None:
        self.receipts: dict[str, dict] = {}
        self.writes: dict[str, dict] = {}
        self.busy = False

    def ready(self) -> bool:
        return True

    def live(self) -> list[dict]:
        return [dict(w) for w in self.writes.values()]

    def edits(self) -> list[dict]:
        return []

    def finish(self, done: dict) -> None:
        for w, s in done.items():
            self.writes[w]["state"] = s

    def locked(self):  # noqa: ANN201
        store = self

        class Ctx:
            def __enter__(self) -> FakeTx:
                if store.busy:
                    raise W.Busy()
                return FakeTx(store)

            def __exit__(self, *exc: Any) -> bool:
                return False
        return Ctx()


def main_lane() -> None:
    """app/main.py's write lane, its web framework stood in: the receipt kept once, a replay, busy, a stale verdict."""
    fake = types.ModuleType("fastapi")

    class Resp:
        def __init__(self, content: Any = b"", status_code: int = 200, media_type: str = "", headers: dict | None = None):
            self.body = content if isinstance(content, (bytes, str)) else json.dumps(content)
            self.status_code, self.headers = status_code, dict(headers or {})

    class App:
        def __init__(self, **_kw: Any) -> None:
            pass

        def _route(self, *_a: Any, **_kw: Any):  # noqa: ANN202
            return lambda fn: fn
        get = post = _route

    fake.FastAPI, fake.Request = App, object
    responses = types.ModuleType("fastapi.responses")
    responses.JSONResponse = lambda content, status_code=200, headers=None: Resp(content, status_code, "", headers)
    responses.Response = Resp
    conc = types.ModuleType("starlette.concurrency")

    async def run_in_threadpool(fn, *a, **kw):  # noqa: ANN001, ANN002, ANN003, ANN202
        return fn(*a, **kw)
    conc.run_in_threadpool = run_in_threadpool
    sys.modules.update({"fastapi": fake, "fastapi.responses": responses, "starlette": types.ModuleType("starlette"),
                        "starlette.concurrency": conc})
    import main  # noqa: PLC0415

    store = FakeStore()
    main.STORE, main.DB = store, db_of()
    boss = {"uid": "u-boss", "role": "admin", "is_master": True}
    payload = {"house": "ABD2704", "details": "From the lane", "priority": "low"}
    res = main._run_write(W, "locationNoteAdd", boss, payload, "Wlane0000001")
    env = json.loads(res.body)
    check("the lane answers the door's envelope with the relay's part under _write, and names the write it holds",
          res.status_code == 200 and env["status"] == 200 and env["_write"]["lay"]["kind"] == "append"
          and env["_write"]["author"]["name"] == "Asa Tech" and "Wlane0000001" in store.writes
          and res.headers.get("X-Hub-Own") == "" and float(res.headers["X-Hub-As-Of"]) > 0, [env, res.headers])
    again = json.loads(main._run_write(W, "locationNoteAdd", boss, payload, "Wlane0000001").body)
    check("the same write id again is the same answer, marked a replay — decided once",
          again["_write"]["replay"] is True and again["data"]["note"]["id"] == env["data"]["note"]["id"]
          and len(store.receipts) == 1)
    read = main._run(L, "locationNotes", boss, {"house": "ABD2704"})
    notes = json.loads(read.body)["data"]["notes"]
    check("Python's next read holds the note at once, and says so to the relay",
          any(n["details"] == "From the lane" for n in notes) and read.headers.get("X-Hub-Own") == "Wlane0000001",
          read.headers)
    store.busy = True
    busy = json.loads(main._run_write(W, "locationNoteAdd", boss, payload, "Wlane0000002").body)
    check("another write holding the lock: 409 in Apps Script's words, no receipt kept",
          busy == {"status": 409, "message": W.BUSY} and "Wlane0000002" not in store.receipts)
    store.busy = False
    main.DB = db_of(stale=(CARE,))
    res = main._run_write(W, "locationNoteState", boss, {"id": "HN_x", "state": "open"}, "Wlane0000003")
    check("a 404 resting on a book Drive changed since the copy: Apps Script answers it",
          res.status_code == 503 and "Wlane0000003" not in store.receipts, res.body)
    res = main._run_write(W, "locationNoteState", boss, {"id": "HN_1", "state": "resolved"}, "Wlane0000004")
    check("…an accepted one does not wait for the copy: Apps Script checks again when it writes",
          json.loads(res.body)["status"] == 200)
    check("no write id from the relay: not Python's to decide",
          main._run_write(W, "locationNoteAdd", boss, payload, "").status_code == 400)


def main() -> int:
    doors()
    notes()
    supplies_and_house()
    estate()
    handed_on()
    own_writes()
    main_lane()
    for f in FAILED:
        print("  FAIL", f)
    print(f"test-python-writes: {PASSED} ok, {len(FAILED)} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
