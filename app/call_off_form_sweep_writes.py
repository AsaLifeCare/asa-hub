"""The call-off form's call-offs answered (CommCallOffForm.gs callOffFormSweep_, its acting half): under the platform's
write lock the call-off house is read again, and each planned call-off it does not hold for that person and day yet
is answered by the lane (commCallOffRecorded_ as Python runs it for the hotline's filing, app/comm_call_off_form_
writes.py) — the person who called off, the house manager, the cover offer, everyone, and the 5558 group with the
reason, each page raised through Smart Comms in this write, the call-off house's row kept as an app.edits record —
five a turn at most. A pass that spends its seconds hands the call-offs it did not reach back in `left` with the
turn's count so far; the last pass logs the turn and hands the attendance rows back for the relay to press
(staffAttendancePunch, through Staff attendance's own lane)."""
from __future__ import annotations

import json
import time
from typing import Any, Callable

import call_off_form_sweep as CFS
import clock_sweeps as CS
import comm_call_off_form_writes as CFW
import gsjs
import locations as L
import staff_views
from writes import Decision

# a call-off begun past this is handed back: one call-off's pages take seconds, and the write's budget is seven
PASS_S = 3.0
BUSY = "Another write holds the platform's lock; the clock rings again."
COUNTS = ("rows", "acted", "duplicates", "old", "capped", "unnamed")

s_ = gsjs.str_
_db_fault = CFW._db_fault


def _why(exc: BaseException) -> str:
    """String((e && e.message) || e)."""
    return str(exc) or type(exc).__name__


def _out(prepared: dict, carried: Any) -> dict[str, Any]:
    """The turn's tally: the look's counts, or what the passes before this one carried."""
    src = carried if isinstance(carried, dict) else prepared.get("out") if isinstance(prepared.get("out"), dict) else {}
    out: dict[str, Any] = {k: int(src.get(k) or 0) for k in COUNTS}
    out["listed"] = dict(src.get("listed") or {}) if isinstance(src.get("listed"), dict) else {}
    out["why"] = [s_(w) for w in (src.get("why") or [])] if isinstance(src.get("why"), list) else []
    return out


def _log(out: dict[str, Any]) -> None:
    """hubSysLog_('asa-hub:calloffform', 'calloff_form_cross', …)."""
    capped = f" · {out['capped']} over the cap, next pass" if out["capped"] else ""
    staff_views.record({"email": CFS.LOG_BY}, "calloff_form_cross",
                       f"{out['rows']} form row(s) · {out['acted']} acted · {out['duplicates']} already known · "
                       f"{json.dumps(out['listed'], separators=(',', ':'))} listed only · {out['old']} older than "
                       f"{CFS.BACK_DAYS} days" + capped)


def sweep(sess: L.Session, payload: dict) -> Decision:
    """callOffFormSweep: the look's plan (`prepared`) carried — the sweep's key held for CALLOFF_FORM_EVERY_S, each
    call-off answered unless the house knows it or the turn's cap is reached."""
    if not CS.service(sess):
        return Decision(dict(CS.DENIED))
    p = payload if isinstance(payload, dict) else {}
    prepared = p.get("prepared") if isinstance(p.get("prepared"), dict) else {}
    reads = sess.reads
    CS.hold(CFS.THROTTLE_KEY, CFS.EVERY_S)
    out = _out(prepared, p.get("out"))
    if prepared.get("stop"):
        return Decision({"status": 200, "data": {"out": out}}, subject="", own=True)
    try:
        known = CFS.known_keys(reads)
    except Exception as exc:  # noqa: BLE001 - the call-off house's own sentence
        if _db_fault(exc):
            raise
        out["why"].append("the call-off house could not be read — nothing was acted on")
        return Decision({"status": 200, "data": {"out": out}}, subject="", own=True)
    plans = [x for x in (prepared.get("plans") or []) if isinstance(x, dict)]
    started = time.monotonic()
    edits: list[dict] = []
    left: list[dict] = []
    for i, c in enumerate(plans):
        key = s_(c.get("key"))
        if key in known:
            out["duplicates"] += 1
            continue
        # The cap counts sends; only call-offs send, so attendance rows are never held back by it.
        if out["acted"] >= CFS.MAX_PER_PASS:
            out["capped"] += 1
            continue
        if edits and time.monotonic() - started > PASS_S:
            left = plans[i:]
            break
        person, day, notes = s_(c.get("person")), s_(c.get("day")), gsjs.or_text(c.get("notes"))
        try:
            said, kept = CFW.recorded(reads, {"employee_name": person, "name_from": "person", "type": "Call Off",
                                              "date": day, "notes": notes},
                                      c.get("instance"), CFS.SOURCE,
                                      # The reason goes to the directors only, never into the URGENT OPEN SHIFT.
                                      {"reason": notes})
        except Exception as exc:  # noqa: BLE001 - this call-off's own sentence; the next pass reads it again
            if _db_fault(exc):
                raise
            out["why"].append(person + ": " + _why(exc))
            continue
        out["acted"] += 1
        known.add(key)
        edits += kept
        if said.get("why"):
            out["why"].append(f"{person} ({day}): " + s_(said["why"])[:120])
    data: dict[str, Any] = {"out": out}
    if left:
        data["left"] = left
        return Decision({"status": 200, "data": data}, edits=edits or None, subject="", own=True)
    att = prepared.get("attendance") if isinstance(prepared.get("attendance"), dict) else None
    if att is not None:
        if s_(att.get("why")):
            out["why"].append(s_(att["why"]))
        late, no_call = list(att.get("late") or []), list(att.get("no_call") or [])
        if late or no_call:
            data["handed"] = [{"action": "staffAttendancePunch", "payload": {"late": late, "no_call": no_call}}]
    _log(out)
    return Decision({"status": 200, "data": data}, edits=edits or None, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"callOffFormSweep": sweep}
POLICY: dict[str, dict[str, Any]] = {"callOffFormSweep": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"callOffFormSweep": {"status": 409, "message": BUSY}}


class Store(CS.Store):
    """app.call_off_form_sweep_writes and _receipts; the call-off house's rows app.edits', the messages Smart Comms'
    outbox's, the sweep's key app.clock_sweeps_state — a void takes them back, and the next turn answers again."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="call_off_form_sweep", label="The call-off form's crossing")
