"""The Administration workspace on Python (AdminDocs.gs): its documents kept on the server, in the project's documents
folder, and listed from Postgres (app.admin_docs, db/admin_docs.sql) — a screen never reads them from Drive.

    <root>/administration/drive/<file id>/<name>     a file brought in from the Administration Drive folder: a Google
                                                     file as its Office export (Docs .docx, Sheets .xlsx, Slides .pptx)
                                                     with its PDF beside it for the viewer, any other file as itself
    <root>/administration/uploads/<doc id>/<name>    a file uploaded here; it never goes to Drive

adminDocsFetch is the relay's own read, on its clock while the app is Python's: what is new or changed in the Drive
folder is brought onto the disk, a few files a pass, and adminDocsKeep (admin_docs_writes) records it; a file deleted
here is never brought back. A Google file Drive cannot export (a form) is listed with its Drive link and nothing kept.
adminDocFile hands a kept document, or its PDF, to the platform's viewer."""
from __future__ import annotations

import base64
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import drive as dr
import gsjs
import location_docs as LD
import locations as L
import resource_rows as RR
from scope import Defer

APP_ID = "administration"
TABLE = "app.admin_docs"
CHANGES = "app.admin_doc_changes"
APP_DIR = "administration"
FETCHED = ".fetched"
FOLDER_PROP = "ADMIN_DOCS_FOLDER_ID"
FOLDER_NAME = "Administration"
MAX_BYTES = 25 * 1024 * 1024
# the relay waits HUB_APP_PACK_TIMEOUT_S for a pass; what is left is brought on the next one
FETCH_BUDGET_S = float(os.getenv("HUB_ADMIN_DOCS_FETCH_BUDGET_S", "25"))
PDF = "application/pdf"
EXPORTS = {
    "application/vnd.google-apps.document": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                             "docx"),
    "application/vnd.google-apps.spreadsheet": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                                "xlsx"),
    "application/vnd.google-apps.presentation": (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"),
    "application/vnd.google-apps.drawing": (PDF, "pdf"),
}
# shown by the viewer as themselves
VIEWABLE = re.compile(r"^(application/pdf|image/(png|jpeg|gif|webp)|text/plain)$")
COLUMNS = ("id", "name", "mime", "size_bytes", "modified_time", "path", "view_path", "view_mime", "source", "google_id",
           "google_mime", "google_modified", "google_link", "created_by", "trashed_at")
NO_FILE = "No such file — or the platform cannot see it."
_UNSAFE = re.compile(r"[^A-Za-z0-9 ._()\-]+")

s_ = gsjs.str_


def base() -> Path:
    return LD.ROOT / APP_DIR


def problem() -> str:
    """Why the workspace's folder cannot be written just now; '' when it can."""
    try:
        base().mkdir(parents=True, exist_ok=True)
        probe = base() / ".write-probe"
        probe.write_bytes(b"")
        probe.unlink()
        return ""
    except OSError as exc:
        return f"the server's documents folder is not writable ({type(exc).__name__})"


def safe_name(name: str, ext: str = "") -> str:
    stem = _UNSAFE.sub("_", (name or "document").strip()).strip(" ._") or "document"
    if ext and not stem.lower().endswith("." + ext):
        stem = f"{stem}.{ext}"
    return stem[:150]


def put(rel: str, data: bytes) -> None:
    """One file onto the disk whole, or not at all."""
    target = base() / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, target)


def iso(v: Any) -> str:
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{v.microsecond // 1000:03d}Z"
    return s_(v)


def rows(reads: L.Reads, *, trashed: bool = False) -> list[dict[str, Any]]:
    """The workspace's documents, newest first (the live ones, or every one)."""
    where = "" if trashed else " where trashed_at is null"
    got = RR._q(reads, f"select {', '.join(COLUMNS)} from {TABLE}{where}"
                       " order by modified_time desc nulls last, created_at desc")
    return [dict(zip(COLUMNS, r)) for r in got]


def row(reads: L.Reads, doc_id: str) -> dict[str, Any] | None:
    got = RR._q(reads, f"select {', '.join(COLUMNS)} from {TABLE} where id = %s", (doc_id,))
    return dict(zip(COLUMNS, got[0])) if got else None


def shape(r: dict[str, Any]) -> dict[str, Any]:
    """adminDocsFileShape_ for a kept document: the viewer's own link, never Drive's, when the server holds it."""
    kept = bool(r.get("path"))
    viewable = bool(r.get("view_path")) or (kept and bool(VIEWABLE.match(s_(r.get("mime")))))
    return {"id": s_(r.get("id")), "name": s_(r.get("name")), "mime": s_(r.get("mime")),
            "size_bytes": int(r.get("size_bytes") or 0), "modified_time": iso(r.get("modified_time")),
            "web_view_link": "" if kept else s_(r.get("google_link")), "kept": kept, "viewable": viewable,
            "source": s_(r.get("source"))}


def _gate(user: dict | None) -> dict[str, Any] | None:
    if not user or user.get("is_service") or s_(user.get("role")) not in ("admin", "manager"):
        return {"status": 403, "message": "Requires an admin or manager account"}
    return None


def docs_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """adminDocsList: the workspace's documents, newest first, out of Postgres."""
    denied = _gate(sess.user)
    if denied:
        return denied
    if not (base() / FETCHED).exists():
        raise Defer("the Administration folder has not been brought onto the server yet")
    return {"status": 200, "data": {
        "configured": True, "kept_on_server": True, "folder_id": s_(sess.reads.db.prop(FOLDER_PROP)),
        "folder_name": FOLDER_NAME, "folder_url": "",
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "files": [shape(r) for r in rows(sess.reads)]}}


def download_name(r: dict[str, Any], rel: str) -> str:
    """The document's own name with the extension of the copy handed over."""
    ext = rel.rsplit(".", 1)[-1] if "." in rel.rsplit("/", 1)[-1] else ""
    name = s_(r.get("name")) or "document"
    return name if not ext or name.lower().endswith("." + ext.lower()) else f"{name}.{ext}"


def doc_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """adminDocFile: a kept document's bytes — its PDF for the viewer (`as` view), or the document itself."""
    denied = _gate(sess.user)
    if denied:
        return denied
    p = payload if isinstance(payload, dict) else {}
    fid = s_(p.get("file_id"))
    if not fid:
        return {"status": 400, "message": "file_id is required"}
    r = row(sess.reads, fid)
    if r is None or r.get("trashed_at") is not None:
        return {"status": 404, "message": NO_FILE}
    if not r.get("path"):
        return {"status": 404, "message": "This one is kept in Drive only (a Google form) — open it there."}
    view = s_(p.get("as") or "view") == "view"
    rel = s_(r.get("view_path")) if view and r.get("view_path") else s_(r.get("path"))
    mime = s_(r.get("view_mime")) if view and r.get("view_path") else s_(r.get("mime"))
    try:
        data = (base() / rel).read_bytes()
    except OSError:
        return {"status": 503, "message": "The kept copy could not be read from the server's disk just now."}
    return {"status": 200, "data": {"name": download_name(r, rel), "mime": mime or "application/octet-stream",
                                    "size": len(data), "exported": bool(view and r.get("view_path")), "kept": True,
                                    "b64": base64.b64encode(data).decode("ascii")}}


# ---- the Drive folder brought onto the server ------------------------------------------------------------------

def bring(drv: Any, f: dict[str, Any]) -> dict[str, Any]:
    """One Drive file onto the disk: a Google file as its Office export and its PDF, any other as itself; a file Drive
    cannot export, or one past the size limit, listed with nothing kept."""
    fid, name, gmime = s_(f.get("id")), s_(f.get("name")), s_(f.get("mimeType"))
    item = {"google_id": fid, "name": name, "google_mime": gmime, "google_modified": s_(f.get("modifiedTime")),
            "google_link": s_(f.get("webViewLink")), "mime": gmime, "size_bytes": int(f.get("size") or 0),
            "path": "", "view_path": "", "view_mime": ""}
    folder = f"drive/{fid}"
    if gmime in EXPORTS:
        omime, ext = EXPORTS[gmime]
        data = drv.export(fid, omime, MAX_BYTES)
        if len(data) > MAX_BYTES:
            return item
        rel = f"{folder}/{safe_name(name, ext)}"
        put(rel, data)
        item.update(mime=omime, size_bytes=len(data), path=rel)
        if omime != PDF:
            pdf = drv.export(fid, PDF, MAX_BYTES)
            if len(pdf) <= MAX_BYTES:
                vrel = f"{folder}/{safe_name(name, 'pdf')}"
                put(vrel, pdf)
                item.update(view_path=vrel, view_mime=PDF)
        return item
    if gmime.startswith(dr.GOOGLE_NATIVE) or item["size_bytes"] > MAX_BYTES:
        return item
    data = drv.media(fid, MAX_BYTES)
    if len(data) > MAX_BYTES:
        return item
    rel = f"{folder}/{safe_name(name)}"
    put(rel, data)
    item.update(size_bytes=len(data), path=rel)
    return item


def fetch(sess: L.Session, payload: dict) -> dict[str, Any]:
    """adminDocsFetch (the relay's own): the Drive folder's files new or changed since they were kept brought onto
    the disk, newest first, as many as the pass has time for; a file deleted here is never brought back."""
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "This is the relay's own read."}
    reads = sess.reads
    folder = s_(reads.db.prop(FOLDER_PROP))
    if not folder:
        return {"status": 200, "data": {"configured": False, "items": [], "more": False,
                                        "reason": f"The Administration Drive folder is not configured ({FOLDER_PROP})."}}
    why = problem()
    if why:
        return {"status": 503, "message": why}
    drv = reads.need_drive()
    files = drv.children(folder, False, "id,name,mimeType,modifiedTime,size,webViewLink")
    have = {s_(r["google_id"]): r for r in rows(reads, trashed=True) if r.get("google_id")}
    started = time.monotonic()
    items: list[dict] = []
    left: list[str] = []
    more = False
    for f in sorted(files, key=lambda x: s_(x.get("modifiedTime")), reverse=True):
        had = have.get(s_(f.get("id")))
        if had is not None and had.get("trashed_at") is not None:
            continue
        if had is not None and s_(had.get("google_modified")) == s_(f.get("modifiedTime")) and (
                not had.get("path") or (base() / s_(had["path"])).is_file()):
            continue
        if time.monotonic() - started > FETCH_BUDGET_S:
            more = True
            break
        try:
            items.append(bring(drv, f))
        except (Defer, dr.Gone, OSError, ValueError) as exc:
            left.append(f"{s_(f.get('name'))[:60]} ({type(exc).__name__})")
        except Exception as exc:  # noqa: BLE001 - one file Drive will not hand over never stops the others
            left.append(f"{s_(f.get('name'))[:60]} ({type(exc).__name__})")
    if not more:
        (base() / FETCHED).write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    return {"status": 200, "data": {"configured": True, "listed": len(files), "items": items, "more": more,
                                    "left": left}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "adminDocsList": docs_list, "adminDocFile": doc_file, "adminDocsFetch": fetch}
POLICY: dict[str, dict[str, Any]] = {"adminDocsList": {"roles": ("admin", "manager")},
                                     "adminDocFile": {"roles": ("admin", "manager"), "params": {"file_id": "string"}},
                                     "adminDocsFetch": {}}
