"""The parts of the relay's hotline desk (server/hotline_desk.py) that its moved doors share: the books named in full,
a source's sentence, the times, a source read with its last good answer beside it, and the desk's own threads. Every
book is read off asa-hub-db's copy with Python's kept edits laid, never off Google. A copy that cannot vouch that it
is current answers as a copy and says so. The call index and the webhook's calls are app/hotline_calls.py's."""
from __future__ import annotations

import asyncio
import concurrent.futures
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, NamedTuple

import gsjs
import hub_rows

log = logging.getLogger("asa-hub-app.hotline")

# A request that finds a held answer merely old waits this long for the build it started, then takes the held one.
HELD_WAIT_S = 8.0
# The copy vouches for a book its keeper confirmed this recently.
MAX_AGE_S = float(os.getenv("HUB_MIRROR_MAX_AGE_S", "600"))
VOUCH_MARGIN_S = 60.0
# what the relay's live reads learned of each book's zone, kept beside the slices
KEPT_DIR = Path(os.getenv("HUB_MIRROR_FIRST_DIR")
                or Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) / "mirror-first")


class Book(NamedTuple):
    key: str
    sheet_id: str
    tab: str
    label: str


class SourceError(RuntimeError):
    """A source could not be read. The message is a sentence for a person."""


parse_when = gsjs.parse_when
_zone = gsjs.zone


def iso_utc(dt: datetime | None) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if dt else ""


def _int_or_none(value: Any) -> int | None:
    if value is None or isinstance(value, bool) or str(value).strip() == "":
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _sentence(what: str) -> str:
    return what[:1].upper() + what[1:]


def stamp(epoch: float, now: float | None = None) -> str:
    """The date is printed off today, so an old copy never looks fresh."""
    if not epoch:
        return "an unknown time"
    at = datetime.fromtimestamp(epoch, timezone.utc)
    today = datetime.fromtimestamp(time.time() if now is None else now, timezone.utc).date()
    return at.strftime("%H:%M:%SZ" if at.date() == today else "%Y-%m-%d %H:%M:%SZ")


# ---- the desk's own threads ------------------------------------------------------------------------------------------

# one thread: every reader it goes through holds its connections per thread, and asa-hub-db's slots are few
_DESK_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="hotline-desk")


async def run_on_desk(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Run one blocking desk read on the desk's threads, never the pool the sessions use."""
    return await asyncio.get_running_loop().run_in_executor(_DESK_POOL, lambda: fn(*args, **kwargs))


# ---- one source, with its last good answer ---------------------------------------------------------------------------

_LAST_GOOD: dict[str, tuple[Any, float]] = {}
_LAST_GOOD_LOCK = threading.Lock()


def _serve(source: str, read: Callable[[], tuple[Any, ...]]) -> tuple[Any, dict[str, Any], float]:
    """Run one source read; on failure fall back to its last good answer."""
    t0 = time.time()
    try:
        got = read()
        value, count = got[0], got[1]
        copy = got[2] if len(got) > 2 else ""
        if copy:
            return value, {"ok": False, "rows": count, "error": copy}, (time.time() - t0) * 1000
        with _LAST_GOOD_LOCK:
            _LAST_GOOD[source] = ((value, count), time.time())
        return value, {"ok": True, "rows": count, "error": ""}, (time.time() - t0) * 1000
    except Exception as exc:  # noqa: BLE001
        sentence = str(exc) if isinstance(exc, SourceError) else \
            f"The {source.replace('_', ' ')} source failed ({type(exc).__name__})."
        with _LAST_GOOD_LOCK:
            last = _LAST_GOOD.get(source)
        ms = (time.time() - t0) * 1000
        if last:
            (value, count), at = last
            when = datetime.fromtimestamp(at, timezone.utc).strftime("%H:%M:%SZ")
            return value, {"ok": False, "rows": count,
                           "error": f"{sentence} Showing the copy read at {when}."}, ms
        return None, {"ok": False, "rows": None, "error": sentence}, ms


# ---- a book off asa-hub-db's copy ------------------------------------------------------------------------------------

class Vouch(NamedTuple):
    has: bool
    fresh: bool
    as_of: float
    why: str
    until: float = 0.0


class Copy(NamedTuple):
    """One tab as asa-hub-db holds it, and its book's word."""
    vouch: Vouch
    headers: list[str]
    rows: list[tuple[int, dict]]


def _ts(value: Any) -> float:
    try:
        return float(value) if value not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def read_tab(sheet_id: str, tab: str, *, now: float | None = None, max_age_s: float | None = None,
             rows_needed: bool = True) -> Copy:
    """The tab and the book's word, read once (mirror_first.vouch over asa-hub-db's copy)."""
    now = time.time() if now is None else now
    max_age_s = MAX_AGE_S if max_age_s is None else max_age_s
    b = hub_rows.book(sheet_id)
    t = hub_rows.read(sheet_id, tab)
    rows = list(t.get("rows") or [])
    headers = [str(h) for h in (t.get("headers") or [])] or (sorted(rows[0][1]) if rows else [])
    if not (rows if rows_needed else b.get("known")):
        return Copy(Vouch(False, False, 0.0, "asa-hub-db's copy holds no row of it"), headers, rows)
    modified, synced = _ts(b.get("modified_time")), _ts(b.get("synced_at"))
    late = max(modified, synced)
    as_of = _ts(b.get("as_of"))
    if str(b.get("status") or "") != "ok":
        v = Vouch(True, False, modified, "its last copy into asa-hub-db failed", late)
    elif b.get("stale"):
        v = Vouch(True, False, modified, "its copy in asa-hub-db is behind the book", late)
    elif not as_of:
        v = Vouch(True, False, modified, "its keeper has not said when it last looked", late)
    elif now - as_of > max_age_s:
        v = Vouch(True, False, as_of, f"its keeper last looked at {stamp(as_of + VOUCH_MARGIN_S, now)}",
                  max(as_of, synced))
    else:
        v = Vouch(True, True, as_of, "", max(as_of, synced))
    return Copy(v, headers, rows)


def table(copy: Copy, fields: dict[str, str], *, refuse: frozenset[str] | set[str] = frozenset(),
          required: tuple[str, ...] = (), must_have: tuple[str, ...] | None = None) -> list[dict[str, Any]]:
    """The named cells of each row ({key: text, _row}); a refused header is refused before anything is read, a
    missing must_have column raises, never reads as empty."""
    asked = list(fields.values())
    if any(h in refuse for h in asked):
        raise ValueError("a refused column was asked for in a copy read")
    keys = set(copy.headers)
    need = required if must_have is None else must_have
    missing = [fields[k] for k in need if fields[k] not in keys]
    if missing:
        raise SourceError(f"asa-hub-db's copy has no {', '.join(repr(m) for m in missing)} column.")
    out: list[dict[str, Any]] = []
    for rn, d in copy.rows:
        row: dict[str, Any] = {}
        for k, h in fields.items():
            v = hub_rows.cell(d.get(h))
            row[k] = "" if v is None else v
        row["_row"] = int(rn)
        if all(str(row[k]).strip() for k in required):
            out.append(row)
    return out


def stale_sentence(label: str, v: Vouch, now: float | None = None) -> str:
    """What a copy that cannot vouch for itself is served with."""
    return (f"{_sentence(label)} could not be vouched for: {v.why}. "
            f"Showing the copy as of {stamp(v.as_of, now)}.")


def read_copy(book: Book, fields: dict[str, str], *, zone: str, refuse: frozenset[str] = frozenset(),
              required: tuple[str, ...] = ("call_id",),
              must_have: tuple[str, ...] | None = None) -> tuple[Any, int, str]:
    """(value {zone, rows, as_of, until}, count, '' or the sentence of the copy standing in)."""
    copy = read_tab(book.sheet_id, book.tab)
    if not copy.vouch.has:
        raise SourceError(f"{_sentence(book.label)} could not be read: {copy.vouch.why}.")
    rows = table(copy, fields, refuse=refuse, required=required, must_have=must_have)
    v = copy.vouch
    value = {"zone": zone, "rows": rows, "as_of": v.as_of, "until": max(v.as_of, v.until)}
    return value, len(rows), "" if v.fresh else stale_sentence(book.label, v)


# ---- the zone a book's date text is shown on -------------------------------------------------------------------------

_LEARNED: dict[str, Any] = {"at": 0.0, "zones": {}}
_LEARNED_TTL_S = 600.0
# what those live reads learned of the lanes' data houses, for when the kept copies are gone
DECLARED_ZONES = {
    "1Dl_69R0c0oUgKUfI0ME5sA3HOusrlQHZA7TYYKa9F-0": "Etc/GMT",
    "1M_Wmrf-1bXC6sJK9_E4KtqrvCR_i3FUVb97Hp8yS8Tk": "Etc/GMT",
    "1GwOlT0aM-fEJ4R-Apnfx0p8fcJ_wtiteBqEVbEsF4a4": "Etc/GMT",
}


def _learned_zones() -> dict[str, str]:
    """source or sheet id → the zone the relay's live read of it learned, from the copies it keeps on disk."""
    now = time.time()
    if now - float(_LEARNED["at"]) < _LEARNED_TTL_S:
        return dict(_LEARNED["zones"])
    zones: dict[str, str] = {}
    try:
        files = sorted(KEPT_DIR.glob("*.private.json"))
    except OSError:
        files = []
    for path in files:
        try:
            copies = (json.loads(path.read_text(encoding="utf-8")).get("copies") or {})
        except Exception:  # noqa: BLE001 - an unreadable copy teaches nothing
            continue
        for source, item in copies.items():
            value = (item or {}).get("value") if isinstance(item, dict) else None
            zone = str((value or {}).get("zone") or "") if isinstance(value, dict) else ""
            if not zone:
                continue
            zones.setdefault(str(source), zone)
            book = value.get("book")
            sid = book.get("sheet_id") if isinstance(book, dict) else ""
            if sid:
                zones.setdefault(str(sid), zone)
    _LEARNED.update(at=now, zones=zones)
    return dict(zones)


def learned_zone(*keys: str) -> str:
    """The first zone a live read learned for any of these sources or sheet ids, '' when none did."""
    zones = _learned_zones()
    return (next((zones[k] for k in keys if k and k in zones), "")
            or next((DECLARED_ZONES[k] for k in keys if k in DECLARED_ZONES), ""))
