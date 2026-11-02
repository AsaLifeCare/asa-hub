"""Widgets' writes (the generic create, update and delete on `widgets`, Main.gs route), kept in Postgres alone
(app/resource_rows.py): a spec added, changed or removed by an admin or a manager. widgetsUpload brings the bank's
sheet into Postgres again for the relay (rows nothing here has touched)."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import resource_rows as RR
import sheet_resources as SR
import writes as W
from writes import Decision

BUSY = "Somebody else is changing the widget bank right now — try again."


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, "widgets", payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, "widgets", payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, "widgets", payload)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "widgetsCreate": create, "widgetsUpdate": update, "widgetsDelete": delete,
    "widgetsUpload": RR.upload_door({"widgets": SR.SPECS["widgets"]})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.widget_bank_writes and app.widget_bank_receipts, beside the other apps' own; the rows
    app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="widget_bank", label="Widgets")
