"""The shift flow: every message a shift owes, re-planned purely each beat so a message exists only while its reason does."""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import re
import threading
import unicodedata
from datetime import datetime, time as dtime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable
from zoneinfo import ZoneInfo

log = logging.getLogger("hub.psi_reminders")

OHIO = ZoneInfo("America/New_York")
UTC = timezone.utc

OUT = Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"))
STATE_FILE = Path(os.getenv("HUB_PSI_REMINDERS_STATE", str(OUT / ".psi-reminders.json")))
INBOX_DIR = Path(os.getenv("HUB_QUO_INBOX_DIR", str(OUT / "quo-inbox")))


def _on(name: str, default: str) -> bool:
    return os.getenv(name, default).strip().lower() not in ("0", "no", "off", "false")


BEFORE_MIN = float(os.getenv("HUB_PSI_REMIND_BEFORE_MIN", "5"))
BEFORE_LATE_MIN = float(os.getenv("HUB_PSI_REMIND_BEFORE_LATE_MIN", "10"))
EVERY_MIN = float(os.getenv("HUB_PSI_REMIND_EVERY_MIN", "30"))
CAP_H = float(os.getenv("HUB_PSI_REMIND_CAP_H", "24"))
# Past the shift's end plus this, "not logged in" is no longer said; 1440 restores the bare day's cap.
AFTER_END_MIN = float(os.getenv("HUB_PSI_REMIND_AFTER_END_MIN", "60"))
# A check older than this does not back a "not logged in".
CHECK_FRESH_MIN = float(os.getenv("HUB_PSI_REMIND_CHECK_FRESH_MIN", "20"))
# Nor does a check made before the lane's own late line.
MISSING_AFTER_MIN = float(os.getenv("HUB_PSI_REMIND_MISSING_AFTER_MIN",
                                    os.getenv("HUB_PSI_LATE_AFTER_MIN", "20")))
# Minimum gap between two "not logged in" for one shift, whether clock- or calendar-backed.
SPACING_MIN = float(os.getenv("HUB_PSI_REMIND_SPACING_MIN", str(max(0.0, EVERY_MIN - 2))))
CALENDAR_FOLLOW_UPS = _on("HUB_PSI_REMIND_CALENDAR_FOLLOW_UPS", "1")

# OFF brings back rule 13 without the asks (reminder and "not logged in" to everybody).
CONFIRM_FLOW = _on("HUB_SHIFT_CONFIRM", "1")
CONFIRM_FIRST_MIN = float(os.getenv("HUB_SHIFT_CONFIRM_FIRST_MIN", "30"))
CONFIRM_EVERY_MIN = float(os.getenv("HUB_SHIFT_CONFIRM_EVERY_MIN", "10"))
CONFIRM_DEADLINE_MIN = float(os.getenv("HUB_SHIFT_CONFIRM_DEADLINE_MIN", "30"))
# The house manager's clock-backed "did not go" waits at most this long for a post-deadline read, then goes unchecked.
HM_CHECK_WAIT_MIN = float(os.getenv("HUB_SHIFT_HM_CHECK_WAIT_MIN", "60"))
# A first ask the quiet window would cut goes this much early: a beat can miss the one-minute 21:30 slot.
ASK_LEAD_MIN = float(os.getenv("HUB_SHIFT_CONFIRM_LEAD_MIN", "5"))
# A late call is reported only if learned before the start or this soon after it.
LATE_CALL_AFTER_MIN = float(os.getenv("HUB_LATE_CALL_AFTER_MIN", "30"))
# Blank accepts any line; sms_ears.py hears these too.
_REPLY_ORDER = tuple(
    d for d in (re.sub(r"\D", "", x)[-10:] for x in
                os.getenv("HUB_SHIFT_REPLY_LINE", "+13309195558,+13307544040").split(","))
    if len(d) == 10)
REPLY_LINES = frozenset(_REPLY_ORDER)
REPLY_LINE = _REPLY_ORDER[0] if _REPLY_ORDER else ""
# A reply quoting an SP…, HO… or PW… (a punch warning's) ref belongs to sms_ears.py, not this flow.
ELSEWHERE_RE = re.compile(r"\b(?:SP|HO|PW)[0-9A-F]{10}\b")

# Rule 8, the daily note.
NOTE_FLOW = _on("HUB_NOTE_REMIND", "1")
NOTE_BEFORE_MIN = tuple(float(x) for x in os.getenv("HUB_NOTE_BEFORE_MIN", "30,10").split(",")
                        if x.strip())
NOTE_AFTER_MIN = float(os.getenv("HUB_NOTE_AFTER_MIN", "10"))
NOTE_EVERY_H = int(os.getenv("HUB_NOTE_EVERY_H", "2"))
NOTE_DAY_FROM_H = int(os.getenv("HUB_NOTE_DAY_FROM_H", "8"))
NOTE_DAY_TO_H = int(os.getenv("HUB_NOTE_DAY_TO_H", "20"))
NOTE_WINDOW_H = float(os.getenv("HUB_NOTE_WINDOW_H", "48"))
NOTE_CAP = int(os.getenv("HUB_NOTE_CAP", "12"))
NOTE_MERGE_MIN = float(os.getenv("HUB_NOTE_MERGE_MIN", "15"))
# A missed slot is not said late: past this, or past the next slot, the next one carries it.
NOTE_LATE_MIN = float(os.getenv("HUB_NOTE_LATE_MIN", "60"))
# Per person per New York day, across all shifts (a merged message counts against each shift it covers).
NOTE_PERSON_DAY_CAP = int(os.getenv("HUB_NOTE_PERSON_DAY_CAP", "6"))
# 0 keeps the stale-book hold off; an unreadable book reminds nobody either way.
NOTE_BOOK_FRESH_DAYS = float(os.getenv("HUB_NOTE_BOOK_FRESH_DAYS", "0"))
# The notes book keeps names as spoken, so a near match counts as the roster's person.
NOTE_NAME_FUZZ = float(os.getenv("HUB_NOTE_NAME_FUZZ", "0.8"))

# New York wall time: QUIET_FROM is the first silent minute (21:30 stays allowed), QUIET_TO the first that is not.
QUIET_FROM = os.getenv("HUB_QUIET_FROM", "21:31")
QUIET_TO = os.getenv("HUB_QUIET_TO", "08:00")
# Several posts per beat: a row pushed past 21:30 by the cap lands in the quiet window.
MAX_PER_POST = int(os.getenv("HUB_PSI_REMIND_MAX", "25"))
POSTS_PER_BEAT = int(os.getenv("HUB_PSI_REMIND_POSTS_PER_BEAT", "3"))
POST_RETRY_S = float(os.getenv("HUB_PSI_REMIND_POST_RETRY_S", "600"))
DIAL_RETRY_S = float(os.getenv("HUB_PSI_REMIND_DIAL_RETRY_S", "120"))
FAILED_OFFERS = int(os.getenv("HUB_PSI_REMIND_FAILED_OFFERS", "3"))
LEDGER_KEEP_DAYS = 3
INBOX_LOOKBACK_H = 36

# Answers that close an occasion for good; `failed` and _NOT_NOW do not.
_DONE = {"told", "rehearsed", "redirected", "recorded", "held", "refused",
         "no_contact", "opted_out", "duplicate", "not_staff", "no_manager", "dial_off"}
# Not written down: planned again later (a quiet-window refusal by the door's clock, or an unreadable dial).
_NOT_NOW = {"refused_quiet", "dial_unknown"}
# End a shift's follow-ups; `rehearsed` and `recorded` do not, since rehearsal rows are the point.
_STOPS = {"no_contact", "not_staff", "opted_out", "held", "dial_off"}
_ASK_STOPS = _STOPS
_SPOKE = {"told", "rehearsed", "redirected", "recorded", "duplicate"}
# Reached the person: only these make "did not reply" sayable.
_DELIVERED = {"told", "duplicate"}
_MUTED = {"dial_off", "held"}
MUTE_MEMORY_MIN = 120.0

# When over the cap, the rows whose moment passes soonest go first.
_URGENCY = {"confirm_ask": 0, "confirm_again": 0, "login_before": 1, "hm_confirm_no": 2,
            "hm_no_show": 2, "late_call": 2, "early_in": 2, "login_missing": 3, "note_due": 4}

# `not_entered_yet` is deliberately absent: late-typed entries are unknown, never an absence.
_MISSING = {"no_punch_yet", "no_punch"}
_ON_CLOCK = {"punched_on_time", "late"}

ASK_KINDS = {"confirm_ask", "confirm_again"}
LOGIN_KINDS = {"login_before", "login_missing"}
HM_KINDS = {"early_in", "hm_no_show", "hm_confirm_no", "late_call"}
KINDS = ASK_KINDS | LOGIN_KINDS | HM_KINDS | {"note_due"}


# ── time ───────────────────────────────────────────────────────────────────

def _hm(text: str) -> dtime:
    h, m = str(text).split(":")
    return dtime(int(h), int(m))


def quiet(at: datetime) -> bool:
    """Inside the quiet window (New York): 21:31:00 through 07:59:59."""
    local = at.astimezone(OHIO).time()
    start, end = _hm(QUIET_FROM), _hm(QUIET_TO)
    if start <= end:
        return start <= local < end
    return local >= start or local < end


def quiet_ends(at: datetime) -> datetime:
    """The first instant at or after `at` that is outside the window."""
    if not quiet(at):
        return at
    local = at.astimezone(OHIO)
    end = _hm(QUIET_TO)
    day = local.date() if local.time() < end else local.date() + timedelta(days=1)
    wall = datetime(day.year, day.month, day.day, end.hour, end.minute, tzinfo=OHIO)
    return wall.astimezone(UTC)


def quiet_begins(at: datetime) -> datetime:
    """The first instant at or after `at` that is inside the window."""
    if quiet(at):
        return at
    local = at.astimezone(OHIO)
    start = _hm(QUIET_FROM)
    day = local.date()
    wall = datetime(day.year, day.month, day.day, start.hour, start.minute, tzinfo=OHIO)
    if wall <= local:
        day = day + timedelta(days=1)
        wall = datetime(day.year, day.month, day.day, start.hour, start.minute, tzinfo=OHIO)
    return wall.astimezone(UTC)


def _mins(a: datetime, b: datetime) -> float:
    return (a.astimezone(UTC) - b.astimezone(UTC)).total_seconds() / 60.0


def _instant(raw: Any) -> datetime | None:
    try:
        got = datetime.fromisoformat(str(raw or "").replace("Z", "+00:00"))
    except ValueError:
        return None
    return got if got.tzinfo else got.replace(tzinfo=UTC)


# ── keys and words ─────────────────────────────────────────────────────────

def phone_key(raw: Any) -> str:
    """Must match the door's hash: sha256 of the last ten digits, first sixteen hex."""
    digits = re.sub(r"\D", "", str(raw or ""))[-10:]
    if len(digits) != 10:
        return ""
    return hashlib.sha256(digits.encode()).hexdigest()[:16]


def occasion_key(kind: str, person_key: str, shift_at_utc: str, occasion: str) -> str:
    return f"{kind}|{person_key}|{shift_at_utc}|{occasion}"


def _utc_iso(at: datetime) -> str:
    return at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


_YES = frozenset({"yes", "y", "sim", "ok", "okay", "yep", "yeah", "yup"})
_NO = frozenset({"no", "n", "nao", "nope", "nah", "nop"})
# "No problem" is not a NO.
_NO_BUT_FINE = frozenset({"problem", "prob", "problemo", "worries", "worry"})
# Matched on folded text (apostrophes dropped), whole refusals only: "can't wait" is not one.
_REFUSAL = re.compile(
    r"\b(?:cant|can not|cannot|wont|will not|unable to|not able to)\s+"
    r"(?:make|come|go|work|be there|be in|do it|cover)\b"
    r"|\bnot\s+(?:coming|going to make|gonna make|going in|coming in|working today|make it)\b"
    r"|\b(?:calling|call|called)\s+(?:off|out|in sick)\b"
    r"|\b(?:im|i am|been|feeling)\s+sick\b|\bsick today\b")
_LATE = re.compile(
    r"\b(?:running|gonna be|going to be|will be|ill be|im|i am|be|coming in|arriving|arrive)\s+"
    r"(?:a\s+(?:little\s+)?(?:bit\s+)?|a\s+few\s+(?:min|mins|minutes)\s+|"
    r"\d+\s*(?:min|mins|minute|minutes|hour|hours|hr|hrs)\s+)?late\b"
    r"|\b(?:cant|cannot|can not|wont|will not|not)\s+(?:make it|be there|get there)\s+on time\b")
_NOT_LATE = re.compile(r"\b(?:wont|will not|not|never)\s+be\s+(?:\w+\s+){0,2}late\b|\bnot\s+(?:running\s+)?late\b")


def _fold_reply(text: Any) -> str:
    folded = unicodedata.normalize("NFKD", str(text or ""))
    folded = "".join(c for c in folded if not unicodedata.combining(c)).lower()
    folded = re.sub(r"['’‘`]", "", folded)
    return " ".join(re.findall(r"[a-z0-9]+", folded))


def reply_word(text: Any) -> str:
    """'yes', 'no', 'late' or 'other'; late words decide first, then the first word, then a refusal anywhere."""
    folded = _fold_reply(text)
    words = folded.split()
    if not words:
        return "other"
    if _LATE.search(folded) and not _NOT_LATE.search(folded):
        return "late"
    if words[0] in _NO and not (len(words) > 1 and words[1] in _NO_BUT_FINE):
        return "no"
    if _REFUSAL.search(folded):
        return "no"
    if words[0] in _YES:
        return "yes"
    return "other"


def owed_until(row: dict) -> datetime | None:
    """Last instant for a "not logged in": a day after the start or AFTER_END_MIN past the end, whichever is first."""
    at = _instant(row.get("shift_at"))
    if at is None:
        return None
    until = at + timedelta(hours=CAP_H)
    end = _instant(row.get("shift_end"))
    if end is not None:
        until = min(until, end + timedelta(minutes=AFTER_END_MIN))
    return until


def _shift_of_key(key: str) -> tuple[str, str, str, str] | None:
    parts = str(key).split("|")
    return (parts[0], parts[1], parts[2], parts[3]) if len(parts) == 4 else None


# ── the plan (pure) ────────────────────────────────────────────────────────

def plan(rows: Iterable[dict], *, mode: str, now: datetime, ledger: dict[str, Any],
         stopped: dict[str, Any], answers: dict[str, Any] | None = None,
         notes: dict[str, Any] | None = None,
         keep: dict[str, Any] | None = None) -> dict[str, Any]:
    """Messages owed now as {due, held, awaiting, quiet}; a row whose `known` is False is never texted."""
    due: list[dict] = []
    held: list[dict] = []
    awaiting: list[dict] = []
    in_quiet = quiet(now)
    answers = answers or {}
    last_missing: dict[tuple[str, str], datetime] = {}
    # THE SHIFTS THIS LANE HAS ALREADY ASKED ABOUT ONCE.
    missing_any: set[tuple[str, str]] = set()
    # Reached and spoken stay apart: "did not reply" is said only of the reached.
    asked: dict[tuple[str, str], bool] = {}
    asked_spoke: set[tuple[str, str]] = set()
    asks_any: set[tuple[str, str]] = set()
    asks_blocked: set[tuple[str, str]] = set()
    asks_muted: set[tuple[str, str]] = set()
    hm_decided: set[tuple[str, str]] = set()
    hm_rehearsal: set[tuple[str, str]] = set()
    latest_hm: tuple[datetime, str] | None = None
    for key, v in ledger.items():
        got = _shift_of_key(key)
        if got is None:
            continue
        kind, pk, at_iso, _occ = got
        shift = (pk, at_iso)
        state = str((v or {}).get("state") or "")
        if kind == "login_missing":
            missing_any.add(shift)
            said = _instant((v or {}).get("at"))
            if said is not None and (shift not in last_missing or said > last_missing[shift]):
                last_missing[shift] = said
        elif kind == "confirm":
            asks_any.add(shift)
            if state in _SPOKE:
                asked_spoke.add(shift)
            if state in _DELIVERED:
                asked[shift] = True
            if state in _ASK_STOPS:
                asks_blocked.add(shift)
            if state in _MUTED:
                asks_muted.add(shift)
        elif kind == "hm_no_show":
            hm_decided.add(shift)
            if (v or {}).get("rehearsal"):
                hm_rehearsal.add(shift)
            said = _instant((v or {}).get("at"))
            if said is not None and (latest_hm is None or said > latest_hm[0]):
                latest_hm = (said, state)
    hm_muted = (latest_hm is not None and latest_hm[1] in _MUTED
                and _mins(now, latest_hm[0]) <= MUTE_MEMORY_MIN)

    for r in rows:
        if r.get("row_kind", "shift") != "shift":
            continue
        at = _instant(r.get("shift_at"))
        if at is None:
            continue
        sid = str(r.get("id") or "")
        pk = str(r.get("person_key") or "")
        verdict = str(r.get("verdict") or "")
        told = bool(r.get("told_source"))
        unknown = r.get("known") is False
        on_clock = verdict in _ON_CLOCK
        at_iso = _utc_iso(at)
        shift = (pk, at_iso)
        age = _mins(now, at)
        end = _instant(r.get("shift_end")) or (at + timedelta(hours=CAP_H))
        word = str((answers.get(sid) or {}).get("word") or "")
        base = {"person": r.get("person") or "", "person_key": pk, "house": r.get("house") or "",
                "house_name": r.get("house_name") or "",
                "shift_code": r.get("shift_code") or "",
                "shift_at": at.astimezone(OHIO).isoformat(), "day": r.get("day") or "",
                "shift_id": sid}

        def owe(row: dict) -> None:
            (held if in_quiet else due).append(row)

        # ── the ask, and its repeats ───────────────────────────────────────
        first_at = at - timedelta(minutes=CONFIRM_FIRST_MIN)
        lead = (ASK_LEAD_MIN if not quiet(first_at)
                and quiet(first_at + timedelta(minutes=CONFIRM_EVERY_MIN)) else 0.0)
        if (CONFIRM_FLOW and not told and not unknown and not on_clock and not word
                and shift not in asks_blocked
                and -CONFIRM_FIRST_MIN - lead <= age < CONFIRM_DEADLINE_MIN):
            k = max(0, int((age + CONFIRM_FIRST_MIN) // CONFIRM_EVERY_MIN))
            key = occasion_key("confirm", pk, at_iso, f"a{k}")
            if key not in ledger:
                owe(dict(base, id=key, kind="confirm_again" if shift in asks_any else "confirm_ask",
                         occasion=f"a{k}", minutes=max(0, int(round(-age)))))

        # ── the reminder five minutes before — to a YES only ────────────────
        if (-BEFORE_MIN <= age < BEFORE_LATE_MIN and not told and not unknown and not on_clock
                and (not CONFIRM_FLOW or word == "yes")):
            key = occasion_key("login_before", pk, at_iso, "T-5")
            if key not in ledger:
                owe(dict(base, id=key, kind="login_before", occasion="T-5",
                         minutes=max(0, int(round(-age))), checked=mode == "psi"))

        # ── a NO, to the house manager at once ───────────────────────────── Bounded like the no-show, not by the…
        if (CONFIRM_FLOW and word == "no" and not told and not unknown and not on_clock
                and age <= CAP_H * 60):
            key = occasion_key("hm_confirm_no", pk, at_iso, "no")
            if key not in ledger:
                owe(dict(base, id=key, kind="hm_confirm_no", occasion="no", minutes=0))

        # ── no reply and no punch by T+30, to the house manager ──────────── After an 'other' reply only the clock…
        replied = word == "other"
        if (CONFIRM_FLOW and word in ("", "other") and not told and not unknown and not on_clock
                and verdict != "not_entered_yet"
                and age >= CONFIRM_DEADLINE_MIN and age <= CAP_H * 60
                and shift not in hm_decided):
            key = occasion_key("hm_no_show", pk, at_iso, "T+30")
            was_asked = bool(asked.get(shift))
            rehearsal_only = shift in asked_spoke and not was_asked
            row = dict(base, id=key, kind="hm_no_show", occasion="T+30", asked=was_asked,
                       replied=replied, minutes=int(age))
            checked = _instant(r.get("checked_at"))
            backed = (verdict in _MISSING and checked is not None
                      and _mins(checked, at) >= CONFIRM_DEADLINE_MIN
                      and _mins(now, checked) <= CHECK_FRESH_MIN and not quiet(checked))
            if mode == "psi" and backed:
                owe(dict(row, checked=True))
            elif (not replied and (was_asked or rehearsal_only) and now <= end
                  and (mode != "psi" or age >= CONFIRM_DEADLINE_MIN + HM_CHECK_WAIT_MIN)):
                # Unchecked: never of somebody unasked, never once the shift is over.
                owe(dict(row, checked=False, rehearsal_only=rehearsal_only))
            elif (mode == "psi" and shift not in asks_muted and not hm_muted
                  and (not replied or age < CONFIRM_DEADLINE_MIN + HM_CHECK_WAIT_MIN)):
                awaiting.append({"id": sid, "shift_at": base["shift_at"], "person": base["person"]})

        # ── the "not logged in", every half hour, until the cap ───────────
        until = owed_until(r)
        said = last_missing.get(shift)
        spaced = said is None or _mins(now, said) >= SPACING_MIN
        eligible = not CONFIRM_FLOW or word in ("yes", "late") or shift in hm_decided
        # What follows a rehearsal stays in the rehearsal book.
        follows_rehearsal = (CONFIRM_FLOW and word not in ("yes", "late")
                             and shift in hm_rehearsal)
        if (eligible and 0 < age and until is not None and now <= until and not told
                and not unknown and not on_clock and sid not in stopped and spaced):
            row = None
            if mode == "psi" and verdict in _MISSING:
                checked = _instant(r.get("checked_at"))
                # The backing check must be fresh, past the late line, and outside the quiet window.
                if checked is not None and _mins(now, checked) <= CHECK_FRESH_MIN \
                        and _mins(checked, at) >= MISSING_AFTER_MIN and not quiet(checked):
                    slot = int(_mins(checked, at) // EVERY_MIN)
                    row = dict(base, kind="login_missing", occasion=f"k{slot}",
                               minutes=int(_mins(checked, at)), checked=True)
            elif mode == "calendar" and CALENDAR_FOLLOW_UPS and age >= EVERY_MIN:
                slot = int(age // EVERY_MIN)
                row = dict(base, kind="login_missing", occasion=f"k{slot}",
                           minutes=int(age), checked=False)
                if follows_rehearsal:
                    row["rehearsal_only"] = True
            if row is not None:
                key = occasion_key("login_missing", pk, at_iso, row["occasion"])
                if key not in ledger:
                    row["id"] = key
                    # ONE MESSAGE AND ONE E-MAIL PER SHIFT: the e-mail rides the first ask about this shift and…
                    row["mail"] = row.get("checked") is True and shift not in missing_any
                    owe(row)

        # ── the early clock-in, to the house manager ───────────────────────
        early = r.get("early_minutes")
        if mode == "psi" and early and age <= CAP_H * 60 and verdict in _ON_CLOCK | {"upcoming"}:
            key = occasion_key("early_in", pk, at_iso, "early")
            if key not in ledger:
                owe(dict(base, id=key, kind="early_in", occasion="early",
                         minutes=int(early), arrived=r.get("arrived") or "", checked=True))

        # ── they called to say they would be late, to the house manager ──── Keyed on the day, so a double is one…
        late_reply = CONFIRM_FLOW and word == "late"
        if (r.get("late_call") or late_reply) and not unknown and not on_clock and now <= end:
            if late_reply:
                learned = _instant((answers.get(sid) or {}).get("at"))
                source = "a reply to the ask"
            else:
                told_at = str(r.get("told_at") or "")
                learned = _instant(told_at) if "T" in told_at else _instant(r.get("late_seen_at"))
                source = r.get("told_source") or ""
            key = occasion_key("late_call", pk, str(r.get("day") or at_iso[:10]), "late")
            if (learned is not None and _mins(learned, at) <= LATE_CALL_AFTER_MIN
                    and key not in ledger and not any(d["id"] == key for d in due + held)):
                owe(dict(base, id=key, kind="late_call", occasion="late", minutes=0,
                         told_source=source))

    if NOTE_FLOW and notes is not None and keep is not None:
        n_due, n_held = plan_notes(keep, notes, now=now, ledger=ledger, stopped=stopped,
                                   answers=answers)
        due.extend(n_due)
        held.extend(n_held)
    return {"due": due, "held": held, "awaiting": awaiting, "quiet": in_quiet}


# ── rule 8 (pure) ──────────────────────────────────────────────────────────

def note_slots(shift_at: datetime, shift_end: datetime) -> list[datetime]:
    """Candidate note-reminder moments before the quiet window moves any of them."""
    out = [shift_end - timedelta(minutes=m) for m in NOTE_BEFORE_MIN]
    out = [t for t in out if t >= shift_at]
    first = shift_end + timedelta(minutes=NOTE_AFTER_MIN)
    out.append(first)
    last = shift_end + timedelta(hours=NOTE_WINDOW_H)
    local = first.astimezone(OHIO)
    day = local.date()
    while True:
        for h in range(NOTE_DAY_FROM_H, NOTE_DAY_TO_H + 1, max(1, NOTE_EVERY_H)):
            t = datetime(day.year, day.month, day.day, h, 0, tzinfo=OHIO).astimezone(UTC)
            if first < t <= last:
                out.append(t)
        if datetime(day.year, day.month, day.day, tzinfo=OHIO).astimezone(UTC) > last:
            break
        day += timedelta(days=1)
    return sorted(out)


def _name_words(name: Any) -> list[str]:
    folded = unicodedata.normalize("NFKD", str(name or ""))
    folded = "".join(c for c in folded if not unicodedata.combining(c)).lower()
    return re.findall(r"[a-z]+", folded)


def same_person(roster_name: Any, note_name: Any) -> bool:
    """Is a spoken notes-book name this roster person? Errs toward yes, which only silences a reminder."""
    a, b = _name_words(roster_name), _name_words(note_name)
    if not a or not b:
        return False
    if "".join(a) == "".join(b) or sorted(a) == sorted(b):
        return True
    if len(a) > 1 and len(b) > 1 and a[-1] == b[-1] and a[0][:1] == b[0][:1]:
        return True
    if len(b) == 1 and len(b[0]) >= 3 and b[0] == a[0]:
        return True
    from difflib import SequenceMatcher  # noqa: PLC0415
    return SequenceMatcher(None, "".join(a), "".join(b)).ratio() >= NOTE_NAME_FUZZ


def _note_written(shift: dict, by_key: dict[str, list], names: dict[str, list] | None = None) -> bool:
    at = _instant(shift.get("shift_at"))
    if at is None:
        return False
    for k in shift.get("keys") or [shift.get("person_key")]:
        for raw in by_key.get(str(k or ""), ()):
            when = _instant(raw)
            if when is not None and when >= at:
                return True
    for spoken, whens in (names or {}).items():
        after = [w for w in (_instant(raw) for raw in whens) if w is not None and w >= at]
        if after and same_person(shift.get("person"), spoken):
            return True
    return False


def notes_quiet_why(notes: dict[str, Any] | None, now: datetime) -> str:
    """Why rule 8 holds although the book reads (stale beyond NOTE_BOOK_FRESH_DAYS), or ''."""
    if NOTE_BOOK_FRESH_DAYS <= 0 or not notes or not notes.get("ok"):
        return ""
    newest = None
    for whens in list((notes.get("by_key") or {}).values()) + list((notes.get("names") or {}).values()):
        for raw in whens:
            w = _instant(raw)
            if w is not None and (newest is None or w > newest):
                newest = w
    if newest is not None and now - newest <= timedelta(days=NOTE_BOOK_FRESH_DAYS):
        return ""
    return (f"the Daily Notes book holds no note from anybody in the last {NOTE_BOOK_FRESH_DAYS:g} "
            f"day(s) — rule 8 waits until the channel is in use (HUB_NOTE_BOOK_FRESH_DAYS)")


_TOLD_SAID: set[str] = set()


def _told_worked(s: dict[str, Any]) -> bool:
    """Does the human's report still mean the shift was worked? (psi_attendance.WORKED_TOLD)"""
    kind = str(s.get("told_kind") or "")
    if not kind:
        return False
    try:
        from psi_attendance import WORKED_TOLD  # noqa: PLC0415 — the one list of worked reports
    except Exception as exc:  # noqa: BLE001 — said once; a report nobody can place owes no text
        if "import" not in _TOLD_SAID:
            _TOLD_SAID.add("import")
            log.warning("psi reminders: the worked-report kinds could not be read (%s) — a reported "
                        "shift is treated as not worked", type(exc).__name__)
        return False
    return kind in WORKED_TOLD


def plan_notes(keep: dict[str, Any], notes: dict[str, Any], *, now: datetime,
               ledger: dict[str, Any], stopped: dict[str, Any],
               answers: dict[str, Any]) -> tuple[list[dict], list[dict]]:
    """Rule 8 reminders owed now, one per person per slot; an unreadable notes book owes nothing."""
    if not notes or not notes.get("ok") or notes_quiet_why(notes, now):
        return [], []
    by_key = notes.get("by_key") or {}
    names = notes.get("names") or {}
    in_quiet = quiet(now)
    today = now.astimezone(OHIO).date()
    spent: dict[str, int] = {}
    last_to: dict[str, datetime] = {}
    last_cover: dict[str, datetime] = {}
    today_to: dict[str, int] = {}
    no_show: set[str] = set()
    for key, v in ledger.items():
        got = _shift_of_key(key)
        if got is None:
            continue
        v = v or {}
        if got[0] == "note_due" and str(v.get("state") or "") in _SPOKE:
            said = _instant(v.get("at"))
            for sid in v.get("covers") or [v.get("shift_id")]:
                if sid:
                    spent[str(sid)] = spent.get(str(sid), 0) + 1
                    if said is not None and (sid not in last_cover or said > last_cover[sid]):
                        last_cover[str(sid)] = said
            if said is not None and (got[1] not in last_to or said > last_to[got[1]]):
                last_to[got[1]] = said
            if said is not None and said.astimezone(OHIO).date() == today:
                today_to[got[1]] = today_to.get(got[1], 0) + 1
        elif (got[0] == "hm_no_show" and v.get("shift_id") and v.get("checked") is True
              and str(v.get("state") or "") in _DELIVERED):
            no_show.add(str(v.get("shift_id")))

    by_person: dict[str, list[tuple[datetime, str, dict]]] = {}
    for sid, s in keep.items():
        at, end = _instant(s.get("shift_at")), _instant(s.get("shift_end"))
        if at is None or end is None or now > end + timedelta(hours=NOTE_WINDOW_H):
            continue
        # A human's report skips the note only when it says the shift was not worked: a late show or a sent home is…
        if (s.get("told") and not _told_worked(s)) or s.get("known") is False:
            continue
        if str((answers.get(sid) or {}).get("word") or "") == "no":
            continue
        # Only a clock-backed no-show skips the note; an entry not typed yet proves nothing.
        if not s.get("worked") and sid in no_show:
            continue
        if f"notes|{sid}" in stopped or spent.get(sid, 0) >= NOTE_CAP:
            continue
        if _note_written(s, by_key, names):
            continue
        pk = str(s.get("person_key") or "")
        served = last_cover.get(sid)
        for t in note_slots(at, end):
            t = quiet_ends(t)
            # A merge is remembered by its message, never recomputed, so a served slot never splits back out.
            if served is not None and served >= t - timedelta(minutes=NOTE_MERGE_MIN):
                continue
            by_person.setdefault(pk, []).append((t, sid, s))

    due: list[dict] = []
    held: list[dict] = []
    for pk, slots in by_person.items():
        slots.sort(key=lambda x: (x[0], x[1]))
        clusters: list[list[tuple[datetime, str, dict]]] = []
        for item in slots:
            if clusters and _mins(item[0], clusters[-1][0][0]) <= NOTE_MERGE_MIN:
                clusters[-1].append(item)
            else:
                clusters.append([item])
        for i, cl in enumerate(clusters):
            start = cl[0][0]
            ends = start + timedelta(minutes=NOTE_LATE_MIN)
            if i + 1 < len(clusters):
                ends = min(ends, clusters[i + 1][0][0])
            if not (start <= now < ends):
                continue
            key = occasion_key("note_due", pk, _utc_iso(start), "n")
            if key in ledger:
                continue
            said = last_to.get(pk)
            if said is not None and _mins(now, said) < NOTE_MERGE_MIN:
                continue
            if NOTE_PERSON_DAY_CAP > 0 and today_to.get(pk, 0) >= NOTE_PERSON_DAY_CAP:
                continue
            covered: dict[str, dict] = {}
            for _t, sid, s in cl:
                covered.setdefault(sid, s)
            ordered = sorted(covered.items(), key=lambda kv: str(kv[1].get("shift_at") or ""))
            first_sid, first = ordered[0]
            first_at = _instant(first.get("shift_at"))
            row = {"id": key, "kind": "note_due", "occasion": "n",
                   "person": first.get("person") or "", "person_key": pk,
                   "house": first.get("house") or "", "house_name": first.get("house_name") or "",
                   "shift_code": first.get("shift_code") or "",
                   "shift_at": first_at.astimezone(OHIO).isoformat() if first_at else "",
                   "day": first.get("day") or "", "shift_id": first_sid, "minutes": 0,
                   "covers": [sid for sid, _s in ordered],
                   "shifts": [{"shift_at": s.get("shift_at") or "", "day": s.get("day") or "",
                               "house": s.get("house") or "",
                               "house_name": s.get("house_name") or ""} for _sid, s in ordered]}
            (held if in_quiet else due).append(row)
    return due, held


# ── the replies (the relay's SMS inbox) ────────────────────────────────────

_INBOX_CACHE: dict[str, Any] = {}


def _inbox_lines(path: Path) -> list[str]:
    raw = path.read_bytes()
    if path.name.endswith(".gz"):
        raw = gzip.decompress(raw)
    return raw.decode("utf-8", errors="replace").splitlines()


def _to_digits(raw: Any) -> list[str]:
    items = raw if isinstance(raw, list) else [raw]
    return [re.sub(r"\D", "", str(x or ""))[-10:] for x in items if re.sub(r"\D", "", str(x or ""))]


def _reply_of(line: str) -> tuple[str, datetime, str] | None:
    """(phone key, when, word) for one inbound message, or None for anything else."""
    try:
        got = json.loads(line)
    except ValueError:
        return None
    if not isinstance(got, dict):
        return None
    # a line the staff-answers rehearsal wrote is nobody's reply to the shift flow
    if str(got.get("source") or "") == "rehearsal":
        return None
    event = got.get("event") if isinstance(got.get("event"), dict) else {}
    kind = str(got.get("type") or event.get("type") or "")
    obj = ((event.get("data") or {}) if isinstance(event.get("data"), dict) else {}).get("object")
    if not isinstance(obj, dict):
        return None
    direction = str(obj.get("direction") or "").lower()
    if kind != "message.received" and direction not in ("incoming", "inbound"):
        return None
    if direction and direction not in ("incoming", "inbound"):
        return None
    to = _to_digits(obj.get("to"))
    if REPLY_LINES and to and not (set(to) & REPLY_LINES):
        return None
    key = phone_key(obj.get("from"))
    when = _instant(obj.get("createdAt") or got.get("received_at"))
    if not key or when is None:
        return None
    text = obj.get("text") or obj.get("body") or obj.get("content") or ""
    if ELSEWHERE_RE.search(str(text).upper()):
        return None
    # Only the word is kept, never the text.
    return key, when, reply_word(text)


def inbound(inbox: Path | None = None, now: datetime | None = None
            ) -> dict[str, list[tuple[datetime, str]]]:
    """phone key → [(when, word)] over the lookback, oldest first; files re-read only when size or mtime moved."""
    inbox = inbox or INBOX_DIR
    now = now or datetime.now(UTC)
    floor = now - timedelta(hours=INBOX_LOOKBACK_H)
    out: dict[str, list[tuple[datetime, str]]] = {}
    try:
        paths = sorted(list(inbox.glob("*.jsonl")) + list(inbox.glob("*.jsonl.gz")))
    except OSError:
        return out
    for p in paths:
        try:
            st = p.stat()
        except OSError:
            continue
        if datetime.fromtimestamp(st.st_mtime, UTC) < floor:
            continue
        stamp = (st.st_mtime_ns, st.st_size)
        cached = _INBOX_CACHE.get(str(p))
        if cached and cached[0] == stamp:
            found = cached[1]
        else:
            found = []
            try:
                for line in _inbox_lines(p):
                    got = _reply_of(line)
                    if got:
                        found.append(got)
            except (OSError, EOFError, ValueError) as exc:
                log.info("psi reminders: %s could not be read (%s) — no reply taken from it",
                         p.name, type(exc).__name__)
                found = []
            _INBOX_CACHE[str(p)] = (stamp, found)
        for key, when, word in found:
            if when >= floor:
                out.setdefault(key, []).append((when, word))
    for key in out:
        out[key].sort(key=lambda x: x[0])
    return out


def replies(inbox: Path | None = None, now: datetime | None = None) -> dict[str, datetime]:
    """phone key → the newest inbound message from it, over the lookback."""
    return {k: v[-1][0] for k, v in inbound(inbox, now).items() if v}


# set by the relay to shift_handoff.claimed_replies: replies a newer swap ask owns; None claims nothing
CLAIMED_ELSEWHERE: Callable[[list[tuple[str, datetime, datetime | None]]],
                            set[tuple[str, datetime]]] | None = None


def _unclaimed(heard: dict[str, list[tuple[datetime, str]]]
               ) -> dict[str, list[tuple[datetime, str]]]:
    """`heard` less the replies another question claims; unreadable claims remove nothing (and are logged)."""
    ask = CLAIMED_ELSEWHERE
    if ask is None or not heard:
        return heard
    # Only a swap ask newer than this flow's ask may claim a reply.
    pairs = []
    for k, v in heard.items():
        for when, word in v:
            if word in ("yes", "no"):
                mine = _open_ask_locked(k, when)
                pairs.append((k, when, mine[0] if mine else None))
    if not pairs:
        return heard
    try:
        taken = ask(pairs)
    except Exception as exc:  # noqa: BLE001 — said, and every reply read as before
        log.warning("psi reminders: which replies answer a swap could not be read (%s) — every "
                    "reply is read as the shift's own this pass", type(exc).__name__)
        return heard
    if not taken:
        return heard
    return {k: [(when, word) for when, word in v if (k, when) not in taken]
            for k, v in heard.items()}


class LedgerUnreadable(RuntimeError):
    """The flow's ledger could not be read — which is not "nobody was asked"."""


def _open_ask_locked(key: str, at: datetime) -> tuple[datetime, dict, dict] | None:
    """(reached_at, shift, row) of the newest delivered ask to this phone before `at`; caller holds _LOCK."""
    people = {pk for pk, v in (_R.get("phones") or {}).items()
              if str((v or {}).get("key") or "") == key}
    if not people:
        return None
    best: tuple[datetime, dict, dict] | None = None
    for lkey, v in (_R.get("ledger") or {}).items():
        v = v or {}
        if v.get("kind") not in ASK_KINDS or str(v.get("state") or "") not in _DELIVERED:
            continue
        parts = str(lkey).split("|")
        if len(parts) < 2 or parts[1] not in people:
            continue
        asked = _instant(v.get("at"))
        if asked is None or asked > at:
            continue
        s = (_R.get("shifts") or {}).get(str(v.get("shift_id") or "")) or {}
        end = _instant(s.get("shift_end")) or (asked + timedelta(hours=CAP_H))
        if at >= end:
            continue
        if best is None or asked > best[0]:
            best = (asked, s, v)
    return best


def ask_open_for(phone: Any, at: datetime) -> dict[str, Any] | None:
    """The shift awaiting this phone's answer (for sms_ears.py); raises LedgerUnreadable if the ledger cannot be read."""
    key = phone_key(phone)
    if not key:
        return None
    with _LOCK:
        if not _load():
            raise LedgerUnreadable("the shift flow's ledger could not be read")
        best = _open_ask_locked(key, at)
        if best is None:
            return None
        asked, s, v = best
        return {"shift_id": str(v.get("shift_id") or ""), "person": s.get("person") or "",
                "house": s.get("house") or "", "house_name": s.get("house_name") or "",
                "shift_at": s.get("shift_at") or "", "shift_code": s.get("shift_code") or "",
                "asked_at": _utc_iso(asked)}


# ── the ledger, on disk ────────────────────────────────────────────────────

_LOCK = threading.Lock()
_R: dict[str, Any] = {}


def _load() -> dict[str, Any]:
    if _R:
        return _R
    try:
        got = json.loads(STATE_FILE.read_text(encoding="utf-8") or "{}")
    except FileNotFoundError:
        got = {}
    except (OSError, ValueError) as exc:
        # Unreadable is not empty: an empty ledger would resend the whole day.
        log.warning("psi reminders: the ledger could not be read (%s) — nothing is sent "
                    "until it can be", type(exc).__name__)
        return {}
    if not isinstance(got, dict):
        got = {}
    _R.update({"ledger": dict(got.get("ledger") or {}),
               "phones": dict(got.get("phones") or {}),
               "stopped": dict(got.get("stopped") or {}),
               "answers": dict(got.get("answers") or {}),
               # The board holds only two days; rule 8 needs shifts until their note window ends.
               "shifts": dict(got.get("shifts") or {}),
               "post_after": float(got.get("post_after") or 0.0),
               "due": [], "held": 0, "awaiting": [], "quiet": False, "mode": "", "at": "",
               "notes_why": ""})
    return _R


def _save() -> None:
    body = {k: _R.get(k) for k in ("ledger", "phones", "stopped", "answers", "shifts", "post_after")}
    tmp = STATE_FILE.with_name(STATE_FILE.name + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(body, fh, default=str)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, STATE_FILE)
    except OSError as exc:
        log.warning("psi reminders: the ledger could not be written (%s: %s)",
                    type(exc).__name__, exc)


def _prune(now: datetime) -> None:
    cut = _utc_iso(now - timedelta(days=LEDGER_KEEP_DAYS))
    _R["ledger"] = {k: v for k, v in _R["ledger"].items()
                    if str((v or {}).get("at") or "") >= cut}
    _R["stopped"] = {k: v for k, v in _R["stopped"].items()
                     if str((v or {}).get("at") or "") >= cut}
    _R["answers"] = {k: v for k, v in _R["answers"].items()
                     if str((v or {}).get("at") or "") >= cut}
    gone = now - timedelta(hours=NOTE_WINDOW_H + 1)
    keep = {}
    for sid, s in _R["shifts"].items():
        end = _instant((s or {}).get("shift_end"))
        if end is not None and end >= gone:
            keep[sid] = s
    _R["shifts"] = keep


def _first_spoken(shift_id: str, kinds: set[str], states: set[str]) -> datetime | None:
    """When the first message of these kinds about this shift got one of these states."""
    best = None
    for v in _R["ledger"].values():
        v = v or {}
        if v.get("shift_id") != shift_id or v.get("kind") not in kinds or v.get("state") not in states:
            continue
        at = _instant(v.get("at"))
        if at is not None and (best is None or at < best):
            best = at
    return best


def _person_keys(name: Any) -> list[str]:
    """Notes-book keys, using the attendance lane's own fold so the two never disagree."""
    try:
        from psi_attendance import person_keys  # noqa: PLC0415
        return sorted(person_keys(name))
    except Exception:  # noqa: BLE001 — the flat fold alone still finds the person
        flat = re.sub(r"[^a-z0-9]+", "", str(name or "").strip().lower())
        return [flat] if flat else []


def _remember(rows: list[dict], now: datetime) -> int:
    """Remembers every board shift until its note window ends; returns how many changed."""
    moved = 0
    for r in rows:
        if r.get("row_kind", "shift") != "shift" or not r.get("id") or not r.get("shift_end"):
            continue
        sid = str(r["id"])
        was = _R["shifts"].get(sid) or {}
        s = dict(was)
        verdict = str(r.get("verdict") or "")
        s.update(person=r.get("person") or "", person_key=r.get("person_key") or "",
                 keys=s.get("keys") or _person_keys(r.get("person")),
                 house=r.get("house") or "", house_name=r.get("house_name") or "",
                 shift_code=r.get("shift_code") or "", shift_at=r.get("shift_at") or "",
                 shift_end=r.get("shift_end") or "", day=r.get("day") or "",
                 known=r.get("known"), told=bool(r.get("told_source")),
                 told_kind=str(r.get("told_kind") or ""), verdict=verdict,
                 worked=bool(s.get("worked")) or verdict in _ON_CLOCK)
        # First beat a late call was seen, for books that keep only the day.
        if r.get("late_call") and not s.get("late_seen"):
            s["late_seen"] = _utc_iso(now)
        if s != was:
            _R["shifts"][sid] = s
            moved += 1
    return moved


def _hear(rows: list[dict], heard: dict[str, list[tuple[datetime, str]]], now: datetime) -> int:
    """Reads replies into each shift's answer and ended follow-ups; returns how much changed."""
    moved = 0
    by_person: dict[str, list[dict]] = {}
    for r in rows:
        if r.get("row_kind", "shift") == "shift" and r.get("id") and r.get("person_key"):
            by_person.setdefault(str(r["person_key"]), []).append(r)
    for pk, shifts in by_person.items():
        phone = str((_R["phones"].get(pk) or {}).get("key") or "")
        msgs = heard.get(phone) if phone else None
        if not msgs:
            continue
        shifts.sort(key=lambda r: str(r.get("shift_at") or ""))
        asks = [_first_spoken(str(r["id"]), ASK_KINDS, _DELIVERED) for r in shifts]
        for i, r in enumerate(shifts):
            sid = str(r["id"])
            first = asks[i]
            if first is not None:
                end = _instant(r.get("shift_end")) or (first + timedelta(hours=CAP_H))
                nxt = next((a for a in asks[i + 1:] if a is not None), None)
                until = min(end, nxt) if nxt is not None else end
                got = [(w, word) for w, word in msgs if first <= w < until]
                if got:
                    w, word = got[-1]
                    if (_R["answers"].get(sid) or {}).get("at") != _utc_iso(w):
                        _R["answers"][sid] = {"word": word, "at": _utc_iso(w)}
                        moved += 1
                        log.info("psi reminders: %s answered the ask for the %s shift — %s",
                                 r.get("person") or "?", str(r.get("shift_at") or "")[:16], word)
            login = _first_spoken(sid, LOGIN_KINDS, _SPOKE)
            if login is not None and sid not in _R["stopped"] and any(w >= login for w, _x in msgs):
                _R["stopped"][sid] = {"why": "replied", "at": _utc_iso(now)}
                moved += 1
    return moved


def refresh(rows: list[dict], mode: str, now: datetime, inbox: Path | None = None,
            notes: dict[str, Any] | None = None) -> dict:
    """Re-plan from the board as it stands; `notes` None leaves rule 8 out of this pass."""
    with _LOCK:
        if not _load():
            return {"due": 0, "why": "the ledger is unreadable"}
        _prune(now)
        learned = _remember(rows, now)
        heard = _unclaimed(inbound(inbox, now)) if _R["phones"] else {}
        moved = _hear(rows, heard, now)
        answered = {k: v for k, v in _R["ledger"].items() if (v or {}).get("state") != "failed"}
        seen = [dict(r, late_seen_at=(_R["shifts"].get(str(r.get("id") or "")) or {}).get("late_seen", ""))
                if r.get("late_call") else r for r in rows]
        got = plan(seen, mode=mode, now=now, ledger=answered, stopped=_R["stopped"],
                   answers=_R["answers"], notes=notes, keep=_R["shifts"])
        _R.update(due=got["due"], held=len(got["held"]), awaiting=got["awaiting"],
                  quiet=got["quiet"], mode=mode, at=_utc_iso(now),
                  notes_why=("" if notes is None
                             else notes_quiet_why(notes, now) if notes.get("ok")
                             else str(notes.get("why") or "the Daily Notes could not be read")))
        if moved or learned:
            _save()
        if moved:
            log.info("psi reminders: %s answer(s) or stop(s) heard in the inbox", moved)
        return {"due": len(got["due"]), "held": len(got["held"]), "heard": moved,
                "awaiting": len(got["awaiting"])}


def delivered_count(shift_id: str, kinds: Iterable[str] = ("login_missing",)) -> int:
    """How many messages of these kinds REACHED the person about one shift."""
    want = {str(k) for k in kinds}
    with _LOCK:
        if not _load():
            raise LedgerUnreadable("the reminders' ledger could not be read")
        return sum(1 for v in _R["ledger"].values()
                   if isinstance(v, dict) and str(v.get("shift_id") or "") == str(shift_id)
                   and str(v.get("kind") or "") in want
                   and str(v.get("state") or "") in _DELIVERED)


def stopped_why() -> dict[str, dict[str, Any]]:
    """Shift id → {why, at, code}: WHY no "not logged in" goes about it any more."""
    with _LOCK:
        if not _load():
            raise LedgerUnreadable("the reminders' ledger could not be read")
        out = {k: dict(v) for k, v in _R["stopped"].items() if isinstance(v, dict)}
        if CONFIRM_FLOW:
            for sid, a in _R["answers"].items():
                if str((a or {}).get("word") or "") == "no":
                    out.setdefault(str(sid), {"why": "answered_no", "at": ""})
            for k, v in _R["ledger"].items():
                if isinstance(v, dict) and v.get("shift_id") and v.get("state") == "dial_off" \
                        and str(k).startswith("confirm|"):
                    out.setdefault(str(v["shift_id"]), {"why": "dial_off", "at": ""})
        return out


def stopped_shifts() -> set[str]:
    """Shifts no "not logged in" will be sent about any more; an 'other' reply does not stop them."""
    with _LOCK:
        if not _load():
            return set()
        out = set(_R["stopped"])
        if CONFIRM_FLOW:
            out |= {sid for sid, a in _R["answers"].items()
                    if str((a or {}).get("word") or "") == "no"}
            out |= {str(v.get("shift_id")) for k, v in _R["ledger"].items()
                    if isinstance(v, dict) and v.get("shift_id") and v.get("state") == "dial_off"
                    and str(k).startswith("confirm|")}
        return out


def awaiting() -> set[str]:
    """Shifts whose "did not go" waits for a post-deadline clock read."""
    with _LOCK:
        if not _load():
            return set()
        return {str(a.get("id")) for a in (_R.get("awaiting") or []) if a.get("id")}


def marks() -> dict[str, dict[str, Any]]:
    """Per-shift reply word and manager notices for the punch board; rehearsal rows never count as told."""
    with _LOCK:
        if not _load():
            return {}
        out: dict[str, dict[str, Any]] = {}
        for sid, a in _R["answers"].items():
            out.setdefault(sid, {})["confirm"] = str((a or {}).get("word") or "")
        for key, v in _R["ledger"].items():
            got = _shift_of_key(key)
            v = v or {}
            if got is None or not v.get("shift_id") or str(v.get("state") or "") not in _DELIVERED:
                continue
            if got[0] == "hm_no_show":
                out.setdefault(str(v["shift_id"]), {})["hm_no_show_at"] = str(v.get("at") or "")
            elif got[0] == "late_call":
                out.setdefault(str(v["shift_id"]), {})["late_call_at"] = str(v.get("at") or "")
        return out


def pending(now_ts: float) -> dict | None:
    """At most MAX_PER_POST owed rows by _URGENCY, each remembering when it was offered."""
    with _LOCK:
        if not _load() or not _R["due"] or now_ts < float(_R["post_after"] or 0.0):
            return None
        if quiet(datetime.fromtimestamp(now_ts, UTC)):
            return None
        owed = [r for r in _R["due"] if r["id"] not in _R["ledger"]
                or (_R["ledger"][r["id"]] or {}).get("state") == "failed"]
        owed.sort(key=lambda r: (_URGENCY.get(str(r.get("kind") or ""), 9), str(r.get("shift_at") or "")))
        offer = owed[:MAX_PER_POST]
        if not offer:
            return None
        offered = _R.setdefault("offered", {})
        for r in offer:
            offered[r["id"]] = now_ts
        clean = [{k: v for k, v in r.items() if k not in ("shift_id", "occasion", "covers")}
                 for r in offer]
        return {"rows": clean, "ids": [r["id"] for r in offer]}


def posted(ids: list[str], said: dict, now_ts: float) -> dict[str, int]:
    """Records the door's answers, stamped with the offer time (not the answer's) so an early reply still counts."""
    now = datetime.fromtimestamp(now_ts, UTC)
    stamp = _utc_iso(now)
    counts: dict[str, int] = {}
    with _LOCK:
        if not _load():
            return counts
        by_id = {r["id"]: r for r in _R["due"]}
        offered = _R.setdefault("offered", {})
        results = {str(x.get("id") or ""): x for x in (said.get("results") or [])
                   if isinstance(x, dict)}
        not_now = False
        retry_s = POST_RETRY_S
        for rid in ids:
            got = results.get(rid)
            when_offered = offered.pop(rid, None)
            if not got:
                continue
            state = str(got.get("state") or "failed")
            if state in _NOT_NOW:
                not_now = True
                if state == "dial_unknown":
                    retry_s = min(retry_s, DIAL_RETRY_S)
                counts[state] = counts.get(state, 0) + 1
                continue
            row = by_id.get(rid) or {}
            held = _R["ledger"].get(rid) or {}
            tries = int(held.get("tries") or 0) + 1
            if state not in _DONE and tries < FAILED_OFFERS:
                state_kept = "failed"
            else:
                state_kept = state if state in _DONE else "gave_up"
            at_iso = (_utc_iso(datetime.fromtimestamp(min(float(when_offered), now_ts), UTC))
                      if when_offered is not None else stamp)
            kept = {"state": state_kept, "at": at_iso, "kind": row.get("kind", ""),
                    "shift_id": row.get("shift_id", ""), "tries": tries}
            if row.get("covers"):
                kept["covers"] = list(row["covers"])
            if row.get("kind") == "hm_no_show":
                kept.update(checked=bool(row.get("checked")), asked=bool(row.get("asked")),
                            rehearsal=bool(row.get("rehearsal_only")))
            _R["ledger"][rid] = kept
            counts[state_kept] = counts.get(state_kept, 0) + 1
            pk = str(row.get("person_key") or "")
            key = str(got.get("phone_key") or "")
            if key and pk and row.get("kind") not in HM_KINDS:
                _R["phones"][pk] = {"key": key, "at": stamp}
            if state in _STOPS and row.get("shift_id") and row.get("kind") == "login_missing":
                _R["stopped"][row["shift_id"]] = {"why": state, "at": stamp,
                                                  "code": str(got.get("code") or "")}
            if state in _STOPS and row.get("kind") == "note_due":
                for sid in row.get("covers") or [row.get("shift_id")]:
                    if sid:
                        _R["stopped"][f"notes|{sid}"] = {"why": state, "at": stamp}
        for rid in [k for k, v in offered.items() if now_ts - float(v or 0.0) > 3600]:
            offered.pop(rid, None)
        _R["post_after"] = now_ts + retry_s if not_now else 0.0
        _save()
    return counts


def post_failed(now_ts: float) -> None:
    with _LOCK:
        if not _load():
            return
        _R["post_after"] = now_ts + POST_RETRY_S
        _save()


def status() -> dict[str, Any]:
    """What the board's status line says about the flow."""
    with _LOCK:
        if not _load():
            return {"readable": False}
        states: dict[str, int] = {}
        for v in _R["ledger"].values():
            s = str((v or {}).get("state") or "")
            states[s] = states.get(s, 0) + 1
        words: dict[str, int] = {}
        for a in _R["answers"].values():
            w = str((a or {}).get("word") or "")
            words[w] = words.get(w, 0) + 1
        by_kind: dict[str, int] = {}
        for r in _R["due"]:
            by_kind[r.get("kind", "")] = by_kind.get(r.get("kind", ""), 0) + 1
        return {"readable": True, "due": len(_R["due"]), "held": int(_R["held"] or 0),
                "quiet": bool(_R["quiet"]), "mode": _R["mode"], "answered": states,
                "stopped": len(_R["stopped"]), "confirm": CONFIRM_FLOW, "answers": words,
                "due_by_kind": by_kind, "awaiting_check": len(_R.get("awaiting") or []),
                "notes": NOTE_FLOW, "notes_why": str(_R.get("notes_why") or ""),
                "remembered": len(_R["shifts"])}


def forget() -> None:
    """Drop the in-memory copy — the next call reads the file. Tests only."""
    with _LOCK:
        _R.clear()
        _INBOX_CACHE.clear()
