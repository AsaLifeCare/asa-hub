"""Every PsiAnywhere field per time entry, client data included, for its own house only; the files stay 0700/0600."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import psi_punches_feed as feed

log = logging.getLogger("hub.psi_full")

FULL_DIR = Path(os.getenv(
    "HUB_PSI_FULL_DIR",
    str(Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) / "psi-full")))
LIVE_FILE = "live.json"
ROWS_FILE = "rows.json"
FEED_FILE = "feed.json"

STORED_TABLE = "asa_psi_time_entries"
SOURCE_STORED = "asa_psi_time_entries"
SOURCE_LIVE = "psianywhere_live"
SOURCE_BOTH = SOURCE_LIVE + "+" + SOURCE_STORED

TAB = "psi_punches_full"
ACTION = "psiPunchesFullIngest"

# PSI_PUNCHES_FULL_CAP in PsiPunches.gs.
DOOR_CAP = 600
LIVE_BATCH = max(1, min(DOOR_CAP, int(os.getenv("HUB_PSI_FULL_LIVE_BATCH", "300"))))
BACKFILL_BATCH = max(1, min(DOOR_CAP, int(os.getenv("HUB_PSI_FULL_BATCH", "500"))))
REVERIFY_S = float(os.getenv("HUB_PSI_FULL_REVERIFY_S", str(7 * 24 * 3600)))
# A door that answered "not here" is asked again only after this.
HOLD_S = float(os.getenv("HUB_PSI_FULL_HOLD_S", str(2 * 3600)))
# PSI_PUNCHES_FULL_TEXT_CAP in PsiPunches.gs.
TEXT_CAP = 5000

# A fourth client or later rides `extra_json` rather than vanish.
CONSUMER_SLOTS = 3
CONSUMER_META = (("consumerid", "id"),
                 ("evvReasonCode", "evv_reason_code"), ("hasSignature", "has_signature"),
                 ("hasNote", "has_note"), ("isDocumented", "is_documented"))
_META_KEYS = frozenset(k for k, _col in CONSUMER_META)
_CONSUMER_COLS = [f"consumer_{i}{suffix}" for i in range(1, CONSUMER_SLOTS + 1)
                  for suffix in [""] + [f"_{col}" for _k, col in CONSUMER_META]]

# Adding a column: push and publish PsiPunches.gs BEFORE restarting the relay, or the door drops it silently.
FIELDS = [
    "single_entry_id", "status",
    "employee", "firstname", "lastname", "people_id", "user_id",
    "date_service", "start_time", "end_time", "hours",
    "work_code", "work_code_id", "supervisor_id",
    "submitted_user", "submit_date", "approved_user", "approved_time",
    "rejected_user", "rejected_time", "last_update",
    "transportation_units", "key_times",
    "location_name", "house", "latitude", "longitude",
    "consumers_present", "consumers",
    *_CONSUMER_COLS,
    "has_signature", "is_documented", "evv_reasons",
    "comments",
    "extra_json",
    "source", "source_synced_at", "live_first_seen",
]
DOOR_AUTHORED = ("id", "createdAt", "updatedAt", "date_iso", "tenant")
_DAY_AT = FIELDS.index("date_service") + 1
HEADER = ["id", "createdAt", "updatedAt"] + FIELDS[:_DAY_AT] + ["date_iso"] + FIELDS[_DAY_AT:] + ["tenant"]

# Dates, times and hours use the stored copy's spellings so both sources read alike.
_MAP: dict[str, tuple[str, str]] = {
    "Single_Entry_ID": ("single_entry_id", "text"),
    "Anywhere_status": ("status", "text"),
    "firstname": ("firstname", "text"),
    "lastname": ("lastname", "text"),
    "peopleId": ("people_id", "text"),
    "userId": ("user_id", "text"),
    "Date_of_Service": ("date_service", "day"),
    "start_time": ("start_time", "clock"),
    "end_time": ("end_time", "clock"),
    "check_hours": ("hours", "hours"),
    "WCCode": ("work_code", "text"),
    "workCodeId": ("work_code_id", "text"),
    "_supervisorId": ("supervisor_id", "text"),
    "submittedUser": ("submitted_user", "text"),
    "submit_date": ("submit_date", "text"),
    "approvedUser": ("approved_user", "text"),
    "approved_time": ("approved_time", "text"),
    "rejectedUser": ("rejected_user", "text"),
    "rejected_time": ("rejected_time", "text"),
    "Last_Update": ("last_update", "text"),
    "transportation_units": ("transportation_units", "text"),
    "keyTimes": ("key_times", "text"),
    "Location_Name": ("location_name", "text"),
    "latitude": ("latitude", "text"),
    "longitude": ("longitude", "text"),
    "Number_Consumers_Present": ("consumers_present", "text"),
    "comments": ("comments", "text"),
}
_NESTED = ("_consumers", "_consumer_meta")

STORED_COLUMNS = ("single_entry_id", "status", "employee", "people_id", "date_service",
                  "start_time", "end_time", "hours", "address", "house", "work_code",
                  "consumers", "num_consumers", "supervisor_id", "comments", "submitted_user",
                  "latitude", "longitude", "raw", "synced_at", "has_signature", "is_documented",
                  "evv_reasons")

_LOCK = threading.Lock()
_STORED: dict[str, Any] = {"probe": None, "rows": []}
_WRITTEN: dict[str, str] = {"digest": ""}


# ── the shape ──────────────────────────────────────────────────────────────

def _text(v: Any) -> str:
    return feed._text(v, TEXT_CAP)


def _spell(v: Any, how: str) -> str:
    if how == "day":
        return feed._us_day(v)
    if how == "clock":
        return feed._ampm(v)
    if how == "hours":
        return feed._hours(v)
    return _text(v)


def _blank() -> dict[str, str]:
    return {f: "" for f in FIELDS}


def flatten(payload: dict) -> dict[str, str]:
    """One entry payload → every column; unnamed fields ride `extra_json`, sorted for a stable fingerprint."""
    out = _blank()
    extra: dict[str, Any] = {}
    for k, v in (payload or {}).items():
        if k in _MAP:
            col, how = _MAP[k]
            out[col] = _spell(v, how)
        elif k not in _NESTED:
            extra[str(k)] = v
    names_raw = payload.get("_consumers") if isinstance(payload, dict) else None
    names = [_text(c) for c in names_raw if _text(c)] if isinstance(names_raw, list) else []
    meta_raw = payload.get("_consumer_meta") if isinstance(payload, dict) else None
    meta = [m for m in meta_raw if isinstance(m, dict)] if isinstance(meta_raw, list) else []
    for i in range(CONSUMER_SLOTS):
        if i < len(names):
            out[f"consumer_{i + 1}"] = names[i]
        if i < len(meta):
            for key, col in CONSUMER_META:
                out[f"consumer_{i + 1}_{col}"] = _text(meta[i].get(key))
    if len(names) > CONSUMER_SLOTS:
        extra["_consumers_more"] = names[CONSUMER_SLOTS:]
    if len(meta) > CONSUMER_SLOTS:
        extra["_consumer_meta_more"] = meta[CONSUMER_SLOTS:]
    other = [{k: v for k, v in m.items() if k not in _META_KEYS} for m in meta[:CONSUMER_SLOTS]]
    if any(other):
        extra["_consumer_meta_other"] = other
    out["consumers"] = _text("; ".join(names))
    out["employee"] = _text(f"{out['firstname']} {out['lastname']}")
    out["extra_json"] = (_text(json.dumps(extra, sort_keys=True, default=str, separators=(",", ":")))
                         if extra else "")
    return out


def project_stored(row: dict) -> dict[str, str] | None:
    """One stored-copy row → the full line (payload first, then its own columns), or None without a key."""
    raw = row.get("raw")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = None
    out = flatten(raw) if isinstance(raw, dict) else _blank()
    fill = {
        "single_entry_id": _text(row.get("single_entry_id")),
        "status": _text(row.get("status")),
        "employee": _text(row.get("employee")),
        "people_id": _text(row.get("people_id")),
        "date_service": _text(row.get("date_service")),
        "start_time": _text(row.get("start_time")),
        "end_time": _text(row.get("end_time")),
        "hours": feed._hours(row.get("hours")),
        "work_code": _text(row.get("work_code")),
        "supervisor_id": _text(row.get("supervisor_id")),
        "comments": _text(row.get("comments")),
        "submitted_user": _text(row.get("submitted_user")),
        "latitude": _text(row.get("latitude")),
        "longitude": _text(row.get("longitude")),
        # `address` is Location_Name and `num_consumers` is Number_Consumers_Present.
        "location_name": _text(row.get("address")),
        "consumers_present": _text(row.get("num_consumers")),
        "consumers": _text(row.get("consumers")),
    }
    for col, v in fill.items():
        if not out[col] and v:
            out[col] = v
    if not out["single_entry_id"]:
        return None
    # Only the stored copy has these.
    out["house"] = _text(row.get("house"))
    out["has_signature"] = feed._flag(row.get("has_signature"))
    out["is_documented"] = feed._flag(row.get("is_documented"))
    out["evv_reasons"] = _text(row.get("evv_reasons"))
    out["source"] = SOURCE_STORED
    out["source_synced_at"] = feed._stamp(row.get("synced_at"))
    return out


def _yes(v: Any) -> bool:
    return str(v).strip().lower() in ("y", "yes", "true", "1")


def visit_flags(meta: list[dict]) -> dict[str, str]:
    """Per-client attestation folded to the visit (ANY client counts); no client is blank, never `false`."""
    meta = [m for m in (meta or []) if isinstance(m, dict)]
    if not meta:
        return {"has_signature": "", "is_documented": "", "evv_reasons": ""}
    return {"has_signature": feed._flag(any(_yes(m.get("hasSignature")) for m in meta)),
            "is_documented": feed._flag(any(_yes(m.get("isDocumented")) for m in meta)),
            "evv_reasons": _text(", ".join(sorted({_text(m.get("evvReasonCode")) for m in meta
                                                   if _text(m.get("evvReasonCode"))})))}


def project_live(rec: dict, answer: dict | None = None) -> dict[str, str] | None:
    """One kept live record → the full line, with the consumers call's `answer` laid on it."""
    entry = (rec or {}).get("entry") or {}
    if not isinstance(entry, dict):
        return None
    names = list((answer or {}).get("names") or [])
    meta = list((answer or {}).get("meta") or [])
    if names:
        entry = dict(entry, _consumers=names, _consumer_meta=meta)
    out = flatten(entry)
    if not out["single_entry_id"]:
        return None
    if names:
        out.update(visit_flags(meta))
    out["source"] = SOURCE_LIVE
    # When the entry last changed, never when it was last read (that would rewrite every row).
    out["source_synced_at"] = _text((rec or {}).get("changed_at") or (rec or {}).get("first_seen"))
    out["live_first_seen"] = _text((rec or {}).get("first_seen"))
    return out


def union(stored: Iterable[dict], live: Iterable[dict]) -> list[dict]:
    """One row per Single_Entry_ID, live winning field by field; key order keeps batch positions stable."""
    by: dict[str, dict] = {}
    for r in stored:
        if r and r.get("single_entry_id"):
            by[r["single_entry_id"]] = dict(r)
    for r in live:
        if not r or not r.get("single_entry_id"):
            continue
        k = r["single_entry_id"]
        old = by.get(k)
        if old is None:
            by[k] = dict(r)
            continue
        merged = dict(old)
        merged.update({f: v for f, v in r.items() if v != "" and f != "source"})
        merged["source"] = SOURCE_BOTH if old.get("source") == SOURCE_STORED else r["source"]
        by[k] = merged
    return [by[k] for k in sorted(by, key=feed._order)]


def fingerprints(rows: Iterable[dict]) -> dict[str, str]:
    """Single_Entry_ID → a fingerprint of every column the relay sends."""
    return {r["single_entry_id"]: hashlib.sha1(json.dumps([r.get(k, "") for k in FIELDS])
                                               .encode()).hexdigest() for r in rows}


# ── the files, locked ──────────────────────────────────────────────────────

def _tighten() -> None:
    """The directory, 0700 — made so, and made so again on every write."""
    FULL_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(FULL_DIR, 0o700)


def _read(name: str) -> dict:
    """A file of this directory, or {} when absent; raises when present but unreadable."""
    try:
        got = json.loads((FULL_DIR / name).read_text(encoding="utf-8") or "{}")
    except FileNotFoundError:
        return {}
    return got if isinstance(got, dict) else {}


def _write(name: str, body: Any) -> None:
    """Atomically, 0600, in the 0700 directory."""
    _tighten()
    path = FULL_DIR / name
    tmp = path.with_name(path.name + ".tmp")
    data = json.dumps(body, separators=(",", ":"), default=str).encode("utf-8")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as fh:
            fd = -1
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
    finally:
        if fd >= 0:
            os.close(fd)
    os.replace(tmp, path)


def _now_iso(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── the live half ──────────────────────────────────────────────────────────

def record_live(rows: Iterable[dict], now: datetime | None = None) -> dict[str, int]:
    """Keeps one collection's entries in live.json by Single_Entry_ID; `changed_at` moves only when a field did."""
    stamp = _now_iso(now)
    counts = {"added": 0, "changed": 0, "same": 0, "keyless": 0}
    with _LOCK:
        try:
            got = _read(LIVE_FILE)
        except (OSError, ValueError) as exc:
            log.warning("psi full: %s could not be read (%s) — not overwritten; this read is not "
                        "kept here", LIVE_FILE, type(exc).__name__)
            counts["unwritten"] = 1
            return counts
        recs = got.get("entries") if isinstance(got.get("entries"), dict) else {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            key = _text(row.get("Single_Entry_ID"))
            if not key:
                counts["keyless"] += 1
                continue
            entry = json.loads(json.dumps(row, default=str))
            held = recs.get(key)
            if not isinstance(held, dict):
                recs[key] = {"entry": entry, "first_seen": stamp, "last_seen": stamp,
                             "changed_at": stamp}
                counts["added"] += 1
            elif held.get("entry") != entry:
                held.update(entry=entry, last_seen=stamp, changed_at=stamp)
                counts["changed"] += 1
            else:
                held["last_seen"] = stamp
                counts["same"] += 1
        got["entries"] = recs
        got["updated_at"] = stamp
        try:
            _write(LIVE_FILE, got)
        except OSError as exc:
            log.warning("psi full: %s could not be written (%s: %s)", LIVE_FILE,
                        type(exc).__name__, exc)
            counts["unwritten"] = 1
    return counts


def _answers() -> dict[str, dict]:
    """The consumers call's answers by Single_Entry_ID, or {} when unreadable."""
    try:
        import psi_consumers  # noqa: PLC0415
        return psi_consumers.answers()
    except Exception as exc:  # noqa: BLE001
        log.info("psi full: the clients present could not be read (%s)", type(exc).__name__)
        return {}


def live_rows() -> list[dict]:
    """Every entry the lane has read as full lines, live.json winning over the staff-hours history."""
    by: dict[str, dict] = {}
    answers = _answers()
    try:
        import psi_entries  # noqa: PLC0415
        for key, rec in psi_entries.everything().items():
            r = project_live(rec, answers.get(str(key)))
            if r is not None:
                by[r["single_entry_id"]] = r
    except Exception as exc:  # noqa: BLE001 — the full reads still stand on their own
        log.info("psi full: the staff-hours history could not be read (%s)", type(exc).__name__)
    with _LOCK:
        got = _read(LIVE_FILE)
    for key, rec in (got.get("entries") or {}).items():
        r = project_live(rec, answers.get(str(key)))
        if r is None:
            continue
        old = by.get(r["single_entry_id"])
        if old is not None:
            r = dict(old, **{f: v for f, v in r.items() if v != ""})
        by[r["single_entry_id"]] = r
    return list(by.values())


def live_entries() -> dict[str, dict]:
    """Single_Entry_ID → the raw entry as last read; raises when live.json exists but cannot be read."""
    by: dict[str, dict] = {}
    try:
        import psi_entries  # noqa: PLC0415
        for rec in psi_entries.everything().values():
            entry = rec.get("entry") if isinstance(rec, dict) else None
            key = _text((entry or {}).get("Single_Entry_ID")) if isinstance(entry, dict) else ""
            if key:
                by[key] = dict(entry)
    except Exception as exc:  # noqa: BLE001 — the full reads still stand on their own
        log.info("psi full: the staff-hours history could not be read (%s)", type(exc).__name__)
    with _LOCK:
        got = _read(LIVE_FILE)
    for rec in (got.get("entries") or {}).values():
        entry = rec.get("entry") if isinstance(rec, dict) else None
        key = _text((entry or {}).get("Single_Entry_ID")) if isinstance(entry, dict) else ""
        if key:
            by[key] = dict(by.get(key) or {}, **entry)
    return by


def named_by_stored_copy() -> set[str]:
    """Entries the stored copy already names clients for, from this process's last read; never queries."""
    return {r["single_entry_id"] for r in _STORED.get("rows") or [] if r.get("consumers")}


# ── the stored half ────────────────────────────────────────────────────────

def stored_rows(dsn: str) -> list[dict]:
    """The stored copy, re-read only when its count or newest stamp moved."""
    import psycopg2  # noqa: PLC0415
    import psycopg2.extras  # noqa: PLC0415
    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"SELECT count(*), max(synced_at) FROM public.{STORED_TABLE}")  # noqa: S608
        got = cur.fetchone() or (0, None)
    probe = [int(got[0] or 0), feed._stamp(got[1])]
    if probe == _STORED["probe"]:
        return list(_STORED["rows"])
    with psycopg2.connect(dsn) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT " + ", ".join(STORED_COLUMNS)  # noqa: S608
                    + f" FROM public.{STORED_TABLE} ORDER BY single_entry_id")
        raw = cur.fetchall()
    rows = [r for r in (project_stored(dict(x)) for x in raw) if r is not None]
    _STORED.update(probe=probe, rows=rows)
    return list(rows)


def build(dsn: str, now: datetime | None = None) -> dict[str, Any]:
    """Writes the union to rows.json when it changed and returns it for the feed."""
    stored = stored_rows(dsn)
    live = live_rows()
    rows = union(stored, live)
    digest = hashlib.sha1(json.dumps([[r.get(k, "") for k in FIELDS] for r in rows])
                          .encode()).hexdigest()
    if digest != _WRITTEN["digest"] or not (FULL_DIR / ROWS_FILE).exists():
        with _LOCK:
            _write(ROWS_FILE, {"generated_at": _now_iso(now), "header": HEADER,
                               "digest": digest, "rows": rows})
        _WRITTEN["digest"] = digest
    stored_ids = {r["single_entry_id"] for r in stored}
    return {"rows": rows, "digest": digest, "stored": len(stored), "live": len(live),
            "live_new": len({r["single_entry_id"] for r in live} - stored_ids)}


# ── the feed ───────────────────────────────────────────────────────────────

def _feed_state() -> dict[str, Any]:
    with _LOCK:
        try:
            got = _read(FEED_FILE)
        except (OSError, ValueError) as exc:
            log.warning("psi full: %s could not be read (%s) — the sheet is re-verified from the "
                        "start", FEED_FILE, type(exc).__name__)
            got = {}
    return {"handed": dict(got.get("handed") or {}) if isinstance(got.get("handed"), dict) else {},
            "full_at": float(got.get("full_at") or 0.0),
            "reverify_from": float(got.get("reverify_from") or 0.0),
            "hold_until": float(got.get("hold_until") or 0.0),
            "hold_why": str(got.get("hold_why") or ""),
            "last": dict(got.get("last") or {}) if isinstance(got.get("last"), dict) else {}}


def _feed_save(state: dict[str, Any]) -> None:
    with _LOCK:
        _write(FEED_FILE, state)


def plan(rows: list[dict], state: dict[str, Any], reason: str, now_ts: float
         ) -> tuple[list[dict], str, int]:
    """(batch, kind, pending): changed live rows first on every pass; backfill only on the hourly pass. Pure."""
    prints = fingerprints(rows)
    handed = state.get("handed") or {}
    pending = [r for r in rows if handed.get(r["single_entry_id"]) != prints[r["single_entry_id"]]]
    live = [r for r in pending if str(r.get("source") or "").startswith(SOURCE_LIVE)]
    if live:
        newest = sorted(live, key=lambda r: feed._order(r["single_entry_id"]), reverse=True)
        return newest[:LIVE_BATCH], "live", len(pending)
    if reason == "hourly" and pending:
        return pending[:BACKFILL_BATCH], "backfill", len(pending)
    return [], "", len(pending)


def next_pass(dsn: str, reason: str, now_ts: float | None = None) -> dict[str, Any] | None:
    """The one pass this beat may make, or None; `reason` is `collection` or `hourly`."""
    now_ts = time_now() if now_ts is None else now_ts
    state = _feed_state()
    if now_ts < state["hold_until"]:
        return None
    if (reason == "hourly" and state["full_at"] and not state["reverify_from"]
            and now_ts - state["full_at"] >= REVERIFY_S):
        # Weekly re-verification: unchanged rows cost the door no write.
        state.update(handed={}, reverify_from=now_ts)
        _feed_save(state)
        log.info("psi full: the weekly re-verification of the full punch sheet begins")
    got = build(dsn, datetime.fromtimestamp(now_ts, timezone.utc))
    rows = got["rows"]
    if not rows:
        log.warning("psi full: the record read back empty — nothing handed over (it only grows)")
        return None
    batch, kind, pending = plan(rows, state, reason, now_ts)
    if not batch:
        if not pending and (not state["full_at"] or state["reverify_from"]):
            state.update(full_at=now_ts, reverify_from=0.0)
            _feed_save(state)
        return None
    prints = fingerprints(batch)
    return {"batch": batch, "prints": prints, "kind": kind, "pending": pending,
            "total": len(rows), "reason": reason, "stored": got["stored"], "live": got["live"],
            "live_new": got["live_new"]}


def _not_there(env: dict) -> str:
    """Why the door is not there (409 missing_tab, 404, 403), or '' when it is."""
    status = env.get("status")
    data = env.get("data") if isinstance(env.get("data"), dict) else {}
    msg = str(env.get("message") or "")
    if status == 409 and data.get("missing_tab"):
        return f"the {TAB} house is not declared — {msg[:160]}"
    if status in (403, 404) or "unknown action" in msg.lower():
        return f"{ACTION} answered {status} — {msg[:160]} (not pushed, or not published yet)"
    return ""


def _short_of_the_header(data: dict) -> str:
    """'' only when the door's declared header covers every column sent; kept == sent alone proves nothing."""
    if not isinstance(data, dict):
        return f"{ACTION} answered nothing about its header"
    try:
        declared = int(data.get("columns") or 0)
    except (TypeError, ValueError):
        declared = 0
    if not declared:
        return (f"{ACTION} does not say its header — a publish older than these {len(HEADER)} "
                "columns, which would drop the newest ones in silence")
    dropped = [str(x)[:60] for x in (data.get("dropped") or []) if str(x or "").strip()]
    if dropped:
        return (f"{ACTION} declares {declared} column(s) and does not carry "
                f"{len(dropped)}: {', '.join(sorted(dropped)[:8])}")
    if declared < len(HEADER):
        return f"{ACTION} declares {declared} column(s) where the record has {len(HEADER)}"
    return ""


def settle(got: dict[str, Any], env: dict[str, Any], now_ts: float | None = None) -> dict[str, Any]:
    """Records a pass as proved only when taken whole with every column; a missing or older door holds the lane."""
    now_ts = time_now() if now_ts is None else now_ts
    state = _feed_state()
    env = env if isinstance(env, dict) else {}
    data = env.get("data") if isinstance(env.get("data"), dict) else {}
    batch = got.get("batch") or []
    if env.get("status") == 200 and int(data.get("kept") or 0) == len(batch) \
            and not int(data.get("overflow") or 0):
        short = _short_of_the_header(data)
        if short:
            state.update(hold_until=now_ts + HOLD_S, hold_why=short)
            _feed_save(state)
            log.warning("psi full: %s — the pass proves nothing and the feed waits %s hour(s): "
                        "push PsiPunches.gs and have it published in the editor, then these rows go "
                        "again on their own", short, round(HOLD_S / 3600, 1))
            return {"ok": False, "held": True, "why": short}
        state["handed"].update(got.get("prints") or {})
        state.update(hold_until=0.0, hold_why="")
        state["last"] = {"at": now_ts, "kind": got.get("kind"), "rows": len(batch),
                         "inserted": int(data.get("inserted") or 0),
                         "updated": int(data.get("updated") or 0),
                         "unchanged": int(data.get("unchanged") or 0)}
        if int(got.get("pending") or 0) <= len(batch) and (not state["full_at"]
                                                            or state["reverify_from"]):
            state.update(full_at=now_ts, reverify_from=0.0)
        _feed_save(state)
        return {"ok": True, "pending_after": max(0, int(got.get("pending") or 0) - len(batch)),
                **state["last"]}
    why = _not_there(env)
    if why:
        state.update(hold_until=now_ts + HOLD_S, hold_why=why)
        _feed_save(state)
        return {"ok": False, "held": True, "why": why}
    return {"ok": False, "why": str(env.get("message") or env.get("status") or "no answer")[:200]}


def status() -> dict[str, Any]:
    """What the feed has proved and what it waits on — counts and words only."""
    state = _feed_state()
    return {"handed": len(state["handed"]), "full_at": state["full_at"],
            "hold_until": state["hold_until"], "hold_why": state["hold_why"],
            "last": state["last"]}


def time_now() -> float:
    import time  # noqa: PLC0415
    return time.time()


if __name__ == "__main__":  # a read-only probe: counts, never a row
    import sys
    _dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not _dsn:
        sys.exit("HUB_SNAPSHOT_PG_DSN is not set")
    import psycopg2  # noqa: PLC0415
    with psycopg2.connect(_dsn) as _c, _c.cursor() as _cur:
        _cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema = "
                     "'public' AND table_name = %s", (STORED_TABLE,))
        _table_cols = {r[0] for r in _cur.fetchall()}
    _s = stored_rows(_dsn)
    _l = live_rows()
    _u = union(_s, _l)
    print(json.dumps({"stored": len(_s), "live": len(_l), "rows": len(_u),
                      "unselected_columns": sorted(_table_cols - set(STORED_COLUMNS)),
                      "columns": len(HEADER),
                      "batches_backfill": -(-len(_u) // BACKFILL_BATCH),
                      "extra_json_rows": sum(1 for r in _u if r["extra_json"]),
                      "with_consumers": sum(1 for r in _u if r["consumers"]),
                      "with_consumer_ids": sum(1 for r in _u if r["consumer_1_id"]),
                      "live_without_consumers": sum(1 for r in _l if not r["consumers"]
                                                    and r["consumers_present"] != "0")},
                     indent=2))
