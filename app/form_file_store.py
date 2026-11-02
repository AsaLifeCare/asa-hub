"""The in-app file funnel (FormFiles.gs formFileStore) on Python behind the Forms switch (`forms`): a file stored
through a session's upload lane (forms, the Decoder lab, finance receipts). The relay asks formFileStorePrepare first —
the file's type and size held to its context, then filed as the platform's account in the context's intake folder
(its asa-documents shelf, or the one the words book names) under the page's upload key, its content hashed into the
asset id the spine mints (hubAssetPut_), and kept on the server (form-files/<Drive id>/) — and formFileStore then
files the decoder's ledger row (form_files) and the asset's trail (asset_events), each in its own table. The public
form's own file door (app/forms_public.py) files through the same core."""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import re
import threading
import time
import uuid
from typing import Any, Callable

import candidate_papers as CP
import candidates as CND
import drive as dr
import drive_files as DF
import forms as F
import gsjs
import locations as L
import resource_rows as RR
import staff_views
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

FILES_TAB = "form_files"
ASSET_EVENTS_TAB = "asset_events"
ASSET_EVENTS_PAYLOAD_MAX = 2000
KEPT_DIR = "form-files"
# FORM_UPLOAD_CONTEXTS: the folder is a registry key, never an id a caller sends
CONTEXTS: dict[str, dict[str, Any]] = {
    "forms": {"prop": "HUB_FORM_UPLOADS_FOLDER_ID", "folder": "Asa Hub - Form", "max_mb": 20,
              "accept": ("pdf", "png", "jpg", "jpeg", "webp", "gif", "docx", "xlsx", "csv", "txt", "json", "xml", "tsv",
                         "md", "zip", "html", "htm", "js", "mjs", "ts", "tsx", "jsx", "css", "py", "sql", "yml", "yaml",
                         "mp4", "mov", "m4v", "webm", "3gp", "m4a", "mp3", "wav"),
              "roles": ("admin", "manager")},
    # every type the words book knows; DIGEST_TYPE_NEVER still refuses anything meant to run
    "lab": {"prop": "HUB_FORM_UPLOADS_FOLDER_ID", "folder": "Asa Hub - Form", "max_mb": 25, "accept": "*",
            "roles": ("admin", "manager")},
    # the folder finReceiptFolder_ resolves
    "finance": {"prop": "FINANCE_RECEIPTS_FOLDER_ID", "folder": "ASA Hub — Client Receipts", "max_mb": 20,
                "accept": ("pdf", "png", "jpg", "jpeg", "webp"), "roles": ("admin", "manager")}}
# 30MB arrives as ~42.4MB on the wire
MAX_BYTES = 30 * 1024 * 1024
HASH_MAX_BYTES = 12 * 1024 * 1024
TYPES = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
         "gif": "image/gif", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
         "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "csv": "text/csv",
         "txt": "text/plain", "json": "application/json", "xml": "application/xml",
         "tsv": "text/tab-separated-values", "md": "text/markdown", "zip": "application/zip", "html": "text/html",
         "htm": "text/html", "js": "text/javascript", "mjs": "text/javascript", "cjs": "text/javascript",
         "ts": "text/plain", "tsx": "text/plain", "jsx": "text/javascript", "css": "text/css", "py": "text/x-python",
         "sql": "text/plain", "yml": "text/yaml", "yaml": "text/yaml", "heic": "image/heic", "mp4": "video/mp4",
         "mov": "video/quicktime", "m4v": "video/x-m4v", "webm": "video/webm", "3gp": "video/3gpp",
         "m4a": "audio/mp4", "mp3": "audio/mpeg", "wav": "audio/wav", "ogg": "audio/ogg"}
# Digest.gs DIGEST_TYPE_NEVER: never a runnable file, whatever a row says
TYPE_NEVER = frozenset({"exe", "msi", "bat", "cmd", "com", "scr", "sh", "bash", "zsh", "ps1", "psm1", "vbs", "jar",
                        "apk", "app", "dll", "so", "dylib", "deb", "rpm", "pkg", "dmg"})
# Forms.gs FORM_ORIGINALS_NAME: never the originals folder
ORIGINALS = "database"
FOLDER_CACHE_S = 21600.0
REQUIRED = ("context", "filename", "base64")
UNFILED = "The file could not be stored just now — nothing was saved. Try again in a minute."
UNLEDGERED = "Stored, but the ledger row did not save — retry."

s_ = gsjs.str_
_FOUND: dict[str, tuple[float, str]] = {}
_FOUND_LOCK = threading.Lock()


def _active(row: dict) -> bool:
    """digestVocabOn_."""
    return (row.get("active") or "on").lower() not in ("off", "false", "no", "0")


def known_types(reads: L.Reads) -> dict[str, str]:
    """digestFileTypes_: the code's types, then the words book's (never a runnable one)."""
    out = dict(TYPES)
    for r in CP.vocab(reads).get("Form File Types") or []:
        if not _active(r):
            continue
        ext = re.sub(r"^\.", "", gsjs.trim(r.get("ext") or "").lower())
        mime = gsjs.trim(r.get("mime") or "")
        if ext and mime and ext not in TYPE_NEVER:
            out[ext] = mime
    return out


def documents_folder(reads: L.Reads) -> str:
    """The intake shelf's name, never the originals folder."""
    sub = documents_name(reads)
    return sub + "-files" if sub and sub == ORIGINALS else sub


def documents_name(reads: L.Reads) -> str:
    """The words book's documents_folder when it is a name, else asa-documents; cut to the letters a folder name
    keeps."""
    named: str | None = None
    for r in CP.vocab(reads).get("Digest Settings") or []:
        if not _active(r) or gsjs.trim(r.get("key") or "").lower() != "documents_folder":
            continue
        raw = gsjs.trim(r.get("value") or "")
        if raw:
            # a dial the book holds as a number is no folder's name
            n = CND.js_number(raw)
            named = raw if n != n else None
    sub = named or "asa-documents"
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9-]+", "-", gsjs.trim(sub).lower()))[:60]


def ext_of(name: str) -> str:
    """formFileExt_."""
    m = re.search(r"\.([a-z0-9]{1,8})$", (name or "").lower())
    return m.group(1) if m else ""


def gate(user: dict | None, p: dict) -> tuple[str, dict[str, Any] | None]:
    """formFileStore's declared params, its context and the context's own lane. (the context, the refusal)"""
    for k in REQUIRED:
        if p.get(k) is None or p.get(k) == "":
            return "", {"status": 400, "message": f"Missing required parameter: {k}."}
    key = gsjs.trim(gsjs.or_text(p.get("context")))
    ctx = CONTEXTS.get(key)
    if ctx is None:
        return key, {"status": 400, "message": f'Unknown upload context "{key}".'}
    roles = ctx["roles"]
    if not user or s_(user.get("role")) not in roles:
        return key, {"status": 403, "message": "This upload lane is for: " + ", ".join(roles) + "."}
    return key, None


def uploads_folder(reads: L.Reads, drv: Any, key: str) -> tuple[str, str]:
    """formUploadsFolderId_: the context's property, else the folder found by its name (held six hours, never
    written to the property); ('', why) when neither answers."""
    ctx = CONTEXTS[key]
    fid = gsjs.trim(gsjs.or_blank(reads.db.prop(ctx["prop"])))
    if fid:
        return fid, ""
    with _FOUND_LOCK:
        hit = _FOUND.get(key)
    if hit and hit[0] > time.time():
        return hit[1], ""
    try:
        name = ctx["folder"].replace("\\", "\\\\").replace("'", "\\'")
        found = DF.search(drv, f"mimeType = '{dr.FOLDER_MIME}' and trashed = false and name = '{name}'", "id", 1)
    except Exception:  # noqa: BLE001 - formUploadsFolderId_'s catch: the honest reason below
        found = []
    if found:
        with _FOUND_LOCK:
            _FOUND[key] = (time.time() + FOLDER_CACHE_S, s_(found[0].get("id")))
        return s_(found[0].get("id")), ""
    return "", f'The "{ctx["folder"]}" folder is not reachable — paste its Drive id into the {ctx["prop"]} property.'


def _asset_id(sha: str, fid: str) -> str:
    return "AST_" + sha[:32] if sha else "AST_u" + fid[:24]


def prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """formFileStore's slow half (formFileStoreCore_)."""
    p = payload if isinstance(payload, dict) else {}
    key, refused = gate(sess.user, p)
    if refused:
        return refused
    # String(upload_id) as the session door hands it on: a page that names no key stores under "undefined"
    raw_key = "undefined" if "upload_id" not in p else gsjs.js_str(p.get("upload_id"))
    return core(sess.reads, key, None, p.get("filename"), p.get("base64"), "", raw_key,
                s_((sess.user or {}).get("email")))


def core(reads: L.Reads, key: str, allow: list | None, filename: Any, b64: Any, prefix: str, raw_key: str,
         by: str) -> dict[str, Any]:
    """formFileStoreCore_, shared by the session and public doors so their rules cannot drift apart: the file held to
    its question's types (else its context's) and its context's ceiling, filed in the context's intake shelf under the
    page's upload key — a retry answering the file the first try stored — hashed into its asset id, and kept on the
    server."""
    if key in F.PROTO_NAMES:
        raise Defer("an upload context every JavaScript object answers")
    ctx = CONTEXTS.get(key)
    if ctx is None:
        return {"status": 400, "message": f'Unknown upload context "{key}".'}
    filename = gsjs.trim(gsjs.or_text(filename))[:180] or "file"
    ext = ext_of(filename)
    known = known_types(reads)
    ok = list(allow) if allow else list(known) if ctx["accept"] == "*" else list(ctx["accept"])
    if not ext or ext not in ok or ext not in known:
        return {"status": 400, "message": "That file type is not accepted here. Allowed: " +
                                          ", ".join("." + gsjs.js_str(a) for a in ok) + "."}
    b64 = gsjs.or_text(b64)
    try:
        data = base64.b64decode(b64, validate=False) if b64 != "kept" else b""
    except (binascii.Error, ValueError):
        return {"status": 400, "message": "The file did not arrive whole — please try again."}
    if not data:
        return {"status": 400, "message": "The file arrived empty."}
    cap = min(MAX_BYTES, int(ctx["max_mb"]) * 1024 * 1024)
    if len(data) > cap:
        return {"status": 400, "message": f"That file is {gsjs.num_str(gsjs.js_round(len(data) / 1048576))}MB — "
                                          f"{gsjs.num_str(gsjs.js_round(cap / 1048576))}MB is the ceiling per file."}
    drv = reads.need_drive()
    where, why = uploads_folder(reads, drv, key)
    if not where:
        return {"status": 503, "message": why}
    folder = DF.folder(drv, where)
    if folder is None:
        return {"status": 503, "message": "The upload folder did not answer — please try again."}
    home = s_(folder.get("id"))
    sub = documents_folder(reads)
    if sub:
        try:
            home = s_(DF.child(drv, home, sub).get("id"))
        except Exception:  # noqa: BLE001 - the parent still receives: organisation, not a wall
            pass
    mime = known[ext]
    upload_key = re.sub(r"[^A-Za-z0-9_-]", "", raw_key)[:40]
    stored = prefix + (upload_key or gsjs.iso(reads.now).replace(":", "-").replace(".", "-")) + "__" + filename
    sha = hashlib.sha256(data).hexdigest() if len(data) <= HASH_MAX_BYTES else ""
    if upload_key:
        for name in (stored, upload_key + "__" + filename):
            try:
                seen = DF.named(drv, home, name, False, "id,webViewLink")
            except Exception:  # noqa: BLE001 - a search that cannot answer just means the file is made
                seen = []
            if seen:
                fid = s_(seen[0].get("id"))
                return {"status": 200, "data": {
                    "file_id": fid, "file_url": s_(seen[0].get("webViewLink")) or DF.file_url(fid),
                    "file_name": filename, "mime_type": mime, "size_bytes": len(data),
                    "asset_id": _asset_id(sha, fid), "id_source": "content" if sha else "minted", "sha256": sha,
                    "reused": True}}
    note = "" if sha else f"over {gsjs.num_str(gsjs.js_round(HASH_MAX_BYTES / 1048576))}MB — not hashed"
    # the identity rides on the file, written server-side, read back at a public submit (hubAssetOf_)
    said = (" sha256:" + sha if sha else "") + " at:" + gsjs.iso(reads.now)
    made = DF.upload(drv, home, stored, mime, data, "asset:" + _asset_id(sha, "") + said if sha else "")
    fid = s_(made.get("id"))
    if not sha:
        try:
            DF.describe(drv, fid, "asset:" + _asset_id("", fid) + said)
        except Exception as e:  # noqa: BLE001 - a description that will not write costs nothing else
            log.info("form files: the asset's description was not written (%s)", type(e).__name__)
    DF.keep(KEPT_DIR, fid, filename, mime, data, by)
    return {"status": 200, "data": {"file_id": fid, "file_url": DF.file_url(fid), "file_name": filename,
                                    "mime_type": mime, "size_bytes": len(data), "asset_id": _asset_id(sha, fid),
                                    "id_source": "content" if sha else "minted", "sha256": sha, "hash_note": note}}


def _handle(p: dict) -> dict[str, Any] | None:
    """What the relay's read stored, when it is a file it filed (kept on the server) or found filed before."""
    prep = p.get("prepared")
    if s_(p.get("base64")) != "kept" or not isinstance(prep, dict) or not s_(prep.get("file_id")):
        return None
    if not prep.get("reused") and DF.kept(KEPT_DIR, s_(prep.get("file_id"))) is None:
        return None
    return prep


def store(sess: L.Session, payload: dict) -> Decision:
    """formFileStore: the decoder's ledger row filed at once (there is no submission to wait for), pending its
    decoding, and the capture on the asset's trail."""
    p = payload if isinstance(payload, dict) else {}
    user = sess.user or {}
    key, refused = gate(sess.user, p)
    if refused:
        return Decision(refused)
    got = _handle(p)
    if got is None:
        return W.refuse(503, UNFILED)
    reads = sess.reads
    if CP.gate_holds(reads, CP.BOOK_GATE):
        return W.refuse(503, UNLEDGERED)
    now = W.now_iso(reads)
    slug = "(" + key + ")"
    row = {"form_slug": slug, "submission_id": "", "field_key": gsjs.or_text(p.get("ref"))[:80],
           "file_id": s_(got.get("file_id")), "file_url": s_(got.get("file_url")),
           "file_name": s_(got.get("file_name")), "asset_id": s_(got.get("asset_id")), "sha256": s_(got.get("sha256")),
           "mime_type": s_(got.get("mime_type")), "size_bytes": gsjs.or_blank(got.get("size_bytes")),
           "uploaded_by_name": s_(user.get("name")) or s_(user.get("display_name")),
           "uploaded_by_email": s_(user.get("email")), "digest_state": "pending", "digest_kind": "",
           "digest_category": "", "digest_dates": "", "digest_names": "", "digest_text_chars": "", "digest_text": "",
           "digest_json": "", "digest_error": "", "digested_at": "", "id": W.mint(), "createdAt": now, "updatedAt": now}
    RR.create(reads, F.resource_of(FILES_TAB), row, s_(user.get("email")))
    if not got.get("reused"):
        asset_event(reads, s_(got.get("asset_id")), key, s_(got.get("file_name")), got, now)
    staff_views.record(sess.user, "form_file_stored_app",
                       f"{key} — {s_(got.get('file_name'))} ({gsjs.or_blank(got.get('size_bytes'))} bytes)")
    return Decision({"status": 200, "data": got}, subject=slug, own=True)


def asset_event(reads: L.Reads, asset_id: str, key: str, name: str, got: dict, at: str) -> None:
    """assetEvent_('asset_captured'): the capture on the asset's trail, its own table, append-only."""
    body = json.dumps({"file_id": got.get("file_id"), "bytes": got.get("size_bytes"), "mime": got.get("mime_type"),
                       "id_source": got.get("id_source"), "hash_note": got.get("hash_note")},
                      separators=(",", ":"), ensure_ascii=False)[:ASSET_EVENTS_PAYLOAD_MAX]
    eid = "ase_" + uuid.uuid4().hex[:24]
    row = {"event_id": eid, "type": "asset_captured", "actor": "", "subject_type": "form", "subject_key": key,
           "subject_name": name, "asset_id": asset_id, "payload": body, "source": "formFileStoreCore_", "at": at,
           "tenant": ""}
    RR.create(reads, F.resource_of(ASSET_EVENTS_TAB), row, "(asset)")


READS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"formFileStorePrepare": prepare}
_PARAMS = {"context": "string", "filename": "string", "base64": "string", "ref": "string", "upload_id": "string"}
READ_POLICY: dict[str, dict[str, Any]] = {"formFileStorePrepare": {"params": _PARAMS}}
ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"formFileStore": store}
POLICY: dict[str, dict[str, Any]] = {"formFileStore": {"params": _PARAMS}}
BUSY_OF: dict[str, dict[str, Any]] = {"formFileStore": {"status": 409, "message": W.BUSY}}
