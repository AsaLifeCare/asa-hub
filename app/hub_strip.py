"""The strip at the top of every tab (lib/hubStatus), the relay's (_hub_frame, _hub_fan, _hub_phase, _hub_web_loop):
one hub frame, {kind: hub, phase, web}, to every chat stream that draws it (app/chat_doors.py), at once when it changes
and with every keep-alive. The phase is the live plane's (live_slices.PHASE: warming until the first full pass decided
what to read); `web` names the bundle the served index.html loads (HUB_WEB_INDEX: web/html
mounted read-only at /srv/web), looked at once a second on our own disk, so a new SPA build is told to every tab."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, AsyncIterator

import chat_doors
import live_slices

log = logging.getLogger("asa-hub-app.hub-strip")

WEB_INDEX = Path(os.getenv("HUB_WEB_INDEX", "/srv/web/index.html"))
WEB_EVERY_S = 1.0
BUNDLE_RE = re.compile(r"index-[A-Za-z0-9_-]+\.js")

_WEB: dict[str, Any] = {"mtime": 0.0, "bundle": ""}
_LOOP: list[Any] = [None]
_TASKS: list[asyncio.Task] = []


def frame() -> str:
    said: dict[str, Any] = {"kind": "hub", "phase": live_slices.PHASE["phase"]}
    if _WEB["bundle"]:
        said["web"] = _WEB["bundle"]
    return json.dumps(said)


def fan() -> None:
    """The current frame kept for every stream that opens, and handed once to each open one that draws the strip.
    On the loop."""
    text = frame()
    chat_doors._HUB["frame"] = text  # noqa: SLF001
    chat_doors._HUB["phase"] = str(live_slices.PHASE["phase"] or "")[:40]  # noqa: SLF001
    for subs in list(chat_doors._subs.values()):  # noqa: SLF001
        for q in list(subs):
            if not q.strip or q.hub_sent == text:
                continue
            q.hub_sent = text
            try:
                q.put_nowait(text)
            except asyncio.QueueFull:
                pass


def told(_phase: str = "") -> None:
    """The phase changed; any thread."""
    loop = _LOOP[0]
    if loop is None:
        return
    try:
        loop.call_soon_threadsafe(fan)
    except RuntimeError:
        pass


def web_tick() -> bool:
    """The served index.html named another bundle: whether the frame changed."""
    try:
        mtime = WEB_INDEX.stat().st_mtime
        if mtime == _WEB["mtime"]:
            return False
        _WEB["mtime"] = mtime
        found = BUNDLE_RE.search(WEB_INDEX.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return False
    bundle = found.group(0) if found else ""
    before, _WEB["bundle"] = _WEB["bundle"], bundle or _WEB["bundle"]
    if bundle and before and bundle != before:
        log.info("web build changed (%s → %s)", before, bundle)
    return _WEB["bundle"] != before


async def web_loop() -> None:
    """The web look on its own clock: one stat of our own disk a second, no network."""
    while True:
        await asyncio.sleep(WEB_EVERY_S)
        try:
            if web_tick():
                fan()
        except Exception as exc:  # noqa: BLE001 - the look must not die
            log.warning("web look: %s", exc)


def start() -> None:
    _LOOP[0] = asyncio.get_running_loop()
    if not WEB_INDEX.is_file():
        log.warning("web look: %s is not there — no tab is told of a new SPA build", WEB_INDEX)
    web_tick()
    fan()
    _TASKS.append(asyncio.get_running_loop().create_task(web_loop()))


async def stop() -> None:
    for task in _TASKS:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
    _TASKS.clear()
    _LOOP[0] = None


def install(app: Any) -> None:
    """The phase's listener and the web look in the app's lifespan."""
    if told not in live_slices.ON_PHASE:
        live_slices.ON_PHASE.append(told)
    inner = getattr(getattr(app, "router", None), "lifespan_context", None)
    if inner is None:
        return

    @contextlib.asynccontextmanager
    async def lifespan(a: Any) -> AsyncIterator[Any]:
        async with inner(a) as state:
            start()
            try:
                yield state
            finally:
                await stop()

    app.router.lifespan_context = lifespan
