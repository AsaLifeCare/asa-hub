"""The /gas rungs answered in asa-hub-app (app/gas_rungs.py) against the relay's own: each relay door function is lifted
out of server/snapshot_service.py (tools/emit-front-door-routes.py relay_namespace) and run beside the app's rung on
the same envelope, the same sessions and the same scripted Python; the answers must be the same bytes and Python must
be asked the same doors with the same identity and payloads, voids, landings and claims. The writes the front door
decides (the alerts config save, a candidate's record, IST's) are checked to reach it with what the relay hands them;
a candidate's paper still goes to the relay. Nothing touches a database, Google or the relay; with LIVE=1 the IST
roster is read once off asa-hub-db's kept house calendars (read-only).

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-gas-rungs.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("GAS_RUNGS_INPROC"):
    runner = os.environ["RUNNER"]
    for name in ("run.sh", "drv.py"):
        if not os.path.exists(os.path.join(runner, name)):
            subprocess.check_call(["cp", os.path.join("tools", "inprocess", name), runner])
    checked = subprocess.call([sys.executable, "tools/emit-front-door-routes.py", "--check"])
    env = {"GAS_RUNGS_INPROC": "1", "FD_ROUTES": open("app/front_door_routes.json").read(),
           "RELAY_SRC": open("server/snapshot_service.py").read(),
           "EMITTER_SRC": open("tools/emit-front-door-routes.py").read(),
           "OL_TABLES": open("app/other_lanes.json").read(), "LIVE_PLANE": open("app/live_plane.json").read(),
           "HUB_IST_CONFIG_DECLARATION_JSON": open("app/ist_config_defaults.json").read(),
           "LIVE": os.environ.get("LIVE", "")}
    with open(os.path.join(runner, "gas_rungs_env.json"), "w") as fh:
        json.dump(env, fh)
    with open(os.path.join(runner, "test_gas_rungs.py"), "w") as fh:
        fh.write(open(__file__).read())
    rc = subprocess.call(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"),
                          os.path.join(runner, "test_gas_rungs.py"), "@" + os.path.join(runner, "gas_rungs_env.json")])
    sys.exit(rc or (1 if checked else 0))

import asyncio  # noqa: E402
import logging  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402
import urllib.parse  # noqa: E402

logging.disable(logging.CRITICAL)


class _App:
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, name):
        return lambda *a, **k: (lambda f: f)


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
_fa.FastAPI, _fa.Request, _fa.Header = _App, object, (lambda *a, **k: None)
_fr = types.ModuleType("fastapi.responses")
_fr.JSONResponse = _fr.Response = _fr.StreamingResponse = _Resp
_sc = types.ModuleType("starlette.concurrency")
_sc.run_in_threadpool = _threadpool
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": _sc})
WORK = tempfile.mkdtemp(prefix="gas-rungs-")
with open(WORK + "/routes.json", "w") as fh:
    fh.write(os.environ["FD_ROUTES"])
os.environ.update(HUB_FRONT_DOOR_ROUTES=WORK + "/routes.json", HUB_APP_PACK_DIR=WORK, HUB_SERVICE_SECRET="")
ROUTES = json.loads(os.environ["FD_ROUTES"])
PLANE = json.loads(os.environ["LIVE_PLANE"])
OL = json.loads(os.environ["OL_TABLES"])

out: dict = {}
fails: list = []


def check(name, cond, got=None):
    out[name] = "ok" if cond else {"FAILED": got}
    if not cond:
        fails.append(name)


def norm(v):
    """A payload or identity as compared: keys sorted, the walk's timings dropped."""
    if isinstance(v, dict):
        return {k: norm(x) for k, x in sorted(v.items()) if k != "ms"}
    if isinstance(v, list):
        return [norm(x) for x in v]
    return v


def form(env):
    return urllib.parse.urlencode({"body": json.dumps(env)}).encode()


TOKENS = {"tok-staff": ("Staff", "U1", False, False), "tok-admin": ("admin", "U2", False, False),
          "tok-master": ("admin", "U0", True, False), "tok-worn": ("Staff", "U3", False, True)}


class Py:
    """asa-hub-app's doors as scripted: (app, door) or door → its answer (a callable of the payload, or None for a
    deferral); every ask kept, both halves alike."""

    def __init__(self):
        self.answers, self.stale, self.trace, self.tasks = {}, (False, False), [], []

    def reset(self, answers, stale=(False, False)):
        self.answers, self.stale, self.trace = answers, stale, []

    def answer(self, app_id, action, user, payload, wid):
        self.trace.append(("ask", app_id, action, norm(user), norm(payload), bool(wid)))
        got = self.answers.get((app_id, action), self.answers.get(action))
        if callable(got):
            got = got(payload)
        return None if got is None else json.loads(json.dumps(got))


PY = Py()

try:
    # ---- the relay's half, off its own source --------------------------------------------------------------------
    emit = types.ModuleType("emit")
    emit.__dict__["__file__"] = "/repo/tools/emit-front-door-routes.py"
    exec(compile(os.environ["EMITTER_SRC"], "emit", "exec"), emit.__dict__)  # noqa: S102 - the repo's own tool
    _tree, R = emit.relay_namespace(os.environ["RELAY_SRC"])

    class RResp:
        def __init__(self, content=b"", media_type="", status_code=200, headers=None):
            self.body = content.encode() if isinstance(content, str) else content
            self.status_code = status_code

    async def r_session_actor(authorization):
        token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
        got = TOKENS.get(token)
        R["_SESSION_ACTING"].set(bool(got and got[3]))
        return (got[0], got[1]) if got else None

    async def r_master(authorization):
        got = TOKENS.get(authorization[7:].strip())
        return bool(got and got[2] and got[0] == "admin" and not got[3]), ""

    async def r_call(app_id, action, payload, user, extra=None, timeout=None):
        got = PY.answer(app_id, action, R["_acting_user"](user), payload, (extra or {}).get("write_id") or "")
        if got is None:
            R["_BACKEND_UNANSWERED"].set("it deferred 503: scripted")
            return None
        return json.dumps(got).encode(), 1000.0, got, None, 0.0

    async def r_settle(app_id, wid, state, why="", fields=None):
        PY.trace.append(("settle", app_id, state))
        return True

    async def r_rows(fresh=False):
        return {a: {"backend": "python", "set_by": "", "set_at": ""} for a in R["BACKEND_APPS"]}

    async def r_wanted(app_id):
        return True

    LANES = {"rpcAbilities": {"lane": "read"}, "resolverAudit": {"lane": "read"}, "staffPerfNoteAdd": {"lane": "write"}}
    TRAFFIC = {"window_s": 9, "slice_reads": 3, "by_action": {"x": 1}}
    R.update(Response=RResp, log=logging.getLogger("relay"), asyncio=asyncio, HUB_APP_TOKEN="t",
             _session_actor=r_session_actor, _app_pack_master=r_master, _backend_call=r_call,
             _backend_settle=r_settle, _backend_wanted=r_wanted, _backend_rows=r_rows,
             _backend_settle_soon=lambda app_id, wid, state, *a, **k: PY.trace.append(("settle", app_id, state)),
             _backend_written_after=lambda app_id, key, as_of, held=None, *, any_key=False, pack="", edits_at=0.0:
             PY.stale[1] if any_key else PY.stale[0],
             _backend_final_landed=lambda action, raw, content: PY.trace.append(("landed", action,
                                                                                 norm(json.loads(content)))),
             _app_control_landed=lambda action, raw, content: PY.trace.append(("app-control", action)),
             _traffic_note=lambda key: None, _backend_people_extra=lambda: {},
             _keep_task=lambda coro: PY.tasks.append(asyncio.ensure_future(coro)),
             _edit_overlay_config_seen=lambda *a: None, _resolver_table=lambda: LANES,
             _traffic_snapshot=lambda: dict(TRAFFIC))
    R["_acting"]["tok-worn"] = (time.time() + 600.0,)

    # ---- the app's half, on stand-ins ----------------------------------------------------------------------------
    import front_door as FD
    import live_finish as LF

    class Every:
        def __contains__(self, name):
            return True

    class Door:
        def __init__(self, app_id, actions):
            self.app_id, self.ACTIONS = app_id, actions

    WRITE_PRESS = next((a for a, (d, f) in sorted(PLANE["write_prepare"].items())
                        if ROUTES["writes"].get(a) == "hiring" and not f), "")
    READ_PRESS = sorted(next(r["reads"] for r in OL["backends"] if r["id"] == "hiring"))[0]
    writes_of = {"editions": {"editionsSet", "myWorkHidesSet"},
                 "performance": set(R["PERFORMANCE_WRITES"]) | {"staffPerfAiKeep"},
                 "forms": {"formImportGoogle", "formPublicSubmit", "formPublicFileStore"},
                 "hiring": set(R["HIRING_PUBLIC_WRITES"]) | {"hiringWalkRun", WRITE_PRESS}}

    def m_run(module, action, said, payload, at=0.0):
        got = PY.answer(module.app_id, action, said, payload, "")
        return _Resp({"defer": "scripted"}, 503) if got is None else _Resp(got, headers={"X-Hub-As-Of": "1000.000"})

    def m_run_write(deciding, action, said, payload, wid, at=0.0):
        got = PY.answer(deciding.app_id, action, said, payload, wid)
        return _Resp({"defer": "scripted"}, 503) if got is None else _Resp(got, headers={"X-Hub-As-Of": "1000.000"})

    public_by_app = {"forms": {"formPublicGet", "formPublicFileSession", "formPublicSubmit", "formPublicSubmitPrepare",
                               "formPublicFileStore", "formPublicFileStorePrepare"},
                     "hiring": set(R["HIRING_PUBLIC_ACTIONS"]) | {"referralSubmitPrepare"}}

    class Apps(dict):
        def get(self, app_id, default=None):
            return Door(app_id, Every())

    class Writes(dict):
        def get(self, app_id, default=None):
            return Door(app_id, writes_of.get(app_id, set()))

    M = types.SimpleNamespace(APPS=Apps(), WRITES=Writes(), _run=m_run, _run_write=m_run_write,
                              PUBLIC_DOORS=frozenset().union(*public_by_app.values()),
                              PUBLIC_DOORS_BY_APP=public_by_app)
    FD.M = M

    async def fd_session(token):
        got = TOKENS.get(token)
        if token == "tok-ended":
            return FD.Session(ok=False)
        if got is None:
            return None
        return FD.Session(ok=True, role=got[0], uid=got[1], is_master=got[2] and not got[3], acting=got[3],
                          worn="Someone" if got[3] else "", until=time.time() + 600 if got[3] else 0.0)

    FD.session = fd_session
    carried: list = []
    FD.CARRIED = lambda action, raw, content: carried.append(action)
    FD.settle_void_soon = lambda app_id, wid: PY.trace.append(("settle", app_id, "void"))
    LF.FD = FD
    LF.TABLES.update(PLANE)
    LF.SLICES = types.SimpleNamespace(PHASE={"phase": "live"}, traffic_note=lambda key: None)
    LF.written_after = lambda app_id, key, as_of, held=None, *, any_key=False, pack="", edits_at=0.0: \
        PY.stale[1] if any_key else PY.stale[0]
    LF.settle_void = lambda app_id, wid: PY.trace.append(("settle", app_id, "void")) or True
    LF.final_landed = lambda action, raw, content: PY.trace.append(("landed", action, norm(json.loads(content))))
    LF.app_control_landed = lambda action, raw, content: PY.trace.append(("app-control", action))
    LF.keep_task = lambda coro: PY.tasks.append(asyncio.ensure_future(coro))
    LF.resolver_table = lambda: LANES
    sys.modules["live_slices"] = types.SimpleNamespace(
        SLICE_DOORS={k: (str(v[0]), str(v[1])) for k, v in PLANE["slice_doors"].items()},
        traffic_snapshot=lambda: dict(TRAFFIC))
    sys.modules["other_lanes"] = types.SimpleNamespace(BACKENDS=OL["backends"])
    import gas_rungs as GR

    GR.install()
    PORTED = sorted(GR.rungs())
    out["presses"] = {"read": READ_PRESS, "write": WRITE_PRESS}
    check("installed: every rung on the front door, routed as a rung",
          all(a in FD.RUNGS and FD.route({"action": a}, form({"action": a}))[0] == "rung" for a in PORTED)
          and len(PORTED) == 46, [a for a in PORTED if a not in FD.RUNGS])
    check("the relay keeps every one of these rungs (no route is deleted)",
          set(PORTED) <= set(ROUTES["relay_first"]) | set(ROUTES["relay_shaped"]))

    RELAY_OF = {**{a: lambda a, r: R["_editions_python"](a, r) for a in R["EDITIONS_PYTHON_ACTIONS"]},
                **{a: lambda a, r: R["_performance"](a, r) for a in R["PERFORMANCE_ACTIONS"]},
                "locationDocsWhere": lambda a, r: R["_location_meds"](a, r),
                **{a: lambda a, r: R["_staff_audited"](a, r) for a in R["STAFF_AUDITED_ACTIONS"]},
                **{a: lambda a, r: R["_settings_tools"](a, R["_settings_tools_door"](a, r), r)
                   for a in ("rpcAbilities", "resolverAudit", "resolverHealth", "masterOverview")},
                **{a: lambda a, r: R["_python_tool_door"](a, r) for a in ("formImportGoogle", "hiringWalkRun")},
                **{a: lambda a, r: R["_public_door"](a, r) for a in R["PUBLIC_DOOR_APPS"]}}

    async def both(name, env, answers, stale=(False, False), raw=None):
        """One envelope through the relay's door and the app's rung: the same bytes, the same asks."""
        raw = raw if raw is not None else form(env)
        action = env.get("action")
        PY.reset(answers, stale)
        relay_resp = await asyncio.create_task(RELAY_OF[action](action, R["_relay_form"](raw)))
        await asyncio.gather(*PY.tasks)
        relay_trace, PY.tasks = PY.trace, []
        PY.reset(answers, stale)
        got, _json = FD.read_envelope(raw)
        app_resp = await asyncio.create_task(FD.RUNGS[action](got, raw, None))
        await asyncio.gather(*PY.tasks)
        app_trace, PY.tasks = PY.trace, []
        check(name, relay_resp.body == app_resp.body and relay_trace == app_trace,
              {"relay": relay_resp.body.decode()[:300], "app": app_resp.body.decode()[:300],
               "relay_asks": relay_trace[:6], "app_asks": app_trace[:6]})
        return app_resp

    def W(answer, final=True, **plan):
        return {**answer, "_write": {"final": final, "house": "", **plan}}

    OK = {"status": 200, "data": {"done": True}}
    big = "x" * 120_000

    async def main():
        # Settings › Editions, a person's own, My Work's switches
        mine = {"status": 200, "data": {"editions": ["clients.family", "staff.notes"]}}
        await both("editions: no session is 401", {"action": "editionsGet"}, {})
        await both("editions: an ended session is 401", {"action": "editionsGet", "token": "tok-ended"}, {})
        await both("editions: a visit makes none", {"action": "editionsMine", "token": "tok-staff", "member": "M9"},
                   {})
        await both("editions: away from home, an admin's Get is unknown",
                   {"action": "editionsGet", "token": "tok-admin", "world": "W1"}, {})
        await both("editions: away from home, the master's Mine is asked",
                   {"action": "editionsMine", "token": "tok-master", "tenant": "T1"}, {"editionsMine": mine})
        await both("editions: Mine with an edition Python alone makes",
                   {"action": "editionsMine", "token": "tok-staff", "payload": {"app": "clients"}},
                   {"editionsMine": mine})
        await both("editions: Get for the master", {"action": "editionsGet", "token": "tok-master"},
                   {"editionsGet": {"status": 200, "data": {"editions": {"a": 1}}}})
        await both("editions: Set kept under its own id", {"action": "editionsSet", "token": "tok-master",
                                                           "write_id": "Wsetset01", "payload": {"editions": []}},
                   {"editionsSet": W({"status": 200, "data": {"editions": []}})})
        await both("editions: Set not answered is 503 and voided",
                   {"action": "editionsSet", "token": "tok-master", "write_id": "Wsetset02"}, {})
        await both("my work: Hides Mine for a switched session", {"action": "myWorkHidesMine", "token": "tok-worn"},
                   {"myWorkHidesMine": {"status": 200, "data": {"add_apps": False}}})
        await both("my work: Hides Get not read is its words", {"action": "myWorkHidesGet", "token": "tok-master"}, {})
        await both("my work: Hides Set refused in Python's words",
                   {"action": "myWorkHidesSet", "token": "tok-admin", "write_id": "Whides0001", "payload": {"k": 1}},
                   {"myWorkHidesSet": {"status": 403, "message": "No."}})
        await both("editions: an envelope past the reader is 400",
                   {"action": "editionsGet", "token": "tok-master", "payload": {"x": big}}, {})
        # Staff Performance
        await both("performance: away is its 409", {"action": "perfBoard", "token": "tok-admin", "world": "W"}, {})
        await both("performance: a read", {"action": "perfBoard", "token": "tok-admin", "payload": {"q": 1}},
                   {"perfBoard": {"status": 200, "data": {"rows": [1, 2]}}})
        await both("performance: a write kept", {"action": "staffPerfNoteAdd", "token": "tok-admin",
                                                 "write_id": "Wnote00001", "payload": {"note": "n"}},
                   {"staffPerfNoteAdd": W(OK)})
        await both("performance: a write not answered is voided",
                   {"action": "perfReviewSave", "token": "tok-admin", "write_id": "Wrev000001"}, {})
        await both("performance: the evaluation's paragraph kept by its own write",
                   {"action": "staffPerfEvaluate", "token": "tok-master", "payload": {"id": "E1"}},
                   {"staffPerfEvaluate": {"status": 200, "data": {"text": "t"}, "_keep": {"id": "E1", "p": "t"}},
                    "staffPerfAiKeep": W(OK)})
        await both("performance: a read not answered", {"action": "staffPerfList", "token": "tok-worn"}, {})
        # a house's documents, Staff's audited reads
        await both("location docs: where", {"action": "locationDocsWhere", "token": "tok-staff",
                                            "payload": {"house": "AB"}},
                   {("locations", "locationDocsWhere"): {"status": 200, "data": {"where": "x"}}})
        await both("location docs: away", {"action": "locationDocsWhere", "token": "tok-staff", "member": "M"}, {})
        await both("location docs: not answered", {"action": "locationDocsWhere", "token": "tok-staff"}, {})
        await both("staff: HR Admin", {"action": "staffProfileHr", "token": "tok-admin", "payload": {"id": "P"}},
                   {("staff", "staffProfileHr"): {"status": 200, "data": {"hr": 1}}})
        await both("staff: Performance for a switched session leaves no line",
                   {"action": "staffProfilePerformance", "token": "tok-worn", "payload": {"id": "P"}},
                   {("staff", "staffProfilePerformance"): OK})
        # Settings' platform health and the master's overview
        await both("settings: rpcAbilities", {"action": "rpcAbilities", "token": "tok-admin"},
                   {("resolver", "rpcAbilities"): {"status": 200, "data": {"send": True}}})
        await both("settings: resolverAudit handed the maps", {"action": "resolverAudit", "token": "tok-admin"},
                   {("resolver", "resolverAudit"): {"status": 200, "data": {"routes": 1}}})
        await both("settings: resolverHealth handed the maps", {"action": "resolverHealth", "token": "tok-master"},
                   {("resolver", "resolverHealth"): {"status": 200, "data": {"health": {}}}})
        await both("settings: masterOverview", {"action": "masterOverview", "token": "tok-master"},
                   {("master-overview", "masterOverview"): {"status": 200, "data": {"ok": 1}}})
        await both("settings: masterOverview on a visit is unknown",
                   {"action": "masterOverview", "token": "tok-master", "member": "M"}, {})
        await both("settings: away from home is unknown", {"action": "rpcAbilities", "token": "tok-admin",
                                                           "tenant": "T"}, {})
        await both("settings: in a world", {"action": "resolverAudit", "token": "tok-admin", "world": "W"}, {})
        await both("settings: not answered", {"action": "rpcAbilities", "token": "tok-admin"}, {})
        # a Google Form's import and the hiring walk
        await both("form import: prepared, then kept and landed",
                   {"action": "formImportGoogle", "token": "tok-admin", "write_id": "Wform00001",
                    "payload": {"url": "u", "prepared": "never the browser's"}},
                   {"formImportGooglePrepare": {"status": 200, "data": {"form": {"t": 1}}},
                    "formImportGoogle": W({"status": 200, "data": {"slug": "s"}})})
        await both("form import: the prepare's refusal",
                   {"action": "formImportGoogle", "token": "tok-admin", "payload": {"url": "u"}},
                   {"formImportGooglePrepare": {"status": 400, "message": "no", "extra": 1}})
        await both("form import: the prepare not answered", {"action": "formImportGoogle", "token": "tok-admin"}, {})
        await both("form import: the write not answered",
                   {"action": "formImportGoogle", "token": "tok-admin", "write_id": "Wform00002"},
                   {"formImportGooglePrepare": {"status": 200, "data": {}}})
        await both("form import: away", {"action": "formImportGoogle", "token": "tok-admin", "tenant": "T"}, {})

        def nxt(payload):
            n = int(((payload.get("walk") or {}).get("n")) or 0)
            if n == 0:
                return {"status": 200, "data": {"walk": {"n": 1}, "press": {"action": READ_PRESS, "payload": {"q": 1}}}}
            if n == 1:
                return {"status": 200, "data": {"walk": {"n": 2},
                                                "press": {"action": WRITE_PRESS, "payload": {"w": 1}}}}
            return {"status": 200, "data": {"walk": {"n": 3}, "out": {"walked": 2}, "report": True}}

        prep = PLANE["write_prepare"].get(WRITE_PRESS, [""])[0]
        walk_answers = {"hiringWalkNext": nxt, READ_PRESS: {"status": 200, "data": {"r": 1}},
                        WRITE_PRESS: W(OK), "hiringWalkRun": W({"status": 200, "data": {"reported_to": "D"}})}
        if prep:
            walk_answers[prep] = {"status": 200, "data": {"p": 1}}
        await both("hiring walk: a read press, a prepared write press, the report",
                   {"action": "hiringWalkRun", "token": "tok-master", "payload": {"walk": "never the browser's"}},
                   walk_answers)
        await both("hiring walk: the report not raised",
                   {"action": "hiringWalkRun", "token": "tok-master"}, {**walk_answers, "hiringWalkRun": None})
        await both("hiring walk: not answered", {"action": "hiringWalkRun", "token": "tok-master"}, {})
        # the public forms and the hiring links
        await both("public: a form read", {"action": "formPublicGet", "payload": {"slug": "s", "t": "k"}},
                   {"formPublicGet": {"status": 200, "data": {"form": 1}}})
        await both("public: a read on an older copy is 503", {"action": "formPublicGet"},
                   {"formPublicGet": OK}, stale=(True, False))
        await both("public: a submit prepared, kept final, its files claimed",
                   {"action": "formPublicSubmit", "write_id": "Wpub000001", "payload": {"a": 1}},
                   {"formPublicSubmitPrepare": {"status": 200, "data": {"files": 1}},
                    "formPublicSubmit": {**W(OK), "_after": {"files": ["f1"]}}, "formPublicFilesClaim": OK})
        await both("public: the prepare's own refusal", {"action": "formPublicSubmit", "payload": {"a": 1}},
                   {"formPublicSubmitPrepare": {"status": 429, "message": "slow down"}})
        await both("public: a final write decided on an older copy is taken back",
                   {"action": "formPublicSubmit", "write_id": "Wpub000002"},
                   {"formPublicSubmitPrepare": {"status": 200, "data": {}}, "formPublicSubmit": W(OK)},
                   stale=(False, True))
        await both("public: a replay is answered as kept",
                   {"action": "interviewSlotSubmit", "write_id": "Wpub000003", "payload": {"slot": 1}},
                   {"interviewSlotSubmit": W(OK, replay=True)})
        await both("public: a refusal keeps nothing", {"action": "candFormSubmit", "payload": {}},
                   {"candFormSubmit": {"status": 400, "message": "bad link"}})
        await both("public: a plan these doors never make", {"action": "interviewDaysSubmit"},
                   {"interviewDaysSubmit": W(OK, final=False)})
        await both("public: not answered is voided and 503", {"action": "interviewSlotsSubmit"}, {})
        await both("public: a file read whole, kept by its prepare",
                   {"action": "formPublicFileStore", "payload": {"base64": big}},
                   {"formPublicFileStorePrepare": {"status": 200, "data": {"id": "F"}}, "formPublicFileStore": W(OK)})
        await both("public: a referral's file read whole",
                   {"action": "referralSubmit", "payload": {"file_base64": big, "n": "x"}},
                   {"referralSubmitPrepare": {"status": 200, "data": {"id": "R"}}, "referralSubmit": W(OK)})
        await both("public: past the reader on a door not read whole",
                   {"action": "interviewSlotContext", "payload": {"x": big}}, {})
        await both("public: a link's context", {"action": "candFormContext", "payload": {"k": 1}},
                   {"candFormContext": {"status": 200, "data": {"c": 1}}})
        await both("public: a raw JSON envelope reads as its form", {"action": "interviewSlotContext"},
                   {"interviewSlotContext": OK}, raw=json.dumps({"action": "interviewSlotContext"}).encode())
        check("observed: every rung's answer kept this app's state as a carried one did",
              {"editionsSet", "perfBoard", "formPublicSubmit", "hiringWalkRun", "rpcAbilities"} <= set(carried),
              sorted(set(carried)))

        # the writes the front door decides, and IST's handed doors
        asked: list = []

        async def fd_write(door, app_id, env, raw, s):
            asked.append(("write", door, app_id, env, FD.read_envelope(raw)[0], s))
            return _Resp(b'{"status": 200}')

        async def fd_read(door, app_id, env, raw, s):
            asked.append(("read", door, app_id, env, FD.read_envelope(raw)[0], s))
            return _Resp(b'{"status": 200}')

        async def fd_proxy(raw, request, action="", env=None):
            asked.append(("relay", action))
            return _Resp(b'{"status": 200}')

        FD.write, FD.read, FD.proxy = fd_write, fd_read, fd_proxy
        envs = {"cfg": {"action": "hiringAlertsSet", "token": "tok-admin", "payload": {"values": {"mywork_editions":
                                                                                                   "[]"}}}}
        got = await FD.RUNGS["hiringAlertsSet"](envs["cfg"], form(envs["cfg"]), None)
        check("alerts config: the editions list refused in the relay's words",
              got.body == json.dumps(R["EDITIONS_CONFIG_REFUSED"]).encode()
              and R["_editions_in_config_save"](form(envs["cfg"])) is True and not asked, got.body)
        env = {"action": "hiringAlertsSet", "token": "tok-admin", "payload": {"values": {"a": "1"}}}
        await FD.RUNGS["hiringAlertsSet"](env, form(env), None)
        check("alerts config: any other value Python's final write",
              asked and asked[-1][:3] == ("write", "hiringAlertsSet", "alerts-config"), asked[-1:])
        paper = {"action": "candidateProfileDoor", "token": "tok-admin",
                 "payload": {"candidate": "C", "press": "upload", "fields": {"base64": "QQ=="}}}
        await FD.RUNGS["candidateProfileDoor"](paper, form(paper), None)
        check("candidate: a paper still goes to the relay",
              asked[-1] == ("relay", "candidateProfileDoor")
              and R["_candidate_paper_env"](form(paper)) is not None)
        note = {"action": "candidateProfileDoor", "token": "tok-admin", "payload": {"candidate": "C", "press": "note"}}
        await FD.RUNGS["candidateProfileDoor"](note, form(note), None)
        check("candidate: any other press Python's final write",
              asked[-1][:3] == ("write", "candidateProfileDoor", "candidates")
              and R["_candidate_paper_env"](form(note)) is None, asked[-1][:3])
        roster = [{"house": "AB", "staff": "Ann", "first": "2026-10-01", "last": "2026-10-20"}]
        GR.ist_roster_read, live_read = (lambda: roster), GR.ist_roster_read
        GR._IST_ROSTER.update(at=0.0, rows=None)
        import ist_config

        for action in ("istConfigGet", "istHouseState"):
            env = {"action": action, "token": "tok-admin", "payload": {"house": "AB"}}
            await FD.RUNGS[action](env, form(env), None)
            kind, door, app_id, handed, sent, _s = asked[-1]
            want = {"house": "AB", **({"roster": roster} if action == "istHouseState" else {}),
                    **({"declaration": ist_config.DECLARATION} if action == "istConfigGet" else {})}
            check(f"ist: {action} is the front door's read, handed what the relay handed",
                  (kind, door, app_id) == ("read", action, "ist") and handed["payload"] == want
                  and sent["payload"] == {"house": "AB"}, (kind, door, app_id, sorted(handed["payload"])))
        n = len(asked)
        got = await FD.RUNGS["istHouseState"]({"action": "istHouseState"}, form({"action": "istHouseState"}), None)
        check("ist: no session is the read's own 401",
              len(asked) == n and got.body == json.dumps(FD.AUTH_ENDED).encode(), got.body)
        env = {"action": "istRebuild", "token": "tok-admin", "payload": {}}
        await FD.RUNGS["istRebuild"](env, form(env), None)
        kind, door, app_id, handed, sent, _s = asked[-1]
        check("ist: istRebuild stamped first, the finish's envelope without the roster",
              (kind, door, app_id) == ("write", "istRebuild", "ist") and handed["payload"] == {"roster": roster}
              and FD.WRITE_ID.fullmatch(handed["write_id"]) and sent.get("write_id") == handed["write_id"]
              and sent["payload"] == {}, (kind, door, sorted(handed), sorted(sent)))
        env = {"action": "istConfigSet", "token": "tok-admin", "write_id": "bad id!", "payload": {"k": "v"}}
        await FD.RUNGS["istConfigSet"](env, form(env), None)
        check("ist: an unusable write id is the write's own refusal, handed nothing",
              asked[-1][3] == env, asked[-1][3])
        env = {"action": "istConfigSet", "token": "tok-admin", "write_id": "Wistcfg01", "payload": {"k": "v"}}
        await FD.RUNGS["istConfigSet"](env, form(env), None)
        check("ist: istConfigSet handed the declaration",
              asked[-1][3]["payload"] == {"k": "v", "declaration": ist_config.DECLARATION})
        if os.environ.get("LIVE"):
            import lanes_pg
            import psycopg

            owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} "
                     f"user={os.environ['POSTGRES_USER']} password={os.environ['POSTGRES_PASSWORD']}")
            os.environ["HUB_DB_DSN"] = owner
            ro = "-c default_transaction_read_only=on"
            lanes_pg.CONNECT["own"] = lanes_pg.CONNECT["spare"] = lambda: psycopg.connect(owner, autocommit=True,
                                                                                         options=ro)
            lanes_pg.CONNECT["intel"] = lambda: psycopg.connect(os.environ["MIRROR_DSN"], autocommit=True, options=ro)
            started = time.time()
            rows = live_read()
            houses = sorted({r["house"] for r in rows})
            check("live: the IST roster read off asa-hub-db's kept house calendars",
                  bool(rows) and all(r["first"] <= r["last"] for r in rows),
                  {"pairs": len(rows), "houses": len(houses)})
            out["live roster"] = {"pairs": len(rows), "houses": len(houses), "first": min(r["first"] for r in rows),
                                  "last": max(r["last"] for r in rows), "s": round(time.time() - started, 1)}
            import hubdb
            import ist as IST
            import locations as L

            mapped = set(IST.house_map(L.Reads(hubdb.shared())))
            out["live ist map"] = {"mapped": len(mapped), "rostered": len(mapped & set(houses)),
                                   "mapped, nobody rostered": sorted(mapped - set(houses)),
                                   "rostered, not mapped": sorted(set(houses) - mapped)}
            check("live: the roster's house codes are the IST map's", bool(mapped & set(houses)), out["live ist map"])

    asyncio.run(main())
except Exception as exc:  # noqa: BLE001 - the test's own failure
    import traceback

    out["crashed"] = traceback.format_exc()[-2500:]
    fails.append("crashed")

ok = sum(1 for v in out.values() if v == "ok")
print(json.dumps(out, indent=1, default=str))
print(f"{ok} ok, {len(fails)} failed" + (f": {fails}" if fails else ""))
sys.exit(1 if fails else 0)
