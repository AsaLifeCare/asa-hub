"""The relay's PSI attendance loop (server/snapshot_service.py _psi_attendance_loop), in the app, and the routes that read
its memory. Every minute, in the relay's order:

  the time clock          psi_attendance.tick: the collection from PsiAnywhere on the login plan and its latch
                          (app/psi_anywhere.py, /srv/snapshot/.psi-login-clock.json), the entry history
                          (psi_entries), the punch board and the shift flow's plan; then the pairs (punch_pairs, its
                          shifts paired in this process's memory)
  the same beat           the shift pool (transfers finished, time off settled and its form rows, the pool's sweep), the
                          shift flow's texts (psi_reminders), transfers, time off, the punch pairs' texts, Support
                          Requests' missing punches, the pool's notices, covered open shifts, the recruit book (its
                          files on /srv/snapshot/recruit) and Calendar Builder's call-offs
  after it                the late and no-call rows to staff attendance; after a collection, and hourly, the full punch
                          sheet (psi_punches_full, the clients present asked on the lane's session)

Every post is one of the app's own doors asked in-process as the relay's identity asked it (app/clocks.py), so every
message is Smart Comms' to send, hold or rehearse, with test mode and messages_paused as they stand. A wake the relay's
/lanes/told took for these clocks ("attendance", "calloff_road") is answered here (live_notify.LOCAL_WAKES).

Answered here, from this memory: GET /hub-lanes/psi/health, POST /psi/health and POST /hub-lanes/punch-warnings/received.

While the PsiAnywhere credential is not mounted in this container the time clock is held whole: nothing is collected,
no login is sent, the login clock and the lane's state are not written, and the passes that stand on its board (the
shift flow's texts, the punch pairs' texts, the missing punches, the attendance rows, the full sheet) wait with it; the
rest of the beat runs. HUB_APP_CLOCKS=off starts none of it."""
from __future__ import annotations

import asyncio
import concurrent.futures
import contextlib
import hashlib
import hmac
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine

from fastapi import Request
from fastapi.responses import Response

import calloff_road
import clocks
import effective_roster
import house_directory
import lane_gate as LG
import lanes_pg
import live_notify
import open_shift_covered
import psi_anywhere
import psi_attendance
import psi_punches_full
import psi_reminders
import punch_board_slices
import punch_pairs
import recruit_book
import shift_handoff
import shift_requests
import time_off

log = logging.getLogger("asa-hub-app.attendance")

PG_DSN = "asa-hub-db"
EVERY_S = 60.0
FULL_EVERY_S = 3600.0
SERVICE_SECRET = os.getenv("HUB_SERVICE_SECRET", "")
THREADS = 2

STAFF_ALERTS_APP = "staff-alerts"
HIRING_APP = "hiring"
OPEN_SHIFT_COVERED_APP = "open-shift-covered"
COMM_RECRUIT_APP = "comm-recruit"
COMM_CALL_OFF_FORM_APP = "comm-call-off-form"
SUPPORT_PUNCH_APP = "support-punch"
SUPPORT_DESK_EVENT = "support-desk"
GATE_APP = "smartcomms"
FULL_WAIT_S = 300.0

# passes one hand-over of rows may take before the rows still handed back answer as the door's budget did
ROW_PASSES = 6
LANE_PASSES = 30
# what openShiftCovered and recruitTell answer for a row their execution never started
COVERED_LATE = {"state": "not_yet", "why": "this execution spent its time on the rows before it; the relay offers it "
                                           "again"}
RECRUIT_LATE = {"state": "failed", "why": COVERED_LATE["why"]}
SUPPORT_PUNCH_MAX = 200
SUPPORT_PUNCH_OFF_RETRY_S = 600.0
PUNCH_RECEIVED_STATUS = {"no_name": 403, "not_a_director": 403, "own_shift": 403,
                         "no_such_warning": 404, "not_waiting": 409, "several": 409,
                         "never_delivered": 409, "stood_down": 409, "already": 409}

_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=THREADS, thread_name_prefix="attendance")
_TASKS: set[asyncio.Task] = set()
_LOOP: list[asyncio.AbstractEventLoop | None] = [None]
_HELD: dict[str, Any] = {"why": None}
_SUPPORT_PUNCH: dict[str, Any] = {"digest": "", "off_digest": "", "off_at": 0.0}
_PSI_FULL: dict[str, Any] = {"said": "", "task": None, "again": "", "at": 0.0, "failures": 0}
_TIME_OFF_FORM_HELD: list[str] = [""]
_CALLOFF_LOCK: list[asyncio.Lock | None] = [None]


def spawn(coro: Coroutine[Any, Any, Any]) -> asyncio.Task:
    """A task held until it ends, and ended with the loop."""
    task = asyncio.get_running_loop().create_task(coro)
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    return task


async def _run(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """asyncio.to_thread on the loop's own threads; each call leaves nothing open on its connections."""
    def call() -> Any:
        try:
            return fn(*args, **kwargs)
        finally:
            lanes_pg.finish()
    return await asyncio.get_running_loop().run_in_executor(_POOL, call)


# ---- what a pass changed, told -----------------------------------------------------------------------------------

def _notices_wake() -> None:
    live_notify.tell(wake=["notices"])


def _housecal_rang() -> None:
    live_notify.tell(events=["housecal"])


def _time_off_changed() -> None:
    """A write owes the Builder's Requests slice, the bell and the calendars a look now."""
    live_notify.tell(resources=["calendarRequests"], wake=["notices"], events=["housecal"], forget=["time_off"])


def roster_moved() -> None:
    """A house calendar was published: the time clock re-reads the roster next beat (thread-safe)."""
    psi_attendance.roster_moved()


def _roster_published(_event: dict[str, Any]) -> None:
    roster_moved()


def calloff_road_kick() -> None:
    """A Builder call-off marked now is filed now, not at the next beat (thread-safe)."""
    loop = _LOOP[0]
    if loop is None:
        return
    try:
        loop.call_soon_threadsafe(lambda: spawn(_calloff_road_post()))
    except RuntimeError:
        pass


# ---- the doors -----------------------------------------------------------------------------------------------------

async def _staff_door(action: str, payload: dict[str, Any]) -> dict[str, Any]:
    """_staff_door: Staff attendance's own lane, as the service; raises when Python did not answer."""
    return await clocks.service_door(STAFF_ALERTS_APP, action, payload)


async def _row_passes(app_id: str, action: str, rows: list[dict], late: dict[str, str]) -> dict[str, Any]:
    """_backend_row_passes: a door that answers one result per row, pass after pass while it hands rows back; the
    results together, a row no pass started answered as the door's own budget answered it."""
    said: dict[str, Any] = {"results": [], "counts": {}, "dial": ""}
    left = rows
    for _ in range(ROW_PASSES):
        env = await clocks.one_pass(app_id, action, {"rows": left})
        if env.get("status") != 200:
            if not said["results"]:
                return env
            break
        data = env.get("data") or {}
        said["results"] += data.get("results") or []
        for k, n in (data.get("counts") or {}).items():
            said["counts"][k] = said["counts"].get(k, 0) + int(n or 0)
        said["dial"] = data.get("dial") or said["dial"]
        left = data.get("left") or []
        if not left:
            return {"status": 200, "data": said}
    for r in left:
        said["results"].append({"id": str((r or {}).get("id") or ""), "count": "", **late})
        said["counts"][late["state"]] = said["counts"].get(late["state"], 0) + 1
    return {"status": 200, "data": said}


def _note_dial(env: dict[str, Any] | None) -> None:
    data = (env or {}).get("data") or {}
    shift_handoff.note_dial(data.get("dial"), data.get("test_mode"))


# ---- the shift pool ------------------------------------------------------------------------------------------------

async def _time_off_sweep() -> None:
    """The minute's pass: effects owed, expiries, approvers owed a read, and new Google Form rows."""
    try:
        said = await _run(time_off.settle, PG_DSN)
        if said.get("settled") or said.get("expired") or said.get("recomputed"):
            log.info("time off: %s settled, %s expired, %s approvers read again", said.get("settled"),
                     said.get("expired"), said.get("recomputed"))
            _time_off_changed()
    except Exception as exc:  # noqa: BLE001
        log.warning("time off: the pass failed (%s)", type(exc).__name__)
    try:
        synced = await _run(time_off.form_sync, PG_DSN)
        if synced.get("added"):
            log.info("time off: %s Google Form row(s) added as requests", synced["added"])
            _time_off_changed()
        held_why = str(synced.get("why") or "") if synced.get("skipped") == "directors unreadable" else ""
        if held_why and held_why != _TIME_OFF_FORM_HELD[0]:
            log.warning("time off: the form sync waits — %s", held_why)
        _TIME_OFF_FORM_HELD[0] = held_why
    except Exception as exc:  # noqa: BLE001
        log.warning("time off: the form sync failed (%s)", type(exc).__name__)


async def _shift_pool_sweep() -> None:
    """KEEP THE SHIFT POOL LEVEL WITH THE WORLD, once a minute."""
    try:
        finished = await _run(shift_handoff.complete_ready, PG_DSN)
        moved = sum(int(finished.get(k) or 0) for k in ("done", "dead", "expired", "called_off"))
        if moved:
            log.info("shift handoff: %s completed, %s ended, %s still waiting; %s expired at the "
                     "shift's start, %s ended by a call-off", finished.get("done"),
                     finished.get("dead"), finished.get("waiting"), finished.get("expired"),
                     finished.get("called_off"))
            _notices_wake()
            _housecal_rang()
    except Exception as exc:  # noqa: BLE001
        log.warning("shift handoff: the completions could not be run (%s)", type(exc).__name__)
    await _time_off_sweep()
    try:
        said = await _run(shift_requests.sweep, PG_DSN)
    except Exception as exc:  # noqa: BLE001
        log.warning("shift pool: the sweep failed (%s)", type(exc).__name__)
        return
    if said.get("opened") or said.get("closed"):
        log.info("shift pool: %s opened, %s filled, %s in the pool (%s from call-offs)",
                 said.get("opened"), said.get("closed"), said.get("pool"), said.get("call_offs"))
        _notices_wake()
        _housecal_rang()


# ---- the texts through staffShiftReminder ----------------------------------------------------------------------------

async def _psi_reminders_post() -> None:
    """THE SHIFT FLOW, HANDED TO THE DOOR (the ask before every shift and its repeats, the house manager told…)."""
    for _post in range(max(1, psi_reminders.POSTS_PER_BEAT)):
        try:
            offer = await _run(psi_reminders.pending, time.time())
        except Exception as exc:  # noqa: BLE001
            log.warning("psi reminders: the owed rows could not be read (%s)", type(exc).__name__)
            return
        if not offer:
            return
        try:
            env = await _staff_door("staffShiftReminder", {"rows": offer["rows"]})
        except Exception as exc:  # noqa: BLE001
            await _run(psi_reminders.post_failed, time.time())
            log.warning("psi reminders: the door could not be reached (%s) — the rows stay owed",
                        type(exc).__name__)
            return
        if (env or {}).get("status") != 200:
            await _run(psi_reminders.post_failed, time.time())
            log.warning("psi reminders refused: %s — the rows stay owed",
                        str((env or {}).get("message") or env)[:160])
            return
        said = (env or {}).get("data") or {}
        # the dial as the door said it: a rehearsed ask is re-offered only once it moves
        _note_dial(env)
        counts = await _run(psi_reminders.posted, offer["ids"], said, time.time())
        log.info("psi reminders: %s row(s) offered → %s", len(offer["ids"]),
                 ", ".join(f"{n} {k}" for k, n in sorted(counts.items())) or "no answer per row")


async def _shift_handoff_post() -> None:
    """The transfer's messages through staffShiftReminder; only a real outcome closes an ask (mark_said / owed)."""
    try:
        rows = await _run(shift_handoff.owed, PG_DSN)
    except Exception as exc:  # noqa: BLE001
        log.warning("shift handoff: the owed rows could not be read (%s)", type(exc).__name__)
        return
    if not rows:
        return
    try:
        env = await _staff_door("staffShiftReminder", {"rows": rows})
    except Exception as exc:  # noqa: BLE001
        log.warning("shift handoff: the door could not be reached (%s) — the rows stay owed", type(exc).__name__)
        return
    if (env or {}).get("status") != 200:
        log.warning("shift handoff refused: %s — the rows stay owed", str((env or {}).get("message") or env)[:160])
        return
    said = (env or {}).get("data") or {}
    try:
        wrote = await _run(shift_handoff.mark_said, PG_DSN, [str(r["id"]) for r in rows], said)
    except Exception as exc:  # noqa: BLE001
        log.warning("shift handoff: the ledger could not be written (%s)", type(exc).__name__)
        return
    counts: dict[str, int] = {}
    for r in said.get("results") or []:
        state = str((r or {}).get("state") or "no answer")
        counts[state] = counts.get(state, 0) + 1
    log.info("shift handoff: %s row(s) offered → %s; %s written down", len(rows),
             ", ".join(f"{n} {k}" for k, n in sorted(counts.items())) or "no answer per row", wrote)


async def _time_off_post() -> None:
    """Time off's asks and answers through staffShiftReminder; only a real outcome closes one."""
    try:
        rows = await _run(time_off.owed, PG_DSN)
    except Exception as exc:  # noqa: BLE001
        log.warning("time off: the owed rows could not be read (%s)", type(exc).__name__)
        return
    if not rows:
        return
    try:
        env = await _staff_door("staffShiftReminder", {"rows": rows})
    except Exception as exc:  # noqa: BLE001
        log.warning("time off: the door could not be reached (%s) — the rows stay owed", type(exc).__name__)
        return
    if (env or {}).get("status") != 200:
        log.warning("time off refused: %s — the rows stay owed", str((env or {}).get("message") or env)[:160])
        return
    said = (env or {}).get("data") or {}
    try:
        wrote = await _run(time_off.mark_said, PG_DSN, [str(r["id"]) for r in rows], said, rows)
    except Exception as exc:  # noqa: BLE001
        log.warning("time off: the ledger could not be written (%s)", type(exc).__name__)
        return
    log.info("time off: %s row(s) offered, %s written down", len(rows), wrote)


async def _punch_pairs_post() -> None:
    """The pair rule's messages and its warnings, on the one shift door."""
    try:
        rows = await _run(punch_pairs.owed, PG_DSN)
    except Exception as exc:  # noqa: BLE001
        log.warning("punch pairs: the owed rows could not be read (%s)", type(exc).__name__)
        return
    if not rows:
        return
    try:
        env = await _staff_door("staffShiftReminder", {"rows": rows})
    except Exception as exc:  # noqa: BLE001
        log.warning("punch pairs: the door could not be reached (%s) — the rows stay owed", type(exc).__name__)
        return
    if (env or {}).get("status") != 200:
        log.warning("punch pairs refused: %s — the rows stay owed", str((env or {}).get("message") or env)[:160])
        return
    said = (env or {}).get("data") or {}
    try:
        wrote = await _run(punch_pairs.mark_said, PG_DSN, [str(r["id"]) for r in rows], said)
    except Exception as exc:  # noqa: BLE001
        log.warning("punch pairs: the ledger could not be written (%s)", type(exc).__name__)
        return
    log.info("punch pairs: %s row(s) offered, %s written down", len(rows), wrote)


async def _shift_requests_post() -> None:
    """THE HOUSE MANAGER IS TOLD WHEN A WINDOW CLOSES WITH PEOPLE ON IT."""
    try:
        rows = await _run(shift_requests.owed, PG_DSN)
    except Exception as exc:  # noqa: BLE001
        log.warning("shift requests: the owed rows could not be read (%s)", type(exc).__name__)
        return
    if not rows:
        return
    try:
        env = await _staff_door("staffShiftReminder", {"rows": rows})
    except Exception as exc:  # noqa: BLE001
        log.warning("shift requests: the door could not be reached (%s) — the rows stay owed", type(exc).__name__)
        return
    if (env or {}).get("status") != 200:
        log.warning("shift requests refused: %s — the rows stay owed", str((env or {}).get("message") or env)[:160])
        return
    _note_dial(env)
    try:
        wrote = await _run(shift_requests.mark_said, PG_DSN, [str(r["id"]) for r in rows],
                           (env or {}).get("data") or {})
    except Exception as exc:  # noqa: BLE001
        log.warning("shift requests: the ledger could not be written (%s)", type(exc).__name__)
        return
    log.info("shift requests: %s notice(s) offered, %s written down", len(rows), wrote)


# ---- Support Requests' missing punches -------------------------------------------------------------------------------

def _support_punch_digest(rows: list[dict]) -> str:
    """One word for a set of faults: its shifts and each one's verdict."""
    return hashlib.sha256("\n".join(sorted(f"{r.get('id')}|{r.get('verdict')}" for r in rows)).encode()).hexdigest()


async def _support_punch_passes(rows: list[dict]) -> dict[str, Any]:
    """supportDeskPunch, pass after pass while it hands faults back: the counts together, and not ok while a fault is
    left unjudged, so the beat offers them all again."""
    said: dict[str, Any] = {"ok": True, "raised": 0, "already": 0, "off": False, "why": ""}
    left = rows
    for _ in range(ROW_PASSES):
        env = await clocks.one_pass(SUPPORT_PUNCH_APP, "supportDeskPunch", {"rows": left})
        if env.get("status") != 200:
            return env
        data = env.get("data") or {}
        for k in ("raised", "already"):
            said[k] += int(data.get(k) or 0)
        said["off"], said["why"] = bool(data.get("off")), str(data.get("why") or "")
        if data.get("ok") is not True:
            said["ok"] = False
            return {"status": 200, "data": said}
        left = data.get("left") or []
        if not left:
            return {"status": 200, "data": said}
    said.update(ok=False, why=f"{len(left)} fault(s) unjudged after {ROW_PASSES} passes")
    return {"status": 200, "data": said}


async def _support_punch_post() -> None:
    """The punch board's faults, handed to Support Requests (supportDeskPunch), which decides what is a first…"""
    try:
        if punch_pairs.stale(datetime.now(timezone.utc)):
            return
        rows = punch_pairs.first_faults()
    except Exception as exc:  # noqa: BLE001
        log.warning("support punch: the faults could not be read (%s)", type(exc).__name__)
        return
    if not rows:
        _SUPPORT_PUNCH["digest"] = ""
        return
    rows = sorted(rows, key=lambda r: (str(r.get("shift_at") or ""), str(r.get("id") or "")),
                  reverse=True)[:SUPPORT_PUNCH_MAX]
    digest = _support_punch_digest(rows)
    if digest == _SUPPORT_PUNCH["digest"]:
        return
    if digest == _SUPPORT_PUNCH["off_digest"] and time.time() - _SUPPORT_PUNCH["off_at"] < SUPPORT_PUNCH_OFF_RETRY_S:
        return
    try:
        env = await _support_punch_passes(rows)
    except Exception as exc:  # noqa: BLE001
        log.warning("support punch: the door could not be reached (%s) — offered again", type(exc).__name__)
        return
    if (env or {}).get("status") != 200:
        log.warning("support punch refused: %s — offered again", str((env or {}).get("message") or env)[:160])
        return
    said = (env or {}).get("data") or {}
    if not isinstance(said, dict) or said.get("ok") is not True:
        log.warning("support punch: the door did not take the faults — offered again")
        return
    if said.get("off"):
        _SUPPORT_PUNCH.update(off_digest=digest, off_at=time.time())
        log.info("support punch: %s fault(s) offered, the switch is off", len(rows))
        return
    _SUPPORT_PUNCH.update(digest=digest, off_digest="", off_at=0.0)

    def count(v: Any) -> int:
        return len(v) if isinstance(v, (list, tuple)) else v if isinstance(v, int) and not isinstance(v, bool) else 0

    log.info("support punch: %s fault(s) offered, %s raised, %s already raised", len(rows),
             count(said.get("raised")), count(said.get("already")))
    if count(said.get("raised")):
        live_notify.tell(events=[SUPPORT_DESK_EVENT])


# ---- the pool's notices, covered open shifts, the recruit book, the Builder's call-offs -----------------------------

async def _open_shift_covered_post() -> None:
    """Hand owed "covered" follow-ups to openShiftCovered; what the door did not say stays owed."""
    try:
        noted = await _run(open_shift_covered.note_from_pool, PG_DSN)
        rows = await _run(open_shift_covered.owed, PG_DSN)
    except Exception as exc:  # noqa: BLE001
        log.warning("open shift covered: the owed fills could not be read (%s)", type(exc).__name__)
        return
    if noted:
        log.info("open shift covered: %s fill(s) the claims road left, noted", noted)
    if not rows:
        return
    failure = ""
    said: dict[str, Any] = {}
    try:
        env = await _row_passes(OPEN_SHIFT_COVERED_APP, "openShiftCovered", rows, COVERED_LATE)
        if (env or {}).get("status") != 200:
            failure = f"the door refused: {str((env or {}).get('message') or env)[:160]}"
        else:
            said = (env or {}).get("data") or {}
    except Exception as exc:  # noqa: BLE001
        failure = f"the door could not be reached ({type(exc).__name__})"
    try:
        wrote = await _run(open_shift_covered.mark, PG_DSN, rows, said, failure=failure)
    except Exception as exc:  # noqa: BLE001
        log.warning("open shift covered: the ledger could not be written (%s)", type(exc).__name__)
        return
    counts = (said or {}).get("counts") or {}
    log.info("open shift covered: %s fill(s) offered → %s%s", len(rows),
             ", ".join(f"{n} {k}" for k, n in sorted(counts.items())) or "no answer per row",
             f" — {failure}" if failure else f" ({wrote} written down)")


async def _calloff_calendar(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """callOffFromCalendar: pass after pass while it hands call-offs back, the rows each pass filed together; a ref no
    pass reached is not named, so it stays owed."""
    said: list[dict[str, Any]] = []
    test_mode: Any = None
    left = rows
    env: dict[str, Any] = {}
    for _ in range(LANE_PASSES):
        env = await clocks.one_pass(COMM_CALL_OFF_FORM_APP, "callOffFromCalendar", {"rows": left})
        if env.get("status") != 200:
            break
        data = env.get("data") or {}
        said += data.get("rows") or []
        test_mode = data.get("test_mode") if test_mode is None else test_mode
        left = data.get("left") or []
        if not left:
            break
    if not said:
        return env
    return {"status": 200, "data": {"rows": said, "test_mode": bool(test_mode)}}


async def _calloff_road_post() -> None:
    """Hand owed Builder call-offs to callOffFromCalendar; what the door did not file stays owed."""
    if _CALLOFF_LOCK[0] is None:
        _CALLOFF_LOCK[0] = asyncio.Lock()
    lock = _CALLOFF_LOCK[0]
    if lock.locked():
        return                     # a press and the beat at once: one post is enough
    async with lock:
        try:
            rows = await _run(calloff_road.owed, PG_DSN)
        except Exception as exc:  # noqa: BLE001
            log.warning("call-off road: the owed call-offs could not be read (%s)", type(exc).__name__)
            return
        if not rows:
            return
        try:
            managers = (await _run(shift_requests.house_managers, PG_DSN)).get("by_code") or {}
        except Exception:  # noqa: BLE001 — the door names no manager rather than a guess
            managers = {}
        payload = [calloff_road.payload(
            r, managers.get(house_directory.code_of(r["location"])
                            or str(r["location"]).strip().upper())) for r in rows]
        failure = ""
        env: Any = None
        try:
            env = await _calloff_calendar(payload)
        except Exception as exc:  # noqa: BLE001
            failure = f"the door could not be reached ({type(exc).__name__})"
        try:
            said = await _run(calloff_road.mark, PG_DSN, rows, env, failure=failure)
        except Exception as exc:  # noqa: BLE001
            log.warning("call-off road: the answers could not be written down (%s)", type(exc).__name__)
            return
        if said["told"]:
            log.info("call-off road: %s Calendar Builder call-off(s) recorded by Python "
                     "(what each message did is on Requests)", said["told"])
        if said["owed"]:
            reason = failure or str((env or {}).get("message") or "") or "not named as filed"
            log.warning("call-off road: %s call-off(s) still owed — %s", said["owed"], reason[:200])


async def _recruit_book_post() -> None:
    """The recruit book pass: JSON copy first, changed tabs to recruitBookIngest, owed texts to recruitTell."""
    if not recruit_book.due_pass(time.time()):
        return
    try:
        synced = await _run(recruit_book.sync, time.time())
    except Exception as exc:  # noqa: BLE001
        log.warning("recruit book: the copy could not be written (%s)", type(exc).__name__)
        return
    if not synced.get("read"):
        log.info("recruit book: their book could not be read — %s (the copy that stands is kept)",
                 str(synced.get("why") or "")[:200])
    moved = bool(synced.get("changed"))
    # only tabs the house is not proved to hold, never an empty one
    try:
        offers = await _run(recruit_book.house_offer, time.time())
    except Exception as exc:  # noqa: BLE001
        log.warning("recruit book: the house offer could not be read (%s)", type(exc).__name__)
        offers = []
    for offer in offers:
        failure = ""
        said: dict[str, Any] = {}
        try:
            env = await clocks.one_pass(COMM_RECRUIT_APP, "recruitBookIngest", offer)
            if (env or {}).get("status") != 200:
                failure = f"the door refused: {str((env or {}).get('message') or env)[:160]}"
            else:
                said = (env or {}).get("data") or {}
        except Exception as exc:  # noqa: BLE001
            failure = f"the door could not be reached ({type(exc).__name__})"
        try:
            state = await _run(recruit_book.house_mark, offer, said, failure, time.time())
        except Exception as exc:  # noqa: BLE001
            log.warning("recruit book: the house answer could not be written (%s)", type(exc).__name__)
            continue
        moved = True
        log.info("recruit book: %s → %s (%s rows)%s", offer.get("tab"), state, len(offer.get("rows") or []),
                 f" — {failure or said.get('why')}" if state != "written" else "")
    # THE TEXTS.
    try:
        offer = await _run(recruit_book.pending, time.time())
    except Exception as exc:  # noqa: BLE001
        log.warning("recruit book: the owed texts could not be planned (%s)", type(exc).__name__)
        offer = {"rows": []}
    rows = offer.get("rows") or []
    if rows:
        failure = ""
        said = {}
        try:
            env = await _row_passes(COMM_RECRUIT_APP, "recruitTell", recruit_book.door_rows(rows), RECRUIT_LATE)
            if (env or {}).get("status") != 200:
                failure = f"the door refused: {str((env or {}).get('message') or env)[:160]}"
            else:
                said = (env or {}).get("data") or {}
        except Exception as exc:  # noqa: BLE001
            failure = f"the door could not be reached ({type(exc).__name__})"
        try:
            counts = await _run(recruit_book.mark, rows, said if not failure else None, failure, time.time())
        except Exception as exc:  # noqa: BLE001
            log.warning("recruit book: the answers could not be written (%s)", type(exc).__name__)
            counts = {}
        moved = True
        log.info("recruit book: %s text(s) offered → %s%s", len(rows),
                 ", ".join(f"{n} {k}" for k, n in sorted(counts.items())) or "no answer per row",
                 f" — {failure}" if failure else "")
    if moved:
        live_notify.dirty(recruit_book.RESOURCES)


# ---- the full punch sheet --------------------------------------------------------------------------------------------

def _psi_full_start(reason: str) -> asyncio.Task:
    """The one full-sheet task: started now, or — when one is running — the running one, with one more pass owed."""
    task = _PSI_FULL.get("task")
    if task is not None and not task.done():
        if _PSI_FULL.get("again") != "hourly":
            _PSI_FULL["again"] = reason
        return task
    task = spawn(_psi_full_run(reason))
    _PSI_FULL["task"] = task
    return task


async def _psi_full_run(reason: str) -> None:
    """The passes asked for, one after another, until none is owed."""
    while reason:
        try:
            await _run(psi_attendance.fill_consumers)
        except Exception as exc:  # noqa: BLE001
            log.warning("psi full: the clients present could not be asked (%s: %s)",
                        type(exc).__name__, str(exc)[:160])
        try:
            await _psi_full_tick(reason)
        except Exception as exc:  # noqa: BLE001
            log.warning("psi full: a pass could not run (%s: %s)", type(exc).__name__, str(exc)[:160])
        reason, _PSI_FULL["again"] = str(_PSI_FULL.get("again") or ""), ""


async def _psi_full_tick(reason: str) -> None:
    """One pass of the full punch sheet, or nothing. Never raises."""
    try:
        got = await _run(psi_punches_full.next_pass, PG_DSN, reason, time.time())
    except Exception as exc:  # noqa: BLE001
        _PSI_FULL["failures"] += 1
        log.warning("psi full: the record could not be built (%sx in a row): %s: %s",
                    _PSI_FULL["failures"], type(exc).__name__, str(exc)[:160])
        return
    if not got:
        return
    try:
        env = await clocks.service_door(HIRING_APP, "psiPunchesFullIngest", {"rows": got["batch"]}, wait=FULL_WAIT_S)
    except Exception as exc:  # noqa: BLE001
        _PSI_FULL["failures"] += 1
        log.warning("psi full: a %s pass of %s row(s) failed (%sx in a row): %s — the same rows "
                    "go on the next pass", got["kind"], len(got["batch"]), _PSI_FULL["failures"], type(exc).__name__)
        return
    said = await _run(psi_punches_full.settle, got, env or {}, time.time())
    if said.get("ok"):
        _PSI_FULL["failures"] = 0
        log.info("psi full: %s pass (%s) — %s row(s): %s added, %s patched, %s unchanged; %s of "
                 "%s still to cross (%s stored, %s read live, %s the stored copy never had)",
                 got["kind"], reason, said.get("rows"), said.get("inserted"), said.get("updated"),
                 said.get("unchanged"), said.get("pending_after"), got["total"], got["stored"],
                 got["live"], got["live_new"])
        _PSI_FULL["said"] = ""
    elif said.get("held"):
        if said.get("why") != _PSI_FULL["said"]:
            _PSI_FULL["said"] = said.get("why") or ""
            log.warning("psi full: the door cannot take this record yet — %s; asked again in %s h",
                        said.get("why"), round(psi_punches_full.HOLD_S / 3600, 1))
    else:
        _PSI_FULL["failures"] += 1
        log.warning("psi full: a %s pass of %s row(s) was not taken whole (%s) — the same rows go "
                    "on the next pass", got["kind"], len(got["batch"]), said.get("why"))


# ---- the beat ------------------------------------------------------------------------------------------------------

def _held_now() -> str:
    """Why the time clock holds in this process ('' when it runs), said once per reason."""
    why = psi_attendance.held_here()
    if why != _HELD["why"]:
        if why:
            log.warning("attendance: the time clock is held — %s; nothing is collected, no login is sent, the login "
                        "clock and the lane's state are not written, and the shift flow's texts, the punch pairs, the "
                        "missing punches, the attendance rows and the full punch sheet wait with it; the rest of the "
                        "beat runs", why)
        elif _HELD["why"]:
            log.info("attendance: the time clock runs here again")
        _HELD["why"] = why
    return why


async def _attendance_post() -> None:
    """The late and no-call rows waiting for staff attendance (staffAttendancePunch)."""
    try:
        offer = await _run(psi_attendance.pending, time.time())
    except Exception as exc:  # noqa: BLE001
        log.warning("psi attendance: the waiting rows could not be read (%s)", type(exc).__name__)
        return
    if not offer:
        return
    try:
        env = await _staff_door("staffAttendancePunch", {"late": offer["late"], "no_call": offer["no_call"]})
    except Exception as exc:  # noqa: BLE001
        await _run(psi_attendance.post_failed, time.time())
        log.warning("psi attendance: the door could not be reached (%s) — the rows wait", type(exc).__name__)
        return
    said = (env or {}).get("data") or {}
    if (env or {}).get("status") != 200:
        await _run(psi_attendance.post_failed, time.time())
        log.warning("psi attendance refused: %s — the rows wait", str((env or {}).get("message") or env)[:160])
        return
    await _run(psi_attendance.posted, offer["ids"], said, time.time())
    log.info("psi attendance: %s late, %s no-call → %s told, %s held, %s already told today",
             len(offer["late"]), len(offer["no_call"]), said.get("told"), said.get("held"), said.get("skipped"))


async def beat() -> dict[str, Any]:
    """One beat, in the relay's order; what the time clock said of itself."""
    held = _held_now()
    said: dict[str, Any] = {"state": "held", "why": held} if held else {}
    if not held:
        try:
            said = await _run(psi_attendance.tick, PG_DSN) or {}
        except Exception as exc:  # noqa: BLE001
            log.warning("psi attendance failed: %s: %s", type(exc).__name__, str(exc)[:160])
            return {"state": "failed"}
        # THE PUNCH BOARD WAS REWRITTEN: its slice follows, and a new verdict may be a no-call the house manager is owed
        if said.get("board"):
            live_notify.dirty(punch_board_slices.RESOURCES)
            _notices_wake()
    # THE SHIFT POOL RIDES THIS BEAT TOO, ahead of the door
    await _shift_pool_sweep()
    if not held:
        await _psi_reminders_post()
    await _shift_handoff_post()
    await _time_off_post()
    if not held:
        await _punch_pairs_post()
        await _support_punch_post()
    await _shift_requests_post()
    await _open_shift_covered_post()
    await _recruit_book_post()
    # Builder call-offs the press could not file are offered again here
    await _calloff_road_post()
    if held:
        return said
    if said.get("read"):
        # A COLLECTION READ: its entries reach the full punch sheet one pass after it
        _psi_full_start("collection")
    if time.time() - float(_PSI_FULL["at"]) >= FULL_EVERY_S:
        # and every hour, as the relay's staff beat asked it
        _PSI_FULL["at"] = time.time()
        _psi_full_start("hourly")
    await _attendance_post()
    return said


async def loop() -> None:
    while True:
        await asyncio.sleep(EVERY_S)
        try:
            await beat()
        except Exception:  # noqa: BLE001 - the beat stands; the next one runs
            log.exception("attendance beat failed")


# ---- the routes that read this memory --------------------------------------------------------------------------------

def _shut(why: str) -> dict[str, Any]:
    """The refusal shape both PSI doors use."""
    return {"status": 503, "reason": "unreadable", "message": why}


async def _within(task: asyncio.Task, deadline: float) -> dict[str, Any] | None:
    """_psi_within: the verdict if it is ready by `deadline` (a monotonic stamp), else None."""
    if not task.done():
        left = deadline - time.monotonic()
        if left <= 0:
            return None
        await asyncio.wait({task}, timeout=left)
    if not task.done() or task.cancelled():
        return None
    try:
        got = task.result()
    except Exception as exc:  # noqa: BLE001 - the caller carries on without a verdict
        log.warning("psi anywhere: the check did not come back: %s", type(exc).__name__)
        return None
    return got if isinstance(got, dict) else None


async def door_verdict(force: bool = False) -> dict[str, Any] | None:
    """_psi_door_verdict: the verdict inside the door's own ceiling, or None; a check that broke raises."""
    task = spawn(psi_anywhere.verdict(force=force))
    got = await _within(task, time.monotonic() + getattr(psi_anywhere, "PSI_DOOR_WAIT_S", 3.0))
    if got is None and task.done() and not task.cancelled() and task.exception() is not None:
        raise task.exception()  # noqa: RSE102 - the door's own except builds the message
    return got


async def psi_health_door(request: Request) -> Response:
    """GET /hub-lanes/psi/health: is PsiAnywhere answering? The deterministic proof, for the screen."""
    s = await LG.session(LG.token_of(request))
    actor = await LG.gate(s, GATE_APP)
    if isinstance(actor, dict):
        return LG.answer(actor)
    fresh = LG.query(request, "fresh")
    try:
        data = await door_verdict(force=str(fresh or "").strip() not in ("", "0", "no"))
    except Exception as exc:  # noqa: BLE001 - a check that throws is not an outage
        log.warning("psi anywhere: the door could not answer: %s", type(exc).__name__)
        return LG.answer(_shut(f"The PsiAnywhere check could not run ({type(exc).__name__})."))
    if data is None:
        return LG.answer(_shut("The PsiAnywhere check did not answer in time."))
    return LG.answer({"status": 200, "data": data})


async def psi_health_service(request: Request) -> Response:
    """POST /psi/health: the same verdict for a service holding the relay's secret (the relay's hotline filing asks it
    here, so the check and its login run in this process alone); `fresh` true asks past the held verdict."""
    body = await LG.body_json(request)
    body = body if isinstance(body, dict) else {}
    given = str(body.get("service_secret") or "")
    if not SERVICE_SECRET or not hmac.compare_digest(given, SERVICE_SECRET):
        log.warning("psi anywhere: refused, bad or missing service secret")
        return LG.answer({"status": 401, "message": "service identity required"})
    try:
        data = await door_verdict(force=body.get("fresh") is True)
    except Exception as exc:  # noqa: BLE001
        log.warning("psi anywhere: the service door could not answer: %s", type(exc).__name__)
        return LG.answer(_shut(f"The PsiAnywhere check could not run ({type(exc).__name__})."))
    if data is None:
        return LG.answer(_shut("The PsiAnywhere check did not answer in time."))
    return LG.answer({"status": 200, "data": data})


async def punch_received_door(request: Request) -> Response:
    """POST /hub-lanes/punch-warnings/received: a director's RECEIVED on one punch warning, by its ref — the Hub's half
    of the text reply, judged against the shifts this process paired."""
    import sched_lanes  # noqa: PLC0415 - Requests' own viewer and threads (app/sched_lanes.py)

    got = await sched_lanes._requests_viewer(request)  # noqa: SLF001
    if isinstance(got, dict):
        return LG.answer(got)
    who, session = got
    body = await LG.body_json(request)
    if not isinstance(body, dict):
        return LG.answer({"status": 400, "reason": "request", "message": "invalid body"})
    ref = str(body.get("ref") or "").strip().upper()
    if not punch_pairs.REF_RE.fullmatch(ref):
        return LG.answer({"status": 400, "reason": "request", "message": "ref is required (PW…)"})
    try:
        master = who.get("is_master") is True
        done = await sched_lanes._run(punch_pairs.acknowledge, PG_DSN,  # noqa: SLF001
                                      by=str(who.get("name") or (f"account {session[1]}" if master else "")),
                                      ref=ref, via="hub", master=master)
    except punch_pairs.Refused as exc:
        return LG.answer({"status": PUNCH_RECEIVED_STATUS.get(exc.code, 409), "reason": exc.code,
                          "message": exc.why})
    except punch_pairs.Unreadable as exc:
        return LG.answer({"status": 503, "reason": "unreadable",
                          "message": f"{exc} — nothing was done, and the warning still waits for an answer."})
    except Exception as exc:  # noqa: BLE001
        log.warning("punch pairs: a RECEIVED from the Hub failed (%s)", type(exc).__name__)
        return LG.answer({"status": 503, "reason": "unreadable",
                          "message": f"the RECEIVED could not be recorded ({type(exc).__name__}) — nothing was done."})
    log.info("punch pairs: %s answered RECEIVED on the Hub by %s → %s", ref, session[1], done.get("state"))
    return LG.answer({"status": 200, "data": {"ref": done.get("ref") or ref, "state": done.get("state") or "",
                                              "call_off_ref": done.get("call_off_ref") or "",
                                              "words": punch_pairs.received_words(done)}})


# ---- the app's own ---------------------------------------------------------------------------------------------------

def start() -> list[asyncio.Task]:
    """The loop started on the app's own loop; none when HUB_APP_CLOCKS is off."""
    if not clocks.ON:
        log.warning("attendance: HUB_APP_CLOCKS is off — the PSI attendance loop does not run")
        return []
    _LOOP[0] = asyncio.get_running_loop()
    _PSI_FULL["at"] = time.time()
    why = _held_now()
    if not why:
        spawn(_run(psi_attendance.prepare))
    tasks = [spawn(loop())]
    log.info("attendance: the PSI attendance loop (%ss) started%s", int(EVERY_S),
             f" with the time clock held ({why})" if why else "")
    return tasks


async def stop() -> None:
    tasks = list(_TASKS)
    for task in tasks:
        task.cancel()
    for task in tasks:
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task


def install(app: Any) -> list[str]:
    """The PSI doors on main.py's app, matched before the relay carrier; the wakes this loop answers."""
    app.get("/hub-lanes/psi/health")(psi_health_door)
    app.post("/psi/health")(psi_health_service)
    app.post("/hub-lanes/punch-warnings/received")(punch_received_door)
    live_notify.LOCAL_WAKES["attendance"] = roster_moved
    live_notify.LOCAL_WAKES["calloff_road"] = calloff_road_kick
    effective_roster.on_change(_roster_published)
    # a reply claimed by a pending swap ask is the reply ear's, not the shift flow's
    psi_reminders.CLAIMED_ELSEWHERE = lambda pairs: shift_handoff.claimed_replies(PG_DSN, pairs)
    taken = ["psi/health (GET, POST)", "punch-warnings/received"]
    log.info("attendance: answered here: %s; the time clock, the shift pool and their posts run in this process",
             ", ".join(taken))
    return taken
