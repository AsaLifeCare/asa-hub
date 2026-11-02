#!/usr/bin/env python3
"""Settings › Editions answered by Python alone (app/editions.py). The catalogue is the truth and Editions.gs a frozen
subset of it, row for row; the three doors answer as Editions.gs answers on the editions it has (node runs the .gs on
the same cells and the same payloads); and in
asa-hub-db-sync, on the live copy: the master's read, a non-master's refusal, a save kept in app.edits as the
config's newest fact and seen at once by the next read, by scope.edition_allows and by editionsMine, the refusals,
and the two-way sync's plan for that fact. Nothing real is written: the edit store lives in temp tables inside
transactions rolled back. Prints shapes, counts and timings only."""
from __future__ import annotations

import base64
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
sys.path.insert(0, str(ROOT / "app"))

import edit_overlay as eo  # noqa: E402
import editions as E  # noqa: E402
import hubdb  # noqa: E402
import scope as sc  # noqa: E402

DB_RUNNER = "asa-hub-db-sync"
GS = ROOT / "apps-script" / "Editions.gs"
HEADS = ("Fact Key", "Subject ID", "Value", "Type", "Source", "Evidence", "Recorded At", "Recorded By", "Instance ID")

results: dict[str, Any] = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: Any = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail not in (None, ""):
            print(f"       {str(detail)[:500]}")


# ---- node runs Editions.gs: its catalogue, and its three doors on stand-ins for the config and the users ------------

NODE = r"""
const fs = require('fs'), vm = require('vm');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const src = fs.readFileSync(input.gs, 'utf8');
function load() {
  const ctx = { HUB_POLICY: {}, HUB_ACTIONS: {} };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}
const first = load();
const out = { catalogue: { key: first.EDITIONS_KEY, roles: first.EDITION_ROLES, max: first.EDITION_MAX_PEOPLE,
                           editions: first.EDITIONS }, cases: [] };
for (const k of input.cases) {
  const c = load();
  const saved = [];
  c.str_ = (v) => (v === null || v === undefined) ? '' : String(v).trim();
  c.hubIsRealMaster_ = (u) => !!u && u.master === true;
  c.hubIsMaster_ = (e) => String(e || '').trim().toLowerCase() === input.master;
  c.usersAll_ = () => k.users || [];
  c.hubSysLog_ = () => {};
  c.hiringAlerts_ = () => {
    if (k.unreadable) throw new Error('unreadable');
    return k.raw === null ? {} : { mywork_editions: k.raw };
  };
  c.HUB_ACTIONS.hiringAlertsSet = (p) => { saved.push(p.values); return { status: 200, data: {} }; };
  const door = { get: 'editionsGet', set: 'editionsSet', mine: 'editionsMine' }[k.kind];
  const res = c.HUB_ACTIONS[door](k.payload, k.user);
  out.cases.push({ res: JSON.parse(JSON.stringify(res)), saved: saved.length ? saved[0].mywork_editions : null });
}
process.stdout.write(JSON.stringify(out));
"""


def node(cases: list[dict]) -> dict[str, Any]:
    got = subprocess.run(["node", "-e", NODE], input=json.dumps({"gs": str(GS), "master": sc.MASTER_ACCOUNT,
                                                                  "cases": cases}).encode(),
                         capture_output=True, timeout=120)
    if got.returncode != 0:
        raise RuntimeError(got.stderr.decode()[-800:])
    return json.loads(got.stdout)


class FakeDb:
    def prop(self, key: str) -> str:
        return hubdb.ESSENCIAL_ID if key == "HUB_APPS_RUNTIME_ID" else ""


class FakeReads:
    """A session's reads over stand-ins: the config's editions cell, the users tab, the depot's Facts."""

    def __init__(self, raw: str | None, users: list[dict], unreadable: bool = False) -> None:
        self.db, self.raw, self.rows, self.unreadable = FakeDb(), raw, users, unreadable
        self.now = datetime(2026, 1, 5, 15, 4, 5, 678000, tzinfo=timezone.utc)

    def config(self) -> dict[str, str]:
        if self.unreadable:
            raise hubdb.Unreadable("stand-in")
        return {} if self.raw is None else {E.EDITIONS_KEY: self.raw}

    def users(self) -> list[dict]:
        return self.rows

    def tab_of(self, sid: str, tab: str, _missing: str) -> hubdb.TabRef:
        return hubdb.TabRef(sid, tab, "t_facts", HEADS, None, 3)


class FakeSess:
    def __init__(self, reads: FakeReads, user: dict) -> None:
        self.reads, self.user = reads, user


USERS = [{"userid": "U1", "displayname": "Stand In One", "email": "one@example.org", "role": "staff"},
         {"userid": "U2", "displayname": "", "email": "two@example.org", "role": "Manager"},
         {"userid": "U3", "displayname": "Stand In Three", "email": "three@example.org", "role": "admin"},
         {"userid": "U4", "displayname": "Stand In Four", "email": "four@example.org", "role": "client"},
         {"userid": "U5", "displayname": "The Master", "email": " " + sc.MASTER_ACCOUNT.upper(), "role": "admin"},
         {"userid": "U6", "displayname": "", "email": "", "role": ""},
         {"userid": "U7", "displayname": "Stand In Seven", "email": "seven@example.org", "role": "guardian"},
         {"userid": "123", "displayname": "Numbered", "email": "n@example.org", "role": "staff"}]
GS_USERS = {"master": {"master": True, "id": "U5", "role": "admin"},
            "admin": {"master": False, "id": "U3", "role": "admin"},
            "staff": {"master": False, "id": "U1", "role": "staff"},
            "manager": {"master": False, "id": "U2", "role": "Manager"},
            "client": {"master": False, "id": "U4", "role": "client"},
            "service": {"master": False, "id": "", "role": "admin", "is_service": True},
            "blank": {"master": False, "id": "", "role": "staff"}}


def py_user(u: dict) -> dict:
    return {"id": u["id"], "email": sc.MASTER_ACCOUNT if u["master"] else "someone@example.org", "role": u["role"],
            "is_service": u.get("is_service") is True, "visiting_member": ""}


def legacy(env: dict, ids: set[str]) -> dict:
    """An answer with the editions Editions.gs never had taken out: the .gs is a frozen subset of the catalogue."""
    data = env.get("data") if isinstance(env, dict) else None
    listed = data.get("editions") if isinstance(data, dict) else None
    if not isinstance(listed, list):
        return env
    kept = [e for e in listed if (e.get("id") if isinstance(e, dict) else e) in ids]
    return {**env, "data": {**data, "editions": kept}}


def py_answer(kind: str, case: dict, ids: set[str]) -> tuple[dict, str | None]:
    reads = FakeReads(case.get("raw"), USERS, case.get("unreadable") is True)
    sess = FakeSess(reads, py_user(case["user"]))
    if kind == "get":
        return legacy(E.editions_get(sess, case["payload"]), ids), None
    if kind == "mine":
        return legacy(E.editions_mine(sess, case["payload"]), ids), None
    dec = E.editions_set(sess, case["payload"])
    return legacy(dec.answer, ids), (dec.edits[0]["cells"]["Value"] if dec.edits else None)


RAWS = [None, "", "   ", "not json", "{}", "[]", "null", '{"id":"locations.house"}',
        '[null, 1, "x", [], {"id":"locations.house","on":true,"people":["a"," b ","a","",null,7,{"k":1}]}]',
        '[{"id":"staff.notes","on":true,"people":["U1"]},{"id":"staff.notes","on":false,"people":["U2"]}]',
        '  [ {"id":" ssa.notes ","on":"true","people":"U1"}, {"id":"nope.x","on":true,"people":["U1"]} ]',
        json.dumps([{"id": "family.calls", "on": True, "people": [f"P{i}" for i in range(140)]}]),
        json.dumps([{"id": "transportation.trips", "on": True, "people": ["U1", "U2", "123"]},
                    {"id": "locations.assets", "on": True, "people": ["U2"]},
                    {"id": "scheduling.builder", "on": False, "people": ["U1"]},
                    {"id": "clients.family", "on": 1, "people": ["U1"]}], ensure_ascii=False)]
SETS = [[{"id": "locations.house", "on": True, "people": ["U1", "U2", "U1", 123]},
         {"id": "staff.notes", "on": False, "people": []}, {"id": " ssa.notes ", "on": "true", "people": ["U3"]},
         {"id": "family.profile", "on": False, "people": ["U6"]}],
        [], [{"id": "staff.hr", "on": False, "people": []}],
        [{"id": "nope.x"}], [{"id": {"a": 1}}], [None], [["locations.house"]],
        [{"id": "staff.ist", "on": True}, {"id": "staff.ist", "on": True}],
        [{"id": "staff.ist", "on": True, "people": [f"U{i}" for i in range(101)]}],
        [{"id": "staff.ist", "on": True, "people": ["U1", "  "]}],
        [{"id": "staff.ist", "on": True, "people": ["U-nobody"]}],
        [{"id": "staff.ist", "on": True, "people": ["U5"]}],
        [{"id": "staff.ist", "on": True, "people": ["U4"]}],
        [{"id": "staff.ist", "on": True, "people": ["U7"]}],
        [{"id": "staff.ist", "on": True, "people": [{"x": 1}]}],
        "not a list"]


def files() -> None:
    print("the catalogue and the doors, against Editions.gs")
    cases: list[dict] = []
    for raw in RAWS:
        for who in ("master", "admin"):
            cases.append({"kind": "get", "raw": raw, "user": GS_USERS[who], "payload": {}})
    cases.append({"kind": "get", "raw": "[]", "unreadable": True, "user": GS_USERS["master"], "payload": {}})
    for p in SETS:
        cases.append({"kind": "set", "users": USERS, "user": GS_USERS["master"], "payload": {"editions": p}})
    cases.append({"kind": "set", "users": USERS, "user": GS_USERS["admin"], "payload": {"editions": []}})
    for raw in RAWS[-3:] + [None]:
        for who in GS_USERS:
            for app in ("", "vehicle-calendar", "locations", "staff-profiles", "nope"):
                cases.append({"kind": "mine", "raw": raw, "user": GS_USERS[who], "payload": {"app": app}})
    cases.append({"kind": "mine", "raw": RAWS[-1], "unreadable": True, "user": GS_USERS["staff"], "payload": {}})
    try:
        gs = node(cases)
    except Exception as exc:  # noqa: BLE001 - said as a failed check
        check("node runs Editions.gs", False, exc)
        return
    cat = gs["catalogue"]
    gs_ids = {e["id"] for e in cat["editions"]}
    check("the catalogue is the truth and Editions.gs a frozen subset of it: each .gs edition in the catalogue, in its "
          "order, with its app, name, label and description",
          [e for e in E.CATALOGUE if e["id"] in gs_ids] == cat["editions"], [e["id"] for e in cat["editions"]][:5])
    added = [e["id"] for e in E.CATALOGUE if e["id"] not in gs_ids]
    print("  fact editions only Python makes (Editions.gs never had them):", ", ".join(added) or "none")
    check("each edition only Python makes says it works while its app runs on Python, kept in the Hub's database",
          all("runs on Python" in e["description"] and "Hub's database" in e["description"]
              for e in E.CATALOGUE if e["id"] in added), added)
    import candidate_writes as CW  # noqa: PLC0415 - the writes modules that gate on these editions
    import client_candidate_writes as CCW  # noqa: PLC0415
    for app, name, mod, folder in (("staff-candidates", "Staff Candidates", CW, "staffcandidates"),
                                   ("client-candidates", "Client Candidates", CCW, "clientcandidates")):
        cnd = [i for i, e in enumerate(E.CATALOGUE) if e["app"] == app]
        cnd_ts = (ROOT / "src" / "pages" / "features" / folder / "candidateModel.ts").read_text(encoding="utf-8")
        cnd_ts = re.findall(r"'([A-Za-z.]+)'", cnd_ts[cnd_ts.index("export const CANDIDATE_EDITIONS = ["):
                                                      cnd_ts.index("] as const", cnd_ts.index("CANDIDATE_EDITIONS = ["))])
        check(f"{name}' editions ship together under their app, exactly the writes module's and the page's, in that "
              "order",
              bool(cnd) and [E.CATALOGUE[i]["id"] for i in cnd] == list(mod.EDITIONS) == cnd_ts
              and cnd == list(range(cnd[0], cnd[-1] + 1)) and all(E.CATALOGUE[i]["app_name"] == name for i in cnd),
              [len(cnd), len(mod.EDITIONS), cnd_ts])
    import smart_comms_desk as SCD  # noqa: PLC0415 - the Desk's read and save gate on these editions
    import smart_comms_doors as SCO  # noqa: PLC0415
    import smart_comms_writes as SCW  # noqa: PLC0415
    scm = [i for i, e in enumerate(E.CATALOGUE) if e["app"] == "smart-comms"]
    check("Smart Comms' editions ship together under their app, off: the save door's entries in the Desk read's family "
          "order, then the Replies verdict's, and no sending-line edition",
          bool(scm) and [E.CATALOGUE[i] for i in scm] == list(SCW.EDITIONS) + list(SCO.EDITIONS)
          and [E.CATALOGUE[i]["id"] for i in scm][:len(SCW.EDITIONS)] == [eid for _f, eid, _x, _w in SCW.FAMILIES]
          == list(SCD.DESK_EDITIONS) and scm == list(range(scm[0], scm[-1] + 1)) and SCW.EDITION_APP == "smart-comms"
          and "smartComms.line" not in E._BY_ID, [len(scm), len(SCW.EDITIONS), len(SCO.EDITIONS), len(SCD.DESK_EDITIONS)])
    check("the key, the roles a list may name and the people one list may hold are Editions.gs's",
          E.EDITIONS_KEY == cat["key"] and list(E.EDITION_ROLES) == cat["roles"] and E.EDITION_MAX_PEOPLE == cat["max"])
    ts = (ROOT / "src" / "lib" / "editions.ts").read_text(encoding="utf-8")
    ts_ids = re.findall(r"'([A-Za-z.]+)'", ts[ts.index("export const EDITION_IDS = ["):ts.index("] as const")])
    ids = [e for e, _a in E.IDS]
    check("the screen's list (editions.ts) and the relay overlay's list name the same editions in the same order",
          ts_ids == ids == list(eo.EDITION_IDS), [len(ts_ids), len(ids), len(eo.EDITION_IDS)])
    stray = [e for e, _a in sc.EDITIONS if e not in ids]
    check("every edition scope.py knows is in the catalogue", not stray, stray)
    lacking = [e for e in ids if e not in dict(sc.EDITIONS)]
    print("  fact scope.EDITIONS:", "derived from the catalogue" if list(sc.EDITIONS) == list(E.IDS)
          else "its own list still (lacking " + (", ".join(lacking) or "nothing; another order") + ")")
    same: dict[str, list[int]] = {"get": [], "set": [], "mine": []}
    for i, (case, got) in enumerate(zip(cases, gs["cases"])):
        kind = case["kind"]
        try:
            mine, value = py_answer(kind, case, gs_ids)
        except Exception as exc:  # noqa: BLE001 - a door that raises is a difference
            mine, value = {"raised": type(exc).__name__}, None
        if mine != got["res"] or (kind == "set" and value != got["saved"]):
            same[kind].append(i)
    check("editionsGet answers as the .gs does: every cell shape (blank, malformed, duplicates, unknown ids, a list "
          "over 100) and the master's 404 for anyone else, the 503 when the config cannot be read",
          not same["get"], same["get"][:6])
    check("editionsSet answers as the .gs does, refusal by refusal, and saves the very text JSON.stringify writes",
          not same["set"], same["set"][:6])
    check("editionsMine answers as the .gs does for the master, an admin, a manager, staff, a client, the service and "
          "an account without an id, per app and across apps, and opens nothing on a config it cannot read",
          not same["mine"], same["mine"][:6])


# ---- the relay's route, over stand-ins (once the tree carries it) ---------------------------------------------------

RELAY_NAMES = ("EDITIONS_PYTHON_ACTIONS", "EDITIONS_UNREAD", "EDITIONS_CONFIG_REFUSED", "BACKEND_FINAL_UNWRITTEN",
               "_BACKEND_EDITION_APPS", "_BACKEND_EDITION_ONLY", "_backend_editions_shut", "_backend_editions_cut",
               "_editions_in_config_save", "_editions_python", "_backend_settling", "EDITIONS_MINE_NONE",
               "EDITIONS_SAVES")


def relay() -> None:
    print("the relay")
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    if "EDITIONS_PYTHON_ACTIONS" not in text:
        print("  fact relay route to Python for Settings › Editions: not in the tree yet (wiring returned)")
        return
    import ast
    import asyncio
    import hashlib
    import time
    import urllib.parse
    found: dict[str, str] = {}
    for n in ast.parse(text).body:
        name = getattr(n, "name", None)
        if name is None and isinstance(n, (ast.Assign, ast.AnnAssign)):
            name = getattr(n.targets[0] if isinstance(n, ast.Assign) else n.target, "id", None)
        if name in RELAY_NAMES or name == "gas_relay":
            found[name] = ast.get_source_segment(text, n) or ""
    missing = [n for n in RELAY_NAMES if not found.get(n)]
    if missing:
        check("the relay's route for Settings › Editions is all there", False, missing)
        return
    gas = found.get("gas_relay", "")
    route, backend = gas.find("if action in EDITIONS_PYTHON_ACTIONS"), gas.find("await _backend_write(action, raw)")
    check("/gas sends the three doors to Python before any other path (the switch, the ledger, Apps Script)",
          0 < route < backend and gas.count('action == "editionsMine"') == 0, [route, backend])
    check("an editions save no longer opens the window that hands Python's reads to Apps Script",
          "editions_seen" not in found["_backend_settling"])

    class Response:
        def __init__(self, content: Any, media_type: str = "") -> None:
            self.body = content if isinstance(content, (bytes, str)) else json.dumps(content)

    calls: list[tuple] = []
    seen: list[str] = []
    voided: list[tuple] = []
    world = {"answer": {"status": 200, "data": {"editions": []}}, "fail": False, "unsure": "",
             "on_python": {"clients": False, "staff": False, "transportation": True}}

    async def session_actor(authorization: str) -> tuple[str, str] | None:
        return {"Bearer master": ("admin", "U5"), "Bearer staff": ("staff", "U1")}.get(authorization)

    async def pack_master(authorization: str) -> tuple[bool, str]:
        return authorization == "Bearer master", world["unsure"]

    async def backend_call(app_id: str, action: str, payload: dict, user: dict, extra: dict | None = None,
                           timeout: float | None = None) -> Any:
        calls.append((app_id, action, payload, user, extra))
        if world["fail"]:
            return None
        return b"", time.time(), json.loads(json.dumps({**world["answer"], "_write": {"final": True}})), None, 0.0

    async def wanted(app_id: str) -> bool:
        return world["on_python"].get(app_id, False)

    def envelope(raw: bytes) -> dict:
        return json.loads(urllib.parse.parse_qs(raw.decode())["body"][0])

    ns: dict[str, Any] = {"__name__": "relay_check", "time": time, "json": json, "re": re, "hashlib": hashlib,
                          "asyncio": asyncio, "Any": Any, "Response": Response, "HUB_APP_TOKEN": "t",
                          "log": __import__("logging").getLogger("relay-check"), "BACKEND_SETTLE_S": 900.0,
                          "_app_pack_people_at": [0.0], "_relay_envelope": envelope,
                          "_relay_is_service": lambda raw: b"service_secret" in raw[:4096],
                          "_session_actor": session_actor, "_app_pack_master": pack_master,
                          "_backend_call": backend_call, "_backend_wanted": wanted, "_traffic_note": lambda *a: None,
                          "_backend_settle_soon": lambda app, wid, state, *a, **k: voided.append((app, wid, state)),
                          "_edit_overlay_config_seen": lambda action, raw, content: seen.append(action)}
    exec(compile("from __future__ import annotations\n" + "\n\n".join(found[n] for n in RELAY_NAMES), "relay_check",
                 "exec"), ns)

    def ask(action: str, payload: dict, token: str = "master", **env: Any) -> dict:
        raw = urllib.parse.urlencode({"body": json.dumps({"action": action, "token": token, "payload": payload,
                                                          **env})}).encode()
        res = asyncio.run(ns["_editions_python"](action, raw))
        return json.loads(res.body)

    world["answer"] = {"status": 200, "data": {"editions": [], "malformed": False}}
    got = ask("editionsGet", {})
    check("editionsGet goes to asa-hub-app's editions door with the session the relay verified, its plan never shown",
          calls[-1][:2] == ("editions", "editionsGet") and calls[-1][3] == {"uid": "U5", "role": "admin", "is_master": True}
          and got == world["answer"], calls[-1:])
    world["fail"] = True
    n = len(calls)
    got = ask("editionsGet", {})
    check("a Python failure on the read is a 503 in the .gs words, never Apps Script's answer",
          got == {"status": 503, "message": ns["EDITIONS_UNREAD"]["editionsGet"]} and len(calls) == n + 1)
    got = ask("editionsSet", {"editions": []})
    wid = (calls[-1][4] or {}).get("write_id", "")
    check("a save Python did not answer is a 503 that says nothing was written, and its write id is taken back",
          got == {"status": 503, "message": ns["BACKEND_FINAL_UNWRITTEN"]} and bool(wid)
          and voided[-1:] == [("editions", wid, "void")], [got.get("status"), voided[-1:]])
    world["fail"] = False
    world["answer"] = {"status": 200, "data": {"editions": [{"id": "staff.ist", "on": True, "people": ["U1"]}],
                                               "malformed": False}}
    got = ask("editionsSet", {"editions": []}, write_id="Wcheck-relay-0001")
    check("a save Python kept is answered as Python said it, under the write id the screen sent, and the relay's "
          "overlay learns the list",
          got == world["answer"] and calls[-1][4] == {"write_id": "Wcheck-relay-0001"} and seen[-1:] == ["editionsSet"])
    check("and no settle window opens: Python's reads stay Python's", ns["_backend_settling"]() is False)
    n = len(calls)
    shut = ask("editionsMine", {"app": "staff-profiles"}, token="staff")
    check("editionsMine for an app on Apps Script whose editions only Python's doors make names none, without asking",
          shut == {"status": 200, "data": {"editions": []}} and len(calls) == n)
    world["answer"] = {"status": 200, "data": {"editions": ["clients.profile", "clients.family"]}}
    cut = ask("editionsMine", {"app": "client-profiles"}, token="staff")
    check("editionsMine as Python answered it, less an edition whose only door is Python's while its app is not",
          cut == {"status": 200, "data": {"editions": ["clients.profile"]}}, cut)
    n = len(calls)
    away = [ask("editionsMine", {}, token="staff", member="U9"), ask("editionsSet", {"editions": []}, member="U9"),
            ask("editionsGet", {}, world="w1"), ask("editionsMine", {}, token="staff", tenant="t1"),
            json.loads(asyncio.run(ns["_editions_python"]("editionsGet", urllib.parse.urlencode(
                {"body": json.dumps({"action": "editionsGet", "service_secret": "x", "payload": {}})}).encode())).body)]
    check("a visit, a world or a place away from home, and the machine identity, make no edition and never reach "
          "the master's doors (nothing asked of Python)",
          away == [{"status": 200, "data": {"editions": []}}, {"status": 404, "message": "Unknown action."},
                   {"status": 404, "message": "Unknown action."}, {"status": 200, "data": {"editions": []}},
                   {"status": 404, "message": "Unknown action."}] and len(calls) == n, away)
    world["answer"] = {"status": 200, "data": {"editions": ["transportation.trips"]}}
    got = ask("editionsMine", {"app": "vehicle-calendar"}, world="w1")
    check("in a world the master's own editions are still Python's answer", got == world["answer"] and len(calls) == n + 1)
    check("no session is a 401, an unsure master check a 503",
          ask("editionsGet", {}, token="") == {"status": 401, "message": "Authentication required."}
          and (world.update(unsure="x") or ask("editionsSet", {"editions": []}))["status"] == 503)
    world["unsure"] = ""
    said = lambda values: urllib.parse.urlencode({"body": json.dumps({"action": "hiringAlertsSet", "payload":
                                                                      {"values": values}})}).encode()
    check("the config door refuses a save that names the editions list, and passes any other",
          ns["_editions_in_config_save"](said({"mywork_editions": "[]"}))
          and not ns["_editions_in_config_save"](said({"mywork_hide_apps": ""})))


# ---- in asa-hub-db-sync: the doors on the live copy, through main's own dispatch ------------------------------------

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, re, resource, sys, time, types, uuid
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = blob["app"]


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)


sys.meta_path.insert(0, Checkout())
fake = types.ModuleType("fastapi")


class Resp:
    def __init__(self, content=b"", status_code=200, media_type="", headers=None):
        self.body = content if isinstance(content, (bytes, str)) else json.dumps(content)
        self.status_code, self.headers = status_code, dict(headers or {})


class App:
    def __init__(self, **_kw):
        pass

    def _route(self, *_a, **_kw):
        return lambda fn: fn
    get = post = _route


fake.FastAPI, fake.Request = App, object
responses = types.ModuleType("fastapi.responses")
responses.JSONResponse = lambda content, status_code=200, headers=None: Resp(content, status_code, "", headers)
responses.Response = Resp
conc = types.ModuleType("starlette.concurrency")


async def run_in_threadpool(fn, *a, **kw):
    return fn(*a, **kw)
conc.run_in_threadpool = run_in_threadpool
sys.modules.update({"fastapi": fake, "fastapi.responses": responses, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": conc})

import psycopg
import gsjs, hubdb, scope as sc, locations as L, writes as W, client_writes as CW, editions as E, sheet_sync as SS
import main as M

out, facts, carry = [], {}, {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_check"
W.LOCK_KEY = 0x454450594348


def rw(sql):
    return sql.replace("app.check_", "pg_temp.check_") if isinstance(sql, str) else sql


class Cur:
    def __init__(self, cur):
        self.c = cur

    def execute(self, sql, params=None):
        self.c.execute(rw(sql), params)
        return self

    def executemany(self, sql, rows):
        self.c.executemany(rw(sql), rows)
        return self

    def fetchone(self):
        return self.c.fetchone()

    def fetchall(self):
        return self.c.fetchall()


class Conn:
    def __init__(self, real):
        self.real = real

    @property
    def closed(self):
        return self.real.closed

    @property
    def broken(self):
        return self.real.broken

    def execute(self, sql, params=None):
        return Cur(self.real.cursor()).execute(sql, params)

    def cursor(self):
        return Cur(self.real.cursor())

    def transaction(self):
        return self.real.transaction()

    def close(self):
        pass


# the wiring this check stands in for while the tree does not carry it yet
wired = {"main": '"editions": editions' in SRC["main"], "scope": "editions.IDS" in SRC["scope"],
         "locations": "laid_config" in SRC["locations"]}
facts["wiring in the tree"] = ", ".join(f"{k} {'yes' if v else 'simulated'}" for k, v in wired.items())
if not wired["scope"]:
    sc.EDITIONS, sc.EDITIONS_KEY = E.IDS, E.EDITIONS_KEY
    sc.EDITION_ROLES, sc.EDITION_MAX_PEOPLE = E.EDITION_ROLES, E.EDITION_MAX_PEOPLE
    sc.editions_parse, sc.edition_allows = E.parse, E.allows
if not wired["locations"]:
    L.Reads.config = lambda self: self.once("config", lambda: E.laid_config(self.db, self.db.hiring_config()))
if not wired["main"]:
    M.APPS["editions"], M.WRITES["editions"] = E, E.WRITE

# the live copies, read on their own read-only connection; the edit store on transactions rolled back
db = hubdb.HubDb()
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="editions-python-check")
proxy = Conn(real)
store = W.Store(connect=lambda: proxy, kind="check", label="Check")
db.stale = lambda books: False
M.DB = db
M.stores = lambda: {"editions": store}
M.WRITE_BUDGET_S = 120.0
spent, seq = {}, [0]


class Rollback(Exception):
    pass


def rolled(name, fn):
    try:
        with real.transaction():
            fn()
            raise Rollback()
    except Rollback:
        pass
    except Exception as exc:  # noqa: BLE001 - said as a failed check, never a value
        check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:240])


def write(action, who, payload, wid=None):
    seq[0] += 1
    wid = wid or f"Wcheck-ed-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    t0 = time.monotonic()
    res = M._run_write(M.WRITES["editions"], action, who, payload, wid)
    spent[action] = max(spent.get(action, 0.0), time.monotonic() - t0)
    return res.status_code, json.loads(res.body), wid


def read(action, who, payload):
    t0 = time.monotonic()
    res = M._run(M.APPS["editions"], action, who, payload)
    spent[action] = max(spent.get(action, 0.0), time.monotonic() - t0)
    return res.status_code, json.loads(res.body)


def rows_of(wid):
    with real.cursor() as c:
        c.execute("select sheet_id, tab_name, kind, match_by, keyed_by, row_key, field, value, edition, action"
                  " from pg_temp.hub_edits_check where write_id = %s order by id", (wid,))
        return c.fetchall()


def laid(fn):
    own = CW.Own([], book=db.book, edits=store.edits(), edits_at=time.time())
    tok = hubdb.OWN.set(own)
    try:
        return fn(L.Reads(db, None))
    finally:
        hubdb.OWN.reset(tok)


reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
role_of = lambda u: (gsjs.str_(u.get("role")) or "staff").lower()
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
staff = [u for u in users if role_of(u) in ("staff", "manager") and not gsjs.str_(u.get("clientkey"))
         and gsjs.str_(u.get("active")).lower() != "false" and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT]
admin = next((u for u in users if role_of(u) == "admin" and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT),
             None)
client = next((u for u in users if role_of(u) == "client"), None)
said = lambda u, m=False: {"uid": gsjs.str_(u.get("userid")), "role": role_of(u), "is_master": m}
check("the master's account and two employees' accounts are read from the users tab", bool(master and len(staff) >= 2))
MASTER, HOLD, OTHER = said(master, True), said(staff[0]), said(staff[1])
HOLD_ID, MASTER_ID = HOLD["uid"], MASTER["uid"]
HOLDER, OTHER_USER = sc.user_from_row(staff[0]), sc.user_from_row(staff[1])
facts["runtime book is the book the config is read from"] = str(
    (db.prop("HUB_APPS_RUNTIME_ID") or hubdb.ESSENCIAL_ID) == hubdb.ESSENCIAL_ID)
with real.transaction():
    store.ensure()
check("the edit store is made in temp tables (the store's own ensure, a lock key nobody else takes)", store.ready(),
      store.why)
TARGET, T_APP = "transportation.settings", "vehicle-calendar"
T_LABEL = next(e["label"] for e in E.CATALOGUE if e["id"] == TARGET)
COPY_RAW = db.hiring_config().get(E.EDITIONS_KEY)


def sync_plan(value, evidence):
    sdb = SS.Db(rw=lambda: proxy, ro=lambda: proxy)
    cells = [c for c in sdb.edits() if c.sheet_id == hubdb.ESSENCIAL_ID and c.tab == "Facts"
             and c.row_key.endswith(evidence)]
    head = ["Fact Key", "Subject ID", "Value", "Type", "Source", "Evidence", "Recorded At", "Recorded By", "Instance ID"]
    old = [E.CONFIG_FACT_KEY, E.EDITIONS_KEY, "[]", "", E.CONFIG_SOURCE, "", "2026-01-05T10:00:00.000Z",
           "runtime-sheet", ""]
    other = [E.CONFIG_FACT_KEY, "hiring_timezone", "America/New_York", "", E.CONFIG_SOURCE, "",
             "2026-01-05T10:00:00.000Z", "runtime-sheet", ""]
    matrix = [head, old, other, list(old)]
    now = time.time()
    p1 = SS.TabMerge(hubdb.ESSENCIAL_ID, "Facts", SS.live_tab(matrix), cells, {}, lambda: None, now).run()
    line = p1.appends[0]["line"] if len(p1.appends) == 1 else []
    by = dict(zip(head, line))
    check("the two-way sync appends the save as one new fact of the depot's Facts, each cell under its column, and "
          "never edits an older fact of the same key",
          len(cells) == 7 and len(p1.appends) == 1 and not p1.updates and by.get("Subject ID") == E.EDITIONS_KEY
          and by.get("Source") == E.CONFIG_SOURCE and by.get("Value", "").lstrip("'") == value
          and by.get("Type") == "" and by.get("Instance ID") == "" and by.get("Evidence", "").lstrip("'") == evidence,
          [len(cells), len(p1.appends), len(p1.updates)])
    shown = [v.lstrip("'") for v in line]
    states = {c.key: {"edit_id": c.edit_id, "state": "synced", "base": shown[head.index(c.field)],
                      "sheet_value": shown[head.index(c.field)], "seen_at": now, "checked_at": now} for c in cells}
    p2 = SS.TabMerge(hubdb.ESSENCIAL_ID, "Facts", SS.live_tab(matrix + [shown]), cells, states, lambda: None,
                     now + 600).run()
    check("its next cycle finds that row by its key and writes nothing again (every cell synced)",
          not p2.appends and not p2.updates and len(p2.states) == 7 and all(s["state"] == "synced" for s in p2.states),
          [len(p2.appends), len(p2.updates), sorted({s["state"] for s in p2.states})])


def the_save():
    code, env = read("editionsGet", MASTER, {})
    ok = code == 200 and env.get("status") == 200 and isinstance((env.get("data") or {}).get("editions"), list)
    check("editionsGet as the master answers 200 with the list", ok, [code, env.get("status"), env.get("message")])
    if not ok:
        return
    listed = env["data"]["editions"]
    carry["view"], carry["malformed"], carry["raw"] = listed, env["data"]["malformed"], COPY_RAW
    check("every catalogue edition is in the view once, in catalogue order, with its app, name, label and description",
          [e["id"] for e in listed] == [e for e, _a in E.IDS]
          and all({k: v for k, v in e.items() if k not in ("on", "people", "badge")} == c for e, c in zip(listed, E.CATALOGUE)))
    payload = [{"id": e["id"], "on": e["on"], "people": list(e["people"])} for e in listed]
    t = next(p for p in payload if p["id"] == TARGET)
    t["on"], t["people"] = True, [p for p in t["people"] if p != HOLD_ID] + [HOLD_ID]
    code, env, wid = write("editionsSet", MASTER, {"editions": payload})
    if env.get("status") == 400 and ("No account" in str(env.get("message")) or "employees only" in str(env.get("message"))):
        facts["the saved list names an account the save refuses today"] = "yes: the save is checked on one edition"
        payload = [{"id": TARGET, "on": True, "people": [HOLD_ID]}]
        code, env, wid = write("editionsSet", MASTER, {"editions": payload})
    expected = json.dumps([p for p in payload if p["on"] or p["people"]], separators=(",", ":"), ensure_ascii=False)
    got_t = next((e for e in (env.get("data") or {}).get("editions") or [] if e.get("id") == TARGET), {})
    check("editionsSet as the master answers 200 with every edition, the one changed laid in",
          code == 200 and env.get("status") == 200 and (env.get("data") or {}).get("malformed") is False
          and got_t.get("on") is True and HOLD_ID in (got_t.get("people") or []), [code, env.get("status")])
    plan = env.get("_write") or {}
    check("the save is final in Postgres: no ledger, no Apps Script", plan.get("final") is True and plan.get("engine") is False,
          plan)
    rows = rows_of(wid)
    cells = {r[6]: r[7] for r in rows}
    evidence = cells.get("Evidence", "")
    key = "\x1f".join((E.EDITIONS_KEY, E.CONFIG_SOURCE, evidence))
    check("app.edits keeps one appended fact of the depot's Facts, keyed by its subject, its source and the save "
          "(never a row number), in the master's name (no edition)",
          len(rows) == 7 and all(r[0] == hubdb.ESSENCIAL_ID and r[1] == "Facts" and r[2] == "append"
                                 and r[3] == E.KEY_MATCH and r[4] == "header" and r[5] == key and r[8] == ""
                                 and r[9] == "editionsSet" for r in rows), [len(rows), sorted({r[3] for r in rows})])
    check("the fact names the config key and carries the list as JSON.stringify writes it",
          cells.get("Subject ID") == E.EDITIONS_KEY and cells.get("Source") == E.CONFIG_SOURCE
          and cells.get("Fact Key") == E.CONFIG_FACT_KEY and cells.get("Value") == expected
          and cells.get("Recorded By") == E.RECORDED_BY and evidence.startswith(E.EVIDENCE)
          and bool(re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", cells.get("Recorded At", ""))),
          sorted(cells))
    check("the key is the writes.COLS match the overlay and the sync read", E.KEY_MATCH == W.COLS + W.COLS_SEP.join(E.KEY_HEADS))
    with real.cursor() as c:
        c.execute("select count(*) from pg_temp.check_receipts where write_id = %s", (wid,))
        check("its receipt is kept under its write id", c.fetchone()[0] == 1)
    code2, env2 = read("editionsGet", MASTER, {})
    check("the next editionsGet shows the save at once (app.edits laid over the copy)",
          code2 == 200 and (env2.get("data") or {}).get("editions") == env["data"]["editions"])
    check("scope.edition_allows reads the laid value: the listed person makes the edition now, another does not",
          laid(lambda r: sc.edition_allows(TARGET, HOLDER, r.config()))
          and not laid(lambda r: sc.edition_allows(TARGET, OTHER_USER, r.config())))
    _c, mine = read("editionsMine", HOLD, {"app": T_APP})
    _c, mine_o = read("editionsMine", OTHER, {"app": T_APP})
    _c, mine_m = read("editionsMine", MASTER, {"app": T_APP})
    check("editionsMine names the edition for the listed person and not for one off the list; every one of the app "
          "for the master",
          TARGET in (mine.get("data") or {}).get("editions", []) and TARGET not in (mine_o.get("data") or {}).get("editions", [])
          and (mine_m.get("data") or {}).get("editions") == [e for e, a in E.IDS if a == T_APP])
    _c, env6, _w = write("editionsSet", MASTER, {"editions": payload}, wid=wid)
    check("the same write id again is answered from its receipt, nothing added",
          (env6.get("_write") or {}).get("replay") is True and len(rows_of(wid)) == 7)
    sync_plan(expected, evidence)
    keep = E._held
    E._held = lambda _db, wanted: frozenset(wanted)
    try:
        check("once the copy holds a save, the copy's own order decides (a later fact there is never covered)",
              laid(lambda r: r.config().get(E.EDITIONS_KEY)) == COPY_RAW)
    finally:
        E._held = keep
    t["on"] = False
    _c, env7, _w7 = write("editionsSet", MASTER, {"editions": payload})
    check("a later save wins at once: its key off, the listed person makes the edition no more",
          env7.get("status") == 200 and not laid(lambda r: sc.edition_allows(TARGET, HOLDER, r.config())))


def the_refusals():
    cases = [("an edition the platform does not have", MASTER, {"editions": [{"id": "nope.edition", "on": True}]},
              400, 'No edition "nope.edition". Nothing was saved.'),
             ("more people than one list holds", MASTER,
              {"editions": [{"id": TARGET, "on": True, "people": [f"U-check-{i}" for i in range(101)]}]},
              400, "At most 100 people on one edition. Nothing was saved."),
             ("an edition named twice", MASTER, {"editions": [{"id": TARGET}, {"id": TARGET}]},
              400, T_LABEL + " is named twice. Nothing was saved."),
             ("an account that does not exist", MASTER,
              {"editions": [{"id": TARGET, "on": True, "people": ["U-nobody-check"]}]},
              400, 'No account "U-nobody-check". Nothing was saved.'),
             ("the master on a list", MASTER, {"editions": [{"id": TARGET, "on": True, "people": [MASTER_ID]}]},
              400, "The master account holds every edition; it is never put on a list. Nothing was saved."),
             ("no list at all", MASTER, {}, 400, "Missing required parameter: editions."),
             ("a list that is not an array", MASTER, {"editions": "x"}, 400, "editions must be array, got string."),
             ("an employee", HOLD, {"editions": []}, 403, "This action is for admin.")]
    if admin:
        cases.append(("an admin who is not the master", said(admin), {"editions": []}, 404, "Unknown action."))
    for name, who, payload, status, message in cases:
        _c, env, wid = write("editionsSet", who, payload)
        check(f"editionsSet refuses {name} in the .gs words, and keeps nothing",
              env.get("status") == status and env.get("message") == message and not rows_of(wid),
              [env.get("status"), env.get("message"), len(rows_of(wid))])
    if client:
        _c, env, wid = write("editionsSet", MASTER, {"editions": [{"id": TARGET, "on": True,
                                                                   "people": [gsjs.str_(client.get("userid"))]}]})
        msg = str(env.get("message") or "")
        check("editionsSet refuses a client account on a list (editions are for employees), and keeps nothing",
              env.get("status") == 400 and msg.startswith("Editions are for employees only (admin, manager or staff); ")
              and msg.endswith(" is client. Nothing was saved.") and not rows_of(wid), env.get("status"))
    _c, env = read("editionsGet", HOLD, {})
    check("editionsGet for an employee is refused by the declared roles, as the .gs gate refuses it",
          env == {"status": 403, "message": "This action is for admin."}, env.get("status"))
    if admin:
        _c, env = read("editionsGet", said(admin), {})
        check("editionsGet for an admin who is not the master is the unadvertised 404", env == {"status": 404,
                                                                                                "message": "Unknown action."})
    if client:
        _c, env = read("editionsMine", said(client), {"app": T_APP})
        check("editionsMine for a client account is refused by the declared roles",
              env == {"status": 403, "message": "This action is for admin or manager or staff."}, env.get("status"))


def the_config_unread():
    keep = db.hiring_config

    def unreadable():
        raise hubdb.Unreadable("check")
    try:
        db.hiring_config = unreadable
        _c, env = read("editionsGet", MASTER, {})
        check("a config that cannot be read is a 503 in the .gs words, never a list of nobody",
              env == {"status": 503, "message": E.CONFIG_UNREAD}, env.get("status"))
        _c, mine = read("editionsMine", HOLD, {"app": T_APP})
        _c, mine_m = read("editionsMine", MASTER, {"app": T_APP})
        check("editionsMine on a config that cannot be read opens nothing for a person, every edition for the master",
              mine == {"status": 200, "data": {"editions": []}}
              and (mine_m.get("data") or {}).get("editions") == [e for e, a in E.IDS if a == T_APP])
        for cell in ("{", "{}"):
            db.hiring_config = lambda c=cell: {**keep(), E.EDITIONS_KEY: c}
            _c, env = read("editionsGet", MASTER, {})
            data = env.get("data") or {}
            check(f"a malformed cell ({'not JSON' if cell == '{' else 'not a list'}) is said malformed and opens nothing",
                  data.get("malformed") is True and len(data.get("editions") or []) == len(E.CATALOGUE)
                  and not any(e.get("on") or e.get("people") for e in data["editions"]))
    finally:
        db.hiring_config = keep


t0 = time.time()
rolled("the save", the_save)
rolled("the refusals", the_refusals)
rolled("the config unread", the_config_unread)
facts["the whole run (s)"] = f"{time.time() - t0:.1f}"
try:
    real.close()
except Exception:
    pass
with psycopg.connect(hubdb._dsn(), autocommit=True, connect_timeout=5) as c2:
    left = c2.execute("select count(*) from pg_stat_activity where application_name = 'editions-python-check'").fetchone()[0]
    live_edits = c2.execute("select to_regclass('app.edits') is not null").fetchone()[0]
check("nothing is left: the check's session is gone, its temp tables with it", left == 0, left)
facts["app.edits in the live database"] = "exists (untouched by this check)" if live_edits else "not made yet (untouched)"
facts["slowest answer per door (s)"] = ", ".join(f"{a} {t:.2f}" for a, t in sorted(spent.items()))
facts["peak memory (MiB)"] = str(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024)
print(json.dumps({"checks": out, "facts": facts, "carry": carry}))
'''


def live() -> None:
    print("the doors on the live copy (asa-hub-db-sync)")
    blob = {"app": {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=900)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        check("the driver ran in asa-hub-db-sync", False, got.stderr.decode()[-1500:])
        return
    res = json.loads(lines[-1])
    for name, ok, detail in res["checks"]:
        check(name, ok, detail)
    carry = res.get("carry") or {}
    if "view" in carry:
        # the copy's own cell, run through Editions.gs by node: the view and the malformed flag the .gs would answer
        gs = node([{"kind": "get", "raw": carry["raw"], "user": GS_USERS["master"], "payload": {}}])["cases"][0]["res"]
        gs_ids = {e["id"] for e in gs.get("data", {}).get("editions") or []}
        check("on the live cell, the master's view is the one Editions.gs draws, edition by edition (the editions "
              "only Python makes aside)",
              gs.get("status") == 200 and gs["data"]["editions"] == [e for e in carry["view"] if e["id"] in gs_ids]
              and gs["data"]["malformed"] == carry["malformed"])
    for k, v in res["facts"].items():
        print(f"  fact {k}: {v}")


def main() -> int:
    files()
    relay()
    if "--static" not in sys.argv:
        live()
    print(f"{results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
