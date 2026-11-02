#!/usr/bin/env python3
"""My Profile (server/my_profile.py and its relay door): whose profile it is decided on the server, every part
narrowed before it answers and failing closed on its own. Pure: no database, no network."""
import ast
import asyncio
import json
import logging
import os
import re
import sys
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
# every connect in this file fails, so nothing is ever read from a real database
sys.modules["psycopg2"].connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no database in this test"))

sys.path.insert(0, str(SERVER))
os.environ.setdefault("HUB_SNAPSHOT_OUT", "/tmp")
import ist_config  # noqa: E402
import redaction  # noqa: E402
import shift_requests as sr  # noqa: E402
import my_work as mw  # noqa: E402
import my_profile as mp  # noqa: E402

TODAY = date(2026, 9, 25)
D = lambda n: (TODAY + timedelta(days=n)).isoformat()  # noqa: E731
ist_config.pin(dict(ist_config.SHIPPED))
WINDOW = ist_config.int_of(ist_config.current(), "ist_cert_expiring_days")

USERS = {
    # the profile's other e-mails and phones are Bob's and a stranger's: typed, so they claim nothing
    "u-ann": {"user_id": "u-ann", "display_name": "Ann Roe", "email": "Ann@Example.com", "phone": "(330) 555-1234",
              "emails": '["bob@x.com"]', "phones": '[{"label":"Mobile","number":"330-555-9999"}]',
              "title": "Caregiver", "active": "TRUE"},
    "u-bob": {"user_id": "u-bob", "display_name": "Bob Bee", "email": "bob@x.com", "people_id": "people:PPL_BOB",
              "active": "TRUE"},
    "u-boss": {"user_id": "u-boss", "display_name": "The Boss", "email": "boss@asa.example", "active": "TRUE"},
    "u-eve": {"user_id": "u-eve", "display_name": "Bob Bee Jr", "email": "eve@x.com", "name_by": "self",
              "active": "TRUE"},
}
FACTS = {mw.PTR_STATES: "S_STATES", mw.PTR_CATALOGUE: "S_CAT", mw.PTR_PEOPLE: "S_PEOPLE"}


def person(pid, name, email="", phone="", **over):
    return {"id": pid, "name": name, "email": email, "phone": phone, "status": "active", **over}


def cat(req_id, label, category, enabled="yes", evidence="", date_source="", credential=""):
    return {"req_id": req_id, "label": label, "category": category, "enabled": enabled, "evidence": evidence,
            "date_source": date_source, "credential": credential}


def state(req_id, st, expires="", key="annroe", login="", name="Ann Roe", days_left="", computed="2026-09-25T10:00:00Z"):
    return {"req_id": req_id, "state": st, "expires": expires, "person_key": key, "person_name": name,
            "login": login, "days_left": days_left, "since": "2026-08-20T17:25:48.348Z", "computed_at": computed}


PEOPLE = [
    person("PPL_ANN", "Ann Roe", "ann@example.com", "330-555-4444", role="Direct Support Professional",
           employee_id="ASA-1041", start_date="5/12/2024", city="Columbus", state="OH", date_of_birth="1990-01-01"),
    person("PPL_BOB", "Bob Bee", "bob@x.com", "330-555-9999", role="House Manager", employee_id="ASA-2002",
           start_date="2023-01-02"),
    person("PPL_TIA1", "Tia Twin", "tia1@x.com"),
    person("PPL_TIA2", "Tia  Twin", "tia2@x.com"),
    person("PPL_ZED", "Zed Zee", "zed@x.com", employee_id=redaction.MARKER_IDENTIFIER),
]
TABS = {
    ("S_PEOPLE", "Data"): PEOPLE,
    ("S_CAT", "Data"): [cat("dodd", "DODD 8-Hour", "training", evidence="DODD 8-hour certificate"),
                        cat("cpr", "CPR / First Aid", "training"), cat("mandt", "Mandt", "training"),
                        cat("med1", "Med 1", "training"), cat("i9_form", "I-9 Form", "onboarding"),
                        cat("w4_form", "W-4 Form", "onboarding"), cat("sam", "SAM", "background"),
                        cat("car_insurance", "Car Insurance", "documents"),
                        cat("old", "Retired course", "training", enabled="no")],
    ("S_STATES", "Data"): [
        state("dodd", "expiring", D(15), days_left="15"), state("cpr", "ok", D(300)), state("mandt", "ok", D(30)),
        state("med1", "expired", D(-4)), state("i9_form", "missing"), state("w4_form", "na"),
        state("sam", "missing"), state("old", "expired", D(-100)),
        # an older computation of the same requirement is not a second row
        state("cpr", "expired", D(-200), computed="2025-01-01T00:00:00Z"),
        # carries the sign-in e-mail under another roster name: the engine computed it for that row, not Ann's
        state("car_insurance", "expired", D(-2), key="annroesmith", name="Ann Roe-Smith", login="ann@example.com"),
        state("dodd", "expired", D(-3), key="bobbee", name="Bob Bee", login="bob@x.com"),
        # the phone typed on Ann's profile is Bob's roster phone: it claims nothing
        state("cpr", "expired", D(-1), key="someone", name="Some One", login="330-555-9999"),
        state("dodd", "ok", D(200), key="tiatwin", name="Tia Twin", login="tia1@x.com"),
        state("mandt", "expired", D(-9), key="tiatwin", name="Tia Twin", login="tia2@x.com"),
        state("cpr", "wobbly", D(100), key="zedzee", name="Zed Zee"),
        # the rows of roster rows an own profile refuses (the probes below): none may leave the server
        state("cpr", "expired", D(-7), key="kimlee", name="Kim Lee", login="klee@x.com"),
        state("med1", "ok", D(90), key="kimlee", name="Kim Lee", login="klee@x.com"),
        state("dodd", "expired", "2025-08-21", key="nianew", name="Nia New", login="old.nia@x.com"),
        state("cpr", "ok", D(51), key="nianew", name="Nia New", login="old.nia@x.com"),
        state("cpr", "expired", D(-11), key="danaold", name="Dana Old", login="family@x.com"),
        state("mandt", "ok", D(121), key="danaold", name="Dana Old", login="family@x.com"),
    ],
}
REFUSED_ROW_WORDS = {
    "kim": (D(-7), D(90), "klee@x.com", "kimlee"),
    "nia": ("2025-08-21", D(51), "old.nia@x.com", "nianew"),
    "dana": (D(-11), D(121), "danaold"),
    "tia": (D(-9), "tia2@x.com"),
}


class FakeDb:
    """The reads the door makes, answered from memory; the SQL narrowing is recorded, never applied, so the
    Python match is what is proved."""

    def __init__(self, facts=FACTS, tabs=None, users=None, facts_error=None, tab_errors=(), accounts_error=None,
                 users_error=None, as_of=None, users_copy=(60.0, True), users_copy_error=None):
        self._facts = dict(facts) if facts is not None else None
        self.tabs = {k: list(v) for k, v in (tabs if tabs is not None else TABS).items()}
        self.users = users if users is not None else USERS
        self.facts_error = facts_error
        self.tab_errors = set(tab_errors)
        self.accounts_error = accounts_error
        self.users_error = users_error
        self.as_of = dict(as_of or {})
        self.copy = users_copy
        self.copy_error = users_copy_error
        self.reads: list[tuple] = []
        self.closed = False

    def users_row(self, core, uid):
        if self.users_error is not None:
            raise self.users_error
        return self.users.get(uid)

    def users_copy(self, core):
        self.reads.append(("users_copy", core))
        if self.copy_error is not None:
            raise self.copy_error
        return self.copy

    def namesakes(self, core, key, uid):
        return sum(1 for u in self.users.values() if sr.fold(u.get("display_name")) == key
                   and u.get("user_id") != uid and mw._live(u))

    def phones_elsewhere(self, core, uid, phones):
        out = set()
        for u in self.users.values():
            if u.get("user_id") != uid and mw._live(u):
                out |= mw.row_phones(u) & set(phones)
        return out

    def emails_elsewhere(self, core, uid, emails):
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

    def accounts_for(self, core, roster_id, emails):
        self.reads.append(("accounts", roster_id, tuple(emails)))
        if self.accounts_error is not None:
            raise self.accounts_error
        return mp.tied_accounts([dict(u) for u in self.users.values()], roster_id, emails)

    def close(self):
        self.closed = True


def me_of(uid, roster_name, db=None):
    """The identity exactly as the door builds it (my_work.identity), over the fake mirror."""
    return mw.identity("dsn", "core", uid, roster_name=roster_name, db=db or FakeDb())


ME = me_of("u-ann", "Ann Roe")
MASTER_ME = me_of("u-boss", "The Boss")


CLIENT_ROWS = [
    {"id": "CLI_jane_doe", "client_key": "jane_doe", "name": "Jane Doe", "status": "active",
     "client_number": "104233", "clientNumber": "jane_doe", "house": "Maple House", "start_date": "3/14/2021",
     "client_phone": "(330) 555-0101", "client_email": "jane.doe@example.invalid",
     "home_address": "12 Maple St, Canton, OH 44709", "guardianName": "Mary Doe", "guardian_relationship": "Mother",
     "guardian_phone": "330-555-0202", "guardian_email": "mary.doe@example.invalid", "dob": "1988-02-03",
     "medicaid_id": "123456789012", "diagnoses_text": "Private diagnosis text", "summary": "Private medical summary"},
    {"id": "CLI_sam_self", "client_key": "sam_self", "name": "Sam Self", "status": "active", "clientNumber": "sam_self",
     "guardianName": "self", "client_phone": redaction.MARKER_PRIVATE},
    {"id": "CLI_bad", "client_key": "bad;key", "name": "Bad Key", "status": "active"},
    {"id": "CLI_twin_a", "client_key": "twin_one", "name": "Twin One", "house": "Oak House"},
    {"id": "CLI_twin_b", "client_key": "twin_one", "name": "Twin One", "house": "Elm House"},
    {"id": "CLI_nokey", "client_key": "", "name": "No Key"},
]
CLIENT_SEEN: list[str] = []


def clients_ok(rows=None, as_of="2026-09-25T12:00:00Z", build_error=""):
    def read():
        CLIENT_SEEN.append("read")
        return [dict(r) for r in (CLIENT_ROWS if rows is None else rows)], as_of, build_error
    return read


def clients_down(exc=None):
    def read():
        CLIENT_SEEN.append("read")
        raise exc or mw.Unreadable("the clients list has not been built on this server")
    return read


def run(db=None, me=None, uid="u-ann", mode=mp.MODE_OWN, person="", client="", role="", clients=None,
        **extra):
    return mp.profile("dsn", "core", mode=mode, me=me or ME, uid=uid, person=person, client=client, role=role,
                      on=TODAY, db=db or FakeDb(), clients=clients or clients_ok(), **extra)


def mass(db=None, person="", client="", clients=None):
    return run(db=db, me=MASTER_ME, uid="u-boss", mode=mp.MODE_MASS, person=person, client=client, role="admin",
               clients=clients)


def field(p, key):
    return next(f for f in p["details"]["fields"] if f["key"] == key)


def req(p, rid):
    return next((r for r in p["requirements"]["rows"] if r["req_id"] == rid), None)


P = run()
BLOB = json.dumps(P)

print("\nwho is asking — the identity rule is My Work's own")
check("only the sign-in e-mail is a key; the profile's typed e-mail and phone never are",
      ME["emails"] == ["ann@example.com"] and "3305559999" not in ME["phones"] and ME["keys"] == ["annroe"], ME)
check("the door reuses my_work.identity and my_work.scope_verdict, never a copy of them",
      "my_work.identity" in (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
      and not re.search(r"^def (identity|identity_from|scope_verdict)\b", (SERVER / "my_profile.py").read_text(), re.M))

print("\nMY DETAILS — own")
check("the one roster row reached through the sign-in e-mail and the name is the account's",
      P["person"]["roster_id"] == "PPL_ANN" and P["person"]["name"] == "Ann Roe" and P["person"]["own"] is True)
check("employee id, role and start date come from the roster; phone and e-mail from the account",
      [field(P, k)["value"] for k in ("employee_id", "role", "start_date", "phone", "email")]
      == ["ASA-1041", "Direct Support Professional", "2024-05-12", "(330) 555-1234", "Ann@Example.com"],
      P["details"]["fields"])
check("the address is the roster's city and state, and says it is no street address",
      field(P, "address")["value"] == "Columbus, OH" and field(P, "address")["note"] == mp.ADDRESS_NOTE)
check("the six fields in the screen's order", [f["label"] for f in P["details"]["fields"]]
      == ["Employee ID", "Role", "Start date", "Phone", "Email", "Address"])
check("a PII column on the roster never leaves the server", "1990-01-01" not in BLOB and "date_of_birth" not in BLOB)
check("another person's roster row and record never leave the server",
      "ASA-2002" not in BLOB and "House Manager" not in BLOB and "bobbee" not in BLOB and "Bob Bee" not in BLOB)

print("\nMY DETAILS — the em-dash law")
bare = run(db=FakeDb(tabs={**TABS, ("S_PEOPLE", "Data"): [person("PPL_ANN", "Ann Roe", "ann@example.com")]},
                     users={**USERS, "u-ann": {**USERS["u-ann"], "phone": "", "title": ""}}))
check("a field the records do not hold is blank with its sentence, never invented",
      field(bare, "employee_id") == {"key": "employee_id", "label": "Employee ID", "value": "",
                                     "why": "No employee ID is on file.", "note": ""}
      and field(bare, "role")["why"] == "No role or title is on file."
      and field(bare, "address")["why"].startswith("No address is on file")
      and field(bare, "phone")["why"] == "No phone is on file.", bare["details"]["fields"])
down = run(db=FakeDb(tab_errors={("S_PEOPLE", "Data")}))
check("an unreadable roster says so on each field only it holds, never 'none on file'",
      field(down, "employee_id")["why"] == "The staff roster could not be read, so this is not known."
      and field(down, "address")["why"] == "The staff roster could not be read, so this is not known."
      and field(down, "phone")["value"] == "(330) 555-1234" and down["details"]["state"] == "ready"
      and any("could not be read" in n for n in down["details"]["notes"]), down["details"])
both = run(db=FakeDb(tab_errors={("S_PEOPLE", "Data")}, users_error=RuntimeError("down")))
check("with neither record readable the card is unreadable, in words",
      both["details"]["state"] == "unreadable" and both["details"]["why"]
      and field(both, "email")["why"] == "Your account row and the staff roster could not be read, so this is not known.",
      both["details"])
twins = run(db=FakeDb(tabs={**TABS, ("S_PEOPLE", "Data"): PEOPLE + [person("PPL_ANN2", "Ann Roe", "")]}))
check("two rows under the name: the one carrying the sign-in e-mail is the account's, and the shared name "
      "files nothing and claims no requirement row — the engine files both rows under it",
      twins["person"]["roster_id"] == "PPL_ANN" and field(twins, "employee_id")["value"] == "ASA-1041"
      and twins["person"]["key"] == "" and "cannot be told apart" in twins["person"]["key_why"]
      and twins["requirements"]["state"] == "not_attributable" and twins["requirements"]["rows"] == []
      and twins["requirements"]["why"] == mp.OWN_ROWS_SHARED, [twins["person"], twins["requirements"]])
ROSTER_ONLY = ("employee_id", "role", "start_date", "address")
UNTOLD_WHY = "Which staff roster row is yours cannot be told, so this is not shown."
ann_twins = [p for p in PEOPLE if p["id"] != "PPL_ANN"] + [
    person("PPL_ANN1", "Ann Roe", "ann.one@x.com", employee_id="ASA-1"),
    person("PPL_ANN2", "Ann  Roe", "", employee_id="ASA-2")]
no_title = {**USERS, "u-ann": {**USERS["u-ann"], "title": ""}}
untold = run(db=FakeDb(tabs={**TABS, ("S_PEOPLE", "Data"): ann_twins}, users=no_title))
check("two rows under the name, neither carrying the sign-in e-mail, are neither: each roster field says which "
      "row is yours cannot be told — never 'none on file'",
      untold["person"]["roster_id"] == "" and untold["person"]["key"] == ""
      and all(field(untold, k)["value"] == "" and field(untold, k)["why"] == UNTOLD_WHY for k in ROSTER_ONLY)
      and field(untold, "email")["value"] == "Ann@Example.com"
      and "ASA-1" not in json.dumps(untold) and "ann.one@x.com" not in json.dumps(untold)
      and "cannot be told" in " ".join(untold["details"]["notes"]), untold["details"])
check("…and no requirement row is taken as the account's, in own_subject's words",
      untold["requirements"]["state"] == "not_attributable" and untold["requirements"]["rows"] == []
      and "cannot be told" in untold["requirements"]["why"] and mp.OWN_ROWS_ONLY in untold["requirements"]["why"]
      and req(P, "dodd")["upload"] == {"allowed": True, "why": "", "by_label": False}, untold["requirements"])
no_row = run(db=FakeDb(tabs={**TABS, ("S_PEOPLE", "Data"): [p for p in PEOPLE if p["id"] != "PPL_ANN"]},
                       users=no_title))
check("no roster row under the name: each roster field says none is tied — the account still answers its own",
      all(field(no_row, k)["why"] == "No staff roster row is tied to you, so this is not known." for k in ROSTER_ONLY)
      and field(no_row, "phone")["value"] == "(330) 555-1234" and no_row["person"]["key"] == ""
      and no_row["requirements"]["state"] == "not_attributable" and no_row["requirements"]["rows"] == []
      and "no row of the staff roster is under your name" in no_row["requirements"]["why"], no_row)

print("\nMY DETAILS — an unreadable roster is never 'none on file'")
UNREAD_WHY = "The staff roster could not be read, so this is not known."
UPLOAD_WAITS = "The staff roster could not be read, so which record is yours is not settled — try again in a minute."
roster_down_cases = {
    "the depot's Facts not mirrored": FakeDb(users=no_title, facts_error=mw.Unreadable(
        "the depot's Facts are not in the mirror, so no house can be found")),
    "the roster pointer missing": FakeDb(users=no_title, facts={k: v for k, v in FACTS.items() if k != mw.PTR_PEOPLE}),
    "the roster pointer blank": FakeDb(users=no_title, facts={**FACTS, mw.PTR_PEOPLE: ""}),
    "the roster house declared but not mirrored": FakeDb(users=no_title, tabs={**TABS, ("S_PEOPLE", "Data"): []}),
    "the roster read failing": FakeDb(users=no_title, tab_errors={("S_PEOPLE", "Data")}),
}
for label, db in roster_down_cases.items():
    got = run(db=db)
    blob = json.dumps(got["details"])
    dodd = req(got, "dodd")
    check(f"{label}: every field only the roster holds says it could not be read; the account answers its own",
          all(field(got, k)["value"] == "" and field(got, k)["why"] == UNREAD_WHY for k in ROSTER_ONLY)
          and "on file" not in blob and "both are blank" not in blob
          and field(got, "email")["value"] == "Ann@Example.com" and got["details"]["state"] == "ready"
          and got["details"]["notes"] and got["person"]["key"] == "", got["details"])
    check(f"{label}: the requirements are unreadable in words, never matched by a name the roster did not settle",
          got["requirements"]["state"] == "unreadable" and got["requirements"]["rows"] == [] and dodd is None
          and mp.OWN_ROWS_ONLY in got["requirements"]["why"], got["requirements"])
    worse = run(db=FakeDb(users=no_title, users_error=RuntimeError("down"), facts=db._facts, tabs=db.tabs,
                          facts_error=db.facts_error, tab_errors=db.tab_errors))
    check(f"{label}, and the account row failing too: the card is unreadable, in words, and no field says 'none'",
          worse["details"]["state"] == "unreadable" and worse["details"]["why"]
          and "on file" not in json.dumps(worse["details"]["fields"])
          and field(worse, "email")["why"] == "Your account row and the staff roster could not be read, so this is not known.",
          worse["details"])
roster_up = run(db=FakeDb(tab_errors={("S_PEOPLE", "Data")}))
check("with the roster unread no requirement row is drawn by name: the part is unreadable, in words",
      roster_up["requirements"]["state"] == "unreadable" and roster_up["requirements"]["rows"] == []
      and roster_up["requirements"]["why"].startswith("the staff roster could not be read (RuntimeError)")
      and "annroe" not in json.dumps(roster_up["requirements"]), roster_up["requirements"])
check("…and the upload waits for the roster, in words", mp.own_subject(
    FakeDb(tab_errors={("S_PEOPLE", "Data")}), "core", ME, "u-ann")["upload_why"] == UPLOAD_WAITS)
titled =run(db=FakeDb(tabs={**TABS, ("S_PEOPLE", "Data"): [person("PPL_ANN", "Ann Roe", "ann@example.com")]}))
check("a role taken from the account's own title says it is the person's own words, not the roster's",
      field(titled, "role")["value"] == "Caregiver" and field(titled, "role")["note"] == mp.TITLE_NOTE
      and field(P, "role")["note"] == "", field(titled, "role"))

print("\nMY DETAILS — a roster row is the account's only by its name, never by an e-mail alone")
CAL = {"user_id": "u-cal", "display_name": "Cal New", "email": "family@x.com", "active": "TRUE"}
DANA_ACCOUNT = {"user_id": "u-dana", "display_name": "Dana Old", "email": "dana@x.com",
                "people_id": "people:PPL_DANA", "active": "TRUE"}


def dana(status="active"):
    return person("PPL_DANA", "Dana Old", "family@x.com", "330-555-7777", status=status, employee_id="ASA-0999",
                  role="House Manager", start_date="2019-02-03", city="Akron", state="OH")


def as_account(uid, name, users, people):
    db = FakeDb(tabs={**TABS, ("S_PEOPLE", "Data"): people}, users=users)
    me = mw.identity("dsn", "core", uid, roster_name=name, db=db)
    return mp.profile("dsn", "core", mode=mp.MODE_OWN, me=me, uid=uid, on=TODAY, db=db)


def leaks(p, *words):
    blob = json.dumps(p)
    return [w for w in words if w in blob]


DANA_WORDS = ("PPL_DANA", "Dana Old", "danaold", "ASA-0999", "House Manager", "2019-02-03", "330-555-7777", "Akron")
for label, users, status in (("departed", {**USERS, "u-cal": CAL}, "terminated"),
                             ("linked to another live account", {**USERS, "u-cal": CAL, "u-dana": DANA_ACCOUNT}, "active"),
                             ("on staff and linked to nobody", {**USERS, "u-cal": CAL}, "active")):
    cal = as_account("u-cal", "Cal New", users, PEOPLE + [dana(status)])
    check(f"a roster row under another name that carries the sign-in e-mail ({label}) gives nothing of its own",
          cal["person"]["roster_id"] == "" and cal["person"]["name"] == "Cal New" and cal["person"]["key"] == ""
          and not leaks(cal, *DANA_WORDS)
          and all(field(cal, k)["value"] == "" and field(cal, k)["why"] for k in ROSTER_ONLY)
          and field(cal, "email")["value"] == "family@x.com", [leaks(cal, *DANA_WORDS), cal["details"]])
gone = as_account("u-ann", "Ann Roe", USERS, [p for p in PEOPLE if p["id"] != "PPL_ANN"]
                  + [person("PPL_ANN", "Ann Roe", "", status="terminated", employee_id="ASA-1041", city="Columbus")])
check("a departed row the name alone reaches is not the account's, and says so without that row's status",
      gone["person"]["roster_id"] == "" and not leaks(gone, "ASA-1041", "Columbus", "terminated", "not on staff")
      and field(gone, "employee_id")["why"] == "The staff roster row under your name is not taken as yours, so this is not shown."
      and mp.NOT_YOURS in gone["details"]["notes"], gone["details"])
back = as_account("u-ann", "Ann Roe", USERS, [p for p in PEOPLE if p["id"] != "PPL_ANN"]
                  + [person("PPL_ANN", "Ann Roe", "ann@example.com", status="terminated", employee_id="ASA-1041")])
check("a row under the name that carries the sign-in e-mail is the account's, whatever its status",
      back["person"]["roster_id"] == "PPL_ANN" and field(back, "employee_id")["value"] == "ASA-1041")
namesake = as_account("u-ann", "Ann Roe", USERS, PEOPLE + [
    person("PPL_OLD", "Ann Roe", "", status="terminated", employee_id="ASA-0001", city="Dayton")])
check("a departed namesake never displaces the row carrying the sign-in e-mail, and the shared name files nothing "
      "and claims no requirement row",
      namesake["person"]["roster_id"] == "PPL_ANN" and field(namesake, "employee_id")["value"] == "ASA-1041"
      and not leaks(namesake, "ASA-0001", "Dayton", "terminated") and namesake["person"]["key"] == ""
      and namesake["requirements"]["state"] == "not_attributable" and namesake["requirements"]["rows"] == [],
      [namesake["details"], namesake["requirements"]])
newcomer = as_account("u-new", "Nia New", {**USERS, "u-new": {"user_id": "u-new", "display_name": "Nia New",
                                                              "email": "nia@x.com", "active": "TRUE"}},
                      PEOPLE + [person("PPL_NIA", "Nia New", "old.nia@x.com", "330-555-3333", status="terminated",
                                       employee_id="ASA-0500", role="Cook", city="Kent", state="OH")])
check("a newcomer whose name a departed employee carried sees nothing of that employee's row",
      newcomer["person"]["roster_id"] == "" and not leaks(newcomer, "ASA-0500", "Cook", "Kent", "330-555-3333",
                                                             "old.nia@x.com"), newcomer["details"])
KIM_USERS = {**USERS, "u-kim": {"user_id": "u-kim", "display_name": "Kim Lee", "email": "kim.admin@x.com",
                                "active": "TRUE"},
             "u-klee": {"user_id": "u-klee", "display_name": "K. Lee", "email": "klee@x.com",
                        "people_id": "people:PPL_KIM", "active": "TRUE"}}
kim = as_account("u-kim", "Kim Lee", KIM_USERS, PEOPLE + [person("PPL_KIM", "Kim Lee", "", employee_id="ASA-7",
                                                                 city="Kent", state="OH")])
check("a row under the name that another live account is linked to is that account's, not this one's — and "
      "nothing says whose",
      kim["person"]["roster_id"] == "" and not leaks(kim, "ASA-7", "Kent", "PPL_KIM", "another account", "K. Lee")
      and mp.NOT_YOURS in kim["details"]["notes"], kim["details"])
kim_mail = as_account("u-kim", "Kim Lee", {**KIM_USERS, "u-klee": {**KIM_USERS["u-klee"], "people_id": ""}},
                      PEOPLE + [person("PPL_KIM", "Kim Lee", "klee@x.com", employee_id="ASA-7", city="Kent")])
check("…and so is one whose e-mail another live account signs in with",
      kim_mail["person"]["roster_id"] == "" and not leaks(kim_mail, "ASA-7", "Kent"), kim_mail["details"])

print("\nMY REQUIREMENTS — own: only through the roster row My Details settled, never a row it refused")
probes = {
    "Kim Lee (the row under the name is linked to another live account, which signs in with its e-mail)":
        ("kim", as_account("u-kim", "Kim Lee", KIM_USERS, PEOPLE + [person("PPL_KIM", "Kim Lee", "klee@x.com",
                                                                            employee_id="ASA-7")])),
    "Kim Lee (the row under the name is only linked to another live account)": ("kim", kim),
    "Nia New (the only row under the name is a departed employee's)": ("nia", newcomer),
    "Cal New (the sign-in e-mail is on Dana Old's row, linked to Dana's own account)":
        ("dana", as_account("u-cal", "Cal New", {**USERS, "u-cal": CAL, "u-dana": DANA_ACCOUNT}, PEOPLE + [dana()])),
    "Cal New (the sign-in e-mail is on Dana Old's on-staff row, linked to nobody)":
        ("dana", as_account("u-cal", "Cal New", {**USERS, "u-cal": CAL}, PEOPLE + [dana()])),
}
for label, (who, got) in probes.items():
    reqs = got["requirements"]
    check(f"{label}: no requirement row of the refused row leaves the server, and the part says why in "
          f"own_subject's words",
          reqs["state"] == "not_attributable" and reqs["rows"] == [] and mp.OWN_ROWS_ONLY in reqs["why"]
          and got["person"]["key"] == "" and got["person"]["roster_id"] == ""
          and not leaks(got, *REFUSED_ROW_WORDS[who]), [reqs, leaks(got, *REFUSED_ROW_WORDS[who])])
TIA = {"user_id": "u-tia", "display_name": "Tia Twin", "email": "tia1@x.com", "active": "TRUE"}
tia = as_account("u-tia", "Tia Twin", {**USERS, "u-tia": TIA}, PEOPLE)
check("Tia Twin (another roster row carries the same name): the twins are never merged — the own profile claims "
      "none of the rows filed under the name, and says they cannot be told apart",
      tia["person"]["roster_id"] == "PPL_TIA1" and tia["requirements"]["state"] == "not_attributable"
      and tia["requirements"]["rows"] == [] and tia["requirements"]["why"] == mp.OWN_ROWS_SHARED
      and tia["person"]["key"] == "" and not leaks(tia, *REFUSED_ROW_WORDS["tia"]), tia["requirements"])
seen = FakeDb()
run(db=seen)
states_reads = [r for r in seen.reads if r[0] == "tab" and r[1] == "S_STATES"]
check("an own profile asks the requirement states by the settled roster name only — never by a login or phone",
      states_reads and all("login" not in r[3] and r[4] == ("annroe", "annroe") for r in states_reads), states_reads)
engine_read = run(db=FakeDb(tabs={**TABS, ("S_CAT", "Data"): TABS[("S_CAT", "Data")] + [
    cat("mais", "MAIS", "training"), cat("money", "Money Management", "training")],
    ("S_STATES", "Data"): TABS[("S_STATES", "Data")] + [
        state("mais", "ok", D(40), key="", name="Ann Roe"),
        state("money", "expired", D(-5), key="annroesmith", name="Ann Roe")]}))
check("a row is the settled name's by the engine's own reading: its person_key, else its person_name",
      req(engine_read, "mais") is not None and req(engine_read, "money") is None, engine_read["requirements"]["rows"])
unrun = run(db=FakeDb(tabs={**TABS, ("S_STATES", "Data"): [r for r in TABS[("S_STATES", "Data")]
                                                           if r["person_key"] != "annroe"]}))
check("a settled row with no requirement row under its name is not attributable, and names the name",
      unrun["requirements"]["state"] == "not_attributable" and "Ann Roe" in unrun["requirements"]["why"]
      and unrun["requirements"]["rows"] == [], unrun["requirements"])


class TieDown(FakeDb):
    def accounts_for(self, core, roster_id, emails):
        raise RuntimeError("down")


tie_down = run(db=TieDown())
check("whether another account shares the row could not be read: no roster field is shown, and it says so",
      tie_down["person"]["roster_id"] == "" and not leaks(tie_down, "ASA-1041", "Columbus")
      and field(tie_down, "employee_id")["why"] == "Whether another account is tied to your staff roster row could "
                                                   "not be read, so this is not known.", tie_down["details"])
bridge_people = [p for p in PEOPLE if p["id"] != "PPL_ANN"] + [
    person("PPL_ANNS", "Ann Roe Smith", "ann@example.com", status="terminated", employee_id="ASA-3")]
bridge_me = mw.identity_from(USERS["u-ann"], "u-ann", roster_name="", people=bridge_people)
bridged = run(me=bridge_me, db=FakeDb(tabs={**TABS, ("S_PEOPLE", "Data"): bridge_people}))
check("a spelling the sign-in e-mail bridged reaches its row only while that row is on staff",
      bridge_me["bridged"] == "Ann Roe Smith" and bridged["person"]["roster_id"] == ""
      and not leaks(bridged, "ASA-3"), [bridge_me, bridged["details"]])
bridge_ok = [p for p in bridge_people if p["id"] != "PPL_ANNS"] + [
    person("PPL_ANNS", "Ann Roe Smith", "ann@example.com", employee_id="ASA-3")]
bridged_ok = run(me=mw.identity_from(USERS["u-ann"], "u-ann", roster_name="", people=bridge_ok),
                 db=FakeDb(tabs={**TABS, ("S_PEOPLE", "Data"): bridge_ok}))
check("…and then it is the account's", bridged_ok["person"]["roster_id"] == "PPL_ANNS"
      and field(bridged_ok, "employee_id")["value"] == "ASA-3")
leave = [p for p in PEOPLE if p["id"] != "PPL_ANN"] + [person("PPL_ANN", "Ann Roe", "", status="leave",
                                                                employee_id="ASA-1041")]
check("the on-staff statuses are the configured ones, else the shipped active and admin",
      run(db=FakeDb(tabs={**TABS, ("S_PEOPLE", "Data"): leave}))["person"]["roster_id"] == ""
      and run(db=FakeDb(tabs={**TABS, ("S_PEOPLE", "Data"): leave, ("core", mp.STAFF_CONFIG_TAB): [
          {"key": mp.STAFF_CONFIG_KEY, "value": "active, admin, leave"}]}))["person"]["roster_id"] == "PPL_ANN"
      and mp.staff_statuses(FakeDb(tabs={("core", mp.STAFF_CONFIG_TAB): [{"key": mp.STAFF_CONFIG_KEY, "value": ""}]}),
                            "core") == mp.ON_STAFF_SHIPPED)
cfg_down = run(db=FakeDb(tabs={**TABS, ("S_PEOPLE", "Data"): leave}, tab_errors={("core", mp.STAFF_CONFIG_TAB)}))
check("with the on-staff statuses unread a row the name alone reaches is not taken — the shipped list is never "
      "assumed — and each field and the requirements say what could not be read",
      cfg_down["person"]["roster_id"] == "" and not leaks(cfg_down, "ASA-1041")
      and field(cfg_down, "employee_id")["why"] == "The statuses that count as on staff could not be read, so this "
                                                   "is not known."
      and cfg_down["requirements"]["state"] == "unreadable" and cfg_down["requirements"]["rows"] == [],
      [cfg_down["details"], cfg_down["requirements"]])
check("…while a row carrying the sign-in e-mail needs no staff status to be the account's",
      run(db=FakeDb(tab_errors={("core", mp.STAFF_CONFIG_TAB)}))["person"]["roster_id"] == "PPL_ANN")
zed_me = mw.identity_from({"user_id": "u-zed", "display_name": "Zed Zee", "email": "zed@x.com", "active": "TRUE"},
                          "u-zed", roster_name="Zed Zee", people=PEOPLE)
zed = run(me=zed_me, uid="u-zed", db=FakeDb(users={**USERS, "u-zed": {"user_id": "u-zed", "display_name": "Zed Zee",
                                                                      "email": "zed@x.com", "active": "TRUE"}}))
check("a withheld cell is said as withheld, never as missing", field(zed, "employee_id")["why"] == mp.WITHHELD_WHY)

print("\nMY REQUIREMENTS — own")
ids = [r["req_id"] for r in P["requirements"]["rows"]]
check("every requirement is listed, current ones and the checks HR runs included; not-applying and "
      "switched-off never", sorted(ids) == sorted(["dodd", "cpr", "mandt", "med1", "i9_form", "sam"]), ids)
check("attention first, then due soon, then current; each by its date",
      ids == ["med1", "i9_form", "sam", "dodd", "mandt", "cpr"], ids)
check("a check HR runs is listed with its status, category and dash, and only HR records it",
      req(P, "sam")["status"] == {"class": "attention", "word": "Needs attention"}
      and req(P, "sam")["category"] == "Background check" and req(P, "sam")["due"] == ""
      and req(P, "sam")["due_why"] == "Nothing is on file, so there is no date to run out."
      and req(P, "sam")["upload"] == {"allowed": False, "why": mp.UPLOAD_HR}, req(P, "sam"))
check("the engine's states are named Current, Due soon and Needs attention",
      [(req(P, k)["status"]["class"], req(P, k)["status"]["word"]) for k in ("cpr", "dodd", "med1", "i9_form")]
      == [("current", "Current"), ("soon", "Due soon"), ("attention", "Needs attention"),
          ("attention", "Needs attention")], P["requirements"]["rows"])
check(f"an ok row inside the platform's {WINDOW}-day window is due soon, as the drawer reads it",
      req(P, "mandt")["status"]["class"] == "soon")
check("the newest computation of a requirement is its row, never a second one",
      ids.count("cpr") == 1 and req(P, "cpr")["due"] == D(300))
check("due tones: past is overdue, inside the window soon, beyond it later",
      [req(P, k)["due_tone"] for k in ("med1", "dodd", "cpr")] == ["overdue", "soon", "later"])
check("a requirement with nothing on file prints the dash and its sentence",
      req(P, "i9_form")["due"] == "" and req(P, "i9_form")["due_tone"] == ""
      and req(P, "i9_form")["due_why"] == "Nothing is on file, so there is no date to run out.")
check("categories are the catalogue's in words", [req(P, k)["category"] for k in ("dodd", "i9_form", "sam")]
      == ["Training", "Onboarding paperwork", "Background check"])
check("a row carrying the sign-in e-mail under another roster name is never the account's",
      req(P, "car_insurance") is None and "Ann Roe-Smith" not in BLOB and "annroesmith" not in BLOB)
check("a row on the typed phone, or on another person's e-mail, never is",
      "someone" not in BLOB and "Some One" not in BLOB and "bob@x.com" not in BLOB)
check("what is not listed is counted in words, and no live category is left out",
      "1 requirement the engine marks as not applying is not listed" in P["requirements"]["note"]
      and "switched off" in P["requirements"]["note"] and "background" not in P["requirements"]["note"],
      P["requirements"]["note"])
check("a card or certificate takes a new version on the own profile, under its requirement id; an onboarding form "
      "too, under its label alone",
      req(P, "dodd")["upload"] == {"allowed": True, "why": "", "by_label": False} and req(P, "i9_form")["upload"]
      == {"allowed": True, "why": "", "by_label": True} and req(P, "dodd")["cert"] == "DODD 8-Hour")
check("the part is ready with totals by status", P["requirements"]["state"] == "ready"
      and P["requirements"]["totals"] == {"current": 1, "soon": 2, "attention": 3, "unknown": 0})
check("an unknown engine word is never mapped to a status: it is said as itself",
      mp.status_of("wobbly", None, TODAY, WINDOW) == ("unknown", "Wobbly"))

print("\nMY REQUIREMENTS — failing closed")
states_down = run(db=FakeDb(tab_errors={("S_STATES", "Data")}))
check("an unreadable states house is unreadable in words, never an empty list",
      states_down["requirements"]["state"] == "unreadable" and states_down["requirements"]["rows"] == []
      and "could not be read" in states_down["requirements"]["why"], states_down["requirements"])
facts_down = run(db=FakeDb(facts_error=mw.Unreadable("the depot's Facts are not in the mirror, so no house can be found")))
check("no depot Facts: requirements and the roster both say so; the account still answers its fields",
      facts_down["requirements"]["state"] == "unreadable"
      and facts_down["requirements"]["why"].startswith("the depot's Facts are not in the mirror")
      and field(facts_down, "email")["value"] == "Ann@Example.com"
      and field(facts_down, "role")["value"] == "Caregiver", [facts_down["requirements"], facts_down["details"]])
unmirrored = run(db=FakeDb(tabs={**TABS, ("S_STATES", "Data"): []}))
check("a declared house not mirrored yet is unreadable, never 'no requirements'",
      unmirrored["requirements"]["state"] == "unreadable" and "not mirrored yet" in unmirrored["requirements"]["why"])
cat_down = run(db=FakeDb(tab_errors={("S_CAT", "Data")}))
check("an unreadable catalogue still lists every row, named by its id, and refuses the upload in words",
      sorted(r["req_id"] for r in cat_down["requirements"]["rows"]) == sorted(
          ["dodd", "cpr", "mandt", "med1", "i9_form", "sam", "old"])
      and all(r["category"] == "" and r["category_why"] for r in cat_down["requirements"]["rows"])
      and not req(cat_down, "dodd")["upload"]["allowed"] and "could not be read" in req(cat_down, "dodd")["upload"]["why"]
      and "each requirement is named by its id" in cat_down["requirements"]["note"], cat_down["requirements"])
stranger_me = mw.identity_from({"user_id": "u-new", "display_name": "New Person", "email": "new@x.com",
                                "active": "TRUE"}, "u-new", roster_name="New Person", people=[])
stranger = run(me=stranger_me, uid="u-new")
check("no roster row under the account's name is not attributable, and says why — never 'nothing required'",
      stranger["requirements"]["state"] == "not_attributable"
      and "no row of the staff roster is under your name" in stranger["requirements"]["why"], stranger["requirements"])
self_named = me_of("u-eve", "Bob Bee Jr")
eve = run(me=self_named, uid="u-eve")
check("a self-set name that the roster does not carry claims nobody's roster row or rows",
      eve["person"]["roster_id"] == "" and "bobbee" not in json.dumps(eve) and "ASA-2002" not in json.dumps(eve))
check("an old mirrored copy names its day",
      "mirrored Sep 1, 2026" in run(db=FakeDb(as_of={("S_STATES", "Data"): "2026-09-01T12:00:00Z"}))["requirements"]["copy_why"])

print("\nthe master")
M = mass()
check("the master's own session with nobody chosen reads the master's own profile, and the chooser",
      M["scope"]["mode"] == "mass" and M["person"]["own"] is True and M["scope"]["person"] == ""
      and [p["key"] for p in M["scope"]["people"] if p["kind"] == "staff"]
      == ["PPL_ANN", "PPL_BOB", "PPL_TIA1", "PPL_TIA2", "PPL_ZED"], M["scope"])
check("an own profile carries no chooser", "people" not in P["scope"])
# the live roster writes its ids from names: "PPL_Joan Cheruiyot", "PPL_O'Neil Grant" — every one must be choosable
_named_ids = [{"id": "PPL_Joan Cheruiyot", "name": "Joan Cheruiyot", "status": "Active"},
              {"id": "PPL_O'Neil Grant", "name": "O'Neil Grant", "status": "Active"},
              {"id": "PPL_José Ávila", "name": "José Ávila", "status": "Active"},
              {"id": "PPL_bad;id", "name": "Bad Id", "status": "Active"}]
_named_db = FakeDb(tabs={**TABS, **{k: _named_ids for k in TABS if "PEOPLE" in str(k).upper()}})
_chosen = [p["key"] for p in mp.people_list(_named_db)]
check("the chooser lists roster ids written with spaces, apostrophes and accents, and never an unsafe one",
      "PPL_Joan Cheruiyot" in _chosen and "PPL_O'Neil Grant" in _chosen and "PPL_José Ávila" in _chosen
      and "PPL_bad;id" not in _chosen, _chosen)
MB = mass(person="PPL_BOB")
check("a chosen roster row: its roster fields, and the one account tied to it",
      MB["person"]["roster_id"] == "PPL_BOB" and MB["person"]["own"] is False and MB["person"]["key"] == "bobbee"
      and [field(MB, k)["value"] for k in ("employee_id", "role", "phone", "email")]
      == ["ASA-2002", "House Manager", "330-555-9999", "bob@x.com"], MB["details"])
check("…its requirements only, and the master files a new version under that roster row's own spelling",
      [r["req_id"] for r in MB["requirements"]["rows"]] == ["dodd"]
      and MB["requirements"]["rows"][0]["upload"] == {"allowed": True, "why": "", "by_label": False}
      and MB["requirements"]["rows"][0]["file_as"] == "Bob Bee"
      and "annroe" not in json.dumps(MB["requirements"]), MB["requirements"])
check("a chosen row carries no account notes of the master's own", MB["person"]["notes"] == [])
try:
    mass(person="PPL_NOPE")
    nope = False
except mp.NoSuchPerson:
    nope = True
check("a roster id the roster was read and does not hold is refused, never an empty profile", nope)
MT = mass(person="PPL_TIA1")
check("a chosen name another roster row carries matches by e-mail only, and says the gap",
      [r["req_id"] for r in MT["requirements"]["rows"]] == ["dodd"] and MT["requirements"]["gap"]
      and MT["person"]["key"] == "" and MT["person"]["key_why"], MT["requirements"])
check("…and the master files nothing under a name two roster rows carry",
      MT["requirements"]["rows"][0]["upload"] == {"allowed": False, "why": mp.UPLOAD_NO_NAME}
      and MT["requirements"]["rows"][0]["file_as"] == "", MT["requirements"]["rows"])
MN = mass(person="PPL_ZED", db=FakeDb(accounts_error=RuntimeError("down")))
check("an account read that fails leaves the roster's fields and says so",
      field(MN, "email")["value"] == "zed@x.com" and any("could not be read" in n for n in MN["details"]["notes"]))
MR = mass(person="PPL_BOB", db=FakeDb(tab_errors={("S_PEOPLE", "Data")}))
check("with the roster unreadable a chosen person is not guessed: the parts say why",
      MR["requirements"]["state"] == "not_attributable" and "could not be read" in MR["requirements"]["why"]
      and not [p for p in MR["scope"]["people"] if p["kind"] == "staff"]
      and "could not be read" in MR["scope"]["people_why"], MR)
for label, db in (("not mirrored", FakeDb(tabs={**TABS, ("S_PEOPLE", "Data"): []})),
                  ("no depot Facts", FakeDb(facts_error=mw.Unreadable("the depot's Facts are not in the mirror, so "
                                                                      "no house can be found"))),
                  ("failing", FakeDb(tab_errors={("S_PEOPLE", "Data")}))):
    got = mass(person="PPL_BOB", db=db)
    check(f"a chosen person with the roster {label}: every field says the roster could not be read — e-mail "
          f"included, since no account was looked up — and the card is unreadable",
          all(f["value"] == "" and f["why"] == UNREAD_WHY for f in got["details"]["fields"])
          and got["details"]["state"] == "unreadable" and got["details"]["why"]
          and "on file" not in json.dumps(got["details"]), got["details"])
two_accounts = {**USERS, "u-bob2": {"user_id": "u-bob2", "display_name": "Robert Bee", "email": "rb@x.com",
                                    "people_id": "people:PPL_BOB", "active": "TRUE"}}
MB2 = mass(person="PPL_BOB", db=FakeDb(users=two_accounts, tabs={**TABS, ("S_PEOPLE", "Data"): [
    p if p["id"] != "PPL_BOB" else {**p, "phone": ""} for p in PEOPLE]}))
check("a chosen row two accounts are tied to shows neither account's fields, and says so where the roster is blank",
      field(MB2, "phone")["why"] == "More than one account is tied to this roster row, so this is not shown."
      and field(MB2, "email")["value"] == "bob@x.com" and "rb@x.com" not in json.dumps(MB2), MB2["details"])
own_person = run(person="PPL_BOB")
check("a person asked for outside mass mode is ignored by the module (the door refuses it first)",
      own_person["person"]["roster_id"] == "PPL_ANN" and own_person["scope"]["person"] == "")

print("\na paper read into My Requirements — what the relay tells the screen")
CAT_DATED = [cat("dodd", "DODD 8-Hour", "training", date_source="DODD 8-Hour Exp"),
             cat("cpr", "CPR / First Aid", "training", date_source="CPR Exp Date"),
             cat("mandt", "Mandt", "training"),
             cat("med1", "Med Delivery 1", "training", date_source="Med 1 Exp Date"),
             cat("mais", "MAIS Certification", "training"),
             cat("car_insurance", "Car Insurance", "documents", date_source="Insurance Exp Date"),
             cat("i9_form", "I-9 Form", "onboarding"), cat("sam", "SAM", "background"),
             cat("bci", "BCI/FBI", "background", date_source="BCI Check Date")]
BOB_ROWS = [state(rid, st, exp, key="bobbee", name="Bob Bee", login="bob@x.com")
            for rid, st, exp in (("cpr", "ok", D(300)), ("mandt", "ok", D(200)), ("med1", "ok", D(100)),
                                 ("mais", "missing", ""), ("car_insurance", "ok", D(90)), ("i9_form", "missing", ""),
                                 ("sam", "missing", ""), ("bci", "ok", D(500)))]
DATED_TABS = {**TABS, ("S_CAT", "Data"): CAT_DATED, ("S_STATES", "Data"): TABS[("S_STATES", "Data")] + BOB_ROWS}
MD = mass(person="PPL_BOB", db=FakeDb(tabs=DATED_TABS))
check("a row the record keeps a date for says so; one it keeps none for does not",
      [req(MD, k)["dated"] for k in ("dodd", "cpr", "med1", "car_insurance", "mais", "mandt", "i9_form", "sam")]
      == [True, True, True, True, False, False, False, False], MD["requirements"]["rows"])
check("the master may confirm a read date on a filed, dated row, and the upload files under the roster spelling",
      all(req(MD, k)["confirm"] == {"allowed": True, "why": ""} and req(MD, k)["upload"]["allowed"]
          and req(MD, k)["file_as"] == "Bob Bee" for k in ("dodd", "cpr", "car_insurance")),
      [req(MD, k) for k in ("dodd", "cpr", "car_insurance")])
check("Med Delivery dates are the registry check's: the paper may be filed, its date is never confirmed here",
      req(MD, "med1")["upload"]["allowed"] and req(MD, "med1")["confirm"] == {"allowed": False, "why": mp.CONFIRM_MED})
check("MAIS keeps no date column, and a row with no date source keeps no date to confirm",
      req(MD, "mais")["confirm"] == {"allowed": False, "why": mp.CONFIRM_MAIS}
      and req(MD, "mandt")["confirm"] == {"allowed": False, "why": mp.CONFIRM_UNDATED})
check("a form HR files and a check HR records are HR's to confirm too, in the upload's own words — a check "
      "with a date column included",
      req(MD, "i9_form")["confirm"] == {"allowed": False, "why": mp.UPLOAD_FORM}
      and req(MD, "sam")["confirm"] == {"allowed": False, "why": mp.UPLOAD_HR}
      and req(MD, "bci")["confirm"] == {"allowed": False, "why": mp.UPLOAD_HR}
      and req(MD, "bci")["upload"] == {"allowed": False, "why": mp.UPLOAD_HR} and req(MD, "bci")["file_as"] == "")
PD = run(db=FakeDb(tabs=DATED_TABS))
check("on the person's own profile the upload files as the caller, and nothing is confirmed from it",
      req(PD, "dodd")["upload"] == {"allowed": True, "why": "", "by_label": False} and req(PD, "dodd")["file_as"] == ""
      and req(PD, "dodd")["dated"] is True
      and req(PD, "dodd")["confirm"] == {"allowed": False, "why": mp.CONFIRM_NOT_MASTER}, req(PD, "dodd"))
check("the relay's statuses, due dates and totals stay the engine's own — a read date never enters them",
      (req(PD, "dodd")["status"]["class"], req(PD, "dodd")["due"]) == ("soon", D(15))
      and PD["requirements"]["totals"] == {"current": 1, "soon": 2, "attention": 3, "unknown": 0}
      and not any(k in r for r in PD["requirements"]["rows"] for k in ("read_state", "expires_on", "issued_on")),
      PD["requirements"])
check("the part carries the day and the due-soon window its statuses were classed by",
      P["requirements"]["on"] == TODAY.isoformat() and P["requirements"]["window"] == WINDOW
      and MD["requirements"]["on"] == TODAY.isoformat() and MD["requirements"]["window"] == WINDOW,
      [P["requirements"].get("on"), P["requirements"].get("window")])
states_gone = run(db=FakeDb(tab_errors={("S_STATES", "Data")}))
check("…even when the rows could not be read",
      states_gone["requirements"]["state"] == "unreadable" and states_gone["requirements"]["on"] == TODAY.isoformat()
      and states_gone["requirements"]["window"] == WINDOW, states_gone["requirements"])
MC = mass(person="PPL_BOB", db=FakeDb(tabs=DATED_TABS, tab_errors={("S_CAT", "Data")}))
check("with the catalogue unreadable nothing is confirmed, and the words say why",
      not req(MC, "dodd")["confirm"]["allowed"] and "could not be read" in req(MC, "dodd")["confirm"]["why"]
      and req(MC, "dodd")["dated"] is False and req(MC, "dodd")["file_as"] == "", req(MC, "dodd"))
CAT_ROLES = CAT_DATED + [cat("drive_abstract", "Driver's Abstract", "documents",
                             date_source="Driver's Abstract (Latest)"),
                         cat("money", "Money Management", "training", date_source="money mgt date", credential="money")]
ROLE_TABS = {**DATED_TABS, ("S_CAT", "Data"): CAT_ROLES, ("S_STATES", "Data"): DATED_TABS[("S_STATES", "Data")] + [
    state(rid, "ok", "", key="bobbee", name="Bob Bee", login="bob@x.com") for rid in ("drive_abstract", "money")]}
MA = mass(person="PPL_BOB", db=FakeDb(tabs=ROLE_TABS))
check("an abstract's record keeps the document's own date: never a due date a paper's date stands in for, and the "
      "master still confirms it into its own column",
      req(MA, "drive_abstract")["date_role"] == "issued" and req(MA, "drive_abstract")["dated"] is False
      and req(MA, "drive_abstract")["confirm"] == {"allowed": True, "why": ""}
      and req(MA, "drive_abstract")["upload"]["allowed"] and req(MA, "drive_abstract")["file_as"] == "Bob Bee",
      req(MA, "drive_abstract"))
check("…while an expiry column, or a credential's date the certificate picture reads as its expiry, is an expiry, "
      "and a row with no date source keeps none",
      [(req(MA, k)["date_role"], req(MA, k)["dated"]) for k in ("dodd", "car_insurance", "money", "mandt")]
      == [("expires", True), ("expires", True), ("expires", True), ("", False)],
      [req(MA, k) for k in ("dodd", "car_insurance", "money", "mandt")])
check("the abstract's status stays the engine's own: the relay classes no document date as a due date",
      req(MA, "drive_abstract")["status"]["class"] == "current" and req(MA, "drive_abstract")["due"] == "",
      req(MA, "drive_abstract"))
catalogue_gs = (ROOT / "apps-script" / "Requirements.gs").read_text(encoding="utf-8")
shipped = [{"req_id": m.group(1), "date_source": m.group(3), "credential": m.group(5)} for m in re.finditer(
    r"req_id: '([^']+)'[^}]*?date_source: (['\"])(.*?)\2,[^}]*?credential: (['\"])(.*?)\4,", catalogue_gs)]
roles = {c["req_id"]: mp.date_role(c) for c in shipped}
check("over the shipped catalogue only the abstract (and the background checks' own dates) keep a document's date; "
      "every card and certificate keeps an expiry",
      len(shipped) >= 20 and roles["drive_abstract"] == "issued" and roles["bci"] == "issued"
      and all(roles[k] == "expires" for k in ("dodd", "cpr", "med1", "med2", "med3", "mandt", "money",
                                              "driver_license", "car_insurance", "i9_type_1", "i9_type_2"))
      and roles["mais"] == "" and roles["sam"] == "", roles)
MO = run(me=ME, uid="u-ann", mode=mp.MODE_MASS, role="admin", db=FakeDb(tabs=DATED_TABS))
check("the master's own profile in its own session names its own roster spelling too — certDocUpload refuses a "
      "master filing that names nobody",
      MO["person"]["own"] is True and req(MO, "dodd")["upload"]["allowed"] and req(MO, "dodd")["file_as"] == "Ann Roe"
      and req(PD, "dodd")["file_as"] == "", [req(MO, "dodd"), req(PD, "dodd")])

print("\nclients — the master's chooser")
clients_in = [p for p in M["scope"]["people"] if p["kind"] == "client"]
check("the chooser carries the clients from the clients slice, marked as clients, by client key, once each, "
      "never an unsafe key or a row with none",
      [(p["key"], p["name"]) for p in clients_in] == [("jane_doe", "Jane Doe"), ("sam_self", "Sam Self"),
                                                      ("twin_one", "Twin One")]
      and all(p["status"] in ("Active", "") for p in clients_in) and M["scope"]["clients_why"] == ""
      and all(p["kind"] == "staff" for p in M["scope"]["people"] if p["key"].startswith("PPL_")), clients_in)
check("the chooser's client entries carry nothing but key, name, status and kind",
      all(set(p) == {"key", "name", "status", "kind"} for p in clients_in)
      and "104233" not in json.dumps(M["scope"]) and "Maple" not in json.dumps(M["scope"]), clients_in)
check("client records the chooser leaves out are counted in words, never dropped in silence",
      M["scope"]["clients_note"] == "2 client records carry no usable client key or name, so they cannot be chosen"
      and M["scope"]["clients_why"] == "", M["scope"].get("clients_note"))
one_out = mass(clients=clients_ok(rows=[CLIENT_ROWS[0], {"client_key": "x;y", "name": "Bad"}]))
check("…one left out is said in the singular",
      one_out["scope"]["clients_note"] == "1 client record carries no usable client key or name, so it cannot be "
                                          "chosen", one_out["scope"].get("clients_note"))
all_out = mass(clients=clients_ok(rows=[r for r in CLIENT_ROWS if r["id"] in ("CLI_bad", "CLI_nokey")]))
check("a clients slice whose every record is left out lists no client and says why nobody can be chosen",
      not [p for p in all_out["scope"]["people"] if p["kind"] == "client"]
      and all_out["scope"]["clients_why"] == "2 client records carry no usable client key or name, so they cannot "
                                             "be chosen" and all_out["scope"]["clients_note"] == "", all_out["scope"])
check("a clients slice with every record choosable carries no note",
      mass(clients=clients_ok(rows=CLIENT_ROWS[:2]))["scope"]["clients_note"] == "")
MCD = mass(clients=clients_down())
check("an unreadable clients slice says so on the chooser; the staff roster still answers",
      not [p for p in MCD["scope"]["people"] if p["kind"] == "client"]
      and MCD["scope"]["clients_why"] == "the clients list has not been built on this server"
      and len([p for p in MCD["scope"]["people"] if p["kind"] == "staff"]) == 5, MCD["scope"])
CLIENT_SEEN.clear()
mass(clients=clients_ok())
check("one answer reads the clients slice once, for the chooser and the chosen client alike",
      CLIENT_SEEN == ["read"] and (CLIENT_SEEN.clear() or True)
      and (mass(client="jane_doe", clients=clients_ok()) and CLIENT_SEEN == ["read"]), CLIENT_SEEN)

print("\nclients — a chosen client's profile")
MJ = mass(client="jane_doe")
# the chooser rides the master's answer; the profile itself is everything else
MJ_CARD = {k: v for k, v in MJ.items() if k != "scope"}
check("a chosen client is a client's profile: kind client, not own, no roster id, nothing to file under",
      MJ["person"]["kind"] == "client" and MJ["person"]["own"] is False and MJ["person"]["name"] == "Jane Doe"
      and MJ["person"]["roster_id"] == "" and MJ["person"]["key"] == "" and MJ["scope"]["client"] == "jane_doe"
      and MJ["scope"]["mode"] == "mass" and MJ["scope"]["people"], MJ["person"])
check("My Details carries the client record's own data under a client's labels, in order",
      [(f["label"], f["value"]) for f in MJ["details"]["fields"]] == [
          ("Client ID", "104233"), ("House", "Maple House"), ("Start date", "2021-03-14"),
          ("Phone", "(330) 555-0101"), ("Email", "jane.doe@example.invalid"),
          ("Address", "12 Maple St, Canton, OH 44709"), ("Guardian", "Mary Doe"),
          ("Guardian phone", "330-555-0202"), ("Guardian email", "mary.doe@example.invalid")]
      and field(MJ, "guardian")["note"] == "Relationship: Mother" and MJ["details"]["state"] == "ready",
      MJ["details"])
check("the client record's private columns never leave the server",
      not leaks(MJ, "1988-02-03", "123456789012", "Private diagnosis text", "Private medical summary", "dob",
                "medicaid"), leaks(MJ, "1988-02-03", "123456789012", "Private diagnosis text", "dob", "medicaid"))
check("My Requirements says plainly it applies to staff, not to clients — no table, not 'none on file'",
      MJ["requirements"]["state"] == "not_applicable" and MJ["requirements"]["why"] == mp.REQS_NOT_CLIENT
      and MJ["requirements"]["rows"] == [] and "on file" not in MJ["requirements"]["why"], MJ["requirements"])
check("My Docs says plainly it applies to staff, not to clients",
      MJ["documents"] == {"state": "not_applicable", "why": mp.DOCS_NOT_CLIENT} and "documents" not in P, MJ)
check("a client's profile draws no staff roster or requirement row",
      not leaks(MJ_CARD, "annroe", "ASA-1041", "DODD", "PPL_", "Ann Roe", "The Boss"),
      leaks(MJ_CARD, "annroe", "ASA-1041", "DODD", "PPL_", "Ann Roe", "The Boss"))
MS = mass(client="sam_self")
check("a field the client record does not hold is the em dash's sentence, never a guess: the plan's clientNumber "
      "echoing the client key is no number, a withheld cell says so, and a self-guardian is named as such",
      field(MS, "client_id") == {"key": "client_id", "label": "Client ID", "value": "",
                                 "why": "No client number is on file.", "note": ""}
      and field(MS, "house")["why"] == "No house is on file."
      and field(MS, "start_date")["why"] == "No start date is on file."
      and field(MS, "phone")["why"] == mp.WITHHELD_WHY and redaction.MARKER_PRIVATE not in json.dumps(MS)
      and field(MS, "address")["why"] == "No home address is on file."
      and field(MS, "guardian")["value"] == "Self" and field(MS, "guardian")["note"] == mp.GUARDIAN_SELF_NOTE
      and field(MS, "guardian_email")["why"] == "No guardian e-mail is on file.", MS["details"])
try:
    mass(client="nobody_here")
    no_client = False
except mp.NoSuchPerson as exc:
    no_client = "client" in str(exc)
check("a client key the clients slice was read and does not hold is refused, never an empty profile", no_client)
MTW = mass(client="twin_one")
check("two client records under one key are neither: each field says which record is theirs cannot be told",
      all(f["value"] == "" and "cannot be told" in f["why"] for f in MTW["details"]["fields"])
      and not leaks(MTW, "Oak House", "Elm House") and MTW["details"]["notes"], MTW["details"])
for label, reader in (("not built", clients_down()),
                      ("failing", clients_down(RuntimeError("disk"))),):
    got = mass(client="jane_doe", clients=reader)
    check(f"a chosen client with the clients slice {label}: the card is unreadable in words, every field says the "
          f"clients list could not be read — never 'none on file'",
          got["details"]["state"] == "unreadable" and got["details"]["why"] == "the clients list did not answer"
          and all(f["value"] == "" and f["why"] == "The clients list could not be read, so this is not known."
                  for f in got["details"]["fields"])
          and "on file" not in json.dumps(got["details"]) and got["details"]["notes"]
          and got["requirements"]["state"] == "not_applicable", got["details"])
old_list = mass(client="jane_doe", clients=clients_ok(as_of="2026-09-01T12:00:00Z"))
check("an old clients slice names the day it was built",
      any("the clients list read here was built Sep 1, 2026" in n for n in old_list["details"]["notes"]),
      old_list["details"]["notes"])
fresh_list = mass(client="jane_doe")
check("a clients slice built today, whose last rebuild landed, carries no copy note",
      not any("clients list" in n for n in fresh_list["details"]["notes"]), fresh_list["details"]["notes"])
failed_build = mass(client="jane_doe", clients=clients_ok(build_error="the last rebuild of the clients list failed"))
check("a clients slice whose last rebuild failed is never shown as current, even a copy built today: the card says "
      "which copy it is",
      "the last rebuild of the clients list failed, so this is the copy built Sep 25, 2026 — anything changed since "
      "may not show yet" in failed_build["details"]["notes"]
      and field(failed_build, "house")["value"] == "Maple House", failed_build["details"]["notes"])
failed_old = mass(client="jane_doe", clients=clients_ok(as_of="2026-09-01T12:00:00Z",
                                                        build_error="the last rebuild of the clients list failed"))
check("…one sentence for a failed rebuild of an old copy, never two",
      len([n for n in failed_old["details"]["notes"] if "clients list" in n]) == 1
      and any("copy built Sep 1, 2026" in n for n in failed_old["details"]["notes"]), failed_old["details"]["notes"])
check("a person and a client asked together: the roster row is read, never both (the door refuses it first)",
      mass(person="PPL_BOB", client="jane_doe")["person"]["roster_id"] == "PPL_BOB")

print("\nclients — read_clients: the slice as the relay keeps it")
TMP = Path(os.environ.get("TMPDIR") or "/tmp") / f"my-profile-clients-{os.getpid()}"
TMP.mkdir(parents=True, exist_ok=True)


def slice_file(name, text):
    p = TMP / name
    p.write_text(text, encoding="utf-8")
    return str(p)


good = slice_file("good.json", json.dumps({"resource": "clients", "built_at": "2026-09-25T17:01:44Z",
                                           "rows": CLIENT_ROWS}))
landed = slice_file("index-ok.json", json.dumps({"slices": {"clients": {"built_at": "2026-09-25T17:01:44Z",
                                                                        "rows": 6}}}))
rows_read, built, build_error = mp.read_clients(good, landed)
check("a built slice gives its rows and when it was built, and a rebuild that landed says nothing",
      len(rows_read) == len(CLIENT_ROWS) and built == "2026-09-25T17:01:44Z" and build_error == "")
failed_index = slice_file("index-failed.json", json.dumps({"slices": {"clients": {
    "rows": 0, "error": "HttpError 500 secret-internal-detail"}, "houses": {"rows": 3}}}))
_r, _b, build_error = mp.read_clients(good, failed_index)
check("a last rebuild the index records as failed is said, without the failure's own text",
      build_error == "the last rebuild of the clients list failed" and "secret" not in build_error, build_error)
other_failed = slice_file("index-other.json", json.dumps({"slices": {"houses": {"rows": 0, "error": "boom"}}}))
check("another slice's failed rebuild is not the clients list's", mp.read_clients(good, other_failed)[2] == "")
_r, _b, build_error = mp.read_clients(good, str(TMP / "no-index.json"))
check("an index that cannot be read is never taken as a rebuild that landed",
      build_error == "whether the last rebuild of the clients list landed could not be read (FileNotFoundError)",
      build_error)
beside = slice_file("clients.json", json.dumps({"built_at": "x", "rows": CLIENT_ROWS}))
slice_file("index.json", json.dumps({"slices": {"clients": {"rows": 0, "error": "boom"}}}))
check("with no index named, the index beside the slice is read (the relay's own OUT_DIR/index.json)",
      mp.read_clients(beside)[2] == "the last rebuild of the clients list failed")
for label, path, words in (
        ("missing", str(TMP / "absent.json"), "the clients list has not been built on this server"),
        ("not JSON", slice_file("bad.json", "<html>"), "the clients list could not be read (JSONDecodeError)"),
        ("no row list", slice_file("norows.json", json.dumps({"built_at": "x"})), "the clients list holds no rows"),
        ("an empty row list", slice_file("empty.json", json.dumps({"rows": []})), "holds no client")):
    try:
        mp.read_clients(path)
        said = ""
    except mw.Unreadable as exc:
        said = str(exc)
    check(f"a slice {label} is unreadable in words, never an empty list", words in said, said)
for p in TMP.iterdir():
    p.unlink()
TMP.rmdir()

print("\nclients — a client login sees only its own client")
CLIENT_USERS = {
    **USERS,
    "u-jane": {"user_id": "u-jane", "display_name": "Jane Doe", "email": "jane.login@example.invalid",
               "role": "client", "client_key": "jane_doe", "active": "TRUE"},
    "u-mary": {"user_id": "u-mary", "display_name": "Mary Doe", "email": "mary.login@example.invalid",
               "role": "client", "client_key": "jane_doe", "title": "Guardian of Jane Doe", "active": "TRUE"},
    "u-sam": {"user_id": "u-sam", "display_name": "Sam Self", "email": "sam@example.invalid", "role": "client",
              "client_key": "sam_self", "active": "TRUE"},
    "u-nokey": {"user_id": "u-nokey", "display_name": "No Key", "email": "nokey@example.invalid", "role": "client",
                "client_key": "", "active": "TRUE"},
    "u-gone": {"user_id": "u-gone", "display_name": "Jane Doe", "email": "gone@example.invalid", "role": "client",
               "client_key": "jane_doe", "active": "FALSE"},
    "u-staffck": {"user_id": "u-staffck", "display_name": "Ann Roe", "email": "ann@example.com", "role": "staff",
                  "client_key": "jane_doe", "active": "TRUE"},
    "u-twin": {"user_id": "u-twin", "display_name": "Twin One", "email": "twin@example.invalid", "role": "client",
               "client_key": "twin_one", "active": "TRUE"},
}


def as_client(uid, users=None, clients=None, **db_over):
    return run(db=FakeDb(users=users or CLIENT_USERS, **db_over), me={}, uid=uid, role="client", clients=clients)


CJ = as_client("u-jane")
check("a client login reads its own client's record, found by the client key on its own accounts row",
      CJ["person"]["kind"] == "client" and CJ["person"]["own"] is True and CJ["person"]["name"] == "Jane Doe"
      and field(CJ, "client_id")["value"] == "104233" and field(CJ, "house")["value"] == "Maple House"
      and "people" not in CJ["scope"] and CJ["requirements"]["state"] == "not_applicable"
      and CJ["documents"]["state"] == "not_applicable", CJ)
check("…and nothing of any other client, or of the staff roster",
      not leaks(CJ, "Sam Self", "sam_self", "Twin One", "Oak House", "PPL_", "ASA-1041", "annroe"),
      leaks(CJ, "Sam Self", "Twin One", "PPL_", "ASA-1041"))
CM = as_client("u-mary")
check("a guardian's login is a client-role account tied to its client: it reads that client's record",
      CM["person"]["name"] == "Jane Doe" and field(CM, "guardian")["value"] == "Mary Doe"
      and not leaks(CM, "Sam Self"), CM["details"])
check("a client's own answer says a client reads it, and carries no account block; its card is unchanged",
      CJ["person"]["viewer"] == "client" and "account" not in CJ["person"] and CJ["person"]["name"] == "Jane Doe",
      CJ["person"])
GUARD_USERS = {**CLIENT_USERS,
               "u-mary": {**CLIENT_USERS["u-mary"], "types": "GUARDIAN", "phone": "330-555-0202"},
               "u-marj": {**CLIENT_USERS["u-mary"], "user_id": "u-marj", "types": '["GUARDIAN"]',
                          "email": redaction.MARKER_PRIVATE}}
CMG = as_client("u-mary", users=GUARD_USERS)
check("a guardian (a client-role account wearing GUARDIAN) is told so: the viewer is a guardian, its own account "
      "comes first — its name, sign-in and phone — and the card is the client's, named as theirs",
      CMG["person"]["viewer"] == "guardian" and CMG["person"]["name"] == "Jane Doe"
      and CMG["person"]["account"] == {"name": "Mary Doe", "email": "mary.login@example.invalid",
                                       "phone": "330-555-0202", "guardian_of": "Jane Doe"}
      and field(CMG, "client_id")["value"] == field(CJ, "client_id")["value"]
      and [f["key"] for f in CMG["details"]["fields"]] == [f["key"] for f in CJ["details"]["fields"]]
      and not leaks(CMG, "Sam Self", "sam_self"), CMG["person"])
CMJ = as_client("u-marj", users=GUARD_USERS)
check("…the badge read as the backend writes it, a list or a word; a withheld sign-in is blank, never the marker",
      CMJ["person"]["viewer"] == "guardian" and CMJ["person"]["account"]["email"] == ""
      and redaction.MARKER_PRIVATE not in json.dumps(CMJ["person"]), CMJ["person"])
CMX = as_client("u-mary", users=GUARD_USERS,
                clients=clients_ok(rows=[r for r in CLIENT_ROWS if r["client_key"] != "jane_doe"]))
check("…and with no client record read, the guardian's own name is never passed off as the client's",
      CMX["person"]["viewer"] == "guardian" and CMX["person"]["name"] == ""
      and CMX["person"]["account"]["guardian_of"] == "" and CMX["person"]["account"]["name"] == "Mary Doe",
      CMX["person"])
check("viewer_of reads GUARDIAN in any spelling the badge column holds, and nothing else",
      mp.viewer_of({"types": "CLIENT, GUARDIAN"}) == "guardian" and mp.viewer_of({"types": ["guardian"]}) == "guardian"
      and mp.viewer_of({"types": "CLIENT"}) == "client" and mp.viewer_of({"types": "GUARDIANSHIP"}) == "client"
      and mp.viewer_of(None) == "client")
CN = as_client("u-nokey")
check("a client login tied to no client reads no client record: every field says none is tied, never 'none on file'",
      all(f["value"] == "" and f["why"] == "No client record is tied to you, so this is not known."
          for f in CN["details"]["fields"])
      and not leaks(CN, "Jane Doe", "Sam Self", "104233", "Maple")
      and any("no client is tied to this account" in n for n in CN["details"]["notes"]), CN["details"])
CG = as_client("u-gone")
check("an account that is not live is tied to no client", not leaks(CG, "104233", "Maple House")
      and any("not a live client account" in n for n in CG["details"]["notes"]), CG["details"])
CSK = as_client("u-staffck")
check("an accounts row whose role is not client is tied to no client, whatever client key it carries "
      "(Main.gs hubClientKeyOf_)", not leaks(CSK, "104233", "Maple House") and mp.client_key_of(
          CLIENT_USERS["u-staffck"]) == "" and mp.client_key_of(CLIENT_USERS["u-jane"]) == "jane_doe", CSK["details"])
SVC_USERS = {**CLIENT_USERS, "u-svc": {**CLIENT_USERS["u-jane"], "user_id": "u-svc", "is_service": "TRUE"}}
CSV = as_client("u-svc", users=SVC_USERS)
check("a service account is tied to no client, as Main.gs hubClientKeyOf_ refuses it",
      not leaks(CSV, "104233", "Maple House") and mp.client_key_of(SVC_USERS["u-svc"]) == ""
      and mp.client_key_of({**CLIENT_USERS["u-jane"], "is_service": True}) == ""
      and all(mp.client_key_of({**CLIENT_USERS["u-jane"], "is_service": v}) == "jane_doe"
              for v in ("", "FALSE", "false", False, None, "0")), CSV["details"])
print("\nclients — the client link is a grant: a stale accounts copy may narrow, never widen")
for label, over, cause in (
        ("older than the trust window", {"users_copy": (7201.0, True)},
         "the accounts copy read here is more than 2 hours old"),
        ("whose last copy pass was not ok", {"users_copy": (60.0, False)},
         "the last copy pass over the accounts book did not finish cleanly"),
        ("that carries no copy time", {"users_copy": (None, True)},
         "the accounts copy read here carries no copy time"),
        ("whose age cannot be read", {"users_copy_error": RuntimeError("down")},
         "how fresh the accounts copy is could not be read (RuntimeError)")):
    CLIENT_SEEN.clear()
    got = as_client("u-jane", **over)
    check(f"an accounts copy {label}: the client link is not confirmed, no client record is drawn, and the card "
          f"says so in words — never 'none on file'",
          got["details"]["state"] == "unreadable"
          and got["details"]["why"] == "whether this account is still tied to its client could not be confirmed"
          and all(f["value"] == "" and f["why"] == mp.LINK_GAP for f in got["details"]["fields"])
          and any(n.startswith(cause) and "no client record is drawn" in n for n in got["details"]["notes"])
          and not leaks(got, "104233", "Maple House", "Mary Doe", "12 Maple") and "on file" not in json.dumps(
              got["details"]["fields"]) and CLIENT_SEEN == [] and got["person"]["kind"] == "client",
          [got["details"], CLIENT_SEEN])
check("a copy inside the trust window with a clean last pass confirms the link",
      field(as_client("u-jane", users_copy=(7199.0, True)), "house")["value"] == "Maple House")
check("the trust window is the caller's (the relay passes MIRROR_TRUST_MAX_S)",
      field(run(db=FakeDb(users=CLIENT_USERS, users_copy=(600.0, True)), me={}, uid="u-jane", role="client",
                fresh_s=300.0), "house")["value"] == ""
      and field(run(db=FakeDb(users=CLIENT_USERS, users_copy=(600.0, True)), me={}, uid="u-jane", role="client",
                    fresh_s=900.0), "house")["value"] == "Maple House")
gone_db = FakeDb(users=CLIENT_USERS, users_copy=(99999.0, False))
stale_gone = run(db=gone_db, me={}, uid="u-gone", role="client")
check("a stale copy still narrows: an account it shows not live is tied to no client, and the copy's age is not "
      "even asked", any("not a live client account" in n for n in stale_gone["details"]["notes"])
      and not leaks(stale_gone, "104233") and not any(r[0] == "users_copy" for r in gone_db.reads),
      [stale_gone["details"], gone_db.reads])
link_db = FakeDb(users=CLIENT_USERS)
run(db=link_db, me={}, uid="u-nokey", role="client")
check("…nor for an account tied to no client at all", not any(r[0] == "users_copy" for r in link_db.reads),
      link_db.reads)
class CopyCursor:
    """The two rows users_copy reads, in the order it asks."""

    def __init__(self, answers):
        self.answers, self.sql = list(answers), []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, args=()):
        self.sql.append((sql, args))

    def fetchone(self):
        return self.answers.pop(0)


def copy_of(newest, status):
    cur = CopyCursor([{"newest": newest}, {"last_sync_status": status} if status is not None else None])
    mirror = mp.Mirror("dsn")
    mirror._cursor = lambda: cur
    return mirror.users_copy("core"), cur


now_utc = datetime.now(timezone.utc)
(age, ok), cur = copy_of(now_utc - timedelta(seconds=600), "ok")
check("users_copy: the accounts tab's newest copy time and the book's last pass, as the access gate reads them",
      590 <= age <= 700 and ok is True and "tab_name='users'" in cur.sql[0][0]
      and "asa_drive_sheets_meta" in cur.sql[1][0] and cur.sql[0][1] == ("core",), [age, ok, cur.sql])
(age, ok), _cur = copy_of((now_utc - timedelta(seconds=600)).replace(tzinfo=None), "OK ")
check("…a stamp without a zone is UTC", 590 <= age <= 700 and ok is True, age)
check("…no stamp is no age, and a pass that is not ok, or no pass on record, is not ok",
      copy_of(None, "ok")[0] == (None, True) and copy_of(now_utc, "error")[0][1] is False
      and copy_of(now_utc, None)[0][1] is False)
CU = as_client("u-jane", users_error=RuntimeError("down"))
check("an account row that cannot be read draws nobody's client record: the card is unreadable in words",
      CU["details"]["state"] == "unreadable" and CU["details"]["why"] == "your account row did not answer"
      and all(f["why"] == "Your account row could not be read, so this is not known." for f in CU["details"]["fields"])
      and not leaks(CU, "104233", "Maple"), CU["details"])
CD = as_client("u-jane", clients=clients_down())
check("a client login with the clients slice unreadable: the card says so, never 'none on file'",
      CD["details"]["state"] == "unreadable" and "on file" not in json.dumps(CD["details"]["fields"])
      and all(f["why"] == "The clients list could not be read, so this is not known." for f in CD["details"]["fields"]),
      CD["details"])
CX = as_client("u-jane", clients=clients_ok(rows=[r for r in CLIENT_ROWS if r["client_key"] != "jane_doe"]))
check("a client key no client record carries: every field says none is tied, and nothing of another client",
      all(f["why"] == "No client record is tied to you, so this is not known." for f in CX["details"]["fields"])
      and not leaks(CX, "Sam Self", "Twin One"), CX["details"])
CT = as_client("u-twin")
check("a client key two records carry is neither's", not leaks(CT, "Oak House", "Elm House")
      and all("cannot be told" in f["why"] for f in CT["details"]["fields"]), CT["details"])
CP = run(db=FakeDb(users=CLIENT_USERS), me={}, uid="u-jane", role="client", person="PPL_BOB", client="sam_self")
check("a client login's own view ignores any person or client asked for (the door refuses them first)",
      CP["person"]["name"] == "Jane Doe" and not leaks(CP, "Sam Self", "Bob Bee", "ASA-2002"), CP["person"])
CLIENT_SEEN.clear()
staff_own = run(db=FakeDb(users=CLIENT_USERS), uid="u-staffck", role="staff")
check("a staff account's own profile never reads the clients slice and never carries a client's record — even one "
      "whose accounts row carries a client key",
      CLIENT_SEEN == [] and staff_own["person"]["kind"] == "staff" and not leaks(staff_own, "104233", "Maple House",
                                                                                 "Jane Doe"), CLIENT_SEEN)
check("a staff account asking for a client outside mass mode gets its own staff profile from the module (the door "
      "refuses it first)", run(client="jane_doe", role="staff")["person"]["kind"] == "staff"
      and not leaks(run(client="jane_doe", role="staff"), "104233", "Maple House"))

svc = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
tree = ast.parse(svc)


def segment(name):
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(svc, node) or ""
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == name for t in node.targets):
            return ast.get_source_segment(svc, node) or ""
    return ""


print("\nthe door")
route = segment("lane_my_profile")
check("the route is declared, no-store", '@app.get("/hub-lanes/my-profile")' in svc
      and 'response.headers["Cache-Control"] = "no-store"' in route)
refused_roles = ast.literal_eval(segment("_MY_PROFILE_ROLES_REFUSED").split("=", 1)[1].strip())
check("it asks App Control for my-profile with no admin floor; a client-role account (a client or a guardian) is "
      "let to the matrix, the trainee and the interviewer are refused, and the dead `guardian` role is gone",
      '_hotline_actor(authorization, app_id="my-profile"' in route and "floor=False" in route
      and set(refused_roles) == {"onboarding", "interviewer"}, refused_roles)
check("the door reads the clients slice this relay builds, the one Daily Notes reads",
      'OUT_DIR / "clients.json"' in segment("_my_profile_clients") and "clients=_my_profile_clients" in route
      and 'str(OUT_DIR / "clients.json")' in segment("_daily_book"))
check("my_profile is imported guarded", "try:\n    import my_profile\nexcept Exception as _my_profile_import_exc:" in svc)
check("the master flag is learned by My Work's one learner: no new authMe caller",
      "_my_work_learn_master(authorization)" in route and '"action": "authMe"' not in route
      and '"action": "authMe"' not in segment("_my_profile_scope"))
check("no log line of the door speaks of acting", not re.search(r"log\.\w+\([^)]*act", route + segment("_my_profile_scope")))
calls: list[str] = []
GATE_SAW: list = []
STATE = {"acting": set(), "authme": None, "role": "staff", "uid": "u-ann", "released": True, "profile_error": None}
WHO = {"name": "Ann Roe"}


async def _session_actor(authorization):
    return (STATE["role"], STATE["uid"])


async def _hotline_actor(authorization, app_id="smartcomms", *, refuse_roles=(), app_label="", floor=True):
    calls.append(f"gate:{app_id}")
    seen = AUTH_MASTER.get(authorization[7:].strip())
    if seen is None and not floor:
        seen = False
    GATE_SAW.append(seen)
    if authorization == "Bearer shut":
        return {"status": 403, "message": "My Profile is not open to you."}
    if seen is True or (seen is None and STATE["role"] == "admin") or STATE["released"]:
        return (STATE["role"], STATE["uid"])
    return {"status": 403, "reason": "badge", "message": "My Profile is not open to you."}


async def _requests_viewer(authorization):
    calls.append("viewer")
    return dict(WHO), (STATE["role"], STATE["uid"])


async def _auth_me(token):
    # the relay's own authMe of Python's sign-in
    calls.append("exec:authMe")
    if STATE["authme"] is None:
        raise RuntimeError("no answer")
    return STATE["authme"]


class Acting:
    def known(self, token):
        return token in STATE["acting"]


LAST: dict = {}


def fake_profile(dsn, core, **k):
    calls.append(f"profile:{k['mode']}:{k['person']}:{k['uid']}")
    LAST.clear()
    LAST.update(k)
    if STATE["profile_error"] is not None:
        raise STATE["profile_error"]
    return {"mode": k["mode"], "why": k["scope_why"], "person": k["person"]}


stub_mw = types.SimpleNamespace(
    MODE_MASS=mw.MODE_MASS, scope_verdict=mw.scope_verdict,
    identity=lambda dsn, core, uid, roster_name="": calls.append(f"identity:{uid}:{roster_name}") or ME)
stub_mp = types.SimpleNamespace(PERSON_RE=mp.PERSON_RE, CLIENT_RE=mp.CLIENT_RE, NoSuchPerson=mp.NoSuchPerson,
                                profile=fake_profile,
                                read_clients=lambda path, index=None: calls.append(f"clients:{path}:{index}"))
AUTH_MASTER: dict = {}
ns = {"app": types.SimpleNamespace(get=lambda path: (lambda f: f)), "Header": lambda default="": default,
      "Response": object, "Any": object, "asyncio": asyncio, "re": re, "log": logging.getLogger("test"),
      "OUT_DIR": Path("/srv/snapshot"), "MIRROR_TRUST_MAX_S": 5400.0,
      "PG_DSN": "dsn", "HUB_DB_SHEET_ID": "core", "my_work": stub_mw, "my_profile": stub_mp,
      "_hotline_actor": _hotline_actor, "_session_actor": _session_actor, "_requests_viewer": _requests_viewer,
      "_auth_me": _auth_me, "_auth_master": AUTH_MASTER, "_acting": Acting(),
      "_note_session_answer": lambda token, env: None}
for name in ("_hotline_token", "_DAILY_REASONS", "_daily_refusal", "_my_work_acting", "_my_work_learn_master",
             "_MY_PROFILE_DOWN", "_MY_PROFILE_ROLES_REFUSED", "_MY_PROFILE_VISIT", "_MY_PROFILE_OWN_ONLY",
             "_my_profile_scope", "_my_profile_clients", "lane_my_profile"):
    code = segment(name)
    check(f"the relay declares {name}", bool(code))
    exec(code, ns)  # noqa: S102 — the relay's own source


def door(auth="Bearer tok", member="", person="", client=""):
    calls.clear()
    resp = types.SimpleNamespace(headers={})
    got = asyncio.run(ns["lane_my_profile"](resp, member=member, person=person, client=client, authorization=auth))
    return got, list(calls), resp


visit, vcalls, vresp = door(member="u-bob")
check("inside a visit it refuses before any gate or read",
      visit["status"] == 403 and visit["reason"] == "visit" and vcalls == [] and vresp.headers["Cache-Control"] == "no-store",
      [visit, vcalls])
shut, scalls, _ = door(auth="Bearer shut")
check("a closed App Control row refuses with its reason and reads nothing",
      shut["status"] == 403 and shut["reason"] == "badge" and scalls == ["gate:my-profile"], [shut, scalls])
okay, ocalls, _ = door()
check("a staff session reads its own account, then its own profile — no master check",
      okay["status"] == 200 and okay["data"]["mode"] == "own"
      and ocalls == ["gate:my-profile", "viewer", "identity:u-ann:Ann Roe", "profile:own::u-ann"], [okay, ocalls])
nope, ncalls, _ = door(person="PPL_BOB")
check("a staff member asking for another person is refused as scope, before anything is read",
      nope["status"] == 403 and nope["reason"] == "scope" and "viewer" not in ncalls
      and not any(c.startswith("profile") for c in ncalls), [nope, ncalls])
STATE.update(role="admin", uid="u-boss")
AUTH_MASTER["tok"] = True
m_ok, mcalls, _ = door(person="PPL_BOB")
check("the master's own session reads the person chosen",
      m_ok["status"] == 200 and m_ok["data"]["mode"] == "mass" and "profile:mass:PPL_BOB:u-boss" in mcalls
      and not any(c.startswith("exec:") for c in mcalls), [m_ok, mcalls])
m_self, _msc, _ = door()
check("…and its own profile with nobody chosen, saying it may choose",
      m_self["data"]["mode"] == "mass" and m_self["data"]["person"] == "" and "any person" in m_self["data"]["why"])
bad, _bcalls, _ = door(person="Bob Bee!")
check("a person that is not a roster id is a 400", bad["status"] == 400 and bad["reason"] == "person")
STATE["profile_error"] = mp.NoSuchPerson("No row of the staff roster carries that person.")
gone, _gc, _ = door(person="PPL_GONE")
check("a roster id nobody holds is a 404 the screen lets go of", gone["status"] == 404 and gone["reason"] == "person")
STATE["profile_error"] = RuntimeError("boom")
boom, _bc, _ = door()
check("a profile that throws is a 503 in words", boom["status"] == 503 and "could not be put together" in boom["message"])
STATE["profile_error"] = None
STATE["acting"].add("tok")
act_ok, acalls, _ = door()
check("acting as someone with a stale True flag reads that person's own profile only, told only what they are told",
      act_ok["data"]["mode"] == "own" and act_ok["data"]["why"] == "", act_ok)
act_person, _apc, _ = door(person="PPL_BOB")
check("…and cannot choose another person", act_person["status"] == 403 and act_person["reason"] == "scope")
AUTH_MASTER.clear()
act_unknown, aucalls, _ = door()
check("an acting token asks no master check at all", "exec:authMe" not in aucalls and act_unknown["data"]["mode"] == "own")
STATE["acting"].clear()
ns["_acting"] = {"tok": (9e9, "u-boss", "u-ann")}
AUTH_MASTER["tok"] = True
dict_act, _dc, _ = door()
check("the dict-shaped acting registry: own, never mass", dict_act["data"]["mode"] == "own")
ns["_acting"] = Acting()
AUTH_MASTER.clear()
unk, ucalls, _ = door()
check("an admin whose flag is unknown asks authMe once, BEFORE the gate; a failed check is own, in words",
      ucalls.count("exec:authMe") == 1 and ucalls.index("exec:authMe") < ucalls.index("gate:my-profile")
      and unk["data"]["mode"] == "own"
      and unk["data"]["why"] == "The master check could not be made (RuntimeError), so only your own profile is shown.",
      [unk, ucalls])
STATE["authme"] = {"status": 200, "data": {"user": {"is_master": False}}}
GATE_SAW.clear()
plain, _pc, _ = door()
check("an admin the check names not the master: the gate sees False, and the profile is own",
      GATE_SAW == [False] and plain["data"]["mode"] == "own" and AUTH_MASTER.get("tok") is False, [GATE_SAW, plain])
STATE.update(authme=None, released=False)
AUTH_MASTER.clear()
GATE_SAW.clear()
shut_unknown, sucalls, _ = door()
check("unreleased, and the master check failed: a 503 saying the check failed — never the profile, never a badge",
      shut_unknown["status"] == 503 and shut_unknown["reason"] == "unavailable"
      and "the master check could not be made (RuntimeError)" in shut_unknown["message"]
      and not any(c.startswith(("profile", "viewer")) for c in sucalls), [shut_unknown, sucalls])
AUTH_MASTER["tok"] = False
plain_shut, _psc, _ = door()
check("…an admin the backend names not the master is refused as a badge", plain_shut["reason"] == "badge")
AUTH_MASTER["tok"] = True
check("…and the master opens it", door()[0]["data"]["mode"] == "mass")
STATE.update(role="staff", uid="u-ann", released=True)
AUTH_MASTER.clear()
stub_mw.identity = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("mirror down"))
broken, bcalls, _ = door()
check("an account row that cannot be read is a 502 in words, and no profile is drawn",
      broken["status"] == 502 and "could not be read" in broken["message"]
      and not any(c.startswith("profile") for c in bcalls), [broken, bcalls])

print("\nthe door — clients")
st_client, stc, _ = door(client="jane_doe")
check("a staff account asking for a client is refused as scope, before anything is read",
      st_client["status"] == 403 and st_client["reason"] == "scope"
      and not any(c.startswith(("profile", "viewer", "identity")) for c in stc), [st_client, stc])
STATE.update(role="client", uid="u-jane")
cl_own, clc, _ = door()
check("a client-role session reads its own client's profile: the session's account and role go to the module, no "
      "roster identity is drawn, and the clients slice is the relay's own",
      cl_own["status"] == 200 and cl_own["data"]["mode"] == "own" and clc == ["gate:my-profile", "profile:own::u-jane"]
      and LAST["role"] == "client" and LAST["uid"] == "u-jane" and LAST["client"] == "" and LAST["person"] == ""
      and LAST["clients"] is ns["_my_profile_clients"], [cl_own, clc, LAST])
check("the door hands the module the relay's own trust window for the client link (MIRROR_TRUST_MAX_S)",
      LAST.get("fresh_s") == 5400.0 and "fresh_s=MIRROR_TRUST_MAX_S" in route, LAST.get("fresh_s"))
for label, kw in (("another client", {"client": "sam_self"}), ("its own client key", {"client": "jane_doe"}),
                  ("a staff member", {"person": "PPL_BOB"})):
    got, gcalls, _ = door(**kw)
    check(f"a client-role session asking for {label} is refused as scope — its client is never the screen's to name",
          got["status"] == 403 and got["reason"] == "scope" and not any(c.startswith("profile") for c in gcalls),
          [got, gcalls])
STATE["acting"].add("tok")
AUTH_MASTER["tok"] = True
cl_act, _cac, _ = door()
check("the master acting as a client reads only that client's own profile, told only what the client is told",
      cl_act["data"]["mode"] == "own" and cl_act["data"]["why"] == "" and LAST["role"] == "client"
      and LAST["uid"] == "u-jane", [cl_act, LAST])
check("…and cannot choose another client", door(client="sam_self")[0]["reason"] == "scope")
STATE["acting"].clear()
STATE.update(role="admin", uid="u-boss")
stub_mw.identity = lambda dsn, core, uid, roster_name="": calls.append(f"identity:{uid}:{roster_name}") or MASTER_ME
m_client, mcc, _ = door(client="jane_doe")
check("the master's own session reads the client chosen, by its client key",
      m_client["status"] == 200 and m_client["data"]["mode"] == "mass" and LAST["client"] == "jane_doe"
      and LAST["person"] == "" and LAST["role"] == "admin", [m_client, mcc, LAST])
both_asked, _bac, _ = door(person="PPL_BOB", client="jane_doe")
check("a person and a client asked together is a 400", both_asked["status"] == 400 and both_asked["reason"] == "person")
bad_client, _bcc, _ = door(client="jane;doe")
check("a client that is not a client key is a 400", bad_client["status"] == 400 and bad_client["reason"] == "person")
STATE["profile_error"] = mp.NoSuchPerson("No client record carries that client.")
gone_client, _gcc, _ = door(client="nobody_here")
check("a client key nobody holds is a 404 the screen lets go of",
      gone_client["status"] == 404 and gone_client["reason"] == "person")
STATE["profile_error"] = None
AUTH_MASTER.clear()
calls.clear()
ns["_my_profile_clients"]()
check("the door's clients reader reads the relay's own clients.json, and the index's word on its last rebuild",
      calls == ["clients:/srv/snapshot/clients.json:/srv/snapshot/index.json"], calls)
STATE.update(role="staff", uid="u-ann")
ns["my_profile"] = None
check("a module that did not load answers 503 with a sentence", door()[0]["status"] == 503)

print("\nthe documents and the upload — the certificate doors, used and never widened")
gs = (ROOT / "apps-script" / "ComplianceDocs.gs").read_text(encoding="utf-8")
lst = gs[gs.index("HUB_ACTIONS.certUploadsList = function"):]
check("certUploadsList answers every row to the real master and the caller's own to everyone else",
      "var all = hubIsRealMaster_(user);" in lst and "if (self && hubNameFold_(r.person) !== self.key) return;" in lst)
up = gs[gs.index("HUB_ACTIONS.certDocUpload = function"):gs.index("HUB_POLICY.certUploadsList")]
check("certDocUpload with no person, or a name with no letters or digits, files against the caller's own record",
      "var asked = hubNameFold_(str_(payload.person)) ? str_(payload.person) : '';" in up
      and "if (asked && complianceDocsFilesForOthers_(user))" in up
      and "person = self.name;" in up)
check("certDocUpload files a requirement id under the catalogue's label, and keeps the shared archive copy behind "
      "test mode", "complianceDocsReq_(payload.req_id)" in up and "cert = str_(req.label);" in up
      and "var shared = complianceDocsSharedCopy_(blob);" in gs and "on = hubTestModeOn_();" in gs)
check("certDocUpload refuses a master session that names nobody, before any self is settled: a master's upload never "
      "lands under the master's own name for another person's requirement",
      "if (!asked && hubIsRealMaster_(user)) return { status: 400, message: CERT_UPLOAD_NOBODY };" in up
      and up.index("CERT_UPLOAD_NOBODY") < up.index("complianceDocsSelf_(user)"))
role_gs = gs[gs.index("function complianceDocsDateRole_"):gs.index("function complianceDocsVisit_")]
check("the door's date role is the relay's: a credential or an expiry word makes an expiry, any other date column "
      "is the document's own", "(str_(req.credential) || /\\bexp/i.test(source)) ? 'expires' : 'issued'" in role_gs
      and mp.EXPIRY_SOURCE_RE.pattern == r"\bexp" and mp.EXPIRY_SOURCE_RE.flags & re.I, role_gs)
receipts: dict = {}
exec(segment("RELAY_NO_RECEIPT_ACTIONS"), receipts)  # noqa: S102
check("the eye's bytes and a paper's reading are never kept as a relay receipt (no write_id is stamped on them)",
      {"certDocFile", "certDocRead", "beAnotherStart"} <= receipts["RELAY_NO_RECEIPT_ACTIONS"]
      and "certDocUpload" not in receipts["RELAY_NO_RECEIPT_ACTIONS"], receipts.get("RELAY_NO_RECEIPT_ACTIONS"))
sheet = (ROOT / "src" / "pages" / "features" / "myprofile" / "ProfileUploadSheet.tsx").read_text(encoding="utf-8")
call = sheet[sheet.index("gasAction<"):sheet.index("})", sheet.index("gasAction<"))]
check("My Profile's upload names a person only as the relay's file_as (the master's chosen profile): an own "
      "profile files for the session's own account",
      "'certDocUpload'" in call and ("person" not in call or re.search(r"person:\s*[\w.?]*file_as", call)), call)
spa_suite = (ROOT / "tests" / "spa" / "my-profile.test.tsx").read_text(encoding="utf-8")


def spa_const(name):
    m = re.search(rf"const {name} = '([^']*)'", spa_suite)
    return m.group(1) if m else None


check("the screen suite's probes answer in the relay's own sentences",
      spa_const("NOT_YOURS") == mp.NOT_YOURS and spa_const("ONLY") == mp.OWN_ROWS_ONLY
      and spa_const("SHARED") == mp.OWN_ROWS_SHARED and spa_const("NO_ROW_KEY") == probes[
          "Cal New (the sign-in e-mail is on Dana Old's on-staff row, linked to nobody)"][1]["person"]["key_why"]
      and spa_const("TWIN_KEY") == tia["person"]["key_why"],
      [spa_const(n) for n in ("NOT_YOURS", "ONLY", "SHARED", "NO_ROW_KEY", "TWIN_KEY")])

model = (ROOT / "src" / "pages" / "features" / "myprofile" / "myProfileModel.ts").read_text(encoding="utf-8")


def model_const(name):
    m = re.search(rf"export const {name} = '([^']*)'", model)
    return m.group(1) if m else None


check("the screen's fallback sentences for a client's profile are the relay's own",
      model_const("REQS_NOT_CLIENT") == mp.REQS_NOT_CLIENT and model_const("DOCS_NOT_CLIENT") == mp.DOCS_NOT_CLIENT,
      [model_const("REQS_NOT_CLIENT"), model_const("DOCS_NOT_CLIENT")])

lane_writes: dict = {}
exec(segment("_VIEWER_CACHE_LANE_WRITES"), lane_writes)  # noqa: S102
own_address = (ROOT / "src" / "pages" / "features" / "myprofile" / "useMyProfile.ts").read_text(encoding="utf-8")
save_call = own_address[own_address.index("export const saveAddress"):own_address.index("export function useAddress")]
check("an address saved on My Info rings my-profile once it lands, and the save names a person only as the master's "
      "chosen key — one's own record is the session's, decided by the door",
      "staffProfileAddressEdit" in lane_writes["_VIEWER_CACHE_LANE_WRITES"]["my-profile"]
      and "'staffProfileAddressEdit'" in save_call and "...(ask ? { key: ask } : {})" in save_call
      and "person" not in save_call, save_call)

pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
check("the suite is a script and rides the check chain",
      pkg["scripts"].get("test:my-profile") == "python3 tools/test-my-profile.py"
      and "npm run test:my-profile" in pkg["scripts"]["check"])
grants = []
for folder in ("apps-script", "tools", "server"):
    for p in (ROOT / folder).rglob("*"):
        if p.is_file() and p.suffix in (".gs", ".py", ".json", ".mjs", ".js") and p.name != "test-my-profile.py":
            text = p.read_text(encoding="utf-8", errors="ignore")
            if re.search(r"app_badge_access[^\n]{0,200}my-profile|my-profile[^\n]{0,200}app_badge_access", text):
                grants.append(str(p))
check("no App Control grant row for my-profile ships anywhere: the app is the master's until released", not grants, grants)

print(f"\nmy profile: {results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
