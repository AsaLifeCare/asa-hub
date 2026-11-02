#!/usr/bin/env python3
"""
THE CLOCK'S STRATEGY, THE PUNCH BOARD AND RULE 13, asserted offline.

WHAT IT PROVES.
  strategy   one wire (never two requests at once, a breath between), DOWN
             exactly as the rule defines it — a failed read AND a failed
             login right after it — holding every request until its health
             retry (on disk, across a restart, logins included, the refusal
             latch untouched), the retry asking the no-credential probe first
             and the first read that lands being UP; a timeout alone pausing
             nothing,
             the session kept across collections and signed in again only
             once when the service will not take it, and STALE a whole day
  board      every verdict a shift can carry — on time, late, no punch yet,
             no punch, told by a human, not known to the clock, upcoming,
             clock not read — plus the punches no shift claimed, the midnight
             cut stitched into one night, and the early clock-in
  rule 13    the reminder five minutes before, the "not logged in" every
             half hour only after a check that found nothing, the calendar
             when the clock cannot be read, the reply that stops it (inbox
             files, gzipped ones too), the quiet window and its 08:00, the
             house manager told once of an early clock-in, and the ledger that
             says nothing twice across a restart
  JSON first the entry history (idempotent by Single_Entry_ID, rounds gzipped,
             no client field kept), the punch board slice's allow-list, and the
             punch house feed's union of the stored copy and the live reads
  the flow   the shift flow: the ask at T-30 and every ten minutes,
             a punch or any reply stopping it, YES then the five-minute
             reminder, NO to the house manager at once, no reply and no punch
             by T+30 to the house manager (on a read made after the deadline,
             the lane collecting for it; from the calendar saying the clock
             could not be checked), "not logged in" only after that or to a
             YES, the quiet window at 21:30 / 21:31 / 08:00, the late call,
             the reply words, the dial's words from the door, and rule 8's
             Daily Note series (merged per person, capped, stopped by a note)
  review     one regression per finding of the review, numbered as it was:
             the follow-up purses, "sign in once more, then stop" across
             collections and the backoff, the Desk holding the words, the
             probe's login on the wire, a read the history could not keep, the
             08:00 read, "not now" from the door, the late line, the spacing
             across a switch to the calendar, the names the clock does not
             know, the weekly re-verification, an entry that ended before the
             start, and the wording that called PsiAnywhere retired
  flow       the shift flow's own review, one regression per finding (R1-R19):
  review     the reply heard while the door is still sending, a late call only
             from a row tied to the caller by name, a note under the name as
             spoken, refusals and "running late" in words, a NO held overnight
             still told, a Late Show typed hours in, the 22:00 ask's lead, the
             urgent rows first, the per-person note ceiling, no calendar
             no-show after the end, no collections the dial holds, the Desk's
             call-offs from the book (its own TSX predicate, run in node),
             "told" meaning told, `dial_unknown`, rehearsal-only no-shows, and
             the note reminders after a calendar no-show

HOW IT STAYS OFFLINE. The service is pointed at a name that resolves nowhere,
`urlopen` and the lane's own `_call` are replaced by functions that fail the
test, and a fake answers only where a check installs one. Every file lives in a
temporary directory. PsiAnywhere is never contacted.

    python3 tools/test-psi-reminders.py
"""
import gzip
import hashlib
import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
SERVER = HERE.parent.parent / "server"
TMP = Path(tempfile.mkdtemp(prefix="psi-reminders-"))
SECRET = TMP / "psianywhere.json"
os.environ.update({
    "HUB_PSI_BASE": "https://psianywhere.invalid",
    "HUB_PSI_SECRET_FILE": str(SECRET),
    # never the seal mount's Ty file: the Ty half is armed only where a check arms it
    "HUB_PSI_TY_SECRET_FILE": str(TMP / "psianywhere-ty.json"),
    "HUB_PSI_ATTENDANCE_STATE": str(TMP / "state.json"),
    "HUB_PSI_LOGIN_CLOCK_FILE": str(TMP / "login-clock.json"),
    "HUB_SNAPSHOT_OUT": str(TMP),
    "HUB_PSI_WIRE_GAP_S": "0.05",
})
sys.path.insert(0, str(SERVER))


def _no_network(*_a, **_k):
    raise AssertionError("the test tried to reach the network")


urllib.request.urlopen = _no_network

import psi_anywhere as psi  # noqa: E402
import psi_attendance as pa  # noqa: E402
import psi_entries as pe  # noqa: E402
import psi_punches_feed as feed  # noqa: E402
import psi_reminders as pr  # noqa: E402
import punch_board_slices as pbs  # noqa: E402

pa._call = _no_network
OHIO, UTC = pa.OHIO, timezone.utc
results = {"ok": 0, "failed": []}


def check(name, cond, detail=""):
    if cond:
        results["ok"] += 1
        print(f"ok   {name}")
    else:
        results["failed"].append(name)
        print(f"FAIL {name}{(' — ' + str(detail)[:500]) if detail else ''}")


def at(day, hhmm):
    h, m = hhmm.split(":")
    return datetime(day.year, day.month, day.day, int(h), int(m), tzinfo=OHIO).astimezone(UTC)


DAY = date(2026, 9, 22)
YDAY = DAY - timedelta(days=1)
TOKEN = ('<results><permissions><window_name>Token</window_name>'
         '<permission></permission><special_data>ABC123</special_data></permissions></results>')
TOKEN2 = TOKEN.replace("ABC123", "XYZ789")


def write_secret(password="p"):
    SECRET.write_text(json.dumps({"user": "someone", "pass": password}), encoding="utf-8")


# ── 1 · the one wire ───────────────────────────────────────────────────────
psi.forget_login()
live = {"n": 0, "max": 0, "starts": []}
guard = threading.Lock()


def slow(method, body, timeout):
    with guard:
        live["n"] += 1
        live["max"] = max(live["max"], live["n"])
        live["starts"].append(time.monotonic())
    time.sleep(0.03)
    with guard:
        live["n"] -= 1
    return []


pa._call = slow
threads = [threading.Thread(target=pa._ask, args=("x", {}, 1)) for _ in range(4)]
for t in threads:
    t.start()
for t in threads:
    t.join()
gaps = [b - a for a, b in zip(sorted(live["starts"]), sorted(live["starts"])[1:])]
check("the one wire: four requests at once are four requests one after another",
      live["max"] == 1 and len(live["starts"]) == 4, live)
check("and each one waits the breath after the one before it",
      all(g >= 0.07 for g in gaps), gaps)

# ── 2 · DOWN, and only DOWN, holds every request ───────────────────────────
# PSI is broken only from the moment a GET fails through the login AND the
# login itself then fails; the lane goes back to it from time to time, and a
# 200 means it is up again. A timeout alone pauses
# nothing any more — it is what sends the login that decides (section 8).


def raiser(exc):
    def _r(method, body, timeout):
        raise exc
    return _r


psi.forget_login()
pa._call = raiser(socket.timeout("timed out"))
try:
    pa._ask("getSingleEntrySupervisorsJSON", {"token": "t"}, 1)
    check("a timeout is a transport failure", False)
except pa.PsiTransport:
    check("a timeout is a transport failure", True)
check("DOWN: a timeout alone pauses nothing — DOWN needs the login right after it to fail too",
      not psi.paused()[0] and psi.down_state() is None, psi.paused())
psi.mark_down("a test outage")
held, why = psi.paused()
left = psi.down_state()["retry_at"] - time.time()
check("DOWN holds every request until the health retry, PSI_DOWN_RETRY_S on",
      held and psi.PSI_DOWN_RETRY_S - 100 < left <= psi.PSI_DOWN_RETRY_S and "down since" in why,
      (held, left, why))
pa._call = _no_network
try:
    pa._ask("getSingleEntrySupervisorsJSON", {"token": "t"}, 1)
    check("while DOWN, nothing is sent", False)
except pa.PsiPaused:
    check("while DOWN, nothing is sent", True)
check("DOWN holds the login too — the probe's third rung included",
      not psi.login_would_allow()[0] and "down" in psi.login_would_allow()[1])
check("DOWN is not the account's refusal — the latch is untouched",
      psi.login_snapshot()["refused"] is None)
psi._login_state.update({"down": None})
psi._login_load()
check("DOWN is on disk and a restart comes back down", psi.paused()[0] and psi.down_state())
check("at the health retry the wire is open again — and it is still DOWN until a read lands",
      not psi.paused(time.time() + psi.PSI_DOWN_RETRY_S + 1)[0]
      and psi.down_retry_due(time.time() + psi.PSI_DOWN_RETRY_S + 1) and psi.down_state())
since = psi.down_state()["since"]
psi.mark_down("still out")
check("a retry that proves nothing keeps `since` and moves the retry on",
      psi.down_state()["since"] == since and psi.down_state()["retries"] == 1)
check("the first read that lands is UP again", psi.mark_up("a read") and psi.down_state() is None
      and not psi.paused()[0])
psi.forget_login()
pa._call = raiser(urllib.error.HTTPError("https://psianywhere.invalid", 503, "unavailable", {}, None))
try:
    pa._ask("singleEntryFilterAdminListJSON", {}, 1)
    check("a 5xx is a transport failure, and pauses nothing by itself", False)
except pa.PsiTransport:
    check("a 5xx is a transport failure, and pauses nothing by itself", not psi.paused()[0])
psi.forget_login()
pa._call = raiser(urllib.error.HTTPError("https://psianywhere.invalid", 401, "no", {}, None))
try:
    pa._ask("getSingleEntrySupervisorsJSON", {}, 1)
    check("a 4xx is an answer we cannot use, not an outage", False)
except pa.PsiAnswer:
    check("a 4xx is an answer we cannot use, not an outage", not psi.paused()[0])
psi.forget_login()
pa._call = _no_network

# ── 3 · the board, pure ────────────────────────────────────────────────────


def shift(name, hhmm, day=DAY, hours=8, house="H1"):
    s_at = at(day, hhmm)
    return {"person_key": pa.flat_key(name), "keys": pa.person_keys(name), "name": name, "house": house,
            "shift_code": hhmm, "shift_date": day, "shift_at": s_at, "shift_end": s_at + timedelta(hours=hours)}


def entry(eid, name, day, start, end="", **extra):
    first, last = name.split(" ", 1)
    row = {"Single_Entry_ID": str(eid), "firstname": first, "lastname": last,
           "Date_of_Service": f"{day.month}/{day.day}/{day.year} 12:00:00 AM",
           "start_time": start, "end_time": end, "check_hours": "8.00", "Anywhere_status": "P",
           "WCCode": "HPC", "peopleId": str(400 + eid % 100),
           # THE CLIENT'S HALF, which no record of ours may keep
           "Location_Name": "123 Client Street", "latitude": "41.08", "longitude": "-81.51",
           "comments": "free prose", "_consumers": "A Client", "Number_Consumers_Present": 1}
    row.update(extra)
    return row


ENTRIES = [
    entry(1001, "Ann Early", DAY, "07:30:00"),
    entry(1002, "Cy Missing", YDAY, "08:00:00", "16:00:00"),
    entry(1003, "Liz Late", DAY, "08:40:00"),
    entry(1004, "Tom Called", YDAY, "08:00:00", "16:00:00"),
    entry(1005, "Nia Night", YDAY, "21:58:00", "23:59:59"),
    entry(1006, "Nia Night", DAY, "00:00:00", "06:30:00"),
    entry(1007, "Zed Extra", DAY, "06:00:00", "07:00:00"),
    entry(1008, "Pat Ten", DAY, "09:58:00"),
    entry(1009, "Hal Later", YDAY, "14:00:00", "22:00:00"),
]
ROSTER = [shift("Nia Night", "22:00", day=YDAY, hours=10), shift("Ann Early", "08:00"),
          shift("Cy Missing", "08:00"), shift("Gus Unknown", "08:00"), shift("Liz Late", "08:00"),
          shift("Tom Called", "08:00"), shift("Pat Ten", "10:00"), shift("Hal Later", "14:00")]
OFFS = {k: [{"day": DAY, "spread": 0, "source": "tracker"}] for k in pa.person_keys("Tom Called")}


def keyed(*names):
    return set().union(*(pa.person_keys(n) for n in names))


index, _ = pa.punch_index([e for e in ENTRIES if e["Single_Entry_ID"] != "1008"])
b = pa.board(ROSTER, index, keyed("Ann Early", "Cy Missing", "Liz Late", "Tom Called", "Nia Night"),
             OFFS, [], at(DAY, "09:20"), at(DAY, "09:20"), (YDAY, DAY))
by = {(r["person"], r["row_kind"]): r for r in b["rows"]}
V = lambda name: (by.get((name, "shift")) or {}).get("verdict")  # noqa: E731
check("board: an early clock-in is on time, with the minutes it was early",
      V("Ann Early") == "punched_on_time" and by[("Ann Early", "shift")]["early_minutes"] == 30
      and by[("Ann Early", "shift")]["arrived"] == "07:30", by.get(("Ann Early", "shift")))
check("board: a late punch is late, with the minutes the clock measured",
      V("Liz Late") == "late" and by[("Liz Late", "shift")]["minutes"] == 40)
check("board: a known person with no punch an hour in, after a real read, is no punch — and says when it looked",
      V("Cy Missing") == "no_punch" and by[("Cy Missing", "shift")]["checked_at"].startswith("2026-09-22T09:20"))
check("board: somebody the clock has never seen is listed, never called absent", V("Gus Unknown") == "not_known_to_clock")
check("board: a call-off on the day is a human's to tell, with the book it came from",
      V("Tom Called") == "told_by_a_human" and by[("Tom Called", "shift")]["told_source"] == "tracker")
check("board: a shift not begun is upcoming", V("Pat Ten") == "upcoming" and V("Hal Later") == "upcoming")
check("board: the night cut at midnight is ONE punch — the 22:00 shift is on time the next morning, and the "
      "00:00 half is not a punch of its own",
      V("Nia Night") == "punched_on_time"
      and not any(r["entry_id"] == "1006" for r in b["rows"] if r["row_kind"] == "punch"), by.get(("Nia Night", "shift")))
check("board: a punch no shift claimed is listed as such",
      (by.get(("Zed Extra", "punch")) or {}).get("verdict") == "punch_without_shift"
      and by[("Zed Extra", "punch")]["arrived"] == "06:00")
early = pa.board([shift("Cy Missing", "08:00")], index, keyed("Cy Missing"), {}, [], at(DAY, "09:20"),
                 at(DAY, "07:59"), (DAY,))
check("board: a read from before the start is NOT a missing punch — the clock was not read",
      [r["verdict"] for r in early["rows"] if r["row_kind"] == "shift"] == ["clock_not_read"])
none = pa.board([shift("Cy Missing", "08:00")], {}, set(), {}, [], at(DAY, "09:20"), None, (DAY,))
check("board: a clock never read renders as not read, never as did not punch",
      [r["verdict"] for r in none["rows"]] == ["clock_not_read"])
soon = pa.board([shift("Cy Missing", "08:00")], {}, keyed("Cy Missing"), {}, [], at(DAY, "08:35"),
                at(DAY, "08:30"), (DAY,))
check("board: half an hour in, no punch is 'no punch yet'",
      [r["verdict"] for r in soon["rows"]] == ["no_punch_yet"])
double_idx, _ = pa.punch_index([entry(1, "Dee Double", DAY, "07:55:00")])
dd = pa.board([shift("Dee Double", "08:00"), shift("Dee Double", "16:00")], double_idx, keyed("Dee Double"),
              {}, [], at(DAY, "16:30"), at(DAY, "16:30"), (DAY,))
check("board: an entry running through a double is the first shift's early-or-not and never the second's "
      "early clock-in", [r["early_minutes"] for r in dd["rows"]] == [None, None]
      and [r["verdict"] for r in dd["rows"]] == ["punched_on_time", "punched_on_time"], dd["rows"])

# ── 4 · STALE is a whole day ───────────────────────────────────────────────
check("STALE is a day", pa.STALE_AFTER_MIN == 1440)
pa._S.clear()
pa._S.update({"judged": {}, "seen": {}, "pending": [], "last_done": "", "post_after": 0.0,
              "session": {}, "clock": {}, "read_at": ""})
pa._CACHE["shifts"] = [shift("Old One", "08:00", day=YDAY), shift("Older One", "06:00", day=YDAY)]
names = [s["name"] for s in pa._unjudged(at(DAY, "07:00"))]
check("a shift 23 hours old is still open; one 25 hours old is not", names == ["Old One"], names)
pa._S.clear()

# ── 5 · rule 13, pure ──────────────────────────────────────────────────────


def srow(name, hhmm, day=DAY, verdict="upcoming", checked=None, early=None, told="", hours=8):
    s = shift(name, hhmm, day=day, hours=hours)
    return {"row_kind": "shift", "id": pa.shift_id(s), "person": name, "person_key": s["person_key"],
            "house": "H1", "shift_code": hhmm, "day": day.isoformat(),
            "shift_at": s["shift_at"].astimezone(OHIO).isoformat(),
            "shift_end": s["shift_end"].astimezone(OHIO).isoformat(), "verdict": verdict,
            "checked_at": checked.astimezone(OHIO).isoformat() if checked else "",
            "early_minutes": early, "arrived": "07:30" if early else "", "told_source": told}


def kinds(got, where="due"):
    return sorted((r["kind"], r["person"], r.get("occasion", "")) for r in got[where])


P = lambda rows, now, mode="psi", ledger=None, stopped=None, answers=None: pr.plan(  # noqa: E731
    rows, mode=mode, now=now, ledger=ledger or {}, stopped=stopped or {}, answers=answers or {})


def YES(rows):
    """Every shift answered YES — rule 13's own mechanics, behind the ask."""
    return {r["id"]: {"word": "yes", "at": "2026-09-22T00:00:00Z"} for r in rows}


PY = lambda rows, now, mode="psi", ledger=None, stopped=None: P(  # noqa: E731
    rows, now, mode=mode, ledger=ledger, stopped=stopped, answers=YES(rows))
ten = [srow("Pat Ten", "10:00")]
check("T-5: five minutes before the start, the reminder is due — to a YES",
      kinds(PY(ten, at(DAY, "09:55"))) == [("login_before", "Pat Ten", "T-5")])
check("T-5: not six minutes before", not PY(ten, at(DAY, "09:54"))["due"])
check("T-5: never once the start is ten minutes gone — the missing flow owns it", not PY(ten, at(DAY, "10:10"))["due"])
check("T-5: nobody a human wrote about", not P([srow("Pat Ten", "10:00", told="tracker")], at(DAY, "09:55"))["due"])
check("T-5: nobody already on the clock", not P([srow("Pat Ten", "10:00", verdict="punched_on_time")], at(DAY, "09:55"))["due"])
check("T-5: goes from the roster when the clock cannot be read (the calendar)",
      kinds(PY(ten, at(DAY, "09:55"), mode="calendar")) == [("login_before", "Pat Ten", "T-5")])
miss = [srow("Cy Missing", "08:00", verdict="no_punch", checked=at(DAY, "09:20"))]
check("not logged in: after a check that found nothing, for that check's half hour",
      kinds(PY(miss, at(DAY, "09:21"))) == [("login_missing", "Cy Missing", "k2")])
check("not logged in: never on a check older than twenty minutes", not PY(miss, at(DAY, "09:45"))["due"])
# THE E-MAIL RIDES THE FIRST ASK A READ OF THE CLOCK BACKS, AND NO OTHER.
first = PY(miss, at(DAY, "09:21"))["due"][0]
k1 = pr.occasion_key("login_missing", first["person_key"], at(DAY, "08:00").strftime("%Y-%m-%dT%H:%M:%SZ"), "k1")
again = PY([srow("Cy Missing", "08:00", verdict="no_punch", checked=at(DAY, "09:50"))], at(DAY, "09:51"),
           ledger={k1: {"state": "told", "at": pr._utc_iso(at(DAY, "09:00"))}})["due"]
cal_first = PY([srow("Pat Ten", "10:00", verdict="clock_not_read")], at(DAY, "10:31"), mode="calendar")["due"][0]
check("PPLV-03: the first check-backed \"not logged in\" about a shift asks for the e-mail",
      first["kind"] == "login_missing" and first["checked"] is True and first["mail"] is True, first)
check("PPLV-03: a repeat about the same shift is a text alone",
      [r["mail"] for r in again if r["kind"] == "login_missing"] == [False], again)
check("PPLV-03: and an ask from the calendar, with the clock not read, is never mailed — its words could "
      "not say the clock was read", cal_first["checked"] is False and cal_first["mail"] is False, cal_first)
check("not logged in: never without a check — a clock not read, or a person it does not know",
      not PY([srow("Cy Missing", "08:00", verdict="clock_not_read")], at(DAY, "09:21"))["due"]
      and not PY([srow("Gus Unknown", "08:00", verdict="not_known_to_clock")], at(DAY, "09:21"))["due"])
cal = [srow("Pat Ten", "10:00", verdict="clock_not_read")]
check("the calendar: every half hour from the start, no check behind it, and it says so",
      kinds(PY(cal, at(DAY, "10:31"), mode="calendar")) == [("login_missing", "Pat Ten", "k1")]
      and PY(cal, at(DAY, "10:31"), mode="calendar")["due"][0]["checked"] is False
      and not PY(cal, at(DAY, "10:20"), mode="calendar")["due"])
check("the cap: nothing a day after the start",
      not PY(cal, at(DAY, "10:00") + timedelta(hours=24, minutes=1), mode="calendar")["due"])
check("and nothing more than an hour after the shift itself ended (10:00-18:00: 18:59 yes, 19:01 no)",
      PY(cal, at(DAY, "18:59"), mode="calendar")["due"] and not PY(cal, at(DAY, "19:01"), mode="calendar")["due"])
sid = pa.shift_id(shift("Pat Ten", "10:00"))
check("a shift whose person replied is not followed up", not PY(cal, at(DAY, "10:31"), mode="calendar",
                                                                stopped={sid: {"why": "replied"}})["due"])
key = pr.occasion_key("login_missing", "patten", at(DAY, "10:00").strftime("%Y-%m-%dT%H:%M:%SZ"), "k1")
check("an occasion already answered is not planned again",
      not PY(cal, at(DAY, "10:31"), mode="calendar", ledger={key: {"state": "told"}})["due"])
ann = [srow("Ann Early", "08:00", verdict="punched_on_time", early=30)]
check("early clock-in: the house manager is told, with the minutes and the time",
      kinds(P(ann, at(DAY, "09:21"))) == [("early_in", "Ann Early", "early")]
      and P(ann, at(DAY, "09:21"))["due"][0]["minutes"] == 30 and P(ann, at(DAY, "09:21"))["due"][0]["arrived"] == "07:30")
check("early clock-in: only from a read of the clock, never from the calendar",
      not P(ann, at(DAY, "09:21"), mode="calendar")["due"])
ned = [srow("Ned Night", "22:00", verdict="upcoming", hours=10)]
q = PY(ned, at(DAY, "21:55"))
check("the quiet window: the reminder before a 22:00 shift is HELD, never sent at 21:55",
      not q["due"] and kinds(q, "held") == [("login_before", "Ned Night", "T-5")] and q["quiet"])
ned_missing = [srow("Ned Night", "22:00", verdict="no_punch", checked=at(DAY, "23:20"), hours=10)]
check("the quiet window: a check at 23:20 that found nothing is held too",
      not PY(ned_missing, at(DAY, "23:21"))["due"])
check("and no row this lane plans claims a way past the window — not even for a shift under way",
      not any(r.get("quiet_exempt") for r in PY(ned_missing, at(DAY, "23:21"))["held"])
      and not hasattr(pr, "HAPPENING_NOW") and not hasattr(pr, "PIERCING_KINDS"))
check("and the post holds every row inside the window, whatever the row says",
      "quiet_exempt" not in pr.pending.__code__.co_names
      and "quiet_exempt" not in pr.pending.__code__.co_consts)
morning = [srow("Ned Night", "22:00", verdict="no_punch", checked=at(DAY + timedelta(days=1), "08:00"), hours=10)]
m = PY(morning, at(DAY + timedelta(days=1), "08:00"))
check("the quiet window: at 08:00 the re-check that still finds nothing says 'not logged in' — and the "
      "reminder before the shift is gone for good",
      kinds(m) == [("login_missing", "Ned Night", "k20")], kinds(m))
check("the quiet window: at 08:00 a person who clocked in overnight gets nothing",
      not P([srow("Ned Night", "22:00", verdict="late", hours=10)], at(DAY + timedelta(days=1), "08:00"))["due"])
check("the quiet window: 21:31 to 07:59 New York time is silent — 21:30 itself (to its last second) is not",
      pr.quiet(at(DAY, "21:31")) and pr.quiet(at(DAY, "07:59")) and not pr.quiet(at(DAY, "08:00"))
      and not pr.quiet(at(DAY, "21:30")) and not pr.quiet(at(DAY, "21:30") + timedelta(seconds=59))
      and not pr.quiet(at(DAY, "21:29")) and pr.quiet(at(DAY, "03:00")))
check("the quiet window ends at the next 08:00",
      pr.quiet_ends(at(DAY, "23:50")) == at(DAY + timedelta(days=1), "08:00")
      and pr.quiet_ends(at(DAY, "03:00")) == at(DAY, "08:00") and pr.quiet_ends(at(DAY, "12:00")) == at(DAY, "12:00"))
pa._S.clear()
pa._S.update({"judged": {}, "seen": {}, "pending": [], "last_done": "", "post_after": 0.0,
              "session": {}, "clock": {}, "read_at": ""})
pa._BOARD["rows"] = ned_missing
fu = pa._follow_up_at(at(DAY, "23:21"), at(DAY, "23:20"))
check("the follow-up collection never lands inside the quiet window — the next one is 08:00",
      fu == at(DAY + timedelta(days=1), "08:00"), fu)
pa._BOARD["rows"] = [srow("Cy Missing", "08:00", verdict="no_punch", checked=at(DAY, "09:20"))]
check("the follow-up collection is thirty minutes after the last while somebody is missing",
      pa._follow_up_at(at(DAY, "09:21"), at(DAY, "09:20")) == at(DAY, "09:50"))
pa._BOARD["rows"] = [srow("Cy Missing", "08:00", verdict="late")]
check("and there is none once nobody is missing", pa._follow_up_at(at(DAY, "09:21"), at(DAY, "09:20")) is None)
pa._BOARD.update({"at": 0.0, "rows": [], "status": {}})
pa._S.clear()
check("the phone is kept as a hash, the door's own: sha256 of the last ten digits, sixteen characters",
      pr.phone_key("+1 (330) 555-0101") == hashlib.sha256(b"3305550101").hexdigest()[:16]
      and pr.phone_key("555") == "")

# ── 6 · the history: JSON first ────────────────────────────────────────────
real_dir = pe.ENTRY_DIR
pe.ENTRY_DIR = TMP / "pe-unit"
c1 = pe.upsert(ENTRIES[:3], at(DAY, "09:00"))
c2 = pe.upsert(ENTRIES[:3], at(DAY, "09:30"))
changed = dict(ENTRIES[2], end_time="16:00:00")
c3 = pe.upsert([changed, {"firstname": "No", "lastname": "Key"}], at(DAY, "16:10"))
check("history: a read is idempotent by Single_Entry_ID", c1["added"] == 3 and c2 == {"added": 0, "changed": 0,
                                                                                       "same": 3, "keyless": 0}, (c1, c2))
check("history: an entry read again closed replaces its fields; one with no id is counted, never kept",
      c3["changed"] == 1 and c3["keyless"] == 1 and len(pe.load()) == 3, c3)
raw = (pe.ENTRY_DIR / "current.json").read_text()
check("history: no client field is ever kept — not the place, the coordinates, the clients or the prose",
      all(w not in raw for w in ("Location_Name", "123 Client Street", "latitude", "_consumers", "comments",
                                 "Number_Consumers_Present")), raw[:200])
check("history: when an entry last said something new is kept apart from when it was last seen",
      pe.load()["1001"]["changed_at"] == "2026-09-22T13:00:00Z" and pe.load()["1001"]["last_seen"] == "2026-09-22T13:30:00Z")
old = entry(900, "Old Timer", DAY - timedelta(days=10), "08:00:00", "16:00:00")
pe.upsert([old], at(DAY, "16:20"))
rounds = list(pe.ENTRY_DIR.glob("round-*.json.gz"))
check("history: an entry past the kept days leaves current.json for a gzipped round",
      len(rounds) == 1 and "900" not in pe.load()
      and "900" in json.loads(gzip.decompress(rounds[0].read_bytes()))["entries"], rounds)
check("history: every entry ever kept is still one read away", set(pe.everything()) == {"1001", "1002", "1003", "900"})
check("history: the kept days only, for the board", [e["Single_Entry_ID"] for e in pe.between(DAY, DAY)] in
      (["1001", "1003"], ["1003", "1001"]))

# ── 7 · the punch house: the stored copy and the live reads, one record ────
live_rows = [feed.project_live(v) for v in pe.everything().values()]
ann_row = next(r for r in live_rows if r["single_entry_id"] == "1001")
check("feed: a live entry reads in the stored copy's own spellings",
      ann_row["employee"] == "Ann Early" and ann_row["date_service"] == "09/22/2026"
      and ann_row["start_time"] == "07:30:00 AM" and ann_row["end_time"] == "" and ann_row["hours"] == "8.00"
      and ann_row["source"] == feed.LIVE_SOURCE and ann_row["status"] == "P", ann_row)
check("feed: the live row carries the same columns as the house, and no others",
      all(sorted(r) == sorted(feed.FIELDS) for r in live_rows))
stored = {k: "" for k in feed.FIELDS}
stored.update(single_entry_id="1001", employee="Ann Early", has_signature="true", source=feed.SOURCE,
              end_time="03:30:00 PM")
merged = feed.union([stored], live_rows)
m1 = next(r for r in merged if r["single_entry_id"] == "1001")
check("feed: one entry is one row whichever source saw it; the live read wins, the stored flag stands",
      len([r for r in merged if r["single_entry_id"] == "1001"]) == 1 and m1["source"] == feed.LIVE_SOURCE
      and m1["has_signature"] == "true" and m1["start_time"] == "07:30:00 AM", m1)
check("feed: ordered numerically whatever the width of the key",
      [r["single_entry_id"] for r in merged] == ["900", "1001", "1002", "1003"], [r["single_entry_id"] for r in merged])
prints = feed.fingerprints(merged)
bumped = [dict(r, end_time="05:00:00 PM") if r["single_entry_id"] == "1002" else r for r in merged]
check("feed: after the house holds the record, only the rows that changed cross",
      [r["single_entry_id"] for r in feed.changed_rows(bumped, prints)] == ["1002"]
      and len(feed.changed_rows(bumped, {})) == len(bumped))
pe.ENTRY_DIR = real_dir

# ── 8 · the lane, end to end ───────────────────────────────────────────────
FAKE = {"now": at(DAY, "07:00"), "supervisors": [{"person_id": 74}], "token": TOKEN}


def entries_now(body):
    now_local = FAKE["now"].astimezone(OHIO)
    out = []
    for e in FAKE.get("entries") or ENTRIES:
        began = pa.entry_span(e)[0]
        if began <= now_local:
            out.append(dict(e))
    return out


calls = []


SERVICE_REFUSAL = ('<results><permissions><window_name>Invalid username</window_name>'
                   '<permission></permission><special_data>652</special_data></permissions></results>')


def fake(method, body, timeout):
    calls.append(method)
    if method == "getLogIn" and not body:
        # THE NO-CREDENTIAL SERVICE PROBE (DOWN's health retry): the service's
        # own refusal of an empty body while it is up.
        got = FAKE.get("probe", SERVICE_REFUSAL)
        if isinstance(got, Exception):
            raise got
        return got
    if method == "getLogIn":
        got = FAKE["token"]
        if isinstance(got, Exception):
            raise got
        return got
    if method == "getSingleEntrySupervisorsJSON":
        got = FAKE["supervisors"]
        if isinstance(got, Exception):
            raise got
        return got
    if method == "singleEntryFilterAdminListJSON":
        return entries_now(body)
    raise AssertionError(method)


def tick(hhmm, day=DAY):
    FAKE["now"] = at(day, hhmm)
    return pa.tick("dsn", FAKE["now"])


PHONES = {"annearly": "+13305550100", "cymissing": "+13305550101", "lizlate": "+13305550103",
          "patten": "+13305550104"}


def door(offer, state="rehearsed", states=None):
    """The door, stood in for: the person's phone for a staff row, the house
    manager's (never hashed back) for a house-manager row. `states` answers per
    kind where a check needs it (a delivered ask is `told`)."""
    out = []
    for r in offer["rows"]:
        hm = r["kind"] in pr.HM_KINDS
        got = (states or {}).get(r["kind"], state)
        out.append({"id": r["id"],
                    "state": "no_contact" if r["person_key"] not in PHONES and not hm else got,
                    "phone_key": "" if hm else pr.phone_key(PHONES.get(r["person_key"]))})
    return {"results": out}


write_secret("p")
psi.forget_login()
# THE CLOCK HAS SEEN EVERYBODY ON THE ROSTER LATELY — except Gus Unknown, the
# roster name it has never spelled — and the lane has been reading it for a
# month: the state of a working relay.
SEEN = {k: (DAY - timedelta(days=3)).isoformat()
        for n in ("Nia Night", "Ann Early", "Cy Missing", "Liz Late", "Tom Called", "Pat Ten", "Hal Later")
        for k in pa.person_keys(n)}
(TMP / "state.json").write_text(json.dumps({"seen": SEEN,
                                            "reading_since": (DAY - timedelta(days=30)).isoformat()}),
                                encoding="utf-8")
pa._S.clear()
pa._CACHE.update({"at": 0.0, "shifts": [], "offs": {}, "loose": [], "plan_said": "", "held_said": ""})
pa._BOARD.update({"at": 0.0, "rows": [], "status": {}})
pr.forget()
# The books' real readers, kept for the review's regressions (section 11),
# which stand in for Postgres itself rather than for the reader.
REAL_CALLED_OFF, REAL_NOTES_WRITTEN = pa.called_off, pa.notes_written
pa.roster = lambda dsn, a, b: (list(ROSTER), Counter())
pa.called_off = lambda dsn, a, b: (OFFS, [], "tracker newest 2026-09-22")
# THE NOTES AND THE HOUSES' NAMES, stood in for: the relay's mirror is never
# asked from here. Nia left her note during last night's shift; nobody else
# has written one today.
NOTES = {"ok": True, "by_key": {k: ["2026-09-22T11:45:00Z"] for k in pa.person_keys("Nia Night")}, "why": ""}
pa.notes_written = lambda dsn: NOTES
pa.house_names = lambda dsn: {"H1": "JH home"}
pa._call = fake

r1 = tick("07:00")
board_file = json.loads(pa.BOARD_FILE.read_text())
rows1 = {(r["person"], r["row_kind"]): r for r in board_file["rows"]}
check("the first collection is due at once for last night's open shift, and signs in once",
      r1["state"] == "told" and calls.count("getLogIn") == 1 and r1.get("board"), (r1, calls))
check("the board is on disk with the clock beside it",
      board_file["status"]["clock_state"] == "read" and board_file["status"]["mode"] == "psi"
      and board_file["status"]["session_kept"] is True and "token" not in json.dumps(board_file["status"]).lower().replace("session_kept", ""),
      board_file["status"])
check("the session token is kept in the lane's state and nowhere on the board",
      json.loads((TMP / "state.json").read_text())["session"]["token"] == "ABC123"
      and "ABC123" not in pa.BOARD_FILE.read_text())
check("last night's shift reads as worked, and the punch nobody's shift claimed is listed",
      rows1[("Nia Night", "shift")]["verdict"] == "punched_on_time"
      and rows1[("Zed Extra", "punch")]["verdict"] == "punch_without_shift")
slice_rows, slice_at = pbs.build("commPunchBoard")
check("the slice: the clock first, then every row, dated by the board",
      slice_rows[0]["row_kind"] == "status" and slice_rows[0]["clock_state"] == "read"
      and slice_at == board_file["generated_at"] and len(slice_rows) == len(board_file["rows"]) + 1)
hist = (TMP / "psi-entries" / "current.json").read_text()
check("every entry the collection read is in the JSON history, and nothing of the client's",
      all(f'"{i}"' in hist for i in ("1002", "1004", "1005", "1006", "1007", "1009")) and "Location_Name" not in hist)

r2 = tick("07:55")
check("07:55: the ask before an 08:00 shift falls inside the quiet window and is held, not sent",
      r2["state"] == "waiting" and pr.pending(at(DAY, "07:55").timestamp()) is None
      and pr.status()["held"] == 3, pr.status())
r3 = tick("08:00")
offer = pr.pending(at(DAY, "08:00").timestamp())
check("08:00: the held asks are still true and go now — the FIRST ask, never for the one a human wrote about",
      offer and sorted((r["kind"], r["person"]) for r in offer["rows"]) ==
      [("confirm_ask", "Ann Early"), ("confirm_ask", "Cy Missing"), ("confirm_ask", "Liz Late")], offer)
gus = next(r for r in pa._BOARD["rows"] if r["person"] == "Gus Unknown")
check("REGRESSION: a roster name the clock has never spelled gets no ask — the board lists it "
      "(upcoming before the start, known: False) and the planner leaves it out",
      gus["known"] is False and not any(r["person"] == "Gus Unknown" for r in (offer or {}).get("rows", [])), gus)
check("the door's rows carry the shape the door reads — the house's own name beside its code — and nothing "
      "of the planner's own",
      offer and set(offer["rows"][0]) == {"id", "kind", "person", "person_key", "house", "house_name",
                                          "shift_code", "shift_at", "day", "minutes"}
      and offer["rows"][0]["house_name"] == "JH home", offer and offer["rows"][0])
counts = pr.posted(offer["ids"], door(offer), at(DAY, "08:00").timestamp())
check("the door's answer is written down under each occasion", counts == {"rehearsed": 3}, counts)
tick("08:01")
check("and nothing answered is offered twice", pr.pending(at(DAY, "08:01").timestamp()) is None)

r4 = tick("09:20")
offer4 = pr.pending(at(DAY, "09:20").timestamp())
got4 = sorted((r["kind"], r["person"], r["minutes"]) for r in (offer4 or {}).get("rows", []))
check("09:20: the collection reuses the kept session — no second login",
      r4["state"] == "told" and calls.count("getLogIn") == 1 and calls.count("getSingleEntrySupervisorsJSON") == 2,
      (r4, calls))
check("09:20: the house manager is told of the early clock-in, and — nobody replied, and the read at 09:20 "
      "shows no punch — that Cy did not go to work; nobody else",
      got4 == [("early_in", "Ann Early", 30), ("hm_no_show", "Cy Missing", 80)], got4)
hm4 = next((r for r in (offer4 or {}).get("rows", []) if r["kind"] == "hm_no_show"), {})
check("the no-show row says a check backs it — and, her asks having gone only to the rehearsal book, that she "
      "was NOT asked (the door's words then say 'no clock-in', never 'no reply')", hm4.get("checked") is True
      and hm4.get("asked") is False and not hm4.get("rehearsal_only"), hm4)
pr.posted(offer4["ids"], door(offer4), at(DAY, "09:20").timestamp())
r5 = tick("09:49")
check("while somebody is missing, the next collection is thirty minutes on",
      r5["state"] == "waiting" and r5["next"] == at(DAY, "09:50").isoformat(), r5)
r6 = tick("09:50")
offer6 = pr.pending(at(DAY, "09:50").timestamp())
got6 = sorted((r["kind"], r["person"], r["id"].rsplit("|", 1)[1]) for r in (offer6 or {}).get("rows", []))
check("09:50: the follow-up collection, on the kept session, finds her still missing — and now that the house "
      "manager was told, SHE is told she has not logged in; the ten o'clock shift gets its first ask",
      r6["state"] == "told" and calls.count("getLogIn") == 1
      and got6 == [("confirm_ask", "Pat Ten", "a2"), ("login_missing", "Cy Missing", "k3")], (r6, got6))
# Pat's ask REACHED her (told); Cy's reminder went to the rehearsal book.
pr.posted(offer6["ids"], door(offer6, states={"confirm_ask": "told"}), at(DAY, "09:50").timestamp())

inbox = TMP / "quo-inbox"
inbox.mkdir(exist_ok=True)


def quo(frm, created, direction="incoming", kind="message.received", text="ok", to="+13309195558"):
    return json.dumps({"id": f"ev-{created}", "type": kind, "received_at": created, "source": "quo",
                       "event": {"type": kind, "data": {"object": {
                           "from": frm, "to": to, "text": text, "createdAt": created,
                           "direction": direction}}}})


(inbox / "2026-09-22.jsonl").write_text("\n".join([
    "not json at all",
    quo("+13305550101", "2026-09-22T13:52:00Z", direction="outgoing", kind="message.delivered"),
    quo("+13305550104", "2026-09-22T13:53:00Z", text="Yes!"),
    quo("+13305550101", "2026-09-22T13:55:00Z"),
]) + "\n", encoding="utf-8")
(inbox / "2026-09-21.jsonl.gz").write_bytes(gzip.compress((quo("+13305559999", "2026-09-22T13:00:00Z") + "\n").encode()))
for p in inbox.iterdir():
    os.utime(p, (at(DAY, "09:56").timestamp(), at(DAY, "09:56").timestamp()))
r7 = tick("09:56")
owed7 = (pr.pending(at(DAY, "09:56").timestamp()) or {}).get("rows", [])
check("a reply from her phone after her first reminder stops the follow-ups — nothing more is owed to her",
      not [r for r in owed7 if r["person"] == "Cy Missing"] and len(pr.stopped_shifts()) == 1, owed7)
check("Pat answered YES to the ask that reached her: her asks stop, and the reminder five minutes before the "
      "shift goes — to a YES only", [(r["kind"], r["person"]) for r in owed7] == [("login_before", "Pat Ten")]
      and pr._R["answers"].get(pa.shift_id(ROSTER[6]), {}).get("word") == "yes", owed7)
pr.posted([r["id"] for r in owed7], door({"rows": owed7}), at(DAY, "09:56").timestamp())
check("an outgoing message, a garbage line and somebody else's text in a gzipped round stop nothing else",
      pr.stopped_shifts() == {pa.shift_id(ROSTER[2])}, pr.stopped_shifts())
r8 = tick("10:20")
check("and with nobody missing, no follow-up collection — the roster's plan stands",
      r8["state"] == "waiting" and r8["next"] == at(DAY, "11:20").isoformat()
      and calls.count("getSingleEntrySupervisorsJSON") == 3, (r8, calls))
pr.forget()
pr.refresh(pa._BOARD["rows"], "psi", at(DAY, "10:21"))
check("the ledger outlives a restart: nothing already answered is owed again",
      pr.pending(at(DAY, "10:21").timestamp()) is None, pr.status())
check("no inbox directory at all is 'no reply known', never an error", pr.replies(TMP / "nowhere", at(DAY, "10:21")) == {})

# a failed delivery is offered again, up to its limit
pr.forget()
rows_f = [srow("Quinn Retry", "10:00", verdict="upcoming")]
pr.refresh(rows_f, "psi", at(DAY, "09:55"))
o = pr.pending(at(DAY, "09:55").timestamp())
pr.posted(o["ids"], {"results": [{"id": o["ids"][0], "state": "failed"}]}, at(DAY, "09:55").timestamp())
pr.refresh(rows_f, "psi", at(DAY, "09:56"))
again = pr.pending(at(DAY, "09:56").timestamp())
check("a row the door could not deliver is offered again", again and again["ids"] == o["ids"])
pr.post_failed(at(DAY, "09:56").timestamp())
check("a door that could not be reached waits before the rows are offered again",
      pr.pending(at(DAY, "09:57").timestamp()) is None
      and pr.pending(at(DAY, "09:56").timestamp() + pr.POST_RETRY_S + 1) is not None)
pr.forget()

# DOWN, end to end: a failed GET and a failed login right after it → the calendar
FAKE["supervisors"] = socket.timeout("timed out")
FAKE["token"] = socket.timeout("timed out")
before9 = len(calls)
psi.forget_login()   # the 07:00 login's few-minute gap is real time, and this test is fast
r9 = tick("11:20")
st9 = json.loads(pa.BOARD_FILE.read_text())["status"]
check("11:20: DOWN — the read on the kept session timed out AND the login right after it timed out: the "
      "board says down, the reminders go by the calendar",
      r9["state"] == "down" and psi.down_state() and st9["clock_state"] == "down" and st9["mode"] == "calendar"
      and st9["down"] and st9["down"]["retry_at"] and calls[before9:] == ["getSingleEntrySupervisorsJSON", "getLogIn"],
      (r9, st9.get("clock_state"), calls[before9:]))
check("and the kept session survives DOWN — it is what reads first when PsiAnywhere is back",
      json.loads((TMP / "state.json").read_text())["session"]["token"] == "ABC123")
before = len(calls)
r10 = tick("12:21")
st10 = json.loads(pa.BOARD_FILE.read_text())
pat = next(r for r in st10["rows"] if r["person"] == "Pat Ten" and r["row_kind"] == "shift")
check("12:21: while DOWN and before its health retry, the collection is held with no request at all",
      r10["state"] == "down" and len(calls) == before, (r10, calls[before:]))
check("and a shift that began after the last read is 'clock not read' — never 'did not punch'",
      pat["verdict"] == "clock_not_read", pat)
cal_offer = pr.pending(at(DAY, "12:21").timestamp())
pat_rows = [r for r in (cal_offer or {}).get("rows", []) if r["person"] == "Pat Ten"]
check("the calendar takes over: 'not logged in' goes from the roster, and the row says no check backs it",
      pat_rows and pat_rows[0]["kind"] == "login_missing" and pat_rows[0]["checked"] is False, cal_offer)

# relogin once, then stop
psi.forget_login()
FAKE["supervisors"] = "an answer that is not a list"
FAKE["token"] = TOKEN2
logins = calls.count("getLogIn")
r11 = tick("13:30")
check("a kept session the service will not take: ONE more login, then stop",
      r11["state"] == "unknown" and calls.count("getLogIn") == logins + 1
      and json.loads((TMP / "state.json").read_text())["session"]["token"] == "XYZ789", (r11, calls[-6:]))
check("DOWN IS HIS DEFINITION ONLY: the login right after the failed read WORKED, so this is not DOWN — the "
      "lane stays on the clock (psi mode), and what it could not read says 'clock not read'",
      pa._mode(at(DAY, "13:31")) == "psi" and psi.down_state() is None)
psi.login_refused("Not active")
check("the account refusing in its own words is NOT down — it is the latch — and with no account able to "
      "sign in, the reminders go by the calendar",
      pa._mode(at(DAY, "13:32")) == "calendar" and psi.down_state() is None
      and pa._clock_now(at(DAY, "13:32"))[0] == "refused")
psi.forget_login()

# THE HEALTH RETRY, end to end: from time to time back to it — cheap first —
# and the first read that lands is UP. (The login clock keeps real time, so
# the retry is made due by moving its moment, never by waiting.)
psi.mark_down("the test's outage")
psi._login_state["down"]["retry_at"] = time.time() - 1
FAKE["probe"] = socket.timeout("timed out")
before = len(calls)
r12 = tick("15:30")
check("DOWN's health retry asks the NO-CREDENTIAL probe first — it times out: still down, nothing else asked, "
      "and the next retry a full spacing on",
      r12["state"] == "down" and calls[before:] == ["getLogIn"] and psi.down_state()
      and psi.down_state()["retry_at"] > time.time() + psi.PSI_DOWN_RETRY_S - 100, (r12, calls[before:]))
psi._login_state["down"]["retry_at"] = time.time() - 1
FAKE.pop("probe")
FAKE["supervisors"] = [{"person_id": 74}]
before = len(calls)
r13 = tick("15:31")
st13 = json.loads(pa.BOARD_FILE.read_text())["status"]
check("the service answers the probe → the KEPT session is read, no login spent — the first read that lands "
      "is UP, whatever the backoff said, and the calendar hands back",
      r13["state"] == "told" and psi.down_state() is None and st13["mode"] == "psi"
      and st13["clock_state"] == "read" and not st13["down"]
      and calls[before:] == ["getLogIn", "getSingleEntrySupervisorsJSON", "singleEntryFilterAdminListJSON"],
      (r13, calls[before:], st13.get("clock_state")))
before = len(calls)
tick("15:32")
check("and the plan resumes its own spacing after the retry's read — no collection a minute later",
      len(calls) == before, calls[before:])
psi.forget_login()

# the slice refuses the client's half by name, a third time
leaky = TMP / "leaky-board.json"
leaky.write_text(json.dumps({"generated_at": "2026-09-22T17:00:00Z", "status": {"clock_state": "read", "token": "x"},
                             "rows": [{"row_kind": "shift", "id": "a", "person": "P", "Location_Name": "123 Client St",
                                       "latitude": "41", "verdict": "late"}]}), encoding="utf-8")
real_board = pbs.BOARD_FILE
pbs.BOARD_FILE = leaky
lrows, _ = pbs.build("commPunchBoard")
check("the slice carries its allow-list only — no place, no coordinates, no session",
      "Location_Name" not in json.dumps(lrows) and "latitude" not in json.dumps(lrows) and "token" not in lrows[0]
      and lrows[1]["verdict"] == "late")
pbs.BOARD_FILE = TMP / "no-such-board.json"
try:
    pbs.build("commPunchBoard")
    check("a board never written is a refusal, never an empty day", False)
except pbs.BoardMissing:
    check("a board never written is a refusal, never an empty day", True)
pbs.BOARD_FILE = real_board
check("the slice's refused names are refused at import", not (set(pbs.SHIFT_FIELDS) | set(pbs.STATUS_FIELDS)) & set(pbs.REFUSED))

# ── 9 · REGRESSIONS — each finding of the review, held ─────────────────────
REM_FILE = TMP / ".psi-reminders.json"


def fresh_lane(seen_names=()):
    """A clean lane: state, memory, board, history and reminders all empty."""
    body = {"seen": {k: (DAY - timedelta(days=3)).isoformat() for n in seen_names for k in pa.person_keys(n)},
            "reading_since": (DAY - timedelta(days=30)).isoformat() if seen_names else ""}
    (TMP / "state.json").write_text(json.dumps(body), encoding="utf-8")
    pa._S.clear()
    pa._CACHE.update({"at": 0.0, "shifts": [], "offs": {}, "loose": [], "plan_said": "", "held_said": ""})
    pa._BOARD.update({"at": 0.0, "rows": [], "status": {}})
    pa._LAST_READ.update(at="", rows=[], day_from=None)
    pr.forget()
    REM_FILE.unlink(missing_ok=True)
    shutil.rmtree(TMP / "psi-entries", ignore_errors=True)
    calls.clear()
    FAKE.update(token=TOKEN, supervisors=[{"person_id": 74}], entries=None)
    NOTES.update(ok=True, by_key={}, why="")
    psi.forget_login()
    pa._load()


def shift_rows(got):
    return {r["person"]: r for r in got["rows"] if r["row_kind"] == "shift"}


# (13) an entry that ENDED before the start is not the shift's clock-in
s1 = pa.board([shift("Ann Lee", "10:00")], pa.punch_index([entry(2001, "Ann Lee", DAY, "06:00:00", "07:55:00")])[0],
              keyed("Ann Lee"), {}, [], at(DAY, "08:05"), at(DAY, "08:00"), (DAY,))
s1_shift = shift_rows(s1)["Ann Lee"]
check("REGRESSION (13): a 06:00-07:55 entry is not the 10:00 shift's clock-in — upcoming, listed as a punch with no "
      "roster shift, and no early clock-in goes to the house manager",
      s1_shift["verdict"] == "upcoming" and s1_shift["early_minutes"] is None
      and [r["verdict"] for r in s1["rows"] if r["row_kind"] == "punch"] == ["punch_without_shift"]
      and not [r for r in P(s1["rows"], at(DAY, "08:05"))["due"] if r["kind"] == "early_in"], s1["rows"])
s1b = pa.board([shift("Bob Ray", "08:00")], pa.punch_index([entry(2002, "Bob Ray", DAY, "00:00:00", "07:45:00")])[0],
               keyed("Bob Ray"), {}, [], at(DAY, "07:55"), at(DAY, "07:50"), (DAY,))
check("REGRESSION (13): the night entry closed at 07:45 leaves the 08:00 shift upcoming, so its five-minute reminder "
      "is still owed (held for the quiet window here)",
      shift_rows(s1b)["Bob Ray"]["verdict"] == "upcoming"
      and kinds(PY(s1b["rows"], at(DAY, "07:55")), "held") == [("login_before", "Bob Ray", "T-5")], s1b["rows"])
s1c = pa.board([shift("Fa Gu", "08:00")], pa.punch_index([entry(2003, "Fa Gu", DAY, "07:30:00")])[0],
               keyed("Fa Gu"), {}, [], at(DAY, "07:50"), at(DAY, "07:45"), (DAY,))
check("REGRESSION (13): an entry still OPEN before the start is still the clock-in — the real early clock-in stands",
      shift_rows(s1c)["Fa Gu"]["verdict"] == "punched_on_time" and shift_rows(s1c)["Fa Gu"]["early_minutes"] == 30)

# (8) a check a minute into the shift backs no "not logged in"
b8 = pa.board([shift("Pat Ten", "10:00")], {}, keyed("Pat Ten"), {}, [], at(DAY, "10:02"), at(DAY, "10:01"), (DAY,))
check("REGRESSION (8): a read one minute into a shift says 'no punch yet' on the board and texts nobody",
      b8["rows"][0]["verdict"] == "no_punch_yet"
      and not [r for r in P(b8["rows"], at(DAY, "10:02"))["due"] if r["kind"] == "login_missing"], b8["rows"])
check("REGRESSION (8): a read past the late line does",
      kinds(PY([srow("Pat Ten", "10:00", verdict="no_punch_yet", checked=at(DAY, "10:21"))], at(DAY, "10:22")))
      == [("login_missing", "Pat Ten", "k0")])

# (6) the 08:00 message rests on an 08:00 read
r630 = [srow("Cy Missing", "06:30", verdict="no_punch", checked=at(DAY, "07:50"))]
check("REGRESSION (6): a check made inside the quiet window (07:50) backs no 'not logged in' at 08:00",
      not PY(r630, at(DAY, "08:00"))["due"] and not PY(r630, at(DAY, "07:51"))["held"])
fresh_lane()
pa._BOARD["rows"] = r630
check("REGRESSION (6): after a read inside the window, the lane reads the clock again at 08:00 sharp — not 08:20",
      pa._follow_up_at(at(DAY, "07:55"), at(DAY, "07:50")) == at(DAY, "08:00"),
      pa._follow_up_at(at(DAY, "07:55"), at(DAY, "07:50")))
check("REGRESSION (6): and that 08:00 read, still finding nothing, is what says it",
      kinds(PY([srow("Cy Missing", "06:30", verdict="no_punch", checked=at(DAY, "08:00"))], at(DAY, "08:00")))
      == [("login_missing", "Cy Missing", "k3")])

# (9) a switch from the clock to the calendar never says it twice in ten minutes
cy_cal = [srow("Cy Missing", "08:00", verdict="clock_not_read")]
said_950 = {pr.occasion_key("login_missing", "cymissing", "2026-09-22T12:00:00Z", "k3"):
            {"state": "told", "kind": "login_missing", "shift_id": cy_cal[0]["id"],
             "at": pr._utc_iso(at(DAY, "09:50"))}}
check("REGRESSION (9): told at 09:50 on a check, the calendar does not say it again at 10:00 — only thirty minutes on",
      not PY(cy_cal, at(DAY, "10:00"), mode="calendar", ledger=said_950)["due"]
      and kinds(PY(cy_cal, at(DAY, "10:20"), mode="calendar", ledger=said_950)) == [("login_missing", "Cy Missing", "k4")])

# (10) nobody the clock does not know is texted
unk_up = [dict(srow("Gus Unknown", "10:00"), known=False)]
unk_cal = [dict(srow("Gus Unknown", "10:00", verdict="clock_not_read"), known=False)]
check("REGRESSION (10): a roster name the clock does not know gets no reminder and no 'not logged in' — from the "
      "clock or from the calendar",
      not P(unk_up, at(DAY, "09:55"))["due"] and not P(unk_up, at(DAY, "09:55"), mode="calendar")["due"]
      and not P(unk_cal, at(DAY, "10:31"), mode="calendar")["due"])
check("REGRESSION (10): a clock that has spelled nobody yet (known: None) holds nobody back",
      kinds(PY([dict(srow("Pat Ten", "10:00"), known=None)], at(DAY, "09:55"))) == [("login_before", "Pat Ten", "T-5")]
      and kinds(P([dict(srow("Pat Ten", "10:00"), known=None)], at(DAY, "09:55"))) == [("confirm_ask", "Pat Ten", "a2")])
young = pa.board([shift("Gus Unknown", "10:00"), shift("Pat Ten", "10:00")], {}, keyed("Pat Ten"), {}, [],
                 at(DAY, "09:55"), None, (DAY,), recent_complete=False)
check("REGRESSION (10): a lane that has read the clock for less than the window says 'not known yet' (None), "
      "never 'unknown' — the first read after the restart must not silence everybody it has not met",
      [r["known"] for r in young["rows"] if r["person"] == "Gus Unknown"] == [None]
      and [r["known"] for r in young["rows"] if r["person"] == "Pat Ten"] == [True], young["rows"])
fresh_lane()
pa._S["reading_since"] = (DAY - timedelta(days=2)).isoformat()
young_gate = pa._recent_complete(at(DAY, "09:55"))
pa._S["reading_since"] = (DAY - timedelta(days=15)).isoformat()
check("REGRESSION (10): the window is counted from the lane's FIRST read, which a spelling seen every day "
      "cannot move", young_gate is False and pa._recent_complete(at(DAY, "09:55")) is True)

# (7) "inside the quiet window" is not "never"
fresh_lane()
ann20 = [srow("Ann Early", "20:00", verdict="punched_on_time", early=45)]
pr.refresh(ann20, "psi", at(DAY, "21:29"))
o7 = pr.pending(at(DAY, "21:29").timestamp() + 50)
pr.posted(o7["ids"], {"results": [{"id": o7["ids"][0], "state": "refused_quiet"}]}, at(DAY, "21:30").timestamp() + 5)
check("REGRESSION (7): a door answering 'inside the quiet window' (its clock a few seconds on) writes nothing down",
      o7["ids"][0] not in pr._R["ledger"], pr._R["ledger"])
pr.refresh(ann20, "psi", at(DAY + timedelta(days=1), "08:00"))
again7 = pr.pending(at(DAY + timedelta(days=1), "08:00").timestamp())
check("REGRESSION (7): so at 08:00 the house manager is told of the early clock-in — once the window ends",
      bool(again7) and again7["ids"] == o7["ids"], again7)

# (3) the Desk holding "not logged in" ends that shift's follow-up collections
for answer, stops in (("held", True), ("rehearsed", False), ("dial_off", True), ("recorded", False)):
    fresh_lane()
    cy_m = [srow("Cy Missing", "08:00", verdict="no_punch", checked=at(DAY, "09:20"))]
    pr._load()
    pr._R["answers"][cy_m[0]["id"]] = {"word": "yes", "at": pr._utc_iso(at(DAY, "07:35"))}
    pr.refresh(cy_m, "psi", at(DAY, "09:21"))
    o3 = pr.pending(at(DAY, "09:21").timestamp())
    pr.posted(o3["ids"], {"results": [{"id": i, "state": answer} for i in o3["ids"]]}, at(DAY, "09:21").timestamp())
    pa._BOARD["rows"] = cy_m
    fu3 = pa._follow_up_at(at(DAY, "09:22"), at(DAY, "09:20"))
    if stops:
        check(f"REGRESSION (3): a 'not logged in' the door answers `{answer}` (the situation switched off in the "
              "Desk, the sending dial at off) ends that shift's follow-ups — no PsiAnywhere request backs a "
              "message that cannot go",
              fu3 is None and cy_m[0]["id"] in pr.stopped_shifts(), (fu3, pr.stopped_shifts()))
    else:
        check(f"REGRESSION (3): while a `{answer}` one (the sheet dial, the record dial) keeps them — the "
              "rehearsal rows are the point",
              fu3 == at(DAY, "09:50") and not pr.stopped_shifts(), (fu3, pr.stopped_shifts()))
    check(f"the dial's word `{answer}` closes the occasion — it is not offered again",
          pr.pending(at(DAY, "09:22").timestamp()) is None and o3["ids"][0] in pr._R["ledger"]
          and pr._R["ledger"][o3["ids"][0]]["state"] == answer, pr._R["ledger"].get(o3["ids"][0]))

# (1) the follow-ups are bounded: per shift, and per day
fresh_lane()
pa._BOARD["rows"] = [srow("Cy Missing", "08:00", verdict="no_punch", checked=at(DAY, "09:20"))]
t1, spent1 = at(DAY, "09:50"), 0
while spent1 < 20 and pa._follow_up_rows(t1):
    pa._follow_up_spend(t1, pa._follow_up_rows(t1))
    spent1 += 1
    t1 += timedelta(minutes=30)
check("REGRESSION (1): one missing shift buys at most FOLLOW_UPS_PER_SHIFT collections of its own (4) — after "
      "that it is looked at by the collections the roster plans",
      spent1 == pa.FOLLOW_UPS_PER_SHIFT == 4 and pa._follow_up_at(t1, t1 - timedelta(minutes=30)) is None, spent1)
fresh_lane()
pa._BOARD["rows"] = [srow(f"Person {c}", "08:00", verdict="no_punch", checked=at(DAY, "09:20")) for c in "ABCDEFGHIJKLMN"]
check("REGRESSION (1): fourteen missing shifts with the day's purse untouched are owed a follow-up",
      pa._follow_up_at(at(DAY, "15:00"), at(DAY, "14:30")) == at(DAY, "15:00"))
pa._S["follow_ups"] = {"day": DAY.isoformat(), "n": pa.FOLLOW_UP_DAY_MAX, "by_shift": {}}
check("REGRESSION (1): and the day's purse (12) closes every follow-up until midnight, however many are missing — "
      "the next day starts a new one",
      pa.FOLLOW_UP_DAY_MAX == 12 and pa._follow_up_at(at(DAY, "15:00"), at(DAY, "14:30")) is None
      and pa._follow_ups_spent(at(DAY + timedelta(days=1), "00:01"))[0] == 0)

# (2) "sign in once more, then stop" holds ACROSS collections, and failures back off
fresh_lane(seen_names=("Cy Missing", "Dan Ten", "Eve Two", "Flo Six", "Gil Ten"))
real_gap = psi.PSI_LOGIN_GAP_S
psi.PSI_LOGIN_GAP_S = 0.0           # the login clock's minutes are real time; this day is not
pa.roster = lambda dsn, a, b: ([shift("Cy Missing", "08:00"), shift("Dan Ten", "10:00"), shift("Eve Two", "14:00"),
                                shift("Flo Six", "18:00"), shift("Gil Ten", "22:00")], Counter())
pa.called_off = lambda dsn, a, b: ({}, [], "")
FAKE["entries"] = [entry(4001, "Zed Other", DAY, "07:00:00")]
tick("09:20")
first_logins = calls.count("getLogIn")
FAKE["supervisors"] = [{"person_id": None}]   # the account signs in, and reads nothing
FAKE["token"] = TOKEN2
t2 = at(DAY, "09:21")
while t2 <= at(DAY, "09:20") + timedelta(hours=24):
    FAKE["now"] = t2
    pa.tick("dsn", t2)
    t2 += timedelta(minutes=5)
logins2 = calls.count("getLogIn") - first_logins
lists2 = calls.count("getSingleEntrySupervisorsJSON") - 1
st2 = json.loads(pa.BOARD_FILE.read_text())["status"]
check("REGRESSION (2): a service that answers a fresh session unreadably costs ONE more login and then none for "
      "the next 24 h (it was about one an hour)", logins2 == 1, (logins2, calls[-12:]))
check("REGRESSION (2): and the collections back off (60, 120, 240, 480 min): six in the day, each one read on the "
      "kept session — seven supervisor lists, not 24 collections", lists2 <= 7, lists2)
check("REGRESSION (2): the board says why — and, the login having WORKED, it is not DOWN, so not the calendar "
      "(the rule's own definition) — and the lane measured the session's life in minutes",
      st2["clock_state"] == "unknown" and st2["mode"] == "psi" and not st2.get("down")
      and pa._S["session_life"].get("refused_at_min") and "XYZ789" not in pa.BOARD_FILE.read_text()
      and "ABC123" not in pa.BOARD_FILE.read_text(), (st2["clock_why"], pa._S.get("session_life")))
FAKE["supervisors"] = [{"person_id": 74}]
t2 = pa._backoff_until(t2) or t2
FAKE["now"] = t2 + timedelta(minutes=1)
logins_before = calls.count("getLogIn")
pa.tick("dsn", FAKE["now"])
check("REGRESSION (2): the service reads again on the KEPT session — no login — and the backoff and the rest end",
      calls.count("getLogIn") == logins_before and not pa._S["backoff"] and not pa._S["relogin_rest"]
      and pa._S["clock"]["state"] == "read", (pa._S["clock"], pa._S["backoff"]))
pa._S["relogin_rest"] = {"at": FAKE["now"].isoformat(), "why": "x", "stamp": pa._credential_stamp()}
check("REGRESSION (2): the relogin rest holds while nothing changed", bool(pa._relogin_rest(FAKE["now"])))
time.sleep(0.01)
write_secret("a new password")
check("REGRESSION (2): and a new credential file lifts it, the way it lifts a refusal",
      pa._relogin_rest(FAKE["now"]) == "")
psi.PSI_LOGIN_GAP_S = real_gap

# (5)(11) a read the history could not keep never turns a clocked-in person into "not logged in"
for how in ("the disk is full", "current.json is unreadable"):
    fresh_lane(seen_names=("Gil Ha", "Hal Nopunch"))
    pa.roster = lambda dsn, a, b: ([shift("Gil Ha", "08:00"), shift("Hal Nopunch", "08:00")], Counter())
    FAKE["entries"] = [entry(5001, "Gil Ha", DAY, "07:58:00")]
    real_write = pe._write_atomic
    if how == "the disk is full":
        def _full(*_a, **_k):
            raise OSError(28, "No space left on device")
        pe._write_atomic = _full
    else:
        (TMP / "psi-entries").mkdir(parents=True, exist_ok=True)
        (TMP / "psi-entries" / "current.json").write_text("{truncated", encoding="utf-8")
    try:
        tick("09:20")
    finally:
        pe._write_atomic = real_write
    body5 = json.loads(pa.BOARD_FILE.read_text())
    v5 = shift_rows(body5)
    due5 = [(r["kind"], r["person"]) for r in pr._R.get("due", [])]
    check(f"REGRESSION (5/11) — {how}: the person the read saw on the clock is on the clock on the board, and is "
          "not texted 'not logged in'",
          v5["Gil Ha"]["verdict"] == "punched_on_time" and ("login_missing", "Gil Ha") not in due5
          and body5["status"]["history"] in ("unwritten", "unreadable"), (v5["Gil Ha"], due5, body5["status"]["history"]))
    check(f"REGRESSION (5/11) — {how}: the read still vouches for the absence it covers",
          v5["Hal Nopunch"]["verdict"] == "no_punch", v5["Hal Nopunch"])
    # A RESTART with the history still not whole: the read is gone from memory
    pa._LAST_READ.update(at="", rows=[], day_from=None)
    pa._board_write(at(DAY, "09:25"))
    v5b = shift_rows(json.loads(pa.BOARD_FILE.read_text()))
    check(f"REGRESSION (5/11) — {how}: after a restart nothing the history cannot vouch for is a missing punch — "
          "'clock not read', and no checked 'not logged in' is planned from it",
          v5b["Hal Nopunch"]["verdict"] == "clock_not_read"
          and not [r for r in pr._R.get("due", []) if r["kind"] == "login_missing"],
          (v5b["Hal Nopunch"], pr._R.get("due")))
shutil.rmtree(TMP / "psi-entries", ignore_errors=True)

# (4) the probe's credentialed login is on the one wire, and under the pause
import asyncio  # noqa: E402

import httpx  # noqa: E402

wire_seen = []


def _probe_handler(req):
    body = req.content.decode() if req.content else ""
    has_hash = '"hash"' in body
    wire_seen.append((req.url.path, has_hash, psi._wire_lock.locked()))
    if has_hash and PROBE["login"] == "timeout":
        raise httpx.ReadTimeout("slow", request=req)
    return httpx.Response(403, text="<html>Forbidden</html>")


PROBE = {"login": "403"}
_RealClient = httpx.AsyncClient


class _MockClient(_RealClient):
    def __init__(self, *a, **k):
        k["transport"] = httpx.MockTransport(_probe_handler)
        super().__init__(*a, **k)


psi.httpx.AsyncClient = _MockClient
try:
    psi.forget_login()
    psi.forget()
    wire_seen.clear()
    with psi.wire():
        v4 = asyncio.run(psi._check())
    login4 = [r for r in v4["rungs"] if r["rung"] == "login"]
    check("REGRESSION (4): while a collection request holds the wire, the probe sends NO credentialed login — the "
          "rung stands aside, and the login ration is not spent",
          not any(h for _p, h, _w in wire_seen) and login4 and login4[0].get("skipped")
          and "wire" in login4[0]["why"] and psi.login_snapshot()["at"] == 0.0, (wire_seen, login4))
    psi.forget()
    wire_seen.clear()
    psi._wire_last["at"] = time.monotonic()
    v4a = asyncio.run(psi._check())
    login4a = [r for r in v4a["rungs"] if r["rung"] == "login"]
    check("REGRESSION (4): inside the wire's breath after a request, the probe's login stands aside too",
          not any(h for _p, h, _w in wire_seen) and login4a and "a moment ago" in login4a[0]["why"]
          and psi.login_snapshot()["at"] == 0.0, (wire_seen, login4a))
    psi.forget()
    wire_seen.clear()
    psi._wire_last["at"] = 0.0
    v4b = asyncio.run(psi._check())
    check("REGRESSION (4): with the wire free, the login goes — and it goes holding the wire",
          [(h, w) for _p, h, w in wire_seen if h] == [(True, True)], wire_seen)
    psi.forget_login()
    psi.forget()
    PROBE["login"] = "timeout"
    psi._wire_last["at"] = 0.0
    asyncio.run(psi._check())
    check("DOWN (4): a timeout on the probe's login is not DOWN — DOWN is the lane's failed read AND its failed "
          "login — so nothing is paused; the miss is the brake's to ration",
          not psi.paused()[0] and psi.down_state() is None and psi._login_state["misses"] == 1,
          (psi.paused(), psi._login_state["misses"]))
finally:
    psi.httpx.AsyncClient = _RealClient
    PROBE["login"] = "403"
    psi.forget_login()
    psi.forget()

# (12) the weekly re-verification of the punch house runs while the record moves every hour
import ast  # noqa: E402
import logging  # noqa: E402
import types  # noqa: E402

_src = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
_want = {"_psi_punches_due", "_psi_punches_tick", "_PSI_PUNCHES", "PSI_PUNCHES_REVERIFY_S",
         "PSI_PUNCHES_PASSES_PER_TICK", "PSI_PUNCHES_QUIET_S"}
_nodes = []
for _n in ast.parse(_src).body:
    if isinstance(_n, (ast.FunctionDef, ast.AsyncFunctionDef)) and _n.name in _want:
        _nodes.append(_n)
    elif isinstance(_n, (ast.Assign, ast.AnnAssign)):
        _t = _n.targets[0] if isinstance(_n, ast.Assign) else _n.target
        if isinstance(_t, ast.Name) and _t.id in _want:
            _nodes.append(_n)
_clock = {"t": 1_000_000.0}
_live = {"n": 1}


def _mk(i):
    r = {f: "" for f in feed.FIELDS}
    r.update(single_entry_id=str(10000 + i))
    return r


_feed = types.SimpleNamespace(
    probe=lambda dsn: {"rows": 3, "newest": "n", "live_rows": _live["n"], "live_newest": str(_live["n"])},
    read=lambda dsn: {"rows": [_mk(i) for i in range(3)] + [_mk(100 + j) for j in range(_live["n"])], "digest": "d"},
    fingerprints=feed.fingerprints, changed_rows=feed.changed_rows, batches=feed.batches,
    payload=feed.payload, verdict=feed.verdict)


async def _door(body, **_kw):
    n = len(body["payload"]["rows"])
    return {"status": 200, "data": {"received": n, "kept": n, "inserted": 0, "updated": 0, "unchanged": n,
                                    "writes": 0}}


async def _service_door(_app, action, payload, credential, **kw):
    # the relay's own lane: Apps Script's door or Python's, the same answer shape either way
    return await _door({"action": action, "payload": payload, **credential}, **kw)


_ns = {"asyncio": asyncio, "time": types.SimpleNamespace(time=lambda: _clock["t"]), "os": os, "Any": object,
       "log": logging.getLogger("t"), "PG_DSN": "dsn", "_SWEEP_FAILURES": {"psi_punches": 0},
       "psi_punches_feed": _feed, "_post_exec": _door, "_service_door": _service_door, "HIRING_APP": "hiring"}
exec(compile(ast.Module(body=_nodes, type_ignores=[]), "snapshot_service", "exec"), _ns)  # noqa: S102


async def _three_weeks():
    fulls = []
    for hour in range(24 * 21):
        _clock["t"] += 3600
        if hour % 24 in range(8, 20):
            _live["n"] += 1
        was = _ns["_PSI_PUNCHES"]["full_at"]
        await _ns["_psi_punches_tick"]({})
        if _ns["_PSI_PUNCHES"]["full_at"] != was:
            fulls.append(hour)
    return fulls


_fulls = asyncio.run(_three_weeks())
check("REGRESSION (12): with the record moving every hour, the whole house is still re-verified every week "
      "(a full sweep at the start and one each week after — it was never, while the relay stayed up)",
      len(_fulls) >= 3 and all(b - a <= 7 * 24 + 1 for a, b in zip(_fulls, _fulls[1:])), _fulls)

# (14) no screen calls PsiAnywhere retired
_banned = ("punch record is frozen", "sync has stopped", "psianywhere is dead", "retired erp",
           "is being switched off", "stopped populating", "nobody can query again", "a system that is gone")
_hits = []
for _root in ("src", "apps-script", "server", "tools"):
    for _p in (HERE.parent.parent / _root).rglob("*"):
        if _p.suffix not in (".ts", ".tsx", ".gs", ".py", ".mjs") or "node_modules" in _p.parts or _p == HERE:
            continue
        _low = _p.read_text(encoding="utf-8", errors="replace").lower()
        _hits += [f"{_p.relative_to(HERE.parent.parent)}: {w}" for w in _banned if w in _low]
check("REGRESSION (14): no screen, house note or comment calls PsiAnywhere retired, dead or switched off — it is the "
      "official time clock; the stored copy is what stopped", not _hits, _hits)

# ── 10 · THE SHIFT FLOW — the rules, one at a time ─────────────────────────
AID = srow("Ann Ask", "10:00")["id"]
A_ISO = "2026-09-22T14:00:00Z"


def led(*items):
    """A ledger for Ann's 10:00 shift: (kind, occasion, state, hh:mm, row kind)."""
    out = {}
    for kind, occ, state, hhmm, rk in items:
        out[pr.occasion_key(kind, "annask", A_ISO, occ)] = {
            "state": state, "kind": rk, "shift_id": AID, "at": pr._utc_iso(at(DAY, hhmm))}
    return out


def ann(**kw):
    return [srow("Ann Ask", "10:00", **kw)]


ASKED = led(("confirm", "a0", "told", "09:30", "confirm_ask"))
said = lambda word: {AID: {"word": word, "at": pr._utc_iso(at(DAY, "09:35"))}}  # noqa: E731
check("FLOW (1): at T-30 the ask goes to the staff member — and not a minute before",
      kinds(P(ann(), at(DAY, "09:30"))) == [("confirm_ask", "Ann Ask", "a0")]
      and not P(ann(), at(DAY, "09:29"))["due"])
series, book = [], {}
for m in range(0, 70):
    now_m = at(DAY, "09:30") + timedelta(minutes=m)
    for r in P(ann(verdict="clock_not_read" if m >= 30 else "upcoming"), now_m, mode="calendar",
               ledger=book)["due"]:
        book[r["id"]] = {"state": "rehearsed", "kind": r["kind"], "shift_id": AID, "at": pr._utc_iso(now_m)}
        series.append((now_m.astimezone(OHIO).strftime("%H:%M"), r["kind"]))
check("FLOW (2): no reply — the ask again every ten minutes until T+30, then the house manager (from the "
      "calendar: at T+30 itself), and only after him the person's own 'not logged in'",
      series == [("09:30", "confirm_ask"), ("09:40", "confirm_again"), ("09:50", "confirm_again"),
                 ("10:00", "confirm_again"), ("10:10", "confirm_again"), ("10:20", "confirm_again"),
                 ("10:30", "hm_no_show"), ("10:31", "login_missing")], series)
check("FLOW (2): no reply BUT a punch — the asks stop, nothing goes to the house manager",
      not [r for r in P(ann(verdict="punched_on_time"), at(DAY, "09:50"), ledger=ASKED)["due"]
           if r["kind"] in pr.ASK_KINDS]
      and not P(ann(verdict="punched_on_time"), at(DAY, "10:31"), ledger=ASKED)["due"])
check("FLOW (3): a YES stops the asks, and the five-minute reminder goes — to a YES only",
      not P(ann(), at(DAY, "09:40"), ledger=ASKED, answers=said("yes"))["due"]
      and kinds(P(ann(), at(DAY, "09:55"), ledger=ASKED, answers=said("yes"))) == [("login_before", "Ann Ask", "T-5")]
      and kinds(P(ann(), at(DAY, "09:55"), ledger=ASKED)) == [("confirm_again", "Ann Ask", "a2")]
      and not [r for r in P(ann(verdict="no_punch", checked=at(DAY, "10:31")), at(DAY, "10:32"), ledger=ASKED,
                            answers=said("yes"))["due"] if r["kind"] == "hm_no_show"])
no_now = P(ann(), at(DAY, "09:41"), ledger=ASKED, answers=said("no"))
no_led = dict(ASKED, **led(("hm_confirm_no", "no", "told", "09:41", "hm_confirm_no")))
check("FLOW (3): a NO — the house manager at once, the asks stop, and nothing more to them (no reminder, no "
      "'did not go to work')",
      kinds(no_now) == [("hm_confirm_no", "Ann Ask", "no")]
      and not P(ann(), at(DAY, "09:55"), ledger=no_led, answers=said("no"))["due"]
      and not P(ann(verdict="no_punch", checked=at(DAY, "10:31")), at(DAY, "10:32"), ledger=no_led,
                answers=said("no"))["due"])
check("FLOW (3): any other reply stops the asks — a human answered — and nothing else follows",
      not P(ann(), at(DAY, "09:41"), ledger=ASKED, answers=said("other"))["due"]
      and not P(ann(), at(DAY, "09:55"), ledger=ASKED, answers=said("other"))["due"]
      and not P(ann(verdict="clock_not_read"), at(DAY, "10:31"), mode="calendar", ledger=ASKED,
                answers=said("other"))["due"])
hm_psi = P(ann(verdict="no_punch", checked=at(DAY, "10:30")), at(DAY, "10:31"), ledger=ASKED)
check("FLOW (2): no reply and no punch by T+30, from the clock — the house manager, on a read made at T+30, "
      "saying she was asked and the clock was checked",
      kinds(hm_psi) == [("hm_no_show", "Ann Ask", "T+30")] and hm_psi["due"][0]["checked"] is True
      and hm_psi["due"][0]["asked"] is True, hm_psi)
early_read = P(ann(verdict="no_punch_yet", checked=at(DAY, "10:25")), at(DAY, "10:31"), ledger=ASKED)
check("FLOW (2): a read from BEFORE the deadline backs nothing — the shift waits for the lane's next read",
      not early_read["due"] and [a["id"] for a in early_read["awaiting"]] == [AID], early_read)
late_hm = P(ann(verdict="clock_not_read"), at(DAY, "11:31"), ledger=ASKED)
check("FLOW (2): an hour past the deadline with the clock still unread for her, it goes — saying the clock "
      "could not be checked",
      kinds(late_hm) == [("hm_no_show", "Ann Ask", "T+30")] and late_hm["due"][0]["checked"] is False
      and not P(ann(verdict="clock_not_read"), at(DAY, "11:29"), ledger=ASKED)["due"])
cal_hm = P(ann(verdict="clock_not_read"), at(DAY, "10:30"), mode="calendar", ledger=ASKED)
check("FLOW (2): CALENDAR MODE (PsiAnywhere down, or the account latched) — at T+30 the house manager is told "
      "honestly: no reply, and the clock could not be checked",
      [r for r in cal_hm["due"] if r["kind"] == "hm_no_show"][0]["checked"] is False, cal_hm)
check("FLOW (2): never 'did not reply' about somebody nobody could ask — from the calendar nothing is known; "
      "from the clock only its read speaks (asked: False)",
      not [r for r in P(ann(verdict="clock_not_read"), at(DAY, "10:31"), mode="calendar")["due"]
           if r["kind"] == "hm_no_show"]
      and [(r["asked"], r["checked"]) for r in P(ann(verdict="no_punch", checked=at(DAY, "10:30")),
                                                   at(DAY, "10:31"))["due"]] == [(False, True)])
told_hm = dict(ASKED, **led(("hm_no_show", "T+30", "told", "10:31", "hm_no_show")))
check("FLOW (7): after the house manager was told, 'not logged in' goes to the person after a check — and not "
      "before, to somebody who never answered",
      kinds(P(ann(verdict="no_punch", checked=at(DAY, "10:50")), at(DAY, "10:51"), ledger=told_hm))
      == [("login_missing", "Ann Ask", "k1")]
      and not [r for r in P(ann(verdict="no_punch_yet", checked=at(DAY, "10:25")), at(DAY, "10:26"),
                            ledger=ASKED)["due"] if r["kind"] == "login_missing"])
check("FLOW (7): a YES who has not punched gets 'not logged in' after a check, with no house manager told",
      kinds(P(ann(verdict="no_punch", checked=at(DAY, "10:50")), at(DAY, "10:51"), ledger=ASKED,
              answers=said("yes"))) == [("login_missing", "Ann Ask", "k1")])
n22 = [srow("Ned Late", "22:00", hours=10)]
check("FLOW (8): the quiet window — the T-30 ask of a 22:00 shift goes at 21:30, and at 21:30:59; at 21:31 "
      "it is held",
      kinds(P(n22, at(DAY, "21:30"))) == [("confirm_ask", "Ned Late", "a0")]
      and kinds(P(n22, at(DAY, "21:30") + timedelta(seconds=59))) == [("confirm_ask", "Ned Late", "a0")]
      and not P(n22, at(DAY, "21:31"))["due"] and kinds(P(n22, at(DAY, "21:31")), "held")
      == [("confirm_ask", "Ned Late", "a0")])
n22_led = {pr.occasion_key("confirm", "nedlate", "2026-09-23T02:00:00Z", "a0"):
           {"state": "rehearsed", "kind": "confirm_ask", "shift_id": n22[0]["id"],
            "at": pr._utc_iso(at(DAY, "21:30"))}}
n22_cal = [dict(n22[0], verdict="clock_not_read")]
check("FLOW (8): a no-show at 22:30 is HELD; at 08:00 it goes only if still true — no reply and no punch",
      kinds(P(n22_cal, at(DAY, "22:30"), mode="calendar", ledger=n22_led), "held")
      == [("hm_no_show", "Ned Late", "T+30")]
      and ("hm_no_show", "Ned Late", "T+30") in kinds(P(n22_cal, at(DAY + timedelta(days=1), "08:00"),
                                                         mode="calendar", ledger=n22_led))
      and not P([dict(n22[0], verdict="late")], at(DAY + timedelta(days=1), "08:00"), ledger=n22_led)["due"])
e8 = [srow("Eve Eight", "08:00")]
check("FLOW (8): the asks before an 08:00 shift are held at 07:30-07:59, and at 08:00 the FIRST ask goes",
      kinds(P(e8, at(DAY, "07:30")), "held") == [("confirm_ask", "Eve Eight", "a0")]
      and kinds(P(e8, at(DAY, "08:00"))) == [("confirm_ask", "Eve Eight", "a3")])
lc = [dict(srow("Lu Late", "10:00", told="tracker"), told_kind="late_show", late_call=True,
           told_at="2026-09-22T12:40:00Z")]
lc2 = lc + [dict(srow("Lu Late", "16:00", told="tracker"), told_kind="late_show", late_call=True,
                 told_at="2026-09-22T12:40:00Z")]
lc_key = pr.occasion_key("late_call", "lulate", DAY.isoformat(), "late")
check("FLOW (5): a LATE CALL — the house manager is told, once per person per shift day, while she is not yet "
      "on the clock and the shift is not over; nobody is asked anything",
      kinds(P(lc, at(DAY, "09:00"))) == [("late_call", "Lu Late", "late")]
      and kinds(P(lc2, at(DAY, "09:00"))) == [("late_call", "Lu Late", "late")]
      and not P(lc, at(DAY, "09:10"), ledger={lc_key: {"state": "told"}})["due"]
      and not P([dict(lc[0], verdict="late")], at(DAY, "10:40"))["due"]
      and not P(lc, at(DAY, "18:01"))["due"])
check("FLOW: a call-off is the call-off lane's — no ask, no house-manager text from this flow",
      not P([srow("Cal Off", "10:00", told="tracker")], at(DAY, "09:30"))["due"]
      and not P([srow("Cal Off", "10:00", told="tracker", verdict="told_by_a_human")], at(DAY, "10:31"),
                mode="calendar")["due"])
check("FLOW: a roster name the clock does not know is asked nothing and reported to nobody",
      not P([dict(srow("Gus Unknown", "10:00"), known=False)], at(DAY, "09:30"))["due"]
      and not P([dict(srow("Gus Unknown", "10:00", verdict="clock_not_read"), known=False)], at(DAY, "10:31"),
                mode="calendar")["due"])
check("FLOW: the dial at `record` still planned the no-show — as a REHEARSAL row that says she was not asked "
      "(the rehearsal row is the point, and no manager hears it); at `off` it ends the asks",
      [(r["asked"], r["rehearsal_only"]) for r in P(ann(verdict="clock_not_read"), at(DAY, "10:30"), mode="calendar",
                                                  ledger=led(("confirm", "a0", "recorded", "09:30", "confirm_ask")))["due"]
       if r["kind"] == "hm_no_show"] == [(False, True)]
      and not P(ann(), at(DAY, "09:40"), ledger=led(("confirm", "a0", "dial_off", "09:30", "confirm_ask")))["due"])
pr.CONFIRM_FLOW = False
check("FLOW: the one switch OFF brings rule 13 back as it stood — the reminder to everybody, no ask",
      kinds(P(ann(), at(DAY, "09:55"))) == [("login_before", "Ann Ask", "T-5")]
      and not P(ann(), at(DAY, "09:30"))["due"])
pr.CONFIRM_FLOW = True

check("REPLIES: YES / Y / SIM / OK and NO / N / NAO / NÃO, any case; anything else is a human answering",
      [pr.reply_word(w) for w in ("YES", "yes!", "Y", "sim", "Ok thanks", "NO", "n", "Nao", "NÃO", "não posso")]
      == ["yes"] * 5 + ["no"] * 5
      and [pr.reply_word(w) for w in ("No problem", "", "Not sure", "???", "who is this?", "I won't be late",
                                      "Yes I can't wait")] == ["other"] * 5 + ["other", "yes"])

# ── the replies, end to end through the ledger and the inbox ───────────────
fresh_lane()
rin = TMP / "quo-inbox-flow"
rin.mkdir(exist_ok=True)
rows_r = [srow("Rae Reply", "10:00"), srow("Sol Other", "10:00"), srow("Tia Tester", "10:00")]
PHONES.update({"raereply": "+13305550201", "solother": "+13305550202", "tiatester": "+13305550203"})
pr.refresh(rows_r, "psi", at(DAY, "09:30"), inbox=rin)
o_r = pr.pending(at(DAY, "09:30").timestamp())
pr.posted(o_r["ids"], {"results": [{"id": r["id"], "state": "rehearsed" if r["person"] == "Tia Tester" else "told",
                                     "phone_key": pr.phone_key(PHONES[r["person_key"]])} for r in o_r["rows"]]},
          at(DAY, "09:30").timestamp())
(rin / "2026-09-22.jsonl").write_text("\n".join([
    quo("+13305550201", "2026-09-22T13:20:00Z", text="NO"),            # before the ask: not an answer
    quo("+13305550201", "2026-09-22T13:33:00Z", text="Não"),           # the answer
    quo("+13305550202", "2026-09-22T13:34:00Z", text="who is this?"),  # a human answering
    quo("+13305550202", "2026-09-22T13:35:00Z", text="yes", to="+13309197744"),  # another line
    quo("+13305550203", "2026-09-22T13:34:00Z", text="YES"),           # her ask was a rehearsal row
]) + "\n", encoding="utf-8")
got_r = pr.refresh(rows_r, "psi", at(DAY, "09:36"), inbox=rin)
due_r = sorted((r["kind"], r["person"]) for r in pr._R["due"])
check("REPLIES: a NO after the ask reached her tells the house manager at once; a text that says neither stops "
      "the asks and tells nobody; a reply to another line, or to an ask that only reached the rehearsal book, "
      "is no answer",
      pr._R["answers"].get(rows_r[0]["id"], {}).get("word") == "no"
      and pr._R["answers"].get(rows_r[1]["id"], {}).get("word") == "other"
      and rows_r[2]["id"] not in pr._R["answers"]
      and due_r == [("hm_confirm_no", "Rae Reply")], (pr._R["answers"], due_r))
check("REPLIES: the flow's marks ride the punch board — the reply word per shift; a NO ends the collections "
      "for the shift, a reply that was neither does not (a read can still show she is not there)",
      pr.marks().get(rows_r[0]["id"], {}).get("confirm") == "no"
      and rows_r[1]["id"] not in pr.stopped_shifts() and rows_r[0]["id"] in pr.stopped_shifts())
o_hm = pr.pending(at(DAY, "09:36").timestamp())
pr.posted(o_hm["ids"], door(o_hm, state="told"), at(DAY, "09:36").timestamp())
pr.refresh(rows_r, "psi", at(DAY, "09:40"), inbox=rin)
check("REPLIES: the house manager is told of the NO once — and the asks of the one whose ask was a rehearsal "
      "go on (she was never really asked)",
      sorted((r["kind"], r["person"]) for r in pr._R["due"]) == [("confirm_again", "Tia Tester")], pr._R["due"])

# ── the 4040 is heard too; a reply naming another conversation is not the ask's ─
fresh_lane()
rin4 = TMP / "quo-inbox-4040"
rin4.mkdir(exist_ok=True)
rows_4 = [srow("Una Four", "10:00"), srow("Vic Ref", "10:00"), srow("Wes Rehearsed", "10:00")]
PHONES.update({"unafour": "+13305550301", "vicref": "+13305550302", "wesrehearsed": "+13305550303"})
pr.refresh(rows_4, "psi", at(DAY, "09:30"), inbox=rin4)
o_4 = pr.pending(at(DAY, "09:30").timestamp())
pr.posted(o_4["ids"], {"results": [{"id": r["id"], "state": "rehearsed" if r["person"] == "Wes Rehearsed" else "told",
                                     "phone_key": pr.phone_key(PHONES[r["person_key"]])} for r in o_4["rows"]]},
          at(DAY, "09:30").timestamp())
(rin4 / "2026-09-22.jsonl").write_text("\n".join([
    quo("+13305550301", "2026-09-22T13:33:00Z", text="NO", to="+13307544040"),         # to the 4040: heard
    quo("+13305550302", "2026-09-22T13:33:00Z", text="YES SP0123456789"),              # an open shift's ref
    quo("+13305550302", "2026-09-22T13:34:00Z", text="yes HO0123456789", to="+13307544040"),  # a swap's ref
]) + "\n", encoding="utf-8")
pr.refresh(rows_4, "psi", at(DAY, "09:36"), inbox=rin4)
check("THE LINES: a reply to the 4040 is heard like one to the 5558 — her NO tells the house manager",
      pr._R["answers"].get(rows_4[0]["id"], {}).get("word") == "no"
      and ("hm_confirm_no", "Una Four") in [(r["kind"], r["person"]) for r in pr._R["due"]], pr._R["answers"])
check("THE LINES: a reply that quotes an open shift's ref (SP…) or a swap's (HO…) answers THAT, never the "
      "shift ask — the reply ear acts on it there",
      rows_4[1]["id"] not in pr._R["answers"], pr._R["answers"])
check("THE LINES: the 5558 and the 4040 by default, the 5558 first (the line the asks leave from)",
      pr.REPLY_LINES == frozenset({"3309195558", "3307544040"}) and pr.REPLY_LINE == "3309195558",
      (pr.REPLY_LINES, pr.REPLY_LINE))
got_ask = pr.ask_open_for("+1 (330) 555-0302", at(DAY, "09:40"))
check("ASK OPEN: the reply ear is told which shift the flow is waiting on an answer about from that phone",
      bool(got_ask) and got_ask["person"] == "Vic Ref" and got_ask["shift_id"] == rows_4[1]["id"]
      and got_ask["shift_code"] == "10:00", got_ask)
check("ASK OPEN: nothing before the ask went, nothing once the shift is over, nothing for a phone nobody was "
      "asked on",
      pr.ask_open_for("+13305550302", at(DAY, "09:29")) is None
      and pr.ask_open_for("+13305550302", at(DAY, "18:01")) is None
      and pr.ask_open_for("+13305559999", at(DAY, "09:40")) is None)
check("ASK OPEN: an ask that only reached the rehearsal book asked nobody anything",
      pr.ask_open_for("+13305550303", at(DAY, "09:40")) is None)
REM_FILE.write_text("{not json", encoding="utf-8")
pr.forget()
try:
    pr.ask_open_for("+13305550302", at(DAY, "09:40"))
    unreadable_said = "answered"
except pr.LedgerUnreadable:
    unreadable_said = "raised"
check("ASK OPEN: a ledger that cannot be read RAISES — an ask that cannot be looked up is not an ask that "
      "never went", unreadable_said == "raised", unreadable_said)
REM_FILE.unlink(missing_ok=True)
pr.forget()

# ── the awaited read: the lane collects for the house manager's message ────
fresh_lane()
aw = ann(verdict="clock_not_read")
pr._load()
pr._R["ledger"].update(ASKED)
pr.refresh(aw, "psi", at(DAY, "10:31"))
pa._BOARD["rows"] = aw
check("THE AWAITED READ: a no-reply shift past T+30 with no read after the deadline is what the lane collects "
      "for — now, when the last collection is half an hour old",
      pr.awaiting() == {AID} and [r["id"] for r in pa._missing(at(DAY, "10:31"))] == [AID]
      and pa._follow_up_at(at(DAY, "10:31"), at(DAY, "09:50")) == at(DAY, "10:20"),
      (pr.awaiting(), pa._follow_up_at(at(DAY, "10:31"), at(DAY, "09:50"))))
pr.refresh([dict(aw[0], verdict="no_punch", checked_at=at(DAY, "10:32").astimezone(OHIO).isoformat())],
           "psi", at(DAY, "10:33"))
check("THE AWAITED READ: and the read that lands, finding no punch, backs the house manager's message",
      [(r["kind"], r["checked"]) for r in pr._R["due"]] == [("hm_no_show", True)] and not pr.awaiting(), pr._R["due"])

# ── rule 8 — the Daily Notes ────────────────────────────────────────────────


def nshift(name, hhmm, hours=8, day=DAY, **kw):
    s = shift(name, hhmm, day=day, hours=hours)
    base = {"person": name, "person_key": s["person_key"], "keys": sorted(pa.person_keys(name)),
            "house": "H1", "house_name": "JH home", "shift_code": hhmm, "day": day.isoformat(),
            "shift_at": s["shift_at"].astimezone(OHIO).isoformat(),
            "shift_end": s["shift_end"].astimezone(OHIO).isoformat(),
            "known": True, "told": False, "verdict": "punched_on_time", "worked": True}
    base.update(kw)
    return pa.shift_id(s), base


def N(keep, now, ledger=None, notes=None, answers=None, stopped=None):
    return pr.plan([], mode="psi", now=now, ledger=ledger or {}, stopped=stopped or {}, answers=answers or {},
                   notes=notes if notes is not None else {"ok": True, "by_key": {}}, keep=keep)


def _fresh_days_with(value):
    """NOTE_BOOK_FRESH_DAYS as a fresh import of the module reads it with the
    environment set to `value` (None: unset) — a second copy under its own
    name, so the lane's state in `pr` is not touched."""
    import importlib.util  # noqa: PLC0415
    held = os.environ.pop("HUB_NOTE_BOOK_FRESH_DAYS", None)
    try:
        if value is not None:
            os.environ["HUB_NOTE_BOOK_FRESH_DAYS"] = value
        spec = importlib.util.spec_from_file_location("psi_reminders_env_probe", SERVER / "psi_reminders.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.NOTE_BOOK_FRESH_DAYS
    finally:
        os.environ.pop("HUB_NOTE_BOOK_FRESH_DAYS", None)
        if held is not None:
            os.environ["HUB_NOTE_BOOK_FRESH_DAYS"] = held


# "BROKEN" MEANS THE READ FAILED TO ANSWER (by rule) — never
# something inferred from missing data. So the stale-book hold is OFF by
# default: a book that READS reminds whoever owes a note however long since
# anybody wrote one, and only an UNREADABLE book reminds nobody.
fd_id, fd_b = nshift("Fay Fresh", "08:00")
fd_empty = N({fd_id: fd_b}, at(DAY, "15:30"))
fd_yday = N({fd_id: fd_b}, at(DAY, "15:30"), notes={"ok": True, "by_key": {"someone": ["2026-09-21T15:00:00Z"]}})
fd_old = N({fd_id: fd_b}, at(DAY, "15:30"), notes={"ok": True, "by_key": {"someone": ["2026-09-20T12:00:00Z"]}})
fd_name = N({fd_id: fd_b}, at(DAY, "15:30"), notes={"ok": True, "by_key": {}, "names": {"Somebody Spoken": ["2026-09-22T09:00:00Z"]}})
fd_unread = N({fd_id: fd_b}, at(DAY, "15:30"), notes={"ok": False, "why": "the notes book could not be read"})
check("RULE 8 FRESHNESS: HUB_NOTE_BOOK_FRESH_DAYS is OFF by default (0); the environment can still bring it back "
      "as an explicit choice (5)",
      pr.NOTE_BOOK_FRESH_DAYS == 0 and _fresh_days_with(None) == 0 and _fresh_days_with("5") == 5
      and _fresh_days_with("0") == 0, (pr.NOTE_BOOK_FRESH_DAYS, _fresh_days_with(None)))
check("RULE 8 FRESHNESS: with the default, a book that READS reminds the person who owes a note — whether it holds "
      "no note from anybody, only one three days old, one from yesterday, or one under a name as spoken — and the "
      "hold says nothing",
      fd_empty["due"] and fd_old["due"] and fd_yday["due"] and fd_name["due"]
      and pr.notes_quiet_why({"ok": True, "by_key": {}}, at(DAY, "15:30")) == ""
      and pr.notes_quiet_why({"ok": True, "by_key": {"someone": ["2026-09-20T12:00:00Z"]}}, at(DAY, "15:30")) == "",
      (fd_empty["due"], fd_old["due"], fd_yday["due"], fd_name["due"]))
check("RULE 8 FRESHNESS: an UNREADABLE book still reminds NOBODY — that is a failed read, and \"no note can be "
      "read\" is not \"no note was written\"; the freshness hold never speaks for a book it could not read",
      pr.notes_quiet_why({"ok": False, "why": "x"}, at(DAY, "15:30")) == ""
      and not fd_unread["due"] and not fd_unread["held"], fd_unread)
# AND THE HOLD, WHEN SOMEBODY SETS IT ON PURPOSE, STILL WORKS AS IT DID: two
# days, a stale book holds every reminder and says why.
pr.NOTE_BOOK_FRESH_DAYS = 2
fd_on_empty = N({fd_id: fd_b}, at(DAY, "15:30"))
fd_on_yday = N({fd_id: fd_b}, at(DAY, "15:30"), notes={"ok": True, "by_key": {"someone": ["2026-09-21T15:00:00Z"]}})
check("RULE 8 FRESHNESS: switched on explicitly (2), a book with no recent note holds every reminder and says why; "
      "a note from anybody yesterday opens it",
      not fd_on_empty["due"] and not fd_on_empty["held"]
      and "HUB_NOTE_BOOK_FRESH_DAYS" in pr.notes_quiet_why({"ok": True, "by_key": {}}, at(DAY, "15:30"))
      and fd_on_yday["due"], (fd_on_empty, fd_on_yday["due"]))
# The mechanics of rule 8 below are about the series, the merge, the caps and
# the quiet window, over a book with no notes at all: the hold is off for them,
# as it is by default (R11 moves it again on purpose).
pr.NOTE_BOOK_FRESH_DAYS = 0

# A HUMAN'S REPORT SKIPS THE NOTE ONLY WHEN IT SAYS THE SHIFT WAS NOT WORKED.
tk_late = nshift("Lia Late", "08:00", told=True, told_kind="late_show")
tk_sent = nshift("Sam Sent", "08:00", told=True, told_kind="sent_home")
tk_off = nshift("Cal Off", "08:00", told=True, told_kind="call_off", worked=False)
tk_bare = nshift("Bo Told", "08:00", told=True)
tk_due = {name: [r["kind"] for r in N({sid: body}, at(DAY, "15:30"))["due"]]
          for name, (sid, body) in (("late", tk_late), ("sent", tk_sent), ("off", tk_off), ("bare", tk_bare))}
check("RULE 8: a Late Show and a Sent Home are shifts that were worked, so their Daily Note is owed; a "
      "call-off, and a report of no kind anybody can place, owe none",
      "note_due" in tk_due["late"] and "note_due" in tk_due["sent"] and not tk_due["off"]
      and not tk_due["bare"] and pa.WORKED_TOLD == pa.LATE_KINDS | {"sent_home"}, tk_due)
tk_sid = "rule8-told-kind"
pr._remember([{"row_kind": "shift", "id": tk_sid, "person": "Lia Late", "person_key": "lialate",
               "house": "H1", "shift_at": "2026-09-22T08:00:00-04:00", "shift_end": "2026-09-22T16:00:00-04:00",
               "told_source": "tracker", "told_kind": "late_show", "verdict": "late"}], at(DAY, "09:00"))
check("…and the board's report kind is remembered with the shift, so the plan can tell them apart",
      pr._R["shifts"].get(tk_sid, {}).get("told_kind") == "late_show"
      and pr._R["shifts"][tk_sid].get("told") is True, pr._R["shifts"].get(tk_sid))
pr._R["shifts"].pop(tk_sid, None)


def note_series(keep, start, minutes, notes=None, answers=None):
    """Walk the clock minute by minute, answering every note reminder `told`."""
    book, out = {}, []
    for m in range(minutes):
        t = start + timedelta(minutes=m)
        for r in N(keep, t, ledger=book, notes=notes, answers=answers)["due"]:
            book[r["id"]] = {"state": "told", "kind": "note_due", "shift_id": r["shift_id"],
                             "covers": r["covers"], "at": pr._utc_iso(t)}
            out.append((t.astimezone(OHIO).strftime("%m-%d %H:%M"), len(r["covers"])))
    return out, book


s_id, s_b = nshift("Bea Note", "08:00")
# THE SHIFT'S OWN SERIES, with the person's daily ceiling out of the way — it
# is held on its own below.
pr.NOTE_PERSON_DAY_CAP = 0
walk, _book = note_series({s_id: s_b}, at(DAY, "15:00"), 60 * 60)
check("RULE 8: end-30, end-10, end+10, then every two hours 08:00-20:00 — and at most twelve per shift",
      [w for w, _n in walk] == ["09-22 15:30", "09-22 15:50", "09-22 16:10", "09-22 18:00", "09-22 20:00",
                                "09-23 08:00", "09-23 10:00", "09-23 12:00", "09-23 14:00", "09-23 16:00",
                                "09-23 18:00", "09-23 20:00"] and pr.NOTE_CAP == 12, walk)
check("RULE 8: a note from her written after the shift began stops it; one from before it does not",
      not N({s_id: s_b}, at(DAY, "15:30"), notes={"ok": True, "by_key": {"beanote": ["2026-09-22T16:00:00Z"]}})["due"]
      and N({s_id: s_b}, at(DAY, "15:30"), notes={"ok": True, "by_key": {"beanote": ["2026-09-21T16:00:00Z"]}})["due"])
check("RULE 8: a notes book that cannot be read owes nobody a reminder",
      not N({s_id: s_b}, at(DAY, "15:30"), notes={"ok": False, "by_key": {}, "why": "x"})["due"])
nw = {k: v for k, v in (nshift("No Work", "08:00", worked=False, verdict="no_punch"),)}
check("RULE 8: nobody is asked for a note about a shift they did not work — a call-off, a NO, a name the clock "
      "does not know",
      not N(dict([nshift("Cal Off", "08:00", told=True)]), at(DAY, "15:30"))["due"]
      and not N({s_id: s_b}, at(DAY, "15:30"), answers={s_id: {"word": "no", "at": "x"}})["due"]
      and not N(dict([nshift("Gus Unknown", "08:00", known=False)]), at(DAY, "15:30"))["due"])
ne_id, ne_b = nshift("No Entry", "08:00", worked=False, verdict="not_entered_yet")
cr_id, cr_b = nshift("No Entry", "08:00", worked=False, verdict="clock_not_read")
check("RULE 8: EVERY COMPLETED SHIFT OWES A DAILY NOTE — a shift with no entry yet ('no punch', 'not entered yet') "
      "is reminded like any other, and so is a clock nobody read",
      N({ne_id: ne_b}, at(DAY, "18:00"))["due"] and N(nw, at(DAY, "18:00"))["due"]
      and N({cr_id: cr_b}, at(DAY, "18:00"))["due"])
short_ne = P(ann(hours=0.5, verdict="not_entered_yet", checked=at(DAY, "11:30")), at(DAY, "11:31"), ledger=ASKED)
short_np = P(ann(hours=0.5, verdict="no_punch", checked=at(DAY, "10:31")), at(DAY, "10:32"), ledger=ASKED)
check("REVIEW: a read an hour past the end that found no entry ('not entered yet') backs no 'did not go to work' "
      "and waits for no read — while a 'no punch' read inside the grace still backs it",
      not short_ne["due"] and not short_ne["held"] and not short_ne["awaiting"]
      and kinds(short_np) == [("hm_no_show", "Ann Ask", "T+30")], (short_ne, kinds(short_np)))
lora = srow("Lora Bakes", "14:30", day=DAY - timedelta(days=1), hours=7.5, verdict="not_entered_yet",
            checked=at(DAY, "08:05"))
lora_cr = dict(lora, verdict="clock_not_read", checked_at="")
check("REVIEW: THE MORNING AFTER — yesterday's 14:30-22:00 shift read 'not entered yet' at 08:05 owes nothing at "
      "08:06: no house manager told she did not go to work, no 'not logged in', exactly as 'clock not read'",
      not P([lora], at(DAY, "08:06"))["due"] and not P([lora], at(DAY, "08:06"))["awaiting"]
      and not P([lora_cr], at(DAY, "08:06"))["due"], P([lora], at(DAY, "08:06")))
a_id, a_b = nshift("Dee Two", "00:00")
b_id, b_b = nshift("Dee Two", "08:00")
walk2, book2 = note_series({a_id: a_b, b_id: b_b}, at(DAY, "07:00"), 14 * 60)
pr.NOTE_PERSON_DAY_CAP = 6
check("RULE 8: two notes owed by one person are ONE message per slot — the night shift's held reminders at "
      "08:00, and the two series merged wherever they meet",
      [w for w, _n in walk2] == ["09-22 08:00", "09-22 10:00", "09-22 12:00", "09-22 14:00", "09-22 15:30",
                                 "09-22 15:50", "09-22 16:10", "09-22 18:00", "09-22 20:00"]
      and dict(walk2)["09-22 18:00"] == 2 and dict(walk2)["09-22 15:50"] == 2, walk2)
q_id, q_b = nshift("Quin Night", "15:00")
check("RULE 8: a reminder that falls inside the quiet window is held — the 23:00 end's three go as one at 08:00",
      not N({q_id: q_b}, at(DAY, "22:40"))["due"] and not N({q_id: q_b}, at(DAY, "23:10"))["held"]
      and [(r["kind"], r["covers"]) for r in N({q_id: q_b}, at(DAY + timedelta(days=1), "08:00"))["due"]]
      == [("note_due", [q_id])])
check("RULE 8: nothing past the forty-eight hours after the end",
      not N({s_id: s_b}, at(DAY + timedelta(days=2), "17:01"))["due"]
      and not N({s_id: s_b}, at(DAY + timedelta(days=2), "18:00"))["due"])
fresh_lane()
pr.refresh([dict(srow("Bea Note", "08:00", verdict="punched_on_time"), known=True)], "psi", at(DAY, "15:30"),
           notes={"ok": True, "by_key": {}})
o_n = pr.pending(at(DAY, "15:30").timestamp())
check("RULE 8, the lane: the reminder travels with the shifts it covers, and the door reads their times",
      o_n and [r["kind"] for r in o_n["rows"]] == ["note_due"] and "covers" not in o_n["rows"][0]
      and o_n["rows"][0]["shifts"][0]["day"] == DAY.isoformat(), o_n)
pr.posted(o_n["ids"], door(o_n, state="no_contact"), at(DAY, "15:30").timestamp())
pr.refresh([dict(srow("Bea Note", "08:00", verdict="punched_on_time"), known=True)], "psi", at(DAY, "15:50"),
           notes={"ok": True, "by_key": {}})
check("RULE 8, the lane: nobody to text ends that shift's note reminders — the door is not asked every slot",
      not [r for r in pr._R["due"] if r["kind"] == "note_due"], pr._R["due"])

# ── the books: what kind of day a human said ───────────────────────────────
offs_late = {k: [{"day": DAY, "spread": 0, "source": "tracker", "kind": "late_show", "at": "2026-09-22T11:50:00Z"}]
             for k in pa.person_keys("Lu Late")}
offs_off = {k: [{"day": DAY, "spread": 0, "source": "tracker", "kind": "call_off", "at": "2026-09-22T11:00:00Z"}]
            for k in pa.person_keys("Cal Off")}
bk = pa.board([shift("Lu Late", "10:00"), shift("Cal Off", "10:00")], {}, keyed("Lu Late", "Cal Off"),
              dict(offs_late, **offs_off), [], at(DAY, "09:00"), at(DAY, "08:50"), (DAY,))
bkr = shift_rows(bk)
check("BOOKS: a Late Show on the tracker is a LATE CALL on the board (kind and when it was learned); a call-off "
      "is not",
      bkr["Lu Late"]["late_call"] is True and bkr["Lu Late"]["told_kind"] == "late_show"
      and bkr["Lu Late"]["told_at"] == "2026-09-22T11:50:00Z"
      and bkr["Cal Off"]["late_call"] is False and bkr["Cal Off"]["told_kind"] == "call_off", bkr)
check("BOOKS: the live queue's words say LATE only when a caller says she will be late — read, never kept",
      all(pa._LATE_WORDS.search(t) for t in ("I'm running late today", "she will be 20 minutes late",
                                             "I'll be a little late", "coming in late"))
      and not any(pa._LATE_WORDS.search(t) for t in ("cannot come in today", "call me later", "a late show",
                                                     "too late to find cover")))
check("BOOKS: the form's own timestamp is the moment the platform learned (Ohio wall time → UTC)",
      pa._typed_at("9/21/2026 14:08:11") == "2026-09-21T18:08:11Z" and pa._typed_at("nonsense") == "")
import house_directory as hd  # noqa: E402
check("HOUSES: the directory's names — 'JH - ABD2704' is JH home, the calendar's region prefix and the code "
      "come off", hd.label_of("JH - ABD2704", "ABD2704") == "JH" and hd.label_of("48TH (A) - ABD1547", "ABD1547")
      == "48TH (A)" and hd.label_of("CAN - JH - ABD2704") == "JH" and hd.code_of("CAN - JH - ABD2704") == "ABD2704")
bslice = pbs.project({"status": {}, "rows": [dict(bkr["Lu Late"], confirm="yes", hm_no_show_at="x",
                                                  late_call_at="y", house_name="JH home")]})
check("THE SLICE: the Desk's fields cross — the kind of day, when it was learned, the reply, the house manager "
      "told, the late call, the house's name",
      all(k in bslice[1] for k in ("told_kind", "told_at", "late_call", "confirm", "hm_no_show_at",
                                   "late_call_at", "house_name")), bslice[1])

# ── 11 · THE SHIFT FLOW'S REVIEW — one regression per finding, numbered ────
import re  # noqa: E402
import subprocess  # noqa: E402
import types  # noqa: E402

# (R1) a reply that lands while the door is still sending is heard: the ask is
# stamped with the moment it was OFFERED, not the moment the door answered
for _word, _want in (("NO", [("hm_confirm_no", "Rae Race", "no")]), ("YES", [])):
    fresh_lane()
    race_in = TMP / f"quo-inbox-race-{_word}"
    race_in.mkdir(exist_ok=True)
    rr = [srow("Rae Race", "10:00")]
    PHONES["raerace"] = "+13305550301"
    t_offer = at(DAY, "09:30") + timedelta(seconds=5)
    pr.refresh(rr, "calendar", t_offer, inbox=race_in)
    o_race = pr.pending(t_offer.timestamp())
    pr.posted(o_race["ids"], {"results": [{"id": i, "state": "told", "phone_key": pr.phone_key(PHONES["raerace"])}
                                          for i in o_race["ids"]]},
              (at(DAY, "09:30") + timedelta(seconds=50)).timestamp())
    stamp_race = [v["at"] for v in pr._R["ledger"].values()]
    (race_in / "2026-09-22.jsonl").write_text(quo("+13305550301", "2026-09-22T13:30:30Z", text=_word) + "\n",
                                              encoding="utf-8")
    pr.refresh(rr, "calendar", at(DAY, "09:31"), inbox=race_in)
    word_race = pr._R["answers"].get(rr[0]["id"], {}).get("word")
    pr.refresh(rr, "calendar", at(DAY, "09:40"), inbox=race_in)
    check(f"REVIEW (R1): a {_word} at 09:30:30 to an ask OFFERED at 09:30:05 and answered by the door at 09:30:50 "
          "is heard — the ledger carries the offer's moment; no ask repeats",
          stamp_race == ["2026-09-22T13:30:05Z"] and word_race == _word.lower()
          and kinds({"due": pr._R["due"]}) == _want, (stamp_race, word_race, pr._R["due"]))

# (R2) a hotline "running late" names only the caller, on the day of the call —
# never a namesake, never her next day. Postgres stood in for; the real reader.
_had_pg = {k: sys.modules.get(k) for k in ("psycopg2", "psycopg2.extras")}


class _Cur:
    def __init__(self):
        self.q = ""

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self.q = sql

    def fetchall(self):
        if "type_of_request" in self.q:
            return [{"requestor": "Maria Lopez", "date_received": YDAY.isoformat(),
                     "description_of_request": "I'm running late, be there in 20"}]
        return []


class _Conn:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def cursor(self, cursor_factory=None):
        return _Cur()


class _CW:
    _NOT_A_PERSON = ("undetermined",)
    LIVE_QUEUE = "live_queue_mirror"
    LIVE_CALL_OFF_CATEGORY = "Schedule - Call Off"

    @staticmethod
    def call_off_facts(dsn, lo, hi):
        return {}, {"freshness": "stub"}

    @staticmethod
    def _us_date(raw):
        return None

    @staticmethod
    def _queue_date(raw):
        return date.fromisoformat(str(raw)[:10])


_pg = types.ModuleType("psycopg2")
_pg_ex = types.ModuleType("psycopg2.extras")
_pg_ex.RealDictCursor = object
_pg.extras = _pg_ex
_pg.connect = lambda dsn: _Conn()
sys.modules.update({"psycopg2": _pg, "psycopg2.extras": _pg_ex})
_held_when = pa._when
pa._when = lambda: _CW
try:
    offs_r2, loose_r2, _fresh = REAL_CALLED_OFF("dsn", YDAY, DAY)
finally:
    pa._when = _held_when
    for _k, _v in _had_pg.items():
        if _v is None:
            sys.modules.pop(_k, None)
        else:
            sys.modules[_k] = _v
r2 = pa.board([shift("Maria Lopez", "14:00", day=YDAY), shift("Maria Lopez", "14:00", day=DAY),
               shift("Maria Smith", "14:00", day=YDAY), shift("Kevin Lopez", "16:00", day=YDAY)],
              {}, set(), offs_r2, loose_r2, at(YDAY, "09:00"), None, (YDAY, DAY))
r2_rows = sorted((r["person"], r["day"], r["late_call"], bool(r["told_source"])) for r in r2["rows"])
check("REVIEW (R2): the caller's own shift on the call's day is her late call; her namesakes and her next day are "
      "HELD by the loose row (told_source) and never named late — and the loose row itself is never a late show",
      r2_rows == [("Kevin Lopez", YDAY.isoformat(), False, True), ("Maria Lopez", YDAY.isoformat(), True, True),
                  ("Maria Lopez", DAY.isoformat(), False, True), ("Maria Smith", YDAY.isoformat(), False, True)]
      and all(f["kind"] != "late_show" for f in loose_r2), (r2_rows, loose_r2))
old_loose = [{"day": YDAY, "tokens": {"maria", "lopez"}, "source": "the line (a caller's name)", "kind": "late_show",
              "at": YDAY.isoformat()}]
check("REVIEW (R2): even a loose row that says late_show (an older reader's shape) names nobody late",
      not any(r["late_call"] for r in pa.board([shift("Maria Smith", "14:00", day=YDAY)], {}, set(), {}, old_loose,
                                               at(YDAY, "09:00"), None, (YDAY,))["rows"]))

# (R3) a note under the name as the caller SPOKE it counts
jp_id, jp_b = nshift("Jasmine Price", "08:00")
jazmin = {"ok": True, "by_key": {k: ["2026-09-22T19:40:00Z"] for k in pa.person_keys("Jazmin Price")},
          "names": {"Jazmin Price": ["2026-09-22T19:40:00Z"]}}
check("REVIEW (R3): 'Jazmin Price' in the notes book is the roster's 'Jasmine Price' — no reminder; a note from "
      "'Maria Smith' does not silence 'Maria Lopez'; a first name alone counts for that first name",
      not N({jp_id: jp_b}, at(DAY, "15:50"), notes=jazmin)["due"]
      and pr.same_person("Jasmine Price", "Jazmin Price") and not pr.same_person("Maria Lopez", "Maria Smith")
      and pr.same_person("Maria Lopez", "Maria") and not pr.same_person("Maria Lopez", "Kevin Lopez"))
_dn = types.ModuleType("daily_notes")
_dn.written_notes = lambda dsn: {"ok": True, "notes": [{"dsp_name": "Jazmin  Price", "call_at": "2026-09-22T19:40:00Z",
                                                        "day": ""}], "via": "copy", "as_of": 1.0}
_had_dn = sys.modules.get("daily_notes")
sys.modules["daily_notes"] = _dn
try:
    got_r3 = REAL_NOTES_WRITTEN("dsn")
finally:
    if _had_dn is None:
        sys.modules.pop("daily_notes", None)
    else:
        sys.modules["daily_notes"] = _had_dn
check("REVIEW (R3): the notes reader hands the flow the name as spoken — names only, never a number",
      got_r3.get("names") == {"Jazmin Price": ["2026-09-22T19:40:00Z"]}, got_r3)

# (R4) a refusal in words is a NO; a "running late" is a late call; a reply that
# was neither still tells the house manager when a READ shows no punch
check("REVIEW (R4): 'Nope', 'Nah', 'Can't make it today', 'I can't come, sick', 'not coming', 'Sorry I won't be "
      "there', 'calling off' are NO; 'running late', 'I'll be 10 min late', 'No, running late', 'can't make it on "
      "time' are LATE",
      [pr.reply_word(w) for w in ("Nope", "Nah", "Can't make it today", "I can’t come, sick", "not coming",
                                  "Sorry I won't be there", "calling off")] == ["no"] * 7
      and [pr.reply_word(w) for w in ("running late", "I'll be 10 min late", "No, running late",
                                      "can't make it on time")] == ["late"] * 4)
cant = {AID: {"word": pr.reply_word("Can't make it today"), "at": pr._utc_iso(at(DAY, "09:35"))}}
check("REVIEW (R4): from the calendar, 'Can't make it today' tells the house manager (a NO) — and she is sent no "
      "Daily Note reminder for the shift she said she cannot work",
      kinds(P(ann(verdict="clock_not_read"), at(DAY, "10:30"), mode="calendar", ledger=ASKED, answers=cant))
      == [("hm_confirm_no", "Ann Ask", "no")]
      and not N({AID: dict(nshift("Ann Ask", "10:00")[1], worked=False, verdict="clock_not_read")}, at(DAY, "17:30"),
                answers=cant)["due"])
other_psi = P(ann(verdict="no_punch", checked=at(DAY, "10:30")), at(DAY, "10:31"), ledger=ASKED, answers=said("other"))
check("REVIEW (R4): 'who is this?' then a read at T+30 showing no punch — the house manager hears 'replied, but not "
      "YES, and no clock-in'; from the calendar nothing is said; and the lane still collects for it",
      [(r["kind"], r["replied"], r["checked"]) for r in other_psi["due"]] == [("hm_no_show", True, True)]
      and not P(ann(verdict="clock_not_read"), at(DAY, "10:31"), mode="calendar", ledger=ASKED,
                answers=said("other"))["due"]
      and [a["id"] for a in P(ann(verdict="no_punch_yet", checked=at(DAY, "10:25")), at(DAY, "10:31"), ledger=ASKED,
                              answers=said("other"))["awaiting"]] == [AID], other_psi)
late_r = P(ann(), at(DAY, "09:36"), ledger=ASKED, answers=said("late"))
check("REVIEW (R4): a 'running late' reply tells the house manager of a late call (once), and no ask repeats",
      [(r["kind"], r["told_source"]) for r in late_r["due"]] == [("late_call", "a reply to the ask")]
      and not P(ann(), at(DAY, "09:50"), ledger=dict(ASKED, **{pr.occasion_key("late_call", "annask", DAY.isoformat(),
                                                                                 "late"): {"state": "told"}}),
                answers=said("late"))["due"], late_r)

# (R7) a NO to the 21:30 ask of a 22:00 shift is held, and told at 08:00
n10 = [srow("Ned Late", "22:00", hours=10)]
n10_no = {n10[0]["id"]: {"word": "no", "at": pr._utc_iso(at(DAY, "21:35"))}}
check("REVIEW (R7): a NO at 21:35 for a 22:00-08:00 shift is held at 21:36 and TOLD at 08:00:20 — as a silence "
      "would be",
      kinds(P(n10, at(DAY, "21:36"), answers=n10_no), "held") == [("hm_confirm_no", "Ned Late", "no")]
      and kinds(P(n10, at(DAY + timedelta(days=1), "08:00") + timedelta(seconds=20), answers=n10_no))
      == [("hm_confirm_no", "Ned Late", "no")])

# (R8) a Late Show is news only before the start or soon after it
lsr = lambda told_at, **kw: [dict(srow("Lu Late", "10:00", told="tracker", verdict="told_by_a_human"),  # noqa: E731
                                  told_kind="late_show", late_call=True, told_at=told_at, **kw)]
check("REVIEW (R8): a Late Show typed at 12:40 for a 10:00 start tells nobody; one typed at 10:20 does; a book that "
      "keeps only the day counts from the first beat the flow saw it",
      not P(lsr("2026-09-22T16:40:00Z"), at(DAY, "12:50"), mode="calendar")["due"]
      and kinds(P(lsr("2026-09-22T14:20:00Z"), at(DAY, "10:21"), mode="calendar")) == [("late_call", "Lu Late", "late")]
      and not P(lsr(DAY.isoformat()), at(DAY, "12:50"), mode="calendar")["due"]
      and kinds(P(lsr(DAY.isoformat(), late_seen_at="2026-09-22T13:50:00Z"), at(DAY, "09:51"), mode="calendar"))
      == [("late_call", "Lu Late", "late")])
fresh_lane()
pr.refresh(lsr(DAY.isoformat()), "calendar", at(DAY, "09:50"))
check("REVIEW (R8): the lane stamps the first beat it saw a day-only late call, and plans it then",
      [r["kind"] for r in pr._R["due"]] == ["late_call"]
      and next(iter(pr._R["shifts"].values())).get("late_seen") == "2026-09-22T13:50:00Z", pr._R["due"])

# (R9) the 22:00 shift's only ask is not staked on one minute
check("REVIEW (R9): the first ask of a 22:00 shift may go from 21:25 (not 21:24:59); a 21:45 shift's asks are "
      "untouched",
      kinds(P(n22, at(DAY, "21:25"))) == [("confirm_ask", "Ned Late", "a0")]
      and not P(n22, at(DAY, "21:25") - timedelta(seconds=1))["due"]
      and not P([srow("Mo Mid", "21:45")], at(DAY, "21:14"))["due"]
      and kinds(P([srow("Mo Mid", "21:45")], at(DAY, "21:15"))) == [("confirm_ask", "Mo Mid", "a0")])

# (R10) what expires soonest goes first, and a beat drains what is owed
fresh_lane()
pr._load()
pr._R["due"] = ([{"id": f"note_due|p{i}|x|n", "kind": "note_due", "person_key": f"p{i}", "shift_at": "2026-09-22T08:00"}
                 for i in range(20)]
                + [{"id": f"login_missing|q{i}|x|k1", "kind": "login_missing", "person_key": f"q{i}",
                    "shift_at": "2026-09-22T14:00"} for i in range(20)]
                + [{"id": f"confirm|n{i}|x|a0", "kind": "confirm_ask", "person_key": f"n{i}",
                    "shift_at": "2026-09-22T22:00"} for i in range(8)])
o_r10 = pr.pending(at(DAY, "21:25").timestamp())
_svc = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
check("REVIEW (R10): with 48 rows owed the first post carries every ask before any follow-up or note, and the "
      "relay's beat posts again while rows are owed",
      [r["kind"] for r in o_r10["rows"][:8]] == ["confirm_ask"] * 8 and len(o_r10["rows"]) == pr.MAX_PER_POST
      and pr.POSTS_PER_BEAT >= 2 and "for _post in range(max(1, psi_reminders.POSTS_PER_BEAT))" in _svc,
      [r["kind"] for r in o_r10["rows"]])

# (R11) a person hears at most NOTE_PERSON_DAY_CAP note reminders a day; and a
# notes channel nobody uses can hold rule 8 whole
d1_id, d1_b = nshift("Pia Daily", "08:00", day=YDAY)
d2_id, d2_b = nshift("Pia Daily", "08:00")
d3_id, d3_b = nshift("Pia Daily", "15:00")
walk_cap, _bk = note_series({d1_id: d1_b, d2_id: d2_b, d3_id: d3_b}, at(DAY, "07:00"), 16 * 60)
pr.NOTE_PERSON_DAY_CAP = 0
walk_nocap, _bk = note_series({d1_id: d1_b, d2_id: d2_b, d3_id: d3_b}, at(DAY, "07:00"), 16 * 60)
pr.NOTE_PERSON_DAY_CAP = 6
pr.NOTE_BOOK_FRESH_DAYS = 3
stale_book = {"ok": True, "by_key": {"someone": ["2026-09-17T15:00:00Z"]}, "names": {}}
held_book = N({d2_id: d2_b}, at(DAY, "15:30"), notes=stale_book)["due"]
why_book = pr.notes_quiet_why(stale_book, at(DAY, "15:30"))
fresh_book = N({d2_id: d2_b}, at(DAY, "15:30"), notes={"ok": True, "by_key": {"someone": ["2026-09-21T15:00:00Z"]}})
pr.NOTE_BOOK_FRESH_DAYS = 0
check("REVIEW (R11): three shifts owing — at most six note texts to her in the day (it was more without the "
      "ceiling); HUB_NOTE_BOOK_FRESH_DAYS holds every reminder while the book has no recent note, and says why",
      len(walk_cap) == 6 and len(walk_nocap) > 6 and not held_book and "HUB_NOTE_BOOK_FRESH_DAYS" in why_book
      and fresh_book["due"], (walk_cap, walk_nocap))

# (R13) from the calendar, no "did not go" once the shift is over
n22_told = {pr.occasion_key("confirm", "nedlate", "2026-09-23T02:00:00Z", "a0"):
            {"state": "told", "kind": "confirm_ask", "shift_id": n22[0]["id"], "at": pr._utc_iso(at(DAY, "21:30"))}}
n8h = [srow("Ned Late", "22:00", hours=10, verdict="clock_not_read")]
n85 = [srow("Ned Late", "22:00", hours=10.5, verdict="clock_not_read")]
morning = at(DAY + timedelta(days=1), "08:00") + timedelta(seconds=20)
check("REVIEW (R13): at 08:00:20, a 22:00-08:00 shift is over — no calendar 'did not go' about it (nor 'not logged "
      "in' after); a 22:00-08:30 shift still running is told",
      not [r for r in P(n8h, morning, mode="calendar", ledger=n22_told)["due"] if r["kind"] == "hm_no_show"]
      and [r["kind"] for r in P(n85, morning, mode="calendar", ledger=n22_told)["due"]] == ["hm_no_show"])

# (R14) nothing is collected for a no-show the dial or the Desk holds
muted_led = led(("confirm", "a0", "dial_off", "09:30", "confirm_ask"))
held_hm = dict(ASKED, **{pr.occasion_key("hm_no_show", "other", A_ISO, "T+30"):
                         {"state": "held", "kind": "hm_no_show", "shift_id": "S-other",
                          "at": pr._utc_iso(at(DAY, "10:20"))}})
fresh_lane()
pr._load()
pr._R["ledger"].update(muted_led)
check("REVIEW (R14): an ask the dial answered `off`, or a no-show situation the Desk holds, leaves the T+30 wait "
      "out of the lane's collections — and the dial's `off` ends that shift's follow-ups",
      not P(ann(verdict="clock_not_read"), at(DAY, "10:31"), ledger=muted_led)["awaiting"]
      and not P(ann(verdict="clock_not_read"), at(DAY, "10:31"), ledger=held_hm)["awaiting"]
      and P(ann(verdict="clock_not_read"), at(DAY, "10:31"), ledger=ASKED)["awaiting"]
      and AID in pr.stopped_shifts())

# (R15) the Desk's call-offs come from the book: the TSX predicate itself, run over the board's rows
desk_src = (HERE.parent.parent / "src/pages/features/smartcomms/SmartCommsPage.tsx").read_text(encoding="utf-8")
m_loose = re.search(r"const LOOSE_SOURCE = (\"[^\"\n]*\")", desk_src)
m_clock = re.search(r"const ON_THE_CLOCK = (new Set\(\[[^\]]*\]\))", desk_src)
m_pred = re.search(r"const isTodayCallOff = \(r: TodayRow\): boolean =>\s*(.*?)\n\n", desk_src, re.S)
offs_r15 = {k: [{"day": DAY, "spread": 0, "source": "tracker", "kind": "call_off", "at": "2026-09-22T11:05:00Z"}]
            for k in pa.person_keys("Cal Ahead")}
offs_r15.update({k: [{"day": DAY, "spread": 0, "source": "tracker", "kind": "late_show", "at": "2026-09-22T11:05:00Z"}]
                 for k in pa.person_keys("Lu Late")})
loose_r15 = [{"day": DAY, "tokens": {"maria", "lopez"}, "source": "the line (a caller's name)",
              "kind": "reported_call_off", "at": DAY.isoformat()}]
b15 = pa.board([shift("Cal Ahead", "15:00"), shift("Maria Smith", "15:00"), shift("Lu Late", "15:00"),
                shift("Nia Plain", "15:00")], {}, set(), offs_r15, loose_r15, at(DAY, "09:00"), None, (DAY,))
rows15 = sorted((r for r in b15["rows"] if r["row_kind"] == "shift"), key=lambda r: r["person"])
desk_out = None
if m_loose and m_clock and m_pred:
    js = (f"const LOOSE_SOURCE = {m_loose.group(1)}; const ON_THE_CLOCK = {m_clock.group(1)};"
          f"const f = (r) => {m_pred.group(1)};"
          "const rows = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
          "console.log(JSON.stringify(rows.map(f)));")
    try:
        proc = subprocess.run(["node", "-e", js], input=json.dumps(rows15, default=str), capture_output=True,
                              text=True, timeout=60)
        desk_out = json.loads(proc.stdout or "null")
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        desk_out = f"node: {exc}"
check("REVIEW (R15): at 09:00 the Desk lists a 15:00 shift called off at 07:05 (the board says 'upcoming'); a "
      "namesake a caller's name only holds, a late call and somebody with no book are not call-offs",
      [r["person"] for r in rows15] == ["Cal Ahead", "Lu Late", "Maria Smith", "Nia Plain"]
      and rows15[0]["verdict"] == "upcoming" and desk_out == [True, False, False, False], (desk_out, rows15))

# (R15b) a morning no-show read while the shift ran does not vanish from the Desk an hour after it ends: the
# no-call-no-show predicate and the "shift over, no time entry yet" one, both run from the TSX itself
m_ncns = re.search(r"const isNoCallNoShow = \(r: TodayRow\): boolean =>\s*(.*?)\n\n", desk_src, re.S)
m_noentry = re.search(r"const isNoEntryYet = \(r: TodayRow\): boolean =>\s*(.*?)\n\n", desk_src, re.S)
short15 = shift("Real Noshow", "07:00", hours=3.5)
rows15b = []
for hhmm in ("08:05", "11:25", "11:35", "15:00"):
    got15b = pa.board([short15], {}, set(short15["keys"]) | {"someoneelse"}, {}, [], at(DAY, hhmm), at(DAY, hhmm),
                      (DAY,))
    rows15b.append(got15b["rows"][0])
rows15b.append(dict(rows15b[-1], hm_no_show_at="2026-09-22T11:32:00Z"))
desk15b = None
if m_ncns and m_noentry:
    js15b = (f"const a = (r) => {m_ncns.group(1)}; const b = (r) => {m_noentry.group(1)};"
             "const rows = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
             "console.log(JSON.stringify(rows.map((r) => [r.verdict, a(r), b(r)])));")
    try:
        proc15b = subprocess.run(["node", "-e", js15b], input=json.dumps(rows15b, default=str),
                                 capture_output=True, text=True, timeout=60)
        desk15b = json.loads(proc15b.stdout or "null")
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        desk15b = f"node: {exc}"
check("REVIEW (R15b): TODAY'S 07:00-10:30 shift with no entry is a no-call-no-show on the Desk while a read inside "
      "the shift and its hour of grace says 'no punch'; once the board says 'not entered yet' it moves to 'shift "
      "over, no time entry yet' instead of vanishing, and a house manager told keeps it in the no-show list alone",
      desk15b == [["no_punch", True, False], ["no_punch", True, False], ["not_entered_yet", False, True],
                  ["not_entered_yet", False, True], ["not_entered_yet", True, False]], desk15b)

# (R16) TOLD means told — the Desk's no-call-no-show never lists a rehearsed no-show
fresh_lane()
pr._load()
pr._R["ledger"].update({pr.occasion_key("hm_no_show", "annask", A_ISO, "T+30"):
                        {"state": "recorded", "kind": "hm_no_show", "shift_id": AID, "at": "2026-09-22T14:30:00Z"},
                        pr.occasion_key("hm_no_show", "benask", A_ISO, "T+30"):
                        {"state": "told", "kind": "hm_no_show", "shift_id": "S-ben", "at": "2026-09-22T14:30:00Z"}})
check("REVIEW (R16): a no-show written only into the rehearsal book stamps no `hm_no_show_at`; one a manager "
      "received does",
      "hm_no_show_at" not in pr.marks().get(AID, {}) and pr.marks().get("S-ben", {}).get("hm_no_show_at"))

# (R17) "the dial could not be read" is not "the dial is off"
fresh_lane()
pr.refresh(ann(), "psi", at(DAY, "09:30"))
o17 = pr.pending(at(DAY, "09:30").timestamp())
c17 = pr.posted(o17["ids"], {"results": [{"id": i, "state": "dial_unknown"} for i in o17["ids"]]},
                at(DAY, "09:30").timestamp())
early17 = pr.pending(at(DAY, "09:31").timestamp())
pr.refresh(ann(), "psi", at(DAY, "09:40"))
o17b = pr.pending(at(DAY, "09:40").timestamp())
check("REVIEW (R17): `dial_unknown` writes nothing down, waits two minutes (not ten), and the ask is offered again "
      "— the shift's flow goes on",
      c17 == {"dial_unknown": 1} and not pr._R["ledger"] and early17 is None
      and abs(pr._R["post_after"] - (at(DAY, "09:30").timestamp() + pr.DIAL_RETRY_S)) < 1
      and o17b and [r["kind"] for r in o17b["rows"]] == ["confirm_ask"], (c17, o17b))

# (R18) asks that reached only the rehearsal book make the no-show REHEARSAL-ONLY
flip = led(*[("confirm", f"a{k}", "recorded", f"{9 + (30 + 10 * k) // 60:02d}:{(30 + 10 * k) % 60:02d}",
              "confirm_ask" if k == 0 else "confirm_again") for k in range(6)])
flip_hm = P(ann(verdict="clock_not_read"), at(DAY, "10:30"), mode="calendar", ledger=flip)["due"]
flip_led = dict(flip, **led(("hm_no_show", "T+30", "recorded", "10:30", "hm_no_show")))
flip_led[pr.occasion_key("hm_no_show", "annask", A_ISO, "T+30")]["rehearsal"] = True
flip_lm = P(ann(verdict="clock_not_read"), at(DAY, "10:35"), mode="calendar", ledger=flip_led)["due"]
check("REVIEW (R18): the dial flips to send at T+25 — the no-show says she was NOT asked and goes only to the "
      "rehearsal book, and so does the 'not logged in' that follows it",
      [(r["kind"], r["asked"], r["rehearsal_only"]) for r in flip_hm] == [("hm_no_show", False, True)]
      and [(r["kind"], r.get("rehearsal_only")) for r in flip_lm] == [("login_missing", True)], (flip_hm, flip_lm))

# (R19) from the calendar, a missing reply is not proof the shift was not worked
n19_id, n19_b = nshift("Ann Ask", "10:00", worked=False, verdict="clock_not_read")
told_cal = {pr.occasion_key("hm_no_show", "annask", A_ISO, "T+30"):
            {"state": "told", "kind": "hm_no_show", "shift_id": n19_id, "at": "2026-09-22T14:30:00Z",
             "checked": False}}
told_psi = {pr.occasion_key("hm_no_show", "annask", A_ISO, "T+30"):
            {"state": "told", "kind": "hm_no_show", "shift_id": n19_id, "at": "2026-09-22T14:30:00Z",
             "checked": True}}
check("REVIEW (R19): after a calendar no-show (no read behind it) the Daily Note reminders still go; after one a read "
      "of the clock backed, they do not",
      N({n19_id: n19_b}, at(DAY, "17:30"), ledger=told_cal)["due"]
      and not N({n19_id: n19_b}, at(DAY, "17:30"), ledger=told_psi)["due"])

# THE ONE WINDOW, THREE LOCKS: the relay's planner, the shift door and the send
# door (Rpc.gs hubQuietHolds_) must be the same two minutes, and the relay's
# must hold on both sides of daylight saving.
_rpc_src = (HERE.parent.parent / "apps-script" / "Rpc.gs").read_text(encoding="utf-8")
_staff_src = (HERE.parent.parent / "apps-script" / "StaffAlerts.gs").read_text(encoding="utf-8")


def _gs_const(src, name):
    import re as _re  # noqa: PLC0415
    got = _re.search(r"var\s+" + name + r"\s*=\s*'([^']*)'", src)
    return got.group(1) if got else None


_edges = [("2026-09-23T01:30:59", False), ("2026-09-23T01:31:00", True), ("2026-09-22T11:59:00", True),
          ("2026-09-22T12:00:00", False), ("2026-12-16T02:30:59", False), ("2026-12-16T02:31:00", True),
          ("2026-12-16T12:59:00", True), ("2026-12-16T13:00:00", False), ("2026-11-01T12:59:00", True),
          ("2026-11-01T13:00:00", False), ("2027-03-14T11:59:00", True), ("2027-03-14T12:00:00", False)]
_wrong = [iso for iso, want in _edges
          if pr.quiet(datetime.fromisoformat(iso).replace(tzinfo=UTC)) is not want]
check("QUIET WINDOW: the relay, the shift door and the send door hold the same two minutes (21:31 / 08:00, New "
      "York), and the relay's is right in EDT, in EST and on both mornings the clock changes",
      pr.QUIET_FROM == _gs_const(_rpc_src, "HUB_QUIET_FROM") == _gs_const(_staff_src, "STAFF_SHIFT_QUIET_FROM")
      == "21:31"
      and pr.QUIET_TO == _gs_const(_rpc_src, "HUB_QUIET_TO") == _gs_const(_staff_src, "STAFF_SHIFT_QUIET_TO")
      == "08:00"
      and _gs_const(_rpc_src, "HUB_QUIET_TZ") == "America/New_York" and not _wrong,
      (pr.QUIET_FROM, pr.QUIET_TO, _wrong))
check("QUIET WINDOW: the relay reads the send door's quiet answer as NOT NOW — `refused_quiet` is never written "
      "down and is not an ending",
      "refused_quiet" in pr._NOT_NOW and "refused_quiet" not in pr._DONE
      and "if (sms && sms.quiet)" in _staff_src and "answer('refused_quiet'" in _staff_src, "")
# THE FIRST QUIET INSTANT AT OR AFTER A MOMENT — what tells the attendance lane
# that a row it judged has sat through a night (psi_attendance._night_read_due).
_fall = date(2026, 11, 1)
check("QUIET WINDOW: the window's next start is 21:31 the same evening from noon, the moment itself from 23:00, "
      "and 21:31 EST on the day the clock falls back",
      pr.quiet_begins(at(DAY, "12:00")) == at(DAY, "21:31")
      and pr.quiet_begins(at(DAY, "23:00")) == at(DAY, "23:00")
      and pr.quiet_begins(at(DAY, "08:00")) == at(DAY, "21:31")
      and pr.quiet_begins(at(_fall, "10:00")) == at(_fall, "21:31")
      and pr.quiet_begins(at(_fall, "10:00")).isoformat().endswith("02:31:00+00:00"),
      pr.quiet_begins(at(_fall, "10:00")))

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
