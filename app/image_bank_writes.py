"""Image Bank's writes (the generic create, update and delete on `photos`, Main.gs route), kept in Postgres alone
(app/resource_rows.py): a picture added by its link, its details changed, or removed; a client changes or removes only
a picture that names them. imageBankUpload brings the bank's sheet into Postgres again for the relay (rows nothing here
has touched)."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import resource_rows as RR
import sheet_resources as SR
import writes as W
from writes import Decision

BUSY = "Somebody else is changing the image bank right now — try again."


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, "photos", payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, "photos", payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, "photos", payload)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "imageBankCreate": create, "imageBankUpdate": update, "imageBankDelete": delete,
    "imageBankUpload": RR.upload_door({"photos": SR.SPECS["photos"]})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.image_bank_writes and app.image_bank_receipts, beside the other apps' own; the rows
    app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="image_bank", label="Image Bank")
