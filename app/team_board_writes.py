"""Kanban's writes (the generic create, update and delete on `teamTasks`, Main.gs route), kept in Postgres alone
(app/resource_rows.py): a card added, moved, edited or given its note, a move onto Done or Cancelled stamped as
hubStampWhen_ stamps it, a card removed. teamBoardUpload brings the board's sheets into Postgres again for the relay
(rows nothing here has touched). libraryUploadKeep keeps a card's attachment (Files.gs libraryUpload) once the relay
stored it in Library Files as asatech, its row in app.library_uploads."""
from __future__ import annotations

import re
from typing import Any, Callable

import gsjs
import locations as L
import resource_rows as RR
import sheet_resources as SR
import smart_comms as SC
import writes as W
from scope import Defer
from writes import Decision

BUSY = "Somebody else is changing the board right now — try again."


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, "teamTasks", payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, "teamTasks", payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, "teamTasks", payload)


LIBRARY_TABLE = "app.library_uploads"


def library_upload_keep(sess: L.Session, payload: dict) -> Decision:
    """libraryUpload, once the relay stored the file in Library Files as asatech: its row kept, its answer said."""
    user = sess.user or {}
    if gsjs.str_(user.get("role")) not in ("admin", "manager"):
        return W.Decision({"status": 403, "message": "Requires an admin or manager account"})
    p = payload if isinstance(payload, dict) else {}
    fid = gsjs.str_(p.get("file_id"))
    if not re.fullmatch(r"[A-Za-z0-9_-]{10,}", fid):
        return W.refuse(400, "No file attached")
    size = p.get("size_bytes") if isinstance(p.get("size_bytes"), int) else 0
    name, mime = gsjs.str_(p.get("file_name")), gsjs.str_(p.get("mime_type"))
    cur = W.HELD.get()
    if cur is None:
        raise Defer("a library file is kept only under the platform's write lock")
    cur.execute(f"insert into {LIBRARY_TABLE} (file_id, file_name, drive_name, mime_type, size_bytes, by_email,"
                " write_id) values (%s, %s, %s, %s, %s, %s, %s) on conflict (file_id) do nothing",
                (fid, name, gsjs.str_(p.get("drive_name")), mime, size, gsjs.str_(user.get("email")), SC.write_id()))
    return W.Decision({"status": 200, "data": {"file_id": fid, "file_url": "https://drive.google.com/file/d/" + fid
                                               + "/view", "file_name": name, "mime_type": mime, "size_bytes": size}},
                      subject=fid, own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "teamTasksCreate": create, "teamTasksUpdate": update, "teamTasksDelete": delete,
    "teamBoardUpload": RR.upload_door({r: SR.SPECS[r] for r in ("teamTasks", "projectWorkItems")}),
    "libraryUploadKeep": library_upload_keep}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.team_board_writes and app.team_board_receipts, beside the other apps' own; the rows app.resource_rows',
    the stored files app.library_uploads'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="team_board", label="Kanban")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        """A void also takes back the library file's row kept under it."""
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    self.conn().execute(f"delete from {LIBRARY_TABLE} where write_id = %s", (write_id,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("library uploads: the void of %s was not applied (%s)", write_id[:40],
                              type(exc).__name__)
        return done
