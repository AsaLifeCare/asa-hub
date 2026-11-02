"""IST Records (IST.gs) on Python: the training owed per employee and client, and the house map it is computed
against — in app.resource_rows once the app is given to Python (`istRecords` from ist_records, `istHouses` from
ist_houses), else off their houses' copies. Every app that reads or writes them (Locations, Staff, My Work,
scheduling) goes through here, so they move together; the roster the rebuild pairs against is the relay's, handed in."""
from __future__ import annotations

import re
import types
from datetime import date
from typing import Any, Callable

import gsjs
import locations as L
import resource_rows as RR
import sheet_resources as SR

APP_ID = "ist"
RECORDS, HOUSES = "istRecords", "istHouses"
RECORDS_TAB, HOUSES_TAB = "ist_records", "ist_houses"
STATUS_OWED, STATUS_DONE = "owed", "done"
SITUATION = "ist_due"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
# SmartComms.gs SMART_FREQUENCIES
FREQUENCIES = {"once": 0, "daily": 1, "every_other_day": 2, "weekly": 7, "monthly": 30}
# a paper filed on an IST record (Locations.gs LOCATION_IST_FOLDER), under Compliance Docs
PAPER_FOLDER = "IST"

s_ = gsjs.str_


def manager(user: dict | None) -> bool:
    """IST.gs's door: an admin or a manager, never the service."""
    u = user or {}
    return bool(u) and not u.get("is_service") and s_(u.get("role")) in ("admin", "manager")


# ---- where the rows are ---------------------------------------------------------------------------------------

def owned(db: Any) -> bool:
    """Whether the IST records live in Postgres now (uploaded as the app was given to Python)."""
    return RR.uploaded(db, RECORDS)


def records(reads: L.Reads) -> list[dict]:
    """listRows_('istRecords')."""
    return RR.read_all(reads, RECORDS) if owned(reads.db) else reads.hub_rows(RECORDS_TAB)


def houses(reads: L.Reads) -> list[dict]:
    """listRows_('istHouses')."""
    return RR.read_all(reads, HOUSES) if RR.uploaded(reads.db, HOUSES) else reads.hub_rows(HOUSES_TAB)


def raw_records(db: Any) -> list[dict] | None:
    """The records' cells as kept, for a reader of the house's raw rows; None while the house's copy holds them."""
    if not owned(db):
        return None
    return [dict(c) for _k, c in RR.table_rows(types.SimpleNamespace(db=db), RECORDS)]


def patch(reads: L.Reads, iid: str, cells: dict[str, Any], by: str) -> dict | None:
    """updateRowById_ on a record in Postgres: its cells, with these over them; None when no record has the id."""
    hit = RR.find(reads, RECORDS, iid)
    if hit is None:
        return None
    key, before = hit
    changed = {k: "" if v is None else gsjs.js_str(v) for k, v in cells.items() if k not in ("id", "createdAt")}
    RR.update(reads, RECORDS, key, before, changed, by)
    return {**before, **changed}


def _record(fields: dict[str, Any], now: str) -> dict[str, str]:
    """createRow_'s row: the fields, an id, createdAt and updatedAt."""
    import writes as W  # noqa: PLC0415 - the writes' own helpers
    rec = {k: "" if v is None else gsjs.js_str(v) for k, v in fields.items()}
    rec["id"] = rec.get("id") or W.mint()
    rec["createdAt"] = rec.get("createdAt") or now
    rec["updatedAt"] = now
    return rec


def create(reads: L.Reads, resource: str, fields: dict[str, Any], by: str) -> dict[str, str]:
    """createRow_."""
    import writes as W  # noqa: PLC0415
    rec = _record(fields, W.now_iso(reads))
    RR.create(reads, resource, rec, by)
    return rec


def create_many(reads: L.Reads, resource: str, many: list[dict[str, Any]], by: str) -> list[dict[str, str]]:
    """createRow_ for many rows, written together."""
    import writes as W  # noqa: PLC0415
    now = W.now_iso(reads)
    recs = [_record(f, now) for f in many]
    RR.create_many(reads, resource, recs, by)
    return recs


# ---- IST.gs's helpers -----------------------------------------------------------------------------------------

def cfg(reads: L.Reads) -> dict[str, str]:
    """The IST lane's settings (ist_config), resolved."""
    import mw_shifts as MW  # noqa: PLC0415 - the one reader of ist_config on this side
    return MW.ist.rules(reads)


def _ist() -> Any:
    import mw_shifts as MW  # noqa: PLC0415
    return MW.ist


def pair_key(staff: Any, client: Any) -> str:
    """istPairKey_."""
    return gsjs.name_key(staff) + "|" + gsjs.name_key(client)


def latest_date(days: list[Any]) -> str:
    """istLatestDate_: the latest ISO day, blanks ignored."""
    best = ""
    for d in days:
        s = gsjs.or_blank(d)[:10]
        if s and (not best or s > best):
            best = s
    return best


def house_map(reads: L.Reads) -> dict[str, list[str]]:
    """istHouseMap_: house → the client names the map puts there."""
    out: dict[str, list[str]] = {}
    for r in houses(reads):
        if (gsjs.or_text(r.get("active")) or "yes").lower() == "no":
            continue
        house, client = s_(r.get("house")), s_(r.get("clientName"))
        if house and client:
            out.setdefault(house, []).append(client)
    return out


def not_a_person(name: Any, values: dict[str, str]) -> bool:
    """istNotAPerson_."""
    return _ist().not_a_person(name, values)


def lapsed(trained_at: Any, values: dict[str, str], today: date | None = None) -> bool:
    """istLapsed_: a training older than ist_valid_days is owed again."""
    ist = _ist()
    return ist.lapsed(trained_at, ist.int_of(values, "ist_valid_days"), today)


def gate_certification(reads: L.Reads, values: dict[str, str]) -> tuple[str, str]:
    """istGateCertification_: the course the row reports on and its name; a course the catalogue does not know reports
    on the shipped one."""
    import staff as SP  # noqa: PLC0415
    ist = _ist()
    shipped = ist.resolve({})[0]
    key = ist.text(values, "ist_gate_certification")
    try:
        known = set(SP.cert_keys(reads))
    except Exception:  # noqa: BLE001 - an unreadable catalogue takes the cell at its word
        known = set()
    if not key or (known and key not in known):
        return ist.text(shipped, "ist_gate_certification"), ist.text(shipped, "ist_gate_certification_label")
    return key, ist.text(values, "ist_gate_certification_label")


def cert_note(reads: L.Reads, values: dict[str, str], person_key: str, now_ms: float) -> str:
    """istCertNote_: what the gate certification says — a note, never a blocker."""
    import staff as SP  # noqa: PLC0415
    ist = _ist()
    key, label = gate_certification(reads, values)
    none = ist.text(values, "ist_note_no_certification").replace("{cert}", label)
    try:
        known = SP.cert_picture(reads, person_key)
    except Exception:  # noqa: BLE001 - as the port: no picture is no certificate on file
        known = None
    held = ((known or {}).get("certs") or {}).get(key)
    if not held or not gsjs.or_text(held.get("expires")):
        return none
    expires = gsjs.or_text(held.get("expires"))
    ms = SP._cert_ms(expires)
    if ms is None:
        return ist.text(values, "ist_note_unreadable").replace("{cert}", label).replace("{value}", s_(expires))
    if ms < now_ms:
        return ist.text(values, "ist_note_expired").replace("{cert}", label).replace("{date}", expires[:10])
    return ""


def _int(v: Any) -> int:
    """parseInt(v, 10) || 0."""
    m = re.match(r"^\s*([+-]?\d+)", gsjs.or_blank(v))
    return int(m.group(1)) if m else 0


def notice_repeats(values: dict[str, str], situations: list[dict] | None) -> bool:
    """istNoticeRepeats_: a told row goes back to the sweep only when the setting says so and ist_due's own pacing
    repeats."""
    if not _ist().yes(values, "ist_notice_repeats"):
        return False
    for r in situations or []:
        if s_(r.get("id")) != SITUATION:
            continue
        max_a = re.match(r"^\s*([+-]?\d+)", gsjs.or_blank(r.get("max_attempts")))
        days = FREQUENCIES.get((gsjs.or_text(r.get("frequency")) or "once").strip().lower(), 0)
        return bool(max_a) and int(max_a.group(1)) > 1 and bool(days)
    return False


def smart_subjects(reads: L.Reads, rows: list[dict], values: dict[str, str],
                   situations: list[dict] | None) -> list[dict[str, str]]:
    """istSmartSubjects_: owed records never told or asked to be told again, and completed ones past their validity."""
    repeats = notice_repeats(values, situations)
    today = _ist().ohio_today()
    out = []
    for r in rows:
        status = gsjs.or_text(r.get("status")).lower()
        gone = (status == STATUS_DONE or bool(s_(r.get("trainedAt")))) and lapsed(r.get("trainedAt"), values, today)
        if status != STATUS_OWED and not gone:
            continue
        asked = s_(r.get("remindRequested"))
        if not gone and _int(r.get("notifyCount")) > 0 and not asked and not repeats:
            continue
        rid = s_(r.get("id"))
        out.append({"id": rid, "name": s_(r.get("staffName")), "phone": s_(r.get("staffPhone")),
                    "email": s_(r.get("staffEmail")), "client": s_(r.get("clientName")), "house": s_(r.get("house")),
                    "due": s_(r.get("dueDate")), "certNote": s_(r.get("certNote")),
                    "instance": rid + "#" + (asked[:16] if asked else "lapsed-" + s_(r.get("trainedAt"))[:10]
                                             if gone else "first")})
    return out


def roster_by_house(payload: dict, values: dict[str, str]) -> dict[str, dict[str, dict[str, str]]] | None:
    """istStaffByHouse_ over the roster the relay handed in (its asa_schedules, the look-back applied there): house →
    person → their first and last shift; None when the relay could not read it."""
    roster = (payload or {}).get("roster")
    if not isinstance(roster, list):
        return None
    out: dict[str, dict[str, dict[str, str]]] = {}
    for r in roster:
        if not isinstance(r, dict):
            continue
        staff, house = s_(r.get("staff")), s_(r.get("house"))
        first, last = s_(r.get("first"))[:10], s_(r.get("last"))[:10]
        if not staff or not house or not first or not_a_person(staff, values):
            continue
        at = out.setdefault(house, {}).get(staff)
        if at is None:
            out[house][staff] = {"first": first, "last": last or first}
            continue
        at["first"], at["last"] = min(at["first"], first), max(at["last"], last or first)
    return out


# ---- the doors ----------------------------------------------------------------------------------------------

def house_state(sess: L.Session, payload: dict) -> dict[str, Any]:
    """istHouseState: the map, plus its two silences — a rostered house nobody is mapped to, a client with no house."""
    if not manager(sess.user):
        return dict(DENIED)
    reads = sess.reads
    try:
        rows = houses(reads)
    except Exception:  # noqa: BLE001 - as the port: an unread map lists none
        rows = []
    mapped_houses: set[str] = set()
    mapped_clients: set[str] = set()
    for r in rows:
        if (gsjs.or_text(r.get("active")) or "yes").lower() == "no":
            continue
        if s_(r.get("house")):
            mapped_houses.add(s_(r.get("house")))
        if gsjs.name_key(r.get("clientName")):
            mapped_clients.add(gsjs.name_key(r.get("clientName")))
    # the houses the roster really uses, by code (the relay's roster names no short name)
    by_house = roster_by_house(payload, cfg(reads))
    failed = by_house is None
    roster = {code: code for code in sorted(by_house or {})}
    without_clients = [{"house": c, "houseName": n} for c, n in roster.items() if c not in mapped_houses]
    without_house: list[str] = []
    try:
        for c in reads.clients_derived():
            if gsjs.name_key(c.get("name")) not in mapped_clients:
                without_house.append(s_(c.get("name")))
    except Exception:  # noqa: BLE001 - a missing client list speaks for itself
        pass
    return {"status": 200, "data": {
        "rows": [{"id": s_(r.get("id")), "house": s_(r.get("house")), "houseName": s_(r.get("houseName")),
                  "clientName": s_(r.get("clientName")), "active": gsjs.or_text(r.get("active")) or "yes",
                  "source": s_(r.get("source"))} for r in rows],
        "rosterHouses": [{"house": c, "houseName": n} for c, n in roster.items()],
        "rosterUnreadable": failed, "housesWithoutClients": without_clients, "clientsWithoutHouse": without_house}}


def notice_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """For the relay's clock: how many records Smart Comms owes an ist_due notice that it was not asked for yet."""
    if (sess.user or {}).get("is_service") is not True:
        return dict(DENIED)
    import ist_writes as IW  # noqa: PLC0415 - the sweep's own reading of what was asked
    reads = sess.reads
    return {"status": 200, "data": {"ready": True, "due": len(IW.unasked(reads, IW.subjects(reads)))}}


def paper_plan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """locationIstFile's verdict before the relay files the paper in Drive as asatech: the house's edit door, the pair's
    record at this house, the paper's type and size — and where it goes."""
    import cert_docs as CD  # noqa: PLC0415 - the papers' own type and size rules
    import writes as LW  # noqa: PLC0415 - Locations' edit door
    p = payload if isinstance(payload, dict) else {}
    door = LW.edit_door(sess, p, L.EDITION["house"])
    if door.get("refused"):
        return door["refused"]
    ctx = door["ctx"]
    staff, client_name = gsjs.text(p.get("staff"), 120), gsjs.text(p.get("client"), 120)
    if not staff or not client_name:
        return {"status": 400, "message": "staff and client are required."}
    client = next((c for c in ctx["clients"] if gsjs.name_key(c.get("name")) == gsjs.name_key(client_name)
                   or c.get("client_key") == client_name), None)
    if client is None:
        return {"status": 400, "message": "client: not a current client of " + ctx["code"] + "."}
    fname = gsjs.text(p.get("filename"), 180) or "ist-paper"
    mime = CD.file_type(fname, p.get("mime"))
    if not mime:
        return {"status": 400, "message": CD.TYPE_WORDS + " Nothing was filed."}
    chars = p.get("b64_chars")
    chars = chars if isinstance(chars, int) and not isinstance(chars, bool) else 0
    if not chars:
        return {"status": 400, "message": "The file is required."}
    if chars > 21000000:
        return {"status": 400, "message": "The file is too large — up to 15MB."}
    pair = pair_key(staff, client.get("name"))
    row = next((r for r in records(sess.reads) if pair_key(r.get("staffName"), r.get("clientName")) == pair
                and L.house_code(r.get("house")) == ctx["code"]), None)
    if row is None:
        return {"status": 404, "message": "No IST record pairs " + staff + " with " + s_(client.get("name")) + " at "
                                          + ctx["code"] + "."}
    root = gsjs.trim(sess.reads.db.prop("HUB_PLATFORM_FOLDER_ID")) or CD.PLATFORM_ROOT
    return {"status": 200, "data": {
        "id": s_(row.get("id")), "house": ctx["code"], "staff": staff, "client": s_(client.get("name")),
        "client_key": gsjs.or_text(client.get("client_key")), "folder": PAPER_FOLDER, "platform_root": root,
        "mime": mime, "name": ("IST - " + staff + " - " + s_(client.get("name")) + " - " + fname)[:200]}}


def generic_list(resource: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    return lambda sess, payload: SR.list_rows(sess, resource, payload)


def generic_get(resource: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    return lambda sess, payload: SR.get_row(sess, resource, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "istHouseState": house_state, "istNoticeDue": notice_due, "locationIstFilePlan": paper_plan,
    "istRecordsList": generic_list(RECORDS), "istRecordsGet": generic_get(RECORDS),
    "istHousesList": generic_list(HOUSES), "istHousesGet": generic_get(HOUSES)}
POLICY: dict[str, dict[str, Any]] = {"istHouseState": {"roles": ("admin", "manager")}, "istNoticeDue": {},
                                     "locationIstFilePlan": {}, "istRecordsList": {}, "istRecordsGet": {},
                                     "istHousesList": {}, "istHousesGet": {}}
