"""Locations' asset and document writes (apps-script/Locations.gs locationAssetEdit, locationAssetAdd,
locationDocUpload, locationDocLink, locationDocRemove) decided off asa-hub-db. An asset's cells and a new asset's row on
the estate's House Inventory List are kept in app.edits; a document's Drive half was done by the read the relay asked
first (app/location_files.py, BACKEND_WRITE_PREPARE), and its write answers it under the house's edit door."""
from __future__ import annotations

from typing import Any, Callable

import gsjs
import hubdb
import location_files as LF
import locations as L
import writes as W
from gsjs import text
from writes import Decision

# LOCATION_ASSET_FIELDS: the inventory columns an asset edit or a new asset writes; its house (its address) stays
ASSET_FIELDS = ("item", "current_condition", "est_expiration_year", "cost_to_replace", "replacement_frequency")
# the cells an asset's row is found by in app.edits: the inventory carries no id, and these two tell its rows apart
ASSET_KEYS = ("item", "address")
ASSET_WORDS = ("the asset's row on the House Inventory List.",
               "The inventory's kept copy and the house's supplies, read again.")
DOCS_READ_AGAIN = "The house's documents, read again."
NOT_FILED = "The document could not be filed just now — try again in a minute. Nothing was filed."
NOT_MOVED = "The document could not be moved just now — try again in a minute. Nothing was changed."

s_ = gsjs.str_


def asset_at(ctx: dict, row: dict) -> bool:
    """locationsAssetAt_: an address the house answers to (the Supplies read's rule)."""
    return L.addr_owner(L.addr_index(ctx["homes"], ctx["all_clients"]), row.get("address"))["code"] == ctx["code"]


def asset_edit(sess: L.Session, payload: dict) -> Decision:
    """locationAssetEdit: one of the house's assets on House Supplies' own inventory, field by field."""
    def check(ctx: dict, field: str, value: str) -> str:
        return "An asset keeps its name." if field == "item" and not text(value) else ""

    return W.estate_edit(sess, payload, "houseInventory", L.EDITION["assets"], ASSET_FIELDS, asset_at, check,
                         ASSET_WORDS, ASSET_KEYS)


def _filled(raw: dict) -> bool:
    return any(gsjs.trim(gsjs.or_blank(v)) for v in raw.values())


def asset_add(sess: L.Session, payload: dict) -> Decision:
    """locationAssetAdd: an asset on House Supplies' own inventory at the house's registry street, one new row kept in
    app.edits; nothing is ever removed here."""
    door = W.edit_door(sess, payload, L.EDITION["assets"])
    if door.get("refused"):
        return W.door_refused(door)
    ctx, reads = door["ctx"], sess.reads
    code = ctx["code"]
    sent = payload.get("row")
    if not isinstance(sent, dict):
        return W.refuse(400, "row: the asset's fields.")
    rec = {"address": text((ctx.get("home") or {}).get("address"), 200)}
    if not rec["address"]:
        return W.refuse(409, f"The registry holds no street for {code}, so no asset is placed there.", fresh=True)
    for f in ASSET_FIELDS:
        rec[f] = text(sent.get(f), 500)
    if not rec["item"]:
        return W.refuse(400, "item: what the asset is.")
    W.gate(reads)
    prop, tab = L.ESTATE_SOURCES["houseInventory"]
    sid = reads.db.prop(prop)
    if not sid:
        raise hubdb.Unreadable(f"no {prop} is declared in the depot")
    ref = reads.tab_of(sid, tab, f"the estate's {tab}")
    keys = [hubdb.estate_key(h) for h in ref.headers] if ref is not None else []
    if "item" not in keys or "address" not in keys:
        return W.refuse(503, "The House Inventory List could not be opened.", fresh=(sid,))
    # estateSheet_'s keys: every column whose key the asset names takes its value
    cells = {gsjs.trim(gsjs.js_str(h)): W.sheet_text(rec[k]) for h, k in zip(ref.headers, keys) if k in rec}
    match_heads = [next(h for h, k in zip(ref.headers, keys) if k == want) for want in ASSET_KEYS]
    key = "\x1f".join(gsjs.trim(cells[gsjs.trim(gsjs.js_str(h))]) for h in match_heads)
    match = W.COLS + W.COLS_SEP.join(gsjs.trim(gsjs.js_str(h)) for h in match_heads)
    rows = reads.db.rows(ref)
    own = hubdb.OWN.get()
    kept_rows = (getattr(own, "edits", None) or {}).get((sid, ref.tab)) or ()
    if any(W.cols_key(raw, match_heads) == key for _rn, raw in rows) or \
            any(g["match"] == match and g["row_key"] == key for g in kept_rows):
        # the same item at the same street already: a second row no kept edit could tell apart
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(sid,))
    # estateReadRow_ of the row appended: the next row past the last one the sheet holds
    nxt = max((rn for rn, raw in rows if _filled(raw)), default=1) + 1
    row: dict[str, Any] = {"id": f"r{nxt}"}
    for h, k in zip(ref.headers, keys):
        if k:
            row[k] = hubdb.estate_cell(hubdb.typed(cells.get(gsjs.trim(gsjs.js_str(h)), ""), "estate"))
    kept = W.kept_record(sid, ref.tab, "append", match, key, code, cells,
                         edition=W.edition_of(door, L.EDITION["assets"]))
    answer = {"status": 200, "data": W.with_steps({"house": code, "asset": row}, W.kept_steps(
        "A new row on the House Inventory List", ASSET_WORDS[1]))}
    out = W.final(answer, [kept], code)
    # the estate's forms and its people write this sheet too: a verdict off a copy the sheet has moved past waits
    out.fresh = (sid,)
    return out


def _prepared(p: dict, field: str = "") -> dict | None:
    """What the relay's read before this write did (location_files), when it did it for this write."""
    prep = p.get("prepared")
    if (field and s_(p.get(field)) != "kept") or not isinstance(prep, dict):
        return None
    return prep


def _doc_answer(code: str, key: str, item: dict, words: str) -> Decision:
    data = W.with_steps({"house": code, key: item}, W.steps(words, DOCS_READ_AGAIN, [], [], "Drive"))
    return Decision({"status": 200, "data": data}, subject=code, own=True)


def doc_upload(sess: L.Session, payload: dict) -> Decision:
    """locationDocUpload: the file its read filed in the house's own folder, answered under the house's edit door."""
    p = payload if isinstance(payload, dict) else {}
    ctx, refused = LF.door(sess, p)
    if refused:
        return Decision(refused)
    prep = _prepared(p, "file")
    if prep is None:
        refused = LF.upload_checks(p)[0]
        return Decision(refused) if refused else W.refuse(503, NOT_FILED)
    added = prep.get("added") if isinstance(prep.get("added"), dict) else {}
    if s_(prep.get("house")) != ctx["code"] or not LF._DRIVE_ID.fullmatch(s_(added.get("id"))):
        return W.refuse(503, NOT_FILED)
    return _doc_answer(ctx["code"], "added", {"id": s_(added["id"]), "name": s_(added.get("name")),
                                              "folder_made": added.get("folder_made") is True},
                       "The file filed in the house's folder, owned by the platform.")


def doc_link(sess: L.Session, payload: dict) -> Decision:
    """locationDocLink: the copy its read filed in the house's own folder, answered under the house's edit door."""
    p = payload if isinstance(payload, dict) else {}
    ctx, refused = LF.door(sess, p)
    if refused:
        return Decision(refused)
    refused = LF.link_checks(p)[0]
    if refused:
        return Decision(refused)
    prep = _prepared(p)
    added = (prep or {}).get("added") if isinstance((prep or {}).get("added"), dict) else {}
    if prep is None or s_(prep.get("house")) != ctx["code"] or not LF._DRIVE_ID.fullmatch(s_(added.get("id"))):
        return W.refuse(503, NOT_FILED)
    return _doc_answer(ctx["code"], "added", {"id": s_(added["id"]), "name": s_(added.get("name")),
                                              "folder_made": added.get("folder_made") is True},
                       "A copy filed in the house's folder, owned by the platform; the original stays where it is.")


def doc_remove(sess: L.Session, payload: dict) -> Decision:
    """locationDocRemove: the move its read made to "Removed from Locations", answered under the house's edit door."""
    p = payload if isinstance(payload, dict) else {}
    ctx, refused = LF.door(sess, p)
    if refused:
        return Decision(refused)
    refused, fid = LF.remove_checks(p)
    if refused:
        return Decision(refused)
    prep = _prepared(p)
    removed = (prep or {}).get("removed") if isinstance((prep or {}).get("removed"), dict) else {}
    if prep is None or s_(prep.get("house")) != ctx["code"] or s_(removed.get("id")) != fid:
        return W.refuse(503, NOT_MOVED)
    return _doc_answer(ctx["code"], "removed", {"id": fid, "name": s_(removed.get("name"))},
                       f'The file moved to "{LF.DOC_REMOVED_FOLDER}" in the houses room.')


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "locationAssetEdit": asset_edit, "locationAssetAdd": asset_add, "locationDocUpload": doc_upload,
    "locationDocLink": doc_link, "locationDocRemove": doc_remove}
# HUB_POLICY: the roles each write is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {a: {"roles": W.WRITE_ROLES, "params": p} for a, p in {
    "locationAssetEdit": {"house": "string", "id": "string", "changes": "array"},
    "locationAssetAdd": {"house": "string"},
    "locationDocUpload": {"house": "string"},
    "locationDocLink": {"house": "string", "url": "string"},
    "locationDocRemove": {"house": "string", "id": "string"},
}.items()}
