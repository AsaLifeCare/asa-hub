"""IST Records' writes on Python (IST.gs, Locations.gs locationIstFile): a notice asked again, the house map edited,
the records rebuilt from the relay's roster, a paper's link kept on its record, and the ist_due notices raised through
Smart Comms on the relay's clock — all in app.resource_rows. keep_cells is the one writer of a record's cells for every
app: Postgres once the records are uploaded, else the app.edits row laid over the house's copy."""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Callable

import gsjs
import ist as IST
import locations as L
import resource_rows as RR
import sheet_resources as SR
import smart_comms as SC
import writes as W
from scope import Defer
from writes import Decision

BUSY = "Somebody else is changing the IST records right now — try again."
LANE = "ist"

s_ = gsjs.str_


def _by(user: dict | None) -> str:
    return s_((user or {}).get("email"))


def _owned(reads: L.Reads) -> None:
    if not IST.owned(reads.db):
        raise Defer("the IST records are not uploaded to Postgres yet")


def keep_cells(reads: L.Reads, iid: str, cells: dict[str, Any], before: dict[str, Any], subject: str, by: str,
               edition: str = "") -> dict | None:
    """A record's cells written where the records live: in Postgres once uploaded (None: written), else the app.edits
    record that lays them over the house's copy."""
    if IST.owned(reads.db):
        if IST.patch(reads, iid, cells, by) is None:
            raise Defer(f"the IST record {iid} is not in Postgres")
        return None
    res = W.tab_of(reads, IST.RECORDS_TAB)
    sid, tab = W.where_of(res)
    return W.kept_record(sid, tab, "edit", "id", iid, subject, cells, before, edition)


# ---- the doors a person presses ---------------------------------------------------------------------------------

def remind(sess: L.Session, payload: dict) -> Decision:
    """istRemind: another notice asked for by hand; Smart Comms sends it on its next sweep."""
    if not IST.manager(sess.user):
        return Decision(dict(IST.DENIED))
    reads = sess.reads
    _owned(reads)
    iid = s_((payload or {}).get("id"))
    if not iid:
        return W.refuse(400, "Which row?")
    row = next((r for r in IST.records(reads) if s_(r.get("id")) == iid), None)
    if row is None:
        return W.refuse(404, "No IST row with that id.")
    if gsjs.or_text(row.get("status")).lower() == IST.STATUS_DONE and \
            not IST.lapsed(row.get("trainedAt"), IST.cfg(reads)):
        return W.refuse(400, s_(row.get("staffName")) + " is already recorded as trained on "
                        + s_(row.get("clientName")) + " — there is nothing to chase.")
    IST.patch(reads, iid, {"remindRequested": W.now_iso(reads)}, _by(sess.user))
    return Decision({"status": 200, "data": {
        "queued": True, "who": s_(row.get("staffName")),
        "message": "Queued. Smart Comms sends it on the next sweep — with the wording and the recipients from the "
                   "ist_due row, and nothing at all if that situation is off."}}, subject="", own=True)


def house_set(sess: L.Session, payload: dict) -> Decision:
    """istHouseSet: a house and client pair made, corrected, switched or removed — the records behind it stay."""
    user = sess.user or {}
    if not IST.manager(user):
        return Decision(dict(IST.DENIED))
    reads = sess.reads
    if not RR.uploaded(reads.db, IST.HOUSES):
        raise Defer("the IST house map is not uploaded to Postgres yet")
    p = payload if isinstance(payload, dict) else {}
    iid = s_(p.get("id"))
    by = _by(user)
    if iid:
        found = RR.find(reads, IST.HOUSES, iid)
        if found is None:
            return W.refuse(404, "No house mapping with that id.")
        key, cells = found
        if p.get("remove") is True:
            RR.remove(reads, IST.HOUSES, key, cells, by)
            return Decision({"status": 200, "data": {"id": iid, "removed": True, "message": "Removed. The IST rows "
                                                     "behind it are kept and marked on the next rebuild."}},
                            subject="", own=True)
        now = W.now_iso(reads)
        if "house" in p or "houseName" in p:
            change: dict[str, str] = {}
            if "house" in p:
                house = gsjs.trim(s_(p.get("house")))
                if not house:
                    return W.refuse(400, "A house code cannot be blank.")
                change["house"] = house
            if "houseName" in p:
                change["houseName"] = gsjs.trim(s_(p.get("houseName")))
            change["updatedAt"] = now
            RR.update(reads, IST.HOUSES, key, cells, change, by)
            return Decision({"status": 200, "data": {"id": iid, "message": "Saved. Counted on the next rebuild."}},
                            subject="", own=True)
        nxt = "no" if gsjs.or_text(p.get("active")).lower() == "no" else "yes"
        RR.update(reads, IST.HOUSES, key, cells, {"active": nxt, "updatedAt": now}, by)
        return Decision({"status": 200, "data": {"id": iid, "active": nxt, "message": (
            "Switched off. The IST rows behind this pair are kept and marked on the next rebuild." if nxt == "no"
            else "Switched on. Counted on the next rebuild.")}}, subject="", own=True)
    house, client_name = gsjs.trim(s_(p.get("house"))), gsjs.trim(s_(p.get("clientName")))
    if not house or not client_name:
        return W.refuse(400, "A house code and a client are both required.")
    known = next((c for c in reads.clients_derived()
                  if gsjs.name_key(c.get("name")) == gsjs.name_key(client_name)), None)
    if known is None:
        return W.refuse(400, f'No client here answers to "{client_name}". Use the name the platform knows them by — a '
                             "name nothing matches would become a row that never produces the training it is supposed "
                             "to.")
    if any(s_(r.get("house")).lower() == house.lower() and gsjs.name_key(r.get("clientName"))
           == gsjs.name_key(client_name) for r in IST.houses(reads)):
        return W.refuse(409, s_(known.get("name")) + " is already mapped to " + house + ".")
    made = IST.create(reads, IST.HOUSES, {"house": house, "houseName": gsjs.trim(s_(p.get("houseName"))),
                                          "clientName": s_(known.get("name")), "active": "yes",
                                          "source": "typed in Settings"}, by)
    return Decision({"status": 200, "data": {"id": made["id"], "clientName": s_(known.get("name"))}}, subject="",
                    own=True)


def rebuild(sess: L.Session, payload: dict) -> Decision:
    """istRebuild: who owes an IST, computed from the house map, the clients and the roster the relay handed in, and
    merged into the records — never replaced; a record whose house left the map is marked, never removed."""
    user = sess.user or {}
    if not IST.manager(user):
        return Decision(dict(IST.DENIED))
    reads = sess.reads
    _owned(reads)
    by_house = IST.house_map(reads)
    if not by_house:
        return W.refuse(503, "The house → client map (tab ist_houses) is empty, so there is nothing to compute against. "
                             "Fill it in Settings → IST — one row per house per client. Building the table without it "
                             "would say nobody owes an IST.")
    values = IST.cfg(reads)
    staff_by_house = IST.roster_by_house(payload, values)
    if staff_by_house is None:
        return W.refuse(503, "The roster could not be read, so nobody can be paired with a client right now. Nothing "
                             "was changed. Try again in a moment.")
    if not staff_by_house:
        return W.refuse(503, "The roster names nobody inside the look-back, so nobody can be paired with a client. "
                             "NOTHING was changed and no row was removed.")
    import staff as SP  # noqa: PLC0415 - People as the Staff app reads them
    clients = {gsjs.name_key(c.get("name")): c for c in reads.clients_derived() if gsjs.name_key(c.get("name"))}
    people: dict[str, dict] = {}
    try:
        for p in SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads))):
            if gsjs.name_key(p.get("name")):
                people[gsjs.name_key(p.get("name"))] = p
    except Exception:  # noqa: BLE001 - as the port: a record without contacts is still a record
        people = {}
    existing = {IST.pair_key(r.get("staffName"), r.get("clientName")) for r in IST.records(reads)}
    need_overlap = IST._ist().yes(values, "ist_pair_requires_overlap")
    now_ms = reads.now.timestamp() * 1000.0
    by = _by(user)
    kept = no_overlap = 0
    fresh: list[dict[str, Any]] = []
    no_house: list[str] = []
    unplaced: list[str] = []
    for code, names in by_house.items():
        here = staff_by_house.get(code) or {}
        clients_here = []
        for nm in names:
            hit = clients.get(gsjs.name_key(nm))
            if hit is not None:
                clients_here.append(hit)
            else:
                unplaced.append(nm + " (in ist_houses, not a client here)")
        if not clients_here:
            continue
        if not here:
            no_house.append(code)
            continue
        for staff_name, span in here.items():
            pk = gsjs.name_key(staff_name)
            person = people.get(pk)
            note: str | None = None
            for client in clients_here:
                if IST.pair_key(staff_name, client.get("name")) in existing:
                    kept += 1
                    continue
                arrived = s_(client.get("start_date"))[:10]
                if need_overlap and arrived and span["last"] < arrived:
                    no_overlap += 1
                    continue
                if note is None:
                    note = IST.cert_note(reads, values, pk, now_ms)
                fresh.append({
                    "staffName": staff_name, "staffEmail": s_((person or {}).get("email")),
                    "staffPhone": s_((person or {}).get("phone")), "avatar": s_((person or {}).get("avatar")),
                    "clientName": s_(client.get("name")), "house": code,
                    "dueDate": IST.latest_date([span["first"], s_(client.get("start_date"))]),
                    "status": IST.STATUS_OWED, "certNote": note, "trainedAt": "", "trainedBy": "", "notifiedAt": "",
                    "notifyCount": "0", "remindRequested": ""})
    IST.create_many(reads, IST.RECORDS, fresh, by)
    added = len(fresh)
    stale: list[str] = []
    mark = IST._ist().text(values, "ist_stale_marker")
    for r in IST.records(reads):
        house, was = s_(r.get("house")), s_(r.get("houseStatus"))
        known = bool(house) and house in by_house
        if not known and was != mark:
            IST.patch(reads, s_(r.get("id")), {"houseStatus": mark}, by)
            if not was:
                stale.append(s_(r.get("staffName")) + " · " + s_(r.get("clientName")) + " @ " + (house or "—"))
        elif known and was:
            IST.patch(reads, s_(r.get("id")), {"houseStatus": ""}, by)
    source = s_(IST._ist().state().get("source"))
    return Decision({"status": 200, "data": {
        "added": added, "kept": kept, "neverOverlapped": no_overlap, "configSource": source,
        "rowsWhoseHouseLeftTheMap": stale, "clientsWithoutAHouse": unplaced, "housesWithNobodyRostered": no_house}},
        subject="", own=True)


def paper_keep(sess: L.Session, payload: dict) -> Decision:
    """locationIstFile, once the relay filed the paper in Drive as asatech: the plan decided again, then the paper's
    link kept on its record."""
    p = payload if isinstance(payload, dict) else {}
    plan = IST.paper_plan(sess, {**p, "b64_chars": 1})
    if plan.get("status") != 200:
        return Decision(plan)
    data = plan["data"]
    file_id = s_(p.get("file_id"))
    if not file_id:
        return W.refuse(400, "The filed paper is not named.")
    reads = sess.reads
    _owned(reads)
    import writes as LW  # noqa: PLC0415 - Locations' own answer shapes
    cells = {"docUrl": "https://drive.google.com/file/d/" + file_id + "/view", "docFileId": file_id,
             "docAt": W.now_iso(reads), "docBy": W.who(sess.user or {})}
    row = IST.patch(reads, data["id"], cells, _by(sess.user))
    if row is None:
        return W.refuse(404, "No IST record pairs " + data["staff"] + " with " + data["client"] + " at " + data["house"]
                        + ".")
    shown = RR.shown(RR.columns(reads, IST.RECORDS), row) or {}
    cell = L.ist_cell(shown, {"name": data["client"], "client_key": data["client_key"]})
    return Decision({"status": 200, "data": LW.with_steps({"ist": cell}, LW.steps(
        "The paper in Drive and its IST record.", "The house's staff and documents, read again.", [], [],
        "Drive and sheet"))}, subject=data["house"], own=True)


def active_staff(reads: L.Reads) -> dict[str, dict]:
    """The active employees as the Staff app reads them, by name key."""
    import staff as SP  # noqa: PLC0415 - People as the Staff app reads them
    return {gsjs.name_key(p.get("name")): p for p in SP._people(reads)
            if gsjs.name_key(p.get("name")) and SP._status_active(p)}


def train_keep(sess: L.Session, payload: dict) -> Decision:
    """locationIstTrain: the trainer's word that they trained an active employee on one of the house's clients — the
    pair's IST record at the house marked done on the training day, made when the house holds none."""
    p = payload if isinstance(payload, dict) else {}
    door = W.edit_door(sess, p, L.EDITION["house"])
    if door.get("refused"):
        return W.door_refused(door)
    ctx = door["ctx"]
    reads = sess.reads
    _owned(reads)
    if p.get("confirmed") is not True:
        return W.refuse(400, "The trainer's confirmation is required — nothing was recorded.")
    person = active_staff(reads).get(gsjs.name_key(gsjs.text(p.get("staff"), 120)))
    if person is None:
        return W.refuse(400, "Trainee: pick an active employee.")
    want = gsjs.name_key(gsjs.text(p.get("client"), 120))
    client = next((c for c in ctx["clients"] if gsjs.name_key(c.get("name")) == want), None)
    if client is None:
        return W.refuse(400, "Client: pick one of " + ctx["code"] + "'s current clients.")
    day = s_(p.get("trained_on"))[:10]
    try:
        trained = datetime.strptime(day, "%Y-%m-%d").date()
    except ValueError:
        return W.refuse(400, "Training date: a day, as YYYY-MM-DD.")
    if trained > reads.now.date():
        return W.refuse(400, "Training date: a training cannot be on a day still to come.")
    staff_name, client_name = s_(person.get("name")), s_(client.get("name"))
    trainer = W.who(sess.user or {})
    pair = IST.pair_key(staff_name, client_name)
    row = next((r for r in IST.records(reads) if IST.pair_key(r.get("staffName"), r.get("clientName")) == pair
                and L.house_code(r.get("house")) == ctx["code"]), None)
    done = {"status": IST.STATUS_DONE, "trainedAt": day, "trainedBy": trainer}
    if row is not None:
        row = IST.patch(reads, s_(row.get("id")), done, _by(sess.user))
    else:
        row = IST.create(reads, IST.RECORDS, {
            "staffName": staff_name, "staffEmail": s_(person.get("email")), "staffPhone": s_(person.get("phone")),
            "avatar": s_(person.get("avatar")), "clientName": client_name, "house": ctx["code"], "dueDate": day,
            "certNote": "", "notifiedAt": "", "notifyCount": "0", "remindRequested": "", **done}, _by(sess.user))
    shown = RR.shown(RR.columns(reads, IST.RECORDS), row) or {}
    cell = L.ist_cell(shown, {"name": client_name, "client_key": client.get("client_key")})
    return Decision({"status": 200, "data": W.with_steps({"ist": cell, "staff": staff_name}, W.steps(
        "The pair's IST record, marked trained.", "The house's staff, read again.", [], [], "Postgres"))},
        subject=ctx["code"], own=True)


# ---- ist_due through Smart Comms --------------------------------------------------------------------------------

def subjects(reads: L.Reads) -> list[dict[str, str]]:
    """istSmartSubjects_, off the records where they live."""
    try:
        sits = SC.read_situations(reads.db)
    except Exception:  # noqa: BLE001 - an unread Desk paces nothing
        sits = None
    return IST.smart_subjects(reads, IST.records(reads), IST.cfg(reads), sits)


def _keys(c: dict, sit: dict) -> list[dict[str, Any]]:
    """The legs of one notice, keyed as SmartComms.gs keyed them: the person's text and letter, then each copy."""
    cid, inst = c["id"], c["instance"]
    channels = SC.smart_list(sit.get("channels"))
    legs: list[dict[str, Any]] = []
    if "sms" in channels:
        legs.append({"to": c["phone"], "channel": "sms", "own": True,
                     "key": f"smart_evt_sms_{IST.SITUATION}_{cid}_{inst[:24]}"})
    if "email" in channels and c["email"]:
        legs.append({"to": c["email"], "channel": "email", "own": True,
                     "key": f"smart_evt_mail_{IST.SITUATION}_{cid}_{inst[:24]}"})
    for i, dest in enumerate(SC.smart_list(sit.get("to"))):
        if not dest:
            continue
        email = "@" in dest
        legs.append({"to": dest, "channel": "email" if email else "sms", "team": not email, "own": False,
                     "key": f"smart_evt_cc{'' if email else 's'}{i}_{IST.SITUATION}_{cid}_{inst[:20]}"})
    return legs


def _situation(reads: L.Reads) -> dict | None:
    try:
        sit = SC.situation_row(SC.read_situations(reads.db), IST.SITUATION)
    except Exception:  # noqa: BLE001 - unread is off
        return None
    return sit if sit is not None and SC.smart_on(sit.get("enabled")) else None


def unasked(reads: L.Reads, subs: list[dict[str, str]]) -> list[dict[str, str]]:
    """The subjects whose own notice Smart Comms holds no claim on: never asked, or held by a brake since released."""
    sit = _situation(reads)
    if sit is None:
        return []
    legs = {c["id"]: [g for g in _keys(c, sit) if g["own"]] for c in subs}
    keys = [g["key"] for gs in legs.values() for g in gs]
    if not keys:
        return []
    got = RR._q(reads, f"select idem_key, state, held_by from {SC.OUTBOX} where idem_key = any(%s)", (keys,))
    seen: dict[str, list[tuple[str, str]]] = {}
    for k, state, held_by in got:
        seen.setdefault(k, []).append((s_(state), s_(held_by)))
    # the brakes are read under a write alone; a look without one counts a held notice as released, and the sweep
    # that follows decides it on the brakes themselves
    cur = W.HELD.get()
    b = SC.brakes(reads.db, cur) if cur is not None else {"hold": False, "sending": True}
    out = []
    for c in subs:
        reach = [g for g in legs[c["id"]] if (SC.sendable(g["to"]) if g["channel"] == "sms" else SC.letter_to(g["to"]))]
        if not reach:
            continue
        rows = [r for g in reach for r in seen.get(g["key"], [])]
        if any(st in SC.CLAIMS or st in ("refused", "already") or (st == "held" and (
                (hb == "test_mode" and b["hold"]) or (hb != "test_mode" and not b["sending"]) or hb == "recorded"))
               for st, hb in rows):
            continue
        out.append(c)
    return out


def notice_sweep(sess: L.Session, payload: dict) -> Decision:
    """The ist_due notices Apps Script no longer raises, on the relay's clock: each to the person and the Desk's copy
    list through Smart Comms; a record told is stamped (istMarkNotified_)."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision(dict(IST.DENIED))
    reads = sess.reads
    sit = _situation(reads)
    out: dict[str, Any] = {"situation": "on" if sit else "off", "subjects": 0, "told": 0, "held": 0, "failed": []}
    if sit is None:
        return Decision({"status": 200, "data": out}, subject="", own=True)
    started = time.time()
    subs = unasked(reads, subjects(reads))
    out["subjects"] = len(subs)
    at_ms = int(reads.now.timestamp() * 1000)
    edits: list[dict] = []
    for c in subs:
        if time.time() - started > 4.0:
            out["left"] = len(subs) - out["told"] - out["held"] - len(out["failed"])
            break
        name = c["name"]
        v = {"name": name, "first_name": (name.split() or [""])[0], "client": c["client"], "house": c["house"],
             "due": c["due"], "cert_note": c["certNote"]}
        reached = False
        for g in _keys(c, sit):
            got = SC.raise_situation(None, situation=IST.SITUATION, to=g["to"], vars=v, key=g["key"], person=name,
                                     lane=LANE, at_ms=at_ms, channel=g["channel"], team=g.get("team", False),
                                     prune=False)
            if g["own"] and got.get("state") == "sent":
                reached = True
            if g["own"] and got.get("state") == "failed":
                out["failed"].append(name + ": " + s_(got.get("why")))
        if not reached:
            out["held"] += 1
            continue
        row = next((r for r in IST.records(reads) if s_(r.get("id")) == c["id"]), None) or {}
        cells = {"notifiedAt": W.now_iso(reads), "notifyCount": str(IST._int(row.get("notifyCount")) + 1),
                 "remindRequested": ""}
        rec = keep_cells(reads, c["id"], cells, {k: gsjs.or_blank(row.get(k)) for k in cells}, s_(c["house"]),
                         "asa-hub:ist")
        if rec:
            edits.append(rec)
        out["told"] += 1
    return Decision({"status": 200, "data": out}, edits=edits or None, subject="", own=True)


# ---- the generic verbs ----------------------------------------------------------------------------------------

def _generic(verb: Callable[[L.Session, str, dict], Decision], resource: str) -> Callable[[L.Session, dict], Decision]:
    return lambda sess, payload: verb(sess, resource, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "istRemind": remind, "istHouseSet": house_set, "istRebuild": rebuild, "istNoticeSweep": notice_sweep,
    "locationIstFileKeep": paper_keep, "locationIstTrain": train_keep,
    "istRecordsCreate": _generic(SR.create_row, IST.RECORDS), "istRecordsUpdate": _generic(SR.update_row, IST.RECORDS),
    "istRecordsDelete": _generic(SR.delete_row, IST.RECORDS),
    "istHousesCreate": _generic(SR.create_row, IST.HOUSES), "istHousesUpdate": _generic(SR.update_row, IST.HOUSES),
    "istHousesDelete": _generic(SR.delete_row, IST.HOUSES),
    "istUpload": RR.upload_door({IST.RECORDS: {"tab": IST.RECORDS_TAB}, IST.HOUSES: {"tab": IST.HOUSES_TAB}})}
_ROLES = ("admin", "manager")
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY.update({"istRemind": {"roles": _ROLES}, "istHouseSet": {"roles": _ROLES}, "istRebuild": {"roles": _ROLES}})
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.ist_writes and app.ist_receipts, beside the other apps' own; the records and the map app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="ist", label="IST Records")
