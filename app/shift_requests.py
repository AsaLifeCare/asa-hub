"""Shift applications and their windows; only the claims ledger (house_cal_live) gives a shift its person."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sys
import threading
import time
from datetime import date, datetime, time as clock_time, timedelta, timezone
from typing import Any, Iterable
from urllib.parse import quote
from zoneinfo import ZoneInfo

import badge_follows
import effective_roster
import house_cal_live
import house_directory
import ist_config
import lanes_db as hub_db
import lanes_pg as psycopg2
import lanes_sheets
import shift_slices

OHIO = ZoneInfo("America/New_York")

# ── the numbers ────────────────────────────────────────────────────────────
OPEN_SHIFT_APPLY_MIN = int(os.getenv("HUB_OPEN_SHIFT_APPLY_MIN", "10"))
OPEN_SHIFT_REGULAR_DAYS = int(os.getenv("HUB_OPEN_SHIFT_REGULAR_DAYS", "28"))
CALLOFF_APPLY_H = float(os.getenv("HUB_CALLOFF_APPLY_H", "5"))
CALLOFF_APPLY_BEFORE_START_MIN = int(os.getenv("HUB_CALLOFF_APPLY_BEFORE_START_MIN", "60"))
CALLOFF_APPLY_FLOOR_MIN = int(os.getenv("HUB_CALLOFF_APPLY_FLOOR_MIN", "15"))
# Shifts on real people's rows; an OPEN row alone never publishes a day.
DAY_PUBLISHED_MIN_CELLS = int(os.getenv("HUB_OPEN_SHIFT_DAY_MIN_CELLS", "1"))
CALLOFF_LOOKBACK_DAYS = int(os.getenv("HUB_CALLOFF_LOOKBACK_DAYS", "3"))

# ── who sees the whole company's list ──────────────────────────────────────
# TEAMLEAD is the stored token, beside HM (house manager parity); TL and TEAM LEAD are older spellings, kept
MANAGER_BADGES = frozenset(
    b.strip().upper() for b in os.getenv(
        "HUB_REQUESTS_MANAGER_BADGES",
        "MASTER,DIRECTOR,ADMINISTRATOR,ADMIN,MANAGER,HM,TEAMLEAD,TL,TEAM LEAD").split(",") if b.strip())
REASON_BADGES = frozenset(
    b.strip().upper() for b in os.getenv(
        "HUB_REQUESTS_REASON_BADGES",
        "MASTER,DIRECTOR,ADMINISTRATOR,ADMIN").split(",") if b.strip())

# Matched with spaces ignored; a badge not listed reads as its own word.
_BADGE_TITLES = {"DIRECTOR": "director", "TEAM LEAD": "team lead", "TL": "team lead",
                 "ADMINISTRATOR": "administrator", "ADMIN": "administrator",
                 "MANAGER": "manager", "MASTER": "", "PLATFORM LEAD": ""}
_TITLE_ORDER = ("director", "supervisor", "team lead", "administrator", "manager")


def _badge_title(badge: str) -> str:
    bare = str(badge).replace(" ", "").upper()
    return next((t for k, t in _BADGE_TITLES.items() if k.replace(" ", "") == bare), str(badge).lower())


def decider_titles(badges: Any = None) -> list[str]:
    """The titles that decide for every house: REASON_BADGES and every badge that follows one."""
    given = set(badges) if badges is not None else set(REASON_BADGES)
    given |= {w for w, stands in badge_follows.BADGE_FOLLOWS.items() if stands in given}
    titles = {_badge_title(b) for b in given} - {""}
    return sorted(titles, key=lambda t: (_TITLE_ORDER.index(t) if t in _TITLE_ORDER
                                         else len(_TITLE_ORDER), t))


def deciders_one(badges: Any = None) -> str:
    """'a director, supervisor or administrator' — generated from the badges, never typed."""
    t = decider_titles(badges) or ["manager above the house"]
    head = ", ".join(t[:-1]) + (" or " if len(t) > 1 else "") + t[-1]
    return ("an " if head[0] in "aeiou" else "a ") + head


def deciders_all(badges: Any = None) -> str:
    """'directors, supervisors and administrators' — generated from the badges, never typed."""
    t = [w + "s" for w in decider_titles(badges)]
    if not t:
        return "managers above the house"
    return ", ".join(t[:-1]) + (" and " if len(t) > 1 else "") + t[-1]


KIND_OPEN = "open_shift"
KIND_CALLOFF = "call_off"
KIND_SWAP = "swap"
KIND_IST = "ist_approval"
TRAINING = "training"

APPLIED = "applied"
NEEDS_TRAINING = "needs_training_approval"
APPROVED = "approved"
NOT_CHOSEN = "not_chosen"
WITHDRAWN = "withdrawn"
REFUSED = "refused"
LIVE_STATES = (APPLIED, NEEDS_TRAINING)

WINDOW_OPEN = "open"
WINDOW_CLOSED = "closed"
WINDOW_MANAGER_ONLY = "manager_only"
WINDOW_FILLED = "filled"

# ── THE MARK ──────────────────────────────────────────────────────────────── A row the staff-answers rehearsal…
REHEARSAL = "rehearsal"
REHEARSAL_VIA = f"{REHEARSAL}:"


def is_rehearsed(row: dict[str, Any] | None) -> bool:
    """True when a request row was made by the rehearsal — by its via or by the evidence on it."""
    row = row or {}
    if str(row.get("via") or "").startswith(REHEARSAL_VIA):
        return True
    if bool(row.get(REHEARSAL)):
        return True
    extra = row.get("extra")
    return isinstance(extra, dict) and REHEARSAL in extra


def messages_rehearsed() -> bool:
    """True only inside the rehearsal's sealed worker, where a lane's owed() lists what a rehearsed row would…"""
    box = sys.modules.get("rehearsal_sandbox")
    try:
        return bool(box is not None and box.sealed())
    except Exception:  # noqa: BLE001 — FAIL-CLOSED: a seal that cannot be read is no sandbox
        return False


def rehearsed_via(via: str, rehearsal: dict[str, Any] | None) -> str:
    """The road a write records: the rehearsal's own when it carries the rehearsal's evidence."""
    return f"{REHEARSAL_VIA}{via}" if rehearsal is not None else via


def _training_mark(rehearsal: dict[str, Any] | None) -> dict[str, Any]:
    """What `_record_training` is handed so a training row the rehearsal makes says so."""
    if rehearsal is None:
        return {}
    return {"via": rehearsed_via("app", rehearsal), "evidence": {REHEARSAL: rehearsal}}


# ── the tables, additive, created on first touch ─────────────────────────── The mirror never says when a column…
PUBLISHED_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_house_day_published ("
    "location TEXT NOT NULL, col_iso TEXT NOT NULL, "
    "first_seen TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "cells INT NOT NULL DEFAULT 0, "
    "PRIMARY KEY (location, col_iso))"
)
POOL_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_shift_pool ("
    "location TEXT NOT NULL, open_row TEXT NOT NULL, col_iso TEXT NOT NULL, "
    "kind TEXT NOT NULL DEFAULT 'open_shift', value TEXT NOT NULL DEFAULT '', "
    "opened_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "shift_start TIMESTAMPTZ, shift_end TIMESTAMPTZ, "
    "called_off_by TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', "
    "closed_at TIMESTAMPTZ, decided_by TEXT NOT NULL DEFAULT '', "
    "filled_by TEXT NOT NULL DEFAULT '', filled_how TEXT NOT NULL DEFAULT '', "
    "said JSONB NOT NULL DEFAULT '{}'::jsonb, "
    "first_seen TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "PRIMARY KEY (location, open_row, col_iso))"
)
# Never emptied; swaps stay in asa_shift_handoffs and are never copied here.
REQUESTS_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_shift_requests ("
    "id TEXT PRIMARY KEY, kind TEXT NOT NULL, "
    "location TEXT NOT NULL DEFAULT '', open_row TEXT NOT NULL DEFAULT '', "
    "col_iso TEXT NOT NULL DEFAULT '', value TEXT NOT NULL DEFAULT '', "
    "person TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'applied', "
    "why TEXT NOT NULL DEFAULT '', via TEXT NOT NULL DEFAULT 'app', "
    "ref TEXT NOT NULL DEFAULT '', "
    "decided_by TEXT NOT NULL DEFAULT '', decided_at TIMESTAMPTZ, "
    "created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "extra JSONB NOT NULL DEFAULT '{}'::jsonb)"
)
# `kind` must stay in the key: a training approval shares person and cell with its application.
REQUESTS_LIVE_INDEX_DDL = (
    "CREATE UNIQUE INDEX IF NOT EXISTS asa_shift_requests_live_kind "
    "ON asa_shift_requests (kind, location, open_row, col_iso, lower(person)) "
    "WHERE state IN ('applied', 'needs_training_approval')"
)
# The screen's handle for a shift: a keyed hash, since a call-off's open_row is the caller's own name.
POOL_REF_DDL = (
    "ALTER TABLE asa_shift_pool ADD COLUMN IF NOT EXISTS ref TEXT NOT NULL DEFAULT ''"
)
# Every roster day already worked, per person and house: the house calendars show only a few days, and the regular…
WORKED_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_house_worked_days ("
    "person_key TEXT NOT NULL, location TEXT NOT NULL, day DATE NOT NULL, "
    "seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (person_key, location, day))"
)
DDL = (PUBLISHED_DDL, POOL_DDL, POOL_REF_DDL, REQUESTS_DDL, REQUESTS_LIVE_INDEX_DDL, WORKED_DDL)

_BACKFILL_AGO = timedelta(days=400)


def _connect(dsn: str):
    return hub_db.connect(dsn)


def _ddl(cur) -> None:
    for statement in DDL:
        # ADD COLUMN IF NOT EXISTS still takes an ACCESS EXCLUSIVE lock, so check first.
        if statement is POOL_REF_DDL:
            cur.execute("SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('asa_shift_pool') "
                        "AND attname = 'ref' AND NOT attisdropped")
            if cur.fetchone():
                continue
        cur.execute(statement)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value or "")


class Refused(Exception):
    def __init__(self, why: str, code: str = "refused", **extra: Any) -> None:
        super().__init__(why)
        self.why, self.code, self.extra = why, code, extra


def _ref_key() -> bytes:
    """The HMAC key for pool handles; a plain hash would let a reader guess the caller's name."""
    raw = (os.getenv("HUB_SHIFT_REF_KEY") or os.getenv("HUB_SERVICE_SECRET")
           or os.getenv("HUB_SERVICE_TOKEN") or "")
    if not raw:
        return b""
    return hashlib.sha256(b"asa-hub shift pool ref|" + raw.encode("utf-8")).digest()


_REF_KEY = _ref_key()
if not _REF_KEY:
    import logging as _logging  # noqa: PLC0415 — one line, at import, only when it is true
    _REF_KEY = os.urandom(32)
    _logging.getLogger("hub.shift_requests").warning(
        "shift pool refs are keyed with this process's own random key — none of HUB_SHIFT_REF_KEY, "
        "HUB_SERVICE_SECRET or HUB_SERVICE_TOKEN is set, so a ref computed before a restart differs "
        "from one computed after it; the pool's stored refs still resolve")


def ref_of(location: str, open_row: str, col_iso: str) -> str:
    raw = f"{location}|{open_row}|{col_iso}".encode()
    return "SP" + hmac.new(_REF_KEY, raw, hashlib.sha256).hexdigest()[:10].upper()


def _legacy_ref(location: str, open_row: str, col_iso: str) -> str:
    raw = f"{location}|{open_row}|{col_iso}".encode()
    return "SP" + hashlib.sha256(raw).hexdigest()[:10].upper()


REF_RE = re.compile(r"\bSP[0-9A-F]{10}\b")


# The ledger serialises per cell, not per person, so clash check + claim run under a per-person advisory lock.
PERSON_LOCK_NS = int(os.getenv("HUB_SHIFT_REQUESTS_LOCK_NS", "8213"))


class _PersonGate:
    """Session advisory lock on a person; if it cannot be taken the checks still run, unserialised (`held`)."""

    def __init__(self, dsn: str, person: str) -> None:
        self.dsn, self.person, self.conn, self.held = dsn, person, None, False

    def __enter__(self) -> "_PersonGate":
        key = int(hashlib.sha1(fold(self.person).encode()).hexdigest()[:8], 16) % (2 ** 31)
        try:
            self.conn = _connect(self.dsn)
            self.conn.autocommit = True
            with self.conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_lock(%s,%s)", (PERSON_LOCK_NS, key))
            self.held = True
        except Exception:  # noqa: BLE001 — the checks still run, unserialised
            if self.conn is not None:
                try:
                    self.conn.close()
                except Exception:  # noqa: BLE001
                    pass
            self.conn = None
        return self

    def __exit__(self, *exc: Any) -> None:
        if self.conn is not None:
            try:
                self.conn.close()
            except Exception:  # noqa: BLE001
                pass
        self.conn, self.held = None, False


def person_gate(dsn: str, person: str) -> _PersonGate:
    return _PersonGate(dsn, person)


# ── the window ─────────────────────────────────────────────────────────────

def window_for(kind: str, *, opened_at: datetime, shift_start: datetime | None = None,
               now: datetime | None = None) -> dict[str, Any]:
    """The only window arithmetic; every screen and door must ask this one. state: open | closed | manager_only."""
    now = now or _now()
    reserved = kind == KIND_OPEN
    if kind == KIND_OPEN:
        closes = opened_at + timedelta(minutes=OPEN_SHIFT_APPLY_MIN)
        why = (f"reserved for this house's own staff for {OPEN_SHIFT_APPLY_MIN} minutes "
               f"from the moment the day was published")
        if shift_start is not None and closes > shift_start:
            closes = shift_start
            why = "reserved for this house's own staff until the shift starts"
    elif kind == KIND_CALLOFF:
        hard = opened_at + timedelta(hours=CALLOFF_APPLY_H)
        closes = hard
        why = f"open to all staff for {CALLOFF_APPLY_H:g} hours from the call-off"
        if shift_start is not None:
            fence = shift_start - timedelta(minutes=CALLOFF_APPLY_BEFORE_START_MIN)
            if fence < closes:
                closes = fence
                why = (f"open to all staff until {CALLOFF_APPLY_BEFORE_START_MIN} minutes "
                       f"before the shift starts")
        floor = opened_at + timedelta(minutes=CALLOFF_APPLY_FLOOR_MIN)
        if closes < floor:
            # Floored, but never past the shift's start.
            if shift_start is not None and floor >= shift_start:
                return {"kind": kind, "opens_at": _iso(opened_at), "closes_at": _iso(opened_at),
                        "state": WINDOW_MANAGER_ONLY, "seconds_left": 0, "reserved": False,
                        "why": (f"the shift starts in under {CALLOFF_APPLY_FLOOR_MIN} minutes, so "
                                f"there is no time to take applications — the house manager "
                                f"assigns it")}
            closes = floor
            why = (f"the shift is close, so the window is the shortest one that is still a "
                   f"window: {CALLOFF_APPLY_FLOOR_MIN} minutes")
    else:
        raise ValueError(f"{kind} has no application window")

    state = WINDOW_OPEN if now < closes else WINDOW_CLOSED
    left = int((closes - now).total_seconds()) if state == WINDOW_OPEN else 0
    return {"kind": kind, "opens_at": _iso(opened_at), "closes_at": _iso(closes),
            "state": state, "seconds_left": left, "reserved": reserved, "why": why}


# ── time ───────────────────────────────────────────────────────────────────

def at_hour(day: date, hour: float) -> datetime:
    """26.5 is 2:30 the next morning, as the grammar writes an overnight."""
    return datetime.combine(day, clock_time(0, 0), tzinfo=OHIO) + timedelta(hours=float(hour))


def day_of(col_iso: str) -> date | None:
    try:
        y, m, d = (int(p) for p in str(col_iso).split("-")[:3])
        return date(y, m, d)
    except Exception:  # noqa: BLE001 — a column that is not a day has no span
        return None


def span_of(col_iso: str, text: str) -> tuple[datetime, datetime] | None:
    """The interval one roster cell occupies, via shift_slices.classify; None when it holds no hours."""
    day = day_of(col_iso)
    if day is None:
        return None
    shift = shift_slices.classify(str(text or ""))
    if not shift or shift.get("start") is None or shift.get("end") is None:
        return None
    return at_hour(day, float(shift["start"])), at_hour(day, float(shift["end"]))


def overlaps(a: tuple[datetime, datetime], b: tuple[datetime, datetime]) -> bool:
    """Half-open: ending at 8 and starting at 8 is a handover, not an overlap."""
    return a[0] < b[1] and b[0] < a[1]


UNREADABLE = "unreadable"


def unreadable_hours(value: Any) -> bool:
    """A working cell whose hours nobody can read — classify's alias. Empty, OFF and R/O hold no hours."""
    got = shift_slices.classify(str(value or ""))
    return bool(got) and got.get("kind") == "alias"


def whole_day(col_iso: Any) -> tuple[datetime, datetime] | None:
    """The day a cell with unreadable hours is held for: nothing else may stand beside it."""
    day = day_of(str(col_iso or ""))
    return (at_hour(day, 0), at_hour(day, 24)) if day else None


def clash_for(span: tuple[datetime, datetime] | None,
              held: Iterable[dict[str, Any]], *, col_iso: str = "",
              value: str = "") -> dict[str, Any] | None:
    """The first held shift the span collides with."""
    unread = span is None and unreadable_hours(value)
    if unread:
        span = whole_day(col_iso)
        if span is None:
            return {"location": "", "col_iso": str(col_iso or ""), "value": str(value or ""),
                    "source": UNREADABLE}
    if span is None:
        return None
    for h in held:
        other = h.get("span")
        if other and overlaps(span, other):
            if unread:
                return {"location": "", "col_iso": str(col_iso or ""), "value": str(value or ""),
                        "source": UNREADABLE}
            return h
    return None


def _day_words(col_iso: Any) -> str:
    d = day_of(str(col_iso or ""))
    return f"{d.strftime('%a')} {d.month}/{d.day}" if d else str(col_iso or "")


def _unreadable_words(clash: dict[str, Any]) -> str:
    where = short_house(str(clash.get("location") or "")) if clash.get("location") else ""
    what = str(clash.get("value") or "").strip() or "a cell"
    return (f"the hours of {what}{f' at {where}' if where else ''} on {clash.get('col_iso') or ''} cannot "
            f"be read, so it cannot be shown not to overlap — fix the cell first")


def clash_sentence(clash: dict[str, Any]) -> str:
    where = short_house(str(clash.get("location") or ""))
    what = str(clash.get("value") or "").strip() or "a shift"
    when = str(clash.get("col_iso") or "")
    source = str(clash.get("source") or "")
    if source == UNREADABLE:
        return _unreadable_words(clash)
    if source == "time_off":
        return (f"that falls in approved time off from {_day_words(when)} to "
                f"{_day_words(clash.get('until') or when)}")
    tail = {"application": " (a shift they have applied for)",
            "handoff": " (a shift being handed to them)",
            "claim": " (a shift they have already been given)",
            "draft": " (a shift drafted on Calendar Builder, not published yet)",
            TRAINING: (f" (the training they give {clash.get('trainee') or 'somebody'} on a first "
                       f"shift there)")}.get(source, "")
    return f"that overlaps the {what} shift at {where} on {when}{tail}"


# a clash never carries `open_row`, which for a call-off is the caller's name
CLASH_FIELDS = ("location", "col_iso", "value", "source", "until")


def clash_out(clash: dict[str, Any] | None) -> dict[str, Any]:
    return {k: clash.get(k) for k in CLASH_FIELDS if k in clash} if clash else {}


def clash_verdict(person: str, clash: dict[str, Any], *, you: bool = False) -> tuple[str, str]:
    """(code, why): the one place a refusal for a held interval is worded."""
    who = "you are" if you else f"{person} {'are' if person == 'they' else 'is'}"
    if str(clash.get("source") or "") == UNREADABLE:
        return "unreadable_hours", _unreadable_words(clash)
    if str(clash.get("source") or "") == "time_off":
        return "time_off", (f"{who} on approved time off from {_day_words(clash.get('col_iso'))} "
                            f"to {_day_words(clash.get('until') or clash.get('col_iso'))}")
    return "overlap", f"{who} already working something {clash_sentence(clash)}"


def short_house(location: str) -> str:
    return house_directory.label_of(location, house_directory.code_of(location)) or location


# ── the estate, read once ──────────────────────────────────────────────────

ESTATE_TTL_S = float(os.getenv("HUB_SHIFT_REQUESTS_ESTATE_TTL_S", "20"))
_ESTATE_LOCK = threading.Lock()
_ESTATE: dict[str, Any] = {"at": 0.0, "view": None}


def estate(dsn: str, *, fresh: bool = False) -> dict[str, Any]:
    """Every house grid with its overrides on top, indexed several ways and held ESTATE_TTL_S."""
    now = time.time()
    with _ESTATE_LOCK:
        held = _ESTATE.get("view")
        if held is not None and not fresh and now - float(_ESTATE["at"]) < ESTATE_TTL_S:
            return held
        # a read that began before a write must not restore its older picture
        started = int(_ESTATE.get("gen") or 0)

    view: dict[str, Any] = {"locations": [], "by_code": {}, "cells": {}, "isos": {},
                            "people": {}, "spans": {}, "unreadable": {}, "worked": {},
                            "read_at": _iso(_now())}
    house_cal_live.ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor() as cur:
        grids = hub_db.beside(cur, dsn, "SELECT location, grid FROM asa_house_calendar_live ORDER BY location")
        cur.execute("SELECT location, employee, col_iso, value FROM asa_house_calendar_overrides")
        overrides: dict[str, dict[tuple[str, str], str]] = {}
        for loc, emp, iso, val in cur.fetchall():
            overrides.setdefault(loc, {})[(emp, iso)] = val
        published = house_cal_live.pending_publishes(cur)

    for loc, raw in grids:
        grid = house_cal_live._as_dict(raw)
        isos = house_cal_live.col_isos(grid)
        view["locations"].append(loc)
        view["isos"][loc] = isos
        code = house_directory.code_of(loc)
        if code:
            view["by_code"][code] = loc
        cells: dict[tuple[str, str], str] = {}
        people: list[str] = []
        for row in grid.get("rows", []) or []:
            emp = str(row.get("employee") or "")
            if not emp:
                continue
            people.append(emp)
            drawn = row.get("cells", []) or []
            for i, iso in enumerate(isos):
                text = str((drawn[i] or {}).get("text") or "") if i < len(drawn) else ""
                text = overrides.get(loc, {}).get((emp, iso), text)
                if text.strip():
                    cells[(emp, iso)] = text
        for (emp, iso), value in overrides.get(loc, {}).items():
            if value.strip() and (emp, iso) not in cells:
                cells[(emp, iso)] = value
                if emp not in people:
                    people.append(emp)
        for (emp, iso), value in published.get(loc, {}).items():
            if iso not in isos:
                continue
            if str(value).strip():
                cells[(emp, iso)] = value
                if emp not in people:
                    people.append(emp)
            else:
                cells.pop((emp, iso), None)
        view["cells"][loc] = cells
        view["people"][loc] = people
        for (emp, iso), text in cells.items():
            if not_a_person(emp, loc):
                continue
            key = fold(emp)
            span = span_of(iso, text)
            if span is None:
                # OFF and R/O hold no hours.
                whole = whole_day(iso) if unreadable_hours(text) else None
                if whole:
                    view["unreadable"].setdefault(key, []).append(
                        {"location": loc, "employee": emp, "col_iso": iso, "value": text,
                         "span": whole, "source": UNREADABLE})
                continue
            day = day_of(iso)
            if day is not None:
                view["worked"].setdefault((key, loc), set()).add(day)
            view["spans"].setdefault(key, []).append(
                {"location": loc, "employee": emp, "col_iso": iso, "value": text,
                 "span": span, "source": "roster"})

    # The regular test's record: the days the calendars no longer draw, and where each house's record begins (the…
    record = _worked_record(dsn, datetime.now(OHIO).date())
    for pair, days in record["worked"].items():
        view["worked"].setdefault(pair, set()).update(days)
    view["worked_since"] = {}
    for loc in view["locations"]:
        firsts = [d for d in (min((day_of(i) for i in view["isos"].get(loc, []) if day_of(i)),
                                  default=None), record["since"].get(loc)) if d]
        view["worked_since"][loc] = min(firsts) if firsts else None
    view["worked_why"] = record["why"]

    with _ESTATE_LOCK:
        if int(_ESTATE.get("gen") or 0) == started:
            _ESTATE["at"], _ESTATE["view"] = now, view
    return view


_WORKED_READY: set[str] = set()


def _worked_record(dsn: str, today: date) -> dict[str, Any]:
    """{worked, since, why}: the remembered roster days of the regular window, and each house's first remembered…"""
    out: dict[str, Any] = {"worked": {}, "since": {}, "why": ""}
    try:
        with _connect(dsn) as conn, conn.cursor() as cur:
            if dsn not in _WORKED_READY:
                cur.execute(WORKED_DDL)
                _WORKED_READY.add(dsn)
            cur.execute("SELECT person_key, location, day FROM asa_house_worked_days WHERE day >= %s",
                        (today - timedelta(days=OPEN_SHIFT_REGULAR_DAYS + 1),))
            for key, loc, d in cur.fetchall():
                out["worked"].setdefault((str(key), str(loc)), set()).add(d)
            cur.execute("SELECT location, min(day) FROM asa_house_worked_days GROUP BY location")
            out["since"] = {str(loc): d for loc, d in cur.fetchall() if d}
            conn.commit()
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: the grids alone cover fewer days, said as such
        _WORKED_READY.discard(dsn)
        out["why"] = f"the worked-days record could not be read ({type(exc).__name__})"
    return out


def note_worked_days(dsn: str, *, view: dict[str, Any], now: datetime | None = None) -> int:
    """Remember every roster day already worked (never a future one) per person and house."""
    today = (now or _now()).astimezone(OHIO).date()
    floor = today - timedelta(days=OPEN_SHIFT_REGULAR_DAYS + 7)
    rows = sorted({(key, loc, d) for (key, loc), days in (view.get("worked") or {}).items()
                   for d in days if floor <= d <= today})
    if not rows:
        return 0
    with _connect(dsn) as conn, conn.cursor() as cur:
        _ddl(cur)
        psycopg2.extras.execute_values(
            cur, "INSERT INTO asa_house_worked_days (person_key, location, day) VALUES %s "
                 "ON CONFLICT DO NOTHING", rows)
        added = max(cur.rowcount, 0)
        conn.commit()
    return added


def forget_estate() -> None:
    with _ESTATE_LOCK:
        _ESTATE["at"], _ESTATE["view"] = 0.0, None
        _ESTATE["gen"] = int(_ESTATE.get("gen") or 0) + 1


def fold(name: Any) -> str:
    """The platform's own name key (`clientNameKey_`)."""
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())


def grid_name(view: dict[str, Any], name: str, location: str = "", *,
              this_house_only: bool = False) -> str:
    """The name as the calendars spell it (this house first), or ''; writes are keyed by that spelling."""
    key = fold(name)
    if not key:
        return ""
    houses = [location] if this_house_only else \
        [location] + [x for x in view.get("locations") or [] if x != location]
    for loc in houses:
        for n in (view.get("people") or {}).get(loc, []):
            if fold(n) == key and not not_a_person(n, loc):
                return n
    return ""


# ── what a person already holds ────────────────────────────────────────────

DRAFTS_ADD = "add"
DRAFTS_PLAN = "plan"
DRAFTS_NONE = "none"


def held_by(dsn: str, person: str, *, view: dict[str, Any] | None = None,
            skip: tuple[str, str, str] | list[tuple[str, str, str]] | None = None,
            ignore_handoff: str = "", drafts: str = DRAFTS_ADD,
            picture: dict[tuple[str, str, str], str] | None = None) -> list[dict[str, Any]]:
    view = view or estate(dsn)
    got = _held_of(dsn, [person], view=view, ignore_handoff=ignore_handoff, drafts=drafts,
                   picture=picture)
    return _skipping(got.get(fold(person), []), skip)


def held_by_many(dsn: str, people: Iterable[str], *, view: dict[str, Any] | None = None,
                 drafts: str = DRAFTS_ADD) -> dict[str, list[dict[str, Any]]]:
    view = view or estate(dsn)
    names = list(dict.fromkeys(str(p or "").strip() for p in people if str(p or "").strip()))
    got = _held_of(dsn, names, view=view, drafts=drafts)
    return {n: got.get(fold(n), []) for n in names}


# A column's platform name key, in SQL: the same fold as fold().
_FOLD_SQL = "regexp_replace(lower({}), '[^a-z0-9]+', '', 'g')"


def _held_of(dsn: str, names: list[str], *, view: dict[str, Any], ignore_handoff: str = "",
             drafts: str = DRAFTS_ADD,
             picture: dict[tuple[str, str, str], str] | None = None
             ) -> dict[str, list[dict[str, Any]]]:
    """Everything each person holds, keyed by fold(name): the roster, applications, claims, swaps handed to them…"""
    import shift_handoff  # noqa: PLC0415 — lazy: shift_handoff asks this file back
    given = {fold(n): n.strip() for n in names if n and fold(n)}
    lowered = sorted(given)
    out: dict[str, list[dict[str, Any]]] = {
        lo: [dict(h) for h in view["spans"].get(lo, [])]
        + [dict(h) for h in (view.get("unreadable") or {}).get(lo, [])] for lo in lowered}
    if not lowered:
        return out
    planned: dict[str, list[dict[str, Any]]] = {}
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        cur.execute(shift_handoff.HANDOFFS_DDL)
        cur.execute(house_cal_live.CLAIMS_DDL)
        person_key = _FOLD_SQL.format("person")
        cur.execute(
            f"SELECT {person_key} AS who, location, open_row, col_iso, value FROM asa_shift_requests "
            f"WHERE {person_key} = ANY(%s) AND state = ANY(%s) AND kind <> %s",
            (lowered, list(LIVE_STATES), KIND_IST))
        for r in cur.fetchall():
            span = span_of(r["col_iso"], r["value"])
            if span and r["who"] in out:
                out[r["who"]].append({"location": r["location"], "employee": given[r["who"]],
                                      "col_iso": r["col_iso"], "value": r["value"], "span": span,
                                      "open_row": r["open_row"], "source": "application"})
        claimer_key = _FOLD_SQL.format("claimed_by")
        cur.execute(
            f"SELECT {claimer_key} AS who, location, open_row, col_iso, value "
            f"FROM asa_house_calendar_claims WHERE {claimer_key} = ANY(%s)", (lowered,))
        for r in cur.fetchall():
            span = span_of(r["col_iso"], r["value"])
            if span and r["who"] in out:
                out[r["who"]].append({"location": r["location"], "employee": given[r["who"]],
                                      "col_iso": r["col_iso"], "value": r["value"], "span": span,
                                      "open_row": r["open_row"], "source": "claim"})
        taker_key = _FOLD_SQL.format("to_staff")
        cur.execute(
            f"SELECT {taker_key} AS who, id, location, col_iso, value, from_staff "
            f"FROM asa_shift_handoffs WHERE state='pending' AND {taker_key} = ANY(%s) "
            f"AND id <> %s", (lowered, ignore_handoff or ""))
        for r in cur.fetchall():
            span = span_of(r["col_iso"], r["value"])
            if span and r["who"] in out:
                out[r["who"]].append({"location": r["location"], "employee": given[r["who"]],
                                      "col_iso": r["col_iso"], "value": r["value"], "span": span,
                                      "ref": r["id"], "source": "handoff"})
        since = (datetime.now(OHIO).date() - timedelta(days=1)).isoformat()
        trainer_key = _FOLD_SQL.format("r.extra->'trainer'->>'name'")
        cur.execute(
            f"SELECT {trainer_key} AS who, r.location, r.open_row, r.col_iso, "
            f"r.value, r.person, "
            f"EXISTS (SELECT 1 FROM asa_house_calendar_claims c WHERE c.location=r.location "
            f"AND c.col_iso=r.col_iso AND {_FOLD_SQL.format('c.claimed_by')}={_FOLD_SQL.format('r.person')}) "
            f"AS claimed "
            f"FROM asa_shift_requests r WHERE r.kind=%s AND r.state=%s "
            f"AND {trainer_key} = ANY(%s) AND r.col_iso >= %s",
            (KIND_IST, APPROVED, lowered, since))
        for r in cur.fetchall():
            span = span_of(r["col_iso"], r["value"])
            if span and r["who"] in out and (r["claimed"] or _still_holds(
                    view, r["person"], r["location"], r["col_iso"], span)):
                out[r["who"]].append({"location": r["location"], "employee": given[r["who"]],
                                      "col_iso": r["col_iso"], "value": r["value"], "span": span,
                                      "open_row": r["open_row"], "trainee": r["person"],
                                      "source": TRAINING})
        if drafts != DRAFTS_NONE:
            try:
                import calendar_builder_houses  # noqa: PLC0415 — it asks this file back
                calendar_builder_houses.ensure_tables(dsn)
                by_key: dict[str, list[dict[str, Any]]] = {}
                for d in calendar_builder_houses.drafts_of_people(
                        cur, [given[lo] for lo in lowered]):
                    by_key.setdefault(fold(d["employee"]), []).append(d)
                planned = {lo: list(by_key.get(fold(given[lo]), [])) for lo in lowered}
            except ImportError:
                planned = {}
    import time_off  # noqa: PLC0415 — lazy: it imports this file back
    away = time_off.away(dsn, [given[lo] for lo in lowered])
    for lo in lowered:
        out[lo] = _laid(out[lo], planned.get(lo, []), fold(given[lo]), drafts=drafts,
                        picture=picture)
        out[lo].extend(dict(i) for i in away.get(fold(given[lo]), []))
    return out


def _laid(held: list[dict[str, Any]], planned: list[dict[str, Any]], key: str, *,
          drafts: str, picture: dict[tuple[str, str, str], str] | None
          ) -> list[dict[str, Any]]:
    out = held
    replace: dict[tuple[str, str], tuple[str, str]] = {}
    if drafts == DRAFTS_PLAN:
        for d in planned:
            replace[(d["location"], d["col_iso"])] = (d["employee"], d["value"])
    for (loc, emp, iso), value in (picture or {}).items():
        if fold(emp) == key:
            replace[(loc, iso)] = (emp, value)
    if replace:
        out = [h for h in out
               if not (h.get("source") in ("roster", UNREADABLE)
                       and (h["location"], h["col_iso"]) in replace)]
        for (loc, iso), (emp, value) in replace.items():
            got = _drafted_hold(loc, emp, iso, value)
            if got:
                out.append(got)
    if drafts == DRAFTS_ADD:
        rostered = {(h["location"], h["col_iso"], str(h.get("value") or "").strip())
                    for h in out if h.get("source") in ("roster", UNREADABLE)}
        for d in planned:
            if (d["location"], d["col_iso"], d["value"].strip()) in rostered:
                continue
            got = _drafted_hold(d["location"], d["employee"], d["col_iso"], d["value"])
            if got:
                out.append({**d, **got})
    return out


def _drafted_hold(location: str, employee: str, col_iso: str, value: str) -> dict[str, Any] | None:
    """A drafted cell as a held entry: its hours, or its whole day when they cannot be read."""
    if house_cal_live.is_open_row(employee):
        return None
    span = span_of(col_iso, value)
    if span:
        return {"location": location, "employee": employee, "col_iso": col_iso, "value": value,
                "span": span, "source": "draft"}
    whole = whole_day(col_iso) if unreadable_hours(value) else None
    if whole:
        return {"location": location, "employee": employee, "col_iso": col_iso, "value": value,
                "span": whole, "source": UNREADABLE}
    return None


def _still_holds(view: dict[str, Any], person: str, location: str, col_iso: str,
                 span: tuple[datetime, datetime]) -> bool:
    return any(h["location"] == location and h["col_iso"] == col_iso
               and overlaps(h["span"], span)
               for h in view["spans"].get(fold(person), []))


def _skipping(held: list[dict[str, Any]],
              skip: tuple[str, str, str] | list[tuple[str, str, str]] | None
              ) -> list[dict[str, Any]]:
    if not skip:
        return held
    cells = [skip] if isinstance(skip, tuple) else list(skip)
    return [h for h in held
            if not any(h["location"] == loc and h["col_iso"] == iso
                       and (h.get("employee") == row or h.get("open_row") == row)
                       for loc, row, iso in cells)]


def regular_state(view: dict[str, Any], person: str, location: str, *,
                  today: date | None = None, days: int | None = None) -> dict[str, Any]:
    """{state, covered}: 'yes' (a shift there in the window), 'no' (the record covers the whole window and holds…"""
    today = today or datetime.now(OHIO).date()
    days = OPEN_SHIFT_REGULAR_DAYS if days is None else days
    floor = today - timedelta(days=days)
    worked = view["worked"].get((fold(person), location)) or set()
    if any(floor <= d <= today for d in worked):
        return {"state": "yes", "covered": days}
    since = (view.get("worked_since") or {}).get(location)
    if since is None or since > floor:
        return {"state": "unknown", "covered": max(0, (today - since).days + 1) if since else 0}
    return {"state": "no", "covered": days}


def is_regular(view: dict[str, Any], person: str, location: str, *,
               today: date | None = None, days: int | None = None) -> bool:
    """Shown to be a regular of the house; an absence the record cannot vouch for is not a yes."""
    return regular_state(view, person, location, today=today, days=days)["state"] == "yes"


# ── IST: trained for that house, or the house manager approves ─────────────

IST_TTL_S = float(os.getenv("HUB_SHIFT_REQUESTS_IST_TTL_S", "300"))
_IST_LOCK = threading.Lock()
_IST: dict[str, Any] = {"at": 0.0, "view": None}


def _ist_rows(cur) -> tuple[list[dict[str, Any]], str]:
    """(rows, where) from the declared IST house (both tab spellings), or ([], why) — never another book's."""
    book = lanes_sheets.fact("HUB_HOUSE_IST_RECORDS_ID")
    if not book:
        return [], "the IST house is not declared (HUB_HOUSE_IST_RECORDS_ID)"
    for tab in ("Data", "ist_records"):
        rows = lanes_sheets.data(book, tab)
        if rows:
            return rows, f"{book}/{tab}"
    return [], f"the declared IST house {book} holds no rows in Data or ist_records"


def ist_index(dsn: str, *, fresh: bool = False) -> dict[str, Any]:
    """{readable, why, by_person}; an unreadable book makes every verdict `unreadable`, never a pass."""
    now = time.time()
    with _IST_LOCK:
        held = _IST.get("view")
        if held is not None and not fresh and now - float(_IST["at"]) < IST_TTL_S:
            return held
    view: dict[str, Any] = {"readable": False, "why": "", "by_person": {}, "rows": 0,
                            "source": "", "rules": ist_config.current(),
                            "mapped": {}, "mapped_readable": False}
    try:
        with hub_db.intel(dsn) as conn, conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            view["rules"] = ist_config.rules(cur=cur)
            rows, source = _ist_rows(cur)
            view["mapped"], view["mapped_readable"] = _ist_mapped_clients(cur)
        view["source"] = source
    except Exception as exc:  # noqa: BLE001
        view["why"] = f"the IST book could not be read ({type(exc).__name__})"
        with _IST_LOCK:
            _IST["at"], _IST["view"] = now, view
        return view
    if ist_config.unread():
        # FAIL-CLOSED: the shipped settings answer only because no read landed; a verdict on them would decide who…
        view["why"] = ist_config.UNREAD_WHY
        with _IST_LOCK:
            _IST["at"], _IST["view"] = now, view
        return view
    if not rows:
        view["why"] = f"{source}, so nobody can be shown to be trained"
        with _IST_LOCK:
            _IST["at"], _IST["view"] = now, view
        return view
    view["readable"] = True
    view["rows"] = len(rows)
    for d in rows:
        who = fold(d.get("staffName"))
        code = str(d.get("house") or "").strip().upper()
        if not who or not code:
            continue
        slot = view["by_person"].setdefault(who, {}).setdefault(
            code, {"done": 0, "owed": 0, "clients": [], "owed_for": [], "rows": []})
        at = str(d.get("trainedAt") or "").strip()
        trained = (str(d.get("status") or "").strip().lower() == ist_config.IST_STATUS_DONE
                   or bool(at))
        client = str(d.get("clientName") or "").strip()
        slot["rows"].append({"client": client, "done": bool(trained), "at": at[:10]})
        if trained:
            slot["done"] += 1
            if client and client not in slot["clients"]:
                slot["clients"].append(client)
        else:
            slot["owed"] += 1
            if client and client not in slot["owed_for"]:
                slot["owed_for"].append(client)
    with _IST_LOCK:
        _IST["at"], _IST["view"] = now, view
    return view


def forget_ist() -> None:
    with _IST_LOCK:
        _IST["at"], _IST["view"] = 0.0, None


def _ist_mapped_clients(cur) -> tuple[dict[str, list[str]], bool]:
    """{house code: [client, …]} from the active `ist_houses` rows, and whether it could be read."""
    try:
        rows, _sid = lanes_sheets.house_rows("ist_houses")
    except Exception:  # noqa: BLE001 — unreadable is said by the flag, never an empty map
        return {}, False
    out: dict[str, list[str]] = {}
    for r in rows or []:
        if str((r or {}).get("active") or "yes").strip().lower() == "no":
            continue
        code = str((r or {}).get("house") or "").strip().upper()
        client = str((r or {}).get("clientName") or "").strip()
        if code and client and client not in out.setdefault(code, []):
            out[code].append(client)
    return out, bool(rows)


def not_a_person(name: Any, location: Any = "", rules: dict[str, str] | None = None) -> bool:
    """An OPEN or WORKSHOP row, or a coverage label from the IST settings (ist_non_person_*)."""
    return house_cal_live.not_a_person(name, location) or ist_config.not_a_person(name, rules)


def _ist_current(row: dict[str, Any], valid_days: int, today: date) -> bool:
    """A completed IST still inside ist_valid_days; ist_config.lapsed is the one rule the board and the SPA share."""
    return bool(row.get("done")) and not ist_config.lapsed(row.get("at"), valid_days, today)


def ist_verdict(index: dict[str, Any], person: str, location: str,
                rules: dict[str, str] | None = None) -> dict[str, Any]:
    """{ok, state, why}; state is ok | not_a_person | missing | owed | unreadable."""
    rules = rules if rules is not None else (index.get("rules") or ist_config.current())
    house = short_house(location) or location
    # a name the IST book already knows as a trainee is a person, whatever a label cell says
    if (str(person or "").strip() and ist_config.not_a_person(person, rules)
            and not (index.get("by_person") or {}).get(fold(person))):
        return {"ok": True, "state": "not_a_person",
                "why": (f"“{str(person).strip()}” is a coverage label in the IST settings, not a "
                        f"person — there is nobody to train")}
    if not index.get("readable"):
        return {"ok": False, "state": "unreadable",
                "why": (f"the IST record could not be read ({index.get('why') or 'no reason given'}), "
                        f"so it cannot be shown that this person is trained at {house} — "
                        f"the house manager must approve and own the training")}
    code = house_directory.code_of(location) or str(location or "").strip().upper()
    slot = (index["by_person"].get(fold(person)) or {}).get(code)
    valid_days = ist_config.int_of(rules, "ist_valid_days")
    today = ist_config.ohio_today()
    rows = (slot or {}).get("rows")
    if rows is None and slot:
        # an index without per-row detail: its counts, undated
        rows = [{"client": c, "done": True, "at": ""} for c in slot.get("clients") or []]
        rows += [{"client": "", "done": True, "at": ""}] * max(0, int(slot.get("done") or 0) - len(rows))
    current = [r for r in rows or [] if _ist_current(r, valid_days, today)]
    lapsed = [r for r in rows or [] if r.get("done") and r not in current]
    if ist_config.choice(rules, "ist_trained_scope") == "client":
        if not index.get("mapped_readable", False):
            return {"ok": False, "state": "unreadable",
                    "why": (f"the house → client map could not be read, and the IST settings ask for "
                            f"an IST on every client at {house} — so it cannot be shown that this "
                            f"person is trained there; the house manager must approve and own it")}
        need = (index.get("mapped") or {}).get(code) or []
        have = {fold(r.get("client")) for r in current}
        short = [c for c in need if fold(c) not in have]
        if need and not short:
            return {"ok": True, "state": "ok",
                    "why": f"trained at {house} on every client there ({len(need)} IST on file)"}
        if need:
            return {"ok": False, "state": "owed" if rows else "missing",
                    "why": (f"no IST for {house} on {', '.join(short[:3])}"
                            + (f" and {len(short) - 3} more" if len(short) > 3 else "")
                            + " — the IST settings ask for every client there — the house manager "
                              "must approve and own it")}
    if current:
        return {"ok": True, "state": "ok",
                "why": f"trained at {house} ({len(current)} IST on file)"}
    if lapsed:
        return {"ok": False, "state": "owed",
                "why": (f"the IST for {house} lapsed — recorded {lapsed[0].get('at')}, and the IST "
                        f"settings count one for {valid_days} days — the house manager must approve "
                        f"and own it")}
    if slot and slot["owed"]:
        owed = ", ".join(slot["owed_for"][:3])
        return {"ok": False, "state": "owed",
                "why": (f"no IST for {house} — the training is on file as still owed"
                        + (f" ({owed})" if owed else "")
                        + " — the house manager must approve and own it")}
    return {"ok": False, "state": "missing",
            "why": (f"no IST for {house} — nothing on file says this person has been trained "
                    f"there — the house manager must approve and own it")}


# ── who manages a house: the hotline calendar's ** row ─────────────────────

HOTLINE_TAB = os.getenv("HUB_HOTLINE_CALENDAR_TAB", "Calendar Archive")
ESSENCIAL_SHEET_ID = os.getenv(
    "HUB_ESSENCIAL_SHEET_ID", "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug")
MANAGERS_TTL_S = float(os.getenv("HUB_SHIFT_REQUESTS_MANAGERS_TTL_S", "600"))
_MANAGERS_LOCK = threading.Lock()
_MANAGERS: dict[str, Any] = {"at": 0.0, "view": None}


MANAGERS_CURRENT_DAYS = int(os.getenv("HUB_HOUSE_MANAGER_CURRENT_DAYS", "7"))


def _row_day(raw: Any) -> date | None:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text.split()[0], "%m/%d/%Y").date()
    except ValueError:
        pass
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def managers_from_rows(rows: Iterable[dict[str, Any]], *, today: date) -> dict[str, dict[str, Any]]:
    """code → {name, names, phone, house, last_day}: the latest ** row on or before today, never the first."""
    per: dict[str, list[tuple[date | None, int, dict[str, Any]]]] = {}
    for order, d in enumerate(rows):
        if not isinstance(d, dict):
            continue
        where = str(d.get("Location") or "").strip()
        code = house_directory.code_of(where) or where.upper()
        name = str(d.get("Employee") or "").strip()
        if not code or not name:
            continue
        per.setdefault(code, []).append((_row_day(d.get("Date")), order, d))
    lo = today - timedelta(days=MANAGERS_CURRENT_DAYS)
    hi = today + timedelta(days=MANAGERS_CURRENT_DAYS)
    out: dict[str, dict[str, Any]] = {}
    for code, items in per.items():
        dated = [x for x in items if x[0] is not None]
        past = [x for x in dated if x[0] <= today]
        if past:
            anchor = max(past, key=lambda x: (x[0], x[1]))
        elif dated:
            anchor = min(dated, key=lambda x: (x[0], x[1]))
        else:
            anchor = max(items, key=lambda x: x[1])
        first = str(anchor[2].get("Employee") or "").strip()
        latest: dict[str, tuple[date, int]] = {}
        for day, order, d in dated:
            if lo <= day <= hi:
                nm = str(d.get("Employee") or "").strip()
                if nm not in latest or (day, order) > latest[nm]:
                    latest[nm] = (day, order)
        names = [first] + [nm for nm, _ in sorted(latest.items(), key=lambda kv: kv[1], reverse=True)
                           if fold(nm) != fold(first)]
        out[code] = {"name": first, "names": names,
                     "phone": str(anchor[2].get("Phone") or "").strip(),
                     "house": str(anchor[2].get("Location") or "").strip(),
                     "last_day": anchor[0].isoformat() if anchor[0] else ""}
    return out


def house_managers(dsn: str, *, fresh: bool = False,
                   today: date | None = None) -> dict[str, Any]:
    now = time.time()
    with _MANAGERS_LOCK:
        held = _MANAGERS.get("view")
        if held is not None and not fresh and today is None \
                and now - float(_MANAGERS["at"]) < MANAGERS_TTL_S:
            return held
    view: dict[str, Any] = {"readable": False, "why": "", "by_code": {}}
    try:
        book = lanes_sheets.fact("HOTLINE_CALENDAR_ID")
        if not book:
            view["why"] = "the platform declares no HOTLINE_CALENDAR_ID"
            with _MANAGERS_LOCK:
                _MANAGERS["at"], _MANAGERS["view"] = now, view
            return view
        rows = [d for d in lanes_sheets.data(book, HOTLINE_TAB)
                if lanes_sheets.text(d.get("Designation")).strip() == "**"]
    except Exception as exc:  # noqa: BLE001
        view["why"] = f"the hotline calendar mirror could not be read ({type(exc).__name__})"
        with _MANAGERS_LOCK:
            _MANAGERS["at"], _MANAGERS["view"] = now, view
        return view
    view["readable"] = True
    view["by_code"] = managers_from_rows(rows, today=today or datetime.now(OHIO).date())
    if not view["by_code"]:
        view["why"] = f"the hotline calendar's {HOTLINE_TAB} tab holds no ** rows"
    if today is None:
        with _MANAGERS_LOCK:
            _MANAGERS["at"], _MANAGERS["view"] = now, view
    return view


def forget_managers() -> None:
    with _MANAGERS_LOCK:
        _MANAGERS["at"], _MANAGERS["view"] = 0.0, None


def _is_manager_of(hm: dict[str, Any] | None, person: str) -> bool:
    key = fold(person)
    if not hm or not key:
        return False
    return any(fold(n) == key for n in (hm.get("names") or [hm.get("name")]))


def manages(dsn: str, person: str, location: str) -> bool:
    if not person.strip():
        return False
    code = house_directory.code_of(location) or str(location or "").strip().upper()
    return _is_manager_of(house_managers(dsn)["by_code"].get(code), person)


def houses_managed(dsn: str, person: str) -> list[str]:
    if not fold(person):
        return []
    return sorted(code for code, hm in house_managers(dsn)["by_code"].items()
                  if _is_manager_of(hm, person))


# ── the badge: what the list shows and what a reader may do ────────────────

def badges_of(role: Any, types: Any) -> set[str]:
    worn: set[str] = set()
    if isinstance(types, str):
        worn |= {t.strip().upper() for t in re.split(r"[,;|\n]+", types) if t.strip()}
    elif isinstance(types, (list, tuple, set)):
        worn |= {str(t).strip().upper() for t in types if str(t).strip()}
    # an SSA's or a FAMILY's role word is never a badge (scope.role_counts)
    if role and badge_follows.role_counts(list(worn), role):
        worn.add(str(role).strip().upper())
    return badge_follows.with_followed(worn)


# Derived on every read for a current ** manager's own houses, never written.
CALENDAR_BADGE = "HM"


def viewer(dsn: str, *, name: str, role: str = "", types: Any = None,
           is_master: bool | None = None) -> dict[str, Any]:
    worn = badges_of(role, types)
    if is_master:
        worn.add("MASTER")
    whole = bool(worn & MANAGER_BADGES)
    mine = houses_managed(dsn, name)
    everywhere = bool(worn & REASON_BADGES)
    derived = bool(mine) and CALENDAR_BADGE not in worn
    if derived:
        worn.add(CALENDAR_BADGE)
    readable = True
    if fold(name):
        try:
            readable = bool(house_managers(dsn).get("readable"))
        except Exception:  # noqa: BLE001 — said, not raised: the reader is still built
            readable = False
    return {"name": name, "badges": sorted(worn), "whole_company": whole,
            "sees_reasons": everywhere, "manages": mine,
            "decides_everywhere": everywhere, "decides": mine,
            "role": str(role or "").strip().lower(), "managers_readable": readable,
            "hm_by_calendar": derived, "is_master": bool(is_master)}


def sees_house(view: dict[str, Any], location: str) -> bool:
    if view.get("whole_company"):
        return True
    code = house_directory.code_of(location) or str(location or "").strip().upper()
    return code in set(view.get("manages") or [])


CORE_USERS_SHEET_ID = os.getenv("HUB_DB_SHEET_ID", "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg")


def viewer_by_name(dsn: str, name: str) -> dict[str, Any]:
    key = fold(name)
    worn: list[str] = []
    if key:
        with hub_db.intel(dsn) as conn, conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, role FROM asa_users WHERE active IS NOT FALSE "
                "AND (merged_into IS NULL OR merged_into::text = '') "
                "AND regexp_replace(lower(coalesce(nullif(entity_name, ''), display_name, '')), "
                "'[^a-z0-9]+', '', 'g') = %s", (key,))
            accounts = [dict(r) for r in cur.fetchall()]
            ids = [str(a["id"]) for a in accounts]
            worn = [str(a.get("role") or "") for a in accounts if a.get("role")]
            if ids:
                for r in lanes_sheets.data(CORE_USERS_SHEET_ID, "users"):
                    if lanes_sheets.text(r.get("user_id")) not in ids:
                        continue
                    worn.extend(t for t in re.split(r"[,;|\n]+", lanes_sheets.text(r.get("types")))
                                if t.strip())
    return viewer(dsn, name=str(name or "").strip(), types=worn)


def may_decide(view: dict[str, Any], location: str) -> bool:
    if view.get("decides_everywhere"):
        return True
    code = house_directory.code_of(location) or str(location or "").strip().upper()
    return code in set(view.get("decides") or [])


# Staff view calendars read-only; that house's managers and the badges above edit.

CALENDAR_REFUSED_ROLES = frozenset(
    r.strip().lower() for r in os.getenv(
        "HUB_HOUSECAL_REFUSED_ROLES", "client,guardian").split(",") if r.strip())
CALENDAR_EDIT_ROLES = frozenset(
    r.strip().lower() for r in os.getenv("HUB_HOUSECAL_EDIT_ROLES", "manager").split(",")
    if r.strip())
# TEAMLEAD views through MANAGER_BADGES, beside HM; a follower of DIRECTOR through badges_of.
CALENDAR_VIEW_BADGES = frozenset({"STAFF", "HM", "MANAGER"}) | MANAGER_BADGES | REASON_BADGES


def may_read_requests(view: dict[str, Any]) -> bool:
    # an SSA or a FAMILY reads no request, whatever its role says (the operator's sheet: Scheduling is shut to both)
    worn = {str(b).strip().upper() for b in view.get("badges") or ()}
    return str(view.get("role") or "").strip().lower() not in CALENDAR_REFUSED_ROLES and not worn & {"FAMILY", "SSA"}


def may_view_calendars(view: dict[str, Any]) -> bool:
    if str(view.get("role") or "").strip().lower() in CALENDAR_REFUSED_ROLES:
        return False
    worn = {str(b).strip().upper() for b in (view.get("badges") or [])}
    return bool(worn & CALENDAR_VIEW_BADGES) or bool(view.get("manages"))


def may_edit_calendar(view: dict[str, Any], location: str) -> bool:
    if not may_view_calendars(view):
        return False
    if may_decide(view, location):
        return True
    return str(view.get("role") or "").strip().lower() in CALENDAR_EDIT_ROLES


def edits_every_house(view: dict[str, Any]) -> bool:
    if not may_view_calendars(view):
        return False
    return bool(view.get("decides_everywhere")) \
        or str(view.get("role") or "").strip().lower() in CALENDAR_EDIT_ROLES


def calendar_access(view: dict[str, Any], location: str,
                    managers: dict[str, Any] | None = None) -> dict[str, Any]:
    code = house_directory.code_of(location) or str(location or "").strip().upper()
    managers = managers or {"readable": False, "why": "not asked", "by_code": {}}
    hm = (managers.get("by_code") or {}).get(code)
    above = deciders_all()
    if hm:
        names = list(hm.get("names") or [hm.get("name")])
        who = " and ".join(n for n in names if n)
        hm_line = {"name": hm.get("name") or "", "names": names, "readable": True,
                   "why": f"{who} {'manage' if len(names) > 1 else 'manages'} this house "
                          f"(the hotline calendar's ** rows)"}
    elif managers.get("readable"):
        hm_line = {"name": "", "names": [], "readable": True,
                   "why": (f"the hotline calendar names no house manager for this house, so "
                           f"only {above} edit its calendar")}
    else:
        hm_line = {"name": "", "names": [], "readable": False,
                   "why": (f"who manages this house could not be read "
                           f"({managers.get('why') or 'no reason given'}), so only {above} "
                           f"edit its calendar until it can")}
    seen = may_view_calendars(view)
    edit = seen and may_edit_calendar(view, location)
    if not seen:
        why = "Calendar Builder → Live is the company's staff screen."
    elif edit and code in set(view.get("manages") or []):
        why = ("You manage this house — its calendar is yours to edit, in Calendar Builder → "
               "Builder, and its open shifts are yours to give here.")
    elif edit and view.get("decides_everywhere"):
        why = ("Your badge edits every house's calendar, in Calendar Builder → Builder, and "
               "gives its open shifts here.")
    elif edit:
        why = ("This account's role edits every house's calendar, in Calendar Builder → "
               "Builder, and gives its open shifts here.")
    elif hm:
        why = f"Read-only — {hm_line['why']}; only they and {above} edit it."
    else:
        why = f"Read-only — {hm_line['why']}."
    return {"view": seen, "edit": edit, "why": why, "house_manager": hm_line,
            "me": str(view.get("name") or "")}


def on_a_grid(view: dict[str, Any], person: str) -> bool:
    key = fold(person)
    if not key:
        return False
    for loc, names in (view.get("people") or {}).items():
        for n in names:
            if fold(n) == key and not not_a_person(n, loc):
                return True
    return False


# ── the trainer: a free house manager, else the approver when none is on file; unreadable refuses ──

TRAINING_FREE = "free"
TRAINING_BUSY = "busy"
TRAINING_ABOVE_FREE = "above_free"
TRAINING_ABOVE_BUSY = "above_busy"
TRAINING_ABOVE = "above"
TRAINING_UNREADABLE = "unreadable"
TRAINING_NO_HOURS = "not_a_shift"
TRAINING_NO_MANAGER = "no_manager"

_ABOVE = deciders_one()


def _working_line(name: str, clash: dict[str, Any]) -> str:
    if str(clash.get("source") or "") == UNREADABLE:
        where = short_house(str(clash.get("location") or ""))
        return (f"{name} has {str(clash.get('value') or '').strip() or 'a cell'} at {where} then, whose "
                f"hours cannot be read ({clash.get('col_iso') or ''})")
    if str(clash.get("source") or "") == "time_off":
        return (f"{name} is on time off then ({_day_words(clash.get('col_iso'))} to "
                f"{_day_words(clash.get('until') or clash.get('col_iso'))})")
    where = short_house(str(clash.get("location") or ""))
    what = str(clash.get("value") or "").strip() or "a shift"
    tail = {"application": ", a shift they have applied for",
            "handoff": ", a shift being handed to them",
            "claim": ", a shift they were given",
            "draft": ", drafted on Calendar Builder and not published yet",
            TRAINING: f", training {clash.get('trainee') or 'somebody'}"}.get(
                str(clash.get("source") or ""), "")
    return f"{name} is working {what} at {where} then ({clash.get('col_iso') or ''}{tail})"


def _busy_entry(name: str, clash: dict[str, Any]) -> dict[str, Any]:
    return {"name": name, "location": clash.get("location") or "",
            "house": short_house(str(clash.get("location") or "")),
            "col_iso": clash.get("col_iso") or "", "value": clash.get("value") or "",
            "source": clash.get("source") or "roster", "trainee": clash.get("trainee") or "",
            "line": _working_line(name, clash)}


def training_verdict(*, location: str, col_iso: str, value: str, trainee: str,
                     managers: dict[str, Any] | None, busy_of: Any,
                     approver: str = "", prefer: str = "",
                     rules: dict[str, str] | None = None) -> dict[str, Any]:
    """Who trains this shift and whether they are free; pure, `busy_of` raises when unreadable, rules None = held copy."""
    held_unread = rules is None and ist_config.unread()
    rules = rules if rules is not None else ist_config.current()
    must_be_free = ist_config.yes(rules, "ist_trainer_must_be_free")
    house = short_house(location) or location
    base: dict[str, Any] = {"house": house, "location": location, "col_iso": col_iso,
                            "value": value, "managers": [], "busy": [], "trains": "",
                            "unseen": []}
    span = span_of(col_iso, value)
    if span is None:
        return {**base, "state": TRAINING_NO_HOURS, "may_approve": True, "code": "ok",
                "why": "the shift carries no hours, so there is no training time to weigh"}
    if held_unread:
        # FAIL-CLOSED: who trains, and whether they must be free, are the house's settings — never the shipped ones…
        return {**base, "state": TRAINING_UNREADABLE, "may_approve": False, "code": "trainer_unreadable",
                "why": (f"{ist_config.UNREAD_WHY} — who trains a first shift at {house}, and whether they "
                        f"must be free, cannot be worked out until it can")}
    if not managers or not managers.get("readable"):
        said = (managers or {}).get("why") or "no reason given"
        return {**base, "state": TRAINING_UNREADABLE, "may_approve": False,
                "code": "trainer_unreadable",
                "why": (f"who manages {house} could not be read ({said}), so nobody can be shown "
                        f"to be free to train then — the training cannot be approved until it can")}
    code = house_directory.code_of(location) or str(location or "").strip().upper()
    hm = (managers.get("by_code") or {}).get(code)
    names = [n for n in ((hm or {}).get("names") or [(hm or {}).get("name")])
             if n and fold(n) and fold(n) != fold(trainee)]
    base["managers"] = names

    def weigh(candidates: list[str]) -> tuple[str, list[dict[str, Any]], list[str]]:
        busy: list[dict[str, Any]] = []
        failed: list[str] = []
        for n in candidates:
            try:
                clash = busy_of(n)
            except Exception as exc:  # noqa: BLE001 — said, never read as free
                failed.append(f"{n} ({type(exc).__name__})")
                continue
            if clash is None:
                return n, busy, failed
            busy.append(_busy_entry(n, clash))
        return "", busy, failed

    if names:
        order = sorted(names, key=lambda n: (fold(n) != fold(prefer), fold(n) != fold(approver)))
        trains, busy, failed = weigh(order)
        if trains:
            lead = "; ".join(b["line"] for b in busy)
            return {**base, "state": TRAINING_FREE, "may_approve": True, "code": "ok",
                    "trains": trains, "busy": busy,
                    "why": ((f"{lead} — so {trains}, also a house manager here, trains; they are "
                             f"free then") if busy
                            else f"the house manager {trains} is free then and trains")}
        if not must_be_free:
            # ist_trainer_must_be_free = no: nobody free, so the first in order trains anyway
            first = order[0]
            mine = [b for b in busy if fold(b["name"]) == fold(first)]
            return {**base, "state": TRAINING_FREE, "may_approve": True, "code": "ok",
                    "trains": first, "busy": busy, "busy_ok": True,
                    "why": ((f"{mine[0]['line']} — the IST settings do not require the trainer to "
                             f"be free, so the house manager {first} trains") if mine
                            else (f"the house manager {first} trains — what they are working then "
                                  f"could not be read, and the IST settings do not require the "
                                  f"trainer to be free"))}
        if failed:
            return {**base, "state": TRAINING_UNREADABLE, "may_approve": False,
                    "code": "trainer_unreadable", "busy": busy,
                    "why": (f"what the house manager of {house} is working then could not be read "
                            f"({', '.join(failed)}), so they cannot be shown to be free — the "
                            f"training cannot be approved until it can")}
        who = ("the house manager " + busy[0]["line"] if len(busy) == 1
               else "the house managers are all working then — " + "; ".join(b["line"] for b in busy))
        return {**base, "state": TRAINING_BUSY, "may_approve": False, "code": "trainer_busy",
                "busy": busy,
                "why": (f"{who} — a first shift in a house is the house manager's training, so it "
                        f"cannot be approved until they are free")}

    lead = (f"no house manager is on file for {house}" if not hm
            else f"the only house manager of {house} is the person being trained")
    if ist_config.choice(rules, "ist_trainer_when_no_hm") == "refuse":
        return {**base, "state": TRAINING_NO_MANAGER, "may_approve": False,
                "code": "trainer_no_manager",
                "why": (f"{lead}, and the IST settings say a first shift there waits for one — it "
                        f"cannot be approved until a house manager is on file")}
    candidates = [n for n in dict.fromkeys([prefer, approver]) if n and fold(n)
                  and fold(n) != fold(trainee)]
    if not candidates:
        return {**base, "state": TRAINING_ABOVE, "may_approve": False, "code": "trainer_unnamed",
                "why": (f"{lead}, so {_ABOVE} approves — and whoever approves trains"
                        + (", so they must be free then" if must_be_free else ""))}
    trains, busy, failed = weigh(candidates)
    if trains:
        return {**base, "state": TRAINING_ABOVE_FREE, "may_approve": True, "code": "ok",
                "trains": trains, "busy": busy,
                "why": f"{lead}, so {trains} trains — and is free then"}
    if not must_be_free:
        first = candidates[0]
        mine = [b for b in busy if fold(b["name"]) == fold(first)]
        return {**base, "state": TRAINING_ABOVE_FREE, "may_approve": True, "code": "ok",
                "trains": first, "busy": busy, "busy_ok": True,
                "why": (f"{lead}, so {first} trains"
                        + (f" — {mine[0]['line']}, and the IST settings do not require the "
                           f"trainer to be free" if mine
                           else " — the IST settings do not require the trainer to be free"))}
    if failed:
        return {**base, "state": TRAINING_UNREADABLE, "may_approve": False,
                "code": "trainer_unreadable", "busy": busy,
                "why": (f"{lead}, so whoever approves trains — and what {', '.join(failed)} is "
                        f"working then could not be read, so the training cannot be approved "
                        f"until it can")}
    return {**base, "state": TRAINING_ABOVE_BUSY, "may_approve": False, "code": "trainer_busy",
            "busy": busy,
            "why": (f"{lead}, so whoever approves trains — and "
                    + "; ".join(b["line"] for b in busy)
                    + " — a first shift in a house is a training, so it cannot be approved until "
                      "the one who trains is free")}


class Trainers:
    """Trainer commitments read once, any number of shifts weighed; a swap skips the giver's own cell."""

    def __init__(self, dsn: str, *, view: dict[str, Any] | None = None,
                 managers: dict[str, Any] | None = None, drafts: str = DRAFTS_ADD,
                 picture: dict[tuple[str, str, str], str] | None = None,
                 skip: tuple[str, str, str] | list[tuple[str, str, str]] | None = None
                 ) -> None:
        self.dsn = dsn
        self.view = view if view is not None else estate(dsn)
        self.managers = managers if managers is not None else house_managers(dsn)
        self.drafts, self.picture, self.skip = drafts, picture, skip
        self._held: dict[str, list[dict[str, Any]]] = {}

    def held(self, name: str) -> list[dict[str, Any]]:
        key = fold(name)
        if key not in self._held:
            self._held[key] = held_by(self.dsn, name, view=self.view, drafts=self.drafts,
                                      picture=self.picture)
        return self._held[key]

    def verdict(self, *, location: str, col_iso: str, value: str, trainee: str,
                approver: str = "", prefer: str = "") -> dict[str, Any]:
        span = span_of(col_iso, value)

        def busy_of(name: str) -> dict[str, Any] | None:
            held = [h for h in self.held(name)
                    if not (h.get("source") == TRAINING and h["location"] == location
                            and h["col_iso"] == col_iso
                            and fold(h.get("trainee")) == fold(trainee))]
            return clash_for(span, _skipping(held, self.skip))

        out = training_verdict(location=location, col_iso=col_iso, value=value,
                               trainee=trainee, managers=self.managers, busy_of=busy_of,
                               approver=approver, prefer=prefer)
        if out.get("trains"):
            out["unseen"] = self.unseen(out["trains"], col_iso)
            if out["unseen"]:
                out["why"] += (f" (on the calendars that draw {col_iso}: "
                               f"{', '.join(out['unseen'])} "
                               f"{'does' if len(out['unseen']) == 1 else 'do'} not, so a shift of "
                               f"theirs there cannot be seen)")
        return out

    def unseen(self, name: str, col_iso: str) -> list[str]:
        key = fold(name)
        out = []
        for loc, people in (self.view.get("people") or {}).items():
            if col_iso in (self.view.get("isos") or {}).get(loc, []):
                continue
            if any(fold(p) == key for p in people):
                out.append(short_house(loc))
        return sorted(out)


def training_for_reader(verdict: dict[str, Any] | None) -> dict[str, Any] | None:
    if not verdict:
        return verdict
    state = str(verdict.get("state") or "")
    trains = str(verdict.get("trains") or "")
    if verdict.get("busy_ok"):
        return {**verdict, "busy": [], "unseen": [],
                "why": (f"{trains} would train them — the IST settings do not require the trainer "
                        f"to be free")}
    why = {
        TRAINING_FREE: f"the house manager {trains} would train them, and is free then",
        TRAINING_BUSY: ("the house manager is working then — a first shift in a house is the "
                        "house manager's training, so it cannot be approved until they are free"),
        TRAINING_ABOVE_FREE: f"{trains} would train them, and is free then",
        TRAINING_ABOVE_BUSY: ("whoever approves trains, and they are working then — it cannot be "
                              "approved until they are free"),
    }.get(state, str(verdict.get("why") or ""))
    return {**verdict, "why": why, "busy": [], "unseen": []}


def unreadable_training(why: str) -> dict[str, Any]:
    return {"state": TRAINING_UNREADABLE, "may_approve": False, "code": "trainer_unreadable",
            "trains": "", "managers": [], "busy": [], "unseen": [],
            "why": (f"who would train this first shift could not be worked out ({why}) — "
                    f"nobody can approve it until it can")}


class LazyTrainers:
    """Unreadable for every shift when `Trainers` cannot be built."""

    def __init__(self, dsn: str, *, view: dict[str, Any] | None = None,
                 managers: dict[str, Any] | None = None,
                 skip: tuple[str, str, str] | None = None) -> None:
        self.dsn, self.view, self.managers, self.skip = dsn, view, managers, skip
        self._book: Trainers | None = None
        self._why = ""

    def verdict(self, **kw: Any) -> dict[str, Any]:
        if self._book is None and not self._why:
            try:
                self._book = Trainers(self.dsn, view=self.view, managers=self.managers,
                                      skip=self.skip)
            except Exception as exc:  # noqa: BLE001 — said on every row that asks
                self._why = type(exc).__name__
        if self._book is None:
            return unreadable_training(self._why)
        try:
            return self._book.verdict(**kw)
        except Exception as exc:  # noqa: BLE001
            return unreadable_training(type(exc).__name__)


def training_for(dsn: str, *, location: str, col_iso: str, value: str, trainee: str,
                 approver: str = "", prefer: str = "", view: dict[str, Any] | None = None,
                 managers: dict[str, Any] | None = None, drafts: str = DRAFTS_ADD,
                 picture: dict[tuple[str, str, str], str] | None = None,
                 skip: tuple[str, str, str] | list[tuple[str, str, str]] | None = None
                 ) -> dict[str, Any]:
    return Trainers(dsn, view=view, managers=managers, drafts=drafts, picture=picture,
                    skip=skip).verdict(
        location=location, col_iso=col_iso, value=value, trainee=trainee, approver=approver,
        prefer=prefer)


def trainer_names(dsn: str, location: str, *, approver: str = "",
                  managers: dict[str, Any] | None = None) -> list[str]:
    managers = managers if managers is not None else house_managers(dsn)
    code = house_directory.code_of(location) or str(location or "").strip().upper()
    hm = (managers.get("by_code") or {}).get(code) or {}
    names = [n for n in (hm.get("names") or [hm.get("name")]) if n]
    return names or ([approver] if approver else [])


def trainer_record(verdict: dict[str, Any], *, by: str = "") -> dict[str, Any]:
    return {"name": str(verdict.get("trains") or ""), "state": str(verdict.get("state") or ""),
            "why": str(verdict.get("why") or ""), "approved_by": by,
            "managers": list(verdict.get("managers") or [])}


class _Gates:
    """Person gates taken in name-key order, so two acts never deadlock."""

    def __init__(self, dsn: str, names: Iterable[str]) -> None:
        keys: dict[str, str] = {}
        for n in names:
            if fold(n):
                keys.setdefault(fold(n), str(n))
        self.gates = [person_gate(dsn, keys[k]) for k in sorted(keys)]

    def __enter__(self) -> "_Gates":
        for g in self.gates:
            g.__enter__()
        return self

    def __exit__(self, *exc: Any) -> None:
        for g in reversed(self.gates):
            g.__exit__(*exc)


def person_gates(dsn: str, names: Iterable[str]) -> _Gates:
    return _Gates(dsn, names)


def training_on_file(dsn: str, *, location: str, col_iso: str,
                     person: str) -> dict[str, Any] | None:
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        cur.execute("SELECT * FROM asa_shift_requests WHERE kind=%s AND state=%s AND location=%s "
                    "AND col_iso=%s AND lower(person)=lower(%s) ORDER BY decided_at DESC NULLS LAST "
                    "LIMIT 1", (KIND_IST, APPROVED, location, col_iso, str(person or "").strip()))
        row = cur.fetchone()
    return dict(row) if row else None


def _recorded_trainer(row: dict[str, Any] | None) -> str:
    extra = (row or {}).get("extra") or {}
    if isinstance(extra, str):
        try:
            extra = json.loads(extra)
        except ValueError:
            extra = {}
    return str(((extra or {}).get("trainer") or {}).get("name") or "")


# ── the published day ──────────────────────────────────────────────────────

def note_published_days(dsn: str, *, view: dict[str, Any] | None = None,
                        now: datetime | None = None) -> dict[str, Any]:
    """Stamp the first minute each day's column was seen filled; a house's first pass is a backfill."""
    view = view or estate(dsn, fresh=True)
    now = now or _now()
    added = backfilled = 0
    fresh_houses: list[str] = []
    with _connect(dsn) as conn, conn.cursor() as cur:
        _ddl(cur)
        cur.execute("SELECT location, col_iso FROM asa_house_day_published")
        known = {(loc, iso) for loc, iso in cur.fetchall()}
        seen_house = {loc for loc, _ in known}
        for loc in view["locations"]:
            first_pass = loc not in seen_house
            if first_pass:
                fresh_houses.append(loc)
            cells = view["cells"].get(loc, {})
            for iso in view["isos"].get(loc, []):
                if (loc, iso) in known:
                    continue
                filled = sum(1 for (emp, i), text in cells.items()
                             if i == iso and not house_cal_live.not_a_person(emp, loc)
                             and (shift_slices.classify(text) or {}).get("start") is not None)
                if filled < DAY_PUBLISHED_MIN_CELLS:
                    continue
                stamp = (now - _BACKFILL_AGO) if first_pass else now
                cur.execute(
                    "INSERT INTO asa_house_day_published (location, col_iso, first_seen, cells) "
                    "VALUES (%s,%s,%s,%s) ON CONFLICT (location, col_iso) DO NOTHING",
                    (loc, iso, stamp, filled))
                if cur.rowcount:
                    if first_pass:
                        backfilled += 1
                    else:
                        added += 1
        conn.commit()
    return {"published": added, "backfilled": backfilled, "first_pass": fresh_houses}


def published_stamps(dsn: str) -> dict[tuple[str, str], datetime]:
    with _connect(dsn) as conn, conn.cursor() as cur:
        _ddl(cur)
        cur.execute("SELECT location, col_iso, first_seen FROM asa_house_day_published")
        return {(loc, iso): at for loc, iso, at in cur.fetchall()}


# ── the pool ───────────────────────────────────────────────────────────────

def _pool_rows(cur) -> dict[tuple[str, str, str], dict[str, Any]]:
    cur.execute("SELECT * FROM asa_shift_pool")
    return {(r["location"], r["open_row"], r["col_iso"]): dict(r) for r in cur.fetchall()}


def sweep(dsn: str, *, now: datetime | None = None) -> dict[str, Any]:
    """Open a pool row per OPEN and call-off shift and close filled ones; runs on the relay's minute beat."""
    now = now or _now()
    view = estate(dsn, fresh=True)
    noted = note_published_days(dsn, view=view, now=now)
    try:
        note_worked_days(dsn, view=view, now=now)
    except Exception as exc:  # noqa: BLE001 — said; the regular test then answers from the grids alone
        import logging  # noqa: PLC0415 — this module logs only here
        logging.getLogger("hub.shift_requests").warning(
            "shift requests: the worked days could not be remembered (%s)", type(exc).__name__)
    first_pass = set(noted.get("first_pass") or [])
    stamps = published_stamps(dsn)
    opened = closed = calloffs = 0
    # read before the pool's transaction opens, or the sweep waits on its own lock
    offs = call_off_shifts(dsn, view=view, now=now)

    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        pool = _pool_rows(cur)
        cur.execute(house_cal_live.CLAIMS_DDL)
        cur.execute("SELECT location, open_row, col_iso, claimed_by, claimed_via, claimed_at "
                    "FROM asa_house_calendar_claims")
        claims = {(r["location"], r["open_row"], r["col_iso"]): dict(r) for r in cur.fetchall()}

        wanted: dict[tuple[str, str, str], dict[str, Any]] = {}
        for loc in view["locations"]:
            for (emp, iso), text in view["cells"].get(loc, {}).items():
                if not house_cal_live.is_open_row(emp):
                    continue
                shift = shift_slices.classify(text)
                if not shift or shift.get("start") is None:
                    continue
                span = span_of(iso, text)
                # The window starts at the later of day-published and this cell first seen.
                met = (now - _BACKFILL_AGO) if loc in first_pass else now
                stamp = stamps.get((loc, iso))
                if stamp is None and loc not in first_pass:
                    # A day nobody published opens no window: its row would be inserted once with opened_at = now…
                    continue
                wanted[(loc, emp, iso)] = {
                    "kind": KIND_OPEN, "value": text,
                    "opened_at": max(stamp, met) if stamp else met,
                    "shift_start": span[0] if span else None,
                    "shift_end": span[1] if span else None,
                    "called_off_by": "", "reason": ""}
        for row in offs:
            key = (row["location"], row["open_row"], row["col_iso"])
            if key in wanted:
                continue
            wanted[key] = {"kind": KIND_CALLOFF, "value": row["value"],
                           "opened_at": row["opened_at"], "shift_start": row["shift_start"],
                           "shift_end": row["shift_end"],
                           "called_off_by": row["called_off_by"], "reason": row["reason"]}
            calloffs += 1

        for key, want in wanted.items():
            loc, open_row, iso = key
            if key not in pool:
                cur.execute(
                    "INSERT INTO asa_shift_pool (location, open_row, col_iso, kind, value, "
                    "opened_at, shift_start, shift_end, called_off_by, reason, ref) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                    (loc, open_row, iso, want["kind"], want["value"], want["opened_at"],
                     want["shift_start"], want["shift_end"], want["called_off_by"],
                     want["reason"], ref_of(loc, open_row, iso)))
                opened += cur.rowcount
            elif pool[key]["value"] != want["value"]:
                cur.execute("UPDATE asa_shift_pool SET value=%s, shift_start=%s, shift_end=%s "
                            "WHERE location=%s AND open_row=%s AND col_iso=%s",
                            (want["value"], want["shift_start"], want["shift_end"],
                             loc, open_row, iso))

        # Rows older than the ref column get one; an empty ref would expose the caller's row name.
        cur.execute("SELECT location, open_row, col_iso FROM asa_shift_pool WHERE ref=''")
        for r in cur.fetchall():
            cur.execute("UPDATE asa_shift_pool SET ref=%s "
                        "WHERE location=%s AND open_row=%s AND col_iso=%s",
                        (ref_of(r["location"], r["open_row"], r["col_iso"]),
                         r["location"], r["open_row"], r["col_iso"]))

        for key, claim in claims.items():
            row = pool.get(key)
            if row is None or row["filled_by"]:
                continue
            cur.execute(
                "UPDATE asa_shift_pool SET closed_at=coalesce(closed_at, now()), filled_by=%s, "
                "filled_how=coalesce(nullif(filled_how,''), %s) "
                "WHERE location=%s AND open_row=%s AND col_iso=%s",
                (claim["claimed_by"], claim["claimed_via"] or "app", *key))
            closed += cur.rowcount
        conn.commit()
    return {"opened": opened, "closed": closed, "call_offs": calloffs,
            "pool": len(wanted), "at": _iso(now)}


def call_off_shifts(dsn: str, *, view: dict[str, Any] | None = None,
                    now: datetime | None = None) -> list[dict[str, Any]]:
    """Call-offs joined to the roster (psi_attendance); the stored reason is never served to staff."""
    now = now or _now()
    view = view or estate(dsn)
    today = now.astimezone(OHIO).date()
    lo = today - timedelta(days=CALLOFF_LOOKBACK_DAYS)
    hi = today + timedelta(days=CALLOFF_LOOKBACK_DAYS)
    try:
        import psi_attendance  # noqa: PLC0415 — heavy, and only this path needs it
        offs, _loose, _fresh = psi_attendance.called_off(dsn, lo, hi)
        shifts, _counts = psi_attendance.roster(dsn, lo, hi)
    except Exception:  # noqa: BLE001 — no call-off books is not "no call-offs"
        return []
    said: dict[str, list[dict[str, Any]]] = {}
    for who, rows in offs.items():
        for r in rows:
            if str(r.get("kind") or "") in ("late_show", "sent_home"):
                continue
            said.setdefault(who, []).append(r)
    out: list[dict[str, Any]] = []
    for s in shifts:
        hit = None
        for key in s["keys"]:
            for r in said.get(key, []):
                if r.get("day") == s["shift_date"]:
                    hit = r
                    break
            if hit:
                break
        if not hit:
            continue
        location = view["by_code"].get(house_directory.code_of(s["house"])
                                       or str(s["house"]).upper())
        if not location:
            continue
        iso = s["shift_date"].isoformat()
        if iso not in view["isos"].get(location, []):
            continue
        # The grid's own spelling: the pool key must match the tab's row.
        row = next((n for n in view["people"].get(location, [])
                    if fold(n) == fold(s["name"])
                    and not house_cal_live.not_a_person(n, location)), s["name"])
        held = view["cells"].get(location, {}).get((row, iso)) or ""
        worked = (shift_slices.classify(held) or {}).get("start") is not None
        text = held if worked else s["shift_code"]
        out.append({
            "location": location, "open_row": row, "col_iso": iso, "value": text,
            "opened_at": _learned_at(hit.get("at"), s["shift_date"], now),
            "shift_start": s["shift_at"], "shift_end": s["shift_end"],
            "called_off_by": row, "reason": str(hit.get("source") or "")})
    return out


def _learned_at(raw: Any, day: date, now: datetime) -> datetime:
    """A day-only row is dated to the minute it was met, never its midnight and never the future."""
    text = str(raw or "").strip()
    if "T" in text or ":" in text:
        try:
            at = datetime.fromisoformat(text.replace("Z", "+00:00"))
            return at if at.tzinfo else at.replace(tzinfo=OHIO)
        except ValueError:
            pass
    dawn = datetime.combine(day, clock_time(0, 0), tzinfo=OHIO)
    return min(now, max(dawn, min(now, dawn + timedelta(days=2))))


# ── the pool, as the screens see it ────────────────────────────────────────

def pool(dsn: str, *, now: datetime | None = None,
         view: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    now = now or _now()
    view = view or estate(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        cur.execute("SELECT * FROM asa_shift_pool ORDER BY col_iso DESC, location, open_row")
        rows = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT * FROM asa_shift_requests WHERE kind = ANY(%s) ORDER BY created_at",
                    [[KIND_OPEN, KIND_CALLOFF]])
        apps: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
        for r in cur.fetchall():
            apps.setdefault((r["location"], r["open_row"], r["col_iso"]), []).append(dict(r))
    out = []
    for r in rows:
        out.append(_pool_view(r, apps.get((r["location"], r["open_row"], r["col_iso"]), []),
                              now=now, view=view))
    return out


def _pool_view(row: dict[str, Any], apps: list[dict[str, Any]], *, now: datetime,
               view: dict[str, Any]) -> dict[str, Any]:
    window = window_for(row["kind"], opened_at=row["opened_at"],
                        shift_start=row.get("shift_start"), now=now)
    live = [a for a in apps if a["state"] in LIVE_STATES]
    state = WINDOW_FILLED if row.get("filled_by") else window["state"]
    return {
        "key": f"{row['open_row']}|{row['col_iso']}",
        "ref": row.get("ref") or ref_of(row["location"], row["open_row"], row["col_iso"]),
        "location": row["location"], "house": short_house(row["location"]),
        "open_row": row["open_row"], "col_iso": row["col_iso"], "value": row["value"],
        "kind": row["kind"], "window": window, "state": state,
        "shift_start": _iso(row.get("shift_start")), "shift_end": _iso(row.get("shift_end")),
        "called_off_by": row.get("called_off_by") or "",
        "reason": row.get("reason") or "",
        "filled_by": row.get("filled_by") or "", "filled_how": row.get("filled_how") or "",
        "decided_by": row.get("decided_by") or "", "closed_at": _iso(row.get("closed_at")),
        "said": row.get("said") if isinstance(row.get("said"), dict) else {},
        "applicants": [_applicant(a, view) for a in sorted(live, key=lambda a: a["created_at"])],
        "history": [_applicant(a, view) for a in sorted(apps, key=lambda a: a["created_at"])],
    }


def _applicant(row: dict[str, Any], view: dict[str, Any]) -> dict[str, Any]:
    hours = 0.0
    week = house_cal_live.week_key(row["col_iso"])
    for held in view["spans"].get(fold(row["person"]), []):
        if house_cal_live.week_key(held["col_iso"]) == week:
            hours += (held["span"][1] - held["span"][0]).total_seconds() / 3600.0
    return {"id": row["id"], "person": row["person"], "state": row["state"],
            "why": row.get("why") or "", "via": row.get("via") or "app",
            "at": _iso(row.get("created_at")), "week_hours": round(hours, 2),
            "decided_by": row.get("decided_by") or "", "decided_at": _iso(row.get("decided_at")),
            # every screen that draws an applicant draws this: the mark travels with the row
            REHEARSAL: is_rehearsed(row)}


def decorate_open_shifts(dsn: str, shifts: list[dict[str, Any]], *,
                         now: datetime | None = None,
                         pooled: list[dict[str, Any]] | None = None,
                         who: dict[str, Any] | None = None,
                         trainers: bool = False) -> list[dict[str, Any]]:
    """One decoration for card, editor and Requests; never the reason or the caller."""
    now = now or _now()
    try:
        rows = pooled if pooled is not None else pool(dsn, now=now)
    except Exception:  # noqa: BLE001 — a card without a window is still a card
        return shifts
    index = {(p["location"], p["open_row"], p["col_iso"]): p for p in rows}
    by_ref = {p["ref"]: p for p in rows}
    me = str((who or {}).get("name") or "").strip() if who is not None else ""
    mine: dict[str, dict[str, Any]] = {}
    mine_why = ""
    if who is not None and me:
        try:
            mine = standing(dsn, me, rows, now=now)
        except Exception as exc:  # noqa: BLE001 — said on the row, never a silent "no"
            mine_why = (f"whether you may apply could not be worked out "
                        f"({type(exc).__name__}) — try again in a minute")
    homes: dict[str, dict[str, str]] = {}
    try:
        homes = house_directory.read(dsn)
    except Exception:  # noqa: BLE001 — a shift without its street is still a shift
        homes = {}
    book = LazyTrainers(dsn) if trainers and who is not None else None
    ist: dict[str, Any] | None = None
    out = []
    for s in shifts:
        loc = str(s.get("location") or "")
        hit = by_ref.get(str(s.get("ref"))) if s.get("ref") else \
            index.get((loc, s.get("open_row"), s.get("col_iso")))
        extra: dict[str, Any] = {}
        street = (homes.get(house_directory.code_of(loc)) or {}).get("address") or ""
        if street:
            extra["address"] = street
        editor = who is not None and may_edit_calendar(who, loc)
        weigh = book is not None and not s.get("claimed_by") and not s.get("started") \
            and not (hit and hit.get("filled_by"))
        if hit:
            extra.update({"window": hit["window"], "pool_state": hit["state"],
                          "applicants": len(hit["applicants"]), "kind_of_open": hit["kind"],
                          "ref": hit["ref"]})
            if editor:
                listed = []
                for a in hit["applicants"]:
                    entry = {k: a.get(k) for k in ("id", "person", "state", "why", "via", "at",
                                                   "week_hours")}
                    if weigh:
                        if ist is None:
                            ist = ist_index(dsn)
                        entry["ist_ok"] = bool(ist_verdict(ist, a["person"], loc)["ok"])
                        if not entry["ist_ok"]:
                            entry["training"] = book.verdict(
                                location=loc, col_iso=str(s.get("col_iso") or ""),
                                value=hit["value"], trainee=a["person"], approver=me)
                    listed.append(entry)
                extra["applicant_list"] = listed
        if weigh:
            value = hit["value"] if hit else str(s.get("raw") or s.get("code") or "")
            if editor:
                extra["training"] = book.verdict(location=loc, col_iso=str(s.get("col_iso") or ""),
                                                 value=value, trainee="", approver=me)
        if who is not None:
            if not me:
                extra["mine"] = {"may": False, "code": "no_name",
                                 "why": "this account is not on a roster — ask your manager"}
            elif mine_why:
                extra["mine"] = {"may": False, "code": "unreadable", "why": mine_why}
            elif hit:
                extra["mine"] = mine.get(hit["ref"]) or {
                    "may": False, "code": "unreadable",
                    "why": "whether you may apply could not be worked out — try again in a minute"}
            else:
                extra["mine"] = {"may": False, "code": "not_pooled",
                                 "why": ("this shift is not open for applications yet — it opens "
                                         "within the minute, and this screen shows it when it does")}
            standing_ = extra["mine"]
            if weigh and not editor and hit and me \
                    and (standing_.get("may") or standing_.get("code") == "applied") \
                    and not (standing_.get("ist") or {}).get("ok", True):
                extra["training"] = training_for_reader(book.verdict(
                    location=loc, col_iso=str(s.get("col_iso") or ""), value=hit["value"],
                    trainee=me))
        out.append({**s, **extra})
    return out


# Call-offs are drawn on the grid, never stored; the caller's cell only for readers who may see callers.

CALL_OFF_ROW = "OPEN · call-off"
CALLED_OFF_MARK = "C/O"
ABSENCE_MARKS = frozenset({"C/O", "NCNS"})
DEEP_LINK_PATH = "/#/app/calendarbuilder/house-cal"


def sees_callers(who: dict[str, Any], location: str) -> bool:
    return bool(who.get("whole_company")) or may_edit_calendar(who, location)


def call_offs_on_calendar(pooled: Iterable[dict[str, Any]], *, location: str | None = None,
                          today: date | None = None) -> list[dict[str, Any]]:
    today = today or datetime.now(OHIO).date()
    floor = (today - timedelta(days=CALLOFF_LOOKBACK_DAYS)).isoformat()
    return [p for p in pooled if p.get("kind") == KIND_CALLOFF
            and str(p.get("col_iso") or "") >= floor
            and (location is None or p.get("location") == location)]


def _blank(cell: dict[str, Any]) -> None:
    cell["text"] = ""
    cell["color"] = "transparent"
    cell.pop("edited", None)
    cell.pop("published", None)


def overlay_call_offs(grid: dict[str, Any], offs: list[dict[str, Any]], *,
                      sees_callers: bool) -> dict[str, Any]:
    isos = house_cal_live.col_isos(grid)
    at = {iso: i for i, iso in enumerate(isos)}
    rows = [r for r in (grid.get("rows") or []) if isinstance(r, dict)]
    offs = [o for o in offs
            if not (o.get("filled_by") and fold(o.get("filled_by")) == fold(o.get("open_row")))]
    if not sees_callers:
        for r in rows:
            if house_cal_live.is_open_row(r.get("employee")):
                continue
            for cell in r.get("cells") or []:
                if isinstance(cell, dict) \
                        and str(cell.get("text") or "").strip().upper() in ABSENCE_MARKS:
                    _blank(cell)
    drawn = sorted((o for o in offs if str(o.get("col_iso") or "") in at),
                   key=lambda o: (str(o["col_iso"]),
                                  str((o.get("window") or {}).get("opens_at") or ""),
                                  str(o.get("ref") or "")))
    if not drawn:
        return grid

    callers: dict[str, dict[str, Any]] = {}
    for r in rows:
        name = str(r.get("employee") or "")
        if name and not house_cal_live.is_open_row(name):
            callers.setdefault(fold(name), r)
    depth: dict[str, int] = {}
    lines: list[list[dict[str, Any] | None]] = []
    for o in drawn:
        iso = str(o["col_iso"])
        i = at[iso]
        k = depth.get(iso, 0)
        depth[iso] = k + 1
        while len(lines) <= k:
            lines.append([None] * len(isos))
        lines[k][i] = o
        caller = callers.get(fold(o.get("open_row")))
        if caller is None:
            continue
        cells = caller.setdefault("cells", [])
        while len(cells) <= i:
            cells.append({"text": "", "color": "transparent"})
        if not isinstance(cells[i], dict):
            cells[i] = {"text": ""}
        cell = cells[i]
        text = str(cell.get("text") or "").strip()
        worked = (shift_slices.classify(text) or {}).get("start") is not None
        theirs = not text or not worked or text == str(o.get("value") or "").strip()
        said = {"ref": o.get("ref") or "", "value": o.get("value") or "",
                "state": o.get("state") or "", "filled_by": o.get("filled_by") or ""}
        if theirs and sees_callers:
            cell["text"] = CALLED_OFF_MARK
            cell["called_off"] = said
        elif theirs:
            _blank(cell)
        elif sees_callers:
            cell["called_off"] = said

    taken = {str(r.get("employee") or "") for r in rows}
    fresh: list[dict[str, Any]] = []
    for k, line in enumerate(lines):
        name, n = (CALL_OFF_ROW if k == 0 else f"{CALL_OFF_ROW} {k + 1}"), k + 1
        while name in taken:
            n += 1
            name = f"{CALL_OFF_ROW} {n}"
        taken.add(name)
        cells: list[dict[str, Any]] = []
        for i, o in enumerate(line):
            if o is None:
                cells.append({"text": "", "color": "transparent"})
                continue
            cell = {"text": str(o.get("value") or ""), "color": "transparent",
                    "ref": o.get("ref") or "", "kind_of_open": KIND_CALLOFF}
            if sees_callers:
                cell["called_off_by"] = str(o.get("open_row") or "")
            cells.append(cell)
            if o.get("filled_by"):
                grid.setdefault("_claims", {})[f"{name}|{isos[i]}"] = {
                    "claimed_by": o["filled_by"], "claimed_via": o.get("filled_how") or "",
                    "claimed_at": o.get("closed_at") or ""}
        fresh.append({"employee": name, "cells": cells, "open_row": True, "call_off_row": True})
    all_rows = grid.setdefault("rows", [])
    last_open = max((j for j, r in enumerate(all_rows)
                     if isinstance(r, dict) and house_cal_live.is_open_row(r.get("employee"))),
                    default=None)
    where = len(all_rows) if last_open is None else last_open + 1
    all_rows[where:where] = fresh
    return grid


def _pool_or_why(dsn: str, now: datetime) -> tuple[list[dict[str, Any]] | None, dict[str, Any]]:
    try:
        return pool(dsn, now=now), {"readable": True, "why": ""}
    except Exception as exc:  # noqa: BLE001
        return None, {"readable": False,
                      "why": (f"the shift pool could not be read ({type(exc).__name__}), so a "
                              f"called-off shift may be missing here and no window is shown")}


def _lay_time_off(dsn: str, grid: dict[str, Any], location: str,
                  who: dict[str, Any] | None) -> None:
    """Scheduled time off on every reader's grid; a pending request only for the house's editors."""
    try:
        import time_off  # noqa: PLC0415 — lazy: it imports this file back
        editor = bool(who) and may_edit_calendar(who or {}, location)
        time_off.lay_marks(grid, time_off.grid_marks(dsn, location, editor))
        grid["time_off"] = {"readable": True, "why": ""}
    except Exception as exc:  # noqa: BLE001 — FAIL-OPEN: the calendar draws, and says the marks are missing
        grid["time_off"] = {"readable": False,
                            "why": f"time off could not be read ({type(exc).__name__}), so no day here "
                                   f"is marked as time off"}


def tab_days(isos: list[str]) -> tuple[date | None, date | None]:
    """The first and last day a tab draws, from its column keys; (None, None) when none is a day."""
    days = []
    for iso in isos:
        try:
            days.append(date.fromisoformat(str(iso)[:10]))
        except ValueError:
            continue
    return (min(days), max(days)) if days else (None, None)


def _published_here(dsn: str, location: str, isos: list[str]) -> tuple[list[dict[str, Any]], str]:
    """This house's published cells over the days its tab draws, for the grid's marks, or none and why."""
    first, last = tab_days(isos)
    if first is None:
        return [], ""
    try:
        with _connect(dsn) as conn, conn.cursor() as cur:
            return effective_roster.published(cur, first, last, location=location), ""
    except Exception as exc:  # noqa: BLE001 — said on the grid, never drawn as "published nowhere"
        return [], f"how each cell got here could not be read ({type(exc).__name__})"


def calendar_grid(dsn: str, location: str, who: dict[str, Any] | None, *,
                  now: datetime | None = None,
                  layer: Any = None) -> dict[str, Any] | None:
    now = now or _now()
    pooled, said = _pool_or_why(dsn, now)
    offs = call_offs_on_calendar(pooled or [], location=location,
                                 today=now.astimezone(OHIO).date())
    sees = sees_callers(who or {}, location)
    marks_why = {"why": ""}

    def lay(g: dict[str, Any]) -> None:
        if layer is not None:
            layer(g)
        isos = house_cal_live.col_isos(g)
        # read over the tab's own days only, then laid before the call-off cut, so a blanked cell loses its mark
        marks, marks_why["why"] = _published_here(dsn, location, isos)
        effective_roster.lay_marks(g, isos, marks)
        overlay_call_offs(g, offs, sees_callers=sees)
        _lay_time_off(dsn, g, location, who)

    grid = house_cal_live.merged_grid(dsn, location, before_compute=lay)
    if grid is None:
        return None
    grid["pool"] = said
    grid["published_why"] = marks_why["why"]
    computed = grid.get("computed") or {}
    if pooled is not None and computed.get("open_shifts"):
        computed["open_shifts"] = decorate_open_shifts(dsn, computed["open_shifts"], now=now,
                                                       pooled=pooled, who=who,
                                                       trainers=who is not None)
    return grid


def calendar_open_shifts(dsn: str, who: dict[str, Any], *,
                         now: datetime | None = None) -> dict[str, Any]:
    now = now or _now()
    pooled, said = _pool_or_why(dsn, now)
    by_house: dict[str, list[dict[str, Any]]] = {}
    for o in call_offs_on_calendar(pooled or [], today=now.astimezone(OHIO).date()):
        by_house.setdefault(o["location"], []).append(o)

    def lay(g: dict[str, Any]) -> None:
        loc = str(g.get("location") or "")
        overlay_call_offs(g, by_house.get(loc, []), sees_callers=sees_callers(who, loc))

    shifts = house_cal_live.open_shifts(dsn, before_compute=lay)
    if pooled is not None:
        shifts = decorate_open_shifts(dsn, shifts, now=now, pooled=pooled, who=who)
    return {"shifts": shifts, "pool": said}


def open_call_off_at(dsn: str, location: str, employee: str,
                     col_iso: str) -> dict[str, Any] | None:
    """The waiting call-off on this cell, or None; such a shift is never dragged."""
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        row = _pool_one(cur, location, employee, col_iso)
    if row and row.get("kind") == KIND_CALLOFF and not row.get("filled_by"):
        return row
    return None


def deep_link(ref: str, location: str = "") -> str:
    parts = [f"house={quote(location, safe='')}"] if location else []
    parts.append(f"ref={quote(str(ref or ''), safe='')}")
    return f"{DEEP_LINK_PATH}?{'&'.join(parts)}"


def call_off_ref(dsn: str, *, person: str, day: str, house: str = "") -> dict[str, Any]:
    key = fold(person)
    day = str(day or "")[:10]
    if not key or len(day) != 10:
        return {}
    view = estate(dsn)
    code = house_directory.code_of(house) if house else ""
    location = view["by_code"].get(code, "") if code else ""
    try:
        with _connect(dsn) as conn, conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            _ddl(cur)
            cur.execute("SELECT location, open_row, col_iso, ref FROM asa_shift_pool "
                        "WHERE kind=%s AND col_iso=%s", (KIND_CALLOFF, day))
            pooled = [dict(r) for r in cur.fetchall()]
    except Exception:  # noqa: BLE001 — the hash below is the same handle either way
        pooled = []
    for r in pooled:
        if fold(r["open_row"]) == key and (not location or r["location"] == location):
            ref = r["ref"] or ref_of(r["location"], r["open_row"], r["col_iso"])
            return {"ref": ref, "location": r["location"], "path": deep_link(ref, r["location"])}
    row = ""
    for loc in ([location] if location else view["locations"]):
        for (emp, iso) in view["cells"].get(loc, {}):
            if iso == day and fold(emp) == key and not house_cal_live.not_a_person(emp, loc):
                location, row = loc, emp
                break
        if row:
            break
    if not location:
        return {}
    if not row:
        row = next((n for n in view["people"].get(location, []) if fold(n) == key), person)
    ref = ref_of(location, row, day)
    return {"ref": ref, "location": location, "path": deep_link(ref, location)}


# ── applying ───────────────────────────────────────────────────────────────

def request_id(kind: str, location: str, open_row: str, col_iso: str, person: str,
               created_iso: str) -> str:
    raw = f"{kind}|{location}|{open_row}|{col_iso}|{person}|{created_iso}".encode()
    return "SR" + hashlib.sha256(raw).hexdigest()[:10].upper()


def _pool_one(cur, location: str, open_row: str, col_iso: str) -> dict[str, Any] | None:
    cur.execute("SELECT * FROM asa_shift_pool WHERE location=%s AND open_row=%s AND col_iso=%s",
                (location, open_row, col_iso))
    row = cur.fetchone()
    return dict(row) if row else None


def by_ref(dsn: str, ref: str) -> tuple[str, str, str] | None:
    """Resolved server-side so a staff copy of a call-off never carries the caller's row name."""
    ref = str(ref or "").strip().upper()
    if not ref:
        return None
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        cur.execute("SELECT location, open_row, col_iso FROM asa_shift_pool WHERE ref=%s", (ref,))
        row = cur.fetchone()
        if row:
            return row["location"], row["open_row"], row["col_iso"]
        cur.execute("SELECT location, open_row, col_iso FROM asa_shift_pool WHERE ref=''")
        for r in cur.fetchall():
            if ref in (ref_of(r["location"], r["open_row"], r["col_iso"]),
                       _legacy_ref(r["location"], r["open_row"], r["col_iso"])):
                return r["location"], r["open_row"], r["col_iso"]
    return None


def eligibility(dsn: str, *, location: str, open_row: str, col_iso: str, person: str,
                now: datetime | None = None, view: dict[str, Any] | None = None,
                ist: dict[str, Any] | None = None) -> dict[str, Any]:
    """{may, why, code, window, ist}: the one answer the screen paints and both doors enforce; a pure read."""
    now = now or _now()
    view = view or estate(dsn)
    ist = ist if ist is not None else ist_index(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        row = _pool_one(cur, location, open_row, col_iso)
    if not row:
        return {"may": False, "code": "no_such_shift", "why": "that shift is not open"}
    if row.get("filled_by"):
        return {"may": False, "code": "filled",
                "why": f"{row['filled_by']} already has this shift"}
    window = window_for(row["kind"], opened_at=row["opened_at"],
                        shift_start=row.get("shift_start"), now=now)
    return _verdict(kind=row["kind"], location=location, open_row=open_row, col_iso=col_iso,
                    value=row["value"], window=window, person=person,
                    held=held_by(dsn, person, view=view), view=view, ist=ist)


def _verdict(*, kind: str, location: str, open_row: str, col_iso: str, value: str,
             window: dict[str, Any], person: str, held: list[dict[str, Any]],
             view: dict[str, Any], ist: dict[str, Any]) -> dict[str, Any]:
    verdict = ist_verdict(ist, person, location)
    base = {"window": window, "ist": verdict, "kind": kind, "value": value}
    if window["state"] == WINDOW_MANAGER_ONLY:
        return {**base, "may": False, "code": "manager_only", "why": window["why"]}
    if window["state"] != WINDOW_OPEN:
        return {**base, "may": False, "code": "window_closed",
                "why": ("applications for this shift have closed — the house manager decides "
                        "who takes it now")}
    # Checked first: the skip below would hide the caller's clash with their own call-off.
    if kind == KIND_CALLOFF and fold(open_row) == fold(person):
        return {**base, "may": False, "code": "called_off",
                "why": ("this is the shift they called off — the house manager can give it back "
                        "to them, but it is not applied for")}
    regular = regular_state(view, person, location) if kind == KIND_OPEN else {"state": "yes"}
    if regular["state"] == "no":
        return {**base, "may": False, "code": "not_a_regular",
                "why": (f"for the first {OPEN_SHIFT_APPLY_MIN} minutes this shift is reserved for "
                        f"{short_house(location)}'s own staff — anyone with a shift there in the "
                        f"last {OPEN_SHIFT_REGULAR_DAYS} days")}
    if regular["state"] == "unknown":
        # FAIL-CLOSED: a record shorter than the window cannot show who is NOT a regular either.
        house = short_house(location)
        return {**base, "may": False, "code": "regular_unknown",
                "why": (f"for the first {OPEN_SHIFT_APPLY_MIN} minutes this shift is reserved for "
                        f"{house}'s own staff — and the calendar holds only {regular['covered']} "
                        f"day(s) of {house}, so it cannot be shown whether they worked there in the last "
                        f"{OPEN_SHIFT_REGULAR_DAYS} days; the house manager decides"
                        + (f" ({view.get('worked_why')})" if view.get("worked_why") else ""))}
    span = span_of(col_iso, value)
    clash = clash_for(span, _skipping(held, (location, open_row, col_iso)), col_iso=col_iso, value=value)
    if clash:
        code, why = clash_verdict("they", clash)
        return {**base, "may": False, "code": code, "why": why, "clash": clash_out(clash)}
    return {**base, "may": True, "code": "ok",
            "why": ("this needs the house manager's approval first — "
                    + verdict["why"]) if not verdict["ok"] else "open to them"}


def standing(dsn: str, person: str, pooled: list[dict[str, Any]], *,
             now: datetime | None = None, view: dict[str, Any] | None = None,
             ist: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    now = now or _now()
    view = view or estate(dsn)
    ist = ist if ist is not None else ist_index(dsn)
    held = held_by(dsn, person, view=view)
    return {s["ref"]: _standing(s, person, held=held, view=view, ist=ist) for s in pooled}


def _standing(s: dict[str, Any], person: str, *, held: list[dict[str, Any]],
              view: dict[str, Any], ist: dict[str, Any]) -> dict[str, Any]:
    if s.get("filled_by"):
        return {"may": False, "code": "filled", "window": s["window"],
                "ist": ist_verdict(ist, person, s["location"]),
                "why": f"{s['filled_by']} already has this shift"}
    mine = next((a for a in s.get("applicants") or [] if fold(a["person"]) == fold(person)), None)
    if mine:
        return {"may": False, "code": "applied", "window": s["window"],
                "ist": ist_verdict(ist, person, s["location"]),
                "request_id": mine["id"], "state": mine["state"],
                "why": ("they applied — it is waiting on the house manager to take the training on"
                        if mine["state"] == NEEDS_TRAINING
                        else "they applied — the house manager decides when applications close")}
    return _verdict(kind=s["kind"], location=s["location"], open_row=s["open_row"],
                    col_iso=s["col_iso"], value=s["value"], window=s["window"], person=person,
                    held=held, view=view, ist=ist)


def apply_for(dsn: str, *, location: str, open_row: str, col_iso: str, person: str,
              via: str = "app", now: datetime | None = None,
              evidence: dict[str, Any] | None = None) -> dict[str, Any]:
    person = str(person or "").strip()
    if not person:
        raise Refused("an application needs a name", "no_name")
    now = now or _now()
    person = grid_name(estate(dsn), person, location) or person
    with person_gate(dsn, person):
        return _apply_locked(dsn, location=location, open_row=open_row, col_iso=col_iso,
                             person=person, via=via, now=now, evidence=evidence)


def _apply_locked(dsn: str, *, location: str, open_row: str, col_iso: str, person: str,
                  via: str, now: datetime,
                  evidence: dict[str, Any] | None = None) -> dict[str, Any]:
    """The application itself, under the person's gate so the clash check still holds when the row lands."""
    ok = eligibility(dsn, location=location, open_row=open_row, col_iso=col_iso,
                     person=person, now=now)
    if not ok.get("may"):
        raise Refused(str(ok.get("why") or "not open to them"), str(ok.get("code") or "refused"),
                      **{k: v for k, v in ok.items() if k in ("window", "ist", "clash")})
    verdict = ok["ist"]
    state = APPLIED if verdict["ok"] else NEEDS_TRAINING
    rid = request_id(ok["kind"], location, open_row, col_iso, person, now.isoformat())
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        cur.execute(
            "INSERT INTO asa_shift_requests (id, kind, location, open_row, col_iso, value, "
            "person, state, why, via, created_at, extra) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT DO NOTHING RETURNING *",
            (rid, ok["kind"], location, open_row, col_iso, ok["value"], person, state,
             "" if verdict["ok"] else verdict["why"], via, now,
             json.dumps({"ist": verdict, **(evidence or {})}, default=str)))
        got = cur.fetchone()
        if not got:
            cur.execute(
                "SELECT * FROM asa_shift_requests WHERE kind=%s AND location=%s AND open_row=%s "
                "AND col_iso=%s AND lower(person)=lower(%s) AND state = ANY(%s)",
                (ok["kind"], location, open_row, col_iso, person, list(LIVE_STATES)))
            got = cur.fetchone()
            conn.commit()
            return {**dict(got or {}), "applied": False,
                    "why": "they had already applied for this shift"}
        training = ""
        if not verdict["ok"]:
            # R10: the training approval must exist from the moment the application does.
            training = _record_training(cur, kind=ok["kind"], location=location,
                                        open_row=open_row, col_iso=col_iso, value=ok["value"],
                                        person=person, verdict=verdict, now=now, via=via)
        conn.commit()
    out = {**dict(got), "applied": True, "ist": verdict, "training_request": training,
           "needs_training_approval": state == NEEDS_TRAINING}
    if state == NEEDS_TRAINING:
        out["training"] = training_for_reader(LazyTrainers(dsn).verdict(
            location=location, col_iso=col_iso, value=ok["value"], trainee=person))
    return out


def request_row(dsn: str, request_id_: str) -> dict[str, Any] | None:
    """Read before a door decides who may act: the house comes from the row, never from the posted body."""
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        cur.execute("SELECT * FROM asa_shift_requests WHERE id=%s", (str(request_id_ or "").strip(),))
        row = cur.fetchone()
    return dict(row) if row else None


def withdraw(dsn: str, *, request_id_: str, person: str = "", why: str = "") -> dict[str, Any]:
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        sql = ("UPDATE asa_shift_requests SET state=%s, decided_at=now()"
               + (", why=%s" if why else "") + " WHERE id=%s AND state = ANY(%s)")
        args: list[Any] = [WITHDRAWN, *([why] if why else []), request_id_, list(LIVE_STATES)]
        if person:
            sql += " AND lower(person)=lower(%s)"
            args.append(person)
        cur.execute(sql + " RETURNING *", tuple(args))
        row = cur.fetchone()
        conn.commit()
    if not row:
        raise Refused("that application is not open", "no_such_application")
    return dict(row)


def applicants(dsn: str, *, location: str, open_row: str, col_iso: str) -> list[dict[str, Any]]:
    view = estate(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        # Applications only: a training approval names the same person and cell.
        cur.execute(
            "SELECT * FROM asa_shift_requests WHERE kind = ANY(%s) AND location=%s "
            "AND open_row=%s AND col_iso=%s AND state = ANY(%s) ORDER BY created_at",
            ([KIND_OPEN, KIND_CALLOFF], location, open_row, col_iso, list(LIVE_STATES)))
        return [_applicant(dict(r), view) for r in cur.fetchall()]


def live_at(dsn: str, *, location: str, open_row: str, col_iso: str) -> list[dict[str, Any]]:
    """EVERY live row on that cell, of every kind — applications and the training approvals beside them."""
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        cur.execute(
            "SELECT * FROM asa_shift_requests WHERE location=%s AND open_row=%s AND col_iso=%s "
            "AND state = ANY(%s) ORDER BY created_at",
            (location, open_row, col_iso, list(LIVE_STATES)))
        return [{"id": str(r["id"]), "kind": str(r["kind"]), "person": str(r["person"]),
                 "state": str(r["state"]), "via": str(r["via"] or ""),
                 REHEARSAL: is_rehearsed(dict(r))} for r in cur.fetchall()]


def _placeable(dsn: str, person: str) -> str:
    import calendar_builder_houses  # noqa: PLC0415 — it asks this file back
    key = fold(person)
    if not key:
        return ""
    return next((str(r["name"]) for r in calendar_builder_houses.staff_directory(dsn)["staff"]
                 if fold(r["name"]) == key), "")


def decide(dsn: str, *, location: str, open_row: str, col_iso: str, person: str,
           by: str, how: str = "approved", now: datetime | None = None,
           rehearsal: dict[str, Any] | None = None) -> dict[str, Any]:
    """`rehearsal` is the evidence the staff-answers rehearsal hands its own decision; when it is set the cells…"""
    now = now or _now()
    person = str(person or "").strip()
    if not person:
        raise Refused("name the person taking the shift", "no_name")
    ist = ist_index(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        row = _pool_one(cur, location, open_row, col_iso)
    if not row:
        raise Refused("that shift is not in the pool", "no_such_shift")
    if row.get("filled_by"):
        raise Refused(f"{row['filled_by']} already has this shift", "filled")
    # A REHEARSED ROW IS NEVER DECIDED FOR REAL, and a real one is never decided by a rehearsal.
    standing = live_at(dsn, location=location, open_row=open_row, col_iso=col_iso)
    if rehearsal is None:
        played = [r for r in standing if r[REHEARSAL]]
        if played:
            raise Refused(
                f"{', '.join(sorted({r['person'] for r in played}))} did not really ask for this "
                f"shift — that row was played in the shift rehearsal, and deciding it would give "
                f"a real shift on a rehearsed answer. Nothing was decided",
                "rehearsed_rows", rehearsed=[r["id"] for r in played])
    else:
        real = [r for r in standing if not r[REHEARSAL]]
        if real:
            raise Refused(
                f"{', '.join(sorted({r['person'] for r in real}))} asked for this shift for real — "
                f"a rehearsal never decides a real row, and this decision would close it",
                "real_rows", real=[r["id"] for r in real])
    window = window_for(row["kind"], opened_at=row["opened_at"],
                        shift_start=row.get("shift_start"), now=now)
    if window["state"] == WINDOW_OPEN:
        closes = datetime.fromisoformat(window["closes_at"]).astimezone(OHIO)
        raise Refused(f"applications for this shift are open until {closes.strftime('%-I:%M %p')} "
                      f"— the house manager decides when they close", "window_open",
                      window=window)

    verdict = ist_verdict(ist, person, location)
    managers = house_managers(dsn) if not verdict["ok"] else None
    trainers = trainer_names(dsn, location, approver=by, managers=managers) if managers else []
    with person_gates(dsn, [person, *trainers]):
        # Re-read inside the gate: a publish or swap may have written meanwhile.
        view = estate(dsn, fresh=True)
        spelled = grid_name(view, person, location) or _placeable(dsn, person)
        if not spelled:
            raise Refused(f"{person} is not on any house calendar or the staff list — a shift is "
                          f"only given to somebody on a roster", "not_on_a_grid")
        person = spelled
        span = span_of(col_iso, row["value"])
        clash = clash_for(span,
                          held_by(dsn, person, view=view, skip=(location, open_row, col_iso)),
                          col_iso=col_iso, value=row["value"])
        if clash:
            code, why = clash_verdict(person, clash)
            raise Refused(why, code, clash=clash_out(clash))
        trainer: dict[str, Any] | None = None
        if not verdict["ok"]:
            on_file = training_on_file(dsn, location=location, col_iso=col_iso, person=person)
            training = training_for(dsn, location=location, col_iso=col_iso,
                                    value=row["value"], trainee=person, approver=by,
                                    prefer=_recorded_trainer(on_file), view=view,
                                    managers=managers)
            if not training["may_approve"]:
                raise Refused(f"{verdict['why']} — and {training['why']}. The shift was not given.",
                              training["code"], training=training, ist=verdict)
            if not on_file and not assigner_owns_training():
                rid = raise_training(dsn, kind=row["kind"], location=location, open_row=open_row,
                                     col_iso=col_iso, value=row["value"], person=person,
                                     verdict=verdict, rehearsal=rehearsal)
                raise Refused(f"{verdict['why']} — {_not_owned()}, so the training approval is on "
                              f"Requests for the house manager. The shift was not given.",
                              "needs_training_approval", training_request=rid, ist=verdict)
            trainer = trainer_record(training, by=by)

        try:
            claimed = house_cal_live.claim_open_shift(
                dsn, location, open_row, col_iso, person, via=rehearsed_via(how, rehearsal),
                # A call-off's open_row is the caller's own row; left filled, the shift counts twice.
                clear_open_row=(row["kind"] == KIND_CALLOFF
                                and fold(open_row) != fold(person)),
                value=row["value"] if row["kind"] == KIND_CALLOFF else None,
                publish=_writer(dsn, actor=by, via=f"decision:{how}", rehearsal=rehearsal is not None))
        except house_cal_live.AlreadyTaken as exc:
            raise Refused(f"{exc.by} was given this shift first", "already_taken",
                          claimed_by=exc.by, claimed_at=exc.at, claimed_via=exc.via) from None
        except house_cal_live.WorkbookRefused as exc:
            raise Refused(f"the house calendar could not be written, so the shift was not "
                          f"given: {exc.why}", "workbook", blocked=exc.blocked,
                          workbook=exc.code) from None
        except LookupError as exc:
            raise Refused(str(exc), "no_such_shift") from None
        if not verdict["ok"]:
            raise_training(dsn, kind=row["kind"], location=location, open_row=open_row,
                           col_iso=col_iso, value=row["value"], person=person, verdict=verdict,
                           approved_by=by, trainer=trainer, rehearsal=rehearsal)

    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        cur.execute(
            "UPDATE asa_shift_pool SET closed_at=coalesce(closed_at, now()), filled_by=%s, "
            "filled_how=%s, decided_by=%s WHERE location=%s AND open_row=%s AND col_iso=%s",
            (person, rehearsed_via(how, rehearsal), by, location, open_row, col_iso))
        cur.execute(
            "UPDATE asa_shift_requests SET state=%s, decided_by=%s, decided_at=now() "
            "WHERE kind=%s AND location=%s AND open_row=%s AND col_iso=%s "
            "AND regexp_replace(lower(person), '[^a-z0-9]+', '', 'g')=%s AND state = ANY(%s)",
            (APPROVED, by, row["kind"], location, open_row, col_iso, fold(person),
             list(LIVE_STATES)))
        chosen = cur.rowcount
        cur.execute(
            "UPDATE asa_shift_requests SET state=%s, decided_by=%s, decided_at=now(), "
            "why=coalesce(nullif(why,''), %s) "
            "WHERE location=%s AND open_row=%s AND col_iso=%s "
            "AND regexp_replace(lower(person), '[^a-z0-9]+', '', 'g')<>%s "
            "AND state = ANY(%s)",
            (NOT_CHOSEN, by, "the house manager gave the shift to somebody else",
             location, open_row, col_iso, fold(person), list(LIVE_STATES)))
        passed_over = cur.rowcount
        if not chosen:
            # Assigned to someone who never applied: still recorded as a request.
            rid = request_id(row["kind"], location, open_row, col_iso, person, now.isoformat())
            cur.execute(
                "INSERT INTO asa_shift_requests (id, kind, location, open_row, col_iso, value, "
                "person, state, why, via, decided_by, decided_at, extra) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),%s) ON CONFLICT DO NOTHING",
                (rid, row["kind"], location, open_row, col_iso, row["value"], person, APPROVED,
                 "assigned by the house manager", how, by,
                 json.dumps({"ist": verdict, **({REHEARSAL: rehearsal} if rehearsal else {})},
                            default=str)))
        conn.commit()
    forget_estate()
    # After the commit, so it can never undo the decision.
    if rehearsal is None:
        try:
            import open_shift_covered  # noqa: PLC0415
            open_shift_covered.note_filled(dsn, row, person=person, how=how, by=by, now=now)
        except ImportError:
            pass
    return {"decided": True, "person": person, "how": how, "by": by,
            "chosen_from_applicants": bool(chosen), "passed_over": passed_over,
            "ist": verdict, "claim": claimed, "trainer": trainer}


# ── training approvals (R10): raised anywhere, decided on Requests ─────────

def _record_training(cur, *, kind: str, location: str, open_row: str, col_iso: str,
                     value: str, person: str, verdict: dict[str, Any],
                     approved_by: str = "", now: datetime | None = None,
                     trainer: dict[str, Any] | None = None, via: str = "app",
                     evidence: dict[str, Any] | None = None) -> str:
    """`evidence` rides into `extra` of a row made here, as the application's own does."""
    now = now or _now()
    said = json.dumps({"trainer": trainer}) if trainer else "{}"
    played = ((isinstance(evidence, dict) and REHEARSAL in evidence)
              or str(via or "").startswith(REHEARSAL_VIA))
    only_marked = " AND (via LIKE %s OR extra ? %s)" if played else ""
    marked = (f"{REHEARSAL_VIA}%", REHEARSAL) if played else ()
    if approved_by:
        cur.execute(
            "UPDATE asa_shift_requests SET state=%s, decided_by=%s, decided_at=now(), "
            "extra = extra || %s::jsonb "
            "WHERE kind=%s AND location=%s AND open_row=%s AND col_iso=%s "
            "AND lower(person)=lower(%s) AND state=%s" + only_marked + " RETURNING id",
            (APPROVED, approved_by, said, KIND_IST, location, open_row, col_iso, person,
             NEEDS_TRAINING, *marked))
        closed = cur.fetchone()
        if closed:
            return str(closed[0] if not isinstance(closed, dict) else closed["id"])
        cur.execute(
            "UPDATE asa_shift_requests SET extra = extra || %s::jsonb "
            "WHERE id = (SELECT id FROM asa_shift_requests WHERE kind=%s AND location=%s "
            "AND col_iso=%s AND lower(person)=lower(%s) AND state=%s" + only_marked
            + " ORDER BY decided_at DESC NULLS LAST LIMIT 1) RETURNING id",
            (said, KIND_IST, location, col_iso, person, APPROVED, *marked))
        kept = cur.fetchone()
        if kept:
            return str(kept[0] if not isinstance(kept, dict) else kept["id"])
    rid = request_id(KIND_IST, location, open_row, col_iso, person, now.isoformat())
    extra: dict[str, Any] = {**(evidence or {}), "ist": verdict}
    if trainer:
        extra["trainer"] = trainer
    cur.execute(
        "INSERT INTO asa_shift_requests (id, kind, location, open_row, col_iso, value, person, "
        "state, why, via, ref, decided_by, decided_at, extra) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING id",
        (rid, KIND_IST, location, open_row, col_iso, value, person,
         APPROVED if approved_by else NEEDS_TRAINING, verdict["why"], via or "app", kind,
         approved_by, now if approved_by else None, json.dumps(extra)))
    if cur.fetchone() is None:
        cur.execute("SELECT id, via, extra FROM asa_shift_requests WHERE kind=%s AND location=%s "
                    "AND open_row=%s AND col_iso=%s AND lower(person)=lower(%s) "
                    "AND state = ANY(%s) LIMIT 1",
                    (KIND_IST, location, open_row, col_iso, person, list(LIVE_STATES)))
        waiting = cur.fetchone()
        if waiting:
            got = dict(waiting) if isinstance(waiting, dict) else {
                "id": waiting[0], "via": waiting[1], "extra": waiting[2]}
            if played and not is_rehearsed(got):
                # the live row on this cell is a real person's: a rehearsal never takes it over
                raise Refused(f"{person}'s training approval for this shift is real and waits on "
                              f"the house manager — a rehearsal never takes it over, so nothing "
                              f"was done", "real_rows", real=[str(got["id"])])
            return str(got["id"])
    return rid


def raise_training(dsn: str, *, kind: str, location: str, open_row: str, col_iso: str,
                   value: str, person: str, verdict: dict[str, Any],
                   approved_by: str = "", trainer: dict[str, Any] | None = None,
                   rehearsal: dict[str, Any] | None = None) -> str:
    """`rehearsal` is the staff-answers rehearsal's evidence: a row made here carries the mark."""
    with _connect(dsn) as conn, conn.cursor() as cur:
        _ddl(cur)
        rid = _record_training(cur, kind=kind, location=location, open_row=open_row,
                               col_iso=col_iso, value=value, person=person, verdict=verdict,
                               approved_by=approved_by, trainer=trainer,
                               **_training_mark(rehearsal))
        conn.commit()
    return rid


def approve_training(dsn: str, *, request_id_: str, by: str,
                     word: str = "yes", location: str = "", gated: bool = True,
                     trainer_skip: tuple[str, str, str] | None = None,
                     rehearsal: dict[str, Any] | None = None) -> dict[str, Any]:
    """Approve needs a free trainer; `gated=False` when the caller already holds the gates."""
    state = APPROVED if word == "yes" else REFUSED
    trainer: dict[str, Any] | None = None
    gates = person_gates(dsn, [])
    played = is_rehearsed(request_row(dsn, request_id_))
    if rehearsal is None and played:
        raise Refused("that training approval was played in the shift rehearsal — nobody is "
                      "really waiting on it, and approving it would put a real first shift on "
                      "the record. Nothing was approved", "rehearsed_rows")
    # and the other way round: a rehearsal never approves a real person's training
    if rehearsal is not None and not played:
        raise Refused("that training approval is a real one — a rehearsal never approves a real "
                      "person's first shift", "real_rows")
    if word == "yes":
        waiting = request_row(dsn, request_id_)
        if not waiting or waiting.get("kind") != KIND_IST or waiting.get("state") != NEEDS_TRAINING \
                or (location and waiting.get("location") != location):
            raise Refused("that training approval is not waiting", "no_such_approval")
        managers = house_managers(dsn)
        if trainer_skip is None and waiting.get("ref") == KIND_SWAP:
            trainer_skip = _swap_giver_cell(dsn, request_id_)
        if gated:
            gates = person_gates(dsn, trainer_names(dsn, waiting["location"], approver=by,
                                                    managers=managers))
    with gates:
        if word == "yes":
            verdict = training_for(dsn, location=waiting["location"], col_iso=waiting["col_iso"],
                                   value=waiting["value"], trainee=waiting["person"],
                                   approver=by, view=estate(dsn, fresh=True), managers=managers,
                                   skip=trainer_skip)
            if not verdict["may_approve"]:
                raise Refused(verdict["why"], verdict["code"], training=verdict)
            trainer = trainer_record(verdict, by=by)
        return _answer_training(dsn, request_id_=request_id_, by=by, word=word, state=state,
                                location=location, trainer=trainer)


def _swap_giver_cell(dsn: str, request_id_: str) -> tuple[str, str, str] | None:
    import shift_handoff  # noqa: PLC0415 — lazy: shift_handoff asks this file back
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(shift_handoff.HANDOFFS_DDL)
        cur.execute("SELECT location, from_staff, col_iso FROM asa_shift_handoffs "
                    "WHERE training_request=%s AND state='pending' LIMIT 1", (request_id_,))
        got = cur.fetchone()
    return (got["location"], got["from_staff"], got["col_iso"]) if got else None


def _answer_training(dsn: str, *, request_id_: str, by: str, word: str, state: str,
                     location: str, trainer: dict[str, Any] | None) -> dict[str, Any]:
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        sql = ("UPDATE asa_shift_requests SET state=%s, decided_by=%s, decided_at=now(), "
               "extra = extra || %s::jsonb WHERE id=%s AND kind=%s AND state=%s")
        args: list[Any] = [state, by, json.dumps({"trainer": trainer} if trainer else {}),
                           request_id_, KIND_IST, NEEDS_TRAINING]
        if location:
            sql += " AND location=%s"
            args.append(location)
        cur.execute(sql + " RETURNING *", tuple(args))
        row = cur.fetchone()
        if not row:
            conn.commit()
            raise Refused("that training approval is not waiting", "no_such_approval")
        row = dict(row)
        cur.execute(
            "UPDATE asa_shift_requests SET state=%s, why=%s "
            "WHERE location=%s AND open_row=%s AND col_iso=%s AND lower(person)=lower(%s) "
            "AND kind <> %s AND state=%s",
            (APPLIED if word == "yes" else REFUSED,
             (f"the house manager approved the training ({by})"
              + (f" — {trainer['name']} trains" if trainer and trainer.get("name") else "")
              if word == "yes"
              else f"the house manager did not take the training on ({by})"),
             row["location"], row["open_row"], row["col_iso"], row["person"], KIND_IST,
             NEEDS_TRAINING))
        released = cur.rowcount
        conn.commit()
    return {**row, "released": released, "trainer": trainer}


def check_assignment(dsn: str, *, person: str, location: str, col_iso: str, value: str,
                     skip: tuple[str, str, str] | list[tuple[str, str, str]] | None = None,
                     ignore_handoff: str = "", drafts: str = DRAFTS_ADD,
                     picture: dict[tuple[str, str, str], str] | None = None,
                     approver: str = "",
                     trainer_skip: tuple[str, str, str] | None = None) -> dict[str, Any]:
    person = str(person or "").strip()
    if not person:
        return {"ok": True, "code": "empty", "why": "no person to check", "ist": None}
    span = span_of(col_iso, value)
    # The handoff under decision is still `pending` while its cell moves.
    clash = clash_for(span, held_by(dsn, person, skip=skip, ignore_handoff=ignore_handoff,
                                    drafts=drafts, picture=picture),
                      col_iso=col_iso, value=value)
    if clash:
        code, why = clash_verdict(person, clash)
        return {"ok": False, "code": code, "why": why, "clash": clash_out(clash)}
    if span is None:
        # Hours nobody can read that clash with nothing: there is no shift time to train or weigh.
        return {"ok": True, "code": "not_a_shift", "why": "the cell holds no readable hours", "ist": None}
    verdict = ist_verdict(ist_index(dsn), person, location)
    if verdict["ok"]:
        return {"ok": True, "code": "ok", "why": verdict["why"], "ist": verdict}
    on_file = training_on_file(dsn, location=location, col_iso=col_iso, person=person)
    training = training_for(dsn, location=location, col_iso=col_iso, value=value,
                            trainee=person, approver=approver,
                            prefer=_recorded_trainer(on_file), drafts=drafts, picture=picture,
                            skip=trainer_skip)
    return {"ok": True, "code": "no_ist", "why": verdict["why"], "ist": verdict,
            "training": training, "training_on_file": on_file}


def _guard_code(training: dict[str, Any]) -> str:
    return "guard_unreadable" if training.get("state") == TRAINING_UNREADABLE \
        else str(training.get("code") or "trainer_busy")


def guard_assignment(dsn: str, *, person: str, location: str, col_iso: str, value: str,
                     actor: str = "", actor_may_decide: bool = False,
                     skip: tuple[str, str, str] | None = None,
                     ignore_handoff: str = "",
                     kind: str = KIND_OPEN,
                     rehearsal: dict[str, Any] | None = None) -> dict[str, Any]:
    """Every path onto a cell passes here: a clash refuses, a missing IST is recorded or raised."""
    person = str(person or "").strip()
    if not person:
        return {"ok": True, "code": "empty", "why": "no person to check"}
    got = check_assignment(dsn, person=person, location=location, col_iso=col_iso,
                           value=value, skip=skip, ignore_handoff=ignore_handoff,
                           approver=actor if actor_may_decide else "")
    if not got["ok"]:
        return got
    verdict = got["ist"]
    if verdict["ok"]:
        return {"ok": True, "code": "ok", "why": verdict["why"], "ist": verdict}
    training = got["training"]
    on_file = got.get("training_on_file")
    if on_file:
        by = str(on_file.get("decided_by") or "the house manager")
        if not training["may_approve"]:
            return {"ok": False, "code": _guard_code(training), "ist": verdict,
                    "training": training, "training_request": on_file["id"],
                    "why": (f"{verdict['why']} — the training was approved ({by}), but "
                            f"{training['why']}. Nothing has moved.")}
        if fold(training.get("trains")) != fold(_recorded_trainer(on_file)):
            _name_trainer(dsn, on_file["id"], trainer_record(training, by=by))
        return {"ok": True, "code": "training_approved", "ist": verdict, "training": training,
                "training_request": on_file["id"],
                "why": f"{verdict['why']} — the training was approved ({by}); {training['why']}"}
    open_row = (skip or ("", person, ""))[1] if skip else person
    if actor_may_decide and assigner_owns_training():
        if not training["may_approve"]:
            return {"ok": False, "code": _guard_code(training), "ist": verdict,
                    "training": training,
                    "why": f"{verdict['why']} — and {training['why']}. Nothing has moved."}
        rid = raise_training(dsn, kind=kind, location=location, open_row=open_row,
                             col_iso=col_iso, value=value, person=person, verdict=verdict,
                             approved_by=actor, trainer=trainer_record(training, by=actor),
                             rehearsal=rehearsal)
        return {"ok": True, "code": "training_owned", "ist": verdict, "training": training,
                "training_request": rid,
                "why": (f"{verdict['why']} — recorded on Requests as {actor}'s training "
                        f"approval, because they made this assignment; {training['why']}")}
    rid = raise_training(dsn, kind=kind, location=location, open_row=open_row,
                         col_iso=col_iso, value=value, person=person, verdict=verdict,
                         rehearsal=rehearsal)
    return {"ok": False, "code": "needs_training_approval", "ist": verdict,
            "training": training, "training_request": rid,
            "why": (f"{verdict['why']}. Nothing has moved: "
                    + (f"{_not_owned()}, so " if actor_may_decide else "")
                    + f"it is on Requests for the house manager to approve — {training['why']}.")}


def _not_owned() -> str:
    """Why an assignment does not take the training on: the settings say so, or they could not be read."""
    if ist_config.unread():
        return "the IST settings could not be read, so an assignment does not take the training on"
    return "the IST settings say an assignment does not take the training on"


def assigner_owns_training(rules: dict[str, str] | None = None) -> bool:
    """`ist_assigner_owns_training`: does a decider's assignment record their training approval?"""
    if rules is None and ist_config.unread():
        return False
    return ist_config.yes(rules if rules is not None else ist_config.current(),
                          "ist_assigner_owns_training")


def unowned_training(dsn: str, got: dict[str, Any], *, location: str, open_row: str,
                     col_iso: str, value: str, person: str, kind: str = KIND_OPEN,
                     raise_it: bool = True) -> str:
    """'' when the assigner takes the training on, or one is already approved; otherwise the approval is raised…"""
    if assigner_owns_training() or got.get("training_on_file"):
        return ""
    if not raise_it:
        return (f"{(got.get('ist') or {}).get('why') or 'no IST here'} — {_not_owned()}, so its "
                f"training approval would be put on Requests for the house manager")
    try:
        raise_training(dsn, kind=kind, location=location, open_row=open_row, col_iso=col_iso,
                       value=value, person=person, verdict=got.get("ist") or {"why": ""})
        said = "it is on Requests for the house manager to approve"
    except Exception as exc:  # noqa: BLE001 — said on the refusal, never swallowed
        said = f"the approval could not be put on Requests ({type(exc).__name__}); try again"
    return f"{(got.get('ist') or {}).get('why') or 'no IST here'} — {_not_owned()}, so {said}"


def _name_trainer(dsn: str, request_id_: str, trainer: dict[str, Any]) -> None:
    with _connect(dsn) as conn, conn.cursor() as cur:
        _ddl(cur)
        cur.execute("UPDATE asa_shift_requests SET extra = extra || %s::jsonb WHERE id=%s",
                    (json.dumps({"trainer": trainer}), request_id_))
        conn.commit()


def take_open_shift(dsn: str, *, location: str, open_row: str, col_iso: str, person: str,
                    by: str = "", may_decide: bool = False, via: str = "app",
                    now: datetime | None = None,
                    rehearsal: dict[str, Any] | None = None) -> dict[str, Any]:
    """A pooled shift is decided (assigned via `decide`), never raced; an unpooled one still passes `guard_assignment`."""
    now = now or _now()
    person = str(person or "").strip()
    if not person:
        raise Refused("a claim needs a name", "no_name")
    if not on_a_grid(estate(dsn), person):
        raise Refused(f"{person} is not on any house calendar — a shift is only given to "
                      f"somebody on a roster", "not_on_a_grid")
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        row = _pool_one(cur, location, open_row, col_iso)

    begun = span_of(col_iso, str((row or {}).get("value") or "")
                    or estate(dsn)["cells"].get(location, {}).get((open_row, col_iso), ""))
    if begun is not None and begun[0] <= now:
        raise Refused(f"that shift started at {begun[0].strftime('%-I:%M %p')} on {col_iso} — "
                      f"it can no longer be taken or assigned here", "started")

    if row is not None:
        if not may_decide:
            ok = eligibility(dsn, location=location, open_row=open_row, col_iso=col_iso,
                             person=person, now=now)
            why = str(ok.get("why") or "")
            if not ok.get("may"):
                raise Refused(why or "that shift is not open to them",
                              str(ok.get("code") or "refused"),
                              **{k: v for k, v in ok.items() if k in ("window", "ist", "clash")})
            raise Refused(
                "this shift is applied for on Calendar Builder - Requests, not taken here: "
                "applications are open and the house manager decides between them when they "
                "close", "apply_instead", window=ok.get("window"), ist=ok.get("ist"))
        applied = any(fold(a["person"]) == fold(person)
                      for a in applicants(dsn, location=location, open_row=open_row,
                                          col_iso=col_iso))
        how = "approved" if applied else "assigned"
        out = decide(dsn, location=location, open_row=open_row, col_iso=col_iso,
                     person=person, by=by or person, how=how, now=now, rehearsal=rehearsal)
        return {**(out.get("claim") or {}), "decided": True, "how": how,
                "passed_over": out.get("passed_over", 0), "ist": out.get("ist"),
                "trainer": out.get("trainer")}

    with person_gate(dsn, person):
        # Fresh, not the held picture: the guard must check what the ledger is about to write.
        view = estate(dsn, fresh=True)
        person = grid_name(view, person, location) or person
        value = view["cells"].get(location, {}).get((open_row, col_iso), "")
        if not str(value).strip():
            raise Refused("that open shift is no longer on the calendar", "no_such_shift")
        if not may_decide:
            raise Refused(
                "this shift is not open for applications yet — it appears on Calendar Builder - "
                "Requests within the minute, and the house manager decides who takes it",
                "apply_instead")
        guard = guard_assignment(dsn, person=person, location=location, col_iso=col_iso,
                                 value=value, actor=by, actor_may_decide=may_decide,
                                 skip=(location, open_row, col_iso), rehearsal=rehearsal)
        if not guard["ok"]:
            raise Refused(str(guard.get("why") or "refused"), str(guard.get("code") or "refused"),
                          **{k: v for k, v in guard.items()
                             if k in ("clash", "ist", "training_request", "training")})
        try:
            claimed = house_cal_live.claim_open_shift(
                dsn, location, open_row, col_iso, person, via=via,
                publish=_writer(dsn, actor=by or person, via=f"claim:{via}",
                                rehearsal=rehearsal is not None))
        except house_cal_live.AlreadyTaken as exc:
            raise Refused(f"{exc.by} took this shift first", "already_taken",
                          claimed_by=exc.by, claimed_at=exc.at, claimed_via=exc.via) from None
        except house_cal_live.WorkbookRefused as exc:
            raise Refused(f"the house calendar could not be written, so the shift was not "
                          f"given: {exc.why}", "workbook", blocked=exc.blocked,
                          workbook=exc.code) from None
    forget_estate()
    return {**claimed, "decided": False, "how": via,
            "training_request": guard.get("training_request") or "",
            "training": guard.get("training")}


def _writer(dsn: str, *, actor: str, via: str, rehearsal: bool = False):
    """The Builder's writer."""
    import calendar_builder_houses  # noqa: PLC0415
    return calendar_builder_houses.publisher(
        dsn, actor=actor, via=(REHEARSAL_VIA + via) if rehearsal else via,
        note="played by the shift rehearsal — nobody really took this shift" if rehearsal else "")


# ── the Requests screen ────────────────────────────────────────────────────

FEED_LIMIT = int(os.getenv("HUB_REQUESTS_FEED_LIMIT", "400"))


def feed(dsn: str, *, who: dict[str, Any], limit: int = FEED_LIMIT,
         now: datetime | None = None) -> dict[str, Any]:
    """Everything Requests draws, cut per reader here; a call-off's caller and reason only for that house's readers."""
    now = now or _now()
    view = estate(dsn)
    ist = ist_index(dsn)
    me = str(who.get("name") or "")
    whole = bool(who.get("whole_company"))
    reasons = bool(who.get("sees_reasons"))

    shifts = pool(dsn, now=now, view=view)
    trainers = LazyTrainers(dsn, view=view)
    here = {s["location"]: sees_house(who, s["location"]) for s in shifts}
    rows: list[dict[str, Any]] = []
    for s in shifts:
        for a in s["history"]:
            row = _request_row(s, a, whole=here[s["location"]],
                               reasons=reasons or here[s["location"]], me=me)
            if row["visible"] and a["state"] in LIVE_STATES \
                    and not ist_verdict(ist, a["person"], s["location"])["ok"]:
                decides = may_decide(who, s["location"])
                if decides or row["mine"]:
                    row["training"] = trainers.verdict(
                        location=s["location"], col_iso=s["col_iso"], value=s["value"],
                        trainee=a["person"], approver=me if decides else "")
                    row["may_approve"] = decides and bool(row["training"].get("may_approve"))
                    if not decides:
                        row["training"] = training_for_reader(row["training"])
            rows.append(row)
    rows.extend(_training_rows(dsn, whole=whole, me=me, who=who, trainers=trainers))
    rows.extend(_swap_rows(dsn, whole=whole, who=who))
    # Invisible rows never leave the server; `visible` is only the screen's second belt.
    rows = [r for r in rows if r.get("visible")]
    rows.sort(key=lambda r: r.get("at") or "", reverse=True)

    try:
        available = [] if not me else _available(dsn, shifts, me, view=view, ist=ist, now=now,
                                                 trainers=trainers)
        available_why = ""
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: nothing is offered from a check that could not run
        available = []
        available_why = f"what you may take now could not be worked out ({type(exc).__name__})"
    call_offs = [_call_off_row(s, whole=here[s["location"]],
                               reasons=reasons or here[s["location"]], me=me)
                 for s in shifts if s["kind"] == KIND_CALLOFF]
    call_offs.sort(key=lambda r: r.get("col_iso") or "", reverse=True)
    import shift_handoff  # noqa: PLC0415 — lazy: shift_handoff asks this file back
    try:
        my_shifts = shift_handoff.my_shifts(dsn, who, view=view, now=now) if me else []
        my_shifts_why = ""
    except Exception as exc:  # noqa: BLE001
        my_shifts, my_shifts_why = [], f"your upcoming shifts could not be read ({type(exc).__name__})"

    homes = _homes(dsn)
    managers = house_managers(dsn)
    listed = {r.get("ref") for r in rows if r.get("kind") in (KIND_OPEN, KIND_CALLOFF)} \
        | {o["ref"] for o in available} | {c["ref"] for c in call_offs} \
        | {s["ref"] for s in shifts if here[s["location"]]}
    stories = call_off_stories(dsn, [s for s in shifts if s["kind"] == KIND_CALLOFF
                                     and s["ref"] in listed])
    cards = {s["ref"]: shift_card(s, here=here[s["location"]], homes=homes, managers=managers,
                                  story=stories.get(s["ref"]))
             for s in shifts if s["ref"] in listed}
    for r in rows:
        if r.get("kind") in (KIND_SWAP, KIND_IST):
            r["essentials"] = essentials(r["location"], r["col_iso"], r.get("shift") or "",
                                         homes=homes, managers=managers)
    out: dict[str, Any] = {
        "me": me, "badges": who.get("badges") or [], "whole_company": whole,
        "sees_reasons": reasons, "manages": who.get("manages") or [],
        "rows": rows[:limit], "total": len(rows),
        "available": available, "available_why": available_why, "call_offs": call_offs,
        "shifts": cards,
        "time_off": time_off(dsn, who=who, view=view, pooled=shifts),
        "my_shifts": my_shifts, "my_shifts_why": my_shifts_why,
        # The full pool goes to managers only.
        "open_shifts": [_shift_row(s, whole=True, reasons=True, me=me,
                                   managers=house_managers(dsn).get("by_code") or {},
                                   who=who, ist=ist, trainers=trainers)
                        for s in shifts if here[s["location"]]],
        "ist": {"readable": ist.get("readable"), "why": ist.get("why") or ""},
        "windows": {"open_shift_minutes": OPEN_SHIFT_APPLY_MIN,
                    "regular_days": OPEN_SHIFT_REGULAR_DAYS,
                    "call_off_hours": CALLOFF_APPLY_H,
                    "call_off_before_start_minutes": CALLOFF_APPLY_BEFORE_START_MIN,
                    "call_off_floor_minutes": CALLOFF_APPLY_FLOOR_MIN},
        "at": _iso(now),
    }
    if whole or who.get("manages"):
        out["panels"] = panels(dsn, who=who, now=now)
    return out


def _hides_the_caller(s: dict[str, Any], whole: bool) -> bool:
    """R9 in one place: staff never learn who called off, and open_row (the caller's row) goes with the name."""
    return s.get("kind") == KIND_CALLOFF and not whole


def _request_row(s: dict[str, Any], a: dict[str, Any], *, whole: bool, reasons: bool,
                 me: str) -> dict[str, Any]:
    mine = fold(a["person"]) == fold(me)
    hidden = _hides_the_caller(s, whole)
    return {
        "id": a["id"], "kind": s["kind"], "at": a["at"],
        "house": s["house"], "location": s["location"], "col_iso": s["col_iso"],
        "open_row": "" if hidden else s["open_row"], "ref": s["ref"], "shift": s["value"],
        "person": a["person"], "state": a["state"], "why": a["why"], "via": a["via"],
        "decided_by": a["decided_by"], "decided_at": a["decided_at"],
        "week_hours": a["week_hours"],
        "called_off_by": s["called_off_by"] if whole else "",
        "reason": s["reason"] if reasons else "",
        "shift_state": s["state"], "window": s["window"],
        REHEARSAL: bool(a.get(REHEARSAL)),
        "mine": mine, "visible": whole or mine,
    }


def _shift_row(s: dict[str, Any], *, whole: bool, reasons: bool, me: str,
               managers: dict[str, Any] | None = None, who: dict[str, Any] | None = None,
               ist: dict[str, Any] | None = None,
               trainers: "LazyTrainers | None" = None) -> dict[str, Any]:
    code = house_directory.code_of(s["location"]) or str(s["location"] or "").strip().upper()
    hm = (managers or {}).get(code) or {}
    if who is not None and ist is not None and trainers is not None \
            and not s.get("filled_by") and may_decide(who, s["location"]):
        marked = []
        for a in s["applicants"]:
            first = not ist_verdict(ist, a["person"], s["location"])["ok"]
            a = {**a, "ist_ok": not first}
            if first:
                a["training"] = trainers.verdict(location=s["location"], col_iso=s["col_iso"],
                                                 value=s["value"], trainee=a["person"],
                                                 approver=me)
            marked.append(a)
        s = {**s, "applicants": marked}
    return {**s,
            "called_off_by": s["called_off_by"] if whole else "",
            "reason": s["reason"] if reasons else "",
            "code": code, "manager": str(hm.get("name") or ""),
            "mine": any(fold(a["person"]) == fold(me) for a in s["applicants"])}


def _call_off_row(s: dict[str, Any], *, whole: bool, reasons: bool,
                  me: str = "") -> dict[str, Any]:
    hidden = _hides_the_caller(s, whole)
    if whole:
        applicants, history = s["applicants"], s["history"]
        filled = {"filled_by": s["filled_by"], "filled_how": s["filled_how"],
                  "decided_by": s["decided_by"]}
    else:
        applicants = [a for a in s["applicants"] if me and fold(a["person"]) == fold(me)]
        history = [a for a in s["history"] if me and fold(a["person"]) == fold(me)]
        filled = {"filled_by": "", "filled_how": "", "decided_by": ""}
    return {"key": s["ref"] if hidden else s["key"], "ref": s["ref"],
            "open_row": "" if hidden else s["open_row"],
            "house": s["house"], "location": s["location"],
            "col_iso": s["col_iso"], "shift": s["value"],
            "shift_start": s["shift_start"], "shift_end": s["shift_end"],
            "called_off_at": s["window"]["opens_at"],
            "called_off_by": s["called_off_by"] if whole else "",
            "reason": s["reason"] if reasons else "",
            "window": s["window"], "state": s["state"],
            "applicants": applicants, "history": history,
            "applicant_count": len(s["applicants"]), **filled}


def _training_rows(dsn: str, *, whole: bool, me: str,
                   who: dict[str, Any] | None = None,
                   trainers: "LazyTrainers | None" = None) -> list[dict[str, Any]]:
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        cur.execute("SELECT * FROM asa_shift_requests WHERE kind=%s ORDER BY created_at DESC "
                    "LIMIT 400", (KIND_IST,))
        rows = [dict(r) for r in cur.fetchall()]
    out = []
    trainers = trainers or LazyTrainers(dsn)
    for r in rows:
        mine = fold(r["person"]) == fold(me)
        whole_here = whole or (bool(who) and sees_house(who or {}, r["location"]))
        # A call-off training is keyed on the caller's row: hidden from the trainee.
        hidden = r.get("ref") == KIND_CALLOFF and not whole_here
        row = {"id": r["id"], "kind": KIND_IST, "at": _iso(r["created_at"]),
               "house": short_house(r["location"]), "location": r["location"],
               "col_iso": r["col_iso"], "open_row": "" if hidden else r["open_row"],
               "shift": r["value"],
               "person": r["person"], "state": r["state"], "why": r["why"],
               "via": r["via"], "decided_by": r["decided_by"],
               "decided_at": _iso(r["decided_at"]), "for_kind": r["ref"],
               REHEARSAL: is_rehearsed(r),
               "mine": mine, "visible": whole_here or mine}
        if row["visible"] and r["state"] == NEEDS_TRAINING:
            decides = bool(who) and may_decide(who or {}, r["location"])
            row["training"] = trainers.verdict(
                location=r["location"], col_iso=r["col_iso"], value=r["value"],
                trainee=r["person"], approver=me if decides else "")
            row["may_approve"] = decides and bool(row["training"].get("may_approve"))
            if not decides:
                row["training"] = training_for_reader(row["training"])
        elif r["state"] == APPROVED:
            row["trainer"] = _recorded_trainer(r)
        out.append(row)
    return out


def _swap_rows(dsn: str, *, whole: bool, who: dict[str, Any]) -> list[dict[str, Any]]:
    import shift_handoff  # noqa: PLC0415 — lazy: shift_handoff asks this file back
    rows, states = shift_handoff.rows_for(dsn)
    out = []
    for r in rows:
        d = shift_handoff.describe(r, who, training_state=states.get(
            str(r.get("training_request") or ""), ""))
        mine = (d["mine"] or d["may_accept"] or d["may_approve"]
                or d.get("may_approve_director") or d["may_withdraw"])
        out.append({
            **d, "kind": KIND_SWAP, "at": d["created_at"], "shift": d["value"],
            "person": d["to_staff"], "decided_by": d["manager_by"],
            "mine": mine,
            "visible": whole or mine or sees_house(who, str(r.get("location") or ""))})
    return out


def _available(dsn: str, shifts: list[dict[str, Any]], me: str, *, view: dict[str, Any],
               ist: dict[str, Any], now: datetime,
               trainers: "LazyTrainers | None" = None) -> list[dict[str, Any]]:
    """What this person may take now: window open for them and crossing nothing they hold."""
    held = held_by(dsn, me, view=view)
    out = []
    for s in shifts:
        st = _standing(s, me, held=held, view=view, ist=ist)
        if st["code"] != "ok":
            continue
        verdict = st["ist"]
        # Keyed by ref, never the row: for a call-off the row is the caller's name (R9).
        offer = {"key": s["ref"], "ref": s["ref"],
                 "location": s["location"], "house": s["house"],
                 "open_row": "", "col_iso": s["col_iso"], "shift": s["value"],
                 "kind": s["kind"], "window": s["window"],
                 "applicants": len(s["applicants"]),
                 "ist": verdict,
                 "needs_training_approval": not verdict["ok"]}
        if not verdict["ok"]:
            offer["training"] = training_for_reader((trainers or LazyTrainers(dsn, view=view)).verdict(
                location=s["location"], col_iso=s["col_iso"], value=s["value"], trainee=me))
        out.append(offer)
    out.sort(key=lambda r: (r["window"]["closes_at"], r["col_iso"]))
    return out


# ── the row, opened: every fact about a request, cut per reader by `sees_house` ──

ROAD_BUILDER = "builder"
ROAD_FORM = "form"
ROAD_HOTLINE = "hotline"
ROAD_TRACKER = "tracker"
ROAD_WORDS = {
    ROAD_BUILDER: "marked on Calendar Builder",
    ROAD_FORM: "the call-off form (Call Off Tracker)",
    ROAD_HOTLINE: "a call to the hotline",
    ROAD_TRACKER: "a Call Off Tracker row",
}
_SOURCE_ROAD = {
    "tracker": ROAD_TRACKER, "book": ROAD_TRACKER, "form": ROAD_FORM,
    "live queue": ROAD_HOTLINE, "live_queue": ROAD_HOTLINE, "hotline": ROAD_HOTLINE,
    "the line (a caller's name)": ROAD_HOTLINE, "house calendars": ROAD_BUILDER,
    "calendar": ROAD_BUILDER,
}
TRACKER_REASON_COLUMN = "notes_include_reason_and_how_much_advanced_notice"
# the Call Off Tracker the form fills (psi_attendance.TRACKER_TABLE's book), read off asa-hub-db
TRACKER_SHEET_ID = os.getenv("HUB_PSI_CALLOFF_TRACKER_SHEET_ID", "1KIDBnkI8CH_P3WEihDcKPmPyeBNSjR2WUoxptP1IWTA")
TRACKER_TAB = "Master"
_TRACKER_TYPED_AT = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$")


def _tracker_keys(name: Any) -> frozenset[str]:
    """psi_attendance.person_keys: every key a person is found by, both folds at once."""
    s = str(name or "").strip().lower()
    flat = re.sub(r"[^a-z0-9]+", "", s)
    words = " ".join(sorted(re.findall(r"[a-z0-9]+", re.sub(r"['’`]", "", s))))
    return frozenset(k for k in (flat, words) if k)


def _tracker_typed_at(raw: Any) -> str:
    """psi_attendance._typed_at: the form's "M/D/YYYY H:MM:SS" (Ohio wall time) as an instant, or ''."""
    m = _TRACKER_TYPED_AT.match(str(raw or ""))
    if not m:
        return ""
    try:
        local = datetime(int(m.group(3)), int(m.group(1)), int(m.group(2)), int(m.group(4)),
                         int(m.group(5)), int(m.group(6) or 0), tzinfo=OHIO)
    except ValueError:
        return ""
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _tracker_rows(days: list[str]) -> list[dict[str, Any]]:
    """The tracker's rows on these days, its columns as the mirror named them."""
    def col(h: str) -> str:
        return re.sub(r"[^a-z0-9]+", "_", str(h).lower()).strip("_")

    out = []
    for d in lanes_sheets.data(TRACKER_SHEET_ID, TRACKER_TAB):
        row = {col(h): lanes_sheets.text(v) for h, v in d.items()}
        if row.get("date", "").strip() in days:
            out.append({k: row.get(k, "") for k in ("employee_name", "date", "type", "timestamp", "your_name")}
                       | {"notes": row.get(TRACKER_REASON_COLUMN, "")})
    return out
# Must match the reporter name CommCallOffForm.gs writes on Builder-filed rows.
BUILDER_REPORTER = "calendar builder"


def _us_days(col_iso: str) -> list[str]:
    d = day_of(col_iso)
    if d is None:
        return []
    return list(dict.fromkeys([f"{d.month}/{d.day}/{d.year}",
                               f"{d.month:02d}/{d.day:02d}/{d.year}"]))


def call_off_stories(dsn: str, calloffs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    if not calloffs:
        return {}
    refs = [str(s.get("ref") or "") for s in calloffs]
    builder: dict[str, dict[str, Any]] = {}
    tracker: list[dict[str, Any]] = []
    why = ""
    keys_of, typed_at, table = _tracker_keys, _tracker_typed_at, TRACKER_SHEET_ID
    try:
        with _connect(dsn) as conn, conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT to_regclass('asa_calendar_calloff_road') IS NOT NULL AS here")
            if (cur.fetchone() or {}).get("here"):
                cur.execute("SELECT ref, actor, created_at, reason, state, told_at, tries, "
                            "last_error, answer FROM asa_calendar_calloff_road "
                            "WHERE ref = ANY(%s)", (refs,))
                builder = {r["ref"]: dict(r) for r in cur.fetchall()}
            days = sorted({d for s in calloffs for d in _us_days(s.get("col_iso") or "")})
            if table and days:
                tracker = _tracker_rows(days)
    except Exception as exc:  # noqa: BLE001
        why = why or f"how these call-offs were filed could not be read ({type(exc).__name__})"
    out: dict[str, dict[str, Any]] = {}
    for s in calloffs:
        ref = str(s.get("ref") or "")
        story: dict[str, Any] = {"readable": not why, "why": why, "road": "", "road_words": "",
                                 "by": "", "at": "", "reason": "", "reason_why": "",
                                 "urgent": {"known": False, "why": ""}}
        b = builder.get(ref)
        if b:
            answer = b.get("answer") if isinstance(b.get("answer"), dict) else {}
            typed = str(b.get("reason") or "").strip()
            story.update(road=ROAD_BUILDER, road_words=ROAD_WORDS[ROAD_BUILDER],
                         by=str(b.get("actor") or ""), at=_iso(b.get("created_at")),
                         reason=typed,
                         reason_why="" if typed else "no reason was typed on Calendar Builder")
            story["urgent"] = _urgent_of(b, answer)
            out[ref] = story
            continue
        keys = keys_of(s.get("called_off_by") or s.get("open_row") or "")
        spellings = set(_us_days(s.get("col_iso") or ""))
        hit = next((t for t in tracker
                    if str(t.get("date") or "").strip() in spellings
                    and keys & keys_of(t.get("employee_name") or "")), None)
        if hit:
            reporter = " ".join(str(hit.get("your_name") or "").split())
            road = ROAD_BUILDER if reporter.lower().startswith(BUILDER_REPORTER) else ROAD_TRACKER
            notes = " ".join(str(hit.get("notes") or "").split())
            story.update(road=road, road_words=ROAD_WORDS[road], by=reporter,
                         at=typed_at(hit.get("timestamp")) or str(hit.get("timestamp") or ""),
                         reason=notes,
                         reason_why="" if notes else "the tracker row gives no reason")
        else:
            source = str(s.get("reason") or "").strip()
            road = _SOURCE_ROAD.get(source.lower(), "")
            story.update(road=road or source, road_words=ROAD_WORDS.get(road, source),
                         at=str((s.get("window") or {}).get("opens_at") or ""),
                         reason_why=("no reason text is on file for this call-off"
                                     if not why else why))
        story["urgent"] = {
            "known": False,
            "why": ("the URGENT OPEN SHIFT for a call-off filed by the hotline or the form is "
                    "sent by the platform, and its record is on Smart Comms → Activity — the "
                    "relay keeps no copy of that send")}
        out[ref] = story
    return out


def _urgent_of(road_row: dict[str, Any], answer: dict[str, Any]) -> dict[str, Any]:
    state = str(road_row.get("state") or "")
    if state == "told":
        at = _iso(road_row.get("told_at"))
        leg = answer.get("urgent")
        if not isinstance(leg, dict):
            return {"known": False, "state": "", "at": at, "sent": 0, "held": 0,
                    "why": "the door's answer does not say what the URGENT OPEN SHIFT did — "
                           "its record is on Smart Comms → Activity"}
        sent = int(leg.get("sent") or 0)
        redirected = int(leg.get("redirected") or 0)
        rows = int(leg.get("rehearsal_rows") or 0)
        word = str(leg.get("state") or "")
        if sent and not redirected:
            kind = "sent"
        elif redirected or rows or word in ("recorded", "rehearsed"):
            kind = "held"
        elif word == "deferred":
            kind = "deferred"
        else:
            kind = "not_sent"
        return {"known": True, "state": kind, "at": at, "sent": sent,
                "held": redirected or rows, "why": str(leg.get("why") or "")}
    if state == "gave_up":
        return {"known": True, "state": "gave_up", "at": _iso(road_row.get("tried_at")),
                "sent": 0, "held": 0,
                "why": str(road_row.get("last_error") or "the door never filed it")}
    return {"known": True, "state": "owed", "at": "", "sent": 0, "held": 0,
            "why": (str(road_row.get("last_error") or "")
                    or "handed to the send door — it goes out when the door files it")}


def essentials(location: str, col_iso: str, value: str, *,
               homes: dict[str, dict[str, str]],
               managers: dict[str, Any]) -> dict[str, Any]:
    code = house_directory.code_of(location) or str(location or "").strip().upper()
    home = homes.get(code) or {}
    span = span_of(col_iso, value)
    hm = (managers.get("by_code") or {}).get(code) or {}
    names = [n for n in (hm.get("names") or [hm.get("name")]) if n]
    return {"house": short_house(location), "house_name": str(home.get("name") or ""),
            "code": code, "address": str(home.get("address") or ""),
            "col_iso": col_iso, "shift_code": str(value or "").strip(),
            "shift_start": _iso(span[0]) if span else "",
            "shift_end": _iso(span[1]) if span else "",
            "hours": round((span[1] - span[0]).total_seconds() / 3600.0, 2) if span else None,
            "manager": str(hm.get("name") or ""), "managers": names,
            "managers_readable": bool(managers.get("readable")),
            # who decides when no house manager is on file, in words the badges generate
            "deciders": deciders_all()}


def _homes(dsn: str) -> dict[str, dict[str, str]]:
    try:
        return house_directory.read(dsn)
    except Exception:  # noqa: BLE001
        return {}


def shift_card(s: dict[str, Any], *, here: bool, homes: dict[str, dict[str, str]],
               managers: dict[str, Any], story: dict[str, Any] | None = None) -> dict[str, Any]:
    card = {**essentials(s["location"], s["col_iso"], s["value"], homes=homes,
                         managers=managers),
            "ref": s["ref"], "location": s["location"], "kind": s["kind"], "state": s["state"],
            "window": s["window"], "link": deep_link(s["ref"], s["location"]),
            "applicant_count": len(s.get("applicants") or []),
            "filled": bool(s.get("filled_by"))}
    if s["kind"] == KIND_CALLOFF:
        st = story or {}
        urgent = st.get("urgent") or {"known": False, "why": "not read"}
        # The send's why can name the addresses it reached.
        card["urgent"] = urgent if here else {**urgent, "why": ""}
        if here:
            card["called_off"] = {
                "by": s.get("called_off_by") or "", "at": st.get("at") or s["window"]["opens_at"],
                "road": st.get("road") or "", "road_words": st.get("road_words") or "",
                "filed_by": st.get("by") or "", "reason": st.get("reason") or "",
                "reason_why": st.get("reason_why") or "", "readable": st.get("readable", True),
                "why": st.get("why") or ""}
    if here and s.get("filled_by"):
        card["decision"] = {"person": s["filled_by"], "how": _how_said(s),
                            "by": s.get("decided_by") or "", "at": s.get("closed_at") or ""}
    return card


# ── time off: the Time Off house's rows, cut by the app's own rule ─────────

TIME_OFF_MAX_DAYS = int(os.getenv("HUB_REQUESTS_TIME_OFF_MAX_DAYS", "31"))
KIND_TIME_OFF = "time_off"


def _time_off_tab(dsn: str, who: dict[str, Any], view: dict[str, Any]) -> dict[str, Any]:
    import time_off as house  # noqa: PLC0415 — lazy: it imports this file back
    return house.requests_tab(dsn, who, view)


def _cells_by_person(view: dict[str, Any]) -> dict[str, list[tuple[str, str, str]]]:
    out: dict[str, list[tuple[str, str, str]]] = {}
    for loc in view["locations"]:
        for (emp, iso), text in view["cells"].get(loc, {}).items():
            if house_cal_live.not_a_person(emp, loc):
                continue
            out.setdefault(fold(emp), []).append((loc, iso, text))
    return out


def displaced_by(person: str, start: date, end: date, *,
                 cells: dict[str, list[tuple[str, str, str]]],
                 opens: dict[tuple[str, str], list[dict[str, Any]]],
                 names_at: Any) -> list[dict[str, Any]]:
    key = fold(person)
    out: list[dict[str, Any]] = []
    for loc, iso, text in sorted(cells.get(key, []), key=lambda c: (c[1], c[0])):
        d = day_of(iso)
        if d is None or not start <= d <= end or (d - start).days >= TIME_OFF_MAX_DAYS:
            continue
        entry = {"house": short_house(loc), "location": loc, "col_iso": iso, "value": text}
        if span_of(iso, text) is not None:
            out.append({**entry, "working": True, "covered": False,
                        "why": "still on the calendar under their name"})
            continue
        open_rows = opens.get((loc, iso), [])
        filled = [o for o in open_rows if o.get("filled_by")]
        if not open_rows:
            covered, why = None, "no open shift was put up at this house that day"
        elif len(filled) == len(open_rows):
            covered, why = True, "every open shift at this house that day was given"
        else:
            covered, why = False, (f"{len(open_rows) - len(filled)} of {len(open_rows)} open "
                                   f"shift(s) at this house that day still to give")
        out.append({**entry, "working": False, "covered": covered, "why": why,
                    "open_shifts": [{"ref": o["ref"], "value": o["value"], "state": o["state"],
                                     "filled_by": o.get("filled_by") if names_at(loc) else ""}
                                    for o in open_rows]})
    return out


def time_off(dsn: str, *, who: dict[str, Any], view: dict[str, Any],
             pooled: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        got = _time_off_tab(dsn, who, view)
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said, the rest of Requests still answers
        return {"readable": False, "rows": [],
                "why": f"the time-off requests could not be read ({type(exc).__name__})"}
    if not got.get("readable"):
        return {"readable": False, "rows": [], "why": str(got.get("why") or "")}
    cells = _cells_by_person(view)
    opens: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for p in pooled:
        if p["kind"] == KIND_OPEN:
            opens.setdefault((p["location"], p["col_iso"]), []).append(p)
    out = []
    for r in got.get("rows") or []:
        start, end = day_of(r.get("start")), day_of(r.get("end"))
        if start is None or end is None:
            continue
        houses = r.get("houses") or []
        out.append({
            **r, "houses": [h.get("code") if isinstance(h, dict) else str(h) for h in houses],
            "house_labels": [h.get("label") if isinstance(h, dict) else str(h) for h in houses],
            "displaced": displaced_by(r.get("person") or "", start, end, cells=cells, opens=opens,
                                      names_at=lambda loc: sees_house(who, loc))})
    # The directors list that decides these rows, as the Time Off house answered it.
    return {"readable": True, "why": "", "rows": out,
            "directors_readable": bool(got.get("directors_readable")),
            "directors_why": str(got.get("directors_why") or "")}


# ── the panel's heavy half, read when a row is opened ───────────────────────

def shift_detail(dsn: str, *, who: dict[str, Any], ref: str,
                 now: datetime | None = None) -> dict[str, Any]:
    """Read only when a row opens."""
    now = now or _now()
    view = estate(dsn)
    ist = ist_index(dsn)
    pooled = pool(dsn, now=now, view=view)
    s = next((p for p in pooled if p["ref"] == ref), None)
    if s is None:
        raise Refused("that shift is no longer in the pool", "no_such_shift")
    me = str(who.get("name") or "")
    here = sees_house(who, s["location"])
    mine = None
    if me:
        mine = _standing(s, me, held=held_by(dsn, me, view=view), view=view, ist=ist)
    if not (here or s["kind"] == KIND_CALLOFF
            or (mine and mine.get("code") in ("ok", "applied"))
            or any(fold(a["person"]) == fold(me) for a in s["history"])):
        raise Refused("that shift is not on your list", "not_yours")
    managers = house_managers(dsn)
    story = (call_off_stories(dsn, [s]).get(s["ref"]) if s["kind"] == KIND_CALLOFF else None)
    card = shift_card(s, here=here, homes=_homes(dsn), managers=managers, story=story)

    people: list[str] = []
    seen: set[str] = set()
    for loc in view["locations"]:
        for n in view["people"].get(loc, []):
            if not_a_person(n, loc) or fold(n) in seen or not fold(n):
                continue
            seen.add(fold(n))
            people.append(n)
    names = people + [a["person"] for a in s["history"] if fold(a["person"]) not in seen] \
        + [n for n in card["managers"] if fold(n) not in seen]
    held = held_by_many(dsn, names, view=view)
    cell = (s["location"], s["open_row"], s["col_iso"])
    span = span_of(s["col_iso"], s["value"])
    may_now, free = [], []
    for n in people:
        if s["kind"] == KIND_CALLOFF and fold(n) == fold(s["open_row"]):
            continue
        if not clash_for(span, _skipping(held.get(n, []), cell)):
            free.append(n)
        if not s.get("filled_by") and _standing(s, n, held=held.get(n, []), view=view,
                                                ist=ist)["code"] == "ok":
            may_now.append(n)
    card["eligible"] = {"may_apply_now": len(may_now), "free": len(free), "of": len(people),
                        "why": (s["window"].get("why") or "") if s["state"] != WINDOW_OPEN else ""}
    if here:
        card["eligible"]["names"] = sorted(may_now)[:60]

    def one(a: dict[str, Any]) -> dict[str, Any]:
        clash = clash_for(span, _skipping(held.get(a["person"], []), cell))
        return {**a, "live": a["state"] in LIVE_STATES,
                "ist": ist_verdict(ist, a["person"], s["location"]),
                "regular": is_regular(view, a["person"], s["location"]),
                "overlap": clash_sentence(clash) if clash else "",
                "clash": clash_out(clash)}

    def availability(name: str) -> dict[str, Any]:
        clash = clash_for(span, held.get(name, []))
        return {"name": name, "free": clash is None,
                "why": f"busy — {clash_sentence(clash)}" if clash else "free then"}

    if here:
        card["applicants"] = [one(a) for a in s["history"]]
        card["manager_availability"] = [availability(n) for n in card["managers"]]
    else:
        card["applicants"] = [one(a) for a in s["history"] if me and fold(a["person"]) == fold(me)]
    card["mine"] = mine
    card["at"] = _iso(now)
    return card


# ── the panels: house managers and above ───────────────────────────────────

PANEL_DAYS = int(os.getenv("HUB_REQUESTS_PANEL_DAYS", "14"))


def panels(dsn: str, *, who: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    """Late calls, no-calls and latest fills, from existing verdicts only; only `no_punch` is a real no-call."""
    now = now or _now()
    codes = set(who.get("manages") or [])
    everywhere = bool(who.get("decides_everywhere"))
    # The same test as sees_house: the panels are for house managers and above, and the badge says who is a manager…
    whole = everywhere or bool(who.get("whole_company"))
    out: dict[str, Any] = {"late_calls": [], "no_show_no_call": [], "took_open": [],
                           "took_call_off": [], "readable": True, "why": ""}

    def mine(house: Any) -> bool:
        if whole:
            return True
        code = house_directory.code_of(house) or str(house or "").strip().upper()
        return code in codes

    if not whole and not who.get("managers_readable", True):
        # FAIL-CLOSED: which houses are this reader's could not be read — said, never empty lists.
        out["readable"] = False
        out["why"] = "who manages which house could not be read, so the houses you manage are not known"
        out.update(replies=[], replies_readable=False, replies_why=out["why"])
        return out
    try:
        board = _attendance_board()
    except Exception as exc:  # noqa: BLE001
        board = None
        out["readable"] = False
        out["why"] = f"the punch board could not be read ({type(exc).__name__})"
    for row in (board or {}).get("rows", []):
        if row.get("row_kind") != "shift" or not mine(row.get("house")):
            continue
        if row.get("late_call"):
            out["late_calls"].append({"person": row.get("person"), "house": row.get("house"),
                                      "day": row.get("day"), "shift": row.get("shift_code"),
                                      "shift_at": row.get("shift_at"),
                                      "told_at": row.get("told_at") or "",
                                      "source": row.get("told_source") or ""})
        if row.get("verdict") == "no_punch":
            out["no_show_no_call"].append({
                "person": row.get("person"), "house": row.get("house"), "day": row.get("day"),
                "shift": row.get("shift_code"), "shift_at": row.get("shift_at"),
                "minutes": row.get("minutes"), "checked_at": row.get("checked_at") or ""})
    out["late_calls"].sort(key=lambda r: str(r.get("day") or ""), reverse=True)
    out["no_show_no_call"].sort(key=lambda r: str(r.get("day") or ""), reverse=True)

    for s in pool(dsn, now=now):
        if not s["filled_by"] or not mine(s["location"]):
            continue
        taken = {"person": s["filled_by"], "house": s["house"], "location": s["location"],
                 "col_iso": s["col_iso"], "shift": s["value"], "at": s["closed_at"],
                 "how": _how_said(s), "decided_by": s["decided_by"]}
        (out["took_call_off"] if s["kind"] == KIND_CALLOFF else out["took_open"]).append(taken)
    for key in ("took_open", "took_call_off"):
        out[key].sort(key=lambda r: str(r.get("at") or ""), reverse=True)
        out[key] = out[key][:40]

    try:
        import lanes_sms_replies as sms_ears  # noqa: PLC0415
        got = sms_ears.replies(dsn, mine=mine, everywhere=everywhere, now=now)
    except Exception as exc:  # noqa: BLE001
        got = {"readable": False, "rows": [],
               "why": f"the replies by text could not be read ({type(exc).__name__})"}
    out["replies"] = got.get("rows") or []
    out["replies_readable"] = bool(got.get("readable"))
    out["replies_why"] = str(got.get("why") or "")
    return out


def _how_said(s: dict[str, Any]) -> str:
    how = str(s.get("filled_how") or "")
    if how == "approved":
        return "applied and approved"
    if how == "assigned":
        return "assigned by the house manager"
    if how in ("app", "sms", ""):
        return "first-come"
    return how


def _attendance_board() -> dict[str, Any] | None:
    """The attendance lane's own board, from its slice; never a second PsiAnywhere read."""
    import punch_board_slices  # noqa: PLC0415
    body = json.loads(punch_board_slices.BOARD_FILE.read_text(encoding="utf-8") or "{}")
    if not isinstance(body, dict):
        raise ValueError("the punch board is not a record")
    return {"rows": [r for r in (body.get("rows") or []) if isinstance(r, dict)],
            "generated_at": str(body.get("generated_at") or "")}


# ── what the message door is owed ──────────────────────────────────────────

KIND_APPLICANTS = "open_shift_applicants"


def owed(dsn: str, *, limit: int = 20, now: datetime | None = None) -> list[dict[str, Any]]:
    """A closed window with applicants whose house manager was not told; once per shift, never for empty windows."""
    now = now or _now()
    managers = house_managers(dsn).get("by_code") or {}
    rehearsed = messages_rehearsed()
    out = []
    for s in pool(dsn, now=now):
        # a rehearsed application is nobody's: outside the rehearsal's sandbox it never tells a house manager anything
        applicants = [a for a in s["applicants"] if rehearsed or not a.get(REHEARSAL)]
        if s["state"] != WINDOW_CLOSED or s["filled_by"] or not applicants:
            continue
        if KIND_APPLICANTS in (s.get("said") or {}):
            continue
        code = house_directory.code_of(s["location"]) or s["location"]
        out.append({
            "id": f"{s['location']}|{s['open_row']}|{s['col_iso']}:{KIND_APPLICANTS}",
            "kind": KIND_APPLICANTS, "person": applicants[0]["person"],
            # The recipient is the manager; a greeting built from `person` would name the applicant.
            "to_name": str((managers.get(code) or {}).get("name") or ""),
            "house": code,
            "house_name": s["house"], "shift_at": s["shift_start"],
            "shift_code": s["value"], "value": s["value"], "col_iso": s["col_iso"],
            "applicants": len(applicants),
            "location": s["location"], "open_row": s["open_row"]})
        if len(out) >= limit:
            break
    return out


def said_already(dsn: str) -> dict[str, dict[str, Any]]:
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        _ddl(cur)
        cur.execute("SELECT location, open_row, col_iso, said FROM asa_shift_pool")
        return {f"{r['location']}|{r['open_row']}|{r['col_iso']}": (r["said"] or {})
                for r in cur.fetchall()}


def mark_said(dsn: str, ids: list[str], results: dict[str, Any]) -> int:
    """Marks only what the door said it did, in its own words (psi_reminders._DONE); it never answers `sent`."""
    by_id = {str(r.get("id")): str(r.get("state") or "") for r in (results.get("results") or [])}
    keep = {"told", "redirected", "rehearsed", "recorded", "held", "refused", "duplicate",
            "no_contact", "opted_out", "not_staff", "no_manager", "dial_off"}
    done = 0
    with _connect(dsn) as conn, conn.cursor() as cur:
        _ddl(cur)
        for key in ids:
            cell, _, kind = str(key).rpartition(":")
            parts = cell.split("|")
            if len(parts) != 3 or not kind:
                continue
            if by_id and by_id.get(key, "") not in keep:
                continue
            cur.execute(
                "UPDATE asa_shift_pool SET said = said || jsonb_build_object(%s, "
                "to_jsonb(now()::text)) WHERE location=%s AND open_row=%s AND col_iso=%s",
                (kind, *parts))
            done += cur.rowcount
        conn.commit()
    return done
