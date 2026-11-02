"""THE PERSON BEHIND A ROSTER CELL, AND WHO COULD HONESTLY TAKE ONE.

The operator's ask, in his words:

    "eu preciso que voce injete e colete do behavior support para tracar um
     perfil do usuario"
    "com base no knowhow combinado do smart comms com o behavior support voce
     consiga inserir no APP calendar builder sugestoes de funcionarios para
     fullfil dos conflitos e sugestoes para os proximos calendarios"

Two readings live here. `rosterProfile` is one row per person on the roster,
joining what four sources honestly answer about them. `coverageSuggestions` is
one row per shift that needs somebody, carrying the people who could take it,
ranked, each with the sentence that put them there.

────────────────────────────────────────────────────────────────────────────
THE LINE THIS FILE EXISTS TO HOLD

A profile of a worker, used to decide who works, can hurt them twice. Deny
shifts to somebody a wellbeing signal flagged and you have taken their income
for being tired. Pile shifts on whoever looks reliable and you burn out the
people already carrying the roster. Both failures look like a good algorithm
from the inside, and neither announces itself.

So the grouping on every row is not cosmetic and it is not advice:

  `fact_*`    HARD. Measured, attributable, and the only thing that ranks.
  `soft_*`    ANNOTATION ONLY. Never a sort key, never a filter, never a
              reason a name is missing. Drawn beside a suggestion so a human
              can weigh it.
  `refused_*` WHAT THIS ROW DELIBERATELY DOES NOT CARRY, and why, in words.

A WELLBEING SIGNAL MAY NEVER VETO ANYBODY and may never rank one person below
another. `suggest()` reads nothing from the soft group. That is enforced by
`_SOFT_NEVER_RANKS` below, which fails the import if a soft key is ever named
in the sort.

NOTHING HERE ASSIGNS ANYBODY. These readings propose a name into a cell that
is empty or into one a human has decided to clear. The click, the draft and
the publish belong to the desk and to code that already exists.

────────────────────────────────────────────────────────────────────────────
WHAT THE CONFLICTS ACTUALLY ARE, MEASURED, AND IT REFRAMES THE REQUEST

Every one of the eleven live conflicts is an OVER-booking — the same name in
two places — not an unfilled shift. "Filling" one means DELETING one of two
cells, not finding a body. Nine of the eleven are a 30-to-60-minute turnaround
overlap whose real fix is trimming an end time, and four of the eleven belong
to "FAMILY", which is not an employee at all.

So a conflict is not asked "who covers this". It is asked, for EACH of its two
cells: if the desk releases this one, who could take it? That question has an
answer, and the incumbent is excluded from their own cell automatically —
their other cell still overlaps it.

The shifts that genuinely need a person are elsewhere: the OPEN rows, which
carry real hours and no name. Those are vacancies of the same shape and are
ranked by the same ladder.

────────────────────────────────────────────────────────────────────────────
THE LADDER, IN THE ORDER IT IS APPLIED, AND WHAT EACH SILENCE MEANS

 1 ALREADY ROSTERED AT THAT HOUR — the union of the person's cells across
   every house block, on an ABSOLUTE clock with an overnight's end past 24.
   EXCLUDES. This is the one fact that is solid, and it is the same test that
   names the eleven conflicts, so a candidate who would create a twelfth is
   refused by the very rule that found the first eleven.

 2 TURNAROUND — the gap to the shift before and the shift after. REPORTED IN
   HOURS AND NEVER EXCLUDED, because NO SOURCE STATES A MINIMUM. The number
   that defines nine of the eleven conflicts is not written down anywhere in
   this estate, and inventing one here would be this module deciding a policy.
   The gap rides on the reason line; the desk draws the line.

 3 ASKED THAT DAY OFF — a request whose span covers the date. EXCLUDES. There
   is no approval column anywhere, and `pending` is only a date comparison, so
   this is not "an approved absence" — it is "they asked". Measured: the desk
   overrode four of sixteen such requests in the live period, which is exactly
   why a machine must not be the one to override.

 4 CALLED OFF THAT DAY — the living book. EXCLUDES for a past or present date.
   For a FUTURE date the book is silent by definition and that silence carries
   no information whatever. A LATE SHOW is a person who WORKED and is never
   counted as an absence anywhere in this file.

 5 A STATED PREFERENCE BARS IT — only negatives, and only the ones that parse.
   EXCLUDES where one does. Silence means "no stated bar", never "allowed".

 6 QUALIFIED — an expired requirement excludes. WITH ONE PIECE OF ARITHMETIC,
   not a threshold: a requirement expired for EVERY person the reading can
   assess cannot tell one candidate from another, so it is carried as a
   caution on all of them instead of emptying every list. Measured on the live
   roster, three registry re-checks are expired for 55 of 55 assessable people
   and are one background check written down three times.

 7 REACHABLE — DOES NOT EXCLUDE. A person nobody can text can be asked in
   person. It rides on the row so a suggestion that cannot be acted on says so.

MISSING IS NOT ZERO, and it is enforced at the sort. Nobody drifts to the
bottom because a field was absent: the order is the rest either side of the
shift — a hard fact from the roster that answers for every candidate — and
then the name, alphabetically. A person with no preference row, no credentials
row and no phone sorts on the facts that DO answer for them and carries the
word "unknown" where nothing does.

────────────────────────────────────────────────────────────────────────────
WHAT IS REFUSED, AND EVERY REFUSAL IS MEASURED

BEHAVIOUR'S OWN SCHEDULE ARITHMETIC. `behaviorBoard.shift_verdict` and
`shift_why` are FALSE about named people right now, inflated between two and
thirteen times: the board counts alias POINTER cells — a token naming the
house that holds the hours — as shifts. It says one caregiver has worked "28
days on in a row" where the grid says ten. Showing that beside a suggestion
would do the precise harm rule 1 exists to prevent, so the strain figures on
these rows are computed FROM THE GRID and attributed to it, and the board's
own verdict is named in `refused_*` rather than printed.

WHAT BEHAVIOUR SUPPORT DOES CONTRIBUTE is the half it measures correctly:
requirements, courses and in-service training, with their dates. That is a
hard fact about qualification and it is used as one.

A PERSON'S CLICKING ON AN INTRANET. `metrics.*`, `site_verdict`, `top_apps`,
`night_actions`, `weekend_actions`, `forms_actions`, `images_touched`,
`reach_verdict`. Ranking a caregiver on how much they use a website is
ranking them on the wrong thing entirely, and it is refused in every position
— not as a tiebreak, not greyed out.

AN ABSENCE RATE, AS A RANK KEY, EVER. And no rate is shown without its
denominator. Measured: the punch record and the retired call-off book do not
overlap by a single day, so for nearly everybody a rate is unanswerable, and
the attendance reading is right to say so rather than compute one.

CLIENT IDENTITY IN A RECORD ABOUT A WORKER. No address, latitude, longitude,
consumers, num_consumers, location_code or raw — and no house on a PROFILE
row. A vacancy row names its house because a vacancy IS a roster cell and the
builder already draws that column; a person's profile is not a roster cell.

THE PROSE. Call-off notes, `how_late`, and who reported the absence. 438 of
665 rows carry notes and they read "her son fell at park and broke his arm".
The FACT and the TYPE may travel. The words may not.
"""
from __future__ import annotations

import re
from collections import Counter
from datetime import date as _date, datetime, timedelta
from typing import Any, Iterable

#: The two readings this module produces.
RESOURCES = ("rosterProfile", "coverageSuggestions")

#: The slices both readings are built from. The serving half re-reads them.
SOURCES = ("calendarGrid", "calendarStaff", "calendarRequests", "callOffs",
           "behaviorBoard", "commRoutes", "commAttendance")

#: NEVER READ, from any source, into either reading. Seven of them are a
#: client's home by one route or another; the rest are prose nobody reviewed,
#: the name of whoever reported somebody else's absence, or a measurement of a
#: person's use of a website.
REFUSED_FIELDS = (
    # a client's home
    "address", "latitude", "longitude", "consumers", "num_consumers",
    "location_code", "raw", "clients", "client_count",
    # the words
    "comments", "notes", "notes_include_reason_and_how_much_advanced_notice",
    "how_late", "your_name", "reported_by",
    # a person's clicking
    "metrics", "site_verdict", "site_why", "top_apps", "night_actions",
    "weekend_actions", "forms_actions", "images_touched", "reach_verdict",
    "reach_why",
    # behaviour's schedule arithmetic, which is inflated 2x-13x by alias cells
    "shift_verdict", "shift_why", "shifts",
    # THE INCIDENTS, AND THIS ONE IS NOT ABOUT LEAKING — IT IS ABOUT HARM.
    # An incident is usually a client having a hard day, and the caregiver in
    # the row is the person who was present when it happened. Let that number
    # into a ladder that decides who works and somebody loses income for being
    # there. It may be drawn beside a name for a human to weigh; it may never
    # rank, filter, or explain why a name is missing from a suggestion. The
    # lock below is what keeps that true after everyone who agreed to it has
    # moved on.
    "incidents", "incidents_known", "incidents_why", "incidents_window",
    "incidents_windows", "incidents_coverage", "incidents_gate",
    "incidents_types", "incidents_people", "incidents_looked",
    "incidents_unavailable",
)

#: Exactly what is read out of each source, named one by one. There is no
#: `dict(row)` and no `**row` anywhere below, so a column this module never
#: names is a column it cannot leak.
_GRID_READ = ("rowType", "house", "designation", "employee", "sheetRow",
              "cells", "start", "end", "days", "date", "text", "kind")
_PREF_READ = ("name", "shifts", "pickup", "weekend", "allergy", "note")
_REQ_READ = ("name", "startDate", "endDate", "pending", "timestamp")
_CALL_OFF_READ = ("employee_name", "date", "type")
_BEHAVIOUR_READ = ("subject_name", "subject_kind", "role", "requirements",
                   "training", "ist", "training_verdict", "training_why",
                   "computed_at", "window_days")
_ROUTE_READ = ("name", "person_key", "phone", "email", "window_from",
               "window_to", "window_why")
_ATTENDANCE_READ = ("name", "person_key", "sources", "rate_state",
                    "rate_denominator_says", "call_off_call_off_all",
                    "call_off_sent_home_all", "call_off_no_show_all",
                    "call_off_late_show_all", "punch_reading",
                    "call_off_reading")

# THE IMPORT-TIME LOCK. A refused field can only enter this module by being
# typed into one of the seven lists above, and then this refuses to load. A
# broken reading is an hour's work; a client's address, or a supervisor's note
# about a caregiver's health, quietly filed in a staffing record is a thing
# nobody notices for months.
#
# `shifts` is the one name that appears on both lists and it is two different
# fields: the Staff Preferences column ("no midnights", free text a person
# wrote about themselves) and behaviour's alias-inflated shift COUNT. The
# preference column is read; the count is not, and the lock is written so that
# stays true rather than being a comment somebody trusts.
_LOCKED = (set(REFUSED_FIELDS) & (set(_GRID_READ) | set(_REQ_READ)
                                  | set(_CALL_OFF_READ) | set(_BEHAVIOUR_READ)
                                  | set(_ROUTE_READ) | set(_ATTENDANCE_READ)))
if _LOCKED:
    raise RuntimeError(
        "roster_profile: a reading about a worker may not carry client data, "
        "unreviewed prose, a measurement of their clicking, or behaviour's "
        "alias-inflated shift arithmetic — " + ", ".join(sorted(_LOCKED)))

#: WHAT THE SORT IS ALLOWED TO TOUCH. The ladder ranks on rest and then on the
#: name; nothing else. Spelled out so the assertion below can hold it.
_RANK_KEYS = ("rest_hours", "name")
_SOFT_NEVER_RANKS = tuple(k for k in _RANK_KEYS if k.startswith("soft_"))
if _SOFT_NEVER_RANKS:
    raise RuntimeError(
        "roster_profile: a soft signal is annotation only and may never order "
        "a list of people — " + ", ".join(_SOFT_NEVER_RANKS))

#: Grid rows that carry hours but are not a person. The builder's own
#: `_skip_staff` drops OPEN and WORKSHOP and lets these through, which is why
#: four of the eleven live conflicts belong to "FAMILY".
NOT_A_PERSON = frozenset({
    "family", "nurse", "nurses", "open", "workshop", "staff", "agency",
    "prn", "tbd", "vacant", "hold", "closed",
})

#: The call-off vocabulary, normalised. FOUR FACTS, NEVER ONE NUMBER — and a
#: LATE SHOW is a person who worked, so it can never exclude anybody.
CALL_OFF_TYPES = {
    "call off": "call_off", "call-off": "call_off", "calloff": "call_off",
    "sent home": "sent_home", "no show": "no_show",
    "no show / no call": "no_show", "no show no call": "no_show",
    "no-show": "no_show", "late show": "late_show", "late": "late_show",
}
#: The three that mean the person was not there. `late_show` is deliberately
#: absent: they turned up.
ABSENT_TYPES = frozenset({"call_off", "sent_home", "no_show"})

_WEEKDAYS = {
    "mon": 0, "monday": 0, "mondays": 0, "tue": 1, "tues": 1, "tuesday": 1,
    "tuesdays": 1, "wed": 2, "weds": 2, "wednesday": 2, "wednesdays": 2,
    "thu": 3, "thur": 3, "thurs": 3, "thursday": 3, "thursdays": 3,
    "fri": 4, "friday": 4, "fridays": 4, "sat": 5, "saturday": 5,
    "saturdays": 5, "sun": 6, "sunday": 6, "sundays": 6,
}
#: The cell grammar's own words for a shift, as `shift_slices.classify` types
#: them — so a stated bar on "midnights" is compared against the same
#: vocabulary the grid is parsed into, not a second one.
_KINDS = {
    "midnight": "overnight", "midnights": "overnight", "overnight": "overnight",
    "overnights": "overnight", "night": "overnight", "nights": "overnight",
    "afternoon": "afternoon", "afternoons": "afternoon",
    "morning": "morning", "mornings": "morning",
    "day": "day", "days": "day", "evening": "evening", "evenings": "evening",
}
_JOINERS = frozenset({"and", "or", "on", "the", "in", "at", "of", "any"})
_NEGATORS = ("no", "not", "off", "never")

_WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
                  "Saturday", "Sunday")


# ── the keys, and the one join ────────────────────────────────────────────

def person_key(name: Any) -> str:
    """The flattened name key — the estate's own shape, lowercase alphanumeric.

    EVERY JOIN IN THIS LANE IS BY NAME and every one of them is dirty: 52
    preference rows against 63 grid names, 43 of 63 with a route, 55 of 63 with
    credentials. There is no employee id spanning these sources.

    So this is an EXACT key and nothing here fuzzy-matches. Measured, three
    people's preferences are hidden by spelling drift ("Sharday Benson" on the
    form against "Sharday Bendson" on the grid). That is reported as a count of
    people with no row, never repaired by a guess: a wrong match attaches one
    person's stated bar, or one person's absence, to another person's name, on
    a screen a manager staffs a house from.
    """
    return "".join(ch for ch in str(name or "").lower() if ch.isalnum())


def is_person(name: Any) -> bool:
    """Is this grid row a human being, or a placeholder carrying hours?"""
    k = person_key(name)
    return bool(k) and k not in NOT_A_PERSON and "workshop" not in k


# ── the words people wrote about themselves ───────────────────────────────

def parse_negatives(text: Any) -> list[dict]:
    """Stated bars, and ONLY the ones that actually parse.

    NEVER INVERTED. The estate's generator reads "no midnights" and returns the
    overnight code — it finds the shift word and drops the negation, so a person
    who wrote that she cannot work midnights is rostered three of them, and
    those three overnights ARE three of the eleven live conflicts. It also reads
    "no thursday and friday" as a day shift, because "day" is inside "thursday".
    Neither rule is imported here and neither is repeated.

    A WEEKDAY AND A SHIFT KIND IN ONE PHRASE COMBINE AS *AND*, NOT AS TWO BARS.
    "No Fridays on afternoons" bars Friday afternoons. Reading it as "no
    Fridays" plus "no afternoons" would refuse this person a third of the
    roster on the strength of a sentence she did not write.

    Silence is silence: a phrase nothing recognises produces nothing at all,
    and the caller must read that as "no stated bar", never as "allowed".
    """
    out: list[dict] = []
    words = re.sub(r"[^a-z ]+", " ", str(text or "").lower()).split()
    i = 0
    while i < len(words):
        if words[i] not in _NEGATORS:
            i += 1
            continue
        j, days, kinds, said = i + 1, set(), set(), [words[i]]
        while j < len(words):
            w = words[j]
            if w in _WEEKDAYS:
                days.add(_WEEKDAYS[w])
            elif w in _KINDS:
                kinds.add(_KINDS[w])
            elif w in _JOINERS and (days or kinds):
                pass  # "and", "or", "on" — still inside the same phrase
            else:
                break
            said.append(w)
            j += 1
        if days or kinds:
            out.append({"weekdays": sorted(days), "kinds": sorted(kinds),
                        "said": " ".join(said)})
        i = max(j, i + 1)
    return out


def bar_hits(bar: dict, weekday: int, kind: str) -> bool:
    """Does one stated bar cover this particular shift? Conjunction where the
    phrase named both a day and a kind; otherwise whichever half it named."""
    day_said = bool(bar["weekdays"])
    kind_said = bool(bar["kinds"])
    day_hit = weekday in bar["weekdays"] if day_said else True
    kind_hit = kind in bar["kinds"] if kind_said else True
    return (day_said or kind_said) and day_hit and kind_hit


# ── dates and clocks ──────────────────────────────────────────────────────

def _iso_day(raw: Any) -> str:
    """The date shapes these books arrive in, each read on its own terms.

    The call-off form writes M/D/YYYY, one browser wrote ISO, and a handful
    carry a two-digit year. The two-digit ones are REFUSED rather than pivoted
    — a call-off placed a century off is a silent wrong answer, and a wrong
    date here excludes a person from a shift they could have worked.
    """
    s = str(raw or "").strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        return f"{int(m.group(3)):04d}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    return ""


def _at(date_iso: str, hour: float) -> datetime:
    """A cell placed on the absolute clock — the date plus classify's hour,
    with an overnight's end running past 24. Comparing dates as keys misses
    exactly the pair that matters: a ten-to-eight night against the next
    morning's seven o'clock."""
    return datetime.strptime(date_iso, "%Y-%m-%d") + timedelta(hours=float(hour))


def _week_start(d: _date) -> _date:
    """The estate's week runs Saturday to Friday — the builder's own rule."""
    return d - timedelta(days=(d.weekday() + 2) % 7)


def _h(x: float) -> float:
    return round(float(x), 2)


def _dated(x: dict) -> str:
    """"med1 2026-10-14", or just "bci" when the credentials row carried the
    requirement with no date on it. A trailing space where a date should be
    reads as a date that failed to load."""
    when = str(x.get("on") or "").strip()
    what = str(x.get("what") or "")
    return f"{what} {when}" if when else what


# ── the roster, read once ─────────────────────────────────────────────────

def read_roster(grid_rows: Iterable[dict]) -> dict:
    """The 28-day grid as intervals per person, plus the period and the cells
    that have hours and nobody on them.

    THE UNION ACROSS HOUSE BLOCKS IS THE POINT. One row is one (house, person)
    pair and 47 of 63 people appear in more than one block, so a person's real
    calendar only exists when their rows are added together. Reading one block
    is how a double-booking becomes invisible.
    """
    period = {"start": "", "end": "", "days": 0}
    intervals: dict[str, list[dict]] = {}
    held: dict[str, list[dict]] = {}
    shown: dict[str, str] = {}
    open_cells: list[dict] = []
    placeholders: Counter = Counter()
    rows_seen = 0

    for row in grid_rows:
        kind = str(row.get("rowType") or "")
        if kind == "period":
            period = {"start": str(row.get("start") or ""),
                      "end": str(row.get("end") or ""),
                      "days": int(row.get("days") or 0)}
            continue
        rows_seen += 1
        house = str(row.get("house") or "")
        who = str(row.get("employee") or "")
        sheet_row = int(row.get("sheetRow") or 0)
        cells = row.get("cells") or []
        a_person = is_person(who)
        if kind == "staff" and not a_person:
            # COUNTED AND NAMED, NEVER SILENTLY DROPPED. These rows carry real
            # hours, the builder's own conflict test treats them as staff, and
            # some of the period's conflicts belong to them — so their cells
            # are kept apart, in `held`, where the conflict count can see them
            # and the candidate pool cannot.
            placeholders[who or "(blank)"] += sum(
                1 for c in cells if c.get("start") is not None)
        for c in cells:
            if c.get("start") is None:
                continue
            date_iso = str(c.get("date") or "")
            if not date_iso:
                continue
            cell = {
                "house": house, "sheet_row": sheet_row, "date": date_iso,
                "text": str(c.get("text") or ""), "kind": str(c.get("kind") or ""),
                "start": _at(date_iso, c["start"]), "end": _at(date_iso, c["end"]),
            }
            if kind == "open":
                open_cells.append(cell)
            elif kind == "staff" and a_person:
                k = person_key(who)
                shown.setdefault(k, who)
                intervals.setdefault(k, []).append(cell)
            elif kind == "staff" and person_key(who):
                # A BLANK name is skipped outright, exactly as the builder's own
                # rule skips it — a conflict between two nameless cells is not a
                # conflict anybody can act on, and counting one here would put a
                # number on this screen the Builder chip does not have.
                shown.setdefault(person_key(who), who)
                held.setdefault(person_key(who), []).append(cell)
    for v in intervals.values():
        v.sort(key=lambda c: c["start"])
    for v in held.values():
        v.sort(key=lambda c: c["start"])
    open_cells.sort(key=lambda c: (c["date"], c["house"]))
    return {"period": period, "intervals": intervals, "names": shown,
            "placeholder_intervals": held, "open_cells": open_cells,
            "placeholders": dict(placeholders), "grid_rows": rows_seen}


def conflicts(roster: dict) -> list[dict]:
    """Every pair of overlapping cells belonging to one person.

    THE SAME TEST THE BUILDER'S LANE RUNS, over the same absolute clock, so the
    number here and the red chip on the Builder tab cannot drift apart. Two
    producers disagreeing about how many conflicts exist is the state this app
    is in today — the Conflicts tab prints "every shift belongs to one house at
    a time" while the chip beside it says eleven.
    """
    out: list[dict] = []
    # BOTH SETS, because the builder's chip counts both. A conflict whose name
    # is a placeholder is still a conflict on the desk's screen; what differs
    # is that no human being can be proposed for it.
    for source, staffed in ((roster["intervals"], True),
                            (roster["placeholder_intervals"], False)):
        for k, cells in source.items():
            for i in range(len(cells)):
                for j in range(i + 1, len(cells)):
                    a, b = cells[i], cells[j]
                    if b["start"] >= a["end"]:
                        break  # sorted: nothing later can still overlap a
                    out.append({
                        "conflict_id": f'{k[:24]}_{a["sheet_row"]}_{a["date"]}',
                        "person_key": k, "name": roster["names"][k],
                        "is_a_person": staffed, "a": a, "b": b,
                        "overlap_hours": _h(
                            (min(a["end"], b["end"]) - max(a["start"], b["start"]))
                            .total_seconds() / 3600.0),
                    })
    out.sort(key=lambda c: (c["name"], c["a"]["date"]))
    return out


# ── the sources, each read into the shape the ladder wants ────────────────

def read_preferences(rows: Iterable[dict]) -> dict[str, dict]:
    """The Staff Preferences tab: what people said about their own weeks."""
    out: dict[str, dict] = {}
    for r in rows:
        k = person_key(r.get("name"))
        if not k:
            continue
        shifts = str(r.get("shifts") or "")
        note = str(r.get("note") or "")
        out[k] = {
            "name": str(r.get("name") or ""),
            "shifts": shifts,
            "note": note,
            # BLANK IS NOT "NO". 48 of 52 rows leave this empty, and it is the
            # single most on-point field for "who would cover this" — so it is
            # read as a yes where it says yes and as silence everywhere else.
            "pickup_said_yes": str(r.get("pickup") or "").strip().lower().startswith("y"),
            "weekend_pool": str(r.get("weekend") or ""),
            "allergy": str(r.get("allergy") or ""),
            "bars": parse_negatives(shifts) + parse_negatives(note),
        }
    return out


def read_requests(rows: Iterable[dict]) -> dict[str, list[dict]]:
    """Time-off requests. THERE IS NO APPROVAL COLUMN ANYWHERE — `pending` is
    computed `endDate >= today` and nothing more, so a denied request and a
    granted one are byte-identical rows. This reading therefore says "they
    asked", which is the only sentence the data supports."""
    out: dict[str, list[dict]] = {}
    for r in rows:
        k = person_key(r.get("name"))
        if not k:
            continue
        out.setdefault(k, []).append({
            "from": str(r.get("startDate") or ""),
            "to": str(r.get("endDate") or ""),
            "asked_at": str(r.get("timestamp") or ""),
            "still_ahead": bool(r.get("pending")),
        })
    return out


def read_call_offs(rows: Iterable[dict]) -> dict[str, dict]:
    """The living call-off book: the FACT and the TYPE, and nothing else.

    `notes`, `how_late` and `your_name` are not read. The first two are people
    writing about a caregiver's family and health; the third is who REPORTED
    the absence, which belongs to the reporter.
    """
    out: dict[str, dict] = {}
    for r in rows:
        k = person_key(r.get("employee_name"))
        if not k:
            continue
        kind = CALL_OFF_TYPES.get(
            " ".join(str(r.get("type") or "").strip().lower().split()))
        slot = out.setdefault(k, {"by_day": {}, "counts": Counter(), "undated": 0})
        if kind:
            slot["counts"][kind] += 1
        else:
            slot["counts"]["untyped"] += 1
        day = _iso_day(r.get("date"))
        if not day:
            slot["undated"] += 1
            continue
        slot["by_day"].setdefault(day, []).append(kind or "untyped")
    return out


def read_credentials(rows: Iterable[dict]) -> dict[str, dict]:
    """BEHAVIOUR SUPPORT'S HALF THAT IS TRUE — requirements, courses, and
    in-service training, with their dates.

    Its schedule arithmetic is not read here and cannot be: `shifts`,
    `shift_verdict` and `shift_why` are on the refusal list and the import-time
    lock holds them there. Measured, they are inflated between two and thirteen
    times by alias pointer cells, and they are statements about named people.
    """
    out: dict[str, dict] = {}
    for r in rows:
        if str(r.get("subject_kind") or "") != "person":
            continue
        k = person_key(r.get("subject_name"))
        if not k:
            continue
        reqs = r.get("requirements") or {}
        wrong = [x for x in (reqs.get("wrong") or []) if isinstance(x, dict)]
        ist = r.get("ist") or {}
        out[k] = {
            "expired": sorted({str(x.get("req")) for x in wrong
                               if str(x.get("state")) == "expired"}),
            "expiring": [{"what": str(x.get("req")), "on": str(x.get("expires") or "")}
                         for x in wrong if str(x.get("state")) == "expiring"],
            "ok": int(reqs.get("ok") or 0),
            "missing": int(reqs.get("missing") or 0),
            "training_verdict": str(r.get("training_verdict") or ""),
            "training_why": str(r.get("training_why") or ""),
            "ist_owed": int(ist.get("owed") or 0),
            "computed_at": str(r.get("computed_at") or ""),
        }
    return out


def universal_expiries(creds: dict[str, dict], pool: Iterable[str]) -> set[str]:
    """Which expired requirements cannot tell one candidate from another.

    ARITHMETIC, NOT A THRESHOLD. If a requirement is expired for EVERY person
    the reading can assess, then excluding on it empties every list and
    distinguishes nobody — it is a gap in the records, not a difference between
    two people. Measured on the live roster: three registry re-checks
    (sex_offender, offender, nurse_aide) are expired for all 55 assessable
    people and carry the same date per person, which is one background check
    written down three times.

    Nothing is hard-coded: the set is recomputed every build, so a requirement
    that stops being universal starts excluding again on its own.
    """
    assessable = [k for k in pool if k in creds]
    if not assessable:
        return set()
    tally: Counter = Counter()
    for k in assessable:
        for req in creds[k]["expired"]:
            tally[req] += 1
    return {req for req, n in tally.items() if n >= len(assessable)}


def read_routes(rows: Iterable[dict]) -> dict[str, dict]:
    """How Smart Comms would reach somebody, and when. NEVER A REASON TO RANK
    ANYBODY — a caregiver with no phone can be asked in the hallway."""
    out: dict[str, dict] = {}
    for r in rows:
        k = person_key(r.get("name")) or person_key(r.get("person_key"))
        if not k:
            continue
        out[k] = {
            "phone": bool(str(r.get("phone") or "").strip()),
            "email": bool(str(r.get("email") or "").strip()),
            "window_from": str(r.get("window_from") or ""),
            "window_to": str(r.get("window_to") or ""),
            "window_why": str(r.get("window_why") or ""),
        }
    return out


def read_attendance(rows: Iterable[dict]) -> dict[str, dict]:
    """The punch record beside the call-off book, when that reading is served.

    EVERYTHING HERE IS SOFT and it is carried for one reason: `sources` is a
    statement about the BOOKS, and it is the honest first thing to say about a
    person. 117 of 197 people are known to the call-off book alone; that is not
    a fact about them, it is a fact about the records.

    No rate is ever a rank key and no rate travels without the sentence that
    says what it was divided by.
    """
    out: dict[str, dict] = {}
    for r in rows:
        k = person_key(r.get("name")) or str(r.get("person_key") or "")
        if not k:
            continue
        out[k] = {
            "sources": str(r.get("sources") or ""),
            "rate_state": str(r.get("rate_state") or ""),
            "rate_denominator_says": str(r.get("rate_denominator_says") or ""),
            "punch_reading": str(r.get("punch_reading") or ""),
            "call_off_reading": str(r.get("call_off_reading") or ""),
            # The four stay four. Nothing on this row adds them, and a late
            # show is a shift somebody worked.
            "call_off_all": r.get("call_off_call_off_all"),
            "sent_home_all": r.get("call_off_sent_home_all"),
            "no_show_all": r.get("call_off_no_show_all"),
            "late_show_all": r.get("call_off_late_show_all"),
        }
    return out


# ── the strain figures, computed from the grid and attributed to it ───────

def _strain(cells: list[dict]) -> dict:
    """Consecutive days, the busiest week, overnights, and the doubles that
    throw no conflict flag — all from the roster the desk published.

    NOT FROM BEHAVIOUR SUPPORT. Its board says one caregiver has worked 28 days
    on in a row where these same cells say ten, so a caution drawn from it
    would be a false statement about a named person.
    """
    days = sorted({c["start"].date() for c in cells})
    longest, run, prev = 0, 0, None
    for d in days:
        run = run + 1 if prev is not None and (d - prev).days == 1 else 1
        prev, longest = d, max(longest, run)
    weeks: Counter = Counter()
    for c in cells:
        weeks[_week_start(c["start"].date())] += (
            c["end"] - c["start"]).total_seconds() / 3600.0
    busiest = max(weeks.items(), key=lambda kv: kv[1], default=(None, 0.0))
    per_day: dict[Any, int] = Counter(c["start"].date() for c in cells)
    doubles = sorted(str(d) for d, n in per_day.items() if n > 1)
    return {
        "days_on": len(days),
        "longest_run_days": longest,
        "busiest_week_start": busiest[0].isoformat() if busiest[0] else "",
        "busiest_week_hours": _h(busiest[1]),
        "total_hours": _h(sum(
            (c["end"] - c["start"]).total_seconds() / 3600.0 for c in cells)),
        "overnights": sum(1 for c in cells if c["kind"] == "overnight"),
        "back_to_back_days": doubles,
        "houses": sorted({c["house"] for c in cells}),
    }


def _contradictions(cells: list[dict], pref: dict | None) -> list[str]:
    """What the roster already does that the person said they would rather not.

    A caution, never a bar: the desk may have agreed it with them, and this
    reading has no way to know. It is the same sentence that would have caught
    three of the eleven conflicts before they were published.
    """
    if not pref or not pref["bars"]:
        return []
    out = []
    for bar in pref["bars"]:
        hit = [c for c in cells
               if bar_hits(bar, c["start"].weekday(), c["kind"])]
        if hit:
            out.append(f'wrote "{bar["said"]}" and is rostered '
                       f'{len(hit)} such shift{"" if len(hit) == 1 else "s"} '
                       f'this period')
    return out


# ── reading one: the person ───────────────────────────────────────────────

def profiles(sources: dict, today: _date | None = None) -> list[dict]:
    """One row per person on the roster. Hard facts, soft signals and refusals
    in three groups a caller cannot confuse.

    THE POOL IS THE GRID'S OWN NAMES. A person the roster has never heard of is
    UNKNOWN to this reading, not available and not unreliable — so they are not
    given a row that would read as an answer about them.

    `today` is accepted so a caller can pin the whole reading to one date, and
    it is deliberately unused here: every figure on this row is about the
    PUBLISHED PERIOD, not about the hour it was read. Only the suggestions need
    to know what day it is, because only they have to decide whether the
    call-off book is speaking about the past or is silent about the future.
    """
    roster = read_roster(sources.get("calendarGrid") or [])
    prefs = read_preferences(sources.get("calendarStaff") or [])
    reqs = read_requests(sources.get("calendarRequests") or [])
    offs = read_call_offs(sources.get("callOffs") or [])
    creds = read_credentials(sources.get("behaviorBoard") or [])
    routes = read_routes(sources.get("commRoutes") or [])
    att = read_attendance(sources.get("commAttendance") or [])
    fresh = sources.get("freshness") or {}
    pool = sorted(roster["intervals"])
    shared = universal_expiries(creds, pool)
    period = roster["period"]

    rows: list[dict] = []
    for k in pool:
        cells = roster["intervals"][k]
        pref = prefs.get(k)
        cred = creds.get(k)
        rt = routes.get(k)
        a = att.get(k)
        co = offs.get(k)
        strain = _strain(cells)
        my_reqs = [r for r in reqs.get(k, [])
                   if not period["start"] or r["to"] >= period["start"]]
        in_period = [r for r in my_reqs
                     if period["start"] and r["from"] <= period["end"]
                     and r["to"] >= period["start"]]
        expired_hard = [x for x in (cred["expired"] if cred else []) if x not in shared]
        expired_shared = [x for x in (cred["expired"] if cred else []) if x in shared]

        rows.append({
            "id": "RP_" + k[:48],
            "person_key": k,
            "name": roster["names"][k],

            # ── HARD. Measured, attributable, and the only thing that ranks.
            "fact_period_from": period["start"],
            "fact_period_to": period["end"],
            "fact_shifts_rostered": len(cells),
            "fact_days_rostered": strain["days_on"],
            "fact_hours_rostered": strain["total_hours"],
            # THE COUNT, NEVER THE CODES. A house code stands 1:1 with a
            # client's home, so a list of them on a WORKER'S record is a list of
            # whose houses that worker is in — client identity filed under a
            # caregiver's name. The number of blocks is the fact that matters
            # here anyway: it is why a person's real calendar only exists when
            # their rows are added together. The grid and the Hours tab name the
            # houses, because those are roster cells; this row is not one.
            "fact_house_blocks": len(strain["houses"]),
            "fact_first_day": cells[0]["date"] if cells else "",
            "fact_last_day": cells[-1]["date"] if cells else "",
            "fact_preference_reading": "on_file" if pref else "none_on_file",
            "fact_stated_shifts": pref["shifts"] if pref else "",
            "fact_stated_note": pref["note"] if pref else "",
            "fact_stated_bars": " · ".join(b["said"] for b in pref["bars"]) if pref else "",
            "fact_weekend_pool": pref["weekend_pool"] if pref else "",
            # Blank is silence, not a refusal — 48 of 52 rows are blank.
            "fact_pickup": ("said yes" if pref and pref["pickup_said_yes"]
                            else ("not stated" if pref else "no row on file")),
            "fact_allergy_on_file": pref["allergy"] if pref else "",
            "fact_requests_touching_period": len(in_period),
            "fact_request_days": " · ".join(f'{r["from"]}→{r["to"]}' for r in in_period),
            "fact_qualification_reading": "counted" if cred else "no_credentials_row",
            "fact_expired_blocking": " · ".join(expired_hard),
            "fact_expired_shared_by_whole_roster": " · ".join(expired_shared),
            "fact_expiring_soon": " · ".join(
                _dated(x) for x in (cred["expiring"] if cred else [])),
            "fact_training_verdict": cred["training_verdict"] if cred else "",
            "fact_training_why": cred["training_why"] if cred else "",
            "fact_ist_owed": cred["ist_owed"] if cred else None,
            "fact_reach_reading": (
                "" if rt is None else
                ("text or email" if rt["phone"] and rt["email"]
                 else "text only" if rt["phone"]
                 else "email only" if rt["email"] else "no route on file")),
            "fact_reach_route_on_file": rt is not None,
            "fact_reach_window_from": rt["window_from"] if rt else "",
            "fact_reach_window_to": rt["window_to"] if rt else "",
            "fact_reach_window_why": rt["window_why"] if rt else "",

            # ── SOFT. Annotation only. Nothing below ever orders a list, and
            #    nothing below ever removes a name.
            "soft_longest_run_days": strain["longest_run_days"],
            "soft_busiest_week_start": strain["busiest_week_start"],
            "soft_busiest_week_hours": strain["busiest_week_hours"],
            "soft_overnights_rostered": strain["overnights"],
            "soft_back_to_back_days": " · ".join(strain["back_to_back_days"]),
            "soft_strain_measured_from": (
                "the published grid, cell by cell — NOT from Behavior Support, "
                "whose own shift arithmetic counts alias pointer cells and runs "
                "2x to 13x high about named people"),
            "soft_preference_contradicted": " · ".join(_contradictions(cells, pref)),
            "soft_call_offs_recorded_all_time": (
                sum(co["counts"][t] for t in ABSENT_TYPES) if co else None),
            "soft_late_shows_all_time": co["counts"]["late_show"] if co else None,
            "soft_call_off_reading": "counted" if co else "none_recorded",
            "soft_late_show_means": (
                "a late show is a shift this person WORKED; it is never summed "
                "into an absence anywhere in this reading"),
            "soft_attendance_books": a["sources"] if a else "",
            "soft_attendance_rate_state": a["rate_state"] if a else "not_served_here",
            "soft_attendance_denominator_says": a["rate_denominator_says"] if a else "",

            # ── REFUSED, in words, so a reader can see what was left out.
            "refused_behaviour_schedule_verdict": (
                "Behavior Support's shift_verdict and shift_why are withheld: "
                "they count alias pointer cells as shifts and are inflated 2x "
                "to 13x. Its requirements, courses and in-service training — "
                "the half it measures correctly — are used above."),
            "refused_site_measurements": (
                "how this person uses the intranet is not read at all: not as "
                "a rank key, not as a tiebreak, not greyed out"),
            "refused_call_off_prose": (
                "the fact and the type of an absence travel; the notes, how "
                "late, and who reported it never do"),
            "refused_client_identity": (
                "no address, no coordinates, no consumers and no house on a "
                "profile row — a person's record is not a roster cell"),
            "refused_absence_rate_as_a_rank": (
                "no rate orders anybody, and no rate is shown without the "
                "window and denominator it was computed over"),
            "freshness": fresh,
        })
    rows.sort(key=lambda r: (r["name"].lower(), r["person_key"]))
    return rows


# ── reading two: who could take a shift ───────────────────────────────────

def _candidate(k: str, vac: dict, ctx: dict, drop: dict | None) -> tuple[dict | None, str]:
    """One person against one vacancy: the ladder, in order, in words.

    Returns (candidate, "") or (None, the fact that refused them). The refusal
    is a SENTENCE, because an empty list with a reason is worth more than a
    plausible name.
    """
    cells = [c for c in ctx["roster"]["intervals"].get(k, [])
             if not (drop and c["sheet_row"] == drop["sheet_row"]
                     and c["date"] == drop["date"])]
    reasons: list[str] = []

    # 1 ── ALREADY ROSTERED AT THAT HOUR. The only fact that is solid, and the
    #      same test that names the eleven conflicts.
    clash = next((c for c in cells
                  if c["start"] < vac["end"] and vac["start"] < c["end"]), None)
    if clash:
        return None, (f'already rostered {clash["text"]} at {clash["house"]} '
                      f'on {clash["date"]}')
    reasons.append(f'free at {vac["text"]} on {vac["date"]} — no cell on any '
                   f'house block that hour')

    # 2 ── TURNAROUND. Reported, never enforced: no source states a minimum,
    #      and the number that defines nine of the eleven conflicts is not
    #      written down anywhere in this estate.
    before = [c for c in cells if c["end"] <= vac["start"]]
    after = [c for c in cells if c["start"] >= vac["end"]]
    gap_before = ((vac["start"] - max(c["end"] for c in before)).total_seconds() / 3600.0
                  if before else None)
    gap_after = ((min(c["start"] for c in after) - vac["end"]).total_seconds() / 3600.0
                 if after else None)
    if gap_before is None and gap_after is None:
        reasons.append("no other shift on this roster to turn around from")
    else:
        said = []
        if gap_before is not None:
            said.append(f"{gap_before:.1f}h since their last shift ended")
        if gap_after is not None:
            said.append(f"{gap_after:.1f}h before their next begins")
        reasons.append(" and ".join(said))

    # 3 ── ASKED THAT DAY OFF. Not an approval — there is no approval column.
    for r in ctx["requests"].get(k, []):
        if r["from"] and r["from"] <= vac["date"] <= r["to"]:
            return None, f'asked for {r["from"]} to {r["to"]} off'
    reasons.append("no time-off request covers that day")

    # 4 ── CALLED OFF THAT DAY. The past only; a future day is silence.
    co = ctx["call_offs"].get(k)
    kinds = (co["by_day"].get(vac["date"]) or []) if co else []
    absent = [t for t in kinds if t in ABSENT_TYPES]
    if absent and vac["date"] <= ctx["today"]:
        return None, f'a {absent[0].replace("_", " ")} is on record for that day'
    if vac["date"] > ctx["today"]:
        reasons.append("the call-off book cannot speak about a day still ahead, "
                       "and its silence there means nothing")
    elif kinds:
        reasons.append("the only call-off entry that day is a late show — they worked")
    else:
        reasons.append("no call-off on record for that day")

    # 5 ── A STATED PREFERENCE. Only negatives, only where one parses, never
    #      inverted, and silence is silence.
    pref = ctx["prefs"].get(k)
    weekday = vac["start"].weekday()
    if pref:
        for bar in pref["bars"]:
            if bar_hits(bar, weekday, vac["kind"]):
                return None, f'they wrote "{bar["said"]}"'
        reasons.append("nothing they wrote about their own week bars it"
                       if pref["bars"] else "no stated bar on their preferences row")
    else:
        reasons.append("no preference row on file — silence, which is not permission")

    # 6 ── QUALIFIED. Expired excludes, except where the whole roster shares it.
    cred = ctx["creds"].get(k)
    if cred is None:
        reasons.append("qualifications unknown — the credentials reading has no "
                       "row for them, and unknown is not unqualified")
    else:
        blocking = [x for x in cred["expired"] if x not in ctx["shared_expiries"]]
        if blocking:
            return None, "expired " + ", ".join(sorted(blocking))
        reasons.append("no expired requirement that tells one candidate from another")

    # 7 ── REACHABLE. Never excludes; says so on its own row.
    rt = ctx["routes"].get(k)
    if rt is None:
        reasons.append("no contact route on file — this one has to be asked in person")
    elif rt["phone"] and rt["email"]:
        reasons.append("reachable by text or email")
    elif rt["phone"]:
        reasons.append("reachable by text")
    elif rt["email"]:
        reasons.append("reachable by email only")
    else:
        reasons.append("a route row exists but carries no phone and no email")

    # ── SOFT, gathered after the ladder has finished, and never inside it.
    cautions: list[str] = []
    hours_week = _h(sum((c["end"] - c["start"]).total_seconds() / 3600.0
                        for c in cells
                        if _week_start(c["start"].date()) == _week_start(vac["start"].date())))
    dur = _h((vac["end"] - vac["start"]).total_seconds() / 3600.0)
    day_before = vac["start"].date() - timedelta(days=1)
    worked = {c["start"].date() for c in cells}
    run = 0
    while day_before in worked:
        run += 1
        day_before -= timedelta(days=1)
    cautions.append(f"{hours_week:.1f}h already rostered in that Saturday week; "
                    f"this shift would add {dur:.1f}h")
    if run:
        cautions.append(f"this would be day {run + 1} in a row for them")
    if gap_before is not None and gap_before <= dur:
        cautions.append(f"only {gap_before:.1f}h off between their last shift and "
                        f"this one — shorter than the shift itself")
    if pref and pref["pickup_said_yes"]:
        cautions.append("said yes to picking up extra shifts")
    if cred:
        shared = [x for x in cred["expired"] if x in ctx["shared_expiries"]]
        if shared:
            cautions.append("registry re-checks out of date across the whole "
                            "roster, this person included: " + ", ".join(sorted(shared)))
        if cred["expiring"]:
            cautions.append("expiring soon: " + ", ".join(
                _dated(x) for x in cred["expiring"]))
    if pref and pref["allergy"]:
        cautions.append(f'allergy or fear on file: {pref["allergy"]} — nothing in '
                        f'this estate records which house has a pet')
    att = ctx["attendance"].get(k)
    if att and att["sources"]:
        cautions.append(f'attendance books that know them: {att["sources"]} — '
                        f'a statement about the records, not about the person')

    rest = min([g for g in (gap_before, gap_after) if g is not None], default=None)
    return {
        "person_key": k,
        "name": ctx["roster"]["names"][k],
        # THE ORDER KEY, AND IT IS A HARD FACT: the smaller of the two gaps
        # either side. None means nothing on the roster to turn around from,
        # which is the most rested a person can be, so it sorts first.
        "rest_hours": rest,
        "gap_before_hours": None if gap_before is None else _h(gap_before),
        "gap_after_hours": None if gap_after is None else _h(gap_after),
        "reason": " · ".join(reasons),
        "reasons": reasons,
        "cautions": cautions,
        "reach": ("text or email" if rt and rt["phone"] and rt["email"]
                  else "text" if rt and rt["phone"]
                  else "email" if rt and rt["email"]
                  else "in person"),
        "reach_window": (f'{rt["window_from"]}–{rt["window_to"]}'
                         if rt and rt["window_from"] else ""),
        "hours_that_week": hours_week,
        "would_be_day_in_a_row": run + 1,
    }, ""


#: How many candidates travel in full. Everybody who qualifies is named — the
#: rest ride as a name and their rest hours, because a person dropped off the
#: end of a list is a person the desk cannot see.
DETAIL_CANDIDATES = 6


def _rank(vac: dict, ctx: dict, drop: dict | None) -> dict:
    kept, refused = [], Counter()
    for k in ctx["pool"]:
        got, why = _candidate(k, vac, ctx, drop)
        if got:
            kept.append(got)
        else:
            refused[why] += 1
    # THE SORT, AND IT TOUCHES NOTHING SOFT. Most rest first — a hard fact from
    # the roster that answers for every single candidate, so nobody sinks
    # because a field about them was missing — then the name, alphabetically,
    # so the tiebreak is visible rather than a hidden judgement.
    kept.sort(key=lambda c: (-(c["rest_hours"] if c["rest_hours"] is not None
                               else float("inf")), c["name"].lower()))
    # Which fact refused the most people, said as one sentence.
    top = refused.most_common(3)
    return {
        "candidates": kept[:DETAIL_CANDIDATES],
        "also": [{"name": c["name"], "rest_hours": c["rest_hours"]}
                 for c in kept[DETAIL_CANDIDATES:]],
        "qualified": len(kept),
        "considered": len(ctx["pool"]),
        "why_not": [{"because": why, "people": n} for why, n in top],
        "why_empty": ("" if kept else
                      ("nobody on this roster clears every hard fact for this "
                       "shift — " + "; ".join(f"{n} {why}" for why, n in top))
                      if refused else
                      "there is nobody on this roster to consider at all"),
    }


def suggestions(sources: dict, today: _date | None = None) -> list[dict]:
    """One row per shift that needs somebody, with the people who could take it.

    TWO KINDS, AND THE FIRST ONE IS NOT WHAT IT LOOKS LIKE:

      `conflict_release`  one of the two cells of a double-booking. A conflict
                          is an EXCESS, not a gap — the desk deletes or trims
                          one of two cells — so the question is asked per cell:
                          if this one is released, who could take it? Both
                          cells get a row, because choosing between them is the
                          desk's call and not this module's.

      `open_cell`         an OPEN row carrying real hours and no name. These
                          are the shifts that genuinely need a person.

    NOTHING IS ASSIGNED. Every row is a proposal; the click, the draft cell and
    the fail-closed publish all belong to code that already exists.
    """
    today_iso = (today or _date.today()).isoformat()
    roster = read_roster(sources.get("calendarGrid") or [])
    creds = read_credentials(sources.get("behaviorBoard") or [])
    pool = sorted(roster["intervals"])
    ctx = {
        "roster": roster,
        "prefs": read_preferences(sources.get("calendarStaff") or []),
        "requests": read_requests(sources.get("calendarRequests") or []),
        "call_offs": read_call_offs(sources.get("callOffs") or []),
        "creds": creds,
        "routes": read_routes(sources.get("commRoutes") or []),
        "attendance": read_attendance(sources.get("commAttendance") or []),
        "shared_expiries": universal_expiries(creds, pool),
        "pool": pool,
        "today": today_iso,
    }
    fresh = sources.get("freshness") or {}
    period = roster["period"]
    rows: list[dict] = []

    # ── the conflicts, cell by cell ──────────────────────────────────────
    for con in conflicts(roster):
        a, b = con["a"], con["b"]
        if not con["is_a_person"]:
            # NOT A STAFFING QUESTION, AND SAYING SO IS THE ANSWER. Proposing a
            # caregiver here would be proposing to cover hours that belong to a
            # placeholder the grid should not be treating as staff.
            n = roster["placeholders"].get(con["name"], 0)
            rows.append(_vacancy_row(
                kind="not_a_staffing_question", cell=a,
                got={"candidates": [], "also": [], "qualified": 0,
                     "considered": 0, "why_not": [], "why_empty": (
                         f'"{con["name"]}" is not an employee, so no name is '
                         f'proposed for these hours')},
                fresh=fresh, period=period, today=today_iso,
                headline=f'"{con["name"]}" is booked against itself at {a["house"]}',
                held_by=con["name"], side="A", other=b,
                overlap_hours=con["overlap_hours"], conflict_id=con["conflict_id"],
                shape=(
                    f'"{con["name"]}" holds two overlapping cells here, and it '
                    f'carries {n} cell(s) with real hours on a staff row across '
                    f'the period. The builder\'s own skip rule drops OPEN and '
                    f'WORKSHOP and lets this name through, which is why the '
                    f'conflict exists at all. There is no shift to staff: the '
                    f'repair is to the grid row, made by a person.')))
            continue
        shape = (
            f'the same name holds two cells that overlap by '
            f'{con["overlap_hours"]:.2f}h. This is an over-booking, not a gap: '
            f'the desk clears or trims one of the two, and only then is there a '
            f'shift for somebody else to take.')
        if con["overlap_hours"] <= 1.0:
            shape += (" An overlap this short is a turnaround, and the smaller "
                      "edit may be an end time rather than a person — no source "
                      "in this estate states a minimum turnaround.")
        for side, cell, other in (("A", a, b), ("B", b, a)):
            got = _rank(cell, ctx, drop=cell)
            rows.append(_vacancy_row(
                kind="conflict_release", cell=cell, got=got, fresh=fresh,
                period=period, today=today_iso,
                headline=f'{con["name"]} — release {cell["text"]} at {cell["house"]}',
                held_by=con["name"], side=side, other=other,
                overlap_hours=con["overlap_hours"], conflict_id=con["conflict_id"],
                shape=shape))

    # ── the OPEN cells: the shifts that actually need a body ─────────────
    for cell in roster["open_cells"]:
        got = _rank(cell, ctx, drop=None)
        rows.append(_vacancy_row(
            kind="open_cell", cell=cell, got=got, fresh=fresh, period=period,
            today=today_iso,
            headline=f'{cell["house"]} needs {cell["text"]}',
            held_by="", side="", other=None, overlap_hours=None, conflict_id="",
            shape=('an OPEN row carrying hours and no name — a shift that '
                   'exists with nobody on it. The generator refuses to put a '
                   'name on an OPEN row on purpose, and that refusal stands: '
                   'this row proposes, a person decides.')))

    rows.sort(key=lambda r: (r["date"] or "9999", r["kind"], r["house"], r["headline"]))
    return rows


def _vacancy_row(kind: str, cell: dict, got: dict, fresh: dict, period: dict,
                 today: str, headline: str, held_by: str, side: str,
                 other: dict | None, overlap_hours: float | None,
                 shape: str, conflict_id: str = "") -> dict:
    return {
        "id": f'CV_{kind}_{cell["sheet_row"]}_{cell["date"]}_{side or "x"}',
        "kind": kind,
        # The two rows of one conflict carry the same id here, so a screen can
        # put them side by side and a count of CONFLICTS is not a count of
        # cells — eleven conflicts, twenty-two possible releases.
        "conflict_id": conflict_id,
        "headline": headline,
        # A VACANCY MAY NAME ITS HOUSE. It is a roster cell, and the builder
        # already draws that column — the refusal is about what travels into a
        # record ABOUT A PERSON.
        "house": cell["house"],
        "date": cell["date"],
        "text": cell["text"],
        "shift_kind": cell["kind"],
        "starts_at": cell["start"].isoformat(timespec="minutes"),
        "ends_at": cell["end"].isoformat(timespec="minutes"),
        "hours": _h((cell["end"] - cell["start"]).total_seconds() / 3600.0),
        "sheet_row": cell["sheet_row"],
        "held_by": held_by,
        "conflict_side": side,
        "conflict_overlap_hours": overlap_hours,
        "conflict_other": (f'{other["text"]} at {other["house"]} on {other["date"]}'
                           if other else ""),
        "shape": shape,
        **got,
        "period_from": period["start"],
        "period_to": period["end"],
        # A shift already behind us cannot be covered by anybody, and saying so
        # is cheaper than letting a desk read a stale list as work to do.
        "is_in_the_past": bool(cell["date"] and cell["date"] < today),
        "freshness": fresh,
    }


# ── the probe: counts and shapes, and the measurement the brief asked for ──

def scan(sources: dict, today: _date | None = None) -> dict[str, Any]:
    """What the two readings measured, as numbers a human can check.

    The headline is the one the brief asked for: of the live conflicts, how
    many got a suggestion, how many got none, and which fact was missing.
    """
    roster = read_roster(sources.get("calendarGrid") or [])
    profs = profiles(sources, today)
    sugg = suggestions(sources, today)
    cons = conflicts(roster)
    by_kind: Counter = Counter(r["kind"] for r in sugg)

    # ONE ENTRY PER CONFLICT, not per cell: each conflict has two cells and so
    # two rows above, and a conflict counts as answered when EITHER of its two
    # releases has somebody who could take it.
    per_conflict: dict[str, dict] = {}
    for r in sugg:
        if not r["conflict_id"]:
            continue
        slot = per_conflict.setdefault(
            r["conflict_id"], {"who": r["held_by"], "best": 0, "why": [],
                               "kind": r["kind"]})
        slot["best"] = max(slot["best"], r["qualified"])
        if not r["qualified"] and r["why_empty"]:
            slot["why"].append(r["why_empty"])
    placeholders = sum(1 for r in sugg if r["kind"] == "not_a_staffing_question")
    placeholder_conflicts = sum(1 for c in cons if not c["is_a_person"])

    opens = [r for r in sugg if r["kind"] == "open_cell"]
    return {
        "period": roster["period"],
        "people_on_the_grid": len(roster["intervals"]),
        "placeholder_rows_refused": roster["placeholders"],
        "profiles": len(profs),
        "profiles_with_a_preference_row": sum(
            1 for r in profs if r["fact_preference_reading"] == "on_file"),
        "profiles_with_credentials": sum(
            1 for r in profs if r["fact_qualification_reading"] == "counted"),
        "profiles_with_a_contact_route": sum(
            1 for r in profs if r["fact_reach_route_on_file"]),
        "profiles_with_a_stated_bar": sum(1 for r in profs if r["fact_stated_bars"]),
        "profiles_contradicted_by_the_roster": sum(
            1 for r in profs if r["soft_preference_contradicted"]),
        "conflicts_found": len(cons),
        "conflicts_on_a_placeholder_row": placeholder_conflicts,
        "conflicts_with_at_least_one_candidate": sum(
            1 for v in per_conflict.values() if v["best"]),
        "conflicts_with_none": sum(1 for v in per_conflict.values() if not v["best"]),
        "conflicts_empty_because": Counter(
            v["why"][0] for v in per_conflict.values() if not v["best"] and v["why"]),
        "candidates_per_conflict": sorted(
            v["best"] for v in per_conflict.values() if v["best"]),
        "suggestion_rows": len(sugg),
        "suggestion_rows_by_kind": dict(by_kind),
        "placeholder_rows_in_the_reading": placeholders,
        "open_cells": len(opens),
        "open_cells_with_a_candidate": sum(1 for r in opens if r["qualified"]),
        "open_cells_with_none": sum(1 for r in opens if not r["qualified"]),
        "candidates_per_open_cell": (
            sorted(r["qualified"] for r in opens) if opens else []),
    }


if __name__ == "__main__":  # a read-only probe over a directory of slice files
    import json
    import os
    import sys

    where = sys.argv[1] if len(sys.argv) > 1 else "/srv/snapshot"
    loaded: dict[str, Any] = {}
    stamps: dict[str, str] = {}
    for name in SOURCES:
        path = os.path.join(where, f"{name}.json")
        try:
            with open(path) as fh:
                doc = json.load(fh)
            loaded[name] = doc.get("rows") or []
            stamps[name] = str(doc.get("built_at") or "")
        except Exception:  # noqa: BLE001 — a missing source is an honest empty
            loaded[name] = []
            stamps[name] = ""
    loaded["freshness"] = {"sources": stamps}
    print(json.dumps(scan(loaded), indent=2, sort_keys=True, default=str))
