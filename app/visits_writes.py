"""Visits & EVV's writes (the generic create, update and delete on `visits`, Main.gs route), kept in Postgres alone
(app/resource_rows.py). visitsUpload brings visits into Postgres as the app is given to Python."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import resource_rows as RR
import sheet_resources as SR
import visits as VI
from writes import Decision

BUSY = "Somebody else is changing a visit right now — try again."


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, VI.RESOURCE, payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, VI.RESOURCE, payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, VI.RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "visitsCreate": create, "visitsUpdate": update, "visitsDelete": delete,
    "visitsUpload": RR.upload_door({VI.RESOURCE: SR.SPECS[VI.RESOURCE]})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.visits_writes and app.visits_receipts, beside the other apps' own; rows app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="visits", label="Visits & EVV")
