"""The hotline desk in asa-hub-app (app/hotline_fast.py, app/hotline_calls.py, app/hotline_doors.py), on stand-ins: a
hotline-signed Quo event is answered here and filed behind through the app's own doors in-process (kept, its orders,
the model, the PSI check beside it, hotlineFile, the lane mirror), laid on the desk until the books show it; the call
index is built from stand-in copies of the four books and the overlay laid over it, the 4040 withheld from a role
Phone Screening is not served to, one call's words read off the copy or the webhook; the inbox pass files what the
inbox holds, settles a call with no words and one no model would answer, and its beat is kept; the webhook's calls
are laid back from app.hotline_calls after a restart; and the relay no longer files or sweeps the hotline. Nothing
touches a database, Quo, a model, PsiAnywhere or the relay. With LIVE=1 the index is also built off asa-hub-db's real
copies and the old platform's lines, read-only, one call's words read off the copy and app.hotline_calls read back
(counts only are printed).

From the repo root (the relay's source read here, the rest run inside asa-hub-db-sync by the in-process runner):

    RUNNER=<scratchpad> [LIVE=1] python3 tools/test-hotline-app.py
"""
import ast
import json
import os
import subprocess
import sys

if not os.environ.get("HOTLINE_TEST_INPROC"):
    src = open("server/snapshot_service.py", encoding="utf-8").read()
    tree = ast.parse(src)
    defs = {n.name: n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}

    def called(fn: str) -> set[str]:
        return {c.func.id if isinstance(c.func, ast.Name) else c.func.attr for c in ast.walk(defs[fn])
                if isinstance(c, ast.Call) and isinstance(c.func, (ast.Name, ast.Attribute))}

    fails = []
    if "_hotline_python_inbox" in called("_staff_sweep_loop"):
        fails.append("the relay's staff sweep still runs the hotline's inbox pass")
    beats =[c for c in ast.walk(defs["_staff_sweep_loop"]) if isinstance(c, ast.Call)
             and getattr(c.func, "id", "") == "_cadence_beat" and c.args
             and isinstance(c.args[0], ast.Constant) and c.args[0].value == "hub.hotline_sweep"]
    if beats:
        fails.append("the relay still beats hub.hotline_sweep")
    if "/hub-lanes/hotline/calls" not in src or "/hub-lanes/hotline/call/{call_id}" not in src:
        fails.append("a relay route was deleted")
    print(json.dumps({"relay_source": fails or "ok"}))
    runner = os.environ["RUNNER"]
    env = {"HOTLINE_TEST_INPROC": "1", "FD_ROUTES": open("app/front_door_routes.json").read()}
    if os.environ.get("LIVE"):
        # the roster file the desk names callers by: the app's /srv/snapshot, on the host
        env.update(LIVE="1", PEOPLE=open("/opt/docker/asa-hub/web/snapshot/"
                                         "people.json", encoding="utf-8").read())
    with open(os.path.join(runner, "test_hotline_app.py"), "w") as fh:
        fh.write(open(__file__).read())
    with open(os.path.join(runner, "hotline_env.json"), "w") as fh:
        json.dump(env, fh)
    rc = subprocess.call(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"),
                          os.path.join(runner, "test_hotline_app.py"), "@" + os.path.join(runner, "hotline_env.json")])
    sys.exit(1 if fails else rc)

import asyncio  # noqa: E402
import base64  # noqa: E402
import hashlib  # noqa: E402
import hmac  # noqa: E402
import logging  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402

logging.disable(logging.CRITICAL)


class _App:
    def __init__(self, *a, **k):
        self.routes = {}

    def _deco(self, method):
        def wrap(path, **_k):
            def deco(f):
                self.routes[(method, path)] = f
                return f
            return deco
        return wrap

    def __getattr__(self, name):
        return self._deco(name.upper())


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
WORK = tempfile.mkdtemp(prefix="hotline-app-")
HOT_KEY = base64.b64encode(b"h" * 32).decode()
MSG_KEY = base64.b64encode(b"m" * 32).decode()
for name, key in (("hotline.key", HOT_KEY), ("messages.key", MSG_KEY)):
    with open(os.path.join(WORK, name), "w") as fh:
        fh.write(key)
with open(WORK + "/routes.json", "w") as fh:
    fh.write(os.environ["FD_ROUTES"])
os.environ.update(HUB_FRONT_DOOR_ROUTES=WORK + "/routes.json", HUB_APP_PACK_DIR=WORK, HUB_QUO_INBOX_DIR=WORK + "/inbox",
                  HUB_QUO_MESSAGES_KEY_FILE=WORK + "/messages.key", QUO_HOTLINE_WEBHOOK_KEY_FILE=WORK + "/hotline.key",
                  HUB_SERVICE_SECRET="secret", HUB_SNAPSHOT_OUT=WORK, HUB_MIRROR_FIRST_DIR=WORK + "/mirror-first",
                  HUB_ANALYZE_URL="", HUB_ANALYZE_LOCAL_URL="http://local.invalid/v1/chat/completions")
LIVE = bool(os.environ.get("LIVE"))
if LIVE:
    # read-only: asa-hub-db's copies as the owner in read-only transactions, the old platform's lines as asa_hub_ro
    os.environ["HUB_DB_DSN"] = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} "
                                f"user={os.environ['POSTGRES_USER']} password={os.environ['POSTGRES_PASSWORD']} "
                                "options='-c default_transaction_read_only=on'")
    with open(os.path.join(WORK, "people.json"), "w", encoding="utf-8") as fh:
        fh.write(os.environ["PEOPLE"])

out: dict = {}
fails: list = []


def check(name, cond, got=None):
    out[name] = "ok" if cond else {"FAILED": got}
    if not cond:
        fails.append(name)


try:
    import front_door as FD
    import hotline_desk as HD
    import live_notify
    import clocks as C
    import hotline_calls as HC
    import hotline_fast as HF
    import hotline_doors as HDOORS
    import lane_gate as LG

    LINE, SCREEN = HC.HOTLINE_LINE, HC.SCREENING_LINE
    CALLER = "+13305550001"
    ids = {n: "AC" + hashlib.md5(n.encode()).hexdigest() for n in ("filed", "screen", "hook", "psi", "inbox", "mute",
                                                                     "stuck", "kept")}
    asked: list = []
    told: list = []
    answers: dict = {}

    def answer(action, payload):
        got = answers.get((action, payload.get("call_id")))
        if got is not None:
            return got
        if action == "hotlineCallKeep":
            return {"status": 200, "data": {"call_id": payload["call_id"], "kept": "new"}}
        if action == "hotlineShadowAsk":
            return {"status": 200, "data": {"enabled": True, "ask": "orders for " + payload["call_id"],
                                            "no_words": False}}
        if action == "hotlineShadowModel":
            return {"status": 200, "data": {"content": "the model's answer", "via": "groq/test"}}
        if action == "hotlineFile":
            if payload.get("settle") == "no_words":
                return {"status": 200, "data": {"call_id": payload["call_id"], "state": "nothing_to_file"}}
            if payload.get("settle") == "blocked":
                return {"status": 200, "data": {"call_id": payload["call_id"], "state": "retrying", "tries": 1}}
            return {"status": 200, "data": {"call_id": payload["call_id"], "state": "filed", "kinds": ["request"],
                                            "items": 1}}
        if action == "hotlineInboxDue":
            return {"status": 200, "data": {"calls": inbox_calls, "state": "read"}}
        if action == "laneMirrorAfterFiling":
            return {"status": 200, "data": {"rewrites": ["queue"]}}
        if action == "configLane":
            return {"status": 200, "data": None}
        return {"status": 404, "message": "no such door"}

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
        APPS={"hotline": Door(["hotlineShadowAsk", "hotlineShadowModel", "hotlineInboxDue"]),
              "lane-mirror": Door([]), "config-lane": Door(["configLane"])},
        WRITES={"hotline": Door(["hotlineCallKeep", "hotlineFile"]), "lane-mirror": Door(["laneMirrorAfterFiling"])},
        _run=run, _run_write=run_write)
    app = _App()
    C.install(app, M)
    HDOORS.install(app)
    live_notify.told = lambda **k: told.append(k) or k
    live_notify.dirty = lambda names: told.append({"dirty": sorted(names)}) or list(names)
    FD.settle_void_soon = lambda app_id, wid: None
    beats: list = []

    async def beat(name, interval_s, status="ok", **detail):
        beats.append((name, int(interval_s), status, detail))

    C.beat = beat
    kept_beats: list = []
    HF._keep_beat = lambda status, detail: kept_beats.append((status, detail))
    HF._kept_row = lambda: None
    # app.hotline_calls is not read here: the take-up is asked of stand-in rows below
    HC._TAKEN_UP[0] = True
    psi_asked: list = []
    import psi_anywhere

    async def verdict(force=False):
        psi_asked.append(1)
        return {"state": "up", "checked_at": "now"}

    # the time clock's own check, in this process: stood in, so nothing reaches PsiAnywhere
    psi_anywhere.verdict = verdict
    psi_anywhere.armed = lambda: True
    HF._complete = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no model here"))
    carried: list = []

    async def carry(request):
        carried.append(request)
        return _Resp(b'{"status":200}')

    import relay_carrier
    relay_carrier.carry = carry
    check("installed: the webhook and both call doors beside the lanes, matched before the carrier",
          ("POST", "/quo/webhook") in app.routes and ("GET", "/hub-lanes/hotline/calls") in app.routes
          and ("GET", "/hub-lanes/hotline/call/{call_id}") in app.routes, sorted(app.routes))

    # ---- the four books, the lines, the roster and the settings, stood in for -------------------------------------
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    a_rows = [
        (2, {"Call ID": ids["filed"], "Transcript Created": stamp, "Event Timestamp": stamp, "Duration (sec)": "61",
             "Quo Number": LINE, "Participant(s)": CALLER, "Team Member(s)": LINE, "Direction": "incoming",
             "# Turns": "2", "Processed": "", "ProcessedAt": "",
             "Full Transcript": "Hi. I need help.",
             "Speaker Transcript": f"[0:00] {LINE}: Hi.\n[0:03] {CALLER}: I need help."}),
        (3, {"Call ID": ids["screen"], "Transcript Created": stamp, "Event Timestamp": stamp, "Duration (sec)": "30",
             "Quo Number": SCREEN, "Participant(s)": "+13305550009", "Team Member(s)": SCREEN, "Direction": "incoming",
             "# Turns": "1", "Processed": "", "ProcessedAt": "", "Full Transcript": "screening words",
             "Speaker Transcript": f"[0:00] {SCREEN}: Hello."}),
    ]
    log_rows = [(2, {"call_id": ids["filed"], "at": stamp, "items": "1", "kinds": "request", "status": "processed",
                     "via": "groq/test"})]
    recap_rows = [(2, {"call_id": ids["filed"], "summary": "A request.", "next_steps": "- call back",
                       "received_at": stamp, "createdAt": stamp})]
    books = {HC.TRANSCRIPTS.sheet_id: (list(HC.A_FIELDS.values()) + list(HC.A_WORDS.values()), a_rows),
             HC.HOTLINE_LOG.sheet_id: (list(HC.L_FIELDS.values()) + ["caller"], log_rows),
             HC.CALLS_HOUSE.sheet_id: (list(HC.B_FIELDS.values()) + list(HC.B_WORDS.values()), []),
             HC.RECAPS.sheet_id: (list(HC.R_FIELDS.values()), recap_rows)}
    read_tabs: list = []

    def read_tab(sheet_id, tab, **_k):
        read_tabs.append((sheet_id, tab))
        headers, rows = books[sheet_id]
        t = time.time()
        return HD.Copy(HD.Vouch(True, True, t, "", t), list(headers), list(rows))

    REAL = {"read_tab": HD.read_tab, "directory": HC._read_directory, "roster": HC._read_roster,
            "config": HC._read_config}
    HD.read_tab = read_tab
    HC._read_directory = lambda:(({HC.digits(LINE): "Hotline", HC.digits(SCREEN): "Screening"}, {}), 2)
    HC._read_roster = lambda *a: ({HC.digits(CALLER): {"anaexample": "Ana Example"}}, 1)
    HC._read_config = lambda: ({"max_age_days": 14}, 1)
    FD.load_manifest = lambda: [{"resource": "phoneScreens", "roles": ["admin", "manager"]}]
    SESSIONS = {"t-desk": ("manager", "u-desk"), "t-staff": ("staff", "u-staff")}

    async def session(token):
        return token or None

    async def gate(s, app_id, **_k):
        return SESSIONS[s] if s in SESSIONS else {"status": 401, "reason": "session", "message": "sign in first"}

    LG.session, LG.gate = session, gate

    class Req:
        def __init__(self, body=b"", header="", token=""):
            self._b = body
            self.headers = {"openphone-signature": header, **({"authorization": "Bearer " + token} if token else {})}
            self.query_params = {}

        async def body(self):
            return self._b

    def signed(body: bytes, key: str, at_ms=None) -> str:
        stamp_ms = str(at_ms if at_ms is not None else int(time.time() * 1000))
        mac = base64.b64encode(hmac.new(base64.b64decode(key), stamp_ms.encode() + b"." + body,
                                        hashlib.sha256).digest()).decode()
        return f"hmac;1;{stamp_ms};{mac}"

    def transcript_event(call_id, words, *, line=LINE, link=None):
        data = {"object": {"callId": call_id, "createdAt": stamp, "duration": 42, "dialogue": [
            {"identifier": line, "userId": "US1", "content": "Hotline, how can I help?", "start": 0},
            {"identifier": CALLER, "userId": None, "content": words, "start": 3.4}]}}
        if link:
            data["deepLink"] = link
        return json.dumps({"type": "call.transcript.completed", "createdAt": stamp, "data": data}).encode()

    async def settle():
        for _ in range(40):
            pending = [t for t in list(C._TASKS) if not t.done()]
            if not pending:
                return
            await asyncio.wait(pending, timeout=5)

    def door_json(r):
        return json.loads(r.body)

    def of_call(a):
        """The call an ask is about: its call_id, or the one its orders name (the model is asked the orders)."""
        p = a[1] or {}
        if p.get("call_id"):
            return p["call_id"]
        text = str(p.get("text") or "")
        if text.startswith("orders for "):
            return text[len("orders for "):]
        return {"stuck call": ids["stuck"]}.get(text)

    async def main():
        hook = app.routes[("POST", "/quo/webhook")]
        calls = app.routes[("GET", "/hub-lanes/hotline/calls")]
        one = app.routes[("GET", "/hub-lanes/hotline/call/{call_id}")]

        # ---- the webhook: answered at once, filed behind --------------------------------------------------------
        ev = transcript_event(ids["hook"], "My paycheck is short this week.")
        r = await hook(Req(ev, signed(ev, HOT_KEY)))
        check("webhook: a hotline-signed transcript is accepted here, never carried to the relay",
              r.status_code == 200 and door_json(r).get("accepted") == ids["hook"] and not carried, r.body)
        check("webhook: laid on the desk at once, filing", HC._OVERLAY.get(ids["hook"], {}).get("stage") == "filing")
        await settle()
        flow = [a[0] for a in asked if of_call(a) == ids["hook"]]
        check("filing: kept, its orders, the model, hotlineFile — in the relay's order, as the service",
              flow == ["hotlineCallKeep", "hotlineShadowAsk", "hotlineShadowModel", "hotlineFile"]
              and all(a[2] is True for a in asked), flow)
        keep = next(a for a in asked if a[0] == "hotlineCallKeep" and a[1]["call_id"] == ids["hook"])
        check("filing: one write id per call, its parties from the dialogue",
              keep[3] == "W" + hashlib.sha256(("hotline|" + ids["hook"]).encode()).hexdigest()[:24]
              and keep[1]["team"] == LINE and keep[1]["caller_phones"] == CALLER, keep)
        check("filing: no PSI words, no PSI check", not psi_asked)
        check("filing: the call's stage filed with its kinds; the lanes rebuilt, the desk rung, the keeper woken, "
              "the lane mirror asked",
              HC._OVERLAY[ids["hook"]]["stage"] == "filed" and HC._OVERLAY[ids["hook"]]["kinds"] == ["request"]
              and {"dirty": sorted(HF.SLICES)} in told and {"dirty": ["hotline:calls"]} in told
              and {"wake": ["sheet-sync"]} in told and any(a[0] == "laneMirrorAfterFiling" for a in asked), told)
        r = await hook(Req(ev, signed(ev, HOT_KEY)))
        check("webhook: the same call again is a second delivery", door_json(r).get("duplicate") == ids["hook"],
              r.body)
        r = await hook(Req(ev, signed(ev, HOT_KEY, int(time.time() * 1000) - 900_000)))
        check("webhook: a stale stamp is refused", r.status_code == 401 and door_json(r).get("reason") == "stale",
              r.body)
        other = transcript_event(ids["kept"], "hello", line="+13305557777")
        r = await hook(Req(other, signed(other, HOT_KEY)))
        check("webhook: another line's call is ignored", door_json(r).get("ignored") == "not_this_line", r.body)
        linked = transcript_event(ids["kept"], "hello", link="https://my.quo.com/inbox/PNother/c/1")
        r = await hook(Req(linked, signed(linked, HOT_KEY)))
        check("webhook: a call whose signed link opens another inbox is ignored",
              door_json(r).get("ignored") == "not_this_line", r.body)
        r = await hook(Req(ev, signed(ev, base64.b64encode(b"z" * 32).decode())))
        check("webhook: a bad signature is refused in the relay's words",
              r.status_code == 401 and door_json(r) == {"status": 401, "message": "Unverified."}, r.body)

        # ---- the PSI check beside a filing -----------------------------------------------------------------------
        ev = transcript_event(ids["psi"], "I cannot log in to PSI Anywhere today.")
        await hook(Req(ev, signed(ev, HOT_KEY)))
        await settle()
        filed = next(a for a in asked if a[0] == "hotlineFile" and a[1]["call_id"] == ids["psi"])
        check("PSI: a call about PsiAnywhere asks the time clock's own check in this process once, its verdict "
              "filed beside it", psi_asked == [1] and filed[1].get("psi") == {"state": "up", "checked_at": "now"}, filed[1])

        # ---- the call list and one call ----------------------------------------------------------------------------
        r = await calls(Req(token="t-desk"))
        d = door_json(r)
        rows = {c["call_id"]: c for c in d["data"]["calls"]}
        check("calls: the index off the copies — the logged call filed, its summary, its caller named",
              rows[ids["filed"]]["hotline"]["state"] == "filed" and rows[ids["filed"]]["summary"]["text"] == "A request."
              and rows[ids["filed"]]["caller"]["name"] == "Ana Example", rows.get(ids["filed"]))
        check("calls: the webhook's calls laid over it, filed and waiting for the books",
              rows[ids["hook"]]["hotline"]["stage"] == "filed" and rows[ids["hook"]]["hotline"]["state"] == "waiting"
              and rows[ids["hook"]]["line_key"] == "hotline", rows.get(ids["hook"]))
        check("calls: Phone Screening drawn for a role it is served to, the sweep's clock and the fast path beside",
              ids["screen"] in rows and d["data"]["screening_withheld"] is False
              and d["data"]["fast_path_armed"] is True and "hotline_sweep" in d["data"], d["data"].get("hotline_sweep"))
        r = await calls(Req(token="t-staff"))
        d2 = door_json(r)
        check("calls: the 4040 withheld from a role Phone Screening is not served to, its own version",
              ids["screen"] not in {c["call_id"] for c in d2["data"]["calls"]} and d2["data"]["screening_withheld"]
              and d2["data"]["version"] != d["data"]["version"], d2["data"].get("screening_withheld"))
        r = await calls(Req())
        check("calls: no session, the gate's refusal", door_json(r).get("status") == 401, r.body)
        r = await one(ids["filed"], Req(token="t-desk"))
        got = door_json(r)["data"]
        check("call: its words off the copy's own row, turns parsed, the summary beside them",
              got["transcript"]["source"] == "transcripts" and [t["role"] for t in got["transcript"]["turns"]]
              == ["agent", "caller"] and got["summary"]["next_steps"] == ["call back"], got)
        r = await one(ids["hook"], Req(token="t-desk"))
        got = door_json(r)["data"]
        check("call: a call only the webhook knows is read from what it carried",
              got["transcript"]["source"] == "webhook" and len(got["transcript"]["turns"]) == 2, got)
        r = await one(ids["screen"], Req(token="t-staff"))
        check("call: a 4040 call to a role it is withheld from is not on the desk", door_json(r).get("status") == 404,
              r.body)
        r = await one("AC" + "0" * 32, Req(token="t-desk"))
        check("call: an unknown call is not on the desk", door_json(r).get("status") == 404, r.body)
        # the books show the webhook's call filed: the overlay entry ends
        log_rows.append((3, {"call_id": ids["hook"], "at": stamp, "items": "1", "kinds": "request",
                             "status": "processed", "via": "groq/test"}))
        a_rows.append((4, {**a_rows[0][1], "Call ID": ids["hook"]}))
        HC.invalidate()
        await calls(Req(token="t-desk"))
        check("calls: once the books say filed, the webhook's entry is let go", ids["hook"] not in HC._OVERLAY)

        # ---- the inbox pass and its beat -------------------------------------------------------------------------
        global inbox_calls
        inbox_calls = [{"call_id": ids["inbox"], "event_at": stamp, "created": stamp, "duration": 20.0,
                        "caller_phones": [CALLER], "team": [LINE], "dialogue": [{"text": "words of the inbox"}]},
                       {"call_id": ids["mute"], "event_at": stamp, "created": stamp, "duration": 2.0,
                        "caller_phones": [CALLER], "team": [LINE], "dialogue": [{"text": "hi"}]},
                       {"call_id": ids["stuck"], "event_at": stamp, "created": stamp, "duration": 9.0,
                        "caller_phones": [CALLER], "team": [LINE], "dialogue": [{"text": "a long story"}]}]
        answers[("hotlineShadowAsk", ids["mute"])] = {"status": 200, "data": {"enabled": True, "ask": "o",
                                                                              "no_words": True}}
        orig_answer = answer

        def stuck_model(action, payload):
            if action == "hotlineShadowModel" and "stuck" in str(payload.get("text")):
                return {"status": 503, "message": "every Groq key refused"}
            return orig_answer(action, payload)

        answers[("hotlineShadowAsk", ids["stuck"])] = {"status": 200, "data": {"enabled": True, "ask": "stuck call",
                                                                               "no_words": False}}
        globals()["answer"] = stuck_model
        del asked[:]
        await HF.inbox_pass()
        await settle()
        by = {}
        for a in asked:
            by.setdefault(of_call(a), []).append((a[0], (a[1] or {}).get("settle", "")))
        check("inbox: each call the inbox holds filed as the webhook's are",
              by.get(ids["inbox"]) == [("hotlineCallKeep", ""), ("hotlineShadowAsk", ""), ("hotlineShadowModel", ""),
                                       ("hotlineFile", "")], by.get(ids["inbox"]))
        check("inbox: a call with no words past a greeting settled with nothing, no model asked",
              by.get(ids["mute"]) == [("hotlineCallKeep", ""), ("hotlineShadowAsk", ""), ("hotlineFile", "no_words")],
              by.get(ids["mute"]))
        check("inbox: a call no model would answer is settled blocked, its pass counted",
              ("hotlineFile", "blocked") in (by.get(ids["stuck"]) or []), by.get(ids["stuck"]))
        check("inbox: its beat written for the watchdog and kept in asa-hub-db",
              beats and beats[-1][0] == "hub.hotline_sweep" and beats[-1][1] == 600 and beats[-1][2] == "ok"
              and kept_beats and kept_beats[-1][0] == "ok", (beats, kept_beats))
        clock = await HF.sweep_clock()
        check("the sweep's clock: this process's last pass, in the shape the screen reads",
              clock["from"] == "cadence" and clock["at"] and clock["refused_in_a_row"] == 0, clock)

        # ---- after a restart: the webhook's calls laid back from app.hotline_calls ------------------------------
        HC._OVERLAY.clear()
        HC._TAKEN_UP[0] = False
        received = time.time() - 60
        filed_at = datetime.now(timezone.utc) - timedelta(seconds=30)
        turns = [{"identifier": LINE, "userId": "US1", "content": "Hotline.", "start": 0},
                 {"identifier": CALLER, "userId": None, "content": "Help.", "start": 2}]
        n = HC.take_up([(ids["kept"], stamp, 12, turns, received, filed_at,
                         {"state": "filed", "kinds": ["incident"], "items": 2}),
                        (ids["inbox"], stamp, 20, [{"text": "inbox words"}], received, None, None)])
        check("restart: a kept webhook call laid back with its filing; an inbox call is left to the books",
              n == 1 and HC._OVERLAY[ids["kept"]]["stage"] == "filed" and HC._OVERLAY[ids["kept"]]["kinds"]
              == ["incident"] and ids["inbox"] not in HC._OVERLAY, HC._OVERLAY.get(ids["kept"]))
        check("restart: taken up once per process", HC.take_up([]) == 0)
        check("the relay was never asked", not carried)

        if LIVE:
            # ---- live and read-only: the index off asa-hub-db's own copies, one call's words off the same copy --
            import psycopg

            import lanes_pg
            lanes_pg.CONNECT["intel"] = lambda: psycopg.connect(os.environ["MIRROR_DSN"], autocommit=True,
                                                                options="-c default_transaction_read_only=on")
            HD.read_tab, HC._read_directory = REAL["read_tab"], REAL["directory"]
            HC._read_roster, HC._read_config = REAL["roster"], REAL["config"]
            index = await HD.run_on_desk(HC.build_index)
            p = index["payload"]
            health = {k: v["ok"] or v["error"][:160] for k, v in p["sources"].items()}
            check("live: the index built off asa-hub-db's copies, every source answering",
                  all(v is True for v in health.values()) and index["counts"]["hotline"] > 0,
                  {"counts": index["counts"], "sources": health})
            states: dict = {}
            for c in p["calls"]:
                if c["hotline"]:
                    states[c["hotline"]["state"]] = states.get(c["hotline"]["state"], 0) + 1
            named = sum(1 for c in p["calls"] if c["caller"]["who"] == "sole")
            check("live: the hotline's states as the sweep wrote them, callers named off the roster",
                  states.get("filed", 0) > 0 and named > 0, {"states": states, "named": named})
            worded = next((c for c in p["calls"] if c["line_key"] == "hotline" and c["has_transcript"]), None)
            got = await HD.run_on_desk(HC.read_call, index, worded["call_id"]) if worded else None
            check("live: one call's words off the copy's own row",
                  got is not None and (got["transcript"] or {}).get("source") in ("transcripts", "calls_house")
                  and ((got["transcript"] or {}).get("turns") or (got["transcript"] or {}).get("plain")),
                  {"source": ((got or {}).get("transcript") or {}).get("source"),
                   "turns": len(((got or {}).get("transcript") or {}).get("turns") or [])})
            HC._TAKEN_UP[0] = False
            n = await HD.run_on_desk(HC.take_up)
            check("live: the webhook's kept calls of the last two hours read back off app.hotline_calls",
                  isinstance(n, int), n)

    inbox_calls: list = []
    asyncio.run(main())
except Exception as exc:  # noqa: BLE001
    import traceback
    out["crashed"] = traceback.format_exc()[-2000:]
    fails.append("crashed")
print(json.dumps({"checks": len(out), "failed": fails, "out": out}, indent=1, default=str))
sys.exit(1 if fails else 0)
