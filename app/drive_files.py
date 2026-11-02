"""Files.gs's folder helpers on Python (filesById_, filesRoot_, filesBranch_, filesChildByName_, filesMoveInto_) and
the Drive writes DriveApp made that app/drive.py does not carry (a file moved, a Google Doc written from its words), as
the platform's own account; and the copy of a filed file kept on the server, in the documents folder, beside what it
is and addressed by its Drive id."""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import drive as dr
import gsjs
import location_docs as LD
import locations as L

PINNED_PROP, ROOT_PROP = "HUB_PLATFORM_FOLDER_ID", "HUB_FOLDER_ROOT_ID"
GOOGLE_DOC = "application/vnd.google-apps.document"
FOLDER_FIELDS = "id,name,mimeType,trashed,parents"
_SAFE = re.compile(r"[^A-Za-z0-9 ._()\-]+")
_FILE_ID = re.compile(r"^[A-Za-z0-9_-]{10,}\Z")

s_ = gsjs.str_


def file_url(fid: str) -> str:
    return "https://drive.google.com/file/d/" + fid + "/view"


def folder_url(fid: str) -> str:
    """Folder.getUrl()."""
    return "https://drive.google.com/drive/folders/" + fid


def doc_url(fid: str) -> str:
    """Document.getUrl()."""
    return "https://docs.google.com/document/d/" + fid + "/edit"


def file_id_of(link: Any) -> str:
    """The Drive id a /file/d/ or ?id= link names, '' for any other."""
    m = re.search(r"/d/([-\w]{20,})", s_(link)) or re.search(r"[?&]id=([-\w]{20,})", s_(link))
    return m.group(1) if m else ""


def _quoted(v: str) -> str:
    return v.replace("\\", "\\\\").replace("'", "\\'")


# ---- reading --------------------------------------------------------------------------------------------------------

def folder(drv: Any, fid: Any) -> dict[str, Any] | None:
    """filesById_: the folder, or None when it is in the bin or no folder answers to the id; Drive refusing every
    credential is said, never read as no folder."""
    fid = gsjs.trim(gsjs.or_blank(fid))
    if not fid:
        return None
    try:
        f = drv.file(fid, FOLDER_FIELDS)
    except (dr.Gone, urllib.error.HTTPError):
        return None
    if f.get("trashed") or s_(f.get("mimeType")) != dr.FOLDER_MIME:
        return None
    return f


def file(drv: Any, fid: str, fields: str = "id,name,mimeType,trashed,parents,size,webViewLink") -> dict | None:
    """DriveApp.getFileById: the file, or None when no file answers to the id."""
    if not fid:
        return None
    try:
        return drv.file(fid, fields)
    except (dr.Gone, urllib.error.HTTPError):
        return None


def search(drv: Any, q: str, fields: str = "id,name,mimeType,parents", cap: int = 0) -> list[dict]:
    """DriveApp.searchFiles / getFoldersByName / getFilesByName: what the platform's account can open, page by page."""
    out: list[dict] = []
    page = ""
    while True:
        params: dict[str, Any] = {"q": q, "fields": f"nextPageToken,files({fields})", "pageSize": 1000}
        if page:
            params["pageToken"] = page
        got = drv._get(dr.API, params)
        out.extend(got.get("files") or [])
        page = got.get("nextPageToken") or ""
        if not page or (cap and len(out) >= cap):
            return out[:cap] if cap else out


def named(drv: Any, parent: str, name: str, folders: bool | None = None, fields: str = "id,name,mimeType") -> list:
    """folder.getFilesByName(name) (folders False), getFoldersByName (True), either (None): the live children so
    named."""
    q = f"'{_quoted(parent)}' in parents and trashed = false and name = '{_quoted(name)}'"
    if folders is not None:
        q += f" and mimeType {'=' if folders else '!='} '{dr.FOLDER_MIME}'"
    out: list[dict] = []
    page = ""
    while True:
        params: dict[str, Any] = {"q": q, "fields": f"nextPageToken,files({fields})", "pageSize": 1000,
                                  "includeItemsFromAllDrives": "true"}
        if page:
            params["pageToken"] = page
        got = drv._get(dr.API, params)
        out.extend(got.get("files") or [])
        page = got.get("nextPageToken") or ""
        if not page:
            return out


def root(reads: L.Reads, drv: Any) -> dict[str, Any]:
    """filesRoot_: the pinned platform folder, else the one remembered, else the folder HUB_DB sits in, else My Drive.
    (The property Apps Script stamps on the way is its cache alone: the pinned one is read first all the same.)"""
    for prop in (PINNED_PROP, ROOT_PROP):
        f = folder(drv, reads.db.prop(prop))
        if f is not None:
            return f
    hub = gsjs.trim(gsjs.or_blank(reads.db.prop("HUB_DB_ID")))
    got = file(drv, hub, "id,parents") if hub else None
    parents = (got or {}).get("parents") or []
    f = folder(drv, parents[0]) if parents else None
    if f is not None:
        return f
    return folder(drv, "root") or {"id": "root", "name": "My Drive"}


def branch(reads: L.Reads, drv: Any, name: str, prop: str) -> dict[str, Any]:
    """filesBranch_: the folder the property names, else the root's child of that name, made when there is none."""
    f = folder(drv, reads.db.prop(prop))
    if f is not None:
        return f
    return {"id": drv.child_folder(s_(root(reads, drv).get("id")), name), "name": name}


def branch_if_any(reads: L.Reads, drv: Any, name: str, prop: str) -> dict[str, Any] | None:
    """filesScreenFolderIfAny_: the branch when it exists, never made."""
    f = folder(drv, reads.db.prop(prop))
    if f is not None:
        return f
    hits = named(drv, s_(root(reads, drv).get("id")), name, True)
    return hits[0] if hits else None


def child(drv: Any, parent: str, name: str) -> dict[str, Any]:
    """filesChildByName_: the parent's folder of that name, made when there is none."""
    return {"id": drv.child_folder(parent, name), "name": name}


def in_folder(f: dict, folder_id: str) -> bool:
    """Whether one of the file's parents is the folder."""
    return folder_id in (f.get("parents") or [])


# ---- writing as the platform's account ------------------------------------------------------------------------------

def move(drv: Any, f: dict, dest: str) -> None:
    """file.moveTo(folder): the file's parents become the folder alone."""
    auth = drv._owner_write("a file is moved in Drive")
    q = urllib.parse.urlencode({"addParents": dest, "removeParents": ",".join(f.get("parents") or []),
                                "supportsAllDrives": "true", "fields": "id"})
    req = urllib.request.Request(f"{dr.API}/{urllib.parse.quote(s_(f.get('id')))}?{q}", data=b"{}",
                                 headers={**auth, "Content-Type": "application/json"}, method="PATCH")
    drv._send(req)


def move_into(drv: Any, f: dict, dest: str) -> bool:
    """filesMoveInto_: moved when the folder is not one of its parents already; whether it moved."""
    if in_folder(f, dest):
        return False
    move(drv, f, dest)
    return True


def upload(drv: Any, parent: str, name: str, mime: str, data: bytes, description: str = "") -> dict[str, Any]:
    """folder.createFile(blob) and file.setDescription: the bytes filed with the words Drive keeps beside them;
    {id, name, mimeType, size, webViewLink}."""
    if not description:
        return drv.upload_into(parent, name, mime, data)
    auth = drv._owner_write("a file is filed in Drive")
    boundary = "hub" + os.urandom(12).hex()
    meta = json.dumps({"name": name, "parents": [parent], "description": description}).encode()
    body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode() + meta +
            f"\r\n--{boundary}\r\nContent-Type: {mime or 'application/octet-stream'}\r\n\r\n".encode() + data +
            f"\r\n--{boundary}--\r\n".encode())
    q = urllib.parse.urlencode({"uploadType": "multipart", "supportsAllDrives": "true",
                                "fields": "id,name,mimeType,size,webViewLink"})
    req = urllib.request.Request(f"https://www.googleapis.com/upload/drive/v3/files?{q}", data=body,
                                 headers={**auth, "Content-Type": f"multipart/related; boundary={boundary}"},
                                 method="POST")
    got = drv._send(req)
    if not got.get("id"):
        raise ValueError("Drive named no file for the upload")
    return got


def describe(drv: Any, fid: str, description: str) -> None:
    """file.setDescription."""
    auth = drv._owner_write("a file's description is written in Drive")
    req = urllib.request.Request(f"{dr.API}/{urllib.parse.quote(fid)}?supportsAllDrives=true&fields=id",
                                 data=json.dumps({"description": description}).encode(),
                                 headers={**auth, "Content-Type": "application/json"}, method="PATCH")
    drv._send(req)


def rename(drv: Any, fid: str, name: str) -> None:
    """file.setName."""
    auth = drv._owner_write("a file is renamed in Drive")
    req = urllib.request.Request(f"{dr.API}/{urllib.parse.quote(fid)}?supportsAllDrives=true&fields=id",
                                 data=json.dumps({"name": name}).encode(),
                                 headers={**auth, "Content-Type": "application/json"}, method="PATCH")
    drv._send(req)


class _Unfollowed(urllib.request.HTTPRedirectHandler):
    """followRedirects: false — a redirect is Drive's answer, never followed."""

    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


def upload_session(drv: Any, parent: str, name: str, mime: str, size: str) -> tuple[int, str]:
    """A resumable upload session minted as the platform's account, for bytes that then go to Drive without passing
    through a door: (Drive's status, the session's address its Location header names, '' when none)."""
    auth = drv._owner_write("an upload session is minted in Drive")
    req = urllib.request.Request("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable"
                                 "&supportsAllDrives=true",
                                 data=json.dumps({"name": name, "parents": [parent]}).encode(),
                                 headers={**auth, "Content-Type": "application/json; charset=UTF-8",
                                          "X-Upload-Content-Type": mime, "X-Upload-Content-Length": size},
                                 method="POST")
    try:
        with urllib.request.build_opener(_Unfollowed).open(req, timeout=dr.CONVERT_TIMEOUT_S) as res:
            return res.status, s_(res.headers.get("Location"))
    except urllib.error.HTTPError as e:
        return e.code, s_(e.headers.get("Location")) if e.headers is not None else ""


def trash_named(drv: Any, parent: str, name: str) -> int:
    """folder.getFilesByName(name) each setTrashed(true): how many went to the bin."""
    n = 0
    for f in named(drv, parent, name, False, "id"):
        drv.trash(s_(f.get("id")))
        n += 1
    return n


def write_doc(drv: Any, parent: str, name: str, html: str) -> str:
    """DocumentApp: the folder's Google Doc of this name written again with these words (made when there is none);
    its id."""
    auth = drv._owner_write("a document is written in Drive")
    body = html.encode("utf-8")
    hit = next((f for f in named(drv, parent, name, False, "id,mimeType") if f.get("mimeType") == GOOGLE_DOC), None)
    if hit is not None:
        q = urllib.parse.urlencode({"uploadType": "media", "supportsAllDrives": "true", "fields": "id"})
        req = urllib.request.Request(f"https://www.googleapis.com/upload/drive/v3/files/"
                                     f"{urllib.parse.quote(s_(hit.get('id')))}?{q}", data=body,
                                     headers={**auth, "Content-Type": "text/html; charset=UTF-8"}, method="PATCH")
        return s_(drv._send(req).get("id")) or s_(hit.get("id"))
    boundary = "hub" + os.urandom(12).hex()
    meta = json.dumps({"name": name, "mimeType": GOOGLE_DOC, "parents": [parent]}).encode()
    payload = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode() + meta +
               f"\r\n--{boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n".encode() + body +
               f"\r\n--{boundary}--\r\n".encode())
    q = urllib.parse.urlencode({"uploadType": "multipart", "supportsAllDrives": "true", "fields": "id"})
    req = urllib.request.Request(f"https://www.googleapis.com/upload/drive/v3/files?{q}", data=payload,
                                 headers={**auth, "Content-Type": f"multipart/related; boundary={boundary}"},
                                 method="POST")
    made = s_(drv._send(req).get("id"))
    if not made:
        raise ValueError("Drive named no document for " + name)
    return made


# ---- the server's copy ----------------------------------------------------------------------------------------------

def safe(v: str, n: int = 150) -> str:
    return _SAFE.sub("_", v or "")[:n].strip() or "file"


def kept_dir(app_dir: str, drive_id: str) -> Path:
    return LD.ROOT / app_dir / drive_id


def keep(app_dir: str, drive_id: str, name: str, mime: str, data: bytes, by: str) -> str:
    """The bytes on the server's disk, whole or not at all, beside what they are; the path under the documents root."""
    if not _FILE_ID.fullmatch(drive_id or ""):
        raise ValueError("no Drive id to keep the copy under")
    folder_ = kept_dir(app_dir, drive_id)
    folder_.mkdir(parents=True, exist_ok=True)
    target = folder_ / safe(name)
    tmp = target.with_name(target.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, target)
    (folder_ / "meta.json").write_text(json.dumps({"name": name, "file": target.name, "mime": mime, "size": len(data),
                                                   "by": by, "at": gsjs.iso(datetime.now(timezone.utc))}),
                                       encoding="utf-8")
    return str(target.relative_to(LD.ROOT))


def kept(app_dir: str, drive_id: str) -> dict[str, Any] | None:
    """The copy kept for a Drive file: its meta and path, or None."""
    if not _FILE_ID.fullmatch(drive_id or ""):
        return None
    folder_ = kept_dir(app_dir, drive_id)
    try:
        meta = json.loads((folder_ / "meta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    target = folder_ / s_(meta.get("file"))
    return {**meta, "path": str(target.relative_to(LD.ROOT))} if target.is_file() else None
