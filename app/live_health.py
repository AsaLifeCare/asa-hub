"""/health, the pulse the Guardian reads: the live plane's own vitals (the slices, the manifest, the bundle lane, the
phase, the traffic, the serving build, the host's outside view) answered here, and each clock's and keeper's from the
process that now runs it: the sweeps, the hotline, the chat, the text inbox and the time clock from this app's own
clocks (PROVIDERS), the sheet keeper and the form digester from asa-hub-worker's /vitals."""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger("asa-hub-app.live-health")

HOST_STATUS_PATH = Path(os.getenv("HUB_HOST_STATUS_PATH", "/srv/manifests/host-status.json"))
HOST_STATUS_MAX_AGE_S = 180
ENGINE_BUILD_PATH = Path(os.getenv("HUB_ENGINE_BUILD_PATH", "/srv/app-packs/engine-build.json"))
SERVICE_SECRET = os.getenv("HUB_SERVICE_SECRET", "")
SERVICE_TOKEN = os.getenv("HUB_SERVICE_TOKEN", "")
# the vitals /health names, each said by the process that owns it (PROVIDERS); one with no owner here reads unknown
RELAY_KEYS = ("sweeps", "hotline", "hotline_fast", "chat_live", "quo_inbox", "psi", "sheet_sync", "form_digest")
PROVIDERS: dict[str, Callable[[], Any]] = {}

SLICES: Any = None
BUNDLE: Any = None


def engine_build() -> str:
    try:
        kept = str(json.loads(ENGINE_BUILD_PATH.read_text()).get("build") or "")
    except Exception:  # noqa: BLE001 - no file is no build
        kept = ""
    return kept or os.getenv("HUB_GAS_ENGINE_BUILD", "").strip()


def host_status() -> tuple[dict[str, Any] | None, float | None]:
    try:
        age = round(time.time() - HOST_STATUS_PATH.stat().st_mtime, 1)
    except OSError:
        return None, None
    if age > HOST_STATUS_MAX_AGE_S:
        return None, age
    try:
        return json.loads(HOST_STATUS_PATH.read_text()), age
    except Exception:  # noqa: BLE001 - unreadable JSON is 'unknown', never green
        return None, age


# ---- each vital from the process that now owns it: this app's clocks, or asa-hub-worker's keepers ------------------

WORKER_URL = (os.getenv("HUB_WORKER_URL") or "http://asa-hub-worker:8091").rstrip("/")
WORKER_TOKEN = os.getenv("HUB_APP_TOKEN", "")
WORKER_HELD_S = 30.0
_WORKER: dict[str, Any] = {"at": 0.0, "data": None, "said": 0.0}


def _worker_vitals() -> dict[str, Any]:
    """Blocking: the worker's keepers' vitals (its GET /vitals), held a while; {} when it does not answer."""
    if time.time() - _WORKER["at"] < WORKER_HELD_S and _WORKER["data"] is not None:
        return _WORKER["data"]
    import urllib.request

    data: dict[str, Any] = {}
    try:
        req = urllib.request.Request(WORKER_URL + "/vitals", headers={"x-hub-token": WORKER_TOKEN})
        with urllib.request.urlopen(req, timeout=8) as res:  # noqa: S310 - the worker, inside the network
            got = json.loads(res.read() or b"{}")
        data = got if isinstance(got, dict) else {}
    except Exception as exc:  # noqa: BLE001 - unknown, never green
        if time.time() - _WORKER["said"] > 3600:
            _WORKER["said"] = time.time()
            log.info("health: the worker's vitals not read (%s)", type(exc).__name__)
    _WORKER.update(at=time.time(), data=data)
    return data


def _sweeps() -> dict[str, int]:
    import clocks  # noqa: PLC0415
    import comm_calls_door  # noqa: PLC0415
    import hotline_fast  # noqa: PLC0415

    return {**clocks.health()["failures"], "hotline": int(hotline_fast._FAILURES[0]),  # noqa: SLF001
            "comm_calls": int(comm_calls_door._LIVE["failures"])}  # noqa: SLF001


def _hotline() -> dict[str, Any]:
    import hotline_fast  # noqa: PLC0415

    at = float(hotline_fast._LAST.get("at") or 0.0)  # noqa: SLF001
    return {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(at)) if at else None, "ever_run": bool(at),
            "refused_in_a_row": int(hotline_fast._FAILURES[0])}  # noqa: SLF001


def _hotline_fast() -> dict[str, Any]:
    import hotline_fast  # noqa: PLC0415

    return {"armed": bool(hotline_fast.armed())}


def _chat_live() -> dict[str, Any]:
    import chat_doors  # noqa: PLC0415

    return chat_doors.health()


def _quo_inbox() -> dict[str, Any]:
    import clocks  # noqa: PLC0415

    return clocks.health()["quo_inbox"]


def _psi() -> dict[str, Any]:
    import psi_anywhere  # noqa: PLC0415

    return psi_anywhere.health()


PROVIDERS.update(sweeps=_sweeps, hotline=_hotline, hotline_fast=_hotline_fast, chat_live=_chat_live,
                 quo_inbox=_quo_inbox, psi=_psi,
                 sheet_sync=lambda: _worker_vitals().get("sheet_sync"),
                 form_digest=lambda: _worker_vitals().get("form_digest"))


def resolver_declared() -> int:
    path = Path(os.getenv("HUB_RESOLVER_MANIFEST", "/srv/manifests/resolver-manifest.json"))
    try:
        return len(json.loads(path.read_text()).get("actions") or {})
    except Exception:  # noqa: BLE001
        return 0


async def health() -> dict[str, Any]:
    from starlette.concurrency import run_in_threadpool

    try:
        index = json.loads((SLICES.OUT_DIR / "index.json").read_text())
    except Exception:  # noqa: BLE001
        index = {"slices": {}}
    slices = index.get("slices", {})
    host, host_age = host_status()
    # the worker asked off the loop; its providers read what this held
    await run_in_threadpool(_worker_vitals)
    theirs = {}
    for key in RELAY_KEYS:
        if key in PROVIDERS:
            try:
                theirs[key] = PROVIDERS[key]()
            except Exception:  # noqa: BLE001 - unknown, never green
                theirs[key] = None
        else:
            theirs[key] = None
    return {
        "ok": True,
        "manifest": len(SLICES.load_manifest()),
        "held_live": dict(SLICES.HELD_LIVE),
        "bundle_lane": "on" if BUNDLE.BUNDLE_LANE else "off",
        "bundle_dir": str(BUNDLE.BUNDLE_DIR),
        "bundle_built_at": BUNDLE.LAST["built_at"] or None,
        "bundle_resources": len(BUNDLE.LAST["resources"] or {}),
        "engine_build": engine_build() or None,
        "phase": SLICES.PHASE["phase"],
        "phase_since": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(SLICES.PHASE["since"])),
        "sweeps": theirs["sweeps"],
        "hotline": theirs["hotline"],
        "hotline_fast": theirs["hotline_fast"],
        "chat_live": theirs["chat_live"],
        "quo_inbox": theirs["quo_inbox"],
        "psi": theirs["psi"],
        "hopeless_adapters": SLICES.hopeless(),
        "bundle": {"cursor": BUNDLE.CURSOR.get("i") or 0,
                   "budget_spent": {"count": BUNDLE.BUDGET["overruns"],
                                    "age_s": round(time.time() - BUNDLE.BUDGET["at"], 1) if BUNDLE.BUDGET["at"]
                                    else None}},
        "host": host,
        "host_age_s": host_age,
        "slices": len(slices),
        "failing": sorted(k for k, v in slices.items() if v.get("error")),
        "built_at": index.get("built_at"),
        "identity": "secret" if SERVICE_SECRET else ("session" if SERVICE_TOKEN else None),
        "resolver": {"declared": resolver_declared(), "traffic": SLICES.traffic_snapshot()},
        "sheet_sync": theirs["sheet_sync"],
        "form_digest": theirs["form_digest"],
    }


def install(app: Any) -> None:
    app.get("/health")(health)
