"""The relay's clocks, in the app (server/snapshot_service.py): its fast beat whole, its staff beat's passes, the
pharmacy reports' sweep and the Quo pipeline. Each pass asks the app's own doors in-process as the relay's identity
asked them over HTTP, in the relay's order, on its beats and with its waits, and says what it changed as the relay did
(live_notify). The relay starts none of these any more; only the arriving calls' reading stays on its staff clock,
where its reading, seal key and model are mounted. The time clock and its full punch sheet are app/attendance_loop.py's.

  the fast beat (20 s)    the hiring lane's accounts, Smart Comms' clock (and the Desk's Run, smartCommsRun), the
                          automatic inbound pass, Scheduling's call-off flow, the clock riders, a phone screen's call
  the staff beat (600 s)  staff attendance, support routing, the vehicle calendar's texts, held broadcasts, letters,
                          app releases, IST notices, recon, the comm bindings, the hiring lane's passes, requirement
                          states, Drive intake, the referrals' sync, team alerts, the call transcripts, the mailbox
                          ear; hourly the contact clock, the talent sync, the repair pass and the obligations sweep
  the relay's staff beat  its own 600 s clock, beside the one above as the relay ran it: the hotline's inbox pass and
                          beat (app/hotline_fast.py); the line directory, and hourly the contact list, the behaviour
                          signals, the comm routes, the PSI punches and the comm windows; daily the proposals
                          (app/staff_feeds.py)
  the pharmacy reports    the folder's six-hourly sweep, looked at every minute (app/house_meds_import.py)
  the Quo pipeline        POST /quo/webhook (a messages-signed event kept in app/quo_inbox.py, a hotline-signed one
                          filed on the hotline desk, app/hotline_fast.py), the hand-off to quoIngestBatch with the
                          backfill spool, and the pull (app/quo_pull.py)
  the reply ear (60 s)    the texts the inbox kept, acted on once each (app/sms_ears.py), and its acknowledgements
                          through staffShiftReminder

HUB_APP_CLOCKS=off starts none of them."""
from __future__ import annotations

import asyncio
import base64
import concurrent.futures
import contextlib
import hashlib
import hmac
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Coroutine
from zoneinfo import ZoneInfo

from fastapi import Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

import front_door as FD
import live_notify
import quo_inbox
import quo_pull

log = logging.getLogger("asa-hub-app.clocks")

ON = os.getenv("HUB_APP_CLOCKS", "on").strip().lower() not in ("off", "0", "no")
SERVICE: dict[str, Any] = {"is_service": True}
SERVICE_SECRET = os.getenv("HUB_SERVICE_SECRET", "")
# the relay's waits for an answer: a read, a pack or a sweep's write, a look that may prepare
READ_S = min(10.0, max(1.0, float(os.getenv("HUB_APP_TIMEOUT_S", "10"))))
PACK_S = min(120.0, max(READ_S, float(os.getenv("HUB_APP_PACK_TIMEOUT_S", "60"))))
PREPARE_S = float(os.getenv("HUB_BACKEND_PREPARE_TIMEOUT_S", "110"))
FAST_EVERY_S = 20.0
STAFF_EVERY_S = 600.0
LANE_PASSES = 30

HIRING_APP = "hiring"
STAFF_ALERTS_APP = "staff-alerts"
SMART_CLOCK_APP = "smart-clock"
OPT_OUTS_APP = "opt-outs"
BROADCAST_APP = "broadcast"
IST_APP = "ist"
RECON_APP = "time-recon"
COMPLIANCE_ENGINE_APP = "compliance-engine"
COMM_BINDINGS_APP = "comm-bindings"
POTENTIAL_CLIENTS_APP = "potential-clients"
COMM_CALLS_APP = "comm-calls"
COMM_REPLIES_APP = "comm-replies"
COMM_REPAIR_APP = "comm-repair"
COMM_RECORD_APP = "comm-record"
SETTINGS_TOOLS_APP = "settings-tools"
CONFIG_LANE_APP = "config-lane"
QUO_APP = "quo"
# what the relay's memory keys them by: the app packs a sweep makes stale, and the event Smart Comms' pages hear
CANDIDATES_PACK = "staff-candidates"
SMART_COMMS_EVENT = "smartcomms"

# ---- the hiring lane, in Hired.gs's order: each look, its write, whether the write is handed the look's answer, and
# every how many staff beats it is asked
HIRING_CLOCK: tuple[tuple[str, str, bool, int], ...] = (
    ("hiringConditionsDue", "hiringConditionsSweep", True, 1),
    ("interviewStartDue", "interviewStartSweep", False, 1), ("interviewAskDue", "interviewAskSweep", True, 1),
    ("screenRedoDue", "screenRedoSweep", True, 2), ("referralRelayDue", "referralRelaySweep", True, 2),
    ("manualContactDue", "manualContactSweep", True, 2), ("directorDocsDue", "directorDocsSweep", True, 2),
    ("onboardingFinishDue", "onboardingFinishSweep", True, 1), ("readyWatchDue", "readyWatchSweep", False, 1),
    ("readyAskDue", "readyAskSweep", False, 1), ("readyEarDue", "readyEarSweep", False, 1),
    ("talentFinishDue", "talentFinishSweep", False, 1), ("talentAutoCrossDue", "talentAutoCrossSweep", True, 1),
    ("talentNoContactDue", "talentNoContactSweep", False, 2), ("screenCallDue", "screenCallSweep", True, 2),
    ("testCardsDue", "testCardsSweep", False, 2), ("unreachableDue", "unreachableSweep", False, 2),
    ("talentAutoFillDue", "talentAutoFillSweep", True, 2),
    ("readyParkedDue", "readyParkedSweep", False, 1), ("packetRequestDue", "packetRequestSweep", False, 1),
    ("packetHoldDue", "packetHoldSweep", False, 1), ("hiredStayDue", "hiredStaySweep", False, 1),
    ("becomingStaffDue", "becomingStaffSweep", False, 1), ("employeeDbStepDue", "employeeDbStepSweep", True, 1),
    ("recruitmentSyncDue", "recruitmentSyncSweep", True, 1),
    ("mailLogDue", "mailLogSweep", True, 3),
    ("commsSyncDue", "commsSyncSweep", True, 1), ("cjisSweepDue", "cjisSweep", True, 3),
    ("behaviorSweepDue", "behaviorSweep", True, 36),
    ("engineRoundsTrimDue", "engineRoundsTrimSweep", False, 1), ("flowConditionsDue", "flowConditionsSweep", True, 1),
    ("flowSchemaDue", "flowSchemaSweep", True, 1), ("runtimeConditionsDue", "runtimeConditionsSweep", True, 1))
HIRING_SIM_EVERY_TICKS = 2
# the accounts the hiring lane makes, asked every HIRING_ACCOUNTS_EVERY_TICKS fast beats (its ten minutes)
HIRING_ACCOUNTS_CLOCK: tuple[tuple[str, str, bool], ...] = (
    ("onboardingUserDue", "onboardingUserSweep", True), ("hiredGraduateDue", "hiredGraduateSweep", False))
HIRING_ACCOUNTS_EVERY_TICKS = 30
SCREEN_COLLECT_EVERY_TICKS = 6
# Smart Comms' events every SMART_CLOCK_EVERY_S, its reminders and digests every SMART_CLOCK_REMIND_EVERY_S
SMART_CLOCK_EVERY_S = 120.0
SMART_CLOCK_REMIND_EVERY_S = 6 * 3600.0
SMART_CLOCK_PASSES = 30
SMART_CLOCK_UNREAD = {"status": 503, "message": "Smart Comms could not be asked just now. Try again in a moment."}
# the clock riders in the hiring sweep's order; each look keeps its own throttle (app.clock_sweeps_state)
CLOCK_SWEEPS: tuple[tuple[str, str, str], ...] = (
    ("lane-mirror", "laneMirrorDue", "laneMirrorSweep"), ("dup-scan", "dupScanDue", "dupScanSweep"),
    ("call-off-form-sweep", "callOffFormDue", "callOffFormSweep"))
CLOCK_SWEEPS_EVERY_S = 120.0
INBOUND_AUTO_EVERY_S = 300.0
COMM_BINDINGS_PASSES = 10
COMM_CALLS_PASSES = 30
COMM_CALLS_SLICES = ("commCalls", "commWorkItems")
# the apps whose Drive files are brought onto the server: (the fetch, the keep)
DRIVE_INTAKE: dict[str, tuple[str, str]] = {
    "administration": ("adminDocsFetch", "adminDocsKeep"), "academy": ("academyFetch", "academyKeep"),
    "technology": ("techDocsFetch", "techDocsKeep"), "finance": ("finDocsFetch", "finDocsKeep"),
    "isp": ("ispIntakeFetch", "ispIntakeKeep")}
DRIVE_INTAKE_PASSES = 8
DRIVE_INTAKE_PASSES_OF = {"technology": 60}
DRIVE_INTAKE_SLICES = {"technology": ("techDocs", "techProjects")}
POTENTIAL_CLIENTS_SYNC_EVERY_S = 3600.0
POTENTIAL_CLIENTS_UPLOAD = "potentialClientsUpload"
POTENTIAL_CLIENTS_SLICES = frozenset({"potentialClients"})
REQ_STATES_EVERY_S = 6 * 3600.0
# the Apps Script engine's last build, kept on the packs' volume from when it still answered; stamped on two sweeps
ENGINE_BUILD_PATH = Path(os.getenv("HUB_ENGINE_BUILD_PATH", "/srv/app-packs/engine-build.json"))

# ---- the ingest lane's gate (server/lane_gate.py): armed on the Desk and the send switch on holds these doors -------
INGEST_GATE = "gate_relay_ingest_lane"
INGEST_ACTIONS = frozenset({
    "peopleSyncFromPlatform", "commRoutesIngest", "behaviorSignalsIngest",
    "psiPunchesIngest", "psiPunchesFullIngest", "commWhenIngest",
    "commProposalsIngest", "houseMedsIngest", "quoIngestBatch", "staffAttendancePunch",
    "commCallsIngest", "quoIngest", "lineDirectorySync",
})
LANE_FRESH_S = float(os.getenv("HUB_TEST_SWITCH_FRESH_S", "900"))
LANE_TTL_S = 180.0
LANE_RETRY_S = 15.0
NEW_YORK = ZoneInfo("America/New_York")

# ---- the Quo pipeline ------------------------------------------------------------------------------------------------
QUO_HANDOFF_EVERY_S = 60.0
# how long a batch posted may still be deciding: written down before every post
QUO_HANDOFF_HOLD_S = 2 * 330 + 120
QUO_PULL_FIRST_S = 90.0
QUO_HANDOFF_SAY_EVERY_S = 3600.0
# a transcript filed live, kicked to the phone-call lane's door on this app's own port (carried to wherever it lives)
QUO_CALLS_KICK_URL = os.getenv("HUB_QUO_CALLS_KICK_URL", "http://127.0.0.1:8080/comm-calls/transcript")
QUO_HOTLINE_KEY_FILE = Path(os.getenv("QUO_HOTLINE_WEBHOOK_KEY_FILE", "/srv/secrets/quo-hotline-webhook.key"))
# the relay's own cap on an envelope its rungs read
ENVELOPE_MAX = 100_000
# the reply ear: a pass per minute, the first once startup settles; its lanes take the app's connections (lanes_pg)
SMS_EARS_EVERY_S = 60.0
SMS_EARS_FIRST_S = 30.0
SMS_EARS_DSN = "asa-hub-db"

M: Any = None
_TASKS: set[asyncio.Task] = set()
_SWEEP_FAILURES = {"hiring": 0, "staff": 0, "talent": 0, "comm_record": 0, "comm_replies": 0, "comm_repair": 0}
_HIRING_ACCOUNTS: dict[str, Any] = {"tick": 0, "task": None}
_SMART_CLOCK: dict[str, Any] = {"at": 0.0, "reminded": 0.0, "task": None, "unread": []}
_INBOUND_AUTO: dict[str, Any] = {"at": 0.0, "task": None}
_CLOCK_SWEEPS: dict[str, Any] = {"at": 0.0, "task": None}
_SCREEN_COLLECT = [0]
_DRIVE_INTAKE_RUNNING: set[str] = set()
_POTENTIAL_CLIENTS_SYNCED = [0.0]
_REQ_STATES_RAN = [0.0]
_LETTERS_SEEN_AT: list[float] = []
_TEAM_ALERTS_SEEN_AT: list[float] = []
_COMM_REPLIES_ALIVE = [0.0]
_LANE: dict[str, Any] = {"at": 0.0, "data": None}
_GATE_SAID: set[str] = set()
_QUO_WAKE = asyncio.Event()
_QUO_HANDOFF_SAID: dict[str, Any] = {"key": None, "at": 0.0}
_QUO_BACKFILL_SAID: dict[str, Any] = {"key": None, "at": 0.0}
_HOTLINE_KEYS: dict[str, Any] = {"stamp": None, "keys": [], "said": None}
_SMS_EARS_WAKE = asyncio.Event()
# one thread, so the ear holds one writer connection (lanes_pg) and its passes never overlap here
_EAR_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="sms-ears")
_SMS_EARS_LOOP: list[asyncio.AbstractEventLoop | None] = [None]


def spawn(coro: Coroutine[Any, Any, Any]) -> asyncio.Task:
    """A task held until it ends, and ended with the clocks."""
    task = asyncio.get_running_loop().create_task(coro)
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    return task


def write_id(tag: str) -> str:
    return "W" + hashlib.sha256(f"{tag}|{time.time_ns()}".encode()).hexdigest()[:24]


# ---- the app's own doors, as the relay's identity asked them ---------------------------------------------------------

def _unanswered(action: str, why: str) -> tuple[None, str]:
    log.info("backend: %s not answered by Python — %s", action, why)
    return None, why


async def call(app_id: str, action: str, payload: dict[str, Any], wid: str = "", wait: float = READ_S
               ) -> tuple[dict[str, Any] | None, str]:
    """The relay's _backend_call in-process (main.py's act): the door's answer to the relay's identity, or None and why
    there was none (its defer, its wait spent, another shape)."""
    module, deciding = M.APPS.get(app_id), M.WRITES.get(app_id)
    write = deciding is not None and action in deciding.ACTIONS
    if module is None or (action not in module.ACTIONS and not write):
        return _unanswered(action, "it deferred 404: not ported")
    started = time.monotonic()
    try:
        job = (run_in_threadpool(M._run_write, deciding, action, dict(SERVICE), payload, wid, 0.0) if write
               else run_in_threadpool(M._run, module, action, dict(SERVICE), payload, 0.0))
        resp = await asyncio.wait_for(job, timeout=wait)
    except asyncio.TimeoutError:
        return _unanswered(action, f"ReadTimeout after {time.monotonic() - started:.1f}s")
    except Exception as exc:  # noqa: BLE001 - said by the caller, as the relay's line that dropped
        return _unanswered(action, f"{type(exc).__name__} after {time.monotonic() - started:.1f}s")
    body = bytes(getattr(resp, "body", b"") or b"")
    if resp.status_code != 200:
        try:
            why = str((json.loads(body) or {}).get("defer") or "")
        except Exception:  # noqa: BLE001
            why = ""
        return _unanswered(action, f"it deferred {resp.status_code}: {why[:120]}")
    try:
        env = json.loads(body)
    except ValueError:
        env = None
    if not isinstance(env, dict) or not isinstance(env.get("status"), int):
        return _unanswered(action, "another shape")
    return env, ""


def void_soon(app_id: str, wid: str) -> None:
    """A write that got no answer, settled void behind the clock (its owed texts never leave)."""
    FD.settle_void_soon(app_id, wid)


async def pair(app_id: str, look: str, sweep: str, *, prepared: bool = True) -> dict[str, Any]:
    """_backend_clock_pair: the look, then — only when it says something is due — one write handed its answer; raises
    when Python did not answer, so the clock's failure count moves."""
    env, why = await call(app_id, look, {}, wait=PREPARE_S)
    if env is None:
        raise RuntimeError(f"{look}: Python did not answer ({why})")
    env = dict(env)
    data = env.get("data") if env.get("status") == 200 else None
    if not isinstance(data, dict) or not data.get("due"):
        return env
    got, why = await call(app_id, sweep, {"prepared": data} if prepared else {}, write_id(sweep), PACK_S)
    if got is None:
        raise RuntimeError(f"{sweep}: Python did not answer ({why})")
    got = dict(got)
    got.pop("_write", None)
    return got


async def one_pass(app_id: str, action: str, payload: dict[str, Any]) -> dict[str, Any]:
    """_backend_pass: one write; its answer, or a 503 saying why there was none."""
    wid = write_id(app_id)
    env, why = await call(app_id, action, payload, wid, PACK_S)
    if env is None:
        void_soon(app_id, wid)
        return {"status": 503, "message": f"Python did not answer ({why})"}
    return env


async def lane_passes(app_id: str, door: str, payload: dict[str, Any],
                      carry: Callable[[dict, dict], dict | None]) -> dict[str, Any] | None:
    """_comm_lane_passes: the door rung pass after pass while `carry` names the next payload; the last answer, None
    when Python did not answer (that write voided)."""
    env: dict[str, Any] | None = None
    for _ in range(LANE_PASSES):
        wid = write_id(app_id)
        env, _why = await call(app_id, door, payload, wid, PACK_S)
        if env is None:
            void_soon(app_id, wid)
            return None
        env.pop("_write", None)
        if env.get("status") != 200:
            return env
        nxt = carry(payload, env.get("data") or {})
        if nxt is None:
            break
        payload = nxt
    return env


async def app_clock(app_id: str, look: str, sweep: str, *, prepared: bool = True) -> None:
    """_app_clock: one app's own clock, its look then its sweep when due. Never raises."""
    try:
        env = await pair(app_id, look, sweep, prepared=prepared)
        if env and env.get("status") != 200:
            log.warning("%s clock: %s", app_id, str(env.get("message") or env.get("status"))[:160])
    except Exception as exc:  # noqa: BLE001 - the next ring asks again
        log.warning("%s clock: %s", app_id, str(exc)[:160])


def smart_comms_rang() -> None:
    """_smart_comms_rang after a landed write: every Smart Comms page hears it, and reads past its pack."""
    live_notify.told(rang=[SMART_COMMS_EVENT], swept=[SMART_COMMS_EVENT])


# ---- the ingest lane's gate, read off the app's own config lane ------------------------------------------------------

def _instant(raw: Any) -> datetime | None:
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=NEW_YORK)
    try:
        got = datetime.fromisoformat(str(raw or "").replace("Z", "+00:00"))
    except ValueError:
        return None
    return got if got.tzinfo else got.replace(tzinfo=NEW_YORK)


async def config_lane() -> dict[str, Any] | None:
    """The relay's _config_lane_refresh and _config_lane_for(""): configLane asked of the app's own door at most every
    LANE_TTL_S, the last good one standing; None until one was read."""
    if time.time() - float(_LANE["at"]) >= LANE_TTL_S:
        env, why = await call(CONFIG_LANE_APP, "configLane", {})
        if env is not None and env.get("status") == 200 and isinstance(env.get("data"), dict):
            _LANE.update(data=env["data"], at=time.time())
        else:
            log.warning("config lane not read: %s", (env or {}).get("message") or (env or {}).get("status") or why)
            _LANE["at"] = time.time() - LANE_TTL_S + LANE_RETRY_S
    data = _LANE["data"]
    return data if isinstance(data, dict) and str(data.get("place") or "") == "" else None


def test_switch(lane: dict[str, Any] | None, now: datetime | None = None) -> dict[str, Any]:
    """web_gate.switch_from: test mode `on` unless a fresh lane plainly says off."""
    now = now or datetime.now(timezone.utc)

    def held(why: str) -> dict[str, Any]:
        return {"on": True, "readable": False, "why": why}

    if not isinstance(lane, dict):
        return held("the relay has not read the platform's configuration yet")
    tm = lane.get("test_mode")
    if not isinstance(tm, dict):
        return held("the configuration the relay reads does not carry test mode "
                    "(Bundle.gs configLane has no test_mode part)")
    if tm.get("unreadable"):
        return held(f"the platform could not read test mode ({str(tm.get('unreadable'))[:120]})")
    built = _instant(lane.get("built_at"))
    if built is None:
        return held("the configuration the relay holds says nothing of when it was read")
    age = (now - built).total_seconds()
    if age > LANE_FRESH_S:
        return held(f"the configuration the relay holds is {int(age // 60)} minutes old")
    on = tm.get("on")
    if on is not True and on is not False:
        return held(f"test mode came back as {on!r}, which is neither on nor off")
    return {"on": on, "readable": True, "why": ""}


def ingest_hold(action: str, lane: dict[str, Any] | None, now: datetime | None = None) -> str:
    """lane_gate.action_gate: why an ingest door is held ('' when it is not) — the gate armed on the Desk while the
    send switch is on; an unreadable or stale lane arms nothing."""
    if action not in INGEST_ACTIONS or not isinstance(lane, dict):
        return ""
    built = _instant(lane.get("built_at"))
    if built is None or ((now or datetime.now(timezone.utc)) - built).total_seconds() > LANE_FRESH_S:
        return ""
    if lane.get("smart_gates_unreadable"):
        return ""
    gates = lane.get("smart_gates")
    if not isinstance(gates, dict) or gates.get(INGEST_GATE) is not True:
        return ""
    switch = test_switch(lane, now)
    if not switch["on"]:
        return ""
    why = (f"{INGEST_GATE} is armed and the send switch is on" if switch["readable"]
           else f"{INGEST_GATE} is armed and the send switch could not be read "
                f"({switch['why'] or 'no reason given'}), which holds")
    if INGEST_GATE not in _GATE_SAID:
        _GATE_SAID.add(INGEST_GATE)
        log.info("lane gate: %s", why)
    return why


async def service_door(app_id: str, action: str, payload: dict[str, Any], wait: float = PACK_S) -> dict[str, Any]:
    """_service_door: a door the relay's own lanes ask as the service — the ingest gate held, its prepare read first
    when it has one, then the write (waited on `wait`); raises when Python did not answer, so the rows stay owed."""
    why = ingest_hold(action, await config_lane())
    if why:
        return {"status": 409, "message": why, "held": True}
    prepare = FD.PREPARE.get(action)
    if prepare is not None and (not prepare[1] or payload.get(prepare[1])):
        got, said = await call(app_id, prepare[0], payload, wait=PREPARE_S)
        if got is None:
            raise RuntimeError(f"{prepare[0]}: Python did not answer ({said})")
        if got.get("status") != 200:
            return dict(got)
        payload = {**{k: v for k, v in payload.items() if k != prepare[1]}, "prepared": got.get("data")}
        if prepare[1]:
            payload[prepare[1]] = "kept"
    env, said = await call(app_id, action, payload, write_id(action), wait)
    if env is None:
        raise RuntimeError(f"Python did not answer ({said})")
    env = dict(env)
    env.pop("_write", None)
    return env


# ---- the beats of the app's clocks, kept in asa-hub-db (app.loop_cadence) -------------------------------------------

CADENCE_TABLE = "app.loop_cadence"
# a sealed rehearsal keeps no beats (rehearsal_sandbox)
CADENCE_OFF = os.getenv("HUB_CADENCE_OFF", "").strip() == "1"
_CADENCE: dict[str, Any] = {"said": {}}
CADENCE_SQL = (f"INSERT INTO {CADENCE_TABLE} (loop_name, expected_interval_s, last_run_at, status, source, detail, "
               "updated_at) VALUES (%s, %s, NOW(), %s, 'asa-hub-app', %s::jsonb, NOW()) ON CONFLICT (loop_name) DO "
               "UPDATE SET expected_interval_s = EXCLUDED.expected_interval_s, last_run_at = EXCLUDED.last_run_at, "
               "status = EXCLUDED.status, source = EXCLUDED.source, detail = EXCLUDED.detail, updated_at = NOW()")


def _beat_sync(name: str, interval_s: int, detail: dict[str, Any], status: str) -> None:
    """Blocking: the beat kept on the thread's shared writer connection."""
    import lanes_pg  # noqa: PLC0415 - the thread's shared writer connection

    with lanes_pg.own_connect() as conn, conn.cursor() as cur:
        cur.execute(CADENCE_SQL, (name, int(interval_s), status, json.dumps(detail or {}, default=str)))


async def beat(name: str, interval_s: float, status: str = "ok", **detail: Any) -> None:
    """_cadence_beat: the loop ran. Never raises, and never silent for long."""
    if CADENCE_OFF:
        return
    try:
        await asyncio.to_thread(_beat_sync, name, int(interval_s), detail, str(status or "ok"))
    except Exception as exc:  # noqa: BLE001 - a heartbeat never costs the loop
        if time.time() - _CADENCE["said"].get(name, 0.0) > 3600:
            _CADENCE["said"][name] = time.time()
            log.warning("cadence beat for %s did not land: %s", name, type(exc).__name__)


# ---- the fast beat ---------------------------------------------------------------------------------------------------

async def hiring_accounts_turn() -> None:
    """The hiring lane's account passes; one Python did not answer moves the hiring count. Never raises."""
    for look, sweep, prepared in HIRING_ACCOUNTS_CLOCK:
        try:
            env = await pair(HIRING_APP, look, sweep, prepared=prepared)
            _SWEEP_FAILURES["hiring"] = 0
            data = env.get("data")
            if env.get("status") != 200:
                log.warning("hiring accounts: %s answered %s (%s)", sweep, env.get("status"),
                            str(env.get("message") or "")[:160])
            elif isinstance(data, dict) and data and data.get("due") is None:
                live_notify.told(swept=[CANDIDATES_PACK])
                log.info("hiring accounts: %s %s", sweep, json.dumps(data, separators=(",", ":"))[:240])
        except Exception as exc:  # noqa: BLE001 - the next turn asks again
            _SWEEP_FAILURES["hiring"] += 1
            if _SWEEP_FAILURES["hiring"] in (1, 5) or _SWEEP_FAILURES["hiring"] % 30 == 0:
                log.warning("hiring accounts: %s failed (%sx in a row): %s", sweep, _SWEEP_FAILURES["hiring"],
                            str(exc)[:200])


def hiring_accounts_kick() -> None:
    tick = _HIRING_ACCOUNTS["tick"]
    _HIRING_ACCOUNTS["tick"] = tick + 1
    task = _HIRING_ACCOUNTS["task"]
    if tick % HIRING_ACCOUNTS_EVERY_TICKS or (task is not None and not task.done()):
        return
    _HIRING_ACCOUNTS["task"] = spawn(hiring_accounts_turn())


async def smart_clock_run(reminders: bool) -> dict[str, Any] | None:
    """One turn of Smart Comms' clock: the look (smartClockDue), then its plans carried pass by pass (smartClockSend);
    what it found and told, None when Python did not answer the look."""
    read, why = await call(SMART_CLOCK_APP, "smartClockDue", {"reminders": reminders}, wait=PACK_S)
    if not read or read.get("status") != 200 or not isinstance(read.get("data"), dict):
        log.warning("smart clock: not read (%s)", str((read or {}).get("message") or why)[:160])
        return None
    data = read["data"]
    plans = data.pop("plans", None) or []
    told: dict[str, Any] = {"plans": len(plans), "told": 0, "rehearsed": 0, "sms": 0, "email": 0,
                            "deduplicated": 0, "lost": 0, "would": 0, "failed": []}
    for _ in range(SMART_CLOCK_PASSES):
        if not plans:
            break
        wid = write_id("smart-clock")
        env, why = await call(SMART_CLOCK_APP, "smartClockSend", {"plans": plans}, wid, PACK_S)
        if not env or env.get("status") != 200:
            if env is None:
                void_soon(SMART_CLOCK_APP, wid)
            told["left"] = len(plans)
            log.warning("smart clock: a pass did not land (%s)", str((env or {}).get("message") or why)[:160])
            break
        out = env.get("data") or {}
        for k in ("told", "rehearsed", "sms", "email", "deduplicated", "lost"):
            told[k] += int(out.get(k) or 0)
        told["would"] += len(out.get("would") or [])
        told["failed"] = (told["failed"] + list(out.get("failed") or []))[:20]
        plans = out.get("left") or []
    data["sent"] = told
    return data


async def smart_clock_turn(reminders: bool) -> None:
    try:
        got = await smart_clock_run(reminders)
        if got is None:
            return
        if (got.get("reminders") or {}).get("situations") is not None:
            _SMART_CLOCK["reminded"] = time.time()
        sent = got.get("sent") or {}
        # a turn that told, rehearsed or held somebody (`would`: what test mode kept) is heard by every Smart Comms
        # page, and the Activity follows it live. Rung only, never swept: a sweep mark would answer every read of
        # the pack 503 until the copy caught up, which on a two-minute clock is always
        if sent.get("told") or sent.get("rehearsed") or sent.get("would"):
            live_notify.told(rang=[SMART_COMMS_EVENT])
        # a subject that could not be read is said when it starts or stops failing, not every turn
        unread = (got.get("events") or {}).get("unread") or []
        if sent.get("plans") or unread != _SMART_CLOCK.get("unread"):
            _SMART_CLOCK["unread"] = unread
            log.info("smart clock: %s", json.dumps(got, separators=(",", ":"), default=str)[:400])
    except Exception as exc:  # noqa: BLE001 - the clock's next tick asks again
        log.warning("smart clock: %s", type(exc).__name__)


def smart_clock_kick() -> None:
    now = time.time()
    task = _SMART_CLOCK["task"]
    if (task is not None and not task.done()) or now - _SMART_CLOCK["at"] < SMART_CLOCK_EVERY_S:
        return
    _SMART_CLOCK["at"] = now
    remind = now - _SMART_CLOCK["reminded"] >= SMART_CLOCK_REMIND_EVERY_S
    _SMART_CLOCK["task"] = spawn(smart_clock_turn(remind))


def _said(env: dict[str, Any]) -> Response:
    return Response(content=json.dumps(env), media_type="application/json")


async def smart_comms_run(env: dict[str, Any], raw: bytes, request: Any) -> Response:
    """smartCommsRun, the Desk's Run (an admin's): one whole turn of the clock now, events first, after the turn this
    clock is already running; a rung of the front door (front_door.RUNGS), behind its guards."""
    if len(raw) > ENVELOPE_MAX or not isinstance(env, dict):
        return _said({"status": 400, "message": "The request could not be read."})
    token = str(env.get("token") or "")
    s = await FD.session(token) if token and not FD.is_service(raw) else None
    if s is None or not s.ok or s.role.strip().lower() != "admin":
        return _said({"status": 403, "message": "Requires an admin account"})
    task = _SMART_CLOCK["task"]
    if task is not None and not task.done():
        await asyncio.wait({task}, timeout=PACK_S)
    got = await smart_clock_run(True)
    if got is None:
        return _said(SMART_CLOCK_UNREAD)
    _SMART_CLOCK["reminded"] = time.time()
    body = json.dumps({"status": 200, "data": got}, default=str)
    smart_comms_rang()
    return Response(content=body, media_type="application/json")


async def inbound_run(ask: dict[str, Any], user: dict[str, Any]) -> dict[str, Any] | None:
    """commsInboundRun_: commsInboundFetch reads, commsInboundKeep files; the sweep's answer, None when Python did not
    answer."""
    read, _why = await call(OPT_OUTS_APP, "commsInboundFetch", ask, wait=PACK_S)
    if read is None:
        return None
    data = read.get("data") if isinstance(read.get("data"), dict) else None
    if read.get("status") != 200 or data is None:
        return read
    if isinstance(data.get("answer"), dict):
        return data["answer"]
    wid = write_id("inbound")
    answer, _why = await call(OPT_OUTS_APP, "commsInboundKeep", {"run": data.get("run") or {}}, wid, PACK_S)
    if answer is None:
        void_soon(OPT_OUTS_APP, wid)
        return None
    answer.pop("_write", None)
    return answer


async def inbound_auto_turn() -> None:
    """commsInboundSweepMaybe_, so a STOP never waits for somebody to open a screen. Never raises."""
    try:
        got = await inbound_run({"mode": "auto"}, SERVICE)
        data = (got or {}).get("data") or {}
        if got is None or got.get("status") != 200:
            log.warning("inbound sweep: %s", str((got or {}).get("message") or "Python did not answer")[:160])
        elif data.get("recorded") or data.get("stops") or data.get("starts"):
            log.info("inbound sweep: %s", data.get("message"))
    except Exception as exc:  # noqa: BLE001 - the next beat asks again
        log.warning("inbound sweep: %s", type(exc).__name__)


def inbound_auto_kick() -> None:
    now = time.time()
    task = _INBOUND_AUTO["task"]
    if (task is not None and not task.done()) or now - _INBOUND_AUTO["at"] < INBOUND_AUTO_EVERY_S:
        return
    _INBOUND_AUTO["at"] = now
    _INBOUND_AUTO["task"] = spawn(inbound_auto_turn())


async def clock_sweep(app_id: str, look: str, sweep: str) -> dict[str, Any] | None:
    """One rider: its look, then — when due — its write handed the look's answer, again with what a pass hands back
    until nothing is left; the last write's answer, None when nothing was due or Python did not answer."""
    read, why = await call(app_id, look, {}, wait=PREPARE_S)
    data = read.get("data") if read and read.get("status") == 200 and isinstance(read.get("data"), dict) else None
    if data is None:
        log.warning("clock riders: %s not read (%s)", look, str((read or {}).get("message") or why)[:160])
        return None
    if not data.get("due"):
        return None
    payload: dict[str, Any] = {"prepared": data}
    env: dict[str, Any] = {}
    for _ in range(LANE_PASSES):
        env = await one_pass(app_id, sweep, payload)
        if env.get("status") != 200:
            log.warning("clock riders: %s did not land (%s)", sweep, str(env.get("message") or env.get("status"))[:160])
            return None
        env.pop("_write", None)
        out = env.get("data") or {}
        if not out.get("left"):
            break
        payload = {"prepared": {**data, "plans": out["left"]}, "out": out.get("out")}
    return env


async def clock_sweeps_turn() -> None:
    """The riders in order; the attendance rows the call-off form hands back pressed through Staff attendance's own
    lane (staffAttendancePunch). Never raises."""
    for app_id, look, sweep in CLOCK_SWEEPS:
        try:
            env = await clock_sweep(app_id, look, sweep)
            if not env:
                continue
            data = env.get("data") or {}
            log.info("clock riders: %s %s", sweep, json.dumps({k: v for k, v in data.items() if k != "handed"},
                                                              separators=(",", ":"), default=str)[:300])
            for hand in data.get("handed") or []:
                if hand.get("action") != "staffAttendancePunch":
                    continue
                said = await service_door(STAFF_ALERTS_APP, "staffAttendancePunch", hand.get("payload") or {})
                log.info("clock riders: the form's late and no-show rows → %s",
                         json.dumps((said or {}).get("data") or (said or {}).get("message"), default=str)[:200])
        except Exception as exc:  # noqa: BLE001 - the next turn asks again
            log.warning("clock riders: %s (%s)", sweep, type(exc).__name__)


def clock_sweeps_kick() -> None:
    now = time.time()
    task = _CLOCK_SWEEPS["task"]
    if (task is not None and not task.done()) or now - _CLOCK_SWEEPS["at"] < CLOCK_SWEEPS_EVERY_S:
        return
    _CLOCK_SWEEPS["at"] = now
    _CLOCK_SWEEPS["task"] = spawn(clock_sweeps_turn())


async def fast_beat() -> None:
    """One beat of _fast_sweep_loop, in its order."""
    started = time.monotonic()
    hiring_accounts_kick()
    smart_clock_kick()
    inbound_auto_kick()
    await app_clock("scheduling", "schedulingClockDue", "schedulingClockSweep")
    clock_sweeps_kick()
    _SCREEN_COLLECT[0] += 1
    if _SCREEN_COLLECT[0] % SCREEN_COLLECT_EVERY_TICKS == 0:
        try:
            await pair(HIRING_APP, "screenCollectDue", "screenCollectSweep")
        except Exception as exc:  # noqa: BLE001 - the next beat asks again
            log.warning("screen collect: %s", str(exc)[:160])
    await beat("hub.fast_sweep", FAST_EVERY_S, refused_in_a_row=_SWEEP_FAILURES["hiring"],
               seconds=round(time.monotonic() - started, 1))


async def fast_loop() -> None:
    while True:
        started = time.monotonic()
        try:
            await fast_beat()
        except Exception:  # noqa: BLE001 - the beat stands; the next one runs
            log.exception("fast beat failed")
        # the remainder, never a fresh 20 seconds on top of the work
        await asyncio.sleep(max(1.0, FAST_EVERY_S - (time.monotonic() - started)))


# ---- the staff beat --------------------------------------------------------------------------------------------------

def engine_build() -> str:
    """The kept build, else HUB_GAS_ENGINE_BUILD; '' when neither names one."""
    try:
        kept = str(json.loads(ENGINE_BUILD_PATH.read_text()).get("build") or "")
    except Exception:  # noqa: BLE001 - no file is no build
        kept = ""
    return kept or os.getenv("HUB_GAS_ENGINE_BUILD", "").strip()


async def look_then_sweep(app_id: str, look: str, sweep: str, tag: str, label: str,
                          due: Callable[[dict[str, Any]], bool], body: Callable[[dict[str, Any]], dict[str, Any]],
                          look_wait: float = READ_S) -> dict[str, Any] | None:
    """A look, then one write when it says something waits; the write's data, None when nothing landed. Never
    raises."""
    try:
        read, why = await call(app_id, look, {}, wait=look_wait)
        data = read.get("data") if read is not None and read.get("status") == 200 else None
        if data is None:
            log.warning("%s: not read (%s)", label, why if read is None else
                        str(read.get("message") or read.get("status"))[:160])
            return None
        if not due(data):
            return None
        env, why = await call(app_id, sweep, body(data), write_id(tag), PACK_S)
        if not env or env.get("status") != 200:
            log.warning("%s: the sweep did not land (%s)", label, str((env or {}).get("message") or why)[:160])
            return None
        log.info("%s: %s", label, json.dumps(env.get("data") or {}, separators=(",", ":"))[:300])
        return env.get("data") or {}
    except Exception as exc:  # noqa: BLE001 - the clock's next tick asks again
        log.warning("%s: %s", label, type(exc).__name__)
        return None


async def broadcast_carry() -> None:
    """commBroadcastQuietCarry_: once the quiet window is over, each broadcast it held carried, one write each. Never
    raises."""
    try:
        read, why = await call(BROADCAST_APP, "staffBroadcastHeld", {})
        data = read.get("data") if read is not None and read.get("status") == 200 else None
        if data is None:
            log.warning("broadcast carry: the held ones were not read (%s)", why)
            return
        for bid in data.get("ids") or []:
            env, why = await call(BROADCAST_APP, "staffBroadcastCarry", {"id": bid},
                                  write_id(f"broadcast-carry|{bid}"), PACK_S)
            if not env or env.get("status") != 200:
                log.warning("broadcast carry: %s not carried (%s)", bid, str((env or {}).get("message") or why)[:160])
                continue
            said = env.get("data") or {}
            log.info("broadcast carry: %s %s — %s", bid, said.get("state"), str(said.get("why") or "")[:200])
            if said.get("state") != "kept":
                smart_comms_rang()
    except Exception as exc:  # noqa: BLE001 - the clock's next tick asks again
        log.warning("broadcast carry: %s", type(exc).__name__)


async def letters_sweep() -> None:
    if not _LETTERS_SEEN_AT:
        _LETTERS_SEEN_AT.append(time.time())
    await look_then_sweep("letters", "lettersDue", "lettersSweep", "letters", "letters",
                          lambda d: not (d.get("ready") and not d.get("due") and not d.get("untrue")),
                          lambda _d: {"since": _LETTERS_SEEN_AT[0], "build": engine_build()})


async def team_alerts_sweep() -> None:
    if not _TEAM_ALERTS_SEEN_AT:
        _TEAM_ALERTS_SEEN_AT.append(time.time())
    await look_then_sweep("team-alerts", "teamAlertsDue", "teamAlertsSweep", "team-alerts", "team alerts",
                          lambda d: not (d.get("ready") and not d.get("due") and not d.get("untrue")),
                          lambda _d: {"since": _TEAM_ALERTS_SEEN_AT[0], "build": engine_build()})


async def app_release_sweep() -> None:
    await look_then_sweep("app-release", "appReleaseDue", "appReleaseSweep", "app-release-sweep",
                          "app release sweep", lambda d: bool(d.get("pending")), lambda _d: {})


async def ist_sweep() -> None:
    await look_then_sweep(IST_APP, "istNoticeDue", "istNoticeSweep", "ist-notices", "ist notices",
                          lambda d: bool(d.get("due")), lambda _d: {})


async def recon_auto() -> None:
    """reconAutoSweep_: the newest punches imported and a run made once a day (the door keeps its own mark)."""
    done = await look_then_sweep(RECON_APP, "reconAutoSweep", "reconAutoRecord", "recon-auto", "recon auto",
                                 lambda d: bool(d.get("due")), lambda d: {"prepared": d}, look_wait=PREPARE_S)
    if done is not None:
        live_notify.told(swept=[RECON_APP])


async def req_states_sweep() -> None:
    """The requirement states rebuilt every six hours (requirementStatesSweepMaybe_). Never raises."""
    if time.time() - _REQ_STATES_RAN[0] < REQ_STATES_EVERY_S:
        return
    _REQ_STATES_RAN[0] = time.time()
    try:
        env, why = await call(COMPLIANCE_ENGINE_APP, "requirementStatesSweep", {}, write_id("req-states"), PACK_S)
        if not env or env.get("status") != 200:
            log.warning("requirement states: the rebuild did not land (%s)", str((env or {}).get("message") or why)[:160])
            return
        log.info("requirement states: %s", json.dumps(env.get("data") or {}, separators=(",", ":"))[:300])
    except Exception as exc:  # noqa: BLE001 - the clock's next tick asks again
        log.warning("requirement states: %s", type(exc).__name__)


async def comm_bindings_seed() -> None:
    """commBindingsSeedMaybe_: the look, then — only when a shipped binding is missing or blank — its plans carried
    pass by pass. Never raises."""
    try:
        read, why = await call(COMM_BINDINGS_APP, "commBindingsSeedDue", {}, wait=PREPARE_S)
        data = read.get("data") if read is not None and read.get("status") == 200 else None
        if data is None:
            log.warning("comm bindings: not read (%s)", why if read is None else
                        str(read.get("message") or read.get("status"))[:160])
            return
        plans = (data.get("plans") or []) if data.get("due") else []
        for _ in range(COMM_BINDINGS_PASSES):
            if not plans:
                return
            wid = write_id("comm-bindings")
            env, why = await call(COMM_BINDINGS_APP, "commBindingsSeed", {"plans": plans}, wid, PACK_S)
            if not env or env.get("status") != 200:
                if env is None:
                    void_soon(COMM_BINDINGS_APP, wid)
                log.warning("comm bindings: a pass did not land (%s)", str((env or {}).get("message") or why)[:160])
                return
            out = env.get("data") or {}
            plans = out.pop("left", None) or []
            log.info("comm bindings: %s", json.dumps(out, separators=(",", ":"))[:300])
    except Exception as exc:  # noqa: BLE001 - the clock's next tick asks again
        log.warning("comm bindings: %s", type(exc).__name__)


async def hiring_handed(handed: list[dict[str, Any]]) -> None:
    """The presses a hiring write handed back: each pressed through its own lane as the service — its prepare read
    first when it has one — and what came of them recorded by hiringSimPressRecord. Never raises."""
    results = []
    for entry in handed or []:
        action = str(entry.get("action") or "")
        payload = entry.get("payload") if isinstance(entry.get("payload"), dict) else {}
        app_id = FD.READS.get(action, HIRING_APP)
        try:
            prepare = FD.PREPARE.get(action)
            if prepare is not None and (not prepare[1] or payload.get(prepare[1])):
                env_p, _why = await call(app_id, prepare[0], payload, wait=PREPARE_S)
                if env_p is None or env_p.get("status") != 200:
                    results.append({**entry, "status": (env_p or {}).get("status") or 503,
                                    "message": str((env_p or {}).get("message") or "its preparation was not done")})
                    continue
                payload = {**{k: v for k, v in payload.items() if k != prepare[1]}, "prepared": env_p.get("data")}
            env, why = await call(app_id, action, payload, write_id(action), PACK_S)
            env = dict(env) if env is not None else {"status": 503, "message": why}
            env.pop("_write", None)
            results.append({**entry, "status": env.get("status"), "data": env.get("data"),
                            "message": env.get("message")})
        except Exception as exc:  # noqa: BLE001 - said as this press's own failure
            results.append({**entry, "status": 503, "message": type(exc).__name__})
    if not results:
        return
    try:
        await call(HIRING_APP, "hiringSimPressRecord", {"results": results}, write_id("hiringSimPressRecord"), PACK_S)
    except Exception as exc:  # noqa: BLE001 - the presses stand; their journey lines are what is missing
        log.warning("hiring presses: not recorded (%s)", type(exc).__name__)


async def hiring_clock(tick: int) -> None:
    """The hiring lane's own passes in Hired.gs's order, then the simulator's retry pass. Never raises."""
    for look, sweep, prepared, every in HIRING_CLOCK:
        if tick % every:
            continue
        try:
            env = await pair(HIRING_APP, look, sweep, prepared=prepared)
            if env.get("status") != 200:
                log.warning("hiring clock: %s answered %s (%s)", sweep, env.get("status"),
                            str(env.get("message") or "")[:160])
            elif (env.get("data") or {}).get("due") is None and env.get("data"):
                # a pass that landed: every candidate's pack is read again
                live_notify.told(swept=[CANDIDATES_PACK])
                log.info("hiring clock: %s %s", sweep, json.dumps(env["data"], separators=(",", ":"))[:240])
        except Exception as exc:  # noqa: BLE001 - the next look asks again
            log.warning("hiring clock: %s (%s)", sweep, str(exc)[:160])
    if tick % HIRING_SIM_EVERY_TICKS:
        return
    try:
        env = await pair(HIRING_APP, "hiringSimRetryDue", "hiringSimRetryNow")
        handed = (env.get("data") or {}).get("handed")
        if handed:
            await hiring_handed(handed)
    except Exception as exc:  # noqa: BLE001 - the next tick asks again
        log.warning("hiring sim retry: %s", str(exc)[:160])


def drive_intake_kick(app_id: str) -> None:
    if app_id in DRIVE_INTAKE and app_id not in _DRIVE_INTAKE_RUNNING:
        _DRIVE_INTAKE_RUNNING.add(app_id)
        spawn(drive_intake_sweep(app_id))


async def drive_intake_sweep(app_id: str) -> None:
    """An app's Drive files brought onto the server: what is new or changed fetched (a few files a call) and recorded,
    again while more is left. Never raises."""
    fetch, keep = DRIVE_INTAKE[app_id]
    try:
        for _ in range(DRIVE_INTAKE_PASSES_OF.get(app_id, DRIVE_INTAKE_PASSES)):
            got, why = await call(app_id, fetch, {}, wait=PACK_S)
            data = got.get("data") if got is not None and got.get("status") == 200 else None
            if data is None:
                log.warning("%s: its Drive files were not read (%s)", app_id,
                            why if got is None else str(got.get("message") or ""))
                return
            items = data.get("items") or []
            gone = data.get("gone") or []
            if items or gone:
                env, why = await call(app_id, keep, {"items": items, **({"gone": gone} if gone else {})},
                                      "W" + hashlib.sha256(f"{app_id}|intake|{time.time_ns()}".encode()).hexdigest()[:24],
                                      PACK_S)
                log.info("%s: %s", app_id, json.dumps((env or {}).get("data") or {}, separators=(",", ":"))[:200]
                         if env and env.get("status") == 200 else (why or "not kept"))
                if not env or env.get("status") != 200:
                    return
                if app_id in DRIVE_INTAKE_SLICES:
                    live_notify.dirty(DRIVE_INTAKE_SLICES[app_id])
            if data.get("left"):
                log.info("%s: left in Drive this pass: %s", app_id, "; ".join(data["left"])[:300])
            if not data.get("more"):
                return
    except Exception as exc:  # noqa: BLE001 - the clock's next tick asks again
        log.warning("%s intake: %s", app_id, type(exc).__name__)
    finally:
        _DRIVE_INTAKE_RUNNING.discard(app_id)


async def potential_clients_sync() -> None:
    """The scraper's new referrals in Postgres, hourly: the sheet uploaded again (rows not there yet added, rows nothing
    here touched brought up to date), and its slice built again. Never raises."""
    if time.time() - _POTENTIAL_CLIENTS_SYNCED[0] < POTENTIAL_CLIENTS_SYNC_EVERY_S:
        return
    _POTENTIAL_CLIENTS_SYNCED[0] = time.time()
    try:
        env, why = await call(POTENTIAL_CLIENTS_APP, POTENTIAL_CLIENTS_UPLOAD, {}, write_id(POTENTIAL_CLIENTS_UPLOAD),
                              PACK_S)
        if env is None or env.get("status") != 200:
            log.warning("resource rows: %s not uploaded again (%s)", POTENTIAL_CLIENTS_APP,
                        why if env is None else env.get("status"))
            return
        done = env.get("data") if isinstance(env.get("data"), dict) else {}
        log.info("resource rows: %s uploaded again %s", POTENTIAL_CLIENTS_APP, done)
        live_notify.dirty(r for r in done if r in POTENTIAL_CLIENTS_SLICES)
    except Exception as exc:  # noqa: BLE001 - the rows Postgres holds stand
        log.warning("resource rows: %s not uploaded again (%s)", POTENTIAL_CLIENTS_APP, type(exc).__name__)


async def comm_calls_sweep() -> None:
    """commCallsSweep: the fetch reads and asks the model, the keep files; again while it hands plans back. Never
    raises."""
    try:
        read, why = await call(COMM_CALLS_APP, "commCallsSweepFetch", {}, wait=PACK_S)
        if not read or read.get("status") != 200:
            log.warning("comm calls sweep: not read (%s)", str((read or {}).get("message") or why)[:160])
            return
        data = read.get("data") or {}
        body: dict[str, Any] = {"plans": data.get("plans") or [], "tally": data.get("tally") or data}
        out: dict[str, Any] = {}
        for _ in range(COMM_CALLS_PASSES):
            wid = write_id("comm-calls-sweep")
            env, why = await call(COMM_CALLS_APP, "commCallsSweepKeep", body, wid, PACK_S)
            if env is None or env.get("status") != 200:
                if env is None:
                    void_soon(COMM_CALLS_APP, wid)
                log.warning("comm calls sweep: a pass did not land (%s)", str((env or {}).get("message") or why)[:160])
                return
            out = env.get("data") or {}
            if not out.get("left"):
                break
            body = {"plans": out["left"], "tally": out.get("tally") or out}
        live_notify.dirty(COMM_CALLS_SLICES)
        if out.get("classified") or out.get("failed"):
            log.info("comm calls sweep: %s classified (%s items), %s failed, %s already read",
                     out.get("classified"), out.get("items"), out.get("failed"), out.get("already_read"))
    except Exception as exc:  # noqa: BLE001 - the next tick asks again
        log.warning("comm calls sweep: %s", type(exc).__name__)


async def comm_replies() -> dict[str, Any] | None:
    """The mailbox ear: the look reads the inbox, the keep files pass by pass."""
    env, _why = await call(COMM_REPLIES_APP, "commRepliesDue", {}, wait=PACK_S)
    if not env or env.get("status") != 200 or (env.get("data") or {}).get("skipped"):
        return env
    look = dict(env["data"])
    threads = look.pop("threads", [])

    def carry(_p: dict, data: dict) -> dict | None:
        left = data.pop("left", None)
        return {"look": look, "threads": left, "tally": data} if left else None

    return await lane_passes(COMM_REPLIES_APP, "commRepliesKeep", {"look": look, "first": True, "threads": threads},
                             carry)


async def comm_repair() -> dict[str, Any] | None:
    """The repair pass: the look names the door, its passes carry the rest."""
    read, _why = await call(COMM_REPAIR_APP, "commRepairDue", {}, wait=PACK_S)
    if not read or read.get("status") != 200:
        return read
    door = {"continue": "commRepairContinue", "sweep": "commRepairSweep"}.get((read.get("data") or {}).get("due"))
    if not door:
        return {"status": 200, "data": {"skipped": True, "why": "nothing is owed a correction pass"}}
    seen: dict[str, int] = {}

    def carry(_p: dict, data: dict) -> dict | None:
        for k in ("planned", "said", "deferred", "held_by_dial", "held_at_the_door", "undeliverable"):
            seen[k] = seen.get(k, 0) + int(data.get(k) or 0)
        if not data.get("again"):
            return None
        return {"force": True} if door == "commRepairSweep" else {}

    env = await lane_passes(COMM_REPAIR_APP, door, {}, carry)
    if env is not None and env.get("status") == 200:
        env["data"] = {**(env.get("data") or {}), **seen}
    return env


async def comm_record() -> dict[str, Any] | None:
    """The obligations sweep: the plan read, then kept pass by pass."""
    look, _why = await call(COMM_RECORD_APP, "commRecordPlan", {}, wait=PACK_S)
    if not look or look.get("status") != 200:
        return look
    data = look.get("data") or {}
    if data.get("due") is not True:
        return {"status": 200, "data": {"skipped": True, "why": data.get("why") or "window"}}
    n = [0]

    def carry(p: dict, out: dict) -> dict | None:
        n[0] += 1
        if not out.get("left"):
            return None
        return {"run": p["run"], "plans": out["left"], "tally": out.get("tally"), "first": False,
                "last": n[0] >= LANE_PASSES - 1}

    env = await lane_passes(COMM_RECORD_APP, "commRecordKeep",
                            {"run": data.get("run"), "plans": data.get("plans") or [],
                             "stamp": data.get("stamp") is True, "first": True, "last": False}, carry)
    if env is not None and env.get("status") == 200 and (env.get("data") or {}).get("intents"):
        smart_comms_rang()
    return env


async def _lane_tick(name: str, run: Callable[[], Coroutine[Any, Any, dict[str, Any] | None]]) -> dict[str, Any] | None:
    """A Smart Comms lane rung on the clock: its answer when it ran, None when it failed (counted and said)."""
    try:
        env = await run()
        if env is None:
            raise RuntimeError("Python did not answer")
    except Exception as exc:  # noqa: BLE001
        _SWEEP_FAILURES[name] += 1
        log.warning("%s tick failed (%sx in a row): %s", name.replace("_", " "), _SWEEP_FAILURES[name],
                    type(exc).__name__)
        return None
    if env.get("status") != 200:
        _SWEEP_FAILURES[name] += 1
        log.warning("%s tick refused: %s", name.replace("_", " "), str(env.get("message") or env)[:160])
        return None
    _SWEEP_FAILURES[name] = 0
    return env.get("data") or {}


async def comm_replies_tick() -> None:
    got = await _lane_tick("comm_replies", comm_replies)
    if got is None or got.get("skipped"):
        return
    if got.get("captured"):
        log.info("comm replies: %s read of %s from people we know (%s seen before, %s with nothing open)",
                 got.get("captured"), got.get("mine"), got.get("already"), got.get("no_thread"))
        # the Replies page reads again on the ring (rung only, never a sweep mark)
        live_notify.told(rang=[SMART_COMMS_EVENT])
    elif time.time() - _COMM_REPLIES_ALIVE[0] > 3600:
        # a pass that read the inbox and found nothing is still a pass
        _COMM_REPLIES_ALIVE[0] = time.time()
        log.info("comm replies: the ear is alive — %s thread(s) read, none of them a reply to us", got.get("read"))


async def comm_repair_tick() -> None:
    got = await _lane_tick("comm_repair", comm_repair)
    if got is None:
        return
    if got.get("skipped") is True:
        log.info("comm repair: not due (%s)", got.get("why") or got.get("note") or "window")
        return
    if not got.get("incidents"):
        log.info("comm repair: nothing is owed a correction")
        return
    log.info("comm repair: %s incident(s), %s owed a word, %s said%s, "
             "%s deferred to the morning, %s held by the dial, %s held at the door, %s undeliverable",
             got.get("incidents"), got.get("planned"), got.get("said"),
             " (%s to the testers)" % got.get("redirected") if got.get("redirected") else "",
             got.get("deferred"), got.get("held_by_dial"), got.get("held_at_the_door"), got.get("undeliverable"))


async def comm_record_tick() -> None:
    got = await _lane_tick("comm_record", comm_record)
    if got is None:
        return
    if got.get("skipped") is True:
        log.info("comm record: not due (%s)", got.get("why") or got.get("note") or "window")
        return
    log.info("comm record: %s intent(s) recorded, %s sent%s, %s held, %s gated, %s unreachable%s",
             got.get("intents"), got.get("sent"),
             " (%s to the testers)" % got.get("redirected") if got.get("redirected") else "",
             got.get("held"), got.get("gated"), got.get("unreachable"),
             "" if got.get("complete", True) else " — paused, resuming next tick")


async def contact_clock() -> None:
    """contactAutoSweep's contact pass, hourly: its look (nothing while Settings has not armed the clock), then its
    write. Never raises."""
    try:
        env = await pair(SETTINGS_TOOLS_APP, "contactSweepDue", "contactSweepRun")
        data = env.get("data") or {}
        if env.get("status") != 200:
            log.warning("contact clock: %s", str(env.get("message") or env.get("status"))[:160])
        elif data.get("ran"):
            quo = data.get("quo") or {}
            log.info("contact clock: %s phone(s) filled; %s", data.get("filled"),
                     json.dumps({k: quo.get(k) for k in ("updated", "phonesAdded", "emailsAdded", "error", "skipped")
                                 if quo.get(k) is not None}, separators=(",", ":"))[:300])
    except Exception as exc:  # noqa: BLE001 - the next hourly tick asks again
        log.warning("contact clock: %s", str(exc)[:160])


async def talent_sync() -> None:
    """The legacy recruiting workbook's new rows onto the talent pipeline, hourly: read first, then one write."""
    try:
        env = await pair(HIRING_APP, "talentPipelineDue", "talentPipelineSweep")
        added = (env.get("data") or {}).get("added") or {}
        if any(added.values()):
            log.info("talent sync: %s", added)
        elif env.get("status") == 200:
            log.info("talent sync: nothing new in the legacy workbook")
        _SWEEP_FAILURES["talent"] = 0
    except Exception as exc:  # noqa: BLE001
        _SWEEP_FAILURES["talent"] += 1
        log.warning("talent sync failed (%sx in a row): %s", _SWEEP_FAILURES["talent"], type(exc).__name__)


async def staff_beat(tick: int) -> None:
    """One tick of the relay's _staff_sweep_loop, its passes that are Python's doors alone, in its order."""
    await beat("hub.app_staff_sweep", STAFF_EVERY_S, tick=tick)
    try:
        # the mailbox read and classified first, then one write keeps the pass and raises its texts
        env = await pair(STAFF_ALERTS_APP, "staffAttendanceDue", "staffAttendanceSweep")
        data = env.get("data") or {}
        if data.get("matched"):
            log.info("staff sweep: %s matched, %s alerted, %s filed-only",
                     data.get("matched"), data.get("alerted"), data.get("filed_only"))
        _SWEEP_FAILURES["staff"] = 0
    except Exception as exc:  # noqa: BLE001
        _SWEEP_FAILURES["staff"] += 1
        log.warning("staff sweep failed (%sx in a row): %s", _SWEEP_FAILURES["staff"], type(exc).__name__)
    await app_clock("support-desk", "supportDeskClockDue", "supportDeskClockSweep")
    await app_clock("transportation", "vehicleCalendarClockDue", "vehicleCalendarClockSweep", prepared=False)
    await broadcast_carry()
    await letters_sweep()
    await app_release_sweep()
    await ist_sweep()
    await recon_auto()
    await comm_bindings_seed()
    await hiring_clock(tick)
    await req_states_sweep()
    for intake_app in DRIVE_INTAKE:
        drive_intake_kick(intake_app)
    await potential_clients_sync()
    await team_alerts_sweep()
    await comm_calls_sweep()
    await comm_replies_tick()
    if tick % 6 == 2:
        await contact_clock()
    if tick % 6 == 0:
        await talent_sync()
        # the repair pass first, ahead of the obligations sweep
        await comm_repair_tick()
        await comm_record_tick()


async def staff_loop() -> None:
    tick = 0
    while True:
        await asyncio.sleep(STAFF_EVERY_S)
        tick += 1
        try:
            await staff_beat(tick)
        except Exception:  # noqa: BLE001 - the tick stands; the next one runs
            log.exception("staff beat failed")


async def sweep_beat(tick: int) -> None:
    """One tick of what was left on the relay's _staff_sweep_loop, in its order: the hotline's inbox pass and its
    beat, then the feeds."""
    import hotline_fast  # noqa: PLC0415 - it builds on this module
    import staff_feeds  # noqa: PLC0415

    await hotline_fast.inbox_pass()
    await staff_feeds.tick(tick)


async def sweep_loop() -> None:
    """The relay's _staff_sweep_loop whole: its watchdog beat, its passes, and on every sixth tick the arriving calls
    (app/comm_calls_door.py)."""
    import comm_calls_door  # noqa: PLC0415 - it builds on this module

    tick = 0
    while True:
        await asyncio.sleep(STAFF_EVERY_S)
        tick += 1
        await beat("hub.staff_sweep", STAFF_EVERY_S, tick=tick)
        try:
            await sweep_beat(tick)
        except Exception:  # noqa: BLE001 - the tick stands; the next one runs
            log.exception("sweep beat failed")
        # the first tick too: a restart never leaves the arriving calls an hour unread
        if tick == 1 or tick % 6 == 0:
            try:
                await comm_calls_door.live_tick()
            except Exception:  # noqa: BLE001 - the next hour reads again
                log.exception("comm calls tick failed")


# ---- the pharmacy reports' sweep -------------------------------------------------------------------------------------

HOUSE_MEDS_EVERY_S = 60.0


def _house_meds_turn(prepare: bool) -> dict[str, Any] | None:
    """Blocking: the lane prepared (its expired drops, the matches owed), or the sweep when its six hours are up;
    None when nothing ran."""
    import house_meds as HM  # noqa: PLC0415
    import house_meds_import as HMI  # noqa: PLC0415
    import lane_gate as LG  # noqa: PLC0415 - the reads every door is handed, Python's own writes laid

    conn = HM._conn()  # noqa: SLF001
    if prepare:
        matched = LG.in_reads(lambda reads: HMI.prepare(conn, reads))
        if matched:
            log.info("house meds: %s PatID(s) matched at the clock's start", matched)
        return None
    if not HMI.sweep_due(conn):
        return None
    return LG.in_reads(lambda reads: HMI.sweep(conn, reads))


async def house_meds_loop() -> None:
    """The lane's own beat: prepared once, then every minute the sweep is looked at and run when its six hours are
    up."""
    try:
        await asyncio.to_thread(_house_meds_turn, True)
    except Exception as exc:  # noqa: BLE001 - the doors and the sweep build on what is there
        log.warning("house meds: the lane could not be prepared (%s)", type(exc).__name__)
    while True:
        await asyncio.sleep(HOUSE_MEDS_EVERY_S)
        try:
            said = await asyncio.to_thread(_house_meds_turn, False)
            if said is not None:
                read = said.get("read") or {}
                log.info("house meds: sweep — %s listed, %s on file, %s imported%s", read.get("listed"),
                         read.get("known"), len(said.get("imported") or []),
                         f" — {read.get('error')}" if read.get("error") else "")
        except Exception as exc:  # noqa: BLE001 - the next minute looks again
            log.warning("house meds: the sweep failed (%s)", type(exc).__name__)


# ---- the Quo pipeline ------------------------------------------------------------------------------------------------

def quo_handoff_wake() -> None:
    _QUO_WAKE.set()


def told_kept() -> None:
    """A text kept: the hand-off now, and the reply ear hears it now, not at its next minute."""
    quo_handoff_wake()
    sms_ears_wake()


async def quo_calls_kick(records: list[dict[str, Any]]) -> None:
    """quoCommCallsKick_: each transcript filed live posted to the phone-call lane's door with the service secret,
    fire-and-forget — a kick never fails the filing."""
    if not SERVICE_SECRET:
        return
    import httpx  # noqa: PLC0415 - absent from the in-process runner

    for record in records:
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                await client.post(QUO_CALLS_KICK_URL, json={"record": record, "service_secret": SERVICE_SECRET})
        except Exception as exc:  # noqa: BLE001 - the lane's own sweep reads the transcript either way
            log.info("quo inbox: a transcript kick did not land (%s)", type(exc).__name__)


async def quo_ingest(events: list[dict[str, Any]]) -> dict[str, Any]:
    """quoIngestBatch: pass after pass while one stops early, the results together; a pass that fails leaves the rest
    unreached; the transcripts filed live kicked to the phone-call lane."""
    why = ingest_hold("quoIngestBatch", await config_lane())
    if why:
        return {"status": 409, "message": why, "held": True}
    started = time.monotonic()
    results: list[dict[str, Any]] = []
    kicks: list[dict[str, Any]] = []
    rest = events
    env: dict[str, Any] = {}
    for _ in range(LANE_PASSES):
        env = await one_pass(QUO_APP, "quoIngestBatch", {"events": rest})
        if env.get("status") != 200:
            break
        data = env.get("data") or {}
        got = data.get("results") or []
        results += got
        kicks += data.get("kick") or []
        rest = rest[len(got):]
        if not data.get("stopped_early") or not got or not rest:
            break
    if kicks:
        spawn(quo_calls_kick(kicks))
    if not results:
        return env
    return {"status": 200, "data": {"results": results, "reached": len(results), "left": len(events) - len(results),
                                    "stopped_early": len(results) < min(len(events), quo_inbox.BATCH_MAX),
                                    "ms": int((time.monotonic() - started) * 1000)}}


async def quo_handoff_once() -> bool:
    """One batch of the inbox to quoIngestBatch, and its answer back into the inbox."""
    now = time.time()
    if not await asyncio.to_thread(quo_inbox.ready, now):
        return False
    offer = await asyncio.to_thread(quo_inbox.pending, now)
    if not offer:
        return False
    # `recheck` rides with an event whose last offer ended without its own answer
    batch = [{"id": o["id"], "type": o["type"], "source": o["source"], "event": o["event"],
              "recheck": bool(o.get("recheck"))} for o in offer]
    env: Any = None
    failure: Exception | None = None
    # on the disk before it leaves: a mark that cannot be written raises here and nothing is posted
    await asyncio.to_thread(quo_inbox.begin_batch, offer, QUO_HANDOFF_HOLD_S, time.time())
    try:
        env = await quo_ingest(batch)
    except Exception as exc:  # noqa: BLE001 - judged by the inbox's policy below
        failure = exc
    said = await asyncio.to_thread(quo_inbox.after_batch, offer, env, failure, time.time())
    if said["verdict"] == "answered":
        log.info("quo inbox: batch of %s → %s filed, %s already, %s failed, %s not reached; %s left",
                 said["sent"], said["filed"], said["already"], said["failed"], said["unreached"], said["left"])
        return True
    key = f"{said['verdict']}|{said['why'][:80]}"
    now = time.time()
    if key != _QUO_HANDOFF_SAID["key"] or now - _QUO_HANDOFF_SAID["at"] >= QUO_HANDOFF_SAY_EVERY_S:
        _QUO_HANDOFF_SAID.update(key=key, at=now)
        log.warning("quo inbox: batch of %s %s (%s) — stood down %ss, next batch %s; %s left",
                    said["sent"], "FAILED" if said["verdict"] == "failed" else "refused whole",
                    said["why"] or "no reason given", said["paused_s"], said["next_size"], said["left"])
    return True


async def quo_backfill_feed() -> None:
    """History from tools/quo_backfill.py, a few at a time behind the live queue."""
    try:
        fed = await asyncio.to_thread(quo_inbox.feed_backfill, time.time())
    except Exception as exc:  # noqa: BLE001 - the live hand-off goes on regardless
        now = time.time()
        key = type(exc).__name__
        if key != _QUO_BACKFILL_SAID["key"] or now - _QUO_BACKFILL_SAID["at"] >= QUO_HANDOFF_SAY_EVERY_S:
            _QUO_BACKFILL_SAID.update(key=key, at=now)
            log.warning("quo inbox: the backfill spool could not be fed (%s) — the live hand-off goes on", key)
        return
    if fed["fed"]:
        log.info("quo inbox: backfill %s → %s fed, %s new, %s already kept%s", fed["spool"], fed["fed"],
                 fed["added"], fed["duplicate"], " — finished" if fed["finished"] else "")


async def quo_handoff_loop() -> None:
    """The inbox, handed to quoIngestBatch after the JSON."""
    try:
        await asyncio.to_thread(quo_inbox.prepare)
    except Exception as exc:  # noqa: BLE001 - every call loads it again
        log.warning("quo inbox: the kept days could not be read (%s)", type(exc).__name__)
    last_post = 0.0
    posted = False
    while True:
        if not posted:
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(_QUO_WAKE.wait(), timeout=QUO_HANDOFF_EVERY_S)
        _QUO_WAKE.clear()
        gap = last_post + QUO_HANDOFF_EVERY_S - time.time()
        if gap > 0:
            await asyncio.sleep(gap)
        started = time.time()
        posted = False
        try:
            await quo_backfill_feed()
            posted = await quo_handoff_once()
            if posted:
                last_post = started
            await asyncio.to_thread(quo_inbox.rotate, time.time())
        except Exception as exc:  # noqa: BLE001 - the inbox keeps every line; next pass
            log.warning("quo inbox: the hand-off pass failed: %s: %s", type(exc).__name__, str(exc)[:160])


async def quo_pull_round() -> dict[str, Any]:
    """One round of the pull: what no webhook delivered, asked of Quo and kept."""
    try:
        said = await asyncio.to_thread(quo_pull.run_round)
    except Exception as exc:  # noqa: BLE001 - the cursors stay; next round
        # the kind only, never the words: an exception born in a request can quote its headers
        log.warning("quo pull: the round failed: %s", type(exc).__name__)
        said = {}
    if said.get("added"):
        told_kept()
    if said.get("state") not in (None, "off") and (said.get("added") or said.get("state") != "ok"):
        log.info("quo pull: %s — %s/%s lines read, %s threads (%s failed, %s owed), %s messages, "
                 "%s transcripts (%s owed, %s call listings failed), "
                 "%s new, %s already kept, %s not delivered (%s watched)%s",
                 said.get("state"), said.get("lines_done"), said.get("lines"), said.get("threads"),
                 said.get("threads_failed"), said.get("owed"), said.get("messages"),
                 said.get("transcripts"), said.get("transcripts_owed"), said.get("calls_failed"),
                 said.get("added"), said.get("duplicate"), said.get("not_delivered"), said.get("watching"),
                 f" ({said.get('why')})" if said.get("why") else "")
    return said


async def quo_pull_loop() -> None:
    await asyncio.sleep(QUO_PULL_FIRST_S)
    while True:
        await quo_pull_round()
        await asyncio.sleep(quo_pull.EVERY_S)


# ---- the reply ear (app/sms_ears.py): woken by a kept text and every minute ------------------------------------------

def sms_ears_wake() -> None:
    """On the event loop only: a kept text asks the reply ear for a pass now."""
    _SMS_EARS_WAKE.set()


def sms_ears_wake_soon() -> None:
    """From any thread: the reply ear's pass now (live_notify's "sms-ears" wake, answered in this process)."""
    loop = _SMS_EARS_LOOP[0]
    if loop is None:
        return
    with contextlib.suppress(RuntimeError):
        loop.call_soon_threadsafe(_SMS_EARS_WAKE.set)


async def ear_run(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """A call of the ear's lanes on its own thread; each call leaves nothing open on its connections."""
    import lanes_pg  # noqa: PLC0415

    def run() -> Any:
        try:
            return fn(*args, **kwargs)
        finally:
            lanes_pg.finish()
    return await asyncio.get_running_loop().run_in_executor(_EAR_POOL, run)


def _ear_pass() -> dict[str, Any]:
    """One pass, beside the attendance loop of this same process: the shift flow's ledger and the punch pairing the
    ear weighs a text against are that loop's own memory (psi_reminders, punch_pairs)."""
    import sms_ears  # noqa: PLC0415

    return sms_ears.listen(SMS_EARS_DSN)


async def sms_ears_loop() -> None:
    """One pass of the reply ear per wake or per minute; a failed pass is retried next minute."""
    await asyncio.sleep(SMS_EARS_FIRST_S)
    while True:
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(_SMS_EARS_WAKE.wait(), timeout=SMS_EARS_EVERY_S)
        _SMS_EARS_WAKE.clear()
        if not os.getenv("HUB_DB_WRITE_DSN", "").strip():
            continue
        try:
            said = await ear_run(_ear_pass)
        except Exception as exc:  # noqa: BLE001 - nothing was written down; the next pass hears it
            log.warning("sms ears: the pass failed (%s)", type(exc).__name__)
            said = {}
        if said.get("acted"):
            live_notify.tell(wake=["notices"], events=["housecal"])
        if said.get("heard") or said.get("waiting"):
            log.info("sms ears: %s text(s) heard — %s; %s waiting%s", said.get("heard"),
                     ", ".join(f"{n} {k}" for k, n in sorted((said.get("outcomes") or {}).items()))
                     or "nothing written down", said.get("waiting"),
                     f" ({said.get('why')})" if said.get("why") else "")
        await sms_replies_post()


async def sms_replies_post() -> None:
    """The reply ear's acknowledgements through staffShiftReminder; what the door did not say stays owed."""
    try:
        import sms_ears  # noqa: PLC0415

        rows = await ear_run(sms_ears.owed, SMS_EARS_DSN)
    except Exception as exc:  # noqa: BLE001
        log.warning("sms ears: the owed acknowledgements could not be read (%s)", type(exc).__name__)
        return
    if not rows:
        return
    try:
        env = await service_door(STAFF_ALERTS_APP, "staffShiftReminder", {"rows": rows})
    except Exception as exc:  # noqa: BLE001
        log.warning("sms ears: the door could not be reached (%s) — the acknowledgements stay owed",
                    type(exc).__name__)
        return
    if (env or {}).get("status") != 200:
        log.warning("sms ears: the door refused (%s) — the acknowledgements stay owed",
                    str((env or {}).get("message") or env)[:160])
        return
    import shift_handoff  # noqa: PLC0415

    shift_handoff.note_dial(((env or {}).get("data") or {}).get("dial"),
                            ((env or {}).get("data") or {}).get("test_mode"))
    try:
        wrote = await ear_run(sms_ears.mark_said, SMS_EARS_DSN, [str(r["id"]) for r in rows],
                              (env or {}).get("data") or {})
    except Exception as exc:  # noqa: BLE001
        log.warning("sms ears: the ledger could not be written (%s)", type(exc).__name__)
        return
    log.info("sms ears: %s acknowledgement(s) offered, %s written down with the door's answer "
             "(told, recorded, held…)", len(rows), wrote)


def _quo_answer(status: int, **fields: Any) -> Response:
    return Response(content=json.dumps({"status": status, **fields}), status_code=status,
                    media_type="application/json")


def hotline_keys() -> list[str]:
    """The hotline webhook's signing keys: the file while it exists, else the env (the relay's own)."""
    try:
        st = QUO_HOTLINE_KEY_FILE.stat()
        stamp: tuple[int, int] | None = (int(st.st_mtime_ns), int(st.st_size))
    except OSError:
        stamp = None
    if stamp is None:
        words = os.getenv("QUO_HOTLINE_WEBHOOK_KEY", "").split()
        _HOTLINE_KEYS.update(stamp=None, keys=quo_inbox.usable_keys(words))
    elif stamp != _HOTLINE_KEYS["stamp"]:
        try:
            words = QUO_HOTLINE_KEY_FILE.read_text(encoding="utf-8").split()
        except (OSError, ValueError):
            words = []
        _HOTLINE_KEYS.update(stamp=stamp, keys=quo_inbox.usable_keys(words))
    keys = list(_HOTLINE_KEYS["keys"])
    said = tuple(hashlib.sha256(k.encode()).hexdigest()[:8] for k in keys)
    if said != _HOTLINE_KEYS["said"]:
        _HOTLINE_KEYS["said"] = said
        log.info("quo webhook: %s", f"hotline key fingerprint {','.join(said)} — the hotline's fast path is armed"
                 if keys else "no hotline key here — the hotline's fast path is off")
    return keys


def signature_ok(raw: bytes, header: str, keys: list[str]) -> bool:
    """`hmac;<version>;<timestamp>;<base64 mac>` over `<timestamp>.<body>`."""
    parts = str(header or "").split(";")
    if len(parts) < 4 or not keys:
        return False
    stamp, mac = parts[2], parts[3]
    # a field with bytes past ASCII is never a signature, and compare_digest would throw on it
    if not (stamp.isascii() and mac.isascii()):
        return False
    try:
        signed = stamp.encode() + b"." + bytes(raw)
    except Exception:  # noqa: BLE001
        return False
    for k in keys:
        try:
            made = hmac.new(base64.b64decode(k), signed, hashlib.sha256).digest()
            if hmac.compare_digest(base64.b64encode(made), mac.encode()):
                return True
        except Exception:  # noqa: BLE001
            continue
    return False


def stamp_age_s(header: str, now: float) -> float | None:
    """How old the signature's millisecond stamp is; None when it has none."""
    parts = str(header or "").split(";")
    try:
        return now - int(parts[2]) / 1000.0
    except (IndexError, ValueError):
        return None


async def messages_event(raw: bytes, header: str) -> Response:
    """An event the messages key signed: kept, answered, handed over later."""
    age = stamp_age_s(header, time.time())
    try:
        status, fields = await asyncio.to_thread(quo_inbox.accept_webhook, raw, age)
    except Exception as exc:  # noqa: BLE001 - nothing kept: Quo must deliver it again
        log.warning("quo inbox: an event could not be kept (%s) — answered 503 so Quo delivers it again",
                    type(exc).__name__)
        return _quo_answer(503, message="Not kept.")
    if status == 401:
        log.warning("quo inbox: refused a stale event (%s)", "no stamp" if age is None else f"stamped {age:.0f}s ago")
    elif fields.get("kept") == "added":
        told_kept()
    return _quo_answer(status, **fields)


async def quo_webhook(request: Request) -> Response:
    """POST /quo/webhook: a Quo event signed by a key held on disk. The messages key's events are kept in the inbox
    here; the hotline key's are filed on the hotline desk here (app/hotline_fast.py); one neither key verifies is
    refused in the relay's words."""
    raw = await request.body()
    header = request.headers.get("openphone-signature", "")
    hotline = hotline_keys()
    if hotline and signature_ok(raw, header, hotline):
        import hotline_fast  # noqa: PLC0415 - it builds on this module

        return await hotline_fast.event(raw, header)
    message = quo_inbox.webhook_keys()
    if message and signature_ok(raw, header, message):
        return await messages_event(raw, header)
    if not (hotline or message):
        return Response(content=json.dumps({"status": 503, "message": "The webhook keys are not readable."}),
                        status_code=503, media_type="application/json")
    log.warning("quo webhook: refused an event with %s signature", "no" if not header else "a bad")
    return Response(content=json.dumps({"status": 401, "message": "Unverified."}), status_code=401,
                    media_type="application/json")


# ---- the app's own -----------------------------------------------------------------------------------------------------

def health() -> dict[str, Any]:
    """What the clocks say of themselves: on or not, the failure counts, the inbox door and the pull."""
    import staff_feeds  # noqa: PLC0415

    return {"on": ON, "running": len(_TASKS), "failures": {**_SWEEP_FAILURES, **staff_feeds.health()["failures"]},
            "quo_inbox": {**quo_inbox.health(), "pull_armed": bool(quo_pull._key())}}  # noqa: SLF001


def start() -> list[asyncio.Task]:
    """Every clock started, on the app's own loop; none when HUB_APP_CLOCKS is off."""
    if not ON:
        log.warning("clocks: HUB_APP_CLOCKS is off — the app runs none of the relay's clocks")
        return []
    _SMS_EARS_LOOP[0] = asyncio.get_running_loop()
    loops = [spawn(fast_loop()), spawn(staff_loop()), spawn(sweep_loop()), spawn(house_meds_loop()),
             spawn(quo_handoff_loop()), spawn(quo_pull_loop()), spawn(sms_ears_loop())]
    log.info("clocks: the fast beat (%ss), the staff beats (%ss: the app's passes; the hotline's inbox and the "
             "feeds), the pharmacy reports' sweep, the Quo hand-off and pull, and the reply ear started%s",
             int(FAST_EVERY_S), int(STAFF_EVERY_S), " — their beats unkept" if CADENCE_OFF else "")
    return loops


async def stop() -> None:
    """Every clock and every pass it started, ended."""
    tasks = list(_TASKS)
    for task in tasks:
        task.cancel()
    for task in tasks:
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task


def install(app: Any, main: Any) -> None:
    """POST /quo/webhook on main.py's app, the Desk's Run on the front door, and main.py's doors for the clocks."""
    global M
    M = main
    app.post("/quo/webhook")(quo_webhook)
    FD.RUNGS["smartCommsRun"] = smart_comms_run
    # the reply ear is this process's: a wake for it is answered here, never told to the relay
    live_notify.LOCAL_WAKES["sms-ears"] = sms_ears_wake_soon
