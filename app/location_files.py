"""Locations › Documents' Drive doors (apps-script/Locations.gs locationDocUpload, locationDocLink, locationDocRemove):
their Drive half, done by the read the relay asks before each write (BACKEND_WRITE_PREPARE), as the platform's
account — a file filed in the house's own folder of the houses room (made there when there is none), a Drive document
copied into it, one of the house's own moved to the room's "Removed from Locations" — and the server's copy
(app/location_docs.py's folder and index) brought level with it. The writes that answer them are in
app/location_files_writes.py."""
from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

import cert_docs as CD
import drive as dr
import gsjs
import location_docs as LD
import locations as L
import writes as W
from gsjs import text
from scope import Defer

log = logging.getLogger("asa-hub-app")

DOC_REMOVED_FOLDER = "Removed from Locations"
# LOCATION_DOC_OFFICE_TYPES
OFFICE_TYPES = {"doc": "application/msword",
                "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "xls": "application/vnd.ms-excel",
                "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "ppt": "application/vnd.ms-powerpoint",
                "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}
DOC_TYPE_WORDS = "A PDF, a picture (PNG, JPEG, GIF, WebP or HEIC), or a Word, Excel or PowerPoint file."
B64_MAX = 21000000
# locationsLock_'s wait: one house document's Drive work at a time
LOCK_WAIT_S = 20.0
KEEP_WAIT_S = 10.0
_DRIVE_ID = re.compile(r"[A-Za-z0-9_-]{10,}")
_BARE_ID = re.compile(r"[A-Za-z0-9_-]{20,}")
_REFUSED_404 = re.compile(r"not found|no item|does not exist|access|permission", re.I)
_lock = threading.Lock()

s_ = gsjs.str_


def doc_type(name: Any, mime: Any) -> str:
    """locationsDocType_: an image or a PDF (the certificate door's), or an Office file; '' for anything else."""
    t = CD.file_type(name, mime)
    if t:
        return t
    m = re.search(r"\.([A-Za-z0-9]{1,5})\Z", gsjs.trim(gsjs.or_text(name)))
    office = OFFICE_TYPES.get(m.group(1).lower(), "") if m else ""
    if not office:
        return ""
    sent = gsjs.trim(gsjs.or_text(mime).lower().split(";")[0])
    return office if not sent or sent == "application/octet-stream" or sent == office else ""


def upload_checks(payload: dict) -> tuple[dict | None, str, str, str]:
    """locationDocUpload's refusals before Drive: (refusal, file name, type, base64)."""
    f = payload.get("file") if isinstance(payload.get("file"), dict) else {}
    fname = text(f.get("name") or f.get("filename"), 180)
    mime = doc_type(fname, f.get("mime") or f.get("type"))
    if not mime:
        return {"status": 400, "message": DOC_TYPE_WORDS + " Nothing was filed."}, fname, "", ""
    b64 = re.sub(r"^data:[^,]*,", "", gsjs.or_text(f.get("b64") or f.get("base64")))
    if not b64:
        return {"status": 400, "message": "The file is required."}, fname, mime, ""
    if len(b64) > B64_MAX:
        return {"status": 400, "message": "The file is too large — up to 15MB."}, fname, mime, ""
    return None, fname, mime, b64


def link_checks(payload: dict) -> tuple[dict | None, str]:
    """locationDocLink's refusals before Drive: (refusal, the document's Drive id)."""
    url = gsjs.trim(gsjs.or_text(payload.get("url")))[:500]
    if "/folders/" in url:
        return {"status": 400, "message": "That link is a folder; a document is one file."}, ""
    fid = L.drive_id(url) or (url if _BARE_ID.fullmatch(url) else "")
    if not fid:
        return {"status": 400, "message": "url: a Google Drive link to the document."}, ""
    return None, fid


def remove_checks(payload: dict) -> tuple[dict | None, str]:
    """locationDocRemove's refusal before Drive: (refusal, the file id)."""
    fid = text(payload.get("id"), 120)
    if not _DRIVE_ID.fullmatch(fid):
        return {"status": 400, "message": "id: a Drive file id."}, ""
    return None, fid


def _said(e: BaseException) -> str:
    """What Drive said of a refusal: its message and reason, else the exception's own words."""
    if isinstance(e, urllib.error.HTTPError):
        try:
            err = json.loads(e.read(4096) or b"{}").get("error") or {}
            reason = str(((err.get("errors") or [{}])[0] or {}).get("reason") or "")
            return f"{err.get('message') or e.reason} ({e.code}{', ' + reason if reason else ''})"
        except Exception:  # noqa: BLE001 - no body is the status line
            return f"{e.reason} ({e.code})"
    return str(e) or type(e).__name__


def drive_refusal(e: BaseException, doing: str) -> dict[str, Any]:
    """locationsDriveRefusal_."""
    said = _said(e)
    if _REFUSED_404.search(said):
        return {"status": 404, "message": "The platform cannot open that document — check the link, or share it with "
                                          "the platform account."}
    return {"status": 503, "message": f"{doing} did not finish just now ({said[:120]}). Try again."}


def _opened(drv: Any, file_id: str) -> dict[str, Any]:
    """DriveApp.getFileById: the file's name, type and bin; Drive refusing every credential is its own refusal."""
    try:
        return drv.file_meta(file_id, "id,name,mimeType,trashed,parents")
    except Defer as e:
        if re.search(r"refused the credentials \((403|404)", str(e)):
            raise PermissionError("access denied") from e
        raise


def _create_folder(drv: Any, parent_id: str, name: str) -> str:
    """folder.createFolder(name): a new folder under the parent as the platform's account; its id."""
    auth = drv._owner_write("a folder is made in Drive")
    req = urllib.request.Request(f"{dr.API}?supportsAllDrives=true&fields=id",
                                 data=json.dumps({"name": name, "mimeType": dr.FOLDER_MIME,
                                                  "parents": [parent_id]}).encode(),
                                 headers={**auth, "Content-Type": "application/json"}, method="POST")
    made = str(drv._send(req).get("id") or "")
    if not made:
        raise ValueError("Drive named no folder for " + name)
    return made


def _move(drv: Any, file_id: str, parents: list[str], folder_id: str) -> None:
    """file.moveTo(folder): out of every folder it was in, into this one; never only added to it."""
    if not [p for p in parents if p]:
        raise ValueError("Drive named no folder the document is in")
    auth = drv._owner_write("a file is moved in Drive")
    q = urllib.parse.urlencode({"addParents": folder_id,
                                "removeParents": ",".join(p for p in parents if p != folder_id),
                                "supportsAllDrives": "true", "fields": "id"})
    req = urllib.request.Request(f"{dr.API}/{urllib.parse.quote(file_id)}?{q}", data=b"{}",
                                 headers={**auth, "Content-Type": "application/json"}, method="PATCH")
    drv._send(req)


def house_folder(reads: L.Reads, drv: Any, ctx: dict, make: bool) -> dict[str, Any]:
    """locationsHouseFolder_: the house's own folder in the houses room (the guidebook walk's), made there when `make`
    and none names the house."""
    try:
        found = drv.guidebook(reads, ctx["code"])
    except Defer:
        raise
    except Exception as e:  # noqa: BLE001 - the door's own sentence
        return {"refused": {"status": 503,
                            "message": f"The houses room could not be read just now ({_said(e)[:120]})."}}
    try:
        gb = found.get("guidebook")
        if gb:
            return {"folder_id": gb["folder_id"], "files": gb.get("files") or []}
        if not make:
            return {"refused": {"status": 404, "message": f"No folder in the houses room names {ctx['code']}."},
                    "files": []}
        room = drv.houses_room(reads)
        if not room.get("folder"):
            return {"refused": {"status": 503, "message": room.get("reason") or ""}}
        title = text((ctx.get("home") or {}).get("home_name")) or ctx["code"]
        name = title if L.code_of(title) == ctx["code"] else f"{title} - {ctx['code']}"
        return {"folder_id": _create_folder(drv, room["id"], name), "files": [], "made": True}
    except Defer:
        raise
    except Exception as e:  # noqa: BLE001 - Drive's word, as the door says it
        return {"refused": drive_refusal(e, "Opening the house's folder")}


def door(sess: L.Session, payload: dict) -> tuple[dict | None, dict | None]:
    """locationsEditDoor_ for the documents edition: (the house, None) or (None, its refusal)."""
    got = W.edit_door(sess, payload, L.EDITION["documents"])
    if got.get("refused"):
        env = got["refused"]
        if env.get("status") == 503:
            raise Defer(str(env.get("message") or "the house could not be read")[:160])
        return None, env
    return got["ctx"], None


def keep(code: str, file_id: str, name: str, mime: str, exported: bool, data: bytes) -> bool:
    """The server's copy of a document just filed in the house's folder (location_docs' folder and index), so the
    viewer opens it from disk at once; one not kept here is copied by location_docs' next pass."""
    if LD.problem() or not LD._lock.acquire(timeout=KEEP_WAIT_S):
        return False
    try:
        idx = dict(LD.index())
        rel = LD._place(f"{code}/guidebook", LD._file_name(name, mime, file_id), file_id, idx)
        target = LD.ROOT / LD.APP_DIR / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + ".part")
        tmp.write_bytes(data)
        os.replace(tmp, target)
        now = time.time()
        idx[file_id] = {"path": rel, "name": name, "mime": mime, "exported": exported, "size": len(data),
                        "modified": "", "saved_at": now, "checked_at": now, "kind": "guidebook", "house": code}
        LD._write_index(idx)
        return True
    except OSError as exc:
        log.warning("location files: %s not kept on the server (%s)", file_id, type(exc).__name__)
        return False
    finally:
        LD._lock.release()


def unkeep(file_id: str) -> bool:
    """A document moved out of the house: the server's copy stays on the disk, no longer the house's to show."""
    if LD.problem() or not LD._lock.acquire(timeout=KEEP_WAIT_S):
        return False
    try:
        idx = dict(LD.index())
        hit = idx.get(file_id)
        if not isinstance(hit, dict) or not hit.get("kind"):
            return False
        idx[file_id] = {**{k: v for k, v in hit.items() if k not in ("kind", "house", "client", "client_key", "title")},
                        "removed_at": time.time()}
        LD._write_index(idx)
        return True
    except OSError as exc:
        log.warning("location files: %s still shown from the server (%s)", file_id, type(exc).__name__)
        return False
    finally:
        LD._lock.release()


def _held() -> bool:
    return _lock.acquire(timeout=LOCK_WAIT_S)


def upload_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """locationDocUpload's Drive half: the file filed in the house's own folder (made in the houses room when there
    is none) as the platform's account, and kept on the server; the write then answers it."""
    p = payload if isinstance(payload, dict) else {}
    ctx, refused = door(sess, p)
    if refused:
        return refused
    refused, fname, mime, b64 = upload_checks(p)
    if refused:
        return refused
    if not _held():
        return {"status": 409, "message": W.BUSY}
    try:
        try:
            data = base64.b64decode(b64, validate=False)
        except (binascii.Error, ValueError):
            return {"status": 400, "message": "The file could not be read as sent. Nothing was filed."}
        if not data:
            return {"status": 400, "message": "The file is empty."}
        drv = sess.reads.need_drive()
        found = house_folder(sess.reads, drv, ctx, True)
        if found.get("refused"):
            return found["refused"]
        try:
            filed = drv.upload_into(found["folder_id"], fname or "House document", mime, data)
        except Defer:
            raise
        except Exception as e:  # noqa: BLE001 - Drive's word, as the door says it
            return drive_refusal(e, "Filing the document")
    finally:
        _lock.release()
    fid = s_(filed.get("id"))
    added = {"id": fid, "name": s_(filed.get("name")) or fname or "House document",
             "folder_made": found.get("made") is True}
    shown = L.shown_type(mime, added["name"])
    kept = keep(ctx["code"], fid, added["name"], shown, False, data) if shown else False
    return {"status": 200, "data": {"house": ctx["code"], "added": added, "kept": kept}}


def link_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """locationDocLink's Drive half: a copy of the linked document filed in the house's own folder as the platform's
    account (the original stays where it is), and kept on the server; the write then answers it."""
    p = payload if isinstance(payload, dict) else {}
    ctx, refused = door(sess, p)
    if refused:
        return refused
    refused, src_id = link_checks(p)
    if refused:
        return refused
    if not _held():
        return {"status": 409, "message": W.BUSY}
    try:
        drv = sess.reads.need_drive()
        try:
            src = _opened(drv, src_id)
            if src.get("trashed"):
                return {"status": 404, "message": "That document is in the trash."}
        except Defer:
            raise
        except Exception as e:  # noqa: BLE001 - Drive's word, as the door says it
            return drive_refusal(e, "Opening the document")
        found = house_folder(sess.reads, drv, ctx, True)
        if found.get("refused"):
            return found["refused"]
        name = gsjs.or_blank(src.get("name"))[:200]
        try:
            copy_id = drv.copy_into(src_id, found["folder_id"], name)
            if not copy_id:
                raise ValueError("Drive named no copy")
        except Defer:
            raise
        except Exception as e:  # noqa: BLE001 - Drive's word, as the door says it
            return drive_refusal(e, "Copying the document")
    finally:
        _lock.release()
    added = {"id": copy_id, "name": name, "folder_made": found.get("made") is True}
    kept = False
    if s_(src.get("mimeType")) not in L.OFFICE_TO_GOOGLE:
        try:
            got = L.doc_bytes(sess.reads, copy_id)
            if not got.get("refused"):
                kept = keep(ctx["code"], copy_id, got["name"] or name, got["mime"], got["exported"],
                            base64.b64decode(got["b64"]))
        except Exception as exc:  # noqa: BLE001 - location_docs' next pass copies it
            log.info("location files: the copy %s not kept on the server now (%s)", copy_id, type(exc).__name__)
    return {"status": 200, "data": {"house": ctx["code"], "added": added, "kept": kept}}


def remove_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """locationDocRemove's Drive half: one of the house's own documents moved to the houses room's "Removed from
    Locations" (put back by hand from there); a client's ISP and a company document are never removed here."""
    p = payload if isinstance(payload, dict) else {}
    ctx, refused = door(sess, p)
    if refused:
        return refused
    refused, fid = remove_checks(p)
    if refused:
        return refused
    if not _held():
        return {"status": 409, "message": W.BUSY}
    try:
        reads = sess.reads
        drv = reads.need_drive()
        found = house_folder(reads, drv, ctx, False)
        if found.get("refused") and found["refused"].get("status") == 503:
            return found["refused"]
        if not any(f.get("id") == fid for f in found.get("files") or []):
            docs = L.documents_part(reads, ctx)
            if any(d.get("isp_doc_id") == fid for d in docs.get("isps") or []):
                return {"status": 409, "message": "An ISP is the client's own plan; it changes in Clients and is never "
                                                  "removed from a house here."}
            if any(d.get("drive_id") == fid for d in docs.get("policies") or []):
                return {"status": 409, "message": "A company document applies to every location; it changes in Common "
                                                  "Data and is never removed from one house."}
            return {"status": 404, "message": "This house names no such document of its own."}
        room = drv.houses_room(reads)
        if not room.get("folder"):
            return {"status": 503, "message": room.get("reason") or ""}
        try:
            f = _opened(drv, fid)
            removed = {"id": fid, "name": gsjs.or_blank(f.get("name"))}
            _move(drv, fid, [s_(x) for x in f.get("parents") or []], drv.child_folder(room["id"], DOC_REMOVED_FOLDER))
        except Defer:
            raise
        except Exception as e:  # noqa: BLE001 - Drive's word, as the door says it
            return drive_refusal(e, "Moving the document")
    finally:
        _lock.release()
    return {"status": 200, "data": {"house": ctx["code"], "removed": removed, "unkept": unkeep(fid)}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "locationDocUploadPrepare": upload_prepare, "locationDocLinkPrepare": link_prepare,
    "locationDocRemovePrepare": remove_prepare}
# the relay's own reads before the writes: the writes' roles and the house
_ROLES = ("admin", "manager", "staff")
POLICY: dict[str, dict[str, Any]] = {
    "locationDocUploadPrepare": {"roles": _ROLES, "params": {"house": "string"}},
    "locationDocLinkPrepare": {"roles": _ROLES, "params": {"house": "string", "url": "string"}},
    "locationDocRemovePrepare": {"roles": _ROLES, "params": {"house": "string", "id": "string"}}}
