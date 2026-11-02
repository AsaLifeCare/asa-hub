"""The Inventory (Inventory.gs) on Python behind its switch (`inventory`), admins' and managers' alone: each house's
medication stock as the pharmacy's dispensing reports record it (the relay's own record, read where it lives and handed
in), and the supplies — the invoice and purchase documents in the company's Finances folder in Drive, grouped by the
folder they sit in (metadata only, read as asatech), with the documents entered by hand: their rows in Postgres
(`inventorySuppliesManual`, uploaded from the inventory_supplies_manual tab) and their files on the server
(documents/inventory, app.inventory_files). inventoryPharmacy, inventorySupplies and inventorySupplyFile are here; an
entry by hand is in app/inventory_writes.py."""
from __future__ import annotations

import base64
import re
import time
from pathlib import Path
from typing import Any, Callable

import candidates as CND
import gsjs
import hubdb
import location_docs as LD
import locations as L
import resource_rows as RR
import smart_comms as SC
import staff_views
from scope import Defer

APP_ID = "inventory"
MANUAL, MANUAL_TAB = "inventorySuppliesManual", "inventory_supplies_manual"
MANUAL_HEADER = ("id", "name", "vendor", "category", "kind", "invoice_no", "amount", "doc_date", "link", "by", "at")
FILES = "app.inventory_files"
APP_DIR = "inventory"
# what a kept document's link says: the platform's own copy, read through inventorySupplyFile
KEPT = "hubfile:inventory/"
ROOT_PROP = "SUPPLIES_DRIVE_ROOT_ID"
# under the relay's wait for this read (BACKEND_LONG_READS) and the screen's 60 s (InventorySuppliesPage.tsx)
WALK_S = 40.0
ITEMS_MAX = 500
MISSED_MAX = 50
# a whole walk held six hours, a partial one half an hour (the script cache's inv_supplies_v2)
COMPLETE_TTL_S, PARTIAL_TTL_S = 21600.0, 1800.0
NOT_SHARED = ("The Finances folder is not shared with the platform account yet — share it and this screen fills "
              "itself.")
NO_FILE = "No such document."
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
_AMOUNT = re.compile(r"\$?\s?([0-9][0-9,]*\.[0-9]{2})", re.A)
_DATE = re.compile(r"(\d{4}[._-]\d{1,2}[._-]\d{1,2})|(\d{1,2}[._/]\d{1,2}[._/]\d{2,4})", re.A)

# the Finances folder's last walk, by folder: (good until, walk)
_WALKS: dict[str, tuple[float, dict[str, Any]]] = {}

s_ = gsjs.str_


def base() -> Path:
    return LD.ROOT / APP_DIR


def may_use(user: dict | None) -> bool:
    u = user or {}
    return bool(u) and not u.get("is_service") and gsjs.js_str(u.get("role")) in ("admin", "manager")


def _js_keys(d: dict) -> list[str]:
    """Object.keys order: array-index keys ascending first, then the rest as written."""
    idx = sorted((k for k in d if re.fullmatch(r"0|[1-9][0-9]{0,9}", k) and int(k) < 4294967295), key=int)
    return idx + [k for k in d if k not in idx]


def pharmacy(sess: L.Session, payload: dict) -> dict[str, Any]:
    """inventoryPharmacy: the medication stock per house, derived from the pharmacy's dispensing reports — the relay's
    own record (its /inventory/meds reading), read where it lives and handed in as `relayed`; a browser's payload
    never carries it. The stock remaining is the pharmacy's own column, never a local decrement."""
    if not may_use(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    if "relayed" not in p:
        raise Defer("the pharmacy record is read by the relay where it lives and handed in")
    r = p.get("relayed")
    if not isinstance(r, dict) or r.get("status") != 200:
        said = (gsjs.js_str(r.get("message")) if "message" in r else "undefined") if isinstance(r, dict) else "null"
        return {"status": 502, "message": "The pharmacy record did not answer: " + SC._cut16(said, 120)}
    data = r.get("data")
    return {"status": 200, "data": {"houses": []} if gsjs.falsy(data) else data}


def manual_rows(reads: L.Reads) -> list[dict[str, Any]]:
    """invSuppliesManualRows_: the documents entered by hand, as readTabNormalized_ names their columns."""
    out = []
    for got in RR.read_all(reads, MANUAL):
        r = {hubdb.norm_key(k): v for k, v in got.items()}
        amount = None if s_(r.get("amount")) == "" else CND.js_number(r.get("amount"))
        if amount is not None and amount != amount:
            amount = None
        out.append({"id": s_(r.get("id")), "name": s_(r.get("name")), "vendor": s_(r.get("vendor")),
                    "category": s_(r.get("category")) or "General", "kind": s_(r.get("kind")) or "Manual entry",
                    "invoice_no": s_(r.get("invoiceno")), "amount": amount, "doc_date": s_(r.get("docdate")),
                    "link": s_(r.get("link")), "updated_at": s_(r.get("at"))})
    return out


def _walk(drv: Any, root: str) -> dict[str, Any]:
    """The Finances folder's documents: the root's own under General, then each subfolder's under its name. Every
    folder is walked (a partial total lies); the deadline is checked before a folder opens, never inside one."""
    items: list[dict[str, Any]] = []
    cats: dict[str, dict[str, Any]] = {}
    total = [0.0]

    def walk(folder: str, cat: str) -> None:
        for f in drv.children(folder, False, "id,name,modifiedTime,webViewLink"):
            name = gsjs.or_blank(f.get("name"))
            amt = _AMOUNT.search(name)
            amount = float(amt.group(1).replace(",", "")) if amt else None
            dt = _DATE.search(name)
            updated = s_(f.get("modifiedTime"))
            if amount:
                total[0] += amount
            c = cats.setdefault(cat, {"category": cat, "count": 0, "spend": 0, "last": ""})
            c["count"] += 1
            if amount:
                c["spend"] += amount
            if updated > c["last"]:
                c["last"] = updated
            if len(items) < ITEMS_MAX:
                items.append({"id": s_(f.get("id")), "name": name, "vendor": "", "category": cat, "kind": "Document",
                              "invoice_no": "", "amount": amount, "doc_date": dt.group(0) if dt else "",
                              "link": s_(f.get("webViewLink")), "updated_at": updated})

    walk(root, "General")
    deadline = time.monotonic() + WALK_S
    seen = walked = 0
    missed: list[str] = []
    for sub in drv.children(root, True, "id,name"):
        seen += 1
        if time.monotonic() > deadline:
            if len(missed) < MISSED_MAX:
                missed.append(gsjs.or_blank(sub.get("name")))
            continue
        walked += 1
        walk(s_(sub.get("id")), gsjs.or_blank(sub.get("name")))
    return {"items": items, "cats": cats, "total": total[0], "seen": seen, "walked": walked, "missed": missed}


def _finances(reads: L.Reads) -> dict[str, Any] | None:
    """The Finances folder's walk, held as the script cache held it; None when the folder cannot be opened."""
    root = s_(reads.db.prop(ROOT_PROP))
    held = _WALKS.get(root)
    if held is not None and time.monotonic() < held[0]:
        return held[1]
    if not root:
        return None
    drv = reads.need_drive()
    try:
        drv.file(root, "id")
    except Exception:  # noqa: BLE001 - getFolderById's catch: a folder not shared, or not there
        return None
    got = _walk(drv, root)
    complete = got["seen"] == got["walked"]
    if not complete:
        missing = got["seen"] - got["walked"]
        staff_views.record({"email": "inventory"}, "supplies_walk_incomplete",
                           f"{missing} of {got['seen']} Finances subfolder(s) went unread: "
                           + ", ".join(got["missed"][:8]))
    _WALKS[root] = (time.monotonic() + (COMPLETE_TTL_S if complete else PARTIAL_TTL_S), got)
    return got


def supplies(sess: L.Session, payload: dict) -> dict[str, Any]:
    """inventorySupplies: the documents in the company's own Finances folder, grouped by the folder they sit in, with
    the ones entered by hand; the folder's walk held (six hours whole, half an hour partial), the entries read as they
    stand."""
    if not may_use(sess.user):
        return dict(DENIED)
    reads = sess.reads
    manual = manual_rows(reads)
    got = _finances(reads)
    if got is None:
        return {"status": 503, "message": NOT_SHARED}
    items = [dict(i) for i in got["items"]]
    cats = {k: dict(v) for k, v in got["cats"].items()}
    total = got["total"]
    for m in manual:
        if m["amount"]:
            total += m["amount"]
        mc = cats.setdefault(m["category"], {"category": m["category"], "count": 0, "spend": 0, "last": ""})
        mc["count"] += 1
        if m["amount"]:
            mc["spend"] += m["amount"]
        if m["updated_at"] > mc["last"]:
            mc["last"] = m["updated_at"]
        items.append(m)
    items.sort(key=lambda i: i["updated_at"], reverse=True)
    return {"status": 200, "data": {
        "items": items, "categories": sorted((cats[k] for k in _js_keys(cats)), key=lambda c: -c["count"]),
        "vendors": [], "purchase_count": len(items), "total_spend": gsjs.js_round(total * 100) / 100,
        "folders_seen": got["seen"], "folders_walked": got["walked"], "not_walked": got["seen"] - got["walked"],
        "not_walked_names": list(got["missed"]), "complete": got["seen"] == got["walked"]}}


def supply_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """A document entered by hand, its file's bytes off the server's copy for the platform's viewer: the link its row
    names (hubfile:inventory/<id>) where Apps Script's row named a Drive file."""
    if not may_use(sess.user):
        return dict(DENIED)
    url = s_((payload or {}).get("url")) if isinstance(payload, dict) else ""
    fid = url[len(KEPT):] if url.startswith(KEPT) else ""
    if not fid:
        return {"status": 400, "message": "url: a supply document kept by the platform."}
    got = RR._q(sess.reads, f"select name, mime, path from {FILES} where id = %s", (fid,))
    if not got:
        return {"status": 404, "message": NO_FILE}
    name, mime, rel = got[0]
    try:
        data = (base() / s_(rel)).read_bytes()
    except OSError:
        return {"status": 503, "message": "The kept copy could not be read from the server's disk just now."}
    return {"status": 200, "data": {"name": s_(name), "mime": s_(mime) or "application/octet-stream",
                                    "size": len(data), "b64": base64.b64encode(data).decode("ascii")}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "inventoryPharmacy": pharmacy, "inventorySupplies": supplies, "inventorySupplyFile": supply_file}
POLICY: dict[str, dict[str, Any]] = {a: {"roles": ("admin", "manager")} for a in ACTIONS}
