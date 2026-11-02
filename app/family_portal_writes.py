"""The Family Portal's letters home written on Python (the generic create, update and delete on careDocs, Main.gs
route), kept in Postgres alone (app/resource_rows.py). careDocsUpload brings care_docs into Postgres as the app is
given to Python."""
from __future__ import annotations

from typing import Any, Callable

import family_portal as FP
import locations as L
import resource_rows as RR
import sheet_resources as SR
from writes import Decision

BUSY = "Somebody else is changing a letter right now — try again."


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, FP.LETTERS, payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, FP.LETTERS, payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, FP.LETTERS, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "careDocsCreate": create, "careDocsUpdate": update, "careDocsDelete": delete,
    "careDocsUpload": RR.upload_door({FP.LETTERS: SR.SPECS[FP.LETTERS]})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.family_portal_writes and app.family_portal_receipts, beside the other apps' own; rows app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="family_portal", label="Family Portal")
