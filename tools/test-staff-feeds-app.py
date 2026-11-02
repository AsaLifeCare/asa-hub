"""The relay staff beat's feeds in asa-hub-app (app/staff_feeds.py), on stand-in doors: the line directory on the first
tick after a start, and on the hour the contact list (pass after pass while the door hands rows back), the behaviour
signals, the comm routes, the PSI punches and the comm windows, each handed to its door in-process as the service with
a write id, an unchanged hand-over not handed again; the day's proposals once a day off the wall clock on disk; the
ingest gate holding what it held in the relay. Two reads run live and read-only: the company's lines off
the old platform (asa_hub_ro's grant) and the proposals counter over asa-hub-db's copy of its four houses. And the
relay's own source: its staff sweep keeps only the arriving calls, and it no longer starts the
pharmacy reports' sweep. Nothing is written anywhere and no message leaves.

From the repo root (the relay's source read here, the rest run inside asa-hub-db-sync by the in-process runner):

    RUNNER=<scratchpad> python3 tools/test-staff-feeds-app.py
"""
import ast
import json
import os
import subprocess
import sys

if not os.environ.get("FEEDS_TEST_INPROC"):
    src = open("server/snapshot_service.py", encoding="utf-8").read()
    tree = ast.parse(src)
    defs = {n.name: n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}

    def called(fn: str) -> set[str]:
        return {c.func.id if isinstance(c.func, ast.Name) else c.func.attr for c in ast.walk(defs[fn])
                if isinstance(c, ast.Call) and isinstance(c.func, (ast.Name, ast.Attribute))}

    fails = []
    sweep = called("_staff_sweep_loop")
    for moved in ("_hotline_python_inbox", "_line_directory_handoff", "_contacts_handoff", "_behavior_handoff",
                  "_comm_routes_handoff", "_psi_punches_tick", "_comm_when_tick", "_comm_proposals_due",
                  "_comm_proposals_tick", "_psi_full_start"):
        if moved in sweep:
            fails.append(f"the relay's staff sweep still runs {moved}")
    if "_comm_calls_tick" not in sweep:
        fails.append("the relay's staff sweep lost the arriving calls")
    start = called("_start")
    if "_house_meds_loop" in start:
        fails.append("the relay still starts the pharmacy reports' sweep")
    if "_staff_sweep_loop" not in start:
        fails.append("the relay no longer starts what is left of its staff sweep")
    print(json.dumps({"relay_source": fails or "ok"}))
    runner = os.environ["RUNNER"]
    env = json.dumps({"FEEDS_TEST_INPROC": "1", "FD_ROUTES": open("app/front_door_routes.json").read(),
                      "HUB_IST_CONFIG_DECLARATION_JSON": open("app/ist_config_defaults.json").read()})
    with open(os.path.join(runner, "test_staff_feeds_app.py"), "w") as fh:
        fh.write(open(__file__).read())
    # one argument holds at most 128 KiB: the environment goes as a file
    with open(os.path.join(runner, "feeds_env.json"), "w") as fh:
        fh.write(env)
    rc = subprocess.call(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"),
                          os.path.join(runner, "test_staff_feeds_app.py"), "@" + os.path.join(runner, "feeds_env.json")])
    sys.exit(1 if fails else rc)

import asyncio  # noqa: E402
import logging  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402

logging.disable(logging.CRITICAL)


class _Resp:
    def __init__(self, content=None, status_code=200, media_type=None, headers=None):
        if isinstance(content, (dict, list)):
            content = json.dumps(content).encode()
        self.body, self.status_code, self.media_type = content or b"", status_code, media_type
        self.headers = dict(headers or {})


async def _threadpool(fn, *a, **k):
    return fn(*a, **k)


_fa = types.ModuleType("fastapi")
_fa.Request = object
_fr = types.ModuleType("fastapi.responses")
_fr.JSONResponse = _fr.Response = _Resp
_sc = types.ModuleType("starlette.concurrency")
_sc.run_in_threadpool = _threadpool
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": _sc})
WORK = tempfile.mkdtemp(prefix="feeds-test-")
with open(WORK + "/routes.json", "w") as fh:
    fh.write(os.environ["FD_ROUTES"])
OWNER = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']} options='-c default_transaction_read_only=on'")
os.environ.update(HUB_FRONT_DOOR_ROUTES=WORK + "/routes.json", HUB_SNAPSHOT_OUT=WORK, HUB_DB_DSN=OWNER,
                  HUB_SERVICE_SECRET="")

out: dict = {}
fails: list = []


def check(name, cond, got=None):
    out[name] = "ok" if cond else {"FAILED": got}
    if not cond:
        fails.append(name)


try:
    import psycopg

    import lanes_pg
    lanes_pg.CONNECT["intel"] = lambda: psycopg.connect(os.environ["MIRROR_DSN"], autocommit=True,
                                                        options="-c default_transaction_read_only=on")
    import front_door as FD
    import live_notify
    import clocks as C
    import staff_feeds as SF

    asked: list = []
    told: list = []
    lane: dict = {"data": None}
    contacts_left = {"n": 1}

    def answer(action, payload):
        if action == "configLane":
            return {"status": 200, "data": lane["data"]}
        if action == "peopleSyncFromPlatform":
            rows = payload.get("rows") or []
            if contacts_left["n"]:
                contacts_left["n"] -= 1
                return {"status": 200, "data": {"updated": 1, "inserted": 0, "received": len(rows), "left": rows[1:]}}
            return {"status": 200, "data": {"updated": 0, "inserted": 1, "received": len(rows)}}
        if action == "psiPunchesIngest":
            n = len(payload.get("rows") or [])
            return {"status": 200, "data": {"kept": n, "inserted": 0, "updated": 0, "unchanged": n, "writes": 0}}
        if action == "commWhenIngest":
            n = len(payload.get("rows") or [])
            return {"status": 200, "data": {"inserted": 0, "updated": n, "unchanged": 0, "writes": 1}}
        if action == "commProposalsIngest":
            n = len(payload.get("rows") or [])
            return {"status": 200, "data": {"received": n, "inserted": n, "updated": 0, "unchanged": 0}}
        return {"status": 200, "data": {"stored": 2, "shared": 1, "wrote": 3, "refused": 0, "inserted": 0,
                                        "updated": 3, "unchanged": 0}}

    class Door:
        def __init__(self, names):
            self.ACTIONS = {n: None for n in names}

    def run(module, action, said, payload, at=0.0):
        asked.append((action, payload, said.get("is_service"), ""))
        return _Resp(answer(action, payload))

    def run_write(deciding, action, said, payload, wid, at=0.0):
        asked.append((action, payload, said.get("is_service"), wid))
        return _Resp(answer(action, payload))

    M = types.SimpleNamespace(
        APPS={"config-lane": Door(["configLane"]), "line-directory": Door([]), "contacts-sync": Door([]),
              "hiring": Door(["behaviorSignalsPrepare"]), "comm-routes": Door([]), "comm-when": Door([]),
              "smart-comms": Door([])},
        WRITES={"line-directory": Door(["lineDirectorySync"]), "contacts-sync": Door(["peopleSyncFromPlatform"]),
                "hiring": Door(["behaviorSignalsIngest", "psiPunchesIngest"]), "comm-routes": Door(["commRoutesIngest"]),
                "comm-when": Door(["commWhenIngest"]), "smart-comms": Door(["commProposalsIngest"])},
        _run=run, _run_write=run_write)
    C.M = M
    raised: list = []

    class _Said:
        def __getattr__(self, level):
            def say(msg, *args, **_k):
                if level in ("exception", "warning", "error"):
                    import traceback
                    raised.append((level, (msg % args) if args else msg, traceback.format_exc(limit=3)[-600:]))
            return say

    SF.log = _Said()
    live_notify.told = lambda **k: told.append(k) or k
    live_notify.dirty = lambda names: told.append({"dirty": sorted(names)}) or list(names)
    FD.settle_void_soon = lambda app_id, wid: None

    # ---- live and read-only: the company's lines and the proposals counter -----------------------------------------
    lines = SF.lines_payload()
    check("live: the company's lines read off the old platform as asa_hub_ro, raw rows and when they were read",
          lines["rows"] and all(set(r) == {"id", "number", "name", "assigned_users", "forward_to"} for r in lines["rows"])
          and lines["source_at"], {"rows": len(lines["rows"]), "source_at": lines["source_at"]})
    import comm_proposals_feed as CPF
    got = CPF.read("asa-hub-db")
    check("live: the proposals counter over asa-hub-db's copy of its four houses says what it says, never guessed",
          isinstance(got.get("enough"), bool) and (got["enough"] or got.get("why_not"))
          and isinstance(got.get("control_distinct"), int),
          {k: got.get(k) for k in ("enough", "why_not", "control_distinct", "unclear_distinct", "counted")})

    # ---- the feeds' reads, stood in for ---------------------------------------------------------------------------
    import behavior_slices
    import comm_cortex
    import comm_when_feed
    import contacts_slices
    import psi_punches_feed

    SF.lines_payload = lambda: {"rows": [{"id": "PN1", "number": "+13309195558", "name": "Hotline",
                                          "assigned_users": [], "forward_to": ""}], "source_at": "2031-01-01"}
    people = [{"id": f"E{i}", "name": f"Person {i}"} for i in range(3)]
    contacts_slices.build_with_quality = lambda dsn: (people, "2031-01-01T00:00:00Z", {"refused": {}, "dropped": {}})
    contacts_slices.handoff_payload = lambda rows, at: {"rows": list(rows), "source_at": at}
    behavior_slices.signals_payload = lambda dsn: {"rows": [{"id": "s1", "value": 2}], "source_at": "t",
                                                   "window": "30d", "people": 3, "read": 1}
    comm_cortex.build = lambda resource, dsn: ([{"id": "r1", "phone": "1"}, {"id": "r2", "phone": "2"}], None)
    punches = [{**{k: f"v{i}" for k in psi_punches_feed.FIELDS}, "single_entry_id": f"P{i}"} for i in range(5)]
    psi_punches_feed.probe = lambda dsn: {"rows": 5, "newest": "t"}
    psi_punches_feed.read = lambda dsn: {"rows": punches, "digest": "d", "stored": 5, "live": 0}
    psi_punches_feed.batches = lambda rows: [rows[:3], rows[3:]]
    comm_when_feed.read = lambda dsn: {"rows": [{"id": "w1"}, {"id": "w2"}], "digest": "wd", "reachable": 2}
    comm_when_feed.batches = lambda rows: [rows]
    CPF.read = lambda dsn: {"rows": [{"id": "CP_a", "status": "proposed"}], "digest": "pd", "enough": True,
                            "proposed": 1, "blocked": 0}

    async def main():
        del asked[:]
        await SF.tick(1)
        acts = [a[0] for a in asked if a[0] != "configLane"]
        check("tick 1: the line directory handed over first thing, as the service with a write id; the proposals, "
              "never run on this disk, beside it",
              acts == ["lineDirectorySync", "commProposalsIngest"] and asked[0][2] is True
              and asked[0][3].startswith("W") and asked[0][1]["rows"][0]["number"] == "+13309195558", acts)
        check("the proposals: Smart Comms' pages rung, the day stamped on disk",
              {"rang": ["smartcomms"], "swept": ["smartcomms"]} in told
              and os.path.isfile(os.path.join(WORK, "lane-stamps", "comm_proposals.json")), list(told))
        check("the proposals: not due again within the day", SF.proposals_due() is False)
        del asked[:]
        await SF.tick(6)
        acts = [a[0] for a in asked if a[0] != "configLane"]
        check("the hour: contacts (two passes), behaviour (its prepare first), routes, the PSI punches (two passes) "
              "and the windows, in the relay's order",
              acts == ["peopleSyncFromPlatform", "peopleSyncFromPlatform", "behaviorSignalsPrepare",
                       "behaviorSignalsIngest", "commRoutesIngest", "psiPunchesIngest", "psiPunchesIngest",
                       "commWhenIngest"], acts)
        passes = [a[1]["rows"] for a in asked if a[0] == "peopleSyncFromPlatform"]
        check("contacts: the rows the door handed back are the next pass's", len(passes[0]) == 3 and len(passes[1]) == 2,
              [len(p) for p in passes])
        check("contacts: the People slice rebuilt once a roster row moved", {"dirty": ["people"]} in told, list(told))
        writes = [a for a in asked if a[3]]
        check("every hand-over asked as the service, every write with its own id",
              all(a[2] is True for a in asked) and len({a[3] for a in writes}) == len(writes) == 7, len(writes))
        del asked[:]
        await SF.tick(12)
        acts = [a[0] for a in asked if a[0] != "configLane"]
        check("the next hour: unchanged hand-overs are not handed again (the PSI record has not moved)",
              acts == [], acts)
        check("no feed raised or warned", not raised, raised)

        # the ingest gate, armed on the Desk with test mode on, holds the hand-overs it held in the relay
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        lane["data"] = {"place": "", "built_at": now, "smart_gates": {C.INGEST_GATE: True},
                        "test_mode": {"on": True, "word": "on"}}
        C._LANE["at"] = 0.0
        held = await SF.people_sync({"rows": people})
        check("gate: peopleSyncFromPlatform held while armed and test mode on", held.get("status") == 409
              and held.get("held"), held)
        held = await SF.proposals_pass([{"id": "CP_a"}])
        check("gate: commProposalsIngest held", held.get("status") == 409 and held.get("held"), held)
        held = await C.service_door("hiring", "behaviorSignalsIngest", {"rows": []}, wait=SF.INGEST_WAIT_S)
        check("gate: behaviorSignalsIngest held through the service door", held.get("status") == 409, held)
        check("gate: nothing reached a door while held",
              not [a for a in asked if a[0] in ("peopleSyncFromPlatform", "commProposalsIngest",
                                                "behaviorSignalsIngest")], asked)

    asyncio.run(main())
except Exception as exc:  # noqa: BLE001
    import traceback
    out["crashed"] = traceback.format_exc()[-2000:]
    fails.append("crashed")
print(json.dumps({"checks": len(out), "failed": fails, "out": out}, indent=1, default=str))
sys.exit(1 if fails else 0)
