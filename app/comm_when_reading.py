"""
WHEN THE PLATFORM MAY REACH SOMEBODY — a reader, not a sender.

The operator's rule, in his words:

    "a pessoa 15 minutos antes do seu shift pode receber mensagens e emails
     que não vai atrapalhar"
    "combine isso com os call offs que já temos no sistema quando uma pessoa
     decide não ir trabalhar, portanto o smart comms tem tudo"

Fifteen minutes before a shift the person is already up, dressed, phone in
hand. A message then does not wake them and does not interrupt care. That is
a fact about a PERSON'S OWN DAY, and the lane currently has no way to say it:
`CommPolicy.gs` holds one platform-wide pair of quiet hours, 21:00 to 08:00,
and applies it to all eighty-odd caregivers at once.

WHY THAT BLANKET IS WRONG HERE, BY THE ROSTER'S OWN NUMBERS. Of the next
shifts on the platform the six soonest all begin at 22:00 — Angela Foster,
Lesslie Covington, Marquea Kindell, Shakiah Sanders, Charmaine Johnson,
Temeka Provens, every one of them a 10P start. Under the blanket rule not one
of them can be told anything before their shift, because 22:00 is inside
"quiet" and so is every minute leading up to it. They are not asleep at 21:45.
They are putting their shoes on.

WHAT THIS MODULE ANSWERS, AND WHAT IT REFUSES TO

    moments(dsn)      when each person is reachable without being disturbed
    holds(dsn)        when they must NOT be reached, and why

    It does not send, does not choose a route, does not rank anybody, and
    never widens the platform's own quiet hours by itself. It proposes a
    narrow exception with a reason attached; `CommConsent.gs` still decides
    whether a person may be contacted at all, and `CommPolicy.gs` still owns
    the floor.

    A SENDER READS THIS NOW, NOT ONLY A SCREEN. `build("commWhen", dsn)` is
    imported by asa-hub/server/comm_when_feed.py, which hands the rows to the
    Hub's `comm_when` house; `CommWindowAsk.gs` reads that house to decide the
    minute it may ask somebody their preferred hours. It is imported rather
    than copied so that the Smart Comms page and the sender cannot come to
    disagree about when a person sleeps — which means a change to the shape of
    a `commWhen` row changes what a message-sending lane believes. The keys
    that lane depends on are: person_key, name, state, window_from, window_to,
    moment_at, shift_at, only_by_this_rule, why. `house` and `shift_code` are
    deliberately NOT among them — a site code stands 1:1 with a client's
    address, and a reading about a worker never publishes a client. Read it beside `server/comm_cortex.py`: that file answers
    "what hours is this person awake, in general"; this one answers "at what
    minute, on which day, is this specific person free to look at a phone".

────────────────────────────────────────────────────────────────────────────
THE PARSER, AND WHY IT DROPS MORE THAN IT KEEPS

`asa_schedules.shift_start` is not a column anything can be scheduled on. It
is filled on 13,640 of 40,602 rows, and on only 561 of the 3,149 rows still in
the future — every archive row has it and five in six of the live calendar's
rows do not. Reading it and stopping there would silently answer for a sixth
of the roster and refuse the rest.

So the hours have to come out of `shift_raw`, which is whatever the house
manager typed into the calendar cell, in 1,223 distinct spellings:

    8A-8P · 230P-10P · 10P-8:30A · 10P-830A · 930p-8a · 3:00p -10p
    8:00:00 AM-2:00:00 PM          the archive tabs, seconds and all
    OFF · R/O · C/O · NCNS         not working
    48TH (B) · BM · ADMIN · LD     WORKING, hour not written down
    BM > 8P-8A · 48TH (B)<7A-3P    a transfer; either half may carry hours
    8A-2P>930P-8A                  two shifts in one cell, both real

The grammar was not guessed: it is the one `server/comm_cortex.py`'s neighbour
`server/shift_slices.py` learned off the live tab, re-implemented here because
the two projects do not import each other. Three differences are deliberate
and each one matters to a message that will actually be sent:

  1. EVERY range in the cell becomes its own moment, not just the first. A
     person rostered "8A-2P>930P-8A" starts twice that day and deserves to be
     reachable before each — the second start, 21:30, is exactly the one the
     blanket rule refuses.
  2. The seconds spelling parses. "8:00:00 AM-2:00:00 PM" is 4,894 archive
     rows that read as a house token to a parser expecting "8A".
  3. A cell that cannot be read is DROPPED AND COUNTED, never guessed at. A
     guessed hour does not fail quietly — it sends a message at the wrong
     time, which is worse than sending none. `unreadable` in the counters is
     that pile, and it is meant to be looked at.

THE LARGEST CATEGORY IS NOT A PARSE FAILURE. Most future cells say "48TH (B)"
or "BM" — the house, not the hour. Those rows prove the person works that day
and say nothing about when. They are reported as `no_hour`, separately from
`unreadable`, because the fix is different: `unreadable` is a parser's problem,
`no_hour` is a spreadsheet that never held the fact.

HOW THE PARSER WAS CHECKED, since a wrong hour is the failure that matters.
The 13,640 rows on which the sheet DID write `shift_start` are an answer key
this module never reads at runtime, so it can be graded against them: 13,191
starts agree to the minute, 7 cells the parser declined ("8A-8P/JH",
"930P-830" — each one a genuine typo), and 8 "disagreements" every one of
which is a double like "*2P-10P>10P-830A", where the column recorded the
second start and this module emits BOTH. There is no case in the book where
the two read the same shift and disagree about its hour.

────────────────────────────────────────────────────────────────────────────
THE MOMENT IS A WINDOW, AND A NARROW ONE

A single minute is the wrong shape. Nothing in this platform sends at a named
instant: the relay runs on a clock, a queue drains in batches, and a message
is read when the person picks the phone up, not when it lands. So T-15 alone
would be a rule no scheduler could honour.

A window hours wide is the wrong shape too — that is the blanket rule again
with a friendlier name, and it reaches back into the sleep the rule exists to
protect.

So: OPEN at T-30, CLOSE at T-5. Half an hour is the ceiling because a
caregiver on a 22:00 start is provably not asleep at 21:30 (they have to
leave), and five minutes is the floor because a phone that buzzes as somebody
picks up the car keys is the interruption, not the exception. The operator's
own fifteen minutes sits in the middle, and is carried on the row as
`moment_at` so anything that wants the point rather than the window has it.

The asymmetry is on purpose. Too early wakes them — the exact harm quiet
hours exist to prevent. Too late catches them driving. Neither side of this
window is padding.

────────────────────────────────────────────────────────────────────────────
THE CALL-OFF, WHERE THE OBVIOUS ANSWER IS WRONG IN BOTH DIRECTIONS

A person who called off is not at a client's house, so the shift-shaped moment
is void — there is no 21:45 "getting ready" for a shift nobody is going to.
But the opposite conclusion is worse: somebody who called off sick at 6am is
not a free line for the 9am message about a missing CPR card. They are ill, or
their childcare collapsed, and the platform's business can wait a day.

THE RETIRED BOOK TYPES THE FACT. Four types, not one, and they do not get one
answer:

  Call Off          They decided not to go. The moment for that date is void
                    AND routine traffic holds for the rest of that local day.
                    This is the operator's own case.
  Sent Home         They came, started, and were sent home mid-shift. The
                    pre-shift moment has already passed, so nothing to void —
                    but the same day-long hold applies, for the same reason.
  No Show No Call   The moment is void, and the hold is NOT applied. This is
                    the one type where silence is the wrong answer: the house
                    is uncovered and the platform is trying to FIND this
                    person. The row carries `reach_anyway`, which says only
                    that this module refuses to call them unreachable — the
                    decision to send still belongs to the policy.
  Late Show         Nothing. THEY WORKED. It is recorded after the fact and
                    says nothing about any later shift. Treating a late show
                    as an absence would silence the platform toward the people
                    who showed up.

('No Show / No Call' and 'No Show No Call' are the same fact typed two ways,
2 rows against 53; they normalise to one.)

────────────────────────────────────────────────────────────────────────────
TWO BOOKS ANSWER THIS QUESTION, AND EVERY ROW SAYS WHICH ONE ANSWERED

The typed book above is the RETIRED one. It holds 559 rows, its newest is
months old, and no row in it touches any day this module can compute a moment
for. Reading it alone is how this module came to match nobody while believing
its own clean zero — the worst outcome this file could produce, because a
platform that believes nobody has called off sends accordingly.

A call-off does not arrive in that book any more. IT ARRIVES BY TELEPHONE. A
DSP rings the Employee Support Hotline, an AI agent transcribes the call, a
classifier files it as a work item, and the row lands in the Employee Support
Queue. That book is the live one, and it is a different animal:

    retired book   ONE ROW PER CALL-OFF, typed, with the date of the absence
                   written down, keyed by name and sometimes employee_id.
    live queue     ONE ROW PER PHONE CALL, categorised "Schedule - Call Off",
                   carrying the caller's NAME, a phone, the date they RANG,
                   and a transcript of what they said.

So this is not a table swap, and the difference is not cosmetic. Three facts
the retired book states outright are missing or different in the live one, and
each one is a decision written at the code that makes it:

  1. THE DAY. `date_received` is the day they PHONED. The day they will miss
     is stated in the transcript, and the transcript is prose this module may
     not forward or parse. So the live row NEVER VOIDS A MOMENT: voiding needs
     the absent date, and the live record does not carry it. It holds only the
     local day of the call — the one day the record actually states, and the
     operator's own case ("sick at 6am is not a free line for the CPR card at
     9am"). The absent date is reported `unknown`, in full, rather than
     guessed. A guessed absence silences somebody on a day they are working.

  2. THE TYPE. The live queue has ONE call-off category where the book had
     four. The missing three are not invented and the effects table above is
     NOT applied to a live row — applying "Call Off" to what was really a
     "Late Show" would silence a person who turned up. A live row is typed
     `reported_call_off`, which means exactly "a call about missing a shift,
     precise type not stated", and it carries its own, deliberately weaker
     effect so the two can never be confused at a call site.

  3. THE PERSON. The live row names a caller and a phone. A phone is the
     better key and the contacts lane already uses it — but MEASURED, 14 of
     the 19 call-offs carry one of the estate's OWN OpenPhone lines in
     `requestor_phone`, not the caller's number. Keying on that would route
     four different callers to whoever owns the line. So the phone arm refuses
     every estate line, and refuses everything if it cannot load the line list
     at all. The name arms are the estate's own matcher — the curated alias
     table, then `similarity()` at the threshold the roster's pg_trgm dedup
     panel already uses — under two guards the same lane taught: a one-word
     name is refused (it matched "Arthur" to "Alana Arthur" on the surname),
     and a name that matches two people is refused as ambiguous. A caller who
     resolves to a CLIENT is refused outright: this is a reading about a
     worker, and no client identity belongs in it.

THE MERGE RULE is the operator's settled one for disagreeing sources: the live
record decides where it speaks, the older record answers where the live one is
silent, and THE ROW SAYS WHICH. `call_off_source` carries that on every person,
and each fact carries its own `source` and `matched_by`.

AND EVERY ANSWER CARRIES ITS OWN STALENESS. Both books get their newest date
and its age measured on every build, and the figures ride out on every row in
`sources_freshness`. A reading that does not say how old it is gets mistaken for
current, and this module has already been fooled once by exactly that.

WHAT NEVER LEAVES THIS MODULE: the words. `description_of_request` and `notes`
in the live queue are a transcript of a phone call and can hold anything a
frightened person said at 6am; `notes`, `how_late` and `reported_by` in the
retired book are supervisors writing about employees' health. Neither reader
SELECTs those columns at all — not to summarise, not to log, not as evidence.
The fact and the category may travel. The prose may not.
"""
from __future__ import annotations

import re
from collections import Counter
from datetime import date as _date, datetime, timedelta, timezone
from typing import Any

import hub_rows
import lanes_pg as psycopg2
import shift_slices

try:                                       # the houses are in Canton, Ohio
    from zoneinfo import ZoneInfo
    ESTATE_TZ = ZoneInfo("America/New_York")
except Exception:                          # noqa: BLE001 — degraded, never broken
    ESTATE_TZ = timezone.utc

RESOURCES = ("commWhen", "commWhenMoments")

#: The roster mirror. Only the live calendar tab: the archive and the
#: per-house tabs stop months back and would answer for a past that is over.
SCHEDULE_TAB = "CALENDAR"

#: How far ahead a moment is worth computing. A week is what a queue can
#: plan against; past that the calendar is edited more often than it is read.
HORIZON_DAYS = 7

#: The window, in minutes before the shift starts. The operator's rule is the
#: point between them; see the header for why it is neither narrower nor wider.
OPEN_BEFORE_MIN = 30
CLOSE_BEFORE_MIN = 5
OPERATOR_POINT_MIN = 15

#: The platform-wide floor this module proposes an exception to, mirrored from
#: COMM_POLICY_FLOOR in apps-script/CommPolicy.gs. Kept as a literal because
#: the two projects do not import each other: if the Hub moves its floor, this
#: number is a deliberate edit in both places, never a silent drift.
QUIET_FROM_H = 21
QUIET_TO_H = 8

# ── the cell grammar ──────────────────────────────────────────────────────
# One time of day: 8A · 8:30A · 830a · 2pm · 1145a · 8:00:00 AM. Minutes are
# optional, with or without the colon; a seconds field is swallowed; the
# trailing "m" of "pm" and stray dots are tolerated.
_T = r"(\d{1,2})(?::?(\d{2}))?(?::\d{2})?\s*([AP])\.?M?\.?"
# The FIRST half may drop the meridiem entirely ("230-10p") and borrow the
# second's. The second half may not: "JH>230-10" is not a shift, it is a typo,
# and it is refused.
_T1 = r"(\d{1,2})(?::?(\d{2}))?(?::\d{2})?\s*(?:([AP])\.?M?\.?)?"
# A short trailing word is tolerated — "6P-7P IST", "*840A-8P (late)",
# "230p-10pSB" — because it is a note or a house code glued on, never an hour.
_RANGE = re.compile(
    rf"^\*?\s*{_T1}\s*[-–—]\s*{_T}(?:\s*\(?[A-Za-z]{{1,6}}\)?)?\s*$",
    re.IGNORECASE)
# Segment separators inside one cell: "BM > 8P-8A", "48TH (B)<7A-3P".
_CHAIN = re.compile(r"\s*[><]\s*")
# Cells that declare the person is NOT working. R/0 and R\O are real typos in
# the book; NCNS is the managers' shorthand for a no-show.
_NOT_WORKING = {"OFF", "R/O", "C/O", "RO", "R\\O", "R/0", "NCNS", "NO WORKSHOP",
                "VACATION", "PTO", "FMLA"}


def _key(v: Any) -> str:
    """`clientNameKey_` — the platform's own flattened name, as comm_cortex
    spells it, so a person keyed here is the same person keyed there."""
    return re.sub(r"[^a-z0-9]+", "", str(v or "").strip().lower())


def _minutes(h: str, m: str | None, ap: str) -> int | None:
    """One clock reading → minutes past midnight, or None when it is not one."""
    hour, minute = int(h), int(m or 0)
    if not 1 <= hour <= 12 or minute >= 60:
        return None                        # "13P", "8:75A": refuse, never round
    return (hour % 12 + (12 if ap.upper() == "P" else 0)) * 60 + minute


def _span(segment: str) -> tuple[int, int] | None:
    """One segment → (start, end) in minutes past midnight, end possibly past
    24h when the shift crosses into tomorrow. None when it is not a range."""
    m = _RANGE.match(segment.strip())
    if not m:
        return None
    h1, m1, ap1, h2, m2, ap2 = m.groups()
    borrowed = ap1 is None
    start = _minutes(h1, m1, ap1 or ap2)
    end = _minutes(h2, m2, ap2)
    if start is None or end is None:
        return None
    if borrowed and start >= end:
        # "230-10p": the first half borrowed "p" and landed after the end, so
        # it was the morning half of the day all along.
        start = (start - 12 * 60) % (24 * 60)
    if end <= start:
        end += 24 * 60                     # crosses midnight
    return start, end


def read_cell(raw: str) -> dict:
    """One calendar cell → what it says about hours. Never guesses.

    kind is one of:
      "hours"      at least one start could be read; `spans` carries them all
      "off"        the cell declares the person is not working
      "no_hour"    a house token or ADMIN — working, hour not written down
      "unreadable" something is in there but this parser will not risk it
      "empty"      nothing at all
    """
    code = str(raw or "").strip()
    if not code:
        return {"kind": "empty", "code": "", "spans": []}
    spans = []
    leftovers = []
    for seg in (s for s in _CHAIN.split(code) if s.strip()):
        got = _span(seg)
        if got:
            spans.append(got)
        else:
            leftovers.append(seg.strip())
    shown = code.lstrip("*").strip()
    if spans:
        return {"kind": "hours", "code": shown, "spans": sorted(set(spans))}
    up = shown.upper()
    if up in _NOT_WORKING or all(s.upper() in _NOT_WORKING for s in leftovers):
        return {"kind": "off", "code": up, "spans": []}
    # No hours anywhere. A cell carrying digits and a dash was TRYING to be a
    # time and this parser could not read it — that is a different pile from a
    # house code, and the only one anybody needs to go and fix.
    looks_like_a_time = bool(re.search(r"\d", shown) and re.search(r"[-–—]", shown))
    return {"kind": "unreadable" if looks_like_a_time else "no_hour",
            "code": shown, "spans": []}


# ── the call-off books ────────────────────────────────────────────────────
#: THE RETIRED BOOK. Typed, dated, keyed by name — and months behind. It is
#: still read on every build: it is where the type vocabulary lives and where
#: the history is, and it answers for every day the live queue is silent on.
#: Read as asa-hub-db keeps it: MyLife OS — Employee Entities › entity_call_offs.
RETIRED_BOOK_ID, RETIRED_TAB = "12v9fEnlJwO9GzGOGhskdRVZM5TqHHb65CJF4icHcAmE", "entity_call_offs"
RETIRED_BOOK = "MyLife OS — Employee Entities › entity_call_offs"

#: THE LIVE QUEUE. One row per phone call to the Employee Support Hotline,
#: classified into a controlled category and written here by the hotline lane.
#: Read as asa-hub-db keeps it: Employee Support Queue › Requests.
LIVE_QUEUE_ID, LIVE_QUEUE_TAB = "1nALj7QPqBYuEw-2RKrY2oEFcE73RKfvVaa4YoESgJw0", "Requests"
LIVE_QUEUE = "Employee Support Queue › Requests"

#: The ONE category in that queue that is an absence. Its three scheduling
#: siblings — "Schedule - Shift Changes", "- Time Off Request", "- Coverage" —
#: are about a future roster, not about a shift somebody is missing now, and
#: reading them here would hold a person's whole day for asking a question.
LIVE_CALL_OFF_CATEGORY = "Schedule - Call Off"

#: The book spells the same fact two ways; they normalise to one.
_CALL_OFF_TYPES = {
    "call off": "call_off",
    "no show no call": "no_show",
    "no show / no call": "no_show",
    "late show": "late_show",
    "sent home": "sent_home",
}

#: What each type does to a person's day. `voids` kills the shift-shaped
#: moment for that date; `holds` stops routine traffic for the rest of that
#: local day; `reach_anyway` says the platform is trying to FIND them.
CALL_OFF_EFFECT = {
    "call_off":  {"voids": True,  "holds": True,  "reach_anyway": False,
                  "why": "called off this shift — not getting ready, and not a free line for routine traffic today"},
    "sent_home": {"voids": False, "holds": True,  "reach_anyway": False,
                  "why": "sent home mid-shift — the day is theirs, routine traffic waits"},
    "no_show":   {"voids": True,  "holds": False, "reach_anyway": True,
                  "why": "no show, no call — the house is uncovered; this module will not call them unreachable"},
    "late_show": {"voids": False, "holds": False, "reach_anyway": False,
                  "why": "late show — they worked; this changes nothing about reaching them"},
}

#: THE LIVE QUEUE'S OWN TYPE, AND IT IS DELIBERATELY NOT A ROW OF
#: `CALL_OFF_EFFECT`. The queue has one category where the book had four, so a
#: live row is not a "Call Off" — it is a call ABOUT missing a shift, and the
#: three other things that call could have been (a late show, a no-show found
#: out afterwards, a person sent home) are not distinguishable without reading
#: the transcript. Keeping it out of the typed table is the whole guard: no
#: call site can reach the "Call Off" effect from a live row by accident, and
#: applying that effect to what was really a late show would silence somebody
#: who turned up for their shift.
#:
#: What it may do, therefore, is strictly less:
#:   voids        NO. Voiding a moment needs the day of the absence, and the
#:                live row does not carry one (see `absent_on` below).
#:   holds        YES, and only on the day of the call — the single day the
#:                record states. That is the operator's own case.
#:   reach_anyway NO. `reach_anyway` belongs to a no-show, which is a fact
#:                nobody has established here; claiming it would tell the
#:                platform to chase a person who may be at work.
LIVE_KIND = "reported_call_off"
LIVE_EFFECT = {
    "voids": False, "holds": True, "reach_anyway": False,
    "why": ("called the support line about missing a shift — the day of the call is "
            "theirs; the absent day is not stated in anything this module may read"),
}

_US_DATE = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\b")
#: `date_received` is a sheet column five different hands have written into.
#: MEASURED across the whole queue: 239 ISO, 54 US, 52 US with a time, 2 in a
#: browser's own `Date.toString()` spelling (truncated by the cell), 2 blank.
#: A single `to_date()` over this column does not degrade — it RAISES, and the
#: rows behind the raise are lost with it. So each shape is read on its own
#: terms and anything left over is counted, never guessed at.
_ISO_DATE = re.compile(r"^\s*(\d{4})-(\d{1,2})-(\d{1,2})\b")
_WORD_DATE = re.compile(
    r"^\s*(?:[A-Za-z]{3,9},?\s+)?([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b")
_MONTHS = {m: i for i, m in enumerate(
    ("jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"), start=1)}


def _us_date(raw: Any) -> _date | None:
    """M/D/YYYY, the only shape the retired book writes. Two-digit years are
    refused rather than pivoted: a call-off placed a century off is a silent
    hold."""
    m = _US_DATE.match(str(raw or ""))
    if not m:
        return None
    try:
        return _date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    except ValueError:
        return None


def _queue_date(raw: Any) -> _date | None:
    """The live queue's `date_received`, in every spelling it is written in.

    Order matters: ISO is tried first because a four-digit-year spelling and an M/D/Y one are
    both in the column and only one of them starts with four digits. A trailing
    time is ignored — this module answers about a DAY, and the minute a call
    landed is not a fact it needs.
    """
    s = str(raw or "").strip()
    if not s:
        return None
    m = _ISO_DATE.match(s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        m = _US_DATE.match(s)
        if m:
            mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        else:
            m = _WORD_DATE.match(s)
            if not m:
                return None
            mo = _MONTHS.get(m.group(1)[:3].lower(), 0)
            d, y = int(m.group(2)), int(m.group(3))
    try:
        return _date(y, mo, d)
    except ValueError:
        return None


# ── who rang: the estate's own matcher, and the guards it already taught ───
#
# THE PHONE IS THE BETTER KEY AND THE COLUMN IS NOT THE PHONE. Measured on the
# nineteen call-offs in the live queue: fourteen of them carry one of ASA's own
# OpenPhone lines in `requestor_phone` — the line the call arrived on, not the
# number the caller dialled from. Four different callers share "+1 330 919
# 5559"; two more share the line whose owner is the person named on a third
# row. Keying on that column as it stands would hand one owner every call-off
# in the book, and then message them about absences that are not theirs.
#
# So the phone arm asks the estate which numbers are ITS OWN and refuses every
# one of them. If that list cannot be read, the arm refuses EVERYTHING: a
# matcher that cannot tell a caller from the company is not degraded, it is
# dangerous, and failing closed costs a match while failing open costs a
# message to the wrong person.

#: The trigram floor. This is the threshold the estate's own pg_trgm dedup lane
#: already runs at — `GET /candidates/duplicates` in app/admin/roster.py, which
#: surfaces "Maria Silva" ≈ "Maria DaSilva" for an operator to confirm. Kept
#: identical on purpose: two lanes that disagree about who counts as the same
#: person are two lanes that will disagree about who gets a message.
NAME_SIM_MIN = 0.45

#: Names that are not a person. The classifier writes its own placeholders into
#: `requestor` when the transcript did not say who was calling, and the company
#: itself is a row in `ops.employees` — the same shape that once let a company
#: name hijack a patient profile, which is why the entity resolver keeps a
#: roster-only mode. Resolving any of these would attach a call-off to whoever
#: the fuzzy matcher liked best.
_NOT_A_PERSON = {
    "undetermined", "unknown", "unspecified", "not specified",
    "not specified in transcript", "n/a", "na", "none", "null", "anonymous",
    "caller", "employee", "staff", "test", "asa lifecare", "asa life care",
    "asalifecare", "asa", "abd", "a brighter dawn",
}


def _digits10(raw: Any) -> str:
    """The last ten digits of anything phone-shaped, or "". Ten is the join:
    the queue writes "13309195559", "(937) 716-6410" and "9377166410" for
    numbers that are the same line."""
    d = re.sub(r"\D", "", str(raw or ""))
    return d[-10:] if len(d) >= 10 else ""


def _name_tokens(raw: Any) -> list[str]:
    """Word-ish chunks of a name. Used only to count them — see below."""
    return [t for t in re.split(r"[\s,]+", str(raw or "").strip())
            if t and re.search(r"[A-Za-z]", t)]


class _Whois:
    """The estate's answer to "who rang", in the order the estate itself
    trusts: its own curated aliases before a fuzzy score, and a phone before
    either — when the phone is a person's.

    Every arm can refuse, and refusing is the point. `matched_by` says which
    arm answered so a human reading a row can see how much to trust it.
    """

    def __init__(self, cur) -> None:
        self._cur = cur
        self._memo: dict[tuple[str, str], tuple[str, str, str]] = {}
        self._trgm = True

        # pg_trgm, asked once. A missing extension must not poison the
        # transaction that every other read of this build shares, so it is the
        # first statement and the rollback is immediate.
        try:
            cur.execute("SELECT similarity('a', 'a')")
            cur.fetchone()
        except Exception:                      # noqa: BLE001 — arm off, module on
            self._trgm = False
            cur.connection.rollback()

        # THE ESTATE'S OWN LINES. Fail closed: no list, no phone arm.
        self.lines: set[str] = set()
        self.lines_known = False
        try:
            cur.execute("SELECT number FROM public.asa_openphone_lines")
            self.lines = {d for d in (_digits10(r["number"]) for r in cur.fetchall()) if d}
            self.lines_known = bool(self.lines)
        except Exception:                      # noqa: BLE001
            cur.connection.rollback()

        # THE PHONE BOOK, from the two places the estate keeps one: the merged
        # person record the contacts lane feeds, and the number a house manager
        # typed on the live calendar. A number that reaches two different
        # people is not a key and is dropped rather than picked between.
        claims: dict[str, set[str]] = {}
        names: dict[str, str] = {}
        books: list[list[dict]] = []
        try:
            cur.execute("SELECT display_name AS n, profile->>'phone' AS p FROM ops.employees")
            books.append(list(cur.fetchall()))
        except Exception:                      # noqa: BLE001
            cur.connection.rollback()
        try:
            # the calendar's numbers off the CALENDAR grids asa-hub-db keeps
            books.append([{"n": n, "p": p} for n, p in shift_slices.staff_phones()])
        except Exception:                      # noqa: BLE001 - no calendar number joins anyone
            pass
        for got in books:
            for r in got:
                d, who = _digits10(r["p"]), _key(r["n"])
                if not d or not who:
                    continue
                claims.setdefault(d, set()).add(who)
                names.setdefault(who, str(r["n"] or "").strip())
        self.phones = {d: (next(iter(w)), names.get(next(iter(w)), ""))
                       for d, w in claims.items()
                       if len(w) == 1 and d not in self.lines}

        # THE CURATED ALIASES. `asa_entity_aliases` is the table the dialog
        # resolver owns and the operator teaches. STAFF ONLY: a call-off is a
        # reading about a worker, and the same table resolves "Woody Allen" to
        # a CLIENT — an identity that must never appear in this answer.
        self.aliases: dict[str, str] = {}
        try:
            cur.execute("SELECT alias_norm, canonical FROM asa_entity_aliases "
                        "WHERE kind = 'staff'")
            for r in cur.fetchall():
                a = re.sub(r"\s+", " ", str(r["alias_norm"] or "").strip().lower())
                if a:
                    self.aliases.setdefault(a, str(r["canonical"] or "").strip())
        except Exception:                      # noqa: BLE001
            cur.connection.rollback()
        # The client-kinded aliases are loaded too, as a REFUSAL LIST rather
        # than an answer: knowing that a name belongs to a client is how this
        # module declines to guess at it with a fuzzy score afterwards.
        self.client_aliases: set[str] = set()
        try:
            cur.execute("SELECT alias_norm FROM asa_entity_aliases WHERE kind = 'client'")
            self.client_aliases = {
                re.sub(r"\s+", " ", str(r["alias_norm"] or "").strip().lower())
                for r in cur.fetchall()}
        except Exception:                      # noqa: BLE001
            cur.connection.rollback()

    # -- the arms ---------------------------------------------------------
    def _by_trgm(self, norm: str) -> tuple[str, str] | None:
        """One name → the single employee it is trigram-similar to, or None.

        TWO CANDIDATES IS NO CANDIDATE. If the threshold is cleared twice the
        row is ambiguous, and picking the higher score is how a lane silently
        starts messaging the wrong half of a pair of siblings.
        """
        if not self._trgm:
            return None
        try:
            self._cur.execute(
                "SELECT display_name, similarity(%s, lower(display_name)) AS sim "
                "FROM ops.employees "
                "WHERE similarity(%s, lower(display_name)) >= %s "
                "ORDER BY sim DESC LIMIT 3", (norm, norm, NAME_SIM_MIN))
            hits = self._cur.fetchall()
        except Exception:                      # noqa: BLE001
            self._cur.connection.rollback()
            self._trgm = False
            return None
        if len(hits) != 1:
            return None
        return _key(hits[0]["display_name"]), str(hits[0]["display_name"] or "").strip()

    def resolve(self, name: Any, phone: Any) -> tuple[str, str, str]:
        """(person_key, display_name, matched_by). All three empty on a miss,
        and a miss is a real answer: the row says `unresolved` and attaches to
        nobody, rather than attaching to somebody nearby."""
        norm = re.sub(r"\s+", " ", str(name or "").strip().lower())
        d = _digits10(phone)
        memo = (norm, d)
        if memo in self._memo:
            return self._memo[memo]
        got = self._ladder(norm, d)
        self._memo[memo] = got
        return got

    def _ladder(self, norm: str, d: str) -> tuple[str, str, str]:
        """The rungs, in the order the estate trusts them. Every refusal is
        NAMED rather than falling through to a bare miss, so the probe can say
        how many callers each guard turned away and why."""
        # 1 — THE PHONE, when it is a person's and not the estate's own line.
        # An estate line DISQUALIFIES THE PHONE ARM, it does not disqualify the
        # row: fourteen of the nineteen call-offs arrived on an estate line and
        # most of them still name their caller, so the ladder falls through to
        # the name arms rather than throwing the row away with the column.
        on_estate_line = bool(d) and self.lines_known and d in self.lines
        if d and self.lines_known and not on_estate_line and d in self.phones:
            who, disp = self.phones[d]
            return (who, disp, "phone")
        if not norm:
            return ("", "", "refused_estate_line" if on_estate_line
                    else "refused_no_name")
        if norm in _NOT_A_PERSON:
            # The classifier's own placeholder, or the company's name.
            return ("", "", "refused_not_a_person")
        if len(_name_tokens(norm)) < 2:
            # A ONE-WORD NAME IS NOT AN IDENTITY HERE, and the guard sits above
            # BOTH name arms rather than only over the fuzzy one. Measured:
            # "Arthur" scores 0.583 against "Alana Arthur" — a surname match on
            # a stranger's first name — and the curated alias table answers it
            # "Arthur Rodrigues" while the sibling rows in the same queue say
            # "Arthur Collins" and the line it arrived on belongs to a third
            # Arthur. The alias table is right for the chat resolver, where a
            # human sees the answer and corrects it; here the answer becomes a
            # day-long hold on a named person's phone, unseen. So one word is
            # refused whoever offers it, which is also what the estate's own
            # resolver means by requiring another token to anchor a short one.
            return ("", "", "refused_one_word")
        # 2 — THE CURATED ALIAS, staff only.
        if self.aliases.get(norm):
            return (_key(self.aliases[norm]), self.aliases[norm], "alias")
        if norm in self.client_aliases:
            # A known client. Refused loudly rather than passed to the fuzzy
            # arm, which would find some employee who rhymes.
            return ("", "", "refused_client")
        # 3 — THE ESTATE'S TRIGRAM LANE, at its own threshold.
        hit = self._by_trgm(norm)
        if hit:
            return (hit[0], hit[1], "name_trgm")
        return ("", "", "unresolved")


# ── reading the two books ─────────────────────────────────────────────────

def _age(newest: _date | None, today: _date) -> dict:
    """A source's own staleness, in the two numbers a reader needs."""
    return {"newest": newest.isoformat() if newest else "",
            "stale_days": (today - newest).days if newest else None}


def call_offs_retired(cur, since: _date, until: _date
                      ) -> tuple[dict[str, list[dict]], dict]:
    """The typed book. person_key → facts touching [since, until].

    The book is a sheet mirror: `date` is text and employee_id is blank on more
    than half the rows, so the join is by flattened NAME — the same key
    comm_cortex and the contacts lane use. `notes`, `how_late` and `reported_by`
    are NOT selected: they are supervisors writing about employees' health, and
    a column this module never loads is a column it can never leak.
    """
    out: dict[str, list[dict]] = {}
    seen: Counter = Counter()
    newest: _date | None = None
    for r in hub_rows.rows(RETIRED_BOOK_ID, RETIRED_TAB, fields=["employee_name", "date", "type"]):
        seen["rows"] += 1
        kind = _CALL_OFF_TYPES.get(str(r["type"] or "").strip().lower())
        day = _us_date(r["date"])
        who = _key(r["employee_name"])
        if not kind or not who:
            seen["unreadable_type_or_name"] += 1
            continue
        if day is None:
            seen["unreadable_date"] += 1
            continue
        seen["read"] += 1
        newest = day if newest is None or day > newest else newest
        if not (since <= day <= until):
            continue
        seen["in_window"] += 1
        out.setdefault(who, []).append({
            "kind": kind,
            "source": "retired_book",
            "matched_by": "book_name",
            "effect": CALL_OFF_EFFECT[kind],
            # The book states the day of the absence outright. That is the one
            # thing the live queue cannot do, and the reason this book is still
            # allowed to void a moment.
            "absent_on": day,
            "holds_on": day,
            "reported_on": day,
        })
    return out, {"counts": dict(seen), "newest": newest}


def call_offs_live(cur, whois: _Whois, since: _date, until: _date
                   ) -> tuple[dict[str, list[dict]], dict]:
    """The hotline queue. person_key → facts whose CALL DAY is in [since, until].

    Three translations happen here and each one is a refusal as much as a read:

      THE DAY. `date_received` is when the phone rang. The absent day may be
      that day, the next, or a run of days, and it is stated only in the
      transcript — prose this module is forbidden to forward and refuses to
      parse. So `absent_on` is None on every live fact, the effect cannot void
      anything, and the hold lands on the day of the call. That is the one day
      the record states, and it is the operator's own case: a person who phoned
      the support line at 6am is not a free line for routine traffic at 9am.
      Where even the call date will not parse, the row produces NO EFFECT AT
      ALL and is counted — missing is not zero, and a hold placed on a guessed
      day silences somebody on a day they are working.

      THE TYPE. One category, four possible facts behind it. The row is typed
      `reported_call_off` and carries `LIVE_EFFECT`, which is strictly weaker
      than any row of `CALL_OFF_EFFECT` and is not reachable from it.

      THE PERSON. `_Whois` above, with its phone arm, its curated aliases and
      the roster's own trigram threshold. Unresolved rows are counted and
      dropped — they cannot be attached to a person, and attaching them to a
      near-miss is the failure this whole ladder exists to prevent.
    """
    out: dict[str, list[dict]] = {}
    seen: Counter = Counter()
    by_arm: Counter = Counter()
    newest: _date | None = None
    got = hub_rows.rows(LIVE_QUEUE_ID, LIVE_QUEUE_TAB, where={"Type of Request": LIVE_CALL_OFF_CATEGORY},
                        fields=["Requestor", "Requestor Phone", "Date Received"])
    for d in got:
        r = {"requestor": d.get("Requestor"), "requestor_phone": d.get("Requestor Phone"),
             "date_received": d.get("Date Received")}
        seen["rows"] += 1
        day = _queue_date(r["date_received"])
        if day is None:
            seen["unreadable_date"] += 1
        else:
            newest = day if newest is None or day > newest else newest
        who, disp, arm = whois.resolve(r["requestor"], r["requestor_phone"])
        by_arm[arm or "unresolved"] += 1
        if not who:
            seen["unresolved_person"] += 1
            continue
        seen["resolved"] += 1
        if day is None:
            # Resolved to a person, and the call has no readable day. There is
            # nothing this module may safely conclude about their week, so it
            # concludes nothing.
            seen["resolved_without_a_day"] += 1
            continue
        if not (since <= day <= until):
            continue
        seen["in_window"] += 1
        out.setdefault(who, []).append({
            "kind": LIVE_KIND,
            "source": "live_queue",
            "matched_by": arm,
            "name": disp,
            "effect": LIVE_EFFECT,
            # UNKNOWN, and said so. The absent day is in the transcript.
            "absent_on": None,
            "holds_on": day,
            "reported_on": day,
        })
    return out, {"counts": dict(seen), "by_arm": dict(by_arm), "newest": newest}


def call_off_facts(dsn: str, since: _date, until: _date
                   ) -> tuple[dict[str, list[dict]], dict]:
    """Both books, merged the operator's way: the live record decides where it
    speaks, the older record answers where the live one is silent, and the row
    says which.

    In practice the two barely overlap — the retired book stopped months before
    the queue began — so the merge is mostly a union. Where they DO collide on
    the same person and the same day, the live fact stands and the older one is
    dropped and counted, because the live book is the one still being written.

    Returns (person_key → facts, report) where `report` carries each source's
    own newest date and staleness. Both figures ride out on every row.
    """
    today = _today()
    with psycopg2.connect(dsn) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        whois = _Whois(cur)
        old, old_meta = call_offs_retired(cur, since, until)
        new, new_meta = call_offs_live(cur, whois, since, until)

    merged: dict[str, list[dict]] = {}
    corroborated = 0
    doubled = 0
    for who in set(old) | set(new):
        # ONE CALL, ONE FACT. The queue holds the same call more than once —
        # a row filed while the call was still Pending and a second row after
        # it was Processed — and two rows that say the same thing about the
        # same person on the same day are one fact about that person's day,
        # not two. Collapsing them loses nothing: the kind, the source and the
        # effect are identical, and the hold is the same midnight either way.
        live, seen_live = [], set()
        for f in new.get(who, []):
            stamp = (f["kind"], f["holds_on"])
            if stamp in seen_live:
                doubled += 1
                continue
            seen_live.add(stamp)
            live.append(f)
        # WHERE BOTH BOOKS SPEAK ABOUT THE SAME PERSON AND THE SAME DAY they
        # answer DIFFERENT halves of one question, and the operator's rule
        # takes each half from whoever states it. The live row states that a
        # call came in and on what day; it is SILENT on the type and silent on
        # the day of the absence. The older row states both. So the older row
        # SURVIVES and the live one folds into it as corroboration: the fact
        # that stands keeps the book's type and gains the live queue's name on
        # its source, so the row still says that both books answered.
        #
        # THE LIVE ROW MAY NOT SHADOW THE OLDER ONE, and the data says why.
        # Shylah Walker's call on 3/6/2026 sits on top of a typed "Call Off"
        # for that same day. Letting the call win would trade a fact that VOIDS
        # her pre-shift moment for one that cannot, and reopen a getting-ready
        # window for a shift she had already called off. The live record is
        # more CURRENT; on the type it is not better informed, and "the live
        # record decides WHERE IT SPEAKS" is the whole of the rule.
        #
        # Note what is being compared: the live fact's day is the day of the
        # CALL and the book's is the day of the ABSENCE. They are only ever
        # matched here, to collapse one event recorded twice; nowhere else does
        # either day stand in for the other.
        typed_days = {f["absent_on"] for f in old.get(who, [])
                      if f["absent_on"] is not None}
        both = {f["holds_on"] for f in live
                if f["holds_on"] is not None and f["holds_on"] in typed_days}
        corroborated += len(both)
        merged[who] = [f for f in live if f["holds_on"] not in both] + [
            dict(f, source="live_queue+retired_book")
            if f["absent_on"] in both else f
            for f in old.get(who, [])]

    report = {
        "live_queue": dict(_age(new_meta["newest"], today), **new_meta["counts"],
                           by_arm=new_meta["by_arm"], table=LIVE_QUEUE),
        "retired_book": dict(_age(old_meta["newest"], today), **old_meta["counts"],
                             table=RETIRED_BOOK),
        "days_both_books_state": corroborated,
        "live_rows_the_same_call_twice": doubled,
        "phone_arm_armed": whois.lines_known,
        "estate_lines_known": len(whois.lines),
        "phone_book_size": len(whois.phones),
        "people_with_a_fact": len(merged),
    }
    # The sentence every row carries. A reading that does not say how old its
    # sources are gets read as current; this module has been fooled by exactly
    # that once already.
    report["freshness"] = "; ".join(
        f"{name} newest {s['newest'] or 'never'}"
        + (f" ({s['stale_days']}d old)" if s["stale_days"] is not None else "")
        for name, s in (("live queue", report["live_queue"]),
                        ("retired book", report["retired_book"])))
    return merged, report


# ── the roster ────────────────────────────────────────────────────────────

def _today() -> _date:
    """Today where the HOUSES are. The container runs UTC, so after 20:00
    Eastern a UTC 'today' is already tomorrow and every 22:00 start would be
    computed against the wrong day."""
    return datetime.now(ESTATE_TZ).date()


def _at(day: _date, minutes: int) -> datetime:
    """A day plus minutes-past-midnight → a real local instant. A span that
    crossed midnight carries minutes past 1440 and rolls the date for free."""
    return datetime(day.year, day.month, day.day, tzinfo=ESTATE_TZ) + timedelta(minutes=minutes)


def _inside_quiet(start: datetime, end: datetime) -> bool:
    """Does any part of this window fall inside the platform's quiet hours?

    That is the whole value of the rule: a window entirely inside working
    daylight was already allowed and this module changes nothing for it.
    """
    probe = start
    while probe <= end:
        if probe.hour >= QUIET_FROM_H or probe.hour < QUIET_TO_H:
            return True
        probe += timedelta(minutes=5)
    return False


def moments(dsn: str, horizon_days: int = HORIZON_DAYS
            ) -> tuple[list[dict], dict, dict[str, str]]:
    """Every reachable moment on the roster inside the horizon.

    Returns (moments, counters, everybody) where `everybody` maps person_key →
    display name for EVERY person the roster names in the window, including
    the ones no cell of whose week could be read. They are carried out of here
    on purpose: a person missing from the answer reads as "never reachable" to
    anything that takes silence for a verdict, and that is the opposite of
    what an unreadable cell means.

    One moment per (person, shift start): a person rostered twice in a day is
    reachable twice, and the second start is usually the one the blanket rule
    refused.
    """
    today = _today()
    until = today + timedelta(days=horizon_days - 1)
    counts = Counter()
    rows: list[dict] = []
    # the roster off the CALENDAR grids asa-hub-db keeps, published cells laid (shift_slices.roster)
    roster = shift_slices.roster(today, until)
    everybody: dict[str, str] = {}
    for r in roster:
        counts["rows"] += 1
        cell = read_cell(r["shift_raw"])
        counts[cell["kind"]] += 1
        who = _key(r["staff_name"])
        if not who:
            continue
        everybody.setdefault(who, str(r["staff_name"] or "").strip())
        if cell["kind"] != "hours":
            continue
        for start_min, end_min in cell["spans"]:
            begins = _at(r["shift_date"], start_min)
            opens = begins - timedelta(minutes=OPEN_BEFORE_MIN)
            closes = begins - timedelta(minutes=CLOSE_BEFORE_MIN)
            if closes <= datetime.now(ESTATE_TZ):
                counts["already_past"] += 1
                continue
            only_by_rule = _inside_quiet(opens, closes)
            counts["moments"] += 1
            counts["only_by_this_rule"] += 1 if only_by_rule else 0
            rows.append({
                "person_key": who,
                "name": str(r["staff_name"] or "").strip(),
                "house": str(r["house"] or ""),
                "shift_date": r["shift_date"],
                "shift_code": cell["code"],
                "shift_at": begins,
                "shift_ends_at": _at(r["shift_date"], end_min),
                "window_from": opens,
                "window_to": closes,
                "moment_at": begins - timedelta(minutes=OPERATOR_POINT_MIN),
                "only_by_this_rule": only_by_rule,
            })
    # ONE MOMENT PER PERSON PER START. The roster carries the same shift under
    # more than one house row (a transfer is written on both calendars), and
    # two identical windows would be two messages. The house named on the
    # survivor is whichever row sorted first; the moment is the same minute
    # either way, and this module does not tell anybody where to go.
    rows.sort(key=lambda m: (m["window_from"], m["person_key"], m["house"]))
    deduped, seen = [], set()
    for m in rows:
        stamp = (m["person_key"], m["window_from"])
        if stamp in seen:
            counts["duplicate_rows"] += 1
            counts["moments"] -= 1
            counts["only_by_this_rule"] -= 1 if m["only_by_this_rule"] else 0
            continue
        seen.add(stamp)
        deduped.append(m)
    counts["people_on_roster"] = len(everybody)
    return deduped, dict(counts), everybody


# ═══════════════════════════════════════════════════════════════════════════
# BEYOND THE OPERATOR'S RULE — three additions, each one rejectable on its own
#
# The operator asked for one thing and it is implemented above, unconditionally.
# What follows is what the same data supports and he did not ask for. Every
# field either of these produces is prefixed `add_`, so refusing the lot is a
# matter of dropping those columns — nothing above depends on them.
# ═══════════════════════════════════════════════════════════════════════════

#: ADDITION 1 — the hour after a shift ends is not the hour before one.
#: Before a shift they are getting ready with a phone in their hand. After it
#: they are handing over, walking to a car, and driving. The mirror image of
#: the operator's rule is not a second reachable window; it is a refusal.
QUIET_AFTER_MIN = 60

#: ADDITION 2 — the day sleeper. Of the soonest shifts on the platform every
#: one is a 10P-7A or 10P-8:30A. A person who works nights sleeps through the
#: platform's "safe" daylight, and 21:00-08:00 protects precisely the hours
#: they are awake. The floor is inverted for them, not applied.
#: A person is treated as a night worker when the majority of their rostered
#: starts in the horizon fall at or after this hour.
NIGHT_START_H = 19


def _additions(mine: list[dict]) -> dict:
    """The `add_` fields for one person, from their own moments."""
    if not mine:
        return {}
    nights = sum(1 for m in mine if m["shift_at"].hour >= NIGHT_START_H
                 or m["shift_at"].hour < 4)
    sleeper = nights * 2 > len(mine)
    nxt = mine[0]
    return {
        # ADDITION 1: the refusal after the shift they are on or just left.
        "add_quiet_after_from": nxt["shift_ends_at"].isoformat(),
        "add_quiet_after_to": (nxt["shift_ends_at"]
                               + timedelta(minutes=QUIET_AFTER_MIN)).isoformat(),
        # ADDITION 2: says the platform's own floor is upside down for them.
        # It is a flag, never an hour to send at: inverting a quiet window is
        # a policy decision and CommPolicy.gs owns it.
        "add_day_sleeper": sleeper,
        "add_day_sleeper_why": (
            f"{nights} of {len(mine)} rostered starts are overnight — the platform's "
            f"{QUIET_FROM_H}:00-{QUIET_TO_H:02d}:00 quiet protects the hours they are awake"
            if sleeper else ""),
    }


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    """The slice. Two shapes, both flat, both one row per line of a house.

    `commWhen` — ONE ROW PER PERSON, and the row is the answer to "may I send
    to this person, and if not now, when". It carries their next reachable
    window, the state they are in right now, and how many further moments the
    week holds. This is the row Smart Comms reads when it has something to say.

    `commWhenMoments` — ONE ROW PER (PERSON, SHIFT START) inside the horizon.
    This is the row a queue reads when it wants to PLAN: every window in the
    week, in time order, each one already marked with whether it exists only
    because of this rule.

    ADDITION 3 — a person with no readable shift in the horizon still gets a
    row, with state "no_shift". Returning nothing for them would read as
    "never reachable" to anything that takes silence for an answer, and the
    honest answer is the opposite: this module knows nothing about their week,
    so the platform's own quiet hours stand untouched. `comm_cortex.window_of`
    makes the same choice for the same reason.
    """
    if resource not in RESOURCES:
        raise ValueError(f"Unknown resource {resource!r}")

    today = _today()
    until = today + timedelta(days=HORIZON_DAYS - 1)
    found, _counts, everybody = moments(dsn, HORIZON_DAYS)
    # A call-off is about a day that has begun or is about to: yesterday is in
    # range because an overnight shift that was called off still covers today.
    offs, ocounts = call_off_facts(dsn, today - timedelta(days=1), until)
    freshness = ocounts["freshness"]

    if resource == "commWhenMoments":
        rows = []
        for m in found:
            # ONLY A FACT THAT STATES THE ABSENT DAY MAY VOID A MOMENT, and
            # only the typed book states one. A live hotline row holds the day
            # of the call and never voids: it does not know which shift the
            # caller meant, and guessing would delete the one window a person
            # working that day had.
            void = any(o["absent_on"] == m["shift_date"] and o["effect"]["voids"]
                       for o in offs.get(m["person_key"], ()))
            rows.append({
                "id": "WM_" + m["person_key"][:32] + "_" + m["window_from"].strftime("%m%d%H%M"),
                "person_key": m["person_key"],
                "name": m["name"],
                "house": m["house"],
                "shift_code": m["shift_code"],
                "shift_at": m["shift_at"].isoformat(),
                "window_from": m["window_from"].isoformat(),
                "window_to": m["window_to"].isoformat(),
                "moment_at": m["moment_at"].isoformat(),
                # TRUE means this window sits inside 21:00-08:00 — it exists
                # ONLY because of the operator's rule, and it is the reason
                # the rule was asked for.
                "only_by_this_rule": m["only_by_this_rule"],
                "voided_by_call_off": void,
                # How old the books behind that verdict are. Carried on the row
                # because a plan read next week off a cached slice would
                # otherwise look exactly like a plan read today.
                "sources_freshness": freshness,
            })
        return rows, None

    # ── commWhen: one row per person ──────────────────────────────────────
    by_person: dict[str, list[dict]] = {}
    # ADDITION 3, and the reason `moments` hands `everybody` back: somebody
    # rostered all week in cells that only ever said "48TH (B)" gets a row
    # saying so, not no row at all. Somebody with a call-off and no readable
    # shift gets one too — they are still a person the lane may be about to
    # message, and the hold is the answer they need.
    for who in everybody:
        by_person.setdefault(who, [])
    for who in offs:
        by_person.setdefault(who, [])
    for m in found:
        by_person.setdefault(m["person_key"], []).append(m)

    now = datetime.now(ESTATE_TZ)
    rows = []
    for who, mine in sorted(by_person.items()):
        mine.sort(key=lambda m: m["window_from"])
        # The roster's spelling wins over the call-off book's: the roster is
        # the live mirror and the book has been frozen for months.
        name = everybody.get(who) or (mine[0]["name"] if mine else "")
        marks = offs.get(who, [])

        # THE HOLD. A call-off or a sent-home silences routine traffic for the
        # rest of that local day — the operator's own case: sick at 6am is not
        # a free line for the CPR card at 9am. A live hotline row holds too,
        # on the day of the call, which is the only day it states.
        #
        # THE EFFECT COMES OFF THE FACT, never off the kind. That is the guard
        # in code form: a fact from the live queue cannot reach the typed
        # table, so no untyped call can be given a "Call Off"'s power over
        # somebody's day.
        hold_until: datetime | None = None
        hold_why = ""
        hold_source = ""
        reach_anyway = False
        for o in marks:
            eff = o["effect"]
            reach_anyway = reach_anyway or eff["reach_anyway"]
            if not eff["holds"] or o["holds_on"] is None:
                continue
            ends = _at(o["holds_on"], 24 * 60)      # midnight at the end of that day
            if ends > now and (hold_until is None or ends > hold_until):
                hold_until, hold_why, hold_source = ends, eff["why"], o["source"]

        voided = {o["absent_on"] for o in marks
                  if o["effect"]["voids"] and o["absent_on"] is not None}
        live = [m for m in mine if m["shift_date"] not in voided]
        # The row answers "may I send, and if not now, WHEN" — so a window
        # sitting inside a hold is not the answer to the second half of that
        # question. A held person's next window is the first one past the hold.
        floor = max(now, hold_until) if hold_until else now
        nxt = next((m for m in live if m["window_to"] > floor), None)

        if hold_until is not None:
            state = "held"
        elif nxt is not None:
            state = "reachable"
        elif mine:
            state = "spent"                # the week's moments are behind them
        elif who in everybody:
            # ON the roster, and not one cell of their week said an hour —
            # almost always a house token like "48TH (B)". The platform knows
            # they are working and does not know when. That is NOT the same
            # answer as "they have no shift", and conflating the two would
            # hand the lane a false licence.
            state = "hours_unknown"
        else:
            state = "no_shift"

        rows.append({
            "id": "WH_" + who[:40],
            "person_key": who,
            "name": name,
            "state": state,
            # The operator's rule, as the three numbers anything downstream
            # needs. Empty — never a zero or a fake hour — when there is none.
            "window_from": nxt["window_from"].isoformat() if nxt else "",
            "window_to": nxt["window_to"].isoformat() if nxt else "",
            "moment_at": nxt["moment_at"].isoformat() if nxt else "",
            "shift_at": nxt["shift_at"].isoformat() if nxt else "",
            "shift_code": nxt["shift_code"] if nxt else "",
            "house": nxt["house"] if nxt else "",
            "only_by_this_rule": bool(nxt and nxt["only_by_this_rule"]),
            "moments_ahead": len([m for m in live if m["window_to"] > floor]),
            # WHY, in a sentence a human can check the platform against. The
            # lane already files its reasons; a window without one is a rule
            # nobody can argue with when it gets somebody woken up.
            "why": (
                (hold_why + (f"; next window {nxt['window_from']:%a %H:%M}"
                             if nxt else "; no readable window after the hold"))
                if hold_until is not None else
                (f"reachable from {OPEN_BEFORE_MIN} to {CLOSE_BEFORE_MIN} minutes before their "
                 f"{nxt['shift_at'].strftime('%a %H:%M')} shift"
                 + (" — inside the platform's quiet hours, which is the point"
                    if nxt["only_by_this_rule"] else " — daylight; the old rule allowed this already")
                 ) if nxt else
                ("every moment this week is already behind them" if mine else
                 "rostered this week, but no cell says an hour — the platform's own "
                 "quiet hours stand, unnarrowed" if state == "hours_unknown" else
                 "not on this week's roster — the platform's own quiet hours stand")),
            "hold_until": hold_until.isoformat() if hold_until else "",
            # NOT an instruction to send. It says only that this module
            # refuses to report them unreachable while a house is uncovered.
            "reach_anyway": reach_anyway,
            # WHICH BOOK ANSWERED. The operator's rule for two sources that
            # disagree is that the live one decides where it speaks, the older
            # one answers where the live one is silent, and the row says which.
            # This is that sentence, per person.
            "call_off_source": hold_source or (
                "+".join(sorted({o["source"] for o in marks})) if marks else ""),
            # HOW THE CALLER WAS IDENTIFIED — "phone", "alias", "name_trgm",
            # or the retired book's own name key. A human reading a hold has to
            # be able to see how much the identification is worth.
            "call_off_matched_by": "+".join(
                sorted({o["matched_by"] for o in marks})) if marks else "",
            # THE DAY THEY WILL MISS, or "unknown". The live queue records the
            # day they RANG; the day of the absence is in the transcript, which
            # this module may not read. Blank would read as "no absence"; the
            # word says the opposite, that nobody has established it.
            # A person with facts from both books gets BOTH halves of the
            # answer — the days the older book wrote down, and the word for the
            # ones nobody established. Dropping either half would turn a partial
            # answer into a confident one.
            "call_off_absent_on": ",".join(
                sorted({o["absent_on"].isoformat() for o in marks
                        if o["absent_on"] is not None})
                + (["unknown"] if any(o["absent_on"] is None for o in marks) else [])),
            # Both books' newest dates and ages, on every row.
            "sources_freshness": freshness,
            **_additions(mine),
        })
    return rows, None


if __name__ == "__main__":   # a read-only probe: counts, never a person's row
    import json
    import os
    import sys

    _dsn = (os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or "")
    if not _dsn:
        sys.exit("DATABASE_URL is not set")
    _people, _ = build("commWhen", _dsn)
    _plan, _ = build("commWhenMoments", _dsn)
    _found, _mc, _all = moments(_dsn)
    # Both books end to end, so the probe reports what each one HOLDS, not
    # only what fell inside this week's horizon. The two are different numbers
    # and reading one for the other is how a stopped feed passes for a quiet
    # one: a clean zero here would mean the platform believes nobody has called
    # off, and sends accordingly.
    _offs, _oc = call_off_facts(_dsn, _date(1970, 1, 1), _date(2999, 1, 1))
    _states = Counter(r["state"] for r in _people)
    _held = [r for r in _people if r["state"] == "held"]
    # THE WIRING, CHECKED AGAINST THE FACTS THEMSELVES. The failure this module
    # already had once was logic that was correct and reached nobody, and no
    # count could see it. So the probe also says what each kind would DO to a
    # person's day, and proves over every fact actually read that the untyped
    # live kind is absent from the typed table, never voids a moment, and never
    # claims to know the absent day.
    _live_facts = [f for fs in _offs.values() for f in fs if f["source"] == "live_queue"]
    _wiring = {k: {"voids": e["voids"], "holds": e["holds"],
                   "reach_anyway": e["reach_anyway"]}
               for k, e in CALL_OFF_EFFECT.items()}
    _wiring[LIVE_KIND] = {
        "voids": LIVE_EFFECT["voids"], "holds": LIVE_EFFECT["holds"],
        "reach_anyway": LIVE_EFFECT["reach_anyway"],
        "in_typed_table": LIVE_KIND in CALL_OFF_EFFECT,
        "facts_read": len(_live_facts),
        "any_voided_a_moment": any(f["effect"]["voids"] for f in _live_facts),
        "any_claimed_an_absent_day": any(f["absent_on"] is not None for f in _live_facts),
    }
    print(json.dumps({
        "roster_rows_read": _mc.get("rows", 0),
        "people_on_roster": _mc.get("people_on_roster", 0),
        "cells_with_hours": _mc.get("hours", 0),
        "cells_house_token_only": _mc.get("no_hour", 0),
        "cells_declared_off": _mc.get("off", 0),
        "cells_unreadable": _mc.get("unreadable", 0),
        "moments": _mc.get("moments", 0),
        "moments_already_past": _mc.get("already_past", 0),
        "moments_only_by_this_rule": _mc.get("only_by_this_rule", 0),
        "rows": len(_people),
        "by_state": dict(_states),
        "people_only_by_this_rule": sum(1 for r in _people if r["only_by_this_rule"]),
        "people_day_sleeper": sum(1 for r in _people if r.get("add_day_sleeper")),
        "plan_rows": len(_plan),
        "plan_voided_by_call_off": sum(1 for r in _plan if r["voided_by_call_off"]),
        # WHO IS HELD RIGHT NOW, and off which book. Counts only — a name here
        # would be a person's absence printed to a log.
        "people_held": len(_held),
        "held_by_source": dict(Counter(r["call_off_source"] for r in _held)),
        "held_absent_day_unknown": sum(
            1 for r in _held if r["call_off_absent_on"] == "unknown"),
        "call_off_sources": _oc,
        "effects": _wiring,
    }, indent=1, default=str))
