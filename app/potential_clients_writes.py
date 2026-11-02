"""Potential Clients' writes, kept in Postgres alone (app/resource_rows.py): the generic create, update and delete on
`potentialClients` (Main.gs route) — a referral moved down the funnel, its owner, next step and notes — and leadOpened
(Scraper.gs): a referral whose alert went out moves from new to read the first time somebody opens it, never over a
stage set by hand. potentialClientsUpload brings the sheet into Postgres again for the relay (the new referrals the
scraper filed there; rows nothing here has touched), and hands it back as the app returns to Apps Script."""
from __future__ import annotations

from typing import Any, Callable

import gsjs
import locations as L
import potential_clients as PC
import resource_rows as RR
import sheet_resources as SR
import staff_views
import writes as W
from scope import Defer
from writes import Decision

BUSY = "Somebody else is changing the referrals right now — try again."
OPENED_MAX = 100

s_ = gsjs.str_


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, PC.RESOURCE, payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, PC.RESOURCE, payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, PC.RESOURCE, payload)


def truthy(v: Any) -> bool:
    """scraperTruthy_."""
    if v is True:
        return True
    return gsjs.trim("" if v is None else gsjs.js_str(v)).lower() in ("true", "yes", "y", "1", "sim")


def lead_opened(sess: L.Session, payload: dict) -> Decision:
    """leadOpened: each referral named whose alert went out and still stands at new, moved to read."""
    reads = sess.reads
    if not RR.uploaded(reads.db, PC.RESOURCE):
        raise Defer(f"{PC.RESOURCE} is not uploaded to Postgres yet")
    p = payload if isinstance(payload, dict) else {}
    ids = [s_(x) if isinstance(x, str) else gsjs.js_str(x) for x in (p.get("ids") or [])[:OPENED_MAX]] \
        if isinstance(p.get("ids"), list) and p.get("ids") else ([gsjs.js_str(p["id"])] if p.get("id") else [])
    if not ids:
        return Decision({"status": 400, "message": "id (or ids) is required."})
    by = s_((sess.user or {}).get("email"))
    out = []
    for rid in ids:
        # requireRow_, then updateRowById_ (updatedAt refreshed)
        hit = SR._found(reads, PC.RESOURCE, rid)
        if hit is None:
            out.append({"id": rid, "error": True})
            continue
        key, cells, row = hit
        if not truthy(row.get("sms_sent")) or gsjs.trim(gsjs.js_str(row.get("stage") or "")).lower() != "new":
            out.append({"id": rid, "stage": row.get("stage"), "unchanged": True})
            continue
        RR.update(reads, PC.RESOURCE, key, cells, {"stage": "read", "updatedAt": W.now_iso(reads)}, by)
        staff_views.record(sess.user, "lead_read", f"{s_(row.get('client_name')) or rid} new → read")
        out.append({"id": rid, "stage": "read"})
    if len(out) == 1 and not p.get("ids"):
        return Decision({"status": 200, "data": out[0]}, subject="", own=True)
    return Decision({"status": 200, "data": {"results": out}}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "potentialClientsCreate": create, "potentialClientsUpdate": update, "potentialClientsDelete": delete,
    "leadOpened": lead_opened,
    "potentialClientsUpload": RR.upload_door({PC.RESOURCE: SR.SPECS[PC.RESOURCE]})}
# the generic verbs declare no roles; each door's own gate decides (leadOpened declares none either)
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.potential_clients_writes and app.potential_clients_receipts; the referrals app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="potential_clients", label="Potential Clients")
