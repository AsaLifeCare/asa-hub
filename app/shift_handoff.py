"""Shift transfers: the receiver accepts, a house manager and a listed director outside the swap approve; `answer()` is a conditional UPDATE."""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable

import house_cal_live
import house_directory
import lanes_db as hub_db
import lanes_pg as psycopg2
import psi_reminders
import shift_requests as sr

HANDOFFS_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_shift_handoffs ("
    "id TEXT PRIMARY KEY, location TEXT NOT NULL, col_iso TEXT NOT NULL, "
    "value TEXT NOT NULL DEFAULT '', "
    "from_staff TEXT NOT NULL, to_staff TEXT NOT NULL, house_manager TEXT NOT NULL DEFAULT '', "
    "staff_state TEXT NOT NULL DEFAULT 'pending', staff_via TEXT DEFAULT '', "
    "staff_at TIMESTAMPTZ, "
    "manager_state TEXT NOT NULL DEFAULT 'pending', manager_via TEXT DEFAULT '', "
    "manager_at TIMESTAMPTZ, manager_by TEXT DEFAULT '', "
    "state TEXT NOT NULL DEFAULT 'pending', why TEXT DEFAULT '', "
    "created_by TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "closed_at TIMESTAMPTZ, said JSONB NOT NULL DEFAULT '{}'::jsonb)"
)

# One open offer per cell, or a second completion would move an already-moved shift.
OPEN_INDEX_DDL = (
    "CREATE UNIQUE INDEX IF NOT EXISTS asa_shift_handoffs_open_giver "
    "ON asa_shift_handoffs (location, col_iso, regexp_replace(lower(from_staff), '[^a-z0-9]+', '', 'g')) "
    "WHERE state = 'pending'"
)
# The house-day index it replaces, dropped only once the giver's index stands, and only in the schema that holds…
RETIRED_OPEN_INDEX = "asa_shift_handoffs_open"
TABLE_SCHEMA_SQL = ("SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE c.oid = to_regclass('asa_shift_handoffs')")


def _retire_open_index(cur) -> None:
    """Drop the house-day index beside the table this connection resolves, never elsewhere."""
    from psycopg import sql as pgsql  # noqa: PLC0415 — only a real database reaches here
    cur.execute(TABLE_SCHEMA_SQL)
    got = cur.fetchone()
    if not got:
        return
    cur.execute(pgsql.SQL("DROP INDEX IF EXISTS {}").format(
        pgsql.Identifier(str(got[0]), RETIRED_OPEN_INDEX)))

COLUMNS_DDL = (
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS approvers JSONB NOT NULL "
    "DEFAULT '[]'::jsonb",
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS approval TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS approval_why TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS manager_phone TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS staff_by TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS offered_by TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS shift_start TIMESTAMPTZ",
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS training_request TEXT NOT NULL "
    "DEFAULT ''",
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS training JSONB NOT NULL "
    "DEFAULT '{}'::jsonb",
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS closed_by TEXT NOT NULL DEFAULT ''",
    # the evidence the door that made the row was handed; where THE MARK lives on a transfer
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL "
    "DEFAULT '{}'::jsonb",
    # The third consent: the director, named from the Time Off house's settings, never from code.
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS director_state TEXT NOT NULL "
    "DEFAULT 'pending'",
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS director_via TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS director_at TIMESTAMPTZ",
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS director_by TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE asa_shift_handoffs ADD COLUMN IF NOT EXISTS directors JSONB NOT NULL "
    "DEFAULT '[]'::jsonb",
)

# ── THE MARK ──────────────────────────────────────────────────────────────── Same shape as shift_requests: it…
REHEARSAL_KEY = sr.REHEARSAL
REHEARSAL_VIA = sr.REHEARSAL_VIA


def is_rehearsed(row: dict[str, Any] | None) -> bool:
    """True when a transfer was offered or answered by the staff-answers rehearsal."""
    row = row or {}
    extra = row.get("extra")
    if isinstance(extra, dict) and REHEARSAL_KEY in extra:
        return True
    return any(str(row.get(col) or "").startswith(REHEARSAL_VIA)
               for col in ("staff_via", "manager_via", "director_via"))


def _evidence(row: dict[str, Any] | None) -> dict[str, Any] | None:
    """The rehearsal's evidence a transfer carries, handed on to every row its lanes make; None for a real…"""
    if not is_rehearsed(row):
        return None
    got = _json((row or {}).get("extra")).get(REHEARSAL_KEY)
    return got if isinstance(got, dict) else {"transfer": str((row or {}).get("id") or "")}

PENDING, DONE, DEAD = "pending", "done", "dead"
ACCEPTED, DECLINED = "accepted", "declined"
APPROVED, NOT_APPROVED = "approved", "declined"

BY_HOUSE_MANAGER = "house_manager"
BY_ABOVE = "above"
# generated from the badges that decide every house (shift_requests.decider_titles), never typed
_ABOVE = sr.deciders_one()

# Must be tried before _APPROVE: "not approved" contains "approve".
_NOT_APPROVE = re.compile(r"\b(?:not|dont|do not|no)\s+approv\w*\b|\bdisapprov\w*\b|\bdeclin\w*\b|\breject\w*\b")
_APPROVE = re.compile(r"\bapprov\w*\b|\bauthoriz\w*\b|\bok to (?:swap|switch|cover)\b")
# Over folded text (apostrophes dropped); the refusal is matched first.
_CANT_TAKE = re.compile(
    r"\b(?:cant|cannot|can not|couldnt|could not|wont|will not|unable to|not able to|"
    r"not available to)\s+(?:take|cover|work|do|pick|grab)\b|\bnot available\b")
_TAKE_IT = re.compile(
    r"\b(?:i can|i could|i will|ill|i would|id|i am able to|im able to|i am available to|"
    r"im available to|can|will)\s+(?:definitely\s+|gladly\s+|happily\s+|also\s+)?"
    r"(?:take|cover|work|do|pick up|grab)\b"
    r"|\bcount me in\b|\b(?:ill|i will) be there\b|\b(?:im|i am) available\b")
_YES_FIRST = frozenset({"sure", "absolutely", "definitely", "yea", "ya", "yah", "yess", "yesss"})

REF_RE = re.compile(r"\bHO[0-9A-F]{10}\b")

PLACEHOLDER_WORDS = frozenset(
    sr.fold(w) for w in os.getenv(
        "HUB_HANDOFF_PLACEHOLDERS",
        "family,nurse,staff,tbd,tba,agency,vacant,none,nobody,cover,float,relief,training,"
        "orientation,closed,hospital").split(",") if sr.fold(w))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _connect(dsn: str):
    return hub_db.connect(dsn)


def _iso(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value or "")


class Refused(ValueError):

    def __init__(self, why: str, code: str = "refused", **extra: Any) -> None:
        super().__init__(why)
        self.why, self.code, self.extra = why, code, extra


class AlreadyOffered(Refused):
    """That shift already has an offer waiting on somebody."""

    def __init__(self, location: str, col_iso: str, giver: str = "") -> None:
        whose = f"{giver}'s shift at " if giver else ""
        super().__init__(f"{whose}{location} {col_iso} already has a handoff waiting — it has to be "
                         f"answered or withdrawn first", "already_offered")


_TABLES_READY: set[str] = set()
_TABLES_LOCK = threading.Lock()


def ensure_tables(dsn: str) -> None:
    if dsn in _TABLES_READY:
        return
    with _TABLES_LOCK:
        if dsn in _TABLES_READY:
            return
        conn = _connect(dsn)
        try:
            conn.autocommit = True
            with conn.cursor() as cur:
                for ddl in (HANDOFFS_DDL, *COLUMNS_DDL):
                    try:
                        cur.execute(ddl)
                    except psycopg2.Error:
                        pass
                # The giver's index first; the house-day one goes only once it stands, so a pending offer is never…
                try:
                    cur.execute(OPEN_INDEX_DDL)
                    _retire_open_index(cur)
                except psycopg2.Error:
                    pass
        finally:
            conn.close()
        _TABLES_READY.add(dsn)


def read_word(text: Any) -> str:
    """'yes', 'no' or 'other'; the estate's reader decides first, then APPROVE / NOT APPROVE."""
    raw = str(text or "")
    if _NOT_APPROVE.search(raw.lower()):
        return "no"
    if _APPROVE.search(raw.lower()):
        return "yes"
    folded = psi_reminders._fold_reply(raw)
    if _CANT_TAKE.search(folded):
        return "no"
    word = psi_reminders.reply_word(raw)
    if word in ("yes", "no"):
        return word
    words = folded.split()
    if "?" not in raw and ((words and words[0] in _YES_FIRST) or _TAKE_IT.search(folded)):
        return "yes"
    return "other"


def is_manager_word(text: Any) -> bool:
    raw = str(text or "").lower()
    return bool(_NOT_APPROVE.search(raw) or _APPROVE.search(raw))


def _is_open_row(name: Any) -> bool:
    return house_cal_live.is_open_row(name)


def placeholder(name: Any, location: Any = "", reachable: set[str] | None = None) -> bool:
    text = " ".join(str(name or "").split())
    if not text or house_cal_live.not_a_person(text, location):
        return True
    key = sr.fold(text)
    if key in PLACEHOLDER_WORDS:
        return True
    if " " not in text:
        return not (reachable is not None and key in reachable)
    return False


def handoff_id(location: str, col_iso: str, to_staff: str, created_iso: str) -> str:
    """Quoted in SMS and e-mail so a reply matches the right offer; not guessable backwards."""
    raw = f"{location}|{col_iso}|{to_staff}|{created_iso}".encode()
    return "HO" + hashlib.sha256(raw).hexdigest()[:10].upper()


def _row(cur, hid: str) -> dict[str, Any] | None:
    cur.execute("SELECT * FROM asa_shift_handoffs WHERE id=%s", (hid,))
    row = cur.fetchone()
    return dict(row) if row else None


def handoff(dsn: str, hid: str) -> dict[str, Any] | None:
    hid = str(hid or "").strip().upper()
    if not hid:
        return None
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(HANDOFFS_DDL)
        return _row(cur, hid)


def _names(raw: Any) -> list[str]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = []
    return [str(n) for n in (raw or []) if str(n or "").strip()]


def _json(raw: Any) -> dict[str, Any]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = {}
    return raw if isinstance(raw, dict) else {}



def approval_for(*, location: str, giver: str, receiver: str,
                 managers: dict[str, Any] | None, offered_by: str = "") -> dict[str, Any]:
    """Who approves this transfer; never anybody in the swap or who started it."""
    house = sr.short_house(location) or location
    if not managers or not managers.get("readable"):
        said = (managers or {}).get("why") or "no reason given"
        return {"readable": False, "mode": "", "names": [], "house_manager": "", "phone": "",
                "why": f"who manages {house} could not be read ({said})"}
    code = house_directory.code_of(location) or str(location or "").strip().upper()
    hm = (managers.get("by_code") or {}).get(code) or {}
    names = [n for n in (hm.get("names") or [hm.get("name")]) if n and sr.fold(n)]
    pair = {sr.fold(giver), sr.fold(receiver)}
    starter = sr.fold(offered_by)
    eligible = [n for n in names if sr.fold(n) not in pair and sr.fold(n) != starter]
    if eligible:
        first = eligible[0]
        return {"readable": True, "mode": BY_HOUSE_MANAGER, "names": eligible,
                "house_manager": first,
                "phone": str(hm.get("phone") or "") if sr.fold(hm.get("name")) == sr.fold(first)
                else "",
                "why": (f"the house manager {' or '.join(eligible)} approves"
                        if len(eligible) > 1 else f"the house manager {first} approves")}
    if names and not [n for n in names if sr.fold(n) in pair]:
        who = " and ".join(names)
        why = (f"{who} {'manage' if len(names) > 1 else 'manages'} {house} and started this "
               f"transfer — nobody approves a transfer they started, so {_ABOVE} approves")
    elif names:
        inside = [n for n in names if sr.fold(n) in pair]
        who = " and ".join(inside)
        why = (f"{who} {'manage' if len(inside) > 1 else 'manages'} {house} and "
               f"{'are' if len(inside) > 1 else 'is'} part of this swap — nobody approves their "
               f"own swap, so {_ABOVE} approves")
    else:
        why = f"no house manager is on file for {house}, so {_ABOVE} approves"
    return {"readable": True, "mode": BY_ABOVE, "names": [], "house_manager": "", "phone": "",
            "why": why}


def directors_for(dsn: str) -> dict[str, Any]:
    """{readable, names, why}: the Time Off house's own directors list — never a name in code."""
    import time_off  # noqa: PLC0415 — lazy: time_off asks this file back

    try:
        names = [n for n in time_off.directors_declared(dsn) if str(n or "").strip()]
    except time_off.Unreadable as exc:
        return {"readable": False, "names": [], "why": str(exc)}
    except Exception as exc:  # noqa: BLE001 — a list that could not be read is not an empty list
        return {"readable": False, "names": [],
                "why": f"the directors list could not be read ({type(exc).__name__})"}
    if not names:
        return {"readable": True, "names": [],
                "why": "the Time Off house's settings name no director — the `directors` cell of "
                       "its Settings tab is the only place a swap's director is read from"}
    return {"readable": True, "names": names,
            "why": (f"the director {' or '.join(names)} approves" if len(names) > 1
                    else f"the director {names[0]} approves")}


def director_names(row: dict[str, Any]) -> list[str]:
    return _names(row.get("directors"))


def manager_names(row: dict[str, Any]) -> list[str]:
    """The names this row asked for the house manager's consent; empty when it was asked above."""
    return [n for n in (_names(row.get("approvers")) + [row.get("house_manager")])
            if str(n or "").strip()]


def _named_as(name: Any, listed: Any) -> bool:
    """The directors list's own rule (time_off.named_as): its middle initial is optional."""
    import time_off  # noqa: PLC0415 — lazy: time_off asks this file back
    return time_off.named_as(name, listed)


def _same_name(a: Any, b: Any) -> bool:
    """One person under either spelling — the wide test, for refusing a second seat."""
    if not sr.fold(a) or not sr.fold(b):
        return False
    return sr.fold(a) == sr.fold(b) or _named_as(a, b) or _named_as(b, a)


def listed_director(name: Any, row: dict[str, Any]) -> bool:
    """A name on the row's directors list, matched as the Time Off lane matches its own list."""
    return bool(sr.fold(name)) and any(_named_as(name, n) for n in director_names(row))


def _pair_names(row: dict[str, Any]) -> list[str]:
    return [str(row.get(k) or "") for k in ("from_staff", "to_staff", "offered_by")
            if sr.fold(row.get(k))]


def _in_swap(name: Any, row: dict[str, Any]) -> bool:
    return any(_same_name(name, p) for p in _pair_names(row))


def _board_without(names: Iterable[str], out: Iterable[Any]) -> list[str]:
    """The directors left once every name in `out` is taken off, under either spelling."""
    gone = [str(o) for o in out if sr.fold(o)]
    return [n for n in names if not any(_same_name(n, o) for o in gone)]


def _gave(row: dict[str, Any], field: str, name: Any) -> bool:
    """Whether `name` already filled the seat whose name `field` records."""
    return _same_name(name, row.get(field))


def may_approve_director(who: dict[str, Any], row: dict[str, Any]) -> bool:
    """The director's own consent: a name on the row's list, never anybody inside the swap, and never the name…"""
    name = str((who or {}).get("name") or "")
    if not sr.fold(name) or _in_swap(name, row):
        return False
    # THREE HUMANS: whoever gave one consent never gives another on the same swap.
    if _gave(row, "manager_by", name):
        return False
    # the master's own session is an eligible director
    if (who or {}).get("is_master") is True:
        return True
    return listed_director(name, row)


def may_open(dsn: str, who: dict[str, Any], *, location: str, giver: str) -> bool:
    """Who may START a swap: the person whose shift it is, or the manager of that shift's house."""
    name = str((who or {}).get("name") or "")
    me = sr.fold(name)
    if not me:
        return False
    if me == sr.fold(giver):
        return True
    # The house's own manager, read from who manages it — never a badge that decides every house, and never a role…
    managers = sr.house_managers(dsn)
    if not managers.get("readable"):
        managers = sr.house_managers(dsn, fresh=True)
    if not managers.get("readable"):
        house = sr.short_house(location) or location
        raise Refused(f"who manages {house} could not be read "
                      f"({managers.get('why') or 'no reason given'}) — try again in a minute",
                      "managers_unreadable")
    return sr.manages(dsn, name, location)


def _pair(row: dict[str, Any]) -> set[str]:
    return {k for k in (sr.fold(row.get("from_staff")), sr.fold(row.get("to_staff")),
                        sr.fold(row.get("offered_by"))) if k}


def may_approve(who: dict[str, Any], row: dict[str, Any]) -> bool:
    """The house manager's own consent — the seat the row named, not a seat a badge takes."""
    name = str((who or {}).get("name") or "")
    me = sr.fold(name)
    if me and me in _pair(row):
        return False
    # THREE HUMANS: whoever gave the director's consent never gives this one too.
    if me and _gave(row, "director_by", name):
        return False
    named = [sr.fold(n) for n in manager_names(row)]
    # A listed director holds the third seat, so they never fill the house manager's for them.
    if me and named and me not in named and listed_director(name, row):
        return False
    if not me and not (who or {}).get("decides_everywhere"):
        return False
    if row.get("approval") == BY_ABOVE:
        return bool((who or {}).get("decides_everywhere"))
    if me and me in named:
        return True
    return sr.may_decide(who or {}, str(row.get("location") or ""))


def side_for(who: dict[str, Any], row: dict[str, Any]) -> str:
    """'staff', 'manager', 'director' or '' — from the session only, never the request body."""
    me = sr.fold((who or {}).get("name"))
    if me and me == sr.fold(row.get("to_staff")):
        return "staff"
    manager, director = may_approve(who, row), may_approve_director(who, row)
    manager_open = manager and str(row.get("manager_state") or PENDING) == PENDING
    # The house manager the row names answers as the house manager, even when their name is also on the directors…
    if manager_open and me and any(sr.fold(n) == me for n in manager_names(row)):
        return "manager"
    # Any other listed director is offered the director's seat FIRST: taking the house manager's would lock the…
    if director and str(row.get("director_state") or PENDING) == PENDING:
        return "director"
    if manager_open:
        return "manager"
    # A seat somebody else already filled is nobody's to answer: the door says so instead of taking an answer it…
    return ""


def may_withdraw(who: dict[str, Any], row: dict[str, Any]) -> bool:
    me = sr.fold((who or {}).get("name"))
    if me and me in (sr.fold(row.get("from_staff")), sr.fold(row.get("offered_by"))):
        return True
    # `may_decide`, not `may_edit_calendar`: a manager's role word alone is not a house.
    return sr.may_decide(who or {}, str(row.get("location") or ""))



def _clock(at: datetime) -> str:
    return at.astimezone(sr.OHIO).strftime("%-I:%M %p")


def _giver_shift(dsn: str, *, location: str, col_iso: str, giver: str,
                 now: datetime) -> dict[str, Any]:
    house_cal_live.ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        live = hub_db.beside(cur, dsn, "SELECT grid FROM asa_house_calendar_live WHERE location=%s", (location,))
        got = live[0] if live else None
        if not got:
            raise Refused("no calendar for that house", "no_calendar")
        grid = house_cal_live._as_dict(got["grid"])
        isos = house_cal_live.col_isos(grid)
        if col_iso not in isos:
            raise Refused(f"{col_iso} is not a column of this calendar", "not_a_column")
        ov, pend = house_cal_live.layers_of(cur, location)
    people = {str(r.get("employee") or "") for r in (grid.get("rows") or [])}
    people |= {e for (e, _i), v in pend.items() if str(v).strip()}
    if giver not in people:
        raise Refused(f"{giver} is not on this calendar", "not_on_calendar")
    value = house_cal_live._cell_text(grid, isos, ov, giver, col_iso, pend)
    if not value.strip():
        raise Refused("there is no shift in that cell to give away", "no_shift")
    span = sr.span_of(col_iso, value)
    if span is None:
        raise Refused(f"{value} is not a shift with hours — only a shift is handed over",
                      "not_a_shift")
    if span[0] <= now:
        raise Refused(f"that shift started at {_clock(span[0])} on {col_iso} — it can no longer be "
                      f"handed over", "started")
    if sr.open_call_off_at(dsn, location, giver, col_iso):
        raise Refused("this shift was called off and is taking applications — it is given from its "
                      "red cell on Calendar Builder → Live, never handed over", "called_off")
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(HANDOFFS_DDL)
        # This giver's shift only: a colleague's offer on the same house-day is theirs.
        cur.execute("SELECT id, to_staff FROM asa_shift_handoffs WHERE location=%s AND col_iso=%s "
                    "AND state=%s AND regexp_replace(lower(from_staff), '[^a-z0-9]+', '', 'g')=%s",
                    (location, col_iso, PENDING, sr.fold(giver)))
        waiting = cur.fetchone()
    if waiting:
        raise Refused(f"{giver}'s shift is already being offered to {waiting['to_staff']} "
                      f"({waiting['id']}) — it has to be answered or withdrawn first",
                      "already_offered", handoff_id=waiting["id"])
    return {"value": value, "span": span, "grid": grid, "isos": isos, "ov": ov, "pend": pend}


def _grid_name(view: dict[str, Any], name: str, location: str) -> str:
    return sr.grid_name(view, name, location)


def _giver_spelling(view: dict[str, Any], giver: str, location: str) -> str:
    return sr.grid_name(view, giver, location, this_house_only=True) or giver


def _receiver_bar(name: str, *, location: str, col_iso: str, own: str,
                  reachable: set[str] | None) -> tuple[str, str]:
    if placeholder(name, location, reachable):
        return "not_a_person", (f"{name} is a row of the calendar, not a person — a shift is only "
                                f"handed to somebody")
    if not house_cal_live.free_for_a_shift(own):
        return "cell_taken", (f"{name} already has {own} at {sr.short_house(location)} on "
                              f"{col_iso} — the calendar holds one shift per person per day")
    if reachable is not None and sr.fold(name) not in reachable:
        return "no_contact", (f"{name} has no phone on the staff roster or on an account, so they "
                              f"could not be asked")
    return "ok", ""


def candidates(dsn: str, *, location: str, col_iso: str, giver: str,
               reachable: set[str] | None = None, reachable_why: str = "",
               now: datetime | None = None, view: dict[str, Any] | None = None,
               managers: dict[str, Any] | None = None, detail: bool = True,
               offered_by: str = "") -> dict[str, Any]:
    """The Transfer picker's names, weighed as the offer will be; `reachable` None means unknown, never refused."""
    now = now or _now()
    view = view or sr.estate(dsn)
    giver = _giver_spelling(view, giver, location)
    shift = _giver_shift(dsn, location=location, col_iso=col_iso, giver=giver, now=now)
    managers = managers if managers is not None else sr.house_managers(dsn)
    approval = approval_for(location=location, giver=giver, receiver="", managers=managers,
                            offered_by=offered_by or giver)
    ist = sr.ist_index(dsn)
    people: dict[str, dict[str, Any]] = {}
    for loc in view.get("locations") or []:
        for n in (view.get("people") or {}).get(loc, []):
            if house_cal_live.not_a_person(n, loc):
                continue
            entry = people.setdefault(sr.fold(n), {"name": n, "houses": []})
            if loc == location:
                entry["name"] = n
            if loc not in entry["houses"]:
                entry["houses"].append(loc)
    people.pop(sr.fold(giver), None)
    people.pop("", None)
    held = sr.held_by_many(dsn, [p["name"] for p in people.values()], view=view)
    trainers = sr.LazyTrainers(dsn, view=view, managers=managers,
                               skip=(location, giver, col_iso))
    cells = view["cells"].get(location, {})
    out: list[dict[str, Any]] = []
    for key, p in people.items():
        name = p["name"]
        here = location in p["houses"]
        own = cells.get((name, col_iso), "") if here else ""
        entry = {"name": name, "here": here,
                 "houses": [sr.short_house(h) for h in p["houses"]],
                 "regular": sr.is_regular(view, name, location),
                 "reachable": None if reachable is None else key in reachable}
        code, why = _receiver_bar(name, location=location, col_iso=col_iso, own=own,
                                  reachable=reachable)
        if code == "ok":
            clash = sr.clash_for(shift["span"], held.get(name, []))
            if clash:
                code, why = sr.clash_verdict(name, clash)
        if code == "not_a_person":
            continue
        if not detail and code != "ok":
            code, why = "unavailable", f"{name} cannot take this shift"
        entry.update(ok=code == "ok", code=code, why=why)
        verdict = sr.ist_verdict(ist, name, location)
        entry["ist"] = verdict["state"] if detail else ""
        entry["needs_training"] = not verdict["ok"]
        if not detail:
            entry["reachable"] = None
        if entry["ok"] and entry["needs_training"]:
            training = trainers.verdict(location=location, col_iso=col_iso,
                                        value=shift["value"], trainee=name)
            entry["training"] = training if detail else sr.training_for_reader(training)
        out.append(entry)
    out.sort(key=lambda e: (not e["ok"], not e["regular"], not e["here"], e["name"].lower()))
    return {"location": location, "house": sr.short_house(location), "col_iso": col_iso,
            "value": shift["value"], "giver": giver, "shift_start": _iso(shift["span"][0]),
            "approval": {k: approval[k] for k in ("readable", "mode", "names", "why")},
            # The third approval, named before anybody is asked: the list, not a badge.
            "directors": directors_for(dsn),
            "candidates": out, "reachable_known": reachable is not None,
            "reachable_why": reachable_why,
            "ist": {"readable": bool(ist.get("readable")), "why": str(ist.get("why") or "")}}



def offer(dsn: str, *, location: str, col_iso: str, from_staff: str, to_staff: str,
          offered_by: str = "", created_by: str = "", now: datetime | None = None,
          managers: dict[str, Any] | None = None,
          reachable: set[str] | None = None,
          evidence: dict[str, Any] | None = None) -> dict[str, Any]:
    """Start a handoff; the roster does not change and every refusal comes before any write."""
    now = now or _now()
    from_staff, to_staff = str(from_staff or "").strip(), str(to_staff or "").strip()
    if not from_staff or not to_staff:
        raise Refused("a handoff needs both names", "names")
    if sr.fold(from_staff) == sr.fold(to_staff):
        raise Refused("that is the same person", "same_person")
    if _is_open_row(from_staff):
        raise Refused("an open shift cannot be handed over — it is applied for on Requests",
                      "open_shift")
    if _is_open_row(to_staff) or placeholder(to_staff, location, reachable):
        raise Refused(f"{to_staff} is a row of the calendar, not a person — a shift is only handed "
                      f"to somebody", "not_a_person")
    ensure_tables(dsn)
    view = sr.estate(dsn, fresh=True)
    from_staff = _giver_spelling(view, from_staff, location)
    shift = _giver_shift(dsn, location=location, col_iso=col_iso, giver=from_staff, now=now)
    value = shift["value"]
    receiver = _grid_name(view, to_staff, location)
    if not receiver:
        raise Refused(f"{to_staff} is not on any house calendar — a shift is only handed to "
                      f"somebody on a roster", "not_on_a_grid")
    own = house_cal_live._cell_text(shift["grid"], shift["isos"], shift["ov"], receiver, col_iso,
                                    shift["pend"])
    code, why = _receiver_bar(receiver, location=location, col_iso=col_iso, own=own,
                              reachable=reachable)
    if code != "ok":
        raise Refused(why, code)
    try:
        got = sr.check_assignment(dsn, person=receiver, location=location, col_iso=col_iso,
                                  value=value, trainer_skip=(location, from_staff, col_iso))
    except Exception as exc:  # noqa: BLE001 — a rule that could not be asked
        raise Refused(f"the overlap check could not be run ({type(exc).__name__}) — nothing was "
                      f"offered; try again in a minute", "guard_unreadable") from exc
    if not got["ok"]:
        raise Refused(str(got.get("why") or "refused"), str(got.get("code") or "overlap"),
                      clash=got.get("clash"))
    approval = approval_for(location=location, giver=from_staff, receiver=receiver,
                            managers=managers if managers is not None else sr.house_managers(dsn),
                            offered_by=str(offered_by or from_staff))
    if not approval["readable"]:
        raise Refused(f"{approval['why']}, so nobody could be asked to approve it — nothing was "
                      f"offered; try again in a minute", "managers_unreadable")
    # The director blocks, so a list that cannot be read refuses the swap before anybody is asked.
    board_of = directors_for(dsn)
    if not board_of["readable"]:
        raise Refused(f"{board_of['why']}, so no director could be asked — nothing was offered; "
                      f"try again in a minute", "directors_unreadable")
    named: list[str] = []
    if board_of["names"]:
        named = _board_without(board_of["names"], [from_staff, receiver, offered_by or from_staff])
        if not named:
            # Said in full, because on a one-name list this refuses that director every shift they try to give away…
            raise Refused(f"{' and '.join(board_of['names'])} "
                          f"{'are' if len(board_of['names']) > 1 else 'is'} the whole directors list "
                          f"and part of this swap — nobody approves their own swap, so another name on "
                          f"Settings → Time Off's directors list is what lets this one be asked",
                          "directors_in_the_swap")
        # The house manager the row names gives the house manager's consent; the director's is somebody else's, or…
        others = _board_without(named, approval["names"])
        if not others:
            house = sr.short_house(location) or location
            raise Refused(f"{' and '.join(named)} {'are' if len(named) > 1 else 'is'} all the directors "
                          f"list leaves for this swap, and {'manage' if len(named) > 1 else 'manages'} "
                          f"{house} — the house manager's approval is theirs, and one person never gives "
                          f"two of the three consents, so another name on Settings → Time Off's "
                          f"directors list is what lets this one be asked", "directors_manage_the_house")
        named = others
    # A list that names nobody opens the swap as time off is filed: the receiver and the house manager are asked…
    ist = got.get("ist") or {}
    needs = bool(ist) and not ist.get("ok", True)
    on_file = got.get("training_on_file") if needs else None
    trainer = got.get("training") or {}
    training = ({"needed": True, "state": ist.get("state") or "", "why": ist.get("why") or "",
                 "trainer": {k: trainer.get(k) for k in ("state", "may_approve", "trains", "why")}
                 if trainer else {}}
                if needs else {"needed": False})
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(HANDOFFS_DDL)
        hid = handoff_id(location, col_iso, receiver, now.isoformat())
        try:
            cur.execute(
                "INSERT INTO asa_shift_handoffs "
                "(id, location, col_iso, value, from_staff, to_staff, house_manager, created_by, "
                "approvers, approval, approval_why, manager_phone, offered_by, shift_start, "
                "training, directors, extra) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "RETURNING *",
                (hid, location, col_iso, value, from_staff, receiver, approval["house_manager"],
                 str(created_by or "").strip(), json.dumps(approval["names"]), approval["mode"],
                 approval["why"], approval["phone"], str(offered_by or from_staff).strip(),
                 shift["span"][0], json.dumps(training), json.dumps(named),
                 json.dumps(evidence or {}, default=str)))
        except psycopg2.errors.UniqueViolation:
            conn.rollback()
            raise AlreadyOffered(location, col_iso, from_staff) from None
        row = dict(cur.fetchone())
        if needs:
            if on_file:
                rid = str(on_file.get("id") or "")
            else:
                sr._ddl(cur)
                # the training a rehearsed offer raises carries the offer's mark, so every door that reads a…
                played = isinstance(evidence, dict) and REHEARSAL_KEY in evidence
                rid = sr._record_training(cur, kind=sr.KIND_SWAP, location=location,
                                          open_row=receiver, col_iso=col_iso, value=value,
                                          person=receiver, verdict=ist,
                                          via=f"{REHEARSAL_VIA}app" if played else "app",
                                          evidence={REHEARSAL_KEY: evidence[REHEARSAL_KEY]}
                                          if played else None)
            cur.execute("UPDATE asa_shift_handoffs SET training_request=%s WHERE id=%s RETURNING *",
                        (rid, hid))
            row = dict(cur.fetchone() or row)
        if not named:
            row = _pause(cur, row, f"{_NO_NAMED} ({board_of['why']})")
        conn.commit()
    return row



def answer(dsn: str, hid: str, *, side: str, word: str, via: str = "app",
           by: str = "", now: datetime | None = None,
           rehearsal: dict[str, Any] | None = None, master: bool = False) -> dict[str, Any]:
    """Record one consent; the conditional UPDATE is the guard against a repeat."""
    if side not in ("staff", "manager", "director"):
        raise ValueError("side is 'staff', 'manager' or 'director'")
    if word not in ("yes", "no"):
        raise ValueError("word is 'yes' or 'no'")
    ensure_tables(dsn)
    row = handoff(dsn, hid)
    if not row:
        raise LookupError("no such handoff")
    hid = row["id"]
    # A REAL CONSENT IS NEVER GIVEN ON A REHEARSED TRANSFER, and a rehearsed one is never given on a real transfer…
    played = is_rehearsed(row)
    if played and rehearsal is None:
        raise Refused(f"the transfer {hid} was played in the shift rehearsal — {row.get('from_staff')} "
                      f"never offered that shift, so there is nothing to accept or approve, and "
                      f"nothing was done", "rehearsed_swap")
    if rehearsal is not None and not played:
        raise Refused(f"the transfer {hid} is a real one between {row.get('from_staff')} and "
                      f"{row.get('to_staff')} — a rehearsal never answers in a real person's "
                      f"name, and this answer would leave a real consent on the row",
                      "real_swap")
    who = str(by or "").strip()
    if side == "manager" and who and manager_names(row) \
            and not any(sr.fold(n) == sr.fold(who) for n in manager_names(row)) \
            and listed_director(who, row):
        raise Refused(f"{who} is a director of this swap — the house manager's approval is "
                      f"{' or '.join(manager_names(row))}'s own to give", "not_the_managers_seat")
    if side == "director" and who and _in_swap(who, row):
        raise Refused(f"{who} is part of this swap — nobody approves their own swap, and one "
                      f"person never gives two of the three consents", "own_swap")
    if side == "director" and who and not master and not director_names(row):
        # Opened while the list named nobody: said as that, never as "not a director".
        raise Refused("no director has been asked to approve this swap yet — its director's approval "
                      "waits until a name on Settings → Time Off's directors list is asked", "no_directors")
    if side == "director" and who and not master and not listed_director(who, row):
        raise Refused(f"{who} is not on the directors list this swap was asked of", "not_a_director")
    # THE SAME NAME NEVER FILLS TWO OF THE THREE SEATS — over the app or over a text.
    if side in ("manager", "director") and who:
        held = "director_by" if side == "manager" else "manager_by"
        if _gave(row, held, who):
            gave = "the director's" if side == "manager" else "the house manager's"
            owes = "the house manager's" if side == "manager" else "the director's"
            raise Refused(f"{who} already gave {gave} approval on this swap — a swap takes three "
                          f"people, so {owes} approval is somebody else's to give", "two_seats")
    if side == "manager" and who and sr.fold(who) in _pair(row):
        if sr.fold(who) not in (sr.fold(row.get("from_staff")), sr.fold(row.get("to_staff"))):
            raise Refused(f"{who} started this transfer — the approval checks that decision, so "
                          f"somebody else gives it", "own_swap")
        raise Refused(f"{who} is part of this swap — nobody approves their own swap, and one "
                      f"person never gives two of the three consents", "own_swap")
    if side == "staff" and who and sr.fold(who) != sr.fold(row.get("to_staff")):
        raise Refused(f"only {row.get('to_staff')}, who is being offered the shift, accepts it",
                      "not_the_receiver")
    rid = str(row.get("training_request") or "")
    trainers: list[str] = []
    if side == "manager" and word == "yes" and rid:
        waiting = sr.request_row(dsn, rid)
        if waiting and waiting.get("state") == sr.NEEDS_TRAINING:
            trainers = sr.trainer_names(dsn, row["location"], approver=who)
        else:
            rid = ""
    else:
        rid = ""
    gates = sr.person_gates(dsn, [row["from_staff"], row["to_staff"], *trainers]
                            if word == "yes" else [])
    with gates:
        if rid:
            fresh = handoff(dsn, hid) or {}
            if fresh.get("state") == PENDING and fresh.get("manager_state") == PENDING:
                try:
                    sr.approve_training(dsn, request_id_=rid, by=who or "the house manager",
                                        location=row["location"], gated=False,
                                        trainer_skip=(row["location"], row["from_staff"],
                                                      row["col_iso"]),
                                        rehearsal=rehearsal)
                except sr.Refused as exc:
                    raise Refused(exc.why, exc.code, **exc.extra) from None
        out = _answer_locked(dsn, hid, side=side, word=word, via=via, by=who, now=now)
    if out.get("state") == DONE:
        sr.forget_estate()
    return out


def _answer_locked(dsn: str, hid: str, *, side: str, word: str, via: str, by: str,
                   now: datetime | None) -> dict[str, Any]:
    if side == "staff":
        state = ACCEPTED if word == "yes" else DECLINED
    else:
        state = APPROVED if word == "yes" else NOT_APPROVED
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(HANDOFFS_DDL)
        if side == "staff":
            cur.execute(
                "UPDATE asa_shift_handoffs SET staff_state=%s, staff_via=%s, staff_at=now(), "
                "staff_by=%s WHERE id=%s AND state=%s AND staff_state=%s RETURNING *",
                (state, via, by, hid, PENDING, PENDING))
        elif side == "director":
            cur.execute(
                "UPDATE asa_shift_handoffs SET director_state=%s, director_via=%s, "
                "director_at=now(), director_by=%s "
                "WHERE id=%s AND state=%s AND director_state=%s RETURNING *",
                (state, via, by, hid, PENDING, PENDING))
        else:
            cur.execute(
                "UPDATE asa_shift_handoffs SET manager_state=%s, manager_via=%s, manager_at=now(), "
                "manager_by=%s WHERE id=%s AND state=%s AND manager_state=%s RETURNING *",
                (state, via, by, hid, PENDING, PENDING))
        row = cur.fetchone()
        if not row:
            current = _row(cur, hid)
            conn.commit()
            if not current:
                raise LookupError("no such handoff")
            return {**current, "changed": False}
        row = dict(row)

        if word == "no":
            why = (f"{row['to_staff']} passed" if side == "staff"
                   else f"the director did not approve ({by or 'no name given'})"
                   if side == "director"
                   else f"the house manager did not approve ({by or 'no name given'})")
            row = _close(cur, row, DEAD, why, by=by)
            conn.commit()
            return {**row, "changed": True}

        if all_agreed(row):
            row = _complete(cur, row, dsn, now=now)
        conn.commit()
    return {**row, "changed": True}


def all_agreed(row: dict[str, Any]) -> bool:
    """The three consents, each read from its own field — none is ever inferred from another."""
    return (row.get("staff_state") == ACCEPTED and row.get("manager_state") == APPROVED
            and str(row.get("director_state") or PENDING) == APPROVED)


def _plain(text: Any) -> str:
    return (str(text or "").replace("—", "-").replace("–", "-")
            .replace("→", "->").replace("’", "'").replace("…", "...")
            .encode("ascii", "replace").decode("ascii"))


def _close(cur, row: dict[str, Any], state: str, why: str, *, by: str = "") -> dict[str, Any]:
    why = _plain(why)
    cur.execute("UPDATE asa_shift_handoffs SET state=%s, why=%s, closed_at=now(), closed_by=%s "
                "WHERE id=%s AND state=%s RETURNING *", (state, why, by, row["id"], PENDING))
    got = cur.fetchone()
    if state == DEAD and row.get("training_request"):
        sr._ddl(cur)
        cur.execute("UPDATE asa_shift_requests SET state=%s, why=%s, decided_at=now() "
                    "WHERE id=%s AND kind=%s AND state=%s",
                    (sr.WITHDRAWN, f"the swap it was for closed — {why}", row["training_request"],
                     sr.KIND_IST, sr.NEEDS_TRAINING))
    return dict(got) if got else dict(row)


def _pause(cur, row: dict[str, Any], why: str) -> dict[str, Any]:
    cur.execute("UPDATE asa_shift_handoffs SET why=%s WHERE id=%s AND state=%s RETURNING *",
                (_plain(why), row["id"], PENDING))
    got = cur.fetchone()
    return dict(got) if got else dict(row)


def _note(cur, row: dict[str, Any], why: str) -> None:
    """The same sentence, said once: a beat that runs every minute writes nothing new."""
    if str(row.get("why") or "") != _plain(why):
        _pause(cur, row, why)


def _complete(cur, row: dict[str, Any], dsn: str, *, now: datetime | None = None
              ) -> dict[str, Any]:
    """Move the shift via the Builder's writer in this transaction; an unaskable rule leaves it pending."""
    import calendar_builder_houses  # noqa: PLC0415

    now = now or _now()
    cur.execute(HANDOFFS_DDL)
    house_cal_live.ensure_tables(dsn)
    live = hub_db.beside(cur, dsn, "SELECT grid FROM asa_house_calendar_live WHERE location=%s", (row["location"],))
    got = live[0] if live else None
    grid = house_cal_live._as_dict(got["grid"]) if got else {}
    isos = house_cal_live.col_isos(grid)
    ov, pend = house_cal_live.layers_of(cur, row["location"])
    now_value = house_cal_live._cell_text(grid, isos, ov, row["from_staff"], row["col_iso"],
                                          pend)
    if now_value.strip() != str(row["value"]).strip():
        return _close(cur, row, DEAD, f"the shift changed while it was being agreed "
                                      f"({row['value']} -> {now_value or 'empty'})")
    span = sr.span_of(row["col_iso"], row["value"])
    if span is not None and span[0] <= now:
        return _close(cur, row, DEAD, f"the shift began before all three answered — it stays with "
                                      f"{row['from_staff']}")
    if sr.open_call_off_at(dsn, row["location"], row["from_staff"], row["col_iso"]):
        return _close(cur, row, DEAD, "the shift was called off while it was being agreed — it is "
                                      "given from its red cell on Calendar Builder → Live now")
    theirs = house_cal_live._cell_text(grid, isos, ov, row["to_staff"], row["col_iso"], pend)
    if not house_cal_live.free_for_a_shift(theirs):
        return _close(cur, row, DEAD, f"{row['to_staff']} already has {theirs} in that cell on "
                                      f"{row['col_iso']} — the calendar holds one shift per "
                                      f"person per day, so nothing was written over it")
    try:
        got = sr.check_assignment(dsn, person=row["to_staff"], location=row["location"],
                                  col_iso=row["col_iso"], value=row["value"],
                                  ignore_handoff=row["id"],
                                  trainer_skip=(row["location"], row["from_staff"],
                                                row["col_iso"]))
    except Exception as exc:  # noqa: BLE001 — a rule that could not be asked
        return _pause(cur, row, f"the overlap check could not be run ({type(exc).__name__}) — "
                                f"both have agreed and nothing has moved; it is tried again in a "
                                f"minute")
    if not got["ok"]:
        return _close(cur, row, DEAD, str(got.get("why") or "it overlaps another shift"))
    ist = got.get("ist") or {}
    if ist and not ist.get("ok"):
        on_file = got.get("training_on_file")
        training = got.get("training") or {}
        if on_file:
            if not training.get("may_approve"):
                return _pause(cur, row, f"{ist.get('why')} — the training was approved, but "
                                        f"{training.get('why')}. Nothing has moved; it is tried "
                                        f"again in a minute")
            if sr.fold(training.get("trains")) != sr.fold(sr._recorded_trainer(on_file)):
                sr._name_trainer(dsn, str(on_file["id"]),
                                 sr.trainer_record(training, by=str(on_file.get("decided_by") or "")))
        else:
            # An unreadable IST counts as missing.
            rid = str(row.get("training_request") or "")
            if not rid:
                rid = sr.raise_training(dsn, kind=sr.KIND_SWAP, location=row["location"],
                                        open_row=row["to_staff"], col_iso=row["col_iso"],
                                        value=row["value"], person=row["to_staff"], verdict=ist,
                                        rehearsal=_evidence(row))
                cur.execute("UPDATE asa_shift_handoffs SET training_request=%s WHERE id=%s",
                            (rid, row["id"]))
                row = {**row, "training_request": rid}
            return _pause(cur, row, f"{ist.get('why')} — both have agreed, and the swap waits on the "
                                    f"house manager's training approval on Requests")
    elif ist and row.get("training_request"):
        sr._ddl(cur)
        cur.execute("UPDATE asa_shift_requests SET state=%s, why=%s, decided_at=now() "
                    "WHERE id=%s AND kind=%s AND state=%s",
                    (sr.WITHDRAWN, f"the IST record now reads {ist.get('why') or 'trained'} — no "
                                   f"training is needed", row["training_request"], sr.KIND_IST,
                     sr.NEEDS_TRAINING))

    who = str(row.get("manager_by") or row.get("house_manager") or row.get("to_staff") or "")
    cells = [
        {"employee": row["to_staff"], "col_iso": row["col_iso"], "value": row["value"],
         "base": house_cal_live.workbook_text(grid, isos, pend, row["to_staff"], row["col_iso"])},
        {"employee": row["from_staff"], "col_iso": row["col_iso"], "value": "",
         "base": house_cal_live.workbook_text(grid, isos, pend, row["from_staff"],
                                              row["col_iso"])},
    ]
    try:
        # a rehearsed swap's cells carry the mark in their road, like every rehearsed write
        wrote = calendar_builder_houses.publish_cells(
            dsn, row["location"], cells, actor=who,
            via=sr.rehearsed_via("handoff", _evidence(row)), act=str(row["id"]))
    except house_cal_live.WorkbookRefused as exc:
        if exc.code == "blocked":
            return _close(cur, row, DEAD, f"the house calendar changed under the swap — {exc.why}")
        return _pause(cur, row, f"agreed, but the house calendar could not be written yet — "
                                f"{exc.why}")
    said = ("done while test mode held roster writes — recorded on the platform, not written to "
            "the house calendars workbook" if (wrote or {}).get("test_mode") else "")
    cur.execute("UPDATE asa_shift_handoffs SET state=%s, why=%s, closed_at=now() "
                "WHERE id=%s AND state=%s RETURNING *", (DONE, said, row["id"], PENDING))
    got = cur.fetchone()
    return dict(got) if got else dict(row)


def withdraw(dsn: str, hid: str, *, by: str, why: str = "") -> dict[str, Any]:
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(HANDOFFS_DDL)
        cur.execute("SELECT * FROM asa_shift_handoffs WHERE id=%s FOR UPDATE", (hid,))
        row = cur.fetchone()
        if not row:
            conn.commit()
            raise LookupError("no such handoff")
        row = dict(row)
        if row["state"] != PENDING:
            conn.commit()
            raise Refused(f"that offer is no longer waiting — it is {row['state']}", "not_pending")
        row = _close(cur, row, DEAD, why or f"withdrawn by {by or 'the giver'}", by=by)
        conn.commit()
    return row


def expire(dsn: str, *, now: datetime | None = None) -> dict[str, Any]:
    now = now or _now()
    ensure_tables(dsn)
    ended = called = 0
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(HANDOFFS_DDL)
        cur.execute("SELECT * FROM asa_shift_handoffs WHERE state=%s", (PENDING,))
        rows = [dict(r) for r in cur.fetchall()]
        for row in rows:
            start = row.get("shift_start")
            if start is None:
                span = sr.span_of(row["col_iso"], row["value"])
                start = span[0] if span else None
            if start is not None and start <= now:
                _close(cur, row, DEAD, f"the shift began before all three answered — it stays with "
                                       f"{row['from_staff']}")
                ended += 1
            elif sr.open_call_off_at(dsn, row["location"], row["from_staff"], row["col_iso"]):
                _close(cur, row, DEAD, "the shift was called off — it is given from its red cell on "
                                       "Calendar Builder → Live now")
                called += 1
        conn.commit()
    return {"started": ended, "called_off": called}


_NO_BOARD = ("no director has been asked to approve this swap yet, and the directors list could "
             "not be read — it waits until it can be")
_NO_NAMED = ("no director has been asked to approve this swap yet: Settings → Time Off's directors "
             "list names nobody — the director's approval waits until a name is saved there")
_NOT_ASKABLE = ("no director has been asked to approve this swap yet, and every director on the list "
                "is part of it or already gave its house manager's approval — another name on "
                "Settings → Time Off's directors list lets it be asked")
_ONLY_THE_HM = ("no director has been asked to approve this swap yet, and every director on the list "
                "left for it is its house manager, whose approval is the house manager's — another "
                "name on Settings → Time Off's directors list lets it be asked")
# Every sentence this lane writes while a swap has no board; each is untrue once it has one.
_WAIT_NOTES = (_NO_BOARD, _NO_NAMED, _NOT_ASKABLE, _ONLY_THE_HM)


def adopt_directors(dsn: str, *, board: dict[str, Any] | None = None) -> dict[str, Any]:
    """A swap with no directors on it (opened while the list named nobody, or before the third consent existed)…"""
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(HANDOFFS_DDL)
        cur.execute("SELECT * FROM asa_shift_handoffs WHERE state=%s AND director_state=%s "
                    "AND jsonb_array_length(directors)=0", (PENDING, PENDING))
        rows = [dict(r) for r in cur.fetchall()]
        if not rows:
            conn.commit()
            return {"adopted": 0, "waiting": 0, "why": ""}
        board = board or directors_for(dsn)
        if not board["readable"] or not board["names"]:
            said = _NO_BOARD if not board["readable"] else _NO_NAMED
            for row in rows:
                _note(cur, row, f"{said} ({board['why']})")
            conn.commit()
            return {"adopted": 0, "waiting": len(rows), "why": board["why"]}
        adopted = stuck = 0
        for row in rows:
            # Nobody in the swap, and nobody who already gave the house manager's consent.
            named = _board_without(board["names"],
                                   [*_pair_names(row), row.get("manager_by") or ""])
            if not named:
                _note(cur, row, _NOT_ASKABLE)
                stuck += 1
                continue
            if str(row.get("manager_state") or PENDING) == PENDING:
                # The house manager's seat is still theirs to fill, so they are not its director.
                named = _board_without(named, manager_names(row))
                if not named:
                    _note(cur, row, _ONLY_THE_HM)
                    stuck += 1
                    continue
            # the sentence that said it waited for a board is no longer true once it has one
            waited = str(row.get("why") or "").startswith(tuple(_plain(n) for n in _WAIT_NOTES))
            cur.execute("UPDATE asa_shift_handoffs SET directors=%s, why=CASE WHEN %s THEN '' ELSE why END "
                        "WHERE id=%s AND state=%s AND jsonb_array_length(directors)=0",
                        (json.dumps(named), waited, row["id"], PENDING))
            adopted += cur.rowcount
        conn.commit()
    return {"adopted": adopted, "waiting": stuck, "why": ""}


def complete_ready(dsn: str, *, limit: int = 20, now: datetime | None = None) -> dict[str, Any]:
    """Finish agreed offers left pending, each under both gates and SKIP LOCKED."""
    now = now or _now()
    ensure_tables(dsn)
    # Before the gate is read: a row with no directors on it would never pass one.
    adopt_directors(dsn)
    closed = expire(dsn, now=now)
    done = dead = waiting = 0
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(HANDOFFS_DDL)
        # a rehearsed transfer is never completed by the beat, whatever its two columns say
        cur.execute("SELECT id, from_staff, to_staff FROM asa_shift_handoffs WHERE state=%s "
                    "AND staff_state=%s AND manager_state=%s AND director_state=%s "
                    "AND NOT (extra ? %s) ORDER BY created_at LIMIT %s",
                    (PENDING, ACCEPTED, APPROVED, APPROVED, REHEARSAL_KEY, limit))
        ready = [dict(r) for r in cur.fetchall()]
    for got in ready:
        with sr.person_gates(dsn, [got["from_staff"], got["to_staff"]]):
            with _connect(dsn) as conn, conn.cursor(
                    cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM asa_shift_handoffs WHERE id=%s AND state=%s "
                            "FOR UPDATE SKIP LOCKED", (got["id"], PENDING))
                row = cur.fetchone()
                if not row:
                    conn.commit()
                    continue
                moved = _complete(cur, dict(row), dsn, now=now)
                conn.commit()
                if str(moved.get("state") or "") == DONE:
                    # Before the gates open, so the next writer weighs the new roster.
                    sr.forget_estate()
        state = str(moved.get("state") or "")
        if state == DONE:
            done += 1
        elif state == DEAD:
            dead += 1
        else:
            waiting += 1
    if done:
        sr.forget_estate()
    return {"done": done, "dead": dead, "waiting": waiting, "looked_at": len(ready),
            "expired": closed["started"], "called_off": closed["called_off"]}


def training_answered(dsn: str, request_id_: str, *, who: dict[str, Any], word: str,
                      via: str = "app") -> dict[str, Any] | None:
    """A swap's training answer is also the manager's consent; None when no swap carries it."""
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(HANDOFFS_DDL)
        cur.execute("SELECT * FROM asa_shift_handoffs WHERE training_request=%s AND state=%s",
                    (request_id_, PENDING))
        row = cur.fetchone()
    if not row:
        return None
    row = dict(row)
    name = str((who or {}).get("name") or "")
    if word != "yes":
        with _connect(dsn) as conn, conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            got = _close(cur, row, DEAD, f"the house manager did not take the training on "
                                         f"({name or 'no name given'})", by=name)
            conn.commit()
        return got
    if row.get("manager_state") == PENDING and may_approve(who, row):
        return answer(dsn, row["id"], side="manager", word="yes", via=via, by=name)
    if row.get("staff_state") == ACCEPTED and row.get("manager_state") == APPROVED:
        complete_ready(dsn, limit=5)
        return handoff(dsn, row["id"])
    return row


def waits_on(row: dict[str, Any], name: str, *, above: bool = False) -> bool:
    """Whether a pending swap waits on this name, seat by seat — each seat also refuses the name that already…"""
    me = sr.fold(name)
    if not me or row.get("state") != PENDING:
        return False
    if me == sr.fold(row.get("to_staff")) and row.get("staff_state") == PENDING:
        return True
    if me in (sr.fold(row.get("from_staff")), sr.fold(row.get("to_staff"))):
        return False
    if row.get("manager_state") == PENDING and not _gave(row, "director_by", name) and (
            any(sr.fold(n) == me for n in manager_names(row))
            or (above and row.get("approval") == BY_ABOVE)):
        return True
    # The directors list is matched as the Time Off lane matches it — its middle initial is optional — so a director…
    return (str(row.get("director_state") or PENDING) == PENDING
            and not _in_swap(name, row) and not _gave(row, "manager_by", name)
            and listed_director(name, row))


def waiting_on(dsn: str, name: str, *, above: bool = False) -> list[dict[str, Any]]:
    name = name.strip()
    if not name:
        return []
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(HANDOFFS_DDL)
        cur.execute("SELECT * FROM asa_shift_handoffs WHERE state=%s ORDER BY created_at",
                    (PENDING,))
        rows = [dict(r) for r in cur.fetchall()]
    return [r for r in rows if waits_on(r, name, above=above)]


def open_offers(dsn: str, *, location: str = "") -> list[dict[str, Any]]:
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(HANDOFFS_DDL)
        if location:
            cur.execute("SELECT * FROM asa_shift_handoffs WHERE state=%s AND location=%s "
                        "ORDER BY col_iso", (PENDING, location))
        else:
            cur.execute("SELECT * FROM asa_shift_handoffs WHERE state=%s ORDER BY col_iso",
                        (PENDING,))
        return [dict(r) for r in cur.fetchall()]


def match_reply(dsn: str, *, text: str, name: str = "", handoff_ref: str = "",
                who: dict[str, Any] | Callable[[], dict[str, Any]] | None = None
                ) -> dict[str, Any] | None:
    """A quoted ref wins, else exactly one waiting offer; never a guess."""
    def reader() -> dict[str, Any]:
        return (who() if callable(who) else who) or {"name": name}

    ref = (handoff_ref or "").strip().upper()
    if not ref:
        m = REF_RE.search(str(text or "").upper())
        ref = m.group(0) if m else ""
    ensure_tables(dsn)
    key = sr.fold(name)
    if ref:
        with _connect(dsn) as conn, conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(HANDOFFS_DDL)
            cur.execute("SELECT * FROM asa_shift_handoffs WHERE id=%s AND state=%s", (ref, PENDING))
            row = cur.fetchone()
        if not row:
            return None
        row = dict(row)
        if not key:
            return {**row, "side": ""}
        if key == sr.fold(row["to_staff"]):
            return {**row, "side": "staff"}
        if key in _pair(row):
            return None
        # The text door reads the same seats the screen does — one name, one seat.
        seat = side_for({**reader(), "name": name}, row)
        return {**row, "side": seat} if seat else None
    above = False
    if who is not None:
        above = bool(reader().get("decides_everywhere"))
    waiting = waiting_on(dsn, name, above=above)
    if len(waiting) != 1:
        return None
    row = waiting[0]
    if sr.fold(row["to_staff"]) == key and row["staff_state"] == PENDING:
        return {**row, "side": "staff"}
    seat = side_for({**reader(), "name": name}, row)
    return {**row, "side": seat} if seat else None



DELIVERED = frozenset({"told", "duplicate"})


def _said(row: dict[str, Any]) -> dict[str, Any]:
    return _json(row.get("said"))


def _ask_state(entry: Any) -> dict[str, Any]:
    if isinstance(entry, str):
        return {"state": "told", "why": "", "at": entry, "reached": True}
    if not isinstance(entry, dict):
        return {"state": "", "why": "", "at": "", "reached": False}
    state = str(entry.get("state") or "")
    return {"state": state, "why": str(entry.get("why") or ""), "at": str(entry.get("at") or ""),
            "reached": state in DELIVERED}


def describe(row: dict[str, Any], who: dict[str, Any] | None, *,
             training_state: str = "") -> dict[str, Any]:
    who = who or {}
    me = sr.fold(who.get("name"))
    said = _said(row)
    training = _json(row.get("training"))
    side = side_for(who, row) if row.get("state") == PENDING else ""
    ask_manager = KIND_ASK_ABOVE if row.get("approval") == BY_ABOVE else KIND_ASK_MANAGER
    directors = director_names(row)
    director_state = str(row.get("director_state") or PENDING)
    if director_state == PENDING and not directors and row.get("state") != PENDING:
        # Closed before a director's approval was asked for: nobody was waited on.
        director_state = "not_asked"
    return {
        "id": row["id"], "location": row.get("location") or "",
        "house": sr.short_house(str(row.get("location") or "")),
        "col_iso": row.get("col_iso") or "", "value": row.get("value") or "",
        "from_staff": row.get("from_staff") or "", "to_staff": row.get("to_staff") or "",
        "house_manager": row.get("house_manager") or "",
        "state": row.get("state") or "", "why": row.get("why") or "",
        "staff_state": row.get("staff_state") or "", "staff_via": row.get("staff_via") or "",
        "staff_at": _iso(row.get("staff_at")), "staff_by": row.get("staff_by") or "",
        "manager_state": row.get("manager_state") or "",
        "manager_via": row.get("manager_via") or "", "manager_at": _iso(row.get("manager_at")),
        "manager_by": row.get("manager_by") or "",
        "director_state": director_state,
        "director_via": row.get("director_via") or "", "director_at": _iso(row.get("director_at")),
        "director_by": row.get("director_by") or "",
        "directors": directors, "director": directors[0] if directors else "",
        "created_at": _iso(row.get("created_at")), "closed_at": _iso(row.get("closed_at")),
        "offered_by": row.get("offered_by") or "", "closed_by": row.get("closed_by") or "",
        "shift_start": _iso(row.get("shift_start")),
        "approval": {"mode": row.get("approval") or (BY_HOUSE_MANAGER if row.get("house_manager")
                                                     else ""),
                     "names": _names(row.get("approvers")) or ([row["house_manager"]]
                                                               if row.get("house_manager") else []),
                     "why": row.get("approval_why") or ""},
        "first_shift": {**training, "request": row.get("training_request") or "",
                     "request_state": training_state},
        "asks": {"staff": _ask_state(said.get(KIND_ASK_STAFF)),
                 "manager": _ask_state(said.get(ask_manager)),
                 "director": _ask_seen(said, KIND_ASK_DIRECTOR)},
        # a rehearsed transfer is never offered to a real hand: answer() refuses it anyway
        "may_accept": side == "staff" and row.get("staff_state") == PENDING
        and not is_rehearsed(row),
        "may_approve": side == "manager" and row.get("manager_state") == PENDING
        and not is_rehearsed(row),
        "may_approve_director": side == "director" and director_state == PENDING
        and not is_rehearsed(row),
        "may_withdraw": row.get("state") == PENDING and may_withdraw(who, row),
        # THE MARK, on every reader of a transfer: the ask, the Requests screens, my shifts
        REHEARSAL_KEY: is_rehearsed(row),
        "mine": bool(me) and (me in _pair(row) or me == sr.fold(row.get("offered_by"))
                              or any(sr.fold(n) == me for n in _names(row.get("approvers")))
                              or listed_director(who.get("name"), row)),
    }


def _training_states(cur, rids: Iterable[str]) -> dict[str, str]:
    ids = sorted({r for r in rids if r})
    if not ids:
        return {}
    sr._ddl(cur)
    cur.execute("SELECT id, state FROM asa_shift_requests WHERE id = ANY(%s)", (ids,))
    return {str(r["id"]): str(r["state"] or "") for r in cur.fetchall()}


def rows_for(dsn: str, *, where: str = "", args: tuple = (), limit: int = 400
             ) -> tuple[list[dict[str, Any]], dict[str, str]]:
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(HANDOFFS_DDL)
        cur.execute("SELECT * FROM asa_shift_handoffs" + (f" WHERE {where}" if where else "")
                    + " ORDER BY created_at DESC LIMIT %s", (*args, limit))
        rows = [dict(r) for r in cur.fetchall()]
        states = _training_states(cur, (str(r.get("training_request") or "") for r in rows))
        conn.commit()
    return rows, states


def board(dsn: str, who: dict[str, Any], *, location: str = "") -> dict[str, Any]:
    where, args = "state=%s", (PENDING,)
    if location:
        where, args = "state=%s AND location=%s", (PENDING, location)
    rows, states = rows_for(dsn, where=where, args=args)
    waiting, mine, others = [], [], []
    me = sr.fold((who or {}).get("name"))
    for r in rows:
        d = describe(r, who, training_state=states.get(str(r.get("training_request") or ""), ""))
        if d["may_accept"] or d["may_approve"] or d["may_approve_director"]:
            waiting.append(d)
        elif me and me in (sr.fold(r.get("from_staff")), sr.fold(r.get("offered_by"))):
            mine.append(d)
        elif d["may_withdraw"] or d["mine"]:
            others.append(d)
    return {"waiting_on_me": waiting, "mine": mine, "open": others}


def for_house(dsn: str, location: str, who: dict[str, Any]) -> list[dict[str, Any]]:
    rows, states = rows_for(dsn, where="state=%s AND location=%s", args=(PENDING, location))
    out = []
    for r in rows:
        d = describe(r, who, training_state=states.get(str(r.get("training_request") or ""), ""))
        if d["mine"] or d["may_accept"] or d["may_approve"] or d["may_approve_director"] \
                or d["may_withdraw"]:
            out.append(d)
    return out


MY_SHIFTS_DAYS = int(os.getenv("HUB_HANDOFF_MY_SHIFTS_DAYS", "21"))


def my_shifts(dsn: str, who: dict[str, Any], *, view: dict[str, Any] | None = None,
              now: datetime | None = None, days: int | None = None) -> list[dict[str, Any]]:
    me = str((who or {}).get("name") or "").strip()
    if not sr.fold(me):
        return []
    now = now or _now()
    view = view or sr.estate(dsn)
    until = now + timedelta(days=MY_SHIFTS_DAYS if days is None else days)
    spans = [h for h in view["spans"].get(sr.fold(me), [])
             if h.get("source") == "roster" and now < h["span"][0] <= until]
    if not spans:
        return []
    # By name key: the session may spell the grid's name its own way.
    rows, states = rows_for(dsn, where="state=%s AND regexp_replace(lower(from_staff), "
                                       "'[^a-z0-9]+', '', 'g')=%s",
                            args=(PENDING, sr.fold(me)))
    offered = {_offer_key(r["location"], r["col_iso"], r["from_staff"]): r for r in rows}
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        sr._ddl(cur)
        cur.execute("SELECT location, col_iso FROM asa_shift_pool WHERE kind=%s AND filled_by='' "
                    "AND regexp_replace(lower(open_row), '[^a-z0-9]+', '', 'g')=%s",
                    (sr.KIND_CALLOFF, sr.fold(me)))
        called = {(r["location"], r["col_iso"]) for r in cur.fetchall()}
    out = []
    for h in sorted(spans, key=lambda x: x["span"][0]):
        cell = (h["location"], h["col_iso"])
        entry = {"location": h["location"], "house": sr.short_house(h["location"]),
                 "employee": h.get("employee") or me, "col_iso": h["col_iso"],
                 "value": h["value"], "start": _iso(h["span"][0]), "end": _iso(h["span"][1]),
                 "may_transfer": True, "why": "", "offer": None}
        mine = _offer_key(h["location"], h["col_iso"], h.get("employee") or me)
        if mine in offered:
            r = offered[mine]
            entry.update(may_transfer=False, why="offered — waiting on the answers",
                         offer=describe(r, who, training_state=states.get(
                             str(r.get("training_request") or ""), "")))
        elif cell in called:
            entry.update(may_transfer=False,
                         why="you called this shift off — it is given from its red cell now")
        out.append(entry)
    return out


def _offer_key(location: Any, col_iso: Any, giver: Any) -> tuple[str, str, str]:
    """An open offer's cell: the house, the day and whose shift it is — as the unique index keys it."""
    return str(location or ""), str(col_iso or ""), sr.fold(giver)


def _offered_and_called(dsn: str, *, where: str, args: tuple
                        ) -> tuple[dict[tuple[str, str, str], dict[str, Any]], dict[str, str],
                                   set[tuple[str, str, str]]]:
    """The offers already waiting on a set of cells, and the shifts that were called off — each keyed by the…"""
    rows, states = rows_for(dsn, where=where, args=args)
    offered = {_offer_key(r["location"], r["col_iso"], r["from_staff"]): r for r in rows}
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        sr._ddl(cur)
        cur.execute("SELECT location, col_iso, open_row FROM asa_shift_pool "
                    "WHERE kind=%s AND filled_by=''", (sr.KIND_CALLOFF,))
        called = {(r["location"], r["col_iso"], sr.fold(r["open_row"])) for r in cur.fetchall()}
    return offered, states, called


def _upcoming_by_house(view: dict[str, Any], now: datetime,
                       until: datetime) -> dict[str, list[dict[str, Any]]]:
    """The estate's roster shifts in the window, by house — walked ONCE, not once per house."""
    by: dict[str, list[dict[str, Any]]] = {}
    for spans in (view.get("spans") or {}).values():
        for h in spans:
            if h.get("source") == "roster" and now < h["span"][0] <= until:
                by.setdefault(str(h.get("location") or ""), []).append(h)
    return by


def house_shifts(dsn: str, location: str, who: dict[str, Any], *,
                 view: dict[str, Any] | None = None, now: datetime | None = None,
                 days: int | None = None, held: list[dict[str, Any]] | None = None,
                 offers: tuple | None = None) -> list[dict[str, Any]]:
    """One house's upcoming shifts, each with whether it may be handed over — the picker's list."""
    location = str(location or "").strip()
    if not location:
        return []
    now = now or _now()
    if held is None:
        view = view or sr.estate(dsn)
        until = now + timedelta(days=MY_SHIFTS_DAYS if days is None else days)
        held = _upcoming_by_house(view, now, until).get(location, [])
    if not held:
        return []
    offered, states, called = offers or _offered_and_called(
        dsn, where="state=%s AND location=%s", args=(PENDING, location))
    out = []
    for h in sorted(held, key=lambda x: (x["span"][0], str(x.get("employee") or ""))):
        person = str(h.get("employee") or "")
        if placeholder(person, location) or _is_open_row(person):
            continue
        cell = _offer_key(location, h["col_iso"], person)
        entry = {"location": location, "house": sr.short_house(location), "employee": person,
                 "col_iso": h["col_iso"], "value": h["value"], "start": _iso(h["span"][0]),
                 "end": _iso(h["span"][1]), "may_transfer": True, "why": "", "offer": None}
        if cell in offered:
            r = offered[cell]
            entry.update(may_transfer=False, why="offered — waiting on the answers",
                         offer=describe(r, who, training_state=states.get(
                             str(r.get("training_request") or ""), "")))
        elif (location, h["col_iso"], sr.fold(person)) in called:
            entry.update(may_transfer=False,
                         why="this shift was called off — it is given from its red cell now")
        out.append(entry)
    return out


def swaps_feed(dsn: str, who: dict[str, Any], *, now: datetime | None = None) -> dict[str, Any]:
    """Everything the Swaps tab draws: the shifts to pick from, the directors, and the company's history."""
    now = now or _now()
    me = str((who or {}).get("name") or "").strip()
    view = sr.estate(dsn)
    # FAIL-CLOSED: a read that failed offers no house AND says so — never an empty list.
    unread: list[str] = []
    try:
        houses = house_directory.read(dsn)
    except Exception as exc:  # noqa: BLE001
        houses = {}
        unread.append(f"the house directory could not be read ({type(exc).__name__})")
    # A colleague's shift is opened by the manager of its house and nobody else, so the houses offered are the ones…
    managers = sr.house_managers(dsn) if me else {"readable": True}
    if not managers.get("readable"):
        unread.append(f"who manages which house could not be read "
                      f"({managers.get('why') or 'no reason given'}) — the houses you manage are "
                      f"not listed")
        mine_codes: set[str] = set()
    else:
        mine_codes = set(sr.houses_managed(dsn, me)) if me else set()
    # The estate carries rows that are not houses; only a code the directory knows is offered.
    places = [loc for loc in (view.get("locations") or [])
              if (house_directory.code_of(loc) or "") in houses]
    managed = [loc for loc in places if (house_directory.code_of(loc) or "") in mine_codes]

    try:
        mine = my_shifts(dsn, who, view=view, now=now) if me else []
        mine_why = ""
    except Exception as exc:  # noqa: BLE001
        mine, mine_why = [], f"your upcoming shifts could not be read ({type(exc).__name__})"
    by_house: list[dict[str, Any]] = []
    by_house_why = "; ".join(unread)
    try:
        # ONE read of the offers and the call-offs for the whole screen, and ONE walk of the estate: a director…
        upcoming = _upcoming_by_house(view, now, now + timedelta(days=MY_SHIFTS_DAYS))
        offers = _offered_and_called(dsn, where="state=%s", args=(PENDING,)) if managed else None
        for loc in managed:
            by_house += house_shifts(dsn, loc, who, view=view, now=now,
                                     held=upcoming.get(loc, []), offers=offers)
    except Exception as exc:  # noqa: BLE001
        by_house = []
        by_house_why = "; ".join([*unread, f"the house's shifts could not be read "
                                           f"({type(exc).__name__})"])

    whole = bool((who or {}).get("whole_company"))
    rows, states = rows_for(dsn)
    history = []
    for r in rows:
        d = describe(r, who, training_state=states.get(str(r.get("training_request") or ""), ""))
        seen = whole or d["mine"] or sr.sees_house(who or {}, str(r.get("location") or ""))
        if seen:
            history.append(d)
    return {"me": me, "directors": directors_for(dsn),
            "my_shifts": mine, "my_shifts_why": mine_why,
            "house_shifts": by_house, "house_shifts_why": by_house_why,
            "houses": [{"location": loc, "house": sr.short_house(loc),
                        "code": house_directory.code_of(loc)} for loc in managed],
            "history": history, "whole_company": whole, "at": _iso(now)}


# ── what the message door is owed ────────────────────────────────────────── Each kind maps to a Smart Comms…
KIND_ASK_STAFF = "handoff_ask_staff"
KIND_ASK_MANAGER = "handoff_ask_manager"
KIND_ASK_ABOVE = "handoff_ask_above"
KIND_ASK_DIRECTOR = "handoff_ask_director"
KIND_DONE = "handoff_done"
KIND_DONE_TAKER = "handoff_done_taker"
KIND_DONE_MANAGER = "handoff_done_manager"
KIND_DONE_DIRECTOR = "handoff_done_director"
KIND_DEAD = "handoff_declined"
KIND_DEAD_TAKER = "handoff_declined_taker"
KIND_DEAD_MANAGER = "handoff_declined_manager"
KIND_DEAD_DIRECTOR = "handoff_declined_director"
ASK_KINDS = (KIND_ASK_STAFF, KIND_ASK_MANAGER, KIND_ASK_ABOVE, KIND_ASK_DIRECTOR)
KINDS = (*ASK_KINDS, KIND_DONE, KIND_DONE_TAKER, KIND_DONE_MANAGER, KIND_DONE_DIRECTOR,
         KIND_DEAD, KIND_DEAD_TAKER, KIND_DEAD_MANAGER, KIND_DEAD_DIRECTOR)

_SAID = "said"

# staffShiftReminder's answers; refused_quiet and dial_unknown write nothing, anything unknown retries.
FINAL = frozenset({"told", "duplicate", "opted_out"})
# the door's own words for a message written down instead of said
REHEARSAL = frozenset({"recorded", "rehearsed", "redirected"})
NOT_NOW = frozenset({"refused_quiet", "dial_unknown"})
RETRY_MIN = float(os.getenv("HUB_HANDOFF_ASK_RETRY_MIN", "60"))

_DIAL: dict[str, Any] = {"word": "", "test_mode": "", "at": ""}
_DIAL_LOCK = threading.Lock()


def note_dial(word: Any, test_mode: Any = "") -> None:
    w = str(word or "").strip().lower()
    if not w or w == "unknown":
        return
    with _DIAL_LOCK:
        _DIAL.update(word=w, test_mode=str(test_mode or "").strip().lower(), at=_iso(_now()))


def dial_seen() -> dict[str, Any]:
    with _DIAL_LOCK:
        return dict(_DIAL)


def _owed_again(entry: Any, now: datetime) -> bool:
    if entry is None:
        return True
    if isinstance(entry, str):
        return False
    state = str(entry.get("state") or "")
    if state in FINAL:
        return False
    dial = dial_seen()
    if state in REHEARSAL:
        if dial["word"] != "send":
            return False
        if str(entry.get("dial") or "") != "send":
            return True
        return bool(entry.get("test_mode")) and dial["test_mode"] == "off" \
            and entry.get("test_mode") != "off"
    if state == "dial_off":
        return bool(dial["word"]) and dial["word"] != "off"
    at = psi_reminders._instant(entry.get("at"))
    return at is None or (now - at).total_seconds() >= RETRY_MIN * 60.0


DIRECTOR_KINDS = (KIND_ASK_DIRECTOR, KIND_DONE_DIRECTOR, KIND_DEAD_DIRECTOR)


def _seat(kind: str, name: str) -> str:
    """A director's message carries the name it is for (time_off.said_id's shape): EVERY name on the list is…"""
    key = sr.fold(name)
    return f"{kind}:{key}" if key else kind


def _kind_of(slug: str) -> str:
    return str(slug or "").partition(":")[0]


def _who_of(slug: str) -> str:
    return str(slug or "").partition(":")[2]


def _reached(said: dict[str, Any], kind: str) -> bool:
    """Any seat of this message that the door reached."""
    return any(_ask_state(v)["reached"] for k, v in said.items() if _kind_of(k) == kind)


def _ask_seen(said: dict[str, Any], kind: str) -> dict[str, Any]:
    """One ask's outcome over all its seats: a seat that reached somebody speaks for it."""
    seen = [v for k, v in said.items() if _kind_of(k) == kind]
    for entry in seen:
        if _ask_state(entry)["reached"]:
            return _ask_state(entry)
    return _ask_state(seen[0] if seen else None)


def _wanted(row: dict[str, Any], said: dict[str, Any]) -> list[str]:
    state = row.get("state")
    above = row.get("approval") == BY_ABOVE or (not row.get("approval")
                                                and not row.get("house_manager"))
    by_hm = not above and bool(row.get("house_manager"))
    want: list[str] = []
    board = director_names(row)
    if state == PENDING:
        if row.get("staff_state") == PENDING:
            want.append(KIND_ASK_STAFF)
        if row.get("manager_state") == PENDING:
            want.append(KIND_ASK_ABOVE if above else KIND_ASK_MANAGER)
        if board and str(row.get("director_state") or PENDING) == PENDING:
            # EVERY director is asked: any of them may approve, so a swap never waits on one name being at their…
            want += [_seat(KIND_ASK_DIRECTOR, n) for n in board
                     if not _gave(row, "manager_by", n)]
        return want
    asked_staff = _reached(said, KIND_ASK_STAFF) or row.get("staff_state") == ACCEPTED
    asked_hm = _reached(said, KIND_ASK_MANAGER) or row.get("manager_state") == APPROVED
    reached_dir = [n for n in board
                   if _ask_state(said.get(_seat(KIND_ASK_DIRECTOR, n)))["reached"]]
    # A director who answered on the Hub was never texted, and is still owed the outcome.
    told_dir = reached_dir or [n for n in board if _named_as(row.get("director_by"), n)]
    if state == DONE:
        want += [KIND_DONE, KIND_DONE_TAKER]
        if by_hm:
            want.append(KIND_DONE_MANAGER)
        want += [_seat(KIND_DONE_DIRECTOR, n) for n in told_dir]
    elif state == DEAD:
        if sr.fold(row.get("closed_by")) != sr.fold(row.get("from_staff")):
            want.append(KIND_DEAD)
        if row.get("staff_state") != DECLINED and asked_staff:
            want.append(KIND_DEAD_TAKER)
        if by_hm and row.get("manager_state") != NOT_APPROVED and asked_hm:
            want.append(KIND_DEAD_MANAGER)
        # Every director the ask reached is told it closed — but never the one whose no closed it.
        said_no = row.get("director_state") == NOT_APPROVED
        want += [_seat(KIND_DEAD_DIRECTOR, n) for n in told_dir
                 if not (said_no and _named_as(row.get("director_by"), n))]
    return want


def _recipient(row: dict[str, Any], slug: str) -> str:
    kind = _kind_of(slug)
    if kind in (KIND_ASK_STAFF, KIND_DONE_TAKER, KIND_DEAD_TAKER):
        return str(row.get("to_staff") or "")
    if kind in (KIND_ASK_MANAGER, KIND_DONE_MANAGER, KIND_DEAD_MANAGER):
        return str(row.get("house_manager") or "")
    if kind in DIRECTOR_KINDS:
        names = director_names(row)
        want = _who_of(slug)
        if not want:
            return names[0] if names else ""
        return next((n for n in names if sr.fold(n) == want), "")
    if kind in (KIND_DONE, KIND_DEAD):
        return str(row.get("from_staff") or "")
    return ""


def door_row(row: dict[str, Any], kind: str, house_names: dict[str, str] | None = None,
             people: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    loc = str(row.get("location") or "")
    code = house_directory.code_of(loc) or loc
    span = sr.span_of(str(row.get("col_iso") or ""), str(row.get("value") or ""))
    start = row.get("shift_start") or (span[0] if span else None)
    training = _json(row.get("training"))
    who = _recipient(row, kind)
    if _kind_of(kind) in DIRECTOR_KINDS and who and people:
        # The list may spell a director its own way (a middle initial); the door finds the person by the People…
        import time_off  # noqa: PLC0415 — lazy: time_off asks this file back
        who = time_off.people_spelling(who, people)
    return {
        # The id carries the seat; the kind stays the situation the door knows.
        "id": f"{row['id']}:{kind}", "kind": _kind_of(kind), "handoff_id": row["id"],
        "location": loc, "house": code,
        "house_name": (house_names or {}).get(code) or sr.short_house(loc),
        "col_iso": row.get("col_iso") or "", "day": row.get("col_iso") or "",
        "shift_at": start.astimezone(sr.OHIO).isoformat() if hasattr(start, "astimezone") else "",
        "shift_code": row.get("value") or "", "value": row.get("value") or "",
        "from_staff": row.get("from_staff") or "", "to_staff": row.get("to_staff") or "",
        "taker": row.get("to_staff") or "", "person": who, "to_name": who,
        "house_manager": row.get("house_manager") or "",
        "manager_phone": row.get("manager_phone") or "",
        "approvers": _names(row.get("approvers")), "approval": row.get("approval") or "",
        "directors": director_names(row),
        "director": who if _kind_of(kind) in DIRECTOR_KINDS else (director_names(row) or [""])[0],
        "approval_why": row.get("approval_why") or "",
        "why": row.get("why") or "", "status": row.get("why") or "",
        "training": str(training.get("why") or "") if training.get("needed") else "",
        "offered_by": row.get("offered_by") or "",
    }


def _people_rows() -> list[dict[str, Any]]:
    """The People house's rows, for a director's spelling."""
    import time_off  # noqa: PLC0415 — lazy: time_off asks this file back
    try:
        return time_off.people_rows()
    except Exception:  # noqa: BLE001
        return []


def owed(dsn: str, *, limit: int = 40, now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or _now()
    if psi_reminders.quiet(now):
        return []
    ensure_tables(dsn)
    try:
        names = {c: h.get("name") or "" for c, h in house_directory.read(dsn).items()}
    except Exception:  # noqa: BLE001 — the house's short name travels instead
        names = {}
    out: list[dict[str, Any]] = []
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(HANDOFFS_DDL)
        cur.execute("SELECT * FROM asa_shift_handoffs "
                    "WHERE state=%s OR closed_at > now() - interval '1 day' "
                    "ORDER BY created_at LIMIT 200", (PENDING,))
        rows = [dict(r) for r in cur.fetchall()]
    rehearsed = sr.messages_rehearsed()
    people: list[dict[str, Any]] | None = None
    for row in rows:
        if not rehearsed and is_rehearsed(row):
            # a rehearsed transfer asks nobody: outside the rehearsal's sandbox it is never a message
            continue
        said = _said(row)
        for kind in _wanted(row, said):
            if not _owed_again(said.get(kind), now):
                continue
            if people is None and _kind_of(kind) in DIRECTOR_KINDS:
                people = _people_rows()
            out.append(door_row(row, kind, names, people))
            if len(out) >= limit:
                return out
    return out


def mark_said(dsn: str, ids: list[str], results: dict[str, Any]) -> int:
    """Record only what the door answered per row; "not now" stays owed."""
    dial = str(results.get("dial") or "")
    test_mode = str(results.get("test_mode") or "")
    note_dial(dial, test_mode)
    by_id = {str(r.get("id")): r for r in (results.get("results") or []) if isinstance(r, dict)}
    done = 0
    stamp = _iso(_now())
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(HANDOFFS_DDL)
        for key in ids:
            # 'HO…:handoff_ask_director:1' — the seat travels with the key and is kept apart, or the second…
            hid, _, kind = str(key).partition(":")
            got = by_id.get(str(key))
            if not hid or _kind_of(kind) not in KINDS or not got:
                continue
            state = str(got.get("state") or "failed")
            if state in NOT_NOW:
                continue
            cur.execute("SELECT said FROM asa_shift_handoffs WHERE id=%s", (hid,))
            held = cur.fetchone()
            if not held:
                continue
            before = _json(held["said"]).get(kind)
            tries = int(before.get("tries") or 0) + 1 if isinstance(before, dict) else 1
            entry = {"state": state, "why": str(got.get("why") or "")[:300], "at": stamp,
                     "dial": dial, "test_mode": test_mode, "tries": tries}
            if got.get("phone_key"):
                entry["phone_key"] = str(got["phone_key"])
            cur.execute("UPDATE asa_shift_handoffs SET said = said || jsonb_build_object(%s, "
                        "%s::jsonb) WHERE id=%s", (kind, json.dumps(entry), hid))
            done += cur.rowcount
        conn.commit()
    return done



def asked_by_text(row: dict[str, Any], phone_key: str, before: datetime,
                  kind: str = KIND_ASK_STAFF) -> bool:
    return asked_at(row, phone_key, before, kind) is not None


def asked_at(row: dict[str, Any], phone_key: str, before: datetime,
             kind: str = KIND_ASK_STAFF) -> datetime | None:
    """When this ask reached this phone, if it did before `before`."""
    said = _said(row)
    if kind in DIRECTOR_KINDS:
        entries = [v for k, v in said.items() if _kind_of(k) == kind]
    else:
        entries = [said.get(kind)]
    best: datetime | None = None
    for entry in entries:
        if not isinstance(entry, dict) or str(entry.get("state") or "") not in DELIVERED:
            continue
        if not phone_key or str(entry.get("phone_key") or "") != phone_key:
            continue
        at = psi_reminders._instant(entry.get("at"))
        if at is not None and at <= before and (best is None or at > best):
            best = at
    return best


def claimed_replies(dsn: str, pairs: list[tuple]) -> set[tuple[str, datetime]]:
    """Replies a newer swap ask claims from the shift flow (ties are claimed); raises when offers cannot be read."""
    triples = [(p[0], p[1], p[2] if len(p) > 2 else None) for p in pairs]
    keys = sorted({k for k, _w, _a in triples if k})
    if not keys:
        return set()
    ensure_tables(dsn)
    with _connect(dsn) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(HANDOFFS_DDL)
        cur.execute("SELECT said, staff_at, closed_at FROM asa_shift_handoffs "
                    "WHERE said->%s->>'phone_key' = ANY(%s)", (KIND_ASK_STAFF, keys))
        rows = [dict(r) for r in cur.fetchall()]
    out: set[tuple[str, datetime]] = set()
    for key, when, shift_asked in triples:
        for r in rows:
            entry = _said(r).get(KIND_ASK_STAFF) or {}
            if str(entry.get("phone_key") or "") != key:
                continue
            at = asked_at(r, key, when)
            if at is None:
                continue
            if shift_asked is not None and at < shift_asked:
                continue
            if (r.get("staff_at") is None or r["staff_at"] >= when) \
                    and (r.get("closed_at") is None or r["closed_at"] >= when):
                out.add((key, when))
                break
    return out
