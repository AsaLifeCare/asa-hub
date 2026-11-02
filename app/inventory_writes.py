"""The Inventory's entry by hand (Inventory.gs inventorySupplyAdd) kept in Postgres alone: a supply document's row in
`inventorySuppliesManual` (app/resource_rows.py), its image or PDF kept on the server (documents/inventory,
app.inventory_files), never filed in Drive. inventoryUpload brings the inventory_supplies_manual tab into Postgres as
the app is given to Python."""
from __future__ import annotations

import base64
import binascii
import math
import re
import uuid
from typing import Any, Callable

import admin_docs as AD
import call_offs_writes as COW
import candidates as CND
import gsjs
import inventory as IV
import locations as L
import resource_rows as RR
import sheet_resources as SR
import smart_comms as SC
import staff_views
import writes as W
from scope import Defer
from writes import Decision

BUSY = "Somebody else is saving right now — try again."
# images and PDFs, ~15MB decoded (the base64 carries 4/3 of the bytes)
B64_MAX = 21000000
_OK_EXT = re.compile(r"\.(png|jpe?g|webp|gif|heic|pdf)$", re.I)

s_ = gsjs.str_


def _owned(reads: L.Reads) -> None:
    if not RR.uploaded(reads.db, IV.MANUAL):
        raise Defer(f"{IV.MANUAL} is not uploaded to Postgres yet")


def _keep_file(user: dict, b64: str, fname: str, mime: str, category: str) -> tuple[str, Decision | None]:
    """The document's file kept on the server under its category (Supplies Docs/<category>), its row in
    app.inventory_files: the link the entry names, or the refusal."""
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError):
        return "", W.refuse(400, "The file could not be read.")
    if not data:
        return "", W.refuse(400, "The file is empty.")
    fid = "inv_" + uuid.uuid4().hex
    rel = f"supplies/{AD.safe_name(category)}/{fid}/{AD.safe_name(fname)}"
    target = IV.base() / rel
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + ".part")
        tmp.write_bytes(data)
        tmp.replace(target)
    except OSError as exc:
        return "", W.refuse(409, f"The server's documents folder is not writable ({type(exc).__name__}).")
    RR._cur().execute(f"insert into {IV.FILES} (id, name, mime, size_bytes, path, category, by_email, write_id)"
                      " values (%s, %s, %s, %s, %s, %s, %s, %s)",
                      (fid, fname, mime or "application/octet-stream", len(data), rel, category,
                       s_(user.get("email")).lower(), SC.write_id()))
    return IV.KEPT + fid, None


def supply_add(sess: L.Session, payload: dict) -> Decision:
    """inventorySupplyAdd: a supply document entered by hand — its name required, its amount a number when given —
    with an image or PDF kept on the server when one is attached."""
    user = sess.user or {}
    if not IV.may_use(user):
        return Decision(dict(IV.DENIED))
    reads = sess.reads
    _owned(reads)
    p = payload if isinstance(payload, dict) else {}
    name = s_(p.get("name"))
    if not name:
        return W.refuse(400, "A name is required.")
    vendor = s_(p.get("vendor"))
    category = s_(p.get("category")) or "General"
    kind = s_(p.get("kind")) or "Manual entry"
    invoice_no = s_(p.get("invoice_no"))
    amount = None if s_(p.get("amount")) == "" else CND.js_number(p.get("amount"))
    if amount is not None and (not math.isfinite(amount) or amount < 0):
        return W.refuse(400, "The amount must be a number.")
    doc_date = s_(p.get("doc_date"))
    link = ""
    b64 = gsjs.or_text(p.get("base64"))
    if b64:
        fname = s_(p.get("filename")) or "document"
        mime = s_(p.get("mime")).lower()
        if not (mime.startswith("image/") or mime == "application/pdf") and not _OK_EXT.search(fname):
            return W.refuse(400, "Images and PDFs only.")
        if len(b64) > B64_MAX:
            return W.refuse(400, "The file is too large — up to 15MB.")
        link, refused = _keep_file(user, b64, fname, mime, category)
        if refused is not None:
            return refused
    at = W.now_iso(reads)
    rid = W.mint()
    email = s_(user.get("email"))
    row = {"id": rid, "name": name, "vendor": vendor, "category": category, "kind": kind, "invoice_no": invoice_no,
           "amount": "" if amount is None else amount, "doc_date": doc_date, "link": link, "by": email, "at": at}
    RR.create(reads, IV.MANUAL, {h: COW.serialize(row[h]) for h in IV.MANUAL_HEADER}, email)
    staff_views.record(user, "inventorySupplyAdd", name)
    return Decision({"status": 200, "data": {
        "id": rid, "name": name, "vendor": vendor, "category": category, "kind": kind, "invoice_no": invoice_no,
        "amount": amount, "doc_date": doc_date, "link": link, "by": email, "at": at, "updated_at": at}},
        subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "inventorySupplyAdd": supply_add,
    "inventoryUpload": RR.upload_door({IV.MANUAL: SR.SPECS.get(IV.MANUAL) or {"tab": IV.MANUAL_TAB}})}
POLICY: dict[str, dict[str, Any]] = {"inventorySupplyAdd": {"roles": ("admin", "manager")}, "inventoryUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.inventory_writes and _receipts; the entries app.resource_rows', their files app.inventory_files'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="inventory", label="Inventory")
