"""Billing & Payers' writes (the generic create, update and delete on `billingClaims`, Main.gs route), kept in Postgres
alone (app/resource_rows.py). billingClaimsUpload brings billing_claims into Postgres as the app is given to Python."""
from __future__ import annotations

from typing import Any, Callable

import billing as BI
import locations as L
import resource_rows as RR
import sheet_resources as SR
from writes import Decision

BUSY = "Somebody else is changing a claim right now — try again."


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, BI.RESOURCE, payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, BI.RESOURCE, payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, BI.RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "billingClaimsCreate": create, "billingClaimsUpdate": update, "billingClaimsDelete": delete,
    "billingClaimsUpload": RR.upload_door({BI.RESOURCE: SR.SPECS[BI.RESOURCE]})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.billing_writes and app.billing_receipts, beside the other apps' own; rows app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="billing", label="Billing & Payers")
