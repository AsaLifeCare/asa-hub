#!/usr/bin/env python3
"""
THE CLIENTS AT A PUNCH, asserted offline against the real functions.

The live read says how many clients were at a punch, not who. The full punch
sheet ("the maximum information possible, including the client") gets the
names from one more request per entry — getSingleEntryConsumersPresentJSON —
made by server/psi_consumers.py through the attendance lane. This holds it:

  parse       the answer's measured shape (one request on the kept session):
              one object per client — its id, its name, its EVV reason and its
              three attestation flags — kept side by side, a client with no
              name dropped with its fields, and an answer that is not a list,
              or names nobody where the entry counts clients, never an answer
  once        each entry is asked ONCE; again only when it changes in what can
              change who was there (the count, the place, the day, the start,
              the end) — never for an approval or a status; an entry whose
              count is 0 is answered by the count with no request; one pass per
              read, never two for the same read
  caps        at most PER_COLLECTION requests a pass and PER_DAY a New York day
              (every request sent counts, answered or not); the never-asked go
              first, newest first; 0 switches the asking off
  unwritable  a consumers.json that cannot be written loses the answers and
              NEITHER bound: the day's purse and the read already served are
              counted in memory too, and nothing more is asked until a write
              lands again
  the lane    the lane's lock is taken with a bound — a collection holds it for
              its whole beat, and the hourly sweep waits behind this task
  unproved    an empty answer for an entry nothing counts (the history keeps no
              count) is not written down as "nobody was there": the entry stays
              askable, EMPTY_MAX times on its version, and `status` counts it
              apart from the entries whose own count said 0
  misses      an unreadable answer is a miss that ends the pass; MISS_MAX
              misses on one version set an entry aside until it changes, so no
              entry holds the others back; a timeout marks nothing and is never
              DOWN; while DOWN nothing is sent at all
  no session  no kept session, a session the account refused since, a read
              older than FRESH_S or a session newer than the last read: nothing
              is sent
  no login    not one getLogIn in any of it, and the login clock never moves
  the sheet   the answers land on the live rows — `consumers`, the slots with
              the client's id, the visit's flags — and in rows.json, and the
              pass right after carries them; consumers.json is 0600 in the 0700
              directory, and an unreadable one is never written over

HOW IT STAYS OFFLINE. The service is pointed at a name that resolves nowhere,
`urlopen` and the lane's own `_call` fail the test unless a check installs a
fake, the wire's breath is 0, and every file lives in a temporary directory.
Nothing reaches PsiAnywhere, Google or Postgres.

    python3 tools/test-psi-consumers.py
"""
import json
import os
import re
import socket
import stat
import sys
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
REPO = HERE.parent.parent
SERVER = REPO / "server"
TMP = Path(tempfile.mkdtemp(prefix="psi-consumers-"))
os.environ.update({
    "HUB_PSI_BASE": "https://psianywhere.invalid",
    "HUB_SNAPSHOT_OUT": str(TMP),
    "HUB_PSI_FULL_DIR": str(TMP / "psi-full"),
    "HUB_PSI_ENTRIES_DIR": str(TMP / "psi-entries"),
    "HUB_PSI_ATTENDANCE_STATE": str(TMP / "state.json"),
    "HUB_PSI_LOGIN_CLOCK_FILE": str(TMP / "login-clock.json"),
    # no credential at all: nothing here could sign in even if it tried
    "HUB_PSI_SECRET_FILE": str(TMP / "no-secret.json"),
    "HUB_PSI_TY_SECRET_FILE": str(TMP / "no-ty-secret.json"),
    "HUB_PSI_WIRE_GAP_S": "0",
    # small caps, so the bounds are reached inside a test
    "HUB_PSI_CONSUMERS_PER_COLLECTION": "5",
    "HUB_PSI_CONSUMERS_PER_DAY": "12",
})
sys.path.insert(0, str(SERVER))


def _no_network(*_a, **_k):
    raise AssertionError("the test tried to reach the network")


import urllib.request  # noqa: E402

urllib.request.urlopen = _no_network

import psi_anywhere as psi  # noqa: E402
import psi_attendance as pa  # noqa: E402
import psi_consumers as pc  # noqa: E402
import psi_punches_full as full  # noqa: E402

pa._call = _no_network
UTC = timezone.utc

results = {"ok": 0, "failed": []}


def check(name, cond, detail=""):
    if cond:
        results["ok"] += 1
        print(f"ok   {name}")
    else:
        results["failed"].append(name)
        print(f"FAIL {name}{(' — ' + str(detail)[:500]) if detail else ''}")


# ── the measured answer ────────────────────────────────────────────────────
# The shape one request on the kept session answered (values stood in for:
# the names and ids here are invented; the flags are what the service said).
def client(i: int) -> dict:
    return {"consumerid": str(10 + i), "consumername": f"Doe{i}, Jane",
            "evvReasonCode": "99", "hasNote": "False", "hasSignature": "False", "isDocumented": None}


MEASURED = [client(1)]
got = pc.parse(MEASURED, 1)
check("PARSE: the measured answer — one client: the name, and beside it the id, the EVV reason and the three "
      "flags, as the service said them",
      got == {"names": ["Doe1, Jane"],
              "meta": [{"consumerid": "11", "evvReasonCode": "99", "hasNote": "False",
                        "hasSignature": "False", "isDocumented": None}]}, got)
got2 = pc.parse([{"consumername": "  ", "consumerid": "1"}, client(2)], 1)
check("PARSE: an object with no name is dropped with its fields — names and fields stay side by side",
      got2["names"] == ["Doe2, Jane"] and got2["meta"][0]["consumerid"] == "12", got2)
check("PARSE: an empty list reads as nobody named — an answer of nobody where the entry's count says 0, "
      "and nothing proved where the entry counts nothing at all (the pass, below, refuses to keep that one)",
      pc.parse([], 0) == {"names": [], "meta": []} and pc.parse([], None) == {"names": [], "meta": []})


def raises(fn):
    try:
        fn()
    except pc.Unreadable:
        return True
    return False


check("PARSE: not a list, an item that is not an object, or NOBODY where the entry counts clients — never "
      "an answer (the count and the names agreed on every stored entry, so the last is the answer's fault)",
      raises(lambda: pc.parse(None)) and raises(lambda: pc.parse("[]x")) and raises(lambda: pc.parse({"a": 1}))
      and raises(lambda: pc.parse([1])) and raises(lambda: pc.parse([], 1))
      and raises(lambda: pc.parse([{"consumername": ""}], 2)))
check("PRINT: the fingerprint is the count, the place, the day, the start and the end — an approval or a "
      "status does not move it",
      pc.CHANGE_FIELDS == ("Number_Consumers_Present", "Location_Name", "Date_of_Service", "start_time",
                           "end_time")
      and pc.entry_print({"end_time": "", "Anywhere_status": "I"})
      == pc.entry_print({"end_time": "", "Anywhere_status": "A", "approvedUser": "x", "Last_Update": "y"})
      and pc.entry_print({"end_time": ""}) != pc.entry_print({"end_time": "15:00:00"}))
src = (SERVER / "psi_consumers.py").read_text(encoding="utf-8")
check("CAPS: the defaults are 20 a collection and 120 a New York day, both configuration",
      '"HUB_PSI_CONSUMERS_PER_COLLECTION", "20"' in src and '"HUB_PSI_CONSUMERS_PER_DAY", "120"' in src
      and pc.PER_COLLECTION == 5 and pc.PER_DAY == 12, (pc.PER_COLLECTION, pc.PER_DAY))

# ── what is owed, pure ─────────────────────────────────────────────────────
E = {"1": {"Number_Consumers_Present": "1", "end_time": "15:00:00"},
     "5": {"Number_Consumers_Present": "1", "end_time": ""},
     "9": {"Number_Consumers_Present": "0"},
     "3": {"Number_Consumers_Present": "2", "end_time": "15:00:00"},
     "7": {"Number_Consumers_Present": "1"},
     "20": {"end_time": "12:00:00"}}
HELD = {"1": {"answered": True, "print": pc.entry_print(E["1"]), "names": ["A"]},
        "3": {"answered": True, "print": "old", "names": ["B", "C"]},
        "7": {"miss_print": pc.entry_print(E["7"]), "misses": 1},
        "20": {"miss_print": pc.entry_print(E["20"]), "misses": pc.MISS_MAX}}
todo, by_count, counts = pc.due(E, HELD, skip={"99"}, stamp="now")
check("DUE: the never-asked first, newest id first, a missed one after them; then the answered and since "
      "changed; the answered and unchanged not at all; a count of 0 answered with no request; an entry "
      "set aside after MISS_MAX misses on this version not asked",
      [k for k, _p, _n in todo] == ["5", "7", "3"] and set(by_count) == {"9"}
      and by_count["9"]["names"] == [] and counts == {"answered": 1, "none_by_count": 1, "set_aside": 1,
                                                      "unproved": 0, "named_elsewhere": 0},
      (todo, by_count, counts))
todo2, _b, counts2 = pc.due(dict(E, **{"20": {"end_time": "13:00:00"}}), HELD, skip={"5"})
check("DUE: an entry set aside is asked again once it changes; one the stored copy already names is not asked",
      [k for k, _p, _n in todo2] == ["20", "7", "3"] and counts2["named_elsewhere"] == 1, (todo2, counts2))

# ── the pass, through the lane's own wire ──────────────────────────────────
NOW = datetime(2026, 9, 22, 15, 0, tzinfo=UTC)
SERVICE: dict[str, Any] = {}
calls: list[tuple[str, dict]] = []


def fake_call(method, body, timeout):
    calls.append((method, dict(body)))
    if method != pc.METHOD:
        raise AssertionError(f"the pass asked something else: {method}")
    got_ = SERVICE.get(str(body.get("singleEntryId")))
    if isinstance(got_, BaseException):
        raise got_
    return got_() if callable(got_) else got_


pa._call = fake_call


def asked() -> list[str]:
    return [b["singleEntryId"] for m, b in calls if m == pc.METHOD]


def entry(i: int, count: int = 1, **over: Any) -> dict:
    e = {"Single_Entry_ID": str(77000 + i), "Anywhere_status": "I", "firstname": "Ann", "lastname": f"Doe{i}",
         "peopleId": str(500 + i), "Date_of_Service": "9/22/2026 12:00:00 AM", "start_time": "07:00:00",
         "end_time": "15:00:00", "check_hours": "8.00", "WCCode": "HPC", "Last_Update": "9/22/2026 3:01:00 PM",
         "Location_Name": "1 Main St", "latitude": "40.1", "longitude": "-81.1",
         "Number_Consumers_Present": str(count), "comments": "", "_supervisorId": 3}
    e.update(over)
    return e


def lane(read_at: datetime, token: str = "TOKEN-KEPT", obtained: datetime | None = None) -> None:
    """The lane's state as a collection that READ at `read_at` leaves it."""
    pa._S.clear()
    pa._S.update({"session": {"token": token, "obtained_at": (obtained or read_at - timedelta(hours=2))
                              .isoformat(), "account": "adm"} if token else {},
                  "read_at": read_at.isoformat(), "judged": {}, "seen": {}, "pending": []})


def fill(read_at: datetime, now: datetime | None = None, **kw) -> dict:
    lane(read_at, **kw)
    return pa.fill_consumers(now or read_at + timedelta(minutes=1))


psi.forget_login()
login_at = psi._login_state["at"]
full.record_live([entry(1, 1), entry(2, 2), entry(3, 0)], NOW)
SERVICE.update({"77001": [client(1)], "77002": [client(2), client(3)]})
r1 = fill(NOW)
check("ONCE: a read's pass asks every entry without its clients — newest first — and the one whose count is 0 "
      "not at all", asked() == ["77002", "77001"] and r1["asked"] == 2 and r1["answered"] == 2, (asked(), r1))
check("ONCE: the request is the old scraper's own — the kept token and the entry id, nothing else",
      calls[0][1] == {"token": "TOKEN-KEPT", "singleEntryId": "77002"}, calls[:1])
rows = {r["single_entry_id"]: r for r in full.live_rows()}
r_1, r_2, r_3 = rows["77001"], rows["77002"], rows["77003"]
check("THE SHEET: the answered row carries the clients present — the name, the client's id, the attestation "
      "and the visit's flags folded the old scraper's way; nothing rides the raw column",
      r_1["consumers"] == "Doe1, Jane" and r_1["consumer_1"] == "Doe1, Jane" and r_1["consumer_1_id"] == "11"
      and r_1["consumer_1_evv_reason_code"] == "99" and r_1["consumer_1_has_signature"] == "False"
      and r_1["consumer_1_is_documented"] == "" and r_1["has_signature"] == "false"
      and r_1["is_documented"] == "false" and r_1["evv_reasons"] == "99" and r_1["extra_json"] == ""
      and r_1["consumers_present"] == "1", r_1)
check("THE SHEET: two clients fill two slots; a count of none leaves the names blank and the flags unknown",
      r_2["consumers"] == "Doe2, Jane; Doe3, Jane" and r_2["consumer_2_id"] == "13" and r_2["consumer_3"] == ""
      and r_3["consumers"] == "" and r_3["has_signature"] == "" and r_3["consumers_present"] == "0", (r_2, r_3))
check("THE SHEET: the header carries the client's id beside each slot, and the door declares the same list",
      [h for h in full.HEADER if h.startswith("consumer_1")] == [
          "consumer_1", "consumer_1_id", "consumer_1_evv_reason_code", "consumer_1_has_signature",
          "consumer_1_has_note", "consumer_1_is_documented"]
      and "'consumer_3_id'" in (REPO / "apps-script" / "PsiPunches.gs").read_text(encoding="utf-8"))
cfile = TMP / "psi-full" / pc.CONSUMERS_FILE
check("LOCKED: the answers live beside the full record — the file 0600, the directory 0700",
      stat.S_IMODE(cfile.stat().st_mode) == 0o600
      and stat.S_IMODE((TMP / "psi-full").stat().st_mode) == 0o700)
n = len(calls)
r_again = pa.fill_consumers(NOW + timedelta(minutes=2))
check("ONCE PER READ: the same read asked again sends nothing", len(calls) == n and r_again["asked"] == 0
      and "already served" in r_again["why"], r_again)
r_next = fill(NOW + timedelta(hours=1))
check("ONCE: the next read, the entries unchanged — nothing asked", len(calls) == n and r_next["asked"] == 0,
      r_next)
full.record_live([entry(1, 1, Anywhere_status="A", approvedUser="boss", approved_time="9/22/2026 5:00:00 PM",
                        Last_Update="9/22/2026 5:00:00 PM")], NOW + timedelta(hours=2))
fill(NOW + timedelta(hours=2))
check("ONCE: an approval, a status, a new Last_Update — who was there did not change, nothing asked",
      len(calls) == n, asked()[n:])
full.record_live([entry(1, 1, end_time="16:30:00")], NOW + timedelta(hours=3))
SERVICE["77001"] = [client(1), client(4)]
fill(NOW + timedelta(hours=3))
check("AGAIN ON A CHANGE: the entry closed later — asked once more, and the new answer replaces the old",
      asked()[n:] == ["77001"] and {r["single_entry_id"]: r for r in full.live_rows()}["77001"]["consumer_2_id"]
      == "14", asked()[n:])

# ── the caps ───────────────────────────────────────────────────────────────
full.record_live([entry(100 + i, 1) for i in range(20)], NOW + timedelta(hours=4))
for i in range(20):
    SERVICE[str(77100 + i)] = [client(i)]
n = len(calls)
fill(NOW + timedelta(hours=4))
check("CAP PER COLLECTION: a read's pass asks PER_COLLECTION at most — the newest first",
      asked()[n:] == [str(77119 - i) for i in range(pc.PER_COLLECTION)], asked()[n:])
day_sent = json.loads(cfile.read_text())["day"]
fill(NOW + timedelta(hours=5))
fill(NOW + timedelta(hours=6))
r_cap = fill(NOW + timedelta(hours=7))
check("CAP PER DAY: every request of the New York day counts — 3 before, then 5, 4 and none: PER_DAY is 12 — "
      "and the pass the purse stopped says so",
      day_sent == {"day": "2026-09-22", "sent": 8} and len(calls) - n == 5 + 4
      and json.loads(cfile.read_text())["day"] == {"day": "2026-09-22", "sent": 12}
      and r_cap["asked"] == 0 and "spent" in r_cap["why"] and r_cap["left"] == 11,
      (day_sent, len(calls) - n, json.loads(cfile.read_text())["day"], r_cap))
tomorrow = datetime(2026, 9, 23, 13, 0, tzinfo=UTC)
m = len(calls)
fill(tomorrow)
check("CAP PER DAY: a new New York day starts from zero", len(calls) - m == pc.PER_COLLECTION
      and json.loads(cfile.read_text())["day"] == {"day": "2026-09-23", "sent": 5}, len(calls) - m)
fill(tomorrow + timedelta(hours=1))
fill(tomorrow + timedelta(hours=2))
left = [k for k, _p, _n in pc.due(full.live_entries(), json.loads(cfile.read_text())["entries"], ())[0]]
check("CAP: the twenty crossed over two days in bounded passes (5, 4 · 5, 5, 1), each asked once, and "
      "nothing is owed after",
      left == [] and sorted(asked()[n:]) == sorted(str(77100 + i) for i in range(20)), (left, asked()[n:]))

# ── misses, failures, DOWN ─────────────────────────────────────────────────
D2 = datetime(2026, 9, 24, 13, 0, tzinfo=UTC)
full.record_live([entry(200, 1), entry(201, 1)], D2)
SERVICE.update({"77201": [], "77200": [client(9)]})
m = len(calls)
r_m = fill(D2)
held201 = json.loads(cfile.read_text())["entries"].get("77201") or {}
check("MISS: a count of one answered with nobody is a miss — never an answer — and ends the pass",
      asked()[m:] == ["77201"] and r_m["missed"] == 1 and not held201.get("answered")
      and held201.get("misses") == 1 and "names nobody" in r_m["why"], (asked()[m:], r_m, held201))
m = len(calls)
fill(D2 + timedelta(hours=1))
check("MISS: the next read asks the entries that did not miss first", asked()[m:] == ["77200", "77201"],
      asked()[m:])
m = len(calls)
fill(D2 + timedelta(hours=2))
check("MISS: MISS_MAX misses on the same version set it aside — the next read asks nothing",
      asked()[m:] == [] and json.loads(cfile.read_text())["entries"]["77201"]["misses"] == pc.MISS_MAX,
      asked()[m:])
full.record_live([entry(201, 1, end_time="17:00:00")], D2 + timedelta(hours=3))
SERVICE["77201"] = [client(5)]
m = len(calls)
fill(D2 + timedelta(hours=3))
check("MISS: once the entry changes it is asked again, and answered",
      asked()[m:] == ["77201"] and json.loads(cfile.read_text())["entries"]["77201"]["answered"] is True,
      asked()[m:])
full.record_live([entry(202, 1), entry(203, 1)], D2 + timedelta(hours=4))
SERVICE["77203"] = pa.PsiAnswer(f"{pc.METHOD}: answered 404")
m = len(calls)
fill(D2 + timedelta(hours=4))
check("MISS: an answer the lane cannot read (a 4xx, no Result) is a miss on that entry and ends the pass",
      asked()[m:] == ["77203"] and json.loads(cfile.read_text())["entries"]["77203"]["misses"] == 1,
      asked()[m:])
SERVICE["77202"] = socket.timeout("timed out")
before = json.loads(cfile.read_text())
m = len(calls)
r_t = fill(D2 + timedelta(hours=5))
after = json.loads(cfile.read_text())
check("TIMEOUT: a request that timed out ends the pass, marks nothing on the entry, counts against the day — "
      "and is never DOWN (the lane's read and login decide that)",
      asked()[m:] == ["77202"] and "77202" not in after["entries"]
      and after["day"]["sent"] == before["day"]["sent"] + 1 and psi.down_state() is None
      and "did not answer" in r_t["why"], (asked()[m:], r_t))
psi.mark_down("test: a read and a login both failed")
m = len(calls)
r_d = fill(D2 + timedelta(hours=6))
check("DOWN: while PsiAnywhere is held nothing leaves — and nothing is counted",
      len(calls) == m and r_d["asked"] == 0 and "held" in r_d["why"]
      and json.loads(cfile.read_text())["day"]["sent"] == after["day"]["sent"], r_d)
psi.forget_login()

# ── no session, no call ────────────────────────────────────────────────────
full.record_live([entry(300, 1)], D2 + timedelta(hours=7))
SERVICE["77300"] = [client(3)]
m = len(calls)
r_ns = fill(D2 + timedelta(hours=7), token="")
check("NO SESSION: no kept session — nothing sent", len(calls) == m and "no kept session" in r_ns["why"], r_ns)
r_old = fill(D2 + timedelta(hours=7), now=D2 + timedelta(hours=7) + timedelta(seconds=pc.FRESH_S + 60))
check("NO SESSION: a session that has not read lately is not leaned on — nothing sent",
      len(calls) == m and "not read lately" in r_old["why"], r_old)
r_new = fill(D2 + timedelta(hours=7), obtained=D2 + timedelta(hours=7, minutes=1))
check("NO SESSION: a session newer than the last read has not read yet — nothing sent",
      len(calls) == m and "not read yet" in r_new["why"], r_new)
psi.login_refused("Not active")
r_ref = fill(D2 + timedelta(hours=7))
check("NO SESSION: the account refused a login since — the session is dropped and nothing is sent",
      len(calls) == m and "no kept session" in r_ref["why"] and not pa._S.get("session"), r_ref)
psi.forget_login()
old_off = pc.PER_COLLECTION
pc.PER_COLLECTION = 0
r_off = fill(D2 + timedelta(hours=8))
pc.PER_COLLECTION = old_off
check("SWITCH: a cap of 0 switches the asking off", len(calls) == m and "switched off" in r_off["why"], r_off)
full._STORED["rows"] = [{"single_entry_id": "77300", "consumers": "Old, Named"}]
SERVICE.update({"77202": [client(6)], "77203": [client(7)]})
r_st = fill(D2 + timedelta(hours=9))
full._STORED["rows"] = []
check("STORED: an entry the old scraper already named is not asked again — the others still owed are, and "
      "the one that missed goes last",
      asked()[m:] == ["77202", "77203"] and r_st["answered"] == 2, (asked()[m:], r_st))

# ── the bounds when the file refuses the write ─────────────────────────────
# Everything a pass learned used to live in the one write at its end: the
# answers, the read it served and the day's purse. A consumers.json that could
# not be written took all three, and the same newest entries were asked again
# on every pass of every read, past PER_DAY, with nothing kept and nothing said.
D3 = datetime(2026, 9, 25, 13, 0, tzinfo=UTC)
full.record_live([entry(400 + i, 1) for i in range(12)], D3)
for i in range(12):
    SERVICE[str(77400 + i)] = [client(i)]
real_write = full._write
refusing = {"on": True}


def failing_write(name, body):
    if refusing["on"] and name == pc.CONSUMERS_FILE:
        raise OSError(28, "No space left on device")
    return real_write(name, body)


full._write = failing_write
m = len(calls)
r_w1 = fill(D3)
r_same = pa.fill_consumers(D3 + timedelta(minutes=5))
r_w2 = fill(D3 + timedelta(hours=1))
check("UNWRITABLE: the pass says its answers could not be kept — and the read it served is served all the "
      "same, so the next pass for the same read asks nothing",
      len(calls) - m == pc.PER_COLLECTION and "could not be kept" in r_w1["why"]
      and r_same["asked"] == 0 and "already served" in r_same["why"],
      (len(calls) - m, r_w1["why"], r_same["why"]))
check("UNWRITABLE: and nothing is asked on the reads after it either, until the file takes a write again — "
      "a request whose answer is thrown away is spent for nothing",
      len(calls) - m == pc.PER_COLLECTION and r_w2["asked"] == 0
      and "still cannot be written" in r_w2["why"], (len(calls) - m, r_w2["why"]))
check("UNWRITABLE: the day's purse counted what left anyway — the file may be behind, the bound is not",
      pc.status()["spent"] == {"day": "2026-09-25", "sent": pc.PER_COLLECTION} and pc.status()["unkept"],
      pc.status())
refusing["on"] = False
m = len(calls)
r_w3 = fill(D3 + timedelta(hours=2))
r_w4 = fill(D3 + timedelta(hours=3))
r_w5 = fill(D3 + timedelta(hours=4))
check("UNWRITABLE: once a write lands the asking goes on, and the day is bound by what was really sent — "
      f"the {pc.PER_COLLECTION} lost requests included, so PER_DAY ({pc.PER_DAY}) is still PER_DAY",
      len(calls) - m == pc.PER_DAY - pc.PER_COLLECTION
      and json.loads(cfile.read_text())["day"] == {"day": "2026-09-25", "sent": pc.PER_DAY}
      and r_w5["asked"] == 0 and "spent" in r_w5["why"] and not pc.status()["unkept"],
      (len(calls) - m, json.loads(cfile.read_text())["day"], r_w3["asked"], r_w4["asked"], r_w5["why"]))

# ── the lane's own lock, never waited out ──────────────────────────────────
# `tick` holds that lock for a WHOLE collection, and the hourly sweep awaits
# the task this pass runs in: waiting for it would put the housekeeping behind
# a collection. The clients present are never urgent.
holding = threading.Event()


def a_collection() -> None:
    with pa._LOCK:
        holding.set()
        time.sleep(0.8)


th = threading.Thread(target=a_collection)
th.start()
holding.wait(2)
waited_for = pa.CONSUMERS_LANE_WAIT_S
pa.CONSUMERS_LANE_WAIT_S = 0.15
m = len(calls)
t0 = time.monotonic()
r_busy = pa.fill_consumers(D3 + timedelta(hours=5))
waited = time.monotonic() - t0
pa.CONSUMERS_LANE_WAIT_S = waited_for
th.join()
fc_src = (SERVER / "psi_attendance.py").read_text(encoding="utf-8").split(
    "def fill_consumers(", 1)[1].split("\ndef ", 1)[0]
check("THE LANE COMES FIRST: while a collection holds the lane's lock this pass gives it up in seconds "
      "instead of standing in front of the sweep that waits on it",
      r_busy["asked"] == 0 and "busy" in r_busy["why"] and len(calls) == m and waited < 0.6
      and "_LOCK.acquire(timeout=" in fc_src and "with _LOCK" not in fc_src,
      (r_busy, round(waited, 2)))

# ── an entry nothing counts, answered with nobody ──────────────────────────
# The guard in `parse` holds an answer to the entry's own count — but the
# staff-hours history refuses that field, so an entry known only from there has
# none, and a session PsiAnywhere no longer takes answers it exactly as an empty
# punch would. Neither is written down.
D4 = datetime(2026, 9, 26, 13, 0, tzinfo=UTC)
E4 = {"78001": {"Single_Entry_ID": "78001", "Date_of_Service": "9/26/2026 12:00:00 AM",
                "start_time": "07:00:00", "end_time": "15:00:00"}}
SERVICE["78001"] = []
check("UNPROVED: an entry the history alone knows carries no count of the clients — nothing can hold such "
      "an answer to a number",
      pc.count_of(E4["78001"]) is None
      and not [k for k in __import__("psi_entries").KEPT if "Consumers" in k])
m = len(calls)
r_e1 = pc.fill("TOKEN-KEPT", D4.isoformat(), D4 + timedelta(minutes=1), entries=E4, skip=())
rec_e = json.loads(cfile.read_text())["entries"]["78001"]
check("UNPROVED: nobody named where nothing counts is NOT written down as 'nobody was there' — the entry "
      "is not answered, keeps no names, and stays askable",
      asked()[m:] == ["78001"] and r_e1["unproved"] == 1 and r_e1["answered"] == 0
      and not rec_e.get("answered") and not rec_e.get("names") and rec_e.get("empties") == 1,
      (asked()[m:], r_e1, rec_e))
m = len(calls)
pc.fill("TOKEN-KEPT", (D4 + timedelta(hours=1)).isoformat(), D4 + timedelta(hours=1), entries=E4, skip=())
rec_e2 = json.loads(cfile.read_text())["entries"]["78001"]
check("UNPROVED: the next read asks it again — an empty answer buys no more than a miss does",
      asked()[m:] == ["78001"] and rec_e2.get("empties") == pc.EMPTY_MAX, (asked()[m:], rec_e2))
m = len(calls)
r_e3 = pc.fill("TOKEN-KEPT", (D4 + timedelta(hours=2)).isoformat(), D4 + timedelta(hours=2),
               entries=E4, skip=())
said = pc.status()
check("UNPROVED: after EMPTY_MAX on this version it is set aside until the entry changes, and anybody "
      "reading the status can see it: `unproved` is counted apart from the entries whose own count said nobody",
      asked()[m:] == [] and r_e3["asked"] == 0 and said["unproved"] == 1 and said["none_by_count"] >= 1
      and "78001" not in pc.answers(), (asked()[m:], said))
SERVICE["78001"] = [client(8)]
E4b = {"78001": dict(E4["78001"], end_time="17:00:00")}
m = len(calls)
pc.fill("TOKEN-KEPT", (D4 + timedelta(hours=3)).isoformat(), D4 + timedelta(hours=3), entries=E4b, skip=())
check("UNPROVED: once the entry changes it is asked again — and a real answer settles it",
      asked()[m:] == ["78001"] and pc.answers()["78001"]["names"] == ["Doe8, Jane"]
      and pc.status()["unproved"] == 0, asked()[m:])

check("NO LOGIN: not one getLogIn in any of it, and the login clock never moved",
      all(mm == pc.METHOD for mm, _b in calls) and psi._login_state["at"] == login_at
      and not json.loads((TMP / "login-clock.json").read_text()).get("at"),
      sorted({mm for mm, _b in calls}))
check("NO LOGIN: the module never signs in — no login call, no credential read, in its source",
      "getLogIn" not in src and "_sign_in" not in src and "_credential" not in src and "login_claim" not in src)

# ── the file, and the sheet after it ───────────────────────────────────────
kept = cfile.read_text()
cfile.write_text("{truncated", encoding="utf-8")
m = len(calls)
r_bad = fill(D2 + timedelta(hours=10))
check("UNREADABLE: consumers.json that cannot be read is never written over, and nothing is asked",
      len(calls) == m and cfile.read_text() == "{truncated" and "could not be read" in r_bad["why"], r_bad)
check("UNREADABLE: the sheet still builds — the rows go without names this pass",
      {r["single_entry_id"]: r for r in full.live_rows()}["77001"]["consumers"] == "", "")
cfile.write_text(kept, encoding="utf-8")
full.stored_rows = lambda dsn: []
built = full.build("dsn", D2)
in_json = {r["single_entry_id"]: r for r in json.loads((TMP / "psi-full" / full.ROWS_FILE).read_text())["rows"]}
check("JSON FIRST: rows.json carries the clients the call answered",
      in_json["77002"]["consumers"] == "Doe2, Jane; Doe3, Jane" and in_json["77201"]["consumer_1_id"] == "15",
      in_json.get("77002"))
got_pass = full.next_pass("dsn", "collection", D2.timestamp())
check("THE PASS: the collection's pass right after carries the answered rows to the sheet",
      got_pass and got_pass["kind"] == "live"
      and any(r["single_entry_id"] == "77002" and r["consumers"] for r in got_pass["batch"]),
      got_pass and got_pass["kind"])
snap = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
run_src = snap.split("async def _psi_full_run", 1)[1].split("\nasync def ", 1)[0]
check("THE RELAY: the full sheet's own task asks the lane before each pass — off the beat, never in the tick",
      "psi_attendance.fill_consumers" in run_src
      and run_src.index("psi_attendance.fill_consumers") < run_src.index("_psi_full_tick(")
      and "fill_consumers" not in (SERVER / "psi_attendance.py").read_text(encoding="utf-8")
      .split("def _pass(", 1)[1].split("\ndef ", 1)[0])
check("THE LINE: the staff-hours record still refuses every client field the answers carry",
      not re.search(r"consumer", " ".join(__import__("psi_entries").KEPT), re.I))

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
