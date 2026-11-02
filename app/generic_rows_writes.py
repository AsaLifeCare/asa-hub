"""The last of Main.gs route()'s own resources on Python, their writes: the generic create, update and delete each
decided by the app whose rows they are and kept where that app keeps them — app.resource_rows for the tabs kept in
Postgres (sheet_resources.SPECS: createRow_, updateRowById_, deleteRowById_ there), app.edits over the sheet's copy for
the tabs their apps' writers keep there (sheet_resources.COPY: a row appended or its cells kept, a row taken off by the
`delete` book op), the estate's House Inventory List as estateRoute_ writes it, and the Directory's directors as
directorsRoute_ writes them. Each app given these tabs has an upload door that brings them into Postgres from their
sheets. Nothing is asked of Apps Script."""
from __future__ import annotations

import json
import re
import secrets
from typing import Any, Callable

import call_offs_writes as COW
import client_care_records as CCR
import client_care_writes as CCW
import client_writes as CW
import directors as D
import finance_writes as FIW
import forms_writes as FOW
import generic_rows as GR
import gsjs
import house_repair_writes as HRW
import house_tables as HT
import hubdb
import learning_writes as LEW
import location_files_writes as LFW
import locations as L
import ops_stragglers as OS
import ops_stragglers_writes as OSW
import quo_writes as QUW
import resource_rows as RR
import row_ops as RO
import sheet_resources as SR
import smart_comms_writes as SCW
import transportation_writes as TRW
import writes as W
from writes import Decision

BUSY = {"status": 409, "message": W.BUSY}
SHEET_BUSY = {"status": 503, "message": "The sheet is busy — try again in a moment."}
INVENTORY = GR.ESTATE_INVENTORY
# ESTATE_WITNESS, and the cells an inventory row is found by (it carries no id)
INVENTORY_WITNESS = "item"
INVENTORY_KEYS = LFW.ASSET_KEYS
INVENTORY_WORDS = ("the row on the House Inventory List.", "The inventory's kept copy, read again.")
DIRECTORS_DENIED = {"status": 403, "message": "Directors can only be edited by admins and managers."}
# each app's upload door: the tabs it keeps in Postgres from now on, brought in from their sheets
UPLOADS: dict[str, tuple[str, tuple[str, ...]]] = {
    "meals": ("mealPlansUpload", ("mealPlans",)),
    "inventory": ("inventoryItemsUpload", ("inventoryItems",)),
    "transportation": ("transportationTabsUpload", ("fleetVehicles", "mileageLogs", "routes")),
    "render-sheet": ("renderSheetTabsUpload", ("diseases", "projects")),
    "potential-clients": ("leadsUpload", ("leads",)),
    "client-care": ("clientRecordsUpload", ("clientNotes", "marErrors", "missingMedications", "incidents")),
    "shiftboard": ("shiftTabsUpload", ("shifts", "shiftCards", "shiftMatrix", "shiftTimeline")),
    "teamboard": ("teamProjectsUpload", ("teamProjects",)),
}

s_ = gsjs.str_


# ---- the tabs kept on their copy (sheet_resources.COPY) -----------------------------------------------------------

def _tab(reads: L.Reads, resource: str) -> tuple[str, str, hubdb.TabRef | None]:
    return OS.tab(reads, SR.COPY[resource]["tab"])


def _finder(reads: L.Reads, resource: str) -> Callable[[str], dict | None]:
    return lambda rid: GR.copy_find(reads, resource, rid)


def copy_create(sess: L.Session, resource: str, p: dict, action: str) -> Decision:
    """route(resource, 'create'): createRow_ — the payload's fields, an id, createdAt and updatedAt, appended after the
    tab's last row (its header widened for a field it lacks); the place is never the caller's to say."""
    refused = SR.gate(sess, resource, "create")
    if refused:
        return Decision(refused)
    reads, user = sess.reads, sess.user or {}
    record = dict(p)
    owned = SR._owned(sess, resource, "create", record)
    if owned:
        return Decision(owned)
    record.pop("tenant", None)
    held = OSW._held(reads)
    if held is not None:
        return held
    now = W.now_iso(reads)
    if gsjs.falsy(record.get("id")):
        record["id"] = W.mint()
    if gsjs.falsy(record.get("createdAt")):
        record["createdAt"] = now
    record["updatedAt"] = now
    sid, tab, ref = _tab(reads, resource)
    rid = gsjs.js_str(record["id"])
    header = RO.queue_columns(resource, sid, tab, ref, list(record), W.who(user), action)
    cells = {h: COW.serialize(record.get(h)) for h in header}
    if any(gsjs.or_blank(r.get("id")) == rid for r in OS.all_rows(reads, SR.COPY[resource]["tab"])):
        # a kept append is found by its id, and this id names a row already: appended to the sheet as it is
        RO.queue_append(resource, sid, tab, cells, rid, W.who(user), action)
        return Decision({"status": 200, "data": record}, subject=rid, own=True, fresh=(sid,))
    d = W.final({"status": 200, "data": record}, [W.kept_record(sid, tab, "append", "id", rid, rid, cells)], rid)
    d.fresh = (sid,)
    return d


def copy_update(sess: L.Session, resource: str, p: dict, action: str) -> Decision:
    """route(resource, 'update'): updateRowById_ — the row merged with the patch, createdAt immutable, updatedAt
    refreshed; the cells the patch names kept, a column the tab lacks added."""
    refused = SR.gate(sess, resource, "update")
    if refused:
        return Decision(refused)
    reads, user = sess.reads, sess.user or {}
    patch = dict(p)
    find = _finder(reads, resource)
    owned = SR._owned(sess, resource, "update", patch, find=find)
    if owned:
        return Decision(owned)
    patch.pop("tenant", None)
    mine = SR._client_write_refused(sess, resource, patch, find=find)
    if mine is not None:
        return mine
    held = OSW._held(reads)
    if held is not None:
        return held
    if "id" not in patch or patch["id"] == "":
        return W.refuse(400, SR.NO_ID)
    want = gsjs.js_str(patch["id"])
    sid, tab, ref = _tab(reads, resource)
    row = find(want)
    if ref is None or row is None:
        return W.refuse(404, f'No "{resource}" record with id "{want}".', fresh=(sid,))
    now = W.now_iso(reads)
    SR._stamp(resource, row, patch, now)
    merged = dict(row)
    changed: dict[str, Any] = {}
    for k, v in patch.items():
        if k == "createdAt":
            continue
        merged[k] = v
        if k != "id":
            changed[k] = v
    merged["updatedAt"] = changed["updatedAt"] = now
    RO.queue_columns(resource, sid, tab, ref, list(changed), W.who(user), action)
    raw = next((r for _rn, r in reads.db.rows(ref) if gsjs.or_blank(hubdb.typed(r.get("id"), "raw")) == want), {})
    cells = {k: COW.serialize(v) for k, v in changed.items()}
    before = {k: gsjs.or_blank(hubdb.typed(raw.get(k), "raw")) for k in cells}
    d = W.final({"status": 200, "data": merged}, [W.kept_record(sid, tab, "edit", "id", want, want, cells, before)],
                want)
    d.fresh = (sid,)
    return d


def copy_delete(sess: L.Session, resource: str, p: dict, action: str) -> Decision:
    """route(resource, 'delete'): deleteRowById_ — the first row with this id taken out of its tab by the `delete` op
    (a row Python appended that the sheet does not hold yet withdrawn from app.edits instead)."""
    refused = SR.gate(sess, resource, "delete")
    if refused:
        return Decision(refused)
    reads, user = sess.reads, sess.user or {}
    p = dict(p)
    find = _finder(reads, resource)
    owned = SR._owned(sess, resource, "delete", p, find=find)
    if owned:
        return Decision(owned)
    mine = SR._client_write_refused(sess, resource, p, find=find)
    if mine is not None:
        return mine
    held = OSW._held(reads)
    if held is not None:
        return held
    rid = p.get("id")
    if rid is None or rid == "":
        return W.refuse(400, SR.NO_ID)
    want = gsjs.js_str(rid)
    sid, tab, ref = _tab(reads, resource)
    if find(want) is None:
        return W.refuse(404, f'No "{resource}" record with id "{want}".', fresh=(sid,))
    withdrew = [] if RO.in_copy(reads, ref, want) else RO.withdraw(
        sid, tab, lambda g: g["match"] == "id" and g["row_key"] == want)
    RO.queue_delete(resource, sid, tab, {"match": "id", "key": want, "which": "first", "expect": {}}, want,
                    W.who(user), action, withdrew)
    return Decision({"status": 200, "data": {"id": rid, "deleted": True}}, subject=want, own=True, fresh=(sid,))


# ---- the estate's House Inventory List (estateRoute_) -------------------------------------------------------------

def _inventory_refused(sess: L.Session) -> Decision | None:
    """hubAdapterPlaceGate_, then estateRoute_'s writers' line (houseInventory files nothing for anyone else)."""
    if GR._here(sess.user):
        return Decision({"status": 404, "message": GR.UNKNOWN_RESOURCE.format(INVENTORY)})
    if not CW.writer(sess.user):
        return Decision(CW.denied())
    return None


def _read_row(ref: hubdb.TabRef, raw: dict, n: int) -> dict[str, Any]:
    """estateReadRow_ of row n, its cells as the sheet reads them back."""
    row: dict[str, Any] = {"id": f"r{n}"}
    for h in ref.headers:
        k = hubdb.estate_key(h)
        if k:
            row[k] = hubdb.estate_cell(hubdb.typed(raw.get(h), "estate"))
    return row


def inventory_create(sess: L.Session, p: dict) -> Decision:
    """estateRoute_ create: the payload's columns laid on the sheet's headers by estateKey_ and appended after its last
    row, answered as estateReadRow_ reads it back; kept under its item and street, the cells an inventory row is
    found by, refused when another row holds them both."""
    refused = _inventory_refused(sess)
    if refused is not None:
        return refused
    reads = sess.reads
    sid, ref = OSW._incident_sheet(reads, INVENTORY)
    if ref is None:
        return W.refuse(500, f'The "{INVENTORY}" sheet could not be opened.', fresh=(sid,) if sid else False)
    keys = [hubdb.estate_key(h) for h in ref.headers]
    cells = {gsjs.trim(gsjs.js_str(h)): W.sheet_text(p[k]) for h, k in zip(ref.headers, keys)
             if k and k in p and p[k] is not None}
    rows = reads.db.rows(ref)
    last = max((rn for rn, raw in rows if OSW._filled(raw)), default=1)
    if not any(gsjs.trim(v) for v in cells.values()):
        # appendRow of blanks adds no row: the sheet's last row is what estateReadRow_ reads back
        raw = next((r for rn, r in rows if rn == last), {})
        return Decision({"status": 200, "data": _read_row(ref, raw, last)}, fresh=(sid,))
    heads = [next((h for h, k in zip(ref.headers, keys) if k == want), None) for want in INVENTORY_KEYS]
    if any(h is None for h in heads):
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(sid,))
    key = "\x1f".join(gsjs.trim(cells.get(gsjs.trim(gsjs.js_str(h)), "")) for h in heads)
    match = W.COLS + W.COLS_SEP.join(gsjs.trim(gsjs.js_str(h)) for h in heads)
    own = hubdb.OWN.get()
    kept = (getattr(own, "edits", None) or {}).get((sid, ref.tab)) or ()
    if not key.replace("\x1f", "") or any(W.cols_key(raw, heads) == key for _rn, raw in rows) or \
            any(g["match"] == match and g["row_key"] == key for g in kept):
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(sid,))
    rid = f"r{last + 1}"
    row = _read_row(ref, {h: cells.get(gsjs.trim(gsjs.js_str(h)), "") for h in ref.headers}, last + 1)
    out = W.final({"status": 200, "data": row}, [W.kept_record(sid, ref.tab, "append", match, key, rid, cells)], rid)
    out.fresh = (sid,)
    return out


def inventory_update(sess: L.Session, p: dict) -> Decision:
    """estateRoute_ update: a writer's change on the row its r<row> id names, checked against its witness (the
    item), header-bound — only the columns the sheet has and the caller sent; answered with the row as it reads after."""
    refused = _inventory_refused(sess)
    if refused is not None:
        return refused
    reads = sess.reads
    got = OSW._incident_row(reads, p, INVENTORY, INVENTORY_WITNESS)
    if got.get("refused"):
        return got["refused"]
    sid, ref, at, row_num, raw, current = (got[k] for k in ("sid", "ref", "at", "row_num", "raw", "current"))
    heads = CCR._estate_heads(ref)
    sent = {k: p[k] for k in heads if k in p}
    if not sent:
        return W.refuse(400, "Nothing to update — no known column was sent.", fresh=(sid,))
    after = dict(current)
    written: list[dict] = []
    for k, v in sent.items():
        text = W.sheet_text(v)
        after[k] = hubdb.estate_cell(hubdb.typed(text, "estate"))
        was = gsjs.or_blank(hubdb.typed(raw.get(heads[k][0]), "raw"))
        # a cell set to what it holds changes nothing on the sheet
        if gsjs.trim(text) != gsjs.trim(was):
            written.append({"field": k, "before": was, "after": text})
    answer = {"status": 200, "data": after}
    if not written:
        return Decision(answer, fresh=(sid,))
    if at is None:
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(sid,))
    d = W.estate_kept(reads, ref, row_num, INVENTORY, written, [], {}, INVENTORY_WORDS, "", "", INVENTORY_KEYS)
    if d.edits:
        d.answer = answer
    return d


def inventory_delete(sess: L.Session, p: dict) -> Decision:
    """estateRoute_ delete: a writer's removal of the row its r<row> id names, checked against its witness. The House
    Inventory List has no column to mark it, so the row leaves the sheet (deleteRow), by the `delete` op naming it by
    its item and street (else every cell) and expecting the item the screen showed."""
    refused = _inventory_refused(sess)
    if refused is not None:
        return refused
    reads, user = sess.reads, sess.user or {}
    got = OSW._incident_row(reads, p, INVENTORY, INVENTORY_WITNESS)
    if got.get("refused"):
        return got["refused"]
    sid, ref, rows, at, row_num, raw = (got[k] for k in ("sid", "ref", "rows", "at", "row_num", "raw"))
    if at is None:
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(sid,))
    heads = CCR._estate_heads(ref)
    sets = [[heads[k][0] for k in INVENTORY_KEYS if k in heads], [h for h in ref.headers if gsjs.trim(gsjs.js_str(h))]]
    named = W.row_key_of(rows, at, [s for s in sets if s])
    if named is None:
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(sid,))
    CW.marked(*raw.values())
    where = dict(zip(OSW._cols(named[0]), named[1].split("\x1f")))
    witness = gsjs.trim(gsjs.js_str(heads[INVENTORY_WITNESS][0])) if INVENTORY_WITNESS in heads else ""
    expect = {witness: gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(heads[INVENTORY_WITNESS][0]), "raw")))} \
        if witness else {}
    copied = max((rn for rn, r in reads.db._copy_rows(ref) if OSW._filled(r)), default=1)
    # a row Python appended that the sheet does not hold yet: its kept append withdrawn, the delete still queued
    withdrew = [] if row_num <= copied else RO.withdraw(
        sid, ref.tab,
        lambda g: bool(OSW._cols(g["match"])) and W.cols_key(raw, OSW._cols(g["match"])) == g["row_key"])
    RO.queue_delete(INVENTORY, sid, ref.tab, {"where": where, "which": "only", "expect": expect}, f"r{row_num}",
                    W.who(user), "houseInventoryDelete", withdrew)
    return Decision({"status": 200, "data": {"id": p.get("id"), "deleted": True}}, subject="", own=True,
                    fresh=(sid,))


# ---- the Directory's directors (directorsRoute_) ------------------------------------------------------------------

def _directory(reads: L.Reads) -> tuple[str, hubdb.TabRef]:
    """directorsSheet_: the Directory's directors tab as the copy holds it."""
    sid = reads.db.prop(D.DIRECTORY_PROP)
    ref = reads.tab_of(sid, D.DIRECTORS_TAB, "the directory") if sid else None
    if ref is None:
        raise hubdb.Unreadable("Directory tab missing: " + D.DIRECTORS_TAB)
    return sid, ref


def _directors_write(reads: L.Reads, user: dict | None) -> bool:
    """directorsCanWrite_: the account's people.edit override, else an admin or a manager."""
    import interviews as IV  # noqa: PLC0415 - the account's permoverrides, read only here
    u = user or {}
    if not u or u.get("is_service"):
        return False
    ov = IV._overrides(reads, u).get("people.edit")
    if ov is True:
        return True
    if ov is False:
        return False
    return s_(u.get("role")) in ("admin", "manager")


_num = D._num


def director_fields(p: dict) -> dict[str, Any]:
    """directorFields_: the payload's fields as the Directory stores them."""
    f: dict[str, Any] = {}
    for k in ("name", "title"):
        if k in p:
            f[k] = s_(p[k])
    av = p["avatar"] if "avatar" in p else p.get("photo") if "photo" in p else None
    if "avatar" in p or "photo" in p:
        f["avatar"] = s_(av)[:500]
    for k in ("email", "phone", "office"):
        if k in p:
            f[k] = s_(p[k])
    if "status" in p:
        f["status"] = s_(p["status"]) or "active"
    if "tenure" in p:
        f["tenure"] = s_(p["tenure"])
    if "tenureYears" in p:
        f["tenure_years"] = _num(p["tenureYears"])
    if "focusAreas" in p:
        fa = p["focusAreas"]
        parts = re.split(r"[|,]", fa) if isinstance(fa, str) else (fa or [])
        f["focus_areas"] = " | ".join(t for t in (s_(x).strip() for x in parts) if t)
    if "bio" in p:
        bio = p["bio"]
        if isinstance(bio, str):
            bio = [t for t in (x.strip() for x in re.split(r"\n\s*\n", bio)) if t]
        f["bio"] = json.dumps(bio if isinstance(bio, list) else [], separators=(",", ":"), ensure_ascii=False)
    if "career" in p:
        car = p["career"]
        f["career"] = json.dumps(car if isinstance(car, list) else [], separators=(",", ":"), ensure_ascii=False)
    if "directReports" in p:
        f["direct_reports"] = _num(p["directReports"])
    if "housesOverseen" in p:
        f["houses_overseen"] = _num(p["housesOverseen"])
    return f


def _norm(h: Any) -> str:
    return hubdb.norm_key(h)


def _laid(reads: L.Reads, ref: hubdb.TabRef) -> list[dict]:
    """readTabNormalized_ of the directors tab, Python's kept edits laid."""
    return reads.db.normalized_rows(ref)


def _id_head(ref: hubdb.TabRef) -> str:
    return next((gsjs.trim(gsjs.js_str(h)) for h in ref.headers if _norm(h) == "id"), "id")


def _cells(headers: Any, by_key: dict[str, Any]) -> dict[str, Any]:
    """Each header's value: the first field whose normKey_ is the header's own."""
    out: dict[str, Any] = {}
    for h in headers:
        name, n = gsjs.trim(gsjs.js_str(h)), _norm(h)
        if not name:
            continue
        hit = next((k for k in by_key if _norm(k) == n), None)
        if hit is not None:
            out[name] = by_key[hit]
    return out


def _public(row: dict) -> dict | None:
    d = D.public(row)
    return d if d["id"] and d["name"] else None


def director_create(sess: L.Session, p: dict) -> Decision:
    """directorsRoute_ create: a director appended to the Directory, answered as directorById_ reads it back."""
    reads, user = sess.reads, sess.user or {}
    if not _directors_write(reads, user):
        return Decision(dict(DIRECTORS_DENIED))
    fields = director_fields(p)
    if not fields.get("name"):
        return W.refuse(400, "Name is required.")
    now = W.now_iso(reads)
    rid = "dir-" + secrets.token_hex(3)
    by_key: dict[str, Any] = {"id": rid, "status": fields.get("status") or "active", "created_at": now,
                              "updated_at": now, "updated_by": "asa-hub:" + s_(user.get("email"))}
    by_key.update(fields)
    if HT.tabled(D.DIRECTORS_TAB):
        cells = _cells(HT.raw(reads, D.DIRECTORS_TAB)[0], by_key)
        RR.create(reads, D.RESOURCE, {k: COW.serialize(v) for k, v in cells.items()}, W.who(user))
        return Decision({"status": 200, "data": _public({_norm(k): v for k, v in cells.items()})}, subject=rid,
                        own=True)
    sid, ref = _directory(reads)
    cells = _cells(ref.headers, by_key)
    shown = _public({_norm(k): v for k, v in cells.items()})
    d = W.final({"status": 200, "data": shown}, [W.kept_record(sid, ref.tab, "append", _id_head(ref), rid, rid,
                                                               {k: COW.serialize(v) for k, v in cells.items()})], rid)
    d.fresh = (sid,)
    return d


def _director_row(reads: L.Reads, ref: hubdb.TabRef, want: str) -> dict | None:
    """directorFindRow_: the first row whose id is this one."""
    return next((r for r in _laid(reads, ref) if s_(r.get("id")) == want), None)


def director_update(sess: L.Session, p: dict) -> Decision:
    """directorsRoute_ update: the fields the payload names kept on the director's row (a column the tab lacks is not
    added), answered as directorById_ reads it back."""
    reads, user = sess.reads, sess.user or {}
    if not _directors_write(reads, user):
        return Decision(dict(DIRECTORS_DENIED))
    want = s_(p.get("id"))
    fields = director_fields(p)
    fields["updated_at"] = W.now_iso(reads)
    fields["updated_by"] = "asa-hub:" + s_(user.get("email"))
    if HT.tabled(D.DIRECTORS_TAB):
        row = next((r for r in D.normalized(reads) if s_(r.get("id")) == want), None)
        hit = HT.find(reads, D.DIRECTORS_TAB, "id", want)
        if row is None or hit is None:
            return W.refuse(404, f'No director "{want}".')
        cells = _cells(HT.raw(reads, D.DIRECTORS_TAB)[0], fields)
        RR.update(reads, D.RESOURCE, hit[0], hit[1], {k: COW.serialize(v) for k, v in cells.items()}, W.who(user))
        return Decision({"status": 200, "data": _public({**row, **{_norm(k): v for k, v in cells.items()}})},
                        subject=want, own=True)
    sid, ref = _directory(reads)
    row = _director_row(reads, ref, want)
    if row is None:
        return W.refuse(404, f'No director "{want}".', fresh=(sid,))
    cells = _cells(ref.headers, fields)
    merged = {**row, **{_norm(k): v for k, v in cells.items()}}
    raw = next((r for _rn, r in reads.db.rows(ref) if s_(hubdb.typed(r.get(_id_head(ref)), "raw")) == want), {})
    before = {k: gsjs.or_blank(hubdb.typed(raw.get(k), "raw")) for k in cells}
    d = W.final({"status": 200, "data": _public(merged)},
                [W.kept_record(sid, ref.tab, "edit", _id_head(ref), want, want,
                               {k: COW.serialize(v) for k, v in cells.items()}, before)], want)
    d.fresh = (sid,)
    return d


def director_delete(sess: L.Session, p: dict) -> Decision:
    """directorsRoute_ delete: the director's row taken out of the Directory by the `delete` op."""
    reads, user = sess.reads, sess.user or {}
    if not _directors_write(reads, user):
        return Decision(dict(DIRECTORS_DENIED))
    want = s_(p.get("id"))
    if HT.tabled(D.DIRECTORS_TAB):
        hit = HT.find(reads, D.DIRECTORS_TAB, "id", want)
        if hit is None:
            return W.refuse(404, f'No director "{want}".')
        RR.remove(reads, D.RESOURCE, hit[0], hit[1], W.who(user))
        return Decision({"status": 200, "data": {"id": want, "deleted": True}}, subject=want, own=True)
    sid, ref = _directory(reads)
    if _director_row(reads, ref, want) is None:
        return W.refuse(404, f'No director "{want}".', fresh=(sid,))
    head = _id_head(ref)
    withdrew = [] if RO.in_copy(reads, ref, want) else RO.withdraw(
        sid, ref.tab, lambda g: g["match"] == head and g["row_key"] == want)
    RO.queue_delete(D.RESOURCE, sid, ref.tab, {"match": head, "key": want, "which": "first", "expect": {}}, want,
                    W.who(user), "directorsDelete", withdrew)
    return Decision({"status": 200, "data": {"id": want, "deleted": True}}, subject=want, own=True, fresh=(sid,))


# ---- each app's doors, its upload door, and its store -------------------------------------------------------------

def _rows_door(resource: str, verb: str) -> Callable[[L.Session, dict], Decision]:
    kept = GR.ROUTES[resource][3]
    run = {"create": SR.create_row, "update": SR.update_row, "delete": SR.delete_row}[verb]

    def door(sess: L.Session, payload: dict) -> Decision:
        return run(sess, kept, payload)
    door.__doc__ = f"route('{resource}', '{verb}') in Postgres (sheet_resources)."
    return door


def _copy_door(resource: str, verb: str) -> Callable[[L.Session, dict], Decision]:
    run = {"create": copy_create, "update": copy_update, "delete": copy_delete}[verb]
    action = GR.door_of(resource, verb)

    def decide(sess: L.Session, payload: dict) -> Decision:
        return run(sess, resource, payload, action)
    decide.__doc__ = f"route('{resource}', '{verb}') over the copy, kept in app.edits."
    return OSW._door(resource, verb, decide)


INVENTORY_DOORS = {"create": inventory_create, "update": inventory_update, "delete": inventory_delete}


def _writes_of(resource: str) -> dict[str, Callable[[L.Session, dict], Decision]]:
    kind = GR.ROUTES[resource][2]
    if kind in GR.READ_ONLY_KINDS:
        return {}
    if kind == "estate":
        return {GR.door_of(resource, v): OSW._door(resource, v, INVENTORY_DOORS[v]) for v in INVENTORY_DOORS}
    make = _rows_door if kind == "rows" else _copy_door
    return {GR.door_of(resource, v): make(resource, v) for v in ("create", "update", "delete")}


WRITES_OF: dict[str, dict[str, Callable[[L.Session, dict], Decision]]] = {}
for _res in GR.ROUTES:
    if GR.ROUTES[_res][2] not in GR.READ_ONLY_KINDS:
        WRITES_OF.setdefault(GR.ROUTES[_res][0], {}).update(_writes_of(_res))
for _app, (_door_name, _resources) in UPLOADS.items():
    WRITES_OF.setdefault(_app, {})[_door_name] = RR.upload_door({r: SR.SPECS[r] for r in _resources})
# the generic verbs declare no roles; each door's own gate decides
POLICY_OF: dict[str, dict[str, dict[str, Any]]] = {a: {d: {} for d in doors} for a, doors in WRITES_OF.items()}
# the writes that answer away from headquarters as route() does (the inventory's place gate is its own)
PLACE_SAFE_OF: dict[str, frozenset[str]] = {
    "house-repair": frozenset(GR.door_of(INVENTORY, v) for v in INVENTORY_DOORS)}
BUSY_OF_OF: dict[str, dict[str, dict[str, Any]]] = {
    a: {d: dict(SHEET_BUSY if d.startswith(INVENTORY) else BUSY) for d in doors} for a, doors in WRITES_OF.items()}
# the Directors list's writes, at home (the relay's settings-tools rung asks them of this app)
DIRECTORS_ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "directorsCreate": OSW._door(D.RESOURCE, "create", director_create),
    "directorsUpdate": OSW._door(D.RESOURCE, "update", director_update),
    "directorsDelete": OSW._door(D.RESOURCE, "delete", director_delete)}
DIRECTORS_POLICY: dict[str, dict[str, Any]] = {a: {} for a in DIRECTORS_ACTIONS}
DIRECTORS_BUSY: dict[str, dict[str, Any]] = {a: dict(BUSY) for a in DIRECTORS_ACTIONS}


class FormsStore(OSW._CancelsOps, FOW.Store):
    """Forms' own store, a generic removal's book op taken back with its write."""


class QuoStore(OSW._CancelsOps, QUW.Store):
    """The Quo inbox's own store, a generic removal's book op taken back with its write."""


class SmartCommsStore(OSW._CancelsOps, SCW.Store):
    """Smart Comms' own store, a generic removal's book op taken back with its write."""


class LearningStore(OSW._CancelsOps, LEW.Store):
    """Learning's own store, a generic removal's book op taken back with its write."""


class FinanceStore(OSW._CancelsOps, FIW.Store):
    """Client Finances' own store, a generic removal's book op taken back with its write."""


class ClientCareStore(OSW._CancelsOps, CCW.Store):
    """Client Care's own store, a generic removal's book op taken back with its write."""


class HouseRepairStore(OSW._CancelsOps, HRW.Store):
    """House Repair's own store, an inventory row's removal taken back with its write."""


class TransportationStore(RR.Store, TRW.Store):
    """Transportation's own store, its fleet, mileage and routes rows (app.resource_rows) taken back with a void."""


class DirectorsStore(OSW._CancelsOps, RR.Store):
    """app.directors_writes and _receipts; the directors' rows (app.resource_rows) taken back with a void."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="directors", label="Directors")
