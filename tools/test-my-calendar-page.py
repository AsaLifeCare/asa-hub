#!/usr/bin/env python3
"""My Calendar's page on Python (app/my_calendar.py alone, its two reads) against the relay's builder
(server/my_calendar.py), both run read-only in asa-hub-db-sync with the modules streamed in: ten staff in their own
scope, other weeks, the master's own calendar and chosen people, the pencil's check, the door's refusals, the any-person
edition and an edit kept in Postgres. The relay side reads the relay's copy through the read-only role (MIRROR_DSN); the
Python side reads asa-hub-db, and the relay's own tables through mw_relay_state on that same role. Stand-ins, on both
sides alike: no published cells (asa_house_calendar_edits is not granted to the role), the house directory as
asa-hub-db holds it (the relay's entity_homes copy is not granted either), one test mode switch and one Time Off gate
per case. Prints counts, states and paths, never a person's values."""
from __future__ import annotations

import base64
import json
import py_compile
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import lane_schema  # noqa: E402

RUNNER = "asa-hub-db-sync"
STAFF = 10
CHOSEN = 3
BUDGET_S = 600
MASS_WHY = ("Signed in as the master account: your own calendar, or any person's you choose; a request you add "
            "there is filed for them, by you.")
GATE_WHY = "Time Off is not open to you."

APP_PRELUDE = r'''
import base64, hashlib, importlib.abc, importlib.util, json, os, re, sys, time, types
from datetime import date, datetime, timedelta, timezone
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = blob["app"]


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)


sys.path[:] = [p for p in sys.path if p not in ("", os.getcwd())]
sys.meta_path.insert(0, Checkout())
fake = types.ModuleType("fastapi")


class App:
    def __init__(self, **_kw):
        pass

    def _route(self, *_a, **_kw):
        return lambda fn: fn
    get = post = _route


fake.FastAPI, fake.Request = App, object
responses = types.ModuleType("fastapi.responses")
responses.JSONResponse = responses.Response = object
conc = types.ModuleType("starlette.concurrency")
conc.run_in_threadpool = None
sys.modules.update({"fastapi": fake, "fastapi.responses": responses, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": conc})
from psycopg.conninfo import make_conninfo
os.environ["HUB_DB_DSN"] = make_conninfo(host=os.environ.get("HUB_DB_HOST", "asa-hub-db"),
                                         dbname=os.environ["POSTGRES_DB"], user=os.environ["POSTGRES_USER"],
                                         password=os.environ["POSTGRES_PASSWORD"],
                                         options="-c default_transaction_read_only=on")
# the relay's own tables through the read-only role, as HUB_RELAY_RO_DSN reads them in asa-hub-app
os.environ["HUB_RELAY_RO_DSN"] = make_conninfo(os.environ["MIRROR_DSN"],
                                               options="-c default_transaction_read_only=on")
import gsjs, hubdb, locations as L, scope as sc
import my_work as MW
import mw_roster
import mw_time_off as TO
CORE = MW.CORE_USERS_SHEET_ID
db = hubdb.HubDb()
# STAND-IN, both sides alike: asa_house_calendar_edits is not granted to asa_hub_ro, so no published cells
mw_roster.effective_roster.published = staticmethod(lambda *a, **k: [])


def sha(v):
    return hashlib.sha1(str(v).encode()).hexdigest()
'''

PICK = APP_PRELUDE + r'''
import my_calendar as MC
reads = L.Reads(db)
books = MW.HubBooks(reads)
users = [u for u in books.users_rows(CORE, "", ()) if isinstance(u, dict)]


def live(u):
    return MW._live(u) and str(u.get("user_id") or "").strip() and MW.fold(u.get("display_name"))


master = next((u for u in users if live(u) and MW._low(u.get("email")) == sc.MASTER_ACCOUNT
               and MW._low(u.get("role")) == "admin"), None)
sid = books.pointers().get(MW.PTR_PEOPLE, "")
roster, _n, _at = books.tab(sid, MW.HOUSE_TAB) if sid else ([], 0, "")
named = {MW.fold(r.get("name")) for r in roster} - {""}
v = TO.view(reads)
by_person = {}
for r in v["rows"]:
    by_person.setdefault(MW.fold(r.get("person")), []).append(r)
on = MC.today()
mon = MC.week_of(on)[0]
est = MC.sr.estate(reads)
drawn = {MW.fold(n) for loc in est.get("locations") or [] for n in (est.get("people") or {}).get(loc, [])} - {""}
staff = [u for u in users if live(u) and u is not master
         and MW._low(u.get("role")) not in ("client", "guardian", "onboarding", "interviewer")]
order = lambda u: sha(u["user_id"])
key = lambda u: MW.fold(u.get("display_name"))
# drawn on a calendar and with time off first, then on the roster, then off it
both = sorted((u for u in staff if key(u) in named and key(u) in by_person and key(u) in drawn), key=order)
with_off = sorted((u for u in staff if key(u) in named and key(u) in by_person and u not in both), key=order)
on_roster = sorted((u for u in staff if key(u) in named and key(u) not in by_person), key=order)
off_roster = sorted((u for u in staff if key(u) not in named), key=order)
chosen = both[:4] + with_off[:2] + on_roster[:2] + off_roster[:2]
chosen = (chosen + [u for u in both[4:] + with_off[2:] + on_roster[2:] if u not in chosen])[:blob["staff"]]
switch = mw_roster.effective_roster.switch_from_config(reads)


def gate(u):
    user = sc.user_from_row(next((x for x in reads.users() if gsjs.str_(x.get("userid")) == str(u["user_id"])), {}))
    try:
        return any(sc.profile_app_gate(app, user, reads.scope_sources()).get("open") is True
                   for app in ("timeoff", "my-calendar"))
    except sc.Defer:
        return False


cases = []
for i, u in enumerate(chosen):
    cases.append({"tag": f"S{i + 1}", "uid": str(u["user_id"]), "role": MW._low(u.get("role")), "mode": "own",
                  "why": "", "person": "", "week": mon.isoformat(), "gate": gate(u)})
if chosen:
    cases.append({**cases[0], "tag": "S1-next", "week": (mon + timedelta(days=7)).isoformat()})
    cases.append({**cases[0], "tag": "S1-back", "week": (mon - timedelta(days=21)).isoformat()})
    # the same person with Time Off open, so the Add panel's own checks are reached
    cases.append({**cases[0], "tag": "S1-open", "gate": True})
checks = []
live_st = ("pending", "needs_review", "scheduled")


def ahead(r):
    a = TO.day_of(r.get("start_date"))
    return a is not None and (a > on if r.get("status") == "scheduled" else a >= on)


own = [(c, r) for c in cases if c["tag"].startswith("S") and "-" not in c["tag"]
       for r in by_person.get(key(next(x for x in users if str(x.get("user_id")) == c["uid"])), [])
       if r.get("status") in live_st]
# a request the person may still change first, so the overlap law itself is reached; else any live one
own.sort(key=lambda cr: (not ahead(cr[1]), sha(cr[1].get("id"))))
for c, r in own[:2]:
    a = TO.day_of(r.get("start_date")) or on
    checks.append({**c, "tag": f"K-{c['tag']}-{len(checks) + 1}", "ref": str(r.get("id")),
                   "start": (a + timedelta(days=1)).isoformat(), "end": (a + timedelta(days=2)).isoformat()})
if cases:
    mine = key(next(x for x in users if str(x.get("user_id")) == cases[0]["uid"]))
    other = next((r for p, rows in sorted(by_person.items(), key=lambda kv: sha(kv[0])) for r in rows if p != mine),
                 None)
    if other is not None:
        checks.append({**cases[0], "tag": "K-not-theirs", "ref": str(other.get("id")), "start": on.isoformat(),
                       "end": on.isoformat()})
if master is not None:
    m = {"uid": str(master["user_id"]), "role": "admin", "mode": "mass", "why": blob["mass_why"],
         "week": mon.isoformat(), "gate": True}
    cases.append({**m, "tag": "M", "person": ""})
    ids = sorted({MW._text(r.get("id"), 120) for r in roster
                  if MW.fold(r.get("name")) in by_person and MW.fold(r.get("name")) in drawn} - {""}, key=sha)
    for i, p in enumerate(ids[:blob["chosen"]]):
        cases.append({**m, "tag": f"M-P{i + 1}", "person": p})
    cases.append({**m, "tag": "M-P?", "person": "no such roster row"})
    pick = next((c for c in cases if c["tag"] == "M-P1"), None)
    if pick is not None:
        prow = next(r for r in roster if MW._text(r.get("id"), 120) == pick["person"])
        rows = sorted(by_person.get(MW.fold(prow.get("name")), []), key=lambda x: (not ahead(x), sha(x.get("id"))))
        if rows:
            checks.append({**pick, "tag": "K-M-P1", "ref": str(rows[0].get("id")),
                           "start": (on + timedelta(days=30)).isoformat(),
                           "end": (on + timedelta(days=31)).isoformat()})
homes = mw_roster.house_directory.read(reads)
print("PICK_RESULT " + json.dumps({"cases": cases, "checks": checks, "master": master is not None,
                                   "both": len(both), "with_off": len(with_off), "today": on.isoformat(),
                                   "switch": switch, "homes": homes}, default=str))
'''

RELAY = r'''
import base64, importlib.abc, importlib.util, json, os, pathlib, re, shutil, sys, tempfile, time, types
from datetime import date
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = {k: v for k, v in blob["server"].items() if not k.endswith(".json")}
DATA = tempfile.mkdtemp(prefix="my-calendar-relay-")
for k, v in blob["server"].items():
    if k.endswith(".json"):
        pathlib.Path(DATA, k).write_text(v)
os.environ["HUB_IST_CONFIG_DECLARATION_JSON"] = blob["server"].get("ist_config_defaults.json", "")
STUBS = {"google", "googleapiclient", "httpx", "httplib2", "google_auth_httplib2"}


class Stub(types.ModuleType):
    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return type(name, (), {})


MISSING = {t for t in STUBS if importlib.util.find_spec(t) is None}


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        if name in SRC:
            return importlib.util.spec_from_loader(name, self, origin="checkout:" + name)
        if name.split(".")[0] in MISSING:
            return importlib.util.spec_from_loader(name, self, origin="stub:" + name, is_package=True)
        return None

    def create_module(self, spec):
        return Stub(spec.name) if spec.name.split(".")[0] in MISSING else None

    def exec_module(self, module):
        if module.__name__.split(".")[0] in MISSING:
            return
        module.__file__ = os.path.join(DATA, module.__name__ + ".py")
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)


sys.path[:] = [p for p in sys.path if p not in ("", os.getcwd())]
sys.meta_path.insert(0, Checkout())

# psycopg2 as the relay calls it, on psycopg 3: client-side binding, read-only sessions, DDL skipped
import psycopg, psycopg.rows
from psycopg.conninfo import make_conninfo
pg2 = types.ModuleType("psycopg2")
extras = types.ModuleType("psycopg2.extras")
extensions = types.ModuleType("psycopg2.extensions")
_DDL = re.compile(r"^\s*(CREATE|ALTER|DROP|COMMENT)\b", re.I)
SKIPPED = {"ddl": 0}


class RealDictCursor:
    pass


class _Cursor:
    def __init__(self, conn, dict_rows):
        self._c = conn.cursor(row_factory=psycopg.rows.dict_row if dict_rows else psycopg.rows.tuple_row)

    def execute(self, query, params=None):
        if isinstance(query, str) and _DDL.match(query):
            SKIPPED["ddl"] += 1
            return None
        self._c.execute(query, params)

    def fetchone(self):
        return self._c.fetchone()

    def fetchall(self):
        return self._c.fetchall()

    @property
    def description(self):
        return self._c.description

    @property
    def rowcount(self):
        return self._c.rowcount

    @property
    def connection(self):
        return self._conn

    def close(self):
        self._c.close()

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        self.close()


class _Conn:
    def __init__(self, dsn, connect_timeout=5, **_kw):
        self._c = psycopg.connect(make_conninfo(dsn, options="-c default_transaction_read_only=on"), autocommit=True,
                                  connect_timeout=connect_timeout, cursor_factory=psycopg.ClientCursor)
        self.autocommit = True

    def cursor(self, cursor_factory=None, **_kw):
        cur = _Cursor(self._c, cursor_factory is RealDictCursor)
        cur._conn = self
        return cur

    def set_session(self, **_kw):
        pass

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        self._c.close()

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        self.close()


def connect(dsn=None, connection_factory=None, cursor_factory=None, **kw):
    return _Conn(dsn or kw.pop("dsn", ""), **kw)


extras.RealDictCursor = RealDictCursor
pg2.connect, pg2.extras, pg2.extensions = connect, extras, extensions
pg2.Error, pg2.OperationalError, pg2.InterfaceError = psycopg.Error, psycopg.OperationalError, psycopg.InterfaceError
sys.modules.update({"psycopg2": pg2, "psycopg2.extras": extras, "psycopg2.extensions": extensions})

PG_DSN = os.environ["MIRROR_DSN"]
CORE = "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg"
import effective_roster, house_directory, my_calendar, my_profile, my_work, shift_requests, time_off
from typing import Any
# STAND-INS, both sides alike: no published cells; the house directory as asa-hub-db holds it; one switch
effective_roster.published = lambda *a, **k: []
HOMES = blob["homes"]
house_directory.read = lambda dsn, now=None: dict(HOMES)
effective_roster.use_switch(lambda: dict(blob["switch"]))
ns = {"psycopg2": pg2, "PG_DSN": PG_DSN, "HUB_DB_SHEET_ID": CORE, "shift_requests": shift_requests, "Any": Any,
      "log": __import__("logging").getLogger("relay")}
exec(compile(blob["relay_code"], "snapshot_service_my_calendar", "exec"), ns)
on = date.fromisoformat(blob["today"])
out = {"answers": {}, "checks": {}, "took": {}, "ddl_skipped": 0}


def viewer(c):
    """_my_calendar_who: _requests_viewer, then the account's own keys read strictly."""
    name = ns["_roster_name_of"](c["uid"], strict=True)
    badges = ns["_user_badges"](c["uid"])
    who = shift_requests.viewer(PG_DSN, name=name, role=c["role"], types=badges, is_master=c["mode"] == "mass")
    me = my_work.identity(PG_DSN, CORE, c["uid"], roster_name=str(who.get("name") or ""))
    return who, me


def time_off_open(c, who):
    """_my_calendar_time_off_open over the case's gate."""
    if not c["gate"]:
        return {"open": False, "why": blob["gate_why"]}
    if time_off.refused_reader(who):
        return {"open": False, "why": "Time Off is the staff's screen."}
    return {"open": True, "why": ""}


for c in blob["cases"]:
    started = time.time()
    try:
        who, me = viewer(c)
        try:
            data = my_calendar.answer(PG_DSN, CORE, mode=c["mode"], me=me, who=who, person=c["person"],
                                      week=my_calendar.parse_week(c["week"], on), on=on, scope_why=c["why"],
                                      time_off_open=time_off_open(c, who))
            env = {"status": 200, "data": data}
        except my_profile.NoSuchPerson as exc:
            env = {"status": 404, "reason": "person", "message": str(exc)}
    except Exception as exc:
        env = {"error": type(exc).__name__ + ": " + str(exc)[:160]}
    out["answers"][c["tag"]] = json.loads(json.dumps(env, default=str))
    out["took"][c["tag"]] = round(time.time() - started, 2)
for c in blob["checks"]:
    try:
        who, me = viewer(c)
        try:
            data = my_calendar.check(PG_DSN, who, c["ref"], c["start"], c["end"], keys=me.get("keys") or [],
                                     on=on, person=c["person"], mode=c["mode"], core_sheet_id=CORE)
            env = {"status": 200, "data": data}
        except my_profile.NoSuchPerson as exc:
            env = {"status": 404, "reason": "person", "message": str(exc)}
        except time_off.Unreadable as exc:
            env = {"status": 503, "reason": "unreadable", "message": f"{exc} — the new dates were not checked."}
    except Exception as exc:
        env = {"error": type(exc).__name__ + ": " + str(exc)[:160]}
    out["checks"][c["tag"]] = json.loads(json.dumps(env, default=str))
out["ddl_skipped"] = SKIPPED["ddl"]
shutil.rmtree(DATA, True)
print("RELAY_RESULT " + json.dumps(out, default=str))
'''

COMPARE = APP_PRELUDE + r'''
import writes
checks, facts = [], {}


def check(name, ok, detail=""):
    checks.append([name, bool(ok), detail])


try:
    import my_calendar as MC
except Exception as exc:
    MC = None
    check("app/my_calendar.py imports", False, type(exc).__name__ + ": " + str(exc)[:160])
view_door = getattr(MC, "ACTIONS", {}).get("myCalendarView") if MC is not None else None
check_door = getattr(MC, "ACTIONS", {}).get("myCalendarCheck") if MC is not None else None
check("app/my_calendar.py declares the myCalendarView and myCalendarCheck reads",
      callable(view_door) and callable(check_door))
VOLATILE = {"read_at", "as_of"}


def js_json(v):
    if isinstance(v, float):
        return int(v) if v == int(v) and abs(v) < 1e15 else v
    if isinstance(v, dict):
        return {k: js_json(x) for k, x in v.items()}
    if isinstance(v, list):
        return [js_json(x) for x in v]
    return v


def norm(v):
    return json.loads(json.dumps(js_json(v), default=str, ensure_ascii=False))


def strip(v):
    if isinstance(v, dict):
        return {k: strip(x) for k, x in v.items() if k not in VOLATILE}
    if isinstance(v, list):
        return [strip(x) for x in v]
    return v


def diff(a, b, path="", out=None):
    out = [] if out is None else out
    if isinstance(a, dict) and isinstance(b, dict):
        if list(a) != list(b):
            out.append(path + ": keys")
        for k in a:
            if k in b:
                diff(a[k], b[k], path + "." + k, out)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(path + ": length")
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, f"{path}[{i}]", out)
    elif a != b:
        out.append(re.sub(r"\[\d+\]", "[]", path))
    return out


reads0 = L.Reads(db)
by_uid = {gsjs.str_(u.get("userid")): u for u in reads0.users() if not gsjs.str_(u.get("mergedinto"))}
said = {"on": bool(blob["switch"].get("on")), "readable": bool(blob["switch"].get("readable")),
        "why": str(blob["switch"].get("why") or "")}
ON = date.fromisoformat(blob["today"])
gated, states = [], {}


def user_of(c):
    row = by_uid.get(c["uid"])
    return sc.user_from_row(row) if row is not None else None


def payload_of(c, **more):
    p = {"mode": c["mode"], "why": c["why"], "person": c["person"], "week": c["week"], "today": blob["today"],
         "test_mode": said, "published": [],
         "time_off_open": {"open": c["gate"], "why": "" if c["gate"] else blob["gate_why"]}}
    p.update(more)
    return p


def ask(door, c, user, payload, builder):
    """The door as the relay calls it; past an App Control gate kept shut, the builder the relay runs past its own."""
    sess = L.Session(L.Reads(db), user)
    try:
        opened = sc.profile_app_gate(MC.APP_ID, user, sess.reads.scope_sources()).get("open") is True
        why = "" if opened else "shut"
    except sc.Defer as e:
        opened, why = False, str(e)[:80]
    if opened:
        return door(sess, payload)
    gated.append(f"{c['tag']} ({why})")
    with MC.relay_state.use(payload), MC.handed(payload):
        try:
            return {"status": 200, "data": builder(sess)}
        except MC.mw.Refused as exc:
            return dict(exc.env)


def view_builder(c, user, payload):
    return lambda s: MC.build(s, MC.scope_of(user, payload), c["person"], c["week"], payload["time_off_open"], ON)


answers = {}
for c in blob["cases"]:
    tag = c["tag"]
    relay = blob["relay"]["answers"].get(tag) or {}
    if relay.get("error"):
        check(f"{tag}: the relay's builder answered", False, relay["error"])
        continue
    if view_door is None:
        continue
    user = user_of(c)
    if user is None:
        check(f"{tag}: the account's users row is in asa-hub-db", False)
        continue
    payload = payload_of(c)
    started = time.time()
    try:
        env = ask(view_door, c, user, payload, view_builder(c, user, payload))
    except sc.Defer as e:
        check(f"{tag}: Python answered (no defer)", False, str(e)[:160])
        continue
    except Exception as e:
        check(f"{tag}: Python answered", False, type(e).__name__ + ": " + str(e)[:160])
        continue
    took = round(time.time() - started, 2)
    a, b = norm(relay), norm(env)
    answers[tag] = b
    paths = diff(strip(a), strip(b))
    check(f"{tag}: byte-identical to the relay's answer past the read stamps", not paths,
          f"{len(paths)} paths, first {sorted(set(paths))[:8]}")
    d = b.get("data") if isinstance(b.get("data"), dict) else {}
    if d:
        wk = d.get("week") or {}
        cards = sum(len(x.get("cards") or []) for x in wk.get("days") or [])
        marks = sum(len(k.get("marks") or []) for x in wk.get("days") or [] for k in x.get("cards") or [])
        req = d.get("requests") or {}
        states[tag] = (f"week {wk.get('head', {}).get('state')} ({cards} cards, {marks} marks, "
                       f"{sorted({x.get('state') for x in wk.get('days') or []})}), requests "
                       f"{req.get('state')} ({len(req.get('rows') or [])}), "
                       f"may_file {(d.get('form') or {}).get('may_file')}")
    else:
        states[tag] = f"status {b.get('status')}"
    facts[f"{tag} python took"] = f"{took}s (relay {blob['relay']['took'].get(tag)}s)"
facts["week / requests states"] = states
facts["answered past an App Control gate kept shut (the builder the relay runs past its own gate)"] = gated

for c in blob["checks"]:
    tag = c["tag"]
    relay = blob["relay"]["checks"].get(tag) or {}
    if relay.get("error"):
        check(f"{tag}: the relay's check answered", False, relay["error"])
        continue
    user = user_of(c)
    if check_door is None or user is None:
        continue
    payload = payload_of(c, ref=c["ref"], start=c["start"], end=c["end"])
    try:
        env = ask(check_door, c, user, payload,
                  lambda s: MC.check(s, MC.scope_of(user, payload), c["person"], c["ref"], c["start"], c["end"], ON))
    except sc.Defer as e:
        check(f"{tag}: Python checked (no defer)", False, str(e)[:160])
        continue
    paths = diff(norm(relay), norm(env))
    check(f"{tag}: the pencil's check byte-identical to the relay's", not paths, f"first {sorted(set(paths))[:8]}")
    facts[f"{tag} check"] = (f"ok={(env.get('data') or {}).get('ok')} "
                             f"refusals={len((env.get('data') or {}).get('refusals') or [])}")

# the door's own refusals, as the relay answers them
staff = next((c for c in blob["cases"] if c["tag"] == "S1"), None)
master = next((c for c in blob["cases"] if c["tag"] == "M"), None)
if view_door is not None and staff and master and user_of(staff) and user_of(master):
    su, mu = user_of(staff), user_of(master)
    sess = lambda u: L.Session(L.Reads(db), u)

    def door_or_defer(door, u, p):
        try:
            return door(sess(u), p)
        except sc.Defer as e:
            return {"defer": str(e)}

    got = door_or_defer(view_door, su, payload_of(staff, person="someone"))
    check("a person asked outside the master's scope, with no edition held, is refused 403 (or the gate defers)",
          (got.get("status") == 403 and got.get("message") == MC.MY_CALENDAR_OWN_ONLY) or "defer" in got,
          str(got)[:120])
    got = door_or_defer(view_door, mu, payload_of(master, person="<bad>"))
    check("a person the pattern refuses is refused 400", got.get("status") == 400, str(got.get("status")))
    got = door_or_defer(view_door, mu, payload_of(master, week="2026-13-40"))
    check("a week that is not a day is refused 400", got.get("status") == 400 and got.get("reason") == "week",
          str(got)[:120])
    got = door_or_defer(view_door, mu, payload_of(master, week="1999-01-04"))
    check("a week past the reach is refused 400", got.get("status") == 400 and got.get("reason") == "week",
          str(got)[:120])
    got = door_or_defer(view_door, mu, payload_of(master, member="someone"))
    check("a visit is refused 403", got.get("status") == 403 and got.get("reason") == "visit", str(got.get("status")))
    got = door_or_defer(view_door, mu, payload_of(master, mode="own", person="x"))
    check("the master asked for own rows is own: a person is refused 403", got.get("status") == 403,
          str(got.get("status")))
    got = door_or_defer(check_door, mu, payload_of(master, ref="nope", start="", end=""))
    check("the check refuses a ref that is not one 400", got.get("status") == 400, str(got.get("status")))
    got = door_or_defer(check_door, mu, payload_of(master, ref="TO0123456789", start="10/1/2026", end=""))
    check("the check refuses a day not written YYYY-MM-DD 400", got.get("status") == 400, str(got.get("status")))
    try:
        view_door(sess({**su, "is_service": True}), {})
        check("the service is deferred, never drawn", False)
    except sc.Defer:
        check("the service is deferred, never drawn", True)

# the any-person edition: a staff member on its list reads a chosen person's week as the master does
pick = next((c for c in blob["cases"] if c["tag"] == "M-P1"), None)
if view_door is not None and staff and pick and user_of(staff) and answers.get("M-P1"):
    import editions as ED
    if ED.edition_of(MC.EDITION) is None:
        # STAND-IN: the catalogue entry lands with the shared files
        ED._BY_ID[MC.EDITION] = {"id": MC.EDITION, "app": "my-calendar", "app_name": "My Calendar",
                                 "label": "stand-in", "description": "stand-in"}
        facts["the any-person edition in app/editions.py"] = "not yet (a stand-in entry for this check)"
    su = user_of(staff)

    def holder_door(key_on, person):
        reads = L.Reads(db)
        base = reads.config
        listed = json.dumps([{"id": MC.EDITION, "on": key_on, "people": [su["id"]]}])
        reads.config = lambda: {**base(), ED.EDITIONS_KEY: listed}
        sess = L.Session(reads, su)
        payload = payload_of(staff, person=person)
        try:
            if sc.profile_app_gate(MC.APP_ID, su, reads.scope_sources()).get("open") is not True:
                scope = MC.scope_of(su, payload, reads.config())
                if person and scope["mode"] != "mass":
                    return {"status": 403, "message": MC.MY_CALENDAR_OWN_ONLY}
                with MC.handed(payload):
                    return {"status": 200, "data": MC.build(sess, scope, person, staff["week"],
                                                            payload["time_off_open"], ON)}
            return view_door(sess, payload)
        except MC.mw.Refused as exc:
            return dict(exc.env)

    got = norm(holder_door(True, pick["person"]))
    d = got.get("data") or {}
    s = d.get("scope") or {}
    check("an edition holder is answered under the edition: mass, the person asked, the chooser",
          got.get("status") == 200 and s.get("mode") == "mass" and s.get("edition") == MC.EDITION
          and s.get("person") == pick["person"] and isinstance(s.get("people"), list) and s.get("people"),
          str({k: s.get(k) for k in ("mode", "edition")})[:160])
    m = answers["M-P1"].get("data") or {}
    check("the holder reads the same week as the master for that person",
          not diff(strip(m.get("week")), strip(d.get("week"))), "the week parts differ")
    rows = lambda x: [{k: v for k, v in r.items() if k != "may"} for r in ((x.get("requests") or {}).get("rows") or [])]
    check("the holder reads the same requests as the master for that person (what each may do aside)",
          rows(m) == rows(d), "the request rows differ")
    check("the master's answer names no edition", "edition" not in (m.get("scope") or {}))
    own_view = norm(holder_door(True, ""))
    od = own_view.get("data") or {}
    check("the holder's own calendar comes with the chooser, the week their own",
          (od.get("scope") or {}).get("mode") == "mass" and (od.get("person") or {}).get("own") is True
          and not diff(strip((answers.get("S1") or {}).get("data", {}).get("week")), strip(od.get("week"))),
          str((od.get("scope") or {}).get("mode")))
    got = norm(holder_door(False, pick["person"]))
    check("with the edition's key off the same ask is refused 403", got.get("status") == 403, str(got)[:120])

# the relay's state handed in the payload (HUB_MY_CALENDAR_SEND_STATE) answers as the read-only DSN does
import mw_relay_state as RS
import psycopg


def state_read():
    """_my_work_state_read's shape: each state table as {columns, types, rows}, a stamp or a day as ISO text."""
    tables = {}
    with psycopg.connect(os.environ["HUB_RELAY_RO_DSN"], autocommit=True, connect_timeout=5) as conn:
        cur = conn.cursor()
        for table in sorted(RS.TABLES | RS.META):
            cur.execute("SELECT to_regclass(%s) IS NOT NULL", (table,))
            if not cur.fetchone()[0]:
                continue
            cols = RS.COLUMNS.get(table)
            cur.execute(f"SELECT {', '.join(cols) if cols else '*'} FROM {table}")
            names = [d[0] for d in cur.description]
            types_, rows = {}, []
            for raw in cur.fetchall():
                row = list(raw)
                for i, v in enumerate(row):
                    if isinstance(v, datetime):
                        types_[names[i]], row[i] = "ts", v.isoformat()
                    elif isinstance(v, date):
                        types_[names[i]], row[i] = "date", v.isoformat()
                rows.append(row)
            tables[table] = {"columns": names, "types": types_, "rows": rows}
    return {"v": 1, "tables": tables}


if view_door is not None:
    try:
        state = json.loads(json.dumps(state_read(), default=str))
    except Exception as exc:
        state = None
        check("the relay's state tables could be read for the handed path", False, type(exc).__name__)
    for tag in ("S1", "M-P1"):
        c = next((x for x in blob["cases"] if x["tag"] == tag), None)
        if state is None or c is None or tag not in answers:
            continue
        payload = payload_of(c, relay_state=state)
        try:
            got = norm(ask(view_door, c, user_of(c), payload, view_builder(c, user_of(c), payload)))
        except sc.Defer as e:
            got = {"defer": str(e)[:160]}
        paths = diff(strip(answers[tag]), strip(got))
        check(f"{tag}: the relay's handed state answers byte for byte as the read-only DSN", not paths,
              f"first {sorted(set(paths))[:6]} {str(got.get('defer') or '')}")

# an edit kept in Postgres is on the calendar at once: one of the person's requests decided in app.edits' shape
target = next(((c, r) for c in blob["cases"] if c["tag"].startswith("S") and "-" not in c["tag"]
               for r in ((answers.get(c["tag"]) or {}).get("data") or {}).get("requests", {}).get("rows") or []
               if r.get("status") in ("pending", "needs_review", "scheduled")), None)
if view_door is not None and target is not None:
    c, row = target
    reads = L.Reads(db)
    sid = TO.house_id(reads)
    edit = {"sheet_id": sid, "tab_name": TO.TAB, "match": "id", "keyed": "header", "row_key": row["ref"],
            "appended": False, "field": "status", "value": "denied", "id": 1, "born": 1}
    token = hubdb.OWN.set(writes.Own([], book=db.book, edits=[edit], edits_at=time.time()))
    try:
        payload = payload_of(c)
        got = norm(ask(view_door, c, user_of(c), payload, view_builder(c, user_of(c), payload)))
    finally:
        hubdb.OWN.reset(token)
    hit = next((r for r in ((got.get("data") or {}).get("requests") or {}).get("rows") or []
                if r.get("ref") == row["ref"]), {})
    check("a time-off decision kept in Postgres (app.edits) is on the calendar at once",
          hit.get("status") == "denied" and hit.get("group") == "concluded",
          str({k: hit.get(k) for k in ("status", "group")}))
print(json.dumps({"checks": checks, "facts": facts}))
'''


def relay_code() -> str:
    """The relay's lines this check runs as the relay would: the roster name and the badges."""
    import ast
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    want = {"_roster_name_from", "_roster_name_of", "_user_badges"}
    parts = []
    for node in ast.parse(text).body:
        if isinstance(node, ast.FunctionDef) and node.name in want:
            parts.append(ast.get_source_segment(text, node) or "")
            want.discard(node.name)
    if want:
        raise RuntimeError(f"the relay lacks {sorted(want)}")
    return "\n\n".join(parts)


def static() -> int:
    failed = 0

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal failed
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1

    for f in ("app/my_calendar.py", "server/my_calendar.py"):
        try:
            py_compile.compile(str(ROOT / f), doraise=True)
            check(f"{f} compiles", True)
        except py_compile.PyCompileError as exc:
            check(f"{f} compiles", False, str(exc)[-300:])
    text = (ROOT / "app" / "my_calendar.py").read_text(encoding="utf-8")
    check("app/my_calendar.py reads no keeper copy, no file and no DSN: asa-hub-db and mw_relay_state only",
          "data->>" not in text and "asa_drive_sheets" not in text and "/srv/" not in text
          and "HUB_RELAY_RO_DSN" not in text and "MIRROR_DSN" not in text and "psycopg" not in text)
    check("app/my_calendar.py writes nothing (no insert, update or delete)",
          not re.search(r"\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b", text, re.I))
    return failed


def run(script: str, blob: dict, tag: str, timeout: int) -> dict | None:
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", RUNNER, "nice", "-n", "19", "python",
                          "-c", script], input=base64.b64encode(json.dumps(blob, default=str).encode()) + b"\n",
                         capture_output=True, timeout=timeout)
    out = got.stdout.decode()
    line = next((x for x in out.splitlines() if x.startswith(tag + " ")), "") if tag else \
        (out.strip().splitlines() or [""])[-1]
    if not line:
        print(f"FAIL the {tag or 'compare'} side ran in {RUNNER}")
        print(got.stderr.decode()[-2500:])
        return None
    return json.loads(line[len(tag) + 1:] if tag else line)


def main() -> int:
    print("STATIC")
    failed = static()
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    print(f"\nPICK — the cases, off asa-hub-db, in {RUNNER}")
    picked = run(PICK, {"app": app, "staff": STAFF, "chosen": CHOSEN, "mass_why": MASS_WHY}, "PICK_RESULT", 300)
    if picked is None:
        return 1
    cases, checks = picked["cases"], picked["checks"]
    print(f"fact cases: {len(cases)} ({sum(1 for c in cases if c['tag'].startswith('S'))} staff own, "
          f"{sum(1 for c in cases if c['mode'] == 'mass')} master), {len(checks)} checks; staff drawn on a calendar "
          f"with time off: {picked['both']}, on the roster with time off: {picked['with_off']}; houses in the "
          f"directory: {len(picked['homes'])}; switch on: {picked['switch'].get('on')}")
    if not picked["master"]:
        print("FAIL the master's users row is not in asa-hub-db")
        failed += 1
    print(f"\nRELAY — server/my_calendar.py over the relay's copy (read-only role), in {RUNNER}")
    server = lane_schema.with_imports(ROOT / "server", ("my_calendar",))
    relay = run(RELAY, {"server": server, "relay_code": relay_code(), "cases": cases, "checks": checks,
                        "homes": picked["homes"], "switch": picked["switch"], "today": picked["today"],
                        "gate_why": GATE_WHY}, "RELAY_RESULT", BUDGET_S)
    if relay is None:
        return 1
    print(f"fact relay DDL statements skipped (read-only role): {relay.get('ddl_skipped')}")
    print(f"\nPYTHON — app/my_calendar.py through myCalendarView / myCalendarCheck with the relay's payload, "
          f"in {RUNNER}")
    res = run(COMPARE, {"app": app, "cases": cases, "checks": checks, "relay": relay, "switch": picked["switch"],
                        "today": picked["today"], "gate_why": GATE_WHY}, "", BUDGET_S)
    if res is None:
        return 1
    for name, ok, detail in res["checks"]:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1
    for k, v in res["facts"].items():
        print(f"fact {k}: {v}")
    print(f"\n{'all ok' if not failed else f'{failed} failed'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
