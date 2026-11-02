#!/usr/bin/env python3
"""My Calendar on Python (app/my_calendar.py, through app/my_calendar_writes.py) against the relay's builder
(server/my_calendar.py), both run read-only in asa-hub-db-sync with the modules streamed in: ten staff in their own
scope, the master's own week and chosen people, the pencil's check, the vacation route, and the edition (the master,
a person not listed, a listed one, a person's own calendar). The relay side reads the relay's copy through the
read-only role (MIRROR_DSN); the Python side reads asa-hub-db, and the relay's tables through the same role as
HUB_RELAY_RO_DSN. Both are handed the same published cells, test mode switch and Time Off gate, as the relay hands
them. First the relay's own lines are run as the relay runs them (lifted, stubs around): the switch entry, the gate,
the lane's Python call, both doors and the copy marks. Nothing is written anywhere. Prints counts, states and paths,
never a person's values."""
from __future__ import annotations

import __future__
import ast
import asyncio
import base64
import json
import py_compile
import re
import subprocess
import sys
import types
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import lane_schema  # noqa: E402

RUNNER = "asa-hub-db-sync"
STAFF = 10
CHOSEN_PEOPLE = 3
CHECK_ROWS = 2
BUDGET_S = 900
EDITION = "myCalendar.anyone"
MASS_WHY = ("Signed in as the master account: your own calendar, or any person's you choose; a request you add "
            "there is filed for them, by you.")
# the catalogue entry, laid in for the run when app/editions.py does not carry it yet
EDITION_ROW = {"id": EDITION, "app": "my-calendar", "app_name": "My Calendar",
               "label": "Any person's calendar — open it and file their time off",
               "description": "Works while My Calendar runs on Python, read from the Hub's database."}

# the app side: the modules streamed in, a fake web layer, asa-hub-db read-only, the relay's tables read-only
APP_PRELUDE = r'''
import base64, hashlib, importlib.abc, importlib.util, json, os, re, sys, time, types
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
# the relay's tables through its read-only role, as HUB_RELAY_RO_DSN reads them in asa-hub-app
os.environ["HUB_RELAY_RO_DSN"] = make_conninfo(os.environ["MIRROR_DSN"], options="-c default_transaction_read_only=on")
import gsjs, hubdb, locations as L, scope as sc
import my_work as MW
CORE = MW.CORE_USERS_SHEET_ID
db = hubdb.HubDb()


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
staff = [u for u in users if live(u) and u is not master
         and MW._low(u.get("role")) not in ("client", "guardian", "onboarding", "interviewer")]
on_roster = sorted((u for u in staff if MW.fold(u.get("display_name")) in named), key=lambda u: sha(u["user_id"]))
off_roster = sorted((u for u in staff if u not in on_roster), key=lambda u: sha(u["user_id"]))
chosen = (on_roster[:blob["staff"] - 2] + off_roster[:2] + on_roster[blob["staff"] - 2:])[:blob["staff"]]
by_uid = {gsjs.str_(u.get("userid")): u for u in reads.users() if not gsjs.str_(u.get("mergedinto"))}


def gate(uid, role):
    """The filing doors' gate as the relay hands it (Time Off's, else My Calendar's): open, or the words it is shut
    with."""
    row = by_uid.get(uid)
    if row is None:
        return {"open": False, "why": "no users row"}
    user = sc.user_from_row(row)
    if role in MC.TIME_OFF_ROLES_REFUSED:
        return {"open": False, "why": f"Time Off is not served to the {role} role here."}
    try:
        got = sc.profile_app_gate("timeoff", user, reads.scope_sources())
        if got.get("open") is not True and sc.profile_app_gate("my-calendar", user,
                                                                reads.scope_sources()).get("open") is True:
            got = {"open": True}
    except sc.Defer as e:
        return {"open": False, "why": str(e)[:80]}
    return ({"open": True, "why": ""} if got.get("open") is True
            else {"open": False, "why": str((got.get("scope") or {}).get("why") or "Time Off is not open to you.")})


cases = []
for i, u in enumerate(chosen):
    uid, role = str(u["user_id"]), MW._low(u.get("role"))
    cases.append({"tag": f"S{i + 1}", "uid": uid, "role": role, "mode": "own", "why": "", "person": "",
                  "gate": gate(uid, role), "roster": MW._text(next((r.get("id") for r in roster
                                                                   if MW.fold(r.get("name")) == MW.fold(u.get("display_name"))), ""), 120)})
ids = sorted({MW._text(r.get("id"), 120) for r in roster} - {""}, key=sha)
if master is not None:
    m = {"uid": str(master["user_id"]), "role": "admin", "mode": "mass", "why": blob["mass_why"]}
    m["gate"] = gate(m["uid"], "admin")
    cases.append({**m, "tag": "M", "person": ""})
    for i, p in enumerate(ids[:blob["people"]]):
        cases.append({**m, "tag": f"M-P{i + 1}", "person": p})
    cases.append({**m, "tag": "M-P?", "person": "no such roster row"})
try:
    homes = MC.house_directory.read(reads)
except Exception as exc:
    homes = {}
print("PICK_RESULT " + json.dumps({"cases": cases, "master": master is not None, "on_roster": len(on_roster),
                                   "people": ids[:blob["people"] + 4], "week": MC.week_of(MC.today())[0].isoformat(),
                                   "homes": homes}, default=str))
'''

RELAY = r'''
import base64, importlib.abc, importlib.util, json, os, pathlib, re, shutil, sys, tempfile, time, types
from datetime import date, datetime, timedelta
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

# psycopg2 as the relay calls it, on psycopg 3: client-side binding, read-only sessions
import psycopg, psycopg.rows
from psycopg.conninfo import make_conninfo
pg2 = types.ModuleType("psycopg2")
extras = types.ModuleType("psycopg2.extras")
extensions = types.ModuleType("psycopg2.extensions")


class RealDictCursor:
    pass


_DDL = re.compile(r"^\s*(CREATE|ALTER|DROP|COMMENT)\b", re.I)
SKIPPED = {"ddl": 0}


class _Cursor:
    def __init__(self, conn, dict_rows):
        self._c = conn.cursor(row_factory=psycopg.rows.dict_row if dict_rows else psycopg.rows.tuple_row)
        self.connection = conn

    def execute(self, query, params=None):
        # a table the builder makes on first use already stands: its DDL is skipped, the session stays read-only
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
        cur.connection = self
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
import effective_roster, house_directory, my_calendar, my_profile, my_work, shift_requests, shift_slices, time_off
from typing import Any

# the relay's directory table is not the read-only role's: both builders read asa-hub-db's entity_homes
house_directory.read = lambda _dsn, now=None: {k: dict(v) for k, v in blob["homes"].items()}


class Log:
    def warning(self, *_a, **_k):
        pass
    info = warning


ns = {"psycopg2": pg2, "PG_DSN": PG_DSN, "HUB_DB_SHEET_ID": CORE, "shift_requests": shift_requests, "Any": Any,
      "log": Log()}
exec(compile(blob["relay_code"], "snapshot_service_my_calendar", "exec"), ns)
mon = date.fromisoformat(blob["week"])
sun = mon + timedelta(days=6)
out = {"answers": {}, "took": {}, "checks": [], "facts": {}}
# the cells just published or held, off the relay's own edits table as _my_calendar_published reads them; a role that
# may not read it hands none, and both builders lay and mark the same none
try:
    with pg2.connect(PG_DSN) as conn, conn.cursor() as cur:
        published = [r for r in effective_roster.published(cur) if r.get("pending") or r.get("test_mode")]
    out["facts"]["published cells"] = f"{len(published)} flagged, read off asa_house_calendar_edits"
except Exception as exc:
    published = []
    out["facts"]["published cells"] = ("none: the read-only role reads no asa_house_calendar_edits "
                                       f"({type(exc).__name__}), so both sides are handed none")
_read_published = effective_roster.published


def handed_published(cur=None, day_from=None, day_to=None, *, location=None, held=None):
    return [dict(r) for r in published if (day_from is None or str(r["col_iso"]) >= day_from.isoformat())
            and (day_to is None or str(r["col_iso"]) <= day_to.isoformat())
            and (location is None or r["location"] == location)]


# the relay's builder reads exactly the cells Python is handed
effective_roster.published = handed_published
if not published:
    # none readable: one cell laid on each staff case's own week (a just-published change, a cell held by test mode,
    # a rehearsal square), handed to both builders alike, so the laying and the marks are compared as well
    view = shift_requests.estate(PG_DSN, fresh=True)
    kinds = (("published", True, False, False), ("test_mode", True, True, False), ("test_mode", True, True, True))
    for c in (x for x in blob["cases"] if x["mode"] == "own"):
        try:
            name = ns["_roster_name_of"](c["uid"], strict=True)
            keys = set(my_work.identity(PG_DSN, CORE, c["uid"], roster_name=str(name or "")).get("keys") or [])
        except Exception:
            continue
        hit = next(((loc, emp, iso, text) for loc in view["locations"]
                    for (emp, iso), text in sorted((view["cells"].get(loc) or {}).items())
                    if shift_requests.fold(emp) in keys and mon.isoformat() <= iso <= sun.isoformat()
                    and shift_slices.classify(text) and shift_slices.classify(text)["kind"] not in ("off", "ro")), None)
        if hit is None:
            continue
        loc, emp, iso, text = hit
        stage, pending, held, played = kinds[len(published) % 3]
        published.append({"id": 900000 + len(published), "location": loc, "employee": emp, "col_iso": iso,
                          "value": "7A-3P" if stage == "published" else text, "at": None, "actor": "", "via": "",
                          "mirror_at": None, "pending": pending, "test_mode": held, "rehearsal": played})
    shift_requests._ESTATE.update(at=0.0, view=None)
    out["facts"]["published cells"] += f"; {len(published)} laid on the staff cases' weeks for this run"
out["published"] = [{k: (v.isoformat() if isinstance(v, (date, datetime)) else v) for k, v in r.items()}
                    for r in published]
out["test_mode"] = effective_roster.test_mode_said()
on = my_calendar.today()


def opened(gate, who):
    """_my_calendar_time_off_open past the gate the relay handed: the staff's screen alone."""
    if not gate["open"]:
        return {"open": False, "why": gate["why"]}
    if time_off.refused_reader(who):
        return {"open": False, "why": "Time Off is the staff's screen."}
    return {"open": True, "why": ""}


def env_of(fn):
    try:
        return {"status": 200, "data": fn()}
    except my_profile.NoSuchPerson as exc:
        return {"status": 404, "reason": "person", "message": str(exc)}
    except time_off.Unreadable as exc:
        return {"status": 503, "reason": "unreadable", "message": f"{exc} — the new dates were not checked."}


for c in blob["cases"]:
    started = time.time()
    try:
        name = ns["_roster_name_of"](c["uid"], strict=True)
        badges = ns["_user_badges"](c["uid"])
        who = shift_requests.viewer(PG_DSN, name=name, role=c["role"], types=badges, is_master=c["mode"] == "mass")
        me = my_work.identity(PG_DSN, CORE, c["uid"], roster_name=str(who.get("name") or ""))
        env = env_of(lambda: my_calendar.answer(PG_DSN, CORE, mode=c["mode"], me=me, who=who, person=c["person"],
                                                week=mon, on=on, scope_why=c["why"],
                                                time_off_open=opened(c["gate"], who)))
        rows = (((env.get("data") or {}).get("requests") or {}).get("rows") or [])
        picked = [r for r in rows if r.get("start") and r.get("end")][:blob["check_rows"]]
        for i, r in enumerate(picked):
            a, b = date.fromisoformat(r["start"]), date.fromisoformat(r["end"])
            for kind, s, e in (("on file", a, b), ("a day later", a + timedelta(days=1), b + timedelta(days=1))):
                ask = {"tag": f"{c['tag']}-R{i + 1} {kind}", "case": c["tag"], "ref": r["ref"],
                       "start": s.isoformat(), "end": e.isoformat()}
                ask["env"] = env_of(lambda: my_calendar.check(PG_DSN, who, ask["ref"], ask["start"], ask["end"],
                                                              keys=me.get("keys") or [], person=c["person"],
                                                              mode=c["mode"], core_sheet_id=CORE))
                out["checks"].append(ask)
        if c["tag"] == "S1":
            ask = {"tag": "S1 no such ref", "case": "S1", "ref": "TO0000000000", "start": on.isoformat(),
                   "end": on.isoformat()}
            ask["env"] = env_of(lambda: my_calendar.check(PG_DSN, who, ask["ref"], ask["start"], ask["end"],
                                                          keys=me.get("keys") or [], person="", mode="own",
                                                          core_sheet_id=CORE))
            out["checks"].append(ask)
    except Exception as exc:
        env = {"error": type(exc).__name__ + ": " + str(exc)[:160]}
    out["answers"][c["tag"]] = json.loads(json.dumps(env, default=str))
    out["took"][c["tag"]] = round(time.time() - started, 2)
out["checks"] = json.loads(json.dumps(out["checks"], default=str))
out["facts"]["DDL skipped on the relay side"] = SKIPPED["ddl"]
shutil.rmtree(DATA, True)
print("RELAY_RESULT " + json.dumps(out, default=str))
'''

COMPARE = APP_PRELUDE + r'''
import json as _json
checks, facts = [], {}


def check(name, ok, detail=""):
    checks.append([name, bool(ok), detail])


def said(env):
    """A failed check's detail: the status and the reason alone, never a person's values."""
    env = env if isinstance(env, dict) else {}
    return "defer" if "defer" in env else f"status {env.get('status')}, reason {env.get('reason')}"


try:
    import my_calendar as MC
    import my_calendar_writes as MCW
except Exception as exc:
    MC = MCW = None
    check("app/my_calendar.py and app/my_calendar_writes.py import", False, type(exc).__name__ + ": " + str(exc)[:160])
import editions as ED
import mw_relay_state as RS
if ED.edition_of(blob["edition"]) is None:
    # the catalogue entry this branch returns for app/editions.py, laid in for the run
    ED.CATALOGUE = ED.CATALOGUE + (blob["edition_row"],)
    ED.IDS = tuple((e["id"], e["app"]) for e in ED.CATALOGUE)
    ED._BY_ID[blob["edition"]] = blob["edition_row"]
    facts["the edition in app/editions.py"] = "not yet (laid in for this run; its entry lands with the shared files)"
import mw_roster as MR
ER = MR.effective_roster
if MC is not None and not hasattr(ER, "use_published"):
    # the hook app/my_calendar.py binds the relay's published cells through, laid in for the run while the roster
    # translation does not carry it: the estate lays them and the week marks them
    import contextlib, contextvars
    _cells = contextvars.ContextVar("handed_published", default=None)
    _orig_published = ER.published

    @contextlib.contextmanager
    def _use_published(cells):
        token = _cells.set(cells)
        try:
            yield
        finally:
            _cells.reset(token)

    def _published(src=None, day_from=None, day_to=None, *, location=None, held=None):
        cells = _cells.get()
        if cells is None:
            return _orig_published(src, day_from, day_to, location=location, held=held)
        return [dict(c) for c in cells if (day_from is None or str(c.get("col_iso") or "") >= day_from.isoformat())
                and (day_to is None or str(c.get("col_iso") or "") <= day_to.isoformat())
                and (location is None or c.get("location") == location)]

    ER.use_published = staticmethod(_use_published)
    ER.published = staticmethod(_published)
    facts["effective_roster.use_published in app/mw_roster.py"] = "missing (laid in for this run: without it every read defers)"
door = (MC.ACTIONS.get("myCalendarView") if MC else None)
chk = (MC.ACTIONS.get("myCalendarCheck") if MC else None)
route = MCW.READS.get("myCalendarVacationRoute") if MCW else None
check("the lane's two reads (app/my_calendar.py) and the vacation route (app/my_calendar_writes.py) are declared",
      callable(door) and callable(chk) and callable(route))
pol = {**(MC.POLICY if MC else {}), **(MCW.READ_POLICY if MCW else {})}
check("their policy takes everything the relay hands in (person, week, published, test mode, the Time Off gate, ref)",
      set((pol.get("myCalendarView") or {}).get("params") or {})
      >= {"person", "mode", "why", "week", "today", "published", "test_mode", "time_off_open"}
      and set((pol.get("myCalendarCheck") or {}).get("params") or {})
      >= {"person", "mode", "why", "ref", "start", "end", "today", "published", "test_mode"}
      and (pol.get("myCalendarVacationRoute") or {}).get("roles") == ("admin", "director", "manager", "staff"))
check("the doors the page sends, read to their leaf: the reads on Python; Time Off's notice doors on the relay; the "
      "vacation filing Support Requests' on Python",
      MCW is not None and {d: v["where"] for d, v in MCW.DOORS.items()} == {
          "myCalendarView": "python", "myCalendarCheck": "python", "myCalendarVacationRoute": "python",
          "/hub-lanes/time-off/request": "relay", "/hub-lanes/time-off/withdraw": "relay",
          "myCalendarVacationFile": "python"})
check("no write store: every edit on these pages is Time Off's or Apps Script's, none kept in app.edits",
      MCW is not None and not hasattr(MCW, "Store") and not hasattr(MCW, "ACTIONS"))
try:
    import main
    routed = main.APPS.get("my-calendar")
    if routed is None:
        facts["app/main.py routes my-calendar"] = "not yet (its APPS entry lands with the shared files)"
    else:
        check("app/main.py routes my-calendar to app/my_calendar.py, the vacation route laid into its reads",
              routed is MC and MC.ACTIONS.get("myCalendarVacationRoute") is route
              and (MC.POLICY.get("myCalendarVacationRoute") or {}).get("roles") == MCW.READ_POLICY[
                  "myCalendarVacationRoute"]["roles"])
        check("the relay's payload passes main's policy gate for a staff session",
              main.policy_gate(MC, "myCalendarView", {"mode": "own", "why": "", "person": "", "week": blob["week"],
                                                     "published": [], "test_mode": {}, "time_off_open": {}},
                               {"role": "staff"}) is None)
except Exception as exc:
    facts["app/main.py imports"] = type(exc).__name__ + ": " + str(exc)[:120]
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
    return _json.loads(_json.dumps(js_json(v), default=str, ensure_ascii=False))


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
relay = blob["relay"]
gated, states = [], {}


def user_of(c):
    row = by_uid.get(c["uid"])
    return sc.user_from_row(row) if row is not None else None


def payload_of(c, **extra):
    return {"mode": c["mode"], "why": c["why"], "person": c["person"], "week": blob["week"],
            "time_off_open": c["gate"], "published": relay["published"], "test_mode": relay["test_mode"], **extra}


def session(user, config=None):
    reads = L.Reads(db)
    if config is not None:
        base = reads.config()
        reads.config = lambda: {**base, **config}
    return L.Session(reads, user)


def ask(c, user, payload, fn, config=None, tag=""):
    """The door as the relay calls it; past a gate App Control keeps shut, the builder the relay runs past its own."""
    sess = session(user, config)
    try:
        opened = sc.profile_app_gate(MC.APP_ID, user, sess.reads.scope_sources()).get("open") is True
        why = "" if opened else "shut"
    except sc.Defer as e:
        opened, why = False, str(e)[:80]
    if opened:
        return fn(sess, payload)
    gated.append(f"{tag or c['tag']} ({why})")
    with RS.use(payload), MC.handed(payload):
        scope = MC.scope_of(user, payload, sess.reads.config())
        person = payload.get("person") or ""
        if person and scope["mode"] != MC.MODE_MASS:
            return {"status": 403, "reason": "scope", "message": MC.MY_CALENDAR_OWN_ONLY}
        try:
            if fn is chk:
                return {"status": 200, "data": MC.check(sess, scope, person, payload["ref"], payload["start"],
                                                        payload["end"], MC.today_of(payload))}
            return {"status": 200, "data": MC.build(sess, scope, person, payload["week"], payload["time_off_open"],
                                                    MC.today_of(payload))}
        except MC.mw.Refused as exc:
            return dict(exc.env)


def answered(tag, fn):
    try:
        return fn()
    except sc.Defer as e:
        check(f"{tag}: Python answered (no defer)", False, str(e)[:160])
    except Exception as e:
        check(f"{tag}: Python answered", False, type(e).__name__ + ": " + str(e)[:160])
    return None


cases = {c["tag"]: c for c in blob["cases"]}
python_env = {}
for c in blob["cases"]:
    tag = c["tag"]
    want = relay["answers"].get(tag) or {}
    if want.get("error"):
        check(f"{tag}: the relay's builder answered", False, want["error"])
        continue
    user = user_of(c)
    if door is None or user is None:
        check(f"{tag}: the account's users row is in asa-hub-db", user is not None)
        continue
    if c["mode"] == "mass" and not sc.is_real_master(user):
        check(f"{tag}: the master's users row is the master in asa-hub-db", False)
        continue
    started = time.time()
    env = answered(tag, lambda: ask(c, user, payload_of(c), door))
    if env is None:
        continue
    python_env[tag] = env
    took = round(time.time() - started, 2)
    a, b = norm(want), norm(env)
    paths = diff(strip(a), strip(b))
    check(f"{tag}: byte-identical to the relay's answer past the read stamp", not paths,
          f"{len(paths)} paths, first {sorted(set(paths))[:8]}")
    d = b.get("data") if isinstance(b.get("data"), dict) else {}
    states[tag] = (f"{(d.get('week') or {}).get('head', {}).get('state')}/{(d.get('requests') or {}).get('state')} "
                   f"({len((d.get('requests') or {}).get('rows') or [])} requests, may file "
                   f"{(d.get('form') or {}).get('may_file')})") if d else f"status {b.get('status')}"
    facts[f"{tag} python took"] = f"{took}s (relay {relay['took'].get(tag)}s)"
facts["week / requests states"] = states
laid = [m["kind"] for e in python_env.values() for day in ((e.get("data") or {}).get("week") or {}).get("days") or []
        for card in day.get("cards") or [] for m in card.get("marks") or []
        if m.get("kind") in ("pending_publish", "test_mode", "rehearsal")]
facts["handed cells marked on Python's cards"] = {k: laid.count(k) for k in sorted(set(laid))} or "none"
if relay["published"]:
    check("the handed cells reach Python's estate and marks (effective_roster.use_published)", bool(laid),
          f"{len(relay['published'])} handed")

# the pencil's check, ask by ask
same = 0
for k in relay["checks"]:
    c = cases[k["case"]]
    user = user_of(c)
    if chk is None or user is None:
        continue
    env = answered(k["tag"], lambda: ask(c, user, payload_of(c, ref=k["ref"], start=k["start"], end=k["end"]), chk,
                                         tag=k["tag"]))
    if env is None:
        continue
    paths = diff(norm(k["env"]), norm(env))
    check(f"check {k['tag']}: identical to the relay's", not paths, f"{sorted(set(paths))[:6]}")
    same += not paths
facts["checks compared"] = f"{same} of {len(relay['checks'])} identical"
facts["answered past an App Control gate kept shut (the builder the relay runs past its own gate)"] = gated

# the edition: the master always, nobody listed by default, a listed holder at once, a person's own calendar theirs
staff = next((c for c in blob["cases"] if c["tag"].startswith("S") and (python_env.get(c["tag"]) or {}).get("status") == 200
              and ((python_env[c["tag"]].get("data") or {}).get("person") or {}).get("name")), None)
master = cases.get("M")
others = [p for p in blob["people"] if not staff or p != staff.get("roster")]
target = others[0] if others else ""
if door is not None and staff and master and target and user_of(staff) and user_of(master):
    su, mu = user_of(staff), user_of(master)
    plain = {"mode": "own", "why": "", "person": target, "week": blob["week"], "time_off_open": staff["gate"],
             "published": relay["published"], "test_mode": relay["test_mode"]}
    own_ask = {**plain, "person": ""}
    listed = {ED.EDITIONS_KEY: _json.dumps([{"id": blob["edition"], "on": True, "people": [str(su["id"])]}])}
    unlisted = {ED.EDITIONS_KEY: _json.dumps([{"id": blob["edition"], "on": True, "people": []}])}
    keyoff = {ED.EDITIONS_KEY: _json.dumps([{"id": blob["edition"], "on": False, "people": [str(su["id"])]}])}

    def run(user, payload, config, fn=door):
        sess = session(user, config)
        try:
            return fn(sess, payload)
        except sc.Defer as e:
            return {"defer": str(e)[:120]}

    for label, cfg in (("nobody listed (the key on)", unlisted), ("listed with the key off", keyoff),
                       ("the config as it stands", None)):
        got = run(su, plain, cfg)
        check(f"edition — {label}: another person's calendar is refused 403 (or App Control defers to the relay)",
              (got.get("status") == 403 and got.get("message") == MC.MY_CALENDAR_OWN_ONLY) or "defer" in got,
              said(got))
    got = run(su, plain, listed)
    d = got.get("data") or {}
    sc_ = d.get("scope") or {}
    check("edition — a listed holder opens another person's calendar: widened to any person, said under the edition",
          ("defer" in got) or (got.get("status") == 200 and sc_.get("mode") == "mass" and sc_.get("edition") == blob["edition"]
                               and sc_.get("person") == target and isinstance(sc_.get("people"), list)
                               and (d.get("person") or {}).get("own") is False),
          str({k: sc_.get(k) for k in ("mode", "edition")})[:160] if "defer" not in got else got["defer"])
    if "defer" in got:
        facts["edition holder"] = "App Control keeps My Calendar shut to the picked staff member: the relay answers"
    else:
        form = d.get("form") or {}
        facts["edition holder's form on the chosen person"] = (f"may file {form.get('may_file')}"
                                                              + (f" ({form.get('may_file_why')[:60]})" if form.get("may_file_why") else ""))
        own = run(su, own_ask, listed)
        osc = (own.get("data") or {}).get("scope") or {}
        check("edition — a holder's own read carries the chooser, and stays their own calendar",
              own.get("status") == 200 and osc.get("edition") == blob["edition"] and osc.get("person") == ""
              and ((own.get("data") or {}).get("person") or {}).get("own") is True, said(own))
        base = python_env.get(staff["tag"]) or {}
        if base.get("status") == 200:
            a = norm({k: v for k, v in (base.get("data") or {}).items() if k not in ("scope", "read_at")})
            b = norm({k: v for k, v in (own.get("data") or {}).items() if k not in ("scope", "read_at")})
            paths = diff(a, b)
            check("edition — a holder's own week, requests and form are their plain own answer's, byte for byte",
                  not paths, f"{sorted(set(paths))[:6]}")
        if staff.get("roster"):
            mine = run(su, {**plain, "person": staff["roster"]}, listed)
            check("edition — a holder choosing their own roster row reads their own calendar (own stays theirs)",
                  mine.get("status") != 200 or ((mine.get("data") or {}).get("person") or {}).get("own") is True,
                  said(mine))
        k = next((x for x in relay["checks"] if x["case"].startswith("M-P") and cases[x["case"]]["person"] == target),
                 {"ref": "TO0000000000", "start": blob["week"], "end": blob["week"]})
        got = run(su, {**plain, "ref": k["ref"], "start": k["start"], "end": k["end"]}, listed, chk)
        check("edition — a holder's pencil check on the chosen person's request is answered (Time Off still decides it)",
              got.get("status") == 200 and isinstance((got.get("data") or {}).get("refusals"), list), said(got))
        got = run(su, {**plain, "ref": k["ref"], "start": k["start"], "end": k["end"]}, unlisted, chk)
        check("edition — and refused 403 for a person not listed", got.get("status") == 403, said(got))
    got = run(mu, {**plain, "mode": "mass", "why": master["why"]}, unlisted)
    msc = (got.get("data") or {}).get("scope") or {}
    check("edition — the master opens any person's calendar with nobody listed, never said under an edition",
          got.get("status") == 200 and msc.get("mode") == "mass" and "edition" not in msc, str(msc.get("mode")))
    try:
        got = run(su, {**plain, "member": "someone"}, listed)
        check("a visit is refused 403, whatever the editions", got.get("status") == 403 and got.get("reason") == "visit",
              said(got))
    except Exception as e:
        check("a visit is refused 403, whatever the editions", False, type(e).__name__)
else:
    check("the edition cases could be picked (a staff member, the master and another roster row)", False,
          f"staff {bool(staff)}, master {bool(master)}, target {bool(target)}")

# the vacation route: each branch on fakes, then the ten staff off asa-hub-db
if route is not None:
    class FakeDb:
        def __init__(self, moved):
            self.moved = moved

        def house_moved(self, tab):
            return tab in self.moved

    class FakeReads:
        def __init__(self, cfg, moved=("sched_flows", "sched_inbox")):
            self.cfg, self.db = cfg, FakeDb(set(moved))

        def config(self):
            return self.cfg

    flows = [{"id": "SF1", "kind": "time_off", "state": "waiting", "date": "2026-11-02", "date_to": "", "person_key": "annlee",
              "source_ref": "my-calendar", "seats": _json.dumps([{"seat": "director", "by": "", "at": "", "note": ""}])},
             {"id": "SF2", "kind": "time_off", "state": "declined", "date": "2026-11-09", "date_to": "2026-11-10",
              "person_key": "annlee", "source_ref": "my-calendar",
              "seats": _json.dumps([{"seat": "lead"}, {"seat": "director", "by": "Dee", "at": "x", "note": "n"}])},
             {"id": "SF3", "kind": "time_off", "state": "waiting", "date": "2026-11-02", "person_key": "bob",
              "source_ref": "my-calendar", "seats": "[]"},
             {"id": "SF4", "kind": "time_off", "state": "waiting", "date": "2026-11-02", "person_key": "annlee",
              "source_ref": "", "seats": "not json"},
             {"id": "SF5", "kind": "swap", "state": "waiting", "date": "2026-11-02", "person_key": "annlee",
              "source_ref": "my-calendar", "seats": ""}]
    real = (MCW.SCH.key_of, MCW.SCH.read_tab)
    MCW.SCH.key_of = lambda _r, u, _uid: "annlee" if u.get("display_name") == "Ann Lee" else ""
    MCW.SCH.read_tab = lambda _r, _t: [dict(f) for f in flows]
    ann = {"id": "u-1", "role": "staff", "display_name": "Ann Lee"}
    try:
        def go(user, cfg, moved=("sched_flows", "sched_inbox")):
            return route(L.Session(FakeReads(cfg, moved), user), {})
        on = {MCW.AUTO_TIME_OFF_KEY: "yes"}
        got = go(ann, {MCW.AUTO_TIME_OFF_KEY: "no"})
        check("route: the switch off answers off, Time Off's door", got == {"status": 200, "data": {
            "on": False, "readable": True, "why": MCW.ROUTE_OFF, "mine": []}}, str(got)[:160])
        got = go(ann, on, moved=("sched_flows",))
        check("route: Scheduling's houses not set up answers unreadable, Time Off's door",
              (got.get("data") or {}).get("readable") is False and got["data"]["why"] == MCW.ROUTE_NO_SCHED)
        got = go({**ann, "display_name": "Twin"}, on)
        check("route: an account not matched to one calendar person answers Time Off's door",
              got.get("data") == {"on": False, "readable": True, "why": MCW.ROUTE_NO_KEY, "mine": []})
        got = go(ann, on)
        mine = (got.get("data") or {}).get("mine") or []
        check("route: on, only the caller's own time off filed from My Calendar, in the flows' order, the director's "
              "seat read off a malformed list as nothing",
              got.get("data", {}).get("on") is True and [m["flow_id"] for m in mine] == ["SF1", "SF2"]
              and mine[0] == {"flow_id": "SF1", "from": "2026-11-02", "to": "2026-11-02", "state": "waiting",
                              "word": "Waiting on the directors", "decided_by": "", "decided_at": "", "note": ""}
              and mine[1]["decided_by"] == "Dee" and mine[1]["to"] == "2026-11-10" and mine[1]["word"] == "Declined",
              str(mine)[:200])
        got = go({**ann, "visiting_member": "m"}, on)
        check("route: a visit is refused 403", got.get("status") == 403)
        got = go({**ann, "id": ""}, on)
        check("route: no account id is the unknown action", got == {"status": 404, "message": MCW.UNKNOWN})
        try:
            go({"is_service": True, "role": "admin"}, on)
            check("route: the service defers", False)
        except sc.Defer:
            check("route: the service defers", True)
    finally:
        MCW.SCH.key_of, MCW.SCH.read_tab = real
    per_staff = {}
    for c in blob["cases"]:
        if not c["tag"].startswith("S"):
            continue
        user = user_of(c)
        if user is None:
            continue
        got = answered(f"route {c['tag']}", lambda: route(L.Session(L.Reads(db), user), {}))
        if got is None:
            continue
        d = got.get("data") or {}
        ok = got.get("status") == 200 and list(d) == ["on", "readable", "why", "mine"]
        check(f"route {c['tag']}: answered whole off asa-hub-db", ok, said(got))
        per_staff[c["tag"]] = f"on {d.get('on')}, {len(d.get('mine') or [])} filed" if ok else f"status {got.get('status')}"
    cfg = L.Reads(db).config()
    facts["route switch"] = ("set in the config" if MCW.AUTO_TIME_OFF_KEY in cfg else "the catalogue's default") + \
        f": {'on' if MCW.auto_time_off(L.Reads(db)) else 'off'}"
    facts["route per staff"] = per_staff
print(_json.dumps({"checks": checks, "facts": facts}))
'''


def relay_code() -> str:
    """The relay's lines the builder side runs as the relay would: the roster name and the badges."""
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

    for f in ("app/my_calendar.py", "app/my_calendar_writes.py", "app/mw_roster.py", "server/my_calendar.py",
              "server/snapshot_service.py"):
        try:
            py_compile.compile(str(ROOT / f), doraise=True)
            check(f"{f} compiles", True)
        except py_compile.PyCompileError as exc:
            check(f"{f} compiles", False, str(exc)[-300:])
    text = (ROOT / "app" / "my_calendar_writes.py").read_text(encoding="utf-8")
    check("app/my_calendar_writes.py writes nothing (no insert, update or delete, no kept edit)",
          not re.search(r"\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b", text, re.I)
          and "W.final" not in text and "kept_record" not in text)
    check("app/my_calendar_writes.py reads no relay table and no file of its own (mw_relay_state alone)",
          "HUB_RELAY_RO_DSN" not in text and "MIRROR_DSN" not in text and "/srv/" not in text)
    base = subprocess.run(["git", "-C", str(ROOT), "merge-base", "HEAD", "asa_dev"], capture_output=True, text=True)
    touched = subprocess.run(["git", "-C", str(ROOT), "diff", "--name-only", base.stdout.strip() or "asa_dev", "--",
                              "apps-script"], capture_output=True, text=True).stdout.split()
    check("no Apps Script file is changed", not touched, str(touched[:5]))
    ts = (ROOT / "src" / "pages" / "features" / "mycalendar" / "useMyCalendar.ts").read_text(encoding="utf-8")
    check("the page draws the chooser for an edition holder's answer as for the master's",
          "s.mode === 'mass' || Boolean(s.edition)" in ts)
    return failed


def lifted(text: str) -> dict[str, ast.AST]:
    nodes: dict[str, ast.AST] = {}
    for node in ast.parse(text).body:
        name = (node.name if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                else getattr(node.targets[0], "id", None) if isinstance(node, ast.Assign)
                else getattr(node.target, "id", None) if isinstance(node, ast.AnnAssign) else None)
        if name:
            nodes[name] = node
    return nodes


def relay_wiring() -> int:
    """The relay's own lines, lifted and run: the switch entry, the gate, the lane's Python call, the doors, the marks."""
    failed = 0

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal failed
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1

    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    nodes = lifted(text)

    class Clock:
        now = 1_900_000_000.0

        def time(self) -> float:
            return self.now

    clock = Clock()
    calls: list = []

    class Log:
        def warning(self, *_a, **_k):
            calls.append({"warned": True})

        info = warning

    ns: dict = {"Any": object, "re": re, "json": json, "time": clock, "os": __import__("os"), "asyncio": asyncio,
                "urllib": urllib, "HUB_APP_TIMEOUT_S": 10.0, "HUB_APP_PACK_TIMEOUT_S": 60.0,
                "_APP_PACK_CLIENTS": "client-profiles", "_APP_PACK_STAFF_TEAM": "staff-team",
                "_APP_PACK_SSAS": "ssa-profiles", "_APP_PACK_FAMILIES": "family-profiles",
                "_APP_PACK_CANDIDATES": "candidates", "_APP_PACK_LEADS": "leads", "SCHEDULING_EVENT": "scheduling",
                "VEHICLE_CALENDAR_EVENT": "vehicle-calendar", "EMERGENCY_CONTACTS_EVENT": "emergency-contacts",
                "_APP_PACK_WATCHED": frozenset(), "_APP_PACK_PEOPLE_WRITES": frozenset(), "_APP_PACK_VERBS": frozenset(),
                "_APP_PACK_PEOPLE_RESOURCES": frozenset(), "_app_pack_people_at": [0.0],
                "_app_pack_swept": {}, "_app_pack_void": {}, "_app_pack_touched": {}, "_backend_own": {},
                "_backend_final_at": {}, "_app_pack_apps_of": lambda action, raw: set(), "log": Log()}
    names = ("BACKEND_APPS", "_BACKEND_ACTIONS", "_BACKEND_WRITES", "_BACKEND_FINAL", "RELAY_NO_RECEIPT_ACTIONS",
             "RELAY_BYTE_READS", "_BACKEND_EDITION_APPS", "_relay_json_constant", "_relay_envelope",
             "APP_PACK_HEAD_BYTES", "_app_pack_upload_envelope", "_app_pack_write_of", "_APP_PACK_PYTHON_BEHIND",
             "_app_pack_rang_write", "BACKEND_OWN_SLACK_S", "_backend_final_covers", "_backend_copy_at",
             "_backend_written_after", "_MY_CALENDAR_DOWN", "_MY_CALENDAR_ROLES_REFUSED", "_MY_CALENDAR_NO_REQUESTS",
             "_MY_CALENDAR_VISIT", "_MY_CALENDAR_OWN_ONLY", "_MY_CALENDAR_DAY", "MY_CALENDAR_APP",
             "MY_CALENDAR_PYTHON_READ", "MY_CALENDAR_PYTHON_CHECK", "MY_CALENDAR_SEND_STATE",
             "MY_CALENDAR_PYTHON_TIMEOUT_S", "_MY_CALENDAR_KEYS", "_MY_CALENDAR_CHECK_KEYS", "_MY_CALENDAR_EDITIONS",
             "_MY_CALENDAR_EDITION_REFUSALS", "_MY_CALENDAR_UNCHECKED", "_my_calendar_on",
             "_MY_CALENDAR_PUBLISHED_HELD", "MY_CALENDAR_PUBLISHED_HOLD_S", "_my_calendar_handed",
             "_my_calendar_python", "_TIME_OFF_FILERS", "_time_off_gate",
             "_my_calendar_gate", "lane_my_calendar", "lane_my_calendar_check")
    missing = [n for n in names if n not in nodes]
    check("the relay carries every line this check runs", not missing, str(missing))
    if missing:
        return failed

    class Route:
        def get(self, *_a, **_k):
            return lambda fn: fn

    ns.update(app=Route(), Header=lambda default="": default, Response=object, HUB_DB_SHEET_ID="core")
    for n in names:
        exec(compile(ast.Module(body=[nodes[n]], type_ignores=[]), "snapshot_service.py", "exec",
                     flags=__future__.annotations.compiler_flag, dont_inherit=True), ns)
    apps, reads, writes = ns["BACKEND_APPS"], ns["_BACKEND_ACTIONS"], ns["_BACKEND_WRITES"]
    mc = apps.get("my-calendar") or {}
    check("Settings › Back-end per app lists My Calendar: its lane, the two lane reads and the vacation route, no write",
          mc.get("label") == "My Calendar" and mc.get("lane") == "/hub-lanes/my-calendar"
          and mc.get("reads") == {"myCalendarView", "myCalendarCheck", "myCalendarVacationRoute"}
          and mc.get("lane_reads") == {"myCalendarView", "myCalendarCheck"} and not mc.get("writes")
          and "pack" not in mc, str(mc)[:200])
    check("the lane's reads are never routed from /gas; the vacation route is, under My Calendar's switch",
          "myCalendarView" not in reads and "myCalendarCheck" not in reads
          and reads.get("myCalendarVacationRoute") == "my-calendar")
    check("no write the page sends is My Calendar's: the vacation filing is routed to Support Requests' Python",
          writes.get("myCalendarVacationFile") == "support-desk"
          and not any(app == "my-calendar" for app in writes.values()))
    check("the vacation route is a no-receipt read, never a byte read",
          "myCalendarVacationRoute" in ns["RELAY_NO_RECEIPT_ACTIONS"]
          and "myCalendarVacationRoute" not in ns["RELAY_BYTE_READS"])
    check("My Calendar's edition is offered only while My Calendar runs on Python",
          ns["_BACKEND_EDITION_APPS"].get("my-calendar") == "my-calendar")
    check("the edition the relay accepts an answer under is the catalogue's one", ns["_MY_CALENDAR_EDITIONS"] == {EDITION})

    # the copy marks: a vacation filed or decided on Apps Script sends the route back to Apps Script for a while
    def form(action: str, payload: dict) -> bytes:
        return urllib.parse.urlencode({"body": json.dumps({"action": action, "token": "t", "payload": payload})}).encode()

    swept, rang = ns["_app_pack_swept"], ns["_app_pack_rang_write"]
    ok200, no409 = b'{"status": 200, "data": {}}', b'{"status": 409, "data": {}}'
    for action in ("myCalendarVacationFile", "supportDeskDecide", "schedulingAnswer", "schedulingWithdraw"):
        swept.clear()
        clock.now += 10
        rang(action, form(action, {}), ok200)
        check(f"{action} landing marks My Calendar's copy behind", swept.get("my-calendar") == clock.now, str(swept))
    swept.clear()
    rang("myCalendarVacationFile", form("myCalendarVacationFile", {}), no409)
    rang("myCalendarVacationRoute", form("myCalendarVacationRoute", {}), ok200)
    check("a refused filing and the route's own read mark nothing", "my-calendar" not in swept, str(swept))
    clock.now += 10
    rang("myCalendarVacationFile", form("myCalendarVacationFile", {}), ok200)
    after = ns["_backend_written_after"]
    check("a Python route read whose copy predates the mark goes back to Apps Script; one read after it answers",
          after("my-calendar", "", clock.now - 1, None) and not after("my-calendar", "", clock.now + 1, None))

    # the lane's Python call: asked with the scope the relay decided, its answer taken only when it keeps that scope
    state = {"wanted": True, "settling": False, "answer": None}

    async def wanted(app_id: str) -> bool:
        return state["wanted"] and app_id == "my-calendar"

    async def call(app_id, action, payload, user, extra=None, timeout=None):
        calls.append({"app": app_id, "action": action, "payload": payload, "user": user, "timeout": timeout})
        return None if state["answer"] is None else (b"", 0.0, state["answer"], None, 0.0)

    ns.update(_backend_wanted=wanted, _backend_settling=lambda: state["settling"], _backend_call=call,
              _traffic_note=lambda *_a: None, my_work=types.SimpleNamespace(MODE_MASS="mass", MODE_OWN="own"),
              _my_work_state_read=lambda: {"v": 1, "tables": {}})
    own = {"mode": "own", "why": ""}
    mass = {"mode": "mass", "why": MASS_WHY}

    def answer(mode: str, person: str = "", whose: bool = True, edition: str = "", drop: str = "",
               status: int = 200, reason: str = "") -> dict:
        scope = {"mode": mode, "why": "", "person": person}
        if edition:
            scope["edition"] = edition
        data = {"scope": scope, "person": {"own": whose, "name": "", "key_why": ""}, "today": "t", "week": {},
                "requests": {}, "form": {}, "test_mode": {}, "read_at": "x"}
        data.pop(drop, None)
        return {"status": status, "data": data} if status == 200 else {"status": status, "reason": reason,
                                                                          "message": "m"}

    def ask(scope: dict, person: str = "", session=("staff", "u-1"), action="myCalendarView", **more) -> dict | None:
        calls.clear()
        return asyncio.run(ns["_my_calendar_python"](session, scope, action, {"person": person, **more}))

    state["wanted"] = False
    check("off Python the relay's own builder answers, and Python is not asked", ask(own) is None and not calls)
    state.update(wanted=True, settling=True)
    check("while App Control settles the relay's own builder answers", ask(own) is None and not calls)
    state.update(settling=False, answer=answer("own"))
    got = ask(own, week="2026-10-12")
    sent = next((c for c in calls if c.get("action")), {})
    check("on Python, myCalendarView is asked with exactly the scope, person and week the relay decided",
          got is not None and sent.get("app") == "my-calendar" and sent.get("action") == "myCalendarView"
          and sent.get("payload") == {"mode": "own", "why": "", "person": "", "week": "2026-10-12"}
          and sent.get("user") == {"uid": "u-1", "role": "staff", "is_master": False}
          and sent.get("timeout") == ns["MY_CALENDAR_PYTHON_TIMEOUT_S"], str(sent)[:200])
    for label, ans in (("another person's calendar", answer("own", whose=False)),
                       ("the master's scope", answer("mass")),
                       ("a scope widened under an unknown edition", answer("mass", edition="other.edition")),
                       ("a missing part", answer("own", drop="form")),
                       ("a refusal", answer("own", status=404, reason="person"))):
        state["answer"] = ans
        check(f"own scope: Python's answer with {label} is not taken (the relay's builder answers)", ask(own) is None)
    state["answer"] = None
    check("Python deferring or failing: the relay's builder answers", ask(own) is None and len(calls) == 1)
    state["answer"] = answer("mass", edition=EDITION)
    check("a holder's own read, widened under the edition with nobody chosen, is taken", ask(own) is not None)
    state["answer"] = answer("mass", person="P-1", whose=False)
    got = ask(mass, person="P-1", session=("admin", "u-m"))
    sent = next((c for c in calls if c.get("action")), {})
    check("the master's chosen person: asked as the master, taken when it is that person",
          got is not None and sent.get("user", {}).get("is_master") is True
          and sent.get("payload", {}).get("person") == "P-1")
    state["answer"] = answer("mass", person="P-2", whose=False)
    check("the master's chosen person: another person's answer is not taken", ask(mass, person="P-1") is None)
    # an edition's ask: a person outside the master's scope, which only Python decides
    state["answer"] = answer("mass", person="P-1", whose=False, edition=EDITION)
    got = ask(own, person="P-1")
    check("an edition's ask: Python's answer widened under the edition for that person is taken",
          got is not None and got["data"]["scope"]["edition"] == EDITION)
    state["answer"] = answer("mass", person="P-2", whose=False, edition=EDITION)
    check("an edition's ask: another person's answer is not taken", ask(own, person="P-1") is None)
    state["answer"] = answer("own", person="P-1", whose=False)
    check("an edition's ask: an answer not said under the edition is not taken", ask(own, person="P-1") is None)
    state["answer"] = answer("own", status=403, reason="scope")
    got = ask(own, person="P-1")
    check("an edition's ask: Python's refusal is the answer (nobody listed is refused, never shown their own week)",
          got == {"status": 403, "reason": "scope", "message": "m"}, str(got))
    state["answer"] = answer("own", status=503, reason="unreadable")
    check("an edition's ask: any other failure is no answer (the door says it could not be checked)",
          ask(own, person="P-1") is None)
    state["answer"] = {"status": 200, "data": {"ref": "TO1", "start": "", "end": "", "days": 0, "dates": "", "ok": False,
                                               "refusals": []}}
    check("the check: Python's answer for that ref is taken", ask(own, action="myCalendarCheck", ref="TO1") is not None)
    check("the check: an answer for another ref is not", ask(own, action="myCalendarCheck", ref="TO2") is None)
    state["answer"] = {"status": 200, "data": {"ref": "TO1"}}
    check("the check: an answer missing its parts is not", ask(own, action="myCalendarCheck", ref="TO1") is None)

    # the gate: a person outside the master's scope passes only towards Python, never for a client-role session
    gate_state = {"mode": "own", "family": False}

    async def no_wait(*_a, **_k):
        return ""

    async def actor(*_a, **_k):
        return ("staff", "u-1")

    ns.update(my_calendar=object(), my_profile=types.SimpleNamespace(PERSON_RE=re.compile(r"[\w .:@'’-]{1,120}")),
              time_off=object(), PG_DSN="dsn", _my_calendar_session=no_wait, _my_work_learn_master=no_wait,
              _hotline_actor=actor, _daily_refusal=lambda a: a,
              _my_calendar_scope=lambda *_a: {"mode": gate_state["mode"], "why": ""},
              _my_family_session=lambda _a: gate_state["family"])

    def gate(person: str) -> object:
        return asyncio.run(ns["_my_calendar_gate"]("Bearer t", "", person))

    state.update(wanted=False)
    got = gate("P-1")
    check("the gate: another person outside the master's scope while My Calendar is not on Python: 403 own only",
          isinstance(got, dict) and got.get("status") == 403 and got.get("message") == ns["_MY_CALENDAR_OWN_ONLY"])
    state.update(wanted=True)
    check("the gate: on Python, it passes towards Python, which decides the edition", isinstance(gate("P-1"), tuple))
    gate_state["family"] = True
    got = gate("P-1")
    check("the gate: a client-role session asking for a person is refused 403 as before",
          isinstance(got, dict) and got.get("status") == 403)
    gate_state["family"] = False
    check("the gate: a person the pattern refuses is refused 400 first", (gate("<bad>") or {}).get("status") == 400)
    on_python = isinstance(gate(""), tuple)
    state.update(wanted=False)
    check("the gate: the caller's own calendar passes as before, on Python or not",
          on_python and isinstance(gate(""), tuple))
    state.update(wanted=True)

    # the doors, run whole with stubs: Python first, the builder below, an edition's ask never kept nor built here
    seen: dict = {"kept": 0, "built": 0, "asked": []}
    door_state = {"scope": {"mode": "own", "why": ""}, "python": None}

    async def gate_stub(_auth, _member, _person):
        return dict(door_state["scope"]), ("staff", "u-1")

    async def python_stub(_session, _scope, action, ask_):
        seen["asked"].append((action, dict(ask_)))
        return door_state["python"]

    async def who_stub(_auth):
        seen["built"] += 1
        return {"name": "N"}, ("staff", "u-1"), {"keys": []}

    async def kept_stub(read, _auth, params, mode, _actor, build):
        seen["kept"] += 1
        return await build()

    async def opened_stub(*_a):
        return {"open": True, "why": ""}

    class BadWeek(ValueError):
        pass

    from datetime import date as _date

    cal = types.SimpleNamespace(today=lambda: _date(2026, 10, 13), parse_week=lambda w, on: _date(2026, 10, 12),
                                BadWeek=BadWeek, answer=lambda *a, **k: {"built": True},
                                check=lambda *a, **k: {"checked": True})
    ns.update(_my_calendar_gate=gate_stub, _my_calendar_python=python_stub, _my_calendar_who=who_stub,
              _lane_kept=kept_stub, _my_calendar_time_off_open=opened_stub, my_calendar=cal,
              effective_roster=types.SimpleNamespace(test_mode_said=lambda: {"on": False, "readable": True, "why": ""}),
              _my_calendar_published=lambda: [{"col_iso": "2026-10-12"}], _TIME_OFF_ROLES_REFUSED=(),
              my_profile=types.SimpleNamespace(NoSuchPerson=LookupError, PERSON_RE=re.compile(".*")),
              time_off=types.SimpleNamespace(REF_RE=re.compile(r"\bTO[0-9A-F]{10}\b"), Unreadable=RuntimeError))

    class Resp:
        headers: dict = {}

    def view(person: str = "") -> dict:
        seen.update(kept=0, built=0, asked=[])
        return asyncio.run(ns["lane_my_calendar"](Resp(), member="", person=person, week="", authorization="Bearer t"))

    def check_door(person: str = "") -> dict:
        seen.update(kept=0, built=0, asked=[])
        return asyncio.run(ns["lane_my_calendar_check"](Resp(), member="", person=person, ref="TO0123456789",
                                                       start="2026-11-02", end="2026-11-03",
                                                       authorization="Bearer t"))

    door_state["python"] = {"status": 200, "data": {"py": True}}
    got = view()
    sent = seen["asked"][0][1] if seen["asked"] else {}
    check("the lane: on Python it answers with Python's, kept, the builder never run",
          got == {"status": 200, "data": {"py": True}} and seen["kept"] == 1 and seen["built"] == 0)
    check("the lane hands the week's Monday, today, the published cells, test mode and Time Off's gate",
          sent.get("week") == "2026-10-12" and sent.get("today") == "2026-10-13"
          and sent.get("published") == [{"col_iso": "2026-10-12"}] and sent.get("test_mode", {}).get("on") is False
          and sent.get("time_off_open") == {"open": True, "why": ""}, str(sent)[:200])
    read_n = {"n": 0}

    def published_stub() -> list:
        read_n["n"] += 1
        return [{"col_iso": "2026-10-12"}]

    ns["_my_calendar_published"] = published_stub
    ns["_MY_CALENDAR_PUBLISHED_HELD"].update(at=0.0, rows=None)
    view()
    view()
    first = read_n["n"]
    clock.now += ns["MY_CALENDAR_PUBLISHED_HOLD_S"] + 1
    view()
    check("the published cells are read once for reads close together, and again once the hold is past",
          first == 1 and read_n["n"] == 2, str((first, read_n["n"])))
    door_state["python"] = None
    got = view()
    check("the lane: Python answering nothing, the relay's builder answers as before",
          got == {"status": 200, "data": {"built": True}} and seen["built"] == 1)
    got = view(person="P-1")
    check("an edition's ask Python cannot answer is said unchecked, never built here, never kept",
          got == ns["_MY_CALENDAR_UNCHECKED"] and seen["built"] == 0 and seen["kept"] == 0)
    door_state["python"] = {"status": 200, "data": {"py": "P-1"}}
    got = view(person="P-1")
    check("an edition's ask Python answers is that answer, never kept", got["data"] == {"py": "P-1"} and seen["kept"] == 0)
    state.update(wanted=False)
    door_state["python"] = {"status": 200, "data": {"py": True}}
    got = view()
    check("off Python the lane is never asked: no published read, no gate, the builder answers",
          seen["asked"] == [] and got == {"status": 200, "data": {"built": True}})
    state.update(wanted=True)
    door_state["python"] = {"status": 200, "data": {"py": "check"}}
    got = check_door()
    check("the check door asks Python first with the ref, the days, the published cells and test mode, and takes it",
          got["data"] == {"py": "check"} and seen["asked"][0][0] == "myCalendarCheck"
          and seen["asked"][0][1].get("ref") == "TO0123456789" and seen["built"] == 0
          and seen["asked"][0][1].get("published") == [{"col_iso": "2026-10-12"}]
          and "test_mode" in seen["asked"][0][1])
    door_state["python"] = None
    got = check_door()
    check("the check door: Python answering nothing, the relay's builder checks", got == {"status": 200, "data": {"checked": True}})
    got = check_door(person="P-1")
    check("the check door: an edition's ask Python cannot answer is said unchecked",
          got == ns["_MY_CALENDAR_UNCHECKED"] and seen["built"] == 0)
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
    print("\nRELAY WIRING — the relay's My Calendar lines, run as the relay runs them")
    failed += relay_wiring()
    if "--wiring" in sys.argv:
        print(f"\n{'all ok' if not failed else f'{failed} failed'}")
        return 1 if failed else 0
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    print(f"\nPICK — the cases, off asa-hub-db, in {RUNNER}")
    picked = run(PICK, {"app": app, "staff": STAFF, "people": CHOSEN_PEOPLE, "mass_why": MASS_WHY}, "PICK_RESULT", 300)
    if picked is None:
        return 1
    cases = picked["cases"]
    print(f"fact cases: {len(cases)} ({sum(1 for c in cases if c['tag'].startswith('S'))} staff own, "
          f"{sum(1 for c in cases if c['mode'] == 'mass')} master); staff on the roster by name: {picked['on_roster']}; "
          f"week {picked['week']}")
    if not picked["master"]:
        print("FAIL the master's users row is not in asa-hub-db")
        failed += 1
    print(f"\nRELAY — server/my_calendar.py over the relay's copy (read-only role), in {RUNNER}")
    server = lane_schema.with_imports(ROOT / "server", ("my_calendar",))
    print(f"fact house directory: {len(picked['homes'])} houses off asa-hub-db's entity_homes, handed to both builders "
          "(the relay's own table is not the read-only role's)")
    relay = run(RELAY, {"server": server, "relay_code": relay_code(), "cases": cases, "week": picked["week"],
                        "check_rows": CHECK_ROWS, "homes": picked["homes"]}, "RELAY_RESULT", BUDGET_S)
    if relay is None:
        return 1
    for k, v in relay.get("facts", {}).items():
        print(f"fact {k}: {v}")
    print(f"\nPYTHON — app/my_calendar.py through app/my_calendar_writes.py with the relay's payload, in {RUNNER}")
    res = run(COMPARE, {"app": app, "cases": cases, "relay": relay, "week": picked["week"], "people": picked["people"],
                        "edition": EDITION, "edition_row": EDITION_ROW}, "", BUDGET_S)
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
