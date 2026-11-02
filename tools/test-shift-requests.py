#!/usr/bin/env python3
"""
THE OPEN-SHIFT RULES, asserted against the real functions, offline.

WHAT IT PROVES, rule by rule, on the code the relay runs and not on a copy:

  R1  an open shift's window is TEN MINUTES from the minute its day was
      published, to the second — 9:59 is open and 10:00 is not — and inside it
      only the house's own regulars may apply: a shift at that house 27 days
      ago is a regular, 29 days ago is not, and an R/O or an OFF cell never
      made anybody one
  R2  a call-off's window is FIVE HOURS, or sixty minutes before the shift
      starts, whichever comes first; under a quarter of an hour it is floored
      at fifteen minutes; and a shift starting inside that floor has no window
      at all — it goes straight to the house manager
  R4  overlap is refused on every path, including an overnight that runs into
      the next morning, and a shift that ENDS when another begins is a
      handover and not a clash
  R5  an OPEN row cannot be handed over; a shift somebody has applied for or
      is being handed collides with an application for the same hours
  R6  the swap keeps its two consents and its three roads
  R3  people APPLY inside the window and the house manager decides after it;
      two managers approving two applicants in the same second produce ONE
      person on the roster — held against the real claims ledger, in Postgres
  R10 no IST raises a training approval the moment somebody applies, and the
      house manager's approval releases the application in the place in the
      queue it always had
  R7  the whole company's list is the badge's: a staff member's copy carries
      their own rows and NOTHING ELSE — not hidden on the screen, not sent

HOW IT RUNS. The pure half needs nothing: it imports `server/shift_requests.py`
on the host with psycopg2 stubbed, and asserts arithmetic. The lane half needs
a database, so it ships the checkout's modules into the relay's container over
stdin (exactly as the hotline tests do) and runs there in a SCHEMA OF ITS OWN,
created and dropped inside the run — every table it writes is made there and
found there, while the read-only mirror it asks about the IST book and the
house managers is still reachable behind it. Nothing it does can reach a live
table, and a failure leaves no rows behind. No relay container, no lane half:
the pure half still runs and says which did not.

    python3 tools/test-shift-requests.py
"""
import ast
import base64
import json
import os
import subprocess
import sys
import time
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
SERVER = HERE.parent.parent / "server"
CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {detail}")


# ── the module, on the host, with nothing it cannot have here ───────────────
if "psycopg2" not in sys.modules:  # pragma: no cover - the host has no driver
    fake = types.ModuleType("psycopg2")
    fake.connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no database in this test"))
    fake.Error = Exception
    extras = types.ModuleType("psycopg2.extras")
    extras.RealDictCursor = object
    errors = types.ModuleType("psycopg2.errors")
    errors.UniqueViolation = type("UniqueViolation", (Exception,), {})
    fake.extras, fake.errors = extras, errors
    sys.modules["psycopg2"] = fake
    sys.modules["psycopg2.extras"] = extras
    sys.modules["psycopg2.errors"] = errors

sys.path.insert(0, str(SERVER))
os.environ.setdefault("HUB_SNAPSHOT_OUT", "/tmp")
import shift_requests as sr  # noqa: E402

OHIO = sr.OHIO


def at(iso: str) -> datetime:
    return datetime.fromisoformat(iso).replace(tzinfo=OHIO)


print("\nR1 — the open-shift window: ten minutes, and the house's own staff")

published = at("2026-09-22T09:00:00")
w = sr.window_for(sr.KIND_OPEN, opened_at=published, now=published + timedelta(minutes=9, seconds=59))
check("9:59 after the day was published, applications are still open",
      w["state"] == "open" and w["reserved"] is True and w["seconds_left"] == 1, w)
w10 = sr.window_for(sr.KIND_OPEN, opened_at=published, now=published + timedelta(minutes=10))
check("at 10:00 exactly they are closed and it is the house manager's",
      w10["state"] == "closed" and w10["seconds_left"] == 0, w10)
check("the window's end is the published minute plus the ten",
      w10["closes_at"] == (published + timedelta(minutes=10)).isoformat(), w10)
w_past = sr.window_for(sr.KIND_OPEN, opened_at=published,
                       shift_start=published + timedelta(minutes=4),
                       now=published + timedelta(minutes=5))
check("a window never outlives the shift it is about",
      w_past["state"] == "closed"
      and w_past["closes_at"] == (published + timedelta(minutes=4)).isoformat(), w_past)
check("a day published long ago opens nothing today",
      sr.window_for(sr.KIND_OPEN, opened_at=published - timedelta(days=400),
                    now=published)["state"] == "closed")

# the regulars, read off the house's own grid
today = at("2026-09-22T12:00:00").date()
view = {"worked": {(sr.fold("Ann Roe"), "H1"): {today - timedelta(days=27)},
                   (sr.fold("Ben Left"), "H1"): {today - timedelta(days=29)},
                   (sr.fold("Cy Far"), "H2"): {today}}}
check("a shift at that house 27 days ago makes a regular",
      sr.is_regular(view, "Ann Roe", "H1", today=today) is True)
check("29 days ago does not — the line is 28 days",
      sr.is_regular(view, "Ben Left", "H1", today=today) is False)
check("a regular of another house is not a regular here",
      sr.is_regular(view, "Cy Far", "H1", today=today) is False)
check("the name is folded, so 'ANN  ROE' is the same person",
      sr.is_regular(view, "ANN  ROE", "H1", today=today) is True)
view_short = {"worked": {(sr.fold("Ann Roe"), "H1"): {today - timedelta(days=2)}},
              "worked_since": {"H1": today - timedelta(days=5)}}
check("THE 28-DAY TEST NEEDS A 28-DAY RECORD: absent from a record that begins inside the window is "
      "'unknown', never 'not a regular' — and is not a yes either",
      sr.regular_state(view_short, "Ben Left", "H1", today=today) == {"state": "unknown", "covered": 6}
      and sr.regular_state(view_short, "Ann Roe", "H1", today=today)["state"] == "yes"
      and sr.is_regular(view_short, "Ben Left", "H1", today=today) is False)
check("…a record that covers the whole window answers no; a house with no record at all is unknown",
      sr.regular_state(dict(view_short, worked_since={"H1": today - timedelta(days=40)}), "Ben Left", "H1",
                       today=today)["state"] == "no"
      and sr.regular_state(view_short, "Ben Left", "H9", today=today) == {"state": "unknown", "covered": 0})
_now_day = datetime.now(sr.OHIO).date()
_short_now = {"worked": {}, "worked_since": {"CAN - JH - ABD2704": _now_day - timedelta(days=3)}}
_unknown = sr._verdict(kind=sr.KIND_OPEN, location="CAN - JH - ABD2704", open_row="OPEN",
                       col_iso=(_now_day + timedelta(days=1)).isoformat(), value="8A-4P",
                       window={"state": sr.WINDOW_OPEN}, person="Ben Left", held=[], view=_short_now,
                       ist={"readable": False, "why": "not read here", "by_person": {}})
check("…and inside the reserved window that answer refuses with its own code, saying how many days the "
      "calendar holds and that the house manager decides",
      _unknown["may"] is False and _unknown["code"] == "regular_unknown"
      and "holds only 4 day(s)" in _unknown["why"] and "house manager decides" in _unknown["why"], _unknown)

# the attendance panels: a manager's badge reads every house; an unread managers list is said
_board_rows = [{"row_kind": "shift", "house": h, "person": p, "day": "2026-09-22", "late_call": True,
                "shift_code": "8A-4P", "shift_at": "", "told_at": "", "told_source": "tracker"}
               for h, p in (("CAN - BM - BM4060", "Ann Roe"), ("CAN - JH - ABD2704", "Ben Left"))]
_held_board, _held_pool = sr._attendance_board, sr.pool
_held_ears = sys.modules.get("sms_ears")
sr._attendance_board = lambda: {"rows": _board_rows}
sr.pool = lambda dsn, now=None: []
sys.modules["sms_ears"] = types.SimpleNamespace(
    replies=lambda dsn, mine, everywhere, now: {"readable": True, "rows": [], "why": ""})
try:
    p_badge = sr.panels("dsn", who={"whole_company": True, "manages": [], "decides_everywhere": False,
                                    "managers_readable": True})
    p_hm = sr.panels("dsn", who={"whole_company": False, "manages": ["BM4060"], "decides_everywhere": False,
                                 "managers_readable": True})
    p_unread = sr.panels("dsn", who={"whole_company": False, "manages": [], "decides_everywhere": False,
                                     "managers_readable": False})
finally:
    sr._attendance_board, sr.pool = _held_board, _held_pool
    if _held_ears is None:
        sys.modules.pop("sms_ears", None)
    else:
        sys.modules["sms_ears"] = _held_ears
check("THE PANELS READ THE BADGE: an HM, MANAGER or TEAM LEAD badge (whole company) sees every house's late "
      "calls — not empty lists — while a house's ** manager sees their own",
      sorted(r["person"] for r in p_badge["late_calls"]) == ["Ann Roe", "Ben Left"]
      and [r["person"] for r in p_hm["late_calls"]] == ["Ann Roe"], (p_badge, p_hm))
check("…and when who manages which house could not be read, the panels say so instead of answering empty "
      "lists marked readable",
      p_unread["readable"] is False and "could not be read" in p_unread["why"]
      and p_unread["late_calls"] == [] and p_unread["replies_readable"] is False, p_unread)

# hours nobody can read
UD = "2026-10-01"
held_day = [{"location": "CAN - JH - ABD2704", "col_iso": UD, "value": "8A-4P", "span": sr.span_of(UD, "8A-4P"),
             "source": "roster"}]
check("a working cell with no readable hours is unreadable; empty, OFF and R/O hold no hours",
      sr.unreadable_hours("TRAINING") and sr.unreadable_hours("ADMIN")
      and not any(sr.unreadable_hours(v) for v in ("", "OFF", "R/O", "8A-4P", "10P-8A")))
c_unread = sr.clash_for(None, held_day, col_iso=UD, value="ADMIN")
check("a value being assigned whose hours cannot be read clashes with anything else that day — said as "
      "unreadable, with the cell's words",
      c_unread and c_unread["source"] == "unreadable" and c_unread["value"] == "ADMIN"
      and sr.clash_verdict("Ann Roe", c_unread)[0] == "unreadable_hours"
      and "cannot be read" in sr.clash_verdict("Ann Roe", c_unread)[1], c_unread)
check("…and passes a day that holds nothing else; OFF and a span-less call still collide with nothing",
      sr.clash_for(None, [], col_iso=UD, value="ADMIN") is None
      and sr.clash_for(None, held_day, col_iso=UD, value="OFF") is None
      and sr.clash_for(None, held_day) is None)
whole_hold = sr._drafted_hold("CAN - JH - ABD2704", "Ann Roe", UD, "TRAINING")
c_held = sr.clash_for(sr.span_of(UD, "7P-11P"), [whole_hold])
check("a held cell with unreadable hours covers its whole day, and a shift beside it is refused as unreadable",
      whole_hold["source"] == "unreadable" and whole_hold["span"] == sr.whole_day(UD)
      and c_held is whole_hold and sr.clash_verdict("Ann Roe", c_held)[0] == "unreadable_hours",
      (whole_hold, c_held))


print("\nR2 — the call-off window: five hours, the fence, and the floor")

called = at("2026-09-22T06:00:00")
far = sr.window_for(sr.KIND_CALLOFF, opened_at=called,
                    shift_start=at("2026-09-23T08:00:00"), now=called)
check("a shift tomorrow: the full five hours, and it is open to all staff",
      far["closes_at"] == (called + timedelta(hours=5)).isoformat()
      and far["reserved"] is False and far["state"] == "open", far)
near = sr.window_for(sr.KIND_CALLOFF, opened_at=called,
                     shift_start=at("2026-09-22T10:00:00"), now=called)
check("a shift four hours away closes sixty minutes before it starts",
      near["closes_at"] == at("2026-09-22T09:00:00").isoformat(), near)
three = sr.window_for(sr.KIND_CALLOFF, opened_at=called,
                      shift_start=at("2026-09-22T09:00:00"), now=called)
check("three hours away: still the fence, not the five hours",
      three["closes_at"] == at("2026-09-22T08:00:00").isoformat(), three)
tight = sr.window_for(sr.KIND_CALLOFF, opened_at=called,
                      shift_start=at("2026-09-22T07:00:00"), now=called)
check("under a quarter of an hour is floored at fifteen minutes, not left at zero",
      tight["state"] == "open"
      and tight["closes_at"] == (called + timedelta(minutes=15)).isoformat(), tight)
inside = sr.window_for(sr.KIND_CALLOFF, opened_at=called,
                       shift_start=called + timedelta(minutes=10), now=called)
check("a shift inside the floor has no window at all — the house manager assigns it",
      inside["state"] == "manager_only" and inside["seconds_left"] == 0
      and "no time to take applications" in inside["why"], inside)
check("and the sentence says why, so the screen never shows a dead button",
      "house manager" in inside["why"])
check("five hours on, a call-off window is closed",
      sr.window_for(sr.KIND_CALLOFF, opened_at=called,
                    now=called + timedelta(hours=5))["state"] == "closed")

# CALLING OFF TODAY FOR TOMORROW IS ROUTINE, and a book row that carries only a
# DAY has a midnight that has not happened yet. Dated to it the window would run
# from that midnight to five in the morning — thirty-nine hours where the rule
# says five, shut through the three hours before an eight o'clock start, and
# reported to the screen as "called off at" a time still to come.
now_ = at("2026-09-22T14:00:00")
for ahead, label in ((1, "tomorrow"), (2, "the day after")):
    day = (now_ + timedelta(days=ahead)).date()
    learned = sr._learned_at("", day, now_)
    w = sr.window_for(sr.KIND_CALLOFF, opened_at=learned,
                      shift_start=at(f"{day.isoformat()}T08:00:00"), now=now_)
    hours = (datetime.fromisoformat(w["closes_at"]) - learned).total_seconds() / 3600.0
    check(f"a call-off booked for {label} is learned NOW, never at that day's midnight",
          learned == now_, learned)
    check(f"so its window is five hours at most, not the wait until {label}",
          hours <= sr.CALLOFF_APPLY_H + 0.001, hours)
check("and a book row two days stale is still clamped the way it always was",
      sr._learned_at("", (now_ - timedelta(days=5)).date(), now_)
      == at("2026-09-19T00:00:00"), sr._learned_at("", (now_ - timedelta(days=5)).date(), now_))
check("a row that carries a real instant is used exactly as written",
      sr._learned_at("2026-09-22T06:30:00", now_.date(), now_) == at("2026-09-22T06:30:00"))


print("\nR4 — nobody ever holds two shifts at once")

day = "2026-09-22"
nxt = "2026-09-23"
check("the grammar's own hours become an interval",
      sr.span_of(day, "8A-4P") == (at("2026-09-22T08:00:00"), at("2026-09-22T16:00:00")),
      sr.span_of(day, "8A-4P"))
check("an overnight crosses midnight into the next morning",
      sr.span_of(day, "10P-8:30A") == (at("2026-09-22T22:00:00"), at("2026-09-23T08:30:00")),
      sr.span_of(day, "10P-8:30A"))
check("OFF and R/O are not intervals at all",
      sr.span_of(day, "OFF") is None and sr.span_of(day, "R/O") is None)
check("a cell whose hours cannot be read is not evidence of a second shift",
      sr.span_of(day, "ADMIN") is None and sr.span_of(day, "") is None)

held_day = [{"location": "CAN - 48TH (B) - ABD1711", "col_iso": day, "value": "8A-4P",
             "span": sr.span_of(day, "8A-4P"), "source": "roster"}]
check("the same hours at another house collide",
      sr.clash_for(sr.span_of(day, "10A-6P"), held_day) is not None)
check("a shift that starts exactly when the other ends is a handover, not a clash",
      sr.clash_for(sr.span_of(day, "4P-12A"), held_day) is None)
check("a shift that ends exactly when the other begins is a handover too",
      sr.clash_for(sr.span_of(day, "12A-8A"), held_day) is None)
held_night = [{"location": "CAN - JH - ABD2704", "col_iso": day, "value": "10P-8:30A",
               "span": sr.span_of(day, "10P-8:30A"), "source": "roster"}]
check("the next morning's 8A-4P DOES cross an overnight that runs to 8:30",
      sr.clash_for(sr.span_of(nxt, "8A-4P"), held_night) is not None)
check("8:30A on that morning is the handover the overnight hands to, not a clash",
      sr.clash_for(sr.span_of(nxt, "830A-430P"), held_night) is None,
      sr.span_of(nxt, "830A-430P"))
check("and a 9A start on that morning does not cross it either",
      sr.clash_for(sr.span_of(nxt, "9A-5P"), held_night) is None)
clash = sr.clash_for(sr.span_of(nxt, "8A-4P"), held_night)
check("the refusal names the shift it collides with, in words",
      "10P-8:30A" in sr.clash_sentence(clash) and day in sr.clash_sentence(clash),
      sr.clash_sentence(clash))
check("a shift they only APPLIED for says so in the refusal",
      "(a shift they have applied for)" in sr.clash_sentence(
          {**clash, "source": "application"}))
check("and a shift being handed to them says so too",
      "(a shift being handed to them)" in sr.clash_sentence({**clash, "source": "handoff"}))
check("a span that could not be read collides with nothing",
      sr.clash_for(None, held_night) is None)
caller_clash = {**clash, "source": "application", "open_row": "Zed Caller", "employee": "Ann Roe",
                "ref": "x"}
check("R9: a clash as it is SENT never carries the pool's row key — for a call-off that is the "
      "caller's own name — only the house, the day, the hours and the road",
      sr.clash_out(caller_clash) == {"location": clash["location"], "col_iso": clash["col_iso"],
                                     "value": clash["value"], "source": "application"}
      and sr.clash_out(None) == {}, sr.clash_out(caller_clash))
check("R9: the pool's handle is keyed, not a plain hash of the house, the row and the day",
      sr.ref_of("CAN - BM - BM4060", "Zed Caller", day)
      != "SP" + __import__("hashlib").sha256(f"CAN - BM - BM4060|Zed Caller|{day}".encode())
      .hexdigest()[:10].upper()
      and sr.REF_RE.match(sr.ref_of("CAN - BM - BM4060", "Zed Caller", day)) is not None
      and sr.ref_of("CAN - BM - BM4060", "Zed Caller", day)
      == sr.ref_of("CAN - BM - BM4060", "Zed Caller", day))


# a read that began before a write must not restore its older picture (the estate's generation)
class _MidWriteCur:
    def __init__(self, write):
        self.write, self.sql = write, ""

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, args=None):
        self.sql = sql

    def fetchall(self):
        if self.write and "asa_house_calendar_live" in self.sql:
            sr.forget_estate()
        return []


class _MidWriteConn:
    def __init__(self, write):
        self.write = write

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def cursor(self, *a, **k):
        return _MidWriteCur(self.write)


_held = (sr._connect, sr.house_cal_live.ensure_tables, sr.house_cal_live.pending_publishes)
try:
    sr.house_cal_live.ensure_tables = lambda dsn: None
    sr.house_cal_live.pending_publishes = lambda cur: {}
    sr.forget_estate()
    sr._connect = lambda dsn: _MidWriteConn(True)
    sr.estate("x", fresh=True)
    mid_write_kept = sr._ESTATE["view"] is not None
    sr._connect = lambda dsn: _MidWriteConn(False)
    sr.estate("x", fresh=True)
    quiet_kept = sr._ESTATE["view"] is not None
finally:
    sr._connect, sr.house_cal_live.ensure_tables, sr.house_cal_live.pending_publishes = _held
    sr.forget_estate()
check("a picture read while a write landed is NOT kept — the next gated check reads again",
      mid_write_kept is False and quiet_kept is True, [mid_write_kept, quiet_kept])


print("\nR10 — trained for that house, or the house manager approves")

index = {"readable": True, "by_person": {
    sr.fold("Ann Roe"): {"ABD1711": {"done": 2, "owed": 0, "clients": ["K H"], "owed_for": []}},
    sr.fold("Ben Left"): {"ABD1711": {"done": 0, "owed": 1, "clients": [], "owed_for": ["T C"]}},
}}
ok = sr.ist_verdict(index, "Ann Roe", "CAN - 48TH (B) - ABD1711")
check("an IST on file for that house is a pass", ok["ok"] and ok["state"] == "ok", ok)
owed = sr.ist_verdict(index, "Ben Left", "CAN - 48TH (B) - ABD1711")
check("a row that is still owed is not a trained person, and says which client",
      owed["ok"] is False and owed["state"] == "owed" and "T C" in owed["why"], owed)
missing = sr.ist_verdict(index, "Cy Far", "CAN - 48TH (B) - ABD1711")
check("no row at all is missing, named by the house people say out loud",
      missing["ok"] is False and missing["state"] == "missing"
      and "48TH (B)" in missing["why"], missing)
check("an IST at ANOTHER house does not travel",
      sr.ist_verdict(index, "Ann Roe", "CAN - JH - ABD2704")["ok"] is False)
unread = sr.ist_verdict({"readable": False, "why": "the book is away", "by_person": {}},
                        "Ann Roe", "CAN - 48TH (B) - ABD1711")
check("a read that FAILED is not a trained person, and the screen is told why",
      unread["ok"] is False and unread["state"] == "unreadable"
      and "the book is away" in unread["why"], unread)


print("\nthe badge — who sees the whole company's list")

check("a house manager's badge reads the whole company",
      bool(sr.badges_of("staff", "HM") & sr.MANAGER_BADGES))
check("a director's does, and may see a call-off's reason",
      bool(sr.badges_of("staff", "DIRECTOR") & sr.MANAGER_BADGES)
      and bool(sr.badges_of("staff", "DIRECTOR") & sr.REASON_BADGES))
check("a team lead's badge reads the whole company, as a house manager's does — the stored token, TEAMLEAD",
      "TEAMLEAD" in sr.MANAGER_BADGES
      and bool(sr.badges_of("staff", "TEAMLEAD") & sr.MANAGER_BADGES))
check("…and never decides as a director: a team lead is not among the badges that see a call-off's reason",
      not sr.badges_of("staff", "TEAMLEAD") & sr.REASON_BADGES)
# the badge that follows DIRECTOR, read from badge_follows, never spelled here
import badge_follows  # noqa: E402
FOLLOWER = next((w for w, stands in badge_follows.BADGE_FOLLOWS.items() if stands == "DIRECTOR"), "")
if FOLLOWER:
    check("the badge that stands in for a director reaches what a director reaches here too — "
          "the whole company's list, the reasons, every house's decision",
          bool(sr.badges_of("staff", FOLLOWER) & sr.MANAGER_BADGES)
          and bool(sr.badges_of("staff", FOLLOWER) & sr.REASON_BADGES)
          and FOLLOWER in sr.badges_of("staff", FOLLOWER), sorted(sr.badges_of("staff", FOLLOWER)))
else:
    print("  (no badge stands in for the director today — nothing to hold)")
check("a plain caregiver reads neither",
      not (sr.badges_of("staff", "") & sr.MANAGER_BADGES)
      and not (sr.badges_of("staff", "") & sr.REASON_BADGES))
check("the HM badge is not one of the reason badges — on Requests the reason follows who reads every "
      "row of that house (sees_house, held in the lane below), not a badge of its own",
      not (sr.badges_of("staff", "HM") & sr.REASON_BADGES))
check("the role counts as a badge, the way the matrix is written",
      "MANAGER" in sr.badges_of("manager", ""))
check("a manager decides in the houses they are the ** row of, and nowhere else",
      sr.may_decide({"decides_everywhere": False, "decides": ["ABD1711"]},
                    "CAN - 48TH (B) - ABD1711") is True
      and sr.may_decide({"decides_everywhere": False, "decides": ["ABD1711"]},
                        "CAN - JH - ABD2704") is False)
check("an administrator decides everywhere",
      sr.may_decide({"decides_everywhere": True, "decides": []}, "CAN - JH - ABD2704") is True)

# a current ** manager wears HM (shift_requests.CALENDAR_BADGE), on a stand-in calendar
_real_hm = sr.house_managers
sr.house_managers = lambda dsn, **k: {"readable": True, "why": "", "by_code": {
    "ABD1711": {"name": "Mia Manager", "names": ["Mia Manager", "Ned Night"], "phone": "", "house": "",
                "last_day": ""}}}
try:
    _mia = sr.viewer("x", name="Mia Manager", role="staff", types="STAFF")
    _ned = sr.viewer("x", name="Ned Night", role="staff", types="")
    _ann = sr.viewer("x", name="Ann Roe", role="staff", types="STAFF")
    _hand = sr.viewer("x", name="Hal Hand", role="staff", types="HM")
    H48 = "CAN - 48TH (B) - ABD1711"
    check("the current ** managers wear HM — the most recent row and a co-manager inside the fortnight — "
          "and a caregiver does not",
          "HM" in _mia["badges"] and "HM" in _ned["badges"] and "HM" not in _ann["badges"]
          and _mia["hm_by_calendar"] is True and _ann["hm_by_calendar"] is False,
          [_mia["badges"], _ned["badges"], _ann["badges"]])
    check("the badge worn by code is scoped to their houses: it never widens the whole company's list, "
          "and a badge ticked by hand still does",
          _mia["whole_company"] is False and _hand["whole_company"] is True
          and _hand["hm_by_calendar"] is False)
    check("they read their own house whole and no other; they edit their own house's calendar and not "
          "every house's",
          sr.sees_house(_mia, H48) is True and sr.sees_house(_mia, "CAN - JH - ABD2704") is False
          and sr.may_edit_calendar(_mia, H48) is True
          and sr.may_edit_calendar(_mia, "CAN - JH - ABD2704") is False
          and sr.edits_every_house(_mia) is False and sr.may_view_calendars(_ned) is True)
finally:
    sr.house_managers = _real_hm


print("\nR5/R6 — a swap never crosses an open shift, and keeps its two consents")

sys.modules.pop("shift_handoff", None)
import shift_handoff as sh  # noqa: E402

check("an OPEN row is not a person's shift to give",
      sh._is_open_row("OPEN") and sh._is_open_row("open 2") and not sh._is_open_row("Ann Roe"))
check("the two consents are still two, and either NO ends the offer",
      sh.ACCEPTED == "accepted" and sh.APPROVED == "approved"
      and sh.PENDING == "pending" and sh.DEAD == "dead")
check("APPROVE is a yes and NOT APPROVE is a no — the refusal is read first",
      sh.read_word("approve") == "yes" and sh.read_word("not approved") == "no"
      and sh.read_word("I will think about it") == "other")
check("the three roads carry a reference, so a bare YES is never guessed at",
      sh.handoff_id("H", "2026-09-22", "Ann", "x").startswith("HO")
      and len(sh.handoff_id("H", "2026-09-22", "Ann", "x")) == 12)
src = (SERVER / "shift_handoff.py").read_text(encoding="utf-8")
check("the one gate is asked at the offer AND inside the completion, recording nothing",
      src.count("sr.check_assignment(") >= 2 and "guard_assignment(" not in src,
      src.count("sr.check_assignment("))
check("a gate that could not be asked refuses an offer and PAUSES an agreed swap — never kills it",
      '"guard_unreadable"' in src and "return _pause(cur, row, f\"the overlap check could not be run"
      in src)
check("and the completion tells the gate which offer it is deciding, so the shift "
      "cannot collide with itself",
      "ignore_handoff=row[\"id\"]" in src)


print("\nthe doors — a rule that could not be asked is not a rule that said no")

door = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")


def body_of(text: str, name: str) -> str:
    """One `def`'s own lines — so a check about ONE door cannot be satisfied
    by what a different door two hundred lines away happens to say."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.startswith(f"def {name}(") or line.startswith(f"async def {name}("):
            out = [line]
            for nxt in lines[i + 1:]:
                if nxt and not nxt[0].isspace() and not nxt.startswith(")"):
                    break
                out.append(nxt)
            return "\n".join(out)
    return ""


# the Builder's overlap check must never read "could not ask" as "yes"
builder = (SERVER / "calendar_builder_houses.py").read_text(encoding="utf-8")
overlap = body_of(builder, "_overlap")
check("the Builder's overlap check that THREW refuses the draft — it is never read as a yes",
      "except Exception" in overlap and '"guard_unreadable"' in overlap
      and "not_asked" not in overlap, overlap[-400:])
check("House Calendars' own cell and move doors no longer write at all",
      "_housecal_edits_moved(" in body_of(door, "lane_housecal_cell")
      and "_housecal_edits_moved(" in body_of(door, "lane_housecal_move"))
check("the claim door goes through the lane instead of straight to the ledger",
      "shift_requests.take_open_shift" in door
      and "house_cal_live.claim_open_shift" not in door,
      "house_cal_live.claim_open_shift" in door)
# the doors ask a house question (may_decide / may_edit_calendar), never the bare role word
for name, law in (("lane_shift_requests_apply", "may_decide(who"),
                  ("lane_shift_requests_withdraw", "may_decide(who"),
                  ("lane_housecal_claim", "may_edit_calendar(who")):
    text = body_of(door, name)
    check(f"{name}: acting for somebody else asks {law.split('(')[0]}, not the session's role word",
          'actor[0] in ("admin", "manager")' not in text
          and 'actor[0] in ("admin","manager")' not in text
          and law in text, text[:200])
check("Requests is never a client's or a guardian's: the feed and the detail door refuse them before any "
      "house, street or manager is read",
      sr.may_read_requests({"role": "client"}) is False
      and sr.may_read_requests({"role": "Guardian "}) is False
      and sr.may_read_requests({"role": "staff"}) is True
      and all(body_of(door, n).index("shift_requests.may_read_requests(who)")
              < body_of(door, n).index("asyncio.to_thread(shift_requests.")
              for n in ("lane_shift_requests", "lane_shift_requests_detail")))
check("the training approval reads the house off the ROW, never off the body",
      "shift_requests.request_row, PG_DSN, rid" in door
      and 'location = str(owner.get("location") or "")' in door)
# ASKING, ANSWERING AND THEN WRITING IS THREE STEPS, and two desks typing the
# same caregiver onto two overlapping cells in the same second both read
# "free". The busiest write on the platform does the pair under one lock.
check("the Builder's draft asks and writes as ONE act, under a lock on the person",
      "with shift_requests.person_gate(dsn, employee):" in body_of(builder, "stage_cell")
      and "_overlap(" in body_of(builder, "stage_cell")
      and "_put(" in body_of(builder, "stage_cell"),
      body_of(builder, "stage_cell")[:300])
check("and the claim and the approval take the same lock before they decide",
      "with person_gate(dsn, person):"
      in (SERVER / "shift_requests.py").read_text(encoding="utf-8"))

print("\nthe ledger of what was said — the door's own words")

for name in ("shift_requests",):
    text = (SERVER / f"{name}.py").read_text(encoding="utf-8")
    keep = text.split("keep = {", 1)[1].split("}", 1)[0]
    check(f"{name}: a delivered notice is written down on the FIRST pass "
          f"(`told`/`redirected`, which is what the door answers)",
          '"told"' in keep and '"redirected"' in keep and '"sent"' not in keep, keep)
    check(f"{name}: and what did not happen stays owed",
          '"failed"' not in keep and '"refused_quiet"' not in keep
          and '"dial_unknown"' not in keep, keep)
# only a text that reached the person closes a swap ask (tools/test-shift-transfer.py holds the rest)
check("shift_handoff: `told` closes an ask, a rehearsal row does not, and `sent` is no word of the door's",
      sh.FINAL == {"told", "duplicate", "opted_out"} and "redirected" in sh.REHEARSAL
      and "recorded" in sh.REHEARSAL and "sent" not in sh.FINAL)
check("shift_handoff: and a 'not now' is never written down",
      sh.NOT_NOW == {"refused_quiet", "dial_unknown"})


# ═══════════════════════════════════════════════════════════════════════════
# R3 — the ledger, in a real database: two approvals, one winner
# ═══════════════════════════════════════════════════════════════════════════

# Both lanes: every table the code under test reads is made in the lane's schema
# BEFORE its first read, and the lane refuses to start while one still resolves
# to public. A read of the call-off road that ran before the lane had made it
# landed on the production table and found a fixture row a broken run had left.
OWN_THE_LANE = '''
def own_the_lane():
    import lane_schema
    # the Call Off Tracker is a book of the lane's own, `lane_tracker`, from before the first read
    return lane_schema.own_shift_lane(T, SCHEMA, LANE_DIR)
'''

LANE = '''
import json, os, sys
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, LANE_DIR)
import psycopg2, psycopg2.extras
import house_cal_live, shift_handoff
import shift_requests as sr
import calendar_builder_houses as cbh
import effective_roster
import time_off
# an unregistered switch holds; this lane writes the stand-in workbook
effective_roster.use_switch(lambda: {"on": False, "readable": True, "word": "off", "why": ""})
time_off.use_house(time_off.MemoryHouse())

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
# A SCHEMA OF THIS RUN'S OWN. A fixed name is shared by every lane running at
# the same moment, and a DROP ... CASCADE of it deletes another run's tables
# from under it; what surfaces is a deadlock in Postgres's own type catalogue,
# which reads like a broken test rather than two tests in one room.
import lane_schema
ROOMS = lane_schema.Rooms(DSN, "shift-requests")
SCHEMA = ROOMS.name()
OUT = {}
LOC = "CAN - 48TH (B) - ABD1711"
OTHER = "CAN - JH - ABD2704"
today = datetime.now(sr.OHIO).date()
D1 = (today + timedelta(days=1)).isoformat()
OLD = (today - timedelta(days=3)).isoformat()
FAR = (today - timedelta(days=40)).isoformat()


def grid(rows, isos):
    return {"cols": [{"iso": i} for i in isos],
            "rows": [{"employee": e, "cells": [{"text": t} for t in cs]} for e, cs in rows]}


ROOMS.make()
# The new schema FIRST, public behind it: every table this lane writes is
# created here and found here, while the read-only mirror it asks about the
# IST book and the house managers is still reachable in public.
T = ROOMS.path(SCHEMA)
try:
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("CREATE TABLE asa_house_calendar_live (location TEXT PRIMARY KEY, "
                    "grid JSONB, updated_at TIMESTAMPTZ DEFAULT now())")
        cur.execute(house_cal_live.OVERRIDES_DDL)
        cur.execute(house_cal_live.CLAIMS_DDL)
        cur.execute(shift_handoff.HANDOFFS_DDL)
        cur.execute(shift_handoff.OPEN_INDEX_DDL)
        for stmt in sr.DDL:
            cur.execute(stmt)
        # Ann and Ben are regulars of 48TH (B); Cy has not been there in 40 days.
        GRIDS = {
            LOC: grid([("OPEN", ["", "", "8A-4P"]),
                       ("Ann Roe", ["", "8A-4P", ""]),
                       ("Ben Left", ["", "8A-4P", ""]),
                       ("Cy Far", ["8A-4P", "", ""])], [FAR, OLD, D1]),
            # Ben is already working 10A-6P at JH on the same day.
            OTHER: grid([("OPEN", ["", "", "8A-4P"]),
                         ("Ben Left", ["", "", "10A-6P"]),
                         ("Dee Way", ["", "8A-4P", ""])], [FAR, OLD, D1]),
        }
        for loc, g in GRIDS.items():
            cur.execute("INSERT INTO asa_house_calendar_live (location, grid) VALUES (%s,%s)",
                        (loc, psycopg2.extras.Json(g)))
        c.commit()
    OUT["owned"] = own_the_lane()
    # the house calendars workbook, as a stand-in the decisions below write into
    BOOK = cbh.MemoryWorkbook.from_grids(GRIDS)
    cbh.use_workbook(BOOK)

    sr.forget_estate()
    sr.sweep(T)
    OUT["backfilled_closed"] = sr.pool(T)[0]["state"]
    now = datetime.now(timezone.utc)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_pool SET opened_at=%s", (now,))
        c.commit()
    OUT["window_open"] = sr.pool(T)[0]["window"]["state"]

    def refused(fn):
        try:
            fn()
            return ""
        except sr.Refused as exc:
            return exc.code
        except ValueError as exc:
            return str(exc)

    OUT["outsider"] = refused(lambda: sr.apply_for(
        T, location=LOC, open_row="OPEN", col_iso=D1, person="Cy Far"))
    OUT["overlap"] = refused(lambda: sr.apply_for(
        T, location=LOC, open_row="OPEN", col_iso=D1, person="Ben Left"))
    a = sr.apply_for(T, location=LOC, open_row="OPEN", col_iso=D1, person="Ann Roe")
    OUT["applied"] = a["applied"]
    OUT["ist_state"] = a["ist"]["state"]
    OUT["training_raised"] = bool(a.get("training_request"))
    OUT["twice"] = sr.apply_for(T, location=LOC, open_row="OPEN", col_iso=D1,
                                person="Ann Roe")["applied"]
    OUT["applicants"] = [x["person"] for x in sr.applicants(
        T, location=LOC, open_row="OPEN", col_iso=D1)]
    # a SECOND house, a SECOND person: the whole-company list must carry both,
    # and a staff member's copy must carry neither of the other's
    sr.apply_for(T, location=OTHER, open_row="OPEN", col_iso=D1, person="Dee Way")

    # R5 — an OPEN row is not a shift anybody can hand over
    OUT["open_handoff"] = refused(lambda: shift_handoff.offer(
        T, location=LOC, col_iso=D1, from_staff="OPEN", to_staff="Dee Way"))
    # R5 — and a handoff that would cross what the receiver applied for
    OUT["swap_over_application"] = refused(lambda: shift_handoff.offer(
        T, location=OTHER, col_iso=D1, from_staff="Ben Left", to_staff="Ann Roe"))

    # R10 — the approval on its own releases the application
    rel = sr.approve_training(T, request_id_=a["training_request"], by="Shylah Walker")
    OUT["released"] = rel["released"]
    OUT["after_training"] = [(x["person"], x["state"]) for x in sr.applicants(
        T, location=LOC, open_row="OPEN", col_iso=D1)]

    # the window closes with somebody on it: the one notice, said once
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_pool SET opened_at=%s", (now - timedelta(hours=2),))
        c.commit()
    OUT["closed_state"] = sr.pool(T)[0]["state"]
    owed = [o for o in sr.owed(T) if o["location"] == LOC]
    OUT["owed"] = [(o["kind"], o["applicants"]) for o in owed]
    sr.mark_said(T, [o["id"] for o in owed],
                 {"results": [{"id": o["id"], "state": "recorded"} for o in owed]})
    OUT["owed_again"] = [o for o in sr.owed(T) if o["location"] == LOC]
    # a door that refused leaves the notice owed
    OUT["owed_after_refusal"] = len([o for o in sr.owed(T) if o["location"] == LOC])

    # R3 — two approvals in the same second
    def decide(who):
        try:
            sr.decide(T, location=LOC, open_row="OPEN", col_iso=D1, person=who,
                      by="Shylah Walker")
            return ("won", who)
        except sr.Refused as exc:
            return ("lost", exc.extra.get("claimed_by") or exc.why)

    with ThreadPoolExecutor(max_workers=2) as pool:
        # BOTH ARE ON THIS GRID, so whichever wins the roster must show
        # exactly one name — a winner with no row on the house's own tab would
        # make this assertion pass for the wrong reason.
        got = list(pool.map(decide, ["Ann Roe", "Cy Far"]))
    OUT["won"] = sum(1 for g in got if g[0] == "won")
    OUT["lost"] = sum(1 for g in got if g[0] == "lost")
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT claimed_by FROM asa_house_calendar_claims WHERE location=%s", (LOC,))
        OUT["ledger"] = [r[0] for r in cur.fetchall()]
        # THE ROSTER IS THE WORKBOOK: the winner's cell, written by the one writer
        OUT["roster"] = [[n, BOOK.cell(LOC, n, D1)] for n in ("Ann Roe", "Ben Left", "Cy Far")
                         if BOOK.cell(LOC, n, D1)]
        cur.execute("SELECT kind, person, state FROM asa_shift_requests ORDER BY kind, person")
        OUT["requests"] = cur.fetchall()
    OUT["filled"] = [(p["state"], p["filled_by"], p["filled_how"])
                     for p in sr.pool(T) if p["location"] == LOC]
    who = sr.viewer(T, name="Shylah Walker", role="staff", types="HM")
    f = sr.feed(T, who=who)
    OUT["feed_whole"] = f["whole_company"]
    OUT["feed_kinds"] = sorted({r["kind"] for r in f["rows"]})
    here = [s for s in f["open_shifts"] if s["location"] == LOC][0]
    OUT["history"] = [(h["person"], h["state"]) for h in here["history"]]
    staff = sr.feed(T, who=sr.viewer(T, name="Ann Roe", role="staff", types="STAFF"))
    OUT["staff_whole"] = staff["whole_company"]
    OUT["staff_reasons"] = staff["sees_reasons"]
    OUT["staff_rows_all_mine"] = all(r["mine"] for r in staff["rows"])
    OUT["staff_people"] = sorted({sr.fold(r["person"]) for r in staff["rows"]})
    OUT["hm_people"] = sorted({sr.fold(r["person"]) for r in f["rows"]})
    OUT["staff_open_shifts"] = len(staff["open_shifts"])
    OUT["staff_panels"] = "panels" in staff
finally:
    time_off.use_house(None)
    cbh.use_workbook(None)
    OUT["rooms"] = ROOMS.close()
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''


LANE2 = '''
import hashlib, json, os, sys, time
from datetime import datetime, timedelta, timezone
sys.path.insert(0, LANE_DIR)
import psycopg2, psycopg2.extras
import house_cal_live, shift_handoff
import shift_requests as sr
import calendar_builder_houses as cbh
import effective_roster
import time_off
# an unregistered switch holds; this lane writes the stand-in workbook
effective_roster.use_switch(lambda: {"on": False, "readable": True, "word": "off", "why": ""})
TO_HOUSE = time_off.MemoryHouse()
time_off.use_house(TO_HOUSE)
# the swap's directors are stood in; the list itself is held by test-shift-transfer
shift_handoff.directors_for = lambda dsn: {"readable": True, "names": ["Dee Direct"],
                                           "why": "the director Dee Direct approves"}

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
import lane_schema
ROOMS = lane_schema.Rooms(DSN, "shift-requests-2")
SCHEMA = ROOMS.name()
OUT = {}
H1 = "CAN - 48TH (B) - ABD1711"
H2 = "CAN - JH - ABD2704"
today = datetime.now(sr.OHIO).date()
OLD = (today - timedelta(days=3)).isoformat()
D1 = (today + timedelta(days=1)).isoformat()
D2 = (today + timedelta(days=2)).isoformat()
D3 = (today + timedelta(days=3)).isoformat()
ISOS = [OLD, D1, D2, D3]

# THE IST BOOK IS NOT WHAT THESE SCENARIOS ARE ABOUT. R10 is held in the lane
# above, against the real book. Here every path has to be able to reach its end
# so that a refusal can only be the rule under test — an untrained name would
# turn every one of them into a training approval and prove nothing.
# the IST settings as a read that landed, holding the shipped values
import ist_config
ist_config.pin(dict(ist_config.SHIPPED))
EVERY = {"done": 1, "owed": 0, "clients": [], "owed_for": []}
NAMES = ("Ann Roe", "Ben Left", "Cy Far", "Dee Way", "Eve Gone", "Zed Caller")
sr.ist_index = lambda dsn, **k: {
    "readable": True, "why": "", "rows": 0, "source": "test",
    "by_person": {sr.fold(n): {"ABD1711": dict(EVERY), "ABD2704": dict(EVERY)} for n in NAMES}}


def grid(rows):
    return {"cols": [{"iso": i} for i in ISOS],
            "rows": [{"employee": e, "cells": [{"text": t} for t in cs]} for e, cs in rows]}


ROOMS.make()
T = ROOMS.path(SCHEMA)


BOOK = None
GRIDS = {}


def setcell(loc, emp, iso, val):
    """Setup: a cell in both the stand-in workbook and the mirrored grid."""
    i = ISOS.index(iso)
    row = next(r for r in GRIDS[loc]["rows"] if r["employee"] == emp)
    row["cells"][i]["text"] = val
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_house_calendar_live SET grid=%s WHERE location=%s",
                    (psycopg2.extras.Json(GRIDS[loc]), loc))
        c.commit()
    tab = BOOK.tabs[loc]
    ri = next(n for n, r in enumerate(tab) if len(r) > 1 and r[1] == emp)
    tab[ri][3 + i] = val
    sr.forget_estate()


def cellof(loc, emp, iso):
    """What the workbook says in that cell — the roster every screen reads."""
    return BOOK.cell(loc, emp, iso)


def poolrow(loc, row, iso):
    for p in sr.pool(T):
        if (p["location"], p["open_row"], p["col_iso"]) == (loc, row, iso):
            return p
    return None


def claims():
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(house_cal_live.CLAIMS_DDL)
        cur.execute("SELECT location, open_row, col_iso, claimed_by "
                    "FROM asa_house_calendar_claims ORDER BY location, col_iso")
        return [list(r) for r in cur.fetchall()]


def age():
    """Close every window in the pool, so the house manager may decide."""
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_pool SET opened_at = now() - interval '6 hours'")
        c.commit()


def refused(fn):
    try:
        return ["allowed", fn()]
    except sr.Refused as exc:
        return ["refused", exc.code]
    except ValueError as exc:
        return ["refused", str(exc)]


try:
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("CREATE TABLE asa_house_calendar_live (location TEXT PRIMARY KEY, "
                    "grid JSONB, updated_at TIMESTAMPTZ DEFAULT now())")
        cur.execute(house_cal_live.OVERRIDES_DDL)
        cur.execute(house_cal_live.CLAIMS_DDL)
        cur.execute(shift_handoff.HANDOFFS_DDL)
        cur.execute(shift_handoff.OPEN_INDEX_DDL)
        for stmt in sr.DDL:
            cur.execute(stmt)
        GRIDS = {
            H1: grid([("OPEN", ["", "", "", ""]),
                      ("Ann Roe", ["8A-4P", "", "", ""]),
                      ("Ben Left", ["8A-4P", "", "", ""]),
                      ("Cy Far", ["8A-4P", "", "", ""]),
                      ("Eve Gone", ["8A-4P", "", "4P-12A", ""]),
                      ("Zed Caller", ["8A-4P", "4P-12A", "", ""])]),
            H2: grid([("OPEN", ["", "", "", ""]),
                      ("Ben Left", ["", "8A-4P", "", ""]),
                      ("Dee Way", ["8A-4P", "", "OFF", ""])]),
        }
        for loc, g in GRIDS.items():
            cur.execute("INSERT INTO asa_house_calendar_live (location, grid) VALUES (%s,%s)",
                        (loc, psycopg2.extras.Json(g)))
        c.commit()
    OUT["owned"] = own_the_lane()
    BOOK = cbh.MemoryWorkbook.from_grids(GRIDS)
    cbh.use_workbook(BOOK)
    sr.forget_estate()
    sr.sweep(T)
    OUT["pool_at_birth"] = [[p["open_row"], p["col_iso"]] for p in sr.pool(T)
                            if p["location"] in (H1, H2)]
    # the sweep remembers the days already worked — never a future one
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT location, day::text, count(*) FROM asa_house_worked_days GROUP BY 1, 2 ORDER BY 1, 2")
        OUT["worked_record"] = [list(r) for r in cur.fetchall()]
        # H1's record reaches back past the regular window, so an absence in it is a real no; H2's does not
        cur.execute("INSERT INTO asa_house_worked_days (person_key, location, day) VALUES (%s, %s, %s) "
                    "ON CONFLICT DO NOTHING", ("someone", H1, (today - timedelta(days=40)).isoformat()))
        c.commit()
    sr.forget_estate()

    # ── R1: the day is not typed in one act ───────────────────────────────
    # An OPEN row written onto a column stamped long ago still opens a window.
    setcell(H1, "OPEN", D1, "8A-4P")
    sr.sweep(T)
    p = poolrow(H1, "OPEN", D1)
    OUT["late_open_row"] = [p["window"]["state"], p["window"]["seconds_left"] > 0]

    # And the case seen live: one shift typed at nine, the column — its
    # OPEN rows with it — finished hours later.
    setcell(H1, "Eve Gone", D3, "4P-12A")
    sr.sweep(T)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_house_day_published SET first_seen = now() - interval "
                    "'20 minutes' WHERE location=%s AND col_iso=%s", (H1, D3))
        c.commit()
    setcell(H1, "OPEN", D3, "8A-4P")
    sr.sweep(T)
    p = poolrow(H1, "OPEN", D3)
    OUT["drafted_day"] = [p["window"]["state"], p["window"]["seconds_left"] > 0]

    # ── an OPEN cell on a day nobody published waits for the day ──────────
    setcell(H2, "OPEN", D3, "8A-4P")
    sr.sweep(T)
    OUT["unpublished_open"] = poolrow(H2, "OPEN", D3) is None
    setcell(H2, "Ben Left", D3, "6A-2P")
    sr.sweep(T)
    p = poolrow(H2, "OPEN", D3)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT p.opened_at = d.first_seen FROM asa_shift_pool p JOIN asa_house_day_published d "
                    "ON d.location = p.location AND d.col_iso = p.col_iso "
                    "WHERE p.location=%s AND p.open_row='OPEN' AND p.col_iso=%s", (H2, D3))
        same = (cur.fetchone() or [None])[0]
    OUT["published_open"] = [p["window"]["state"] if p else None, same]
    setcell(H2, "OPEN", D3, "")
    setcell(H2, "Ben Left", D3, "")
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("DELETE FROM asa_shift_pool WHERE location=%s AND open_row='OPEN' AND col_iso=%s",
                    (H2, D3))
        c.commit()
    sr.forget_estate()

    # ── the claim door, which used to ask nothing ─────────────────────────
    def take(loc, row, iso, who, decide=False):
        return sr.take_open_shift(T, location=loc, open_row=row, col_iso=iso, person=who,
                                  by="Shylah Walker", may_decide=decide)

    OUT["claim_outsider"] = refused(lambda: take(H1, "OPEN", D1, "Dee Way"))
    OUT["claim_overlap"] = refused(lambda: take(H1, "OPEN", D1, "Ben Left"))
    OUT["claim_regular"] = refused(lambda: take(H1, "OPEN", D1, "Ann Roe"))
    OUT["claims_after_refusals"] = claims()

    # ── R3: they apply, and the house manager decides ─────────────────────
    OUT["applied"] = sr.apply_for(T, location=H1, open_row="OPEN", col_iso=D1,
                                  person="Ann Roe")["applied"]
    # no decision inside the window; a late regular can still apply
    OUT["decide_in_window"] = refused(lambda: take(H1, "OPEN", D1, "Ann Roe", decide=True))
    OUT["filled_in_window"] = poolrow(H1, "OPEN", D1)["filled_by"]
    age()
    take(H1, "OPEN", D1, "Ann Roe", decide=True)
    p = poolrow(H1, "OPEN", D1)
    OUT["assigned"] = [p["state"], p["filled_by"], p["filled_how"]]

    # ── the claims ledger is a commitment, even with no roster row ─────────
    setcell(H1, "OPEN", D2, "8A-4P")
    # H2's D2 holds nobody's shift yet: the day is stamped as published, or its OPEN never pools.
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("INSERT INTO asa_house_day_published (location, col_iso, first_seen, cells) "
                    "VALUES (%s,%s, now() - interval '1 minute', 1) ON CONFLICT DO NOTHING", (H2, D2))
        c.commit()
    setcell(H2, "OPEN", D2, "10A-6P")
    sr.sweep(T)
    # H2's record begins three days back: whether Ann worked there in 28 days cannot be shown
    OUT["regular_unknown"] = refused(lambda: take(H2, "OPEN", D2, "Ann Roe"))
    OUT["dee_before"] = [[h["location"], h["col_iso"], h.get("source")]
                         for h in sr.held_by(T, "Dee Way") if h["col_iso"] in (D2, D3)]
    age()
    got = take(H1, "OPEN", D2, "Dee Way", decide=True)
    OUT["dee_on_no_row"] = got.get("assigned_to_row")
    OUT["dee_after"] = [[h["location"], h["col_iso"], h.get("source")]
                        for h in sr.held_by(T, "Dee Way") if h["col_iso"] in (D2, D3)]
    OUT["dee_second_overlap"] = refused(lambda: take(H2, "OPEN", D2, "Dee Way", decide=True))

    # ── a call-off: the caller's own row is the open cell ─────────────────
    span = sr.span_of(D1, "4P-12A")
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(
            "INSERT INTO asa_shift_pool (location, open_row, col_iso, kind, value, opened_at, "
            "shift_start, shift_end, called_off_by, reason, ref) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (H1, "Zed Caller", D1, sr.KIND_CALLOFF, "4P-12A", datetime.now(timezone.utc),
             span[0], span[1], "Zed Caller", "flu", sr.ref_of(H1, "Zed Caller", D1)))
        c.commit()
    OUT["caller_holds_before"] = [[h["col_iso"], h["value"]] for h in sr.held_by(T, "Zed Caller")
                                  if h["col_iso"] == D1]

    # R9: a staff reader is told a shift is open and NOT who opened it
    staff = sr.feed(T, who=sr.viewer(T, name="Ann Roe", role="staff", types="STAFF"))
    boss = sr.feed(T, who=sr.viewer(T, name="Shylah Walker", role="staff", types="HM"))
    OUT["staff_sees_caller"] = "Zed Caller" in json.dumps(staff, default=str)
    OUT["boss_sees_caller"] = "Zed Caller" in json.dumps(boss, default=str)
    offers = [o for o in staff["available"] if o["kind"] == "call_off"]
    OUT["staff_offer"] = [[o["open_row"], o["key"], o["ref"]] for o in offers]
    OUT["ref_resolves"] = list(sr.by_ref(T, sr.ref_of(H1, "Zed Caller", D1)) or [])
    # a clash names the shift applied for, never the pool's row (the caller)
    zed_ref = sr.ref_of(H1, "Zed Caller", D1)
    OUT["dee_applies_zed"] = sr.apply_for(T, location=H1, open_row="Zed Caller", col_iso=D1,
                                          person="Dee Way")["applied"]
    other = sr.span_of(D1, "6P-10P")
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(
            "INSERT INTO asa_shift_pool (location, open_row, col_iso, kind, value, opened_at, "
            "shift_start, shift_end, called_off_by, reason, ref) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (H2, "Other Caller", D1, sr.KIND_CALLOFF, "6P-10P", datetime.now(timezone.utc),
             other[0], other[1], "Other Caller", "", sr.ref_of(H2, "Other Caller", D1)))
        c.commit()
    OUT["clash_blob"] = json.dumps([refused(lambda: sr.apply_for(
        T, location=H2, open_row="Other Caller", col_iso=D1, person="Dee Way")),
        sr.eligibility(T, location=H2, open_row="Other Caller", col_iso=D1, person="Dee Way")],
        default=str)
    staff_dee = sr.feed(T, who=sr.viewer(T, name="Dee Way", role="staff", types="STAFF"))
    OUT["staff_feed_zed"] = "Zed Caller" in json.dumps(staff_dee, default=str)

    # a calendar HM reads every row of her own house only
    real_hm = sr.house_managers
    sr.house_managers = lambda dsn, **k: {"readable": True, "why": "", "by_code": {
        "ABD1711": {"name": "Mia Manager", "names": ["Mia Manager"], "phone": "", "house": H1,
                    "last_day": ""}}}
    try:
        mia = sr.viewer(T, name="Mia Manager", role="staff", types="STAFF")
        fm = sr.feed(T, who=mia)
        h1_offs = [c for c in fm["call_offs"] if c["location"] == H1]
        h2_offs = [c for c in fm["call_offs"] if c["location"] == H2]
        OUT["derived_viewer"] = [mia["badges"], mia["whole_company"], mia["hm_by_calendar"],
                                 mia["manages"]]
        OUT["derived_feed"] = [
            fm["whole_company"], "panels" in fm,
            sorted({s["location"] for s in fm["open_shifts"]}),
            any(r["location"] == H1 and r["person"] == "Dee Way" for r in fm["rows"]),
            any(c.get("called_off_by") == "Zed Caller" for c in h1_offs),
            any(c.get("called_off_by") or c.get("open_row") for c in h2_offs),
            any(r["location"] == H2 and not r["mine"] for r in fm["rows"])]
    finally:
        sr.house_managers = real_hm
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("DELETE FROM asa_shift_pool WHERE open_row='Other Caller'")
        c.commit()

    # the row, opened, cut per reader (time off from a stand-in Time Off house)
    real_hm = sr.house_managers

    def time_off_row(ref, person, a, b, status, houses, **more):
        row = {h: "" for h in time_off.HEADER}
        row.update(hm_state="waiting", dir_state="waiting", hm_mode="house_manager")
        row.update(id=ref, person=person, person_key=sr.fold(person), start_date=a, end_date=b,
                   status=status, houses=houses, createdAt=time_off.stamp(), updatedAt=time_off.stamp(),
                   **more)
        TO_HOUSE.tabs["time_off"].append([row[h] for h in time_off.HEADER])

    time_off_row("TO00000000D1", "Dee Way", D2, D3, "pending", "ABD2704", filed_by="Dee Way")
    time_off_row("TO00000000E1", "Eve Gone", D2, D2, "scheduled", "ABD1711", filed_by="Eve Gone",
                 hm_state="approved", hm_by="Mia Manager", dir_state="approved", dir_by="Ty Bond",
                 status_why="approved by the house manager and a director")
    time_off_row("TO00000000N1", "Nobody Here", D1, D1, "pending", "", filed_by="Nobody Here")
    TO_HOUSE.sync()
    time_off.forget()
    sr.house_managers = lambda dsn, **k: {"readable": True, "why": "", "by_code": {
        "ABD1711": {"name": "Mia Manager", "names": ["Mia Manager"], "phone": "", "house": H1,
                    "last_day": ""}}}
    try:
        dee = sr.viewer(T, name="Dee Way", role="staff", types="STAFF")
        mia = sr.viewer(T, name="Mia Manager", role="staff", types="STAFF")
        boss_v = sr.viewer(T, name="Shylah Walker", role="staff", types="DIRECTOR")
        f_dee, f_mia, f_boss = (sr.feed(T, who=w) for w in (dee, mia, boss_v))
        c_dee = f_dee["shifts"].get(zed_ref) or {}
        c_mia = f_mia["shifts"].get(zed_ref) or {}
        c_boss = f_boss["shifts"].get(zed_ref) or {}
        OUT["card_staff"] = [c_dee.get("code"), c_dee.get("house"), c_dee.get("shift_code"),
                             c_dee.get("hours"), bool(c_dee.get("link", "").startswith(
                                 "/#/app/calendarbuilder/house-cal?")),
                             "called_off" in c_dee, "decision" in c_dee,
                             (c_dee.get("urgent") or {}).get("known"),
                             "flu" in json.dumps([r for r in f_dee["call_offs"]], default=str),
                             "Zed Caller" in json.dumps(f_dee, default=str)]
        OUT["card_manager"] = [(c_mia.get("called_off") or {}).get("by"),
                               "reason" in (c_mia.get("called_off") or {}),
                               next((r.get("reason") for r in f_mia["call_offs"]
                                     if r["ref"] == zed_ref), None)]
        OUT["card_boss"] = [(c_boss.get("called_off") or {}).get("by"), c_boss.get("managers")]
        OUT["time_off_staff"] = [[t["person"], t["mine"]] for t in f_dee["time_off"]["rows"]]
        OUT["time_off_staff_names"] = [o.get("filled_by") for t in f_dee["time_off"]["rows"]
                                       for d in t["displaced"] for o in d.get("open_shifts") or []]
        OUT["time_off_manager"] = sorted(t["person"] for t in f_mia["time_off"]["rows"])
        OUT["time_off_boss"] = sorted(t["person"] for t in f_boss["time_off"]["rows"])
        eve = next((t for t in f_boss["time_off"]["rows"] if t["person"] == "Eve Gone"), {})
        OUT["time_off_eve"] = [[d["col_iso"] == D2, d["value"], d["working"], d["covered"]]
                               for d in eve.get("displaced") or []]
        OUT["time_off_words"] = eve.get("decided_why")
        OUT["time_off_decision"] = [eve.get("decided_by"), eve.get("status"), eve.get("state"),
                                    eve.get("houses"), (eve.get("hm") or {}).get("by"),
                                    (eve.get("dir") or {}).get("by"), eve.get("link")]

        # the panel's heavy half, through the same cut
        d_dee = sr.shift_detail(T, who=dee, ref=zed_ref)
        d_boss = sr.shift_detail(T, who=boss_v, ref=zed_ref)
        OUT["detail_staff"] = ["called_off" in d_dee, [a["person"] for a in d_dee["applicants"]],
                               "manager_availability" in d_dee, "names" in d_dee["eligible"],
                               isinstance(d_dee["eligible"]["free"], int)]
        OUT["detail_boss"] = [[a["person"] for a in d_boss["applicants"]],
                              sorted(d_boss["applicants"][0]) if d_boss["applicants"] else [],
                              [m["name"] for m in d_boss.get("manager_availability") or []],
                              "Zed Caller" in (d_boss["eligible"].get("names") or [])]
        OUT["detail_not_yours"] = refused(lambda: sr.shift_detail(
            T, who=dee, ref=sr.ref_of(H1, "OPEN", D1)))
        OUT["detail_no_ref"] = refused(lambda: sr.shift_detail(T, who=dee, ref="SP0000000000"))

        # how a call-off was filed: a row in the lane's own tracker, and a Builder record that wins over it
        y, m, d = (int(x) for x in D1.split("-"))
        st0 = sr.call_off_stories(T, [poolrow(H1, "Zed Caller", D1)])[zed_ref]
        OUT["road_before"] = [st0["road"], st0["readable"], st0["urgent"]["known"]]
        with psycopg2.connect(T) as c, c.cursor() as cur:
            cur.execute("INSERT INTO lane_tracker VALUES (%s,%s,'Call Off','Boyd Bailey','Zed Caller',"
                        "'Mother was in the hospital')", ("9/22/2026 8:15:23", f"{m}/{d}/{y}"))
            c.commit()
        try:
            zed_row = poolrow(H1, "Zed Caller", D1)
            st = sr.call_off_stories(T, [zed_row])[zed_ref]
            OUT["story_tracker"] = [st["road"], st["by"], st["reason"], st["readable"],
                                    bool(st["at"]), st["urgent"]["known"]]
            with psycopg2.connect(T) as c, c.cursor() as cur:
                cur.execute("INSERT INTO asa_calendar_calloff_road (ref, location, employee, col_iso, "
                            "reason, actor, state, told_at, answer) "
                            "VALUES (%s,%s,%s,%s,%s,%s,'told',now(),%s)",
                            (zed_ref, H1, "Zed Caller", D1, "car broke down", "Mia Manager",
                             psycopg2.extras.Json({"others_sent": 43, "rehearsed_rows": 0, "urgent": {
                                 "state": "told", "sent": 41, "redirected": 0, "resolved": 41,
                                 "rehearsal_rows": 0, "why": "41 of 41 reached"}})))
                c.commit()
            st2 = sr.call_off_stories(T, [zed_row])[zed_ref]
            OUT["story_builder"] = [st2["road"], st2["by"], st2["reason"], st2["urgent"]["state"],
                                    st2["urgent"]["sent"]]

            def urgent_after(answer):
                with psycopg2.connect(T) as c, c.cursor() as cur:
                    cur.execute("UPDATE asa_calendar_calloff_road SET state='told', "
                                "answer=%s WHERE ref=%s", (psycopg2.extras.Json(answer), zed_ref))
                    c.commit()
                u = sr.call_off_stories(T, [zed_row])[zed_ref]["urgent"]
                return [u["known"], u.get("state"), u.get("sent"), u.get("held"), u.get("why")]

            # the other legs' sends never count as the URGENT's
            OUT["story_deferred"] = urgent_after({"others_sent": 2, "rehearsed_rows": 0, "urgent": {
                "state": "deferred", "sent": 0, "redirected": 0, "resolved": 77, "rehearsal_rows": 0,
                "why": "held by the quiet window"}})
            OUT["story_testers"] = urgent_after({"others_sent": 0, "rehearsed_rows": 0, "urgent": {
                "state": "rehearsed", "sent": 0, "redirected": 77, "resolved": 77, "rehearsal_rows": 0,
                "why": "0 of 77 reached, 77 rehearsed at the testers"}})
            OUT["story_nobody"] = urgent_after({"others_sent": 1, "rehearsed_rows": 0, "urgent": {
                "state": "wordless", "sent": 0, "redirected": 0, "resolved": 0, "rehearsal_rows": 0,
                "why": "the situation is switched off"}})
            OUT["story_no_leg"] = urgent_after({"others_sent": 41, "rehearsed_rows": 0})
            OUT["story_held"] = urgent_after({"others_sent": 0, "rehearsed_rows": 3, "urgent": {
                "state": "recorded", "sent": 0, "redirected": 0, "resolved": 77, "rehearsal_rows": 1,
                "why": "the sending dial stands at record, 5551234567"}})[1]
            # and the staff member's card still carries none of it but the URGENT's fate
            c_dee2 = sr.feed(T, who=dee)["shifts"].get(zed_ref) or {}
            OUT["story_staff"] = ["called_off" in c_dee2, (c_dee2.get("urgent") or {}).get("state"),
                                  "car broke down" in json.dumps(c_dee2),
                                  "5551234567" in json.dumps(c_dee2)]
        finally:
            with psycopg2.connect(T) as c, c.cursor() as cur:
                cur.execute("DELETE FROM lane_tracker")
                c.commit()

        # a source that cannot be read is said, and the list still answers
        TO_HOUSE.fail = True
        time_off.forget()
        try:
            f_broken = sr.feed(T, who=boss_v)
        finally:
            TO_HOUSE.fail = False
            time_off.forget()
        OUT["time_off_unreadable"] = [f_broken["time_off"]["readable"],
                                      "could not be read" in f_broken["time_off"]["why"],
                                      f_broken["time_off"]["rows"], len(f_broken["rows"]) > 0]
    finally:
        sr.house_managers = real_hm
    OUT["ref_is_keyed"] = [zed_ref != "SP" + hashlib.sha256(
        f"{H1}|Zed Caller|{D1}".encode()).hexdigest()[:10].upper(), bool(sr.REF_RE.match(zed_ref))]

    age()
    # a typed name on no roster and no staff list is never written into the workbook
    rows_before = len(BOOK.tabs.get(H1) or [])
    OUT["phantom"] = [refused(lambda: sr.decide(T, location=H1, open_row="Zed Caller", col_iso=D1,
                                                person="Jhon Smiht", by="Shylah Walker")),
                      len(BOOK.tabs.get(H1) or []) - rows_before,
                      cellof(H1, "Jhon Smiht", D1),
                      (poolrow(H1, "Zed Caller", D1) or {}).get("filled_by")]
    sr.decide(T, location=H1, open_row="Zed Caller", col_iso=D1, person="Cy Far",
              by="Shylah Walker")
    # R6: a staff member sees only their own application
    after = sr.feed(T, who=sr.viewer(T, name="Dee Way", role="staff", types="STAFF"))
    zed = next((c for c in after["call_offs"] if c["ref"] == zed_ref), {})
    OUT["staff_call_off_row"] = [zed.get("filled_by"), zed.get("decided_by"),
                                 sorted({a["person"] for a in zed.get("history") or []}),
                                 zed.get("applicant_count")]
    OUT["passed_over_why"] = [a.get("why") for a in zed.get("history") or []]
    sr.forget_estate()
    OUT["caller_cell"] = cellof(H1, "Zed Caller", D1)
    OUT["taker_cell"] = cellof(H1, "Cy Far", D1)
    OUT["caller_holds_after"] = [[h["col_iso"], h["value"]] for h in sr.held_by(T, "Zed Caller")
                                 if h["col_iso"] == D1]

    # ── R6: both said yes, and the shift actually moves ───────────────────
    off = shift_handoff.offer(T, location=H1, col_iso=D2, from_staff="Eve Gone",
                              to_staff="Ben Left")
    shift_handoff.answer(T, off["id"], side="staff", word="yes")
    # the third consent; the director's own rules are held by test-shift-transfer
    shift_handoff.answer(T, off["id"], side="director", word="yes", by="Dee Direct")
    done = shift_handoff.answer(T, off["id"], side="manager", word="yes")
    sr.forget_estate()
    OUT["swap"] = [done["state"], done.get("why") or "",
                   cellof(H1, "Ben Left", D2), cellof(H1, "Eve Gone", D2)]

    # ── R10: a training approval belongs to ONE house ─────────────────────
    rid = sr.request_id(sr.KIND_IST, H2, "OPEN", D2, "Dee Way", "seed")
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(
            "INSERT INTO asa_shift_requests (id, kind, location, open_row, col_iso, value, "
            "person, state, why) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (rid, sr.KIND_IST, H2, "OPEN", D2, "10A-6P", "Dee Way", sr.NEEDS_TRAINING,
             "no IST for JH"))
        c.commit()
    OUT["training_house"] = sr.request_row(T, rid)["location"]
    OUT["training_other_house"] = refused(
        lambda: sr.approve_training(T, request_id_=rid, by="Alice", word="yes", location=H1))
    OUT["training_own_house"] = sr.approve_training(
        T, request_id_=rid, by="Alice", word="yes", location=H2)["state"]

    # ── one person under two spellings holds one set of commitments ───────
    mary = sr.request_id(sr.KIND_OPEN, H2, "OPEN", D3, "Mary-Ann Smith", "seed")
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(
            "INSERT INTO asa_shift_requests (id, kind, location, open_row, col_iso, value, "
            "person, state, why) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (mary, sr.KIND_OPEN, H2, "OPEN", D3, "8A-4P", "Mary-Ann Smith", sr.APPLIED, ""))
        c.commit()
    OUT["spelling_held"] = sorted({h.get("source") for h in sr.held_by(T, "Mary  Ann Smith")
                                   if h["col_iso"] == D3})
    OUT["spelling_many"] = [h.get("source") for h in sr.held_by_many(T, ["MARY ANN SMITH"])["MARY ANN SMITH"]
                            if h["col_iso"] == D3]
    OUT["spelling_check"] = sr.check_assignment(T, person="Mary Ann Smith", location=H1, col_iso=D3,
                                                value="9A-5P")["code"]
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("DELETE FROM asa_shift_requests WHERE id=%s", (mary,))
        c.commit()

    # ── hours nobody can read are held as the whole day ───────────────────
    setcell(H2, "Ben Left", D3, "TRAINING")
    sr.forget_estate()
    OUT["unread_held"] = [sr.check_assignment(T, person="Ben Left", location=H1, col_iso=D3,
                                              value="9A-5P")["code"],
                          sorted({h.get("source") for h in sr.held_by(T, "Ben Left") if h["col_iso"] == D3})]
    OUT["unread_assigned"] = [sr.check_assignment(T, person="Eve Gone", location=H2, col_iso=D3,
                                                  value="ADMIN")["code"],
                              sr.check_assignment(T, person="Zed Caller", location=H2, col_iso=D3,
                                                  value="ADMIN")["code"],
                              sr.check_assignment(T, person="Eve Gone", location=H2, col_iso=D3,
                                                  value="OFF")["code"]]
    setcell(H2, "Ben Left", D3, "")
    sr.forget_estate()

    # ── the notice, written down on the word the door actually answers ────
    setcell(H2, "OPEN", D1, "8P-12A")
    sr.sweep(T)
    sr.apply_for(T, location=H2, open_row="OPEN", col_iso=D1, person="Dee Way")
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_pool SET opened_at = now() - interval '2 hours' "
                    "WHERE location=%s AND open_row=%s AND col_iso=%s", (H2, "OPEN", D1))
        c.commit()
    mine = [o for o in sr.owed(T) if o["location"] == H2 and o["col_iso"] == D1]
    OUT["owed"] = len(mine)
    OUT["owed_names_the_manager"] = all("to_name" in o for o in mine)
    sr.mark_said(T, [o["id"] for o in mine],
                 {"results": [{"id": o["id"], "state": "told"} for o in mine]})
    OUT["owed_after_told"] = len([o for o in sr.owed(T)
                                  if o["location"] == H2 and o["col_iso"] == D1])

    # ── the overlap law learns time off: every deciding path refuses in its own code ──
    time_off_row("TO00000000C1", "Cy Far", D1, D3, "scheduled", "ABD1711", filed_by="Cy Far",
                 hm_state="approved", dir_state="approved")
    time_off_row("TO00000000A2", "Ann Roe", D3, D3, "pending", "ABD1711", filed_by="Ann Roe")
    TO_HOUSE.sync()
    time_off.forget()
    tspan = sr.span_of(D3, "8A-4P")
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(
            "INSERT INTO asa_shift_pool (location, open_row, col_iso, kind, value, opened_at, "
            "shift_start, shift_end, called_off_by, reason, ref) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (H2, "Time Caller", D3, sr.KIND_CALLOFF, "8A-4P", datetime.now(timezone.utc),
             tspan[0], tspan[1], "Time Caller", "", sr.ref_of(H2, "Time Caller", D3)))
        c.commit()
    tref = sr.ref_of(H2, "Time Caller", D3)
    elig = sr.eligibility(T, location=H2, open_row="Time Caller", col_iso=D3, person="Cy Far")
    OUT["to_apply"] = [elig.get("code"), "on approved time off" in str(elig.get("why")),
                       (elig.get("clash") or {}).get("until"), "ref" in (elig.get("clash") or {})]
    OUT["to_apply_door"] = refused(lambda: sr.apply_for(T, location=H2, open_row="Time Caller", col_iso=D3,
                                                        person="Cy Far"))
    cy = sr.viewer(T, name="Cy Far", role="staff", types="STAFF")
    OUT["to_available"] = tref in {o["ref"] for o in sr.feed(T, who=cy)["available"]}
    OUT["to_pending_free"] = sr.eligibility(T, location=H2, open_row="Time Caller", col_iso=D3,
                                            person="Ann Roe").get("code")
    OUT["to_check"] = sr.check_assignment(T, person="Cy Far", location=H2, col_iso=D3, value="8A-4P")["code"]
    OUT["to_overnight"] = sr.check_assignment(T, person="Cy Far", location=H2, col_iso=today.isoformat(),
                                              value="10P-8A")["code"]
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_pool SET opened_at = now() - interval '6 hours' WHERE open_row='Time Caller'")
        c.commit()
    OUT["to_decide"] = refused(lambda: sr.decide(T, location=H2, open_row="Time Caller", col_iso=D3,
                                                 person="Cy Far", by="Shylah Walker"))
    try:
        pick = shift_handoff.candidates(T, location=H2, col_iso=D1, giver="Ben Left", detail=False)
        pick_hm = shift_handoff.candidates(T, location=H2, col_iso=D1, giver="Ben Left", detail=True)
        OUT["to_picker"] = [next((e["code"] for e in pick["candidates"] if e["name"] == "Cy Far"), None),
                            next((e["why"] for e in pick["candidates"] if e["name"] == "Cy Far"), ""),
                            next((e["code"] for e in pick_hm["candidates"] if e["name"] == "Cy Far"), None)]
    except Exception as exc:
        OUT["to_picker"] = [type(exc).__name__, str(exc)[:200], None]
finally:
    time_off.use_house(None)
    cbh.use_workbook(None)
    OUT["rooms"] = ROOMS.close()
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''


def _with_imports(roots: tuple[str, ...]) -> dict[str, str]:
    """The roots and every server module they import, lazily or not, read from this checkout."""
    local = {p.stem for p in SERVER.glob("*.py")}
    sources: dict[str, str] = {}
    todo = list(roots)
    while todo:
        name = todo.pop()
        if name in sources:
            continue
        sources[name] = (SERVER / f"{name}.py").read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(sources[name])):
            if isinstance(node, ast.Import):
                todo += [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                todo.append(node.module.split(".")[0])
        todo = [n for n in todo if n in local]
    return sources


def _lane_in_container(script_body: str = LANE) -> dict | None:
    """The whole lane, against a real database, in a schema of its own.

    The checkout's modules are shipped in over stdin — exactly as the hotline
    tests do — and the schema is created and dropped inside the run, so nothing
    here can reach a live table and a failure leaves no rows behind.

    Each run imports only from a directory of its own, removed in a `finally`:
    the roots below and every server module they reach are shipped, and the
    container's working directory (the live checkout's server/) is taken off
    the path, so a module the checkout lacks fails the lane instead of loading
    from live. An alarm a minute under the client timeout stops the lane in
    the container first, so no orphan keeps its locks.
    """
    sources = _with_imports(("shift_requests", "shift_handoff", "house_cal_live", "shift_slices",
                             "calendar_builder_slices", "house_directory", "psi_reminders",
                             # the badge follow shift_requests folds every reader's badges with
                             "badge_follows",
                             # the Calendar Builder's one writer, which a decision writes through
                             "calendar_builder_houses", "calendar_builder_write",
                             # the one rule of which published cells still count
                             "effective_roster",
                             # decide() notes a filled call-off for its "covered" follow-up
                             "open_shift_covered",
                             # the one reader of the Call Off Tracker a call-off's story is read from
                             "psi_attendance",
                             # a Builder call-off's own record, which that story reads first
                             "calloff_road"))
    # the declaration the IST settings reader (shipped above as an import) reads beside itself
    sources["ist_config_defaults.json"] = (SERVER / "ist_config_defaults.json").read_text(encoding="utf-8")
    # the helper that makes the lane's tables and refuses a table resolving to public
    sources["lane_schema"] = (HERE.parent / "lane_schema.py").read_text(encoding="utf-8")
    script_body = OWN_THE_LANE + script_body
    here = f"/tmp/shift-requests-test-{os.getpid()}-{int(time.time() * 1000) % 100000}"
    script = (
        "import base64, json, os, pathlib, shutil, signal, sys\n"
        f"SRC = json.loads(base64.b64decode({base64.b64encode(json.dumps(sources).encode())!r}))\n"
        f"d = pathlib.Path({here!r}); d.mkdir(parents=True, exist_ok=True)\n"
        "for k, v in SRC.items(): (d / (k if k.endswith('.json') else k + '.py')).write_text(v)\n"
        # the cwd is the live checkout: a module missing here must not load from there
        "sys.path[:] = [p for p in sys.path if p not in ('', os.getcwd())]\n"
        # a shared fixed path let one branch's run import another branch's modules
        f"LANE_DIR = {here!r}\n"
        f"signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw("
        f"TimeoutError('the lane ran past {LANE_BUDGET_S - 60}s and stopped itself')))\n"
        f"signal.alarm({LANE_BUDGET_S - 60})\n"
        "try:\n"
        + "".join("    " + line + "\n" for line in script_body.splitlines())
        + "finally:\n"
        f"    shutil.rmtree({here!r}, ignore_errors=True)\n")
    try:
        proc = subprocess.run(["docker", "exec", "-i", CONTAINER, "python3", "-"],
                              input=script, capture_output=True, text=True, timeout=LANE_BUDGET_S)
    except FileNotFoundError:
        return None                      # no docker here at all: nothing was run
    except subprocess.TimeoutExpired:
        _lane_broke("the lane did not answer inside "
                    f"{LANE_BUDGET_S}s — it was killed, not skipped", "")
        return None
    for line in (proc.stdout or "").splitlines():
        if line.startswith("LANE_RESULT "):
            return json.loads(line[len("LANE_RESULT "):])
    # only a container that is not running is a skip; any other missing result is a failure
    absent = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER],
                            capture_output=True, text=True).stdout.strip() != "true"
    if absent:
        return None
    _lane_broke("the lane ran in the container and produced no result",
                ((proc.stdout or "") + (proc.stderr or ""))[-1500:])
    return None


LANE_BUDGET_S = 300
_LANE_BROKEN: list[str] = []


def _lane_broke(why: str, detail: str) -> None:
    """A lane that broke is recorded as a FAILURE, never as a skip."""
    _LANE_BROKEN.append(why)
    check(f"THE LANE RAN: {why}", False, detail)


print("\nthe sweep never waits on itself")
_src = (SERVER / "shift_requests.py").read_text(encoding="utf-8")
_sweep = _src[_src.index("def sweep("):_src.index("def call_off_shifts(")]
check("the call-off books are read BEFORE the sweep opens the pool's transaction — they read the "
      "pool's call-offs on a connection of their own, and a lock the sweep held would be waited on "
      "for ever (the lane below ships the attendance reader, so a regression hangs it)",
      0 < _sweep.index("offs = call_off_shifts(") < _sweep.index("with _connect(dsn)")
      and "call_off_shifts(" not in _sweep[_sweep.index("with _connect(dsn)"):])
_ddl_src = _src[_src.index("def _ddl("):_src.index("def _now(")]
check("and the pool's ALTER — an ACCESS EXCLUSIVE lock held to the end of every reader's "
      "transaction — runs only when the column is missing",
      "statement is POOL_REF_DDL" in _ddl_src and "attname = 'ref'" in _ddl_src)


print("\nR1/R3/R5/R10 — the whole lane, against a real database")
lane = _lane_in_container()
if lane is None:
    print("  (no relay container to hold a database here — the lane did not run)"
          if not _LANE_BROKEN else "  THE LANE BROKE — counted as a failure above, never as a skip.")
    print("  NOTE: the pure half above still ran; the ledger half did not.")
else:
    check("every table the lane touches resolves in the lane's own schema before the first read — "
          "the call-off road and the Call Off Tracker included, never public",
          {"asa_calendar_calloff_road", "lane_tracker"} <= set((lane.get("owned") or {}).get("lane") or {})
          and all(str(s).startswith("hub_test_shift_requests_") for s in lane["owned"]["lane"].values()),
          lane.get("owned"))
    check("a house seen for the first time is BACKFILLED — a roster already on "
          "the calendar opens no ten-minute scramble",
          lane["backfilled_closed"] == "closed", lane["backfilled_closed"])
    check("a day published now opens the window",
          lane["window_open"] == "open", lane["window_open"])
    check("R1: somebody who has not worked there in 40 days is refused, by name",
          lane["outsider"] == "not_a_regular", lane["outsider"])
    check("R4: a regular whose hours cross another house's shift is refused",
          lane["overlap"] == "overlap", lane["overlap"])
    check("a regular with no clash applies, and the IST is read for that house",
          lane["applied"] is True and lane["ist_state"] in ("ok", "missing", "owed"), lane)
    check("R10: no IST raises a TRAINING approval the moment the application is made",
          lane["training_raised"] is True, lane)
    check("applying twice is one application, not two votes",
          lane["twice"] is False, lane["twice"])
    check("the applicants list holds the person ONCE — a training row is not an applicant",
          lane["applicants"] == ["Ann Roe"], lane["applicants"])
    check("R5: an OPEN row cannot be handed over at all",
          "open shift cannot be handed over" in str(lane["open_handoff"]), lane["open_handoff"])
    check("R5: nor can a shift be handed to somebody it would cross",
          "already working something" in str(lane["swap_over_application"]),
          lane["swap_over_application"])
    check("R10: the house manager's approval RELEASES the application, in its own place",
          lane["released"] == 1 and lane["after_training"] == [["Ann Roe", "applied"]],
          lane["after_training"])
    check("a window that closed with somebody on it owes the house manager ONE notice",
          lane["closed_state"] == "closed" and lane["owed"] == [["open_shift_applicants", 1]],
          lane["owed"])
    check("and it is never owed twice once the door has said it",
          lane["owed_again"] == [] and lane["owed_after_refusal"] == 0, lane["owed_again"])
    check("R3: two approvals in the same second — exactly one wins",
          lane["won"] == 1 and lane["lost"] == 1, (lane["won"], lane["lost"]))
    check("the claims ledger holds ONE row, which is what makes that true",
          len(lane["ledger"]) == 1, lane["ledger"])
    check("the roster names one person and not two",
          len(lane["roster"]) == 1 and lane["roster"][0][1] == "8A-4P", lane["roster"])
    check("the shift reads filled, and says HOW it was filled",
          lane["filled"] and lane["filled"][0][0] == "filled"
          and lane["filled"][0][2] == "approved", lane["filled"])
    check("the whole company's list carries every kind, settled rows included",
          "open_shift" in lane["feed_kinds"] and "ist_approval" in lane["feed_kinds"],
          lane["feed_kinds"])
    check("and the shift keeps its history — who asked and what became of them",
          any(h[1] == "approved" for h in lane["history"]), lane["history"])
    check("an HM badge reads the whole company; a plain staff badge reads only their own",
          lane["feed_whole"] is True and lane["staff_whole"] is False, lane)
    check("a staff member never sees a call-off's reason, and every row they see is theirs",
          lane["staff_reasons"] is False and lane["staff_rows_all_mine"] is True, lane)
    check("and other people's rows never leave the server at all — not hidden, NOT SENT",
          len(lane["hm_people"]) > 1 and lane["staff_people"] == [sr.fold("Ann Roe")],
          (lane["staff_people"], lane["hm_people"]))
    check("nor does the pool of every house, nor the attendance panels",
          lane["staff_open_shifts"] == 0 and lane["staff_panels"] is False, lane)


print("\nthe rules the doors used to let round — against a real database")
lane2 = None if lane is None else _lane_in_container(LANE2)
if lane2 is None:
    print("  (no relay container to hold a database here — the lane did not run)"
          if not _LANE_BROKEN else "  THE LANE BROKE — counted as a failure above, never as a skip.")
else:
    check("lane 2 owns its tables too: the road and the tracker resolve in its schema, nothing in public",
          {"asa_calendar_calloff_road", "lane_tracker"} <= set((lane2.get("owned") or {}).get("lane") or {})
          and all(str(s).startswith("hub_test_shift_requests_2_") for s in lane2["owned"]["lane"].values()),
          lane2.get("owned"))
    check("the first read of how a call-off was filed finds the lane's empty road and empty tracker — "
          "no Builder record, no URGENT fate, from any production row",
          (lane2.get("road_before") or [None])[0] not in ("builder", "tracker")
          and lane2["road_before"][1:] == [True, False], lane2.get("road_before"))
    check("a house met for the first time puts nothing in the pool",
          lane2["pool_at_birth"] == [], lane2["pool_at_birth"])
    check("R1: an OPEN row written onto a day already stamped still gets its window",
          lane2["late_open_row"] == ["open", True], lane2["late_open_row"])
    check("R1: and a day finished hours after its first shift was typed opens one too — "
          "the ten minutes are not counted from the first cell somebody wrote",
          lane2["drafted_day"] == ["open", True], lane2["drafted_day"])
    check("AN OPEN CELL ON A DAY NOBODY PUBLISHED OPENS NO WINDOW: it is not pooled, so no reserved window "
          "runs from a publish that never happened",
          lane2["unpublished_open"] is True, lane2["unpublished_open"])
    check("…and once the day is stamped it pools, its window opening at the stamp",
          lane2["published_open"] == ["open", True], lane2["published_open"])

    check("the claim door refuses an outsider inside the reserved window (R1)",
          lane2["claim_outsider"] == ["refused", "not_a_regular"], lane2["claim_outsider"])
    old_day = (datetime.now(timezone.utc).astimezone(sr.OHIO).date() - timedelta(days=3)).isoformat()
    check("THE SWEEP REMEMBERS THE DAYS ALREADY WORKED, and never a future one: the grids' past day is kept "
          "per house, their coming days are not",
          lane2["worked_record"] == [["CAN - 48TH (B) - ABD1711", old_day, 5], ["CAN - JH - ABD2704", old_day, 1]],
          lane2["worked_record"])
    check("…and a house whose record begins inside the 28 days refuses with regular_unknown, never "
          "'not a regular' — the house manager decides",
          lane2["regular_unknown"] == ["refused", "regular_unknown"], lane2["regular_unknown"])
    check("and refuses a regular whose hours already cross another house's shift (R4)",
          lane2["claim_overlap"] == ["refused", "overlap"], lane2["claim_overlap"])
    check("and sends an eligible regular to APPLY rather than racing for it (R3)",
          lane2["claim_regular"] == ["refused", "apply_instead"], lane2["claim_regular"])
    check("none of the three wrote a claim — a refusal at that door leaves no ledger row",
          lane2["claims_after_refusals"] == [], lane2["claims_after_refusals"])

    # choosing an applicant is an approval, not an assignment
    check("R3: the application goes in, and the house manager's word is what fills it",
          lane2["applied"] is True and lane2["assigned"] == ["filled", "Ann Roe", "approved"],
          lane2["assigned"])

    check("R4: a person with NO row on that grid is given one in the workbook, and holds "
          "what they were given twice over — the roster at once, and the claims ledger",
          lane2["dee_before"] == [] and lane2["dee_on_no_row"] is True
          and sorted(h[2] for h in lane2["dee_after"]) == ["claim", "roster"], lane2)
    check("so a second, overlapping assignment for the same person is refused — "
          "the hole that needed no race at all",
          lane2["dee_second_overlap"] == ["refused", "overlap"], lane2["dee_second_overlap"])

    check("R9: a call-off's caller reaches the house manager's copy of the list",
          lane2["boss_sees_caller"] is True, lane2["boss_sees_caller"])
    check("and reaches a staff member's copy NOWHERE — not as a name, not as a key, "
          "not as the row the Apply button posts back",
          lane2["staff_sees_caller"] is False, lane2["staff_sees_caller"])
    offer = (lane2["staff_offer"] or [[None, "", ""]])[0]
    check("the shift a staff member is offered is named by its opaque handle",
          len(lane2["staff_offer"]) == 1 and offer[0] == ""
          and offer[1] == offer[2] and str(offer[1]).startswith("SP"), lane2["staff_offer"])
    check("and the handle resolves back to the cell on the SERVER, so Apply still works",
          lane2["ref_resolves"][:1] == ["CAN - 48TH (B) - ABD1711"], lane2["ref_resolves"])

    check("THE WINDOW RUNS TO ITS END: the house manager's decision inside it is refused, and "
          "the shift stays open to applications (rules 1-2)",
          lane2["decide_in_window"] == ["refused", "window_open"]
          and lane2["filled_in_window"] == "", [lane2["decide_in_window"], lane2["filled_in_window"]])
    check("R9: a clash sent to the applicant never carries the pool's row — for a call-off that is "
          "the caller's own name",
          lane2["dee_applies_zed"] is True and "Zed Caller" not in lane2["clash_blob"]
          and '"overlap"' in lane2["clash_blob"] and "open_row" not in lane2["clash_blob"],
          lane2["clash_blob"])
    check("…nor does the applicant's own Requests feed, anywhere in it",
          lane2["staff_feed_zed"] is False, lane2["staff_feed_zed"])
    dv = lane2.get("derived_viewer") or [[], None, None, None]
    check("A CURRENT ** MANAGER WEARS HM BY CODE: the hotline calendar names her, her badge column says "
          "STAFF, and she is answered as HM — for her house, never the whole company",
          "HM" in dv[0] and "STAFF" in dv[0] and dv[1] is False and dv[2] is True
          and dv[3] == ["ABD1711"], dv)
    check("…and on Requests she reads EVERY row of her house — the applications, the caller's name, the "
          "panels, its open shifts — and the other house only as staff: no caller, nobody else's rows",
          lane2.get("derived_feed") == [False, True, ["CAN - 48TH (B) - ABD1711"], True, True, False, False],
          lane2.get("derived_feed"))
    cs = lane2.get("card_staff") or []
    check("THE ROW LEADS WITH ITS FACTS — a staff member's card for a call-off says the house by code, "
          "the shift, its hours and its way to the red square in Calendar Builder, and carries no "
          "caller, no reason and no decision",
          cs[:5] == ["ABD1711", "48TH (B)", "4P-12A", 8.0, True] and cs[5:] == [False, False, False,
                                                                                False, False], cs)
    check("…a house's own manager (HM by code) is told who called off and why, on the card and the row",
          lane2.get("card_manager") == ["Zed Caller", True, "flu"], lane2.get("card_manager"))
    check("…and the badges above read the same, with who manages the house",
          lane2.get("card_boss") == ["Zed Caller", ["Mia Manager"]], lane2.get("card_boss"))
    # H1's calendar draws Dee Way now; nobody draws "Nobody Here"
    check("TIME OFF joins the list cut by the same rule: a member of staff reads their own, a house "
          "manager the people on their houses' calendars, the badges above everybody",
          lane2.get("time_off_staff") == [["Dee Way", True]]
          and lane2.get("time_off_manager") == ["Dee Way", "Eve Gone"]
          and lane2.get("time_off_boss") == ["Dee Way", "Eve Gone", "Nobody Here"],
          [lane2.get("time_off_staff"), lane2.get("time_off_manager"), lane2.get("time_off_boss")])
    check("…a member of staff is never told who took the open shifts around their days off",
          not any(lane2.get("time_off_staff_names") or []), lane2.get("time_off_staff_names"))
    check("…each request says the shifts it touches — a shift still under their name is not covered",
          lane2.get("time_off_eve") == [[True, "4P-12A", True, False]], lane2.get("time_off_eve"))
    check("…and carries its status, both approvals and the way into the Time Off app",
          lane2.get("time_off_decision") == ["Mia Manager, Ty Bond", "scheduled", "upcoming", ["ABD1711"],
                                             "Mia Manager", "Ty Bond",
                                             "/app/timeoff/requests?ref=TO00000000E1"],
          lane2.get("time_off_decision"))
    check("…and says why in words", "approved by the house manager and a director"
          in str(lane2.get("time_off_words")), lane2.get("time_off_words"))
    ta = lane2.get("to_apply") or []
    check("TIME OFF REFUSES ON EVERY PATH: applying for a shift inside scheduled time off is its own code, "
          "the sentence names the days, and the clash carries the last day but never the ref",
          len(ta) == 4 and ta[:2] == ["time_off", True] and bool(ta[2]) and ta[3] is False, ta)
    check("…the apply door (and a YES by text, which is the same door) refuses it",
          (lane2.get("to_apply_door") or [None, None])[:2] == ["refused", "time_off"], lane2.get("to_apply_door"))
    check("…the shift is not offered as available to them",
          lane2.get("to_available") is False, lane2.get("to_available"))
    check("…a request still waiting refuses nothing", lane2.get("to_pending_free") == "ok",
          lane2.get("to_pending_free"))
    check("…an assignment is refused, and an overnight running into the first day off too",
          lane2.get("to_check") == "time_off" and lane2.get("to_overnight") == "time_off",
          [lane2.get("to_check"), lane2.get("to_overnight")])
    check("…the house manager's decision after the window is refused",
          (lane2.get("to_decide") or [None, None])[:2] == ["refused", "time_off"], lane2.get("to_decide"))
    tp = lane2.get("to_picker") or [None, "", None]
    check("…the transfer picker: neutral for staff, the reason for the house's editor",
          tp[0] == "unavailable" and "time off" not in str(tp[1]) and tp[2] == "time_off", tp)
    check("HOW A CALL-OFF WAS FILED: a Call Off Tracker row gives the road, who filed it, when and the "
          "reason typed in the form's column; the URGENT's fate is said to be kept elsewhere, not guessed",
          lane2.get("story_tracker") == ["tracker", "Boyd Bailey", "Mother was in the hospital", True,
                                         True, False], lane2.get("story_tracker"))
    check("…a call-off marked on Calendar Builder is its own record: the Builder road, who pressed it, "
          "the words typed there, and the URGENT OPEN SHIFT sent to 41 people as the door answered",
          lane2.get("story_builder") == ["builder", "Mia Manager", "car broke down", "sent", 41],
          lane2.get("story_builder"))
    check("…or held, when the door wrote rehearsal rows and sent nothing",
          lane2.get("story_held") == "held", lane2.get("story_held"))
    check("…the URGENT is the everyone leg alone: a quiet-hours deferral says deferred, never 'sent to 0'",
          lane2.get("story_deferred") == [True, "deferred", 0, 0, "held by the quiet window"],
          lane2.get("story_deferred"))
    check("…copies redirected to the testers are held, never a send to staff",
          lane2.get("story_testers") == [True, "held", 0, 77,
                                         "0 of 77 reached, 77 rehearsed at the testers"],
          lane2.get("story_testers"))
    check("…a leg that texted nobody is 'not sent' with its own why, whatever the other legs did",
          lane2.get("story_nobody") == [True, "not_sent", 0, 0, "the situation is switched off"],
          lane2.get("story_nobody"))
    check("…and an answer without the URGENT leg is not known, never a sum of the other legs",
          (lane2.get("story_no_leg") or [None])[0] is False
          and (lane2.get("story_no_leg") or [None, None])[1] == "", lane2.get("story_no_leg"))
    check("…and a member of staff's card carries the URGENT's fate and nothing of who, why or where it went",
          lane2.get("story_staff") == [False, "held", False, False], lane2.get("story_staff"))
    check("…a time-off source that cannot be read is said, and the rest of the list still answers",
          lane2.get("time_off_unreadable") == [False, True, [], True], lane2.get("time_off_unreadable"))
    check("THE PANEL, for a member of staff: no caller, their own application only, no manager's diary, "
          "no list of names — and the count of who is free for it",
          lane2.get("detail_staff") == [False, ["Dee Way"], False, False, True], lane2.get("detail_staff"))
    db = lane2.get("detail_boss") or [[], [], [], None]
    check("…for the badges above: every applicant weighed for that house (IST, a regular or not, the "
          "overlap), whether the manager is free then, and never the caller among who may apply",
          db[0] == ["Dee Way"] and {"ist", "regular", "overlap", "week_hours", "live"} <= set(db[1])
          and db[2] == ["Mia Manager"] and db[3] is False, db)
    check("…and a shift on none of the reader's lists is refused in words, as is one no longer pooled",
          lane2.get("detail_not_yours") == ["refused", "not_yours"]
          and lane2.get("detail_no_ref") == ["refused", "no_such_shift"],
          [lane2.get("detail_not_yours"), lane2.get("detail_no_ref")])
    check("R9: the pool's handle is keyed — not a plain hash of the house, the caller's row and the "
          "day, which any member of staff could recompute from the grid",
          lane2["ref_is_keyed"] == [True, True], lane2["ref_is_keyed"])
    check("a decision for a name on no roster and no staff list is refused: no new row in the workbook, "
          "the shift still open",
          lane2.get("phantom") == [["refused", "not_on_a_grid"], 0, None, ""], lane2.get("phantom"))
    check("R6: a member of staff's call-off row carries their own application only — not who else "
          "applied, not who was given it, not who decided — and a count of the rest",
          lane2["staff_call_off_row"] == ["", "", ["Dee Way"], 0], lane2["staff_call_off_row"])
    check("…and the application passed over says so without naming who was chosen",
          lane2["passed_over_why"] == ["the house manager gave the shift to somebody else"],
          lane2["passed_over_why"])
    check("filling a called-off shift EMPTIES the caller's cell — one shift, one person",
          lane2["caller_cell"] == "" and lane2["taker_cell"] == "4P-12A",
          [lane2["caller_cell"], lane2["taker_cell"]])
    check("so the caller stops holding hours they told us they cannot work",
          lane2["caller_holds_before"] and lane2["caller_holds_after"] == [],
          [lane2["caller_holds_before"], lane2["caller_holds_after"]])

    check("R6: a swap both people and the house manager agreed to actually MOVES the shift",
          lane2["swap"][0] == "done", lane2["swap"])
    check("onto the receiver's row, and off the giver's",
          lane2["swap"][2] == "4P-12A" and lane2["swap"][3] == "", lane2["swap"])

    check("R10: a training approval belongs to the house on the ROW",
          lane2["training_house"] == "CAN - JH - ABD2704", lane2["training_house"])
    check("and another house's manager cannot take it on by naming their own",
          lane2["training_other_house"] == ["refused", "no_such_approval"],
          lane2["training_other_house"])
    check("ONE PERSON, ONE NAME KEY: an application filed as 'Mary-Ann Smith' is held by 'Mary  Ann Smith' and "
          "by 'MARY ANN SMITH', and it blocks an overlapping assignment under either spelling",
          lane2["spelling_held"] == ["application"] and lane2["spelling_many"] == ["application"]
          and lane2["spelling_check"] == "overlap",
          [lane2["spelling_held"], lane2["spelling_many"], lane2["spelling_check"]])
    check("HOURS NOBODY CAN READ ARE NOT FREE TIME: a working cell with no readable hours holds its whole day, "
          "so an assignment beside it is refused as unreadable, never double-booked",
          lane2["unread_held"] == ["unreadable_hours", ["unreadable"]], lane2["unread_held"])
    check("…a value being assigned with no readable hours is refused beside anything else that day, passes "
          "a free day, and an OFF holds nothing",
          lane2["unread_assigned"] == ["unreadable_hours", "not_a_shift", "not_a_shift"],
          lane2["unread_assigned"])
    check("while its own house's does",
          lane2["training_own_house"] == "approved", lane2["training_own_house"])

    check("a window that closed with somebody on it owes the manager a notice, "
          "carrying the manager's own name",
          lane2["owed"] == 1 and lane2["owed_names_the_manager"] is True, lane2["owed"])
    check("and `told` — which is what the door answers when a text goes — closes it, "
          "so it is not offered again every minute",
          lane2["owed_after_told"] == 0, lane2["owed_after_told"])


print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
