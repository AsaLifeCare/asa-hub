"""Attendance slice served from comm_attendance_reading (the old platform's comm_attendance.py, translated here: the
punches off asa_psi_time_entries, the call-off tracker off asa-hub-db), which matches names with comm_when_reading."""
from __future__ import annotations

from types import ModuleType

RESOURCES = ("commAttendance",)


def module() -> ModuleType:
    import comm_attendance_reading  # noqa: PLC0415 - loaded with its matcher on first use

    return comm_attendance_reading


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    if resource not in RESOURCES:
        raise ValueError(f"Unknown resource {resource!r}")
    return module().build(resource, dsn)
