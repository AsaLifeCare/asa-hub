#!/usr/bin/env python3
"""My Profile on Python (app/my_profile.py) against the relay's builder (server/my_profile.py), both run read-only in
asa-hub-db-sync with the modules streamed in: ten staff in their own scope, the master's own profile, the master's
chosen people and clients, client-role accounts, and the door's refusals. The relay side reads the relay's copy
through the read-only role (MIRROR_DSN), the Python side reads asa-hub-db; both are handed the same clients list.
First the relay's own wiring is run as the relay runs it (its lines lifted, stubs around): the two switch entries,
the lane's Python call and the copy marks. Prints counts, states and paths, never a person's values."""
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
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import lane_schema  # noqa: E402

RUNNER = "asa-hub-db-sync"
STAFF = 10
CHOSEN_PEOPLE = 3
CHOSEN_CLIENTS = 2
CLIENT_ACCOUNTS = 3
BUDGET_S = 600
MASS_WHY = "Signed in as the master account: your own profile, or any person's you choose."

# the app side: the modules streamed in, a fake web layer, asa-hub-db read-only
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
os.environ.pop("HUB_RELAY_RO_DSN", None)
import gsjs, hubdb, locations as L, scope as sc
import my_work as MW
CORE = MW.CORE_USERS_SHEET_ID
db = hubdb.HubDb()


def sha(v):
    return hashlib.sha1(str(v).encode()).hexdigest()
'''

PICK = APP_PRELUDE + r'''
import my_profile as MP
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
cases = [{"tag": f"S{i + 1}", "uid": str(u["user_id"]), "role": MW._low(u.get("role")), "mode": "own", "why": "",
          "person": "", "client": ""} for i, u in enumerate(chosen)]
rows, built, _err = MP.read_clients(reads)
if master is not None:
    m = {"uid": str(master["user_id"]), "role": "admin", "mode": "mass", "why": blob["mass_why"]}
    cases.append({**m, "tag": "M", "person": "", "client": ""})
    ids = sorted({MW._text(r.get("id"), 120) for r in roster} - {""}, key=sha)
    for i, p in enumerate(ids[:blob["people"]]):
        cases.append({**m, "tag": f"M-P{i + 1}", "person": p, "client": ""})
    keys = sorted({MP._client_key(r) for r in rows} - {""}, key=sha)
    for i, k in enumerate(keys[:blob["clients"]]):
        cases.append({**m, "tag": f"M-C{i + 1}", "person": "", "client": k})
    cases.append({**m, "tag": "M-P?", "person": "no such roster row", "client": ""})
    cases.append({**m, "tag": "M-C?", "person": "", "client": "no_such_client"})
clients = sorted((u for u in users if live(u) and MW._low(u.get("role")) == "client"), key=lambda u: sha(u["user_id"]))
for i, u in enumerate(clients[:blob["client_accounts"]]):
    cases.append({"tag": f"C{i + 1}", "uid": str(u["user_id"]), "role": "client", "mode": "own", "why": "",
                  "person": "", "client": ""})
print("PICK_RESULT " + json.dumps({"cases": cases, "clients": {"rows": rows, "built": built},
                                   "master": master is not None, "on_roster": len(on_roster),
                                   "client_accounts": len(clients)}, default=str))
'''

RELAY = r'''
import base64, importlib.abc, importlib.util, json, os, pathlib, re, shutil, sys, tempfile, time, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = {k: v for k, v in blob["server"].items() if not k.endswith(".json")}
DATA = tempfile.mkdtemp(prefix="my-profile-relay-")
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


class _Cursor:
    def __init__(self, conn, dict_rows):
        self._c = conn.cursor(row_factory=psycopg.rows.dict_row if dict_rows else psycopg.rows.tuple_row)

    def execute(self, query, params=None):
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
pg2.connect, pg2.extras, pg2.extensions = connect, extras, extensions
pg2.Error, pg2.OperationalError, pg2.InterfaceError = psycopg.Error, psycopg.OperationalError, psycopg.InterfaceError
sys.modules.update({"psycopg2": pg2, "psycopg2.extras": extras, "psycopg2.extensions": extensions})

PG_DSN = os.environ["MIRROR_DSN"]
CORE = "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg"
import my_profile, my_work, shift_requests
from typing import Any
ns = {"psycopg2": pg2, "PG_DSN": PG_DSN, "HUB_DB_SHEET_ID": CORE, "shift_requests": shift_requests, "Any": Any}
exec(compile(blob["relay_code"], "snapshot_service_my_profile", "exec"), ns)
rows, built = blob["clients"]["rows"], blob["clients"]["built"]
out = {"answers": {}, "took": {}}
for c in blob["cases"]:
    started = time.time()
    try:
        # lane_my_profile's build(), past the relay's own gate and scope
        if c["role"] == "client" and c["mode"] != my_work.MODE_MASS:
            me, uid = {}, c["uid"]
        else:
            uid = c["uid"]
            name = ns["_roster_name_of"](uid, strict=True)
            me = my_work.identity(PG_DSN, CORE, uid, roster_name=str(name or ""))
        try:
            data = my_profile.profile(PG_DSN, CORE, mode=c["mode"], me=me, uid=uid, person=c["person"],
                                      client=c["client"], role=c["role"], scope_why=c["why"],
                                      clients=lambda: (rows, built, ""), fresh_s=7200.0)
            env = {"status": 200, "data": data}
        except my_profile.NoSuchPerson as exc:
            env = {"status": 404, "reason": "person", "message": str(exc)}
    except Exception as exc:
        env = {"error": type(exc).__name__ + ": " + str(exc)[:160]}
    out["answers"][c["tag"]] = json.loads(json.dumps(env, default=str))
    out["took"][c["tag"]] = round(time.time() - started, 2)
shutil.rmtree(DATA, True)
print("RELAY_RESULT " + json.dumps(out, default=str))
'''

COMPARE = APP_PRELUDE + r'''
import writes
checks, facts = [], {}


def check(name, ok, detail=""):
    checks.append([name, bool(ok), detail])


try:
    import my_profile as MP
except Exception as exc:
    MP = None
    check("app/my_profile.py imports", False, type(exc).__name__ + ": " + str(exc)[:160])
door = getattr(MP, "ACTIONS", {}).get("myProfileView") if MP is not None else None
check("app/my_profile.py declares the myProfileView read", callable(door))
check("its policy takes the relay's payload (person, client, mode, why, member)",
      MP is not None and set((MP.POLICY.get("myProfileView") or {}).get("params") or {})
      >= {"person", "client", "mode", "why", "member"})
try:
    import main
    routed = main.APPS.get("my-profile")
    if routed is None:
        facts["app/main.py routes my-profile"] = "not yet (its APPS entry lands with the shared files)"
    else:
        check("app/main.py routes my-profile to app/my_profile.py", routed is MP)
        check("the relay's payload passes main's policy gate for a staff session",
              main.policy_gate(MP, "myProfileView", {"mode": "own", "why": "", "person": "", "client": ""},
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
rows, built = blob["clients"]["rows"], blob["clients"]["built"]
gated, states = [], {}


def user_of(c):
    row = by_uid.get(c["uid"])
    return sc.user_from_row(row) if row is not None else None


def ask(c, user, payload):
    """The door as the relay calls it; past a gate App Control keeps shut, the builder the relay runs past its own."""
    sess = L.Session(L.Reads(db), user)
    try:
        opened = sc.profile_app_gate(MP.APP_ID, user, sess.reads.scope_sources()).get("open") is True
        why = "" if opened else "shut"
    except sc.Defer as e:
        opened, why = False, str(e)[:80]
    if opened:
        return door(sess, payload)
    gated.append(f"{c['tag']} ({why})")
    try:
        return {"status": 200, "data": MP.build(sess, MP.scope_of(user, payload), c["person"], c["client"])}
    except MP.mw.Refused as exc:
        return dict(exc.env)


for c in blob["cases"]:
    tag = c["tag"]
    relay = blob["relay"]["answers"].get(tag) or {}
    if relay.get("error"):
        check(f"{tag}: the relay's builder answered", False, relay["error"])
        continue
    if door is None:
        continue
    user = user_of(c)
    if user is None:
        check(f"{tag}: the account's users row is in asa-hub-db", False)
        continue
    if c["mode"] == "mass" and not sc.is_real_master(user):
        check(f"{tag}: the master's users row is the master in asa-hub-db", False)
        continue
    payload = {"mode": c["mode"], "why": c["why"], "person": c["person"], "client": c["client"]}
    started = time.time()
    try:
        # the clients list both sides read: the one handed to the relay's builder
        MP.read_clients = lambda _reads: (rows, built, "")
        env = ask(c, user, payload)
    except sc.Defer as e:
        check(f"{tag}: Python answered (no defer)", False, str(e)[:160])
        continue
    except Exception as e:
        check(f"{tag}: Python answered", False, type(e).__name__ + ": " + str(e)[:160])
        continue
    took = round(time.time() - started, 2)
    a, b = norm(relay), norm(env)
    paths = diff(strip(a), strip(b))
    check(f"{tag}: byte-identical to the relay's answer past the read stamps", not paths,
          f"{len(paths)} paths, first {sorted(set(paths))[:8]}")
    d = b.get("data") if isinstance(b.get("data"), dict) else {}
    if d:
        req = d.get("requirements") or {}
        states[tag] = f"{d.get('details', {}).get('state')}/{req.get('state')} ({len(req.get('rows') or [])} rows)"
    else:
        states[tag] = f"status {b.get('status')}"
    facts[f"{tag} python took"] = f"{took}s (relay {blob['relay']['took'].get(tag)}s)"
    vol = sorted({x for x in diff(a, b) if re.search(r"\.(read_at|as_of)$", x)})
    if vol:
        facts[f"{tag} stamps that differ"] = len(vol)
facts["card / requirements states"] = states
facts["answered past an App Control gate kept shut (the builder the relay runs past its own gate)"] = gated

# the door's own refusals, as the relay answers them
staff = next((c for c in blob["cases"] if c["tag"] == "S1"), None)
master = next((c for c in blob["cases"] if c["tag"] == "M"), None)
if door is not None and staff and master and user_of(staff) and user_of(master):
    su, mu = user_of(staff), user_of(master)
    sess = lambda u: L.Session(L.Reads(db), u)
    try:
        got = door(sess(su), {"mode": "own", "person": "x"})
    except sc.Defer as e:
        got = {"defer": str(e)}
    check("a person asked outside the master's scope is refused 403 (or the gate defers to the relay)",
          got.get("status") == 403 and got.get("message") == MP.MY_PROFILE_OWN_ONLY or "defer" in got, str(got)[:120])
    got = door(sess(mu), {"mode": "mass", "why": master["why"], "person": "a", "client": "b"})
    check("a person and a client together are refused 400", got.get("status") == 400, str(got.get("status")))
    got = door(sess(mu), {"mode": "mass", "why": master["why"], "person": "<bad>"})
    check("a person the pattern refuses is refused 400", got.get("status") == 400, str(got.get("status")))
    got = door(sess(mu), {"mode": "mass", "member": "someone"})
    check("a visit is refused 403", got.get("status") == 403 and got.get("reason") == "visit", str(got.get("status")))
    got = door(sess(mu), {"mode": "own", "why": "", "person": "x"})
    check("the master asked for own rows is own: a person is refused 403", got.get("status") == 403,
          str(got.get("status")))
    try:
        door(sess({**su, "is_service": True}), {})
        check("the service is deferred, never drawn", False)
    except sc.Defer:
        check("the service is deferred, never drawn", True)

# an edit kept in Postgres is on the card: one roster cell edited in app.edits' shape, laid by the request
pick = next((c for c in blob["cases"] if c["tag"] == "M-P1"), None)
if door is not None and pick and master and user_of(master):
    reads = L.Reads(db)
    books = MW.HubBooks(reads)
    sid = books.pointers().get(MW.PTR_PEOPLE, "")
    mark = "EDIT-CHECK " + hashlib.sha1(str(time.time()).encode()).hexdigest()[:8]
    edit = {"sheet_id": sid, "tab_name": MW.HOUSE_TAB, "match": "id", "keyed": "header", "row_key": pick["person"],
            "appended": False, "field": "role", "value": mark, "id": 1, "born": 1}
    token = hubdb.OWN.set(writes.Own([], book=db.book, edits=[edit], edits_at=time.time()))
    try:
        got = door(L.Session(reads, user_of(master)), {"mode": "mass", "why": master["why"], "person": pick["person"]})
    finally:
        hubdb.OWN.reset(token)
    fields = {f["key"]: f for f in (((got.get("data") or {}).get("details") or {}).get("fields") or [])}
    check("an edit kept in Postgres (app.edits) is on the card at once",
          (fields.get("role") or {}).get("value") == mark, "the role field does not carry the edited value")
print(json.dumps({"checks": checks, "facts": facts}))
'''


def relay_code() -> str:
    """The relay's lines this check runs as the relay would: the roster name."""
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    want = {"_roster_name_from", "_roster_name_of"}
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

    for f in ("app/my_profile.py", "server/my_profile.py"):
        try:
            py_compile.compile(str(ROOT / f), doraise=True)
            check(f"{f} compiles", True)
        except py_compile.PyCompileError as exc:
            check(f"{f} compiles", False, str(exc)[-300:])
    text = (ROOT / "app" / "my_profile.py").read_text(encoding="utf-8")
    check("app/my_profile.py reads no relay table and no file: asa-hub-db only (no data->>, no snapshot path)",
          "data->>" not in text and "asa_drive_sheets" not in text and "/srv/" not in text
          and "HUB_RELAY_RO_DSN" not in text and "MIRROR_DSN" not in text)
    check("app/my_profile.py writes nothing (no insert, update or delete)",
          not re.search(r"\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b", text, re.I))
    return failed


def relay_wiring() -> int:
    """The relay's own lines, lifted and run: the switch entries, the lane's Python call and the copy marks."""
    failed = 0

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal failed
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1

    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    nodes: dict[str, ast.AST] = {}
    for node in ast.parse(text).body:
        name = (node.name if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                else getattr(node.targets[0], "id", None) if isinstance(node, ast.Assign)
                else getattr(node.target, "id", None) if isinstance(node, ast.AnnAssign) else None)
        if name:
            nodes[name] = node

    class Clock:
        now = 1_900_000_000.0

        def time(self) -> float:
            return self.now

    clock = Clock()
    ns: dict = {"Any": object, "re": re, "json": json, "time": clock, "os": __import__("os"), "asyncio": asyncio,
                "urllib": urllib, "HUB_APP_TIMEOUT_S": 10.0, "HUB_APP_PACK_TIMEOUT_S": 60.0,
                "_APP_PACK_CLIENTS": "client-profiles", "_APP_PACK_STAFF_TEAM": "staff-team",
                "_APP_PACK_SSAS": "ssa-profiles", "_APP_PACK_FAMILIES": "family-profiles",
                "_APP_PACK_CANDIDATES": "candidates", "_APP_PACK_LEADS": "leads", "SCHEDULING_EVENT": "scheduling",
                "VEHICLE_CALENDAR_EVENT": "vehicle-calendar", "EMERGENCY_CONTACTS_EVENT": "emergency-contacts",
                "_APP_PACK_WATCHED": frozenset({"certDocUpload", "staffProfileAddressEdit"}),
                "_APP_PACK_PEOPLE_WRITES": frozenset(), "_APP_PACK_VERBS": frozenset(),
                "_APP_PACK_PEOPLE_RESOURCES": frozenset(), "_app_pack_people_at": [0.0],
                "_app_pack_swept": {}, "_app_pack_void": {}, "_app_pack_touched": {}, "_backend_own": {},
                "_backend_final_at": {}, "_app_pack_apps_of": lambda action, raw: set()}
    lifted = ("BACKEND_APPS", "_BACKEND_ACTIONS", "_BACKEND_WRITES", "_BACKEND_FINAL", "RELAY_NO_RECEIPT_ACTIONS",
              "RELAY_BYTE_READS", "_BACKEND_EDITION_APPS", "_relay_json_constant", "_relay_envelope",
              "APP_PACK_HEAD_BYTES", "_app_pack_upload_envelope", "_app_pack_write_of", "_APP_PACK_PYTHON_BEHIND",
              "_app_pack_rang_write", "BACKEND_OWN_SLACK_S", "_backend_final_covers", "_backend_copy_at",
              "_backend_written_after", "MY_PROFILE_APP", "MY_PROFILE_PYTHON_READ", "MY_PROFILE_PYTHON_TIMEOUT_S",
              "_MY_PROFILE_KEYS", "_my_profile_python")
    missing = [n for n in lifted if n not in nodes]
    check("the relay carries every line this check runs", not missing, str(missing))
    if missing:
        return failed
    for n in lifted:
        exec(compile(ast.Module(body=[nodes[n]], type_ignores=[]), "snapshot_service.py", "exec",
                     flags=__future__.annotations.compiler_flag, dont_inherit=True), ns)
    apps, reads, writes, final = ns["BACKEND_APPS"], ns["_BACKEND_ACTIONS"], ns["_BACKEND_WRITES"], ns["_BACKEND_FINAL"]
    mp, cd = apps.get("my-profile") or {}, apps.get("cert-docs") or {}
    check("Settings › Back-end per app lists My Profile: the lane's read and the own address, its save final",
          mp.get("label") == "My Profile" and mp.get("lane") == "/hub-lanes/my-profile"
          and mp.get("reads") == {"myProfileView", "staffProfileAddress", "myProfileEmailFree"}
          and mp.get("writes") == {"staffProfileAddressEdit"}
          and mp.get("final") == {"staffProfileAddressEdit"}, str(mp)[:200])
    check("and Compliance documents on its own switch: four reads, the confirmation final, the filing Apps Script's",
          cd.get("label") == "Compliance documents"
          and cd.get("reads") == {"certUploadsList", "certDocRead", "certDocFile", "certUploadRecord"}
          and cd.get("writes") == {"certUploadConfirm"} and cd.get("final") == {"certUploadConfirm"}
          and "certDocUpload" not in reads and "certDocUpload" not in writes, str(cd)[:200])
    check("a lane's read is never routed from /gas; the address and the ledger's reads are, each under its own switch",
          "myWorkView" not in reads and "myProfileView" not in reads and reads.get("staffProfileAddress") == "my-profile"
          and all(reads.get(a) == "cert-docs" for a in cd.get("reads", ())),
          str({a: reads.get(a) for a in mp.get("reads", ())}))
    check("Staff's switch carries neither address door; the two saves are final writes",
          not ({"staffProfileAddress", "staffProfileAddressEdit"}
               & (set(apps["staff"]["reads"]) | set(apps["staff"].get("writes", ()))))
          and writes.get("staffProfileAddressEdit") == "my-profile" and writes.get("certUploadConfirm") == "cert-docs"
          and {"staffProfileAddressEdit", "certUploadConfirm"} <= final)
    no_receipt = ns["RELAY_NO_RECEIPT_ACTIONS"]
    check("every read Python answers here is a no-receipt action; the saves keep their write id",
          {"staffProfileAddress", "certUploadsList", "certDocRead", "certDocFile", "certUploadRecord"} <= no_receipt
          and not ({"staffProfileAddressEdit", "certUploadConfirm"} & no_receipt)
          and {"certDocRead", "certDocFile"} <= ns["RELAY_BYTE_READS"])
    check("an edition of either app is offered only while that app runs on Python",
          ns["_BACKEND_EDITION_APPS"].get("my-profile") == "my-profile"
          and ns["_BACKEND_EDITION_APPS"].get("cert-docs") == "cert-docs")

    # the lane: asked with the scope the relay decided, its answer taken only when it keeps that scope
    calls: list = []
    state = {"wanted": True, "settling": False, "answer": None}

    async def wanted(app_id: str) -> bool:
        return state["wanted"] and app_id == "my-profile"

    async def call(app_id, action, payload, user, extra=None, timeout=None):
        calls.append({"app": app_id, "action": action, "payload": payload, "user": user, "timeout": timeout})
        return None if state["answer"] is None else (b"", 0.0, state["answer"], None, 0.0)

    class Log:
        def warning(self, *_a):
            calls.append({"warned": True})

        info = warning

    ns.update(_backend_wanted=wanted, _backend_settling=lambda: state["settling"], _backend_call=call,
              _traffic_note=lambda *_a: None, log=Log(), my_work=type("MW", (), {"MODE_MASS": "mass"}))
    own = {"mode": "own", "why": ""}
    mass = {"mode": "mass", "why": MASS_WHY}

    def answer(mode: str, person: str = "", client: str = "", whose: bool = True, drop: str = "",
               status: int = 200) -> dict:
        scope = {"mode": mode, "why": "", "person": person}
        if mode == "mass":
            scope["client"] = client
        data = {"scope": scope, "person": {"own": whose}, "details": {}, "requirements": {}, "read_at": "x"}
        data.pop(drop, None)
        return {"status": status, "data": data}

    def ask(scope: dict, person: str = "", client: str = "", session=("staff", "u-1")) -> dict | None:
        calls.clear()
        return asyncio.run(ns["_my_profile_python"](session, scope, person, client))

    state["wanted"] = False
    check("off Python the relay's own builder answers, and Python is not asked", ask(own) is None and not calls)
    state.update(wanted=True, settling=True)
    check("while App Control settles the relay's own builder answers", ask(own) is None and not calls)
    state.update(settling=False, answer=answer("own"))
    got = ask(own)
    sent = next((c for c in calls if c.get("action")), {})
    check("on Python, myProfileView is asked with exactly the scope and subject the relay decided",
          got is not None and sent.get("app") == "my-profile" and sent.get("action") == "myProfileView"
          and sent.get("payload") == {"mode": "own", "why": "", "person": "", "client": ""}
          and sent.get("user") == {"uid": "u-1", "role": "staff", "is_master": False}
          and sent.get("timeout") == ns["MY_PROFILE_PYTHON_TIMEOUT_S"], str(sent)[:200])
    for label, ans in (("another person's profile", answer("own", whose=False)),
                       ("the master's scope", answer("mass")),
                       ("a missing part", answer("own", drop="requirements")),
                       ("a refusal", answer("own", status=404))):
        state["answer"] = ans
        check(f"own scope: Python's answer with {label} is not taken (the relay's builder answers)", ask(own) is None)
    state["answer"] = None
    check("Python deferring or failing: the relay's builder answers", ask(own) is None and len(calls) == 1)
    state["answer"] = answer("mass", person="P-1", whose=False)
    got = ask(mass, person="P-1", session=("admin", "u-m"))
    sent = next((c for c in calls if c.get("action")), {})
    check("the master's chosen person: asked as the master, taken when it is that person",
          got is not None and sent.get("user", {}).get("is_master") is True
          and sent.get("payload") == {"mode": "mass", "why": MASS_WHY, "person": "P-1", "client": ""})
    state["answer"] = answer("mass", person="P-2", whose=False)
    check("the master's chosen person: another person's answer is not taken", ask(mass, person="P-1") is None)
    state["answer"] = answer("mass", client="C-1", whose=False)
    check("the master's chosen client: taken when it is that client, refused for another",
          ask(mass, client="C-1") is not None and ask(mass, client="C-2") is None)
    route = ast.get_source_segment(text, nodes["lane_my_profile"]) or ""
    check("lane_my_profile asks Python first, past its own gate and scope, and falls back to its builder unchanged",
          'globals().get("_my_profile_python")' in route and "await python(actor, scope, person, client)" in route
          and route.index("_my_profile_scope(") < route.index("_my_profile_python")
          < route.index("_requests_viewer(") < route.index("my_profile.profile"))

    # the copy marks: an Apps Script write to a Master cell or the ledger sends that app's reads back to Apps Script
    def form(action: str, payload: dict) -> bytes:
        return urllib.parse.urlencode({"body": json.dumps({"action": action, "token": "t", "payload": payload})}).encode()

    swept = ns["_app_pack_swept"]
    rang = ns["_app_pack_rang_write"]
    ok200, no409 = b'{"status": 200, "data": {}}', b'{"status": 409, "data": {}}'
    clock.now += 10
    rang("certDocUpload", form("certDocUpload", {"req_id": "r1"}), ok200)
    check("a filed paper marks Compliance documents behind, not My Profile",
          swept.get("cert-docs") == clock.now and "my-profile" not in swept, str(swept))
    swept.clear()
    rang("staffProfileAddressEdit", form("staffProfileAddressEdit", {}), no409)
    rang("staffProfileAddress", form("staffProfileAddress", {}), ok200)
    rang("certDocRead", form("certDocRead", {"id": "u1"}), ok200, python=True)
    check("a refused save, a read and a paper's reading Python answered mark nothing", not swept, str(swept))
    big = urllib.parse.urlencode({"body": json.dumps({"action": "certDocUpload",
                                                      "payload": {"b64": "x" * 120_000}})}).encode()
    clock.now += 10
    rang("", big, ok200)
    check("an upload too big to parse is named by its opening bytes and marks Compliance documents",
          swept.get("cert-docs") == clock.now, str(swept))
    swept.clear()
    clock.now += 10
    rang("emp360EditField", form("emp360EditField", {}), None)
    check("a Master write whose answer was lost marks both apps (it may have landed)",
          swept.get("cert-docs") == clock.now and swept.get("my-profile") == clock.now, str(swept))
    after = ns["_backend_written_after"]
    check("a Python read whose copy predates the mark goes back to Apps Script; one read after it answers",
          after("cert-docs", "", clock.now - 1, None, any_key=True)
          and not after("cert-docs", "", clock.now + 1, None, any_key=True)
          and after("my-profile", "", clock.now - 1, None, any_key=True))
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
    print("\nRELAY WIRING — the relay's My Profile and Compliance documents lines, run as the relay runs them")
    failed += relay_wiring()
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    print(f"\nPICK — the cases, off asa-hub-db, in {RUNNER}")
    picked = run(PICK, {"app": app, "staff": STAFF, "people": CHOSEN_PEOPLE, "clients": CHOSEN_CLIENTS,
                        "client_accounts": CLIENT_ACCOUNTS, "mass_why": MASS_WHY}, "PICK_RESULT", 300)
    if picked is None:
        return 1
    cases = picked["cases"]
    print(f"fact cases: {len(cases)} ({sum(1 for c in cases if c['tag'].startswith('S'))} staff own, "
          f"{sum(1 for c in cases if c['mode'] == 'mass')} master, {sum(1 for c in cases if c['tag'].startswith('C'))} "
          f"client accounts of {picked['client_accounts']}); staff on the roster by name: {picked['on_roster']}; "
          f"clients listed: {len(picked['clients']['rows'])}")
    if not picked["master"]:
        print("FAIL the master's users row is not in asa-hub-db")
        failed += 1
    print(f"\nRELAY — server/my_profile.py over the relay's copy (read-only role), in {RUNNER}")
    server = lane_schema.with_imports(ROOT / "server", ("my_profile",))
    relay = run(RELAY, {"server": server, "relay_code": relay_code(), "cases": cases, "clients": picked["clients"]},
                "RELAY_RESULT", BUDGET_S)
    if relay is None:
        return 1
    print(f"\nPYTHON — app/my_profile.py through myProfileView with the relay's payload, in {RUNNER}")
    res = run(COMPARE, {"app": app, "cases": cases, "clients": picked["clients"], "relay": relay}, "", BUDGET_S)
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
