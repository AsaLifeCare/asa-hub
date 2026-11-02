"""A place's own workbook (Tenant.gs tenantEnsure), behind its own `tenant-ensure` switch: the master's alone, in its
own session, wherever it stands. Its Drive half is this read door, run by the relay before the write
(BACKEND_WRITE_PREPARE), outside the platform's write lock as the .gs keeps Drive outside its own: the place's checks,
then a new empty workbook made as asatech and filed in the platform folder's Tenant Workbooks. The pointer is kept by
app/tenant_ensure_writes.py on HQ's tenants tab, where every Python reader of it reads it (studio.tenants_rows, Python's
kept edits laid). The spreadsheet id is a credential: it passes between the relay and Python and never reaches the
screen."""
from __future__ import annotations

import json
import urllib.request
from typing import Any, Callable

import drive as dr
import drive_files as DF
import gsjs
import hubdb
import locations as L
import members as M
import scope as sc
import studio as ST
import writes as W

APP_ID = "tenant-ensure"
ACTION = "tenantEnsure"
# Tenant.gs TENANT_FOLDER_NAME
FOLDER = "Tenant Workbooks"
SHEET_MIME = "application/vnd.google-apps.spreadsheet"
NAME_PREFIX = "ASA Place — "
POINTER = "spreadsheet_id"
UNKNOWN = {"status": 404, "message": "Unknown action."}
NOT_FOUND = {"status": 404, "message": "Not found."}
NO_PLACE = {"status": 400, "message": "tenant_id: which place."}
HQ = {"status": 400, "message": "Headquarters already has the company workbook — it IS the company workbook."}
ARCHIVED = {"status": 409, "message": "That place is archived — restore it before giving it a workbook."}
NOT_MADE = {"status": 503, "message": "The workbook could not be created right now — try again in a moment."}

s_ = gsjs.str_


def gate(sess: L.Session) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """doPost's place and the declared role, then master only, 404 not 403: it changes where every screen in the
    place reads from — the master in its own session, never a visit or the service."""
    refused, ctx = M.stand(sess, ACTION)
    if refused:
        return refused, ctx
    u = ctx["actor"]
    if not u or u.get("is_service") or not sc.is_real_master(u):
        return dict(UNKNOWN), ctx
    return None, ctx


def place(reads: L.Reads, here: str, payload: dict | None) -> tuple[dict | None, dict | None, str]:
    """The checks before any Drive work: (refusal, the place's row, its id)."""
    tid = s_((payload or {}).get("tenant_id")) or here
    if not tid:
        return dict(NO_PLACE), None, ""
    rows = ST.tenants_rows(reads)
    home = ST.tenant_home_from(rows)
    if home and tid == home:
        return dict(HQ), None, tid
    row = next((r for r in rows if s_(r.get("tenantid")) == tid), None)
    if row is None:
        return dict(NOT_FOUND), None, tid
    if s_(row.get("status")) == "archived":
        return dict(ARCHIVED), row, tid
    return None, row, tid


def tenants_ref(reads: L.Reads) -> tuple[str, hubdb.TabRef | None]:
    """The tenants tab where the router opens it, its own table once kept there (house_tables.where): a pointer laid
    there names that book, so writes.into_tables lays it on the table."""
    import house_tables as HT  # noqa: PLC0415 - writes imports this module, and house_tables imports writes

    res = HT.where(reads, ST.TENANTS_TAB)
    if res.runtime or not res.sheet_id or (res.ref is None and not res.book_known):
        raise hubdb.Unreadable("asa-hub-db holds no copy of the book behind the tenants tab")
    return res.sheet_id, res.ref


def pointer_head(ref: hubdb.TabRef | None) -> str | None:
    return W.header_of(ref, "spreadsheetid", norm=True)


def workbook_folder(reads: L.Reads, drv: Any) -> str:
    """filesChildByName_(filesRoot_(), TENANT_FOLDER_NAME): its id, '' when it cannot be had (the workbook then stays
    where Drive made it, as the .gs's moveTo failing leaves it)."""
    try:
        return s_(DF.child(drv, s_(DF.root(reads, drv).get("id")), FOLDER).get("id"))
    except Exception:  # noqa: BLE001 - the .gs's own catch around the move
        return ""


def create_workbook(drv: Any, name: str, parent: str) -> str:
    """SpreadsheetApp.create(name), then moveTo(folder): an empty workbook made as asatech, in the folder when there
    is one; its id."""
    auth = drv._owner_write("a workbook is made in Drive")
    meta: dict[str, Any] = {"name": name, "mimeType": SHEET_MIME}
    if parent:
        meta["parents"] = [parent]
    req = urllib.request.Request(f"{dr.API}?supportsAllDrives=true&fields=id", data=json.dumps(meta).encode(),
                                 headers={**auth, "Content-Type": "application/json"}, method="POST")
    made = s_(drv._send(req).get("id"))
    if not made:
        raise ValueError("Drive named no workbook for the place")
    return made


def discard(reads: L.Reads, made: str) -> None:
    """worldDiscard_: a workbook nobody will point at goes to Drive's bin, never erased."""
    if not made or reads.drive is None:
        return
    try:
        reads.drive.trash(made)
    except Exception:  # noqa: BLE001 - the .gs's own catch
        pass


def prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """tenantEnsure's Drive half: the gate and the place's checks, then — unless the place has a workbook already —
    a new one; {tenant_id, already} or {tenant_id, spreadsheet_id}."""
    refused, ctx = gate(sess)
    if refused:
        return refused
    reads = sess.reads
    refused, row, tid = place(reads, ctx["here"], payload)
    if refused:
        return refused
    if s_((row or {}).get("spreadsheetid")):
        return {"status": 200, "data": {"tenant_id": tid, "already": True}}
    drv = reads.drive
    if drv is None or not drv.available:
        return dict(NOT_MADE)
    folder = workbook_folder(reads, drv)
    try:
        made = create_workbook(drv, NAME_PREFIX + (s_((row or {}).get("name")) or tid), folder)
    except Exception:  # noqa: BLE001 - the .gs's own words for a create that failed (no asatech token, too)
        return dict(NOT_MADE)
    return {"status": 200, "data": {"tenant_id": tid, "spreadsheet_id": made}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"tenantEnsurePrepare": prepare}
# main.policy_gate asks nothing: the door settles the place first and asks its declared role then (members.stand)
POLICY: dict[str, dict[str, Any]] = {"tenantEnsurePrepare": {}}
