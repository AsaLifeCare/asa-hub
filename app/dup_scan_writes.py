"""The daily pattern scan said (DuplicateScan.gs dupScanRun_, its sending half): under the platform's write lock the
scan's key is held for the hour, the plan is made again from the copy (the ledger asked again), each message goes
through the one send door (comms_rpc, rpcCall_'s answers) and, when one was told or written down, the day's ledger
line is kept; a held day stays unmarked so it is retried once the dial moves."""
from __future__ import annotations

from typing import Any, Callable

import clock_sweeps as CS
import comm_replies_writes as CRW
import comms_rpc as CR
import dup_scan as DS
import gsjs
import locations as L
import smart_comms as SC
import staff_views
from writes import Decision

BUSY = "Another write holds the platform's lock; the clock rings again."

s_ = gsjs.str_


def _log(action: str, detail: str, status: int = 200) -> None:
    """hubSysLog_('asa-hub:dupscan', …)."""
    staff_views.record({"email": DS.LOG_BY}, action, detail, status)


def sweep(sess: L.Session, payload: dict) -> Decision:
    """dupScanSweep: the day's scan, said once."""
    if not CS.service(sess):
        return Decision(dict(CS.DENIED))
    reads = sess.reads
    CS.hold(DS.THROTTLE_KEY, DS.EVERY_S)
    got = DS.plan(reads)
    out = got["out"]
    if got.get("unread") is not None:
        _log("dup_scan_unread", s_(got["unread"]), 500)
    if "sends" not in got:
        return Decision({"status": 200, "data": out}, subject="", own=True)
    sent = recorded = 0
    for send in got["sends"]:
        try:
            res = CR.refused_contract(send["name"], send["params"]) or \
                CR.call(reads, send["name"], send["params"], send["opts"])
        except Exception as exc:  # noqa: BLE001 - dupScanRun_'s catch: this message is not counted
            if CRW._db_fault(exc):
                raise
            continue
        if res.get("ok") and res.get("sent") and not res.get("redirected"):
            sent += 1
        # A recorded message counts as told, or the day is never marked and it repeats hourly.
        elif res.get("recorded_to"):
            recorded += 1
        elif res.get("gated") or res.get("redirected") or res.get("rehearsed"):
            out["held"] += 1
    out["told"] = sent
    out["recorded"] = recorded
    out["state"] = "told" if sent else "recorded" if recorded else "held" if out["held"] else "quiet"
    # A held day stays unmarked so it is retried once the dial moves.
    if (sent or recorded) and out.get("ledger_key"):
        SC.record_ledger(out["ledger_key"], DS.SITUATION, DS.LEDGER_PERSON, got["day"],
                         "recorded" if recorded and not sent else got["channel"], reads.db)
    _log("dup_scan", f"{out['scanned']} account(s) · {out['duplicates']} duplicate(s) · {out['told']} told · "
                     f"{out['held']} held · {got['detail']}")
    return Decision({"status": 200, "data": out}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"dupScanSweep": sweep}
POLICY: dict[str, dict[str, Any]] = {"dupScanSweep": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"dupScanSweep": {"status": 409, "message": BUSY}}


class Store(CS.Store):
    """app.dup_scan_writes and _receipts; the messages Smart Comms' outbox's, the ledger line app.edits', the scan's
    key app.clock_sweeps_state."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="dup_scan", label="The pattern scan")
