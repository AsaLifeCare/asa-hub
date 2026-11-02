"""PsiAnywhere punches (stored copy + live reads, joined by Single_Entry_ID) shaped for psiPunchesIngest."""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

PSI_TABLE = "asa_psi_time_entries"
SOURCE = "asa_psi_time_entries"
LIVE_SOURCE = "psianywhere_live"

# Minted order of the house minus the five the door authors (id, createdAt, updatedAt, date_iso, tenant).
FIELDS = [
    "single_entry_id", "status",
    "employee", "people_id",
    "date_service", "start_time", "end_time", "hours",
    "work_code",
    "submitted_user", "supervisor_id",
    "has_signature", "is_documented", "evv_reasons",
    "source", "source_synced_at",
]

# Not imported from the door, so this file refuses on its own.
REFUSED = ["address", "latitude", "longitude", "consumers",
           "num_consumers", "comments", "house", "raw"]

_SELECT = [
    "single_entry_id", "status", "employee", "people_id",
    "date_service", "start_time", "end_time", "hours", "work_code",
    "submitted_user", "supervisor_id",
    "has_signature", "is_documented", "evv_reasons", "synced_at",
]

_LINE_HOLDS = set(REFUSED) & (set(FIELDS) | set(_SELECT))
if _LINE_HOLDS:
    raise RuntimeError(
        "psi_punches_feed: a staff-hours house may never carry client data — "
        + ", ".join(sorted(_LINE_HOLDS)))

# PSI_PUNCHES_INGEST_CAP in the door is 1,200; rows past it are reported, not written.
BATCH_ROWS = max(1, min(1200, int(os.getenv("HUB_PSI_PUNCHES_BATCH", "1000"))))


def _text(v: Any, cap: int = 0) -> str:
    """The door's own whitespace normalisation, so the payload is what lands."""
    if v is None:
        return ""
    s = " ".join(str(v).split())
    return s[:cap] if cap and len(s) > cap else s


def _hours(v: Any) -> str:
    """Two decimals is the value's own spelling; the raw float text overflows the 20-char column."""
    if v is None:
        return ""
    try:
        return str(Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    except Exception:  # noqa: BLE001
        return _text(v, 20)


def _flag(v: Any) -> str:
    """true / false / '' — and the blank is a finding, not a default."""
    if v is True:
        return "true"
    if v is False:
        return "false"
    return ""


def _stamp(v: Any) -> str:
    """When PsiAnywhere last spoke for this row, ISO seconds, UTC."""
    if isinstance(v, datetime):
        at = v if v.tzinfo else v.replace(tzinfo=timezone.utc)
        return at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return _text(v, 40)


def project(row: dict) -> dict | None:
    """One cortex row → the house line, or None when it has no key (the upsert would append it forever)."""
    key = _text(row.get("single_entry_id"), 60)
    if not key:
        return None
    return {
        "single_entry_id": key,
        "status": _text(row.get("status"), 12),
        "employee": _text(row.get("employee"), 120),
        "people_id": _text(row.get("people_id"), 40),
        "date_service": _text(row.get("date_service"), 40),
        "start_time": _text(row.get("start_time"), 40),
        "end_time": _text(row.get("end_time"), 40),
        "hours": _hours(row.get("hours")),
        "work_code": _text(row.get("work_code"), 24),
        "submitted_user": _text(row.get("submitted_user"), 120),
        "supervisor_id": _text(row.get("supervisor_id"), 40),
        "has_signature": _flag(row.get("has_signature")),
        "is_documented": _flag(row.get("is_documented")),
        "evv_reasons": _text(row.get("evv_reasons"), 60),
        "source": SOURCE,
        "source_synced_at": _stamp(row.get("synced_at")),
    }


_US_DAY = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})")
_CLOCK = re.compile(r"^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$")


def _us_day(raw: Any) -> str:
    """`8/2/2026 12:00:00 AM` → `08/02/2026`, the stored copy's spelling."""
    m = _US_DAY.match(str(raw or ""))
    if not m:
        return _text(raw, 40)
    return f"{int(m.group(1)):02d}/{int(m.group(2)):02d}/{m.group(3)}"


def _ampm(raw: Any) -> str:
    """`21:00:00` → `09:00:00 PM`, the stored copy's spelling; '' stays ''."""
    m = _CLOCK.match(str(raw or ""))
    if not m:
        return _text(raw, 40)
    h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    if h > 23 or mi > 59 or s > 59:
        return _text(raw, 40)
    return f"{(h + 11) % 12 + 1:02d}:{mi:02d}:{s:02d} {'AM' if h < 12 else 'PM'}"


def project_live(rec: dict) -> dict | None:
    """One live entry → the house line in the stored copy's spellings; EVV flags stay blank."""
    entry = (rec or {}).get("entry") or {}
    key = _text(entry.get("Single_Entry_ID"), 60)
    if not key:
        return None
    name = " ".join(x for x in (_text(entry.get("firstname")), _text(entry.get("lastname"))) if x)
    return {
        "single_entry_id": key,
        "status": _text(entry.get("Anywhere_status"), 12),
        "employee": _text(name, 120),
        "people_id": _text(entry.get("peopleId"), 40),
        "date_service": _us_day(entry.get("Date_of_Service")),
        "start_time": _ampm(entry.get("start_time")),
        "end_time": _ampm(entry.get("end_time")),
        "hours": _hours(entry.get("check_hours")),
        "work_code": _text(entry.get("WCCode"), 24),
        "submitted_user": _text(entry.get("submittedUser"), 120),
        "supervisor_id": _text(entry.get("_supervisorId"), 40),
        "has_signature": "",
        "is_documented": "",
        "evv_reasons": "",
        "source": LIVE_SOURCE,
        # When the entry last changed, not when it was last seen, or every row rewrites each collection.
        "source_synced_at": _text((rec or {}).get("changed_at") or (rec or {}).get("last_seen"), 40),
    }


def _order(key: str) -> tuple[int, str]:
    """Numeric order for numeral keys of any width."""
    return (len(key), key)


def union(frozen: list[dict], live: list[dict]) -> list[dict]:
    """Keyed union; live wins field by field except where it is blank. Ordered by key so passes are stable."""
    by: dict[str, dict] = {r["single_entry_id"]: r for r in frozen if r.get("single_entry_id")}
    for r in live:
        k = r.get("single_entry_id")
        if not k:
            continue
        old = by.get(k)
        if old is None:
            by[k] = r
            continue
        merged = dict(old)
        merged.update({f: v for f, v in r.items() if v != "" or f not in old})
        by[k] = merged
    return [by[k] for k in sorted(by, key=_order)]


def live_rows() -> list[dict]:
    """Every entry the relay has read from PsiAnywhere; no history is an empty list."""
    try:
        import psi_entries  # noqa: PLC0415
        recs = psi_entries.everything()
    except Exception:  # noqa: BLE001 — the stored copy still stands on its own
        return []
    out = [project_live(v) for v in recs.values()]
    return [r for r in out if r is not None]


def fingerprints(rows: list[dict]) -> dict[str, str]:
    """Single_Entry_ID → a fingerprint of every field the house stores."""
    return {r["single_entry_id"]: hashlib.sha1(json.dumps([r[k] for k in FIELDS]).encode())
            .hexdigest() for r in rows}


def changed_rows(rows: list[dict], handed: dict[str, str]) -> list[dict]:
    """Rows whose fingerprint differs from what was last handed; empty `handed` means everything."""
    if not handed:
        return list(rows)
    prints = fingerprints(rows)
    return [r for r in rows if handed.get(r["single_entry_id"]) != prints[r["single_entry_id"]]]


def digest(rows: list[dict]) -> str:
    """Fingerprint of every field: a column the digest skips could never reach the house."""
    return hashlib.sha1(json.dumps(
        [[r[k] for k in FIELDS] for r in rows], sort_keys=True).encode()).hexdigest()


def probe(dsn: str) -> dict:
    """Cheap has-anything-moved check: counts and newest stamps, no rows."""
    import lanes_pg as psycopg2  # noqa: PLC0415 - the old platform's database on the app's read-only connection
    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"SELECT count(*), max(synced_at) FROM public.{PSI_TABLE}")  # noqa: S608
        got = cur.fetchone() or (0, None)
    live = {"rows": 0, "newest": ""}
    try:
        import psi_entries  # noqa: PLC0415
        live = psi_entries.summary()
    except Exception:  # noqa: BLE001 — no history reads as none
        pass
    return {"rows": int(got[0] or 0), "newest": _stamp(got[1]),
            "live_rows": int(live.get("rows") or 0), "live_newest": str(live.get("newest") or "")}


def read(dsn: str) -> dict:
    """The whole record, shaped, always ordered by key so a batch cursor means the same rows each run."""
    import lanes_pg as psycopg2  # noqa: PLC0415 - the old platform's database on the app's read-only connection
    with psycopg2.connect(dsn) as conn, conn.cursor(
        cursor_factory=psycopg2.extras.RealDictCursor
    ) as cur:
        cur.execute(  # noqa: S608
            "SELECT " + ", ".join(_SELECT)
            + f" FROM public.{PSI_TABLE} ORDER BY single_entry_id")
        raw = cur.fetchall()

    frozen: list[dict] = []
    keyless = 0
    for r in raw:
        out = project(dict(r))
        if out is None:
            keyless += 1
            continue
        frozen.append(out)
    live = live_rows()
    rows = union(frozen, live)

    people = {r["people_id"] for r in rows if r["people_id"]}
    names = {r["employee"] for r in rows if r["employee"]}
    days = sorted({r["date_service"] for r in rows if r["date_service"]},
                  key=_sortable_day)
    return {
        "rows": rows,
        "digest": digest(rows),
        "read": len(raw) + len(live),
        "stored": len(frozen),
        "live": len(live),
        "live_new": len(rows) - len(frozen),
        "keyless": keyless,
        "people": len(people),
        "names": len(names),
        "open_punches": sum(1 for r in rows if not r["end_time"]),
        "first_day": days[0] if days else "",
        "last_day": days[-1] if days else "",
        "newest": max((r["source_synced_at"] for r in rows), default=""),
    }


def _sortable_day(us: str) -> str:
    """MM/DD/YYYY → YYYY-MM-DD for ordering only; never travels."""
    p = us.split("/")
    return f"{p[2]}-{p[0]}-{p[1]}" if len(p) == 3 else us


def batches(rows: list[dict], size: int = 0) -> list[list[dict]]:
    """Contiguous, in-order passes, so a cursor is a position in the record."""
    n = size if size > 0 else BATCH_ROWS
    return [rows[i:i + n] for i in range(0, len(rows), n)] or []


def payload(batch: list[dict]) -> dict:
    """The door declares exactly one parameter, `rows`."""
    return {"rows": batch}


def verdict(answers: list[dict], expected: int) -> dict:
    """What landed, from the door's getDataRange() reading, never a column-A count."""
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
    _got = read(_dsn)
    _rows = _got.pop("rows")
    _got["batches"] = [len(b) for b in batches(_rows)]
    _got["fields"] = len(FIELDS)
    print(json.dumps(_got, indent=2, sort_keys=True))
