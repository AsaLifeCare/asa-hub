#!/usr/bin/env python3
"""
Write app/front_door_routes.json from server/snapshot_service.py: what the relay's /gas (gas_relay) hands to Python's
doors, and what it keeps for itself, read off its source so asa-hub-app's front door (app/front_door.py) routes as it
routes.

  reads, writes, final   _BACKEND_ACTIONS, _BACKEND_WRITES, _BACKEND_FINAL (Settings › Back-end per app's tables)
  auth                   AUTH_PY_DOORS (the sign-in's doors on Python)
  big_writes             BACKEND_BIG_WRITES (a write whose envelope is read whole, past the 100 KB readers)
  generic                the generic verbs' doors (_backend_generic_door) and App Studio's (BUILDER_DOORS)
  settings_tools         _settings_tools_door's tools and the resource its generic verbs name
  relay_first            every action a rung of gas_relay takes before Python's own doors are asked
  relay_shaped           every door _backend_answer / _backend_write prepares or follows with the relay's own work
  prepare, preread       of those, the writes a preparation (BACKEND_WRITE_PREPARE) or a preread
                         (BACKEND_WRITE_PREREAD) alone shapes, which the front door does itself
  guards                the master's account guards and a switched session's refusals, word for word
  rungs                 the words, sets and maps of the rungs answered in the app (app/gas_rungs.py), and the
                        resolver's tool map as _resolver_relay_maps builds it

The rungs are read off gas_relay's own tests: a test this script cannot read stops it, so a rung added to the relay is
never missed silently. Nothing is imported from the relay and nothing it defines is run but its constants.

    python3 tools/emit-front-door-routes.py            # writes the file
    python3 tools/emit-front-door-routes.py --check    # exit 1 when the file differs from the relay
"""
from __future__ import annotations

import ast
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
import urllib.parse
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parent.parent
RELAY = ROOT / "server" / "snapshot_service.py"
OUT = ROOT / "app" / "front_door_routes.json"

# gas_relay's top-level tests that are not rungs: its guards' answers
GUARD_TESTS = frozenset({"refused", "held"})
# a rung named by a variable a helper set: the helper's own actions (and the resource its generic verbs name)
HELPER_RUNGS = {"settings_door": "_settings_tools_door"}
# names _backend_answer / _backend_write test an action against that shape nothing the door is asked
NOT_SHAPING = frozenset({"BACKEND_BIG_WRITES", "_BACKEND_FINAL", "RELAY_BYTE_READS", "APP_CONTROL_WRITES"})
# dicts those doors read with .get(action): a preparation (shaping), or a wait or a table lookup (not)
SHAPING_GETS = frozenset({"BACKEND_WRITE_PREPARE"})
# a table _backend_write tests an action against for its preread (a receipt kept first): a preparation too
SHAPING_PREREADS = frozenset({"BACKEND_WRITE_PREREAD"})
NOT_SHAPING_GETS = frozenset({"BACKEND_LONG_READS", "_BACKEND_ACTIONS", "_BACKEND_WRITES"})
# the relay's constants the app's rungs answer with (app/gas_rungs.py)
RUNG_CONSTANTS = ("AUTH_ENDED", "BACKEND_UNREAD", "BACKEND_FINAL_UNWRITTEN", "RELAY_UNKNOWN_ACTION",
                  "EDITIONS_PYTHON_ACTIONS", "EDITIONS_UNREAD", "EDITIONS_MINE_NONE", "EDITIONS_SAVES",
                  "EDITIONS_CONFIG_REFUSED",
                  "PERFORMANCE_APP", "PERFORMANCE_READS", "PERFORMANCE_WRITES", "PERFORMANCE_KEEP",
                  "PERFORMANCE_EVALUATE", "PERFORMANCE_UNREAD", "PERFORMANCE_AWAY",
                  "HOUSE_MEDS_APP", "LOCATION_MEDS_APP_OF", "LOCATION_MEDS_UNREAD", "LOCATION_MEDS_AWAY",
                  "STAFF_AUDITED_ACTIONS",
                  "SETTINGS_TOOLS_APP", "SETTINGS_TOOLS_APP_OF", "SETTINGS_TOOLS_NOT_HERE", "SETTINGS_TOOLS_AWAY",
                  "SETTINGS_TOOLS_UNREAD", "SETTINGS_TOOLS_WRITES", "RESOLVER_RELAYED",
                  "PYTHON_TOOL_DOORS", "PYTHON_TOOL_UNANSWERED", "HIRING_APP", "HIRING_WALK_BUDGET_S",
                  "HIRING_WALK_TURNS",
                  "PUBLIC_DOORS_BY_APP", "PUBLIC_UNSAVED", "PUBLIC_UNREAD", "PUBLIC_CALLER", "FORMS_APP",
                  "FORMS_PUBLIC_CLAIM",
                  "IST_ROSTER_ACTIONS", "IST_DECLARATION_ACTIONS", "IST_ROSTER_HOLD_S", "CANDIDATE_PAPERS_APP")


class Unread(Exception):
    """A test of the relay this script cannot read: a human looks before the routes are written."""


def _assignish(node: ast.stmt) -> bool:
    if isinstance(node, (ast.Assign, ast.AugAssign)):
        return True
    if isinstance(node, ast.AnnAssign):
        return node.value is not None
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
        f = node.value.func
        return isinstance(f, ast.Attribute) and f.attr in ("update", "add", "setdefault")
    if isinstance(node, ast.For):
        return all(_assignish(n) for n in node.body)
    return False


def relay_namespace(src: str) -> tuple[ast.Module, dict[str, Any]]:
    """The relay's constants, evaluated in order: its plain definitions first (never run but where a constant calls
    one), then every top-level assignment, update and loop of them, again until nothing more resolves."""
    tree = ast.parse(src)
    ns: dict[str, Any] = {"os": os, "re": re, "json": json, "time": time, "math": math, "hashlib": hashlib,
                          "hmac": hmac, "base64": base64, "urllib": urllib, "Path": Path, "Any": Any,
                          "Callable": Callable, "contextvars": contextvars, "__name__": "relay_constants"}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and not node.decorator_list:
            try:
                exec(compile(ast.Module([node], []), str(RELAY), "exec"), ns)  # noqa: S102 - a definition only
            except Exception:  # noqa: BLE001 - a definition this namespace cannot hold is not a constant
                pass
    pending = [n for n in tree.body if _assignish(n)]
    for _ in range(4):
        left = []
        for node in pending:
            try:
                exec(compile(ast.Module([node], []), str(RELAY), "exec"), ns)  # noqa: S102 - the relay's constants
            except Exception:  # noqa: BLE001 - one that needs the running relay
                left.append(node)
        if len(left) == len(pending):
            break
        pending = left
    return tree, ns


def _fn(tree: ast.Module, name: str) -> ast.AST:
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    raise Unread(f"the relay defines no {name}")


def _keys(value: Any, name: str) -> set[str]:
    if isinstance(value, dict):
        return {str(k) for k in value}
    if isinstance(value, (set, frozenset, list, tuple)):
        return {str(v) for v in value}
    raise Unread(f"{name} is not a set of actions")


def _action_like(node: ast.AST) -> bool:
    """`action`, `door`, `_upload_action(raw)`, `_app_pack_upload_envelope(raw).get("action")`."""
    if isinstance(node, ast.Name):
        return node.id in ("action", "door")
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        return node.func.id == "_upload_action"
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get":
        inner = node.func.value
        return (isinstance(inner, ast.Call) and isinstance(inner.func, ast.Name)
                and inner.func.id == "_app_pack_upload_envelope"
                and bool(node.args) and isinstance(node.args[0], ast.Constant) and node.args[0].value == "action")
    return False


def _compared(cmp: ast.Compare, ns: dict[str, Any]) -> set[str]:
    """The actions one `x == "a"` / `x in NAME` / `x in ("a", "b")` names."""
    if len(cmp.ops) != 1:
        raise Unread(ast.unparse(cmp))
    op, right = cmp.ops[0], cmp.comparators[0]
    if isinstance(op, ast.Eq) and isinstance(right, ast.Constant) and isinstance(right.value, str):
        return {right.value}
    if isinstance(op, ast.In):
        if isinstance(right, (ast.Tuple, ast.Set, ast.List)) and all(
                isinstance(e, ast.Constant) and isinstance(e.value, str) for e in right.elts):
            return {e.value for e in right.elts}
        if isinstance(right, ast.Name):
            if right.id not in ns:
                raise Unread(f"{right.id} could not be evaluated")
            return _keys(ns[right.id], right.id)
    raise Unread(ast.unparse(cmp))


def relay_first(tree: ast.Module, ns: dict[str, Any]) -> tuple[set[str], dict[str, Any]]:
    """Every action a rung of gas_relay answers before `_backend_generic_door` names Python's door, and the helper
    rungs' own sets."""
    fn = _fn(tree, "gas_relay")
    out: set[str] = set()
    helpers: dict[str, Any] = {}
    helper_vars: dict[str, str] = {}
    for stmt in fn.body:  # type: ignore[attr-defined]
        if isinstance(stmt, ast.Assign) and isinstance(stmt.value, ast.Call) and isinstance(stmt.value.func, ast.Name):
            called = stmt.value.func.id
            if called == "_backend_generic_door":
                return out, helpers
            for target in stmt.targets:
                if isinstance(target, ast.Name) and HELPER_RUNGS.get(target.id) == called:
                    helper_vars[target.id] = called
        if not isinstance(stmt, ast.If) or not any(isinstance(n, ast.Return) for n in ast.walk(stmt)):
            continue
        found: set[str] = set()
        for node in ast.walk(stmt.test):
            if isinstance(node, ast.Compare) and _action_like(node.left):
                found |= _compared(node, ns)
        if found:
            out |= found
            continue
        test = stmt.test
        if isinstance(test, ast.Compare) and isinstance(test.left, ast.Name) and test.left.id in GUARD_TESTS:
            continue
        if isinstance(test, ast.Name) and test.id in helper_vars:
            if helper_vars[test.id] == "_settings_tools_door":
                helpers["settings_tools"] = {"actions": sorted(_keys(ns["SETTINGS_TOOLS_ACTIONS"], "tools")),
                                             "resource": str(ns["SETTINGS_TOOLS_RESOURCE"])}
                out |= set(helpers["settings_tools"]["actions"])
                continue
        raise Unread(f"gas_relay rung not read: if {ast.unparse(test)}")
    raise Unread("gas_relay never names Python's door (_backend_generic_door)")


def relay_shaped(tree: ast.Module, ns: dict[str, Any], prepared: bool = True) -> set[str]:
    """Every door _backend_answer and _backend_write prepare or follow with the relay's own work (with `prepared`
    False, all but the preparations)."""
    out: set[str] = set()
    apps = ns["BACKEND_APPS"]
    for name in ("_backend_answer", "_backend_write"):
        for node in ast.walk(_fn(tree, name)):
            if isinstance(node, ast.Compare) and isinstance(node.left, ast.Name) and node.left.id == "action":
                right = node.comparators[0]
                if isinstance(right, ast.Name) and right.id in NOT_SHAPING:
                    continue
                if isinstance(right, ast.Name) and right.id in SHAPING_PREREADS:
                    if prepared:
                        out |= _keys(ns[right.id], right.id)
                    continue
                if isinstance(right, ast.Call) and isinstance(right.func, ast.Attribute) and right.func.attr == "get" \
                        and right.args and isinstance(right.args[0], ast.Constant) and right.args[0].value == "hands":
                    out |= {a for spec in apps.values() for a in spec.get("hands", ())}
                    continue
                out |= _compared(node, ns)
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get" \
                    and node.args and isinstance(node.args[0], ast.Name) and node.args[0].id == "action":
                owner = node.func.value
                owner_name = owner.id if isinstance(owner, ast.Name) else ast.unparse(owner)
                if owner_name in SHAPING_GETS:
                    if prepared:
                        out |= _keys(ns[owner_name], owner_name)
                elif owner_name not in NOT_SHAPING_GETS:
                    raise Unread(f"{name}: {ast.unparse(node)}")
    return out


def guards(ns: dict[str, Any]) -> dict[str, Any]:
    return {"master_row_targets": {k: list(v) for k, v in ns["MASTER_ROW_TARGETS"].items()},
            "master_ask_refused": ns["MASTER_ASK_REFUSED"],
            "master_account": ns["HUB_MASTER_ACCOUNT"],
            "app_access_actions": sorted(ns["_RELAY_APP_ACCESS_ACTIONS"]),
            "chat_actions": sorted(ns["CHAT_PYTHON_ACTIONS"]),
            "switched_refused": dict(ns["ACTING_REFUSED"]),
            "switched_refused_resources": dict(ns["ACTING_REFUSED_RESOURCES"]),
            "sign_in": {"window_s": ns["MASTER_SIGN_IN_WINDOW_S"], "per_ip": ns["MASTER_SIGN_IN_PER_IP"],
                        "strangers": ns["MASTER_SIGN_IN_STRANGERS"], "known_s": ns["MASTER_SIGN_IN_KNOWN_S"],
                        "refused": ns["MASTER_SIGN_IN_REFUSED"]}}


def _plain(value: Any) -> Any:
    """A relay constant as JSON: an answer (a dict with a status) in its own order, since an answer is its bytes; any
    other dict and every set sorted (some are built off a set's order); a tuple a list, a function its name."""
    if isinstance(value, dict):
        items = value.items() if "status" in value else sorted(value.items(), key=lambda kv: str(kv[0]))
        return {str(k): _plain(v) for k, v in items}
    if isinstance(value, (set, frozenset)):
        return sorted(_plain(v) for v in value)
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if callable(value):
        return getattr(value, "__name__", "")
    return value


def resolver_tools(tree: ast.Module, ns: dict[str, Any]) -> dict[str, Any]:
    """_resolver_relay_maps' tool map, built by its own statements before it answers, less the composed routes."""
    local = dict(ns)
    for stmt in _fn(tree, "_resolver_relay_maps").body:  # type: ignore[attr-defined]
        if isinstance(stmt, ast.Return):
            break
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant):
            continue
        exec(compile(ast.Module([stmt], []), str(RELAY), "exec"), local)  # noqa: S102 - the relay's own map
    tools = local.get("tools")
    if not isinstance(tools, dict):
        raise Unread("_resolver_relay_maps builds no tool map")
    composed = ns["RESOLVER_RELAY_COMPOSED"]
    return {"tools": {a: str(p) for a, p in sorted(tools.items()) if a not in composed}, "composed": sorted(composed)}


def rungs(tree: ast.Module, ns: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name in RUNG_CONSTANTS:
        if name not in ns:
            raise Unread(f"{name} could not be evaluated")
        out[name] = _plain(ns[name])
    out["resolver"] = resolver_tools(tree, ns)
    return out


def build(src: str) -> dict[str, Any]:
    tree, ns = relay_namespace(src)
    first, helpers = relay_first(tree, ns)
    generic_doors = ns["BACKEND_GENERIC_DOORS"]
    shaped = relay_shaped(tree, ns)
    # the writes a preparation alone shapes: the door asked first, then the write (the front door can do both)
    prepares, prereads = ns["BACKEND_WRITE_PREPARE"], ns["BACKEND_WRITE_PREREAD"]
    prepared_only = shaped - relay_shaped(tree, ns, prepared=False)
    return {
        "_": "Generated by tools/emit-front-door-routes.py from server/snapshot_service.py; never edited by hand.",
        "reads": dict(sorted(ns["_BACKEND_ACTIONS"].items())),
        "writes": dict(sorted(ns["_BACKEND_WRITES"].items())),
        "final": sorted(ns["_BACKEND_FINAL"]),
        "auth": sorted(ns["AUTH_PY_DOORS"]),
        "big_writes": sorted(ns["BACKEND_BIG_WRITES"]),
        "generic": {"verbs": sorted(ns["_GENERIC_VERBS"]),
                    "doors": sorted([r, v, d] for (r, v), d in generic_doors.items()),
                    "world": dict(sorted(ns["WORLD_GENERIC_DOORS"].items())),
                    "routes": sorted(ns["GS_ROUTE_NAMES"]),
                    "builder": sorted(ns["BUILDER_DOORS"])},
        "settings_tools": helpers.get("settings_tools") or {"actions": [], "resource": ""},
        "relay_first": sorted(first),
        "relay_shaped": sorted(shaped),
        "prepare": {a: list(prepares[a]) for a in sorted(prepared_only) if a in prepares},
        "preread": {a: str(prereads[a]) for a in sorted(prepared_only) if a in prereads},
        "guards": guards(ns),
        "rungs": rungs(tree, ns),
    }


def dump(routes: dict[str, Any]) -> str:
    return json.dumps(routes, indent=1, sort_keys=False, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    try:
        routes = build(RELAY.read_text(encoding="utf-8"))
    except Unread as why:
        print(f"not written: {why}", file=sys.stderr)
        return 2
    text = dump(routes)
    if "--check" in argv:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == text
        print("app/front_door_routes.json " + ("matches the relay" if same else "DIFFERS from the relay"))
        return 0 if same else 1
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(routes['reads'])} reads, {len(routes['writes'])} writes, "
          f"{len(routes['relay_first'])} relay-first, {len(routes['relay_shaped'])} relay-shaped")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
