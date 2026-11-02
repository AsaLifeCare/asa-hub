"""The lane mirrors kept (LaneMirror.gs laneMirrorSweepMaybe_ and laneMirrorAfterFiling_): under the platform's write
lock each house is planned again from the copy, and a house that differs from its book's newest rows is queued as one
book op (app/book_ops.py `mirror`) in this write's transaction — asa-hub-sheet-sync rewrites the house's Data tab
from it, whole, and the keeper reads it back. A house whose last rewrite the copy does not show yet waits for it. A
mirror that holds its house says so in the system log, as laneMirrorOne_ did."""
from __future__ import annotations

from typing import Any, Callable

import book_ops as BO
import clock_sweeps as CS
import gsjs
import house_tables as HT
import lane_mirror as LM
import locations as L
import staff_views
import writes as W
from writes import Decision

BUSY = "Another write holds the platform's lock; the clock rings again."

s_ = gsjs.str_


def _supersede(subject: str) -> None:
    """A rewrite of the same house still waiting is dropped (the newer one carries every row), and the rows of the
    ones already carried are let go — their fingerprints stay."""
    cur = W.HELD.get()
    cur.execute(f"update {BO.table()} set state = 'cancelled', done_at = now(), why = 'a newer rewrite carries it'"
                " where subject = %s and op = %s and state = 'pending'", (subject, LM.OP))
    cur.execute(f"update {BO.table()} set spec = spec - 'rows' where subject = %s and op = %s"
                " and state in ('done', 'refused', 'failed', 'cancelled') and spec ? 'rows'", (subject, LM.OP))


def _keep(reads: L.Reads, resources: list[str], action: str) -> dict[str, Any]:
    lines, ops = LM.mirror_all(reads, resources)
    rewritten = []
    for op in ops:
        if op.get("op") == LM.TABLE_OP:
            # a house kept in its own table: rewritten there, nothing left to carry; the same rows hold it
            if HT.rewrite(reads, op["tab"], op["lines"], LM.LOG_BY):
                rewritten.append(op["tab"])
            else:
                next(ln for ln in lines if ln["resource"] == op["tab"])["held"] = True
            continue
        _supersede(LM.subject(op["spec"]["resource"]))
        BO.queue([op], LM.subject(op["spec"]["resource"]), LM.LOG_BY, action)
        rewritten.append(op["spec"]["resource"])
    for line in lines:
        if line.get("state") == "mirrored":
            staff_views.record({"email": LM.LOG_BY}, "lane_mirrored", line["resource"] + ": " + s_(line.get("why")))
    return {"mirrored": lines, "rewrites": rewritten}


def sweep(sess: L.Session, payload: dict) -> Decision:
    """laneMirrorSweep: every mirror, the sweep's key held for LANE_MIRROR_EVERY_S."""
    if not CS.service(sess):
        return Decision(dict(CS.DENIED))
    CS.hold(LM.THROTTLE_KEY, LM.EVERY_S)
    return Decision({"status": 200, "data": _keep(sess.reads, list(LM.MIRRORS), "laneMirrorSweep")}, subject="",
                    own=True)


def after_filing(sess: L.Session, payload: dict) -> Decision:
    """laneMirrorAfterFiling: what a hotline filing just wrote, mirrored at once (the three lanes it files into
    unless `resources` names others)."""
    if not CS.service(sess):
        return Decision(dict(CS.DENIED))
    p = payload if isinstance(payload, dict) else {}
    named = p.get("resources") if isinstance(p.get("resources"), list) else list(LM.AFTER_FILING)
    return Decision({"status": 200, "data": _keep(sess.reads, [gsjs.or_text(r) for r in named],
                                                  "laneMirrorAfterFiling")}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"laneMirrorSweep": sweep,
                                                            "laneMirrorAfterFiling": after_filing}
POLICY: dict[str, dict[str, Any]] = {"laneMirrorSweep": {}, "laneMirrorAfterFiling": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(CS.Store):
    """app.lane_mirror_writes and _receipts; the houses' rewrites app.book_ops', the sweep's key
    app.clock_sweeps_state."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="lane_mirror", label="The lane mirrors")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    self.conn().execute(f"update {BO.table()} set state = 'cancelled', done_at = now(),"
                                        " why = 'its write was void' where write_id = %s and state = 'pending'",
                                        (write_id,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("lane mirror: the void of %s left its rewrite queued (%s)", write_id[:40],
                              type(exc).__name__)
        return done
