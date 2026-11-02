"""Settings › Routes, the master's: every HTTP route asa-hub-app answers (its own, read off app.routes) and every one
the relay answers through the carrier (app/relay_routes.json, tools/emit-relay-routes.py), each on or off. No route is
ever deleted: one turned off is refused before it is routed (503, route_disabled), so it is neither answered here nor
carried to the relay. The state is asa-hub-db's app.route_switches (db/route_switches.sql); a route with no row takes
its default. The calls the app makes to the relay itself never pass through here."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import Request
from fastapi.responses import Response

log = logging.getLogger("asa-hub-app.route-switches")

LANE = "/hub-lanes/route-switches"
EVENT = "route-switches"
TABLE = "app.route_switches"
RELAY_ROUTES = Path(os.getenv("HUB_RELAY_ROUTES") or Path(__file__).resolve().parent / "relay_routes.json")
EVERY_S = float(os.getenv("HUB_ROUTE_SWITCHES_EVERY_S", "15"))
CARRIER_PATH = "/{path:path}"
# no caller is left: kept, and off until the master turns them on
DEFAULT_OFF = frozenset({"POST /media-probe", "POST /shift/of", "POST /smart-comms/rpc"})
# never off, so the master always reaches this switch: the lane itself, the pulses, the slice gate nginx's
# /__snapshot_auth asks (GET /auth), and the front door the sign-in comes through
LOCKED = frozenset({f"GET {LANE}", f"POST {LANE}", "GET /health", "GET /healthz", "GET /auth", "POST /gas"})
LOCKED_PATHS = frozenset({"/__snapshot_auth", "/__snapshot_auth/auth"})
REFUSED = {"status": 503, "reason": "route_disabled", "message": "This route is turned off, so nothing was done."}
UNKEPT = {"status": 503, "reason": "unkept",
          "message": "The switch could not be saved just now, and nothing changed. Try again in a moment."}
LOCKED_SAID = {"status": 409, "reason": "locked",
               "message": "This route always stays on: the switches, the health checks, the slice gate and the "
                          "sign-in are never turned off."}
REFUSAL_LOG_S = 60.0

_APP: dict[str, Any] = {"app": None}
_RELAY: dict[str, Any] = {"rows": None, "table": None, "why": ""}
# the rows last read (key -> enabled, set_by, set_at), whether one read landed, why the last one did not
_HELD: dict[str, Any] = {"rows": {}, "read": False, "why": "", "read_at": "", "next": 0.0, "task": None}
# every route turned off: (method, path regex, key), matched before anything is routed; armed at the first request
_OFF: dict[str, Any] = {"keys": None, "match": ()}
_SAID: dict[str, float] = {}
_STORE: list[Any] = []


def key_of(method: str, path: str) -> str:
    return f"{method.upper()} {path}"


def locked(key: str) -> bool:
    return key in LOCKED or key.partition(" ")[2] in LOCKED_PATHS


def enabled_of(key: str, rows: dict[str, dict[str, Any]]) -> bool:
    if locked(key):
        return True
    row = rows.get(key)
    return bool(row["enabled"]) if row is not None else key not in DEFAULT_OFF


def _regex(path: str) -> re.Pattern[str]:
    from starlette.routing import compile_path  # noqa: PLC0415 - the routers' own templates

    return compile_path(path)[0]


# ---- the two inventories ---------------------------------------------------------------------------------------------

def relay_routes() -> list[dict[str, Any]]:
    """The relay's routes in its own order; none when the table cannot be read (said on the lane)."""
    if _RELAY["rows"] is None:
        try:
            rows = json.loads(RELAY_ROUTES.read_text(encoding="utf-8"))["routes"]
            _RELAY.update(rows=[r for r in rows if isinstance(r, dict) and r.get("method") and r.get("path")], why="")
        except Exception as exc:  # noqa: BLE001 - the app's own routes are still listed and switched
            _RELAY.update(rows=[], why=f"{RELAY_ROUTES.name} could not be read ({type(exc).__name__})")
            log.warning("route switches: %s", _RELAY["why"])
    return _RELAY["rows"]


def _relay_table() -> tuple[tuple[str, re.Pattern[str], str], ...]:
    if _RELAY["table"] is None:
        _RELAY["table"] = tuple((str(r["method"]).upper(), _regex(str(r["path"])), key_of(r["method"], r["path"]))
                                for r in relay_routes())
    return _RELAY["table"]


def _app_routes() -> list[Any]:
    app = _APP["app"]
    return list(app.router.routes) if app is not None else []


def _route_methods(route: Any) -> list[str]:
    methods = set(getattr(route, "methods", None) or ())
    if "GET" in methods:
        methods.discard("HEAD")
    return sorted(methods)


def app_routes() -> list[dict[str, Any]]:
    """The app's own routes, as registered, the carrier left out (the relay's routes stand for what it carries)."""
    out: list[dict[str, Any]] = []
    for route in _app_routes():
        path = getattr(route, "path", "")
        if not path or path == CARRIER_PATH:
            continue
        name = getattr(getattr(route, "endpoint", None), "__name__", "") or getattr(route, "name", "")
        module = str(getattr(getattr(route, "endpoint", None), "__module__", "") or "")
        out.extend({"method": m, "path": path, "handler": name, "module": module} for m in _route_methods(route))
    return out


def _segments(path: str) -> list[str]:
    return [p for p in path.split("/") if p]


def _areas(paths: list[str]) -> dict[str, str]:
    """A route's area: its first segment, or its first two where the first holds many routes and the two hold more
    than one."""
    def one(p: str) -> str:
        s = _segments(p)
        return "/" + s[0] if s and not s[0].startswith("{") else "/"

    def two(p: str) -> str:
        s = _segments(p)
        return f"/{s[0]}/{s[1]}" if len(s) > 1 and not s[0].startswith("{") and not s[1].startswith("{") else ""

    ones, twos = Counter(one(p) for p in paths), Counter(two(p) for p in paths)
    return {p: two(p) if two(p) and ones[one(p)] > 12 and twos[two(p)] > 1 else one(p) for p in paths}


def inventory() -> list[dict[str, Any]]:
    """Every route either side answers, and every switch kept for one neither answers any longer, with its state."""
    rows = _HELD["rows"]
    seen: dict[str, dict[str, Any]] = {}
    for r in app_routes():
        seen.setdefault(key_of(r["method"], r["path"]), {**r, "app": True, "relay": False})
    for r in relay_routes():
        key = key_of(r["method"], r["path"])
        if key in seen:
            seen[key]["relay"] = True
        else:
            seen[key] = {"method": str(r["method"]).upper(), "path": str(r["path"]),
                         "handler": str(r.get("handler") or ""), "module": str(r.get("module") or ""),
                         "app": False, "relay": True}
    for key in rows:
        if key not in seen:
            method, _, path = key.partition(" ")
            seen[key] = {"method": method, "path": path, "handler": "", "module": "", "app": False, "relay": False}
    areas = _areas(sorted({r["path"] for r in seen.values()}))
    out = []
    for key, r in seen.items():
        row = rows.get(key) or {}
        out.append({"key": key, "method": r["method"], "path": r["path"], "area": areas[r["path"]],
                    "answered_by": "both" if r["app"] and r["relay"] else "app" if r["app"]
                    else "relay" if r["relay"] else "none",
                    "handler": r["handler"], "module": r["module"],
                    "enabled": enabled_of(key, rows), "default_enabled": locked(key) or key not in DEFAULT_OFF,
                    "locked": locked(key), "set_by": str(row.get("set_by") or ""),
                    "set_at": str(row.get("set_at") or "")})
    out.sort(key=lambda r: (r["area"], r["path"], r["method"]))
    return out


# ---- the state -------------------------------------------------------------------------------------------------------

def _store() -> Any:
    """The writer role's shared connection (writes.Store), as the other lanes use it."""
    if not _STORE:
        import writes  # noqa: PLC0415
        _STORE.append(writes.Store(kind="lanes", label="the route switches"))
    return _STORE[0]


def _row(key: Any, enabled: Any, set_by: Any, set_at: Any) -> tuple[str, dict[str, Any]]:
    at = set_at.isoformat() if isinstance(set_at, datetime) else str(set_at or "")
    return str(key), {"enabled": bool(enabled), "set_by": str(set_by or ""), "set_at": at}


def read_rows() -> dict[str, dict[str, Any]]:
    """Blocking: every switch kept."""
    cur = _store().conn().execute(f"select route_key, enabled, set_by, set_at from {TABLE}")
    return dict(_row(*r) for r in cur.fetchall())


def write_row(key: str, enabled: bool, set_by: str) -> tuple[str, dict[str, Any]]:
    """Blocking: one switch set, as it now stands."""
    cur = _store().conn().execute(
        f"insert into {TABLE} (route_key, enabled, set_by, set_at) values (%s, %s, %s, now()) "
        "on conflict (route_key) do update set enabled = excluded.enabled, set_by = excluded.set_by, "
        "set_at = excluded.set_at returning route_key, enabled, set_by, set_at", (key, enabled, set_by))
    return _row(*cur.fetchone())


def _adopt(rows: dict[str, dict[str, Any]]) -> None:
    _HELD.update(rows=rows, read=True, read_at=datetime.now().astimezone().isoformat(timespec="seconds"))
    _arm(rows)


def _arm(rows: dict[str, dict[str, Any]]) -> None:
    """The rows as the gate matches them: every key off, its path's regex."""
    off = {k for k, r in rows.items() if not r["enabled"]} | {k for k in DEFAULT_OFF if k not in rows}
    off = frozenset(k for k in off if not locked(k) and " /" in k)
    if off != _OFF["keys"]:
        _OFF.update(keys=off, match=tuple((k.partition(" ")[0], _regex(k.partition(" ")[2]), k) for k in sorted(off)))
        log.info("route switches: %d off%s", len(off), (" — " + ", ".join(sorted(off))) if off else "")


def _unread(exc: BaseException) -> None:
    why = f"{TABLE} could not be read ({type(exc).__name__}); " + \
        ("the last switches read stand" if _HELD["read"] else "every route takes its default")
    if why != _HELD["why"]:
        log.warning("route switches: %s", why)
    _HELD["why"] = why


async def refresh() -> None:
    """The switches read again; a failed read leaves the last ones standing (before any, the defaults)."""
    from starlette.concurrency import run_in_threadpool  # noqa: PLC0415

    try:
        rows = await run_in_threadpool(read_rows)
    except Exception as exc:  # noqa: BLE001 - said on the lane
        _unread(exc)
        return
    _HELD["why"] = ""
    _adopt(rows)


async def _tick() -> None:
    try:
        await refresh()
    finally:
        _HELD["task"] = None


def _clock() -> None:
    """On the request path, never waiting: a read every EVERY_S, the first at the first request."""
    now = time.monotonic()
    if now < _HELD["next"] or _HELD["task"] is not None:
        return
    _HELD["next"] = now + EVERY_S
    try:
        _HELD["task"] = asyncio.get_running_loop().create_task(_tick())
    except RuntimeError:
        _HELD["task"] = None


# ---- the gate --------------------------------------------------------------------------------------------------------

def answering_key(scope: dict[str, Any]) -> str:
    """The route that would answer this request, as the routers match (first full match wins): one of the app's own,
    else, past them, the relay's the carrier hands it to; '' for neither."""
    from starlette.routing import Match, get_route_path  # noqa: PLC0415

    method = str(scope.get("method") or "GET").upper()
    as_get = "GET" if method == "HEAD" else method
    carried = False
    for route in _app_routes():
        path = getattr(route, "path", "")
        if path == CARRIER_PATH:
            carried = True
            break
        try:
            match, _child = route.matches(scope)
        except Exception:  # noqa: BLE001 - a route that cannot judge this scope does not answer it
            continue
        if match == Match.FULL:
            methods = getattr(route, "methods", None) or ()
            return key_of(as_get if method == "HEAD" and "GET" in methods else method, path)
    if not carried:
        return ""
    path = get_route_path(scope)
    return next((key for m, rx, key in _relay_table() if m == as_get and rx.match(path)), "")


def refused_key(scope: dict[str, Any]) -> str:
    """The key of the route turned off that would answer this request, else ''. Only a request whose method and path
    a switched-off route's template matches is resolved in full; every other one costs that one comparison."""
    if _OFF["keys"] is None:
        _arm(_HELD["rows"])
    match = _OFF["match"]
    if not match:
        return ""
    path = str(scope.get("path") or "")
    if path in LOCKED_PATHS:
        return ""
    method = str(scope.get("method") or "GET").upper()
    as_get = "GET" if method == "HEAD" else method
    if not any(m == as_get and rx.match(path) for m, rx, _k in match):
        return ""
    key = answering_key(scope)
    return key if key in (_OFF["keys"] or ()) and not locked(key) else ""


async def _refuse(send: Any, key: str) -> None:
    now = time.monotonic()
    if now - _SAID.get(key, -REFUSAL_LOG_S) >= REFUSAL_LOG_S:
        _SAID[key] = now
        log.info("route switches: %s refused — turned off", key)
    body = json.dumps({**REFUSED, "route": key}).encode("utf-8")
    await send({"type": "http.response.start", "status": 503,
                "headers": [(b"content-type", b"application/json"), (b"cache-control", b"no-store"),
                            (b"content-length", str(len(body)).encode("ascii"))]})
    await send({"type": "http.response.body", "body": body})


class Gate:
    """Before any route: a request a switched-off route would answer is refused, never handled nor carried."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") == "http":
            _clock()
            key = refused_key(scope)
            if key:
                await _refuse(send, key)
                return
        await self.app(scope, receive, send)


# ---- the master's lane -----------------------------------------------------------------------------------------------

async def _master_door(request: Any) -> tuple[Any, dict[str, Any] | None]:
    """As Settings › Back-end per app's door: the master's own session alone; everyone else is told the lane does not
    exist."""
    import lane_gate as LG  # noqa: PLC0415

    token = LG.token_of(request)
    if not token:
        return None, {"status": 401, "reason": "session", "message": "sign in first"}
    if LG.query(request, "member").strip():
        return None, {"status": 403, "reason": "visit", "message": "This setting is the signed-in account's own."}
    s = await LG.session(token)
    return s, (None if LG.is_master(s) else dict(LG.UNKNOWN_LANE))


def view() -> dict[str, Any]:
    routes = inventory()
    return {"routes": routes, "off": sum(1 for r in routes if not r["enabled"]),
            "locked": sorted(r["key"] for r in routes if r["locked"]), "store_why": _HELD["why"],
            "relay_why": _RELAY["why"], "read_at": _HELD["read_at"], "every_s": EVERY_S}


async def lane(request: Request) -> Response:
    """Settings › Routes: every route, who answers it, and whether it is on."""
    import lane_gate as LG  # noqa: PLC0415

    _s, refused = await _master_door(request)
    if refused is not None:
        return LG.answer(refused, no_store=True)
    await refresh()
    return LG.answer({"status": 200, "data": view()}, no_store=True)


async def lane_set(request: Request) -> Response:
    """{key, enabled}: one route on or off, kept, told to every open Settings."""
    import lane_gate as LG  # noqa: PLC0415
    import live_notify  # noqa: PLC0415
    from starlette.concurrency import run_in_threadpool  # noqa: PLC0415

    s, refused = await _master_door(request)
    if refused is not None:
        return LG.answer(refused, no_store=True)
    body = await LG.body_json(request)
    key = str(body.get("key") or "").strip() if isinstance(body, dict) else ""
    enabled = body.get("enabled") if isinstance(body, dict) else None
    if not isinstance(enabled, bool):
        return LG.answer({"status": 400, "reason": "enabled", "message": "enabled: true or false."}, no_store=True)
    if key not in {r["key"] for r in inventory()}:
        return LG.answer({"status": 400, "reason": "route", "message": "No route has that key."}, no_store=True)
    if locked(key):
        return LG.answer(dict(LOCKED_SAID), no_store=True)
    who = str(getattr(s, "uid", "") or "")
    try:
        got_key, got = await run_in_threadpool(write_row, key, enabled, who)
    except Exception as exc:  # noqa: BLE001 - nothing changed; said
        log.warning("route switches: %s not kept (%s)", key, type(exc).__name__)
        return LG.answer(dict(UNKEPT), no_store=True)
    _adopt({**_HELD["rows"], got_key: got})
    log.info("route switches: %s turned %s by %s", key, "on" if got["enabled"] else "off", who)
    live_notify.dirty([EVENT])
    return LG.answer({"status": 200, "data": view()}, no_store=True)


def install(app: Any) -> None:
    """The lane on main.py's app, and the gate in front of every route (before relay_carrier.install)."""
    _APP["app"] = app
    relay_routes()
    app.get(LANE)(lane)
    app.post(LANE)(lane_set)
    app.add_middleware(Gate)
