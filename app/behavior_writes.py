"""Behaviour support's writes (Behavior.gs behaviorEvaluate, behaviorCortexNote, behaviorSignalsIngest, and the
six-hourly composition on the relay's clock) kept in Postgres, in the signals' and the readings' own resources
(app.resource_rows): upserted by id, never deleted — a stale observation is answered by a newer one."""
from __future__ import annotations

from typing import Any, Callable

import behavior as B
import gsjs
import locations as L
import resource_rows as RR
import screening as SG
import staff_views
import writes as W
from scope import Defer
from writes import Decision

s_ = gsjs.str_


def upsert(reads: L.Reads, resource: str, incoming: list[dict[str, Any]], by: str) -> dict[str, Any]:
    """behaviorUpsert_ kept: the rows made and the moved cells changed, in one go each."""
    plan = B.upsert_plan(reads, resource, incoming, gsjs.iso(reads.now))
    if plan.get("error"):
        return plan
    RR.create_many(reads, resource, plan["creates"], by)
    RR.update_many(reads, resource, plan["updates"], by)
    return plan


def _kept_reading(reads: L.Reads, key: str, row: dict, plan: dict) -> dict[str, Any]:
    """The person's reading as the house now holds it."""
    for line in plan.get("creates") or []:
        if line.get("id") == row.get("id"):
            return B.reading_shape(key, line)
    for _k, cells, changed in plan.get("updates") or []:
        if cells.get("id") == row.get("id"):
            return B.reading_shape(key, {**cells, **changed})
    return B.reading_for(reads, key) or B.reading_shape(key, row)


def evaluate(sess: L.Session, payload: dict) -> Decision:
    """behaviorEvaluate: the reading behaviorEvaluatePrepare composed kept on the person's row (what the cortex said
    stays), or what the composition answered without one."""
    reads, user = sess.reads, sess.user or {}
    if not B.may_read(user):
        return Decision(dict(SG.DENIED))
    p = payload if isinstance(payload, dict) else {}
    prep = SG.unsealed("behaviorEvaluate", SG.actor(user), p.get("prepared"))
    if prep is None:
        raise Defer("behaviorEvaluate is recorded only after its reading was prepared by this service")
    key = s_(prep.get("key"))
    if key != B.subject_for(reads, user, p.get("subject_key")):
        raise Defer("the prepared reading names another person")
    row = prep.get("row")
    if not isinstance(row, dict):
        return Decision({"status": 200, "data": prep.get("data") or {}})
    plan = upsert(reads, B.READINGS, [row], s_(user.get("email")))
    if plan.get("error"):
        return W.refuse(400, plan["error"])
    out = {**_kept_reading(reads, key, row, plan), "state": "fresh"}
    staff_views.record(user, "behavior_reading", "a reading composed for " + s_(prep.get("name") or key) + " via "
                       + B.bstr(out.get("ai_via")))
    return Decision({"status": 200, "data": out}, subject=key, own=True)


def cortex_note(sess: L.Session, payload: dict) -> Decision:
    """behaviorCortexNote: what the cortex said kept on the person's row, shown until the button is pressed again;
    asking needs no composed reading, so the row is minted here when there is none."""
    reads, user = sess.reads, sess.user or {}
    if not B.may_read(user):
        return Decision(dict(SG.DENIED))
    p = payload if isinstance(payload, dict) else {}
    key = B.subject_for(reads, user, p.get("subject_key"))
    if not key:
        return W.refuse(400, "There is no account behind this session.")
    note = SG.js_slice(B.bstr(p.get("note")), 4000)
    if not note:
        return W.refuse(400, "Nothing to keep.")
    now = gsjs.iso(reads.now)
    row: dict[str, Any] = {"id": "BHR_" + key, "cortex_note": note, "cortex_at": now}
    if not any(B.bstr(r.get("subject_key")) == key for r in B.rows(reads, B.READINGS)):
        row.update(subject_key=key, subject_kind=B.bstr(p.get("subject_kind")) or "person",
                   subject_name=B.bstr(p.get("subject_name")))
    plan = upsert(reads, B.READINGS, [row], s_(user.get("email")))
    if plan.get("error"):
        return W.refuse(400, plan["error"])
    return Decision({"status": 200, "data": {"subject_key": key, "saved": True, "cortex_at": now}}, subject=key,
                    own=True)


def signals_ingest(sess: L.Session, payload: dict) -> Decision:
    """behaviorSignalsIngest: the relay's measured signals (or an admin's) upserted by id; behaviorSignalsPrepare's
    cleaned rows when the relay asked it first."""
    reads, user = sess.reads, sess.user or {}
    machine = SG.service(user)
    if not machine and s_(user.get("role")) != "admin":
        return Decision(dict(SG.DENIED))
    held = B.ingest_held(reads)
    if held:
        return Decision(held)
    p = payload if isinstance(payload, dict) else {}
    if p.get("prepared") is not None:
        prep = SG.unsealed("behaviorSignalsIngest", SG.actor(user), p.get("prepared"))
        if prep is None:
            raise Defer("the cleaned signals were not prepared by this service just now")
        clean, received = prep.get("rows") or [], int(prep.get("received") or 0)
    else:
        got = p.get("rows")
        if not isinstance(got, list) or not got:
            return W.refuse(400, "No rows — nothing was written.")
        clean, received = B.clean_signals(got, machine, s_(user.get("email"))), len(got)
    if not clean:
        return W.refuse(400, "No usable row — each needs id, subject_key and signal.")
    res = upsert(reads, B.SIGNALS, clean, "asa-hub:behavior" if machine else s_(user.get("email")))
    if res.get("error"):
        return W.refuse(400, res["error"])
    if res["updated"] or res["inserted"]:
        staff_views.record({"email": "asa-hub:behavior"} if machine else user, "behavior_signals_ingest",
                           f"{res['inserted']} signal(s) added, {res['updated']} refreshed, {res['unchanged']} "
                           f"unchanged — {res['writes']} write(s)")
    return Decision({"status": 200, "data": {"inserted": res["inserted"], "updated": res["updated"],
                                             "unchanged": res["unchanged"], "writes": res["writes"],
                                             "received": received, "kept": len(clean)}}, subject="", own=True)


def sweep(sess: L.Session, payload: dict) -> Decision:
    """The six-hourly composition on the relay's clock: the readings behaviorSweepDue composed, kept."""
    if not SG.service(sess.user):
        return W.refuse(403, "The behaviour sweep is the relay's alone.")
    p = payload if isinstance(payload, dict) else {}
    if isinstance(p.get("prepared"), dict) and p["prepared"].get("due") is False:
        return Decision({"status": 200, "data": {"made": 0}})
    got = SG.unsealed("behaviorSweep", "service", p.get("prepared"))
    if got is None:
        raise Defer("behaviorSweep is read by behaviorSweepDue first")
    rows = [r for r in got.get("rows") or [] if isinstance(r, dict)] if got.get("due") else []
    if not rows:
        return Decision({"status": 200, "data": {"made": 0}})
    plan = upsert(sess.reads, B.READINGS, rows, "asa-hub:behavior")
    if plan.get("error"):
        return W.refuse(400, plan["error"])
    staff_views.record({"email": "asa-hub:behavior"}, "behavior_reading", f"{len(rows)} reading(s) composed on the clock")
    return Decision({"status": 200, "data": {"made": len(rows)}}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "behaviorEvaluate": evaluate, "behaviorCortexNote": cortex_note, "behaviorSignalsIngest": signals_ingest,
    "behaviorSweep": sweep, "behaviorUpload": RR.upload_door({B.SIGNALS: {"tab": B.SIGNALS_TAB},
                                                              B.READINGS: {"tab": B.READINGS_TAB}})}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}
BUSY_OF["behaviorSignalsIngest"] = {"status": 409, "message": "The signal ingest is already running."}
BUSY_OF["behaviorEvaluate"] = {"status": 409, "message": "A reading is already being composed."}


class Store(RR.Store):
    """app.behavior_writes and app.behavior_receipts beside the other apps' own; the signals and the readings
    app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="behavior", label="Behaviour support")
