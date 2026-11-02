"""The Task Board Sheet's writes on Python: the personal board's cards (the generic create, update and delete on
`sheetTasks`, each its owner's, a move onto Done stamped) and each card's spreadsheet kept in Postgres
(SheetBoard.gs: sheetBoardCreate, sheetBoardCellSet, sheetBoardRowAdd, sheetBoardRowDelete, sheetBoardColAdd,
sheetBoardTabAdd) — every tab's state before a write kept in app.sheet_board_changes, so a void takes it back.
sheetTasksUpload brings the board into Postgres as the app is given to Python, and gives every card that already named a
spreadsheet one of its own here."""
from __future__ import annotations

import uuid
from typing import Any, Callable

import gsjs
import locations as L
import resource_rows as RR
import sheet_board as SB
import sheet_resources as SR
import smart_comms as SC
import writes as W
from writes import Decision

CHANGES = "app.sheet_board_changes"
BUSY = "Somebody else is changing this board right now — try again."

s_ = gsjs.str_


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, SB.RESOURCE, payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, SB.RESOURCE, payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, SB.RESOURCE, payload)


def _keep(key: str, card_id: str, owner: str, tab: str, cells: list, before: list | None, made: bool,
          position: int = 0) -> None:
    """One tab written, its state before kept for a void."""
    cur = RR._cur()
    cur.execute(f"insert into {CHANGES} (write_id, sheet_key, tab, before) values (%s, %s, %s, %s)",
                (SC.write_id(), key, tab, None if made else SB.dumps(before)))
    if made:
        cur.execute(f"insert into {SB.TABS} (sheet_key, card_id, owner, tab, position, cells, write_id) values"
                    " (%s, %s, %s, %s, %s, %s, %s)", (key, card_id, owner, tab, position, SB.dumps(cells),
                                                      SC.write_id()))
    else:
        cur.execute(f"update {SB.TABS} set cells = %s, updated_at = now(), write_id = %s where sheet_key = %s"
                    " and tab = %s", (SB.dumps(cells), SC.write_id(), key, tab))


def make_sheet(card_id: str, owner: str) -> str:
    """A new sheet for the card: one empty tab, as a new spreadsheet opens."""
    key = "sb_" + uuid.uuid4().hex
    _keep(key, card_id, owner, SB.FIRST_TAB, [], None, True)
    return key


def sheet_create(sess: L.Session, payload: dict) -> Decision:
    """sheetBoardCreate: the card's sheet, made once — a second press answers the one already made; another only for a
    badge that carries the multiple-sheets feature."""
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("id"))
    if not cid:
        return W.refuse(400, "id is required — the card the sheet belongs to.")
    card = SB.card_of(sess, cid)
    if card.get("error"):
        return Decision(card["error"])
    row = card["row"]
    existing = s_(row.get("spreadsheet_id"))
    want_more = p.get("another") is True
    if existing and SB.tabs_of(sess.reads, existing) and not want_more:
        return Decision({"status": 200, "data": {"id": cid, "spreadsheet_id": existing,
                                                 "spreadsheet_url": s_(row.get("spreadsheet_url")),
                                                 "spreadsheet_name": s_(row.get("spreadsheet_name")),
                                                 "created": False}}, subject=cid, own=True)
    if existing and want_more and not SB.may_add_more(sess.reads, sess.user or {}):
        return W.refuse(403, "This card already has its spreadsheet. More than one per card is a feature your badge "
                             "does not carry.")
    name = s_(row.get("title")) or "Untitled card"
    if existing and want_more:
        name += " (" + W.now_iso(sess.reads)[:10] + ")"
    me = SR.me_of(sess.user or {})
    key = make_sheet(cid, me)
    fields = {"spreadsheet_id": key, "spreadsheet_url": SB.sheet_url(cid), "spreadsheet_name": name}
    RR.update(sess.reads, SB.RESOURCE, card["key"], card["cells"], fields, s_((sess.user or {}).get("email")))
    return Decision({"status": 200, "data": {"id": cid, **fields, "created": True}}, subject=cid, own=True)


def _opened(sess: L.Session, payload: dict) -> tuple[dict, dict] | Decision:
    p = payload if isinstance(payload, dict) else {}
    got = SB.open_sheet(sess, p.get("id"))
    if got.get("error"):
        return Decision(got["error"])
    return got, SB.tab_named(got["tabs"], p.get("tab"))


def _num(v: Any) -> float:
    n = SR._int(v) if isinstance(v, (int, str)) and not isinstance(v, bool) else None
    return float(n) if n is not None else float("nan")


def _write(got: dict, tab: dict, cells: list) -> None:
    _keep(got["sheet_key"], s_(got["row"].get("id")), tab["owner"], tab["tab"], cells, tab["cells"], False)


def cell_set(sess: L.Session, payload: dict) -> Decision:
    """sheetBoardCellSet: one cell, 1-based below the header."""
    opened = _opened(sess, payload)
    if isinstance(opened, Decision):
        return opened
    got, tab = opened
    r, c = _num(payload.get("row")), _num(payload.get("col"))
    if not (r >= 1) or not (c >= 1):
        return W.refuse(400, "row and col are 1-based numbers.")
    r, c = int(r), int(c)
    cells = [list(x) for x in tab["cells"]]
    while len(cells) < r + 1:
        cells.append([])
    line = cells[r]
    while len(line) < c:
        line.append("")
    line[c - 1] = s_(payload.get("value"))
    _write(got, tab, cells)
    return Decision({"status": 200, "data": {"row": r, "col": c, "value": line[c - 1]}}, subject=s_(payload.get("id")),
                    own=True)


def row_add(sess: L.Session, payload: dict) -> Decision:
    """sheetBoardRowAdd: an empty row after the last."""
    opened = _opened(sess, payload)
    if isinstance(opened, Decision):
        return opened
    got, tab = opened
    cells = [list(x) for x in tab["cells"]] + [[""] * max(1, SB.width(tab["cells"]))]
    _write(got, tab, cells)
    return Decision({"status": 200, "data": {"rows": max(0, len(cells) - 1)}}, subject=s_(payload.get("id")), own=True)


def row_delete(sess: L.Session, payload: dict) -> Decision:
    """sheetBoardRowDelete: the row, 1-based below the header."""
    opened = _opened(sess, payload)
    if isinstance(opened, Decision):
        return opened
    got, tab = opened
    r = _num(payload.get("row"))
    if not (r >= 1):
        return W.refuse(400, "row is a 1-based number.")
    r = int(r)
    if r + 1 > len(tab["cells"]):
        return W.refuse(400, f"There is no row {r}.")
    cells = [list(x) for x in tab["cells"]]
    del cells[r]
    _write(got, tab, cells)
    return Decision({"status": 200, "data": {"rows": max(0, len(cells) - 1)}}, subject=s_(payload.get("id")), own=True)


def col_add(sess: L.Session, payload: dict) -> Decision:
    """sheetBoardColAdd: a named column after the last."""
    opened = _opened(sess, payload)
    if isinstance(opened, Decision):
        return opened
    got, tab = opened
    name = s_(payload.get("name"))[:80]
    if not name:
        return W.refuse(400, "A column needs a name.")
    col = max(1, SB.width(tab["cells"]) + 1)
    cells = [list(x) for x in tab["cells"]] or [[]]
    head = cells[0]
    while len(head) < col:
        head.append("")
    head[col - 1] = name
    _write(got, tab, cells)
    return Decision({"status": 200, "data": {"col": col, "name": name}}, subject=s_(payload.get("id")), own=True)


def tab_add(sess: L.Session, payload: dict) -> Decision:
    """sheetBoardTabAdd: a new empty tab, after the others."""
    p = payload if isinstance(payload, dict) else {}
    got = SB.open_sheet(sess, p.get("id"))
    if got.get("error"):
        return Decision(got["error"])
    name = s_(p.get("name"))[:80] or "Sheet"
    names = [t["tab"] for t in got["tabs"]]
    if name in names:
        return W.refuse(409, "That tab already exists.")
    _keep(got["sheet_key"], s_(got["row"].get("id")), SR.me_of(sess.user or {}), name, [], None, True, len(names))
    return Decision({"status": 200, "data": {"tab": name, "tabs": names + [name]}}, subject=s_(p.get("id")), own=True)


def upload(sess: L.Session, payload: dict) -> Decision:
    """sheetTasksUpload: the board's sheet into Postgres (rows nothing here has touched), then every card naming a
    spreadsheet Postgres does not hold given a sheet of its own here — the Google file it named stays in Drive, its id
    kept on the card; `release` hands the board back to the sheet's copy."""
    door = RR.upload_door({SB.RESOURCE: SR.SPECS[SB.RESOURCE]})
    got = door(sess, payload)
    if (payload or {}).get("release") is True or (got.answer or {}).get("status") != 200:
        return got
    reads = sess.reads
    moved = 0
    for key, cells in RR.table_rows(reads, SB.RESOURCE):
        row = RR.shown(RR.columns(reads, SB.RESOURCE), cells) or {}
        named = s_(row.get("spreadsheet_id"))
        if not named or SB.tabs_of(reads, named):
            continue
        owner = SR.owner_of(SB.RESOURCE, row)
        cid = s_(row.get("id"))
        sheet = make_sheet(cid, owner)
        RR.update(reads, SB.RESOURCE, key, cells, {"spreadsheet_google_id": named, "spreadsheet_id": sheet,
                                                   "spreadsheet_url": SB.sheet_url(cid)}, "asa-hub:sheet-board")
        moved += 1
    data = dict((got.answer or {}).get("data") or {})
    data["sheets_made"] = moved
    return Decision({"status": 200, "data": data}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "sheetTasksCreate": create, "sheetTasksUpdate": update, "sheetTasksDelete": delete,
    "sheetBoardCreate": sheet_create, "sheetBoardCellSet": cell_set, "sheetBoardRowAdd": row_add,
    "sheetBoardRowDelete": row_delete, "sheetBoardColAdd": col_add, "sheetBoardTabAdd": tab_add,
    "sheetTasksUpload": upload}
_ROLES = ("admin", "manager", "staff", "client")
POLICY: dict[str, dict[str, Any]] = {a: ({"roles": _ROLES} if a.startswith("sheetBoard") else {}) for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.sheet_board_writes and app.sheet_board_receipts, beside the other apps' own; the cards app.resource_rows',
    the sheets app.sheet_board_tabs'. A void takes back every tab the write changed or made."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="sheet_board", label="Task Board Sheet")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                c = self.conn()
                with c.transaction():
                    rows = c.execute(f"select id, sheet_key, tab, before from {CHANGES} where write_id = %s"
                                     " order by id desc", (write_id,)).fetchall()
                    for cid, key, tab, before in rows:
                        if before is None:
                            c.execute(f"delete from {SB.TABS} where sheet_key = %s and tab = %s", (key, tab))
                        else:
                            c.execute(f"update {SB.TABS} set cells = %s, updated_at = now() where sheet_key = %s"
                                      " and tab = %s", (SB.dumps(RR._json(before)), key, tab))
                        c.execute(f"delete from {CHANGES} where id = %s", (cid,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("sheet board: the void of %s was not applied (%s)", write_id[:40], type(exc).__name__)
        return done
