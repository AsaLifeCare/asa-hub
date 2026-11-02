"""Books people still type into, kept in asa-hub-db's own tables (app/resource_rows.py) and followed until they stop:
the Asa Employee Database (CERT_SOURCE_ID, sheet_resources.EMPLOYEE_BOOK_TABS), the recruiters' book
(RECRUIT_BOOK_ID, RECRUIT_BOOK_TABS) and the division's task lists (DIVISION_TASKS_ID, DIVISION_TASKS_TABS), each
uploaded once from its copy and from then on read and written there alone.
Every HUB_FOLLOWED_BOOKS_EVERY_S each tab is brought up to its sheet: a row the sheet adds is added, a row nothing here
changed takes the sheet's cells, a row the sheet drops goes; a row made, changed or removed here is the Hub's and never
touched again (resource_rows.upload_rows)."""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Callable

import locations as L
import resource_rows as RR
import sheet_resources as SR
import smart_comms as SC

log = logging.getLogger("asa-hub-app.followed-books")

BOOKS = ("CERT_SOURCE_ID", "RECRUIT_BOOK_ID", "DIVISION_TASKS_ID", "ESTATE_REPAIRS_ID", "STAFF_DOCS_SHEET_ID",
         "UPLOAD_DOCS_ID", "ESTATE_HR_ID", "HUB_MISSING_MEDS_SHEET_ID", "SCREENING_NOTES_ID",
         "VOICE_BOT_ID", "CREDENTIALS_BOOK_ID", *SR.SWEPT_BOOKS)
FOLLOW_EVERY_S = float(os.getenv("HUB_FOLLOWED_BOOKS_EVERY_S", os.getenv("HUB_EMPLOYEE_BOOK_FOLLOW_EVERY_S", "3600")))
RESOURCES = {r: s["tab"] for r, s in SR.BOOKED.items() if s.get("book") in BOOKS}


def follow(store: Any, reads_of: Callable[[], L.Reads]) -> dict[str, dict[str, int]]:
    """One look at the books' copies: each tab Postgres holds brought up to the sheet's rows nothing here touched, in
    one write under the platform's lock."""
    with store.locked():
        token = SC._WRITE.set({**(SC._WRITE.get() or {}), "write_id": f"followed-books-{int(time.time())}"})
        try:
            reads = reads_of()
            out: dict[str, dict[str, int]] = {}
            for r, tab in RESOURCES.items():
                if not RR.uploaded(reads.db, r):
                    continue
                why = _unsure(reads, r)
                if why:
                    log.warning("followed books: %s not followed — %s", r, why)
                    continue
                out[r] = RR.upload(reads, r, tab, SR.DERIVE.get(r))
            return out
        finally:
            SC._WRITE.reset(token)


def _unsure(reads: L.Reads, resource: str) -> str:
    """Why the copy cannot be followed now: a tab it no longer holds, or far fewer rows than the sheet's own here (a
    copy caught mid-load never takes rows out)."""
    ref = SR.copy_of(reads.db, resource).ref
    if ref is None:
        return "its copy holds no such tab"
    got = RR._q(reads, f"select count(*) from {RR.rows_of(resource)} where resource = %s and origin = 'sheet'"
                       " and removed_at is null", (resource,))
    have = int(got[0][0]) if got else 0
    if ref.row_count <= 0 or ref.row_count < 0.8 * have:
        return f"its copy holds {ref.row_count} row(s) against {have} here"
    return ""


async def hourly(store: Any, reads_of: Callable[[], L.Reads]) -> None:
    """follow every HUB_FOLLOWED_BOOKS_EVERY_S, the first ten minutes after the start."""
    await asyncio.sleep(600.0)
    while True:
        try:
            got = await asyncio.to_thread(follow, store, reads_of)
            moved = {r: {k: n for k, n in c.items() if k in ("added", "refreshed", "dropped") and n}
                     for r, c in got.items()}
            log.info("followed books: the sheets followed — %s",
                     "; ".join(f"{r} {m}" for r, m in moved.items() if m) or "nothing changed there")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - followed again on the next pass
            log.warning("followed books: following the sheets failed (%s)", type(exc).__name__)
        await asyncio.sleep(FOLLOW_EVERY_S)
