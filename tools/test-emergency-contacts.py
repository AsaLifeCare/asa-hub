#!/usr/bin/env python3
"""Emergency Contacts on Python, kept in Postgres (app/emergency_contacts.py). The files: the seed is the SPA's
compiled DEFAULT_GROUPS, the edition sits in the catalogue, the relay registers the app in Settings › Back-end per app.
The relay's route over stand-ins: the switch absent answers the compiled marker and refuses the save without asking
anybody, Python's answers pass, a failure is a 503, a kept save rings the app. And in asa-hub-db-sync, through main's
own dispatch on real accounts: the tables made and seeded by the store's ensure, the read as the master, a staff member
and a listed edition holder, every save op allowed for the master and the holder and refused for a person not listed,
a stale witness 409, a lane removed with its contacts, the audit rows, a replay, and a save taken back. Nothing real is
written: the tables are temp tables, every change inside a transaction rolled back. Prints shapes and counts only."""
from __future__ import annotations

import ast
import asyncio
import base64
import hashlib
import json
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))

import editions as E  # noqa: E402
import emergency_contacts as EC  # noqa: E402

DB_RUNNER = "asa-hub-db-sync"
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


# ---- 1. the files ------------------------------------------------------------------------------------------------------

def ts_groups() -> list[dict]:
    """DEFAULT_GROUPS as HelpfulContacts.tsx writes it."""
    src = (ROOT / "src" / "pages" / "features" / "suggestions" / "HelpfulContacts.tsx").read_text(encoding="utf-8")
    block = src[src.index("export const DEFAULT_GROUPS"):src.index("\n]\n", src.index("export const DEFAULT_GROUPS"))]
    out = []
    for g in re.finditer(r"id: '([^']+)', label: '([^']+)', icon: '([^']+)',\s*chip: '([^']+)',\s*contacts: \[(.*?)\]",
                         block, re.S):
        contacts = []
        for c in re.finditer(r"\{ name: '([^']*)'(?:, note: '([^']*)')?, phone: '([^']*)' \}", g.group(5)):
            contacts.append({"name": c.group(1), "note": c.group(2) or "", "phone": c.group(3)})
        out.append({"id": g.group(1), "label": g.group(2), "icon": g.group(3), "chip": g.group(4), "contacts": contacts})
    return out


def files() -> None:
    print("the files")
    ts = ts_groups()
    py = [{**g, "contacts": list(g["contacts"])} for g in EC.DEFAULT_GROUPS]
    check("the seed is the SPA's compiled DEFAULT_GROUPS: the same lanes, order, labels, icons, chips and contacts",
          ts == py and len(ts) == 4 and sum(len(g["contacts"]) for g in ts) == 15, [g["id"] for g in ts])
    check("every seeded chip is one the lane colours offer, and the SPA writes each colour's classes whole",
          all(g["chip"] in EC.CHIPS for g in EC.DEFAULT_GROUPS)
          and all(c in (ROOT / "src/pages/features/emergencycontacts/emergencyContactsModel.ts").read_text() for c in EC.CHIPS))
    row = next((e for e in E.CATALOGUE if e["id"] == EC.EDITION), None)
    check("the edition is in the Python catalogue under Emergency Contacts, saying where the directory is kept",
          row is not None and row["app"] == "emergency-contacts" and row["app_name"] == "Emergency Contacts"
          and row["label"] == "Directory — every lane and contact"
          and row["description"].endswith("The directory is kept in the Hub's database.")
          and E.IDS[-1] == (EC.EDITION, EC.APP_ID), row)
    gs = (ROOT / "apps-script" / "Editions.gs").read_text(encoding="utf-8")
    check("no Apps Script names the app's doors or its edition", "emergencyContacts" not in gs and not any(
        "emergencyContacts" in p.read_text(encoding="utf-8", errors="ignore") for p in (ROOT / "apps-script").glob("*.gs")))
    doors = json.loads((ROOT / "app" / "doors.json").read_text(encoding="utf-8"))
    check("both doors are declared Python's own (app/doors.json): the read on the read lane, the save on the write lane",
          (doors.get("emergencyContactsRead") or {}).get("lane") == "read"
          and (doors.get("emergencyContactsSave") or {}).get("lane") == "write"
          and all((doors.get(a) or {}).get("file") == "app/emergency_contacts.py"
                  for a in ("emergencyContactsRead", "emergencyContactsSave")))
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    tree = {getattr(n.targets[0] if isinstance(n, ast.Assign) else n.target, "id", None): n
            for n in ast.parse(text).body if isinstance(n, (ast.Assign, ast.AnnAssign))}
    seg = ast.get_source_segment(text, tree["BACKEND_APPS"]) or ""
    entry = seg[seg.index('"emergency-contacts"'):] if '"emergency-contacts"' in seg else ""
    check("Settings › Back-end per app lists Emergency Contacts: its read, its save, final",
          '"label": "Emergency Contacts"' in entry and 'frozenset({"emergencyContactsRead"})' in entry
          and entry.count('frozenset({"emergencyContactsSave"})') == 2, entry[:200])
    no_receipt = ast.get_source_segment(text, tree["RELAY_NO_RECEIPT_ACTIONS"]) or ""
    editions_apps = ast.get_source_segment(text, tree["_BACKEND_EDITION_APPS"]) or ""
    check("both doors are no-receipt actions, and the edition is offered only while the app runs on Python",
          '"emergencyContactsRead"' in no_receipt and '"emergencyContactsSave"' in no_receipt
          and '"emergency-contacts": "emergency-contacts"' in editions_apps)
    gas = text[text.index("async def gas_relay"):text.index("# -------", text.index("async def gas_relay"))]
    route, backend = gas.find("if action in EMERGENCY_CONTACTS_ACTIONS"), gas.find("await _backend_write(action, raw)")
    check("/gas routes both doors before the switch's write path, the ledger and Apps Script", 0 < route < backend,
          [route, backend])
    main = (ROOT / "app" / "main.py").read_text(encoding="utf-8")
    check("asa-hub-app registers the app: its read, its save, its store and its health",
          '"emergency-contacts": emergency_contacts' in main and '"emergency-contacts": emergency_contacts.WRITE' in main
          and '"emergency-contacts": EMERGENCY_CONTACTS_STORE' in main and "emergency_contacts_writes" in main)


# ---- 2. the relay's route, over stand-ins ------------------------------------------------------------------------------

RELAY_NAMES = ("BACKEND_FINAL_UNWRITTEN", "EMERGENCY_CONTACTS_EVENT", "_emergency_contacts_rang", "EMERGENCY_CONTACTS_APP",
               "EMERGENCY_CONTACTS_READ", "EMERGENCY_CONTACTS_ACTIONS", "EMERGENCY_CONTACTS_COMPILED",
               "EMERGENCY_CONTACTS_OFF", "EMERGENCY_CONTACTS_UNREAD", "_emergency_contacts")


def relay() -> None:
    print("the relay")
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    found: dict[str, str] = {}
    for n in ast.parse(text).body:
        name = getattr(n, "name", None)
        if name is None and isinstance(n, (ast.Assign, ast.AnnAssign)):
            name = getattr(n.targets[0] if isinstance(n, ast.Assign) else n.target, "id", None)
        if name in RELAY_NAMES:
            found[name] = ast.get_source_segment(text, n) or ""
    missing = [n for n in RELAY_NAMES if not found.get(n)]
    if missing:
        check("the relay's route for Emergency Contacts is all there", False, missing)
        return

    class Response:
        def __init__(self, content: Any, media_type: str = "") -> None:
            self.body = content

    calls: list[tuple] = []
    rang: list[str] = []
    voided: list[tuple] = []
    world: dict[str, Any] = {"python": False, "answer": {"status": 200, "data": {}}, "fail": False, "unsure": "",
                             "settling": False}

    async def session_actor(authorization: str) -> tuple[str, str] | None:
        return {"Bearer master": ("admin", "U5"), "Bearer staff": ("staff", "U1")}.get(authorization)

    async def pack_master(authorization: str) -> tuple[bool, str]:
        return authorization == "Bearer master", world["unsure"]

    async def wanted(app_id: str) -> bool:
        return app_id == "emergency-contacts" and world["python"]

    async def backend_call(app_id: str, action: str, payload: dict, user: dict, extra: dict | None = None,
                           timeout: float | None = None) -> Any:
        calls.append((app_id, action, payload, user, extra))
        if world["fail"]:
            return None
        return b"", time.time(), json.loads(json.dumps(world["answer"])), None, 0.0

    def envelope(raw: bytes) -> dict:
        return json.loads(urllib.parse.parse_qs(raw.decode())["body"][0])

    ns: dict[str, Any] = {"__name__": "relay_check", "time": time, "json": json, "re": re, "hashlib": hashlib,
                          "Any": Any, "Response": Response, "HUB_APP_TOKEN": "t",
                          "log": __import__("logging").getLogger("relay-check"), "_relay_envelope": envelope,
                          "_relay_is_service": lambda raw: b"service_secret" in raw[:4096],
                          "_session_actor": session_actor, "_app_pack_master": pack_master,
                          "_backend_wanted": wanted, "_backend_call": backend_call, "_traffic_note": lambda *a: None,
                          "_backend_settling": lambda: world["settling"], "_publish_slice": rang.append,
                          "_backend_settle_soon": lambda app, wid, state, *a, **k: voided.append((app, wid, state))}
    exec(compile("from __future__ import annotations\n" + "\n\n".join(found[n] for n in RELAY_NAMES), "relay_check",
                 "exec"), ns)

    def ask(action: str, payload: dict, token: str = "master", **env: Any) -> dict:
        raw = urllib.parse.urlencode({"body": json.dumps({"action": action, "token": token, "payload": payload,
                                                          **env})}).encode()
        return json.loads(asyncio.run(ns["_emergency_contacts"](action, raw)).body)

    save = {"op": "contact.remove", "id": "c1", "expected": {}}
    got = [ask("emergencyContactsRead", {}), ask("emergencyContactsRead", {}, token="staff")]
    refused = ask("emergencyContactsSave", save)
    check("the switch absent: the read answers the compiled marker and the save is refused, nobody asked (no Apps "
          "Script, no Python)",
          got == [{"status": 200, "data": {"source": "compiled"}}] * 2 and refused["status"] == 403
          and "Nothing was saved." in refused["message"] and not calls and not rang, [got, refused, calls])
    check("no session is a 401 before the switch is read", ask("emergencyContactsRead", {}, token="")
          == {"status": 401, "message": "Authentication required."})
    world["python"] = True
    away = [ask("emergencyContactsRead", {}, member="U9"), ask("emergencyContactsRead", {}, world="w1"),
            ask("emergencyContactsSave", save, tenant="t1"),
            json.loads(asyncio.run(ns["_emergency_contacts"]("emergencyContactsRead", urllib.parse.urlencode(
                {"body": json.dumps({"action": "emergencyContactsRead", "service_secret": "x", "payload": {}})}
            ).encode())).body)]
    check("on Python, a visit, a world, a place away from home and the machine identity get the compiled directory "
          "and no save, Python never asked",
          away[0] == away[1] == away[3] == {"status": 200, "data": {"source": "compiled"}} and away[2]["status"] == 403
          and not calls, away)
    world["answer"] = {"status": 200, "data": {"groups": [], "can_edit": False, "source": "python"}}
    got = ask("emergencyContactsRead", {}, token="staff")
    check("on Python the read is asa-hub-app's, with the session the relay verified, answered as it said",
          got == world["answer"] and calls[-1][:2] == ("emergency-contacts", "emergencyContactsRead")
          and calls[-1][3] == {"uid": "U1", "role": "staff", "is_master": False} and calls[-1][4] is None and not rang)
    world["fail"] = True
    got = ask("emergencyContactsRead", {})
    check("a Python failure on the read is a 503 (the page draws its compiled directory), never Apps Script",
          got["status"] == 503 and not voided)
    got = ask("emergencyContactsSave", save, write_id="Wcheck-ec-0001")
    check("a save Python did not answer is a 503 that says nothing was written, and its write id is taken back",
          got == {"status": 503, "message": ns["BACKEND_FINAL_UNWRITTEN"]}
          and voided[-1:] == [("emergency-contacts", "Wcheck-ec-0001", "void")], [got, voided[-1:]])
    world["fail"] = False
    world["answer"] = {"status": 200, "data": {"removed": {"contact": "c1"}}, "_write": {"x": 1}}
    got = ask("emergencyContactsSave", save, write_id="Wcheck-ec-0002")
    check("a save Python kept is answered as it said (its plan never shown), under the screen's write id, and the app "
          "rings so every open page reads again",
          got == {"status": 200, "data": {"removed": {"contact": "c1"}}} and calls[-1][4] == {"write_id": "Wcheck-ec-0002"}
          and rang == ["emergency-contacts"], [got, rang])
    n = len(calls)
    ask("emergencyContactsSave", save, token="staff", write_id="bad id")
    stamped = (calls[-1][4] or {}).get("write_id", "")
    check("an unusable write id is stamped by the relay", len(calls) == n + 1 and re.fullmatch(r"W[0-9a-f]{24}", stamped),
          stamped)
    world["answer"] = {"status": 409, "data": {"written": ["name"], "current": {"phone": "x"}}, "message": "m"}
    ask("emergencyContactsSave", save)
    world["answer"] = {"status": 409, "data": {"written": [], "current": {"phone": "x"}}, "message": "m"}
    ask("emergencyContactsSave", save)
    world["answer"] = {"status": 404, "message": "Unknown action."}
    ask("emergencyContactsSave", save, token="staff")
    check("a 409 that saved some fields rings too; a refusal that saved nothing never rings",
          rang == ["emergency-contacts"] * 3, rang)
    world["settling"] = True
    n = len(calls)
    held = ask("emergencyContactsSave", save, token="staff")
    ask("emergencyContactsSave", save)
    read = ask("emergencyContactsRead", {}, token="staff")
    check("while who reads what settles, a person's save waits (503, Python not asked); the master's goes, and reads go",
          held["status"] == 503 and len(calls) == n + 2 and calls[-2][1] == "emergencyContactsSave"
          and calls[-1][1] == "emergencyContactsRead" and read["status"] == 404, [held, len(calls) - n])
    world["settling"] = False
    world["unsure"] = "x"
    check("an unsure master check is a 503", ask("emergencyContactsRead", {})["status"] == 503)


# ---- 3. in asa-hub-db-sync: the doors on real accounts, through main's own dispatch --------------------------------

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, re, sys, time, types, uuid
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
import gsjs, hubdb, scope as sc, locations as L, writes as W, emergency_contacts as EC
import main as M

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_check"
W.LOCK_KEY = 0x454D45524743
EC.GROUPS_TABLE, EC.CONTACTS_TABLE, EC.AUDIT_TABLE = "pg_temp.ec_groups_check", "pg_temp.ec_contacts_check", \
    "pg_temp.ec_audit_check"


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


db = hubdb.HubDb()
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="emergency-contacts-check")
proxy = Conn(real)
store = EC.Store(connect=lambda: proxy)
store.kind = "check"
EC.bind(store)
db.stale = lambda books: False
CFG = {"editions": "[]"}
base_cfg = db.hiring_config
db.hiring_config = lambda: {**base_cfg(), sc.EDITIONS_KEY: CFG["editions"], sc.MYWORK_APPS_KEY: ""}
RELEASED = {"badges": []}
base_rules = L.Reads.app_rules


def rules(self):
    got = base_rules(self)
    return {"rules": {**(got.get("rules") or {}), EC.APP_ID: list(RELEASED["badges"])},
            "tenants": {k: v for k, v in (got.get("tenants") or {}).items() if k != EC.APP_ID}}


L.Reads.app_rules = rules
M.DB = db
M.stores = lambda: {"emergency-contacts": store}
M.WRITE_BUDGET_S = 120.0
seq = [0]


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


def save(who, payload, wid=None):
    seq[0] += 1
    wid = wid or f"Wcheck-ec-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    res = M._run_write(M.WRITES["emergency-contacts"], "emergencyContactsSave", who, payload, wid)
    return json.loads(res.body), wid


def read(who):
    res = M._run(M.APPS["emergency-contacts"], "emergencyContactsRead", who, {})
    return json.loads(res.body)


def audit(wid):
    with real.cursor() as c:
        c.execute("select author, edition, op, entity, entity_id, before, after from pg_temp.ec_audit_check"
                  " where write_id = %s order by id", (wid,))
        return c.fetchall()


def listed(on=True, people=()):
    CFG["editions"] = json.dumps([{"id": EC.EDITION, "on": on, "people": list(people)}])


def lane(env, gid):
    groups = ((env.get("data") or {}).get("directory") or env.get("data") or {}).get("groups") or []
    return next((g for g in groups if g["id"] == gid), None)


def groups_of(env):
    return ((env.get("data") or {}).get("directory") or env.get("data") or {}).get("groups") or []


reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
role_of = lambda u: (gsjs.str_(u.get("role")) or "staff").lower()
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
staff = [u for u in users if role_of(u) in ("staff", "manager") and not gsjs.str_(u.get("clientkey"))
         and gsjs.str_(u.get("active")).lower() != "false" and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT
         and EC.APP_ID not in (sc.user_from_row(u).get("app_denials") or [])]
said = lambda u, m=False: {"uid": gsjs.str_(u.get("userid")), "role": role_of(u), "is_master": m}
check("the master's account and two employees' accounts are read from the users tab", bool(master and len(staff) >= 2))
MASTER, HOLD, OTHER = said(master, True), said(staff[0]), said(staff[1])
HOLD_NAME = W.who(sc.user_from_row(staff[0]))
with real.transaction():
    store.ensure()
check("the store's ensure makes the directory's tables (temp stand-ins) and seeds them", store.ready() and store._own,
      store.why)
with real.cursor() as c:
    c.execute("select op, author from pg_temp.ec_audit_check order by id")
    seeded = c.fetchall()
check("the seed is written once and said on the audit", seeded == [("seed", EC.AUTHOR)], seeded)
store._own = False
with real.transaction():
    store.ensure()
with real.cursor() as c:
    c.execute("select count(*) from pg_temp.ec_audit_check where op = 'seed'")
    again = c.fetchone()[0]
    c.execute("select count(*) from pg_temp.ec_contacts_check")
    count = c.fetchone()[0]
check("an ensure again (a restart) seeds nothing more", again == 1 and count == 15, [again, count])


def the_reads():
    env = read(MASTER)
    data = env.get("data") or {}
    want = [{"id": g["id"], "label": g["label"], "icon": g["icon"], "chip": g["chip"], "order": i + 1,
             "contacts": [{"id": f"{g['id']}-{j + 1}", **c, "order": j + 1} for j, c in enumerate(g["contacts"])]}
            for i, g in enumerate(EC.DEFAULT_GROUPS)]
    check("the master reads the seeded directory: DEFAULT_GROUPS, lane by lane, contact by contact, in order",
          env.get("status") == 200 and data.get("groups") == want and data.get("source") == "python"
          and data.get("can_edit") is True, [env.get("status"), [g["id"] for g in data.get("groups") or []]])
    env = read(OTHER)
    check("unreleased (no App Control row), a staff member is told the door does not exist",
          env == {"status": 404, "message": "Unknown action."}, env)
    RELEASED["badges"] = ["STAFF", "MANAGER", "ADMIN", "DIRECTOR"]
    env = read(OTHER)
    check("released to their badge, a staff member reads it and may not change it",
          env.get("status") == 200 and (env.get("data") or {}).get("can_edit") is False
          and len((env.get("data") or {}).get("groups") or []) == 4, env.get("status"))
    listed(True, [HOLD["uid"]])
    check("a person the edition lists, its key on, may change it; another person still may not",
          (read(HOLD).get("data") or {}).get("can_edit") is True and (read(OTHER).get("data") or {}).get("can_edit") is False)
    listed(False, [HOLD["uid"]])
    check("the key off, the listed person may not change it", (read(HOLD).get("data") or {}).get("can_edit") is False)


def the_saves():
    RELEASED["badges"] = ["STAFF", "MANAGER", "ADMIN", "DIRECTOR"]
    listed(True, [HOLD["uid"]])
    add = {"op": "contact.add", "contact": {"group": "hospitals", "name": "  Mercy  Urgent Care ", "phone": "330.555.0142",
                                            "note": "Walk-in", "order": 1}}
    env, wid = save(HOLD, add)
    h = lane(env, "hospitals") or {}
    made = (env.get("data") or {}).get("contact") or {}
    check("the holder adds a contact: its phone formatted, its name folded, first in its lane, the lane renumbered",
          env.get("status") == 200 and made.get("phone") == "(330) 555-0142" and made.get("name") == "Mercy Urgent Care"
          and [c["name"] for c in h.get("contacts") or []][:2] == ["Mercy Urgent Care", "Aultman Hospital"]
          and [c["order"] for c in h.get("contacts") or []] == [1, 2, 3], env)
    rows = audit(wid)
    check("the audit keeps every row it changed, in the holder's name and by the edition: the new contact and the two "
          "it moved down, before → after",
          len(rows) == 3 and all(r[0] == HOLD_NAME and r[1] == EC.EDITION and r[2] == "contact.add" for r in rows)
          and rows[0][3:5] == ("contact", made.get("id")) and rows[0][5] is None and rows[0][6]["phone"] == "(330) 555-0142"
          and sorted(r[5]["sort_order"] for r in rows[1:]) == [1, 2], rows)
    with real.cursor() as c:
        c.execute("select count(*) from pg_temp.check_receipts where write_id = %s", (wid,))
        check("its receipt is kept under its write id", c.fetchone()[0] == 1)
    env2, _w = save(HOLD, add, wid=wid)
    check("the same write id again is answered from its receipt, nothing added", env2 == env and len(audit(wid)) == 3)
    cid = made.get("id")
    edit = {"op": "contact.edit", "id": cid, "changes": [
        {"field": "name", "value": "Mercy Urgent Care Center", "expected": "Mercy Urgent Care"},
        {"field": "phone", "value": "+1 (330) 555-0199 ext 4", "expected": "(330) 555-0142"},
        {"field": "note", "value": "", "expected": "Walk-in"},
        {"field": "group", "value": "agencies", "expected": "hospitals"},
        {"field": "order", "value": "2", "expected": "1"}]}
    env, wid = save(MASTER, edit)
    a = lane(env, "agencies") or {}
    moved = next((c for c in a.get("contacts") or [] if c["id"] == cid), {})
    check("the master edits every field of a contact: name, phone, note, its lane and its place there",
          env.get("status") == 200 and sorted((env.get("data") or {}).get("written") or []) == ["group", "name", "note", "order", "phone"]
          and moved == {"id": cid, "name": "Mercy Urgent Care Center", "note": "", "phone": "(330) 555-0199 x4", "order": 2}
          and [c["id"] for c in (lane(env, "hospitals") or {}).get("contacts") or []] == ["hospitals-1", "hospitals-2"],
          env)
    check("the master's change names no edition on the audit", {r[1] for r in audit(wid)} == {""})
    env, wid = save(HOLD, {**edit, "changes": [{"field": "name", "value": "Something else", "expected": "Mercy Urgent Care"}]})
    check("a stale witness is a 409 carrying what the directory holds now, and nothing is written",
          env.get("status") == 409 and (env.get("data") or {}).get("current") == {"name": "Mercy Urgent Care Center"}
          and (env.get("data") or {}).get("written") == [] and not audit(wid) and lane(env, "agencies") is not None, env)
    env, wid = save(HOLD, {"op": "contact.edit", "id": cid, "changes": [
        {"field": "phone", "value": "12", "expected": "(330) 555-0199 x4"}, {"field": "ssn", "value": "x", "expected": ""}]})
    refused = {r["field"]: r["why"] for r in (env.get("data") or {}).get("refused") or []}
    check("a phone that is neither a US number nor a short code, and a field a contact does not have, are refused by name",
          env.get("status") == 200 and set(refused) == {"phone", "ssn"} and "short code" in refused["phone"] and not audit(wid),
          env)
    env, wid = save(MASTER, {"op": "contact.edit", "id": "emergency-2", "changes": [
        {"field": "phone", "value": "211", "expected": "(330) 649-5800"}]})
    check("a short code is kept as it is", (env.get("data") or {}).get("written") == ["phone"]
          and (lane(env, "emergency") or {}).get("contacts", [{}, {}])[1].get("phone") == "211")
    env, wid = save(HOLD, {"op": "contact.remove", "id": cid, "expected": {"name": "Mercy Urgent Care", "phone": "x"}})
    check("a removal against a stale witness is a 409, nothing removed",
          env.get("status") == 409 and set((env.get("data") or {}).get("current") or {}) == {"name", "phone"} and not audit(wid))
    env, wid = save(HOLD, {"op": "contact.remove", "id": cid, "expected": {
        "name": "Mercy Urgent Care Center", "phone": "(330) 555-0199 x4", "group": "agencies", "order": "2"}})
    gone = [r for r in audit(wid) if r[4] == cid]
    check("the holder removes a contact against what the panel showed; the audit keeps the row it was",
          env.get("status") == 200 and all(c["id"] != cid for g in groups_of(env) for c in g["contacts"])
          and len(gone) == 1 and gone[0][2:4] == ("contact.remove", "contact") and gone[0][6] is None
          and gone[0][5]["name"] == "Mercy Urgent Care Center", gone)
    env, wid = save(MASTER, {"op": "group.add", "group": {"label": "Pharmacies", "icon": "pill",
                                                          "chip": "bg-tint-violet text-tint-fg-violet", "order": 2}})
    gid = ((env.get("data") or {}).get("group") or {}).get("id")
    check("the master adds a lane: its label, icon, colour and place",
          env.get("status") == 200 and [g["id"] for g in groups_of(env)][:2] == ["emergency", gid]
          and (lane(env, gid) or {}).get("chip") == "bg-tint-violet text-tint-fg-violet" and len(groups_of(env)) == 5, env)
    env, wid = save(MASTER, {"op": "group.add", "group": {"label": "pharmacies"}})
    check("a lane label already used is refused, said plainly", env.get("status") == 400
          and "already a lane" in str(env.get("message")))
    env, wid = save(HOLD, {"op": "group.edit", "id": gid, "changes": [
        {"field": "label", "value": "Pharmacies and labs", "expected": "Pharmacies"},
        {"field": "icon", "value": "stethoscope", "expected": "pill"},
        {"field": "chip", "value": "bg-tint-peach text-tint-fg-peach", "expected": "bg-tint-violet text-tint-fg-violet"},
        {"field": "order", "value": "5", "expected": "2"}]})
    g = lane(env, gid) or {}
    check("the holder edits every field of a lane: label, icon, colour and place",
          env.get("status") == 200 and g.get("label") == "Pharmacies and labs" and g.get("icon") == "stethoscope"
          and g.get("chip") == "bg-tint-peach text-tint-fg-peach" and g.get("order") == 5
          and [x["id"] for x in groups_of(env)][-1] == gid, env)
    env, wid = save(HOLD, {"op": "group.edit", "id": gid, "changes": [
        {"field": "chip", "value": "bg-red-500 text-white", "expected": "bg-tint-peach text-tint-fg-peach"}]})
    check("a colour that is not one of the lane colours is refused", (env.get("data") or {}).get("refused", [{}])[0].get("field") == "chip")
    env, wid = save(HOLD, {"op": "group.remove", "id": "team", "expected": {"label": "ASA team", "contacts": "5"}})
    check("a lane with contacts is not removed without them, said plainly",
          env.get("status") == 400 and 'still has 5 contacts' in str(env.get("message")) and not audit(wid), env)
    env, wid = save(HOLD, {"op": "group.remove", "id": "team", "expected": {"label": "ASA team", "contacts": "4"},
                           "with_contacts": True})
    check("a lane removal against a stale count of its contacts is a 409", env.get("status") == 409 and not audit(wid))
    env, wid = save(HOLD, {"op": "group.remove", "id": "team", "expected": {"label": "ASA team", "contacts": "5"},
                           "with_contacts": True})
    rows = audit(wid)
    check("the lane is removed with its contacts: every one on the audit, then the lane",
          env.get("status") == 200 and lane(env, "team") is None and (env.get("data") or {}).get("removed") == {
              "group": "team", "contacts": 5}
          and [r[3] for r in rows].count("contact") == 5 and ("group", "team") in [(r[3], r[4]) for r in rows if r[6] is None],
          [env.get("status"), len(rows)])
    env, wid = save(MASTER, {"op": "group.remove", "id": gid, "expected": {"label": "Pharmacies and labs"}})
    check("an empty lane goes without being asked twice", env.get("status") == 200 and lane(env, gid) is None)
    after = read(MASTER)
    check("the next read is the directory as the saves left it",
          [g["id"] for g in groups_of(after)] == ["emergency", "hospitals", "agencies"])


def the_refusals():
    RELEASED["badges"] = ["STAFF", "MANAGER", "ADMIN", "DIRECTOR"]
    listed(True, [HOLD["uid"]])
    payloads = [{"op": "contact.add", "contact": {"group": "team", "name": "X", "phone": "3305550100"}},
                {"op": "contact.edit", "id": "team-1", "changes": [{"field": "name", "value": "Y", "expected": "Ty Bond"}]},
                {"op": "contact.remove", "id": "team-1", "expected": {}},
                {"op": "group.add", "group": {"label": "New"}},
                {"op": "group.edit", "id": "team", "changes": [{"field": "label", "value": "Z", "expected": "ASA team"}]},
                {"op": "group.remove", "id": "agencies", "expected": {}, "with_contacts": True}]
    bad = []
    for p in payloads:
        env, wid = save(OTHER, p)
        if env != {"status": 404, "message": "Unknown action."} or audit(wid):
            bad.append([p["op"], env])
    check("every save op is refused for a person the edition does not list, and keeps nothing", not bad, bad)
    listed(False, [HOLD["uid"]])
    env, wid = save(HOLD, payloads[0])
    check("and for the listed person while the key is off", env == {"status": 404, "message": "Unknown action."})
    listed(True, [HOLD["uid"]])
    RELEASED["badges"] = []
    env, wid = save(HOLD, payloads[0])
    check("and for a listed person the app is not released to", env == {"status": 404, "message": "Unknown action."})
    env, wid = save(MASTER, {"op": "nope"})
    check("an op the door does not know is a 400", env.get("status") == 400 and "op: one of" in str(env.get("message")))
    env, wid = save(MASTER, {"op": "contact.edit", "id": "nobody", "changes": [{"field": "name", "value": "x", "expected": ""}]})
    check("a contact no longer there is a 409 that carries the directory", env.get("status") == 409
          and len(groups_of(env)) == 4)


def the_take_back():
    env, wid = save(MASTER, {"op": "group.remove", "id": "hospitals", "expected": {"contacts": "2"}, "with_contacts": True})
    gone = lane(env, "hospitals") is None
    store.settle(wid, "void")
    after = read(MASTER)
    with real.cursor() as c:
        c.execute("select count(*) from pg_temp.check_receipts where write_id = %s", (wid,))
        receipts = c.fetchone()[0]
    h = lane(after, "hospitals") or {}
    check("a save the relay never answered as written is taken back: the lane and its contacts as they were, its "
          "receipt gone, the take-back on the audit",
          gone and [c["name"] for c in h.get("contacts") or []] == ["Aultman Hospital", "Cleveland Clinic Mercy Hospital"]
          and h.get("order") == 2 and receipts == 0 and audit(wid)[-1][2] == "void", [gone, h.get("order"), receipts])


rolled("the reads", the_reads)
rolled("the saves", the_saves)
rolled("the refusals", the_refusals)
rolled("the take-back", the_take_back)
try:
    real.close()
except Exception:
    pass
with psycopg.connect(hubdb._dsn(), autocommit=True, connect_timeout=5) as c2:
    # a closed session leaves the activity view a moment after its socket closes
    for _ in range(20):
        left = c2.execute("select count(*) from pg_stat_activity where application_name = 'emergency-contacts-check'").fetchone()[0]
        if not left:
            break
        time.sleep(0.25)
    live_tables = c2.execute("select to_regclass('app.emergency_contact_groups') is not null").fetchone()[0]
check("nothing is left: the check's session is gone, its temp tables with it", left == 0, left)
facts["app.emergency_contact_groups in the live database"] = "exists (untouched)" if live_tables else "not made yet (untouched)"
print(json.dumps({"checks": out, "facts": facts}))
'''


def live() -> None:
    print("the doors on real accounts (asa-hub-db-sync)")
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
