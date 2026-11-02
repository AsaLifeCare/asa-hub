"""Staff Issues' one write (StaffIssues.gs staffIssueAdd, app/staff_issues.add): a situation appended to the
Employee HR Tracker, kept in app.edits and carried to the book by the two-way sync."""
from __future__ import annotations

from typing import Any, Callable

import staff_issues as SI
import writes as W

ACTIONS: dict[str, Callable[..., W.Decision]] = {"staffIssueAdd": SI.add}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.staff_issues_writes and app.staff_issues_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="staff_issues", label="Staff Issues")
