"""The Dr Appointments book kept in asa-hub-db's own tables (app/resource_rows.py): the booked visits (Dr Appt Archive,
drVisits) and the doctors (Dr Master, drAppointments), uploaded once from the book's copy and from then on read and
written there alone. Future Apts, the book's view of the visits still ahead, is not kept: the visits are. Once a day
the book's copy is looked at for rows still filed on the sheet (its form), and each is carried into its table."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from types import SimpleNamespace
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import resource_rows as RR
import smart_comms as SC

log = logging.getLogger("asa-hub-app.dr-book")

PROP = "ESTATE_DR_ID"
TABS = {"drVisits": "Dr Appt Archive", "drAppointments": "Dr Master"}
FUTURE_TAB = "Future Apts"
CHECK_EVERY_S = float(os.getenv("HUB_DR_BOOK_CHECK_EVERY_S", "86400"))
CARRIED_BY = "dr-book daily check"
# the row key of a sheet row: an uploaded one (r<n>), one carried by the daily check (sheet:r<n>)
_SHEET_KEY = re.compile(r"(?:sheet:)?r(\d+)")


class KeptTab:
    """A kept tab where a reader holds a copy's: its headers, and (row number, cells by header) of every row, an
    uploaded row numbered by its sheet row and a row made here after every other."""

    def __init__(self, resource: str, headers: list[str], rows: list[tuple[int, dict]]) -> None:
        self.resource, self.tab, self.headers, self.rows = resource, TABS[resource], headers, rows


def held(reads: L.Reads, resource: str) -> bool:
    """Whether Postgres holds this tab of the book (uploaded); never for a tab the book does not keep."""
    return resource in TABS and reads.once("dr_book:held:" + resource, lambda: RR.uploaded(reads.db, resource))


def kept(reads: L.Reads, resource: str) -> KeptTab:
    def read() -> KeptTab:
        cols = [h for h in RR.columns(reads, resource) if h]
        rows = [(p, {h: gsjs.or_blank(c.get(h)) for h in cols}) for _k, p, c in RR.placed_rows(reads, resource)]
        return KeptTab(resource, cols, rows)
    return reads.once("dr_book:kept:" + resource, read)


def row_at(reads: L.Reads, resource: str, row_num: int) -> tuple[str, dict] | None:
    """(row key, cells as kept) of the row a visit's id r<n> names."""
    for k, p, c in RR.placed_rows(reads, resource):
        if p == row_num:
            return k, c
    return None


def upload(reads: L.Reads, resource: str) -> dict[str, int]:
    """The book's copy of the tab into its table (resource_rows.upload_rows): every row by its sheet row, a row made,
    changed or removed here never touched again."""
    sid = gsjs.trim(reads.db.prop(PROP))
    if not sid:
        raise RuntimeError(f"no {PROP} is declared in the depot")
    token = hubdb.COPY.set(True)  # the copy itself, never the table it is kept in
    try:
        ref = reads.tab_of(sid, TABS[resource], f"the {TABS[resource]}")
    finally:
        hubdb.COPY.reset(token)
    if ref is None:
        raise RuntimeError(f'the Dr Appointments book has no "{TABS[resource]}" tab in asa-hub-db')
    heads = [h for h in ref.headers if h != ""]
    rows = [(rn, {h: raw.get(h) for h in heads if raw.get(h) not in (None, "")}) for rn, raw in reads.db.rows(ref)]
    return RR.upload_rows(resource, sid, ref.tab, heads, rows)


def _same(cells: dict) -> str:
    return json.dumps({h: gsjs.js_str(v) for h, v in cells.items() if v not in (None, "")}, sort_keys=True)


def carry(reads: L.Reads, resource: str,
          sheet: tuple[list[str], list[tuple[int, dict]]] | None = None) -> int:
    """The look at the book for one tab Postgres holds: each sheet row past the last one the table carries, whose cells
    no row of the table holds already, made after every other row (an id of its own, r<place>); how many. The rows are
    `sheet` ((headers, [(sheet row, cells)]), as the essential sheets' sweep read them from Google), else the book's
    copy. A row the sheet re-numbered or one carried before is never made twice; a row changed on the sheet is not
    followed."""
    if not held(reads, resource):
        return 0
    cur = RR._cur()
    if sheet is not None:
        sheet_heads, sheet_rows = sheet
        ref = SimpleNamespace(headers=sheet_heads)
    else:
        sid = gsjs.trim(reads.db.prop(PROP))
        token = hubdb.COPY.set(True)  # the copy itself, never the table it is kept in
        try:
            ref = reads.tab_of(sid, TABS[resource], f"the {TABS[resource]}") if sid else None
        finally:
            hubdb.COPY.reset(token)
        if ref is None:
            return 0
        sheet_rows = reads.db.rows(ref)
    got = RR._q(reads, f"select row_key, cells from {RR.rows_of(resource)} where resource = %s", (resource,))
    seen = [int(m.group(1)) for k, _c in got if (m := _SHEET_KEY.fullmatch(str(k)))]
    if not seen:
        return 0
    top, have = max(seen), {_same(RR._json(c) or {}) for _k, c in got}
    heads = [h for h in ref.headers if h != ""]
    made = 0
    for rn, raw in sheet_rows:
        cells = {h: raw.get(h) for h in heads if raw.get(h) not in (None, "")}
        if rn <= top or not cells or _same(cells) in have:
            continue
        key = f"sheet:r{rn}"
        RR._widen(reads, resource, list(cells))
        table = RR.rows_of(resource)
        cur.execute(f"insert into {table} (resource, row_key, row_id, position, cells, origin, write_id)"
                    f" select %s, %s, '', coalesce(max(position), 0) + 1, %s, 'postgres', %s from {table}"
                    " where resource = %s", (resource, key, json.dumps(cells), SC.write_id(), resource))
        RR._log(cur, resource, key, "create", None, cells, CARRIED_BY)
        have.add(_same(cells))
        made += 1
    return made


def check(store: Any, reads_of: Callable[[], L.Reads]) -> dict[str, int]:
    """One look: every tab's carry, in one write under the platform's lock."""
    with store.locked():
        token = SC._WRITE.set({**(SC._WRITE.get() or {}), "write_id": f"dr-book-{int(time.time())}"})
        try:
            reads = reads_of()
            return {r: carry(reads, r) for r in TABS}
        finally:
            SC._WRITE.reset(token)


async def daily(store: Any, reads_of: Callable[[], L.Reads]) -> None:
    """check every HUB_DR_BOOK_CHECK_EVERY_S, the first five minutes after the start."""
    await asyncio.sleep(300.0)
    while True:
        try:
            got = await asyncio.to_thread(check, store, reads_of)
            log.info("dr book: the sheet looked at, %s", ", ".join(f"{r} {n} carried" for r, n in got.items()))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - looked at again on the next pass
            log.warning("dr book: the daily look at the sheet failed (%s)", type(exc).__name__)
        await asyncio.sleep(CHECK_EVERY_S)
