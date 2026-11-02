"""The staff answers, rehearsed — each one through the door a real one comes through, inside the sealed sandbox.
This module refuses to load outside a sealed worker (rehearsal_sandbox.py)."""
from __future__ import annotations

import json
import logging
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import psycopg2
import psycopg2.extras

import rehearsal_sandbox as box

if not box.sealed():
    raise ImportError("the rehearsal's acts run only inside the sealed sandbox worker "
                      "(rehearsal_sandbox.py) — never in the relay's own process")

import house_cal_live  # noqa: E402 — every lane only after the seal
import house_directory  # noqa: E402
import open_shift_covered  # noqa: E402
import psi_reminders  # noqa: E402
import shift_handoff  # noqa: E402
import shift_requests as sr  # noqa: E402
import sms_ears  # noqa: E402
from shift_rehearsal import ACTS, CLOCK_ACTS, DOORS, Refused  # noqa: E402
from shift_rehearsal import UNREADABLE, owed_diff, owed_entry  # noqa: E402

box.configure_lanes()

log = logging.getLogger("hub.shiftrehearsal.acts")

UTC = timezone.utc
DSN = box.dsn()

MARK = sr.REHEARSAL
VIA_APP = f"{MARK}:app"
VIA_TEXT = f"{MARK}:sms"
# a simulated text keeps an id of its own shape, so its row on the ear's ledger is known by name
TEXT_ID_PREFIX = "REH"
TEXT_ID_RE = re.compile(r"^REH[0-9A-F]{12}$")
INBOX_FILE = "rehearsal.jsonl"
# one rehearsed answer, reset or preparation at a time in the sandbox (exclusive), boards read beside each other…
ACT_LOCK_NS = box.LOCK_SHIFT + 8290
# how long a board or an answer waits its turn before it is refused as busy
try:
    BOARD_WAIT_S = ACT_WAIT_S = max(0.0, float(os.getenv("HUB_SHIFT_REHEARSAL_WAIT_S", "20")))
except ValueError:
    BOARD_WAIT_S = ACT_WAIT_S = 20.0

DONE, REFUSED, HELD, PLAYING = "done", "refused", "held", "playing"

LEDGER_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_shift_rehearsal ("
    "id TEXT PRIMARY KEY, run TEXT NOT NULL DEFAULT '', "
    "at TIMESTAMPTZ NOT NULL DEFAULT now(), driver TEXT NOT NULL DEFAULT '', "
    "door TEXT NOT NULL DEFAULT '', act TEXT NOT NULL DEFAULT '', "
    "person TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', "
    "open_row TEXT NOT NULL DEFAULT '', col_iso TEXT NOT NULL DEFAULT '', "
    "value TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '', "
    "outcome TEXT NOT NULL DEFAULT '', code TEXT NOT NULL DEFAULT '', "
    "why TEXT NOT NULL DEFAULT '', said TEXT NOT NULL DEFAULT '', "
    "lanes JSONB NOT NULL DEFAULT '{}'::jsonb, made JSONB NOT NULL DEFAULT '{}'::jsonb, "
    "owed JSONB NOT NULL DEFAULT '[]'::jsonb, "
    "cleared_at TIMESTAMPTZ, cleared_by TEXT NOT NULL DEFAULT '')",
    "CREATE INDEX IF NOT EXISTS asa_shift_rehearsal_at ON asa_shift_rehearsal (at DESC)",
)
_ROW_FIELDS = ("id", "run", "at", "driver", "door", "act", "person", "location", "open_row",
               "col_iso", "value", "ref", "outcome", "code", "why", "said", "lanes", "made",
               "owed", "cleared_at", "cleared_by")


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value or "")


def _instant(raw: Any) -> datetime | None:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        got = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return got if got.tzinfo else got.replace(tzinfo=UTC)


def _new_id() -> str:
    return TEXT_ID_PREFIX + secrets.token_hex(6).upper()


def _clean_run(raw: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(raw or "").upper())[:24]


def _is_rehearsed_via(via: Any) -> bool:
    return str(via or "").startswith(f"{MARK}:")


class _ActLock:
    """Exclusive: one rehearsed answer, reset or preparation at a time, never interleaved."""

    def __init__(self, *, shared: bool = False, wait: float = 0.0) -> None:
        self.conn = None
        self.shared, self.wait = shared, max(0.0, float(wait))

    def __enter__(self) -> "_ActLock":
        self.conn = psycopg2.connect(DSN)
        self.conn.autocommit = True
        fn = "pg_try_advisory_lock_shared" if self.shared else "pg_try_advisory_lock"
        deadline = time.monotonic() + self.wait
        while True:
            with self.conn.cursor() as cur:
                cur.execute(f"SELECT {fn}(%s, hashtext(%s))", (ACT_LOCK_NS, box.schema()))
                held = bool((cur.fetchone() or [False])[0])
            if held or time.monotonic() >= deadline:
                break
            time.sleep(0.2)
        if not held:
            self.conn.close()
            self.conn = None
            raise Refused(("the sandbox is busy with a rehearsed answer or a reset — read it "
                           "again in a moment") if self.shared else
                          ("another rehearsed answer, a reset or a board is using the sandbox "
                           "right now — play this one in a moment"), "busy")
        return self

    def __exit__(self, *exc: Any) -> None:
        if self.conn is not None:
            try:
                self.conn.close()
            except Exception:  # noqa: BLE001 — closing the connection gives the lock back
                pass
        self.conn = None


def _prepare(by: str) -> dict[str, Any]:
    """Run ONLY under the exclusive act lock: the sandbox's tables made inside it, its copy of the estate taken…"""
    box.ensure(DSN, LEDGER_DDL)
    got = box.meta(DSN)
    if not got.get("filled_at"):
        return box.fill(DSN, by=by or "the first rehearsal")
    if box.top_up(DSN):
        got = box.meta(DSN)
    return got


def run(op: str, args: dict[str, Any]) -> dict[str, Any]:
    if op == "board":
        return board(**args)
    if op == "answer":
        return answer(**args)
    if op == "reset":
        return reset(**args)
    raise Refused(f"{op or 'nothing'} is not something the rehearsal does", "no_op")


# ── the estate as the sandbox holds it ─────────────────────────────────────

def _people_of(view: dict[str, Any], location: str) -> list[str]:
    out = []
    for name in view.get("people", {}).get(location, []) or []:
        if not str(name or "").strip() or house_cal_live.is_open_row(name):
            continue
        if sr.not_a_person(name, location) or name in out:
            continue
        out.append(name)
    return sorted(out)


def _giveable(view: dict[str, Any], houses: list[str], now: datetime) -> dict[str, Any]:
    """Each person's own shifts still ahead, per house: what a swap can offer."""
    out: dict[str, dict[str, list[dict[str, str]]]] = {}
    for loc in houses:
        people = set(_people_of(view, loc))
        per: dict[str, list[dict[str, str]]] = {}
        for (emp, iso), text in ((view.get("cells") or {}).get(loc) or {}).items():
            if emp not in people:
                continue
            span = sr.span_of(iso, text)
            if span is None or span[0] <= now:
                continue
            per.setdefault(emp, []).append({"col_iso": str(iso), "value": str(text)})
        out[loc] = {emp: sorted(cells, key=lambda c: c["col_iso"])
                    for emp, cells in sorted(per.items())}
    return out


class PhoneBook:
    """The reply ear's own index by name, or why it could not be read — never an empty book in place of one…"""

    def __init__(self, numbers: dict[str, str] | None, why: str = "") -> None:
        self.numbers, self.why = numbers, why

    @property
    def readable(self) -> bool:
        return self.numbers is not None

    def number(self, name: Any) -> str:
        return (self.numbers or {}).get(sr.fold(name) or "", "")


def _source_words(exc: Exception) -> str:
    # the contact readers' own refusals are sentences; anything else is named by its kind
    if type(exc).__name__ == "SourceError" and str(exc).strip():
        return str(exc).strip().rstrip(".")
    return type(exc).__name__


def reachable_names() -> set[str] | None:
    """The name keys with a phone on file, read exactly as the real offer route reads them…"""
    try:
        book = sms_ears.load_contacts(DSN)
    except box.SandboxBreach:
        raise
    except Exception as exc:  # noqa: BLE001 — the real route's own reading of a failed index
        log.info("shift rehearsal: who can be reached could not be read (%s)", type(exc).__name__)
        return None
    return {k for names in (book.roster or {}).values() for k in names}


def phone_book() -> PhoneBook:
    """name key → the number the reply ear's own index holds for exactly one person."""
    try:
        contacts = sms_ears.load_contacts(DSN)
    except box.SandboxBreach:
        raise
    except Exception as exc:  # noqa: BLE001 — said on the board and on every text act
        why = _source_words(exc)
        log.info("shift rehearsal: the contact index could not be read (%s)", why)
        return PhoneBook(None, why)
    out: dict[str, str] = {}
    for digits, people in (contacts.roster or {}).items():
        if len(people) != 1:
            continue
        key = sr.fold(next(iter(people.values())))
        if not key or len(re.sub(r"\D", "", str(digits))) < 10:
            continue
        if key in out and out[key] != digits:
            # two numbers for one name: which one they would text from is not a guess
            out[key] = ""
            continue
        out.setdefault(key, str(digits))
    return PhoneBook({k: v for k, v in out.items() if v})


def _number_or_refusal(row: dict[str, Any], person: str) -> tuple[str, dict[str, Any] | None]:
    """The one number `person` would text from, or the refusal that says why there is none."""
    book = phone_book()
    if not book.readable:
        return "", _refuse_row(
            row, code="contacts_unreadable",
            why=f"the contact index could not be read ({book.why}), so which number {person} "
                f"would text from is not known — no text was played")
    phone = book.number(person)
    if not phone:
        return "", _refuse_row(row, code="no_number",
                               why=f"the reply ear's own index holds no single number for "
                                   f"{person}, so no text could come from them")
    return phone, None


# ── who a decision or an approval is played as ────────────────────────────

def _house_managers() -> dict[str, Any]:
    try:
        got = sr.house_managers(DSN, fresh=True)
    except Exception as exc:  # noqa: BLE001 — said, never an empty list of managers
        return {"readable": False, "why": f"the managers could not be read ({type(exc).__name__})",
                "by_code": {}}
    return got if isinstance(got, dict) else {"readable": False, "why": "no answer", "by_code": {}}


def _deciders_of(managers: dict[str, Any], location: str) -> list[str]:
    """The house's own managers, as the hotline calendar names them — the lane's reading."""
    code = house_directory.code_of(location) or str(location or "").strip().upper()
    hm = (managers.get("by_code") or {}).get(code) or {}
    out: list[str] = []
    for n in [*(hm.get("names") or []), hm.get("name")]:
        if n and sr.fold(n) and sr.fold(n) not in {sr.fold(x) for x in out}:
            out.append(str(n))
    return out


def _approvers_of(h: dict[str, Any]) -> list[str]:
    """The names a transfer's approval is given by, read as may_approve reads them."""
    pair = shift_handoff._pair(h)  # noqa: SLF001 — the lane's own reading of who is in the swap
    out: list[str] = []
    for n in [*shift_handoff._names(h.get("approvers")),  # noqa: SLF001
              str(h.get("house_manager") or "")]:
        key = sr.fold(n)
        if key and key not in pair and key not in {sr.fold(x) for x in out}:
            out.append(n)
    return out


def _reader_for(name: str, *, driver: str,
                driver_reader: dict[str, Any] | None) -> dict[str, Any]:
    """The reader the real door would hold for `name`: the driver's own session when it is them, else the lane's…"""
    key = sr.fold(name)
    if driver_reader and key and key == sr.fold(driver):
        return {**driver_reader, "name": name}
    try:
        who = sr.viewer_by_name(DSN, name)
    except Exception as exc:  # noqa: BLE001 — refused in words, never read as nobody
        raise Refused(f"who {name} is on the platform could not be read ({type(exc).__name__}), "
                      f"so what the real door would let them do could not be weighed — nothing "
                      f"was played", "reader_unreadable") from None
    if not who.get("managers_readable", True):
        raise Refused(f"who manages the houses could not be read, so whether {name} manages "
                      f"this one could not be weighed — nothing was played",
                      "managers_unreadable")
    return who


def _line() -> str:
    lines = sorted(psi_reminders.REPLY_LINES)
    return lines[0] if lines else ""


def made(limit: int = 200) -> list[dict[str, Any]]:
    """Everything played in the sandbox, newest first."""
    with psycopg2.connect(DSN) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM asa_shift_rehearsal ORDER BY at DESC LIMIT %s", (limit,))
        rows = [dict(r) for r in cur.fetchall()]
    return [{**{k: (_iso(r.get(k)) if k in ("at", "cleared_at") else r.get(k))
                for k in _ROW_FIELDS},
             "house": sr.short_house(str(r.get("location") or "")),
             "cleared": bool(r.get("cleared_at"))} for r in rows]


def board(*, driver: str = "", run: str = "", at: str = "", **_: Any) -> dict[str, Any]:
    """Everything the rehearsal screen draws, read from the sandbox."""
    now = _now()
    clock = _clock_or_none(at)
    with _ActLock(wait=BOARD_WAIT_S):
        sandbox = _prepare(driver)
    with _ActLock(shared=True, wait=BOARD_WAIT_S):
        return _read_board(driver=driver, run=run, now=now, clock=clock, sandbox=sandbox)


def _read_board(*, driver: str, run: str, now: datetime, clock: datetime | None,
                sandbox: dict[str, Any]) -> dict[str, Any]:
    view = sr.estate(DSN, fresh=True)
    houses = list(view.get("locations") or [])
    pooled = sr.pool(DSN, now=clock or now, view=view)
    here = [s for s in pooled if s["location"] in houses]
    elsewhere = sorted({s["location"] for s in pooled if s["location"] not in houses})
    book = phone_book()
    managers = _house_managers()
    shifts = []
    for s in here:
        rows = list(s.get("applicants") or [])
        shifts.append({
            "ref": s["ref"], "location": s["location"], "house": s["house"],
            "open_row": s["open_row"], "col_iso": s["col_iso"], "value": s["value"],
            "kind": s["kind"], "state": s["state"], "window": s["window"],
            "shift_start": s["shift_start"], "filled_by": s["filled_by"],
            "clock": _clock_window(s),
            "applicants": [{"id": a["id"], "person": a["person"], "state": a["state"],
                            "via": a["via"], "rehearsed": bool(a.get(sr.REHEARSAL))}
                           for a in rows],
            "rehearsal_only": bool(rows) and all(a.get(sr.REHEARSAL) for a in rows),
        })
    people = {loc: _people_of(view, loc) for loc in houses}
    swaps = [{"id": h["id"], "location": h["location"], "house": sr.short_house(h["location"]),
              "col_iso": h["col_iso"], "value": h["value"], "from_staff": h["from_staff"],
              "to_staff": h["to_staff"], "house_manager": h.get("house_manager") or "",
              "staff_state": h.get("staff_state"), "manager_state": h.get("manager_state"),
              "approval": h.get("approval") or "",
              # the transfer's own approvers — the names the approval picker offers, not the grid
              "approvers": _approvers_of(h), "approval_why": str(h.get("approval_why") or ""),
              # the third consent: the directors the row was asked of, from the settings list
              "directors": shift_handoff.director_names(h),
              "director_state": str(h.get("director_state") or ""),
              "rehearsed": shift_handoff.is_rehearsed(h)}
             for h in shift_handoff.open_offers(DSN) if h["location"] in houses]
    deciders = {loc: _deciders_of(managers, loc) for loc in houses}
    named = ({n for loc in houses for n in people[loc]}
             | {n for s in swaps for n in s["approvers"]}
             | {n for s in swaps for n in s["directors"]}
             | {n for loc in houses for n in deciders[loc]} | ({driver} if driver else set()))
    return {
        "run": _clean_run(run) or _new_id(),
        "at": _iso(clock) if clock else "",
        "sandbox": {"schema": box.schema(), "role": box.role(), **sandbox},
        "houses": [{"location": loc, "house": sr.short_house(loc)} for loc in houses],
        "not_houses": elsewhere,
        "shifts": shifts, "people": people,
        # a swap offers the giver's OWN shift, never an open shift of the pool
        "giveable": _giveable(view, houses, now),
        # FAIL-CLOSED: an index nobody could read is said, never drawn as nobody having a number
        "textable": sorted(n for n in named if book.number(n)) if book.readable else [],
        "textable_readable": book.readable, "textable_why": book.why,
        "deciders": deciders, "deciders_readable": bool(managers.get("readable")),
        "deciders_why": str(managers.get("why") or "") if not managers.get("readable") else "",
        "swaps": swaps, "line": _line(),
        "made": made(),
        # what the sandbox's lanes owe right now; none of it is ever handed to a door
        "owed": owed_now(now),
    }


# ── the rehearsed clock ───────────────────────────────────────────────────── On the live estate almost every…
CLOCK_TAIL = timedelta(days=7)


def _clock_or_none(at: Any) -> datetime | None:
    raw = str(at or "").strip()
    if not raw:
        return None
    got = _instant(raw)
    if got is None:
        raise Refused(f"{raw} is not an instant the rehearsal can be played at — name it as an "
                      f"ISO date and time", "no_clock")
    return got


def _clock_window(s: dict[str, Any]) -> dict[str, str]:
    """The span a rehearsed clock may name for one pooled shift: its own life, and no longer."""
    opened = str(s["window"].get("opens_at") or "")
    end = str(s.get("shift_end") or "")
    if not end:
        start = _instant(opened)
        end = _iso(start + CLOCK_TAIL) if start else ""
    return {"from": opened, "to": end}


def _clock_for(at: Any, *, act: str, pooled: dict[str, Any] | None) -> datetime | None:
    """The clock this answer is played at, refused unless it falls inside that shift's own life."""
    clock = _clock_or_none(at)
    if clock is None:
        return None
    if act not in CLOCK_ACTS:
        raise Refused(f"a clock is named only for {', '.join(CLOCK_ACTS)} — those are the answers "
                      f"an application window decides. A transfer has no window, so it is played "
                      f"at the hour it is played", "no_clock_here")
    if pooled is None:
        raise Refused("no shift of the pool was named, so there is no window for a clock to sit "
                      "in — name the shift first", "no_such_shift")
    span = _clock_window(pooled)
    first, last = _instant(span["from"]), _instant(span["to"])
    # compared as instants, never as strings: two spellings of one moment are one moment
    if (first and clock < first) or (last and clock > last):
        raise Refused(
            f"{_iso(clock)} is outside the life of that shift — it was pooled at "
            f"{span['from'] or '—'} and is over by {span['to'] or '—'}. The rehearsal passes a "
            f"clock into the window arithmetic; it never invents a shift or moves one",
            "clock_outside")
    return clock


# ── what each lane now owes, read from the lane itself ──────────────────────

_LANES: tuple[tuple[str, Callable[[datetime], list[dict[str, Any]]]], ...] = (
    ("shift", lambda when: sr.owed(DSN, now=when, limit=500)),
    ("swap", lambda when: shift_handoff.owed(DSN, now=when, limit=500)),
    ("text", lambda when: sms_ears.owed(DSN, now=when, limit=500)),
    ("follow-up", lambda when: open_shift_covered.owed(DSN, now=when, limit=500)),
)


def owed_now(at: datetime) -> list[dict[str, Any]]:
    """Every message the sandbox's lanes owe, as they would hand it to the door at `at` (or at the end of the…"""
    when = psi_reminders.quiet_ends(at)
    out: list[dict[str, Any]] = []
    for lane, read in _LANES:
        try:
            rows = read(when)
        except Exception as exc:  # noqa: BLE001 — named in the list, never an empty lane
            out.append({"lane": lane, "key": f"{lane}:{UNREADABLE}", "kind": UNREADABLE,
                        "to": "", "about": f"this lane could not be read ({type(exc).__name__})",
                        "why": type(exc).__name__, "words": ""})
            continue
        out += [{**owed_entry(lane, o), "when": _iso(when)} for o in rows]
    return out


# ── the ledger ─────────────────────────────────────────────────────────────

def _begin(row: dict[str, Any]) -> None:
    """The answer is written down BEFORE it is played, so one that never finishes still shows."""
    with psycopg2.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO asa_shift_rehearsal (id, run, driver, door, act, person, location, "
            "open_row, col_iso, value, ref, outcome, lanes) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (row["id"], row["run"], row["driver"], row["door"], row["act"], row["person"],
             row["location"], row["open_row"], row["col_iso"], row["value"], row["ref"], PLAYING,
             json.dumps(row.get("lanes") or {}, default=str)))
        conn.commit()


def _finish(row: dict[str, Any]) -> None:
    with psycopg2.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE asa_shift_rehearsal SET person=%s, location=%s, open_row=%s, col_iso=%s, "
            "value=%s, ref=%s, outcome=%s, code=%s, why=%s, said=%s, lanes=%s, made=%s, owed=%s "
            "WHERE id=%s",
            (row.get("person") or "", row.get("location") or "", row.get("open_row") or "",
             row.get("col_iso") or "", row.get("value") or "", row.get("ref") or "",
             row.get("outcome") or "", row.get("code") or "", row.get("why") or "",
             row.get("said") or "", json.dumps(row.get("lanes") or {}, default=str),
             json.dumps(row.get("made") or {}, default=str),
             json.dumps(row.get("owed") or [], default=str), row["id"]))
        conn.commit()


def _refuse_row(row: dict[str, Any], *, code: str, why: str,
                lanes: dict[str, Any] | None = None) -> dict[str, Any]:
    return {**row, "outcome": REFUSED, "code": code, "why": why,
            "lanes": {**row.get("lanes", {}), **(lanes or {}), "nothing_was_made": True}}


# ── one rehearsed answer ────────────────────────────────────────────────────

def _house_or_refuse(location: str, view: dict[str, Any]) -> str:
    location = str(location or "").strip()
    if not location:
        raise Refused("name the house", "no_house")
    if location not in (view.get("locations") or []):
        raise Refused(f"{location} is not a house of the estate — the platform holds no calendar "
                      f"for it, so nobody works there and nothing is rehearsed on it", "no_house")
    return location


def _person_or_refuse(view: dict[str, Any], location: str, person: str) -> str:
    person = str(person or "").strip()
    if not person:
        raise Refused("name the person answering", "no_name")
    spelled = sr.grid_name(view, person, location) or sr.grid_name(view, person)
    if not spelled:
        raise Refused(f"{person} is on no house calendar — the rehearsal answers only for people "
                      f"the estate knows", "not_on_a_grid")
    return spelled


def _pool_row(location: str, open_row: str, col_iso: str, *, now: datetime,
              view: dict[str, Any]) -> dict[str, Any] | None:
    for s in sr.pool(DSN, now=now, view=view):
        if (s["location"], s["open_row"], s["col_iso"]) == (location, open_row, col_iso):
            return s
    return None


def answer(*, driver: str = "", door: str = "app", act: str = "", run: str = "",
           location: str = "", open_row: str = "", col_iso: str = "", ref: str = "",
           person: str = "", request_id: str = "", handoff_id: str = "", to_staff: str = "",
           word: str = "yes", at: str = "", decider: str = "",
           driver_reader: dict[str, Any] | None = None, **_: Any) -> dict[str, Any]:
    """One simulated answer through the door a real one comes through; the row says what every lane did."""
    now = _now()
    if door not in DOORS:
        raise Refused("the door is the app or a text", "no_door")
    if act not in ACTS:
        raise Refused(f"{act} is not something the rehearsal answers", "no_act")
    reader = driver_reader if isinstance(driver_reader, dict) else None
    with _ActLock(wait=ACT_WAIT_S):
        _prepare(driver)
        view = sr.estate(DSN, fresh=True)
        row: dict[str, Any] = {"id": _new_id(), "run": _clean_run(run), "driver": str(driver or ""),
                               "door": door, "act": act, "person": "", "location": "",
                               "open_row": "", "col_iso": "", "value": "", "ref": "",
                               "outcome": "", "code": "", "why": "", "said": "", "lanes": {},
                               "made": {}, "owed": []}
        if ref and not (location and col_iso):
            found = sr.by_ref(DSN, ref)
            if not found:
                raise Refused(f"no open shift carries the ref {ref}", "no_such_shift")
            location, open_row, col_iso = found
        clock: datetime | None = None
        pooled: dict[str, Any] | None = None
        if act in CLOCK_ACTS:
            location = _house_or_refuse(location, view)
            person = _person_or_refuse(view, location, person)
            open_row = str(open_row or "OPEN").strip()
            row.update(location=location, open_row=open_row, col_iso=str(col_iso or "").strip(),
                       person=person)
            # the shift is found at the real hour; the clock is then weighed against ITS OWN life
            pooled = _pool_row(location, open_row, row["col_iso"], now=now, view=view)
            clock = _clock_for(at, act=act, pooled=pooled)
            if clock is not None:
                pooled = _pool_row(location, open_row, row["col_iso"], now=clock, view=view)
            row["value"] = str((pooled or {}).get("value") or "")
            # the pool's own ref only: a ref the request carried is never quoted onward
            row["ref"] = str((pooled or {}).get("ref") or "")
        elif at:
            _clock_for(at, act=act, pooled=None)
        played = clock or now
        row["lanes"] = {"sandbox": box.schema(), **({"clock": _iso(clock)} if clock else {})}
        _begin(row)
        before = owed_now(played)
        try:
            if act == "apply":
                out = _apply(row, door=door, now=played, pooled=pooled)
            elif act == "withdraw":
                out = _withdraw(row, door=door, request_id=request_id)
            elif act in ("decide", "take"):
                out = _decide(row, door=door, act=act, now=played, decider=decider,
                              driver_reader=reader)
            elif act == "offer_swap":
                out = _offer(row, view=view, location=location, col_iso=col_iso, person=person,
                             to_staff=to_staff, now=now)
            else:
                out = _swap_answer(row, door=door, act=act, handoff_id=handoff_id, word=word,
                                   view=view, now=now, approver=person, driver_reader=reader)
        except (Refused, sr.Refused, shift_handoff.Refused) as exc:
            out = _refuse_row(row, code=exc.code, why=exc.why)
        except box.SandboxBreach:
            raise
        except Exception as exc:  # noqa: BLE001 — named on the row, never swallowed
            log.warning("shift rehearsal: %s failed inside the sandbox (%s)", act,
                        type(exc).__name__)
            out = _refuse_row(row, code="failed",
                              why=f"the lane failed inside the sandbox ({type(exc).__name__}: "
                                  f"{str(exc)[:200]})")
        # new messages only; a lane unread before or after is said apart, never as a message
        out["owed"] = owed_diff(before, owed_now(played))
        out["lanes"] = {**row["lanes"], **(out.get("lanes") or {})}
        _finish(out)
    return {**out, "at": _iso(now)}


# the application

def _apply(row: dict[str, Any], *, door: str, now: datetime,
           pooled: dict[str, Any] | None) -> dict[str, Any]:
    if door == "app":
        return _apply_in_app(row, now=now)
    return _apply_by_text(row, now=now, pooled=pooled)


def _apply_in_app(row: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    try:
        got = sr.apply_for(DSN, location=row["location"], open_row=row["open_row"],
                           col_iso=row["col_iso"], person=row["person"], via=VIA_APP, now=now,
                           evidence={MARK: {"id": row["id"], "run": row["run"],
                                            "driver": row["driver"]}})
    except sr.Refused as exc:
        return _refuse_row(row, code=exc.code,
                           why=f"the application door refused it: {exc.why}",
                           lanes={"door": "shift_requests.apply_for", "refused": exc.code})
    rid = str(got.get("id") or "")
    training = str(got.get("training_request") or "")
    if not got.get("applied"):
        # THE ROW WAS ALREADY THERE, and it may be one the sandbox copied from the estate.
        mine = sr.request_row(DSN, rid) if rid else None
        if mine is not None and not sr.is_rehearsed(mine):
            return _refuse_row(row, code="real_application",
                               why=f"{row['person']} applied for this shift for real — a rehearsal "
                                   f"never counts a real application as one of its own",
                               lanes={"door": "shift_requests.apply_for", "request": rid})
    return {**row, "outcome": DONE if got.get("applied") else HELD,
            "code": "applied" if got.get("applied") else "already_applied",
            "why": (f"{row['person']} applied for the {row['value'] or 'open'} shift — the house "
                    f"manager decides" if got.get("applied")
                    else f"{row['person']} had already applied for it, so nothing new was made"),
            "lanes": {"door": "shift_requests.apply_for", "request": rid,
                      "state": str(got.get("state") or ""),
                      "needs_training_approval": bool(got.get("needs_training_approval")),
                      "window": (got.get("window") or {}).get("state", "")},
            "made": {"requests": [r for r in (rid if got.get("applied") else "", training) if r]}}


def _apply_by_text(row: dict[str, Any], *, now: datetime,
                   pooled: dict[str, Any] | None) -> dict[str, Any]:
    # THE TEXT QUOTES ONLY THE POOL'S OWN REF.
    if pooled is None:
        return _refuse_row(row, code="no_such_shift",
                           why="no shift of the pool sits on that cell, so there is no ref a "
                               "text could quote — a rehearsed text only ever quotes the pool's "
                               "own ref, never one handed in")
    ref = str(pooled.get("ref") or "")
    if not ref:
        return _refuse_row(row, code="no_ref",
                           why="a rehearsed text always quotes the shift's ref, and this shift "
                               "carries none")
    phone, refused = _number_or_refusal(row, row["person"])
    if refused is not None:
        return refused
    if not _line():
        return _refuse_row(row, code="no_line",
                           why="no reply line is configured, so there is no number to text")
    return _by_text(row, phone=phone, body=f"YES {ref}", now=now,
                    about=f"applying for the {row['value'] or 'open'} shift")


# the texts: a line in the sandbox's own inbox, heard by the real ear

def _inbox_dir() -> Path:
    return box.root() / "inbox"


def _text_line(mid: str, *, phone: str, body: str, at: datetime) -> str:
    """One inbox line, shaped as the ear's own reader (sms_ears.heard_text) reads a text."""
    stamp = at.astimezone(UTC).isoformat().replace("+00:00", "Z")
    digits = re.sub(r"\D", "", str(phone))[-10:]
    obj = {"id": mid, "object": "message", "direction": "incoming",
           "from": f"+1{digits}", "to": f"+1{_line()}", "text": body, "createdAt": stamp}
    return json.dumps({"id": mid, "type": "message.received", "received_at": stamp,
                       "source": MARK,
                       "event": {"id": f"{MARK}:{mid}", "type": "message.received",
                                 "data": {"object": obj}}})


DROPPED, ABSENT, UNREADABLE = "dropped", "absent", "unreadable"


def _drop_text(mid: str) -> str:
    """Take one line back out of the sandbox inbox: dropped, absent, or unreadable (it may still be there)."""
    path = _inbox_dir() / INBOX_FILE
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return ABSENT
    except OSError:
        return UNREADABLE
    kept = [ln for ln in lines if f'"{mid}"' not in ln]
    if len(kept) == len(lines):
        return ABSENT
    try:
        path.write_text("".join(f"{ln}\n" for ln in kept), encoding="utf-8")
    except OSError:
        return UNREADABLE
    return DROPPED


def _dropped_words(state: str) -> str:
    return {DROPPED: "taken back out of the sandbox's inbox",
            ABSENT: "already not in the sandbox's inbox"}.get(
                state, "left in the sandbox's inbox — it could not be rewritten; Reset clears it")


def _reply_row(mid: str) -> dict[str, Any] | None:
    with psycopg2.connect(DSN) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM asa_sms_replies WHERE id=%s", (mid,))
        got = cur.fetchone()
    return dict(got) if got else None


def _by_text(row: dict[str, Any], *, phone: str, body: str, now: datetime,
             about: str) -> dict[str, Any]:
    """Append the line under the sandbox ear's own pass lock, let the ear hear it, and say what it did."""
    mid = row["id"]
    inbox = _inbox_dir()
    with sms_ears.EarLock(DSN) as lock:
        if not lock.held:
            return _refuse_row(row, code="ear_busy",
                               why="the sandbox's reply ear is mid-pass, so this line was never "
                                   "written — play it again in a moment",
                               lanes={"door": "sms_ears.listen", "ear": {"state": "busy"}})
        inbox.mkdir(parents=True, exist_ok=True)
        with (inbox / INBOX_FILE).open("a", encoding="utf-8") as fh:
            fh.write(_text_line(mid, phone=phone, body=body, at=now) + "\n")
        try:
            # the ear keeps a lookback from its `now`: the earlier of the two keeps a past rehearsed clock inside…
            said = sms_ears.listen(DSN, inbox=inbox, now=min(now, _now()), lock=lock)
        except box.SandboxBreach:
            raise
        except Exception as exc:  # noqa: BLE001 — the line is taken back out either way
            gone = _drop_text(mid)
            return _refuse_row(row, code="ear_failed",
                               why=f"the reply ear could not run ({type(exc).__name__}), and the "
                                   f"line was {_dropped_words(gone)}")
        heard = _reply_row(mid)
        if heard is None:
            gone = _drop_text(mid)
            return _refuse_row(row, code=str(said.get("state") or "not_heard"),
                               why=f"the reply ear did not write it down "
                                   f"({said.get('why') or 'it waits'}) — the line was "
                                   f"{_dropped_words(gone)}",
                               lanes={"door": "sms_ears.listen", "ear": said})
    outcome = str(heard.get("outcome") or "")
    rid = str(heard.get("request_id") or "")
    done = outcome in (sms_ears.APPLIED, sms_ears.ANSWERED)
    return {**row, "outcome": DONE if done else (HELD if outcome == sms_ears.ALREADY else REFUSED),
            "code": f"{outcome}:{heard.get('code') or ''}".strip(":"),
            "why": str(heard.get("why") or ""),
            "said": body,
            "lanes": {"door": "sms_ears.listen (a line in the sandbox's own inbox)",
                      "text_id": mid, "about": about, "line": str(heard.get("line") or ""),
                      "ear": {k: said.get(k) for k in ("heard", "acted", "waiting", "state")},
                      "request": rid, "sender": str(heard.get("sender") or ""),
                      "ack": str(heard.get("ack") or ""),
                      "ack_words": str(heard.get("ack_why") or "")},
            "made": {"texts": [mid], "requests": [rid] if rid and outcome == sms_ears.APPLIED
                     else []}}


# taking a name back

def _withdraw(row: dict[str, Any], *, door: str, request_id: str) -> dict[str, Any]:
    if door != "app":
        return _refuse_row(row, code="no_such_door",
                           why="there is no withdrawal by text — the ear has no door for it, and a "
                               "rehearsal never invents one")
    rid = str(request_id or "").strip()
    held = sr.request_row(DSN, rid) if rid else None
    if not held:
        return _refuse_row(row, code="no_such_application", why="that application is not on file")
    row.update(location=str(held.get("location") or ""), open_row=str(held.get("open_row") or ""),
               col_iso=str(held.get("col_iso") or ""), value=str(held.get("value") or ""),
               person=str(held.get("person") or ""))
    if not sr.is_rehearsed(held):
        return _refuse_row(row, code="not_a_rehearsal",
                           why=f"{held.get('person')} applied for real ({held.get('via')}) — a "
                               f"rehearsal never takes a real name off a shift")
    try:
        got = sr.withdraw(DSN, request_id_=rid, person=str(held.get("person") or ""),
                          why=f"withdrawn in the {MARK}")
    except sr.Refused as exc:
        return _refuse_row(row, code=exc.code, why=f"the withdrawal door refused it: {exc.why}")
    return {**row, "outcome": DONE, "code": "withdrawn",
            "why": f"{row['person']} took their name back off the shift",
            "lanes": {"door": "shift_requests.withdraw", "request": rid,
                      "state": str(got.get("state") or "")},
            "made": {"requests": [rid]}}


# the house manager's decision

def _decide(row: dict[str, Any], *, door: str, act: str, now: datetime, decider: str = "",
            driver_reader: dict[str, Any] | None = None) -> dict[str, Any]:
    if door != "app":
        return _refuse_row(row, code="no_such_door",
                           why="a decision is made on the platform — the ear has no door for one")
    # WHO DECIDES is weighed as the real doors weigh a session: the decision door lets the house's manager and the…
    name = str(decider or "").strip() or row["driver"]
    reader = _reader_for(name, driver=row["driver"], driver_reader=driver_reader)
    house = sr.short_house(row["location"]) or row["location"]
    may = (sr.may_edit_calendar(reader, row["location"]) if act == "take"
           else sr.may_decide(reader, row["location"]))
    row["lanes"] = {**row.get("lanes", {}), "decided_as": name}
    if not may and (act == "decide" or sr.fold(name) != sr.fold(row["person"])):
        return _refuse_row(
            row, code="not_a_decider",
            why=(f"{name} does not decide {house}'s shifts — only the house's manager on the "
                 f"hotline calendar and the badges above the house do, and the real door answers "
                 f"403 to anybody else" if act == "decide" else
                 f"{name} does not edit {house}'s calendar — the real door lets them take a shift "
                 f"for themselves only, never assign one to {row['person']}"))
    # EVERY live row on the cell, the training approvals beside the applications included: the decision sweeps them…
    live = sr.live_at(DSN, location=row["location"], open_row=row["open_row"],
                      col_iso=row["col_iso"])
    real = [a for a in live if not a[sr.REHEARSAL]]
    if real:
        kinds = ", ".join(sorted({f"{a['person']}'s {a['kind']}" for a in real}))
        return _refuse_row(row, code="real_applicants",
                           why=f"{kinds} is real and this decision would close it — a rehearsal "
                               f"never decides a real row", lanes={"real": [a["id"] for a in real]})
    evidence = {"id": row["id"], "run": row["run"], "driver": row["driver"]}
    try:
        if act == "take":
            got = sr.take_open_shift(DSN, location=row["location"], open_row=row["open_row"],
                                     col_iso=row["col_iso"], person=row["person"],
                                     by=name, may_decide=may, via=VIA_APP, now=now,
                                     rehearsal=evidence)
        else:
            got = sr.decide(DSN, location=row["location"], open_row=row["open_row"],
                            col_iso=row["col_iso"], person=row["person"], by=name,
                            how="approved", now=now, rehearsal=evidence)
    except sr.Refused as exc:
        return _refuse_row(row, code=exc.code, why=f"the decision door refused it: {exc.why}",
                           lanes={"door": f"shift_requests.{act}", "refused": exc.code})
    published = (got.get("claim") or got or {}).get("published") or {}
    passed = int(got.get("passed_over") or 0)
    return {**row, "outcome": DONE, "code": "decided",
            "why": (f"{row['person']} was given the {row['value'] or 'open'} shift by {name}"
                    + (f", and {passed} other application(s) became 'not chosen'" if passed else "")),
            "lanes": {"door": f"shift_requests.{act}", "decided_as": name,
                      "claim": f"{row['location']} | {row['open_row']} | {row['col_iso']}",
                      "passed_over": passed, "published": published},
            "made": {"claim": [row["location"], row["open_row"], row["col_iso"]]}}


# the swap

def _offer(row: dict[str, Any], *, view: dict[str, Any], location: str, col_iso: str,
           person: str, to_staff: str, now: datetime) -> dict[str, Any]:
    location = _house_or_refuse(location, view)
    giver = _person_or_refuse(view, location, person)
    # The receiver goes to the door as the real route hands it over, with the same reachable set: the door itself…
    taker = str(to_staff or "").strip()
    if not taker:
        raise Refused("name who is offered the shift", "no_name")
    row.update(location=location, col_iso=str(col_iso or "").strip(), person=giver)
    reachable = reachable_names()
    try:
        got = shift_handoff.offer(DSN, location=location, col_iso=row["col_iso"],
                                  from_staff=giver, to_staff=taker, offered_by=giver,
                                  created_by=f"{row['driver']} ({MARK})", now=now,
                                  reachable=reachable,
                                  evidence={MARK: {"id": row["id"], "run": row["run"],
                                                   "driver": row["driver"]}})
    except (shift_handoff.Refused, sr.Refused) as exc:
        return _refuse_row(row, code=exc.code, why=f"the transfer door refused it: {exc.why}",
                           lanes={"door": "shift_handoff.offer",
                                  "reachable_known": reachable is not None})
    except LookupError as exc:
        return _refuse_row(row, code="no_such_shift", why=str(exc))
    hid = str(got.get("id") or "")
    taker = str(got.get("to_staff") or taker)
    row.update(value=str(got.get("value") or ""), ref=hid)
    directors = shift_handoff.director_names(got)
    return {**row, "outcome": DONE, "code": "offered",
            "why": (f"{giver} offered the {row['value'] or ''} shift to {taker} — the swap {hid} "
                    f"waits on them, on the house manager's approval and on the director's"
                    + (f" ({' or '.join(directors)})" if directors else "")),
            "lanes": {"door": "shift_handoff.offer", "handoff": hid,
                      "reachable_known": reachable is not None,
                      "staff_state": str(got.get("staff_state") or ""),
                      "manager_state": str(got.get("manager_state") or ""),
                      "director_state": str(got.get("director_state") or ""),
                      "directors": directors,
                      "training_request": str(got.get("training_request") or "")},
            "made": {"handoffs": [hid]}}


SIDES = {"swap_accept": "staff", "swap_approve": "manager", "swap_director": "director"}


def _seat_names(got: dict[str, Any], side: str) -> list[str]:
    """The names a seat is given by, as the transfer spells them."""
    return shift_handoff.director_names(got) if side == "director" else _approvers_of(got)


def _named_for(got: dict[str, Any], side: str, name: str) -> bool:
    if side == "director":
        return shift_handoff.listed_director(name, got)
    return any(sr.fold(n) == sr.fold(name) for n in _approvers_of(got))


def _approval_refusal(row: dict[str, Any], got: dict[str, Any], name: str, *, side: str,
                      driver_reader: dict[str, Any] | None) -> dict[str, Any] | None:
    """The app door's own test for an approval, played for `name`: the side the real route picks for that reader…"""
    own = _seat_names(got, side)
    if _named_for(got, side, name):
        # named on the transfer itself: the door lets them by that name alone, nothing to read
        reader: dict[str, Any] = {"name": name}
    else:
        reader = _reader_for(name, driver=row["driver"], driver_reader=driver_reader)
    seat = shift_handoff.side_for(reader, got)
    if seat == side:
        return None
    hid = str(got.get("id") or "")
    if sr.fold(name) in shift_handoff._pair(got):  # noqa: SLF001 — the lane's reading of the swap
        return _refuse_row(row, code="own_swap",
                           why=f"{name} is part of the swap {hid} — nobody approves their own "
                               f"swap, and the real door answers 403")
    other = {"manager": "the house manager's approval", "director": "the director's approval",
             "staff": "the receiver's answer"}.get(seat, "")
    if other:
        return _refuse_row(
            row, code="another_seat",
            why=f"the real door gives {name} {other} on the swap {hid}, not "
                f"{'the director' if side == 'director' else 'the house manager'}'s — play that "
                f"act instead; nothing was answered",
            lanes={"door": "shift_handoff.side_for", "seat": seat})
    if side == "director":
        listed = " or ".join(own) if own else "nobody (the transfer names no director)"
        return _refuse_row(row, code="not_the_director",
                           why=f"{name} is not on the directors list the swap {hid} was asked of — "
                               f"{listed}. The real door answers 403 to anybody else, so nothing "
                               f"was approved",
                           lanes={"door": "shift_handoff.side_for", "directors": own})
    by = (" or ".join(own) if own
          else "a director, team lead or administrator (the transfer names no house manager)")
    said = str(got.get("approval_why") or "") or f"{by} approves it"
    return _refuse_row(row, code="not_the_approver",
                       why=f"{name} is not the approver of the swap {hid} — {said}. The real "
                           f"door answers 403 to anybody else, so nothing was approved",
                       lanes={"door": "shift_handoff.side_for", "approvers": own})


def _swap_answer(row: dict[str, Any], *, door: str, act: str, handoff_id: str, word: str,
                 view: dict[str, Any], now: datetime, approver: str = "",
                 driver_reader: dict[str, Any] | None = None) -> dict[str, Any]:
    hid = str(handoff_id or "").strip().upper()
    got = shift_handoff.handoff(DSN, hid) if hid else None
    if not got:
        return _refuse_row(row, code="no_such_swap", why=f"no swap carries the ref {hid or '—'}")
    side = SIDES.get(act, "")
    if not side:
        raise Refused(f"{act} is not an answer to a swap", "no_act")
    word = "yes" if str(word or "yes").lower() not in ("no", "n") else "no"
    # the receiver answers as themselves; an approval — the house manager's or the director's — is given by the name…
    row.update(location=str(got.get("location") or ""), col_iso=str(got.get("col_iso") or ""),
               value=str(got.get("value") or ""), ref=hid,
               person=str(got.get("to_staff") if side == "staff" else approver or ""))
    # a swap the sandbox copied from the estate was offered by a real person; the rehearsal never answers it, and…
    if not shift_handoff.is_rehearsed(got):
        return _refuse_row(
            row, code="not_a_rehearsal",
            why=f"the swap {hid} is a real one — {got.get('from_staff')} really offered the "
                f"{got.get('value') or ''} shift of {got.get('col_iso')} to {got.get('to_staff')}. "
                f"A rehearsal only answers a swap it offered",
            lanes={"door": "shift_handoff.answer", "handoff": hid})
    if str(got.get("state") or "") != shift_handoff.PENDING:
        return _refuse_row(row, code="swap_closed", why=f"the swap {hid} is no longer waiting")
    if side == "staff":
        person = _person_or_refuse(view, row["location"], str(got.get("to_staff") or ""))
    else:
        # an approver is often on no grid at all: a house manager, a director.
        person = str(row["person"] or "").strip()
        if not person:
            return _refuse_row(row, code="no_name",
                               why=f"name who approves the swap {hid} — "
                                   + ("a director on its list" if side == "director"
                                      else "its own approver, or the one playing the rehearsal"))
        person = next((n for n in _seat_names(got, side) if sr.fold(n) == sr.fold(person)),
                      person)
    row["person"] = person
    if side != "staff" and door == "app":
        refused = _approval_refusal(row, got, person, side=side, driver_reader=driver_reader)
        if refused is not None:
            return refused
    if door == "text":
        # the text door is the ear's own: it names the sender from the number and asks the transfer which seat it…
        phone, refused = _number_or_refusal(row, person)
        if refused is not None:
            return refused
        body = (f"{'YES' if word == 'yes' else 'NO'} {hid}" if side == "staff"
                else f"{'APPROVE' if word == 'yes' else 'NOT APPROVED'} {hid}")
        out = _by_text(row, phone=phone, body=body, now=now,
                       about=f"answering the swap {hid} as the "
                             + {"staff": "receiver", "manager": "house manager",
                                "director": "director"}[side])
        after = shift_handoff.handoff(DSN, hid) or {}
        out["lanes"] = {**out.get("lanes", {}), "handoff": hid,
                        "staff_state": str(after.get("staff_state") or ""),
                        "manager_state": str(after.get("manager_state") or ""),
                        "director_state": str(after.get("director_state") or ""),
                        "state": str(after.get("state") or "")}
        return out
    try:
        answered = shift_handoff.answer(DSN, hid, side=side, word=word, via=VIA_APP, by=person,
                                        now=now,
                                        rehearsal={"id": row["id"], "run": row["run"],
                                                   "driver": row["driver"]})
    except (shift_handoff.Refused, sr.Refused) as exc:
        return _refuse_row(row, code=exc.code, why=f"the swap door refused it: {exc.why}")
    except (LookupError, ValueError) as exc:
        return _refuse_row(row, code="no_such_swap", why=str(exc))
    moved = str(answered.get("state") or "") == shift_handoff.DONE
    return {**row, "outcome": DONE if answered.get("changed") else HELD,
            "code": f"{side}_{word}",
            "why": (sms_ears.handoff_words(answered, side, word, second=False)
                    + (" — all three consents are in, so the shift moved on the sandbox's own "
                       "calendar" if moved else "")),
            "lanes": {"door": "shift_handoff.answer", "handoff": hid, "side": side,
                      "staff_state": str(answered.get("staff_state") or ""),
                      "manager_state": str(answered.get("manager_state") or ""),
                      "director_state": str(answered.get("director_state") or ""),
                      "state": str(answered.get("state") or "")},
            "made": {"handoff_answers": [[hid, side]]}}


# ── the reset ──────────────────────────────────────────────────────────────

def reset(*, by: str = "", **_: Any) -> dict[str, Any]:
    """Everything played goes, and a fresh copy of the estate comes in; the ledger keeps the history."""
    with _ActLock(wait=ACT_WAIT_S):
        _prepare(by)
        files = box.clear_files()
        filled = box.fill(DSN, by=by or "the rehearsal", empty_first=True)
        with psycopg2.connect(DSN) as conn, conn.cursor() as cur:
            cur.execute("UPDATE asa_shift_rehearsal SET cleared_at=now(), cleared_by=%s "
                        "WHERE cleared_at IS NULL", (str(by or ""),))
            cleared = max(0, cur.rowcount)
            conn.commit()
    return {"cleared": cleared, "files": len(files), "sandbox": {"schema": box.schema(), **filled},
            "why": (f"{cleared} rehearsed answer(s) cleared, and the sandbox now holds a fresh "
                    f"copy of the estate from {filled['since']} on")}
