"""The Task Board's writes (the generic create, update and delete on `tasks`, Main.gs route), kept in Postgres alone
(app/resource_rows.py): a card added, moved or edited — stamped completedAt as it enters Done and cleared as it leaves
(hubStampWhen_) — or removed, each person's own (hubOwnedGate_). taskFileStore keeps an attachment's file on the
server (app.task_files), never in Drive; the card's list of them rides the card's own update. tasksUpload brings the
tasks sheet into Postgres again for the relay (rows nothing here has touched), and hands it back as the app returns
to Apps Script."""
from __future__ import annotations

import base64
import binascii
import hashlib
import re
import uuid
from typing import Any, Callable

import admin_docs as AD
import gsjs
import locations as L
import resource_rows as RR
import sheet_resources as SR
import smart_comms as SC
import task_board as TB
import writes as W
from writes import Decision

BUSY = "Somebody else is changing the board right now — try again."
# TaskFiles.gs: images and PDFs, ~15MB decoded (the base64 carries 4/3 of the bytes)
FILE_ROLES = ("admin", "manager", "staff", "client", "interviewer")
B64_MAX = 21000000
_OK_EXT = re.compile(r"\.(png|jpe?g|webp|gif|heic|pdf)$", re.I)

s_ = gsjs.str_


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, TB.RESOURCE, payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, TB.RESOURCE, payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, TB.RESOURCE, payload)


def file_store(sess: L.Session, payload: dict) -> Decision:
    """taskFileStore: one image or PDF kept on the server for its uploader; the card lists it on its own update."""
    user = sess.user or {}
    if not user or user.get("is_service"):
        return Decision({"status": 403, "message": "Denied."})
    p = payload if isinstance(payload, dict) else {}
    name = s_(p.get("filename")) or "attachment"
    mime = s_(p.get("mime")).lower()
    if not (mime.startswith("image/") or mime == "application/pdf") and not _OK_EXT.search(name):
        return W.refuse(400, "Images and PDFs only.")
    b64 = str(p.get("base64") or "")
    if not b64:
        return W.refuse(400, "The file is required.")
    if len(b64) > B64_MAX:
        return W.refuse(400, "The file is too large — up to 15MB.")
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError):
        return W.refuse(400, "The file could not be read.")
    if not data:
        return W.refuse(400, "The file is empty.")
    email = s_(user.get("email")).lower() or "unknown"
    fid = "tf_" + uuid.uuid4().hex
    rel = f"{hashlib.sha256(email.encode()).hexdigest()[:16]}/{fid}/{AD.safe_name(name)}"
    target = TB.base() / rel
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + ".part")
        tmp.write_bytes(data)
        tmp.replace(target)
    except OSError as exc:
        return W.refuse(409, f"The server's documents folder is not writable ({type(exc).__name__}).")
    RR._cur().execute(f"insert into {TB.FILES} (id, name, mime, size_bytes, path, by_email, write_id)"
                      " values (%s, %s, %s, %s, %s, %s, %s)",
                      (fid, name, mime or "application/octet-stream", len(data), rel, email, SC.write_id()))
    return Decision({"status": 200, "data": {"url": TB.KEPT + fid, "name": name, "mime": mime}}, subject="",
                    own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "tasksCreate": create, "tasksUpdate": update, "tasksDelete": delete, "taskFileStore": file_store,
    "tasksUpload": RR.upload_door({TB.RESOURCE: SR.SPECS[TB.RESOURCE]})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["taskFileStore"] = {"roles": FILE_ROLES}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.task_board_writes and app.task_board_receipts; the cards app.resource_rows', the files app.task_files'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="task_board", label="Task Board")
