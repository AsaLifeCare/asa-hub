"""The Leadership Dashboard's own read on Python: the client ledger (Main.gs RESOURCES.financeTransactions, the
finance_transactions tab) listed and got off asa-hub-db's copy, as route() lists it — read only: the Finance app stays
its single writer, and the board writes nothing. Its other feeds are their own apps' doors."""
from __future__ import annotations

from typing import Any, Callable

import clients as C
import gsjs
import locations as L
import sheet_resources as SR
from scope import Defer

APP_ID = "leadership"
RESOURCE = "financeTransactions"
TAB = "finance_transactions"

s_ = gsjs.str_


def _rows(sess: L.Session) -> list[dict]:
    """listRows_ of the ledger, then a client's own rows (hubClientNarrowList_)."""
    rows = [dict(r) for r in C._hub(sess.reads, TAB)]
    # a client, or an SSA or a FAMILY whatever its role says: its own clients' rows (sheet_resources.own_keys)
    if SR._client(sess.user or {}):
        rows = SR._client_rows(sess, RESOURCE, rows)
    return rows


def ledger_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('financeTransactions', 'list'): listRows_ with its offset and limit; a full-text q stays listRows_'s."""
    refused = SR.gate(sess, RESOURCE, "list")
    if refused:
        return refused
    p = payload if isinstance(payload, dict) else {}
    if p.get("q") is not None and gsjs.trim(gsjs.js_str(p.get("q"))):
        raise Defer("a full-text list is listRows_'s own")
    got = _rows(sess)
    offset = SR._int(p.get("offset"))
    offset = 0 if offset is None or offset < 0 else offset
    limit = SR._int(p.get("limit"))
    return {"status": 200, "data": got[offset:] if limit is None or limit < 0 else got[offset:offset + limit]}


def ledger_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('financeTransactions', 'get'): requireRow_; "not yours" reads as "not here" for a client."""
    refused = SR.gate(sess, RESOURCE, "get")
    if refused:
        return refused
    rid = (payload or {}).get("id") if isinstance(payload, dict) else None
    if rid is None or rid == "":
        return {"status": 400, "message": SR.NO_ID}
    want = gsjs.js_str(rid)
    hit = next((r for r in C._hub(sess.reads, TAB) if gsjs.js_str(r.get("id")) == want), None)
    if hit is None:
        return {"status": 404, "message": f'No "{RESOURCE}" record with id "{want}".'}
    if SR._client(sess.user or {}) and SR._client_row_refused(sess, RESOURCE, hit):
        return {"status": 404, "message": f'No row "{want}" in {RESOURCE}.'}
    return {"status": 200, "data": dict(hit)}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"financeTransactionsList": ledger_list,
                                                                    "financeTransactionsGet": ledger_get}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
