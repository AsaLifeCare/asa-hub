"""Business Travel (Travel.gs) on Python behind its switch (`travel`): the trips (`travelTrips`, the travel_trips tab)
kept in Postgres once uploaded, each with its typed budget and actual cost, and the reimbursement requests shown
beside them as evidence (the Support Requests queue's staff_requests). travelList is here; the writes are in
app/travel_writes.py."""
from __future__ import annotations

import functools
from typing import Any, Callable

import candidates as CND
import finance as FIN
import gsjs
import locations as L
import resource_rows as RR

APP_ID = "travel"
RESOURCE = "travelTrips"
# 'declined' (we said no) and 'cancelled' (it fell apart) are different histories
STATUSES = ("proposed", "approved", "booked", "completed", "cancelled", "declined")
PURPOSES = ("Client visit", "Conference", "Training", "Audit", "Recruiting", "Other")
DENIED = {"status": 403, "message": "Requires an admin or manager account"}

s_ = gsjs.str_


def may_use(user: dict | None) -> bool:
    """travelMayUse_ (and travelMayDecide_, the same people)."""
    u = user or {}
    return bool(u) and not u.get("is_service") and s_(u.get("role")) in ("admin", "manager")


def trips(reads: L.Reads) -> list[dict[str, Any]]:
    """travelTrips_: every trip but the loader's demo rows, newest start first; read through the write's own cursor
    inside a write, so a save answers with itself in the list."""
    out = []
    for r in RR.read_all(reads, RESOURCE):
        if s_(r.get("id")).startswith("EX_"):
            continue
        budget, actual = FIN.num(r.get("budget")), FIN.num(r.get("actualCost"))
        out.append({"id": s_(r.get("id")), "destination": s_(r.get("destination")), "country": s_(r.get("country")),
                    "purpose": s_(r.get("purpose")), "status": s_(r.get("status")) or "proposed",
                    "startDate": s_(r.get("startDate")), "endDate": s_(r.get("endDate")),
                    "traveller": s_(r.get("traveller")), "requestedBy": s_(r.get("requestedBy")),
                    "reason": s_(r.get("reason")), "outcome": s_(r.get("outcome")),
                    "decisionNote": s_(r.get("decisionNote")), "travellerEmail": s_(r.get("travellerEmail")),
                    "budget": budget, "actualCost": actual,
                    # null until both exist: zero against zero means nobody has said
                    "variance": actual - budget if budget > 0 and actual > 0 else None,
                    "decidedBy": s_(r.get("decidedBy")), "decidedAt": s_(r.get("decidedAt"))})
    return sorted(out, key=functools.cmp_to_key(lambda a, b: gsjs.locale_cmp(b["startDate"], a["startDate"])))


def evidence(reads: L.Reads) -> list[dict[str, str]]:
    """travelEvidence_: the last forty reimbursement requests, newest first; none when the queue cannot be read."""
    out = []
    try:
        rows = CND.read_tab(reads, "staff_requests")
    except Exception:  # noqa: BLE001 - travelEvidence_'s catch: the trips stand without their evidence
        rows = []
    for r in rows:
        if "reimbursement" not in s_(r.get("type")).lower():
            continue
        out.append({"id": s_(r.get("id")), "type": s_(r.get("type")), "person": s_(r.get("personname")),
                    "from": s_(r.get("datefrom")), "to": s_(r.get("dateto")), "details": s_(r.get("details"))[:160],
                    "status": s_(r.get("status")), "at": s_(r.get("createdat"))})
    return list(reversed(out[-40:]))


def travel_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """travelList."""
    if not may_use(sess.user):
        return dict(DENIED)
    reads = sess.reads
    return {"status": 200, "data": {"trips": trips(reads), "statuses": list(STATUSES), "purposes": list(PURPOSES),
                                    "evidence": evidence(reads)}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"travelList": travel_list}
POLICY: dict[str, dict[str, Any]] = {"travelList": {"roles": ("admin", "manager")}}
