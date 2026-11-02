"""The Line Directory's write (line_directory): the platform's copy of the lines the relay hands over, kept in
app.line_directory under the platform's write lock; the same store's connection keeps what a read stores."""
from __future__ import annotations

from typing import Any, Callable

import line_directory as LD
import locations as L
import resource_rows as RR
from writes import Decision

BUSY = "Somebody else is saving the line directory right now — try again."

ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = dict(LD.WRITE_ACTIONS)
POLICY: dict[str, dict[str, Any]] = {a: p for a, p in LD.POLICY.items() if a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.line_directory_writes and _receipts; the directory app.line_directory."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="line_directory", label="Line Directory")
