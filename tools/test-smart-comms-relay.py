#!/usr/bin/env python3
"""Smart Comms on Settings › Back-end per app, at both ends. THE RELAY (its own source, lifted, no network): the app is
listed with its nine reads and its three final writes, Apps Script's until the switch is flipped; with the switch on, a
read is asked of Python and a read older than a Smart Comms write the relay saw land is left to Apps Script; the save
is kept by Python, and never handed to Apps Script, neither when Python does not answer nor when an answer would hand
it (503, nothing written); the reads keep no receipt; editionsMine names no Smart Comms edition while Apps Script answers; after each
Smart Comms write that landed 200 every stream hears 'smartcomms'. ASA-HUB-APP (app/main.py, streamed into
asa-hub-db-sync, every write in temporary tables inside one transaction rolled back): a door's raise is kept in its own
write's transaction and under its id, a write handed to Apps Script or laid for it voids what it raised, a deferred
write unwinds it, a voided write withdraws it, a committed write wakes the drain, and the lifespan's drain runs and
stops without sending. No socket is opened; nothing is printed but names, counts and states."""
from __future__ import annotations

import ast
import asyncio
import base64
import builtins
import hashlib
import json
import logging
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
TREE = ast.parse(SOURCE)
RUNNER = "asa-hub-db-sync"

READS = {"smartCommsGet", "smartCommsHistory", "optOutList", "commReplies", "commBoard", "openShiftCoveredBoard",
         "staffBroadcastBoard", "commProposalsList", "smartCommsPreview"}
WRITE = "smartCommsSet"
FINAL_WRITES = {WRITE, "commContributionVerdict", "commProposalsDecide"}
# the relay's own Smart Comms lanes on Python, each ringing its own name after its call
LANE_RINGS = ("commRecordSweep", "commProposalsIngest", "staffBroadcastCarry", "smartCommsRun", "commsInboundSweep")
WRITES = {"smartCommsSet", "smartCommsRun", "optOutSet", "commsInboundSweep", "inboundMarkSeen",
          "commContributionVerdict", "commRecordSweep", "openShiftCovered", "staffBroadcastSend",
          "staffBroadcastContinue", "staffBroadcastWithdraw", "staffBroadcastCarry", "commProposalsDecide",
          "commProposalsIngest"}

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


def segment(name: str) -> str:
    """One top-level definition or assignment, as written in the relay."""
    for node in TREE.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name == name:
            return ast.get_source_segment(SOURCE, node) or ""
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == name for t in node.targets):
            return ast.get_source_segment(SOURCE, node) or ""
        if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == name:
            return ast.get_source_segment(SOURCE, node) or ""
    return ""


class Names(dict):
    """A module's other names, each standing for itself, so one assignment can be lifted alone."""

    def __missing__(self, key):
        if key.startswith("__"):
            raise KeyError(key)
        if hasattr(builtins, key):
            return getattr(builtins, key)
        return f"<{key}>"


class Resp:
    def __init__(self, content=b"", media_type=None, status_code=200, headers=None):
        self.content = content.encode() if isinstance(content, str) else content
        self.status_code = status_code

    def json(self):
        return json.loads(self.content)


def run(coro):
    return asyncio.run(coro)


def form(env: dict) -> bytes:
    return urllib.parse.urlencode({"body": json.dumps(env)}).encode()


# ---- the names the relay's lines read, as they stand there ---------------------------------------------------------
rang: list[str] = []
settled: list[tuple] = []
called: list[tuple] = []
state = {"rows": {}, "settling": False, "master": True, "answer": None, "token": "tok"}
log = logging.getLogger("check")
log.addHandler(logging.NullHandler())
log.propagate = False


async def _backend_rows(fresh: bool = False):
    return dict(state["rows"])


async def _session_actor(_authorization):
    return ("admin", "U-check")


async def _app_pack_master(_authorization):
    return state["master"], ""


async def _backend_call(app_id, action, payload, user, extra=None, timeout=None):
    called.append((app_id, action, user, dict(extra or {})))
    return state["answer"]


async def _backend_settle(app_id, write_id, st, why="", fields=None):
    settled.append((app_id, write_id, st))
    return True


def _backend_settle_soon(app_id, write_id, st, why="", fields=None, house=""):
    settled.append((app_id, write_id, st))


async def _backend_engine_state():
    return {"reachable": True, "why": ""}


SPACE: dict = {"json": json, "re": re, "time": time, "hashlib": hashlib, "urllib": urllib, "asyncio": asyncio,
               "log": log, "Response": Resp, "Any": object, "_publish_slice": rang.append, "_app_pack_swept": {},
               "_app_pack_void": {}, "_app_pack_touched": {}, "_backend_final_at": {}, "_backend_own": {},
               "_APP_PACKS": {}, "_APP_PACK_HOUSE_RE": r"[A-Z]{2,4}\d{3,6}",
               "HUB_APP_URL": "http://asa-hub-app:8080", "HUB_APP_TIMEOUT_S": 10.0, "HUB_APP_BYTES_TIMEOUT_S": 20.0,
               "_backend_rows": _backend_rows, "_session_actor": _session_actor, "_app_pack_master": _app_pack_master,
               "_backend_engine_state": _backend_engine_state, "_backend_held": {"why": ""},
               "_backend_settling": lambda: state["settling"], "_traffic_note": lambda _n: None,
               "_backend_people_extra": lambda: {"people_at": 1.0} if state["settling"] else {},
               "_BACKEND_UNANSWERED": __import__("contextvars").ContextVar("backend_unanswered", default=""),
               "_backend_call": _backend_call, "_backend_settle": _backend_settle,
               "_backend_settle_soon": _backend_settle_soon, "_viewer_cache_written": lambda *a, **k: None,
               "_app_pack_apps_of": lambda *a: (), "_app_pack_ring": lambda *a, **k: None,
               "_app_pack_write_of": lambda *a: ("", None), "_app_pack_note_write": lambda *a: None,
               "_staff_profiles_rang": lambda *a: None, "_relay_observe_scheduling": lambda *a: None,
               "_relay_observe_support_desk": lambda *a: None, "_vehicle_calendar_rang": lambda *a: None}
LIFTED = ("SMART_COMMS_EVENT", "SMART_COMMS_WRITES", "_smart_comms_rang", "HOUSECAL_EVENT", "SCHEDULING_EVENT",
          "VEHICLE_CALENDAR_EVENT", "EMERGENCY_CONTACTS_EVENT", "STAFF_PROFILES_EVENT", "RELAY_NO_RECEIPT_ACTIONS",
          "RELAY_BYTE_READS", "BACKEND_OWN_SLACK_S", "BACKEND_FINAL_KEEP_S",
          "BACKEND_FINAL_UNWRITTEN", "BACKEND_UNREAD", "BACKEND_CHOICES", "_relay_json_constant", "_relay_envelope",
          "_relay_is_service", "_BackendAnswer", "_backend_said_unread", "_backend_key", "_backend_final_covers",
          "_GENERIC_VERBS", "BUILDER_DOORS", "_builder_payload", "_backend_place", "_backend_user",
          "_backend_copy_at",
          "_backend_written_after", "_backend_wanted", "_backend_answer", "_backend_unwritten",
          "_backend_final_landed", "_backend_final", "_backend_write", "_backend_view", "_BACKEND_EDITION_APPS",
          "_backend_editions_shut", "_backend_call")


def top_node(name: str) -> ast.AST | None:
    for node in TREE.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name == name:
            return node
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == name for t in node.targets):
            return node
        if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == name:
            return node
    return None


def stand_ins(space: dict, names: tuple[str, ...]) -> None:
    """Every name the lifted lines read that the check gives no value, stood in as tools/test-house-calendars.py
    stands them: the relay's own value where it is a plain literal (a door set, an app's id), an empty set for any
    other *_ACTIONS, an awaited no-op for what is awaited, a plain no-op for the rest."""
    free: set[str] = set()
    awaited: set[str] = set()
    for node in filter(None, (top_node(n) for n in names)):
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

    async def nothing(*_a, **_k):
        return None

    def plain(value: ast.AST | None) -> bool:
        names = [n for n in ast.walk(value) if isinstance(n, ast.Name)] if value is not None else []
        inner = {n.id for n in names if not isinstance(n.ctx, ast.Load)}
        return value is not None and all(n.id in dir(builtins) or n.id in inner for n in names)

    for name in sorted(free - set(space) - set(names) - set(dir(builtins))):
        node = top_node(name)
        value = getattr(node, "value", None) if isinstance(node, (ast.Assign, ast.AnnAssign)) else None
        if plain(value):
            space[name] = eval(compile(ast.Expression(value), name, "eval"), {})  # noqa: S307 - the relay's literal
        elif name.endswith("_ACTIONS"):
            space[name] = frozenset()
        else:
            space[name] = nothing if name in awaited else (lambda *_a, **_k: None)


for name in LIFTED:
    if name == "_backend_call":
        continue
    code = segment(name)
    if not code:
        check(f"the relay defines {name}", False)
        continue
    exec(code, SPACE)  # noqa: S102
# BACKEND_APPS with every other app's constants standing for themselves, then the tables read off it
apps_names = Names(SPACE)
exec(segment("BACKEND_APPS"), SPACE, apps_names)  # noqa: S102
SPACE["BACKEND_APPS"] = apps_names["BACKEND_APPS"]
for name in ("_BACKEND_ACTIONS", "_BACKEND_WRITES", "_BACKEND_FINAL"):
    exec(segment(name), SPACE)  # noqa: S102
# the names the lifted lines read since (IST_ROSTER_ACTIONS and the rest), never the check's own _backend_call
stand_ins(SPACE, tuple(n for n in LIFTED if n != "_backend_call"))
SPACE["HUB_APP_TOKEN"] = "check-token"


def reset() -> None:
    rang.clear()
    settled.clear()
    called.clear()
    for k in ("_app_pack_swept", "_app_pack_void", "_app_pack_touched", "_backend_final_at", "_backend_own"):
        SPACE[k].clear()
    state.update(rows={}, settling=False, master=True, answer=None)


def relay_part() -> None:
    spec = SPACE["BACKEND_APPS"].get("smart-comms") or {}
    print("\nthe switch: Settings › Back-end per app")
    check("Smart Comms is an app the switch lists, labelled as the screens name it",
          spec.get("label") == "Smart Comms", spec.get("label"))
    check("…its nine reads are the Desk's and its pages' reads",
          set(spec.get("reads") or ()) == READS, sorted(spec.get("reads") or ()))
    check("…its writes are the Desk's save, the Replies verdict and a proposal's decision, each final in Python, none "
          "a door may hand to Apps Script",
          set(spec.get("writes") or ()) == FINAL_WRITES == set(spec.get("final") or ()) and not spec.get("hands"),
          [sorted(spec.get("writes") or ()), sorted(spec.get("hands") or ())])
    check("…no lane, no key: a /gas read and write, the whole app marked under its event name",
          not spec.get("lane") and tuple(spec.get("keys", (1,))) == () and spec.get("pack") == "smartcomms"
          == SPACE["SMART_COMMS_EVENT"])
    check("each read routes to Smart Comms alone, and so does the save",
          all(SPACE["_BACKEND_ACTIONS"].get(a) == "smart-comms" for a in READS)
          and SPACE["_BACKEND_WRITES"].get(WRITE) == "smart-comms" and WRITE in SPACE["_BACKEND_FINAL"])
    others = {a for k, s in SPACE["BACKEND_APPS"].items() if k != "smart-comms"
              for a in set(s.get("reads", ())) | set(s.get("writes", ()))}
    check("…and no other app claims any of them", not (others & (READS | {WRITE})), sorted(others & (READS | {WRITE})))
    reset()
    view = run(SPACE["_backend_view"]())
    row = next((a for a in view["apps"] if a["id"] == "smart-comms"), None)
    check("the screen lists it on Python even while no switch row names it (none is written by any code here)",
          row is not None and row["backend"] == "python" and row["reads"] == sorted(READS)
          and row["writes"] == sorted(FINAL_WRITES) and row["final"] == sorted(FINAL_WRITES), row)
    check("…the switch row is written by the master's own door alone",
          SOURCE.count("_backend_store_set") == 2 and "asyncio.to_thread(_backend_store_set, app_id, backend, who)"
          in segment("lane_backends_set") and not re.search(r"hub_backend_switch[^\n]*smart-comms", SOURCE))
    wanted = SPACE["_backend_wanted"]
    check("no row: Python; there is no other engine", run(wanted("smart-comms")))
    state["rows"] = {"smart-comms": {"backend": "apps_script"}}
    check("…a stale row saying apps_script is Python's too", run(wanted("smart-comms")))
    SPACE["HUB_APP_TOKEN"] = ""
    check("…but never without the token the relay calls Python with", not run(wanted("smart-comms")))
    SPACE["HUB_APP_TOKEN"] = "check-token"

    print("\na read")
    answer = SPACE["_backend_answer"]
    as_of = time.time()
    good = (b'{"status":200,"data":{"situations":[]}}', as_of, {"status": 200}, frozenset(), as_of)
    raw = form({"action": "smartCommsGet", "token": "tok", "payload": {}})
    reset()
    state["answer"] = good
    got = run(answer("smartCommsGet", raw))
    check("no switch row: still Python's read, asked once", got is not None and got[0].content == good[0]
          and len(called) == 1)
    for action in sorted(READS):
        reset()
        state.update(rows={"smart-comms": {"backend": "python"}}, answer=good)
        got = run(answer(action, form({"action": action, "token": "tok", "payload": {}})))
        said = called[0][2] if called else {}
        if got is None or not called or called[0][:2] != ("smart-comms", action) \
                or {k: said.get(k) for k in ("uid", "role", "is_master")} != {"uid": "U-check", "role": "admin",
                                                                            "is_master": True} \
                or said.get("place") != {"tenant": "", "member": "", "world": "", "resource": ""}:
            check(f"the switch on: {action} is asked of Python with the session the relay verified", False, called)
            break
    else:
        check("the switch on: each of the eight reads is asked of Python with the session the relay verified, and "
              "Python's answer is the answer", got[0].content == good[0])
    # a visit, a world and a place are Python's to settle (app/envelope.py), carried in the signed word, never a payload
    for label, env, axis in (("a visit", {"member": "U-other"}, "member"), ("a world", {"world": "w"}, "world"),
                             ("a place away", {"tenant": "t"}, "tenant")):
        reset()
        state.update(rows={"smart-comms": {"backend": "python"}}, answer=good)
        got = run(answer("smartCommsGet", form({"action": "smartCommsGet", "token": "tok", "payload": {}, **env})))
        check(f"…{label} is asked of Python, the place in the relay's own word",
              got is not None and called and called[0][2].get("place", {}).get(axis) == env[axis])
    reset()
    state.update(rows={"smart-comms": {"backend": "python"}}, answer=good)
    got = run(answer("smartCommsGet", form({"action": "smartCommsGet", "token": "", "payload": {}})))
    check("…no session is Python's 401 (doPost's own), never Apps Script's, and nothing is asked",
          got is not None and json.loads(got[0].content) == {"status": 401, "message": "Authentication required."}
          and not called, got)
    reset()
    state.update(rows={"smart-comms": {"backend": "python"}}, answer=good)
    check("…so is the machine identity",
          run(answer("smartCommsGet", form({"action": "smartCommsGet", "service_secret": "x"}))) is None)
    reset()
    state.update(rows={"smart-comms": {"backend": "python"}}, answer=good, settling=True)
    got = run(answer("smartCommsGet", raw))
    check("…while App Control settles, a read is still Python's, asked with the change's moment (Python answers 503 "
          "from a copy older than it) — never Apps Script",
          got is not None and got[0].content == good[0] and called and called[0][3].get("people_at") == 1.0, called)
    reset()
    state.update(rows={"smart-comms": {"backend": "python"}})
    SPACE["_smart_comms_rang"]("optOutSet", b'{"status":200}')
    state["answer"] = (good[0], time.time() - 30, good[2], frozenset(), 0.0)
    got = run(answer("optOutList", form({"action": "optOutList", "token": "tok", "payload": {}})))
    check("a Smart Comms write that landed after Python's copy was read: Python's 503, never Apps Script",
          got is not None and json.loads(got[0].content) == SPACE["BACKEND_UNREAD"] and called, called)
    state["answer"] = (good[0], time.time() + 1, good[2], frozenset(), 0.0)
    got = run(answer("optOutList", form({"action": "optOutList", "token": "tok", "payload": {}})))
    check("…a copy read after it answers", got is not None and got[0].content == good[0])
    reset()
    state.update(rows={"smart-comms": {"backend": "python"}}, answer=None)
    SPACE["_BACKEND_UNANSWERED"].set("ConnectError")
    got = run(answer("smartCommsGet", raw))
    check("Python not had (the line dropped, a worker starting): the read is its 503, never Apps Script",
          got is not None and json.loads(got[0].content) == SPACE["BACKEND_UNREAD"], got)
    SPACE["_BACKEND_UNANSWERED"].set("")
    got = run(answer("smartCommsGet", raw))
    check("…and so is Python's own defer: its 503, never Apps Script",
          got is not None and json.loads(got[0].content) == SPACE["BACKEND_UNREAD"], got)

    print("\nthe Desk's save")
    write = SPACE["_backend_write"]
    wid = "Wcheck0000000001"
    raw = form({"action": WRITE, "token": "tok", "write_id": wid, "payload": {"rows": [{"id": "x", "enabled": "on"}]}})
    door = {"status": 200, "data": {"saved": 1, "unknown": [], "unaddressed": [], "bad_hours": [], "correction": {}}}
    reset()
    state.update(answer=(b"", time.time(), {**door, "_write": {"write_id": wid, "engine": False, "final": True,
                                                               "house": "situations", "cells": 1}},
                         frozenset(), time.time()))
    resp, _raw = run(write(WRITE, raw))
    body = resp.json() if resp is not None else {}
    check("no switch row: Python keeps the save in Postgres and its door's answer is the answer, its plan withheld",
          resp is not None and body == door and called and called[0][3] == {"write_id": wid}, body)
    check("…every stream hears 'smartcomms', once", rang == ["smartcomms"], rang)
    check("…and Python's copy is marked current for the whole app at once",
          ("smartcomms", "") in SPACE["_backend_final_at"] and "smartcomms" in SPACE["_app_pack_swept"])
    reset()
    state.update(rows={"smart-comms": {"backend": "python"}}, answer=None)
    resp, _raw = run(write(WRITE, raw))
    check("Python not answering: 503, nothing written, never handed to Apps Script, and Python told to take it back",
          resp is not None and resp.json() == {"status": 503, "message": SPACE["BACKEND_FINAL_UNWRITTEN"]}
          and ("smart-comms", wid, "void") in settled and not rang, (resp and resp.json(), settled))
    reset()
    state.update(rows={"smart-comms": {"backend": "python"}},
                 answer=(b"", time.time(), {"status": 200, "_write": {"write_id": wid, "engine": True, "settle": False,
                                                                      "house": ""}}, frozenset(), time.time()))
    resp, _raw = run(write(WRITE, raw))
    check("an answer that would hand it to Apps Script (no Smart Comms door hands any more) is never carried: 503, "
          "nothing written, Python told to take it back",
          resp is not None and resp.json() == {"status": 503, "message": SPACE["BACKEND_FINAL_UNWRITTEN"]}
          and ("smart-comms", wid, "void") in settled and not rang, (resp and resp.json(), settled))
    reset()
    refusal = {"status": 400, "message": "Cannot save: unknown situation id(s): x.", "data": {"saved": 0}}
    state.update(rows={"smart-comms": {"backend": "python"}},
                 answer=(b"", time.time(), dict(refusal), frozenset(), time.time()))
    resp = run(write(WRITE, raw))[0]
    check("the door refuses: its own words, nothing rung", resp is not None and resp.json() == refusal and not rang)
    reset()
    busy = {"status": 503, "message": "Somebody else is saving on the platform right now — nothing was written. Try "
                                      "again in a moment."}
    state.update(rows={"smart-comms": {"backend": "python"}}, answer=(b"", time.time(), dict(busy), frozenset(), 0.0))
    resp = run(write(WRITE, raw))[0]
    check("another write holds the lock: the door's 503, never a 409 the Desk would read as landed",
          resp is not None and resp.json() == busy)
    reset()
    state.update(rows={"smart-comms": {"backend": "python"}})
    SPACE["_smart_comms_rang"]("staffBroadcastSend", b'{"status":200}')
    state["answer"] = (b"", time.time() - 60, {**door, "_write": {"write_id": wid, "engine": False, "final": True,
                                                                   "house": "situations", "cells": 1}},
                       frozenset(), time.time() - 60)
    rang.clear()
    resp = run(write(WRITE, raw))[0]
    check("decided on a copy older than a Smart Comms write the relay saw land: taken back, said, nothing written",
          resp is not None and resp.json()["status"] == 409 and "Nothing was written" in resp.json()["message"]
          and ("smart-comms", wid, "void") in settled and not rang, resp and resp.json())
    reset()
    state.update(rows={"smart-comms": {"backend": "python"}},
                 answer=(b"", time.time(), {"status": 200, "_write": {"write_id": wid, "engine": False, "house": "X",
                                                                      "lay": {"house": "X"}}}, frozenset(), 0.0))
    resp = run(write(WRITE, raw))[0]
    check("a final door answering a sheet write is never carried: 503 and taken back",
          resp is not None and resp.json()["status"] == 503 and ("smart-comms", wid, "void") in settled)
    reset()
    state.update(rows={"smart-comms": {"backend": "python"}},
                 answer=(b"", time.time(), {**door, "_write": {"write_id": wid, "final": True, "replay": True}},
                         frozenset(), time.time()))
    resp = run(write(WRITE, raw))[0]
    check("a replay answers what it answered, and rings nothing again", resp is not None and resp.json() == door
          and not rang)
    reset()
    state.update(rows={"smart-comms": {"backend": "python"}}, answer=good)
    run(write(WRITE, form({"action": WRITE, "token": "tok", "write_id": wid, "payload": {"rows": []},
                           "member": "U-other"})))
    check("…a visit is asked of Python, the visit in the relay's own word",
          bool(called) and called[0][2].get("place", {}).get("member") == "U-other")
    reset()
    state.update(rows={"smart-comms": {"backend": "python"}}, answer=good)
    resp = run(write(WRITE, form({"action": WRITE, "token": "tok", "write_id": wid, "payload": None})))[0]
    check("…no payload: 503, never handed", resp is not None and resp.json()["status"] == 503 and not called)

    print("\nthe reads keep no receipt")
    literal = re.search(r"^RELAY_NO_RECEIPT_ACTIONS = frozenset\(\{(.*?)\}\)", SOURCE, re.M | re.S)
    named = set(re.findall(r'"([A-Za-z]+)"', literal.group(1))) if literal else set()
    check("each of the eight reads is a read no receipt is kept of: a retry reads again, a slow answer never "
          "becomes a receipt that empties the screen", READS <= named and READS <= set(SPACE["RELAY_NO_RECEIPT_ACTIONS"]),
          sorted(READS - named))
    check("…none of them rides the files' long lane", not (READS & set(SPACE["RELAY_BYTE_READS"])))
    check("…while the save keeps its receipt: a write id stamped where it came without one, so a re-send lands once",
          WRITE not in named and 'write_id = "W" + hashlib.sha256(' in segment("_backend_write"))
    gas = segment("gas_relay")
    check("…and the relay stamps nothing on a read any more: no receipt is kept anywhere of one",
          "RELAY_NO_RECEIPT_ACTIONS" not in gas and "write_id" not in gas)

    print("\nthe editions")
    shut = SPACE["_backend_editions_shut"]
    check("Smart Comms' editions are Python's doors' alone", SPACE["_BACKEND_EDITION_APPS"].get("smart-comms")
          == "smart-comms")
    mine = form({"action": "editionsMine", "token": "tok", "payload": {"app": "smart-comms"}})
    reset()
    check("…Python says which", run(shut(mine)) is None)
    SPACE["HUB_APP_TOKEN"] = ""
    check("…and a relay that cannot ask Python offers none, the master's too",
          run(shut(mine)) == {"status": 200, "data": {"editions": []}})
    SPACE["HUB_APP_TOKEN"] = "check-token"

    async def broken(_app):
        raise RuntimeError("the switch could not be read")

    held = SPACE["_backend_wanted"]
    SPACE["_backend_wanted"] = broken
    check("…and a switch that cannot be read offers none", run(shut(mine)) == {"status": 200, "data": {"editions": []}})
    SPACE["_backend_wanted"] = held

    print("\nthe live event")
    ring = SPACE["_smart_comms_rang"]
    check("the name is the Desk's own ('smartcomms'), a bare name every stream hears, and the writes are Smart Comms' "
          "own", SPACE["SMART_COMMS_EVENT"] == "smartcomms" and set(SPACE["SMART_COMMS_WRITES"]) == WRITES
          and not SPACE["SMART_COMMS_EVENT"].startswith("hotline:"), sorted(SPACE["SMART_COMMS_WRITES"]))
    for action in sorted(WRITES):
        reset()
        ring(action, b'{"status":200,"data":{"saved":1}}')
        if rang != ["smartcomms"] or "smartcomms" not in SPACE["_app_pack_swept"]:
            check(f"{action} answered 200 rings the name once and marks the app's copy behind", False, rang)
            break
    else:
        check("each Smart Comms write answered 200 rings the name once and marks Python's copy behind it", True)
    quiet = [(WRITE, b'{"status":400,"message":"Cannot save"}'), (WRITE, b'{"status":"200"}'), (WRITE, b"[]"),
             (WRITE, b""), (WRITE, None), (WRITE, b"\xff\xfe"), ("smartCommsGet", b'{"status":200}'),
             ("vehicleCalendarTripSave", b'{"status":200}'), ("", b'{"status":200}'), (None, b'{"status":200}')]
    reset()
    raised = []
    for action, content in quiet:
        try:
            ring(action, content)
        except Exception as exc:  # noqa: BLE001
            raised.append((action, type(exc).__name__))
    check("a refusal, a status that is not the number 200, garbage, a read and another app's write ring nothing, "
          "and none raises", rang == [] and not raised and not SPACE["_app_pack_swept"], (rang, raised))

    def boom(_name):
        raise RuntimeError("the streams are gone")

    reset()
    SPACE["_publish_slice"] = boom
    try:
        ring(WRITE, b'{"status":200}')
        swallowed = True
    except Exception:  # noqa: BLE001
        swallowed = False
    SPACE["_publish_slice"] = rang.append
    check("a publish that throws is swallowed, and the copy is still marked behind",
          swallowed and "smartcomms" in SPACE["_app_pack_swept"])
    check("rung on the answer gas_relay hands back, beside Transportation's ring and with that very answer",
          len(re.findall(r"_vehicle_calendar_rang\(action, (\w+)\.content\)\n\s*_staff_profiles_rang"
                         r"\(action, \1\.content\)\n\s*_smart_comms_rang\(action, \1\.content\)", gas))
          == 1 == gas.count("_smart_comms_rang("))
    check("…on a save Python kept final", "_smart_comms_rang(action, content)" in segment("_backend_final_landed"))
    check("…on each of the relay's own Smart Comms lanes on Python, under its own name",
          all(f'_smart_comms_rang("{a}"' in SOURCE for a in LANE_RINGS), LANE_RINGS)
    check("…and nowhere else", SOURCE.count("_smart_comms_rang(") == 1 + 1 + 1 + len(LANE_RINGS),
          SOURCE.count("_smart_comms_rang("))
    check("Transportation's ring stays where it was", SOURCE.count("_vehicle_calendar_rang(") == 1 + 1 + 1)


DRIVER = r'''
import asyncio, base64, importlib.abc, importlib.util, json, os, socket, sys, time, types
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = blob["app"]
# the checkout's data files, where the app reads them beside its code
import tempfile
BESIDE = tempfile.mkdtemp(prefix="scr-app-")
for name, text in (blob.get("files") or {}).items():
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


sys.path[:] = [p for p in sys.path if p not in ("", os.getcwd())]
sys.meta_path.insert(0, Checkout())
os.environ.pop("HUB_SMART_COMMS_KEY_FILE", None)
os.environ.pop("HUB_DB_WRITE_DSN", None)


class App:
    def __init__(self, **_kw):
        pass

    def _route(self, *_a, **_kw):
        return lambda fn: fn
    get = post = _route


class Resp:
    def __init__(self, content=None, status_code=200, headers=None, media_type=None):
        self.body, self.status_code = content, status_code

    def env(self):
        return self.body if isinstance(self.body, dict) else json.loads(self.body)


async def in_thread(fn, *a, **kw):
    return fn(*a, **kw)


fake = types.ModuleType("fastapi")
fake.FastAPI, fake.Request = App, object
responses = types.ModuleType("fastapi.responses")
responses.JSONResponse = responses.Response = Resp
conc = types.ModuleType("starlette.concurrency")
conc.run_in_threadpool = in_thread
sys.modules.update({"fastapi": fake, "fastapi.responses": responses, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": conc})
from psycopg.conninfo import make_conninfo
import psycopg
OWNER = dict(host=os.environ.get("HUB_DB_HOST", "asa-hub-db"), dbname=os.environ["POSTGRES_DB"],
             user=os.environ["POSTGRES_USER"], password=os.environ["POSTGRES_PASSWORD"])
os.environ["HUB_DB_DSN"] = make_conninfo(**OWNER, options="-c default_transaction_read_only=on")
import gsjs, hubdb, scope as sc, writes as W
import main as M
import smart_comms as SC
import smart_comms_desk, smart_comms_writes
checks, facts = [], {}


def check(name, ok, detail=""):
    checks.append((name, bool(ok), str(detail)[:400]))


NY = ZoneInfo("America/New_York")
# a night two days ahead: whatever it owes falls due in the future, so no drain here finds it due
NIGHT = datetime.combine(datetime.now(NY).date() + timedelta(days=2), datetime.min.time(), NY).replace(hour=22)
NIGHT = NIGHT.timestamp()
FAKE_TO = "+15550100000"

check("asa-hub-app registers Smart Comms' reads and its save under one app id",
      M.APPS.get("smart-comms") is smart_comms_desk and M.WRITES.get("smart-comms") is smart_comms_writes)
check("…its write store is Smart Comms' own (app.smart_comms_writes / _receipts)",
      M.stores().get("smart-comms") is M.SMART_COMMS_STORE and M.SMART_COMMS_STORE.kind == "smart_comms")
facts["python reads"] = sorted(smart_comms_desk.ACTIONS)
facts["python writes"] = sorted(smart_comms_writes.ACTIONS)
check("…the save is a write there, never a read, and the policy gate lets the door decide who saves",
      "smartCommsSet" in smart_comms_writes.ACTIONS and "smartCommsSet" not in smart_comms_desk.ACTIONS
      and M.policy_gate(smart_comms_writes, "smartCommsSet", {}, {"role": "staff", "is_service": False}) is None)
h = M.healthz()
check("/healthz says the store and the outbox, and answers with no writer configured",
      h.get("ok") is True and "smart_comms_writes" in h and h.get("smart_comms_outbox") == {"ready": False}, h.get("why"))

# the outbox, the edits and both locks the check's own
SC.OUTBOX, SC.ARM = "pg_temp.scr_outbox", "pg_temp.scr_arm"
W.EDITS_TABLE = "pg_temp.scr_edits"
W.LOCK_KEY = 0x5343524C4B31
SC.DRAIN_LOCK = 0x5343524C4B32
M.DB.catalog()
real = psycopg.connect(make_conninfo(**OWNER), autocommit=False, connect_timeout=5,
                       application_name="smart-comms-relay-check")
SENT = []
SC.TRANSPORT = lambda *a, **k: SENT.append(1) or {"ok": False, "sent": False, "error": "check"}

OPENED = []
_orig = (socket.socket.connect, socket.socket.connect_ex, socket.create_connection)


def refuse(*_a, **_k):
    OPENED.append(1)
    raise OSError("this check opens no socket")


socket.socket.connect = socket.socket.connect_ex = refuse
socket.create_connection = refuse


class CheckTx(W.Tx):
    def receipt(self, write_id):
        self.cur.execute("select answer from pg_temp.scr_receipts where write_id = %s", (write_id,))
        got = self.cur.fetchone()
        return (got[0] if isinstance(got[0], dict) else json.loads(got[0])) if got else None

    def live(self):
        return []

    def record(self, write_id, action, env, decision, author):
        self.cur.execute("insert into pg_temp.scr_receipts (write_id, answer) values (%s, %s::jsonb)"
                         " on conflict (write_id) do nothing", (write_id, json.dumps(env)))


class CheckStore(W.Store):
    """A write store whose receipts are a temporary table, inside the check's one transaction."""
    def __init__(self):
        super().__init__(connect=lambda: real, kind="scrcheck", label="check")
        self._ready = True

    def ensure(self):
        return ""

    def ready(self):
        return True

    def locked(self):
        import contextlib

        @contextlib.contextmanager
        def held():
            with real.transaction():
                cur = real.cursor()
                cur.execute("select pg_advisory_xact_lock(%s)", (W.LOCK_KEY,))
                yield CheckTx(cur, self.kind)
        return held()

    def live(self):
        return []

    def edits(self):
        return []

    def finish(self, done):
        return None

    def settle(self, write_id, state, why="", fields=None):
        if state == "void":
            real.execute("delete from pg_temp.scr_receipts where write_id = %s", (write_id,))
        return True


STORE = CheckStore()
SEEN = []
SID = ""


def door(sess, payload):
    mode = payload.get("mode")
    if mode != "plain":
        SEEN.append(SC.raise_situation(None, situation=SID, to=FAKE_TO, vars={}, key="scr-check|" + payload["n"],
                                       lane="check", at_ms=NIGHT * 1000, now=NIGHT))
    if mode == "engine":
        return W.Decision(None, engine=True)
    if mode == "lay":
        return W.Decision(None, lay={"house": "CHK001"})
    if mode == "defer":
        raise sc.Defer("the check defers after raising")
    return W.Decision({"status": 200, "data": {"ok": True}})


DOORS = types.SimpleNamespace(ACTIONS={"scCheck": door}, POLICY={"scCheck": {"roles": ()}})
SERVICE = {"is_service": True}


def write(mode, wid, n=""):
    return M._run_write(DOORS, "scCheck", SERVICE, {"mode": mode, "n": n or wid}, wid)


def rows(wid):
    return [(r["state"], r["held_by"], r["door"], r["lane"]) for r in SC.outbox_for(real, write_id=wid)]


class Req:
    def __init__(self, body):
        self.headers = {"x-hub-token": "check-token"}
        self._body = json.dumps(body).encode()

    async def body(self):
        return self._body


def scenarios():
    global SID
    real.execute("create temp table scr_receipts (write_id text primary key, answer jsonb not null)")
    check("the outbox is made by the module's own ensure()", SC.ensure(real) == "")
    sits = SC.read_situations(M.DB)
    ok = [s for s in sits if SC.smart_on(s.get("enabled")) and "sms" in SC.smart_list(s.get("channels"))
          and gsjs.str_(s.get("sms_text")) and not SC.unwritten_words(M.DB, s, "sms_text")]
    pick = next((s for s in ok if s.get("id") == "transport_request_ask"), ok[0] if ok else None)
    SID = gsjs.str_((pick or {}).get("id"))
    facts["live situation raised"] = SID or "(none on with SMS words)"
    check("a live situation is on with SMS words to raise", bool(SID))
    M.WRITES["sc-check"] = DOORS
    M.stores = lambda: {"sc-check": STORE}
    M.TOKEN = "check-token"
    M.SMART_COMMS_READY[0] = True

    SC._KICK.clear()
    r = write("final", "Wscrcheck-final-1")
    env = r.env()
    check("a door raising inside its write: answered 200, the raise said held by the window on the caller's clock",
          r.status_code == 200 and env.get("status") == 200 and SEEN and SEEN[-1]["state"] == "held"
          and SEEN[-1]["held"] == "quiet", (r.status_code, SEEN[-1] if SEEN else None))
    check("…the text owed in the outbox, under that write's id and door, in that write's transaction",
          rows("Wscrcheck-final-1") == [("owed", "quiet", "scCheck", "check")], rows("Wscrcheck-final-1"))
    check("…and the drain is woken", SC._KICK.is_set())

    write("engine", "Wscrcheck-engine-1")
    check("a door raising and then handing its write to Apps Script: what it raised is void (Apps Script speaks)",
          rows("Wscrcheck-engine-1") == [("void", "quiet", "scCheck", "check")], rows("Wscrcheck-engine-1"))
    write("lay", "Wscrcheck-lay-1")
    check("…and so is one that lays a write for Apps Script to deliver",
          rows("Wscrcheck-lay-1") == [("void", "quiet", "scCheck", "check")], rows("Wscrcheck-lay-1"))
    r = write("defer", "Wscrcheck-defer-1")
    check("a door that defers after raising: Apps Script answers, and nothing it raised is kept",
          r.status_code == 503 and rows("Wscrcheck-defer-1") == [], (r.status_code, rows("Wscrcheck-defer-1")))

    SC._KICK.clear()
    write("plain", "Wscrcheck-plain-1")
    check("a write that raised nothing still wakes the drain once it commits", SC._KICK.is_set())
    SC._KICK.clear()
    write("plain", "Wscrcheck-plain-1")
    check("…its replay does not", not SC._KICK.is_set())
    got = SC.raise_situation(None, situation=SID, to=FAKE_TO, vars={}, key="scr-check|outside", lane="check",
                             at_ms=NIGHT * 1000, now=NIGHT)
    check("a raise outside any write keeps nothing", got["state"] == "failed"
          and not SC.outbox_for(real, "scr-check|outside"), got)

    write("final", "Wscrcheck-final-2")
    asyncio.run(M.settle("sc-check", Req({"write_id": "Wscrcheck-final-2", "state": "queued"})))
    check("a write the relay queued keeps what it owes", [s[0] for s in rows("Wscrcheck-final-2")] == ["owed"])
    res = asyncio.run(M.settle("sc-check", Req({"write_id": "Wscrcheck-final-2", "state": "void"})))
    check("a write the relay voided withdraws what it owed", res.status_code == 200
          and [s[0] for s in rows("Wscrcheck-final-2")] == ["void"], rows("Wscrcheck-final-2"))

    M.SMART_COMMS_STORE = STORE
    h = M.healthz()
    out = h.get("smart_comms_outbox") or {}
    check("/healthz counts the outbox by state once it is ready, and says the arm is off",
          out.get("ready") is True and out.get("states", {}).get("owed") == 1 and out.get("armed") is False, out)

    calls = []
    orig = SC.drain

    def counted(conn, *a, **kw):
        got = orig(conn, *a, **kw)
        calls.append(got)
        return got

    SC.drain = counted
    M.SMART_COMMS_READY[0] = False

    async def life():
        async with M.lifespan(None):
            await asyncio.sleep(0.6)
            first = len(calls)
            SC.kick()
            await asyncio.sleep(0.6)
            return first, len(calls)

    try:
        first, second = asyncio.run(life())
    finally:
        SC.drain = orig
    check("the lifespan makes the outbox and starts the drain, which looks at once",
          M.SMART_COMMS_READY[0] and first >= 1 and all(c.get("ran") for c in calls), (first, calls[:2]))
    check("…a kick makes it look again", second > first, (first, second))
    check("…it found nothing due and sent nothing; the app's stop ends it",
          all(not c.get("done") for c in calls) and not SENT, calls[:3])
    check("the text still owed is untouched by the drain", [s[0] for s in rows("Wscrcheck-final-1")] == ["owed"])


try:
    with real.transaction():
        try:
            scenarios()
        except Exception as exc:
            import traceback
            check("the scenarios ran to the end", False, type(exc).__name__ + ": " + traceback.format_exc()[-900:])
        check("no socket was opened by anything the check ran", not OPENED, len(OPENED))
        raise psycopg.Rollback()
finally:
    socket.socket.connect, socket.socket.connect_ex, socket.create_connection = _orig
    try:
        real.close()
    except Exception:
        pass
print(json.dumps({"checks": checks, "facts": facts}, default=str))
'''


def app_part() -> None:
    print(f"\nasa-hub-app's wiring, in {RUNNER}")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    files = {p.name: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.json")}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps({"app": app, "files": files}).encode()) + b"\n",
                         capture_output=True, timeout=600)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        check("the driver ran in " + RUNNER, False, got.stderr.decode()[-2500:])
        return
    res = json.loads(lines[-1])
    for name, ok, detail in res["checks"]:
        check(name, ok, detail or None)
    facts = res["facts"]
    spec = SPACE["BACKEND_APPS"].get("smart-comms") or {}
    check("the relay's reads are exactly the reads asa-hub-app answers, and its writes the writes it decides beside "
          "the proposals' ingest (the relay's own lane call)",
          set(facts.get("python reads") or ()) == set(spec.get("reads") or ())
          and set(facts.get("python writes") or ()) == set(spec.get("writes") or ()) | {"commProposalsIngest"}, facts)
    for k in ("live situation raised",):
        print(f"  fact {k}: {facts.get(k)}")


def main() -> int:
    relay_part()
    app_part()
    print(f"\nsmart comms relay: {results['ok']} ok, {len(results['failed'])} failed")
    for name in results["failed"]:
        print("  FAILED:", name)
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
