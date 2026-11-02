"""Render Sheet's writes on Python (RenderSheet.gs): a cell typed or a row added — on a tab an app keeps in Postgres
straight into its rows (app.resource_rows), on any other kept in app.edits (Postgres' record, laid over the copy on
every read) — and a spreadsheet linked or unlinked, its list in Postgres (renderSheets). Never written to Google
here; the ledgers stay read-only."""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import locations as L
import render_sheet as RS
import resource_rows as RR
import sheet_resources as SR
import writes as W
from writes import Decision

BUSY = "Somebody else is changing this sheet right now — try again."
NO_EDIT = {"status": 403, "message": "Your badge may view these sheets, not edit them."}
NO_MANAGE = {"status": 403, "message": "Your badge may view these sheets, not manage them."}
SPECS = {RS.REGISTRY: {"tab": "render_sheets"}}

s_ = gsjs.str_


def _sheet(sess: L.Session, name: str) -> RS.Sheet | Decision:
    """The tab a write lands on, past the ledger and the existence checks."""
    reads = sess.reads
    refused = RS.ledger_refusal(reads, name, None)
    if refused:
        return Decision(refused)
    got = RS.resolve(reads, name)
    if isinstance(got, dict):
        return Decision(got)
    if not got.alive():
        return W.refuse(400, "That tab does not exist yet.")
    refused = RS.ledger_refusal(reads, name, got)
    return Decision(refused) if refused else got


def cell_set(sess: L.Session, payload: dict) -> Decision:
    """renderSheetCellSet: one cell, refused when it changed under the person."""
    user = sess.user or {}
    if not RS.writer(user):
        return Decision(dict(RS.DENIED))
    if not RS.can_edit(sess.reads, user):
        return Decision(dict(NO_EDIT))
    p = payload if isinstance(payload, dict) else {}
    name = s_(p.get("tab"))
    sheet = _sheet(sess, name)
    if isinstance(sheet, Decision):
        return sheet
    reads = sess.reads
    header, body, keys = RS.grid_of(reads, sheet)
    col = gsjs.js_str(p.get("col")) if p.get("col") is not None else ""
    if col not in header:
        return W.refuse(400, "Unknown column: " + col)
    try:
        row = int(float(p.get("row")))
    except (TypeError, ValueError):
        row = 0
    if row < 1 or row > len(body):
        return W.refuse(400, f"Row {p.get('row')} is out of range.")
    current = body[row - 1][header.index(col)]
    prev = gsjs.js_str(p.get("prev")) if p.get("prev") is not None else ""
    if current != prev:
        return W.refuse(409, "The cell changed under you — reload.", data={"current": current})
    value = gsjs.js_str(p.get("value")) if p.get("value") is not None else ""
    answer = {"status": 200, "data": {"tab": name, "row": row, "col": col, "value": value}}
    key = keys[row - 1]
    if sheet.resource:
        cells = next(c for k, c in RR.table_rows(reads, sheet.resource) if k == key)
        RR.update(reads, sheet.resource, key, cells, {col: value}, s_(user.get("email")))
        return Decision(answer, subject="", own=True)
    rec = W.kept_record(sheet.sid, sheet.tab, "edit", "row", key, "", {col: value}, {col: current})
    return W.final(answer, [rec], "")


def row_add(sess: L.Session, payload: dict) -> Decision:
    """renderSheetRowAdd: one row after the last, its cells as typed."""
    user = sess.user or {}
    if not RS.writer(user):
        return Decision(dict(RS.DENIED))
    if not RS.can_edit(sess.reads, user):
        return Decision(dict(NO_EDIT))
    p = payload if isinstance(payload, dict) else {}
    name = s_(p.get("tab"))
    sheet = _sheet(sess, name)
    if isinstance(sheet, Decision):
        return sheet
    reads = sess.reads
    header, body, _keys = RS.grid_of(reads, sheet)
    values = p.get("values") if isinstance(p.get("values"), dict) else {}
    unknown = [k for k in values if k not in header]
    if unknown:
        return W.refuse(400, "Unknown column(s): " + ", ".join(unknown))
    cells = {h: gsjs.js_str(values.get(h)) for h in header if values.get(h) not in (None, "")}
    answer = {"status": 200, "data": {"tab": name, "row": len(body) + 1}}
    if sheet.resource:
        RR.create(reads, sheet.resource, cells, s_(user.get("email")))
        return Decision(answer, subject="", own=True)
    if "id" not in header:
        return W.refuse(409, "This tab names its rows by no id, so a row is added in the app that keeps it.")
    cells["id"] = cells.get("id") or W.mint()
    rec = W.kept_record(sheet.sid, sheet.tab, "append", "id", cells["id"], "", {h: cells.get(h, "") for h in header})
    return W.final(answer, [rec], "")


def _sheet_id_from(v: Any) -> str:
    """renderSheetIdFromUrl_."""
    s = s_(v).strip()
    m = re.search(r"/d/([-\w]{20,})", s)
    if m:
        return m.group(1)
    return s if re.fullmatch(r"[-\w]{20,}", s) else ""


def add(sess: L.Session, payload: dict) -> Decision:
    """renderSheetAdd: a spreadsheet linked to the screen, when the platform holds its copy."""
    user = sess.user or {}
    if not RS.writer(user):
        return Decision(dict(RS.DENIED))
    if not RS.can_edit(sess.reads, user):
        return Decision(dict(NO_MANAGE))
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    sid = _sheet_id_from(p.get("url"))
    if not sid:
        return W.refuse(400, "Paste the spreadsheet link (or its id).")
    if sid == s_(reads.db.prop("HUB_DB_ID")):
        return W.refuse(400, "The platform database is already on this screen.")
    book = reads.db.book(sid)
    if book is None:
        return W.refuse(403, "The platform holds no copy of that spreadsheet — share it with the platform account and "
                             "try again once it is copied.")
    tab = s_(p.get("tab"))
    if tab and reads.db.tab(sid, tab) is None:
        return W.refuse(400, f'Tab "{tab}" does not exist in that spreadsheet.')
    if any(s_(r.get("sheet_id")) == sid and s_(r.get("tab_name")) == tab for r in RS.registry(reads)):
        return W.refuse(409, "That spreadsheet is already on the list.")
    rid = secrets.token_hex(4)
    title = s_(getattr(book, "name", "")) or sid
    RR.create(reads, RS.REGISTRY, {"id": rid, "title": title, "sheet_id": sid, "tab_name": tab,
                                   "added_by": s_(user.get("email")),
                                   "added_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")},
              s_(user.get("email")))
    return Decision({"status": 200, "data": {"id": "lnk_" + rid, "title": title}}, subject="", own=True)


def remove(sess: L.Session, payload: dict) -> Decision:
    """renderSheetRemove: a linked spreadsheet off the list."""
    user = sess.user or {}
    if not RS.writer(user):
        return Decision(dict(RS.DENIED))
    if not RS.can_edit(sess.reads, user):
        return Decision(dict(NO_MANAGE))
    rid = re.sub(r"^lnk_", "", s_((payload or {}).get("id")) if isinstance(payload, dict) else "")
    if not rid:
        return W.refuse(400, "Which spreadsheet?")
    hit = next(((k, c) for k, c in RR.table_rows(sess.reads, RS.REGISTRY) if s_(c.get("id")) == rid), None)
    if hit is None:
        return Decision({"status": 200, "data": {"removed": False}}, subject="", own=True)
    RR.remove(sess.reads, RS.REGISTRY, hit[0], hit[1], s_(user.get("email")))
    return Decision({"status": 200, "data": {"removed": True}}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "renderSheetCellSet": cell_set, "renderSheetRowAdd": row_add, "renderSheetAdd": add,
    "renderSheetRemove": remove, "renderSheetUpload": RR.upload_door(SPECS)}
_ROLES = ("admin", "manager")
POLICY: dict[str, dict[str, Any]] = {"renderSheetCellSet": {"roles": _ROLES}, "renderSheetRowAdd": {"roles": _ROLES},
                                     "renderSheetAdd": {"roles": _ROLES}, "renderSheetRemove": {"roles": _ROLES},
                                     "renderSheetUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.render_sheet_writes and app.render_sheet_receipts, beside the other apps' own; owned rows
    app.resource_rows', a copy's cells app.edits'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="render_sheet", label="Render Sheet")
