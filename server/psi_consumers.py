"""Clients present at each punch, asked of PsiAnywhere once per entry version on the lane's session; never signs in."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any, Callable, Iterable
from zoneinfo import ZoneInfo

import psi_punches_full as full

log = logging.getLogger("hub.psi_consumers")

METHOD = "getSingleEntryConsumersPresentJSON"
CONSUMERS_FILE = "consumers.json"
NEW_YORK = ZoneInfo("America/New_York")

PER_COLLECTION = int(os.getenv("HUB_PSI_CONSUMERS_PER_COLLECTION", "20"))
PER_DAY = int(os.getenv("HUB_PSI_CONSUMERS_PER_DAY", "120"))
MISS_MAX = int(os.getenv("HUB_PSI_CONSUMERS_MISS_MAX", "2"))
# An empty answer for an entry with no count proves nothing, so it is re-asked at most this often.
EMPTY_MAX = int(os.getenv("HUB_PSI_CONSUMERS_EMPTY_MAX", "2"))
TIMEOUT_S = float(os.getenv("HUB_PSI_CONSUMERS_TIMEOUT_S", "20"))
FRESH_S = float(os.getenv("HUB_PSI_CONSUMERS_FRESH_S", "900"))

# Only these can change who was present; an approval or status change never costs a request.
CHANGE_FIELDS = ("Number_Consumers_Present", "Location_Name", "Date_of_Service",
                 "start_time", "end_time")
NAME_KEY = "consumername"

_LOCK = threading.Lock()

# The bounds live in memory; the file only carries them across a restart, so a failed write cannot reset them.
_SPENT: dict[str, Any] = {"day": "", "sent": 0}
_SERVED: dict[str, str] = {"read_at": ""}
# Set when a write failed: nothing is asked until a write lands again.
_UNKEPT: dict[str, str] = {"why": ""}


def _spend() -> None:
    """Counted before the answer is kept, so a refused write cannot buy a second round."""
    with _LOCK:
        _SPENT["sent"] = int(_SPENT["sent"] or 0) + 1


# ── the answer ─────────────────────────────────────────────────────────────

class Unreadable(ValueError):
    """The service answered, and not with a list of the clients present."""


def count_of(entry: dict) -> int | None:
    """`Number_Consumers_Present` as a number, or None when the entry does not say."""
    raw = full._text((entry or {}).get("Number_Consumers_Present"))
    return int(raw) if raw.isdigit() else None


def parse(answer: Any, count: int | None = None) -> dict[str, list]:
    """Answer → {names, meta}; raises Unreadable for a non-list or no names where the entry counts clients."""
    if not isinstance(answer, list):
        raise Unreadable(f"the answer is not a list — {type(answer).__name__}")
    names: list[str] = []
    meta: list[dict[str, Any]] = []
    for item in answer:
        if not isinstance(item, dict):
            raise Unreadable(f"an item of the answer is not an object — {type(item).__name__}")
        name = full._text(item.get(NAME_KEY))
        if not name:
            continue
        names.append(name)
        meta.append({str(k): v for k, v in item.items() if k != NAME_KEY})
    if count and not names:
        raise Unreadable(f"the answer names nobody where the entry counts {count} client(s)")
    return {"names": names, "meta": meta}


def entry_print(entry: dict) -> str:
    """The entry's fingerprint on what can change who was there."""
    return hashlib.sha1(json.dumps([full._text((entry or {}).get(k)) for k in CHANGE_FIELDS])
                        .encode()).hexdigest()[:16]


# ── what is owed ───────────────────────────────────────────────────────────

def due(entries: dict[str, dict], held: dict[str, dict], skip: Iterable[str] = (),
        stamp: str = "") -> tuple[list[tuple[str, str, int | None]], dict[str, dict], dict[str, int]]:
    """(to ask, in order; answered by their count of none; counts) — pure."""
    skip = set(skip)
    fresh: list[tuple[str, str, int | None, int]] = []
    changed: list[tuple[str, str, int | None, int]] = []
    by_count: dict[str, dict] = {}
    counts = {"answered": 0, "none_by_count": 0, "set_aside": 0, "unproved": 0,
              "named_elsewhere": 0}
    for key, entry in entries.items():
        if key in skip:
            counts["named_elsewhere"] += 1
            continue
        p = entry_print(entry)
        rec = held.get(key) if isinstance(held.get(key), dict) else {}
        if rec.get("answered") and rec.get("print") == p:
            counts["answered"] += 1
            continue
        n = count_of(entry)
        if n == 0:
            by_count[key] = {"answered": True, "print": p, "names": [], "meta": [], "by": "count",
                             "at": stamp}
            counts["none_by_count"] += 1
            continue
        misses = int(rec.get("misses") or 0) if rec.get("miss_print") == p else 0
        if misses >= MISS_MAX:
            counts["set_aside"] += 1
            continue
        empties = int(rec.get("empties") or 0) if rec.get("empty_print") == p else 0
        if empties >= EMPTY_MAX:
            counts["unproved"] += 1
            continue
        (changed if rec.get("answered") else fresh).append((key, p, n, misses + empties))
    out: list[tuple[str, str, int | None]] = []
    for group in (fresh, changed):
        group.sort(key=lambda x: full.feed._order(x[0]), reverse=True)
        group.sort(key=lambda x: x[3])
        out.extend((k, p, n) for k, p, n, _m in group)
    return out, by_count, counts


# ── the file, locked ───────────────────────────────────────────────────────

def _load() -> dict[str, Any]:
    """consumers.json, or a blank one; raises on an unreadable file so it is never written over."""
    got = full._read(CONSUMERS_FILE)
    return {"entries": got.get("entries") if isinstance(got.get("entries"), dict) else {},
            "day": got.get("day") if isinstance(got.get("day"), dict) else {},
            "filled_for": str(got.get("filled_for") or ""),
            "last": got.get("last") if isinstance(got.get("last"), dict) else {}}


def answers() -> dict[str, dict]:
    """Single_Entry_ID → {names, meta} for every answered entry; empty when the file cannot be read."""
    with _LOCK:
        try:
            got = _load()
        except (OSError, ValueError) as exc:
            log.warning("psi consumers: %s could not be read (%s) — the sheet goes without the "
                        "clients' names this pass", CONSUMERS_FILE, type(exc).__name__)
            return {}
    return {k: {"names": list(v.get("names") or []), "meta": list(v.get("meta") or [])}
            for k, v in got["entries"].items()
            if isinstance(v, dict) and v.get("answered") and v.get("names")}


def status() -> dict[str, Any]:
    """Counts and words only — never a name."""
    with _LOCK:
        try:
            got = _load()
        except (OSError, ValueError) as exc:
            return {"readable": False, "why": type(exc).__name__}
    recs = [v for v in got["entries"].values() if isinstance(v, dict)]
    return {"readable": True, "answered": sum(1 for v in recs if v.get("answered")),
            "named": sum(1 for v in recs if v.get("answered") and v.get("names")),
            "none_by_count": sum(1 for v in recs
                                 if v.get("answered") and v.get("by") == "count"),
            "unproved": sum(1 for v in recs if not v.get("answered") and v.get("empties")),
            "missed": sum(1 for v in recs if not v.get("answered") and v.get("misses")),
            "day": got["day"], "spent": dict(_SPENT), "unkept": _UNKEPT["why"],
            "served": _SERVED["read_at"], "last": got["last"]}


def _ny_day(now: datetime) -> str:
    return now.astimezone(NEW_YORK).date().isoformat()


# ── the pass ───────────────────────────────────────────────────────────────

def fill(token: str, read_at: str, now: datetime | None = None,
         ask: Callable[[str, dict, float], Any] | None = None,
         entries: dict[str, dict] | None = None, skip: Iterable[str] | None = None) -> dict[str, Any]:
    """One pass for one read, on the session that read, within both caps; never raises, never signs in."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    out: dict[str, Any] = {"asked": 0, "answered": 0, "missed": 0, "unproved": 0, "left": 0,
                           "why": ""}

    def spent() -> None:
        out["asked"] += 1
        _spend()

    if not token:
        out["why"] = "no kept session — nothing asked"
        return out
    if PER_COLLECTION <= 0 or PER_DAY <= 0:
        out["why"] = "switched off (a cap of 0)"
        return out
    from psi_attendance import PsiAnswer, PsiPaused, PsiTransport  # noqa: PLC0415
    if ask is None:
        from psi_attendance import _ask as ask  # noqa: PLC0415
    stamp = full._now_iso(now)
    today = _ny_day(now)
    with _LOCK:
        try:
            state = _load()
        except (OSError, ValueError) as exc:
            out["why"] = f"{CONSUMERS_FILE} could not be read ({type(exc).__name__}) — nothing asked"
            log.warning("psi consumers: %s", out["why"])
            return out
        if read_at and read_at in (state["filled_for"], _SERVED["read_at"]):
            out["why"] = "this read was already served"
            return out
        if _UNKEPT["why"]:
            # A write probe, never a request.
            try:
                full._write(CONSUMERS_FILE, state)
            except OSError as exc:
                out["why"] = (f"{CONSUMERS_FILE} still cannot be written "
                              f"({type(exc).__name__}) — nothing asked")
                log.warning("psi consumers: %s", out["why"])
                return out
            _UNKEPT["why"] = ""
        try:
            have = entries if entries is not None else full.live_entries()
        except (OSError, ValueError) as exc:
            out["why"] = f"the live entries could not be read ({type(exc).__name__}) — nothing asked"
            log.warning("psi consumers: %s", out["why"])
            return out
        todo, by_count, counts = due(have, state["entries"],
                                     full.named_by_stored_copy() if skip is None else skip, stamp)
        sent_today = int(state["day"].get("sent") or 0) if state["day"].get("day") == today else 0
        # The higher of file and memory: a failed write must not lower the day's bound.
        if _SPENT["day"] == today:
            sent_today = max(sent_today, int(_SPENT["sent"] or 0))
        _SPENT.update(day=today, sent=sent_today)
    room = max(0, min(PER_COLLECTION, PER_DAY - sent_today))
    results: dict[str, dict] = {}
    stopped = ""
    for key, p, n in todo[:room]:
        try:
            answer = ask(METHOD, {"token": token, "singleEntryId": key}, TIMEOUT_S)
        except PsiPaused as exc:
            stopped = f"held — {str(exc)[:160]}"
            break
        except PsiTransport as exc:
            spent()
            stopped = f"the service did not answer ({str(exc)[:160]})"
            break
        except PsiAnswer as exc:
            spent()
            results[key] = {"miss": p, "why": str(exc)[:160]}
            stopped = f"an answer that cannot be read ({str(exc)[:160]})"
            break
        except Exception as exc:  # noqa: BLE001 — anything else ends the pass, and says so
            spent()
            stopped = f"the request failed ({type(exc).__name__}: {str(exc)[:120]})"
            break
        spent()
        try:
            got = parse(answer, n)
        except Unreadable as exc:
            results[key] = {"miss": p, "why": str(exc)[:160]}
            stopped = f"an answer that cannot be read ({exc})"
            break
        if not got["names"] and n is None:
            # Nobody named and nothing counted: not written down as "nobody", stays askable.
            results[key] = {"empty": p, "why": "the answer names nobody and the entry does not "
                                               "say how many clients it had"}
            continue
        results[key] = {"answered": True, "print": p, "names": got["names"], "meta": got["meta"],
                        "at": stamp}
    if read_at:
        # Served whatever the file does next, so the same read is never asked twice.
        _SERVED["read_at"] = read_at
    with _LOCK:
        try:
            state = _load()
        except (OSError, ValueError) as exc:
            log.warning("psi consumers: %s could not be read back (%s) — %s answer(s) of this pass "
                        "are not kept", CONSUMERS_FILE, type(exc).__name__, len(results))
            out["why"] = "the answers could not be kept"
            return out
        recs = state["entries"]
        recs.update(by_count)
        for key, res in results.items():
            if res.get("answered"):
                recs[key] = res
                out["answered"] += 1
                continue
            old = recs.get(key) if isinstance(recs.get(key), dict) else {}
            if res.get("empty"):
                same_empty = old.get("empty_print") == res["empty"]
                recs[key] = dict(old, empty_print=res["empty"],
                                 empties=(int(old.get("empties") or 0) + 1 if same_empty else 1),
                                 why=res["why"], empty_at=stamp)
                out["unproved"] += 1
                continue
            same = old.get("miss_print") == res["miss"]
            # A miss keeps the names an earlier version gave.
            recs[key] = dict(old, miss_print=res["miss"], misses=(int(old.get("misses") or 0) + 1
                                                                   if same else 1),
                             why=res["why"], missed_at=stamp)
            out["missed"] += 1
        day = state["day"] if state["day"].get("day") == today else {"day": today, "sent": 0}
        day["sent"] = max(int(day.get("sent") or 0) + out["asked"],
                          int(_SPENT["sent"] or 0) if _SPENT["day"] == today else 0)
        out["left"] = max(0, len(todo) - out["answered"])
        state.update(day=day, filled_for=read_at,
                     last={"at": stamp, "asked": out["asked"], "answered": out["answered"],
                           "missed": out["missed"], "unproved": out["unproved"],
                           "left": out["left"], "stopped": stopped,
                           **{k: v for k, v in counts.items() if v}})
        try:
            full._write(CONSUMERS_FILE, state)
        except OSError as exc:
            _UNKEPT["why"] = f"{type(exc).__name__}: {str(exc)[:120]}"
            log.warning("psi consumers: %s could not be written (%s) — %s answer(s) lost, and "
                        "nothing is asked until it can be written again", CONSUMERS_FILE,
                        _UNKEPT["why"], len(results))
            out["why"] = "the answers could not be kept"
            return out
    capped = bool(todo) and room < min(len(todo), PER_COLLECTION)
    out["why"] = stopped or (f"the day's {PER_DAY} requests are spent — {out['left']} wait for the "
                             "next day" if capped and not room else "")
    if out["asked"] or stopped or by_count or capped:
        log.log(logging.WARNING if stopped else logging.INFO,
                "psi consumers: asked %s entr(y/ies) for the clients present — %s answered, %s "
                "missed, %s named nobody with nothing counting them, %s answered by a count of "
                "none; %s still owed (%s of %s today)%s",
                out["asked"], out["answered"], out["missed"], out["unproved"], len(by_count),
                out["left"], day["sent"], PER_DAY, f"; stopped: {stopped}" if stopped
                else "; the day's cap bound this pass" if capped else "")
    return out
