"""Marketing's write on Python (Marketing.gs marketingCompetitorAdd): a competitor added to the list in Postgres alone
(app/resource_rows.py), refused when the name is already tracked. marketingUpload brings marketing_competitors into
Postgres as the app is given to Python."""
from __future__ import annotations

from typing import Any, Callable

import gsjs
import locations as L
import marketing as M
import resource_rows as RR
import writes as W
from writes import Decision

BUSY = "Somebody else is changing the competitor list right now — try again."

s_ = gsjs.str_


def competitor_add(sess: L.Session, payload: dict) -> Decision:
    """marketingCompetitorAdd: one rival appended; the same company twice is two half-records, so a name already on
    the list is refused."""
    user = sess.user or {}
    if not M.may(user):
        return Decision(dict(M.DENIED))
    p = payload if isinstance(payload, dict) else {}
    name = s_(p.get("name")).strip()
    if not name:
        return W.refuse(400, "A competitor needs a name.")
    key = M.key_of(name)
    if any(M.key_of(r.get("name")) == key for r in M.competitors(sess.reads)):
        return W.refuse(409, f'"{name}" is already on the list.')
    val = {"id": W.mint(), "name": name, "aliases": s_(p.get("aliases")), "type": s_(p.get("type")) or "Provider",
           # an unverified tier is 'peer', never a guess: the tier drives the comparison
           "tier": s_(p.get("tier")) or "peer", "site": s_(p.get("site")), "facebook": s_(p.get("facebook")),
           "linkedin": s_(p.get("linkedin")), "location": s_(p.get("location")), "founded": s_(p.get("founded")),
           "revenue": s_(p.get("revenue")) or "—", "staff": s_(p.get("staff")) or "—",
           "served": s_(p.get("served")) or "—", "services": s_(p.get("services")), "funding": s_(p.get("funding")),
           "note": s_(p.get("note"))}
    RR.create(sess.reads, M.RESOURCE, {h: val[h] for h in M.HEADER if val[h]}, s_(user.get("email")))
    return Decision({"status": 200, "data": {"id": val["id"], "name": name}}, subject=val["id"], own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "marketingCompetitorAdd": competitor_add,
    "marketingUpload": RR.upload_door({M.RESOURCE: {"tab": M.TAB}})}
POLICY: dict[str, dict[str, Any]] = {"marketingCompetitorAdd": {"roles": ("admin", "manager", "staff")},
                                     "marketingUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.marketing_writes and app.marketing_receipts, beside the other apps' own; rows app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="marketing", label="Marketing")
