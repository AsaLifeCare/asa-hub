#!/usr/bin/env python3
"""The relay with HUB_EXEC_URL unset (server/snapshot_service.py): nothing of Apps Script's door is left in its source;
/gas answers doPost's own 404 for anything no door takes — an unknown action, a raw-JSON envelope, a body too big to
name, the service's call to a person's door — and posts nowhere; a raw-JSON envelope is read as the form one; a rung,
Python's reads and writes and the sign-in answer; the clocks tick, the staff sweep and the time clock's loops run their
Python work, the texts' inbox is handed to Python, and live chat executes. Every call to asa-hub-app is scripted; any
other HTTP call fails the run. Nothing is written and nothing is reached.

    python3 tools/test-no-exec-url.py
"""
from __future__ import annotations

import __future__ as future
import ast
import asyncio
import base64
import contextvars
import hashlib
import hmac
import json
import math
import os
import re
import sys
import time
import types
import urllib.parse
from pathlib import Path
from typing import Any, Callable

sys.dont_write_bytecode = True
os.environ["HUB_EXEC_URL"] = ""
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
import chat_live  # noqa: E402

SRC = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
FEED_SRC = (ROOT / "server" / "comm_calls_feed.py").read_text(encoding="utf-8")
TREE = ast.parse(SRC)
results: dict[str, Any] = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: Any = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:600]}")


# ---- the network: asa-hub-app is scripted below; anything else that would leave is caught here ---------------------
LEFT: list[str] = []


class NoNetwork:
    def __init__(self, *a: Any, **k: Any) -> None:
        pass

    async def __aenter__(self) -> "NoNetwork":
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    def __enter__(self) -> "NoNetwork":
        return self

    def __exit__(self, *exc: Any) -> bool:
        return False

    def _left(self, url: Any, *a: Any, **k: Any) -> Any:
        LEFT.append(str(url))
        raise ConnectionError("no network in this test: " + str(url))

    post = get = _left


class Log:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def info(self, msg: str, *a: Any, **k: Any) -> None:
        try:
            self.lines.append(msg % a if a else msg)
        except TypeError:
            self.lines.append(msg)

    warning = error = exception = debug = info

    def log(self, _level: int, msg: str, *a: Any) -> None:
        self.info(msg, *a)


class Resp:
    def __init__(self, content: Any = b"", media_type: str = "", status_code: int = 200, headers: Any = None) -> None:
        self.body = content.encode() if isinstance(content, str) else content
        self.media_type, self.status_code, self.headers = media_type, status_code, headers or {}


class App:
    def __getattr__(self, _name: str) -> Callable[..., Any]:
        return lambda *a, **k: (lambda fn: fn)


log = Log()
httpx_stub = types.SimpleNamespace(AsyncClient=NoNetwork, Client=NoNetwork, TransportError=OSError,
                                   TimeoutException=TimeoutError, ConnectError=ConnectionError,
                                   ConnectTimeout=TimeoutError, PoolTimeout=TimeoutError)


def relay_namespace() -> dict[str, Any]:
    """The relay's definitions and constants, as tools/emit-front-door-routes.py evaluates them, over a namespace that
    holds the modules its constants need and a network that answers nothing."""
    ns: dict[str, Any] = {"os": os, "re": re, "json": json, "time": time, "math": math, "hashlib": hashlib,
                          "hmac": hmac, "base64": base64, "urllib": urllib, "Path": Path, "Any": Any,
                          "Callable": Callable, "contextvars": contextvars, "asyncio": asyncio, "httpx": httpx_stub,
                          "log": log, "logging": __import__("logging"), "chat_live": chat_live, "edit_overlay": None,
                          "Response": Resp, "JSONResponse": Resp, "StreamingResponse": Resp, "Request": object,
                          "Header": lambda default="", alias=None: default, "BackgroundTasks": object, "app": App(),
                          "__name__": "relay_constants"}
    flags = future.annotations.compiler_flag
    # a definition whose defaults name a constant is held back until the constant is there
    pending = [n for n in TREE.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
               and (not n.decorator_list or isinstance(n, ast.ClassDef))]
    pending += [n for n in TREE.body if isinstance(n, (ast.Assign, ast.AnnAssign, ast.AugAssign))]
    for _ in range(6):
        left = []
        for node in pending:
            try:
                exec(compile(ast.Module([node], []), "snapshot_service.py", "exec", flags=flags, dont_inherit=True), ns)
            except Exception:  # noqa: BLE001 - one that needs the running relay
                left.append(node)
        if len(left) == len(pending):
            break
        pending = left
    return ns


def form(action: str, payload: Any = None, token: str = "", **extra: Any) -> bytes:
    env: dict[str, Any] = {"action": action, "payload": payload if payload is not None else {}, **extra}
    if token:
        env["token"] = token
    return urllib.parse.urlencode({"body": json.dumps(env)}).encode()


class Req:
    def __init__(self, raw: bytes, content_type: str = "application/x-www-form-urlencoded;charset=UTF-8") -> None:
        self._raw = raw
        self.headers = {"content-type": content_type}

    async def body(self) -> bytes:
        return self._raw


def answer_of(res: Any) -> Any:
    return json.loads(res.body)


run = asyncio.run
ns = relay_namespace()
ns["log"] = log

# ---- 1. the source -------------------------------------------------------------------------------------------------
print("nothing of Apps Script's door is left in the relay")
for gone in ("EXEC_URL", "script.google", "AKfyc", "_post_exec", "_gas_said", "_GAS_BUILD", "_ledger_", "LEDGER_",
             "bulkWrite", "_edit_overlay_take", "_edit_overlay_python", "_edit_overlay_queue", "_echo_reached",
             "_backend_engine_answered", "_auth_py_ended", "_note_engine_build", "_clock_sweeps_owned",
             "_smart_clock_owned", "_hotline_fast_file", "Relay has no backend URL"):
    check(f"{gone} is gone", not re.search(r"(?<![A-Za-z0-9])" + re.escape(gone), SRC))
check("the call lane's terminal door posts to asa-hub-app, never to an exec URL",
      "HUB_EXEC_URL" not in FEED_SRC and "/v1/{DOOR_APP}/{action}" in FEED_SRC)
check("the relay's namespace never reads HUB_EXEC_URL", "EXEC_URL" not in ns)

# ---- the scripted neighbours ---------------------------------------------------------------------------------------
asked: list[tuple[str, str, Any, Any, Any]] = []
answers: dict[str, Any] = {}


async def backend_call(app_id: str, action: str, payload: Any, user: Any, extra: Any = None,
                       timeout: Any = None) -> Any:
    asked.append((app_id, action, payload, user, extra))
    got = answers.get(action)
    if callable(got):
        got = got(payload)
    if got is None:
        ns["_BACKEND_UNANSWERED"].set("scripted: no answer")
        return None
    env = json.loads(json.dumps(got))
    return json.dumps(env).encode(), time.time(), env, None, 0.0


auth_calls: list[tuple[str, Any]] = []
auth_answers: dict[str, Any] = {}


async def auth_py_call(action: str, body: dict[str, Any]) -> tuple[int, Any]:
    auth_calls.append((action, body.get("token")))
    return auth_answers.get(action, (0, None))


actors: dict[str, tuple[str, str]] = {"tok-admin": ("admin", "U_ADMIN"), "tok-staff": ("staff", "U_STAFF")}


async def session_actor(authorization: str) -> Any:
    return actors.get(authorization[7:])


async def app_pack_master(authorization: str) -> tuple[bool, str]:
    return False, ""


observed: list[str] = []


def recorder(name: str) -> Callable[..., None]:
    def fn(*a: Any, **k: Any) -> None:
        observed.append(name)
    return fn


async def nothing(*a: Any, **k: Any) -> None:
    return None


settled: list[tuple[str, str, str]] = []
tasks: list[Any] = []
OBSERVERS = ("_relay_observe_auth", "_master_sign_in_observed", "_relay_observe_be_another", "_auth_py_released",
             "_relay_observe_chat", "_relay_observe_chat_read", "_chat_live_observed", "_chat_push_observed",
             "_relay_observe_access_write", "_relay_observe_app_pack", "_relay_observe_scheduling",
             "_relay_observe_support_desk", "_vehicle_calendar_rang", "_staff_profiles_rang", "_smart_comms_rang",
             "_forms_rang", "_support_desk_rang", "_docs_rang", "_learning_rang", "_recon_rang",
             "_viewer_cache_written", "_edit_overlay_config_seen")
ns.update({name: recorder(name) for name in OBSERVERS})
ns.update(_backend_call=backend_call, _auth_py_call=auth_py_call, _session_actor=session_actor,
          _app_pack_master=app_pack_master, _traffic_note=lambda key: None, HUB_APP_TOKEN="t" * 32,
          _keep_task=lambda coro: tasks.append(coro), _app_pack_sending=lambda *a: None,
          _viewer_cache_key=lambda *a: None, _chat_behind_flush_for=nothing,
          _backend_final_landed=recorder("_backend_final_landed"), _mark_dirty=lambda *a: None,
          _publish_slice=lambda *a: None, _backend_settle_soon=lambda app_id, wid, state, *a, **k:
          settled.append((app_id, wid, state)), _sheet_sync_wake=lambda: None,
          lane_gate=types.SimpleNamespace(holds=lambda lane: {"held": False}, action_gate=lambda a: {"held": False},
                                          refused=lambda why: {"status": 409, "held": True, "message": why}))


def load(*names: str) -> None:
    for name in names:
        node = next(n for n in TREE.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
        exec(compile(ast.Module([node], []), "snapshot_service.py", "exec",  # noqa: S102 - the relay's own source
                     flags=future.annotations.compiler_flag, dont_inherit=True), ns)


load("gas_relay", "chat_exec")


def gas(raw: bytes, content_type: str = "application/x-www-form-urlencoded;charset=UTF-8") -> Any:
    observed.clear()
    return answer_of(run(ns["gas_relay"](Req(raw, content_type))))


UNKNOWN = {"status": 404, "message": "Unknown action."}

# ---- 2. the last fallthrough ---------------------------------------------------------------------------------------
print("/gas: what no door takes is doPost's own 404, and nothing leaves")
asked.clear()
got = gas(form("noSuchActionAnywhere", {}, "tok-staff"))
check("an action no door names: doPost's 404, word for word", got == UNKNOWN, got)
check("…Python is not asked for it, and nothing was posted anywhere", not asked and not LEFT, [asked, LEFT])
got = gas(json.dumps({"action": "noSuchActionAnywhere", "token": "tok-staff", "payload": {}}).encode(),
          "application/json")
check("a raw-JSON envelope of an unknown action: the same 404", got == UNKNOWN and not LEFT, got)
padded = urllib.parse.urlencode({"body": json.dumps({"token": "tok-staff", "payload": {"x": "A" * 150_000}})}).encode()
got = gas(padded)
check("a body past 100 KB that names no action: the 404, never carried", got == UNKNOWN and not LEFT, got)
check("a body that is no envelope at all: the 404", gas(b"x" * 200_000) == UNKNOWN and not LEFT)
read_door = "staffProfileRoster"
check("the read door this test asks is Python's", ns["_BACKEND_ACTIONS"].get(read_door) == "staff")
asked.clear()
got = gas(form(read_door, {}, service_secret="s" * 24))
check("the service's call to a person's read door: the 404, Python never asked as a person",
      got == UNKNOWN and not asked and not LEFT, [got, asked])

# ---- 3. a raw-JSON envelope is read as the form one ----------------------------------------------------------------
print("/gas: a raw-JSON envelope is the form envelope")
raw_json = json.dumps({"action": read_door, "token": "tok-staff", "payload": {"q": "ann"}}).encode()
check("the relay's reader turns it into the form field `body`, as the front door's form_raw does",
      ns["_relay_action"](ns["_relay_form"](raw_json)) == read_door
      and ns["_relay_form"](form(read_door)) == form(read_door)
      and ns["_relay_form"](b"[1,2]") == b"[1,2]" and ns["_relay_form"](b"{nope") == b"{nope")
answers[read_door] = {"status": 200, "data": {"staff": [{"key": "ann"}]}}
asked.clear()
got = gas(raw_json, "application/json")
check("a person's read sent as raw JSON is answered by Python's door with its payload",
      got == answers[read_door] and asked and asked[-1][:3] == ("staff", read_door, {"q": "ann"}), [got, asked])

# ---- 4. a read, a write, a rung and the sign-in ---------------------------------------------------------------------
print("/gas: Python's read, write, rung and sign-in, with no exec URL")
asked.clear()
got = gas(form(read_door, {}, "tok-staff"))
check("a read: Python's answer, as the session the relay verified", got == answers[read_door]
      and asked[-1][3].get("uid") == "U_STAFF" and not LEFT, [got, asked[-1:]])
check("…and gas_relay's observers heard it, in their order", observed[-len(OBSERVERS):] == list(OBSERVERS), observed)
answers[read_door] = None
got = gas(form(read_door, {}, "tok-staff"))
check("a read Python does not answer: its 503, never handed on", got == ns["BACKEND_UNREAD"] and not LEFT, got)
write_door = "staffProfileNoteAdd"
check("the write door this test asks is Python's", ns["_BACKEND_WRITES"].get(write_door) == "staff")
answers[write_door] = {"status": 200, "data": {"ok": True}, "_write": {"final": True}}
asked.clear()
got = gas(form(write_door, {"staff": "annlee", "details": "x"}, "tok-staff"))
check("a write: kept by Python and answered final, its copies read again",
      got == {"status": 200, "data": {"ok": True}} and asked[-1][1] == write_door
      and re.fullmatch(r"W[0-9a-f]{24}", str((asked[-1][4] or {}).get("write_id")))
      and "_backend_final_landed" in observed and not LEFT, [got, asked[-1:], observed])
answers[write_door] = None
settled.clear()
got = gas(form(write_door, {"staff": "annlee", "details": "x"}, "tok-staff"))
check("a write Python does not answer: nothing written, said, and its id voided — never handed on",
      got == {"status": 503, "message": ns["BACKEND_FINAL_UNWRITTEN"]} and settled and settled[-1][2] == "void"
      and not LEFT, [got, settled])
answers[write_door] = {"status": 200, "data": {}, "_write": {"house": "x", "deliver": {}}}
got = gas(form(write_door, {"staff": "annlee", "details": "x"}, "tok-staff"))
check("a door that answers a sheet write: never carried anywhere, said unwritten", got["status"] == 503 and not LEFT, got)
answers["commWindowAskPlan"] = {"status": 200, "data": {"due": False, "why": "window"}}
asked.clear()
got = gas(form("commWindowAskSweep", {}, "tok-admin"))
check("a rung (the window ask an admin presses): Python's look, answered", got == {"status": 200,
      "data": {"why": "window"}} and asked[-1][1] == "commWindowAskPlan" and not LEFT, [got, asked])
check("…refused to a non-admin as before", gas(form("commWindowAskSweep", {}, "tok-staff"))["status"] == 403)
auth_answers["authLogin"] = (200, {"status": 200, "data": {"token": "py." + "0" * 64, "user": {"id": "U_NEW"}},
                                   "_also_apps_script": True})
auth_calls.clear()
got = gas(form("authLogin", {"identifier": "a@b.c", "password": "x"}))
check("the sign-in: Python's answer, its old marks dropped", got == {"status": 200, "data": {
      "token": "py." + "0" * 64, "user": {"id": "U_NEW"}}} and auth_calls == [("authLogin", None)], [got, auth_calls])
auth_answers["authLogin"] = (409, {"status": 409, "defer": "hand back"})
got = gas(form("authLogin", {"identifier": "a@b.c", "password": "x"}))
check("a hand-back from Python is its 503, never another engine's", got == ns["AUTH_UNAVAILABLE"] and not LEFT, got)
check("no request of this run left for anywhere but asa-hub-app", not LEFT, LEFT)

# ---- 5. the relay's own sign-in check ------------------------------------------------------------------------------
print("the relay's own authMe is Python's")
check("no token: its 401", run(ns["_auth_me"]("")) == ns["AUTH_ENDED"])
auth_answers["authMe"] = (200, {"status": 200, "data": {"user": {"id": "U_STAFF", "role": "staff"}}, "_slid": True})
auth_calls.clear()
check("a token: Python's answer, asked once", run(ns["_auth_me"]("tok-staff")) == {
      "status": 200, "data": {"user": {"id": "U_STAFF", "role": "staff"}}} and auth_calls == [("authMe", "tok-staff")])
auth_answers["authMe"] = (0, None)
try:
    run(ns["_auth_me"]("tok-staff"))
    raised = False
except RuntimeError:
    raised = True
check("Python not answering raises, as a sign-in that did not answer", raised)

# ---- 6. the clocks -------------------------------------------------------------------------------------------------
print("the clocks tick on Python with no exec URL")
answers.update({"commRepairDue": {"status": 200, "data": {"due": ""}},
                "commRecordPlan": {"status": 200, "data": {"due": False, "why": "window"}},
                "commRepliesDue": {"status": 200, "data": {"skipped": True}}})
asked.clear()
run(ns["_comm_repair_tick"]({}))
run(ns["_comm_record_tick"]({}))
run(ns["_comm_replies_tick"]({}))
check("the repair, obligations and mailbox clocks each ask their Python look", [a[1] for a in asked] == [
      "commRepairDue", "commRecordPlan", "commRepliesDue"] and not LEFT, asked)
handed: list[Any] = []
ns["web_gate"] = types.SimpleNamespace(rotate=lambda: None, pending=lambda: [{"id": "m1", "row": {}}],
                                       after_handoff=lambda env, ids: handed.append((env, ids)) or
                                       {"handed": 1, "refused": 0, "ok": True, "why": ""},
                                       waiting_count=lambda: 0)
ns["_WEB_SAID"].update(mock_last=0.0, rotated=time.time(), mock_refused=False)
answers["commMockWebIngest"] = {"status": 200, "data": {"written": ["m1"]}}
asked.clear()
run(ns["_web_mock_handoff"]())
check("the mock rows' hand-off needs no exec URL: Python's commMockWebIngest takes them",
      [a[1] for a in asked] == ["commMockWebIngest"] and handed and handed[0][1] == ["m1"], [asked, handed])

print("the texts' inbox is handed to Python")
offers = [{"id": "e1", "type": "message.received", "source": "webhook", "event": {"id": "e1"}}]
inbox_said: list[Any] = []
ns["quo_inbox"] = types.SimpleNamespace(ready=lambda now: True, pending=lambda now: offers,
                                        begin_batch=lambda *a: None, BATCH_MAX=50,
                                        after_batch=lambda offer, env, failure, now: inbox_said.append((env, failure))
                                        or {"verdict": "answered", "sent": 1, "filed": 1, "already": 0, "failed": 0,
                                            "unreached": 0, "left": 0})
answers["quoIngestBatch"] = {"status": 200, "data": {"results": [{"id": "e1", "state": "filed"}]}}
asked.clear()
check("one batch of the inbox: posted", run(ns["_quo_handoff_once"]()) is True)
check("…to Python's quoIngestBatch, its answer back into the inbox", [a[1] for a in asked] == ["quoIngestBatch"]
      and inbox_said and inbox_said[0][1] is None and inbox_said[0][0]["status"] == 200, [asked, inbox_said])


class Stop(Exception):
    pass


def loop_asyncio(passes: int) -> Any:
    """asyncio as the loop sees it: its sleeps return at once, and the loop is stopped at its `passes`+1-th."""
    count = {"n": 0}

    async def sleep(_s: float, *a: Any) -> None:
        count["n"] += 1
        if count["n"] > passes:
            raise Stop

    async def shield(aw: Any) -> Any:
        return await aw

    return types.SimpleNamespace(**{**{k: getattr(asyncio, k) for k in dir(asyncio) if not k.startswith("__")},
                                    "sleep": sleep, "shield": shield})


print("the staff sweep runs its Python work with no exec URL")
for look in ("staffAttendanceDue", "hotlineInboxDue", "supportDeskClockDue", "vehicleCalendarClockDue",
             "staffBroadcastHeld", "lettersDue", "appReleaseDue", "istNoticeDue", "reconAutoSweep",
             "requirementStatesSweep", "teamAlertsDue", "commCallsSweepFetch"):
    answers.setdefault(look, {"status": 200, "data": {}})
ns.update(asyncio=loop_asyncio(1), _cadence_beat=nothing, _line_directory_handoff=nothing,
          _potential_clients_sync=nothing, _comm_proposals_due=lambda: False)
ns["_REQ_STATES_RAN"][0] = 0.0
asked.clear()
try:
    run(ns["_staff_sweep_loop"]())
except Stop:
    pass
seen = [a[1] for a in asked]
want = ["staffAttendanceDue", "hotlineInboxDue", "supportDeskClockDue", "vehicleCalendarClockDue",
        "staffBroadcastHeld", "lettersDue", "appReleaseDue", "istNoticeDue", "reconAutoSweep",
        "requirementStatesSweep", "teamAlertsDue", "commCallsSweepFetch", "commRepliesDue"]
check("one tick rang every Python clock in its order: the attendance sweep, the hotline's inbox, the app clocks, "
      "the letters, the releases, IST, reconciliation, the requirement states, the team alerts, the call lane and the "
      "mailbox ear", [s for s in seen if s in want] == want, seen)
check("…the hiring lane's own looks among them", any(s in ("hiringConditionsDue", "interviewStartDue") for s in seen),
      seen)
check("…and nothing left for an exec URL", not LEFT, LEFT)

print("the time clock's loop hands its rows on with no exec URL")
posted_lanes: list[str] = []
for lane in ("_psi_reminders_post", "_shift_handoff_post", "_time_off_post", "_punch_pairs_post",
             "_support_punch_post", "_shift_requests_post", "_open_shift_covered_post", "_recruit_book_post",
             "_calloff_road_post", "_shift_pool_sweep"):
    async def mark(name: str = lane) -> None:
        posted_lanes.append(name)
    ns[lane] = mark
ns.update(asyncio=loop_asyncio(1), PG_DSN="dsn://test",
          psi_attendance=types.SimpleNamespace(tick=lambda dsn: {}, pending=lambda now: None))
try:
    run(ns["_psi_attendance_loop"]())
except Stop:
    pass
check("the reminders, hand-offs, time off, punches, support, requests, covered shifts, recruit book and call-off road "
      "all ran", posted_lanes == ["_shift_pool_sweep", "_psi_reminders_post", "_shift_handoff_post", "_time_off_post",
                                  "_punch_pairs_post", "_support_punch_post", "_shift_requests_post",
                                  "_open_shift_covered_post", "_recruit_book_post", "_calloff_road_post"],
      posted_lanes)
ns["asyncio"] = asyncio

# ---- 7. live chat --------------------------------------------------------------------------------------------------
print("live chat executes with no exec URL")
KEY = "k" * 64
refs = chat_live.Registry()
ns.update(_chat_refs=refs, _chat_unsettled=chat_live.Unsettled(), _CHAT_KEY=KEY, _chat_cache=None,
          _acting={}, _chat_push_seen=lambda ids: None, _chat_cache_wrote=lambda *a: None)
ident = {"account_id": "U_STAFF", "person_id": "U_STAFF", "fold_ids": ["U_STAFF"], "name": "Ann",
         "is_master": False, "narrowed": False}
ticket = refs.mint("tok-staff", "", ident)
ref = refs.redeem(ticket)["ref"]
answers["chatOverview"] = {"status": 200, "data": {"threads": []}}
asked.clear()
body = {"ref": ref, "action": "chatOverview", "payload": {}, "client_id": "c-1"}


class ChatReq:
    async def body(self) -> bytes:
        return json.dumps(body).encode()


got = run(ns["chat_exec"](ChatReq(), x_hub_chat_key=KEY))
said = got.body if isinstance(got.body, dict) else json.loads(got.body)
check("a chat read through the hub: Python's chat answers it as the ref's session",
      said.get("status") == 200 and said.get("data") == {"threads": []}
      and asked and asked[-1][:2] == ("chat", "chatOverview") and asked[-1][3].get("uid") == "U_STAFF",
      [said, asked[-1:]])
check("…and nothing left for an exec URL", not LEFT, LEFT)
for task in tasks:
    if asyncio.iscoroutine(task):
        task.close()

print()
print(f"{results['ok']} ok, {len(results['failed'])} failed")
sys.exit(1 if results["failed"] else 0)
