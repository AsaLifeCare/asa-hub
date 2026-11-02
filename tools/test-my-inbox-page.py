#!/usr/bin/env python3
"""My Inbox's page on Python (app/my_inbox.py, its read) against the relay's builder (server/my_inbox.py), both run
read-only in asa-hub-db-sync with the modules streamed in: ten people in their own scope, the master's own inbox and
three people the master chooses, one case with test mode on, each built over the same read marks (the relay's own
rows, plus marks this check lays on three of each person's alerts). The relay side reads the relay's copy through the
read-only role (MIRROR_DSN) and the copies the relay built (people, candidates, clients, prospects, the punch board),
taken read-only from asa-hub-snapshot; the Python side reads asa-hub-db, and the relay's own tables through
mw_relay_state on that same role. Stand-ins, on both sides alike: one bell answer, one test mode switch, the hotline
lanes as asa-hub-db holds them, the house directory as asa-hub-db holds it, no published cells, Settings read off
asa-hub-db, the access copy vouching, and first sightings kept in memory (nothing is written). Prints counts, states
and paths, never a person's values."""
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
RELAY_HOST = "asa-hub-snapshot"
STAFF = 10
CHOSEN = 3
BUDGET_S = 900
MASS_WHY = "Signed in as the master account: your own alerts, or any person's you choose, read-only."

DUMP = r'''
import base64, json, os
import psycopg2
base = os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")
out = {"slices": {}, "board": None, "board_error": "", "reads": [], "seen": [], "why": ""}
for n in ("people", "candidates", "clients", "potentialClients"):
    try:
        out["slices"][n] = open(os.path.join(base, n + ".json"), encoding="utf-8").read()
    except FileNotFoundError:
        out["slices"][n] = None
path = os.getenv("HUB_PSI_PUNCH_BOARD") or os.path.join(base, ".psi-punch-board.json")
try:
    out["board"] = open(path, encoding="utf-8").read()
except FileNotFoundError:
    out["board_error"] = "missing"
conn = psycopg2.connect(os.environ["HUB_SNAPSHOT_PG_DSN"], connect_timeout=5)
conn.set_session(readonly=True, autocommit=True)
with conn.cursor() as cur:
    cur.execute("select to_regclass('asa_hub_inbox_reads') is not null, to_regclass('asa_hub_inbox_seen') is not null")
    has_reads, has_seen = cur.fetchone()
    if has_reads:
        cur.execute("select user_id, alert_key, read_at, dismissed_at from asa_hub_inbox_reads")
        out["reads"] = [{"user_id": a, "alert_key": b, "read_at": c.isoformat() if c else None,
                         "dismissed_at": d.isoformat() if d else None} for a, b, c, d in cur.fetchall()]
    if has_seen:
        cur.execute("select kind, key, first_seen from asa_hub_inbox_seen")
        out["seen"] = [{"kind": a, "key": b, "first_seen": c.isoformat() if c else None} for a, b, c in cur.fetchall()]
conn.close()
print("DUMP_RESULT " + base64.b64encode(json.dumps(out).encode()).decode())
'''

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
CORE = MW.CORE_USERS_SHEET_ID
db = hubdb.HubDb()
# STAND-IN, both sides alike: asa_house_calendar_edits is not granted to the read-only role, so no published cells
mw_roster.effective_roster.published = staticmethod(lambda *a, **k: [])


def sha(v):
    return hashlib.sha1(str(v).encode()).hexdigest()


def houses_loaded(books):
    """When asa-hub-db last loaded each house of alerts: a house that moves mid-check explains a difference."""
    ptrs = books.pointers()
    out = {}
    for p in (MW.PTR_SCHED_INBOX, MW.PTR_SUPPORT_INBOX, MW.PTR_VC_INBOX):
        ref = db.tab(ptrs.get(p, ""), MW.HOUSE_TAB) if ptrs.get(p) else None
        out[p] = str(ref.loaded_at) if ref is not None else ""
    return out
'''

PICK = APP_PRELUDE + r'''
import my_inbox as MI
reads = L.Reads(db)
books = MW.HubBooks(reads)
users = [u for u in books.users_rows(CORE, "", ()) if isinstance(u, dict)]


def live(u):
    return MW._live(u) and str(u.get("user_id") or "").strip() and MW.fold(u.get("display_name"))


master = next((u for u in users if live(u) and MW._low(u.get("email")) == sc.MASTER_ACCOUNT
               and MW._low(u.get("role")) == "admin"), None)
staff = [u for u in users if live(u) and u is not master and MW._low(u.get("role")) in MI.ACCOUNT_ROLES]
order = lambda u: sha(u["user_id"])
leads = sorted((u for u in staff if MW._low(u.get("role")) != "staff"), key=order)
plain = sorted((u for u in staff if MW._low(u.get("role")) == "staff"), key=order)
chosen = (leads[:4] + plain)[:blob["staff"]]
switch = mw_roster.effective_roster.switch_from_config(reads)
cfg = reads.config()
cases = []
for i, u in enumerate(chosen):
    cases.append({"tag": f"S{i + 1}", "uid": str(u["user_id"]), "role": MW._low(u.get("role")), "mode": "own",
                  "why": "", "person": "", "switch": {"on": False, "readable": True, "word": "off", "why": ""}})
if cases:
    cases.append({**cases[0], "tag": "S1-held", "switch": {"on": True, "readable": True, "word": "on", "why": ""}})
    # the same people with every source shown, so each source's head is compared too
    shown = {"my_work_hide": {p: False for p in MW.HIDE_PARTS}}
    cases += [{**c, "tag": c["tag"] + "-shown", "hide": shown} for c in list(cases)
              if re.fullmatch(r"S\d+", c["tag"])]
off = []
if master is not None:
    m = {"uid": str(master["user_id"]), "role": "admin", "mode": "mass", "why": blob["mass_why"],
         "switch": {"on": False, "readable": True, "word": "off", "why": ""}}
    cases.append({**m, "tag": "M", "person": ""})
    people = MI.people_list(MI.accounts(books))
    for i, p in enumerate(sorted(people, key=lambda p: sha(p["uid"]))[:blob["chosen"]]):
        cases.append({**m, "tag": f"M-P{i + 1}", "person": p["uid"]})
    off = MI.alerts_off(reads, str(master["user_id"]))
lanes = MW.lanes_for(books, MW.MY_WORK_LANES)
homes = mw_roster.house_directory.read(reads)
print("PICK_RESULT " + json.dumps({
    "cases": cases, "master": master is not None, "switch": switch, "homes": homes, "lanes": lanes,
    "cut": sc.list_cell(cfg.get(sc.MYWORK_APPS_KEY)), "seen_list": sc.list_cell(cfg.get(sc.MYWORK_APPS_SEEN_KEY)),
    "hide": MW.hide_lane(reads), "alerts_off": off, "now": datetime.now(timezone.utc).isoformat(),
    "houses": houses_loaded(books)}, default=str))
'''

RELAY = r'''
import ast, base64, importlib.abc, importlib.util, json, os, pathlib, re, shutil, sys, tempfile, time, types
from datetime import date, datetime, timezone
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = {k: v for k, v in blob["server"].items() if not k.endswith(".json")}
DATA = tempfile.mkdtemp(prefix="my-inbox-relay-")
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
        return _Cursor(self._c, cursor_factory is RealDictCursor)

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
# psycopg2.sql as the DDL paths compose it: plain text, which the cursor above then skips
pgsql = types.ModuleType("psycopg2.sql")


class _SQL(str):
    def format(self, *a, **k):
        return str.format(self, *[str(x) for x in a])


pgsql.SQL, pgsql.Identifier = _SQL, (lambda *parts: ".".join(parts))
pg2.connect, pg2.extras, pg2.extensions, pg2.sql = connect, extras, extensions, pgsql
pg2.Error, pg2.OperationalError, pg2.InterfaceError = psycopg.Error, psycopg.OperationalError, psycopg.InterfaceError
sys.modules.update({"psycopg2": pg2, "psycopg2.extras": extras, "psycopg2.extensions": extensions,
                    "psycopg2.sql": pgsql})

PG_DSN = os.environ["MIRROR_DSN"]
CORE = "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg"
import effective_roster, house_directory, hotline_desk, my_inbox, my_work, shift_requests
from typing import Any
# STAND-INS, both sides alike
effective_roster.published = lambda *a, **k: []
HOMES = blob["homes"]
house_directory.read = lambda dsn, now=None: dict(HOMES)
effective_roster.use_switch(lambda: dict(blob["switch"]))
hotline_desk._ACCESS_WRITTEN_AT[0] = 0.0
hotline_desk.use_app_cut(lambda: list(blob["cut"]))
hotline_desk.use_app_seen(lambda: list(blob["seen_list"]))
_core = hotline_desk._core_from_mirror
# the access copy vouches, as asa-hub-db does on Python
hotline_desk._core_from_mirror = lambda *a, **k: {**_core(*a, **k), "sync_ok": True, "age_s": 0.0}
ns = {"psycopg2": pg2, "PG_DSN": PG_DSN, "HUB_DB_SHEET_ID": CORE, "shift_requests": shift_requests, "Any": Any,
      "log": __import__("logging").getLogger("relay"), "time": time}
exec(compile(blob["relay_code"], "snapshot_service_my_inbox", "exec"), ns)

SLICES = tempfile.mkdtemp(prefix="my-inbox-slices-")
for n, text in blob["dump"]["slices"].items():
    if text is not None:
        pathlib.Path(SLICES, n + ".json").write_text(text)
BOARD = pathlib.Path(SLICES, ".psi-punch-board.json")
if blob["dump"]["board"] is not None:
    BOARD.write_text(blob["dump"]["board"])
NOW = datetime.fromisoformat(blob["now"])
READS = blob["dump"]["reads"]
SEEN0 = {(r["kind"], r["key"]): datetime.fromisoformat(r["first_seen"]) for r in blob["dump"]["seen"]
         if r.get("first_seen")}
NOTICES = blob["notices"]


class TestStore(my_inbox.Store):
    """The relay's Store on the read-only role; its marks the handed rows, its first sightings kept in memory."""

    def __init__(self, dsn, reads, seen):
        super().__init__(dsn)
        self.handed, self.mem = reads, seen

    def marks(self, uid, keys, *, ensure):
        want = set(keys)
        return {r["alert_key"]: dict(r) for r in self.handed if r["user_id"] == uid and r["alert_key"] in want}

    def seen(self, kind, keys, *, record):
        if record:
            for k in [my_inbox.BASELINE, *keys]:
                self.mem.setdefault((kind, k), NOW)
        rows = {k: self.mem[(kind, k)] for k in [*keys, my_inbox.BASELINE] if (kind, k) in self.mem}
        return rows, rows.pop(my_inbox.BASELINE, None)


def access(subject, extra):
    apps = tuple(dict.fromkeys((*my_inbox.APPS, *extra)))
    out = {}
    for a in apps:
        try:
            v = hotline_desk.app_access(PG_DSN, CORE, subject["uid"], subject["role"], a, 1e12,
                                        is_master=subject["is_master"])
            out[a] = {"open": v.get("open") is True, "why": str(v.get("why") or "")}
        except Exception as exc:
            out[a] = {"open": False, "why": f"The access check failed ({type(exc).__name__})."}
    return out


def one(c, reads):
    """lane_my_inbox's build() for one case, as the relay runs it."""
    mass = c["mode"] == "mass"
    person = c["person"]
    accounts, people_why = None, ""
    if mass:
        try:
            accounts = ns["_notice_accounts"]()
        except Exception as exc:
            people_why = f"The accounts could not be read ({type(exc).__name__})."
    if person:
        if accounts is None:
            return {"status": 502, "reason": "unreadable", "message": f"{people_why} Nobody can be chosen."}
        acc = next((a for a in accounts if a.get("uid") == person), None)
        if acc is None:
            return {"status": 403, "reason": "scope", "message": "That person is not an active account."}
        subject = {"uid": acc["uid"], "role": acc["role"], "types": acc.get("types") or "", "is_master": False,
                   "label": acc.get("label") or ""}
    else:
        subject = {"uid": c["uid"], "role": c["role"], "types": None, "is_master": mass, "label": ""}
    try:
        name = ns["_roster_name_of"](subject["uid"], strict=True)
        if subject["types"] is None:
            subject["types"] = ns["_user_badges"](subject["uid"])
        who = shift_requests.viewer(PG_DSN, name=name, role=subject["role"], types=subject["types"],
                                    is_master=subject["is_master"])
        me = my_work.identity(PG_DSN, CORE, subject["uid"], roster_name=name)
    except Exception as exc:
        return {"status": 502, "reason": "unreadable",
                "message": f"Whose alerts these are could not be read ({type(exc).__name__}), so nothing is shown."}
    lanes, lanes_why = blob["lanes"], ""
    updates = my_inbox.read_updates(PG_DSN)
    acc_map = access(subject, my_inbox.updates_apps(updates))
    sw = c["switch"]
    held = ("test mode" + ("" if sw.get("readable") else " (unreadable, so treated as on)") if sw["on"] else "")
    alerts_off = list(blob["alerts_off"]) if subject["is_master"] else []
    readonly = bool(person)
    store = TestStore(PG_DSN, reads, dict(SEEN0))
    try:
        data = my_inbox.board(
            PG_DSN, subject=subject, me=me, access=acc_map,
            requests=lambda: my_work.requests_for(PG_DSN, me=me, who=who, lanes=lanes, lanes_why=lanes_why),
            lanes=lanes, lanes_why=lanes_why, notices=lambda: NOTICES, held=held, snapshot_dir=SLICES,
            board_file=BOARD, readonly=readonly, readonly_why=my_inbox.KEPT_WHY_CHOSEN if person else "",
            store=store, now=NOW, updates=updates, alerts_off=alerts_off)
    except Exception as exc:
        return {"status": 503, "reason": "unreadable",
                "message": f"My Inbox could not be put together ({type(exc).__name__})."}
    finally:
        store.close()
    hide = c.get("hide") or blob["hide"]
    my_inbox.apply_display(data, my_work.display_for(c["mode"], my_work.hide_from_lane(hide)))
    data["scope"] = {"mode": c["mode"], "why": c["why"], "person": person, "readonly": readonly}
    if mass:
        data["scope"]["people"] = ns["_my_inbox_people"](accounts) if accounts is not None else None
        data["scope"]["people_why"] = people_why
    return {"status": 200, "data": data}


out = {"answers": {}, "marks": {}, "took": {}, "ddl_skipped": 0}
for c in blob["cases"]:
    started = time.time()
    try:
        env = one(c, READS)
        laid = []
        if env.get("status") == 200:
            # three of the subject's own alerts marked: one read, one cleared, one read and cleared
            ids = [it["id"] for it in env["data"]["items"] if not my_inbox.NOTICE_KEY_RE.fullmatch(it["id"])][:3]
            whose = c["person"] or c["uid"]
            stamp = NOW.isoformat()
            shapes = [(stamp, None), (None, stamp), (stamp, stamp)]
            laid = [{"user_id": whose, "alert_key": k, "read_at": a or stamp, "dismissed_at": d}
                    for k, (a, d) in zip(ids, shapes)]
            if laid:
                env = one(c, READS + laid)
    except Exception as exc:
        env, laid = {"error": type(exc).__name__ + ": " + str(exc)[:160]}, []
    out["answers"][c["tag"]] = json.loads(json.dumps(env, default=str))
    out["marks"][c["tag"]] = laid
    out["took"][c["tag"]] = round(time.time() - started, 2)
out["ddl_skipped"] = SKIPPED["ddl"]
shutil.rmtree(DATA, True)
shutil.rmtree(SLICES, True)
print("RELAY_RESULT " + json.dumps(out, default=str))
'''

COMPARE = APP_PRELUDE + r'''
checks, facts = [], {}


def check(name, ok, detail=""):
    checks.append([name, bool(ok), detail])


try:
    import my_inbox as MI
except Exception as exc:
    MI = None
    check("app/my_inbox.py imports", False, type(exc).__name__ + ": " + str(exc)[:160])
door = getattr(MI, "ACTIONS", {}).get("myInboxView") if MI is not None else None
check("app/my_inbox.py declares the myInboxView read", callable(door))
VOLATILE = {"as_of"}
NOW = datetime.fromisoformat(blob["now"])
SEEN0 = {(r["kind"], r["key"]): datetime.fromisoformat(r["first_seen"]) for r in blob["dump"]["seen"]
         if r.get("first_seen")}


class TestState:
    """inbox_state as this check stands it in: the handed rows, first sightings kept in memory, nothing written."""
    mem = {}

    @staticmethod
    def marks_for(_owner, uid, handed):
        reads = {r["alert_key"]: {"read_at": r["read_at"], "dismissed_at": r["dismissed_at"]}
                 for r in (handed or {}).get("reads") or [] if r["user_id"] == uid}
        return {"reads": reads, "seen": dict(TestState.mem)}

    @staticmethod
    def record_seen(_owner, kind, keys, _handed=None, *, record=True):
        want = sorted(set(keys) | {MI.BASELINE})
        if record:
            for k in want:
                TestState.mem.setdefault((kind, k), NOW)
        rows = {k: TestState.mem[(kind, k)] for k in want if (kind, k) in TestState.mem}
        return rows, rows.pop(MI.BASELINE, None)


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
gated, sames, states, took = [], 0, {}, {}
ran = 0
if MI is not None:
    STATE = MI._state
    MI._state = lambda: TestState
    HIDE_LANE = MI.mw.hide_lane
    for c in blob["cases"]:
        relay = blob["relay"]["answers"].get(c["tag"])
        row = by_uid.get(c["uid"])
        user = sc.user_from_row(row) if row is not None else None
        if user is None:
            check(f"{c['tag']}: the account's users row is in asa-hub-db", False)
            continue
        handed = {"user_id": c["person"] or c["uid"],
                  "reads": blob["dump"]["reads"] + blob["relay"]["marks"].get(c["tag"], []),
                  "seen": blob["dump"]["seen"]}
        payload = {"mode": c["mode"], "why": c["why"], "person": c["person"],
                   "inbox_marks": handed, "notices": blob["notices"], "test_mode": c["switch"]}
        if blob["dump"]["board"] is not None:
            payload["punch_board"] = json.loads(blob["dump"]["board"])
        else:
            payload["punch_board_error"] = "missing"
        sess = L.Session(L.Reads(db), user)
        TestState.mem = dict(SEEN0)
        # the case's display, as the relay side is handed it
        MI.mw.hide_lane = (lambda _r, h=c["hide"]: h) if c.get("hide") else HIDE_LANE
        try:
            got = MI._door(sess, payload)
        except sc.Defer as e:
            gated.append(f"{c['tag']} ({str(e)[:60]})")
            got = (MI.scope_of(user, payload, sess.reads.config()), c["person"])
        if isinstance(got, dict):
            env = got
        else:
            scope, person = got
            scope = {**scope, "person": person}
            started = time.time()
            try:
                env = {"status": 200, "data": MI.build(sess, scope, handed, payload, now=NOW)}
                took[c["tag"]] = round(time.time() - started, 2)
            except MI.mw.Refused as exc:
                env = dict(exc.env)
            except Exception as exc:
                env = {"error": type(exc).__name__ + ": " + str(exc)[:200]}
        ran += 1
        a, b = strip(norm(relay)), strip(norm(env))
        same = json.dumps(a, sort_keys=False) == json.dumps(b, sort_keys=False)
        sames += same
        d = [] if same else sorted(set(diff(a, b)))[:12]
        if not same and isinstance(env, dict) and env.get("error"):
            d = [env["error"]] + d
        if not same and isinstance(relay, dict) and relay.get("error"):
            d = ["relay: " + relay["error"]] + d
        if not same and isinstance(env, dict) and env.get("status") == 200 and relay.get("status") == 200:
            # a source part whose state differs: its key, both states and the head of both sentences
            ra = {h["key"]: h for h in relay["data"].get("heads") or []}
            for h in env["data"].get("heads") or []:
                for p, q in zip(h.get("parts") or [], (ra.get(h["key"]) or {}).get("parts") or []):
                    if p != q:
                        d.append(f"{h['key']}/{p['key']}: python {p['state']} '{p['why'][:90]}' relay {q['state']} "
                                 f"'{q['why'][:90]}'")
        check(f"{c['tag']} ({c['mode']}{', a chosen person' if c['person'] else ''}): the answer is the relay's, "
              f"byte for byte but for the copies' stamps", same, "; ".join(d))
        if isinstance(env, dict) and env.get("status") == 200:
            data = env["data"]
            states[c["tag"]] = {
                "items": len(data["items"]), "unread": data["unread"],
                "ready": sum(1 for h in data["heads"] if h["state"] == "ready"),
                "other": sorted({f"{h['key']}:{h['state']}" for h in data["heads"]
                                 if h["state"] not in ("ready", "not_on_platform")}),
                "marked": len(blob["relay"]["marks"].get(c["tag"], [])),
                "read": sum(1 for it in data["items"] if it["read"])}
    # the two editions, each standing in as held by S1 (the catalogue lists them once its entries land)
    MI.mw.hide_lane = lambda _r: {"my_work_hide": {p: False for p in MI.mw.HIDE_PARTS}}
    s = next((c for c in blob["cases"] if c["tag"] == "S1"), None)
    p1 = next((c for c in blob["cases"] if c["tag"] == "M-P1"), None)
    m = next((c for c in blob["cases"] if c["tag"] == "M"), None)
    if s is not None and p1 is not None and m is not None and by_uid.get(s["uid"]) is not None:
        holds = set()
        MI.holder = lambda eid, user, config: eid in holds and bool(user) and not sc.is_real_master(user)
        user = sc.user_from_row(by_uid[s["uid"]])
        handed = {"reads": blob["dump"]["reads"], "seen": blob["dump"]["seen"]}
        payload = {"mode": "own", "why": "", "inbox_marks": handed, "notices": blob["notices"],
                   "test_mode": s["switch"], "punch_board_error": "missing"}

        def scoped(person):
            sess = L.Session(L.Reads(db), user)
            try:
                got = MI._door(sess, {**payload, "person": person})
            except sc.Defer:
                got = (MI.scope_of(user, payload, sess.reads.config()), person)
            if isinstance(got, dict):
                return got, None
            TestState.mem = dict(SEEN0)
            try:
                return got[0], MI.build(sess, {**got[0], "person": got[1]}, handed, payload, now=NOW)
            except MI.mw.Refused as exc:
                return got[0], dict(exc.env)

        holds.add(MI.EDITION_ANYONE)
        scope, data = scoped("")
        check("myInbox.anyone: a holder's own read is widened to any person's, said under the edition",
              scope.get("mode") == "mass" and scope.get("edition") == MI.EDITION_ANYONE and isinstance(data, dict)
              and data.get("scope", {}).get("edition") == MI.EDITION_ANYONE
              and isinstance(data["scope"].get("people"), list) and data["scope"]["people"]
              and data["marks"]["kept"] is True, str(scope)[:80])
        check("myInbox.anyone: the holder is never shown the master's display settings",
              isinstance(data, dict) and "for_users" not in data.get("display", {}))
        _scope, data = scoped(p1["person"])
        check("myInbox.anyone: a chosen person's inbox is read-only, their marks theirs, no answer offered",
              isinstance(data, dict) and data.get("scope", {}).get("person") == p1["person"]
              and data["scope"]["readonly"] is True and data["marks"]["kept"] is False
              and data["marks"]["kept_why"] == MI.KEPT_WHY_CHOSEN and not any("act" in it for it in data["items"]),
              str(data)[:120])
        _scope, data = scoped(m["uid"])
        check("myInbox.anyone: the master's account is never chosen by a holder (403)",
              isinstance(data, dict) and data.get("status") == 403, str(data)[:120])
        holds.clear()
        refused, _none = scoped(p1["person"])
        check("without the edition, another person's inbox is refused (403 scope)",
              isinstance(refused, dict) and refused.get("status") == 403, str(refused)[:120])
        holds.add(MI.EDITION_DIRECTORS)
        _scope, data = scoped("")
        heads = {h["key"]: h for h in (data or {}).get("heads") or []}
        said = [heads[k]["note"].endswith(MI.DIRECTORS_NOTE) for k in ("scheduling", "support")
                if heads.get(k, {}).get("state") == "ready"]
        check("myInbox.directors: the holder's own inbox carries the directors' alerts, said on both sources",
              isinstance(data, dict) and data.get("scope", {}).get("mode") == "own" and said and all(said),
              str([(k, heads.get(k, {}).get("state")) for k in ("scheduling", "support")]))
        base = blob["relay"]["answers"].get("S1-shown") or {}
        facts["myInbox.directors"] = (f"{len((data or {}).get('items') or [])} alerts with the copy, "
                                      f"{len((base.get('data') or {}).get('items') or [])} without")
        holds.clear()
    # the read itself, end to end, for the master: the door, the relay state bound, the same answer
    MI.mw.hide_lane = HIDE_LANE
    if m is not None and by_uid.get(m["uid"]) is not None:
        user = sc.user_from_row(by_uid[m["uid"]])
        TestState.mem = dict(SEEN0)
        payload = {"mode": "mass", "why": m["why"], "inbox_marks": {"reads": blob["dump"]["reads"],
                   "seen": blob["dump"]["seen"]}, "notices": blob["notices"], "test_mode": m["switch"]}
        env = door(L.Session(L.Reads(db), user), payload)
        check("the myInboxView read answers the master's own inbox (200, the lane's keys, scope mass)",
              env.get("status") == 200 and list(env["data"])[:7] == ["subject", "heads", "items", "unread", "capped",
                                                                      "marks", "read_at"]
              and env["data"]["scope"]["mode"] == "mass", str(env.get("status")) + " " + str(env.get("message", "")))
        refused = door(L.Session(L.Reads(db), user), {**payload, "member": "someone"})
        check("a visit is refused (403 visit)", refused.get("status") == 403 and refused.get("reason") == "visit")
        s = next((c for c in blob["cases"] if c["tag"] == "S1"), None)
        if s is not None and by_uid.get(s["uid"]) is not None:
            try:
                own = door(L.Session(L.Reads(db), sc.user_from_row(by_uid[s["uid"]])),
                           {**payload, "mode": "own", "why": "", "person": m["uid"]})
                check("a person asked outside the master's scope is refused (403 scope)",
                      own.get("status") == 403 and own.get("reason") == "scope", str(own)[:120])
            except sc.Defer as e:
                check("a person asked outside the master's scope is refused or left to the relay", True)
        # no marks handed: the relay answers, through inbox_state and through the stand-in alike
        for name, state in (("inbox_state", STATE), ("the stand-in", lambda: MI._NoMarks)):
            MI._state = state
            try:
                MI.build(L.Session(L.Reads(db), user), {"mode": "mass", "why": m["why"], "person": ""}, None,
                         {"notices": blob["notices"], "test_mode": m["switch"]}, now=NOW)
                check(f"with no read marks handed ({name}), the read defers", False, "it answered")
            except sc.Defer:
                check(f"with no read marks handed ({name}), the read defers", True)
        facts["marks module"] = "inbox_state" if STATE() is not MI._NoMarks else "the stand-in (inbox_state did not load)"
facts["cases compared"] = f"{ran}, the same {sames}"
moved = sorted(k for k, v in houses_loaded(MW.HubBooks(reads0)).items() if v != blob["houses"].get(k))
facts["alert houses loaded again while the check ran"] = ", ".join(moved) or "none"
facts["Python seconds per case"] = took
facts["past App Control's gate kept shut, built directly"] = ", ".join(gated) or "none"
for tag, st in states.items():
    facts[f"{tag}"] = (f"{st['items']} alerts, {st['unread']} unread, {st['read']} read, {st['marked']} marks laid; "
                       f"{st['ready']} sources ready; others {', '.join(st['other']) or 'none'}")
print(json.dumps({"checks": checks, "facts": facts}, default=str))
'''


def relay_code() -> str:
    """The relay's lines this check runs as the relay would: the roster name, the badges and the accounts."""
    import ast
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    want = {"_roster_name_from", "_roster_name_of", "_user_badges", "_is_master_row", "_notice_accounts",
            "_my_inbox_people"}
    consts = {"HUB_MASTER_ACCOUNT", "NOTICE_ACCOUNT_ROLES", "_NOTICE_ACCOUNTS", "NOTICE_VIEWER_TTL_S"}
    parts = []
    for node in ast.parse(text).body:
        if isinstance(node, ast.FunctionDef) and node.name in want:
            parts.append(ast.get_source_segment(text, node) or "")
            want.discard(node.name)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            names = {t.id for t in targets if isinstance(t, ast.Name)}
            if names & consts:
                parts.append(ast.get_source_segment(text, node) or "")
                consts -= names
    if want or consts:
        raise RuntimeError(f"the relay lacks {sorted(want | consts)}")
    return "import os\n" + "\n\n".join(parts)


def static() -> int:
    failed = 0

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal failed
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1

    for f in ("app/my_inbox.py", "server/my_inbox.py"):
        try:
            py_compile.compile(str(ROOT / f), doraise=True)
            check(f"{f} compiles", True)
        except py_compile.PyCompileError as exc:
            check(f"{f} compiles", False, str(exc)[-300:])
    text = (ROOT / "app" / "my_inbox.py").read_text(encoding="utf-8")
    check("app/my_inbox.py reads no keeper copy, no file and no DSN: asa-hub-db, mw_relay_state and the payload only",
          "data->>" not in text and "asa_drive_sheets" not in text and "/srv/" not in text and "open(" not in text
          and "HUB_RELAY_RO_DSN" not in text and "MIRROR_DSN" not in text and "psycopg" not in text)
    check("app/my_inbox.py writes nothing itself (no insert, update or delete): the marks are inbox_state's",
          not re.search(r"\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b", text, re.I))
    check("app/my_inbox.py sends no message (no rpc, no Smart Comms render)",
          not re.search(r"rpcCall|smartRender|send_message|sendMessage", text))
    return failed


def run(script: str, blob: dict, tag: str, timeout: int, where: str = RUNNER) -> dict | None:
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", where, "nice", "-n", "19", "python",
                          "-c", script], input=base64.b64encode(json.dumps(blob, default=str).encode()) + b"\n",
                         capture_output=True, timeout=timeout)
    out = got.stdout.decode()
    line = next((x for x in out.splitlines() if x.startswith(tag + " ")), "") if tag else \
        (out.strip().splitlines() or [""])[-1]
    if not line:
        print(f"FAIL the {tag or 'compare'} side ran in {where}")
        print(got.stderr.decode()[-2500:])
        return None
    body = line[len(tag) + 1:] if tag else line
    return json.loads(base64.b64decode(body).decode() if tag == "DUMP_RESULT" else body)


def main() -> int:
    print("STATIC")
    failed = static()
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    print(f"\nDUMP — the relay's own copies and read marks, read-only, in {RELAY_HOST}")
    dump = run(DUMP, {}, "DUMP_RESULT", 120, RELAY_HOST)
    if dump is None:
        return 1
    print(f"fact copies on the relay: {sorted(k for k, v in dump['slices'].items() if v is not None)}; punch board "
          f"{'present' if dump['board'] is not None else 'missing'}; read marks {len(dump['reads'])}, first "
          f"sightings {len(dump['seen'])}")
    print(f"\nPICK — the cases, off asa-hub-db, in {RUNNER}")
    picked = run(PICK, {"app": app, "staff": STAFF, "chosen": CHOSEN, "mass_why": MASS_WHY}, "PICK_RESULT", 300)
    if picked is None:
        return 1
    cases = picked["cases"]
    print(f"fact cases: {len(cases)} ({sum(1 for c in cases if c['tag'].startswith('S'))} staff, "
          f"{sum(1 for c in cases if c['mode'] == 'mass')} master); lanes {sorted(picked['lanes'])}; app list cut "
          f"{len(picked['cut'])}; master's alerts off {len(picked['alerts_off'])}")
    if not picked["master"]:
        print("FAIL the master's users row is not in asa-hub-db")
        failed += 1
    now = picked["now"]
    notices = {"notices": [{"id": 900001, "title": "A shift is open", "body": "Who takes {shift}?", "shift": "7A-3P",
                            "href": "/app/my-work/actions", "priority": "high", "read": False, "published_at": now},
                           {"id": 900002, "title": "Company notice", "body": "Read me", "href": "https://x.invalid",
                            "read": True, "at": now}], "truncated": False}
    print(f"\nRELAY — server/my_inbox.py over the relay's copy (read-only role), in {RUNNER}")
    server = lane_schema.with_imports(ROOT / "server", ("my_inbox", "hotline_desk"))
    relay = run(RELAY, {"server": server, "relay_code": relay_code(), "cases": cases, "homes": picked["homes"],
                        "switch": picked["switch"], "lanes": picked["lanes"], "cut": picked["cut"],
                        "seen_list": picked["seen_list"], "hide": picked["hide"], "alerts_off": picked["alerts_off"],
                        "now": now, "dump": dump, "notices": notices}, "RELAY_RESULT", BUDGET_S)
    if relay is None:
        return 1
    print(f"fact relay DDL statements skipped (read-only role): {relay.get('ddl_skipped')}; seconds per case: "
          f"{relay.get('took')}")
    print(f"\nPYTHON — app/my_inbox.py with the relay's payload, in {RUNNER}")
    res = run(COMPARE, {"app": app, "cases": cases, "relay": relay, "now": now, "dump": dump, "notices": notices,
                        "houses": picked["houses"]}, "", BUDGET_S)
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
