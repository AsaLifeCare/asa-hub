"""The slices: the relay's debounced rebuild of /srv/snapshot/<resource>.json, which nginx serves behind the front
door's gate, and its index; the traffic slice; the strip's phase (warming until the first full pass decided what to
read). A write names its resources (mark_dirty, the /notify door, live_notify.dirty); they are rebuilt once the burst
is over, and every resource is rebuilt on the floor clock. Each file has one writer, this module: the slices a sheet
tab or a Python door fills (APP_FINISHED lays the rest on a door's rows), the lane-module slices (APP_BUILT) and the
analyses built from other slices (APP_LATE) are all built here, in-process. A slice or analysis the tables still name
the relay's (relay_built, a late key not in APP_LATE) is asked of the relay's /slices/derived; none is left."""
from __future__ import annotations

import asyncio
import concurrent.futures
import hmac
import importlib
import json
import logging
import os
import re
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

from fastapi import Request
from fastapi.responses import JSONResponse

log = logging.getLogger("asa-hub-app.live-slices")

OUT_DIR = Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"))
MANIFEST_PATH = Path(os.getenv("HUB_SNAPSHOT_MANIFEST", "/srv/manifests/snapshot-manifest.json"))
DEBOUNCE_SECONDS = float(os.getenv("HUB_SNAPSHOT_DEBOUNCE", "6"))
HEARTBEAT_SECONDS = float(os.getenv("HUB_SNAPSHOT_HEARTBEAT", "300"))
CATCHUP_BATCH = int(os.getenv("HUB_SNAPSHOT_CATCHUP_BATCH", "12"))
BUILD_TIMEOUT_S = float(os.getenv("HUB_SNAPSHOT_BUILD_TIMEOUT_S", "420"))
HOPELESS_TTL_S = float(os.getenv("HUB_SNAPSHOT_HOPELESS_TTL_S", "1800"))
SHEET_TABS_APP = "sheet-tabs"
SERVICE = {"is_service": True}
TRAFFIC_RESOURCE = "resolverHealth"
CONFIG_LANE_APP = "config-lane"
CONFIG_LANE_TTL_S = 180.0
CONFIG_LANE_RETRY_S = 15.0

# set by live_plane: the front door (in-process doors), the bus, the bundle lane, the plane's tables (live_plane.json)
FD: Any = None
EVENTS: Any = None
BUNDLE: Any = None
TABLES: dict[str, Any] = {}
TOKEN: list[str] = [os.getenv("HUB_APP_TOKEN", "")]

# resource -> (app, door): the shaped resources Python's doors fill (the relay's BACKEND_SLICE_DOORS)
SLICE_DOORS: dict[str, tuple[str, str]] = {}
# resource -> its relay builder: the slices this module asks of the relay (RELAY_BUILT); their late analyses and the
# slices each reads (LATE)
RELAY_BUILT: frozenset[str] = frozenset()
LATE: dict[str, dict[str, list[str]]] = {}
# resource -> the module here that shapes it (APP_BUILT), run on one thread of its own with the lanes' connections
APP_BUILT: dict[str, str] = {}
# resource -> the module here whose finish(resource, rows) lays the rest on what its Python door filled (APP_FINISHED)
APP_FINISHED: dict[str, str] = {}
# late analysis key -> the module here that builds every one of its resources (APP_LATE: hiring, medcorr, coverage)
APP_LATE: dict[str, str] = {}
APP_DSN = "asa-hub-db"
_APP_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="live-slices")

_dirty: set[str] = set()
_dirty_at = [0.0]
_hopeless: dict[str, float] = {}
HELD_LIVE: dict[str, Any] = {"by_design": 0, "unrouted": [], "unmarked": 0}
_HELD_SAID = {"key": ""}
PHASE: dict[str, Any] = {"phase": "warming", "since": time.time()}
# a change of phase told to whoever draws the strip (the chat stream's hub frame)
ON_PHASE: list[Callable[[str], None]] = []
TRAFFIC: dict[str, Any] = {"since": time.time(), "slice_reads": 0, "exec_read": 0, "exec_write": 0, "exec_tool": 0,
                           "exec_auth": 0, "exec_undeclared": 0, "exec_service": 0}
BY_ACTION: dict[str, int] = {}
CONFIG_LANE: dict[str, Any] = {"at": 0.0, "data": None}


def wire(tables: dict[str, Any]) -> None:
    """The relay's own tables for this plane, read off its source (tools/emit-live-plane.py)."""
    global SLICE_DOORS, RELAY_BUILT, LATE, APP_BUILT, APP_FINISHED, APP_LATE
    TABLES.update(tables)
    SLICE_DOORS = {k: (str(v[0]), str(v[1])) for k, v in (tables.get("slice_doors") or {}).items()}
    RELAY_BUILT = frozenset(tables.get("relay_built") or ())
    APP_BUILT = {str(k): str(v) for k, v in (tables.get("app_built") or {}).items()}
    APP_FINISHED = {str(k): str(v) for k, v in (tables.get("app_finished") or {}).items()}
    APP_LATE = {str(k): str(v) for k, v in (tables.get("app_late") or {}).items()}
    LATE = {str(k): {"resources": list(v.get("resources") or []), "sources": list(v.get("sources") or [])}
            for k, v in (tables.get("late") or {}).items()}


def traffic_note(key: str) -> None:
    try:
        TRAFFIC[key] = TRAFFIC.get(key, 0) + 1
    except Exception:  # noqa: BLE001 - a counter must never be the outage
        pass


def action_note(label: str) -> None:
    if label:
        BY_ACTION[label] = BY_ACTION.get(label, 0) + 1


def traffic_snapshot() -> dict[str, Any]:
    execs = sum(v for k, v in TRAFFIC.items() if k.startswith("exec_") and isinstance(v, int) and k != "exec_service")
    service = int(TRAFFIC.get("exec_service", 0))
    slices = int(TRAFFIC.get("slice_reads", 0))
    total = execs + slices
    return {
        "window_s": round(time.time() - float(TRAFFIC["since"])),
        "slice_reads": slices,
        "exec_reads": int(TRAFFIC.get("exec_read", 0)),
        "exec_writes": int(TRAFFIC.get("exec_write", 0)),
        "exec_tools": int(TRAFFIC.get("exec_tool", 0)),
        "exec_undeclared": int(TRAFFIC.get("exec_undeclared", 0)),
        "exec_service": service,
        "chat_beats": int(TRAFFIC.get("chat_beats", 0)),
        "by_action": dict(sorted(BY_ACTION.items(), key=lambda kv: -kv[1])[:20]),
        "exec_share": round(execs / total, 3) if total else None,
        "exec_share_covers": "browser traffic only — the platform's own clocks are counted in neither term",
    }


def mark_hopeless(name: str) -> None:
    _hopeless[name] = time.monotonic()


def is_hopeless(name: str) -> bool:
    at = _hopeless.get(name)
    if at is None:
        return False
    if time.monotonic() - at < HOPELESS_TTL_S:
        return True
    _hopeless.pop(name, None)
    return False


def hopeless() -> list[str]:
    return sorted(_hopeless)


def _note_held_live(live: list[dict[str, Any]]) -> None:
    unrouted = sorted(str(e.get("resource") or "") for e in live if e.get("held") == "unrouted")
    by_design = sum(1 for e in live if e.get("held") == "by-design")
    unmarked = len(live) - by_design - len(unrouted)
    HELD_LIVE.update({"by_design": by_design, "unrouted": unrouted, "unmarked": unmarked})
    key = f"{by_design}|{unmarked}|{','.join(unrouted)}"
    if key == _HELD_SAID["key"]:
        return
    _HELD_SAID["key"] = key
    log.info("manifest: %d resource(s) held on the live path and never asked of the backend — "
             "%d by design, %d because nothing routes them yet (%s)%s",
             len(live), by_design, len(unrouted), ", ".join(unrouted) or "none",
             f", {unmarked} unmarked (this manifest predates the mark)" if unmarked else "")


def load_manifest() -> list[dict[str, Any]]:
    """The slice list, as derived from the registry; the ones held on the live path left out."""
    try:
        entries = json.loads(MANIFEST_PATH.read_text())["resources"]
    except Exception as exc:  # noqa: BLE001 - reported, never fatal
        log.warning("snapshot manifest unreadable at %s: %s", MANIFEST_PATH, exc)
        return []
    live = [e for e in entries if e.get("mode") == "live"]
    _note_held_live(live)
    return [e for e in entries if e.get("mode") != "live"]


def write_atomic(path: Path, payload: dict) -> None:
    """Rename, never overwrite — a reader sees one whole version or the other; a slice written is told to the bus."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(payload, fh, separators=(",", ":"), default=str)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
        try:
            if path.parent == OUT_DIR:
                EVENTS.publish(path.stem)
        except Exception:  # noqa: BLE001 - telling nobody must never fail a build
            pass
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def mark_dirty(names: Any) -> list[str]:
    """Queue these manifest resources for the debounced rebuild; the names the manifest knows come back sorted."""
    known = {e["resource"] for e in load_manifest()} | set(TABLES.get("medcorr_sources") or ())
    accepted = {n for n in names if n in known}
    if accepted:
        _dirty.update(accepted)
        if not _dirty_at[0] or time.time() - _dirty_at[0] >= DEBOUNCE_SECONDS:
            _dirty_at[0] = time.time()
    return sorted(accepted)


def set_phase(phase: str) -> None:
    if PHASE["phase"] == phase:
        if phase == "engine":
            PHASE["since"] = time.time()
        return
    PHASE.update(phase=phase, since=time.time())
    log.info("hub phase: %s", phase)
    for told in list(ON_PHASE):
        try:
            told(phase)
        except Exception:  # noqa: BLE001 - the strip reads the phase on the next answer
            pass


def full_pass_done(decided: float) -> None:
    """A full pass ended (finished, failed or abandoned): one that decided what to read after the phase began ends it."""
    if PHASE["phase"] != "ready" and decided >= PHASE["since"]:
        set_phase("ready")


def stamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


async def tabs_from_python(tabs: list[str]) -> tuple[dict[str, list[dict]], str | None, dict[str, str]]:
    """Rows for several tabs off asa-hub-db (app/sheet_tabs.py): the rows, when every book read held what Google
    held, and each tab the copy could not answer with why."""
    out: dict[str, list[dict]] = {}
    unread: dict[str, str] = {}
    read_at: str | None = None
    for i in range(0, len(tabs), CATCHUP_BATCH):
        batch = tabs[i:i + CATCHUP_BATCH]
        got = await FD.call_app(SHEET_TABS_APP, "sheetTabs", dict(SERVICE), {"tabs": batch})
        env = got[2] if got is not None else None
        if env is None or env.get("status") != 200:
            why = "Python did not answer" if env is None else f"sheetTabs answered {env.get('status')}"
            unread.update({t: why for t in batch})
            continue
        data = env.get("data") or {}
        out.update(data.get("tabs") or {})
        unread.update(data.get("unread") or {})
        at = data.get("read_at")
        read_at = at if read_at is None or (at and at < read_at) else read_at
    return out, read_at, unread


async def rows_from_python(resources: list[str]) -> dict[str, list[dict]]:
    """Shaped resources filled by their Python door for the service's own identity; one Python does not answer is
    left out, and its slice keeps the last file it had."""
    out: dict[str, list[dict]] = {}
    for name in resources:
        app_id, door = SLICE_DOORS[name]
        got = await FD.call_app(app_id, door, dict(SERVICE), {})
        env = got[2] if got is not None else None
        if env is None or env.get("status") != 200 or not isinstance(env.get("data"), list):
            log.warning("python slice %s not filled: %s", name,
                        "Python did not answer" if env is None else f"{door} answered {env.get('status')}")
            continue
        out[name] = env["data"]
        if name in APP_FINISHED:
            out[name] = await asyncio.get_running_loop().run_in_executor(
                _APP_POOL, _module_finish, APP_FINISHED[name], name, out[name])
    return out


def _module_finish(module: str, resource: str, rows: list[dict]) -> list[dict]:
    import lanes_pg  # noqa: PLC0415 - the lanes' connections, released after each finish

    try:
        return importlib.import_module(module).finish(resource, rows)
    finally:
        lanes_pg.finish()


def _record(entry: dict[str, Any], built_at: str, rows: int, **more: Any) -> dict[str, Any]:
    return {"resource": entry["resource"], "shelf": entry.get("shelf", "private"), "built_at": built_at, **more,
            "rows": rows, "roles": entry.get("roles") or []}


async def build_one(entry: dict[str, Any], catchup: dict[str, Any] | None = None,
                    shaped: dict[str, list[dict]] | None = None, carried: set[str] | None = None) -> dict[str, Any]:
    """One slice built here (build_one's branches that need no relay module), its index record back."""
    resource = entry["resource"]
    built_at = stamp()
    try:
        if carried and resource in carried:
            path = OUT_DIR / f"{resource}.json"
            try:
                held = json.loads(path.read_text())
                rows = held.get("rows") or []
                write_atomic(path, {"resource": resource, "built_at": built_at, "source_at": built_at, "rows": rows})
                return {"resource": resource, "shelf": entry.get("shelf", "private"), "built_at": built_at,
                        "source_at": built_at, "rows": len(rows), "roles": entry.get("roles") or []}
            except Exception as exc:  # noqa: BLE001 - no file, no carry
                log.warning("carry-forward of %s failed, reading it: %s", resource, exc)
        if shaped is not None and resource in shaped:
            rows, source_at = shaped[resource], None
            write_atomic(OUT_DIR / f"{resource}.json",
                         {"resource": resource, "built_at": built_at, "source_at": source_at, "rows": rows})
            return {"resource": resource, "shelf": entry.get("shelf", "private"), "built_at": built_at,
                    "source_at": source_at, "rows": len(rows), "roles": entry.get("roles") or []}
        if entry.get("mode") == "sheet" and entry.get("sheet"):
            tab = entry["sheet"]
            from_bundle = BUNDLE.bundle_rows(resource) if BUNDLE is not None else None
            if from_bundle is not None:
                rows, source_at = from_bundle
                source_at = source_at or built_at
                write_atomic(OUT_DIR / f"{resource}.json",
                             {"resource": resource, "built_at": built_at, "source_at": source_at, "rows": rows})
                return {"resource": resource, "shelf": entry.get("shelf", "private"), "built_at": built_at,
                        "source_at": source_at, "rows": len(rows), "roles": entry.get("roles") or []}
            fresh = (catchup or {}).get("tabs", {}).get(tab)
            if fresh is None:
                raise RuntimeError("Python did not read " + tab + ": " +
                                   str(((catchup or {}).get("python") or {}).get(tab) or "not answered"))
            rows, source_at = fresh, (catchup or {}).get("read_at") or built_at
        else:
            raise RuntimeError("no Python door filled it and no file of it is kept")
        write_atomic(OUT_DIR / f"{resource}.json",
                     {"resource": resource, "built_at": built_at, "source_at": source_at, "rows": rows})
        return {"resource": resource, "shelf": entry.get("shelf", "private"), "built_at": built_at,
                "source_at": source_at, "rows": len(rows), "roles": entry.get("roles") or []}
    except Exception as exc:  # noqa: BLE001
        log.warning("snapshot %s failed: %s", resource, exc)
        return {"resource": resource, "shelf": entry.get("shelf", "private"), "built_at": built_at, "rows": 0,
                "error": str(exc)[:200], "roles": entry.get("roles") or []}


def _module_build(module: str, resource: str) -> tuple[list[dict], str | None]:
    import lanes_pg  # noqa: PLC0415 - the lanes' connections, released after each build

    try:
        return importlib.import_module(module).build(resource, APP_DSN)
    finally:
        lanes_pg.finish()


async def app_built(entries: list[dict[str, Any]], fresh: bool) -> list[dict[str, Any]]:
    """The lane-module slices shaped here, one at a time on their own thread (a module's resources share one read);
    `fresh`: a write named them, so a module's held read is dropped first. A failed one keeps its file."""
    if not entries:
        return []
    loop = asyncio.get_running_loop()
    if fresh:
        for module in sorted({APP_BUILT[e["resource"]] for e in entries}):
            forget = getattr(importlib.import_module(module), "forget", None)
            if callable(forget):
                forget()
    out: list[dict[str, Any]] = []
    for entry in entries:
        resource = entry["resource"]
        built_at = stamp()
        try:
            rows, source_at = await loop.run_in_executor(_APP_POOL, _module_build, APP_BUILT[resource], resource)
            source_at = source_at or built_at
            await asyncio.to_thread(write_atomic, OUT_DIR / f"{resource}.json",
                                    {"resource": resource, "built_at": built_at, "source_at": source_at,
                                     "rows": rows})
            out.append(_record(entry, built_at, len(rows), source_at=source_at))
        except Exception as exc:  # noqa: BLE001 - one slice, not the pass
            log.warning("snapshot %s failed: %s", resource, exc)
            out.append(_record(entry, built_at, 0, error=str(exc)[:200]))
    return out


async def medcorr_hand_in() -> None:
    """The study's held-live sources (medcorr_slices.HELD_SOURCES), read like a sheet slice and handed over in memory:
    the bundle first, then asa-hub-db's tab; a source with no rows keeps the study's last file."""
    import medcorr_slices  # noqa: PLC0415

    got: dict[str, tuple[list[dict], str]] = {}
    for resource in medcorr_slices.HELD_SOURCES:
        held = BUNDLE.bundle_rows(resource) if BUNDLE is not None else None
        if held and held[0]:
            got[resource] = (held[0], held[1] or "")
    wanted = {tab: resource for resource, tab in medcorr_slices.HELD_SOURCES.items() if resource not in got}
    if wanted:
        try:
            fetched, at, _unread = await tabs_from_python(list(wanted))
            for tab, resource in wanted.items():
                if fetched.get(tab):
                    got[resource] = (fetched[tab], at or "")
        except Exception as exc:  # noqa: BLE001 - the study reports it and keeps its last file
            log.warning("medCorrelation: %s could not be read: %s", ", ".join(wanted), exc)
    now = stamp()
    for resource, tab in medcorr_slices.HELD_SOURCES.items():
        rows, read_at = got.get(resource, (None, ""))
        if rows is None:
            log.warning("medCorrelation: no rows for %s this cycle — the study keeps its last file", tab)
        medcorr_slices.hand_in(resource, rows, read_at or now)


async def app_late(keys: list[str]) -> list[dict[str, Any]]:
    """The analyses built from other slices, after this pass wrote what they read: every resource of each key's
    module, built here; one that fails keeps its file."""
    if not keys:
        return []
    loop = asyncio.get_running_loop()
    manifest = {e["resource"]: e for e in load_manifest()}
    out: list[dict[str, Any]] = []
    for key in keys:
        module = APP_LATE[key]
        if key == "medcorr":
            await medcorr_hand_in()
        for resource in importlib.import_module(module).RESOURCES:
            entry = manifest.get(resource) or {"resource": resource}
            built_at = stamp()
            try:
                rows, source_at = await loop.run_in_executor(_APP_POOL, _module_build, module, resource)
                source_at = source_at or built_at
                await asyncio.to_thread(write_atomic, OUT_DIR / f"{resource}.json",
                                        {"resource": resource, "built_at": built_at, "source_at": source_at,
                                         "rows": rows})
                out.append(_record(entry, built_at, len(rows), source_at=source_at))
            except Exception as exc:  # noqa: BLE001 - one derivation, not the pass
                log.warning("derived slice %s failed: %s", resource, exc)
                out.append(_record(entry, built_at, 0, error=str(exc)[:200]))
    return out


async def relay_built(entries: list[dict[str, Any]], late: list[str]) -> list[dict[str, Any]]:
    """The slices no builder here shapes (RELAY_BUILT, a late analysis outside APP_LATE): the relay that once built
    them is retired, so their files stay as they were and each record says so."""
    names = [e["resource"] for e in entries]
    if not names and not late:
        return []
    why = "no builder here shapes it (the relay that built it is retired)"
    log.warning("snapshot: %d slice(s) not rebuilt — %s", len(names) + len(late), why)
    manifest = {e["resource"]: e for e in load_manifest()}
    owed = names + [r for k in late for r in (LATE.get(k) or {}).get("resources", [])]
    return [_record(manifest.get(r) or {"resource": r}, stamp(), 0, error=why[:200]) for r in owed]


async def build_all(only: set[str] | None = None) -> dict[str, Any]:
    entries = [e for e in load_manifest() if not only or e["resource"] in only]
    entries = [e for e in entries if e["resource"] != TRAFFIC_RESOURCE]
    touched = {e["resource"] for e in entries}
    late_names = {r for v in LATE.values() for r in v["resources"]}
    late: list[str] = []
    for key, spec in LATE.items():
        sources = set(spec["sources"])
        if only is None or bool(only & set(spec["resources"])) or bool(
                (only if key == "medcorr" else touched) & sources):
            late.append(key)
    entries = [e for e in entries if e["resource"] not in late_names]
    relay_entries = [e for e in entries if e["resource"] in RELAY_BUILT]
    module_entries = [e for e in entries if e["resource"] in APP_BUILT]
    entries = [e for e in entries if e["resource"] not in RELAY_BUILT and e["resource"] not in APP_BUILT]
    from_python = [e["resource"] for e in entries if e["resource"] in SLICE_DOORS and not is_hopeless(e["resource"])]
    sheet_entries = [e for e in entries if e.get("mode") == "sheet" and e.get("sheet")
                     and e["resource"] not in from_python]
    catchup: dict[str, Any] | None = None
    if sheet_entries:
        answered = BUNDLE.bundle_answers if BUNDLE is not None else (lambda _r: False)
        tabs, read_at, unread = await tabs_from_python([e["sheet"] for e in sheet_entries
                                                        if not answered(e["resource"])])
        catchup = {"tabs": tabs, "read_at": read_at, "python": unread}
        if unread:
            log.warning("sheet slices: %d tab(s) not read by Python, their files kept (%s)", len(unread),
                        "; ".join(f"{t}: {w}" for t, w in sorted(unread.items())[:4])[:300])
    shaped_names = [e["resource"] for e in entries if e.get("mode") == "adapter" and not is_hopeless(e["resource"])]
    carried_shaped: set[str] = {n for n in shaped_names if n not in from_python}
    if carried_shaped:
        log.warning("shaped: %d resource(s) no Python door fills, their files kept (%s)", len(carried_shaped),
                    ", ".join(sorted(carried_shaped)[:6]))
    decided_at = time.time()
    shaped: dict[str, list[dict]] = {}
    if from_python:
        shaped = await rows_from_python(from_python)
        carried_shaped.update(n for n in from_python if n not in shaped)
        log.info("shaped: %d of %d resources filled by Python", len(shaped), len(from_python))
    here = asyncio.gather(*(build_one(e, catchup, shaped, carried_shaped) for e in entries))
    there = relay_built(relay_entries, [])
    built, moduled, relayed = await asyncio.gather(here, app_built(module_entries, only is not None), there)
    results = list(built) + list(moduled) + list(relayed)
    if late:
        results += await app_late([k for k in late if k in APP_LATE])
        there_late = [k for k in late if k not in APP_LATE]
        if there_late:
            results += await relay_built([], there_late)
    index_path = OUT_DIR / "index.json"
    try:
        current = json.loads(index_path.read_text()).get("slices", {})
    except Exception:  # noqa: BLE001
        current = {}
    for r in results:
        r = dict(r)
        current[r.pop("resource")] = r
    buildable = {e["resource"] for e in load_manifest()}
    stale_keys = [k for k in current if k not in buildable]
    for k in stale_keys:
        current.pop(k, None)
    if stale_keys:
        log.info("snapshot: dropped %d slice record(s) the manifest no longer builds: %s", len(stale_keys),
                 ", ".join(sorted(stale_keys)))
    payload = {"built_at": stamp(), "slices": current}
    write_atomic(index_path, payload)
    ok = sum(1 for r in results if "error" not in r)
    log.info("snapshot: %d/%d slices rebuilt", ok, len(results))
    write_traffic()
    if only is None:
        full_pass_done(decided_at)
    return payload


def write_traffic() -> None:
    """The traffic as an ordinary slice, admin-only."""
    from datetime import datetime, timezone

    try:
        write_atomic(OUT_DIR / f"{TRAFFIC_RESOURCE}.json", {
            "resource": TRAFFIC_RESOURCE, "built_at": datetime.now(timezone.utc).isoformat(),
            "rows": [dict(traffic_snapshot(), id="traffic")]})
    except Exception as exc:  # noqa: BLE001 - a report must never be an outage
        log.warning("resolver health slice not written: %s", exc)


async def config_lane_refresh(force: bool = False) -> None:
    """The platform-wide config Python reads off asa-hub-db (app/config_lane.py), once for everyone; the previous lane
    stands while it does not answer."""
    if not force and time.time() - float(CONFIG_LANE["at"]) < CONFIG_LANE_TTL_S:
        return
    try:
        got = await FD.call_app(CONFIG_LANE_APP, "configLane", dict(SERVICE), {})
        env = got[2] if got is not None else {"status": 503, "message": "Python did not answer"}
        if env.get("status") == 200 and isinstance(env.get("data"), dict):
            CONFIG_LANE["data"] = env["data"]
            CONFIG_LANE["at"] = time.time()
            # the relay's own gates read this lane too, told it here (it reads none itself)
            import live_notify  # noqa: PLC0415
            live_notify.lane(env["data"])
        else:
            log.warning("config lane not read: %s", env.get("message") or env.get("status"))
            CONFIG_LANE["at"] = time.time() - CONFIG_LANE_TTL_S + CONFIG_LANE_RETRY_S
    except Exception as exc:  # noqa: BLE001 - the previous answer stands
        log.warning("config lane refresh failed: %s", exc)
        CONFIG_LANE["at"] = time.time() - CONFIG_LANE_TTL_S + CONFIG_LANE_RETRY_S


def lane_for(place: str) -> dict[str, Any] | None:
    """The cached config, but only for a reader standing where it was built."""
    data = CONFIG_LANE.get("data")
    if not isinstance(data, dict):
        return None
    if str(data.get("place") or "") != str(place or ""):
        return None
    return data


def lane_list(key: str) -> frozenset[str]:
    raw = (lane_for("") or {}).get(key)
    if not isinstance(raw, list):
        return frozenset()
    return frozenset(str(x).strip() for x in raw if str(x or "").strip())


async def loop() -> None:
    """One loop serving both triggers: the debounce and the floor; the config rides the same clock."""
    global _dirty
    last_full = 0.0
    while True:
        await asyncio.sleep(1)
        now = time.time()
        try:
            if _dirty and now - _dirty_at[0] >= DEBOUNCE_SECONDS:
                due, _dirty = _dirty, set()
                await asyncio.wait_for(build_all(only=due), timeout=BUILD_TIMEOUT_S)
            elif now - last_full >= HEARTBEAT_SECONDS:
                last_full = now
                try:
                    await asyncio.wait_for(build_all(), timeout=BUILD_TIMEOUT_S)
                finally:
                    full_pass_done(now)
            try:
                await asyncio.wait_for(config_lane_refresh(), timeout=60)
            except Exception as exc:  # noqa: BLE001 - the previous answer stands
                log.warning("config lane tick: %s", exc)
        except asyncio.TimeoutError:
            log.error("snapshot build exceeded %ss and was abandoned — the previous slices stay served; next tick "
                      "starts fresh", BUILD_TIMEOUT_S)
        except Exception as exc:  # noqa: BLE001 - the loop must not die
            log.exception("snapshot loop: %s", exc)


async def rebuild(request: Request) -> Any:
    """POST /rebuild — the relay's, with its X-Hub-Token: {resources: [...]} rebuilt now (all of them when none is
    named)."""
    if not TOKEN[0] or not hmac.compare_digest(str(request.headers.get("x-hub-token") or ""), TOKEN[0]):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    raw = await request.body()
    body = json.loads(raw) if raw else {}
    only = set(body.get("resources") or []) or None
    return await build_all(only=only)


def install(app: Any) -> None:
    app.post("/rebuild")(rebuild)
