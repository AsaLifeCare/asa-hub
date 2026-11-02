#!/usr/bin/env python3
"""The attendance lane's pay-period refresh (app/psi_attendance.py `_period_refresh`), asserted offline against the
app's real lane: its ticks, its plan, its state file and the real psi_punches_full.record_live, on a stand-in
PsiAnywhere (the lane's `_call`), a stand-in record store (psi_store) behind a spy on record_live, and stand-ins for
the books, the entry history, the shift flow and the punch pairs. No network, no database, no container.

What it proves: only a collection that READ owes the refresh, once per New York day from 05:00, and the read's own
beat never makes it (the app's beat delivers that read's verdicts once tick() returns): the next beat that makes no
collection pays it, and only while the read is still the lane's last, nothing was sent since, the session is the one
that read and the day is the same; on that session (no login of its own), as two pay-period reads (previous whole,
current through today) at the lane's own per-request timeout and inside its budget, checked before each period as well
as each queue; its rows reach the full punches (an entry's later status lands as a change) and nothing else; its day,
outcome and owed mark survive a reload of the state; a failure is one line, never touches the session, the backoff,
the relogin rest or DOWN, and is tried once more no sooner than three hours later; a PsiPaused skips it quietly with no
try spent; HUB_PSI_PERIOD_REFRESH_TRIES=0 switches it off; a garbled record or anything the refresh raises never
escapes tick().

    python3 tools/test-psi-period-refresh.py      (tools/test-psi-attendance.py runs it too)
"""
import json
import logging
import os
import socket
import sys
import tempfile
import time
import types
import urllib.request
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
APP = HERE.parent.parent / "app"
TMP = Path(tempfile.mkdtemp(prefix="psi-period-refresh-"))
SECRET = TMP / "psianywhere.json"
STATE = TMP / "state.json"
os.environ.update({
    "HUB_PSI_BASE": "https://psianywhere.invalid",
    "HUB_PSI_SECRET_FILE": str(SECRET),
    "HUB_PSI_TY_SECRET_FILE": str(TMP / "psianywhere-ty.json"),
    "HUB_PSI_ATTENDANCE_STATE": str(STATE),
    "HUB_PSI_LOGIN_CLOCK_FILE": str(TMP / "login-clock.json"),
    "HUB_PSI_PUNCH_BOARD": str(TMP / "board.json"),
    "HUB_PSI_FULL_DIR": str(TMP / "psi-full"),
    "HUB_SNAPSHOT_OUT": str(TMP),
    "HUB_PSI_WIRE_GAP_S": "0",
})
sys.path.insert(0, str(APP))


def _no_network(*_a, **_k):
    raise AssertionError("the test tried to reach the network")


urllib.request.urlopen = _no_network

# ── the stand-ins, in place before the lane imports anything ────────────────
STORE: dict = {}
store = types.ModuleType("psi_store")
store.get = lambda folder, name: json.loads(json.dumps(STORE.get(name, {})))
store.put = lambda folder, name, body: STORE.__setitem__(name, json.loads(json.dumps(body, default=str)))

UPSERTED: list = []
entries_mod = types.ModuleType("psi_entries")
entries_mod.between = lambda a, b, strict=False: []
entries_mod.upsert = lambda rows, now: (UPSERTED.append([r.get("Single_Entry_ID") for r in rows]),
                                        {"added": len(rows), "changed": 0})[1]
entries_mod.keep = lambda r: dict(r)
entries_mod.everything = lambda: {}

REMINDED: list = []
reminders = types.ModuleType("psi_reminders")
reminders.stopped_shifts = set
reminders.awaiting = set
reminders.owed_until = lambda r: None
reminders.quiet = lambda at_: False
reminders.quiet_ends = lambda at_: at_
reminders.quiet_begins = lambda at_: at_ + timedelta(days=3650)
reminders.status = lambda: {"readable": True}
reminders.marks = lambda: {}
reminders.refresh = lambda rows, mode, now, notes=None: REMINDED.append(list(rows))

PAIRED: list = []
pairs = types.ModuleType("punch_pairs")
pairs.reads_wanted = lambda now, read_at: {"at": None, "shifts": []}
pairs.marks = lambda: {}
pairs.board_status = lambda now: {"readable": True}
pairs.note = lambda shifts, index, *a, **k: PAIRED.append(sorted(index))

sys.modules.update({"psi_store": store, "psi_entries": entries_mod, "psi_reminders": reminders,
                    "punch_pairs": pairs})

import psi_anywhere as psi  # noqa: E402
import psi_attendance as pa  # noqa: E402
import psi_periods  # noqa: E402
import psi_punches_full as full  # noqa: E402

pa._call = _no_network
OHIO, UTC = pa.OHIO, timezone.utc

# THE SPY ON THE FULL PUNCHES: what each call was handed, then the real record_live on the stand-in store.
KEPT: list = []
_real_record_live = full.record_live


def _record_live_spy(rows, now=None):
    rows = list(rows)
    KEPT.append(sorted(str(r.get("Single_Entry_ID")) for r in rows))
    return _real_record_live(rows, now)


full.record_live = _record_live_spy

results = {"ok": 0, "failed": []}


def check(name, cond, detail=""):
    if cond:
        results["ok"] += 1
        print(f"ok   {name}")
    else:
        results["failed"].append(name)
        print(f"FAIL {name}{(' — ' + str(detail)[:500]) if detail else ''}")


HEARD: list = []


class _Hear(logging.Handler):
    def emit(self, record):
        HEARD.append((record.levelname, record.name, record.getMessage()))


logging.getLogger().addHandler(_Hear())
logging.getLogger().setLevel(logging.INFO)


def said_since(n, about=("pay-period", "pay periods")):
    return [h for h in HEARD[n:] if h[1] == pa.log.name and any(a in h[2] for a in about)]


def at(day, hhmm):
    h, m = hhmm.split(":")
    return datetime(day.year, day.month, day.day, int(h), int(m), tzinfo=OHIO).astimezone(UTC)


def us(day):
    return f"{day.month}/{day.day}/{day.year} 12:00:00 AM"


def entry(eid, first, last, day, start, end="", status="P"):
    return {"Single_Entry_ID": eid, "firstname": first, "lastname": last, "Anywhere_status": status,
            "Date_of_Service": us(day), "start_time": start, "end_time": end, "hours": ""}


# A THURSDAY: the current pay period is 10/25–11/07 and the previous 10/11–10/24; a collection reads from 10/27.
DAY = date(2026, 10, 29)
NEXT = DAY + timedelta(days=1)
check("the day sits where the test assumes on PsiAnywhere's grid",
      psi_periods.period_start(DAY) == date(2026, 10, 25) and pa.HISTORY_DAYS == 2)
PREV = ("2026-10-11", "2026-10-24")
CUR = ("2026-10-25", "2026-10-29")
COLLECTION_FROM = "2026-10-27"

PEOPLE = [("Ana", "Night", "02:00"), ("Ben", "Early", "06:00"), ("Cal", "Mid", "07:30"),
          ("Dee", "Late", "09:30"), ("Eve", "Noon", "12:00"), ("Fay", "Three", "15:00")]


def shift(first, last, hhmm, day=DAY, hours=8):
    name = f"{first} {last}"
    s_at = at(day, hhmm)
    return {"person_key": "".join(c for c in name.lower() if c.isalnum()), "keys": pa.person_keys(name),
            "name": name, "house": "ABD1305", "shift_code": hhmm, "shift_date": day, "shift_at": s_at,
            "shift_end": s_at + timedelta(hours=hours)}


ROSTER = [shift(f, l_, h) for f, l_, h in PEOPLE]
pa.roster = lambda dsn, a, b: (list(ROSTER), Counter())
pa.called_off = lambda dsn, a, b: ({}, [], "tracker newest 2026-10-29")
pa.notes_written = lambda dsn: {"ok": True, "by_key": {}}
pa.house_names = lambda dsn: {"ABD1305": "ABD home"}

# What the collection reads (its HISTORY_DAYS), every roster person on the clock at the start, status P.
COLLECTED = [entry(9001 + i, f, l_, DAY, f"{h}:00", status="P") for i, (f, l_, h) in enumerate(PEOPLE)]
# What only the refresh reaches: Rhea's entries of the previous period (one the record holds as S, now I; one never
# read) and one typed late for 10/26, before the collection's reach — and Ana's entry, approved since (P → A).
PREV_ROWS = [entry(5001, "Rhea", "Refresh", date(2026, 10, 15), "08:00:00", "16:00:00", status="I"),
             entry(5002, "Rhea", "Refresh", date(2026, 10, 16), "08:00:00", "16:00:00", status="A")]
CUR_ROWS = [dict(COLLECTED[0], Anywhere_status="A", end_time="10:00:00"),
            entry(6001, "Rhea", "Refresh", date(2026, 10, 26), "08:00:00", "16:00:00", status="A")]
REFRESH_IDS = {"5001", "5002", "6001"}
RHEA = pa.person_keys("Rhea Refresh")

SUPERVISORS = [{"person_id": 74}, {"person_id": 75}]
TOKEN_XML = ('<results><permissions><window_name>Token</window_name>'
             '<permission></permission><special_data>FRESH-TOKEN</special_data></permissions></results>')
MODE = {"refresh": "ok", "collection": "ok", "pause_after_collection": False, "refuse_after_collection": False}
CALLS: list = []


def fake_call(method, body, timeout):
    CALLS.append((method, dict(body), timeout))
    if method == "getLogIn":
        if MODE["collection"] == "down":
            raise socket.timeout("timed out")
        return TOKEN_XML
    if method == "getSingleEntrySupervisorsJSON":
        if MODE["collection"] == "down":
            raise socket.timeout("timed out")
        return SUPERVISORS
    if method == "singleEntryFilterAdminListJSON":
        window = (body["startDate"], body["endDate"])
        if body["startDate"] == COLLECTION_FROM:
            if MODE["collection"] == "kept_refused" and body["token"] == "KEPT-TOKEN":
                return "<html>session expired</html>"
            if MODE["collection"] == "empty":
                return []
            if MODE["pause_after_collection"] and body["supervisorId"] == 75:
                psi._login_state["paused_until"] = time.time() + 3600
                psi._login_state["paused_why"] = "the test holds every request"
            if MODE["refuse_after_collection"] and body["supervisorId"] == 75:
                # the health probe's own login heard the account refused while the collection read
                psi.login_refused("Not active")
            return COLLECTED if body["supervisorId"] == 74 else []
        if window not in (PREV, CUR):
            raise AssertionError(f"a read nobody planned: {window}")
        if MODE["refresh"] == "timeout":
            raise socket.timeout("timed out")
        if MODE["refresh"] == "unreadable":
            return "<html>session expired</html>"
        if body["supervisorId"] != 74:
            return []
        return PREV_ROWS if window == PREV else CUR_ROWS
    raise AssertionError(f"a method nobody planned: {method}")


pa._call = fake_call


def restart():
    """The process again: memory gone, the state file and the record store as they are."""
    pa._S.clear()
    pa._CACHE.update({"at": 0.0, "shifts": [], "offs": {}, "loose": [], "plan_said": "", "held_said": ""})
    pa._BOARD.update({"at": 0.0, "rows": [], "status": {}})
    pa._LAST_READ.update(at="", rows=[], day_from=None)
    pa._load()


def fresh_lane(token="KEPT-TOKEN"):
    STATE.write_text(json.dumps({"seen": {}}), encoding="utf-8")
    SECRET.write_text(json.dumps({"user": "adm-user", "pass": "adm-pass"}), encoding="utf-8")
    psi.forget_login()
    restart()
    pa._S["session"] = {"token": token, "obtained_at": at(DAY, "00:30").isoformat(), "account": "adm"}
    pa._save()
    STORE.clear()
    # the full punches already hold Rhea's 10/15 entry as it was read before it was imported (S)
    _real_record_live([dict(PREV_ROWS[0], Anywhere_status="S", _supervisorId=74)], at(date(2026, 10, 16), "09:00"))
    MODE.update(refresh="ok", collection="ok", pause_after_collection=False, refuse_after_collection=False)
    psi._login_state.update(paused_until=0.0, paused_why="")
    for bucket in (CALLS, KEPT, UPSERTED, REMINDED, PAIRED):
        bucket.clear()


def lists(calls):
    return [(b["startDate"], b["endDate"]) for m, b, _t in calls if m == "singleEntryFilterAdminListJSON"]


def quiet_beat(when):
    """The beat at `when` — one that makes no collection — and the requests it made."""
    n = len(CALLS)
    got = pa.tick("dsn", when)
    return got, CALLS[n:]


def read_then_quiet(hhmm, day=DAY):
    """A collection at hhmm, then the beat a minute later: (the read's beat, its requests, the quiet beat, its
    requests)."""
    n = len(CALLS)
    r = pa.tick("dsn", at(day, hhmm))
    read_calls = CALLS[n:]
    q, quiet_calls = quiet_beat(at(day, hhmm) + timedelta(minutes=1))
    return r, read_calls, q, quiet_calls


def only_collection(calls):
    """Did these requests read the collection's window and nothing else (no pay period, no login)?"""
    return (lists(calls) == [(COLLECTION_FROM, CUR[1])] * 2
            and not [m for m, _b, _t in calls if m == "getLogIn"])


def live(eid):
    return ((STORE.get(full.LIVE_FILE) or {}).get("entries") or {}).get(str(eid)) or {}


def saved():
    return json.loads(STATE.read_text(encoding="utf-8"))


def refresh_state():
    """The refresh's record in the lane's memory ({} when there is none)."""
    return pa._S.get("period_refresh") or {}


# ── A. once a day, after a collection that read, on its session ────────────
fresh_lane()
r1, c1, q1, qc1 = read_then_quiet("03:20")
check("before 05:00 New York a collection that read owes no refresh, and the quiet beat after it sends nothing",
      r1["state"] == "told" and q1["state"] == "waiting" and "period_refresh" not in r1 and "period_refresh" not in q1
      and only_collection(c1) and not qc1 and not refresh_state(), (r1, q1, lists(CALLS)))

CALLS.clear()
KEPT.clear()
n_heard = len(HEARD)
r2 = pa.tick("dsn", at(DAY, "07:20"))
c2 = list(CALLS)
owed_mem = dict(refresh_state().get("owed") or {})
owed_disk = dict((saved().get("period_refresh") or {}).get("owed") or {})
check("the first collection that reads after 05:00 does not refresh on its own beat: nothing past the collection is "
      "sent and nothing is said of it, so the app's beat delivers this read's verdicts first",
      r2["state"] == "told" and "period_refresh" not in r2 and only_collection(c2) and len(KEPT) == 1
      and not said_since(n_heard), (r2, lists(c2), said_since(n_heard)))
check("it leaves the refresh owed on that read and that session, in memory and in the state file, with no token in "
      "the mark",
      owed_mem and owed_mem == owed_disk and owed_mem.get("day") == DAY.isoformat()
      and owed_mem.get("read_at") == at(DAY, "07:20").isoformat() == pa._S["read_at"]
      and owed_mem.get("done_at") == pa._S["last_done"]
      and owed_mem.get("session_at") == at(DAY, "00:30").isoformat() and owed_mem.get("account") == "adm"
      and "TOKEN" not in json.dumps(saved().get("period_refresh")), (owed_mem, owed_disk))
q2, ref = quiet_beat(at(DAY, "07:21"))
p2 = q2.get("period_refresh") or {}
check("the next beat makes no collection and pays it, and it reads; the mark is spent",
      q2["state"] == "waiting" and p2.get("ok") is True and p2.get("tries") == 1
      and "owed" not in refresh_state() and "owed" not in (saved().get("period_refresh") or {}), q2)
check("two reads, one per pay period — the previous whole, the current through today — each across every queue",
      lists(ref) == [PREV, PREV, CUR, CUR]
      and [m for m, _b, _t in ref] == ["getSingleEntrySupervisorsJSON", "singleEntryFilterAdminListJSON",
                                       "singleEntryFilterAdminListJSON", "getSingleEntrySupervisorsJSON",
                                       "singleEntryFilterAdminListJSON", "singleEntryFilterAdminListJSON"],
      [(m, b.get("startDate")) for m, b, _t in ref])
check("on the session the collection read with, and no login anywhere in the beat",
      all(b.get("token") == "KEPT-TOKEN" for _m, b, _t in ref) and ref
      and not [m for m, _b, _t in CALLS if m == "getLogIn"], [(m, b.get("token")) for m, b, _t in ref])
check("every refresh request at the lane's own per-request timeout",
      all(t == pa.PSI_TIMEOUT_S for _m, _b, t in ref), [t for _m, _b, t in ref])
check("the rows go to the full punches: the collection's, then each period's as it lands",
      len(KEPT) == 3 and KEPT[1] == ["5001", "5002"] and KEPT[2] == ["6001", "9001"], KEPT)
check("an entry's later status lands as a change in the full punches (S → I, P → A with its end), and the entries "
      "the collection never reached are added",
      live(5001).get("entry", {}).get("Anywhere_status") == "I"
      and live(5001).get("changed_at") == "2026-10-29T11:21:00Z"
      and live(9001).get("entry", {}).get("Anywhere_status") == "A"
      and live(9001).get("entry", {}).get("end_time") == "10:00:00"
      and live(5002) and live(6001)
      and p2.get("added") == 2 and p2.get("changed") == 2 and p2.get("rows") == 4,
      (p2, live(5001), live(9001)))
check("and to nothing else: not the entry history, the seen list, the last read, the reminders or the pairs",
      not any(str(i) in REFRESH_IDS for got in UPSERTED for i in got)
      and not (RHEA & set(pa._S["seen"]))
      and not any(str(r.get("Single_Entry_ID")) in REFRESH_IDS for r in pa._LAST_READ["rows"])
      and not any("Rhea" in json.dumps(rows, default=str) for rows in REMINDED)
      and not any(RHEA & set(keys) for keys in PAIRED)
      and not any("Rhea" in json.dumps(r, default=str) for r in pa._BOARD["rows"]),
      (UPSERTED, sorted(pa._S["seen"])))
check("the collection's own read stands as the lane's read (read_at, the clock's state)",
      pa._S["read_at"] == at(DAY, "07:20").isoformat() and pa._S["clock"]["state"] == "read"
      and "4 entr" not in pa._S["clock"]["why"], pa._S["clock"])
check("one line said it, with no token in it",
      len(said_since(n_heard)) == 1 and said_since(n_heard)[0][0] == "INFO"
      and not any("KEPT-TOKEN" in m or "FRESH-TOKEN" in m for _l, _n, m in HEARD), said_since(n_heard))
on_disk = saved().get("period_refresh") or {}
check("the day and the outcome are in the lane's state file",
      on_disk.get("day") == DAY.isoformat() and on_disk.get("ok") is True and on_disk.get("tries") == 1
      and on_disk.get("periods") == ["2026-10-11..2026-10-24", "2026-10-25..2026-10-29"], on_disk)

restart()
CALLS.clear()
r3, _c3, q3, qc3 = read_then_quiet("08:50")
check("after a restart the next collection that reads owes nothing that day, and its quiet beat sends nothing",
      r3["state"] == "told" and q3["state"] == "waiting" and "period_refresh" not in r3 and "period_refresh" not in q3
      and only_collection(CALLS) and not qc3 and "owed" not in refresh_state()
      and (refresh_state() or {}).get("ok") is True, (r3, q3, lists(CALLS)))

check("the next New York day owes it again from 05:00, not before",
      pa._period_refresh_due(at(NEXT, "05:00")) and not pa._period_refresh_due(at(NEXT, "04:59"))
      and not pa._period_refresh_due(at(DAY, "23:59")))
check("on the first day of a pay period the previous one is read whole",
      pa._period_windows(at(date(2026, 11, 8), "06:00"))
      == [(date(2026, 10, 25), date(2026, 11, 7)), (date(2026, 11, 8), date(2026, 11, 8))])

# ── B. a refresh that cannot read: one line, the session untouched, once more three hours on ─────────
fresh_lane()
pa.tick("dsn", at(DAY, "03:20"))
MODE["refresh"] = "timeout"
CALLS.clear()
n_heard = len(HEARD)
session_before = dict(pa._S["session"])
r4, _c4, q4, qc4 = read_then_quiet("07:20")
check("a refresh that times out is a try spent, said as not read",
      r4["state"] == "told" and q4["state"] == "waiting" and (q4.get("period_refresh") or {}).get("ok") is False
      and q4["period_refresh"].get("tries") == 1 and "timed out" in refresh_state().get("why", ""), q4)
check("it stops at the request that failed (no second period asked)", lists(qc4) == [PREV], lists(qc4))
check("the kept session is untouched: same token, same age, no refusal noted, no login, no DOWN, no backoff, "
      "no relogin rest, and the clock still says read",
      pa._S["session"] == session_before and "refused_at_min" not in (pa._S.get("session_life") or {})
      and not [m for m, _b, _t in CALLS if m == "getLogIn"] and psi._login_state["at"] == 0.0
      and psi.down_state() is None and pa._S["backoff"] == {} and pa._S["relogin_rest"] == {}
      and pa._S["clock"]["state"] == "read",
      (pa._S["session"], pa._S.get("session_life"), psi.down_state(), pa._S["backoff"], pa._S["clock"]))
lines = said_since(n_heard)
check("one line, a warning, with the try count and no token",
      len(lines) == 1 and lines[0][0] == "WARNING" and "try 1 of 2" in lines[0][2]
      and "KEPT-TOKEN" not in lines[0][2], lines)
check("the failure is in the state file", saved()["period_refresh"].get("ok") is False
      and saved()["period_refresh"].get("tries") == 1, saved()["period_refresh"])

restart()
CALLS.clear()
r5, _c5, q5, qc5 = read_then_quiet("08:50")
check("an hour and a half later — and after a restart — the collection reads and the refresh is not tried",
      r5["state"] == "told" and q5["state"] == "waiting" and "period_refresh" not in q5
      and only_collection(CALLS) and not qc5, (r5, q5, lists(CALLS)))

CALLS.clear()
n_heard = len(HEARD)
r6, _c6, q6, qc6 = read_then_quiet("10:50")
check("three and a half hours after the failure the quiet beat after the next read tries it once more",
      r6["state"] == "told" and (q6.get("period_refresh") or {}).get("tries") == 2 and lists(qc6) == [PREV],
      (q6, lists(CALLS)))
check("and the second failure says it is the last today",
      len(said_since(n_heard)) == 1 and "not again today" in said_since(n_heard)[0][2], said_since(n_heard))

CALLS.clear()
r7, _c7, q7, qc7 = read_then_quiet("13:20")
check("two and a half hours after the second failure, nothing",
      r7["state"] == "told" and "period_refresh" not in q7 and only_collection(CALLS) and not qc7,
      (r7, q7, lists(CALLS)))
CALLS.clear()
r7b, _c7b, q7b, qc7b = read_then_quiet("16:20")
check("and no third try that day, even past three hours",
      r7b["state"] == "told" and "period_refresh" not in q7b and only_collection(CALLS) and not qc7b
      and refresh_state().get("tries") == 2 and "owed" not in refresh_state(), (r7b, q7b, lists(CALLS)))
check("the session is still the one the lane kept", pa._S["session"] == session_before)

# an answer a working session would not get: the collection would drop its session for it; the refresh never does
fresh_lane()
pa.tick("dsn", at(DAY, "03:20"))
MODE["refresh"] = "unreadable"
session_before = dict(pa._S["session"])
CALLS.clear()
r8, _c8, q8, _qc8 = read_then_quiet("07:20")
check("an unreadable answer on the refresh is a failed try — never a refused session, never a login",
      (q8.get("period_refresh") or {}).get("ok") is False and pa._S["session"] == session_before
      and "refused_at_min" not in (pa._S.get("session_life") or {})
      and not [m for m, _b, _t in CALLS if m == "getLogIn"] and pa._S["relogin_rest"] == {},
      (q8, pa._S["session"]))

# ── C. never on a collection that failed, read nothing, or was held ────────
fresh_lane()
MODE["collection"] = "down"
r9, _c9, q9, qc9 = read_then_quiet("07:20")
check("a collection that could not read (the kept session and the login after it both failed) owes no refresh",
      r9["state"] == "down" and "period_refresh" not in r9 and "period_refresh" not in q9 and not lists(CALLS)
      and not qc9 and not refresh_state(), (r9, q9, lists(CALLS)))

fresh_lane()
MODE["collection"] = "empty"
r10, _c10, q10, qc10 = read_then_quiet("07:20")
check("a collection that came back with no readable entry owes no refresh",
      r10["state"] == "unknown" and q10["state"] == "waiting" and "period_refresh" not in q10
      and lists(CALLS) == [(COLLECTION_FROM, CUR[1])] * 2 and not qc10 and not refresh_state(), (r10, q10, lists(CALLS)))

fresh_lane()
pa._S["session"] = {}
psi.login_refused("Not active")
r11, _c11, q11, _qc11 = read_then_quiet("07:20")
check("a held collection (no session, the account refused) sends nothing, the refresh included",
      r11["state"] == "held" and "period_refresh" not in q11 and not CALLS and not refresh_state(),
      (r11, q11, CALLS))

fresh_lane()
MODE["collection"] = "kept_refused"
r12, c12, q12, ref12 = read_then_quiet("07:20")
check("when the collection had to sign in again and then read, the refresh rides THAT session — the one login is "
      "the collection's",
      r12["state"] == "told" and (q12.get("period_refresh") or {}).get("ok") is True
      and [m for m, _b, _t in c12].count("getLogIn") == 1 and not [m for m, _b, _t in ref12 if m == "getLogIn"]
      and all(b.get("token") == "FRESH-TOKEN" for _m, b, _t in ref12) and lists(ref12) == [PREV, PREV, CUR, CUR],
      (q12, [(m, b.get("token")) for m, b, _t in CALLS]))

# ── D. PsiAnywhere held mid-way: skipped quietly, no try spent ─────────────
fresh_lane()
MODE["pause_after_collection"] = True
n_heard = len(HEARD)
r13, _c13, q13, qc13 = read_then_quiet("07:20")
check("a PsiPaused right after the collection skips the refresh: nothing sent, nothing kept, nothing said, no try",
      r13["state"] == "told" and q13["state"] == "waiting" and "period_refresh" not in q13 and not qc13
      and not refresh_state() and not saved().get("period_refresh") and not said_since(n_heard)
      and len(KEPT) == 1, (q13, qc13, said_since(n_heard)))
psi._login_state.update(paused_until=0.0, paused_why="")
MODE["pause_after_collection"] = False
CALLS.clear()
r14, _c14, q14, qc14 = read_then_quiet("08:50")
check("and the next collection that reads owes it again, paid as the day's first try",
      (q14.get("period_refresh") or {}).get("ok") is True and q14["period_refresh"].get("tries") == 1
      and lists(qc14) == [PREV, PREV, CUR, CUR], (q14, lists(CALLS)))

# the account refused a login while the collection read: the lane will not read with that session again, so the
# refresh does not either — and it leaves the letting go to the next collection
fresh_lane()
MODE["refuse_after_collection"] = True
session_before = dict(pa._S["session"])
n_heard = len(HEARD)
r14b, _c14b, q14b, qc14b = read_then_quiet("07:20")
check("a refusal heard since the read skips the refresh: nothing sent, no try, the session not dropped by it",
      r14b["state"] == "told" and q14b["state"] == "waiting" and "period_refresh" not in q14b and not qc14b
      and not refresh_state() and pa._S["session"] == session_before and not said_since(n_heard),
      (q14b, qc14b, pa._S["session"]))

# ── E. the budget, and a record that could not keep the rows ───────────────
CALLS.clear()
try:
    pa.entries("KEPT-TOKEN", date(2026, 10, 27), DAY, deadline=time.monotonic() - 1)
    over = None
except pa.PsiTransport as exc:
    over = str(exc)
check("a read past its budget asks no further queue and raises as a timeout does",
      over is not None and "after 0 of 2" in over and [m for m, _b, _t in CALLS] == ["getSingleEntrySupervisorsJSON"],
      (over, CALLS))
CALLS.clear()
rows_no_deadline, _meta = pa.entries("KEPT-TOKEN", date(2026, 10, 27), DAY)
check("a collection's read (no deadline) still asks every queue", len(lists(CALLS)) == 2 and rows_no_deadline)

fresh_lane()
pa.tick("dsn", at(DAY, "03:20"))
budget = pa.PERIOD_REFRESH_BUDGET_S
pa.PERIOD_REFRESH_BUDGET_S = 0
CALLS.clear()
r15, _c15, q15, qc15 = read_then_quiet("07:20")
pa.PERIOD_REFRESH_BUDGET_S = budget
check("a refresh with its budget spent sends nothing at all — not even a period's supervisor list — and counts as a "
      "failed try",
      (q15.get("period_refresh") or {}).get("ok") is False and "budget" in refresh_state()["why"]
      and not qc15 and refresh_state().get("periods") == [], (q15, qc15, refresh_state()))


class _Clock:
    """A monotonic clock the test moves by hand; everything else is the real time module."""

    def __init__(self):
        self.t = 1000.0

    def monotonic(self):
        return self.t

    def __getattr__(self, name):
        return getattr(time, name)


CLOCK = _Clock()


def _budget_spent_on_prev(method, body, timeout):
    """The stand-in PsiAnywhere, and the previous period's last queue takes the refresh's whole budget."""
    got = fake_call(method, body, timeout)
    if method == "singleEntryFilterAdminListJSON" and (body["startDate"], body["endDate"]) == PREV \
            and body["supervisorId"] == 75:
        CLOCK.t += pa.PERIOD_REFRESH_BUDGET_S + 1
    return got


fresh_lane()
pa.tick("dsn", at(DAY, "07:20"))
real_time, pa.time = pa.time, CLOCK
pa._call = _budget_spent_on_prev
KEPT.clear()
q15b, qc15b = quiet_beat(at(DAY, "07:21"))
pa._call, pa.time = fake_call, real_time
check("a budget spent between the two periods asks nothing of the second, not even its supervisor list",
      [m for m, _b, _t in qc15b] == ["getSingleEntrySupervisorsJSON", "singleEntryFilterAdminListJSON",
                                     "singleEntryFilterAdminListJSON"]
      and lists(qc15b) == [PREV, PREV], [(m, b.get("startDate")) for m, b, _t in qc15b])
check("and it is a failed try that keeps the first period it read",
      (q15b.get("period_refresh") or {}).get("ok") is False and "budget" in refresh_state().get("why", "")
      and refresh_state().get("why", "").startswith(CUR[0]) and refresh_state().get("periods") == ["..".join(PREV)]
      and KEPT == [["5001", "5002"]] and live(5001).get("entry", {}).get("Anywhere_status") == "I",
      (q15b, refresh_state(), KEPT))

fresh_lane()
pa.tick("dsn", at(DAY, "03:20"))
full.record_live = lambda rows, now=None: {"unwritten": 1}
r16, _c16, q16, qc16 = read_then_quiet("07:20")
full.record_live = _record_live_spy
check("rows read and not kept are a failed try too (the next one reads them again)",
      (q16.get("period_refresh") or {}).get("ok") is False and "not kept" in refresh_state()["why"]
      and lists(qc16) == [PREV, PREV], (q16, refresh_state()))

# ── F. the mark is honoured only while the read and the session are still that read's ─────
fresh_lane()
pa.tick("dsn", at(DAY, "07:20"))
pa._S["session"] = dict(pa._S["session"], token="OTHER-TOKEN", obtained_at=at(DAY, "07:20").isoformat())
q17, qc17 = quiet_beat(at(DAY, "07:21"))
check("a session kept since the read (another login, another line) is not the one the refresh was owed on: nothing "
      "sent, no try, the mark spent",
      q17["state"] == "waiting" and "period_refresh" not in q17 and not qc17 and not refresh_state(),
      (q17, qc17, refresh_state()))
CALLS.clear()
r17b, _c17b, q17b, qc17b = read_then_quiet("08:50")
check("and the next read on the session now kept owes it again, paid on that session",
      (q17b.get("period_refresh") or {}).get("ok") is True and q17b["period_refresh"].get("tries") == 1
      and lists(qc17b) == [PREV, PREV, CUR, CUR] and all(b.get("token") == "OTHER-TOKEN" for _m, b, _t in qc17b),
      (q17b, [(m, b.get("token")) for m, b, _t in qc17b]))

fresh_lane()
pa.tick("dsn", at(DAY, "07:20"))
# a collection sent since and could not read: the read and the session stand, but something left this host after it
pa._S["last_done"] = at(DAY, "07:40").isoformat()
q18, qc18 = quiet_beat(at(DAY, "07:41"))
check("anything sent since the read voids the mark: nothing sent, no try",
      q18["state"] == "waiting" and "period_refresh" not in q18 and not qc18 and not refresh_state(),
      (q18, qc18, refresh_state()))

fresh_lane()
pa.tick("dsn", at(DAY, "07:20"))
pa._S["period_refresh"]["owed"]["day"] = (DAY - timedelta(days=1)).isoformat()
q19, qc19 = quiet_beat(at(DAY, "07:21"))
check("a mark left on another New York day is not paid", "period_refresh" not in q19 and not qc19
      and not refresh_state(), (q19, qc19))

fresh_lane()
pa.tick("dsn", at(DAY, "07:20"))
CALLS.clear()
r20 = pa.tick("dsn", at(DAY, "08:50"))
c20 = list(CALLS)
owed20 = dict(refresh_state().get("owed") or {})
q20, qc20 = quiet_beat(at(DAY, "08:51"))
check("a beat that makes a collection never pays the mark: a read in its place owes it anew on itself",
      r20["state"] == "told" and "period_refresh" not in r20 and only_collection(c20)
      and owed20.get("read_at") == at(DAY, "08:50").isoformat(), (r20, lists(c20), owed20))
check("and the quiet beat after that read pays it", (q20.get("period_refresh") or {}).get("ok") is True
      and lists(qc20) == [PREV, PREV, CUR, CUR], (q20, lists(qc20)))

fresh_lane()
pa.tick("dsn", at(DAY, "07:20"))
psi.mark_down("the test says PsiAnywhere is down")
q20b, qc20b = quiet_beat(at(DAY, "07:21"))
owed20b = dict(refresh_state().get("owed") or {})
psi.mark_up("the test says it is up again")
q20c, qc20c = quiet_beat(at(DAY, "07:22"))
check("a beat that is not a quiet one (DOWN) sends nothing and neither pays nor spends the mark",
      q20b["state"] == "down" and not qc20b and "period_refresh" not in q20b
      and owed20b.get("read_at") == at(DAY, "07:20").isoformat(), (q20b, qc20b, owed20b))
check("and the quiet beat after it pays it", q20c["state"] == "waiting"
      and (q20c.get("period_refresh") or {}).get("ok") is True and lists(qc20c) == [PREV, PREV, CUR, CUR],
      (q20c, lists(qc20c)))

fresh_lane()
pa.tick("dsn", at(DAY, "07:20"))
restart()
q21, qc21 = quiet_beat(at(DAY, "07:21"))
check("a restart between the read and its quiet beat keeps the mark: the beat after it pays it on the kept session",
      (q21.get("period_refresh") or {}).get("ok") is True and lists(qc21) == [PREV, PREV, CUR, CUR]
      and all(b.get("token") == "KEPT-TOKEN" for _m, b, _t in qc21), (q21, lists(qc21)))

# ── G. switched off, a garbled record, and nothing escapes tick() ─────────
tries_was = pa.PERIOD_REFRESH_TRIES
pa.PERIOD_REFRESH_TRIES = 0
fresh_lane()
r22, _c22, q22, qc22 = read_then_quiet("07:20")
off = [pa._period_refresh_due(at(d, hh)) for d in (DAY, NEXT) for hh in ("05:00", "12:00", "23:59")]
pa.PERIOD_REFRESH_TRIES = tries_was
check("HUB_PSI_PERIOD_REFRESH_TRIES=0 switches it off: no mark, nothing sent, never due on any day",
      r22["state"] == "told" and "period_refresh" not in q22 and only_collection(CALLS) and not qc22
      and not refresh_state() and not any(off), (q22, lists(CALLS), off))

fresh_lane()
garbled = saved()
garbled["period_refresh"] = {"day": DAY.isoformat(), "tries": "two", "ok": False, "at": at(DAY, "03:00").isoformat()}
STATE.write_text(json.dumps(garbled), encoding="utf-8")
restart()
n_heard = len(HEARD)
r23, _c23, q23, qc23 = read_then_quiet("07:20")
check("a try count that cannot be read never escapes tick(): it counts as every try spent, nothing sent, nothing said",
      r23["state"] == "told" and q23["state"] == "waiting" and "period_refresh" not in q23 and not qc23
      and "owed" not in refresh_state() and not said_since(n_heard),
      (r23, q23, said_since(n_heard)))
check("and the next New York day starts over",
      pa._period_refresh_due(at(NEXT, "06:00")) and pa._period_refresh_tries({"day": "x", "tries": "two"}, "y") == 0
      and pa._period_refresh_tries({"day": "x", "tries": None}, "x") == 0
      and pa._period_refresh_tries({"day": "x", "tries": float("inf")}, "x") == pa.PERIOD_REFRESH_TRIES)

fresh_lane()
pa.tick("dsn", at(DAY, "07:20"))
pa._S["period_refresh"]["owed"] = "not a mark"
q24, qc24 = quiet_beat(at(DAY, "07:21"))
check("a mark that is not a record is spent and never paid", q24["state"] == "waiting" and not qc24
      and "period_refresh" not in q24 and not refresh_state(), (q24, qc24, refresh_state()))

fresh_lane()
pa.tick("dsn", at(DAY, "07:20"))
real_windows = pa._period_windows


def _windows_break(now):
    raise RuntimeError("the windows broke")


pa._period_windows = _windows_break
n_heard = len(HEARD)
try:
    q25, qc25 = quiet_beat(at(DAY, "07:21"))
    escaped = ""
except Exception as exc:  # noqa: BLE001
    q25, qc25, escaped = {}, [], f"{type(exc).__name__}: {exc}"
lines25 = [h for h in HEARD[n_heard:] if h[1] == pa.log.name and "pay-period refresh failed" in h[2]]
q25b, qc25b = quiet_beat(at(DAY, "07:22"))
lines25b = [h for h in HEARD[n_heard:] if h[1] == pa.log.name and "pay-period refresh failed" in h[2]]
pa._period_windows = real_windows
check("an error the refresh raises never escapes tick(): the beat ends as it would, said in one warning",
      not escaped and q25.get("state") == "waiting" and "period_refresh" not in q25 and not qc25
      and len(lines25) == 1 and lines25[0][0] == "WARNING" and "RuntimeError" in lines25[0][2],
      (escaped, q25, lines25))
check("and the mark it spent is not paid again on the next beat", not qc25b and len(lines25b) == 1
      and "period_refresh" not in q25b, (q25b, lines25b))

fresh_lane()
real_mark = pa._period_refresh_mark


def _mark_break(now):
    raise RuntimeError("the mark broke")


pa._period_refresh_mark = _mark_break
try:
    r26 = pa.tick("dsn", at(DAY, "07:20"))
    escaped = ""
except Exception as exc:  # noqa: BLE001
    r26, escaped = {}, f"{type(exc).__name__}: {exc}"
pa._period_refresh_mark = real_mark
check("an error while marking it owed never costs the read's beat: told, the board written, the verdicts in hand",
      not escaped and r26.get("state") == "told" and r26.get("board") is True and "late" in r26
      and pa._S["read_at"] == at(DAY, "07:20").isoformat(), (escaped, r26))

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
