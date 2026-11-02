"""Policies' writes on Python: a read receipt filed (the generic create, update and delete on policyAcks, Main.gs
route), and policiesKeep — the import's write half, both resources rewritten wholesale as a mirror of the folder (a
document Drive dropped would otherwise read as a current policy), the originals kept noted. policiesUpload brings the
three tabs into Postgres as the app is given to Python."""
from __future__ import annotations

from typing import Any, Callable

import gsjs
import locations as L
import policies as P
import resource_rows as RR
import sheet_resources as SR
import smart_comms as SC
import writes as W
from writes import Decision

BUSY = "Somebody else is changing the policies right now — try again."
HEADERS = ("id", "doc_id", "title", "collection", "updatedAt", "driveUrl", "seq", "heading", "text")

s_ = gsjs.str_


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, "policyAcks", payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, "policyAcks", payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, "policyAcks", payload)


def _rewrite(reads: L.Reads, resource: str, rows: list[dict], by: str) -> int:
    """policiesWriteTab_: every row there taken out, the folder's rows put in, in order."""
    for key, cells in RR.table_rows(reads, resource):
        RR.remove(reads, resource, key, cells, by)
    for r in rows:
        cells = {h: gsjs.js_str(r.get(h)) for h in HEADERS if r.get(h) not in (None, "")}
        RR.create(reads, resource, cells, by)
    return len(rows)


def keep(sess: L.Session, payload: dict) -> Decision:
    """policiesKeep: the import's rows and kept originals recorded."""
    user = sess.user or {}
    if user.get("is_service") or s_(user.get("role")) != "admin":
        return Decision({"status": 403, "message": "Requires an admin or manager account"})
    p = payload if isinstance(payload, dict) else {}
    rows, contacts, files = p.get("policies"), p.get("contacts"), p.get("files") or []
    if not isinstance(rows, list) or not isinstance(contacts, list) or not isinstance(files, list):
        return W.refuse(400, "policies, contacts and files are lists.")
    by = s_(user.get("email"))
    n = {"policy_rows": _rewrite(sess.reads, "policies", rows, by),
         "contact_rows": _rewrite(sess.reads, "contactLists", contacts, by)}
    cur = RR._cur()
    for f in files:
        if not isinstance(f, dict) or not s_(f.get("doc_id")):
            continue
        cur.execute(f"insert into {P.FILES} (doc_id, drive_id, title, name, mime, size_bytes, path, modified, write_id)"
                    " values (%s, %s, %s, %s, %s, %s, %s, %s, %s) on conflict (doc_id) do update set"
                    " drive_id = excluded.drive_id, title = excluded.title, name = excluded.name, mime = excluded.mime,"
                    " size_bytes = excluded.size_bytes, path = excluded.path, modified = excluded.modified,"
                    " kept_at = now(), write_id = excluded.write_id",
                    (s_(f["doc_id"]), s_(f.get("drive_id")), s_(f.get("title")), s_(f.get("name")), s_(f.get("mime")),
                     int(f.get("size_bytes") or 0), s_(f.get("path")), s_(f.get("modified")), SC.write_id()))
    n["originals_kept"] = len(files)
    return Decision({"status": 200, "data": n}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "policyAcksCreate": create, "policyAcksUpdate": update, "policyAcksDelete": delete, "policiesKeep": keep,
    "policiesUpload": RR.upload_door({r: SR.SPECS[r] for r in ("policies", "contactLists", "policyAcks")})}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.policies_writes and app.policies_receipts, beside the other apps' own; rows app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="policies", label="Policies")
