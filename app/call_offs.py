"""Call Offs (the `callOffs` resource, Main.gs route) read off asa-hub-db: the call-offs, no-shows and late shows in
the Call Offs house's Data tab — the ones the hotline files from the calls the Quo webhook keeps, and the ones a
manager reports on the screen. A client reads none of them: the resource names no client."""
from __future__ import annotations

from typing import Any, Callable

import client_writes as CW
import gsjs
import house_tables as HT
import hubdb
import locations as L
import row_ops as RO
import scope as sc
from scope import Defer

APP_ID = "call-offs"
TAB = "callOffs"
CLIENTS = ("client", "guardian")
COPY_MARKER = "[withheld"


def withheld(v: Any) -> bool:
    """A cell the copy keeps withheld anywhere in an answer: Apps Script's alone to show."""
    if isinstance(v, str):
        return v.startswith(COPY_MARKER)
    if isinstance(v, dict):
        return any(withheld(x) for x in v.values())
    if isinstance(v, list):
        return any(withheld(x) for x in v)
    return False


def _ref(reads: L.Reads) -> hubdb.TabRef | None:
    res = reads.db.resolve(TAB)
    if res.runtime:
        raise Defer(f"{TAB} lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the {TAB} house")
    return res.ref


def rows(reads: L.Reads) -> list[dict]:
    """listRows_('callOffs'): readAll_ of the copy, Python's own kept edits laid and its removals on their way taken
    out; its own table's rows once the house is kept there."""
    if HT.tabled(TAB):
        return [dict(r) for r in reads.once("calloffs:rows", lambda: reads.hub_rows(TAB))]
    got = reads.once("calloffs:rows", lambda: RO.unremoved(reads, _ref(reads), reads.db.sheetdb_rows(_ref(reads))))
    return [dict(r) for r in got]


def raw_rows(reads: L.Reads) -> list[dict]:
    """Each row's cells as the copy keeps their text: what a write names as the sheet's value before it."""
    def read() -> list[dict]:
        if HT.tabled(TAB):
            heads, got = HT.raw(reads, TAB)
            return [{h: gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(h), "raw"))) for h in heads if h}
                    for _rn, raw in got]
        ref = _ref(reads)
        if ref is None:
            return []
        return RO.unremoved(reads, ref, [{h: gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(h), "raw")))
                                          for h in ref.headers if h} for _rn, raw in reads.db.rows(ref)])
    return [dict(r) for r in reads.once("calloffs:raw", read)]


def books(reads: L.Reads) -> tuple[str, ...]:
    sid = "" if HT.tabled(TAB) else reads.db.resolve(TAB).sheet_id
    return (sid,) if sid else ()


def may_write(sess: L.Session) -> bool:
    """An admin, a manager or the service: the screen's own writers."""
    user = sess.user or {}
    return user.get("is_service") is True or CW.writer(user)


def _client(sess: L.Session) -> bool:
    """A client, or an SSA or a FAMILY whatever its role says (scope.role_counts)."""
    user = sess.user or {}
    return user.get("is_service") is not True and (gsjs.js_str(user.get("role")).lower() in CLIENTS
                                                   or not sc.role_counts(user.get("types"), user.get("role")))


def call_offs_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('callOffs', 'list'): every row; a client's narrowing names nothing, so a client reads none."""
    p = payload if isinstance(payload, dict) else {}
    if any(k in p for k in ("q", "offset", "limit")):
        raise Defer("a filtered list is listRows_'s own")
    if _client(sess):
        return {"status": 200, "data": []}
    env = {"status": 200, "data": rows(sess.reads)}
    if withheld(env["data"]):
        raise Defer("the copy withholds a cell this answer shows")
    return env


def call_offs_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('callOffs', 'get'): one row by its id; "not yours" reads as "not here" for a client."""
    rid = gsjs.trim(gsjs.or_blank((payload or {}).get("id")))
    missing = {"status": 404, "message": f'No row "{rid}" in {TAB}.'}
    if _client(sess):
        return missing
    hit = next((r for r in rows(sess.reads) if gsjs.or_blank(r.get("id")) == rid), None)
    if hit is None:
        return missing
    if withheld(hit):
        raise Defer("the copy withholds a cell this answer shows")
    return {"status": 200, "data": hit}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"callOffsList": call_offs_list,
                                                                    "callOffsGet": call_offs_get}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
