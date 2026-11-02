"""Time Off's records in Postgres (app.resource_rows): the requests and the house's settings, uploaded whole from the
Time Off house as the relay reads it live (every copy withholds the reasons), then written here alone, through
time_off_writes' doors, by the relay's time off rules. Read here by My Work and its neighbours (mw_time_off), and by
the relay through app.time_off_kept (db/time_off_kept.sql)."""
from __future__ import annotations

import json
from typing import Any

APP_ID = "timeoff"
RECORDS, SETTINGS = "timeOff", "timeOffSettings"
TAB, SETTINGS_TAB = "time_off", "settings"
RESOURCE_OF = {TAB: RECORDS, SETTINGS_TAB: SETTINGS}
ID_COL = {TAB: "id", SETTINGS_TAB: "key"}
REASON_COL = "time_off_reason"
# a reason as it travels beside its row: withheld as the copies withhold it, read only through reason()
MARK = "[withheld: private]"

# its doors are the relay's, all writes (time_off_writes)
ACTIONS: dict[str, Any] = {}


def _cells(raw: Any) -> dict:
    got = json.loads(raw) if isinstance(raw, str) else raw
    return got if isinstance(got, dict) else {}


def owned(db: Any) -> bool:
    """Whether Postgres holds the records and the settings now: both uploaded, and not handed back to the house."""
    got = db.query("select count(*) from app.resource_columns where resource in (%s, %s) and uploaded_at is not null",
                   (RECORDS, SETTINGS))
    return bool(got) and int(got[0][0] or 0) == 2


def masked(cells: dict) -> dict:
    text = str(cells.get(REASON_COL) or "")
    return {**cells, REASON_COL: MARK if text.strip() else ""}


def rows_of(db: Any, tab: str) -> list[tuple[int, dict]]:
    """(row number, cells) in the house's order, the header as row 1; each reason withheld."""
    got = db.query("select cells from app.resource_rows where resource = %s and removed_at is null"
                   " order by position, created_at, row_key", (RESOURCE_OF[tab],))
    return [(n, masked(_cells(c))) for n, (c,) in enumerate(got, start=2)]


def reason(db: Any, ref: str) -> str:
    got = db.query("select cells from app.resource_rows where resource = %s and row_id = %s and removed_at is null"
                   " order by position limit 1", (RECORDS, str(ref or "").strip().upper()))
    return str(_cells(got[0][0]).get(REASON_COL) or "") if got else ""
