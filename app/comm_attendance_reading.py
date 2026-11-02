"""
THE PUNCH RECORD AND THE CALL-OFF BOOK, SIDE BY SIDE, PER PERSON.

The operator's ask, in his words:

    "o psyanywhere junto com o call off é mais uma pagina que voce esqueceu"
    "combinada"
    "combine isso com os call offs que ja temos no sistema quando uma pessoa
     descide nao ir trabalhar, portanto o smart comms tem tudo"

Smart Comms already reads both halves and has never put them on one line. The
`psiPunches` page draws the hours a retired old platform wrote down; `commWhen` reads
the call-off books to decide whether a person may be reached today. Nothing in
the platform answers the one question a human actually asks about a caregiver:
what does the record say they WORKED, and what does the book say they MISSED.

This module answers it, one row per person, and the first thing every row says
is WHICH OF THE TWO SOURCES KNEW THEM AT ALL.

────────────────────────────────────────────────────────────────────────────
THE FINDING THIS PAGE EXISTS FOR, AND IT IS A DISAGREEMENT

Measured here, joining on the platform's own flattened name:

     50  people appear in BOTH
     30  appear in the punch record ONLY
    117  appear in the call-off book ONLY

The two sources do not even agree about who exists, and 117 against 50 is not
a rounding — it is the larger half of the answer. A page that merged them into
one list of 197 "people" would delete that, and the merged list would read as
if the platform had one workforce record. It has two, and they overlap on a
quarter of the names.

So `sources` is the first column, it is computed from the EXACT flattened key,
and nothing on this page silently promotes a fuzzy match into a merge. Where
the estate's own matcher thinks a call-off-only name is somebody it already
knows, that travels as EVIDENCE beside the row (`platform_*`), never as an
edit to `sources`. A merge that is wrong attaches one person's absence to
another person's record, and nobody ever notices.

────────────────────────────────────────────────────────────────────────────
THE FOUR TYPES ARE FOUR FACTS. THERE IS NO "ABSENCES" NUMBER HERE

  Call Off         they decided not to go; the day holds
  Sent Home        they came, started, were sent home; the day holds
  No Show No Call  the house is uncovered and the platform is trying to FIND
                   this person  ("No Show / No Call" is the same fact typed a
                   second way; the vocabulary normalises them to one)
  Late Show        NOTHING. THEY WORKED.

`late_show` is 229 of the book's 668 rows — better than a third. Summing the
four into one count would punish somebody who turned up, and would do it to
the largest single group of people in the book. They are counted apart, they
are rated apart, and no field on the row adds them together.

The vocabulary is `comm_when._CALL_OFF_TYPES` — imported, not retyped, because
two spellings of one type is how two screens start disagreeing about whether
a late show is an absence.

────────────────────────────────────────────────────────────────────────────
THE MIDNIGHT CUT, AND WHY NOTHING HERE STITCHES IT

The old platform closed every overnight at 11:59:59 PM and opened a fresh row at
12:00:00 AM. Measured: 1,097 rows end at the first, 1,134 start at the second.
So a ten-to-eight night is TWO rows on TWO dates, and a count of rows reads
the workforce as having about a quarter more shifts than it worked.

THE TWO NUMBERS ARE NOT EQUAL, so the difference is not a shift count either:
subtracting one from the other would invent a total this record cannot
support. This module therefore does not stitch and does not subtract. It
counts ROWS, says how many of those rows are a cut half (and which half), and
LABELS every number by what it counted. A reader can see the cut instead of
being handed a number that has quietly absorbed it.

`punch_rows_cut_half` counts ROWS and is not the sum of the two markers:
measured, exactly one punch in the whole record opens at the cut AND closes at
it, and adding 1,097 to 1,134 would count that row twice. One row is a small
error of precisely the kind this page exists to refuse, so it is counted once
and named apart in `punch_rows_cut_at_both_ends`.

HOURS ARE THE ONE FIGURE THE CUT DOES NOT TOUCH, which is why the rates below
prefer them: the two halves of a night carry the two halves of its
`check_hours`, and they sum to the night. 4,289 of 4,289 rows carry the
number, so nothing is imputed. The 27 rows where nobody clocked out carry
0.00, so those shifts are missing from the total — the row says how many,
because an hours denominator with holes in it is a denominator that flatters
whoever forgot to clock out.

────────────────────────────────────────────────────────────────────────────
THE DENOMINATOR TRAP THAT WOULD HAVE MADE THIS PAGE LIE

The two books do not cover the same time. The punch record runs 2026-06-07 to
2026-08-12 — nine weeks, and frozen. The call-off book runs from 2024-03-01 to
last week — two and a half years, and alive. Measured: only 44 of the book's
668 rows fall inside the punch record's window.

A rate of "call-offs per 100 hours" that put two and a half years of absences
over nine weeks of hours would be inflated about fifteen-fold, and would look
exactly like a real number. So the rate is computed ONLY over each person's
own punch window — from their first punched day to their last — and the row
carries that window, both denominators, and what each one counted.

The whole-book counts are carried too, under `_all`, because a person's
absence history is a real thing and the operator asked for the book. They are
never the numerator of anything.

────────────────────────────────────────────────────────────────────────────
MISSING IS NOT ZERO, AND THE ROW SAYS SO IN WORDS

The operator's own account of this old platform is that people habitually did not fill
it in. So a person with no punch row did not necessarily not work, and a
person with no call-off row was not necessarily never absent.

Every count on this row is `None` — not 0 — when the source held no row for
that person, and two fields, `punch_reading` and `call_off_reading`, carry the
word `none_recorded` so a screen cannot render the absence of evidence as a
zero by accident. A rate exists only where BOTH sides were counted; otherwise
`rate_state` names which side was missing and every rate is `None`.

────────────────────────────────────────────────────────────────────────────
THE LINES, ENFORCED BY THE SELECT ITSELF

NO CLIENT IDENTITY IN A RECORD ABOUT A WORKER. `asa_psi_time_entries` also
carries `address`, `latitude`, `longitude`, `consumers`, `num_consumers`,
`house` (seventeen codes standing 1:1 with seventeen client addresses, so the
code IS the address spelled shorter) and `raw` (which contains every one of
them). None is fetched. `_LINE_HOLDS` below fails the import if a future edit
ever puts one of those names in a projection.

THE PROSE NEVER TRAVELS. `comments` in the punch record is free text nobody
reviewed. In the call-off tracker,
`notes_include_reason_and_how_much_advanced_notice` is supervisors writing
about employees' health ("her hip swollen", "In some pain. Has Dr slip"),
`how_late` is prose of the same kind, and `your_name` is WHO REPORTED the
absence — not a fact the absent person's record should carry. THE FACT AND THE
TYPE may travel. The words may not. They are named in the refusal list and
never selected, so a column this module cannot load is a column it cannot
leak.

────────────────────────────────────────────────────────────────────────────
JOINING IS THE DANGEROUS PART, SO THE JOIN IS SOMEBODY ELSE'S

The punch record has a name and an old-platform-local `people_id`; the tracker has only
a name. Writing a second fuzzy matcher here would give the estate two answers
to "who is this", and the two would drift.

So the exact join is the platform's own flattened key (`comm_when._key`, which
is `clientNameKey_`), and every fuzzy question is asked of `comm_when._Whois`
— the estate's matcher, imported from the file: its curated alias table, then
`similarity()` at `NAME_SIM_MIN`, which is the threshold the roster's pg_trgm
dedup panel (`GET /candidates/duplicates`, app/admin/roster.py) already runs
at, under the guards that lane taught — a one-word name is refused, a name
that clears the threshold twice is refused as ambiguous, and a name the estate
types as a CLIENT is refused outright.

THE ANSWER IS WRITTEN DOWN NOWHERE. This is a measurement: no alias is
created, no candidate is merged, no row is updated. The match rides on the row
as `platform_matched_by` so a human can see how much it is worth, and
`sources` — the only field anything downstream would key on — is computed from
the exact key and nothing else.

ONE `people_id`, TWO SPELLINGS. Measured: `people_id` 476 is punched under
both "Jayleen Peterson" and "Jaylen Peterson". They are two rows here, because
their flattened keys differ, and each row NAMES THE OTHER
(`punch_people_id_shared_with`). Folding them together silently is exactly the
merge this module refuses to make on anybody else's behalf.

────────────────────────────────────────────────────────────────────────────
EVERY ANSWER CARRIES ITS OWN STALENESS

One half of this reading is frozen and the other is alive, and an answer that
does not say so is read as current. So every row carries both: the punch
record's newest service day and its last sync from the dead old platform, the tracker's
newest dated row and when the mirror last copied it, and the age of each in
days. A reader who sees a quiet August in the punch record must be able to
tell "nobody worked" from "the old platform was switched off".
"""
from __future__ import annotations

import os
from collections import Counter
from datetime import date as _date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from types import ModuleType
from typing import Any

import hub_rows
import lanes_pg as psycopg2

RESOURCES = ("commAttendance",)

#: THE FROZEN HALF. The old platform's clock-in/clock-out record. Its sync has stopped
#: with the old platform; nothing will be added to it again.
PUNCH_TABLE = "public.asa_psi_time_entries"
PUNCH_LABEL = "asa_psi_time_entries (PsiAnywhere)"

#: THE LIVING HALF. "Call Off Tracker Master" — a form people fill in
#: themselves, mirrored here. Measured: 668 rows, 665 of them written by a
#: human through the form.
#: Read as asa-hub-db keeps it: Call Off and Late (Responses) › Master.
TRACKER_ID, TRACKER_TAB = "1KIDBnkI8CH_P3WEihDcKPmPyeBNSjR2WUoxptP1IWTA", "Master"
TRACKER_LABEL = "Call Off Tracker Master"

#: The old platform's own spelling of the two ends of its midnight cut.
CUT_END = "11:59:59 PM"
CUT_START = "12:00:00 AM"

#: The columns that may NEVER cross into a reading about a worker. Seven of
#: them are a client's home by one route or another; the rest are prose nobody
#: reviewed, or the name of whoever reported somebody else's absence.
REFUSED = [
    # a client's home, in seven spellings
    "address", "latitude", "longitude", "consumers", "num_consumers",
    "house", "raw",
    # the words
    "comments",
    "notes_include_reason_and_how_much_advanced_notice",
    "how_late",
    # who reported it — not a fact the absent person's record carries
    "your_name",
]

#: What is actually read from each table, named one by one. `SELECT *` appears
#: nowhere in this file.
_PUNCH_SELECT = ["employee", "people_id", "date_service",
                 "start_time", "end_time", "hours"]
_TRACKER_SELECT = ["employee_name", "date", "type"]
# the same three by the tracker's own headers, as asa-hub-db keeps them
_TRACKER_HEADERS = {"Employee Name": "employee_name", "Date": "date", "Type": "type"}

# THE IMPORT-TIME LOCK. A refused column can only enter this module by being
# typed into one of the two lists above, and then this refuses to load at all.
# A broken slice is a thing somebody fixes in an hour; a client's address, or a
# supervisor's note about an employee's hip, quietly filed in a staff reading
# is a thing nobody notices for months.
_LINE_HOLDS = set(REFUSED) & (set(_PUNCH_SELECT) | set(_TRACKER_SELECT))
if _LINE_HOLDS:
    raise RuntimeError(
        "comm_attendance: a reading about a worker may not carry client data "
        "or unreviewed prose — " + ", ".join(sorted(_LINE_HOLDS)))


class MatcherUnavailable(RuntimeError):
    """The estate's matcher could not be loaded, so nothing is guessed.

    Raised rather than degraded on purpose: a module that cannot ask the estate
    who somebody is must not fall back to a fuzzy rule of its own. One matcher
    or no answer.
    """


_CW: ModuleType | None = None


def matcher_module() -> ModuleType:
    """The estate's who-is-this matcher and the call-off vocabulary: asa-hub-app's comm_when_reading (the window
    reading; app/comm_when.py is the comm_when house, another thing). It is never re-implemented here."""
    global _CW
    if _CW is None:
        import comm_when_reading  # noqa: PLC0415

        _CW = comm_when_reading
    return _CW


def _iso(d: _date | None) -> str:
    return d.isoformat() if d else ""


def _stamp(v: Any) -> str:
    """A timestamp as ISO seconds in UTC. Provenance, not evidence."""
    if isinstance(v, datetime):
        at = v if v.tzinfo else v.replace(tzinfo=timezone.utc)
        return at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return ""


def _hours(v: Decimal) -> str:
    """Hours to the cent, as text.

    TEXT AND NOT A FLOAT because `hours` is numeric loaded through a float:
    `hours::text` prints 8.08000000000000007105… for a number the old platform showed as
    8.08. Measured over the whole record, nothing differs from `round(hours,2)`
    by more than 1e-7, so two decimals is the number's own spelling and not a
    rounding of it.
    """
    return str(v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _rate(n: int, denom: Decimal, per: int) -> float | None:
    """A count against its denominator, or None when there is nothing to
    divide by. A zero denominator is not a zero rate — it is no rate."""
    if denom <= 0:
        return None
    return float((Decimal(n) * per / denom).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP))


# ── the frozen half ───────────────────────────────────────────────────────

def read_punches(cur) -> tuple[dict[str, dict], dict]:
    """The punch record, per flattened name key.

    Six columns, named one by one. The eight that would carry a client's home
    or unreviewed prose are not in the projection and cannot be: `_LINE_HOLDS`
    refuses to let this file load if they ever are.

    NOTHING IS STITCHED HERE. A row that ends at the old platform's midnight, and a row
    that starts at it, are counted as what they are — rows, and cut halves —
    and the caller gets both numbers rather than a shift count that would have
    to be guessed at.
    """
    cw = matcher_module()
    cur.execute(  # noqa: S608 — every name is a literal in this file
        "SELECT " + ", ".join(_PUNCH_SELECT) + f" FROM {PUNCH_TABLE}")
    rows = cur.fetchall()

    out: dict[str, dict] = {}
    pid_keys: dict[str, set[str]] = {}
    nameless = 0
    undated = 0
    newest: _date | None = None
    for r in rows:
        shown = str(r["employee"] or "").strip()
        key = cw._key(shown)
        if not key:
            # A punch nobody can attribute. Counted, never attached to the
            # nearest name — that is how one person's hours land on another.
            nameless += 1
            continue
        p = out.setdefault(key, {
            "key": key, "names": Counter(), "people_ids": set(),
            "rows": 0, "cut_end": 0, "cut_start": 0, "cut_rows": 0,
            "cut_both": 0, "open": 0,
            "hours": Decimal("0"), "first": None, "last": None, "undated": 0,
        })
        p["names"][shown] += 1
        p["rows"] += 1
        pid = str(r["people_id"] or "").strip()
        if pid:
            p["people_ids"].add(pid)
            pid_keys.setdefault(pid, set()).add(key)
        opens_at_cut = str(r["start_time"] or "").strip() == CUT_START
        closes_at_cut = str(r["end_time"] or "").strip() == CUT_END
        if opens_at_cut:
            p["cut_start"] += 1
        if closes_at_cut:
            p["cut_end"] += 1
        if opens_at_cut or closes_at_cut:
            # ROWS, counted once. Adding the two markers together would
            # double-count the row that carries BOTH — measured, there is
            # exactly one in the whole record, a punch running from the cut to
            # the cut. One row is a small error and it is still an error of the
            # exact kind this page exists to refuse: a number that has quietly
            # absorbed the midnight cut instead of showing it.
            p["cut_rows"] += 1
        if opens_at_cut and closes_at_cut:
            p["cut_both"] += 1
        if not str(r["end_time"] or "").strip():
            # 27 punches in the whole record. Nobody clocked out. That is the
            # finding, and its cost is visible: all 27 carry 0.00 hours, so
            # those shifts are simply missing from any hours denominator.
            p["open"] += 1
        if r["hours"] is not None:
            p["hours"] += Decimal(str(r["hours"]))
        day = cw._us_date(r["date_service"])
        if day is None:
            p["undated"] += 1
            undated += 1
            continue
        if p["first"] is None or day < p["first"]:
            p["first"] = day
        if p["last"] is None or day > p["last"]:
            p["last"] = day
        if newest is None or day > newest:
            newest = day

    # THE ONE PLACE TWO SPELLINGS PROVABLY ARE ONE PERSON, and it is still not
    # a merge. The old platform's own `people_id` is the only evidence in this estate
    # that two name keys are the same body; where it says so, each row NAMES
    # the other and a human decides. Silently folding them would attach one
    # person's absences to the other's hours.
    shared = {pid: ks for pid, ks in pid_keys.items() if len(ks) > 1}
    for _pid, keys in shared.items():
        for k in keys:
            out[k]["shared_with"] = sorted(keys - {k})

    cur.execute(f"SELECT max(synced_at) AS s FROM {PUNCH_TABLE}")  # noqa: S608
    synced = _stamp((cur.fetchone() or {}).get("s"))
    return out, {
        "read": len(rows), "people": len(out), "nameless": nameless,
        "undated": undated, "newest_day": _iso(newest), "synced_at": synced,
        "shared_people_ids": {p: sorted(k) for p, k in shared.items()},
    }


# ── the living half ───────────────────────────────────────────────────────

def read_call_offs(cur) -> tuple[dict[str, dict], dict]:
    """The living call-off book, per flattened name key, typed and counted.

    THREE COLUMNS. `notes…`, `how_late` and `your_name` are not selected: the
    first two are supervisors writing about employees' health, and the third is
    who REPORTED the absence, which belongs to the reporter and not to the
    person who was away.

    A type the vocabulary does not know is counted as `untyped` and never
    folded into one of the four — inventing a type is how a late show becomes
    an absence.
    """
    cw = matcher_module()
    # the tracker's three columns by their headers in asa-hub-db's copy, named as the mirror named them
    got = hub_rows.read(TRACKER_ID, TRACKER_TAB, fields=list(_TRACKER_HEADERS))
    rows = [{col: d.get(head) for head, col in _TRACKER_HEADERS.items()} for _rn, d in got["rows"]]

    out: dict[str, dict] = {}
    nameless = 0
    undated = 0
    untyped_vocab: Counter = Counter()
    newest: _date | None = None
    for r in rows:
        shown = str(r["employee_name"] or "").strip()
        key = cw._key(shown)
        if not key:
            nameless += 1
            continue
        kind = cw._CALL_OFF_TYPES.get(
            " ".join(str(r["type"] or "").strip().lower().split()))
        if kind is None:
            untyped_vocab[str(r["type"] or "").strip()] += 1
        p = out.setdefault(key, {
            "key": key, "names": Counter(), "rows": 0,
            "by_type": Counter(), "untyped": 0,
            "days": [], "undated": 0, "last": None,
        })
        p["names"][shown] += 1
        p["rows"] += 1
        if kind is None:
            p["untyped"] += 1
        else:
            p["by_type"][kind] += 1
        # Two-digit years ("4/5/24") are REFUSED rather than pivoted — a
        # call-off placed a century off is a silent wrong answer. The fact and
        # the type still count; only the date is unknown, and it says so.
        day = cw._us_date(r["date"]) or _iso_day(r["date"])
        if day is None:
            p["undated"] += 1
            undated += 1
            continue
        p["days"].append((day, kind))
        if p["last"] is None or day > p["last"]:
            p["last"] = day
        if newest is None or day > newest:
            newest = day

    # when asa-hub-db's copy is known to hold the book as it stands
    mirrored = _stamp(datetime.fromtimestamp(got["as_of"], timezone.utc)) if got.get("as_of") else _stamp(None)
    return out, {
        "read": len(rows), "people": len(out), "nameless": nameless,
        "undated": undated, "newest_day": _iso(newest), "mirrored_at": mirrored,
        "untyped_vocabulary": dict(untyped_vocab),
    }


def _iso_day(raw: Any) -> _date | None:
    """The one row in the book a browser wrote as `2026-09-01`. Measured: 664
    of 668 dates are the form's own M/D/YYYY, one is ISO, three are two-digit
    years this module refuses. Each shape is read on its own terms; a single
    `to_date()` over the column does not degrade, it RAISES, and the rows
    behind the raise are lost with it."""
    s = str(raw or "").strip()[:10]
    try:
        return _date.fromisoformat(s)
    except ValueError:
        return None


# ── who the platform knows, asked and never written down ──────────────────

def identify(cur, keys: list[tuple[str, str]]) -> dict[str, dict]:
    """Ask the estate's own matcher who each of these names is.

    ONE MATCHER. `comm_when._Whois` is the ladder the call-off lane already
    trusts: curated staff aliases first, then `similarity()` at the roster
    dedup panel's own threshold, with that lane's guards — a one-word name is
    refused, a name matching two people is refused as ambiguous, the company's
    own name is refused, and a name the estate types as a CLIENT is refused
    outright and its canonical spelling never published.

    ZERO WRITES. Nothing is inserted, merged or aliased. The answer rides on
    the row as evidence a human can weigh, and never as a change to `sources`.
    """
    cw = matcher_module()
    whois = cw._Whois(cur)
    out: dict[str, dict] = {}
    for key, shown in keys:
        # No phone: the tracker has no phone column, and a phone arm with
        # nothing to read would only ever return the estate's own lines.
        who, disp, how = whois.resolve(shown, "")
        out[key] = {
            "key": who,
            # A refused-client match publishes NOTHING. The refusal itself is
            # the answer, and naming the client would be the exact crossing
            # this whole module is built to prevent.
            "name": disp if how in ("alias", "name_trgm", "phone") else "",
            "matched_by": how,
        }
    return out


# ── the row ───────────────────────────────────────────────────────────────

def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    """The slice: one row per person, 197 of them, ordered by name.

    WHY A SLICE AND NOT A HOUSE. The whole reading is 197 rows of scalars and
    it is a MEASUREMENT — nothing in Apps Script reads it, nothing writes back
    to it, and nothing may be sent from it. A house would add a mint script, a
    feed in capped passes, a door, an ingest and a convergence check, and every
    one of those exists to keep a WRITABLE record in step. There is no record
    here to keep in step: both halves live in Postgres, the relay already reads
    Postgres, and the Smart Comms app is `audience: ['admin']` — the same
    audience the snapshot's own role gate serves a slice to. Minting a house
    for this would put a second, ageing copy of a frozen record and a living
    book into a spreadsheet, which is precisely the drift this page exists to
    show.

    `source_at` is the LIVING half's mirror stamp. The frozen half cannot move,
    so the only honest "as of" for the pair is when the tracker was last
    copied — and both halves' own stamps ride on every row regardless.
    """
    if resource not in RESOURCES:
        raise ValueError(f"Unknown resource {resource!r}")
    cw = matcher_module()

    with psycopg2.connect(dsn) as conn, conn.cursor(
        cursor_factory=psycopg2.extras.RealDictCursor
    ) as cur:
        punch, pmeta = read_punches(cur)
        offs, ometa = read_call_offs(cur)
        # Only the names one source alone knows are worth asking about: a key
        # in both books has already been identified by the strongest evidence
        # there is, an exact match on the platform's own key.
        lonely = [(k, (punch[k]["names"] if k in punch else offs[k]["names"]).most_common(1)[0][0])
                  for k in set(punch) ^ set(offs)]
        seen = identify(cur, sorted(lonely))

    today = datetime.now(timezone.utc).date()
    punch_newest = pmeta["newest_day"]
    offs_newest = ometa["newest_day"]
    freshness = {
        # THE FROZEN HALF. It says `frozen`, not `stale`: nothing is wrong
        # with it and nothing will ever be added to it.
        "punch_source": PUNCH_LABEL,
        "punch_state": "frozen",
        "punch_newest_day": punch_newest,
        "punch_synced_at": pmeta["synced_at"],
        "punch_age_days": _age(punch_newest, today),
        # THE LIVING HALF.
        "call_off_source": TRACKER_LABEL,
        "call_off_state": "live",
        "call_off_newest_day": offs_newest,
        "call_off_mirrored_at": ometa["mirrored_at"],
        "call_off_age_days": _age(offs_newest, today),
        "read_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    rows: list[dict] = []
    for key in sorted(set(punch) | set(offs)):
        p = punch.get(key)
        o = offs.get(key)
        rows.append(_row(cw, key, p, o, seen.get(key), punch, freshness))
    rows.sort(key=lambda r: (r["name"].lower(), r["person_key"]))
    return rows, ometa["mirrored_at"] or None


def _age(day: str, today: _date) -> int | None:
    return (today - _date.fromisoformat(day)).days if day else None


def _row(cw: ModuleType, key: str, p: dict | None, o: dict | None,
         seen: dict | None, punch: dict[str, dict], freshness: dict) -> dict:
    """One person, both halves, and every unknown left unknown."""
    # THE NAME AS SHOWN. The punch record's spelling wins where it exists: it
    # is the old platform's own payroll spelling, while the tracker's is whatever the
    # person filling the form typed that morning. Every other spelling seen
    # under this key is carried beside it rather than discarded.
    spellings: Counter = Counter()
    if p:
        spellings.update(p["names"])
    if o:
        spellings.update(o["names"])
    shown = (p["names"] if p else o["names"]).most_common(1)[0][0]
    variants = [s for s, _ in spellings.most_common() if s != shown]

    sources = "both" if (p and o) else ("punch_only" if p else "call_off_only")

    # ── the frozen half ───────────────────────────────────────────────────
    if p:
        first, last = p["first"], p["last"]
        hours = p["hours"]
        punch_side = {
            "punch_reading": "counted",
            "punch_people_id": "+".join(sorted(p["people_ids"])),
            "punch_people_id_shared_with": " | ".join(
                sorted(punch[k]["names"].most_common(1)[0][0]
                       for k in p.get("shared_with", []) if k in punch)),
            "punch_rows": p["rows"],
            # THE CUT, REPORTED AND NEVER SUBTRACTED. The two halves are given
            # separately because they are not equal across the record (1,097
            # against 1,134) and a reader is entitled to see that rather than
            # be handed a shift count somebody derived from it.
            "punch_rows_cut_half": p["cut_rows"],
            "punch_rows_ending_at_cut": p["cut_end"],
            "punch_rows_starting_at_cut": p["cut_start"],
            "punch_rows_cut_at_both_ends": p["cut_both"],
            "punch_hours": _hours(hours),
            "punch_first_day": _iso(first),
            "punch_last_day": _iso(last),
            "punch_rows_undated": p["undated"],
            # Nobody clocked out. Each of these carries 0.00 hours, so it is
            # also a hole in the hours denominator below.
            "punch_open": p["open"],
        }
    else:
        first = last = None
        hours = Decimal("0")
        punch_side = {
            # NOT ZERO. The operator's own account of this old platform is that people
            # did not fill it in; no row is no evidence, not evidence of no
            # work.
            "punch_reading": "none_recorded",
            "punch_people_id": "", "punch_people_id_shared_with": "",
            "punch_rows": None, "punch_rows_cut_half": None,
            "punch_rows_ending_at_cut": None, "punch_rows_starting_at_cut": None,
            "punch_rows_cut_at_both_ends": None,
            "punch_hours": "", "punch_first_day": "", "punch_last_day": "",
            "punch_rows_undated": None, "punch_open": None,
        }

    # ── the living half ───────────────────────────────────────────────────
    if o:
        t = o["by_type"]
        off_side = {
            "call_off_reading": "counted",
            "call_off_rows_all": o["rows"],
            # FOUR FACTS, NEVER ONE NUMBER. Nothing on this row adds them.
            "call_off_call_off_all": t.get("call_off", 0),
            "call_off_sent_home_all": t.get("sent_home", 0),
            "call_off_no_show_all": t.get("no_show", 0),
            # THEY WORKED. It is here to be read, never to be summed with the
            # three above.
            "call_off_late_show_all": t.get("late_show", 0),
            "call_off_untyped_all": o["untyped"],
            "call_off_last_day": _iso(o["last"]),
            "call_off_rows_undated": o["undated"],
        }
    else:
        off_side = {
            # "none recorded", never "never absent".
            "call_off_reading": "none_recorded",
            "call_off_rows_all": None, "call_off_call_off_all": None,
            "call_off_sent_home_all": None, "call_off_no_show_all": None,
            "call_off_late_show_all": None, "call_off_untyped_all": None,
            "call_off_last_day": "", "call_off_rows_undated": None,
        }

    # ── the rate, and only where a rate can honestly exist ────────────────
    rate = _rates(o, first, last, hours,
                  p["rows"] if p else 0, p["open"] if p else 0)

    # ── what the platform knows about a name only one book had ────────────
    ident = _identity(cw, sources, seen, punch, p, o)

    return {
        "id": "CA_" + key[:48],
        "person_key": key,
        "name": shown,
        "name_variants": " | ".join(variants),
        # THE FIRST FIELD, AND THE POINT OF THE PAGE: which books knew them.
        # Computed from the EXACT key. No fuzzy match ever edits it.
        "sources": sources,
        **punch_side,
        **off_side,
        **rate,
        **ident,
        # Every answer carries its own staleness: one half is frozen, the
        # other is alive, and a reading that does not say so is read as
        # current.
        "freshness": freshness,
    }


def _rates(o: dict | None, first: _date | None, last: _date | None,
           hours: Decimal, punch_rows: int, open_punches: int) -> dict:
    """Four rates, one per fact, each beside the denominator that produced it.

    THE WINDOW IS THE WHOLE ARGUMENT. The call-off book runs two and a half
    years and the punch record nine weeks; measured, 44 of the book's 668 rows
    fall inside the punch window at all. Dividing the book by the record would
    inflate every rate about fifteenfold and would look exactly like a real
    number. So only call-offs inside THIS PERSON'S OWN punched span count, and
    the span is on the row.

    HOURS FIRST, ROWS BESIDE THEM. Hours are the one figure the old platform's midnight
    cut does not distort — the two halves of a night carry the two halves of
    its `check_hours`. Rows are given too, labelled as rows, because a reader
    comparing people needs to see how much of somebody's record is a cut half.
    """
    if o is None or first is None or last is None:
        return {
            "rate_state": ("unknown_no_punch_record" if first is None
                           else "unknown_no_call_offs"),
            "rate_window_from": _iso(first), "rate_window_to": _iso(last),
            "rate_denominator_hours": "", "rate_denominator_rows": None,
            "rate_denominator_says": "", "rate_numerator_says": "",
            "call_offs_in_window": None, "sent_home_in_window": None,
            "no_shows_in_window": None, "late_shows_in_window": None,
            "call_off_per_100h": None, "sent_home_per_100h": None,
            "no_show_per_100h": None, "late_show_per_100h": None,
        }
    inside = Counter(k for d, k in o["days"] if first <= d <= last and k)
    n_call, n_sent = inside.get("call_off", 0), inside.get("sent_home", 0)
    n_no, n_late = inside.get("no_show", 0), inside.get("late_show", 0)
    return {
        "rate_state": "measured",
        "rate_window_from": _iso(first),
        "rate_window_to": _iso(last),
        "rate_denominator_hours": _hours(hours),
        # BESIDE the hours, never instead of them, and labelled as rows: a
        # quarter of this record's rows are one half of a night the old platform cut at
        # midnight, so a per-row rate is a rate per ROW and not per shift.
        "rate_denominator_rows": punch_rows,
        "rate_denominator_says": (
            f"{_hours(hours)} hours the old platform recorded for this person across "
            f"{punch_rows} rows between {_iso(first)} and {_iso(last)}"
            + (f", with {open_punches} punch(es) never clocked out and so "
               f"carrying no hours at all" if open_punches else "")),
        # RECORDED, NOT OCCURRED. The book is a form people fill in
        # themselves; a person with no row inside their punch window had none
        # RECORDED, which is not the same sentence as "was never absent". The
        # zero is real and it is a zero about the BOOK.
        "rate_numerator_says": (
            f"call-offs RECORDED in the living book between {_iso(first)} and "
            f"{_iso(last)} — the four types counted apart, and a late show is "
            f"a shift somebody worked"),
        # The four counts the rates are made of, so nobody has to
        # back-calculate them out of a ratio.
        "call_offs_in_window": n_call,
        "sent_home_in_window": n_sent,
        "no_shows_in_window": n_no,
        "late_shows_in_window": n_late,
        "call_off_per_100h": _rate(n_call, hours, 100),
        "sent_home_per_100h": _rate(n_sent, hours, 100),
        "no_show_per_100h": _rate(n_no, hours, 100),
        # Carried for completeness and for nothing else: a late show is a
        # person who WORKED, and this number is not a cost.
        "late_show_per_100h": _rate(n_late, hours, 100),
    }


def _identity(cw: ModuleType, sources: str, seen: dict | None,
              punch: dict[str, dict], p: dict | None, o: dict | None) -> dict:
    """What the estate's matcher says about a name only one book had.

    EVIDENCE, NEVER A MERGE. `platform_key` is the matcher's answer; the row's
    `sources` above is computed from the exact key and is not touched by it.
    `platform_also_punched` is the interesting one on a call-off-only row: it
    says the platform knows this person under a spelling that DID punch, which
    is a question for a human and not a fact to act on.
    """
    if sources == "both" or not seen:
        return {"platform_key": "", "platform_name": "",
                "platform_matched_by": "exact_key" if sources == "both" else "",
                "platform_also_punched": None, "identity_note": (
                    "both books name this person under the same flattened key"
                    if sources == "both" else "")}
    how = seen.get("matched_by") or "unresolved"
    who = seen.get("key") or ""
    also = bool(who) and who in punch and who != (p or o or {}).get("key")
    note = {
        "alias": "the estate's curated alias table knows this name as somebody else",
        "name_trgm": "the estate's trigram matcher, at the roster dedup panel's own "
                     "threshold, reads this as somebody it already knows",
        "phone": "matched on a phone the estate holds for this person",
        "refused_one_word": "one word is not an identity here — the estate's own "
                            "matcher refuses it, and so does this",
        "refused_not_a_person": "this is not a person's name (a placeholder, or the "
                                "company itself)",
        "refused_client": "the estate types this name as a CLIENT; the row is left "
                          "unattributed and no client name is published",
        "refused_no_name": "the book carried no name on these rows",
        "refused_estate_line": "the only contact on it was one of the estate's own lines",
        "unresolved": "nobody in the platform's people is a close enough match — "
                      "genuinely unknown to it, not a spelling of somebody known",
    }.get(how, "")
    return {
        "platform_key": who,
        "platform_name": seen.get("name") or "",
        "platform_matched_by": how,
        # None, not False, when the matcher gave no answer: whether that
        # person punched is unknown, not settled in the negative.
        "platform_also_punched": also if who else None,
        "identity_note": note,
    }


# ── the probe: counts and shapes, never a person's row ────────────────────

def scan(dsn: str) -> dict[str, Any]:
    """What the build measured, as numbers a human can check it against.

    No names, no rows — the page is admin-only and a probe is not. What comes
    back is the disagreement between the two books, the cut, the window, and
    how many of the names only one book had the platform can put a face to.
    """
    rows, source_at = build("commAttendance", dsn)
    by_source = Counter(r["sources"] for r in rows)
    lonely = [r for r in rows if r["sources"] == "call_off_only"]
    how = Counter(r["platform_matched_by"] for r in lonely)
    fresh = rows[0]["freshness"] if rows else {}
    rated = [r for r in rows if r["rate_state"] == "measured"]
    return {
        "rows": len(rows),
        "sources": dict(by_source),
        "shared_people_id": [
            {"name": r["name"], "with": r["punch_people_id_shared_with"],
             "people_id": r["punch_people_id"]}
            for r in rows if r["punch_people_id_shared_with"]],
        "punch_rows": sum(r["punch_rows"] or 0 for r in rows),
        "punch_rows_cut_half": sum(r["punch_rows_cut_half"] or 0 for r in rows),
        "punch_rows_ending_at_cut": sum(r["punch_rows_ending_at_cut"] or 0 for r in rows),
        "punch_rows_starting_at_cut": sum(r["punch_rows_starting_at_cut"] or 0 for r in rows),
        "punch_rows_cut_at_both_ends": sum(r["punch_rows_cut_at_both_ends"] or 0 for r in rows),
        "punch_open": sum(r["punch_open"] or 0 for r in rows),
        "punch_hours": _hours(sum((Decimal(r["punch_hours"]) for r in rows
                                   if r["punch_hours"]), Decimal("0"))),
        "call_off_rows_all": sum(r["call_off_rows_all"] or 0 for r in rows),
        "call_off_by_type_all": {
            "call_off": sum(r["call_off_call_off_all"] or 0 for r in rows),
            "sent_home": sum(r["call_off_sent_home_all"] or 0 for r in rows),
            "no_show": sum(r["call_off_no_show_all"] or 0 for r in rows),
            "late_show": sum(r["call_off_late_show_all"] or 0 for r in rows),
            "untyped": sum(r["call_off_untyped_all"] or 0 for r in rows),
        },
        "call_off_rows_undated": sum(r["call_off_rows_undated"] or 0 for r in rows),
        "call_off_rows_in_a_punch_window": sum(
            (r["call_offs_in_window"] or 0) + (r["sent_home_in_window"] or 0)
            + (r["no_shows_in_window"] or 0) + (r["late_shows_in_window"] or 0)
            for r in rows),
        "people_with_a_rate": len(rated),
        # THE ANSWER THE BRIEF ASKED FOR: of the names only the call-off book
        # had, how many does the platform know by another spelling, and how
        # many are genuinely strangers to it.
        "call_off_only_identified": dict(how),
        "call_off_only_resolving_to_a_puncher": sum(
            1 for r in lonely if r["platform_also_punched"]),
        "freshness": fresh,
        "source_at": source_at,
    }


if __name__ == "__main__":
    import json

    _dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not _dsn:
        raise SystemExit("DATABASE_URL is not set")
    print(json.dumps(scan(_dsn), indent=2, sort_keys=True, default=str))
