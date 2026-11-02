"""Every PsiAnywhere time entry the relay reads, kept in asa-hub-db (app.psi_store, by the files' old names: current.json
and each day's rounds); client data is refused at import."""
from __future__ import annotations

import logging
import os
import re
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import psi_store

log = logging.getLogger("hub.psi_entries")

# the folder the history lived in until 10-27, and so the name of its records
ENTRY_DIR = Path(os.getenv(
    "HUB_PSI_ENTRIES_DIR",
    str(Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) / "psi-entries")))
CURRENT = "current.json"

KEEP_DAYS = int(os.getenv("HUB_PSI_ENTRIES_KEEP_DAYS", "4"))

KEPT = ("Single_Entry_ID", "firstname", "lastname", "peopleId", "Date_of_Service",
        "start_time", "end_time", "check_hours", "Anywhere_status", "WCCode",
        "submittedUser", "Last_Update", "_supervisorId")

# named again rather than derived: this file must refuse on its own
REFUSED = ("Location_Name", "latitude", "longitude", "consumers", "_consumers",
           "_consumer_meta", "Number_Consumers_Present", "comments", "raw", "keyTimes",
           "address", "house")

_HOLDS = sorted(set(KEPT) & set(REFUSED))
if _HOLDS:
    raise RuntimeError("psi_entries: a staff-hours record may never carry client data — "
                       + ", ".join(_HOLDS))

_LOCK = threading.Lock()
_US_DAY = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})")
_ISO_DAY = re.compile(r"^\s*(\d{4})-(\d{2})-(\d{2})")


def service_day(raw: Any) -> str:
    text = str(raw or "")
    try:
        m = _US_DAY.match(text)
        if m:
            return date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat()
        m = _ISO_DAY.match(text)
        if m:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
    except ValueError:
        return ""
    return ""


def keep(row: dict) -> dict:
    return {k: row.get(k) for k in KEPT if row.get(k) not in (None, "")}


def _now_iso(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read_json(name: str) -> dict:
    try:
        return psi_store.get(ENTRY_DIR, name)
    except (OSError, ValueError) as exc:
        log.warning("psi entries: %s could not be read (%s) — treated as holding nothing, "
                    "and not overwritten", name, type(exc).__name__)
        raise


def _write_atomic(name: str, body: Any) -> None:
    psi_store.put(ENTRY_DIR, name, body)


def load(strict: bool = False) -> dict[str, dict]:
    """strict raises on an unreadable record: an unreadable history is not an empty one."""
    with _LOCK:
        try:
            got = _read_json(CURRENT)
        except (OSError, ValueError):
            if strict:
                raise
            return {}
        recs = got.get("entries") if isinstance(got.get("entries"), dict) else {}
        return {str(k): v for k, v in recs.items() if isinstance(v, dict)}


def upsert(rows: Iterable[dict], now: datetime | None = None) -> dict[str, int]:
    stamp = _now_iso(now)
    counts = {"added": 0, "changed": 0, "same": 0, "keyless": 0}
    with _LOCK:
        try:
            got = _read_json(CURRENT)
        except (OSError, ValueError):
            # never write over an unreadable history: it would lose every entry it held
            counts["unwritten"] = 1
            return counts
        recs = got.get("entries") if isinstance(got.get("entries"), dict) else {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            key = str(row.get("Single_Entry_ID") or "").strip()
            if not key:
                counts["keyless"] += 1
                continue
            entry = keep(row)
            held = recs.get(key)
            # changed_at, not last_seen, is the house's sync stamp: last_seen moves on every read
            if held is None:
                recs[key] = {"entry": entry, "day": service_day(entry.get("Date_of_Service")),
                             "first_seen": stamp, "last_seen": stamp, "changed_at": stamp}
                counts["added"] += 1
            elif held.get("entry") != entry:
                held.update(entry=entry, day=service_day(entry.get("Date_of_Service")),
                            last_seen=stamp, changed_at=stamp)
                counts["changed"] += 1
            else:
                held["last_seen"] = stamp
                counts["same"] += 1
        got["entries"] = recs
        got["updated_at"] = stamp
        _rotate(got, now or datetime.now(timezone.utc))
        try:
            _write_atomic(CURRENT, got)
        except OSError as exc:
            log.warning("psi entries: current.json could not be written (%s: %s)",
                        type(exc).__name__, exc)
            counts["unwritten"] = 1
    return counts


def _rotate(got: dict, now: datetime) -> None:
    """The round is written before current.json drops its entries; readers key by id, so a crash costs nothing."""
    cut = (now.astimezone(timezone.utc).date() - timedelta(days=KEEP_DAYS)).isoformat()
    recs = got.get("entries") or {}
    old = {k: v for k, v in recs.items() if (v.get("day") or "9999") < cut}
    if not old:
        return
    name = f"round-{now.astimezone(timezone.utc):%Y%m%dT%H%M%SZ}.json"
    try:
        _write_atomic(name, {"entries": old, "rotated_at": _now_iso(now)})
    except OSError as exc:
        log.warning("psi entries: a round could not be written (%s) — the entries stay in "
                    "current.json", type(exc).__name__)
        return
    for k in old:
        recs.pop(k, None)
    log.info("psi entries: %s entr(y/ies) older than %s moved to %s", len(old), cut, name)


def everything() -> dict[str, dict]:
    out: dict[str, dict] = {}
    with _LOCK:
        try:
            rounds = psi_store.names(ENTRY_DIR, "round-")
        except OSError as exc:
            log.warning("psi entries: the rounds could not be listed (%s) — skipped", type(exc).__name__)
            rounds = []
        for name in rounds:
            try:
                got = psi_store.get(ENTRY_DIR, name)
            except (OSError, ValueError) as exc:
                log.warning("psi entries: %s could not be read (%s) — skipped", name,
                            type(exc).__name__)
                continue
            for k, v in (got.get("entries") or {}).items():
                if isinstance(v, dict) and (k not in out or str(v.get("last_seen") or "")
                                            >= str(out[k].get("last_seen") or "")):
                    out[str(k)] = v
    for k, v in load().items():
        if k not in out or str(v.get("last_seen") or "") >= str(out[k].get("last_seen") or ""):
            out[k] = v
    return out


def between(day_from: date, day_to: date, strict: bool = False) -> list[dict]:
    lo, hi = day_from.isoformat(), day_to.isoformat()
    return [dict(v.get("entry") or {}) for v in load(strict).values()
            if lo <= str(v.get("day") or "") <= hi]


def summary() -> dict[str, Any]:
    recs = everything()
    return {"rows": len(recs),
            "newest": max((str(v.get("changed_at") or v.get("last_seen") or "")
                           for v in recs.values()), default="")}
