"""The Administration workspace's writes on Python (AdminDocs.gs): a document uploaded is kept on the server and in
Postgres (never sent to Drive), a delete trashes its row and keeps the file, and adminDocsKeep records what the relay's
pass brought in from the Drive folder (admin_docs.fetch). Every row's state before a write is kept in
app.admin_doc_changes, so a void takes it back."""
from __future__ import annotations

import base64
import binascii
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

import admin_docs as AD
import gsjs
import locations as L
import resource_rows as RR
import smart_comms as SC
import writes as W
from writes import Decision

BUSY = "Somebody else is changing the Administration folder right now — try again."
DENIED = {"status": 403, "message": "Requires an admin or manager account"}

s_ = gsjs.str_


def _writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and s_((user or {}).get("role")) in ("admin", "manager") and not (user or {}).get("is_service")


def _before(doc_id: str) -> None:
    """The row as it stands, kept for a void (null: this write makes it)."""
    cur = RR._cur()
    cur.execute(f"select to_jsonb(d) from {AD.TABLE} d where id = %s", (doc_id,))
    got = cur.fetchone()
    cur.execute(f"insert into {AD.CHANGES} (write_id, doc_id, before) values (%s, %s, %s)",
                (SC.write_id(), doc_id, None if got is None else json.dumps(got[0])))


def upload(sess: L.Session, payload: dict) -> Decision:
    """adminDocUpload: one file kept in the workspace — on the server's disk and in Postgres."""
    user = sess.user or {}
    if not _writer(user):
        return Decision(dict(DENIED))
    why = AD.problem()
    if why:
        return W.refuse(409, why[0].upper() + why[1:] + ".")
    p = payload if isinstance(payload, dict) else {}
    b64 = s_(p.get("base64"))
    if not b64:
        return W.refuse(400, "No file attached")
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError):
        return W.refuse(400, "The file could not be read")
    if not data:
        return W.refuse(400, "The file is empty")
    if len(data) > AD.MAX_BYTES:
        return W.refuse(400, "The file is over 25MB")
    original = s_(p.get("filename")) or "admin-doc"
    mime = s_(p.get("mime_type")) or "application/octet-stream"
    doc_id = "ad_" + uuid.uuid4().hex
    rel = f"uploads/{doc_id}/{AD.safe_name(original)}"
    AD.put(rel, data)
    now = datetime.now(timezone.utc)
    _before(doc_id)
    RR._cur().execute(
        f"insert into {AD.TABLE} (id, name, mime, size_bytes, modified_time, path, source, created_by, write_id)"
        " values (%s, %s, %s, %s, %s, %s, 'upload', %s, %s)",
        (doc_id, original, mime, len(data), now, rel, s_(user.get("email")), SC.write_id()))
    return Decision({"status": 200, "data": AD.shape({"id": doc_id, "name": original, "mime": mime,
                                                       "size_bytes": len(data), "modified_time": now, "path": rel,
                                                       "source": "upload"})}, subject=doc_id, own=True)


def delete(sess: L.Session, payload: dict) -> Decision:
    """adminDocDelete: the document trashed — its row kept with when and by whom, its file left on the disk."""
    user = sess.user or {}
    if not _writer(user):
        return Decision(dict(DENIED))
    fid = s_((payload or {}).get("file_id"))
    if not fid:
        return W.refuse(400, "file_id is required")
    r = AD.row(sess.reads, fid)
    if r is None:
        return W.refuse(404, AD.NO_FILE)
    if r.get("trashed_at") is not None:
        return Decision({"status": 200, "data": {"file_id": fid, "trashed": True}}, subject=fid, own=True)
    _before(fid)
    RR._cur().execute(f"update {AD.TABLE} set trashed_at = now(), trashed_by = %s, updated_at = now(), write_id = %s"
                      " where id = %s", (s_(user.get("email")), SC.write_id(), fid))
    return Decision({"status": 200, "data": {"file_id": fid, "name": s_(r.get("name")), "trashed": True}},
                    subject=fid, own=True)


def keep(sess: L.Session, payload: dict) -> Decision:
    """adminDocsKeep (the relay's own): what its pass brought in from the Drive folder recorded — a new file added
    under its Drive id, a changed one brought up to date; a row deleted here stays deleted."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision({"status": 403, "message": "This is the relay's own write."})
    items = (payload or {}).get("items")
    if not isinstance(items, list):
        return W.refuse(400, "items is a list.")
    n = {"added": 0, "changed": 0, "skipped": 0}
    cur = RR._cur()
    for it in items:
        if not isinstance(it, dict) or not s_(it.get("google_id")):
            n["skipped"] += 1
            continue
        gid = s_(it["google_id"])
        cur.execute(f"select id, trashed_at is not null from {AD.TABLE} where google_id = %s", (gid,))
        had = cur.fetchone()
        if had is not None and had[1]:
            n["skipped"] += 1
            continue
        modified = s_(it.get("google_modified")) or None
        cells = (s_(it.get("name")), s_(it.get("mime")) or "application/octet-stream", int(it.get("size_bytes") or 0),
                 modified, s_(it.get("path")), s_(it.get("view_path")), s_(it.get("view_mime")),
                 s_(it.get("google_mime")), s_(it.get("google_modified")), s_(it.get("google_link")))
        doc_id = had[0] if had is not None else gid
        _before(doc_id)
        if had is None:
            cur.execute(f"insert into {AD.TABLE} (id, name, mime, size_bytes, modified_time, path, view_path, view_mime,"
                        " google_mime, google_modified, google_link, source, google_id, created_by, write_id) values"
                        " (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'drive', %s, 'asa-hub:administration', %s)",
                        (doc_id, *cells, gid, SC.write_id()))
            n["added"] += 1
        else:
            cur.execute(f"update {AD.TABLE} set name = %s, mime = %s, size_bytes = %s, modified_time = %s, path = %s,"
                        " view_path = %s, view_mime = %s, google_mime = %s, google_modified = %s, google_link = %s,"
                        " updated_at = now(), write_id = %s where id = %s", (*cells, SC.write_id(), doc_id))
            n["changed"] += 1
    return Decision({"status": 200, "data": n}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "adminDocUpload": upload, "adminDocDelete": delete, "adminDocsKeep": keep}
_ROLES = ("admin", "manager")
POLICY: dict[str, dict[str, Any]] = {"adminDocUpload": {"roles": _ROLES}, "adminDocDelete": {"roles": _ROLES},
                                     "adminDocsKeep": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.admin_docs_writes and app.admin_docs_receipts, beside the other apps' own; the documents app.admin_docs'.
    A void puts every row the write changed back as it stood."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="admin_docs", label="Administration")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                c = self.conn()
                with c.transaction():
                    got = c.execute(f"select id, doc_id, before from {AD.CHANGES} where write_id = %s order by id desc",
                                    (write_id,)).fetchall()
                    for cid, doc_id, before in got:
                        c.execute(f"delete from {AD.TABLE} where id = %s", (doc_id,))
                        if before is not None:
                            c.execute(f"insert into {AD.TABLE} select * from jsonb_populate_record(null::{AD.TABLE},"
                                      " %s)", (json.dumps(RR._json(before)),))
                        c.execute(f"delete from {AD.CHANGES} where id = %s", (cid,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("administration: the void of %s was not applied (%s)", write_id[:40], type(exc).__name__)
        return done
