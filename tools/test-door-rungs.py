"""The relay's /gas rungs over Python's doors, answered by asa-hub-app (app/door_rungs.py, app/analyze.py), on
stand-ins: every action the front door carried for these doors is a front door rung here, each door it asks is one of
the app's own (main.py's APPS and WRITES), and its words are the relay's (its constants read off
server/snapshot_service.py); the session gate, a place away, a switched session and the master; the papers filed in
Drive through a stand-in for asatech's own Drive; the sweeps' passes; the reads handed their record or composed; and
the AI lane test's leg asked of this app's own /analyze. Nothing reaches a row, Drive, a model, Quo or the relay.

From the repo root (the relay's source read here, the rest run inside asa-hub-db-sync by the in-process runner):

    RUNNER=<scratchpad> python3 tools/test-door-rungs.py
"""
import ast
import json
import os
import subprocess
import sys

MINE = ("academyVideoFile adminDocFile calendarDayFileStore certDocUpload clientProfileIspSections clientSourceMar "
        "clientSourceMarDocFile commWindowAskSweep commsInboundSweep contactSweepInstall docRoomTrash docRoomUpload "
        "emergencyContactsRead emergencyContactsSave familyProfileDocAdd finDocFile houseSuppliesInventory "
        "inventoryPharmacy inventorySupplyFile ispContactsSweep ispIntakeRedo ispIntakeSweep libraryUpload "
        "locationDocFile locationIstFile locationMedicationHistory locationMedications myWorkTimeOffMessage obDocFile "
        "packetUpload peopleSyncFromPlatform policiesImport policyDocFile shopPurchases snapshotBundleBuild "
        "snapshotBundleLatest snapshotBundleOwned snapshotBundlePlaces snapshotBundleSweep syncFromLegacy taskFile "
        "techDocFile truelinkSync usersQuoEnrich aiKeyStress").split()

if not os.environ.get("DOOR_RUNGS_INPROC"):
    import importlib.util

    spec = importlib.util.spec_from_file_location("emit_routes", "tools/emit-front-door-routes.py")
    emit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(emit)
    tree, ns = emit.relay_namespace(emit.RELAY.read_text())
    fails, compared = [], []
    for node in ast.parse(open("app/door_rungs.py", encoding="utf-8").read()).body:
        if not (isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)):
            continue
        name = node.targets[0].id
        if name not in ns:
            continue
        try:
            mine = eval(compile(ast.Expression(node.value), "door_rungs", "eval"),  # noqa: S307 - a literal
                        {"__builtins__": {}, "frozenset": frozenset})
        except Exception:  # noqa: BLE001 - not a literal: read from the environment
            continue
        theirs = ns[name]
        if isinstance(mine, (set, frozenset)):
            ok = set(mine) <= set(theirs)
        elif isinstance(mine, dict) and isinstance(theirs, dict):
            ok = all(k in theirs and theirs[k] == v for k, v in mine.items())
        else:
            ok = mine == theirs
        compared.append(name)
        if not ok:
            fails.append(f"{name} is not the relay's")
    if len(compared) < 30:
        fails.append(f"only {len(compared)} of the relay's words compared")
    routes = json.load(open("app/front_door_routes.json"))
    carried = set(routes["relay_first"]) | set(routes["relay_shaped"])
    fails += [f"{a} is not a rung the front door carried" for a in MINE if a not in carried]
    defs = {n.name for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    fails += [f"the relay lost {d}" for d in ("analyze", "_ai_key_stress_door", "_location_meds", "_cert_papers")
              if d not in defs]
    print(json.dumps({"relay_words": fails or f"ok ({len(compared)} compared)"}))
    runner = os.environ["RUNNER"]
    env = {"DOOR_RUNGS_INPROC": "1", "FD_ROUTES": open("app/front_door_routes.json").read(),
           "OL_TABLES": open("app/other_lanes.json").read(),
           "HUB_IST_CONFIG_DECLARATION_JSON": open("app/ist_config_defaults.json").read()}
    with open(os.path.join(runner, "door-rungs-env.json"), "w") as fh:
        json.dump(env, fh)
    with open(os.path.join(runner, "test_door_rungs.py"), "w") as fh:
        fh.write(open(__file__).read())
    rc = subprocess.call(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"),
                          os.path.join(runner, "test_door_rungs.py"),
                          "@" + os.path.join(runner, "door-rungs-env.json")])
    sys.exit(1 if fails else rc)

import asyncio  # noqa: E402
import base64  # noqa: E402
import logging  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402
import urllib.parse  # noqa: E402

logging.disable(logging.CRITICAL)


class _App:
    def __init__(self, *a, **k):
        self.routes = {}

    def post(self, path, **_k):
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
WORK = tempfile.mkdtemp(prefix="door-rungs-")
os.makedirs(WORK + "/packs", exist_ok=True)
for name, var in (("routes.json", "FD_ROUTES"), ("other_lanes.json", "OL_TABLES")):
    with open(f"{WORK}/{name}", "w") as fh:
        fh.write(os.environ[var])
with open(WORK + "/manifest.json", "w") as fh:
    json.dump({"resources": []}, fh)
SECRET = "s" * 32
os.environ.update(HUB_FRONT_DOOR_ROUTES=WORK + "/routes.json", HUB_APP_PACK_DIR=WORK + "/packs",
                  HUB_SNAPSHOT_MANIFEST=WORK + "/manifest.json", HUB_OTHER_LANES=WORK + "/other_lanes.json",
                  HUB_SERVICE_SECRET=SECRET, HUB_RELAY_ROUTES=WORK + "/routes.json")

out: dict = {}
fails: list = []


def check(name, cond, got=None):
    out[name] = "ok" if cond else {"FAILED": str(got)[:600]}
    if not cond:
        fails.append(name)


try:
    import main as MAIN
    import front_door as FD
    import door_rungs as DR
    import analyze as AN
    import clocks
    import service_records as SR

    calls: list = []
    passes: dict = {}

    class Named:
        def __init__(self, app_id, mod):
            self.app, self.ACTIONS = app_id, mod.ACTIONS

    def door(app_id, action, said, payload, wid):
        """Every stand-in door: a plan, a keep, a pass that hands rows back once, an echo."""
        calls.append({"app": app_id, "action": action, "user": said, "payload": payload, "wid": wid})
        n = passes[action] = passes.get(action, 0) + 1
        final = {"_write": {"final": True}}
        plans = {"certDocUploadPlan": {"platform_root": "R", "folder": "F", "name": "n.pdf", "mime": "application/pdf"},
                 "familyDocPlan": {"platform_root": "R", "top": "Families", "folder": "Fam", "name": "f.pdf",
                                   "mime": "application/pdf", "family": "FAM1"},
                 "calendarDayFilePlan": {"platform_root": "R", "path": ["Calendar Attachments", "2026-10"],
                                         "name": "d.pdf", "mime": "application/pdf", "date": "2026-10-25",
                                         "held": payload.get("filename") == "held.pdf"},
                 "libraryUploadPlan": {"platform_root": "R", "folder": "Library Files", "drive_name": "x.png",
                                       "mime_type": "image/png", "max_bytes": 4, "file_name": "x.png"},
                 "docRoomUploadPlan": {"room": "audit", "folder_id": "FOLD", "name": "a.pdf",
                                       "mime": "application/pdf", "max_bytes": 1000},
                 "docRoomTrashPlan": {"room": "audit", "id": "OLD", "name": "old.pdf"},
                 "locationIstFilePlan": {"platform_root": "R", "folder": "IST", "name": "i.pdf",
                                         "mime": "application/pdf"}}
        if action in plans:
            return {"status": 200, "data": plans[action]}
        if action == "certDocUpload":
            return {"status": 200, "data": {"id": "C1", "person": "P1", "req_id": "R1", "cert": "CPR",
                                            "read_owed": True, "read_state": "pending"}, **final}
        if action == "commsInboundFetch":
            return {"status": 200, "data": {"run": {"n": 1}}}
        if action == "ispContactsKeep":
            return {"status": 200, "data": {"more": n == 1, "next": 5, "read": n}, **final}
        if action == "ispIntakeFetch":
            return {"status": 200, "data": {"items": [] if payload.get("only") == "none" else [{"f": 1}],
                                            "asked": True, "answer": {"status": 200, "data": {"nothing": True}}}}
        if action == "peopleSyncFromPlatform":
            return {"status": 200, "data": {"updated": 1, "left": [{"r": 2}]} if payload.get("rows") == [{"r": 1}]
                    else {"inserted": 1, "left": []}, **final}
        if action == "commWindowAskPlan":
            return {"status": 200, "data": {"due": True, "plans": [1, 2], "run": "RUN", "stamp": True}}
        if action == "commWindowAskKeep":
            return {"status": 200, "data": {"left": [], "tally": {"n": 2}, "sent": 2}, **final}
        if action == "aiKeyStress":
            return {"status": 200, "data": {"leg": payload.get("relay_leg"), "why": payload.get("relay_why"),
                                            "url": payload.get("relay_url")}}
        if action == "policiesFetch":
            return {"status": 200, "data": {"titles": ["A", "B"], "policies": [1], "contacts": [2], "files": [3]}}
        if action == "policiesKeep":
            return {"status": 200, "data": {"policy_rows": 2, "contact_rows": 1}, **final}
        if action == "truelinkSync":
            return {"status": 200, "data": {"dryRun": False, "rows": 3}}
        if action == "financeUpload":
            return {"status": 200, "data": {"finTxns": {"n": 1}}, **final}
        if action == "usersQuoFetch":
            return {"status": 200, "data": {"book": "sealed"}}
        if action == "packetUploadPrepare":
            return {"status": 200, "data": {"folder": "PK"}}
        if action in ("inventoryPharmacy", "shopPurchases"):
            return {"status": 200, "data": {"relayed": payload.get("relayed")}}
        if action == "familyProfileDocAdd" and not payload.get("filed"):
            return {"status": 200, "data": {"linked": True}, "_write": {"final": True, "house": ""}}
        return {"status": 200, "data": {"door": action}, **(final if wid else {})}

    def run(module, action, said, payload, at=0.0):
        return _Resp(door(module.app, action, said, payload, ""), headers={"X-Hub-As-Of": f"{time.time():.3f}"})

    def run_write(deciding, action, said, payload, wid, at=0.0):
        return _Resp(door(deciding.app, action, said, payload, wid), headers={"X-Hub-As-Of": f"{time.time():.3f}"})

    STAND = types.SimpleNamespace(APPS={a: Named(a, m) for a, m in MAIN.APPS.items()},
                                  WRITES={a: Named(a, m) for a, m in MAIN.WRITES.items()},
                                  _run=run, _run_write=run_write, DRIVE=object(), TOKEN="")
    DR.M = FD.M = STAND
    S = {"T-admin": FD.Session(ok=True, role="admin", uid="U1"),
         "T-master": FD.Session(ok=True, role="Admin", uid="UM", is_master=True),
         "T-staff": FD.Session(ok=True, role="staff", uid="U2"),
         "T-acting": FD.Session(ok=True, role="admin", uid="U3", acting=True, worn="W", until=time.time() + 60),
         "T-ended": FD.Session(ok=False)}

    async def session(token):
        return S.get(token)

    FD.session = session
    said_back: dict = {"landed": [], "dirty": [], "published": [], "rang": [], "voided": [], "kicked": [],
                       "tasks": []}
    DR.landed = lambda action, raw, content: said_back["landed"].append((action, raw, json.loads(content)))
    DR.mark_dirty = lambda names: said_back["dirty"].append(tuple(names))
    DR.publish = lambda name: said_back["published"].append(name)
    DR.smart_comms_rang = lambda action, raw, content: said_back["rang"].append(action)
    DR.keep_task = lambda coro: said_back["tasks"].append(asyncio.ensure_future(coro))
    FD.settle_void_soon = lambda app_id, wid: said_back["voided"].append((app_id, wid))
    clocks.drive_intake_kick = lambda app_id: said_back["kicked"].append(app_id)

    async def no_lane():
        return None

    clocks.config_lane = no_lane

    async def finish(meta, raw, content):
        said_back.setdefault("finished", []).append(meta)
        return FD.Finished(None, None, "live")

    FD.FINISH = finish
    SR.shopper_purchases_env = lambda: {"status": 200, "data": {"purchases": [{"name": "gloves"}]}}
    SR.inventory_meds_env = lambda: {"status": 200, "data": {"houses": []}}

    class Owner:
        """asatech's Drive, stood in: folders by path, files numbered, every call kept."""
        made: list = []

        def __init__(self, drv):
            if Owner.refuse:
                raise DR.NoOwner("stood in")

        def child_folder(self, parent, name):
            Owner.made.append(("folder", parent, name))
            return f"{parent}/{name}"

        def upload(self, folder, name, mime, data):
            Owner.made.append(("upload", folder, name, mime, len(data)))
            return {"id": f"FILE{len(Owner.made)}", "name": name, "mimeType": mime, "size": str(len(data))}

        def get(self, file_id, fields):
            return {"id": file_id, "name": "a.pdf", "mimeType": "application/pdf", "size": "3",
                    "modifiedTime": "2026-10-25T00:00:00Z", "webViewLink": "https://drive/x"}

        def trash(self, file_id):
            Owner.made.append(("trash", file_id))

        def share_anyone(self, file_id):
            Owner.made.append(("share", file_id))

        def files(self, q, fields, page_size=10, order_by=""):
            return [{"id": "PROJ"}]

    Owner.refuse = False
    DR.OWNER = Owner

    class Req:
        headers: dict = {}

    def raw_of(env):
        return urllib.parse.urlencode({"body": json.dumps(env)}).encode()

    async def ask(action, payload=None, token="T-admin", **extra):
        env = {"token": token, "action": action, "payload": payload if payload is not None else {}, **extra}
        raw = raw_of(env)
        before = len(calls)
        resp = await FD.RUNGS[action](env, raw, Req())
        return json.loads(resp.body), calls[before:], resp

    PDF = base64.b64encode(b"%PDF-1.4 x").decode()

    async def main():
        # ---- installed: every carried action a rung here, routed as one ----------------------------------------------
        check("installed: the rungs are exactly the carried ones", set(DR.RUNGS) == set(MINE),
              sorted(set(DR.RUNGS) ^ set(MINE)))
        check("installed: each is the front door's rung, routed before the relay",
              all(FD.RUNGS.get(a) is DR.RUNGS[a] and FD.route({"action": a, "token": "t"}, b"x")[0] == "rung"
                  for a in MINE))
        app = _App()
        AN.install(app)
        check("installed: POST /analyze", "/analyze" in app.routes)

        # ---- every rung, as an admin: answered, each door it asks the app's own --------------------------------------
        sample = {"familyProfileDocAdd": {"family": "FAM1", "base64": PDF, "mime": "application/pdf"},
                  "certDocUpload": {"req_id": "R1", "cert": "CPR", "person": "P1", "filename": "c.pdf",
                                    "mime": "application/pdf", "base64": PDF},
                  "calendarDayFileStore": {"date": "2026-10-25", "filename": "d.pdf", "base64": PDF},
                  "libraryUpload": {"filename": "x.png", "mime_type": "image/png", "base64": "QUJD"},
                  "docRoomUpload": {"room": "audit", "filename": "a.pdf", "mime": "application/pdf", "base64": PDF},
                  "docRoomTrash": {"room": "audit", "id": "OLD"},
                  "locationIstFile": {"house": "BM", "staff": "S", "file": {"base64": "data:application/pdf;base64,"
                                                                                       + PDF, "name": "i.pdf"}},
                  "peopleSyncFromPlatform": {"rows": [{"r": 1}], "source_at": "now"},
                  "packetUpload": {"base64": PDF, "prepared": "forged", "walk": "forged"}}
        expect = {
            "locationMedications": [("house-supplies", "locationMedications")],
            "adminDocFile": [("administration", "adminDocFile")], "academyVideoFile": [("academy", "academyVideoFile")],
            "techDocFile": [("technology", "techDocFile")], "policyDocFile": [("policy-acks", "policyDocFile")],
            "taskFile": [("taskboard", "taskFile")], "finDocFile": [("finance", "finDocFile")],
            "obDocFile": [("onboarding", "obDocFile")], "inventorySupplyFile": [("inventory", "inventorySupplyFile")],
            "locationDocFile": [("locations", "locationDocFile")],
            "emergencyContactsSave": [("emergency-contacts", "emergencyContactsSave")],
            "snapshotBundleBuild": [("bundles", "snapshotBundleBuild")],
            "clientSourceMarDocFile": [("clients", "clientSourceMarDocFile")],
            "myWorkTimeOffMessage": [("my-work", "myWorkTimeOffMessage")],
            "usersQuoEnrich": [("settings-tools", "usersQuoFetch"), ("settings-tools", "usersQuoEnrichApply")],
            "syncFromLegacy": [("settings-tools", "syncFromLegacy")],
            "packetUpload": [("onboarding", "packetUploadPrepare"), ("onboarding", "packetUpload")],
            "certDocUpload": [("cert-docs", "certDocUploadPlan"), ("cert-docs", "certDocUpload")],
            "familyProfileDocAdd": [("family", "familyDocPlan"), ("family", "familyProfileDocAdd")],
            "calendarDayFileStore": [("calendar", "calendarDayFilePlan"), ("calendar", "calendarDayFileStore")],
            "docRoomUpload": [("audit-library", "docRoomUploadPlan"), ("audit-library", "docRoomKeep")],
            "docRoomTrash": [("audit-library", "docRoomTrashPlan"), ("audit-library", "docRoomKeep")],
            "locationIstFile": [("ist", "locationIstFilePlan"), ("ist", "locationIstFileKeep")],
            "commsInboundSweep": [("opt-outs", "commsInboundFetch"), ("opt-outs", "commsInboundKeep")],
            "ispContactsSweep": [("client-care", "ispContactsFetch"), ("client-care", "ispContactsKeep")] * 2,
            "ispIntakeSweep": [("isp", "ispIntakeFetch"), ("isp", "ispIntakeKeep")],
            "peopleSyncFromPlatform": [("contacts-sync", "peopleSyncFromPlatform")] * 2,
            "commWindowAskSweep": [("comm-window-ask", "commWindowAskPlan"), ("comm-window-ask", "commWindowAskKeep")],
            "aiKeyStress": [("guardian", "aiKeyStress")],
            "inventoryPharmacy": [("inventory", "inventoryPharmacy")], "shopPurchases": [("shopper", "shopPurchases")],
            "policiesImport": [("policy-acks", "policiesFetch"), ("policy-acks", "policiesKeep")],
            "truelinkSync": [("finance", "truelinkSync"), ("finance", "truelinkRunKeep")]}
        AN.ANALYZE_KEYS[:] = ["pool-key"]

        class Up:
            status_code, text = 200, "{}"

            def json(self):
                return {"choices": [{"message": {"content": '{"what": "a cap on calls"}'}}]}

        upstream: list = []

        async def post(url, body, headers, timeout):
            upstream.append((url, body.get("model"), "response_format" in body))
            return Up()

        AN._post = post
        DR.AI_KEY_STRESS_GAP_S = 0.0
        answers, asked_by, unported = {}, {}, []
        for a in MINE:
            for k in list(passes):
                passes.pop(k)
            env, asked, resp = await ask(a, dict(sample.get(a, {})))
            # what a rung left behind its answer runs before the next is asked
            await asyncio.gather(*said_back["tasks"])
            answers[a], asked_by[a] = env, [(c["app"], c["action"]) for c in asked]
            if env.get("status") != 200:
                unported.append((a, env))
        check("every rung: answered 200 through the app's own doors", not unported, unported)
        bad = {a: (want, asked_by[a]) for a, want in expect.items() if asked_by[a] != want}
        check("every rung: the doors it asks, in order", not bad, bad)
        check("every rung: the phase said, as every relay answer says it",
              (await ask("adminDocFile"))[2].headers.get("X-Hub-Phase") is not None)
        check("file doors: Python's answer, its plan taken off",
              answers["adminDocFile"] == {"status": 200, "data": {"door": "adminDocFile"}}, answers["adminDocFile"])

        # ---- the session gate, a place away, a switched session, the master ------------------------------------------
        gated = [a for a in MINE if a not in ("inventoryPharmacy", "shopPurchases", "policiesImport", "truelinkSync")]
        want = {a: DR.ADMIN_ONLY if a == "commWindowAskSweep" else DR.AUTH_ENDED for a in gated}
        no = [a for a in gated if (await ask(a, dict(sample.get(a, {})), token=""))[0] != want[a]]
        check("no session: the relay's 401 at every door (the window ask its 403)", not no, no)
        ended = [a for a in gated if (await ask(a, dict(sample.get(a, {})), token="T-ended"))[0] != want[a]]
        check("an ended session: the same", not ended, ended)
        check("a read the relay shaped: no session 401, one not told 503",
              (await ask("inventoryPharmacy", token=""))[0] == DR.AUTH_ENDED
              and (await ask("policiesImport", token="T-unknown"))[0] == DR.BACKEND_UNREAD)
        check("away: a file door is read from home alone",
              (await ask("adminDocFile", member="X"))[0] == DR.LOCATION_MEDS_AWAY)
        check("away: Settings' tools as the relay words them",
              (await ask("syncFromLegacy", tenant="T"))[0] == DR.RELAY_UNKNOWN_ACTION
              and (await ask("syncFromLegacy", world="W"))[0] == DR.SETTINGS_TOOLS_AWAY)
        check("away: the contact list names no door; My Work tells from home",
              (await ask("peopleSyncFromPlatform", {"rows": []}, member="X"))[0] == DR.RELAY_UNKNOWN_ACTION
              and (await ask("myWorkTimeOffMessage", world="W"))[0]["status"] == 403)
        check("away: a bundle is refused as doPost refuses it",
              (await ask("snapshotBundleOwned", tenant="T"))[0] == DR.RELAY_UNKNOWN_ACTION)
        _env, asked, _r = await ask("techDocFile", token="T-acting")
        u = asked[0]["user"]
        check("a switched session: said so, never the master, no line",
              u.get("acting") is True and u.get("unlogged") is True and u.get("is_master") is False, u)
        _env, asked, _r = await ask("techDocFile", token="T-master")
        check("the master's own session: the master", asked[0]["user"] == {"uid": "UM", "role": "admin",
                                                                            "is_master": True}, asked[0]["user"])
        big = "x" * 120_000
        check("past the envelope reader: doPost's unknown action",
              (await ask("emergencyContactsRead", {"pad": big}))[0] == DR.RELAY_UNKNOWN_ACTION
              and (await ask("certDocUpload", {**sample["certDocUpload"], "pad": big}))[0]["status"] == 200)

        # ---- Emergency Contacts ------------------------------------------------------------------------------------
        del said_back["published"][:]
        env, asked, _r = await ask("emergencyContactsSave", {"rows": []})
        check("emergency contacts: a save kept under its id, its page rung",
              asked[0]["wid"] and said_back["published"] == ["emergency-contacts"], (asked, said_back["published"]))
        held_people = FD.people_at
        FD.people_at = lambda: time.time()
        env_a = (await ask("emergencyContactsSave", {"rows": []}))[0]
        env_m = (await ask("emergencyContactsSave", {"rows": []}, token="T-master"))[0]
        FD.people_at = held_people
        check("emergency contacts: while who reads what settles a save is the master's alone",
              env_a == {"status": 503, "message": DR.BACKEND_FINAL_UNWRITTEN} and env_m["status"] == 200,
              (env_a, env_m))
        check("emergency contacts: off a place the compiled directory",
              (await ask("emergencyContactsRead", member="M"))[0] == DR.EMERGENCY_CONTACTS_COMPILED)

        # ---- the papers filed in Drive -------------------------------------------------------------------------------
        del Owner.made[:], said_back["landed"][:]
        env, asked, _r = await ask("certDocUpload", dict(sample["certDocUpload"]))
        keep = asked[1]
        check("cert papers: the plan told the size alone, never the bytes",
              asked[0]["payload"] == {"req_id": "R1", "cert": "CPR", "person": "P1", "filename": "c.pdf",
                                      "mime": "application/pdf", "b64_chars": len(PDF)}, asked[0]["payload"])
        check("cert papers: filed in R/Compliance Docs/F as asatech, the row kept with what Drive filed",
              Owner.made[:3] == [("folder", "R", "Compliance Docs"), ("folder", "R/Compliance Docs", "F"),
                                 ("upload", "R/Compliance Docs/F", "n.pdf", "application/pdf", 10)]
              and keep["payload"]["filed"]["file_id"] == "FILE3" and keep["wid"], (Owner.made, keep))
        check("cert papers: the answer without its plan or the reading owed",
              env == {"status": 200, "data": {"id": "C1", "person": "P1", "req_id": "R1", "cert": "CPR",
                                              "read_state": "pending"}}, env)
        landed = said_back["landed"][-1]
        check("cert papers: the person's copies rung with a small envelope",
              landed[0] == "certDocUpload" and len(landed[1]) < 400
              and json.loads(urllib.parse.parse_qs(landed[1].decode())["body"][0])["payload"]
              == {"person": "P1", "req_id": "R1", "cert": "CPR"}, landed)
        Owner.refuse = True
        no_owner = (await ask("certDocUpload", dict(sample["certDocUpload"])))[0]
        Owner.refuse = False
        check("cert papers: no owner token files nothing", no_owner == DR.CERT_PAPERS_NO_OWNER, no_owner)
        held_types = DR.TYPES
        DR.TYPES = {"png": "image/png"}
        refused = (await ask("certDocUpload", dict(sample["certDocUpload"])))[0]
        DR.TYPES = held_types
        check("cert papers: a type it will not take refused in its words",
              refused == {"status": 400, "message": DR.TYPE_WORDS + " Nothing was filed."}, refused)
        held_door = STAND._run_write

        def unkept(deciding, action, said, payload, wid, at=0.0):
            if action in ("certDocUpload", "libraryUploadKeep"):
                raise RuntimeError("down")
            return held_door(deciding, action, said, payload, wid, at)

        STAND._run_write = unkept
        del said_back["voided"][:]
        env_u = (await ask("certDocUpload", dict(sample["certDocUpload"])))[0]
        STAND._run_write = held_door
        check("cert papers: filed but not kept — said, and the write taken back",
              env_u == DR.CERT_PAPERS_UNKEPT and said_back["voided"] and said_back["voided"][0][0] == "cert-docs",
              (env_u, said_back["voided"]))

        del Owner.made[:]
        env, asked, _r = await ask("familyProfileDocAdd", dict(sample["familyProfileDocAdd"]))
        check("family papers: under Families, the row kept in the registry",
              Owner.made[0] == ("folder", "R", "Families") and asked[1]["payload"]["family"] == "FAM1"
              and said_back["landed"][-1][0] == "familyProfileDocAdd", (Owner.made, asked))
        env, asked, _r = await ask("familyProfileDocAdd", {"family": "FAM1", "link": "https://drive/x"})
        check("family papers: a Drive link alone is the write it is (the front door's write)",
              env == {"status": 200, "data": {"linked": True}} and asked[0]["wid"]
              and said_back["finished"][-1]["kind"] == "write", (env, asked))

        del Owner.made[:]
        await ask("calendarDayFileStore", dict(sample["calendarDayFileStore"]))
        shared = [m for m in Owner.made if m[0] == "share"]
        await ask("calendarDayFileStore", {**sample["calendarDayFileStore"], "filename": "held.pdf"})
        check("calendar files: under its path, shared by link unless the gate holds",
              Owner.made[0] == ("folder", "R", "Calendar Attachments") and len(shared) == 1
              and len([m for m in Owner.made if m[0] == "share"]) == 1, Owner.made)
        too_big = (await ask("libraryUpload", {"filename": "x.png", "mime_type": "image/png",
                                               "base64": base64.b64encode(b"12345").decode()}))[0]
        check("library: the file over its plan's ceiling refused in its words",
              too_big == {"status": 400, "message": "The file is over 25MB"}, too_big)
        del Owner.made[:]
        env, asked, _r = await ask("docRoomTrash", {"room": "audit", "id": "OLD"})
        check("doc room: the trash carried out as asatech, kept as a trash",
              Owner.made == [("trash", "OLD")] and asked[1]["payload"]["action"] == "trash", (Owner.made, asked))
        env, asked, _r = await ask("docRoomUpload", dict(sample["docRoomUpload"]))
        check("doc room: the store kept with what Drive holds",
              asked[1]["payload"]["web_view_link"] == "https://drive/x" and asked[1]["payload"]["action"] == "upload",
              asked)
        del Owner.made[:]
        env, asked, _r = await ask("locationIstFile", dict(sample["locationIstFile"]))
        check("ist paper: a data URL read, filed under Compliance Docs, its record keeps the file",
              Owner.made[:2] == [("folder", "R", "Compliance Docs"), ("folder", "R/Compliance Docs", "IST")]
              and Owner.made[2][4] == 10 and asked[0]["payload"]["filename"] == "i.pdf"
              and asked[1]["payload"]["file_id"] == "FILE3", (Owner.made, asked))

        # ---- the sweeps ----------------------------------------------------------------------------------------------
        del said_back["rang"][:]
        env, asked, _r = await ask("commsInboundSweep", {"restart": "yes"})
        check("inbound: read as the person, filed as the service, Smart Comms' pages rung",
              asked[0]["user"]["email"] == "U1" and asked[0]["payload"] == {"mode": "sweep", "restart": "yes"}
              and asked[1]["user"] == {"is_service": True} and asked[1]["wid"]
              and said_back["rang"] == ["commsInboundSweep"], asked)
        for k in list(passes):
            passes.pop(k)
        env, asked, _r = await ask("ispContactsSweep", {"client_key": "K"})
        check("isp contacts: pass after pass while there is more, the tally carried",
              asked[2]["payload"].get("from") == 5 and asked[1]["payload"]["by"] == "U1"
              and asked[1]["user"] == {"is_service": True} and env["data"]["read"] == 2, asked)
        del said_back["dirty"][:]
        env, asked, _r = await ask("clientProfileIspSections", {"client": "C"})
        check("isp intake: the sections asked, filed as the service by whoever pressed, the plans rebuilt",
              asked[0]["payload"] == {"mode": "sections", "only": "", "client": "C"}
              and asked[1]["payload"] == {"items": [{"f": 1}], "asked": True, "by": "U1"}
              and said_back["dirty"] == [("isps",)], (asked, said_back["dirty"]))
        env, asked, _r = await ask("ispIntakeRedo", {"source_file": "none"})
        check("isp intake: nothing to file, the read's own answer",
              env == {"status": 200, "data": {"nothing": True}} and len(asked) == 1, env)
        del said_back["dirty"][:]
        env, asked, _r = await ask("peopleSyncFromPlatform", dict(sample["peopleSyncFromPlatform"]))
        check("contact list: the passes summed, the rows handed back carried, the people rebuilt",
              env["data"]["updated"] == 1 and env["data"]["inserted"] == 1 and env["data"]["source_at"] == "now"
              and asked[1]["payload"]["rows"] == [{"r": 2}] and said_back["dirty"] == [("people",)], env)
        held_hold = clocks.ingest_hold
        clocks.ingest_hold = lambda action, lane: "INGEST is armed and the send switch is on"
        env, asked, _r = await ask("peopleSyncFromPlatform", dict(sample["peopleSyncFromPlatform"]))
        clocks.ingest_hold = held_hold
        check("contact list: the ingest gate holds it", env == {"status": 409, "message":
                                                               "INGEST is armed and the send switch is on",
                                                               "held": True} and not asked, env)
        check("window ask: an admin's alone",
              (await ask("commWindowAskSweep", token="T-staff"))[0] == DR.ADMIN_ONLY)
        env, asked, _r = await ask("commWindowAskSweep", {"force": "true"})
        check("window ask: the look as the service, then its plans kept",
              asked[0]["payload"] == {"force": True} and asked[1]["payload"]["plans"] == [1, 2]
              and asked[1]["payload"]["first"] is True and env == {"status": 200, "data": {"sent": 2}}, (env, asked))

        # ---- Settings' tools and the packet -------------------------------------------------------------------------
        del said_back["landed"][:], said_back["dirty"][:]
        env, asked, _r = await ask("usersQuoEnrich")
        check("quo enrich: the book walked, then kept with it, its copies rung",
              asked[1]["payload"] == {"prepared": {"book": "sealed"}} and asked[1]["wid"]
              and said_back["landed"][-1][0] == "usersQuoEnrich", asked)
        env, asked, _r = await ask("contactSweepInstall")
        check("contact clock: armed under a write id, its copies rung",
              asked[0]["wid"] and said_back["landed"][-1][0] == "contactSweepInstall", asked)
        env, asked, _r = await ask("packetUpload", dict(sample["packetUpload"]))
        check("packet: what the relay alone hands is never the browser's; prepared, then kept",
              "walk" not in asked[0]["payload"] and asked[0]["payload"].get("prepared") is None
              and asked[1]["payload"] == {"base64": "kept", "prepared": {"folder": "PK"}}
              and said_back["landed"][-1][0] == "packetUpload", asked)

        # ---- the reads handed their record, or composed -------------------------------------------------------------
        env, asked, _r = await ask("shopPurchases", {"k": 1})
        check("purchases: the door handed the record, the front door's read and finish",
              asked[0]["payload"] == {"k": 1, "relayed": {"status": 200, "data": {"purchases": [{"name": "gloves"}]}}}
              and asked[0]["user"]["place"]["tenant"] == "" and said_back["finished"][-1]["kind"] == "read", asked)
        del said_back["dirty"][:]
        env, asked, _r = await ask("policiesImport")
        check("policies import: read, kept, answered as Policies.gs answered",
              env == {"status": 200, "data": {"imported": 2, "titles": ["A", "B"], "policy_rows": 2,
                                              "contact_rows": 1, "skipped": []}}
              and asked[1]["payload"] == {"policies": [1], "contacts": [2], "files": [3]}
              and said_back["dirty"] == [("policies", "contactLists")]
              and said_back["finished"][-1].get("said") is True, (env, asked))
        del said_back["tasks"][:], said_back["kicked"][:]
        env, asked, _r = await ask("truelinkSync")
        await asyncio.gather(*said_back["tasks"])
        check("truelink: asked, its run kept, the ledger uploaded again behind the answer",
              env == {"status": 200, "data": {"dryRun": False, "rows": 3}}
              and any(c["action"] == "financeUpload" and c["user"] == {"is_service": True} and c["wid"]
                      for c in calls) and said_back["kicked"] == ["finance"], env)

        # ---- the AI lane test and its leg ---------------------------------------------------------------------------
        del upstream[:]
        env, asked, _r = await ask("aiKeyStress", {"rounds": 2})
        leg = asked[0]["payload"]["relay_leg"]
        check("ai key stress: two rounds asked of this app's own /analyze, as its route renders them",
              len(leg) == 2 and all(r["code"] == 200 and json.loads(r["body"]) == {
                  "status": 200, "data": {"choices": [{"message": {"content": '{"what": "a cap on calls"}'}}]}}
                  and "," + " " not in r["body"] for r in leg)
              and asked[0]["payload"]["relay_url"] == DR.AI_KEY_STRESS_SELF and upstream[0][2] is True, leg)
        env, asked, _r = await ask("aiKeyStress", {"rounds": 2}, token="T-staff")
        check("ai key stress: no leg asked for a caller the test refuses",
              asked[0]["payload"]["relay_leg"] == []
              and asked[0]["payload"]["relay_why"] == "not asked for a caller the test refuses", asked)

        class Req2:
            def __init__(self, body):
                self._b = body

            async def body(self):
                return self._b

        r = await AN.analyze(Req2(json.dumps({"service_secret": "wrong", "messages": [1]}).encode()))
        r2 = await AN.analyze(Req2(b"not json"))
        AN.ANALYZE_KEYS[:] = []
        del upstream[:]
        r3 = await AN.analyze(Req2(json.dumps({"service_secret": SECRET,
                                               "messages": [{"role": "user", "content": "q"}]}).encode()))
        check("/analyze: its secret its gate, an unread body said, a pool with no key named and passed over",
              json.loads(r.body) == {"status": 401, "message": "service identity required"}
              and json.loads(r2.body) == {"status": 400, "message": "invalid body"}
              and json.loads(r3.body)["status"] == 200 and [u[0] for u in upstream] == [AN.ANALYZE_LOCAL_URL],
              (r.body, r2.body, r3.body, upstream))

    asyncio.run(main())
except Exception as exc:  # noqa: BLE001
    import traceback

    out["crashed"] = traceback.format_exc()[-2000:]
    fails.append("crashed")

print(json.dumps(out, indent=1))
print(json.dumps({"checks": len(out), "failed": fails}))
sys.exit(1 if fails else 0)
