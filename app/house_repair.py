"""House Repair and House Work Orders: the estate's repair requests (House Repair Requests › Repairs) read off
asa-hub-db, as Estate.gs estateRoute_ lists and gets them for route('workOrders') — a client's answer cut to the
requests filed at their own street (hubClientNarrowAnswer_, clientByAddress select_address_vehicle). Both apps' screens
read this one resource, so both are answered here; their writes are app/house_repair_writes.py."""
from __future__ import annotations

from typing import Any, Callable

import call_offs as CO
import gsjs
import locations as L
import my_family as MF
import scope as sc
from scope import Defer

APP_ID = "house-repair"
RESOURCE = "workOrders"
# Main.gs RESOURCES.workOrders: clientScoped, clientByAddress
BY_ADDRESS = "select_address_vehicle"


def client_key(user: dict | None) -> str:
    """hubClientKeyOf_: a client's own key; '' for anybody else (an SSA or a FAMILY included: House Repairs is shut to
    both on the operator's sheet)."""
    u = user or {}
    if u.get("is_service") or gsjs.str_(u.get("role")) != "client" or not sc.role_counts(u.get("types"), u.get("role")):
        return ""
    return gsjs.str_(u.get("client_key"))


def is_client(user: dict | None) -> bool:
    """The account hubClientNarrowAnswer_ narrows: a client, or an SSA or a FAMILY whatever its role says (scope.role_counts), never the service."""
    u = user or {}
    return not u.get("is_service") and (gsjs.str_(u.get("role")) == "client"
                                        or not sc.role_counts(u.get("types"), u.get("role")))


def theirs(row: dict | None, ident: dict) -> bool:
    """hubRowIsClients_ under clientByAddress: the request's street is the client's own."""
    a = L.addr_key((row or {}).get(BY_ADDRESS))
    return bool(a) and a in ident["addrs"]


def said(payload: dict, key: str) -> str:
    """A payload field as JavaScript writes it into a message."""
    return gsjs.js_str(payload[key]) if key in payload else "undefined"


def _shown(rows: list[dict]) -> list[dict]:
    if CO.withheld(rows):
        raise Defer("the copy withholds a cell this answer shows")
    return rows


def work_orders_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('workOrders', 'list'): estateRoute_'s rows narrowed by `q` across every cell; a client's cut to the
    requests filed at their own street, an account naming no client to none."""
    p = payload if isinstance(payload, dict) else {}
    rows = [dict(r) for r in sess.reads.estate(RESOURCE)]
    q = gsjs.js_str(p.get("q")).lower() if not gsjs.falsy(p.get("q")) else ""
    if q:
        rows = [r for r in rows if any(q in gsjs.js_str(v).lower() for v in r.values())]
    if is_client(sess.user) and rows:
        key = client_key(sess.user)
        ident = MF.identity(sess.reads, key) if key else None
        rows = [r for r in rows if theirs(r, ident)] if ident is not None else []
    return {"status": 200, "data": _shown(rows)}


def work_orders_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('workOrders', 'get'): one row by its id (r<sheet row>); "not yours" reads as "not here" for a client."""
    p = payload if isinstance(payload, dict) else {}
    rid = p.get("id")
    hit = next((dict(r) for r in sess.reads.estate(RESOURCE) if r.get("id") == rid), None)
    if hit is None:
        return {"status": 404, "message": f'No row "{said(p, "id")}" in {RESOURCE}.'}
    if is_client(sess.user):
        key = client_key(sess.user)
        if not key or not theirs(hit, MF.identity(sess.reads, key)):
            return {"status": 404, "message": f'No row "{RESOURCE}" here.'}
    return {"status": 200, "data": _shown([hit])[0]}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"workOrdersList": work_orders_list,
                                                                    "workOrdersGet": work_orders_get}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
