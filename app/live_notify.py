"""A write the app made to resources the slices and the live stream carry, said once and out of the door's way: a
slice it names is rebuilt on the debounced clock (and told to every open browser as its file is written); any other
name (a board's ring: "scheduling", "app:locations", "hotline:calls") is told to the open browsers at once. Every
area says it through `dirty`; the live plane (app/live_plane.py) is in this process.

What a lane's write or a clock raised beside its answer (`tell`, `told`): its wakes, the names it rang, the packs a
sweep made stale, a published or a held roster. Each is answered in this process, or by asa-hub-worker, and passes its
switch in Settings › Events (app/event_switches.py) first. The relay is told none of them; the ones only its memory
heard are retired with it."""
from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.request
from typing import Any, Callable, Iterable

log = logging.getLogger("asa-hub-app.live-notify")

TOKEN = os.getenv("HUB_APP_TOKEN", "")
WORKER_URL = (os.getenv("HUB_WORKER_URL") or "http://asa-hub-worker:8091").rstrip("/")
# a person's change reaches Drive's listing a little after it lands: the keeper is asked once it can see it
SHEET_SYNC_WAKE_S = float(os.getenv("HUB_SHEET_SYNC_WAKE_S", "62"))
# the wakes a clock answers (its owner registers each: app/attendance_loop.py, app/notice_clock.py, app/clocks.py)
LOCAL_WAKES: dict[str, Callable[[], None]] = {}
# a published roster and a held one, answered by their owner (app/sched_lanes.py)
LOCAL_SIGNALS: dict[str, Callable[[dict[str, Any]], Any]] = {}
_SAID: dict[str, float] = {}


def _names(raw: Iterable[Any]) -> list[str]:
    return sorted({str(x).strip() for x in raw if str(x or "").strip()})


def _on(kind: str, name: str = "") -> bool:
    """The signal's switch (app/event_switches.py); on when the switches cannot be asked."""
    try:
        import event_switches  # noqa: PLC0415

        return event_switches.allowed(event_switches.key_of(kind, name))
    except Exception:  # noqa: BLE001 - a switch unread never drops a signal
        return True


def _say_once(what: str) -> None:
    if time.time() - _SAID.get(what, 0.0) > 3600:
        _SAID[what] = time.time()
        log.info("live notify: %s", what)


def _woken_here(said: dict[str, Any]) -> dict[str, Any]:
    """`said` without its wakes, each run now where its switch lets it (thread-safe, never raises)."""
    if "wake" not in said:
        return said
    for name in _names(said.get("wake") or ()):
        if not _on("wake", name):
            continue
        fn = LOCAL_WAKES.get(name)
        if fn is None:
            _say_once(f"the {name} wake has no clock that answers it — dropped")
            continue
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - the clock's own beat catches up
            log.warning("live notify: the %s wake failed here (%s)", name, type(exc).__name__)
    return {k: v for k, v in said.items() if k != "wake"}


def _ring(names: Iterable[str]) -> None:
    """Bare names told to every open stream; never raises."""
    try:
        import live_events  # noqa: PLC0415 - the plane is main.py's; this door stays light to import

        for name in names:
            live_events.publish(name)
    except Exception:  # noqa: BLE001 - the next write says it again
        pass


def _rang(names: Iterable[str]) -> None:
    """The names a lane rang beside its write, through their switch."""
    names = _names(names)
    if names and _on("ring"):
        _ring(names)


def dirty(resources: Iterable[str]) -> list[str]:
    """These resources changed: their slices are rebuilt and the browsers told. Never raises, never waits."""
    names = _names(resources)
    if not names:
        return names
    try:
        import live_slices  # noqa: PLC0415

        rebuilt = set(live_slices.mark_dirty(names))
        _ring(name for name in names if name not in rebuilt)
    except Exception:  # noqa: BLE001 - the next write or the rebuild clock says it again
        pass
    return names


def _signal(name: str, body: dict[str, Any]) -> Any:
    fn = LOCAL_SIGNALS.get(name)
    if fn is None:
        _say_once(f"no lane answers {name} here — dropped")
        return None
    try:
        return fn(body)
    except Exception as exc:  # noqa: BLE001 - said; the write stands
        log.warning("live notify: %s failed here (%s)", name, type(exc).__name__)
        return None


def tell_now(**said: Any) -> dict[str, Any]:
    """What a lane's write moved, answered here now: its wakes, the names it rang, a published roster, a held roster's
    mockup row (`held_kept` says whether it was kept). The caches it named to forget were the relay's alone."""
    said = _woken_here(said)
    out: dict[str, Any] = {"status": 200}
    if isinstance(said.get("roster"), dict) and _on("roster", "published"):
        _signal("roster", said["roster"])
    held = said.get("held_roster")
    if isinstance(held, dict):
        out["held_kept"] = bool(_signal("held_roster", held)) if _on("roster", "held") else False
    _rang(said.get("events") or ())
    return out


def tell(resources: Iterable[str] = (), **said: Any) -> None:
    """dirty() for these resources, and tell_now() of the rest, out of the door's way."""
    dirty(resources)
    said = _woken_here(said)
    if said:
        threading.Thread(target=tell_now, kwargs=said, daemon=True, name="live-tell").start()


def lane(data: dict[str, Any]) -> None:
    """The config lane this process read: the relay's gates were its only other reader, retired with it."""
    return None


def told(rang: Iterable[str] = (), swept: Iterable[str] = (), wake: Iterable[str] = ()) -> dict[str, list[str]]:
    """What a finish or a clock raised: its wakes run, the names it rang told to every stream, the app packs a sweep
    made stale marked for the next read's judgement. Never raises, never waits."""
    _woken_here({"wake": list(wake)})
    body = {k: _names(v) for k, v in (("rang", rang), ("swept", swept))}
    body = {k: v for k, v in body.items() if v}
    if body.get("swept") and _on("swept"):
        now = time.time()
        try:
            import live_finish  # noqa: PLC0415

            live_finish.merge_marks({"swept": [[name, now] for name in body["swept"]]})
        except Exception:  # noqa: BLE001 - never in the caller's way
            pass
    _rang(body.get("rang") or ())
    return body


def _sheet_sync_now() -> None:
    try:
        req = urllib.request.Request(WORKER_URL + "/sheet-sync/wake", data=b"{}", method="POST",
                                     headers={"content-type": "application/json", "x-hub-token": TOKEN})
        with urllib.request.urlopen(req, timeout=5) as res:  # noqa: S310 - the worker, inside the network
            woken = bool((json.loads(res.read() or b"{}") or {}).get("woken"))
        if woken:
            log.info("live notify: the worker's sheet keeper woken — it reads what changed past Drive's margin")
    except Exception as exc:  # noqa: BLE001 - its own clock reads the change a little later
        _say_once(f"the worker's sheet keeper was not reached ({type(exc).__name__}) — its own clock")


def _sheet_sync_wake() -> None:
    timer = threading.Timer(SHEET_SYNC_WAKE_S, _sheet_sync_now)
    timer.daemon = True
    timer.start()


LOCAL_WAKES["sheet-sync"] = _sheet_sync_wake
