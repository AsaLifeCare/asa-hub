"""The Calendar Builder's master grid as its own record in asa-hub-db (db/cal_builder_master.sql): the master book's
New Calendar tab cell by cell (A..AE, rows 1..500) and its New Calendar Table row by row, seeded once from what
asa-hub-db held of them (the keeper's grid, app.sheet_grids kind master; the copy's Table tab). Every Builder door and
slice reads and writes these alone. The sheet is the record's copy both ways, by recency, in Python: what the record
changed is queued for asa-hub-sheet-sync (app.book_ops grid_cells and table_rows, carried by app/calendar_carry.py);
what the sheet changed comes in when the keeper's grid moves, or once a day (fold) — each cell weighed against the
value both sides last agreed on: the side that changed it wins, the newer side when both did, logged in
app.edit_conflicts."""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

import lanes_db as hub_db
import lanes_pg as psycopg2

log = logging.getLogger("hub.calendarbuilder.record")

MASTER_SHEET_ID = "1_S62kl6hh0XG_3OK25X-AZYuYo3Apfm5oCAvvmdodfU"
GRID_TAB = "New Calendar"
TABLE_TAB = "New Calendar Table"
COLS = 31
ROWS = 500
# house, designation and name: the cells that say whom a row is
NAME_COLS = 3

CELLS = "cal_builder_master"
TABLE = "cal_builder_table"
STATE = "cal_builder_master_state"
GRIDS = "sheet_grids"
OPS = "book_ops"
CONFLICTS = "edit_conflicts"
# the carrier's schema: asa-hub-sheet-sync names the tables whole
SCHEMA = "app"
OPS_CHANNEL = "hub_book_ops"
SUBJECT = "calendar-builder"
GRID_OP = "grid_cells"
TABLE_OP = "table_rows"
# one seed and one fold at a time
LOCK = (8216, 1)
FOLD_EVERY_S = float(os.getenv("HUB_CAL_MASTER_FOLD_EVERY_S") or 86400)


class NotSeeded(RuntimeError):
    """asa-hub-db holds no master grid to seed the record from."""


def qualified(table: str) -> str:
    return f"{SCHEMA}.{table}"


def col_letter(col: int) -> str:
    out, n = "", col + 1
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def _same(a: Any, b: Any) -> bool:
    return str(a if a is not None else "").strip() == str(b if b is not None else "").strip()


def _dict_cur(conn: Any) -> Any:
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)


def _shown(cells: Any) -> list[list[str]]:
    held = cells if isinstance(cells, dict) else json.loads(cells or "{}")
    return [[str(v) for v in line][:COLS] for line in (held.get("shown") or [])[:ROWS]]


def _state(cur: Any) -> dict[str, Any]:
    cur.execute(f"SELECT * FROM {STATE} WHERE id = 1")  # noqa: S608 - the record's own table
    return dict(cur.fetchone() or {})


def _kept(cur: Any) -> dict[str, Any] | None:
    """The keeper's grid: the seed's source and the fold's input, never a door's."""
    cur.execute(f"SELECT cells, modified_time, read_at FROM {GRIDS} "  # noqa: S608
                "WHERE sheet_id = %s AND kind = 'master'", (MASTER_SHEET_ID,))
    got = cur.fetchone()
    return dict(got) if got else None


# ---- the seed, once ------------------------------------------------------------------------------------------------

def _seed_grid(cur: Any) -> int:
    kept = _kept(cur)
    if kept is None:
        raise NotSeeded("the master grid is not kept in asa-hub-db yet, so its record cannot be seeded")
    at = kept["modified_time"] or kept["read_at"]
    rows = [(r + 1, c, v, at, "seed", v, kept["read_at"])
            for r, line in enumerate(_shown(kept["cells"])) for c, v in enumerate(line) if str(v).strip()]
    cur.executemany(f"INSERT INTO {CELLS} (sheet_row, col, text, updated_at, updated_by, synced, synced_at) "  # noqa: S608
                    "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (sheet_row, col) DO NOTHING", rows)
    cur.execute(f"INSERT INTO {STATE} (id, seeded_at, seeded_from, folded_at, folded_read_at, folded_modified) "  # noqa: S608
                "VALUES (1, now(), %s, now(), %s, %s) ON CONFLICT (id) DO UPDATE SET seeded_at = now(), "
                "seeded_from = EXCLUDED.seeded_from, folded_at = now(), folded_read_at = EXCLUDED.folded_read_at, "
                "folded_modified = EXCLUDED.folded_modified", (at, kept["read_at"], kept["modified_time"]))
    return len(rows)


def _copy_table() -> tuple[list[dict[str, Any]], Any]:
    """The copy's Table tab in sheet order, and when the copy loaded it."""
    import lanes_sheets  # noqa: PLC0415 - asa-hub-db's copy, read for the seed and the fold alone
    ref = lanes_sheets._db().tab(MASTER_SHEET_ID, TABLE_TAB)  # noqa: SLF001
    if ref is None:
        return [], None
    return [{str(k): ("" if v is None else str(v)) for k, v in d.items()}
            for _rn, d in lanes_sheets.rows(MASTER_SHEET_ID, TABLE_TAB)], getattr(ref, "loaded_at", None)


def _seed_table(cur: Any) -> int:
    rows, loaded = _copy_table()
    cur.executemany(f"INSERT INTO {TABLE} (cells, source, synced) VALUES (%s::jsonb, 'seed', true)",  # noqa: S608
                    [(json.dumps(r),) for r in rows])
    cur.execute(f"INSERT INTO {STATE} (id, table_seeded_at, table_folded_loaded) VALUES (1, now(), %s) "  # noqa: S608
                "ON CONFLICT (id) DO UPDATE SET table_seeded_at = now(), "
                "table_folded_loaded = EXCLUDED.table_folded_loaded", (loaded,))
    return len(rows)


def ensure(dsn: str) -> None:
    """The record seeded, once: what asa-hub-db held of the grid and the Table becomes the record."""
    with hub_db.connect(dsn) as conn, _dict_cur(conn) as cur:
        st = _state(cur)
    if st.get("seeded_at") and st.get("table_seeded_at"):
        return
    with hub_db.connect(dsn) as conn, _dict_cur(conn) as cur:
        cur.execute("SELECT pg_advisory_xact_lock(%s, %s)", LOCK)
        st = _state(cur)
        grid = table = 0
        if not st.get("seeded_at"):
            grid = _seed_grid(cur)
        if not st.get("table_seeded_at"):
            table = _seed_table(cur)
        conn.commit()
    if grid or table:
        log.info("calendar-builder: the master record seeded — %d cell(s), %d Table row(s)", grid, table)


# ---- the doors' reads ----------------------------------------------------------------------------------------------

def now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def matrix(dsn: str) -> tuple[list[list[str]], str]:
    """New Calendar as the record holds it, A..AE by row; the record is current by being the record."""
    ensure(dsn)
    with hub_db.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"SELECT sheet_row, col, text FROM {CELLS} WHERE text <> ''")  # noqa: S608
        got = cur.fetchall()
    height = max((int(r) for r, _c, _t in got), default=0)
    out = [[""] * COLS for _ in range(height)]
    for r, c, t in got:
        out[int(r) - 1][int(c)] = str(t)
    return out, now_stamp()


def table_rows(dsn: str) -> list[dict[str, Any]]:
    """New Calendar Table as the record holds it, each row {header: text}, in the order it was kept."""
    ensure(dsn)
    with hub_db.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"SELECT cells FROM {TABLE} ORDER BY id")  # noqa: S608
        got = cur.fetchall()
    return [c if isinstance(c, dict) else json.loads(c or "{}") for (c,) in got]


# ---- the doors' writes, in the caller's transaction ----------------------------------------------------------------

def _queue(cur: Any, op: str, tab: str, spec: dict[str, Any], author: str, action: str) -> None:
    cur.execute(f"INSERT INTO {OPS} (write_id, action, subject, sheet_id, tab_name, op, spec, author) "  # noqa: S608
                "VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)",
                ("W" + uuid.uuid4().hex[:24], action, SUBJECT, MASTER_SHEET_ID, tab, op, json.dumps(spec),
                 str(author or "")[:200]))
    cur.execute(f"NOTIFY {OPS_CHANNEL}")


def put_cells(cur: Any, cells: Iterable[tuple[int, int, str]], actor: str, action: str) -> int:
    """Cells written into the record and queued for the sheet."""
    todo = [(int(r), int(c), str(v)) for r, c, v in cells]
    if not todo:
        return 0
    cur.executemany(f"INSERT INTO {CELLS} (sheet_row, col, text, updated_at, updated_by) "  # noqa: S608
                    "VALUES (%s, %s, %s, now(), %s) ON CONFLICT (sheet_row, col) DO UPDATE "
                    "SET text = EXCLUDED.text, updated_at = now(), updated_by = EXCLUDED.updated_by",
                    [(r, c, v, str(actor or "")[:200]) for r, c, v in todo])
    _queue(cur, GRID_OP, GRID_TAB, {"cells": [[r, c] for r, c, _v in todo]}, actor, action)
    return len(todo)


def append_table(cur: Any, rows: list[dict[str, str]], actor: str, action: str,
                 publish_id: int | None = None) -> int:
    """Table rows kept in the record and queued to be appended to the sheet's."""
    if not rows:
        return 0
    ids = []
    for r in rows:
        cur.execute(f"INSERT INTO {TABLE} (cells, source, publish_id, synced) "  # noqa: S608
                    "VALUES (%s::jsonb, 'publish', %s, false) RETURNING id", (json.dumps(r), publish_id))
        ids.append(int(cur.fetchone()[0]))
    _queue(cur, TABLE_OP, TABLE_TAB, {"ids": ids}, actor, action)
    return len(ids)


# ---- the sheet's side: the keeper's grid folded in -----------------------------------------------------------------

def _conflict(cur: Any, tab: str, key: str, field: str, base: str, pg: str, sheet: str, winner: str, why: str,
              pg_at: Any, sheet_at: Any) -> None:
    cur.execute(f"INSERT INTO {CONFLICTS} (sheet_id, tab_name, match_by, keyed_by, row_key, field, edit_id, "  # noqa: S608
                "base_value, pg_value, sheet_value, winner, why, edit_at, sheet_seen_at) "
                "VALUES (%s, %s, 'cell', 'position', %s, %s, 0, %s, %s, %s, %s, %s, %s, %s)",
                (MASTER_SHEET_ID, tab, key, field, base, pg, sheet, winner, why, pg_at, sheet_at))


def _open_cells(cur: Any) -> set[tuple[int, int]]:
    cur.execute(f"SELECT spec FROM {OPS} WHERE op = %s AND sheet_id = %s "  # noqa: S608
                "AND state IN ('pending', 'applying')", (GRID_OP, MASTER_SHEET_ID))
    out: set[tuple[int, int]] = set()
    for (spec,) in cur.fetchall():
        held = spec if isinstance(spec, dict) else json.loads(spec or "{}")
        out.update((int(r), int(c)) for r, c in held.get("cells") or [])
    return out


def _fold_grid(cur: Any, st: dict[str, Any], kept: dict[str, Any]) -> dict[str, int]:
    sheet_at = kept["modified_time"] or kept["read_at"]
    seeded = st.get("seeded_at") or sheet_at
    km = _shown(kept["cells"])
    cur.execute(f"SELECT sheet_row, col, text, synced, updated_at FROM {CELLS}")  # noqa: S608
    rec = {(int(r), int(c)): (str(t), str(s), u) for r, c, t, s, u in cur.fetchall()}

    def sheet(r: int, c: int) -> str:
        line = km[r - 1] if r - 1 < len(km) else []
        return line[c] if c < len(line) else ""

    keys = set(rec) | {(r + 1, c) for r, line in enumerate(km) for c, v in enumerate(line) if str(v).strip()}
    # a row the sheet now names someone else by: every cell of it is the sheet's
    renamed = {r for r in {r for r, _c in keys}
               if any(not _same(sheet(r, c), rec.get((r, c), ("", "", None))[1]) for c in range(NAME_COLS))}
    copied: list[tuple[int, int, str]] = []
    agreed: list[tuple[int, int, str]] = []
    rebased: list[tuple[int, int, str]] = []
    owed: set[tuple[int, int]] = set()
    conflicts = 0
    for r, c in sorted(keys):
        k = sheet(r, c)
        t, s, u = rec.get((r, c), ("", "", seeded))
        if r in renamed:
            if not (_same(t, k) and _same(s, k)):
                copied.append((r, c, k))
                if not _same(t, s) and not _same(t, k):
                    _conflict(cur, GRID_TAB, f"r{r}", col_letter(c), s, t, k, "sheet",
                              "the row now names someone else on the sheet; the sheet's row is the record's", u,
                              sheet_at)
                    conflicts += 1
            continue
        if _same(k, s):
            if not _same(t, s):
                owed.add((r, c))
            continue
        if _same(t, k):
            agreed.append((r, c, k))
            continue
        if _same(t, s):
            copied.append((r, c, k))
            continue
        newer_sheet = sheet_at is not None and (u is None or sheet_at > u)
        _conflict(cur, GRID_TAB, f"r{r}", col_letter(c), s, t, k, "sheet" if newer_sheet else "postgres",
                  "both changed it; the newer side is kept", u, sheet_at)
        conflicts += 1
        if newer_sheet:
            copied.append((r, c, k))
        else:
            rebased.append((r, c, k))
            owed.add((r, c))
    if copied:
        cur.executemany(f"INSERT INTO {CELLS} (sheet_row, col, text, updated_at, updated_by, synced, synced_at) "  # noqa: S608
                        "VALUES (%s, %s, %s, %s, 'sheet', %s, now()) ON CONFLICT (sheet_row, col) DO UPDATE "
                        "SET text = EXCLUDED.text, updated_at = EXCLUDED.updated_at, updated_by = 'sheet', "
                        "synced = EXCLUDED.synced, synced_at = now()",
                        [(r, c, k, sheet_at, k) for r, c, k in copied])
    if agreed or rebased:
        cur.executemany(f"INSERT INTO {CELLS} (sheet_row, col, text, synced, synced_at) "  # noqa: S608
                        "VALUES (%s, %s, '', %s, now()) ON CONFLICT (sheet_row, col) DO UPDATE "
                        "SET synced = EXCLUDED.synced, synced_at = now()",
                        [(r, c, k) for r, c, k in agreed + rebased])
    queue = sorted(owed - _open_cells(cur))
    if queue:
        _queue(cur, GRID_OP, GRID_TAB, {"cells": [[r, c] for r, c in queue]}, "the master record's sync", "fold")
    return {"copied": len(copied), "agreed": len(agreed), "conflicts": conflicts, "queued": len(queue)}


def _fold_table(cur: Any, st: dict[str, Any]) -> dict[str, int] | None:
    """The copy's Table tab once it was loaded again: rows the sheet added come in, rows it took off a row both held
    go; a row the record still owes the sheet stays."""
    rows, loaded = _copy_table()
    if loaded is None or (st.get("table_folded_loaded") and loaded <= st["table_folded_loaded"]):
        return None
    left: dict[str, int] = {}
    for r in rows:
        k = json.dumps(r, sort_keys=True)
        left[k] = left.get(k, 0) + 1
    cur.execute(f"SELECT id, cells, synced FROM {TABLE} ORDER BY id")  # noqa: S608
    gone, landed = [], []
    for rid, cells, synced in cur.fetchall():
        k = json.dumps(cells if isinstance(cells, dict) else json.loads(cells or "{}"), sort_keys=True)
        if left.get(k):
            left[k] -= 1
            if not synced:
                landed.append(int(rid))
        elif synced:
            gone.append(int(rid))
    fresh = []
    for r in rows:
        k = json.dumps(r, sort_keys=True)
        if left.get(k):
            left[k] -= 1
            fresh.append(r)
    if gone:
        cur.execute(f"DELETE FROM {TABLE} WHERE id = ANY(%s)", (gone,))  # noqa: S608
    if landed:
        cur.execute(f"UPDATE {TABLE} SET synced = true WHERE id = ANY(%s)", (landed,))  # noqa: S608
    cur.executemany(f"INSERT INTO {TABLE} (cells, source, synced) VALUES (%s::jsonb, 'sheet', true)",  # noqa: S608
                    [(json.dumps(r),) for r in fresh])
    cur.execute(f"UPDATE {STATE} SET table_folded_loaded = %s WHERE id = 1", (loaded,))  # noqa: S608
    return {"added": len(fresh), "removed": len(gone), "landed": len(landed)}


def fold(dsn: str, *, force: bool = False) -> dict[str, Any]:
    """The sheet's side: the keeper's grid (once it moved, or `force`) and the copy's Table folded into the record."""
    ensure(dsn)
    with hub_db.connect(dsn) as conn, _dict_cur(conn) as cur:
        cur.execute("SELECT pg_advisory_xact_lock(%s, %s)", LOCK)
        st = _state(cur)
        kept = _kept(cur)
        out: dict[str, Any] = {"grid": None, "table": None}
        if kept is not None and (force or not st.get("folded_read_at") or kept["read_at"] > st["folded_read_at"]):
            with conn.cursor() as plain:
                out["grid"] = _fold_grid(plain, st, kept)
            cur.execute(f"UPDATE {STATE} SET folded_at = now(), folded_read_at = %s, folded_modified = %s "  # noqa: S608
                        "WHERE id = 1", (kept["read_at"], kept["modified_time"]))
        with conn.cursor() as plain:
            out["table"] = _fold_table(plain, st)
        conn.commit()
    grid, table = out["grid"] or {}, out["table"] or {}
    out["changed"] = bool(grid.get("copied") or grid.get("conflicts") or table.get("added") or table.get("removed"))
    if out["grid"] is not None or out["table"] is not None:
        log.info("calendar-builder: the master record's sync — grid %s, table %s", out["grid"], out["table"])
    return out


def fold_due(dsn: str) -> bool:
    with hub_db.connect(dsn) as conn, _dict_cur(conn) as cur:
        st = _state(cur)
    at = st.get("folded_at")
    return at is None or (datetime.now(timezone.utc) - at).total_seconds() >= FOLD_EVERY_S
