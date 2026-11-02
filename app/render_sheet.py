"""Render Sheet on Python (RenderSheet.gs): the sheet viewer and editor, every tab read out of Postgres — a tab an app
already keeps in Postgres (app.resource_rows) from there, any other off its copy in asa-hub-db with the kept edits laid
over it — never from Google. The copies hold values only: a cell's colour, weight and the frozen rows are not kept, so
the grid answers them blank and the header frozen. The linked spreadsheets' list lives in Postgres too (renderSheets,
uploaded from render_sheets as the app is given to Python)."""
from __future__ import annotations

from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import resource_rows as RR
import scope as sc
import sheet_resources as SR
from scope import Defer

APP_ID = "render-sheet"
REGISTRY = "renderSheets"
# NEVER 'users': salts and password hashes live there
TABS = ("entity_candidates", "entity_phone_screens", "staff_requests", "finance_transactions", "travelTrips",
        "mar_entries", "app_release_log", "projects", "diseases", "workOrders", "drAppointments", "shifts",
        "comm_intents", "comm_bindings", "comm_attempts", "comm_routes", "smart_comms_sent")
# readable, never typed into: a hand-written ledger row silences or re-arms a reminder with no trace
LEDGERS = ("smart_comms_sent", "comm_attempts")
ESTATE = ({"key": "est_uimui", "prop": "ESTATE_UI_ID", "tab": "UIs and MUIs", "title": "Asa | UIs and MUIs"},)
MAX_ROWS = 1000
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
NOT_SERVED = {"status": 400, "message": "That tab is not served here."}

s_ = gsjs.str_


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    u = user or {}
    return s_(u.get("role")) in ("admin", "manager") and not u.get("is_service")


def can_edit(reads: L.Reads, user: dict | None) -> bool:
    """renderSheetCanEdit_: admins and the master, then the badges render_sheet_edit_badges names; none else."""
    u = user or {}
    if not u or u.get("is_service"):
        return False
    if s_(u.get("role")) == "admin" or sc.is_master_email(u.get("email")):
        return True
    cfg = s_(reads.db.hiring_config().get("render_sheet_edit_badges")).strip()
    if not cfg:
        return False
    mine = sc.badges_worn(u.get("types"), "")
    return any(b.strip().upper() in mine for b in cfg.split(",") if b.strip())


def owner_of(tab: str) -> str:
    """The resource an app keeps this tab as, '' when none does."""
    return next((r for r, spec in SR.SPECS.items() if spec.get("tab") == tab), "")


class Sheet:
    """One tab as the screen sees it: where it lives, its header, its rows (sheet row number, cells by header)."""

    def __init__(self, key: str, label: str, sid: str = "", tab: str = "", ref: Any = None, resource: str = "") -> None:
        self.key, self.label, self.sid, self.tab, self.ref, self.resource = key, label, sid, tab, ref, resource

    def alive(self) -> bool:
        return bool(self.resource) or self.ref is not None

    def header(self, reads: L.Reads) -> list[str]:
        if self.resource:
            return RR.columns(reads, self.resource)
        return [gsjs.js_str(h) for h in (self.ref.headers if self.ref is not None else ())]

    def rows(self, reads: L.Reads) -> list[tuple[str, dict]]:
        """(row key, cells) in sheet order: an owned row's key, else r<sheet row>."""
        if self.resource:
            return [(k, c) for k, c in RR.table_rows(reads, self.resource)]
        if self.ref is None:
            return []
        return [(f"r{rn}", raw) for rn, raw in reads.db.rows(self.ref)]


def _shown(v: Any) -> str:
    return gsjs.js_str(hubdb.cell_text(hubdb.typed(v, "hub")))


def grid_of(reads: L.Reads, sheet: Sheet) -> tuple[list[str], list[list[str]], list[str]]:
    """(header, the rows as shown, their keys), every row with anything in it."""
    header = sheet.header(reads)
    body, keys = [], []
    for key, cells in sheet.rows(reads):
        line = [_shown(cells.get(h)) for h in header]
        if any(v != "" for v in line):
            body.append(line)
            keys.append(key)
    return header, body, keys


def registry(reads: L.Reads) -> list[dict]:
    """renderSheetsRegRows_: the linked spreadsheets, out of Postgres."""
    return [r for r in RR.read_all(reads, REGISTRY) if s_(r.get("id"))]


def _first_tab(reads: L.Reads, sid: str) -> str:
    """The book's first tab as the copy lists it."""
    tabs = sorted(t for (s, t) in reads.db.catalog()["tabs"] if s == sid)
    return tabs[0] if tabs else ""


def resolve(reads: L.Reads, key: str) -> Sheet | dict:
    """renderSheetResolve_: a built-in tab where it lives now, an estate tab, or a linked one; else the refusal."""
    name = s_(key)
    if name.startswith("est_"):
        hit = next((e for e in ESTATE if e["key"] == name), None)
        if hit is None:
            return dict(NOT_SERVED)
        sid = s_(reads.db.prop(hit["prop"]))
        if not sid:
            return {"status": 404, "message": hit["prop"] + " is not set — the workbook is unknown to the platform."}
        ref = reads.db.tab(sid, hit["tab"])
        return Sheet(name, f"{hit['title']}!{hit['tab']}", sid, hit["tab"], ref)
    if not name.startswith("lnk_"):
        if name not in TABS:
            return dict(NOT_SERVED)
        owned = owner_of(name)
        if owned and RR.uploaded(reads.db, owned):
            return Sheet(name, name, resource=owned)
        res = reads.db.resolve(name)
        if res.runtime:
            raise Defer(f"{name} lives in the depot's facts")
        return Sheet(name, name, res.sheet_id, res.ref.tab if res.ref is not None else name, res.ref)
    row = next((r for r in registry(reads) if "lnk_" + s_(r.get("id")) == name), None)
    if row is None:
        return {"status": 404, "message": "That spreadsheet is no longer on the list."}
    sid = s_(row.get("sheet_id"))
    tab = s_(row.get("tab_name")) or _first_tab(reads, sid)
    if sid == s_(reads.db.prop("HUB_DB_ID")) and tab == "users":
        return {"status": 403, "message": "That tab is never served here."}
    ref = reads.db.tab(sid, tab) if tab else None
    label = s_(row.get("title")) + ("!" + s_(row.get("tab_name")) if s_(row.get("tab_name")) else "")
    return Sheet(name, label, sid, tab, ref)


def ledger_refusal(reads: L.Reads, key: str, sheet: Sheet | None) -> dict | None:
    """renderSheetLedgerRefusal_: a ledger is read-only on this screen, under its own name or its data house."""
    hit = key if key in LEDGERS else ""
    if not hit and sheet is not None and sheet.sid:
        hub_db = s_(reads.db.prop("HUB_DB_ID"))
        for t in LEDGERS:
            house = reads.db.house_id(t)
            if (sheet.sid == hub_db and sheet.tab == t) or (house and sheet.sid == house
                                                             and sheet.tab in (t, hubdb.HOUSE_DATA_TAB)):
                hit = t
                break
    if not hit:
        return None
    return {"status": 403, "message": hit + " is a ledger — only the engine that sends writes it. A row typed here "
                                            "would silence or re-arm a real reminder with no trace, so this tab is "
                                            "read-only on this screen."}


def _size(reads: L.Reads, sheet: Sheet) -> tuple[int, int]:
    if sheet.resource:
        return len(RR.read_all(reads, sheet.resource)), len(RR.columns(reads, sheet.resource))
    if sheet.ref is None:
        return 0, 0
    return int(getattr(sheet.ref, "row_count", 0) or 0), len([h for h in sheet.ref.headers if h != ""])


def sheet_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """renderSheetList: every tab served, its size, and whether this caller may edit."""
    if not writer(sess.user):
        return dict(DENIED)
    reads = sess.reads
    tabs = []

    def listed(key: str, label: str, source: str) -> None:
        rows = cols = 0
        alive = read_only = False
        try:
            got = resolve(reads, key)
            if isinstance(got, Sheet) and got.alive():
                rows, cols = _size(reads, got)
                alive = True
                read_only = ledger_refusal(reads, key, got) is not None
        except (Defer, hubdb.Unreadable):
            alive = False
        tabs.append({"key": key, "tab": label, "source": source, "rows": rows, "cols": cols, "alive": alive,
                     "read_only": read_only})

    for name in TABS:
        listed(name, name, "hub")
    for e in ESTATE:
        listed(e["key"], e["title"] + (" - " + e["tab"] if e["tab"] else ""), "linked")
    out: dict[str, Any] = {"tabs": tabs, "can_edit": can_edit(reads, sess.user)}
    try:
        for r in registry(reads):
            listed("lnk_" + s_(r.get("id")), s_(r.get("title")) + (" - " + s_(r.get("tab_name"))
                                                                     if s_(r.get("tab_name")) else ""), "linked")
    except (Defer, hubdb.Unreadable):
        out["registry_unread"] = True
    return {"status": 200, "data": out}


def sheet_grid(sess: L.Session, payload: dict) -> dict[str, Any]:
    """renderSheetGrid: the tab's header and rows as shown (at most 1000), no colours (the copies keep none)."""
    if not writer(sess.user):
        return dict(DENIED)
    name = s_((payload or {}).get("tab")) if isinstance(payload, dict) else ""
    got = resolve(sess.reads, name)
    if isinstance(got, dict):
        return got
    if not got.alive():
        return {"status": 200, "data": {"tab": name, "header": [], "rows": [], "truncated": False}}
    header, body, _keys = grid_of(sess.reads, got)
    truncated = len(body) > MAX_ROWS
    return {"status": 200, "data": {"tab": name, "header": header, "rows": body[:MAX_ROWS], "truncated": truncated,
                                    "colors": {"back": [], "fore": [], "bold": []}, "frozen": 1}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"renderSheetList": sheet_list,
                                                                    "renderSheetGrid": sheet_grid}
POLICY: dict[str, dict[str, Any]] = {a: {"roles": ("admin", "manager")} for a in ACTIONS}
