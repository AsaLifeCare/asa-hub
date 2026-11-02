"""Settings › Events, the master's: every signal a write or a clock raises beside its answer (app/live_notify.py), what
it does, who answers it, and whether it is on. The relay is told none of them any more. A signal whose only listener was
the relay's own memory is listed as retired with it, and is never switched back on. One turned off is dropped where it
is raised. The state is asa-hub-db's app.event_switches (db/event_switches.sql); a signal with no row is on."""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime
from typing import Any

try:
    from fastapi import Request
except ImportError:  # the signals' own test runs without the web stack
    Request = Any

log = logging.getLogger("asa-hub-app.event-switches")

LANE = "/hub-lanes/event-switches"
EVENT = "event-switches"
TABLE = "app.event_switches"
EVERY_S = float(os.getenv("HUB_EVENT_SWITCHES_EVERY_S", "15"))

# key → what the signal does now, and where it is answered; `retired`: the relay's own memory was its only listener
CATALOG: tuple[dict[str, str], ...] = (
    {"key": "wake:notices", "kind": "wake",
     "what": "The notices clock looks again now: a write moved a notice, a request or a shift.",
     "here": "asa-hub-app's notices clock (app/notice_clock.py)"},
    {"key": "wake:attendance", "kind": "wake",
     "what": "The PSI attendance loop reads the roster again now.",
     "here": "asa-hub-app's attendance loop (app/attendance_loop.py)"},
    {"key": "wake:calloff_road", "kind": "wake",
     "what": "The call-off road posts what a call-off moved, now.",
     "here": "asa-hub-app's attendance loop (app/attendance_loop.py)"},
    {"key": "wake:sms-ears", "kind": "wake",
     "what": "The reply ear hears the texts the inbox just kept.",
     "here": "asa-hub-app's reply ear (app/sms_ears.py, app/clocks.py)"},
    {"key": "wake:sheet-sync", "kind": "wake",
     "what": "The sheet keeper reads the books again a minute after a change Drive has to list first.",
     "here": "asa-hub-worker's sheet keeper (/sheet-sync/wake)"},
    {"key": "ring:*", "kind": "ring",
     "what": "The names a lane rang beside its write (housecal, smartcomms, support-desk, the boards a finish "
             "raised), told to every open screen at once.",
     "here": "asa-hub-app's live stream (app/live_events.py)"},
    {"key": "swept:*", "kind": "swept",
     "what": "The app packs a sweep made stale, marked for the next read's judgement.",
     "here": "asa-hub-app's pack marks (app/live_finish.py)"},
    {"key": "roster:published", "kind": "roster",
     "what": "A house calendar publish landed: the shift slices are rebuilt and the PSI loop looks again.",
     "here": "asa-hub-app's scheduling lanes (app/sched_lanes.py)"},
    {"key": "roster:held", "kind": "roster",
     "what": "Test mode's mockup row for the roster cells it held.",
     "here": "asa-hub-app's mock ledger (app/web_gate.py)"},
    {"key": "wake:access-written", "kind": "wake",
     "what": "App Control changed who reaches which app: the relay's kept copies were read again.",
     "retired": "the relay's kept copies; the app's own gate notes the change itself (app/live_finish.py)"},
    {"key": "forget:time_off", "kind": "forget",
     "what": "A time-off write: the relay's time-off cache was forgotten.",
     "retired": "the relay's time-off cache"},
    {"key": "forget:estate", "kind": "forget",
     "what": "A shift write: the relay's held estate was forgotten.",
     "retired": "the relay's held estate"},
    {"key": "lane:config", "kind": "lane",
     "what": "The config lane the app read, handed to the relay's gates.",
     "retired": "the relay's gates; asa-hub-app reads its own config lane"},
)
KEYS = frozenset(e["key"] for e in CATALOG)
RETIRED = frozenset(e["key"] for e in CATALOG if e.get("retired"))
UNKEPT = {"status": 503, "reason": "unkept",
          "message": "The switch could not be saved just now, and nothing changed. Try again in a moment."}
RETIRED_SAID = {"status": 409, "reason": "retired",
                "message": "This signal was the relay's alone; it is retired with the relay and stays off."}

# the rows last read (key -> enabled, set_by, set_at), whether one read landed, why the last one did not
_HELD: dict[str, Any] = {"rows": {}, "read": False, "why": "", "read_at": "", "next": 0.0, "busy": False}
_LOCK = threading.Lock()
_STORE: list[Any] = []
_SAID: dict[str, float] = {}


def key_of(kind: str, name: str = "") -> str:
    """A raised signal's catalog key: the named row when there is one, else its kind's."""
    named = f"{kind}:{name}"
    return named if named in KEYS else f"{kind}:*"


def _store() -> Any:
    """The writer role's shared connection (writes.Store), as the other lanes use it."""
    if not _STORE:
        import writes  # noqa: PLC0415
        _STORE.append(writes.Store(kind="lanes", label="the event switches"))
    return _STORE[0]


def _row(key: Any, enabled: Any, set_by: Any, set_at: Any) -> tuple[str, dict[str, Any]]:
    at = set_at.isoformat() if isinstance(set_at, datetime) else str(set_at or "")
    return str(key), {"enabled": bool(enabled), "set_by": str(set_by or ""), "set_at": at}


def read_rows() -> dict[str, dict[str, Any]]:
    """Blocking: every switch kept."""
    cur = _store().conn().execute(f"select event_key, enabled, set_by, set_at from {TABLE}")
    return dict(_row(*r) for r in cur.fetchall())


def write_row(key: str, enabled: bool, set_by: str) -> tuple[str, dict[str, Any]]:
    """Blocking: one switch set, as it now stands."""
    cur = _store().conn().execute(
        f"insert into {TABLE} (event_key, enabled, set_by, set_at) values (%s, %s, %s, now()) "
        "on conflict (event_key) do update set enabled = excluded.enabled, set_by = excluded.set_by, "
        "set_at = excluded.set_at returning event_key, enabled, set_by, set_at", (key, enabled, set_by))
    return _row(*cur.fetchone())


def _adopt(rows: dict[str, dict[str, Any]]) -> None:
    off = sorted(k for k, r in rows.items() if not r["enabled"] and k in KEYS and k not in RETIRED)
    if off != sorted(k for k, r in _HELD["rows"].items() if not r["enabled"] and k in KEYS and k not in RETIRED) \
            or not _HELD["read"]:
        log.info("event switches: %d off%s", len(off), (" — " + ", ".join(off)) if off else "")
    _HELD.update(rows=rows, read=True, read_at=datetime.now().astimezone().isoformat(timespec="seconds"))


def refresh() -> None:
    """Blocking: the switches read again; a failed read leaves the last ones standing (before any, every one on)."""
    try:
        rows = read_rows()
    except Exception as exc:  # noqa: BLE001 - said on the lane
        why = f"{TABLE} could not be read ({type(exc).__name__}); " + \
            ("the last switches read stand" if _HELD["read"] else "every signal stays on")
        if why != _HELD["why"]:
            log.warning("event switches: %s", why)
        _HELD["why"] = why
        return
    _HELD["why"] = ""
    _adopt(rows)


def _behind() -> None:
    try:
        refresh()
    finally:
        _HELD["busy"] = False


def _clock() -> None:
    """Never waiting: a read every EVERY_S behind whoever asked, the first at the first signal."""
    now = time.monotonic()
    with _LOCK:
        if now < _HELD["next"] or _HELD["busy"]:
            return
        _HELD.update(next=now + EVERY_S, busy=True)
    threading.Thread(target=_behind, daemon=True, name="event-switches").start()


def allowed(key: str) -> bool:
    """Whether a raised signal runs: never a retired one; else its switch (on with no row, or none read yet)."""
    if key in RETIRED:
        return False
    _clock()
    row = _HELD["rows"].get(key)
    on = True if row is None else bool(row["enabled"])
    if not on and time.time() - _SAID.get(key, 0.0) > 3600:
        _SAID[key] = time.time()
        log.info("event switches: %s is off — dropped where it was raised", key)
    return on


def inventory() -> list[dict[str, Any]]:
    rows = _HELD["rows"]
    out = []
    for e in CATALOG:
        row = rows.get(e["key"]) or {}
        retired = bool(e.get("retired"))
        out.append({"key": e["key"], "kind": e["kind"], "what": e["what"], "here": e.get("here", ""),
                    "retired": retired, "was": e.get("retired", ""),
                    "enabled": False if retired else bool(row.get("enabled", True)), "default_enabled": not retired,
                    "set_by": row.get("set_by", ""), "set_at": row.get("set_at", "")})
    return out


def view() -> dict[str, Any]:
    events = inventory()
    return {"events": events, "off": sum(1 for e in events if not e["enabled"] and not e["retired"]),
            "retired": sum(1 for e in events if e["retired"]), "relay": "told nothing",
            "store_why": _HELD["why"], "read_at": _HELD["read_at"], "every_s": EVERY_S}


# ---- the master's lane -----------------------------------------------------------------------------------------------

async def lane(request: Request) -> Any:
    """Settings › Events: every signal, who answers it, and whether it is on."""
    import lane_gate as LG  # noqa: PLC0415
    import route_switches  # noqa: PLC0415 - the master's door, one for both lists
    from starlette.concurrency import run_in_threadpool  # noqa: PLC0415

    _s, refused = await route_switches._master_door(request)  # noqa: SLF001
    if refused is not None:
        return LG.answer(refused, no_store=True)
    await run_in_threadpool(refresh)
    return LG.answer({"status": 200, "data": view()}, no_store=True)


async def lane_set(request: Request) -> Any:
    """{key, enabled}: one signal on or off, kept, told to every open Settings."""
    import lane_gate as LG  # noqa: PLC0415
    import live_notify  # noqa: PLC0415
    import route_switches  # noqa: PLC0415
    from starlette.concurrency import run_in_threadpool  # noqa: PLC0415

    s, refused = await route_switches._master_door(request)  # noqa: SLF001
    if refused is not None:
        return LG.answer(refused, no_store=True)
    body = await LG.body_json(request)
    key = str(body.get("key") or "").strip() if isinstance(body, dict) else ""
    enabled = body.get("enabled") if isinstance(body, dict) else None
    if not isinstance(enabled, bool):
        return LG.answer({"status": 400, "reason": "enabled", "message": "enabled: true or false."}, no_store=True)
    if key not in KEYS:
        return LG.answer({"status": 400, "reason": "event", "message": "No signal has that key."}, no_store=True)
    if key in RETIRED:
        return LG.answer(dict(RETIRED_SAID), no_store=True)
    who = str(getattr(s, "uid", "") or "")
    try:
        got_key, got = await run_in_threadpool(write_row, key, enabled, who)
    except Exception as exc:  # noqa: BLE001 - nothing changed; said
        log.warning("event switches: %s not kept (%s)", key, type(exc).__name__)
        return LG.answer(dict(UNKEPT), no_store=True)
    _adopt({**_HELD["rows"], got_key: got})
    log.info("event switches: %s turned %s by %s", key, "on" if got["enabled"] else "off", who)
    live_notify.dirty([EVENT])
    return LG.answer({"status": 200, "data": view()}, no_store=True)


def install(app: Any) -> None:
    """The lane on main.py's app, before relay_carrier.install."""
    app.get(LANE)(lane)
    app.post(LANE)(lane_set)
