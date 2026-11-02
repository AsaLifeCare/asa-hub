"""Med Deliveries' writes (the generic create, update and delete on `medDeliveries`, Main.gs route), kept in Postgres
alone (app/resource_rows.py). medDeliveriesUpload brings med_deliveries into Postgres as the app is given to Python."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import med_deliveries as MD
import resource_rows as RR
import sheet_resources as SR
from writes import Decision

BUSY = "Somebody else is recording a delivery right now — try again."


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, MD.RESOURCE, payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, MD.RESOURCE, payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, MD.RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "medDeliveriesCreate": create, "medDeliveriesUpdate": update, "medDeliveriesDelete": delete,
    "medDeliveriesUpload": RR.upload_door({MD.RESOURCE: SR.SPECS[MD.RESOURCE]})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.med_deliveries_writes and app.med_deliveries_receipts, beside the other apps' own; rows app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="med_deliveries", label="Med Deliveries")
