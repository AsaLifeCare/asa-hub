"""The Task Board Sheet (taskboard-sheet) on Python: the personal board (`sheetTasks`, every card its owner's alone) read
from Postgres (app/resource_rows.py) through the generic list and get, and each card's spreadsheet (SheetBoard.gs) kept
in Postgres too — app.sheet_board_tabs, one row per tab, its cells a grid of text — opened inside the platform by
sheetBoardGrid. A card's sheet is resolved from the card its owner holds, never from an id the browser sends."""
from __future__ import annotations

import json
from typing import Any, Callable

import gsjs
import house_tables as HT
import locations as L
import resource_rows as RR
import scope as sc
import sheet_resources as SR

APP_ID = "taskboard-sheet"
RESOURCE = "sheetTasks"
TABS = "app.sheet_board_tabs"
MAX_ROWS = 500
FIRST_TAB = "Sheet1"
PLATFORM = "https://asamylife.asalifecare.com"
MULTIPLE = "taskboard-sheet.multipleSheets"
NO_SHEET = {"status": 404, "message": "This card has no spreadsheet yet."}
NOT_OWN = {"status": 404, "message": "This card has no spreadsheet of its own."}

s_ = gsjs.str_


def tasks_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, RESOURCE, payload)


def tasks_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, RESOURCE, payload)


def sheet_url(card_id: str) -> str:
    """Where the card's sheet opens: inside the platform."""
    import urllib.parse  # noqa: PLC0415
    return PLATFORM + "/app/taskboard-sheet/sheet?card=" + urllib.parse.quote(card_id, safe="")


def card_of(sess: L.Session, card_id: Any) -> dict[str, Any]:
    """sheetBoardOpen_'s first half: the caller's own card, or why not."""
    user = sess.user or {}
    if not user or user.get("is_service"):
        return {"error": {"status": 403, "message": "Requires an admin or manager account"}}
    cid = s_(card_id)
    hit = SR._found(sess.reads, RESOURCE, cid)
    if hit is None:
        return {"error": {"status": 404, "message": f'No "{RESOURCE}" record with id "{cid}".'}}
    if SR.owner_of(RESOURCE, hit[2]) != SR.me_of(user):
        return {"error": {"status": 404, "message": f'No card "{cid}" here.'}}
    return {"key": hit[0], "cells": hit[1], "row": hit[2]}


def tabs_of(reads: L.Reads, sheet_key: str) -> list[dict[str, Any]]:
    """The sheet's tabs in their order: name, owner and cells."""
    return [{"tab": t, "owner": o, "cells": RR._json(c) or []} for t, o, c in RR._q(
        reads, f"select tab, owner, cells from {TABS} where sheet_key = %s order by position, created_at", (sheet_key,))]


def open_sheet(sess: L.Session, card_id: Any) -> dict[str, Any]:
    """sheetBoardOpen_: the owner's card, the sheet it names, and that sheet being one the board made for them."""
    card = card_of(sess, card_id)
    if card.get("error"):
        return card
    key = s_(card["row"].get("spreadsheet_id"))
    if not key:
        return {"error": dict(NO_SHEET)}
    tabs = tabs_of(sess.reads, key)
    if not tabs or any(t["owner"] != SR.me_of(sess.user or {}) for t in tabs):
        return {"error": dict(NOT_OWN)}
    return {**card, "sheet_key": key, "tabs": tabs}


def tab_named(tabs: list[dict], name: Any) -> dict[str, Any]:
    """sheetBoardTab_: the named tab, else the first."""
    want = s_(name)
    return next((t for t in tabs if want and t["tab"] == want), tabs[0])


def width(cells: list[list[str]]) -> int:
    return max((len(r) for r in cells), default=0)


def grid(sess: L.Session, payload: dict) -> dict[str, Any]:
    """sheetBoardGrid: the tab's header and its rows as shown, 500 at most."""
    p = payload if isinstance(payload, dict) else {}
    got = open_sheet(sess, p.get("id"))
    if got.get("error"):
        return got["error"]
    tab = tab_named(got["tabs"], p.get("tab"))
    names = [t["tab"] for t in got["tabs"]]
    row = got["row"]
    cells = tab["cells"]
    if not cells:
        return {"status": 200, "data": {"tab": tab["tab"], "tabs": names, "header": [], "rows": [], "colors": [],
                                        "truncated": False, "name": s_(row.get("spreadsheet_name")),
                                        "url": s_(row.get("spreadsheet_url"))}}
    w = width(cells)
    padded = [[s_(v) for v in r] + [""] * (w - len(r)) for r in cells]
    body = padded[1:]
    truncated = len(body) > MAX_ROWS
    body = body[:MAX_ROWS]
    colors = [["#ffffff"] * max(1, w) for _ in range(max(1, len(body)))]
    return {"status": 200, "data": {"tab": tab["tab"], "tabs": names, "header": padded[0], "rows": body,
                                    "colors": colors, "truncated": truncated, "name": s_(row.get("spreadsheet_name")),
                                    "url": s_(row.get("spreadsheet_url"))}}


def may_add_more(reads: L.Reads, user: dict) -> bool:
    """sheetBoardMayAddMore_: the master, or a badge App Control lists on the multiple-sheets row; fails closed."""
    if not user or user.get("is_service"):
        return False
    if sc.is_master_email(user.get("email")):
        return True
    try:
        res = HT.where(reads, "app_badge_access")
        rule = next((s_(raw.get("badges")) for _rn, raw in (reads.db.rows(res.ref) if res.ref else [])
                     if s_(raw.get("app_id")) == MULTIPLE), "")
    except Exception:  # noqa: BLE001 - an unread rule is one sheet per card
        return False
    if not rule.strip():
        return False
    have = ",".join(sc.badges_worn(user.get("types"), user.get("role"))).upper()
    return any(b.strip().upper() and b.strip().upper() in have for b in rule.split(","))


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "sheetTasksList": tasks_list, "sheetTasksGet": tasks_get, "sheetBoardGrid": grid}
POLICY: dict[str, dict[str, Any]] = {"sheetTasksList": {}, "sheetTasksGet": {},
                                     "sheetBoardGrid": {"roles": ("admin", "manager", "staff", "client")}}


def dumps(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False)
