#!/usr/bin/env python3
"""My Inbox on Python end to end: the relay's own lines (lane_my_inbox, lane_my_inbox_read, what the relay hands
asa-hub-app), the marks (app/inbox_state.py) and the mark door (app/my_inbox_writes.py) against the relay's builder
and marks (server/my_inbox.py). First the relay's lines are run as the relay runs them, lifted with stubs: the switch
entry, the hand, the lane's Python call, the edition's ask, both doors. Then, in asa-hub-db-sync with the modules
streamed in: ten staff in their own scope and the master (own, and two people chosen), each handed exactly what the
relay's own _my_inbox_handed builds (its read marks and first sightings dumped read-only from asa-hub-snapshot, the
punch board, test mode and the bell in five shapes), the relay's builder over its copy (MIRROR_DSN) against Python's
myInboxView over asa-hub-db with the real marks merge — extra marks laid on both sides, one kept in asa-hub-db alone —
byte for byte past the read stamps, the stand-ins tools/test-my-inbox-page.py uses on both sides alike. Last the mark
door and the merge on asa-hub-db's own tables. Every write goes to temporary tables or a transaction rolled back.
Prints counts, states and paths, never a person's values."""
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
import tempfile
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import lane_schema  # noqa: E402

RUNNER = "asa-hub-db-sync"
RELAY_HOST = "asa-hub-snapshot"
STAFF = 10
CHOSEN = 2
BUDGET_S = 900
MASS_WHY = "Signed in as the master account: your own alerts, or any person's you choose, read-only."
SLICES = ("people", "clients", "candidates", "potentialClients")
# the staff cases' shapes of what the relay holds; the rest are handed the bell's plain answer
VARIANTS = ("held", "error", "absent", "board_missing", "truncated")
MARKED = ("S6", "S7", "M")

# the relay's own rows and files a run hands both builders, read-only; only their counts are printed
DUMP = r'''
import json, os, pathlib, sys
import psycopg2
out = {"reads": [], "seen": [], "slices": {}, "board": None, "tables": {}}


def iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


conn = psycopg2.connect(os.environ["HUB_SNAPSHOT_PG_DSN"], connect_timeout=5,
                        options="-c default_transaction_read_only=on")
conn.set_session(readonly=True, autocommit=True)
with conn.cursor() as cur:
    cur.execute("select to_regclass('asa_hub_inbox_reads') is not null, to_regclass('asa_hub_inbox_seen') is not null")
    reads_here, seen_here = cur.fetchone()
    out["tables"] = {"asa_hub_inbox_reads": bool(reads_here), "asa_hub_inbox_seen": bool(seen_here)}
    if reads_here:
        cur.execute("select user_id, alert_key, read_at, dismissed_at from asa_hub_inbox_reads")
        out["reads"] = [{"user_id": u, "alert_key": k, "read_at": iso(r), "dismissed_at": iso(d)}
                        for u, k, r, d in cur.fetchall()]
    if seen_here:
        cur.execute("select kind, key, first_seen from asa_hub_inbox_seen")
        out["seen"] = [{"kind": k, "key": key, "first_seen": iso(f)} for k, key, f in cur.fetchall()]
conn.close()
snap = pathlib.Path(os.environ.get("HUB_SNAPSHOT_OUT", "/srv/snapshot"))
for name in NAMES:
    p = snap / f"{name}.json"
    out["slices"][name] = p.read_text(encoding="utf-8") if p.exists() else None
board = pathlib.Path(os.environ.get("HUB_PSI_PUNCH_BOARD") or snap / ".psi-punch-board.json")
out["board"] = board.read_text(encoding="utf-8") if board.exists() else None
sys.stdout.write("DUMP_RESULT " + json.dumps(out) + "\n")
'''.replace("NAMES", repr(SLICES))

# the app side: the modules streamed in, a fake web layer, asa-hub-db read-only, the relay's tables read-only
APP_PRELUDE = r'''
import base64, hashlib, importlib.abc, importlib.util, json, os, re, sys, time, types
from datetime import datetime, timedelta, timezone
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
import psycopg
from psycopg.conninfo import make_conninfo
OWNER = dict(host=os.environ.get("HUB_DB_HOST", "asa-hub-db"), dbname=os.environ["POSTGRES_DB"],
             user=os.environ["POSTGRES_USER"], password=os.environ["POSTGRES_PASSWORD"])
os.environ["HUB_DB_DSN"] = make_conninfo(**OWNER, options="-c default_transaction_read_only=on")
# the relay's tables through its read-only role, as HUB_RELAY_RO_DSN reads them in asa-hub-app
os.environ["HUB_RELAY_RO_DSN"] = make_conninfo(os.environ["MIRROR_DSN"], options="-c default_transaction_read_only=on")
import gsjs, hubdb, locations as L, scope as sc
import my_work as MW
import mw_roster
CORE = MW.CORE_USERS_SHEET_ID
db = hubdb.HubDb()
# STAND-IN, both sides alike: asa_house_calendar_edits is not granted to the read-only role, so no published cells
mw_roster.effective_roster.published = staticmethod(lambda *a, **k: [])


def sha(v):
    return hashlib.sha1(str(v).encode()).hexdigest()


def rolled_back():
    """A connection whose one transaction is rolled back at the end: nothing it writes outlives the run."""
    conn = psycopg.connect(make_conninfo(**OWNER), autocommit=False, connect_timeout=5)
    conn.execute("set local lock_timeout = '2s'")
    conn.execute("set local statement_timeout = '60s'")
    return conn


class Held:
    """A write store over one rolled-back transaction, as inbox_state reads and keeps through main's own."""
    available, why = True, ""

    def __init__(self, conn):
        self.c = conn

    def ready(self):
        return True

    def conn(self):
        return self.c

    def _drop(self):
        pass
'''

PICK = APP_PRELUDE + r'''
import my_inbox as MI
reads = L.Reads(db)
books = MW.HubBooks(reads)
users = [u for u in books.users_rows(CORE, "", ()) if isinstance(u, dict)]
by_uid = {gsjs.str_(u.get("userid")): u for u in reads.users() if not gsjs.str_(u.get("mergedinto"))}


def live(u):
    return MW._live(u) and str(u.get("user_id") or "").strip() and MW.fold(u.get("display_name"))


def opens(uid):
    row = by_uid.get(uid)
    if row is None:
        return False
    try:
        return sc.profile_app_gate("my-inbox", sc.user_from_row(row), reads.scope_sources()).get("open") is True
    except sc.Defer:
        return False


master = next((u for u in users if live(u) and MW._low(u.get("email")) == sc.MASTER_ACCOUNT
               and MW._low(u.get("role")) == "admin"), None)
staff = sorted((u for u in users if live(u) and u is not master and MW._low(u.get("role")) in MI.ACCOUNT_ROLES),
               key=lambda u: sha(u["user_id"]))
opened = [u for u in staff if opens(str(u["user_id"]))]
chosen = (opened + [u for u in staff if u not in opened])[:blob["staff"]]
cases = []
for i, u in enumerate(chosen):
    cases.append({"tag": f"S{i + 1}", "uid": str(u["user_id"]), "role": MW._low(u.get("role")), "mode": "own",
                  "why": "", "person": "", "variant": blob["variants"][i] if i < len(blob["variants"]) else "got"})
off = []
if master is not None:
    m = {"uid": str(master["user_id"]), "role": "admin", "mode": "mass", "why": blob["mass_why"]}
    cases.append({**m, "tag": "M", "person": "", "variant": "got"})
    people = MI.people_list(MI.accounts(books))
    for i, p in enumerate(sorted(people, key=lambda p: sha(p["uid"]))[:blob["chosen"]]):
        cases.append({**m, "tag": f"M-P{i + 1}", "person": p["uid"], "variant": "held" if i % 2 else "got"})
    off = MI.alerts_off(reads, str(master["user_id"]))
cfg = reads.config()
print("PICK_RESULT " + json.dumps({
    "cases": cases, "master": master is not None, "opened": len(opened), "staff": len(staff),
    "homes": mw_roster.house_directory.read(reads), "lanes": MW.lanes_for(books, MW.MY_WORK_LANES),
    "cut": sc.list_cell(cfg.get(sc.MYWORK_APPS_KEY)), "seen_list": sc.list_cell(cfg.get(sc.MYWORK_APPS_SEEN_KEY)),
    "hide": MW.hide_lane(reads), "alerts_off": off}, default=str))
'''

RELAY = r'''
import asyncio, base64, importlib.abc, importlib.util, json, logging, os, pathlib, re, shutil, sys, tempfile, time, types
from datetime import date, datetime, timedelta, timezone
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = {k: v for k, v in blob["server"].items() if not k.endswith(".json")}
DATA = tempfile.mkdtemp(prefix="my-inbox-relay-")
for k, v in blob["server"].items():
    if k.endswith(".json"):
        pathlib.Path(DATA, k).write_text(v)
SNAP = pathlib.Path(DATA, "snapshot")
SNAP.mkdir()
for name, text in blob["dump"]["slices"].items():
    if text is not None:
        (SNAP / f"{name}.json").write_text(text)
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
# STAND-INS, both sides alike (tools/test-my-inbox-page.py's own)
effective_roster.published = lambda *a, **k: []
house_directory.read = lambda dsn, now=None: dict(blob["homes"])
hotline_desk._ACCESS_WRITTEN_AT[0] = 0.0
hotline_desk.use_app_cut(lambda: list(blob["cut"]))
hotline_desk.use_app_seen(lambda: list(blob["seen_list"]))
_core = hotline_desk._core_from_mirror
hotline_desk._core_from_mirror = lambda *a, **k: {**_core(*a, **k), "sync_ok": True, "age_s": 0.0}
ns = {"psycopg2": pg2, "PG_DSN": PG_DSN, "HUB_DB_SHEET_ID": CORE, "shift_requests": shift_requests, "Any": Any,
      "log": logging.getLogger("relay"), "asyncio": asyncio, "json": json, "time": time,
      "HUB_MASTER_ACCOUNT": "asatech@asalifecare.com", "NOTICE_VIEWER_TTL_S": 120.0,
      "NOTICE_ACCOUNT_ROLES": ("staff", "manager", "admin", "director"), "_NOTICE_ACCOUNTS": {"at": 0.0, "rows": None},
      "_hotline_token": lambda a: a[7:].strip() if a.lower().startswith("bearer ") else ""}
exec(compile(blob["relay_code"], "snapshot_service_my_inbox", "exec"), ns)
out = {"answers": {}, "handed": {}, "took": {}, "facts": {}, "app_marks": {}}
BOARD = blob["dump"]["board"]
NOW = datetime.now(timezone.utc)
FIXED = (NOW - timedelta(days=40)).replace(microsecond=0)


def notices_answer(variant):
    """The bell's answer both builders are handed (no person's words): a high one with a shift and a page, a read
    one with a link off the platform, one no id reads, one undated."""
    rows = [{"id": 990001, "kind": "decided", "title": "A request was decided", "body": "For {shift}.", "shift": "7A-3P",
             "href": "/app/my-calendar", "priority": "high", "published_at": (NOW - timedelta(hours=3)).isoformat(),
             "at": "", "read": False},
            {"id": 990002, "kind": "filled", "title": "A shift was taken", "body": "No shift here.", "shift": "",
             "href": "https://example.invalid/x", "priority": "normal",
             "published_at": (NOW - timedelta(days=1)).isoformat(), "at": "", "read": True},
            {"id": "not-a-number", "title": "Never listed"},
            {"id": 990003, "kind": "open", "title": "", "body": "", "published_at": "", "at": NOW.date().isoformat(),
             "read": False}]
    return {"notices": rows, "unread": 2, "seq": 990003, "since": 0, "me": "", "held": "",
            "truncated": variant == "truncated"}


OperationalError = type("OperationalError", (Exception,), {})


class Notices:
    def __init__(self, variant):
        self.variant = variant

    def inbox(self, dsn, *, who, uid, limit=200, held=""):
        if self.variant == "error":
            raise OperationalError("the bell's tables did not answer")
        return notices_answer(self.variant)


# the relay's first sightings, every current client key already seen once (at its own stamp, else FIXED), so both
# builders judge "new" on the same stamps; the record path itself is the mark door's check below
seen = list(blob["dump"]["seen"])
have = {(r["kind"], r["key"]) for r in seen}
try:
    client_rows = json.loads(blob["dump"]["slices"].get("clients") or "{}").get("rows") or []
except Exception:
    client_rows = []
base = next((r["first_seen"] for r in seen if r["kind"] == "client" and r["key"] == my_inbox.BASELINE), None)
laid = 0
for r in client_rows:
    k = my_inbox._text(r.get("client_key"), 120) if isinstance(r, dict) else ""
    if k and ("client", k) not in have:
        have.add(("client", k))
        seen.append({"kind": "client", "key": k, "first_seen": base or FIXED.isoformat()})
        laid += 1
if base is None:
    seen.append({"kind": "client", "key": my_inbox.BASELINE, "first_seen": FIXED.isoformat()})
out["facts"]["first sightings handed"] = (f"{len(blob['dump']['seen'])} relay rows + {laid} client keys at a fixed "
                                          "stamp" + ("" if base else " + a baseline (the relay has none)"))


def at_of(v):
    return datetime.fromisoformat(v.replace("Z", "+00:00")) if v else None


class FakeStore(my_inbox.Store):
    """The relay's Store with its two mark doors on the rows the relay hands; every other read off its copy."""

    def __init__(self, dsn, marks):
        super().__init__(dsn)
        self.handed = marks
        self.recorded = 0

    def marks(self, uid, keys, *, ensure):
        rows = {r["alert_key"]: r for r in self.handed["reads"] if r["user_id"] == uid}
        return {k: {"alert_key": k, "read_at": at_of(rows[k]["read_at"]), "dismissed_at": at_of(rows[k]["dismissed_at"])}
                for k in keys if k in rows}

    def seen(self, kind, keys, *, record):
        rows = {r["key"]: at_of(r["first_seen"]) for r in self.handed["seen"] if r["kind"] == kind}
        if record:
            self.recorded += sum(1 for k in [*keys, my_inbox.BASELINE] if k not in rows)
        got = {k: rows[k] for k in [*keys, my_inbox.BASELINE] if k in rows}
        return got, got.pop(my_inbox.BASELINE, None)


def handed_for(c, extra=()):
    """_my_inbox_handed itself, the relay-only parts stubbed as this case says."""
    token = "tok-" + c["tag"]
    ns["_auth_master"] = {token: True} if c["mode"] == "mass" else {}
    ns["_web_switch"] = lambda v=c["variant"]: {"on": v == "held", "readable": True, "word": "on" if v == "held"
                                                else "off", "why": ""}
    ns["web_notices"] = None if c["variant"] == "absent" else Notices(c["variant"])
    ns["_my_inbox_punch_board"] = lambda v=c["variant"]: (
        {"punch_board_error": "missing"} if v == "board_missing" or BOARD is None else {"punch_board": json.loads(BOARD)})
    ns["_lane_alerts_off"] = lambda uid: list(blob["alerts_off"]) if uid == c["uid"] and c["mode"] == "mass" else []
    ns["_my_inbox_marks_read"] = lambda uid: {
        "user_id": uid, "reads": [r for r in [*blob["dump"]["reads"], *extra] if r["user_id"] == uid], "seen": seen}
    return asyncio.run(ns["_my_inbox_handed"]("Bearer " + token, (c["role"], c["uid"]), c["person"]))


def access(subject, extra):
    apps = tuple(dict.fromkeys((*my_inbox.APPS, *extra)))
    got = {}
    for a in apps:
        try:
            v = hotline_desk.app_access(PG_DSN, CORE, subject["uid"], subject["role"], a, 1e12,
                                        is_master=subject["is_master"])
            got[a] = {"open": v.get("open") is True, "why": str(v.get("why") or "")}
        except Exception as exc:
            got[a] = {"open": False, "why": f"The access check failed ({type(exc).__name__})."}
    return got


def relay_build(c, handed):
    """lane_my_inbox's build() fed exactly what was handed (its bell, its switch, its board, its marks)."""
    mass, person = c["mode"] == "mass", c["person"]
    accounts = ns["_notice_accounts"]() if mass else None
    if person:
        acc = next(a for a in accounts if a.get("uid") == person)
        subject = {"uid": acc["uid"], "role": acc["role"], "types": acc.get("types") or "", "is_master": False,
                   "label": acc.get("label") or ""}
    else:
        subject = {"uid": c["uid"], "role": c["role"], "types": None, "is_master": mass, "label": ""}
    name = ns["_roster_name_of"](subject["uid"], strict=True)
    if subject["types"] is None:
        subject["types"] = ns["_user_badges"](subject["uid"])
    who = shift_requests.viewer(PG_DSN, name=name, role=subject["role"], types=subject["types"],
                                is_master=subject["is_master"])
    me = my_work.identity(PG_DSN, CORE, subject["uid"], roster_name=name)
    updates = my_inbox.read_updates(PG_DSN)
    lanes = blob["lanes"]
    sw = handed["test_mode"]
    held = ("test mode" + ("" if sw.get("readable") else " (unreadable, so treated as on)") if sw["on"] else "")
    if "notices" in handed:
        notices = lambda: handed["notices"]  # noqa: E731
    elif "notices_error" in handed:
        def notices():
            raise type(handed["notices_error"], (Exception,), {})()
    else:
        notices = None
    board_file = pathlib.Path(DATA, f"board-{c['tag']}.json")
    if "punch_board" in handed:
        board_file.write_text(json.dumps(handed["punch_board"]))
    store = FakeStore(PG_DSN, handed["inbox_marks"])
    try:
        data = my_inbox.board(PG_DSN, subject=subject, me=me, access=access(subject, my_inbox.updates_apps(updates)),
                              requests=lambda: my_work.requests_for(PG_DSN, me=me, who=who, lanes=lanes, lanes_why=""),
                              lanes=lanes, lanes_why="", notices=notices, held=held, snapshot_dir=SNAP,
                              board_file=board_file, readonly=bool(person),
                              readonly_why=my_inbox.KEPT_WHY_CHOSEN if person else "", store=store, updates=updates,
                              alerts_off=list(blob["alerts_off"]) if subject["is_master"] else [])
    finally:
        store.close()
    out["facts"]["first sightings the relay would have recorded"] = \
        out["facts"].get("first sightings the relay would have recorded", 0) + store.recorded
    my_inbox.apply_display(data, my_work.display_for(c["mode"], my_work.hide_from_lane(blob["hide"])))
    data["scope"] = {"mode": c["mode"], "why": c["why"], "person": person, "readonly": bool(person)}
    if mass:
        data["scope"]["people"] = ns["_my_inbox_people"](accounts)
        data["scope"]["people_why"] = ""
    return {"status": 200, "data": data}


for c in blob["cases"]:
    started = time.time()
    try:
        handed = handed_for(c)
        if handed is None:
            raise RuntimeError("the relay handed nothing for this case")
        env = relay_build(c, handed)
        if c["tag"] in blob["marked"]:
            # marks on the first alerts both builders list: one read, one cleared, one kept in asa-hub-db alone
            ids = [it["id"] for it in env["data"]["items"] if not my_inbox.NOTICE_KEY_RE.fullmatch(it["id"])][:3]
            whose = c["person"] or c["uid"]
            stamp = (NOW - timedelta(minutes=5)).isoformat()
            extra = [{"user_id": whose, "alert_key": k, "read_at": stamp, "dismissed_at": stamp if i == 1 else None}
                     for i, k in enumerate(ids[:2])]
            app_marks = [{"user_id": whose, "alert_key": k, "dismiss": False} for k in ids[2:3]]
            both = extra + [{"user_id": m["user_id"], "alert_key": m["alert_key"], "read_at": stamp,
                             "dismissed_at": None} for m in app_marks]
            env = relay_build(c, handed_for(c, both))
            handed = handed_for(c, extra)
            out["app_marks"][c["tag"]] = app_marks
        out["handed"][c["tag"]] = handed
    except Exception as exc:
        env = {"error": type(exc).__name__ + ": " + str(exc)[:160]}
    out["answers"][c["tag"]] = json.loads(json.dumps(env, default=str))
    out["took"][c["tag"]] = round(time.time() - started, 2)
out["handed"] = json.loads(json.dumps(out["handed"], default=str))
out["facts"]["DDL skipped on the relay side"] = SKIPPED["ddl"]
shutil.rmtree(DATA, True)
print("RELAY_RESULT " + json.dumps(out, default=str))
'''

COMPARE = APP_PRELUDE + r'''
checks, facts = [], {}


def check(name, ok, detail=""):
    checks.append([name, bool(ok), detail])


import inbox_state as IS
import my_inbox_writes as MIW
import writes as W
try:
    import my_inbox as MI
except Exception as exc:
    MI = None
    check("app/my_inbox.py imports", False, type(exc).__name__ + ": " + str(exc)[:160])
door = MI.ACTIONS.get("myInboxView") if MI is not None and isinstance(getattr(MI, "ACTIONS", None), dict) else None
check("app/my_inbox.py declares the lane's read myInboxView", callable(door))
if MI is not None:
    pol = set((MI.POLICY.get("myInboxView") or {}).get("params") or {})
    check("its policy takes everything the relay hands in (the marks, test mode, the bell, the punch board)",
          pol >= {"person", "mode", "why", "inbox_marks", "test_mode", "notices", "notices_error", "punch_board",
                  "punch_board_error"}, str(sorted(pol)))
    check("it reads the marks through app/inbox_state.py", getattr(MI, "inbox_state", None) is IS)
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


def said_heads(a, b):
    """Where two answers' source heads part: each source's state and its system sentences (no person's values)."""
    def heads(env):
        d = env.get("data") if isinstance(env.get("data"), dict) else {}
        return {h.get("key"): h for h in d.get("heads") or []}, d.get("whole")
    (ha, wa), (hb, wb) = heads(a), heads(b)
    out = [f"whole relay {wa} / python {wb}"] if wa != wb else []
    for k in ha:
        x, y = ha[k], hb.get(k) or {}
        for f in ("state", "gap", "why"):
            if x.get(f) != y.get(f):
                out.append(f"{k}.{f}: relay {str(x.get(f))[:140]!r} / python {str(y.get(f))[:140]!r}")
        for px, py in zip(x.get("parts") or [], y.get("parts") or []):
            if px != py:
                out.append(f"{k}.parts.{px.get('key')}: relay {px.get('state')} {str(px.get('why'))[:120]!r} / "
                           f"python {py.get('state')} {str(py.get('why'))[:120]!r}")
    return ("; " + " | ".join(out[:6])) if out else ""


relay = blob["relay"]
reads0 = L.Reads(db)
by_uid = {gsjs.str_(u.get("userid")): u for u in reads0.users() if not gsjs.str_(u.get("mergedinto"))}

# ---- the page through the door, the marks merged by inbox_state in temporary tables of a rolled-back transaction ---
if door is not None:
    conn = rolled_back()
    IS.READS_TABLE, IS.SEEN_TABLE = "pg_temp.inbox_reads", "pg_temp.inbox_seen"
    try:
        for stmt in IS.ddl():
            conn.execute(stmt)
        IS.bind(Held(conn))
        states, same, gated = {}, 0, []
        for c in blob["cases"]:
            tag = c["tag"]
            want = relay["answers"].get(tag) or {}
            if want.get("error"):
                check(f"{tag}: the relay's builder answered", False, want["error"])
                continue
            row = by_uid.get(c["uid"])
            if row is None:
                check(f"{tag}: the account's users row is in asa-hub-db", False)
                continue
            user = sc.user_from_row(row)
            with conn.cursor() as cur:
                for m in relay["app_marks"].get(tag) or []:
                    IS.keep_marks(cur, m["user_id"], [m["alert_key"]], m["dismiss"])
            payload = {"mode": c["mode"], "why": c["why"], "person": c["person"], **relay["handed"][tag]}
            started = time.time()
            try:
                env = door(L.Session(L.Reads(db), user), payload)
            except sc.Defer as e:
                if "App Control" in str(e):
                    gated.append(tag)
                    continue
                check(f"{tag}: Python answered (no defer)", False, str(e)[:160])
                continue
            except Exception as e:
                check(f"{tag}: Python answered", False, type(e).__name__ + ": " + str(e)[:160])
                continue
            a, b = norm(want), norm(env)
            paths = diff(strip(a), strip(b))
            check(f"{tag}: byte-identical to the relay's answer past the read stamps ({c['variant']})", not paths,
                  f"{len(paths)} paths, first {sorted(set(paths))[:8]}{said_heads(a, b)}")
            same += not paths
            d = b.get("data") if isinstance(b.get("data"), dict) else {}
            states[tag] = (f"{len(d.get('items') or [])} items, {d.get('unread')} unread; "
                           + ",".join(f"{h.get('key')}:{h.get('state')}" for h in d.get("heads") or [])[:300]
                           if d else f"status {b.get('status')}")
            facts[f"{tag} took"] = f"python {round(time.time() - started, 2)}s, relay {relay['took'].get(tag)}s"
        facts["cases identical"] = f"{same} of {len(blob['cases']) - len(gated)} compared"
        if gated:
            facts["App Control keeps My Inbox shut to (the relay refuses them first)"] = gated
        facts["states"] = states
        facts["cases with extra marks (read, cleared, one kept in asa-hub-db)"] = sorted(relay["app_marks"])
        kept = conn.execute("select count(*) from pg_temp.inbox_seen").fetchone()[0]
        facts["first sightings Python kept (temporary table)"] = kept
    finally:
        conn.rollback()
        conn.close()
        IS.READS_TABLE, IS.SEEN_TABLE = "app.inbox_reads", "app.inbox_seen"
        IS.bind(None)
else:
    check("the page could be compared (app/my_inbox.py's myInboxView)", False)

# ---- the mark door and the marks' merge on asa-hub-db's own tables, inside a transaction rolled back ---------------
conn = rolled_back()
try:
    for stmt in IS.ddl():
        conn.execute(stmt)
    for stmt in W.ddl("my_inbox"):
        if "app.my_inbox_" in stmt:
            conn.execute(stmt)
    IS.bind(Held(conn))
    uid = "zz-inbox-check-" + os.urandom(3).hex()
    user = {"id": uid, "role": "staff", "display_name": "", "visiting_member": "", "is_service": False}
    sess = L.Session(reads0, user)
    words = blob["relay_words"]

    def rows():
        return {k: (r, d) for k, r, d in conn.execute(
            "select alert_key, read_at, dismissed_at from app.inbox_reads where user_id = %s", (uid,)).fetchall()}

    def mark(payload, wid=None, who=None):
        wid = wid or "W" + os.urandom(12).hex()
        d = MIW.mark_read(L.Session(reads0, who or user), payload)
        env = W.envelope(d, wid, who or user)
        with conn.cursor() as cur:
            tx = MIW.Tx(cur, "my_inbox")
            if tx.receipt(wid) is None:
                tx.record(wid, "myInboxRead", env, d, "check")
        return env, wid

    env, wid = mark({"keys": ["requests:a1", "sched:x:y", "bad key!"]})
    got = rows()
    check("mark: two alert keys and one unreadable — answered as lane_my_inbox_read answers",
          env == {"status": 200, "data": {"marked": 2, "ignored": 1}}, str(env)[:160])
    check("mark: kept final in app.inbox_reads exactly — two rows, read, not cleared",
          set(got) == {"requests:a1", "sched:x:y"} and all(r and d is None for r, d in got.values()), str(sorted(got)))
    with conn.cursor() as cur:
        check("mark: its receipt is kept under its write id, the answer as given, no relay plan in it",
              MIW.Tx(cur, "my_inbox").receipt(wid) == env and "_write" not in env)
    first = got["requests:a1"][0]
    env, _ = mark({"keys": ["requests:a1", "move:z:2"], "dismiss": True})
    got = rows()
    check("clear: answered marked 2; the cleared alert keeps its first read stamp; a new one is read and cleared",
          env["data"] == {"marked": 2, "ignored": 0} and got["requests:a1"][0] == first
          and got["requests:a1"][1] is not None and got["move:z:2"][1] is not None
          and got["sched:x:y"][1] is None, str(env)[:120])
    env, _ = mark({"keys": ["requests:a1"], "dismiss": "true"})
    check("a cleared alert read again stays cleared; dismiss is true alone (a string is a read)",
          rows()["requests:a1"][1] is not None and env["data"]["marked"] == 1)
    conn.execute("insert into app.inbox_reads (user_id, alert_key, read_at) values (%s, 'punch:old:no_punch', "
                 "now() - interval '61 days'), (%s, 'requests:old', now() - interval '61 days'), "
                 "(%s, 'punch:new:no_punch', now() - interval '2 days')", (uid, uid, uid))
    mark({"keys": ["sched:x:y"]})
    got = rows()
    check("prune: a mark lets go of the account's own marks long gone (punch past 60 days), never a request's nor a "
          "recent one", "punch:old:no_punch" not in got and "requests:old" in got and "punch:new:no_punch" in got,
          str(sorted(got)))
    before = len(rows())
    refusals = (("keys missing", {}, (400, "keys", words["keys"])),
                ("keys not a list", {"keys": "requests:a1"}, (400, "keys", words["keys"])),
                ("keys empty", {"keys": []}, (400, "keys", words["keys"])),
                ("too many keys", {"keys": [f"requests:k{i}" for i in range(IS.READ_MAX + 1)]},
                 (400, "keys", words["too_many"])),
                ("no alert among them", {"keys": ["!!", 5, None]}, (400, "keys", words["no_alert"])),
                ("a visit", {"keys": ["requests:a1"], "member": "m-1"}, (403, "visit", words["visit"])))
    for label, payload, (status, reason, message) in refusals:
        env, _ = mark(payload)
        check(f"refused, as the relay refuses it: {label}",
              (env.get("status"), env.get("reason"), env.get("message")) == (status, reason, message), str(env)[:160])
    env, _ = mark({"keys": ["requests:a1"]}, who={**user, "id": ""})
    check("refused, as the relay refuses it: a session with no account",
          (env.get("status"), env.get("reason"), env.get("message")) == (403, "session", words["session"]))
    for label, payload, who in (("a company notice's mark (the bell's)", {"keys": ["srv-12"]}, None),
                                ("the service", {"keys": ["requests:a1"]}, {**user, "is_service": True})):
        try:
            mark(payload, who=who)
            check(f"deferred, never kept here: {label}", False)
        except sc.Defer:
            check(f"deferred, never kept here: {label}", True)
    check("no refusal keeps a mark", len(rows()) == before, f"{before} -> {len(rows())}")
    check("the door is declared for the staff roles alone, its body read by the door (no typed params)",
          MIW.POLICY == {"myInboxRead": {"roles": ("admin", "director", "manager", "staff")}}
          and set(MIW.ACTIONS) == {"myInboxRead"} and MIW.BUSY_OF["myInboxRead"]["status"] == 409)

    # the merge: the relay's rows handed in, asa-hub-db's own, newest read and cleared stamps, earliest first sighting
    old = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    later = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    handed = {"user_id": uid, "reads": [
        {"user_id": uid, "alert_key": "sched:x:y", "read_at": old, "dismissed_at": None},
        {"user_id": uid, "alert_key": "staff:r:1", "read_at": old, "dismissed_at": old},
        {"user_id": uid, "alert_key": "move:z:2", "read_at": later, "dismissed_at": None},
        {"user_id": "someone-else", "alert_key": "client:c9", "read_at": old, "dismissed_at": None}],
        "seen": [{"kind": "client", "key": IS.BASELINE, "first_seen": old},
                 {"kind": "client", "key": "c1", "first_seen": old}]}
    m = IS.marks_for(sess, uid, handed)
    own = rows()
    check("merge: a key both hold reads asa-hub-db's newer stamp; one the relay alone holds is the relay's; a newer "
          "relay stamp wins over an older own one, an own clearing stays; another account's row is never taken",
          m["reads"]["sched:x:y"]["read_at"] == own["sched:x:y"][0]
          and m["reads"]["staff:r:1"]["dismissed_at"] is not None and "client:c9" not in m["reads"]
          and m["reads"]["move:z:2"]["read_at"] > own["move:z:2"][0]
          and m["reads"]["move:z:2"]["dismissed_at"] == own["move:z:2"][1], str(sorted(m["reads"]))[:200])
    check("merge: the relay's first sightings are read in, the payload's own field taken as well",
          ("client", "c1") in m["seen"] and IS.marks_for(sess, uid, {"inbox_marks": handed})["reads"] == m["reads"])
    marks = IS.Marks(sess, uid, handed)
    got = marks.marks(uid, ["sched:x:y", "staff:r:1", "nope:1"], ensure=True)
    check("the relay Store's mark door: {key: {alert_key, read_at, dismissed_at}} on the keys asked, the subject's alone",
          set(got) == {"sched:x:y", "staff:r:1"} and set(got["sched:x:y"]) == {"alert_key", "read_at", "dismissed_at"}
          and marks.marks("someone-else", ["client:c9"], ensure=False) == {})
    for label, given in (("no marks handed", None), ("another account's marks", {**handed, "user_id": "x"}),
                         ("a malformed hand", {"reads": "x", "seen": []})):
        try:
            IS.marks_for(sess, uid, given)
            check(f"merge defers on {label}", False)
        except sc.Defer:
            check(f"merge defers on {label}", True)
    count = lambda: conn.execute("select count(*) from app.inbox_seen").fetchone()[0]  # noqa: E731
    before_seen = count()
    first, baseline = IS.record_seen(sess, "client", ["c1", "c2"], handed, record=False)
    check("first sightings read without keeping: the relay's alone, nothing written",
          set(first) == {"c1"} and baseline is not None and count() == before_seen)
    first, baseline = IS.record_seen(sess, "client", ["c1", "c2"], handed)
    kept = {k: at for k, at in conn.execute("select key, first_seen from app.inbox_seen where kind = 'client'")}
    check("first sightings kept: a key the relay saw keeps the relay's stamp (copied), a new one is seen now, the "
          "baseline is the relay's", first["c1"] == IS._ts(old) and kept.get("c1") == IS._ts(old)
          and "c2" in first and first["c2"] > IS._ts(old) and baseline == IS._ts(old)
          and kept.get(IS.BASELINE) == IS._ts(old), str(sorted(kept))[:160])
    earlier = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    sooner = IS.Marks(sess, uid, {**handed, "seen": handed["seen"] + [{"kind": "client", "key": "c2",
                                                                       "first_seen": earlier}]})
    first, _b = sooner.seen("client", ["c2"], record=True)
    check("the earliest first sighting wins, here too (through the relay Store's seen door)",
          first["c2"] == IS._ts(earlier)
          and conn.execute("select first_seen from app.inbox_seen where kind = 'client' and key = 'c2'").fetchone()[0]
          == IS._ts(earlier))
    IS.record_seen(sess, "prospect", [IS.BASELINE, "p1"])
    check("as app/my_inbox.py calls it (no hand): the baseline and the key kept once, at now",
          conn.execute("select count(*) from app.inbox_seen where kind = 'prospect'").fetchone()[0] == 2)
    facts["the mark door ran on"] = f"a rolled-back transaction ({len(rows())} marks there, all let go)"
finally:
    conn.rollback()
    conn.close()
    IS.bind(None)

# ---- app/main.py: the routes, the store bound for the marks, then read, mark, read again, clear, read again through
# main's own doors — its store over temporary tables of a rolled-back transaction, a lock key of its own ------------
try:
    import main
except Exception as exc:
    main = None
    check("app/main.py imports", False, type(exc).__name__ + ": " + str(exc)[:160])
if main is not None and MI is not None:
    check("app/main.py routes my-inbox: the read to app/my_inbox.py, the mark to app/my_inbox_writes.py, its store "
          "held by main and bound for the marks",
          main.APPS.get("my-inbox") is MI and main.WRITES.get("my-inbox") is MIW
          and main.stores().get("my-inbox") is main.MY_INBOX_STORE and isinstance(main.MY_INBOX_STORE, MIW.Store)
          and IS._BOUND["store"] is main.MY_INBOX_STORE)
    health = main.healthz()
    check("/healthz says the My Inbox store (here: no writer DSN, so not ready, and why)",
          health.get("ok") is True and health.get("my_inbox_writes") is False
          and "HUB_DB_WRITE_DSN" in str(health.get("my_inbox_writes_why")), str(health.get("my_inbox_writes_why")))
    gate_bad = [c["tag"] for c in blob["cases"] if main.policy_gate(
        MI, "myInboxView", {"mode": c["mode"], "why": c["why"], "person": c["person"], **relay["handed"][c["tag"]]},
        {"role": c["role"]}) is not None]
    check("every hand the relay builds passes main's policy gate for the session's role", not gate_bad, str(gate_bad))
    check("the mark the relay sends passes main's policy gate for each staff role",
          all(main.policy_gate(MIW, "myInboxRead", {"keys": ["requests:a1"], "dismiss": True}, {"role": r}) is None
              for r in ("admin", "director", "manager", "staff")))

    class Resp:
        def __init__(self, content=b"", status_code=200, media_type="", headers=None):
            self.body, self.status_code, self.headers = content, status_code, dict(headers or {})

    main.Response = Resp
    main.JSONResponse = lambda content, status_code=200, headers=None: Resp(json.dumps(content), status_code, "",
                                                                            headers)

    def rw(sql):
        return sql.replace("app.my_inbox_", "pg_temp.my_inbox_") if isinstance(sql, str) else sql

    class Cur:
        def __init__(self, cur, conn):
            self.c, self.connection = cur, conn

        def execute(self, sql, params=None):
            self.c.execute(rw(sql), params)
            return self

        def executemany(self, sql, rows):
            self.c.executemany(rw(sql), rows)
            return self

        def fetchone(self):
            return self.c.fetchone()

        def fetchall(self):
            return self.c.fetchall()

    class Conn:
        closed = broken = False

        def __init__(self, c):
            self.c = c

        def execute(self, sql, params=None):
            return self.c.execute(rw(sql), params)

        def cursor(self):
            return Cur(self.c.cursor(), self)

        def transaction(self):
            return self.c.transaction()

        def close(self):
            pass

    case = next((c for c in blob["cases"] if c["mode"] == "own" and c["tag"] not in relay["app_marks"]
                 and (relay["answers"].get(c["tag"]) or {}).get("status") == 200
                 and any(not it["read"] and not re.fullmatch(r"srv-\d+", it["id"])
                         for it in relay["answers"][c["tag"]]["data"]["items"])), None)
    store = main.MY_INBOX_STORE
    conn = rolled_back()
    held_names = (W.EDITS_TABLE, W.LOCK_KEY, IS.READS_TABLE, IS.SEEN_TABLE)
    W.EDITS_TABLE, W.LOCK_KEY = "pg_temp.hub_edits_check", 0x4D59494E424F58
    IS.READS_TABLE, IS.SEEN_TABLE = "pg_temp.inbox_reads", "pg_temp.inbox_seen"
    wrapped = Conn(conn)
    store._connect = lambda: wrapped
    try:
        why = store.ensure()
        check("main's My Inbox store makes its tables (receipts, writes, the read and seen marks) and is ready",
              not why and store.ready() and main.healthz().get("my_inbox_writes") is True, why)
        if case is None:
            check("a staff case with an unread alert to mark", False, "none among the cases")
        else:
            tag = case["tag"]
            said = {"uid": case["uid"], "role": case["role"], "is_master": False}
            payload = {"mode": "own", "why": case["why"], "person": "", **relay["handed"][tag]}

            def view():
                res = main._run(MI, "myInboxView", said, payload)
                return res, json.loads(res.body)

            def mark(keys, dismiss, wid=None):
                wid = wid or "Wcheck-inbox-" + os.urandom(6).hex()
                res = main._run_write(MIW, "myInboxRead", said, {"keys": keys, "dismiss": dismiss}, wid)
                return json.loads(res.body), wid

            res, first = view()
            a, b = norm(relay["answers"][tag]), norm(first)
            paths = diff(strip(a), strip(b))
            check(f"{tag}: the read through main's door is byte-identical to the relay's answer past the read stamps, "
                  "stamped with its copy's age", res.status_code == 200 and not paths and "X-Hub-As-Of" in res.headers,
                  f"{res.status_code} {len(paths)} paths, first {sorted(set(paths))[:6]}")
            target = next(it["id"] for it in first["data"]["items"]
                          if not it["read"] and not re.fullmatch(r"srv-\d+", it["id"]))
            got, wid = mark([target, "bad key!"], False)
            check(f"{tag}: the mark through main's write door answers as lane_my_inbox_read, no relay plan in it",
                  got == {"status": 200, "data": {"marked": 1, "ignored": 1}}, str(got)[:160])
            again, _ = mark([target, "bad key!"], False, wid)
            kept_rows = conn.execute("select count(*) from pg_temp.inbox_reads where user_id = %s",
                                     (case["uid"],)).fetchone()[0]
            receipts = conn.execute("select count(*) from pg_temp.my_inbox_receipts where write_id = %s",
                                    (wid,)).fetchone()[0]
            check(f"{tag}: the same write id again is its receipt — one mark, one receipt",
                  again == got and kept_rows == 1 and receipts == 1, f"{kept_rows} marks, {receipts} receipts")
            _res, second = view()
            it2 = next((it for it in second["data"]["items"] if it["id"] == target), None)
            check(f"{tag}: read again, the alert is read and one fewer is unread (the mark kept in asa-hub-db, merged)",
                  it2 is not None and it2["read"] is True and second["data"]["unread"] == first["data"]["unread"] - 1,
                  f"unread {first['data']['unread']} -> {second['data']['unread']}")
            got, _ = mark([target], True)
            _res, third = view()
            check(f"{tag}: cleared, the alert leaves the list on the next read",
                  got.get("status") == 200 and all(it["id"] != target for it in third["data"]["items"])
                  and (len(third["data"]["items"]) == len(second["data"]["items"]) - 1 or second["data"]["capped"]))
            refused, _ = mark(["srv-12"], False)
            check(f"{tag}: a company notice's mark sent to Python is deferred (the bell keeps it), nothing kept",
                  "defer" in refused and conn.execute("select count(*) from pg_temp.inbox_reads where user_id = %s",
                                                      (case["uid"],)).fetchone()[0] == 1, str(refused)[:120])
            facts["main's doors ran on"] = f"{tag}, a rolled-back transaction (temporary tables, its own lock key)"
    except Exception as exc:  # noqa: BLE001 - said as a failed check, never a value
        check("main's doors ran to the end", False, type(exc).__name__ + ": " + str(exc)[:240])
    finally:
        conn.rollback()
        conn.close()
        store._connect = None
        store._drop()
        store._ready = False
        W.EDITS_TABLE, W.LOCK_KEY, IS.READS_TABLE, IS.SEEN_TABLE = held_names
        IS.bind(None)
probe = psycopg.connect(os.environ["HUB_DB_DSN"], autocommit=True)
here = probe.execute("select to_regclass('app.inbox_reads') is not null").fetchone()[0]
left = probe.execute("select count(*) from app.inbox_reads where user_id like 'zz-inbox-check-%'").fetchone()[0] \
    if here else 0
probe.close()
check("nothing outlived the run (no check mark in app.inbox_reads)", left == 0)
facts["app.inbox_reads in asa-hub-db"] = "made" if here else "not made yet (its store makes it when asa-hub-app starts)"
print(json.dumps({"checks": checks, "facts": facts}))
'''


def lifted(text: str) -> dict[str, ast.AST]:
    nodes: dict[str, ast.AST] = {}
    for node in ast.parse(text).body:
        name = (node.name if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                else getattr(node.targets[0], "id", None) if isinstance(node, ast.Assign)
                else getattr(node.target, "id", None) if isinstance(node, ast.AnnAssign) else None)
        if name:
            nodes[name] = node
    return nodes


def relay_code() -> str:
    """The relay's lines the builder side runs as the relay would: whose account, the chooser and the hand."""
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    want = ("_roster_name_from", "_roster_name_of", "_user_badges", "_is_master_row", "_notice_accounts",
            "_my_inbox_people", "_my_inbox_handed")
    nodes = lifted(text)
    missing = [n for n in want if n not in nodes]
    if missing:
        raise RuntimeError(f"the relay lacks {missing}")
    return "\n\n".join(ast.get_source_segment(text, nodes[n]) or "" for n in want)


def relay_words() -> dict[str, str]:
    """lane_my_inbox_read's own refusals, read off its source."""
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    nodes = lifted(text)
    door = ast.get_source_segment(text, nodes["lane_my_inbox_read"]) or ""
    said = {"keys": "keys is required.", "no_alert": "None of those keys is an alert.",
            "session": "This session carries no account to keep the reads for."}
    out = {k: (v if f'"{v}"' in door else "?") for k, v in said.items()}
    out["too_many"] = "At most 500 keys at once." if 'f"At most {my_inbox.READ_MAX} keys at once."' in door else "?"
    out["visit"] = ast.literal_eval(nodes["_MY_INBOX_VISIT"].value)
    return out


def static() -> int:
    failed = 0

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal failed
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1

    for f in ("app/inbox_state.py", "app/my_inbox_writes.py", "app/my_inbox.py", "server/my_inbox.py",
              "server/snapshot_service.py"):
        if not (ROOT / f).exists():
            check(f"{f} is in the checkout", False, "missing")
            continue
        try:
            py_compile.compile(str(ROOT / f), doraise=True)
            check(f"{f} compiles", True)
        except py_compile.PyCompileError as exc:
            check(f"{f} compiles", False, str(exc)[-300:])
    mine = {f: (ROOT / "app" / f).read_text(encoding="utf-8") for f in ("inbox_state.py", "my_inbox_writes.py")}
    targets = {t for text in mine.values()
               for t in re.findall(r"(?:insert\s+into|delete\s+from|(?<!do )update)\s+(\{?[\w.]+\}?)", text, re.I)}
    check("the marks are written to app.inbox_reads and app.inbox_seen alone",
          targets <= {"{READS_TABLE}", "{SEEN_TABLE}"}, str(sorted(targets)))
    check("the marks never read the relay (no relay DSN, no relay table)",
          not any(w in text for text in mine.values() for w in ("HUB_RELAY_RO_DSN", "MIRROR_DSN", "asa_hub_",
                                                                  "PG_DSN")))
    # server/my_inbox.py's words for keys and marks, carried over unchanged
    server = ast.parse((ROOT / "server" / "my_inbox.py").read_text(encoding="utf-8"))
    consts = {n.targets[0].id: n.value for n in server.body if isinstance(n, ast.Assign)
              and isinstance(n.targets[0], ast.Name)}
    src = (ROOT / "app" / "inbox_state.py").read_text(encoding="utf-8")
    ours = {n.targets[0].id: n.value for n in ast.parse(src).body if isinstance(n, ast.Assign)
            and isinstance(n.targets[0], ast.Name)}
    same = [ast.literal_eval(consts[n]) == ast.literal_eval(ours[n])
            for n in ("READ_MAX", "BASELINE", "PRUNE_KINDS", "PRUNE_DAYS")]
    same += [ast.literal_eval(consts[n].args[0]) == ast.literal_eval(ours[n].args[0])
             for n in ("KEY_RE", "NOTICE_KEY_RE")]
    check("app/inbox_state.py carries server/my_inbox.py's words: the keys, the cap, the baseline, the prune", all(same))
    check("the two tables keep the relay's columns: (user_id, alert_key, read_at, dismissed_at), (kind, key, "
          "first_seen)", "user_id text not null, alert_key text not null" in src and "dismissed_at timestamptz" in src
          and "kind text not null, key text not null" in src and "first_seen timestamptz not null default now()" in src)
    if (ROOT / "app" / "my_inbox.py").exists():
        app_mi = (ROOT / "app" / "my_inbox.py").read_text(encoding="utf-8")
        ids = set(re.findall(r'EDITION_ANYONE\s*=\s*"([^"]+)"', app_mi))
        relay = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
        said = re.search(r"_MY_INBOX_EDITIONS = frozenset\(\{([^}]*)\}\)", relay)
        check("the edition the relay takes a widened answer under is app/my_inbox.py's any-person edition",
              bool(ids) and said is not None and set(re.findall(r'"([^"]+)"', said.group(1))) == ids,
              f"app {sorted(ids)}, relay {said.group(1) if said else None}")
        named = set(re.findall(r'EDITION_(?:ANYONE|DIRECTORS)\s*=\s*"([^"]+)"', app_mi))
        cat = (ROOT / "app" / "editions.py").read_text(encoding="utf-8")
        listed = set(re.findall(r'\{"id": "(myInbox\.[A-Za-z]+)", "app": "my-inbox", "app_name": "My Inbox"', cat))
        overlay = (ROOT / "server" / "edit_overlay.py").read_text(encoding="utf-8")
        ts = (ROOT / "src" / "lib" / "editions.ts").read_text(encoding="utf-8")
        check("My Inbox's two editions are in the catalogue under my-inbox, the relay's overlay ids and the page's list",
              named == listed == {"myInbox.anyone", "myInbox.directors"}
              and all(f'"{e}"' in overlay and f"'{e}'" in ts for e in named), f"{sorted(named)} / {sorted(listed)}")
    base = subprocess.run(["git", "-C", str(ROOT), "merge-base", "HEAD", "asa_dev"], capture_output=True, text=True)
    touched = subprocess.run(["git", "-C", str(ROOT), "diff", "--name-only", base.stdout.strip() or "asa_dev", "--",
                              "apps-script"], capture_output=True, text=True).stdout.split()
    touched += subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain", "--", "apps-script"],
                              capture_output=True, text=True).stdout.split()[1::2]
    check("no Apps Script file is changed", not touched, str(touched[:5]))
    return failed


def relay_wiring() -> int:
    """The relay's own lines, lifted and run with stubs: the switch entry, the hand, the lane's Python call, both doors."""
    failed = 0

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal failed
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1

    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    nodes = lifted(text)
    # app/inbox_state.py's key split, the relay's mark door judges keys with server/my_inbox.py's own (the same words)
    import importlib.util
    held_mods = {k: sys.modules.get(k) for k in ("gsjs", "hubdb", "scope")}
    sys.modules.update(gsjs=types.SimpleNamespace(trim=lambda s: str(s).strip(),
                                                  or_blank=lambda v: "" if v is None else str(v)),
                       hubdb=types.SimpleNamespace(Unreadable=RuntimeError),
                       scope=types.SimpleNamespace(Defer=type("Defer", (Exception,), {})))
    try:
        spec = importlib.util.spec_from_file_location("inbox_state_wiring", ROOT / "app" / "inbox_state.py")
        IS = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(IS)
    finally:
        for k, v in held_mods.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v
    calls: list = []

    class Log:
        def warning(self, *_a, **_k):
            calls.append({"warned": True})

        info = warning

    ns: dict = {"Any": object, "re": re, "json": json, "time": __import__("time"), "os": __import__("os"),
                "asyncio": asyncio, "hashlib": __import__("hashlib"), "HUB_APP_TIMEOUT_S": 10.0,
                "HUB_APP_PACK_TIMEOUT_S": 60.0, "_APP_PACK_CLIENTS": "client-profiles",
                "_APP_PACK_STAFF_TEAM": "staff-team", "_APP_PACK_SSAS": "ssa-profiles",
                "_APP_PACK_FAMILIES": "family-profiles", "_APP_PACK_CANDIDATES": "candidates",
                "_APP_PACK_LEADS": "leads", "SCHEDULING_EVENT": "scheduling",
                "VEHICLE_CALENDAR_EVENT": "vehicle-calendar", "EMERGENCY_CONTACTS_EVENT": "emergency-contacts",
                "log": Log()}
    names = ("BACKEND_APPS", "_BACKEND_ACTIONS", "_BACKEND_WRITES", "_BACKEND_FINAL", "BACKEND_FINAL_UNWRITTEN",
             "_BACKEND_EDITION_APPS", "_MY_INBOX_DOWN", "_MY_INBOX_ROLES_REFUSED", "_MY_INBOX_LANES",
             "_MY_INBOX_VISIT", "_MY_INBOX_OWN_ONLY", "_MY_INBOX_ACTING", "_MY_INBOX_BUDGET_S", "_my_inbox_people",
             "MY_INBOX_APP", "MY_INBOX_PYTHON_READ", "MY_INBOX_PYTHON_MARK", "MY_INBOX_SEND_STATE",
             "MY_INBOX_PYTHON_TIMEOUT_S", "_MY_INBOX_KEYS", "_MY_INBOX_EDITIONS", "_MY_INBOX_EDITION_REFUSALS",
             "_MY_INBOX_UNCHECKED", "_MY_INBOX_UNMARKED", "_my_inbox_on", "_my_inbox_marks_read",
             "_my_inbox_punch_board", "_my_inbox_handed", "_my_inbox_python", "_my_inbox_mark_python",
             "lane_my_inbox", "lane_my_inbox_read", "_LANE_KEEP_ROW_NAMES", "_LANE_KEEP_PATH_WRITES",
             "_lane_keep_path_names")
    missing = [n for n in names if n not in nodes]
    check("the relay carries every line this check runs", not missing, str(missing))
    if missing:
        return failed

    class Route:
        def _route(self, *_a, **_k):
            return lambda fn: fn
        get = post = _route

    ns.update(app=Route(), Header=lambda default="": default, Response=object, Request=object)
    for n in names:
        exec(compile(ast.Module(body=[nodes[n]], type_ignores=[]), "snapshot_service.py", "exec",
                     flags=__future__.annotations.compiler_flag, dont_inherit=True), ns)
    apps, reads, writes = ns["BACKEND_APPS"], ns["_BACKEND_ACTIONS"], ns["_BACKEND_WRITES"]
    mi = apps.get("my-inbox") or {}
    check("Settings › Back-end per app lists My Inbox: its lane, its read, its mark kept final in Python",
          mi.get("label") == "My Inbox" and mi.get("lane") == "/hub-lanes/my-inbox"
          and mi.get("reads") == {"myInboxView"} and mi.get("writes") == {"myInboxRead"}
          and mi.get("final") == {"myInboxRead"} and "pack" not in mi, str(mi)[:200])
    check("neither the lane's read nor its mark is routed from /gas (the relay's doors call them); every other "
          "app's writes still are", "myInboxView" not in reads and "myInboxRead" not in writes
          and writes.get("staffProfileAddressEdit") == "my-profile" and writes.get("emergencyContactsSave"))
    check("My Inbox's editions are offered only while My Inbox runs on Python",
          ns["_BACKEND_EDITION_APPS"].get("my-inbox") == "my-inbox")
    check("the mark's ring: a 200 from POST /hub-lanes/my-inbox/read rings my-inbox, so other open tabs read again",
          ns["_lane_keep_path_names"]({"type": "http", "method": "POST", "path": "/hub-lanes/my-inbox/read"})
          == ("my-inbox",))

    # the relay's two tables, read-only: this account's marks, every first sighting, ISO stamps
    from datetime import datetime, timezone
    at = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
    pg: dict = {"sql": [], "session": None, "here": (True, True)}

    class Cur:
        def __init__(self):
            self.rows = []

        def execute(self, sql, params=None):
            pg["sql"].append((sql, params))
            if "to_regclass" in sql:
                self.rows = [pg["here"]]
            elif "asa_hub_inbox_reads" in sql:
                self.rows = [("u-1", "requests:a", at, None)]
            else:
                self.rows = [("client", "~baseline", at), ("client", "c1", at)]

        def fetchone(self):
            return self.rows[0] if self.rows else None

        def fetchall(self):
            return self.rows

        def __enter__(self):
            return self

        def __exit__(self, *_a):
            pass

    class Conn:
        def set_session(self, **kw):
            pg["session"] = kw

        def cursor(self):
            return Cur()

        def close(self):
            pass

    ns.update(psycopg2=types.SimpleNamespace(connect=lambda *_a, **_k: Conn()), PG_DSN="dsn")
    got = ns["_my_inbox_marks_read"]("u-1")
    reads_sql = next((s for s in pg["sql"] if "FROM asa_hub_inbox_reads" in s[0]), ("", None))
    check("the relay's marks are read read-only: this account's rows alone, every first sighting, stamps as ISO text",
          pg["session"] == {"readonly": True, "autocommit": True} and reads_sql[1] == ("u-1",)
          and got == {"user_id": "u-1", "reads": [{"user_id": "u-1", "alert_key": "requests:a",
                                                   "read_at": at.isoformat(), "dismissed_at": None}],
                      "seen": [{"kind": "client", "key": "~baseline", "first_seen": at.isoformat()},
                               {"kind": "client", "key": "c1", "first_seen": at.isoformat()}]}, str(got)[:200])
    pg.update(sql=[], here=(False, False))
    check("tables not made yet hand no rows", ns["_my_inbox_marks_read"]("u-1") == {"user_id": "u-1", "reads": [],
                                                                                    "seen": []})
    with tempfile.TemporaryDirectory() as tmp:
        board = Path(tmp, "board.json")
        ns["punch_board_slices"] = types.SimpleNamespace(BOARD_FILE=board)
        missing_ok = ns["_my_inbox_punch_board"]() == {"punch_board_error": "missing"}
        board.write_text('{"status": {"read_at": "x"}, "rows": []}')
        body_ok = ns["_my_inbox_punch_board"]() == {"punch_board": {"status": {"read_at": "x"}, "rows": []}}
        board.write_text("{not json")
        error_ok = ns["_my_inbox_punch_board"]() == {"punch_board_error": "JSONDecodeError"}
    check("the punch board is handed as written: its body, \"missing\" before the first, or the error's name",
          missing_ok and body_ok and error_ok)

    # what the relay hands Python with each read
    seen_calls: dict = {}
    hand = {"switch": {"on": False, "readable": True, "word": "off", "why": ""}, "accounts": None,
            "marks_fail": False, "who_fail": False, "notices": "got", "notices_loaded": True}

    async def to_thread(fn, *a, **k):
        return fn(*a, **k)

    def accounts():
        if hand["accounts"] is None:
            raise RuntimeError("no users copy")
        return hand["accounts"]

    def marks_read(uid):
        seen_calls["marks_uid"] = uid
        if hand["marks_fail"]:
            raise RuntimeError("unreadable")
        return {"user_id": uid, "reads": [], "seen": []}

    def viewer(dsn, **k):
        if hand["who_fail"]:
            raise RuntimeError("no estate")
        seen_calls["viewer"] = k
        return {"name": k["name"], "houses": []}

    class Notices:
        @staticmethod
        def inbox(dsn, *, who, uid, limit, held):
            seen_calls["notices"] = {"who": who, "uid": uid, "limit": limit, "held": held}
            if hand["notices"] == "error":
                raise ConnectionError("down")
            return {"notices": [{"id": 1, "title": "t", "published_at": "2026-10-01T12:00:00+00:00"}], "held": ""}

    ns["asyncio"] = types.SimpleNamespace(to_thread=to_thread, gather=asyncio.gather)
    ns.update(_notice_accounts=accounts, _my_inbox_marks_read=marks_read, _web_switch=lambda: dict(hand["switch"]),
              _lane_alerts_off=lambda uid: ["support_new"] if uid == "u-1" else [],
              _my_inbox_punch_board=lambda: {"punch_board_error": "missing"},
              _roster_name_of=lambda uid, strict=False: "Ann Lee", _user_badges=lambda uid: "HM",
              shift_requests=types.SimpleNamespace(viewer=viewer),
              _hotline_token=lambda a: a[7:] if a.startswith("Bearer ") else "", _auth_master={"m-tok": True})

    def handed(actor=("staff", "u-1"), person="", auth="Bearer s-tok"):
        seen_calls.clear()
        ns["web_notices"] = Notices() if hand["notices_loaded"] else None
        return asyncio.run(ns["_my_inbox_handed"](auth, actor, person))

    got = handed()
    check("own: the subject's marks and every first sighting, the test mode switch as the relay reads it, the punch "
          "board and the bell's notices for it (judged with the alerts it turned off)",
          set(got) == {"test_mode", "punch_board_error", "inbox_marks", "notices"}
          and got["test_mode"] == hand["switch"] and got["punch_board_error"] == "missing"
          and seen_calls.get("marks_uid") == "u-1" and got["notices"]["notices"][0]["id"] == 1
          and seen_calls["notices"]["uid"] == "u-1" and seen_calls["notices"]["limit"] == 200
          and seen_calls["notices"]["held"] == "" and seen_calls["notices"]["who"].get("alerts_off") == ["support_new"]
          and seen_calls["viewer"] == {"name": "Ann Lee", "role": "staff", "types": "HM", "is_master": False},
          str(sorted(got))[:200])
    hand["switch"] = {"on": True, "readable": False, "word": "unreadable", "why": "x"}
    got = handed()
    check("test mode on: its switch handed as read, and the bell is never asked (no notices handed)",
          got["test_mode"]["on"] is True and "notices" not in got and "notices_error" not in got
          and "notices" not in seen_calls)
    hand["switch"] = {"on": False, "readable": True, "word": "off", "why": ""}
    hand["notices_loaded"] = False
    got = handed()
    check("no notices lane on this relay: neither the notices nor an error handed",
          "notices" not in got and "notices_error" not in got)
    hand.update(notices_loaded=True, notices="error")
    check("the bell failing: handed as its error's name", handed().get("notices_error") == "ConnectionError")
    hand["notices"] = "got"
    hand["marks_fail"] = True
    check("the relay's marks unreadable: nothing handed (the relay's builder answers)", handed() is None)
    hand.update(marks_fail=False, who_fail=True)
    check("the subject's roster reader unreadable: nothing handed (the builder says why)", handed() is None)
    hand["who_fail"] = False
    got = handed(actor=("admin", "m-1"), auth="Bearer m-tok")
    check("the master's own: the master's flag on the viewer, no chooser handed (Python lists the people)",
          seen_calls["viewer"]["is_master"] is True and seen_calls["marks_uid"] == "m-1" and "people" not in got)
    hand["accounts"] = [{"uid": "u-1", "role": "staff", "types": "", "label": "Bea", "unlisted": ""},
                        {"uid": "u-2", "role": "manager", "types": "DIRECTOR", "label": "al", "unlisted": ""}]
    got = handed(actor=("admin", "m-1"), person="u-2", auth="Bearer m-tok")
    check("a chosen person: that account's marks, its own role and badges, never the session's flag",
          seen_calls["marks_uid"] == "u-2" and seen_calls["viewer"] == {"name": "Ann Lee", "role": "manager",
                                                                         "types": "DIRECTOR", "is_master": False}
          and seen_calls["notices"]["uid"] == "u-2")
    got = handed(actor=("staff", "u-1"), person="u-9")
    check("a person who is no active account: the marks handed, the bell never asked (Python refuses the person)",
          got is not None and seen_calls["marks_uid"] == "u-9" and "notices" not in seen_calls and "notices" not in got)
    hand["accounts"] = None
    check("the accounts unreadable with a person chosen: nothing handed",
          handed(actor=("admin", "m-1"), person="u-2", auth="Bearer m-tok") is None)
    ns["asyncio"] = asyncio

    # the lane's Python call: asked with the scope the relay decided, its answer taken only when it keeps that scope
    state = {"wanted": True, "settling": False, "answer": None, "handed": {"test_mode": {}, "inbox_marks": {}}}

    async def wanted(app_id):
        return state["wanted"] and app_id == "my-inbox"

    async def call(app_id, action, payload, user, extra=None, timeout=None):
        calls.append({"app": app_id, "action": action, "payload": payload, "user": user, "extra": extra,
                      "timeout": timeout})
        ans = state["answer"]
        return None if ans is None else (b"", 0.0, json.loads(json.dumps(ans)), None, 0.0)

    async def handed_stub(_auth, _actor, _person):
        return state["handed"]

    shown: list = []
    ns.update(_backend_wanted=wanted, _backend_settling=lambda: state["settling"], _backend_call=call,
              _traffic_note=lambda *_a: None, my_work=types.SimpleNamespace(MODE_MASS="mass", MODE_OWN="own"),
              _my_work_state_read=lambda: {"v": 1, "tables": {}}, _my_inbox_handed=handed_stub,
              _my_work_display=lambda mode: {"hidden": {"inbox_sources": False}},
              my_inbox=types.SimpleNamespace(apply_display=lambda d, disp: (shown.append(disp), d.update(display=disp))))
    own = {"mode": "own", "why": ""}
    mass = {"mode": "mass", "why": MASS_WHY}
    edition_id = sorted(ns["_MY_INBOX_EDITIONS"])[0]

    def answer(mode, person="", readonly=None, drop="", status=200, display=True, edition="", reason=""):
        scope = {"mode": mode, "why": "", "person": person, "readonly": bool(person) if readonly is None else readonly}
        if edition:
            scope["edition"] = edition
        data = {"subject": {}, "heads": [], "items": [], "unread": 0, "capped": "", "marks": {}, "read_at": "x",
                "scope": scope}
        if display:
            data["display"] = {"hidden": {"inbox_sources": False}}
        data.pop(drop, None)
        return {"status": status, "data": data} if status == 200 else {"status": status, "reason": reason,
                                                                          "message": "m"}

    def ask(scope, person="", session=("staff", "u-1")):
        calls.clear()
        return asyncio.run(ns["_my_inbox_python"]("Bearer t", session, scope, person))

    state["wanted"] = False
    check("off Python the relay's own builder answers, and Python is not asked", ask(own) is None and not calls)
    state.update(wanted=True, settling=True)
    check("while App Control settles the relay's own builder answers", ask(own) is None and not calls)
    state.update(settling=False, answer=answer("own"))
    got = ask(own)
    sent = next((c for c in calls if c.get("action")), {})
    check("on Python, myInboxView is asked with exactly the scope the relay decided and what it holds",
          got == {"status": 200, "data": json.loads(json.dumps(answer("own")))["data"]}
          and sent.get("app") == "my-inbox" and sent.get("action") == "myInboxView"
          and sent.get("payload") == {"mode": "own", "why": "", "person": "", "test_mode": {}, "inbox_marks": {}}
          and sent.get("user") == {"uid": "u-1", "role": "staff", "is_master": False}
          and sent.get("timeout") == ns["MY_INBOX_PYTHON_TIMEOUT_S"], str(sent)[:200])
    for label, ans in (("the master's scope", answer("mass")), ("another person", answer("own", person="u-2")),
                       ("marks said read-only on the caller's own", answer("own", readonly=True)),
                       ("a scope widened under an unknown edition", answer("mass", edition="other.edition")),
                       ("a missing part", answer("own", drop="marks")),
                       ("a refusal", answer("own", status=403, reason="scope"))):
        state["answer"] = ans
        check(f"own scope: Python's answer with {label} is not taken (the relay's builder answers)", ask(own) is None)
    state["answer"] = None
    check("Python deferring or failing: the relay's builder answers", ask(own) is None and len(calls) == 1)
    state["answer"] = answer("mass", edition=edition_id)
    check("a holder's own read, widened under the edition with nobody chosen, is taken", ask(own) is not None)
    state["answer"] = answer("mass", person="u-2")
    got = ask(mass, person="u-2", session=("admin", "m-1"))
    sent = next((c for c in calls if c.get("action")), {})
    check("the master's chosen person: asked as the master, taken when it is that person, read-only",
          got is not None and sent.get("user", {}).get("is_master") is True
          and sent.get("payload", {}).get("person") == "u-2")
    state["answer"] = answer("mass", person="u-3")
    check("the master's chosen person: another person's answer is not taken", ask(mass, person="u-2") is None)
    state["answer"] = answer("mass", person="u-2", readonly=False)
    check("the master's chosen person: an answer that would keep marks is not taken", ask(mass, person="u-2") is None)
    state["answer"] = answer("mass", person="u-2", edition=edition_id)
    got = ask(own, person="u-2")
    check("an edition's ask: Python's answer widened under the edition for that person, read-only, is taken",
          got is not None and got["data"]["scope"]["edition"] == edition_id)
    state["answer"] = answer("mass", person="u-3", edition=edition_id)
    check("an edition's ask: another person's answer is not taken", ask(own, person="u-2") is None)
    state["answer"] = answer("own", person="u-2")
    check("an edition's ask: an answer not said under the edition is not taken", ask(own, person="u-2") is None)
    state["answer"] = answer("own", status=403, reason="scope")
    got = ask(own, person="u-2")
    check("an edition's ask: Python's refusal is the answer (nobody listed is refused, never shown their own)",
          got == {"status": 403, "reason": "scope", "message": "m"}, str(got))
    state["answer"] = answer("own", status=503, reason="unreadable")
    check("an edition's ask: any other failure is no answer", ask(own, person="u-2") is None)
    shown.clear()
    state["answer"] = answer("own", display=False)
    got = ask(own)
    check("an answer without its display is shown as the relay judges the session (Settings › My Work)",
          got is not None and shown == [{"hidden": {"inbox_sources": False}}])
    state["handed"] = None
    state["answer"] = answer("own")
    check("nothing handed: Python is not asked, the builder answers", ask(own) is None and not calls)
    state["handed"] = {"test_mode": {}, "inbox_marks": {}}

    # the read door, run whole with stubs: Python first, the builder below, an edition's ask never kept nor built here
    door: dict = {"scope": {"mode": "own", "why": ""}, "python": None, "family": False, "acting": False}
    seen_door = {"kept": 0, "built": 0, "asked": 0, "family": 0}

    async def gate_stub(_auth, member):
        if member:
            return {"status": 403, "reason": "visit", "message": ns["_MY_INBOX_VISIT"]}
        return dict(door["scope"]), ("staff", "u-1")

    async def python_stub(_auth, _actor, _scope, _person):
        seen_door["asked"] += 1
        return door["python"]

    async def kept_stub(read, _auth, params, mode, _actor, build):
        seen_door["kept"] += 1
        return await build()

    async def family_stub(*_a):
        seen_door["family"] += 1
        return {"status": 200, "data": {"family": True}}

    async def access_stub(*_a, **_k):
        return {}

    def board_stub(dsn, **k):
        seen_door["built"] += 1
        return {"heads": [], "built": True}

    marks_seen: list = []
    inbox_ns = types.SimpleNamespace(
        PERSON_RE=re.compile(r"[A-Za-z0-9_-]{1,64}"), READ_MAX=500, split_keys=IS.split_keys,
        read_updates=lambda dsn: {}, updates_apps=lambda u: [], board=board_stub, apply_display=lambda d, disp: d,
        KEPT_WHY_CHOSEN="c", KEPT_WHY_ACTING="a",
        mark_read=lambda dsn, uid, keys, dismiss: (marks_seen.append(("relay", uid, list(keys), dismiss)), len(keys))[1])
    notices_marked: list = []
    ns.update(_my_inbox_gate=gate_stub, _my_inbox_python=python_stub, _lane_kept=kept_stub,
              _my_family_session=lambda _a: door["family"], _my_inbox_family=family_stub,
              _my_work_acting=lambda _t: door["acting"], _roster_name_of=lambda uid, strict=False: "N",
              _user_badges=lambda uid: "", shift_requests=types.SimpleNamespace(viewer=lambda dsn, **k: {"name": "N"}),
              my_work=types.SimpleNamespace(MODE_MASS="mass", MODE_OWN="own", identity=lambda *a, **k: {"keys": []},
                                            requests_for=lambda *a, **k: ([], [])),
              hotline_lanes=None, hotline_desk=None, my_inbox=inbox_ns, _my_inbox_access=access_stub,
              _web_switch=lambda: {"on": False, "readable": True}, _lane_alerts_off=lambda uid: [],
              web_notices=types.SimpleNamespace(
                  inbox=lambda *a, **k: {"notices": []},
                  mark_read=lambda dsn, uid, ids, dismiss: (notices_marked.append((uid, list(ids), dismiss)),
                                                            len(ids))[1]),
              OUT_DIR=Path("/nonexistent"), punch_board_slices=types.SimpleNamespace(BOARD_FILE=Path("/nonexistent")),
              _auth_master={}, HUB_DB_SHEET_ID="core",
              asyncio=types.SimpleNamespace(to_thread=to_thread, gather=asyncio.gather))

    class Resp:
        headers: dict = {}

    def view(person=""):
        for k in seen_door:
            seen_door[k] = 0
        return asyncio.run(ns["lane_my_inbox"](Resp(), member="", person=person, authorization="Bearer t"))

    state.update(wanted=True, settling=False)
    door["python"] = {"status": 200, "data": {"py": True}}
    got = view()
    check("the lane: on Python it answers with Python's, kept, the builder never run",
          got == {"status": 200, "data": {"py": True}} and seen_door == {"kept": 1, "built": 0, "asked": 1,
                                                                          "family": 0}, str(seen_door))
    door["python"] = None
    got = view()
    check("the lane: Python answering nothing, the relay's builder answers as before",
          (got.get("data") or {}).get("built") is True and seen_door["built"] == 1 and seen_door["asked"] == 1,
          str(got)[:160])
    door.update(acting=True, python={"status": 200, "data": {"py": True}})
    got = view()
    check("a session whose marks are not kept: Python is never asked, the builder answers read-only",
          seen_door["asked"] == 0 and seen_door["built"] == 1 and (got.get("data") or {}).get("scope", {}).get(
              "readonly") is True, str(got)[:160])
    got = view(person="u-2")
    check("such a session asking for another person: 403 own only, as before",
          got.get("status") == 403 and seen_door["asked"] == 0 and seen_door["built"] == 0)
    door.update(acting=False, family=True)
    view()
    check("a client-role session: its own board as before, Python never asked",
          seen_door["family"] == 1 and seen_door["asked"] == 0 and seen_door["built"] == 0)
    got = view(person="u-2")
    check("a client-role session asking for a person: 403 as before", got.get("status") == 403
          and seen_door["asked"] == 0)
    door["family"] = False
    state["wanted"] = False
    got = view(person="u-2")
    check("another person while My Inbox is not on Python: 403 own only before anything",
          got.get("status") == 403 and got.get("message") == ns["_MY_INBOX_OWN_ONLY"] and seen_door["asked"] == 0)
    state["wanted"] = True
    door["python"] = None
    got = view(person="u-2")
    check("an edition's ask Python cannot answer is said unchecked, never built here, never kept",
          got == ns["_MY_INBOX_UNCHECKED"] and seen_door["built"] == 0 and seen_door["kept"] == 0)
    door["python"] = {"status": 200, "data": {"py": "u-2"}}
    got = view(person="u-2")
    check("an edition's ask Python answers is that answer, never kept", got["data"] == {"py": "u-2"}
          and seen_door["kept"] == 0)
    check("a person the pattern refuses is refused 400 first", view(person="<bad>").get("status") == 400)

    # the mark door: Python keeps the alert marks when on; a notice's are the bell's; any failure is 503
    class Req:
        def __init__(self, body):
            self.body = body

        async def json(self):
            if isinstance(self.body, Exception):
                raise self.body
            return self.body

    settled: list = []
    ns.update(_backend_settle_soon=lambda app_id, wid, st, *a, **k: settled.append((app_id, wid, st)))

    def mark(body, wanted_=True, answer_=None, family=False, acting=False):
        calls.clear()
        marks_seen.clear()
        notices_marked.clear()
        settled.clear()
        state.update(wanted=wanted_, settling=False, answer=answer_)
        door.update(family=family, acting=acting)
        return asyncio.run(ns["lane_my_inbox_read"](Req(body), member="", authorization="Bearer t"))

    body = {"keys": ["srv-7", "requests:a1", "sched:x:y", "bad key!"], "dismiss": True}
    got = mark(body, wanted_=False)
    check("off Python: today's path — the bell marks its notice, the relay its alerts, Python never asked",
          got == {"status": 200, "data": {"marked": 3, "ignored": 1}}
          and marks_seen == [("relay", "u-1", ["requests:a1", "sched:x:y"], True)]
          and notices_marked == [("u-1", [7], True)] and not [c for c in calls if c.get("action")], str(got))
    ok = {"status": 200, "data": {"marked": 2, "ignored": 0}}
    got = mark(body, answer_=ok)
    sent = next((c for c in calls if c.get("action")), {})
    wid = (sent.get("extra") or {}).get("write_id", "")
    check("on Python: myInboxRead asked with the alert keys alone and the clearing, under a fresh write id; the bell "
          "marks its notice; the relay keeps no alert mark",
          got == {"status": 200, "data": {"marked": 3, "ignored": 1}} and sent.get("action") == "myInboxRead"
          and sent.get("payload") == {"keys": ["requests:a1", "sched:x:y"], "dismiss": True}
          and sent.get("user") == {"uid": "u-1", "role": "staff", "is_master": False}
          and bool(re.fullmatch(r"W[0-9a-f]{24}", wid)) and notices_marked == [("u-1", [7], True)] and not marks_seen,
          str(sent)[:200])
    got = mark(body, answer_=None)
    check("on Python, Python not answering: 503 said, nothing kept here, the notice not marked, the write let go",
          got == ns["_MY_INBOX_UNMARKED"] and got["status"] == 503 and not marks_seen and not notices_marked
          and settled and settled[0][0] == "my-inbox" and settled[0][2] == "void", str(got))
    got = mark(body, answer_={"status": 409, "message": "busy"})
    check("on Python, Python's own refusal is the answer (nothing kept here)",
          got == {"status": 409, "message": "busy"} and not marks_seen and not notices_marked)
    got = mark(body, answer_={"status": 200, "data": {}})
    check("on Python, an answer without its count is 503", got["status"] == 503 and not notices_marked)
    got = mark({"keys": ["srv-7"]}, answer_=ok)
    check("on Python, notices alone: the bell marks them, Python is not asked",
          got == {"status": 200, "data": {"marked": 1, "ignored": 0}} and not [c for c in calls if c.get("action")])
    got = mark(body, answer_=ok, family=True)
    check("a client-role session on Python: its marks stay where its board reads them (the relay's)",
          marks_seen == [("relay", "u-1", ["requests:a1", "sched:x:y"], True)]
          and not [c for c in calls if c.get("action")])
    got = mark(body, answer_=ok, acting=True)
    check("a session whose marks are not kept: refused 409 before anything, as before",
          got == ns["_MY_INBOX_ACTING"] and not calls and not marks_seen)
    for label, b, want in (("no keys", {}, (400, "keys is required.")),
                           ("too many", {"keys": ["requests:a"] * 501}, (400, "At most 500 keys at once.")),
                           ("no alert", {"keys": ["!!"]}, (400, "None of those keys is an alert.")),
                           ("a visit in the body", {"keys": ["requests:a"], "member": "x"},
                            (403, ns["_MY_INBOX_VISIT"])),
                           ("an unreadable body", ValueError("x"), (400, "The body could not be read."))):
        got = mark(b, answer_=ok)
        check(f"the mark door's refusals are unchanged on Python: {label}",
              (got.get("status"), got.get("message")) == want and not [c for c in calls if c.get("action")],
              str(got)[:120])
    return failed


def run(container: str, script: str, blob: dict | None, tag: str, timeout: int) -> dict | None:
    stdin = (base64.b64encode(json.dumps(blob, default=str).encode()) + b"\n") if blob is not None else b""
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", container, "nice", "-n", "19", "python",
                          "-c", script], input=stdin, capture_output=True, timeout=timeout)
    out = got.stdout.decode()
    line = next((x for x in out.splitlines() if x.startswith(tag + " ")), "") if tag else \
        (out.strip().splitlines() or [""])[-1]
    if not line:
        print(f"FAIL the {tag or 'compare'} side ran in {container}")
        print(got.stderr.decode()[-2500:])
        return None
    return json.loads(line[len(tag) + 1:] if tag else line)


def main() -> int:
    print("STATIC")
    failed = static()
    print("\nRELAY WIRING — the relay's My Inbox lines, run as the relay runs them")
    failed += relay_wiring()
    if "--wiring" in sys.argv:
        print(f"\n{'all ok' if not failed else f'{failed} failed'}")
        return 1 if failed else 0
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    print(f"\nPICK — the cases, off asa-hub-db, in {RUNNER}")
    picked = run(RUNNER, PICK, {"app": app, "staff": STAFF, "chosen": CHOSEN, "mass_why": MASS_WHY,
                                "variants": VARIANTS}, "PICK_RESULT", 300)
    if picked is None:
        return 1
    cases = picked["cases"]
    print(f"fact cases: {len(cases)} ({sum(1 for c in cases if c['mode'] == 'own')} staff own, "
          f"{sum(1 for c in cases if c['mode'] == 'mass')} master); staff My Inbox opens to: {picked['opened']} of "
          f"{picked['staff']}; shapes handed: {', '.join(c['tag'] + ' ' + c['variant'] for c in cases)}")
    if not picked["master"]:
        print("FAIL the master's users row is not in asa-hub-db")
        failed += 1
    print(f"\nDUMP — the relay's marks, first sightings, slices and punch board, read-only in {RELAY_HOST}")
    dumped = run(RELAY_HOST, DUMP, None, "DUMP_RESULT", 120)
    if dumped is None:
        return 1
    print(f"fact relay tables: {dumped['tables']}; {len(dumped['reads'])} read marks, {len(dumped['seen'])} first "
          f"sightings; slices {sorted(k for k, v in dumped['slices'].items() if v)}; punch board "
          f"{'present' if dumped['board'] else 'absent'}")
    print(f"\nRELAY — the relay's hand and server/my_inbox.py over its copy (read-only role), in {RUNNER}")
    server = lane_schema.with_imports(ROOT / "server", ("my_inbox", "hotline_desk", "effective_roster",
                                                        "house_directory"))
    relay = run(RUNNER, RELAY, {"server": server, "relay_code": relay_code(), "cases": cases, "dump": dumped,
                                "marked": list(MARKED), **{k: picked[k] for k in ("homes", "lanes", "cut",
                                                                                  "seen_list", "hide",
                                                                                  "alerts_off")}},
                "RELAY_RESULT", BUDGET_S)
    if relay is None:
        return 1
    for k, v in relay.get("facts", {}).items():
        print(f"fact {k}: {v}")
    print(f"\nPYTHON — app/my_inbox.py through its door with the relay's hand; the mark door rolled back, in {RUNNER}")
    res = run(RUNNER, COMPARE, {"app": app, "cases": cases, "relay": relay, "relay_words": relay_words()}, "",
              BUDGET_S)
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
