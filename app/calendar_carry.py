"""asa-hub-sheet-sync's side of the Calendar Builder's records (app.book_ops, carried by book_ops.apply): the sheets
are their copies, written in Python as the records say.

- grid_cells: master cells by place (app.cal_builder_master), each written only while the sheet's row still names the
  person the record's row names, and only over the value both sides last agreed on; a cell the sheet changed too is
  left for the record's sync to weigh (cal_builder_master.fold).
- table_rows: the record's New Calendar Table rows appended after the tab's last row, exactly as kept.
- house_cells: a house tab's cells by name and day (asa_house_calendar_edits the record), each written over the value
  it was published against; one the sheet changed since is written only when the publish is newer than the book's
  last change, else left to the sheet; both logged in app.edit_conflicts. New names get their rows."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Callable

import cal_builder_master as M

log = logging.getLogger("asa-hub-calendar-carry")

OPS = ("grid_cells", "table_rows", "house_cells")


def _cell_data(v: Any) -> dict[str, Any]:
    return {"userEnteredValue": {"stringValue": str(v)}} if str(v or "") else {}


def _put(grid_id: int, row: int, col: int, lines: list[list[Any]]) -> dict[str, Any]:
    """Values written exactly as kept (RAW), from (row, col), 0-based."""
    return {"updateCells": {"start": {"sheetId": grid_id, "rowIndex": row, "columnIndex": col},
                            "rows": [{"values": [_cell_data(v) for v in line]} for line in lines],
                            "fields": "userEnteredValue"}}


def _text(matrix: list[list[Any]], r: int, c: int) -> str:
    line = matrix[r] if 0 <= r < len(matrix) else []
    return str(line[c] if c < len(line) and line[c] is not None else "").strip()


def _epoch(v: Any) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, datetime):
        return v.timestamp()
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def apply(sheets: Any, op: dict[str, Any], quote: Callable[[str], str], conn: Any,
          ro: Callable[[], Any] | None = None) -> tuple[str, str]:
    if op["op"] == "grid_cells":
        return grid_cells(sheets, op, quote, conn)
    if op["op"] == "table_rows":
        return table_rows(sheets, op, quote, conn, again=int(op.get("tries") or 1) > 1)
    return house_cells(sheets, op, quote, conn, ro)


def grid_cells(sheets: Any, op: dict[str, Any], quote: Callable[[str], str], conn: Any) -> tuple[str, str]:
    sid, tab = op["sheet_id"], op["tab"]
    want = sorted({(int(r), int(c)) for r, c in (op["spec"].get("cells") or [])})
    if not want:
        return "done", "no cell named"
    props = sheets.sheet_props(sid)
    if tab not in props:
        return "refused", f"the book has no {tab} tab"
    rows = sorted({r for r, _c in want})
    rec = {(int(r), int(c)): (str(t), str(s)) for r, c, t, s in conn.execute(
        f"SELECT sheet_row, col, text, synced FROM {M.qualified(M.CELLS)} WHERE sheet_row = ANY(%s)",
        (rows,)).fetchall()}
    matrix = sheets.batch_get(sid, [f"{quote(tab)}!A1:{M.col_letter(M.COLS - 1)}{M.ROWS}"])[0]
    puts: list[tuple[int, int, str]] = []
    already = 0
    moved: list[str] = []
    left: list[str] = []
    for r, c in want:
        at = f"{M.col_letter(c)}{r}"
        if c < M.NAME_COLS:
            left.append(at)
            continue
        names = [rec.get((r, i), ("", ""))[0].strip() for i in range(M.NAME_COLS)]
        if names != [_text(matrix, r - 1, i) for i in range(M.NAME_COLS)]:
            moved.append(at)
            continue
        text, synced = rec.get((r, c), ("", ""))
        live = _text(matrix, r - 1, c)
        if live == text.strip():
            already += 1
        elif live == synced.strip():
            puts.append((r, c, text))
        else:
            left.append(at)
    if puts:
        sheets.structure(sid, [_put(props[tab]["id"], r - 1, c, [[t]]) for r, c, t in puts])
    said = f"{len(puts)} cell(s) written, {already} already there"
    if moved:
        said += f"; {len(moved)} on a row the sheet now names someone else by ({', '.join(moved[:6])})"
    if left:
        said += f"; {len(left)} the sheet changed too, left to the record's sync ({', '.join(left[:6])})"
    return ("refused" if moved and not puts and not already else "done"), said


def table_rows(sheets: Any, op: dict[str, Any], quote: Callable[[str], str], conn: Any,
               again: bool = False) -> tuple[str, str]:
    sid, tab = op["sheet_id"], op["tab"]
    ids = [int(i) for i in op["spec"].get("ids") or []]
    got = conn.execute(f"SELECT id, cells FROM {M.qualified(M.TABLE)} WHERE id = ANY(%s) ORDER BY id",
                       (ids,)).fetchall() if ids else []
    if not got:
        return "done", "no row of the record is left to append"
    props = sheets.sheet_props(sid)
    if tab not in props:
        return "refused", f"the book has no {tab} tab"
    head, col_a = sheets.batch_get(sid, [f"{quote(tab)}!1:1", f"{quote(tab)}!A:A"])
    header = [str(h).strip() for h in (head[0] if head else [])]
    if not any(header):
        return "refused", f"the {tab} tab has no header"
    lines = [[str((c if isinstance(c, dict) else json.loads(c or "{}")).get(h, "") or "") for h in header]
             for _i, c in got]
    n = len(col_a)
    if again and n > len(lines):
        tail = sheets.batch_get(sid, [f"{quote(tab)}!A{n - len(lines) + 1}:{M.col_letter(len(header) - 1)}{n}"])[0]
        if [[str(v).strip() for v in r] + [""] * (len(header) - len(r)) for r in tail] == \
                [[v.strip() for v in line] for line in lines]:
            conn.execute(f"UPDATE {M.qualified(M.TABLE)} SET synced = true WHERE id = ANY(%s)", ([i for i, _c in got],))
            return "done", f"{len(lines)} row(s) were appended before"
    reqs: list[dict[str, Any]] = []
    grid = props[tab]
    if n + len(lines) > int(grid.get("rows") or 0):
        reqs.append({"appendDimension": {"sheetId": grid["id"], "dimension": "ROWS",
                                         "length": n + len(lines) - int(grid.get("rows") or 0)}})
    reqs.append(_put(grid["id"], n, 0, lines))
    sheets.structure(sid, reqs)
    conn.execute(f"UPDATE {M.qualified(M.TABLE)} SET synced = true WHERE id = ANY(%s)", ([i for i, _c in got],))
    return "done", f"{len(lines)} row(s) appended after row {n}"


def _book_modified(ro: Callable[[], Any] | None, sid: str) -> float | None:
    """When the book last changed, as asa-hub-db's catalog says; None when it cannot be told."""
    if ro is None:
        return None
    try:
        got = ro().execute("SELECT extract(epoch FROM modified_time) FROM catalog.books WHERE sheet_id = %s",
                           (sid,)).fetchone()
    except Exception as exc:  # noqa: BLE001 - untold, the sheet's value stands
        log.warning("the catalog was not read for %s… (%s)", sid[:8], type(exc).__name__)
        return None
    return float(got[0]) if got and got[0] is not None else None


def house_cells(sheets: Any, op: dict[str, Any], quote: Callable[[str], str], conn: Any,
                ro: Callable[[], Any] | None) -> tuple[str, str]:
    import calendar_builder_houses as cbh  # noqa: PLC0415 - the house tab's own reading
    sid, tab, spec = op["sheet_id"], op["tab"], op["spec"]
    props = sheets.sheet_props(sid)
    if tab not in props:
        return "refused", f"the house calendars workbook has no tab called {tab}"
    matrix = [[str(v if v is not None else "") for v in row] for row in sheets.batch_get(sid, [quote(tab)])[0]]
    layout = cbh.tab_layout(matrix, [str(i) for i in spec.get("isos") or []])
    if layout is None:
        return "refused", f"the tab {tab} does not look like a roster grid (no STAFF header with days beside it)"
    modified = _book_modified(ro, sid)
    new_names: list[str] = []
    writes: list[tuple[str | None, int, int | None, str]] = []
    already = 0
    left: list[str] = []
    conflicts: list[tuple] = []
    for c in spec.get("cells") or []:
        emp, iso, value, base = (str(c.get(k) or "") for k in ("employee", "col_iso", "value", "base"))
        col = layout["col_by_iso"].get(iso)
        if col is None:
            left.append(f"{emp} on {iso}: the tab has no column for the day")
            continue
        ri, why = cbh.resolve_row(layout, emp)
        if why:
            left.append(f"{emp} on {iso}: {why}")
            continue
        live = _text(matrix, ri, col) if ri is not None else ""
        if live == value.strip():
            already += 1
            continue
        if live != base.strip():
            newer = modified is not None and _epoch(c.get("at")) > modified
            conflicts.append((emp, iso, base, value, live, "postgres" if newer else "sheet", c.get("at")))
            if not newer:
                left.append(f"{emp} on {iso}: the sheet changed it since, and later")
                continue
        if ri is None and emp not in new_names:
            new_names.append(emp)
        writes.append((emp if ri is None else None, ri if ri is not None else -1, col, value))
    reqs: list[dict[str, Any]] = []
    gid = props[tab]["id"]
    row_of: dict[str, int] = {}
    if new_names:
        start = int(layout["last_named"]) + 1
        reqs.append({"insertDimension": {"range": {"sheetId": gid, "dimension": "ROWS", "startIndex": start,
                                                   "endIndex": start + len(new_names)},
                                         "inheritFromBefore": True}})
        for i, n in enumerate(new_names):
            row_of[n] = start + i
            reqs.append(_put(gid, start + i, layout["staff_col"], [[n]]))
    for new, ri, col, value in writes:
        reqs.append(_put(gid, row_of[new] if new is not None else ri, col, [[value]]))
    if reqs:
        sheets.structure(sid, reqs)
    for emp, iso, base, value, live, winner, at in conflicts:
        conn.execute(f"INSERT INTO {M.qualified(M.CONFLICTS)} (sheet_id, tab_name, match_by, keyed_by, row_key, "
                     "field, edit_id, base_value, pg_value, sheet_value, winner, why, edit_at, sheet_seen_at) "
                     "VALUES (%s, %s, 'cell', 'house', %s, %s, 0, %s, %s, %s, %s, %s, %s, now())",
                     (sid, tab, emp, iso, base, value, live, winner,
                      "both changed it; the newer side is kept", at or None))
    said = f"{len(writes)} cell(s) written, {already} already there, {len(new_names)} row(s) added"
    if left:
        said += f"; {len(left)} left: " + "; ".join(left[:4])
    return ("refused" if left and not writes and not already else "done"), said
