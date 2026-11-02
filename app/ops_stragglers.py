"""The last generic reads of their apps off asa-hub-db (Main.gs route(resource, 'list') → SheetDb.gs listRows_): the
helpful contacts the suggestion box shows and Settings › Suggestions keeps, and the notifications Settings › API
connection lists — each tab as the sheet will hold it once Python's own writes are carried (kept edits laid, removals on
their way taken out), narrowed as route() narrows it. What the copy cannot answer is a 503 to try again."""
from __future__ import annotations

import json
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import row_ops as RO
import sheet_resources as SR
import writes as W
from scope import Defer

HELPFUL = "helpfulContacts"
NOTIFICATIONS = "notifications"
# RESOURCES (Main.gs): the tab each resource lives in, and whether a client reads it whole (clientOpen)
TABS = {HELPFUL: "helpful_contacts", NOTIFICATIONS: "notifications"}
CLIENT_OPEN = {HELPFUL: False, NOTIFICATIONS: True}
UNREAD = {"status": 503, "message": "This could not be read just now. Try again in a moment."}

s_ = gsjs.str_


def here(reads: L.Reads, user: dict | None) -> str:
    """hubTenantId_ for a session the relay hands here: '' at headquarters (and for the relay's own identity)."""
    if (user or {}).get("is_service"):
        return ""
    import studio as ST  # noqa: PLC0415 - the places, read only where a place narrows
    return ST.tenant_id(reads, user)


def visible(where: str, owner: Any) -> bool:
    """tenantRowVisible_: a blank cell is headquarters'."""
    return not where or s_(owner) == where


def tab(reads: L.Reads, name: str) -> tuple[str, str, hubdb.TabRef | None]:
    """sheetFor_: the tab's book, its name there, and the copy's tab (None while the book holds no such tab)."""
    res = reads.db.resolve(name)
    if res.runtime:
        raise hubdb.Unreadable(f"{name} lives in the depot's facts")
    if not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {name}")
    sid, where = W.where_of(res)
    return sid, where, res.ref


def all_rows(reads: L.Reads, name: str) -> list[dict]:
    """readAll_ of the tab with Python's own kept edits laid, every row the sheet holds now; its own table's rows once
    the house is kept there."""
    if HT.tabled(name):
        return [dict(r) for r in reads.once("ops_all:" + name, lambda: reads.hub_rows(name))]
    _sid, _tab, ref = tab(reads, name)
    return [dict(r) for r in reads.once("ops_all:" + name, lambda: reads.db.sheetdb_rows(ref))]


def rows(reads: L.Reads, name: str) -> list[dict]:
    """readAll_ of the tab as the sheet will hold it: the removals on their way taken out."""
    if HT.tabled(name):
        return all_rows(reads, name)
    _sid, _tab, ref = tab(reads, name)
    return [dict(r) for r in reads.once("ops_rows:" + name, lambda: RO.unremoved(reads, ref, all_rows(reads, name)))]


def _shown(v: Any) -> str | None:
    """What listRows_' q is matched against: JSON for an object, the text of anything else, nothing for null."""
    if v is None:
        return None
    if isinstance(v, (dict, list)):
        return json.dumps(v, separators=(",", ":"), ensure_ascii=False)
    return gsjs.js_str(v)


def list_rows(sess: L.Session, resource: str, payload: dict) -> dict[str, Any]:
    """route(resource, 'list'): listRows_ (its q, offset and limit), then a client's narrowing (hubClientNarrowList_:
    open, the rows whole; else none), then the place's (tenantRowVisible_)."""
    user = sess.user or {}
    p = payload if isinstance(payload, dict) else {}
    try:
        got = rows(sess.reads, TABS[resource])
        place = here(sess.reads, user)
    except (Defer, hubdb.Unreadable):
        return dict(UNREAD)
    q = gsjs.trim("" if p.get("q") is None else gsjs.js_str(p.get("q"))).lower()
    if q:
        got = [r for r in got if any(q in (_shown(v) or "").lower() for v in r.values() if _shown(v) is not None)]
    offset = SR._int(p.get("offset"))
    offset = 0 if offset is None or offset < 0 else offset
    limit = SR._int(p.get("limit"))
    got = got[offset:] if limit is None or limit < 0 else got[offset:offset + limit]
    if SR._client(user) and not CLIENT_OPEN[resource]:
        got = []
    if place:
        got = [r for r in got if visible(place, r.get("tenant"))]
    return {"status": 200, "data": got}


def helpful_contacts_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('helpfulContacts', 'list')."""
    return list_rows(sess, HELPFUL, payload)


def notifications_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('notifications', 'list'): a read-only tab every session reads whole (clientOpen)."""
    return list_rows(sess, NOTIFICATIONS, payload)


# the doors each app answers beside its own; the generic verbs declare no roles, each door's own gate decides
SUGGESTIONS_READS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "helpfulContactsList": helpful_contacts_list}
CONFIG_READS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"notificationsList": notifications_list}
SUGGESTIONS_POLICY: dict[str, dict[str, Any]] = {a: {} for a in SUGGESTIONS_READS}
CONFIG_POLICY: dict[str, dict[str, Any]] = {a: {} for a in CONFIG_READS}
