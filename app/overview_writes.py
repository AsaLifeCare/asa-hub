"""Overview's one write: overviewUpload brings the activity sheet into Postgres again for the relay (rows nothing here
has touched) — the page reads its rows there alone (app/resource_rows.py)."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import resource_rows as RR
import sheet_resources as SR
import writes as W
from writes import Decision

ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "overviewUpload": RR.upload_door({"activity": SR.SPECS["activity"]})}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.overview_writes and app.overview_receipts, beside the other apps' own; the rows app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="overview", label="Overview")
