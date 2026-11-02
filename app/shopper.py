"""Smart Shopper (Shopper.gs) on Python behind its switch (`shopper`): each person's watch list (`shopperItems`) and the
model's typical prices for each item (`shopperPrices`), owned rows kept in Postgres once uploaded; the categories are
the built-in floor and the shared finance_config tab's shopCategories row. shopList, shopPurchases (the procurement
catalog the relay reads where it lives and hands in) and shopEstimatePrepare (the model asked before shopEstimate
writes) are here; the writes are in app/shopper_writes.py."""
from __future__ import annotations

import functools
import json
import time
from typing import Any, Callable

import client_care_sweeps as CCS
import finance as FIN
import gsjs
import locations as L
import recon as R
import resource_rows as RR
import sheet_resources as SR
import smart_comms as SC
from scope import Defer

APP_ID = "shopper"
ITEMS, PRICES = "shopperItems", "shopperPrices"
TABS = {ITEMS: "shopper_items", PRICES: "shopper_prices"}
CATEGORIES = ("Household", "Electronics", "Clothing", "Health", "Kitchen", "Tools", "Baby & Kids", "Gift", "Other")
STATUSES = ("watching", "bought", "dropped")
CONFIG_KEY = "shopCategories"
AI_REQUEST = "ai_shopper_estimate"
# the model is given this long, inside the relay's wait for a prepare (BACKEND_PREPARE_TIMEOUT_S)
ESTIMATE_DEADLINE_S = 90.0
ESTIMATES_MAX = 6
DENIED = {"status": 403, "message": "Requires an admin or manager account"}

s_ = gsjs.str_


def may_use(user: dict | None) -> bool:
    """shopMayUse_: a person signed in, never the service; the rows are owned, so nobody reaches another's list."""
    u = user or {}
    return bool(u) and not u.get("is_service") and bool(s_(u.get("id")))


def state(reads: L.Reads, user: dict) -> list[dict[str, Any]]:
    """shopState_: the person's own items by name, each with its estimates cheapest first; read through the write's
    own cursor inside a write, so a write answers with itself in the list."""
    me = s_(user.get("id"))
    by_item: dict[str, list[dict]] = {}
    for p in RR.read_all(reads, PRICES):
        if s_(p.get("ownerId")) != me:
            continue
        by_item.setdefault(s_(p.get("itemId")), []).append({
            "id": s_(p.get("id")), "source": s_(p.get("source")), "estimate": FIN.num(p.get("estimate")),
            "title": s_(p.get("title")), "model": s_(p.get("model")), "foundAt": s_(p.get("foundAt"))})
    out = []
    for r in RR.read_all(reads, ITEMS):
        if s_(r.get("ownerId")) != me:
            continue
        found = sorted(by_item.get(s_(r.get("id")), []), key=lambda e: e["estimate"])
        target = FIN.num(r.get("targetPrice"))
        best = found[0]["estimate"] if found else 0
        out.append({"id": s_(r.get("id")), "name": s_(r.get("name")), "category": s_(r.get("category")),
                    "targetPrice": target, "notes": s_(r.get("notes")), "status": s_(r.get("status")) or "watching",
                    "estimates": found, "bestEstimate": best, "worthChecking": bool(target > 0 and 0 < best <= target),
                    "checkedAt": found[0]["foundAt"] if found else s_(r.get("checkedAt")),
                    "paidPrice": FIN.num(r.get("paidPrice")) or 0, "paidVendor": s_(r.get("paidVendor")),
                    "boughtAt": s_(r.get("boughtAt"))})
    return sorted(out, key=functools.cmp_to_key(lambda a, b: gsjs.locale_cmp(a["name"], b["name"])))


def categories_of(rows: list[dict]) -> list[str]:
    """shopCategories_ over finance_config's rows: the built-in floor, then what Settings added."""
    out = list(CATEGORIES)
    for r in rows:
        if s_(r.get("key")) != CONFIG_KEY:
            continue
        for v in gsjs.or_text(r.get("value")).split("|"):
            t = gsjs.trim(v)
            if t and t not in out:
                out.append(t)
    return out


def categories(reads: L.Reads) -> list[str]:
    """shopCategories_."""
    return categories_of(FIN.config_rows(reads))


def shop_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """shopList."""
    if not may_use(sess.user):
        return dict(DENIED)
    reads = sess.reads
    return {"status": 200, "data": {"items": state(reads, sess.user or {}), "categories": categories(reads)}}


def purchases(sess: L.Session, payload: dict) -> dict[str, Any]:
    """shopPurchases: the procurement catalog's real invoice prices, shown beside the estimates and never in their
    column — the relay's own record (its /shopper/purchases reading), read where it lives and handed in as `relayed`;
    a browser's payload never carries it."""
    u = sess.user or {}
    if not u or u.get("is_service") or gsjs.js_str(u.get("role")) not in ("admin", "manager"):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    if "relayed" not in p:
        raise Defer("the purchase record is read by the relay where it lives and handed in")
    r = p.get("relayed")
    if not isinstance(r, dict) or r.get("status") != 200:
        said = s_(r.get("message")) if isinstance(r, dict) else ""
        return {"status": 502, "message": "The purchase record did not answer: " + SC._cut16(said, 120)}
    data = r.get("data")
    return {"status": 200, "data": {"purchases": []} if gsjs.falsy(data) else data}


def ask_of(row: dict) -> str:
    """shopEstimate's question."""
    return ('Someone wants to buy: "' + s_(row.get("name")) + '"'
            + (" (category: " + s_(row.get("category")) + ")" if s_(row.get("category")) else "")
            + (". Notes: " + s_(row.get("notes")) if s_(row.get("notes")) else "") + ".\n\n"
            "From general knowledge, give TYPICAL US retail price points — not live listings, "
            "and do NOT invent URLs. Reply with JSON only:\n"
            '{"estimates":[{"source":"<retailer or tier, e.g. big-box / online marketplace>",'
            '"estimate":<number>,"title":"<typical product>"}],'
            '"advice":"<3 sentences: what to look for, and how to buy it well>"}')


def own_item(reads: L.Reads, user: dict, rid: str) -> tuple[dict | None, dict[str, Any] | None]:
    """requireRow_ of the item, then whose it is: the row, or the refusal."""
    hit = SR._found(reads, ITEMS, rid)
    if hit is None:
        return None, {"status": 404, "message": f'No "{ITEMS}" record with id "{rid}".'}
    if s_(hit[2].get("ownerId")) != s_(user.get("id")):
        return None, {"status": 404, "message": "No such item."}
    return hit[2], None


def _no_constant(name: str) -> Any:
    raise ValueError(name)


def estimate_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """shopEstimate's reading, asked by the relay before the write: the item checked as the write checks it, then
    what it roughly costs asked through the platform's own provider ladder (screenAiChat_ under ai_shopper_estimate);
    the prices it named, sealed for this person's write, which keeps them."""
    user = sess.user or {}
    if not may_use(user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    rid = s_(p.get("id"))
    if not rid:
        return {"status": 400, "message": "Which item?"}
    reads = sess.reads
    row, refused = own_item(reads, user, rid)
    if refused:
        return refused
    res = CCS.ai_chat(reads, ask_of(row or {}), 0.2, AI_REQUEST, time.monotonic() + ESTIMATE_DEADLINE_S)
    if not res["ok"]:
        return {"status": 502, "message": "No provider answered."}
    try:
        parsed = json.loads(res["content"], parse_constant=_no_constant)
    except (ValueError, RecursionError):
        parsed = None
    estimates = parsed.get("estimates") if isinstance(parsed, dict) else None
    if not isinstance(estimates, list) or not estimates:
        return {"status": 502, "message": "The answer could not be read as prices."}
    named = []
    for e in estimates[:ESTIMATES_MAX]:
        e = e if isinstance(e, dict) else {}
        n = FIN.num(e.get("estimate"))
        if n > 0:
            named.append({"source": s_(e.get("source")), "estimate": n, "title": s_(e.get("title"))})
    return {"status": 200, "data": R.seal("shopEstimate", R.actor(user), {
        "id": rid, "estimates": named, "advice": s_(parsed.get("advice")), "via": s_(res["via"])})}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "shopList": shop_list, "shopPurchases": purchases, "shopEstimatePrepare": estimate_prepare}
POLICY: dict[str, dict[str, Any]] = {"shopList": {}, "shopPurchases": {"roles": ("admin", "manager")},
                                     "shopEstimatePrepare": {}}
