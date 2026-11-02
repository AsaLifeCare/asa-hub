#!/usr/bin/env python3
"""Settings › Editions for Staff, SSA Profiles and Family Profiles, kept in Postgres: the registries agree, the .gs doors
are asa_dev's, the relay routes the doors final and names no edition while an app runs on Apps Script, and every door
decided by the streamed modules on real subjects in asa-hub-db-sync — the master allowed, a person not listed refused,
a listed person allowed (the editions value and App Control's release simulated), a stale witness 409, a protected
field refused, the edit kept in app.edits, read back, and still read back after a reload of the copy. Nothing real is
written: the edit store lives in temp tables inside one transaction rolled back at the end, and the live copies are
only read. Prints shapes, counts and timings only."""
from __future__ import annotations

import ast
import asyncio
import base64
import json
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
sys.path.insert(0, str(ROOT / "app"))

import edit_overlay as eo  # noqa: E402
import scope as sc  # noqa: E402

DB_RUNNER = "asa-hub-db-sync"
RESTORED = ("StaffProfiles.gs", "SsaProfiles.gs", "FamilyProfiles.gs", "SelfTestFamilyProfiles.gs",
            "SelfTestSsaProfiles.gs")
NEW = {"staff.profile": "staff-profiles", "staff.employment": "staff-profiles", "staff.hr": "staff-profiles",
       "staff.driving": "staff-profiles", "staff.mais": "staff-profiles", "staff.ist": "staff-profiles",
       "staff.preferences": "staff-profiles", "staff.notes": "staff-profiles", "staff.notesEdit": "staff-profiles",
       "ssa.profile": "ssa-profiles", "ssa.notes": "ssa-profiles",
       "family.profile": "family-profiles", "family.notes": "family-profiles", "family.calls": "family-profiles",
       "family.incidents": "family-profiles"}
FINAL = {"staff": {"staffProfileNoteAdd", "staffProfileNoteState", "staffProfilePreferencesSave", "staffProfileEdit",
                   "staffProfileDrivingEdit", "staffProfileMaisEdit", "staffProfileIstEdit", "staffProfileNoteEdit",
                   "staffProfileHrIssueAdd", "staffProfileDocConclude"},
         "ssa": {"ssaProfileNoteAdd", "ssaProfileEdit", "ssaProfileDocEdit", "ssaProfileActivityEdit"},
         "family": {"familyProfileNoteAdd", "familyProfileIncidentTie", "familyProfileCallSchedule", "familyProfileSave",
                    "familyProfileNoteEdit", "familyProfileCallEdit"}}
PY_DOORS = {"ssaProfileEdit": "write", "ssaProfileEditRead": "read", "ssaProfileDocEdit": "write",
            "ssaProfileActivityEdit": "write", "staffProfileEditRead": "read", "staffProfileNoteEdit": "write",
            "familyProfileNoteEdit": "write", "familyProfileCallEdit": "write"}
RELAY_NAMES = ("BACKEND_OWN_SLACK_S", "BACKEND_FINAL_KEEP_S", "_backend_final_covers", "_backend_copy_at",
               "_backend_written_after", "_backend_final_landed", "_backend_final", "_BACKEND_EDITION_APPS",
               "_backend_editions_shut")

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


# ---- 1. what the files say ---------------------------------------------------------------------------------------------

def top_level(path: Path) -> dict[str, ast.AST]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: dict[str, ast.AST] = {}
    for n in tree.body:
        if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name):
            out[n.targets[0].id] = n.value
        elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name) and n.value is not None:
            out[n.target.id] = n.value
    return out


def strings(node: ast.AST) -> set[str]:
    return {n.value for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)}


def entry(table: ast.AST, key: str, names: dict[str, str] | None = None) -> dict[str, set[str]]:
    for k, v in zip(table.keys, table.values):
        label = k.value if isinstance(k, ast.Constant) else (names or {}).get(getattr(k, "id", ""), "")
        if label == key and isinstance(v, ast.Dict):
            return {kk.value: strings(vv) for kk, vv in zip(v.keys, v.values) if isinstance(kk, ast.Constant)}
    return {}


def files() -> None:
    print("the files")
    import editions as E  # noqa: PLC0415 - the catalogue every gate reads
    gs = (ROOT / "apps-script" / "Editions.gs").read_text(encoding="utf-8")
    block = gs[gs.index("var EDITIONS = ["):gs.index("];", gs.index("var EDITIONS = ["))]
    gs_pairs = re.findall(r"\{ id: '([A-Za-z.]+)', app: '([a-z-]+)'", block)
    pairs = list(E.IDS)
    ids = [e for e, _a in pairs]
    ts = (ROOT / "src" / "lib" / "editions.ts").read_text(encoding="utf-8")
    ts_ids = re.findall(r"'([A-Za-z.]+)'", ts[ts.index("export const EDITION_IDS = ["):ts.index("] as const")])
    check("the catalogue (app/editions.py), editions.ts, the overlay and scope.py name the same editions in the same "
          "order", ids == ts_ids == list(eo.EDITION_IDS) and list(sc.EDITIONS) == pairs,
          [len(ids), len(ts_ids), len(sc.EDITIONS)])
    check("Editions.gs is a frozen subset of the catalogue: each of its editions there, in its order, under its app",
          [p for p in pairs if p[0] in dict(gs_pairs)] == gs_pairs, [len(gs_pairs), len(pairs)])
    check("the fifteen Staff, SSA and Families editions ship in the catalogue under their apps, after Clients'",
          [x for x in pairs if x[0] in NEW] == list(NEW.items()) and ids.index("staff.profile") > ids.index("clients.transportation"))
    check("each new edition says it works while its app runs on Python, kept in the Hub's database",
          all("runs on Python" in seg and "Hub\\'s database" in seg
              for seg in re.split(r"\n  \{ id: ", re.sub(r"'\s*\+\s*'", "", block)) if re.match(r"'(staff|ssa|family)\.", seg)))
    same = subprocess.run(["git", "-C", str(ROOT), "diff", "--quiet", "asa_dev", "--", *[f"apps-script/{f}" for f in RESTORED]])
    touched = subprocess.run(["git", "-C", str(ROOT), "diff", "--name-only", "asa_dev", "--", "apps-script"],
                             capture_output=True, text=True).stdout.split()
    check("the Staff, SSA and Families .gs doors and their self-tests are asa_dev's, byte for byte",
          same.returncode == 0, same.returncode)
    check("no .gs differs from asa_dev: the catalogue grows in app/editions.py alone, Editions.gs stays frozen",
          not touched, touched)
    doors = json.loads((ROOT / "app" / "doors.json").read_text(encoding="utf-8"))
    manifest = json.loads((ROOT / "public" / "resolver-manifest.json").read_text(encoding="utf-8"))["actions"]
    check("these apps' own Python doors are declared in app/doors.json and reach the resolver manifest with their lanes",
          {k: v.get("lane") for k, v in doors.items() if k in PY_DOORS} == PY_DOORS
          and all((manifest.get(a) or {}).get("lane") == lane and str((manifest.get(a) or {}).get("file", "")).startswith("app/")
                  for a, lane in PY_DOORS.items()), {a: (manifest.get(a) or {}).get("file") for a in PY_DOORS})
    top = top_level(ROOT / "server" / "snapshot_service.py")
    names = {"_APP_PACK_CLIENTS": "client-profiles", "_APP_PACK_SSAS": "ssa-profiles", "_APP_PACK_FAMILIES": "family-profiles",
             "_APP_PACK_STAFF_TEAM": "staff-team"}
    backend = {a: entry(top["BACKEND_APPS"], a) for a in FINAL}
    check("BACKEND_APPS: each app's final writes are exactly the converted doors, each one of its writes",
          all(backend[a].get("final") == FINAL[a] and FINAL[a] <= backend[a].get("writes", set()) for a in FINAL),
          {a: sorted(backend[a].get("final", ())) for a in FINAL})
    check("the rename and a training stay on their path (written by Apps Script), never final; an HR issue is final",
          not {"staffProfileRename", "staffProfileAssignTraining"} & backend["staff"]["final"]
          and "staffProfileHrIssueAdd" in backend["staff"]["final"])
    check("the two edit panels' reads ride Python under their app's switch",
          "staffProfileEditRead" in backend["staff"]["reads"] and "ssaProfileEditRead" in backend["ssa"]["reads"])
    no_receipt = strings(top["RELAY_NO_RECEIPT_ACTIONS"])
    check("every new door a screen reads or saves is a no-receipt action on the relay",
          set(PY_DOORS) <= no_receipt and {"editionsMine", "familyProfileOverview", "staffProfileOverview",
                                            "ssaProfileOverview"} <= no_receipt, sorted(set(PY_DOORS) - no_receipt))
    packs = top["_APP_PACKS"]
    staff_team = next(v for k, v in zip(packs.keys, packs.values) if getattr(k, "id", "") == "_APP_PACK_STAFF_TEAM")
    team_writes = strings(next(vv for kk, vv in zip(staff_team.keys, staff_team.values)
                               if isinstance(kk, ast.Constant) and kk.value == "writes"))
    check("each final write dirties its own pack (staff-team, ssa, family)",
          FINAL["staff"] <= team_writes and FINAL["ssa"] <= entry(packs, "ssa-profiles", names).get("writes", set())
          and FINAL["family"] <= entry(packs, "family-profiles", names).get("writes", set()))
    check("the SSA and family edits make the client records they wrote stale",
          {"ssaProfileEdit", "familyProfileSave"} <= entry(packs, "client-profiles", names).get("elsewhere", set()))
    check("no edit door is laid or queued by the overlay", not [a for a in eo.DOORS if a in set().union(*FINAL.values())])


# ---- 2. the relay's own lines, over stand-ins ---------------------------------------------------------------------------

def relay() -> None:
    print("the relay")
    text = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    found: dict[str, str] = {}
    for node in ast.parse(text).body:
        name = getattr(node, "name", None)
        if name is None and isinstance(node, (ast.Assign, ast.AnnAssign)):
            target = node.targets[0] if isinstance(node, ast.Assign) else node.target
            name = getattr(target, "id", None)
        if name in RELAY_NAMES:
            found[name] = ast.get_source_segment(text, node) or ""
    missing = [n for n in RELAY_NAMES if not found.get(n)]
    if missing:
        check("the relay's final path is all there", False, missing)
        return

    class Response:
        def __init__(self, content: Any, media_type: str = "") -> None:
            self.body, self.status = content, json.loads(content).get("status")

    switch = {"staff": False, "ssa": True}
    landed: list[str] = []
    ns: dict[str, Any] = {
        "__name__": "relay_check", "time": time, "json": json, "re": re, "asyncio": asyncio, "Any": Any,
        "log": __import__("logging").getLogger("relay-check"), "Response": Response,
        "_app_pack_touched": {}, "_app_pack_void": {}, "_app_pack_swept": {}, "_backend_own": {},
        "_backend_final_at": {}, "BACKEND_APPS": {"staff": {"pack": "staff-team"}, "ssa": {"pack": "ssa-profiles"},
                                                  "family": {"pack": "family-profiles"},
                                                  "locations": {}}}
    exec(compile("from __future__ import annotations\n" + "\n\n".join(found[n] for n in RELAY_NAMES), "relay_check",
                 "exec"), ns)

    async def wanted(app_id: str) -> bool:
        return switch.get(app_id, False)

    def note_write(name: str, body: dict, env: Any) -> None:
        ns["_app_pack_touched"][("staff-team", "annlee")] = time.time()
        ns["_app_pack_swept"]["locations"] = time.time()

    async def settle(*_a: Any, **_k: Any) -> bool:
        return True
    ns.update({"_backend_wanted": wanted, "_backend_settle": settle, "_traffic_note": lambda *a, **k: None,
               "_relay_envelope": lambda raw: json.loads(urllib.parse.parse_qs(raw.decode())["body"][0]),
               "_viewer_cache_written": lambda action, raw, content: landed.append("viewer:" + json.loads(content)["status"].__str__()),
               "_app_pack_apps_of": lambda action, raw: {"staff-team"},
               "_app_pack_ring": lambda app, **k: landed.append("ring:" + app),
               "_app_pack_write_of": lambda action, raw: (action, ns["_relay_envelope"](raw)),
               "_app_pack_note_write": note_write, "_staff_profiles_rang": lambda *a: None})

    def raw_of(action: str, payload: dict) -> bytes:
        return urllib.parse.urlencode({"body": json.dumps({"action": action, "token": "t", "payload": payload})}).encode()

    shut = {app: asyncio.run(ns["_backend_editions_shut"](raw_of("editionsMine", {"app": app})))
            for app in ("staff-profiles", "ssa-profiles", "family-profiles", "locations", "client-profiles")}
    check("editionsMine names no edition for an app on Apps Script (the master's too), and asks Apps Script for one on "
          "Python and for every other app",
          shut["staff-profiles"] == {"status": 200, "data": {"editions": []}}
          and shut["family-profiles"] == {"status": 200, "data": {"editions": []}}
          and shut["ssa-profiles"] is None and shut["locations"] is None and shut["client-profiles"] is None, shut)
    old = time.time() - 600
    answer = {"status": 409, "data": {"written": ["phone"], "refused": [], "current": {"email": "x"}},
              "message": "Some fields changed"}
    res = asyncio.run(ns["_backend_final"]("staff", "staffProfileEdit", raw_of("staffProfileEdit", {"key": "annlee"}),
                                           "Wcheck-relay-0001", answer, "annlee", time.time(), frozenset(), time.time(),
                                           False))
    check("a final 409 that saved some fields is answered as Python said it, and its copies are read again",
          res.status == 409 and "viewer:200" in landed and "ring:staff-team" in landed, [res.status, landed])
    check("a sweep a final write made (an IST edit over every house) is laid by Python's next read, not a reason to "
          "leave it to Apps Script",
          ("locations", "") in ns["_backend_final_at"]
          and ns["_backend_copy_at"]("locations", "", old, None, any_key=True, edits_at=time.time()) is not None
          and ns["_backend_copy_at"]("locations", "", old, None, any_key=True, edits_at=old) is None)
    ns["_app_pack_swept"]["locations"] = time.time() + 60
    check("a later sweep nobody's final write made still sends the read back to the copy's age",
          ns["_backend_copy_at"]("locations", "", old, None, any_key=True, edits_at=time.time() + 120) is None)


# ---- 3. the doors on real subjects, in asa-hub-db-sync ------------------------------------------------------------------

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, re, resource, sys, time, types, uuid
from datetime import timedelta
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
import gsjs, hubdb, scope as sc, locations as L, clients as C, writes as W, client_writes as CW
import staff as SP, staff_writes as SW, ssa as S, ssa_writes as SSW, family as F, family_writes as FW
import main as M

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_check"
W.LOCK_KEY = 0x45445043484B


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


# the live copies, read on their own read-only connection; the edit store on a transaction rolled back at the end
db = hubdb.HubDb()
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="editions-people-check")
proxy = Conn(real)
store = W.Store(connect=lambda: proxy, kind="check", label="Check")
EDITIONS = {"value": "[]"}
base_cfg = db.hiring_config
db.hiring_config = lambda: {**base_cfg(), sc.EDITIONS_KEY: EDITIONS["value"]}
# the copy taken as current: a verdict resting on rows is answered, never deferred for a book Drive moved meanwhile
db.stale = lambda books: False
base_catalog = db.catalog
BUMP = {"n": 0, "held": None}


def catalog():
    cat = base_catalog()
    if not BUMP["n"]:
        return cat
    if BUMP["held"] is None or BUMP["held"][0] != BUMP["n"] or BUMP["held"][1] is not cat:
        def later(v):
            return v + timedelta(minutes=BUMP["n"]) if hasattr(v, "year") else f"{v}+{BUMP['n']}"
        BUMP["held"] = (BUMP["n"], cat, {**cat, "tabs": {k: r._replace(loaded_at=later(r.loaded_at))
                                                         for k, r in cat["tabs"].items()}})
    return BUMP["held"][2]


db.catalog = catalog


def reload():
    """A sync pass: every tab read again from its table under a newer load stamp; the sheet itself unchanged."""
    BUMP["n"] += 1
    with db._lock:
        db._rows.clear()


HOLDER = {"id": ""}
base_gate = sc.profile_app_gate


def gate(app_id, user, src):
    if user and HOLDER["id"] and gsjs.str_(user.get("id")) == HOLDER["id"] and not user.get("is_service"):
        return {"open": True, "scope": sc.scope_of("all")}
    return base_gate(app_id, user, src)


sc.profile_app_gate = gate
M.DB = db
M.STORE = M.CLIENT_STORE = W.Store(dsn="")
M.STAFF_STORE = M.SSA_STORE = M.FAMILY_STORE = store
M.WRITE_BUDGET_S = 120.0
spent = {}
seq = [0]


def listed(*eids):
    EDITIONS["value"] = json.dumps([{"id": e, "on": True, "people": [HOLDER["id"]]} for e in eids])


def write(module, action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-ep-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    t0 = time.monotonic()
    res = M._run_write(module, action, who, payload, wid)
    spent[action] = max(spent.get(action, 0.0), time.monotonic() - t0)
    return res.status_code, json.loads(res.body), wid


def rows_of(wid):
    with real.cursor() as c:
        c.execute("select tab_name, kind, match_by, field, value, edition from pg_temp.hub_edits_check"
                  " where write_id = %s order by id", (wid,))
        return c.fetchall()


def read(app_id, action, who, payload):
    res = M._run(M.APPS[app_id], action, who, payload)
    return res.status_code, json.loads(res.body)


def laid(fn):
    own = CW.Own([], book=db.book, edits=store.edits(), edits_at=time.time())
    tok = hubdb.OWN.set(own)
    try:
        return fn(L.Reads(db, None))
    finally:
        hubdb.OWN.reset(tok)


def final_of(env):
    return (env.get("_write") or {}).get("final") is True


def digits(v):
    return re.sub(r"\D+", "", str(v or ""))


def unknown(code, env):
    return code == 200 and env == {"status": 404, "message": "Unknown action."}


def guarded(name, fn):
    try:
        with real.transaction():
            fn()
    except Exception as exc:  # noqa: BLE001 - said as a failed check, never a value
        check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:200])


reads0 = L.Reads(db, None)
users = reads0.users()
live_users = [u for u in users if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in live_users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
holder = next((u for u in live_users if gsjs.str_(u.get("role")).lower() in ("staff", "manager")
               and not gsjs.str_(u.get("clientkey")) and gsjs.str_(u.get("active")).lower() != "false"
               and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")), "role": "admin", "is_master": True}
HOLD = {"uid": gsjs.str_((holder or {}).get("userid")), "role": gsjs.str_((holder or {}).get("role")).lower(),
        "is_master": False}
HOLDER["id"] = HOLD["uid"]
check("the master's account and an employee's account are read from the users tab", bool(master and holder))
with real.transaction():
    store.ensure()
    check("the edit store is made in temp tables (the store's own ensure, the lock key nobody else takes)",
          store.ready(), store.why)
TODAY = reads0.today()
NEW_PHONE, NEW_PHONE2, NEW_MAIL = "(330) 555-0142", "(330) 555-0143", "edition.check@example.org"


def staff_doors():
    reads = L.Reads(db, None)
    mi = SP.master_index(reads)
    subject, ctx = "", None
    for key, row in list(mi["rows"].items())[:400]:
        if row.get("ambiguous"):
            continue
        c = SP.person(reads, key)
        if c.get("refused") or not c.get("master") or not c.get("account") or not c["master"].get("employee_id"):
            continue
        if not {"phone", "email"} <= set(c["master_cols"]) \
                or {"first_name", "last_name", "status", "phone", "email"} & set(c.get("_unsure") or ()):
            continue
        live = c.get("master_edit") or {}
        if C._marked(live.get("phone")) or C._marked(live.get("email")) or SW.master_target(reads, c).get("why"):
            continue
        subject, ctx = key, c
        break
    check("staffProfileEdit: a staff member with a Master row (Employee ID), an account and both contact columns",
          bool(subject))
    if not subject:
        return
    live = ctx["master_edit"]
    EDITIONS["value"] = "[]"
    code, env, wid = write(SW, "staffProfileEdit", MASTER,
                           {"key": subject, "changes": [{"field": "phone", "value": NEW_PHONE, "expected": live.get("phone", "")}]})
    kept = rows_of(wid)
    check("staffProfileEdit: the master's phone is kept final in app.edits — one cell of the Master row, no sheet",
          code == 200 and env.get("status") == 200 and env["data"]["written"] == ["phone"] and final_of(env)
          and env["data"].get("steps", [{}])[0].get("id") == "postgres"
          and len(kept) == 1 and kept[0][1] == "edit" and kept[0][2].startswith("cols:") and kept[0][4] == NEW_PHONE
          and kept[0][5] == "", [code, env.get("status"), env.get("message"), [k[:4] for k in kept]])
    code, got = read("staff", "staffProfileEditRead", MASTER, {"staff": subject, "section": "profile"})
    check("staffProfileEdit: the next read (the panel's own) shows the kept phone",
          code == 200 and ((got.get("data") or {}).get("edit") or {}).get("phone") == NEW_PHONE, [code, got.get("status")])
    reload()
    code, got = read("staff", "staffProfileEditRead", MASTER, {"staff": subject, "section": "profile"})
    check("staffProfileEdit: after a reload of the copy (the sheet unchanged) the edit is still read",
          ((got.get("data") or {}).get("edit") or {}).get("phone") == NEW_PHONE)
    code, env, wid = write(SW, "staffProfileEdit", MASTER,
                           {"key": subject, "changes": [{"field": "phone", "value": NEW_PHONE2, "expected": "zz-not-it"}]})
    check("staffProfileEdit: a stale witness is the 409 carrying what Postgres holds now; nothing kept",
          env.get("status") == 409 and (env.get("data") or {}).get("current", {}).get("phone") == NEW_PHONE
          and not rows_of(wid) and not final_of(env), [env.get("status"), env.get("message")])
    code, env, wid = write(SW, "staffProfileEdit", MASTER, {"key": subject, "changes": [
        {"field": "ssn", "value": "1", "expected": ""}, {"field": "first_name", "value": "X", "expected": ""},
        {"field": "login_email", "value": NEW_MAIL, "expected": ""}]})
    why = {r["field"]: r["why"] for r in (env.get("data") or {}).get("refused", [])}
    check("staffProfileEdit: the SSN stays protected, the name goes through the rename, the sign-in e-mail is "
          "Settings › Users' — nothing kept",
          env.get("status") == 200 and why.get("ssn") == SP.EDIT_PROTECTED and why.get("first_name") == SP.EDIT_RENAME
          and why.get("login_email") == SW.LOGIN_ELSEWHERE and not rows_of(wid), why)
    code, env, wid = write(SW, "staffProfileEdit", HOLD,
                           {"key": subject, "changes": [{"field": "email", "value": NEW_MAIL, "expected": live.get("email", "")}]})
    check("staffProfileEdit: an employee no edition lists is told it is no door", unknown(code, env), env)
    listed("staff.profile")
    code, env, wid = write(SW, "staffProfileEdit", HOLD, {"key": subject, "changes": [
        {"field": "email", "value": NEW_MAIL, "expected": live.get("email", "")},
        {"field": "status", "value": "Inactive", "expected": ""}, {"field": "w4_date", "value": "2026-01-01", "expected": ""}]})
    why = {r["field"]: r["why"] for r in (env.get("data") or {}).get("refused", [])}
    kept = rows_of(wid)
    check("staffProfileEdit: a holder of staff.profile writes the e-mail (kept under that edition); the status stays the "
          "master's, an HR field is outside the edition",
          env.get("status") == 200 and env["data"]["written"] == ["email"] and final_of(env)
          and why.get("status") == SP.EDIT_MASTER_ONLY["status"] and why.get("w4_date") == SP.EDITION_NOT_HELD
          and len(kept) == 1 and kept[0][5] == "staff.profile", [env.get("status"), why, [k[:3] for k in kept]])
    code, got = read("staff", "staffProfileEditRead", HOLD, {"staff": subject, "section": "profile"})
    edit = (got.get("data") or {}).get("edit") or {}
    check("staffProfileEditRead: the holder's panel opens on its edition's own fields, the e-mail as kept",
          code == 200 and edit.get("email") == NEW_MAIL and set(edit) <= set(SP.EDITION_FIELDS["staff.profile"]), sorted(edit))
    EDITIONS["value"] = "[]"


def driving_door():
    reads = L.Reads(db, None)
    idx = SP.driver_index(reads, SP.DRIVER_TAB)
    fid = "insurance_exp" if "insurance_exp" in idx["cols"] else "points"
    field = "insurance_exp" if fid == "insurance_exp" else "points"
    subject, shown = "", ""
    for key, hit in list(idx["rows"].items())[:300]:
        if hit.get("ambiguous") or key in idx["unsure"]:
            continue
        ctx = SP.person(reads, key)
        if ctx.get("refused"):
            continue
        shown = SW.driving_shown(hit["fields"], fid)
        if C._marked(shown):
            continue
        subject = key
        break
    check("staffProfileDrivingEdit: a staff member with one row on the employee driver tab", bool(subject))
    if not subject:
        return
    value = "2027-01-31" if field == "insurance_exp" else "3"
    code, env, wid = write(SW, "staffProfileDrivingEdit", MASTER,
                           {"key": subject, "changes": [{"field": field, "value": value, "expected": shown},
                                                        {"field": "dl", "value": "1", "expected": ""}]})
    why = {r["field"]: r["why"] for r in (env.get("data") or {}).get("refused", [])}
    check("staffProfileDrivingEdit: the master's change kept final on the driver tab's row; the licence number protected",
          env.get("status") == 200 and env["data"]["written"] == [field] and final_of(env) and why.get("dl") == SP.EDIT_PROTECTED
          and len(rows_of(wid)) == 1, [env.get("status"), env.get("message"), why])
    now = laid(lambda r: SW.driving_shown(SP.driver_index(r, SP.DRIVER_TAB)["rows"][subject]["fields"], fid))
    check("staffProfileDrivingEdit: the next read of the driving record shows it", now not in ("", shown), now == value)
    reload()
    again = laid(lambda r: SW.driving_shown(SP.driver_index(r, SP.DRIVER_TAB)["rows"][subject]["fields"], fid))
    check("staffProfileDrivingEdit: still read after a reload of the copy", again == now)
    code, env, wid = write(SW, "staffProfileDrivingEdit", MASTER,
                           {"key": subject, "changes": [{"field": field, "value": value, "expected": "zz-not-it"}]})
    check("staffProfileDrivingEdit: a stale witness is the 409", env.get("status") == 409 and not rows_of(wid))
    code, env, wid = write(SW, "staffProfileDrivingEdit", HOLD,
                           {"key": subject, "changes": [{"field": field, "value": value, "expected": now}]})
    check("staffProfileDrivingEdit: not listed, no door", unknown(code, env), env)
    listed("staff.driving")
    code, env, wid = write(SW, "staffProfileDrivingEdit", HOLD,
                           {"key": subject, "changes": [{"field": field, "value": "2027-02-28" if field == "insurance_exp"
                                                         else "4", "expected": now}]})
    check("staffProfileDrivingEdit: a holder of staff.driving writes it, kept under that edition",
          env.get("status") == 200 and final_of(env) and [k[5] for k in rows_of(wid)] == ["staff.driving"], env.get("status"))
    EDITIONS["value"] = "[]"


def mais_door():
    reads = L.Reads(db, None)
    mi = SP.master_index(reads)
    tried = 0
    for key in list(mi["rows"])[:400]:
        try:
            m = laid(lambda r, key=key: SP.mais_part(r, key, TODAY, 60))
        except Exception:  # noqa: BLE001 - a person whose MAIS rows this copy cannot tell apart
            continue
        if m.get("ambiguous") or not m.get("certs"):
            continue
        cert = m["certs"][0]
        tried += 1
        code, env, wid = write(SW, "staffProfileMaisEdit", MASTER, {"key": key, "level": cert["level"], "changes": [
            {"field": "expires", "value": "2031-12-31", "expected": cert["expires"]}]})
        if env.get("status") != 200 or not final_of(env):
            if tried > 12:
                break
            continue
        check("staffProfileMaisEdit: the master's expiry kept final on the line's own row (its stamp, names and level)",
              len(rows_of(wid)) == 1 and rows_of(wid)[0][2].startswith("cols:"))
        now = laid(lambda r: next(x for x in SP.mais_part(r, key, TODAY, 60)["certs"] if x["level"] == cert["level"]))
        check("staffProfileMaisEdit: the next read shows the line's new expiry", now["expires"] == "2031-12-31")
        reload()
        now = laid(lambda r: next(x for x in SP.mais_part(r, key, TODAY, 60)["certs"] if x["level"] == cert["level"]))
        check("staffProfileMaisEdit: still read after a reload of the copy", now["expires"] == "2031-12-31")
        code, env, wid = write(SW, "staffProfileMaisEdit", MASTER, {"key": key, "level": cert["level"], "changes": [
            {"field": "expires", "value": "2031-12-30", "expected": "zz-not-it"}, {"field": "dd_id", "value": "1", "expected": ""}]})
        check("staffProfileMaisEdit: a stale witness is the 409; the DD ID is not a field it edits",
              env.get("status") == 409 and not rows_of(wid)
              and any(r["field"] == "dd_id" for r in env["data"].get("refused", [])))
        code, env, wid = write(SW, "staffProfileMaisEdit", HOLD, {"key": key, "level": cert["level"], "changes": [
            {"field": "status", "value": "Active", "expected": now["word"]}]})
        check("staffProfileMaisEdit: not listed, no door", unknown(code, env), env)
        listed("staff.mais")
        code, env, wid = write(SW, "staffProfileMaisEdit", HOLD, {"key": key, "level": cert["level"], "changes": [
            {"field": "expires", "value": "2031-11-30", "expected": now["expires"]}]})
        check("staffProfileMaisEdit: a holder of staff.mais writes it", env.get("status") == 200 and final_of(env))
        EDITIONS["value"] = "[]"
        return
    check("staffProfileMaisEdit: a staff member whose MAIS line this copy tells apart (several tried)", False, tried)


def ist_door():
    reads = L.Reads(db, None)
    rec, subject = None, ""
    for r in SP.ist_rows(reads)[:400]:
        k = gsjs.name_key(r.get("staffName"))
        if not k or not gsjs.or_blank(r.get("id")) or C._marked(r.get("staffName")):
            continue
        if SP.person(reads, k).get("refused"):
            continue
        rec, subject = r, k
        break
    check("staffProfileIstEdit: an IST record of a staff member", rec is not None)
    if rec is None:
        return
    iid = gsjs.or_blank(rec.get("id"))
    shown = SP.ist_cell(rec, {})
    flip = "owed" if shown["status"] == "done" else "done"
    code, env, wid = write(SW, "staffProfileIstEdit", MASTER,
                           {"key": subject, "id": iid, "changes": [{"field": "status", "value": flip, "expected": shown["status"]}]})
    cells = {k[3] for k in rows_of(wid)}
    check("staffProfileIstEdit: the master's status kept final on the record by its id, updatedAt stamped",
          env.get("status") == 200 and final_of(env) and cells == {"status", "updatedAt"}, [env.get("status"), sorted(cells)])
    now = laid(lambda r: next(SP.ist_cell(x, {}) for x in SP.ist_rows(r) if gsjs.or_blank(x.get("id")) == iid))
    check("staffProfileIstEdit: the next read shows it", now["status"] == flip)
    reload()
    now = laid(lambda r: next(SP.ist_cell(x, {}) for x in SP.ist_rows(r) if gsjs.or_blank(x.get("id")) == iid))
    check("staffProfileIstEdit: still read after a reload of the copy", now["status"] == flip)
    code, env, wid = write(SW, "staffProfileIstEdit", MASTER,
                           {"key": subject, "id": iid, "changes": [{"field": "status", "value": shown["status"], "expected": "zz"}]})
    check("staffProfileIstEdit: a stale witness is the 409", env.get("status") == 409 and not rows_of(wid))
    code, env, wid = write(SW, "staffProfileIstEdit", HOLD,
                           {"key": subject, "id": iid, "changes": [{"field": "status", "value": shown["status"], "expected": flip}]})
    check("staffProfileIstEdit: not listed, no door", unknown(code, env), env)
    listed("staff.ist")
    code, env, wid = write(SW, "staffProfileIstEdit", HOLD,
                           {"key": subject, "id": iid, "changes": [{"field": "status", "value": shown["status"], "expected": flip}]})
    check("staffProfileIstEdit: a holder of staff.ist writes it", env.get("status") == 200 and final_of(env))
    EDITIONS["value"] = "[]"


def notes_and_prefs():
    reads = L.Reads(db, None)
    subject = next((k for k in list(SP.master_index(reads)["rows"])[:200] if not SP.person(reads, k).get("refused")), "")
    code, env, wid = write(SW, "staffProfileNoteAdd", MASTER, {"staff": subject, "category": "general", "details": "Edition check"})
    nid = ((env.get("data") or {}).get("note") or {}).get("id", "")
    check("staffProfileNoteAdd: the master's note (id minted SN_) kept final as an appended row",
          env.get("status") == 200 and final_of(env) and nid.startswith("SN_")
          and {k[1] for k in rows_of(wid)} == {"append"}, env.get("status"))
    seen = laid(lambda r: [n for n in SP.own_rows(r, SP.NOTES_TAB, subject) if n.get("id") == nid])
    check("staffProfileNoteAdd: the next read of the staff notes lists it", len(seen) == 1 and seen[0].get("state") == "open")
    code, env, wid = write(SW, "staffProfileNoteState", MASTER, {"id": nid, "state": "resolved", "staff": subject})
    check("staffProfileNoteState: resolved, three cells kept", env.get("status") == 200 and final_of(env)
          and {k[3] for k in rows_of(wid)} == {"state", "state_by", "state_at"})
    reload()
    seen = laid(lambda r: [n for n in SP.own_rows(r, SP.NOTES_TAB, subject) if n.get("id") == nid])
    check("staffProfileNoteState: the note read resolved after a reload of the copy",
          len(seen) == 1 and seen[0].get("state") == "resolved")
    code, env, wid = write(SW, "staffProfileNoteState", MASTER, {"id": nid, "state": "open", "staff": "zzzsomeoneelse"})
    check("staffProfileNoteState: a note of another staff member is the 409", env.get("status") == 409 and not rows_of(wid))
    code, env, wid = write(SW, "staffProfileNoteAdd", HOLD, {"staff": subject, "details": "x"})
    check("staffProfileNoteAdd: not listed, no door", unknown(code, env), env)
    listed("staff.notes")
    code, env, wid = write(SW, "staffProfileNoteAdd", HOLD, {"staff": subject, "details": "Edition check (holder)"})
    check("staffProfileNoteAdd: a holder of staff.notes files one, kept under that edition",
          env.get("status") == 200 and final_of(env) and {k[5] for k in rows_of(wid)} == {"staff.notes"})
    EDITIONS["value"] = "[]"
    try:
        found = SP.prefs_find(L.Reads(db, None), subject)
    except sc.Defer:
        found = {"sheet": False, "rec": None}
    if not found["sheet"]:
        code, env, wid = write(SW, "staffProfilePreferencesSave", MASTER, {"staff": subject, "prefs": {}, "expected": ""})
        check("staffProfilePreferencesSave: the preferences house not set up answers its 503, nothing kept",
              env.get("status") == 503 and not rows_of(wid), env)
        facts["preferences"] = "house not set up in the copy"
        return
    was = SP.sp_instant(found["rec"].get("updated_at")) if found["rec"] else ""
    code, env, wid = write(SW, "staffProfilePreferencesSave", MASTER,
                           {"staff": subject, "prefs": {"shifts": ["morning"], "note": "Edition check"}, "expected": was})
    check("staffProfilePreferencesSave: the master's save kept final (the row by staff_key, stamped)",
          env.get("status") == 200 and final_of(env) and len(rows_of(wid)) >= 10, env.get("status"))
    code, got = read("staff", "staffProfilePreferences", MASTER, {"staff": subject})
    p = (got.get("data") or {}).get("prefs") or {}
    check("staffProfilePreferencesSave: the next read of the preferences shows it, stamped as answered",
          p.get("shifts") == ["morning"] and p.get("note") == "Edition check"
          and (got.get("data") or {}).get("updated_at") == env["data"]["updated_at"], [code, got.get("status")])
    code, env2, wid = write(SW, "staffProfilePreferencesSave", MASTER, {"staff": subject, "prefs": {}, "expected": was})
    check("staffProfilePreferencesSave: a save on the old stamp is the 409", env2.get("status") == 409 and not rows_of(wid))


def ssa_doors():
    reads = L.Reads(db, None)
    subject, e = "", None
    for key in list(S.index(reads)["ssas"])[:300]:
        ctx = S.ssa_ctx(reads, key)
        if ctx.get("refused") or ctx.get("degraded"):
            continue
        got = S.edit_of(reads, ctx)
        if got["records"] and "phone" not in got["locked"] and not C._marked(got["raw"].get("phone")):
            subject, e = key, got
            break
    check("ssaProfileEdit: an SSA whose current clients' Hub records name them", bool(subject))
    if not subject:
        return
    code, got = read("ssa", "ssaProfileEditRead", MASTER, {"ssa": subject})
    check("ssaProfileEditRead: the master's panel opens with the fields and the records they land on",
          code == 200 and ((got.get("data") or {}).get("edit") or {}).get("records") == e["records"], got.get("status"))
    code, env, wid = write(SSW, "ssaProfileEdit", MASTER,
                           {"ssa": subject, "changes": [{"field": "phone", "value": NEW_PHONE, "expected": e["raw"]["phone"]},
                                                        {"field": "name", "value": "X", "expected": e["raw"]["name"]}]})
    kept = rows_of(wid)
    why = {r["field"]: r["why"] for r in (env.get("data") or {}).get("refused", [])}
    check("ssaProfileEdit: the master's phone kept final on every client record that names the SSA; the name locked",
          env.get("status") == 200 and final_of(env) and env["data"]["client_keys"] == e["records"]
          and {k[3] for k in kept if k[3] != "cleared_fields"} == {"ssa_phone"}
          and len([k for k in kept if k[3] == "ssa_phone"]) == len(e["records"]) and "name" in why,
          [env.get("status"), env.get("message"), len(kept), why])
    now = laid(lambda r: S.edit_of(r, S.ssa_ctx(r, subject))["raw"]["phone"])
    check("ssaProfileEdit: the next read of the SSA shows the phone", digits(now) == digits(NEW_PHONE))
    reload()
    now = laid(lambda r: S.edit_of(r, S.ssa_ctx(r, subject))["raw"]["phone"])
    check("ssaProfileEdit: still read after a reload of the copy", digits(now) == digits(NEW_PHONE))
    code, env, wid = write(SSW, "ssaProfileEdit", MASTER,
                           {"ssa": subject, "changes": [{"field": "phone", "value": NEW_PHONE2, "expected": "zz"}]})
    check("ssaProfileEdit: a stale witness is the 409", env.get("status") == 409 and not rows_of(wid))
    code, env, wid = write(SSW, "ssaProfileEdit", HOLD,
                           {"ssa": subject, "changes": [{"field": "email", "value": NEW_MAIL, "expected": e["raw"]["email"]}]})
    check("ssaProfileEdit: not listed, no door", unknown(code, env), env)
    listed("ssa.profile")
    code, env, wid = write(SSW, "ssaProfileEdit", HOLD,
                           {"ssa": subject, "changes": [{"field": "email", "value": NEW_MAIL, "expected": e["raw"]["email"]}]})
    check("ssaProfileEdit: a holder of ssa.profile writes the e-mail, kept under that edition",
          env.get("status") == 200 and final_of(env) and {k[5] for k in rows_of(wid)} == {"ssa.profile"}, env.get("status"))
    EDITIONS["value"] = "[]"
    code, env, wid = write(SSW, "ssaProfileNoteAdd", MASTER, {"ssa": subject, "body": "Edition check"})
    nid = ((env.get("data") or {}).get("note") or {}).get("id", "")
    check("ssaProfileNoteAdd: the master's note kept final", env.get("status") == 200 and final_of(env) and nid.startswith("SSAN_"))
    code, got = read("ssa", "ssaProfileNotes", MASTER, {"ssa": subject})
    check("ssaProfileNoteAdd: the next read of the notes lists it", nid in json.dumps(got))
    code, env, wid = write(SSW, "ssaProfileNoteAdd", HOLD, {"ssa": subject, "body": "x"})
    check("ssaProfileNoteAdd: the master's alone", unknown(code, env) or env.get("status") == 403, env)


def family_doors():
    reads = L.Reads(db, None)
    subject, e, ctx = "", None, None
    for key in list(F.index(reads)["families"])[:400]:
        c = F.family_ctx(reads, key)
        if c.get("refused") or c.get("degraded") or not c["family"]["clients"]:
            continue
        got = F.edit_of(reads, c)
        if got["records"] and "address" not in got["locked"] and "phone" not in got["locked"] \
                and not C._marked(got["raw"].get("address")):
            subject, e, ctx = key, got, c
            break
    check("familyProfileSave: a family member whose clients' Hub records name them", bool(subject))
    if not subject:
        return
    code, env, wid = write(FW, "familyProfileSave", MASTER, {"family": subject, "changes": [
        {"field": "address", "value": "1 Edition Check Way, Akron OH", "expected": e["raw"]["address"]}]})
    kept = rows_of(wid)
    check("familyProfileSave: the master's address kept final on every client record that names the member",
          env.get("status") == 200 and final_of(env) and env["data"]["client_keys"] == e["records"]
          and len([k for k in kept if k[3] == "guardian_address"]) == len(e["records"]),
          [env.get("status"), env.get("message"), len(kept)])
    now = laid(lambda r: F.edit_of(r, F.family_ctx(r, subject))["raw"]["address"])
    check("familyProfileSave: the next read of the member shows it", now == "1 Edition Check Way, Akron OH")
    reload()
    now = laid(lambda r: F.edit_of(r, F.family_ctx(r, subject))["raw"]["address"])
    check("familyProfileSave: still read after a reload of the copy", now == "1 Edition Check Way, Akron OH")
    code, env, wid = write(FW, "familyProfileSave", MASTER, {"family": subject, "changes": [
        {"field": "address", "value": "2 Other Way", "expected": "zz"}]})
    check("familyProfileSave: a stale witness is the 409", env.get("status") == 409 and not rows_of(wid))
    code, env, wid = write(FW, "familyProfileSave", HOLD, {"family": subject, "changes": [
        {"field": "phone", "value": NEW_PHONE, "expected": e["raw"]["phone"]}]})
    check("familyProfileSave: not listed, no door", unknown(code, env), env)
    listed("family.profile", "family.notes", "family.calls", "family.incidents")
    code, env, wid = write(FW, "familyProfileSave", HOLD, {"family": subject, "changes": [
        {"field": "phone", "value": NEW_PHONE, "expected": e["raw"]["phone"]},
        {"field": "name", "value": "Someone Else", "expected": e["raw"]["name"]}]})
    why = {r["field"]: r["why"] for r in (env.get("data") or {}).get("refused", [])}
    check("familyProfileSave: a holder writes the phone (kept under family.profile); a rename stays the master's",
          env.get("status") == 200 and final_of(env) and {k[5] for k in rows_of(wid)} == {"family.profile"}
          and why.get("name") == F.RENAME_LOCK["why"], [env.get("status"), why])
    code, env, wid = write(FW, "familyProfileNoteAdd", HOLD, {"family": subject, "body": "Edition check"})
    nid = ((env.get("data") or {}).get("note") or {}).get("id", "")
    seen = laid(lambda r: [n for n in F.own_rows(r, subject) if n.get("id") == nid])
    check("familyProfileNoteAdd: a holder's note kept final and read back", env.get("status") == 200 and final_of(env)
          and len(seen) == 1)
    ck = ctx["family"]["clients"][0]["client_key"]
    code, env, wid = write(FW, "familyProfileIncidentTie", HOLD, {"family": subject, "client_key": ck,
                                                                  "incident_ts": "2026-10-10T12:00:00"})
    code2, env2, wid2 = write(FW, "familyProfileIncidentTie", HOLD, {"family": subject, "client_key": ck,
                                                                     "incident_ts": "2026-10-10T12:00:00"})
    check("familyProfileIncidentTie: tied once (kept final); the same tie again is 'already', nothing kept",
          env.get("status") == 200 and final_of(env) and env["data"]["tie"]["already"] is False
          and env2.get("status") == 200 and env2["data"]["tie"]["already"] is True and not rows_of(wid2))
    day = gsjs.day_shift(TODAY, 1)
    code, env, wid = write(FW, "familyProfileCallSchedule", HOLD, {"family": subject, "client_key": ck, "date": day,
                                                                   "priority": "normal", "details": "Edition check"})
    card = ((env.get("data") or {}).get("call") or {}).get("id", "")
    kinds = sorted({(k[0], k[1]) for k in rows_of(wid)})
    check("familyProfileCallSchedule: a holder's card and its tie row kept final (the card on tasks, the tie on the "
          "notes), said to be kept in the Hub's database",
          env.get("status") == 200 and final_of(env) and len(kinds) == 2 and all(k == "append" for _t, k in kinds)
          and env["data"].get("notes") == [FW.CALL_KEPT], [env.get("status"), env.get("message"), kinds])
    listed_calls = laid(lambda r: [x for x in F.calls_for(r, subject, F.call_ties_of(F.own_rows(r, subject)))
                                   if gsjs.str_(x.get("id")) == card])
    check("familyProfileCallSchedule: the family member's activity finds the holder's card", len(listed_calls) == 1)
    EDITIONS["value"] = "[]"
    code, env, wid = write(FW, "familyProfileCallSchedule", HOLD, {"family": subject, "client_key": ck, "date": day})
    check("familyProfileCallSchedule: not listed, no door", unknown(code, env), env)


try:
    with real.transaction():
        for name, fn in (("Staff record", staff_doors), ("Staff driving", driving_door), ("Staff MAIS", mais_door),
                         ("Staff IST", ist_door), ("Staff notes and preferences", notes_and_prefs),
                         ("SSA", ssa_doors), ("Families", family_doors)):
            guarded(name, fn)
        with real.cursor() as c:
            c.execute("select count(*), count(distinct write_id) from pg_temp.hub_edits_check")
            n, w = c.fetchone()
        facts["cells kept in the check's app.edits (temp)"] = f"{n} cells from {w} writes"
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
with psycopg.connect(hubdb._dsn(), autocommit=True, connect_timeout=5) as c2:
    # a closed session's backend drops its temp tables before it leaves the activity view
    for _ in range(20):
        left = c2.execute("select count(*) from pg_stat_activity where application_name = 'editions-people-check'").fetchone()[0]
        if not left:
            break
        time.sleep(0.5)
    live_edits = c2.execute("select to_regclass('app.edits') is not null").fetchone()[0]
check("nothing is left: the check's session is gone, its temp tables with it", left == 0, left)
facts["app.edits in the live database"] = "exists (untouched by this check)" if live_edits else "not made yet (untouched)"
facts["slowest decision per door (s)"] = ", ".join(f"{a} {t:.1f}" for a, t in sorted(spent.items()))
facts["peak memory (MiB)"] = str(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024)
print(json.dumps({"checks": out, "facts": facts}))
'''


def live() -> None:
    print("the doors, on real subjects (asa-hub-db-sync)")
    blob = {"app": {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=1500)
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
