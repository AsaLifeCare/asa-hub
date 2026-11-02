#!/usr/bin/env python3
"""The time clock's absences, asserted offline against the real functions; no outbound door can be reached."""
import importlib
import json
import os
import sys
import tempfile
import time
import urllib.request
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
SERVER = HERE.parent.parent / "server"
TMP = Path(tempfile.mkdtemp(prefix="psi-attendance-"))
SECRET = TMP / "psianywhere.json"
os.environ.update({
    "HUB_PSI_BASE": "https://psianywhere.invalid",
    "HUB_PSI_SECRET_FILE": str(SECRET),
    "HUB_PSI_TY_SECRET_FILE": str(TMP / "psianywhere-ty.json"),
    "HUB_PSI_ATTENDANCE_STATE": str(TMP / "state.json"),
    "HUB_PSI_LOGIN_CLOCK_FILE": str(TMP / "login-clock.json"),
    "HUB_SNAPSHOT_OUT": str(TMP),
    "HUB_PSI_WIRE_GAP_S": "0",
})
sys.path.insert(0, str(SERVER))


def _no_network(*_a, **_k):
    raise AssertionError("the test tried to reach the network")


urllib.request.urlopen = _no_network

import psi_anywhere as psi  # noqa: E402
import psi_attendance as pa  # noqa: E402

pa._call = _no_network
OHIO, UTC = pa.OHIO, timezone.utc

results = {"ok": 0, "failed": []}


def check(name, cond, detail=""):
    if cond:
        results["ok"] += 1
        print(f"ok   {name}")
    else:
        results["failed"].append(name)
        print(f"FAIL {name}{(' — ' + str(detail)[:400]) if detail else ''}")


def at(day, hhmm):
    h, m = hhmm.split(":")
    return datetime(day.year, day.month, day.day, int(h), int(m), tzinfo=OHIO).astimezone(UTC)


def write_secret(password="p"):
    # the size moves with the password, so the stamp moves even inside one tick
    SECRET.write_text(json.dumps({"user": "someone", "pass": password}), encoding="utf-8")


def fake_call(answers):
    calls = []

    def _fake(method, body, timeout):
        calls.append((method, body))
        got = answers[method]
        return got(body) if callable(got) else got
    return _fake, calls


def methods(calls):
    return [m for m, _b in calls]


# the refusal's special_data 652 is why special_data alone is not a login
REFUSAL = ('<results><permissions><window_name>Invalid username</window_name>'
           '<permission></permission><special_data>652</special_data></permissions></results>')
NOT_ACTIVE = ('<results><permissions><window_name>Not active</window_name>'
              '<permission></permission><special_data>3</special_data></permissions></results>')
TOKEN = ('<results><permissions><window_name>Token</window_name>'
         '<permission></permission><special_data>ABC123</special_data></permissions></results>')
REFUSAL_BODY = ('{"getLogInResult":"<results><permissions><window_name>Invalid username<\\/window_name>'
                '<permission><\\/permission><special_data>652<\\/special_data><\\/permissions><\\/results>"}')

DAY = date(2026, 9, 22)
L, W, G = pa.LATE_AFTER_MIN, pa.CHECK_WINDOW_MIN, pa.MIN_GAP_MIN

# the plan
REAL_STARTS = ["00:00", "01:00", "06:30", "07:00", "08:00", "08:30", "09:00", "10:30",
               "13:00", "14:00", "14:30", "15:00", "16:30", "18:30", "19:30", "20:00",
               "21:00", "21:30", "22:00", "22:30", "23:00"]
starts = [at(DAY, s) for s in REAL_STARTS]
plan = pa.day_plan(starts, None, at(DAY + timedelta(days=1), "06:00"))
shown = [p.astimezone(OHIO).strftime("%H:%M") for p in plan]
check("no shift waiting, no collection", pa.next_collection([], None) is None)
check("a week's every start in one day is still a handful of logins, not a hundred",
      len(plan) <= 11, shown)
check("no two logins closer than the minimum gap",
      all((b - a) >= timedelta(minutes=G) for a, b in zip(plan, plan[1:])), shown)
uncovered = [s.astimezone(OHIO).strftime("%H:%M") for s in starts
             if not any(s + timedelta(minutes=L) <= p <= s + timedelta(minutes=L + W) for p in plan)]
check("every real start is looked at between its late point and the end of its window",
      not uncovered, uncovered)
night = [at(DAY, "22:00"), at(DAY, "23:00"), at(DAY + timedelta(days=1), "00:00")]
nplan = pa.day_plan(night, None, at(DAY + timedelta(days=1), "06:00"))
check("the starts either side of midnight are covered",
      all(any(s + timedelta(minutes=L) <= p <= s + timedelta(minutes=L + W) for p in nplan)
          for s in night), [p.isoformat() for p in nplan])
check("the collection is the last minute of the earliest open start's window",
      pa.next_collection([at(DAY, "06:30"), at(DAY, "07:00")], None) == at(DAY, "07:50"))
check("a shift a failed collection could not judge is tried again one gap later",
      pa.next_collection([at(DAY, "22:00"), at(DAY, "23:00")], at(DAY, "23:20")) == at(DAY + timedelta(days=1), "00:20"))
spring = date(2026, 3, 8)
s_at = datetime(2026, 3, 8, 1, 30, tzinfo=OHIO).astimezone(UTC)
check("across the spring change the window is real minutes, not wall minutes",
      pa.next_collection([s_at], None) == s_at + timedelta(minutes=L + W)
      and pa._mins(datetime(2026, 3, 8, 3, 0, tzinfo=OHIO), s_at) == 30.0)

# what the clock says
check("a refusal's special_data is not a token", pa.read_login(REFUSAL) == ("", "Invalid username"))
check("Not active is not a login", pa.read_login(NOT_ACTIVE) == ("", "Not active"))
check("Token is a login", pa.read_login(TOKEN) == ("ABC123", "Token"))
check("Token with an empty special_data is not a login", pa.read_login(TOKEN.replace("ABC123", ""))[0] == "")
check("an answer with no window_name carries no word at all", pa.read_login("<results/>") == ("", ""))
check("the probe reads the account's word off the raw JSON body",
      psi.account_word(REFUSAL_BODY) == "Invalid username")

# names
k = pa.person_keys
check("an apostrophe does not split a person", k("Na'tajiah Lackey") & k("Natajiah Lackey"))
check("surname-first is the same person", k("Lackey, Natajiah") & k("Natajiah Lackey"))
check("a different spelling is a different key, never a guess", not (k("Lauren Baker") & k("Lauran Baker")))
check("a live entry is named by firstname and lastname",
      pa.entry_name({"firstname": "Natajiah", "lastname": "Lackey"}) == "Natajiah Lackey")
check("the roster's placeholder rows are not people",
      all(pa.not_a_person(n) for n in ("FAMILY", "Nurse", "OPEN", "WORKSHOP (MC)", "WORKSHOP (KAH)"))
      and not pa.not_a_person("Nursella Smith"))

# spans and arrivals
row = {"Date_of_Service": "9/22/2026 12:00:00 AM", "start_time": "07:58:00", "end_time": ""}
check("an open entry reads as open", pa.entry_span(row) == (at(DAY, "07:58"), None))
began, ended = pa.entry_span(dict(row, start_time="21:00:00", end_time="23:59:59"))
check("an entry closed at 23:59:59 ends that night", began == at(DAY, "21:00") and ended > at(DAY, "23:58"))
E8, E16 = at(DAY, "08:00"), at(DAY, "16:00")
check("a morning entry says nothing about the evening shift",
      pa.arrival(at(DAY, "22:00"), at(DAY + timedelta(days=1), "08:00"),
                 [(at(DAY, "07:00"), at(DAY, "15:00"))], at(DAY, "23:10")) is None)
check("an entry begun just before the start is on time",
      pa.arrival(at(DAY, "22:00"), at(DAY + timedelta(days=1), "08:00"),
                 [(at(DAY, "21:55"), None)], at(DAY, "23:10")) == at(DAY, "22:00"))
check("a night entry closed at 08:05 does not cover the 08:00 shift — she went home",
      pa.arrival(E8, E16, [(at(DAY, "00:00"), at(DAY, "08:05"))], at(DAY, "09:20")) is None)
check("an entry open from the night through the start covers it (a double)",
      pa.arrival(E8, E16, [(at(DAY - timedelta(days=1), "22:00"), None)], at(DAY, "09:20")) == E8)
check("an entry left open since the morning does not cover the night",
      pa.arrival(at(DAY, "22:00"), at(DAY + timedelta(days=1), "08:00"),
                 [(at(DAY, "07:00"), None)], at(DAY, "23:20")) is None)
check("a punch after the start is the arrival",
      pa.arrival(E8, E16, [(at(DAY, "08:35"), None)], at(DAY, "09:20")) == at(DAY, "08:35"))
E10, E18 = at(DAY, "10:00"), at(DAY, "18:00")
check("REGRESSION: an entry that ENDED before a shift that has not begun is not its clock-in (06:00-07:55, "
      "looked at 08:05 for a 10:00 shift) — it was a false early clock-in to the house manager",
      pa.arrival(E10, E18, [(at(DAY, "06:00"), at(DAY, "07:55"))], at(DAY, "08:05")) is None)
check("REGRESSION: nor ten minutes before the start (a night entry closed 07:45, an 08:00 shift at 07:55) — it "
      "silenced the five-minute reminder",
      pa.arrival(E8, E16, [(at(DAY, "00:00"), at(DAY, "07:45"))], at(DAY, "07:55")) is None)
check("while an entry still OPEN before the start is the clock-in, early or not",
      pa.arrival(E10, E18, [(at(DAY, "09:30"), None)], at(DAY, "09:40")) == E10)
Y = DAY - timedelta(days=1)
check("REGRESSION: an entry that began once the shift was OVER is another shift's — the next morning's 07:45 "
      "clock-in read as yesterday's 14:30-22:00 shift '1035 minutes late'",
      pa.arrival(at(Y, "14:30"), at(Y, "22:00"), [(at(DAY, "07:45"), None)], at(DAY, "09:33")) is None)
check("while an entry begun late but before the end is still that shift's late arrival",
      pa.arrival(E8, E16, [(at(DAY, "15:00"), None)], at(DAY, "15:30")) == at(DAY, "15:00"))


# the verdict
def shift(name, hhmm, day=DAY, hours=8):
    s_at = at(day, hhmm)
    return {"person_key": "".join(c for c in name.lower() if c.isalnum()),
            "keys": pa.person_keys(name), "name": name, "house": "H1", "shift_code": hhmm,
            "shift_date": day, "shift_at": s_at, "shift_end": s_at + timedelta(hours=hours)}


def keyed(*names):
    return set().union(*(pa.person_keys(n) for n in names))


now = at(DAY, "09:20")
shifts = [shift("Ann Ontime", "08:00"), shift("Bob Latearrive", "08:00"), shift("Cy Noshow", "07:55"),
          shift("Di Nopunchyet", "08:50"), shift("Ed Calledoff", "08:00"),
          shift("Fay Rangyesterday", "08:00"), shift("Gus Newhire", "08:00"),
          shift("Hal Future", "09:15"), shift("Ivy Judged", "08:00"), shift("Kim Caller", "08:00")]
index = {}
for name, b in (("Ann Ontime", "07:52"), ("Bob Latearrive", "08:35"), ("Ivy Judged", "07:50")):
    for key in pa.person_keys(name):
        index.setdefault(key, []).append((at(DAY, b), None))
recent = keyed("Ann Ontime", "Bob Latearrive", "Cy Noshow", "Di Nopunchyet", "Ed Calledoff",
               "Fay Rangyesterday", "Hal Future", "Ivy Judged", "Kim Caller")
offs = {}
for key in pa.person_keys("Ed Calledoff"):
    offs.setdefault(key, []).append({"day": DAY, "spread": 0, "source": "tracker"})
for key in pa.person_keys("Fay Rangyesterday"):
    offs.setdefault(key, []).append({"day": DAY - timedelta(days=1), "spread": 1, "source": "live queue"})
loose = [{"day": DAY, "tokens": frozenset({"kim"}), "source": "the line (a caller's name)"}]
judged_before = {pa.shift_id(shifts[8])}
found = pa.judge(shifts, index, recent, offs, loose, judged_before, now)
late = {r["person"]: r for r in found["late"]}
nocall = {r["person"]: r for r in found["no_call"]}
sk = found["skipped"]
closed = set(found["judged"])
check("on the clock is not named", "Ann Ontime" not in late and "Ann Ontime" not in nocall)
check("a late punch is late, with the minutes the clock measured",
      late.get("Bob Latearrive", {}).get("minutes_late") == 35, late.get("Bob Latearrive"))
check("no punch an hour and more in is a no-call", "Cy Noshow" in nocall, found)
check("no punch half an hour in names nobody yet and stays open",
      "Di Nopunchyet" not in late and "Di Nopunchyet" not in nocall
      and pa.shift_id(shifts[3]) not in closed and sk.get("no_punch_yet") == 1, sk)
check("a typed call-off on the day is a human's to tell", "Ed Calledoff" not in nocall)
check("a call to the line the day before covers an overnight or next-day shift", "Fay Rangyesterday" not in nocall)
check("a caller the line could not put a name to still holds a shift that shares the name",
      "Kim Caller" not in nocall and sk.get("told_by_a_human") == 3, sk)
check("a name the clock has not seen lately is listed, never named",
      "Gus Newhire" in found["not_seen"] and "Gus Newhire" not in nocall, found["not_seen"])
pooled = {}
for key in pa.person_keys("Ed Calledoff"):
    pooled.setdefault(key, []).append({"day": DAY, "spread": 0, "source": "tracker",
                                       "kind": "call_off"})
added = pa.pool_call_offs([
    {"open_row": "Cy Noshow", "col_iso": DAY.isoformat(),
     "opened_at": datetime(DAY.year, DAY.month, DAY.day, 5, 0, tzinfo=timezone.utc)},
    {"open_row": "Ed Calledoff", "col_iso": DAY.isoformat(), "opened_at": None},
    {"open_row": "OPEN", "col_iso": "not a day", "opened_at": None}], pooled)
cy_off = next((f for k in pa.person_keys("Cy Noshow") for f in pooled.get(k, ())), None)
check("a call-off marked on the calendar is a human's word about the shift: the caller is told-by-a-"
      "human, never a no-call", added == 1 and cy_off is not None
      and cy_off["kind"] == "call_off" and cy_off["source"] == "house calendars"
      and pa.told_by_a_human(shifts[2], pooled, []) is not None, [added, cy_off])
check("…and one the books already hold for that person and day is not counted twice",
      sum(1 for k in pa.person_keys("Ed Calledoff") for _f in pooled.get(k, ()))
      == len(pa.person_keys("Ed Calledoff")), pooled)
check("a shift not yet late is left for later", sk.get("not_yet") == 1 and pa.shift_id(shifts[7]) not in closed)
check("a shift judged before is not judged again", sk.get("judged_before") == 1)
check("every row carries the shift's own day",
      all(r["day"] == DAY.isoformat() for r in found["late"] + found["no_call"]))
check("every row says the time clock learned it, and a late punch carries its arrival",
      all(r.get("source") == "time_clock" for r in found["late"] + found["no_call"])
      and late.get("Bob Latearrive", {}).get("arrived") == "08:35", late.get("Bob Latearrive"))
again = pa.judge(shifts, index, recent, offs, loose, closed | judged_before, at(DAY, "10:20"))
check("the next collection names the one left open as a no-call — once, and nobody twice",
      sorted(r["person"] for r in again["no_call"]) == ["Di Nopunchyet", "Hal Future"]
      and not again["late"], again)
evening = pa.judge([shift("Jo Evening", "20:00", hours=12)],
                   {kk: [(at(DAY, "07:00"), at(DAY, "15:00"))] for kk in pa.person_keys("Jo Evening")},
                   keyed("Jo Evening"), {}, [], set(), at(DAY, "21:20"))
check("a morning punch does not vouch for the evening", [r["person"] for r in evening["no_call"]] == ["Jo Evening"])
crowd = [shift(f"Person {chr(65 + i)}{chr(65 + i)}", "07:00") for i in range(15)]
many = pa.judge(crowd, {}, set().union(*(s["keys"] for s in crowd)), {}, [], set(), now)
check("one pass names at most the cap, and the overflow stays open for the next",
      len(many["no_call"]) == pa.MAX_PER_PASS and many["capped"] == 3
      and len([s for s in crowd if pa.shift_id(s) in set(many["judged"])]) == pa.MAX_PER_PASS, many["capped"])
stale = pa.judge([shift("Old Shift", "05:00", day=DAY - timedelta(days=1))], {}, keyed("Old Shift"),
                 {}, [], set(), at(DAY, "09:20"))
check("a shift past the stale bound (a whole day) is a report, not an alert",
      not stale["no_call"] and stale["skipped"].get("stale") == 1)
kept = pa.judge([shift("Morning Shift", "05:00")], {}, keyed("Morning Shift"), {}, [], set(), at(DAY, "13:20"))
check("a shift from this morning is still owed after an outage — a shift closes only on a real read",
      [r["person"] for r in kept["no_call"]] == ["Morning Shift"], kept)

# the entries typed after the read
def entry(eid, first, last, day, start, end=""):
    return {"Single_Entry_ID": eid, "firstname": first, "lastname": last, "Anywhere_status": "A",
            "Date_of_Service": f"{day.month}/{day.day}/{day.year} 12:00:00 AM",
            "start_time": start, "end_time": end}


SEVEN = [shift("Lana Evers", "07:00", day=Y, hours=7.5), shift("Mat Collis", "22:00", day=Y, hours=10),
         shift("Shay Kong", "22:00", day=Y, hours=10), shift("Lora Bakes", "14:30", day=Y, hours=7.5),
         shift("Reg Bow", "14:30", day=Y, hours=7.5), shift("Kam Kid", "14:30", day=Y, hours=7.5),
         shift("Mae Warr", "15:00", day=Y, hours=8.5)]
AT_0729 = [entry(77730, "Lora", "Bakes", Y, "00:00:00", "08:00:00"),
           entry(77766, "Kam", "Kid", Y, "00:00:00", "08:12:00"),
           entry(77761, "Reg", "Bow", Y, "00:00:00", "07:45:00"),
           entry(77720, "Mae", "Warr", Y - timedelta(days=1), "15:00:00", "23:30:00"),
           entry(77751, "Lana", "Evers", Y, "00:00:00", "07:00:00"),
           entry(77724, "Mat", "Collis", Y, "00:00:00", "08:02:00"),
           entry(77715, "Shay", "Kong", Y - timedelta(days=1), "08:00:00", "21:33:00")]
TYPED_LATER = [entry(77783, "Lana", "Evers", Y, "07:00:00", "14:30:00"),
               entry(77785, "Lora", "Bakes", DAY, "07:45:00"),
               entry(77786, "Mat", "Collis", Y, "22:00:00", "23:59:59"),
               entry(77789, "Mat", "Collis", DAY, "00:00:00", "08:06:00"),
               entry(77794, "Shay", "Kong", Y, "22:13:00", "23:59:59"),
               entry(77795, "Shay", "Kong", DAY, "00:00:00", "08:16:00")]
known7 = set().union(*(s["keys"] for s in SEVEN))
first_read = pa.board(SEVEN, pa.punch_index(AT_0729)[0], known7, {}, [], at(DAY, "07:29"),
                      at(DAY, "07:29"), (Y, DAY))
v1 = {r["person"]: r["verdict"] for r in first_read["rows"] if r["row_kind"] == "shift"}
check("THE SEVEN, AT THE 07:29 READ: the five shifts that were over are 'not entered yet' — unknown, never "
      "'no punch'; the two nights still running at 07:29 stand 'no punch', the live half the reminders rest on",
      [v1[n] for n in ("Lana Evers", "Lora Bakes", "Reg Bow", "Kam Kid", "Mae Warr")] == ["not_entered_yet"] * 5
      and [v1[n] for n in ("Mat Collis", "Shay Kong")] == ["no_punch"] * 2, v1)
judged7 = pa.judge(SEVEN, pa.punch_index(AT_0729)[0], known7, {}, [], set(), at(DAY, "07:29"))
over5 = {pa.shift_id(s) for s in SEVEN if s["name"] in ("Lana Evers", "Lora Bakes", "Reg Bow", "Kam Kid",
                                                         "Mae Warr")}
check("REVIEW: THE JUDGE KEEPS THE BOARD'S RULE — at the same 07:29 read it names none of the five shifts the "
      "board calls 'not entered yet' (it named the four inside the day, and the door held them as no-calls): "
      "those four close as 'not_entered_yet', the 07:00 one of the day before as stale, and only the two "
      "nights still running are no-calls",
      sorted(r["person"] for r in judged7["no_call"]) == ["Mat Collis", "Shay Kong"]
      and not judged7["late"] and judged7["skipped"] == {"not_entered_yet": 4, "stale": 1}
      and over5 <= set(judged7["judged"]), judged7["skipped"])
lana = [s for s in SEVEN if s["name"] == "Lana Evers"]
edge_j = pa.judge(lana, {}, known7, {}, [], set(), lana[0]["shift_end"] + timedelta(minutes=59))
past_j = pa.judge(lana, {}, known7, {}, [], set(), lana[0]["shift_end"] + timedelta(minutes=60))
check("and the line is the board's own (ENTRY_GRACE_MIN): 59 minutes past the end the judge still names the "
      "no-call, 60 minutes past it names nobody",
      [r["person"] for r in edge_j["no_call"]] == ["Lana Evers"] and not past_j["no_call"]
      and past_j["skipped"] == {"not_entered_yet": 1}, (edge_j, past_j))
later = pa.board(SEVEN, pa.punch_index(AT_0729 + TYPED_LATER)[0], known7, {}, [], at(DAY, "09:33"),
                 at(DAY, "09:33"), (Y, DAY))
v2 = {r["person"]: r for r in later["rows"] if r["row_kind"] == "shift"}
check("THE SEVEN, ONCE THE LATE ENTRIES ARE READ: the day shift typed the next morning and the two nights "
      "typed at clock-out are clock-ins, the 22:13 start on time",
      [v2[n]["verdict"] for n in ("Lana Evers", "Mat Collis", "Shay Kong")] == ["punched_on_time"] * 3
      and v2["Shay Kong"]["arrived"] == "22:13" and v2["Mat Collis"]["entry_id"] == "77786",
      {n: (v2[n]["verdict"], v2[n]["arrived"]) for n in ("Lana Evers", "Mat Collis", "Shay Kong")})
check("REGRESSION: the next morning's 07:45 clock-in is not yesterday's 14:30 shift 'late' — that shift is "
      "not entered yet, and the clock-in is a punch of its own day",
      v2["Lora Bakes"]["verdict"] == "not_entered_yet" and v2["Lora Bakes"]["arrived"] == ""
      and [(r["day"], r["arrived"]) for r in later["rows"] if r["row_kind"] == "punch"
           and r["entry_id"] == "77785"] == [(DAY.isoformat(), "07:45")],
      (v2["Lora Bakes"], [r for r in later["rows"] if r["row_kind"] == "punch"]))
check("and the four with nothing typed stay 'not entered yet', never 'no punch'",
      [v2[n]["verdict"] for n in ("Lora Bakes", "Reg Bow", "Kam Kid", "Mae Warr")] == ["not_entered_yet"] * 4)
today7 = [shift("Reg Bow", "07:00", hours=3.5)]
running = pa.board(today7, {}, known7, {}, [], at(DAY, "09:33"), at(DAY, "09:33"), (DAY,))
after = pa.board(today7, {}, known7, {}, [], at(DAY, "11:31"), at(DAY, "11:31"), (DAY,))
check("while the shift RUNS the live half is unchanged — no entry 150 minutes in is 'no punch' (the reminders "
      "and the house manager rest on it); an hour past the end, 'not entered yet'",
      running["rows"][0]["verdict"] == "no_punch" and after["rows"][0]["verdict"] == "not_entered_yet"
      and after["rows"][0]["checked_at"].startswith("2026-09-22T11:31"), (running["rows"], after["rows"]))
edge = pa.board(today7, {}, known7, {}, [], at(DAY, "11:29"), at(DAY, "11:29"), (DAY,))
check("an hour past the end is the line (ENTRY_GRACE_MIN): a minute before it, still 'no punch'",
      edge["rows"][0]["verdict"] == "no_punch" and pa.ENTRY_GRACE_MIN == 60, edge["rows"])

import psi_entries  # noqa: E402

_entries_dir = psi_entries.ENTRY_DIR
psi_entries.ENTRY_DIR = TMP / "entries-union"
psi_entries.upsert([entry(501, "Ann", "Approved", DAY, "07:55:00")], at(DAY, "08:30"))
joined = pa._read_index([entry(502, "Bo", "Other", DAY, "08:00:00")], DAY - timedelta(days=2), DAY)
ann_shift = shift("Ann Approved", "08:00")
by_union = pa.judge([ann_shift], joined, keyed("Ann Approved"), {}, [], set(), at(DAY, "09:20"))
by_read = pa.judge([ann_shift], pa.punch_index([entry(502, "Bo", "Other", DAY, "08:00:00")])[0],
                   keyed("Ann Approved"), {}, [], set(), at(DAY, "09:20"))
check("REGRESSION: an approved punch the queues no longer list is still seen — the judge closes the shift on "
      "the clock instead of naming a no-call",
      not by_union["no_call"] and by_union["skipped"].get("on_the_clock") == 1
      and [r["person"] for r in by_read["no_call"]] == ["Ann Approved"], (by_union, by_read["no_call"]))
psi_entries.ENTRY_DIR = _entries_dir

pa._S.clear()
pa._S.update({"pending": [{"person": "Pat Typedlate", "day": DAY.isoformat(), "kind": "no_call",
                           "shift_at": at(DAY, "08:00").isoformat(), "_id": "pattypedlate|x", "_offers": 0}],
              "post_after": 0.0, "judged": {}, "seen": {}, "last_done": "", "session": {}, "clock": {},
              "read_at": "", "backoff": {}, "relogin_rest": {}, "follow_ups": {}, "session_life": {},
              "reading_since": ""})
pa._CACHE.update({"offs": {}, "loose": []})
pa._BOARD["rows"] = [{"row_kind": "shift", "id": "pattypedlate|x", "verdict": "no_punch"}]
check("a no-call still missing on the board is offered to the door",
      [r["person"] for r in (pa.pending(at(DAY, "09:21").timestamp()) or {}).get("no_call", [])]
      == ["Pat Typedlate"])
pa._BOARD["rows"] = [{"row_kind": "shift", "id": "pattypedlate|x", "verdict": "punched_on_time"}]
check("REGRESSION: a no-call whose entry was typed before the door took it is let go, not sent",
      pa.pending(at(DAY, "09:22").timestamp()) is None and not pa._S["pending"])
pa._BOARD["rows"] = [{"row_kind": "shift", "id": f"{v}|x", "verdict": v, "known": True,
                      "shift_at": at(DAY, "08:00").isoformat(), "shift_end": at(DAY, "16:00").isoformat()}
                     for v in ("no_punch", "not_entered_yet")]
check("REVIEW: no follow-up collection is made for a 'not entered yet' shift — it backs no message, so a read "
      "for it buys nothing (the 'no punch' beside it is still followed up)",
      [r["verdict"] for r in pa._missing(at(DAY, "10:00"))] == ["no_punch"])
pa._S.clear()
pa._BOARD.update({"at": 0.0, "rows": [], "status": {}})

# the reads that must fail loudly
for label, answers in (("a supervisor list with nobody in it", {"getSingleEntrySupervisorsJSON": [{"person_id": None}]}),
                       ("a refusal where the supervisor list should be", {"getSingleEntrySupervisorsJSON": "Not active"}),
                       ("an empty answer where a supervisor's entries should be",
                        {"getSingleEntrySupervisorsJSON": [{"person_id": 74}], "singleEntryFilterAdminListJSON": ""})):
    pa._call, _ = fake_call(answers)
    try:
        pa.entries("t", DAY, DAY)
        check(f"{label} is not an empty day", False)
    except pa.PsiAnswer:
        check(f"{label} is not an empty day", True)
index2, counts2 = pa.punch_index([{"employee": "x", "start_time": "08:00:00", "Date_of_Service": "9/22/2026"}])
check("entries with no firstname/lastname are counted, not keyed", not index2 and counts2.get("no_name") == 1)

# the one login clock
write_secret("p")
psi.forget_login()
pa._call, calls = fake_call({"getLogIn": REFUSAL})
signed = pa._sign_in()
check("a refused login is sent once and read as a refusal",
      signed["sent"] and not signed["token"] and signed["word"] == "Invalid username", signed)
ok, why = psi.login_would_allow()
check("after a refusal, no lane may log in", not ok and "refused" in why, why)
signed2 = pa._sign_in()
check("the attendance lane is held by the shared clock too", not signed2["sent"] and len(calls) == 1, calls)
saved_clock = json.loads((TMP / "login-clock.json").read_text())
check("the refusal is on disk the moment it is heard", (saved_clock.get("refused") or {}).get("word") == "Invalid username", saved_clock)
psi._login_state.update({"at": 0.0, "misses": 0, "rested_until": 0.0, "refused": None})
psi._login_load()
check("a restart comes back still refused", not psi.login_would_allow()[0])
ok_later, _ = psi.login_would_allow(time.time() + psi.PSI_LOGIN_REFUSED_REST_S + 1)
check("a day later, one more try is allowed", ok_later)
write_secret("pp")
ok2, why2 = psi.login_would_allow(time.time() + psi.PSI_LOGIN_GAP_S + 1)
check("re-saving the credential file lifts the refusal (the few-minute gap still stands)",
      ok2 and psi._login_state["refused"] is None, why2)
psi.forget_login()
ok3, _ = psi.login_claim("probe")
ok4, why4 = psi.login_claim("attendance")
check("two lanes never both find the clock free", ok3 and not ok4, why4)
psi.forget_login()
pa._call, calls = fake_call({"getLogIn": "<results>something else</results>"})
signed3 = pa._sign_in()
check("an answer without a window_name is not the account refusing",
      signed3["sent"] and not signed3["word"] and psi._login_state["refused"] is None, signed3)
psi.forget_login()
(TMP / "login-clock.json").write_text("{not json", encoding="utf-8")
psi._login_load()
check("a login clock that cannot be read holds every login", not psi.login_would_allow(time.time() + 999)[0])
psi.forget_login()

# the pass, end to end
ROSTER = [shift("Ann Ontime", "08:00"), shift("Cy Noshow", "08:00"), shift("Gus Newhire", "08:00"),
          shift("Ed Calledoff", "08:00"), shift("Di Late", "08:50"), shift("Hal Later", "14:00")]
pa.roster = lambda dsn, a, b: (list(ROSTER), Counter(no_hour=7, not_a_person=2))
pa.called_off = lambda dsn, a, b: (offs, [], "tracker newest 2026-09-22")
ALWAYS_SEEN = [("Hal", "Later"), ("Cy", "Noshow"), ("Di", "Late"), ("Ed", "Calledoff")]


def punches(body):
    rows = [{"Single_Entry_ID": 1, "firstname": "Ann", "lastname": "Ontime",
             "Date_of_Service": "9/22/2026 12:00:00 AM", "start_time": "07:55:00", "end_time": ""}]
    for i, (f, l) in enumerate(ALWAYS_SEEN):
        rows.append({"Single_Entry_ID": 10 + i, "firstname": f, "lastname": l,
                     "Date_of_Service": "9/21/2026 12:00:00 AM", "start_time": "06:00:00",
                     "end_time": "07:00:00"})
    return rows


def restart():
    pa._S.clear()
    pa._CACHE.update({"at": 0.0, "shifts": [], "offs": {}, "loose": [], "plan_said": "", "held_said": ""})
    pa._BOARD.update({"at": 0.0, "rows": [], "status": {}})
    psi._login_state.update({"at": 0.0, "misses": 0, "rested_until": 0.0, "refused": None,
                             "paused_until": 0.0, "paused_why": ""})
    psi._login_load()


state_file = Path(os.environ["HUB_PSI_ATTENDANCE_STATE"])
state_file.unlink(missing_ok=True)
(TMP / "login-clock.json").unlink(missing_ok=True)
restart()
pa._call, calls = fake_call({"getLogIn": TOKEN, "getSingleEntrySupervisorsJSON": [{"person_id": 74}],
                             "singleEntryFilterAdminListJSON": punches})
r0 = pa.tick("dsn", at(DAY, "07:00"))
check("a quiet morning before any start signs in to nothing", r0["state"] == "waiting" and not calls, (r0, calls))
r1 = pa.tick("dsn", at(DAY, "09:25"))
check("the first start of this version inherits the refusal on record and does not log in",
      r1["state"] == "held" and not calls, (r1, calls))
write_secret("ppp")
r2 = pa.tick("dsn", at(DAY, "09:26"))
check("once the credential file changes, the due collection signs in once",
      r2["state"] == "told" and methods(calls).count("getLogIn") == 1, (r2, methods(calls)))
entry_bodies = [b for m, b in calls if m == "singleEntryFilterAdminListJSON"]
check("the read reaches the board's own days (HISTORY_DAYS back), past the entries still open from the day "
      "before — and on ONE request per queue, with no second login",
      entry_bodies and entry_bodies[0]["startDate"] == "2026-09-20" and pa.HISTORY_DAYS == 2
      and methods(calls) == ["getLogIn", "getSingleEntrySupervisorsJSON", "singleEntryFilterAdminListJSON"],
      (entry_bodies[:1], methods(calls)))
offer = pa.pending(at(DAY, "09:27").timestamp())
check("the no-show waits for the door with its day; the one not seen lately is not in it",
      offer and [r["person"] for r in offer["no_call"]] == ["Cy Noshow"]
      and offer["no_call"][0]["day"] == DAY.isoformat() and "_id" not in offer["no_call"][0], offer)
r3 = pa.tick("dsn", at(DAY, "09:40"))
check("the next minute signs in to nothing", r3["state"] == "waiting" and methods(calls).count("getLogIn") == 1, r3)
saved = json.loads(state_file.read_text())
check("the state outlives the process", saved["last_done"] and saved["judged"] and saved["pending"], sorted(saved))
restart()
r4 = pa.tick("dsn", at(DAY, "09:41"))
check("a restart does not buy another login", r4["state"] == "waiting" and methods(calls).count("getLogIn") == 1, r4)
psi.forget_login()
r5 = pa.tick("dsn", at(DAY, "10:26"))
check("the shift left open (no punch at 36 minutes) is collected once more and named a no-call — on the "
      "KEPT session, with no second login",
      r5["state"] == "told" and methods(calls).count("getLogIn") == 1
      and methods(calls).count("getSingleEntrySupervisorsJSON") == 2
      and [r["person"] for r in (pa.pending(at(DAY, "10:26").timestamp()) or {}).get("no_call", [])]
      == ["Cy Noshow", "Di Late"],
      (r5, methods(calls)))
check("NO EXTRA LOGIN FOR THE HISTORY: the second collection reads the same reach back on the kept session — "
      "two collections, one login, one request per queue each",
      [b["startDate"] for m, b in calls if m == "singleEntryFilterAdminListJSON"] == ["2026-09-20"] * 2
      and methods(calls).count("getLogIn") == 1 and len(calls) == 5, methods(calls))
T = at(DAY, "10:27").timestamp()
offer = pa.pending(T)
pa.post_failed(T)
check("a door that refused waits before the rows are offered again", pa.pending(T) is None)
check("and offers them after", pa.pending(T + pa.POST_RETRY_S + 1) is not None)
pa.posted(offer["ids"], {"told": 0, "held": 2, "skipped": 0}, T)
check("a pass the door held entirely is kept for one more offer, an hour on",
      pa.pending(T + 60) is None and pa.pending(T + pa.HELD_RETRY_S + 1) is not None)
pa.posted(offer["ids"], {"told": 0, "held": 2, "skipped": 0}, T)
check("held twice, it is let go", pa.pending(T + pa.HELD_RETRY_S + 1) is None)
pa._S["pending"].append({"person": "Old Row", "day": (DAY - timedelta(days=1)).isoformat(),
                         "shift_at": at(DAY - timedelta(days=1), "02:00").isoformat(),
                         "_id": "x|old", "kind": "no_call", "_offers": 0})
pa._S["post_after"] = 0.0
check("a row gone stale while the door was down is let go, not sent", pa.pending(T) is None)
pa._S["pending"].append({"person": "Ed Calledoff", "day": DAY.isoformat(),
                         "shift_at": at(DAY, "10:00").isoformat(), "_id": "e|now", "kind": "no_call", "_offers": 0})
check("a row a human has since written about is let go before the door", pa.pending(T) is None)
psi.forget_login()
pa._call, calls = fake_call({"getLogIn": TOKEN, "getSingleEntrySupervisorsJSON": [{"person_id": 74}],
                             "singleEntryFilterAdminListJSON": []})
before6 = len(pa._S["pending"])
r6 = pa.tick("dsn", at(DAY, "15:25"))
check("a signed-in read with no entries at all names nobody and keeps the shift open",
      r6["state"] == "unknown" and len(pa._S["pending"]) == before6
      and pa.shift_id(ROSTER[-1]) not in pa._S["judged"], r6)
check("REGRESSION: an afternoon collection still reads back to the day before yesterday, whatever is due — it "
      "reached only 14 hours before its oldest due shift, and an evening's reads never saw an entry typed "
      "that day for yesterday",
      [b["startDate"] for m, b in calls if m == "singleEntryFilterAdminListJSON"] == ["2026-09-20"],
      [b for m, b in calls if m == "singleEntryFilterAdminListJSON"])
psi.forget_login()
pa._call, calls = fake_call({"getLogIn": NOT_ACTIVE})
r7 = pa.tick("dsn", at(DAY, "16:26"))
check("a kept session the service will not take is signed in again ONCE, and a refusal names nobody "
      "and says the account's word",
      r7["state"] == "refused" and "Not active" in r7["why"]
      and methods(calls) == ["getSingleEntrySupervisorsJSON", "getLogIn"], (r7, methods(calls)))
check("the refused session is not kept", not pa._S["session"], pa._S.get("session", {}).keys())
ROSTER.append(shift("Cy Noshow", "17:00"))
pa._CACHE["at"] = 0.0
r8 = pa.tick("dsn", at(DAY, "18:21"))
check("and the next due collection is held without a request", r8["state"] == "held" and len(calls) == 2,
      (r8, calls))
state_file.write_text("[]", encoding="utf-8")
restart()
psi.forget_login()
pa.prepare()
check("a state file that is not a record starts the lane refused, never open",
      not psi.login_would_allow()[0])

# down, as the rule defines it
import logging  # noqa: E402
import socket  # noqa: E402

import hashlib  # noqa: E402

ADM_PASS, TY_PASS = "adm-Secret-9431-plain", "ty-Secret-5520-plain"

SECRETS_SAID = [ADM_PASS, TY_PASS, hashlib.md5(ADM_PASS.encode()).hexdigest(),
                hashlib.md5(TY_PASS.encode()).hexdigest()]
HEARD: list[str] = []


class _Hear(logging.Handler):
    def emit(self, record):
        HEARD.append(record.getMessage())


logging.getLogger().addHandler(_Hear())
logging.getLogger().setLevel(logging.INFO)
TY_SECRET = Path(os.environ["HUB_PSI_TY_SECRET_FILE"])
SECRET.write_text(json.dumps({"user": "adm-user", "pass": ADM_PASS}), encoding="utf-8")
TY_SECRET.unlink(missing_ok=True)


def fresh_lane():
    state_file.write_text(json.dumps({"seen": {}}), encoding="utf-8")
    restart()
    psi.forget_login()
    pa._load()
    pa._S["session"] = {"token": "KEPT", "obtained_at": at(DAY, "09:00").isoformat(), "account": "adm"}


def raises(exc):
    def _r(_body=None):
        raise exc
    return _r


def by_user(adm, ty):
    def _ans(body):
        got = ty if body.get("userId") == "ty-user" else adm
        if isinstance(got, Exception):
            raise got
        return got
    return _ans


LIST = [{"person_id": 74}]
D0, D1 = DAY - timedelta(days=2), DAY

fresh_lane()
pa._call, calls = fake_call({"getSingleEntrySupervisorsJSON": raises(socket.timeout("timed out")),
                             "getLogIn": raises(socket.timeout("timed out"))})
got = pa._collect(D0, D1, at(DAY, "11:00"))
check("DOWN: the GET on the kept session failed AND the login right after it failed — PsiAnywhere is DOWN, "
      "and the calendar takes over",
      got["state"] == "down" and psi.down_state() and pa._mode(at(DAY, "11:01")) == "calendar"
      and pa._clock_now(at(DAY, "11:01"))[0] == "down"
      and methods(calls) == ["getSingleEntrySupervisorsJSON", "getLogIn"], (got, methods(calls)))
check("DOWN: the kept session is kept through it — it is what reads first when PsiAnywhere is back",
      pa._S["session"].get("token") == "KEPT")
check("DOWN: nothing is asked while it lasts — every request and every login held until the health retry",
      psi.paused()[0] and not psi.login_would_allow()[0])

fresh_lane()
state = {"n": 0}


def _flaky(body):
    state["n"] += 1
    if state["n"] == 1:
        raise socket.timeout("timed out")
    return LIST


pa._call, calls = fake_call({"getSingleEntrySupervisorsJSON": _flaky, "getLogIn": TOKEN,
                             "singleEntryFilterAdminListJSON": []})
got = pa._collect(D0, D1, at(DAY, "11:00"))
check("NOT DOWN: the GET timed out but the login right after it WORKED (and its read landed) — a timeout "
      "alone is no outage, and nothing is paused for two hours",
      got["state"] == "read" and psi.down_state() is None and not psi.paused()[0]
      and methods(calls) == ["getSingleEntrySupervisorsJSON", "getLogIn", "getSingleEntrySupervisorsJSON",
                             "singleEntryFilterAdminListJSON"], (got, methods(calls)))

fresh_lane()
pa._call, calls = fake_call({"getSingleEntrySupervisorsJSON": raises(socket.timeout("timed out")),
                             "getLogIn": NOT_ACTIVE})
got = pa._collect(D0, D1, at(DAY, "11:00"))
check("NOT DOWN: the account saying 'Not active' is PsiAnywhere ANSWERING — the latch holds the account "
      "against hammering, and no DOWN is recorded",
      got["state"] == "refused" and psi.down_state() is None and "Not active" in got["why"]
      and not psi.login_would_allow()[0] and "refused" in psi.login_would_allow()[1], got)
check("and with the only account refused, the reminders go by the calendar under the account's own name",
      pa._clock_now(at(DAY, "11:01"))[0] == "refused" and pa._mode(at(DAY, "11:01")) == "calendar")

fresh_lane()
pa._S["session"] = {}
pa._call, calls = fake_call({"getLogIn": raises(urllib.error.HTTPError("https://psianywhere.invalid", 503,
                                                                        "unavailable", {}, None))})
got = pa._collect(D0, D1, at(DAY, "11:00"))
check("DOWN: with no session kept there is no GET to make — a login that fails (503) is DOWN too",
      got["state"] == "down" and psi.down_state() and methods(calls) == ["getLogIn"], (got, methods(calls)))

fresh_lane()
pa._call, calls = fake_call({"getSingleEntrySupervisorsJSON": [{"person_id": None}],
                             "getLogIn": "<results>not the service's grammar</results>"})
got = pa._collect(D0, D1, at(DAY, "11:00"))
check("DOWN: a session not taken, then a login answered outside the service's own grammar — cannot log in",
      got["state"] == "down" and psi.down_state(), got)

fresh_lane()
psi.mark_down("the test's outage")
psi._login_state["down"]["retry_at"] = time.time() - 1
ALWAYS_SEEN_ROWS = punches({})
pa._call, calls = fake_call({"getLogIn": lambda body: REFUSAL if not body else TOKEN,
                             "getSingleEntrySupervisorsJSON": LIST,
                             "singleEntryFilterAdminListJSON": ALWAYS_SEEN_ROWS})
r_up = pa.tick("dsn", at(DAY, "11:10"))
check("UP: the retry asks the no-credential probe first (an EMPTY getLogIn), then reads on the kept session — "
      "the first read that lands clears DOWN and the calendar",
      r_up.get("read") and psi.down_state() is None and pa._mode(at(DAY, "11:11")) == "psi"
      and methods(calls)[:2] == ["getLogIn", "getSingleEntrySupervisorsJSON"] and calls[0][1] == {},
      (r_up, methods(calls)))

# the Ty account
fresh_lane()
pa._call, calls = fake_call({"getLogIn": by_user(TOKEN, TOKEN)})
check("TY: without its credential file the feature is idle — no try, no request, whatever the slot",
      pa._ty_maybe(at(DAY, "10:15")) is None and not calls and psi.active_account() == "adm")
TY_SECRET.write_text(json.dumps({"user": "ty-user", "pass": TY_PASS}), encoding="utf-8")
check("TY: nothing before its slot", pa._ty_maybe(at(DAY, "10:14")) is None and not calls)
pa._call, calls = fake_call({"getLogIn": by_user(TOKEN, NOT_ACTIVE)})
t1 = pa._ty_maybe(at(DAY, "10:15"))
check("TY: at 10:15 ONE login on Ty — refused: the lane stays on ADM, the answer is kept, the slot is spent",
      t1 and t1["answer"] == "Not active" and psi.active_account() == "adm"
      and methods(calls) == ["getLogIn"] and calls[0][1]["userId"] == "ty-user"
      and psi.ty_status()["last_answer"] == "Not active" and psi.ty_status()["tries_today"] == 1, t1)
check("TY: Ty's refusal is Ty's alone — the ADM line may still sign in",
      psi.login_would_allow(time.time() + psi.PSI_LOGIN_GAP_S + 1)[0])
restart()
pa._load()
check("TY: the spent slot is not tried again inside its window — across a restart too",
      pa._ty_maybe(at(DAY, "10:40")) is None and len(calls) == 1 and psi.ty_status()["tries_today"] == 1)
pa.TY_SLOTS = ("10:15", "12:15", "16:15")
psi._login_state["at"] = 0.0
t2 = pa._ty_maybe(at(DAY, "12:15"))
check("TY: the next slot tries again — 'Not active' is the account's state, which an administrator changes",
      t2 and len(calls) == 2 and psi.ty_status()["tries_today"] == 2, (t2, methods(calls)))
psi._login_state["at"] = 0.0
t3 = pa._ty_maybe(at(DAY, "16:15"))
check("TY: never more than two tries a New York day — a third slot waits, no request",
      t3 is None and len(calls) == 2 and "at most 2" in psi.login_would_allow(account="ty", purpose="ty_try")[1],
      (t3, psi.login_would_allow(account="ty", purpose="ty_try")))
pa.TY_SLOTS = ("10:15", "16:15")
fresh_lane()
TY_SECRET.write_text(json.dumps({"user": "ty-user", "pass": TY_PASS}), encoding="utf-8")
pa._call, calls = fake_call({"getLogIn": by_user(TOKEN, TOKEN.replace("ABC123", "TYSESSION")),
                             "getSingleEntrySupervisorsJSON": LIST})
t4 = pa._ty_maybe(at(DAY, "16:20"))
check("TY: Token AND a read on the fresh Ty session (ONE request, the supervisor list) — Ty becomes the "
      "active account (on the login clock, on disk) and its session the kept one",
      t4 and t4["active"] == "ty" and psi.active_account() == "ty"
      and methods(calls) == ["getLogIn", "getSingleEntrySupervisorsJSON"]
      and calls[1][1] == {"token": "TYSESSION"}
      and pa._S["session"] == {"token": "TYSESSION", "obtained_at": at(DAY, "16:20").isoformat(), "account": "ty"}
      and json.loads((TMP / "login-clock.json").read_text())["account"] == "ty", (t4, pa._S["session"]))
check("TY: sent with Ty's own user and the md5 of Ty's password — never the plain password",
      calls[0][1] == {"userId": "ty-user", "hash": hashlib.md5(TY_PASS.encode()).hexdigest()})
pa._CACHE.update({"shifts": [], "offs": {}, "loose": []})
pa._board_write(at(DAY, "16:21"))
st_ty = json.loads(pa.BOARD_FILE.read_text())["status"]
check("TY: the board says which account reads, the last Ty try and its answer — and nothing of the account",
      st_ty["account"] == "ty" and st_ty["ty"]["active"] and st_ty["ty"]["last_answer"] == "Token"
      and "ty-user" not in pa.BOARD_FILE.read_text() and "TYSESSION" not in pa.BOARD_FILE.read_text(), st_ty)
psi._login_state["at"] = 0.0
pa._call, calls = fake_call({"getSingleEntrySupervisorsJSON": lambda body: (
                                 [{"person_id": None}] if body.get("token") == "TYSESSION" else LIST),
                             "getLogIn": by_user(TOKEN, NOT_ACTIVE),
                             "singleEntryFilterAdminListJSON": []})
got = pa._collect(D0, D1, at(DAY, "17:00"))
check("TY: the active Ty account refuses — the lane falls back to ADM AT ONCE (one login, not held by the gap "
      "Ty's login just set) and reads in the same collection",
      got["state"] == "read" and psi.active_account() == "adm" and psi.down_state() is None
      and [(m, b.get("userId")) for m, b in calls if m == "getLogIn"] == [("getLogIn", "ty-user"),
                                                                          ("getLogIn", "adm-user")]
      and pa._S["session"]["account"] == "adm", (got, methods(calls)))
check("TY: and the twice-daily tries resume — tomorrow's 10:15 is a Ty try again",
      pa._ty_next(at(DAY, "17:01")).startswith((DAY + timedelta(days=1)).isoformat() + "T10:15"),
      pa._ty_next(at(DAY, "17:01")))
TY_SECRET.unlink()
psi.set_active("ty")
check("TY: the Ty file gone, the lane is ADM whatever the clock last said", psi.active_account() == "adm")

TY_SECRET.write_text(json.dumps({"user": "ty-user", "pass": TY_PASS}), encoding="utf-8")


def ticks(frm, to, every=5):
    out, t_ = [], at(DAY, frm)
    while t_ <= at(DAY, to):
        out.append((t_.astimezone(OHIO).strftime("%H:%M"), pa.tick("dsn", t_)))
        t_ += timedelta(minutes=every)
    return out


def logins_of(calls_, user):
    return [b for m, b in calls_ if m == "getLogIn" and b.get("userId") == user]


fresh_lane()
pa._S["session"] = {}
psi.login_refused("Not active", account="adm")
pa._call, calls = fake_call({"getLogIn": by_user(NOT_ACTIVE, TOKEN.replace("ABC123", "TYSESSION")),
                             "getSingleEntrySupervisorsJSON": LIST,
                             "singleEntryFilterAdminListJSON": punches})
morning = ticks("10:00", "10:40")
before = [s["state"] for hh, s in morning if hh < "10:15"]
check("TY THROUGH THE TICK: the ADM line refused ('Not active') and shifts open — the beats before 10:15 are "
      "held, and the 10:15 held beat makes ONE Ty try; its session reads, and the lane signs in as Ty",
      before and set(before) == {"held"} and len(logins_of(calls, "ty-user")) == 1
      and not logins_of(calls, "adm-user") and psi.active_account() == "ty"
      and [hh for hh, s in morning if s.get("ty")] == ["10:15"],
      ([(hh, s.get("state"), s.get("ty")) for hh, s in morning], methods(calls)))
check("TY THROUGH THE TICK: the next beat collects on the Ty session with no login — and the calendar hands "
      "back, the ADM latch still standing on its own account",
      any(s.get("read") for hh, s in morning if hh > "10:15") and len(logins_of(calls, "ty-user")) == 1
      and pa._mode(at(DAY, "10:41")) == "psi" and psi.login_snapshot()["refused_by"]["adm"],
      [(hh, s.get("state")) for hh, s in morning])

psi._login_state["at"] = 0.0
pa._call, calls = fake_call({"getLogIn": by_user(NOT_ACTIVE, NOT_ACTIVE),
                             "getSingleEntrySupervisorsJSON": lambda body: (
                                 [{"person_id": None}] if body.get("token") == "TYSESSION" else LIST),
                             "singleEntryFilterAdminListJSON": punches})
pa._S["last_done"] = ""
pa._CACHE["at"] = 0.0
mid = ticks("14:30", "14:30")
check("TY FALLBACK ONTO A LATCHED ADM: the Ty session not taken, Ty's one login refused — the lane is ADM "
      "again at once, and ADM's latch sends no login",
      psi.active_account() == "adm" and len(logins_of(calls, "ty-user")) == 1
      and not logins_of(calls, "adm-user"), ([(hh, s.get("state"), s.get("why")) for hh, s in mid], methods(calls)))
psi._login_state["at"] = 0.0
pa._call, calls = fake_call({"getLogIn": by_user(NOT_ACTIVE, TOKEN.replace("ABC123", "TYSESSION2")),
                             "getSingleEntrySupervisorsJSON": LIST,
                             "singleEntryFilterAdminListJSON": punches})
afternoon = ticks("15:00", "16:30")
check("TY FALLBACK ONTO A LATCHED ADM: the tries DO resume — nothing before 16:15, then ONE Ty try on a held "
      "beat ('Not active' is the account's state, so its own latch does not hold a try), and the lane is Ty",
      [hh for hh, s in afternoon if s.get("ty")] == ["16:15"] and len(logins_of(calls, "ty-user")) == 1
      and not logins_of(calls, "adm-user") and psi.active_account() == "ty"
      and psi.ty_status()["tries_today"] == 2,
      ([(hh, s.get("state"), s.get("ty")) for hh, s in afternoon], psi.ty_status()))

fresh_lane()
pa._S["session"] = {}
SECRET.unlink()
pa._call, calls = fake_call({"getLogIn": by_user(NOT_ACTIVE, TOKEN.replace("ABC123", "TYSESSION")),
                             "getSingleEntrySupervisorsJSON": LIST,
                             "singleEntryFilterAdminListJSON": punches})
nocred = ticks("10:10", "10:20")
check("TY THROUGH THE TICK: no ADM credential on the host — the due collection sends nothing, and that held "
      "beat carries the 10:15 Ty try",
      [hh for hh, s in nocred if s.get("ty")] == ["10:15"] and psi.active_account() == "ty"
      and len(logins_of(calls, "ty-user")) == 1 and not logins_of(calls, "adm-user"),
      ([(hh, s.get("state"), s.get("why")) for hh, s in nocred], methods(calls)))
SECRET.write_text(json.dumps({"user": "adm-user", "pass": ADM_PASS}), encoding="utf-8")

fresh_lane()
pa._call, calls = fake_call({"getLogIn": by_user(TOKEN, TOKEN.replace("ABC123", "TYSESSION")),
                             "getSingleEntrySupervisorsJSON": LIST,
                             "singleEntryFilterAdminListJSON": punches})
shared = ticks("10:15", "10:20")
check("TY: never on a beat whose collection sent — the 10:15 collection reads on the kept ADM session, and "
      "the Ty try goes on the 10:20 beat",
      shared[0][1].get("read") and not shared[0][1].get("ty") and shared[1][1].get("ty")
      and methods(calls)[:2] == ["getSingleEntrySupervisorsJSON", "singleEntryFilterAdminListJSON"],
      ([(hh, s.get("state"), s.get("ty")) for hh, s in shared], methods(calls)))

fresh_lane()
TY_SESSION = TOKEN.replace("ABC123", "TYDEAD")
pa._call, calls = fake_call({"getLogIn": by_user(TOKEN, TY_SESSION),
                             "getSingleEntrySupervisorsJSON": lambda body: (
                                 [{"person_id": None}] if body.get("token") == "TYDEAD" else LIST),
                             "singleEntryFilterAdminListJSON": punches})
t5 = pa._ty_maybe(at(DAY, "10:15"))
check("TY PROOF: Token, but the Ty session's supervisor list names nobody — the lane stays on ADM, the working "
      "ADM session is untouched, and ONE login plus ONE request were spent",
      t5 and t5["active"] == "adm" and psi.active_account() == "adm"
      and pa._S["session"].get("token") == "KEPT" and pa._S["session"].get("account") == "adm"
      and methods(calls) == ["getLogIn", "getSingleEntrySupervisorsJSON"], (t5, methods(calls)))
check("TY PROOF: the slot is spent saying so, and the board's last answer is not a bare 'Token'",
      "could not read" in pa._ty_done().get(f"{DAY.isoformat()} 10:15", "")
      and psi.ty_status()["last_answer"].startswith("Token, but its session could not read"),
      (pa._ty_done(), psi.ty_status()["last_answer"]))
fresh_lane()
pa._call, calls = fake_call({"getLogIn": by_user(TOKEN, TY_SESSION),
                             "getSingleEntrySupervisorsJSON": lambda body: (
                                 [{"person_id": None}] if body.get("token") == "TYDEAD" else LIST),
                             "singleEntryFilterAdminListJSON": punches})
day_long = ticks("09:30", "11:00")
psi._login_state["at"] = 0.0
day_long += ticks("16:00", "17:30")
check("TY PROOF THROUGH THE TICK: a whole day with an unreadable Ty — exactly 2 Ty logins (the two tries), NO "
      "ADM login (its kept session reads all day), the lane on ADM",
      len(logins_of(calls, "ty-user")) == 2 and not logins_of(calls, "adm-user")
      and psi.active_account() == "adm" and pa._S["session"].get("token") == "KEPT",
      ([b.get("userId") for m, b in calls if m == "getLogIn"], psi.active_account()))

fresh_lane()
pa._call, calls = fake_call({"getLogIn": TOKEN})
check("TY GUARD: while the lane reads as ADM, the login clock refuses a Ty login for any purpose but a try",
      not psi.login_would_allow(account="ty", purpose="attendance")[0]
      and "only as one of its twice-daily tries" in psi.login_would_allow(account="ty", purpose="attendance")[1]
      and not psi.login_would_allow(account="ty", purpose="probe")[0]
      and psi.login_would_allow(account="ty", purpose="ty_try")[0])
signed_g = pa._sign_in(account="ty", purpose="attendance")
check("TY GUARD: and nothing leaves the host for it", not signed_g["sent"] and not calls, (signed_g, calls))
TY_SECRET.unlink()

written = "".join(p.read_text(encoding="utf-8", errors="replace") for p in TMP.rglob("*")
                  if p.is_file() and p.name not in ("psianywhere.json", "psianywhere-ty.json"))
leaks = [s for s in SECRETS_SAID if any(s in line for line in HEARD) or s in written]
check(f"SILENCE: {len(HEARD)} log line(s) and every file the lane wrote carry neither password nor its md5 — "
      "and no user id either", HEARD and not leaks
      and not any("adm-user" in line or "ty-user" in line for line in HEARD), leaks)
psi.forget_login()

# nobody else signs in
import re  # noqa: E402

_REPO = HERE.parent.parent
_DOORS = {"server/psi_anywhere.py", "server/psi_attendance.py"}
_signers, _ports = [], []
for _p in sorted(list((_REPO / "server").rglob("*.py")) + list((_REPO / "tools").rglob("*.py"))):
    _rel = str(_p.relative_to(_REPO))
    if _p.name.startswith("test-") or "__pycache__" in _p.parts:
        continue
    _src = _p.read_text(encoding="utf-8", errors="replace")
    if "getLogIn" in _src and _rel not in _DOORS:
        _signers.append(_rel)
    if re.search(r"https?://[^\s\"']*psianywhere[^\s\"']*:8443", _src, re.IGNORECASE):
        _ports.append(_rel)
check("REVIEW: no module or tool but the lane's own two sends a PsiAnywhere sign-in, and none names port 8443 as "
      "an address to dial", not _signers and not _ports, (_signers, _ports))

# the quiet window
state_file.unlink(missing_ok=True)
restart()
pa._load()
pa._S["pending"] = [{"person": "Qu Night", "day": DAY.isoformat(), "shift_at": at(DAY, "21:00").isoformat(),
                     "_id": "q|night", "kind": "no_call", "_offers": 0}]
pa._S["post_after"] = 0.0
NEXT = DAY + timedelta(days=1)
q_2130 = pa.pending(at(DAY, "21:30").timestamp() + 59)
q_0800_unread = pa.pending(at(NEXT, "08:00").timestamp())
pa._S["read_at"] = at(NEXT, "08:00").isoformat()
check("QUIET: 21:30:59 still offers; 21:31, 23:00 and 07:59 offer nothing; at 08:00 the row the night held "
      "waits for a read made after the window, and is offered on it",
      q_2130 is not None and pa.pending(at(DAY, "21:31").timestamp()) is None
      and pa.pending(at(DAY, "23:00").timestamp()) is None
      and pa.pending(at(NEXT, "07:59").timestamp()) is None
      and q_0800_unread is None
      and pa.pending(at(NEXT, "08:00").timestamp()) is not None, q_2130)
pa.posted(q_2130["ids"], {"told": 0, "held": 1, "quiet": 1, "skipped": 0}, at(DAY, "21:31").timestamp())
check("QUIET: a pass the send door held for the night is kept whole, no offer spent, and offered at 08:00",
      [(r["_id"], int(r.get("_offers") or 0)) for r in pa._S["pending"]] == [("q|night", 0)]
      and pa.pending(at(DAY, "23:30").timestamp()) is None
      and pa.pending(at(NEXT, "08:00").timestamp()) is not None, pa._S["pending"])
pa.posted(q_2130["ids"], {"told": 0, "held": 1, "quiet": 0, "skipped": 0}, at(NEXT, "08:01").timestamp())
check("QUIET: a pass HELD by a brake (not the night) still spends its offer, as before",
      [int(r.get("_offers") or 0) for r in pa._S["pending"]] == [1], pa._S["pending"])

state_file.unlink(missing_ok=True)
restart()
pa._load()
CY = shift("Cy Late", "22:00", hours=10)
found_n = pa.judge([CY], {}, keyed("Cy Late"), {}, [], set(), at(DAY, "23:05"))
check("REVIEWED: at 23:05 the 22:00 shift with no punch is a no-call",
      [r["person"] for r in found_n["no_call"]] == ["Cy Late"], found_n)
pa._S["pending"] = [dict(r, kind="no_call", _offers=0, _at=at(DAY, "23:05").isoformat(),
                         _end=CY["shift_end"].astimezone(OHIO).isoformat()) for r in found_n["no_call"]]
pa._S["post_after"] = 0.0
pa._S["read_at"] = at(DAY, "23:05").isoformat()
pa._CACHE.update(offs={}, loose=[])
held_index = pa._board_index


def clock_says(*spans):
    idx = {}
    for name, began in spans:
        for key in pa.person_keys(name):
            idx.setdefault(key, []).append((began, None))
    pa._board_index = lambda _now: (idx, "kept", None)


clock_says(("Cy Late", at(DAY, "23:20")))
check("REVIEWED: inside the window nothing is offered, and the pass owes a read at 08:00 exactly",
      pa.pending(at(DAY, "23:10").timestamp()) is None
      and pa._morning_read_at(at(NEXT, "07:00")) == at(NEXT, "08:00"),
      pa._morning_read_at(at(NEXT, "07:00")))
check("REVIEWED: at 08:00 with no read since the night, the row waits — nobody is told off the 23:05 read",
      pa.pending(at(NEXT, "08:00").timestamp()) is None)
pa._S["read_at"] = at(NEXT, "08:00").isoformat()
offer_n = pa.pending(at(NEXT, "08:01").timestamp())
check("REVIEWED: on the 08:00 read the clock shows her in at 23:20 — the row is offered as LATE (80 minutes, "
      "arrived 23:20), never as a No Show No Call, and the waiting row is the late row too",
      offer_n is not None and not offer_n["no_call"] and len(offer_n["late"]) == 1
      and offer_n["late"][0]["minutes_late"] == 80 and offer_n["late"][0]["arrived"] == "23:20"
      and "23:20" in offer_n["late"][0]["report"]
      and [r["kind"] for r in pa._S["pending"]] == ["late"]
      and pa._morning_read_at(at(NEXT, "08:01")) is None, offer_n)
pa._S["pending"] = [dict(r, kind="no_call", _offers=0, _at=at(DAY, "23:05").isoformat(),
                         _end=CY["shift_end"].astimezone(OHIO).isoformat()) for r in found_n["no_call"]]
clock_says(("Cy Late", at(DAY, "22:05")))
check("REVIEWED: an entry that reached the clock late but began at 22:05 answers the row — let go, nobody told",
      pa.pending(at(NEXT, "08:01").timestamp()) is None and not pa._S["pending"], pa._S["pending"])
pa._S["pending"] = [dict(r, kind="no_call", _offers=0, _at=at(DAY, "23:05").isoformat(),
                         _end=CY["shift_end"].astimezone(OHIO).isoformat()) for r in found_n["no_call"]]
clock_says()
offer_still = pa.pending(at(NEXT, "08:01").timestamp())
check("REVIEWED: with still no punch on the 08:00 read the no-call is still true, and goes",
      offer_still is not None and [r["person"] for r in offer_still["no_call"]] == ["Cy Late"], offer_still)
pa._board_index = held_index
pa._S["pending"] = [dict(r, kind="late", _offers=0, _at=at(DAY, "23:05").isoformat(), minutes_late=45,
                         arrived="22:45") for r in found_n["no_call"]]
pa._S["read_at"] = at(DAY, "23:05").isoformat()
offer_late = pa.pending(at(NEXT, "08:00").timestamp())
check("a LATE row the night held is a punch the clock already showed: it goes at 08:00 without waiting for a read",
      offer_late is not None and [r["person"] for r in offer_late["late"]] == ["Cy Late"]
      and pa._morning_read_at(at(NEXT, "08:00")) is None, offer_late)

write_secret("pppp")
psi.forget_login()
pa._S["pending"] = [dict(r, kind="no_call", _offers=0, _at=at(DAY, "23:05").isoformat(),
                         _end=CY["shift_end"].astimezone(OHIO).isoformat()) for r in found_n["no_call"]]
pa._S["read_at"] = at(DAY, "23:05").isoformat()
pa._S["last_done"] = at(DAY, "23:05").isoformat()
pa._S["judged"] = {pa.shift_id(CY): DAY.isoformat()}
pa._S["post_after"] = 0.0
pa.roster = lambda dsn, a, b: ([CY], Counter())
pa.called_off = lambda dsn, a, b: ({}, [], "tracker newest 2026-09-22")
pa._CACHE["at"] = 0.0


def night_punch(_body):
    return [{"Single_Entry_ID": 900, "firstname": "Cy", "lastname": "Late",
             "Date_of_Service": "9/22/2026 12:00:00 AM", "start_time": "23:20:00", "end_time": ""}]


pa._call, calls = fake_call({"getLogIn": TOKEN, "getSingleEntrySupervisorsJSON": [{"person_id": 74}],
                             "singleEntryFilterAdminListJSON": night_punch})
r_0759 = pa.tick("dsn", at(NEXT, "07:59"))
calls_0759 = len(calls)
r_0800 = pa.tick("dsn", at(NEXT, "08:00"))
offer_m = pa.pending(at(NEXT, "08:00").timestamp())
check("REVIEWED: the pass makes no request at 07:59 and ONE collection at 08:00 for the row the night held; on it "
      "the no-call is offered as the late arrival the clock recorded",
      calls_0759 == 0 and r_0759["state"] == "waiting"
      and methods(calls).count("singleEntryFilterAdminListJSON") == 1
      and offer_m is not None and not offer_m["no_call"]
      and [(r["person"], r["arrived"]) for r in offer_m["late"]] == [("Cy Late", "23:20")],
      (r_0759, r_0800, methods(calls), offer_m))

# THE APP'S LANE (app/psi_attendance.py), its pay-period refresh, in a process of its own: the relay's copy above and
# the app's share every module name, so they cannot share one interpreter — and none of this run's HUB_ settings.
import subprocess  # noqa: E402

# A CHILD THAT HANGS (a lock a future change never lets go of) IS A FAILED CHECK, not a test run that never ends:
# subprocess.call stops it at the timeout.
REFRESH_TEST_TIMEOUT_S = 300
try:
    refresh_rc = subprocess.call([sys.executable, str(HERE.parent / "test-psi-period-refresh.py")],
                                 env={k: v for k, v in os.environ.items() if not k.startswith("HUB_")},
                                 timeout=REFRESH_TEST_TIMEOUT_S)
    refresh_said = f"exit {refresh_rc}"
except subprocess.TimeoutExpired:
    refresh_rc = None
    refresh_said = f"no end within {REFRESH_TEST_TIMEOUT_S} s — stopped"
check("the app lane's pay-period refresh (tools/test-psi-period-refresh.py) passes", refresh_rc == 0, refresh_said)

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
