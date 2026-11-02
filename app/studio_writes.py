"""App Studio's places written (Studio.gs tenantUpsert): a place added or its cells changed, decided off asa-hub-db and
kept in app.edits — final in Postgres, carried to the tenants tab by the two-way sync, which Apps Script's place
resolution reads."""
from __future__ import annotations

import secrets
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import studio as ST
import writes as W
from scope import Defer
from writes import Decision

BUSY = "Somebody else is changing the places right now — try again."
# tenantUpsert's own cells, each found by normKey_ in the tab's header
EDITED = ("name", "type", "city", "state", "status", "since")

s_ = gsjs.str_


def _where(reads: L.Reads) -> tuple[str, str, hubdb.TabRef]:
    res = ST.tenants_tab(reads)
    if res.ref is None:
        raise Defer("the tenants tab is not in the copy: ensureTab_ makes it")
    sid, tab = W.where_of(res)
    return sid, tab, res.ref


def _raw(ref: hubdb.TabRef, raw: dict) -> dict[str, str]:
    """A row's cells as the copy keeps their text: what an edit names as the sheet's value before it."""
    return {h: gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(h), "raw"))) for h in ref.headers if h}


def upsert(sess: L.Session, payload: dict) -> Decision:
    """tenantUpsert: a place's named cells set (staffCount and clientCount as whole numbers), else a new place, active,
    stamped with its maker."""
    user = sess.user or {}
    reads = sess.reads
    away = ST.away_refused(reads, user, "tenantUpsert")
    if away:
        return Decision(away)
    if not user.get("is_service") and s_(user.get("role")) != "admin":
        return W.refuse(403, "This action is for admin.")
    if s_(user.get("role")) != "admin":
        return Decision(dict(ST.DENIED))
    p = payload if isinstance(payload, dict) else {}
    sid, tab, ref = _where(reads)
    rid, name = s_(p.get("id")), s_(p.get("name"))
    if not rid and not name:
        return W.refuse(400, "tenant name required")
    id_head = W.header_of(ref, "tenantid", norm=True)
    if rid:
        fresh = (sid,)
        hits = [_raw(ref, raw) for _rn, raw in reads.db.rows(ref)]
        hits = [was for was in hits if id_head is not None and was.get(id_head) == rid]
        if not hits:
            return W.refuse(404, f'No tenant "{rid}".', fresh=fresh)
        # an edit kept in app.edits names its row by the id alone
        if len(hits) > 1:
            return W.refuse(409, W.NOT_TOLD_APART, fresh=fresh)
        cells: dict[str, Any] = {}
        for k in EDITED:
            head = W.header_of(ref, hubdb.norm_key(k), norm=True)
            if k in p and head is not None:
                cells[head] = s_(p.get(k))
        for k, key in (("staffCount", "staffcount"), ("clientCount", "clientcount")):
            head = W.header_of(ref, key, norm=True)
            if k in p and head is not None:
                cells[head] = ST.int0(p.get(k))
        was = hits[0]
        edits =[W.kept_record(sid, tab, "edit", W.COLS + id_head, rid, rid, cells,
                               before={k: was.get(k, "") for k in cells})] if cells else []
        d = W.final({"status": 200, "data": {"id": rid}}, edits, rid)
        d.fresh = fresh
        return d
    now = reads.now
    new_id = "ten_" + hubdb.norm_key(name)[:16] + "_" + secrets.token_hex(2)
    rec = {"tenant_id": new_id, "name": name, "type": s_(p.get("type")) or "franchise", "city": s_(p.get("city")),
           "state": s_(p.get("state")), "status": "active", "staff_count": ST.int0(p.get("staffCount")),
           "client_count": ST.int0(p.get("clientCount")),
           "since": s_(p.get("since")) or str(now.astimezone(gsjs.NY).year),
           "created_at": gsjs.iso(now), "created_by": "asa-hub:" + gsjs.or_blank(user.get("email"))}
    # appendRow is positional: each value under the header ensureTab_ gave its place
    heads = {h: W.header_of(ref, h) for h in rec}
    if any(h is None for h in heads.values()):
        raise Defer("a place naming a column the tenants tab does not have")
    cells = {heads[h]: v for h, v in rec.items()}
    edits = [W.kept_record(sid, tab, "append", W.COLS + heads["tenant_id"], new_id, new_id, cells)]
    return W.final({"status": 200, "data": {"id": new_id}}, edits, new_id)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"tenantUpsert": upsert}
# the door's own gates run in doPost's order: the place law, then the declared role
POLICY: dict[str, dict[str, Any]] = {"tenantUpsert": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.studio_writes and app.studio_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="studio", label="App Studio")
