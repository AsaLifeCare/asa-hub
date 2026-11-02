#!/usr/bin/env python3
"""The relay's last hand-offs to Apps Script, closed (server/snapshot_service.py, server/front_door_finish.py): its own
definitions lifted out of its source (tools/emit-front-door-routes.py's namespace) and run against scripted
neighbours. A finance receipt past 100 KB is named and read whole for Python; My Family is Python's alone (its 503, its
401); no final write hands itself on; the sign-in asks nothing of Apps Script and judges every token itself, a read
with no session or an ended one being its 401 and one it cannot judge its 503; Settings › Back-end refuses Apps
Script. Nothing is written and nothing is reached.

    python3 tools/test-no-gas-fallbacks.py
"""
from __future__ import annotations

import ast
import asyncio
import importlib.util
import json
import re
import sys
import time
import types
import urllib.parse
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
RELAY_SRC = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
FINISH_SRC = (ROOT / "server" / "front_door_finish.py").read_text(encoding="utf-8")
ROUTES = json.loads((ROOT / "app" / "front_door_routes.json").read_text(encoding="utf-8"))
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


def load(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Log:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def info(self, msg: str, *a: Any) -> None:
        self.lines.append(msg % a if a else msg)

    warning = exception = info


class Resp:
    def __init__(self, content: Any = b"", media_type: str = "", status_code: int = 200, headers: Any = None) -> None:
        self.body = content.encode() if isinstance(content, str) else content
        self.media_type, self.status_code, self.headers = media_type, status_code, headers or {}


class Unanswered:
    def get(self) -> str:
        return "scripted"


def form(action: str, payload: Any, token: str = "", **extra: Any) -> bytes:
    env = {"token": token, "action": action, "payload": payload, **extra} if token else \
        {"action": action, "payload": payload, **extra}
    return urllib.parse.urlencode({"body": json.dumps(env)}).encode()


def body(res: Any) -> Any:
    raw = getattr(res, "content", None)
    if raw is None:
        raw = getattr(res, "body", b"")
    return json.loads(raw)


def fn_src(name: str) -> str:
    node = next(n for n in ast.parse(RELAY_SRC).body
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
    return ast.unparse(node)


gen = load("emit_front_door_routes", ROOT / "tools" / "emit-front-door-routes.py")
tree, ns = gen.relay_namespace(RELAY_SRC)
log = Log()
ns.update(log=log, asyncio=asyncio, urllib=urllib, Response=Resp, _BACKEND_UNANSWERED=Unanswered(),
          _traffic_note=lambda key: None, json=json, time=time, re=re)
run = asyncio.run

# ---- 2. a finance receipt past 100 KB ------------------------------------------------------------------------------
print("finance receipts past the relay's 100 KB")
big = form("finSubmitTransaction", {"client": "x", "receiptBase64": "A" * 150_000, "receiptMime": "image/png"},
           "py." + "1" * 64)
check("both receipt writes are big writes: read whole, as their preread needs them",
      set(ns["BACKEND_WRITE_PREREAD"]) <= ns["BACKEND_BIG_WRITES"]
      and {"finSubmitTransaction", "finAttachReceipt"} <= set(ns["BACKEND_WRITE_PREREAD"]))
check("the relay names the action of a 150 KB receipt by its opening bytes, where _relay_action cannot",
      len(big) > 100_000 and ns["_relay_action"](big) == "" and ns["_upload_action"](big) == "finSubmitTransaction")
env = ns["_cert_papers_envelope"](big)
check("and reads its envelope whole", isinstance(env, dict) and len(env["payload"]["receiptBase64"]) == 150_000)
check("the front door's routes carry the preread, so it answers them itself",
      ROUTES["preread"] == {"finAttachReceipt": "finReceiptRead", "finSubmitTransaction": "finReceiptRead"}
      and {"finAttachReceipt", "finSubmitTransaction"} <= set(ROUTES["big_writes"])
      and all(a in ROUTES["final"] for a in ROUTES["preread"]))

# ---- 4. My Family --------------------------------------------------------------------------------------------------
print("My Family is Python's alone")
asked: list[Any] = []


def family(user: Any, answer: Any, actor: Any = ("client", "u1")) -> Any:
    async def person(authorization: str) -> Any:
        return user

    async def call(app_id: str, action: str, payload: dict, u: dict, extra: Any = None, timeout: Any = None) -> Any:
        asked.append((app_id, action, payload))
        return None if answer is None else (b"", 1.0, json.loads(json.dumps(answer)), None, 0.0)

    async def session_actor(authorization: str) -> Any:
        return actor

    async def post_exec(*a: Any, **k: Any) -> Any:
        asked.append(("APPS SCRIPT",))
        return {"status": 200}

    ns.update(_person_photo_user=person, _backend_call=call, _session_actor=session_actor, _post_exec=post_exec,
              _hotline_token=lambda a: a[7:] if a.startswith("Bearer ") else "")
    return run(ns["_my_family_forward"]("Bearer tok", "calendar", "2026-10-19"))


u = {"uid": "u1", "role": "client", "is_master": False}
got = family(u, {"status": 200, "data": {"family": True, "part": "calendar"}})
check("a client's part is asked of Python with the week", got["status"] == 200
      and asked[-1] == ("my-family", "myFamily", {"part": "calendar", "week": "2026-10-19"}))
asked.clear()
got = family(u, None)
check("Python not answering is My Family's 503, Apps Script never asked",
      got == {"status": 503, "reason": "unreadable",
              "message": "Your calendar could not be read just now. Try again in a moment."}
      and ("APPS SCRIPT",) not in asked, [got, asked])
got = family(None, None, actor=None)
check("a session that is not live is its 401", got["status"] == 401 and ("APPS SCRIPT",) not in asked, got)
got = family(None, None, actor=("client", "u1"))
check("a live session whose identity could not be settled is its 503", got["status"] == 503, got)
got = family(u, {"status": 404, "message": "Unknown action."})
check("an account standing away from headquarters gets doPost's own 404 through", got["status"] == 404
      and got["message"] == "Unknown action.", got)
check("the forward never posts to Apps Script", "_post_exec" not in fn_src("_my_family_forward")
      and "EXEC_URL" not in fn_src("_my_family_forward"))

# ---- 5. no final write hands itself on -----------------------------------------------------------------------------
print("no write hands itself to Apps Script")
apps = ns["BACKEND_APPS"]
check("no app names a hand-off any more", not [a for a, s in apps.items() if s.get("hands")],
      [a for a, s in apps.items() if s.get("hands")])
check("_backend_write has no hand-off branch: a final door's sheet write is its 503",
      "hands" not in fn_src("_backend_write") and "its door answered a sheet write" in fn_src("_backend_write"))
check("the account writes the hand-offs held are final, answered at the front door",
      {"profileUpdate", "userUpdate", "releaseUser"} <= set(ROUTES["final"])
      and not {"profileUpdate", "userUpdate", "releaseUser"} & set(ROUTES["relay_shaped"]))

# ---- 6. the sign-in's twins ----------------------------------------------------------------------------------------
print("the sign-in asks nothing of Apps Script")
for gone in ("_auth_gas_post", "_auth_gas_logout", "_auth_gas_touch", "_auth_twin_landing", "_GasAnswer",
             "AUTH_TWIN_WAIT_S", "AUTH_TWIN_SETTLE_S"):
    check(f"{gone} is gone from the relay", not re.search(r"\b" + gone + r"\b", RELAY_SRC))
check("the relay's finish of a sign-in asks nothing of Apps Script", "_auth_gas" not in FINISH_SRC
      and "also_apps_script" not in FINISH_SRC)
ns["HUB_APP_TOKEN"] = "t"
sheet_token = "a" * 48
check("every token is Python's to judge, the sheet's own carried-over ones too",
      ns["_auth_py_judges"]("py." + "0" * 64) and ns["_auth_py_judges"](sheet_token) and not ns["_auth_py_judges"](""))
posted: list[Any] = []


async def py_call(action: str, b: dict) -> Any:
    posted.append(("python", action, b.get("token")))
    return 200, {"status": 200, "data": {"ok": True}, "_also_apps_script": True, "_slid": True}


async def wanted_off(app_id: str) -> bool:
    return False


ns.update(_auth_py_call=py_call, _backend_wanted=wanted_off, _keep_task=lambda c: posted.append(("task", c)))
res = run(ns["_auth_py_answer"]("authLogout", form("authLogout", {}, sheet_token)))
check("a sign-out of a sheet-carried session is Python's, whatever the switch says; its old marks never reach "
      "the browser and nothing is sent on", res is not None and body(res[0]) == {"status": 200, "data": {"ok": True}}
      and posted == [("python", "authLogout", sheet_token)], [res, posted])
posted.clear()
got = run(ns["_auth_me"](sheet_token))
check("the relay's own authMe is Python's for a sheet-carried session, nothing slid on Apps Script",
      got == {"status": 200, "data": {"ok": True}} and posted == [("python", "authMe", sheet_token)], [got, posted])
check("a door no Python door takes is doPost's own 404 at the relay, whoever's session: no door Apps Script still "
      "held is left to refuse an ended session on", "_auth_py_ended" not in RELAY_SRC
      and 'RELAY_UNKNOWN_ACTION = {"status": 404, "message": "Unknown action."}' in RELAY_SRC
      and "return Response(json.dumps(RELAY_UNKNOWN_ACTION)" in fn_src("gas_relay").replace("'", '"'))

verdicts: dict[str, Any] = {}
ns["_session_verdict"] = lambda token: verdicts.get(token)
ns["_auth_cache"].clear()
ns["_auth_cache_put"] = lambda token, *v: ns["_auth_cache"].__setitem__(token, (time.time(), *v))

print("a read whose session the front door could not vouch for, at the relay")
read_door = next(a for a, app in ns["_BACKEND_ACTIONS"].items() if app == "staff")


async def wanted_on(app_id: str) -> bool:
    return True


async def no_actor(authorization: str) -> Any:
    return None


ns.update(_backend_wanted=wanted_on, _session_actor=no_actor)
ns["_auth_cache"].clear()
res = run(ns["_backend_answer"](read_door, form(read_door, {})))
check("no token: Python's 401, never handed on", res is not None and body(res[0]) == ns["AUTH_ENDED"], res)
verdicts["c" * 48] = (False, "", "")
res = run(ns["_backend_answer"](read_door, form(read_door, {}, "c" * 48)))
check("an ended session: Python's 401", res is not None and body(res[0]) == ns["AUTH_ENDED"], res)
res = run(ns["_backend_answer"](read_door, form(read_door, {}, "d" * 48)))
check("a session that could not be judged just now: Python's 503", res is not None
      and body(res[0]) == ns["BACKEND_UNREAD"], res)
ns["_auth_cache"]["e" * 48] = (time.time(), False, "", "")
res = run(ns["_backend_answer"](read_door, form(read_door, {}, "e" * 48)))
check("an ended session the gate already holds: its 401 at once", res is not None
      and body(res[0]) == ns["AUTH_ENDED"], res)

# ---- 8. Settings › Back-end ----------------------------------------------------------------------------------------
print("Settings › Back-end offers Python alone")
node = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "lane_backends_set")
stored: list[Any] = []
ns.update(app=types.SimpleNamespace(post=lambda *a, **k: (lambda f: f)), Request=object, Header=lambda default="": default,
          _backend_master_door=lambda a, m: asyncio.sleep(0), _hotline_token=lambda a: "tok",
          _token_name_get=lambda t: "Boss", _token_user_get=lambda t: "",
          _backend_store_set=lambda app_id, backend, who: stored.append((app_id, backend, who)),
          RESOURCE_UPLOAD_DOORS={}, _drive_intake_kick=lambda app_id: None,
          _backend_view=lambda: asyncio.sleep(0, result={"apps": []}))
exec(compile(ast.Module([node], []), "snapshot_service.py", "exec"), ns)  # noqa: S102 - the relay's own door


class Req:
    def __init__(self, payload: Any) -> None:
        self.payload = payload

    async def json(self) -> Any:
        return self.payload


app_id = next(iter(apps))
got = run(ns["lane_backends_set"](Req({"app": app_id, "backend": "apps_script"}), Resp(), "", "Bearer tok"))
check("Apps Script is refused, nothing stored", got == ns["BACKEND_GAS_REFUSED"] and got["status"] == 400
      and not stored, got)
got = run(ns["lane_backends_set"](Req({"app": app_id, "backend": "cobol"}), Resp(), "", "Bearer tok"))
check("any other engine but Python is refused", got["status"] == 400 and not stored, got)
got = run(ns["lane_backends_set"](Req({"app": app_id, "backend": "python"}), Resp(), "", "Bearer tok"))
check("Python is taken, stored once", got["status"] == 200 and stored == [(app_id, "python", "Boss")], [got, stored])
check("the only choice is Python", tuple(ns["BACKEND_CHOICES"]) == ("python",))

print()
print(f"{results['ok']} ok, {len(results['failed'])} failed")
sys.exit(1 if results["failed"] else 0)
