#!/usr/bin/env python3
"""My Work on Python (app/my_work.py) against the relay's own builder (server/my_work.py): eight people in their own
scope and the master's mass view. The relay side runs in asa-hub-snapshot as one short read-only process (DDL
skipped, every connection read-only) and hands back its boards and its state tables in the form the relay sends them
(_my_work_state_read); the Python side runs in asa-hub-db-sync with app/*.py streamed in, called with the payload the
relay sends. Both sides see the same display parts and no hotline lanes (the relay side cannot read the lanes here).
The accessor is also checked on the real relay tables: its DSN path and its handed path agree, query by query.
Prints counts, states and paths, never a person's values."""
from __future__ import annotations

import ast
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

RELAY = "asa-hub-snapshot"
DB_RUNNER = "asa-hub-db-sync"
PEOPLE = 8
RELAY_BUDGET_S = 420

RELAY_DRIVER = r'''
import base64, importlib.abc, importlib.util, json, os, re, signal, sys, time, types, hashlib
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError("the relay side ran out of time")))
signal.alarm(blob["budget"])
SRC = blob["server"]
APP = blob["app"]
sys.path[:] = [p for p in sys.path if p not in ("", os.getcwd(), "/srv/app")]


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) \
            if name in SRC or name in APP else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        name = module.__name__
        module.__file__ = "/srv/app/" + name + ".py"
        exec(compile(SRC.get(name) or APP[name], name + ".py", "exec"), module.__dict__)


sys.meta_path.insert(0, Checkout())
stub = types.ModuleType("scope")


class Defer(Exception):
    pass


stub.Defer = Defer
sys.modules["scope"] = stub

import psycopg2, psycopg2.extensions as ext
_DDL = re.compile(r"^\s*(CREATE|ALTER|DROP|COMMENT)\b", re.I)
SKIPPED = {"ddl": 0}
_guarded_classes = {}


def guarded(base):
    if base not in _guarded_classes:
        class Guarded(base):
            def execute(self, query, vars=None):
                q = query if isinstance(query, str) else query.as_string(self.connection) \
                    if hasattr(query, "as_string") else str(query)
                if _DDL.match(q):
                    SKIPPED["ddl"] += 1
                    return None
                return super().execute(query, vars)
        _guarded_classes[base] = Guarded
    return _guarded_classes[base]


class ReadOnly(ext.connection):
    def cursor(self, *a, **kw):
        kw["cursor_factory"] = guarded(kw.get("cursor_factory") or self.cursor_factory or ext.cursor)
        return super().cursor(*a, **kw)


_real_connect = psycopg2.connect


def ro_connect(dsn=None, connection_factory=None, cursor_factory=None, **kw):
    opts = kw.pop("options", "") or ""
    kw["options"] = (opts + " " if opts else "") + "-c default_transaction_read_only=on"
    return _real_connect(dsn, connection_factory=ReadOnly, cursor_factory=cursor_factory, **kw)


psycopg2.connect = ro_connect
PG_DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
HUB_DB_SHEET_ID = os.getenv("HUB_DB_SHEET_ID", "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg")
import my_work, shift_requests
from typing import Any

relay_ns = {"psycopg2": psycopg2, "PG_DSN": PG_DSN, "HUB_DB_SHEET_ID": HUB_DB_SHEET_ID, "Any": Any,
            "shift_requests": shift_requests, "os": os}
exec(compile(blob["relay_code"], "snapshot_service_my_work", "exec"), relay_ns)
state = relay_ns["_my_work_state_read"]()

out = {"people": [], "errors": [], "where": []}
FOLD = "regexp_replace(lower(coalesce({}, '')), '[^a-z0-9]+', '', 'g')"
conn = psycopg2.connect(PG_DSN, connect_timeout=5)
conn.autocommit = True
cur = conn.cursor()
cur.execute("SELECT data FROM asa_drive_sheets_rows WHERE sheet_id=%s AND tab_name='users'", (HUB_DB_SHEET_ID,))
users = [r[0] for r in cur.fetchall() if isinstance(r[0], dict)]


def live(u):
    return (str(u.get("active") or "").strip().upper() not in ("FALSE", "0", "NO")
            and not str(u.get("merged_into") or "").strip() and str(u.get("user_id") or "").strip()
            and shift_requests.fold(u.get("display_name")))


master = next((u for u in users if live(u) and str(u.get("email") or "").strip().lower() == blob["master_email"]), None)
pool = [u for u in users if live(u) and u is not master
        and str(u.get("role") or "").strip().lower() not in ("client", "guardian", "onboarding", "interviewer")]
named = set()
cur.execute("SELECT person FROM asa_shift_requests")
named |= {shift_requests.fold(r[0]) for r in cur.fetchall()}
cur.execute("SELECT from_staff, to_staff FROM asa_shift_handoffs")
for a, b in cur.fetchall():
    named |= {shift_requests.fold(a), shift_requests.fold(b)}
cur.execute("SELECT open_row FROM asa_shift_pool WHERE kind=%s", (shift_requests.KIND_CALLOFF,))
named |= {shift_requests.fold(r[0]) for r in cur.fetchall()}
named.discard("")
active = [u for u in pool if shift_requests.fold(u.get("display_name")) in named]
rest = sorted((u for u in pool if u not in active), key=lambda u: hashlib.sha1(str(u["user_id"]).encode()).hexdigest())
chosen = (active[:4] + rest)[:blob["people"]]
keys = sorted({shift_requests.fold(u.get("display_name")) for u in chosen} | set(sorted(named)[:6]))
HIDE_NONE = {p: False for p in my_work.HIDE_PARTS}
HIDE_SOME = {**HIDE_NONE, "completed": True, "missing_row": True}


def one(u, mode, hide, flag):
    uid = str(u["user_id"])
    rec = {"uid": uid, "role": str(u.get("role") or "").strip().lower(), "mode": mode, "hide": hide,
           "named": shift_requests.fold(u.get("display_name")) in named}
    try:
        name = relay_ns["_roster_name_of"](uid, strict=True)
        who = shift_requests.viewer(PG_DSN, name=name, role=rec["role"], types=str(u.get("types") or ""),
                                    is_master=flag)
        me = my_work.identity(PG_DSN, HUB_DB_SHEET_ID, uid, roster_name=str(who.get("name") or ""))
        why = "Signed in as the master account: every person's rows, each naming its person." if mode == "mass" else ""
        started = time.time()
        board = my_work.board(PG_DSN, mode=mode, me=me, who=who, lanes=None, lanes_why="", person="",
                              scope_why=why, hide=hide)
        rec.update(scope={"mode": mode, "why": why}, board=json.loads(json.dumps(board, default=str)),
                   took=round(time.time() - started, 2))
    except Exception as exc:
        rec["error"] = type(exc).__name__ + ": " + str(exc)[:160]
    return rec


for i, u in enumerate(chosen):
    out["people"].append(one(u, "own", HIDE_SOME if i == len(chosen) - 1 else HIDE_NONE, None))
if master is not None:
    out["people"].append(one(master, "mass", HIDE_NONE, True))
else:
    out["errors"].append("the master's users row is not in the relay's copy")

# the accessor on the real tables: its DSN path (read-only here) against its handed path, query by query
import mw_relay_state as M
M.CONNECT[0] = lambda: psycopg2.connect(PG_DSN, connect_timeout=5)
# read again here: the keeper's sync state moves every pass, so the boards' first read is too old to compare with
fresh = relay_ns["_my_work_state_read"]()
cur.execute("SELECT id FROM asa_shift_requests ORDER BY created_at DESC LIMIT 5")
ids = [r[0] for r in cur.fetchall()]
cur.execute("SELECT col_iso FROM asa_shift_pool WHERE kind=%s ORDER BY col_iso DESC LIMIT 4",
            (shift_requests.KIND_CALLOFF,))
days = [r[0] for r in cur.fetchall()]
cur.execute("SELECT ref FROM asa_time_off_said LIMIT 1")
ref = (cur.fetchone() or [""])[0]
cur.execute("SELECT sheet_id FROM asa_drive_sheets_meta ORDER BY last_sync_at ASC NULLS LAST LIMIT 1")
sid = (cur.fetchone() or [""])[0]
import datetime as dt
ASKS = [
    ("asa_shift_handoffs", "state=%s", ("pending",), "created_at DESC", 400, None),
    ("asa_shift_handoffs", "state=%s AND " + FOLD.format("to_staff") + " = ANY(%s)", ("pending", keys), "created_at DESC", 400, None),
    ("asa_shift_handoffs", FOLD.format("from_staff") + " = ANY(%s)", (keys,), "created_at DESC", 400, None),
    ("asa_shift_handoffs", None, (), "created_at DESC", 400, None),
    ("asa_shift_requests", FOLD.format("r.person") + " = ANY(%s)", (keys,), "created_at DESC", 5000, None),
    ("asa_shift_requests", "id = ANY(%s)", (ids,), None, None, ("id", "state")),
    ("asa_shift_requests", "kind = ANY(%s) AND state=%s", ([shift_requests.KIND_OPEN, shift_requests.KIND_CALLOFF], shift_requests.APPLIED), "created_at", None, None),
    ("asa_shift_pool", "kind=%s AND col_iso = ANY(%s) AND " + FOLD.format("open_row") + " = ANY(%s)", (shift_requests.KIND_CALLOFF, days, keys), None, None, None),
    ("asa_shift_pool", "kind=%s AND col_iso = ANY(%s)", (shift_requests.KIND_CALLOFF, days), None, None, ("location", "open_row", "col_iso", "ref", "filled_by", "closed_at")),
    ("asa_shift_pool", None, (), "col_iso DESC, location, open_row", None, None),
    ("asa_users", "active IS NOT FALSE AND (merged_into IS NULL OR merged_into::text = '')", (), None, None, ("id", "role")),
    ("asa_users", "active IS NOT FALSE AND (merged_into IS NULL OR merged_into::text = '') AND regexp_replace(lower(coalesce(nullif(entity_name, ''), display_name, '')), '[^a-z0-9]+', '', 'g') = %s", (keys[0] if keys else "-",), None, None, ("id", "role")),
    ("asa_house_worked_days", "day >= %s", (dt.date.today() - dt.timedelta(days=21),), None, None, None),
    ("asa_house_calendar_claims", None, (), None, None, ("location", "open_row", "col_iso", "value", "claimed_by")),
    ("asa_house_calendar_live", None, (), "location", None, ("location",)),
    ("asa_house_calendar_overrides", None, (), None, None, ("location", "employee", "col_iso", "value")),
    ("asa_house_day_published", None, (), None, None, ("location", "col_iso", "first_seen")),
    ("asa_time_off_said", "ref=%s", (ref,), "updated_at DESC", None, ("kind", "recipient", "said", "updated_at")),
    ("asa_time_off_writes", None, (), None, None, None),
    ("asa_calendar_calloff_road", "state=%s", ("pending",), None, None, None),
]


def sig(rows, ordered):
    got = [hashlib.sha1(json.dumps(r, default=str, sort_keys=True).encode()).hexdigest()[:12] for r in rows]
    return got if ordered else sorted(got)


for table, where, params, order, limit, cols in ASKS:
    rec = {"table": table, "where": (where or "")[:60], "order": order or ""}
    try:
        a = M.rows(table, where, params, order=order, limit=limit, columns=cols)
        with M.use(fresh):
            b = M.rows(table, where, params, order=order, limit=limit, columns=cols)
        rec.update(n_dsn=len(a), n_handed=len(b), same=sig(a, bool(order)) == sig(b, bool(order)),
                   types_same=[{k: type(v).__name__ for k, v in r.items()} for r in a[:1]]
                   == [{k: type(v).__name__ for k, v in r.items()} for r in b[:1]])
    except Exception as exc:
        rec["error"] = type(exc).__name__ + ": " + str(exc)[:160]
    out["where"].append(rec)
for table, key in (("asa_drive_sheets_meta", sid), ("hub_sheet_sync_state", None)):
    rec = {"table": table, "where": "freshness", "order": ""}
    try:
        fresh = relay_ns["_my_work_state_read"]()
        a = M.freshness(table, key)
        with M.use(fresh):
            b = M.freshness(table, key)
        rec.update(n_dsn=int(a is not None), n_handed=int(b is not None),
                   same=json.dumps(a, default=str, sort_keys=True) == json.dumps(b, default=str, sort_keys=True),
                   types_same=True)
    except Exception as exc:
        rec["error"] = type(exc).__name__ + ": " + str(exc)[:160]
    out["where"].append(rec)
out["state"] = state
out["skipped_ddl"] = SKIPPED["ddl"]
print("RELAY_RESULT " + json.dumps(out, default=str))
'''

DB_DRIVER = r'''
import base64, importlib.abc, importlib.util, json, os, re, sys, time, types
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
os.environ.setdefault("HUB_DB_DSN", "host=%s dbname=%s user=%s password=%s" % (
    os.environ.get("HUB_DB_HOST", "asa-hub-db"), os.environ["POSTGRES_DB"], os.environ["POSTGRES_USER"],
    os.environ["POSTGRES_PASSWORD"]))
os.environ.pop("HUB_RELAY_RO_DSN", None)

import gsjs, hubdb, locations as L, scope as sc
import mw_relay_state as M
checks, facts = [], {}


def check(name, ok, detail=""):
    checks.append([name, bool(ok), detail])


try:
    M.rows("asa_shift_requests")
    check("no DSN and no handed rows: the accessor defers, so the relay answers", False, "it answered")
except sc.Defer as e:
    check("no DSN and no handed rows: the accessor defers, so the relay answers", M.source() == "", str(e)[:120])
with M.use({"relay_state": blob["state"]}):
    n = {t: len(M.rows(t)) for t in M.TABLES if t in blob["state"]["tables"]}
check("the handed state reads back whole, table by table", n == {t: len(v["rows"]) for t, v in
      blob["state"]["tables"].items() if t in M.TABLES}, "")
facts["handed tables"] = len(blob["state"]["tables"])
facts["handed rows"] = sum(len(v["rows"]) for v in blob["state"]["tables"].values())
facts["handed bytes"] = len(json.dumps(blob["state"]))

try:
    import my_work as MW
except Exception as exc:
    MW = None
    check("app/my_work.py imports", False, type(exc).__name__ + ": " + str(exc)[:160])
try:
    from main import APPS, js_json
except Exception as exc:
    APPS, js_json = {}, (lambda v: v)
    check("app/main.py imports", False, type(exc).__name__ + ": " + str(exc)[:160])
check("main.py routes my-work to app/my_work.py", MW is not None and APPS.get("my-work") is MW)
door = getattr(MW, "ACTIONS", {}).get("myWorkView") if MW is not None else None
check("app/my_work.py declares the myWorkView read", callable(door))
VOLATILE = {"read_at", "as_of", "age_ms", "took"}


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


db = hubdb.HubDb()
reads0 = L.Reads(db)
by_uid = {gsjs.str_(u.get("userid")): u for u in reads0.users() if not gsjs.str_(u.get("mergedinto"))}
unbound = []
for i, p in enumerate(blob["people"]):
    tag = "mass" if p["mode"] == "mass" else f"P{i + 1}" + (" (hides concluded)" if p["hide"].get("completed") else "")
    if p.get("error"):
        check(f"{tag}: the relay's builder answered", False, p["error"])
        continue
    if door is None:
        continue
    row = by_uid.get(p["uid"])
    if row is None:
        check(f"{tag}: the account's users row is in asa-hub-db", False)
        continue
    user = sc.user_from_row(row)
    # the payload the relay sends (_my_work_python), its state tables handed in
    payload = {"mode": p["scope"]["mode"], "why": p["scope"]["why"], "person": "", "relay_state": blob["state"]}
    # the same display parts and no hotline lanes on both sides: the relay side cannot read the lanes here
    if hasattr(MW, "hide_lane"):
        MW.hide_lane = lambda reads, h=p["hide"]: {"my_work_hide": dict(h)}
    if hasattr(MW, "lanes_for"):
        MW.lanes_for = lambda *_a, **_k: None
    started = time.time()
    try:
        try:
            env = door(L.Session(L.Reads(db), user), payload)
        except sc.Defer as e:
            if str(e) != M.NO_SOURCE:
                raise
            unbound.append(tag)
            with M.use(payload):
                env = door(L.Session(L.Reads(db), user), payload)
    except sc.Defer as e:
        check(f"{tag}: Python answered (no defer)", False, str(e)[:160])
        continue
    except Exception as e:
        check(f"{tag}: Python answered", False, type(e).__name__ + ": " + str(e)[:160])
        continue
    took = round(time.time() - started, 2)
    data = env.get("data") if isinstance(env, dict) and env.get("status") == 200 else None
    if not isinstance(data, dict):
        check(f"{tag}: Python answered 200 with a board", False, str((env or {}).get("status")))
        continue
    data = dict(data)
    shown = data.pop("display", None)
    if p["mode"] == "own" and isinstance(shown, dict) and shown.get("hidden") != p["hide"]:
        facts[f"{tag} display parts differ from the relay's"] = True
    relay, py = norm(p["board"]), norm(data)
    paths = diff(strip(relay), strip(py))
    heads = lambda b: [(h["key"], h["state"], h.get("count")) for part in ("actions", "requests")
                       for h in b[part]["sources"]]
    ids = lambda b: sorted((r["source"], r["id"]) for part in ("actions", "requests") for r in b[part]["rows"])
    vol = sorted({x for x in diff(relay, py) if re.search(r"\.(read_at|as_of)$", x)})
    check(f"{tag}: same keys, same sources (state and count), same row ids, same totals",
          list(relay) == list(py) and heads(relay) == heads(py) and ids(relay) == ids(py)
          and relay["totals"] == py["totals"],
          f"sources differ at {[h[0] for h, g in zip(heads(relay), heads(py)) if h != g][:6]}; "
          f"rows relay {len(ids(relay))} / python {len(ids(py))}")
    check(f"{tag}: byte-identical past the read stamps", not paths, f"{len(paths)} paths, first {sorted(set(paths))[:8]}")
    facts[f"{tag} rows (actions + requests)"] = f"{len(relay['actions']['rows'])} + {len(relay['requests']['rows'])}"
    facts[f"{tag} python took"] = f"{took}s (relay {p.get('took')}s)"
    if vol:
        facts[f"{tag} stamps that differ"] = len(vol)
if door is not None:
    check("myWorkView binds the relay's handed state itself (mw_relay_state.bound / use)", not unbound,
          f"it deferred without it for {unbound}; checked again inside mw_relay_state.use")
print(json.dumps({"checks": checks, "facts": facts}))
'''


def relay_code() -> str:
    """The relay's My Work lines this check runs as the relay would: the state read and the roster name."""
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    tree = ast.parse(text)
    want = {"_MY_WORK_STATE_TABLES", "_MY_WORK_STATE_COLUMNS", "_my_work_state_read", "_roster_name_from",
            "_roster_name_of"}
    parts = []
    for node in tree.body:
        name = (node.name if isinstance(node, ast.FunctionDef)
                else getattr(node.targets[0], "id", None) if isinstance(node, ast.Assign)
                else getattr(node.target, "id", None) if isinstance(node, ast.AnnAssign) else None)
        if name in want:
            parts.append(ast.get_source_segment(text, node) or "")
            want.discard(name)
    if want:
        raise RuntimeError(f"the relay lacks {sorted(want)}")
    return "\n\n".join(parts)


def static() -> int:
    failed = 0

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal failed
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1

    for f in ["app/mw_relay_state.py", "app/my_work.py", "app/mw_time_off.py", "app/mw_shifts.py",
              "server/snapshot_service.py"]:
        p = ROOT / f
        try:
            py_compile.compile(str(p), doraise=True)
            check(f"{f} compiles", True)
        except FileNotFoundError:
            check(f"{f} compiles", False, "not landed yet")
        except py_compile.PyCompileError as exc:
            check(f"{f} compiles", False, str(exc)[-300:])
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    tree = {getattr(n.targets[0] if isinstance(n, ast.Assign) else n.target, "id", None): n
            for n in ast.parse(text).body if isinstance(n, (ast.Assign, ast.AnnAssign))}
    seg = ast.get_source_segment(text, tree["BACKEND_APPS"]) or ""
    entry = seg[seg.index('"my-work"'):] if '"my-work"' in seg else ""
    check("Settings › Back-end per app lists My Work: one read, a lane, no writes",
          '"label": "My Work"' in entry and 'frozenset({"myWorkView"})' in entry and '"lane": "/hub-lanes/my-work"'
          in entry and '"writes"' not in entry.split("}", 1)[0], entry[:160])
    actions = ast.get_source_segment(text, tree["_BACKEND_ACTIONS"]) or ""
    check("a lane's read is never routed from /gas (the screen's payload never reaches myWorkView)",
          'if not spec.get("lane")' in actions, actions[:160])
    tables = ast.literal_eval(ast.get_source_segment(text, tree["_MY_WORK_STATE_TABLES"].value))
    columns = ast.literal_eval(ast.get_source_segment(text, tree["_MY_WORK_STATE_COLUMNS"].value))
    acc = (ROOT / "app" / "mw_relay_state.py").read_text(encoding="utf-8")
    atree = {getattr(n.targets[0] if isinstance(n, ast.Assign) else n.target, "id", None): n
             for n in ast.parse(acc).body if isinstance(n, (ast.Assign, ast.AnnAssign))}
    a_tables = ast.literal_eval(ast.get_source_segment(acc, atree["TABLES"].value.args[0]))
    a_meta = ast.literal_eval(ast.get_source_segment(acc, atree["META"].value.args[0]))
    a_cols = ast.literal_eval(ast.get_source_segment(acc, atree["COLUMNS"].value))
    check("the relay hands exactly the tables and columns the accessor reads (never a password column)",
          set(tables) == set(a_tables) | set(a_meta) and columns == a_cols
          and "password_hash" not in json.dumps(columns), f"{sorted(set(tables) ^ (set(a_tables) | set(a_meta)))}")
    build = text[text.index("async def lane_my_work"):text.index("# ------", text.index("async def lane_my_work"))]
    helper = text[text.index("async def _my_work_python"):text.index("@app.get(\"/hub-lanes/my-work\")")]
    check("lane_my_work asks Python first with the scope it decided, and falls back to its own builder unchanged",
          "await python(actor, scope, person)" in build and 'globals().get("_my_work_python")' in build
          and build.index("_my_work_python") < build.index("_requests_viewer(") < build.index("my_work.board")
          and '{"mode": scope["mode"], "why": scope["why"], "person": person}' in helper
          and "_backend_settling()" in helper and 'said.get("mode") != scope["mode"]' in helper)
    others = [p.name for p in sorted((ROOT / "app").glob("*.py")) if p.name != "mw_relay_state.py"
              and re.search(r"HUB_RELAY_RO_DSN|HUB_SNAPSHOT_PG_DSN|MIRROR_DSN", p.read_text(encoding="utf-8"))]
    check("no other app module opens the relay's database", not others, str(others))
    return failed


def main() -> int:
    print("STATIC")
    failed = static()
    print(f"\nRELAY — the relay's builder for {PEOPLE} people and the master's mass view, read-only, in {RELAY}")
    server = lane_schema.with_imports(ROOT / "server", ("my_work",))
    server = {k: v for k, v in server.items() if not k.endswith(".json")}
    app = {k: (ROOT / "app" / f"{k}.py").read_text(encoding="utf-8") for k in ("mw_relay_state",)}
    scope_src = (ROOT / "app" / "scope.py").read_text(encoding="utf-8")
    master_email = re.search(r'^MASTER_ACCOUNT = "([^"]+)"', scope_src, re.M).group(1)
    blob = {"server": server, "app": app, "relay_code": relay_code(), "people": PEOPLE, "budget": RELAY_BUDGET_S,
            "master_email": master_email}
    got = subprocess.run(["docker", "exec", "-i", "-w", "/tmp", "-e", "MALLOC_ARENA_MAX=2", RELAY, "nice", "-n", "19",
                          "python3", "-c", RELAY_DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True,
                         timeout=RELAY_BUDGET_S + 30)
    line = next((x for x in got.stdout.decode().splitlines() if x.startswith("RELAY_RESULT ")), "")
    if not line:
        print("FAIL the relay side ran")
        print(got.stderr.decode()[-2500:])
        return 1
    relay = json.loads(line[len("RELAY_RESULT "):])
    for e in relay["errors"]:
        print("FAIL " + e)
        failed += 1
    print(f"fact DDL statements the read-only relay side skipped: {relay['skipped_ddl']}")
    for w in relay["where"]:
        ok = not w.get("error") and w.get("same") and w.get("types_same")
        print(("ok   " if ok else "FAIL ") + f"accessor {w['table']} {w['where']!r} {w['order']}: DSN "
              f"{w.get('n_dsn')} / handed {w.get('n_handed')} rows" + ("" if ok else f" — {w.get('error') or 'differ'}"))
        failed += 0 if ok else 1
    print(f"fact people chosen: {sum(1 for p in relay['people'] if p['mode'] == 'own')} own "
          f"({sum(1 for p in relay['people'] if p.get('named'))} named in the shift tables), "
          f"{sum(1 for p in relay['people'] if p['mode'] == 'mass')} mass")
    print(f"\nPYTHON — app/my_work.py with the same inputs, in {DB_RUNNER}")
    app_all = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    blob = {"app": app_all, "people": relay["people"], "state": relay["state"]}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DB_DRIVER],
                         input=base64.b64encode(json.dumps(blob, default=str).encode()) + b"\n", capture_output=True,
                         timeout=900)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print("FAIL the Python side ran in asa-hub-db-sync")
        print(got.stderr.decode()[-2500:])
        return 1
    res = json.loads(lines[-1])
    for name, ok, detail in res["checks"]:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1
    for k, v in res["facts"].items():
        print(f"fact {k}: {v}")
    print(f"\n{'all ok' if not failed else f'{failed} failed'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
