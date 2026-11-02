"""asa-hub-status: the asa-hub containers' state for the relay alone, read off the Docker socket through three GETs."""
from __future__ import annotations

import hmac
import http.client
import json
import logging
import os
import re
import socket
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

log = logging.getLogger("asa-hub-status")

SOCK = "/var/run/docker.sock"
PREFIX = "asa-hub"
PORT = int(os.environ.get("HUB_STATUS_PORT") or "8090")
TOKEN = os.environ.get("HUB_STATUS_TOKEN") or ""
TOKEN_MIN_LEN = 24
CACHE_S = 10.0
DOCKER_TIMEOUT_S = 8.0
MAX_CONTAINERS = 40

_LIST_PATH = "/containers/json?" + urllib.parse.urlencode(
    {"all": "1", "filters": json.dumps({"name": [PREFIX]}, separators=(",", ":"))})
_ID = r"[0-9a-f]{64}"
# the only Docker paths this process ever asks, and only with GET (the socket's :ro mount does not stop writes; this does)
_ALLOWED = (re.compile(re.escape(_LIST_PATH)),
            re.compile(rf"/containers/{_ID}/json"),
            re.compile(rf"/containers/{_ID}/stats\?stream=false"))
_STAMP = re.compile(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)")


class _DockerSocket(http.client.HTTPConnection):
    """HTTP/1.1 over the Docker unix socket."""

    def __init__(self) -> None:
        super().__init__("docker", timeout=DOCKER_TIMEOUT_S)

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        sock.connect(SOCK)
        self.sock = sock


def docker_get(path: str) -> Any:
    """One read-only Engine API call; any path outside _ALLOWED is refused before the socket is opened."""
    if not any(p.fullmatch(path) for p in _ALLOWED):
        raise PermissionError("refused Docker path")
    conn = _DockerSocket()
    try:
        conn.request("GET", path)
        resp = conn.getresponse()
        body = resp.read()
    finally:
        conn.close()
    if resp.status != 200:
        raise RuntimeError(f"Docker answered {resp.status}")
    return json.loads(body)


def iso(value: Any) -> str | None:
    """Docker's RFC 3339 (nanoseconds) as UTC milliseconds; its zero time is None."""
    m = _STAMP.fullmatch(str(value or ""))
    if not m or m.group(1).startswith("0001-"):
        return None
    at = datetime.fromisoformat(m.group(1) + m.group(3).replace("Z", "+00:00")).astimezone(timezone.utc)
    return at.strftime("%Y-%m-%dT%H:%M:%S") + "." + (m.group(2) or "0")[:3].ljust(3, "0") + "Z"


def cpu_percent(stats: dict[str, Any]) -> float | None:
    """The docker CLI's CPU %: the usage delta over the system delta, times the online CPUs."""
    cpu, pre = stats.get("cpu_stats") or {}, stats.get("precpu_stats") or {}
    total = (cpu.get("cpu_usage") or {}).get("total_usage")
    pre_total = (pre.get("cpu_usage") or {}).get("total_usage")
    system, pre_system = cpu.get("system_cpu_usage"), pre.get("system_cpu_usage")
    if None in (total, pre_total, system, pre_system):
        return None
    d_cpu, d_sys = total - pre_total, system - pre_system
    if d_sys <= 0 or d_cpu < 0:
        return None
    online = cpu.get("online_cpus") or len((cpu.get("cpu_usage") or {}).get("percpu_usage") or []) or 1
    return round(d_cpu / d_sys * online * 100.0, 1)


def memory(stats: dict[str, Any]) -> tuple[int | None, int | None]:
    """(used, limit) in bytes, the page cache left out as the docker CLI does (cgroup v2, then v1)."""
    mem = stats.get("memory_stats") or {}
    usage = mem.get("usage")
    if not isinstance(usage, int):
        return None, None
    inner = mem.get("stats") or {}
    cache = inner.get("inactive_file", inner.get("total_inactive_file", 0)) or 0
    limit = mem.get("limit")
    return (usage - cache if 0 <= cache < usage else usage), (limit if isinstance(limit, int) and limit > 0 else None)


def one(row: dict[str, Any]) -> dict[str, Any]:
    """One container: the list row, its inspect, and one stats sample while it runs."""
    cid = str(row.get("Id") or "")
    out: dict[str, Any] = {
        "name": str((row.get("Names") or [""])[0] or "").lstrip("/"),
        "image": str(row.get("Image") or ""), "state": str(row.get("State") or ""),
        "status": str(row.get("Status") or ""), "health": "", "started_at": None, "finished_at": None,
        "restart_count": 0, "cpu_percent": None, "mem_used": None, "mem_limit": None, "error": "",
    }
    try:
        info = docker_get(f"/containers/{cid}/json")
        state = info.get("State") or {}
        out["state"] = str(state.get("Status") or out["state"])
        out["health"] = str((state.get("Health") or {}).get("Status") or "")
        out["started_at"] = iso(state.get("StartedAt"))
        out["finished_at"] = iso(state.get("FinishedAt"))
        out["restart_count"] = int(info.get("RestartCount") or 0)
        if state.get("Running"):
            stats = docker_get(f"/containers/{cid}/stats?stream=false")
            out["cpu_percent"] = cpu_percent(stats)
            out["mem_used"], out["mem_limit"] = memory(stats)
    except Exception as exc:  # noqa: BLE001 - one container read short is said on its row, never dropped
        out["error"] = f"partly unread ({type(exc).__name__})"
    return out


_cache: dict[str, Any] = {"at": 0.0, "body": None}
_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=8)


def snapshot() -> dict[str, Any]:
    """Every asa-hub container, held CACHE_S; a failed read raises and is never cached."""
    with _lock:
        if _cache["body"] is not None and time.monotonic() - _cache["at"] < CACHE_S:
            return _cache["body"]
        rows = [r for r in docker_get(_LIST_PATH)
                if any(str(n).lstrip("/").startswith(PREFIX) for n in r.get("Names") or [])]
        items = sorted(_pool.map(one, rows[:MAX_CONTAINERS]), key=lambda c: c["name"])
        body = {"containers": items, "cache_s": CACHE_S,
                "read_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"}
        _cache.update(at=time.monotonic(), body=body)
        return body


class Handler(BaseHTTPRequestHandler):
    server_version = "asa-hub-status"
    sys_version = ""

    def _send(self, code: int, body: dict[str, Any]) -> None:
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        path = urllib.parse.urlsplit(self.path).path
        if path == "/health":
            return self._send(200, {"ok": True})
        if path != "/containers":
            return self._send(404, {"error": "not found"})
        given = (self.headers.get("X-Hub-Status-Token") or "").encode()
        if not TOKEN or not hmac.compare_digest(given, TOKEN.encode()):
            return self._send(401, {"error": "unauthorized"})
        try:
            return self._send(200, snapshot())
        except Exception as exc:  # noqa: BLE001
            log.warning("docker read failed (%s)", type(exc).__name__)
            return self._send(502, {"error": f"Docker could not be read ({type(exc).__name__})"})

    def _refuse(self) -> None:
        self._send(405, {"error": "method not allowed"})

    do_POST = do_PUT = do_PATCH = do_DELETE = _refuse  # noqa: N815

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return


def main() -> None:
    global TOKEN
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if len(TOKEN) < TOKEN_MIN_LEN:
        TOKEN = ""
        log.error("HUB_STATUS_TOKEN is missing or shorter than %d characters: every /containers read is refused",
                  TOKEN_MIN_LEN)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    log.info("serving %s* containers on :%d", PREFIX, PORT)
    server.serve_forever()


if __name__ == "__main__":
    main()
