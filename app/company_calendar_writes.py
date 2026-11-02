"""Calendar's writes (CalendarFiles.gs): a day's file kept once the relay filed it in Drive as the platform's own
account (calendarDayFileStore) — its row in app.calendar_files alone, never a sheet — and a pinned file taken off its
day (calendarDayFileRemove): a kept row marked removed, the Drive file left where it is because someone may still hold
its link. A row the calendar_files tab holds is taken off the same way: kept whole in app.calendar_files, marked
removed, so no read lists it again."""
from __future__ import annotations

import re
import uuid
from typing import Any, Callable

import company_calendar as CAL
import gsjs
import locations as L
import smart_comms as SC
import writes as W
from scope import Defer

STORE, REMOVE = "calendarDayFileStore", "calendarDayFileRemove"
FILE_ID = re.compile(r"[A-Za-z0-9_-]{10,}")
# app.calendar_files' own key: the id Utilities.getUuid gave a tab row, or one minted here
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
DRIVE_ID = re.compile(r"/file/d/([A-Za-z0-9_-]{10,})")
PRIVATE = "The file is pinned but private — only its owner can open the link. "

s_ = gsjs.str_


def _cur() -> Any:
    cur = W.HELD.get()
    if cur is None:
        raise Defer("a calendar file is kept only under the platform's write lock")
    return cur


def store(sess: L.Session, payload: dict) -> W.Decision:
    """calendarDayFileStore, once the relay filed the file: the plan's refusals decided again, the row kept whole."""
    reads, user = sess.reads, sess.user or {}
    if not user or user.get("is_service") or s_(user.get("role")) not in CAL.FILE_ROLES:
        return W.Decision(CAL.DENIED)
    p = payload if isinstance(payload, dict) else {}
    date = s_(p.get("date"))
    if not CAL.DAY.match(date):
        return W.refuse(400, "A day (YYYY-MM-DD) is required.")
    name = s_(p.get("name")) or "attachment"
    mime = s_(p.get("mime")).lower()
    if not (mime.startswith("image/") or mime == "application/pdf") and not CAL.FILE_EXT.search(name):
        return W.refuse(400, "Images and PDFs only.")
    filed = p.get("filed") if isinstance(p.get("filed"), dict) else {}
    drive_id = s_(filed.get("file_id"))
    if not FILE_ID.fullmatch(drive_id):
        return W.refuse(400, "The file is required.")
    CAL.at_headquarters(user)
    url = "https://drive.google.com/file/d/" + drive_id + "/view"
    held = s_(p.get("held"))
    fid, at, by = str(uuid.uuid4()), W.now_iso(reads), s_(user.get("email"))
    _cur().execute(f"insert into {CAL.TABLE} (file_id, day, name, url, mime, by_email, at, drive_file_id, shared,"
                   " write_id) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                   (fid, date, name, url, mime, by, at, drive_id, not held, SC.write_id()))
    data: dict[str, Any] = {"id": fid, "date": date, "name": name, "url": url, "mime": mime, "by": by, "at": at}
    # a held publication is said in the answer: the link opens for its owner only, and the screen says so
    if held:
        data.update(shared=False, shared_why=PRIVATE + held)
    return W.Decision({"status": 200, "data": data}, subject=fid, own=True)


def remove(sess: L.Session, payload: dict) -> W.Decision:
    """calendarDayFileRemove: the uploader or a manager takes a file off its day."""
    reads, user = sess.reads, sess.user or {}
    if not user or user.get("is_service"):
        return W.Decision(CAL.DENIED)
    fid = s_((payload or {}).get("id"))
    if not fid:
        return W.refuse(400, "Which file?")
    CAL.at_headquarters(user)
    role, email = s_(user.get("role")), s_(user.get("email"))
    cur = _cur()
    cur.execute(f"select by_email, removed_at is null from {CAL.TABLE} where file_id = %s", (fid,))
    kept = cur.fetchone()
    if kept is not None and not kept[1]:
        return W.refuse(404, "That file is not on the board.")
    # a tab row the board lists: one on a day
    tab = None if kept else next((f for f in CAL.tab_files(reads) if f["id"] == fid and CAL.DAY.match(f["date"])), None)
    by = s_(kept[0]) if kept else tab["by"] if tab else None
    if by is None:
        return W.refuse(404, "That file is not on the board.")
    if role not in ("admin", "manager") and by != email:
        return W.refuse(403, "Only the uploader or a manager can remove this.")
    wid = SC.write_id()
    if kept:
        cur.execute(f"update {CAL.TABLE} set removed_at = now(), removed_by = %s, removed_write_id = %s"
                    " where file_id = %s and removed_at is null", (email, wid, fid))
        return W.Decision({"status": 200, "data": {"removed": fid}}, subject=fid, own=True)
    # the tab's own row: kept here whole and marked removed, so no read lists it again; the sheet keeps its line
    if not UUID.fullmatch(fid):
        return W.refuse(409, "That file's line on the calendar sheet cannot be taken off here — nothing was changed.")
    drive = DRIVE_ID.search(tab["url"])
    cur.execute(f"insert into {CAL.TABLE} (file_id, day, name, url, mime, by_email, at, drive_file_id, write_id,"
                " removed_at, removed_by, removed_write_id) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, now(), %s, %s)",
                (fid, tab["date"], tab["name"], tab["url"], tab["mime"], by, tab["at"], drive.group(1) if drive else "",
                 wid, email, wid))
    return W.Decision({"status": 200, "data": {"removed": fid}}, subject=fid, own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], W.Decision]] = {STORE: store, REMOVE: remove}
POLICY: dict[str, dict[str, Any]] = {a: {"roles": CAL.FILE_ROLES} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.calendar_writes and app.calendar_receipts beside the other apps' own; the files are app.calendar_files'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="calendar", label="Calendar")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        """The relay's word on a write; a void takes back the file kept, or the removal made, under it."""
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    self.conn().execute(f"delete from {CAL.TABLE} where write_id = %s", (write_id,))
                    self.conn().execute(f"update {CAL.TABLE} set removed_at = null, removed_by = '',"
                                        " removed_write_id = '' where removed_write_id = %s", (write_id,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("calendar: the void of %s was not applied (%s)", write_id[:40], type(exc).__name__)
        return done
