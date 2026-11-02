"""House code → label, name and street, read-only from the client entities book's entity_homes tab in asa-hub-db."""
from __future__ import annotations

import logging
import os
import re
import threading
import time
from typing import Any

log = logging.getLogger("hub.house_directory")

ENTITIES_SHEET_ID = os.getenv("HUB_CLIENT_ENTITIES_SHEET_ID", "1yIc3f9S9ZRlAJ3drUinFmm0gTflO-GUx0BVaFVYVopI")
HOMES_TAB = "entity_homes"
TTL_S = float(os.getenv("HUB_HOUSE_DIRECTORY_TTL_S", "600"))

_LOCK = threading.Lock()
_CACHE: dict[str, Any] = {"at": 0.0, "rows": {}}


def label_of(home_name: Any, code: Any = "") -> str:
    """ "CAN - JH - ABD2704" → "JH": the region prefix and the code both go."""
    parts = [p.strip() for p in str(home_name or "").split(" - ") if p.strip()]
    code = str(code or "").strip()
    if parts and code and parts[-1].upper() == code.upper():
        parts = parts[:-1]
    elif len(parts) >= 2 and re.fullmatch(r"[A-Z]{2,4}\d{3,6}", parts[-1]):
        parts = parts[:-1]
    if len(parts) >= 2 and re.fullmatch(r"[A-Z]{3}", parts[0]):
        parts = parts[1:]
    return " - ".join(parts) or code


def code_of(house: Any) -> str:
    text = str(house or "").strip()
    last = text.split(" - ")[-1].strip() if text else ""
    return last.upper()


def read(dsn: str, now: float | None = None) -> dict[str, dict[str, str]]:
    """code → {code, label, name, address, region}. Cached TTL_S."""
    now = time.time() if now is None else now
    with _LOCK:
        if _CACHE["rows"] and now - float(_CACHE["at"]) < TTL_S:
            return dict(_CACHE["rows"])
    import lanes_sheets  # noqa: PLC0415
    rows: dict[str, dict[str, str]] = {}
    for r in lanes_sheets.data(ENTITIES_SHEET_ID, HOMES_TAB):
        code = str(r.get("abbreviation") or "").strip().upper() or code_of(r.get("home_name"))
        if not code:
            continue
        label = label_of(r.get("home_name"), code)
        rows[code] = {"code": code, "label": label,
                      "name": f"{label} home" if label and label != code else code,
                      "address": " ".join(str(r.get("address") or "").split()),
                      "region": str(r.get("region") or "").strip()}
    with _LOCK:
        _CACHE.update(at=now, rows=rows)
    return dict(rows)


def lookup(dsn: str, house: Any) -> dict[str, str] | None:
    code = code_of(house)
    if not code:
        return None
    return read(dsn).get(code)


def forget() -> None:
    """Tests only."""
    with _LOCK:
        _CACHE.update(at=0.0, rows={})
