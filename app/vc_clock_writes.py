"""Transportation's clock, its write (VehicleCalendarFlows.gs vcClockTick_ → vcSendOwed_, vcToldRecord_): each text a
trip still owes said through Smart Comms under vcOwed_'s key — a stale one (the trip moved on) recorded and never
said — and the outcome kept on the trip's `told` in app.edits, in the same transaction."""
from __future__ import annotations

import logging
import time
from typing import Any, Callable

import hubdb
import locations as L
import smart_comms as SC
import transportation as TR
import transportation_flows as TF
import transportation_writes as TW
import vc_clock as VCK
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

BUSY = "Another write holds the platform's lock — the next pass tries again."

s_ = VCK.s_


def send_owed(reads: L.Reads, trip_id: str, entries: list[dict], trip_state: str) -> list[tuple[dict, dict]]:
    """vcSendOwed_: each owed text said now; a stale one (the trip moved on) is recorded and not said."""
    out = []
    for o in entries:
        if s_(o.get("while")) and trip_state and trip_state != s_(o.get("while")):
            out.append((o, {"state": "stale", "held": "", "why": "the trip moved on before it could be said"}))
            continue
        try:
            res = SC.raise_situation(None, situation=s_(o.get("sit")), to=TR.phone_of(reads, o.get("uid")),
                                     vars=o.get("vars") if isinstance(o.get("vars"), dict) else {},
                                     key=s_(o.get("key")), person=s_(o.get("name")), lane=TF.LANE,
                                     at_ms=int(TW.now_ms(reads)), prune=True)
        except (hubdb.Unreadable, Defer):
            raise
        except Exception as exc:  # noqa: BLE001 - vcSendOwed_: a text that throws is a failed one
            res = {"state": "failed", "held": "", "why": TF.vtext(str(exc) or type(exc).__name__, 240)}
        out.append((o, res or {"state": "failed", "held": "", "why": "no answer"}))
    return out


def told_apply(told: dict, entry: dict, res: dict, at: str) -> None:
    """vcToldApply_: the outcome under its bucket; a text the quiet window held stays owed for 08:00."""
    TF.told_apply(told, s_(entry.get("bucket")) or "ask", entry.get("uid"), res, at)
    if s_(res.get("held")) != "quiet":
        owed = told.get("owed") if isinstance(told.get("owed"), list) else []
        told["owed"] = [o for o in owed if not (isinstance(o, dict) and o.get("key") == entry.get("key"))]


def sweep(sess: L.Session, payload: dict) -> Decision:
    """vcClockTick_'s write: every owed text said inside the tick's budget, its outcome kept on its trip."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision(dict(VCK.DENIED))
    reads = sess.reads
    now = TW.now_ms(reads)
    if VCK.quiet(now):
        return Decision({"status": 200, "data": {"ran": False, "why": "quiet hours",
                                                 "next_at": VCK.iso_ms(VCK.next8(now))}})
    trips = VCK.owed_trips(reads)
    if not trips:
        return Decision({"status": 200, "data": {"ran": True, "said": 0}})
    W.gate(reads)
    tsid, ttab = TW.where(reads, VCK.TRIPS)
    started, stamp = time.time(), W.now_iso(reads)
    edits: list[dict | None] = []
    said, left, quiet = 0, 0, False
    for t in trips:
        owed = VCK.owed_of(t)
        if time.time() - started > VCK.TICK_BUDGET_S:
            left += len(owed)
            continue
        results = send_owed(reads, s_(t.get("id")), owed, s_(t.get("state")))
        told = TF.told_of(t.get("told"))
        for entry, res in results:
            told_apply(told, entry, res, stamp)
            quiet = quiet or s_(res.get("held")) == "quiet"
        said += len(results)
        now_row = {**t, "told": TW.json_text(told)}
        edits.append(TW.row_record(tsid, ttab, TW.HEADERS["vc_trips"], s_(t.get("id")), s_(t.get("id")), t, now_row,
                                   ""))
    kept = [e for e in edits if e]
    nxt = now + VCK.RETRY_MS if left or not kept else VCK.next8(now) if quiet else now + VCK.IDLE_MS
    log.info("vehicleCalendarClockSweep: %s said, %s left, %s trip(s) recorded", said, left, len(kept))
    return TW.kept({"status": 200, "data": {"ran": True, "said": said, "left": left, "recorded": len(kept),
                                            "next_at": VCK.iso_ms(nxt)}},
                   kept, "", TW.books(reads, VCK.TRIPS))


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"vehicleCalendarClockSweep": sweep}
POLICY: dict[str, dict[str, Any]] = {"vehicleCalendarClockSweep": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"vehicleCalendarClockSweep": {"status": 409, "message": BUSY}}
