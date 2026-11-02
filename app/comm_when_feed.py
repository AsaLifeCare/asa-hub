"""The window a person may be asked in, shaped for commWhenIngest; the one arithmetic is comm_when.build."""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from types import ModuleType
from typing import Any

RESOURCE = "commWhen"

# must match the house minted by tools/mint_comm_when_house.py, minus the door's own columns and source_at
FIELDS = [
    "person_key", "name",
    "state",
    "window_from", "window_to", "moment_at",
    "shift_at",
    "only_by_this_rule",
    "why",
]

# named again rather than imported: this file must refuse on its own
REFUSED = ["house", "shift_code", "location_code",
           "address", "latitude", "longitude",
           "consumers", "num_consumers",
           "comments", "notes", "note", "shift_raw", "raw",
           "phone", "email"]

_LINE_HOLDS = sorted(set(REFUSED) & set(FIELDS))
if _LINE_HOLDS:
    raise RuntimeError(
        "comm_when_feed: a worker's window may never carry client data — "
        + ", ".join(_LINE_HOLDS))

# the door's states; window_refused is absent on purpose: only the far side writes it
STATES = ("reachable", "held", "spent", "hours_unknown", "no_shift")

# the door's COMM_WHEN_INGEST_CAP (400) is the authority on the ceiling
BATCH_ROWS = max(1, min(400, int(os.getenv("HUB_COMM_WHEN_BATCH", "200"))))

class CommWhenUnavailable(RuntimeError):
    """Its own type: the caller must tell a missing reading from a database that is down."""


def module() -> ModuleType:
    """comm_when_reading: the old platform's comm_when.py translated here, its roster off the CALENDAR grids with
    the published cells laid (so no lens over asa_schedules is needed)."""
    import comm_when_reading  # noqa: PLC0415 - loaded on first use

    return comm_when_reading


def _text(v: Any, cap: int = 0) -> str:
    """The door's own normalisation, so the payload is what lands."""
    if v is None or v is False:
        return ""
    if v is True:
        return "yes"
    s = " ".join(str(v).split())
    return s[:cap] if cap and len(s) > cap else s


def _instant(v: Any) -> str:
    """The door refuses an instant without an offset, so it is emptied here too."""
    s = _text(v, 40)
    if not s:
        return ""
    try:
        datetime.fromisoformat(s)
    except ValueError:
        return ""
    return s


def project(row: dict) -> dict | None:
    """Columns are named one by one, so nothing new upstream can ride along."""
    who = _text(row.get("person_key"), 60)
    state = _text(row.get("state"), 24).lower()
    if not who or state not in STATES:
        return None
    return {
        "person_key": who,
        "name": _text(row.get("name"), 120),
        "state": state,
        "window_from": _instant(row.get("window_from")),
        "window_to": _instant(row.get("window_to")),
        "moment_at": _instant(row.get("moment_at")),
        "shift_at": _instant(row.get("shift_at")),
        "only_by_this_rule": "yes" if row.get("only_by_this_rule") is True else "",
        # the computation's own sentence, never a manager's note
        "why": _text(row.get("why"), 300),
    }


def digest(rows: list[dict]) -> str:
    """Every field: the caller hands over only when this moves."""
    return hashlib.sha1(json.dumps(
        [[r[k] for k in FIELDS] for r in rows], sort_keys=True).encode()).hexdigest()


def read(dsn: str) -> dict:
    """Key-ordered so batches are stable; hours_unknown and no_shift rows are carried, never filtered."""
    mod = module()
    raw, _ = mod.build(RESOURCE, dsn)

    rows: list[dict] = []
    refused = 0
    for r in raw:
        out = project(dict(r))
        if out is None:
            refused += 1
            continue
        rows.append(out)
    rows.sort(key=lambda r: r["person_key"])

    states: dict[str, int] = {}
    for r in rows:
        states[r["state"]] = states.get(r["state"], 0) + 1
    return {
        "rows": rows,
        "digest": digest(rows),
        "read": len(raw),
        "refused": refused,
        "states": states,
        "reachable": states.get("reachable", 0),
        "only_by_this_rule": sum(1 for r in rows if r["only_by_this_rule"] and r["window_from"]),
        "windowless": sum(1 for r in rows if r["state"] == "reachable" and not r["window_from"]),
    }


def batches(rows: list[dict], size: int = 0) -> list[list[dict]]:
    n = size if size > 0 else BATCH_ROWS
    return [rows[i:i + n] for i in range(0, len(rows), n)] or []


def stamp() -> str:
    """Once per sweep, never per batch: the reader's retirement rule hangs off this stamp."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def payload(batch: list[dict], source_at: str) -> dict:
    return {"rows": batch, "source_at": source_at}


def verdict(answers: list[dict], expected: int) -> dict:
    """Counted from the door's own reading of the grid, never from a row count."""
    def total(field: str) -> int:
        return sum(int(a.get(field) or 0) for a in answers)

    held = total("inserted") + total("updated") + total("unchanged")
    crossed: list[str] = []
    for a in answers:
        for name in a.get("dropped_columns") or []:
            if name not in crossed:
                crossed.append(name)
    return {
        "passes": len(answers),
        "handed": total("received"),
        "kept": total("kept"),
        "refused": total("refused"),
        "overflow": total("overflow"),
        "inserted": total("inserted"),
        "updated": total("updated"),
        "unchanged": total("unchanged"),
        "writes": total("writes"),
        "reachable": total("reachable"),
        "only_by_this_rule": total("only_by_this_rule"),
        "unfit": total("unfit"),
        "held": held,
        "expected": expected,
        "complete": held == expected and total("overflow") == 0,
        "converged": total("inserted") == 0 and total("updated") == 0,
        "dropped_columns": crossed,
    }


if __name__ == "__main__":
    import sys
    _dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not _dsn:
        sys.exit("HUB_SNAPSHOT_PG_DSN is not set")
    try:
        _got = read(_dsn)
    except CommWhenUnavailable as exc:
        sys.exit(str(exc))
    _rows = _got.pop("rows")
    _got["batches"] = [len(b) for b in batches(_rows)]
    _got["fields"] = len(FIELDS)
    _got["refused_columns_present"] = sorted(
        {k for r in _rows for k in r if k in REFUSED})
    print(json.dumps(_got, indent=2, sort_keys=True))
