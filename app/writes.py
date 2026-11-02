"""Locations' writes (apps-script/Locations.gs) decided off asa-hub-db: kept in app.edits as the truth, answered…"""
from __future__ import annotations

import contextlib
import contextvars
import json
import logging
import os
import re
import threading
import time
import uuid
from typing import Any, Callable, Iterator

import envelope
import gsjs
import hubdb
import locations as L
import scope as sc
import staff_views
from gsjs import cell, name_key, text
from scope import Defer

log = logging.getLogger("asa-hub-app")


class GateHeld(envelope.Refused, Defer):
    """The book-write funnel holding a write: its 409, answered before anything is decided. Still a Defer to a door
    that catches one to say it in its own words."""

NOTES_HEADER = ("id", "house", "client_key", "priority", "details", "state", "by", "at", "state_by", "state_at")
NOTE_PRIORITIES = ("low", "normal", "high", "urgent")
NOTE_STATES = ("open", "resolved")
NOTE_EDIT_STATES = ("open", "resolved", "removed")
NOTE_EDIT_FIELDS = ("details", "priority", "client_key", "state")
NOTE_FOLDED = {"priority": "normal", "state": "open"}
SUPPLY_HEADER = ("id", "house", "item", "qty", "needed_by", "status", "kind", "category", "on_hand_after", "at", "by",
                 "note")
SUPPLY_EDIT_FIELDS = L.SUPPLY_EDIT_FIELDS + ("kind",)
SUPPLY_KEPT = "An entry's item, kind and time stay as recorded."
HOUSE_PHONES = ("telephone", "manager_phone")
HOUSE_LOCKED = {"abbreviation": "The house code is the key every app joins on; it is never edited.",
                "thumbnail_url": "The house photo is kept in Image Bank."}
STAFF_OFF_HEADER = ("id", "house", "staff_key", "name", "state", "by", "at")
INCIDENT_EDIT_FIELDS = ("your_name", "client_name", "incident_category", "incident_location", "incident_date",
                        "incident_time", "incident_reported_date", "incident_reported_time", "employees_involved",
                        "summary_of_incident", "immediate_action_taken", "cause_and_contributing_factors",
                        "prevention_plan")
REPAIR_EDIT_FIELDS = ("repair_type", "urgency_level", "please_describe_the_issue", "status", "resolution_notes")
# a request's own cells no edit writes: when it was filed and its street
REPAIR_KEYS = ("timestamp", "select_address_vehicle")
# an incident's row: when it was filed (no edit writes it); where that names no row alone, who filed it for whom, then
# its short cells, each set less the cells the edit writes
INCIDENT_KEYS = ("timestamp",)
INCIDENT_KEYS_ALSO = (("timestamp", "your_name", "client_name"),
                      ("timestamp", "your_name", "client_name", "incident_category", "incident_location",
                       "incident_date", "incident_time", "incident_reported_date", "incident_reported_time",
                       "employees_involved"))
# Settings › Editions: an incident filed or edited from a client's Incidents, for a client the holder reads
CLIENT_INCIDENT_EDITION = {"file": "clients.incidents", "edit": "clients.incidentsEdit"}
# Support Requests › Incidents (src/lib/featureAccess.ts): the app (support_desk.APP_ID; support_desk_writes imports this
# module), the page and its edit, App Control's own rows
SUPPORT_VIA = SUPPORT_APP = "support-desk"
SUPPORT_INCIDENTS_PAGE, SUPPORT_INCIDENTS_EDIT = "support-desk.incidents", "support-desk.incidentsEdit"
# supportDeskIncidents_'s word for an incident the platform's own form filed
INCIDENT_VIA = "platform"
# Estate.gs ESTATE_FILE_COLUMNS
FILE_COLUMNS = {"uiIncidents": L.INCIDENT_COLUMNS,
                "workOrders": ("timestamp", "select_address_vehicle", "repair_type", "urgency_level",
                               "please_describe_the_issue")}
CLIENTS_ADD_MAX = 20
EDIT_MAX_CHANGES = 40
BUSY = "Another write is in progress — try again in a moment."
# SmartGate.gs: the book-write funnel, a row of the situations tab
GATE_ID = "gate_book_write_funnel"
SMART_TAB = "smart_comms"
_MINTED = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_FIELD = re.compile(r"^[a-z][a-z0-9_]{0,63}$")

# the store: how long each kind of pending write is laid over the copy
UNBOUND_S = 120.0
QUEUED_MAX_S = 24 * 3600.0
RETIRE_AFTER_S = 3600.0
SETTLE_S = 60.0
LOCK_KEY = 0x4855424C4F43
_WAIT = os.getenv("HUB_APP_LOCK_WAIT", "5s").strip()
LOCK_WAIT = _WAIT if re.fullmatch(r"\d{1,5}(ms|s)", _WAIT) else "5s"
# the locked transaction's cursor while a write is decided: a door that keeps a row in the Hub's own table writes it
# here, in the same transaction as its receipt
HELD: contextvars.ContextVar[Any] = contextvars.ContextVar("writes_held", default=None)
KEEP_DAYS = 7
WRITE_ID = re.compile(r"^[A-Za-z0-9_.:\-]{8,80}$")


class Decision:
    """What a door answers, and what the relay lays, delivers or hands to Apps Script — or, with `edits`, the…"""

    def __init__(self, answer: dict[str, Any] | None, *, lay: dict | None = None, deliver: dict | None = None,
                 record: dict | None = None, engine: bool = False, fresh: bool | tuple = False,
                 edits: list[dict] | None = None, edition: str = "", subject: str = "", own: bool = False) -> None:
        self.answer = answer
        # kept in the app's own tables under this write's lock (writes.HELD), not in app.edits: final all the same
        self.own = own
        self.lay = lay
        self.deliver = deliver
        self.record = record
        self.engine = engine
        # a verdict that rests on the copy being current: True (every book read), or the books it rests on
        self.fresh = fresh
        # [{sheet_id, tab_name, kind: edit|append, match, keyed, row_key, cells, before?, edition?}] (edit_record's shape)
        self.edits = edits or None
        self.edition = edition
        # the pack key the relay reads again: a house, a client, a staff member, an SSA, a family member
        self.subject = subject


def refuse(status: int, message: str, *, fresh: bool | tuple = False, data: dict | None = None) -> Decision:
    env: dict[str, Any] = {"status": status, "message": message}
    if data is not None:
        env = {"status": status, "data": data, "message": message}
    return Decision(env, fresh=fresh)


def now_iso(reads: L.Reads) -> str:
    return gsjs.iso(reads.now)


def who(user: dict | None) -> str:
    """locationsWho_."""
    return gsjs.str_((user or {}).get("display_name")) or gsjs.str_((user or {}).get("email"))


def edit_text(v: Any) -> str:
    """hubEditText_."""
    return "" if v is None or isinstance(v, (dict, list)) else gsjs.js_str(v)


def sheet_text(v: Any) -> str:
    """The text a cell holds once Apps Script set it."""
    if v is None:
        return ""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return gsjs.num_str(v)
    return gsjs.js_str(v)


def minted(v: Any, prefix: str) -> str:
    """locationsMinted_: the relay's id for this row (prefix and a v4 uuid), '' for anything else."""
    s = gsjs.trim(gsjs.or_blank(v))
    return s if s.startswith(prefix) and _MINTED.match(s[len(prefix):]) else ""


def phone_key(v: Any) -> str:
    """contactPhoneKey_."""
    d = re.sub(r"\D+", "", gsjs.or_blank(v))
    if len(d) >= 11 and d[0] == "1":
        d = d[1:]
    d = d[-10:]
    return d if len(d) == 10 else ""


def steps(sheet: str, caches: str, slices: list | None = None, mirror: list | None = None,
          where: str = "") -> dict[str, Any]:
    """locationsSteps_."""
    return {"steps": [{"id": "sheet", "label": where or "Sheet", "landed": True, "words": sheet},
                      {"id": "cache", "label": "Kept caches", "landed": True, "words": caches}],
            "slices": slices or [], "mirror": mirror or [], "app": L.APP_ID}


def json_text(v: Any) -> str:
    """JSON.stringify of the lists and objects a door writes into one cell."""
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False)


def pg_steps(words: str, caches: str, app: str, slices: list | None = None) -> dict[str, Any]:
    """The Apply strip of a write kept in Postgres: the edit is the truth, every Python read lays it at once."""
    return {"steps": [{"id": "postgres", "label": "Postgres", "landed": True, "words": words},
                      {"id": "cache", "label": "Kept caches", "landed": True, "words": caches}],
            "slices": slices or [], "mirror": [], "app": app}


def with_steps(data: dict, said: dict) -> dict:
    out = dict(data)
    out.update(said)
    return out


def edit_answer(written: list[dict], refused: list[dict], stale: dict[str, str], said: dict | None) -> dict:
    """locationsEditAnswer_: 409 carrying what the record holds now when a witness went stale."""
    data: dict[str, Any] = {"written": [w["field"] for w in written], "refused": refused}
    if written and said:
        data = with_steps(data, said)
    if not stale:
        return {"status": 200, "data": data}
    data["current"] = dict(stale)
    return {"status": 409, "data": data,
            "message": "Some fields changed since the panel was opened — reloaded; the others were saved." if written
            else "Changed since the panel was opened — reloaded, nothing was written."}


def edit_changes(payload: dict) -> tuple[list[dict] | None, dict | None]:
    """hubEditChanges_: [{field, value, expected}], each field once; else its 400."""
    got = payload.get("changes") if isinstance(payload, dict) else None
    if not isinstance(got, list) or not got:
        return None, {"status": 400, "message": "changes: one or more { field, value, expected }."}
    if len(got) > EDIT_MAX_CHANGES:
        return None, {"status": 400, "message": f"changes: at most {EDIT_MAX_CHANGES} fields at once."}
    seen: set[str] = set()
    out = []
    for c in got:
        c = c if isinstance(c, dict) else {}
        field = gsjs.trim(edit_text(c.get("field")))
        if not _FIELD.match(field):
            return None, {"status": 400, "message": "changes: a field name is malformed."}
        if field in seen:
            return None, {"status": 400, "message": f'changes: "{field}" is named twice.'}
        seen.add(field)
        out.append({"field": field, "value": gsjs.trim(edit_text(c.get("value"))), "expected": edit_text(c.get("expected"))})
    return out, None


def only_written(payload: dict, written: list[dict]) -> dict:
    """The payload the ledger delivers: the changes that were accepted, as they were sent."""
    names = {w["field"] for w in written}
    kept = [c for c in payload.get("changes") or []
            if isinstance(c, dict) and gsjs.trim(edit_text(c.get("field"))) in names]
    return {**payload, "changes": kept}


# ---- the doors ---------------------------------------------------------------

def edition_allows(sess: L.Session, edition: str) -> bool:
    return sc.edition_allows(edition, sess.user or {}, sess.reads.config())


def edit_door(sess: L.Session, payload: dict, edition: str) -> dict[str, Any]:
    """locationsEditDoor_: the master at any house; else a person the edition names, past the read door, never cut."""
    if sc.is_real_master(sess.user):
        ctx = L.house(sess.reads, payload.get("house"))
        return {"refused": ctx["refused"]} if ctx.get("refused") else {"ctx": ctx, "master": True}
    if not edition_allows(sess, edition):
        return {"refused": L.unknown()}
    door = sess.read_door(payload)
    if door.get("refused"):
        return {"refused": door["refused"]}
    if L.cut_viewer(door["scope"]):
        return {"refused": L.unknown()}
    return {"ctx": door["ctx"], "master": False}


def incident_door(sess: L.Session, payload: dict, client_edition: str, filing: bool = False) -> dict[str, Any]:
    """An incident's door: opened from a client's Incidents (`client`), a holder of the Clients edition for a client
    they read, at a house that client is a current client of; else Locations' own (locations.incidents), and a new
    incident by a holder of locations.incidentsNew alone too."""
    key = text(payload.get("client"), 120)
    if key and not sc.is_real_master(sess.user):
        import client_writes as CW  # noqa: PLC0415 - it imports this module
        if CW.edit_door(sess, {"client": key}, client_edition) is None:
            ctx = L.house(sess.reads, payload.get("house"))
            if ctx.get("refused"):
                return {"refused": ctx["refused"]}
            client = next((c for c in ctx["clients"] if gsjs.or_text(c.get("client_key")) == key), None)
            if client is None:
                return {"refused": {"status": 409, "message": f"That client is not one of {ctx['code']}'s current "
                                                              "clients."}}
            return {"ctx": ctx, "master": False, "edition": client_edition, "client": client}
    if filing and not sc.is_real_master(sess.user) and not edition_allows(sess, L.EDITION["incidents"]) \
            and edition_allows(sess, L.EDITION["incidentsNew"]):
        door = edit_door(sess, payload, L.EDITION["incidentsNew"])
        return door if door.get("refused") else {**door, "edition": L.EDITION["incidentsNew"]}
    return edit_door(sess, payload, L.EDITION["incidents"])


def support_incident_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """Support Requests › Incidents' door: every report there, whatever the house. The master; else a badge App
    Control's own rows name — Support Requests itself (its denials and hiding too), the Incidents page
    (SUPPORT_INCIDENTS_PAGE) and its edit (SUPPORT_INCIDENTS_EDIT), the two the master's while empty. FAIL-CLOSED. The
    report is the one the panel opened: its row id, witnessed by its filing instant and its client (`filed`, `named`),
    since a row number moves when a row above it goes. The house the kept edit is filed under is its client's own."""
    master = sc.is_real_master(sess.user)
    if not master:
        src = sess.reads.scope_sources()
        try:
            shut = any(sc.profile_app_gate(f, sess.user, src).get("open") is not True
                       for f in (SUPPORT_APP, SUPPORT_INCIDENTS_PAGE, SUPPORT_INCIDENTS_EDIT))
        except Defer:
            shut = True
        if shut:
            return {"refused": L.unknown()}
    num = estate_row_num(payload.get("id"))
    if not num:
        return {"refused": {"status": 400, "message": 'id: a row id like "r42".'}}
    row = next((r for r in sess.reads.estate("uiIncidents") if r.get("id") == f"r{num}"), None)
    if row is None:
        return {"refused": {"status": 404, "message": f'No row "r{num}" in uiIncidents.'}}
    filed, named = text(payload.get("filed"), 80), text(payload.get("named"), 200)
    if not filed or filed != text(row.get("timestamp"), 80) or name_key(named) != name_key(row.get("client_name")):
        return {"refused": {"status": 409, "message": "That report has moved since it was opened — reload the list; "
                                                      "nothing was written."}}
    k = name_key(row.get("client_name"))
    clients = sess.reads.client_rows()
    named = [c for c in clients if k and name_key(c.get("name")) == k]
    codes = L.viewer_houses_from([c.get("client_key") for c in named], clients, sess.reads.homes()) or \
        sorted({L.house_code(c.get("house")) for c in named} - {""})
    if len(codes) != 1:
        return {"refused": {"status": 409, "message": "This report's client is at no single house on file, so it "
                                                      "cannot be filed here; nothing was written."}}
    ctx = L.house(sess.reads, codes[0])
    if ctx.get("refused"):
        return {"refused": ctx["refused"]}
    return {"ctx": ctx, "master": master, "edition": SUPPORT_INCIDENTS_EDIT}


def door_refused(door: dict) -> Decision:
    env = door["refused"]
    if env.get("status") == 503:
        # the registry this side could not read is not Apps Script's failure: it answers in its own words
        raise Defer(str(env.get("message") or "the house could not be read")[:160])
    # a house neither the registry nor a client carries is a fact of the copy
    return Decision(env, fresh=env.get("status") == 404 and env.get("message") != "Unknown action.")


def gate(reads: L.Reads) -> None:
    """sheetDbGateHolds_: the book-write funnel armed while the send switch holds — the write held with its 409
    (GateHeld), decided as SmartGate.gs hubGateHolds_ decides it."""
    import house_tables as HT  # noqa: PLC0415 - it imports this module
    if not HT.tabled(SMART_TAB):
        res = reads.db.resolve(SMART_TAB)
        if res.runtime:
            raise Defer("the situations tab lives in the depot's facts")
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable("asa-hub-db holds no copy of the situations tab's book")
            return
    import candidate_papers as CP  # noqa: PLC0415 - it imports this module
    why = CP.gate_holds(reads, GATE_ID)
    if why:
        raise GateHeld({"status": 409, "message": why})


def tab_of(reads: L.Reads, tab: str) -> hubdb.Resolved:
    """hubTabSheet_ for a write: the book must be one the copy holds."""
    res = reads.db.resolve(tab)
    if res.runtime:
        raise Defer(f"{tab} lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
    return res


def where_of(res: hubdb.Resolved) -> tuple[str, str]:
    # a declared house no copy holds a tab of yet keeps its rows in its Data tab (hubHouseTabIn_)
    return res.sheet_id, (res.ref.tab if res.ref is not None else res.names[-1] if res.declared_house
                          else res.names[0])


def row_by_id(rows: list[dict], rid: str) -> dict | None:
    return next((r for r in rows if gsjs.trim(gsjs.or_text(r.get("id"))) == rid), None)


def append_record(res: hubdb.Resolved, header: tuple, rec: dict, house: str) -> dict:
    sid, tab = where_of(res)
    return {"sheet_id": sid, "tab_name": tab, "kind": "append", "match": "id", "keyed": "header",
            "row_key": rec["id"], "house": house, "cells": {h: sheet_text(rec.get(h)) for h in header}}


def edit_record(sid: str, tab: str, match: str, keyed: str, key: str, house: str, cells: dict) -> dict:
    return {"sheet_id": sid, "tab_name": tab, "kind": "edit", "match": match, "keyed": keyed, "row_key": key,
            "house": house, "cells": {k: sheet_text(v) for k, v in cells.items()}}


NOT_TOLD_APART = "That row cannot be told apart from another one on the sheet, so nothing was written."
UNTOLD_SETTLING = ("An earlier change to a row of this sheet that no key tells apart is still being written into it; "
                   "try again in a few minutes — nothing was written.")
UNTOLD_WITHHELD = "A cell the Hub's copy withholds is never written from here, so nothing was written."


def kept_steps(words: str, caches: str) -> dict[str, Any]:
    return pg_steps(words + ", kept in the Hub's database.", caches, L.APP_ID)


def edition_of(door: dict, edition: str) -> str:
    """The edition a person's write came in by; the master's names none."""
    return "" if door.get("master") else door.get("edition") or edition


def note_add(sess: L.Session, payload: dict) -> Decision:
    door = edit_door(sess, payload, L.EDITION["house"])
    if door.get("refused"):
        return door_refused(door)
    ctx, reads = door["ctx"], sess.reads
    details = gsjs.trim(gsjs.or_text(payload.get("details")))[:4000]
    if not details:
        return refuse(400, "details: what the note says.")
    priority = text(payload.get("priority")).lower() or "normal"
    if priority not in NOTE_PRIORITIES:
        return refuse(400, "priority: one of " + ", ".join(NOTE_PRIORITIES) + ".")
    client_key = text(payload.get("client_key"), 120)
    if client_key and not any(c["client_key"] == client_key for c in ctx["clients"]):
        return refuse(400, f"client_key: not a current client of {ctx['code']}.", fresh=True)
    gate(reads)
    mint = minted(payload.get("id"), "HN_")
    res = tab_of(reads, L.NOTES_TAB)
    filed = bool(mint) and row_by_id(reads.db.locations_rows(res.ref), mint) is not None
    note = {"id": mint or "HN_" + str(uuid.uuid4()), "house": ctx["code"], "client_key": client_key,
            "priority": priority, "details": details, "state": "open", "by": who(sess.user), "at": now_iso(reads),
            "state_by": "", "state_at": ""}
    if filed:
        return Decision({"status": 200, "data": {"note": note, "already": True}})
    rec = append_record(res, NOTES_HEADER, note, ctx["code"])
    rec["edition"] = edition_of(door, L.EDITION["house"])
    note["client_name"] = ""
    for c in ctx["clients"]:
        if c["client_key"] == client_key:
            note["client_name"] = c["name"]
    answer = {"status": 200, "data": with_steps({"note": note}, kept_steps(
        f"A new row of {L.NOTES_TAB}", "The house's notes, read again."))}
    return final(answer, [rec], ctx["code"])


def note_state(sess: L.Session, payload: dict) -> Decision:
    reads = sess.reads
    edition = ""
    if not sc.is_real_master(sess.user):
        door = edit_door(sess, payload, L.EDITION["house"])
        if door.get("refused"):
            return door_refused(door)
        edition = edition_of(door, L.EDITION["house"])
    nid = text(payload.get("id"), 80)
    state = text(payload.get("state")).lower()
    if not nid:
        return refuse(400, "id: which note.")
    if state not in NOTE_STATES:
        return refuse(400, "state: open or resolved.")
    raw = payload.get("house")
    witness = (L.house_code(raw) or "?") if raw is not None and raw != "" else ""
    gate(reads)
    res = tab_of(reads, L.NOTES_TAB)
    row = row_by_id(reads.db.locations_rows(res.ref), nid) if res.ref is not None else None
    if row is None:
        return refuse(404, f'No house note "{nid}".', fresh=(res.sheet_id,))
    house = L.house_code(row.get("house"))
    if witness and witness != house:
        return refuse(409, "That note has moved since it was opened — reload the house.", fresh=(res.sheet_id,))
    stamp, by = now_iso(reads), who(sess.user)
    out = {"id": nid, "house": house, "state": state, "state_by": by, "state_at": stamp}
    answer = {"status": 200, "data": with_steps({"note": out}, kept_steps(
        f"The note's state on {L.NOTES_TAB}", "The house's notes, read again."))}
    fields = {"state": state, "state_by": by, "state_at": stamp}
    prior = {"state": cell(row.get("state")).lower() or "open", "state_by": cell(row.get("state_by")),
             "state_at": cell(row.get("state_at"))}
    sid, tab = where_of(res)
    return final(answer, [kept_record(sid, tab, "edit", "id", nid, house, fields, prior, edition)], house)


def supply_entry(sess: L.Session, payload: dict) -> Decision:
    door = edit_door(sess, payload, L.EDITION["house"])
    if door.get("refused"):
        return door_refused(door)
    ctx, reads = door["ctx"], sess.reads
    item = text(payload.get("item"), 120)
    if not item:
        return refuse(400, "item: what is counted or delivered.")
    kind = text(payload.get("kind")).lower()
    if kind not in L.SUPPLY_KINDS:
        return refuse(400, "kind: one of " + ", ".join(L.SUPPLY_KINDS) + ".")
    qty = L.num(payload.get("qty"))
    if qty is None or qty < 0:
        return refuse(400, "qty: a number, zero or more.")
    after = None
    raw_after = payload.get("on_hand_after")
    if kind == "delivery" and raw_after is not None and raw_after != "":
        after = L.num(raw_after)
        if after is None or after < 0:
            return refuse(400, "on_hand_after: a number, zero or more.")
    gate(reads)
    if not reads.db.house_moved(L.SUPPLY_TAB):
        return refuse(503, f"The supplies ledger is not set up: the {L.SUPPLY_TAB} house is not declared.")
    res = tab_of(reads, L.SUPPLY_TAB)
    mint = minted(payload.get("id"), "LS_")
    filed = bool(mint) and row_by_id(reads.db.locations_rows(res.ref), mint) is not None
    rec = {"id": mint or "LS_" + str(uuid.uuid4()), "house": ctx["code"], "item": item, "qty": qty, "needed_by": "",
           "status": "", "kind": kind, "category": text(payload.get("category"), 60),
           "on_hand_after": "" if after is None else after, "at": now_iso(reads), "by": who(sess.user),
           "note": text(payload.get("note"), 500)}
    if filed:
        return Decision({"status": 200, "data": {"entry": rec, "already": True}})
    answer = {"status": 200, "data": with_steps({"entry": rec}, kept_steps(
        f"A new line of {L.SUPPLY_TAB}", "The house's supplies, read again."))}
    kept = append_record(res, SUPPLY_HEADER, rec, ctx["code"])
    kept["edition"] = edition_of(door, L.EDITION["house"])
    return final(answer, [kept], ctx["code"])


def house_save(sess: L.Session, payload: dict) -> Decision:
    door = edit_door(sess, payload, L.EDITION["house"])
    if door.get("refused"):
        return door_refused(door)
    ctx, reads = door["ctx"], sess.reads
    code = ctx["code"]
    if not ctx["home"]:
        return refuse(404, f"The registry has no row for {code}.", fresh=True)
    if payload.get("home_name") is None:
        return refuse(400, "home_name: the house name the panel was opened on.")
    changes, bad = edit_changes(payload)
    if bad:
        return Decision(bad)
    import house_tables as HT  # noqa: PLC0415 - it imports this module
    sid = reads.prop_book(L.ENTITIES_PROP, L.ENTITIES_FALLBACK)
    # the registry as it stands: its own table once kept there
    ref = HT.book_tab(reads, sid, L.HOMES_TAB)
    if ref is None:
        if reads.db.book(sid) is None:
            raise hubdb.Unreadable("asa-hub-db holds no copy of the house registry")
        return refuse(503, "The house registry could not be opened.")
    heads = [gsjs.trim(gsjs.js_str(h)) for h in ref.headers]

    def cell_at(r: dict, name: str) -> str:
        return text(r.get(name, "")) if name in heads else ""

    row = next((r for r in reads.db.locations_rows(ref)
                if L.home_code(cell_at(r, "abbreviation"), cell_at(r, "home_name")) == code), None)
    if row is None:
        return refuse(404, f"The registry has no row for {code}.", fresh=(sid,))
    if cell_at(row, "home_name") != text(payload.get("home_name")):
        return refuse(409, "That house row has changed since it was opened — reload the house.", fresh=(sid,))
    by_abbreviation = bool(L.house_code(cell_at(row, "abbreviation")))
    written: list[dict] = []
    refused: list[dict] = []
    stale: dict[str, str] = {}
    kind: dict | None = None
    for c in changes:
        f = c["field"]
        if f in HOUSE_LOCKED:
            refused.append({"field": f, "why": HOUSE_LOCKED[f]})
            continue
        if f == "type":
            # the registry has no column for it: the Hub's own table keeps it (L.HOUSE_TYPES_TABLE)
            before = reads.house_type(code)
            if c["expected"] != before:
                stale[f] = before
                continue
            value = " ".join(c["value"].split())[:L.HOUSE_TYPE_MAX]
            if not value:
                refused.append({"field": f, "why": "A house keeps a type."})
                continue
            kind = {"field": f, "before": before, "after": value}
            continue
        if f not in L.HOUSE_FIELDS:
            refused.append({"field": f, "why": "Not a field of the house registry."})
            continue
        if f not in heads:
            refused.append({"field": f, "why": f"The registry has no {f} column, and none is added."})
            continue
        before = cell_at(row, f)
        if c["expected"] != before:
            stale[f] = before
            continue
        value = c["value"][:500]
        if f in HOUSE_PHONES and value:
            d = phone_key(value)
            if not d:
                refused.append({"field": f, "why": "A phone number has 10 digits."})
                continue
            value = f"({d[:3]}) {d[3:6]}-{d[6:]}"
        if f == "home_name":
            if not value:
                refused.append({"field": f, "why": "A house keeps a name."})
                continue
            if not by_abbreviation and L.code_of(value) != code:
                refused.append({"field": f, "why": f"This row has no abbreviation, so its name must still end in {code}."})
                continue
        if f == "calendar_link" and value and not re.match(r"^https://", value, re.I):
            refused.append({"field": f, "why": "A link is an https:// address."})
            continue
        written.append({"field": f, "before": before, "after": value})
    cells = list(written)
    if kind is not None:
        cur = HELD.get()
        if cur is None:
            refused.append({"field": "type", "why": "The house's type is kept only under the write lock."})
        else:
            cur.execute(f"insert into {L.HOUSE_TYPES_TABLE} (code, type, updated_by, updated_at) "
                        "values (%s, %s, %s, now()) on conflict (code) do update set type = excluded.type, "
                        "updated_by = excluded.updated_by, updated_at = now()", (code, kind["after"], who(sess.user)))
            written.append(kind)
    answer = edit_answer(written, refused, stale, kept_steps(
        f"{len(written)} cell(s) of the house's row on {L.HOMES_TAB}",
        "The registry and the house's overview, read again."))
    if not cells:
        return Decision(answer, fresh=(sid,) if stale else False)
    # a table lays an edit on the row its key column names: the registry's own home id, not the code worked out
    match, key = (COLS + "home_id", cell_at(row, "home_id")) if isinstance(ref, HT.KeptRef) else ("code", code)
    rec = kept_record(sid, ref.tab, "edit", match, key, code, {w["field"]: w["after"] for w in cells},
                      {w["field"]: w["before"] for w in cells}, edition_of(door, L.EDITION["house"]))
    out = final(answer, [rec], code)
    # people edit the registry in the sheet too: a witness read off a copy the sheet has moved past is not answered
    out.fresh = (sid,)
    return out


def note_edit(sess: L.Session, payload: dict) -> Decision:
    reads = sess.reads
    anyone = sc.is_real_master(sess.user) or edition_allows(sess, L.EDITION["notesAny"])
    door = edit_door(sess, payload, L.EDITION["notesAny"] if anyone else L.EDITION["house"])
    if door.get("refused"):
        return door_refused(door)
    ctx = door["ctx"]
    nid = text(payload.get("id"), 80)
    if not nid:
        return refuse(400, "id: which note.")
    changes, bad = edit_changes(payload)
    if bad:
        return Decision(bad)
    gate(reads)
    res = tab_of(reads, L.NOTES_TAB)
    row = row_by_id(reads.db.locations_rows(res.ref), nid) if res.ref is not None else None
    book = (res.sheet_id,)
    if row is None:
        return refuse(404, f'No house note "{nid}".', fresh=book)
    if L.house_code(row.get("house")) != ctx["code"]:
        return refuse(409, "That note has moved since it was opened — reload the house.", fresh=book)
    by = who(sess.user)
    if not anyone and cell(row.get("by")) != by:
        return refuse(403, "Somebody else wrote this note. Editing anyone's note is its own edition, and it is not "
                           "yours. Nothing was written.", fresh=book)

    def live(f: str) -> str:
        v = cell(row.get(f, ""))
        return (v.lower() or NOTE_FOLDED[f]) if f in NOTE_FOLDED else v

    written: list[dict] = []
    refused: list[dict] = []
    stale: dict[str, str] = {}
    fields: dict[str, Any] = {}
    prior: dict[str, Any] = {}
    for c in changes:
        f = c["field"]
        if f not in NOTE_EDIT_FIELDS:
            refused.append({"field": f, "why": "Not a field of a house note."})
            continue
        before = live(f)
        folded = f in NOTE_FOLDED
        if (c["expected"].lower() if folded else c["expected"]) != before:
            stale[f] = before
            continue
        value = c["value"].lower() if folded else c["value"]
        if f == "details":
            if not value:
                refused.append({"field": f, "why": "A note says something; remove the note instead."})
                continue
            value = value[:4000]
        if f == "priority" and value not in NOTE_PRIORITIES:
            refused.append({"field": f, "why": "One of " + ", ".join(NOTE_PRIORITIES) + "."})
            continue
        if f == "state" and value not in NOTE_EDIT_STATES:
            refused.append({"field": f, "why": "One of " + ", ".join(NOTE_EDIT_STATES) + "."})
            continue
        if f == "client_key" and value and not any(x["client_key"] == value for x in ctx["clients"]):
            refused.append({"field": f, "why": f"Not a current client of {ctx['code']}."})
            continue
        fields[f], prior[f] = value, before
        if f == "state":
            fields["state_by"], fields["state_at"] = by, now_iso(reads)
            prior["state_by"], prior["state_at"] = cell(row.get("state_by")), cell(row.get("state_at"))
        written.append({"field": f, "before": before, "after": value})
    answer = edit_answer(written, refused, stale, kept_steps(
        f"{len(written)} cell(s) of the note's row on {L.NOTES_TAB}", "The house's notes, read again."))
    if not written:
        return Decision(answer, fresh=book if stale else False)
    sid, tab = where_of(res)
    edition = edition_of(door, L.EDITION["notesAny"] if anyone else L.EDITION["house"])
    return final(answer, [kept_record(sid, tab, "edit", "id", nid, ctx["code"], fields, prior, edition)], ctx["code"])


def supply_edit(sess: L.Session, payload: dict) -> Decision:
    door = edit_door(sess, payload, L.EDITION["house"])
    if door.get("refused"):
        return door_refused(door)
    ctx, reads = door["ctx"], sess.reads
    eid = text(payload.get("id"), 80)
    if not eid:
        return refuse(400, "id: which entry.")
    changes, bad = edit_changes(payload)
    if bad:
        return Decision(bad)
    gate(reads)
    if not reads.db.house_moved(L.SUPPLY_TAB):
        return refuse(503, f"The supplies ledger is not set up: the {L.SUPPLY_TAB} house is not declared.")
    res = tab_of(reads, L.SUPPLY_TAB)
    row = row_by_id(reads.db.locations_rows(res.ref), eid) if res.ref is not None else None
    book = (res.sheet_id,)
    if row is None:
        return refuse(404, f'No supplies entry "{eid}".', fresh=book)
    if L.house_code(row.get("house")) != ctx["code"]:
        return refuse(409, "That entry has moved since it was opened — reload the house.", fresh=book)

    def live(f: str) -> str:
        if f in ("qty", "on_hand_after"):
            n = L.num(row.get(f))
            return cell(row.get(f, "")) if n is None else gsjs.num_str(n)
        if f == "kind":
            return text(cell(row.get(f, ""))).lower()
        return text(cell(row.get(f, "")))

    kind_now = live("kind")
    if kind_now == L.SUPPLY_REMOVED:
        return refuse(404, f'No supplies entry "{eid}".', fresh=book)
    written: list[dict] = []
    refused: list[dict] = []
    stale: dict[str, str] = {}
    fields: dict[str, Any] = {}
    for c in changes:
        f = c["field"]
        # the kind takes one change only: the entry removed, so a wrong one is recorded again
        if f not in SUPPLY_EDIT_FIELDS or (f == "kind" and c["value"].lower() != L.SUPPLY_REMOVED):
            refused.append({"field": f, "why": SUPPLY_KEPT})
            continue
        before = live(f)
        if (c["expected"].lower() if f == "kind" else c["expected"]) != before:
            stale[f] = before
            continue
        if f == "qty":
            value: Any = L.num(c["value"])
            if value is None or value < 0:
                refused.append({"field": f, "why": "A number, zero or more."})
                continue
        elif f == "on_hand_after":
            if kind_now != "delivery":
                refused.append({"field": f, "why": "Only a delivery records what was on hand after it."})
                continue
            value = "" if not c["value"] else L.num(c["value"])
            if value is None or (value != "" and value < 0):
                refused.append({"field": f, "why": "A number, zero or more, or blank."})
                continue
        elif f == "kind":
            value = L.SUPPLY_REMOVED
        else:
            value = text(c["value"], 60 if f == "category" else 500)
        fields[f] = value
        written.append({"field": f, "before": before, "after": sheet_text(value)})
    answer = edit_answer(written, refused, stale, kept_steps(
        f"{len(written)} cell(s) of the entry on {L.SUPPLY_TAB}", "The house's supplies, read again."))
    if not written:
        return Decision(answer, fresh=book if stale else False)
    sid, tab = where_of(res)
    rec = kept_record(sid, tab, "edit", "id", eid, ctx["code"], fields, {w["field"]: w["before"] for w in written},
                      edition_of(door, L.EDITION["house"]))
    return final(answer, [rec], ctx["code"])


def estate_row_num(v: Any) -> int:
    """estateRowNum_: 'r42' → 42, and nothing else."""
    m = re.fullmatch(r"r(\d+)", gsjs.or_text(v))
    n = int(m.group(1)) if m else 0
    return n if n >= 2 else 0


def house_client(ctx: dict, name: Any) -> dict | None:
    """locationsHouseClient_."""
    k = name_key(name)
    return next((c for c in ctx["clients"] if k and name_key(c.get("name")) == k), None)


def estate_edit(sess: L.Session, payload: dict, resource: str, edition: str, allowed: tuple,
                belongs: Callable[[dict, dict], bool], check: Callable[[dict, str, str], str] | None,
                words: tuple[str, str], keys_by: tuple = (), also: tuple = (), untold: str = "",
                door: dict | None = None) -> Decision:
    """locationsEstateEdit_ behind its door (Locations' own unless one is handed in): header-bound, row-verified, each
    field against its witness; with…"""
    door = door if door is not None else edit_door(sess, payload, edition)
    if door.get("refused"):
        return door_refused(door)
    ctx, reads = door["ctx"], sess.reads
    changes, bad = edit_changes(payload)
    if bad:
        return Decision(bad)
    row_num = estate_row_num(payload.get("id"))
    if not row_num:
        return refuse(400, 'id: a row id like "r42".')
    gate(reads)
    prop, tab = L.ESTATE_SOURCES[resource]
    sid = reads.db.prop(prop)
    if not sid:
        raise hubdb.Unreadable(f"no {prop} is declared in the depot")
    ref = reads.tab_of(sid, tab, f"the estate's {tab}")
    if ref is None:
        return refuse(503, f'The "{resource}" sheet could not be opened.')
    keys = [hubdb.estate_key(h) for h in ref.headers]
    rows = reads.estate(resource)
    rid = f"r{row_num}"
    row = next((r for r in rows if r.get("id") == rid), None)
    if row is None:
        last = max((int(r["id"][1:]) for r in rows if re.fullmatch(r"r\d+", str(r.get("id") or ""))), default=1)
        if row_num > last:
            return refuse(404, f'No row "{gsjs.or_blank(payload.get("id"))}" in {resource}.', fresh=(sid,))
        row = {"id": rid, **{k: "" for k in keys if k}}
    if not belongs(ctx, row):
        return refuse(409, "That row has moved since it was opened — reload the house.", fresh=True)
    written: list[dict] = []
    refused: list[dict] = []
    stale: dict[str, str] = {}
    for c in changes:
        f = c["field"]
        if f not in allowed:
            refused.append({"field": f, "why": "Not a field edited here."})
            continue
        if f not in keys:
            refused.append({"field": f, "why": f"The sheet has no {f} column, and none is added."})
            continue
        before = gsjs.or_blank(row.get(f))
        if text(c["expected"]) != text(before):
            stale[f] = before
            continue
        why = check(ctx, f, c["value"]) if check else ""
        if why:
            refused.append({"field": f, "why": why})
            continue
        written.append({"field": f, "before": before, "after": c["value"][:4000]})
    return estate_kept(reads, ref, row_num, resource, written, refused, stale, words, ctx["code"],
                       edition_of(door, edition), keys_by, also, (untold, who(sess.user)) if untold else None)


def estate_kept(reads: L.Reads, ref: hubdb.TabRef, row_num: int, resource: str, written: list[dict],
                refused: list[dict], stale: dict[str, str], words: tuple[str, str], code: str, edition: str,
                keys_by: tuple, also: tuple = (), untold: tuple[str, str] | None = None) -> Decision:
    """An estate row's accepted cells kept in app.edits, the row named by cells no edit writes (never its number);
    `also`: the sets tried after `keys_by`, each less the cells this edit writes; `untold` (the action, its author):
    a row no set tells apart written on the sheet itself, named by all its cells (estate_untold)."""
    answer = edit_answer(written, refused, stale, kept_steps(f"{len(written)} cell(s) of {words[0].rstrip('.')}",
                                                             words[1]))
    if not written:
        return Decision(answer, fresh=(ref.sheet_id,) if stale else False)
    rows = reads.db.rows(ref)
    at = next((i for i, (rn, _raw) in enumerate(rows) if rn == row_num), None)
    heads = [h for h in ref.headers if hubdb.estate_key(h) in keys_by]
    sets = [heads] if len(heads) == len(keys_by) else []
    wrote = {w["field"] for w in written}
    sets += [[h for h in ref.headers if hubdb.estate_key(h) in s and hubdb.estate_key(h) not in wrote] for s in also]
    got = row_key_of(rows, at, sets) if at is not None else None
    if got is None:
        if untold is None or at is None:
            return refuse(409, NOT_TOLD_APART, fresh=(ref.sheet_id,))
        return estate_untold(reads, ref, rows, at, resource, written, answer, code, edition, untold)
    rec = kept_record(ref.sheet_id, ref.tab, "edit", got[0], got[1], code, {w["field"]: w["after"] for w in written},
                      {w["field"]: w["before"] for w in written}, edition)
    rec["keyed"] = "estate"
    out = final(answer, [rec], code)
    # the estate's forms and its people write these sheets too: a witness off a copy the sheet has moved past waits
    out.fresh = (ref.sheet_id,)
    return out


def estate_untold(reads: L.Reads, ref: hubdb.TabRef, rows: list[tuple[int, dict]], at: int, resource: str,
                  written: list[dict], answer: dict[str, Any], code: str, edition: str,
                  untold: tuple[str, str]) -> Decision:
    """A row no key set tells apart: its accepted cells written on the sheet itself (app/book_ops.py `cells`), the row
    named there by every cell the copy shows of it. Refused while another row holds every one of them too, for a cell
    the copy withholds, and while the house's last such change is still on its way into the sheet."""
    import book_ops as BO  # noqa: PLC0415 - it imports this module
    subject = f"{resource}:{code}"
    if BO.settling(reads, subject):
        return refuse(409, UNTOLD_SETTLING, fresh=(ref.sheet_id,))
    where, holding = BO.where_of(rows, at, ref.headers)
    if holding != 1:
        return refuse(409, NOT_TOLD_APART, fresh=(ref.sheet_id,))
    raw = rows[at][1]
    cells: dict[str, str] = {}
    before: dict[str, str] = {}
    for w in written:
        h = Own._header(ref, w["field"], "estate")
        if h is None or BO.withheld(raw.get(h)):
            return refuse(409, UNTOLD_WITHHELD, fresh=(ref.sheet_id,))
        cells[gsjs.trim(gsjs.js_str(h))], before[gsjs.trim(gsjs.js_str(h))] = sheet_text(w["after"]), w["before"]
    spec: dict[str, Any] = {"where": where, "cells": cells, "before": before}
    if edition:
        spec["editions"] = [edition]
    BO.queue([{"op": "cells", "sheet_id": ref.sheet_id, "tab": ref.tab, "spec": spec}], subject, untold[1], untold[0])
    # final as a kept edit is: the op is this write's, in its transaction
    return Decision(answer, fresh=(ref.sheet_id,), subject=code, own=True)


def incident_edit(sess: L.Session, payload: dict) -> Decision:
    # Support Requests › Incidents opens every report: its own door, the report found by its row id
    support = text(payload.get("via"), 40) == SUPPORT_VIA
    door = support_incident_door(sess, payload) if support else incident_door(sess, payload,
                                                                               CLIENT_INCIDENT_EDITION["edit"])
    # opened from a client's Incidents, the report stays that client's
    mine = door.get("client")

    def ours(ctx: dict, name: Any) -> bool:
        c = house_client(ctx, name)
        return c is not None and (not mine or gsjs.or_text(c.get("client_key")) == gsjs.or_text(mine.get("client_key")))

    def check(ctx: dict, field: str, value: str) -> str:
        if field != "client_name":
            return ""
        if support:
            # App Control's hint says so: the report changes client in Locations or the client's Incidents
            return "The report stays its own client's here; a client is changed in Locations or the client's Incidents."
        if ours(ctx, value):
            return ""
        return f"The report stays {mine['name']}'s here." if mine else f"Not a current client of {ctx['code']}."

    out = estate_edit(sess, payload, "uiIncidents", L.EDITION["incidents"], INCIDENT_EDIT_FIELDS,
                      (lambda ctx, row: True) if support else (lambda ctx, row: ours(ctx, row.get("client_name"))),
                      check,
                      ("the incident's row on the UIs and MUIs sheet.",
                       "The incidents sheet's kept copy and the house's incidents, read again."),
                      INCIDENT_KEYS, INCIDENT_KEYS_ALSO, untold="locationIncidentEdit", door=door)
    if out.edits or out.own:
        # hubEditLog_: the record's key and the fields written
        staff_views.record(sess.user, "locationIncidentEdit", f"{out.subject} {text(payload.get('id'), 20)}: " +
                           ", ".join(out.answer["data"]["written"]))
    return out


def repair_at(ctx: dict, row: dict) -> bool:
    """locationsRepairAt_."""
    return len(L.repairs_for([row], ctx["code"], L.addr_index(ctx["homes"], ctx["all_clients"]))) == 1


def repair_edit(sess: L.Session, payload: dict) -> Decision:
    return estate_edit(sess, payload, "workOrders", L.EDITION["house"], REPAIR_EDIT_FIELDS, repair_at, None,
                       ("the request's row on the Repairs sheet.", "The house's repairs, read again."),
                       REPAIR_KEYS, untold="locationRepairEdit")


def staff_remove(sess: L.Session, payload: dict) -> Decision:
    door = edit_door(sess, payload, L.EDITION["staffRemove"])
    if door.get("refused"):
        return door_refused(door)
    ctx, reads = door["ctx"], sess.reads
    code = ctx["code"]
    name = text(payload.get("staff"), 120)
    key = name_key(name)
    if not key:
        return refuse(400, "staff: who is taken off the house.")
    back = payload.get("back") is True
    part = L.staff_part(reads, ctx)
    if part["removed_why"]:
        # what this side could not read is not Apps Script's failure: it answers in its own words
        raise Defer(f"who was taken off {code} could not be read here")
    listed = next((p for p in (part["removed"] if back else part["staff"]) or [] if p["key"] == key), None)
    if listed is None:
        return refuse(404, f"{name} was not taken off {code}." if back else f"{name} is not on {code}'s Staff list.",
                      fresh=True)
    gate(reads)
    res = reads.staff_off_tab()
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {L.STAFF_OFF_TAB}")
    rec = {"id": mint("HS_"), "house": code, "staff_key": key, "name": listed["name"],
           "state": "back" if back else "off", "by": who(sess.user), "at": now_iso(reads)}
    answer = {"status": 200, "data": with_steps(
        {"house": code, "staff": {"key": key, "name": rec["name"], "state": rec["state"]}},
        kept_steps(f"A row of {L.STAFF_OFF_TAB} (the staff record is untouched)", "The house's staff, read again."))}
    kept = append_record(res, STAFF_OFF_HEADER, rec, code)
    kept["edition"] = edition_of(door, L.EDITION["staffRemove"])
    return final(answer, [kept], code)


def filing_row(resource: str, sent: dict, reads: L.Reads) -> dict[str, str]:
    """locationsFilingRow_."""
    rec: dict[str, str] = {}
    for k in FILE_COLUMNS[resource]:
        v = sent.get(k)
        if v is not None and not isinstance(v, (dict, list)):
            rec[k] = gsjs.js_str(v)[:4000]
    if not rec.get("timestamp"):
        rec["timestamp"] = now_iso(reads)
    return rec


def incident_file(sess: L.Session, payload: dict) -> Decision:
    door = incident_door(sess, payload, CLIENT_INCIDENT_EDITION["file"], filing=True)
    if door.get("refused"):
        return door_refused(door)
    ctx = door["ctx"]
    sent = payload.get("row")
    if not isinstance(sent, dict):
        return refuse(400, "row: the incident's fields.")
    client = house_client(ctx, sent.get("client_name"))
    if client is None:
        return refuse(400, f"client_name: one of {ctx['code']}'s current clients.", fresh=True)
    mine = door.get("client")
    if mine and gsjs.or_text(client.get("client_key")) != gsjs.or_text(mine.get("client_key")):
        return refuse(400, f"client_name: {mine['name']}, the client this was opened for.")
    rec = filing_row("uiIncidents", sent, sess.reads)
    if not text(rec.get("incident_category")):
        return refuse(400, "incident_category: what kind of incident.")
    rec["client_name"] = client["name"]
    rec["your_name"] = text(rec.get("your_name"), 120) or who(sess.user)
    import client_care_records as CCR  # noqa: PLC0415 - the incidents book's own writer builds on this module
    # the time as the sheet shows it once the bridge enters it, as the Repairs book's filings keep it: the row is found
    # by the same key, and edited by it, before the sheet holds it and after
    rec["timestamp"] = CCR.sheet_shows(rec["timestamp"])
    # estateRoute_('uiIncidents', 'create')
    got = CCR.file_incident(sess, rec)
    if not got.edits:
        return got
    for e in got.edits:
        e["edition"] = edition_of(door, L.EDITION["incidents"])
    row = got.answer["data"]
    answer = {"status": 200, "data": with_steps({"house": ctx["code"], "incident": row}, kept_steps(
        "A new row on the estate's UIs and MUIs sheet", "The incidents sheet's kept copy and the house's incidents, "
                                                        "read again."))}
    staff_views.record(sess.user, "locationIncidentFile", ctx["code"])
    return final(answer, got.edits + incident_raised(sess.reads, row), ctx["code"])


def incident_raised(reads: L.Reads, row: dict) -> list[dict]:
    """supportDeskIncidents_ on the row the estate's create read back: a pointer for the directors and the leads on
    Support Requests, kept in this write; one it cannot raise now is not the filing's failure (the clock raises it)."""
    import support_desk_clock_writes as SDKW  # noqa: PLC0415 - Support Requests builds on this module
    import support_raise as SR  # noqa: PLC0415
    rx = SR.Raise(reads)
    try:
        SDKW.incidents_raise(rx, [row], INCIDENT_VIA)
    except Exception as exc:  # noqa: BLE001 - estateRoute_ files the incident whatever the raise says
        log.info("locationIncidentFile: the incident was not raised on Support Requests (%s: %s)",
                 type(exc).__name__, str(exc)[:160])
        return []
    return rx.edits


def repair_file(sess: L.Session, payload: dict) -> Decision:
    door = edit_door(sess, payload, L.EDITION["house"])
    if door.get("refused"):
        return door_refused(door)
    ctx = door["ctx"]
    sent = payload.get("row")
    if not isinstance(sent, dict):
        return refuse(400, "row: the request's fields.")
    rec = filing_row("workOrders", sent, sess.reads)
    street = text(rec.get("select_address_vehicle"), 200)
    if not street:
        return refuse(400, "select_address_vehicle: the house's street.")
    if L.addr_owner(L.addr_index(ctx["homes"], ctx["all_clients"]), street)["code"] != ctx["code"]:
        return refuse(400, f"That street is not {ctx['code']}'s; a repair is filed from its own house.", fresh=True)
    # the house's form asks the house, the urgency and the issue; a repair type is the sheet's to carry when sent
    import client_writes as CW  # noqa: PLC0415 - the Repairs book's own writer builds on this module
    import house_repair_writes as HRW  # noqa: PLC0415
    # estateRoute_('workOrders', 'create'): a non-writer files the form's columns alone
    if not CW.writer(sess.user):
        shut = HRW.file_gate(sess.reads, rec, sess.user or {})
        if shut is not None:
            return shut
    got = HRW.file_repair(sess.reads, rec)
    if not got.edits:
        return got
    for e in got.edits:
        e["edition"] = edition_of(door, L.EDITION["house"])
    answer = {"status": 200, "data": with_steps({"house": ctx["code"], "repair": got.answer["data"]}, kept_steps(
        "A new row on the estate's Repairs sheet",
        "The repairs sheet's kept copy and the house's repairs, read again."))}
    staff_views.record(sess.user, "locationRepairFile", ctx["code"])
    return final(answer, got.edits, ctx["code"])


def client_house_now(c: dict, homes: list[dict]) -> str:
    """locationsClientHouseNow_."""
    if not L.client_current(c):
        return ""
    hc = L.house_code(c.get("house")) or L.code_of(c.get("house"))
    if hc:
        return hc
    a = L.addr(c.get("home_address"))
    if not a["key"]:
        return ""
    for h in homes or []:
        if not h or not h.get("address"):
            continue
        ha = L.addr(h["address"])
        if ha["key"] == a["key"] and ha["unit"] == a["unit"]:
            return h["code"]
    return ""


def clients_add(sess: L.Session, payload: dict) -> Decision:
    door = edit_door(sess, payload, L.EDITION["clientsAdd"])
    if door.get("refused"):
        return door_refused(door)
    ctx = door["ctx"]
    code = ctx["code"]
    if any(payload.get(k) is not None for k in ("remove", "removed", "drop", "off")):
        return refuse(400, "A house's current clients are never taken off here. Nothing was written.")
    asked = payload.get("clients") if isinstance(payload.get("clients"), list) else None
    if not asked:
        return refuse(400, "clients: one or more clients to add.")
    if len(asked) > CLIENTS_ADD_MAX:
        return refuse(400, f"At most {CLIENTS_ADD_MAX} clients at once. Nothing was written.")
    if ctx["clients_why"] or ctx["homes_why"]:
        raise Defer("the clients or the house registry could not be read here")
    keys: list[str] = []
    for k in asked:
        s = text("" if k is None or isinstance(k, (dict, list)) else k, 120)
        if s and s not in keys:
            keys.append(s)
    if not keys:
        return refuse(400, "clients: one or more clients to add.")
    import client_writes as CW  # noqa: PLC0415 - Clients' writes build on this module
    refused: list[dict] = []
    added: list[dict] = []
    edits: list[dict] = []
    registry = {h.get("code") for h in ctx["homes"] or [] if h}
    for key in keys:
        c = next((x for x in ctx["all_clients"] if x.get("client_key") == key), None)
        if c is None:
            refused.append({"client_key": key, "why": f'No client "{key}" is on file.'})
            continue
        if not L.client_current(c):
            refused.append({"client_key": key, "why": f"{c['name']} is not a current client; an inactive client is "
                                                      "not placed in a house here."})
            continue
        now = code if any(x.get("client_key") == key for x in ctx["clients"]) else client_house_now(c, ctx["homes"])
        if now == code:
            refused.append({"client_key": key, "why": f"{c['name']} is already a client of {code}."})
            continue
        if now:
            refused.append({"client_key": key, "why": f"{c['name']} is a current client of {now}; a client is never "
                                                      "taken off a house here."})
            continue
        # the client's own record takes the house (cpProfileEdit_): its Hub row and its Master row
        got = CW.house_cells(sess, key, code, registry)
        if got.get("why"):
            refused.append({"client_key": key, "why": got["why"]})
            continue
        edits.extend(got["edits"])
        added.append({"client_key": key, "name": c["name"]})
    data = {"house": code, "added": added, "refused": refused, "client_keys": [a["client_key"] for a in added]}
    if not added:
        return refuse(409, (refused[0]["why"] + " " if refused else "") + "Nothing was written.", fresh=True, data=data)
    for e in edits:
        e["edition"] = edition_of(door, L.EDITION["clientsAdd"])
    answer = {"status": 200, "data": with_steps(data, kept_steps(
        f"The house on {len(added)} client record(s): the Hub clients tab and the Asa Client Database Master",
        "The house's overview, staff, incidents and documents, read again."))}
    return final(answer, edits, code)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "locationNoteAdd": note_add, "locationNoteState": note_state, "locationSupplyEntry": supply_entry,
    "locationHouseSave": house_save, "locationNoteEdit": note_edit, "locationSupplyEdit": supply_edit,
    "locationStaffRemove": staff_remove, "locationIncidentFile": incident_file, "locationIncidentEdit": incident_edit,
    "locationRepairFile": repair_file, "locationRepairEdit": repair_edit, "locationClientsAdd": clients_add,
}

# HUB_POLICY: the roles each write is declared for, and its typed params
WRITE_ROLES = ("admin", "manager", "staff")
POLICY: dict[str, dict[str, Any]] = {a: {"roles": WRITE_ROLES, "params": p} for a, p in {
    "locationNoteAdd": {"house": "string", "client_key": "string", "priority": "string", "details": "string"},
    "locationNoteState": {"id": "string", "state": "string", "house": "string"},
    "locationSupplyEntry": {"house": "string", "item": "string", "category": "string", "kind": "string",
                            "note": "string"},
    "locationHouseSave": {"house": "string", "home_name": "string", "changes": "array"},
    "locationNoteEdit": {"house": "string", "id": "string", "changes": "array"},
    "locationSupplyEdit": {"house": "string", "id": "string", "changes": "array"},
    "locationStaffRemove": {"house": "string", "staff": "string"},
    "locationIncidentFile": {"house": "string", "client": "string"},
    "locationIncidentEdit": {"house": "string", "id": "string", "changes": "array", "client": "string",
                             "via": "string", "filed": "string", "named": "string"},
    "locationRepairFile": {"house": "string"},
    "locationRepairEdit": {"house": "string", "id": "string", "changes": "array"},
    "locationClientsAdd": {"house": "string", "clients": "array"},
}.items()}


def _rows_written(write_id: str) -> bool:
    """Did this write change a row of a table kept in Postgres (app.resource_changes, under the write's lock)? A door
    whose houses moved to their tables may not say so itself."""
    cur = HELD.get()
    if cur is None or not write_id:
        return False
    try:
        cur.execute("select 1 from app.resource_changes where write_id = %s limit 1", (write_id,))
        return cur.fetchone() is not None
    except Exception:  # noqa: BLE001 - unasked is as before: the door's own word
        return False


def plan_of(decision: Decision, write_id: str, user: dict | None) -> dict[str, Any] | None:
    """What the relay does with a decision: lay and deliver it, hand it to Apps Script, or answer it as it stands."""
    if decision.edits:
        # kept in app.edits under this request's lock: the relay answers it and reads the subject again
        subject = decision.subject or str((decision.edits[0] or {}).get("house") or "")
        return {"write_id": write_id, "engine": False, "final": True, "house": subject,
                "cells": sum(len(e.get("cells") or {}) for e in decision.edits)}
    if decision.own or _rows_written(write_id):
        # kept in the app's own tables: the relay answers it and reads the subject again, as for an edit
        return {"write_id": write_id, "engine": False, "final": True, "house": decision.subject, "cells": 0}
    if decision.engine:
        house = (decision.record or {}).get("house") or ""
        return {"write_id": write_id, "engine": True, "settle": decision.record is not None, "house": house}
    if decision.lay:
        return {"write_id": write_id, "engine": False, "house": decision.lay["house"], "lay": decision.lay,
                "deliver": decision.deliver,
                "author": {"uid": gsjs.str_((user or {}).get("id")), "name": who(user)}}
    return None


def envelope(decision: Decision, write_id: str, user: dict | None) -> dict[str, Any]:
    """The door's answer, with the relay's part of it under `_write`."""
    env = dict(decision.answer) if decision.answer else {"status": 200}
    plan = plan_of(decision, write_id, user)
    if plan is not None:
        env["_write"] = plan
    return env


# ---- the writes Python accepted, laid over the copy until it holds them --------------------------------------

def _epoch(v: Any) -> float:
    return hubdb._epoch(v)


def _norm(v: Any, keyed: str) -> str:
    t = hubdb.typed(v, "estate" if keyed == "estate" else "hub")
    return hubdb.estate_cell(t) if keyed == "estate" else gsjs.cell(hubdb._shown(t))


def same_cell(a: Any, b: Any, keyed: str) -> bool:
    if _norm(a, keyed) == _norm(b, keyed):
        return True
    na, nb = L.num(gsjs.or_blank(a)), L.num(gsjs.or_blank(b))
    return na is not None and nb is not None and na == nb


COLS = "cols:"
COLS_SEP = "|"


def cols_key(raw: dict, heads: list) -> str:
    """A row's key under a cols: match, its cells under `heads` trimmed; '' when every one is blank."""
    vals = [gsjs.trim(gsjs.or_blank(raw.get(h))) for h in heads]
    return "\x1f".join(vals) if any(vals) else ""


def row_key_of(rows: list[tuple[int, dict]], at: int, sets: list[list[str]]) -> tuple[str, str] | None:
    """(match, row_key) naming rows[at] alone by the first header set whose cells tell it apart from every other…"""
    target = rows[at][1]
    for heads in sets:
        heads = [h for h in heads if h]
        if not heads or any(COLS_SEP in gsjs.trim(h) or not gsjs.trim(h) for h in heads):
            continue
        key = cols_key(target, heads)
        if key and sum(1 for _rn, raw in rows if cols_key(raw, heads) == key) == 1:
            return COLS + COLS_SEP.join(gsjs.trim(h) for h in heads), key
    return None


def header_of(ref: hubdb.TabRef | None, *names: str, norm: bool = False) -> str | None:
    """A tab's header as the copy names it: the first of `names`, trimmed (or normKey_'d) alike."""
    if ref is None:
        return None
    for n in names:
        for h in ref.headers:
            if (hubdb.norm_key(h) == hubdb.norm_key(n)) if norm else gsjs.trim(gsjs.js_str(h)) == n:
                return gsjs.trim(gsjs.js_str(h))
    return None


def mint(prefix: str = "") -> str:
    """An id as Apps Script mints one (Utilities.getUuid), under the door's prefix."""
    return prefix + str(uuid.uuid4())


def kept_record(sid: str, tab: str, kind: str, match: str, key: str, subject: str, cells: dict,
                before: dict | None = None, edition: str = "") -> dict[str, Any]:
    """One row's cells as app.edits keeps them, with what the panel opened on and the edition that let it in."""
    rec: dict[str, Any] = {"sheet_id": sid, "tab_name": tab, "kind": kind, "match": match, "keyed": "header",
                           "row_key": key, "house": subject, "cells": {k: sheet_text(v) for k, v in cells.items()}}
    if before:
        rec["before"] = {k: sheet_text(v) for k, v in before.items() if k in rec["cells"]}
    if edition:
        rec["edition"] = edition
    return rec


def final(answer: dict[str, Any], edits: list[dict], subject: str, edition: str = "") -> Decision:
    """A write kept in app.edits as the truth and answered final; no edit, the answer as it stands."""
    kept = [e for e in edits if e and e.get("cells")]
    if not kept:
        return Decision(answer)
    return Decision(answer, edits=kept, edition=edition, subject=subject)


def group_edits(rows: list[dict]) -> dict[tuple[str, str], list[dict]]:
    """app.edits' newest cells, by tab, then by row: each row's cells {field: (id, value, born)}, oldest row first."""
    tabs: dict[tuple[str, str], dict[tuple, dict]] = {}
    for r in rows:
        by_row = tabs.setdefault((r["sheet_id"], r["tab_name"]), {})
        g = by_row.get((r["match"], r["keyed"], r["row_key"]))
        if g is None:
            g = by_row[(r["match"], r["keyed"], r["row_key"])] = {
                "match": r["match"], "keyed": r["keyed"], "row_key": r["row_key"], "appended": False, "cells": {},
                "first": int(r["born"])}
        g["appended"] = g["appended"] or bool(r["appended"])
        g["cells"][r["field"]] = (int(r["id"]), r["value"], int(r["born"]))
        g["first"] = min(g["first"], int(r["born"]))
    return {k: sorted(v.values(), key=lambda g: g["first"]) for k, v in tabs.items()}


class Own:
    """One request's view of the writes Python accepted: laid into the copy's rows (hubdb.OWN) as each tab is…"""

    def __init__(self, items: list[dict], book: Callable[[str], Any] | None = None, now: float | None = None,
                 edits: list[dict] | None = None, edits_at: float = 0.0) -> None:
        self.items = [w for w in items if w.get("state") in ("accepted", "queued", "written")]
        self.book = book
        self.now = time.time() if now is None else now
        self.held: set[str] = set()
        self.done: dict[str, str] = {}
        self.edits = EDITS.grouping(edits) if edits else {}
        # when app.edits was read: every edit kept before it is laid by this request
        self.edits_at = float(edits_at or 0.0)

    def _past(self, w: dict, ref: hubdb.TabRef) -> bool:
        """The copy was read from a sheet that had this write for a minute at least."""
        at = float(w.get("written_at") or 0)
        b = self.book(w["sheet_id"]) if self.book else None
        synced = _epoch(b.synced_at) if b is not None else 0.0
        return bool(at) and _epoch(ref.loaded_at) > at + SETTLE_S and synced > at + SETTLE_S

    def live(self, w: dict, ref: hubdb.TabRef) -> bool:
        age = self.now - float(w.get("accepted_at") or 0)
        state = w.get("state")
        if state == "accepted":
            if age < UNBOUND_S:
                return True
            self.done[w["write_id"]] = "refused"
            return False
        if state == "queued":
            if age < QUEUED_MAX_S:
                return True
            self.done[w["write_id"]] = "refused"
            return False
        if self.now - float(w.get("written_at") or 0) > RETIRE_AFTER_S or self._past(w, ref):
            self.done[w["write_id"]] = "retired"
            return False
        return True

    def _shown(self, w: dict) -> None:
        self.held.add(w["write_id"])
        if w.get("state") == "written":
            self.done[w["write_id"]] = "retired"

    @staticmethod
    def _header(ref: hubdb.TabRef, field: str, keyed: str) -> str | None:
        for h in ref.headers:
            if (hubdb.estate_key(h) if keyed == "estate" else gsjs.trim(gsjs.js_str(h))) == field:
                return h
        return None

    def _keyer(self, ref: hubdb.TabRef, match: str) -> Callable[[int, dict], str | None]:
        """A row's key under `match`, its headers looked up once."""
        if match.startswith(COLS):
            heads = [self._header(ref, h, "header") for h in match[len(COLS):].split(COLS_SEP)]
            if any(h is None for h in heads):
                return lambda _rn, _raw: None
            return lambda _rn, raw: cols_key(raw, heads) or None
        if match == "row":
            return lambda rn, _raw: f"r{rn}"
        if match == "code":
            ab, nm = self._header(ref, "abbreviation", "header"), self._header(ref, "home_name", "header")
            return lambda _rn, raw: L.home_code(raw.get(ab) if ab else "", raw.get(nm) if nm else "")
        idh = self._header(ref, "id", "header")
        if idh is None:
            return lambda _rn, _raw: None
        return lambda _rn, raw: gsjs.trim(gsjs.or_blank(raw.get(idh)))

    def _find(self, rows: list[tuple[int, dict]], ref: hubdb.TabRef, w: dict) -> int | None:
        key = w["row_key"]
        if w["match"] == "row":
            key = f"r{int(key[1:])}" if re.fullmatch(r"r\d+", key) else "\0"
        of = self._keyer(ref, w["match"])
        return next((i for i, (rn, raw) in enumerate(rows) if of(rn, raw) == key), None)

    def virtual(self, sheet_id: str, tab: str) -> hubdb.TabRef | None:
        """A tab no sheet holds, made by an edit's appended rows: its headers as those rows first wrote them."""
        born: dict[str, int] = {}
        for g in self.edits.get((sheet_id, tab)) or ():
            if g["appended"]:
                for f, (_id, _v, b) in g["cells"].items():
                    born[f] = min(born.get(f, b), b)
        if not born:
            return None
        return hubdb.TabRef(sheet_id, tab, "", tuple(sorted(born, key=lambda f: born[f])), None, -1)

    def widen(self, ref: hubdb.TabRef) -> hubdb.TabRef:
        """The tab with every header its kept edits write and the sheet lacks, after the sheet's own (ensureHeader_)."""
        groups = self.edits.get((ref.sheet_id, ref.tab))
        if not groups:
            return ref
        have = {gsjs.trim(gsjs.js_str(h)) for h in ref.headers}
        extra: list[str] = []
        for g in groups:
            if g["keyed"] != "header":
                continue
            for f in g["cells"]:
                if f not in have and f not in extra:
                    extra.append(f)
        return ref._replace(headers=tuple(ref.headers) + tuple(extra)) if extra else ref

    def lay_edits(self, ref: hubdb.TabRef, rows: list[tuple[int, dict]]) -> list[tuple[int, dict]]:
        """The newest kept value of each (row, field) over the rows, whatever the copy says; an appended row the…"""
        groups = self.edits.get((ref.sheet_id, ref.tab))
        if not groups:
            return rows
        out = list(rows)
        last = max((rn for rn, _raw in out), default=1)
        index: dict[str, dict[str, int]] = {}
        stamp: dict[tuple[int, str], int] = {}
        for g in groups:
            placed: dict[str, tuple[int, str]] = {}
            for f, (eid, v, _b) in g["cells"].items():
                h = self._header(ref, f, g["keyed"])
                if h is not None and eid > placed.get(h, (0, ""))[0]:
                    placed[h] = (eid, v)
            if not placed:
                continue
            keys = index.get(g["match"])
            if keys is None:
                of = self._keyer(ref, g["match"])
                keys = index[g["match"]] = {}
                for i, (rn, raw) in enumerate(out):
                    k = of(rn, raw)
                    if k and k not in keys:
                        keys[k] = i
            at = keys.get(g["row_key"])
            if at is None:
                if not g["appended"]:
                    continue
                last += 1
                out.append((last, {h: v for h, (_e, v) in placed.items()}))
                at = len(out) - 1
                for m, ks in index.items():
                    k = self._keyer(ref, m)(last, out[at][1])
                    if k and k not in ks:
                        ks[k] = at
                for h, (eid, _v) in placed.items():
                    stamp[(at, h)] = eid
                continue
            rn, raw = out[at]
            cells = {h: v for h, (eid, v) in placed.items() if eid > stamp.get((at, h), 0)}
            if cells:
                out[at] = (rn, {**raw, **cells})
                for h in cells:
                    stamp[(at, h)] = placed[h][0]
        return out

    def merge(self, ref: hubdb.TabRef, rows: list[tuple[int, dict]]) -> list[tuple[int, dict]]:
        return self.lay_edits(ref, self.merge_pending(ref, rows))

    def merge_pending(self, ref: hubdb.TabRef, rows: list[tuple[int, dict]]) -> list[tuple[int, dict]]:
        mine = sorted((w for w in self.items if w.get("sheet_id") == ref.sheet_id and w.get("tab_name") == ref.tab),
                      key=lambda w: float(w.get("accepted_at") or 0))
        if not mine:
            return rows
        out = list(rows)
        last = max((rn for rn, _raw in out), default=1)
        for w in mine:
            keyed = w.get("keyed") or "header"
            placed = {}
            for f, v in (w.get("cells") or {}).items():
                h = self._header(ref, f, keyed)
                if h is not None:
                    placed[h] = v
            at = self._find(out, ref, w)
            if w["kind"] == "append":
                if at is not None:
                    self._shown(w)
                    continue
                if not self.live(w, ref) or not placed:
                    continue
                last += 1
                out.append((last, placed))
                self.held.add(w["write_id"])
                continue
            if at is None or not placed:
                continue
            rn, raw = out[at]
            if all(same_cell(raw.get(h), v, keyed) for h, v in placed.items()):
                self._shown(w)
                continue
            if not self.live(w, ref):
                continue
            out[at] = (rn, {**raw, **placed})
            self.held.add(w["write_id"])
        return out


# ---- the store: app.<kind>_writes and app.<kind>_receipts in asa-hub-db, the writer role's own ------------

# app.edits: every cell a final door kept, one row per (row, field), never retired; the newest per cell is the truth
EDITS_TABLE = "app.edits"
EDIT_KINDS = ("edit", "append")
EDIT_KEYED = ("header", "estate")
EDIT_VALUE_MAX = 50000
NOT_KEPT = "The change could not be kept just now, so nothing was written. Try again in a moment."


class NotKept(Exception):
    """A final door's edits were not recorded: the whole write is rolled back and answered 503."""


# what else a void takes back with a write's cells: each (connection, write_id), in the void's transaction
VOID_HOOKS: list[Callable[[Any, str], None]] = []


SYNC_STATES = ("synced", "superseded", "pending", "missing", "withheld")


def beside(name: str) -> str:
    """A table next to app.edits (app.edit_sync, …); a stand-in edits table gets stand-ins beside it."""
    schema, _dot, table = EDITS_TABLE.rpartition(".")
    return (schema + "." if schema else "") + table.replace("edits", name, 1)


def edits_ddl() -> tuple[str, ...]:
    t = EDITS_TABLE
    states = ", ".join(f"'{s}'" for s in SYNC_STATES)
    return (
        f"create table if not exists {t} ("
        " id bigserial primary key, write_id text not null, app text not null, action text not null default '',"
        " sheet_id text not null, tab_name text not null,"
        " kind text not null default 'edit' check (kind in ('edit', 'append')),"
        " match_by text not null, keyed_by text not null default 'header', row_key text not null,"
        " field text not null, value text not null default '', before text not null default '',"
        " author text not null default '', edition text not null default '', at timestamptz not null default now())",
        f"create index if not exists edits_cell on {t} (sheet_id, tab_name, match_by, keyed_by, row_key, field, id)",
        f"create index if not exists edits_write on {t} (write_id)",
        # asa-hub-sheet-sync's word per cell: the last value both sides agreed on, and the edit it reconciled
        f"create table if not exists {beside('edit_sync')} ("
        " sheet_id text not null, tab_name text not null, match_by text not null, keyed_by text not null,"
        " row_key text not null, field text not null, edit_id bigint not null default 0,"
        f" state text not null check (state in ({states})), base_value text not null default '',"
        " sheet_value text not null default '', sheet_seen_at timestamptz, checked_at timestamptz not null default now(),"
        " synced_at timestamptz, why text not null default '',"
        " primary key (sheet_id, tab_name, match_by, keyed_by, row_key, field))",
    )


def edits_sql() -> str:
    """The newest value of each (tab, row, field), whether its row was ever appended, and when the field was first kept;
    a cell the sheet superseded after its newest edit is the copy's again."""
    return ("select id, sheet_id, tab_name, match_by, keyed_by, row_key, field, value, appended, born from ("
            " select id, sheet_id, tab_name, match_by, keyed_by, row_key, field, value,"
            " row_number() over (partition by sheet_id, tab_name, match_by, keyed_by, row_key, field order by id desc)"
            " as rn,"
            " bool_or(kind = 'append') over (partition by sheet_id, tab_name, match_by, keyed_by, row_key) as appended,"
            " min(id) over (partition by sheet_id, tab_name, match_by, keyed_by, row_key, field) as born"
            f" from {EDITS_TABLE}) x where rn = 1 and not exists (select 1 from {beside('edit_sync')} s"
            " where s.sheet_id = x.sheet_id and s.tab_name = x.tab_name and s.match_by = x.match_by"
            " and s.keyed_by = x.keyed_by and s.row_key = x.row_key and s.field = x.field"
            " and s.state = 'superseded' and s.edit_id >= x.id) order by id")


def edits_mark_sql() -> str:
    """What edits_sql's answer rests on, read in milliseconds: the ids of app.edits (a row is only ever added or
    deleted, never changed) and each superseded cell of app.edit_sync with the edit it superseded."""
    key = "||chr(31)||".join(("sheet_id", "tab_name", "match_by", "keyed_by", "row_key", "field"))
    return ("select e.n, e.top, e.total, s.n, s.ids, s.cells from"
            f" (select count(*) as n, coalesce(max(id), 0) as top, coalesce(sum(id), 0) as total from {EDITS_TABLE}) e,"
            " (select count(*) as n, coalesce(sum(edit_id), 0) as ids,"
            f" coalesce(sum(hashtext({key})::bigint), 0) as cells"
            f" from {beside('edit_sync')} where state = 'superseded') s")


class EditsHeld:
    """edits_sql's rows, and their grouping, kept between reads while edits_mark_sql reads the same: a read pays the
    mark, not the whole table. A commit to either table, by any process, moves the mark; past MAX_S the rows are read
    again whatever it says."""

    def __init__(self, max_s: float = 600.0) -> None:
        self.max_s = max_s
        self._lock = threading.Lock()
        self._held: tuple[tuple, list[dict[str, Any]], float] | None = None
        self._grouped: tuple[list[dict[str, Any]], dict] | None = None

    def matching(self, mark: tuple) -> list[dict[str, Any]] | None:
        held = self._held
        if held is not None and held[0] == mark and time.time() - held[2] < self.max_s:
            return held[1]
        return None

    def read(self, conn: Any) -> list[dict[str, Any]]:
        """The rows, on an autocommit connection: the mark, and when it moved, mark and rows read again in one
        snapshot, so the rows kept are exactly the ones their mark names."""
        got = self.matching(tuple(conn.execute(edits_mark_sql()).fetchone()))
        if got is not None:
            return got
        if int(getattr(getattr(conn, "info", None), "transaction_status", 0) or 0) != 0:
            # inside another transaction its snapshot is not one to name: read, never kept
            return [_edit_row(r) for r in conn.execute(edits_sql()).fetchall()]
        with self._lock:
            with conn.transaction():
                conn.execute("set transaction isolation level repeatable read")
                mark = tuple(conn.execute(edits_mark_sql()).fetchone())
                got = self.matching(mark)
                if got is None:
                    got = [_edit_row(r) for r in conn.execute(edits_sql()).fetchall()]
                    self._held = (mark, got, time.time())
        return got

    def grouping(self, rows: list[dict[str, Any]]) -> dict[tuple[str, str], list[dict]]:
        """group_edits(rows), made once for the rows kept here (Own only reads it)."""
        g = self._grouped
        if g is not None and g[0] is rows:
            return g[1]
        grouped = group_edits(rows)
        held = self._held
        if held is not None and held[1] is rows:
            self._grouped = (rows, grouped)
        return grouped


EDITS = EditsHeld(float(os.getenv("HUB_EDITS_HELD_MAX_S", "600")))


def _edits_shared() -> bool:
    """A stand-in table in pg_temp is one connection's own: its rows are never kept for another."""
    return not EDITS_TABLE.startswith("pg_temp.")


def _edit_row(r: tuple) -> dict[str, Any]:
    return {"id": int(r[0]), "sheet_id": r[1], "tab_name": r[2], "match": r[3], "keyed": r[4], "row_key": r[5],
            "field": r[6], "value": r[7] if r[7] is not None else "", "appended": bool(r[8]), "born": int(r[9])}


def edit_rows(write_id: str, app: str, action: str, decision: Decision, author: str) -> list[tuple]:
    """One insert per cell; NotKept for an edit that names no tab, no lasting row key, or no cell."""
    out: list[tuple] = []
    for e in decision.edits or ():
        e = e if isinstance(e, dict) else {}
        sid, tab, key = (gsjs.trim(gsjs.or_blank(e.get(k))) for k in ("sheet_id", "tab_name", "row_key"))
        kind, match, keyed = e.get("kind") or "edit", gsjs.or_blank(e.get("match")), e.get("keyed") or "header"
        cells, before = e.get("cells"), e.get("before") if isinstance(e.get("before"), dict) else {}
        # a sheet row number moves under the copy: a kept edit names a key that stays
        if not sid or not tab or not key or kind not in EDIT_KINDS or keyed not in EDIT_KEYED or not match \
                or match == "row" or not isinstance(cells, dict) or not cells:
            raise NotKept(f"an edit of {tab or '?'} is not well formed")
        edition = gsjs.or_blank(e.get("edition")) or decision.edition
        for f, v in cells.items():
            f, value = str(f), sheet_text(v)
            if not f or len(f) > 200 or len(value) > EDIT_VALUE_MAX:
                raise NotKept(f"a cell of {tab} is not well formed")
            out.append((write_id, app, action, sid, tab, kind, match, keyed, key, f, value,
                        sheet_text(before.get(f, "")), author, edition))
    return out


def keep_rows(cur: Any, write_id: str, app: str, action: str, decision: Decision, author: str) -> int:
    """Tx.record's kept edits for a door that keeps its own receipt (the sign-in, an invitation's register): the edits
    of a house kept in its own table laid there (into_tables), the rest inserted in app.edits; how many cells went
    to app.edits."""
    rows = edit_rows(write_id, app, action, decision, author)
    tabled = into_tables(cur, write_id, decision.edits or [], author)
    rows = [r for r in rows if (r[3], r[4]) not in tabled]
    if rows:
        cur.executemany(f"insert into {EDITS_TABLE} (write_id, app, action, sheet_id, tab_name, kind, match_by,"
                        " keyed_by, row_key, field, value, before, author, edition)"
                        " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)", rows)
    return len(rows)


def into_tables(cur: Any, write_id: str, edits: list[dict], author: str) -> set[tuple[str, str]]:
    """The edits of a house kept in its own table (an uploaded app.resource_columns row names its book and tab, or the
    book's Data tab holds the house) laid there as app.edits would lay them over its copy, under this write: each on
    the first row its match keys alike, an append with no such row made; the (book, tab) pairs carried, which app.edits
    leaves out."""
    import house_tables as HT  # noqa: PLC0415 - it imports this module
    import resource_rows as RR  # noqa: PLC0415
    import smart_comms as SC  # noqa: PLC0415

    def named(e: dict) -> tuple[str, str]:
        return gsjs.trim(gsjs.or_blank(e.get("sheet_id"))), gsjs.trim(gsjs.or_blank(e.get("tab_name")))

    edits = [e for e in edits if isinstance(e, dict)]
    books = sorted({named(e)[0] for e in edits} - {""})
    if not books:
        return set()
    cur.execute(f"select resource, sheet_id, tab_name from {RR.COLUMNS} where uploaded_at is not null"
                " and sheet_id = any(%s)", (books,))
    held = {(sid, tab): resource for resource, sid, tab in cur.fetchall()}
    # a house book's Data tab is the house whose rows it keeps (where_of)
    for sid in sorted({s for s, t in map(named, edits) if t == hubdb.HOUSE_DATA_TAB and (s, t) not in held}):
        home = HT.data_home(hubdb.shared(), sid, {t: r for (s, t), r in held.items() if s == sid})
        if home:
            held[(sid, hubdb.HOUSE_DATA_TAB)] = home
    mine = [(held[named(e)], e) for e in edits if named(e) in held]
    if not mine:
        return set()

    def heads_of(match: str) -> list[str]:
        return match[len(COLS):].split(COLS_SEP) if match.startswith(COLS) else ["id"]

    def key_of(match: str, cells: dict) -> str:
        return cols_key(cells, heads_of(match)) if match.startswith(COLS) else gsjs.trim(gsjs.or_blank(cells.get("id")))

    wanted: dict[tuple[str, str], set[str]] = {}
    for resource, e in mine:
        match = gsjs.or_blank(e.get("match"))
        if (e.get("keyed") or "header") != "header" or match == "code":
            raise NotKept(f"an edit of {named(e)[1]} cannot be laid on its table")
        wanted.setdefault((resource, match), set()).add(gsjs.trim(gsjs.or_blank(e.get("row_key"))))
    cells_of: dict[str, dict[str, dict]] = {}
    index: dict[tuple[str, str], dict[str, str]] = {}
    for (resource, match), keys in wanted.items():
        # the rows whose first key column holds a key's first part, keyed exactly here; the first of each key wins. A
        # table of its own is asked by the trimmed cell its index holds; the shared one by the cell holding the part
        firsts = sorted({k.split("\x1f")[0] for k in keys})
        if resource in RR.OWN_TABLES:
            col = "'" + heads_of(match)[0].replace("'", "''") + "'"
            cur.execute(f"select row_key, cells from {RR.rows_of(resource)} where resource = %s and removed_at is null"
                        f" and {RR.TRIMMED.format(col=col)} = any(%s::text[]) order by position, created_at, row_key",
                        (resource, firsts))
        else:
            cur.execute(f"select row_key, cells from {RR.rows_of(resource)} where resource = %s and removed_at is null"
                        " and exists (select 1 from unnest(%s::text[]) v where strpos(coalesce(cells->>%s, ''), v) > 0)"
                        " order by position, created_at, row_key", (resource, firsts, heads_of(match)[0]))
        held_rows, ix = cells_of.setdefault(resource, {}), index.setdefault((resource, match), {})
        for rk, c in cur.fetchall():
            c = held_rows.setdefault(rk, RR._json(c) or {})
            k = key_of(match, c)
            if k and k not in ix:
                ix[k] = rk
    token, wrote = HELD.set(cur), SC._WRITE.set({**(SC._WRITE.get() or {}), "write_id": write_id})
    try:
        for resource, e in mine:
            match = gsjs.or_blank(e.get("match"))
            cells = {str(f): sheet_text(v) for f, v in (e.get("cells") or {}).items()}
            rk = index[(resource, match)].get(gsjs.trim(gsjs.or_blank(e.get("row_key"))))
            if rk is None:
                made = {f: v for f, v in cells.items() if v != ""}
                if (e.get("kind") or "edit") != "append" or not made:
                    continue
                rk = RR.create(None, resource, made, author)  # type: ignore[arg-type]
                cells_of[resource][rk] = made
                for (r, m), ix in index.items():
                    k = key_of(m, made) if r == resource else ""
                    if k and k not in ix:
                        ix[k] = rk
                continue
            was = cells_of[resource][rk]
            changed = {f: v for f, v in cells.items() if gsjs.or_blank(was.get(f)) != v}
            if changed:
                RR.update(None, resource, rk, was, changed, author)  # type: ignore[arg-type]
                cells_of[resource][rk] = {**was, **changed}
    finally:
        SC._WRITE.reset(wrote)
        HELD.reset(token)
    if any(r == hubdb.FACTS_RESOURCE for r, _e in mine):
        hubdb.facts_touched()
    return {named(e) for _r, e in mine}


def ddl(kind: str = "location") -> tuple[str, ...]:
    return edits_ddl() + (
        f"create table if not exists app.{kind}_writes ("
        " write_id text primary key, action text not null, house text not null default '',"
        " sheet_id text not null default '', tab_name text not null default '', kind text not null default '',"
        " match_by text not null default '', keyed_by text not null default '', row_key text not null default '',"
        " cells jsonb not null default '{}', author text not null default '', state text not null,"
        " why text not null default '', accepted_at timestamptz not null default now(), settled_at timestamptz,"
        " written_at timestamptz)",
        f"create index if not exists {kind}_writes_live on app.{kind}_writes (accepted_at)"
        " where state in ('accepted', 'queued', 'written', 'decided')",
        f"create table if not exists app.{kind}_receipts ("
        " write_id text primary key, action text not null, answer jsonb not null, at timestamptz not null default now())",
    )


def live_sql(kind: str = "location") -> str:
    return ("select write_id, action, house, sheet_id, tab_name, kind, match_by, keyed_by, row_key, cells, state,"
            f" extract(epoch from accepted_at), extract(epoch from written_at) from app.{kind}_writes"
            " where state in ('accepted', 'queued', 'written') and accepted_at > now() - interval '25 hours'")


DDL = ddl()
LIVE_SQL = live_sql()


class Busy(Exception):
    """Another write holds the lock (LockService's tryLock, in Postgres)."""


def _live_row(r: tuple) -> dict[str, Any]:
    cells = r[9] if isinstance(r[9], dict) else json.loads(r[9] or "{}")
    return {"write_id": r[0], "action": r[1], "house": r[2], "sheet_id": r[3], "tab_name": r[4], "kind": r[5],
            "match": r[6], "keyed": r[7], "row_key": r[8], "cells": cells, "state": r[10],
            "accepted_at": float(r[11] or 0), "written_at": float(r[12] or 0)}


APP_OF_KIND = {"location": "locations", "client": "clients"}


class Tx:
    """One locked transaction: the receipt looked up, the pending writes read, the decision recorded."""

    def __init__(self, cur: Any, kind: str = "location") -> None:
        self.cur = cur
        self.kind = kind
        self.app = APP_OF_KIND.get(kind, kind)

    def edits(self) -> list[dict[str, Any]]:
        """app.edits as it stands under the lock: no other write can change it before this one commits."""
        if _edits_shared():
            self.cur.execute(edits_mark_sql())
            got = EDITS.matching(tuple(self.cur.fetchone()))
            if got is not None:
                return got
        self.cur.execute(edits_sql())
        return [_edit_row(r) for r in self.cur.fetchall()]

    def receipt(self, write_id: str) -> dict[str, Any] | None:
        self.cur.execute(f"select answer from app.{self.kind}_receipts where write_id = %s", (write_id,))
        got = self.cur.fetchone()
        if not got:
            return None
        return got[0] if isinstance(got[0], dict) else json.loads(got[0])

    def live(self) -> list[dict[str, Any]]:
        self.cur.execute(live_sql(self.kind))
        return [_live_row(r) for r in self.cur.fetchall()]

    def record(self, write_id: str, action: str, env: dict[str, Any], decision: Decision, author: str) -> None:
        """Write-once: the answer under its write_id, and the change the copy is laid with."""
        self.cur.execute(f"insert into app.{self.kind}_receipts (write_id, action, answer) values (%s, %s, %s::jsonb)"
                         " on conflict (write_id) do nothing", (write_id, action, json.dumps(env)))
        if decision.edits:
            rows = edit_rows(write_id, self.app, action, decision, author)
            # a house kept in its own table takes its edits there
            try:
                tabled = into_tables(self.cur, write_id, decision.edits, author)
            except NotKept:
                raise
            except Exception as exc:  # noqa: BLE001 - the whole transaction rolls back with it
                raise NotKept(f"a house's table refused its edits ({type(exc).__name__})") from exc
            rows = [r for r in rows if (r[3], r[4]) not in tabled]
            if not rows:
                return
            try:
                self.cur.executemany(
                    f"insert into {EDITS_TABLE} (write_id, app, action, sheet_id, tab_name, kind, match_by, keyed_by,"
                    " row_key, field, value, before, author, edition)"
                    " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)", rows)
            except Exception as exc:  # noqa: BLE001 - the whole transaction rolls back with it
                raise NotKept(f"app.edits refused the insert ({type(exc).__name__})") from exc
            return
        rec = decision.record
        if rec is None:
            return
        state = "decided" if decision.engine else "accepted"
        self.cur.execute(
            f"insert into app.{self.kind}_writes (write_id, action, house, sheet_id, tab_name, kind, match_by, keyed_by,"
            " row_key, cells, author, state) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)"
            " on conflict (write_id) do nothing",
            (write_id, action, rec["house"], rec["sheet_id"], rec["tab_name"], rec["kind"], rec["match"], rec["keyed"],
             rec["row_key"], json.dumps(rec["cells"]), author, state))


# a thread's writer connection by DSN, shared by every store: a store nested in another's transaction joins it
_SHARED = threading.local()


class Store:
    """The writer role's connection to asa-hub-db (HUB_DB_WRITE_DSN); none set, every write stays on Apps Script."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None, kind: str = "location",
                 label: str = "Locations") -> None:
        self.dsn = os.getenv("HUB_DB_WRITE_DSN", "").strip() if dsn is None else dsn
        self._connect = connect
        self.kind = kind
        self._local = threading.local()
        self._lock = threading.Lock()
        self.why = "" if (self.dsn or connect) else f"no HUB_DB_WRITE_DSN is set, so {label} writes are not kept"
        self._ready = False
        self._tried = 0.0
        self._tidied = 0.0

    @property
    def available(self) -> bool:
        return bool(self.dsn or self._connect)

    def _held(self) -> dict[str, Any]:
        """Where this thread keeps the connection: the store's own (a test's connect), else the one every store on
        the same DSN shares; one per store and thread outgrew asa-hub-db's 100 slots."""
        if self._connect is not None:
            return self._local.__dict__
        held = getattr(_SHARED, "conns", None)
        if held is None:
            held = _SHARED.conns = {}
        return held

    def conn(self) -> Any:
        held, key = self._held(), "conn" if self._connect is not None else self.dsn
        c = held.get(key)
        if c is not None and not c.closed and not getattr(c, "broken", False):
            # a thread's connection gone quiet is let go (hubdb.gone_quiet), unless the door's held cursor reads it
            if self._connect is not None or getattr(HELD.get(), "connection", None) is c \
                    or not hubdb.gone_quiet(c, held.get((key, "used"), 0.0)):
                if self._connect is None:
                    held[(key, "used")] = time.monotonic()
                return c
        if self._connect is not None:
            c = self._connect()
        else:
            import psycopg  # noqa: PLC0415 - the unit checks run without the driver
            c = psycopg.connect(self.dsn, autocommit=True, connect_timeout=5, application_name="asa-hub-app-writer")
            c.execute("set statement_timeout = '8s'")
            c.execute(f"set idle_session_timeout = '{hubdb.IDLE_CLOSE_S}s'")
            held[(key, "used")] = time.monotonic()
        held[key] = c
        return c

    def _drop(self) -> None:
        held = self._held().pop("conn" if self._connect is not None else self.dsn, None)
        try:
            if held is not None:
                held.close()
        except Exception:  # noqa: BLE001 - a dead connection closes as it can
            pass

    def ensure(self) -> str:
        """The tables, made when missing (the schema is the writer role's, granted by db/app-writer.sql)."""
        if not self.available:
            return self.why
        with self._lock:
            if self._ready:
                return ""
            self._tried = time.time()
            try:
                c = self.conn()
                got = c.execute("select 1 from pg_namespace where nspname = 'app'").fetchone()
                if not got:
                    raise RuntimeError("schema app is missing: apply db/app-writer.sql")
                for stmt in ddl(self.kind):
                    c.execute(stmt)
                self._ready, self.why = True, ""
            except Exception as exc:  # noqa: BLE001 - said on /healthz; writes stay on Apps Script meanwhile
                self._drop()
                self.why = f"the write store is not ready ({type(exc).__name__}: {str(exc)[:120]})"
        return self.why

    def ready(self) -> bool:
        if not self._ready and self.available and time.time() - self._tried > 60:
            self.ensure()
        return self._ready

    @contextlib.contextmanager
    def locked(self) -> Iterator[Tx]:
        """One transaction under the platform's write lock; Busy when it is not had in LOCK_WAIT."""
        c = self.conn()
        try:
            with c.transaction():
                cur = c.cursor()
                cur.execute(f"set local lock_timeout = '{LOCK_WAIT}'")
                try:
                    cur.execute("select pg_advisory_xact_lock(%s)", (LOCK_KEY,))
                except Exception as exc:
                    if getattr(exc, "sqlstate", "") == "55P03":
                        raise Busy() from exc
                    raise
                token = HELD.set(cur)
                try:
                    yield Tx(cur, self.kind)
                finally:
                    HELD.reset(token)
        except (Busy, Defer, hubdb.Unreadable):
            raise
        except NotKept:
            self._drop()
            raise
        except Exception as exc:
            if getattr(exc, "sqlstate", None) is not None or type(exc).__module__.startswith("psycopg"):
                self._drop()
                raise hubdb.Unreadable(f"the write store did not answer ({type(exc).__name__})") from exc
            raise

    def live(self) -> list[dict[str, Any]]:
        """The writes laid over the copy now; the store not answering is never "none"."""
        try:
            cur = self.conn().execute(live_sql(self.kind))
            return [_live_row(r) for r in cur.fetchall()]
        except Exception as exc:  # noqa: BLE001
            self._drop()
            raise hubdb.Unreadable(f"the write store did not answer ({type(exc).__name__})") from exc

    def edits(self) -> list[dict[str, Any]]:
        """Every kept edit, newest per cell; the store not answering is never "none"."""
        try:
            if _edits_shared():
                return EDITS.read(self.conn())
            cur = self.conn().execute(edits_sql())
            return [_edit_row(r) for r in cur.fetchall()]
        except Exception as exc:  # noqa: BLE001
            self._drop()
            raise hubdb.Unreadable(f"the edit store did not answer ({type(exc).__name__})") from exc

    @staticmethod
    def kept(kind: str, cells: dict[str, Any], fields: list[str] | None) -> dict[str, Any]:
        """The cells of a write that stood at its sheet (`fields`: the ones the door wrote)."""
        if kind == "edit" and fields is not None:
            cells = {k: v for k, v in cells.items() if k in fields or k in ("state_by", "state_at")}
            if "state" not in fields:
                cells.pop("state_by", None)
                cells.pop("state_at", None)
        return cells

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        """The relay's word on a write: queued, written (its kept fields), refused, or void (never used)."""
        c = self.conn()
        t = f"app.{self.kind}_writes"
        try:
            if state == "void":
                # a write the relay already queued is never voided by a later call under its id
                with c.transaction():
                    got = c.execute(f"select state from {t} where write_id = %s for update",
                                    (write_id,)).fetchone()
                    if got and got[0] not in ("accepted", "decided"):
                        return False
                    c.execute(f"delete from {t} where write_id = %s", (write_id,))
                    c.execute(f"delete from app.{self.kind}_receipts where write_id = %s", (write_id,))
                    # a final write the relay did not answer as written leaves no cell behind
                    c.execute(f"delete from {EDITS_TABLE} where write_id = %s", (write_id,))
                    for hook in VOID_HOOKS:
                        try:
                            with c.transaction():
                                hook(c, write_id)
                        except Exception as exc:  # noqa: BLE001 - the cells' void stands without it
                            log.warning("write store: a void hook failed for %s (%s)", write_id[:40],
                                        type(exc).__name__)
                return True
            if state == "queued":
                c.execute(f"update {t} set state = 'queued' where write_id = %s and state = 'accepted'",
                          (write_id,))
                return True
            if state == "written":
                with c.transaction():
                    got = c.execute(f"select kind, cells from {t} where write_id = %s"
                                    " and state in ('accepted', 'queued', 'decided') for update", (write_id,)).fetchone()
                    if not got:
                        return False
                    cells = got[1] if isinstance(got[1], dict) else json.loads(got[1] or "{}")
                    cells = self.kept(got[0], cells, fields)
                    c.execute(f"update {t} set state = %s, cells = %s::jsonb, written_at = now(),"
                              " settled_at = now() where write_id = %s",
                              ("written" if cells else "refused", json.dumps(cells), write_id))
                return True
            if state == "refused":
                c.execute(f"update {t} set state = 'refused', why = %s, settled_at = now()"
                          " where write_id = %s and state in ('accepted', 'queued', 'written', 'decided')",
                          (str(why)[:400], write_id))
                return True
        except Exception as exc:  # noqa: BLE001
            self._drop()
            raise hubdb.Unreadable(f"the write store did not answer ({type(exc).__name__})") from exc
        return False

    def finish(self, done: dict[str, str]) -> None:
        """Best effort: the writes a read found held by the copy (retired) or never queued (refused)."""
        if not done:
            return
        try:
            c = self.conn()
            for state in ("retired", "refused"):
                ids = [w for w, s in done.items() if s == state]
                if ids:
                    c.execute(f"update app.{self.kind}_writes set state = %s, settled_at = now()"
                              " where write_id = any(%s::text[]) and state in ('accepted', 'queued', 'written')",
                              (state, ids))
            if time.time() - self._tidied > 3600:
                self._tidied = time.time()
                c.execute(f"delete from app.{self.kind}_receipts where at < now() - make_interval(days => %s)",
                          (KEEP_DAYS,))
                c.execute(f"delete from app.{self.kind}_writes where accepted_at < now() - make_interval(days => %s)"
                          " and state not in ('accepted', 'queued', 'written')", (KEEP_DAYS,))
        except Exception as exc:  # noqa: BLE001 - the next read retires them again
            self._drop()
            log.warning("write store: the settled writes were not marked (%s)", type(exc).__name__)
