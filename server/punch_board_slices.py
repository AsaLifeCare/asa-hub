"""THE PUNCH BOARD — who clocked in and who did not, as a flat file Smart Comms reads.
PsiAnywhere is the official time clock, and Smart Comms needs a TABLE of every punch — who clocked in and who…"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

RESOURCES = ("commPunchBoard",)

BOARD_FILE = Path(os.getenv(
    "HUB_PSI_PUNCH_BOARD",
    str(Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) / ".psi-punch-board.json")))

# THE COLUMNS THAT CROSS, per kind of row.
SHIFT_FIELDS = ("row_kind", "id", "person", "person_key", "house", "shift_code", "day",
                "shift_at", "shift_end", "time", "verdict", "minutes", "arrived", "ended",
                "open", "entry_id", "early_minutes", "told_source", "checked_at", "known",
                # the house's own name ("JH home"), what kind of day a human said and when it was learned, and what…
                "house_name", "told_kind", "told_at", "late_call", "confirm",
                "hm_no_show_at", "late_call_at",
                # the pair rule (server/punch_pairs.py): the shift's own pair verdict, whether it is a fault and…
                "pair", "pair_fault", "pair_why", "warning_state", "warning_ref",
                "warning_tells", "warning_why")
STATUS_FIELDS = ("row_kind", "id", "generated_at", "clock_state", "clock_why", "read_at",
                 "last_attempt", "mode", "next_collection", "follow_up", "follow_ups_today",
                 "days", "counts", "books", "books_why", "books_at", "history", "session_kept",
                 "session_life", "reminders",
                 # the pair rule's card: when the shifts were paired, whether that is stale, and every warning to…
                 "pairs",
                 # which account the lane signs in with (adm / ty), Ty's day — its tries, the last one and its…
                 "account", "ty", "down")

REFUSED = ("Location_Name", "latitude", "longitude", "consumers", "Number_Consumers_Present",
           "comments", "raw", "_consumers", "_consumer_meta", "keyTimes", "address", "token")

_HOLDS = sorted((set(SHIFT_FIELDS) | set(STATUS_FIELDS)) & set(REFUSED))
if _HOLDS:
    raise RuntimeError("punch_board_slices: the punch board may never carry client data or a "
                       "session — " + ", ".join(_HOLDS))


class BoardMissing(RuntimeError):
    """The lane has not written a board on this host yet."""


def _pick(row: dict, fields: tuple[str, ...]) -> dict[str, Any]:
    return {f: row.get(f) for f in fields if f in row}


def project(body: dict) -> list[dict]:
    """The board file → the slice's rows: the clock first, then every row."""
    status = body.get("status") if isinstance(body.get("status"), dict) else {}
    out = [dict(_pick(status, STATUS_FIELDS), row_kind="status", id="status")]
    for r in body.get("rows") or []:
        if not isinstance(r, dict) or r.get("row_kind") not in ("shift", "punch"):
            continue
        out.append(_pick(r, SHIFT_FIELDS))
    return out


def build(resource: str, _dsn: str = "") -> tuple[list[dict], str | None]:
    """build_one's dispatch shape."""
    if resource not in RESOURCES:
        raise ValueError(f"Unknown resource {resource!r}")
    try:
        body = json.loads(BOARD_FILE.read_text(encoding="utf-8") or "{}")
    except FileNotFoundError as exc:
        raise BoardMissing("the attendance lane has not written a punch board on this host "
                           "yet") from exc
    if not isinstance(body, dict):
        raise ValueError("the punch board is not a record")
    rows = project(body)
    return rows, str(body.get("generated_at") or "") or None
