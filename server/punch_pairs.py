"""EVERY SHIFT OWES ITS OWN PAIR OF PUNCHES — a clock-in and a clock-out of its own — and the ladder that…"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import secrets
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import psi_attendance
import psi_reminders

log = logging.getLogger("hub.punch_pairs")


def _handoff():
    """server/shift_handoff.py, loaded on use."""
    import shift_handoff  # noqa: PLC0415
    return shift_handoff


OHIO = psi_attendance.OHIO
UTC = timezone.utc


# ── the verdicts ───────────────────────────────────────────────────────────

# A SHIFT'S OWN ENTRY, both times on it. Nothing is owed.
PAIRED = "paired"
# A SHIFT'S OWN ENTRY WITH A START AND NO END.
OPEN = "open"
# NO ENTRY OF ITS OWN. The rung-one chase is about this one.
MISSING = "missing"
# ONE ENTRY SPANS THIS SHIFT AND ANOTHER — what the rule forbids.
COVERED = "covered_by_another"
# A HUMAN ALREADY WROTE THIS DAY DOWN — a call off, a no show, a late show, in any of the books the attendance lane…
TOLD = "told_by_a_human"
# THE ROSTER HOLDS THIS PERSON ON TWO GRIDS AT ONCE.
DOUBLE = "double_booked"
# THE PUNCHES OR THE SCHEDULE COULD NOT BE READ. NEVER A FAULT.
UNREADABLE = "unreadable"

VERDICTS = (PAIRED, OPEN, MISSING, COVERED, TOLD, DOUBLE, UNREADABLE)
FAULTS = frozenset({OPEN, MISSING, COVERED})


# ── the ladder's states ────────────────────────────────────────────────────

WARNED = "warned"        # the directors are being told
RECEIVED = "received"    # a director answered; the call off has not been made yet
CONVERTED = "converted"  # it is a call off in the pool, born from this warning
CLOSED = "closed"        # the punches arrived after all, or the answer was refused
GAVE_UP = "gave_up"      # its shift ended with no answer, and the row says how often it was said
STATES = (WARNED, RECEIVED, CONVERTED, CLOSED, GAVE_UP)
LIVE_STATES = (WARNED, RECEIVED)


# ── the numbers ────────────────────────────────────────────────────────────

# HOW MANY "not logged in" MESSAGES MUST REACH THE PERSON BEFORE THE SHIFT IS SEPARATED.
CHASE_TELLS = int(os.getenv("HUB_PUNCH_CHASE_TELLS", "3"))
# A PERSON WHO ANSWERED A DELIVERED "not logged in" and still has no punch this long after the answer: the answer…
REPLY_GRACE_MIN = float(os.getenv("HUB_PUNCH_REPLY_GRACE_MIN", str(psi_reminders.EVERY_MIN)))

# HOW OFTEN A WARNING IS SAID TO THE DIRECTORS — AND NEVER HOW MANY TIMES.
WARN_EVERY_MIN = float(os.getenv("HUB_PUNCH_WARN_EVERY_MIN", "20"))
# A WARNING WHOSE LATEST ROUND NO READ CAN CHANGE — its situation switched off or wordless, or no director the door…
HELD_READ_EVERY_MIN = float(os.getenv("HUB_PUNCH_HELD_READ_EVERY_MIN", "60"))

# A READ OLDER THAN THIS BACKS NO WARNING — neither opening one, nor telling one, nor turning one into a call off.
FRESH_READ_MIN = psi_reminders.CHECK_FRESH_MIN
# THE PAIRING ITSELF GOES STALE when the attendance lane has not re-paired for two of its refresh beats: nothing is…
STALE_S = 2.0 * psi_attendance.REFRESH_S

# HOW CLOSE TO A CHANGEOVER THE PERSON IS REMINDED that the shift ending now owes a punch out and the one starting…
CHANGEOVER_MIN = float(os.getenv("HUB_PUNCH_CHANGEOVER_MIN", "10"))
# TWO SHIFTS MEET when one ends within this of the other's start.
MEET_MIN = float(os.getenv("HUB_PUNCH_MEET_MIN", "30"))

# The most rows one post carries.
MAX_ROWS = int(os.getenv("HUB_PUNCH_MAX_ROWS", "25"))

# A RECEIVED WHOSE CALL OFF THE CALENDAR REFUSED IS TRIED AGAIN.
CONVERT_EVERY_MIN = float(os.getenv("HUB_PUNCH_CONVERT_EVERY_MIN", "10"))
CONVERT_TRIES = int(os.getenv("HUB_PUNCH_CONVERT_TRIES", "12"))
# HOW LONG THE DIRECTOR IS STILL TOLD WHAT A RECEIVED THEY WERE TOLD WAS WAITING CAME TO.
CLOSED_ACK_KEEP_H = float(os.getenv("HUB_PUNCH_CLOSED_ACK_KEEP_H", "6"))
# HOW LONG ONE PASS HOLDS A RECEIVED WHILE IT MAKES THE CALL OFF.
CLAIM_MIN = float(os.getenv("HUB_PUNCH_CLAIM_MIN", "5"))
# The claim on the row: when it was taken (`said.converting`, which ages it) and by which pass…
_LET_GO = "(said - 'converting' - 'converting_by')"
_HELD_BY = "said->>'converting_by' = %s"
_NO_LIVE_CLAIM = "(NOT (said ? 'converting') OR (said->>'converting')::timestamptz < %s)"
# THE ESTATE'S OWN ANSWERS THAT WILL NEVER CHANGE THEIR MIND.
CONVERT_FINAL = frozenset({"ended", "already_pooled", "no_shift"})

# HOW FAR BACK A WARNING THAT STOPPED STAYS ON THE PUNCH BOARD.
BOARD_DAYS = int(os.getenv("HUB_PUNCH_BOARD_DAYS", "2"))


# ── the kinds, on the one door ─────────────────────────────────────────────

K_CHANGEOVER = "punch_changeover"    # to the person, at a changeover
K_OPEN_ENTRY = "punch_open_entry"    # to the person, about an entry left open
K_WARNING = "punch_warning"          # to each director, by name
# THE SAME WARNING FOR A SHIFT THAT SHARES ITS CALENDAR CELL with another of the person's shifts.
K_WARNING_BY_HAND = "punch_warning_by_hand"
WARNING_KINDS = (K_WARNING, K_WARNING_BY_HAND)
# A RECEIVED THE DIRECTOR WAS TOLD IS WAITING, and what it came to: the director who was told "not open yet" is told…
K_CLOSED_ACK = "sms_reply_punch_closed"
K_OPEN_ACK = "sms_reply_punch_open"
FOLLOW_ACK_KINDS = (K_CLOSED_ACK, K_OPEN_ACK)
KINDS = (K_CHANGEOVER, K_OPEN_ENTRY, K_WARNING, K_WARNING_BY_HAND, *FOLLOW_ACK_KINDS)


# ── the quiet window, in ONE place ─────────────────────────────────────────

SEND_NOW = "now"
SEND_HELD = "held"


def quiet_gate(now: datetime) -> dict[str, Any]:
    """{state, at, why}: whether anything on this lane may be said now."""
    if psi_reminders.quiet(now):
        return {"state": SEND_HELD, "at": psi_reminders.quiet_ends(now),
                "why": ("the general silence holds it; it is planned again when the window ends "
                        "and said only if it is still true then")}
    return {"state": SEND_NOW, "at": now, "why": ""}


# ── keys and words ─────────────────────────────────────────────────────────

REF_RE = re.compile(r"\bPW[0-9A-F]{10}\b")
# RECEIVED, and only a word that means it.
_RECEIVED = re.compile(r"\b(?:received|recieved|acknowledged|ack)\b", re.IGNORECASE)
RECEIVED_WORDS = frozenset({"received", "recieved", "acknowledged", "ack"})


def received_word(text: Any) -> bool:
    """Does this text say RECEIVED anywhere? Read only beside a warning's ref."""
    return bool(_RECEIVED.search(str(text or "")))


def received_alone(text: Any) -> bool:
    """Is the WHOLE text the word and nothing else?"""
    words = re.sub(r"[^a-z]+", " ", str(text or "").lower()).split()
    return len(words) == 1 and words[0] in RECEIVED_WORDS


def ref_of(shift_id: str) -> str:
    """The handle a warning is answered by. It names a shift, never a row."""
    digest = hashlib.sha1(str(shift_id or "").encode("utf-8")).hexdigest()
    return "PW" + digest[:10].upper()


def _instant(raw: Any) -> datetime | None:
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=UTC)
    return psi_reminders._instant(raw)


def _mins(a: datetime, b: datetime) -> float:
    return (a.astimezone(UTC) - b.astimezone(UTC)).total_seconds() / 60.0


def _iso(at: Any) -> str:
    got = _instant(at)
    return got.astimezone(OHIO).isoformat() if got is not None else ""


def _clock(at: Any) -> str:
    got = _instant(at)
    return got.astimezone(OHIO).strftime("%H:%M") if got is not None else ""


def _plain(text: Any) -> str:
    """ASCII, so one SMS stays one SMS (shift_handoff's own fold)."""
    return _handoff()._plain(text)


# ── the pairing ────────────────────────────────────────────────────────────

def _entry_ids(ref: Any) -> list[str]:
    """Every entry id a span stands for — two when a midnight cut was stitched."""
    if not isinstance(ref, dict):
        return []
    return [str(i) for i in (ref.get("ids") or [ref.get("id")]) if i]


# HOW NEAR TWO CLOCK-INS MUST BE TO BE THE SAME PUNCH TWICE OVER.
TWIN_MIN = float(os.getenv("HUB_PUNCH_TWIN_MIN", "1"))


def superseded(spans: Iterable[tuple]) -> list[tuple]:
    """The spans with the SHADOWS of a closed punch dropped."""
    kept = list(spans)
    closed = [sp for sp in kept if sp[1] is not None]
    return [sp for sp in kept
            if sp[1] is not None
            or not any(abs(_mins(other[0], sp[0])) <= TWIN_MIN for other in closed)]


def _leftover(span: tuple, shift_at: datetime) -> bool:
    """Is this an entry left open from BEFORE this shift began?"""
    return span[1] is None and span[0].astimezone(UTC) < shift_at.astimezone(UTC)


def best_span(shift_at: datetime, shift_end: datetime, spans: list[tuple],
              now: datetime) -> tuple:
    """(arrival, span) for one shift — psi_attendance.arrival_match's answer, asked of this shift's OWN punches…"""
    mine = [sp for sp in spans if not _leftover(sp, shift_at)]
    if len(mine) != len(spans):
        came, span = psi_attendance.arrival_match(shift_at, shift_end, mine, now)
        if span is not None:
            return came, span
    return psi_attendance.arrival_match(shift_at, shift_end, spans, now)


def overlapping(a: dict, b: dict) -> bool:
    """Do two scheduled shifts stand on the same hours?"""
    a_at, a_end = _instant(a.get("shift_at")), _instant(a.get("shift_end"))
    b_at, b_end = _instant(b.get("shift_at")), _instant(b.get("shift_end"))
    if None in (a_at, a_end, b_at, b_end):
        return False
    return a_at < b_end and b_at < a_end


def same_body(a: dict, b: dict) -> bool:
    """Are these two of ONE person's shifts on the same hours?"""
    key = str(a.get("person_key") or "")
    return bool(key) and key == str(b.get("person_key") or "") and overlapping(a, b)


def pair_shifts(shifts: Iterable[dict], index: dict[str, list[tuple]], recent: set[str],
                now: datetime, *, read_at: datetime | None = None,
                absence_from: Any = None, schedule_read: bool = True,
                offs: dict[str, list[dict]] | None = None,
                loose: list[dict] | None = None) -> dict[str, Any]:
    """A verdict per SHIFT, not per day."""
    ordered = sorted(shifts, key=lambda s: s["shift_at"])
    rows: list[dict] = []
    by_entry: dict[str, list[int]] = {}
    read_iso = _iso(read_at) if read_at is not None else ""
    for s in ordered:
        # THE SAME PUNCH ONCE.
        seen_spans: dict[tuple, tuple] = {}
        for k in s["keys"]:
            for sp in index.get(k, ()):
                seen_spans.setdefault(
                    (sp[0], sp[1], tuple(_entry_ids(sp[2] if len(sp) > 2 else None))), sp)
        spans = superseded(seen_spans.values())
        # A SHIFT THAT HAS NOT BEGUN CLAIMS NO ENTRY.
        came, span = (best_span(s["shift_at"], s["shift_end"], spans, now)
                      if now >= s["shift_at"] else (None, None))
        sid = psi_attendance.shift_id(s)
        told = (psi_attendance.told_by_a_human(s, offs or {}, loose or [])
                if offs is not None or loose is not None else None)
        ref = (span[2] if span is not None and len(span) > 2 else None) or {}
        ids = _entry_ids(ref)
        row: dict[str, Any] = {
            "id": sid, "ref": ref_of(sid),
            "person": s["name"], "person_key": s["person_key"], "keys": s["keys"],
            "house": str(s.get("house") or ""), "house_name": "",
            "shift_code": s["shift_code"], "day": s["shift_date"].isoformat(),
            "shift_at": s["shift_at"].astimezone(OHIO).isoformat(),
            "shift_end": s["shift_end"].astimezone(OHIO).isoformat(),
            "time": _clock(s["shift_at"]), "ends": _clock(s["shift_end"]),
            "verdict": "", "why": "", "fault": False,
            # THE READ EVERY VERDICT HERE STANDS ON, so a lane acting on a verdict can ask how old its evidence is.
            "read_at": read_iso,
            "told_kind": (told or {}).get("kind") or "",
            "told_source": (told or {}).get("source") or "",
            "doubles": [],
            "entry_id": (ids[0] if ids else ""), "entry_ids": ids,
            "punched_in": _clock(span[0]) if span is not None else "",
            "punched_out": _clock(span[1]) if span is not None and span[1] is not None else "",
            "covers": [],
        }
        reached = True
        if absence_from is not None:
            floor = (s["shift_at"] - timedelta(hours=psi_attendance.OPEN_ENTRY_MAX_H))
            reached = floor.astimezone(OHIO).date() >= absence_from
        if not schedule_read:
            row.update(verdict=UNREADABLE, why="the schedule for this day could not be read")
        elif span is not None:
            if span[1] is None:
                row["verdict"] = OPEN
                row["why"] = "the entry for this shift has a clock-in and no clock-out"
                # NOT A FAULT WHILE THE SHIFT IS STILL RUNNING: somebody on the clock has not failed to clock out yet.
                row["fault"] = (read_at is not None
                                and _mins(read_at, s["shift_end"]) >= psi_attendance.ENTRY_GRACE_MIN)
                if not row["fault"]:
                    row["why"] = ("they are on the clock for this shift, and the clock has not been "
                                  "read since it ended"
                                  if read_at is not None and read_at < s["shift_end"]
                                  else "they are on the clock for this shift and have not clocked "
                                       "out yet")
            else:
                row["verdict"] = PAIRED
                row["why"] = "this shift has its own entry, clocked in and clocked out"
        elif now < s["shift_at"]:
            row.update(verdict=UNREADABLE, why="this shift has not begun")
        elif told:
            # A HUMAN ALREADY WROTE THIS DAY DOWN, in one of the books the attendance lane reads.
            row.update(verdict=TOLD,
                       why=(f"a human wrote this day down as "
                            f"{str(told.get('kind') or 'a call off').replace('_', ' ')}"
                            + (f" ({told.get('source')})" if told.get("source") else "")))
        elif read_at is None or read_at <= s["shift_at"] or not reached:
            row.update(verdict=UNREADABLE,
                       why="the time clock was not read after this shift began")
        elif not (s["keys"] & recent):
            row.update(verdict=UNREADABLE,
                       why="the time clock has not spelled this person lately")
        else:
            row["verdict"] = MISSING
            row["why"] = "the time clock holds no entry of this shift's own"
            # ON THE READ, AS THE BOARD JUDGES IT (psi_attendance.board): a read made before the no-call line says…
            looked = _mins(read_at, s["shift_at"])
            past_end = _mins(read_at, s["shift_end"])
            if looked < psi_attendance.NOCALL_AFTER_MIN:
                row["why"] = "the time clock holds no entry for this shift yet"
            elif past_end >= psi_attendance.ENTRY_GRACE_MIN:
                # THE ATTENDANCE LANE'S OWN CARE, KEPT: most entries are typed after the shift began and a quarter…
                row["why"] = ("the time clock holds no entry of this shift's own, and the entry "
                              "may still be typed")
            else:
                row["fault"] = True
        rows.append(row)
        if row["verdict"] in (PAIRED, OPEN):
            for eid in ids:
                by_entry.setdefault(eid, []).append(len(rows) - 1)

    # ONE BODY, TWO GRIDS.
    by_person: dict[str, list[int]] = {}
    for i, row in enumerate(rows):
        by_person.setdefault(str(row.get("person_key") or ""), []).append(i)
    doubled: dict[int, list[int]] = {}
    for hits in by_person.values():
        for a in range(len(hits)):
            for b in range(a + 1, len(hits)):
                i, j = hits[a], hits[b]
                if overlapping(rows[i], rows[j]):
                    doubled.setdefault(i, []).append(j)
                    doubled.setdefault(j, []).append(i)
    for i, others in doubled.items():
        rows[i]["doubles"] = sorted({rows[j]["id"] for j in others})

    # ONE ENTRY, TWO SCHEDULED SHIFTS: both are covered_by_another.
    for eid, hits in by_entry.items():
        if len(hits) < 2:
            continue
        if any(i in doubled and j in doubled[i] for i in hits for j in hits if i != j):
            continue
        hits = _read_after_start(rows, hits, read_at)
        if len(hits) < 2:
            continue
        # A FAULT ONLY ON A READ PAST THE LATER SHIFT'S NO-CALL LINE, as a missing punch is: minutes into the second…
        latest = max(_instant(rows[i]["shift_at"]) for i in hits)
        fault = _mins(read_at, latest) >= psi_attendance.NOCALL_AFTER_MIN
        for i in hits:
            row = rows[i]
            row["verdict"] = COVERED
            row["fault"] = fault
            row["covers"] = sorted({rows[j]["id"] for j in hits if j != i})
            row["why"] = (f"one entry covers this shift and {len(hits) - 1} other — every shift "
                          "owes a clock-in and a clock-out of its own"
                          + ("" if fault else "; the clock has not been read long enough after "
                                              "the later one began to call it a fault"))

    # AND THE DOUBLE STANDS DOWN, once every verdict is in: only a row that would otherwise accuse somebody is…
    for i, others in doubled.items():
        if not rows[i]["fault"]:
            continue
        first = min([i] + [j for j in others if rows[j]["fault"]],
                    key=lambda k: (str(rows[k]["shift_at"]), str(rows[k]["id"])))
        if first == i:
            continue
        rows[i].update(
            verdict=DOUBLE, fault=False,
            why=("the roster holds this person on another shift at the same hours — one body "
                 "cannot punch for two, so the cell is what needs fixing"))

    counts: dict[str, int] = {}
    for r in rows:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
        if r["fault"]:
            counts["fault"] = counts.get("fault", 0) + 1
    return {"rows": rows, "counts": counts}


def _read_after_start(rows: list[dict], hits: list[int], read_at: datetime | None) -> list[int]:
    """The rows sharing one entry that a read made after their own start can speak for; every later one is made…"""
    floor = datetime.min.replace(tzinfo=UTC)
    ordered = sorted(hits, key=lambda k: (_instant(rows[k]["shift_at"]) or floor, str(rows[k]["id"])))
    kept = ordered[:1]
    for k in ordered[1:]:
        start = _instant(rows[k]["shift_at"])
        if read_at is not None and start is not None and read_at >= start:
            kept.append(k)
            continue
        rows[k].update(verdict=UNREADABLE, fault=False, entry_id="", entry_ids=[],
                       punched_in="", punched_out="",
                       why="the time clock was not read after this shift began")
    return kept


def fresh(row: dict | None, now: datetime) -> bool:
    """Was the read this verdict stands on made within FRESH_READ_MIN?"""
    got = _instant((row or {}).get("read_at"))
    return got is not None and _mins(now, got) <= FRESH_READ_MIN


def accusable(row: dict | None, now: datetime) -> bool:
    """Does this shift say "no clock-in and no clock-out" on a fresh read?"""
    return bool(row) and row.get("verdict") == MISSING and bool(row.get("fault")) \
        and fresh(row, now)


def meets(rows: list[dict], row: dict) -> dict | None:
    """The person's next shift that MEETS this one that day, or None."""
    end = _instant(row.get("shift_end"))
    if end is None:
        return None
    best = None
    for other in rows:
        if other is row or other.get("person_key") != row.get("person_key"):
            continue
        at = _instant(other.get("shift_at"))
        if at is None or at < end:
            continue
        gap = _mins(at, end)
        if gap <= MEET_MIN and (best is None or at < _instant(best["shift_at"])):
            best = other
    return best


# ── what a director is told back ───────────────────────────────────────────

# A RECEIVED ON FILE WHOSE CALL OFF WAITS FOR A FRESH READ OF THE CLOCK.
WAIT_READ = "read"

# WHAT A RECEIVED CAME TO, as the kind of the director's acknowledgement.
ACK_OPENED = "opened"     # the shift is an open shift now
ACK_WAITING = "waiting"   # on file; the call off waits for the clock or the calendar
ACK_CLOSED = "closed"     # on file; the shift was not opened, and it stops here
ACK_OUTCOMES = (ACK_OPENED, ACK_WAITING, ACK_CLOSED)


def received_ack(got: dict[str, Any]) -> tuple[str, str]:
    """(outcome, why): which acknowledgement a director's RECEIVED earns, and the one fact its words need — never…"""
    state = str(got.get("state") or "")
    if state == CONVERTED:
        window = got.get("window") if isinstance(got.get("window"), dict) else {}
        return ACK_OPENED, _plain(str(window.get("why") or "the house manager assigns it"))
    if state == CLOSED:
        return ACK_CLOSED, _plain(str(got.get("why") or "the house calendar refused it"))
    if str(got.get("waiting") or "") == WAIT_READ:
        return ACK_WAITING, ("it opens at the next read of the time clock, if that read still "
                             "shows no punch")
    if str(got.get("code") or "") == "converting":
        return ACK_WAITING, _plain(str(got.get("why") or "its call off is being made at this moment"))
    return ACK_WAITING, _plain(f"{got.get('why') or 'the house calendar could not be written'}"
                               " - it is tried again")


def received_words(got: dict[str, Any]) -> str:
    """The Hub's own line after a RECEIVED pressed on the punch board, and the ear's log of what a text came to."""
    ref = str(got.get("ref") or "")
    outcome, why = received_ack(got)
    if outcome == ACK_OPENED:
        return _plain(f"{ref}: the shift is now an open shift ({got.get('call_off_ref') or ''})"
                      f" - {why}.")
    if outcome == ACK_CLOSED:
        return _plain(f"{ref}: your RECEIVED is on file, and the shift was not opened - {why}. "
                      "It stops here.")
    return _plain(f"{ref}: your RECEIVED is on file - {why}.")


# WORDS THAT MAY STAND BESIDE RECEIVED AND A WARNING'S REF.
RECEIVED_COURTESY = frozenset({"ok", "okay", "thanks", "thank", "you", "thx", "ty", "got", "it",
                               "yes", "noted", "roger"})


def received_answer(text: Any) -> bool:
    """Is this text, less the warning's ref, a plain RECEIVED?"""
    raw = str(text or "")
    if "?" in raw:
        return False
    words = re.sub(r"[^a-z]+", " ", re.sub(r"['’]", "", raw.lower())).split()
    return any(w in RECEIVED_WORDS for w in words) \
        and all(w in RECEIVED_WORDS or w in RECEIVED_COURTESY for w in words)


# ── rung one: has the chase run out? ───────────────────────────────────────

# WHY THE CADENCE STOPPED, AND WHICH OF THOSE MEAN "RUNG ONE IS OVER".
NO_WAY_TO_ASK = frozenset({"no_contact", "not_staff", "opted_out"})
# THE PLATFORM SAID NOTHING, and that is never the person's doing: the sending dial was off, the door held the row.
PLATFORM_QUIET = frozenset({"held", "dial_off", "refused_quiet", "dial_unknown"})
# A NAME THE PEOPLE HOUSE DOES NOT SPELL is the platform's own weather too — a lookup miss, not "this person has no…
NAME_MISS = "no_person"
# A NO TO THE ASK is a person saying they are not coming, which the house manager is told in the same breath…
ANSWERED_NO = "answered_no"
# A REPLY AFTER A LOGIN MESSAGE THAT REACHED THEM (the reminder before the shift, or a "not logged in"): the person…
REPLIED = "replied"
# THE KINDS WHOSE DELIVERY MAKES A REPLY AN ANSWER TO BEING ASKED.
LOGIN_KINDS = ("login_before", "login_missing")


def chase_over(row: dict, now: datetime, *, delivered: int,
               stopped: set[str] | dict[str, Any], reached: int | None = None) -> tuple[bool, str]:
    """(has rung one run out, why) — asked of psi_reminders' OWN cadence."""
    reached = delivered if reached is None else reached
    sid = str(row.get("id") or "")
    why_stopped, code, stopped_at = "", "", None
    if isinstance(stopped, dict):
        got = stopped.get(sid)
        if isinstance(got, dict):
            why_stopped = str(got.get("why") or "")
            code = str(got.get("code") or "")
            stopped_at = _instant(got.get("at"))
        else:
            why_stopped = str(got or "")
    elif sid in stopped:
        why_stopped = "stopped"
    if why_stopped == ANSWERED_NO:
        return False, ""
    if why_stopped in NO_WAY_TO_ASK and code != NAME_MISS:
        return True, f"there is no way to ask them at all ({why_stopped.replace('_', ' ')})"
    if why_stopped in PLATFORM_QUIET or code == NAME_MISS:
        return False, ""
    if why_stopped == REPLIED:
        if max(delivered, reached) < 1 or stopped_at is None:
            return False, ""
        if _mins(now, stopped_at) >= REPLY_GRACE_MIN:
            return True, (f"they replied to a reminder that reached them, and {int(REPLY_GRACE_MIN)} "
                          "minutes later there is still no punch")
        return False, ""
    if delivered >= CHASE_TELLS:
        return True, f"the {delivered} reminders that reached them have all been said"
    return False, ""


def delivered_count(shift_id: str, kinds: Iterable[str] = ("login_missing",)) -> int:
    """How many messages of these kinds REACHED the person about this shift."""
    try:
        return psi_reminders.delivered_count(shift_id, tuple(kinds))
    except psi_reminders.LedgerUnreadable as exc:
        raise Unreadable(str(exc)) from exc


# ── what this lane holds between beats ─────────────────────────────────────

_LOCK = threading.Lock()
_P: dict[str, Any] = {"at": 0.0, "rows": [], "counts": {}, "why": ""}
# THE WARNINGS AS THE LAST POST READ THEM, for the punch board — the board rides that read rather than making one of…
_W: dict[str, Any] = {"at": 0.0, "rows": [], "why": ""}


def note(shifts: Iterable[dict], index: dict[str, list[tuple]], recent: set[str],
         now: datetime, *, read_at: datetime | None = None, absence_from: Any = None,
         houses: dict[str, str] | None = None, schedule_read: bool = True,
         offs: dict[str, list[dict]] | None = None,
         loose: list[dict] | None = None) -> dict[str, Any]:
    """Re-pairs from the reads the attendance lane has just made."""
    try:
        got = pair_shifts(shifts, index, recent, now, read_at=read_at,
                          absence_from=absence_from, schedule_read=schedule_read,
                          offs=offs, loose=loose)
    except Exception as exc:  # noqa: BLE001 — a view; the attendance lane goes on
        why = f"the shifts could not be paired ({type(exc).__name__}: {str(exc)[:160]})"
        log.warning("punch pairs: %s", why)
        with _LOCK:
            _P.update(at=0.0, rows=[], counts={}, why=why)
        return {"rows": [], "counts": {}}
    names = houses or {}
    for r in got["rows"]:
        if r.get("house"):
            r["house_name"] = names.get(str(r["house"]).strip().upper(), "")
    with _LOCK:
        _P.update(at=now.timestamp(), rows=got["rows"], counts=got["counts"], why="")
    return got


def rows() -> list[dict]:
    with _LOCK:
        return [dict(r) for r in _P["rows"]]


# the faults Support Requests is handed: a shift with no entry of its own, or one clocked in and never out
FIRST_FAULT_VERDICTS = (MISSING, OPEN)
FIRST_FAULT_FIELDS = ("id", "person", "person_key", "house", "house_name", "shift_code", "shift_at", "shift_end",
                      "verdict", "pair_fault", "read_at")


def first_faults(got: Iterable[dict] | None = None) -> list[dict]:
    """The shifts of the last pairing (`rows()`, or `got`) that ARE a fault — no entry of their own, or an entry…"""
    out = []
    for r in (rows() if got is None else got):
        if not isinstance(r, dict) or str(r.get("verdict") or "") not in FIRST_FAULT_VERDICTS:
            continue
        fault = r.get("pair_fault") if "pair_fault" in r else r.get("fault")
        if fault is not True or not str(r.get("id") or "").strip():
            continue
        out.append({k: (True if k == "pair_fault" else str(r.get(k) or "")) for k in FIRST_FAULT_FIELDS})
    return out


def stale(now: datetime) -> str:
    """Why the pairing may not be acted on now, or ''."""
    with _LOCK:
        at, why = float(_P["at"] or 0.0), str(_P.get("why") or "")
    if not at:
        return why or "the shifts have not been paired since the relay started"
    age = now.timestamp() - at
    if age > STALE_S:
        return f"the shifts were last paired {int(age // 60)} minutes ago"
    return ""


def status() -> dict[str, Any]:
    with _LOCK:
        return {"at": _P["at"], "counts": dict(_P["counts"]), "shifts": len(_P["rows"]),
                "why": str(_P.get("why") or "")}


def marks() -> dict[str, dict[str, Any]]:
    """Shift id → what the punch board shows beside the attendance verdict: the pair verdict, whether it is a…"""
    with _LOCK:
        pairs = [dict(r) for r in _P["rows"]]
        warned = [dict(w) for w in _W["rows"]]
    out: dict[str, dict[str, Any]] = {}
    for r in pairs:
        out[str(r["id"])] = {"pair": r.get("verdict") or "", "pair_fault": bool(r.get("fault")),
                             "pair_why": str(r.get("why") or "")}
    for w in warned:
        out.setdefault(str(w["id"]), {}).update(
            warning_state=w["state"], warning_ref=w["ref"], warning_tells=w["tells"],
            warning_why=w["why"])
    return out


def board_status(now: datetime | None = None) -> dict[str, Any]:
    """The punch board's `pairs` card: when the shifts were paired, whether that is stale and why, the counts…"""
    now = now or _now()
    with _LOCK:
        at = float(_P["at"] or 0.0)
        counts = dict(_P["counts"])
        warned = [dict(w) for w in _W["rows"]]
        w_at = float(_W["at"] or 0.0)
        w_why = str(_W.get("why") or "")
    why_stale = stale(now)
    out: dict[str, Any] = {
        "paired_at": (datetime.fromtimestamp(at, UTC).astimezone(OHIO).isoformat() if at else ""),
        "stale": why_stale, "counts": counts, "warnings": warned,
        "warnings_at": (datetime.fromtimestamp(w_at, UTC).astimezone(OHIO).isoformat()
                        if w_at else ""),
        "readable": True, "why": "", "warnings_why": ""}
    if not w_at:
        out.update(readable=False, warnings=[],
                   why=(f"the warnings to the directors could not be read ({w_why})" if w_why
                        else "the warnings to the directors have not been read since the relay "
                             "started" + (f" - {why_stale}" if why_stale else "")))
    elif w_why:
        out["warnings_why"] = f"the last read of the warnings failed ({w_why})"
    return out


def _warnings_failed(why: str) -> None:
    with _LOCK:
        _W["why"] = str(why or "the read failed")[:200]


def _remember_warnings(got: list[dict[str, Any]], now: datetime,
                       paired: list[dict] | None = None) -> None:
    keep = [{"id": str(w.get("id") or ""), "ref": str(w.get("ref") or ""),
             "person": str(w.get("person") or ""), "house": str(w.get("house") or ""),
             "house_name": str(w.get("house_name") or ""),
             "shift_code": str(w.get("shift_code") or ""), "day": str(w.get("day") or ""),
             "shift_at": _iso(w.get("shift_at")), "shift_end": _iso(w.get("shift_end")),
             "state": str(w.get("state") or ""),
             "tells": int(w.get("tells") or 0), "delivered": int(w.get("delivered") or 0),
             "why": str(w.get("why") or ""), "opened_at": _iso(w.get("opened_at")),
             "told_at": _iso(w.get("told_at")), "received_by": str(w.get("received_by") or ""),
             "call_off_ref": str(w.get("call_off_ref") or ""),
             # why an answered warning is not open yet, or why it stopped after the answer
             "call_off_why": str(w.get("call_off_why") or ""),
             # the real span of what was said, and why the latest round reached nobody
             "span": told_span(w), "unheard": unheard_words(w),
             # the latest round said nothing, for reasons no read of the clock can change
             "held_round": held_round(w),
             # why a telling that is due was not made this beat ('' when it was, or none was due)
             "waits": "", "waits_code": "",
             # a live warning a RECEIVED cannot open, because its shift shares a calendar cell
             "by_hand": (split_cell(w, paired)
                         if paired is not None and str(w.get("state") or "") == WARNED else "")}
            for w in got]
    with _LOCK:
        _W.update(at=now.timestamp(), rows=keep, why="")


# WHY A DUE TELLING WAITED, as a code the read planner asks (`reads_wanted`).
WAIT_QUIET = "quiet"          # the quiet window
WAIT_UNBACKED = "unbacked"    # no read of the clock fresh enough to stand on
WAIT_DIRECTORS = "directors"  # the directors list is unreadable or blank
WAIT_OWN = "own"              # the only director listed is the person it is about
WAIT_FULL = "full"            # this beat's post was full


def _note_waits(waits: dict[str, tuple[str, str]]) -> None:
    """Why each due telling was not made this beat, on the card beside its warning — an unreadable directors…"""
    with _LOCK:
        for w in _W["rows"]:
            code, words = waits.get(str(w.get("id") or ""), ("", ""))
            w["waits"], w["waits_code"] = _plain(words)[:300], code


def reads_wanted(now: datetime, read_at: datetime | None) -> dict[str, Any]:
    """{at, shifts}: when the attendance lane must read the clock again for the live warnings, and for which…"""
    with _LOCK:
        at_s = float(_W["at"] or 0.0)
        failed = bool(_W.get("why"))
        live = [dict(w) for w in _W["rows"]]
    if not at_s or failed or now.timestamp() - at_s > STALE_S:
        return {"at": None, "shifts": []}
    shifts: list[dict[str, Any]] = []
    for w in live:
        state = str(w.get("state") or "")
        end = _instant(w.get("shift_end"))
        if end is None or now >= end:
            continue
        if state == WARNED:
            if str(w.get("waits_code") or "") == WAIT_DIRECTORS:
                continue
            told = _instant(w.get("told_at"))
            every = HELD_READ_EVERY_MIN if w.get("held_round") else WARN_EVERY_MIN
            nxt = told + timedelta(minutes=every) if told is not None else now
            if psi_reminders.quiet(nxt):
                nxt = psi_reminders.quiet_ends(nxt)
        elif state == RECEIVED and not str(w.get("call_off_ref") or ""):
            nxt = now
        else:
            continue
        if nxt >= end:
            continue
        # THE LATEST READ ALREADY BACKS IT: fresh at the telling (or now, when the telling is overdue), so no read…
        if read_at is not None and _mins(max(nxt, now), read_at) <= FRESH_READ_MIN - 1:
            continue
        shifts.append({"id": str(w.get("id") or ""), "state": state, "at": nxt,
                       "shift_at": _instant(w.get("shift_at"))})
    return {"at": min((s["at"] for s in shifts), default=None), "shifts": shifts}


def forget() -> None:
    """Tests only."""
    with _LOCK:
        _P.update(at=0.0, rows=[], counts={}, why="")
        _W.update(at=0.0, rows=[], why="")


# ── the staff messages (pure) ──────────────────────────────────────────────

def plan(paired: list[dict], *, now: datetime, said: dict[str, Any]) -> dict[str, Any]:
    """{due, held}: the staff messages this lane owes now — ONE PER SHIFT."""
    due: list[dict] = []
    held: list[dict] = []
    gate = quiet_gate(now)
    for r in paired:
        for kind, extra in _staff_messages(paired, r, now):
            key = f"{kind}|{r['id']}"
            if not _handoff()._owed_again(said.get(key), now):
                continue
            row = door_row(r, kind, extra=extra)
            (due if gate["state"] == SEND_NOW else held).append(row)
    due.sort(key=lambda x: str(x.get("shift_at") or ""))
    return {"due": due[:MAX_ROWS], "held": held, "over": max(0, len(due) - MAX_ROWS)}


def _changeover_owed(r: dict, nxt: dict | None) -> bool:
    """May the person be told to punch out of `r` and into `nxt`?"""
    if nxt is None or r.get("verdict") != OPEN:
        return False
    for s in (r, nxt):
        if s.get("verdict") in (TOLD, DOUBLE) or s.get("told_kind") or s.get("doubles"):
            return False
    return True


def _staff_messages(paired: list[dict], r: dict, now: datetime) -> list[tuple[str, dict]]:
    """(kind, facts) this one shift owes the person now."""
    out: list[tuple[str, dict]] = []
    at, end = _instant(r.get("shift_at")), _instant(r.get("shift_end"))
    if r.get("verdict") == OPEN and r.get("fault"):
        out.append((K_OPEN_ENTRY, {"punched_in": r.get("punched_in") or ""}))
    # THE CHANGEOVER: said in the minutes before the first shift ends.
    if at is not None and end is not None and at <= now < end \
            and 0 <= _mins(end, now) <= CHANGEOVER_MIN:
        nxt = meets(paired, r)
        if _changeover_owed(r, nxt):
            out.append((K_CHANGEOVER, {
                "next_shift": nxt.get("shift_code") or "",
                "next_house": nxt.get("house_name") or nxt.get("house") or "",
                "next_at": nxt.get("shift_at") or ""}))
    return out


def row_key(kind: str, shift_id: str, occasion: str = "") -> str:
    """The id one telling is known by, at every door it passes."""
    return f"{kind}|{shift_id}" + (f"|t{occasion}" if occasion else "")


def shift_of_key(key: str) -> tuple[str, str]:
    """(kind, shift id) of a row key — the occasion tail dropped."""
    kind, _, rest = str(key).partition("|")
    if "|t" in rest:
        rest = rest.rsplit("|t", 1)[0]
    return kind, rest


def telling_of_key(key: str) -> tuple[int, str]:
    """(telling, director fold) of a warning row key; (-1, '') when it has none."""
    _kind, _, rest = str(key).partition("|")
    if "|t" not in rest:
        return -1, ""
    tail = rest.rsplit("|t", 1)[1]
    n, _, who = tail.partition(":")
    return (int(n) if n.isdigit() else -1), who


def door_row(r: dict, kind: str, *, occasion: str = "", person: str | None = None,
             extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """One row for `staffShiftReminder` — FACTS ONLY."""
    who = str(r.get("person") or "") if person is None else person
    row = {
        "id": row_key(kind, str(r["id"]), occasion), "kind": kind,
        "person": who,
        "person_key": (str(r.get("person_key") or "") if person is None else _fold(person)),
        "to_name": "" if person is None else person,
        "house": r.get("house") or "", "house_name": r.get("house_name") or "",
        "shift_code": r.get("shift_code") or "", "value": r.get("shift_code") or "",
        "shift_at": r.get("shift_at") or "", "shift_end": r.get("shift_end") or "",
        "day": r.get("day") or "", "col_iso": r.get("day") or "",
        "ref": r.get("ref") or "",
    }
    row.update(extra or {})
    return row


# ── the ladder, on Postgres (additive) ─────────────────────────────────────

WARNINGS_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_punch_warnings ("
    "id TEXT PRIMARY KEY, ref TEXT NOT NULL DEFAULT '', "
    "person TEXT NOT NULL DEFAULT '', person_key TEXT NOT NULL DEFAULT '', "
    "house TEXT NOT NULL DEFAULT '', house_name TEXT NOT NULL DEFAULT '', "
    "shift_code TEXT NOT NULL DEFAULT '', day TEXT NOT NULL DEFAULT '', "
    "shift_at TIMESTAMPTZ, shift_end TIMESTAMPTZ, "
    "state TEXT NOT NULL DEFAULT 'warned', why TEXT NOT NULL DEFAULT '', "
    "opened_at TIMESTAMPTZ NOT NULL DEFAULT now(), told_at TIMESTAMPTZ, "
    "tells INT NOT NULL DEFAULT 0, "
    "received_by TEXT NOT NULL DEFAULT '', received_at TIMESTAMPTZ, "
    "received_via TEXT NOT NULL DEFAULT '', "
    "call_off_ref TEXT NOT NULL DEFAULT '', call_off_why TEXT NOT NULL DEFAULT '', "
    "converted_at TIMESTAMPTZ, said JSONB NOT NULL DEFAULT '{}'::jsonb)"
)
WARNINGS_REF_DDL = (
    "CREATE INDEX IF NOT EXISTS asa_punch_warnings_ref ON asa_punch_warnings (ref)"
)
# ADDITIVE COLUMNS: how many times the door was asked at all, how many tellings really reached a director, the…
WARNINGS_ADD_DDL = (
    "ALTER TABLE asa_punch_warnings ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0",
    "ALTER TABLE asa_punch_warnings ADD COLUMN IF NOT EXISTS delivered INT NOT NULL DEFAULT 0",
    "ALTER TABLE asa_punch_warnings ADD COLUMN IF NOT EXISTS phones JSONB NOT NULL "
    "DEFAULT '[]'::jsonb",
    "ALTER TABLE asa_punch_warnings ADD COLUMN IF NOT EXISTS first_said_at TIMESTAMPTZ",
    "ALTER TABLE asa_punch_warnings ADD COLUMN IF NOT EXISTS last_said_at TIMESTAMPTZ",
)
SAID_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_punch_said ("
    "id TEXT PRIMARY KEY, shift_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', "
    "person TEXT NOT NULL DEFAULT '', said JSONB NOT NULL DEFAULT '{}'::jsonb, "
    "created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"
)
DDL = (WARNINGS_DDL, WARNINGS_REF_DDL, *WARNINGS_ADD_DDL, SAID_DDL)


class Refused(Exception):
    def __init__(self, why: str, code: str = "refused") -> None:
        super().__init__(why)
        self.why, self.code = why, code


class Unreadable(RuntimeError):
    """Something this lane must read could not be read. Nobody is let through."""


def _connect(dsn: str):
    import hub_db  # noqa: PLC0415 — the pure half is tested with no driver
    return hub_db.connect(dsn)


# THE TABLES ONCE PER DATABASE PER PROCESS.
_READY: set[str] = set()
_READY_LOCK = threading.Lock()


def _ensure(dsn: str) -> None:
    """The tables, on their own connection, once per database per process."""
    if dsn in _READY:
        return
    with _READY_LOCK:
        if dsn in _READY:
            return
        with _connect(dsn) as conn, conn.cursor() as cur:
            for stmt in DDL:
                cur.execute(stmt)
            conn.commit()
        _READY.add(dsn)


def forget_tables() -> None:
    """Tests only: the next connection makes the tables again."""
    with _READY_LOCK:
        _READY.clear()


def _now() -> datetime:
    return datetime.now(UTC)


DIRECTORS_KEY = "directors"


def directors(dsn: str) -> list[str]:
    """The directors, from the one settings list server/time_off.py reads."""
    try:
        import time_off  # noqa: PLC0415 — lazy: the pure half runs without it
    except Exception as exc:  # noqa: BLE001 — unreadable is not "nobody"
        raise Unreadable(f"the directors list could not be read ({type(exc).__name__})") from exc
    try:
        v = time_off.view(dsn)
        if not v.get("minted"):
            raise Unreadable("the Time Off house is not set up, so its directors list cannot be read")
        cell = ""
        for s in v.get("settings_rows") or []:
            value = str((s or {}).get("value") or "").strip()
            if value and str((s or {}).get("key") or "").strip() == DIRECTORS_KEY:
                cell = value
        got = [n.strip() for n in cell.split(",") if n.strip()]
    except Unreadable:
        raise
    except time_off.Unreadable as exc:
        raise Unreadable(f"the directors list could not be read: {exc}") from exc
    except Exception as exc:  # noqa: BLE001 — unreadable is not "nobody"
        raise Unreadable(f"the directors list could not be read ({type(exc).__name__})") from exc
    if not got:
        raise Unreadable("the directors list on the Time Off settings is blank, so nobody is warned "
                         "and nobody may answer")
    return got


def named_director(name: Any, listed: Iterable[str]) -> bool:
    """Is `name` one of the listed directors?"""
    if not _fold(name):
        return False
    listed = [str(n) for n in listed]
    try:
        import time_off  # noqa: PLC0415
    except ImportError:
        key = _fold(name)
        return any(_fold(n) == key for n in listed)
    return bool(time_off.is_director({"name": str(name)}, listed))


def is_director(dsn: str, name: Any) -> bool:
    return named_director(name, directors(dsn))


def _fold(name: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(name or "").strip().lower())


def _same(a: Any, b: Any) -> bool:
    """One person under two spellings?"""
    if not _fold(a) or not _fold(b):
        return False
    try:
        import time_off  # noqa: PLC0415
        return bool(time_off.same_person(a, b))
    except Exception:  # noqa: BLE001
        return _fold(a) == _fold(b)


def _spelling(name: str, people: list[dict[str, Any]] | None) -> str:
    """The People house's own spelling of a director's name, so the door finds their row — time_off's own…"""
    if not people:
        return name
    try:
        import time_off  # noqa: PLC0415
        return time_off.people_spelling(name, people)
    except Exception:  # noqa: BLE001 — the settings list's spelling travels instead
        return name


def _people() -> list[dict[str, Any]]:
    try:
        import time_off  # noqa: PLC0415
        return list(time_off.people_rows())
    except Exception:  # noqa: BLE001 — the door still folds the name itself
        return []


def stood_down(row: dict | None) -> str:
    """Why a warning on this shift should stop, or '' — the close rule, pure."""
    if row is None:
        return ""
    verdict = str(row.get("verdict") or "")
    if verdict == PAIRED:
        return "the punches arrived after the warning was opened"
    if verdict == OPEN:
        return ("they clocked in after the warning was opened — punching in late is punching, "
                "and this shift is no longer without a clock-in")
    if verdict == COVERED:
        return ("one entry covers this shift and another, so this is no longer a shift with no "
                "punch at all — it is a pair that was not kept")
    if verdict == TOLD:
        return f"a human wrote this day down ({row.get('told_kind') or 'a call off'})"
    if verdict == DOUBLE:
        return "the roster holds this person on another shift at the same hours"
    # ANYTHING ELSE LEAVES IT STANDING, and never says more than that: `missing` still is what the warning says, and…
    return ""


def open_warnings(dsn: str, paired: list[dict], *, now: datetime | None = None,
                  stopped: set[str] | dict[str, Any] | None = None) -> dict[str, int]:
    """Rung two: separate the shifts whose chase has run out, close the rest."""
    now = now or _now()
    if stopped is None:
        try:
            stopped = _stopped()
        except Unreadable as exc:
            log.warning("punch pairs: %s — no warning is opened this beat", exc)
            stopped = None
    counts = {"opened": 0, "closed": 0}
    by_id = {str(r["id"]): r for r in paired}
    import psycopg2.extras  # noqa: PLC0415
    _ensure(dsn)
    with _connect(dsn) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT id, state, call_off_ref, person_key, shift_at, shift_end "
                    "FROM asa_punch_warnings WHERE state = ANY(%s)", (list(LIVE_STATES),))
        held = {r["id"]: r for r in cur.fetchall()}
        live = {k: str(v["state"]) for k, v in held.items()}
        # ONE WARNING PER BODY: the live warnings, by the person and the hours they stand on — the stored row speaks…
        spoken: list[dict] = [by_id.get(k) or dict(v) for k, v in held.items()]
        for r in sorted(paired, key=lambda x: (str(x.get("shift_at") or ""), str(x.get("id") or ""))):
            if stopped is None:
                break
            sid = str(r["id"])
            if sid in live or not accusable(r, now):
                continue
            end = _instant(r.get("shift_end"))
            if end is None or now >= end:
                # A SHIFT THAT IS OVER IS NEVER WARNED ABOUT: its answer would open a shift nobody can take any more.
                continue
            if any(same_body(r, other) for other in spoken):
                continue
            try:
                delivered = delivered_count(sid)
                reached = delivered_count(sid, LOGIN_KINDS)
            except Unreadable as exc:
                log.warning("punch pairs: %s — no warning is opened this beat", exc)
                break
            over, why = chase_over(r, now, delivered=delivered, stopped=stopped, reached=reached)
            if not over:
                continue
            spoken.append(r)
            cur.execute(
                "INSERT INTO asa_punch_warnings (id, ref, person, person_key, house, house_name, "
                "shift_code, day, shift_at, shift_end, state, why, opened_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
                (sid, r.get("ref") or ref_of(sid), r.get("person") or "",
                 r.get("person_key") or "", r.get("house") or "", r.get("house_name") or "",
                 r.get("shift_code") or "", r.get("day") or "",
                 _instant(r.get("shift_at")), end, WARNED, _plain(why)[:500], now))
            counts["opened"] += cur.rowcount
        # THE WARNING STOPS BEING TRUE: it closes, and nobody is told anything more about it.
        for wid, state in live.items():
            why = stood_down(by_id.get(wid))
            if not why:
                continue
            if state == RECEIVED and str(held[wid].get("call_off_ref") or ""):
                continue
            if state == RECEIVED:
                # NEVER UNDER A PASS THAT IS MAKING ITS CALL OFF (`_claim`): what that pass makes lands on the row…
                shut = f"the shift was not opened - {why}"
                owe, args = _closed_ack_sql(False, shut, now)
                cur.execute("UPDATE asa_punch_warnings SET state=%s, why=%s, call_off_why=%s, "
                            f"said = {_LET_GO} || {owe} WHERE id=%s AND state=%s "
                            f"AND {_NO_LIVE_CLAIM}",
                            (CLOSED, _plain(shut)[:500], _plain(shut)[:500], *args, wid, state,
                             _claim_cutoff(now)))
            else:
                cur.execute("UPDATE asa_punch_warnings SET state=%s, why=%s WHERE id=%s AND state=%s",
                            (CLOSED, _plain(why)[:500], wid, state))
            counts["closed"] += cur.rowcount
        conn.commit()
    return counts


def told_span(row: dict[str, Any] | None) -> str:
    """How often a warning was SAID and over what span, read off the row's own first and latest telling — never a…"""
    row = row or {}
    tells = int(row.get("tells") or 0)
    if tells < 1:
        return "it was never said to a director"
    first, last = _instant(row.get("first_said_at")), _instant(row.get("last_said_at"))
    if first is None or last is None:
        return f"it was said {tells} time(s)"
    if tells == 1:
        return f"it was said once, at {_clock(first)}"
    return (f"it was said {tells} time(s) over {int(round(max(0.0, _mins(last, first))))} "
            f"minutes, from {_clock(first)} to {_clock(last)}")


def _said_of(row: dict[str, Any] | None) -> dict[str, Any]:
    raw = (row or {}).get("said")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = {}
    return raw if isinstance(raw, dict) else {}


def unheard_words(row: dict[str, Any] | None) -> str:
    """Why the latest round reached nobody, in the door's words per director; '' when that round said something…"""
    last = _said_of(row).get("last")
    answers = (last.get("answers") if isinstance(last, dict) else None) or []
    answers = [a for a in answers if isinstance(a, dict)]
    if not answers or any(str(a.get("state") or "") in SAID for a in answers):
        return ""
    return _plain("; ".join(f"{a.get('who') or 'a director'}: {a.get('why') or a.get('state') or 'no answer'}"
                            for a in answers))[:300]


def held_round(row: dict[str, Any] | None) -> bool:
    """Did the latest round say nothing, for reasons no read of the clock can change — its situation switched off…"""
    last = _said_of(row).get("last")
    answers = (last.get("answers") if isinstance(last, dict) else None) or []
    answers = [a for a in answers if isinstance(a, dict)]
    return bool(answers) and all(_answer_class(a) in ("final", "unsayable") for a in answers)


def ended_words(row: dict[str, Any] | None) -> str:
    """The row's words when the shift ended with no RECEIVED: the real span."""
    unheard = unheard_words(row)
    return _plain(f"the shift ended with no answer from a director - {told_span(row)}"
                  + (f", and the last try reached nobody ({unheard})" if unheard else "")
                  + " - nothing more is said about it, and nothing is opened")


def expire_warnings(dsn: str, *, now: datetime | None = None) -> int:
    """A warning whose shift has ended stops, and the row says so with the real span it was said over."""
    now = now or _now()
    import psycopg2.extras  # noqa: PLC0415
    n = 0
    _ensure(dsn)
    with _connect(dsn) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT id, shift_end, tells, first_said_at, last_said_at, said "
                    "FROM asa_punch_warnings "
                    "WHERE state=%s AND shift_end IS NOT NULL AND shift_end <= %s", (WARNED, now))
        for w in [dict(r) for r in cur.fetchall()]:
            end = _instant(w.get("shift_end"))
            if end is None or end > now:
                continue
            cur.execute("UPDATE asa_punch_warnings SET state=%s, why=%s WHERE id=%s AND state=%s",
                        (GAVE_UP, ended_words(w)[:500], str(w["id"]), WARNED))
            n += cur.rowcount
        conn.commit()
    if n:
        log.info("punch pairs: %s warning(s) stopped because their shift ended", n)
    return n


def _stopped() -> dict[str, Any]:
    """Shift id → WHY the cadence stopped."""
    try:
        return psi_reminders.stopped_why()
    except psi_reminders.LedgerUnreadable as exc:
        raise Unreadable(str(exc)) from exc


def warning_rows(dsn: str, *, states: Iterable[str] = LIVE_STATES,
                 since: datetime | None = None) -> list[dict[str, Any]]:
    import psycopg2.extras  # noqa: PLC0415
    _ensure(dsn)
    with _connect(dsn) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        if since is None:
            cur.execute("SELECT * FROM asa_punch_warnings WHERE state = ANY(%s) ORDER BY opened_at",
                        (list(states),))
        else:
            cur.execute("SELECT * FROM asa_punch_warnings WHERE state = ANY(%s) AND opened_at >= %s "
                        "ORDER BY opened_at", (list(states), since))
        return [dict(r) for r in cur.fetchall()]


def warning_by_ref(dsn: str, ref: str) -> dict[str, Any] | None:
    import psycopg2.extras  # noqa: PLC0415
    _ensure(dsn)
    with _connect(dsn) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM asa_punch_warnings WHERE ref=%s", (str(ref or "").upper(),))
        got = cur.fetchone()
    return dict(got) if got else None


def warning_due(row: dict[str, Any], now: datetime) -> str:
    """`tell` | `wait` — the director spacing, pure."""
    if str(row.get("state") or "") != WARNED:
        return "wait"
    told = _instant(row.get("told_at"))
    if told is not None and _mins(now, told) < WARN_EVERY_MIN:
        return "wait"
    return "tell"


def warning_door_rows(w: dict[str, Any], names: list[str],
                      people: list[dict[str, Any]] | None = None, *,
                      kind: str = K_WARNING) -> list[dict[str, Any]]:
    """ONE ROW PER DIRECTOR for one telling of one warning, each with its own id (the telling and the director…"""
    view = _warning_view(w)
    tells = int(w.get("tells") or 0)
    kind = kind if kind in WARNING_KINDS else K_WARNING
    out: list[dict[str, Any]] = []
    for n in names:
        if not _fold(n) or _same(n, view["person"]):
            continue
        who = _spelling(n, people)
        # `tells` is this telling's number and nothing more: there is no "of N" to promise, because the warning is…
        extra: dict[str, Any] = {"staff": view["person"], "tells": str(tells + 1)}
        if tells > 0:
            extra["mail"] = False
        out.append(door_row(view, kind, occasion=f"{tells}:{_fold(n)}", person=who, extra=extra))
    return out


def _unbacked_words(row: dict | None, now: datetime, *, held: bool = False) -> str:
    """Why a due telling is not backed by the latest read, in words for the board."""
    if row is None:
        return "the shift is not among the paired shifts right now - it is told once a read pairs it again"
    if row.get("verdict") == MISSING and row.get("fault"):
        return (f"the time clock has not been read in the last {int(FRESH_READ_MIN)} minutes - it is "
                "told at the next read that still shows no punch, which is asked for "
                + (f"within {int(HELD_READ_EVERY_MIN)} minutes of the last try, because that try "
                   "reached nobody for a reason no read changes" if held else "now"))
    return (f"the latest read does not back it ({row.get('why') or row.get('verdict') or 'unread'}) - "
            "it is told at the next read that still shows no punch")


def came_due(at: datetime) -> datetime:
    """When something owed at `at` could first be said: the quiet window's end when it came due inside it, so…"""
    return psi_reminders.quiet_ends(at)


def _follow_ack_rows(every: list[dict[str, Any]], said: dict[str, Any],
                     now: datetime, people: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """THE DIRECTOR WHO WAS TOLD "NOT OPEN YET" IS TOLD WHAT IT CAME TO."""
    out: list[dict[str, Any]] = []
    for w in every:
        state = str(w.get("state") or "")
        who = str(w.get("received_by") or "").strip()
        if not who:
            continue
        if state == CLOSED:
            kind, owed_ack = K_CLOSED_ACK, _said_of(w).get("closed_ack")
        elif state == CONVERTED:
            kind, owed_ack = K_OPEN_ACK, _said_of(w).get("open_ack")
        else:
            continue
        if not isinstance(owed_ack, dict) or not str(owed_ack.get("why") or ""):
            continue
        at = _instant(owed_ack.get("at"))
        if at is None or _mins(now, came_due(at)) > CLOSED_ACK_KEEP_H * 60.0:
            continue
        end = _instant(w.get("shift_end"))
        if kind == K_OPEN_ACK and (end is None or now >= end):
            continue
        key = row_key(kind, str(w["id"]))
        entry = said.get(key)
        if isinstance(entry, dict) and str(entry.get("code") or "") in SITUATION_HELD:
            continue
        if not _handoff()._owed_again(entry, now):
            continue
        if people is None:
            people = _people()
        view = _warning_view(w)
        out.append(door_row(view, kind, person=_spelling(who, people),
                            extra={"staff": view["person"],
                                   "call_off_ref": (str(w.get("call_off_ref") or "")
                                                    if kind == K_OPEN_ACK else ""),
                                   "why": _plain(str(owed_ack.get("why") or ""))[:300],
                                   "mail": False}))
    return out


def owed(dsn: str, *, now: datetime | None = None, limit: int = MAX_ROWS,
         paired: list[dict] | None = None) -> list[dict[str, Any]]:
    """Every row this lane owes the one send door now: the warnings first."""
    now = now or _now()
    try:
        expire_warnings(dsn, now=now)
    except Exception as exc:  # noqa: BLE001 — the rest still stands
        log.warning("punch pairs: the ended warnings could not be stopped (%s: %s)",
                    type(exc).__name__, str(exc)[:160])
    if paired is None:
        why = stale(now)
        if why:
            log.warning("punch pairs: %s — nothing is opened, told or planned until they are "
                        "paired again", why)
            return []
        paired = rows()
    out: list[dict[str, Any]] = []
    try:
        open_warnings(dsn, paired, now=now)
    except Exception as exc:  # noqa: BLE001 — the messages still stand
        log.warning("punch pairs: the warnings could not be opened (%s: %s)",
                    type(exc).__name__, str(exc)[:160])
    try:
        retry_conversions(dsn, now=now, paired=paired)
    except Exception as exc:  # noqa: BLE001 — the messages still stand
        log.warning("punch pairs: the answered warnings could not be converted (%s: %s)",
                    type(exc).__name__, str(exc)[:160])
    try:
        every = warning_rows(dsn, states=STATES, since=now - timedelta(days=BOARD_DAYS))
    except Exception as exc:  # noqa: BLE001
        log.warning("punch pairs: the warnings could not be read (%s)", type(exc).__name__)
        _warnings_failed(type(exc).__name__)
        every = None
    if every is not None:
        _remember_warnings(every, now, paired)
    by_id = {str(r["id"]): r for r in paired}
    gate = quiet_gate(now)
    names: list[str] | None = None
    names_why = ""
    people: list[dict[str, Any]] | None = None
    waits: dict[str, tuple[str, str]] = {}
    for w in [x for x in (every or []) if str(x.get("state") or "") == WARNED]:
        if warning_due(w, now) != "tell":
            continue
        wid = str(w["id"])
        if gate["state"] != SEND_NOW:
            waits[wid] = (WAIT_QUIET, f"the quiet window holds it - it is told at {_clock(gate['at'])} "
                                      "if it is still true then")
            continue
        # THE LIST FIRST: it is a read of the settings, not of the clock, so a telling that waits on it never has a…
        if names is None:
            try:
                names = directors(dsn)
            except Unreadable as exc:
                log.warning("punch pairs: %s — no warning is told this beat", exc)
                names, names_why = [], str(exc)
        if not names:
            # FAIL-CLOSED: an unreadable or blank list tells nobody, and the card says so rather than "not told yet".
            waits[wid] = (WAIT_DIRECTORS, f"{names_why or 'the directors list could not be read'} - "
                                          "nobody is told until it can be")
            continue
        # TOLD ONLY WHILE IT IS TRUE ON A FRESH READ: a warning that cannot be backed right now waits, and is not…
        if not accusable(by_id.get(wid), now):
            waits[wid] = (WAIT_UNBACKED, _unbacked_words(by_id.get(wid), now, held=held_round(w)))
            continue
        if people is None:
            people = _people()
        kind = K_WARNING_BY_HAND if split_cell(w, paired) else K_WARNING
        batch = warning_door_rows(w, names, people, kind=kind)
        if not batch:
            waits[wid] = (WAIT_OWN, "the only director on the list is the person it is about, and "
                                    "nobody is warned about their own shift")
            continue
        # A TELLING IS WHOLE OR NOT AT ALL: every director in the same round.
        if len(out) + len(batch) > limit:
            waits[wid] = (WAIT_FULL, "this beat's post was full - it goes at the next one")
            break
        out.extend(batch)
    if every is not None:
        _note_waits(waits)
    if len(out) >= limit:
        return out
    try:
        said = _said(dsn)
    except Exception as exc:  # noqa: BLE001
        log.warning("punch pairs: the said ledger could not be read (%s)", type(exc).__name__)
        return out
    if gate["state"] == SEND_NOW:
        out.extend(_follow_ack_rows(every or [], said, now, people)[:max(0, limit - len(out))])
    got = plan(paired, now=now, said=said)
    out.extend(got["due"][:max(0, limit - len(out))])
    return out


def _warning_view(w: dict[str, Any]) -> dict[str, Any]:
    """A stored warning in the shape the door row reads."""
    return {"id": str(w.get("id") or ""), "ref": str(w.get("ref") or ""),
            "person": str(w.get("person") or ""), "person_key": str(w.get("person_key") or ""),
            "house": str(w.get("house") or ""), "house_name": str(w.get("house_name") or ""),
            "shift_code": str(w.get("shift_code") or ""), "day": str(w.get("day") or ""),
            "shift_at": _iso(w.get("shift_at")), "shift_end": _iso(w.get("shift_end")),
            "time": _clock(w.get("shift_at")), "ends": _clock(w.get("shift_end"))}


def _said(dsn: str) -> dict[str, Any]:
    import psycopg2.extras  # noqa: PLC0415
    _ensure(dsn)
    with _connect(dsn) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT id, said FROM asa_punch_said WHERE updated_at > now() - interval '3 days'")
        return {r["id"]: r["said"] for r in cur.fetchall()}


# WHAT THE DOOR'S ANSWER MEANS FOR A TELLING.
SAID = frozenset({"told", "redirected", "rehearsed", "recorded", "duplicate"})
# AND OF THOSE, THE ONES THAT REACHED A PHONE — counted only when the door stood at `send` with test mode off, read…
DELIVERED = frozenset({"told", "duplicate"})
# NOBODY CAN BE TOLD THIS WAY AT ALL: no number we may text, not on staff, opted out, the dial shut.
UNSAYABLE = frozenset({"no_contact", "not_staff", "opted_out", "no_manager", "dial_off"})
# NOT NOW: the door's own clock was inside the window, or the dial could not be read.
NOT_NOW = frozenset({"refused_quiet", "dial_unknown"})
# A `held` THE SITUATION MADE — switched off, or with no words — said by the door's code (StaffAlerts.gs) or, from…
SITUATION_HELD = frozenset({"situation_off", "no_words"})
_SITUATION_HELD_WORDS = (" is off or absent", " names no SMS words")


def _answer_class(a: dict[str, Any]) -> str:
    """said | unsayable | final | not_now | attempt — what one director's answer does to a telling."""
    state, code, why = a.get("state") or "", a.get("code") or "", a.get("why") or ""
    if state in SAID:
        return "said"
    if state == "held":
        if code in SITUATION_HELD or any(w in why for w in _SITUATION_HELD_WORDS):
            return "final"
        return "not_now"
    if state in NOT_NOW:
        return "not_now"
    if state in UNSAYABLE and not (state == "no_contact" and code == NAME_MISS):
        return "unsayable"
    return "attempt"


def mark_said(dsn: str, ids: list[str], results: dict[str, Any],
              *, now: datetime | None = None) -> int:
    """Records the door's answer per row; "not now" stays owed, as every lane does."""
    now = now or _now()
    dial = str(results.get("dial") or "")
    test_mode = str(results.get("test_mode") or "")
    _handoff().note_dial(dial, test_mode)
    live_send = dial == "send" and test_mode == "off"
    by_id = {str(r.get("id")): r for r in (results.get("results") or []) if isinstance(r, dict)}
    rounds: dict[str, list[dict[str, Any]]] = {}
    done = 0
    _ensure(dsn)
    with _connect(dsn) as conn, conn.cursor() as cur:
        for key in ids:
            got = by_id.get(str(key))
            kind, shift = shift_of_key(str(key))
            if not got or kind not in KINDS or not shift:
                continue
            state = str(got.get("state") or "failed")
            if kind in WARNING_KINDS:
                _n, who = telling_of_key(str(key))
                rounds.setdefault(shift, []).append({
                    "who": who, "state": state, "why": str(got.get("why") or "")[:200],
                    "phone_key": str(got.get("phone_key") or ""),
                    "code": str(got.get("code") or "")})
                continue
            if state in _handoff().NOT_NOW:
                continue
            entry = {"state": state, "why": str(got.get("why") or "")[:300],
                     "at": now.astimezone(UTC).isoformat(), "dial": dial, "test_mode": test_mode,
                     "code": str(got.get("code") or "")}
            cur.execute(
                "INSERT INTO asa_punch_said (id, shift_id, kind, said, updated_at) "
                "VALUES (%s,%s,%s,%s,now()) ON CONFLICT (id) DO UPDATE SET said=EXCLUDED.said, "
                "updated_at=now()", (str(key), shift, kind, json.dumps(entry)))
            done += cur.rowcount
        for shift, answers in rounds.items():
            done += _mark_round(cur, shift, answers, now=now, live_send=live_send,
                                dial=dial, test_mode=test_mode)
        conn.commit()
    return done


def _mark_round(cur, shift: str, answers: list[dict[str, Any]], *, now: datetime,
                live_send: bool, dial: str, test_mode: str) -> int:
    """One telling of one warning, after the door answered for every director."""
    classes = [_answer_class(a) for a in answers]
    said = [a for a in answers if a["state"] in SAID]
    reached = [a for a in said if a["state"] in DELIVERED and live_send]
    last = json.dumps({"at": now.astimezone(UTC).isoformat(), "dial": dial,
                       "test_mode": test_mode,
                       "answers": [{"who": a["who"], "state": a["state"], "why": a["why"],
                                    "code": a.get("code") or ""} for a in answers]})
    if said:
        phones = sorted({a["phone_key"] for a in reached if a["phone_key"]})
        # THE PHONES ARE A SET: with no cap a warning is told dozens of times to the same directors, and each phone…
        cur.execute("UPDATE asa_punch_warnings SET tells=tells+1, attempts=attempts+1, "
                    "delivered=delivered+%s, told_at=%s, first_said_at=COALESCE(first_said_at, %s), "
                    "last_said_at=%s, phones=COALESCE((SELECT jsonb_agg(DISTINCT e.value) "
                    "FROM jsonb_array_elements(phones || %s::jsonb) AS e), '[]'::jsonb), "
                    "said = said || jsonb_build_object('last', %s::jsonb) "
                    "WHERE id=%s AND state=%s",
                    (1 if reached else 0, now, now, now, json.dumps(phones), last, shift, WARNED))
        return cur.rowcount
    if "not_now" in classes and all(c in ("not_now", "unsayable") for c in classes):
        cur.execute("UPDATE asa_punch_warnings SET told_at=%s, "
                    "said = said || jsonb_build_object('last', %s::jsonb) "
                    "WHERE id=%s AND state=%s", (now, last, shift, WARNED))
        return cur.rowcount
    cur.execute("UPDATE asa_punch_warnings SET told_at=%s, attempts=attempts+1, "
                "said = said || jsonb_build_object('last', %s::jsonb) "
                "WHERE id=%s AND state=%s", (now, last, shift, WARNED))
    return cur.rowcount


# ── rung three: a director's RECEIVED converts it ──────────────────────────

def _phones(w: dict[str, Any]) -> set[str]:
    raw = w.get("phones")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = []
    return {str(p) for p in (raw or []) if p}


def _pair_check(w: dict[str, Any], paired: list[dict] | None, now: datetime) -> str:
    """'' when the shift still says "no punch at all" on a fresh read; the reason it stood down when the verdict…"""
    if paired is None:
        why = stale(now)
        if why:
            raise Unreadable(f"{why} — the RECEIVED waits for a fresh read of the time clock")
        paired = rows()
    row = next((r for r in paired if str(r.get("id") or "") == str(w.get("id") or "")), None)
    if row is None:
        raise Unreadable("the shift is not among the paired shifts right now — the RECEIVED waits")
    why = stood_down(row)
    if why:
        return why
    if not accusable(row, now):
        raise Unreadable(f"the time clock has not been read in the last {int(FRESH_READ_MIN)} "
                         "minutes with this shift still showing no punch — the RECEIVED waits "
                         "for a read that does")
    return ""


def _shows_punch(w: dict[str, Any], paired: list[dict] | None) -> str:
    """Why the pairing on hand says this warning no longer stands, or ''."""
    rows_now = rows() if paired is None else paired
    row = next((r for r in rows_now if str(r.get("id") or "") == str(w.get("id") or "")), None)
    return stood_down(row)


def _not_waiting_words(ref: str, held: dict[str, Any]) -> str:
    """Why a warning quoted by its ref takes no answer any more, in its own state's words."""
    state = str(held.get("state") or "")
    by = str(held.get("received_by") or "") or "a director"
    if state == CONVERTED:
        return (f"the warning {ref} was already answered by {by}, and it is the open shift "
                f"{held.get('call_off_ref') or ''}").strip()
    if state == RECEIVED:
        return f"the warning {ref} was already answered RECEIVED by {by}"
    if state == GAVE_UP:
        return f"the warning {ref} stopped when its shift ended, so there is nothing left to open"
    if state == CLOSED:
        why = str(held.get("why") or "").strip()
        return f"the warning {ref} was closed" + (f" - {why}" if why else "")
    return f"the warning {ref} is {state or 'not waiting'}"


def acknowledge(dsn: str, *, by: str, ref: str = "", via: str = "sms", phone_key: str = "",
                now: datetime | None = None, paired: list[dict] | None = None,
                master: bool = False) -> dict[str, Any]:
    """A director's RECEIVED."""
    now = now or _now()
    name = str(by or "").strip()
    if not name:
        raise Refused("a RECEIVED is only ever counted from a named director", "no_name")
    ref = str(ref or "").strip().upper()
    mine: list[dict[str, Any]] = []
    if not ref:
        # A BARE WORD FROM A PHONE NO WARNING REACHED IS NOT OURS, and it is told so before the directors list is…
        key = str(phone_key or "")
        mine = [w for w in warning_rows(dsn, states=(WARNED,)) if key and key in _phones(w)]
        if not mine:
            raise Refused("no punch warning waiting was delivered to this phone — a RECEIVED "
                          "names the warning it answers", "not_asked_here")
    # An unreadable list raises Unreadable and lets NOBODY through.
    if not (master and via == "hub") and not is_director(dsn, name):
        raise Refused(f"{name} is not on the directors list, and only a director's RECEIVED "
                      "converts a warning", "not_a_director")
    if ref:
        live = warning_rows(dsn, states=(WARNED,))
        found = next((w for w in live if str(w.get("ref") or "").upper() == ref), None)
        if found is None:
            held = warning_by_ref(dsn, ref)
            if held is None:
                raise Refused(f"no warning carries the ref {ref}", "no_such_warning")
            raise Refused(_not_waiting_words(ref, held), "not_waiting")
    else:
        if len(mine) > 1:
            refs = ", ".join(sorted(str(w.get("ref") or "") for w in mine))
            raise Refused(f"{len(mine)} punch warnings are waiting ({refs}) — a RECEIVED names "
                          "the one it answers, so nothing was done", "several")
        found = mine[0]
    wref = str(found.get("ref") or "")
    if _same(found.get("person"), name):
        raise Refused(f"the warning {wref} is about {name}'s own shift, which they do not answer "
                      "- nothing was done", "own_shift")
    if int(found.get("delivered") or 0) < 1:
        raise Refused(f"the warning {wref} has not reached a director's phone yet - it was only "
                      "rehearsed or held - so nothing was done", "never_delivered")
    why = _shows_punch(found, paired)
    if why:
        _close_warned(dsn, str(found["id"]), why=why)
        raise Refused(f"the warning {wref} no longer stands - {why} - so nothing was done",
                      "stood_down")
    _ensure(dsn)
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("UPDATE asa_punch_warnings SET state=%s, received_by=%s, received_at=%s, "
                    "received_via=%s WHERE id=%s AND state=%s",
                    (RECEIVED, name, now, str(via or "")[:40], found["id"], WARNED))
        changed = cur.rowcount
        conn.commit()
    if not changed:
        raise Refused(f"the warning {wref} was answered a moment ago", "already")
    # THE ANSWER IS ON FILE FROM HERE ON.
    try:
        got = convert(dsn, found["id"], now=now, paired=paired)
    except Refused as exc:
        # SOMETHING ELSE MOVED THE ROW BETWEEN THE ANSWER AND ITS CALL OFF (a close, a retry): the director is told…
        got = _as_it_stands(dsn, str(found["id"]), exc.why,
                            fallback={"state": RECEIVED, "call_off_ref": "", "changed": False,
                                      "why": f"the call off could not be made yet ({exc.code})"})
    except Exception as exc:  # noqa: BLE001 — recorded is recorded
        log.warning("punch pairs: the warning %s was answered, and its call off could not be "
                    "made yet (%s)", wref, type(exc).__name__)
        got = {"state": RECEIVED, "call_off_ref": "", "changed": False,
               "why": f"the call off could not be made yet ({type(exc).__name__})"}
    if str(got.get("state") or "") == RECEIVED:
        got = _told_waiting(dsn, str(found["id"]), got, now=now)
    return {"ref": wref, "id": str(found["id"]), "by": name, **got}


def _told_waiting(dsn: str, warning_id: str, got: dict[str, Any], *,
                  now: datetime) -> dict[str, Any]:
    """The director is about to be told "on file, not open yet": the row says so, and so owes them what it comes…"""
    mark = json.dumps({"at": now.astimezone(UTC).isoformat(), "why": _plain(str(got.get("why") or ""))[:300]})
    try:
        _ensure(dsn)
        with _connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("UPDATE asa_punch_warnings SET said = said || jsonb_build_object("
                        "'waiting_ack', %s::jsonb) WHERE id=%s AND state=%s AND call_off_ref=''",
                        (mark, str(warning_id), RECEIVED))
            landed = cur.rowcount
            conn.commit()
    except Exception as exc:  # noqa: BLE001 — recorded is recorded
        log.warning("punch pairs: the warning %s could not be marked as told it waits (%s)",
                    warning_id, type(exc).__name__)
        return got
    if landed:
        return got
    return _as_it_stands(dsn, warning_id, str(got.get("why") or "the row moved"), fallback=got)


def _as_it_stands(dsn: str, warning_id: str, why: str, *,
                  fallback: dict[str, Any]) -> dict[str, Any]:
    """The answer's outcome read back off the row, after the row moved under it (the conversion was refused, or…"""
    try:
        row = _warning(dsn, warning_id) or {}
    except Exception as exc:  # noqa: BLE001 — recorded is recorded
        return {"state": RECEIVED, "call_off_ref": "", "changed": False,
                "why": f"the call off could not be made yet ({type(exc).__name__})"}
    state = str(row.get("state") or "")
    if state == CONVERTED:
        return {"state": CONVERTED, "call_off_ref": str(row.get("call_off_ref") or ""),
                "changed": False,
                "window": _window_of(_instant(row.get("converted_at")), row.get("shift_at"))}
    if state in (CLOSED, GAVE_UP):
        return {"state": CLOSED, "call_off_ref": "", "changed": False,
                "why": str(row.get("call_off_why") or row.get("why") or why)}
    return dict(fallback)


def _window_of(opened_at: datetime | None, shift_at: Any) -> dict[str, Any]:
    """The call off's application window, the estate's own arithmetic (shift_requests.window_for) — for words…"""
    start = _instant(shift_at)
    if opened_at is None or start is None:
        return {}
    try:
        import shift_requests  # noqa: PLC0415
        return dict(shift_requests.window_for(shift_requests.KIND_CALLOFF, opened_at=opened_at,
                                              shift_start=start, now=_now()))
    except Exception:  # noqa: BLE001 — words only
        return {}


def warned_phones(dsn: str) -> set[str]:
    """Every phone (the relay's hash) a warning still being told has reached — what the ear asks first of a bare…"""
    out: set[str] = set()
    for w in warning_rows(dsn, states=(WARNED,)):
        out |= _phones(w)
    return out


def convert(dsn: str, warning_id: str, *, now: datetime | None = None,
            paired: list[dict] | None = None) -> dict[str, Any]:
    """RECEIVED MAKES IT AN AUTOMATIC CALL OFF, through the estate's own act."""
    now = now or _now()
    row = _warning(dsn, warning_id)
    if row is None:
        raise Refused("that warning is not on file", "no_such_warning")
    if str(row.get("state") or "") == CONVERTED:
        return {"state": CONVERTED, "call_off_ref": str(row.get("call_off_ref") or ""),
                "changed": False,
                "window": _window_of(_instant(row.get("converted_at")), row.get("shift_at"))}
    if str(row.get("state") or "") != RECEIVED:
        raise Refused(f"a warning is converted once a director has answered it, and this one is "
                      f"{row.get('state')}", "not_received")
    close_why, code = _close_why(row, paired, now)
    if code == WAIT_READ:
        # nothing is decided, so nothing is written and nothing is claimed
        return {"state": RECEIVED, "call_off_ref": "", "changed": False, "why": close_why,
                "waiting": WAIT_READ}
    claim = _claim(dsn, warning_id, now)
    if not claim:
        # THE OTHER PASS IS MAKING THIS CALL OFF RIGHT NOW.
        return {"state": RECEIVED, "call_off_ref": "", "changed": False,
                "why": "its call off is being made at this moment", "code": "converting"}
    try:
        return _convert_claimed(dsn, warning_id, row, now=now, claim=claim,
                                close_why=close_why, code=code)
    except BaseException:
        # a pass that fails on its way lets its own claim go, never another's
        _let_go(dsn, warning_id, claim)
        raise


def _close_why(row: dict[str, Any], paired: list[dict] | None, now: datetime) -> tuple[str, str]:
    """(why the answered warning closes unopened, its code) — ('', '') when the call off may be made now, and…"""
    end = _instant(row.get("shift_end"))
    if end is not None and now >= end:
        return "the shift ended before it could be opened", ""
    # A PUNCH THE CLOCK HAS SHOWN DOES NOT UN-HAPPEN: asked of the pairing on hand however old, before the…
    gone = _shows_punch(row, paired)
    if gone:
        return f"the shift was not opened - {gone}", ""
    split = split_cell(row, paired)
    if split:
        return split, SPLIT_CELL
    try:
        gone = _pair_check(row, paired, now)
    except Unreadable as exc:
        return str(exc), WAIT_READ
    return (f"the shift was not opened - {gone}", "") if gone else ("", "")


def _closed(dsn: str, warning_id: str, *, why: str, claim: str, now: datetime,
            code: str = "") -> dict[str, Any]:
    """The claiming pass closes the answered warning unopened."""
    landed = _stand_down(dsn, warning_id, why=why, claim=claim, now=now)
    if not landed:
        return _as_it_stands(dsn, warning_id, why,
                             fallback={"state": RECEIVED, "call_off_ref": "", "changed": False,
                                       "why": "its call off is being made at this moment",
                                       "code": "converting"})
    out = {"state": CLOSED, "call_off_ref": "", "changed": False, "why": why}
    if code:
        out["code"] = code
    return out


def _convert_claimed(dsn: str, warning_id: str, row: dict[str, Any], *, now: datetime,
                     claim: str, close_why: str, code: str) -> dict[str, Any]:
    """`convert` for the pass that holds the claim: every write below is made under it, and each one that lands…"""
    import calendar_builder_houses as cbh  # noqa: PLC0415 — only this act needs it
    import shift_requests  # noqa: PLC0415
    if close_why:
        if code == SPLIT_CELL:
            log.info("punch pairs: the warning %s shares its cell with another shift — opened by "
                     "hand, never by the whole cell", row.get("ref"))
        return _closed(dsn, warning_id, why=close_why, claim=claim, now=now, code=code)
    try:
        view = shift_requests.estate(dsn)
        cell = _cell_for(view, str(row.get("house") or ""), str(row.get("person") or ""),
                         str(row.get("day") or ""))
    except Refused as exc:
        log.warning("punch pairs: the warning %s names no one house (%s)", row.get("ref"), exc.code)
        return _closed(dsn, warning_id, why=exc.why, claim=claim, now=now)
    except Exception as exc:  # noqa: BLE001 — an unreadable estate is tried again
        why = f"the house calendars could not be read ({type(exc).__name__})"
        _note_conversion(dsn, warning_id, ref="", why=why, at=None, claim=claim, now=now)
        return {"state": RECEIVED, "call_off_ref": "", "changed": False, "why": why}
    if cell is None:
        why = ("the house calendar has no cell for this person on this day, so the call off "
               "could not be made from here")
        _note_conversion(dsn, warning_id, ref="", why=why, at=None, claim=claim, now=now)
        return {"state": RECEIVED, "call_off_ref": "", "changed": False, "why": why}
    location, employee = cell
    day = str(row.get("day") or "")
    try:
        got = cbh.mark_call_off(
            dsn, location=location, employee=employee, col_iso=day,
            actor=str(row.get("received_by") or ""),
            note=(f"automatic call off: no clock-in and no clock-out for this shift, and the "
                  f"warning {row.get('ref')} was answered RECEIVED by "
                  f"{row.get('received_by') or 'a director'}"),
            now=now)
    except Exception as exc:  # noqa: BLE001 — the estate's own refusals travel as words
        why = f"{type(exc).__name__}: {str(exc)[:200]}"
        ecode = str(getattr(exc, "code", "") or "")
        # A POOL ROW THIS WARNING ITSELF MADE (its write landed, the note of it did not) is this warning's call off…
        try:
            mine = (_pooled_from(dsn, shift_requests.ref_of(location, employee, day),
                                 str(row.get("ref") or ""))
                    if ecode == "already_pooled" else None)
        except Unreadable as unread:
            why = (f"the shift is already in the open-shift pool, and whether this warning put it "
                   f"there could not be told ({unread})")
            _note_conversion(dsn, warning_id, ref="", why=why, at=None, claim=claim, now=now)
            log.warning("punch pairs: the warning %s met a pool row it could not read (%s)",
                        row.get("ref"), unread)
            return {"state": RECEIVED, "call_off_ref": "", "changed": False, "why": why}
        if mine:
            window = _window_of(_instant(mine.get("opened_at")), mine.get("shift_start"))
            _note_conversion(dsn, warning_id, ref=str(mine["ref"]), why="born from a punch warning",
                             at=_instant(mine.get("opened_at")) or now,
                             ack_why=str(window.get("why") or ""), claim=claim, now=now)
            return {"state": CONVERTED, "call_off_ref": str(mine["ref"]), "changed": False,
                    "window": window, "location": location, "col_iso": day}
        # A REFUSAL THAT WILL NEVER CHANGE ITS MIND stops here and says so; a shift already in the pool has the hole…
        if ecode in CONVERT_FINAL:
            log.info("punch pairs: the warning %s stops at the estate's own answer (%s)",
                     row.get("ref"), ecode)
            got_closed = _closed(dsn, warning_id, why=f"the shift was not opened from this warning — {why}",
                                 claim=claim, now=now)
            return dict(got_closed, why=why) if got_closed.get("state") == CLOSED else got_closed
        _note_conversion(dsn, warning_id, ref="", why=why, at=None, claim=claim, now=now)
        log.warning("punch pairs: the warning %s could not be turned into a call off (%s)",
                    row.get("ref"), why)
        return {"state": RECEIVED, "call_off_ref": "", "changed": False, "why": why}
    window = got.get("window") if isinstance(got.get("window"), dict) else {}
    # THE CALL OFF EXISTS: the row says so whoever holds the claim now, because it is true — a pass that took a dead…
    _note_conversion(dsn, warning_id, ref=str(got.get("ref") or ""),
                     why="born from a punch warning", at=now, ack_why=str(window.get("why") or ""),
                     claim=claim, now=now)
    log.info("punch pairs: the warning %s is now the call off %s — it entered the pool through "
             "the calendar's own act", row.get("ref"), got.get("ref"))
    return {"state": CONVERTED, "call_off_ref": str(got.get("ref") or ""), "changed": True,
            "window": got.get("window"), "location": location, "col_iso": row.get("day"),
            "value": got.get("value"), "path": got.get("path")}


def _claim_cutoff(now: datetime | None) -> datetime:
    """A claim taken before this belongs to a pass that died."""
    return (now or _now()) - timedelta(minutes=CLAIM_MIN)


def _claim(dsn: str, warning_id: str, now: datetime) -> str:
    """This pass holds the RECEIVED while it decides and makes the call off, or another does: the pass's own…"""
    token = secrets.token_hex(8)
    _ensure(dsn)
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("UPDATE asa_punch_warnings SET said = said || jsonb_build_object("
                    "'converting', %s::text, 'converting_by', %s::text) "
                    f"WHERE id=%s AND state=%s AND call_off_ref='' AND {_NO_LIVE_CLAIM}",
                    (now.astimezone(UTC).isoformat(), token, str(warning_id), RECEIVED,
                     _claim_cutoff(now)))
        held = cur.rowcount
        conn.commit()
    return token if held == 1 else ""


def _let_go(dsn: str, warning_id: str, claim: str) -> None:
    """The pass lets ITS OWN claim go, on a way out no write took; a claim another pass took over stays."""
    if not claim:
        return
    try:
        _ensure(dsn)
        with _connect(dsn) as conn, conn.cursor() as cur:
            cur.execute(f"UPDATE asa_punch_warnings SET said = {_LET_GO} WHERE id=%s AND {_HELD_BY}",
                        (str(warning_id), claim))
            conn.commit()
    except Exception as exc:  # noqa: BLE001 — it ages out after CLAIM_MIN
        log.warning("punch pairs: the claim on the warning %s could not be let go (%s)",
                    warning_id, type(exc).__name__)


def _pooled_from(dsn: str, pool_ref: str, wref: str) -> dict[str, Any] | None:
    """The open-shift pool row a call off of this warning already made, or None — known by the warning's own ref…"""
    if not pool_ref or not wref:
        return None
    import psycopg2.extras  # noqa: PLC0415
    try:
        with _connect(dsn) as conn, conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT ref, reason, opened_at, shift_start FROM asa_shift_pool WHERE ref=%s",
                        (pool_ref,))
            got = cur.fetchone()
    except Exception as exc:  # noqa: BLE001 — unread is not "not ours"
        raise Unreadable(f"the open-shift pool row {pool_ref} could not be read "
                         f"({type(exc).__name__})") from exc
    if not got or wref not in str(got.get("reason") or ""):
        return None
    return dict(got)


SPLIT_CELL = "split_cell"


def split_cell(w: dict[str, Any], paired: list[dict] | None) -> str:
    """Why this warning's shift may not be opened by a call off because it shares its calendar cell with another…"""
    rows_now = rows() if paired is None else paired
    key, day = str(w.get("person_key") or ""), str(w.get("day") or "")
    house, wid = _fold(w.get("house")), str(w.get("id") or "")
    if not key or not day:
        return ""
    others = [r for r in rows_now
              if str(r.get("id") or "") != wid and str(r.get("person_key") or "") == key
              and _fold(r.get("house")) == house and str(r.get("day") or "") == day]
    if not others:
        return ""
    spans = ", ".join(sorted(f"{r.get('time') or _clock(r.get('shift_at'))}-"
                             f"{r.get('ends') or _clock(r.get('shift_end'))}" for r in others))
    return _plain(
        f"the {w.get('house_name') or w.get('house') or 'house'} calendar holds this shift in one "
        f"cell with {len(others)} other shift(s) of {w.get('person') or 'the same person'} on "
        f"{day} ({spans}), and a call off opens the whole cell - nothing was opened; open this "
        "shift by hand on the house calendar")


def _cell_for(view: dict[str, Any], house: str, person: str, day: str) -> tuple[str, str] | None:
    """(location, the grid's own spelling of the row) for a house code and a name."""
    import house_cal_live  # noqa: PLC0415
    import house_directory  # noqa: PLC0415
    import shift_requests  # noqa: PLC0415
    code = house_directory.code_of(house) or str(house or "").upper()
    named = sorted({loc for loc in (view.get("isos") or {})
                    if (house_directory.code_of(loc) or "").upper() == code.upper()})
    if len(named) > 1:
        raise Refused(
            f"{len(named)} house calendars answer to the code {code} ({', '.join(named)}) — "
            "the shift was not opened, because nothing here may choose which one it is",
            "several_houses")
    location = (view.get("by_code") or {}).get(code)
    if not location:
        return None
    if day not in (view.get("isos") or {}).get(location, []):
        return None
    key = shift_requests.fold(person)
    for (emp, iso) in (view.get("cells") or {}).get(location, {}):
        if iso == day and shift_requests.fold(emp) == key \
                and not house_cal_live.not_a_person(emp, location):
            return location, emp
    row = next((n for n in (view.get("people") or {}).get(location, [])
                if shift_requests.fold(n) == key), "")
    return (location, row) if row else None


def _warning(dsn: str, warning_id: str) -> dict[str, Any] | None:
    import psycopg2.extras  # noqa: PLC0415
    _ensure(dsn)
    with _connect(dsn) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM asa_punch_warnings WHERE id=%s", (str(warning_id),))
        got = cur.fetchone()
    return dict(got) if got else None


def _note_conversion(dsn: str, warning_id: str, *, ref: str, why: str,
                     at: datetime | None, ack_why: str = "", claim: str = "",
                     now: datetime | None = None) -> int:
    """The row says it was born from a warning and which director answered it."""
    _ensure(dsn)
    with _connect(dsn) as conn, conn.cursor() as cur:
        if ref:
            ack = json.dumps({"why": _plain(ack_why or "the house manager assigns it")[:300],
                              "at": _now().astimezone(UTC).isoformat()})
            cur.execute("UPDATE asa_punch_warnings SET state=%s, call_off_ref=%s, "
                        f"call_off_why=%s, converted_at=%s, said = {_LET_GO} || "
                        "(CASE WHEN said ? 'waiting_ack' THEN jsonb_build_object('open_ack', %s::jsonb) "
                        "ELSE '{}'::jsonb END) WHERE id=%s AND state=%s",
                        (CONVERTED, ref, _plain(why)[:500], at, ack, str(warning_id), RECEIVED))
        else:
            guard, guard_arg = (_HELD_BY, claim) if claim else (_NO_LIVE_CLAIM, _claim_cutoff(now))
            cur.execute(
                f"UPDATE asa_punch_warnings SET call_off_why=%s, said = {_LET_GO} || "
                "jsonb_build_object('convert', jsonb_build_object("
                "'tries', coalesce((said->'convert'->>'tries')::int, 0) + 1, "
                f"'at', %s::text, 'why', %s::text)) WHERE id=%s AND {guard}",
                (_plain(why)[:500], _now().astimezone(UTC).isoformat(),
                 _plain(why)[:300], str(warning_id), guard_arg))
        changed = cur.rowcount
        conn.commit()
    return changed


def _closed_ack_sql(owe_ack: bool, why: str, now: datetime | None) -> tuple[str, tuple]:
    """The piece of a closing write that owes the director the closed acknowledgement: when the caller says so…"""
    ack = json.dumps({"why": _plain(why)[:300], "at": (now or _now()).astimezone(UTC).isoformat()})
    return ("(CASE WHEN %s OR said ? 'waiting_ack' THEN jsonb_build_object('closed_ack', %s::jsonb) "
            "ELSE '{}'::jsonb END)", (bool(owe_ack), ack))


def _stand_down(dsn: str, warning_id: str, *, why: str, owe_ack: bool = False,
                now: datetime | None = None, claim: str = "") -> int:
    """An answered warning stops here, and the row says which answer stopped it."""
    owe, args = _closed_ack_sql(owe_ack, why, now)
    guard, guard_arg = (_HELD_BY, claim) if claim else (_NO_LIVE_CLAIM, _claim_cutoff(now))
    _ensure(dsn)
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("UPDATE asa_punch_warnings SET state=%s, call_off_why=%s, why=%s, "
                    f"said = {_LET_GO} || {owe} WHERE id=%s AND state=%s AND {guard}",
                    (CLOSED, _plain(why)[:500], _plain(why)[:500], *args,
                     str(warning_id), RECEIVED, guard_arg))
        changed = cur.rowcount
        conn.commit()
    return changed


def _close_warned(dsn: str, warning_id: str, *, why: str) -> None:
    """A warning still being told stops here, because a fresh read says it is no longer true."""
    _ensure(dsn)
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("UPDATE asa_punch_warnings SET state=%s, why=%s WHERE id=%s AND state=%s",
                    (CLOSED, _plain(why)[:500], str(warning_id), WARNED))
        conn.commit()


def retry_conversions(dsn: str, *, now: datetime | None = None,
                      paired: list[dict] | None = None) -> dict[str, int]:
    """Every RECEIVED with no call off yet, tried again — spaced, and capped."""
    now = now or _now()
    counts = {"converted": 0, "tried": 0, "stopped": 0}
    for w in warning_rows(dsn, states=(RECEIVED,)):
        if str(w.get("call_off_ref") or ""):
            continue
        end = _instant(w.get("shift_end"))
        if end is not None and now >= end:
            counts["stopped"] += _stand_down(dsn, str(w["id"]),
                                             why="the shift ended before it could be opened",
                                             owe_ack=True, now=now)
            continue
        said = _said_of(w)
        last = said.get("convert") if isinstance(said.get("convert"), dict) else {}
        tries = int(last.get("tries") or 0)
        at = _instant(last.get("at"))
        if at is not None and _mins(now, at) < CONVERT_EVERY_MIN:
            continue
        if tries >= CONVERT_TRIES:
            counts["stopped"] += _stand_down(
                dsn, str(w["id"]),
                why=(f"the shift could not be opened after {tries} tries - "
                     f"{w.get('call_off_why') or 'the house calendar refused'} - open it by "
                     "hand on the house calendar"), owe_ack=True, now=now)
            continue
        counts["tried"] += 1
        try:
            got = convert(dsn, str(w["id"]), now=now, paired=paired)
        except Exception as exc:  # noqa: BLE001 — the lane goes on
            log.warning("punch pairs: the warning %s could not be converted (%s)",
                        w.get("ref"), type(exc).__name__)
            try:
                _note_conversion(dsn, str(w["id"]), ref="", at=None, now=now,
                                 why=f"the call off could not be made ({type(exc).__name__})")
            except Exception:  # noqa: BLE001 — the next beat tries again
                pass
            continue
        if str(got.get("state") or "") == CONVERTED:
            counts["converted"] += 1
    return counts
