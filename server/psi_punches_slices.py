"""PsiAnywhere's punch record as a flat file; dated by the build, since source_synced_at only moves when an entry does."""
from __future__ import annotations

import re
from typing import Any

import psi_punches_feed

RESOURCES = ("psiPunches",)

# Order of `PunchRow` in PsiPunchesPage.tsx; only these columns can reach the browser.
FIELDS = (
    "single_entry_id", "status",
    "employee", "people_id",
    "date_service", "date_iso",
    "start_time", "end_time", "hours",
    "work_code",
    "submitted_user", "supervisor_id",
    "has_signature", "is_documented", "evv_reasons",
    "source", "source_synced_at",
)

# Not imported from the feed, so this file refuses on its own.
REFUSED = ("address", "latitude", "longitude", "consumers",
           "num_consumers", "comments", "house", "raw")

_HOLDS = sorted(set(FIELDS) & set(REFUSED))
if _HOLDS:
    raise RuntimeError(
        "psi_punches_slices: a staff-hours file may never carry client data — "
        + ", ".join(_HOLDS))

# Must match `psiPunchesDateIso_` in PsiPunches.gs character for character.
_US_DAY = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")


def date_iso(date_service: str) -> str:
    """`MM/DD/YYYY` → `YYYY-MM-DD`, or '' — never a guess."""
    m = _US_DAY.match(str(date_service or "").strip())
    if not m:
        return ""
    month, day = int(m.group(1)), int(m.group(2))
    if month < 1 or month > 12 or day < 1 or day > 31:
        return ""
    return f"{m.group(3)}-{m.group(1)}-{m.group(2)}"


def project(row: dict) -> dict:
    """No filter here: the feed already dropped and counted keyless rows."""
    out: dict[str, Any] = {}
    for field in FIELDS:
        out[field] = "" if row.get(field) is None else str(row.get(field))
    out["date_iso"] = date_iso(row.get("date_service", ""))
    return out


def _rows(dsn: str) -> tuple[list[dict], str | None, dict]:
    got = psi_punches_feed.read(dsn)
    rows = [project(r) for r in got["rows"]]

    source_at = got.get("newest") or None

    quality = {
        "read": got.get("read", 0),
        "keyless": got.get("keyless", 0),
        "undated": sum(1 for r in rows if not r["date_iso"]),
        "people": got.get("people", 0),
        "open_punches": got.get("open_punches", 0),
        "first_day": got.get("first_day", ""),
        "last_day": got.get("last_day", ""),
    }
    return rows, source_at, quality


class PsiPunchesEmpty(RuntimeError):
    """The read answered with no punches. NOT a record that holds none."""


def _refuse_if_empty(rows: list[dict], quality: dict) -> None:
    """The record only grows, so an empty read is a broken read and is never published."""
    if rows:
        return
    raise PsiPunchesEmpty(
        f"psiPunches: PsiAnywhere's record read back empty "
        f"(read {quality.get('read', 0)}, keyless {quality.get('keyless', 0)}) — "
        f"refused rather than written as a record that holds no punches"
    )


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    if resource not in RESOURCES:
        raise ValueError(f"Unknown resource {resource!r}")
    rows, _source_at, quality = _rows(dsn)
    _refuse_if_empty(rows, quality)
    return rows, None


def build_with_quality(dsn: str) -> tuple[list[dict], str | None, dict]:
    rows, source_at, quality = _rows(dsn)
    _refuse_if_empty(rows, quality)
    return rows, source_at, quality


if __name__ == "__main__":
    import json
    import os
    import sys

    _dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not _dsn:
        sys.exit("HUB_SNAPSHOT_PG_DSN is not set")
    _rows_, _at, _q = build_with_quality(_dsn)
    print(json.dumps({
        "rows": len(_rows_),
        "source_at": _at,
        "quality": _q,
        "bytes": len(json.dumps(_rows_)),
        "unexpected_keys": sorted({k for _r in _rows_ for k in _r} - set(FIELDS)),
        "refused_present": sorted({k for _r in _rows_ for k in _r} & set(REFUSED)),
    }, indent=2, sort_keys=True))
