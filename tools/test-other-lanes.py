"""asa-hub-app's copies of the relay's other /hub-lanes doors (app/other_lanes.py, app/my_lanes.py, app/lane_gate.py)
run in-process with the app's own modules: each door's happy path and one refusal, on stand-ins — the session
verdicts, Python's doors, the reads App Control's gate judges, the status sidecar and the relay. The push devices are
written to a stand-in of this session alone (pg_temp); the Back-end switch is only read. Nothing is written to a live
table and nothing reaches the relay or the sidecar.

Run inside asa-hub-db-sync by the in-process runner (run.sh, which loads the test from beside its drv.py):

    python3 -c 'import sys; open(sys.argv[1], "w").write("import os\nos.environ[\"FD_ROUTES\"] = %r\n"
        "os.environ[\"OL_TABLES\"] = %r\nos.environ[\"HUB_IST_CONFIG_DECLARATION_JSON\"] = %r\n" % (
        open("app/front_door_routes.json").read(), open("app/other_lanes.json").read(),
        open("app/ist_config_defaults.json").read()) + open("tools/test-other-lanes.py").read())' \
        "$RUNNER/test_other_lanes.py"
    sh "$RUNNER/run.sh" "$PWD/app" "$RUNNER/test_other_lanes.py"

(the tables ride inside the copy: as the runner's env argument they pass the shell's argument limit)
"""
import logging

logging.disable(logging.CRITICAL)
import asyncio  # noqa: E402
import base64  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402


class _App:
    """FastAPI's surface main.py touches at import: every decorator hands the function back."""

    def __init__(self, *a, **k):
        pass

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

# the sidecar and the relay stood in for: every ask recorded, a canned answer
asked_http: list = []


class _HttpRes:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class _AsyncClient:
    answers: dict = {}

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, headers=None):
        asked_http.append((url, dict(headers or {})))
        for prefix, res in _AsyncClient.answers.items():
            if url.startswith(prefix):
                if isinstance(res, Exception):
                    raise res
                return res
        raise ConnectionError("no stand-in for " + url)


_hx = types.ModuleType("httpx")
_hx.AsyncClient = _AsyncClient
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": _sc, "httpx": _hx})

WORK = f"/tmp/ol-test-{os.getpid()}"
os.makedirs(WORK + "/packs", exist_ok=True)
with open(WORK + "/routes.json", "w") as fh:
    fh.write(os.environ["FD_ROUTES"])
with open(WORK + "/other_lanes.json", "w") as fh:
    fh.write(os.environ["OL_TABLES"])
with open(WORK + "/manifest.json", "w") as fh:
    json.dump({"resources": []}, fh)
with open(WORK + "/packs/engine-build.json", "w") as fh:
    json.dump({"build": "2026-10-01T00:00:00Z"}, fh)
# a VAPID key file of this run: an uncompressed P-256 point and a 32-byte scalar (never a real key)
VAPID = WORK + "/vapid.json"
PUB = base64.urlsafe_b64encode(b"\x04" + b"\x11" * 64).decode().rstrip("=")
with open(VAPID, "w") as fh:
    json.dump({"public_key": PUB, "private_key": base64.urlsafe_b64encode(b"\x22" * 32).decode().rstrip("="),
               "subject": "mailto:test@example.org"}, fh)
os.environ.update(HUB_FRONT_DOOR_ROUTES=WORK + "/routes.json", HUB_APP_PACK_DIR=WORK + "/packs",
                  HUB_SNAPSHOT_MANIFEST=WORK + "/manifest.json", HUB_OTHER_LANES=WORK + "/other_lanes.json",
                  HUB_STATUS_TOKEN="status-test-token", HUB_SERVICE_SECRET="svc-test-secret",
                  HUB_WEBPUSH_VAPID_FILE=VAPID)

out: dict = {}
fails: list = []


def check(name, cond, got=None):
    out[name] = "ok" if cond else {"FAILED": got}
    if not cond:
        fails.append(name)


class Req:
    def __init__(self, token="", query=None, body=b"", headers=None):
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}
        if token:
            self.headers["authorization"] = "Bearer " + token
        self.query_params = dict(query or {})
        self._raw = body if isinstance(body, bytes) else json.dumps(body).encode()

    async def body(self):
        return self._raw

    async def stream(self):
        for i in range(0, len(self._raw), 65536):
            yield self._raw[i:i + 65536]


def run(handler, req):
    r = asyncio.run(handler(req))
    return json.loads(r.body), r.headers


try:
    import psycopg

    import front_door as FD
    import hubdb
    import lane_gate as LG
    import live_notify
    import main as M
    import my_lanes as ML
    import other_lanes as OL
    import scope as sc
    import writes as W

    MASTER = "ol-master@example.org"
    sc.MASTER_ACCOUNT = MASTER

    # ---- which groups take their routes: a group whose secret is not here is left to the relay carrier ------------
    class RecApp:
        def __init__(self):
            self.paths = []

        def _deco(self, method):
            def deco(path):
                self.paths.append((method, path))
                return lambda f: f
            return deco

        def __getattr__(self, name):
            return self._deco(name.upper())

    def installed():
        a = RecApp()
        return OL.install(a), {p for _m, p in a.paths}

    taken, paths = installed()
    check("install: the token and the VAPID file here, both groups taken", "/hub-lanes/hub-containers" in paths
          and {"/hub-lanes/push/key", "/hub-lanes/push/subscribe", "/hub-lanes/push/unsubscribe"} <= paths
          and len(paths) == 20, (taken, sorted(paths)))
    saved_token, saved_vapid = os.environ.pop("HUB_STATUS_TOKEN"), OL.VAPID_FILE
    OL.HUB_STATUS_TOKEN_FILE = WORK + "/no-such-token"
    OL.VAPID_FILE = OL.Path(WORK + "/no-such-vapid.json")
    taken, paths = installed()
    check("install: neither here, both left to the relay, the rest taken",
          not any(p.startswith(("/hub-lanes/hub-containers", "/hub-lanes/push/")) for p in paths)
          and "/hub-lanes/backends" in paths and "/hub-lanes/my-work" in paths and len(paths) == 16,
          (taken, sorted(paths)))
    with open(WORK + "/token", "w") as fh:
        fh.write("status-test-token\n")
    OL.HUB_STATUS_TOKEN_FILE = WORK + "/token"
    taken, paths = installed()
    check("install: the token from its file", "/hub-lanes/hub-containers" in paths and OL._status_token()
          == "status-test-token", sorted(paths))
    os.environ["HUB_STATUS_TOKEN"], OL.VAPID_FILE = saved_token, saved_vapid

    # ---- the session verdicts --------------------------------------------------------------------------------------
    S = FD.Session
    SESSIONS = {"t-staff": S(ok=True, role="staff", uid="u-staff"),
                "t-master": S(ok=True, role="admin", uid="u-master", is_master=True),
                "t-admin": S(ok=True, role="admin", uid="u-admin"),
                "t-manager": S(ok=True, role="manager", uid="u-manager"),
                "t-hm": S(ok=True, role="manager", uid="u-hm"),
                "t-director": S(ok=True, role="director", uid="u-director"),
                "t-client": S(ok=True, role="client", uid="u-client"),
                "t-off": S(ok=True, role="staff", uid="u-off"),
                "t-onb": S(ok=True, role="onboarding", uid="u-onb"),
                "t-out": S(ok=False)}

    async def session(token):
        return SESSIONS.get(token) if token != "t-unread" else None

    FD.session = session
    FD.people_at = lambda: 0.0
    voided: list = []
    FD.settle_void_soon = lambda app_id, wid: voided.append((app_id, wid))

    # ---- Python's doors --------------------------------------------------------------------------------------------
    calls: list = []
    ANSWERS: dict = {}

    async def call_app(app_id, action, user, payload, write_id="", at=0.0):
        calls.append({"app": app_id, "action": action, "user": dict(user), "payload": dict(payload),
                      "write": write_id})
        got = ANSWERS.get(action)
        env = got(user, payload) if callable(got) else got
        if env is None:
            return None
        return json.dumps(env).encode(), time.time(), env, None, 0.0

    FD.call_app = call_app
    dirty: list = []
    live_notify.dirty = lambda names: dirty.append(sorted(names)) or sorted(names)

    # ---- the reads App Control's gate judges ------------------------------------------------------------------------
    class Ref:
        def __init__(self, name, headers=None):
            self.name, self.headers, self.table = name, headers or [name], "t"

    class Res:
        def __init__(self, ref):
            self.ref, self.book_known = ref, True

    USERS = [{"userid": "u-staff", "role": "staff", "types": "STAFF", "active": True, "appdenials": "",
              "hometenant": ""},
             {"userid": "u-master", "role": "admin", "types": "", "email": MASTER},
             {"userid": "u-admin", "role": "admin", "types": "ADMIN"},
             {"userid": "u-manager", "role": "manager", "types": "MANAGER"},
             {"userid": "u-hm", "role": "manager", "types": "HM"},
             {"userid": "u-director", "role": "director", "types": "DIRECTOR"},
             {"userid": "u-client", "role": "client", "types": "CLIENT", "clientkey": "c-1"},
             {"userid": "u-off", "role": "staff", "types": "STAFF", "active": False},
             {"userid": "u-onb", "role": "onboarding", "types": "ONBOARDING"}]
    RULES = [{"appid": "my-work", "badges": "STAFF, HM, CLIENT"}, {"appid": "my-profile", "badges": "STAFF"},
             {"appid": "my-calendar", "badges": "STAFF, CLIENT"}, {"appid": "timeoff", "badges": "STAFF"},
             {"appid": "house-supplies", "badges": "HM, DIRECTOR"}, {"appid": "client-profiles", "badges": "DIRECTOR"},
             {"appid": "my-work", "badges": "STAFF, CLIENT"}]
    PRN_REF = Ref("prn", ["Select Your Name", "NOTE", "SHIFTS"])
    PRN_ROWS = [{"Select Your Name": "Zed Q", "NOTE": "PRN"}, {"Select Your Name": "Ann B", "NOTE": "prn"},
                {"Select Your Name": "Bo C", "NOTE": "PRN only weekends"}, {"Select Your Name": "", "NOTE": "PRN"}]

    class DB:
        def resolve(self, tab):
            return Res(Ref(tab) if tab in ("app_badge_access", "app_tenant_access") else None)

        def normalized_rows(self, ref):
            return list(RULES) if ref.name == "app_badge_access" else []

        def rows(self, ref):
            return list(enumerate(PRN_ROWS, 2)) if ref is PRN_REF else []

        def as_of(self, books):
            return 1_790_000_000.0

        def catalog(self):
            return {"tabs": {}}

    class Reads:
        db = DB()

        def users(self):
            return list(USERS)

        def config(self):
            return {"test_mode": "off"}

        def tab_of(self, sid, tab, missing):
            return PRN_REF if sid == OL.PRN_SHEET and tab == OL.PRN_TAB else None

    LG.in_reads = lambda fn: fn(Reads())

    # the Requests lanes' reader stood in for: who reads, by account
    WHO = {"u-hm": {"name": "Hal M", "role": "manager", "badges": ["HM", "MANAGER"], "manages": ["ABD1305"],
                    "decides_everywhere": False, "managers_readable": True},
           "u-director": {"name": "Dee R", "role": "director", "badges": ["DIRECTOR"], "manages": [],
                          "decides_everywhere": True, "managers_readable": True}}

    async def viewer(s):
        who = LG.actor(s)
        if who is None:
            return {"status": 401, "message": "sign in first"}
        return dict(WHO.get(who[1]) or {"name": "", "role": who[0], "badges": [who[0].upper()]}), who

    LG.viewer = viewer
    ML._published_cells = lambda held: [{"id": 7, "location": "ABD1305", "col_iso": "2026-10-20", "pending": True}]

    # ---- the push devices' stand-in, this session alone -------------------------------------------------------------
    conn = psycopg.connect(hubdb._dsn(), autocommit=True)
    conn.execute("set role asa_hub_app_rw")
    conn.execute("create temp table asa_hub_push_subs (like app.asa_hub_push_subs including all)")
    OL.SUBS = "pg_temp.asa_hub_push_subs"
    OL._STORE[:] = [W.Store(connect=lambda: conn)]

    # ---- App Control's gate, in the relay's words --------------------------------------------------------------------
    r = Reads()
    check("gate: an inactive account", LG.app_access(r, "u-off", "staff", "my-work", master=False)
          == {"open": False, "reason": "restricted", "why": "This account is not active."})
    got = LG.app_access(r, "u-client", "client", "my-profile", master=False)
    check("gate: a contained role the rule does not name", got["reason"] == "restricted" and got["why"]
          == "my-profile is not open to client accounts unless App Access names that role.", got)
    got = LG.app_access(r, "u-staff", "staff", "house-supplies", master=False, app_label="House Supplies")
    check("gate: badges the rule does not name", got["why"] == "House Supplies is not open to this account's badges.",
          got)
    check("gate: the last row for an app wins", LG.app_access(r, "u-hm", "manager", "my-work", master=False)["open"]
          is False)
    check("gate: the master is never narrowed", LG.app_access(r, "u-master", "admin", "nothing", master=True)["open"])

    # ---- hub-containers ------------------------------------------------------------------------------------------
    _AsyncClient.answers = {OL.HUB_STATUS_URL: _HttpRes(200, {"containers": [{"name": "asa-hub-app"}, "x"],
                                                              "read_at": "now", "cache_s": 5})}
    env, headers = run(OL.hub_containers, Req("t-master"))
    check("hub-containers: the master reads the sidecar's list", env == {"status": 200, "data": {
        "containers": [{"name": "asa-hub-app"}], "read_at": "now", "cache_s": 5}}
        and headers.get("Cache-Control") == "no-store"
        and asked_http[-1][1] == {"X-Hub-Status-Token": "status-test-token"}, env)
    env, _ = run(OL.hub_containers, Req("t-staff"))
    check("hub-containers: anyone else, the unknown lane", env == LG.UNKNOWN_LANE, env)

    # ---- backends --------------------------------------------------------------------------------------------------
    env, _ = run(OL.backends, Req("t-master"))
    data = env.get("data") or {}
    check("backends: the master's view, every app on Python", env.get("status") == 200
          and len(data.get("apps") or []) == len(OL.BACKENDS) and {a["backend"] for a in data["apps"]} == {"python"}
          and data["python"]["reachable"] is True and data["settling"] is False, env.get("message"))
    env, _ = run(OL.backends, Req("t-master", {"member": "m-1"}))
    check("backends: inside a visit, refused", env.get("reason") == "visit", env)
    env, _ = run(OL.backends_set, Req("t-master", body={"app": "locations", "backend": "apps_script"}))
    check("backends POST: Apps Script refused", env == OL.BACKEND_GAS_REFUSED, env)
    env, _ = run(OL.backends_set, Req("t-master", body={"app": "locations", "backend": "python"}))
    check("backends POST: Python, answered with the view", env.get("status") == 200 and "apps" in env.get("data", {}))
    env, _ = run(OL.backends_set, Req("t-admin", body={"app": "locations", "backend": "python"}))
    check("backends POST: an admin who is not the master", env == LG.UNKNOWN_LANE, env)

    # ---- Technology ------------------------------------------------------------------------------------------------
    ANSWERS["techStatusSet"] = {"status": 200, "data": {"name": "Hub", "status": "Done"}, "_write": {"final": True}}
    env, _ = run(OL.tech_status, Req("t-admin", body={"name": "Hub", "status": "Done"}))
    c = calls[-1]
    check("tech-status: kept by Python, its ring said", env == {"status": 200, "data": {"name": "Hub", "status": "Done"}}
          and c["action"] == "techStatusSet" and W.WRITE_ID.fullmatch(c["write"])
          and dirty[-1] == ["techProjects"], (env, c))
    env, _ = run(OL.tech_status, Req("t-staff", body={"name": "Hub", "status": "Done"}))
    check("tech-status: staff refused", env == {"status": 403, "message": "admins and managers only"}, env)
    env, _ = run(OL.tech_status, Req("t-admin", body={"name": "Hub", "status": "Maybe"}))
    check("tech-status: a word the dropdown does not have", env.get("status") == 400
          and "Not started" in env["message"], env)
    ANSWERS["techManualSave"] = None
    env, _ = run(OL.tech_manual, Req("t-manager", body={"op": "add", "name": "New"}))
    check("tech-manual: Python unanswered, nothing written, the write let go", env == OL.TECH_UNKEPT
          and voided[-1][0] == "technology", (env, voided))
    env, _ = run(OL.tech_manual, Req("t-manager", body={"op": "add"}))
    check("tech-manual: no name", env == {"status": 400, "message": "name is required"}, env)

    # ---- the runbook and the versions box ------------------------------------------------------------------------
    ANSWERS["productionActionsView"] = {"status": 200, "data": {"houses": []}}
    env, _ = run(OL.production_actions, Req("t-master"))
    check("production-actions: the master's runbook, test mode beside it", env.get("status") == 200
          and env["data"]["test_mode"] == {"on": False, "readable": True, "word": "off", "why": ""}
          and calls[-1]["user"]["is_master"] is True, env)
    env, _ = run(OL.production_actions, Req("t-admin"))
    check("production-actions: an admin who is not the master", env == LG.UNKNOWN_LANE, env)
    _AsyncClient.answers = {OL.RELAY_URL: _HttpRes(200, {"status": 200, "data": {
        "relay": {"code": "abc123", "started_at": "2026-10-24T00:00:00Z"}}})}
    env, _ = run(OL.versions, Req("t-master"))
    check("versions: both codes and the engine's build", env.get("status") == 200
          and env["data"]["python"]["code"] == M.CODE_STAMP and env["data"]["relay"]["code"] == "abc123"
          and env["data"]["engine_build"] == "2026-10-01T00:00:00Z", env)
    env, _ = run(OL.versions, Req("t-staff"))
    check("versions: anyone else, the unknown lane", env == LG.UNKNOWN_LANE, env)

    # ---- web push --------------------------------------------------------------------------------------------------
    env, _ = run(OL.push_key, Req("t-staff"))
    check("push/key: the public key", env == {"status": 200, "data": {"key": PUB, "why": ""}}, env)
    env, _ = run(OL.push_key, Req(""))
    check("push/key: signed out", env == {"status": 401, "message": "sign in first"}, env)
    sub = {"endpoint": "https://fcm.googleapis.com/fcm/send/abc",
           "keys": {"p256dh": base64.urlsafe_b64encode(b"\x04" + b"\x01" * 64).decode().rstrip("="),
                    "auth": base64.urlsafe_b64encode(b"\x02" * 16).decode().rstrip("=")}}
    env, _ = run(OL.push_subscribe_door, Req("t-staff", body={"subscription": sub, "ua": "test"}))
    row = conn.execute("select user_id, role, ua from pg_temp.asa_hub_push_subs").fetchall()
    check("push/subscribe: the device kept for the session's account", env == {"status": 200, "data": {
        "kept": True, "fresh": True, "devices": 1}} and row == [("u-staff", "staff", "test")], (env, row))
    env, _ = run(OL.push_subscribe_door, Req("t-staff", body={"subscription": {**sub, "endpoint": "https://evil.org/x"}}))
    check("push/subscribe: another host refused", env == {
        "status": 400, "message": "not a push subscription this relay can write to"}, env)
    env, _ = run(OL.push_unsubscribe_door, Req("t-staff", body={"endpoint": sub["endpoint"]}))
    check("push/unsubscribe: the device let go", env == {"status": 200, "data": {"removed": 1}}, env)
    env, _ = run(OL.push_unsubscribe_door, Req("t-staff", body={"endpoint": "http://x"}))
    check("push/unsubscribe: no endpoint", env == {"status": 400, "message": "endpoint is required"}, env)

    # ---- House Supplies ------------------------------------------------------------------------------------------
    ANSWERS["houseMedsView"] = lambda user, payload: {"status": 200, "data": {"scope": payload["scope"]}}
    env, _ = run(OL.meds, Req("t-hm", {"since": "x"}))
    check("meds: a house manager reads their houses", env.get("status") == 200
          and env["data"]["scope"]["houses"] == ["ABD1305"] and env["data"]["scope"]["writer"] is False
          and calls[-1]["payload"]["since"] == "x", env)
    env, _ = run(OL.meds, Req("t-staff"))
    check("meds: badges App Control does not release it to", env == {
        "status": 403, "reason": "badge", "message": "House Supplies is not open to this account's badges."}, env)
    env, _ = run(OL.meds, Req("t-master", {"client": "c-1"}))
    check("meds: the master reads one client's prescriptions", env.get("status") == 200
          and env["data"]["scope"] == OL.MEDS_CLIENT_SCOPE and calls[-1]["payload"]["client"] == "c-1", env)
    env, _ = run(OL.meds, Req("t-staff", {"client": "c-1"}))
    check("meds: one client's prescriptions not open", env == OL.MEDS_CLIENT_SHUT, env)
    ANSWERS["houseMedsRx"] = {"status": 404, "reason": "missing", "message": "No such prescription."}
    env, _ = run(OL.meds_rx, Req("t-director", {"key": "k1"}))
    check("meds/rx: Python's own word", env == ANSWERS["houseMedsRx"] and calls[-1]["payload"]["key"] == "k1", env)
    ANSWERS["houseMedsCommit"] = lambda user, payload: {"status": 200, "data": {"counts": {"files": 1}}}
    env, _ = run(OL.meds_commit, Req("t-director", body={"staged": ["s1", "s2"]}))
    c = calls[-1]
    check("meds/commit: the staged files imported by a writer", env.get("status") == 200
          and c["payload"]["stage_ids"] == ["s1", "s2"] and c["payload"]["actor_label"] == "Dee R"
          and c["payload"]["scope"]["writer"] is True and W.WRITE_ID.fullmatch(c["write"]), (env, c))
    env, _ = run(OL.meds_commit, Req("t-hm", body={"staged": ["s1"]}))
    check("meds/commit: a reader who is no writer", env == {"status": 403, "reason": "badge",
                                                            "message": OL.MEDS_WRITERS}, env)
    ANSWERS["houseMedsMatch"] = {"status": 200, "data": {"patid": "P1"}}
    env, _ = run(OL.meds_match, Req("t-director", body={"patid": "P1", "client_key": "c-1"}))
    check("meds/match: matched by a writer", env.get("status") == 200 and calls[-1]["payload"]["by"] == "Dee R", env)
    env, _ = run(OL.meds_match, Req("t-director", body=b"{nope"))
    check("meds/match: a body that is not JSON", env.get("status") == 400, env)
    # the import desk: the gate and the body here, the desk itself in tools/test-house-meds-import.py
    import house_meds_import as HMI
    desk: list = []
    HMI.ready = lambda: True
    HMI.preview_now = lambda **kw: desk.append(kw) or {"verdict": "new", "file_name": kw["name"]}
    folder_said: list = [{"busy": False, "listed": 2, "known": 1, "downloaded": 1, "remaining": 0, "error": ""}]
    HMI.folder_now = lambda **kw: desk.append(kw) or folder_said[0]
    drop = {"name": "Key Data Points, A Brighter Dawn, 2026-10-01.xlsx", "size": 3,
            "b64": base64.b64encode(b"PK\x03").decode()}
    env, hd = run(OL.meds_preview, Req("t-director", body=drop))
    check("meds/preview: a writer's file reaches the desk with its bytes and the actor, no-store",
          env == {"status": 200, "data": {"verdict": "new", "file_name": drop["name"]}}
          and desk[-1] == {"name": drop["name"], "data": b"PK\x03", "actor": {"uid": "u-director", "label": "Dee R"}}
          and hd.get("Cache-Control") == "no-store", (env, desk[-1:], hd))
    env, _ = run(OL.meds_preview, Req("t-hm", body=drop))
    check("meds/preview: a reader who is no writer", env == {"status": 403, "reason": "badge",
                                                             "message": OL.MEDS_WRITERS}, env)
    env, _ = run(OL.meds_preview, Req("t-director", body={"name": "x.xlsx", "b64": "not base64!"}))
    check("meds/preview: a body that is not one file", env == {
        "status": 400, "reason": "request", "message": "Send {name, size, b64} — one file per request."}, env)
    env, _ = run(OL.meds_preview, Req("t-director", body={"name": "x.xlsx", "b64": ""}))
    check("meds/preview: an empty file", env == {"status": 400, "reason": "request",
                                                 "message": "The file arrived empty."}, env)
    big = b"x" * (OL.MEDS_BODY_CAP + 1)
    n = len(desk)
    env, _ = run(OL.meds_preview, Req("t-director", body=big))
    check("meds/preview: a body past the cap refused before it is held whole", env == OL.MEDS_TOO_BIG
          and len(desk) == n, env)
    env, _ = run(OL.meds_preview, Req("t-director", body=drop, headers={"content-length": str(OL.MEDS_BODY_CAP + 9)}))
    check("meds/preview: a declared length past the cap refused unread", env == OL.MEDS_TOO_BIG, env)
    env, _ = run(OL.meds_folder, Req("t-director"))
    check("meds/folder: a writer reads the folder", env == {"status": 200, "data": folder_said[0]}
          and desk[-1] == {"actor": {"uid": "u-director", "label": "Dee R"}}, env)
    folder_said[0] = {"busy": True, "by": "the six-hourly sweep"}
    env, _ = run(OL.meds_folder, Req("t-director"))
    check("meds/folder: another reader holds it: 409 busy", env == {
        "status": 409, "reason": "busy", "message": "The folder is being read by the six-hourly sweep.",
        "data": {"busy": True, "by": "the six-hourly sweep"}}, env)
    folder_said[0] = {"busy": False, "error": "the folder could not be listed (HTTPError)"}
    env, _ = run(OL.meds_folder, Req("t-director"))
    check("meds/folder: a listing that failed is 502, never nothing new", env.get("status") == 502
          and env.get("message") == "The folder could not be read — the folder could not be listed (HTTPError).", env)
    env, _ = run(OL.meds_folder, Req("t-staff"))
    check("meds/folder: badges App Control does not release it to", env.get("status") == 403, env)
    HMI.ready = lambda: False
    env, _ = run(OL.meds_folder, Req("t-director"))
    check("meds/folder: the lane's tables not ready", env == OL.MEDS_DOWN, env)

    # ---- broadcast/prn ---------------------------------------------------------------------------------------------
    env, _ = run(OL.broadcast_prn, Req(body={"service_secret": "svc-test-secret"}))
    check("broadcast/prn: who is PRN, by the service", env.get("status") == 200
          and env["data"]["names"] == ["Ann B", "Zed Q"] and env["data"]["rows"] == 3
          and [m["name"] for m in env["data"]["mentions"]] == ["Bo C"], env)
    env, _ = run(OL.broadcast_prn, Req(body={"service_secret": "wrong"}))
    check("broadcast/prn: no service identity", env == {"status": 401, "message": "service identity required"}, env)

    # ---- My Work, My Profile, My Calendar ------------------------------------------------------------------------
    def board(user, payload):
        return {"status": 200, "data": {"scope": {"mode": payload["mode"], "person": payload.get("person", "")},
                                        "me": {}, "actions": [], "requests": [], "totals": {}, "read_at": "now",
                                        "display": {}}}

    ANSWERS["myWorkView"] = board
    env, headers = run(ML.my_work, Req("t-staff"))
    check("my-work: a staff member's own rows", env.get("status") == 200 and env["data"]["scope"]["mode"] == "own"
          and calls[-1]["payload"] == {"mode": "own", "why": "", "person": ""}
          and headers.get("Cache-Control") == "no-store", env)
    env, _ = run(ML.my_work, Req("t-staff", {"person": "annb"}))
    check("my-work: another person's rows, refused", env == {"status": 403, "reason": "scope",
                                                             "message": ML.WORK_OWN_ONLY}, env)
    env, _ = run(ML.my_work, Req("t-master", {"person": "annb"}))
    check("my-work: the master's chosen person", env.get("status") == 200 and calls[-1]["payload"]["mode"] == "mass"
          and calls[-1]["user"]["is_master"] is True, env)
    ANSWERS["myWorkView"] = lambda user, payload: {"status": 200, "data": {"scope": {"mode": "mass"}}}
    env, _ = run(ML.my_work, Req("t-staff"))
    check("my-work: an answer that widens the scope is never served", env == ML.WORK_DOWN, env)
    env, _ = run(ML.my_work, Req("t-staff", {"member": "m-1"}))
    check("my-work: inside a visit", env.get("reason") == "visit", env)
    env, _ = run(ML.my_work, Req("t-onb"))
    check("my-work: a refused role", env.get("status") == 403 and env.get("reason") == "restricted", env)
    ANSWERS["myFamily"] = lambda user, payload: {"status": 200, "data": {"family": True, "part": payload["part"]}}
    env, _ = run(ML.my_work, Req("t-client"))
    check("my-work: a client-role session is handed to its family view", env.get("status") == 200
          and calls[-1]["action"] == "myFamily" and calls[-1]["payload"] == {"part": "work"}, env)

    ANSWERS["myProfileView"] = lambda user, payload: {"status": 200, "data": {
        "scope": {"mode": payload["mode"], "person": payload["person"], "client": payload["client"]},
        "person": {"own": payload["mode"] == "own"}, "details": {}, "requirements": [], "read_at": "now"}}
    env, _ = run(ML.my_profile, Req("t-staff"))
    check("my-profile: one's own profile", env.get("status") == 200 and env["data"]["person"]["own"] is True, env)
    env, _ = run(ML.my_profile, Req("t-master", {"person": "Ann B", "client": "c-1"}))
    check("my-profile: a person and a client at once", env == {"status": 400, "reason": "person",
                                                               "message": "Choose a person or a client, not both."},
          env)

    def week(user, payload):
        return {"status": 200, "data": {"scope": {"mode": payload["mode"], "person": payload["person"]},
                                        "person": {"own": True}, "today": payload["today"], "week": payload["week"],
                                        "requests": [], "form": {}, "test_mode": payload["test_mode"],
                                        "read_at": "now"}}

    ANSWERS["myCalendarView"] = week
    env, _ = run(ML.my_calendar, Req("t-staff", {"week": "2026-10-21"}))
    p = calls[-1]["payload"]
    check("my-calendar: one's own week, what the relay handed beside it", env.get("status") == 200
          and p["week"] == "2026-10-19" and p["published"][0]["id"] == 7
          and p["test_mode"] == {"on": False, "readable": True, "why": ""}
          and p["time_off_open"] == {"open": True, "why": ""}, (env, p))
    env, _ = run(ML.my_calendar, Req("t-unread"))
    check("my-calendar: a session that could not be read", env.get("status") == 503
          and env.get("reason") == "unavailable", env)
    ANSWERS["myCalendarCheck"] = lambda user, payload: {"status": 200, "data": {
        "ref": payload["ref"], "start": payload["start"], "end": payload["end"], "days": 1, "dates": [], "ok": True,
        "refusals": []}}
    env, _ = run(ML.my_calendar_check, Req("t-staff", {"ref": "to0123456789", "start": "2026-11-02"}))
    check("my-calendar/check: new dates checked", env.get("status") == 200
          and calls[-1]["payload"]["ref"] == "TO0123456789", env)
    env, _ = run(ML.my_calendar_check, Req("t-staff", {"ref": "nope"}))
    check("my-calendar/check: no request named", env == {"status": 400, "reason": "request",
                                                         "message": "ref is required (TO…)"}, env)
    env, _ = run(ML.my_calendar_check, Req("t-client", {"ref": "TO0123456789"}))
    check("my-calendar/check: a client files none", env == ML.CALENDAR_NO_REQUESTS, env)
except Exception as exc:  # noqa: BLE001
    import traceback

    out["CRASH"] = traceback.format_exc()[-3000:]
    fails.append("CRASH")

print(json.dumps({"ok": not fails, "checks": len(out), "failed": fails, "out": out}, indent=1, default=str))
