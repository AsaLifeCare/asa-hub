#!/usr/bin/env python3
"""App Control is the master's: the relay answers a session the backend already called non-master on every app-access write, whichever shape doPost would read the body in, and lets everything else through for Apps Script to decide — a session App Control is shared with and may change (Settings > App Control access) included."""
import ast
import json
import sys
import urllib.parse
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {detail}")


def segment(name: str) -> str:
    """One top-level definition or assignment, as written in the relay."""
    for node in ast.parse(SOURCE).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(SOURCE, node) or ""
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == name for t in node.targets):
            return ast.get_source_segment(SOURCE, node) or ""
    return ""


# the relay imports FastAPI and Postgres at load; the gate is pure, so it is lifted out and run alone
ns: dict[str, Any] = {"json": json, "urllib": urllib, "Any": Any}
for name in ("_RELAY_APP_ACCESS_ACTIONS", "_relay_json_constant", "_relay_envelope",
             "_relay_app_access_write", "_relay_app_access_refusal"):
    code = segment(name)
    check(f"the relay declares {name}", bool(code))
    exec(code, ns)  # noqa: S102 — the relay's own source
refusal = ns["_relay_app_access_refusal"]
REFUSED = {"status": 404, "message": "Unknown action."}
NON_MASTER = {"tok": False}


def form(action: str, payload: Any, token: str = "tok", **extra: Any) -> bytes:
    body = json.dumps({"token": token, "action": action, "payload": payload, **extra})
    return urllib.parse.urlencode({"body": body}).encode()


def plain(action: str, payload: Any, token: str = "tok", **extra: Any) -> bytes:
    """doPost parses a raw JSON body FIRST (Main.gs) — the text/plain lane."""
    return json.dumps({"token": token, "action": action, "payload": payload, **extra}).encode()


print("A SESSION THE BACKEND CALLED NON-MASTER is refused on every app-access write")
for shape, make in (("form", form), ("raw JSON", plain)):
    for action, payload in (("appBadgeAccessSet", {"app_id": "chat", "badges": []}),
                            ("appTenantAccessSet", {"app_id": "chat", "tenants": ["t1"]}),
                            ("appAccessSetBulk", {"rules": {"chat": ["DIRECTOR"]}}),
                            ("appAccessSetBulk", {"tenants": {"chat": ["t1"]}})):
        got = refusal(make(action, payload), NON_MASTER)
        check(f"{shape}: {action} {sorted(payload)} → the backend's own 404", got == REFUSED, got)
got = refusal(plain("appBadgeAccessSet", {"app_id": "chat", "badges": []}, member="mem_x"), NON_MASTER)
check("raw JSON inside a member visit → 404 (the flag is the SIGNED-IN session's)", got == REFUSED, got)
got = refusal(("  \n" + plain("appBadgeAccessSet", {"app_id": "chat"}).decode()).encode(), NON_MASTER)
check("raw JSON with leading whitespace → 404", got == REFUSED, got)
escaped = b'{"token":"tok","action":"\\u0061ppBadgeAccessSet","payload":{"app_id":"chat"}}'
check("a JSON-escaped action name is read as JSON reads it → 404", refusal(escaped, NON_MASTER) == REFUSED)
encoded = urllib.parse.urlencode({"body": '{"token":"tok","action":"appTenantAccessSet","payload":{}}'},
                                 quote_via=lambda s, *a: "".join(f"%{b:02X}" for b in s.encode())).encode()
check("a fully percent-encoded form body → 404", refusal(encoded, NON_MASTER) == REFUSED)

print("THE READING IS doPost's: the raw body wins when it parses, the form field only when it does not")
nan_hides = (b'{"token":"tok","action":"list","x":NaN,"y":"&body='
             + urllib.parse.quote(json.dumps({"token": "tok", "action": "appBadgeAccessSet",
                                              "payload": {"app_id": "chat"}})).encode() + b'&z="}')
check("a body JSON.parse refuses (NaN) is read through its form field, as doPost falls back",
      refusal(nan_hides, NON_MASTER) == REFUSED)
check("a raw body that parses to a non-object names no action", refusal(b'"appBadgeAccessSet"', NON_MASTER) is None)
check("a body that is not UTF-8 is left to Apps Script", refusal(b'\xff' + plain("appBadgeAccessSet", {}), NON_MASTER) is None)
check("a body past the reading limit is left to Apps Script",
      refusal(plain("appBadgeAccessSet", {"pad": "x" * 100_001}), NON_MASTER) is None)
check("deep nesting does not break the relay", refusal(b"[" * 50_000, NON_MASTER) is None)

print("THE MASTER, AND A SESSION NOT YET SEEN, pass through for Apps Script to decide")
for flags, label in (({"tok": True}, "master"), ({}, "unseen")):
    check(f"{label}: appBadgeAccessSet passes",
          refusal(form("appBadgeAccessSet", {"app_id": "x", "badges": []}), flags) is None)
    check(f"{label}: the bulk badge lane passes (raw JSON too)",
          refusal(plain("appAccessSetBulk", {"rules": {"x": ["ADMIN"]}}), flags) is None)

print("WHAT IS NOT THE APP MATRIX is never refused here")
check("a sections-only Apply keeps its delegation",
      refusal(form("appAccessSetBulk", {"sections": {"access": ["DIRECTOR"]}}), NON_MASTER) is None)
check("empty badge and tenant lanes are not an app write",
      refusal(form("appAccessSetBulk", {"rules": {}, "tenants": {}, "sections": {"a": []}}), NON_MASTER) is None)
check("a person save is Apps Script's to judge — it refuses a CHANGED denial list only",
      refusal(form("userUpdate", {"user_id": "u1", "app_denials": ["chat"], "perm_overrides": {}}), NON_MASTER) is None)
check("the matrix READ passes — every launcher is drawn from it",
      refusal(form("appBadgeAccessGet", {}), NON_MASTER) is None)
check("any other action passes", refusal(plain("chatPing", {}), NON_MASTER) is None)
check("an upload-sized form body passes untouched",
      refusal(form("docUpload", {"data": "A" * 200_000}), NON_MASTER) is None)

print("SETTINGS > APP CONTROL ACCESS — a session App Control is shared with and may change goes on to Apps Script")
yes = lambda token: token == "tok"  # noqa: E731
no = lambda token: False  # noqa: E731


def broken(token: str) -> bool:
    raise RuntimeError("the lane could not be read")


for shape, make in (("form", form), ("raw JSON", plain)):
    for action, payload in (("appBadgeAccessSet", {"app_id": "scheduling", "badges": ["STAFF"]}),
                            ("appAccessSetBulk", {"rules": {"scheduling": ["STAFF"]}})):
        check(f"{shape}: a writer's {action} passes for the doors to decide",
              refusal(make(action, payload), NON_MASTER, yes) is None)
        check(f"{shape}: anybody the lane does not name keeps the 404 on {action}",
              refusal(make(action, payload), NON_MASTER, no) == REFUSED)
        check(f"{shape}: a writer check that throws is no pass on {action}",
              refusal(make(action, payload), NON_MASTER, broken) == REFUSED)
check("another session's token is not the writer's",
      refusal(form("appBadgeAccessSet", {"app_id": "scheduling"}, token="other"), {"other": False}, yes) == REFUSED)
check("the tenant door is let on too — Apps Script refuses a delegate there itself",
      refusal(form("appTenantAccessSet", {"app_id": "scheduling", "tenants": ["t1"]}), NON_MASTER, yes) is None)
check("without a writer check the answer is today's", refusal(form("appBadgeAccessSet", {"app_id": "x"}), NON_MASTER) == REFUSED)

lane: dict[str, Any] = {}
ns2: dict[str, Any] = {"Any": Any, "_config_lane_for": lambda place: lane if place == "" else None,
                       "_auth_cache": {}}
for name in ("_lane_ac_writers", "_relay_ac_writer"):
    code = segment(name)
    check(f"the relay declares {name}", bool(code))
    exec(code, ns2)  # noqa: S102 — the relay's own source
writer = ns2["_relay_ac_writer"]
ns2["_auth_cache"].update({"tok-max": (0.0, True, "staff", "u-max"), "tok-dee": (0.0, True, "manager", "u-dee"),
                           "tok-gone": (0.0, False, "", "u-max"), "tok-nouid": (0.0, True, "staff", "")})
check("no lane names nobody", writer("tok-max") is False)
lane["app_control_writers"] = ["u-max", " ", ""]
check("the lane's account is a writer", writer("tok-max") is True)
check("an account the lane does not name is not", writer("tok-dee") is False)
check("a refused session is not, whoever it was", writer("tok-gone") is False)
check("a session without an account is not", writer("tok-nouid") is False)
check("a token the relay never saw is not", writer("tok-unknown") is False and writer("") is False)
lane["app_control_writers"] = "u-max"
check("a lane that is not a list names nobody", writer("tok-max") is False)

print("WIRING — the early answer stands before Python is asked")
body = segment("gas_relay")
at_gate = body.find("_relay_app_access_refusal(")
check("gas_relay asks it", at_gate != -1)
check("…with the backend's own master flags, and the lane's writers",
      "_relay_app_access_refusal(raw, _auth_master, _relay_ac_writer)" in body)
check("…whatever the form parser made of the action (a raw JSON body names none there)",
      "if action in _RELAY_APP_ACCESS_ACTIONS" not in body)
check("…before Python is asked, by its own door or the sign-in's",
      -1 < at_gate < body.find("await _backend_answer(") and at_gate < body.find("await _auth_py_answer("))

print()
print(f"test-app-control-master: {results['ok']} ok, {len(results['failed'])} failed")
sys.exit(1 if results["failed"] else 0)
