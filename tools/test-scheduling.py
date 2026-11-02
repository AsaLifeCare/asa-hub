#!/usr/bin/env python3
"""Scheduling as a switchable app: the relay names its reads, writes and final doors, rings its screens after a Python
final write, keeps Python off a copy older than an Apps Script Scheduling write, and carries the seed's own hand-off to
Apps Script (every other write final, none carried); every read and door decided by the streamed modules on real data
in asa-hub-db-sync — the master on three houses and a narrowed viewer, parity with the relay's kept board, each door
refused and allowed with its exact app.edits rows, somebody new to a house, the roll, the time-off import and the flows
kept final or refused in Python, the seed's dry run handed on. Nothing real is written: the edit store lives in temp
tables inside one transaction rolled back at the end, a statement writing or locking a live app.* table is refused
before it is sent, and a flow's system-log line is kept nowhere. Prints shapes, counts and timings only."""
from __future__ import annotations

import ast
import asyncio
import base64
import builtins
import json
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"
RELAY = "asa-hub-snapshot"
READS = {"schedulingBoard", "schedulingStaffShifts", "schedulingTimeOffList", "schedulingBuilderRead"}
WRITES = {"schedulingCellSave", "schedulingAddPerson", "schedulingUndo", "schedulingSettingsSet",
          "schedulingBuilderSave", "schedulingBuilderPublish", "schedulingAnswer", "schedulingSeed", "schedulingRoll",
          "schedulingTimeOffImport", "schedulingCallOff", "schedulingRequestOff", "schedulingTimeOff",
          "schedulingSwapPropose", "schedulingTake", "schedulingWithdraw"}
# every write is final; only the seed's own verdict hands a path on (its dry run and a first seed read the house books)
FINAL = WRITES
HANDS = {"schedulingSeed"}
FLOWS = {"schedulingCallOff", "schedulingRequestOff", "schedulingTimeOff", "schedulingSwapPropose", "schedulingTake",
         "schedulingWithdraw", "schedulingAnswer"}
RELAY_NAMES = ("EMERGENCY_CONTACTS_EVENT", "DIGEST_APP", "DOCS_APP", "FORMS_APP", "HOUSE_MEDS_APP", "LEARNING_APP",
               "RECON_APP", "SCHEDULING_EVENT", "_SCHEDULING_READS", "SUPPORT_DESK_EVENT", "_SUPPORT_DESK_WRITES",
               "_SUPPORT_DESK_SCHED_WRITES", "VEHICLE_CALENDAR_EVENT", "VEHICLE_CALENDAR_WRITES", "BACKEND_APPS",
               "_BACKEND_WRITES", "_BACKEND_FINAL", "BACKEND_OWN_SLACK_S", "BACKEND_FINAL_KEEP_S",
               "BACKEND_FINAL_UNWRITTEN", "_relay_observe_scheduling", "_relay_observe_support_desk",
               "_vehicle_calendar_rang", "_backend_final_covers", "_backend_copy_at", "_backend_written_after",
               "_backend_unwritten", "_backend_final_landed", "_backend_final", "_backend_people_extra",
               "_backend_write")

results: dict[str, Any] = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: Any = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail not in (None, ""):
            print(f"       {str(detail)[:500]}")


def strings(node: ast.AST) -> set[str]:
    return {n.value for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)}


def top_nodes(text: str, names: tuple[str, ...]) -> dict[str, ast.AST]:
    out: dict[str, ast.AST] = {}
    for node in ast.parse(text).body:
        name = getattr(node, "name", None)
        if name is None and isinstance(node, (ast.Assign, ast.AnnAssign)):
            target = node.targets[0] if isinstance(node, ast.Assign) else node.target
            name = getattr(target, "id", None)
        if name in names:
            out[name] = node
    return out


def stand_ins(text: str, nodes: dict[str, ast.AST], ns: dict[str, Any]) -> None:
    """Every name the lifted lines read that the check gives no value, stood in as tools/test-house-calendars.py
    stands them: the relay's own value where it is a plain literal (an app's id, a door set), an empty set for any
    other *_ACTIONS, an awaited no-op for what is awaited, a plain no-op for the rest."""
    free: set[str] = set()
    awaited: set[str] = set()
    for node in nodes.values():
        walk = list(ast.walk(node))
        bound = {n.id for n in walk if isinstance(n, ast.Name) and not isinstance(n.ctx, ast.Load)}
        bound |= {a.arg for n in walk if isinstance(n, ast.arguments)
                  for a in n.posonlyargs + n.args + n.kwonlyargs + [x for x in (n.vararg, n.kwarg) if x]}
        bound |= {n.name for n in walk if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
        bound |= {n.name for n in walk if isinstance(n, ast.ExceptHandler) and n.name}
        bound |= {(a.asname or a.name).split(".")[0] for n in walk if isinstance(n, (ast.Import, ast.ImportFrom))
                  for a in n.names}
        free |= {n.id for n in walk if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)} - bound
        awaited |= {n.value.func.id for n in walk if isinstance(n, ast.Await) and isinstance(n.value, ast.Call)
                    and isinstance(n.value.func, ast.Name)}
    missing = free - set(ns) - set(nodes) - set(dir(builtins))
    first: dict[str, ast.AST] = {}
    for node in ast.parse(text).body:
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            target = node.targets[0] if isinstance(node, ast.Assign) else node.target
            if getattr(target, "id", None) in missing:
                first.setdefault(target.id, node)

    async def nothing(*_a: Any, **_k: Any) -> None:
        return None

    def plain(value: ast.AST | None) -> bool:
        names = [n for n in ast.walk(value) if isinstance(n, ast.Name)] if value is not None else []
        inner = {n.id for n in names if not isinstance(n.ctx, ast.Load)}
        return value is not None and all(n.id in dir(builtins) or n.id in inner for n in names)

    for name in sorted(missing):
        value = getattr(first.get(name), "value", None)
        if plain(value):
            ns[name] = eval(compile(ast.Expression(value), name, "eval"), {})  # noqa: S307 - the relay's literal
        elif name.endswith("_ACTIONS"):
            ns[name] = frozenset()
        else:
            ns[name] = nothing if name in awaited else (lambda *_a, **_k: None)


def lanes() -> dict[str, str]:
    acts = json.loads((ROOT / "public" / "resolver-manifest.json").read_text(encoding="utf-8"))["actions"]
    return {a: str((e or {}).get("lane") or "") for a, e in acts.items()}


# ---- 1. what the files say ---------------------------------------------------------------------------------------------

def files() -> None:
    print("the files")
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    nodes = top_nodes(text, ("BACKEND_APPS", "RELAY_NO_RECEIPT_ACTIONS"))
    table = nodes["BACKEND_APPS"].value
    spec = next((v for k, v in zip(table.keys, table.values) if isinstance(k, ast.Constant) and k.value == "scheduling"),
                None)
    got = {kk.value: vv for kk, vv in zip(spec.keys, spec.values) if isinstance(kk, ast.Constant)} if spec else {}
    check("BACKEND_APPS names Scheduling with its label", spec is not None and strings(got.get("label", ast.Dict())) == {"Scheduling"})
    check("its reads are the board's three and the Builder's", strings(got.get("reads", ast.Dict())) == READS)
    check("its writes are all sixteen doors", strings(got.get("writes", ast.Dict())) == WRITES,
          sorted(strings(got.get("writes", ast.Dict())) ^ WRITES))
    check("every one of its sixteen writes is a final door",
          strings(got.get("final", ast.Dict())) == FINAL, sorted(strings(got.get("final", ast.Dict())) ^ FINAL))
    check("the one door whose own verdict still hands a path to Apps Script is the seed's (its dry run, a first seed)",
          strings(got.get("hands", ast.Dict())) == HANDS and HANDS <= FINAL, sorted(strings(got.get("hands", ast.Dict()))))
    check("its marks live under the Scheduling ring (no pack of its own)",
          isinstance(got.get("pack"), ast.Name) and got["pack"].id == "SCHEDULING_EVENT")
    no_receipt = strings(nodes["RELAY_NO_RECEIPT_ACTIONS"].value)
    check("every read is a no-receipt action on the relay (none new)", READS <= no_receipt, sorted(READS - no_receipt))
    lane = lanes()
    check("every door is declared a write (tool lane), so its landing rings the Scheduling screens",
          all(lane.get(a) in ("write", "tool") for a in WRITES) and all(lane.get(a) == "read" for a in READS),
          {a: lane.get(a) for a in sorted(WRITES | READS) if lane.get(a) not in ("write", "tool", "read")})
    main_text = (ROOT / "app" / "main.py").read_text(encoding="utf-8")
    check("asa-hub-app routes Scheduling: APPS, WRITES, its store and its health",
          all(s in main_text for s in ('"scheduling": scheduling_app', '"scheduling": scheduling_writes',
                                       '"scheduling": SCHEDULING_STORE', '"scheduling_writes": SCHEDULING_STORE.ready()')))
    for path in ("apps-script", "src"):
        same = subprocess.run(["git", "-C", str(ROOT), "diff", "--quiet", "HEAD", "--", path])
        check(f"no file under {path}/ is changed", same.returncode == 0)


# ---- 2. the relay's own lines, over stand-ins ---------------------------------------------------------------------------

class Resp:
    def __init__(self, content: Any, media_type: str = "") -> None:
        self.body = content
        self.status = json.loads(content).get("status")


def relay() -> None:
    print("the relay")
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    nodes = top_nodes(text, RELAY_NAMES)
    missing = [n for n in RELAY_NAMES if n not in nodes]
    if missing:
        check("the relay's Scheduling lines are all there", False, missing)
        return
    lane = lanes()
    rang: list[str] = []
    calls: list[tuple] = []
    state: dict[str, Any] = {"python": None, "settling": False, "master": False}

    async def backend_call(app_id: str, action: str, payload: dict, user: dict, extra: Any = None, timeout: Any = None):
        calls.append((app_id, action, dict(extra or {})))
        got = state["python"]
        return None if got is None else (json.dumps(got).encode(), time.time() - 900, json.loads(json.dumps(got)),
                                         frozenset(), time.time())

    async def wanted(app_id: str) -> bool:
        return app_id == "scheduling"

    async def actor(_a: str):
        return ("manager", "U1")

    async def master(_a: str):
        return (state["master"], "")

    async def settle(*_a: Any, **_k: Any) -> bool:
        return True

    ns: dict[str, Any] = {
        "__name__": "relay_check", "time": time, "json": json, "re": re, "asyncio": asyncio, "Any": Any,
        "hashlib": __import__("hashlib"), "urllib": urllib, "log": __import__("logging").getLogger("relay-check"),
        "Response": Resp, "EXEC_URL": "https://example.invalid/exec", "HUB_APP_PACK_TIMEOUT_S": 60.0,
        "_APP_PACK_CLIENTS": "client-profiles", "_APP_PACK_STAFF_TEAM": "staff-team", "_APP_PACK_SSAS": "ssa-profiles",
        "_APP_PACK_FAMILIES": "family-profiles", "_APP_PACK_CANDIDATES": "staff-candidates",
        "_APP_PACK_LEADS": "client-candidates", "_APP_PACK_HOUSE_RE": r"[A-Z]{2,4}\d{3,6}",
        "_app_pack_touched": {}, "_app_pack_void": {}, "_app_pack_swept": {}, "_backend_own": {},
        "_backend_final_at": {}, "_resolver_lane": lambda a: lane.get(a, ""),
        "_publish_slice": lambda name, **k: rang.append(name), "_viewer_cache_written": lambda *a: None,
        "_app_pack_apps_of": lambda *a: set(), "_app_pack_ring": lambda *a, **k: None,
        "_app_pack_write_of": lambda *a: ("", {}), "_app_pack_note_write": lambda *a: None,
        "_staff_profiles_rang": lambda *a: None, "_traffic_note": lambda *a, **k: None,
        "_backend_wanted": wanted, "_relay_is_service": lambda raw: False, "_session_actor": actor,
        "_app_pack_master": master, "_backend_settling": lambda: state["settling"], "_backend_call": backend_call,
        "_backend_settle_soon": lambda *a, **k: None, "_backend_settle": settle, "_backend_key": lambda *a: "",
        "_backend_own_mark": lambda *a, **k: None,
        "_BACKEND_UNANSWERED": __import__("contextvars").ContextVar("backend_unanswered", default=""),
        "_app_pack_people_at": [time.time() - 5],
        "_relay_envelope": lambda raw: json.loads(urllib.parse.parse_qs(raw.decode())["body"][0])}
    order = [n for n in RELAY_NAMES]
    stand_ins(text, nodes, ns)
    exec(compile("from __future__ import annotations\n" + "\n\n".join(ast.get_source_segment(text, nodes[n]) or ""
                                                                      for n in order), "relay_check", "exec"), ns)

    def raw_of(action: str, payload: dict) -> bytes:
        return urllib.parse.urlencode({"body": json.dumps({"action": action, "token": "t", "payload": payload,
                                                           "write_id": "Wcheck-sched-0001"})}).encode()

    swept = ns["_app_pack_swept"]
    old = time.time() - 900
    # a final write Python kept: its screens told, the whole app marked and laid by the next read
    res = asyncio.run(ns["_backend_final"]("scheduling", "schedulingCellSave", raw_of("schedulingCellSave", {"house": "AB1234"}),
                                           "Wcheck-sched-0001", {"status": 200, "data": {"ok": True}}, "", old,
                                           frozenset(), time.time(), False))
    check("a Python final write is answered as Python said it", res.status == 200)
    check("it rings the Scheduling screens and Support Requests, as an Apps Script landing does",
          "scheduling" in rang and "support-desk" in rang, rang)
    check("it marks the whole app and covers that mark for Python's next read",
          "scheduling" in swept and ("scheduling", "") in ns["_backend_final_at"]
          and ns["_backend_copy_at"]("scheduling", "", old, None, edits_at=time.time()) is not None
          and ns["_backend_copy_at"]("scheduling", "", old, None, edits_at=old) is None)
    rang.clear()
    # a minute later (inside BACKEND_OWN_SLACK_S a landing is taken for Python's own)
    ns["_backend_final_at"][("scheduling", "")] -= 60
    ns["_relay_observe_scheduling"]("schedulingSeed", b'{"status":200}')
    check("an Apps Script Scheduling write landing (the seed it was handed) rings the screens and sends Python's next "
          "read to Apps Script",
          rang == ["scheduling"] and ns["_backend_written_after"]("scheduling", "", old, None, edits_at=time.time() + 60))
    before = dict(swept)
    rang.clear()
    ns["_relay_observe_scheduling"]("schedulingCallOff", b'{"status":409,"message":"no"}')
    ns["_relay_observe_scheduling"]("schedulingBoard", b'{"status":200}')
    check("a refused write and a read ring nothing and mark nothing", rang == [] and swept == before)
    swept.clear()
    ns["_relay_observe_support_desk"]("supportDeskDecide", b'{"status":200}')
    check("a Support Requests decision that writes Scheduling's flows marks Scheduling and rings it",
          "scheduling" in swept and "scheduling" in rang and "support-desk" in rang)

    def write(action: str, python: Any, *, settling: bool = False, master: bool = False) -> tuple:
        state.update(python=python, settling=settling, master=master)
        calls.clear()
        return asyncio.run(ns["_backend_write"](action, raw_of(action, {"house": "AB1234"})))

    handed = {"status": 200, "_write": {"write_id": "W", "engine": True, "settle": False, "house": ""}}
    r, _raw, _s = write("schedulingSeed", handed)
    check("the seed's own hand-off (its dry run, a first seed) is carried to Apps Script", r is None)
    r, _raw, _s = write("schedulingCellSave", handed)
    check("a cell's save hands nothing any more (a training, a pending ask are Python's): an answer handing it is never "
          "carried", r is not None and r.status == 503)
    r, _raw, _s = write("schedulingSettingsSet", handed)
    check("a final door that may not hand off and answers a sheet write is never carried", r is not None and r.status == 503)
    r, _raw, _s = write("schedulingCellSave", None)
    check("a final door Python could not decide writes nothing anywhere (never Apps Script)", r is not None and r.status == 503)
    kept = {"status": 200, "data": {"ok": True}, "_write": {"write_id": "W", "engine": False, "final": True, "house": "AB1234",
                                                            "cells": 3}}
    swept.clear()
    ns["_backend_final_at"].clear()
    r, _raw, _s = write("schedulingCellSave", kept)
    check("a final door's kept write is answered by Python", r is not None and r.status == 200)
    r, _raw, _s = write("schedulingCallOff", handed)
    check("a flow is final too: an answer handing it to Apps Script is never carried", r is not None and r.status == 503)
    r, _raw, _s = write("schedulingCallOff", kept)
    check("a flow Python keeps is answered by Python (its texts owed on the flow, said by Python's flow clock)",
          r is not None and r.status == 200)
    r, _raw, _s = write("schedulingCallOff", {"status": 409, "message": "This shift has ended."})
    check("a flow Python refuses is answered in its words", r is not None and r.status == 409)
    moment = ns["_app_pack_people_at"][0]
    r, _raw, _s = write("schedulingCellSave", kept, settling=True)
    check("while who may write settles, another's final write is asked of Python with the change's moment (Python "
          "answers 503 from a copy older than it), never Apps Script",
          r is not None and len(calls) == 1 and calls[0][2].get("people_at") == moment, calls)
    r, _raw, _s = write("schedulingCellSave", kept, settling=True, master=True)
    check("the master's final write goes on meanwhile, asked without it",
          r is not None and r.status == 200 and calls and "people_at" not in calls[0][2], calls)
    r, _raw, _s = write("schedulingCallOff", kept, settling=True)
    check("a flow meanwhile is asked of Python the same way, never Apps Script",
          r is not None and len(calls) == 1 and calls[0][2].get("people_at") == moment, calls)


# ---- 3. the reads and doors on real data, in asa-hub-db-sync ------------------------------------------------------------

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, re, resource, sys, time, types, uuid, collections
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


class Resp:
    def __init__(self, content=b"", status_code=200, media_type="", headers=None):
        self.body = content if isinstance(content, (bytes, str)) else json.dumps(content)
        self.status_code, self.headers = status_code, dict(headers or {})


class App:
    def __init__(self, **_kw):
        pass

    def _route(self, *_a, **_kw):
        return lambda fn: fn
    get = post = _route


fake.FastAPI, fake.Request = App, object
responses = types.ModuleType("fastapi.responses")
responses.JSONResponse = lambda content, status_code=200, headers=None: Resp(content, status_code, "", headers)
responses.Response = Resp
conc = types.ModuleType("starlette.concurrency")


async def run_in_threadpool(fn, *a, **kw):
    return fn(*a, **kw)
conc.run_in_threadpool = run_in_threadpool
sys.modules.update({"fastapi": fake, "fastapi.responses": responses, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": conc})

import psycopg
import gsjs, hubdb, scope as sc, locations as L, writes as W, client_writes as CW, redaction
import scheduling as SCH, scheduling_writes as SW, scheduling_builder as SB, scheduling_flows as SF
import staff_views
import main as M

# a flow's system-log line goes on the Staff store's own connection, outside the check's transaction: kept nowhere here
staff_views.bind(None)
out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_check"
W.LOCK_KEY = 0x5343484B4348


LIVE_WRITE = re.compile(r"\b(insert\s+into|update|delete\s+from|merge\s+into|truncate|alter\s+table|drop\s+table|"
                        r"create\s+(unique\s+)?(table|index)(\s+if\s+not\s+exists)?(\s+\w+\s+on)?)\s+app\.", re.I)


def rw(sql):
    """The check's own tables for the store's; a statement that would write or lock a live app.* table is refused
    before it is sent (the flows decide for real here, inside the check's transaction)."""
    if not isinstance(sql, str):
        return sql
    sql = sql.replace("app.scheduling_", "pg_temp.scheduling_")
    if LIVE_WRITE.search(sql) or (re.search(r"\bfor\s+(no\s+key\s+)?update\b", sql, re.I) and re.search(r"\bapp\.", sql)):
        raise RuntimeError("the check refuses a write to a live table: " + " ".join(sql.split())[:90])
    return sql


class Cur:
    def __init__(self, cur):
        self.c = cur

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
    def __init__(self, real):
        self.real = real

    @property
    def closed(self):
        return self.real.closed

    @property
    def broken(self):
        return self.real.broken

    def execute(self, sql, params=None):
        return Cur(self.real.cursor()).execute(sql, params)

    def cursor(self):
        return Cur(self.real.cursor())

    def transaction(self):
        return self.real.transaction()

    def close(self):
        pass


db = hubdb.HubDb()
reads0 = L.Reads(db, None)
real_books = SW.verdict_books(reads0)
facts["Scheduling verdict books stale right now (real check)"] = f"{sum(1 for b in real_books if db.stale({b}))} of {len(real_books)}"
# the copy taken as current: a verdict resting on rows is answered, never deferred for a book Drive moved meanwhile
db.stale = lambda books: False
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="scheduling-check")
store = W.Store(connect=lambda: Conn(real), kind="scheduling", label="Scheduling")
off = W.Store(dsn="")
M.DB = db
M.STORE = M.CLIENT_STORE = M.STAFF_STORE = M.SSA_STORE = M.FAMILY_STORE = off
M.SCHEDULING_STORE = store
M.WRITE_BUDGET_S = 120.0
APP, DOORS = M.APPS["scheduling"], M.WRITES["scheduling"]
spent, seq = {}, [0]
MARK = re.compile(r"\[withheld: ")


def read(action, who, payload):
    t0 = time.monotonic()
    res = M._run(APP, action, who, payload)
    spent[action] = max(spent.get(action, 0.0), time.monotonic() - t0)
    return res.status_code, json.loads(res.body)


def write(action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-sch-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    t0 = time.monotonic()
    res = M._run_write(DOORS, action, who, payload, wid)
    spent[action] = max(spent.get(action, 0.0), time.monotonic() - t0)
    return res.status_code, json.loads(res.body), wid


def _where(tab):
    try:
        res = W.tab_of(reads0, tab)
        return W.where_of(res) if res.ref is not None else None
    except Exception:  # noqa: BLE001 - a tab Python never writes
        return None


# each Scheduling house is its own book: (sheet, tab) -> the house's name
LOGICAL = {_where(t): t for t in SCH.TABS.values() if _where(t)}


def rows_of(wid):
    with real.cursor() as c:
        c.execute("select sheet_id, tab_name, kind, match_by, row_key, field, value, before, app"
                  " from pg_temp.hub_edits_check where write_id = %s order by id", (wid,))
        return [(LOGICAL.get((s, t), "?" + t),) + tuple(rest) for s, t, *rest in c.fetchall()]


def all_rows():
    with real.cursor() as c:
        c.execute("select sheet_id, tab_name, write_id from pg_temp.hub_edits_check")
        return [(LOGICAL.get((s, t), "?" + t), w) for s, t, w in c.fetchall()]


def said(env):
    """A refusal's words as a shape: they may name a person or a house."""
    return re.sub(r"[A-Z][\w'’.-]*", "X", str(env.get("message") or ""))[:120]


def final_of(env):
    return (env.get("_write") or {}).get("final") is True


def engine_of(env):
    return (env.get("_write") or {}).get("engine") is True


def unknown(code, env):
    return code == 200 and env == {"status": 404, "message": "Unknown action."}


def laid_reads():
    return L.Reads(db, None)


def laid(fn):
    """fn over a fresh read with the check's kept edits laid, as every Python read lays them."""
    tok = hubdb.OWN.set(CW.Own([], book=db.book, edits=store.edits(), edits_at=time.time()))
    try:
        return fn(L.Reads(db, None))
    finally:
        hubdb.OWN.reset(tok)


def guarded(name, fn):
    try:
        with real.transaction():
            fn()
    except Exception as exc:  # noqa: BLE001 - said as a failed check, never a value
        import traceback
        check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:200] + " @ " +
              traceback.format_exc().strip().splitlines()[-3][:160])


users = reads0.users()
live_users = [u for u in users if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
by_uid = {gsjs.str_(u.get("userid")): u for u in live_users}
master = next((u for u in live_users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")), "role": "admin", "is_master": True}


def who_of(u):
    return {"uid": gsjs.str_(u.get("userid")), "role": gsjs.str_(u.get("role")).lower(), "is_master": False}


rows0 = SCH.read_tab(reads0, "sched_rows")
cells0 = SCH.read_tab(reads0, "sched_cells")
dirs = {d["uid"] for d in SCH.settings(reads0)["directors"]}
hm_keys = {r["person_key"]: r["house_code"] for r in rows0 if r["designation"] == "**" and r["active"] != "no"}
plain = hm = None
for r in rows0:
    if r["row_kind"] != "person" or r["active"] == "no" or not r["person_key"]:
        continue
    u = SCH.user_by_key(reads0, r["person_key"])
    uid = gsjs.str_((u or {}).get("uid"))
    acct = by_uid.get(uid)
    if not acct or uid in dirs or uid == MASTER["uid"] or gsjs.str_(acct.get("role")).lower() not in ("staff", "manager"):
        continue
    if r["person_key"] in hm_keys and hm is None:
        hm = (acct, r["person_key"], hm_keys[r["person_key"]])
    if r["person_key"] not in hm_keys and plain is None and gsjs.str_(acct.get("role")).lower() == "staff":
        plain = (acct, r["person_key"])
client = next((u for u in live_users if gsjs.str_(u.get("role")).lower() == "client"), None)
check("the master, a house manager, a plain staff member and a client account are read from the users tab",
      bool(master and hm and plain and client))
HM, PLAIN, CLIENT = who_of(hm[0]), who_of(plain[0]), who_of(client)
houses = sorted({r["house_code"] for r in rows0 if r["row_kind"] == "person" and r["active"] != "no"},
                key=lambda h: -sum(1 for r in rows0 if r["house_code"] == h and r["row_kind"] == "person"))[:3]
facts["houses read as the master"] = str(len(houses))
TODAY = reads0.today()
period = SCH.current_period(reads0)


def no_mark(env):
    return not MARK.search(json.dumps(env, ensure_ascii=False))


# ---- reads -------------------------------------------------------------------------------------------------------------

def reads_master():
    code, env = read("schedulingBoard", MASTER, {})
    data = env.get("data") or {}
    check("schedulingBoard (master): 200, every one of the three houses on it, no withheld marker",
          code == 200 and env.get("status") == 200 and all(h in (data.get("grids") or {}) for h in houses) and no_mark(env),
          [code, env.get("status"), said(env)])
    check("the master's board names the master, shows hours and every house's log",
          (data.get("viewer") or {}).get("is_master") is True and not (data.get("display") or {}).get("hidden", {}).get("hours")
          and set(data.get("log") or {}) >= set(houses))
    nxt = [p["id"] for p in SCH.settings(reads0)["periods"] if p["id"] != period["id"]]
    if nxt:
        code, env = read("schedulingBoard", MASTER, {"period_id": nxt[0]})
        check("schedulingBoard for the next period (master): 200", code == 200 and env.get("status") == 200)
    code, env = read("schedulingBoard", MASTER, {"period_id": "P1999-01-04"})
    check("a period that does not exist: 404 in its words", env.get("status") == 404)
    for h in houses:
        person = next(r["person_key"] for r in rows0 if r["house_code"] == h and r["row_kind"] == "person" and r["person_key"])
        code, env = read("schedulingStaffShifts", MASTER, {"person": person})
        check(f"schedulingStaffShifts (master, a person of house {houses.index(h) + 1}): 200, no marker",
              code == 200 and env.get("status") == 200 and isinstance((env.get("data") or {}).get("shifts"), list)
              and no_mark(env), [code, env.get("status")])
        code, env = read("schedulingBuilderRead", MASTER, {"house": h})
        check(f"schedulingBuilderRead (master, house {houses.index(h) + 1}): 200 for that house, no marker",
              code == 200 and env.get("status") == 200 and (env.get("data") or {}).get("house") == h and no_mark(env),
              [code, env.get("status"), said(env)])
    code, env = read("schedulingStaffShifts", MASTER, {"person": "open"})
    check("schedulingStaffShifts (master, the open shifts): 200", code == 200 and env.get("status") == 200)
    code, env = read("schedulingStaffShifts", MASTER, {"person": plain[1], "via": "staff"})
    check("schedulingStaffShifts through Staff (master): 200 with the houses' residents",
          code == 200 and env.get("status") == 200 and isinstance((env.get("data") or {}).get("houses"), list))
    for past in (False, True):
        code, env = read("schedulingTimeOffList", MASTER, {"past": past})
        check(f"schedulingTimeOffList (master, past={past}): 200, no marker",
              code == 200 and env.get("status") == 200 and no_mark(env), [code, env.get("status")])


def reads_narrowed():
    src = reads0.scope_sources()
    user = sc.user_from_row(plain[0])
    open_ = {f: bool(sc.profile_app_gate(f, user, src).get("open"))
             for f in (SCH.APP_ID, SCH.STAFF_FEATURE, SCH.TIMEOFF_FEATURE, SB.FEATURE)}
    code, env = read("schedulingBoard", PLAIN, {})
    data = env.get("data") or {}
    if open_[SCH.APP_ID]:
        check("schedulingBoard (a plain staff member): 200, not the master, no log, edits no house, no marker",
              code == 200 and env.get("status") == 200 and (data.get("viewer") or {}).get("is_master") is False
              and not data.get("log") and not (data.get("viewer") or {}).get("editor_of") and no_mark(env),
              [code, env.get("status")])
        hidden = SCH.hours_hidden(reads0, SCH.ctx_for(reads0, user, {"open": True}))
        check("the narrowed board hides the hours exactly as Settings hides them from a viewer like this one",
              (data.get("display") or {}).get("hidden", {}).get("hours") == hidden, hidden)
    else:
        check("schedulingBoard (a plain staff member): Unknown action while App Control holds Scheduling back",
              unknown(code, env))
    for action, feature, payload in (("schedulingStaffShifts", SCH.STAFF_FEATURE, {}),
                                     ("schedulingTimeOffList", SCH.TIMEOFF_FEATURE, {}),
                                     ("schedulingBuilderRead", SB.FEATURE, {})):
        code, env = read(action, PLAIN, payload)
        want = open_[SCH.APP_ID] and open_[feature]
        check(f"{action} (a plain staff member): {'answered' if want else 'Unknown action'} as App Control releases "
              f"{feature}", (code == 200 and env.get("status") in (200, 400, 403)) if want else unknown(code, env),
              [code, env.get("status")])
    code, env = read("schedulingBoard", CLIENT, {})
    check("schedulingBoard (a client account): refused by the policy or the gate",
          code == 200 and env.get("status") in (403, 404))
    facts["App Control for a plain staff member (board, staff calendars, time off, builder)"] = \
        ", ".join("open" if open_[f] else "shut" for f in (SCH.APP_ID, SCH.STAFF_FEATURE, SCH.TIMEOFF_FEATURE, SB.FEATURE))


def parity():
    kept = blob.get("kept") or []
    ns = {"redaction": redaction, "_VIEWER_CACHE_LANES": {}}
    exec(blob["withhold"], ns)
    boards = [k for k in kept if k.get("read") == "schedulingBoard"]
    facts["kept Scheduling copies on the relay"] = ", ".join(f"{r} {sum(1 for k in kept if k.get('read') == r)}"
                                                           for r in sorted({k.get('read') for k in kept})) or "none"
    if not boards:
        check("the relay keeps no board copy to compare with just now", True)
        return
    for k in boards:
        env = json.loads(k["body"])
        data = env.get("data") or {}
        uid = (data.get("viewer") or {}).get("uid") or ""
        u = by_uid.get(uid)
        if not u:
            check("the kept board's viewer is on the users tab", False)
            continue
        who = {"uid": uid, "role": gsjs.str_(u.get("role")).lower(), "is_master": uid == MASTER["uid"]}
        asked = json.loads(k["asked"]).get("payload") if k.get("asked") else {}
        code, mine = read("schedulingBoard", who, asked if isinstance(asked, dict) else {})
        withheld, _n = ns["_viewer_cache_withhold"]("schedulingBoard", mine.get("data"))
        diffs = []

        def walk(a, b, path):
            if path in ("/now",):
                return
            if isinstance(a, dict) and isinstance(b, dict):
                for key in set(a) | set(b):
                    walk(a.get(key, "<absent>"), b.get(key, "<absent>"), path + "/" + str(key))
            elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
                for i, (x, y) in enumerate(zip(a, b)):
                    walk(x, y, path + "/" + str(i))
            elif a != b:
                diffs.append(re.sub(r"/(grids|busy|log|people)/[^/]+", r"/\1/*", re.sub(r"/\d+", "/#", path)))
        walk(data, withheld, "")
        rows = sum(len(g.get("rows") or []) for g in (data.get("grids") or {}).values())
        role = "the master" if who["is_master"] else ("a director" if uid in dirs else "another viewer")
        check(f"Python's board for the kept copy's viewer ({role}) equals the kept Apps Script board, the private "
              f"words withheld alike ({len(data.get('grids') or {})} houses, {rows} rows; copy "
              f"{int(time.time() - float(k.get('wall') or 0)) // 60} min old)", code == 200 and not diffs,
              collections.Counter(diffs).most_common(6))


# ---- writes ------------------------------------------------------------------------------------------------------------

def pick_cell():
    """A person on a house's roster, a day of the current period ahead with nothing of theirs anywhere, a common shift."""
    reads = laid_reads()
    holds = SCH.holds_now(reads)
    texts = collections.Counter(c["text"] for c in cells0 if c["state"] == "scheduled"
                                and (SCH.classify(c["text"]) or SCH.Cls("", "", None, None, None, 0)).start is not None)
    value = next(t for t, _n in texts.most_common() if SCH.range_count(t) == 1)
    days = [d for d in SCH.dates(period["first"], period["last"]) if d > TODAY]
    for h in houses:
        for r in rows0:
            if r["house_code"] != h or r["row_kind"] != "person" or r["active"] == "no" or not r["person_key"]:
                continue
            if not SW.on_roster(reads, h, r["person_key"]) or SCH.prefs_against(reads, r["person_key"], r["name"], h, ""):
                continue
            busy = {x["date"] for x in holds.get(r["person_key"], [])}
            free = [d for d in days if d not in busy and not SW.cell_at(reads, h, r["row_id"], d)
                    and not SW.cell_busy(reads, h, r["row_id"], d)]
            if free:
                return h, r, free[0], value
    return None


def outsider(h, day, but=()):
    """A person active on another house only, with nothing that day."""
    reads = laid_reads()
    holds = SCH.holds_now(reads)
    here = {r["person_key"] for r in rows0 if r["house_code"] == h and r["row_kind"] == "person"}
    for r in rows0:
        k = r["person_key"]
        if r["row_kind"] != "person" or r["active"] == "no" or not k or k in here or k in but:
            continue
        if any(x["date"] == day for x in holds.get(k, [])) or SCH.prefs_against(reads, k, r["name"], h, day):
            continue
        return r
    return None


def board_cell(h, row_id, day):
    _code, env = read("schedulingBoard", MASTER, {"period_id": period["id"]})
    g = ((env.get("data") or {}).get("grids") or {}).get(h) or {}
    cols = [c["iso"] for c in g.get("cols") or []]
    row = next((r for r in g.get("rows") or [] if r.get("row_id") == row_id), None)
    if row is None or day not in cols:
        return None
    return row["cells"][cols.index(day)]


def edits_shape(rows):
    return sorted({(t, k, m) for t, k, m, *_rest in rows})


def board_doors():
    picked = pick_cell()
    check("a free cell of a rostered person is found on one of the three houses", picked is not None)
    if picked is None:
        return
    h, r, day, value = picked
    cid = SCH.cell_id(h, r["row_id"], day)
    code, env, wid = write("schedulingCellSave", PLAIN, {"house": h, "row_id": r["row_id"], "date": day, "value": value,
                                                         "via": "add"})
    check("schedulingCellSave (a plain staff member): refused in the .gs words, nothing kept",
          env.get("status") in (403, 404) and not final_of(env) and not rows_of(wid), [env.get("status"), said(env)])
    code, env, wid = write("schedulingCellSave", HM if hm[2] != h else PLAIN,
                           {"house": h, "row_id": r["row_id"], "date": day, "value": value, "via": "add"})
    check("schedulingCellSave (another house's manager): 403, nothing kept",
          env.get("status") in (403, 404) and not rows_of(wid), [env.get("status"), said(env)])
    code, env, wid = write("schedulingCellSave", MASTER, {"house": h, "row_id": r["row_id"], "date": day, "via": "move"})
    check("schedulingCellSave with a wrong via: 400, nothing kept", env.get("status") == 400 and not rows_of(wid))
    code, env, wid = write("schedulingCellSave", MASTER, {"house": h, "row_id": r["row_id"], "date": day, "value": value,
                                                         "via": "add"})
    got = rows_of(wid)
    cell = {f: v for t, _k, _m, key, f, v, _b, _a in got if t == "sched_cells" and key == cid}
    check("schedulingCellSave (master, a plain placement): 200, final, kept as the cell and its log line in app.edits",
          env.get("status") == 200 and final_of(env)
          and edits_shape(got) in ([("sched_cells", "append", "id"), ("sched_log", "append", "id")],
                                   [("sched_cells", "edit", "id"), ("sched_log", "append", "id")]),
          [env.get("status"), said(env), edits_shape(got)])
    check("the cell is keyed by its lasting id (house, row, day), never a sheet row; the store names the app",
          cell.get("text") == value and cell.get("house_code", h) == h and cell.get("date", day) == day
          and all(a == "scheduling" for *_x, a in got) and not any(re.fullmatch(r"r?\d+", k) for _t, _k, _m, k, *_r in got),
          sorted({k[:3] for _t, _k, _m, k, *_r in got}))
    shown = board_cell(h, r["row_id"], day)
    check("the next board read shows the kept cell", bool(shown) and shown.get("text") == value)
    code, env, wid = write("schedulingCellSave", MASTER, {"house": h, "row_id": r["row_id"], "date": day, "value": value,
                                                         "via": "add"})
    check("adding over it again: 409 'edit it instead', nothing kept", env.get("status") == 409 and not rows_of(wid))
    code, env, wid = write("schedulingCellSave", MASTER, {"house": h, "row_id": r["row_id"], "date": day, "via": "delete"})
    got = rows_of(wid)
    cleared = {f: (v, b) for t, _k, _m, key, f, v, b, _a in got if t == "sched_cells" and key == cid}
    check("schedulingCellSave delete: 200, final, the cell blanked field by field with what each held named",
          env.get("status") == 200 and final_of(env) and cleared.get("text") == ("", value)
          and all(v == "" for f, (v, _b) in cleared.items() if f not in ("updated_at", "updated_by"))
          and ("sched_log", "append", "id") in edits_shape(got), [env.get("status"), edits_shape(got)])
    check("the next board read shows no cell there", not (board_cell(h, r["row_id"], day) or {}).get("text"))
    code, env, wid = write("schedulingUndo", MASTER, {"house": h})
    got = rows_of(wid)
    check("schedulingUndo (master): 200, final, the cell put back and the log line stamped undone",
          env.get("status") == 200 and final_of(env)
          and any(t == "sched_cells" and f == "text" and v == value for t, _k, _m, _key, f, v, _b, _a in got)
          and any(t == "sched_log" and k == "edit" and f == "undone_at" and v for t, k, _m, _key, f, v, _b, _a in got),
          [env.get("status"), said(env), edits_shape(got)])
    check("the next board read shows it back", (board_cell(h, r["row_id"], day) or {}).get("text") == value)
    code, env, wid = write("schedulingUndo", PLAIN, {"house": h})
    check("schedulingUndo (a plain staff member): refused, nothing kept", env.get("status") in (403, 404) and not rows_of(wid))
    q = outsider(h, day)
    q2 = outsider(h, day, but={q["person_key"]}) if q is not None else None
    if q2 is not None:
        code, env, wid = write("schedulingCellSave", MASTER, {"house": h, "person": q2["name"], "date": day,
                                                             "value": value, "via": "add"})
        got = rows_of(wid)
        tr = (env.get("data") or {}).get("training") or {}
        facts["somebody new to the house, placed"] = ("as a training (no IST there)" if tr else "plainly (the IST on file)"
                                                      if env.get("status") == 200 else f"refused {env.get('status')}")
        check("schedulingCellSave of a timed shift for somebody new to the house: decided in Python, never handed — "
              "kept final (a training's flow among the rows when the IST is lacking), or refused in its words when "
              "nobody can approve a training",
              not engine_of(env) and ((env.get("status") == 200 and final_of(env) and bool(got)
                                       and any(t == "sched_cells" for t, *_x in got)
                                       and (not tr or any(key == tr.get("flow_id") for _t, _k, _m, key, *_x in got)))
                                      or (env.get("status") in (409, 503) and not rows_of(wid))),
              [env.get("status"), said(env), env.get("_write"), edits_shape(got)])
    if q is not None:
        code, env, wid = write("schedulingAddPerson", MASTER, {"house": h, "person": q["name"]})
        got = rows_of(wid)
        check("schedulingAddPerson (master): 200, final, the person row (by its id) and a log line",
              env.get("status") == 200 and final_of(env)
              and edits_shape(got) in ([("sched_log", "append", "id"), ("sched_rows", "append", "id")],
                                       [("sched_log", "append", "id"), ("sched_rows", "edit", "id")])
              and any(t == "sched_rows" and key == SCH.row_id_of(h, "P:" + q["person_key"]) for t, _k, _m, key, *_x in got),
              [env.get("status"), said(env), edits_shape(got)])
        code, env, wid = write("schedulingAddPerson", MASTER, {"house": h, "person": q["name"]})
        check("adding the same person again: 409, nothing kept", env.get("status") == 409 and not rows_of(wid))
        code, env, wid = write("schedulingUndo", MASTER, {"house": h})
        got = rows_of(wid)
        check("schedulingUndo of the add: the row set inactive, final",
              env.get("status") == 200 and final_of(env)
              and any(t == "sched_rows" and f == "active" and v == "no" for t, _k, _m, _key, f, v, _b, _a in got))
    code, env, wid = write("schedulingAddPerson", MASTER, {"house": h, "person": "OPEN 3"})
    check("schedulingAddPerson of an OPEN row: 400, nothing kept", env.get("status") == 400 and not rows_of(wid))
    st = SCH.settings(laid_reads())
    new_wait = 5 if int(st["outreach_wait_min"]) != 5 else 6
    code, env, wid = write("schedulingSettingsSet", HM, {"values": {"outreach_wait_min": new_wait}})
    check("schedulingSettingsSet (a house manager): 403, nothing kept", env.get("status") == 403 and not rows_of(wid))
    code, env, wid = write("schedulingSettingsSet", MASTER, {"values": {"outreach_wait_min": 42}})
    check("schedulingSettingsSet out of range: 400, nothing kept", env.get("status") == 400 and not rows_of(wid))
    code, env, wid = write("schedulingSettingsSet", MASTER, {"values": {"outreach_wait_min": new_wait}})
    got = rows_of(wid)
    check("schedulingSettingsSet (master): 200, final, the settings row matched by its key, and read back",
          env.get("status") == 200 and final_of(env) and edits_shape(got) in ([("sched_settings", "edit", "cols:key")],
                                                                              [("sched_settings", "append", "cols:key")])
          and all(key == "outreach_wait_min" for _t, _k, _m, key, *_x in got)
          and (env.get("data") or {}).get("settings", {}).get("outreach_wait_min") == new_wait
          and laid(lambda rd: SCH.settings(rd)["outreach_wait_min"]) == new_wait, [env.get("status"), edits_shape(got)])


def builder_doors():
    drafts = SB._read(laid_reads(), SB.TABS["drafts"])
    d = next((x for x in drafts if x.get("state") == "published"), None) or (drafts[0] if drafts else None)
    check("a stored Builder draft is there to save and publish", d is not None)
    if d is None:
        return
    h = d["house_code"]
    code, env = read("schedulingBuilderRead", MASTER, {"house": h, "first": d["first"], "last": d["last"]})
    data = env.get("data") or {}
    base = {"house": h, "first": d["first"], "last": d["last"], "draft": data.get("draft")}
    code, env, wid = write("schedulingBuilderSave", MASTER, {**base, "state": "approved", "rev": str(int(data.get("rev") or 0) + 7)})
    check("schedulingBuilderSave on a stale rev: 409, nothing kept", env.get("status") == 409 and not rows_of(wid))
    code, env, wid = write("schedulingBuilderSave", PLAIN, {**base, "state": "pattern", "rev": str(data.get("rev") or 0)})
    check("schedulingBuilderSave (a plain staff member): refused, nothing kept",
          env.get("status") in (403, 404) and not rows_of(wid))
    code, env, wid = write("schedulingBuilderSave", MASTER, {**base, "first": "2026-10-27", "rev": "0"})
    check("schedulingBuilderSave on a Tuesday: 400, nothing kept", env.get("status") == 400 and not rows_of(wid))
    approve = (data.get("draft") or {}).get("applied") is True
    code, env, wid = write("schedulingBuilderSave", MASTER, {**base, "state": "approved" if approve else "pattern",
                                                            "rev": str(data.get("rev") or 0)})
    got = rows_of(wid)
    check("schedulingBuilderSave (master): 200, final, the draft row edited by its id (rev and stamps)",
          env.get("status") == 200 and final_of(env) and edits_shape(got) == [(SB.TABS["drafts"], "edit", "id")]
          and all(key == d["id"] for _t, _k, _m, key, *_x in got) and "rev" in {f for *_x, f, _v, _b, _a in got},
          [env.get("status"), said(env), edits_shape(got)])
    rev = str((env.get("data") or {}).get("rev") or "")
    code, env, wid = write("schedulingBuilderPublish", MASTER, {"house": h, "first": d["first"], "rev": rev})
    got = rows_of(wid)
    if approve:
        check("schedulingBuilderPublish (master, the approved draft): 200, final, kept in app.edits by lasting ids only",
              env.get("status") == 200 and final_of(env) and (SB.TABS["drafts"], "edit", "id") in edits_shape(got)
              and {t for t, *_x in got} <= set(SB.TABS.values())
              and all(m in ("id", "cols:key") for _t, _k, m, *_x in got), [env.get("status"), said(env), edits_shape(got)])
        facts["the publish kept"] = ", ".join(f"{t} {n}" for t, n in sorted(collections.Counter(t for t, *_x in got).items()))
    else:
        check("schedulingBuilderPublish of a pattern draft: 409 'approve first', nothing kept",
              env.get("status") == 409 and not rows_of(wid))
    code, env, wid = write("schedulingBuilderPublish", MASTER, {"house": h, "first": d["first"], "rev": "999"})
    check("schedulingBuilderPublish on a stale rev: 409 or nothing to publish, nothing kept",
          env.get("status") in (404, 409) and not rows_of(wid))


def left_doors():
    """The seed, the roll and the time-off import: the seed's dry run still handed (it reads the house books), the
    other two decided and kept in Python."""
    seed = {"first": "2026-09-28", "last": "2026-10-25", "dry_run": True}
    roll = {"dry_run": False, "from": SCH.settings(laid_reads())["periods"][-1]["id"]}
    code, env, wid = write("schedulingSeed", MASTER, seed)
    facts["schedulingSeed (master, a dry run)"] = (
        "handed to Apps Script" if engine_of(env) else "answered in Python" if env.get("status") == 200
        else f"Python's {code}: {str(env.get('defer') or env.get('message') or '')[:120]}")
    check("schedulingSeed (master, a dry run): handed to Apps Script by its own verdict while it reads the house books "
          "there, or answered in Python (or its own 503 when the grids are not readable) — nothing kept either way",
          not rows_of(wid) and not final_of(env) and (
              (env.get("status") == 200 and engine_of(env))
              or (env.get("status") == 200 and (env.get("data") or {}).get("dry_run") is True and not env.get("_write"))
              or (code == 503 and "defer" in env) or env.get("status") == 503),
          [code, env.get("status"), said(env), str(env.get("defer") or "")[:160]])
    for action, payload in (("schedulingRoll", roll), ("schedulingTimeOffImport", {"apply": True})):
        code, env, wid = write(action, MASTER, payload)
        got = rows_of(wid)
        facts[f"{action} (master, the real thing)"] = (f"kept final, {len(got)} cells: " + ", ".join(
            f"{t} {n}" for t, n in sorted(collections.Counter(t for t, *_x in got).items()))
            if final_of(env) else f"{env.get('status')}, nothing kept")
        check(f"{action} (master, the real thing): decided in Python, never handed — kept final, or refused in its "
              f"words with nothing kept",
              not engine_of(env) and ((env.get("status") == 200 and final_of(env) and bool(got))
                                      or (env.get("status") in (400, 404, 409) and not got)),
              [env.get("status"), said(env), env.get("_write")])
    for action, payload in (("schedulingSeed", seed), ("schedulingRoll", roll), ("schedulingTimeOffImport", {"apply": True})):
        code, env, wid = write(action, HM, payload)
        check(f"{action} (a house manager): 403 in the .gs words, nothing kept",
              env.get("status") == 403 and not rows_of(wid))
    code, env, wid = write("schedulingRoll", MASTER, {"dry_run": True})
    rep = (env.get("data") or {}).get("report") or {}
    check("schedulingRoll dry run (master): answered here, writes nothing",
          env.get("status") == 200 and not env.get("_write") and not rows_of(wid) and "cells" in rep)
    code, env, wid = write("schedulingRoll", MASTER, {"dry_run": False, "from": "P1999-01-04"})
    check("schedulingRoll from a period already rolled past: 409, nothing kept", env.get("status") == 409 and not rows_of(wid))
    code, env, wid = write("schedulingTimeOffImport", MASTER, {})
    check("schedulingTimeOffImport dry run (master): answered here (or, the Time Off house unread, Python's own 503), "
          "writes nothing",
          ((code == 200 and env.get("status") == 200 and "report" in (env.get("data") or {})) or (code == 503 and "defer" in env))
          and not env.get("_write") and not rows_of(wid), [code, env.get("status")])


def flow_doors():
    reads = laid_reads()
    future = [c for c in cells0 if c["date"] > TODAY and c["state"] == "scheduled" and c["house_code"] in houses
              and c["row_id"].startswith("P:") and (SCH.classify(c["text"]) or SCH.Cls("", "", None, None, None, 0)).start is not None]
    past = [c for c in cells0 if c["date"] < TODAY and c["state"] == "scheduled" and c["row_id"].startswith("P:")
            and (SCH.classify(c["text"]) or SCH.Cls("", "", None, None, None, 0)).start is not None]
    opened = [c for c in cells0 if c["date"] > TODAY and c["state"] == "open"]
    f, p = future[-1], past[-1]
    tries = [("schedulingCallOff", MASTER, {"house": f["house_code"], "row_id": f["row_id"], "date": f["date"],
                                            "reason": "check"}, "a future shift"),
             ("schedulingCallOff", MASTER, {"house": p["house_code"], "row_id": p["row_id"], "date": p["date"],
                                            "reason": "check"}, "an ended shift"),
             ("schedulingCallOff", MASTER, {"house": f["house_code"], "row_id": "P:nobody", "date": f["date"],
                                            "reason": "check"}, "an empty row"),
             ("schedulingRequestOff", MASTER, {"house": f["house_code"], "row_id": f["row_id"], "date": f["date"]},
              "a future shift"),
             ("schedulingTimeOff", MASTER, {"from": f["date"], "to": f["date"], "reason": "check"}, "a future day"),
             ("schedulingSwapPropose", MASTER, {"house": f["house_code"], "row_id": f["row_id"], "date": f["date"]},
              "no replacement"),
             ("schedulingWithdraw", MASTER, {"flow_id": "SF_nothing_here"}, "an unknown flow"),
             ("schedulingAnswer", MASTER, {"item_id": "SI_nothing_here", "word": "approve"}, "an unknown item")]
    if opened:
        o = opened[0]
        tries.append(("schedulingTake", PLAIN, {"house": o["house_code"], "row_id": o["row_id"], "date": o["date"]},
                      "an open shift"))
    seen = collections.Counter()
    for action, who, payload, what in tries:
        code, env, wid = write(action, who, payload)
        got = rows_of(wid)
        ok = code == 200 and not engine_of(env) and (
            (env.get("status") == 200 and final_of(env) and bool(got) and {t for t, *_x in got} <= set(SCH.TABS.values()))
            or (env.get("status") in (400, 403, 404, 409) and not env.get("_write") and not got))
        said_as = "kept final" if final_of(env) else "handed" if engine_of(env) else str(env.get("status"))
        seen[said_as] += 1
        check(f"{action} ({what}): decided in Python, {said_as} — kept in Scheduling's houses or refused in its words, "
              f"never handed to Apps Script", ok, [code, env.get("status"), said(env), edits_shape(got)])
    facts["flow outcomes"] = ", ".join(f"{k} {n}" for k, n in sorted(seen.items()))
    for action in sorted(set(DOORS.ACTIONS) - {"schedulingAnswer"}):
        code, env, wid = write(action, CLIENT, {"house": houses[0]})
        check(f"{action} (a client account): refused before any decision", env.get("status") in (403, 404) and not rows_of(wid),
              [env.get("status")])


try:
    with real.transaction():
        store.ensure()
        check("the edit store is made in temp tables (the store's own ensure, a lock key nobody else takes)",
              store.ready(), store.why)
        for name, fn in (("reads as the master", reads_master), ("reads as a narrowed viewer", reads_narrowed),
                         ("parity", parity), ("the board's doors", board_doors), ("the Builder's doors", builder_doors),
                         ("the doors left on Apps Script", left_doors), ("the flows", flow_doors)):
            guarded(name, fn)
        kept = all_rows()
        check("no door kept a cell in any book but Scheduling's own houses (a flow's texts owed on the flow, never "
              "appended)",
              {t for t, _w in kept} <= set(SCH.TABS.values()), sorted({t for t, _w in kept}))
        facts["cells kept in the check's app.edits (temp)"] = f"{len(kept)} cells from {len({w for _t, w in kept})} writes"
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
with psycopg.connect(hubdb._dsn(), autocommit=True, connect_timeout=5) as c2:
    left = c2.execute("select count(*) from pg_stat_activity where application_name = 'scheduling-check'").fetchone()[0]
    real_sched = c2.execute("select to_regclass('app.scheduling_writes') is not null").fetchone()[0]
check("nothing is left: the check's session is gone, its temp tables with it", left == 0, left)
facts["app.scheduling_writes in the live database"] = "exists" if real_sched else "not made yet (asa-hub-app makes it on start)"
facts["slowest answer per action (s)"] = ", ".join(f"{a} {t:.2f}" for a, t in sorted(spent.items()))
facts["peak memory (MiB)"] = str(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024)
print(json.dumps({"checks": out, "facts": facts}))
'''

KEPT = r'''
import glob, json
out = []
for f in glob.glob("/srv/app-packs/viewer/*.viewer.json"):
    try:
        d = json.load(open(f))
    except Exception:
        continue
    if str(d.get("read") or "").startswith("scheduling"):
        out.append({k: d.get(k) for k in ("read", "asked", "body", "wall")})
print(json.dumps(out))
'''


def live() -> None:
    print("the reads and doors, on real data (asa-hub-db-sync)")
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    nodes = top_nodes(text, ("_VIEWER_CACHE_PRIVATE_KEYS", "_viewer_cache_withhold"))
    withhold = "\n\n".join(ast.get_source_segment(text, nodes[n]) or "" for n in ("_VIEWER_CACHE_PRIVATE_KEYS",
                                                                                  "_viewer_cache_withhold"))
    withhold = ("from typing import Any\n_VIEWER_CACHE_PRIVATE_READS = frozenset({'schedulingBoard', 'schedulingStaffShifts', "
                "'schedulingTimeOffList', 'supportDeskList'})\n" + withhold)
    got = subprocess.run(["docker", "exec", RELAY, "python3", "-c", KEPT], capture_output=True, timeout=60)
    kept = json.loads(got.stdout.decode() or "[]") if got.returncode == 0 else []
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    app["redaction"] = (ROOT / "server" / "redaction.py").read_text(encoding="utf-8")
    blob = {"app": app, "kept": kept, "withhold": withhold}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=1500)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        check("the driver ran in asa-hub-db-sync", False, got.stderr.decode()[-1500:])
        return
    res = json.loads(lines[-1])
    for name, ok, detail in res["checks"]:
        check(name, ok, detail)
    for k, v in res["facts"].items():
        print(f"  fact {k}: {v}")


def main() -> int:
    files()
    relay()
    if "--static" not in sys.argv:
        live()
    print(f"{results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
