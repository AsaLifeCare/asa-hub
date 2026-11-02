"""Equipment & Assets' writes (the generic create, update and delete on `equipment`, Main.gs route), kept in Postgres
alone (app/resource_rows.py). equipmentUpload brings equipment into Postgres as the app is given to Python."""
from __future__ import annotations

from typing import Any, Callable

import equipment as EQ
import locations as L
import resource_rows as RR
import sheet_resources as SR
from writes import Decision

BUSY = "Somebody else is changing an asset right now — try again."


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, EQ.RESOURCE, payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, EQ.RESOURCE, payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, EQ.RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "equipmentCreate": create, "equipmentUpdate": update, "equipmentDelete": delete,
    "equipmentUpload": RR.upload_door({EQ.RESOURCE: SR.SPECS[EQ.RESOURCE]})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.equipment_writes and app.equipment_receipts, beside the other apps' own; rows app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="equipment", label="Equipment & Assets")
