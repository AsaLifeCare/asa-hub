#!/usr/bin/env python3
"""My Work (server/my_work.py and its relay door): the scope decided on the server, every source narrowed
before it answers and failing closed on its own. Pure: no database, no network."""
import ast
import asyncio
import importlib.util
import json
import logging
import os
import re
import sys
import types
from collections import Counter
from datetime import date, timedelta
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
# every connect in this file fails, so nothing is ever read from a real database
sys.modules["psycopg2"].connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no database in this test"))

sys.path.insert(0, str(SERVER))
os.environ.setdefault("HUB_SNAPSHOT_OUT", "/tmp")
import ist_config  # noqa: E402
import redaction  # noqa: E402
import shift_handoff  # noqa: E402
import shift_requests as sr  # noqa: E402
import time_off  # noqa: E402
import my_work as mw  # noqa: E402

TODAY = date(2026, 9, 25)
D = lambda n: (TODAY + timedelta(days=n)).isoformat()  # noqa: E731
MDY = lambda n: (lambda d: f"{d.month}/{d.day}/{d.year}")(TODAY + timedelta(days=n))  # noqa: E731
H1 = "CAN - 48TH (B) - ABD1711"

MANAGERS = {"readable": True, "why": "", "by_code": {
    "ABD1711": {"name": "Mia Manager", "names": ["Mia Manager"], "phone": "", "house": H1, "last_day": ""}}}
sr.house_managers = lambda dsn, **k: MANAGERS
ist_config.pin(dict(ist_config.SHIPPED))

USERS_ROW = {"user_id": "u-ann", "display_name": "Ann Roe", "email": "Ann@Example.com",
             "emails": '["ann.roe@home.net"]', "phone": "(330) 555-1234",
             "phones": '[{"label":"Mobile","number":"+1 (330) 555-9876"}]', "active": "TRUE"}
PEOPLE = [{"id": "PPL_ANN", "name": "Ann Roe", "email": "", "phone": "330-555-4444"},
          {"id": "PPL_BOB", "name": "Bob Bee", "email": "bob@x.com", "phone": ""}]
ME = mw.identity_from(USERS_ROW, "u-ann", roster_name="Ann Roe", people=PEOPLE)
WHO = sr.viewer("dsn", name="Ann Roe", role="staff", types="STAFF")
MASTER_ME = mw.identity_from({"user_id": "u-boss", "display_name": "The Boss", "active": "TRUE"}, "u-boss",
                             roster_name="The Boss", people=[])
MASTER_WHO = sr.viewer("dsn", name="The Boss", role="admin", types="ADMIN", is_master=True)
FACTS = {mw.PTR_STATES: "S_STATES", mw.PTR_CATALOGUE: "S_CAT", mw.PTR_APPS: "S_APPS",
         mw.PTR_STAFF_REQUESTS: "S_REQ", mw.PTR_PEOPLE: "S_PEOPLE", mw.PTR_SCHED_INBOX: "S_SCHED"}


def sched(iid, to_uid, to_name, state="waiting", box="work", **over):
    base = {"id": iid, "flow_id": "SF0000000001", "box": box, "kind": "approval", "seat": "director",
            "to_uid": to_uid, "to_email": f"{to_uid}@mail.test", "to_name": to_name,
            "title": "Cy Far asks to be off Mon 10/5 — 8A-4P at BM", "body": "Asked from the Scheduling page.",
            "house_code": "BM4060", "house_label": "BM", "date": D(10), "shift_text": "8A-4P", "state": state,
            "answered_by": "", "answered_at": "", "note": "", "test_mode": "no",
            "link": f"/app/scheduling/calendar?house=BM4060&day={D(10)}", "created_at": "2026-09-25T10:00:00Z"}
    base.update(over)
    return base


SCHED_ROWS = [
    sched("SI00000000A1", "u-ann", "Ann Roe", test_mode="yes"),
    sched("SI00000000A2", "u-bob", "Bob Bee"),
    sched("SI00000000A3", "u-ann", "Ann Roe", state="approved", answered_by="Ann Roe"),
    sched("SI00000000A4", "u-ann", "Ann Roe", state="superseded"),
    sched("SI00000000A5", "u-ann", "Ann Roe", state="declined"),
    sched("SI00000000A6", "u-ann", "Ann Roe", box="inbox", kind="warning", state="posted"),
    # a seat is an account id: a row naming the account by name under another id is never the account's
    sched("SI00000000A7", "u-other", "Ann Roe"),
    sched("SI00000000A8", " u-ann ", "Ann Roe", seat="house_manager", date="", link="https://elsewhere.test/x"),
    sched("SI00000000A9", "u-boss", "The Boss", seat="staff"),
    # a training (no house IST) is an approval like any other: one item per seat, each on its own account
    sched("SI00000000B1", "u-ann", "Ann Roe", flow_id="SF000000T001", seat="house_manager",
          title="Training — Dee Lux · Mon 10/5 · 8A-4P · BM",
          body="Dee Lux has no IST at BM. Approve: the training stands. Decline: they leave the shift.",
          created_at="2026-09-26T14:30:00+00:00"),
    sched("SI00000000B2", "u-bob", "Bob Bee", flow_id="SF000000T001", seat="director",
          title="Training — Dee Lux · Mon 10/5 · 8A-4P · BM", body="Dee Lux has no IST at BM."),
]


def cat(req_id, label, category, enabled="yes", evidence=""):
    return {"req_id": req_id, "label": label, "category": category, "enabled": enabled, "evidence": evidence}


def state(req_id, st, expires="", key="annroe", login="", name="Ann Roe", days_left=""):
    return {"req_id": req_id, "state": st, "expires": expires, "person_key": key, "person_name": name,
            "login": login, "days_left": days_left, "since": "2026-08-20T17:25:48.348Z",
            "computed_at": "2026-09-25T10:00:00Z"}


TABS = {
    ("S_CAT", "Data"): [cat("dodd", "DODD 8-Hour", "training", evidence="DODD 8-hour certificate"),
                        cat("cpr", "CPR / First Aid", "training"), cat("mandt", "Mandt", "training"),
                        cat("i9_form", "I-9 Form", "onboarding"), cat("car_insurance", "Car Insurance", "documents"),
                        cat("w4_form", "W-4 Form", "onboarding"),
                        cat("sam", "SAM", "background"), cat("referral_paid", "Referral Paid", "admin"),
                        cat("med1", "Med Delivery 1", "training"), cat("med2", "Med Delivery 2", "training"),
                        cat("old", "Retired course", "training", enabled="no")],
    ("S_STATES", "Data"): [
        state("dodd", "expired", D(-24)), state("cpr", "expiring", MDY(15), days_left="15"),
        state("mandt", "missing"), state("i9_form", "missing"), state("w4_form", "expired", D(-3)),
        state("sam", "missing"), state("referral_paid", "missing"),
        state("med1", "ok", D(90)), state("med2", "na"), state("old", "expired", D(-100)),
        state("dodd", "expired", D(-3), key="bobbee", name="Bob Bee"),
        state("mandt", "missing", key="bobbee", name="Bob Bee"),
        state("car_insurance", "expired", D(-2), key="annroesmith", name="Ann Roe-Smith", login="ann@example.com"),
        state("cpr", "expired", D(-2), key="zed", name="Zed Zee", login=redaction.MARKER_SECRET),
    ],
    ("S_APPS", "policyAcks"): [
        {"id": "P1", "policy": "Handbook", "version": "v2", "staff": "Ann Roe", "status": "pending",
         "effectiveDate": D(10) + "T12:00:00Z"},
        {"id": "P2", "policy": "Safety", "version": "v1", "staff": "All staff", "status": "overdue",
         "effectiveDate": D(-3) + "T12:00:00Z"},
        {"id": "P3", "policy": "Privacy", "version": "v1", "staff": "All staff", "status": "pending",
         "effectiveDate": D(40) + "T12:00:00Z"},
        {"id": "P4", "policy": "Privacy", "version": "v1", "staff": "Ann Roe", "status": "read",
         "effectiveDate": D(-1) + "T12:00:00Z"},
        {"id": "P5", "policy": "Other", "version": "", "staff": "Bob Bee", "status": "pending",
         "effectiveDate": D(2)},
        {"id": "P6", "policy": "Safety", "version": "v1", "staff": "Bob Bee", "status": "read", "effectiveDate": D(2)},
        {"id": "P7", "policy": "Gone", "version": "", "staff": "ann@example.com", "status": "read", "effectiveDate": D(2)},
        {"id": "P8", "policy": "Gone", "version": "", "staff": "All staff", "status": "pending", "effectiveDate": D(5)},
    ],
    ("S_REQ", "Data"): [
        {"id": "REQ_EMAIL", "email": "Ann@Example.com", "type": "Schedule - Access", "status": "needs_dates",
         "createdAt": "2026-09-19", "datesText": "next month"},
        # a contact typed on the account's own profile claims nothing
        {"id": "REQ_PROFILE_MAIL", "email": "ann.roe@home.net", "type": "Profile mail", "status": "open",
         "createdAt": "2026-09-05"},
        {"id": "REQ_PROFILE_PHONE", "phone": "+1 (330) 555-1234", "type": "Profile phone", "status": "open",
         "createdAt": "2026-09-06"},
        {"id": "REQ_PHONE", "personName": "Ann Roe", "type": "Operations - Supplies",
         "status": "resolved", "verdict": "approved", "createdAt": "2026-09-01", "resolvedBy": "Ops Desk"},
        {"id": "REQ_LONGER", "phone": "1-330-555-4444-99", "type": "Not hers either", "status": "open",
         "createdAt": "2026-09-02"},
        # one line, two callers: the named one is someone else's, the nameless one nobody can tell
        {"id": "REQ_LINE_CY", "personName": "Cy Far", "phone": "330-555-4444", "type": "Cy's request",
         "status": "open", "createdAt": "2026-09-03", "details": "Cy's own words"},
        {"id": "REQ_LINE_NONAME", "personName": "", "phone": "(330) 555-4444", "type": "Nameless on a shared line",
         "status": "open", "createdAt": "2026-09-04"},
        {"id": "REQ_NAME", "personName": "Ann  Roe", "type": "Payroll correction", "status": "resolved",
         "verdict": "", "createdAt": "2026-08-01", "dob": "1990-01-01", "login": "ann-login",
         "details": "Short one hour"},
        {"id": "REQ_TWIN", "personName": "Ann Roe", "type": "ADP - Pay Stubs", "status": "open",
         "createdAt": "2026-09-17", "details": "Request for last two pay stubs.", "phone": ""},
        {"id": "REQ_CONTAINS", "personName": "Ann Roeberts", "type": "Not hers", "status": "open"},
        {"id": "REQ_WORD", "personName": "Ann Roe", "type": "Odd", "status": "escalated", "createdAt": "2026-09-22"},
        {"id": "REQ_OTHER", "personName": "Bob Bee", "email": "bob@x.com", "type": "Not hers", "status": "open",
         "createdAt": "2026-09-10"},
    ],
    ("S_PEOPLE", "Data"): PEOPLE,
    ("S_SCHED", "Data"): SCHED_ROWS,
}

IST_ROWS = [
    {"id": "IST_1", "status": "owed", "staffName": "Somebody Else", "staffEmail": "ann@example.com",
     "staffPhone": "", "clientName": "Client One", "house": "ABD1711", "dueDate": D(8)},
    {"id": "IST_2", "status": "owed", "staffName": "", "staffEmail": "", "staffPhone": "+1 330.555.4444",
     "clientName": "Client Two", "house": "ABD1711", "dueDate": D(200)},
    {"id": "IST_3", "status": "Owed", "staffName": "ann  roe", "staffEmail": "", "staffPhone": "",
     "clientName": "Client Three", "house": "", "dueDate": ""},
    {"id": "IST_4", "status": "done", "staffName": "Ann Roe", "clientName": "Client Four", "dueDate": D(-5)},
    {"id": "IST_5", "status": "owed", "staffName": "Bob Bee", "staffEmail": "bob@x.com", "dueDate": D(1)},
    {"id": "IST_6", "status": "owed", "staffName": "Past Due", "staffEmail": " ANN@example.com ",
     "clientName": "Client Six", "dueDate": D(-2)},
]

SHIFT_ROWS = [
    {"id": "SR0000000001", "kind": "open_shift", "location": H1, "open_row": "OPEN", "col_iso": D(2), "value": "8A-4P",
     "person": "Ann Roe", "state": "applied", "why": "", "via": "app", "ref": "", "decided_by": "",
     "decided_at": None, "created_at": "2026-09-24T10:00:00+00:00", "extra": {}, "pool_ref": "SPAAAAAAAAAA",
     "pool_location": H1},
    {"id": "SR0000000002", "kind": "call_off", "location": H1, "open_row": "Zed Caller", "col_iso": D(-3),
     "value": "4P-12A", "person": "ann roe", "state": "not_chosen", "why": "the house manager gave the shift to "
     "somebody else", "via": "app", "ref": "", "decided_by": "Mia Manager", "decided_at": None,
     "created_at": "2026-09-20T10:00:00+00:00", "extra": {}, "pool_ref": "", "pool_location": H1},
    {"id": "SR0000000003", "kind": "ist_approval", "location": H1, "open_row": "OPEN", "col_iso": D(2),
     "value": "8A-4P", "person": "Ann Roe", "state": "needs_training_approval", "why": "", "via": "app",
     "ref": "open_shift", "decided_by": "", "decided_at": None, "created_at": "2026-09-24T10:00:01+00:00",
     "extra": {}, "pool_ref": None, "pool_location": None},
    {"id": "SR0000000004", "kind": "open_shift", "location": H1, "open_row": "OPEN", "col_iso": D(3),
     "value": "8A-4P", "person": "Ann Roe", "state": "applied", "why": "", "via": "rehearsal:app", "ref": "",
     "decided_by": "", "decided_at": None, "created_at": "2026-09-24T11:00:00+00:00", "extra": {},
     "pool_ref": "SPBBBBBBBBBB", "pool_location": H1},
    {"id": "SR0000000005", "kind": "open_shift", "location": H1, "open_row": "OPEN", "col_iso": D(3),
     "value": "8A-4P", "person": "Bob Bee", "state": "applied", "why": "", "via": "app", "ref": "",
     "decided_by": "", "decided_at": None, "created_at": "2026-09-24T11:00:00+00:00", "extra": {},
     "pool_ref": "SPBBBBBBBBBB", "pool_location": H1},
    {"id": "SR0000000006", "kind": "open_shift", "location": H1, "open_row": "OPEN", "col_iso": D(4),
     "value": "8A-4P", "person": "Ann Roe", "state": "on_hold", "why": "", "via": "app", "ref": "",
     "decided_by": "", "decided_at": None, "created_at": "2026-09-23T11:00:00+00:00", "extra": {},
     "pool_ref": "SPCCCCCCCCCC", "pool_location": H1},
]

POOL = [
    {"location": H1, "open_row": "Ann Roe", "col_iso": D(-10), "ref": "SP1", "filled_by": "Cy Far", "closed_at": None},
    {"location": H1, "open_row": "Ann Roe", "col_iso": D(-9), "ref": "SP2", "filled_by": "", "closed_at": "2026-09-16"},
    {"location": H1, "open_row": "Ann Roe", "col_iso": D(1), "ref": "SP3", "filled_by": "", "closed_at": None},
]


class FakeDb:
    """The reads PgMirror makes, answered from memory; the SQL narrowing is recorded, never applied, so the
    Python match is what is proved."""

    def __init__(self, facts=FACTS, tabs=None, shift_rows=None, ist_rows=None, pool=None, facts_error=None,
                 tab_errors=(), pool_error=None, users=None, phones_error=None, as_of=None, emails_error=None,
                 books=None):
        self._facts = dict(facts) if facts is not None else None
        self.tabs = {k: list(v) for k, v in (tabs if tabs is not None else TABS).items()}
        self.shift_rows = list(SHIFT_ROWS if shift_rows is None else shift_rows)
        self.ist = list(IST_ROWS if ist_rows is None else ist_rows)
        self.pool = list(POOL if pool is None else pool)
        self.facts_error = facts_error
        self.tab_errors = set(tab_errors)
        self.pool_error = pool_error
        self.phones_error = phones_error
        self.emails_error = emails_error
        self.as_of = dict(as_of or {})
        self.books = dict(books or {})
        self.users = users if users is not None else {"u-ann": USERS_ROW}
        self.reads: list[tuple] = []
        self.closed = False

    def users_row(self, core, uid):
        if uid == "boom":
            raise RuntimeError("the mirror is down")
        return self.users.get(uid)

    def namesakes(self, core, key, uid):
        return sum(1 for u in self.users.values() if sr.fold(u.get("display_name")) == key
                   and u.get("user_id") != uid and mw._live(u))

    def phones_elsewhere(self, core, uid, phones):
        self.reads.append(("phones", tuple(phones)))
        if self.phones_error is not None:
            raise self.phones_error
        out = set()
        for u in self.users.values():
            if u.get("user_id") != uid and mw._live(u):
                out |= mw.row_phones(u) & set(phones)
        return out

    def emails_elsewhere(self, core, uid, emails):
        self.reads.append(("emails", tuple(emails)))
        if self.emails_error is not None:
            raise self.emails_error
        out = set()
        for u in self.users.values():
            if u.get("user_id") != uid and mw._live(u):
                out |= mw.row_emails(u) & set(emails)
        return out

    def pointers(self):
        if self.facts_error is not None:
            raise self.facts_error
        return dict(self._facts or {})

    def tab(self, sid, tab, where="", args=()):
        self.reads.append(("tab", sid, tab, where, args))
        if (sid, tab) in self.tab_errors:
            raise RuntimeError("the mirror is down")
        rows = self.tabs.get((sid, tab), [])
        return [dict(r) for r in rows], len(rows), self.as_of.get((sid, tab), "2026-09-25T12:00:00Z")

    def book(self, sid):
        self.reads.append(("book", sid))
        return self.books.get(sid)

    def ist_rows(self):
        self.reads.append(("ist",))
        return ([dict(r) for r in self.ist], "S_IST/ist_records") if self.ist else ([], "the IST house holds no rows")

    def shift_requests(self, keys, limit=5000):
        self.reads.append(("shift_requests", keys))
        return [dict(r) for r in self.shift_rows][:limit]

    def call_off_pool(self, days, keys):
        self.reads.append(("pool", tuple(days), keys))
        if self.pool_error is not None:
            raise self.pool_error
        return [dict(p) for p in self.pool]

    def close(self):
        self.closed = True


def to_row(ref, person, status, **over):
    base = {"id": ref, "createdAt": "2026-09-20T12:00:00.000Z", "updatedAt": "2026-09-20T12:00:00.000Z",
            "person": person, "person_key": sr.fold(person), "start_date": D(10), "end_date": D(12), "days": "3",
            "houses": "ABD1711", "reason_given": "yes", "time_off_reason": "MY SECRET REASON", "status": status,
            "status_why": "", "filed_by": person, "filed_by_key": sr.fold(person), "filed_via": "platform",
            "hm_mode": "house_manager", "hm_asked": "Mia Manager", "hm_why": "", "hm_state": "waiting", "hm_by": "",
            "hm_via": "", "hm_at": "", "hm_note": "", "dir_asked": "Nora Vale", "dir_state": "waiting", "dir_by": "",
            "dir_via": "", "dir_at": "", "dir_note": "", "decided_at": "", "closed_by": "", "closed_at": "",
            "closed_note": "", "effects": "", "test_mode": "", "source": "platform", "flags": ""}
    base.update(over)
    return base


TO_ROWS = [
    to_row("TO0000000001", "Ann Roe", "pending", filed_via="phone", filed_by="Hal Desk", filed_by_key="haldesk"),
    to_row("TO0000000002", "Ann Roe", "scheduled", start_date=D(-10), end_date=D(-8), hm_state="approved",
           hm_by="Mia Manager", dir_state="approved", dir_by="Nora Vale"),
    to_row("TO0000000003", "Ann Roe", "denied", closed_by="Nora Vale", closed_note="short staffed"),
    to_row("TO0000000004", "Ann Roe", "paused"),
    to_row("TO0000000005", "Ann Roe", "pending", test_mode="on", reason_given="no"),
    to_row("TO0000000006", "Dee Way", "pending", filed_by="Ann Roe", filed_by_key="annroe"),
    to_row("TO0000000007", "Dee Way", "pending", hm_asked="Ann Roe"),
    to_row("TO0000000008", "Ann Roe", "needs_review", reason_given="no"),
    # another person who shares Ann Roe's first and last names: time_off.same_person would join them
    to_row("TO0000000009", "Ann Marie Roe", "pending", closed_note="Ann Marie's own note", reason_given="no"),
    to_row("TO0000000010", "Ann Q. Roe", "denied", closed_note="Ann Q's own note", reason_given="no"),
]
TO_VIEW = {"minted": True, "id": "house", "rows": TO_ROWS, "settings": {"directors": "Nora Vale"},
           "as_of": "2026-09-25T11:00:00.000Z", "read_at": ""}
time_off.view = lambda dsn, fresh=False: TO_VIEW
REASON_CALLS: list[str] = []


def reason_of(dsn, row):
    REASON_CALLS.append(str(row.get("id")))
    return "family wedding", ""


time_off.reason_of = reason_of


def ho_row(hid, frm, to, state="pending", **over):
    base = {"id": hid, "location": H1, "col_iso": D(1), "value": "8A-4P", "from_staff": frm, "to_staff": to,
            "house_manager": "", "staff_state": "pending", "staff_via": "", "staff_at": None, "staff_by": "",
            "manager_state": "pending", "manager_via": "", "manager_at": None, "manager_by": "",
            "director_state": "pending", "director_via": "", "director_at": None, "director_by": "",
            "state": state, "why": "", "created_by": "", "created_at": "2026-09-24T10:00:00+00:00",
            "closed_at": None, "said": {}, "approvers": [], "approval": "house_manager", "approval_why": "",
            "offered_by": frm, "training_request": "", "training": {}, "closed_by": "", "extra": {},
            "directors": ["Nora Vale"]}
    base.update(over)
    return base


HANDOFFS = [
    ho_row("HO0000000001", "Bob Bee", "Ann Roe"),
    ho_row("HO0000000002", "Cy Far", "Dee Way", approvers=["Ann Roe"], house_manager="Ann Roe"),
    ho_row("HO0000000003", "Bob Bee", "Ann Roe", extra={"rehearsal": {"run": "r1"}}),
    ho_row("HO0000000004", "Ann Roe", "Bob Bee"),
    ho_row("HO0000000005", "Ann Roe", "Cy Far", state="done", staff_state="accepted", manager_state="approved",
           director_state="approved"),
    ho_row("HO0000000006", "Ann Roe", "Dee Way", state="dead", why="the recipient declined"),
    ho_row("HO0000000007", "Dee Way", "Cy Far", offered_by="Ann Roe"),
    ho_row("HO0000000008", "Ann Roe", "Bob Bee", staff_state="accepted", manager_state="approved"),
]
HANDOFF_CALLS: list[tuple] = []


def rows_for(dsn, *, where="", args=(), limit=400):
    HANDOFF_CALLS.append((where, args, limit))
    if where == "state=%s":
        return [r for r in HANDOFFS if r["state"] == args[0]][:limit], {}
    if "to_staff" in where:
        return [r for r in HANDOFFS if r["state"] == args[0]][:limit], {}
    if "from_staff" in where:
        return list(HANDOFFS)[:limit], {}
    return list(HANDOFFS)[:limit], {}


shift_handoff.rows_for = rows_for


def lane(rows, ok=True, error=""):
    return {"ok": ok, "error": error, "rows": rows, "read_at": "2026-09-25T12:00:00Z",
            "stale": bool(rows is not None and not ok)}


QUEUE_ROWS = [
    # somebody else calling from the account's own number: that line is not the account's alone here
    {"id": "r10", "status": "", "requestor": "Somebody", "requestor_phone": "330-555-1234",
     "type_of_request": "Somebody's request", "date_received": "2026-09-18T04:00:00.000Z",
     "description_of_request": "somebody's words"},
    # a call under the account's own name, from a phone typed on its profile: claimed by the name alone
    {"id": "r15", "status": "", "requestor": "Ann Roe", "requestor_phone": "+1 330.555.9876",
     "type_of_request": "PSI - Reset Password", "date_received": "2026-09-19T04:00:00.000Z",
     "description_of_request": "locked out"},
    # one line, two names and a nameless call: none of them is claimed by the phone
    {"id": "r16", "status": "New", "requestor": "Cy Far", "requestor_phone": "330-555-4444",
     "type_of_request": "Cy on the house line", "date_received": "2026-09-19T04:00:00.000Z"},
    {"id": "r17", "status": "New", "requestor": "Dee Way", "requestor_phone": "330-555-4444",
     "type_of_request": "Dee on the house line", "date_received": "2026-09-19T05:00:00.000Z"},
    {"id": "r18", "status": "New", "requestor": "", "requestor_phone": "330-555-4444",
     "type_of_request": "Nameless on the house line", "date_received": "2026-09-19T06:00:00.000Z"},
    {"id": "r11", "status": "Pending", "requestor": "Ann Roe", "requestor_phone": "",
     "type_of_request": "ADP - Pay Stubs", "date_received": "2026-09-17T04:00:00.000Z",
     "description_of_request": "Request for last two pay stubs."},
    {"id": "r12", "status": "Escalated", "requestor": "ANN ROE", "requestor_phone": "",
     "type_of_request": "Other", "date_received": "2026-09-16T04:00:00.000Z", "description_of_request": "x"},
    {"id": "r13", "status": "Resolved", "requestor": "Ann Roe", "requestor_phone": "",
     "type_of_request": "Done thing", "date_received": "2026-09-01T04:00:00.000Z"},
    {"id": "r14", "status": "New", "requestor": "Ann Roeberts", "requestor_phone": "330-555-0000",
     "type_of_request": "Not hers", "date_received": "2026-09-01T04:00:00.000Z"},
]
LANES = {
    "supportQueue": lane(QUEUE_ROWS),
    "callOffs": lane([
        {"id": "CO1", "employee_name": "Ann Roe", "date": MDY(1), "type": "Call Off", "timestamp": "9/25/2026 7:00:00",
         "createdAt": "2026-09-25T11:00:00Z", "your_name": "Hal Desk"},
        {"id": "CO2", "employee_name": "Ann Roe", "date": "3/1/2024", "type": "Late Show", "how_late": "54 minutes",
         "timestamp": "3/1/2024 8:17:08", "createdAt": "2026-09-08T13:05:56Z"},
        {"id": "CO3", "employee_name": "Ann Roe", "date": "sometime", "type": "Call Off", "timestamp": "",
         "createdAt": "2026-09-08T13:05:56Z"},
        {"id": "CO4", "employee_name": "Bob Bee", "date": "3/1/2024", "type": "Call Off"},
        {"id": "CO5", "employee_name": "Ann Roe", "date": MDY(-10), "type": "Call Off", "timestamp": ""},
        {"id": "CO6", "employee_name": "Ann Roe", "date": MDY(-9), "type": "call off", "timestamp": ""},
        {"id": "CO7", "employee_name": "Ann Roe", "date": MDY(-20), "type": "Call Off", "timestamp": ""},
        {"id": "CO8", "employee_name": "Ann Roe", "date": MDY(-2), "type": "No Show No Call"},
        {"id": "CO9", "employee_name": "Ann Roe", "date": MDY(-2), "type": "Sent Home"},
        # a shift still ahead that the relay never pooled
        {"id": "CO10", "employee_name": "Ann Roe", "date": MDY(3), "type": "Call Off", "timestamp": ""},
    ]),
    "uiIncidents": lane([
        {"id": "r2", "timestamp": "2026-09-20T14:00:00.000Z", "your_name": "Ann Roe", "client_name": "Client One",
         "incident_category": "Fall", "summary_of_incident": "slipped", "password": "hunter2",
         "api_key": "sk-live-abc"},
        {"id": "r3", "timestamp": "2026-09-20T14:00:00.000Z", "your_name": "Bob Bee", "incident_category": "Other"},
        {"id": "r4", "timestamp": "2026-09-21T14:00:00.000Z", "your_name": "ann@example.com",
         "incident_category": "Med error"},
    ]),
}


def run(db=None, me=None, who=None, lanes=LANES, lanes_why="", mode=mw.MODE_OWN, person=""):
    return mw.board("dsn", mode=mode, me=me or ME, who=who or WHO, lanes=lanes, lanes_why=lanes_why,
                    person=person, on=TODAY, db=db or FakeDb())


def mass(db=None, person="", lanes=LANES):
    return run(db=db, me=MASTER_ME, who=MASTER_WHO, lanes=lanes, mode=mw.MODE_MASS, person=person)


def src(board, key):
    for part in ("actions", "requests"):
        for s in board[part]["sources"]:
            if s["key"] == key:
                return s
    raise KeyError(key)


def rows_of(board, key):
    part = "actions" if key in dict(mw.ACTION_SOURCES) else "requests"
    return [r for r in board[part]["rows"] if r["source"] == key]


def detail(row, label):
    return next((d["value"] for d in row["details"] if d["label"] == label), None)


B = run()
BLOB = json.dumps(B)

print("\nthe scope")
table = [(("admin", True, False), "mass"), (("admin", None, False), "own"), (("admin", False, False), "own"),
         (("admin", True, True), "own"), (("manager", True, False), "own"), (("staff", True, False), "own"),
         (("staff", None, False), "own"), (("", True, False), "own")]
check("mass only for the master's own admin session, never unknown, never acting, never another role",
      all(mw.scope_verdict(*args) == want for args, want in table),
      [(a, mw.scope_verdict(*a)) for a, _ in table])

print("\nwho is asking")
check("only the sign-in e-mail is a key, lower-cased; the profile's own e-mails and phones never are; the one "
      "roster row's phone is added",
      ME["emails"] == ["ann@example.com"] and ME["phones"] == ["3305554444"], [ME["emails"], ME["phones"]])
# an account cannot make itself somebody else by typing their contacts or a variant of their name
eve = mw.identity_from({"user_id": "u-eve", "display_name": "Eve Doe", "email": "eve@x.com", "active": "TRUE",
                        "emails": '["bob@x.com"]', "phones": '[{"label":"Mobile","number":"330-555-0000"}]'},
                       "u-eve", roster_name="Eve Doe", people=PEOPLE, shared=lambda k: False)
check("contacts typed on one's own profile are no key and bridge to nobody",
      eve["emails"] == ["eve@x.com"] and eve["phones"] == [] and eve["keys"] == ["evedoe"] and eve["bridged"] == "",
      eve)
jr = mw.identity_from({"user_id": "u-jr", "display_name": "Bob Bee Jr", "name_by": "self", "email": "jr@x.com",
                       "emails": '["bob@x.com"]', "active": "TRUE"},
                      "u-jr", roster_name="Bob Bee Jr", people=PEOPLE, shared=lambda k: False)
check("a self-set variant of a roster name plus that person's e-mail never adopts their key",
      "bobbee" not in jr["keys"] and jr["keys"] == [] and jr["bridged"] == "", jr)
own_named = mw.identity_from({"user_id": "u-cy", "display_name": "Cy Lane", "name_by": "self", "email": "cy@x.com",
                              "active": "TRUE"}, "u-cy", roster_name="Cy Lane",
                             people=[{"id": "PPL_CY", "name": "Cy Lane", "email": "cy@x.com", "phone": ""}],
                             shared=lambda k: False)
check("…while a self-set name the roster row on the sign-in e-mail carries stays a key",
      own_named["keys"] == ["cylane"], own_named)
check("the name key is the relay's roster name, folded", ME["keys"] == ["annroe"] and ME["key_why"] == "")
shared = mw.identity_from(USERS_ROW, "u-ann", roster_name="", people=[])
check("a live namesake leaves no name key, and the sentence says the name is shared",
      shared["keys"] == [] and "shared with another account" in shared["key_why"], shared)
gone = mw.identity_from({**USERS_ROW, "active": "FALSE"}, "u-ann", roster_name="")
check("an inactive account says so rather than calling its name shared", "not active" in gone["key_why"])
marked = mw.identity_from({**USERS_ROW, "email": redaction.MARKER_SECRET}, "u-ann", roster_name="Ann Roe")
check("a withheld cell is never taken for an address", all("withheld" not in e for e in marked["emails"]))
bridge_people = [{"id": "PPL_X", "name": "Ann B. Roe-Smith", "email": "ann@example.com", "phone": ""}]
bridged = mw.identity_from(USERS_ROW, "u-ann", roster_name="Ann Roe", people=bridge_people, shared=lambda k: False)
check("exactly one roster row with the account's e-mail bridges its spelling of the name",
      bridged["keys"] == ["annbroesmith", "annroe"], bridged["keys"])
two = bridge_people + [{"id": "PPL_Y", "name": "Other Person", "email": "ann@example.com", "phone": ""}]
check("two roster rows matching the account's keys bridge nothing",
      mw.identity_from(USERS_ROW, "u-ann", roster_name="Ann Roe", people=two, shared=lambda k: False)["keys"]
      == ["annroe"])
check("a bridged name another live account carries adds no key, and says why",
      (lambda got: got["keys"] == ["annroe"] and "another account shares" in " ".join(got["notes"]))(
          mw.identity_from(USERS_ROW, "u-ann", roster_name="Ann Roe", people=bridge_people, shared=lambda k: True)))
rescued = mw.identity_from(USERS_ROW, "u-ann", roster_name="", people=bridge_people, shared=lambda k: False)
check("a namesake's account is still matched by the one roster row its own e-mail names",
      rescued["keys"] == ["annbroesmith"] and rescued["key_why"] == "", rescued)
check("…and the notes say which spelling was matched, so the screen names it",
      any("also matched under “Ann B. Roe-Smith”" in n and "row carrying your e-mail" in n for n in bridged["notes"]),
      bridged["notes"])
# one e-mail on two roster rows' people: the account's own row, and somebody else's under another name
carla = [{"id": "PPL_ANN", "name": "Ann Roe", "email": "", "phone": ""},
         {"id": "PPL_CARLA", "name": "Carla Diaz", "email": "ann@example.com", "phone": ""}]
own_row = mw.identity_from(USERS_ROW, "u-ann", roster_name="Ann Roe", people=carla, shared=lambda k: False)
check("an account whose own name has its roster row never gains a second name from its e-mail",
      own_row["keys"] == ["annroe"] and own_row["bridged"] == ""
      and any("not the one under your own name" in n for n in own_row["notes"])
      and "Carla" not in json.dumps(own_row), own_row)
alike = [{"id": "PPL_ANN", "name": "Ann Roe", "email": "", "phone": ""},
         {"id": "PPL_ANN2", "name": "Ann B. Roe-Smith", "email": "ann@example.com", "phone": ""}]
check("…even when the other row's name is a spelling of its own: two rows are two people until merged",
      mw.identity_from(USERS_ROW, "u-ann", roster_name="Ann Roe", people=alike, shared=lambda k: False)["keys"]
      == ["annroe"])
tester = {"user_id": "u-test", "display_name": "Staff Test", "email": "family@home.net", "active": "TRUE"}
other = [{"id": "PPL_O", "name": "Other Person", "email": "family@home.net", "phone": ""}]
stranger = mw.identity_from(tester, "u-test", roster_name="Staff Test", people=other, shared=lambda k: False)
check("a roster row under a name that does not match the account's adds no key, and never names that person",
      stranger["keys"] == ["stafftest"] and stranger["bridged"] == ""
      and any("does not match yours" in n for n in stranger["notes"]) and "Other" not in json.dumps(stranger),
      stranger)
check("…nor for an account with no name key of its own",
      mw.identity_from(tester, "u-test", roster_name="", people=other, shared=lambda k: False)["keys"] == [])
by_phone = mw.identity_from({**tester, "phone": "330-555-7777"}, "u-test", roster_name="Staff Test",
                            people=[{"id": "PPL_P", "name": "Paul Other", "email": "", "phone": "3305557777"}],
                            shared=lambda k: False)
check("a phone on one's own profile never bridges to a roster row", by_phone["keys"] == ["stafftest"]
      and by_phone["bridged"] == "" and not any("phone" in n for n in by_phone["notes"]), by_phone)
typo = mw.identity_from({"user_id": "u-t", "display_name": "Marisol Grant", "email": "mg@x.com", "active": "TRUE"},
                        "u-t", roster_name="Marisol Grant",
                        people=[{"id": "PPL_T", "name": "Marisel Grant", "email": "mg@x.com", "phone": ""}],
                        shared=lambda k: False)
check("a one-letter slip in a long name still bridges", typo["keys"] == ["mariselgrant", "marisolgrant"], typo)
spell = [("Ann Roe", "Ann B. Roe-Smith", True), ("Lena Marie Voss", "Lena Voss", True),
         ("Marisol Grant", "Marisel Grant", True), ("Carl Diaz", "Carla Diaz", False), ("Ann Roe", "Ann Smith", False),
         ("Staff Test", "Other Person", False), ("Ann", "Ann Roe", False), ("Maria Silva", "Ana Silva", False)]
check("same_spelling: every word of the shorter name in the longer, a long word one letter apart, two words at least",
      all(mw.same_spelling(a, b) == want and mw.same_spelling(b, a) == want for a, b, want in spell),
      [(a, b, mw.same_spelling(a, b)) for a, b, _w in spell])
mail_taken = mw.identity_from(USERS_ROW, "u-ann", roster_name="Ann Roe", people=bridge_people,
                              shared=lambda k: False, emails_taken={"ann@example.com"})
check("an e-mail another live account carries is no key, and bridges nothing; the notes say so",
      mail_taken["emails"] == [] and mail_taken["keys"] == ["annroe"]
      and any("e-mail on this account is on another account too" in n for n in mail_taken["notes"]), mail_taken)
mail_unknown = mw.identity_from(USERS_ROW, "u-ann", roster_name="Ann Roe", people=bridge_people,
                                shared=lambda k: False, emails_taken=None, emails_taken_why="RuntimeError")
check("FAIL-CLOSED: when whether an e-mail is shared cannot be read, no e-mail is a key",
      mail_unknown["emails"] == [] and mail_unknown["keys"] == ["annroe"]
      and any("could not be read (RuntimeError), so no e-mail is matched" in n for n in mail_unknown["notes"]),
      mail_unknown)
spouse = {"user_id": "u-sp", "display_name": "Sam Roe", "email": "sam@x.com", "emails": '["ann.roe@home.net"]',
          "active": "TRUE"}
old_acct = {"user_id": "u-gone", "display_name": "Gone Roe", "email": "ann@example.com", "active": "FALSE"}
mail_db = FakeDb(users={"u-ann": USERS_ROW, "u-sp": spouse, "u-gone": old_acct})
got_mail = mw.identity("dsn", "core", "u-ann", roster_name="Ann Roe", db=mail_db)
check("identity drops an e-mail a live account also carries; an inactive account's takes nothing",
      got_mail["emails"] == ["ann@example.com"] and any(r[0] == "emails" for r in mail_db.reads), got_mail)
mail_down = mw.identity("dsn", "core", "u-ann", roster_name="Ann Roe", db=FakeDb(emails_error=RuntimeError("down")))
check("identity: an e-mail check that cannot be read leaves no e-mail key, never every e-mail",
      mail_down["emails"] == [] and mail_down["keys"] == ["annroe"], mail_down)
try:
    mw.identity("dsn", "core", "boom", roster_name="Ann Roe", db=FakeDb())
    strict = "answered"
except Exception as exc:  # noqa: BLE001
    strict = type(exc).__name__
check("STRICT: a users row that cannot be read raises — never an empty identity", strict == "RuntimeError", strict)
got_id = mw.identity("dsn", "core", "u-ann", roster_name="Ann Roe", db=FakeDb())
check("identity reads the account's own row and the people roster narrowed to its keys",
      got_id["keys"] == ["annroe"] and "3305554444" in got_id["phones"])
noroster = mw.identity("dsn", "core", "u-ann", roster_name="Ann Roe", db=FakeDb(tab_errors={("S_PEOPLE", "Data")}))
check("a people roster that cannot be read adds no key and says so",
      noroster["keys"] == ["annroe"] and any("people roster could not be read" in n for n in noroster["notes"]))
taken = mw.identity_from(USERS_ROW, "u-ann", roster_name="Ann Roe", people=PEOPLE, phones_taken={"3305551234"})
check("a phone another live account carries changes nothing: profile phones are never keys, the roster's stays",
      taken["phones"] == ["3305554444"], taken)
unknown = mw.identity_from(USERS_ROW, "u-ann", roster_name="Ann Roe", people=PEOPLE, phones_taken=None,
                           phones_taken_why="RuntimeError")
check("FAIL-CLOSED: when whether a phone is shared cannot be read, no phone is a key — the roster's either",
      unknown["phones"] == [] and unknown["keys"] == ["annroe"]
      and any("could not be read (RuntimeError), so no phone is matched" in n for n in unknown["notes"]), unknown)
taken_roster = mw.identity_from(USERS_ROW, "u-ann", roster_name="Ann Roe", people=PEOPLE, phones_taken={"3305554444"})
check("the roster row's phone is dropped too when another account carries it",
      "3305554444" not in taken_roster["phones"], taken_roster["phones"])
office = {"user_id": "u-desk", "display_name": "Front Desk", "active": "TRUE", "phone": "330.555.1234"}
retired = {"user_id": "u-old", "display_name": "Old Desk", "active": "FALSE",
           "phones": '[{"label":"Work","number":"330-555-9876"}]'}
shared_db = FakeDb(users={"u-ann": USERS_ROW, "u-desk": office, "u-old": retired})
got_shared = mw.identity("dsn", "core", "u-ann", roster_name="Ann Roe", db=shared_db)
check("identity keeps only the roster's phone; the profile's phones are never keys",
      got_shared["phones"] == ["3305554444"]
      and any(r[0] == "phones" for r in shared_db.reads), [got_shared["phones"], shared_db.reads])
phones_down = mw.identity("dsn", "core", "u-ann", roster_name="Ann Roe",
                          db=FakeDb(phones_error=RuntimeError("down")))
check("identity: a phone check that cannot be read leaves no phone key, never every phone",
      phones_down["phones"] == [] and phones_down["keys"] == ["annroe"]
      and any("could not be read (RuntimeError)" in n for n in phones_down["notes"]), phones_down)

svc = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
tree = ast.parse(svc)


def segment(name):
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(svc, node) or ""
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == name for t in node.targets):
            return ast.get_source_segment(svc, node) or ""
    return ""


rn_ns = {"Any": object, "shift_requests": sr}
exec(segment("_roster_name_from"), rn_ns)  # noqa: S102 — the relay's own rule, lifted by name
live_ann = {"user_id": "u-ann", "display_name": "Ann Roe", "active": "TRUE"}
cases = [(live_ann, [live_ann]), (live_ann, [live_ann, {"user_id": "u-2", "display_name": "Ann  Roe", "active": ""}]),
         ({**live_ann, "active": "FALSE"}, [])]
agree = []
for me_row, namesakes in cases:
    name = rn_ns["_roster_name_from"](me_row, namesakes, "u-ann")
    agree.append(bool(mw.identity_from(me_row, "u-ann", roster_name=name)["keys"]) == bool(name))
check("the name key is the relay's own rule (_roster_name_from), never a second copy of it", all(agree), agree)

print("\nMY ACTIONS — compliance requirements")
req = rows_of(B, "requirements")
ids = sorted(r["id"].split(":")[-1] for r in req)
check("expired and expiring are listed, missing folds into one row; ok, na, disabled and HR checks never",
      ids == sorted(["dodd", "cpr", "w4_form", "car_insurance", "missing"]), ids)
by_id = {r["id"].split(":")[-1]: r for r in req}
check("a readable login ties a row to the account whatever name it carries; a withheld one ties nothing",
      "car_insurance" in ids and "Zed" not in json.dumps(req))
check("another person's row never leaves the server", "Bob Bee" not in json.dumps(req) and "bobbee" not in BLOB)
check("the checks HR runs are counted in words, never listed",
      "2 background or admin checks HR runs are not listed" in src(B, "requirements")["note"],
      src(B, "requirements")["note"])
check("expired is overdue; expiring is soon; the missing row is undated with its sentence",
      [by_id["dodd"]["due_tone"], by_id["cpr"]["due_tone"], by_id["missing"]["due"], by_id["missing"]["due_why"]]
      == ["overdue", "soon", "", "Nothing is on file, so there is no date to run out."],
      [by_id["dodd"]["due_tone"], by_id["cpr"]["due_tone"], by_id["missing"]])
check("a sheet's M/D/YYYY expiry lands on its day", by_id["cpr"]["due"] == D(15), by_id["cpr"]["due"])
check("condition, flow and phase come from the catalogue and the engine",
      [by_id["dodd"]["condition"], by_id["dodd"]["flow"], by_id["dodd"]["phase"], by_id["cpr"]["phase"],
       by_id["car_insurance"]["flow"], by_id["w4_form"]["flow"]]
      == ["Renew DODD 8-Hour", "Training renewal", "Expired", "Expires in 15 days", "Document renewal",
          "Onboarding paperwork"], [by_id[k]["condition"] for k in by_id])
check("training and documents are an in-page upload filed under the account's own name",
      by_id["dodd"]["action"]["kind"] == "upload" and by_id["dodd"]["action"]["certs"] == ["DODD 8-Hour"]
      and by_id["dodd"]["action"]["upload_for"] == "Ann Roe" and by_id["dodd"]["action"]["label"] == "Upload asset"
      and by_id["dodd"]["family"] == "credential", by_id["dodd"]["action"])
check("onboarding paperwork opens the tracker, with HR's sentence for whoever it does not open for",
      by_id["w4_form"]["action"]["href"] == "/app/employee-tracker/roster"
      and by_id["w4_form"]["action"]["label"] == "Complete form" and by_id["w4_form"]["action_why"] == "HR files this form.")
miss = by_id["missing"]
check("the missing row names how many, lists each with its evidence, and uploads only what can be uploaded",
      miss["condition"] == "Nothing on file for 2 requirements" and miss["phase"] == "Not on file"
      and detail(miss, "Mandt") == "Training" and detail(miss, "I-9 Form") == "Onboarding"
      and miss["action"]["certs"] == ["Mandt"], miss)
check("the evidence rides in the details", detail(by_id["dodd"], "Evidence") == "DODD 8-hour certificate")
watched = FakeDb()
run(db=watched)
own_reads = [r for r in watched.reads if r[0] == "tab" and r[1] != "S_CAT"]
check("own mode: every house read carries the account's keys in its SQL",
      own_reads and all(r[3] and any("annroe" in json.dumps(a) or "ann@example.com" in json.dumps(a)
                                     or a == "u-ann" for a in r[4]) for r in own_reads), own_reads)
check("own mode: the relay's own tables are asked for the account's keys alone",
      ("shift_requests", ["annroe"]) in watched.reads
      and all(r[2] == ["annroe"] for r in watched.reads if r[0] == "pool")
      and any("to_staff" in w and a[1] == ["annroe"] for w, a, _n in HANDOFF_CALLS)
      and any("from_staff" in w and a[0] == ["annroe"] for w, a, _n in HANDOFF_CALLS), watched.reads)
check("every transfer read names its row limit, so reaching it can be said",
      HANDOFF_CALLS and all(n == mw.HANDOFF_LIMIT for _w, _a, n in HANDOFF_CALLS), HANDOFF_CALLS)
nocat = run(db=FakeDb(tabs={k: v for k, v in TABS.items() if k != ("S_CAT", "Data")}))
nc = rows_of(nocat, "requirements")
check("a catalogue that cannot be read names each row by its id, drops none, and says why",
      sorted(r["id"].split(":")[-1] for r in nc) == sorted(["dodd", "cpr", "w4_form", "old", "car_insurance", "missing"])
      and by_id and all(r["action"] is None for r in nc)
      and "not mirrored yet — each requirement is named by its id" in src(nocat, "requirements")["note"],
      [[r["id"] for r in nc], src(nocat, "requirements")["note"]])
nobody_rows = run(db=FakeDb(tabs={**TABS, ("S_STATES", "Data"): [state("dodd", "expired", D(-3), key="bobbee",
                                                                         name="Bob Bee")]}))
check("no requirement row carrying the account's key is not attributable, in words — never 'nothing owed'",
      src(nobody_rows, "requirements")["state"] == "not_attributable"
      and "no requirement row carries your name (Ann Roe)" in src(nobody_rows, "requirements")["why"],
      src(nobody_rows, "requirements"))
empty_states = run(db=FakeDb(tabs={**TABS, ("S_STATES", "Data"): []}))
check("a declared house with no rows mirrored is unreadable, never an empty list",
      src(empty_states, "requirements")["state"] == "unreadable"
      and "declared but not mirrored" in src(empty_states, "requirements")["why"])
nofacts = run(db=FakeDb(facts_error=mw.Unreadable("the depot's Facts are not in the mirror")))
check("unreadable house pointers make every house source unreadable, in words — the rest still answer",
      all(src(nofacts, k)["state"] == "unreadable" and "Facts" in src(nofacts, k)["why"]
          for k in ("requirements", "policies", "support_requests"))
      and src(nofacts, "time_off")["state"] == "ready" and src(nofacts, "ist")["state"] == "ready")
undeclared = run(db=FakeDb(facts={k: v for k, v in FACTS.items() if k != mw.PTR_APPS}))
check("a house the depot does not declare is said, never read from a same-named tab",
      src(undeclared, "policies")["state"] == "unreadable" and mw.PTR_APPS in src(undeclared, "policies")["why"])


class FactsCursor:
    """The two reads PgMirror.pointers makes, answered newest first as its ORDER BY asks."""

    def __init__(self, facts):
        self.facts = facts

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, args=()):
        self.sql = sql

    def fetchone(self):
        return {"n": len(self.facts)}

    def fetchall(self):
        return [dict(f) for f in self.facts]


class FactsMirror(mw.PgMirror):
    def __init__(self, facts):
        super().__init__("dsn")
        self.facts = facts

    def _cursor(self):
        return FactsCursor(self.facts)


newest = FactsMirror([{"s": mw.PTR_APPS, "v": ""}, {"s": mw.PTR_APPS, "v": "OLD_BOOK"},
                      {"s": mw.PTR_STATES, "v": " S_STATES "}]).pointers()
check("the newest Facts row decides: a blank Value is no house, never an older row's book",
      newest == {mw.PTR_APPS: "", mw.PTR_STATES: "S_STATES"}, newest)
blanked = run(db=FakeDb(facts={**FACTS, mw.PTR_APPS: ""}))
check("…and a blank pointer makes its source unreadable, saying the newest pointer is blank",
      src(blanked, "policies")["state"] == "unreadable"
      and f"the depot's newest {mw.PTR_APPS} is blank" in src(blanked, "policies")["why"], src(blanked, "policies"))
nokeys = mw.identity_from({"user_id": "u-x", "display_name": "Ann Roe", "active": "TRUE"}, "u-x", roster_name="")
b3 = run(me=nokeys, who=sr.viewer("dsn", name="", role="staff", types="STAFF"))
check("no name key and no address: sources are not attributable with the reason, never zero",
      all(src(b3, k)["state"] == "not_attributable" and "shared" in src(b3, k)["why"]
          for k in ("requirements", "time_off", "shift_requests", "call_offs")), [src(b3, "requirements")])
login_only = mw.identity_from(USERS_ROW, "u-ann", roster_name="", people=[])
lo = {r["id"].split(":")[-1]: r for r in rows_of(run(me=login_only), "requirements")}
check("a row reached by sign-in alone offers no upload under a name another account shares — the words instead",
      list(lo) == ["car_insurance"] and lo["car_insurance"]["action"] is None
      and "yours alone" in lo["car_insurance"]["action_why"] and "Ann Roe" not in json.dumps(lo), lo)
check("…while a bridged spelling, the account's own, is the name an upload is filed under",
      all(r["action"]["upload_for"] == "Ann B. Roe-Smith"
          for r in rows_of(run(me=rescued), "requirements") if r["action"] and r["action"]["kind"] == "upload")
      and any(r["action"] and r["action"]["kind"] == "upload" for r in rows_of(run(me=rescued), "requirements")))

print("\nMY ACTIONS — client training (IST)")
istr = {r["id"].split(":", 1)[1]: r for r in rows_of(B, "ist")}
check("owed only, matched by e-mail, by phone or by the whole name; done and another's never",
      sorted(istr) == ["IST_1", "IST_2", "IST_3", "IST_6"], sorted(istr))
check("the platform's one window marks what is due soon (the shipped window)",
      [istr["IST_1"]["due_tone"], istr["IST_2"]["due_tone"], istr["IST_6"]["due_tone"]] == ["soon", "later", "overdue"])
ist_config.pin({**ist_config.SHIPPED, "ist_cert_expiring_days": "5"})
narrow = {r["id"].split(":", 1)[1]: r for r in rows_of(run(), "ist")}
ist_config.pin(dict(ist_config.SHIPPED))
check("…and the window is ist_config's, not a number in this file", narrow["IST_1"]["due_tone"] == "later")
check("a blank due date is a dash with its sentence",
      istr["IST_3"]["due"] == "" and istr["IST_3"]["due_why"] == "The IST record carries no due date.")
check("book training opens the tracker where IST lives, with the house manager's sentence otherwise",
      istr["IST_1"]["action"]["label"] == "Book training" and istr["IST_1"]["family"] == "event"
      and istr["IST_1"]["action"]["href"] == "/app/employee-tracker/roster" and "books this training" in istr["IST_1"]["action_why"])
check("the staff e-mail and phone never leave the server", "555-9876" not in BLOB and "330.555" not in BLOB)
ist_config.pin(None)
ist_config.forget()
saved_rules = ist_config.rules
ist_config.rules = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down"))
shipped_note = src(run(), "ist")["note"]
ist_config.rules = saved_rules
ist_config.pin(dict(ist_config.SHIPPED))
SHIPPED_DAYS = ist_config.int_of(dict(ist_config.SHIPPED), "ist_cert_expiring_days")
check("unread IST settings say the shipped window is the one colouring 'soon'",
      f"shipped {SHIPPED_DAYS}-day window" in shipped_note,
      shipped_note)
empty_ist = run(db=FakeDb(ist_rows=[]))
check("an IST house with no rows is unreadable, in words", src(empty_ist, "ist")["state"] == "unreadable")
cy_line = IST_ROWS + [{"id": "IST_7", "status": "done", "staffName": "Cy Far", "staffPhone": "330-555-4444",
                       "clientName": "Client Seven", "dueDate": D(3)}]
b_line = run(db=FakeDb(ist_rows=cy_line))
line_ids = sorted(r["id"].split(":", 1)[1] for r in rows_of(b_line, "ist"))
check("IST: a phone another name is recorded under claims nothing; the nameless training is counted, not claimed",
      line_ids == ["IST_1", "IST_3", "IST_6"]
      and "1 owed training with no name, recorded under a phone other names share, is not claimed as yours"
      in src(b_line, "ist")["note"], [line_ids, src(b_line, "ist")["note"]])

print("\nMY ACTIONS — policies")
pol = {r["id"].split(":")[-1]: r for r in rows_of(B, "policies")}
check("a pending row naming the account and an all-staff one it has not answered are owed",
      sorted(pol) == ["P1", "P2"], sorted(pol))
check("an all-staff policy the account read — by name or by e-mail — is not owed; a read row is never an action",
      "P3" not in pol and "P8" not in pol and "P4" not in pol and "P7" not in pol)
check("overdue is red; the button opens Policies' documents with the decision label",
      pol["P2"]["due_tone"] == "overdue" and pol["P1"]["due_tone"] == "soon"
      and pol["P1"]["action"]["href"] == "/app/policy-acks/documents" and pol["P1"]["action"]["label"] == "Enter decision"
      and pol["P1"]["condition"] == "Read and acknowledge Handbook v2")
READER_ACKS = [
    {"id": "V1", "policy": "Conduct", "version": "v3", "staff": "All staff", "status": "pending",
     "effectiveDate": D(-5) + "T12:00:00Z"},
    # the documents Reader writes a read with no version (src/lib/docReads.ts recordRead)
    {"id": "V2", "policy": "Conduct", "version": "", "staff": "Ann Roe", "status": "read",
     "effectiveDate": D(-1) + "T15:00:00Z"},
    {"id": "V3", "policy": "Leave", "version": "v2", "staff": "All staff", "status": "pending",
     "effectiveDate": D(-1) + "T12:00:00Z"},
    {"id": "V4", "policy": "Leave", "version": "", "staff": "Ann Roe", "status": "read",
     "effectiveDate": D(-30) + "T15:00:00Z"},
    {"id": "V5", "policy": "Travel", "version": "v1", "staff": "All staff", "status": "pending",
     "effectiveDate": D(-9) + "T12:00:00Z"},
    {"id": "V6", "policy": "Travel", "version": "v2", "staff": "Ann Roe", "status": "read",
     "effectiveDate": D(-1) + "T12:00:00Z"},
]
vpol = {r["id"].split(":")[-1] for r in rows_of(run(db=FakeDb(tabs={**TABS, ("S_APPS", "policyAcks"): READER_ACKS})),
                                               "policies")}
check("a read the Reader filed with no version answers the policy — unless it came before the owed row took "
      "effect; a read of another version answers nothing", vpol == {"V3", "V5"}, vpol)
check("…and the rule itself: same version, or one side blank and not read before it took effect",
      mw._answers([("conduct", "", date(2026, 9, 24))], ("conduct", "v3"), date(2026, 9, 20))
      and not mw._answers([("conduct", "", date(2026, 9, 1))], ("conduct", "v3"), date(2026, 9, 20))
      and mw._answers([("conduct", "", None)], ("conduct", "v3"), date(2026, 9, 20))
      and not mw._answers([("conduct", "v2", date(2026, 9, 24))], ("conduct", "v3"), date(2026, 9, 20))
      and not mw._answers([("other", "", None)], ("conduct", "v3"), None))
namesake_me = mw.identity_from(USERS_ROW, "u-ann", roster_name="", people=bridge_people, shared=lambda k: False)
owed_by_mail = {"id": "P9", "policy": "Badge", "version": "", "staff": "ann@example.com", "status": "pending",
                "effectiveDate": D(4)}
b_ns = run(me=namesake_me, db=FakeDb(tabs={**TABS, ("S_APPS", "policyAcks"): TABS[("S_APPS", "policyAcks")]
                                           + [owed_by_mail]}))
ns_ids = {r["id"] for r in rows_of(b_ns, "policies")}
check("a name another account shares cannot match its reads: the all-staff policies are a gap, in words — never "
      "drawn as owed, never dropped as answered",
      src(b_ns, "policies")["state"] == "ready"
      and "whether you answered 2 all-staff policies cannot be told" in src(b_ns, "policies")["gap"]
      and "shared with another account" in src(b_ns, "policies")["gap"]
      and not any(i.startswith("policies:all:") for i in ns_ids), [src(b_ns, "policies"), ns_ids])
check("…while a policy asked of the account by its own e-mail is still listed",
      ns_ids == {"policies:@me:P9"} and src(b_ns, "policies")["count"] == 1, ns_ids)
check("a source that settled everything carries no gap", src(B, "policies")["gap"] == "")
nameless_me = mw.identity_from({**USERS_ROW, "display_name": ""}, "u-ann", roster_name="", people=[])
b_nl = run(me=nameless_me, who=sr.viewer("dsn", name="", role="staff", types="STAFF"))
check("an account with no name files its reads under its e-mail, so those still settle all-staff rows",
      src(b_nl, "policies")["state"] == "ready"
      and "policies:all:P8" not in {r["id"] for r in rows_of(b_nl, "policies")}
      and "policies:all:P2" in {r["id"] for r in rows_of(b_nl, "policies")}, rows_of(b_nl, "policies"))

print("\nMY ACTIONS — transfers and decisions")
tr = rows_of(B, "transfers")
check("a shift offered to the account waits on its answer; a rehearsed one is counted, never drawn",
      [r["id"] for r in tr] == ["transfers:HO0000000001"] and tr[0]["action"]["href"] == "/app/calendarbuilder/swaps"
      and tr[0]["due_tone"] == "soon" and src(B, "transfers")["note"] == "1 rehearsal row is not shown", tr)
td = rows_of(B, "transfer_decisions")
check("a transfer naming the account as house manager waits on its approval",
      [r["id"].split(":")[1] for r in td] == ["HO0000000002"] and td[0]["phase"] == "House manager approval", td)
tod = rows_of(B, "time_off_decisions")
check("time off names the account's half as time_off.leg_for decides it — never its own request — and decides it "
      "in My Work's own panel through Time Off's door, never a link to Time Off",
      [r["id"].split(":")[1] for r in tod] == ["TO0000000007"] and tod[0]["phase"] == "House manager approval"
      and tod[0]["action"]["kind"] == "decide" and tod[0]["action"]["action"] == "timeOffDecide"
      and tod[0]["action"]["item_id"] == "TO0000000007" and not tod[0]["action"]["href"], tod)
time_off.view = lambda dsn, fresh=False: dict(TO_VIEW, settings={})
b5 = run()
time_off.view = lambda dsn, fresh=False: TO_VIEW
check("a directors list that cannot be read makes the decisions unreadable with time off's own sentence",
      src(b5, "time_off_decisions")["state"] == "unreadable"
      and src(b5, "time_off_decisions")["why"] == time_off.DIRECTORS_UNREAD, src(b5, "time_off_decisions"))
check("…while the person's own time off still answers", src(b5, "time_off")["state"] == "ready")
time_off.view = lambda dsn, fresh=False: {"minted": False, "rows": [], "settings": {}}
b6 = run()
time_off.view = lambda dsn, fresh=False: TO_VIEW
check("time off not set up is said, not drawn as nobody asking",
      src(b6, "time_off")["state"] == "unreadable" and time_off.NOT_SET_UP in src(b6, "time_off")["why"])

print("\nMY ACTIONS — Scheduling approvals")
sch = {r["id"]: r for r in rows_of(B, "scheduling")}
check("a waiting approval shows for its own seat only, matched by the account id: another seat's, an answered, a "
      "superseded or a declined one, an alert, and a row naming the account under another id never",
      sorted(sch) == ["scheduling:SI00000000A1", "scheduling:SI00000000A8", "scheduling:SI00000000B1"]
      and "SI00000000A2" not in BLOB and "SI00000000A7" not in BLOB and "SI00000000A6" not in BLOB
      and "SI00000000B2" not in BLOB, sorted(sch))
s1 = sch.get("scheduling:SI00000000A1") or {}
S1_ITEM = {"id": "SI00000000A1", "flow_id": "SF0000000001", "kind": "approval", "seat": "director",
           "seat_words": "Director approval", "title": "Cy Far asks to be off Mon 10/5 — 8A-4P at BM",
           "body": "Asked from the Scheduling page.", "house_code": "BM4060", "house_label": "BM", "date": D(10),
           "day_words": mw._day_words(TODAY + timedelta(days=10)), "shift_text": "8A-4P",
           "created_at": "2026-09-25T10:00:00Z", "test_mode": True}
check("the action is decide: Approve or decline, with the item's id, its two words and the item the panel draws",
      s1.get("action") == {"label": "Approve or decline", "kind": "decide", "app": "scheduling", "page": "calendar",
                           "href": f"/app/scheduling/calendar?house=BM4060&day={D(10)}", "certs": [],
                           "upload_for": "", "item_id": "SI00000000A1", "words": ["Approve", "Decline"],
                           "item": S1_ITEM}
      and s1.get("family") == "decision" and s1.get("action_why") == "", s1.get("action"))
check("the panel's item never carries the seat's e-mail or account id",
      "mail.test" not in json.dumps(s1) and "u-ann" not in json.dumps((s1.get("action") or {}).get("item")), s1)
t1 = sch.get("scheduling:SI00000000B1") or {}
check("a training approval reads like every other Scheduling approval: decide, the seat's phase, the shift's day",
      (t1.get("action") or {}).get("kind") == "decide" and t1["action"].get("words") == ["Approve", "Decline"]
      and t1["action"].get("item_id") == "SI00000000B1" and t1.get("flow") == "Scheduling"
      and t1.get("family") == "decision" and t1.get("phase") == "House manager approval"
      and t1.get("condition") == "Training — Dee Lux · Mon 10/5 · 8A-4P · BM" and t1.get("due") == D(10)
      and [d["label"] for d in t1.get("details") or []] == ["House", "Day", "Shift", "Details"], t1)
check("…and its item carries the flow, the seat, the words and when it was made",
      (t1.get("action") or {}).get("item", {}).get("flow_id") == "SF000000T001"
      and t1["action"]["item"].get("seat") == "house_manager"
      and t1["action"]["item"].get("seat_words") == "House manager approval"
      and t1["action"]["item"].get("body", "").startswith("Dee Lux has no IST at BM.")
      and t1["action"]["item"].get("created_at") == "2026-09-26T14:30:00Z"
      and t1["action"]["item"].get("test_mode") is False, (t1.get("action") or {}).get("item"))
check("condition is the title; the seat names the phase; the shift's day is the due date",
      s1.get("condition") == "Cy Far asks to be off Mon 10/5 — 8A-4P at BM" and s1.get("phase") == "Director approval"
      and s1.get("flow") == "Scheduling" and s1.get("due") == D(10) and s1.get("due_tone") == "later", s1)
check("the details are the house, the day, the shift and the item's words — and a test-mode item says so",
      detail(s1, "House") == "BM" and detail(s1, "Day") == mw._day_words(TODAY + timedelta(days=10))
      and detail(s1, "Shift") == "8A-4P" and detail(s1, "Details") == "Asked from the Scheduling page."
      and "test mode" in (detail(s1, "Test mode") or "") and detail(s1, "Waiting on") is None, s1.get("details"))
s8 = sch.get("scheduling:SI00000000A8") or {}
check("a link that is not Scheduling's own opens Scheduling's calendar; no day is the dash and its sentence",
      (s8.get("action") or {}).get("href") == "/app/scheduling/calendar" and s8.get("phase") == "House manager approval"
      and s8.get("due") == "" and s8.get("due_why") == "The item carries no shift day."
      and (s8.get("action") or {}).get("item", {}).get("date") == ""
      and s8["action"]["item"].get("day_words") == "", s8)
check("no row of any other source carries a decide target's fields",
      all("item_id" not in (r["action"] or {}) for r in B["actions"]["rows"]
          if r["source"] not in ("scheduling", "time_off_decisions")))
sw = FakeDb()
run(db=sw)
sched_reads = [r for r in sw.reads if r[0] == "tab" and r[1] == "S_SCHED"]
check("own mode asks the house for the waiting work of this account's id alone",
      len(sched_reads) == 1 and "to_uid" in sched_reads[0][3] and sched_reads[0][4] == ("work", "waiting", "u-ann"),
      sched_reads)
MS = mass()
msch = {r["id"]: r for r in rows_of(MS, "scheduling")}
check("mass: every waiting approval, each naming whom it waits on; nothing answered",
      sorted(msch) == ["scheduling:SI00000000A1", "scheduling:SI00000000A2", "scheduling:SI00000000A7",
                       "scheduling:SI00000000A8", "scheduling:SI00000000A9", "scheduling:SI00000000B1",
                       "scheduling:SI00000000B2"]
      and msch["scheduling:SI00000000A2"]["person"] == {"key": "bobbee", "name": "Bob Bee"}
      and detail(msch["scheduling:SI00000000A2"], "Waiting on") == "Bob Bee", sorted(msch))
check("…only the master's own seat is answered in the page, as its own answer; another seat's opens Scheduling",
      msch["scheduling:SI00000000A9"]["action"]["kind"] == "decide"
      and msch["scheduling:SI00000000A9"]["phase"] == "Your answer"
      and msch["scheduling:SI00000000A9"]["action"]["item"]["seat_words"] == "Your answer"
      and msch["scheduling:SI00000000A2"]["action"]["kind"] == "link"
      and msch["scheduling:SI00000000A2"]["action"]["label"] == "Open in Scheduling"
      and "item_id" not in msch["scheduling:SI00000000A2"]["action"]
      and "item" not in msch["scheduling:SI00000000A2"]["action"], msch["scheduling:SI00000000A2"]["action"])
check("…a director seat of a request the master holds no seat on is the master's to stand in on, through "
      "Scheduling's own door: its seat's phase, its item, still naming whom it was addressed to",
      msch["scheduling:SI00000000B2"]["phase"] == "Director approval"
      and msch["scheduling:SI00000000B2"]["action"]["kind"] == "decide"
      and msch["scheduling:SI00000000B2"]["action"]["item_id"] == "SI00000000B2"
      and "action" not in msch["scheduling:SI00000000B2"]["action"]
      and msch["scheduling:SI00000000B2"]["action_why"] == ""
      and detail(msch["scheduling:SI00000000B2"], "Waiting on") == "Bob Bee", msch["scheduling:SI00000000B2"])
check("…while another seat of the training stays its own, never the master's",
      msch["scheduling:SI00000000B1"]["action"]["kind"] == "link"
      and "item" not in msch["scheduling:SI00000000B1"]["action"], msch["scheduling:SI00000000B1"])
check("…and a chosen person narrows them on the server",
      [r["id"] for r in rows_of(mass(person="bobbee"), "scheduling")]
      == ["scheduling:SI00000000A2", "scheduling:SI00000000B2"])
undeclared_s = run(db=FakeDb(facts={k: v for k, v in FACTS.items() if k != mw.PTR_SCHED_INBOX}))
check("no house declared is unreadable, naming the pointer — never 'nothing waiting'",
      src(undeclared_s, "scheduling")["state"] == "unreadable"
      and mw.PTR_SCHED_INBOX in src(undeclared_s, "scheduling")["why"] and not rows_of(undeclared_s, "scheduling"),
      src(undeclared_s, "scheduling"))
down_s = run(db=FakeDb(tab_errors={("S_SCHED", "Data")}))
check("a house that cannot be read is unreadable in words; the other sources still answer",
      src(down_s, "scheduling")["state"] == "unreadable" and "RuntimeError" in src(down_s, "scheduling")["why"]
      and src(down_s, "requirements")["state"] == "ready", src(down_s, "scheduling"))
OK_BOOK = {"modified_time": "2026-09-25T09:00:00Z", "last_sync_at": "2026-09-25T09:05:00Z", "last_sync_status": "ok"}
no_rows = {**TABS, ("S_SCHED", "Data"): []}
unmirrored = run(db=FakeDb(tabs=no_rows))
check("a declared house with no rows and no word from the mirror is unreadable, never an empty list",
      src(unmirrored, "scheduling")["state"] == "unreadable"
      and "declared but not mirrored yet" in src(unmirrored, "scheduling")["why"], src(unmirrored, "scheduling"))
changed_since = run(db=FakeDb(tabs=no_rows, books={"S_SCHED": {**OK_BOOK, "modified_time": "2026-09-25T09:10:00Z"}}))
check("…and so is one that changed after its last copy",
      src(changed_since, "scheduling")["state"] == "unreadable", src(changed_since, "scheduling"))
empty_s = run(db=FakeDb(tabs=no_rows, books={"S_SCHED": OK_BOOK}))
check("…while one the mirror copied whole after its last change is a real empty: ready, count 0",
      src(empty_s, "scheduling")["state"] == "ready" and src(empty_s, "scheduling")["count"] == 0, src(empty_s, "scheduling"))
check("copied_whole: only an ok copy finished after the last change",
      mw.copied_whole(OK_BOOK) and not mw.copied_whole(None) and not mw.copied_whole({**OK_BOOK, "last_sync_status": "error"})
      and not mw.copied_whole({**OK_BOOK, "modified_time": ""}) and not mw.copied_whole({**OK_BOOK, "last_sync_at": None}))
no_uid = run(me={**ME, "uid": ""})
check("an account with no id is not attributable here, in words",
      src(no_uid, "scheduling")["state"] == "not_attributable" and "no id" in src(no_uid, "scheduling")["why"],
      src(no_uid, "scheduling"))

print("\nMY ACTIONS — Transportation's vehicle requests (Scheduling's seat reader, shared)")
import hashlib  # noqa: E402


def reader_json(key, mode, db=None):
    me, who = (ME, WHO) if mode == mw.MODE_OWN else (MASTER_ME, MASTER_WHO)
    ctx = mw.Ctx("dsn", mode=mode, me=me, who=who, lanes=LANES, lanes_why="", on=TODAY, db=db or FakeDb())
    return json.dumps(mw.READERS[key](ctx), ensure_ascii=False)


# scheduling()'s whole answer on this file's fixture, taken from the reader before it became _seat_decisions; the
# mass pin differs from it only by the master's stand-in on SI00000000B2
SCHED_PIN = {mw.MODE_OWN: "0c98e2fabb15e49c9a356e6fef516e7d75628847fd103ab9fc689e955d41e9cb",
             mw.MODE_MASS: "24a21604bbb559febfde8c452bc12b28fc4b67ef2993c0e0624b9328cc3833ad"}
SCHED_NOW = {m: hashlib.sha256(reader_json("scheduling", m).encode("utf-8")).hexdigest() for m in SCHED_PIN}
check("Scheduling's answer is byte for byte what it was before its reader was shared (own, and mass with the "
      "master's stand-in seat)", SCHED_NOW == SCHED_PIN, SCHED_NOW)
check("…and no Scheduling decide target names a door: the screen keeps its own default for it",
      all("action" not in (r["action"] or {}) for r in rows_of(mass(), "scheduling")))
VC_FACTS = [{"label": "Requested by", "value": "Cy Far · (330) 555-7777"}, {"label": "Vehicle", "value": "Van"},
            {"label": "When", "value": "Wed Oct 7, 1:00 PM – 3:20 PM"}, {"label": "Staff", "value": "Cy Far"},
            {"label": "Client", "value": "Beth Ann Sutter"}, {"label": "Trip type", "value": "Doctor appointment"},
            {"label": "Wheelchair-accessible vehicle", "value": "Yes"},
            {"label": "Details", "value": "Primary care follow-up"}]


def vci(iid, to_uid, to_name, state="waiting", box="work", **over):
    base = {"id": iid, "trip_id": "VT00000000A1", "box": box, "kind": "approval", "seat": "director",
            "to_uid": to_uid, "to_email": f"{to_uid}@mail.test", "to_name": to_name,
            "title": "Vehicle request — Cy Far", "body": "Van · Wed Oct 7, 1:00 PM – 3:20 PM · Doctor appointment",
            "facts": json.dumps(VC_FACTS), "date": D(12), "when": "Wed Oct 7, 1:00 PM – 3:20 PM", "state": state,
            "answered_by": "", "answered_at": "", "note": "", "link": "/app/my-work", "test_mode": "no",
            "created_at": "2026-09-25T10:00:00Z"}
    base.update(over)
    return base


LONG_FACTS = ([{"label": "L" * 60, "value": "v" * 400}, "not a pair", {"label": "Withheld", "value": redaction.MARKER_SECRET},
               {"label": "", "value": "no label"}, {"label": "Blank", "value": ""}]
              + [{"label": f"Fact {n}", "value": n} for n in range(20)])
VC_ROWS = [
    vci("VI00000000A1", "u-ann", "Ann Roe", test_mode="yes"),
    # the same request waits on the other director too: the first answer decides
    vci("VI00000000A2", "u-bob", "Bob Bee"),
    vci("VI00000000A3", "u-ann", "Ann Roe", state="superseded", answered_by="Bob Bee"),
    vci("VI00000000A4", "u-ann", "Ann Roe", state="approved", answered_by="Ann Roe"),
    vci("VI00000000A5", "u-ann", "Ann Roe", box="inbox", kind="info", seat="requester", state="posted",
        title="Your vehicle request was approved", link="/app/vehicle-calendar/calendar?trip=VT00000000A1"),
    # a seat is an account id: a row naming the account under another id is never the account's
    vci("VI00000000A6", "u-other", "Ann Roe"),
    vci("VI00000000A7", "u-boss", "The Boss"),
    vci("VI00000000A8", " u-ann ", "Ann Roe", trip_id="VT00000000A8", facts="{not json", date=""),
    vci("VI00000000A9", "u-ann", "Ann Roe", trip_id="VT00000000A9", facts=json.dumps(LONG_FACTS)),
]
VC_FACTS_PTR = {**FACTS, mw.PTR_VC_INBOX: "S_VC"}
VC_TABS = {**TABS, ("S_VC", "Data"): VC_ROWS}


def vc_db(**kw):
    return FakeDb(facts=kw.pop("facts", VC_FACTS_PTR), tabs=kw.pop("tabs", VC_TABS), **kw)


check("the source sits right after Scheduling's approvals, named for what it lists",
      [k for k, _ in mw.ACTION_SOURCES].index("vehicle_calendar")
      == [k for k, _ in mw.ACTION_SOURCES].index("scheduling") + 1
      and mw.LABELS["vehicle_calendar"] == "Vehicle requests" and mw.READERS["vehicle_calendar"] is mw.vehicle_calendar)
check("its house is one the board asks the depot for", mw.PTR_VC_INBOX == "HUB_HOUSE_VC_INBOX_ID"
      and mw.PTR_VC_INBOX in mw.POINTERS)
VB = run(db=vc_db())
VBLOB = json.dumps(VB)
vit = {r["id"]: r for r in rows_of(VB, "vehicle_calendar")}
check("a waiting request shows for its own seat only, matched by the account id: the other director's, a superseded "
      "or an approved one, the requester's inbox item and a row naming the account under another id never",
      sorted(vit) == ["vehicle_calendar:VI00000000A1", "vehicle_calendar:VI00000000A8",
                      "vehicle_calendar:VI00000000A9"]
      and "VI00000000A2" not in VBLOB and "VI00000000A5" not in VBLOB and "VI00000000A6" not in VBLOB, sorted(vit))
v1 = vit.get("vehicle_calendar:VI00000000A1") or {}
V1_ITEM = {"id": "VI00000000A1", "trip_id": "VT00000000A1", "kind": "approval", "seat": "director",
           "seat_words": "Director approval", "title": "Vehicle request — Cy Far",
           "body": "Van · Wed Oct 7, 1:00 PM – 3:20 PM · Doctor appointment", "facts": VC_FACTS, "date": D(12),
           "day_words": mw._day_words(TODAY + timedelta(days=12)), "when": "Wed Oct 7, 1:00 PM – 3:20 PM",
           "created_at": "2026-09-25T10:00:00Z", "test_mode": True}
check("the seat's own row is decide, answered in My Work through vehicleCalendarAnswer, with the item the panel draws",
      v1.get("action") == {"label": "Approve or decline", "kind": "decide", "app": "vehicle-calendar",
                           "page": "calendar", "href": "/app/my-work", "certs": [], "upload_for": "",
                           "item_id": "VI00000000A1", "words": ["Approve", "Decline"],
                           "action": "vehicleCalendarAnswer", "item": V1_ITEM}
      and v1.get("action_why") == "", v1.get("action"))
check("the panel's item never carries the seat's e-mail or account id",
      "mail.test" not in json.dumps(v1) and "u-ann" not in json.dumps((v1.get("action") or {}).get("item")), v1)
check("condition is the title; Transportation is the flow; the trip's day is the due date; a decision family",
      v1.get("condition") == "Vehicle request — Cy Far" and v1.get("flow") == "Transportation"
      and v1.get("phase") == "Director approval" and v1.get("family") == "decision"
      and v1.get("due") == D(12) and v1.get("due_tone") == "later", v1)
check("the details are the item's own facts in their order, then the test-mode word; no 'Waiting on' on an own read",
      [d["label"] for d in v1.get("details") or []] == [f["label"] for f in VC_FACTS] + ["Test mode"]
      and detail(v1, "Client") == "Beth Ann Sutter" and "test mode" in (detail(v1, "Test mode") or "")
      and detail(v1, "Waiting on") is None, v1.get("details"))
v8 = vit.get("vehicle_calendar:VI00000000A8") or {}
check("facts that are not the JSON pairs are none, never a crash; no day is the dash and its sentence",
      (v8.get("action") or {}).get("item", {}).get("facts") == [] and v8.get("details") == []
      and v8.get("due") == "" and v8.get("due_why") == "The item carries no trip day.", v8)
v9 = vit.get("vehicle_calendar:VI00000000A9") or {}
f9 = (v9.get("action") or {}).get("item", {}).get("facts") or []
check("facts are capped as written: twelve pairs, a label of 40, a value of 240; a withheld, blank or unlabelled "
      "one and anything that is not a pair are left out",
      len(f9) == 12 and f9[0] == {"label": "L" * 40, "value": "v" * 240}
      and [f["label"] for f in f9[1:]] == [f"Fact {n}" for n in range(11)] and f9[1]["value"] == "0"
      and redaction.MARKER_SECRET not in json.dumps(v9) and v9.get("details") == f9, f9)
check("no row of any other source names a door", all("action" not in (r["action"] or {}) for r in VB["actions"]["rows"]
                                                       if r["source"] not in ("vehicle_calendar", "time_off_decisions")))
vw = vc_db()
run(db=vw)
vc_reads = [r for r in vw.reads if r[0] == "tab" and r[1] == "S_VC"]
check("own mode asks the house for the waiting work of this account's id alone",
      len(vc_reads) == 1 and "to_uid" in vc_reads[0][3] and vc_reads[0][4] == ("work", "waiting", "u-ann"), vc_reads)
VM = mass(db=vc_db())
vmit = {r["id"]: r for r in rows_of(VM, "vehicle_calendar")}
check("mass: every waiting request, each naming whom it waits on; nothing answered",
      sorted(vmit) == [f"vehicle_calendar:VI00000000A{n}" for n in (1, 2, 6, 7, 8, 9)]
      and vmit["vehicle_calendar:VI00000000A2"]["person"] == {"key": "bobbee", "name": "Bob Bee"}
      and detail(vmit["vehicle_calendar:VI00000000A2"], "Waiting on") == "Bob Bee", sorted(vmit))
check("…the door is named on the master's own seat, and on one director seat of each request the master holds none of; "
      "another seat's has no target and says whom it waits on",
      [k for k, r in sorted(vmit.items()) if (r["action"] or {}).get("action") == "vehicleCalendarAnswer"]
      == ["vehicle_calendar:VI00000000A7", "vehicle_calendar:VI00000000A8", "vehicle_calendar:VI00000000A9"]
      and vmit["vehicle_calendar:VI00000000A7"]["phase"] == "Director approval"
      and vmit["vehicle_calendar:VI00000000A8"]["action"]["item_id"] == "VI00000000A8"
      and vmit["vehicle_calendar:VI00000000A8"]["action_why"] == ""
      and detail(vmit["vehicle_calendar:VI00000000A8"], "Waiting on") == "Ann Roe"
      and vmit["vehicle_calendar:VI00000000A2"]["action"] is None
      and vmit["vehicle_calendar:VI00000000A2"]["action_why"] == "Waiting on Bob Bee.", vmit["vehicle_calendar:VI00000000A2"])
two_seats = mass(db=vc_db(tabs={**TABS, ("S_VC", "Data"): [vci("VI00000000C1", "u-ann", "Ann Roe"),
                                                           vci("VI00000000C2", "u-bob", "Bob Bee")]}))
tsr = {r["id"]: r for r in rows_of(two_seats, "vehicle_calendar")}
check("…one decide row per request: the first waiting director seat; the sibling still says whom it waits on",
      (tsr["vehicle_calendar:VI00000000C1"]["action"] or {}).get("item_id") == "VI00000000C1"
      and tsr["vehicle_calendar:VI00000000C2"]["action"] is None
      and tsr["vehicle_calendar:VI00000000C2"]["action_why"] == "Waiting on Bob Bee.", tsr)
own_two = run(db=vc_db(tabs={**TABS, ("S_VC", "Data"): [vci("VI00000000C2", "u-bob", "Bob Bee")]}),
              who=sr.viewer("dsn", name="Ann Roe", role="admin", types="ADMIN DIRECTOR", is_master=False))
check("…and no own session stands in on anybody's seat, whatever its badges",
      not rows_of(own_two, "vehicle_calendar"), rows_of(own_two, "vehicle_calendar"))
check("…and a chosen person narrows them on the server",
      [r["id"] for r in rows_of(mass(db=vc_db(), person="bobbee"), "vehicle_calendar")]
      == ["vehicle_calendar:VI00000000A2"])
nameless = mass(db=vc_db(tabs={**TABS, ("S_VC", "Data"): [vci("VI00000000A7", "u-boss", "The Boss"),
                                                          vci("VI00000000B1", "u-bob", "")]}))
check("a waiting request whose seat carries no name still says it waits on someone",
      [r["action_why"] for r in rows_of(nameless, "vehicle_calendar")
       if r["id"] == "vehicle_calendar:VI00000000B1"] == ["Waiting on another seat."])
undeclared_v = run(db=FakeDb())
check("no house declared is unreadable, naming the pointer — never 'nothing waiting'",
      src(undeclared_v, "vehicle_calendar")["state"] == "unreadable"
      and mw.PTR_VC_INBOX in src(undeclared_v, "vehicle_calendar")["why"]
      and not rows_of(undeclared_v, "vehicle_calendar"), src(undeclared_v, "vehicle_calendar"))
down_v = run(db=vc_db(tab_errors={("S_VC", "Data")}))
check("a house that cannot be read is unreadable in words; the other sources still answer",
      src(down_v, "vehicle_calendar")["state"] == "unreadable" and "RuntimeError" in src(down_v, "vehicle_calendar")["why"]
      and src(down_v, "scheduling")["state"] == "ready", src(down_v, "vehicle_calendar"))
no_vc = {**TABS, ("S_VC", "Data"): []}
unmirrored_v = run(db=vc_db(tabs=no_vc))
check("a declared house with no rows and no word from the mirror is unreadable, never an empty list",
      src(unmirrored_v, "vehicle_calendar")["state"] == "unreadable"
      and src(unmirrored_v, "vehicle_calendar")["why"]
      == "the house of Transportation's items is declared but not mirrored yet", src(unmirrored_v, "vehicle_calendar"))
empty_v = run(db=vc_db(tabs=no_vc, books={"S_VC": OK_BOOK}))
check("…while one the mirror copied whole after its last change is a real empty: ready, count 0",
      src(empty_v, "vehicle_calendar")["state"] == "ready" and src(empty_v, "vehicle_calendar")["count"] == 0,
      src(empty_v, "vehicle_calendar"))
no_uid_v = run(me={**ME, "uid": ""}, db=vc_db())
check("an account with no id is not attributable here, in words",
      src(no_uid_v, "vehicle_calendar")["state"] == "not_attributable"
      and "no Transportation approval" in src(no_uid_v, "vehicle_calendar")["why"], src(no_uid_v, "vehicle_calendar"))


def sri(iid, to_uid, to_name, state="waiting", box="work", **over):
    base = {"id": iid, "ref": "HQ6EEF063DEE", "box": box, "kind": "redirect", "seat": "redirect",
            "to_uid": to_uid, "to_email": f"{to_uid}@mail.test", "to_name": to_name,
            "title": "Payroll from Angel Fiber", "body": "Missing paycheck for last week", "house_label": "", "date": "",
            "state": state, "answered_by": "", "answered_at": "", "note": "Redirected by Ty Bond: Please call her back",
            "link": "/app/support-desk/requests?ref=HQ6EEF063DEE", "test_mode": "no",
            "created_at": "2026-10-01T15:00:00Z"}
    base.update(over)
    return base


SR_ROWS = [
    sri("SN00000000A1", "u-ann", "Ann Roe"),
    # redirected on to somebody else: closed for Ann
    sri("SN00000000A2", "u-ann", "Ann Roe", state="redirected", answered_by="Ann Roe"),
    sri("SN00000000A3", "u-bob", "Bob Bee", ref="HQ5EF1CB5F25"),
    # an alert of the same house is My Inbox's, never My Work's
    sri("SN00000000A4", "u-ann", "Ann Roe", box="inbox", kind="warning", seat="director", state="posted"),
    sri("SN00000000A5", "u-ann", "Ann Roe", state="denied", answered_by="Ann Roe"),
]
SR_FACTS_PTR = {**FACTS, mw.PTR_SUPPORT_INBOX: "S_SR"}


def sr_db(**kw):
    return FakeDb(facts=kw.pop("facts", SR_FACTS_PTR), tabs=kw.pop("tabs", {**TABS, ("S_SR", "Data"): SR_ROWS}), **kw)


check("Support Requests' redirects sit right after the vehicle requests, read from its own house",
      [k for k, _ in mw.ACTION_SOURCES].index("support_desk")
      == [k for k, _ in mw.ACTION_SOURCES].index("vehicle_calendar") + 1
      and mw.LABELS["support_desk"] == "Support Requests" and mw.READERS["support_desk"] is mw.support_desk
      and mw.PTR_SUPPORT_INBOX in mw.POINTERS)
SB = run(db=sr_db())
SBLOB = json.dumps(SB)
sit = {r["id"]: r for r in rows_of(SB, "support_desk")}
check("a request redirected to the account waits in its My Work alone: one redirected on, one decided, another "
      "account's and an alert of the same house never",
      sorted(sit) == ["support_desk:SN00000000A1"] and "SN00000000A2" not in SBLOB and "SN00000000A3" not in SBLOB
      and "SN00000000A4" not in SBLOB and "SN00000000A5" not in SBLOB, sorted(sit))
s1 = sit.get("support_desk:SN00000000A1") or {}
S1_ITEM = {"id": "SN00000000A1", "ref": "HQ6EEF063DEE", "kind": "redirect", "seat": "redirect",
           "seat_words": "Redirected", "title": "Payroll from Angel Fiber", "body": "Missing paycheck for last week",
           "note": "Redirected by Ty Bond: Please call her back", "date": "", "day_words": "",
           "created_at": "2026-10-01T15:00:00Z", "test_mode": False}
check("its row is decide, answered in My Work through supportDeskDecide with the four words, the item naming the ref",
      s1.get("action") == {"label": "Answer the request", "kind": "decide", "app": "support-desk", "page": "requests",
                           "href": "/app/my-work", "certs": [], "upload_for": "", "item_id": "SN00000000A1",
                           "words": ["Approve", "Deny", "Resolved", "Redirect"], "action": "supportDeskDecide",
                           "item": S1_ITEM}
      and s1.get("action_why") == "", s1.get("action"))
check("the title is the condition, Support Requests the flow, Redirected the phase; no due day, said so",
      s1.get("condition") == "Payroll from Angel Fiber" and s1.get("flow") == "Support Requests"
      and s1.get("phase") == "Redirected" and s1.get("family") == "decision" and s1.get("due") == ""
      and s1.get("due_why") == "A support request carries no due day.", s1)
check("the details: the ref, who redirected it and why, the request's words; never the holder's e-mail or id",
      detail(s1, "Request") == "HQ6EEF063DEE" and detail(s1, "Redirected") == "Redirected by Ty Bond: Please call her back"
      and detail(s1, "Details") == "Missing paycheck for last week" and detail(s1, "Waiting on") is None
      and "mail.test" not in json.dumps(s1) and "u-ann" not in json.dumps(s1), s1.get("details"))
sw = sr_db()
run(db=sw)
sr_reads = [r for r in sw.reads if r[0] == "tab" and r[1] == "S_SR"]
check("own mode asks the house for the waiting work of this account's id alone",
      len(sr_reads) == 1 and sr_reads[0][4] == ("work", "waiting", "u-ann"), sr_reads)
SM = mass(db=sr_db())
smit = {r["id"]: r for r in rows_of(SM, "support_desk")}
check("mass: every waiting redirect names whom it waits on, and the master answers each through supportDeskDecide, "
      "as a director may",
      sorted(smit) == ["support_desk:SN00000000A1", "support_desk:SN00000000A3"]
      and detail(smit["support_desk:SN00000000A3"], "Waiting on") == "Bob Bee"
      and (smit["support_desk:SN00000000A3"]["action"] or {}).get("action") == "supportDeskDecide"
      and smit["support_desk:SN00000000A3"]["action"]["item_id"] == "SN00000000A3"
      and smit["support_desk:SN00000000A3"]["action_why"] == "", smit)
undeclared_sr = run(db=FakeDb())
check("no house declared is unreadable, naming the pointer — never 'nothing redirected'",
      src(undeclared_sr, "support_desk")["state"] == "unreadable"
      and mw.PTR_SUPPORT_INBOX in src(undeclared_sr, "support_desk")["why"], src(undeclared_sr, "support_desk"))
unmirrored_sr = run(db=sr_db(tabs={**TABS, ("S_SR", "Data"): []}))
check("a declared house the mirror never copied is unreadable; one copied whole and empty is a real zero",
      src(unmirrored_sr, "support_desk")["why"] == "the house of Support Requests' items is declared but not mirrored yet"
      and src(run(db=sr_db(tabs={**TABS, ("S_SR", "Data"): []}, books={"S_SR": OK_BOOK})), "support_desk")["count"] == 0,
      src(unmirrored_sr, "support_desk"))
check("Scheduling's and Transportation's answers are untouched by the third spec",
      SCHED_NOW == SCHED_PIN and all((r["action"] or {}).get("words") == ["Approve", "Decline"]
                                     for r in rows_of(VB, "vehicle_calendar") if r["action"]))

print("\nMY REQUESTS — time off")
REASON_CALLS.clear()
B = run()
BLOB = json.dumps(B)
tor = {r["ref"]: r for r in rows_of(B, "time_off")}
check("only the person ON the request: one filed for somebody else, or asked of the account, is not here",
      sorted(tor) == ["TO0000000001", "TO0000000002", "TO0000000003", "TO0000000004", "TO0000000005",
                      "TO0000000008"], sorted(tor))
check("the exact name key only: 'Ann Marie Roe' and 'Ann Q. Roe' are other people, never on Ann Roe's board",
      "TO0000000009" not in BLOB and "TO0000000010" not in BLOB and "Ann Marie" not in BLOB
      and "Ann Q" not in BLOB and time_off.same_person("Ann Marie Roe", "Ann Roe"))
check("…while the master's read still lists them, each under its own person",
      {r["ref"]: r["person"]["name"] for r in rows_of(mass(), "time_off")
       if r["ref"] in ("TO0000000009", "TO0000000010")}
      == {"TO0000000009": "Ann Marie Roe", "TO0000000010": "Ann Q. Roe"})
check("pending is open with where it stands; review is open; approved and denied are resolved; an unknown word is "
      "recorded, never resolved",
      [tor["TO0000000001"]["status"]["class"], tor["TO0000000008"]["status"], tor["TO0000000002"]["status"],
       tor["TO0000000003"]["status"], tor["TO0000000004"]["status"]]
      == ["open", {"class": "open", "word": "Needs review"}, {"class": "resolved", "word": "Approved"},
          {"class": "resolved", "word": "Denied"}, {"class": "recorded", "word": "Paused"}],
      [tor[k]["status"] for k in sorted(tor)])
check("the reason is read for the account's own open request, and only there",
      REASON_CALLS == ["TO0000000001"] and detail(tor["TO0000000001"], "Reason") == "family wedding"
      and detail(tor["TO0000000003"], "Reason") == "Given — Time Off shows it on the request", REASON_CALLS)
check("the raw reason column never travels", "MY SECRET REASON" not in BLOB)
check("a telephone filing says so, and who took the call",
      detail(tor["TO0000000001"], "Filed") == "By telephone — taken by Hal Desk")
check("a row filed while test mode was on says so",
      detail(tor["TO0000000005"], "Test mode") == "Filed while test mode was on")
check("REQUEST ID is the TO ref and the link opens it in Time Off",
      tor["TO0000000001"]["link"]["href"] == "/app/timeoff/requests?ref=TO0000000001"
      and tor["TO0000000001"]["submitted"] == "2026-09-20T12:00:00Z")

print("\nMY REQUESTS — support requests and phone requests")
sup = {r["ref"]: r for r in rows_of(B, "support_requests")}
check("exact keys: the sign-in e-mail and the whole name; an e-mail or phone typed on one's own profile claims nothing",
      sorted(sup) == ["REQ_EMAIL", "REQ_NAME", "REQ_PHONE", "REQ_TWIN", "REQ_WORD"], sorted(sup))
check("a longer name that merely contains the account's is never matched", "REQ_CONTAINS" not in sup)
check("a longer digit run that merely contains the account's number is never matched", "REQ_LONGER" not in sup)
check("a line another name calls from claims nothing: neither the other's request nor the nameless one",
      "REQ_LINE_CY" not in sup and "REQ_LINE_NONAME" not in sup and "Cy's own words" not in BLOB
      and "Nameless on a shared line" not in BLOB)
check("…and the nameless request left unclaimed is counted in words",
      "1 request with no name, made from a phone line other names also use, is not claimed as yours"
      in src(B, "support_requests")["note"], src(B, "support_requests")["note"])
sup_reads = [r for r in watched.reads if r[0] == "tab" and r[1] == "S_REQ"]
check("own mode asks the queue by exact last ten digits, never a contains-match",
      sup_reads and "LIKE" not in sup_reads[0][3] and "right(regexp_replace" in sup_reads[0][3]
      and ["3305554444"] in [list(a) for a in sup_reads[0][4]], sup_reads)
check("verdict words for a resolved request; needs dates is open; an unknown word is recorded",
      [sup["REQ_PHONE"]["status"], sup["REQ_NAME"]["status"], sup["REQ_EMAIL"]["status"], sup["REQ_WORD"]["status"]]
      == [{"class": "resolved", "word": "Approved"}, {"class": "resolved", "word": "Resolved"},
          {"class": "open", "word": "Needs dates"}, {"class": "recorded", "word": "Escalated"}])
check("the PII keys never travel", "1990-01-01" not in BLOB and "ann-login" not in BLOB)
spec = importlib.util.spec_from_file_location("import_staff_requests", ROOT / "tools" / "import_staff_requests.py")
isr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(isr)
check("the de-duplication key is the legacy import's own key_of over the received day",
      mw._support_key("Ann Roe", "ADP - Pay Stubs", "Request for last two pay stubs.", "2026-09-17T04:00:00.000Z")
      == isr.key_of("Ann Roe", "ADP - Pay Stubs", "Request for last two pay stubs.", "2026-09-17"))
hot = {r["request"]: r for r in rows_of(B, "hotline")}
check("a phone request also in the Support Requests Queue is listed once, there, with the queue named",
      not any("Pay Stubs" in k for k in hot) and detail(sup["REQ_TWIN"], "Also in") == "the Employee Support Queue"
      and "1 phone request is also in the Support Requests Queue" in src(B, "hotline")["note"], [list(hot), src(B, "hotline")])
check("the queue matches by the whole name — never a longer name",
      sorted(hot) == ["Phone request · Done thing", "Phone request · Other", "Phone request · PSI - Reset Password"],
      sorted(hot))
check("somebody else calling from the account's own number is theirs, never the account's",
      "Somebody" not in BLOB and "somebody's words" not in BLOB)
check("a line two other names call from claims nothing — neither theirs nor the nameless call",
      not any("house line" in k for k in hot) and "Cy on the house line" not in BLOB)
check("…and the nameless call left unclaimed is counted in words",
      "1 phone request with no name, made from a phone line other names also use, is not claimed as yours"
      in src(B, "hotline")["note"], src(B, "hotline")["note"])
dup = dict(next(r for r in QUEUE_ROWS if r["id"] == "r12"), id="r99")
dup_board = run(lanes=dict(LANES, supportQueue=lane(QUEUE_ROWS + [dup])))
dups = [r for r in rows_of(dup_board, "hotline") if r["request"] == "Phone request · Other"]
check("the same request logged twice keeps its ref with a count: no two rows share a ref or an id",
      len(dups) == 2 and dups[0]["ref"] != dups[1]["ref"] and dups[0]["id"] != dups[1]["id"]
      and sorted(len(r["ref"]) for r in dups) == [12, 14] and any(r["ref"].endswith("-2") for r in dups)
      and all(detail(r, "Logged") == "2 times in the queue with the same words on the same day" for r in dups),
      [(r["id"], r["ref"]) for r in dups])
check("…and a request logged once says nothing about repeats",
      detail(hot["Phone request · Done thing"], "Logged") is None)
ids_all = [r["id"] for p in ("actions", "requests") for r in dup_board[p]["rows"]]
check("every row id on the board is its own", len(ids_all) == len(set(ids_all)))
check("a blank status is open; an unknown word is recorded; resolved is resolved",
      [hot["Phone request · PSI - Reset Password"]["status"], hot["Phone request · Other"]["status"]["class"],
       hot["Phone request · Done thing"]["status"]["class"]] == [{"class": "open", "word": "New"}, "recorded", "resolved"])
refs = {r["request"]: r["ref"] for r in rows_of(B, "hotline")}
shuffled = dict(LANES, supportQueue=lane([dict(r, id=f"r{90 - i}") for i, r in enumerate(reversed(QUEUE_ROWS))]))
refs2 = {r["request"]: r["ref"] for r in rows_of(run(lanes=shuffled), "hotline")}
check("the HQ ref is the request's own hash: it stays put when the queue's rows move",
      refs == refs2 and all(re.fullmatch(r"HQ[0-9A-F]{10}", v) for v in refs.values()), [refs, refs2])
check("the requestor's phone never travels", "330-555-1234" not in BLOB and "330-555-0000" not in BLOB)
failed = dict(LANES, supportQueue=lane(None, ok=False, error="The Employee Support Queue could not be read (HttpError)."))
bf = run(lanes=failed)
check("a lane that failed is unreadable with the lane's own sentence",
      src(bf, "hotline")["state"] == "unreadable" and "HttpError" in src(bf, "hotline")["why"])
stale = dict(LANES, supportQueue=lane(QUEUE_ROWS, ok=False, error="The queue did not answer. Showing the copy read at 12:00:00Z."))
bs = run(lanes=stale)
check("a held copy is still shown, with its stale sentence",
      src(bs, "hotline")["state"] == "ready" and "Showing the copy" in src(bs, "hotline")["stale_why"]
      and len(rows_of(bs, "hotline")) == 3)
bn = run(lanes=None, lanes_why="the hotline lanes are not loaded on this server")
check("no lanes at all: all three lane sources say why",
      all(src(bn, k)["state"] == "unreadable" and "not loaded" in src(bn, k)["why"]
          for k in ("hotline", "call_offs", "incidents")))

print("\nMY REQUESTS — shift applications and transfers")
srr = {r["ref"]: r for r in rows_of(B, "shift_requests")}
check("the account's own applications only; a rehearsed one is counted, never drawn",
      sorted(srr) == ["SR0000000001", "SR0000000002", "SR0000000003", "SR0000000006"]
      and src(B, "shift_requests")["note"] == "1 rehearsal row is not shown", sorted(srr))
check("a call-off's caller never travels", "Zed Caller" not in BLOB)
check("applied and training approval are open; not chosen is resolved; an unknown word is recorded",
      [srr["SR0000000001"]["status"]["class"], srr["SR0000000003"]["status"]["word"],
       srr["SR0000000002"]["status"]["class"], srr["SR0000000006"]["status"]]
      == ["open", "Needs training approval", "resolved", {"class": "recorded", "word": "On hold"}])
check("the link opens the pooled shift on its house calendar, as the router's own address",
      srr["SR0000000001"]["link"]["href"].startswith("/app/calendarbuilder/house-cal?house=")
      and srr["SR0000000001"]["link"]["href"].endswith("ref=SPAAAAAAAAAA")
      and detail(srr["SR0000000001"], "Shift handle") == "SPAAAAAAAAAA", srr["SR0000000001"]["link"])
tout = {r["ref"]: r for r in rows_of(B, "transfers_out")}
check("transfers of the account's own shifts only — one it offered for somebody else is theirs",
      sorted(tout) == ["HO0000000004", "HO0000000005", "HO0000000006", "HO0000000008"], sorted(tout))
check("pending waits on the consent still owed; done is transferred; dead is closed",
      [tout["HO0000000004"]["status"]["word"], tout["HO0000000008"]["status"]["word"],
       tout["HO0000000005"]["status"], tout["HO0000000006"]["status"]["word"]]
      == ["Waiting on Bob Bee", "Waiting on a director", {"class": "resolved", "word": "Transferred"}, "Closed"])

print("\nMY REQUESTS — call-offs, incidents, repairs")
co = {r["ref"]: r for r in rows_of(B, "call_offs")}
check("Call Off and Late Show only: records about the person and another's are not here",
      sorted(co) == ["CO1", "CO10", "CO2", "CO3", "CO5", "CO6", "CO7"], sorted(co))
check("the pool decides: covered, closed, pooled and still ahead, past; a late call is logged; no day is filed",
      [co["CO5"]["status"], co["CO6"]["status"], co["CO1"]["status"], co["CO7"]["status"], co["CO2"]["status"],
       co["CO3"]["status"]]
      == [{"class": "resolved", "word": "Covered"}, {"class": "resolved", "word": "Closed"},
          {"class": "open", "word": "Being covered"}, {"class": "resolved", "word": "Past"},
          {"class": "recorded", "word": "Late call logged"}, {"class": "recorded", "word": "Filed"}],
      {k: v["status"] for k, v in co.items()})
check("a shift still ahead that was never pooled is 'Filed' with its sentence, never 'Being covered'",
      co["CO10"]["status"] == {"class": "recorded", "word": "Filed"}
      and "not in the open-shift pool yet" in detail(co["CO10"], "Status"), co["CO10"])
check("the person who covered is never named to the person who called off", "Cy Far" not in json.dumps(co["CO5"]))
bp = run(db=FakeDb(pool_error=RuntimeError("down")))
cop = {r["ref"]: r for r in rows_of(bp, "call_offs")}
check("a pool that cannot be read is 'Filed' with its sentence, never covered or open",
      cop["CO5"]["status"] == {"class": "recorded", "word": "Filed"}
      and "could not be read (RuntimeError)" in detail(cop["CO5"], "Status") and src(bp, "call_offs")["state"] == "ready")
inc = rows_of(B, "incidents")
check("an incident report is 'Filed' under its IN ref; matched by name or e-mail; another's is not here",
      len(inc) == 2 and all(r["status"] == {"class": "recorded", "word": "Filed"} and re.fullmatch(r"IN[0-9A-F]{10}", r["ref"])
                            for r in inc) and "Bob Bee" not in json.dumps(inc), inc)
check("every column of the report is a detail", detail(inc[-1] if inc[-1]["request"].endswith("Fall") else inc[0],
                                                      "Summary") == "slipped")
twice = dict(LANES, uiIncidents=lane(LANES["uiIncidents"]["rows"] + [dict(LANES["uiIncidents"]["rows"][0], id="r9")]))
inc2 = [r for r in rows_of(run(lanes=twice), "incidents") if r["request"].endswith("Fall")]
check("an incident report filed twice keeps its IN ref with a count: two refs, two ids",
      len(inc2) == 2 and len({r["ref"] for r in inc2}) == 2 and len({r["id"] for r in inc2}) == 2
      and any(r["ref"].endswith("-2") for r in inc2), [(r["id"], r["ref"]) for r in inc2])
check("a secret-named field is withheld and a password field never travels",
      "hunter2" not in BLOB and "sk-live-abc" not in BLOB and "withheld" not in BLOB)
check("house repairs keep no reporter: not attributable, in words, both ways, marked as the source's own shape",
      src(B, "house_repairs")["state"] == "not_attributable" and src(B, "house_repairs")["why"] == mw.REPAIRS_WHY["own"]
      and src(mass(), "house_repairs")["why"] == mw.REPAIRS_WHY["mass"] and src(B, "house_repairs")["structural"] is True)
check("…while a name that cannot be used is about the account, never the source's shape",
      src(b3, "time_off")["state"] == "not_attributable" and src(b3, "time_off")["structural"] is False)

print("\nthe board")
check("which zero is it: every source says its state, and a ready one its count",
      all(s["state"] in ("ready", "unreadable", "not_attributable") for p in ("actions", "requests")
          for s in B[p]["sources"]) and all((s["count"] is None) == (s["state"] != "ready")
                                            for p in ("actions", "requests") for s in B[p]["sources"]))
check("own rows carry no person field", all("person" not in r for p in ("actions", "requests") for r in B[p]["rows"])
      and B["scope"]["mode"] == "own" and "people" not in B["scope"])
check("actions sort overdue, soon, later, then undated",
      [mw.TONE_ORDER[r["due_tone"]] for r in B["actions"]["rows"]]
      == sorted(mw.TONE_ORDER[r["due_tone"]] for r in B["actions"]["rows"]))
check("requests sort open, recorded, resolved",
      [mw.CLASS_ORDER[r["status"]["class"]] for r in B["requests"]["rows"]]
      == sorted(mw.CLASS_ORDER[r["status"]["class"]] for r in B["requests"]["rows"]))
for key in [k for k, _ in mw.ACTION_SOURCES + mw.REQUEST_SOURCES if k != "house_repairs"]:
    saved = mw.READERS[key]
    mw.READERS[key] = lambda ctx: (_ for _ in ()).throw(ValueError("boom"))
    bt = run()
    mw.READERS[key] = saved
    others = [s for p in ("actions", "requests") for s in bt[p]["sources"] if s["key"] != key]
    base = [s for p in ("actions", "requests") for s in B[p]["sources"] if s["key"] != key]
    check(f"{key} throwing is unreadable in words, and every other source still answers",
          src(bt, key)["state"] == "unreadable" and src(bt, key)["why"] == "it could not be read (ValueError)"
          and [s["state"] for s in others] == [s["state"] for s in base], src(bt, key))
own = FakeDb()
run(db=own)
check("the board's own reads are closed only when it opened them", own.closed is False)
cleaned = mw.clean({"api_key": "abc123", "Password": "x", "dob": "1990", "note": "kept", "SSN last4": "1234"})
check("redact_row withholds a secret-named key and the PII keys are dropped",
      cleaned.get("api_key") == redaction.MARKER_SECRET and "Password" not in cleaned and "dob" not in cleaned
      and "SSN last4" not in cleaned and cleaned.get("note") == "kept", cleaned)
check("a withheld value never becomes a detail", mw.pairs(("Key", redaction.MARKER_SECRET), ("Note", "x"))
      == [{"label": "Note", "value": "x"}])
check("dates: an ISO day, a sheet's M/D/YYYY and an instant each land on their Ohio day",
      [mw.day_of("2026-09-22"), mw.day_of("9/22/2026 8:00:00"), mw.day_of("2026-09-23T02:00:00Z")]
      == [date(2026, 9, 22)] * 3)
many = [to_row(f"TO{i:010X}", "Ann Roe", "denied", createdAt=f"2026-0{1 + i % 8}-{1 + i % 27:02d}T00:00:00.000Z")
        for i in range(130)]
time_off.view = lambda dsn, fresh=False: dict(TO_VIEW, rows=TO_ROWS + many)
bk = run()
time_off.view = lambda dsn, fresh=False: TO_VIEW
check("own mode keeps every open row and the newest 100 resolved per source, and says how many are not shown",
      sum(1 for r in rows_of(bk, "time_off") if r["status"]["class"] == "resolved") == 100
      and src(bk, "time_off")["hidden"] == 32 and "32 older resolved requests are not shown" in src(bk, "time_off")["note"]
      and sum(1 for r in rows_of(bk, "time_off") if r["status"]["class"] == "open") == 3, src(bk, "time_off"))
kept_resolved = sum(1 for r in bk["requests"]["rows"] if r["status"]["class"] == "resolved")
check("the resolved figure counts every resolved request on record, before the newest-100 trim",
      bk["totals"]["resolved"] == kept_resolved + sum(s["hidden"] for s in bk["requests"]["sources"])
      and bk["totals"]["resolved"] > kept_resolved, [bk["totals"], kept_resolved])
saved_limits = (mw.HANDOFF_LIMIT, mw.SHIFT_LIMIT)
mw.HANDOFF_LIMIT, mw.SHIFT_LIMIT = 2, 2
bl, ml = run(), mass()
mw.HANDOFF_LIMIT, mw.SHIFT_LIMIT = saved_limits
check("a read that reaches its row limit says so, in both scopes — never a silent cut",
      "only the newest 2 transfers are read, so older ones are not shown" in src(ml, "transfers_out")["note"]
      and "only the newest 2 transfers are read" in src(ml, "transfer_decisions")["note"]
      and "only the newest 2 shift applications are read, so older ones are not shown"
      in src(ml, "shift_requests")["note"]
      and "only the newest 2 shift applications are read" in src(bl, "shift_requests")["note"]
      and "only the newest" not in src(B, "transfers_out")["note"],
      [src(ml, k)["note"] for k in ("transfers_out", "transfer_decisions", "shift_requests")])
old_copy = run(db=FakeDb(as_of={("S_REQ", "Data"): "2026-09-08T10:00:00Z",
                                 ("S_APPS", "policyAcks"): "2026-09-23T10:00:00Z"}))
check("a mirrored copy older than two days names its day on the source; a recent one says nothing",
      src(old_copy, "support_requests")["copy_why"]
      == "the copy read here was mirrored Sep 8, 2026 — anything filed since may not show yet"
      and src(old_copy, "policies")["copy_why"] == "" and src(old_copy, "requirements")["copy_why"] == ""
      and src(B, "support_requests")["copy_why"] == "", src(old_copy, "support_requests"))
noid = dict(LANES, callOffs=lane([{"id": "", "employee_name": "Ann Roe", "date": MDY(-40), "type": "Late Show"}]))
noid_row = rows_of(run(lanes=noid), "call_offs")[0]
check("a blank REQUEST ID carries the sentence saying why; a present one carries none",
      noid_row["ref"] == "" and noid_row["ref_why"] == "The call-off book keeps no id for this row."
      and all(r["ref_why"] == "" for r in B["requests"]["rows"] if r["ref"]), noid_row)
twin_tabs = {**TABS, ("S_REQ", "Data"): TABS[("S_REQ", "Data")] + [dict(TABS[("S_REQ", "Data")][0])]}
twin_ids = [r["id"] for r in rows_of(run(db=FakeDb(tabs=twin_tabs)), "support_requests")]
check("two source rows carrying one id still get two row ids",
      len(twin_ids) == len(set(twin_ids)) and "support_requests:REQ_EMAIL~2" in twin_ids, twin_ids)

print("\nmass mode")
M = mass()
MB = json.dumps(M)
check("every row names its person; the scope says mass and lists the people",
      M["scope"]["mode"] == "mass" and all("person" in r for p in ("actions", "requests") for r in M[p]["rows"]))
people = {p["key"]: p for p in M["scope"]["people"]}
check("the people list carries each person's key, spelling and open counts",
      "annroe" in people and "bobbee" in people and people["bobbee"]["name"] == "Bob Bee"
      and people["annroe"]["open_actions"] > 0 and people["annroe"]["open_requests"] > 0, people.get("annroe"))
check("another person's rows are read in mass mode",
      any(r["person"]["key"] == "bobbee" for r in rows_of(M, "requirements"))
      and any(r["person"]["key"] == "bobbee" for r in rows_of(M, "support_requests")))
check("mass mode never reads a reason", "family wedding" not in MB)
check("an all-staff acknowledgement is one row naming nobody's key", any(
    r["person"] == {"key": "", "name": "All staff"} for r in rows_of(M, "policies")) and "allstaff" not in people)
mtod = rows_of(M, "time_off_decisions")
check("a pending decision is one row per named decider, never a decider named in code",
      {(r["id"].split(":")[1], r["person"]["name"], r["phase"]) for r in mtod if r["id"].split(":")[1] == "TO0000000007"}
      == {("TO0000000007", "Ann Roe", "House manager approval"), ("TO0000000007", "Mia Manager", "House manager approval"),
          ("TO0000000007", "Nora Vale", "Director approval")}, [(r["id"], r["person"], r["phase"]) for r in mtod])
MP = mass(person="bobbee")
check("a chosen person narrows on the server: only their rows come back",
      all(r["person"]["key"] == "bobbee" for p in ("actions", "requests") for r in MP[p]["rows"])
      and MP["scope"]["person"] == "bobbee" and MP["actions"]["rows"])
check("…an all-staff acknowledgement they answered is not theirs; one they did not is",
      sorted(r["condition"] for r in rows_of(MP, "policies"))
      == sorted(["Read and acknowledge Privacy v1", "Read and acknowledge Other", "Read and acknowledge Gone"])
      and all(r["person"] == {"key": "bobbee", "name": "Bob Bee"} for r in rows_of(MP, "policies")),
      [(r["condition"], r["person"]) for r in rows_of(MP, "policies")])
check("…and the list of people is still everyone", {p["key"] for p in MP["scope"]["people"]} == set(people))
crowd = [state("dodd", "expired", D(-1 - i % 30), key=f"p{i}", name=f"Person {i}") for i in range(700)]
MC = mass(db=FakeDb(tabs={**TABS, ("S_STATES", "Data"): crowd}))
check("a mass card is capped at 600 rows, most urgent first, and says how to see the rest",
      len(MC["actions"]["rows"]) == 600 and MC["actions"]["note"].startswith("Showing 600 of ")
      and "pick a person to see all of theirs" in MC["actions"]["note"] and src(MC, "requirements")["capped"] is True
      and MC["totals"]["actions"] > 600, MC["actions"]["note"])

print("\nSettings > My Work — what the master hides from everybody else")
SHOWN = {p: False for p in mw.HIDE_PARTS}
nothing = mw.hide_from_lane(None)
check("no config lane hides nothing, and is not readable", nothing["parts"] == SHOWN and nothing["readable"] is False
      and nothing["why"] == mw.HIDE_NOT_YET, nothing)
broken = mw.hide_from_lane({"my_work_hide_unreadable": "the tab could not be opened", "my_work_hide": {"completed": True}})
check("an unreadable read hides nothing and says why, even beside a stale block",
      broken["parts"] == SHOWN and broken["readable"] is False and "the tab could not be opened" in broken["why"], broken)
old = mw.hide_from_lane({"place": "", "test_mode": {"on": False}})
check("a lane from a backend that does not send the block hides nothing", old["parts"] == SHOWN and not old["readable"])
read = mw.hide_from_lane({"my_work_hide": {"header": True, "completed": True, "source_notes": "yes", "missing_row": 1}})
check("only a real true hides: a word or a number is shown, and a part the block does not carry is shown",
      read["parts"] == {"header": True, "source_notes": False, "missing_row": False, "completed": True,
                        "inbox_sources": False}
      and read["readable"] is True and read["why"] == "", read)
inbox_read = mw.hide_from_lane({"my_work_hide": {"inbox_sources": True}})
check("the fifth part, My Inbox's Sources list, is parsed on its own and hides nothing of My Work",
      mw.HIDE_PARTS == ("header", "source_notes", "missing_row", "completed", "inbox_sources")
      and inbox_read["parts"] == {**SHOWN, "inbox_sources": True}
      and mw.hide_from_lane({"my_work_hide": {"inbox_sources": "yes"}})["parts"] == SHOWN
      and mw.display_for(mw.MODE_OWN, inbox_read) == {"hidden": {**SHOWN, "inbox_sources": True}}
      and mw.display_for(mw.MODE_MASS, inbox_read)["for_users"]["inbox_sources"] is True
      and mw.display_for(mw.MODE_MASS, inbox_read)["hidden"] == SHOWN, inbox_read)
d_own = mw.display_for(mw.MODE_OWN, read)
d_mass = mw.display_for(mw.MODE_MASS, read)
check("every session but the master's own gets the hidden parts and nothing about how the read went",
      d_own == {"hidden": read["parts"]}, d_own)
check("the master's own session hides nothing and is told what everyone else does not see",
      d_mass == {"hidden": SHOWN, "for_users": read["parts"], "readable": True, "why": ""}, d_mass)
check("…and is told when the settings could not be read",
      mw.display_for(mw.MODE_MASS, broken)["why"] == broken["why"]
      and mw.display_for(mw.MODE_MASS, broken)["readable"] is False)

check("concluded: resolved always; recorded only about a day before today; open never",
      mw.is_concluded(mw.RESOLVED, None, TODAY) and mw.is_concluded(mw.RECORDED, TODAY - timedelta(days=1), TODAY)
      and not mw.is_concluded(mw.RECORDED, TODAY, TODAY) and not mw.is_concluded(mw.RECORDED, None, TODAY)
      and not mw.is_concluded(mw.RECORDED, TODAY + timedelta(days=2), TODAY)
      and not mw.is_concluded(mw.OPEN, TODAY - timedelta(days=30), TODAY))

# a Late Show and an incident filed today, a Late Show still ahead, beside the fixture's past ones
TODAY_STAMP = f"{TODAY.isoformat()}T15:00:00.000Z"
DONE_LANES = dict(
    LANES,
    callOffs=lane(LANES["callOffs"]["rows"] + [
        {"id": "CO11", "employee_name": "Ann Roe", "date": MDY(0), "type": "Late Show", "how_late": "10 minutes"},
        {"id": "CO12", "employee_name": "Ann Roe", "date": MDY(4), "type": "Late Show", "how_late": "5 minutes"}]),
    uiIncidents=lane(LANES["uiIncidents"]["rows"] + [
        {"id": "r5", "timestamp": TODAY_STAMP, "your_name": "Ann Roe", "incident_category": "Today's fall"}]))


def own_board(hide=None, lanes=DONE_LANES, db=None):
    return mw.board("dsn", mode=mw.MODE_OWN, me=ME, who=WHO, lanes=lanes, on=TODAY, db=db or FakeDb(), hide=hide)


def refs(board):
    return {r["ref"] for r in board["requests"]["rows"]}


plain = own_board()
assert any(r["status"]["class"] == "resolved" for r in plain["requests"]["rows"]), "the fixture carries concluded rows"
assert any(r.get("folded") for r in plain["actions"]["rows"]), "the fixture carries the folded missing row"
by_ref = {r["ref"]: r for r in plain["requests"]["rows"]}
assert by_ref["CO2"]["status"]["word"] == "Late call logged" and by_ref["CO11"]["status"]["word"] == "Late call logged"
check("switch OFF (or no display at all) = the list as it shipped, past Late Shows and incidents included",
      all({k: v for k, v in own_board(h).items() if k != "read_at"} == {k: v for k, v in plain.items()
                                                                         if k != "read_at"}
          for h in (SHOWN, {}, {**SHOWN, "completed": "yes"}))
      and {"CO2", "CO11", "CO12"} <= refs(plain)
      and any(r["source"] == "incidents" and r["submitted"] < TODAY.isoformat() for r in plain["requests"]["rows"]))
hid = own_board({**SHOWN, "completed": True})
hid_by = {r["ref"]: r for r in hid["requests"]["rows"]}
check("hide_completed: a past Late Show never leaves the server; today's and a coming one stay",
      "CO2" not in hid_by and "CO11" in hid_by and "CO12" in hid_by, sorted(hid_by))
check("hide_completed: an incident filed before today is dropped, one filed today stays",
      [r["request"] for r in rows_of(hid, "incidents")] == ["Incident report · Today's fall"]
      and len(rows_of(plain, "incidents")) == 3, [r["request"] for r in rows_of(hid, "incidents")])
check("hide_completed: open requests and a recorded one with no day to judge stay",
      all(r["ref"] in hid_by for r in plain["requests"]["rows"] if r["status"]["class"] == "open")
      and "CO3" in hid_by and hid_by["CO3"]["status"]["class"] == "recorded"
      and "REQ_WORD" in hid_by, sorted(hid_by))
hid_ids = {r["id"] for r in hid["requests"]["rows"]}
dropped = [r for r in plain["requests"]["rows"] if r["id"] not in hid_ids]
check("hide_completed: only the resolved, the past Late Show and the past incidents are dropped; the figures agree",
      all(r["status"]["class"] == "resolved" or r["ref"] == "CO2"
          or (r["source"] == "incidents" and r["submitted"][:10] < TODAY.isoformat()) for r in dropped)
      and len(dropped) == sum(1 for r in plain["requests"]["rows"] if r["status"]["class"] == "resolved") + 3
      and not any(r["status"]["class"] == "resolved" for r in hid["requests"]["rows"]) and hid["totals"]["resolved"] == 0
      and hid["totals"]["open_requests"] == plain["totals"]["open_requests"],
      [hid["totals"], plain["totals"], [(r["ref"], r["status"]) for r in dropped]])
check("the concluded mark is the server's own: it never travels",
      "_concluded" not in json.dumps(plain) and "_concluded" not in json.dumps(hid))
unpooled = own_board({**SHOWN, "completed": True}, db=FakeDb(pool_error=RuntimeError("pool down")))
unpooled_all = own_board(db=FakeDb(pool_error=RuntimeError("pool down")))
filed_past = [r["ref"] for r in rows_of(unpooled_all, "call_offs")
              if r["status"]["word"] == "Filed" and r["ref"] in ("CO5", "CO6", "CO7")]
check("hide_completed: a Filed call-off whose day passed is dropped; one still ahead stays",
      sorted(filed_past) == ["CO5", "CO6", "CO7"]
      and not {"CO5", "CO6", "CO7"} & refs(unpooled) and {"CO1", "CO10"} <= refs(unpooled), sorted(refs(unpooled)))
twin_done = {**TABS, ("S_REQ", "Data"): [dict(r, status="resolved", verdict="approved") if r["id"] == "REQ_TWIN"
                                         else r for r in TABS[("S_REQ", "Data")]]}
twin_open_hid = own_board({**SHOWN, "completed": True})
twin_done_hid = own_board({**SHOWN, "completed": True}, db=FakeDb(tabs=twin_done))
twin_done_all = own_board(db=FakeDb(tabs=twin_done))
check("the phone note names a Support twin only while that twin is still listed",
      "1 phone request is also in the Support Requests Queue" in src(twin_open_hid, "hotline")["note"]
      and "1 phone request is also in the Support Requests Queue" in src(twin_done_all, "hotline")["note"]
      and "also in the Support Requests Queue" not in src(twin_done_hid, "hotline")["note"]
      and "REQ_TWIN" not in refs(twin_done_hid),
      [src(twin_open_hid, "hotline")["note"], src(twin_done_hid, "hotline")["note"]])
check("…a ready source counts what is left, and the actions are untouched",
      all(s["count"] == len(rows_of(hid, s["key"])) for s in hid["requests"]["sources"] if s["state"] == "ready")
      and hid["actions"]["rows"] == plain["actions"]["rows"],
      [(s["key"], s["count"], len(rows_of(hid, s["key"]))) for s in hid["requests"]["sources"]])
check("the folded missing row is marked, and no other row is",
      [r["id"] for r in plain["actions"]["rows"] if r.get("folded")] == ["requirements:annroe:missing"],
      [r["id"] for r in plain["actions"]["rows"] if r.get("folded")])
gone = own_board({**SHOWN, "missing_row": True})
check("hide_missing_row: the folded row never leaves the server; the figures and the source count agree",
      not any(r.get("folded") for r in gone["actions"]["rows"])
      and gone["totals"]["actions"] == plain["totals"]["actions"] - 1
      and src(gone, "requirements")["count"] == src(plain, "requirements")["count"] - 1
      and gone["requests"]["rows"] == plain["requests"]["rows"], [gone["totals"], plain["totals"]])
same = own_board({**SHOWN, "header": True, "source_notes": True})
check("the header and the notes are the screen's to hide: no row, figure or source line changes on the server",
      {k: v for k, v in same.items() if k != "read_at"} == {k: v for k, v in plain.items() if k != "read_at"})
m_all = mass()
m_hid = mw.board("dsn", mode=mw.MODE_MASS, me=MASTER_ME, who=MASTER_WHO, lanes=LANES, on=TODAY, db=FakeDb(),
                 hide=d_mass["hidden"])
check("the master's own read, handed its display, keeps every concluded row and the missing rows",
      len(m_hid["requests"]["rows"]) == len(m_all["requests"]["rows"])
      and sum(1 for r in m_hid["actions"]["rows"] if r.get("folded")) == sum(1 for r in m_all["actions"]["rows"]
                                                                              if r.get("folded"))
      and any(r["status"]["class"] == "resolved" for r in m_hid["requests"]["rows"])
      and any(r["status"]["word"] == "Late call logged" for r in m_hid["requests"]["rows"]))
m_done = mw.board("dsn", mode=mw.MODE_MASS, me=MASTER_ME, who=MASTER_WHO, lanes=DONE_LANES, on=TODAY, db=FakeDb(),
                  hide={**SHOWN, "completed": True})
m_done_all = mass(lanes=DONE_LANES)
m_named = {r["person"]["key"] for part in ("actions", "requests") for r in m_done[part]["rows"]} - {""}
m_open = Counter(r["person"]["key"] for r in m_done["requests"]["rows"] if r["status"]["class"] == "open")
check("a mass read that hides concluded requests drops them before the people and their figures are counted",
      not any(r["status"]["class"] == "resolved" for r in m_done["requests"]["rows"])
      and "CO2" not in refs(m_done) and m_done["totals"]["resolved"] == 0
      and {p["key"] for p in m_done["scope"]["people"]} == m_named
      and all(p["open_requests"] == m_open[p["key"]] for p in m_done["scope"]["people"])
      and m_done["totals"]["open_requests"] == m_done_all["totals"]["open_requests"]
      and len(m_done["requests"]["rows"]) < len(m_done_all["requests"]["rows"]),
      [m_done["totals"], m_done["scope"]["people"]])
bundle_src = segment("bundle")
check("the admin bundle's raw config cells leave Settings > My Work's out",
      'out["config"]["alertsRaw"] = {k: v for k, v in cfg.items() if not str(k).startswith("mywork_")}' in bundle_src)
refresh_src = segment("_config_lane_refresh")
check("the relay asks Python's config lane as the service identity, which the backend hands the switches to",
      '_backend_call(CONFIG_LANE_APP, "configLane", {}, {"is_service": True})' in refresh_src
      and 'my_work.hide_from_lane(_config_lane_for(""))' in segment("_my_work_display"))

print("\nthe door")
route = segment("lane_my_work")
check("the route is declared, no-store", '@app.get("/hub-lanes/my-work")' in svc
      and 'response.headers["Cache-Control"] = "no-store"' in route)
refused_src = segment("_MY_WORK_ROLES_REFUSED")
check("it asks App Control for my-work, refusing the trainee and the interviewer; a client-role account is "
      "forwarded, and the dead `guardian` role is gone",
      '_hotline_actor(authorization, app_id="my-work"' in route and '"onboarding"' in refused_src
      and '"interviewer"' in refused_src and '"client"' not in refused_src and '"guardian"' not in refused_src,
      refused_src)
check("the client-role branch sits after the visit, the gate and the person checks, and before any staff read",
      route.index('reason": "visit"') < route.index("_hotline_actor(") < route.index("if person and not re.fullmatch")
      < route.index("_my_family_session(actor)") < route.index("_requests_viewer(")
      < route.index("my_work.identity") < route.index("current_lanes") < route.index("my_work.board"))
check("my_work is imported guarded", "try:\n    import my_work\nexcept Exception as _my_work_import_exc:" in svc)
calls: list[str] = []
GATE_SAW: list = []
# released: whether an App Control row opens my-work to the session's badges (the matrix's answer)
STATE = {"flag": {}, "acting": set(), "authme": None, "role": "staff", "uid": "u-ann", "released": True,
         "lane": None}


async def _session_actor(authorization):
    return (STATE["role"], STATE["uid"])


async def _hotline_actor(authorization, app_id="smartcomms", *, refuse_roles=(), app_label="", floor=True):
    calls.append(f"gate:{app_id}")
    # the master flag the real gate would hand hotline_desk.app_access at this moment
    seen = AUTH_MASTER.get(authorization[7:].strip())
    if seen is None and not floor:
        seen = False
    GATE_SAW.append(seen)
    if authorization == "Bearer shut":
        return {"status": 403, "message": "My Work is not open to you."}
    # hotline_desk.app_access in brief: the master opens; an unseen flag on an admin falls to the floor;
    # everyone else is the matrix's
    if seen is True or (seen is None and STATE["role"] == "admin") or STATE["released"]:
        return (STATE["role"], STATE["uid"])
    return {"status": 403, "reason": "badge", "message": "My Work is not open to you."}


async def _requests_viewer(authorization):
    calls.append("viewer")
    return dict(WHO), (STATE["role"], STATE["uid"])


async def current_lanes(sheets, names, dsn):
    calls.append(f"lanes:{','.join(names)}")
    return {"lanes": LANES}


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
    got = STATE.get("family")
    if isinstance(got, Exception):
        return None
    return b"", 1.0, got, None, 0.0


class Acting:
    """wip/be-another's shape: a registry answering known(token)."""

    def known(self, token):
        return token in STATE["acting"]


stub_mw = types.SimpleNamespace(
    MODE_MASS=mw.MODE_MASS, scope_verdict=mw.scope_verdict, hide_from_lane=mw.hide_from_lane,
    display_for=mw.display_for,
    identity=lambda dsn, core, uid, roster_name="": calls.append(f"identity:{uid}:{roster_name}") or ME,
    board=lambda dsn, **k: calls.append(f"board:{k['mode']}:{k['person']}") or {"mode": k["mode"], "why": k["scope_why"],
                                                                                "hide": k.get("hide")})
AUTH_MASTER: dict = {}


class _Unanswered:
    def get(self):
        return "scripted"


ns = {"app": types.SimpleNamespace(get=lambda path: (lambda f: f)), "Header": lambda default="": default,
      "Response": object, "Any": object, "asyncio": asyncio, "re": re, "log": logging.getLogger("test"),
      "PG_DSN": "dsn", "HUB_DB_SHEET_ID": "core", "my_work": stub_mw, "_hotline_actor": _hotline_actor,
      "_session_actor": _session_actor,
      "_requests_viewer": _requests_viewer, "_auth_me": _auth_me, "_auth_master": AUTH_MASTER,
      # My Family is Python's alone: its door asked with the identity the relay settled
      "_person_photo_user": _person_photo_user, "_backend_call": _backend_call, "MY_FAMILY_APP": "my-family",
      "_BACKEND_UNANSWERED": _Unanswered(),
      "hotline_lanes": types.SimpleNamespace(current_lanes=current_lanes),
      "hotline_desk": types.SimpleNamespace(sheets_client=None), "_acting": Acting(),
      "_note_session_answer": lambda token, env: None,
      # the config lane as _config_lane_for hands it: headquarters' answer, or nothing
      "_config_lane_for": lambda place: STATE["lane"] if place == "" else None}
for name in ("_hotline_token", "_DAILY_REASONS", "_daily_refusal", "_MY_WORK_DOWN", "_MY_WORK_ROLES_REFUSED",
             "_MY_WORK_LANES", "_MY_WORK_VISIT", "_MY_WORK_OWN_ONLY", "_MY_WORK_PERSON", "_my_work_acting",
             "_my_work_learn_master", "_my_work_scope", "_my_work_display", "_MY_FAMILY_WORDS", "_my_family_session",
             "_my_family_forward", "lane_my_work"):
    code = segment(name)
    check(f"the relay declares {name}", bool(code))
    exec(code, ns)  # noqa: S102 — the relay's own source


def door(auth="Bearer tok", member="", person=""):
    calls.clear()
    resp = types.SimpleNamespace(headers={})
    got = asyncio.run(ns["lane_my_work"](resp, member=member, person=person, authorization=auth))
    return got, list(calls), resp


visit, vcalls, vresp = door(member="u-bob")
check("inside a visit it refuses before any gate or read",
      visit["status"] == 403 and visit["reason"] == "visit" and vcalls == [] and vresp.headers["Cache-Control"] == "no-store",
      [visit, vcalls])
shut, scalls, _ = door(auth="Bearer shut")
check("a closed App Control row refuses with its reason and reads nothing",
      shut["status"] == 403 and shut["reason"] == "badge" and scalls == ["gate:my-work"], [shut, scalls])
okay, ocalls, _ = door()
check("a staff session reads its own account, the three lanes, then an own board — no master check",
      okay["status"] == 200 and okay["data"]["mode"] == "own"
      and ocalls == ["gate:my-work", "viewer", "identity:u-ann:Ann Roe", "lanes:supportQueue,callOffs,uiIncidents",
                     "board:own:"], [okay, ocalls])
check("with no config lane the board hides nothing, and the answer says only that",
      okay["data"]["hide"] == SHOWN and okay["data"]["display"] == {"hidden": SHOWN}, okay)
HIDE_ALL = {"header": True, "source_notes": True, "missing_row": True, "completed": True, "inbox_sources": True}
STATE["lane"] = {"place": "", "my_work_hide": dict(HIDE_ALL)}
staff_hid, _shc, _ = door()
check("a staff session: the board drops what the master hides, and the answer carries the hidden parts alone",
      staff_hid["status"] == 200 and staff_hid["data"]["hide"] == HIDE_ALL
      and staff_hid["data"]["display"] == {"hidden": HIDE_ALL}, staff_hid)
STATE.update(role="admin", uid="u-boss")
AUTH_MASTER["tok"] = True
own_master, _omc, _ = door()
check("the master's own session: nothing is dropped, and it is told what everyone else does not see",
      own_master["data"]["mode"] == "mass" and own_master["data"]["hide"] == SHOWN
      and own_master["data"]["display"] == {"hidden": SHOWN, "for_users": HIDE_ALL, "readable": True, "why": ""},
      own_master)
STATE["acting"].add("tok")
acting_master, _amc, _ = door()
check("the master acting as someone sees what that person sees: the parts hidden, the concluded rows dropped",
      acting_master["data"]["mode"] == "own" and acting_master["data"]["hide"] == HIDE_ALL
      and acting_master["data"]["display"] == {"hidden": HIDE_ALL}, acting_master)
STATE["acting"].clear()
STATE["lane"] = {"place": "", "my_work_hide_unreadable": "the tab could not be opened"}
unread_master, _umc, _ = door()
check("an unreadable read hides nothing, and only the master's own session is told why",
      unread_master["data"]["display"]["for_users"] == SHOWN
      and unread_master["data"]["display"]["readable"] is False
      and "the tab could not be opened" in unread_master["data"]["display"]["why"], unread_master)
STATE.update(role="staff", uid="u-ann")
AUTH_MASTER.clear()
unread_staff, _usc, _ = door()
check("…while a staff session hides nothing and hears nothing about it",
      unread_staff["data"]["display"] == {"hidden": SHOWN} and "tab" not in json.dumps(unread_staff), unread_staff)
STATE["lane"] = None
nope, ncalls, _ = door(person="bobbee")
check("a person asked for in own mode is refused as scope, before anything is read",
      nope["status"] == 403 and nope["reason"] == "scope" and "viewer" not in ncalls, [nope, ncalls])
STATE.update(role="admin", uid="u-boss")
AUTH_MASTER["tok"] = True
m_ok, mcalls, _ = door(person="bobbee")
check("the master's own session reads mass, narrowed to the person asked for",
      m_ok["status"] == 200 and m_ok["data"]["mode"] == "mass" and "board:mass:bobbee" in mcalls
      and not any(c.startswith("exec:") for c in mcalls), [m_ok, mcalls])
bad, _bcalls, _ = door(person="Bob Bee")
check("a person key that is not a fold is a 400", bad["status"] == 400)
STATE["acting"].add("tok")
act_ok, acalls, _ = door()
check("an acting token with a stale True flag reads own rows only, told only what the person is told",
      act_ok["data"]["mode"] == "own" and act_ok["data"]["why"] == "", act_ok)
act_person, _apc, _ = door(person="bobbee")
check("…and cannot ask for another person", act_person["status"] == 403 and act_person["reason"] == "scope")
AUTH_MASTER.clear()
act_unknown, aucalls, _ = door()
check("an acting token asks no master check at all: it reads own rows, told only what the person is told",
      "exec:authMe" not in aucalls and act_unknown["data"]["mode"] == "own"
      and act_unknown["data"]["why"] == "", [act_unknown, aucalls])
STATE["acting"].clear()
# full/be-another's shape: a plain dict, token -> (until, real uid, worn uid)
ns["_acting"] = {"tok": (9e9, "u-boss", "u-ann")}
AUTH_MASTER["tok"] = True
dict_act, dcalls, _ = door()
check("the dict-shaped registry: an acting token with a stale True flag reads own rows — no crash, no mass",
      dict_act["status"] == 200 and dict_act["data"]["mode"] == "own"
      and dict_act["data"]["why"] == "" and "board:own:" in dcalls, [dict_act, dcalls])
AUTH_MASTER.clear()
dict_unknown, ducalls, _ = door()
check("…and it asks no master check for an acting token",
      dict_unknown["status"] == 200 and dict_unknown["data"]["mode"] == "own" and "exec:authMe" not in ducalls,
      [dict_unknown, ducalls])
ns["_acting"] = {"other-token": (9e9, "u-boss", "u-bob")}
AUTH_MASTER["tok"] = True
dict_free, _dfc, _ = door()
check("…while a token the dict does not hold is the master's own session", dict_free["data"]["mode"] == "mass",
      dict_free)


class Mute:
    """A registry that cannot answer."""
    known = None

    def __contains__(self, token):
        raise RuntimeError("no answer")


ns["_acting"] = Mute()
mute, _mc, _ = door()
check("FAIL-CLOSED: a registry that cannot answer reads as acting — own rows, never mass, never a crash",
      mute["status"] == 200 and mute["data"]["mode"] == "own", mute)
ns["_acting"] = Acting()
AUTH_MASTER.clear()
unk, ucalls, _ = door()
check("an admin whose flag is unknown asks authMe once, BEFORE the gate; a failed check is own rows, in words",
      ucalls.count("exec:authMe") == 1 and ucalls.index("exec:authMe") < ucalls.index("gate:my-work")
      and unk["data"]["mode"] == "own"
      and "The master check could not be made (RuntimeError), so only your own rows are shown." == unk["data"]["why"],
      [unk, ucalls])
STATE["authme"] = {"status": 200, "data": {"user": {"is_master": False}}}
GATE_SAW.clear()
plain_admin, pcalls, _ = door()
check("an admin the check names not the master: the gate sees False (no admin floor), and rows are own",
      GATE_SAW == [False] and pcalls.index("exec:authMe") < pcalls.index("gate:my-work")
      and plain_admin["data"]["mode"] == "own" and plain_admin["data"]["why"] == "" and AUTH_MASTER.get("tok") is False,
      [GATE_SAW, plain_admin, pcalls])
again, again_calls, _ = door()
check("…and the learned flag is used next time without asking again", "exec:authMe" not in again_calls)
AUTH_MASTER.clear()
STATE["authme"] = {"status": 200, "data": {"user": {"is_master": True}}}
GATE_SAW.clear()
learned, lcalls, _ = door()
check("…and a check that answers is learned before the gate and used",
      learned["data"]["mode"] == "mass" and AUTH_MASTER.get("tok") is True and GATE_SAW == [True], [learned, GATE_SAW])
STATE["authme"] = {"status": 200, "data": {"user": {}}}
AUTH_MASTER.clear()
noflag, _nf, _ = door()
check("an authMe answer carrying no flag is own rows, never mass", noflag["data"]["mode"] == "own"
      and "could not be made" in noflag["data"]["why"])
# an unreleased app: the matrix opens it to nobody, so only the master's flag can
STATE.update(authme=None, released=False)
AUTH_MASTER.clear()
GATE_SAW.clear()
shut_unknown, sucalls, _ = door()
check("unreleased, and the master check failed: the gate sees False (no admin floor), and the refusal is a 503 "
      "saying the check failed — never the board, never a badge",
      shut_unknown["status"] == 503 and shut_unknown["reason"] == "unavailable"
      and "the master check could not be made (RuntimeError)" in shut_unknown["message"]
      and GATE_SAW == [False] and not any(c.startswith(("board", "viewer")) for c in sucalls),
      [shut_unknown, GATE_SAW, sucalls])
AUTH_MASTER["tok"] = False
plain_shut, _psc, _ = door()
check("…an admin the backend names not the master is refused as a badge",
      plain_shut["status"] == 403 and plain_shut["reason"] == "badge", plain_shut)
AUTH_MASTER["tok"] = True
master_open, _moc, _ = door()
check("…and the master opens it", master_open["status"] == 200 and master_open["data"]["mode"] == "mass", master_open)
STATE.update(role="staff", uid="u-ann", authme=None, released=True)
AUTH_MASTER.clear()
stub_mw.identity = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("mirror down"))
broken, bcalls, _ = door()
check("an account row that cannot be read is a 502 in words, and no board is drawn",
      broken["status"] == 502 and "could not be read" in broken["message"]
      and not any(c.startswith("board") for c in bcalls), [broken, bcalls])
ns["my_work"] = None
check("a module that did not load answers 503 with a sentence", door()[0]["status"] == 503)
check("the door asks the gate with no admin floor", "floor=False" in route)
GATE_FLAGS: list = []


async def run_gate(fn, *args, **kw):
    GATE_FLAGS.append(kw.get("is_master"))
    return {"open": True}


gate_ns = {"Any": object, "log": logging.getLogger("test"), "PG_DSN": "dsn", "HUB_DB_SHEET_ID": "core",
           "MIRROR_TRUST_MAX_S": 7200.0, "_auth_master": {}, "_session_actor": _session_actor,
           "hotline_desk": types.SimpleNamespace(run_gate=run_gate, app_access=None)}
for name in ("_hotline_token", "_hotline_actor"):
    exec(segment(name), gate_ns)  # noqa: S102 — the relay's own gate
asyncio.run(gate_ns["_hotline_actor"]("Bearer t1", app_id="my-work"))
asyncio.run(gate_ns["_hotline_actor"]("Bearer t1", app_id="my-work", floor=False))
gate_ns["_auth_master"]["t1"] = True
asyncio.run(gate_ns["_hotline_actor"]("Bearer t1", app_id="my-work", floor=False))
check("the relay's gate: an unseen flag is None by default (the floor other doors keep), False with floor=False, "
      "and a seen flag is passed as it is", GATE_FLAGS == [None, False, True], GATE_FLAGS)

print("\nthe door, for a client-role session (apps-script/MyFamily.gs)")
ns["my_work"] = stub_mw
FAMILY_WORK = {"status": 200, "data": {"family": True, "part": "work", "viewer": "guardian", "linked": True,
                                       "ward": {"name": "Jane Doe"}, "sources": [], "rows": [],
                                       "actions": {"state": "not_applicable", "why": "x"}}}
STATE.update(role="client", uid="u-jane", released=True, family=FAMILY_WORK, authme=None, lane=None)
AUTH_MASTER.clear()
EXEC_SENT.clear()
PY_SENT.clear()
fam, fcalls, fresp = door()
check("a client-role session (a client or a guardian) is forwarded to Python's myFamily read, and its "
      "envelope comes back unchanged — Apps Script never asked",
      fam == FAMILY_WORK and fcalls == ["gate:my-work", "python:myFamily"] and not EXEC_SENT
      and fresp.headers["Cache-Control"] == "no-store", [fam, fcalls])
check("…asked with the session's OWN identity and the part — never the service",
      PY_SENT == [{"app": "my-family", "payload": {"part": "work"},
                   "user": {"uid": "u-jane", "role": "client", "is_master": False}}], PY_SENT)
check("…and no staff source is computed for it: no viewer, no account row, no lane, no board",
      not any(c.startswith(("viewer", "identity", "lanes", "board")) for c in fcalls), fcalls)
fvisit, fvcalls, _ = door(member="u-bob")
fperson, fpcalls, _ = door(person="bobbee")
check("a visit is refused before anything, and a person asked for is refused as scope before the backend is asked",
      fvisit["status"] == 403 and fvisit["reason"] == "visit" and fvcalls == []
      and fperson["status"] == 403 and fperson["reason"] == "scope" and "python:myFamily" not in fpcalls,
      [fvisit, fperson, fpcalls])
STATE["released"] = False
fshut, fscalls, _ = door()
check("a my-work row that does not open it to the account refuses before the backend is asked",
      fshut["status"] == 403 and "python:myFamily" not in fscalls, [fshut, fscalls])
STATE["released"] = True
STATE["acting"].add("tok")
PY_SENT.clear()
facting, _fac, _ = door()
check("a switched session wearing a client account is forwarded with its own identity too — Python answers the "
      "account it wears", facting == FAMILY_WORK and PY_SENT[-1]["user"]["uid"] == "u-jane", PY_SENT)
STATE["acting"].clear()
for label, answer, want in (
        ("the backend's refusal keeps its status and words",
         {"status": 403, "message": "This read is for client and guardian accounts."},
         (403, "restricted", "This read is for client and guardian accounts.")),
        ("a backend that does not know the read yet says so, never an empty page",
         {"status": 404, "message": 'Unknown action: "myFamily".'}, (404, "unreadable", 'Unknown action: "myFamily".')),
        ("Python not answering is its 503 in words, never Apps Script's", RuntimeError("down"),
         (503, "unreadable", "Your work could not be read just now. Try again in a moment.")),
        ("an answer that is not the family read is a 502 and nothing is drawn",
         {"status": 200, "data": {"rows": [{"x": 1}]}}, (502, "unreadable", None)),
        ("an answer for another part is a 502 and nothing is drawn",
         {"status": 200, "data": {"family": True, "part": "inbox"}}, (502, "unreadable", None)),
        ("an envelope that is not an object is a 502", ["nope"], (502, "unreadable", "Your work could not be read."))):
    STATE["family"] = answer
    got, _gc, _ = door()
    check(label, got.get("status") == want[0] and got.get("reason") == want[1]
          and (want[2] is None or got.get("message") == want[2]) and "data" not in got, got)
STATE.update(role="staff", uid="u-ann", family=None)
stub_mw.identity = lambda dsn, core, uid, roster_name="": calls.append(f"identity:{uid}:{roster_name}") or ME
EXEC_SENT.clear()
PY_SENT.clear()
staff_again, sacalls, _ = door()
check("a staff session is unchanged: its own board, and the family read is never asked",
      staff_again["status"] == 200 and "board:own:" in sacalls and not EXEC_SENT and not PY_SENT,
      [staff_again, sacalls])


print("\nthe relay's containment, as the doors ask it (hotline_desk.app_access over a named mirror)")
import hotline_desk as desk  # noqa: E402
GATE_ROW: dict = {}


def _core_named(_dsn, _sheet, _uid, _app):
    return {"source": "mirror", "sync_ok": True, "age_s": 0.0, "rule": list(GATE_ROW["rule"]), "tenants": [],
            "user": {"role": GATE_ROW["role"], "types": GATE_ROW["types"], "active": "true", "app_denials": "",
                     "home_tenant": ""}}


_core_real, _pg_real = desk._core_from_mirror, desk.psycopg2
desk._core_from_mirror = _core_named
desk.psycopg2 = desk.psycopg2 or object()
try:
    def verdict(app_id, role, types, rule, refuse):
        GATE_ROW.update(role=role, types=types, rule=rule)
        return desk.app_access("named-dsn", "named-book", "u-x", role, app_id, is_master=False, refuse_roles=refuse,
                               app_label=app_id)

    refuse = ns["_MY_WORK_ROLES_REFUSED"]
    MY_APPS = ("my-work", "my-profile", "my-calendar", "my-inbox")
    shut_guardian = [verdict(a, "client", "GUARDIAN", ["GUARDIAN", "STAFF"], refuse) for a in MY_APPS]
    shut_client = [verdict(a, "client", "CLIENT", ["GUARDIAN", "STAFF"], refuse) for a in MY_APPS]
    check("a row naming GUARDIAN but not CLIENT keeps all four closed to a guardian and a client — restricted, "
          "until the row names CLIENT",
          all(v["open"] is False and v["reason"] == "restricted" for v in shut_guardian + shut_client),
          shut_guardian + shut_client)
    open_both = [verdict(a, "client", t, ["CLIENT", "GUARDIAN", "STAFF"], refuse)
                 for a in MY_APPS for t in ("GUARDIAN", "CLIENT")]
    check("…and a row naming CLIENT opens them to both, a guardian being a client-role account",
          all(v["open"] is True for v in open_both), open_both)
    trainee = verdict("my-work", "onboarding", "ONBOARDING", ["ONBOARDING", "CLIENT", "STAFF"], refuse)
    interviewer = verdict("my-work", "interviewer", "INTERVIEWER", ["INTERVIEWER", "STAFF"], refuse)
    check("the trainee and the interviewer stay refused, whatever the row names",
          trainee["open"] is False and trainee["reason"] == "restricted"
          and interviewer["open"] is False and interviewer["reason"] == "restricted", [trainee, interviewer])
    staff_open = verdict("my-work", "staff", "STAFF", ["STAFF"], refuse)
    check("a staff account is judged by its badge as before", staff_open["open"] is True, staff_open)
finally:
    desk._core_from_mirror, desk.psycopg2 = _core_real, _pg_real

print("\nthe request half alone (requests_for, read by My Inbox)")
req_db = FakeDb()
RQ_HEADS, RQ_ROWS = mw.requests_for("dsn", me=ME, who=WHO, lanes=LANES, on=TODAY, db=req_db)
check("requests_for answers the request half of an own board, source by source and row by row",
      json.dumps(RQ_HEADS, sort_keys=True) == json.dumps(B["requests"]["sources"], sort_keys=True)
      and json.dumps(RQ_ROWS, sort_keys=True) == json.dumps(B["requests"]["rows"], sort_keys=True),
      [[h["key"] for h in RQ_HEADS], len(RQ_ROWS), len(B["requests"]["rows"])])
check("…own mode only: no row names its person, no private field leaves, and a borrowed read is left open",
      all("person" not in r and not any(k.startswith("_") for k in r) for r in RQ_ROWS) and not req_db.closed,
      RQ_ROWS[:1])
unkeyed = mw.identity_from({"user_id": "u-x", "display_name": "", "active": "TRUE"}, "u-x", roster_name="",
                           people=[])
UK_HEADS, UK_ROWS = mw.requests_for("dsn", me=unkeyed, who=WHO, lanes=LANES, on=TODAY, db=FakeDb())
check("an account with no key is not attributable on every source, never an empty list",
      not UK_ROWS and all(h["state"] == "not_attributable" for h in UK_HEADS), [h["state"] for h in UK_HEADS])

print("\nSupport Requests' refs (pinned byte for byte with apps-script/SelfTestSupportDesk.gs)")
# (person, type, details, received) → the key and the ref Support Requests computes on the same row
HQ_VECTORS = [
    (("Ty Bond", "Operations - Vehicle Issue", "Van broke down on Route 62, stranded with client",
      "2026-01-27T15:04:00Z"),
     "ty bond|operations - vehicle issue|van broke down on route 62, stranded with client|2026-01-27", "HQ5EF1CB5F25"),
    (("Angel Fiber", "Payroll", "Missing paycheck for last week", "9/16/2026"),
     "angel fiber|payroll|missing paycheck for last week|2026-09-16", "HQ6EEF063DEE"),
    (("", "Other - General Requests", "Caller reached voicemail and left no details.", "2026-09-18"),
     "|other - general requests|caller reached voicemail and left no details.|2026-09-18", "HQ82D0D7C86E"),
    (("Joan Cheruiyot", "ADP - Update Information", "  New e-mail: AbC123@Gmail.com  ", "not a date"),
     "joan cheruiyot|adp - update information|new e-mail: abc123@gmail.com|not a date", "HQD1BC183BB5"),
    (("Maria Lopez", "Schedule - Call Off", "Calling off tonight, sick child", "2026-09-18T02:30:00Z"),
     "maria lopez|schedule - call off|calling off tonight, sick child|2026-09-17", "HQDDED74CB55"),
]
got_vec = [(mw._support_key(*args), mw._nth_ref("HQ" + mw._sha10(mw._support_key(*args)), 1))
           for args, _k, _r in HQ_VECTORS]
check("the HQ key and ref of each vector: an instant is its Ohio day, M/D/YYYY a padded day, anything else itself",
      got_vec == [(k, r) for _a, k, r in HQ_VECTORS], got_vec)
check("…and a repeat of the same key carries its count",
      mw._nth_ref("HQ5EF1CB5F25", 2) == "HQ5EF1CB5F25-2" and mw._nth_ref("HQ5EF1CB5F25", 1) == "HQ5EF1CB5F25")
IN_VECTOR = {"id": "iv", "timestamp": "2026-09-27T19:54:00.000Z", "your_name": "Jane Doe",
             "client_name": "John Client", "incident_category": "Minor injury"}
check("the IN vector", "IN" + mw._sha10("2026-09-27T19:54:00.000Z|Jane Doe|John Client|Minor injury") == "IN22AECE9878")
VEC_QUEUE = [{"id": f"v{i}", "status": "", "urgency": "Low", "date_received": a[3], "requestor": a[0],
              "requestor_phone": "", "type_of_request": a[1], "description_of_request": a[2], "notes": "",
              "processed": ""} for i, (a, _k, _r) in enumerate(HQ_VECTORS)]
vec_board = mass(lanes=dict(LANES, supportQueue=lane(VEC_QUEUE), uiIncidents=lane([IN_VECTOR])))
check("…and the board's own phone requests and incident reports carry those very refs",
      sorted(r["ref"] for r in rows_of(vec_board, "hotline")) == sorted(r for _a, _k, r in HQ_VECTORS)
      and [r["ref"] for r in rows_of(vec_board, "incidents")] == ["IN22AECE9878"],
      [[r["ref"] for r in rows_of(vec_board, k)] for k in ("hotline", "incidents")])
check("the renamed queue keeps its id and page; only the words of its link change",
      mw.LINK_SUPPORT == {"app": "support-requests", "page": "queue", "href": "/app/support-requests/queue",
                          "label": "Open in Support Requests Queue"})
check("Support Requests' house is the one its items are written to, and My Work asks the depot for it",
      mw.PTR_SUPPORT_INBOX == "HUB_HOUSE_SUPPORT_INBOX_ID" and mw.PTR_SUPPORT_INBOX in mw.POINTERS)

pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
check("the suite is a script and rides the check chain",
      pkg["scripts"].get("test:my-work") == "python3 tools/test-my-work.py"
      and "npm run test:my-work" in pkg["scripts"]["check"])
grants = []
for folder in ("apps-script", "tools", "server"):
    for p in (ROOT / folder).rglob("*"):
        if p.is_file() and p.suffix in (".gs", ".py", ".json", ".mjs", ".js") and p.name != "test-my-work.py":
            text = p.read_text(encoding="utf-8", errors="ignore")
            if re.search(r"app_badge_access[^\n]{0,200}my-work|my-work[^\n]{0,200}app_badge_access", text):
                grants.append(str(p))
check("no App Control grant row for my-work ships anywhere: the app is the master's until released", not grants, grants)

print(f"\nmy work: {results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
