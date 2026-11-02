"""The Technology workspace's writes on Python (the relay's /hub-lanes/tech-status and /hub-lanes/tech-manual): a
project's status picked and a project added or removed by hand, kept in Postgres alone; techDocsKeep records what the
relay's pass walked and brought in from the Drive folder (technology.fetch). Every row's state before a write is kept in
app.tech_changes, so a void takes it back."""
from __future__ import annotations

import json
from typing import Any, Callable

import gsjs
import locations as L
import resource_rows as RR
import smart_comms as SC
import technology as T
import writes as W
from writes import Decision

BUSY = "Somebody else is changing the Technology workspace right now — try again."
TABLES = {"docs": (T.DOCS, "drive_id"), "status": (T.STATUS, "name"), "manual": (T.MANUAL, "name")}
DOWNLOADED = ("mime", "size_bytes", "path", "view_path", "view_mime", "kept_modified", "why")

s_ = gsjs.str_


def _writer(user: dict | None) -> bool:
    u = user or {}
    return s_(u.get("role")) in ("admin", "manager") and not u.get("is_service")


def _before(tbl: str, key: str) -> None:
    """The row as it stands, kept for a void (null: this write makes it)."""
    table, col = TABLES[tbl]
    cur = RR._cur()
    cur.execute(f"select to_jsonb(t) from {table} t where {col} = %s", (key,))
    got = cur.fetchone()
    cur.execute(f"insert into {T.CHANGES} (write_id, tbl, key, before) values (%s, %s, %s, %s)",
                (SC.write_id(), tbl, key, None if got is None else json.dumps(got[0])))


def status_set(sess: L.Session, payload: dict) -> Decision:
    """The status dropdown on a project's card: the pick kept over the curated one."""
    user = sess.user or {}
    if not _writer(user):
        return Decision(dict(T.DENIED))
    p = payload if isinstance(payload, dict) else {}
    name = s_(p.get("name")).strip()[:200]
    status = s_(p.get("status")).strip()
    if not name:
        return W.refuse(400, "name is required")
    if status not in T.TECH_STATUSES:
        return W.refuse(400, "status must be one of: " + ", ".join(T.TECH_STATUSES))
    _before("status", name)
    RR._cur().execute(f"insert into {T.STATUS} (name, status, updated_by, updated_at, write_id) values"
                      " (%s, %s, %s, now(), %s) on conflict (name) do update set status = excluded.status,"
                      " updated_by = excluded.updated_by, updated_at = now(), write_id = excluded.write_id",
                      (name, status, s_(user.get("email")), SC.write_id()))
    return Decision({"status": 200, "data": {"name": name, "status": status}}, subject=name, own=True)


def manual_save(sess: L.Session, payload: dict) -> Decision:
    """A project tracked by hand, added (or brought up to date) or removed."""
    user = sess.user or {}
    if not _writer(user):
        return Decision(dict(T.DENIED))
    p = payload if isinstance(payload, dict) else {}
    op = s_(p.get("op")).strip()
    name = s_(p.get("name")).strip()[:200]
    if not name:
        return W.refuse(400, "name is required")
    if op == "add":
        status = s_(p.get("status") or "Not started").strip()
        if status not in T.TECH_STATUSES:
            return W.refuse(400, "status must be one of: " + ", ".join(T.TECH_STATUSES))
        _before("manual", name)
        RR._cur().execute(f"insert into {T.MANUAL} (name, category, status, blurb, created_by, write_id) values"
                          " (%s, %s, %s, %s, %s, %s) on conflict (name) do update set category = excluded.category,"
                          " status = excluded.status, blurb = excluded.blurb, write_id = excluded.write_id",
                          (name, s_(p.get("category"))[:100], status, s_(p.get("blurb"))[:500],
                           s_(user.get("email")), SC.write_id()))
    elif op == "delete":
        _before("manual", name)
        RR._cur().execute(f"delete from {T.MANUAL} where name = %s", (name,))
    else:
        return W.refuse(400, "op: add or delete")
    return Decision({"status": 200, "data": {"op": op, "name": name}}, subject=name, own=True)


def keep(sess: L.Session, payload: dict) -> Decision:
    """techDocsKeep (the relay's own): what its pass walked and brought in recorded — a file new to the folder added,
    one moved or changed brought up to date, its kept copy noted once on the disk, and one no longer in the folder
    marked gone (its copy stays)."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision({"status": 403, "message": "This is the relay's own write."})
    p = payload if isinstance(payload, dict) else {}
    items, gone = p.get("items"), p.get("gone") or []
    if not isinstance(items, list) or not isinstance(gone, list):
        return W.refuse(400, "items and gone are lists.")
    n = {"added": 0, "changed": 0, "kept": 0, "gone": 0, "skipped": 0}
    cur = RR._cur()
    for it in items:
        fid = s_(it.get("drive_id")) if isinstance(it, dict) else ""
        if not fid:
            n["skipped"] += 1
            continue
        cur.execute(f"select 1 from {T.DOCS} where drive_id = %s", (fid,))
        had = cur.fetchone() is not None
        _before("docs", fid)
        listed = [s_(it.get(k)) if k != "google_size" else int(it.get(k) or 0) for k in T.LISTED_FIELDS]
        if not had:
            cur.execute(f"insert into {T.DOCS} (drive_id, {', '.join(T.LISTED_FIELDS)}, write_id) values"
                        f" (%s, {', '.join(['%s'] * len(T.LISTED_FIELDS))}, %s)", (fid, *listed, SC.write_id()))
            n["added"] += 1
        else:
            cur.execute(f"update {T.DOCS} set {', '.join(k + ' = %s' for k in T.LISTED_FIELDS)}, listed_at = now(),"
                        " gone_at = null, write_id = %s where drive_id = %s", (*listed, SC.write_id(), fid))
            n["changed"] += 1
        if it.get("fetched") is True:
            got = [s_(it.get(k)) if k != "size_bytes" else int(it.get(k) or 0) for k in DOWNLOADED]
            cur.execute(f"update {T.DOCS} set {', '.join(k + ' = %s' for k in DOWNLOADED)}, fetched_at = now()"
                        " where drive_id = %s", (*got, fid))
            n["kept"] += 1
    for fid in gone:
        fid = s_(fid)
        if not fid:
            continue
        _before("docs", fid)
        cur.execute(f"update {T.DOCS} set gone_at = now(), write_id = %s where drive_id = %s and gone_at is null",
                    (SC.write_id(), fid))
        n["gone"] += cur.rowcount or 0
    return Decision({"status": 200, "data": n}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "techStatusSet": status_set, "techManualSave": manual_save, "techDocsKeep": keep}
_ROLES = ("admin", "manager")
POLICY: dict[str, dict[str, Any]] = {"techStatusSet": {"roles": _ROLES}, "techManualSave": {"roles": _ROLES},
                                     "techDocsKeep": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.technology_writes and app.technology_receipts, beside the other apps' own; the rows app.tech_*'. A void puts
    every row the write changed back as it stood."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="technology", label="Technology")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                c = self.conn()
                with c.transaction():
                    got = c.execute(f"select id, tbl, key, before from {T.CHANGES} where write_id = %s order by id desc",
                                    (write_id,)).fetchall()
                    for cid, tbl, key, before in got:
                        table, col = TABLES[tbl]
                        c.execute(f"delete from {table} where {col} = %s", (key,))
                        if before is not None:
                            c.execute(f"insert into {table} select * from jsonb_populate_record(null::{table}, %s)",
                                      (json.dumps(RR._json(before)),))
                        c.execute(f"delete from {T.CHANGES} where id = %s", (cid,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("technology: the void of %s was not applied (%s)", write_id[:40], type(exc).__name__)
        return done
