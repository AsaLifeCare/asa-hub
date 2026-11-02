"""THE PHONE'S TEXTS, KEPT ON OUR OWN DISK BEFORE ANYBODY ELSE HEARS OF THEM.
THE ORDER: the JSON runs and updates first, then the slices, then the sheets if they are needed — the JSON…"""
from __future__ import annotations

import base64
import gzip
import hashlib
import json
import logging
import os
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo

log = logging.getLogger("hub.quo_inbox")

# THE DAY A LINE BELONGS TO is the Ohio day it ARRIVED on, not the day the message was written: the backfill of a…
OHIO = ZoneInfo("America/New_York")
UTC = timezone.utc

INBOX_DIR = Path(os.getenv(
    "HUB_QUO_INBOX_DIR",
    str(Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) / "quo-inbox")))
# THE DOT IS THE POINT.
STATE_FILE = INBOX_DIR / ".state.json"

# How long a zipped day is kept.
KEEP_DAYS = int(os.getenv("HUB_QUO_INBOX_KEEP_DAYS", "60"))

# THE MESSAGES WEBHOOK'S SIGNING KEY, held by this relay and never by Props.gs: base64, exactly as Quo returns it…
MESSAGES_KEY_FILE = Path(os.getenv("HUB_QUO_MESSAGES_KEY_FILE",
                                   "/srv/secrets/quo-messages-webhook.key"))
# Quo stamps every delivery and every retry afresh: an older stamp is a replay.
FRESH_S = 300.0

# The most events one hand-off carries.
BATCH_MAX = 25
# An event Apps Script refused waits RETRY_BASE_S, then twice that, and so on up to RETRY_CAP_S, before it is…
RETRY_BASE_S = 60.0
RETRY_CAP_S = 3600.0
# Past this many refusals every further one is a warning naming the event.
LOUD_AFTER_TRIES = 20
# A batch that failed whole (transport, timeout, a 5xx) or a door that refused it whole stands the hand-off down…
PAUSE_S = 600.0

_LOCK = threading.RLock()
_DAYS: dict[str, list[dict]] = {}      # the open days, lines in arrival order
_INDEX: dict[str, str] = {}            # "id|type" -> the day it arrived on
_ZIPPED: set[str] = set()
_STATE: dict[str, Any] = {}
_LOADED = {"yes": False}
_HANDOFF: dict[str, Any] = {"paused_until": 0.0, "size": BATCH_MAX}
_KEY_LOCK = threading.Lock()
_KEYS: dict[str, Any] = {"stamp": None, "keys": [], "words": 0, "said": None}
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_COUNTERS = ("webhook_added", "pull_added", "backfill_added", "duplicates", "invalid", "filed",
             "already", "failed", "batches", "batch_failures", "batch_refusals", "zipped_days")


# ── small things ───────────────────────────────────────────────────────────

def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _ts(iso: Any) -> float | None:
    try:
        when = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    return when.timestamp()


def day_of(ts: float) -> str:
    return datetime.fromtimestamp(ts, OHIO).date().isoformat()


def _k(ident: str, kind: str) -> str:
    return f"{ident}|{kind}"


def _plain(day: str) -> Path:
    return INBOX_DIR / f"{day}.jsonl"


def _zipped(day: str) -> Path:
    return INBOX_DIR / f"{day}.jsonl.gz"


def _encode(line: dict) -> bytes:
    # json escapes every newline inside a string, so one line is one record
    return json.dumps(line, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"


def _fsync_dir(path: Path) -> None:
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def _write_atomic(path: Path, data: bytes) -> None:
    # 0600 FROM THE FIRST BYTE, whatever the process umask says: the file that replaces a day is the day from then…
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.fchmod(fd, 0o600)
        view = memoryview(data)
        while view:
            view = view[os.write(fd, view):]
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(tmp, path)
    _fsync_dir(path.parent)


def _private_dir() -> None:
    """The inbox directory, 0700, and every file already in it 0600."""
    INBOX_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        os.chmod(INBOX_DIR, 0o700)
    except OSError as exc:
        log.warning("quo inbox: the directory could not be made private (%s)", type(exc).__name__)
    for path in INBOX_DIR.iterdir():
        try:
            st = path.lstat()
            if path.is_file() and not path.is_symlink() and st.st_mode & 0o077:
                os.chmod(path, 0o600)
        except OSError:
            pass


# A temporary password the platform texted (PasswordReset.gs) belongs to the person it was sent to: the copy kept…
TEMP_PASSWORD_TEXT = re.compile(r"(temporary password is\s+)[A-Za-z0-9]{6,64}", re.IGNORECASE)
WITHHELD = "{withheld}"


def withhold_secrets(event: Any) -> Any:
    """The event with a texted temporary password withheld from its words; the same object when there is none."""
    if not isinstance(event, dict) or not isinstance(event.get("data"), dict):
        return event
    data = event["data"]
    nested = isinstance(data.get("object"), dict)
    obj = data["object"] if nested else data
    changed: dict[str, Any] = {}
    for field in ("text", "body"):
        words = obj.get(field)
        if isinstance(words, str):
            kept = TEMP_PASSWORD_TEXT.sub(lambda m: m.group(1) + WITHHELD, words)
            if kept != words:
                changed[field] = kept
    if not changed:
        return event
    obj = {**obj, **changed}
    return {**event, "data": ({**data, "object": obj} if nested else obj)}


def event_key(event: Any) -> tuple[str, str] | None:
    """(id, type) of a webhook-shaped event; None when it names neither."""
    if not isinstance(event, dict):
        return None
    kind = str(event.get("type") or "").strip()
    data = event.get("data")
    obj = data.get("object") if isinstance(data, dict) else None
    if not isinstance(obj, dict):
        obj = data if isinstance(data, dict) else {}
    first = ("callId", "id") if kind.startswith("call.") else ("id",)
    ident = ""
    for field in first:
        ident = str(obj.get(field) or "").strip()
        if ident:
            break
    if not kind or not ident or len(kind) > 80 or len(ident) > 200 or "|" in ident:
        return None
    return ident, kind


def _parse(raw: bytes) -> dict | None:
    try:
        line = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(line, dict) or not isinstance(line.get("event"), dict):
        return None
    if not str(line.get("id") or "") or not str(line.get("type") or ""):
        return None
    try:
        line["tries"] = int(line.get("tries") or 0)
    except (TypeError, ValueError):
        line["tries"] = 0
    for field in ("drained_at", "last_error", "retry_at", "outcome"):
        line.setdefault(field, None)
    line["recheck"] = bool(line.get("recheck"))
    return line


def _backoff_s(tries: int) -> float:
    return min(RETRY_CAP_S, RETRY_BASE_S * (2 ** max(0, tries - 1)))


# ── loading ────────────────────────────────────────────────────────────────

def _load() -> None:
    """Read the kept days once per process. Caller holds _LOCK."""
    if _LOADED["yes"]:
        return
    _private_dir()
    days: dict[str, list[dict]] = {}
    index: dict[str, str] = {}
    zipped: set[str] = set()
    for path in sorted(INBOX_DIR.glob("*.jsonl.gz")):
        day = path.name[: -len(".jsonl.gz")]
        if not _DAY_RE.match(day):
            continue
        try:
            with gzip.open(path, "rb") as fh:
                for raw in fh:
                    line = _parse(raw)
                    if line is not None:
                        index.setdefault(_k(line["id"], line["type"]), day)
            zipped.add(day)
        except (OSError, EOFError, ValueError) as exc:
            # Its keys are unknown, so a message in it may be kept once more; the sheet's own duplicate check still…
            log.warning("quo inbox: the archive %s could not be read (%s) — kept as it is",
                        path.name, type(exc).__name__)
    for path in sorted(INBOX_DIR.glob("*.jsonl")):
        day = path.name[: -len(".jsonl")]
        if not _DAY_RE.match(day):
            continue
        try:
            raw_all = path.read_bytes()
        except OSError as exc:
            # An open day that cannot be read is not an empty one: stop here rather than write over it with nothing.
            raise RuntimeError(f"quo inbox: {path.name} could not be read ({type(exc).__name__})") from exc
        lines, dropped, seen = [], 0, set()
        for raw in raw_all.split(b"\n"):
            if not raw.strip():
                continue
            line = _parse(raw)
            if line is None:
                dropped += 1
                continue
            k = _k(line["id"], line["type"])
            if k in seen:
                dropped += 1
                continue
            seen.add(k)
            index[k] = day
            lines.append(line)
        days[day] = lines
        if dropped or (raw_all and not raw_all.endswith(b"\n")):
            log.warning("quo inbox: %s held %s unreadable line(s) — rewritten without them",
                        path.name, dropped)
            _write_atomic(path, b"".join(_encode(x) for x in lines))
    _DAYS.clear()
    _DAYS.update(days)
    _INDEX.clear()
    _INDEX.update(index)
    _ZIPPED.clear()
    _ZIPPED.update(zipped - set(days))
    _STATE.clear()
    _STATE.update(_read_state())
    _LOADED["yes"] = True
    _resume_in_flight()


def _resume_in_flight() -> None:
    """A BATCH THIS RELAY POSTED AND NEVER HEARD ANSWERED."""
    flight = _STATE.get("in_flight")
    if not flight:
        return
    until = _ts(flight.get("until")) or 0.0
    _HANDOFF["paused_until"] = max(float(_HANDOFF["paused_until"]), until)
    marked: set[str] = set()
    for k in flight.get("keys") or []:
        line, day = _find(str(k))
        if line is not None and not line.get("drained_at") and not line.get("recheck"):
            line["recheck"] = True
            marked.add(day)
    for day in marked:
        try:
            _write_atomic(_plain(day), b"".join(_encode(x) for x in _DAYS.get(day, [])))
        except OSError as exc:
            # memory has it, and the mark stays on the disk until a batch answers, so the next load marks them again
            log.warning("quo inbox: %s could not be rewritten (%s)", day, type(exc).__name__)
    log.warning("quo inbox: a batch of %s was in flight when the relay last stopped — the hand-off "
                "waits until %s, and its events are offered as possibly filed",
                len(flight.get("keys") or []), flight.get("until"))


def _read_state() -> dict[str, Any]:
    try:
        got = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        got = {}
    if not isinstance(got, dict):
        got = {}
    cursors = got.get("cursors")
    counters = got.get("counters")
    pull = got.get("pull")
    lines = got.get("lines")
    flight = got.get("in_flight")
    return {
        "cursors": {str(k): str(v) for k, v in cursors.items()} if isinstance(cursors, dict) else {},
        "counters": {c: int((counters or {}).get(c) or 0) if isinstance(counters, dict) else 0
                     for c in _COUNTERS},
        "pull": dict(pull) if isinstance(pull, dict) else {},
        # the pull's memory per line beyond its cursor (quo_pull.py): the threads it owes a read, the sent texts it…
        "lines": {str(k): _line_memo(v) for k, v in lines.items()} if isinstance(lines, dict) else {},
        "in_flight": ({"until": str(flight.get("until") or ""),
                       "keys": [str(k) for k in (flight.get("keys") or []) if k]}
                      if isinstance(flight, dict) else None),
    }


def _line_memo(v: Any) -> dict[str, Any]:
    v = v if isinstance(v, dict) else {}
    owed, watch, calls = v.get("owed"), v.get("watch"), v.get("calls")
    return {"owed": {str(k): dict(x) for k, x in owed.items() if isinstance(x, dict)}
            if isinstance(owed, dict) else {},
            "watch": {str(k): dict(x) for k, x in watch.items() if isinstance(x, dict)}
            if isinstance(watch, dict) else {},
            # the calls whose transcript the pull still asks for, each with the instant it stops
            "calls": {str(k): dict(x) for k, x in calls.items() if isinstance(x, dict)}
            if isinstance(calls, dict) else {},
            "tried": str(v["tried"]) if v.get("tried") else None,
            "fails": int(v.get("fails") or 0) if str(v.get("fails") or "0").isdigit() else 0}


def _save_state(strict: bool = False) -> None:
    """Caller holds _LOCK."""
    try:
        _write_atomic(STATE_FILE, json.dumps(_STATE, sort_keys=True, indent=1).encode("utf-8"))
    except OSError as exc:
        if strict:
            raise
        log.warning("quo inbox: the state file could not be written (%s)", type(exc).__name__)


def _count(name: str, n: int = 1) -> None:
    counters = _STATE.setdefault("counters", {})
    counters[name] = int(counters.get(name) or 0) + n


def prepare() -> dict[str, Any]:
    """Load the kept days at startup, so the first webhook does not pay for it."""
    with _LOCK:
        _load()
        return stats()


def forget() -> None:
    """Drop what memory holds, as a restart would. The disk is untouched."""
    with _LOCK:
        _DAYS.clear()
        _INDEX.clear()
        _ZIPPED.clear()
        _STATE.clear()
        _LOADED["yes"] = False
        _HANDOFF.update(paused_until=0.0, size=BATCH_MAX)


# ── keeping ────────────────────────────────────────────────────────────────

def _append_lines(day: str, lines: list[dict]) -> None:
    """One write, one fsync, then memory. Caller holds _LOCK."""
    path = _plain(day)
    data = b"".join(_encode(x) for x in lines)
    fresh = not path.exists()
    try:
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            view = memoryview(data)
            while view:
                view = view[os.write(fd, view):]
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        # A write that stopped part-way left half a line at the end; put the file back to what memory says it held…
        try:
            _write_atomic(path, b"".join(_encode(x) for x in _DAYS.get(day, [])))
        except OSError:
            pass
        raise
    if fresh:
        _fsync_dir(INBOX_DIR)
    _DAYS.setdefault(day, []).extend(lines)
    _ZIPPED.discard(day)


def append_many(events: Iterable[Any], source: str, now: float | None = None,
                recheck: bool = False) -> dict[str, int]:
    """Keep each event not kept already."""
    now = time.time() if now is None else now
    said = {"added": 0, "duplicate": 0, "invalid": 0}
    with _LOCK:
        _load()
        day = day_of(now)
        fresh: list[dict] = []
        batch: set[str] = set()
        for event in events:
            event = withhold_secrets(event)
            key = event_key(event)
            if key is None:
                said["invalid"] += 1
                continue
            k = _k(*key)
            if k in _INDEX or k in batch:
                said["duplicate"] += 1
                continue
            batch.add(k)
            fresh.append({"id": key[0], "type": key[1], "received_at": _iso(now),
                          "source": str(source), "event": event, "drained_at": None,
                          "tries": 0, "last_error": None, "retry_at": None, "outcome": None,
                          "recheck": bool(recheck)})
        if fresh:
            _append_lines(day, fresh)
            for line in fresh:
                _INDEX[_k(line["id"], line["type"])] = day
        said["added"] = len(fresh)
        if f"{source}_added" in _COUNTERS:
            _count(f"{source}_added", said["added"])
        _count("duplicates", said["duplicate"])
        _count("invalid", said["invalid"])
    return said


def kept(ident: str, kind: str) -> bool:
    """Is (id, type) kept already, in an open day or a zipped one still counted?"""
    with _LOCK:
        _load()
        return _k(str(ident), str(kind)) in _INDEX


def append(event: Any, source: str, now: float | None = None) -> str:
    """added | duplicate | invalid. Raises OSError when nothing could be kept."""
    said = append_many([event], source, now)
    return "added" if said["added"] else "duplicate" if said["duplicate"] else "invalid"


def accept_webhook(raw: bytes, stamp_age_s: float | None,
                   now: float | None = None) -> tuple[int, dict[str, Any]]:
    """One event a webhook key signed: (http status, answer fields)."""
    if stamp_age_s is None or abs(stamp_age_s) > FRESH_S:
        return 401, {"reason": "stale", "message": "Stale."}
    try:
        event = json.loads(bytes(raw).decode("utf-8") or "{}")
    except (UnicodeDecodeError, ValueError):
        return 400, {"message": "Not JSON."}
    said = append(event, "webhook", now)
    if said == "invalid":
        log.warning("quo inbox: a signed event named no message (type %s) — answered and let go",
                    str(event.get("type") if isinstance(event, dict) else type(event).__name__)[:60])
        return 200, {"ignored": "shape"}
    return 200, {"kept": said}


# ── handing over ───────────────────────────────────────────────────────────

def _due(line: dict, now: float) -> bool:
    if line.get("drained_at"):
        return False
    at = _ts(line.get("retry_at")) if line.get("retry_at") else None
    return at is None or now >= at


def pending(now: float | None = None, limit: int | None = None) -> list[dict]:
    """The undrained lines whose wait is over: the fewest refusals first, and among equals the oldest arrival…"""
    now = time.time() if now is None else now
    due: list[tuple[int, int, dict]] = []
    with _LOCK:
        _load()
        limit = int(_HANDOFF["size"]) if limit is None else limit
        order = 0
        for day in sorted(_DAYS):
            for line in _DAYS[day]:
                order += 1
                if _due(line, now):
                    due.append((int(line.get("tries") or 0), order, line))
        due.sort(key=lambda t: (t[0], t[1]))
        return [{"id": line["id"], "type": line["type"], "source": line["source"],
                 "event": line["event"], "tries": line["tries"], "recheck": bool(line.get("recheck"))}
                for _t, _o, line in due[:max(1, int(limit))]]


def backlog() -> int:
    """Undrained lines, waiting or not."""
    with _LOCK:
        _load()
        return sum(1 for lines in _DAYS.values() for x in lines if not x.get("drained_at"))


def ready(now: float | None = None) -> bool:
    """May the hand-off post now, or is it stood down?"""
    now = time.time() if now is None else now
    with _LOCK:
        _load()
        return now >= float(_HANDOFF["paused_until"])


def begin_batch(offered: list[dict], hold_s: float, now: float | None = None) -> None:
    """THE BATCH IS ON ITS WAY — written down BEFORE the post, cleared by after_batch when its answer comes back."""
    now = time.time() if now is None else now
    keys = [_k(str(o.get("id") or ""), str(o.get("type") or "")) for o in offered]
    with _LOCK:
        _load()
        before = _STATE.get("in_flight")
        _STATE["in_flight"] = {"until": _iso(now + float(hold_s)), "keys": keys}
        try:
            _save_state(strict=True)
        except OSError:
            # not on the disk, so not in memory either: a later save of the cursors must not write down a post that…
            _STATE["in_flight"] = before
            raise


def batch_size() -> int:
    with _LOCK:
        return int(_HANDOFF["size"])


def _find(k: str) -> tuple[dict | None, str | None]:
    day = _INDEX.get(k)
    for line in _DAYS.get(day or "", []):
        if _k(line["id"], line["type"]) == k:
            return line, day
    return None, None


def _charge(line: dict, why: str, now: float) -> None:
    line["tries"] = int(line.get("tries") or 0) + 1
    line["last_error"] = str(why)[:300]
    line["retry_at"] = _iso(now + _backoff_s(line["tries"]))
    if line["tries"] >= LOUD_AFTER_TRIES:
        log.warning("quo inbox: %s %s refused %s times, last: %s — KEPT, offered again at %s",
                    line["type"], line["id"], line["tries"], line["last_error"], line["retry_at"])


def classify(env: Any, exc: BaseException | None = None) -> dict[str, Any]:
    """What one quoIngestBatch answer is, as a whole."""
    def said(kind: str, why: str, uncertain: bool, results: list | None = None) -> dict[str, Any]:
        return {"kind": kind, "why": why, "uncertain": uncertain, "results": results or []}
    if exc is not None:
        return said("failed", f"{type(exc).__name__}: {str(exc)[:160]}", True)
    if not isinstance(env, dict):
        return said("failed", "no envelope", True)
    try:
        status = int(env.get("status"))
    except (TypeError, ValueError):
        return said("failed", "an envelope without a status", True)
    message = str(env.get("message") or "")[:160]
    data = env.get("data")
    results = data.get("results") if isinstance(data, dict) else None
    if status == 200 and isinstance(results, list):
        return said("answered", "", False, results)
    if status == 200:
        return said("refused", "an answer without per-event results", True)
    if status >= 500:
        return said("failed", f"{status} {message}".strip(), True)
    return said("refused", f"{status} {message}".strip(), False)


def after_batch(offered: list[dict], env: Any, exc: BaseException | None = None,
                now: float | None = None) -> dict[str, Any]:
    """What one hand-off answer does to the inbox; the relay logs what it returns."""
    now = time.time() if now is None else now
    keys = [_k(str(o.get("id") or ""), str(o.get("type") or "")) for o in offered]
    verdict = classify(env, exc)
    said: dict[str, Any] = {"sent": len(keys), "filed": 0, "already": 0, "failed": 0,
                            "unreached": 0, "verdict": verdict["kind"], "why": verdict["why"]}
    with _LOCK:
        _load()
        touched: set[str] = set()
        if verdict["kind"] == "answered":
            by_key: dict[str, dict] = {}
            for r in verdict["results"]:
                if isinstance(r, dict):
                    by_key.setdefault(_k(str(r.get("id") or ""), str(r.get("type") or "")), r)
            for k in keys:
                line, day = _find(k)
                if line is None or line.get("drained_at"):
                    continue
                r = by_key.get(k)
                if r is None:
                    said["unreached"] += 1
                    continue
                result = str(r.get("result") or "")
                if result in ("filed", "already"):
                    line["drained_at"] = _iso(now)
                    line["outcome"] = result
                    line["retry_at"] = None
                    said[result] += 1
                else:
                    _charge(line, f"{result or 'no result'}: {str(r.get('why') or '')}".strip(), now)
                    # an error may have come after the row landed; a refusal is the handler declining before it…
                    if result != "refused":
                        line["recheck"] = True
                    said["failed"] += 1
                touched.add(day)
            _HANDOFF["size"] = min(BATCH_MAX, max(1, int(_HANDOFF["size"])) * 2)
            _count("batches")
        else:
            _HANDOFF["paused_until"] = now + PAUSE_S
            if verdict["uncertain"]:
                for k in keys:
                    line, day = _find(k)
                    if line is not None and not line.get("drained_at") and not line.get("recheck"):
                        line["recheck"] = True
                        touched.add(day)
            if verdict["kind"] == "failed":
                _count("batch_failures")
                if len(keys) == 1:
                    line, day = _find(keys[0])
                    if line is not None and not line.get("drained_at"):
                        _charge(line, f"the batch failed: {verdict['why']}", now)
                        said["failed"] += 1
                        touched.add(day)
                _HANDOFF["size"] = max(1, len(keys) // 2)
            else:
                _count("batch_refusals")
        for day in touched:
            _write_atomic(_plain(day), b"".join(_encode(x) for x in _DAYS.get(day, [])))
        _count("filed", said["filed"])
        _count("already", said["already"])
        _count("failed", said["failed"])
        # AFTER the days: a mark cleared before the rechecks reached the disk would let a restart re-offer them as…
        _STATE["in_flight"] = None
        _save_state()
        said["left"] = sum(1 for lines in _DAYS.values() for x in lines if not x.get("drained_at"))
        said["next_size"] = int(_HANDOFF["size"])
        said["paused_s"] = max(0, round(float(_HANDOFF["paused_until"]) - now))
    return said


# ── zipping the round ──────────────────────────────────────────────────────

def rotate(now: float | None = None) -> dict[str, int]:
    """Zip every finished day whose lines all drained; forget archives past KEEP_DAYS."""
    now = time.time() if now is None else now
    said = {"zipped": 0, "pruned": 0}
    with _LOCK:
        _load()
        today = day_of(now)
        for day in sorted(_DAYS):
            lines = _DAYS[day]
            if day >= today or any(not x.get("drained_at") for x in lines):
                continue
            try:
                # AN ARCHIVE ALREADY THERE IS MERGED, NEVER REPLACED: a clock that stepped back can reopen a zipped…
                kept, keys = [], set()
                if _zipped(day).exists():
                    with gzip.open(_zipped(day), "rb") as fh:
                        for raw in fh:
                            old = _parse(raw)
                            if old is not None and _k(old["id"], old["type"]) not in keys:
                                keys.add(_k(old["id"], old["type"]))
                                kept.append(old)
                kept += [x for x in lines if _k(x["id"], x["type"]) not in keys]
                _write_atomic(_zipped(day), gzip.compress(b"".join(_encode(x) for x in kept), mtime=0))
                _plain(day).unlink(missing_ok=True)
                _fsync_dir(INBOX_DIR)
            except Exception as exc:  # noqa: BLE001 - an archive it cannot read is not overwritten
                log.warning("quo inbox: %s could not be zipped (%s) — kept open", day, type(exc).__name__)
                continue
            del _DAYS[day]
            _ZIPPED.add(day)
            said["zipped"] += 1
        cut = (date.fromisoformat(today) - timedelta(days=KEEP_DAYS)).isoformat()
        for day in sorted(d for d in _ZIPPED if d < cut):
            try:
                _zipped(day).unlink(missing_ok=True)
            except OSError as exc:
                log.warning("quo inbox: %s could not be pruned (%s)", day, type(exc).__name__)
                continue
            _ZIPPED.discard(day)
            for k in [k for k, d in _INDEX.items() if d == day]:
                del _INDEX[k]
            said["pruned"] += 1
        if said["zipped"]:
            _count("zipped_days", said["zipped"])
            _save_state()
    return said


# ── the backfill spool ───────────────────────────────────────────────────── HISTORY QUO KEPT AND NOTHING FILED…

SPOOL_DIR = INBOX_DIR / ".backfill"
SPOOL_FEED = int(os.getenv("HUB_QUO_BACKFILL_FEED", "25"))
SPOOL_HOLD = int(os.getenv("HUB_QUO_BACKFILL_HOLD", "25"))


def spool_pending() -> list[Path]:
    """Spool files not yet fed whole, oldest first."""
    try:
        return sorted(p for p in SPOOL_DIR.glob("*.jsonl") if p.is_file() and not p.is_symlink())
    except OSError:
        return []


def _spool_mark(path: Path) -> Path:
    return path.with_name(path.name + ".fed")


def _spool_offset(path: Path) -> int:
    try:
        got = json.loads(_spool_mark(path).read_text(encoding="utf-8"))
        return max(0, int(got.get("offset") or 0)) if isinstance(got, dict) else 0
    except (OSError, ValueError, TypeError):
        return 0


def feed_backfill(now: float | None = None) -> dict[str, Any]:
    """One feed from the oldest spool: at most SPOOL_FEED events, none while SPOOL_HOLD or more lines already wait."""
    now = time.time() if now is None else now
    said: dict[str, Any] = {"fed": 0, "added": 0, "duplicate": 0, "invalid": 0,
                            "held": False, "finished": False, "spool": None}
    with _LOCK:
        _load()
        pending = spool_pending()
        if not pending:
            return said
        said["spool"] = pending[0].name
        if sum(1 for lines in _DAYS.values() for x in lines if not x.get("drained_at")) >= SPOOL_HOLD:
            said["held"] = True
            return said
        path = pending[0]
        offset = _spool_offset(path)
        events: list[Any] = []
        with open(path, "rb") as fh:
            size = os.fstat(fh.fileno()).st_size
            fh.seek(min(offset, size))
            end = min(offset, size)
            while len(events) < max(1, SPOOL_FEED):
                raw = fh.readline()
                if not raw:
                    break
                end += len(raw)
                if not raw.strip():
                    continue
                try:
                    events.append(json.loads(raw.decode("utf-8")))
                except (UnicodeDecodeError, ValueError):
                    events.append(None)      # counted `invalid` below, never kept
        if events:
            said.update(append_many(events, "backfill", now, recheck=True))
            said["fed"] = len(events)
        if end >= size:
            os.replace(path, path.with_name(path.name + ".done"))
            _spool_mark(path).unlink(missing_ok=True)
            _fsync_dir(SPOOL_DIR)
            said["finished"] = True
            log.info("quo inbox: the backfill %s was fed whole", path.name)
        else:
            _write_atomic(_spool_mark(path), json.dumps({"offset": end, "fed_at": _iso(now)}).encode("utf-8"))
    return said


# ── the pull's cursor ──────────────────────────────────────────────────────

def cursor(phone_number_id: str) -> str | None:
    with _LOCK:
        _load()
        return (_STATE.get("cursors") or {}).get(str(phone_number_id))


def pull_line(phone_number_id: str) -> dict[str, Any]:
    """What the pull remembers of one line, as a copy it may change: its cursor, the threads it owes a read, the…"""
    with _LOCK:
        _load()
        pid = str(phone_number_id)
        memo = _line_memo((_STATE.get("lines") or {}).get(pid))
        memo["cursor"] = (_STATE.get("cursors") or {}).get(pid)
        return json.loads(json.dumps(memo))


def pull_done(advanced: dict[str, str], said: dict[str, Any], now: float | None = None,
              lines: dict[str, dict] | None = None) -> None:
    """Move the cursors of the numbers a round finished, keep what each line it tried now remembers (`lines`…"""
    now = time.time() if now is None else now
    with _LOCK:
        _load()
        _STATE.setdefault("cursors", {}).update({str(k): str(v) for k, v in advanced.items()})
        memos = _STATE.setdefault("lines", {})
        for pid, memo in (lines or {}).items():
            memos[str(pid)] = _line_memo(memo)
        pull = _STATE.setdefault("pull", {})
        pull["last_round_at"] = _iso(now)
        pull["last_state"] = str(said.get("state") or "")
        pull["owed_threads"] = sum(len(m.get("owed") or {}) for m in memos.values())
        pull["watching"] = sum(len(m.get("watch") or {}) for m in memos.values())
        pull["owed_transcripts"] = sum(len(m.get("calls") or {}) for m in memos.values())
        if said.get("state") == "ok":
            pull["last_ok_at"] = _iso(now)
            pull["last_error"] = None
        else:
            pull["last_error"] = str(said.get("why") or "")[:200]
        _save_state()


def health() -> dict[str, Any]:
    """For the public /health: whether the door is armed and the hand-off stood down, and nothing that moves when…"""
    return {"armed": bool(webhook_keys()),
            "stood_down_s": max(0, round(float(_HANDOFF["paused_until"]) - time.time()))}


def stats() -> dict[str, Any]:
    """Counts only — no id, no number, no words."""
    with _LOCK:
        _load()
        undrained = [x for lines in _DAYS.values() for x in lines if not x.get("drained_at")]
        oldest = min((_ts(x.get("received_at")) or 0.0 for x in undrained), default=None)
        return {"open_days": len(_DAYS), "zipped_days": len(_ZIPPED), "undrained": len(undrained),
                "oldest_undrained_s": round(time.time() - oldest) if oldest else None,
                "backfill_spools": len(spool_pending()),
                "counters": dict(_STATE.get("counters") or {})}


# ── the messages webhook's key ─────────────────────────────────────────────

def usable_keys(words: list[str]) -> list[str]:
    out = []
    for word in words:
        try:
            if len(base64.b64decode(word, validate=True)) >= 16:
                out.append(word)
        except Exception:  # noqa: BLE001 - not a key; counted where it is said
            pass
    return out


def webhook_keys() -> list[str]:
    """The messages webhook's signing keys, re-read only when the file changes."""
    with _KEY_LOCK:
        try:
            st = MESSAGES_KEY_FILE.stat()
            stamp: tuple[int, int] | None = (int(st.st_mtime_ns), int(st.st_size))
        except OSError:
            stamp = None
        if stamp != _KEYS["stamp"]:
            words: list[str] = []
            if stamp is not None:
                try:
                    words = MESSAGES_KEY_FILE.read_text(encoding="utf-8").split()
                except (OSError, ValueError):
                    words = []
            _KEYS.update(stamp=stamp, keys=usable_keys(words), words=len(words))
        keys = list(_KEYS["keys"])
        said = (tuple(hashlib.sha256(k.encode()).hexdigest()[:8] for k in keys), _KEYS["words"] - len(keys))
        if said != _KEYS["said"]:
            _KEYS["said"] = said
            if keys:
                log.info("quo inbox: messages webhook key fingerprint %s — the inbox door is armed%s",
                         ",".join(said[0]), f" ({said[1]} unusable entry(ies) ignored)" if said[1] else "")
            elif _KEYS["words"]:
                log.warning("quo inbox: the key file holds %s entry(ies) and no usable key — "
                            "the inbox door is off", _KEYS["words"])
            else:
                log.info("quo inbox: no messages webhook key — the inbox door is off")
        return keys
