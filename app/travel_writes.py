"""Business Travel's writes (Travel.gs) kept in Postgres alone (app/resource_rows.py): a trip proposed or edited
(travelSave: createRow_ / updateRowById_) and a decision with its name (travelDecide); travelUpload brings the
travel_trips tab into Postgres as the app is given to Python."""
from __future__ import annotations

import re
from typing import Any, Callable

import finance as FIN
import gsjs
import locations as L
import resource_rows as RR
import sheet_resources as SR
import staff_views
import travel as TR
import writes as W
from scope import Defer
from writes import Decision

BUSY = "Somebody else is changing the trips right now — try again."
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DECISIONS = ("approved", "declined", "cancelled", "booked")

s_ = gsjs.str_


def _owned(reads: L.Reads) -> None:
    if not RR.uploaded(reads.db, TR.RESOURCE):
        raise Defer(f"{TR.RESOURCE} is not uploaded to Postgres yet")


def _answer(d: Decision, reads: L.Reads, data: dict[str, Any]) -> Decision:
    """The generic write's own refusal as it stands, else this door's answer."""
    if (d.answer or {}).get("status") != 200:
        return d
    return Decision({"status": 200, "data": {**data, "trips": TR.trips(reads)}}, subject=d.subject, own=True)


def save(sess: L.Session, payload: dict) -> Decision:
    """travelSave: a trip proposed (requestedBy the person saving) or edited, its dates and numbers typed."""
    user = sess.user or {}
    if not TR.may_use(user):
        return Decision(dict(TR.DENIED))
    reads = sess.reads
    _owned(reads)
    p = payload if isinstance(payload, dict) else {}
    destination = s_(p.get("destination")).strip()
    if not destination:
        return W.refuse(400, "Where to?")
    if not s_(p.get("reason")).strip():
        return W.refuse(400, "Why is this trip needed? One line is enough.")
    status = s_(p.get("status")) if s_(p.get("status")) in TR.STATUSES else "proposed"
    purpose = s_(p.get("purpose")) if s_(p.get("purpose")) in TR.PURPOSES else "Other"
    start, end = s_(p.get("startDate")), s_(p.get("endDate"))
    if start and not _DAY.match(start):
        return W.refuse(400, "The start date must be YYYY-MM-DD.")
    if end and not _DAY.match(end):
        return W.refuse(400, "The end date must be YYYY-MM-DD.")
    if start and end and end < start:
        return W.refuse(400, "The trip ends before it starts.")
    fields = {"destination": destination, "country": s_(p.get("country")).strip(), "purpose": purpose,
              "status": status, "startDate": start, "endDate": end, "traveller": s_(p.get("traveller")).strip(),
              "travellerEmail": s_(p.get("travellerEmail")).strip().lower(), "reason": s_(p.get("reason")).strip(),
              "outcome": s_(p.get("outcome")).strip(), "budget": FIN.num(p.get("budget")),
              "actualCost": FIN.num(p.get("actualCost"))}
    if s_(p.get("id")):
        rid = s_(p.get("id"))
        d = SR.update_row(sess, TR.RESOURCE, {"id": rid, **fields})
        if (d.answer or {}).get("status") == 200:
            staff_views.record(user, "travelSave", destination)
        return _answer(d, reads, {"id": rid})
    fields["requestedBy"] = s_(user.get("display_name")) or s_(user.get("email"))
    d = SR.create_row(sess, TR.RESOURCE, fields)
    if (d.answer or {}).get("status") == 200:
        staff_views.record(user, "travelSave", destination)
    return _answer(d, reads, {"id": s_(((d.answer or {}).get("data") or {}).get("id"))})


def decide(sess: L.Session, payload: dict) -> Decision:
    """travelDecide: approved, declined, cancelled or booked, with who decided and when; its note in its own column."""
    user = sess.user or {}
    if not TR.may_use(user):
        return Decision(dict(TR.DENIED))
    reads = sess.reads
    _owned(reads)
    p = payload if isinstance(payload, dict) else {}
    rid, status = s_(p.get("id")), s_(p.get("status"))
    if not rid:
        return W.refuse(400, "Which trip?")
    if status not in DECISIONS:
        return W.refuse(400, "A decision is approved, declined, cancelled or booked.")
    hit = SR._found(reads, TR.RESOURCE, rid)
    if hit is None:
        return W.refuse(404, f'No "{TR.RESOURCE}" record with id "{rid}".')
    row = hit[2]
    if status == "booked" and s_(row.get("status")) not in ("approved", "booked"):
        return W.refuse(400, "Only an approved trip can be marked booked.")
    d = SR.update_row(sess, TR.RESOURCE, {"id": rid, "status": status,
                                          "decidedBy": s_(user.get("display_name")) or s_(user.get("email")),
                                          "decidedAt": W.now_iso(reads),
                                          "decisionNote": s_(p.get("note")) or s_(row.get("decisionNote"))})
    if (d.answer or {}).get("status") == 200:
        staff_views.record(user, "travelDecide", s_(row.get("destination")))
    return _answer(d, reads, {})


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "travelSave": save, "travelDecide": decide,
    "travelUpload": RR.upload_door({TR.RESOURCE: SR.SPECS[TR.RESOURCE]})}
POLICY: dict[str, dict[str, Any]] = {"travelSave": {"roles": ("admin", "manager")},
                                     "travelDecide": {"roles": ("admin", "manager")}, "travelUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.travel_writes and _receipts; the trips app.resource_rows."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="travel", label="Business Travel")
