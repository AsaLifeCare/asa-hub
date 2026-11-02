"""The relay's last clocks and its last /gas path in asa-hub-app, before the relay stops.
- The relay's _start starts no staff beat.
- app/clocks.py sweep_loop writes the watchdog's hub.staff_sweep row and runs the arriving calls on every sixth tick.
- The arriving calls' pile (app/comm_calls_feed.py) reads asa-hub-db's Transcripts copy, read-only. It is newest first,
  never empty of words, honours `only` and `exclude`, and asks the old platform store nothing.
- A service-secret /gas that names one of Python's doors here is answered here, and a wrong secret is refused before
  any door is asked.
No word of a transcript is printed, nothing is written, no door is asked.

From the repo root (the relay's source read here, the rest run inside asa-hub-db-sync by the in-process runner):

    RUNNER=<scratchpad> python3 tools/test-relay-stop.py
"""
import ast
import json
import os
import subprocess
import sys

if not os.environ.get("RELAY_STOP_INPROC"):
    src = open("server/snapshot_service.py", encoding="utf-8").read()
    tree = ast.parse(src)
    start = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == "_start")
    called = {c.func.id for c in ast.walk(start) if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}
    fails = [] if "_staff_sweep_loop" not in called else ["the relay still starts _staff_sweep_loop"]
    clocks = ast.parse(open("app/clocks.py", encoding="utf-8").read())
    loop = next(n for n in ast.walk(clocks) if isinstance(n, ast.AsyncFunctionDef) and n.name == "sweep_loop")
    text = ast.unparse(loop)
    if "beat('hub.staff_sweep'" not in text or "comm_calls_door.live_tick()" not in text or "tick % 6 == 0" not in text:
        fails.append("sweep_loop does not write hub.staff_sweep and run the arriving calls hourly")
    # the front door's service path, its two functions run on stand-ins for everything they call
    import asyncio
    import hmac
    import types

    fd = ast.parse(open("app/front_door.py", encoding="utf-8").read())
    body = [n for n in fd.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            and n.name in ("service_route", "service_gas")]
    asked: list = []

    async def _door(*a, **k):
        asked.append(a)
        return {"status": 200, "data": {"via": a[1]}}

    async def _call(*a, **k):
        asked.append(a)
        return {"status": 200, "data": {"via": a[1]}}, ""

    sys.modules["clocks"] = types.SimpleNamespace(service_door=_door, call=_call)
    ns = {"hmac": hmac, "Any": object, "RELAY_FIRST": {"relayOnly"}, "generic_door": lambda a, e: a,
          "WRITES": {"aWrite": "app-a", "heldWrite": "app-a"}, "HERE_WRITES": {"aWrite"},
          "READS": {"aRead": "app-b"}, "HERE_READS": {"aRead"}, "builder_payload": lambda d, e, p: p,
          "SERVICE_SECRET": "the-real-one", "SERVICE_REFUSED": {"status": 401, "message": "Authentication required."}}
    exec(compile(ast.Module(body=body, type_ignores=[]), "front_door", "exec"), ns)
    sr, sg = ns["service_route"], ns["service_gas"]
    for name, ok in (
            ("a service write here is routed here", sr({"action": "aWrite"}) == ("write", "aWrite", "app-a")),
            ("a service read here is routed here", sr({"action": "aRead"}) == ("read", "aRead", "app-b")),
            ("a held door, a relay-first one and an unknown one still go on",
             sr({"action": "heldWrite"}) is None and sr({"action": "relayOnly"}) is None
             and sr({"action": "nope"}) is None),
            ("a wrong secret is refused before any door is asked",
             asyncio.run(sg({"action": "aWrite", "service_secret": "wrong"})) == ns["SERVICE_REFUSED"] and not asked),
            ("the right one: the write asked as the service, once",
             asyncio.run(sg({"action": "aWrite", "service_secret": "the-real-one", "payload": {"x": 1}}))
             == {"status": 200, "data": {"via": "aWrite"}} and asked == [("app-a", "aWrite", {"x": 1})]),
            ("and a read through the read call", asyncio.run(sg({"action": "aRead", "service_secret": "the-real-one"}))
             == {"status": 200, "data": {"via": "aRead"}})):
        if not ok:
            fails.append(name)
    del sys.modules["clocks"]
    print(json.dumps({"relay_source_and_service_path": fails or "ok"}))
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_relay_stop.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    env = {"RELAY_STOP_INPROC": "1",
           "READING_SRC": open(os.environ["HUB_READING_ORACLE"], encoding="utf-8").read()}
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here, json.dumps(env)],
                         capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if fails or out.returncode or '"failed": []' not in out.stdout else 0)

import tempfile  # noqa: E402
from datetime import datetime  # noqa: E402

results: dict[str, str] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:200]}"


path = os.path.join(tempfile.mkdtemp(), "comm_calls.py")
with open(path, "w", encoding="utf-8") as fh:
    fh.write(os.environ["READING_SRC"])

import comm_calls_feed as CCF  # noqa: E402

CCF.MODULE_PATHS[:] = [path]
mod = CCF.reading()
mod.psycopg2 = None  # the old platform store is never asked: its pile() would raise here

rows = CCF.pile(limit=5)
check("the pile reads asa-hub-db's copy: rows, each with its id and words",
      0 < len(rows) <= 5 and all(r.get("call_id") and r.get("full_transcript") for r in rows), len(rows))
check("in the reading's own columns",
      all(set(r) == {"call_id", "event_timestamp", "duration_sec", "participant_s", "team_member_s", "direction",
                     "turns", "full_transcript", "speaker_transcript", "processed", "processedbyagent",
                     "processingerror", "_row_number"} for r in rows), sorted(rows[0]) if rows else [])


def instant(r: dict):
    try:
        return datetime.strptime(str(r.get("event_timestamp") or ""), "%m/%d/%Y %H:%M:%S")
    except ValueError:
        return None


stamps = [instant(r) for r in rows if instant(r) is not None]
check("newest first, on the instant", stamps == sorted(stamps, reverse=True), [str(s) for s in stamps])
first = rows[0]["call_id"] if rows else ""
check("`only` names one call", [r["call_id"] for r in CCF.pile(only=[first])] == [first])
check("`exclude` leaves it out", first not in {r["call_id"] for r in CCF.pile(exclude=[first], limit=5)})

print(json.dumps({"results": results, "failed": [k for k, v in results.items() if v != "ok"]}, indent=1))
