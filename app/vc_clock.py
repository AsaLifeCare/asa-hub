"""Transportation's clock on Python (VehicleCalendarFlows.gs vcClockTick_), rung by the relay instead of Apps Script's
hiring sweep: the texts a trip still owes (kept on its `told` by Apps Script's flows; Python's own flows say theirs at
once and Smart Comms' outbox owes what the quiet window holds). The look (vehicleCalendarClockDue) reads the trips off
asa-hub-db; its write (vc_clock_writes) says each owed text through Smart Comms and records the outcome on its trip."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import locations as L
import smart_comms as SC
import transportation_flows as TF
import transportation_writes as TW

APP_ID = "transportation"
DOOR = "vehicleCalendarClockDue"
DENIED = {"status": 403, "message": "This is the relay's own door."}
TRIPS = TW.TABS["trips"]
# VehicleCalendarFlows.gs
TICK_BUDGET_S = 4.0
RETRY_MS = 600000.0
IDLE_MS = 21600000.0

s_ = gsjs.str_


def iso_ms(ms: float) -> str:
    return gsjs.iso(datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc))


def quiet(ms: float) -> bool:
    """vcQuiet_ (hubQuietAt_)."""
    return SC.quiet_at(ms / 1000.0)


def next8(ms: float) -> float:
    """vcNext8_: the next 08:00 Ohio after `ms`."""
    return SC.quiet_end(ms / 1000.0) * 1000.0


def owed_of(trip: dict) -> list[dict]:
    """The texts a trip's `told` still owes."""
    got = TF.told_of(trip.get("told")).get("owed")
    return [o for o in got if isinstance(o, dict)] if isinstance(got, list) else []


def owed_trips(reads: L.Reads) -> list[dict]:
    """vcClockTick_'s read: every trip whose `told` still owes a text."""
    return [t for t in TW.tab_rows(reads, TRIPS) if owed_of(t)]


def due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """vcClockTick_'s look: whether any trip owes a text now (never inside the quiet window), and when to look next."""
    if (sess.user or {}).get("is_service") is not True:
        return dict(DENIED)
    reads = sess.reads
    if not reads.db.house_moved(TRIPS):
        return {"status": 200, "data": {"due": False, "why": "Transportation's trips house is not set up"}}
    now = TW.now_ms(reads)
    if quiet(now):
        return {"status": 200, "data": {"due": False, "quiet": True, "next_at": iso_ms(next8(now))}}
    trips = owed_trips(reads)
    return {"status": 200, "data": {"due": bool(trips), "quiet": False,
                                    "trips": [{"id": s_(t.get("id")), "owed": len(owed_of(t))} for t in trips],
                                    "next_at": iso_ms(now if trips else now + IDLE_MS)}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"vehicleCalendarClockDue": due}
POLICY: dict[str, dict[str, Any]] = {"vehicleCalendarClockDue": {}}
