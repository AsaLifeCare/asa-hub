#!/usr/bin/env python3
"""The punch pair rule, its messages and its warning ladder, asserted against the real functions.

Every shift owes a clock-in and a clock-out OF ITS OWN, so the checks below are
about shifts and never about days: a double is two shifts, two pairs and two
messages. No network, no database and no door is reached — the pairing, the
quiet policy, the facts each row carries, the cadence's exhaustion, the director
spacing and its caps are pure. What needs Postgres — opening a warning, the
RECEIVED, the conversion — runs its own code against a cursor that only records
what it was asked, so no row is ever written anywhere.

It runs in the relay container, on the CHECKOUT's modules, because the lane's
files import the driver the host has no copy of.

    python3 tools/test-punch-pairs.py
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")
MODULES = ("punch_pairs", "psi_attendance", "psi_reminders", "psi_entries",
           "shift_requests", "shift_handoff", "shift_slices", "house_cal_live",
           "house_directory", "effective_roster", "calendar_builder_houses",
           "calendar_builder_write", "sms_ears", "quo_inbox", "quo_pull", "time_off",
           "psi_anywhere", "hotline_desk", "daily_notes", "ist_config", "mirror_first",
           "web_notices", "web_gate", "web_push", "badge_follows", "punch_board_slices",
           "psi_punches_feed", "psi_punches_full", "psi_consumers", "redaction")
# The Apps Script halves the checks below read: the door's kinds, the quiet
# window it keeps whole, and the words the situations carry.
GS = ("StaffAlerts.gs", "Rpc.gs", "SmartComms.gs")


def _run_in_container() -> int:
    here = os.path.abspath(__file__)
    root = os.path.dirname(os.path.dirname(here))
    server = os.path.join(root, "server")
    sources = {}
    for name in MODULES:
        with open(os.path.join(server, name + ".py"), encoding="utf-8") as fh:
            sources[name] = fh.read()
    gs = {}
    for name in GS:
        with open(os.path.join(root, "apps-script", name), encoding="utf-8") as fh:
            gs[name] = fh.read()
    # THE RELAY'S ROUTE, as text: only the RECEIVED door is lifted out of it
    # and run against stand-ins — the service itself is never imported.
    with open(os.path.join(server, "snapshot_service.py"), encoding="utf-8") as fh:
        svc = fh.read()
    with open(here, encoding="utf-8") as fh:
        body = fh.read()
    blob = base64.b64encode(json.dumps({"sources": sources, "gs": gs, "svc": svc}).encode()).decode()
    script = f"PUNCH_SOURCES = {blob!r}\n" + body
    try:
        proc = subprocess.run(["docker", "exec", "-i", "-e", "HUB_IST_CONFIG_DECLARATION_JSON="
                               + open(os.path.join(server, "ist_config_defaults.json"),
                                      encoding="utf-8").read(), CONTAINER, "python3", "-"],
                              input=script, capture_output=True, text=True, timeout=300)
    except FileNotFoundError:
        print("docker is not available here — nothing to test against.")
        return 2
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode


# ── THE LANE: the ladder's own SQL, against a real Postgres ─────────────────
#
# Everything above records the SQL it would run. This lane runs it: a schema of
# its own (tools/lane_schema.py), the lane's tables made there before the first
# read, and the ladder driven through its real functions — the warning opened,
# told, answered, claimed, converted and closed — with only the calendar's own
# act, the estate read, the directors list and the People house stood in.
LANE_WORK = f"/tmp/punch-pairs-lane-{os.urandom(4).hex()}"
# the same roots as the reply ear's lane, which ships this lane's modules
LANE_ROOTS = ("punch_pairs", "psi_attendance", "psi_reminders", "sms_ears", "shift_requests",
              "shift_handoff", "quo_inbox", "hotline_desk", "mirror_first", "calendar_builder_houses",
              "calendar_builder_write", "calendar_builder_slices", "house_cal_live", "shift_slices",
              "house_directory", "badge_follows", "effective_roster", "time_off", "redaction",
              "web_notices", "ist_config")
# NEVER THE LIVE LANE'S FILES: every state file the modules could reach is the run's own.
LANE_ENV = {
    "HUB_PSI_BASE": "https://psianywhere.invalid",
    "HUB_PSI_SECRET_FILE": "/nonexistent/punch-pairs-psi.json",
    "HUB_PSI_TY_SECRET_FILE": "/nonexistent/punch-pairs-psi-ty.json",
    "HUB_PSI_ATTENDANCE_STATE": f"{LANE_WORK}/state.json",
    "HUB_PSI_REMINDERS_STATE": f"{LANE_WORK}/reminders.json",
    "HUB_PSI_LOGIN_CLOCK_FILE": f"{LANE_WORK}/login-clock.json",
    "HUB_PSI_PUNCH_BOARD": f"{LANE_WORK}/board.json",
    "HUB_PSI_ENTRIES_DIR": f"{LANE_WORK}/entries",
    "HUB_QUO_INBOX_DIR": f"{LANE_WORK}/inbox",
    "HUB_SNAPSHOT_OUT": LANE_WORK,
}

LANE_BODY = r'''
import atexit, json, os, shutil, traceback, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

WORK = Path(os.environ["HUB_SNAPSHOT_OUT"])
WORK.mkdir(parents=True, exist_ok=True)
atexit.register(shutil.rmtree, str(WORK), True)


def _no_network(*_a, **_k):
    raise AssertionError("the lane tried to reach the network")


urllib.request.urlopen = _no_network

import psycopg2, psycopg2.extras
import lane_schema
import psi_reminders as pr
import punch_pairs as pp
import shift_requests as sr
import calendar_builder_houses as cbh
import time_off

pr.STATE_FILE = WORK / "reminders.json"
pr.STATE_FILE.write_text(json.dumps({"ledger": {}, "stopped": {}}), encoding="utf-8")
pr.forget()
time_off.use_house(time_off.NoHouse())
# the directors and the People house are the settings list's and the People book's; stood in here
pp.directors = lambda dsn: ["Cal Sample", "Ann Example"]
pp._people = lambda: []

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
ROOMS = lane_schema.Rooms(DSN, "punch-pairs")
SCHEMA = ROOMS.name()
UTC = timezone.utc
CHECKS = []
OUT = {"checks": CHECKS}


def check(name, ok, detail=""):
    CHECKS.append([name, bool(ok), str(detail)[:700]])


NOW = datetime.now(UTC).replace(microsecond=0)
DAY = NOW.astimezone(pp.OHIO).date().isoformat()
START, END = NOW - timedelta(hours=2), NOW + timedelta(hours=6)
LOC = "CALENDAR - JH"
PEOPLE = ("Dana Reed", "Kim Ash", "Lee Park", "Mo Pool", "Nia End")
VIEW = {"isos": {LOC: [DAY]}, "by_code": {"JH": LOC},
        "cells": {LOC: {(n, DAY): "7A-3P" for n in PEOPLE}}, "people": {LOC: list(PEOPLE)}}
MADE = []


def shift(sid, person, *, read_at=None, verdict=None, fault=True, end=None):
    return {"id": sid, "ref": pp.ref_of(sid), "person": person,
            "person_key": person.lower().replace(" ", ""), "house": "JH", "house_name": "JH home",
            "shift_code": "7a-3p", "day": DAY, "shift_at": START.isoformat(),
            "shift_end": (end or END).isoformat(), "verdict": verdict or pp.MISSING, "fault": fault,
            "read_at": (read_at or NOW).isoformat(), "time": "07:00", "ends": "15:00"}


def row(wid):
    with psycopg2.connect(T) as c, c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM asa_punch_warnings WHERE id=%s", (wid,))
        got = cur.fetchone()
    return dict(got) if got else {}


def said(wid):
    return pp._said_of(row(wid))


def told(wid, phones, at, *, dial="send", test_mode="off", state="told", code=""):
    """One telling of the warning, answered by the door for each director."""
    batch = pp.warning_door_rows(row(wid), ["Cal Sample", "Ann Example"])
    res = {"dial": dial, "test_mode": test_mode,
           "results": [{"id": r["id"], "state": state, "phone_key": p, "code": code}
                       for r, p in zip(batch, phones)]}
    pp.mark_said(T, [r["id"] for r in batch], res, now=at)


def opened(sid, person, at=NOW, **kw):
    return pp.open_warnings(T, [shift(sid, person, **kw)], now=at,
                            stopped={sid: {"why": "no_contact", "code": ""}})


def call_off(_dsn, **kw):
    MADE.append(kw)
    return {"ref": sr.ref_of(kw["location"], kw["employee"], kw["col_iso"]),
            "window": {"why": "open to all staff for 5 hours from the call-off"}}


ROOMS.make()
T = ROOMS.path(SCHEMA)

try:
    # every table the shipped code names resolves in the lane before the first read
    OUT["owned"] = lane_schema.own_shift_lane(T, SCHEMA, LANE_DIR, make=list(pp.DDL))
    owned = OUT["owned"]["lane"]
    check("the warnings and the lane's own ledger are made in the lane's schema, never public's",
          owned.get("asa_punch_warnings") == SCHEMA and owned.get("asa_punch_said") == SCHEMA
          and owned.get("asa_shift_pool") == SCHEMA, owned)
    pp.forget_tables()
    sr.estate = lambda dsn, **k: VIEW
    cbh.mark_call_off = call_off

    # ── A. opened once, on the real table ─────────────────────────────────
    got = opened("lane|s1", "Dana Reed")
    again = opened("lane|s1", "Dana Reed")
    w = row("lane|s1")
    check("A: a warning is opened on the real table, warned, under its own ref — and only once",
          got["opened"] == 1 and again["opened"] == 0 and w.get("state") == pp.WARNED
          and w.get("ref") == pp.ref_of("lane|s1") and w.get("said") == {} and w.get("phones") == [],
          (got, again, w))

    # ── B. told: the round, the phones as a set, the real span ────────────
    told("lane|s1", ["k1", "k2"], NOW)
    w = row("lane|s1")
    check("B: a telling that reached both directors counts once, reached a phone, and keeps both phones",
          w["tells"] == 1 and w["attempts"] == 1 and w["delivered"] == 1
          and sorted(w["phones"]) == ["k1", "k2"] and w["told_at"] == NOW
          and w["first_said_at"] == NOW and w["last_said_at"] == NOW, w)
    told("lane|s1", ["k1", "k2"], NOW + timedelta(minutes=20), state="duplicate")
    w = row("lane|s1")
    check("B: told again to the same phones, the phones stay a set of two (jsonb_agg DISTINCT), the first "
          "telling keeps its time and the latest moves",
          w["tells"] == 2 and w["delivered"] == 2 and sorted(w["phones"]) == ["k1", "k2"]
          and w["first_said_at"] == NOW and w["last_said_at"] == NOW + timedelta(minutes=20), w)
    told("lane|s1", ["k1", "k2"], NOW + timedelta(minutes=40), state="held", code="situation_off")
    w = row("lane|s1")
    check("B: a round the situation held is written on the row and counted as an attempt, never a telling",
          w["tells"] == 2 and w["attempts"] == 3 and w["told_at"] == NOW + timedelta(minutes=40)
          and w["last_said_at"] == NOW + timedelta(minutes=20)
          and [a["state"] for a in pp._said_of(w)["last"]["answers"]] == ["held", "held"], w)
    told("lane|s1", ["k9", "k9"], NOW + timedelta(minutes=60), dial="record", test_mode="on", state="recorded")
    w = row("lane|s1")
    check("B: a telling only written down under test mode is a telling that reached nobody — no phone joins",
          w["tells"] == 3 and w["delivered"] == 2 and sorted(w["phones"]) == ["k1", "k2"], w)
    check("C: the phones a live warning reached, read back for the ear's bare RECEIVED",
          pp.warned_phones(T) == {"k1", "k2"}, pp.warned_phones(T))

    # ── D. answered on a fresh read: the call off, through the calendar's act ──
    at_d = NOW + timedelta(minutes=61)
    got = pp.acknowledge(T, by="Cal Sample", ref=w["ref"], via="sms", now=at_d,
                         paired=[shift("lane|s1", "Dana Reed", read_at=at_d - timedelta(minutes=1))])
    w = row("lane|s1")
    s = pp._said_of(w)
    check("D: a RECEIVED on a fresh read converts through the calendar's own act, once, and the row keeps "
          "who answered, the call off's ref and no claim",
          got["state"] == pp.CONVERTED and w["state"] == pp.CONVERTED and len(MADE) == 1
          and w["call_off_ref"] == sr.ref_of(LOC, "Dana Reed", DAY) == got["call_off_ref"]
          and w["received_by"] == "Cal Sample" and w["received_via"] == "sms"
          and "converting" not in s and "converting_by" not in s and "open_ack" not in s, (got, w))

    # ── E. answered on a stale read: waits, marked, then the retry opens it and owes the news ──
    opened("lane|s2", "Kim Ash")
    told("lane|s2", ["k3", ""], NOW)
    at_e = NOW + timedelta(minutes=40)
    got = pp.acknowledge(T, by="Ann Example", ref=pp.ref_of("lane|s2"), now=at_e,
                         paired=[shift("lane|s2", "Kim Ash", read_at=NOW)])
    s = said("lane|s2")
    check("E: a RECEIVED with no fresh read is on file and waits — marked as told it waits, nothing claimed, "
          "no calendar asked",
          got["state"] == pp.RECEIVED and got.get("waiting") == pp.WAIT_READ
          and row("lane|s2")["state"] == pp.RECEIVED and "waiting_ack" in s and "converting" not in s
          and len(MADE) == 1, (got, s))
    counts = pp.retry_conversions(T, now=at_e + timedelta(minutes=1),
                                  paired=[shift("lane|s2", "Kim Ash", read_at=at_e + timedelta(minutes=1))])
    w = row("lane|s2")
    s = pp._said_of(w)
    follow = pp._follow_ack_rows([w], {}, at_e + timedelta(minutes=2))
    check("E: the retry converts it on the read it waited for, and the same write owes the director the open "
          "shift's news — one row, to who answered",
          counts["converted"] == 1 and w["state"] == pp.CONVERTED and "open_ack" in s
          and "converting" not in s and len(follow) == 1 and follow[0]["kind"] == pp.K_OPEN_ACK
          and follow[0]["person"] == "Ann Example" and follow[0]["call_off_ref"] == w["call_off_ref"],
          (counts, w, follow))
    key = follow[0]["id"] if follow else ""
    pp.mark_said(T, [key], {"dial": "send", "test_mode": "off",
                            "results": [{"id": key, "state": "told"}]}, now=at_e + timedelta(minutes=2))
    ledger = pp._said(T)
    check("E: the news said is kept in the lane's own ledger, and never owed again",
          (ledger.get(key) or {}).get("state") == "told"
          and pp._follow_ack_rows([w], ledger, at_e + timedelta(minutes=30)) == [], ledger.get(key))

    # ── F. one pass at a time: the claim, on the real row ─────────────────
    opened("lane|s3", "Lee Park")
    told("lane|s3", ["k4", ""], NOW)
    at_f = NOW + timedelta(minutes=40)
    pp.acknowledge(T, by="Cal Sample", ref=pp.ref_of("lane|s3"), now=at_f,
                   paired=[shift("lane|s3", "Lee Park", read_at=NOW)])
    t1 = pp._claim(T, "lane|s3", at_f)
    t_again = pp._claim(T, "lane|s3", at_f + timedelta(minutes=1))
    check("F: the claim is a compare-and-set — one pass holds it, a second is refused while it is live",
          len(t1) == 16 and t_again == "" and said("lane|s3").get("converting_by") == t1, said("lane|s3"))
    later = at_f + timedelta(minutes=1)
    punched = shift("lane|s3", "Lee Park", read_at=later, verdict=pp.PAIRED, fault=False)
    down = pp._stand_down(T, "lane|s3", why="the shift was not opened - x", now=later)
    tried = pp._note_conversion(T, "lane|s3", ref="", why="y", at=None, now=later)
    shut = pp.open_warnings(T, [punched], now=later, stopped={})
    before = row("lane|s3")
    other = pp.convert(T, "lane|s3", now=later, paired=[punched])
    after = row("lane|s3")
    check("F: beside a live claim nobody else moves the row — the retry's close, its counted try, the "
          "pairing's close and another pass's conversion all land on nothing",
          down == 0 and tried == 0 and shut["closed"] == 0 and other.get("code") == "converting"
          and after["state"] == pp.RECEIVED and after["said"] == before["said"]
          and after["said"].get("converting_by") == t1 and "convert" not in after["said"],
          (down, tried, shut, other, after["said"]))
    pp._let_go(T, "lane|s3", "not-this-pass")
    kept = said("lane|s3").get("converting_by")
    pp._let_go(T, "lane|s3", t1)
    check("F: only the pass that holds the claim lets it go",
          kept == t1 and "converting" not in said("lane|s3") and "converting_by" not in said("lane|s3"),
          said("lane|s3"))
    t2 = pp._claim(T, "lane|s3", later)
    dead_after = later + timedelta(minutes=pp.CLAIM_MIN + 1)
    t3 = pp._claim(T, "lane|s3", dead_after)
    stale_close = pp._stand_down(T, "lane|s3", why="z", claim=t2, now=dead_after)
    live_close = pp._stand_down(T, "lane|s3", why="the shift was not opened - they clocked in", claim=t3,
                                now=dead_after)
    w = row("lane|s3")
    s = pp._said_of(w)
    check("F: a claim older than CLAIM_MIN is taken over, the dead pass's close then lands nowhere, and the "
          "new holder's close lands, lets the claim go and owes the director who was told it waits",
          t2 and t3 and t2 != t3 and stale_close == 0 and live_close == 1 and w["state"] == pp.CLOSED
          and "converting" not in s and "converting_by" not in s and "closed_ack" in s
          and "clocked in" in w["call_off_why"], (t2, t3, stale_close, live_close, w))

    # ── G. "already in the pool": the pool row read by its real columns ────
    check("G: the pool row is read by its real columns — a ref no row carries is not ours, and reads cleanly",
          pp._pooled_from(T, "SPNOTHERE000", pp.ref_of("lane|s4")) is None)
    opened("lane|s4", "Mo Pool")
    told("lane|s4", ["k5", ""], NOW)
    at_g = NOW + timedelta(minutes=40)
    pp.acknowledge(T, by="Cal Sample", ref=pp.ref_of("lane|s4"), now=at_g,
                   paired=[shift("lane|s4", "Mo Pool", read_at=NOW)])
    pool_ref = sr.ref_of(LOC, "Mo Pool", DAY)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("INSERT INTO asa_shift_pool (location, open_row, col_iso, ref, reason, opened_at, "
                    "shift_start) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                    (LOC, "Mo Pool", DAY, pool_ref,
                     f"automatic call off: the warning {pp.ref_of('lane|s4')} was answered RECEIVED",
                     at_g, START))
        c.commit()

    def pooled(_dsn, **_kw):
        raise sr.Refused("this shift is already in the open-shift pool", "already_pooled")

    cbh.mark_call_off = pooled
    got = pp.convert(T, "lane|s4", now=at_g + timedelta(minutes=1),
                     paired=[shift("lane|s4", "Mo Pool", read_at=at_g + timedelta(minutes=1))])
    cbh.mark_call_off = call_off
    w = row("lane|s4")
    check("G: \"already in the pool\" about the call off this warning made is this warning's call off",
          got["state"] == pp.CONVERTED and w["state"] == pp.CONVERTED and w["call_off_ref"] == pool_ref
          and "converting" not in pp._said_of(w), (got, w))

    # ── H. the shift ends with no answer: the real span ───────────────────
    opened("lane|s5", "Nia End", end=NOW + timedelta(hours=1))
    told("lane|s5", ["k6", ""], NOW)
    n = pp.expire_warnings(T, now=NOW + timedelta(minutes=61))
    w = row("lane|s5")
    check("H: a warning whose shift ended stops, and says the real span it was said over",
          n == 1 and w["state"] == pp.GAVE_UP and "the shift ended with no answer" in w["why"]
          and "it was said once" in w["why"], (n, w))

    # ── I. the tables once per database per process ──────────────────────
    pp.forget_tables()
    pp._ensure(T)
    pp._ensure(T)
    check("I: the tables are made again only when forgotten, and making them twice changes nothing",
          T in pp._READY and lane_schema.assert_owned(T, SCHEMA, ["asa_punch_warnings", "asa_punch_said"]))
except Exception as exc:  # noqa: BLE001
    OUT["crash"] = f"{type(exc).__name__}: {exc}"
    OUT["trace"] = traceback.format_exc()[-3000:]
finally:
    OUT["rooms"] = ROOMS.close()
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''


def _run_lane() -> int:
    """The lane's verdict: 0 when every check held, 1 otherwise; 0 with a note when no container runs it."""
    here = Path(os.path.abspath(__file__))
    sys.path.insert(0, str(here.parent))
    import lane_schema  # noqa: PLC0415 — beside this file
    sources = lane_schema.with_imports(here.parent.parent / "server", LANE_ROOTS)
    got = lane_schema.run_in(CONTAINER, lane_schema.script(sources, LANE_BODY, "punch-pairs"), env=LANE_ENV)
    print("\n-- the lane: the ladder's SQL against a real database --")
    if got is None:
        print("  (skipped — no docker here to reach a relay container)")
        return 0
    checks = got.get("checks") or []
    for name, ok, detail in checks:
        print(f"{'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f" — {detail}"))
    passed = sum(1 for _n, ok, _d in checks if ok)
    failed = len(checks) - passed
    if got.get("crash"):
        print(f"FAIL the lane ran to its end — {got.get('trace') or got['crash']}")
        failed += 1
    if not checks:
        print("FAIL the lane made no checks")
        failed += 1
    print(f"\nlane: {passed} ok, {failed} failed")
    return 1 if failed else 0


if "PUNCH_SOURCES" not in globals():
    _pure = _run_in_container()
    _lane = _run_lane() if _pure != 2 else 0
    sys.exit(_pure or _lane)


import importlib.abc  # noqa: E402
import importlib.util  # noqa: E402

_BLOB = json.loads(base64.b64decode(PUNCH_SOURCES))  # noqa: F821 — set by the host half
_SOURCES = _BLOB["sources"]
GS_TEXT = _BLOB["gs"]
SVC_TEXT = _BLOB["svc"]


class _Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    """The checkout's modules, never /srv/app's."""

    def find_spec(self, name, path, target=None):
        if name in _SOURCES:
            return importlib.util.spec_from_loader(name, self, origin="checkout:" + name)
        return None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = "/srv/app/" + module.__name__ + ".py"
        exec(compile(_SOURCES[module.__name__], "checkout/" + module.__name__ + ".py", "exec"),
             module.__dict__)


sys.meta_path.insert(0, _Checkout())

TMP = Path(tempfile.mkdtemp(prefix="punch-pairs-"))
# NEVER THE LIVE LANE'S FILES: the credential, the login clock, the board, the
# reminders' ledger and the text inbox all live where the running relay reads them.
os.environ.update({
    "HUB_PSI_BASE": "https://psianywhere.invalid",
    "HUB_PSI_SECRET_FILE": "/nonexistent/punch-pairs-psi.json",
    "HUB_PSI_TY_SECRET_FILE": "/nonexistent/punch-pairs-psi-ty.json",
    "HUB_PSI_ATTENDANCE_STATE": str(TMP / "state.json"),
    "HUB_PSI_REMINDERS_STATE": str(TMP / "reminders.json"),
    "HUB_PSI_LOGIN_CLOCK_FILE": str(TMP / "login-clock.json"),
    "HUB_PSI_PUNCH_BOARD": str(TMP / "board.json"),
    "HUB_PSI_ENTRIES_DIR": str(TMP / "entries"),
    "HUB_QUO_INBOX_DIR": str(TMP / "inbox"),
    "HUB_SNAPSHOT_OUT": str(TMP),
})


def _no_network(*_a, **_k):
    raise AssertionError("the test tried to reach the network")


urllib.request.urlopen = _no_network

import psi_attendance as pa  # noqa: E402
import psi_reminders as pr  # noqa: E402
import punch_pairs as pp  # noqa: E402

pa._call = _no_network
OHIO, UTC = pa.OHIO, timezone.utc
# NOBODY'S PEOPLE FILE: the director rows are spelled from the settings list here.
pp._people = lambda: []

results = {"ok": 0, "failed": []}


def check(name, cond, detail=""):
    if cond:
        results["ok"] += 1
        print(f"ok   {name}")
    else:
        results["failed"].append(name)
        print(f"FAIL {name}{(' — ' + str(detail)[:500]) if detail else ''}")


DAY = date(2026, 9, 22)


def at(day, hhmm):
    h, m = hhmm.split(":")
    return datetime(day.year, day.month, day.day, int(h), int(m), tzinfo=OHIO).astimezone(UTC)


def shift(person, code, day, start, end, house="JH"):
    """A roster shift in psi_attendance.roster's own shape."""
    s, e = at(day, start), at(day, end)
    if e <= s:
        e = e + timedelta(days=1)
    return {"person_key": pa.flat_key(person), "keys": pa.person_keys(person), "name": person,
            "house": house, "shift_code": code, "shift_date": day, "shift_at": s, "shift_end": e}


def entry(person, day, start, end, eid):
    """One PsiAnywhere entry row, spelled as the service spells them."""
    first, _, last = person.partition(" ")
    row = {"firstname": first, "lastname": last, "Single_Entry_ID": eid,
           "Date_of_Service": f"{day.month}/{day.day}/{day.year}", "start_time": start}
    if end is not None:
        row["end_time"] = end
    return row


def index_of(rows):
    idx, _counts = pa.punch_index(rows)
    return idx


def verdicts(rows):
    return {r["shift_code"] + "@" + r["time"]: r["verdict"] for r in rows}


RECENT = pa.person_keys("Dana Reed") | pa.person_keys("Kim Ash") | pa.person_keys("Bob Lane")


# ── 1. the pairing ──────────────────────────────────────────────────────────

print("\n-- pairing --")

# A BACK-TO-BACK PAIR WITH TWO ENTRIES: each shift has its own pair.
two = [shift("Dana Reed", "7a-3p", DAY, "07:00", "15:00"),
       shift("Dana Reed", "3p-11p", DAY, "15:00", "23:00")]
idx = index_of([entry("Dana Reed", DAY, "7:00 AM", "3:00 PM", "E1"),
                entry("Dana Reed", DAY, "3:00 PM", "11:00 PM", "E2")])
got = pp.pair_shifts(two, idx, RECENT, at(DAY, "23:30"), read_at=at(DAY, "23:30"))
check("a back-to-back pair with two entries is two paired shifts",
      [r["verdict"] for r in got["rows"]] == [pp.PAIRED, pp.PAIRED], verdicts(got["rows"]))
check("each paired shift names its own entry",
      [r["entry_id"] for r in got["rows"]] == ["E1", "E2"], got["rows"])
check("nothing paired is a fault", not any(r["fault"] for r in got["rows"]))
check("every verdict carries the read it stands on",
      all(r["read_at"] == at(DAY, "23:30").astimezone(OHIO).isoformat() for r in got["rows"]),
      [r["read_at"] for r in got["rows"]])

# ONE ENTRY COVERING BOTH: covered_by_another, for BOTH shifts.
idx = index_of([entry("Dana Reed", DAY, "7:00 AM", "11:00 PM", "E9")])
got = pp.pair_shifts(two, idx, RECENT, at(DAY, "23:30"), read_at=at(DAY, "23:30"))
check("one entry across two scheduled shifts is covered_by_another, for both",
      [r["verdict"] for r in got["rows"]] == [pp.COVERED, pp.COVERED], verdicts(got["rows"]))
check("covered_by_another names the other shift it collides with",
      all(r["covers"] and r["covers"][0] != r["id"] for r in got["rows"]),
      [r["covers"] for r in got["rows"]])
check("covered_by_another is a fault, and its sentence says what was owed",
      all(r["fault"] and "own" in r["why"] for r in got["rows"]),
      [r["why"] for r in got["rows"]])

# PPLV-05: A READ MADE BEFORE THE SECOND SHIFT BEGAN CANNOT SHOW THE PUNCH OUT
# AND BACK IN. An open entry from 06:55, a read at 14:50, a changeover at 15:00.
change = [shift("Dana Reed", "7A-3P", DAY, "07:00", "15:00"),
          shift("Dana Reed", "3P-11P", DAY, "15:00", "23:00")]
open_idx = index_of([entry("Dana Reed", DAY, "6:55 AM", None, "O7")])
for now_hm in ("15:05", "15:40"):
    got = pp.pair_shifts(change, open_idx, RECENT, at(DAY, now_hm), read_at=at(DAY, "14:50"))
    check(f"PPLV-05: at {now_hm}, on a read made at 14:50, one open entry is NOT one punch for two "
          "shifts — the running one is open, the next unreadable, nobody at fault",
          [r["verdict"] for r in got["rows"]] == [pp.OPEN, pp.UNREADABLE]
          and not any(r["fault"] for r in got["rows"]) and got["rows"][1]["entry_id"] == ""
          and "not read after this shift began" in got["rows"][1]["why"],
          [(r["verdict"], r["fault"], r["entry_id"], r["why"]) for r in got["rows"]])
got = pp.pair_shifts(change, open_idx, RECENT, at(DAY, "15:20"), read_at=at(DAY, "15:15"))
check("PPLV-05: a read made after the second shift began shows one punch across both — covered, "
      "and not yet a fault before that shift's no-call line",
      [r["verdict"] for r in got["rows"]] == [pp.COVERED, pp.COVERED]
      and not any(r["fault"] for r in got["rows"]),
      [(r["verdict"], r["fault"], r["why"]) for r in got["rows"]])
got = pp.pair_shifts(change, open_idx, RECENT, at(DAY, "16:10"), read_at=at(DAY, "16:05"))
check("PPLV-05: and a read past the second shift's no-call line that still shows one punch is the fault",
      [r["verdict"] for r in got["rows"]] == [pp.COVERED, pp.COVERED]
      and all(r["fault"] for r in got["rows"]),
      [(r["verdict"], r["fault"]) for r in got["rows"]])

# LENGTH IS NEVER THE ACCUSATION: a twelve-hour shift, twenty minutes long.
one = [shift("Kim Ash", "7a-7p", DAY, "07:00", "19:00")]
idx = index_of([entry("Kim Ash", DAY, "7:00 AM", "7:20 PM", "E3")])
got = pp.pair_shifts(one, idx, RECENT, at(DAY, "20:30"), read_at=at(DAY, "20:30"))
check("a 12-hour shift with 20 minutes of overrun is paired, not a fault",
      got["rows"][0]["verdict"] == pp.PAIRED and not got["rows"][0]["fault"], got["rows"][0])
long_one = [shift("Kim Ash", "7a-7p", DAY, "07:00", "19:00")]
idx = index_of([entry("Kim Ash", DAY, "7:00 AM", "11:00 PM", "E4")])
got = pp.pair_shifts(long_one, idx, RECENT, at(DAY, "23:30"), read_at=at(DAY, "23:30"))
check("a 16-hour entry against ONE scheduled shift is still only paired — "
      "hours alone accuse nobody",
      got["rows"][0]["verdict"] == pp.PAIRED, got["rows"][0])

# AN ENTRY WITH NO END_TIME.
idx = index_of([entry("Kim Ash", DAY, "7:00 AM", None, "E5")])
got = pp.pair_shifts(one, idx, RECENT, at(DAY, "12:00"), read_at=at(DAY, "12:00"))
check("an entry with no end_time is open", got["rows"][0]["verdict"] == pp.OPEN)
check("an open entry is NOT a fault while the shift is still running",
      not got["rows"][0]["fault"], got["rows"][0]["why"])
got = pp.pair_shifts(one, idx, RECENT, at(DAY, "21:00"), read_at=at(DAY, "21:00"))
check("an open entry IS a fault once the shift has been over for the grace",
      got["rows"][0]["verdict"] == pp.OPEN and got["rows"][0]["fault"], got["rows"][0])

# AN OVERNIGHT AND THE NEXT MORNING ARE TWO SHIFTS.
night = [shift("Dana Reed", "11p-7a", DAY, "23:00", "07:00"),
         shift("Dana Reed", "8a-4p", DAY + timedelta(days=1), "08:00", "16:00")]
idx = index_of([entry("Dana Reed", DAY, "11:00 PM", "11:59 PM", "N1"),
                entry("Dana Reed", DAY + timedelta(days=1), "12:00 AM", "7:00 AM", "N2"),
                entry("Dana Reed", DAY + timedelta(days=1), "8:00 AM", "4:00 PM", "N3")])
got = pp.pair_shifts(night, idx, RECENT, at(DAY + timedelta(days=1), "17:00"),
                     read_at=at(DAY + timedelta(days=1), "17:00"))
check("an overnight and the next morning are two shifts, each with its own pair",
      [r["verdict"] for r in got["rows"]] == [pp.PAIRED, pp.PAIRED], verdicts(got["rows"]))
check("the overnight's two halves are one punch, and the morning is not it",
      got["rows"][0]["entry_ids"] == ["N1", "N2"] and got["rows"][1]["entry_id"] == "N3",
      [r["entry_ids"] for r in got["rows"]])

# NO ENTRY AT ALL.
idx = index_of([])
got = pp.pair_shifts(one, idx, RECENT, at(DAY, "09:00"), read_at=at(DAY, "09:00"))
check("a shift with no entry of its own is missing, and a fault on a read past the no-call line",
      got["rows"][0]["verdict"] == pp.MISSING and got["rows"][0]["fault"], got["rows"][0])
got = pp.pair_shifts(one, idx, RECENT, at(DAY, "07:30"), read_at=at(DAY, "07:30"))
check("it is not a fault in the first hour — the punch may still be coming",
      got["rows"][0]["verdict"] == pp.MISSING and not got["rows"][0]["fault"],
      got["rows"][0]["why"])
got = pp.pair_shifts(one, idx, RECENT, at(DAY + timedelta(days=1), "09:00"),
                     read_at=at(DAY + timedelta(days=1), "09:00"))
check("and not a fault long after the end either — the entry may still be typed",
      not got["rows"][0]["fault"] and "still be typed" in got["rows"][0]["why"],
      got["rows"][0]["why"])

# PPL-04: THE FAULT IS JUDGED ON THE READ, AS THE BOARD JUDGES IT. A read made
# five minutes after the start is "no punch yet" however long ago it was made.
early_read = pp.pair_shifts(one, idx, RECENT, at(DAY, "10:00"), read_at=at(DAY, "07:05"))
check("a read five minutes after the start is no fault three hours later — the wall clock adds no evidence",
      early_read["rows"][0]["verdict"] == pp.MISSING and not early_read["rows"][0]["fault"]
      and "yet" in early_read["rows"][0]["why"], early_read["rows"][0])
board_row = pa.board(one, idx, RECENT, {}, [], at(DAY, "10:00"), at(DAY, "07:05"),
                     (DAY,))["rows"][0]
check("and the board, over the same read, says no_punch_yet — the two never disagree",
      board_row["verdict"] == "no_punch_yet", board_row)

# UNREADABLE, AND NOBODY AT FAULT.
got = pp.pair_shifts(one, idx, RECENT, at(DAY, "09:00"), read_at=None)
check("a day the clock was not read is unreadable, never missing",
      got["rows"][0]["verdict"] == pp.UNREADABLE and not got["rows"][0]["fault"],
      got["rows"][0])
got = pp.pair_shifts(one, idx, RECENT, at(DAY, "09:00"), read_at=at(DAY, "06:00"))
check("a read made BEFORE the shift began says nothing about it",
      got["rows"][0]["verdict"] == pp.UNREADABLE, got["rows"][0]["why"])
got = pp.pair_shifts(one, idx, RECENT, at(DAY, "09:00"), read_at=at(DAY, "09:00"),
                     schedule_read=False)
check("a schedule that could not be read is unreadable for every shift on it",
      got["rows"][0]["verdict"] == pp.UNREADABLE and not got["rows"][0]["fault"])
got = pp.pair_shifts(one, idx, set(), at(DAY, "09:00"), read_at=at(DAY, "09:00"))
check("somebody the clock has never spelled is unreadable, never accused",
      got["rows"][0]["verdict"] == pp.UNREADABLE and "spelled" in got["rows"][0]["why"],
      got["rows"][0]["why"])
got = pp.pair_shifts(one, idx, RECENT, at(DAY, "09:00"), read_at=at(DAY, "09:00"),
                     absence_from=DAY + timedelta(days=3))
check("a read that does not reach back far enough is unreadable",
      got["rows"][0]["verdict"] == pp.UNREADABLE, got["rows"][0]["why"])
check("no unreadable verdict is ever a fault",
      not any(r["fault"] for r in got["rows"] if r["verdict"] == pp.UNREADABLE))

fresh_row = pp.pair_shifts(one, idx, RECENT, at(DAY, "09:00"), read_at=at(DAY, "09:00"))["rows"][0]
check("a missing fault on a read made now is accusable",
      pp.accusable(fresh_row, at(DAY, "09:00")), fresh_row)
check("and the same verdict on a read older than the freshness line is not",
      not pp.accusable(fresh_row, at(DAY, "09:00") + timedelta(minutes=pp.FRESH_READ_MIN + 1)))


# ── 2. the quiet policy ─────────────────────────────────────────────────────

print("\n-- the quiet window --")

NIGHT = at(DAY, "22:00")
NOON = at(DAY, "12:00")

g = pp.quiet_gate(NIGHT)
check("at 22:00 everything on this lane is held", g["state"] == pp.SEND_HELD, g)
check("and it is held only until the window ends",
      g["at"].astimezone(OHIO).strftime("%H:%M") == "08:00", g["at"])
check("outside the window it goes now", pp.quiet_gate(NOON)["state"] == pp.SEND_NOW)
check("21:30 is still allowed and 21:31 is not",
      pp.quiet_gate(at(DAY, "21:30"))["state"] == pp.SEND_NOW
      and pp.quiet_gate(at(DAY, "21:31"))["state"] == pp.SEND_HELD)
check("07:00 inside an overnight is held too — no shift under way buys a way past the window",
      pp.quiet_gate(at(DAY + timedelta(days=1), "07:00"))["state"] == pp.SEND_HELD)
check("nothing on this lane claims an exemption: no word, no kind, no pierce",
      not hasattr(pp, "HAPPENING_NOW") and not hasattr(pp, "DIRECTOR_KINDS")
      and not hasattr(pp, "happening_now") and not hasattr(pr, "HAPPENING_NOW")
      and not hasattr(pr, "PIERCING_KINDS"))


# ── 3. one message per shift — never one about both ────────────────────────

print("\n-- one message per shift --")

# A DOUBLE WITH NEITHER SHIFT PUNCHED OUT, both entries left open past their end.
double = [shift("Dana Reed", "7a-3p", DAY, "07:00", "15:00"),
          shift("Dana Reed", "4p-11p", DAY, "16:00", "23:00")]
idx = index_of([entry("Dana Reed", DAY, "7:00 AM", None, "D1"),
                entry("Dana Reed", DAY, "4:00 PM", None, "D2")])
got = pp.pair_shifts(double, idx, RECENT, at(DAY + timedelta(days=1), "01:00"),
                     read_at=at(DAY + timedelta(days=1), "01:00"))
check("both shifts of the double are open and both are faults",
      [r["verdict"] for r in got["rows"]] == [pp.OPEN, pp.OPEN]
      and all(r["fault"] for r in got["rows"]), verdicts(got["rows"]))
planned = pp.plan(got["rows"], now=at(DAY + timedelta(days=1), "10:00"), said={})
rows = planned["due"]
check("a double owes TWO rows, one per shift — never one about both",
      len(rows) == 2 and len({r["id"] for r in rows}) == 2, [r["id"] for r in rows])
check("each row carries the facts of its own shift and nothing else",
      rows[0]["shift_at"] != rows[1]["shift_at"]
      and rows[0]["punched_in"] == "07:00" and rows[1]["punched_in"] == "16:00", rows)
check("PPL-09: the rows carry facts only — the sentences are the situation's, never the relay's",
      not any("reply" in r for r in rows)
      and not any(hasattr(pp, f) for f in ("warning_words", "changeover_words",
                                           "open_entry_words", "claim_note")))
check("no row carries a list of shifts, so nothing can be folded into a digest",
      not any(isinstance(r.get("shifts"), list) for r in rows))
check("a row already said is not said again",
      not pp.plan(got["rows"], now=at(DAY + timedelta(days=1), "10:00"),
                  said={r["id"]: {"state": "told", "at": at(DAY + timedelta(days=1),
                                                            "09:00").isoformat()}
                        for r in rows})["due"])

# THE CHANGEOVER, said while the first shift is still running.
meet = [shift("Kim Ash", "7a-3p", DAY, "07:00", "15:00"),
        shift("Kim Ash", "3p-11p", DAY, "15:00", "23:00")]
idx = index_of([entry("Kim Ash", DAY, "7:00 AM", None, "C1")])
now = at(DAY, "14:55")
got = pp.pair_shifts(meet, idx, RECENT, now, read_at=now)
planned = pp.plan(got["rows"], now=now, said={})
kinds = [r["kind"] for r in planned["due"]]
check("minutes before the next shift begins, the entry they are on the clock with is the running "
      "shift's alone — never one punch covering two before they could punch out and in",
      [r["verdict"] for r in got["rows"]] == [pp.OPEN, pp.UNREADABLE]
      and not any(r["fault"] for r in got["rows"]) and got["rows"][1]["entry_id"] == "",
      [(r["verdict"], r["fault"], r["entry_id"]) for r in got["rows"]])
check("five minutes before the changeover the person is reminded, once",
      kinds == [pp.K_CHANGEOVER], [(r["verdict"], r["fault"], r["entry_id"], r["why"]) for r in got["rows"]])
check("the changeover row names both shifts as facts",
      planned["due"][0]["shift_code"] == "7a-3p"
      and planned["due"][0]["next_shift"] == "3p-11p"
      and planned["due"][0]["next_at"] == at(DAY, "15:00").astimezone(OHIO).isoformat(),
      planned["due"][0])
check("and it claims no way past the quiet window",
      "quiet_exempt" not in planned["due"][0])
check("at 21:55 the same changeover would be held, like every other message",
      pp.quiet_gate(at(DAY, "21:55"))["state"] == pp.SEND_HELD)
apart = [shift("Kim Ash", "7a-3p", DAY, "07:00", "15:00"),
         shift("Kim Ash", "8p-11p", DAY, "20:00", "23:00")]
got = pp.pair_shifts(apart, idx, RECENT, now, read_at=now)
check("two shifts five hours apart do not meet, so no changeover is said",
      not [r for r in pp.plan(got["rows"], now=now, said={})["due"]
           if r["kind"] == pp.K_CHANGEOVER])

# PPL-12: THE CHANGEOVER ASKS THE VERDICTS FIRST.
meet_rows = pp.pair_shifts(meet, idx, RECENT, now, read_at=now)["rows"]
told_next = [meet_rows[0], dict(meet_rows[1], told_kind="call_off")]
check("no changeover into a next shift a call-off book accounts for",
      not [r for r in pp.plan(told_next, now=now, said={})["due"] if r["kind"] == pp.K_CHANGEOVER])
told_now = [dict(meet_rows[0], verdict=pp.TOLD, told_kind="call_off"), meet_rows[1]]
check("nor out of a shift a human already wrote down",
      not [r for r in pp.plan(told_now, now=now, said={})["due"] if r["kind"] == pp.K_CHANGEOVER])
doubled_now = [dict(meet_rows[0], doubles=["x"]), meet_rows[1]]
check("nor for a person the roster holds on two grids at once",
      not [r for r in pp.plan(doubled_now, now=now, said={})["due"]
           if r["kind"] == pp.K_CHANGEOVER])
not_on = pp.pair_shifts(meet, index_of([]), RECENT, now, read_at=now)["rows"]
check("nor to somebody who is not on the clock for the shift ending — there is nothing to punch out of",
      not [r for r in pp.plan(not_on, now=now, said={})["due"] if r["kind"] == pp.K_CHANGEOVER],
      [r["verdict"] for r in not_on])

# THE OPEN ENTRY, held at night and said in the morning.
open_row = [r for r in pp.pair_shifts(
    one, index_of([entry("Kim Ash", DAY, "7:00 AM", None, "O1")]), RECENT,
    at(DAY, "22:00"), read_at=at(DAY, "22:00"))["rows"]]
planned = pp.plan(open_row, now=at(DAY, "22:00"), said={})
check("an entry left open on a shift that is over is HELD at 22:00",
      not planned["due"] and [r["kind"] for r in planned["held"]] == [pp.K_OPEN_ENTRY],
      planned)
planned = pp.plan(open_row, now=at(DAY + timedelta(days=1), "08:00"), said={})
check("and said at 08:00, if it is still open",
      [r["kind"] for r in planned["due"]] == [pp.K_OPEN_ENTRY])
check("the open-entry row carries the shift and its clock-in",
      planned["due"][0]["punched_in"] == "07:00" and planned["due"][0]["shift_code"] == "7a-7p",
      planned["due"][0])


# ── 4. no claim sentence on the reply ear's confirmations ─────────────────

print("\n-- the reply ear's confirmations --")

import sms_ears  # noqa: E402

check("PPL-11: an application by text is told only that the house manager decides — never that it holds a shift",
      sms_ears.applied_words(False) == "The house manager decides who takes it."
      and "_pair_note" not in _SOURCES["sms_ears"] and "claim_note" not in _SOURCES["sms_ears"])


# ── 5. rung one, and when it has run out ────────────────────────────────────

print("\n-- the chase, and its exhaustion --")

row = {"id": "dana|x", "shift_at": at(DAY, "07:00").isoformat(),
       "shift_end": at(DAY, "15:00").isoformat()}
over_now, why = pp.chase_over(row, at(DAY, "09:00"), delivered=0, stopped={})
check("while nothing has reached the person the shift is NOT separated", not over_now)
over_now, why = pp.chase_over(row, at(DAY, "09:00"), delivered=pp.CHASE_TELLS, stopped={})
check("once the reminders that REACHED them are all said, it has run out", over_now, why)
over_now, why = pp.chase_over(row, at(DAY, "14:00"), delivered=1, stopped={})
check("one delivered reminder and a long wait is not a run-out chase — no clock is invented here",
      not over_now, why)
over_now, why = pp.chase_over(row, at(DAY, "09:00"), delivered=0,
                              stopped={"dana|x": {"why": "no_contact"}})
check("a person there is no way to text at all has no rung one left to run", over_now, why)
check("the reason is always in words, never a bare number",
      all(any(c.isalpha() for c in w) for w in (why,)))
over_now, why = pp.chase_over(row, at(DAY, "09:00"), delivered=0,
                              stopped={"dana|x": {"why": "no_contact", "code": "no_person"}})
check("PPL-16: a name the People house does not spell is a lookup miss, not \"no way to ask\" — it never climbs",
      not over_now, why)
over_now, why = pp.chase_over(row, at(DAY, "23:00"), delivered=0,
                              stopped={"dana|x": {"why": "dial_off"}})
check("a cadence the sending dial silenced has not run out — that is the platform, not them",
      not over_now, why)
over_now, why = pp.chase_over(row, at(DAY, "23:00"), delivered=0,
                              stopped={"dana|x": {"why": "held"}})
check("nor one the door held", not over_now, why)
over_now, why = pp.chase_over(row, at(DAY, "10:00"), delivered=1,
                              stopped={"dana|x": {"why": "answered_no"}})
check("nor one they said no to — the house manager is told that in the same breath",
      not over_now, why)
over_now, why = pp.chase_over(row, at(DAY, "09:00"), delivered=0, stopped={"dana|x"})
check("a bare set of stopped shifts still reads, and says nothing about the reason",
      not over_now, why)

# PPL-10: A REPLY IS NEVER A WAY OUT OF RUNG TWO.
replied = {"dana|x": {"why": "replied", "at": at(DAY, "08:30").isoformat()}}
over_now, why = pp.chase_over(row, at(DAY, "08:40"), delivered=1, stopped=replied)
check("a reply to a reminder that reached them holds the chase for the grace",
      not over_now, why)
over_now, why = pp.chase_over(row, at(DAY, "08:30") + timedelta(minutes=pp.REPLY_GRACE_MIN),
                              delivered=1, stopped=replied)
check("and when the grace has passed with still no punch, it climbs — 'omw' is not a punch",
      over_now and "replied" in why, why)
over_now, why = pp.chase_over(row, at(DAY, "11:00"), delivered=0, reached=1, stopped=replied)
check("a reply after the reminder BEFORE the shift reached them counts as asked too",
      over_now, why)
over_now, why = pp.chase_over(row, at(DAY, "11:00"), delivered=0, reached=0, stopped=replied)
check("but a 'reply' when nothing ever reached them is not an answer to being asked",
      not over_now, why)


# ── 6. the warning: spacing, and NO CAP ────────────────────────────────────

print("\n-- the warning to the directors --")

warn = {"state": pp.WARNED, "tells": 0, "told_at": None}
check("a warning nobody has told yet is told now", pp.warning_due(warn, NOON) == "tell")
warn = {"state": pp.WARNED, "tells": 1, "attempts": 1, "told_at": NOON}
check("and not again inside the spacing",
      pp.warning_due(warn, NOON + timedelta(minutes=pp.WARN_EVERY_MIN - 1)) == "wait")
check("but again once the spacing has passed",
      pp.warning_due(warn, NOON + timedelta(minutes=pp.WARN_EVERY_MIN)) == "tell")
# C13 / PPLV-12: REPEATED UNTIL A DIRECTOR ANSWERS RECEIVED — NO GIVE-UP COUNT.
check("C13: there is no telling cap and no attempts cap left to reach",
      not hasattr(pp, "WARN_TELLS") and not hasattr(pp, "WARN_ATTEMPTS") and not hasattr(pp, "gave_up_words"))
for n in (5, 6, 7, 12, 40):
    told_n = {"state": pp.WARNED, "tells": n, "attempts": n, "told_at": NOON}
    check(f"C13: after {n} tellings it waits out the spacing, then is told again — never given up",
          pp.warning_due(told_n, NOON + timedelta(minutes=1)) == "wait"
          and pp.warning_due(told_n, NOON + timedelta(minutes=pp.WARN_EVERY_MIN)) == "tell"
          and pp.warning_due(told_n, NOON + timedelta(hours=9)) == "tell")
idle = {"state": pp.WARNED, "tells": 0, "attempts": 60, "told_at": NOON}
check("C13: nor does a door that has said nothing sixty rounds running stop it — it is asked again",
      pp.warning_due(idle, NOON + timedelta(minutes=pp.WARN_EVERY_MIN)) == "tell")
warn = {"state": pp.RECEIVED, "tells": 1, "told_at": NOON}
check("a warning a director has answered is never told again",
      pp.warning_due(warn, NOON + timedelta(hours=9)) == "wait")

# THE ROW STATES THE REAL SPAN, read off its own first and latest telling.
spanned = {"tells": 6, "first_said_at": at(DAY, "09:00"), "last_said_at": at(DAY, "10:41")}
check("PPLV-12: six tellings from 09:00 to 10:41 are said to span 101 minutes — never six times the spacing",
      pp.told_span(spanned) == "it was said 6 time(s) over 101 minutes, from 09:00 to 10:41"
      and "120" not in pp.told_span(spanned), pp.told_span(spanned))
check("one telling is said once, at its own time",
      pp.told_span({"tells": 1, "first_said_at": at(DAY, "09:00"), "last_said_at": at(DAY, "09:00")})
      == "it was said once, at 09:00")
check("a warning never said says so, and never a count of zero minutes",
      pp.told_span({"tells": 0}) == "it was never said to a director")
ended = pp.ended_words(dict(spanned, said={"last": {"answers": [{"who": "calsample", "state": "told"}]}}))
check("the words at the shift's end carry that span",
      "the shift ended" in ended and "over 101 minutes, from 09:00 to 10:41" in ended
      and "nothing is opened" in ended, ended)
unheard_row = {"tells": 0, "said": {"last": {"answers": [
    {"who": "calsample", "state": "held", "why": "the situation shift_punch_warning is off or absent"}]}}}
check("and a warning nobody could be told says why the last try reached nobody",
      "is off or absent" in pp.unheard_words(unheard_row)
      and "never said to a director" in pp.ended_words(unheard_row)
      and "reached nobody" in pp.ended_words(unheard_row), pp.ended_words(unheard_row))
check("a latest round that said something leaves nothing unheard",
      pp.unheard_words({"said": json.dumps({"last": {"answers": [{"who": "a", "state": "told"}]}})}) == "")


class _Cur:
    """A cursor that records what it was asked and answers `rows` to a SELECT —
    or, given `routes`, the rows of the first route whose words the SELECT holds."""

    def __init__(self, rows=None, routes=None):
        self.sql = []
        self.rows = list(rows or [])
        self.routes = list(routes or [])
        self._got = []
        self.rowcount = 1

    def execute(self, sql, args=()):
        flat = " ".join(str(sql).split())
        self.sql.append((flat, args))
        if "select" not in flat.lower():
            self._got = []
            return
        if self.routes:
            self._got = next((list(r) for k, r in self.routes if k in flat), [])
        else:
            self._got = list(self.rows)

    def fetchall(self):
        return list(self._got)

    def fetchone(self):
        return self._got[0] if self._got else None

    def updates(self):
        return [(s, a) for s, a in self.sql if s.lower().startswith("update asa_punch_warnings")]

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Conn:
    def __init__(self, cur):
        self._cur = cur

    def cursor(self, **_k):
        return self._cur

    def commit(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _inserts(cur):
    return [(s, a) for s, a in cur.sql if s.lower().startswith("insert into asa_punch_warnings")]


class _Swap:
    """Stands a module attribute in for the length of a block, and puts it back."""

    def __init__(self, obj, **attrs):
        self.obj, self.attrs, self.held = obj, attrs, {}

    def __enter__(self):
        for k, v in self.attrs.items():
            self.held[k] = getattr(self.obj, k)
            setattr(self.obj, k, v)
        return self

    def __exit__(self, *a):
        for k, v in self.held.items():
            setattr(self.obj, k, v)
        return False


def _opened(paired, now, *, stopped=None, delivered=0, reached=None, live=()):
    cur = _Cur(list(live))
    with _Swap(pp, _connect=lambda _dsn: _Conn(cur),
               delivered_count=lambda sid, kinds=("login_missing",):
               (reached if reached is not None and tuple(kinds) != ("login_missing",)
                else delivered)):
        counts = pp.open_warnings("dsn", paired, now=now, stopped=stopped if stopped is not None else {})
    return counts, cur


miss = [shift("Dana Reed", "7a-3p", DAY, "07:00", "15:00")]
missed = pp.pair_shifts(miss, index_of([]), RECENT, at(DAY, "09:00"),
                        read_at=at(DAY, "09:00"))["rows"]
counts, cur = _opened(missed, at(DAY, "09:00"))
check("a missing shift whose chase is still running opens NO warning",
      counts["opened"] == 0 and not _inserts(cur), cur.sql)
counts, cur = _opened(missed, at(DAY, "09:00"), stopped={missed[0]["id"]: {"why": "no_contact"}})
check("a missing shift whose chase has run out IS separated as a warning",
      counts["opened"] == 1 and len(_inserts(cur)) == 1, cur.sql)
check("the warning row carries its own ref, its shift and the reason in words",
      _inserts(cur)[0][1][1] == missed[0]["ref"]
      and any("no way to ask" in str(v) for v in _inserts(cur)[0][1]), _inserts(cur))
counts, cur = _opened(missed, at(DAY, "09:00"), delivered=pp.CHASE_TELLS)
check("PPL-06: three reminders that REACHED the person open it",
      counts["opened"] == 1, cur.sql)
counts, cur = _opened(missed, at(DAY, "09:00"), delivered=pp.CHASE_TELLS - 1)
check("and fewer do not — a rehearsed or recorded reminder is never counted as asked",
      counts["opened"] == 0, cur.sql)

# PPL-04: ONLY ON A FRESH READ.
counts, cur = _opened(missed, at(DAY, "09:00") + timedelta(minutes=pp.FRESH_READ_MIN + 1),
                      stopped={missed[0]["id"]: {"why": "no_contact"}})
check("PPL-04: a verdict on a read older than the freshness line opens no warning",
      counts["opened"] == 0, cur.sql)

# PPL-07: NEVER AFTER THE SHIFT.
late_rows = pp.pair_shifts(miss, index_of([]), RECENT, at(DAY, "15:10"),
                           read_at=at(DAY, "15:10"))["rows"]
counts, cur = _opened(late_rows, at(DAY, "15:10"), stopped={late_rows[0]["id"]: {"why": "no_contact"}})
check("PPL-07: a shift that has ended is never warned about — its answer could open nothing",
      late_rows[0]["fault"] and counts["opened"] == 0, (late_rows[0], cur.sql))

# PPL-03: ONE BODY IS ONE PERSON.
alice_bob = [shift("Dana Reed", "7a-3p", DAY, "07:00", "15:00", house="JH"),
             shift("Bob Lane", "7a-3p", DAY, "07:00", "15:00", house="AB")]
ab_rows = pp.pair_shifts(alice_bob, index_of([]), RECENT, at(DAY, "09:00"),
                         read_at=at(DAY, "09:00"))["rows"]
counts, cur = _opened(ab_rows, at(DAY, "09:00"),
                      stopped={r["id"]: {"why": "no_contact"} for r in ab_rows})
check("PPL-03: two different people with no punch at the same hours raise TWO warnings",
      counts["opened"] == 2 and len(_inserts(cur)) == 2, cur.sql)
dana_live = [{"id": ab_rows[0]["id"], "state": pp.WARNED, "call_off_ref": "",
              "person_key": ab_rows[0]["person_key"], "shift_at": ab_rows[0]["shift_at"],
              "shift_end": ab_rows[0]["shift_end"]}]
counts, cur = _opened(ab_rows, at(DAY, "09:00"),
                      stopped={r["id"]: {"why": "no_contact"} for r in ab_rows}, live=dana_live)
check("and one person's live warning never silences another's at the same hours",
      counts["opened"] == 1 and _inserts(cur)[0][1][0] == ab_rows[1]["id"], cur.sql)

paired_now = pp.pair_shifts(miss, index_of([entry("Dana Reed", DAY, "7:00 AM", "3:00 PM", "L1")]),
                            RECENT, at(DAY, "16:00"), read_at=at(DAY, "16:00"))["rows"]
counts, cur = _opened(paired_now, at(DAY, "16:00"),
                      live=[{"id": missed[0]["id"], "state": pp.WARNED, "call_off_ref": ""}])
check("and it CLOSES the moment the pair arrives — the chase worked, nobody is at fault",
      counts["closed"] == 1
      and any(pp.CLOSED in str(a) for s, a in cur.sql if "update" in s.lower()), cur.sql)

# A LATE CLOCK-IN IS A CLOCK-IN.
late_in = pp.pair_shifts(miss, index_of([entry("Dana Reed", DAY, "9:40 AM", None, "L2")]),
                         RECENT, at(DAY, "10:30"), read_at=at(DAY, "10:30"))["rows"]
check("a late clock-in reads open, not missing", late_in[0]["verdict"] == pp.OPEN, late_in[0])
counts, cur = _opened(late_in, at(DAY, "10:30"),
                      live=[{"id": missed[0]["id"], "state": pp.WARNED, "call_off_ref": ""}])
check("a warning CLOSES when the person clocks in late — punching in late is punching",
      counts["closed"] == 1
      and any("clocked in" in str(a) for s, a in cur.sql if "update" in s.lower()), cur.sql)

# A SHIFT A HUMAN ALREADY WROTE DOWN NEVER CLIMBS.
books = {pa.flat_key("Dana Reed"): [{"day": DAY, "spread": 0, "source": "tracker",
                                     "kind": "call_off", "at": DAY.isoformat()}]}
told_rows = pp.pair_shifts(miss, index_of([]), RECENT, at(DAY, "09:00"),
                           read_at=at(DAY, "09:00"), offs=books, loose=[])["rows"]
check("a shift a human called off is told_by_a_human, and never a fault",
      told_rows[0]["verdict"] == pp.TOLD and not told_rows[0]["fault"], told_rows[0])
counts, cur = _opened(told_rows, at(DAY, "09:00"), stopped={missed[0]["id"]: {"why": "no_contact"}})
check("a called-off shift raises NO warning, whatever the chase did", counts["opened"] == 0, cur.sql)
counts, cur = _opened(told_rows, at(DAY, "09:00"),
                      live=[{"id": told_rows[0]["id"], "state": pp.WARNED, "call_off_ref": ""}])
check("and a warning opened before the book was read closes on it", counts["closed"] == 1, cur.sql)

# ONE BODY, ONE WARNING.
both = [shift("Dana Reed", "2-10P", DAY, "14:00", "22:00", house="MS"),
        shift("Dana Reed", "230P-10P", DAY, "14:30", "22:00", house="AB")]
doubled = pp.pair_shifts(both, index_of([]), RECENT, at(DAY, "16:00"),
                         read_at=at(DAY, "16:00"))["rows"]
check("a person on two grids at once: one shift carries the judgment, the other stands down",
      sorted(r["verdict"] for r in doubled) == sorted([pp.DOUBLE, pp.MISSING]), verdicts(doubled))
check("and the one that stood down is not a fault — the cell is what needs fixing",
      not any(r["fault"] for r in doubled if r["verdict"] == pp.DOUBLE)
      and all(r["doubles"] for r in doubled), doubled)
counts, cur = _opened(doubled, at(DAY, "16:00"),
                      stopped={r["id"]: {"why": "no_contact"} for r in doubled})
check("so ONE warning is opened for one body, never two",
      counts["opened"] == 1 and len(_inserts(cur)) == 1, cur.sql)

for verdict_rows, label in ((pp.pair_shifts(miss, index_of([]), RECENT, at(DAY, "09:00"),
                                            read_at=None)["rows"], "unreadable"),
                            (paired_now, "paired")):
    counts, cur = _opened(verdict_rows, at(DAY, "16:00"),
                          stopped={missed[0]["id"]: {"why": "no_contact"}})
    check(f"a {label} shift is never warned about, whatever the chase did",
          counts["opened"] == 0, cur.sql)

# AN UNREADABLE LEDGER OPENS NOTHING, AND STILL CLOSES WHAT STOOD DOWN.
cur = _Cur([{"id": missed[0]["id"], "state": pp.WARNED, "call_off_ref": ""}])


def _ledger_down():
    raise pp.Unreadable("the reminders' ledger could not be read")


with _Swap(pp, _connect=lambda _dsn: _Conn(cur), _stopped=_ledger_down):
    counts = pp.open_warnings("dsn", missed + paired_now, now=at(DAY, "09:00"))
check("an unreadable ledger opens no warning — it is not a list of shifts nobody stopped",
      counts["opened"] == 0 and not _inserts(cur), cur.sql)

# PPL-07: THE END OF A SHIFT ENDS ITS WARNING — the one stop that is not an answer or a punch.
cur = _Cur([{"id": "dana|x", "shift_end": at(DAY, "15:00"), "tells": 7,
             "first_said_at": at(DAY, "09:00"), "last_said_at": at(DAY, "11:00"), "said": {}},
            {"id": "kim|y", "shift_end": at(DAY, "23:00"), "tells": 2,
             "first_said_at": at(DAY, "14:00"), "last_said_at": at(DAY, "14:20"), "said": {}}])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
    n_ended = pp.expire_warnings("dsn", now=at(DAY, "15:00"))
ends = cur.updates()
check("PPL-07: every warning whose shift has ended stops as gave_up, read by its end",
      any("shift_end <=" in s for s, _a in cur.sql) and n_ended == 1 and len(ends) == 1
      and ends[0][1][0] == pp.GAVE_UP and ends[0][1][2] == "dana|x" and ends[0][1][3] == pp.WARNED, ends)
check("PPLV-12: and its row states the real span it was said over — seven tellings over 120 minutes, "
      "from 09:00 to 11:00",
      ends and "ended" in ends[0][1][1] and "said 7 time(s) over 120 minutes, from 09:00 to 11:00" in ends[0][1][1],
      ends)
check("a warning whose shift is still under way is not touched", not any("kim|y" in a for _s, a in ends), ends)


# ── 7. who is told, and what the rows carry ────────────────────────────────

print("\n-- each director, on their own phone --")

view = pp._warning_view({"id": "dana|x", "ref": "PW0123456789", "person": "Dana Reed",
                         "house": "JH", "house_name": "JH home", "shift_code": "7a-3p",
                         "day": DAY.isoformat(), "shift_at": at(DAY, "07:00"),
                         "shift_end": at(DAY, "15:00")})
WARN = {"id": "dana|x", "ref": "PW0123456789", "person": "Dana Reed", "person_key": "danareed",
        "house": "JH", "house_name": "JH home", "shift_code": "7a-3p", "day": DAY.isoformat(),
        "shift_at": at(DAY, "07:00"), "shift_end": at(DAY, "15:00"), "state": pp.WARNED,
        "tells": 1, "attempts": 1, "delivered": 1, "told_at": None, "phones": [],
        "said": {}, "received_by": "", "call_off_ref": ""}
batch = pp.warning_door_rows(WARN, ["Cal Sample", "Ann Q. Example", "Dana Reed"])
check("PPL-08: one row per director on the settings list, each addressed BY NAME",
      [r["person"] for r in batch] == ["Cal Sample", "Ann Q. Example"], batch)
check("nobody is warned about their own shift",
      not any(r["person"] == "Dana Reed" for r in batch))
check("not even under a middle initial the roster leaves out",
      [r["person"] for r in pp.warning_door_rows(dict(WARN, person="Ann Example"),
                                                  ["Ann Q. Example", "Cal Sample"])] == ["Cal Sample"])
check("each row has an id of its own — the telling and the director are in it",
      len({r["id"] for r in batch}) == 2
      and {pp.telling_of_key(r["id"]) for r in batch} == {(1, "calsample"), (1, "annqexample")}
      and all(pp.shift_of_key(r["id"]) == (pp.K_WARNING, "dana|x") for r in batch),
      [r["id"] for r in batch])
check("the rows carry the facts the situation's words need — whom it is about, the shift, the ref, the "
      "telling's number and no \"of N\" it would never keep",
      all(r["staff"] == "Dana Reed" and r["ref"] == "PW0123456789" and r["tells"] == "2"
          and r["shift_code"] == "7a-3p" and r["house_name"] == "JH home" and r["mail"] is False
          and "reply" not in r for r in batch), batch)
check("the directors keyword and its shared line are nowhere in the rows",
      not any(r.get("to") == "directors" for r in batch))
check("a reference is derived from the shift, the same way every time",
      pp.ref_of("dana|x") == pp.ref_of("dana|x") and pp.REF_RE.match(pp.ref_of("dana|x")),
      pp.ref_of("dana|x"))

seen_ids = []
for n in range(15):
    for w in pp.warning_door_rows(dict(WARN, tells=n), ["Cal Sample"]):
        seen_ids.append(w["id"])
check("every telling of one warning carries an id of its own — the seventh and the fifteenth as much "
      "as the first — so the send door's receipt cannot swallow any of them",
      len(set(seen_ids)) == 15, seen_ids)
check("C13: the fifteenth telling is numbered 15, and still carries the ref a director answers",
      [(r["tells"], r["ref"]) for r in pp.warning_door_rows(dict(WARN, tells=14), ["Cal Sample"])]
      == [("15", "PW0123456789")])
check("a staff row's id is unchanged, so what was already said stays said",
      pp.row_key(pp.K_OPEN_ENTRY, "dana|x") == f"{pp.K_OPEN_ENTRY}|dana|x")


# ── 8. owed(): the quiet window, the fresh read, the stale pairing ─────────

print("\n-- what is owed now --")

MORNING = at(DAY, "09:00")
fresh_pairs = pp.pair_shifts(miss, index_of([]), RECENT, MORNING, read_at=MORNING)["rows"]
LIVE = dict(WARN, id=fresh_pairs[0]["id"], ref=fresh_pairs[0]["ref"], tells=0, attempts=0,
            opened_at=MORNING)


def _owed(now, paired, every, *, names=("Cal Sample", "Ann Q. Example")):
    cur = _Cur(routes=[("AND opened_at >=", every), ("FROM asa_punch_said", []),
                       ("SELECT id, state, call_off_ref", [])])
    with _Swap(pp, _connect=lambda _dsn: _Conn(cur), directors=lambda _dsn: list(names)):
        got = pp.owed("dsn", now=now, paired=paired)
    return got, cur


got, cur = _owed(MORNING, fresh_pairs, [LIVE])
warned = [r for r in got if r["kind"] == pp.K_WARNING]
check("a warning due is told to every director, on a fresh read that still shows no punch",
      sorted(r["person"] for r in warned) == ["Ann Q. Example", "Cal Sample"], got)
stale_pairs = pp.pair_shifts(miss, index_of([]), RECENT, MORNING - timedelta(minutes=30),
                             read_at=MORNING - timedelta(minutes=30))["rows"]
got, cur = _owed(MORNING, stale_pairs, [LIVE])
check("PPL-04: a warning is NOT told on a read older than the freshness line — it waits, unstamped",
      not [r for r in got if r["kind"] == pp.K_WARNING]
      and not [u for u in cur.updates() if "told_at" in u[0] or LIVE["id"] in u[1]],
      (got, cur.updates()))
night_miss = [shift("Dana Reed", "8p-1130p", DAY, "20:00", "23:30")]
night_pairs = pp.pair_shifts(night_miss, index_of([]), RECENT, NIGHT, read_at=NIGHT)["rows"]
night_live = dict(LIVE, id=night_pairs[0]["id"], ref=night_pairs[0]["ref"],
                  shift_at=at(DAY, "20:00"), shift_end=at(DAY, "23:30"))
got, cur = _owed(NIGHT, night_pairs, [night_live])
check("PPL-01: at 22:00 the directors' warning is HELD like everything else — nothing is offered",
      night_pairs[0]["fault"] and not got, got)
got, cur = _owed(MORNING, fresh_pairs, [dict(LIVE, tells=0, attempts=60)])
check("C13: a warning the door kept answering without saying anything is still told — no attempts cap",
      sorted(r["person"] for r in got if r["kind"] == pp.K_WARNING) == ["Ann Q. Example", "Cal Sample"], got)
check("and nothing is written as gave_up", not any(pp.GAVE_UP in a for s, a in cur.updates()), cur.updates())
got, cur = _owed(MORNING, fresh_pairs, [dict(LIVE, tells=6, attempts=6, delivered=6,
                                             told_at=MORNING - timedelta(minutes=pp.WARN_EVERY_MIN))])
told7 = [r for r in got if r["kind"] == pp.K_WARNING]
check("C13: a warning told six times is told a seventh time — numbered 7, with its ref, to every director",
      sorted(r["person"] for r in told7) == ["Ann Q. Example", "Cal Sample"]
      and all(r["tells"] == "7" and r["ref"] == LIVE["ref"] for r in told7)
      and not any(pp.GAVE_UP in a for s, a in cur.updates()), (got, cur.updates()))
got, cur = _owed(MORNING, fresh_pairs, [dict(LIVE, tells=6, attempts=6, delivered=6,
                                             told_at=MORNING - timedelta(minutes=1))])
check("PPLV-12: a minute after the sixth telling nothing is given up — the warning waits out the spacing "
      "and stays open to a RECEIVED",
      not [r for r in got if r["kind"] == pp.K_WARNING] and not cur.updates(), (got, cur.updates()))
got, cur = _owed(MORNING, fresh_pairs, [LIVE], names=())
check("no director on the list (or an unreadable one) tells nobody — never the shared line",
      not [r for r in got if r["kind"] == pp.K_WARNING], got)
check("every ended warning is stopped first, on every beat",
      any("shift_end <=" in s for s, _a in cur.sql), cur.sql[:3])


# V1-PPL-05 / V2-4: A LIST THAT COULD NOT BE READ FAILS CLOSED — AND THE CARD SAYS SO.
def _blank_list(_dsn):
    raise pp.Unreadable("the directors list on the Time Off settings is blank, so nobody is warned and nobody "
                        "may answer")


pp.forget()
cur = _Cur(routes=[("AND opened_at >=", [LIVE]), ("FROM asa_punch_said", []), ("SELECT id, state, call_off_ref", [])])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), directors=_blank_list):
    got = pp.owed("dsn", now=MORNING, paired=fresh_pairs)
card_w = {w["id"]: w for w in pp.board_status(MORNING)["warnings"]}.get(LIVE["id"], {})
check("V1-PPL-05: a blank directors list tells nobody, stamps nothing — and the card says the list is why, "
      "never \"not told yet, it goes at the next beat\"",
      not [r for r in got if r["kind"] in pp.WARNING_KINDS] and not cur.updates()
      and "directors list on the Time Off settings is blank" in card_w.get("waits", "")
      and "nobody is told until it can be" in card_w.get("waits", ""), (got, card_w))
pp.forget()
cur = _Cur(routes=[("AND opened_at >=", [LIVE]), ("FROM asa_punch_said", []), ("SELECT id, state, call_off_ref", [])])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), directors=lambda _dsn: ["Cal Sample"]):
    pp.owed("dsn", now=MORNING, paired=stale_pairs)
card_w = {w["id"]: w for w in pp.board_status(MORNING)["warnings"]}.get(LIVE["id"], {})
check("and a read too old to back the telling says that, and that the read is asked for",
      "has not been read in the last" in card_w.get("waits", "") and "asked for now" in card_w.get("waits", ""),
      card_w)
pp.forget()
cur = _Cur(routes=[("AND opened_at >=", [LIVE]), ("FROM asa_punch_said", []), ("SELECT id, state, call_off_ref", [])])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), directors=lambda _dsn: ["Cal Sample"]):
    got = pp.owed("dsn", now=MORNING, paired=fresh_pairs)
card_w = {w["id"]: w for w in pp.board_status(MORNING)["warnings"]}.get(LIVE["id"], {})
check("and a telling that went out leaves nothing waiting on the card",
      [r["kind"] for r in got] == [pp.K_WARNING] and card_w.get("waits") == "", (got, card_w))
pp.forget()

# V1-PPL-04 / V2-2: A SHIFT THAT SHARES ITS CALENDAR CELL IS WARNED IN WORDS THAT PROMISE NO OPEN SHIFT.
split_day = [shift("Dana Reed", "7a-11a", DAY, "07:00", "11:00"), shift("Dana Reed", "3p-7p", DAY, "15:00", "19:00")]
split_pairs = pp.pair_shifts(split_day, index_of([]), RECENT, MORNING, read_at=MORNING)["rows"]
SPLIT_LIVE = dict(LIVE, id=split_pairs[0]["id"], ref=split_pairs[0]["ref"], person_key=split_pairs[0]["person_key"],
                  house="JH", day=DAY.isoformat(), shift_code="7a-11a", shift_end=at(DAY, "11:00"))
cur = _Cur(routes=[("AND opened_at >=", [SPLIT_LIVE]), ("FROM asa_punch_said", []),
                   ("SELECT id, state, call_off_ref", [])])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), directors=lambda _dsn: ["Cal Sample", "Ann Q. Example"]):
    got = pp.owed("dsn", now=MORNING, paired=split_pairs)
told_split = [r for r in got if r["kind"] in pp.WARNING_KINDS]
card_w = {w["id"]: w for w in pp.board_status(MORNING)["warnings"]}.get(SPLIT_LIVE["id"], {})
check("V1-PPL-04: a warning on a shift that shares its cell goes in the shared-cell words, to every director, "
      "with its ref — its own situation, never the one that says it becomes an open shift",
      len(told_split) == 2 and all(r["kind"] == pp.K_WARNING_BY_HAND and r["ref"] == SPLIT_LIVE["ref"]
                                   and r["id"].startswith(pp.K_WARNING_BY_HAND + "|") for r in told_split)
      and "15:00-19:00" in card_w.get("by_hand", ""), (told_split, card_w))
pp.forget()

# PPL-13: A STALE OR FAILED PAIRING PLANS NOTHING.
pp.forget()
cur = _Cur([LIVE])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), directors=lambda _dsn: ["Cal Sample"]):
    got = pp.owed("dsn", now=MORNING)
check("PPL-13: before anything is paired nothing is opened, told or planned",
      got == [] and not _inserts(cur), got)
pp.note(miss, index_of([]), RECENT, MORNING, read_at=MORNING)
check("a pairing just made is not stale", pp.stale(MORNING) == "")
check("PPL-13: one older than two refresh beats is — and says how old",
      "minutes ago" in pp.stale(MORNING + timedelta(seconds=pp.STALE_S + 60)))
cur = _Cur([LIVE])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), directors=lambda _dsn: ["Cal Sample"]):
    got = pp.owed("dsn", now=MORNING + timedelta(seconds=pp.STALE_S + 60))
check("and a stale pairing plans nothing at all", got == [], got)
broken = pp.note([{"no": "shape"}], {}, RECENT, MORNING, read_at=MORNING)
check("a pairing that fails leaves nothing behind, and says why",
      broken == {"rows": [], "counts": {}} and pp.rows() == []
      and "could not be paired" in pp.stale(MORNING), pp.stale(MORNING))


# ── 9. the door's answers, one round per telling ───────────────────────────

print("\n-- what the door's answer does to a telling --")


def _round(answers, *, dial="send", test_mode="off"):
    """answers: (who, state, phone_key[, {code, why}]) per director."""
    cur = _Cur([])
    keys = [pp.row_key(pp.K_WARNING, "dana|x", f"0:{a[0]}") for a in answers]
    res = [dict({"id": k, "state": a[1], "why": a[1], "phone_key": a[2]}, **(a[3] if len(a) > 3 else {}))
           for k, a in zip(keys, answers)]
    with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
        pp.mark_said("dsn", keys, {"dial": dial, "test_mode": test_mode, "results": res}, now=NOON)
    return cur.updates()


spent = _round([("calsample", "told", "k1"), ("annqexample", "told", "k2")])
check("two directors told in one telling count as ONE telling, not two",
      len(spent) == 1 and "tells=tells+1" in spent[0][0], spent)
check("PPL-06: told at `send` with test mode off REACHED somebody, and their phones are kept",
      spent[0][1][0] == 1 and json.loads(spent[0][1][4]) == ["k1", "k2"], spent[0][1])
check("PPLV-12: a telling that said something keeps the first telling's time and moves the latest one",
      "first_said_at=COALESCE(first_said_at, %s)" in spent[0][0] and "last_said_at=%s" in spent[0][0]
      and spent[0][1][2] == NOON and spent[0][1][3] == NOON, spent)
check("V1-PPL-06: with no cap the phones are merged as a set — each kept once however often it is told",
      "jsonb_agg(DISTINCT e.value)" in spent[0][0] and "phones || %s::jsonb" in spent[0][0]
      and "COALESCE((SELECT" in spent[0][0] and "'[]'::jsonb)" in spent[0][0], spent[0][0])
by_hand_cur = _Cur([])
by_hand_key = pp.row_key(pp.K_WARNING_BY_HAND, "dana|x", "3:calsample")
with _Swap(pp, _connect=lambda _dsn: _Conn(by_hand_cur)):
    pp.mark_said("dsn", [by_hand_key], {"dial": "send", "test_mode": "off", "results": [
        {"id": by_hand_key, "state": "told", "why": "told", "phone_key": "k1"}]}, now=NOON)
check("V1-PPL-04: a telling in the shared-cell words is the same warning's telling — one round, counted, its "
      "phone kept, nothing written to the staff ledger",
      len(by_hand_cur.updates()) == 1 and "tells=tells+1" in by_hand_cur.updates()[0][0]
      and by_hand_cur.updates()[0][1][6] == "dana|x"
      and not any("asa_punch_said" in s for s, _a in by_hand_cur.sql if s.lower().startswith("insert")),
      by_hand_cur.sql)
for dial, test_mode, label in (("record", "on", "the dial at record"),
                               ("send", "", "an unreadable test mode")):
    got_sql = _round([("calsample", "recorded" if dial == "record" else "told", "k1")],
                     dial=dial, test_mode=test_mode)
    check(f"PPL-06: a telling under {label} counts as a telling and reaches NOBODY",
          got_sql and "tells=tells+1" in got_sql[0][0] and got_sql[0][1][0] == 0
          and json.loads(got_sql[0][1][4]) == [], got_sql)
SIT_OFF = {"code": "situation_off", "why": "the situation shift_punch_warning is off or absent"}
got_sql = _round([("calsample", "held", "", SIT_OFF), ("annqexample", "held", "", SIT_OFF)])
check("C13: a telling the SITUATION held for every director (switched off) sends nothing and stops "
      "nothing — written on the row, and asked again on the cadence",
      got_sql and pp.GAVE_UP not in got_sql[0][1] and "SET state" not in got_sql[0][0]
      and "tells=tells+1" not in got_sql[0][0] and "told_at=%s" in got_sql[0][0]
      and "situation_off" in got_sql[0][1][1], got_sql)
got_sql = _round([("calsample", "held", "", {"why": "the situation shift_punch_warning names no SMS words"})])
check("C13: and so does one with no words",
      got_sql and pp.GAVE_UP not in got_sql[0][1] and "SET state" not in got_sql[0][0], got_sql)
SEND_HOLD = {"why": "HUB_RPC_SEND is off"}
got_sql = _round([("calsample", "held", "", SEND_HOLD), ("annqexample", "held", "", SEND_HOLD)])
check("PPLV-07: a telling the SEND DOOR held (the lane's send switch) is not now — stamped for the "
      "spacing, not counted as an attempt, and told again once the hold lifts",
      got_sql and pp.GAVE_UP not in got_sql[0][1] and "attempts" not in got_sql[0][0]
      and "told_at" in got_sql[0][0], got_sql)
got_sql = _round([("calsample", "no_contact", ""), ("annqexample", "held", "", SEND_HOLD)])
check("PPLV-07: and a director nobody can text beside one the send door held is still not now",
      got_sql and pp.GAVE_UP not in got_sql[0][1] and "attempts" not in got_sql[0][0], got_sql)
NO_PERSON = {"code": "no_person", "why": "nobody by that name in the People house"}
got_sql = _round([("calsample", "no_contact", "", NO_PERSON), ("annqexample", "no_contact", "", NO_PERSON)])
check("PPLV-07: a name the People house does not spell, for every director, is a lookup miss — an "
      "attempt, never a stop",
      got_sql and pp.GAVE_UP not in got_sql[0][1] and "attempts=attempts+1" in got_sql[0][0]
      and "tells=tells+1" not in got_sql[0][0], got_sql)
got_sql = _round([("calsample", "no_contact", ""), ("annqexample", "opted_out", "")])
check("C13: a telling no director can be told this way stops nothing — a number fixed or a director "
      "added while the shift is under way is still told",
      got_sql and pp.GAVE_UP not in got_sql[0][1] and "SET state" not in got_sql[0][0]
      and "attempts=attempts+1" in got_sql[0][0], got_sql)
check("C13: no answer class the door can give writes a warning off",
      all(pp.GAVE_UP not in a and "SET state" not in s
          for st in ("no_contact", "not_staff", "opted_out", "no_manager", "dial_off", "failed",
                     "refused", "held", "refused_quiet", "dial_unknown")
          for s, a in _round([("calsample", st, "")])))
got_sql = _round([("calsample", "no_contact", ""), ("annqexample", "told", "k2")])
check("but one director who could not be told never stops a telling another received",
      got_sql and "tells=tells+1" in got_sql[0][0], got_sql)
for silent in ("refused", "failed"):
    got_sql = _round([("calsample", silent, "")])
    check(f"a `{silent}` answer said nothing, so it is no telling — it counts an attempt, and stops nothing",
          got_sql and "tells=tells+1" not in got_sql[0][0] and "attempts=attempts+1" in got_sql[0][0]
          and "told_at" in got_sql[0][0], got_sql)
got_sql = _round([("calsample", "refused_quiet", "")])
check("`not now` is stamped for the spacing and is not counted as an attempt",
      got_sql and "attempts" not in got_sql[0][0] and "told_at" in got_sql[0][0], got_sql)


# ── 10. RECEIVED, and who may say it ───────────────────────────────────────

print("\n-- RECEIVED --")

check("RECEIVED is read as itself beside a ref", pp.received_word("received PW0123456789"))
check("a bare YES is NOT a RECEIVED", not pp.received_word("yes") and not pp.received_alone("yes"))
check("nor is a word that merely contains it", not pp.received_word("receiver"))
for text in ("I never received the schedule", "I received my paycheck but it is short",
             "Received the schedule, see you Monday", "yes, received", "ok ack, I will take it"):
    check(f"PPL-05: \"{text}\" is ordinary English, never a bare RECEIVED",
          not pp.received_alone(text) and not sms_ears.read_text(text)["received"])
for text in ("Received", "RECEIVED.", " received! ", "Ack", "acknowledged"):
    check(f"\"{text}\" alone is the word", pp.received_alone(text) and sms_ears.read_text(text)["received"])
p = sms_ears.read_text("RECEIVED PW0123456789")
check("the reply ear reads the word and the ref out of one text",
      p["received"] and p["pw"] == ["PW0123456789"] and p["reply"], p)
check("the ref is taken out before the word is read, so it is not a yes", p["word"] == "other", p)
p = sms_ears.read_text("yes SP0123456789")
check("an application by text is untouched by the new word",
      not p["received"] and p["word"] == "yes" and p["sp"] == ["SP0123456789"], p)
p = sms_ears.read_text("I never received the schedule")
check("PPL-05: and an ordinary sentence is not even a reply — nothing is acknowledged",
      not p["reply"], p)

converted = {}


def fake_convert(_dsn, wid, now=None, paired=None):
    converted["id"] = wid
    return {"state": pp.CONVERTED, "call_off_ref": "SPAAAAAAAAAA", "changed": True,
            "window": {"state": "manager_only", "why": "the shift starts in under 15 minutes"}}


ACK_AT = MORNING
PAIR_OK = [{"id": "dana|x", "verdict": pp.MISSING, "fault": True,
            "read_at": ACK_AT.astimezone(OHIO).isoformat()}]
WARNING_ROW = dict(WARN, phones=["k1"])


def ack(cur, names, **kw):
    kw.setdefault("now", ACK_AT)
    kw.setdefault("paired", PAIR_OK)
    with _Swap(pp, _connect=lambda _dsn: _Conn(cur), convert=fake_convert):
        if isinstance(names, Exception):
            def _raise(_dsn):
                raise names
            with _Swap(pp, directors=_raise):
                return pp.acknowledge("dsn", **kw)
        with _Swap(pp, directors=lambda _dsn: list(names)):
            return pp.acknowledge("dsn", **kw)


def refusal(fn):
    try:
        fn()
    except pp.Refused as exc:
        return exc
    except pp.Unreadable as exc:
        return exc
    return None


def attempt(fn):
    """The answer, or the exception it raised instead."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return exc


cur = _Cur([WARNING_ROW])
got = ack(cur, ["Cal Sample", "Ann Q. Example"], by="Cal Sample", ref="PW0123456789")
check("a DIRECTOR's RECEIVED with the ref answers the warning and converts it",
      got["state"] == pp.CONVERTED and converted.get("id") == "dana|x", got)
check("the row records which director answered",
      any("received_by" in s and "Cal Sample" in str(a) for s, a in cur.sql), cur.sql)
cur = _Cur([WARNING_ROW])
exc = refusal(lambda: ack(cur, ["Cal Sample"], by="Dana Reed", ref="PW0123456789"))
check("a NON-director's RECEIVED converts nothing",
      isinstance(exc, pp.Refused) and exc.code == "not_a_director", exc)
check("and the warning was never touched", not cur.updates(), cur.sql)
cur = _Cur([WARNING_ROW])
exc = refusal(lambda: ack(cur, pp.Unreadable("the settings house could not be opened"),
                          by="Cal Sample", ref="PW0123456789"))
check("an unreadable directors list lets NOBODY through", isinstance(exc, pp.Unreadable), exc)

# C13 / PPLV-12: A RECEIVED MINUTES AFTER THE LATEST TELLING — HOWEVER MANY THERE WERE — CONVERTS.
for n in (6, 7, 20):
    cur = _Cur([dict(WARNING_ROW, tells=n, attempts=n, delivered=n,
                     told_at=ACK_AT - timedelta(minutes=3))])
    converted.clear()
    got = attempt(lambda: ack(cur, ["Cal Sample"], by="Cal Sample", ref="PW0123456789"))
    check(f"PPLV-12: a RECEIVED three minutes after telling number {n} is taken, and the shift converts",
          isinstance(got, dict) and got.get("state") == pp.CONVERTED and converted.get("id") == "dana|x"
          and any("received_by" in s for s, _a in cur.updates()), got)
cur = _Cur([dict(WARNING_ROW, tells=7, delivered=7, told_at=ACK_AT - timedelta(minutes=3))])
converted.clear()
got = attempt(lambda: ack(cur, ["Cal Sample"], by="Cal Sample", phone_key="k1"))
check("PPLV-12: and so is a bare RECEIVED from the phone the seventh telling reached",
      isinstance(got, dict) and got.get("state") == pp.CONVERTED and converted.get("id") == "dana|x", got)
cur = _Cur(routes=[("state = ANY", []), ("WHERE ref=%s", [dict(WARNING_ROW, state=pp.GAVE_UP)])])
exc = refusal(lambda: ack(cur, ["Cal Sample"], by="Cal Sample", ref="PW0123456789"))
check("only a warning whose shift ENDED takes no answer, and the refusal says so in words",
      isinstance(exc, pp.Refused) and exc.code == "not_waiting" and "shift ended" in exc.why
      and "gave_up" not in exc.why and not cur.updates(), exc)

# PPLV-13: A BARE RECEIVED FROM A PHONE NO WARNING REACHED NEVER READS THE DIRECTORS LIST.
list_reads = []


def _list_unreadable(_dsn):
    list_reads.append("directors")
    raise pp.Unreadable("the directors list on the Time Off settings is blank")


cur = _Cur([WARNING_ROW])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), convert=fake_convert, directors=_list_unreadable):
    exc = refusal(lambda: pp.acknowledge("dsn", by="Kim Ash", phone_key="k9", now=ACK_AT, paired=PAIR_OK))
check("PPLV-13: a bare RECEIVED from a phone no warning reached is refused as not asked here BEFORE the "
      "directors list is read — an unreadable list never makes it wait",
      isinstance(exc, pp.Refused) and exc.code == "not_asked_here" and list_reads == []
      and not cur.updates(), (exc, list_reads))
cur = _Cur([WARNING_ROW])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), convert=fake_convert, directors=_list_unreadable):
    exc = refusal(lambda: pp.acknowledge("dsn", by="Cal Sample", phone_key="k1", now=ACK_AT, paired=PAIR_OK))
check("PPLV-13: from the phone a warning DID reach, the list is read, and unreadable still lets nobody through",
      isinstance(exc, pp.Unreadable) and list_reads == ["directors"] and not cur.updates(), (exc, list_reads))

# PPLV-15: RECORDED IS RECORDED — A CONVERSION THAT FAILS UNFORESEEN NEVER UN-SAYS THE ANSWER.


def _explodes(_dsn, _wid, now=None, paired=None):
    raise RuntimeError("the calendar module could not be loaded")


cur = _Cur([WARNING_ROW])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), convert=_explodes, directors=lambda _dsn: ["Cal Sample"]):
    got = attempt(lambda: pp.acknowledge("dsn", by="Cal Sample", ref="PW0123456789", now=ACK_AT,
                                         paired=PAIR_OK))
check("PPLV-15: a conversion that fails outside its own guards leaves the answer on file, waiting",
      isinstance(got, dict) and got.get("state") == pp.RECEIVED and "could not be made yet" in got.get("why", "")
      and any("received_by" in s and pp.RECEIVED in a for s, a in cur.updates()), got)
check("PPLV-15: and the director is told it is on file and tried again — never that nothing was done",
      isinstance(got, dict) and pp.received_ack(got)[0] == pp.ACK_WAITING
      and "tried again" in pp.received_ack(got)[1] and "on file" in pp.received_words(got),
      isinstance(got, dict) and pp.received_ack(got))

# V2-5 (c): A ROW THAT MOVED UNDER THE ANSWER IS REPORTED AS IT STANDS, NEVER "ON FILE, TRIED AGAIN".


def _moved(_dsn, _wid, now=None, paired=None):
    raise pp.Refused("a warning is converted once a director has answered it, and this one is closed",
                     "not_received")


cur = _Cur(routes=[("WHERE id=%s", [dict(WARNING_ROW, state=pp.CLOSED,
                                         why="the punches arrived after the warning was opened")]),
                   ("state = ANY", [WARNING_ROW])])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), convert=_moved, directors=lambda _dsn: ["Cal Sample"]):
    got = attempt(lambda: pp.acknowledge("dsn", by="Cal Sample", ref="PW0123456789", now=ACK_AT, paired=PAIR_OK))
check("V2-5: a conversion refused because the row was closed meanwhile tells the director it was closed and "
      "why — never that it is on file and tried again",
      isinstance(got, dict) and got.get("state") == pp.CLOSED and "punches arrived" in got.get("why", "")
      and pp.received_ack(got)[0] == pp.ACK_CLOSED and "tried again" not in pp.received_words(got), got)

# PPLV-01: A DIRECTOR LISTED WITH A MIDDLE INITIAL THE PEOPLE HOUSE LEAVES OUT.
LISTED = ["Cal Sample", "Ann Q. Example"]
check("PPLV-01: the listed name with its middle initial left out is the director — time_off's own match",
      pp.named_director("Ann Example", LISTED) and pp.named_director("Ann Q. Example", LISTED)
      and pp.named_director("ann q example", LISTED))
check("PPLV-01: but never another middle, and never another person",
      not pp.named_director("Ann R. Example", LISTED) and not pp.named_director("Ann Examples", LISTED)
      and not pp.named_director("Dana Reed", LISTED) and not pp.named_director("", LISTED))
cur = _Cur([WARNING_ROW])
converted.clear()
got = attempt(lambda: ack(cur, LISTED, by="Ann Example", ref="PW0123456789"))
check("PPLV-01: her RECEIVED, by the People spelling, answers the warning and converts it",
      isinstance(got, dict) and got.get("state") == pp.CONVERTED and converted.get("id") == "dana|x", got)
cur = _Cur([WARNING_ROW])
got = attempt(lambda: ack(cur, LISTED, by="Ann Example", phone_key="k1"))
check("PPLV-01: and so does her bare RECEIVED from the phone the warning reached",
      isinstance(got, dict) and got.get("ref") == "PW0123456789", got)

# PPLV-02: THE DIRECTORS ARE THE SETTINGS CELL, NEVER A DEFAULT IN CODE.
import time_off  # noqa: E402


def _view(rows, minted=True):
    return lambda _dsn, **_k: {"minted": minted, "settings": dict(time_off.SETTINGS_DEFAULTS),
                               "settings_rows": rows}


for label, rows_, minted in (("blank", [{"key": "directors", "value": "  "}], True),
                             ("missing", [{"key": "form_sync", "value": "on"}], True),
                             ("only commas", [{"key": "directors", "value": " , ,"}], True),
                             ("not set up", [], False)):
    with _Swap(time_off, view=_view(rows_, minted)):
        exc = refusal(lambda: pp.directors("dsn"))
    check(f"PPLV-02: a Time Off house whose directors cell is {label} names NOBODY — never time_off's "
          "default names", isinstance(exc, pp.Unreadable), exc)
with _Swap(time_off, view=_view([{"key": "directors", "value": "Old One"},
                                 {"key": "directors", "value": "Cal Sample, Ann Q. Example"},
                                 {"key": "directors", "value": ""}])):
    got = attempt(lambda: pp.directors("dsn"))
check("PPLV-02: the cell itself, the last non-blank one winning as time_off.view reads it",
      got == ["Cal Sample", "Ann Q. Example"], got)
with _Swap(time_off, view=_view([{"key": "directors", "value": ""}])):
    cur = _Cur([WARNING_ROW])
    with _Swap(pp, _connect=lambda _dsn: _Conn(cur), convert=fake_convert):
        exc = refusal(lambda: pp.acknowledge("dsn", by="Cal Sample", ref="PW0123456789", now=ACK_AT,
                                             paired=PAIR_OK))
check("PPLV-02: and with that cell blank nobody may answer — the RECEIVED is refused as unreadable, "
      "nothing written", isinstance(exc, pp.Unreadable) and not cur.updates(), exc)

# PPL-05: A BARE RECEIVED IS TAKEN ONLY FROM A PHONE THE WARNING REACHED.
cur = _Cur([WARNING_ROW])
got = ack(cur, ["Cal Sample"], by="Cal Sample", phone_key="k1")
check("PPL-05: a bare RECEIVED from the phone the warning reached answers that one",
      got["ref"] == "PW0123456789", got)
cur = _Cur([WARNING_ROW])
exc = refusal(lambda: ack(cur, ["Cal Sample"], by="Cal Sample", phone_key="k9"))
check("PPL-05: from a phone no warning reached it is not an answer at all",
      isinstance(exc, pp.Refused) and exc.code == "not_asked_here" and not cur.updates(), exc)
cur = _Cur([WARNING_ROW])
exc = refusal(lambda: ack(cur, ["Cal Sample"], by="Cal Sample"))
check("and with no phone at all, nothing is guessed",
      isinstance(exc, pp.Refused) and exc.code == "not_asked_here", exc)
two_on_phone = [dict(WARNING_ROW), dict(WARNING_ROW, id="kim|y", ref="PWAAAAAAAAAA", person="Kim Ash")]
cur = _Cur(two_on_phone)
exc = refusal(lambda: ack(cur, ["Cal Sample"], by="Cal Sample", phone_key="k1"))
check("a bare RECEIVED with two warnings on that phone does nothing and names both",
      isinstance(exc, pp.Refused) and exc.code == "several"
      and "PW0123456789" in exc.why and "PWAAAAAAAAAA" in exc.why, exc)

# PPL-06: ONLY ON A TELLING THAT REALLY REACHED A DIRECTOR.
cur = _Cur([dict(WARNING_ROW, delivered=0)])
exc = refusal(lambda: ack(cur, ["Cal Sample"], by="Cal Sample", ref="PW0123456789"))
check("PPL-06: a warning that was only rehearsed or recorded cannot be answered into the real pool",
      isinstance(exc, pp.Refused) and exc.code == "never_delivered" and not cur.updates(), exc)
cur = _Cur([dict(WARNING_ROW, person="Cal Sample")])
exc = refusal(lambda: ack(cur, ["Cal Sample"], by="Cal Sample", ref="PW0123456789"))
check("a director never answers the warning about their own shift",
      isinstance(exc, pp.Refused) and exc.code == "own_shift", exc)

# PPLV-04: THE ANSWER IS RECORDED AT ONCE; ONLY THE CALL OFF WAITS FOR A READ.
cur = _Cur([WARNING_ROW])
old = [dict(PAIR_OK[0], read_at=(ACK_AT - timedelta(minutes=pp.FRESH_READ_MIN + 5)).astimezone(OHIO).isoformat())]
converted.clear()
got = attempt(lambda: ack(cur, ["Cal Sample"], by="Cal Sample", ref="PW0123456789", paired=old))
check("PPLV-04: with no fresh read the RECEIVED is still recorded at once and handed to the conversion — "
      "it never waits on a read, so no later text from that phone waits behind it",
      isinstance(got, dict) and converted.get("id") == "dana|x"
      and any("received_by" in s and pp.RECEIVED in a for s, a in cur.updates()), (got, cur.updates()))
cur = _Cur([WARNING_ROW])
got = attempt(lambda: ack(cur, ["Cal Sample"], by="Cal Sample", ref="PW0123456789", paired=[]))
check("PPLV-04: and so it is when the pairing holds no row for the shift at all",
      isinstance(got, dict) and any(pp.RECEIVED in a for s, a in cur.updates()), cur.updates())
waiting = {"ref": "PW0123456789", "state": pp.RECEIVED, "call_off_ref": "", "waiting": pp.WAIT_READ,
           "why": "the time clock has not been read in the last 20 minutes"}
check("PPLV-04: the director is told it is on file and opens at the next read that still shows no punch",
      pp.received_ack(waiting)[0] == pp.ACK_WAITING and "next read of the time clock" in pp.received_ack(waiting)[1]
      and "on file" in pp.received_words(waiting) and "next read" in pp.received_words(waiting),
      (pp.received_ack(waiting), pp.received_words(waiting)))
cur = _Cur([WARNING_ROW])
clocked = [dict(PAIR_OK[0], verdict=pp.OPEN, fault=False)]
converted.clear()
exc = refusal(lambda: ack(cur, ["Cal Sample"], by="Cal Sample", ref="PW0123456789", paired=clocked))
check("PPL-04: a fresh read that shows a clock-in refuses it and closes the warning — nobody working "
      "is ever called off",
      isinstance(exc, pp.Refused) and exc.code == "stood_down"
      and any(pp.CLOSED in a for s, a in cur.updates()) and "id" not in converted,
      (exc, cur.updates()))

check("the conversion's answer to the director says what the window is",
      "manager_only" not in pp.received_words(
          {"ref": "PW0123456789", "state": pp.CONVERTED, "call_off_ref": "SPAAAAAAAAAA",
           "window": {"why": "open to all staff for 5 hours from the call-off"}})
      and "5 hours" in pp.received_words(
          {"ref": "PW0123456789", "state": pp.CONVERTED, "call_off_ref": "SPAAAAAAAAAA",
           "window": {"why": "open to all staff for 5 hours from the call-off"}}))

# THE CONVERSION ITSELF ASKS THE SAME QUESTIONS.
RECEIVED_ROW = dict(WARNING_ROW, state=pp.RECEIVED, received_by="Cal Sample")
cur = _Cur([dict(RECEIVED_ROW, shift_end=ACK_AT - timedelta(minutes=1))])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
    got = pp.convert("dsn", "dana|x", now=ACK_AT, paired=PAIR_OK)
check("PPL-07: a shift that ended is never opened from a warning — it closes and says so",
      got["state"] == pp.CLOSED and "ended" in got["why"]
      and any(pp.CLOSED in a for s, a in cur.updates()), got)
cur = _Cur([RECEIVED_ROW])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
    got = pp.convert("dsn", "dana|x", now=ACK_AT, paired=old)
check("PPL-04: a conversion with no fresh read waits, and spends none of its tries",
      got["state"] == pp.RECEIVED and got.get("waiting") == pp.WAIT_READ and not cur.updates(),
      (got, cur.updates()))
cur = _Cur([RECEIVED_ROW])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
    got = pp.convert("dsn", "dana|x", now=ACK_AT, paired=clocked)
check("PPL-04: a conversion whose fresh read shows a clock-in closes instead of calling anybody off",
      got["state"] == pp.CLOSED and "clocked in" in got["why"], got)


# ── 11. the ear: the ref names the road, and a bare word is not ours ───────

print("\n-- the ear --")

p = sms_ears.read_text("Yes, received")
check("a yes that happens to carry the word is a yes, and not a RECEIVED",
      p["word"] == "yes" and not p["received"])
p = sms_ears.read_text("yes received SP1A2B3C4D5E")
check("and a shift application that carries it still names its shift",
      p["sp"] == ["SP1A2B3C4D5E"] and p["word"] == "yes", p)


EAR_FROM = "+15551234567"


class _Ear:
    """The ear's one pass, with every read answered from here. `phones` are the
    phones a live warning reached; None asks the real read (pp.warned_phones)."""

    def __init__(self, name, phones=None, down=False):
        self.name = name
        self.phones = phones
        self.down = down
        self.reads = []

    def warned_phones(self):
        self.reads.append("warned")
        if self.phones is not None:
            return set(self.phones)
        try:
            return pp.warned_phones("dsn")
        except Exception as exc:  # noqa: BLE001 — as the real pass does
            raise sms_ears._Wait(f"the punch warnings could not be read ({type(exc).__name__})") from exc

    def contacts(self):
        self.reads.append("contacts")
        if self.down:
            raise sms_ears._Wait("the contacts could not be read (stand-in)")

        class C:
            def who(_self, _line, _from):
                return {"name": self.name, "sender": sms_ears.SENDER_NAMED}
        return C()

    def view(self):
        self.reads.append("view")
        if self.down:
            raise sms_ears._Wait("the house calendars could not be read (stand-in)")
        return {"people": {}, "cells": {}, "isos": {}, "by_code": {}}

    def ist(self):
        return {}

    def who(self, _name):
        return {}


roads = []


def _road(word):
    def fn(*_a, **_k):
        roads.append(word)
        return dict(_a[3], road=word)
    return fn


def _heard(text, *, acknowledge):
    roads.clear()
    with _Swap(sms_ears, _by_shift_ref=_road("shift"), _bare=_road("bare")), \
            _Swap(sms_ears.punch_pairs, acknowledge=acknowledge):
        return sms_ears._hear("dsn", {"id": "t", "line": "5558", "sent_at": NOON,
                                      "from": EAR_FROM, "text": text},
                              _Ear("Dana Reed", phones={sms_ears.psi_reminders.phone_key(EAR_FROM)}))


def _refuse(code):
    def fn(*_a, **_k):
        roads.append("punch")
        raise pp.Refused("refused", code)
    return fn


def _answers(*_a, **kw):
    roads.append("punch")
    return {"ref": "PW0123456789", "state": pp.CONVERTED, "call_off_ref": "SPAAAAAAAAAA",
            "phone_key": kw.get("phone_key")}


got = _heard("yes received SP1A2B3C4D5E", acknowledge=_answers)
check("\"yes received SP…\" goes down the shift road", roads == ["shift"], roads)
got = _heard("Yes, received", acknowledge=_answers)
check("\"Yes, received\" is a bare yes", roads == ["bare"], roads)
got = _heard("Ok ack, I will take it", acknowledge=_answers)
check("\"Ok ack, I will take it\" is a bare yes", roads == ["bare"], roads)
for text in ("I never received the schedule", "I received my paycheck but it is short",
             "Received the schedule, see you Monday"):
    got = _heard(text, acknowledge=_answers)
    check(f"PPL-05: \"{text}\" reaches no road and is acknowledged by nothing",
          roads == [] and got["outcome"] == sms_ears.NOT_A_REPLY and not got.get("ack"), (roads, got))
got = _heard("RECEIVED PW0123456789", acknowledge=_answers)
check("\"RECEIVED PW…\" goes down the punch road, and answers — acknowledged by the open-shift "
      "situation, with one fact and no sentence",
      roads == ["punch"] and got["outcome"] == sms_ears.ANSWERED
      and got["ack"] == sms_ears.ACK_PUNCH[pp.ACK_OPENED] == "sms_reply_punch_open"
      and got["ack_why"] == "the house manager assigns it", got)
got = _heard("Received", acknowledge=_answers)
check("a bare \"Received\" from a phone a warning reached answers it, with the phone's hash",
      roads == ["punch"] and got["outcome"] == sms_ears.ANSWERED, got)
got = _heard("Received", acknowledge=_refuse("not_a_director"))
check("PPL-05: a bare \"Received\" from somebody who is not a director falls through to the bare "
      "road — no refusal, no \"please reply with the reference\"",
      roads == ["punch", "bare"] and not got.get("ack") and got.get("road") == "bare", (roads, got))
got = _heard("ack", acknowledge=_refuse("not_asked_here"))
check("PPL-05: nor from a director whose phone no warning reached",
      roads == ["punch", "bare"] and not got.get("ack"), (roads, got))
got = _heard("Received", acknowledge=_refuse("several"))
check("a director with two warnings on their phone is asked which, by its ref",
      roads == ["punch"] and got["outcome"] == sms_ears.AMBIGUOUS and got["ack"] == sms_ears.ACK_UNCLEAR, got)

# PPLV-10: BESIDE A REF, RECEIVED MUST STILL BE THE ANSWER, NOT A SENTENCE THAT HOLDS IT.
for text in ("PW0123456789 not received?", "No, do not open it, received PW0123456789",
             "received PW0123456789?", "PW0123456789 was never received", "don't open, received PW0123456789"):
    p = sms_ears.read_text(text)
    check(f"PPLV-10: \"{text}\" quotes the ref but is not the answer — nothing is opened",
          p["pw"] == ["PW0123456789"] and not p["received"] and not pp.received_answer(
              text.replace("PW0123456789", " ")), p)
    got = _heard(text, acknowledge=_answers)
    check(f"PPLV-10: \"{text}\" is asked for a plain RECEIVED, and no warning is answered",
          roads == [] and got["outcome"] == sms_ears.UNCLEAR and got["ack"] == sms_ears.ACK_UNCLEAR
          and "plain RECEIVED" in got["ack_why"], (roads, got))
for text in ("RECEIVED PW0123456789", "Received PW0123456789 thanks", "got it, received PW0123456789",
             "ok ack PW0123456789", "PW0123456789 received. Thank you"):
    check(f"PPLV-10: \"{text}\" is a plain RECEIVED beside its ref",
          sms_ears.read_text(text)["received"], sms_ears.read_text(text))

# PPLV-01 / PPLV-04: THE EAR, THROUGH THE REAL acknowledge.
EAR_KEY = sms_ears.psi_reminders.phone_key("+15551234567")
EAR_ROW = dict(WARN, phones=[EAR_KEY])


def _heard_real(text, name, *, names=("Cal Sample", "Ann Q. Example"), paired=PAIR_OK, conv=fake_convert,
                rows=(EAR_ROW,)):
    roads.clear()
    cur_ = _Cur(list(rows))
    real = pp.acknowledge

    def _ack(dsn, **kw):
        kw.setdefault("paired", paired)
        kw.setdefault("now", ACK_AT)
        return real(dsn, **kw)

    with _Swap(sms_ears, _by_shift_ref=_road("shift"), _bare=_road("bare")), \
            _Swap(pp, _connect=lambda _dsn: _Conn(cur_), directors=lambda _dsn: list(names),
                  convert=conv, acknowledge=_ack):
        got_ = attempt(lambda: sms_ears._hear("dsn", {"id": "t", "line": "5558", "sent_at": NOON,
                                                     "from": "+15551234567", "text": text}, _Ear(name)))
    return got_, cur_


got, cur = _heard_real("RECEIVED PW0123456789", "Ann Example")
check("PPLV-01: a director listed as \"Ann Q. Example\" who is \"Ann Example\" in contacts answers by "
      "text WITH the ref — no refusal, the warning converts",
      isinstance(got, dict) and got["outcome"] == sms_ears.ANSWERED
      and got["ack"] == "sms_reply_punch_open" and converted.get("id") == "dana|x", got)
got, cur = _heard_real("Received", "Ann Example")
check("PPLV-01: and a bare RECEIVED from the phone the warning reached is heard too — never dropped as "
      "\"not a director\"",
      isinstance(got, dict) and got["outcome"] == sms_ears.ANSWERED and "bare" not in roads, (roads, got))
got, cur = _heard_real("Received", "Dana Reed")
check("a bare RECEIVED from somebody who is not a director still falls through, unanswered",
      isinstance(got, dict) and roads == ["bare"] and not got.get("ack"), (roads, got))

# V2R3-4: A DOUBLE'S TWO WARNINGS ANSWERED IN ONE TEXT.
converted.clear()
got, cur = _heard_real("RECEIVED PW0123456789 PW0ABCDEF123", "Cal Sample")
check("V2R3-4: a RECEIVED quoting both warnings of a double does nothing — one RECEIVED answers one warning — "
      "and the director is told how to answer each, never left hearing nothing",
      isinstance(got, dict) and got["outcome"] == sms_ears.AMBIGUOUS and got["code"] == "several_refs"
      and got["road"] == sms_ears.ROAD_PUNCH and got["ack"] == sms_ears.ACK_UNCLEAR
      and "RECEIVED PW0123456789, then RECEIVED PW0ABCDEF123" in got["ack_why"]
      and "each in a text of its own" in got["ack_why"] and not converted
      and not any(pp.RECEIVED in a for _s, a in cur.updates())
      and all(32 <= ord(ch) < 127 for ch in got["ack_why"]), got)
check("V2R3-4: its acknowledgement speaks of both warnings, and stays true while either still waits",
      isinstance(got, dict) and sms_ears._punch_refs(got) == ["PW0123456789", "PW0ABCDEF123"]
      and sms_ears._still_true(got, NOON, pool_by_ref={}, dsn="dsn") == (True, "")
      and sms_ears.punch_ack_true(sms_ears.ACK_UNCLEAR, [dict(WARN, state=pp.CLOSED),
                                                          dict(WARN, ref="PW0ABCDEF123")], NOON)[0]
      and not sms_ears.punch_ack_true(sms_ears.ACK_UNCLEAR, [dict(WARN, state=pp.CLOSED),
                                                              dict(WARN, state=pp.CONVERTED)], NOON)[0],
      got)
got, cur = _heard_real("RECEIVED PW0123456789 SP1A2B3C4D5E", "Cal Sample")
check("V2R3-4: a text quoting a warning beside another road's ref stays as every road has it — nothing done, "
      "no acknowledgement",
      isinstance(got, dict) and got["code"] == "several_refs" and not got.get("ack"), got)


def _heard_list_down(text, name, *, rows):
    roads.clear()
    list_reads.clear()
    cur_ = _Cur(list(rows))
    with _Swap(sms_ears, _by_shift_ref=_road("shift"), _bare=_road("bare")), \
            _Swap(pp, _connect=lambda _dsn: _Conn(cur_), directors=_list_unreadable, convert=fake_convert):
        return attempt(lambda: sms_ears._hear("dsn", {"id": "t", "line": "5558", "sent_at": NOON,
                                                     "from": "+15551234567", "text": text}, _Ear(name)))


got = _heard_list_down("Received", "Kim Ash", rows=(WARNING_ROW,))
check("PPLV-13 / V1-PPL-02: by text, a bare \"Received\" from a phone no warning reached is NOT A REPLY, as "
      "before the word was read — no road, no directors list, nothing acknowledged, and it never waits",
      isinstance(got, dict) and roads == [] and list_reads == [] and not got.get("ack")
      and got["outcome"] == sms_ears.NOT_A_REPLY and "no punch warning reached" in got["why"],
      (got, roads, list_reads))
# V1-PPL-02: THE WARNINGS' PHONES ARE ASKED FIRST — BEFORE THE CONTACTS AND THE CALENDARS.
down_ear = _Ear("Kim Ash", phones=set(), down=True)
roads.clear()
with _Swap(sms_ears, _by_shift_ref=_road("shift"), _bare=_road("bare")):
    got = attempt(lambda: sms_ears._hear("dsn", {"id": "t", "line": "5558", "sent_at": NOON, "from": EAR_FROM,
                                                 "text": "Received"}, down_ear))
check("V1-PPL-02: with the contacts and the house calendars both unreadable, a bare \"Received\" from a phone "
      "no warning reached does not wait — it is not a reply, and its sender reads as unread, never unknown",
      isinstance(got, dict) and got["outcome"] == sms_ears.NOT_A_REPLY and got["sender"] == sms_ears.SENDER_UNREAD
      and down_ear.reads[0] == "warned" and "view" not in down_ear.reads and roads == [],
      (got, down_ear.reads, roads))
reached_down = _Ear("Cal Sample", phones={sms_ears.psi_reminders.phone_key(EAR_FROM)}, down=True)
got = attempt(lambda: sms_ears._hear("dsn", {"id": "t", "line": "5558", "sent_at": NOON, "from": EAR_FROM,
                                             "text": "Received"}, reached_down))
check("V1-PPL-02: but from a phone a live warning DID reach, an unreadable contacts book still makes it wait — "
      "a director's answer is never thrown away",
      isinstance(got, sms_ears._Wait), got)


def _rows_down(_dsn, **_k):
    raise RuntimeError("the database went away")


with _Swap(pp, warning_rows=_rows_down):
    got = attempt(lambda: sms_ears._hear("dsn", {"id": "t", "line": "5558", "sent_at": NOON, "from": EAR_FROM,
                                                 "text": "Received"}, _Ear("Kim Ash")))
check("V1-PPL-02: a warnings read that fails is not \"no phone\" — the bare RECEIVED waits (fail closed)",
      isinstance(got, sms_ears._Wait) and "punch warnings could not be read" in got.why, got)
cur = _Cur([dict(WARNING_ROW, phones=["k1", "k2"]), dict(WARNING_ROW, id="kim|y", phones=["k2", "k3"])])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
    got = pp.warned_phones("dsn")
check("V1-PPL-02: the phones asked are every phone a warning still being told reached, read once",
      got == {"k1", "k2", "k3"} and any("state = ANY" in s for s, _a in cur.sql), got)
yes_ear = _Ear("Dana Reed", phones=set())
roads.clear()
with _Swap(sms_ears, _by_shift_ref=_road("shift"), _bare=_road("bare")):
    got = attempt(lambda: sms_ears._hear("dsn", {"id": "t", "line": "5558", "sent_at": NOON, "from": EAR_FROM,
                                                 "text": "yes"}, yes_ear))
check("V1-PPL-02: and a plain yes never reads the warnings at all — only a bare RECEIVED asks them",
      roads == ["bare"] and "warned" not in yes_ear.reads, (roads, yes_ear.reads))
got = _heard_list_down("Received", "Cal Sample", rows=(EAR_ROW,))
check("PPLV-13: but from the phone a warning reached, an unreadable list makes that text wait — it "
      "fails closed, and nothing is answered",
      isinstance(got, sms_ears._Wait) and list_reads == ["directors"], (got, list_reads))


def _waits(_dsn, wid, now=None, paired=None):
    converted["id"] = wid
    return {"state": pp.RECEIVED, "call_off_ref": "", "changed": False, "waiting": pp.WAIT_READ,
            "why": "the time clock has not been read in the last 20 minutes"}


got, cur = _heard_real("RECEIVED PW0123456789", "Cal Sample", paired=old, conv=_waits)
check("PPLV-04: by text with no fresh read, the RECEIVED is recorded and acknowledged as on file — "
      "the text never waits, so the phone's later texts are not held behind it",
      isinstance(got, dict) and got["outcome"] == sms_ears.ANSWERED
      and got["ack"] == "sms_reply_punch_waiting" and "next read of the time clock" in got["ack_why"]
      and any(pp.RECEIVED in a for s, a in cur.updates()), got)


# ── 12. a RECEIVED the calendar refuses is never parked for ever ───────────

print("\n-- a RECEIVED the calendar refuses --")

check("a refusal the estate will never change its mind about stops the warning",
      pp.CONVERT_FINAL == frozenset({"ended", "already_pooled", "no_shift"}))
check("and everything else is tried again, spaced and capped",
      pp.CONVERT_TRIES > 0 and pp.CONVERT_EVERY_MIN > 0)
cur = _Cur([dict(RECEIVED_ROW, call_off_ref="", said={"convert": {"tries": pp.CONVERT_TRIES, "at": ""}})])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
    counts = pp.retry_conversions("dsn", now=NOON)
check("a conversion that has been refused to the cap stops and stays on the board",
      counts["stopped"] == 1 and any(pp.CLOSED in str(a) for s, a in cur.updates()), cur.sql)
check("and the director is told which of the two happened",
      "It stops here." in pp.received_words({"ref": "PW1", "state": pp.CLOSED, "why": "x"})
      and "tried again" in pp.received_words({"ref": "PW1", "state": pp.RECEIVED, "why": "x"}))
capped = [(s, a) for s, a in cur.updates() if pp.CLOSED in a]
check("V2-5 (a): the cap owes the director who was told \"it is tried again\" a closed acknowledgement, "
      "with the reason and when",
      capped and "closed_ack" in capped[0][0] and capped[0][1][3] is True
      and "could not be opened after" in json.loads(capped[0][1][4])["why"]
      and "by hand" in json.loads(capped[0][1][4])["why"] and json.loads(capped[0][1][4])["at"], capped)
CAPPED_ROW = dict(RECEIVED_ROW, state=pp.CLOSED, received_by="Cal Sample",
                  said={"closed_ack": {"why": "the shift could not be opened after 12 tries - open it by hand",
                                       "at": NOON.astimezone(UTC).isoformat()}})
acks = pp._follow_ack_rows([CAPPED_ROW], {}, NOON + timedelta(minutes=1))
check("V2-5 (a): it is one row to that director by name, in the closed acknowledgement's own situation — "
      "facts only: the ref, the reason, the shift",
      len(acks) == 1 and acks[0]["kind"] == pp.K_CLOSED_ACK == "sms_reply_punch_closed"
      and acks[0]["person"] == "Cal Sample" and acks[0]["ref"] == "PW0123456789"
      and "12 tries" in acks[0]["why"] and acks[0]["staff"] == "Dana Reed" and acks[0]["mail"] is False
      and acks[0]["id"] == f"sms_reply_punch_closed|{CAPPED_ROW['id']}", acks)
told_entry = {"state": "told", "at": NOON.astimezone(UTC).isoformat()}
check("V2-5 (a): said once, it is never said again",
      pp._follow_ack_rows([CAPPED_ROW], {acks[0]["id"]: told_entry}, NOON + timedelta(hours=1)) == [])
off_entry = {"state": "held", "code": "situation_off", "at": NOON.astimezone(UTC).isoformat()}
check("V2-5 (a): switched off when it was due, it is written off — never a stale \"it stopped\" hours later",
      pp._follow_ack_rows([CAPPED_ROW], {acks[0]["id"]: off_entry}, NOON + timedelta(hours=1)) == [])
check("V2-5 (a): and past its keep it is old news the board keeps",
      pp._follow_ack_rows([CAPPED_ROW], {}, NOON + timedelta(hours=pp.CLOSED_ACK_KEEP_H + 1)) == [])
check("V2-5 (a): a row closed for any other reason owes nobody anything from here",
      pp._follow_ack_rows([dict(CAPPED_ROW, said={})], {}, NOON) == [])
ack_cur = _Cur([])
ack_key = acks[0]["id"]
with _Swap(pp, _connect=lambda _dsn: _Conn(ack_cur)):
    pp.mark_said("dsn", [ack_key], {"dial": "send", "test_mode": "off", "results": [
        {"id": ack_key, "state": "held", "code": "situation_off", "why": "the situation is off or absent"}]}, now=NOON)
kept = [a for s, a in ack_cur.sql if s.lower().startswith("insert into asa_punch_said")]
check("V2-5 (a): the door's answer is kept in the lane's ledger with its code, so the write-off can be read back",
      kept and kept[0][0] == ack_key and json.loads(kept[0][3])["code"] == "situation_off", ack_cur.sql)

# V2-5 (b): A TRY THAT RAISED COUNTS; A SHIFT THAT ENDED CLOSES FIRST.
cur = _Cur([dict(RECEIVED_ROW, call_off_ref="", said={})])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), convert=_explodes):
    counts = pp.retry_conversions("dsn", now=NOON)
check("V2-5 (b): a conversion that raised is counted as a try, so a module that will not load cannot keep a "
      "row RECEIVED for ever",
      counts["tried"] == 1 and any("'tries'" in s and "RuntimeError" in str(a) for s, a in cur.sql), cur.sql)
cur = _Cur([dict(RECEIVED_ROW, call_off_ref="", said={}, shift_end=NOON - timedelta(minutes=1))])
calls_after_end = []
with _Swap(pp, _connect=lambda _dsn: _Conn(cur),
           convert=lambda *a, **k: calls_after_end.append(1) or {"state": pp.RECEIVED}):
    counts = pp.retry_conversions("dsn", now=NOON)
check("V2-5 (b): a RECEIVED whose shift ended closes before anything else is tried — and its director is owed "
      "the closing",
      counts["stopped"] == 1 and not calls_after_end
      and any(pp.CLOSED in a and "shift ended" in str(a) and "closed_ack" in s for s, a in cur.updates()),
      cur.updates())

two_tabs = {"isos": {"CALENDAR - JH": [DAY.isoformat()],
                     "Copy of CALENDAR - JH": [DAY.isoformat()]},
            "by_code": {"JH": "Copy of CALENDAR - JH"},
            "cells": {}, "people": {}}
exc = refusal(lambda: pp._cell_for(two_tabs, "JH", "Dana Reed", DAY.isoformat()))
check("two live tabs answering to one code refuse the conversion rather than guess",
      isinstance(exc, pp.Refused) and exc.code == "several_houses", exc)
one_tab = {"isos": {"CALENDAR - JH": [DAY.isoformat()]}, "by_code": {"JH": "CALENDAR - JH"},
           "cells": {"CALENDAR - JH": {("Dana Reed", DAY.isoformat()): "7A-3P"}},
           "people": {"CALENDAR - JH": ["Dana Reed"]}}
check("and one tab still resolves, the way every other call off does",
      pp._cell_for(one_tab, "JH", "Dana Reed", DAY.isoformat()) == ("CALENDAR - JH", "Dana Reed"),
      pp._cell_for(one_tab, "JH", "Dana Reed", DAY.isoformat()))

# PPLV-14: A CALL OFF OPENS A WHOLE CELL, SO A SPLIT CELL IS NEVER OPENED FROM ONE SPAN'S WARNING.
import shift_requests as sr  # noqa: E402

SPLIT = [dict(PAIR_OK[0], person_key="danareed", house="JH", day=DAY.isoformat(), time="07:00", ends="11:00"),
         {"id": "danareed|later", "person_key": "danareed", "house": "JH", "day": DAY.isoformat(),
          "time": "15:00", "ends": "19:00", "verdict": pp.MISSING, "fault": False}]
estate_reads = []
cur = _Cur([RECEIVED_ROW])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur)), \
        _Swap(sr, estate=lambda *_a, **_k: estate_reads.append(1) or {}):
    got = pp.convert("dsn", "dana|x", now=ACK_AT, paired=SPLIT)
check("PPLV-14: a shift that shares its cell with another of the person's shifts is not opened — the "
      "call off would open both — and the answer says to open it by hand",
      got["state"] == pp.CLOSED and got.get("code") == pp.SPLIT_CELL and "by hand" in got["why"]
      and "15:00-19:00" in got["why"] and not estate_reads
      and any(pp.CLOSED in a for s, a in cur.updates()), (got, estate_reads))
check("PPLV-14: and the director's acknowledgement carries that reason",
      pp.received_ack(got) == (pp.ACK_CLOSED, got["why"]), pp.received_ack(got))
check("PPLV-14: another house the same day is another cell, never a split one",
      pp.split_cell(RECEIVED_ROW, [SPLIT[0], dict(SPLIT[1], house="AB")]) == "")
check("PPLV-14: nor another day at the same house",
      pp.split_cell(RECEIVED_ROW, [SPLIT[0], dict(SPLIT[1], day=(DAY + timedelta(days=1)).isoformat())]) == "")

# A DOUBLE WALKS THE LADDER TWICE — one warning per shift, each told, each answered, never folded.
dbl = [shift("Dana Reed", "7a-3p", DAY, "07:00", "15:00", house="JH"),
       shift("Dana Reed", "3p-11p", DAY, "15:00", "23:00", house="AB")]
no_way = {pa.shift_id(s): {"why": "no_contact"} for s in dbl}
dbl_9 = pp.pair_shifts(dbl, index_of([]), RECENT, at(DAY, "09:00"), read_at=at(DAY, "09:00"))["rows"]
counts, cur = _opened(dbl_9, at(DAY, "09:00"), stopped=no_way)
first_open = _inserts(cur)
check("a double: during its first shift ONE warning is opened, for that shift alone",
      counts["opened"] == 1 and first_open and first_open[0][1][0] == pa.shift_id(dbl[0]), cur.sql)
dbl_16 = pp.pair_shifts(dbl, index_of([]), RECENT, at(DAY, "16:00"), read_at=at(DAY, "16:00"))["rows"]
by_sid = {r["id"]: r for r in dbl_16}
first_live = [{"id": pa.shift_id(dbl[0]), "state": pp.WARNED, "call_off_ref": "",
               "person_key": by_sid[pa.shift_id(dbl[0])]["person_key"],
               "shift_at": by_sid[pa.shift_id(dbl[0])]["shift_at"],
               "shift_end": by_sid[pa.shift_id(dbl[0])]["shift_end"]}]
counts, cur = _opened(dbl_16, at(DAY, "16:00"), stopped=no_way, live=first_live)
second_open = _inserts(cur)
check("and during its second shift the second raises a warning OF ITS OWN — its own id and ref — beside "
      "the first, never folded into it",
      counts["opened"] == 1 and second_open and second_open[0][1][0] == pa.shift_id(dbl[1])
      and second_open[0][1][1] == pp.ref_of(pa.shift_id(dbl[1]))
      and pp.ref_of(pa.shift_id(dbl[1])) != pp.ref_of(pa.shift_id(dbl[0])), cur.sql)
W1 = dict(WARN, id=pa.shift_id(dbl[0]), ref=pp.ref_of(pa.shift_id(dbl[0])), house="JH", shift_code="7a-3p",
          phones=["k1"], delivered=1)
W2 = dict(WARN, id=pa.shift_id(dbl[1]), ref=pp.ref_of(pa.shift_id(dbl[1])), house="AB", shift_code="3p-11p",
          shift_at=at(DAY, "15:00"), shift_end=at(DAY, "23:00"), phones=["k1"], delivered=1)
told_both = pp.warning_door_rows(W1, ["Cal Sample"]) + pp.warning_door_rows(W2, ["Cal Sample"])
check("each of the double's warnings is its own text to each director, naming its own shift and ref",
      [(r["ref"], r["shift_code"]) for r in told_both] == [(W1["ref"], "7a-3p"), (W2["ref"], "3p-11p")]
      and len({r["id"] for r in told_both}) == 2, told_both)
cur = _Cur([W1, W2])
converted.clear()
got = attempt(lambda: ack(cur, ["Cal Sample"], by="Cal Sample", ref=W2["ref"], paired=[]))
check("a RECEIVED on the second shift's ref converts the second shift, and only it",
      isinstance(got, dict) and got.get("ref") == W2["ref"] and converted.get("id") == W2["id"]
      and all(W1["id"] not in str(a) for s, a in cur.updates()), (got, cur.updates()))
check("a double across two houses is two cells, so neither is a split cell",
      pp.split_cell(dict(W2, person_key=dbl_16[1]["person_key"]), dbl_16) == "")

import shift_requests as sr  # noqa: E402

w = sr.window_for(sr.KIND_CALLOFF, opened_at=NOON, shift_start=NOON + timedelta(hours=9), now=NOON)
check("a call off made nine hours before the shift takes applications for five hours",
      w["state"] == sr.WINDOW_OPEN
      and (datetime.fromisoformat(w["closes_at"]) - NOON) == timedelta(hours=sr.CALLOFF_APPLY_H), w)
w = sr.window_for(sr.KIND_CALLOFF, opened_at=NOON, shift_start=NOON - timedelta(hours=3), now=NOON)
check("a shift already under way takes no applications at all — the house manager assigns it",
      w["state"] == sr.WINDOW_MANAGER_ONLY, w)


# ── 12b. a live warning keeps the clock read (V1-PPL-01) ───────────────────

print("\n-- a live warning keeps the clock read --")

T21 = at(DAY, "08:21")
W_SID = fresh_pairs[0]["id"]
TOLD_ROW = dict(WARN, id=W_SID, ref=fresh_pairs[0]["ref"], state=pp.WARNED, tells=1, delivered=1,
                told_at=T21, shift_at=at(DAY, "07:00"), shift_end=at(DAY, "15:00"))


def _wanted(rows, now, read_at, *, remembered=None):
    pp.forget()
    pp._remember_warnings(rows, remembered or now)
    return pp.reads_wanted(now, read_at)


got = _wanted([TOLD_ROW], T21 + timedelta(minutes=5), T21)
check("V1-PPL-01: a warning told at 08:21 on a read of 08:21 asks for its next read at 08:41 — its next telling",
      got["at"] == T21 + timedelta(minutes=pp.WARN_EVERY_MIN) and [s["id"] for s in got["shifts"]] == [W_SID],
      got)
got = _wanted([dict(TOLD_ROW, tells=40, attempts=40, delivered=40)], T21 + timedelta(minutes=5), T21)
check("V1-PPL-01: after forty tellings it still asks — no read budget stands in for a give-up count",
      got["at"] == T21 + timedelta(minutes=pp.WARN_EVERY_MIN), got)
got = _wanted([TOLD_ROW], T21 + timedelta(minutes=19), T21 + timedelta(minutes=18))
check("a read the lane's own plan made in time already backs the next telling — none is spent on it",
      got["at"] is None and not got["shifts"], got)
got = _wanted([dict(TOLD_ROW, told_at=None, tells=0)], T21, T21 - timedelta(minutes=40))
check("a warning never told, with no fresh read, asks for one now",
      got["at"] == T21, got)
night_told = dict(TOLD_ROW, told_at=at(DAY, "21:20"), shift_end=at(DAY + timedelta(days=1), "09:00"))
got = _wanted([night_told], at(DAY, "21:25"), at(DAY, "21:20"))
check("inside the quiet window nothing is told, so its read waits for the window's end",
      got["at"] is not None and got["at"].astimezone(OHIO).strftime("%H:%M") == "08:00", got)
recv = dict(TOLD_ROW, state=pp.RECEIVED, received_by="Cal Sample", call_off_ref="")
got = _wanted([recv], ACK_AT + timedelta(minutes=25), ACK_AT)
check("V1-PPL-01: a RECEIVED answered 25 minutes after the latest read asks for a read NOW — its call off "
      "stands on one",
      got["at"] == ACK_AT + timedelta(minutes=25) and got["shifts"][0]["state"] == pp.RECEIVED, got)
got = _wanted([recv], ACK_AT + timedelta(minutes=5), ACK_AT)
check("and not while the latest read is still fresh — the call off can stand on that one",
      got["at"] is None, got)
for label, row, now_ in (("converted", dict(recv, state=pp.CONVERTED, call_off_ref="SPAAAAAAAAAA"), ACK_AT),
                         ("closed", dict(TOLD_ROW, state=pp.CLOSED), ACK_AT),
                         ("whose shift ended", TOLD_ROW, at(DAY, "15:01"))):
    got = _wanted([row], now_, now_ - timedelta(hours=1))
    check(f"a warning {label} asks for no read", got["at"] is None and not got["shifts"], got)
got = _wanted([TOLD_ROW], T21 + timedelta(minutes=45), T21, remembered=T21)
check("a warnings list older than the pairing's own staleness asks for nothing — nothing could be told from it",
      got["at"] is None, got)
pp.forget()
pp._remember_warnings([TOLD_ROW], T21)
pp._warnings_failed("OperationalError")
check("nor does one whose last read failed", pp.reads_wanted(T21 + timedelta(minutes=25), T21)["at"] is None)

# THROUGH THE ATTENDANCE LANE'S OWN PASS, WITH BOTH FOLLOW-UP PURSES SPENT.
import psi_anywhere as psa  # noqa: E402

W_SHIFT = next(s for s in miss)


def _warn_pass(now, *, rows, read_at, last_done):
    """One pass of the attendance lane with the warnings the post last read,
    the collection itself stood in (it records when it was asked)."""
    asked = []

    def _collect(day_from, day_to, now_):
        asked.append(now_)
        return {"sent": True, "state": "unknown", "why": "a stand-in collection", "rows": [], "meta": {}}

    pp.forget()
    pp._remember_warnings(rows, now)
    pa._S.clear()
    Path(os.environ["HUB_PSI_ATTENDANCE_STATE"]).write_text("{}", encoding="utf-8")
    pa._load()
    today = now.astimezone(OHIO).date().isoformat()
    pa._S.update(last_done=last_done.isoformat(), read_at=read_at.isoformat(),
                 session={"token": "stand-in", "account": "adm"},
                 judged={pa.shift_id(W_SHIFT): today},
                 follow_ups={"day": today, "n": pa.FOLLOW_UP_DAY_MAX,
                             "by_shift": {pa.shift_id(W_SHIFT): pa.FOLLOW_UPS_PER_SHIFT}})
    pa._CACHE.update(at=now.timestamp(), shifts=[W_SHIFT], offs={}, loose=[])
    with _Swap(pa, _collect=_collect, _refresh=lambda _dsn, n: pa._CACHE.update(at=n.timestamp())), \
            _Swap(psa, down_state=lambda: None, paused=lambda: (False, ""), active_account=lambda: "adm",
                  login_snapshot=lambda: {}, login_would_allow=lambda *a, **k: (True, "")):
        out = pa._pass("dsn", now)
    return out, asked


check("the stand-in shift is the warning's own", pa.shift_id(W_SHIFT) == W_SID)
out, asked = _warn_pass(at(DAY, "08:40"), rows=[TOLD_ROW], read_at=T21, last_done=T21)
check("V1-PPL-01: with the shift's follow-ups and the day's all spent, the lane waits out the warning's own "
      "cadence — no collection at 08:40",
      not asked and out.get("state") == "waiting" and pa._follow_up_at(at(DAY, "08:40"), T21) is None, (out, asked))
out, asked = _warn_pass(at(DAY, "08:41"), rows=[TOLD_ROW], read_at=T21, last_done=T21)
check("V1-PPL-01: and at 08:41 it reads the clock for the warning — outside both purses, which it does not spend",
      asked == [at(DAY, "08:41")] and pa._S["follow_ups"]["n"] == pa.FOLLOW_UP_DAY_MAX
      and pa._S["follow_ups"]["by_shift"][W_SID] == pa.FOLLOW_UPS_PER_SHIFT, (out, asked, pa._S.get("follow_ups")))
out, asked = _warn_pass(ACK_AT + timedelta(minutes=25), rows=[recv], read_at=ACK_AT, last_done=ACK_AT)
check("V1-PPL-01: a RECEIVED 25 minutes after the latest read gets its read on the same beat",
      asked == [ACK_AT + timedelta(minutes=25)], (out, asked))
out, asked = _warn_pass(at(DAY, "15:05"), rows=[TOLD_ROW], read_at=T21, last_done=T21)
check("and once the shift has ended the warning asks for nothing more",
      not asked, (out, asked))
pa._S.clear()
pp.forget()

# AND THE READ IT ASKED FOR IS THE ONE THE CALL OFF STANDS ON.
import calendar_builder_houses as cbh  # noqa: E402

made = []
RECV_ROW = dict(RECEIVED_ROW, call_off_ref="")
late = ACK_AT + timedelta(minutes=25)
stale_pair = [dict(PAIR_OK[0])]
fresh_pair = [dict(PAIR_OK[0], read_at=(late + timedelta(minutes=1)).astimezone(OHIO).isoformat())]
with _Swap(sr, estate=lambda *_a, **_k: one_tab), \
        _Swap(cbh, mark_call_off=lambda _dsn, **kw: made.append(kw) or {
            "ref": "SPBBBBBBBBBB", "window": {"why": "open to all staff for 5 hours from the call-off"}}):
    cur = _Cur([RECV_ROW])
    with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
        first = pp.convert("dsn", "dana|x", now=late, paired=stale_pair)
    made_first = len(made)
    cur = _Cur([RECV_ROW])
    with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
        second = pp.convert("dsn", "dana|x", now=late + timedelta(minutes=1), paired=fresh_pair)
check("V1-PPL-01: a RECEIVED answered 25 minutes after a read waits for the read it asked for, and converts on "
      "it — before the shift ends, through the calendar's own act",
      first.get("waiting") == pp.WAIT_READ and made_first == 0 and second.get("state") == pp.CONVERTED
      and len(made) == 1 and made[0]["col_iso"] == DAY.isoformat(), (first, second, made))

# A DOUBLE WALKS IT TWICE: each shift's warning is told, and asks for its own reads, on its own.
dbl_w1 = dict(W1, state=pp.WARNED, tells=2, told_at=at(DAY, "09:00"), shift_at=at(DAY, "07:00"),
              shift_end=at(DAY, "15:00"))
dbl_w2 = dict(W2, state=pp.WARNED, tells=0, told_at=None)
got = _wanted([dbl_w1], at(DAY, "09:05"), at(DAY, "09:00"))
check("a double: its first shift's warning asks for its own reads while that shift runs",
      [s["id"] for s in got["shifts"]] == [W1["id"]], got)
got = _wanted([dict(dbl_w1, state=pp.GAVE_UP), dbl_w2], at(DAY, "16:00"), at(DAY, "15:30"))
check("and its second shift's warning, of its own, asks for its reads after the first stopped — never folded",
      [s["id"] for s in got["shifts"]] == [W2["id"]], got)
dbl16_live = dict(W2, state=pp.WARNED, tells=0, told_at=None, person_key=dbl_16[1]["person_key"],
                  day=DAY.isoformat())
cur = _Cur(routes=[("AND opened_at >=", [dict(dbl_w1, state=pp.GAVE_UP), dbl16_live]), ("FROM asa_punch_said", []),
                   ("SELECT id, state, call_off_ref", [])])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), directors=lambda _dsn: ["Cal Sample", "Ann Q. Example"]):
    got = pp.owed("dsn", now=at(DAY, "16:00"), paired=dbl_16)
second_told = [r for r in got if r["kind"] in pp.WARNING_KINDS]
check("a double: at 16:00 the second shift is told to every director under its own ref, and the first — "
      "stopped with its shift — is not told again",
      sorted(r["person"] for r in second_told) == ["Ann Q. Example", "Cal Sample"]
      and all(r["ref"] == W2["ref"] and r["shift_code"] == "3p-11p" and r["kind"] == pp.K_WARNING
              for r in second_told), got)
pp.forget()


# ── 13. the reminders' ledger: what REACHED the person ─────────────────────

print("\n-- the reminders' ledger --")

state = TMP / "reminders.json"
pr._R.clear()
state.write_text(json.dumps({"ledger": {
    "login_missing|danareed|a|k2": {"state": "told", "kind": "login_missing", "shift_id": "dana|x"},
    "login_missing|danareed|a|k3": {"state": "recorded", "kind": "login_missing", "shift_id": "dana|x"},
    "login_missing|danareed|a|k4": {"state": "rehearsed", "kind": "login_missing", "shift_id": "dana|x"},
    "login_missing|danareed|a|k5": {"state": "duplicate", "kind": "login_missing", "shift_id": "dana|x"},
    "login_before|danareed|a|T-5": {"state": "told", "kind": "login_before", "shift_id": "dana|x"},
}, "stopped": {}}))
check("PPL-06: only what was told or deduplicated counts as reaching the person — never recorded or rehearsed",
      pr.delivered_count("dana|x") == 2 and pp.delivered_count("dana|x") == 2,
      pr.delivered_count("dana|x"))
check("and the reminder before the shift is counted when asked for",
      pp.delivered_count("dana|x", pp.LOGIN_KINDS) == 3)
pr._R.clear()
state.write_text("{not json")
exc = refusal(lambda: pp.delivered_count("dana|x"))
check("an unreadable ledger is Unreadable — never 'asked nobody', never 'asked enough'",
      isinstance(exc, pp.Unreadable), exc)
exc = refusal(lambda: pp._stopped())
check("and the reasons the cadence stopped are Unreadable too, never an empty list",
      isinstance(exc, pp.Unreadable), exc)
pr._R.clear()
state.write_text(json.dumps({"ledger": {}, "stopped": {}}))
pr._load()
due_id = "login_missing|danareed|2026-09-22T11:00:00+00:00|k2"
pr._R["due"] = [{"id": due_id, "kind": "login_missing", "shift_id": "dana|x", "person_key": "danareed"}]
pr.posted([due_id], {"results": [{"id": due_id, "state": "no_contact", "code": "no_person"}]},
          NOON.timestamp())
check("PPL-16: the door's `no_person` travels into the reason the cadence stopped",
      pr.stopped_why().get("dana|x", {}).get("code") == "no_person", pr.stopped_why())
check("a text quoting a warning's ref is the ear's, never a reply that stops somebody's chase",
      pr.ELSEWHERE_RE.search("RECEIVED PW0123456789") is not None)
pr._R.clear()


# ── 14. the punch board shows the pairs and the warnings ───────────────────

print("\n-- the punch board --")

pp.forget()
pp.note(miss, index_of([]), RECENT, MORNING, read_at=MORNING)
unread = pp.board_status(MORNING)
check("PPLV-06: warnings never read are NOT zero warnings — the card is unreadable and says why",
      unread["readable"] is False and unread["warnings"] == [] and unread["warnings_at"] == ""
      and "have not been read" in unread["why"], unread)
pp._warnings_failed("OperationalError")
unread = pp.board_status(MORNING)
check("PPLV-06: and a read that keeps failing says it failed, still with no count",
      unread["readable"] is False and "could not be read (OperationalError)" in unread["why"], unread)
cur = _Cur([])


def _broken(_dsn, **_k):
    raise RuntimeError("the database went away")


with _Swap(pp, _connect=lambda _dsn: _Conn(cur), warning_rows=_broken, open_warnings=lambda *a, **k: {},
           retry_conversions=lambda *a, **k: {}, _said=lambda _dsn: {}):
    pp.forget()
    pp.note(miss, index_of([]), RECENT, MORNING, read_at=MORNING)
    pp.owed("dsn", now=MORNING)
check("PPLV-06: owed() records a failed read of the warnings on the card",
      pp.board_status(MORNING)["readable"] is False
      and "RuntimeError" in pp.board_status(MORNING)["why"], pp.board_status(MORNING))
pp._remember_warnings([], MORNING)
check("PPLV-06: a read that lands with nothing in it is the only way the card says none",
      pp.board_status(MORNING)["readable"] is True and pp.board_status(MORNING)["warnings"] == []
      and pp.board_status(MORNING)["warnings_at"], pp.board_status(MORNING))
pp._warnings_failed("OperationalError")
check("PPLV-06: a read that fails after one that landed keeps the list and says it failed",
      pp.board_status(MORNING)["readable"] is True
      and "failed (OperationalError)" in pp.board_status(MORNING)["warnings_why"], pp.board_status(MORNING))
pp._remember_warnings([dict(WARN, id=fresh_pairs[0]["id"], state=pp.GAVE_UP,
                            why="said 6 time(s) with no RECEIVED", opened_at=MORNING)], MORNING)
m = pp.marks().get(fresh_pairs[0]["id"], {})
check("PPL-15: each shift on the board carries its pair verdict, whether it is a fault, and why",
      m.get("pair") == pp.MISSING and m.get("pair_fault") is True and m.get("pair_why"), m)
check("and the warning on it, with its state and its reason",
      m.get("warning_state") == pp.GAVE_UP and m.get("warning_ref") and "RECEIVED" in m.get("warning_why"), m)
bs = pp.board_status(MORNING)
check("the board's card lists every warning the last post read, the ones that stopped included",
      bs["stale"] == "" and bs["paired_at"] and len(bs["warnings"]) == 1
      and bs["warnings"][0]["state"] == pp.GAVE_UP and bs["warnings"][0]["why"], bs)
check("and a stale pairing says so on the card rather than showing old verdicts as today's",
      pp.board_status(MORNING + timedelta(seconds=pp.STALE_S + 60))["stale"])
pp._remember_warnings([dict(WARN, id="a|1", tells=7, delivered=7, first_said_at=at(DAY, "09:00"),
                            last_said_at=at(DAY, "11:00"),
                            said={"last": {"answers": [{"who": "calsample", "state": "told"}]}}),
                       dict(WARN, id="b|2", tells=0, delivered=0, said={"last": {"answers": [
                           {"who": "calsample", "state": "held", "code": "situation_off",
                            "why": "the situation shift_punch_warning is off or absent"}]}})], MORNING)
card = {w["id"]: w for w in pp.board_status(MORNING)["warnings"]}
check("C13: the card gives each live warning the real span it was said over",
      card["a|1"]["span"] == "it was said 7 time(s) over 120 minutes, from 09:00 to 11:00"
      and card["a|1"]["unheard"] == "", card.get("a|1"))
check("C13: and a warning the situation held says why nobody was told, rather than \"not told yet\" alone",
      "is off or absent" in card["b|2"]["unheard"] and card["b|2"]["span"] == "it was never said to a director",
      card.get("b|2"))
pp._remember_warnings([dict(WARN, id=fresh_pairs[0]["id"], state=pp.GAVE_UP,
                            why="said 6 time(s) with no RECEIVED", opened_at=MORNING)], MORNING)
import punch_board_slices as pbs  # noqa: E402

projected = pbs.project({"status": {"pairs": bs}, "rows": [dict(
    {"row_kind": "shift", "id": fresh_pairs[0]["id"], "person": "Dana Reed"}, **m)]})
check("the slice carries the pair fields and the card through its allow-list",
      projected[0].get("pairs", {}).get("warnings") and projected[1].get("pair") == pp.MISSING
      and projected[1].get("warning_state") == pp.GAVE_UP, projected)
pp.forget()


# ── 14b. the Hub's RECEIVED door (PPLV-09) ─────────────────────────────────

print("\n-- the Hub's RECEIVED door --")

import ast  # noqa: E402
import asyncio  # noqa: E402
import logging  # noqa: E402

_tree = ast.parse(SVC_TEXT)
_wanted = {"_PUNCH_RECEIVED_STATUS", "lane_punch_warning_received"}
_nodes = [n for n in _tree.body
          if getattr(n, "name", "") in _wanted
          or (isinstance(n, ast.Assign) and any(getattr(t, "id", "") in _wanted for t in n.targets))]
check("the RECEIVED door and its status map are found in the relay", len(_nodes) == 2, len(_nodes))


class _App:
    def post(self, _path):
        return lambda f: f


class _Body:
    def __init__(self, body):
        self.body = body

    async def json(self):
        return self.body


SESSIONS = {"cal": {"name": "Cal Sample", "role": "staff"}, "ann": {"name": "Ann Example", "role": "staff"},
            "dana": {"name": "Dana Reed", "role": "staff"},
            "main": {"name": "Main Account", "role": "admin", "is_master": True},
            "main_unnamed": {"name": "", "role": "admin", "is_master": True},
            "main_badge": {"name": "Main Account", "role": "admin", "badges": ["MASTER"], "is_master": False}}


async def _viewer(authorization):
    if authorization not in SESSIONS:
        return {"status": 401, "reason": "auth", "message": "sign in"}
    return SESSIONS[authorization], ("staff", "u-" + authorization)


door_ns = {"app": _App(), "Header": lambda default="": default, "Request": object, "Any": object,
           "asyncio": asyncio, "log": logging.getLogger("test"), "PG_DSN": "postgresql://nowhere",
           "_requests_viewer": _viewer}
exec(compile(ast.Module(body=_nodes, type_ignores=[]), "snapshot_service.punch_door", "exec"), door_ns)
DOOR = door_ns["lane_punch_warning_received"]


def _door(auth, body, *, rows=(WARNING_ROW,), names=("Cal Sample", "Ann Q. Example"), conv=fake_convert,
          paired=PAIR_OK, directors_fn=None):
    cur_ = _Cur(list(rows))
    real = pp.acknowledge

    def _ack(dsn, **kw):
        kw.setdefault("paired", paired)
        kw.setdefault("now", ACK_AT)
        return real(dsn, **kw)

    with _Swap(pp, _connect=lambda _dsn: _Conn(cur_), convert=conv, acknowledge=_ack,
               directors=directors_fn or (lambda _dsn: list(names))):
        got_ = asyncio.run(DOOR(_Body(body), authorization=auth))
    return got_, cur_


got, cur = _door("nobody", {"ref": "PW0123456789"})
check("PPLV-09: signed out, the door refuses before anything is read", got.get("status") == 401
      and not cur.sql, (got, cur.sql))
got, cur = _door("cal", {"ref": "not a ref"})
check("PPLV-09: a body with no warning ref is a bad request", got.get("status") == 400 and not cur.sql, got)
got, cur = _door("dana", {"ref": "PW0123456789"})
check("PPLV-09: a reader who is not on the directors list is refused 403, nothing written",
      got.get("status") == 403 and got.get("reason") == "not_a_director" and not cur.updates(), got)
got, cur = _door("main", {"ref": "PW0123456789"})
check("the master's own Hub session answers RECEIVED as a director does, recorded under the session's name",
      got.get("status") == 200 and got["data"]["state"] == pp.CONVERTED
      and any("received_by" in s and "Main Account" in str(a) for s, a in cur.sql), got)
got, cur = _door("main_unnamed", {"ref": "PW0123456789"})
check("…and with no roster name it is recorded under the account, never blank",
      got.get("status") == 200 and any("received_by" in s and "account u-main_unnamed" in str(a) for s, a in cur.sql),
      got)
got, cur = _door("main_badge", {"ref": "PW0123456789"})
check("…while a MASTER badge word without the session's flag is not a director",
      got.get("status") == 403 and got.get("reason") == "not_a_director" and not cur.updates(), got)
cur = _Cur([WARNING_ROW])
exc = refusal(lambda: ack(cur, ["Cal Sample"], by="Main Account", ref="PW0123456789", via="sms", master=True))
check("…and a text never carries the master's flag: an SMS RECEIVED from a name off the list converts nothing",
      isinstance(exc, pp.Refused) and exc.code == "not_a_director" and not cur.updates(), exc)
got, cur = _door("cal", {"ref": "PW0123456789"}, rows=(dict(WARNING_ROW, delivered=0),))
check("PPLV-09: a warning whose tellings never reached a phone is 409 never_delivered",
      got.get("status") == 409 and got.get("reason") == "never_delivered" and not cur.updates(), got)


def _list_down(_dsn):
    raise pp.Unreadable("the directors list on the Time Off settings is blank")


got, cur = _door("cal", {"ref": "PW0123456789"}, directors_fn=_list_down)
check("PPLV-09: an unreadable directors list is 503, says nothing was done, and promises no retry it "
      "cannot keep", got.get("status") == 503 and "nothing was done" in got.get("message", "")
      and "few minutes" not in got.get("message", "") and not cur.updates(), got)
got, cur = _door("cal", {"ref": "PW0123456789"}, paired=old, conv=_waits)
check("PPLV-09: with no fresh read the Hub records the RECEIVED and says the shift opens at the next read",
      got.get("status") == 200 and got["data"]["state"] == pp.RECEIVED
      and "next read of the time clock" in got["data"]["words"]
      and any(pp.RECEIVED in a for s, a in cur.updates()), got)
got, cur = _door("ann", {"ref": "PW0123456789"})
check("PPLV-01/09: the director listed as \"Ann Q. Example\" answers from her Hub session as \"Ann Example\"",
      got.get("status") == 200 and got["data"]["state"] == pp.CONVERTED
      and got["data"]["call_off_ref"] == "SPAAAAAAAAAA", got)
got, cur = _door("cal", {"ref": "PW0123456789"}, paired=[dict(PAIR_OK[0], verdict=pp.OPEN, fault=False)])
check("PPLV-09: a read that shows a clock-in refuses it 409 stood_down and closes the warning",
      got.get("status") == 409 and got.get("reason") == "stood_down"
      and any(pp.CLOSED in a for s, a in cur.updates()), got)
got, cur = _door("cal", {"ref": "PW0123456789"},
                 rows=(dict(WARNING_ROW, tells=7, delivered=7, told_at=ACK_AT - timedelta(minutes=3)),))
check("PPLV-12: on the Hub, a RECEIVED minutes after the seventh telling opens the shift — the button is "
      "never taken away by a count",
      got.get("status") == 200 and got["data"]["state"] == pp.CONVERTED, got)
got, cur = _door("cal", {"ref": "PW0123456789"}, conv=_explodes)
check("PPLV-15: on the Hub, a conversion that fails unforeseen is 200 \"on file, tried again\" — never a "
      "503 saying nothing was done after the answer was recorded",
      got.get("status") == 200 and got["data"]["state"] == pp.RECEIVED
      and "on file" in got["data"]["words"] and "tried again" in got["data"]["words"]
      and any(pp.RECEIVED in a for s, a in cur.updates()), got)


# ── 14c. a director's acknowledgement is facts, in its own situation (PPLV-11) ──

print("\n-- the director's acknowledgement --")

check("PPLV-11: the relay writes no acknowledgement sentence for a text — each outcome is its own "
      "situation, and the ear's kinds are known to the door",
      set(sms_ears.ACK_PUNCH) == set(pp.ACK_OUTCOMES)
      and all(k in sms_ears.ACK_KINDS for k in sms_ears.ACK_PUNCH_KINDS))
ACK_ROW = {"id": "t9", "ack": "sms_reply_punch_open", "person": "Cal Sample", "ref": "PW0123456789",
           "ack_why": "open to all staff for 5 hours from the call-off", "location": "", "col_iso": "",
           "value": "", "handoff_id": ""}
STORED = dict(WARN, state=pp.CONVERTED, call_off_ref="SPAAAAAAAAAA")
d = sms_ears.door_row(ACK_ROW, STORED)
check("PPLV-11: the acknowledgement row carries facts only — the refs, the one reason, and the shift from "
      "the warning — and no {reply} sentence",
      d["kind"] == "sms_reply_punch_open" and d["id"] == "SMS|t9:sms_reply_punch_open"
      and d["ref"] == "PW0123456789" and d["call_off_ref"] == "SPAAAAAAAAAA"
      and d["why"] == ACK_ROW["ack_why"] and d["staff"] == "Dana Reed" and d["shift_code"] == "7a-3p"
      and d["house_name"] == "JH home" and d["mail"] is False and "reply" not in d, d)


def _ears_owed(rows, *, warning):
    cur_ = _Cur(routes=[("to_regclass", [{"here": True}]), ("FROM asa_sms_replies", list(rows))])
    with _Swap(sms_ears, _connect=lambda _dsn: _Conn(cur_)), _Swap(pp, warning_by_ref=warning):
        got_ = attempt(lambda: sms_ears.owed("dsn", now=NOON))
    return got_, cur_


STORED_ACK = dict(ACK_ROW, said={}, heard_at=NOON, sent_at=NOON)
got, cur = _ears_owed([STORED_ACK], warning=lambda _dsn, _ref: STORED)
check("PPLV-11: the ear offers it with the call off's ref read from the warning as it stands",
      isinstance(got, list) and len(got) == 1 and got[0]["call_off_ref"] == "SPAAAAAAAAAA", got)
got, cur = _ears_owed([STORED_ACK], warning=lambda _dsn, _ref: None)
check("PPLV-11: a warning no longer on file has nothing to acknowledge — expired, and said why",
      got == [] and any("no longer on file" in str(a) for s, a in cur.sql if "expired" in s), (got, cur.sql))


def _warning_down(_dsn, _ref):
    raise RuntimeError("the database went away")


got, cur = _ears_owed([STORED_ACK], warning=_warning_down)
check("PPLV-11: a warning that could not be read leaves the acknowledgement owed — never sent without "
      "its facts, never expired", got == [] and not any(s.lower().startswith("update") for s, _a in cur.sql),
      (got, cur.sql))
check("PPLV-11: the closed and the waiting outcomes carry their one reason",
      pp.received_ack({"state": pp.CLOSED, "why": "the shift ended before it could be opened"})
      == (pp.ACK_CLOSED, "the shift ended before it could be opened")
      and pp.received_ack({"state": pp.RECEIVED, "why": "the house calendar could not be read"})[0]
      == pp.ACK_WAITING)

# PPLV-17: SWITCHED OFF, AN ACKNOWLEDGEMENT IS NOT SENT AT ALL — NEVER HOURS LATER.
ACK_KEY = f"{sms_ears.ACK_ID_PREFIX}t9:sms_reply_punch_open"


def _ack_marked(answer):
    cur_ = _Cur([])
    with _Swap(sms_ears, _connect=lambda _dsn: _Conn(cur_)):
        sms_ears.mark_said("dsn", [ACK_KEY], {"dial": "send", "test_mode": "off",
                                              "results": [dict(answer, id=ACK_KEY)]})
    return [(s, a) for s, a in cur_.sql if s.lower().startswith("update asa_sms_replies")]


for code in ("situation_off", "no_words"):
    ups = _ack_marked({"state": "held", "code": code, "why": "the situation shift_reply_punch_open is off"})
    check(f"PPLV-17: an acknowledgement its situation held (`{code}`) is written down AND written off at "
          "once — a switch turned on later finds no stale \"Got it\" to send",
          len(ups) == 2 and "'expired'" in ups[1][0] and ups[1][1][1] == "t9", ups)
for label, answer in (("a situations tab that could not be read",
                       {"state": "held", "code": "situation_unread",
                        "why": "the situations tab could not be read (timeout)"}),
                      ("a held with no code, from an engine that gives none",
                       {"state": "held", "why": "the situation shift_reply_punch_open is off or absent"}),
                      ("the send door holding the lane", {"state": "held", "why": "HUB_RPC_SEND is off"})):
    ups = _ack_marked(answer)
    check(f"PPLV-17: but {label} is never read as off — the acknowledgement stays owed",
          len(ups) == 1 and "'expired'" not in ups[0][0], ups)
got, cur = _ears_owed([dict(STORED_ACK, said={"expired": "its situation held it when it was due"})],
                      warning=lambda _dsn, _ref: STORED)
check("PPLV-17: and a written-off acknowledgement is not offered again",
      any("NOT (said ? 'expired')" in s for s, _a in cur.sql), cur.sql)


# ── 14d. what is held is said at 08:00 only if still true (V2R2-1) ─────────

print("\n-- a held acknowledgement, at 08:00 --")

EVE = DAY
NEXT_8 = at(DAY + timedelta(days=1), "08:00")
HEARD_2150 = at(EVE, "21:50")
W_EVE = dict(WARN, shift_code="3p-11p", shift_at=at(EVE, "15:00"), shift_end=at(EVE, "23:00"),
             received_by="Cal Sample")
W_OVERNIGHT = dict(W_EVE, shift_code="11p-11a", shift_at=at(EVE, "23:00"),
                   shift_end=at(DAY + timedelta(days=1), "11:00"))


def _ears_owed_at(rows, now, *, warning):
    cur_ = _Cur(routes=[("to_regclass", [{"here": True}]), ("FROM asa_sms_replies", list(rows))])
    with _Swap(sms_ears, _connect=lambda _dsn: _Conn(cur_)), _Swap(pp, warning_by_ref=warning), \
            _Swap(sms_ears.shift_requests, pool=lambda *_a, **_k: []):
        got_ = attempt(lambda: sms_ears.owed("dsn", now=now))
    return got_, cur_


def _expired(cur_):
    """The write-offs the ear made: (why, reply id) per acknowledgement."""
    return [a for s, a in cur_.sql if s.lower().startswith("update asa_sms_replies") and "'expired'" in s]


def _held(ack, **over):
    return dict({"id": "t21", "ack": ack, "person": "Cal Sample", "ref": "PW0123456789",
                 "ack_why": "it opens at the next read of the time clock, if that read still shows no punch",
                 "location": "", "col_iso": "", "value": "", "handoff_id": "", "road": sms_ears.ROAD_PUNCH,
                 "said": {}, "heard_at": HEARD_2150, "sent_at": HEARD_2150}, **over)


WAITING_ACK = _held("sms_reply_punch_waiting")
got, cur = _ears_owed_at([WAITING_ACK], NEXT_8,
                         warning=lambda _d, _r: dict(W_EVE, state=pp.CONVERTED, call_off_ref="SPAAAAAAAAAA"))
check("V2R2-1: a \"not open yet\" heard at 21:50 and held to 08:00, whose warning converted overnight, is "
      "written off — never offered with the words of the moment it was heard",
      got == [] and _expired(cur) and "now converted" in _expired(cur)[0][0], (got, cur.sql))
got, cur = _ears_owed_at([WAITING_ACK], NEXT_8, warning=lambda _d, _r: dict(W_EVE, state=pp.RECEIVED))
check("V2R2-1: and one whose warning still waits but whose 3p-11p shift ended at 23:00 is written off too",
      got == [] and _expired(cur) and "shift had ended" in _expired(cur)[0][0], (got, cur.sql))
got, cur = _ears_owed_at([WAITING_ACK], NEXT_8, warning=lambda _d, _r: dict(W_OVERNIGHT, state=pp.RECEIVED))
check("V2R2-1: but one still true at 08:00 — the answer still waits, its shift still runs — is said then",
      isinstance(got, list) and [r["kind"] for r in got] == ["sms_reply_punch_waiting"] and not _expired(cur),
      (got, cur.sql))
OPENED_ACK = _held("sms_reply_punch_open", ack_why="open to all staff for 5 hours from the call-off")
got, cur = _ears_owed_at([OPENED_ACK], NEXT_8,
                         warning=lambda _d, _r: dict(W_EVE, state=pp.CONVERTED, call_off_ref="SPAAAAAAAAAA"))
check("V2R2-1: \"now an open shift ... for 5 hours\" about a shift that ended overnight is written off",
      got == [] and _expired(cur) and "shift had ended" in _expired(cur)[0][0], (got, cur.sql))
got, cur = _ears_owed_at([OPENED_ACK], NEXT_8,
                         warning=lambda _d, _r: dict(W_OVERNIGHT, state=pp.CONVERTED, call_off_ref="SPAAAAAAAAAA"))
check("V2R2-1: and said at 08:00 while its shift still runs",
      isinstance(got, list) and [r["kind"] for r in got] == ["sms_reply_punch_open"], (got, cur.sql))
UNCLEAR_ACK = _held(sms_ears.ACK_UNCLEAR, ack_why="your text named PW0123456789 but was not a plain RECEIVED - "
                                                  "to open the shift, reply RECEIVED PW0123456789")
got, cur = _ears_owed_at([UNCLEAR_ACK], NEXT_8, warning=lambda _d, _r: dict(W_EVE, state=pp.GAVE_UP))
check("V2R2-1: \"reply RECEIVED {ref} to open the shift\" after the shift ended is written off",
      got == [] and _expired(cur) and "still waits for an answer" in _expired(cur)[0][0], (got, cur.sql))
got, cur = _ears_owed_at([UNCLEAR_ACK], NEXT_8, warning=lambda _d, _r: dict(W_OVERNIGHT, state=pp.WARNED))
check("V2R2-1: and said while the warning it names still waits and its shift runs",
      isinstance(got, list) and [r["kind"] for r in got] == [sms_ears.ACK_UNCLEAR], (got, cur.sql))
refs_read = []
REFUSED_BARE = _held(sms_ears.ACK_REFUSED, ref="",
                     ack_why="the warning PW0123456789 has not reached a director's phone yet - it was only "
                             "rehearsed or held - so nothing was done")
got, cur = _ears_owed_at([REFUSED_BARE], NEXT_8,
                         warning=lambda _d, r: refs_read.append(r) or dict(W_EVE, state=pp.WARNED))
check("V2R2-1: a refusal of a bare RECEIVED reads the warning its reason names, and is written off once that "
      "shift has ended",
      got == [] and refs_read == ["PW0123456789"] and _expired(cur), (got, refs_read, cur.sql))
CLOSED_EAR = _held("sms_reply_punch_closed", ack_why="the shift ended before it could be opened")
got, cur = _ears_owed_at([CLOSED_EAR], NEXT_8, warning=lambda _d, _r: dict(W_EVE, state=pp.CLOSED))
check("V2R2-1: a closing stays true — held overnight, it is said at 08:00",
      isinstance(got, list) and [r["kind"] for r in got] == ["sms_reply_punch_closed"], (got, cur.sql))
got, cur = _ears_owed_at([dict(UNCLEAR_ACK, road="")], NEXT_8,
                         warning=lambda _d, _r: dict(W_EVE, state=pp.GAVE_UP))
check("an unclear acknowledgement from another road reads no warning at all",
      isinstance(got, list) and len(got) == 1, (got, cur.sql))
check("V2R2-1: the truth test itself, pure — a waiting answer the calendar still refuses, shift running, is true",
      sms_ears.punch_ack_true("sms_reply_punch_waiting", [dict(W_OVERNIGHT, state=pp.RECEIVED)], NEXT_8) == (True, "")
      and sms_ears.punch_ack_true(sms_ears.ACK_REFUSED, [], NEXT_8) == (True, ""))


# ── 14e. a shared cell on a stale read, and what a waiting answer came to ──

print("\n-- what a RECEIVED told it waits came to (V1R2-PPL-1/2, V2R2-2) --")

STALE_AT = ACK_AT + timedelta(minutes=pp.FRESH_READ_MIN + 5)
RECV_SPLIT = dict(RECEIVED_ROW, call_off_ref="", said={})
cur = _Cur([RECV_SPLIT])
estate_reads.clear()
with _Swap(pp, _connect=lambda _dsn: _Conn(cur)), \
        _Swap(sr, estate=lambda *_a, **_k: estate_reads.append(1) or {}):
    got = pp.convert("dsn", "dana|x", now=STALE_AT, paired=SPLIT)
check("V1R2-PPL-1 / V2R2-2: a shared cell answered on a read 25 minutes old closes at once as \"open it by "
      "hand\" — never \"it opens at the next read\" about a shift no read will open",
      got["state"] == pp.CLOSED and got.get("code") == pp.SPLIT_CELL and got.get("waiting") != pp.WAIT_READ
      and pp.received_ack(got)[0] == pp.ACK_CLOSED and "by hand" in pp.received_ack(got)[1]
      and not estate_reads, got)
cur = _Cur(routes=[("state = ANY", [WARNING_ROW]), ("WHERE id=%s", [RECV_SPLIT])])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), directors=lambda _dsn: ["Cal Sample"]):
    got = attempt(lambda: pp.acknowledge("dsn", by="Cal Sample", ref="PW0123456789", now=STALE_AT, paired=SPLIT))
check("V1R2-PPL-1: through the answer itself, the director is told CLOSED, by hand, on the spot — and nothing "
      "is owed later, because nothing was said to wait",
      isinstance(got, dict) and got.get("state") == pp.CLOSED and pp.received_ack(got)[0] == pp.ACK_CLOSED
      and not any("jsonb_build_object('waiting_ack'" in s for s, _a in cur.updates()), (got, cur.updates()))
clocked_split = [dict(SPLIT[0], verdict=pp.OPEN, fault=False), SPLIT[1]]
cur = _Cur([RECV_SPLIT])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
    got = pp.convert("dsn", "dana|x", now=STALE_AT, paired=clocked_split)
check("and a shared cell whose person clocked in is closed for the punch — never told to be opened by hand",
      got["state"] == pp.CLOSED and "clocked in" in got["why"] and "by hand" not in got["why"], got)

# THE ANSWER TOLD "NOT OPEN YET" IS MARKED, IN A WRITE THAT LANDS ONLY WHILE IT STILL WAITS.
cur = _Cur(routes=[("state = ANY", [WARNING_ROW]), ("WHERE id=%s", [RECEIVED_ROW])])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), convert=_waits, directors=lambda _dsn: ["Cal Sample"]):
    got = attempt(lambda: pp.acknowledge("dsn", by="Cal Sample", ref="PW0123456789", now=ACK_AT, paired=old))
marks_ = [(s, a) for s, a in cur.updates() if "jsonb_build_object('waiting_ack'" in s]
check("V1R2-PPL-2: a RECEIVED told it waits is marked on the row, only while it is still RECEIVED with no call off",
      isinstance(got, dict) and got.get("state") == pp.RECEIVED and marks_
      and "state=%s AND call_off_ref=''" in marks_[0][0] and marks_[0][1][2] == pp.RECEIVED
      and json.loads(marks_[0][1][0])["at"], (got, cur.updates()))


class _CurMissing(_Cur):
    """A cursor whose UPDATEs holding `word` change no row — another pass got there first."""

    def __init__(self, rows=None, routes=None, *, word=""):
        super().__init__(rows, routes)
        self.word = word

    def execute(self, sql, args=()):
        super().execute(sql, args)
        self.rowcount = 0 if self.word and self.word in str(sql) else 1


CONV_ROW = dict(RECEIVED_ROW, state=pp.CONVERTED, call_off_ref="SPAAAAAAAAAA", converted_at=ACK_AT,
                shift_at=ACK_AT + timedelta(hours=9))
cur = _CurMissing(routes=[("state = ANY", [WARNING_ROW]), ("WHERE id=%s", [CONV_ROW])], word="'waiting_ack'")
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), convert=_waits, directors=lambda _dsn: ["Cal Sample"]):
    got = attempt(lambda: pp.acknowledge("dsn", by="Cal Sample", ref="PW0123456789", now=ACK_AT, paired=old))
check("V1R2-PPL-2: a row another pass converted between the answer and the mark is reported as it stands — the "
      "open shift and its window, now, and nothing owed twice",
      isinstance(got, dict) and got.get("state") == pp.CONVERTED and got.get("call_off_ref") == "SPAAAAAAAAAA"
      and pp.received_ack(got)[0] == pp.ACK_OPENED and "5 hours" in pp.received_ack(got)[1], got)

# THE WRITE THAT RESOLVES IT OWES THE FOLLOW-UP, IN THE SAME STATEMENT.
cur = _Cur([])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
    pp._note_conversion("dsn", "dana|x", ref="SPAAAAAAAAAA", why="born from a punch warning", at=NOON,
                        ack_why="open to all staff for 5 hours from the call-off")
conv_sql = cur.updates()
check("V1R2-PPL-2: the conversion owes the open acknowledgement exactly when the row says it was told it "
      "waits — in the write that converts it — and lets the claim go",
      conv_sql and "said ? 'waiting_ack'" in conv_sql[0][0] and "'open_ack'" in conv_sql[0][0]
      and "said - 'converting'" in conv_sql[0][0]
      and json.loads(conv_sql[0][1][4])["why"] == "open to all staff for 5 hours from the call-off", conv_sql)
cur = _Cur([])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
    pp._stand_down("dsn", "dana|x", why="the shift was not opened - they clocked in", now=NOON)
down_sql = cur.updates()
check("V1R2-PPL-2: every closing of an answered warning owes the closed acknowledgement when it was told it "
      "waits — the punch, the estate's final answer, the shared cell, not only the cap",
      down_sql and "OR said ? 'waiting_ack'" in down_sql[0][0] and down_sql[0][1][3] is False
      and "clocked in" in json.loads(down_sql[0][1][4])["why"] and "said - 'converting'" in down_sql[0][0],
      down_sql)
recv_live = [{"id": missed[0]["id"], "state": pp.RECEIVED, "call_off_ref": ""}]
counts, cur = _opened(late_in, at(DAY, "10:30"), live=recv_live)
recv_close = [(s, a) for s, a in cur.updates() if pp.CLOSED in a]
check("V1R2-PPL-2: a waiting answer the punch closes on the pairing beat owes the closing too, and never "
      "under a pass that is making its call off",
      counts["closed"] == 1 and recv_close and "said ? 'waiting_ack'" in recv_close[0][0]
      and "NOT (said ? 'converting')" in recv_close[0][0] and "not opened" in str(recv_close[0][1]), cur.sql)

OPEN_OWED = dict(CONV_ROW, shift_end=NOON + timedelta(hours=3),
                 said={"open_ack": {"why": "open to all staff for 5 hours from the call-off",
                                    "at": NOON.astimezone(UTC).isoformat()}})
opens = pp._follow_ack_rows([OPEN_OWED], {}, NOON + timedelta(minutes=1))
check("V1R2-PPL-2: a waiting answer a later try opened is one row to that director, in the open "
      "acknowledgement's situation, with the call off's ref and the window — facts only",
      len(opens) == 1 and opens[0]["kind"] == pp.K_OPEN_ACK == "sms_reply_punch_open"
      and opens[0]["person"] == "Cal Sample" and opens[0]["call_off_ref"] == "SPAAAAAAAAAA"
      and "5 hours" in opens[0]["why"] and opens[0]["id"] == f"sms_reply_punch_open|{OPEN_OWED['id']}"
      and opens[0]["mail"] is False, opens)
check("V1R2-PPL-2: never after its shift ended — an open shift that is over is not news",
      pp._follow_ack_rows([OPEN_OWED], {}, NOON + timedelta(hours=3)) == [])
check("V1R2-PPL-2: said once, never again; switched off when due, written off",
      pp._follow_ack_rows([OPEN_OWED], {opens[0]["id"]: told_entry}, NOON + timedelta(minutes=30)) == []
      and pp._follow_ack_rows([OPEN_OWED], {opens[0]["id"]: off_entry}, NOON + timedelta(minutes=30)) == [])
check("V1R2-PPL-2: a conversion nobody was told to wait for owes nothing",
      pp._follow_ack_rows([dict(OPEN_OWED, said={})], {}, NOON + timedelta(minutes=1)) == [])
check("the open acknowledgement is a kind of this lane, written to its own ledger like the closing",
      pp.K_OPEN_ACK in pp.KINDS and pp.K_CLOSED_ACK in pp.KINDS)
people_reads = []
with _Swap(pp, _people=lambda: people_reads.append(1) or [{"name": "Cal Q. Sample"}, {"name": "Ann Roe"}]):
    spelled = pp._follow_ack_rows([OPEN_OWED, dict(CAPPED_ROW, id="dana|y")], {}, NOON + timedelta(minutes=1))
    nothing_owed = pp._follow_ack_rows([dict(OPEN_OWED, said={})], {}, NOON + timedelta(minutes=1))
check("V2R3-2: the follow-up is addressed in the People house's own spelling of who answered, as the warning "
      "itself is — the door finds nobody by the Hub account's spelling — and the People house is read once",
      [r["person"] for r in spelled] == ["Cal Q. Sample", "Cal Q. Sample"] and len(people_reads) == 1,
      (spelled, people_reads))
check("V2R3-2: and nothing owed reads nothing",
      nothing_owed == [] and len(people_reads) == 1, people_reads)

# V1R2-PPL-6: HELD BY THE QUIET WINDOW, A CLOSING KEEPS ITS WHOLE SPAN FROM 08:00.
NIGHT_CLOSED = dict(CAPPED_ROW, said={"closed_ack": {"why": "the shift ended before it could be opened",
                                                     "at": at(DAY, "23:05").astimezone(UTC).isoformat()}})
check("V1R2-PPL-6: a closing due at 23:05 is said at 08:30 the next morning — it came due at 08:00",
      len(pp._follow_ack_rows([NIGHT_CLOSED], {}, at(DAY + timedelta(days=1), "08:30"))) == 1)
check("V1R2-PPL-6: and it is old news six hours after that, never six hours after 23:05",
      pp._follow_ack_rows([NIGHT_CLOSED], {}, at(DAY + timedelta(days=1), "08:00")
                          + timedelta(hours=pp.CLOSED_ACK_KEEP_H, minutes=1)) == []
      and pp.came_due(at(DAY, "23:05")) == at(DAY + timedelta(days=1), "08:00")
      and pp.came_due(NOON) == NOON)


# ── 14f. one pass at a time (V1R2-PPL-5) ───────────────────────────────────

print("\n-- one pass makes the call off --")

calls = []
FRESH_NOW = ACK_AT + timedelta(minutes=2)
fresh_ok = [dict(PAIR_OK[0], read_at=ACK_AT.astimezone(OHIO).isoformat())]
with _Swap(sr, estate=lambda *_a, **_k: one_tab), \
        _Swap(cbh, mark_call_off=lambda _dsn, **kw: calls.append(kw) or {
            "ref": "SPBBBBBBBBBB", "window": {"why": "open to all staff for 5 hours from the call-off"}}):
    cur = _CurMissing([RECV_ROW], word="'converting'")
    with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
        lost = pp.convert("dsn", "dana|x", now=FRESH_NOW, paired=fresh_ok)
    lost_sql = list(cur.sql)
    cur = _Cur([RECV_ROW])
    with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
        won = pp.convert("dsn", "dana|x", now=FRESH_NOW, paired=fresh_ok)
    won_sql = cur.updates()
check("V1R2-PPL-5: a pass that finds the call off already being made calls no calendar, spends no try, writes "
      "nothing — and says it is being made",
      lost["state"] == pp.RECEIVED and lost.get("code") == "converting" and len(calls) == 1
      and not any("'tries'" in s for s, _a in lost_sql)
      and pp.received_ack(lost) == (pp.ACK_WAITING, "its call off is being made at this moment"), (lost, calls))
check("V1R2-PPL-5: the claim is a compare-and-set on the row, and a stale one is taken over",
      any("'converting'" in s and "(said->>'converting')::timestamptz < %s" in s for s, _a in lost_sql))
check("V1R2-PPL-5: the pass that holds it makes the call off once, converts the row, and lets the claim go",
      won["state"] == pp.CONVERTED and won["call_off_ref"] == "SPBBBBBBBBBB"
      and any("said - 'converting'" in s and pp.CONVERTED in a for s, a in won_sql), (won, won_sql))
calls.clear()


def _pooled(_dsn, **_kw):
    raise sr.Refused("this shift is already in the open-shift pool", "already_pooled")


OURS = {"ref": "SPCCCCCCCCCC", "opened_at": ACK_AT, "shift_start": ACK_AT + timedelta(hours=9),
        "reason": "automatic call off: no clock-in and no clock-out for this shift, and the warning "
                  "PW0123456789 was answered RECEIVED by Cal Sample"}
with _Swap(sr, estate=lambda *_a, **_k: one_tab), _Swap(cbh, mark_call_off=_pooled):
    cur = _Cur(routes=[("FROM asa_shift_pool", [OURS]), ("WHERE id=%s", [RECV_ROW])])
    with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
        mine = pp.convert("dsn", "dana|x", now=FRESH_NOW, paired=fresh_ok)
    mine_sql = cur.updates()
    cur = _Cur(routes=[("FROM asa_shift_pool", [dict(OURS, reason="marked on Calendar Builder by Hm One")]),
                       ("WHERE id=%s", [RECV_ROW])])
    with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
        theirs = pp.convert("dsn", "dana|x", now=FRESH_NOW, paired=fresh_ok)
check("V1R2-PPL-5: \"already in the pool\" about the call off THIS warning made is this warning's call off — "
      "converted, never \"not opened\"",
      mine["state"] == pp.CONVERTED and mine["call_off_ref"] == "SPCCCCCCCCCC"
      and any(pp.CONVERTED in a and "SPCCCCCCCCCC" in a for s, a in mine_sql), (mine, mine_sql))
check("and a pool row a human made still stops the warning at the estate's own answer",
      theirs["state"] == pp.CLOSED and "already in the open-shift pool" in theirs["why"], theirs)


# V1R3-PPL-4: A POOL THAT COULD NOT BE READ IS A TRY, NEVER THE ESTATE'S FINAL WORD.
class _PoolDown(_Cur):
    def execute(self, sql, args=()):
        if "FROM asa_shift_pool" in str(sql):
            raise RuntimeError("the pool could not be read")
        super().execute(sql, args)


with _Swap(sr, estate=lambda *_a, **_k: one_tab), _Swap(cbh, mark_call_off=_pooled):
    cur = _PoolDown([RECV_ROW])
    with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
        unread_pool = pp.convert("dsn", "dana|x", now=FRESH_NOW, paired=fresh_ok)
    pool_sql = cur.updates()
check("V1R3-PPL-4: \"already in the pool\" beside a pool row that could not be read stays RECEIVED — a try is "
      "noted and it is asked again, never closed as \"not opened from this warning\"",
      unread_pool["state"] == pp.RECEIVED and "could not be told" in unread_pool["why"]
      and not any(pp.CLOSED in a for _s, a in pool_sql)
      and any("'tries'" in s and "could not be told" in str(a) for s, a in pool_sql), (unread_pool, pool_sql))
with _Swap(pp, _connect=lambda _dsn: _Conn(_PoolDown([]))):
    exc = refusal(lambda: pp._pooled_from("dsn", "SPCCCCCCCCCC", "PW0123456789"))
check("V1R3-PPL-4: and the pool read itself says Unreadable — never \"a row somebody else made\"",
      isinstance(exc, pp.Unreadable) and "could not be read" in str(exc), exc)


# V1R3-PPL-3 / V2R3-3: ONLY THE PASS THAT HOLDS THE CLAIM WRITES UNDER IT, AND ONLY IT LETS IT GO.
class _ClaimLost(_Cur):
    """A cursor on which another pass holds a live claim: the claim changes no row."""

    def execute(self, sql, args=()):
        super().execute(sql, args)
        self.rowcount = 0 if "jsonb_build_object('converting'" in str(sql) else 1


def _no_estate(*_a, **_k):
    raise RuntimeError("the house calendars could not be read")


LOST_PATHS = {
    "its shift ended": (dict(RECV_ROW, shift_end=FRESH_NOW - timedelta(minutes=1)), fresh_ok, one_tab),
    "a punch the pairing shows": (RECV_ROW, [dict(fresh_ok[0], verdict=pp.OPEN, fault=False)], one_tab),
    "a shared cell": (RECV_ROW, [dict(SPLIT[0], read_at=fresh_ok[0]["read_at"]), SPLIT[1]], one_tab),
    "an estate that would not read": (RECV_ROW, fresh_ok, None),
    "a calendar with no cell": (RECV_ROW, fresh_ok, {"isos": {}, "by_code": {}, "cells": {}, "people": {}}),
}
for label, (row_, paired_, view_) in LOST_PATHS.items():
    calls.clear()
    cur = _ClaimLost([row_])
    with _Swap(sr, estate=(lambda *_a, _v=view_, **_k: _v) if view_ is not None else _no_estate), \
            _Swap(cbh, mark_call_off=lambda _dsn, **kw: calls.append(kw) or {"ref": "SPDDDDDDDDDD"}), \
            _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
        got = pp.convert("dsn", "dana|x", now=FRESH_NOW, paired=paired_)
    others = [s for s, _a in cur.updates() if "jsonb_build_object('converting'" not in s]
    check(f"V1R3-PPL-3: beside another pass's live claim, {label} writes nothing — no close, no try, no claim "
          "let go — and calls no calendar",
          got["state"] == pp.RECEIVED and got.get("code") == "converting" and not others and not calls,
          (got, others, calls))
calls.clear()

cur = _Cur([RECV_ROW])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
    got = pp.convert("dsn", "dana|x", now=FRESH_NOW, paired=[dict(fresh_ok[0], verdict=pp.OPEN, fault=False)])
ups = cur.updates()
token = ups[0][1][1] if ups and "jsonb_build_object('converting'" in ups[0][0] else ""
check("V1R3-PPL-3: the claim is taken BEFORE the first write, carries this pass's own token, and the close that "
      "follows lands only while that token is on the row — and lets it go",
      got["state"] == pp.CLOSED and len(token) == 16 and len(ups) == 2
      and "said->>'converting_by' = %s" in ups[1][0] and ups[1][1][-1] == token
      and "said - 'converting' - 'converting_by'" in ups[1][0], ups)
cur = _Cur([RECV_ROW])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
    got = pp.convert("dsn", "dana|x", now=STALE_AT, paired=old)
check("V1R3-PPL-3: a RECEIVED that waits for a read decides nothing, so it claims nothing and writes nothing",
      got.get("waiting") == pp.WAIT_READ and not cur.updates(), cur.updates())

# a pass that fails on its way lets ITS OWN claim go
cur = _Cur([RECV_ROW])


def _note_fails(*_a, **_k):
    raise RuntimeError("the database went away mid-write")


with _Swap(sr, estate=_no_estate), _Swap(pp, _connect=lambda _dsn: _Conn(cur), _note_conversion=_note_fails):
    exc = attempt(lambda: pp.convert("dsn", "dana|x", now=FRESH_NOW, paired=fresh_ok))
ups = cur.updates()
check("V1R3-PPL-3: a conversion that raises after its claim lets that claim go — by its own token, never "
      "another pass's",
      isinstance(exc, RuntimeError) and len(ups) == 2 and "said->>'converting_by' = %s" in ups[1][0]
      and ups[1][1][-1] == ups[0][1][1] and "said - 'converting' - 'converting_by'" in ups[1][0], (exc, ups))

# the writes from outside a conversion never move a row a live claim holds
cur = _Cur([dict(RECV_ROW, said={}, shift_end=NOON - timedelta(minutes=1))])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
    pp.retry_conversions("dsn", now=NOON)
cur2 = _Cur([dict(RECV_ROW, said={})])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur2), convert=_explodes):
    pp.retry_conversions("dsn", now=NOON)
outside = [(s, a) for s, a in cur.updates() + cur2.updates()]
check("V1R3-PPL-3: the retry's closes and its counted try land only where no live claim is — a claim older "
      "than CLAIM_MIN is a pass that died and stops nothing",
      len(outside) == 2
      and all("NOT (said ? 'converting') OR (said->>'converting')::timestamptz < %s" in s
              and a[-1] == NOON - timedelta(minutes=pp.CLAIM_MIN) for s, a in outside), outside)


class _CloseLost(_Cur):
    """The claim is taken, and then the row moves before the close lands."""

    def __init__(self, rows, after):
        super().__init__(rows)
        self.after = after

    def execute(self, sql, args=()):
        super().execute(sql, args)
        if "state=%s, call_off_why=%s, why=%s" in str(sql):
            self.rowcount = 0
            self.rows = [self.after]
        else:
            self.rowcount = 1


cur = _CloseLost([RECV_ROW], dict(RECV_ROW, state=pp.CONVERTED, call_off_ref="SPEEEEEEEEEE",
                                  converted_at=FRESH_NOW, shift_at=FRESH_NOW + timedelta(hours=9)))
with _Swap(pp, _connect=lambda _dsn: _Conn(cur)):
    got = pp.convert("dsn", "dana|x", now=FRESH_NOW, paired=[dict(fresh_ok[0], verdict=pp.OPEN, fault=False)])
check("V1R3-PPL-3: a close that no longer holds the claim moved nothing, and the answer is told as the row "
      "stands — here, the open shift another pass made",
      got["state"] == pp.CONVERTED and got["call_off_ref"] == "SPEEEEEEEEEE", got)


# ── 14g. reads, tables, the card, the channels ─────────────────────────────

print("\n-- reads that can back a telling, tables once, the card, the channels --")

pp.forget()
pp._remember_warnings([TOLD_ROW], T21 + timedelta(minutes=25))
due_read = pp.reads_wanted(T21 + timedelta(minutes=25), T21)["at"]
pp._note_waits({W_SID: (pp.WAIT_DIRECTORS, "the directors list on the Time Off settings is blank")})
check("V1R2-PPL-3 / V2R2-3: a telling that waits on the directors list spends no read of the clock — the same "
      "warning waiting on nothing else asks for one",
      due_read == T21 + timedelta(minutes=pp.WARN_EVERY_MIN)
      and pp.reads_wanted(T21 + timedelta(minutes=25), T21)["at"] is None, due_read)
HELD_ANS = {"last": {"answers": [{"who": "calsample", "state": "held", "code": "situation_off",
                                  "why": "the situation shift_punch_warning is off or absent"}]}}
pp.forget()
pp._remember_warnings([dict(TOLD_ROW, said=HELD_ANS)], T21 + timedelta(minutes=5))
got = pp.reads_wanted(T21 + timedelta(minutes=5), T21)
check("V1R2-PPL-3 / V2R2-3: a warning whose latest round its situation held asks for a read an hour after it, "
      "not every twenty minutes",
      got["at"] == T21 + timedelta(minutes=pp.HELD_READ_EVERY_MIN) and pp.HELD_READ_EVERY_MIN > pp.WARN_EVERY_MIN,
      got)
pp.forget()
cur = _Cur(routes=[("AND opened_at >=", [dict(LIVE, said=HELD_ANS, told_at=MORNING - timedelta(minutes=25))]),
                   ("FROM asa_punch_said", []), ("SELECT id, state, call_off_ref", [])])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), directors=lambda _dsn: ["Cal Sample"]):
    pp.owed("dsn", now=MORNING, paired=stale_pairs)
card_w = {w["id"]: w for w in pp.board_status(MORNING)["warnings"]}.get(LIVE["id"], {})
check("and the card says so — its read comes within the hour, never \"asked for now\"",
      card_w.get("held_round") is True and card_w.get("waits_code") == pp.WAIT_UNBACKED
      and "within 60 minutes of the last try" in card_w.get("waits", "")
      and "asked for now" not in card_w.get("waits", ""), card_w)
check("and so does one that reached nobody the door can text",
      pp.held_round({"said": {"last": {"answers": [{"state": "no_contact"}, {"state": "opted_out"}]}}}))
check("but a round that said something, one the send door held, or none yet, keeps the telling's cadence",
      not pp.held_round({"said": {"last": {"answers": [{"state": "told"}, {"state": "no_contact"}]}}})
      and not pp.held_round({"said": {"last": {"answers": [{"state": "held", "why": "HUB_RPC_SEND is off"}]}}})
      and not pp.held_round({"said": {}}))
pp.forget()
cur = _Cur(routes=[("AND opened_at >=", [LIVE]), ("FROM asa_punch_said", []), ("SELECT id, state, call_off_ref", [])])
with _Swap(pp, _connect=lambda _dsn: _Conn(cur), directors=_blank_list):
    pp.owed("dsn", now=MORNING, paired=stale_pairs)
card_w = {w["id"]: w for w in pp.board_status(MORNING)["warnings"]}.get(LIVE["id"], {})
check("V1R2-PPL-3: the list is read before the clock's freshness, so a blank list on a stale read says the "
      "list — and asks the attendance lane for nothing",
      card_w.get("waits_code") == pp.WAIT_DIRECTORS and "blank" in card_w.get("waits", "")
      and pp.reads_wanted(MORNING, MORNING - timedelta(minutes=30))["at"] is None, card_w)
pp.forget()

ddl_cur = _Cur([])
pp.forget_tables()
with _Swap(pp, _connect=lambda _dsn: _Conn(ddl_cur)):
    pp.warning_rows("dsn-once")
    pp.warning_rows("dsn-once")
    pp.warning_by_ref("dsn-once", "PW0123456789")
alters = [s for s, _a in ddl_cur.sql if s.startswith("ALTER TABLE asa_punch_warnings")]
check("V1R2-PPL-4: the lane's tables are made once per database — the ALTERs that lock the table run once, not "
      "on every connection",
      len(alters) == len(pp.WARNINGS_ADD_DDL)
      and sum(1 for s, _a in ddl_cur.sql if s.startswith("CREATE TABLE IF NOT EXISTS asa_punch_warnings")) == 1,
      len(alters))
with _Swap(pp, _connect=lambda _dsn: _Conn(ddl_cur)):
    pp.warning_rows("dsn-other")
check("and another database gets its own",
      sum(1 for s, _a in ddl_cur.sql if s.startswith("ALTER TABLE asa_punch_warnings")) == 2 * len(pp.WARNINGS_ADD_DDL))

pp._remember_warnings([dict(WARN, state=pp.RECEIVED, received_by="Cal Sample",
                            call_off_why="the house calendars could not be read (OperationalError)")], MORNING)
card_w = pp.board_status(MORNING)["warnings"][0]
check("V2R2-4: the card carries why an answered warning is not open yet",
      card_w.get("call_off_why") == "the house calendars could not be read (OperationalError)", card_w)
pp.forget()

first_rows = pp.warning_door_rows(dict(WARN, tells=0), ["Cal Sample"])
later_rows = pp.warning_door_rows(dict(WARN, tells=3), ["Cal Sample"])
check("V2R2-5: the first telling leaves the channels to the book — an e-mail goes only if the situation has "
      "one — and every later telling is a text alone",
      first_rows and "mail" not in first_rows[0] and later_rows and later_rows[0]["mail"] is False,
      (first_rows, later_rows))


# ── 15. the Apps Script halves ──────────────────────────────────────────────

print("\n-- the door and the book --")

alerts = GS_TEXT["StaffAlerts.gs"]
for kind in pp.KINDS:
    check(f"the door declares the kind {kind}", f"{kind}:" in alerts)
check("PPL-08: the warning is NOT sent to the `directors` keyword — every director is a row of their own",
      "punch_warning: true" not in alerts.split("STAFF_SHIFT_TO_DIRECTORS")[1][:200])
check("the punch kinds also go by e-mail, so a double is two texts AND two e-mails",
      "k.indexOf('punch_') === 0" in alerts)
door_src = alerts.split("HUB_ACTIONS.staffShiftReminder = function")[1].split("HUB_POLICY.")[0]
mail_src = alerts.split("function staffShiftMail_(")[1].split("HUB_POLICY.")[0]
check("PPL-01: the door keeps the quiet window whole — no pierce, no exempt kinds, no claimed word",
      "staffShiftPierces_" not in alerts and "STAFF_SHIFT_QUIET_EXEMPT" not in alerts
      and "quiet_exempt" not in door_src and "quiet_exempt" not in mail_src
      and "if (quiet) {" in door_src)
check("the door fills the facts the words need",
      all(f"{v}:" in alerts for v in ("staff", "ends", "next_shift", "next_house", "next_time",
                                      "punched_in", "tells")))
check("PPL-16: the door says a name miss apart from a missing number",
      "res.code = 'no_person'" in alerts)
check("PPL-14: the door reports test mode from the dial's own read, and '' when it cannot be read",
      "out.test_mode = !dialState.readable ? ''" in alerts and "commTestMode_()" not in alerts)
rpc = GS_TEXT["Rpc.gs"]
check("PPL-01: the send door's list carries no happening_now",
      "happening_now" not in rpc)
seeds = GS_TEXT["SmartComms.gs"]
for sit in ("shift_punch_changeover", "shift_punch_open_entry", "shift_punch_warning"):
    check(f"PPL-02: the situation {sit} arrives switched OFF",
          f"id: '{sit}', enabled: 'no'" in seeds)
warning_seed = seeds.split("id: 'shift_punch_warning'")[1].split("note:")[0]
check("PPL-09: the warning's words are in the book, whole, with its placeholders",
      "{staff}" in warning_seed and "RECEIVED {ref}" in warning_seed and "{reply}" not in warning_seed
      and "to: ''" in warning_seed, warning_seed)
for kind, sit in (("sms_reply_punch_open", "shift_reply_punch_open"),
                  ("sms_reply_punch_waiting", "shift_reply_punch_waiting"),
                  ("sms_reply_punch_closed", "shift_reply_punch_closed")):
    seed = seeds.split(f"id: '{sit}'")[1].split("note:")[0] if f"id: '{sit}'" in seeds else ""
    check(f"PPLV-11: the door maps {kind} onto {sit}, which arrives OFF with its words and facts only",
          f"{kind}: '{sit}'" in alerts and f"id: '{sit}', enabled: 'no'" in seeds
          and "{ref}" in seed and "{why}" in seed and "{reply}" not in seed and "channels: 'sms'" in seed,
          seed)
check("PPLV-11: the door fills the acknowledgement's two facts",
      "call_off_ref: str_(r.call_off_ref)" in alerts and "why: staffShiftAscii_(r.why)" in alerts)
check("PPLV-07: the door says the situation held it — apart from the send door holding the lane",
      "res.code = 'situation_off'" in door_src and "res.code = 'no_words'" in door_src)
check("PPLV-17: and a situations tab it could not read is its own code, asked BEFORE the code that means off",
      "res.code = 'situation_unread'" in door_src
      and door_src.index("res.code = 'situation_unread'") < door_src.index("res.code = 'situation_off'")
      and "situation_unread" not in sms_ears.ACK_SITUATION_HELD
      and "situation_unread" not in pp.SITUATION_HELD)
warn_seed = (seeds.split("id: 'shift_punch_warning'")[1].split("\n  }")[0]
             if "id: 'shift_punch_warning'" in seeds else "")
check("C13: the warning's row on the Desk promises no cap — it says it stops only on an answer, a punch or "
      "the shift's end, and its every telling is answerable",
      "NO CAP" in warn_seed and "six tellings" not in warn_seed and "STOPS at" not in warn_seed
      and "Reply RECEIVED {ref}" in warn_seed and "Notice {tells}." in warn_seed, warn_seed[:300])
check("V1-PPL-03: two reads that disagree — the first failed and was swallowed, the second found it on — are held "
      "as unread, and asked BEFORE the code that means off",
      "!sit && sitRead && sitRead.on" in door_src
      and door_src.index("!sit && sitRead && sitRead.on") < door_src.index("res.code = 'situation_off'"))
by_hand_seed = (seeds.split("id: 'shift_punch_warning_by_hand'")[1].split("note:")[0]
                if "id: 'shift_punch_warning_by_hand'" in seeds else "")
check("V1-PPL-04: the shared-cell warning is a situation of its own, arriving OFF, text only, answerable at "
      "every telling — and it never promises an open shift",
      "id: 'shift_punch_warning_by_hand', enabled: 'no'" in seeds and "channels: 'sms'" in by_hand_seed
      and "RECEIVED {ref}" in by_hand_seed and "by hand" in by_hand_seed and "{tells}" in by_hand_seed
      and "becomes an open shift" not in by_hand_seed and "{reply}" not in by_hand_seed
      and "punch_warning_by_hand: 'shift_punch_warning_by_hand'" in alerts, by_hand_seed)
mail_seed = (seeds.split("id: 'shift_login_missing_mail'")[1].split("note:")[0]
             if "id: 'shift_login_missing_mail'" in seeds else "")
check("PPLV-03: the first \"not logged in\" e-mail is a situation of its own, arriving OFF, whose words "
      "say what backs them",
      "id: 'shift_login_missing_mail', enabled: 'no'" in seeds and "{login_state}" in mail_seed
      and "channels: 'email'" in mail_seed
      and "login_missing: 'shift_login_missing_mail'" in alerts
      and "STAFF_SHIFT_MAIL_SITUATIONS[str_(r.kind)]" in mail_src, mail_seed)
login_seed = seeds.split("id: 'shift_login_missing'")[1].split("note:")[0]
check("PPLV-03: and the text's own e-mail words no longer claim the clock was read",
      "{login_state}" in login_seed and "does not show you logged in" not in login_seed, login_seed)

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
