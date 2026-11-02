#!/usr/bin/env python3
"""My Inbox (server/my_inbox.py and its relay doors): whose alerts decided on the server, every source failing
closed on its own, fields whitelisted, a chosen person judged as themselves and never written for, and the read
marks kept for the session's own account alone. Pure: no database, no network."""
import ast
import asyncio
import json
import logging
import os
import re
import sys
import tempfile
import time
import types
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SERVER = ROOT / "server"

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:1500]}")


if "psycopg2" not in sys.modules:  # pragma: no cover - the host has no driver
    try:
        import psycopg2  # noqa: F401
    except ImportError:
        fake = types.ModuleType("psycopg2")
        fake.Error = Exception
        extras = types.ModuleType("psycopg2.extras")
        extras.RealDictCursor = object
        errors = types.ModuleType("psycopg2.errors")
        errors.UniqueViolation = type("UniqueViolation", (Exception,), {})
        fake.extras, fake.errors = extras, errors
        sys.modules["psycopg2"] = fake
        sys.modules["psycopg2.extras"] = extras
        sys.modules["psycopg2.errors"] = errors
# every connect in this file fails unless a test hands its own, so nothing is ever read from a real database
REFUSE_CONNECT = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no database in this test"))  # noqa: E731
sys.modules["psycopg2"].connect = REFUSE_CONNECT

sys.path.insert(0, str(SERVER))
os.environ.setdefault("HUB_SNAPSHOT_OUT", "/tmp")
import my_work as mw  # noqa: E402
import my_inbox as mi  # noqa: E402

UTC = timezone.utc
NOW = datetime(2026, 9, 25, 16, 0, tzinfo=UTC)          # noon on the Ohio calendar
TODAY = date(2026, 9, 25)
D = lambda n: (TODAY + timedelta(days=n)).isoformat()  # noqa: E731
MDY = lambda n: (lambda d: f"{d.month}/{d.day}/{d.year}")(TODAY + timedelta(days=n))  # noqa: E731

USERS_ROW = {"user_id": "u-ann", "display_name": "Ann Roe", "email": "Ann@Example.com", "active": "TRUE"}
ME = mw.identity_from(USERS_ROW, "u-ann", roster_name="Ann Roe", people=[])
NOBODY = mw.identity_from({"user_id": "u-x", "display_name": "", "active": "TRUE"}, "u-x", roster_name="", people=[])
STAFF = {"uid": "u-ann", "role": "staff", "types": "STAFF", "is_master": False, "label": ""}
MANAGER = {**STAFF, "role": "manager", "types": "MANAGER"}
INTERVIEWER_BADGE = {**STAFF, "types": "STAFF, INTERVIEWER"}


# every app a source is judged by, and every app a release-notes line can name
ALL_APPS = tuple(dict.fromkeys(mi.APPS + tuple(sorted(set(mi.UPDATE_APPS.values())))))


def access(*opened):
    return {a: {"open": a in opened, "why": "" if a in opened else f"The app {a} is not open to you."}
            for a in ALL_APPS}


ALL_OPEN = access(*ALL_APPS)
MASTER = {"uid": "u-boss", "role": "admin", "types": "ADMIN", "is_master": True, "label": ""}

# ── the slices on disk ──────────────────────────────────────────────────────
TMP = Path(tempfile.mkdtemp(prefix="test-my-inbox-"))
SNAP = TMP / "snap"
SNAP.mkdir()


def cand(cid, name, stage, **over):
    base = {"id": cid, "name": name, "email": f"{cid.lower()}@mail.test", "phone": "330-555-0101",
            "city": "Akron", "summary": "RESUME SUMMARY TEXT", "resumeLink": "https://drive.test/resume",
            "lastReply": "LAST REPLY TEXT", "stage": stage, "stageSince": "2026-09-20T10:00:00.000Z",
            "daysAtStage": 5, "appliedAt": "2026-09-01T10:00:00Z", "addedBy": "other@example.com",
            "checklist": [{"id": "resume", "label": "Resume", "stage": "new", "status": "done"},
                          {"id": "call1", "label": "First call", "stage": "phone-screen", "status": "pending"},
                          {"id": "call2", "label": "Second call", "stage": "phone-screen", "status": "missing"}]}
    base.update(over)
    return base


CANDS = [cand("CAN_1", "Cara One", "phone-screen", addedBy="ann@example.com"),
         cand("CAN_2", "Dan Two", "interview", checklist=[], stageSince="", daysAtStage=None),
         cand("CAN_3", "Eve Three", "archived")]
PEOPLE = [
    {"id": "PPL_new one", "name": "Nia New", "status": "active", "start_date": D(-3), "email": "nia@x.test",
     "phone": "330-555-0102"},
    {"id": "PPL_2", "name": "Omar Pend", "status": "pending", "start_date": MDY(-13)},
    {"id": "PPL_3", "name": "Old Timer", "status": "active", "start_date": D(-40)},
    {"id": "PPL_4", "name": "Gone Soon", "status": "archived", "start_date": D(-2)},
    {"id": "PPL_5", "name": "Future Hire", "status": "pending", "start_date": D(4)},
    {"id": "PPL_6", "name": "Gia Guard", "status": "active", "start_date": D(-1), "role": "guardian"},
    {"id": "PPL_7", "name": "Kin Keeper", "status": "active", "start_date": D(-1), "role": "",
     "guardian_for": "Client One"},
    {"id": "PPL_8", "name": "Cli Ent", "status": "pending", "start_date": D(-2), "role": "Client"},
]
CLIENTS = [
    {"client_key": "clientone", "name": "Client One", "house": "JH home", "medications": "MED-A 10mg",
     "diagnoses_text": "DIAGNOSIS-A", "allergies": "ALLERGY-A", "dob": "1980-01-01"},
    {"client_key": "clienttwo", "name": "Client Two", "house": "KL home", "medications": "MED-B",
     "diagnoses_text": "DIAGNOSIS-B", "allergies": "ALLERGY-B"},
]
PROSPECTS = [{"client_name": f"Pat {i}", "diagnosis": "PROSPECT-DX", "phone": "330-555-0199",
              "scraped_at": f"{D(-i)} 21:43:17.185992+00"} for i in range(8)]


def write_slice(name, rows, built="2026-09-25T13:00:00Z"):
    (SNAP / f"{name}.json").write_text(json.dumps({"resource": name, "built_at": built, "rows": rows}),
                                       encoding="utf-8")


write_slice("candidates", CANDS)
write_slice("people", PEOPLE)
write_slice("clients", CLIENTS)
write_slice("potentialClients", PROSPECTS)


def shift(sid, key, verdict, pair="paired", fault=False, **over):
    base = {"row_kind": "shift", "id": sid, "person": "Name On Board", "person_key": key, "house": "ABD1711",
            "house_name": "JH home", "shift_code": "8A-4P", "day": D(0), "shift_at": f"{D(0)}T08:00:00-04:00",
            "time": "08:00", "verdict": verdict, "pair": pair, "pair_fault": fault,
            "pair_why": "a sentence", "known": True}
    base.update(over)
    return base


BOARD = {"generated_at": "2026-09-25T15:50:00Z",
         "status": {"row_kind": "status", "clock_state": "read", "clock_why": "",
                    "read_at": "2026-09-25T11:30:00-04:00", "days": [D(-1), D(0)]},
         "rows": [shift("annroe|2026-09-25T12:00:00+00:00", "annroe", "no_punch", "missing", True),
                  shift("annroe|a", "annroe", "not_known_to_clock", "missing", True),
                  shift("annroe|b", "annroe", "clock_not_read", "unreadable", False),
                  shift("annroe|c", "annroe", "not_entered_yet", "open", True, day=D(-1),
                        shift_at=f"{D(-1)}T20:00:00-04:00"),
                  shift("annroe|d", "annroe", "not_entered_yet", "unreadable", False),
                  shift("annroe|e", "annroe", "told_by_a_human", "told_by_a_human", False),
                  shift("annroe|f", "annroe", "punched_on_time", "paired", False),
                  shift("bobbee|g", "bobbee", "no_punch", "missing", True),
                  {"row_kind": "punch", "id": "p1", "person_key": "annroe"}]}
BOARD_FILE = TMP / "board.json"
BOARD_FILE.write_text(json.dumps(BOARD), encoding="utf-8")


def lane(rows, ok=True, error=""):
    return {"ok": ok, "error": error, "rows": rows, "read_at": "2026-09-25T15:00:00Z"}


MED = "Medication related error"
INCIDENTS = [
    {"timestamp": f"{D(-2)}T14:00:00.000Z", "your_name": "Ann Roe", "client_name": "CLIENT SECRET",
     "incident_category": MED, "incident_date": MDY(-2), "summary_of_incident": "GAVE THE WRONG PILL",
     "employees_involved": ""},
    {"timestamp": f"{D(-3)}T14:00:00.000Z", "your_name": "Bob Bee", "client_name": "CLIENT SECRET",
     "incident_category": MED, "incident_date": MDY(-3), "employees_involved": "Cy Far, Ann Roe"},
    {"timestamp": f"{D(-4)}T14:00:00.000Z", "your_name": "Bob Bee", "incident_category": MED,
     "incident_date": MDY(-4), "employees_involved": "Ann"},
    {"timestamp": f"{D(-4)}T15:00:00.000Z", "your_name": "Bob Bee", "incident_category": MED,
     "incident_date": MDY(-4), "employees_involved": "A. Roe"},
    {"timestamp": f"{D(-4)}T16:00:00.000Z", "your_name": "Bob Bee", "incident_category": MED,
     "incident_date": MDY(-4), "employees_involved": "Ann Roe Bob Bee"},
    {"timestamp": f"{D(-5)}T14:00:00.000Z", "your_name": "Bob Bee", "incident_category": MED,
     "incident_date": MDY(-5), "employees_involved": "Cy Far and Ann Roe"},
    {"timestamp": f"{D(-5)}T15:00:00.000Z", "your_name": "Ann Roe", "incident_category": "Fall",
     "incident_date": MDY(-5), "employees_involved": "Ann Roe"},
    {"timestamp": f"{D(-60)}T15:00:00.000Z", "your_name": "Ann Roe", "incident_category": MED,
     "incident_date": MDY(-60)},
    {"timestamp": f"{D(-6)}T15:00:00.000Z", "your_name": "Bob Bee", "incident_category": f"{MED}, Fall",
     "incident_date": MDY(-6), "employees_involved": "ann roe"},
    {"timestamp": f"{D(-6)}T16:00:00.000Z", "your_name": "ann@example.com", "incident_category": MED,
     "incident_date": MDY(-6)},
    # filed yesterday about a day forty days back: filed in the window, so listed, under the day it happened
    {"timestamp": f"{D(-1)}T16:00:00.000Z", "your_name": "Ann Roe", "incident_category": MED,
     "incident_date": MDY(-40)},
    # a day after today is a slip: only the filing day counts, and it is old
    {"timestamp": f"{D(-50)}T16:00:00.000Z", "your_name": "Ann Roe", "incident_category": MED,
     "incident_date": MDY(300)},
]
LANES = {"supportQueue": lane([]), "callOffs": lane([]), "uiIncidents": lane(INCIDENTS)}


def note(day, area, status, what="", version=""):
    return {"Date": day, "App / area": area, "Status": status, "Activity completed": what,
            "Version / commit": version}


NOTE_ROWS = [
    note("2026-09-24", "Houses", "Live", "Clients may file  incidents\n  from their house page",
         "fe0cffa1 · Apps Script 2026-09-24T19:24:32Z"),
    note("2026-09-24", "Relay", "Live", "Test-mode switch read every minute", "471f756b"),
    note("9/25/2026", "My Work (NEW APP)", "Live, released", "Actions & Requests", "449f1d2a"),
    note("2026-09-26", "My Profile (NEW APP)", "Live (master-only until released)", "My Details, My Docs", "497a0653"),
    note("2026-09-26", "My Work", "Live (master-only section; switches off until set)", "A settings section",
         "651ea66c"),
    note("2026-09-25", "Release Users / Client Care / Headers", "Live", "Release Users asks the send door", "13593638"),
    note("2026-09-25", "Production Actions", "Live", "Runbook houses minted", "1M1WPjPCJ4eOaX"),
    note("2026-09-24", "Potential Clients", "Live", "Black header on the Unique screen", "7306011a"),
    note("2026-09-27", "Smart Comms", "live", "Test mode fails closed", ""),
    # a zoned instant is the Ohio day it falls on; a time with no zone is the day written
    note("2026-09-25T02:30:00Z", "Privacy", "Live", "More identifiers withheld", "2b5496b4"),
    note("2026-09-23 00:00:00", "Security", "Live", "Task board cards open only their own workbook", "571f8d3f"),
    note("2026-09-27", "My Calendar (NEW APP)", "Building", "My Week", "8392a6a5"),
    note("", "Compliance", "Planned", "Certificate uploads", ""),
    note("someday", "Settings", "Live", "Clients and Hiring settings granted by badge", "2981a91a"),
    note("2026-09-26", "Time Off", "Live", "W" * 400, "4a5a1861"),
]
UPDATES = {"rows": NOTE_ROWS, "as_of": "2026-09-25T15:00:00Z", "book_why": "",
           "book": {"modified_time": "2026-09-25T14:00:00Z", "last_sync_at": "2026-09-25T15:00:00Z",
                    "last_sync_status": "ok"}}


def rq_head(key, state="ready", why="", structural=False):
    return {"key": key, "label": mw.LABELS[key], "state": state, "why": why, "as_of": "", "count": 0,
            "structural": structural}


REQ_HEADS = [rq_head(k) for k, _l in mw.REQUEST_SOURCES if k != "house_repairs"] + [
    rq_head("house_repairs", "not_attributable", mw.REPAIRS_WHY[mw.MODE_OWN], structural=True)]
REQ_ROWS = [
    {"id": "time_off:TO1", "ref": "TO1", "request": "Time off · Oct 3 – Oct 5", "submitted": "2026-09-20T12:00:00Z",
     "status": {"class": "open", "word": "Waiting on the house manager"}, "source": "time_off",
     "details": [{"label": "Reason", "value": "A PRIVATE REASON"}], "link": None},
    {"id": "support_requests:R1", "ref": "R1", "request": "Support request · Finances - Reimbursement",
     "submitted": "2026-09-10", "status": {"class": "open", "word": "Open"}, "source": "support_requests",
     "details": [], "link": None},
    {"id": "hotline:HQ1", "ref": "HQ1", "request": "Phone request · Finances - Company Reimbursement",
     "submitted": "2026-06-01T04:00:00Z", "status": {"class": "resolved", "word": "Resolved"}, "source": "hotline",
     "details": [], "link": None},
    {"id": "support_requests:R2", "ref": "R2", "request": "Support request · ADP - Pay Stubs",
     "submitted": "2026-09-15", "status": {"class": "resolved", "word": "Approved"}, "source": "support_requests",
     "details": [], "link": None},
    {"id": "support_requests:R3", "ref": "R3", "request": "Support request · Old thing",
     "submitted": "2026-05-15", "status": {"class": "resolved", "word": "Approved"}, "source": "support_requests",
     "details": [], "link": None},
    {"id": "incidents:IN1~2", "ref": "IN1", "request": "Incident report · Fall", "submitted": "2026-09-22T10:00:00Z",
     "status": {"class": "recorded", "word": "Filed"}, "source": "incidents", "details": [], "link": None},
    {"id": "incidents:IN2", "ref": "IN2", "request": "Incident report · Medication related error",
     "submitted": "2026-09-23T10:00:00Z", "status": {"class": "recorded", "word": "Filed"}, "source": "incidents",
     "details": [], "link": None},
    {"id": "call_offs:CO1", "ref": "CO1", "request": "Call Off · Fri 9/26", "submitted": "",
     "status": {"class": "open", "word": "Being covered"}, "source": "call_offs", "details": [], "link": None},
]


def requests_ok():
    return [dict(h) for h in REQ_HEADS], [json.loads(json.dumps(r)) for r in REQ_ROWS]


NOTICE_CALLS = []


def notices_ok():
    NOTICE_CALLS.append(1)
    return {"notices": [{"id": 7, "kind": "call_off", "title": "Open shift at JH home — somebody called off",
                         "body": "{shift} · apply by 3 PM", "shift": "8A-4P", "href": "/app/calendarbuilder/requests",
                         "priority": "high", "at": "2026-09-25T10:00:00+00:00", "read": False,
                         "facts": {"caller": "SECRET CALLER"}, "house": "JH home"},
                        {"id": 8, "title": "Time off approved", "body": "Oct 3", "href": "//elsewhere.test/app/x",
                         "priority": "normal", "at": "2026-09-24T10:00:00+00:00", "read": True}],
            "unread": 1, "seq": 8, "held": "", "truncated": False}


class FakeStore:
    """The store in memory: marks per (uid, key), the first-seen table, one status-history house, and Scheduling's
    items when `sched` is given (its house declared, the mirror's word on it in `books`)."""

    def __init__(self, moves=None, pointer_error=None, marks_error=None, seen_error=None, sched=None, books=None,
                 sched_error=None, support=None, support_error=None):
        self.calls = []
        self.moves = list(moves if moves is not None else [])
        self.sched = None if sched is None else list(sched)
        self.support = None if support is None else list(support)
        self.books = dict(books or {})
        self.sched_error = sched_error
        self.support_error = support_error
        self.pointer_error, self.marks_error, self.seen_error = pointer_error, marks_error, seen_error
        self.marks_table = {}
        self.seen_table = {}
        self.baseline = {}
        self.clock = NOW - timedelta(days=30)
        self.closed = False

    def pointer(self, prop):
        self.calls.append(("pointer", prop))
        if self.pointer_error is not None:
            raise self.pointer_error
        if prop == mw.PTR_SCHED_INBOX and self.sched is not None:
            if self.sched_error is not None:
                raise self.sched_error
            return "S_SCHED"
        if prop == mw.PTR_SUPPORT_INBOX and self.support is not None:
            if self.support_error is not None:
                raise self.support_error
            return "S_SUPPORT"
        return "S_LOG"

    def tab(self, sid, tab):
        self.calls.append(("tab", sid, tab))
        if sid == "S_SCHED":
            return [dict(r) for r in self.sched], len(self.sched), "2026-09-25T15:00:00Z"
        if sid == "S_SUPPORT":
            return [dict(r) for r in self.support], len(self.support), "2026-09-25T15:30:00Z"
        return [dict(r) for r in self.moves], len(self.moves), "2026-09-24T00:00:00Z"

    def book(self, sid):
        self.calls.append(("book", sid))
        return self.books.get(sid)

    def marks(self, uid, keys, *, ensure):
        self.calls.append(("marks", uid, tuple(keys), ensure))
        if self.marks_error is not None:
            raise self.marks_error
        return {k: self.marks_table[(uid, k)] for k in keys if (uid, k) in self.marks_table}

    def seen(self, kind, keys, *, record):
        self.calls.append(("seen", kind, tuple(keys), record))
        if self.seen_error is not None:
            raise self.seen_error
        if record:
            self.baseline.setdefault(kind, self.clock)
            for k in keys:
                self.seen_table.setdefault((kind, k), self.clock)
        return ({k: self.seen_table[(kind, k)] for k in keys if (kind, k) in self.seen_table},
                self.baseline.get(kind))

    def close(self):
        self.closed = True


MOVES = [{"timestamp": "2026-09-23T16:27:25.008Z", "candidate_id": "CAN_1", "candidate_name": "Cara One",
          "from_status": "New", "to_status": "Phone Screen", "actor": "ann@example.com"},
         {"timestamp": "2026-09-22T16:27:25.008Z", "candidate_id": "CAN_9", "candidate_name": "Gil Nine",
          "from_status": "Phone Screen", "to_status": "Not Hiring", "actor": "boss@example.com"},
         {"timestamp": "2026-08-01T16:27:25.008Z", "candidate_id": "CAN_8", "candidate_name": "Old Move",
          "from_status": "New", "to_status": "In Person", "actor": "boss@example.com"}]


def run(subject=None, me=None, acc=None, requests=requests_ok, lanes=LANES, lanes_why="", notices=notices_ok,
        held="", snap=SNAP, board_file=BOARD_FILE, readonly=False, store=None, now=NOW, updates=UPDATES,
        alerts_off=()):
    store = store if store is not None else FakeStore(moves=MOVES)
    got = mi.board("dsn", subject=subject or STAFF, me=me or ME, access=ALL_OPEN if acc is None else acc,
                   requests=requests, lanes=lanes, lanes_why=lanes_why, notices=notices, held=held,
                   snapshot_dir=snap, board_file=board_file, readonly=readonly, store=store, now=now,
                   updates=json.loads(json.dumps(updates)) if updates is not None else None, alerts_off=alerts_off)
    return got, store


def hd(b, key):
    return next(h for h in b["heads"] if h["key"] == key)


def its(b, kind):
    return [i for i in b["items"] if i["type"] == kind]


B, BS = run()
BLOB = json.dumps(B)

print("\nthe answer's shape")
check("every source answers, in order, then every not-on-the-platform sentence",
      [h["key"] for h in B["heads"]] == [k for k, _ in mi.SOURCES] + [k for k, _l, _w in mi.NOT_ON_PLATFORM],
      [h["key"] for h in B["heads"]])
check("the not-on-the-platform heads are always there, each with its sentence and no count",
      all(h["state"] == "not_on_platform" and h["why"] and h["count"] is None
          for h in B["heads"] if h["key"] in {k for k, _l, _w in mi.NOT_ON_PLATFORM}))
check("…and still there when every source fails",
      [h["key"] for h in run(requests=None, lanes=None, notices=None, snap=TMP / "nowhere",
                             board_file=TMP / "nowhere.json", updates=None)[0]["heads"]][-len(mi.NOT_ON_PLATFORM):]
      == [k for k, _l, _w in mi.NOT_ON_PLATFORM])
check("mentions are said not to exist, and the Mentions filter is said to be chat messages",
      "chat messages" in hd(B, "mentions")["why"] and "@" in hd(B, "mentions")["why"])
ITEM_KEYS = {"id", "type", "title", "body", "at", "flag", "link", "read"}
check("every item carries exactly the whitelisted fields", all(set(i) == ITEM_KEYS for i in B["items"]),
      [sorted(set(i) - ITEM_KEYS) for i in B["items"]])
check("every own alert key is one the read door takes; bell notices keep the bell's id",
      all(mi.KEY_RE.fullmatch(i["id"]) or mi.NOTICE_KEY_RE.fullmatch(i["id"]) for i in B["items"]),
      [i["id"] for i in B["items"] if not (mi.KEY_RE.fullmatch(i["id"]) or mi.NOTICE_KEY_RE.fullmatch(i["id"]))])
check("ids are unique", len({i["id"] for i in B["items"]}) == len(B["items"]))
check("items are newest first", [i["at"] for i in B["items"]] == sorted((i["at"] for i in B["items"]), reverse=True))
check("the unread count is the items not read", B["unread"] == sum(1 for i in B["items"] if not i["read"]))
check("a ready head counts its listed items; a head that is not ready carries no count",
      all(h["count"] == len(its(B, h["key"])) for h in B["heads"] if h["state"] == "ready")
      and all(h["count"] is None for h in B["heads"] if h["state"] != "ready"))
check("the store was closed only when the board opened it", BS.closed is False)

print("\nyour requests and reimbursement")
req = its(B, "requests")
reimb = its(B, "reimbursement")
check("open requests are listed whatever their age; concluded ones only from the last 30 days",
      sorted(i["title"] for i in req) == sorted(["Time off · Oct 3 – Oct 5", "Support request · ADP - Pay Stubs",
                                                  "Incident report · Fall", "Call Off · Fri 9/26"]),
      [i["title"] for i in req])
check("reimbursement asked through support or phone is its own type, never listed twice",
      [i["title"] for i in reimb] == ["Support request · Finances - Reimbursement"]
      and not any("Reimbursement" in i["title"] for i in req), [i["title"] for i in reimb])
check("the key carries the status class and word, so a status change is a new alert",
      any(i["id"] == "req:time_off:TO1:open:waitingonthehousemanager" for i in req)
      and any(i["id"] == "req:support_requests:R2:resolved:approved" for i in req), [i["id"] for i in req])
check("a row id the key cannot carry becomes its stable hash",
      any(re.fullmatch(r"req:h[0-9a-f]{10}:recorded:filed", i["id"]) for i in req), [i["id"] for i in req])


def one_request(word, cls="open", rid="support_requests:R9"):
    row = {"id": rid, "ref": "R9", "request": "Support request · Other", "submitted": "2026-09-24",
           "status": {"class": cls, "word": word}, "source": "support_requests", "details": [], "link": None}
    got = run(requests=lambda: ([dict(h) for h in REQ_HEADS], [row]))[0]
    return [i["id"] for i in its(got, "requests")]


check("a move inside one class ('Open' to 'Needs dates') is a new alert, not the one already read",
      one_request("Open") != one_request("Needs dates") and len(one_request("Open")) == 1
      and one_request("Open") == one_request("Open"), [one_request("Open"), one_request("Needs dates")])
long_ids = one_request("W" * 100, rid="support_requests:" + "R" * 100)
check("a key too long for the read door becomes its stable hash and is still one the door takes",
      len(long_ids) == 1 and mi.KEY_RE.fullmatch(long_ids[0]) and re.fullmatch(r"req:h[0-9a-f]{10}", long_ids[0])
      and long_ids == one_request("W" * 100, rid="support_requests:" + "R" * 100)
      and long_ids != one_request("V" * 100, rid="support_requests:" + "R" * 100), long_ids)
check("a medication error report the person filed is not listed as a request too: its pointer covers it",
      not any("Medication" in i["title"] for i in req + reimb)
      and "listed under Medication error reports" in hd(B, "requests")["note"], [i["title"] for i in req])
check("the status word is the body; the details never leave", all(i["body"] for i in req)
      and "A PRIVATE REASON" not in BLOB)
check("links go to My Work when it opens for the person, and nowhere when it does not",
      all(i["link"] == mi.LINK_MY_WORK for i in req)
      and all(i["link"] is None for i in its(run(acc=access("hiring"))[0], "requests")))
check("the requests head names each of My Work's sources and says why house repairs cannot be yours",
      [p["key"] for p in hd(B, "requests")["parts"]] == [k for k, _ in mw.REQUEST_SOURCES]
      and "reporter" in hd(B, "requests")["note"])
half = run(requests=lambda: ([rq_head(k, "unreadable", "the lane is down") if k == "hotline" else rq_head(k)
                              for k, _ in mw.REQUEST_SOURCES], []))[0]
check("one of My Work's sources unreadable: the rest are listed and the gap is said, never read as whole",
      hd(half, "requests")["state"] == "ready" and "Phone requests: the lane is down" in hd(half, "requests")["gap"]
      and "Phone requests: the lane is down" in hd(half, "reimbursement")["gap"], hd(half, "requests"))


def boom():
    raise RuntimeError("down")


gone = run(requests=boom)[0]
check("requests that could not be read are unreadable for both sources, never empty",
      hd(gone, "requests")["state"] == "unreadable" and hd(gone, "reimbursement")["state"] == "unreadable"
      and "RuntimeError" in hd(gone, "requests")["why"] and not its(gone, "requests"), hd(gone, "requests"))
na = run(requests=lambda: ([rq_head(k, "not_attributable", "your name is shared with another account",
                                    structural=k == "house_repairs") for k, _ in mw.REQUEST_SOURCES], []))[0]
check("no key to match on is not attributable, in the identity's own words",
      hd(na, "requests")["state"] == "not_attributable" and "shared" in hd(na, "requests")["why"], hd(na, "requests"))

print("\nmissing punches")
pun = its(B, "punch")
check("no_punch and a pair fault of the person's own are listed; a clock that did not know them never is",
      sorted(i["id"].rsplit(":", 1)[1] for i in pun) == ["no_punch", "open"], [i["id"] for i in pun])
check("…and nobody else's shift", len(pun) == 2 and "bobbee" not in json.dumps(pun))
check("the words say what was missed, the day, the house and the shift; flagged",
      all(i["flag"] and i["title"] == "Missing punch — JH home" for i in pun)
      and any("Nothing on the time clock" in i["body"] and "8A-4P" in i["body"] for i in pun)
      and any("never clocked out" in i["body"] for i in pun), pun)
check("the head is as of the clock's read and says only two days are kept",
      hd(B, "punch")["as_of"] == "2026-09-25T15:30:00Z" and "yesterday and today" in hd(B, "punch")["note"],
      hd(B, "punch"))
nob = run(board_file=TMP / "no-board.json")[0]
check("no board on the server is unreadable, never an empty list",
      hd(nob, "punch")["state"] == "unreadable" and "not written a punch board" in hd(nob, "punch")["why"])
bad = TMP / "bad-board.json"
bad.write_text("{not json", encoding="utf-8")
check("a broken board is unreadable", hd(run(board_file=bad)[0], "punch")["state"] == "unreadable")
unread = TMP / "unread-board.json"
unread.write_text(json.dumps({**BOARD, "status": {**BOARD["status"], "read_at": "", "clock_state": "never_read"}}),
                  encoding="utf-8")
ub = run(board_file=unread)[0]
check("a clock that was never read is unreadable, not a morning without a missed punch",
      hd(ub, "punch")["state"] == "unreadable" and not its(ub, "punch") and "not been read" in hd(ub, "punch")["why"])
stale = TMP / "stale-board.json"
stale.write_text(json.dumps({**BOARD, "status": {**BOARD["status"], "days": [D(-3), D(-2)]}}), encoding="utf-8")
check("a board that is not today's is unreadable", hd(run(board_file=stale)[0], "punch")["state"] == "unreadable")
held_clock = TMP / "held-board.json"
held_clock.write_text(json.dumps({**BOARD, "status": {**BOARD["status"], "clock_state": "held",
                                                      "clock_why": "the relogin rest"}}), encoding="utf-8")
hb = run(board_file=held_clock)[0]
check("a clock not read since its last read lists what that read found and says the gap",
      hd(hb, "punch")["state"] == "ready" and len(its(hb, "punch")) == 2
      and "has not been read since" in hd(hb, "punch")["gap"] and "the relogin rest" in hd(hb, "punch")["gap"],
      hd(hb, "punch"))
check("an account with no name key is not attributable for punches",
      hd(run(me=NOBODY)[0], "punch")["state"] == "not_attributable")

print("\nScheduling (its own house of items)")


def sched(iid, to_uid, seat="director", box="inbox", kind="info", **over):
    base = {"id": iid, "flow_id": "SF0000000001", "box": box, "kind": kind, "seat": seat, "to_uid": to_uid,
            "to_email": "", "to_name": "", "title": f"Title {iid}", "body": f"Body {iid}", "house_code": "BM4060",
            "house_label": "BM", "date": D(3), "shift_text": "8A-4P", "state": "posted", "answered_by": "",
            "answered_at": "", "note": "", "link": f"/app/scheduling/calendar?house=BM4060&day={D(3)}",
            "test_mode": "no", "created_at": "2026-09-25T10:00:00Z"}
    base.update(over)
    return base


SCHED = [
    sched("SI00000000B1", "u-ann", kind="warning", title="Call off — Mon 9/28 · 8A-4P · BM",
          created_at="2026-09-25T11:00:00Z"),
    sched("SI00000000B2", "", seat="everyone", title="Shift swapped: BM Mon 9/28 8A-4P — Cy Far → Dee Way",
          created_at="2026-09-25T12:00:00Z", test_mode="yes"),
    sched("SI00000000B3", "u-bob", kind="warning"),
    sched("SI00000000B4", "u-ann", box="work", kind="approval", state="waiting"),
    # a name is never a key here: only the id
    sched("SI00000000B5", "u-other", to_name="Ann Roe"),
    sched("SI00000000B6", "u-ann", link="https://elsewhere.test/x", created_at="2026-09-24T10:00:00Z"),
]
OK_BOOK = {"modified_time": "2026-09-25T09:00:00Z", "last_sync_at": "2026-09-25T09:05:00Z", "last_sync_status": "ok"}
SB, SS = run(store=FakeStore(moves=MOVES, sched=SCHED))
sit = {i["id"]: i for i in its(SB, "scheduling")}
check("an alert addressed to the account's id and one for everyone are listed; another's, an approval (My Work's) "
      "and a row naming the account under another id never",
      sorted(sit) == ["sched:SI00000000B1", "sched:SI00000000B2", "sched:SI00000000B6"], sorted(sit))
check("the key is sched:<id>, one the read door takes; newest first",
      all(mi.KEY_RE.fullmatch(k) for k in sit)
      and [i["id"] for i in its(SB, "scheduling")] == ["sched:SI00000000B2", "sched:SI00000000B1", "sched:SI00000000B6"],
      [i["id"] for i in its(SB, "scheduling")])
check("a warning is flagged; an informative is not; a test-mode item says so in its words",
      sit["sched:SI00000000B1"]["flag"] is True and sit["sched:SI00000000B2"]["flag"] is False
      and sit["sched:SI00000000B2"]["body"] == "Body SI00000000B2 · Test mode"
      and sit["sched:SI00000000B1"]["title"] == "Call off — Mon 9/28 · 8A-4P · BM", sit)
check("the link opens the item's day in Scheduling; one that is not Scheduling's own opens its calendar",
      sit["sched:SI00000000B1"]["link"] == {"href": f"/app/scheduling/calendar?house=BM4060&day={D(3)}",
                                            "label": "Open in Scheduling"}
      and sit["sched:SI00000000B6"]["link"] == {"href": "/app/scheduling/calendar", "label": "Open in Scheduling"},
      sit["sched:SI00000000B6"])
check("…and no link where Scheduling does not open for the account",
      all(i["link"] is None for i in its(run(store=FakeStore(moves=MOVES, sched=SCHED),
                                             acc=access(*[a for a in ALL_APPS if a != "scheduling"]))[0],
                                         "scheduling")))
check("the head is ready, counts what it lists and says whom it lists for",
      hd(SB, "scheduling")["state"] == "ready" and hd(SB, "scheduling")["count"] == 3
      and "sent to all staff" in hd(SB, "scheduling")["note"], hd(SB, "scheduling"))
for role in ("client", "guardian", "onboarding", "interviewer"):
    other_side = run(subject={**STAFF, "role": role}, store=FakeStore(moves=MOVES, sched=SCHED))[0]
    check(f"an item for everyone never reaches a {role} account; one addressed to its id still does",
          sorted(i["id"] for i in its(other_side, "scheduling")) == ["sched:SI00000000B1", "sched:SI00000000B6"]
          and "all staff" not in hd(other_side, "scheduling")["note"], sorted(i["id"] for i in its(other_side, "scheduling")))
for role in ("admin", "director", "manager"):
    check(f"…and reaches a {role} account",
          "sched:SI00000000B2" in {i["id"] for i in its(run(subject={**STAFF, "role": role},
                                                            store=FakeStore(moves=MOVES, sched=SCHED))[0], "scheduling")})
bob_view = run(subject={**STAFF, "uid": "u-bob"}, me={**ME, "uid": "u-bob"}, store=FakeStore(moves=MOVES, sched=SCHED))[0]
check("another account sees its own and everyone's, never this account's",
      sorted(i["id"] for i in its(bob_view, "scheduling")) == ["sched:SI00000000B2", "sched:SI00000000B3"])
cleared = FakeStore(moves=MOVES, sched=SCHED)
cleared.marks_table[("u-ann", "sched:SI00000000B1")] = {"read_at": NOW, "dismissed_at": NOW}
cleared.marks_table[("u-ann", "sched:SI00000000B2")] = {"read_at": NOW, "dismissed_at": None}
cb = run(store=cleared)[0]
check("the read marks are the inbox's own: a cleared item leaves, a read one reads",
      [(i["id"], i["read"]) for i in its(cb, "scheduling")] == [("sched:SI00000000B2", True),
                                                                ("sched:SI00000000B6", False)],
      [(i["id"], i["read"]) for i in its(cb, "scheduling")])
undeclared = run(store=FakeStore(moves=MOVES, sched=SCHED,
                                 sched_error=mi.Unreadable("no house is declared for it (the Essencial carries no "
                                                           f"{mw.PTR_SCHED_INBOX})")))[0]
check("no house declared is unreadable, in words — never 'no alerts'",
      hd(undeclared, "scheduling")["state"] == "unreadable" and mw.PTR_SCHED_INBOX in hd(undeclared, "scheduling")["why"]
      and not its(undeclared, "scheduling") and hd(undeclared, "punch")["state"] == "ready", hd(undeclared, "scheduling"))
unmirrored = run(store=FakeStore(moves=MOVES, sched=[]))[0]
check("a declared house with no rows and no word from the mirror is unreadable, never an empty list",
      hd(unmirrored, "scheduling")["state"] == "unreadable"
      and "declared but not mirrored yet" in hd(unmirrored, "scheduling")["why"], hd(unmirrored, "scheduling"))
copied = run(store=FakeStore(moves=MOVES, sched=[], books={"S_SCHED": OK_BOOK}))[0]
check("…while one the mirror copied whole after its last change is a real empty",
      hd(copied, "scheduling")["state"] == "ready" and hd(copied, "scheduling")["count"] == 0, hd(copied, "scheduling"))
TRAINING = [
    sched("SI00000000T1", "u-ann", seat="trainee", kind="info",
          title="Training — you are on Mon 9/28 · 8A-4P · BM",
          body="No IST at BM yet: you work it with the house manager."),
    sched("SI00000000T2", "u-ann", seat="house_manager", box="work", kind="approval", state="waiting",
          title="Training — Ann Roe · Mon 9/28 · 8A-4P · BM"),
    sched("SI00000000T3", "u-ann", seat="director", kind="warning", title="Training declined — Mon 9/28 · BM"),
]
tit = {i["id"]: i for i in its(run(store=FakeStore(moves=MOVES, sched=TRAINING))[0], "scheduling")}
check("a training's alerts read like Scheduling's others: the notice listed unflagged, a warning flagged, and its "
      "approval left to My Work",
      sorted(tit) == ["sched:SI00000000T1", "sched:SI00000000T3"] and tit["sched:SI00000000T1"]["flag"] is False
      and tit["sched:SI00000000T3"]["flag"] is True
      and tit["sched:SI00000000T1"]["title"] == "Training — you are on Mon 9/28 · 8A-4P · BM", sorted(tit))
ACT_KEYS = ITEM_KEYS | {"act", "level"}
check("a warning addressed to the account asks \"I'm aware\" through Scheduling's own answer, by its item id",
      sit["sched:SI00000000B1"].get("act") == {"kind": "aware", "action": "schedulingAnswer",
                                              "item_id": "SI00000000B1", "label": "I'm aware", "done": False,
                                              "by": "", "at": ""}
      and sit["sched:SI00000000B1"].get("level") == "warning", sit["sched:SI00000000B1"])
check("…an informative carries its level and asks nothing; one for everyone never asks either",
      sit["sched:SI00000000B6"].get("level") == "info" and "act" not in sit["sched:SI00000000B6"]
      and sit["sched:SI00000000B2"].get("level") == "info" and "act" not in sit["sched:SI00000000B2"],
      [sit["sched:SI00000000B6"], sit["sched:SI00000000B2"]])
check("…and every Scheduling item still carries the whitelisted fields, and only the act and the level beside them",
      all(ITEM_KEYS <= set(i) <= ACT_KEYS for i in its(SB, "scheduling")),
      [sorted(set(i) - ITEM_KEYS) for i in its(SB, "scheduling")])
SANS = run(store=FakeStore(moves=MOVES, sched=[sched("SI00000000C1", "u-ann", kind="warning",
                                                     answered_at="2026-09-25T13:05:00Z", answered_by="Ann Roe",
                                                     state="seen")]))[0]
check("a warning answered in Scheduling is done, by whom and when",
      [i.get("act") for i in its(SANS, "scheduling")] == [{"kind": "aware", "action": "schedulingAnswer",
                                                           "item_id": "SI00000000C1", "label": "I'm aware",
                                                           "done": True, "by": "Ann Roe",
                                                           "at": "2026-09-25T13:05:00Z"}],
      [i.get("act") for i in its(SANS, "scheduling")])
SRO = {i["id"]: i for i in its(run(store=FakeStore(moves=MOVES, sched=SCHED), readonly=True)[0], "scheduling")}
check("…and a look at somebody else's inbox carries no act at all: only the account's own session answers",
      not any("act" in i for i in SRO.values()) and SRO["sched:SI00000000B1"].get("level") == "warning", SRO)
SMIRROR = [
    sched("SI00000000M1", "u-dir1", kind="warning", title="Call off — Tue", flow_id="SF00000000M1"),
    sched("SI00000000M2", "u-dir2", kind="warning", title="Call off — Tue", flow_id="SF00000000M1"),
    sched("SI00000000M3", "u-dir1", seat="house_manager", title="For the house manager", flow_id="SF00000000M2"),
    sched("SI00000000M4", "u-dir1", box="work", kind="approval", state="waiting", flow_id="SF00000000M3"),
    sched("SI00000000M5", "u-boss", seat="requester", title="Request Off approved — Boss", flow_id="SF00000000M4"),
    sched("SI00000000M6", "u-dir1", title="Request Off approved — Boss", flow_id="SF00000000M4"),
]
BOSS_ME = {**ME, "uid": "u-boss"}
smb = run(subject=MASTER, me=BOSS_ME, store=FakeStore(moves=MOVES, sched=SMIRROR))[0]
smi = {i["id"]: i for i in its(smb, "scheduling")}
check("the master's own session also reads the directors' Scheduling alerts, once per telling, without the act; "
      "never another seat's, never an approval, never a telling already the master's own",
      sorted(smi) == ["sched:SI00000000M1", "sched:SI00000000M5"] and "act" not in smi["sched:SI00000000M1"]
      and smi["sched:SI00000000M1"]["body"] == "Body SI00000000M1 · Sent to the directors"
      and smi["sched:SI00000000M1"]["flag"] is True and "sent to the directors" in hd(smb, "scheduling")["note"],
      [sorted(smi), hd(smb, "scheduling")])
for label, kw in (("a look at the master's inbox", {"subject": MASTER, "readonly": True}),
                  ("a director's own session", {"subject": {**STAFF, "uid": "u-boss", "role": "director"}}),
                  ("an account judged as itself", {"subject": {**MASTER, "is_master": False}})):
    got = run(me=BOSS_ME, store=FakeStore(moves=MOVES, sched=SMIRROR), **kw)[0]
    check(f"…while {label} reads only its own", sorted(i["id"] for i in its(got, "scheduling"))
          == ["sched:SI00000000M5"] and "directors" not in hd(got, "scheduling")["note"],
          sorted(i["id"] for i in its(got, "scheduling")))

print("\nSupport Requests (its own house of items)")


def sreq(iid, to_uid, kind="warning", **over):
    base = {"id": iid, "ref": "SE00000000A1", "box": "inbox", "kind": kind, "seat": "director", "to_uid": to_uid,
            "to_email": "", "to_name": "Ann Roe", "title": f"Title {iid}", "body": f"Body {iid}",
            "house_label": "BM", "date": D(0), "state": "posted", "answered_by": "", "answered_at": "", "note": "",
            "link": "/app/support-desk/requests?ref=SE00000000A1", "test_mode": "no",
            "created_at": "2026-09-25T10:00:00Z"}
    base.update(over)
    return base


SUP = [
    sreq("SN00000000A1", "u-ann", "warning", title="Late Show — Cy Far", created_at="2026-09-25T11:00:00Z"),
    sreq("SN00000000A2", "u-ann", "important", title="Incident filed — Fall", created_at="2026-09-25T12:00:00Z",
         test_mode="yes"),
    sreq("SN00000000A3", "u-ann", "info", title="Payroll · Pay Stubs from Cy Far", state="seen",
         answered_at="2026-09-25T13:00:00Z", answered_by="Ann Roe", created_at="2026-09-25T09:00:00Z",
         link="https://elsewhere.test/x"),
    sreq("SN00000000A4", "u-bob", "warning"),
    # no seat for everyone in this house, and a name is never a key
    sreq("SN00000000A5", "", "info", seat="everyone"),
    sreq("SN00000000A6", "u-other", "warning", to_name="Ann Roe"),
    sreq("SN00000000A7", "u-ann", "warning", box="work"),
]
SUPB, _SUPS = run(store=FakeStore(moves=MOVES, support=SUP))
spt = {i["id"]: i for i in its(SUPB, "support")}
check("the source answers right after Scheduling, under its own name",
      [k for k, _ in mi.SOURCES].index("support") == [k for k, _ in mi.SOURCES].index("scheduling") + 1
      and mi.LABELS["support"] == "Support Requests" and mi.READERS["support"] is mi.src_support)
check("only the items addressed to the account's own id are listed: never another's, never one for everyone, never "
      "a name match", sorted(spt) == ["sreq:SN00000000A1", "sreq:SN00000000A2", "sreq:SN00000000A3"], sorted(spt))
check("the key is sreq:<id>, one the read door takes; newest first",
      all(mi.KEY_RE.fullmatch(k) for k in spt)
      and [i["id"] for i in its(SUPB, "support")] == ["sreq:SN00000000A2", "sreq:SN00000000A1", "sreq:SN00000000A3"],
      [i["id"] for i in its(SUPB, "support")])
check("a warning and an important alert are flagged; an informative is not; each says its level",
      [(spt[k]["flag"], spt[k].get("level")) for k in sorted(spt)]
      == [(True, "warning"), (True, "important"), (False, "info")], [(i["flag"], i.get("level")) for i in spt.values()])
check("a warning and an important alert ask \"I'm aware\" through supportInboxAnswer by the item's own id",
      spt["sreq:SN00000000A1"].get("act") == {"kind": "aware", "action": "supportInboxAnswer",
                                             "item_id": "SN00000000A1", "label": "I'm aware", "done": False,
                                             "by": "", "at": ""}
      and spt["sreq:SN00000000A2"]["act"]["kind"] == "aware"
      and spt["sreq:SN00000000A2"]["act"]["item_id"] == "SN00000000A2", spt)
check("…an informative asks \"Seen\", and one already answered is done, by whom and when",
      spt["sreq:SN00000000A3"].get("act") == {"kind": "seen", "action": "supportInboxAnswer",
                                             "item_id": "SN00000000A3", "label": "Seen", "done": True,
                                             "by": "Ann Roe", "at": "2026-09-25T13:00:00Z"}, spt["sreq:SN00000000A3"])
check("a test-mode item says so in its words; the item's own words otherwise",
      spt["sreq:SN00000000A2"]["body"] == "Body SN00000000A2 · Test mode"
      and spt["sreq:SN00000000A1"]["body"] == "Body SN00000000A1"
      and spt["sreq:SN00000000A1"]["title"] == "Late Show — Cy Far", spt)
check("the link opens the request in Support Requests; one that is not the app's own opens its page",
      spt["sreq:SN00000000A1"]["link"] == {"href": "/app/support-desk/requests?ref=SE00000000A1",
                                           "label": "Open in Support Requests"}
      and spt["sreq:SN00000000A3"]["link"] == {"href": "/app/support-desk/requests",
                                               "label": "Open in Support Requests"}, spt)
check("…and no link where Support Requests does not open for the account, while the act still stands",
      all(i["link"] is None and i.get("act") for i in its(run(store=FakeStore(moves=MOVES, support=SUP),
                                                              acc=access(*[a for a in ALL_APPS
                                                                           if a != "support-desk"]))[0], "support")))
check("every Support Requests item carries the whitelisted fields and only the act and the level beside them",
      all(ITEM_KEYS <= set(i) <= ACT_KEYS for i in its(SUPB, "support")),
      [sorted(set(i) - ITEM_KEYS) for i in its(SUPB, "support")])
check("the head is ready, counts what it lists and says whom it lists for",
      hd(SUPB, "support")["state"] == "ready" and hd(SUPB, "support")["count"] == 3
      and hd(SUPB, "support")["note"] == "Alerts addressed to you."
      and hd(SUPB, "support")["as_of"] == "2026-09-25T15:30:00Z", hd(SUPB, "support"))
SLOOK = {i["id"]: i for i in its(run(store=FakeStore(moves=MOVES, support=SUP), readonly=True)[0], "support")}
check("a look at somebody else's inbox carries no act; it says whom an item waits on, or who marked it",
      not any("act" in i for i in SLOOK.values())
      and SLOOK["sreq:SN00000000A1"]["body"] == "Body SN00000000A1 · Waiting on Ann Roe"
      and SLOOK["sreq:SN00000000A2"]["body"] == "Body SN00000000A2 · Waiting on Ann Roe · Test mode"
      and SLOOK["sreq:SN00000000A3"]["body"] == "Body SN00000000A3 · Marked by Ann Roe"
      and SLOOK["sreq:SN00000000A1"].get("level") == "warning", SLOOK)
LONG = run(store=FakeStore(moves=MOVES, support=[sreq("SN00000000L1", "u-ann", body="W" * 400, test_mode="yes")]),
           readonly=True)[0]
check("…and a long body is cut so the marks are never cut",
      its(LONG, "support")[0]["body"].endswith(" · Waiting on Ann Roe · Test mode")
      and len(its(LONG, "support")[0]["body"]) <= 300, its(LONG, "support")[0]["body"][-60:])
SUPMIRROR = [
    sreq("SN00000000M1", "u-dir1", "warning", ref="SE00000000M1", title="Late Show — Cy Far", to_name="Ty Bond"),
    sreq("SN00000000M2", "u-dir2", "warning", ref="SE00000000M1", title="Late Show — Cy Far", to_name="Brit Lee"),
    sreq("SN00000000M3", "u-lead", "warning", ref="SE00000000M1", seat="lead", title="Late Show — Cy Far"),
    sreq("SN00000000M4", "u-dir1", "warning", ref="SE00000000M2", box="work"),
]
smsb = run(subject=MASTER, me={**ME, "uid": "u-boss"}, store=FakeStore(moves=MOVES, support=SUPMIRROR))[0]
smsi = {i["id"]: i for i in its(smsb, "support")}
check("the master's own session also reads the directors' Support Requests alerts, once per telling, with whom it "
      "waits on and no act: the answer stays at the Support Requests door",
      sorted(smsi) == ["sreq:SN00000000M1"] and "act" not in smsi["sreq:SN00000000M1"]
      and smsi["sreq:SN00000000M1"]["body"] == "Body SN00000000M1 · Waiting on Ty Bond"
      and hd(smsb, "support")["note"] == "Alerts addressed to you, and those sent to the directors.",
      [sorted(smsi), hd(smsb, "support")])
smsr = run(subject=MASTER, me={**ME, "uid": "u-boss"}, store=FakeStore(moves=MOVES, support=SUPMIRROR),
           readonly=True)[0]
check("…while a look at the master's inbox reads none of them",
      not its(smsr, "support") and hd(smsr, "support")["note"] == "Alerts addressed to you.", its(smsr, "support"))
SUPOFF = SUPMIRROR + [
    sreq("SN00000000M5", "u-dir1", "warning", ref="SE00000000M5", title="No Call No Show — Cy Far", alert="no_call"),
    sreq("SN00000000M6", "u-dir1", "important", ref="SE00000000M6", title="Incident filed — Fall", alert="incident"),
    sreq("SN00000000M7", "u-boss", "warning", ref="SE00000000M7", title="No Call No Show — Di Ray", alert="no_call"),
]
soff = {i["id"] for i in its(run(subject=MASTER, me={**ME, "uid": "u-boss"}, store=FakeStore(moves=MOVES, support=SUPOFF),
                                 alerts_off=["no_call"])[0], "support")}
son = {i["id"] for i in its(run(subject=MASTER, me={**ME, "uid": "u-boss"}, store=FakeStore(moves=MOVES, support=SUPOFF))[0],
                            "support")}
check("ALERTS I RECEIVE: an alert the master turned off is never copied from the directors' seats — every other alert "
      "still is, an item without its kind still is, and one addressed to the master was decided when it was sent",
      soff == {"sreq:SN00000000M1", "sreq:SN00000000M6", "sreq:SN00000000M7"}
      and son == {"sreq:SN00000000M1", "sreq:SN00000000M5", "sreq:SN00000000M6", "sreq:SN00000000M7"}, [soff, son])
ODD = {i["id"]: i for i in its(run(store=FakeStore(moves=MOVES, support=[
    sreq("SN00000000B1", "u-ann", "mystery"), sreq("bad id!", "u-ann", "warning")]))[0], "support")}
check("a kind the inbox does not know is flagged and asks nothing; an id the answer door could not take sends no act",
      len(ODD) == 2 and ODD["sreq:SN00000000B1"]["flag"] is True and "act" not in ODD["sreq:SN00000000B1"]
      and "level" not in ODD["sreq:SN00000000B1"]
      and all("act" not in i for k, i in ODD.items() if k != "sreq:SN00000000B1")
      and all(mi.KEY_RE.fullmatch(k) for k in ODD), ODD)
sup_cleared = FakeStore(moves=MOVES, support=SUP)
sup_cleared.marks_table[("u-ann", "sreq:SN00000000A1")] = {"read_at": NOW, "dismissed_at": NOW}
sup_cleared.marks_table[("u-ann", "sreq:SN00000000A3")] = {"read_at": NOW, "dismissed_at": None}
check("the read marks are the inbox's own: a cleared item leaves, a read one reads",
      [(i["id"], i["read"]) for i in its(run(store=sup_cleared)[0], "support")]
      == [("sreq:SN00000000A2", False), ("sreq:SN00000000A3", True)])
s_undeclared = run(store=FakeStore(moves=MOVES, support=SUP,
                                   support_error=mi.Unreadable("no house is declared for it (the Essencial carries no "
                                                               f"{mw.PTR_SUPPORT_INBOX})")))[0]
check("no house declared is unreadable, in words — never 'no alerts' — and the other sources still answer",
      hd(s_undeclared, "support")["state"] == "unreadable"
      and mw.PTR_SUPPORT_INBOX in hd(s_undeclared, "support")["why"] and not its(s_undeclared, "support")
      and hd(s_undeclared, "scheduling")["state"] == "ready" and hd(s_undeclared, "punch")["state"] == "ready",
      hd(s_undeclared, "support"))
s_unmirrored = run(store=FakeStore(moves=MOVES, support=[]))[0]
check("a declared house with no rows and no word from the mirror is unreadable, never an empty list",
      hd(s_unmirrored, "support")["state"] == "unreadable"
      and hd(s_unmirrored, "support")["why"] == "the house of Support Requests' items is declared but not mirrored yet",
      hd(s_unmirrored, "support"))
s_copied = run(store=FakeStore(moves=MOVES, support=[], books={"S_SUPPORT": OK_BOOK}))[0]
check("…while one the mirror copied whole after its last change is a real empty",
      hd(s_copied, "support")["state"] == "ready" and hd(s_copied, "support")["count"] == 0, hd(s_copied, "support"))
s_nobody = run(subject={**STAFF, "uid": ""}, me={**ME, "uid": ""}, store=FakeStore(moves=MOVES, support=SUP))[0]
check("an account with no id is not attributable — a name is never matched",
      hd(s_nobody, "support")["state"] == "not_attributable" and not its(s_nobody, "support"), hd(s_nobody, "support"))
check("the pointer is the Support Requests inbox house, and the inbox asks the app's own door",
      mw.PTR_SUPPORT_INBOX == "HUB_HOUSE_SUPPORT_INBOX_ID" and "support-desk" in mi.APPS
      and ("pointer", mw.PTR_SUPPORT_INBOX) in _SUPS.calls)
src_text = (SERVER / "my_inbox.py").read_text(encoding="utf-8")
check("both houses are read by one reader", src_text.count("def _house_items(") == 1
      and src_text.count("_house_items(ctx, ") == 2 and src_text.count("ctx.store.tab(sid, HOUSE_TAB)") >= 1
      and "PTR_SCHED_INBOX" in src_text and "PTR_SUPPORT_INBOX" in src_text)

print("\nthe item's shape")


def item_before(key, kind, *, title, body="", at="", flag=False, link=None, read=False):
    return {"id": key, "type": kind, "title": mw._text(title, 200), "body": mw._text(body, 300),
            "at": mw.when_of(at) if at else "", "flag": bool(flag),
            "link": {"href": str(link["href"]), "label": str(link["label"])} if link else None,
            "read": bool(read)}


ITEM_CASES = [dict(key="req:a", kind="requests", title="T"),
              dict(key="punch:b", kind="punch", title="  A  title  ", body="x" * 400, at="2026-09-25T10:00:00Z",
                   flag=True, link={"href": "/app/my-work/actions", "label": "Open in My Work"}, read=True),
              dict(key="sched:c", kind="scheduling", title="", body="", at="9/25/2026", flag=0, link=None)]
check("an item without an act or a level is byte for byte what it was",
      all(json.dumps(mi.item(**c)) == json.dumps(item_before(**c)) for c in ITEM_CASES)
      and all(json.dumps(mi.item(**c, act=None, level="")) == json.dumps(item_before(**c)) for c in ITEM_CASES))
check("a level the inbox does not know, or an act it cannot whitelist, is left out — never passed through",
      json.dumps(mi.item(**ITEM_CASES[0], level="urgent")) == json.dumps(item_before(**ITEM_CASES[0]))
      and all(json.dumps(mi.item(**ITEM_CASES[0], act=bad)) == json.dumps(item_before(**ITEM_CASES[0]))
              for bad in ({"kind": "approve", "action": "supportInboxAnswer", "item_id": "SN1"},
                          {"kind": "aware", "action": "rpcCall", "item_id": "SN1"},
                          {"kind": "aware", "action": "supportInboxAnswer", "item_id": "SN 1"},
                          {"kind": "aware", "action": "supportInboxAnswer", "item_id": ""}, "aware")))
GIVEN = mi.item("sreq:x", "support", title="T", act={"kind": "seen", "action": "supportInboxAnswer",
                                                     "item_id": "SN00000000A1", "label": "Seen", "done": "yes",
                                                     "by": "Ann", "at": "2026-09-25T13:00:00.000Z",
                                                     "secret": "never"}, level="info")
check("an act leaves field by field: an extra key never, a truthy word is not done, the instant normalised",
      GIVEN["act"] == {"kind": "seen", "action": "supportInboxAnswer", "item_id": "SN00000000A1", "label": "Seen",
                       "done": False, "by": "Ann", "at": "2026-09-25T13:00:00Z"} and GIVEN["level"] == "info"
      and list(GIVEN)[-2:] == ["act", "level"], GIVEN)

print("\nTransportation (its own house of items) and the two names")


class VcStore(FakeStore):
    """FakeStore plus Transportation's items when `vc` is given (its house declared as S_VC)."""

    def __init__(self, vc=None, vc_error=None, **kw):
        super().__init__(moves=kw.pop("moves", MOVES), **kw)
        self.vc = None if vc is None else list(vc)
        self.vc_error = vc_error

    def pointer(self, prop):
        if prop == mw.PTR_VC_INBOX and self.vc is not None:
            self.calls.append(("pointer", prop))
            if self.vc_error is not None:
                raise self.vc_error
            return "S_VC"
        return super().pointer(prop)

    def tab(self, sid, tab):
        if sid == "S_VC":
            self.calls.append(("tab", sid, tab))
            return [dict(r) for r in self.vc], len(self.vc), "2026-09-25T15:00:00Z"
        return super().tab(sid, tab)


def vci(iid, to_uid, box="inbox", kind="info", seat="requester", **over):
    base = {"id": iid, "trip_id": "VT00000000A1", "box": box, "kind": kind, "seat": seat, "to_uid": to_uid,
            "to_email": "", "to_name": "", "title": "Your vehicle request was approved",
            "body": f"Van · Tue Oct 6, 1:00 PM – 3:20 PM. Approved by Ty Bond. {iid}", "facts": "[]", "date": D(11),
            "when": "Tue Oct 6, 1:00 PM – 3:20 PM", "state": "posted", "answered_by": "", "answered_at": "",
            "note": "", "link": "/app/vehicle-calendar/calendar?trip=VT00000000A1", "test_mode": "no",
            "created_at": "2026-09-25T10:00:00Z"}
    base.update(over)
    return base


VC = [
    vci("VI00000000C1", "u-ann", created_at="2026-09-25T11:00:00Z"),
    vci("VI00000000C2", "u-ann", title="Your vehicle request was declined", test_mode="yes",
        body="Ford · Wed Oct 7, 9:00 AM – 11:30 AM. Declined by Brittany Anderson.", created_at="2026-09-25T12:00:00Z"),
    vci("VI00000000C3", "u-bob"),
    # a director's approval is My Work's, never this inbox's
    vci("VI00000000C4", "u-ann", box="work", kind="approval", seat="director", state="waiting",
        title="Vehicle request — Cy Far", link="/app/my-work"),
    # no item is for everyone, and a name is never a key here: only the id
    vci("VI00000000C5", "", seat="everyone"),
    vci("VI00000000C6", "u-other", to_name="Ann Roe"),
    vci("VI00000000C7", "u-ann", link="https://elsewhere.test/x", created_at="2026-09-24T10:00:00Z",
        title="Your trip was cancelled"),
]
check("the release notes' 'Transportation' is the new app; 'Transportation Users' is the old one, whole",
      mi.UPDATE_APPS[mi.sr.fold("Transportation")] == "vehicle-calendar"
      and mi.UPDATE_APPS[mi.sr.fold("Transportation Users")] == "transportation"
      and ("Transportation", "vehicle-calendar") in mi._REGISTRY_APPS
      and ("Transportation Users", "transportation") in mi._REGISTRY_APPS
      and ("Transportation", "transportation") not in mi._REGISTRY_APPS
      and [n for n, _a in mi._REGISTRY_APPS].index("Transportation Users")
      == [n for n, _a in mi._REGISTRY_APPS].index("Transportation") + 1,
      [p for p in mi._REGISTRY_APPS if p[0].startswith("Transportation")])
check("…and an area names one of them, never the Users app inside the longer name",
      mi.area_apps("Transportation") == ["vehicle-calendar"]
      and mi.area_apps("Transportation — vehicle requests and approvals") == ["vehicle-calendar"]
      and mi.area_apps("Transportation Users") == ["transportation"]
      and mi.area_apps("Transportation Users (routes)") == ["transportation"]
      and mi.update_area("Transportation (NEW APP)") == ("Transportation", True),
      [mi.area_apps(a) for a in ("Transportation", "Transportation Users", "Transportation Users (routes)")])
check("the source is the last one, and the new app is the last one asked for",
      mi.SOURCES[-1] == ("transport", "Transportation") and mi.APPS[-1] == "vehicle-calendar"
      and mi.READERS["transport"] is mi.src_transport and mi.LABELS["transport"] == "Transportation")
TB, TS = run(store=VcStore(vc=VC))
tvit = {i["id"]: i for i in its(TB, "transport")}
check("only the items addressed to the account's own id: another's, a director's approval (My Work's), one for "
      "everyone and a row naming the account under another id never",
      sorted(tvit) == ["vcal:VI00000000C1", "vcal:VI00000000C2", "vcal:VI00000000C7"], sorted(tvit))
check("the key is vcal:<id>, one the read door takes; newest first; the type is the source",
      all(mi.KEY_RE.fullmatch(k) for k in tvit) and all(i["type"] == "transport" for i in tvit.values())
      and [i["id"] for i in its(TB, "transport")] == ["vcal:VI00000000C2", "vcal:VI00000000C1", "vcal:VI00000000C7"],
      [i["id"] for i in its(TB, "transport")])
check("an item is never flagged; a test-mode item says so in its words; the title is the item's own",
      all(i["flag"] is False for i in tvit.values())
      and tvit["vcal:VI00000000C2"]["body"] == "Ford · Wed Oct 7, 9:00 AM – 11:30 AM. Declined by Brittany Anderson. "
                                              "· Test mode"
      and tvit["vcal:VI00000000C2"]["title"] == "Your vehicle request was declined"
      and set(tvit["vcal:VI00000000C1"]) == ITEM_KEYS, tvit)
check("the link opens the trip in Transportation; one that is not Transportation's own opens its calendar",
      tvit["vcal:VI00000000C1"]["link"] == {"href": "/app/vehicle-calendar/calendar?trip=VT00000000A1",
                                            "label": "Open in Transportation"}
      and tvit["vcal:VI00000000C7"]["link"] == {"href": "/app/vehicle-calendar/calendar",
                                                "label": "Open in Transportation"}, tvit["vcal:VI00000000C7"])
check("…and no link where Transportation does not open for the account (the master's alone until released)",
      all(i["link"] is None for i in its(run(store=VcStore(vc=VC),
                                             acc=access(*[a for a in ALL_APPS if a != "vehicle-calendar"]))[0],
                                         "transport"))
      and len(its(run(store=VcStore(vc=VC), acc=access(*[a for a in ALL_APPS if a != "vehicle-calendar"]))[0],
                  "transport")) == 3)
check("the head is ready and counts what it lists", hd(TB, "transport")["state"] == "ready"
      and hd(TB, "transport")["count"] == 3 and hd(TB, "transport")["label"] == "Transportation", hd(TB, "transport"))
bob_vc = run(subject={**STAFF, "uid": "u-bob"}, me={**ME, "uid": "u-bob"}, store=VcStore(vc=VC))[0]
check("another account sees its own, never this account's",
      [i["id"] for i in its(bob_vc, "transport")] == ["vcal:VI00000000C3"])
for role in ("admin", "director", "manager"):
    check(f"…and no item reaches a {role} account for being on the staff side",
          "vcal:VI00000000C5" not in {i["id"] for i in its(run(subject={**STAFF, "role": role},
                                                               store=VcStore(vc=VC))[0], "transport")})
undeclared_vc = run(store=VcStore(vc=VC, vc_error=mi.Unreadable("no house is declared for it (the Essencial "
                                                                  f"carries no {mw.PTR_VC_INBOX})")))[0]
check("no house declared is unreadable, in words — never 'no alerts'; the other sources still answer",
      hd(undeclared_vc, "transport")["state"] == "unreadable"
      and mw.PTR_VC_INBOX in hd(undeclared_vc, "transport")["why"] and not its(undeclared_vc, "transport")
      and hd(undeclared_vc, "punch")["state"] == "ready", hd(undeclared_vc, "transport"))
unmirrored_vc = run(store=VcStore(vc=[]))[0]
check("a declared house with no rows and no word from the mirror is unreadable, never an empty list",
      hd(unmirrored_vc, "transport")["state"] == "unreadable"
      and hd(unmirrored_vc, "transport")["why"] == "the house of Transportation's items is declared but not mirrored yet",
      hd(unmirrored_vc, "transport"))
copied_vc = run(store=VcStore(vc=[], books={"S_VC": OK_BOOK}))[0]
check("…while one the mirror copied whole after its last change is a real empty",
      hd(copied_vc, "transport")["state"] == "ready" and hd(copied_vc, "transport")["count"] == 0, hd(copied_vc, "transport"))
no_uid_vc = run(subject={**STAFF, "uid": ""}, me={**ME, "uid": ""}, store=VcStore(vc=VC))[0]
check("an account with no id is not attributable here, in words",
      hd(no_uid_vc, "transport")["state"] == "not_attributable" and "no id" in hd(no_uid_vc, "transport")["why"],
      hd(no_uid_vc, "transport"))
check("the car-trips sentence stays as it is until the app is released",
      dict((k, w) for k, _l, w in mi.NOT_ON_PLATFORM)["car_trips"]
      == "The mileage, fleet and expense books exist but hold no rows. Reimbursement requests do work.")

print("\nhiring (the candidates door's rule)")
hir = its(B, "hiring")
check("a staff account that opens Hiring but not the candidates door is told the counts only — no name, no step",
      len(hir) == 1 and hir[0]["id"].startswith("hiring_count:") and "2 candidates" in hir[0]["title"]
      and "Cara" not in json.dumps(hir) and "Gil" not in json.dumps(hir) and "First call" not in json.dumps(hir),
      hir)
check("…the counts by stage and the moves of the last 14 days",
      "Phone Screen 1" in hir[0]["body"] and "Interview 1" in hir[0]["body"] and "2 moves" in hir[0]["body"], hir)
mgr = run(subject=MANAGER)[0]
mh = its(mgr, "hiring")
titles = sorted(i["title"] for i in mh)
check("a manager sees each candidate in the process with the stage, and each move — archived cards never",
      titles == sorted(["Cara One — Phone Screen", "Dan Two — Interview", "Cara One moved to Phone Screen",
                        "Gil Nine moved to Not Hiring"]), titles)
cara = next(i for i in mh if i["id"].startswith("cand:CAN_1:"))
check("the step is the first open item of the card's own stage, with its days",
      cara["body"] == "Next: First call · 5 days at this stage" and cara["id"] == "cand:CAN_1:phone-screen", cara)
dan = next(i for i in mh if i["id"].startswith("cand:CAN_2:"))
check("a card with nothing open says so", dan["body"].startswith("Nothing open at this stage"), dan)
check("the person's own candidate and own move are flagged; another's is not",
      cara["flag"] and any(i["flag"] and "moved to Phone Screen" in i["title"] for i in mh)
      and not any(i["flag"] for i in mh if "Gil Nine" in i["title"] or "Dan Two" in i["title"])
      and any(i["body"] == "From New · You moved it" for i in mh), mh)
MB = json.dumps(mh)
check("a candidate item never carries e-mail, phone, city, summary, résumé or reply",
      not any(w in MB for w in ("mail.test", "330-555-0101", "Akron", "RESUME SUMMARY", "drive.test", "LAST REPLY",
                                "boss@example.com")), MB[:400])
check("the interviewer badge is admitted as the candidates door admits it",
      len(its(run(subject=INTERVIEWER_BADGE)[0], "hiring")) == 4)
check("…and the rule is the door's: roles admin, director, manager, interviewer; badges INTERVIEWER, HM",
      [mi.candidates_admitted(r, t) for r, t in (("admin", ""), ("director", ""), ("staff", "HM"),
                                                 ("staff", "STAFF"), ("staff", "MANAGER"), ("client", ""))]
      == [True, True, True, False, False, False])
shut = run(subject=MANAGER, acc=access("clients"))[0]
check("Hiring shut to the person: the source is closed, in its own words, and nothing is read",
      hd(shut, "hiring")["state"] == "closed" and "hiring is not open" in hd(shut, "hiring")["why"].lower()
      and not its(shut, "hiring"), hd(shut, "hiring"))
no_log = run(subject=MANAGER, store=FakeStore(pointer_error=mi.Unreadable("no house is declared for it")))[0]
check("moves that cannot be read: the cards are still listed and the gap is said",
      hd(no_log, "hiring")["state"] == "ready" and len(its(no_log, "hiring")) == 2
      and "Who moved where could not be read" in hd(no_log, "hiring")["gap"], hd(no_log, "hiring"))
os.rename(SNAP / "candidates.json", SNAP / "candidates.away")
miss = run(subject=MANAGER)[0]
os.rename(SNAP / "candidates.away", SNAP / "candidates.json")
check("a missing candidates slice is unreadable, never [] (hiring_slices' honest empty is not used)",
      hd(miss, "hiring")["state"] == "unreadable" and "not on this server" in hd(miss, "hiring")["why"])

print("\nnew staff")
ns_items = its(B, "new_staff")
check("named for those who open Users or the Employee Tracker: active or pending, started in the last 14 days, "
      "both date shapes",
      sorted(i["title"] for i in ns_items) == ["New staff: Nia New", "New staff: Omar Pend"], ns_items)
check("…with the day, pending said, the tracker linked, and never a contact",
      any(i["body"].endswith("· pending") for i in ns_items) and all(i["link"] == mi.LINK_TRACKER for i in ns_items)
      and "nia@x.test" not in BLOB and "330-555-0102" not in BLOB)
check("a person id the key cannot carry becomes its hash", any(re.fullmatch(r"staff:h[0-9a-f]{10}", i["id"])
                                                               for i in ns_items), [i["id"] for i in ns_items])
users_only = its(run(acc=access("users"))[0], "new_staff")
check("Users alone names them too, linked to Users", len(users_only) == 2
      and all(i["link"] == mi.LINK_USERS for i in users_only))
count_only = run(acc=access())[0]
co = its(count_only, "new_staff")
check("everybody else is told the count, never a name",
      len(co) == 1 and co[0]["title"] == "2 new staff members in the last 14 days"
      and "Nia" not in json.dumps(co) and "Omar" not in json.dumps(co) and co[0]["link"] is None, co)
check("a guardian, a guardian's row or a client on the roster is never new staff, named or counted",
      not any(w in json.dumps(ns_items + co) for w in ("Gia Guard", "Kin Keeper", "Cli Ent"))
      and len(ns_items) == 2, [i["title"] for i in ns_items])

print("\nnew clients (first seen)")
st = FakeStore()
first_read = run(store=st)[0]
check("the first read seeds the baseline and shows nothing as new",
      its(first_read, "new_clients") == [] and hd(first_read, "new_clients")["state"] == "ready"
      and ("seen", "client", ("clientone", "clienttwo"), True) in st.calls, st.calls)
st.clock = NOW - timedelta(days=2)
write_slice("clients", CLIENTS + [{"client_key": "clientthree", "name": "Client Three", "house": "MN home",
                                   "medications": "MED-C", "diagnoses_text": "DIAGNOSIS-C", "allergies": "ALLERGY-C"}])
later = run(store=st)[0]
nc = its(later, "new_clients")
check("a client first seen after the baseline is new: its name and house, and nothing clinical",
      [(i["title"], i["body"]) for i in nc] == [("New client: Client Three", "MN home")]
      and not any(w in json.dumps(later) for w in ("MED-", "DIAGNOSIS", "ALLERGY", "1980-01-01")), nc)
check("…counted from the day the inbox began watching", "began watching" in hd(later, "new_clients")["note"])
st.clock = NOW
ro_store = FakeStore()
ro = run(store=ro_store, readonly=True)[0]
check("a read-only look records nothing, and with no baseline says it has not begun watching",
      ("seen", "client", ("clientone", "clientthree", "clienttwo"), False) in ro_store.calls
      and not ro_store.seen_table and "not begun watching" in hd(ro, "new_clients")["gap"], ro_store.calls)
check("Clients shut: closed", hd(run(acc=access("hiring"))[0], "new_clients")["state"] == "closed")
check("a first-seen table that cannot be read is unreadable, never 'no new clients'",
      hd(run(store=FakeStore(seen_error=RuntimeError("down")))[0], "new_clients")["state"] == "unreadable")
write_slice("clients", [{"client_key": "", "name": "No Key"}])
empty_store = FakeStore()
empty_clients = run(store=empty_store)[0]
check("a clients copy with no client is unreadable, and no baseline is written from it",
      hd(empty_clients, "new_clients")["state"] == "unreadable" and "holds no client" in hd(empty_clients, "new_clients")["why"]
      and not any(c[0] == "seen" for c in empty_store.calls) and not empty_store.baseline, empty_store.calls)
write_slice("clients", CLIENTS)

print("\nprospects")
pc = its(B, "potential_clients")
check("one count of the last 7 days, with names, for those who open Potential Clients — no diagnosis, no phone",
      len(pc) == 1 and pc[0]["title"] == "7 new prospects in the last 7 days" and "Pat 0" in pc[0]["body"]
      and "and 2 more" in pc[0]["body"] and "PROSPECT-DX" not in BLOB and "330-555-0199" not in BLOB, pc)
check("Potential Clients shut: closed, not even a count",
      hd(run(acc=access("hiring"))[0], "potential_clients")["state"] == "closed"
      and not its(run(acc=access("hiring"))[0], "potential_clients"))

print("\ncompany notices")
nt = its(B, "notices")
check("the bell's own notices keep the bell's id and read state; the shift is put in the words",
      [i["id"] for i in nt] == ["srv-7", "srv-8"] and nt[0]["body"] == "8A-4P · apply by 3 PM"
      and nt[0]["flag"] and nt[1]["read"] is True, nt)
check("a notice's facts never leave; a link that is not an address in the app is dropped",
      "SECRET CALLER" not in BLOB and nt[1]["link"] is None and nt[0]["link"]["href"].startswith("/app/"))
NOTICE_CALLS.clear()
hn = run(held="test mode")[0]
check("test mode holds the notices: the head is held, in its sentence, and the bell is not even asked",
      hd(hn, "notices")["state"] == "held" and hd(hn, "notices")["why"] == mi.HELD_WHY and not NOTICE_CALLS
      and not its(hn, "notices"), hd(hn, "notices"))
check("…while own-record reads still answer", hd(hn, "punch")["state"] == "ready" and its(hn, "requests"))
check("a bell that could not be read is unreadable", hd(run(notices=boom)[0], "notices")["state"] == "unreadable")
check("a relay with no notices lane says so", hd(run(notices=None)[0], "notices")["state"] == "unreadable")

print("\nmedication error reports (a pointer)")
me_items = its(B, "med_error")
check("the reports the person filed, or that name them by whole name, filed or about a day in the last 30 days",
      len(me_items) == 6, [i["title"] for i in me_items])
late = D(-40)
check("a report filed in the window about an older day is listed under the day it happened; a day after today "
      "never keeps an old report listed",
      any(i["title"].endswith(mi._day_words(date.fromisoformat(late))) for i in me_items)
      and not any(i["at"].startswith(D(-50)) for i in me_items), [i["title"] for i in me_items])


def with_people(rows):
    write_slice("people", rows)
    try:
        return run()[0]
    finally:
        write_slice("people", PEOPLE)


ROE = {"id": "PPL_roe", "name": "Ann Roe", "status": "active", "start_date": D(-400)}
one_roe = with_people(PEOPLE + [ROE])
two_roes = with_people(PEOPLE + [ROE, {**ROE, "id": "PPL_roe2", "status": "archived"}])
split_roe = with_people(PEOPLE + [ROE, {"id": "PPL_roe3", "name": "", "first_name": "Ann", "last_name": "Roe"}])
check("one roster row under the name: the reports that name the person are listed",
      len(its(one_roe, "med_error")) == 6, [i["title"] for i in its(one_roe, "med_error")])
check("two roster rows under the name (by name, or by first and last): a report that only names them is not "
      "listed; the ones they filed still are",
      len(its(two_roes, "med_error")) == 3 and len(its(split_roe, "med_error")) == 3
      and "somebody else on the people roster" in hd(two_roes, "med_error")["note"],
      [i["title"] for i in its(two_roes, "med_error")])
os.rename(SNAP / "people.json", SNAP / "people.away")
no_roster = run()[0]
os.rename(SNAP / "people.away", SNAP / "people.json")
check("a people roster that cannot be read: only the reports the person filed, and the gap is said",
      len(its(no_roster, "med_error")) == 3 and hd(no_roster, "med_error")["state"] == "ready"
      and "people roster could not be read" in hd(no_roster, "med_error")["gap"], hd(no_roster, "med_error"))
check("a first name alone, initials, two names run together, another category or an old report never match",
      not mi.names_you("Ann", {"annroe"}) and not mi.names_you("A. Roe", {"annroe"})
      and not mi.names_you("Ann Roe Bob Bee", {"annroe"}) and mi.names_you("Cy Far and Ann Roe", {"annroe"})
      and mi.names_you("Cy Far; ann roe", {"annroe"}))
check("only the day is said: no client, no summary, no medication",
      all(re.fullmatch(r"A medication error report names you — [A-Z][a-z]{2} \d{1,2}, \d{4}", i["title"])
          and i["body"] == "" for i in me_items)
      and "CLIENT SECRET" not in BLOB and "WRONG PILL" not in BLOB, me_items)
check("linked only when UI Reports opens for the person",
      all(i["link"] == mi.LINK_INCIDENTS for i in me_items)
      and all(i["link"] is None for i in its(run(acc=access("hiring"))[0], "med_error")))
check("an unreadable incidents lane is unreadable", hd(run(lanes=None, lanes_why="down")[0], "med_error")["state"]
      == "unreadable")
check("the MAR error book is never read", "marErrors" not in (SERVER / "my_inbox.py").read_text(encoding="utf-8"))

print("\nread marks")
ms = FakeStore(moves=MOVES)
ms.marks_table[("u-ann", "req:time_off:TO1:open:waitingonthehousemanager")] = {"read_at": NOW, "dismissed_at": None}
ms.marks_table[("u-ann", "req:support_requests:R2:resolved:approved")] = {"read_at": NOW, "dismissed_at": NOW}
mb = run(store=ms)[0]
check("a read mark reads; a cleared one is gone; a mark is joined for the subject's own account",
      next(i for i in mb["items"] if i["id"] == "req:time_off:TO1:open:waitingonthehousemanager")["read"] is True
      and not any(i["id"] == "req:support_requests:R2:resolved:approved" for i in mb["items"])
      and all(c[1] == "u-ann" for c in ms.calls if c[0] == "marks"), ms.calls[-1:])
check("the bell's ids are never looked up in the inbox's own table",
      not any(k.startswith("srv-") for c in ms.calls if c[0] == "marks" for k in c[2]))
check("an own read may make the table; a read-only look never does",
      [c[3] for c in ms.calls if c[0] == "marks"] == [True]
      and [c[3] for c in ro_store.calls if c[0] == "marks"] == [False])
check("the answer says the marks are kept on an own read, and why not on a read-only look",
      mb["marks"] == {"readable": True, "why": "", "kept": True, "kept_why": ""}
      and ro["marks"]["kept"] is False and ro["marks"]["kept_why"] == mi.KEPT_WHY_CHOSEN, [mb["marks"], ro["marks"]])
mf = run(store=FakeStore(marks_error=RuntimeError("down")))[0]
check("marks that cannot be read: every alert is said unread and the answer says why",
      mf["marks"]["readable"] is False and "RuntimeError" in mf["marks"]["why"]
      and all(not i["read"] for i in mf["items"] if not i["id"].startswith("srv-")), mf["marks"])

print("\neach source on its own")
saved = dict(mi.READERS)
mi.READERS["new_staff"] = lambda ctx: (_ for _ in ()).throw(KeyError("surprise"))
one_down = run()[0]
mi.READERS.clear()
mi.READERS.update(saved)
check("a source that throws is unreadable in words; every other source still answers",
      hd(one_down, "new_staff")["state"] == "unreadable" and "KeyError" in hd(one_down, "new_staff")["why"]
      and hd(one_down, "punch")["state"] == "ready" and its(one_down, "hiring"), hd(one_down, "new_staff"))
empty = run(snap=TMP / "nowhere", board_file=TMP / "nowhere.json", requests=None, notices=None, lanes=None,
            updates=None,
            store=FakeStore(pointer_error=mi.Unreadable("the Essencial's Facts are not in the mirror")))[0]
check("with nothing readable, every source says why and no item is invented",
      not empty["items"] and all(h["state"] in ("unreadable", "closed", "held", "not_on_platform")
                                 for h in empty["heads"]), [(h["key"], h["state"]) for h in empty["heads"]])

print("\nthe read keys")
check("the key rule", all(mi.KEY_RE.fullmatch(k) for k in ("req:time_off:TO1:open", "punch:h0123456789:no_punch",
                                                            "cand:CAN_1:phone-screen", "staffcount:2026-09-25:2"))
      and not any(mi.KEY_RE.fullmatch(k) for k in ("", "req", "Req:x", "req:", "req:a b", "req:" + "x" * 201,
                                                   "srv-7", "req:x;drop")))
notice_ids, alert_keys, ignored = mi.split_keys(["srv-7", "srv-7", "req:a:open", "srv-0", "bad key", 12, None,
                                                 "srv-12abc", "mar:0123456789"])
check("srv-N goes to the bell's marks, every other alert key to the inbox's, the rest is ignored",
      notice_ids == [7] and alert_keys == ["mar:0123456789", "req:a:open"] and ignored == 5,
      [notice_ids, alert_keys, ignored])
check("at most READ_MAX keys are looked at", len(mi.split_keys([f"req:{i}" for i in range(900)])[1]) == mi.READ_MAX)


class Cur:
    def __init__(self, log_, here=True, fail_on=""):
        self.log, self.here, self.fail_on = log_, here, fail_on
        self.last = ""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, args=()):
        if self.fail_on and sql.startswith(self.fail_on):
            raise RuntimeError("refused")
        self.log.append((" ".join(sql.split()), args))
        self.last = sql

    def fetchone(self):
        return {"here": self.here}

    def fetchall(self):
        return []


class Conn:
    def __init__(self, log_, here=True, fail_on=""):
        self.log, self.here, self.fail_on = log_, here, fail_on
        self.session = {}

    def set_session(self, **kw):
        self.session.update(kw)

    def cursor(self, **kw):
        return Cur(self.log, self.here, self.fail_on)

    def commit(self):
        self.log.append(("COMMIT", ()))

    def rollback(self):
        self.log.append(("ROLLBACK", ()))

    def close(self):
        self.log.append(("CLOSE", ()))


def with_conn(here=True, fail_on=""):
    log_ = []
    conns = []

    def connect(*a, **k):
        c = Conn(log_, here, fail_on)
        conns.append(c)
        return c
    mi.psycopg2.connect = connect
    mi._READY.clear()
    return log_, conns


sql, conns = with_conn()
mi.mark_read("dsn", uid="u-ann", keys=["req:a:open", "srv-7", "bad key", 5], dismiss=True)
writes = [s for s, a in sql if s.startswith("INSERT")]
check("the inbox's marks write only alert keys, for the account given, and make their table first",
      any("CREATE TABLE IF NOT EXISTS asa_hub_inbox_reads" in s for s, _a in sql)
      and len(writes) == 1 and [a for s, a in sql if s.startswith("INSERT")][0][0] == "u-ann"
      and [a for s, a in sql if s.startswith("INSERT")][0][2] == ["req:a:open"] and ("CLOSE", ()) in sql, sql)
deletes = [(s, a) for s, a in sql if s.startswith("DELETE")]
check("after the marks are kept, only that account's marks on alerts that leave the list within days are let go, "
      "and only once they are old",
      len(deletes) == 1 and deletes[0][1] == ("u-ann", mi.PRUNE_DAYS, list(mi.PRUNE_KINDS))
      and "user_id=%s" in deletes[0][0] and "split_part(alert_key, ':', 1) = ANY(%s)" in deletes[0][0]
      and [s for s, _a in sql].index("COMMIT") < [s for s, _a in sql].index(deletes[0][0])
      and not {"req", "cand", "hiring_count", "mar"} & set(mi.PRUNE_KINDS) and mi.PRUNE_DAYS >= 2 * mi.MED_ERROR_DAYS,
      deletes)
sql, conns = with_conn(fail_on="DELETE")
check("letting old marks go that fails keeps the marks just written, and says nothing but the error's type",
      mi.mark_read("dsn", uid="u-ann", keys=["req:a:open"]) == 1 and ("ROLLBACK", ()) in sql
      and any(s.startswith("INSERT") for s, _a in sql), sql)
sql, conns = with_conn(here=False)
got = mi.read_marks("dsn", "u-ann", ["req:a:open"], ensure=False)
check("a read-only marks read runs on a read-only session, makes no table, and a missing one is no marks",
      got == {} and conns[0].session.get("readonly") is True and not any("CREATE" in s for s, _a in sql), sql)
sql, conns = with_conn(here=False)
check("a read-only first-seen read writes nothing and a missing table is no baseline",
      mi.seen("dsn", "client", ["a"], record=False) == ({}, None) and conns[0].session.get("readonly") is True
      and not any(s.startswith(("INSERT", "CREATE")) for s, _a in sql), sql)
sql, conns = with_conn()
mi.seen("dsn", "client", ["a", "b"], record=True)
check("a recording read puts the baseline row first, then the keys, never overwriting a first sighting",
      [s.split(" (")[0] for s, _a in sql if s.startswith("INSERT")] == ["INSERT INTO asa_hub_inbox_seen"] * 2
      and all("ON CONFLICT DO NOTHING" in s for s, _a in sql if s.startswith("INSERT"))
      and [a for s, a in sql if s.startswith("INSERT")][0] == ("client", mi.BASELINE), sql)
MODULE = (SERVER / "my_inbox.py").read_text(encoding="utf-8")
check("the two tables are additive: created if missing, never altered or dropped; the one DELETE is the prune",
      all(s.startswith("CREATE TABLE IF NOT EXISTS") for s in mi.DDL)
      and not re.search(r"\b(DROP|ALTER|TRUNCATE)\b", MODULE)
      and len(re.findall(r"\bDELETE\b", MODULE)) == 1
      and '"DELETE FROM asa_hub_inbox_reads WHERE user_id=%s "' in MODULE)
sql, conns = with_conn()
notes_read = mi.read_updates("dsn")
check("the release notes are read on a read-only session, from the notes book's tab, and nothing is written",
      conns and conns[0].session.get("readonly") is True
      and any(a == (mi.NOTES_SHEET_ID, mi.UPDATES_TAB) for s, a in sql if "asa_drive_sheets_rows" in s)
      and not any(s.startswith(("INSERT", "CREATE", "UPDATE", "DELETE")) for s, _a in sql) and ("CLOSE", ()) in sql
      and mi.UPDATES_TAB == "REFERENCE-production_apps"
      and mi.NOTES_SHEET_ID == "1BTuqU6xZHmo_jfI49rU3a6el2BB1pFMnCeS5bZBTbY4", sql)
check("…and a tab the mirror does not hold is said, never an empty list",
      notes_read == {"why": "the release notes are not in the mirror"}, notes_read)
mi.psycopg2.connect = REFUSE_CONNECT
check("a mirror that cannot be reached is said with the error's type",
      mi.read_updates("dsn") == {"why": "the release notes could not be read (RuntimeError)"})

# ── software updates (the release notes) ────────────────────────────────────
print("\nsoftware updates")
up = its(B, "updates")
UP_TITLES = sorted(i["title"] for i in up)
check("one alert per Live line; a line that is not Live is never listed",
      UP_TITLES == sorted(["Houses updated", "Relay updated", "My Work is new",
                           "Release Users / Client Care / Headers updated", "Production Actions updated",
                           "Potential Clients updated", "Smart Comms updated", "Privacy updated", "Security updated",
                           "Time Off updated"])
      and not any("My Calendar" in t or "Compliance" in t for t in UP_TITLES), UP_TITLES)
check("a line still the master's alone (until released, or a master-only section) is hidden from staff",
      not any(i["title"].startswith("My Profile") for i in up)
      and not any("settings section" in i["body"].lower() for i in up), UP_TITLES)
mb_up = its(run(subject=MASTER)[0], "updates")
check("…and shown to the master",
      "My Profile is new" in [i["title"] for i in mb_up] and any("A settings section" in i["body"] for i in mb_up)
      and len(mb_up) == len(up) + 2, [i["title"] for i in mb_up])
chosen_up = its(run(subject=STAFF, readonly=True)[0], "updates")
check("a chosen person is judged as themselves: the master's look never shows them a master-only line",
      [i["id"] for i in chosen_up] == [i["id"] for i in up])
STAFF_ACC = access(*[a for a in ALL_APPS if a not in ("production-actions", "release-users")])
shut_up = its(run(acc=STAFF_ACC)[0], "updates")
check("a line about an app the person cannot open is not listed; one naming several apps needs every one",
      sorted(i["title"] for i in shut_up) == sorted(t for t in UP_TITLES if t not in (
          "Production Actions updated", "Release Users / Client Care / Headers updated")), [i["title"] for i in shut_up])
none_open = its(run(acc=access())[0], "updates")
check("a line that names no app (relay, privacy, security, Smart Comms) goes to everybody",
      sorted(i["title"] for i in none_open) == ["Privacy updated", "Relay updated", "Security updated",
                                                 "Smart Comms updated"], [i["title"] for i in none_open])
houses = next(i for i in up if i["title"] == "Houses updated")
check("the body is the activity on one line, then the version",
      houses["body"] == "Clients may file incidents from their house page · fe0cffa1 · Apps Script 2026-09-24T19:24:32Z"
      and next(i for i in up if i["title"] == "Smart Comms updated")["body"] == "Test mode fails closed"
      and houses["link"] is None and houses["flag"] is False, houses)
long_one = next(i for i in up if i["title"] == "Time Off updated")
check("a long activity is cut, never the version", len(long_one["body"]) == 300
      and long_one["body"].endswith("… · 4a5a1861"), long_one["body"][-20:])
UP_AT = {i["title"]: i["at"] for i in up}
check("the Date is an Ohio day: a written day as written, M/D/YYYY, a zoned instant on its Ohio day, and a time "
      "with no zone on the day written — never a UTC midnight",
      UP_AT["Houses updated"] == "2026-09-24" and UP_AT["My Work is new"] == "2026-09-25"
      and UP_AT["Privacy updated"] == "2026-09-24" and UP_AT["Security updated"] == "2026-09-23", UP_AT)
check("…the day parser alone",
      mi.update_day("2026-09-24") == date(2026, 9, 24) and mi.update_day("2026-09-24T00:00:00") == date(2026, 9, 24)
      and mi.update_day("2026-09-25T03:59:00Z") == date(2026, 9, 24)
      and mi.update_day("2026-09-25T04:00:00Z") == date(2026, 9, 25)
      and mi.update_day("2026-09-24T23:30:00-04:00") == date(2026, 9, 24)
      and mi.update_day("9/24/2026") == date(2026, 9, 24) and mi.update_day("2026-02-30") is None
      and mi.update_day("") is None and mi.update_day("someday") is None)
check("a Live line with no day that can be read is not listed, and the gap says so",
      not any(i["title"] == "Settings updated" for i in up)
      and hd(B, "updates")["gap"] == "Not listed: 1 live line with no day that can be read.", hd(B, "updates"))
check("the id is upd:<day>:<folded app>:<folded version>, one the read door takes",
      houses["id"] == "upd:2026-09-24:houses:fe0cffa1appsscript20260924t192432z"
      and "upd:2026-09-25:mywork:449f1d2a" in [i["id"] for i in up]
      and next(i for i in up if i["title"] == "Smart Comms updated")["id"]
      == f"upd:2026-09-27:smartcomms:h{mw._sha10('').lower()}"
      and all(mi.KEY_RE.fullmatch(i["id"]) for i in up + mb_up), [i["id"] for i in up])
released = [dict(r, Status="Live, released") if r["App / area"].startswith("My Profile") else r for r in NOTE_ROWS]
rel_up = its(run(updates={**UPDATES, "rows": released})[0], "updates")
check("ids are stable: the same on every read, and a line released later keeps the id the master's view had",
      [i["id"] for i in its(run()[0], "updates")] == [i["id"] for i in up]
      and next(i["id"] for i in rel_up if i["title"] == "My Profile is new")
      == next(i["id"] for i in mb_up if i["title"] == "My Profile is new"), [i["id"] for i in rel_up])
twice = [note("2026-09-24", "Houses", "Live", "first", "v1"), note("2026-09-24", "Houses", "Live", "second", "v1")]
tw = its(run(updates={**UPDATES, "rows": twice})[0], "updates")
check("a repeated key is numbered in the book's order, so a line added later never takes a read mark; the "
      "newest line of a day is listed first",
      [(i["body"], i["id"]) for i in tw] == [("second · v1", "upd:2026-09-24:houses:v1.2"),
                                             ("first · v1", "upd:2026-09-24:houses:v1")], tw)


def up_ids(rows, subject=None, acc=None):
    return [(i["body"], i["id"]) for i in its(run(subject=subject, acc=acc,
                                                  updates={**UPDATES, "rows": rows})[0], "updates")]


hidden_first = [note("2026-09-24", "Houses", "Live (master-only until released)", "first", "v1"),
                note("2026-09-24", "Houses", "Live", "second", "v1")]
released_first = [dict(hidden_first[0], Status="Live, released"), hidden_first[1]]
building_first = [dict(hidden_first[0], Status="Building"), hidden_first[1]]
check("a repeated key is numbered over every dated line before any is hidden: the id a person sees never "
      "depends on who looks, nor on an earlier line's later release or status",
      up_ids(hidden_first) == [("second · v1", "upd:2026-09-24:houses:v1.2")]
      and up_ids(hidden_first, subject=MASTER) == [("second · v1", "upd:2026-09-24:houses:v1.2"),
                                                   ("first · v1", "upd:2026-09-24:houses:v1")]
      and up_ids(released_first) == up_ids(hidden_first, subject=MASTER)
      and up_ids(building_first) == [("second · v1", "upd:2026-09-24:houses:v1.2")],
      [up_ids(hidden_first), up_ids(released_first), up_ids(building_first)])
DECORATED = [
    note("2026-09-26", "App Control (grants)", "Live", "Grants by badge", "a1"),
    note("2026-09-26", "My Inbox - NEW APP", "Live", "One screen for alerts", "b2"),
    note("2026-09-26", "Calendar Builder (Swaps)", "Live", "Swap answers", "c3"),
    note("2026-09-26", "My Work — Settings", "Live", "Settings grouped", "d4"),
    note("2026-09-26", "My Inbox (alerts)", "Live", "Alerts grouped", "e5"),
    # a new app whose words spell no registry name ("Staff Board" would name the Staff app)
    note("2026-09-26", "Rota Board (NEW APP — master-only)", "Live", "A board", "f6"),
    note("2026-09-26", "Rota Board [NEW APP]", "Live", "A board", "f7"),
    note("2026-09-26", "Houses", "Live (master's alone until released)", "A tab", "g8"),
    note("2026-09-26", "My Profile (master-only)", "Live", "A section", "h9"),
    note("2026-09-26", "Relay", "Live", "Relay note", "i0"),
]
SHOWN = ["App Control (grants) updated", "Calendar Builder (Swaps) updated", "My Inbox (alerts) updated",
         "My Inbox is new", "My Work — Settings updated", "Relay updated"]


def dec_titles(subject=None, shut=()):
    acc = access(*[a for a in ALL_APPS if a not in shut])
    return sorted(i["title"] for i in its(run(subject=subject, acc=acc,
                                              updates={**UPDATES, "rows": DECORATED})[0], "updates"))


check("a qualified area still names its app, and the line is gated by it",
      dec_titles() == SHOWN
      and dec_titles(shut=("app-control",)) == [t for t in SHOWN if not t.startswith("App Control")]
      and dec_titles(shut=("my-inbox",)) == [t for t in SHOWN if not t.startswith("My Inbox")]
      and dec_titles(shut=("calendarbuilder",)) == [t for t in SHOWN if not t.startswith("Calendar Builder")]
      and dec_titles(shut=("my-work",)) == [t for t in SHOWN if not t.startswith("My Work")]
      and dec_titles(shut=ALL_APPS) == ["Relay updated"], [dec_titles(), dec_titles(shut=("app-control",))])
check("a master's-alone mark in the App / area or the Status, and a new app the map cannot name, are hidden "
      "from staff and shown to the master, the marks never in the title",
      dec_titles(subject=MASTER) == sorted(SHOWN + ["Houses updated", "My Profile updated", "Rota Board is new",
                                                    "Rota Board is new"]), dec_titles(subject=MASTER))
check("a line marked master-only in its App / area keeps its id once the mark is taken off",
      up_ids([note("2026-09-26", "My Profile (master-only)", "Live", "A section", "h9")], subject=MASTER)
      == up_ids([note("2026-09-26", "My Profile", "Live", "A section", "h9")])
      == [("A section · h9", "upd:2026-09-26:myprofile:h9")])
check("the master's-alone words: master-only, master only, the master's alone, masters only; never a bare "
      "'master'",
      all(mi.masters_alone({"Status": s}) for s in ("Live (master-only until released)", "Live, master only",
                                                    "Live (the master's alone until released)",
                                                    "Live (master’s alone)", "Live — masters only"))
      and mi.masters_alone({"Status": "Live", "App / area": "X (NEW APP — master-only)"})
      and not any(mi.masters_alone({"Status": s, "App / area": "Master Data"})
                  for s in ("Live", "Live, released", "Live (master copy refreshed)")))
um = FakeStore(moves=MOVES)
um.marks_table[("u-ann", houses["id"])] = {"read_at": NOW, "dismissed_at": None}
um.marks_table[("u-ann", "upd:2026-09-24:relay:471f756b")] = {"read_at": NOW, "dismissed_at": NOW}
marked_up = its(run(store=um)[0], "updates")
check("read marks work on updates: a read one reads, a cleared one is gone, and they are never let go early",
      next(i for i in marked_up if i["id"] == houses["id"])["read"] is True
      and not any(i["title"] == "Relay updated" for i in marked_up) and "upd" not in mi.PRUNE_KINDS, marked_up)
check("the head: ready, as of the copy, with its note",
      hd(B, "updates")["state"] == "ready" and hd(B, "updates")["as_of"] == "2026-09-25T15:00:00Z"
      and hd(B, "updates")["label"] == "Software updates" and "release notes" in hd(B, "updates")["note"]
      and hd(B, "updates")["count"] == len(up), hd(B, "updates"))


def up_head(**over):
    return hd(run(updates={**UPDATES, **over})[0], "updates")


gone_up = run(updates={"why": "the release notes are not in the mirror"})[0]
check("an unreadable copy is an unreadable head in its words, never an empty list",
      hd(gone_up, "updates")["state"] == "unreadable" and not its(gone_up, "updates")
      and hd(gone_up, "updates")["why"] == "the release notes are not in the mirror", hd(gone_up, "updates"))
check("…and a relay that did not read them says so",
      hd(run(updates=None)[0], "updates")["state"] == "unreadable"
      and "not read on this server" in hd(run(updates=None)[0], "updates")["why"])
check("a copy whose last pass failed is said stale, with its age",
      "did not finish (error); the copy is 1 hour old" in up_head(book={**UPDATES["book"],
                                                                      "last_sync_status": "error"})["gap"])
check("a book changed after its copy is said, with the copy's age",
      "changed after they were copied" in up_head(book={**UPDATES["book"],
                                                       "modified_time": "2026-09-25T15:30:00Z"})["gap"]
      and "3 days old" in up_head(as_of="2026-09-22T12:00:00Z", book={**UPDATES["book"],
                                                                     "modified_time": "2026-09-25T15:30:00Z"})["gap"])
check("a book the mirror keeps no word on, or whose word could not be read, is said",
      "keeps no word" in up_head(book=None)["gap"]
      and "could not be told (OperationalError)" in up_head(book=None, book_why="OperationalError")["gap"])
check("an old copy of a quiet book is no gap: its age is the head's as_of",
      up_head(as_of="2026-09-01T12:00:00Z")["gap"] == "Not listed: 1 live line with no day that can be read.")


class NotesStore:
    def __init__(self, rows=None, error=None, book=None, book_error=None):
        self.rows, self.error, self.book_row, self.book_error = rows or [], error, book, book_error
        self.calls, self.closed = [], False

    def tab(self, sid, tab):
        self.calls.append((sid, tab))
        if self.error is not None:
            raise self.error
        return list(self.rows), len(self.rows), "2026-09-25T15:00:00Z"

    def book(self, sid):
        if self.book_error is not None:
            raise self.book_error
        return self.book_row

    def close(self):
        self.closed = True


ns_ok = NotesStore(rows=NOTE_ROWS, book=UPDATES["book"])
check("read_updates: the rows, the copy's stamp and the mirror's word; a store it was handed is not closed",
      mi.read_updates("dsn", store=ns_ok) == {"rows": NOTE_ROWS, "as_of": "2026-09-25T15:00:00Z",
                                              "book": UPDATES["book"], "book_why": ""}
      and ns_ok.calls == [(mi.NOTES_SHEET_ID, mi.UPDATES_TAB)] and not ns_ok.closed)
check("…an empty tab, a failed read, or columns that moved are unreadable",
      mi.read_updates("dsn", store=NotesStore()) == {"why": "the release notes are not in the mirror"}
      and mi.read_updates("dsn", store=NotesStore(error=RuntimeError("down")))
      == {"why": "the release notes could not be read (RuntimeError)"}
      and "carry no Date, App / area and Status columns" in mi.read_updates(
          "dsn", store=NotesStore(rows=[{"When": "2026-09-24", "What": "x"}]))["why"])
check("…and a book record that could not be read keeps the rows and says why",
      mi.read_updates("dsn", store=NotesStore(rows=NOTE_ROWS, book_error=RuntimeError("x")))["book_why"]
      == "RuntimeError")
check("the door asks access only for the apps the Live lines name",
      mi.updates_apps(UPDATES) == ["clients", "houses", "my-profile", "my-work", "potential-clients",
                                   "production-actions", "release-users", "timeoff"]
      and mi.updates_apps({"why": "down"}) == [] and mi.updates_apps(None) == [], mi.updates_apps(UPDATES))
check("an area names an app by its whole registry name, else by its parts; a platform note names none",
      mi.area_apps("Release Users / Client Care / Headers") == ["clients", "release-users"]
      and mi.area_apps("Client Care") == ["clients"] and mi.area_apps("Clients") == ["client-profiles"]
      and mi.area_apps("Care Plans / ISP") == ["care-plans"] and mi.area_apps("Audits & Compliance") == ["audits"]
      and mi.area_apps("Shift Requests") == ["calendarbuilder"] and mi.area_apps("Swaps") == ["calendarbuilder"]
      and mi.area_apps("My Work") == ["my-work"] and mi.area_apps("Time Off") == ["timeoff"]
      and mi.area_apps("TimeOff") == ["timeoff"] and mi.area_apps("Meal Tracker") == ["meals"]
      and all(mi.area_apps(p) == [] for p in ("Relay", "Privacy", "Security", "Smart Comms", "Punches", "Settings"))
      and mi.update_area("My Inbox (NEW APP)") == ("My Inbox", True) and mi.update_area(" Houses ") == ("Houses", False))
STAFF_WORD = {"Staff": ["staff-profiles"], "Locations — Staff tab": ["locations"], "Smart Comms: Staff Broadcast": [],
              "Staff Issues": ["staffissues"], "Staff Performance (notes)": ["performance"], "New staff alerts": []}
check("the Staff app is named only by an area that is Staff alone, never by the word inside another line",
      {a: mi.area_apps(mi.update_area(a)[0]) for a in STAFF_WORD} == STAFF_WORD
      and mi.area_apps(mi.update_area("Staff (NEW APP — master-only)")[0]) == ["staff-profiles"],
      {a: mi.area_apps(mi.update_area(a)[0]) for a in STAFF_WORD})
SSA_WORD = {"SSA": ["ssa-profiles"], "SSA (NEW APP)": ["ssa-profiles"], "Clients — SSA contacts": ["client-profiles"],
            "ISP Library: SSA names": ["isp"]}
check("…and so is the SSA app: SSA alone, never the word inside a Clients or ISP line",
      {a: mi.area_apps(mi.update_area(a)[0]) for a in SSA_WORD} == SSA_WORD,
      {a: mi.area_apps(mi.update_area(a)[0]) for a in SSA_WORD})
FAMILIES_WORD = {"Families": ["family-profiles"], "Families (NEW APP)": ["family-profiles"],
                 "Family Portal — what families see": ["family"], "Clients — families' contacts": ["client-profiles"]}
check("…and so is the Families app: Families alone, never the word inside a Family Portal or Clients line",
      {a: mi.area_apps(mi.update_area(a)[0]) for a in FAMILIES_WORD} == FAMILIES_WORD,
      {a: mi.area_apps(mi.update_area(a)[0]) for a in FAMILIES_WORD})
DECORATED_AREAS = {
    "App Control (grants)": ["app-control"], "My Work (Settings section)": ["my-work"],
    "App Control — grants": ["app-control"], "My Work — Settings": ["my-work"],
    "Calendar Builder (Swaps)": ["calendarbuilder"], "Calendar Builder: Swaps": ["calendarbuilder"],
    "My Inbox (alerts)": ["my-inbox"], "My Profile (master-only)": ["my-profile"], "Houses page": ["houses"],
    "Potential Clients": ["potential-clients"], "My Calendar": ["my-calendar"],
    "Compliance Engine": ["compliance-engine"], "My Calendar / Calendar Builder": ["calendarbuilder", "my-calendar"],
}
check("…and a qualified name still names its app: every run of words that spells one, the longest where they nest",
      {a: mi.area_apps(mi.update_area(a)[0]) for a in DECORATED_AREAS} == DECORATED_AREAS,
      {a: mi.area_apps(mi.update_area(a)[0]) for a in DECORATED_AREAS})
NEW_MARKS = {"My Inbox - NEW APP": ("My Inbox", True), "NEW APP: My Inbox": ("My Inbox", True),
             "My Inbox [NEW APP]": ("My Inbox", True), "My Inbox (new app)": ("My Inbox", True),
             "X (NEW APP — master-only)": ("X", True), "My Profile (master-only)": ("My Profile", False),
             "My Work — NEW APP — Settings": ("My Work — Settings", True),
             "App Control (grants)": ("App Control (grants)", False), "New Applicants": ("New Applicants", False)}
check("a new-app mark is found in brackets, after a dash or a colon, or before one, and is never part of the name",
      {a: mi.update_area(a) for a in NEW_MARKS} == NEW_MARKS, {a: mi.update_area(a) for a in NEW_MARKS})
REG = {p.name: p.read_text(encoding="utf-8") for p in (ROOT / "src" / "registry").glob("*.ts")}
# The renamed queue and the new Support Requests are declared by the screen's half of the same change. Until that
# registry is in this checkout they stand in exactly as the interface names them; once it is, its files decide.
SR_STAND_IN = not any("'support-desk'" in t for t in REG.values())
if SR_STAND_IN:
    REG["apps-requests.ts"] = REG["apps-requests.ts"].replace("    name: 'Support Requests',\n",
                                                              "    name: 'Support Requests Queue',\n", 1)
    REG["apps-support-desk.ts"] = ("export const SUPPORT_DESK_APP_ID = 'support-desk'\n"
                                   "export const supportDeskManifests = [\n  {\n    id: SUPPORT_DESK_APP_ID,\n"
                                   "    name: 'Support Requests',\n    tagline: 'stand-in',\n  },\n]\n")
check("the support apps are read from src/registry, or stand in as the interface declares them until it lands",
      ("    name: 'Support Requests Queue',\n" in REG["apps-requests.ts"]
       and any("'support-desk'" in t for t in REG.values())), "stand-in" if SR_STAND_IN else "src/registry")
REG_CONSTS ={m.group(1): m.group(2) for t in REG.values() for m in re.finditer(r"\bconst (\w+) = '([^']+)'", t)}
REG_PAIRS = {(m.group(1) or REG_CONSTS.get(m.group(2), ""), m.group(3)) for t in REG.values()
             for m in re.finditer(r"\bid: (?:'([a-z0-9-]+)'|([A-Z_]+)),(?:\s*//[^\n]*)*\s*name: '([^']+)'", t)}
check("every app the map names is declared in src/registry under that very name; Smart Comms is left out",
      all((aid, name) in REG_PAIRS for name, aid in mi._REGISTRY_APPS) and len(mi._REGISTRY_APPS) >= 100
      and "smartcomms" not in mi.UPDATE_APPS.values() and ("smartcomms", "Smart Comms") in REG_PAIRS,
      [(n, a) for n, a in mi._REGISTRY_APPS if (a, n) not in REG_PAIRS])
# an app manifest's name is followed by its tagline; a sample person's is not
REG_APPS = {(m.group(1) or REG_CONSTS.get(m.group(2), ""), m.group(3)) for t in REG.values()
            for m in re.finditer(r"\bid: (?:'([a-z0-9-]+)'|([A-Z_]+)),(?:\s*//[^\n]*)*\s*name: '([^']+)',"
                                 r"(?:\s*//[^\n]*)*\s*tagline:", t)}
MAP_PAIRS = {(a, n) for n, a in mi._REGISTRY_APPS}
check("…and every app src/registry declares is in the map under each of its names, so a new app is never an "
      "area the map cannot name",
      len(REG_APPS) >= 100 and {p for p in REG_APPS if p[0] != "smartcomms"} <= MAP_PAIRS,
      sorted({p for p in REG_APPS if p[0] != "smartcomms"} - MAP_PAIRS))
SUPPORT_AREAS = {"Support Requests Queue": ["support-requests"], "Support Requests": ["support-desk"],
                 "Support Requests (NEW APP)": ["support-desk"],
                 "Support Requests Queue — rename": ["support-requests"]}
check("a release line about the renamed queue names the queue; one about Support Requests names the new app",
      {a: mi.area_apps(mi.update_area(a)[0]) for a in SUPPORT_AREAS} == SUPPORT_AREAS
      and ("Support Requests Queue", "support-requests") in mi._REGISTRY_APPS
      and ("Support Requests", "support-desk") in mi._REGISTRY_APPS
      and ("Support Requests", "support-requests") not in mi._REGISTRY_APPS,
      {a: mi.area_apps(mi.update_area(a)[0]) for a in SUPPORT_AREAS})
cb = REG["apps-calendarbuilder.ts"]
check("…and each other name is one src gives that app",
      "customFeature: 'shifts/ShiftRequestsPage'" in cb and "title: 'Swaps'" in cb
      and "title: 'Employee Tracker'" in REG["apps-employeetracker.ts"] and mi.LABELS.get("hiring") == "Hiring"
      and all(aid in {a for a, _n in REG_PAIRS} for _n, aid in mi._APP_ALIASES))

# ── Settings > My Work: the Sources list ────────────────────────────────────
print("\nSettings > My Work — the Sources list")
LANE_HIDE = {"my_work_hide": {"inbox_sources": True}}
FOUR_HIDDEN = {"my_work_hide": {"header": True, "source_notes": True, "missing_row": True, "completed": True}}


def shown_as(mode, lane, board=None):
    data = json.loads(json.dumps(board if board is not None else B))
    return mi.apply_display(data, mw.display_for(mode, mw.hide_from_lane(lane)))


def words_of(h):
    return [w for w in (h.get("why"), h.get("note"), h.get("gap")) if w]


def dump(x):
    return json.dumps(x, ensure_ascii=False)


check("the part is My Work's fifth, parsed from the lane: only a real true hides it",
      "inbox_sources" in mw.HIDE_PARTS and mw.hide_from_lane(LANE_HIDE)["parts"]["inbox_sources"] is True
      and mw.hide_from_lane({"my_work_hide": {"inbox_sources": "yes"}})["parts"]["inbox_sources"] is False
      and mw.hide_from_lane(FOUR_HIDDEN)["parts"]["inbox_sources"] is False)
S_HID = shown_as(mw.MODE_OWN, LANE_HIDE)
check("hidden for a session: no head leaves the relay — no source, no sentence, nothing not on the platform",
      S_HID["heads"] == [] and S_HID["display"] == {"hidden": {"inbox_sources": True}}
      and not any(w in dump(S_HID) for h in B["heads"] for w in words_of(h)),
      [w for h in B["heads"] for w in words_of(h) if w in dump(S_HID)])
check("…while the alerts, the unread count, the marks and the rest are the board's own",
      S_HID["items"] == B["items"] and S_HID["unread"] == B["unread"] and S_HID["marks"] == B["marks"]
      and S_HID["subject"] == B["subject"] and S_HID["capped"] == B["capped"])


def synthetic(*heads):
    return {"heads": list(heads) + mi.not_on_platform(), "items": []}


READY = mi.head("requests", mi.STATE_READY, count=0)
WHOLE_CASES = {
    "every source ready": (synthetic(READY, mi.head("punch", mi.STATE_READY, count=0)), True),
    "a shut app holds nothing for the person": (synthetic(READY, mi.head("hiring", mi.STATE_CLOSED, "shut")), True),
    "a held source": (synthetic(READY, mi.head("notices", mi.STATE_HELD, "test mode")), False),
    "an unreadable source": (synthetic(READY, mi.head("punch", mi.STATE_UNREADABLE, "no board")), False),
    "a source not tied to the person": (synthetic(READY, mi.head("requests", mi.STATE_NOT_ATTRIBUTABLE, "x")), False),
    "a ready source with a gap": (synthetic(mi.head("punch", mi.STATE_READY, count=0, gap="no clock")), False),
    "no source at all": ({"heads": mi.not_on_platform(), "items": []}, False),
}
got_whole = {k: shown_as(mw.MODE_OWN, LANE_HIDE, b).get("whole") for k, (b, _w) in WHOLE_CASES.items()}
check("…and `whole` says only whether every source landed, so the empty sentence never says nothing over one that "
      "did not", got_whole == {k: w for k, (_b, w) in WHOLE_CASES.items()}, got_whole)
M_HID = shown_as(mw.MODE_MASS, LANE_HIDE)
check("the master's own session keeps every head and is told the list is hidden from everyone else",
      M_HID["heads"] == B["heads"] and "whole" not in M_HID
      and M_HID["display"] == {"hidden": {"inbox_sources": False}, "for_users": {"inbox_sources": True},
                               "readable": True, "why": ""}, M_HID["display"])
S_SHOWN = shown_as(mw.MODE_OWN, None)
check("no lane (a relay that has not read it yet): every head is sent, and the session is told nothing else",
      S_SHOWN["heads"] == B["heads"] and "whole" not in S_SHOWN
      and S_SHOWN["display"] == {"hidden": {"inbox_sources": False}}, S_SHOWN["display"])
S_OLD = shown_as(mw.MODE_OWN, FOUR_HIDDEN)
check("a backend without the fifth key hides nothing here, whatever it hides on My Work, and no My Work part is named",
      S_OLD["heads"] == B["heads"] and S_OLD["display"] == {"hidden": {"inbox_sources": False}}, S_OLD["display"])
BROKEN = {"my_work_hide_unreadable": "the tab could not be opened", "my_work_hide": {"inbox_sources": True}}
S_BROKEN, M_BROKEN = shown_as(mw.MODE_OWN, BROKEN), shown_as(mw.MODE_MASS, BROKEN)
check("an unreadable setting hides nothing; only the master's own session hears why",
      S_BROKEN["heads"] == B["heads"] and S_BROKEN["display"] == {"hidden": {"inbox_sources": False}}
      and "could not be opened" not in dump(S_BROKEN)
      and M_BROKEN["display"]["readable"] is False and "the tab could not be opened" in M_BROKEN["display"]["why"]
      and M_BROKEN["display"]["for_users"] == {"inbox_sources": False}, [S_BROKEN["display"], M_BROKEN["display"]])

# ── the relay's doors ───────────────────────────────────────────────────────
print("\na client-role account (family_board: New staff from the backend's myFamily read, and the company notices)")
JANE = {"uid": "u-jane", "role": "client", "types": "", "is_master": False, "label": ""}
FAM_ACCESS = {"staff-profiles": {"open": True, "why": ""}}
FAM_SHUT = {"staff-profiles": {"open": False, "why": "Staff is not open to this account."}}
FAMILY_TYPES = {"new_staff", "notices"}
FAMILY = {"family": True, "part": "inbox", "viewer": "guardian", "linked": True, "ward": {"name": "Jane Doe"},
          "why": "", "read_at": "2026-09-25T15:00:00.000Z", "window_days": 14,
          "house_codes": ["ABD4708", "abd4708", "not a code", 7], "houses_why": "",
          "heads": [
              {"key": "new_staff", "label": "x", "state": "ok", "why": "", "count": 4,
               "gap": "The PSI punches could not be read."},
              {"key": "incidents", "label": "x", "state": "ok", "why": "", "count": 1}],
          "items": [
              {"id": "fam:staff:0a1b2c3d4e", "type": "new_staff", "title": "New staff at Jane Doe’s house: Nia New",
               "at": D(-2), "flag": True, "staff": "nianew", "body": "A NARRATIVE THAT NEVER LEAVES",
               "link": {"href": "//evil.test"}},
              {"id": "fam:staff:1a1b2c3d4e", "type": "new_staff", "title": "New staff at Jane Doe’s house: Pat Punch",
               "at": D(-4), "staff": "../../users"},
              {"id": "fam:staff:5a1b2c3d4e", "type": "new_staff", "title": "New staff at Jane Doe’s house: Cleared",
               "at": D(-5), "staff": "cleared"},
              {"id": "fam:inc:2a1b2c3d4e", "type": "incidents", "title": "AN INCIDENT POINTER", "at": D(-1)},
              {"id": "fam:dr:3a1b2c3d4e", "type": "new_staff", "title": "A POINTER KEY", "at": D(-1)},
              {"id": "req:time_off:TO1:open", "type": "new_staff", "title": "A STAFF KEY", "at": D(-1)},
              {"id": "fam:staff:4a1b2c3d4e", "type": "new_staff", "title": "NO DAY", "at": "someday"},
              "not an item"]}
HOUSE_NEWS = {"notices": [
    {"id": 41, "kind": "decided", "title": "Ann Roe takes the shift at JH", "body": "Sat 9/26 · 8A-4P",
     "at": "2026-09-25T13:00:00+00:00", "published_at": "2026-09-25T13:01:00+00:00", "house": "ABD4708",
     "read": True},
    {"id": 42, "kind": "filled", "title": "Bea Two takes the shift at JH", "body": "Sat 9/27 · 4P-12A",
     "at": "2026-09-24T13:00:00+00:00", "published_at": "2026-09-24T13:01:00+00:00", "house": "ABD4708",
     "read": False},
    {"id": "nope", "title": "NO ID"}], "held": "", "truncated": False}
NOTICES_ASKED: list = []


def house_news(houses):
    NOTICES_ASKED.append(list(houses))
    return json.loads(json.dumps(HOUSE_NEWS))


def fam_board(family=FAMILY, acc=FAM_ACCESS, notices=house_news, store=None, **k):
    NOTICES_ASKED.clear()
    fam = json.loads(json.dumps(family)) if family is not None else None
    store = store if store is not None else FakeStore()
    return mi.family_board("dsn", subject=JANE, family=fam, access=acc, notices=notices, store=store, now=NOW,
                           **k), store


fstore = FakeStore()
fstore.marks_table[("u-jane", "fam:staff:0a1b2c3d4e")] = {"read_at": NOW, "dismissed_at": None}
fstore.marks_table[("u-jane", "fam:staff:5a1b2c3d4e")] = {"read_at": NOW, "dismissed_at": NOW}
FB, _fs = fam_board(store=fstore)
FBLOB = json.dumps(FB)
check("the heads are New staff and Company notices, nothing else — no staff source, no update, no pointer and no "
      "not-on-the-platform line",
      [h["key"] for h in FB["heads"]] == ["new_staff", "notices"] and [k for k, _l in mi.FAMILY_SOURCES] ==
      ["new_staff", "notices"] and {i["type"] for i in FB["items"]} == FAMILY_TYPES,
      [h["key"] for h in FB["heads"]])
check("New staff is the backend's, in the inbox's words: ready, with the gap it said and the time it read",
      hd(FB, "new_staff")["state"] == "ready" and hd(FB, "new_staff")["gap"] == "The PSI punches could not be read."
      and hd(FB, "new_staff")["as_of"] == "2026-09-25T15:00:00Z" and hd(FB, "new_staff")["count"] == 2,
      hd(FB, "new_staff"))
check("only a fam:staff: key of the new_staff kind with a readable day is listed, field by field — no body, no "
      "flag and no link it sent, no pointer of an old kind",
      [i["id"] for i in its(FB, "new_staff")] == ["fam:staff:0a1b2c3d4e", "fam:staff:1a1b2c3d4e"]
      and all(i["body"] == "" and i["flag"] is False for i in its(FB, "new_staff"))
      and not any(w in FBLOB for w in ("NARRATIVE", "evil.test", "POINTER", "A STAFF KEY", "NO DAY", "../")),
      its(FB, "new_staff"))
check("the link is Staff's basic profile of that staff member, only for a staff key and only while Staff is open",
      its(FB, "new_staff")[0]["link"] == {"href": "/app/staff-profiles/profile?staff=nianew", "label": "Open in Staff"}
      and its(FB, "new_staff")[1]["link"] is None
      and all(i["link"] is None for i in fam_board(acc=FAM_SHUT)[0]["items"]), its(FB, "new_staff"))
check("the company notices are asked for the houses the backend names — codes only — and listed with the bell's own "
      "id and read state, no link",
      hd(FB, "notices")["state"] == "ready" and hd(FB, "notices")["count"] == 2
      and [i["id"] for i in its(FB, "notices")] == ["srv-41", "srv-42"]
      and its(FB, "notices")[0]["read"] is True and its(FB, "notices")[1]["read"] is False
      and all(i["link"] is None for i in its(FB, "notices")) and "NO ID" not in FBLOB, its(FB, "notices"))
fam_board()
check("…the houses asked are the backend's, upper-cased and cut to real codes", NOTICES_ASKED == [["ABD4708"]],
      NOTICES_ASKED)
check("the account's own marks are joined for New staff: a read one reads, a cleared one leaves; a notice keeps the "
      "bell's marks and is never asked here",
      its(FB, "new_staff")[0]["read"] is True and "fam:staff:5a1b2c3d4e" not in FBLOB
      and FB["unread"] == sum(1 for i in FB["items"] if not i["read"])
      and [(c[1], c[3]) for c in fstore.calls if c[0] == "marks"] == [("u-jane", True)]
      and not any(k.startswith("srv-") for c in fstore.calls if c[0] == "marks" for k in c[2]), fstore.calls)
check("the answer says who reads it and about whom; linked; and whose it is, in the board's shape",
      FB["family"] is True and FB["viewer"] == "guardian" and FB["ward"] == {"name": "Jane Doe"} and FB["linked"] is True
      and FB["subject"] == {"name": "Jane Doe", "key_why": ""} and FB["marks"]["kept"] is True
      and set(FB) >= {"heads", "items", "unread", "capped", "marks", "read_at"}, {k: FB[k] for k in ("viewer", "ward")})
FRO, ro_store = fam_board(readonly=True)
check("a switched session writes nothing and keeps no marks, and says so — and lists what the account is shown",
      all(c[3] is False for c in ro_store.calls if c[0] == "marks") and FRO["marks"]["kept"] is False
      and FRO["marks"]["kept_why"] == mi.KEPT_WHY_ACTING
      and [i["id"] for i in FRO["items"]] == [i["id"] for i in fam_board()[0]["items"]], [ro_store.calls, FRO["marks"]])
UNLINKED = {**FAMILY, "linked": False, "why": "This account is not linked to a client yet."}
FUN, _fu = fam_board(family=UNLINKED)
check("an account tied to no client: both heads are not attributable, in the backend's words; nothing is listed and "
      "no notice is asked",
      all(hd(FUN, k)["state"] == mi.STATE_NOT_ATTRIBUTABLE and "not linked" in hd(FUN, k)["why"]
          for k, _l in mi.FAMILY_SOURCES)
      and FUN["items"] == [] and NOTICES_ASKED == [] and FUN["linked"] is False
      and "not linked" in FUN["subject"]["key_why"], FUN["heads"])
SLOW = "the backend is still reading this account's alerts"
FNONE, _fn = fam_board(family=None, family_why=SLOW)
check("NO ERROR PAGE: a backend that did not answer is two unreadable heads with its words — never a refusal, never "
      "an empty 'nothing', never a notice from a house nobody named",
      [h["state"] for h in FNONE["heads"]] == [mi.STATE_UNREADABLE, mi.STATE_UNREADABLE]
      and all(SLOW in h["why"] for h in FNONE["heads"]) and FNONE["items"] == [] and NOTICES_ASKED == []
      and FNONE["linked"] is None and FNONE["subject"]["key_why"] == "" and FNONE["why"] == ""
      and not any(mi.landed(h) for h in FNONE["heads"]), FNONE)
OLD_BACKEND = {k: v for k, v in FAMILY.items() if k not in ("house_codes", "houses_why", "heads")}
OLD_BACKEND["heads"] = [{"key": "incidents", "state": "ok", "count": 1}]
OLD_BACKEND["items"] = [{"id": "fam:inc:0a1b2c3d4e", "type": "incidents", "title": "AN INCIDENT POINTER",
                         "at": D(-2)}]
FOLD, _fo = fam_board(family=OLD_BACKEND)
check("a backend that has not learned the new answer yet: New staff unreadable, no house so no notice, and none of "
      "its old pointers listed",
      hd(FOLD, "new_staff")["state"] == mi.STATE_UNREADABLE
      and hd(FOLD, "new_staff")["why"] == "the backend did not answer for it"
      and hd(FOLD, "notices")["state"] == mi.STATE_UNREADABLE and hd(FOLD, "notices")["why"] == mi.FAMILY_NO_HOUSES
      and FOLD["items"] == [] and NOTICES_ASKED == [], FOLD["heads"])
NO_HOUSE = {**FAMILY, "house_codes": [], "houses_why": "The client records could not be read (down).",
            "heads": [{"key": "new_staff", "state": "unreadable", "why": "The client records could not be read (down).",
                       "count": None}], "items": []}
FNH, _fh = fam_board(family=NO_HOUSE)
check("houses the backend could not read: both heads unreadable in its words, and no notice is asked",
      hd(FNH, "new_staff")["state"] == mi.STATE_UNREADABLE and "client records" in hd(FNH, "new_staff")["why"]
      and hd(FNH, "notices")["state"] == mi.STATE_UNREADABLE and "client records" in hd(FNH, "notices")["why"]
      and NOTICES_ASKED == [], FNH["heads"])
FPART, _fp = fam_board(family={**FAMILY, "houses_why": "The house registry could not be read (down)."})
check("houses named in part: the notices at those are listed, and the gap says the list may not be whole",
      hd(FPART, "notices")["state"] == mi.STATE_READY and "house registry" in hd(FPART, "notices")["gap"]
      and not mi.landed(hd(FPART, "notices")) and len(its(FPART, "notices")) == 2, hd(FPART, "notices"))
FHELD, _fhe = fam_board(held="test mode")
check("test mode holds the company notices, which are messages, and they are not read; New staff still answers",
      hd(FHELD, "notices")["state"] == mi.STATE_HELD and NOTICES_ASKED == [] and len(its(FHELD, "new_staff")) == 3,
      FHELD["heads"])
FDOWN, _fd = fam_board(notices=lambda houses: (_ for _ in ()).throw(RuntimeError("database away")))
check("a notices lane that fails is unreadable with its reason; New staff still answers",
      hd(FDOWN, "notices")["state"] == mi.STATE_UNREADABLE and "RuntimeError" in hd(FDOWN, "notices")["why"]
      and len(its(FDOWN, "new_staff")) == 3, FDOWN["heads"])
check("a viewer the backend did not name is a client, and a ward it did not name is blank",
      fam_board(family={"linked": True, "viewer": "admin"})[0]["viewer"] == "client")
check("the family keys are keys the read-marks door takes",
      all(mi.KEY_RE.fullmatch(k) and mi.FAMILY_KEY_RE.fullmatch(k) for k in ("fam:staff:0a1b2c3d4e",))
      and not mi.FAMILY_KEY_RE.fullmatch("req:time_off:TO1:open"))

print("\nwho takes a shift at the client's own house (web_notices.house_copy, house_news)")
import web_notices as wn  # noqa: E402

H_JANE, H_OTHER = "CAN - JH - ABD4708", "CAN - XX - BM2704"


def notice_row(nid, kind, facts, location=H_JANE, value="8A-4P", held=False):
    return {"id": nid, "key": f"{kind}:{nid}", "kind": kind, "at": "2026-09-25T13:00:00+00:00", "location": location,
            "col_iso": "2026-09-26", "ref": f"R{nid}", "value": value, "facts": facts,
            "published_at": "2026-09-25T13:01:00+00:00", "held": held}


ROWS_N = [
    notice_row(1, wn.K_DECIDED, {"person": "Ann Roe", "by": "Hal Manager", "how": "approved"}),
    notice_row(2, wn.K_DECIDED, {"person": "Zed Other", "by": "Hal Manager"}, location=H_OTHER),
    notice_row(3, wn.K_CALL_OFF, {"caller": "Ann Roe", "reason": "SICK KID"}),
    notice_row(4, wn.K_FILLED, {"person": "Ann Roe", "how": "approved"}),
    notice_row(5, wn.K_FILLED, {"person": "Bea Two", "how": "claimed"}),
    notice_row(6, wn.K_SWAP_DONE, {"from": "Giver Gil", "to": "Taker Tam", "manager": "Hal Manager"}),
    notice_row(7, wn.K_NO_SHOW, {"person": "Ann Roe", "minutes": 30}),
    notice_row(8, wn.K_APPLICATION, {"person": "Cal Applicant"}),
    notice_row(9, wn.K_TO_SCHEDULED, {"person": "Ann Roe", "houses": ["ABD4708"]}),
    notice_row(10, wn.K_DECIDED, {"person": "Ann Roe"}, location="Somewhere with no code"),
    notice_row(11, wn.K_DECIDED, {"person": ""}),
    notice_row(12, wn.K_DECIDED, {"person": "Held Harry"}, held=True),
    notice_row(13, wn.K_OPEN_SHIFT, {}),
]
COPIES = [wn.house_copy(r, ["abd4708"]) for r in ROWS_N]
check("only who takes a shift at the client's own house: a decision, a direct fill and a finished swap — never "
      "another house, a call-off, an application, attendance, time off or an open shift",
      [c["id"] for c in COPIES if c] == [1, 5, 6], [c for c in COPIES if c])
check("…the swap names who takes it, never who gave it away; nothing names a decider, a reason or a caller",
      COPIES[5]["title"] == "Taker Tam takes the shift at JH" and "Giver" not in json.dumps(COPIES)
      and not any(w in json.dumps(COPIES) for w in ("Hal", "SICK", "approved")), COPIES[5])
check("…a copy is its title, its day and shift, its instant and its house — no link, no facts",
      COPIES[0] == {"id": 1, "kind": wn.K_DECIDED, "title": "Ann Roe takes the shift at JH", "body": "Sat 9/26 · 8A-4P",
                    "at": "2026-09-25T13:00:00+00:00", "published_at": "2026-09-25T13:01:00+00:00",
                    "house": "ABD4708"}, COPIES[0])
check("…a house nobody names hears nothing", all(wn.house_copy(r, []) is None for r in ROWS_N))


class NewsCur:
    def __init__(self, box):
        self.box = box
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, args=None):
        self.box["sql"].append((sql, args))
        if "FROM asa_hub_notices" in sql:
            self.rows = [{**r, "created_at": r["published_at"], "held_test": r["held"]} for r in self.box["rows"]]
        elif "FROM asa_hub_notice_reads" in sql:
            self.rows = [m for m in self.box["reads"] if m["notice_id"] in args[1]]
        else:
            self.rows = []

    def fetchall(self):
        return self.rows


class NewsConn:
    def __init__(self, box):
        self.box = box

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def cursor(self, **k):
        return NewsCur(self.box)

    def commit(self):
        pass


NEWS_BOX = {"sql": [], "rows": ROWS_N, "reads": [{"notice_id": 1, "read_at": NOW, "dismissed_at": None},
                                                 {"notice_id": 5, "read_at": NOW, "dismissed_at": NOW}]}
real_wn_connect = wn._connect
wn._connect = lambda dsn: NewsConn(NEWS_BOX)
try:
    NEWS = wn.house_news("dsn", houses=["ABD4708", "junk"], uid="u-jane")
    news_sql = list(NEWS_BOX["sql"])
    NEWS_BOX["sql"].clear()
    NEWS_HELD = wn.house_news("dsn", houses=["ABD4708"], uid="u-jane", held="test mode")
    NEWS_NONE = wn.house_news("dsn", houses=["junk"], uid="u-jane")
    quiet_sql = list(NEWS_BOX["sql"])
finally:
    wn._connect = real_wn_connect
check("house_news: the copies at the named houses with the account's own marks — a cleared one leaves, a read one "
      "reads — and the read asks only the three kinds and the account's own marks",
      [(n["id"], n["read"]) for n in NEWS["notices"]] == [(1, True), (6, False)] and NEWS["unread"] == 1
      and any("kind = ANY" in s and list(a[1]) == list(wn.HOUSE_NEWS_KINDS) for s, a in news_sql if a)
      and any("asa_hub_notice_reads" in s and a[0] == "u-jane" for s, a in news_sql if a), [NEWS, news_sql])
check("…test mode, or no house, returns none and reads nothing",
      NEWS_HELD["notices"] == [] and NEWS_HELD["held"] == "test mode" and NEWS_NONE["notices"] == []
      and quiet_sql == [], [NEWS_HELD, NEWS_NONE, quiet_sql])

print("\nTHE DOORS")
svc = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
tree = ast.parse(svc)


def segment(name):
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(svc, node) or ""
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == name for t in node.targets):
            return ast.get_source_segment(svc, node) or ""
        if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == name:
            return ast.get_source_segment(svc, node) or ""
    return ""


check("the routes are declared", '@app.get("/hub-lanes/my-inbox")' in svc
      and '@app.post("/hub-lanes/my-inbox/read")' in svc)
check("my_inbox is imported guarded", "try:\n    import my_inbox\nexcept Exception as _my_inbox_import_exc:" in svc)
route = segment("lane_my_inbox")
check("the read is no-store", 'response.headers["Cache-Control"] = "no-store"' in route)
check("neither door registers anybody for the notice stream",
      "_notice_who_put" not in route and "_notice_who_put" not in segment("lane_my_inbox_read")
      and "_notice_who_put" not in segment("_my_inbox_gate"))

calls: list[str] = []
GATE_SAW: list = []
STATE = {"role": "staff", "uid": "u-ann", "released": True, "authme": None, "acting": set(),
         "accounts": [{"uid": "u-bob", "role": "manager", "types": "MANAGER, INTERVIEWER", "label": "Bob Bee"},
                      {"uid": "u-ann", "role": "staff", "types": "STAFF", "label": "Ann Roe"}],
         "switch": {"on": False, "readable": True}, "lane": None, "unchecked": "", "family_delay": 0.0}
# what the stubbed board answers: one source that landed, one that did not, and the not-on-the-platform sentences
DOOR_HEADS = [mi.head("requests", mi.STATE_READY, count=1),
              mi.head("punch", mi.STATE_UNREADABLE, "the punch board could not be read")] + mi.not_on_platform()
DOOR_ITEM = mi.item("req:time_off:TO1:open", "requests", title="Time off", at="2026-09-25")
AUTH_MASTER: dict = {}
VIEWERS: list = []
ACCESS_ASKED: list = []
BOARDS: list = []
MARKED: list = []
NOTICE_WHO: list = []
INBOX_ASKED: list = []


async def _session_actor(authorization):
    return (STATE["role"], STATE["uid"])


SESSION_ASKED: list = []


async def _my_calendar_session(authorization):
    SESSION_ASKED.append((authorization, len(calls)))
    return STATE["unchecked"]


async def _hotline_actor(authorization, app_id="smartcomms", *, refuse_roles=(), app_label="", floor=True):
    calls.append(f"gate:{app_id}")
    seen = AUTH_MASTER.get(authorization[7:].strip())
    if seen is None and not floor:
        seen = False
    GATE_SAW.append(seen)
    if authorization == "Bearer shut":
        return {"status": 403, "message": "My Inbox is not open to you."}
    if seen is True or STATE["released"]:
        return (STATE["role"], STATE["uid"])
    return {"status": 403, "reason": "badge", "message": "My Inbox is not open to you."}


EXEC_SENT: list = []
# what Python's myFamily door is asked: the payload and the identity the relay settled
PY_SENT: list = []


async def _auth_me(token):
    # the relay's own authMe of Python's sign-in
    calls.append("exec:authMe")
    EXEC_SENT.append({"token": token, "action": "authMe"})
    if STATE["authme"] is None:
        raise RuntimeError("no answer")
    return STATE["authme"]


async def _person_photo_user(authorization):
    return {"uid": STATE["uid"], "role": STATE["role"], "is_master": False}


async def _backend_call(app_id, action, payload, user, extra=None, timeout=None):
    calls.append(f"python:{action}")
    PY_SENT.append({"app": app_id, "payload": payload, "user": user})
    if STATE["family_delay"]:
        await asyncio.sleep(STATE["family_delay"])
    got = STATE.get("family")
    if isinstance(got, Exception):
        return None
    return b"", 1.0, json.loads(json.dumps(got)), None, 0.0


class _Unanswered:
    def get(self):
        return "scripted"


class Acting:
    def known(self, token):
        return token in STATE["acting"]


async def run_gate(fn, *args, **kw):
    ACCESS_ASKED.append((args[2], args[3], args[4], kw.get("is_master")))
    return {"open": args[4] != "potential-clients", "why": "shut" if args[4] == "potential-clients" else ""}


def notice_accounts():
    calls.append("accounts")
    if STATE["accounts"] is None:
        raise RuntimeError("mirror down")
    return [dict(a) for a in STATE["accounts"]]


def viewer(dsn, *, name, role="", types=None, is_master=None):
    VIEWERS.append({"name": name, "role": role, "types": types, "is_master": is_master})
    return {"name": name, "role": role, "badges": [], "is_master_seen": is_master}


def board_stub(dsn, **k):
    BOARDS.append(k)
    calls.append(f"board:{k['subject']['uid']}:{'ro' if k['readonly'] else 'rw'}")
    k["requests"]()
    if k["notices"] is not None:
        k["notices"]()
    return {"heads": json.loads(json.dumps(DOOR_HEADS)), "items": [dict(DOOR_ITEM)], "unread": 1}


FAMILY_BOARDS: list = []


def family_board_stub(dsn, **k):
    FAMILY_BOARDS.append(k)
    calls.append(f"family_board:{k['subject']['uid']}:{'ro' if k['readonly'] else 'rw'}")
    return mi.family_board(dsn, store=FakeStore(), now=NOW, **k)


stub_mi = types.SimpleNamespace(APPS=mi.APPS, PERSON_RE=mi.PERSON_RE, READ_MAX=mi.READ_MAX,
                                KEPT_WHY_CHOSEN=mi.KEPT_WHY_CHOSEN, KEPT_WHY_ACTING=mi.KEPT_WHY_ACTING,
                                FAMILY_APPS=mi.FAMILY_APPS, family_board=family_board_stub,
                                split_keys=mi.split_keys, board=board_stub, updates_apps=mi.updates_apps,
                                apply_display=mi.apply_display,
                                read_updates=lambda dsn: calls.append(f"updates:{dsn}") or UPDATES,
                                mark_read=lambda dsn, **k: MARKED.append(("inbox", k)) or len(k["keys"]))
stub_mw = types.SimpleNamespace(
    MODE_MASS=mw.MODE_MASS, scope_verdict=mw.scope_verdict, hide_from_lane=mw.hide_from_lane,
    display_for=mw.display_for,
    identity=lambda dsn, core, uid, roster_name="": calls.append(f"identity:{uid}:{roster_name}") or dict(ME),
    requests_for=lambda dsn, **k: calls.append(f"requests:{k['who']['name']}") or ([], []))
HOUSE_NEWS_ASKED: list = []
stub_wn = types.SimpleNamespace(
    inbox=lambda dsn, **k: INBOX_ASKED.append(k) or {"notices": []},
    house_news=lambda dsn, **k: HOUSE_NEWS_ASKED.append(k) or json.loads(json.dumps(HOUSE_NEWS)),
    mark_read=lambda dsn, **k: MARKED.append(("bell", k)) or len(k["ids"]))
async def _not_on_python() -> bool:
    return False


async def _family_on_apps_script(_app_id):
    return False


ns = {"app": types.SimpleNamespace(get=lambda path: (lambda f: f), post=lambda path: (lambda f: f)),
      # My Family is Python's alone: its door asked with the identity the relay settled
      "_backend_wanted": _family_on_apps_script, "MY_FAMILY_APP": "my-family",
      "_person_photo_user": _person_photo_user, "_backend_call": _backend_call,
      "_BACKEND_UNANSWERED": _Unanswered(),
      "Header": lambda default="": default, "Response": object, "Request": object, "Any": object,
      "asyncio": asyncio, "re": re, "time": time, "log": logging.getLogger("test"),
      "_my_calendar_session": _my_calendar_session,
      "PG_DSN": "dsn", "HUB_DB_SHEET_ID": "core", "MIRROR_TRUST_MAX_S": 7200.0, "OUT_DIR": SNAP,
      "my_work": stub_mw, "my_inbox": stub_mi, "web_notices": stub_wn,
      "_hotline_actor": _hotline_actor, "_session_actor": _session_actor, "_auth_me": _auth_me,
      "_auth_master": AUTH_MASTER, "_acting": Acting(), "_note_session_answer": lambda token, env: None,
      "_notice_accounts": notice_accounts, "_notice_who_put": lambda *a, **k: NOTICE_WHO.append(a),
      "_roster_name_of": lambda uid, strict=False: calls.append(f"name:{uid}") or
      {"u-ann": "Ann Roe", "u-bob": "Bob Bee", "u-boss": "The Boss"}.get(uid, ""),
      "_user_badges": lambda uid: calls.append(f"badges:{uid}") or "STAFF",
      "shift_requests": types.SimpleNamespace(viewer=viewer),
      "hotline_desk": types.SimpleNamespace(run_gate=run_gate, app_access="APP_ACCESS", sheets_client=None),
      "hotline_lanes": types.SimpleNamespace(current_lanes=lambda *a, **k: _lanes()),
      "_web_switch": lambda: dict(STATE["switch"]),
      # the relay's own builder: My Inbox is not on Python here (test-my-inbox-python reads that path)
      "_my_inbox_on": _not_on_python,
      "punch_board_slices": types.SimpleNamespace(BOARD_FILE=BOARD_FILE),
      # the config lane as _config_lane_for hands it: headquarters' answer, or nothing
      "_config_lane_for": lambda place: STATE["lane"] if place == "" else None}


async def _lanes():
    calls.append("lanes")
    return {"lanes": LANES}


for name in ("_hotline_token", "_DAILY_REASONS", "_daily_refusal", "_my_work_acting", "_my_work_learn_master",
             "_MY_INBOX_DOWN", "_MY_INBOX_ROLES_REFUSED", "_MY_INBOX_LANES", "_MY_INBOX_VISIT", "_MY_INBOX_OWN_ONLY",
             "_MY_INBOX_ACTING", "_my_inbox_scope", "_my_inbox_gate", "_my_inbox_access", "_my_inbox_people",
             "_my_work_display", "_MY_FAMILY_WORDS", "_my_family_session", "_my_family_forward",
             "_MY_INBOX_BUDGET_S", "_MY_INBOX_FAMILY_HELD", "_MY_INBOX_FAMILY_ASKING", "_MY_INBOX_FAMILY_FRESH_S",
             "_MY_INBOX_FAMILY_CEILING_S", "_MY_INBOX_FAMILY_HELD_MAX", "_MY_INBOX_FAMILY_REFUSED",
             "_MY_INBOX_FAMILY_SLOW", "_my_inbox_family_fill", "_my_inbox_family_read", "_my_inbox_family",
             "_lane_alerts_off", "lane_my_inbox", "lane_my_inbox_read"):
    code = segment(name)
    check(f"the relay declares {name}", bool(code))
    exec(code, ns)  # noqa: S102 — the relay's own source


def reset():
    for bag in (calls, GATE_SAW, VIEWERS, ACCESS_ASKED, BOARDS, MARKED, INBOX_ASKED, FAMILY_BOARDS, EXEC_SENT,
                PY_SENT, HOUSE_NEWS_ASKED, SESSION_ASKED):
        bag.clear()


def forget_family():
    ns["_MY_INBOX_FAMILY_HELD"].clear()
    ns["_MY_INBOX_FAMILY_ASKING"].clear()


def door(auth="Bearer tok", member="", person=""):
    reset()
    resp = types.SimpleNamespace(headers={})
    got = asyncio.run(ns["lane_my_inbox"](resp, member=member, person=person, authorization=auth))
    return got, list(calls), resp


class Req:
    def __init__(self, body):
        self.body = body

    async def json(self):
        if isinstance(self.body, Exception):
            raise self.body
        return self.body


def post(body, auth="Bearer tok", member=""):
    reset()
    return asyncio.run(ns["lane_my_inbox_read"](Req(body), member=member, authorization=auth)), list(calls)


visit, vcalls, vresp = door(member="u-bob")
check("inside a visit it refuses before any gate or read",
      visit["status"] == 403 and visit["reason"] == "visit" and vcalls == []
      and vresp.headers["Cache-Control"] == "no-store", [visit, vcalls])
shut_d, scalls, _ = door(auth="Bearer shut")
check("a closed App Control row refuses with its reason and reads nothing",
      shut_d["status"] == 403 and scalls == ["gate:my-inbox"], [shut_d, scalls])
okay, ocalls, _ = door()
check("a staff session: the gate, then its own account, its lanes, its access, then an own board that may write",
      okay["status"] == 200 and okay["data"]["scope"] == {"mode": "own", "why": "", "person": "", "readonly": False}
      and ocalls[:5] == ["gate:my-inbox", "name:u-ann", "badges:u-ann", "identity:u-ann:Ann Roe", "lanes"]
      and "board:u-ann:rw" in ocalls and "accounts" not in ocalls, [okay, ocalls])
check("…the access asked is the session's own, as not the master, for every app a source is judged by and "
      "each app a Live release-notes line names, each once",
      sorted(a[2] for a in ACCESS_ASKED) == sorted(set(mi.APPS) | set(mi.updates_apps(UPDATES)))
      and "potential-clients" in mi.APPS and "potential-clients" in mi.updates_apps(UPDATES)
      and all(a[:2] == ("u-ann", "staff") and a[3] is False for a in ACCESS_ASKED), ACCESS_ASKED)
check("…the release notes are read once, and that answer is what the board lists from",
      ocalls.count("updates:dsn") == 1 and BOARDS[0]["updates"] is UPDATES
      and ocalls.index("updates:dsn") < ocalls.index("board:u-ann:rw"), ocalls)
check("…the viewer is the session's own; the bell is read for the session's own account",
      VIEWERS == [{"name": "Ann Roe", "role": "staff", "types": "STAFF", "is_master": False}]
      and INBOX_ASKED[0]["uid"] == "u-ann" and INBOX_ASKED[0]["held"] == "", [VIEWERS, INBOX_ASKED])
check("…and the requests half is My Work's own, as that viewer", "requests:Ann Roe" in ocalls)
check("no scope people list outside mass", "people" not in okay["data"]["scope"])
nope, ncalls, _ = door(person="u-bob")
check("a person asked for in own mode is refused as scope, before anything is read",
      nope["status"] == 403 and nope["reason"] == "scope" and not any(c.startswith(("name:", "board", "accounts"))
                                                                      for c in ncalls), [nope, ncalls])
STATE["switch"] = {"on": True, "readable": False}
held_d, _hc, _ = door()
check("test mode on (or unreadable) holds the notices", BOARDS[0]["held"] == "test mode (unreadable, so treated as on)")
STATE["switch"] = {"on": False, "readable": True}

print("\nthe master's chooser")
STATE.update(role="admin", uid="u-boss")
AUTH_MASTER["tok"] = True
own_m, omc, _ = door()
check("the master's own session: its own alerts, as the master, with the people to choose from",
      own_m["status"] == 200 and own_m["data"]["scope"]["mode"] == "mass" and BOARDS[0]["subject"]["uid"] == "u-boss"
      and BOARDS[0]["subject"]["is_master"] is True and BOARDS[0]["readonly"] is False
      and [p["uid"] for p in own_m["data"]["scope"]["people"]] == ["u-ann", "u-bob"]
      and set(own_m["data"]["scope"]["people"][0]) == {"uid", "label", "role"}, [own_m, omc])
check("…with no config lane nothing is turned off, for the board or the bell",
      BOARDS[0]["alerts_off"] == [] and INBOX_ASKED[0]["who"]["alerts_off"] == [], [BOARDS[0].get("alerts_off")])
STATE["lane"] = {"place": "", "alert_receive_off": {"u-boss": ["no_call", "incident", " "], "u-bob": ["punch"]}}
lane_m, _lmc, _ = door()
check("ALERTS I RECEIVE: the board and the bell are handed what the subject turned off for itself, from the config "
      "lane, and nobody else's choice",
      lane_m["status"] == 200 and BOARDS[0]["alerts_off"] == ["incident", "no_call"]
      and INBOX_ASKED[0]["who"]["alerts_off"] == ["incident", "no_call"] and INBOX_ASKED[0]["uid"] == "u-boss",
      [BOARDS[0].get("alerts_off"), INBOX_ASKED[0].get("who")])
lane_c, _lcc, _ = door(person="u-bob")
check("…a chosen account is judged by its own choice",
      lane_c["status"] == 200 and BOARDS[0]["alerts_off"] == ["punch"]
      and INBOX_ASKED[0]["who"]["alerts_off"] == ["punch"], BOARDS[0].get("alerts_off"))
STATE["lane"] = {"place": "", "alert_receive_off": ["u-boss"]}
lane_bad, _lbc, _ = door()
check("…and a lane whose map is not a map turns nothing off", BOARDS[0]["alerts_off"] == [], BOARDS[0].get("alerts_off"))
STATE["lane"] = None
chosen, ccalls, _ = door(person="u-bob")
check("a chosen account is judged as itself: its role and badges, never the master's flag",
      chosen["status"] == 200 and VIEWERS == [{"name": "Bob Bee", "role": "manager", "types": "MANAGER, INTERVIEWER",
                                               "is_master": False}]
      and all(a[:2] == ("u-bob", "manager") and a[3] is False for a in ACCESS_ASKED)
      and {a[2] for a in ACCESS_ASKED} >= set(mi.updates_apps(UPDATES))
      and BOARDS[0]["subject"] == {"uid": "u-bob", "role": "manager", "types": "MANAGER, INTERVIEWER",
                                   "is_master": False, "label": "Bob Bee"}, [VIEWERS, ACCESS_ASKED[:2]])
check("…read-only, the bell read as that account, nobody registered for its stream, and its badges not re-read",
      BOARDS[0]["readonly"] is True and BOARDS[0]["readonly_why"] == mi.KEPT_WHY_CHOSEN
      and INBOX_ASKED[0]["uid"] == "u-bob" and not NOTICE_WHO and "badges:u-bob" not in ccalls
      and chosen["data"]["scope"]["readonly"] is True and chosen["data"]["scope"]["person"] == "u-bob", ccalls)
not_active, _nac, _ = door(person="u-zed")
check("a person who is not an active account is refused as scope", not_active["status"] == 403
      and not_active["reason"] == "scope" and not BOARDS, not_active)
bad_p, _bpc, _ = door(person="Bob Bee")
check("an id that is not an account id is a 400", bad_p["status"] == 400 and bad_p["reason"] == "person")
STATE["accounts"] = None
no_acc, _nac2, _ = door(person="u-bob")
check("accounts that cannot be read: nobody can be chosen, in words", no_acc["status"] == 502
      and "Nobody can be chosen" in no_acc["message"], no_acc)
own_na, _onc, _ = door()
check("…while the master's own alerts still answer, and the chooser says why it is empty",
      own_na["status"] == 200 and own_na["data"]["scope"]["people"] is None
      and "could not be read" in own_na["data"]["scope"]["people_why"], own_na)
STATE["accounts"] = [{"uid": "u-bob", "role": "manager", "types": "MANAGER", "label": "Bob Bee"}]
STATE["acting"].add("tok")
act, acalls, _ = door()
check("a switched session reads the person it wears, as not the master, read-only, and cannot choose",
      act["data"]["scope"]["mode"] == "own" and BOARDS[0]["subject"]["is_master"] is False
      and BOARDS[0]["readonly"] is True and BOARDS[0]["readonly_why"] == mi.KEPT_WHY_ACTING
      and door(person="u-bob")[0]["reason"] == "scope", [act, BOARDS[:1]])
STATE["acting"].clear()
AUTH_MASTER.clear()
unk, ucalls, _ = door()
check("an admin whose flag is unknown asks authMe once, BEFORE the gate; a failed check is own alerts, in words",
      ucalls.count("exec:authMe") == 1 and ucalls.index("exec:authMe") < ucalls.index("gate:my-inbox")
      and unk["data"]["scope"]["mode"] == "own" and "could not be made" in unk["data"]["scope"]["why"], [unk, ucalls])
STATE.update(released=False)
AUTH_MASTER.clear()
GATE_SAW.clear()
shut_unknown, sucalls, _ = door()
check("unreleased, and the master check failed: the gate sees False (no admin floor) and the refusal says so",
      shut_unknown["status"] == 503 and shut_unknown["reason"] == "unavailable" and GATE_SAW == [False]
      and not any(c.startswith("board") for c in sucalls), [shut_unknown, sucalls])
AUTH_MASTER["tok"] = True
check("…and the master opens it", door()[0]["status"] == 200)
STATE.update(role="staff", uid="u-ann", released=True)
AUTH_MASTER.clear()

print("\nthe Sources switch at the door")
route = segment("lane_my_inbox")
check("the door applies Settings > My Work to the board's answer, judged by the session's own mode",
      'my_inbox.apply_display(data, _my_work_display(scope["mode"]))' in route
      and route.index("my_inbox.apply_display") > route.index("my_inbox.board"))
plain, _plc, _ = door()
check("no config lane: nothing hidden, every head sent, and the session told nothing else",
      plain["status"] == 200 and plain["data"]["heads"] == DOOR_HEADS and "whole" not in plain["data"]
      and plain["data"]["display"] == {"hidden": {"inbox_sources": False}}, plain)
STATE["lane"] = {"place": "", **FOUR_HIDDEN}
old_back = door()[0]
check("a backend without the fifth key hides nothing here, whatever My Work hides",
      old_back["data"]["heads"] == DOOR_HEADS and old_back["data"]["display"] == {"hidden": {"inbox_sources": False}},
      old_back)
STATE["lane"] = {"place": "", "my_work_hide": {"inbox_sources": True}}
staff_h, _shc, _ = door()
check("a staff session with the switch on: no head reaches it, only whether every source landed; its alerts and "
      "unread count stay",
      staff_h["status"] == 200 and staff_h["data"]["heads"] == [] and staff_h["data"]["whole"] is False
      and staff_h["data"]["display"] == {"hidden": {"inbox_sources": True}}
      and staff_h["data"]["items"] == [DOOR_ITEM] and staff_h["data"]["unread"] == 1
      and not any(w in dump(staff_h) for h in DOOR_HEADS for w in words_of(h)), staff_h)
STATE.update(role="admin", uid="u-boss")
AUTH_MASTER["tok"] = True
m_own = door()[0]
M_LINE = {"hidden": {"inbox_sources": False}, "for_users": {"inbox_sources": True}, "readable": True, "why": ""}
check("the master's own session: every head, and told the list is hidden from everyone else",
      m_own["data"]["scope"]["mode"] == "mass" and m_own["data"]["heads"] == DOOR_HEADS
      and "whole" not in m_own["data"] and m_own["data"]["display"] == M_LINE, m_own)
m_chosen = door(person="u-bob")[0]
check("…and so on a person it looks at",
      m_chosen["status"] == 200 and m_chosen["data"]["heads"] == DOOR_HEADS and m_chosen["data"]["display"] == M_LINE,
      m_chosen)
STATE["acting"].add("tok")
m_act = door()[0]
check("the master acting as someone is shown exactly what that person is shown: no head, the same display",
      m_act["data"]["scope"]["mode"] == "own" and m_act["data"]["heads"] == []
      and m_act["data"]["display"] == staff_h["data"]["display"] and m_act["data"]["whole"] == staff_h["data"]["whole"]
      and m_act["data"]["items"] == staff_h["data"]["items"], m_act)
STATE["acting"].clear()
STATE["lane"] = {"place": "", "my_work_hide_unreadable": "the tab could not be opened"}
m_broken = door()[0]
check("an unreadable setting hides nothing, and the master's own session is told why",
      m_broken["data"]["heads"] == DOOR_HEADS and m_broken["data"]["display"]["readable"] is False
      and "the tab could not be opened" in m_broken["data"]["display"]["why"], m_broken)
STATE.update(role="staff", uid="u-ann")
AUTH_MASTER.clear()
s_broken = door()[0]
check("…while a staff session hides nothing and hears nothing about it",
      s_broken["data"]["heads"] == DOOR_HEADS and s_broken["data"]["display"] == {"hidden": {"inbox_sources": False}}
      and "could not be opened" not in dump(s_broken), s_broken)
STATE["lane"] = None

print("\nthe read marks door")
res, pcalls = post({"keys": ["srv-7", "req:a:open", "junk key"], "uid": "u-bob", "user_id": "u-bob",
                    "person": "u-bob", "dismiss": True})
check("marks the session's own account whatever the body names; srv-N to the bell, the rest to the inbox",
      res == {"status": 200, "data": {"marked": 2, "ignored": 1}}
      and MARKED == [("bell", {"uid": "u-ann", "ids": [7], "dismiss": True}),
                     ("inbox", {"uid": "u-ann", "keys": ["req:a:open"], "dismiss": True})], [res, MARKED])
check("it is gated like the read", pcalls[0] == "gate:my-inbox" and post({"keys": ["req:a:open"]},
                                                                         auth="Bearer shut")[0]["status"] == 403)
check("a visit is refused, in the query or the body",
      post({"keys": ["req:a:open"]}, member="u-bob")[0]["reason"] == "visit"
      and post({"keys": ["req:a:open"], "member": "u-bob"})[0]["reason"] == "visit" and not MARKED)
STATE["acting"].add("tok")
acting_post, _ap = post({"keys": ["req:a:open"]})
check("a switched session is refused 409 and nothing is written", acting_post["status"] == 409
      and acting_post["code"] == "be_another_refused" and not MARKED, acting_post)
STATE["acting"].clear()
check("no keys, too many, or none that is an alert: 400 and nothing written",
      post({"keys": []})[0]["status"] == 400 and post({"keys": ["req:a"] * 501})[0]["status"] == 400
      and post({"keys": ["nope"]})[0]["status"] == 400 and post(ValueError("bad"))[0]["status"] == 400
      and post(["req:a:open"])[0]["status"] == 400 and not MARKED)
dismiss_not_bool, _dn = post({"keys": ["req:a:open"], "dismiss": "yes"})
check("only a true dismiss clears", MARKED[-1][1]["dismiss"] is False)
STATE["uid"] = ""
check("a session with no account keeps no marks", post({"keys": ["req:a:open"]})[0]["status"] in (403,))
STATE["uid"] = "u-ann"

print("\nthe doors, for a client-role session (apps-script/MyFamily.gs)")
route = segment("lane_my_inbox")
refused_src = segment("_MY_INBOX_ROLES_REFUSED")
check("App Control is asked refusing the trainee and the interviewer; a client-role account is forwarded, and the "
      "dead `guardian` role is gone",
      '"onboarding"' in refused_src and '"interviewer"' in refused_src and '"client"' not in refused_src
      and '"guardian"' not in refused_src, refused_src)
check("the client-role branch sits after the gate and the person checks, before any staff read",
      route.index("_my_inbox_gate(") < route.index("if person and not my_inbox.PERSON_RE")
      < route.index("if _my_family_session(actor):") < route.index("_notice_accounts")
      < route.index("_roster_name_of"))
FAM_ENV = {"status": 200, "data": json.loads(json.dumps(FAMILY))}
STATE.update(role="client", uid="u-jane", family=FAM_ENV)
forget_family()
fam, fcalls, fresp = door()
check("a client-role session: the gate, Python's myFamily read, its own access, the notices at its houses — "
      "and no staff source: no roster name, badges, account row, lanes, chooser, release notes or staff board",
      fam["status"] == 200 and fcalls[:2] == ["gate:my-inbox", "python:myFamily"]
      and "family_board:u-jane:rw" in fcalls and fresp.headers["Cache-Control"] == "no-store"
      and not any(c.startswith(("name:", "badges:", "identity:", "lanes", "accounts", "board:", "requests:",
                                "updates:")) for c in fcalls) and not INBOX_ASKED, fcalls)
check("…asked of Python with the session's OWN identity and the part, never the service, Apps Script never asked",
      PY_SENT == [{"app": "my-family", "payload": {"part": "inbox"},
                   "user": {"uid": "u-jane", "role": "client", "is_master": False}}] and not EXEC_SENT, PY_SENT)
check("…its access asked as itself, not the master, for Staff alone — no staff source's app, no release-notes app",
      [a[2] for a in ACCESS_ASKED] == ["staff-profiles"]
      and all(a[:2] == ("u-jane", "client") and a[3] is False for a in ACCESS_ASKED), ACCESS_ASKED)
check("…the company notices are the ones at the houses the backend named, with the account's own marks, never the "
      "staff bell's per-reader judgement",
      HOUSE_NEWS_ASKED == [{"houses": ["ABD4708"], "uid": "u-jane", "held": ""}] and not INBOX_ASKED,
      HOUSE_NEWS_ASKED)
check("…and the answer is the family board: New staff and Company notices alone, its own scope, its marks kept",
      fam["data"]["family"] is True and fam["data"]["viewer"] == "guardian"
      and [h["key"] for h in fam["data"]["heads"]] == ["new_staff", "notices"]
      and {i["type"] for i in fam["data"]["items"]} == FAMILY_TYPES
      and fam["data"]["scope"] == {"mode": "own", "why": "", "person": "", "readonly": False}
      and fam["data"]["marks"]["kept"] is True and fam["data"]["display"] == {"hidden": {"inbox_sources": False}},
      fam["data"])
check("THE SESSION IS CHECKED FIRST, as My Calendar checks it — before the master check or any gate",
      SESSION_ASKED == [("Bearer tok", 0)], SESSION_ASKED)
own_items = [i["id"] for i in fam["data"]["items"]]
again_fresh, agcalls, _ = door()
check("a second read while the backend's answer is fresh is served from it: the backend is not asked again",
      again_fresh["status"] == 200 and "python:myFamily" not in agcalls
      and [i["id"] for i in again_fresh["data"]["items"]] == own_items, agcalls)
STATE["acting"].add("tok")
fact, facalls, _ = door()
check("A SWITCHED SESSION wearing the client is shown exactly the client's list, keeps no marks, and says so",
      fact["status"] == 200 and [i["id"] for i in fact["data"]["items"]] == own_items
      and [h["key"] for h in fact["data"]["heads"]] == ["new_staff", "notices"]
      and FAMILY_BOARDS[0]["readonly"] is True and fact["data"]["scope"]["readonly"] is True
      and fact["data"]["marks"]["kept"] is False, [fact["data"]["items"], FAMILY_BOARDS[:1]])
STATE["acting"].clear()
STATE["unchecked"] = "it did not answer in time"
unchecked, uccalls, _ = door()
STATE["unchecked"] = ""
check("a session the sign-in check could not judge — a switched session whose verdict lapsed — is told so in words, "
      "never 'sign in first', and nothing is read",
      unchecked["status"] == 503 and unchecked["reason"] == "unavailable"
      and "it did not answer in time" in unchecked["message"] and uccalls == [] and not PY_SENT, unchecked)
fperson, fpcalls, _ = door(person="u-bob")
check("a person asked for is refused as scope before the backend is asked",
      fperson["status"] == 403 and fperson["reason"] == "scope" and "python:myFamily" not in fpcalls, fperson)
STATE["lane"] = {"place": "", "my_work_hide": {"inbox_sources": True}}
fhid, _fhc, _ = door()
check("Settings > My Work's Sources switch holds for a client-role session as for everybody",
      fhid["data"]["heads"] == [] and fhid["data"]["display"] == {"hidden": {"inbox_sources": True}}, fhid["data"])
STATE["lane"] = None
STATE["switch"] = {"on": True, "readable": True}
fheld, _fhe, _ = door()
STATE["switch"] = {"on": False, "readable": True}
check("test mode holds the company notices for a client-role session too",
      fheld["data"]["heads"][1]["state"] == mi.STATE_HELD and not HOUSE_NEWS_ASKED, fheld)

print("\nthe client's read never outlives the proxy, and a slow or broken backend is said, not an error page")
forget_family()
STATE["family"] = RuntimeError("down")
fdown, fdcalls, _ = door()
check("a backend that did not answer: a 200 with both heads unreadable in its words — no error page, nothing listed, "
      "no notice from a house nobody named, nothing held",
      fdown["status"] == 200 and [h["state"] for h in fdown["data"]["heads"]] == [mi.STATE_UNREADABLE] * 2
      and all("Your alerts could not be read just now. Try again in a moment." in h["why"]
              for h in fdown["data"]["heads"])
      and fdown["data"]["items"] == [] and not HOUSE_NEWS_ASKED and fdown["data"]["linked"] is None
      and not ns["_MY_INBOX_FAMILY_HELD"], fdown["data"]["heads"])
STATE["family"] = {"status": 200, "data": {"family": True, "part": "calendar"}}
fwrong, _fwc, _ = door()
check("an answer for another part is not drawn: both heads unreadable, nothing listed",
      fwrong["status"] == 200 and fwrong["data"]["items"] == []
      and all(h["state"] == mi.STATE_UNREADABLE and "something else" in h["why"] for h in fwrong["data"]["heads"]),
      fwrong)
STATE["family"] = {"status": 403, "message": "This read is for client and guardian accounts."}
frefused, _frc, _ = door()
check("the backend's own refusal is the door's refusal, in its words", frefused["status"] == 403
      and frefused["message"] == "This read is for client and guardian accounts." and not FAMILY_BOARDS, frefused)
ns["_MY_INBOX_BUDGET_S"] = 0.05
STATE.update(family=FAM_ENV, family_delay=0.3)


async def slow_then_again():
    resp = types.SimpleNamespace(headers={})
    began = time.monotonic()
    first = await ns["lane_my_inbox"](resp, member="", person="", authorization="Bearer tok")
    took = time.monotonic() - began
    await asyncio.sleep(0.5)
    second = await ns["lane_my_inbox"](resp, member="", person="", authorization="Bearer tok")
    return first, took, second


reset()
forget_family()
slow, slow_took, landed_later = asyncio.run(slow_then_again())
check("NO 504 PATH: a backend slower than the budget is not waited past it — the door answers 200 in time, both heads "
      "saying it is still being read",
      slow["status"] == 200 and slow_took < 0.25
      and all(h["state"] == mi.STATE_UNREADABLE and "still reading" in h["why"] for h in slow["data"]["heads"])
      and slow["data"]["items"] == [], [slow_took, slow.get("data", {}).get("heads")])
check("…and the read it started lands for the next read, which lists the client's alerts without asking again",
      landed_later["status"] == 200 and [h["state"] for h in landed_later["data"]["heads"]] == [mi.STATE_READY] * 2
      and [i["id"] for i in landed_later["data"]["items"]] == own_items
      and [c for c in calls if c == "python:myFamily"] == ["python:myFamily"], [landed_later.get("data"), calls])
ns["_MY_INBOX_BUDGET_S"] = 24.0
STATE["family_delay"] = 0.0
HELD_DATA = json.loads(json.dumps(FAMILY))
HELD_DATA["items"] = HELD_DATA["items"][:1]
own_staff = [i for i in own_items if i.startswith("fam:staff:")]


async def read_then_settle():
    """One read, then the backend read it started, so what it holds is known."""
    resp = types.SimpleNamespace(headers={})
    got = await ns["lane_my_inbox"](resp, member="", person="", authorization="Bearer tok")
    task = ns["_MY_INBOX_FAMILY_ASKING"].get("u-jane")
    if task is not None:
        await task
    return got


def aged(seconds):
    forget_family()
    ns["_MY_INBOX_FAMILY_HELD"]["u-jane"] = (time.time() - seconds, json.loads(json.dumps(HELD_DATA)))
    reset()
    return asyncio.run(read_then_settle()), list(calls)


stale, stcalls = aged(ns["_MY_INBOX_FAMILY_FRESH_S"] + 5)
check("a held answer past fresh but under the ceiling is served at once while a newer one is read, and held",
      stale["status"] == 200 and [i["id"] for i in stale["data"]["items"] if i["type"] == "new_staff"]
      == ["fam:staff:0a1b2c3d4e"] and stcalls.count("python:myFamily") == 1
      and len(ns["_MY_INBOX_FAMILY_HELD"]["u-jane"][1]["items"]) == len(FAMILY["items"]), stcalls)
past, _pcalls = aged(ns["_MY_INBOX_FAMILY_CEILING_S"] + 5)
check("…one past the ceiling is never served: the newer read is waited on",
      [i["id"] for i in past["data"]["items"] if i["type"] == "new_staff"] == own_staff, past["data"]["items"])
STATE["family"] = {"status": 403, "message": "This read is for client and guardian accounts."}
aged(ns["_MY_INBOX_FAMILY_FRESH_S"] + 5)
check("…and a refusal on the newer read lets the held answer go", "u-jane" not in ns["_MY_INBOX_FAMILY_HELD"],
      list(ns["_MY_INBOX_FAMILY_HELD"]))
STATE["family"] = FAM_ENV
forget_family()
res_fam, rcalls = post({"keys": ["fam:staff:0a1b2c3d4e", "srv-41"]})
check("the read-marks door keeps a client-role account's own marks: New staff in the inbox's, a notice in the bell's",
      res_fam == {"status": 200, "data": {"marked": 2, "ignored": 0}}
      and MARKED == [("bell", {"uid": "u-jane", "ids": [41], "dismiss": False}),
                     ("inbox", {"uid": "u-jane", "keys": ["fam:staff:0a1b2c3d4e"], "dismiss": False})]
      and "python:myFamily" not in rcalls, [res_fam, MARKED])
STATE.update(role="staff", uid="u-ann", family=None)
again, acalls, _ = door()
check("a staff session is unchanged: its own board, and the family read is never asked",
      again["status"] == 200 and "board:u-ann:rw" in acalls and not EXEC_SENT and not FAMILY_BOARDS, acalls)
check("…and its session is checked first too", SESSION_ASKED == [("Bearer tok", 0)], SESSION_ASKED)

print("\nthe write guard")
guard = segment("_BE_ANOTHER_OPEN_PATHS")
check("the read-marks door is not among the paths an acting session may still write to",
      "/hub-lanes/my-inbox" not in guard and guard)
pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
check("the suite is a script and rides the check chain",
      pkg["scripts"].get("test:my-inbox") == "python3 tools/test-my-inbox.py"
      and "npm run test:my-inbox" in pkg["scripts"]["check"])
grants = []
for folder in ("apps-script", "tools", "server"):
    for p in (ROOT / folder).rglob("*"):
        if p.is_file() and p.suffix in (".gs", ".py", ".json", ".mjs", ".js") and p.name != "test-my-inbox.py":
            text = p.read_text(encoding="utf-8", errors="ignore")
            if re.search(r"app_badge_access[^\n]{0,200}my-inbox|my-inbox[^\n]{0,200}app_badge_access", text):
                grants.append(str(p))
check("no App Control grant row for my-inbox ships anywhere: the app is the master's until released", not grants,
      grants)
src_text = (SERVER / "my_inbox.py").read_text(encoding="utf-8")
check("the module sends nothing: no publish, no push, no listener", not re.search(
    r"on_publish|web_push|_publish_|send_|sms|smtp", src_text, re.I))
check("no log line in the module or its doors formats anything but an error's type",
      all("type(exc).__name__" in line for line in re.findall(r"log\.\w+\([^\n]*", src_text + "\n".join(
          segment(n) for n in ("_my_inbox_access", "lane_my_inbox", "lane_my_inbox_read")))))

print(f"\nmy inbox: {results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
