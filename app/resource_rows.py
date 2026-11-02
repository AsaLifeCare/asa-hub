"""The generic resources the Hub's own apps run in Postgres (db/resource_rows.sql): each uploaded whole from its
sheet's copy, then read and written here alone — a row made, changed or removed, a column a write names added after
the sheet's — every write logged in app.resource_changes, so a void takes it back and a sync can read what Postgres
changed. Postgres is the record: an upload run again brings only the rows nothing here has touched, and never a row
removed here."""
from __future__ import annotations

import json
import re
import uuid
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import smart_comms as SC
import writes as W
from scope import Defer

ROWS, COLUMNS, CHANGES = "app.resource_rows", "app.resource_columns", "app.resource_changes"
# the resources whose rows live in a table of their own (db/quo_tables.sql, db/events_table.sql,
# db/depot_facts_table.sql: app.resource_rows' shape, with the indexes their lookups need), every statement here naming
# it in place of app.resource_rows
OWN_TABLES = {"quoTranscripts": "app.quo_calls", "quoMessages": "app.quo_texts", "quoSummaries": "app.quo_recaps",
              "eventTrail": "app.trail_events", hubdb.FACTS_RESOURCE: hubdb.FACTS_TABLE}
# what a trimmed key cell is matched by, as its index on a table of its own holds it
TRIMMED = "btrim(coalesce(cells->>{col}, ''), E' \\t\\n\\r\\f')"
WITHHELD = "[withheld"


def rows_of(resource: str) -> str:
    """The table a resource's rows live in."""
    return OWN_TABLES.get(resource, ROWS)

s_ = gsjs.str_


def _json(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


def _q(reads: L.Reads, sql: str, params: tuple = ()) -> list[tuple]:
    """Through the write's own cursor inside a write (it sees what the write did), else the read connection."""
    cur = W.HELD.get()
    if cur is not None:
        cur.execute(sql, params)
        return list(cur.fetchall())
    return reads.db.query(sql, params)


def _cur() -> Any:
    cur = W.HELD.get()
    if cur is None:
        raise Defer("a resource row is written only under the platform's write lock")
    return cur


def row_id_of(cells: dict) -> str:
    """String(id) as getValues hands the id cell back."""
    return gsjs.js_str(hubdb.typed(cells.get("id"), "hub")) if cells.get("id") is not None else ""


# ---- reading ----------------------------------------------------------------------------------------------------

def uploaded(db: hubdb.HubDb, resource: str) -> bool:
    """Whether Postgres holds the resource now (uploaded, and not handed back to the sheet since) — inside a write, as
    the write's own cursor sees it."""
    sql, params = f"select 1 from {COLUMNS} where resource = %s and uploaded_at is not null", (resource,)
    cur = W.HELD.get()
    if cur is not None:
        cur.execute(sql, params)
        return cur.fetchone() is not None
    return bool(db.query(sql, params))


def columns(reads: L.Reads, resource: str) -> list[str]:
    """The resource's headers, in the sheet's order and then the ones written here; Defer before its upload."""
    got = _q(reads, f"select columns from {COLUMNS} where resource = %s and uploaded_at is not null", (resource,))
    if not got:
        raise Defer(f"{resource} is not uploaded to Postgres yet")
    return [str(c) for c in (_json(got[0][0]) or [])]


def table_rows(reads: L.Reads, resource: str) -> list[tuple[str, dict]]:
    """(row_key, cells) of every row not removed, in the sheet's order, then the order rows were made here."""
    return [(k, _json(c) or {}) for k, c in _q(
        reads, f"select row_key, cells from {rows_of(resource)} where resource = %s and removed_at is null"
               " order by position, created_at, row_key", (resource,))]


def placed_rows(reads: L.Reads, resource: str) -> list[tuple[str, int, dict]]:
    """table_rows with each row's position: an uploaded row's sheet row, a row made here after every other."""
    return [(k, int(p or 0), _json(c) or {}) for k, p, c in _q(
        reads, f"select row_key, position, cells from {rows_of(resource)} where resource = %s and removed_at is null"
               " order by position, created_at, row_key", (resource,))]


def shown(cols: list[str], cells: dict) -> dict | None:
    """readAll_ of one row: header-keyed, Dates as cellText_, JSON-looking text parsed; None for a row of blanks."""
    vals = [hubdb.typed(cells.get(h), "hub") for h in cols]
    if all(v == "" or v is None for v in vals):
        return None
    return {h: hubdb.cell_text(v) for h, v in zip(cols, vals) if h != ""}


def read_all(reads: L.Reads, resource: str) -> list[dict]:
    """listRows_' rows: every row with anything in it; a row its sheet gave no id is named by its row key, so a screen
    can edit and remove it (find takes the key back)."""
    cols = columns(reads, resource)
    return [r if r.get("id") not in (None, "") else {"id": k, **r}
            for k, r in ((k, shown(cols, c)) for k, c in table_rows(reads, resource)) if r is not None]


def find(reads: L.Reads, resource: str, rid: str) -> tuple[str, dict] | None:
    """requireRow_'s findRowIndex_: the first row whose id is this one, else the row an id-less row's key names
    (read_all's), (row_key, cells)."""
    rows = table_rows(reads, resource)
    for k, c in rows:
        if row_id_of(c) == rid:
            return k, c
    return next(((k, c) for k, c in rows if k == rid and not row_id_of(c)), None)


# ---- writing ----------------------------------------------------------------------------------------------------

def _log(cur: Any, resource: str, key: str, kind: str, before: dict | None, after: dict | None, by: str) -> None:
    cur.execute(f"insert into {CHANGES} (write_id, resource, row_key, kind, before, after, by_email)"
                " values (%s, %s, %s, %s, %s, %s, %s)",
                (SC.write_id(), resource, key, kind, None if before is None else json.dumps(before),
                 None if after is None else json.dumps(after), by))


def _widen(reads: L.Reads, resource: str, keys: list[str]) -> None:
    """ensureHeader_: the headers a write names that the resource lacks, after its own, in the write's order."""
    cols = columns(reads, resource)
    extra = [k for k in keys if k != "" and k not in cols]
    if extra:
        _cur().execute(f"update {COLUMNS} set columns = %s, updated_at = now() where resource = %s",
                       (json.dumps(cols + extra), resource))


def create(reads: L.Reads, resource: str, cells: dict[str, str], by: str) -> str:
    """createRow_'s appendRow: the row after every other, its cells as written; its key."""
    cur = _cur()
    _widen(reads, resource, list(cells))
    rid = row_id_of(cells)
    taken = {k for (k,) in _q(reads, f"select row_key from {rows_of(resource)} where resource = %s and row_key like %s",
                              (resource, (rid or "p") + "%"))}
    key = rid if rid and rid not in taken else (rid or "p") + "#" + uuid.uuid4().hex[:12]
    cur.execute(f"insert into {rows_of(resource)} (resource, row_key, row_id, position, cells, origin, write_id)"
                f" select %s, %s, %s, coalesce(max(position), 0) + 1, %s, 'postgres', %s from {rows_of(resource)}"
                " where resource = %s", (resource, key, rid, json.dumps(cells), SC.write_id(), resource))
    _log(cur, resource, key, "create", None, cells, by)
    return key


def create_many(reads: L.Reads, resource: str, rows: list[dict[str, str]], by: str) -> list[str]:
    """create for many rows in one go — the columns widened once, the rows and their log written together; their keys."""
    if not rows:
        return []
    cur = _cur()
    _widen(reads, resource, list(dict.fromkeys(k for r in rows for k in r)))
    taken = {k for (k,) in _q(reads, f"select row_key from {rows_of(resource)} where resource = %s", (resource,))}
    got = _q(reads, f"select coalesce(max(position), 0) from {rows_of(resource)} where resource = %s", (resource,))
    at = int(got[0][0] or 0) if got else 0
    keys, made, logged = [], [], []
    for i, cells in enumerate(rows, 1):
        rid = row_id_of(cells)
        key = rid if rid and rid not in taken else (rid or "p") + "#" + uuid.uuid4().hex[:12]
        taken.add(key)
        keys.append(key)
        made.append((resource, key, rid, at + i, json.dumps(cells), SC.write_id()))
        logged.append((SC.write_id(), resource, key, "create", None, json.dumps(cells), by))
    cur.executemany(f"insert into {rows_of(resource)} (resource, row_key, row_id, position, cells, origin, write_id)"
                    " values (%s, %s, %s, %s, %s, 'postgres', %s)", made)
    cur.executemany(f"insert into {CHANGES} (write_id, resource, row_key, kind, before, after, by_email)"
                    " values (%s, %s, %s, %s, %s, %s, %s)", logged)
    return keys


def update_many(reads: L.Reads, resource: str, items: list[tuple[str, dict, dict[str, str]]], by: str) -> None:
    """update for many rows in one go: (key, the row's cells, the changed ones) each."""
    if not items:
        return
    cur = _cur()
    _widen(reads, resource, list(dict.fromkeys(k for _key, _b, ch in items for k in ch)))
    rows, logged = [], []
    for key, before, changed in items:
        after = {**before, **changed}
        rows.append((json.dumps(after), row_id_of(after), SC.write_id(), resource, key))
        logged.append((SC.write_id(), resource, key, "update", json.dumps(before), json.dumps(after), by))
    cur.executemany(f"update {rows_of(resource)} set cells = %s, row_id = %s, origin = 'postgres', updated_at = now(),"
                    " write_id = %s where resource = %s and row_key = %s", rows)
    cur.executemany(f"insert into {CHANGES} (write_id, resource, row_key, kind, before, after, by_email)"
                    " values (%s, %s, %s, %s, %s, %s, %s)", logged)


def update(reads: L.Reads, resource: str, key: str, before: dict, changed: dict[str, str], by: str) -> None:
    """updateRowById_'s setValues: the row's cells with the changed ones over them; Postgres holds it from now on."""
    cur = _cur()
    _widen(reads, resource, list(changed))
    after = {**before, **changed}
    cur.execute(f"update {rows_of(resource)} set cells = %s, row_id = %s, origin = 'postgres', updated_at = now(),"
                " write_id = %s where resource = %s and row_key = %s",
                (json.dumps(after), row_id_of(after), SC.write_id(), resource, key))
    _log(cur, resource, key, "update", before, after, by)


def remove(reads: L.Reads, resource: str, key: str, before: dict, by: str) -> None:
    """deleteRow: the row marked removed, never forgotten, so no upload brings it back."""
    cur = _cur()
    cur.execute(f"update {rows_of(resource)} set removed_at = now(), removed_by = %s, origin = 'postgres',"
                " write_id = %s where resource = %s and row_key = %s", (by, SC.write_id(), resource, key))
    _log(cur, resource, key, "delete", before, None, by)


def remove_many(reads: L.Reads, resource: str, items: list[tuple[str, dict]], by: str, removed_by: str = "") -> int:
    """remove for many rows in one go — (key, the row's cells) each — every one marked removed and logged as remove
    logs it, so a void brings each back; `removed_by` says why on the row (the log keeps who, `by`). The rows marked."""
    if not items:
        return 0
    cur = _cur()
    wid = SC.write_id()
    cur.executemany(f"update {rows_of(resource)} set removed_at = now(), removed_by = %s, origin = 'postgres',"
                    " write_id = %s where resource = %s and row_key = %s and removed_at is null",
                    [(removed_by or by, wid, resource, key) for key, _cells in items])
    cur.executemany(f"insert into {CHANGES} (write_id, resource, row_key, kind, before, after, by_email)"
                    " values (%s, %s, %s, 'delete', %s, null, %s)",
                    [(wid, resource, key, json.dumps(cells), by) for key, cells in items])
    return len(items)


def void(conn: Any, write_id: str, resource: str | None = None) -> None:
    """A write the relay took back: each change under it undone (only one resource's, when named), newest first."""
    rows = conn.execute(f"select id, resource, row_key, kind, before from {CHANGES} where write_id = %s"
                        " and (%s::text is null or resource = %s) order by id desc",
                        (write_id, resource, resource)).fetchall()
    for cid, resource, key, kind, before in rows:
        if kind == "create":
            conn.execute(f"delete from {rows_of(resource)} where resource = %s and row_key = %s", (resource, key))
        elif kind == "update":
            conn.execute(f"update {rows_of(resource)} set cells = %s, updated_at = now()"
                         " where resource = %s and row_key = %s", (json.dumps(_json(before) or {}), resource, key))
        else:
            conn.execute(f"update {rows_of(resource)} set removed_at = null, removed_by = ''"
                         " where resource = %s and row_key = %s", (resource, key))
        conn.execute(f"delete from {CHANGES} where id = %s", (cid,))


# ---- the upload from the sheet's copy ----------------------------------------------------------------------------

def upload(reads: L.Reads, resource: str, tab: str,
           derive: dict[str, Callable[[dict], str]] | None = None) -> dict[str, int]:
    """The sheet's copy into Postgres: the copy's rows not here yet added, the rows nothing here has touched brought
    to what the copy holds, the sheet's rows gone taken out — a row made, changed or removed here is never touched.
    The columns: the copy's, then the ones written here. A cell the copy withholds is worked out again by `derive`
    when its column names one (a value the row is derived from elsewhere); any other withheld cell stops the upload."""
    import sheet_resources as SR  # noqa: PLC0415 - it imports this module
    _cur()
    res = SR.copy_of(reads.db, resource) if resource in SR.SPECS else reads.db.resolve(tab)
    if res.runtime:
        raise Defer(f"{tab} lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
    heads = [h for h in (res.ref.headers if res.ref else ()) if h != ""]
    copy = reads.db.rows(res.ref) if res.ref else []
    return lay(resource, res.sheet_id, tab, heads, copy, derive)


def lay(resource: str, sheet_id: str, tab: str, heads: list[str], copy: list[tuple[int, dict]],
        derive: dict[str, Callable[[dict], str]] | None = None, drop: bool = True) -> dict[str, int]:
    """upload over a sheet's rows in hand ((sheet row, cells by header), withheld cells marked as a copy marks them):
    the copy's, or the ones the essential sheets' sweep read from Google (app/essential_sheets.py, drop False: a row
    the sheet no longer has stays)."""
    derive = derive or {}

    def withheld(v: Any) -> bool:
        return isinstance(v, str) and v.startswith(WITHHELD)

    if any(withheld(v) and h not in derive for _rn, raw in copy for h, v in raw.items()):
        raise Defer(f"the copy of {tab} withholds a cell: its rows are not uploaded")
    def text(v: Any) -> Any:
        # a kept edit laid as a list or an object is the JSON the sheet's cell held
        return json.dumps(v, separators=(",", ":"), ensure_ascii=False) if isinstance(v, (dict, list)) else v

    rows = []
    for rn, raw in copy:
        cells = {h: text(raw.get(h)) for h in heads if raw.get(h) not in (None, "")}
        for h, work_out in derive.items():
            if withheld(cells.get(h)):
                got = work_out(cells)
                if got:
                    cells[h] = got
                else:
                    cells.pop(h)
        rows.append((rn, cells))
    return upload_rows(resource, sheet_id, tab, heads, rows, drop=drop)


def upload_rows(resource: str, sheet_id: str, tab: str, heads: list[str],
                rows: list[tuple[int, dict]], drop: bool = True) -> dict[str, int]:
    """upload's merge over rows already in hand ((sheet row, cells)): the ones not here added, the ones nothing here
    touched brought up to date, the sheet's own rows gone taken out unless `drop` is False — a row made, changed or
    removed here never is."""
    cur = _cur()
    cur.execute(f"select row_key, origin, removed_at is not null, cells, position from {rows_of(resource)}"
                " where resource = %s", (resource,))
    have = {k: (o, gone, _json(c) or {}, p) for k, o, gone, c, p in cur.fetchall()}
    seen: set[str] = set()
    n = {"added": 0, "refreshed": 0, "kept": 0, "dropped": 0}
    # gathered first and sent as batches: a tab of thousands of rows stays inside a write's budget
    added: list[tuple] = []
    refreshed: list[tuple] = []
    for rn, cells in rows:
        cells = {h: v for h, v in cells.items() if v not in (None, "")}
        if not cells:
            continue
        rid = row_id_of(cells)
        key = rid or f"r{rn}"
        if key in seen:
            key = f"{key}#r{rn}"
        seen.add(key)
        was = have.get(key)
        if was is None:
            added.append((resource, key, rid, rn, json.dumps(cells)))
        elif was[0] == "sheet" and not was[1]:
            if was[2] != cells or was[3] != rn:
                refreshed.append((json.dumps(cells), rid, rn, resource, key))
        else:
            n["kept"] += 1
    dropped = [(resource, key) for key, (origin, gone, _c, _p) in have.items()
               if drop and origin == "sheet" and not gone and key not in seen]
    if added:
        cur.executemany(f"insert into {rows_of(resource)} (resource, row_key, row_id, position, cells, origin)"
                        " values (%s, %s, %s, %s, %s, 'sheet')", added)
    if refreshed:
        cur.executemany(f"update {rows_of(resource)} set cells = %s, row_id = %s, position = %s, updated_at = now()"
                        " where resource = %s and row_key = %s", refreshed)
    if dropped:
        cur.executemany(f"delete from {rows_of(resource)} where resource = %s and row_key = %s", dropped)
    n.update(added=len(added), refreshed=len(refreshed), dropped=len(dropped))
    cur.execute(f"select columns from {COLUMNS} where resource = %s", (resource,))
    got = cur.fetchone()
    cols = heads + [c for c in ([str(x) for x in (_json(got[0]) or [])] if got else []) if c not in heads]
    cur.execute(f"insert into {COLUMNS} (resource, columns, sheet_id, tab_name, uploaded_at) values (%s, %s, %s, %s,"
                " now()) on conflict (resource) do update set columns = excluded.columns, sheet_id = excluded.sheet_id,"
                " tab_name = excluded.tab_name, uploaded_at = now(), updated_at = now()",
                (resource, json.dumps(cols), sheet_id, tab))
    n["rows"] = len(seen)
    return n


# each copied row's non-blank cells under the header, as upload_rows keeps them (an object or a list as its JSON text)
_CELLS_SQL = ("(select coalesce(jsonb_object_agg(e.key, case when jsonb_typeof(e.value) in ('object', 'array')"
              " then to_jsonb(e.value::text) else e.value end), '{}'::jsonb) from jsonb_each(t._raw) e"
              " where e.key = any(%s) and e.value not in ('null'::jsonb, '\"\"'::jsonb))")


def upload_in_db(resource: str, tab: str, ref: hubdb.TabRef) -> dict[str, int]:
    """upload for a tab too long to hold in a process (the events trail): the copy's rows laid into the resource's
    table by the database itself, as upload_rows lays them — each row's non-blank cells, keyed by its id or its sheet
    row, at its sheet row — for a resource that holds no row yet. The kept edits laid over the copy are not in it:
    tools/carry-appends.py carries them."""
    cur = _cur()
    if not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table):
        raise hubdb.Unreadable(f"the catalog names an unusable table for {ref.tab}")
    cur.execute(f"select count(*) from {rows_of(resource)} where resource = %s", (resource,))
    if cur.fetchone()[0]:
        raise Defer(f"{resource} holds rows already: only a first upload is laid by the database")
    heads = [h for h in ref.headers if h != ""]
    cur.execute("set local statement_timeout = 0")
    cur.execute(f"insert into {rows_of(resource)} (resource, row_key, row_id, position, cells, origin)"  # noqa: S608
                " select %s, case when n.rid = '' then 'r' || n.rn when n.dup = 1 then n.rid"
                " else n.rid || '#r' || n.rn end, n.rid, n.rn, n.cells, 'sheet'"
                " from (select t.row_number as rn, c.cells, coalesce(c.cells->>'id', '') as rid,"
                " row_number() over (partition by coalesce(c.cells->>'id', '') order by t.row_number) as dup"
                f' from sheets."{ref.table}" t cross join lateral (select {_CELLS_SQL} as cells) c'
                " where c.cells <> '{}'::jsonb) n", (resource, heads))
    added = cur.rowcount
    cur.execute(f"select columns from {COLUMNS} where resource = %s", (resource,))
    got = cur.fetchone()
    cols = heads + [c for c in ([str(x) for x in (_json(got[0]) or [])] if got else []) if c not in heads]
    cur.execute(f"insert into {COLUMNS} (resource, columns, sheet_id, tab_name, uploaded_at) values (%s, %s, %s, %s,"
                " now()) on conflict (resource) do update set columns = excluded.columns, sheet_id = excluded.sheet_id,"
                " tab_name = excluded.tab_name, uploaded_at = now(), updated_at = now()",
                (resource, json.dumps(cols), ref.sheet_id, tab))
    return {"added": added, "rows": added}


def lay_kept_edits(sheet_id: str, tabs: list[str], since: str) -> dict[str, int]:
    """The kept edits a book's tab holds in app.edits since a moment, laid on its table as each write would lay them
    now (writes.into_tables), write by write in the order they were kept: an append of a key the table holds laid on
    that row, one it does not made, an edit on its row. For an upload by the database, which carries none of them."""
    cur = _cur()
    cur.execute(f"select write_id, author, tab_name, kind, match_by, keyed_by, row_key, field, value"
                f" from {W.EDITS_TABLE} where sheet_id = %s and tab_name = any(%s) and at >= %s order by at, id",
                (sheet_id, tabs, since))
    writes: dict[str, tuple[str, dict[tuple, dict]]] = {}
    for wid, author, tab, kind, match, keyed, key, field, value in cur.fetchall():
        held = writes.setdefault(wid, (author or "", {}))[1]
        held.setdefault((tab, kind, match, keyed, key), {})[field] = value
    n = {"writes": 0, "records": 0}
    for wid, (author, groups) in writes.items():
        recs = [{"sheet_id": sheet_id, "tab_name": tab, "kind": kind, "match": match, "keyed": keyed,
                 "row_key": key, "house": "", "cells": cells}
                for (tab, kind, match, keyed, key), cells in groups.items()]
        W.into_tables(cur, "lay:" + wid, recs, author or "lay-kept-edits")
        n["writes"] += 1
        n["records"] += len(recs)
    return n


def unlike_copy(resource: str, ref: hubdb.TabRef) -> dict[str, int]:
    """The copy's rows the table does not hold as they are, counted by the database: a row missing, or its cells not
    the copy's (each by its sheet row's key, as upload_in_db keyed it)."""
    cur = _cur()
    heads = [h for h in ref.headers if h != ""]
    cur.execute("set local statement_timeout = 0")
    cur.execute(f"select count(*) filter (where r.row_key is null), count(*) filter (where r.cells <> c.cells)"  # noqa: S608
                f' from sheets."{ref.table}" t cross join lateral (select {_CELLS_SQL} as cells) c'
                f" left join {rows_of(resource)} r on r.resource = %s and r.position = t.row_number"
                " and r.origin = 'sheet' where c.cells <> '{}'::jsonb", (heads, resource))
    missing, differ = cur.fetchone()
    return {"missing": int(missing or 0), "differ": int(differ or 0)}


class Store(W.Store):
    """An app's write store whose writes land in these tables: a void takes each change under it back."""

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    void(self.conn(), write_id)
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("resource rows: the void of %s was not applied (%s)", write_id[:40], type(exc).__name__)
        return done


# ---- the upload as a door, for the relay when an app is given to Python ----------------------------------------

def upload_door(specs: dict[str, dict[str, Any]]) -> Callable[[L.Session, dict], W.Decision]:
    def door(sess: L.Session, payload: dict) -> W.Decision:
        """The relay's own identity uploads these resources' sheets again (rows nothing here has touched) as their
        app is given to Python, or hands them back (`release`) as it goes back to Apps Script: from then until the
        next upload, a reader beside the app reads the sheet's copy, which Apps Script writes."""
        if (sess.user or {}).get("is_service") is not True:
            return W.Decision({"status": 403, "message": "The upload is the relay's alone."})
        if (payload or {}).get("release") is True:
            for r in specs:
                _cur().execute(f"update {COLUMNS} set uploaded_at = null, updated_at = now() where resource = %s", (r,))
            return W.Decision({"status": 200, "data": {r: {"released": True} for r in specs}}, subject="", own=True)
        done = {r: upload(sess.reads, r, spec["tab"]) for r, spec in specs.items()}
        return W.Decision({"status": 200, "data": done}, subject="", own=True)
    return door
