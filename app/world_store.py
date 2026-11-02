"""My World's own tables (db/world_rows.sql): the registry of worlds, each world's tabs and their rows — Postgres is
the record, no world is a spreadsheet. A tab is read as App Studio reads one (app/app_builder.py's View: its header,
each row's cells by header, a blank row {}), so every reader answers as it always has; a write lays the changes its door
decides on the tab in the `rows` grammar (app/book_ops.py's rows_lay, the same rules) and keeps what moved — a tab made,
a header widened, rows removed, changed or added — under the write's lock, each change logged with what it replaced so
a void takes it back."""
from __future__ import annotations

import json
from typing import Any, NamedTuple

import app_builder as AB
import book_ops as BO
import gsjs
import locations as L
import resource_rows as RR
import smart_comms as SC
import writes as W
from scope import Defer

WORLDS, TABS, ROWS = "app.worlds", "app.world_tabs", "app.world_rows"
CHANGES, IMPORTS = "app.world_changes", "app.world_imports"
# the registry row as World.gs kept it, but its workbook
FIELDS = ("world_id", "owner_user_id", "owner_email", "name", "created_at", "defaults_version")
REGISTRY = "registry:"
NOT_YET = "My World's registry is not copied into Postgres yet (worldImport)"

s_ = gsjs.str_
_READY = [False]


def _json(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


def _q(reads: L.Reads, sql: str, params: tuple = ()) -> list[tuple]:
    return RR._q(reads, sql, params)


def _cur() -> Any:
    cur = W.HELD.get()
    if cur is None:
        raise Defer("a world is written only under the platform's write lock")
    return cur


# ---- the registry -------------------------------------------------------------------------------------------------

def ready(reads: L.Reads) -> bool:
    """Whether the import has copied the registry; once it has, for good."""
    if not _READY[0]:
        _READY[0] = bool(_q(reads, f"select 1 from {IMPORTS} where source like %s limit 1", (REGISTRY + "%",)))
    return _READY[0]


def registry_rows(reads: L.Reads) -> list[dict[str, str]]:
    """worldRows_: every world, in the registry's order; Defer until the import copied it."""
    def read() -> list[dict[str, str]]:
        if not ready(reads):
            raise Defer(NOT_YET)
        got = _q(reads, f"select {', '.join(FIELDS)} from {WORLDS} order by position, made_at, world_id")
        return [dict(zip(FIELDS, (s_(v) for v in r))) for r in got]
    return reads.once("world:registry", read)


def known(reads: L.Reads, wid: str) -> bool:
    return bool(_q(reads, f"select 1 from {WORLDS} where world_id = %s", (wid,)))


def _log(cur: Any, wid: str, tab: str, row_id: int | None, kind: str, before: Any, after: Any, by: str) -> None:
    cur.execute(f"insert into {CHANGES} (write_id, world_id, tab, row_id, kind, before, after, by_email)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s)",
                (SC.write_id(), wid, tab, row_id, kind, None if before is None else json.dumps(before),
                 None if after is None else json.dumps(after), by))


def world_make(rec: dict[str, Any], by: str) -> None:
    """A world's registry row, after every other."""
    cur = _cur()
    cells = {k: s_(rec.get(k)) for k in FIELDS}
    cur.execute(f"insert into {WORLDS} ({', '.join(FIELDS)}, position, write_id)"
                f" select {', '.join(['%s'] * len(FIELDS))}, coalesce(max(position), 0) + 1, %s from {WORLDS}",
                tuple(cells[k] for k in FIELDS) + (SC.write_id(),))
    _log(cur, cells["world_id"], "", None, "world", None, cells, by)


def world_set(wid: str, fields: dict[str, Any], by: str) -> bool:
    """Registry cells of one world set; whether any moved."""
    cur = _cur()
    keys = [k for k in fields if k in FIELDS and k != "world_id"]
    if not keys:
        return False
    cur.execute(f"select {', '.join(keys)} from {WORLDS} where world_id = %s for update", (wid,))
    got = cur.fetchone()
    if got is None:
        return False
    was = {k: s_(v) for k, v in zip(keys, got)}
    now = {k: s_(fields[k]) for k in keys}
    if was == now:
        return False
    cur.execute(f"update {WORLDS} set {', '.join(k + ' = %s' for k in keys)}, updated_at = now(), write_id = %s"
                " where world_id = %s", tuple(now[k] for k in keys) + (SC.write_id(), wid))
    _log(cur, wid, "", None, "world", was, now, by)
    return True


# ---- a world's tabs -----------------------------------------------------------------------------------------------

class State(NamedTuple):
    """A tab as the reader sees it, and each row's id in the table (None: a row no write has kept yet)."""
    view: AB.View
    keys: tuple


def state(reads: L.Reads, wid: str, tab: str) -> State:
    got = _q(reads, f"select t.header, r.id, r.cells from {TABS} t left join {ROWS} r"
                    " on r.world_id = t.world_id and r.tab = t.tab where t.world_id = %s and t.tab = %s"
                    " order by r.position, r.id", (wid, tab))
    if not got:
        return State(AB.View(wid, tab, False, (), (), None), ())
    rows = [(rid, _json(c) or {}) for _h, rid, c in got if rid is not None]
    return State(AB.View(wid, tab, True, tuple(_json(got[0][0]) or ()), tuple(c for _k, c in rows), None),
                 tuple(k for k, _c in rows))


def view(reads: L.Reads, wid: str, tab: str) -> AB.View:
    """hubTabSheet_ inside the world: the tab, or one that does not exist."""
    return state(reads, wid, tab).view


def views(reads: L.Reads, wid: str) -> list[AB.View]:
    """ss.getSheets(): every tab of the world, by name."""
    by: dict[str, list[dict]] = {}
    for tab, cells in _q(reads, f"select tab, cells from {ROWS} where world_id = %s order by position, id", (wid,)):
        by.setdefault(tab, []).append(_json(cells) or {})
    tabs = sorted(_q(reads, f"select tab, header from {TABS} where world_id = %s", (wid,)), key=lambda t: t[0])
    return [AB.View(wid, t, True, tuple(_json(h) or ()), tuple(by.get(t, ())), None) for t, h in tabs]


def lay(st: State, spec: dict) -> State:
    """One change in the `rows` grammar as book_ops.rows_lay leaves the tab, each row keeping its id."""
    v = st.view
    exists, header = v.exists, list(v.header)
    rows, keys = [dict(r) for r in v.rows], list(st.keys)
    born = spec.get("header") is not None and (not exists or (not any(BO._text(h) for h in header)
                                                              and not any(any(BO._text(x) for x in r.values())
                                                                          for r in rows)))
    if born:
        exists, header, rows, keys = True, list(spec["header"]), [], []
    if not exists:
        return st
    for k in spec.get("grow") or ():
        if k not in header:
            header.append(k)
    if born:
        for r in spec.get("seed") or ():
            rows.append(dict(r))
            keys.append(None)
    drop = spec.get("drop")
    if drop:
        hits = [i for i, r in enumerate(rows) if BO.rows_drops(header, r, drop)]
        gone = set(hits[:1] if drop.get("first") else hits)
        rows, keys = [r for i, r in enumerate(rows) if i not in gone], [k for i, k in enumerate(keys) if i not in gone]
    if spec.get("purge"):
        kept = [i for i, r in enumerate(rows) if not BO.rows_purges(header, r, spec["purge"])]
        rows, keys = [rows[i] for i in kept], [keys[i] for i in kept]
    up = spec.get("update")
    if up and "id" in header:
        hit = next((r for r in rows if BO._text(r.get("id")) == up["key"]), None)
        if hit is not None:
            hit.update(up["cells"])
    unique = spec.get("unique")
    for rec in spec.get("append") or ():
        if unique and any(BO._text(r.get(unique)) == BO._text(rec.get(unique)) for r in rows):
            continue
        rows.append(dict(rec))
        keys.append(None)
    return State(v._replace(exists=True, header=tuple(header), rows=tuple(rows)), tuple(keys))


def save(wid: str, first: dict[str, State], last: dict[str, State], by: str) -> bool:
    """Each tab kept as the write left it: made or its header changed, the rows it removed, changed and added; whether
    anything moved."""
    cur = _cur()
    wrote = False
    for tab, after in last.items():
        before = first[tab]
        bv, av = before.view, after.view
        if not av.exists:
            continue
        head = list(av.header)
        if not bv.exists:
            cur.execute(f"insert into {TABS} (world_id, tab, header, write_id) values (%s, %s, %s, %s)",
                        (wid, tab, json.dumps(head), SC.write_id()))
            _log(cur, wid, tab, None, "tab", None, {"header": head}, by)
            wrote = True
        elif list(bv.header) != head:
            cur.execute(f"update {TABS} set header = %s, updated_at = now(), write_id = %s"
                        " where world_id = %s and tab = %s", (json.dumps(head), SC.write_id(), wid, tab))
            _log(cur, wid, tab, None, "tab", {"header": list(bv.header)}, {"header": head}, by)
            wrote = True
        had = dict(zip(before.keys, bv.rows))
        kept = {k for k in after.keys if k is not None}
        gone = [k for k in before.keys if k not in kept]
        if gone:
            cur.execute(f"delete from {ROWS} where id = any(%s) returning id, position, cells", (gone,))
            for rid, pos, cells in cur.fetchall():
                _log(cur, wid, tab, rid, "delete", {"position": pos, "cells": _json(cells)}, None, by)
            wrote = True
        for k, cells in zip(after.keys, av.rows):
            if k is not None and had.get(k) != cells:
                cur.execute(f"update {ROWS} set cells = %s, updated_at = now(), write_id = %s where id = %s",
                            (json.dumps(cells), SC.write_id(), k))
                _log(cur, wid, tab, k, "update", {"cells": had.get(k)}, {"cells": cells}, by)
                wrote = True
        added = [cells for k, cells in zip(after.keys, av.rows) if k is None]
        if added:
            cur.execute(f"insert into {ROWS} (world_id, tab, position, cells, write_id)"
                        f" select %s, %s, base.at + e.n, e.c, %s from (select coalesce(max(position), 0) as at"
                        f" from {ROWS} where world_id = %s and tab = %s) base,"
                        " jsonb_array_elements(%s::jsonb) with ordinality as e(c, n)"
                        " returning id, position, cells",
                        (wid, tab, SC.write_id(), wid, tab, json.dumps(added)))
            for rid, pos, cells in cur.fetchall():
                _log(cur, wid, tab, rid, "create", None, {"position": pos, "cells": _json(cells)}, by)
            wrote = True
    return wrote


def void(conn: Any, write_id: str) -> None:
    """A write the relay took back: each change under it undone, newest first."""
    for _cid, wid, tab, rid, kind, before in conn.execute(
            f"select id, world_id, tab, row_id, kind, before from {CHANGES} where write_id = %s order by id desc",
            (write_id,)).fetchall():
        before = _json(before)
        if kind == "create":
            conn.execute(f"delete from {ROWS} where id = %s", (rid,))
        elif kind == "update":
            conn.execute(f"update {ROWS} set cells = %s, updated_at = now() where id = %s",
                         (json.dumps(before["cells"]), rid))
        elif kind == "delete":
            conn.execute(f"insert into {ROWS} (id, world_id, tab, position, cells) values (%s, %s, %s, %s, %s)"
                         " on conflict (id) do nothing", (rid, wid, tab, before["position"], json.dumps(before["cells"])))
        elif kind == "tab" and before is None:
            conn.execute(f"delete from {TABS} where world_id = %s and tab = %s", (wid, tab))
        elif kind == "tab":
            conn.execute(f"update {TABS} set header = %s, updated_at = now() where world_id = %s and tab = %s",
                         (json.dumps(before["header"]), wid, tab))
        elif kind == "world" and before is None:
            conn.execute(f"delete from {WORLDS} where world_id = %s", (wid,))
        elif kind == "world":
            keys = [k for k in before if k in FIELDS and k != "world_id"]
            if keys:
                conn.execute(f"update {WORLDS} set {', '.join(k + ' = %s' for k in keys)}, updated_at = now()"
                             " where world_id = %s", tuple(before[k] for k in keys) + (wid,))
    conn.execute(f"delete from {CHANGES} where write_id = %s", (write_id,))


# ---- the import's half (app/world_import.py) ----------------------------------------------------------------------

def imported(reads: L.Reads, source: str) -> bool:
    return bool(_q(reads, f"select 1 from {IMPORTS} where source = %s", (source,)))


def import_world(rec: dict[str, Any], tabs: list[AB.View], source: str) -> dict[str, int]:
    """One world copied whole, its registry row after every other, never logged as a write's change: (tabs, rows)."""
    cur = _cur()
    cells = {k: s_(rec.get(k)) for k in FIELDS}
    wid = cells["world_id"]
    cur.execute(f"insert into {WORLDS} ({', '.join(FIELDS)}, position, write_id)"
                f" select {', '.join(['%s'] * len(FIELDS))}, coalesce(max(position), 0) + 1, %s from {WORLDS}",
                tuple(cells[k] for k in FIELDS) + (SC.write_id(),))
    n = {"tabs": 0, "rows": 0}
    for v in tabs:
        cur.execute(f"insert into {TABS} (world_id, tab, header, write_id) values (%s, %s, %s, %s)",
                    (wid, v.tab, json.dumps(list(v.header)), SC.write_id()))
        if v.rows:
            cur.executemany(f"insert into {ROWS} (world_id, tab, position, cells, write_id) values (%s, %s, %s, %s, %s)",
                            [(wid, v.tab, i, json.dumps(dict(r)), SC.write_id()) for i, r in enumerate(v.rows, 1)])
        n["tabs"] += 1
        n["rows"] += len(v.rows)
    mark(source, wid, n)
    return n


def mark(source: str, wid: str, counts: dict[str, Any]) -> None:
    _cur().execute(f"insert into {IMPORTS} (source, world_id, counts, write_id) values (%s, %s, %s, %s)"
                   " on conflict (source) do nothing", (source, wid, json.dumps(counts), SC.write_id()))
