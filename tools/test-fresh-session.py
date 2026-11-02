#!/usr/bin/env python3
"""The relay's _FreshSession (server/snapshot_service.py), taken from its source with the sign-in stood in: a request
whose session the verdict cache holds no fresh word on is asked of the sign-in before the door runs, once; a fresh
word, no token, or a token that is not a bearer asks nothing; the door always runs after; and the middleware is on
the relay's app.

    python3 tools/test-fresh-session.py
"""
from __future__ import annotations

import ast
import asyncio
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
TREE = ast.parse(SRC)
ok_count, failed = 0, []


def check(name: str, ok: bool, detail: Any = None) -> None:
    global ok_count
    if ok:
        ok_count += 1
        print(f"  ok   {name}")
    else:
        failed.append(name)
        print(f"  FAIL {name}" + ("" if detail is None else f" — {detail}"))


cls = next(n for n in TREE.body if isinstance(n, ast.ClassDef) and n.name == "_FreshSession")
validated: list[str] = []
order: list[str] = []
ns: dict[str, Any] = {"Any": Any, "time": time, "AUTH_TTL_SECONDS": 300.0, "_auth_cache": {}}


async def _validate(token: str) -> None:
    validated.append(token)
    order.append("validate")
    ns["_auth_cache"][token] = (time.time(), token.startswith("good"), "staff", "USR_1")


ns["_validate"] = _validate
exec(compile(ast.Module(body=[cls], type_ignores=[]), "snapshot_service.py", "exec"), ns)


async def door(scope: Any, receive: Any, send: Any) -> None:
    order.append("door")


def ask(headers: list[tuple[bytes, bytes]], kind: str = "http") -> None:
    validated.clear()
    order.clear()
    asyncio.run(ns["_FreshSession"](door)({"type": kind, "headers": headers}, None, None))


ask([(b"authorization", b"Bearer good-1")])
check("a session the cache does not hold is asked of the sign-in once, before the door",
      validated == ["good-1"] and order == ["validate", "door"], order)
ask([(b"authorization", b"Bearer good-1")])
check("a fresh word asks nothing", validated == [] and order == ["door"])
ns["_auth_cache"]["good-1"] = (time.time() - 301, True, "staff", "USR_1")
ask([(b"authorization", b"bearer good-1")])
check("a word older than the cache's life is asked again", validated == ["good-1"])
ask([(b"authorization", b"Bearer bad-1")])
ask([(b"authorization", b"Bearer bad-1")])
check("an ended session is asked once, then its refusal stands for the cache's life", validated == [])
ask([])
check("no token asks nothing, and the door runs", validated == [] and order == ["door"])
ask([(b"authorization", b"Basic abc")])
check("a credential that is not a bearer asks nothing", validated == [] and order == ["door"])
ask([(b"authorization", b"Bearer good-2")], kind="lifespan")
check("anything but an HTTP request passes untouched", validated == [] and order == ["door"])
check("the middleware is on the relay's app", "app.add_middleware(_FreshSession)" in SRC)

print(f"\n{ok_count} ok, {len(failed)} failed")
sys.exit(1 if failed else 0)
