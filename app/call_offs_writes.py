"""Call Offs' writes (the generic create and update on `callOffs`, Main.gs route) decided off asa-hub-db and kept in
app.edits — final in Postgres, carried to the Call Offs house by the two-way sync: a call-off reported on the screen,
or a row corrected. A removal stays Apps Script's (app.edits keeps no removal). The screen's witness is checked, never
written: a row whose staff member is no longer the one the screen showed is refused, as the estate refuses it."""
from __future__ import annotations

import json
from typing import Any, Callable

import call_offs as CO
import gsjs
import locations as L
import writes as W
from scope import Defer
from writes import Decision

BUSY = "Somebody else is changing the call-offs right now — try again."
DENIED = "Requires an admin or manager account"
WITNESS = "employee_name"
MOVED = ("That row has changed in the call-offs since you opened it — reload the screen so you are editing the right "
         "one.")


def _falsy(v: Any) -> bool:
    """!v in JavaScript."""
    if v is None or v is False or v == "":
        return True
    return isinstance(v, (int, float)) and not isinstance(v, bool) and (v == 0 or v != v)


def serialize(v: Any) -> str:
    """serialize_: what a cell holds once the row is written."""
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return json.dumps(v, separators=(",", ":"), ensure_ascii=False)
    return W.sheet_text(v)


def _where(reads: L.Reads) -> tuple[str, str, tuple]:
    res = W.tab_of(reads, CO.TAB)
    if res.ref is None:
        raise Defer("the Call Offs house holds no tab in the copy")
    sid, tab = W.where_of(res)
    return sid, tab, res.ref.headers


def _unknown(keys: Any, headers: tuple) -> bool:
    """A key the tab has no column for: createRow_/updateRowById_ add the column, which only Apps Script does."""
    return any(k not in headers for k in keys)


def _kept(answer: dict[str, Any], edits: list[dict], subject: str, fresh: tuple[str, ...]) -> Decision:
    d = W.final(answer, edits, subject, "")
    d.fresh = fresh
    return d


def create(sess: L.Session, payload: dict) -> Decision:
    """route('callOffs', 'create'): createRow_ — the payload's fields, an id, createdAt and updatedAt."""
    if not CO.may_write(sess):
        return W.refuse(403, DENIED)
    reads = sess.reads
    record = dict(payload) if isinstance(payload, dict) else {}
    # hubPlaceGate_: the place is never the caller's to say; a witness names no column
    record.pop("tenant", None)
    record.pop("witness", None)
    now = W.now_iso(reads)
    if _falsy(record.get("id")):
        record["id"] = W.mint()
    if _falsy(record.get("createdAt")):
        record["createdAt"] = now
    record["updatedAt"] = now
    sid, tab, headers = _where(reads)
    if _unknown(record, headers):
        raise Defer("a call-off naming a column the Call Offs tab does not have")
    rid = gsjs.js_str(record["id"])
    if any(gsjs.or_blank(r.get("id")) == rid for r in CO.rows(reads)):
        raise Defer("an id the tab already holds")
    W.gate(reads)
    cells = {h: serialize(record.get(h)) for h in headers if h}
    edits = [W.kept_record(sid, tab, "append", "id", rid, rid, cells)]
    return _kept({"status": 200, "data": record}, edits, rid, CO.books(reads))


def update(sess: L.Session, payload: dict) -> Decision:
    """route('callOffs', 'update'): updateRowById_ — the row merged with the patch, updatedAt refreshed; the screen's
    witness must still name the row's staff member."""
    if not CO.may_write(sess):
        return W.refuse(403, DENIED)
    reads = sess.reads
    patch = dict(payload) if isinstance(payload, dict) else {}
    patch.pop("tenant", None)
    witness = patch.pop("witness", None)
    if "id" not in patch or patch["id"] == "":
        return W.refuse(400, 'Missing required "id" in payload.')
    rid = gsjs.js_str(patch["id"])
    fresh = CO.books(reads)
    row = next((r for r in CO.rows(reads) if gsjs.or_blank(r.get("id")) == rid), None)
    if row is None:
        return W.refuse(404, f'No "{CO.TAB}" record with id "{rid}".', fresh=fresh)
    if witness is not None and gsjs.trim(gsjs.or_blank(row.get(WITNESS))) != gsjs.trim(gsjs.or_blank(witness)):
        return W.refuse(409, MOVED, fresh=fresh)
    now = W.now_iso(reads)
    merged = dict(row)
    changed: dict[str, Any] = {}
    for k, v in patch.items():
        # createdAt is immutable
        if k == "createdAt":
            continue
        merged[k] = v
        if k != "id":
            changed[k] = v
    merged["updatedAt"] = changed["updatedAt"] = now
    sid, tab, headers = _where(reads)
    if _unknown(changed, headers):
        raise Defer("a change naming a column the Call Offs tab does not have")
    W.gate(reads)
    was = next((r for r in CO.raw_rows(reads) if r.get("id") == rid), {})
    cells = {k: serialize(v) for k, v in changed.items()}
    edits = [W.kept_record(sid, tab, "edit", "id", rid, rid, cells, before={k: was.get(k, "") for k in cells})]
    return _kept({"status": 200, "data": merged}, edits, rid, fresh)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"callOffsCreate": create, "callOffsUpdate": update}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.call_offs_writes and app.call_offs_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="call_offs", label="Call Offs")
