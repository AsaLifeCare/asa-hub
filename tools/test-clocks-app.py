"""The relay's clocks in asa-hub-app (app/clocks.py), on stand-ins: every pass of the fast and the staff beat asks its
doors in-process as the service, the ingest gate holds what it held, the Desk's Run is an admin's, the Quo webhook
keeps a messages-signed delivery (and wakes the app's own reply ear), answers a hotline-signed one here and refuses a
bad one, the hand-off drains the inbox and the pull rounds; and the relay's source no longer starts any of them, the
reply ear and the pharmacy sweep included. Nothing touches a database, Quo or the relay.

From the repo root (the relay's source read here, the rest run inside asa-hub-db-sync by the in-process runner):

    RUNNER=<scratchpad> python3 tools/test-clocks-app.py
"""
import ast
import json
import os
import subprocess
import sys

if not os.environ.get("CLOCKS_TEST_INPROC"):
    src = open("server/snapshot_service.py", encoding="utf-8").read()
    tree = ast.parse(src)
    defs = {n.name: n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}

    def called(fn: str) -> set[str]:
        return {c.func.id if isinstance(c.func, ast.Name) else f"{getattr(c.func.value, 'id', '')}.{c.func.attr}"
                for c in ast.walk(defs[fn]) if isinstance(c, ast.Call)
                and isinstance(c.func, (ast.Name, ast.Attribute))}

    fails = []
    start = called("_start")
    for gone in ("_fast_sweep_loop", "_quo_handoff_loop", "_quo_pull_loop", "quo_inbox.prepare", "_sms_ears_loop",
                 "_house_meds_loop"):
        if gone in start:
            fails.append(f"the relay still starts {gone}")
    moved = {"_backend_clock_pair", "_app_clock", "_broadcast_python_carry", "_letters_python_sweep",
             "_app_release_python_sweep", "_ist_python_sweep", "_recon_python_auto", "_comm_bindings_python_seed",
             "_hiring_python_clock", "_req_states_python_sweep", "_drive_intake_kick", "_potential_clients_sync",
             "_team_alerts_python_sweep", "_comm_calls_sweep_python", "_comm_replies_tick", "_contact_clock_python",
             "_comm_repair_tick", "_comm_record_tick", "_hotline_python_inbox", "_line_directory_handoff",
             "_contacts_handoff", "_behavior_handoff", "_comm_routes_handoff", "_psi_punches_tick", "_comm_when_tick",
             "_comm_proposals_due", "_comm_proposals_tick"}
    for twice in sorted(moved & called("_staff_sweep_loop")):
        fails.append(f"the relay's staff sweep still runs {twice}")
    if "quo_inbox.webhook_keys" in called("quo_webhook"):
        fails.append("the relay's webhook still keeps messages")
    if "live_notify_told" not in defs:
        fails.append("the relay has no /live-notify/told")
    print(json.dumps({"relay_source": fails or "ok"}))
    runner = os.environ["RUNNER"]
    env = json.dumps({"CLOCKS_TEST_INPROC": "1", "FD_ROUTES": open("app/front_door_routes.json").read()})
    with open(os.path.join(runner, "test_clocks_app.py"), "w") as fh:
        fh.write(open(__file__).read())
    rc = subprocess.call(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"),
                          os.path.join(runner, "test_clocks_app.py"), env])
    sys.exit(1 if fails else rc)

import asyncio  # noqa: E402
import base64  # noqa: E402
import hashlib  # noqa: E402
import hmac  # noqa: E402
import logging  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402

logging.disable(logging.CRITICAL)


class _App:
    def __init__(self, *a, **k):
        self.routes = {}

    def post(self, path):
        def deco(f):
            self.routes[path] = f
            return f
        return deco

    def __getattr__(self, name):
        def deco(*a, **k):
            return lambda f: f
        return deco


class _Resp:
    def __init__(self, content=None, status_code=200, media_type=None, headers=None):
        if isinstance(content, (dict, list)):
            content = json.dumps(content).encode()
        elif isinstance(content, str):
            content = content.encode()
        self.body, self.status_code, self.media_type = content or b"", status_code, media_type
        self.headers = dict(headers or {})


async def _threadpool(fn, *a, **k):
    return fn(*a, **k)


_fa = types.ModuleType("fastapi")
_fa.FastAPI, _fa.Request = _App, object
_fr = types.ModuleType("fastapi.responses")
_fr.JSONResponse = _fr.Response = _Resp
_sc = types.ModuleType("starlette.concurrency")
_sc.run_in_threadpool = _threadpool
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": _sc})
WORK = tempfile.mkdtemp(prefix="clocks-test-")
MSG_KEY = base64.b64encode(b"m" * 32).decode()
HOT_KEY = base64.b64encode(b"h" * 32).decode()
for name, key in (("messages.key", MSG_KEY), ("hotline.key", HOT_KEY), ("api.key", "quo-api-key")):
    with open(os.path.join(WORK, name), "w") as fh:
        fh.write(key)
with open(WORK + "/routes.json", "w") as fh:
    fh.write(os.environ["FD_ROUTES"])
os.environ.update(HUB_FRONT_DOOR_ROUTES=WORK + "/routes.json", HUB_APP_PACK_DIR=WORK, HUB_QUO_INBOX_DIR=WORK + "/inbox",
                  HUB_QUO_MESSAGES_KEY_FILE=WORK + "/messages.key", QUO_HOTLINE_WEBHOOK_KEY_FILE=WORK + "/hotline.key",
                  HUB_QUO_API_KEY_FILE=WORK + "/api.key", HUB_SERVICE_SECRET="")

out: dict = {}
fails: list = []


def check(name, cond, got=None):
    out[name] = "ok" if cond else {"FAILED": got}
    if not cond:
        fails.append(name)


try:
    import front_door as FD
    import live_notify
    import quo_inbox
    import quo_pull
    import clocks as C

    asked: list = []
    told: list = []
    voided: list = []
    lane: dict = {"data": None}

    class Door:
        """A door module: every look says something is due, every write lands."""

        def __init__(self, names):
            self.ACTIONS = {n: None for n in names}

    def answer(action, payload):
        if action == "configLane":
            return {"status": 200, "data": lane["data"]}
        if action == "quoIngestBatch":
            return {"status": 200, "data": {"results": [{"id": e["id"], "type": e["type"], "result": "filed"}
                                                         for e in payload["events"]]}}
        if action == "commsInboundFetch":
            return {"status": 200, "data": {"run": {"n": 1}}}
        if action == "smartClockDue":
            return {"status": 200, "data": {"plans": [{"p": 1}], "events": {}}}
        if action == "staffBroadcastHeld":
            return {"status": 200, "data": {"ids": ["B1"]}}
        if action in ("lettersDue", "teamAlertsDue"):
            return {"status": 200, "data": {"ready": True, "due": 1}}
        if action == "appReleaseDue":
            return {"status": 200, "data": {"pending": 1}}
        if action == "commBindingsSeedDue":
            return {"status": 200, "data": {"due": True, "plans": [1]}}
        if action == "commRepairDue":
            return {"status": 200, "data": {"due": "sweep"}}
        if action == "commRecordPlan":
            return {"status": 200, "data": {"due": True, "run": "r", "plans": [1]}}
        if action.endswith("Due") or action.endswith("Fetch") or action == "reconAutoSweep":
            return {"status": 200, "data": {"due": True, "items": [1]}}
        return {"status": 200, "data": {"done": True, "intents": 1}}

    # every door the moved passes ask, by app
    doors = {
        "hiring": [x for t in C.HIRING_CLOCK for x in t[:2]] + [x for t in C.HIRING_ACCOUNTS_CLOCK for x in t[:2]]
        + ["screenCollectDue", "screenCollectSweep", "hiringSimRetryDue", "hiringSimRetryNow",
           "talentPipelineDue", "talentPipelineSweep", "hiringSimPressRecord"],
        "staff-alerts": ["staffAttendanceDue", "staffAttendanceSweep", "staffAttendancePunch"],
        "smart-clock": ["smartClockDue", "smartClockSend"], "opt-outs": ["commsInboundFetch", "commsInboundKeep"],
        "scheduling": ["schedulingClockDue", "schedulingClockSweep"],
        "support-desk": ["supportDeskClockDue", "supportDeskClockSweep"],
        "transportation": ["vehicleCalendarClockDue", "vehicleCalendarClockSweep"],
        "broadcast": ["staffBroadcastHeld", "staffBroadcastCarry"], "letters": ["lettersDue", "lettersSweep"],
        "app-release": ["appReleaseDue", "appReleaseSweep"], "ist": ["istNoticeDue", "istNoticeSweep"],
        "time-recon": ["reconAutoSweep", "reconAutoRecord"], "compliance-engine": ["requirementStatesSweep"],
        "comm-bindings": ["commBindingsSeedDue", "commBindingsSeed"],
        "potential-clients": ["potentialClientsUpload"], "team-alerts": ["teamAlertsDue", "teamAlertsSweep"],
        "comm-calls": ["commCallsSweepFetch", "commCallsSweepKeep"],
        "comm-replies": ["commRepliesDue", "commRepliesKeep"],
        "comm-repair": ["commRepairDue", "commRepairSweep"], "comm-record": ["commRecordPlan", "commRecordKeep"],
        "settings-tools": ["contactSweepDue", "contactSweepRun"], "config-lane": ["configLane"],
        "quo": ["quoIngestBatch"],
        **{a: list(fk) for a, fk in C.DRIVE_INTAKE.items()},
        **{a: [lk, sw] for a, lk, sw in C.CLOCK_SWEEPS}}
    writes = {a: [d for d in ds if not (d.endswith("Due") or d.endswith("Fetch") or d in (
        "configLane", "reconAutoSweep", "commRecordPlan", "staffBroadcastHeld"))] for a, ds in doors.items()}

    def run(module, action, said, payload, at=0.0):
        asked.append(("read", action, said.get("is_service")))
        return _Resp(answer(action, payload))

    def run_write(deciding, action, said, payload, wid, at=0.0):
        asked.append(("write", action, said.get("is_service"), bool(wid)))
        return _Resp(answer(action, payload))

    M = types.SimpleNamespace(APPS={a: Door(ds) for a, ds in doors.items()},
                              WRITES={a: Door(ws) for a, ws in writes.items()}, _run=run, _run_write=run_write)
    app = _App()
    C.install(app, M)
    live_notify.told = lambda **k: told.append(k) or k
    live_notify.dirty = lambda names: told.append({"dirty": sorted(names)}) or list(names)
    FD.settle_void_soon = lambda app_id, wid: voided.append((app_id, wid))
    carried: list = []

    async def carry(request):
        carried.append(request)
        return _Resp(b'{"status":200}')

    import relay_carrier
    relay_carrier.carry = carry
    check("installed: the webhook route, the Desk's Run rung and the reply ear's wake answered here",
          "/quo/webhook" in app.routes and FD.RUNGS.get("smartCommsRun") is C.smart_comms_run
          and live_notify.LOCAL_WAKES.get("sms-ears") is C.sms_ears_wake_soon)

    async def settle():
        for _ in range(20):
            pending = [t for t in list(C._TASKS) if not t.done()]
            if not pending:
                return
            await asyncio.wait(pending, timeout=5)

    async def main():
        # the fast beat, once: every rider and turn it starts
        await C.fast_beat()
        C._SCREEN_COLLECT[0] = C.SCREEN_COLLECT_EVERY_TICKS - 1
        await C.fast_beat()
        await settle()
        fast = {a[1] for a in asked}
        need = {"onboardingUserDue", "onboardingUserSweep", "hiredGraduateDue", "smartClockDue", "smartClockSend",
                "commsInboundFetch", "commsInboundKeep", "schedulingClockDue", "schedulingClockSweep",
                "laneMirrorDue", "laneMirrorSweep", "dupScanDue", "dupScanSweep", "callOffFormDue",
                "callOffFormSweep", "screenCollectDue", "screenCollectSweep"}
        check("fast beat: every pass ticks in the app", need <= fast, sorted(need - fast))
        check("fast beat: asked as the service, every write with its id",
              all(a[2] is True for a in asked) and all(a[3] for a in asked if a[0] == "write"))
        check("fast beat: the candidates' packs read again", {"swept": ["staff-candidates"]} in told, told)
        # a turn already running is not started twice
        n = len(asked)
        await C.fast_beat()
        await settle()
        again = [a[1] for a in asked[n:]]
        check("fast beat: a turn inside its own wait is not asked again",
              "smartClockDue" not in again and "laneMirrorDue" not in again and "commsInboundFetch" not in again,
              again)

        # the staff beat, an hourly tick and a contact-clock tick
        del asked[:]
        await C.staff_beat(36)
        await C.staff_beat(2)
        await settle()
        staff = {a[1] for a in asked}
        need = ({"staffAttendanceDue", "staffAttendanceSweep", "supportDeskClockSweep", "vehicleCalendarClockSweep",
                 "staffBroadcastCarry", "lettersSweep", "appReleaseSweep", "istNoticeSweep", "reconAutoRecord",
                 "commBindingsSeed", "requirementStatesSweep", "potentialClientsUpload", "teamAlertsSweep",
                 "commCallsSweepKeep", "commRepliesKeep", "contactSweepRun", "talentPipelineSweep",
                 "commRepairSweep", "commRecordKeep", "hiringSimRetryNow"}
                | {x for t in C.HIRING_CLOCK for x in t[:2]} | {x for fk in C.DRIVE_INTAKE.values() for x in fk})
        check("staff beat: every moved pass ticks in the app", need <= staff, sorted(need - staff))
        check("staff beat: recon's pack, Smart Comms' pages and the call slices told",
              {"swept": ["time-recon"]} in told and {"rang": ["smartcomms"], "swept": ["smartcomms"]} in told
              and {"dirty": ["commCalls", "commWorkItems"]} in told, told)

        # the ingest gate: armed on the Desk with test mode on, the hand-off holds
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        lane["data"] = {"place": "", "built_at": now, "smart_gates": {C.INGEST_GATE: True},
                        "test_mode": {"on": True, "word": "on"}}
        C._LANE["at"] = 0.0
        held = await C.quo_ingest([{"id": "x", "type": "message.received"}])
        check("ingest gate: armed and test mode on holds quoIngestBatch", held.get("status") == 409 and held.get("held"),
              held)
        lane["data"] = {**lane["data"], "test_mode": {"on": False, "word": "off"}}
        C._LANE["at"] = 0.0

        # the webhook: messages-signed kept, hotline-signed carried, a bad one refused
        def signed(body: bytes, key: str, at_ms: int | None = None) -> str:
            stamp = str(at_ms if at_ms is not None else int(time.time() * 1000))
            mac = base64.b64encode(hmac.new(base64.b64decode(key), stamp.encode() + b"." + body,
                                            hashlib.sha256).digest()).decode()
            return f"hmac;1;{stamp};{mac}"

        class Req:
            def __init__(self, body, header):
                self._b, self.headers = body, {"openphone-signature": header}

            async def body(self):
                return self._b

        ev = json.dumps({"type": "message.received", "data": {"object": {"id": "AC1", "text": "yes"}}}).encode()
        told_before = len(told)
        C._SMS_EARS_WAKE.clear()
        got = await app.routes["/quo/webhook"](Req(ev, signed(ev, MSG_KEY)))
        check("webhook: a messages-signed delivery is kept, and the app's own reply ear woken",
              got.status_code == 200 and json.loads(got.body).get("kept") == "added"
              and C._SMS_EARS_WAKE.is_set() and not any("wake" in t for t in told[told_before:]),
              (got.status_code, got.body, told[told_before:]))
        got = await app.routes["/quo/webhook"](Req(ev, signed(ev, MSG_KEY)))
        check("webhook: the same delivery again is a duplicate", json.loads(got.body).get("kept") == "duplicate",
              got.body)
        got = await app.routes["/quo/webhook"](Req(ev, signed(ev, MSG_KEY, int(time.time() * 1000) - 900_000)))
        check("webhook: a stale stamp is refused", got.status_code == 401, (got.status_code, got.body))
        got = await app.routes["/quo/webhook"](Req(ev, signed(ev, base64.b64encode(b"z" * 32).decode())))
        check("webhook: a bad signature is refused in the relay's words",
              got.status_code == 401 and json.loads(got.body) == {"status": 401, "message": "Unverified."},
              (got.status_code, got.body))
        got = await app.routes["/quo/webhook"](Req(ev, signed(ev, HOT_KEY)))
        check("webhook: a hotline-signed delivery is answered here (no transcript, ignored), never carried",
              got.status_code == 200 and json.loads(got.body).get("ignored") == "type" and not carried,
              (got.body, carried))

        # the hand-off drains what the webhook kept, once
        del asked[:]
        posted = await C.quo_handoff_once()
        ingests = [a for a in asked if a[1] == "quoIngestBatch"]
        check("hand-off: the kept text handed to quoIngestBatch once and drained",
              posted and len(ingests) == 1 and quo_inbox.backlog() == 0, (posted, ingests, quo_inbox.backlog()))
        check("hand-off: nothing left to hand twice", await C.quo_handoff_once() is False)

        # the pull rounds against a stand-in Quo
        quo_pull._get = lambda path, params: {"data": [], "nextPageToken": ""}
        quo_pull.GAP_S = 0.0
        said = await C.quo_pull_round()
        check("pull: a round runs here", said.get("state") == "ok", said)

        # the Desk's Run: an admin's, refused to anyone else
        async def session(token):
            return FD.Session(ok=True, role="admin" if token == "A" else "staff", uid="u")
        FD.session = session
        raw = b"body=x"
        del asked[:]
        got = await C.smart_comms_run({"token": "S", "action": "smartCommsRun"}, raw, None)
        check("Desk's Run: refused to a staff session", json.loads(got.body).get("status") == 403 and not asked,
              got.body)
        got = await C.smart_comms_run({"token": "A", "action": "smartCommsRun"}, raw, None)
        check("Desk's Run: an admin's turn runs here", json.loads(got.body).get("status") == 200
              and {"smartClockDue", "smartClockSend"} <= {a[1] for a in asked}, got.body)

        # start and stop: the seven loops (the reply ear and the pharmacy sweep among them), then none
        loops = C.start()
        await asyncio.sleep(0)
        check("start: the seven loops run, the reply ear and the pharmacy sweep among them",
              len(loops) == 7 and all(not t.done() for t in loops)
              and {"sms_ears_loop", "house_meds_loop"} <= {t.get_coro().__name__ for t in loops})
        await C.stop()
        await asyncio.sleep(0)
        check("stop: every clock ended", all(t.done() for t in loops) and not C._TASKS)

    asyncio.run(main())
except Exception as exc:  # noqa: BLE001
    import traceback
    out["crashed"] = traceback.format_exc()[-1500:]
    fails.append("crashed")
print(json.dumps({"checks": len(out), "failed": fails, "out": out}, indent=1, default=str))
