"""The comm_when computation projected for the screen, loaded through comm_when_feed.module() so both lanes share it."""
from __future__ import annotations

from typing import Any

import comm_when_feed

RESOURCES = ("commWhen", "commWhenMoments")

# The lock: only a column typed here can reach a file.
FIELDS: dict[str, tuple[str, ...]] = {
    "commWhen": (
        "id", "person_key", "name", "state",
        "window_from", "window_to", "moment_at",
        "shift_at", "shift_code", "house",
        "only_by_this_rule", "moments_ahead", "why",
        "hold_until", "reach_anyway",
        "add_quiet_after_from", "add_quiet_after_to",
        "add_day_sleeper", "add_day_sleeper_why",
        # which books this reading stood on, and how old each was
        "sources_freshness",
    ),
    "commWhenMoments": (
        "id", "person_key", "name", "house", "shift_code",
        "shift_at", "window_from", "window_to", "moment_at",
        "only_by_this_rule", "voided_by_call_off",
        "sources_freshness",
    ),
}

# Named, not inferred: the string 'false' is truthy in a browser.
BOOLS: dict[str, tuple[str, ...]] = {
    "commWhen": ("only_by_this_rule", "reach_anyway", "add_day_sleeper"),
    "commWhenMoments": ("only_by_this_rule", "voided_by_call_off"),
}
INTS: dict[str, tuple[str, ...]] = {"commWhen": ("moments_ahead",), "commWhenMoments": ()}

# Omitted when the computation has no opinion; a default would assert facts about unknown hours.
SOMETIMES: dict[str, tuple[str, ...]] = {
    "commWhen": ("add_day_sleeper", "add_day_sleeper_why",
                 "add_quiet_after_from", "add_quiet_after_to"),
    "commWhenMoments": (),
}

# Named here, not imported: a worker's window never carries client data or free text.
REFUSED = ("address", "latitude", "longitude",
           "consumers", "num_consumers",
           "comments", "notes", "note", "shift_raw", "raw",
           "phone", "email")

# Import-time lock: a refused column in FIELDS stops the relay from loading.
_HOLDS = sorted({f for cols in FIELDS.values() for f in cols} & set(REFUSED))
if _HOLDS:
    raise RuntimeError(
        "comm_when_slices: a worker's window may never carry client data — "
        + ", ".join(_HOLDS))

# Any other state would fall silently into the page's 'no shift' band.
STATES = ("reachable", "held", "spent", "hours_unknown", "no_shift")


def _text(v: Any, cap: int = 0) -> str:
    """Never the word 'None'."""
    if v is None or v is False:
        return ""
    if v is True:
        return "yes"
    s = " ".join(str(v).split())
    return s[:cap] if cap and len(s) > cap else s


def _int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def project(resource: str, row: dict) -> dict | None:
    """One computed row → the file's line, or None when the screen could not draw it."""
    who = _text(row.get("person_key"), 60)
    rid = _text(row.get("id"), 80)
    if not who or not rid:
        return None
    out: dict[str, Any] = {}
    bools, ints = BOOLS[resource], INTS[resource]
    sometimes = SOMETIMES[resource]
    for field in FIELDS[resource]:
        if field in sometimes and field not in row:
            continue
        if field in bools:
            out[field] = row.get(field) is True
        elif field in ints:
            out[field] = _int(row.get(field))
        else:
            out[field] = _text(row.get(field), 300)
    if resource == "commWhen" and out["state"] not in STATES:
        return None
    return out


def _rows(resource: str, dsn: str) -> tuple[list[dict], dict]:
    raw, _ = comm_when_feed.module().build(resource, dsn)

    rows: list[dict] = []
    seen: set[str] = set()
    quality = {"read": len(raw), "refused": 0, "collisions": 0}
    for r in raw:
        out = project(resource, dict(r))
        if out is None:
            quality["refused"] += 1
            continue
        # React silently drops the second of two equal ids, so count it here.
        if out["id"] in seen:
            quality["collisions"] += 1
            continue
        seen.add(out["id"])
        rows.append(out)

    # Sorted only so an unchanged rebuild yields an identical file.
    rows.sort(key=lambda r: (r.get("shift_at", ""), r["person_key"], r["id"]))
    return rows, quality


class CommWhenEmpty(RuntimeError):
    """The computation answered with nobody; not a roster with nobody on it."""


def _refuse_if_empty(resource: str, rows: list[dict], quality: dict) -> None:
    """Raise so build_one keeps the previous file instead of writing a green zero."""
    if rows:
        return
    raise CommWhenEmpty(
        f"{resource}: the computation returned no rows at all "
        f"(read {quality.get('read', 0)}, refused {quality.get('refused', 0)}, "
        f"collisions {quality.get('collisions', 0)}) — refused rather than "
        f"written as a week on which nobody can be reached"
    )


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    """source_at is None: the rows are a function of now, so the build instant dates them."""
    if resource not in RESOURCES:
        raise ValueError(f"Unknown resource {resource!r}")
    rows, quality = _rows(resource, dsn)
    _refuse_if_empty(resource, rows, quality)
    if quality.get("refused") or quality.get("collisions"):
        import logging  # noqa: PLC0415

        logging.getLogger("hub.comm-when").warning(
            "%s: %s row(s) kept of %s — %s refused (no key, no id or an unknown state), %s lost to an id collision",
            resource, len(rows), quality.get("read"), quality.get("refused"), quality.get("collisions"))
    return rows, None


def build_with_quality(resource: str, dsn: str) -> tuple[list[dict], str | None, dict]:
    if resource not in RESOURCES:
        raise ValueError(f"Unknown resource {resource!r}")
    rows, quality = _rows(resource, dsn)
    _refuse_if_empty(resource, rows, quality)
    return rows, None, quality


if __name__ == "__main__":  # a read-only probe: counts and shapes, never a person's row
    import json
    import os
    import sys

    _dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not _dsn:
        sys.exit("HUB_SNAPSHOT_PG_DSN is not set")
    report: dict[str, Any] = {}
    for _res in RESOURCES:
        try:
            _rows_, _at, _q = build_with_quality(_res, _dsn)
        except comm_when_feed.CommWhenUnavailable as exc:
            report[_res] = {"unavailable": str(exc)}
            continue
        states: dict[str, int] = {}
        for _r in _rows_:
            states[_r.get("state", "-")] = states.get(_r.get("state", "-"), 0) + 1
        report[_res] = {
            "rows": len(_rows_),
            "quality": _q,
            "fields": sorted(FIELDS[_res]),
            "unexpected_keys": sorted({k for _r in _rows_ for k in _r} - set(FIELDS[_res])),
            "refused_present": sorted({k for _r in _rows_ for k in _r} & set(REFUSED)),
            "states": states or None,
            "only_by_this_rule": sum(1 for _r in _rows_ if _r.get("only_by_this_rule")),
        }
    print(json.dumps(report, indent=2, sort_keys=True))
