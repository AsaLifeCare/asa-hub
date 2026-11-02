"""My Calendar (server/my_calendar.py) off asa-hub-db: one person's week of shifts and their own time off requests,
the sheets read with Python's own edits laid and the relay's own state through mw_relay_state. Two reads:
myCalendarView builds the answer for the scope the relay decided, myCalendarCheck the pencil's dry run."""
from __future__ import annotations

import contextlib
import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterator

import gsjs
import hubdb
import locations as L
import mw_relay_state as relay_state
import mw_roster
import mw_shifts
import mw_time_off as time_off
import my_profile as mp
import my_work as mw
import scope as sc
from scope import Defer

log = logging.getLogger("asa-hub-app")

# the relay modules my_calendar stood on, under the names it called them by
sr = mw_shifts.sr
shift_handoff = mw_shifts.handoff
effective_roster = mw_roster.effective_roster
house_cal_live = mw_roster.house_cal_live
house_directory = mw_roster.house_directory
shift_slices = mw_roster.shift_slices

APP_ID = "my-calendar"
CORE_USERS_SHEET_ID = mw.CORE_USERS_SHEET_ID
# what this service cannot read defers to the relay, never a sentence of its own
_LOUD = (Defer, hubdb.Unreadable)

UTC = timezone.utc
MODE_OWN, MODE_MASS = mw.MODE_OWN, mw.MODE_MASS
STATE_READY, STATE_UNREADABLE, STATE_NOT_ATTRIBUTABLE = mw.STATE_READY, mw.STATE_UNREADABLE, mw.STATE_NOT_ATTRIBUTABLE

WEEK_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# how many weeks either side of the Ohio today's week may be asked for
WEEK_REACH = 53
# the copy job calls its own copy stale after this long
STALE_S = 35 * 60

DAY_SHIFTS, DAY_OFF, DAY_NONE = "shifts", "off", "none"
DAY_NOT_DRAWN, DAY_NOT_LISTED, DAY_UNREADABLE = "not_drawn", "not_listed", "unreadable"
# a sheet's weekday word by its first two letters (SAT, SUN, MON, TUE/TUES, WED, THU/THUR, FRI), Monday first
WEEKDAY2 = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")

G_PENDING, G_ONGOING, G_UPCOMING, G_CONCLUDED = "pending", "ongoing", "upcoming", "concluded"
GROUP_ORDER = (G_PENDING, G_ONGOING, G_UPCOMING, G_CONCLUDED)
SCHEDULED_WORDS = {G_UPCOMING: "Approved", G_ONGOING: "On now", G_CONCLUDED: "Taken"}
OPEN_STATUSES = (time_off.PENDING, time_off.REVIEW)

M_PENDING, M_TEST_MODE, M_REHEARSAL = "pending_publish", "test_mode", "rehearsal"
M_CALLED_OFF, M_COVERED, M_OFFERED = "called_off", "covered", "offered"
M_OFF_SCHEDULED, M_OFF_ASKED = "off_scheduled", "off_asked"
MARK_WORDS = {
    M_PENDING: "Just published, the workbook copy has not caught up",
    M_TEST_MODE: "Held by test mode, not on the workbook",
    M_REHEARSAL: "Rehearsal square, not a real shift",
    M_CALLED_OFF: "Called off",
    # never who covered it
    M_COVERED: "Covered by another staff member",
    M_OFFERED: "Offered to another staff member, still yours until accepted",
}

WITHDRAW_STARTED = "It has started. Only a director or an administrator cancels it, in Time Off."
WITHDRAW_NOT_YOURS = "Only the person or whoever filed it withdraws a request."
NOT_YOURS_CHOSEN = ("Only the person or whoever filed it changes it; a director cancels an approved one in "
                    "Time Off.")
WITHDRAW_WARNS = ("Both approvals are dropped. OPEN or R/O squares already staged on the house calendar stay "
                  "until the house manager changes them.")
EDIT_WARNS_SCHEDULED = ("Changing the dates sends this request for approval again; both approvals start over. "
                        "OPEN or R/O squares already staged on the house calendar stay until the house manager "
                        "changes them.")
EDIT_SCHEDULED_STARTED = "It has started, so its dates are not changed here."
EDIT_STARTED = "It has started. A director or an administrator changes it."
EDIT_NO_DATES = "Its dates could not be read, so it is changed in Time Off."
NO_KEY_WHY = "No name that is yours alone is on file, so nothing on a calendar can be tied to you."
NOT_ON_ROSTER = "This account is not on a roster, so ask your house manager to file the time off."
FILES_NONE = "This account files no time off."
SPELLED_ELSEWHERE = ("A request filed here would be filed under a spelling of your name this screen does not read "
                     "back, so file it in Time Off.")
SPELLED_ELSEWHERE_CHOSEN = ("A request filed here would be filed under a spelling of this person's name this screen "
                            "does not read back, so file it in Time Off.")
SPELLING_UNREAD = ("The house calendars could not be read, so the spelling a request would be filed under cannot be "
                   "checked; file it in Time Off.")

# Settings › Editions (app/editions.py): who else opens any person's calendar beside the master
EDITION = "myCalendar.anyone"
EDITION_WHY = ("Your own calendar, or any person's you choose; a request you add there is filed for them, by you, "
               "where Time Off lets you file for them.")


class BadWeek(ValueError):
    """A week the door cannot read, or one too far from today."""


def _sentence(text: Any) -> str:
    t = str(text or "").strip()
    return (t[:1].upper() + t[1:]) if t else ""


def _what(exc: BaseException) -> str:
    return type(exc).__name__


# ── the week ────────────────────────────────────────────────────────────────

def today() -> date:
    return mw.today()


def week_of(day: date) -> tuple[date, date]:
    """(Monday, Sunday) of the week holding `day`."""
    mon = day - timedelta(days=day.weekday())
    return mon, mon + timedelta(days=6)


def in_reach(mon: date, on: date) -> bool:
    return abs((mon - week_of(on)[0]).days) <= WEEK_REACH * 7


def parse_week(raw: Any, on: date) -> date:
    """The Monday of the week asked for (blank: this week); BadWeek for anything else."""
    text = str(raw or "").strip()
    if not text:
        return week_of(on)[0]
    if not WEEK_RE.fullmatch(text):
        raise BadWeek("A week is asked for by one of its days, written YYYY-MM-DD.")
    try:
        day = date.fromisoformat(text)
    except ValueError:
        raise BadWeek("That day is not on the calendar.") from None
    mon = week_of(day)[0]
    if not in_reach(mon, on):
        raise BadWeek(f"My Calendar shows the weeks up to {WEEK_REACH} weeks from this one.")
    return mon


def misdated(grids: list[tuple[str, dict[str, Any]]]) -> dict[tuple[str, str], str]:
    """(location, col_iso) of every column whose date and the sheet's own weekday word disagree → the nearby day
    carrying that word, which the column may really be."""
    out: dict[tuple[str, str], str] = {}
    for loc, grid in grids:
        cols = (grid or {}).get("cols") or []
        for iso, col in zip(house_cal_live.col_isos(grid or {}), cols):
            word = str((col or {}).get("weekday") or "").strip().upper()[:2]
            d = sr.day_of(iso)
            if d is None or word not in WEEKDAY2 or WEEKDAY2[d.weekday()] == word:
                continue
            # within three days either side exactly one day carries that word
            near = next(d + timedelta(days=k) for k in (-1, 1, -2, 2, -3, 3)
                        if (d + timedelta(days=k)).weekday() == WEEKDAY2.index(word))
            out[(loc, iso)] = near.isoformat()
    return out


def _misdated_words(loc: str) -> str:
    return (f"{sr.short_house(loc)}'s calendar has a column whose date and weekday disagree, so what it holds "
            f"for this day is not shown.")


def _house_token(loc: str) -> str:
    """The token other grids write for this house (house_cal_live.house_tokens' own rule)."""
    parts = [p.strip() for p in str(loc or "").split(" - ")]
    return parts[1].upper() if len(parts) >= 2 and parts[1] else ""


def _hours(span: tuple[datetime, datetime] | None) -> float | None:
    """Elapsed hours, so a night across a clock change counts the hour it gains or loses."""
    if span is None:
        return None
    return round((span[1].astimezone(UTC) - span[0].astimezone(UTC)).total_seconds() / 3600.0, 2)


def _card(loc: str, iso: str, text: str, got: dict[str, Any], n: int, *, homes: dict[str, dict[str, str]],
          managers: dict[str, Any]) -> dict[str, Any]:
    ess = sr.essentials(loc, iso, text, homes=homes, managers=managers)
    ess.pop("deciders", None)
    ess.pop("col_iso", None)
    span = sr.span_of(iso, text)
    return {"id": f"{ess['code']}:{iso}:{n}", "iso": iso, "kind": got["kind"], **ess,
            "hours": _hours(span), "hours_known": span is not None,
            # classify's own meaning: a night runs past midnight (an end past 24); a shift ending at 12A is not one
            "overnight": span is not None and float(got.get("end") or 0) > 24,
            "also": [], "marks": []}


def _off_intervals(rows: list[dict[str, Any]] | None) -> list[tuple[date, date, str, str]]:
    """(first day, last day, scheduled | asked, ref) of the person's live requests."""
    out = []
    for r in rows or []:
        st = r.get("status")
        if st != time_off.SCHEDULED and st not in OPEN_STATUSES:
            continue
        a, b = time_off.day_of(r.get("start_date")), time_off.day_of(r.get("end_date"))
        if a is None or b is None or b < a:
            continue
        out.append((a, b, "scheduled" if st == time_off.SCHEDULED else "asked", str(r.get("id") or "")))
    return out


def _day_off(d: date, intervals: list[tuple[date, date, str, str]]) -> dict[str, str] | None:
    hit = None
    for a, b, state, ref in intervals:
        if a <= d <= b and (hit is None or (state == "scheduled" and hit["state"] != "scheduled")):
            hit = {"state": state, "ref": ref}
    return hit


def _marks(loc: str, emp: str, iso: str, text: str, kind: str, *, pub: dict, offs: dict, offered: set,
           intervals: list[tuple[date, date, str, str]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    c = pub.get((loc, sr.fold(emp), iso))
    if c:
        # its own name: the classify kind must still reach the R/O check below
        pk = (M_REHEARSAL if c.get(effective_roster.REHEARSAL) else M_TEST_MODE if c.get("test_mode")
              else M_PENDING if c.get("pending") else "")
        if pk:
            out.append({"kind": pk, "words": MARK_WORDS[pk]})
    p = offs.get((loc, iso))
    if p is not None:
        out.append({"kind": M_CALLED_OFF, "words": MARK_WORDS[M_CALLED_OFF]})
        if str(p.get("filled_by") or "").strip():
            out.append({"kind": M_COVERED, "words": MARK_WORDS[M_COVERED]})
    if (loc, iso) in offered:
        out.append({"kind": M_OFFERED, "words": MARK_WORDS[M_OFFERED]})
    if kind == "ro":
        # an R/O square is the time off itself (an approval stages it); the day's off band already says so
        return out
    d = sr.day_of(iso)
    has_hours = sr.span_of(iso, text) is not None
    hit = None
    for a, b, state, ref in intervals:
        covers = time_off.clashes(iso, text, a, b) if has_hours else (d is not None and a <= d <= b)
        if covers and (hit is None or (state == "scheduled" and hit[0] != "scheduled")):
            hit = (state, ref)
    if hit and hit[0] == "scheduled":
        # shift_requests.displaced_by: hours still on the calendar during scheduled time off
        words = (f"On approved time off ({hit[1]}), and still on the calendar under this name" if has_hours
                 else f"Approved time off ({hit[1]}) covers this day")
        out.append({"kind": M_OFF_SCHEDULED, "ref": hit[1], "words": words})
    elif hit:
        out.append({"kind": M_OFF_ASKED, "ref": hit[1], "words": f"Time off asked ({hit[1]}), not decided yet"})
    return out


def shifts(view: dict[str, Any], grids: list[tuple[str, dict[str, Any]]], keys: set[str] | list[str], mon: date,
           sun: date, *, tokens: set[str], homes: dict[str, dict[str, str]], managers: dict[str, Any],
           published: list[dict[str, Any]] | None = None, pool: list[dict[str, Any]] | None = None,
           handoffs: list[dict[str, Any]] | None = None, off_rows: list[dict[str, Any]] | None = None,
           you: bool = True) -> list[dict[str, Any]]:
    """One entry per day, Monday to Sunday, cut to `keys`: pure over what was read."""
    keys = {k for k in keys if k}
    bad_map = misdated(grids)
    bad = set(bad_map)
    unsure = bad | {(loc, near) for (loc, _iso), near in bad_map.items()}
    locs = list(view.get("locations") or [])
    isos_of = view.get("isos") or {}
    people = view.get("people") or {}
    listed = [loc for loc in locs if any(sr.fold(n) in keys and not sr.not_a_person(n, loc)
                                         for n in people.get(loc, []))]
    mine: dict[date, list[tuple[str, str, str, str]]] = {}
    for loc in locs:
        for (emp, iso), text in (view.get("cells") or {}).get(loc, {}).items():
            if sr.fold(emp) not in keys or sr.not_a_person(emp, loc) or (loc, iso) in bad:
                continue
            d = sr.day_of(iso)
            if d is not None and mon <= d <= sun:
                mine.setdefault(d, []).append((loc, emp, iso, text))
    pub = {(str(c.get("location") or ""), sr.fold(c.get("employee")), str(c.get("col_iso") or "")): c
           for c in published or []}
    # a call-off the caller took back is none (shift_requests.overlay_call_offs)
    offs = {(str(p.get("location") or ""), str(p.get("col_iso") or "")[:10]): p
            for p in pool or [] if sr.fold(p.get("open_row")) in keys
            and sr.fold(p.get("filled_by")) != sr.fold(p.get("open_row"))}
    offered = {(str(h.get("location") or ""), str(h.get("col_iso") or "")) for h in handoffs or []
               if h.get("state") == shift_handoff.PENDING and sr.fold(h.get("from_staff")) in keys
               and not shift_handoff.is_rehearsed(h)}
    intervals = _off_intervals(off_rows)
    drawn_days = sorted({d for loc in listed for iso in isos_of.get(loc, []) if (loc, iso) not in bad
                         for d in [sr.day_of(iso)] if d is not None})
    who = "you" if you else "this person"
    out = []
    d = mon
    while d <= sun:
        iso = d.isoformat()
        notes = [_misdated_words(loc) for loc in listed if (loc, iso) in unsure]
        hours_cards: list[tuple[str, dict[str, Any]]] = []
        others: list[tuple[str, str, str, str, dict[str, Any]]] = []
        off_cell = False
        n = 0
        for loc, emp, ciso, text in sorted(mine.get(d, []), key=lambda c: (c[0], c[1])):
            got = shift_slices.classify(text)
            if not got:
                continue
            if got["kind"] == "off":
                off_cell = True
                continue
            if got["kind"] in ("alias", "ro"):
                others.append((loc, emp, ciso, text, got))
                continue
            card = _card(loc, ciso, text, got, n, homes=homes, managers=managers)
            card["marks"] = _marks(loc, emp, ciso, text, got["kind"], pub=pub, offs=offs, offered=offered,
                                   intervals=intervals)
            hours_cards.append((loc, card))
            n += 1
        cards = [c for _loc, c in hours_cards]
        for loc, emp, ciso, text, got in others:
            token = str(got.get("token") or "")
            if got["kind"] == "alias" and hours_cards and house_cal_live._names_a_house(token, tokens):
                # another grid's pointer to where the hours are, on the card of the house it names
                links = {p.strip().upper() for p in token.replace(">", ";").replace("<", ";").split(";")}
                home = next((c for at, c in hours_cards if _house_token(at) in links), None)
                if home is not None:
                    home["also"].append({"house": sr.short_house(loc), "token": token})
                    continue
            card = _card(loc, ciso, text, got, n, homes=homes, managers=managers)
            card["marks"] = _marks(loc, emp, ciso, text, got["kind"], pub=pub, offs=offs, offered=offered,
                                   intervals=intervals)
            cards.append(card)
            n += 1
        cards.sort(key=lambda c: (c["shift_start"] or "~", c["house"], c["id"]))
        why = ""
        if cards:
            state = DAY_SHIFTS
        elif off_cell:
            state = DAY_OFF
        elif not listed:
            state, why = DAY_NOT_LISTED, f"{_sentence(who)} {'are' if you else 'is'} not on any house calendar."
        elif notes:
            state, why = DAY_UNREADABLE, " ".join(notes)
        elif any(iso in isos_of.get(loc, []) for loc in listed):
            state = DAY_NONE
        else:
            state = DAY_NOT_DRAWN
            if drawn_days and d > drawn_days[-1]:
                why = f"No house calendar that lists {who} shows this day yet."
            elif drawn_days and d < drawn_days[0]:
                why = f"No house calendar that lists {who} still shows this day."
            else:
                why = f"No house calendar that lists {who} shows this day."
        out.append({"iso": iso, "state": state, "why": why, "cards": cards, "off": _day_off(d, intervals),
                    "notes": notes})
        d += timedelta(days=1)
    return out


# ── the reads the week stands on ────────────────────────────────────────────

def read_grids(src: Any) -> tuple[list[tuple[str, dict[str, Any]]], Any]:
    """Every house calendar's grid (for its weekday words) and the copy's newest stamp."""
    rows = relay_state.rows("asa_house_calendar_live", columns=("location", "grid", "updated_at"))
    stamps = [r.get("updated_at") for r in rows if r.get("updated_at") is not None]
    return ([(str(r.get("location")), house_cal_live._as_dict(r.get("grid"))) for r in rows],
            (max(stamps) if stamps else None))


def read_published(src: Any, mon: date, sun: date) -> list[dict[str, Any]]:
    """The week's just-published, held and rehearsed cells: the relay's own when it handed them in."""
    return effective_roster.published(src, mon, sun)


HANDOFFS_WHERE = (f"state=%s AND {mw._FOLD_COL.format('from_staff')} = ANY(%s) "
                  "AND col_iso >= %s AND col_iso <= %s")


def read_handoffs(src: Any, keys: list[str], mon: date, sun: date) -> list[dict[str, Any]]:
    """The person's pending transfer offers in the week: a plain read, the table's upkeep left to its writers."""
    return relay_state.rows("asa_shift_handoffs", HANDOFFS_WHERE,
                            (shift_handoff.PENDING, list(keys) or [mw.NO_KEY], mon.isoformat(), sun.isoformat()),
                            order="created_at DESC", limit=mw.HANDOFF_LIMIT)


READERS: dict[str, Callable[..., Any]] = {
    "estate": lambda src: sr.estate(src),
    "grids": lambda src: read_grids(src),
    "tokens": lambda src: house_cal_live.house_tokens(src),
    "published": lambda src, mon, sun: read_published(src, mon, sun),
    "pool": lambda db, days, keys: db.call_off_pool(days, keys),
    "handoffs": lambda src, keys, mon, sun: read_handoffs(src, keys, mon, sun),
    "homes": lambda src: house_directory.read(src),
}


def _stamp(at: Any) -> datetime | None:
    if isinstance(at, datetime):
        return at if at.tzinfo else at.replace(tzinfo=UTC)
    return mw._instant(at)


def week_part(src: Any, keys: set[str], mon: date, sun: date, *, key_why: str, off_rows: list[dict] | None,
              off_why: str, you: bool, db: Any, managers: dict[str, Any],
              readers: dict[str, Callable[..., Any]] | None = None, now: datetime | None = None) -> dict[str, Any]:
    """{head, days, notes, _estate}: each read in its own FAIL-CLOSED run; what this service cannot read defers."""
    rd = {**READERS, **(readers or {})}
    intervals = _off_intervals(off_rows)
    head = {"state": STATE_READY, "why": "", "copied_at": "", "stale": False, "stale_why": ""}

    def blank(why: str) -> list[dict[str, Any]]:
        return [{"iso": (mon + timedelta(days=i)).isoformat(), "state": DAY_UNREADABLE, "why": why, "cards": [],
                 "off": _day_off(mon + timedelta(days=i), intervals), "notes": []}
                for i in range((sun - mon).days + 1)]

    if not keys:
        why = _sentence(key_why) or NO_KEY_WHY
        return {"head": {**head, "state": STATE_NOT_ATTRIBUTABLE, "why": why}, "days": blank(why), "notes": [],
                "_estate": None}
    try:
        view = rd["estate"](src)
        grids, copied = rd["grids"](src)
        tokens = set(rd["tokens"](src))
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: the week is said unreadable, never empty
        why = f"The house calendars could not be read ({_what(exc)}), so this week is not shown."
        return {"head": {**head, "state": STATE_UNREADABLE, "why": why}, "days": blank(why), "notes": [],
                "_estate": None}
    if not view.get("locations"):
        why = "No house calendar has been copied to this server yet, so this week is not shown."
        return {"head": {**head, "state": STATE_UNREADABLE, "why": why}, "days": blank(why), "notes": [],
                "_estate": view}
    notes: list[str] = []

    def attempt(fn: Callable[[], Any], what: str) -> Any:
        try:
            return fn()
        except _LOUD:
            raise
        except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: nothing is marked, and the week says so
            notes.append(f"{what} could not be read ({_what(exc)}), so no shift here is marked for it.")
            return None

    days_iso = [(mon + timedelta(days=i)).isoformat() for i in range((sun - mon).days + 1)]
    published = attempt(lambda: rd["published"](src, mon, sun),
                        "Whether a shift was just published, held by test mode or played by a rehearsal")
    pool = attempt(lambda: rd["pool"](db, days_iso, sorted(keys)), "Whether a shift was called off")
    handoffs = attempt(lambda: rd["handoffs"](src, sorted(keys), mon, sun),
                       "Whether a shift was offered to another staff member")
    try:
        homes = dict(rd["homes"](src) or {})
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — the cards stand without an address, said once
        homes = {}
        notes.append(f"The house directory could not be read ({_what(exc)}), so no address is shown.")
    if off_rows is None:
        notes.append(_sentence(off_why) or "Time off could not be read, so no day here is marked as time off.")
    if not managers.get("readable"):
        notes.append("Who manages each house could not be read, so no house manager is named.")
    days = shifts(view, grids, keys, mon, sun, tokens=tokens, homes=homes, managers=managers,
                  published=published, pool=pool, handoffs=handoffs, off_rows=off_rows, you=you)
    at = _stamp(copied)
    now = now or datetime.now(UTC)
    if at is None:
        head.update(stale=True, stale_why="When the house calendars were last copied could not be read.")
    else:
        head["copied_at"] = at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        if (now - at).total_seconds() > STALE_S:
            head.update(stale=True, stale_why=(f"The house calendars were copied more than {STALE_S // 60} minutes "
                                               f"ago, so a change made since may not show here yet."))
    return {"head": head, "days": days, "notes": notes, "_estate": view}


# ── the requests ────────────────────────────────────────────────────────────

def group_of(status: str, start: date | None, end: date | None, on: date) -> str:
    """pending (pending or needs_review) | ongoing | upcoming (scheduled) | concluded, on the Ohio today."""
    if status in OPEN_STATUSES:
        return G_PENDING
    if status == time_off.SCHEDULED:
        if end is not None and end < on:
            return G_CONCLUDED
        if start is not None and end is not None and start <= on <= end:
            return G_ONGOING
        return G_UPCOMING
    return G_CONCLUDED


def pill_word(status: str, group: str) -> str:
    if status == time_off.SCHEDULED:
        return SCHEDULED_WORDS[group]
    if status == time_off.PENDING:
        return "Waiting"
    if status in mw.TIME_OFF_CLASS:
        return mw.TIME_OFF_CLASS[status][1]
    return mw._word(status) or "Recorded"


def may_of(who: dict[str, Any], raw: dict[str, Any], *, you: bool, on: date, word: str) -> dict[str, Any]:
    """What the reader may do on one row, on their own calendar or (you=False) on a chosen person's."""
    st = str(raw.get("status") or "")
    start = time_off.day_of(raw.get("start_date"))
    word = str(word or st).lower()
    w = time_off.may_withdraw(who, raw, on)
    if w:
        wwhy = ""
    elif st == time_off.SCHEDULED and (start is None or start <= on):
        wwhy = WITHDRAW_STARTED
    elif st not in (*OPEN_STATUSES, time_off.SCHEDULED):
        wwhy = f"Nothing to withdraw: it is {word}."
    else:
        wwhy = WITHDRAW_NOT_YOURS if you else NOT_YOURS_CHOSEN
    if st == time_off.SCHEDULED:
        if start is None:
            edit, ewhy = False, EDIT_NO_DATES
        elif start <= on:
            edit, ewhy = False, EDIT_SCHEDULED_STARTED
        elif not w:
            edit, ewhy = False, wwhy
        else:
            edit, ewhy = True, ""
    elif st in OPEN_STATUSES:
        if not w:
            edit, ewhy = False, wwhy
        elif start is None:
            edit, ewhy = False, EDIT_NO_DATES
        elif start < on and not time_off.every_house(who):
            edit, ewhy = False, EDIT_STARTED
        else:
            edit, ewhy = True, ""
    else:
        edit, ewhy = False, f"Nothing to change: it is {word}."
    return {"withdraw": w, "withdraw_why": wwhy,
            "withdraw_warns": WITHDRAW_WARNS if w and st == time_off.SCHEDULED else "",
            "edit": edit, "edit_why": ewhy,
            "edit_warns": EDIT_WARNS_SCHEDULED if edit and st == time_off.SCHEDULED else ""}


def figure(rows: list[dict[str, Any]], on: date) -> dict[str, int]:
    """Calendar days inclusive in the Ohio current year (time_off.hero's overlap arithmetic)."""
    lo, hi = date(on.year, 1, 1), date(on.year, 12, 31)
    got = {"year": on.year, "approved_days": 0, "waiting_days": 0, "on_record_days": 0}
    for r in rows:
        a, b = time_off.day_of(r.get("start_date")), time_off.day_of(r.get("end_date"))
        if a is None or b is None or b < a:
            continue
        x, y = max(a, lo), min(b, hi)
        if x > y:
            continue
        n = (y - x).days + 1
        st = r.get("status")
        if st == time_off.SCHEDULED:
            got["approved_days"] += n
        elif st in OPEN_STATUSES:
            got["waiting_days"] += n
        elif st == time_off.HISTORY:
            got["on_record_days"] += n
    return got


def _request_row(ctx: mw.Ctx, raw: dict[str, Any], brd: dict[str, Any], dirs: list[str], managers: dict[str, Any],
                 *, you: bool) -> dict[str, Any]:
    r = mw.clean(raw)
    s = time_off.shape(raw, ctx.who, dirs, managers, None, ctx.today, brd=brd)
    status = mw._low(r.get("status"))
    a, b = time_off.day_of(r.get("start_date")), time_off.day_of(r.get("end_date"))
    group = group_of(status, a, b, ctx.today)
    word = pill_word(status, group)
    reason = ""
    if str(r.get("reason_given") or "").lower() == "yes":
        if you and status in OPEN_STATUSES and time_off.reason_visible(ctx.who, raw, dirs):
            text, why = time_off.reason_of(ctx.src, raw)
            reason = text or _sentence(why)
        else:
            reason = "Given — Time Off shows it on the request"
    closed = " · ".join(x for x in (mw._text(r.get("closed_by"), 80), mw._stamp_words(r.get("closed_at")),
                                    mw._text(r.get("closed_note"), 200)) if x)
    dates = time_off.dates_words(r.get("start_date"), r.get("end_date"))
    status_why = s.get("status_why") or ("Waiting on the house manager and a director"
                                         if status == time_off.PENDING else "")
    filer = sr.fold(r.get("filed_by"))
    return {"ref": str(r.get("id") or ""), "status": status, "word": word, "group": group,
            "start": s["start"], "end": s["end"], "days": s["days"], "houses": s["houses"],
            "status_why": status_why, "filed_by_other": bool(filer) and filer not in ctx.keys,
            "test_mode": bool(s["test_mode"]),
            "details": mw.pairs(("Dates", dates), ("Days", s.get("days") or r.get("days")),
                                ("Houses", ", ".join(h["label"] for h in s.get("houses") or [])),
                                ("Reason", reason),
                                ("Filed", mw.filed_via_words(r.get("filed_via"), r.get("filed_by"))),
                                ("Filed by", r.get("filed_by")),
                                ("House manager", mw._seat_words(r.get("hm_state"), r.get("hm_by"), r.get("hm_via"),
                                                                 r.get("hm_at"), r.get("hm_note"))),
                                ("Director", mw._seat_words(r.get("dir_state"), r.get("dir_by"), r.get("dir_via"),
                                                            r.get("dir_at"), r.get("dir_note"))),
                                ("Where it stands", status_why), ("Closed", closed),
                                ("Flags", ", ".join(time_off._list(r.get("flags")))),
                                ("Test mode", "Filed while test mode was on" if s.get("test_mode") else "")),
            "may": may_of(ctx.who, raw, you=you, on=ctx.today, word=word)}


def _in_order(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """GROUP_ORDER; each group by its first day, the concluded ones newest first."""
    out: list[dict[str, Any]] = []
    for g in GROUP_ORDER:
        part = sorted((r for r in rows if r["group"] == g), key=lambda r: (r["start"] or "9999-12-31", r["ref"]),
                      reverse=g == G_CONCLUDED)
        out.extend(part)
    return out


def _unanswered(state: str, why: str) -> dict[str, Any]:
    return {"state": state, "why": why, "rows": [], "figure": None, "as_of": "", "_mine": None, "_board": None}


def requests(ctx: mw.Ctx, *, you: bool) -> dict[str, Any]:
    """The Time Off house's rows whose PERSON is this one (my_work.time_off_requests' own match): never a row filed
    for somebody else."""
    try:
        ctx.need_keys()
        v = ctx.time_off_view()
    except mw.NotAttributable as exc:
        return _unanswered(STATE_NOT_ATTRIBUTABLE, _sentence(exc))
    except (mw.Unreadable, time_off.Unreadable) as exc:
        return _unanswered(STATE_UNREADABLE, _sentence(exc))
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: said, never "no requests"
        log.warning("my calendar: the time off rows failed (%s)", _what(exc))
        return _unanswered(STATE_UNREADABLE, f"Time off could not be read ({_what(exc)}).")
    brd = time_off.board(v)
    dirs = brd["names"]
    managers = ctx.managers()
    mine = [raw for raw in v["rows"] if ctx.mine_name(raw.get("person"))]
    rows = _in_order([_request_row(ctx, raw, brd, dirs, managers, you=you) for raw in mine])
    return {"state": STATE_READY, "why": "", "rows": rows, "figure": figure(mine, ctx.today),
            "as_of": str(v.get("as_of") or ""), "_mine": mine, "_board": brd}


def spelling_why(est: dict[str, Any] | None, src: Any, name: str, keys: set[str] | list[str]) -> str:
    """'' when the Time Off request door would file this name under a spelling these keys read back."""
    if not set(keys):
        return SPELLED_ELSEWHERE
    if est is None:
        return SPELLING_UNREAD
    return "" if sr.fold(time_off._spell_own(est, name)) in set(keys) else SPELLED_ELSEWHERE


def chosen_target(who: dict[str, Any], est: dict[str, Any] | None, src: Any, name: str, keys: set[str] | list[str],
                  dirs: list[str]) -> tuple[str, str]:
    """(file_for, '') for a request the reader files FOR a chosen person: time_off._spell of the roster row's own
    name, read back by its keys and within the reader's own reach; else ('', why)."""
    if not set(keys) or not str(name or "").strip():
        return "", SPELLED_ELSEWHERE_CHOSEN
    if est is None:
        return "", SPELLING_UNREAD
    spelled = str(time_off._spell(est, src, name) or "").strip()
    if not spelled or sr.fold(spelled) not in set(keys):
        return "", SPELLED_ELSEWHERE_CHOSEN
    reach = time_off.reach_refusal(who, spelled, est, list(dirs))
    return ("", f"{_sentence(reach).rstrip('.')}.") if reach else (spelled, "")


def form_facts(who: dict[str, Any], brd: dict[str, Any] | None, *, time_off_open: dict[str, Any],
               requests_state: str, requests_why: str, on: date,
               target: Callable[[], tuple[str, str]] = lambda: ("", "")) -> dict[str, Any]:
    """What the Add panel needs: whether this reader may file here, and why not, before any preview."""
    why, spelled = "", ""
    if not time_off_open.get("open", False):
        why = _sentence(time_off_open.get("why")) or "Time Off is not open to you."
    elif requests_state == STATE_UNREADABLE:
        why = _sentence(requests_why) or "Time off could not be read."
    elif not str((who or {}).get("name") or "").strip():
        why = NOT_ON_ROSTER
    elif brd is not None and not brd.get("readable"):
        why = _sentence(f"{brd.get('why') or time_off.DIRECTORS_UNREAD} — nothing can be filed until it can be read")
    elif not time_off._may_file_for(who, (brd or {}).get("names") or []):
        why = FILES_NONE
    else:
        spelled, why = target()
    return {"may_file": not why, "may_file_why": why, "file_for": "" if why else spelled,
            "reason_max": time_off.REASON_MAX, "max_days": time_off.MAX_DAYS,
            "earliest": "" if time_off.every_house(who) else on.isoformat()}


# ── the answer ──────────────────────────────────────────────────────────────

def _whose(db: Any, core_sheet_id: str, chosen: str, me: dict[str, Any]) -> tuple[set[str], str, str, bool]:
    """(keys, name, key_why, you): the chosen roster row's, or with nobody chosen the account's own."""
    mine_keys = set(me.get("keys") or [])
    if not chosen:
        name = str(me.get("roster_name") or me.get("name") or "")
        return mine_keys, name, "" if mine_keys else (_sentence(me.get("key_why")) or NO_KEY_WHY), True
    s = mp.chosen_subject(db, core_sheet_id, chosen)
    keys = set(s["keys"])
    key_why = "" if keys else _sentence((s["notes"] or [s["key_why"]])[0])
    return keys, str(s["name"] or ""), key_why, bool(keys & mine_keys)


def answer(src: Any, core_sheet_id: str, *, mode: str, me: dict[str, Any], who: dict[str, Any], person: str = "",
           week: date | str | None = None, on: date | None = None, scope_why: str = "",
           time_off_open: dict[str, Any] | None = None, db: Any = None,
           readers: dict[str, Callable[..., Any]] | None = None, now: datetime | None = None,
           edition: str = "") -> dict[str, Any]:
    """The whole answer for one person: the caller's own, or the roster row the master, or a holder of the
    any-person edition (said under `edition`), chose."""
    mass = mode == MODE_MASS
    on = on or today()
    mon = week if isinstance(week, date) else parse_week(week, on)
    sun = mon + timedelta(days=6)
    chosen = str(person or "").strip() if mass else ""
    db = db if db is not None else mp.Books(src)
    scope: dict[str, Any] = {"mode": mode, "why": scope_why, "person": chosen}
    if mass:
        try:
            scope["people"], scope["people_why"] = mp.people_list(db), ""
        except _LOUD:
            raise
        except Exception as exc:  # noqa: BLE001 — the chooser says so; the calendar still answers
            scope["people"], scope["people_why"] = [], _sentence(mp._why(exc, "the staff roster"))
        if edition:
            scope["edition"] = edition
    keys, name, key_why, you = _whose(db, core_sheet_id, chosen, me)
    ctx = mw.Ctx(src, mode=MODE_OWN, me={"keys": sorted(keys), "key_why": key_why}, who=who, lanes=None,
                 lanes_why="", on=on, db=db)
    reqs = requests(ctx, you=you)
    mine, brd = reqs.pop("_mine"), reqs.pop("_board")
    off_why = (f"{reqs['why'].rstrip('.')}, so no day here is marked as time off."
               if mine is None and reqs["why"] else "")
    wk = week_part(src, keys, mon, sun, key_why=key_why, off_rows=mine, off_why=off_why, you=you, db=db,
                   managers=ctx.managers(), readers=readers, now=now)
    est = wk.pop("_estate", None)

    def target() -> tuple[str, str]:
        if you:
            return "", spelling_why(est, src, str((who or {}).get("name") or ""), keys)
        return chosen_target(who, est, src, name, keys, (brd or {}).get("names") or [])

    form = form_facts(who, brd, time_off_open=time_off_open or {"open": False, "why": ""},
                      requests_state=reqs["state"], requests_why=reqs["why"], on=on, target=target)
    if not you and not form["may_file"]:
        # new dates are filed anew: where nothing may be filed for this person, no change of dates is offered
        for r in reqs["rows"]:
            if r["may"]["edit"]:
                r["may"].update(edit=False, edit_why=form["may_file_why"], edit_warns="")
    prev, nxt = mon - timedelta(days=7), mon + timedelta(days=7)
    return {"scope": scope,
            "person": {"own": you, "name": name, "key_why": key_why},
            "today": on.isoformat(),
            "week": {"from": mon.isoformat(), "to": sun.isoformat(),
                     "prev": prev.isoformat() if in_reach(prev, on) else "",
                     "next": nxt.isoformat() if in_reach(nxt, on) else "",
                     "this": week_of(on)[0].isoformat(), **wk},
            "requests": reqs,
            "form": form,
            "test_mode": effective_roster.test_mode_said(src),
            "read_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}


# ── the pencil's check ──────────────────────────────────────────────────────

def check_dates(src: Any, who: dict[str, Any], ref: str, start: Any, end: Any, reason: str = "", *,
                keys: list[str] | set[str], on: date | None = None, person: str = "", mode: str = MODE_OWN,
                core_sheet_id: str = "", db: Any = None) -> dict[str, Any]:
    """Would new dates for one of the reader's requests file? (server/my_calendar.py check)"""
    on = on or today()
    ref = str(ref or "").strip().upper()
    a = time_off.day_of(start)
    b = time_off.day_of(end) or a
    base: dict[str, Any] = {"ref": ref, "start": a.isoformat() if a else "", "end": b.isoformat() if b else "",
                            "days": 0, "dates": ""}
    if a is not None and b is not None and b >= a:
        base.update(days=(b - a).days + 1, dates=time_off.dates_words(a.isoformat(), b.isoformat()))
    chosen = str(person or "").strip()
    you, name = True, str((who or {}).get("name") or "")
    if chosen:
        if mode != MODE_MASS:
            return {**base, "ok": False, "refusals": ["New dates are checked for your own requests only."]}
        db = db if db is not None else mp.Books(src)
        keys, chosen_name, _why, you = _whose(db, core_sheet_id, chosen, {"keys": list(keys)})
        if not you:
            name = chosen_name
    v = time_off.view(src)
    if not v.get("minted"):
        raise time_off.Unreadable(f"{time_off.NOT_SET_UP}, so no time off can be read")
    row = time_off.find(v, ref)
    if row is None or sr.fold(row.get("person")) not in set(keys):
        whose = "yours" if you else "this person's"
        return {**base, "ok": False, "refusals": [f"No request of {whose} carries {ref}."]}
    st = str(row.get("status") or "")
    word = pill_word(st, group_of(st, time_off.day_of(row.get("start_date")), time_off.day_of(row.get("end_date")),
                                  on))
    may = may_of(who, row, you=you, on=on, word=word)
    if not may["edit"]:
        return {**base, "ok": False, "refusals": [may["edit_why"]]}
    try:
        dirs = time_off.directors_of(v["settings"])
    except time_off.Unreadable as exc:
        return {**base, "ok": False,
                "refusals": [f"{exc} — nothing can be filed until it can be read; try again in a minute"]}
    est = sr.estate(src)
    if not you:
        # the new dates are filed for the chosen person, under the spelling the request door files them under
        _spelled, elsewhere = chosen_target(who, est, src, name, keys, dirs)
        if elsewhere:
            return {**base, "ok": False, "refusals": [elsewhere]}
    elif name.strip():
        # the new dates are filed by the request door under its own spelling of the session's name
        elsewhere = spelling_why(est, src, name, keys)
        if elsewhere:
            return {**base, "ok": False, "refusals": [elsewhere]}
    existing = [r for r in v["rows"] if str(r.get("id") or "").upper() != ref]
    # the overlap is judged for the request's own person, already proven to be one of the reader's keys
    refusals = time_off.validate(who=who, person=str(row.get("person") or ""), start=a, end=b, reason=reason,
                                 existing=existing, est=est, dirs=dirs, on=on)
    return {**base, "ok": not refusals, "refusals": refusals}


# ── the doors (the relay's lane_my_calendar and lane_my_calendar_check) ───────

MY_CALENDAR_VISIT = "My Calendar reads the signed-in account's own record; it is not drawn inside a visit."
MY_CALENDAR_OWN_ONLY = "My Calendar shows only your own calendar."
# a client-role account (a client or a guardian) is forwarded by the relay; these are refused there
MY_CALENDAR_ROLES_REFUSED = ("onboarding", "interviewer")
TIME_OFF_ROLES_REFUSED = ("client", "guardian", "onboarding", "interviewer")
MASS_WHY = ("Signed in as the master account: your own calendar, or any person's you choose; a request you add "
            "there is filed for them, by you.")
TIME_OFF_CLOSED = "Time Off is not open to you."
TIME_OFF_STAFF = "Time Off is the staff's screen."
DAY_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
# the payload fields the relay hands its own word in: its Ohio day, switch, published cells and Time Off gate
PAYLOAD_TODAY, PAYLOAD_SWITCH, PAYLOAD_PUBLISHED, PAYLOAD_TIME_OFF = "today", "test_mode", "published", "time_off_open"


def holder(user: dict[str, Any] | None, config: dict[str, str]) -> bool:
    """A holder of the any-person edition: an employee on its list while its key is on; never the master."""
    return bool(user) and not sc.is_real_master(user) and sc.edition_allows(EDITION, user or {}, config)


def scope_of(user: dict[str, Any], payload: dict[str, Any], config: dict[str, str] | None = None) -> dict[str, str]:
    """{mode, why[, edition]}: `mass` for the real master's own session (never when the relay asked for own), and
    widened to `mass` for a holder of the any-person edition when the config is at hand; `own` for everyone else."""
    asked = gsjs.trim(gsjs.or_blank(payload.get("mode"))).lower()
    mode = mw.scope_verdict(user.get("role"), sc.is_real_master(user), asked == MODE_OWN)
    said = payload.get("why")
    why = said if isinstance(said, str) and asked == mode else (MASS_WHY if mode == MODE_MASS else "")
    if mode == MODE_OWN and config is not None and holder(user, config):
        return {"mode": MODE_MASS, "why": EDITION_WHY, "edition": EDITION}
    return {"mode": mode, "why": why}


def _reads_user(sess_or_reads: L.Session | L.Reads, scope: dict[str, Any]) -> tuple[L.Reads, dict[str, Any]]:
    if isinstance(sess_or_reads, L.Session):
        return sess_or_reads.reads, dict(sess_or_reads.user or {})
    return sess_or_reads, dict(scope.get("user") or {})


def _mode_of(reads: L.Reads, user: dict[str, Any], scope: dict[str, Any]) -> tuple[str, str, str]:
    """(mode, why, edition) as this read may answer it: FAIL-CLOSED, any person only for the real master or for a
    holder of the any-person edition now."""
    if scope.get("mode") == MODE_MASS and sc.is_real_master(user):
        return MODE_MASS, str(scope.get("why") or ""), ""
    if scope.get("mode") == MODE_MASS and scope.get("edition") == EDITION and holder(user, reads.config()):
        return MODE_MASS, str(scope.get("why") or ""), EDITION
    return MODE_OWN, (str(scope.get("why") or "") if scope.get("mode") == MODE_OWN else ""), ""


def today_of(payload: dict[str, Any]) -> date:
    """The relay's Ohio day when it handed one a day or less from this service's, else this service's."""
    here = today()
    said = gsjs.trim(gsjs.or_blank(payload.get(PAYLOAD_TODAY)))
    try:
        got = date.fromisoformat(said) if DAY_RE.fullmatch(said) else None
    except ValueError:
        got = None
    return got if got is not None and abs((got - here).days) <= 1 else here


@contextlib.contextmanager
def handed(payload: dict[str, Any]) -> Iterator[None]:
    """The relay's own test mode switch and published cells, bound for one read when it handed them."""
    switch = payload.get(PAYLOAD_SWITCH)
    cells = payload.get(PAYLOAD_PUBLISHED)
    cells = [dict(c) for c in cells if isinstance(c, dict)] if isinstance(cells, list) else None
    with contextlib.ExitStack() as stack:
        if isinstance(switch, dict):
            stack.enter_context(effective_roster.use_switch(switch))
        stack.enter_context(effective_roster.use_published(cells))
        yield


def _identity(reads: L.Reads, user: dict[str, Any]) -> tuple[mp.Books, dict[str, Any], dict[str, Any]]:
    """(db, who, me): the calendars' viewer, and the account's own keys read STRICTLY."""
    db = mp.Books(reads)
    who = mw.who_of(db, user)
    try:
        me = mw.identity(db, CORE_USERS_SHEET_ID, gsjs.trim(gsjs.or_blank(user.get("id"))),
                         roster_name=str(who.get("name") or ""))
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: nobody's calendar is drawn for an unread account
        log.warning("my calendar: the account row could not be read (%s)", type(exc).__name__)
        raise mw.Refused({"status": 502, "reason": "unreadable",
                          "message": f"Who you are could not be read ({type(exc).__name__}), so nothing is shown."}) \
            from exc
    return db, who, me


def time_off_open_of(user: dict[str, Any], who: dict[str, Any], said: Any = None) -> dict[str, Any]:
    """{open, why}: the relay's filing gate when it handed one, else the role alone (My Calendar's gate, already
    passed at the door, opens the filing doors as Time Off's own does); then, as on the relay, a reader Time Off
    refuses."""
    if isinstance(said, dict) and isinstance(said.get("open"), bool):
        if not said["open"]:
            return {"open": False, "why": str(said.get("why") or TIME_OFF_CLOSED)}
    else:
        role = gsjs.trim(gsjs.or_blank(user.get("role"))).lower()
        if role in TIME_OFF_ROLES_REFUSED:
            return {"open": False, "why": f"Time Off is not served to the {role} role here."}
    if time_off.refused_reader(who):
        return {"open": False, "why": TIME_OFF_STAFF}
    return {"open": True, "why": ""}


def build(sess_or_reads: L.Session | L.Reads, scope: dict[str, Any], person: str = "", week: str = "",
          time_off_open: Any = None, on: date | None = None) -> dict[str, Any]:
    """The lane's data for one session (server/my_calendar.py's answer); a refusal the lane answers raises Refused,
    and what this service cannot read defers."""
    reads, user = _reads_user(sess_or_reads, scope)
    mode, scope_why, edition = _mode_of(reads, user, scope)
    person = person if mode == MODE_MASS else ""
    on = on or today()
    try:
        mon = parse_week(week, on)
    except BadWeek as exc:
        raise mw.Refused({"status": 400, "reason": "week", "message": str(exc)}) from exc
    db, who, me = _identity(reads, user)
    opened = time_off_open_of(user, who, time_off_open)
    try:
        return answer(reads, CORE_USERS_SHEET_ID, mode=mode, me=me, who=who, person=person, week=mon, on=on,
                      scope_why=scope_why, time_off_open=opened, db=db, edition=edition)
    except mp.NoSuchPerson as exc:
        raise mw.Refused({"status": 404, "reason": "person", "message": str(exc)}) from exc
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("my calendar: the calendar failed (%s)", type(exc).__name__)
        raise mw.Refused({"status": 503, "reason": "unreadable",
                          "message": f"My Calendar could not be put together ({type(exc).__name__})."}) from exc


def check(sess_or_reads: L.Session | L.Reads, scope: dict[str, Any], person: str, ref: str, start: str,
          end: str, on: date | None = None) -> dict[str, Any]:
    """The pencil's check for one session (server/my_calendar.py's check); refusals raise Refused."""
    reads, user = _reads_user(sess_or_reads, scope)
    mode, _why, _edition = _mode_of(reads, user, scope)
    db, who, me = _identity(reads, user)
    try:
        return check_dates(reads, who, ref, start, end, keys=me.get("keys") or [], on=on, person=person, mode=mode,
                           core_sheet_id=CORE_USERS_SHEET_ID, db=db)
    except mp.NoSuchPerson as exc:
        raise mw.Refused({"status": 404, "reason": "person", "message": str(exc)}) from exc
    except time_off.Unreadable as exc:
        raise mw.Refused({"status": 503, "reason": "unreadable",
                          "message": f"{exc} — the new dates were not checked."}) from exc
    except _LOUD:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("my calendar: the check failed (%s)", type(exc).__name__)
        raise mw.Refused({"status": 503, "reason": "unreadable",
                          "message": f"The new dates could not be checked ({type(exc).__name__})."}) from exc


def _door(sess: L.Session, payload: dict) -> tuple[dict[str, Any], str] | dict[str, Any]:
    """(scope, person) for a session this door serves, or the refusal; what the relay keeps for itself defers."""
    user = sess.user or {}
    if user.get("is_service"):
        raise Defer("My Calendar is drawn for a person, never the service")
    if gsjs.trim(gsjs.or_blank(payload.get("member"))) or user.get("visiting_member"):
        return {"status": 403, "reason": "visit", "message": MY_CALENDAR_VISIT}
    role = gsjs.trim(gsjs.or_blank(user.get("role"))).lower()
    if role in MY_CALENDAR_ROLES_REFUSED or role == "client":
        raise Defer("the relay refuses this role or forwards it to its family view")
    gate = sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources())
    if gate.get("open") is not True:
        raise Defer("App Control does not open My Calendar to this account here")
    scope = scope_of(user, payload, sess.reads.config())
    person = gsjs.trim(gsjs.or_blank(payload.get("person")))
    if person and scope["mode"] != MODE_MASS:
        return {"status": 403, "reason": "scope", "message": MY_CALENDAR_OWN_ONLY}
    if person and not mp.PERSON_RE.fullmatch(person):
        return {"status": 400, "reason": "person", "message": "That person cannot be read."}
    return scope, person


def my_calendar_view(sess: L.Session, payload: dict) -> dict[str, Any]:
    """myCalendarView: GET /hub-lanes/my-calendar off asa-hub-db; the relay decides the scope, widened here only
    for a holder of the any-person edition."""
    got = _door(sess, payload)
    if isinstance(got, dict):
        return got
    scope, person = got
    week = gsjs.trim(gsjs.or_blank(payload.get("week")))
    on = today_of(payload)
    try:
        parse_week(week, on)
    except BadWeek as exc:
        return {"status": 400, "reason": "week", "message": str(exc)}
    with handed(payload):
        try:
            return {"status": 200, "data": build(sess, scope, person, week, payload.get(PAYLOAD_TIME_OFF), on)}
        except mw.Refused as exc:
            return dict(exc.env)


def my_calendar_check(sess: L.Session, payload: dict) -> dict[str, Any]:
    """myCalendarCheck: GET /hub-lanes/my-calendar/check off asa-hub-db; no reason is taken (the relay's query
    string is written to access logs)."""
    got = _door(sess, payload)
    if isinstance(got, dict):
        return got
    scope, person = got
    ref = gsjs.trim(gsjs.or_blank(payload.get("ref"))).upper()
    if not time_off.REF_RE.fullmatch(ref):
        return {"status": 400, "reason": "request", "message": "ref is required (TO…)"}
    start = gsjs.trim(gsjs.or_blank(payload.get("start")))
    end = gsjs.trim(gsjs.or_blank(payload.get("end")))
    if any(d and not DAY_RE.fullmatch(d) for d in (start, end)):
        return {"status": 400, "reason": "dates", "message": "A day is written YYYY-MM-DD."}
    with handed(payload):
        try:
            return {"status": 200, "data": check(sess, scope, person, ref, start, end, today_of(payload))}
        except mw.Refused as exc:
            return dict(exc.env)


# the relay's own state the payload hands in (relay_state) is bound for the whole read
ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "myCalendarView": relay_state.bound(my_calendar_view),
    "myCalendarCheck": relay_state.bound(my_calendar_check)}
POLICY_ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
POLICY: dict[str, dict[str, Any]] = {
    "myCalendarView": {"roles": POLICY_ROLES,
                       "params": {"person": "string", "mode": "string", "why": "string", "member": "string",
                                  "week": "string", "today": "string", "test_mode": "object", "published": "array",
                                  "time_off_open": "object"}},
    "myCalendarCheck": {"roles": POLICY_ROLES,
                        "params": {"person": "string", "mode": "string", "why": "string", "member": "string",
                                   "ref": "string", "start": "string", "end": "string", "today": "string",
                                   "test_mode": "object", "published": "array"}}}
