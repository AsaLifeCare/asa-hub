#!/usr/bin/env python3
"""The public doors (no session, a link's own token their gate) answered by asa-hub-app as nobody. The relay's half is
lifted out of its source and run against a scripted asa-hub-app: each app's doors reach that app's own doors alone,
whatever the switches say, and every fall-back is the door's own 503, never Apps Script — an envelope it cannot read,
a deferral, an older copy, a write taken back. asa-hub-app's half runs in asa-hub-db-sync: the public caller is refused
on a door that is not public, and on another app's public door. Nothing is written anywhere."""
from __future__ import annotations

import __future__
import ast
import asyncio
import base64
import hashlib
import json
import logging
import py_compile
import re
import subprocess
import sys
import time
import types
import urllib.parse
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
DB_RUNNER = "asa-hub-db-sync"
LIFTED = ("_relay_json_constant", "_relay_envelope", "_cert_papers_envelope", "_upload_action", "FORMS_PUBLIC_READS",
          "FORMS_PUBLIC_PREPARE", "FORMS_PUBLIC_ACTIONS", "FORMS_PUBLIC_CLAIM", "PUBLIC_CALLER", "FORMS_PUBLIC_CALLER",
          "PUBLIC_UNSAVED", "FORMS_PUBLIC_UNSAVED", "PUBLIC_UNREAD", "HIRING_PUBLIC_READS", "HIRING_PUBLIC_PREPARE",
          "HIRING_PUBLIC_WRITES", "HIRING_PUBLIC_ACTIONS", "_forms_public_claim", "_forms_public_after",
          "PUBLIC_DOORS_BY_APP", "_public_door_apps", "PUBLIC_DOOR_APPS", "PUBLIC_WHOLE_DOORS", "_public_door")

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: Any = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"ok   {name}")
    else:
        results["failed"].append(name)
        print(f"FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:600]}")


def _name(node: ast.AST) -> str:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return node.name
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        return node.targets[0].id
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return node.target.id
    return ""


class Response:
    def __init__(self, content: Any = b"", media_type: str = "", status_code: int = 200) -> None:
        self.body = content.encode() if isinstance(content, str) else content
        self.media_type, self.status_code = media_type, status_code


class Unanswered:
    def get(self) -> str:
        return "scripted"


def lift(source: str, names: tuple[str, ...]) -> dict[str, Any]:
    """The relay's own definitions, in its own order, over a namespace of scripted neighbours."""
    ns: dict[str, Any] = {"json": json, "re": re, "hashlib": hashlib, "time": time, "urllib": urllib, "Any": Any,
                          "Response": Response, "log": logging.getLogger("public-doors"), "FORMS_APP": "forms",
                          "HIRING_APP": "hiring", "BACKEND_PREPARE_TIMEOUT_S": 110.0, "APP_PACK_HEAD_BYTES": 4096,
                          "CERT_PAPERS_MAX_BODY": 32 * 1024 * 1024, "_BACKEND_UNANSWERED": Unanswered()}
    found = set()
    for node in ast.parse(source).body:
        if _name(node) in names:
            found.add(_name(node))
            code = compile(ast.Module(body=[node], type_ignores=[]), "snapshot_service.py", "exec",
                           flags=__future__.annotations.compiler_flag, dont_inherit=True)
            exec(code, ns)  # noqa: S102 - the relay's own source
    ns["__missing__"] = [n for n in names if n not in found]
    return ns


class Backend:
    """asa-hub-app as scripted: (app, door) → its answer, or None for a deferral; every call kept."""

    def __init__(self, ns: dict[str, Any], answers: dict[tuple[str, str], Any] | None = None, wanted: Any = True,
                 settle: bool = True, stale: tuple[bool, bool] = (False, False)) -> None:
        self.answers, self.wanted, self.settle_ok, self.stale = answers or {}, wanted, settle, stale
        self.trace: list[tuple] = []
        ns.update(_backend_wanted=self.backend_wanted, _backend_call=self.backend_call,
                  _backend_settle=self.backend_settle, _backend_written_after=self.written_after,
                  _backend_final=self.backend_final, _backend_key=lambda app_id, payload: "",
                  _traffic_note=lambda key: None, _keep_task=self.keep_task)

    async def backend_wanted(self, app_id: str) -> bool:
        self.trace.append(("wanted", app_id))
        if isinstance(self.wanted, Exception):
            raise self.wanted
        return self.wanted is True or (isinstance(self.wanted, set) and app_id in self.wanted)

    async def backend_call(self, app_id: str, action: str, payload: dict, user: dict, extra: dict | None = None,
                           timeout: float | None = None) -> Any:
        self.trace.append(("call", app_id, action, json.dumps(payload, sort_keys=True), json.dumps(user),
                           json.dumps(extra or {}, sort_keys=True), timeout))
        got = self.answers.get((app_id, action))
        return None if got is None else (b"", 1.0, json.loads(json.dumps(got)), None, 0.0)

    async def backend_settle(self, app_id: str, write_id: str, state: str) -> bool:
        self.trace.append(("settle", app_id, state))
        return self.settle_ok

    def written_after(self, app_id: str, key: str, as_of: float, held: Any = None, *, any_key: bool = False,
                      pack: str = "", edits_at: float = 0.0) -> bool:
        return self.stale[1] if any_key else self.stale[0]

    async def backend_final(self, app_id: str, action: str, raw: bytes, write_id: str, answer: dict, key: str,
                            as_of: float, held: Any, edits_at: float, replay: bool) -> Response:
        self.trace.append(("final", app_id, action, replay))
        return Response(json.dumps(answer), "application/json")

    def keep_task(self, coro: Any) -> None:
        self.trace.append(("task", coro.__qualname__))
        coro.close()


def form(action: str, payload: Any, **extra: Any) -> bytes:
    return urllib.parse.urlencode({"body": json.dumps({"action": action, "payload": payload, **extra})}).encode()


FINAL = {"_write": {"final": True, "house": ""}}
# (name, action, raw, answers, wanted, settle, stale) — every path the Forms door could take
FORMS_CASES: list[tuple[str, str, bytes, dict, Any, bool, tuple[bool, bool]]] = [
    ("switch off", "formPublicGet", form("formPublicGet", {"f": "x"}), {}, False, True, (False, False)),
    ("switch unreadable", "formPublicGet", form("formPublicGet", {}), {}, RuntimeError("down"), True, (False, False)),
    ("envelope unreadable", "formPublicGet", b"\xff\xfe not an envelope", {}, True, True, (False, False)),
    ("read deferred", "formPublicGet", form("formPublicGet", {"f": "x"}), {}, True, True, (False, False)),
    ("read answered", "formPublicGet", form("formPublicGet", {"f": "x"}),
     {("forms", "formPublicGet"): {"status": 200, "data": {"title": "T"}, "_write": {"x": 1}}}, True, True,
     (False, False)),
    ("read on an older copy", "formPublicGet", form("formPublicGet", {"f": "x"}),
     {("forms", "formPublicGet"): {"status": 200, "data": {}}}, True, True, (True, False)),
    ("upload session's long wait", "formPublicFileSession", form("formPublicFileSession", {"f": "x"}),
     {("forms", "formPublicFileSession"): {"status": 200, "data": {"url": "u"}}}, True, True, (False, False)),
    ("prepare deferred", "formPublicSubmit", form("formPublicSubmit", {"f": "x"}), {}, True, True, (False, False)),
    ("prepare refused", "formPublicSubmit", form("formPublicSubmit", {"f": "x"}),
     {("forms", "formPublicSubmitPrepare"): {"status": 429, "message": "Too many", "extra": 1}}, True, True,
     (False, False)),
    ("prepare refused on an older copy", "formPublicSubmit", form("formPublicSubmit", {"f": "x"}),
     {("forms", "formPublicSubmitPrepare"): {"status": 404, "message": "no"}}, True, True, (True, False)),
    ("write deferred, taken back", "formPublicSubmit", form("formPublicSubmit", {"f": "x", "base64": "zz"}),
     {("forms", "formPublicSubmitPrepare"): {"status": 200, "data": {"files": {}}}}, True, True, (False, False)),
    ("write deferred, not taken back", "formPublicSubmit", form("formPublicSubmit", {"f": "x"}),
     {("forms", "formPublicSubmitPrepare"): {"status": 200, "data": {}}}, True, False, (False, False)),
    ("write refused in its own words", "formPublicSubmit", form("formPublicSubmit", {"f": "x"}, write_id="Wgiven-123"),
     {("forms", "formPublicSubmitPrepare"): {"status": 200, "data": {}},
      ("forms", "formPublicSubmit"): {"status": 400, "message": "Still needed: Name."}}, True, True, (False, False)),
    ("write refused on an older copy", "formPublicSubmit", form("formPublicSubmit", {"f": "x"}),
     {("forms", "formPublicSubmitPrepare"): {"status": 200, "data": {}},
      ("forms", "formPublicSubmit"): {"status": 400, "message": "x"}}, True, True, (False, True)),
    ("a plan these doors never make", "formPublicSubmit", form("formPublicSubmit", {"f": "x"}),
     {("forms", "formPublicSubmitPrepare"): {"status": 200, "data": {}},
      ("forms", "formPublicSubmit"): {"status": 200, "_write": {"engine": True}}}, True, False, (False, False)),
    ("final on an older copy, taken back", "formPublicSubmit", form("formPublicSubmit", {"f": "x"}),
     {("forms", "formPublicSubmitPrepare"): {"status": 200, "data": {}},
      ("forms", "formPublicSubmit"): {"status": 200, **FINAL}}, True, True, (False, True)),
    ("final kept, its files claimed", "formPublicSubmit", form("formPublicSubmit", {"f": "x"}),
     {("forms", "formPublicSubmitPrepare"): {"status": 200, "data": {}},
      ("forms", "formPublicSubmit"): {"status": 200, "data": {"filed": True}, "_after": {"files": ["F1"]}, **FINAL}},
     True, True, (False, False)),
    ("a file stored whole, its bytes said kept", "formPublicFileStore",
     form("formPublicFileStore", {"f": "x", "base64": "A" * 150_000}),
     {("forms", "formPublicFileStorePrepare"): {"status": 200, "data": {"fid": "1"}},
      ("forms", "formPublicFileStore"): {"status": 200, "data": {"file_id": "1"}, **FINAL}}, True, True,
     (False, False)),
    ("a big envelope its door does not read whole", "formPublicSubmit",
     form("formPublicSubmit", {"f": "x", "base64": "A" * 150_000}), {}, True, True, (False, False)),
]
# the paths that once handed the door to Apps Script, and the 503 each now says in the door's words
UNREAD_CASES = ("switch off", "switch unreadable", "envelope unreadable", "read deferred", "read on an older copy")
UNSAVED_CASES = ("prepare deferred", "prepare refused on an older copy", "write deferred, taken back",
                 "write deferred, not taken back", "write refused on an older copy", "a plan these doors never make",
                 "final on an older copy, taken back", "a big envelope its door does not read whole")


def run(ns: dict[str, Any], fn: str, action: str, raw: bytes, answers: dict, wanted: Any, settle: bool,
        stale: tuple[bool, bool]) -> tuple[Any, list[tuple]]:
    be = Backend(ns, answers, wanted, settle, stale)
    res = asyncio.run(ns[fn](action, raw))
    said = None if res is None else json.loads(res.body)
    # a minted write id is the moment's: named, never compared
    trace = [tuple(re.sub(r'"write_id": "W[0-9a-f]{24}"', '"write_id": "<minted>"', x) if isinstance(x, str) else x
                   for x in t) for t in be.trace]
    return said, trace


def relay() -> None:
    ns = lift(SOURCE, LIFTED)
    check("the relay declares the public doors' registry and its one door", not ns["__missing__"], ns["__missing__"])
    if ns["__missing__"]:
        return
    apps, by_app = ns["PUBLIC_DOOR_APPS"], ns["PUBLIC_DOORS_BY_APP"]
    check("Forms keeps its names: its reads, its prepared writes, its claim, its caller and its 503",
          ns["FORMS_PUBLIC_ACTIONS"] == {"formPublicGet", "formPublicFileSession", "formPublicSubmit",
                                         "formPublicFileStore"}
          and ns["FORMS_PUBLIC_PREPARE"] == {"formPublicSubmit": "formPublicSubmitPrepare",
                                             "formPublicFileStore": "formPublicFileStorePrepare"}
          and ns["FORMS_PUBLIC_CLAIM"] == "formPublicFilesClaim" and ns["FORMS_PUBLIC_CALLER"] == {"public": True}
          and ns["FORMS_PUBLIC_UNSAVED"]["status"] == 503)
    check("each public door belongs to one app: Forms' to forms, the Hiring pages' to hiring",
          {a for a, app in apps.items() if app == "forms"} == ns["FORMS_PUBLIC_ACTIONS"]
          and {a for a, app in apps.items() if app == "hiring"} == ns["HIRING_PUBLIC_ACTIONS"]
          and ns["HIRING_PUBLIC_ACTIONS"] == {"interviewSlotContext", "candFormContext", "interviewSlotSubmit",
                                              "interviewSlotsSubmit", "interviewDaysSubmit", "candFormSubmit",
                                              "referralSubmit"}, apps)
    twice = {**by_app, "other": {**by_app["hiring"], "label": "other", "reads": {"formPublicGet": None},
                                 "writes": frozenset(), "prepare": {}, "whole": frozenset(), "kept": frozenset()}}
    declared = types.FunctionType(ns["_public_door_apps"].__code__, dict(ns, PUBLIC_DOORS_BY_APP=twice))
    try:
        declared()
        raised = ""
    except RuntimeError as exc:
        raised = str(exc)
    check("a door two apps declare is refused when the relay loads", "formPublicGet" in raised, raised)

    print("FORMS: every path answered by Python, or its 503 — never Apps Script")
    check("the public doors' 503s are the doors' own words", ns["PUBLIC_UNREAD"]["status"] == 503
          and ns["PUBLIC_UNSAVED"] == {"status": 503, "message": "That did not save — please try again in a moment."})
    for name, action, raw, answers, wanted, settle, stale in FORMS_CASES:
        said, trace = run(ns, "_public_door", action, raw, answers, wanted, settle, stale)
        calls = [t for t in trace if t[0] == "call"]
        ok = all(t[1] == "forms" for t in calls) and not any(t[0] == "wanted" for t in trace)
        if name in UNREAD_CASES:
            ok = ok and said == ns["PUBLIC_UNREAD"]
        if name in UNSAVED_CASES:
            ok = ok and said == ns["PUBLIC_UNSAVED"] and not any(t[0] == "final" for t in trace)
        if name in ("write deferred, taken back", "write refused on an older copy", "final on an older copy, taken back"):
            ok = ok and ("settle", "forms", "void") in trace
        if name in ("envelope unreadable", "a big envelope its door does not read whole"):
            ok = ok and not calls
        if name == "read answered":
            ok = ok and said == {"status": 200, "data": {"title": "T"}} and calls[0][6] is None
        if name == "upload session's long wait":
            ok = ok and calls[0][6] == 110.0
        if name == "prepare refused":
            ok = ok and said == {"status": 429, "message": "Too many"} and len(calls) == 1
        if name == "write deferred, taken back":
            body = json.loads(calls[1][3])
            ok = ok and ("settle", "forms", "void") in trace and "base64" not in body and body["prepared"] == {
                "files": {}}
        if name in ("write deferred, not taken back", "a plan these doors never make"):
            ok = ok and said == ns["FORMS_PUBLIC_UNSAVED"] and ("settle", "forms", "void") in trace
        if name == "write refused in its own words":
            ok = ok and said == {"status": 400, "message": "Still needed: Name."} and \
                json.loads(calls[1][5]) == {"write_id": "Wgiven-123"} and not any(t[0] == "settle" for t in trace)
        if name == "final kept, its files claimed":
            ok = ok and said == {"status": 200, "data": {"filed": True}} and \
                ("final", "forms", "formPublicSubmit", False) in trace and ("task", "_forms_public_claim") in trace
        if name == "a file stored whole, its bytes said kept":
            body = json.loads(calls[1][3])
            ok = ok and said == {"status": 200, "data": {"file_id": "1"}} and body["base64"] == "kept" and \
                not any(t[0] == "task" for t in trace)
        check(f"forms: {name}", ok, [said, trace])

    print("HIRING: its own doors, whatever the switches say")
    raw = form("interviewSlotContext", {"t": "ASK_X.y"})
    said, trace = run(ns, "_public_door", "interviewSlotContext", raw,
                      {("hiring", "interviewSlotContext"): {"status": 200, "data": {"mode": "pick"}}}, {"forms"}, True,
                      (False, False))
    check("hiring: a Hiring switch not on Python still asks hiring, never Apps Script",
          said == {"status": 200, "data": {"mode": "pick"}} and not any(t[0] == "wanted" for t in trace), trace)
    said, trace = run(ns, "_public_door", "interviewDaysSubmit", form("interviewDaysSubmit", {"t": "x"}), {}, True,
                      True, (False, False))
    check("hiring: a write Python did not answer is its 503, what it may have kept taken back",
          said == ns["PUBLIC_UNSAVED"] and ("settle", "hiring", "void") in trace, trace)
    said, trace = run(ns, "_public_door", "interviewSlotContext", raw,
                      {("hiring", "interviewSlotContext"): {"status": 200, "data": {"mode": "pick"}}}, {"hiring"},
                      True, (False, False))
    check("hiring: the interview page is asked of hiring as nobody", said == {"status": 200, "data": {"mode": "pick"}}
          and [t[1:3] for t in trace if t[0] == "call"] == [("hiring", "interviewSlotContext")]
          and json.loads(trace[-1][4]) == {"public": True}, trace)
    raw = form("interviewSlotSubmit", {"t": "ASK_X.y", "date": "2030-01-07", "time": "10:00"})
    said, trace = run(ns, "_public_door", "interviewSlotSubmit", raw,
                      {("hiring", "interviewSlotSubmit"): {"status": 200, "data": {"received": True}, **FINAL}}, True,
                      True, (False, False))
    calls = [t for t in trace if t[0] == "call"]
    check("hiring: the candidate's pick is one write, no prepare, its payload as sent",
          said == {"status": 200, "data": {"received": True}} and len(calls) == 1
          and json.loads(calls[0][3]) == {"t": "ASK_X.y", "date": "2030-01-07", "time": "10:00"}
          and ("final", "hiring", "interviewSlotSubmit", False) in trace, trace)
    raw = form("referralSubmit", {"name": "A B", "file_base64": "Q" * 150_000})
    said, trace = run(ns, "_public_door", "referralSubmit", raw,
                      {("hiring", "referralSubmitPrepare"): {"status": 200, "data": {"seal": "s"}},
                       ("hiring", "referralSubmit"): {"status": 200, "data": {"received": True}, **FINAL}}, True, True,
                      (False, False))
    calls = [t for t in trace if t[0] == "call"]
    body = json.loads(calls[-1][3]) if calls else {}
    check("hiring: a referral read whole, its résumé read first, its bytes not handed to the write",
          said == {"status": 200, "data": {"received": True}}
          and [c[2] for c in calls] == ["referralSubmitPrepare", "referralSubmit"] and calls[0][6] == 110.0
          and body.get("file_base64") == "kept" and body.get("prepared") == {"seal": "s"}, trace)
    said, trace = run(ns, "_public_door", "hiringWhere", form("hiringWhere", {}), {}, True, True, (False, False))
    check("a door no app declares public is never asked", said is None and not trace, trace)

    print("THE CALL SITE: one check for every registered door")
    relay_fn = next(n for n in ast.parse(SOURCE).body if isinstance(n, ast.AsyncFunctionDef) and n.name == "gas_relay")
    picked = next((n for n in ast.walk(relay_fn) if isinstance(n, ast.Assign) and _name(n) == "door"), None)
    gate = next((n for n in ast.walk(relay_fn) if isinstance(n, ast.If)
                 and ast.unparse(n.test) == "door in PUBLIC_DOOR_APPS"), None)
    check("gas_relay asks _public_door, and no Forms-only door", picked is not None and gate is not None
          and "_public_door(door, raw)" in ast.unparse(gate) and "_forms_public(" not in ast.unparse(relay_fn))
    if picked is not None and gate is not None:
        def chosen(action: str, raw: bytes) -> str:
            env = dict(ns, action=action, raw=raw)
            door = eval(compile(ast.Expression(picked.value), "t", "eval"), env)  # noqa: S307
            env["door"] = door
            return door if eval(compile(ast.Expression(gate.test), "t", "eval"), env) else ""  # noqa: S307
        big = b"body=" + urllib.parse.quote_plus(json.dumps({"action": "{}", "payload": {"x": "A" * 120_000}})).encode()
        cases = [("formPublicGet", form("formPublicGet", {}), "formPublicGet"),
                 ("interviewDaysSubmit", form("interviewDaysSubmit", {}), "interviewDaysSubmit"),
                 ("hiringWhere", form("hiringWhere", {}), ""),
                 ("", big.replace(b"%7B%7D", b"formPublicFileStore", 1), "formPublicFileStore"),
                 ("", big.replace(b"%7B%7D", b"referralSubmit", 1), "referralSubmit"),
                 ("", big.replace(b"%7B%7D", b"formPublicSubmit", 1), "formPublicSubmit"),
                 ("", b"body=%7B%7D", "")]
        got = [(a or "(big)", chosen(a, r), want) for a, r, want in cases]
        check("the call site takes every public door, by name or by its opening bytes (its door says 503 for what it "
              "does not read whole)", all(g == w for _a, g, w in got), got)


def main_side() -> int:
    driver = r'''
import asyncio, base64, importlib.abc, importlib.util, json, os, sys, tempfile, types
SRC = json.loads(base64.b64decode(sys.stdin.readline()).decode())
# the checkout's data files, where the app reads them beside its code
BESIDE = tempfile.mkdtemp(prefix="pd-app-")
for name, text in json.loads(base64.b64decode(sys.stdin.readline()).decode()).items():
    with open(os.path.join(BESIDE, name), "w", encoding="utf-8") as fh:
        fh.write(text)
os.environ["HUB_FRONT_DOOR_ROUTES"] = os.path.join(BESIDE, "front_door_routes.json")


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
import forms_public, forms_public_writes, hiring_public, hiring_public_writes
import main as M

out = []


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


class Door:
    """Every app's doors as one module: a public door of each app, and a door that is not public."""
    ACTIONS = {a: (lambda a: lambda sess, p: {"status": 200, "data": {"door": a, "public": sess.user.get("public")}})(a)
               for a in ("formPublicGet", "interviewSlotContext", "hiringWhere")}
    POLICY = {}


class Request:
    def __init__(self, user):
        self.headers = {"x-hub-token": "check", "x-hub-user": json.dumps(user)}

    async def body(self):
        return json.dumps({"payload": {}}).encode()


M.TOKEN = "check"
M.stores = lambda: {}
M.APPS.update({"forms": Door, "hiring": Door})


def ask(app_id, action, user):
    res = asyncio.run(M.act(app_id, action, Request(user)))
    body = json.loads(res.body) if isinstance(res.body, (bytes, str)) else res.body
    return res.status_code, body


PUBLIC = {"public": True}
check("PUBLIC_DOORS is every app's public doors together",
      M.PUBLIC_DOORS == forms_public.PUBLIC | forms_public_writes.PUBLIC | hiring_public.PUBLIC
      | hiring_public_writes.PUBLIC and set(M.PUBLIC_DOORS_BY_APP) == {"forms", "hiring"})
check("Forms' public doors are the ones it had",
      M.PUBLIC_DOORS_BY_APP["forms"] == {"formPublicGet", "formPublicFileSession", "formPublicSubmitPrepare",
                                         "formPublicFileStorePrepare", "formPublicSubmit", "formPublicFileStore"},
      sorted(M.PUBLIC_DOORS_BY_APP["forms"]))
check("the Hiring pages' public doors", M.PUBLIC_DOORS_BY_APP["hiring"] == {
    "interviewSlotContext", "candFormContext", "referralSubmitPrepare", "interviewSlotSubmit", "interviewSlotsSubmit",
    "interviewDaysSubmit", "candFormSubmit", "referralSubmit"}, sorted(M.PUBLIC_DOORS_BY_APP["hiring"]))
code, body = ask("forms", "formPublicGet", PUBLIC)
check("the public caller reaches Forms' own public door, as nobody", code == 200 and body["data"] == {
    "door": "formPublicGet", "public": True}, [code, body])
code, body = ask("hiring", "interviewSlotContext", PUBLIC)
check("the public caller reaches the Hiring page's own public door, as nobody", code == 200 and body["data"] == {
    "door": "interviewSlotContext", "public": True}, [code, body])
code, body = ask("hiring", "hiringWhere", PUBLIC)
check("the public caller is refused on a door that is not public", code == 403 and body == {
    "defer": "not a public door"}, [code, body])
code, body = ask("hiring", "formPublicGet", PUBLIC)
check("the public caller is refused on another app's public door (Forms' asked of hiring)", code == 403, [code, body])
code, body = ask("forms", "interviewSlotContext", PUBLIC)
check("the public caller is refused on another app's public door (Hiring's asked of forms)", code == 403, [code, body])
code, body = ask("hiring", "interviewSlotContext", {"public": True, "is_service": True})
check("a caller that says it is both nobody and the service is refused", code == 403, [code, body])
code, body = ask("hiring", "hiringWhere", {"is_service": True})
check("the service is not the public caller", code == 200 and body["data"]["public"] is None, [code, body])
print(json.dumps(out))
'''
    src = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    files = {p.name: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.json")}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", driver],
                         input=base64.b64encode(json.dumps(src).encode()) + b"\n"
                         + base64.b64encode(json.dumps(files).encode()) + b"\n", capture_output=True, timeout=600)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        check("asa-hub-app's half ran in asa-hub-db-sync", False, got.stderr.decode()[-2000:])
        return 1
    for name, ok, detail in json.loads(lines[-1]):
        check(name, ok, detail or None)
    return 0


def main() -> int:
    for path in ("app/main.py", "app/hiring_public.py", "app/hiring_public_writes.py", "app/forms_public.py",
                 "app/forms_public_writes.py", "server/snapshot_service.py"):
        py_compile.compile(str(ROOT / path), doraise=True)
    print("ok   main, the public doors' modules and the relay compile")
    print("THE RELAY")
    relay()
    if "--relay-only" not in sys.argv:
        print("ASA-HUB-APP")
        main_side()
    print(f"{results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
