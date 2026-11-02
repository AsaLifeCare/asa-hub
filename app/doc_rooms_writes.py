"""A Drive reading room's writes (DocFolders.gs docRoomUpload / docRoomTrash): the relay stores or trashes the file in
Drive as the platform's own account on the room's verdict (app/doc_rooms.py), then docRoomKeep keeps what happened in
app.doc_room_events and answers as the door did."""
from __future__ import annotations

from typing import Any, Callable

import doc_rooms as DR
import gsjs
import locations as L
import resource_rows as RR
import smart_comms as SC
import writes as W
from writes import Decision

TABLE = "app.doc_room_events"

s_ = gsjs.str_


def keep(sess: L.Session, payload: dict) -> Decision:
    """docRoomKeep: a file the relay stored in a room, or trashed from it, kept as the room's event."""
    p = payload if isinstance(payload, dict) else {}
    user = sess.user or {}
    key, action, fid = s_(p.get("room")), s_(p.get("action")), s_(p.get("id"))
    if key not in DR.ROOMS or action not in ("upload", "trash") or not fid:
        return W.refuse(400, "Nothing to keep.")
    if not DR.may_read(key, user):
        return Decision(dict(DR.UNKNOWN))
    if action == "trash" and s_(user.get("role")) != "admin":
        return W.refuse(403, "Requires an admin or manager account")
    if action == "upload" and s_(user.get("role")) not in ("admin", "manager"):
        return W.refuse(403, "Requires an admin or manager account")
    size = s_(p.get("size"))
    RR._cur().execute(f"insert into {TABLE} (room, action, file_id, name, mime_type, size_bytes, by_email, write_id)"
                      " values (%s, %s, %s, %s, %s, %s, %s, %s)",
                      (key, action, fid, s_(p.get("name"))[:180], s_(p.get("mime")), int(size) if size.isdigit() else 0,
                       s_(user.get("email")), SC.write_id()))
    DR.drop(key)
    if action == "trash":
        return Decision({"status": 200, "data": {"trashed": True, "id": fid}}, subject="", own=True)
    return Decision({"status": 200, "data": DR.shape({"id": fid, "name": p.get("name"), "mimeType": p.get("mime"),
                                                      "size": size, "modifiedTime": p.get("modified_time"),
                                                      "webViewLink": p.get("web_view_link")}, "", "")},
                    subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"docRoomKeep": keep}
POLICY: dict[str, dict[str, Any]] = {"docRoomKeep": {"roles": ("admin", "manager")}}
BUSY_OF: dict[str, dict[str, Any]] = {"docRoomKeep": {"status": 409, "message": "Another write is in progress — try "
                                                                                "again in a moment."}}


class Store(W.Store):
    """app.doc_rooms_writes and app.doc_rooms_receipts, beside the other apps' own; a void takes its event back."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="doc_rooms", label="Audit Library")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                self.conn().execute(f"delete from {TABLE} where write_id = %s", (write_id,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("doc rooms: the void of %s was not applied (%s)", write_id[:40], type(exc).__name__)
        return done
