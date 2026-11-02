"""What a kept edit cannot carry into a book — a header named for a client, rows no key tells apart, a row moved from
one tab to another, a row taken off, a row added under the formulas above it — queued in app.book_ops by the write
that decided it, in its transaction, and carried to the sheet by asa-hub-sheet-sync (app/sheet_sync.py): the tab
read live and changed as Apps Script changed it. The copy follows when the keeper reads the book again; until then the client's next rename or move waits."""
from __future__ import annotations

import json
import logging
import time
from typing import Any

import gsjs
import hubdb
import locations as L
import writes as W

log = logging.getLogger("asa-hub-book-ops")

CHANNEL = "hub_book_ops"
# `mirror`: a lane's house rewritten whole from its estate book's newest rows (app/lane_mirror.py); `cells`: cells
# written on the last row an id names, where the id names identical rows no kept edit can tell apart (or on every row
# it names, or on the one row all its cells name); `delete`: a row taken off while it holds what the copy held;
# `append`: a row written after the last one, the formulas of the rows above carried into it; `rows`: one tab made,
# its header widened, its rows removed (by place), changed or added (rows_apply, below); `grid_cells`, `table_rows`,
# `house_cells`: the Calendar Builder's records copied to their sheets (app/calendar_carry.py)
OPS = ("rename", "move", "mirror", "cells", "delete", "append", "rows", "grid_cells", "table_rows", "house_cells")
# the ops whose books Postgres keeps a record of its own, never through app.edits: they never make a record book
OWN_RECORD_OPS = ("grid_cells", "table_rows", "house_cells")
# the rows above an appended one its formulas are looked for in, at most
FORMULA_ROWS_MAX = 200
STATES = ("pending", "applying", "done", "refused", "failed", "cancelled")
# a failed request is asked again this many times before the op is left failed
TRIES = 5
# an op the keeper has not read back after this long no longer holds the client's next change
SETTLE_MAX_S = 1800.0
# an op claimed by a sync that died while applying it is claimed again after this long
CLAIM_S = 600.0
SETTLING = "The last change of this client is still being written into the books; try again in a few minutes."


def table() -> str:
    """app.book_ops, or its stand-in beside a stand-in app.edits."""
    return W.beside("book_ops")


def ddl() -> tuple[str, ...]:
    ops = ", ".join(f"'{o}'" for o in OPS)
    states = ", ".join(f"'{s}'" for s in STATES)
    return (
        f"create table if not exists {table()} ("
        " id bigserial primary key, write_id text not null, action text not null, subject text not null default '',"
        f" sheet_id text not null, tab_name text not null, op text not null check (op in ({ops})),"
        " spec jsonb not null default '{}', author text not null default '',"
        f" state text not null default 'pending' check (state in ({states})), why text not null default '',"
        " tries int not null default 0, at timestamptz not null default now(), claimed_at timestamptz,"
        " done_at timestamptz)",
        f"create index if not exists book_ops_open on {table()} (id) where state in ('pending', 'applying')",
        f"create index if not exists book_ops_subject on {table()} (subject, id desc)",
    )


# ---- the app's side: queued under the write lock ------------------------------------------------------------------

def _held() -> Any:
    cur = W.HELD.get()
    if cur is None:
        raise W.NotKept("a book change is queued only under the platform's write lock")
    return cur


def queue(ops: list[dict], subject: str, author: str, action: str) -> None:
    """Each op ({op, sheet_id, tab, spec}) kept in this write's transaction; the sync told once it commits."""
    if not ops:
        return
    import smart_comms as SC  # noqa: PLC0415 - the write's id is the door's, set where it is decided
    cur = _held()
    wid = SC.write_id()
    try:
        cur.executemany(
            f"insert into {table()} (write_id, action, subject, sheet_id, tab_name, op, spec, author)"
            " values (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)",
            [(wid, action, subject, o["sheet_id"], o["tab"], o["op"], json.dumps(o["spec"]), author) for o in ops])
        cur.execute(f"notify {CHANNEL}")
    except Exception as exc:  # noqa: BLE001 - the whole write rolls back with it
        raise W.NotKept(f"app.book_ops refused the insert ({type(exc).__name__})") from exc


def _open_of(reads: L.Reads, subject: str) -> list[tuple]:
    """Through the write's own cursor inside a write, else the read connection."""
    sql = (f"select id, sheet_id, tab_name, op, spec, state, extract(epoch from done_at) from {table()}"
           " where subject = %s and (state in ('pending', 'applying')"
           " or state = 'done' and done_at > now() - make_interval(secs => %s)) order by id")
    cur = W.HELD.get()
    if cur is None:
        return reads.db.query(sql, (subject, SETTLE_MAX_S))
    cur.execute(sql, (subject, SETTLE_MAX_S))
    return list(cur.fetchall())


def settling(reads: L.Reads, subject: str, but: Any = None) -> bool:
    """An op of this client not yet on the sheet, or on it but not yet read back into the copy (`but` excepted)."""
    for _oid, sid, _tab, op, spec, state, done in _open_of(reads, subject):
        if but is not None and but(op, spec if isinstance(spec, dict) else json.loads(spec or "{}"), state):
            continue
        if state != "done":
            return True
        book = reads.db.book(sid)
        if book is None or hubdb._epoch(book.synced_at) <= float(done or 0):
            return True
    return False


def cancel_move(subject: str, sheet_id: str, frm: str, to: str) -> str:
    """A move of this client the other way, still waiting: 'cancelled' (the row never left), 'busy' (being written
    now), or '' (none)."""
    cur = _held()
    cur.execute(f"update {table()} set state = 'cancelled', done_at = now(), why = 'moved back before it was written'"
                " where subject = %s and op = 'move' and state = 'pending' and sheet_id = %s and tab_name = %s"
                " and spec ->> 'to' = %s returning id", (subject, sheet_id, to, frm))
    if cur.fetchall():
        return "cancelled"
    cur.execute(f"select 1 from {table()} where subject = %s and op = 'move' and state = 'applying' and sheet_id = %s",
                (subject, sheet_id))
    return "busy" if cur.fetchall() else ""


# ---- a row Postgres itself took off a tab: never written back, never kept as owed ----------------------------------

# the ops that take a row off its tab, and how long after one was carried a row gone from the sheet is laid to it
REMOVING = ("delete", "move", "rows")
REMOVED_DAYS = 7


def removing(conn: Any, sid: str, tab: str) -> list[tuple[str, dict]]:
    """(op, spec) of every op that takes rows off this tab, waiting, being carried or carried lately."""
    rows = conn.execute(f"select op, spec from {table()} where sheet_id = %s and tab_name = %s and op = any(%s)"
                        " and (state in ('pending', 'applying')"
                        " or state = 'done' and done_at > now() - make_interval(days => %s))",
                        (sid, tab, list(REMOVING), REMOVED_DAYS)).fetchall()
    return [(op, spec if isinstance(spec, dict) else json.loads(spec or "{}")) for op, spec in rows]


def removes(op: str, spec: dict, row: dict) -> bool:
    """Whether the op takes this row (its cells as the copy keys them) off its tab; True when that cannot be told."""
    if op == "delete":
        match = gsjs.or_blank(spec.get("match"))
        if spec.get("keys") is not None:
            return gsjs.trim(gsjs.or_blank(row.get(match))) in {gsjs.trim(gsjs.or_blank(k)) for k in spec["keys"]}
        where = spec.get("where")
        if where is not None:
            want = {h: _shown(v) for h, v in (where if isinstance(where, dict) else {}).items() if not withheld(v)}
            return all(_shown(row.get(h)) == v for h, v in want.items())
        return bool(match) and gsjs.trim(gsjs.or_blank(row.get(match))) == gsjs.trim(gsjs.or_blank(spec.get("key")))
    if op == "rows":
        header = list(row)
        drop, purge = spec.get("drop"), spec.get("purge")
        return bool(drop and rows_drops(header, row, drop)) or bool(purge and rows_purges(header, row, purge))
    # a move: the row may be the one moved away
    return True


# ---- the sync's side: each op read live and written in one request ------------------------------------------------

def claim(conn: Any, limit: int = 20) -> list[dict]:
    """The oldest open ops, marked applying (one sync claims each)."""
    rows = conn.execute(
        f"update {table()} set state = 'applying', claimed_at = now(), tries = tries + 1 where id in ("
        f" select id from {table()} where (state = 'pending' or state = 'applying'"
        " and claimed_at < now() - make_interval(secs => %s)) order by id limit %s for update skip locked)"
        " returning id, sheet_id, tab_name, op, spec, tries, subject", (CLAIM_S, limit)).fetchall()
    return [{"id": int(r[0]), "sheet_id": r[1], "tab": r[2], "op": r[3],
             "spec": r[4] if isinstance(r[4], dict) else json.loads(r[4] or "{}"), "tries": int(r[5]),
             "subject": r[6]} for r in sorted(rows)]


def settle(conn: Any, oid: int, state: str, why: str = "") -> None:
    conn.execute(f"update {table()} set state = %s, why = %s, done_at = case when %s in ('done', 'refused', 'failed')"
                 " then now() end where id = %s", (state, why[:400], state, oid))


def _spec_of(spec: dict) -> dict | None:
    import client_rename as CR  # noqa: PLC0415 - the rename's own specs, read where the op is carried
    if spec.get("hub"):
        return next((s for s in CR.HUB_TABS if s["tab"] == spec["hub"]), None)
    return next((s for s in CR.BOOKS if s["book"] == spec.get("book")), None)


def rename_cells(values: list[list[Any]], spec: dict) -> tuple[list[tuple], int, str]:
    """cpRenameScan_ over the tab as it stands: (cells, rows, why)."""
    import client_rename as CR  # noqa: PLC0415
    found = _spec_of(spec)
    if found is None:
        return [], 0, "the rename names a tab it no longer knows"
    got = CR.scan(found, values, spec["rn"])
    return got["cells"], got["rows"], got["why"]


def move_plan(sv: list[list[Any]], dv: list[list[Any]], name: str, frm: str, to: str) -> dict[str, Any]:
    """cpBookMove_ on the two tabs as they stand: { why }, { absent }, { done }, or { at, cols: [(from, to)] }."""
    import client_rename as CR  # noqa: PLC0415
    import clients as C  # noqa: PLC0415
    hit, there = CR.book_row_of(sv, name), CR.book_row_of(dv, name)
    if hit.get("twin"):
        return {"why": f"Two rows of the {frm} tab carry this name, so neither was moved."}
    if hit.get("absent"):
        return {"absent": True} if there.get("absent") else {"done": True}
    if not there.get("absent"):
        return {"why": f"The {to} tab already holds a row with this name, so nothing was moved."}
    d_head, s_head = [C.fold(h) for h in (dv[0] if dv else [])], [C.fold(h) for h in sv[0]]
    d_fields = [CR._field_of(h) for h in d_head]
    line = sv[hit["at"]]
    cols, taken, lost = [], set(), []
    for i, h in enumerate(s_head):
        v = line[i] if i < len(line) else ""
        if v == "" or v is None:
            continue
        j = d_head.index(h) if h and h in d_head else -1
        if j == -1 and CR._field_of(h):
            j = d_fields.index(CR._field_of(h)) if CR._field_of(h) in d_fields else -1
        if j == -1:
            lost.append(gsjs.or_blank(sv[0][i]))
        elif j not in taken:
            taken.add(j)
            cols.append((i, j))
    if lost:
        return {"why": f"The {to} tab has no column for {', '.join(lost[:5])}, so nothing was moved."}
    return {"at": hit["at"], "cols": cols}


def move_requests(src: dict, dst: dict, at: int, below: int, cols: list[tuple[int, int]]) -> list[dict]:
    """The row's cells pasted (values as they are, masked ones too, never read here) under the other tab's last row,
    then the row deleted: one batchUpdate, all or nothing, as appendRow and deleteRow."""
    out: list[dict] = []
    if below >= int(dst.get("rows") or 0):
        out.append({"appendDimension": {"sheetId": dst["id"], "dimension": "ROWS", "length": 1}})
    for i, j in cols:
        out.append({"copyPaste": {
            "source": {"sheetId": src["id"], "startRowIndex": at, "endRowIndex": at + 1, "startColumnIndex": i,
                       "endColumnIndex": i + 1},
            "destination": {"sheetId": dst["id"], "startRowIndex": below, "endRowIndex": below + 1,
                            "startColumnIndex": j, "endColumnIndex": j + 1},
            "pasteType": "PASTE_VALUES"}})
    out.append({"deleteDimension": {"range": {"sheetId": src["id"], "dimension": "ROWS", "startIndex": at,
                                              "endIndex": at + 1}}})
    return out


def cells_plan(values: list[list[Any]], spec: dict) -> dict[str, Any]:
    """The `cells` op on the tab as it stands: the last row whose `match` column holds `key` (as Apps Script's index
    by id kept the last), or the first when `which` says so (as commRecordUpsert_ found it), and each cell that differs
    from what it holds — { why } or { row, cells: [(r, c, value)] }."""
    import sheet_sync as SS  # noqa: PLC0415 - the sync's own header rule, read where the op is carried
    at, header = SS.header_of(values)
    col = {}
    for i, h in enumerate(header):
        if h and h not in col:
            col[h] = i
    match, key = gsjs.or_blank(spec.get("match")), gsjs.trim(gsjs.or_blank(spec.get("key")))
    if match not in col or not key:
        return {"why": f"the tab has no {match or 'key'} column"}
    lacking = [f for f in (spec.get("cells") or {}) if f not in col]
    if lacking:
        return {"why": "the tab has no column " + ", ".join(lacking[:4])}
    rows = [r for r in range(at + 1, len(values))
            if gsjs.trim(gsjs.or_blank((values[r] + [""] * len(header))[col[match]])) == key]
    if not rows:
        return {"why": f"no row of the tab holds {match} {key}"}
    r = rows[0] if spec.get("which") == "first" else rows[-1]
    line = values[r] + [""] * len(header)
    cells = [(r, col[f], v) for f, v in (spec.get("cells") or {}).items()
             if gsjs.or_blank(line[col[f]]) != gsjs.or_blank(v)]
    return {"row": r, "cells": cells}


def _shown(v: Any) -> str:
    """A cell as the sheet shows it: the copy's linked text as its text alone, trimmed."""
    return gsjs.trim(gsjs.or_blank(hubdb.typed(v, "raw")))


def withheld(v: Any) -> bool:
    """A redaction marker (server/redaction.py MARKERS): what a copy holds in place of a cell, never the cell."""
    return isinstance(v, str) and gsjs.trim(v).startswith("[withheld")


def where_of(rows: list[tuple[int, dict]], at: int, headers: Any) -> tuple[dict[str, str], int]:
    """`where` for rows[at] as the copy holds it — every cell under the column the copy keys it by, a withheld one left
    out — and how many of the rows hold all of them."""
    raw = rows[at][1]
    heads = [h for h in headers if gsjs.trim(gsjs.js_str(h)) and not withheld(raw.get(h))]
    want = {h: _shown(raw.get(h)) for h in heads}
    n = sum(1 for _rn, r in rows if all(_shown(r.get(h)) == v for h, v in want.items()))
    return {gsjs.trim(gsjs.js_str(h)): gsjs.or_blank(raw.get(h)) for h in heads}, n


def withheld_why(values: list[list[Any]], cells: list[tuple[int, int, Any]]) -> str:
    """Why a plan would write a cell a copy withholds — a column the redaction rule holds back on that row, a marker
    there or as the value (asa-hub-sheet-sync's own rule) — or ''."""
    import sheet_sync as SS  # noqa: PLC0415
    if not cells:
        return ""
    if SS.R is None:
        return "server/redaction.py is not mounted; no cell is written without it"
    live = SS.live_tab(values)
    by_row = dict(live.rows)
    for r, c, v in cells:
        key = live.keys[c] if c < len(live.keys) else ""
        if withheld(v) or withheld((by_row.get(r + 1) or {}).get(key)) or key in live.withheld.get(r + 1, set()):
            return f"a withheld cell is never written ({key or f'column {c + 1}'})"
    return ""


def rows_named(values: list[list[Any]], spec: dict) -> dict[str, Any]:
    """The rows an op names on the tab as it stands, its columns keyed as the copy keys them: by `where` (every cell as
    the sheet shows it, a cell the copy withholds not compared) or by its `match` column holding `key` —
    { why } or { keys, rows: [(r, cells)] }, r 0-based."""
    import sheet_sync as SS  # noqa: PLC0415 - the sync's own reading of a tab
    live = SS.live_tab(values)
    keys = list(live.keys)
    where = spec.get("where")
    if where is not None:
        if not isinstance(where, dict) or not where:
            return {"why": "the op names its row by no cell"}
        lacking = [h for h in where if h not in keys]
        if lacking:
            return {"why": "the tab has no column " + ", ".join(lacking[:4])}
        want = {h: _shown(v) for h, v in where.items() if not withheld(v)}
        return {"keys": keys, "rows": [(rn - 1, data) for rn, data in live.rows
                                       if all(_shown(data.get(h)) == v for h, v in want.items())]}
    match, key = gsjs.or_blank(spec.get("match")), gsjs.trim(gsjs.or_blank(spec.get("key")))
    if not match or match not in keys:
        return {"why": f"the tab has no {match or 'key'} column"}
    if not key:
        return {"why": "the op names no key"}
    return {"keys": keys, "rows": [(rn - 1, data) for rn, data in live.rows
                                   if gsjs.trim(gsjs.or_blank(data.get(match))) == key]}


def _lacking(keys: list[str], *named: dict) -> str:
    gone = [h for d in named for h in (d or {}) if h not in keys]
    return "the tab has no column " + ", ".join(gone[:4]) if gone else ""


UNNAMED = "no row of the tab holds these cells; it changed or left since it was read"


def cells_rows_plan(values: list[list[Any]], spec: dict) -> dict[str, Any]:
    """The `cells` op by `where` (the one row whose cells all hold these: none, or more than one, is refused, never
    guessed) or on every row whose `match` column holds `key` (`which`: all) — { why } or
    { row, rows, cells: [(r, c, value)] }."""
    got = rows_named(values, spec)
    if got.get("why"):
        return got
    keys, rows = got["keys"], got["rows"]
    lacking = _lacking(keys, spec.get("cells") or {})
    if lacking:
        return {"why": lacking}
    if spec.get("where") is not None and len(rows) != 1:
        return {"why": f"{len(rows)} rows of the tab hold these cells, so none was written" if rows else UNNAMED}
    if not rows:
        return {"why": f"no row of the tab holds {spec.get('match')} {gsjs.trim(gsjs.or_blank(spec.get('key')))}"}
    cells = [(r, keys.index(f), v) for r, data in rows for f, v in (spec.get("cells") or {}).items()
             if gsjs.or_blank(data.get(f)) != gsjs.or_blank(v)]
    return {"row": rows[0][0], "rows": [r for r, _d in rows], "cells": cells}


def cells_plan_of(values: list[list[Any]], spec: dict) -> dict[str, Any]:
    """The `cells` op's rows: by `where`, or every row its key names (`which`: all), else the one cells_plan names;
    refused whole when it would write a cell a copy withholds."""
    got = cells_rows_plan(values, spec) if spec.get("where") is not None or spec.get("which") == "all" \
        else cells_plan(values, spec)
    why = "" if got.get("why") else withheld_why(values, got["cells"])
    return {"why": why} if why else got


def delete_plan(values: list[list[Any]], spec: dict) -> dict[str, Any]:
    """The `delete` op on the tab as it stands: the one row `which` names (only, first or last) by `match` and `key`,
    or the one `where` names, taken off only while every `expect` cell holds what the copy held —
    { why }, { gone } (no row holds the key any more) or { row }; `keys` in place of `key`: see delete_many_plan."""
    if spec.get("keys") is not None:
        return delete_many_plan(values, spec)
    got = rows_named(values, spec)
    if got.get("why"):
        return got
    keys, rows = got["keys"], got["rows"]
    expect = spec.get("expect") or {}
    lacking = _lacking(keys, expect)
    if lacking:
        return {"why": lacking}
    which = spec.get("which") or "only"
    if which not in ("only", "first", "last"):
        return {"why": f"the op names no row by {which}"}
    if spec.get("where") is not None:
        if len(rows) != 1:
            return {"why": f"{len(rows)} rows of the tab hold these cells, so none was deleted" if rows else UNNAMED}
    elif not rows:
        return {"gone": True}
    elif which == "only" and len(rows) > 1:
        return {"why": f"{len(rows)} rows of the tab hold {spec.get('match')} {spec.get('key')}, so none was deleted"}
    r, data = rows[-1] if which == "last" else rows[0]
    moved = [h for h, v in expect.items() if not withheld(v) and _shown(data.get(h)) != _shown(v)]
    if moved:
        return {"why": "the row changed since it was read (" + ", ".join(moved[:4]) + "), so it was not deleted"}
    return {"row": r}


def delete_many_plan(values: list[list[Any]], spec: dict) -> dict[str, Any]:
    """The `delete` op naming many rows at once: every row whose `match` column holds one of `keys`, each key naming
    at most one row (a key on two rows deletes nothing) — { why }, { gone } (none is left) or { rows } (descending,
    0-based, so each deletion leaves the next one's index as read)."""
    import sheet_sync as SS  # noqa: PLC0415 - the sync's own reading of a tab
    live = SS.live_tab(values)
    match = gsjs.or_blank(spec.get("match"))
    if not match or match not in live.keys:
        return {"why": f"the tab has no {match or 'key'} column"}
    want = {gsjs.trim(gsjs.or_blank(k)) for k in spec.get("keys") or []} - {""}
    if not want:
        return {"why": "the op names no key"}
    found: dict[str, list[int]] = {}
    for rn, data in live.rows:
        k = gsjs.trim(gsjs.or_blank(data.get(match)))
        if k in want:
            found.setdefault(k, []).append(rn - 1)
    twice = sorted(k for k, rs in found.items() if len(rs) > 1)
    if twice:
        return {"why": f"{len(twice)} key(s) name more than one row ({', '.join(twice[:3])}), so none was deleted"}
    if not found:
        return {"gone": True}
    return {"rows": sorted((rs[0] for rs in found.values()), reverse=True)}


def append_plan(values: list[list[Any]], spec: dict, again: bool = False) -> dict[str, Any]:
    """The `append` op on the tab as it stands: the row after the last one and the cells written there — or, asked
    again after a try that wrote them (the last row holds every cell), that row with nothing more to write; a marker
    a copy holds in place of a cell is never written — { why } or { row, new, top, cells: [(c, value)], taken: {c} },
    rows 0-based, `top` the header's."""
    import sheet_sync as SS  # noqa: PLC0415
    live = SS.live_tab(values)
    keys = list(live.keys)
    cells = spec.get("cells") if isinstance(spec.get("cells"), dict) else {}
    lacking = _lacking(keys, cells)
    if lacking:
        return {"why": lacking}
    marked = [f for f, v in cells.items() if withheld(v)]
    if marked:
        return {"why": f"a withheld cell is never written ({', '.join(marked[:4])})"}
    filled = [(keys.index(f), v) for f, v in cells.items() if gsjs.trim(gsjs.or_blank(v))]
    if not filled:
        return {"why": "the op appends no cell"}
    top = live.header_row - 1
    if again and live.rows:
        rn, data = live.rows[-1]
        if all(SS.same(data.get(keys[c]), v) for c, v in filled):
            line = values[rn - 1] if rn - 1 < len(values) else []
            return {"row": rn - 1, "new": False, "top": top, "cells": [],
                    "taken": {c for c, v in enumerate(line) if gsjs.trim(gsjs.or_blank(v))}}
    return {"row": max(len(values), top + 1), "new": True, "top": top, "cells": filled,
            "taken": {c for c, _v in filled}}


def formula_pastes(formulas: list[list[Any]], lo: int, row: int, taken: set[int], sheet_id: Any) -> list[dict]:
    """copyPaste PASTE_FORMULA from the nearest row above `row` holding a formula (`formulas`: rows from `lo` on, as
    the FORMULA rendering answers them) into each of this row's columns that holds no value and no formula yet."""
    def line(r: int) -> list[Any]:
        i = r - lo
        return formulas[i] if 0 <= i < len(formulas) else []

    def formula(v: Any) -> bool:
        return isinstance(v, str) and v.startswith("=")

    mine = line(row)
    for r in range(row - 1, lo - 1, -1):
        src = line(r)
        if not any(formula(v) for v in src):
            continue
        owed = [c for c, v in enumerate(src)
                if formula(v) and c not in taken and not formula(mine[c] if c < len(mine) else "")]
        return [{"copyPaste": {
            "source": {"sheetId": sheet_id, "startRowIndex": r, "endRowIndex": r + 1, "startColumnIndex": c,
                       "endColumnIndex": c + 1},
            "destination": {"sheetId": sheet_id, "startRowIndex": row, "endRowIndex": row + 1, "startColumnIndex": c,
                            "endColumnIndex": c + 1},
            "pasteType": "PASTE_FORMULA"}} for c in owed]
    return []


def _rows_above(spec: dict) -> int:
    try:
        n = int(spec.get("formulas_from_above") or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, min(n, FORMULA_ROWS_MAX))


# ---- `rows`: one tab made, widened, its rows removed, changed or added -------------------------------------------
#
# The spec, every key optional, applied in this order to the tab as it stands (row 1 its header), as Apps Script's
# hubTabEnsure_, ensureHeader_, deleteRow, setValues and appendRow changed it:
#   header  [name, …]        the tab made with this header, first row frozen, when the book lacks it or it holds
#                            nothing at all
#   seed    [{name: text}]   rows written under a header the op just made, and only then
#   grow    [name, …]        each name the header lacks, added after its last cell
#   drop    {column, value, here?, first?}   the rows whose column (normKey_) holds the value removed — away from
#                            headquarters (`here`, a place id) only that place's (a blank tenant cell is headquarters');
#                            `first`: the first such row alone
#   purge   [{column, equals | prefix}, …]  the rows with no `id` whose every named column (its trimmed text; a
#                            column the header lacks reads '') equals the text, or starts with the prefix, removed
#                            (worldDefaultCleanup_); a row whose id is set is never touched
#   update  {key, cells: {name: value}}      the first row whose `id` is key: each named cell set
#   append  [{name: value}]  rows added after the last one, each value under its header (a name it lacks is dropped)
#   unique  name             append unless present: an appended row whose text under this column a row already holds
#                            (or an earlier row of the same append) is left out, so a retry adds nothing twice
#   raw     true | false     true: every value written exactly as given (RAW — a string stays that text, a number or a
#                            boolean that type), as setValues and appendRow kept them; false or absent: entered as typed
#                            (USER_ENTERED), the text a kept edit writes
# Each Python reader lays the ops not yet read back over its copy (rows_lay), so a write is read at once.
ROWS = "rows"
ROWS_SPEC = ("header", "seed", "grow", "drop", "purge", "update", "append", "unique", "raw")


def rows(sheet_id: str, tab: str, raw: bool = True, **spec: Any) -> dict[str, Any]:
    """A `rows` op for queue(): the tab in its book and the spec's keys that are given — written exactly as given
    unless raw=False."""
    unknown = set(spec) - set(ROWS_SPEC)
    if unknown:
        raise ValueError("a rows op takes no " + ", ".join(sorted(unknown)))
    for cond in spec.get("purge") or ():
        if not isinstance(cond, dict) or not gsjs.trim(gsjs.or_blank(cond.get("column"))) or \
                len([k for k in ("equals", "prefix") if isinstance(cond.get(k), str)]) != 1:
            raise ValueError("a purge condition names a column and one equals or prefix text")
    if "purge" in spec and not spec["purge"]:
        raise ValueError("a purge names at least one condition")
    return {"op": ROWS, "sheet_id": sheet_id, "tab": tab,
            "spec": {**{k: v for k, v in spec.items() if v is not None}, "raw": bool(raw)}}


def _text(v: Any) -> str:
    """A cell's text as the sheet shows it, trimmed."""
    return gsjs.trim(gsjs.or_blank(hubdb.typed(v, "raw")))


def rows_column(header: Any, name: str) -> Any:
    """The header cell normKey_ names."""
    want = hubdb.norm_key(gsjs.trim(name))
    return next((h for h in header if hubdb.norm_key(gsjs.trim(gsjs.or_blank(h))) == want), None)


def rows_drops(header: Any, row: dict, drop: dict) -> bool:
    """Whether a row (cells by header) is one the drop removes."""
    col = rows_column(header, drop["column"])
    if col is None or _text(row.get(col)) != gsjs.trim(gsjs.or_blank(drop["value"])):
        return False
    here = gsjs.or_blank(drop.get("here"))
    tcol = rows_column(header, "tenant")
    return not here or (_text(row.get(tcol)) if tcol is not None else "") == here


def rows_purges(header: Any, row: dict, purge: Any) -> bool:
    """Whether a row (cells by header) is one the purge removes: no id, and every condition holding."""
    named = {gsjs.trim(gsjs.or_blank(h)): h for h in reversed(list(header))}
    if "id" in named and _text(row.get(named["id"])):
        return False
    if not purge:
        return False
    for cond in purge:
        col = named.get(gsjs.trim(gsjs.or_blank(cond.get("column"))))
        got = _text(row.get(col)) if col is not None else ""
        if isinstance(cond.get("equals"), str):
            if got != cond["equals"]:
                return False
        elif not (isinstance(cond.get("prefix"), str) and got.startswith(cond["prefix"])):
            return False
    return True


def rows_lay(exists: bool, header: list, rows_: list[dict], spec: dict) -> tuple[bool, list, list[dict]]:
    """A reader's twin of rows_apply: (exists, header, rows by header) as the op leaves the tab."""
    header, rows_ = list(header), [dict(r) for r in rows_]
    born = spec.get("header") is not None and (not exists or (not any(_text(h) for h in header)
                                                              and not any(any(_text(v) for v in r.values())
                                                                          for r in rows_)))
    if born:
        exists, header, rows_ = True, list(spec["header"]), []
    if not exists:
        return exists, header, rows_
    for k in spec.get("grow") or ():
        if k not in header:
            header.append(k)
    if born:
        rows_.extend(dict(r) for r in spec.get("seed") or ())
    drop = spec.get("drop")
    if drop:
        hits = [i for i, r in enumerate(rows_) if rows_drops(header, r, drop)]
        gone = set(hits[:1] if drop.get("first") else hits)
        rows_ = [r for i, r in enumerate(rows_) if i not in gone]
    if spec.get("purge"):
        rows_ = [r for r in rows_ if not rows_purges(header, r, spec["purge"])]
    up = spec.get("update")
    if up and "id" in header:
        hit = next((r for r in rows_ if _text(r.get("id")) == up["key"]), None)
        if hit is not None:
            hit.update(up["cells"])
    unique = spec.get("unique")
    for rec in spec.get("append") or ():
        if unique and any(_text(r.get(unique)) == _text(rec.get(unique)) for r in rows_):
            continue
        rows_.append(dict(rec))
    return exists, header, rows_


def _given(v: Any) -> Any:
    return "" if v is None else v


def rows_plan(values: list[list[Any]], spec: dict, made: bool) -> dict[str, Any]:
    """What the op does to the tab as it stands: { head (the whole header when it changes, else None), was (its width
    before), deletes (indexes after the header), cells [(row, col, value)], lines (rows to add, values as given),
    start (the rows kept, header counted), born, missed }."""
    text = [[gsjs.or_blank(c) for c in r] for r in values]
    empty = not any(gsjs.trim(c) for r in text for c in r)
    born = spec.get("header") is not None and (made or empty)
    head = list(spec["header"]) if born else (list(text[0]) if text else [])
    was = [] if born else list(head)
    for k in spec.get("grow") or ():
        if k not in head:
            head.append(k)
    body = [] if born else [list(r) for r in text[1:]]
    gone: set[int] = set()
    drop = spec.get("drop")
    if drop:
        hits = [i + 1 for i, r in enumerate(body) if rows_drops(head, dict(zip(head, r)), drop)]
        gone.update(hits[:1] if drop.get("first") else hits)
    if spec.get("purge"):
        gone.update(i + 1 for i, r in enumerate(body) if rows_purges(head, dict(zip(head, r)), spec["purge"]))
    deletes = sorted(gone)
    kept = [r for i, r in enumerate(body) if i + 1 not in gone]
    cells: list[tuple[int, int, Any]] = []
    missed = ""
    up = spec.get("update")
    if up:
        at = head.index("id") if "id" in head else -1
        hit = next((i for i, r in enumerate(kept) if 0 <= at < len(r) and gsjs.trim(r[at]) == up["key"]), None)
        if hit is None:
            missed = f'no row holds id {up["key"]}'
        else:
            line = kept[hit] + [""] * len(head)
            for f, v in up["cells"].items():
                if f in head and gsjs.or_blank(line[head.index(f)]) != gsjs.or_blank(v):
                    cells.append((hit + 1, head.index(f), _given(v)))
    lines = [[_given(r.get(h)) for h in head] for r in (spec.get("seed") or () if born else ())]
    unique = spec.get("unique")
    seen: set[str] = set()
    if unique and unique in head:
        u = head.index(unique)
        seen = {gsjs.trim(r[u]) for r in kept if u < len(r)}
    for rec in spec.get("append") or ():
        key = gsjs.trim(gsjs.or_blank(rec.get(unique))) if unique else ""
        if unique and key in seen:
            continue
        seen.add(key)
        lines.append([_given(rec.get(h)) for h in head])
    while kept and not any(gsjs.trim(c) for c in kept[-1]):
        kept.pop()
    return {"head": head if head != was else None, "was": len(was), "deletes": deletes, "cells": cells,
            "lines": lines, "start": 1 + len(kept), "born": born, "missed": missed}


def _cell_data(v: Any) -> dict[str, Any]:
    """A value exactly as given: text stays text, a number or a boolean its type, nothing a cleared cell."""
    if v is None or v == "":
        return {}
    if isinstance(v, bool):
        return {"userEnteredValue": {"boolValue": v}}
    if isinstance(v, (int, float)):
        return {"userEnteredValue": {"numberValue": v}}
    return {"userEnteredValue": {"stringValue": gsjs.js_str(v)}}


def _put(grid_id: int, row: int, col: int, lines: list[list[Any]]) -> dict[str, Any]:
    return {"updateCells": {"start": {"sheetId": grid_id, "rowIndex": row, "columnIndex": col},
                            "rows": [{"values": [_cell_data(v) for v in line]} for line in lines],
                            "fields": "userEnteredValue"}}


def rows_apply(sheets: Any, op: dict, quote: Any, col_letter: Any, entered: Any) -> tuple[str, str]:
    """One tab changed: ('done' | 'refused', why). Raw, in one batchUpdate — made, its rows removed, its grid grown
    (rows and columns) before anything is written past it, then every value — all or nothing; else the same changes,
    then the values entered as typed in a second request. A Google error is raised for the sync to retry; a retry
    finds the rows it removed gone and the rows it added by their unique text."""
    import secrets  # noqa: PLC0415 - a new tab's id
    sid, tab, spec = op["sheet_id"], op["tab"], op["spec"]
    raw = bool(spec.get("raw"))
    props = sheets.sheet_props(sid)
    made = tab not in props
    requests: list[dict] = []
    if made:
        if spec.get("header") is None:
            return "refused", f"the book has no {tab} tab"
        got = rows_plan([], spec, True)
        taken = {int(p.get("id") or 0) for p in props.values()}
        new = next(n for n in iter(lambda: secrets.randbelow(2 ** 31 - 2) + 1, 0) if n not in taken)
        # insertSheet's own grid, grown to what the op writes
        grid = {"id": new, "rows": max(1000, got["start"] + len(got["lines"])),
                "cols": max(26, len(got["head"] or []))}
        requests.append({"addSheet": {"properties": {"sheetId": new, "title": tab, "gridProperties": {
            "rowCount": grid["rows"], "columnCount": grid["cols"], "frozenRowCount": 1}}}})
    else:
        got = rows_plan(sheets.batch_get(sid, [quote(tab)])[0], spec, False)
        grid = props[tab]
    requests += [{"deleteDimension": {"range": {"sheetId": grid["id"], "dimension": "ROWS", "startIndex": i,
                                                "endIndex": i + 1}}} for i in sorted(got["deletes"], reverse=True)]
    need_rows = got["start"] + len(got["lines"]) - (int(grid.get("rows") or 0) - len(got["deletes"]))
    if need_rows > 0:
        requests.append({"appendDimension": {"sheetId": grid["id"], "dimension": "ROWS", "length": need_rows}})
    width = max([len(got["head"] or [])] + [len(line) for line in got["lines"]] + [c + 1 for _r, c, _v in got["cells"]])
    need_cols = width - int(grid.get("cols") or 0) if "cols" in grid else 0
    if need_cols > 0:
        requests.append({"appendDimension": {"sheetId": grid["id"], "dimension": "COLUMNS", "length": need_cols}})
    data: list[dict] = []
    if raw:
        if got["head"] is not None:
            requests.append(_put(grid["id"], 0, got["was"], [got["head"][got["was"]:]]))
        requests += [_put(grid["id"], r, c, [[v]]) for r, c, v in got["cells"]]
        if got["lines"]:
            requests.append(_put(grid["id"], got["start"], 0, got["lines"]))
    else:
        if got["head"] is not None:
            data.append({"range": f"{quote(tab)}!A1", "values": [[entered(h) for h in got["head"]]]})
        for r, c, v in got["cells"]:
            data.append({"range": f"{quote(tab)}!{col_letter(c + 1)}{r + 1}",
                         "values": [[entered(gsjs.or_blank(v))]]})
        if got["lines"]:
            data.append({"range": f"{quote(tab)}!A{got['start'] + 1}",
                         "values": [[entered(gsjs.or_blank(v)) for v in line] for line in got["lines"]]})
    if requests:
        sheets.structure(sid, requests)
    if data:
        sheets.batch_update(sid, data)
    if got["missed"] and not (got["deletes"] or got["lines"] or got["cells"] or got["head"]):
        return "refused", got["missed"]
    said = (f"{'made, ' if got['born'] else ''}{len(got['deletes'])} row(s) removed, {len(got['lines'])} added,"
            f" {len(got['cells'])} cell(s) changed")
    return "done", said + (f"; {got['missed']}" if got["missed"] else "")


def apply(sheets: Any, op: dict, quote: Any, col_letter: Any, entered: Any, conn: Any = None,
          ro: Any = None) -> tuple[str, str]:
    """One op carried: ('done' | 'refused', why). A Google error is raised for the sync to retry."""
    sid, tab, spec = op["sheet_id"], op["tab"], op["spec"]
    if op["op"] in OWN_RECORD_OPS:
        import calendar_carry as CC  # noqa: PLC0415 - the records' own copies, read where the op is carried
        return CC.apply(sheets, op, quote, conn, ro)
    if op["op"] == "mirror":
        import lane_mirror as LM  # noqa: PLC0415 - the mirror's own rewrite, read where the op is carried
        return LM.apply(sheets, op, quote, entered)
    if op["op"] == "rows":
        return rows_apply(sheets, op, quote, col_letter, entered)
    if op["op"] == "cells":
        if tab not in sheets.titles(sid):
            return "refused", f"the book has no {tab} tab"
        got = cells_plan_of(sheets.batch_get(sid, [quote(tab)])[0], spec)
        if got.get("why"):
            return "refused", got["why"]
        if not got["cells"]:
            return "done", "the row already holds these cells"
        sheets.batch_update(sid, [{"range": f"{quote(tab)}!{col_letter(c + 1)}{r + 1}", "values": [[entered(v)]]}
                                  for r, c, v in got["cells"]])
        rows = len({r for r, _c, _v in got["cells"]})
        return "done", f"{len(got['cells'])} cell(s) " + (f"on row {got['cells'][0][0] + 1}" if rows == 1
                                                          else f"on {rows} rows")
    if op["op"] == "delete":
        props = sheets.sheet_props(sid)
        if tab not in props:
            return "refused", f"the book has no {tab} tab"
        got = delete_plan(sheets.batch_get(sid, [quote(tab)])[0], spec)
        if got.get("why"):
            return "refused", got["why"]
        if got.get("gone"):
            return "done", "no row of the tab holds it any more"
        rows = got["rows"] if "rows" in got else [got["row"]]
        sheets.structure(sid, [{"deleteDimension": {"range": {"sheetId": props[tab]["id"], "dimension": "ROWS",
                                                              "startIndex": r, "endIndex": r + 1}}} for r in rows])
        return "done", f"row {rows[0] + 1} deleted" if len(rows) == 1 else f"{len(rows)} rows deleted"
    if op["op"] == "append":
        props = sheets.sheet_props(sid)
        if tab not in props:
            return "refused", f"the book has no {tab} tab"
        got = append_plan(sheets.batch_get(sid, [quote(tab)])[0], spec, again=int(op.get("tries") or 1) > 1)
        if got.get("why"):
            return "refused", got["why"]
        r, above = got["row"], _rows_above(spec)
        lo = max(got["top"] + 1, r - above)
        # the rows above read as formulas before anything is written: the whole change is decided first
        formulas = sheets.batch_get(sid, [f"{quote(tab)}!{lo + 1}:{r + 1}"], render="FORMULA")[0] \
            if above and lo < r else []
        if got["new"]:
            if r >= int(props[tab].get("rows") or 0):
                sheets.structure(sid, [{"appendDimension": {"sheetId": props[tab]["id"], "dimension": "ROWS",
                                                            "length": r + 1 - int(props[tab].get("rows") or 0)}}])
            # USER_ENTERED, as every cell the sync writes; asked again, the row these cells landed on is found (above)
            sheets.batch_update(sid, [{"range": f"{quote(tab)}!{col_letter(c + 1)}{r + 1}", "values": [[entered(v)]]}
                                      for c, v in got["cells"]])
        pastes = formula_pastes(formulas, lo, r, got["taken"], props[tab]["id"])
        if pastes:
            sheets.structure(sid, pastes)
        return "done", (f"row {r + 1} appended" if got["new"] else f"row {r + 1} was appended before") + \
            (f", {len(pastes)} formula(s) carried from above" if pastes else "")
    if op["op"] == "rename":
        titles = sheets.titles(sid)
        if tab not in titles:
            return "refused", f"the book has no {tab} tab"
        values = sheets.batch_get(sid, [quote(tab)])[0]
        cells, rows, why = rename_cells(values, spec)
        if why:
            return "refused", why
        if not cells:
            return "done", "nothing left to rename"
        sheets.batch_update(sid, [{"range": f"{quote(tab)}!{col_letter(c + 1)}{r + 1}",
                                   "values": [[entered(after)]]} for r, c, _before, after in cells])
        return "done", f"{len(cells)} cell(s) in {rows} row(s)"
    frm, to = tab, spec["to"]
    props = sheets.sheet_props(sid)
    if frm not in props or to not in props:
        return "refused", f"the book has no {frm if frm not in props else to} tab"
    sv, dv = sheets.batch_get(sid, [quote(frm), quote(to)])
    got = move_plan(sv, dv, spec["name"], frm, to)
    if got.get("why"):
        return "refused", got["why"]
    if got.get("absent") or got.get("done"):
        return "done", "the row was already where it belongs" if got.get("done") else "neither tab holds the row"
    sheets.structure(sid, move_requests(props[frm], props[to], got["at"], len(dv), got["cols"]))
    return "done", f"moved from {frm} to {to}"


def run(conn: Any, sheets: Any, quote: Any, col_letter: Any, entered: Any, refused: type[Exception],
        google_error: type[Exception], dry: bool = False, done_ops: list | None = None, ro: Any = None) -> int:
    """Every open op carried, oldest first; a quota refusal hands the rest back and is raised. Each op carried is added
    to `done_ops` when given; `ro` opens the read connection an op may ask the catalog on."""
    if dry:
        return 0
    done = 0
    for op in claim(conn):
        try:
            state, why = apply(sheets, op, quote, col_letter, entered, conn=conn, ro=ro)
        except refused:
            settle(conn, op["id"], "pending", "Google refused for quota; asked again next cycle")
            conn.execute(f"update {table()} set state = 'pending' where state = 'applying' and id > %s", (op["id"],))
            raise
        except Exception as e:  # noqa: BLE001 - Google's error or the op's own: asked again, then left failed
            said = f"{e} {getattr(e, 'said', '')[:200]}".strip() if isinstance(e, google_error) else type(e).__name__
            state, why = ("failed", said) if op["tries"] >= TRIES else ("pending", said)
            log.warning("book op %s (%s) not carried: %s", op["id"], op["op"], said[:160].replace("\n", " "))
        settle(conn, op["id"], state, why)
        done += state == "done"
        if state == "done":
            log.info("book op %s (%s on %s…): %s", op["id"], op["op"], op["sheet_id"][:8], why)
            if done_ops is not None:
                done_ops.append(op)
    return done


def wait(conn: Any, seconds: float) -> bool:
    """Up to `seconds` for an op queued meanwhile (NOTIFY on CHANNEL): True when one was."""
    end = time.monotonic() + seconds
    try:
        for _n in conn.notifies(timeout=max(0.0, end - time.monotonic()), stop_after=1):
            return True
    except Exception:  # noqa: BLE001 - a dropped listener only waits the cycle out
        time.sleep(max(0.0, end - time.monotonic()))
    return False
