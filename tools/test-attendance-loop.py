"""The relay's PSI attendance loop in asa-hub-app (app/attendance_loop.py), on stand-ins: while the PsiAnywhere
credential is not mounted the login plan refuses every login and never writes its latch, the time clock touches none of
its files, and the beat runs only the passes that do not stand on its board; once mounted, every pass of the beat asks
its door in the relay's order and a collection read starts the full sheet; the attendance and call-off wakes are
answered in-process; the three PSI doors answer as the relay's did. The relay's source no longer starts or kicks any of
it, and its shift flow ledger follows the app's writes. Nothing touches PsiAnywhere, Google, a door or the relay.

From the repo root (the relay's source and its psi_reminders read here, the rest run inside asa-hub-db-sync by the
in-process runner; LIVE=1 also reads the roster and the call-off books off asa-hub-db, read-only):

    RUNNER=<scratchpad> python3 tools/test-attendance-loop.py
"""
import ast
import json
import os
import subprocess
import sys

if not os.environ.get("ATTENDANCE_TEST_INPROC"):
    import tempfile
    import time

    src = open("server/snapshot_service.py", encoding="utf-8").read()
    tree = ast.parse(src)
    defs = {n.name: n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}

    def called(fn: str) -> set[str]:
        return {c.func.id if isinstance(c.func, ast.Name) else f"{getattr(c.func.value, 'id', '')}.{c.func.attr}"
                for c in ast.walk(defs[fn]) if isinstance(c, ast.Call)
                and isinstance(c.func, (ast.Name, ast.Attribute))}

    def callers(name: str) -> set[str]:
        return {fn for fn in defs if name in called(fn)}

    fails = []
    start = called("_start")
    for gone in ("_psi_attendance_loop", "psi_attendance.prepare"):
        if gone in start:
            fails.append(f"the relay still starts {gone}")
    if "psi_reminders.FOLLOW_DISK" not in ast.get_source_segment(src, defs["_start"]):
        fails.append("the relay's shift flow ledger does not follow the app's writes")
    # only the loop no one starts (and its own full-sheet run) may still reach the moved work
    allowed = {"_psi_attendance_loop", "_psi_full_start", "_psi_full_run", "_psi_full_tick", "_calloff_road_post"}
    for name in ("_calloff_road_post", "_psi_full_start", "psi_attendance.tick", "psi_anywhere.verdict",
                 "psi_attendance.fill_consumers", "_shift_pool_sweep", "_psi_reminders_post", "_punch_pairs_post",
                 "_support_punch_post", "_recruit_book_post"):
        extra = callers(name) - allowed
        if extra:
            fails.append(f"the relay still calls {name} from {sorted(extra)}")
    for route in ("lane_psi_health", "psi_health", "lane_punch_warning_received", "lanes_told"):
        if route not in defs:
            fails.append(f"the relay lost its route {route}")
    if "_psi_app_verdict" not in called("_hotline_psi_verdict") or "_psi_app_verdict" not in called(
            "_psi_door_verdict"):
        fails.append("the relay's PSI verdicts are not asa-hub-app's")

    # the relay's ledger reader follows a file another process rewrites
    tmp = tempfile.mkdtemp(prefix="attendance-host-")
    os.environ["HUB_PSI_REMINDERS_STATE"] = tmp + "/reminders.json"
    with open(tmp + "/reminders.json", "w") as fh:
        json.dump({"phones": {"pk": {"key": "1"}}}, fh)
    sys.path.insert(0, os.path.abspath("server"))
    import psi_reminders as R  # noqa: E402
    R.FOLLOW_DISK[0] = True
    first = dict(R._load()["phones"])
    time.sleep(0.01)
    with open(tmp + "/reminders.json", "w") as fh:
        json.dump({"phones": {"pk": {"key": "2"}, "pk2": {"key": "3"}}}, fh)
    second = dict(R._load()["phones"])
    if first != {"pk": {"key": "1"}} or second != {"pk": {"key": "2"}, "pk2": {"key": "3"}}:
        fails.append(f"the relay's ledger reader did not follow the file ({first} then {second})")
    print(json.dumps({"relay_source": fails or "ok"}))
    runner = os.environ["RUNNER"]
    env = json.dumps({"ATTENDANCE_TEST_INPROC": "1", "FD_ROUTES": open("app/front_door_routes.json").read(),
                      "HUB_IST_CONFIG_DECLARATION_JSON": open("app/ist_config_defaults.json").read(),
                      "LIVE": os.environ.get("LIVE", "")})
    with open(os.path.join(runner, "test_attendance_loop.py"), "w") as fh:
        fh.write(open(__file__).read())
    with open(os.path.join(runner, "attendance_env.json"), "w") as fh:
        fh.write(env)
    rc = subprocess.call(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"),
                          os.path.join(runner, "test_attendance_loop.py"), "@" + os.path.join(runner,
                                                                                               "attendance_env.json")])
    sys.exit(1 if fails else rc)

import asyncio  # noqa: E402
import logging  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402

logging.disable(logging.CRITICAL)


class _App:
    def __init__(self, *a, **k):
        self.routes = {}

    def _route(self, method):
        def reg(path):
            def deco(f):
                self.routes[(method, path)] = f
                return f
            return deco
        return reg

    def __getattr__(self, name):
        if name in ("get", "post"):
            return self._route(name.upper())

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
WORK = tempfile.mkdtemp(prefix="attendance-test-")
with open(WORK + "/routes.json", "w") as fh:
    fh.write(os.environ["FD_ROUTES"])
NOW = time.time()
LATCH = {"at": 0.0, "rested_until": 0.0, "paused_until": 0.0, "paused_why": "", "account": "adm",
         "refused": {"word": "Not active", "at": NOW, "stamp": [1, 2]}, "refused_ty": None,
         "ty": {"day": "", "tries": 0, "attempts": 0, "last_at": 0.0, "last_answer": ""}, "down": None}
with open(WORK + "/clock.json", "w") as fh:
    json.dump(LATCH, fh)
os.environ.update(HUB_FRONT_DOOR_ROUTES=WORK + "/routes.json", HUB_APP_PACK_DIR=WORK, HUB_SNAPSHOT_OUT=WORK,
                  HUB_PSI_SECRET_FILE=WORK + "/adm.json", HUB_PSI_TY_SECRET_FILE=WORK + "/ty.json",
                  HUB_PSI_LOGIN_CLOCK_FILE=WORK + "/clock.json", HUB_PSI_ATTENDANCE_STATE=WORK + "/state.json",
                  HUB_PSI_PUNCH_BOARD=WORK + "/board.json", HUB_PSI_REMINDERS_STATE=WORK + "/reminders.json",
                  HUB_SERVICE_SECRET="attendance-secret")
LIVE = bool(os.environ.get("LIVE"))
if LIVE:
    OWNER = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
             f"password={os.environ['POSTGRES_PASSWORD']}")
    os.environ["HUB_DB_DSN"] = OWNER

out: dict = {}
fails: list = []


def check(name, cond, got=None):
    out[name] = "ok" if cond else {"FAILED": got}
    if not cond:
        fails.append(name)


def raw(path):
    try:
        with open(path, "rb") as fh:
            return fh.read()
    except FileNotFoundError:
        return None


class Req:
    def __init__(self, body=None, query=None, token=""):
        self._body = json.dumps(body).encode() if body is not None else b""
        self.query_params = dict(query or {})
        self.headers = {"authorization": f"Bearer {token}"} if token else {}

    async def body(self):
        return self._body

    async def json(self):
        return json.loads(self._body)


def env_of(resp):
    return json.loads(resp.body)


try:
    import lane_gate as LG
    import live_notify
    import psi_anywhere as PA
    import psi_attendance as PS
    import attendance_loop as AL
    import clocks
    import punch_pairs
    import calloff_road
    import open_shift_covered
    import psi_punches_full
    import psi_reminders
    import recruit_book
    import shift_handoff
    import shift_requests
    import time_off

    # ---- the login plan, held while the credential is not mounted
    latch = raw(WORK + "/clock.json")
    why = PA.unmounted()
    check("unmounted: says why", "not mounted" in why, why)
    ok, said = PA.login_would_allow()
    check("unmounted: no login is allowed, and the latch is not lifted", not ok and "not mounted" in said, said)
    ok, said = PA.login_claim("attendance")
    check("unmounted: no login slot is claimed", not ok, said)
    PA.mark_down("a test")
    PA.mark_up("a test")
    check("unmounted: the login clock is never written", raw(WORK + "/clock.json") == latch)
    check("unmounted: the refusal it holds stands in memory", (PA.login_snapshot().get("refused") or {}).get(
        "word") == "Not active", PA.login_snapshot())

    # ---- the time clock touches none of its files
    got = PS.tick("asa-hub-db")
    PS.prepare()
    check("unmounted: the time clock holds and says why", got.get("state") == "held" and "not mounted" in got["why"],
          got)
    check("unmounted: no waiting rows are offered", PS.pending(time.time()) is None)
    check("unmounted: no client is asked on the session", PS.fill_consumers().get("asked") == 0)
    check("unmounted: the lane's state is never written", raw(WORK + "/state.json") is None)

    # ---- the beat, with every pass and door stood in for
    seq: list = []
    doors: list = []
    told: list = []
    dirty: list = []

    def rec(tag, value=None):
        def fn(*a, **k):
            seq.append(tag)
            return value() if callable(value) else value
        return fn

    reminders_offers = []

    def reminder_pending(now_ts):
        seq.append("psi_reminders.pending")
        return reminders_offers.pop(0) if reminders_offers else None

    tick_said = {"state": "told", "read": True, "board": True}
    PS.tick = rec("tick", lambda: dict(tick_said))
    PS.fill_consumers = rec("fill_consumers", {})
    attendance_offers = []

    def attendance_pending(now_ts):
        seq.append("psi_attendance.pending")
        return attendance_offers.pop(0) if attendance_offers else None

    PS.pending = attendance_pending
    PS.posted = rec("psi_attendance.posted")
    PS.post_failed = rec("psi_attendance.post_failed")
    shift_handoff.complete_ready = rec("complete_ready", {"done": 1})
    shift_handoff.owed = rec("shift_handoff.owed", lambda: [{"id": "h1"}])
    shift_handoff.mark_said = rec("shift_handoff.mark_said", 1)
    time_off.settle = rec("time_off.settle", {})
    time_off.form_sync = rec("time_off.form_sync", {})
    time_off.owed = rec("time_off.owed", lambda: [{"id": "t1"}])
    time_off.mark_said = rec("time_off.mark_said", 1)
    shift_requests.sweep = rec("shift_requests.sweep", {"opened": 1})
    shift_requests.owed = rec("shift_requests.owed", lambda: [{"id": "s1"}])
    shift_requests.mark_said = rec("shift_requests.mark_said", 1)
    shift_requests.house_managers = rec("house_managers", {"by_code": {}})
    psi_reminders.pending = reminder_pending
    psi_reminders.posted = rec("psi_reminders.posted", {"told": 1})
    psi_reminders.post_failed = rec("psi_reminders.post_failed")
    punch_pairs.owed = rec("punch_pairs.owed", lambda: [{"id": "p1"}])
    punch_pairs.mark_said = rec("punch_pairs.mark_said", 1)
    punch_pairs.stale = lambda now: ""
    punch_pairs.first_faults = lambda: [{"id": "f1", "verdict": "missing", "shift_at": "2026-10-25T10:00"}]
    open_shift_covered.note_from_pool = rec("covered.note", 0)
    open_shift_covered.owed = rec("covered.owed", lambda: [{"id": "o1"}])
    open_shift_covered.mark = rec("covered.mark", 1)
    recruit_book.due_pass = lambda now: True
    recruit_book.sync = rec("recruit.sync", {"read": True, "changed": False})
    recruit_book.house_offer = rec("recruit.house_offer", [])
    recruit_book.pending = rec("recruit.pending", lambda: {"rows": [{"id": "rb1"}]})
    recruit_book.mark = rec("recruit.mark", {"told": 1})
    calloff_road.owed = rec("calloff.owed", lambda: [{"ref": "c1", "location": "ABD2704 Somewhere"}])
    calloff_road.payload = lambda r, manager: {"ref": r["ref"]}
    calloff_road.mark = rec("calloff.mark", {"told": 1, "owed": 0})
    psi_punches_full.next_pass = rec("full.next_pass", None)

    async def service_door(app_id, action, payload, wait=clocks.PACK_S):
        doors.append((app_id, action, [r.get("id") for r in payload.get("rows") or []]
                      or [r.get("id") for r in payload.get("late") or []], wait))
        return {"status": 200, "data": {"results": [], "told": 1}}

    async def one_pass(app_id, action, payload):
        doors.append((app_id, action, [r.get("id") or r.get("ref") for r in payload.get("rows") or []], None))
        return {"status": 200, "data": {"ok": True, "raised": 1, "left": [], "results": [], "rows": [{"ref": "c1"}]}}

    clocks.service_door = service_door
    clocks.one_pass = one_pass
    real_tell, real_tell_now, real_dirty = live_notify.tell, live_notify.tell_now, live_notify.dirty
    live_notify.tell = lambda resources=(), **said: told.append({"resources": list(resources), **said})
    live_notify.dirty = lambda names: dirty.append(sorted(names)) or list(names)

    async def settle():
        for _ in range(20):
            pending = [t for t in list(AL._TASKS) if not t.done()]
            if not pending:
                return
            await asyncio.wait(pending, timeout=5)

    async def main():
        AL._LOOP[0] = asyncio.get_running_loop()
        app = _App()
        AL.install(app)
        # held: the passes on the time clock's board wait, the rest run
        reminders_offers.append({"rows": [{"id": "r1"}], "ids": ["r1"]})
        attendance_offers.append({"late": [{"id": "a1"}], "no_call": [], "ids": ["a1"]})
        said = await AL.beat()
        await settle()
        asked = [d[1] for d in doors]
        check("held beat: the time clock is not read", "tick" not in seq and said.get("state") == "held", seq)
        check("held beat: transfers, time off, the pool's notices, covered shifts, the recruit book and the Builder's "
              "call-offs ask their doors",
              [(d[1], d[2]) for d in doors] == [("staffShiftReminder", ["h1"]), ("staffShiftReminder", ["t1"]),
                                               ("staffShiftReminder", ["s1"]), ("openShiftCovered", ["o1"]),
                                               ("recruitTell", ["rb1"]), ("callOffFromCalendar", ["c1"])], doors)
        check("held beat: the shift flow, the punch pairs, the missing punches, the attendance rows and the full sheet "
              "wait", not {"staffAttendancePunch", "supportDeskPunch", "psiPunchesFullIngest"} & set(asked)
              and "psi_reminders.pending" not in seq and "punch_pairs.owed" not in seq
              and "psi_attendance.pending" not in seq and "fill_consumers" not in seq, seq)
        check("held beat: the pool's sweep ran first and told the bell and the calendars",
              seq.index("complete_ready") < seq.index("shift_handoff.owed")
              and {"resources": [], "wake": ["notices"]} in told and {"resources": [], "events": ["housecal"]} in told,
              told)

        # mounted: every pass, in the relay's order
        with open(WORK + "/adm.json", "w") as fh:
            json.dump({"user": "u", "pass": "p"}, fh)
        del seq[:], doors[:], told[:], dirty[:]
        AL._PSI_FULL["at"] = 0.0
        said = await AL.beat()
        await settle()
        check("mounted beat: the time clock is read", seq[0] == "tick" and said.get("read") is True, seq)
        check("mounted beat: the punch board's slice follows, and the bell is woken",
              ["commPunchBoard"] in dirty and {"resources": [], "wake": ["notices"]} in told, (dirty, told))
        order = [(d[1], d[2]) for d in doors if d[1] != "psiPunchesFullIngest"]
        check("mounted beat: every door in the relay's order", order == [
            ("staffShiftReminder", ["r1"]), ("staffShiftReminder", ["h1"]), ("staffShiftReminder", ["t1"]),
            ("staffShiftReminder", ["p1"]), ("supportDeskPunch", ["f1"]), ("staffShiftReminder", ["s1"]),
            ("openShiftCovered", ["o1"]), ("recruitTell", ["rb1"]), ("callOffFromCalendar", ["c1"]),
            ("staffAttendancePunch", ["a1"])], order)
        check("mounted beat: the doors are Staff attendance's, Support Requests', Smart Comms' lanes and the "
              "call-off form's", {d[0] for d in doors} == {"staff-alerts", "support-punch", "open-shift-covered",
                                                          "comm-recruit", "comm-call-off-form"}, doors)
        check("mounted beat: the answers are written down", {"psi_reminders.posted", "shift_handoff.mark_said",
                                                             "time_off.mark_said", "punch_pairs.mark_said",
                                                             "shift_requests.mark_said", "covered.mark",
                                                             "recruit.mark", "calloff.mark",
                                                             "psi_attendance.posted"} <= set(seq), seq)
        check("mounted beat: a raised missing punch rings Support Requests",
              {"resources": [], "events": ["support-desk"]} in told, told)
        check("mounted beat: a collection read starts the full sheet on the lane's session",
              "fill_consumers" in seq and "full.next_pass" in seq, seq)
        n = len([d for d in doors if d[1] == "supportDeskPunch"])
        del doors[:]
        await AL.beat()
        await settle()
        check("mounted beat: the same faults are not offered twice",
              n == 1 and not [d for d in doors if d[1] == "supportDeskPunch"], doors)

        # the wakes the relay's /lanes/told took, answered here
        live_notify.tell, live_notify.dirty = real_tell, (lambda names: list(names))
        relayed: list = []
        live_notify.tell_now = lambda **said: relayed.append(said)
        before = PS._ROSTER_MOVED["at"]
        del seq[:]
        live_notify.tell(wake=["attendance", "notices", "calloff_road"], events=["housecal"])
        await asyncio.sleep(0.2)
        await settle()
        check("wakes: attendance and the call-off road are answered here, notices still reach the relay",
              relayed == [{"wake": ["notices"], "events": ["housecal"]}] and PS._ROSTER_MOVED["at"] > before
              and "calloff.owed" in seq, (relayed, seq))
        del relayed[:]
        live_notify.tell(wake=["attendance"])
        await asyncio.sleep(0.2)
        check("wakes: a wake answered here alone tells the relay nothing", relayed == [], relayed)
        live_notify.tell, live_notify.tell_now, live_notify.dirty = real_tell, real_tell_now, real_dirty

        # the doors
        check("installed: the three PSI doors", {("GET", "/hub-lanes/psi/health"), ("POST", "/psi/health"),
                                                 ("POST", "/hub-lanes/punch-warnings/received")} <= set(app.routes),
              sorted(app.routes))
        verdicts: list = []

        async def verdict(force=False):
            verdicts.append(force)
            return {"state": "up", "why": "the service answered in its own words"}

        PA.verdict = verdict

        async def no_session(token):
            return None

        LG.session = no_session
        got = env_of(await app.routes[("GET", "/hub-lanes/psi/health")](Req(query={"fresh": "1"})))
        check("psi/health: a closed gate is refused with its reason", got.get("status") == 401
              and got.get("reason") == "session" and not verdicts, got)

        async def gate(s, app_id, **kw):
            return ("admin", "u1") if app_id == "smartcomms" else {"status": 403}

        LG.gate = gate
        got = env_of(await app.routes[("GET", "/hub-lanes/psi/health")](Req(query={"fresh": "1"}, token="T")))
        check("psi/health: an open gate gets the verdict, fresh when asked",
              got.get("status") == 200 and got["data"]["state"] == "up" and verdicts == [True], got)
        got = env_of(await app.routes[("POST", "/psi/health")](Req({"service_secret": "wrong"})))
        check("POST psi/health: a wrong service secret is refused", got.get("status") == 401, got)
        got = env_of(await app.routes[("POST", "/psi/health")](Req({"service_secret": "attendance-secret"})))
        check("POST psi/health: the service gets the verdict", got.get("status") == 200 and verdicts[-1] is False,
              got)

        async def viewer(request):
            return {"name": "Dee Director", "is_master": False}, ("admin", "u1")

        async def lanes_run(fn, *a, **k):
            return fn(*a, **k)

        sys.modules["sched_lanes"] = types.SimpleNamespace(_requests_viewer=viewer, _run=lanes_run)
        door = app.routes[("POST", "/hub-lanes/punch-warnings/received")]
        got = env_of(await door(Req({"ref": "nope"})))
        check("received: a ref that is not a warning's is refused", got.get("status") == 400, got)

        def refused(dsn, **k):
            raise punch_pairs.Refused("only a director answers a punch warning", "not_a_director")

        punch_pairs.acknowledge = refused
        got = env_of(await door(Req({"ref": "pw0123456789"})))
        check("received: a refusal keeps its status and words", got.get("status") == 403
              and got.get("reason") == "not_a_director", got)
        acked: list = []

        def acknowledge(dsn, **k):
            acked.append(k)
            return {"ref": k["ref"], "state": "converted", "call_off_ref": "SP0123456789"}

        punch_pairs.acknowledge = acknowledge
        got = env_of(await door(Req({"ref": "PW0123456789"})))
        check("received: a director's RECEIVED is recorded with the pairs on hand",
              got.get("status") == 200 and got["data"]["state"] == "converted" and got["data"]["words"]
              and acked == [{"by": "Dee Director", "ref": "PW0123456789", "via": "hub", "master": False}],
              (got, acked))

    asyncio.run(main())

    # once mounted, the latch is the login plan's own again: a changed credential lifts the old refusal
    ok, said = PA.login_would_allow()
    written = json.loads(raw(WORK + "/clock.json"))
    check("mounted: the plan runs, and writes its own clock", ok and written.get("refused") is None, (said, written))
    PA._login_state["account"] = "ty"
    check("mounted: a clock naming the Ty line holds while Ty's file is not mounted", "Ty" in PA.unmounted(),
          PA.unmounted())

    if LIVE:
        import psycopg  # noqa: PLC0415
        import lanes_pg  # noqa: PLC0415
        from datetime import date, timedelta  # noqa: PLC0415

        RO = "-c default_transaction_read_only=on"
        lanes_pg.CONNECT["own"] = lanes_pg.CONNECT["spare"] = lambda: psycopg.connect(OWNER, autocommit=True,
                                                                                       options=RO)
        lanes_pg.CONNECT["intel"] = lambda: psycopg.connect(os.environ["MIRROR_DSN"], autocommit=True, options=RO)
        today = date.today()
        shifts, counts = PS.roster("asa-hub-db", today - timedelta(days=1), today + timedelta(days=1))
        check("live: the roster is read off the grids, houred starts found", len(shifts) > 0, dict(counts))
        offs, loose, fresh = PS.called_off("asa-hub-db", today - timedelta(days=1), today + timedelta(days=1))
        check("live: the call-off books are read off asa-hub-db", "tracker newest 20" in fresh, fresh)
        import daily_notes  # noqa: PLC0415
        notes = daily_notes.written_notes()
        check("live: the Daily Notes are read for rule 8", notes.get("ok") or notes.get("why"), notes.get("why"))
        out["live counts"] = {"shifts": len(shifts), "people with a call-off fact": len(offs),
                              "loose line call-offs": len(loose), "freshness": fresh,
                              "notes": len(notes.get("notes") or []), "notes ok": notes.get("ok")}
except Exception as exc:  # noqa: BLE001
    import traceback
    out["crashed"] = traceback.format_exc()[-2000:]
    fails.append("crashed")

print(json.dumps(out, indent=1, default=str))
print(json.dumps({"ok": len([v for v in out.values() if v == "ok"]), "failed": fails}))
sys.exit(1 if fails else 0)
