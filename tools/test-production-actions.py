#!/usr/bin/env python3
"""PRODUCTION ACTIONS on the relay's side, offline and on the host only: the reader, the door, the seed and the lists."""
from __future__ import annotations

import __future__
import ast
import asyncio
import importlib.util
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import time
import types
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SERVER = ROOT / "server"
DEF_SHA_PIN = "28cb56aee0241172"
BANNER = "Asa LifeCare Systems are Online, go there for this kind of request: https://asamylife.asalifecare.com/"

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:600]}")


if "psycopg2" not in sys.modules:  # pragma: no cover - the host has no driver
    fake = types.ModuleType("psycopg2")
    fake.connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no database in this test"))
    fake.Error = Exception
    extras = types.ModuleType("psycopg2.extras")
    extras.RealDictCursor = object
    fake.extras = extras
    sys.modules["psycopg2"] = fake
    sys.modules["psycopg2.extras"] = extras

TMP = Path(tempfile.mkdtemp(prefix="production-actions-test-"))
os.environ["HUB_SNAPSHOT_OUT"] = str(TMP / "snap")
sys.path.insert(0, str(SERVER))
import house_slices as hs  # noqa: E402
import master_json as mj  # noqa: E402
import production_actions as pa  # noqa: E402

NOW = datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc).timestamp()
FRESH = "2026-09-24T11:55:00Z"
DEFS_ID, RUNS_ID = "paDefsBook0000000000000", "paRunsBook0000000000000"


def write_master(root: Path, books: list[dict], written_at: str = "2026-09-24T11:58:00Z") -> None:
    (root / "books").mkdir(parents=True, exist_ok=True)
    manifest = {"format": mj.FORMAT, "round": "t", "written_at": written_at, "books": []}
    for b in books:
        tabs_index, tabs_manifest = [], []
        for tab, (header, rows) in b["tabs"].items():
            pf = mj.part_file(b["id"], tab, 0)
            (root / pf).write_text(json.dumps({
                "header": header,
                "rows": [[i + 2] + [r.get(h) for h in header] for i, r in enumerate(rows)]}))
            tabs_index.append({"tab": tab, "parts": [pf]})
            tabs_manifest.append({"tab": tab, "rows": len(rows), "read_at": b.get("read_at", FRESH),
                                  "stale": False, "parts": [{"part": 0, "file": pf}]})
        (root / mj.book_file(b["id"])).write_text(json.dumps(
            {"format": mj.FORMAT, "id": b["id"], "name": b["name"], "tabs": tabs_index}))
        manifest["books"].append({"id": b["id"], "name": b["name"], "file": mj.book_file(b["id"]),
                                  "modified_time": b.get("modified", "2026-09-24T11:00:00Z"),
                                  "owed": False, "status": "ok", "tabs": tabs_manifest})
    (root / "manifest.json").write_text(json.dumps(manifest))


def action(id_: str, number: str, phase: str, kind: str = "manual", handler: str = "", params: str = "",
           enabled: str = "yes") -> dict:
    return {"id": id_, "number": number, "phase": phase, "title": f"Action {id_}", "system": "S", "kind": kind,
            "handler": handler, "params": params, "how": "by hand" if kind == "manual" else "", "enabled": enabled}


DEFS = [
    action("rotate", "10", "after"),
    action("mm", "4", "at", "automatic", "banner", json.dumps({"book": "x" * 30, "gid": 1, "range": "G1:N1",
                                                               "text": BANNER})),
    action("broken", "4b", "at", "automatic", "banner", "{not json"),
    action("publish", "1", "before"),
    action("vm", "2", "before"),
    action("ten", "10", "at"),
    action("nine", "9", "at"),
    action("retired", "3", "before", enabled="no"),
    {"id": "pin_fixture", "number": "99", "phase": "at", "title": "Pin", "kind": "automatic", "handler": "link",
     "params": ' {"url":"https://asamylife.asalifecare.com/"} ', "enabled": "Yes "},
]
RUNS = [
    {"id": "PR-1", "createdAt": "2026-09-24T10:00:00Z", "action_id": "mm", "act": "rehearse", "result": "ok",
     "before": "", "after": "", "mock_row_id": "PR-1.mock"},
    {"id": "PR-2", "createdAt": "2026-09-24T11:00:00Z", "action_id": "mm", "act": "run", "result": "ok",
     "before": '{"backgrounds":["#ffffff"]}', "after": '{"handler":"banner"}'},
    {"id": "PR-3", "createdAt": "2026-09-24T11:30:00Z", "action_id": "vm", "act": "mark", "result": "ok",
     "before": "", "after": ""},
]
DEF_HEADER = pa.ACTIONS_HEADER
RUN_HEADER = pa.RUNS_HEADER
FACTS_HEADER = ["Context", "Subject ID", "Value", "Type", "Source"]


def facts(defs_ptr: str | None, runs_ptr: str | None) -> tuple[list[str], list[dict]]:
    rows = [{"Context": "x", "Subject ID": pa.ACTIONS_POINTER, "Value": "an-older-book"}]
    if defs_ptr:
        rows.append({"Context": "x", "Subject ID": pa.ACTIONS_POINTER, "Value": defs_ptr})
    if runs_ptr:
        rows.append({"Context": "x", "Subject ID": pa.RUNS_POINTER, "Value": runs_ptr})
    if not defs_ptr:
        rows = [r for r in rows if r["Subject ID"] != pa.ACTIONS_POINTER]
    return FACTS_HEADER, rows


def build(name: str, *, defs_ptr: str | None = DEFS_ID, runs_ptr: str | None = RUNS_ID, defs_book: bool = True,
          runs_book: bool = True, defs_modified: str = "2026-09-24T11:00:00Z", defs_read: str = FRESH,
          defs_tab: str = pa.ACTIONS_TAB) -> Path:
    root = TMP / name
    books = [{"id": hs.ESSENCIAL_ID, "name": "ASA — Essencial", "tabs": {"Facts": facts(defs_ptr, runs_ptr)}}]
    if defs_book:
        books.append({"id": DEFS_ID, "name": "ASA Data — ProductionActions", "modified": defs_modified,
                      "read_at": defs_read, "tabs": {defs_tab: (DEF_HEADER, DEFS)}})
    if runs_book:
        books.append({"id": RUNS_ID, "name": "ASA Data — ProductionActionRuns",
                      "tabs": {pa.RUNS_TAB: (RUN_HEADER, RUNS)}})
    write_master(root, books)
    pa.forget_pointers()
    return root


print("reader — the master JSON, both houses, never an empty runbook for an unread one")
FRESH_ROOT = build("fresh")
got = pa.view(FRESH_ROOT, NOW)
ids = [a["id"] for a in got.get("actions") or []]
check("the actions come ordered by phase, then by number read naturally",
      ids == ["publish", "vm", "retired", "mm", "broken", "nine", "ten", "pin_fixture", "rotate"], ids)
check("the newest pointer row in the Facts wins", got["house"]["actions"]["book"] == "ASA Data — ProductionActions",
      got["house"]["actions"])
check("both houses read fresh", got["house"]["actions"]["state"] == "fresh" and got["house"]["runs"]["state"] == "fresh",
      got["house"])
runs = got.get("runs") or []
check("the runs come newest first", [r["id"] for r in runs] == ["PR-3", "PR-2", "PR-1"], runs)
check("a run carries no before/after, only has_undo",
      all("before" not in r and "after" not in r for r in runs)
      and [r["has_undo"] for r in runs] == [False, True, False], runs)
by = {a["id"]: a for a in got["actions"]}
check("params are parsed, and bad JSON is said instead of guessed",
      by["mm"]["params_obj"]["range"] == "G1:N1" and by["broken"]["params_obj"] is None
      and by["broken"]["params_error"], by["broken"])
check("def_sha of the pinned fixture is the constant the self-test also asserts",
      by["pin_fixture"]["def_sha"] == DEF_SHA_PIN == pa.def_sha({"id": "pin_fixture", "kind": "automatic",
                                                                "handler": "link", "phase": "at", "enabled": "Yes ",
                                                                "params": ' {"url":"https://asamylife.asalifecare.com/"} '}),
      by["pin_fixture"]["def_sha"])
check("the enabled word folds: blank and Yes are yes, No and off are no",
      [pa.fold_enabled(v) for v in ("", "Yes ", "No", "off", "0")] == ["yes", "yes", "no", "no", "no"], None)

stale = pa.view(build("stale", defs_modified="2026-09-24T11:50:00Z", defs_read="2026-09-24T11:20:00Z"), NOW)
check("a sheet modified after its read is stale, with the reason, and its rows are still shown",
      stale["house"]["actions"]["state"] == "stale" and "changed at" in stale["house"]["actions"]["why"]
      and len(stale.get("actions") or []) == len(DEFS), stale["house"]["actions"])
pending = pa.view(build("pending", defs_book=False), NOW)
check("a pointer whose book the master JSON holds no copy of yet is `pending`, and `actions` is ABSENT, never []",
      pending["house"]["actions"]["state"] == "pending" and pending["house"]["actions"]["why"] == pa.NOT_COPIED
      and "actions" not in pending and len(pending.get("runs") or []) == 3, pending["house"]["actions"])
unread = pa.view(build("unreadable", defs_tab="Sheet1"), NOW)
check("a copied book without the runbook's tab is unreadable, with the reason, and `actions` is absent",
      unread["house"]["actions"]["state"] == "unreadable" and "has no tab" in unread["house"]["actions"]["why"]
      and "actions" not in unread, unread["house"]["actions"])
missing = pa.view(build("missing", defs_ptr=None), NOW)
check("no pointer is missing, in words a reader can act on, and `actions` is absent",
      missing["house"]["actions"]["state"] == "missing" and missing["house"]["actions"]["why"] == pa.NOT_SET_UP
      and "actions" not in missing and not re.search(r"\.py|tools/|mint", pa.NOT_SET_UP + pa.NOT_COPIED),
      missing["house"])
gone = pa.view(TMP / "nowhere", NOW)
check("no master JSON at all: both houses unreadable, no list at all",
      gone["house"]["actions"]["state"] == "unreadable" and "actions" not in gone and "runs" not in gone, gone)
cached = build("cached")
pa.pointers(hs.Master(cached, NOW))
(cached / mj.book_file(hs.ESSENCIAL_ID)).unlink()
check("the pointers are held for five minutes", pa.view(cached, NOW + 60)["house"]["actions"]["state"] == "fresh", None)

print("\ngate — the master alone, no admin floor")
check("(admin, True) opens", pa.master_verdict("admin", True) is True)
check("(admin, None), (admin, False), (manager, True), ('', True) and (admin, 'yes') stay shut",
      not any(pa.master_verdict(r, f) for r, f in [("admin", None), ("admin", False), ("manager", True),
                                                     ("", True), ("admin", "yes"), ("staff", True)]), None)

SVC = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
TREE = ast.parse(SVC)
# the door, and the one writer of the acting table its authMe answer passes through (Be Another)
DOOR_NAMES = {"_PA_REFUSED", "_production_actions_actor", "lane_production_actions", "_note_session_answer", "_iso"}
ROUTES: dict[str, Any] = {}
QUIET = logging.getLogger("production-actions-test")
QUIET.addHandler(logging.NullHandler())
QUIET.propagate = False


class FakeApp:
    def get(self, path: str):
        def deco(fn):
            ROUTES[path] = fn
            return fn
        return deco


def node_name(node: ast.AST) -> str:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return node.name
    if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
        return node.targets[0].id
    return type(node).__name__


def door(sessions: dict[str, tuple[str, str]], *, module: Any = pa, auth_me=None, python: Any = None) -> dict[str, Any]:
    """The door as the relay runs it; `python` set, the runbook is switched to Python and that is its answer (None:
    Python did not answer)."""
    ns: dict[str, Any] = {"asyncio": asyncio, "time": time, "Any": Any, "Response": object,
                          "Header": lambda default="": default, "app": FakeApp(),
                          "log": QUIET,
                          "master_json": types.SimpleNamespace(ROOT=FRESH_ROOT),
                          "_web_switch": lambda: {"on": False, "readable": True, "word": "off", "why": ""},
                          "_hotline_token": lambda a: a.replace("Bearer ", "", 1), "_auth_master": {},
                          "_acting": {}, "production_actions": module, "calls": [],
                          "PRODUCTION_ACTIONS_APP": "production-actions",
                          "_BACKEND_UNANSWERED": types.SimpleNamespace(get=lambda: "it deferred 503")}

    async def backend_wanted(app_id: str) -> bool:
        return python is not None and app_id == "production-actions"

    async def backend_call(app_id: str, action: str, payload: dict, user: dict, **kw):
        ns["calls"].append(f"python:{action}:{user.get('is_master')}")
        return None if python == "silent" else (b"", 0.0, dict(python), None, 0.0)

    ns["_backend_wanted"], ns["_backend_call"] = backend_wanted, backend_call

    async def session_actor(authorization: str):
        return sessions.get(authorization)

    async def relay_auth_me(token: str):
        ns["calls"].append("authMe")
        if auth_me is None:
            raise RuntimeError("authMe was not expected")
        return auth_me(token)

    ns["_session_actor"], ns["_auth_me"] = session_actor, relay_auth_me
    pa.forget_pointers()
    for node in TREE.body:
        if node_name(node) in DOOR_NAMES:
            exec(compile(ast.Module(body=[node], type_ignores=[]), "snapshot_service.py", "exec",
                         flags=__future__.annotations.compiler_flag, dont_inherit=True), ns)
    return ns


def ask(ns: dict[str, Any], authorization: str) -> tuple[dict[str, Any], dict[str, str]]:
    resp = types.SimpleNamespace(headers={})
    return asyncio.run(ns["lane_production_actions"](resp, authorization=authorization)), resp.headers


people = {"Bearer boss": ("admin", "u-boss"), "Bearer adm": ("admin", "u-a"), "Bearer sam": ("staff", "u-s"),
          "Bearer mia": ("manager", "u-m")}
is_master = {"boss": True, "adm": False}
ns = door(people, auth_me=lambda t: {"status": 200, "data": {"user": {"is_master": is_master.get(t, False)}}})
check("the relay serves the door at /hub-lanes/production-actions",
      set(DOOR_NAMES) <= {node_name(n) for n in TREE.body} and "/hub-lanes/production-actions" in ROUTES, ROUTES)
body, headers = ask(ns, "Bearer boss")
check("the master's session reads both houses, the relay's test-mode switch rides along, and nothing is cached",
      body.get("status") == 200 and [a["id"] for a in body["data"].get("actions") or []][:2] == ["publish", "vm"]
      and body["data"]["test_mode"]["word"] == "off" and headers.get("Cache-Control") == "no-store", body)
check("its flag is asked of authMe once and then held", ns["calls"] == ["authMe"] and ns["_auth_master"] == {"boss": True}
      and ask(ns, "Bearer boss")[0].get("status") == 200 and ns["calls"] == ["authMe"], ns["calls"])
shut = {who: ask(ns, who)[0] for who in ("Bearer sam", "Bearer mia", "Bearer adm", "Bearer nobody", "")}
check("staff, a manager, an admin who is not the master and no session all get 404 'Unknown lane.'",
      all(b == {"status": 404, "reason": "unknown", "message": "Unknown lane."} for b in shut.values()), shut)
check("authMe is spent only on admin sessions: staff, a manager and no session never reach it",
      ns["calls"] == ["authMe", "authMe"] and set(ns["_auth_master"]) == {"boss", "adm"}, ns["calls"])


def auth_me_down(token: str) -> dict:
    raise TimeoutError("Apps Script did not answer")


down = door(people, auth_me=auth_me_down)
answer = ask(down, "Bearer boss")[0]
check("an authMe that fails is a 503 the master can retry, never the not-the-master 404, and nothing is held",
      answer.get("status") == 503 and "master check could not be made" in answer.get("message", "")
      and down["_auth_master"] == {}, answer)
odd = door(people, auth_me=lambda t: {"status": 500, "message": "boom"})
check("an authMe that answers without the flag is a 503 as well",
      ask(odd, "Bearer boss")[0].get("status") == 503 and odd["_auth_master"] == {}, None)
gone_module = door(people, module=None)
check("a module that did not import answers the admin 503 and everyone else 404, and never opens",
      ask(gone_module, "Bearer boss")[0].get("status") == 503 and ask(gone_module, "Bearer sam")[0].get("status") == 404
      and gone_module["calls"] == [], None)
broken = types.SimpleNamespace(master_verdict=pa.master_verdict,
                               view=lambda root, now: (_ for _ in ()).throw(OSError("disk")))
broken_ns = door(people, module=broken, auth_me=lambda t: {"status": 200, "data": {"user": {"is_master": True}}})
check("a view that raises is a 503 that says the runbook could not be read",
      ask(broken_ns, "Bearer boss")[0] == {"status": 503, "reason": "unreadable",
                                           "message": "The runbook could not be read (OSError)."}, None)
master_me = {"status": 200, "data": {"user": {"is_master": True}}}
on_python = door(people, auth_me=lambda t: master_me,
                 python={"status": 200, "data": {"actions": [{"id": "pg"}], "runs": [], "house": {}}})
py_body = ask(on_python, "Bearer boss")[0]
check("switched to Python, the master's runbook is Python's view (asked as the master), the test-mode switch rides "
      "along, and the master JSON is not read",
      py_body.get("status") == 200 and [a["id"] for a in py_body["data"]["actions"]] == ["pg"]
      and py_body["data"]["test_mode"]["word"] == "off"
      and "python:productionActionsView:True" in on_python["calls"], py_body)
check("switched to Python, everyone but the master is still the 404 and Python is never asked",
      ask(on_python, "Bearer sam")[0].get("status") == 404
      and sum(c.startswith("python:") for c in on_python["calls"]) == 1, on_python["calls"])
py_silent = door(people, auth_me=lambda t: master_me, python="silent")
check("switched to Python and Python silent, the runbook says so (503) — never the master JSON's older copy",
      ask(py_silent, "Bearer boss")[0] == {"status": 503, "reason": "unavailable",
                                           "message": "The runbook could not be read just now. Try again in a moment."},
      None)

print("\nseed — the ten actions")
seed = json.loads((ROOT / "tools/production-actions-seed.json").read_text())["rows"]
check("ten rows, ids and numbers unique", len(seed) == 10 and len({r["id"] for r in seed}) == 10
      and len({r["number"] for r in seed}) == 10, [r["id"] for r in seed])
check("every phase is before, at or after", all(r["phase"] in pa.PHASES for r in seed), None)
auto = [r for r in seed if r["kind"] == "automatic"]
manual = [r for r in seed if r["kind"] == "manual"]
check("each automatic seed names a known handler with its params; each manual seed has no handler and says how",
      all(r["handler"] in pa.HANDLERS and isinstance(r["params"], dict) for r in auto)
      and all(not r["handler"] and r["how"].strip() for r in manual) and len(auto) == 2, None)
bannered = {r["id"]: r["params"] for r in auto if r["handler"] == "banner"}
check("the banner text is verbatim on both", all(p["text"] == BANNER for p in bannered.values()), bannered)
check("Master Messenger: G1:N1 on gid 1542343678 of its book",
      bannered["mm_banner"]["range"] == "G1:N1" and bannered["mm_banner"]["gid"] == 1542343678
      and bannered["mm_banner"]["book"] == "1N0TtcYzftx0ulCKfJFihpaYH9RXMc7F6dxwHR7N5IsM", bannered["mm_banner"])
check("Communication Log: F1:M1 on gid 1077596508, addressed by id",
      bannered["comm_log_banner"]["range"] == "F1:M1" and bannered["comm_log_banner"]["gid"] == 1077596508
      and bannered["comm_log_banner"]["book"] == "19jwo2BCtiyRRMK1PghCwgngUJplBdxMCCWGzuqz6IQU", bannered["comm_log_banner"])
text = json.dumps(seed)
check("no seed carries a deployment id or a key-shaped string",
      not re.search(r"AKfyc|\bsk-[A-Za-z0-9]|\b[0-9a-f]{32,}\b|(api[_-]?key|secret|token)\s*[:=]|Bearer\s", text, re.I), None)
shown = [r[k] for r in seed for k in ("title", "how", "requires", "effect")]
check("the words a card and the Preview show carry no code quotes, no file or variable names and no 'today'",
      not any(re.search(r"`|\.gs\b|\.py\b|HUB_[A-Z_]+|\btoday\b", w) for w in shown),
      [w for w in shown if re.search(r"`|\.gs\b|\.py\b|HUB_[A-Z_]+|\btoday\b", w)])
check("the cutover items are all there: the time-off form, its script, Master Messenger, Quo, Shift Board, the VM, "
      "the publish and the House Repair form",
      {"close_time_off_form", "stop_time_off_script", "retire_master_messenger", "rotate_quo_key",
       "uninstall_shift_board", "lock_down_vm", "publish_push", "house_repair_form"} <= {r["id"] for r in seed}
      and "1_Cep7YpimiJYklNVQX2moClJCy4wSvgUBZbarMo1URA" in text
      and "1FAIpQLSeq3zg4Bne4eKB0GY1C_aYBLR9Y3MwE9AuI5gQkmyORi2jlaw" in text, None)

print("\nmint — reaches no network on import, seeds only what is missing")
spec = importlib.util.spec_from_file_location("mint_pa", ROOT / "tools/mint_production_actions_houses.py")
mint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mint)
rows = mint.seed_rows("2026-09-24T00:00:00Z")
check("the seed becomes cell text in the header's columns, params as compact JSON",
      len(rows) == 10 and list(rows[0].keys()) == pa.ACTIONS_HEADER
      and json.loads(next(r for r in rows if r["id"] == "mm_banner")["params"])["gid"] == 1542343678
      and next(r for r in rows if r["id"] == "lock_down_vm")["params"] == "", rows[3])
check("a row already present is never written again",
      [r["id"] for r in mint.missing_seed(rows, {"publish_push", "mm_banner"})] ==
      [r["id"] for r in rows if r["id"] not in ("publish_push", "mm_banner")], None)
check("the seeded definitions validate on the relay side: the automatic ones parse",
      all(pa.action_out(r)["params_obj"] for r in rows if r["kind"] == "automatic"), None)

print("\nlists — one set of words across the runtimes, read from the loaded .gs")
LOAD_GS = (
    "const vm=require('vm'),fs=require('fs');const c={HUB_POLICY:{},HUB_ACTIONS:{}};vm.createContext(c);"
    "vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),c);"
    "console.log(JSON.stringify({handlers:c.PA_HANDLER_IDS,actions:c.PA_ACTIONS_HEADER,runs:c.PA_RUNS_HEADER,"
    "houses:[c.PA_ACTIONS_HOUSE,c.PA_RUNS_HOUSE],table:Object.keys(c.PA_HANDLERS),"
    "doors:Object.keys(c.HUB_ACTIONS).sort(),policies:Object.keys(c.HUB_POLICY).sort()}))"
)
loaded = subprocess.run(["node", "-e", LOAD_GS, str(ROOT / "apps-script/ProductionActions.gs")],
                        capture_output=True, text=True, timeout=60)
gsv = json.loads(loaded.stdout) if loaded.returncode == 0 else {}
check("ProductionActions.gs loads on its own", bool(gsv), loaded.stderr[:400])
check("the handler ids are the same list in the .gs table, the relay and the seed",
      gsv.get("handlers") == gsv.get("table") == list(pa.HANDLERS) and {r["handler"] for r in auto} <= set(pa.HANDLERS),
      [gsv.get("handlers"), gsv.get("table"), pa.HANDLERS])
check("the two headers are the same in the .gs, the relay and the mint",
      gsv.get("actions") == pa.ACTIONS_HEADER == mint.ACTIONS["header"]
      and gsv.get("runs") == pa.RUNS_HEADER == mint.RUNS["header"], None)
check("the house names and pointers agree with the mint",
      mint.ACTIONS["tab"] == pa.ACTIONS_TAB and mint.RUNS["tab"] == pa.RUNS_TAB
      and mint.ACTIONS["prop"] == pa.ACTIONS_POINTER and mint.RUNS["prop"] == pa.RUNS_POINTER
      and gsv.get("houses") == [pa.ACTIONS_TAB, pa.RUNS_TAB], gsv.get("houses"))
FIVE = ["productionActionMark", "productionActionPreview", "productionActionRun", "productionActionSave",
        "productionActionUndo"]
check("the .gs declares exactly its five doors, each with a policy",
      gsv.get("doors") == FIVE and gsv.get("policies") == FIVE, [gsv.get("doors"), gsv.get("policies")])
published = json.loads((ROOT / "public/resolver-manifest.json").read_text()).get("actions") or {}
five = {k: published.get(k) for k in FIVE}
check("the published resolver manifest routes the five doors: Preview a read, the four acts tools, none a quick write",
      all(five.values()) and five["productionActionPreview"]["lane"] == "read"
      and all(five[k]["lane"] == "tool" for k in FIVE if k != "productionActionPreview"),
      {k: (v or {}).get("lane") for k, v in five.items()})

print("\nnothing runs by itself, and nothing sends")
gs = (ROOT / "apps-script/ProductionActions.gs").read_text()
check("no door emits a message: the published manifest says emits [] for all five, and the .gs names no sender",
      all(five.values()) and all((v or {}).get("emits") == [] for v in five.values())
      and not re.search(r"\brpcCall_|\bMailApp\b|\bGmailApp\b|\bUrlFetchApp\b", gs), None)
check("ProductionActions.gs holds no trigger", "newTrigger" not in gs and "ScriptApp" not in gs, None)
py = (SERVER / "production_actions.py").read_text()
check("production_actions.py holds no loop, tick, thread or sleep",
      not re.search(r"while True|asyncio|threading\.Thread|sleep\(|create_task", py), None)


def mentions(node: ast.AST) -> bool:
    return any(isinstance(n, ast.Name) and n.id in ("production_actions", "_production_actions_actor")
               for n in ast.walk(node))


users = [node_name(n) for n in TREE.body if mentions(n)]
check("the relay names the lane only in its import, its actor and its door — no beat, no other caller",
      users == ["Try", "_production_actions_actor", "lane_production_actions"], users)
check("the page sets no timer for this lane",
      not re.search(r"setInterval|setTimeout", (ROOT / "src/pages/features/productionactions/useProductionActions.ts").read_text()
                    + (ROOT / "src/pages/features/productionactions/ProductionActionsPage.tsx").read_text()), None)

pkg = json.loads((ROOT / "package.json").read_text())
check("`npm run check` runs this file", "npm run test:production-actions" in pkg["scripts"]["check"]
      and pkg["scripts"].get("test:production-actions") == "python3 tools/test-production-actions.py", None)

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
