"""PRN staff for CommBroadcast.gs: only a note of exactly "PRN" counts; an unreadable mirror raises."""
from __future__ import annotations

import re
from typing import Any

_PRN_WORD = re.compile(r"\bprn\b", re.IGNORECASE)


def _key(name: str) -> str:
    """Must match Clients.gs clientNameKey_."""
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())


def prn_from_staff(rows: list[dict] | None) -> dict[str, Any]:
    names: list[str] = []
    exact: set[str] = set()
    for r in rows or []:
        name = str((r or {}).get("name") or "").strip()
        note = str((r or {}).get("note") or "").strip()
        key = _key(name)
        if not key or key in exact or note.upper() != "PRN":
            continue
        exact.add(key)
        names.append(name)
    mentions: list[dict[str, str]] = []
    said: set[str] = set()
    for r in rows or []:
        name = str((r or {}).get("name") or "").strip()
        note = str((r or {}).get("note") or "").strip()
        key = _key(name)
        if not key or key in exact or key in said or not _PRN_WORD.search(note):
            continue
        said.add(key)
        mentions.append({"name": name, "note": note[:80]})
    return {"names": names, "mentions": mentions}


def prn_view(dsn: str) -> dict[str, Any]:
    import calendar_builder_slices  # noqa: PLC0415

    rows, stamp = calendar_builder_slices._staff(dsn)
    out = prn_from_staff(rows)
    out.update(readable=True, rows=len(rows or []), as_of=str(stamp or ""))
    return out
