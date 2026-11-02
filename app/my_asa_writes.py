"""My asa.'s week written (the generic create, update and delete on `weekItems`, Main.gs route), kept in Postgres alone
(app/resource_rows.py): an item added, edited or removed, each person's own (hubOwnedGate_). weekItemsUpload brings the
week_items sheet into Postgres again for the relay (rows nothing here has touched), and hands it back as the app
returns to Apps Script."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import my_asa as MA
import resource_rows as RR
import sheet_resources as SR
from writes import Decision

BUSY = "Somebody else is changing this week right now — try again."


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, MA.RESOURCE, payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, MA.RESOURCE, payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, MA.RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "weekItemsCreate": create, "weekItemsUpdate": update, "weekItemsDelete": delete,
    "weekItemsUpload": RR.upload_door({MA.RESOURCE: SR.SPECS[MA.RESOURCE]})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.my_asa_writes and app.my_asa_receipts; the week's rows app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="my_asa", label="My asa.")
