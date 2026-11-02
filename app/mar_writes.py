"""MAR's writes (the generic create, update and delete on `marEntries`, Main.gs route), kept in Postgres alone
(app/resource_rows.py): a pass recorded, corrected or removed. marEntriesUpload brings mar_entries into Postgres as
the app is given to Python (rows nothing here has touched), and hands it back as the app returns to Apps Script."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import mar as MAR
import resource_rows as RR
import sheet_resources as SR
from writes import Decision

BUSY = "Somebody else is recording a medication pass right now — try again."


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, MAR.RESOURCE, payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, MAR.RESOURCE, payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, MAR.RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "marEntriesCreate": create, "marEntriesUpdate": update, "marEntriesDelete": delete,
    "marEntriesUpload": RR.upload_door({MAR.RESOURCE: SR.SPECS[MAR.RESOURCE]})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.mar_writes and app.mar_receipts, beside the other apps' own; the passes app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="mar", label="MAR")
