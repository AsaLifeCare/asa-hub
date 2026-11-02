"""What a kept edit cannot carry into a book for the generic verbs, queued in app.book_ops by the write that decided it
and carried by asa-hub-sheet-sync: a row deleted (SheetDb.gs deleteRowById_, Estate.gs estateRoute_'s deleteRow) by
the `delete` op, a tab made or its header widened (sheetFor_, ensureHeader_) by the App Builder's `rows` op, a row
whose id the tab already holds appended by the `append` op. The carriers are book_ops' and the App Builder's; this
module is the doors' side: the ops queued, a row the sheet does not hold yet withdrawn from app.edits instead of
deleted there (and put back if its write is void), and the deletes on their way left out by the tab's readers until
the copy holds them."""
from __future__ import annotations

from typing import Any, Callable

import book_ops as BO
import gsjs
import hubdb
import locations as L
import writes as W

DELETE, ROWS, APPEND = "delete", "rows", "append"
# a delete carried is left out until the copy of its book was synced after it, for at most this long
HIDE_DONE_S = 6 * 3600.0
_EDIT_COLUMNS = ("id", "write_id", "app", "action", "sheet_id", "tab_name", "kind", "match_by", "keyed_by", "row_key",
                 "field", "value", "before", "author", "edition", "at")


def subject(resource: str, key: str) -> str:
    """The op's subject: one row of one resource, or its header."""
    return f"{resource}:{key}"


def _q(reads: L.Reads, sql: str, params: tuple) -> list[tuple]:
    """Through the write's own cursor inside a write (it sees what the write queued), else the read connection."""
    cur = W.HELD.get()
    if cur is not None:
        cur.execute(sql, params)
        return list(cur.fetchall())
    return reads.db.query(sql, params)


def _cur() -> Any:
    cur = W.HELD.get()
    if cur is None:
        raise W.NotKept("a book change is queued only under the platform's write lock")
    return cur


# ---- the ops queued, in the write's transaction ------------------------------------------------------------------

def queue_delete(resource: str, sid: str, tab: str, spec: dict, key: str, author: str, action: str,
                 withdrew: list[dict] | None = None) -> None:
    """The `delete` op ({match, key, which, expect} or {where, which, expect}); the kept append withdrawn for it rides
    along, so a void of this write puts it back."""
    spec = {**spec, "resource": resource}
    if withdrew:
        spec["withdrew"] = withdrew
    BO.queue([{"op": DELETE, "sheet_id": sid, "tab": tab, "spec": spec}], subject(resource, key), author, action)


def queue_append(resource: str, sid: str, tab: str, cells: dict, key: str, author: str, action: str) -> None:
    """appendRow of a row a kept append could not name: its id already names a row of the tab."""
    BO.queue([{"op": APPEND, "sheet_id": sid, "tab": tab, "spec": {"cells": cells}}], subject(resource, key), author,
             action)


def queue_columns(resource: str, sid: str, tab: str, ref: hubdb.TabRef | None, names: list[str], author: str,
                  action: str) -> list[str]:
    """ensureHeader_, and the tab sheetFor_ makes when the book has none, by the App Builder's `rows` op: the header
    widened after its last column (no row rewritten). Answers the header a row is laid on."""
    have = [h for h in (ref.headers if ref is not None else ()) if h]
    missing = [n for n in names if n not in have]
    if ref is None:
        BO.queue([{"op": ROWS, "sheet_id": sid, "tab": tab, "spec": {"header": list(names), "grow": list(names)}}],
                 subject(resource, "header"), author, action)
        return list(names)
    if missing:
        BO.queue([{"op": ROWS, "sheet_id": sid, "tab": tab, "spec": {"grow": missing}}], subject(resource, "header"),
                 author, action)
    return have + missing


# ---- a row the sheet does not hold yet: its kept append withdrawn -------------------------------------------------

def withdraw(sid: str, tab: str, named: Callable[[dict], bool]) -> list[dict]:
    """The kept append `named` picks (an appended row of this tab, none of its cells on the sheet yet) taken out of
    app.edits in this write; its rows answered, to ride the delete op. [] when the sheet may hold it already."""
    own = hubdb.OWN.get()
    group = next((g for g in (getattr(own, "edits", None) or {}).get((sid, tab)) or () if g["appended"] and named(g)),
                 None)
    if group is None:
        return []
    cur = _cur()
    where = ("sheet_id = %s and tab_name = %s and match_by = %s and keyed_by = %s and row_key = %s",
             (sid, tab, group["match"], group["keyed"], group["row_key"]))
    cur.execute(f"select 1 from {W.beside('edit_sync')} where {where[0]} and state in ('synced', 'superseded')"
                " limit 1", where[1])
    if cur.fetchall():
        return []
    cur.execute(f"select {', '.join(_EDIT_COLUMNS)} from {W.EDITS_TABLE} where {where[0]} order by id", where[1])
    rows = [dict(zip(_EDIT_COLUMNS, (r[i] if i < len(r) - 1 else gsjs.or_blank(r[i]) for i in range(len(r)))))
            for r in cur.fetchall()]
    cur.execute(f"delete from {W.EDITS_TABLE} where {where[0]}", where[1])
    return rows


def cancel(conn: Any, write_id: str) -> None:
    """A write the relay took back: its ops not carried yet are never carried, and the kept append it withdrew is
    kept again."""
    got = conn.execute(f"select spec -> 'withdrew' from {BO.table()} where write_id = %s and spec ? 'withdrew'",
                       (write_id,)).fetchall()
    for (rows,) in got:
        for r in rows or []:
            conn.execute(f"insert into {W.EDITS_TABLE} ({', '.join(_EDIT_COLUMNS)}) values"
                         f" ({', '.join(['%s'] * (len(_EDIT_COLUMNS) - 1))}, coalesce(nullif(%s, '')::timestamptz,"
                         " now())) on conflict do nothing", tuple(r.get(c) for c in _EDIT_COLUMNS))
    conn.execute(f"update {BO.table()} set state = 'cancelled', done_at = now(), why = 'its write was void'"
                 " where write_id = %s and state = 'pending'", (write_id,))


# ---- the readers' side: a delete on its way ----------------------------------------------------------------------

def deleting(reads: L.Reads, sid: str, tab: str) -> list[dict]:
    """The deletes the copy may not hold yet (waiting, being carried, or carried but the book not synced since),
    oldest first: each op's spec."""
    def read() -> list[dict]:
        got = _q(reads, f"select spec, state, extract(epoch from done_at) from {BO.table()}"
                        " where op = %s and sheet_id = %s and tab_name = %s and (state in ('pending', 'applying')"
                        " or state = 'done' and done_at > now() - make_interval(secs => %s)) order by id",
                 (DELETE, sid, tab, HIDE_DONE_S))
        book = reads.db.book(sid)
        synced = hubdb._epoch(book.synced_at) if book is not None else 0.0
        return [spec if isinstance(spec, dict) else {} for spec, state, done in got
                if state != "done" or synced <= float(done or 0)]
    return reads.once(f"rowops:{sid}:{tab}", read)


def _drop(rows: list[dict], specs: list[dict], hit: Callable[[dict, dict], bool]) -> list[dict]:
    out = list(rows)
    for spec in specs:
        found = [i for i, r in enumerate(out) if hit(spec, r)]
        if found:
            out.pop(found[-1] if spec.get("which") == "last" else found[0])
    return out


def unremoved(reads: L.Reads, ref: hubdb.TabRef | None, rows: list[dict]) -> list[dict]:
    """A Hub tab's rows (readAll_'s, keyed by header) as the sheet will hold them once each delete on its way by
    `match` and `key` is carried."""
    if ref is None or not rows:
        return rows
    specs = [s for s in deleting(reads, ref.sheet_id, ref.tab) if s.get("match")]
    if not specs:
        return rows
    return _drop(rows, specs, lambda s, r: gsjs.trim(gsjs.or_blank(r.get(s["match"])))
                 == gsjs.trim(gsjs.or_blank(s.get("key"))))


def unremoved_estate(reads: L.Reads, sid: str, tab: str, rows: list[dict]) -> list[dict]:
    """An estate tab's rows (estateRows_', keyed by estateKey_) as the sheet will hold them once each delete on its way
    by `where` is carried."""
    if not sid or not rows:
        return rows
    specs = [s for s in deleting(reads, sid, tab) if isinstance(s.get("where"), dict)]
    if not specs:
        return rows

    def hit(spec: dict, row: dict) -> bool:
        return all(gsjs.or_blank(row.get(hubdb.estate_key(h)))
                   == gsjs.or_blank(hubdb.estate_cell(hubdb.typed(v, "estate"))) for h, v in spec["where"].items())
    return _drop(rows, specs, hit)


def in_copy(reads: L.Reads, ref: hubdb.TabRef | None, key: str) -> bool:
    """Whether the copy itself (no kept edit laid) holds a row with this id."""
    if ref is None or ref.row_count < 0 or "id" not in ref.headers:
        return False
    return any(gsjs.or_blank(hubdb.typed(raw.get("id"), "raw")) == key for _rn, raw in reads.db._copy_rows(ref))
