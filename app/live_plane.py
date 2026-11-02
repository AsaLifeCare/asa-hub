"""The live data plane on asa-hub-app (it was the relay's): the live stream and /notify (live_events), the finish of
every answer the front door gives (live_finish), the app packs and their warm loop (app_packs), the slices and their
index (live_slices), the JSON lane — the bang, a place's bundle and the bundle loop (live_bundle) — and /health
(live_health). Its tables are the relay's own, read off its source (live_plane.json, tools/emit-live-plane.py).
Installed by main.py after the front door, before the relay carrier."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from pathlib import Path
from typing import Any, AsyncIterator

import app_packs
import front_door
import hotline_gate
import live_bundle
import live_events
import live_finish
import live_health
import live_notify
import live_slices

log = logging.getLogger("asa-hub-app.live-plane")

TABLES_PATH = Path(__file__).resolve().parent / "live_plane.json"
_TASKS: list[asyncio.Task] = []


def wire(main: Any, tables: dict[str, Any]) -> None:
    """Each part told the others, main.py's reader and stores, and the relay's tables."""
    live_slices.wire(tables)
    live_slices.FD = front_door
    live_slices.EVENTS = live_events
    live_slices.BUNDLE = live_bundle
    live_events.FD = front_door
    live_events.SLICES = live_slices
    live_events.GATE = hotline_gate
    live_bundle.M, live_bundle.FD, live_bundle.SLICES = main, front_door, live_slices
    live_health.SLICES, live_health.BUNDLE = live_slices, live_bundle
    live_finish.M, live_finish.FD, live_finish.EVENTS = main, front_door, live_events
    live_finish.SLICES, live_finish.GATE = live_slices, hotline_gate
    live_finish.PACKS, live_finish.NOTIFY = app_packs, live_notify
    live_finish.TABLES.update(tables)
    app_packs.wire(tables)
    hotline_gate.DB[0] = main.DB
    hotline_gate.OWN[0] = main._own
    hotline_gate.APP_CUT[:] = [lambda: live_slices.lane_list("my_work_apps")]
    hotline_gate.APP_SEEN[:] = [lambda: live_slices.lane_list("my_work_apps_seen")]
    front_door.FINISH = live_finish.finish
    front_door.CARRIED = live_finish.carried
    if live_events.sessions_forgotten not in front_door.SESSIONS_FORGOTTEN:
        front_door.SESSIONS_FORGOTTEN.append(live_events.sessions_forgotten)


async def start() -> None:
    live_events.start()
    live_bundle.adopt_disk()
    _TASKS.extend([asyncio.create_task(live_slices.loop()), asyncio.create_task(live_bundle.loop()),
                   asyncio.create_task(live_slices.config_lane_refresh(force=True)),
                   asyncio.create_task(app_packs.warm_loop())])


async def stop() -> None:
    for task in _TASKS:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
    _TASKS.clear()


def install(app: Any, main: Any) -> None:
    try:
        tables = json.loads(TABLES_PATH.read_text())
    except (OSError, ValueError) as exc:
        log.warning("live plane: its tables are unreadable at %s (%s) — nothing is routed by them",
                    TABLES_PATH, type(exc).__name__)
        tables = {}
    wire(main, tables)
    live_events.install(app)
    live_slices.install(app)
    live_bundle.install(app)
    live_health.install(app)
    live_finish.install(app)
    app_packs.install(app)
    inner = getattr(getattr(app, "router", None), "lifespan_context", None)
    if inner is None:
        return

    @contextlib.asynccontextmanager
    async def lifespan(a: Any) -> AsyncIterator[Any]:
        async with inner(a) as state:
            await start()
            try:
                yield state
            finally:
                await stop()

    app.router.lifespan_context = lifespan
