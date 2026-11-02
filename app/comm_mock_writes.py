"""commMockWebIngest (CommMock.gs) on Python, the relay's door: the held web rows kept in the mock outbox
(app.comm_mock, comm_logs) under the platform's write lock, an id the outbox already holds named written and never
kept twice. A row is named written only once it is kept, so the relay hands the rest again."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

import comm_logs
import comm_mock as CM
import gsjs
import locations as L
import resource_rows as RR
import smart_comms as SC
import staff_views
from writes import Decision

DENIED = {"status": 403, "message": "Requires an admin or manager account"}
BUSY = "Another write holds the platform's lock; the relay hands the web rows again."
ACTOR = "asa-hub:commmock"


def web_write(reads: L.Reads, rows: list[dict]) -> tuple[dict[str, Any], list[dict]]:
    """commMockWebWrite_: every row named written, only the ones the outbox lacks kept (in this write's transaction;
    no kept edit is left for the write to record)."""
    cur = RR._cur()
    have = comm_logs.held_ids(cur, comm_logs.MOCK, [r["id"] for r in rows])
    now = gsjs.iso(datetime.now(timezone.utc))
    held = SC._WRITE.get() or {}
    written: list[str] = []
    appended = 0
    for row in rows:
        if row["id"] not in have:
            cells = {**{h: row.get(h, "") for h in CM.HEADER}, "createdAt": now, "updatedAt": now}
            if not comm_logs.keep(cur, comm_logs.MOCK, cells, SC.write_id(), gsjs.str_(held.get("door")), once=True):
                raise RuntimeError("a web row was not kept in the mock outbox")
            have.add(row["id"])
            appended += 1
        written.append(row["id"])
    return {"written": written, "appended": appended}, []


def web_ingest(sess: L.Session, payload: dict) -> Decision:
    """commMockWebIngest: the relay's held web rows; service or admin only."""
    user = sess.user or {}
    if not sess.user or (user.get("is_service") is not True and gsjs.js_str(user.get("role")) != "admin"):
        return Decision(dict(DENIED))
    picked = CM.web_rows((payload or {}).get("rows") if isinstance(payload, dict) else None)
    if not picked["rows"]:
        return Decision({"status": 200, "data": {"written": [], "refused": picked["refused"]}})
    try:
        wrote, edits = web_write(sess.reads, picked["rows"])
    except Exception as exc:  # noqa: BLE001 - answers nothing as written, so the relay offers the rows again
        staff_views.record({"email": ACTOR}, "comm_mock_web_unwritable", type(exc).__name__, 500)
        return Decision({"status": 503, "message": "the mock outbox could not be written: " + type(exc).__name__})
    return Decision({"status": 200, "data": {"written": wrote["written"], "refused": picked["refused"],
                                             "appended": wrote["appended"]}}, edits=edits or None, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"commMockWebIngest": web_ingest}
POLICY: dict[str, dict[str, Any]] = {"commMockWebIngest": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"commMockWebIngest": {"status": 409, "message": BUSY}}


class Store(RR.Store):
    """app.comm_mock_writes and _receipts; the rows the mock outbox's own table (app.comm_mock)."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="comm_mock", label="The mock outbox")
