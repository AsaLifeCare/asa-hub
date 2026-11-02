"""Audits & Compliance's writes (the generic create, update and delete on `audits`, Main.gs route), kept in Postgres
alone (app/resource_rows.py). auditsUpload brings audits into Postgres as the app is given to Python."""
from __future__ import annotations

from typing import Any, Callable

import audits as AU
import locations as L
import resource_rows as RR
import sheet_resources as SR
from writes import Decision

BUSY = "Somebody else is changing an audit right now — try again."


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, AU.RESOURCE, payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, AU.RESOURCE, payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, AU.RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "auditsCreate": create, "auditsUpdate": update, "auditsDelete": delete,
    "auditsUpload": RR.upload_door({AU.RESOURCE: SR.SPECS[AU.RESOURCE]})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.audits_writes and app.audits_receipts, beside the other apps' own; rows app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="audits", label="Audits & Compliance")
