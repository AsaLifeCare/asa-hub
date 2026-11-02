"""Reminders' writes (the generic create, update and delete on `reminders`, Main.gs route), kept in Postgres alone
(app/resource_rows.py): a reminder added or edited, a move onto done stamped as hubStampWhen_ stamps it (completedAt,
cleared on leaving), a reminder removed. remindersUpload brings the reminders sheet into Postgres again for the relay
(rows nothing here has touched), and hands it back as the app returns to Apps Script."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import resource_rows as RR
import sheet_resources as SR
from writes import Decision

BUSY = "Somebody else is changing the reminders right now — try again."


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, "reminders", payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, "reminders", payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, "reminders", payload)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "remindersCreate": create, "remindersUpdate": update, "remindersDelete": delete,
    "remindersUpload": RR.upload_door({"reminders": SR.SPECS["reminders"]})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.reminders_writes and app.reminders_receipts, beside the other apps' own; the rows app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="reminders", label="Reminders")
