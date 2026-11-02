"""Shift Board's writes (the generic create, update and delete on `events` from the Week page, Main.gs route), kept in
Postgres alone (app/resource_rows.py, resource scheduleEvents). scheduleEventsUpload opens the resource as the app is
given to Python."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import resource_rows as RR
import sheet_resources as SR
import shift_board as SB
from writes import Decision

BUSY = "Somebody else is changing the schedule right now — try again."


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, SB.RESOURCE, payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, SB.RESOURCE, payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, SB.RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "scheduleEventsCreate": create, "scheduleEventsUpdate": update, "scheduleEventsDelete": delete,
    "scheduleEventsUpload": RR.upload_door({SB.RESOURCE: SR.SPECS[SB.RESOURCE]})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.shiftboard_writes and app.shiftboard_receipts, beside the other apps' own; rows app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="shiftboard", label="Shift Board")
