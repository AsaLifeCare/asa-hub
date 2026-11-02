"""The Meal tracker's writes (Meals.gs) kept in Postgres alone (app/resource_rows.py): an entry logged or removed, the
goals set — each the person's own (hubOwnedGate_), the goals row made on its first use as mealProfileOf_ made it;
mealsUpload brings meal_log and meal_profile into Postgres as the app is given to Python."""
from __future__ import annotations

import re
from typing import Any, Callable

import finance as FIN
import gsjs
import locations as L
import meals as ML
import resource_rows as RR
import sheet_resources as SR
import writes as W
from scope import Defer
from writes import Decision

BUSY = "Somebody else is saving right now — try again."
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")

s_ = gsjs.str_


def _owned(reads: L.Reads) -> None:
    for r in (ML.LOG, ML.PROFILE):
        if not RR.uploaded(reads.db, r):
            raise Defer(f"{r} is not uploaded to Postgres yet")


def _profile(sess: L.Session) -> dict[str, Any]:
    """mealProfileOf_ inside a write: the person's goals row, made from the seed when there is none."""
    hit = ML.profile_row(sess.reads, sess.user or {})
    if hit is not None:
        return ML.profile_of(hit[2])
    made = SR.create_row(sess, ML.PROFILE, dict(ML.SEED))
    if (made.answer or {}).get("status") != 200:
        return ML.profile_of(None)
    return ML.profile_of((made.answer or {}).get("data"))


def _day(sess: L.Session, day: str) -> dict[str, Any]:
    return ML.day_of(sess.reads, sess.user or {}, day, _profile(sess))


def log_add(sess: L.Session, payload: dict) -> Decision:
    """mealLogAdd: a meal (its time and macros), a glass of water (its ounces) or a supplement."""
    if not ML.may_use(sess.user):
        return Decision(dict(ML.DENIED))
    reads = sess.reads
    _owned(reads)
    p = payload if isinstance(payload, dict) else {}
    kind = s_(p.get("kind")) if s_(p.get("kind")) in ML.KINDS else "meal"
    day = s_(p.get("day"))
    if not _DAY.match(day):
        day = ML.today(reads)
    row: dict[str, Any] = {"kind": kind, "day": day, "at": W.now_iso(reads), "description": s_(p.get("description")),
                           "notes": s_(p.get("notes"))}
    if kind == "water":
        oz = FIN.num(p.get("amountOz"))
        if not oz > 0:
            return W.refuse(400, "How much did you drink?")
        row["amountOz"] = oz
    else:
        if not s_(p.get("description")).strip():
            return W.refuse(400, "What did you have?")
        if kind == "meal":
            row["mealTime"] = s_(p.get("mealTime")) if s_(p.get("mealTime")) in ML.TIMES else "Snack"
            for m in ML.MACROS:
                n = FIN.num(p.get(m))
                row[m] = 0 if n < 0 else n
    made = SR.create_row(sess, ML.LOG, row)
    if (made.answer or {}).get("status") != 200:
        return made
    added = s_(((made.answer or {}).get("data") or {}).get("id"))
    return Decision({"status": 200, "data": {**_day(sess, day), "added": added}}, subject="", own=True)


def log_remove(sess: L.Session, payload: dict) -> Decision:
    """mealLogRemove: one of the person's own entries removed."""
    if not ML.may_use(sess.user):
        return Decision(dict(ML.DENIED))
    reads = sess.reads
    _owned(reads)
    p = payload if isinstance(payload, dict) else {}
    rid = s_(p.get("id"))
    if not rid:
        return W.refuse(400, "Which entry?")
    gone = SR.delete_row(sess, ML.LOG, {"id": rid})
    if (gone.answer or {}).get("status") != 200:
        return gone
    day = s_(p.get("day")) or ML.today(reads)
    return Decision({"status": 200, "data": _day(sess, day)}, subject="", own=True)


def goals_set(sess: L.Session, payload: dict) -> Decision:
    """mealGoalsSet: the goals named, none below zero."""
    if not ML.may_use(sess.user):
        return Decision(dict(ML.DENIED))
    reads = sess.reads
    _owned(reads)
    p = payload if isinstance(payload, dict) else {}
    prof = _profile(sess)
    patch: dict[str, Any] = {"id": prof["id"]}
    for key in [ML.goal(m) for m in ML.MACROS] + ["goalWaterOz"]:
        if key in p:
            n = FIN.num(p.get(key))
            patch[key] = 0 if n < 0 else n
    done = SR.update_row(sess, ML.PROFILE, patch)
    if (done.answer or {}).get("status") != 200:
        return done
    return Decision({"status": 200, "data": ML.profile_of((done.answer or {}).get("data"))}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "mealLogAdd": log_add, "mealLogRemove": log_remove, "mealGoalsSet": goals_set,
    "mealsUpload": RR.upload_door({r: SR.SPECS[r] for r in (ML.LOG, ML.PROFILE)})}
# per-person: no roles, each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.meals_writes and _receipts; the log and the goals app.resource_rows."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="meals", label="Meal tracker")
