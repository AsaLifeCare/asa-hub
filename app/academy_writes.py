"""Academy's writes on Python: a lesson added, edited or removed (the generic create, update and delete on `videos`,
Main.gs route), a thumb given to a lesson or a document (Prefs.gs docFeedback, one row per vote in Postgres), and
academyKeep recording what the relay's pass brought onto the server (app.academy_files). academyUpload brings the
videos sheet and the doc_feedback tab into Postgres as the app is given to Python."""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any, Callable

import academy as AC
import gsjs
import locations as L
import resource_rows as RR
import sheet_resources as SR
import smart_comms as SC
import writes as W
from writes import Decision

BUSY = "Somebody else is changing the Academy right now — try again."

s_ = gsjs.str_


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, AC.RESOURCE, payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, AC.RESOURCE, payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, AC.RESOURCE, payload)


def feedback(sess: L.Session, payload: dict) -> Decision:
    """docFeedback: one vote appended (a re-vote appends again), answered with the item's tally."""
    p = payload if isinstance(payload, dict) else {}
    doc_id, vote = s_(p.get("doc_id")), s_(p.get("vote")).lower()
    if not doc_id:
        return W.refuse(400, "doc_id is required")
    if vote not in ("up", "down"):
        return W.refuse(400, 'vote must be "up" or "down"')
    user = sess.user or {}
    cells = {"feedback_id": "FBK_" + secrets.token_hex(7).upper(), "item_kind": s_(p.get("kind")) or "doc",
             "doc_id": doc_id, "doc_title": s_(p.get("doc_title")), "collection": s_(p.get("collection")),
             "vote": vote, "user_email": s_(user.get("email")),
             "user_name": s_(user.get("display_name") or user.get("name")), "user_role": s_(user.get("role")),
             "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"}
    RR.create(sess.reads, AC.FEEDBACK, cells, s_(user.get("email")))
    return Decision({"status": 200, "data": AC.tally(sess.reads, doc_id)}, subject=doc_id, own=True)


def keep(sess: L.Session, payload: dict) -> Decision:
    """academyKeep (the relay's own): each file its pass brought, or the reason it could not, recorded."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision({"status": 403, "message": "This is the relay's own write."})
    items = (payload or {}).get("items")
    if not isinstance(items, list):
        return W.refuse(400, "items is a list.")
    n = 0
    for it in items:
        if not isinstance(it, dict) or not s_(it.get("drive_id")):
            continue
        RR._cur().execute(
            f"insert into {AC.FILES} (drive_id, name, mime, size_bytes, modified, path, why, fetched_at, write_id)"
            " values (%s, %s, %s, %s, %s, %s, %s, now(), %s) on conflict (drive_id) do update set name = excluded.name,"
            " mime = excluded.mime, size_bytes = excluded.size_bytes, modified = excluded.modified,"
            " path = case when excluded.path <> '' then excluded.path else app.academy_files.path end,"
            " why = excluded.why, fetched_at = now(), write_id = excluded.write_id",
            (s_(it["drive_id"]), s_(it.get("name")), s_(it.get("mime")) or "video/mp4", int(it.get("size_bytes") or 0),
             s_(it.get("modified")), s_(it.get("path")), s_(it.get("why")), SC.write_id()))
        n += 1
    return Decision({"status": 200, "data": {"kept": n}}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "videosCreate": create, "videosUpdate": update, "videosDelete": delete, "docFeedback": feedback,
    "academyKeep": keep,
    "academyUpload": RR.upload_door({AC.RESOURCE: SR.SPECS[AC.RESOURCE], AC.FEEDBACK: {"tab": AC.FEEDBACK_TAB}})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.academy_writes and app.academy_receipts, beside the other apps' own; the lessons and the votes
    app.resource_rows', the files app.academy_files'. A void takes each row back."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="academy", label="Academy")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                c = self.conn()
                with c.transaction():
                    c.execute(f"delete from {AC.FILES} where write_id = %s", (write_id,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("academy: the void of %s was not applied (%s)", write_id[:40], type(exc).__name__)
        return done
