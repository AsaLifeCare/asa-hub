"""Prefs.gs's collectionCreate on Python behind the `prefs` switch: a new document collection appended to its house
(hubAppendRow_), kept in app.edits as the truth and carried to the sheet by the two-way sync; an id already listed is
refused with Apps Script's words."""
from __future__ import annotations

import re
from typing import Any, Callable

import door_gate as DG
import gsjs
import locations as L
import prefs as P
import writes as W
from writes import Decision

s_ = gsjs.str_


def slug(label: str) -> str:
    """label.toLowerCase(), every run of anything but a-z and 0-9 one dash, a dash at either end dropped."""
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", label.lower()))


def collection_create(sess: L.Session, payload: dict) -> Decision:
    """collectionCreate: an admin's or a manager's new collection; its id from the name when none is sent."""
    refused = DG.refusal(sess, "collectionCreate", payload, P.GS_POLICY)
    if refused:
        return Decision(refused)
    user, reads = sess.user or {}, sess.reads
    if gsjs.js_str(user.get("role")) not in ("admin", "manager"):
        return Decision(dict(DG.DENIED))
    p = payload if isinstance(payload, dict) else {}
    label = s_(p.get("label"))
    if not label:
        return W.refuse(400, "A name is required")
    cid = s_(p.get("id")) or slug(label)
    if not cid:
        return W.refuse(400, "That name has no letters or digits to build an id from")
    res = W.tab_of(reads, P.COLLECTIONS_TAB)
    existing = P.collections(reads)
    for e in existing:
        if e["id"] == cid:
            return W.refuse(409, 'A collection called "' + e["label"] + '" already exists.', fresh=(res.sheet_id,))
    icon, tint = s_(p.get("icon")) or "folder", s_(p.get("tint")) or "blue"
    row = {"id": cid, "label": label, "icon": icon, "tint": tint,
           "sort": P.or_number(p.get("sort"), len(existing) + 10), "created_at": W.now_iso(reads),
           "created_by": "asa-hub:" + gsjs.or_blank(user.get("email"))}
    sid, tab = W.where_of(res)
    rec = W.kept_record(sid, tab, "append", "id", cid, "collections", {h: row[h] for h in P.COLLECTIONS_HEADER})
    answer = {"status": 200, "data": {"collection": {"id": cid, "label": label, "icon": icon, "tint": tint}}}
    d = W.final(answer, [rec], "collections")
    d.fresh = (res.sheet_id,)
    return d


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"collectionCreate": collection_create}
# main.policy_gate asks nothing: the door asks door_gate first, with Prefs.gs's declaration
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}


class Store(W.Store):
    """app.prefs_writes and app.prefs_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="prefs", label="Document collections")
