"""The gates the relay asks before one of its own doors reaches the world.
Smart Comms carries every message this platform sends."""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

import effective_roster

log = logging.getLogger("hub.lanegate")

# Every relay post that writes rows into a live workbook: the feeds on the relay's own clock, the call feed (its…
INGEST_ACTIONS = frozenset({
    "peopleSyncFromPlatform", "commRoutesIngest", "behaviorSignalsIngest",
    "psiPunchesIngest", "psiPunchesFullIngest", "commWhenIngest",
    "commProposalsIngest", "houseMedsIngest", "quoIngestBatch", "staffAttendancePunch",
    "commCallsIngest", "quoIngest", "lineDirectorySync",
})

INGEST = "gate_relay_ingest_lane"
DIGEST = "gate_digest_writes"
DRAIN = "gate_ledger_drain_replay"
MAIL_PROVISION = "gate_mail_provision"
MAIL_MARK = "gate_mail_mark_file"
CHAT_FRAME = "gate_chat_live_frame"

GATES = (INGEST, DIGEST, DRAIN, MAIL_PROVISION, MAIL_MARK, CHAT_FRAME)

# The doors that hand a person something that cannot be taken back: an unreadable lane holds them.
PERSON = frozenset({MAIL_PROVISION})

# Where the relay leaves the lane for a process of its own to read.
GATE_FILE = Path(os.getenv("HUB_LANE_GATE_FILE", "/srv/snapshot/lane-gates.json"))
# A file older than this is a relay that stopped publishing: unreadable, not "not armed".
GATE_FILE_MAX_AGE_S = float(os.getenv("HUB_LANE_GATE_FILE_MAX_AGE_S", "900"))
# The parts of the lane a gate needs, and nothing else.
_PUBLISHED_KEYS = ("place", "built_at", "test_mode", "smart_gates", "smart_gates_unreadable")
# A lane built longer ago than this is stale: the same variable and default web_gate.LANE_FRESH_S reads, so the…
LANE_FRESH_S = float(os.getenv("HUB_TEST_SWITCH_FRESH_S", "900"))
_NEW_YORK = ZoneInfo("America/New_York")

# The config lane, handed in by the process that reads it.
_LANE: dict[str, Any] = {"fn": None}
# Said once per gate: a sweep holds a thousand rows, not a thousand facts.
_SAID: set[str] = set()


def use_lane(fn: Callable[[], Any] | None) -> None:
    """Hand this module the config lane reader. Until it is, every gate reads as unreadable."""
    _LANE["fn"] = fn


def _read() -> dict[str, Any]:
    """{lane, unreadable}: the lane as a dict, or why there is none."""
    fn = _LANE.get("fn")
    if fn is None:
        return {"lane": None, "unreadable": "no configuration lane was handed to this process"}
    try:
        got = fn()
    except Exception as exc:  # noqa: BLE001 — said, never spent as "not armed"
        return {"lane": None, "unreadable": f"the configuration lane could not be read ({str(exc)[:120]})"}
    if not isinstance(got, dict):
        return {"lane": None, "unreadable": "the relay has not read the platform's configuration yet"}
    return {"lane": got, "unreadable": ""}


def _stale(lane: dict[str, Any], now: datetime | None = None) -> str:
    """Why the lane may not be read as current, or ''. A lane that says nothing of when it was built is stale."""
    raw = lane.get("built_at")
    try:
        built = raw if isinstance(raw, datetime) else datetime.fromisoformat(str(raw or "").replace("Z", "+00:00"))
    except ValueError:
        return "the configuration the relay holds says nothing of when it was read"
    if built.tzinfo is None:
        built = built.replace(tzinfo=_NEW_YORK)
    age = ((now or datetime.now(timezone.utc)) - built).total_seconds()
    if age > LANE_FRESH_S:
        return f"the configuration the relay holds is {int(age // 60)} minutes old"
    return ""


def state(gate_id: str) -> dict[str, Any]:
    """{armed, unreadable} for one gate — the three answers kept apart."""
    got = _read()
    if got["unreadable"]:
        return {"armed": False, "unreadable": got["unreadable"]}
    lane = got["lane"]
    stale = _stale(lane)
    if stale:
        return {"armed": False, "unreadable": stale}
    said = lane.get("smart_gates_unreadable")
    if said:
        return {"armed": False, "unreadable": f"Apps Script could not read the situations tab ({str(said)[:120]})"}
    gates = lane.get("smart_gates")
    if gates is None:
        return {"armed": False, "unreadable": ""}
    if not isinstance(gates, dict):
        return {"armed": False, "unreadable": "the gates came back in a shape nothing here reads"}
    return {"armed": gates.get(str(gate_id)) is True, "unreadable": ""}


# A company notice kind's situation (apps-script/NoticeSituations.gs): web_notice_<kind>.
NOTICE_PREFIX = "web_notice_"


def notice_state(kind: str) -> dict[str, Any]:
    """{armed, unreadable, why} for one company notice kind — its own Smart Comms situation."""
    sid = NOTICE_PREFIX + str(kind or "")
    got = _read()
    if got["unreadable"]:
        return {"armed": False, "unreadable": got["unreadable"], "why": got["unreadable"]}
    lane = got["lane"]
    stale = _stale(lane)
    if stale:
        return {"armed": False, "unreadable": stale, "why": stale}
    said = lane.get("notice_situations_unreadable")
    if said:
        why = f"Apps Script could not read the situations tab ({str(said)[:120]})"
        return {"armed": False, "unreadable": why, "why": why}
    switches = lane.get("notice_situations")
    if switches is None:
        return {"armed": False, "unreadable": "",
                "why": f"the engine carries no switch for {sid} yet, and a new message arrives off"}
    if not isinstance(switches, dict):
        why = "the notice switches came back in a shape nothing here reads"
        return {"armed": False, "unreadable": why, "why": why}
    if switches.get(sid) is True:
        return {"armed": True, "unreadable": "", "why": ""}
    return {"armed": False, "unreadable": "", "why": f"the situation {sid} is switched off in Smart Comms"}


def armed(gate_id: str) -> bool:
    """Is this gate switched on, on the Desk? An unreadable lane is not "armed" here — holds() decides."""
    return bool(state(gate_id)["armed"])


def holds(gate_id: str) -> dict[str, Any]:
    """{held, why, unreadable}: armed (or unreadable, for a door that reaches a person) AND the lane holding."""
    st = state(gate_id)
    person = str(gate_id) in PERSON
    if not st["armed"] and not (st["unreadable"] and person):
        return {"held": False, "why": "", "unreadable": bool(st["unreadable"])}
    switch = effective_roster.test_mode()
    if not switch.get("on"):
        return {"held": False, "why": "", "unreadable": bool(st["unreadable"])}
    if st["armed"]:
        why = (f"{gate_id} is armed and the send switch is on"
               if switch.get("readable")
               else f"{gate_id} is armed and the send switch could not be read "
                    f"({switch.get('why') or 'no reason given'}), which holds")
    else:
        why = (f"{gate_id} hands a person something that cannot be taken back, and whether it is armed "
               f"could not be read ({st['unreadable']}) while the send switch holds — held rather than done")
    if gate_id not in _SAID:
        _SAID.add(gate_id)
        log.info("lane gate: %s", why)
    return {"held": True, "why": why, "unreadable": not st["armed"]}


def action_gate(action: str) -> dict[str, Any]:
    """The gate an outbound action answers to, or no hold at all."""
    return holds(INGEST) if str(action) in INGEST_ACTIONS else {"held": False, "why": "", "unreadable": False}


def refused(why: str) -> dict[str, Any]:
    """The envelope a held door hands back."""
    return {"status": 409, "message": str(why), "held": True}


def publish(lane: Any, path: Path | None = None) -> bool:
    """Leave the gates' part of the lane where a process of its own can read it. Atomic; never raises."""
    if not isinstance(lane, dict):
        return False
    target = Path(path) if path is not None else GATE_FILE
    body = {"written_at": time.time(), "lane": {k: lane[k] for k in _PUBLISHED_KEYS if k in lane}}
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + ".tmp")
        tmp.write_text(json.dumps(body))
        os.replace(tmp, target)
        return True
    except Exception as exc:  # noqa: BLE001 — the worker then reads the file as stale, which holds what must hold
        log.warning("lane gate: the lane could not be published for the worker (%s)", type(exc).__name__)
        return False


def file_lane(path: Path | None = None, max_age_s: float | None = None) -> Callable[[], dict[str, Any]]:
    """A lane reader over the published file. Raises when the file is missing, unreadable or stale."""
    target = Path(path) if path is not None else GATE_FILE
    limit = GATE_FILE_MAX_AGE_S if max_age_s is None else float(max_age_s)

    def read() -> dict[str, Any]:
        raw = json.loads(target.read_text())
        written = float(raw.get("written_at") or 0)
        age = time.time() - written
        if not written or age > limit:
            raise RuntimeError(f"the published lane is {int(age // 60)} minutes old")
        lane = raw.get("lane")
        if not isinstance(lane, dict):
            raise RuntimeError("the published lane carries no lane")
        return lane

    return read


def said_reset() -> None:
    """Forget what has been said this process — for the suites, never for a door."""
    _SAID.clear()
