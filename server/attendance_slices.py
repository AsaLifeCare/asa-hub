"""Attendance slice served from the old platform's comm_attendance.py, which needs comm_when.py mounted read-only beside it."""
from __future__ import annotations

import importlib.util
import os
from types import ModuleType

RESOURCES = ("commAttendance",)

# The last path is for a host-side probe, never for the relay.
MODULE_PATHS = [
    os.getenv("HUB_COMM_ATTENDANCE_MODULE") or "",
    "/srv/analytics/comm_attendance.py",
]

_MODULE: ModuleType | None = None


class AttendanceUnavailable(RuntimeError):
    """The computation could not be loaded; refuse rather than guess a name match."""


def module() -> ModuleType:
    """Loaded by path, not import, so the sibling package's dependencies stay out."""
    global _MODULE
    if _MODULE is not None:
        return _MODULE
    tried = []
    for path in MODULE_PATHS:
        if not path:
            continue
        tried.append(path)
        if not os.path.exists(path):
            continue
        spec = importlib.util.spec_from_file_location("hub_comm_attendance", path)
        if spec is None or spec.loader is None:
            continue
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        if not hasattr(mod, "build"):
            raise AttendanceUnavailable(
                f"{path} has no build() — it is not the attendance reading")
        _MODULE = mod
        return mod
    raise AttendanceUnavailable(
        "comm_attendance.py is not reachable from this process (looked in: "
        + ", ".join(tried) + ") — the relay needs it and comm_when.py mounted "
        "read-only beside each other, and until they are, this reading refuses "
        "rather than guessing at a name match of its own")


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    if resource not in RESOURCES:
        raise ValueError(f"Unknown resource {resource!r}")
    return module().build(resource, dsn)


if __name__ == "__main__":
    import json
    import sys

    _dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not _dsn:
        sys.exit("HUB_SNAPSHOT_PG_DSN is not set")
    print(json.dumps(module().scan(_dsn), indent=2, sort_keys=True, default=str))
