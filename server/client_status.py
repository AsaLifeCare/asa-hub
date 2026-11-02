"""Whether a client is live: the engine's one rule (clientLive_, Locations.gs) — not archived, and a status…"""

from __future__ import annotations

from typing import Any


def live(row: Any) -> bool:
    """A client row (a slice's, or a pack's client): not archived, and its status blank or 'active', any case."""
    if not isinstance(row, dict):
        return False
    archived = row.get("archived")
    if archived is True or str(archived or "").strip().lower() == "true":
        return False
    return str(row.get("status") or "").strip().lower() in ("", "active")
