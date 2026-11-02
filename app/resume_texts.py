"""A résumé that is a scan, as Staff Candidates › Resume reads it: the relay's lane (server/resume_texts.py) reads each
owed file once by OCR and keeps its words in asa-hub-db (app.resume_texts); this side reads them and owes the lane the
scans it has not read yet. asa-hub-app never runs OCR itself."""
from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger("asa-hub-app")

TABLE = "app.resume_texts"
_BOUND: dict[str, Any] = {}


def bind(store: Any) -> None:
    """The write store whose connection owes the lane its files (main.py's Staff Candidates store)."""
    _BOUND["store"] = store


def kept(reads: Any, file_id: str) -> dict[str, Any] | None:
    """The lane's row for the file: its state, its words, the modified time they are of and why it failed."""
    rows = reads.db.query(f"select state, text, modified_time, error from {TABLE} where file_id = %s", (file_id,))
    if not rows:
        return None
    state, text, modified, error = rows[0]
    return {"state": str(state or ""), "text": str(text or ""), "modified_time": str(modified or ""),
            "error": str(error or "")}


def owe(file_id: str, modified_time: str, candidate: str) -> None:
    """The file queued for the lane at this modified time (a newer one is read again); a queue that cannot be written
    never fails a read."""
    store = _BOUND.get("store")
    if not file_id or store is None or not store.available:
        return
    try:
        store.conn().execute(
            f"insert into {TABLE} (file_id, modified_time, candidate) values (%s, %s, %s)"
            " on conflict (file_id) do update set modified_time = excluded.modified_time, state = 'pending',"
            " attempts = 0, error = '', next_try_at = now(), updated_at = now()"
            f" where {TABLE}.modified_time <> excluded.modified_time and {TABLE}.modified_time <> ''",
            (file_id, modified_time, candidate))
    except Exception as exc:  # noqa: BLE001 - the next read owes it again
        log.warning("resume texts: %s not queued (%s)", file_id, type(exc).__name__)
