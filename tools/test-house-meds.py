#!/usr/bin/env python3
"""
THE PHARMACY'S REPORTS, READ ONCE — asserted against the real functions.

WHAT IT PROVES (docs/DESIGN-house-supplies-medications.md §6, §9, §11):

  H1  the name check: every way a report gets renamed keeps its KDP key, the
      three ` (1)` files keep their own, and a raw name never names a
      resident in a mirrored book
  H2  who reads: every house for the badges that decide everywhere (never a
      role word), a house manager's own houses only (never `whole_company`),
      nobody else, and never a client or a guardian
  H3  the relay's keeper never copies the clinical books nor the pharmacy
      folder — listed OR due — by the titles, pointers and parent the mint
      and the lane name; the clinical books are never gathered and the mint
      refuses them unless private. (The intelligence platform's own backup of
      the folder is outside this checkout: docs §13.)
  H4  the door counts what is PRESENT, compares text as text, and refuses to
      change an immutable line
  H5  the whole lane against a real Postgres in a SCHEMA OF ITS OWN: the 31
      files give N lines once; again gives 0 new lines and 31 refusals; the
      native copy, a renamed copy, a changed row, a widened period, a
      truncated download, an older parser's verdict, two readers and two
      committers at once — each refused, recorded or retried as it should
      be, and nothing ever merged. Then the gaps: the md5 layer against a
      refused or expired drop, a folder gate that died, two revisions of one
      Drive file, two different reports waiting for one period, the house
      copy owed after a match, and every unique index and CHECK refusing on
      its own with the code's checks off.

A FAILURE ON THE REAL REPORTS PRINTS NO VALUE OF THEM: a crash there, and any
output of a lane that died, is shown as exception types and code lines only.

HOW IT RUNS, like test-web-notices: the pure half imports the modules on the
host with psycopg2 stubbed; the lane half ships the checkout's modules into the
relay's container over stdin (a folder of its own per run, removed when the
run ends) and runs against schemas created and dropped inside the run. The
real reports are read only when the container holds them (/tmp/meds_inspect);
synthetic fixtures carry every odd shape and no PHI.

A LANE THAT CRASHED IS A FAILURE. Only a missing docker or relay container is
a skip, and it says so.

    python3 tools/test-house-meds.py
"""
import ast
import json
import os
import re
import subprocess
import sys
import types
from pathlib import Path

sys.dont_write_bytecode = True
import lane_schema  # noqa: E402 — beside this file
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SERVER = ROOT / "server"
CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")

results = {"ok": 0, "failed": [], "skipped": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:600]}")


if "psycopg2" not in sys.modules:  # pragma: no cover - the host has no driver
    fake = types.ModuleType("psycopg2")
    fake.connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no database in this test"))
    fake.Error = Exception
    fake.IntegrityError = type("IntegrityError", (Exception,), {})
    extras = types.ModuleType("psycopg2.extras")
    extras.RealDictCursor = object
    extras.Json = lambda v: v
    errors = types.ModuleType("psycopg2.errors")
    errors.UniqueViolation = type("UniqueViolation", (Exception,), {})
    fake.extras, fake.errors = extras, errors
    sys.modules["psycopg2"] = fake
    sys.modules["psycopg2.extras"] = extras
    sys.modules["psycopg2.errors"] = errors

sys.path.insert(0, str(SERVER))
os.environ.setdefault("HUB_SNAPSHOT_OUT", "/tmp")
import badge_follows  # noqa: E402
import house_meds as hm  # noqa: E402
import hub_sheet_sync as hss  # noqa: E402
import shift_requests as sr  # noqa: E402

H1_HOUSE = "CAN - 48TH (B) - ABD1711"
sr.house_managers = lambda dsn, fresh=False, today=None: {
    "readable": True, "why": "", "by_code": {"ABD1711": {"name": "Hal Manager", "phone": "", "house": H1_HOUSE}}}


print("\nH1 — the name check")
K = "kdp|a brighter dawn|2025-08-20"
same_report = [
    "Key Data Points, A Brighter Dawn, 2025-08-20_050000.xlsx",
    "Key Data Points, A Brighter Dawn, 2025-08-20_050000",
    "Key Data Points, A Brighter Dawn, 2025-08-20_050000.GSHEET.xlsx",
    "Key Data Points, A Brighter Dawn, 2025-08-20_050001.xlsx",
    "Key Data Points, A Brighter Dawn, 2025-08-20_050000 (1).xlsx",
    "Key Data Points, A Brighter Dawn, 2025-08-20_050000 2.xlsx",
    "Copy of Key Data Points, A Brighter Dawn, 2025-08-20_050000.xlsx",
    "Key Data Points, A Brighter Dawn, 2025-08-20_050000 - Copy.xlsx",
    "Key Data Points, A Brighter Dawn, 2025–08–20_050000.xlsx",
    "reports/Key  Data Points,  A Brighter Dawn, 2025-08-20_170150.xlsx",
]
check("every rename of one report keeps its KDP key (native, export marker, rerun time, (1), macOS 2, "
      "Copy of, - Copy, Unicode dashes, a folder path)",
      all(hm.name_key(n)["key"] == K for n in same_report),
      {n: hm.name_key(n)["key"] for n in same_report if hm.name_key(n)["key"] != K})
ones = ["Key Data Points, A Brighter Dawn, 2025-06-06_050000 (1).xlsx",
        "Key Data Points, A Brighter Dawn, 2025-12-18_050000 (1).xlsx",
        "Key Data Points, A Brighter Dawn, 2026-07-31_050000 (1).xlsx"]
check("the three ` (1)` files keep three different keys of their own",
      len({hm.name_key(n)["key"] for n in ones}) == 3 and all(hm.name_key(n)["kdp"] for n in ones))
check("a raw name loses its copy markers and nothing else — a date inside it is not chewed",
      hm.name_key("meds report (1).xlsx")["key"] == hm.name_key("Copy of meds report 2.xlsx")["key"]
      == "raw|meds report" and hm.name_key("meds 2025-08-20.xlsx")["key"] == "raw|meds 2025-08-20")
check("a mirrored book never carries a raw file name (it may name a resident)",
      hm.public_name("Ann Test meds.xlsx") == hm.UNRECOGNISED
      and hm.public_name(same_report[0]) == same_report[0])
tail = hm.public_name("Key Data Points, A Brighter Dawn, 2025-08-20 Ann Test meds.xlsx")
odd = hm.public_name("Key Data Points, Ann Test, 2025-08-20.xlsx")
check("a KDP name is REBUILT from its key: whatever follows the date, and a pharmacy word, never travel",
      tail == "Key Data Points, A Brighter Dawn, 2025-08-20.xlsx" and "Ann" not in odd and "Test" not in odd,
      [tail, odd])
check("the pharmacy is a lane constant, not a column the file could change",
      hm.PHARMACY == "A Brighter Dawn" and "pharmacy" not in hm.KEYS)


print("\nH2 — who reads the medications")


def viewer(name, role="staff", types_=""):
    return sr.viewer("dsn", name=name, role=role, types=types_)


FOLLOWER = next((w for w, stands in badge_follows.BADGE_FOLLOWS.items() if stands == "DIRECTOR"), "")
admin = hm.scope_of(viewer("Ada Admin", "admin", "ADMINISTRATOR"))
check("an administrator reads every house and imports", admin["every_house"] and admin["writer"], admin)
if FOLLOWER:
    tl = hm.scope_of(viewer("Tia Lead", "staff", FOLLOWER))
    check("the badge that stands in for a director reads every house and imports (the follow counts)",
          tl["every_house"] and tl["writer"], tl)
hal = hm.scope_of(viewer("Hal Manager", "staff", "HM"))
check("a ticked HM badge who manages ONE house sees that house only, and does not import",
      hal["reader"] and not hal["every_house"] and not hal["writer"] and hal["houses"] == ["ABD1711"], hal)
lone = hm.scope_of(viewer("Hana Badge", "staff", "HM"))
check("a ticked HM badge that manages no house reads nothing, and is told why",
      lone["reader"] and lone["houses"] == [] and lone["why"], lone)
mgr_badge = viewer("Mo Badge", "staff", "MANAGER")
check("never `whole_company`: a badge that makes the company's list whole does not open the medications",
      mgr_badge["whole_company"] is True and not hm.scope_of(mgr_badge)["reader"], hm.scope_of(mgr_badge))
check("a caregiver without HM reads nothing", not hm.scope_of(viewer("Ann Roe"))["reader"])
check("a client and a guardian are refused outright",
      not hm.scope_of(viewer("", "client", "CLIENT"))["reader"]
      and not hm.scope_of(viewer("Gus", "staff", "GUARDIAN"))["reader"])
src_scope = ast.get_source_segment((SERVER / "house_meds.py").read_text(), next(
    n for n in ast.parse((SERVER / "house_meds.py").read_text()).body
    if isinstance(n, ast.FunctionDef) and n.name == "scope_of"))
check("the reach is asked of decides_everywhere and the ** rows, never whole_company nor a role exception",
      "decides_everywhere" in src_scope and "edits_every_house(" not in src_scope
      and "whole_company\"]" not in src_scope and "get(\"whole_company\")" not in src_scope)
role_only = viewer("Mo Role", "manager", "")
check("the calendars' named role exception edits every calendar but reads no medication",
      sr.edits_every_house(role_only) and not hm.scope_of(role_only)["reader"], hm.scope_of(role_only))


print("\nH3 — the mirror never copies the clinical books")
mint_src = (ROOT / "tools" / "mint_house_meds_houses.py").read_text(encoding="utf-8")
check("the keeper refuses both clinical titles, and lets the ledger through",
      {"ASA Data — MedDispenses", "ASA Data — MedPatients"} <= hss.KEEP_OUT_TITLES
      and "ASA Data — MedImports" not in hss.KEEP_OUT_TITLES)
check("the keeper refuses both clinical pointers",
      {"switchboard:props.HUB_HOUSE_MED_DISPENSES_ID", "switchboard:props.HUB_HOUSE_MED_PATIENTS_ID"}
      <= set(hss.KEEP_OUT_POINTERS))
check("the mint writes exactly those titles and pointer names",
      all(s in mint_src for s in ('"ASA Data — MedDispenses"', '"ASA Data — MedPatients"',
                                  '"HUB_HOUSE_MED_DISPENSES_ID"', '"HUB_HOUSE_MED_PATIENTS_ID"')))
check("a book whose parent is the pharmacy folder is kept out; any other is not",
      hss.kept_out({"id": "x1", "name": "Key Data Points", "parents": [hm.FOLDER_ID]}, set())
      and not hss.kept_out({"id": "x2", "name": "ASA Data — Plain", "parents": ["elsewhere"]}, set()))
check("the keeper's listing asks for `parents`",
      "files(id,name,modifiedTime,parents)" in (SERVER / "hub_sheet_sync.py").read_text())


class _Cur:
    def __init__(self, rows):
        self.rows = rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, *a, **k):
        pass

    def fetchall(self):
        return list(self.rows)


class _Conn(_Cur):
    def cursor(self):
        return _Cur(self.rows)


class _DueStore(hss.PgStore):
    """The real PgStore.due over rows as asa_drive_sheets_meta holds them."""

    def __init__(self, rows):
        self.rows = rows

    def _conn(self):
        return _Conn(self.rows)

    def watermark(self):
        return hss.datetime.now(hss.timezone.utc)

    def known(self, ids):
        return {}

    def pointer_ids(self, sources):
        return set()

    def save_pass(self, *a, **k):
        pass


class _NoDrive:
    def files(self):
        return self

    def list(self, **kw):
        return types.SimpleNamespace(execute=lambda: {"files": []})


due_rows = [("sheetPharmacy", "Key Data Points", None, json.dumps([hm.FOLDER_ID])),
            ("sheetOther", "ASA Data — Plain", None, json.dumps(["elsewhere"]))]
synced: list[str] = []
real_sync = hss.sync_book
hss.sync_book = lambda sheets, store, pace, f, **k: synced.append(f["id"]) or hss.BookResult()
try:
    due_store = _DueStore(due_rows)
    hss.one_pass(drive=_NoDrive(), sheets=object(), store=due_store, now=lambda: 1.0e9)
    due_said = due_store.due(1.0e9, set())
finally:
    hss.sync_book = real_sync
check("the DUE road carries the meta row's parents, so a book in the pharmacy folder is kept out there too",
      [d.get("parents") for d in due_said] == [[hm.FOLDER_ID], ["elsewhere"]] and synced == ["sheetOther"],
      {"synced": synced, "parents": [d.get("parents") for d in due_said]})
gather_src = (ROOT / "apps-script" / "GatherDatabase.gs").read_text(encoding="utf-8")
keep_apart = re.search(r"GATHER_KEEP_APART\s*=\s*\[([^\]]*)\]", gather_src)
check("the gather never moves the clinical books: both pointers are kept apart, and skipped before any move",
      keep_apart is not None and "'HUB_HOUSE_MED_DISPENSES_ID'" in keep_apart.group(1)
      and "'HUB_HOUSE_MED_PATIENTS_ID'" in keep_apart.group(1)
      and "'HUB_HOUSE_MED_IMPORTS_ID'" not in keep_apart.group(1)
      and "gatherKeptApart_(key, subj)" in gather_src)
check("the mint writes no moved switch for a clinical book, and refuses one that is not private",
      "if not clinical and have.get(f\"switchboard:moved.{tab}\")" in mint_src
      and "private_to_owner(tok, sid)" in mint_src and mint_src.count("sys.exit(f\"REFUSED:") == 2
      and '"clinical": True' in mint_src and mint_src.count('"clinical": True') == 2)
check("the mint reads the relay's own headers, never a second copy",
      "relay_headers()" in mint_src and "HOUSE_HEADERS" in mint_src
      and all(tab in hm.HOUSE_HEADERS for tab in ("med_imports", "med_dispenses", "med_patients")))
check("the ledger's house carries no name and no drug column",
      not {"last_name", "first_name", "drug", "patid"} & set(hm.HOUSE_HEADERS["med_imports"]))


print("\nH4 — the door, run by node over its own source")
DOOR_JS = r"""
const fs = require('fs'); const vm = require('vm');
const src = fs.readFileSync(process.argv[process.argv.length - 1], 'utf8');
function Sheet(values, tz) {
  this.v = values; this.tz = tz; this.fmt = [];
}
Sheet.prototype.getParent = function () { const s = this; return { getSpreadsheetTimeZone: () => s.tz }; };
Sheet.prototype.getMaxRows = function () { return Math.max(this.v.length, 10); };
Sheet.prototype.getLastRow = function () { return this.v.length; };
Sheet.prototype.insertRowsAfter = function () {};
Sheet.prototype.getDataRange = function () { const s = this; return { getValues: () => s.v.map(r => r.slice()) }; };
Sheet.prototype.getRange = function (row, col, n, w) {
  const s = this;
  return { setNumberFormat: (f) => { s.fmt.push(f); },
           setValues: (rows) => { rows.forEach((r, i) => { s.v[row - 1 + i] = r.slice(); }); } };
};
const header = ['id', 'report_start', 'qty_remaining', 'sig'];
const sheets = {
  med_dispenses: new Sheet([header, ['MD-1', new Date(Date.UTC(2025, 7, 5, 12)), 30, '1/2 TAB']], 'UTC'),
  med_patients: new Sheet([header, ['P-1', '2025-08-05', '7', 'x']], 'UTC'),
};
const ctx = {
  HUB_POLICY: {}, HUB_ACTIONS: {}, HOUSE_DATA_TAB: 'Data', JSON, String, Object, Math, Date,
  houseIdFor_: (t) => sheets[t] ? 'id-' + t : '',
  ssOpen_: (id) => ({ getSheetByName: (n) => sheets[n] || null }),
  ensureHeader_: (sh, keys) => header,
  laneMirrorSafeRows_: (r) => r,
  hubDenied_: () => ({ status: 403 }),
  hubSysLog_: () => {},
  Utilities: { formatDate: (d, tz, p) => d.toISOString().slice(0, 10) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
};
vm.createContext(ctx); vm.runInContext(src, ctx);
const svc = { is_service: true };
const same = ctx.HUB_ACTIONS.houseMedsIngest({ tabs: {
  med_dispenses: { header, rows: [['MD-1', '2025-08-05', '30', '1/2 TAB'], ['MD-2', '2025-08-06', '10', 'y']] } } }, svc);
const changed = ctx.HUB_ACTIONS.houseMedsIngest({ tabs: {
  med_dispenses: { header, rows: [['MD-1', '2025-08-05', '29', '1/2 TAB']] },
  med_patients: { header, rows: [['P-1', '2025-08-05', '8', 'x']] } } }, svc);
const refused = ctx.HUB_ACTIONS.houseMedsIngest({ tabs: {} }, { is_service: false });
console.log(JSON.stringify({ same: same.data, changed: changed.data, refused: refused.status,
  text: sheets.med_dispenses.fmt.indexOf('@') !== -1, rows: sheets.med_dispenses.v.length,
  patient: sheets.med_patients.v[1] }));
"""
try:
    door = subprocess.run(["node", "-e", DOOR_JS, str(ROOT / "apps-script" / "HouseMeds.gs")],
                          capture_output=True, text=True, timeout=60)
    said = json.loads(door.stdout.strip().splitlines()[-1]) if door.returncode == 0 else None
except Exception as exc:  # noqa: BLE001
    said = None
    door = types.SimpleNamespace(stderr=str(exc))
check("the door ran under node", said is not None, getattr(door, "stderr", "")[-400:])
if said:
    check("a cell Sheets turned into a Date or a number counts as PRESENT, not a conflict",
          said["same"]["present"]["med_dispenses"] == 2 and said["same"]["conflicts"]["med_dispenses"] == 0
          and said["same"]["written"]["med_dispenses"] == 1, said["same"])
    check("every tab is written as text ('@')", said["text"] is True)
    check("a dispensed line is immutable: a changed value is a conflict, nothing rewritten",
          said["changed"]["conflicts"]["med_dispenses"] == 1 and said["changed"]["present"]["med_dispenses"] == 0
          and said["rows"] == 3, said["changed"])
    check("a patient row is patched in place and counted present",
          said["changed"]["present"]["med_patients"] == 1 and said["patient"][2] == "8", said)
    check("only the service identity may open the door", said["refused"] == 403)


print("\nH4b — the relay's doors and the SPA's promises")
svc_src = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
doors = ['@app.get("/hub-lanes/house-supplies/meds")', '@app.get("/hub-lanes/house-supplies/meds/rx")',
         '@app.post("/hub-lanes/house-supplies/meds/preview")', '@app.post("/hub-lanes/house-supplies/meds/folder")',
         '@app.post("/hub-lanes/house-supplies/meds/commit")', '@app.post("/hub-lanes/house-supplies/meds/match")']
check("the six doors exist under /hub-lanes/", all(d in svc_src for d in doors))
check("every door answers no-store", svc_src.count("    _meds_no_store(response)\n") == 6)
check("the gate is the House Supplies app, never an onboarding or interviewer role",
      'app_id="house-supplies", refuse_roles=("onboarding", "interviewer")' in svc_src)
svc_tree = ast.parse(svc_src)


def svc_segment(name):
    for node in svc_tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(svc_src, node) or ""
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == name for t in node.targets):
            return ast.get_source_segment(svc_src, node) or ""
    return ""


meds_route = svc_segment("lane_house_meds")
client_gate = svc_segment("_meds_client_reader")
check("?client= learns the master flag through My Work's one learner before it is judged, then asks the Clients "
      "app's release; no new authMe caller, and the House Supplies gate is not its lock",
      "unsure = await _my_work_learn_master(authorization)" in client_gate
      and '"action": "authMe"' not in meds_route + client_gate
      and client_gate.index("_my_work_learn_master(") < client_gate.index("flag = _auth_master.get(token)")
      < client_gate.index('_app_pack_released(authorization, "client-profiles")')
      and meds_route.index("_meds_client_reader(authorization)") < meds_route.index("_meds_reader(authorization)")
      < meds_route.index("house_meds.view_for, MEDS_DSN, scope"))
check("the relay hands no house copy to another engine: the pharmacy's reports are Postgres' record and the ASA "
      "Data books follow the Postgres → sheet sync", '"houseMedsIngest"' not in svc_src
      and "_house_meds_copy" not in svc_src)
snap_ts = (ROOT / "src" / "lib" / "snapshot.ts").read_text(encoding="utf-8")
check("no flat slice can ever be built: houseMeds is NEVER_SNAPSHOT",
      re.search(r"NEVER_SNAPSHOT[^=]*=\s*\[[\s\S]*?'houseMeds'", snap_ts) is not None)
check("House Supplies' list page is the custom page",
      "'house-supplies/list': HouseSuppliesPage" in (ROOT / "src" / "pages" / "AppRoutePage.tsx").read_text())


print("\nH4c — the meds door's ?client=, run with the relay's own gate code")
import asyncio  # noqa: E402
import logging  # noqa: E402

door_calls: list[str] = []
DOOR = {"role": "admin", "authme": None, "reader": True, "acting": set(), "released": False}
DOOR_MASTER: dict = {}


async def _door_session_actor(authorization):
    return (DOOR["role"], "u-1")


async def _door_reader(authorization, *, writer=False):
    door_calls.append("reader")
    if not DOOR["reader"]:
        return {"status": 403, "reason": "badge", "message": "House Supplies is not open to you."}
    return {"name": "Ada Admin"}, (DOOR["role"], "u-1"), {"reader": True, "every_house": True}


async def _door_released(authorization, app_id):
    door_calls.append(f"released:{app_id}")
    return DOOR["released"]


async def _door_auth_me(token):
    # the relay's own authMe of Python's sign-in
    door_calls.append("exec:authMe")
    if DOOR["authme"] is None:
        raise RuntimeError("no answer")
    return DOOR["authme"]


class _DoorActing:
    def known(self, token):
        return token in DOOR["acting"]


DOOR_SCOPES: list = []


def _door_view(dsn, scope, *, since="", client=""):
    door_calls.append(f"view:{client}")
    DOOR_SCOPES.append(dict(scope))
    return {"version": "v", "client": client}


def _door_history(dsn, scope, key, *, client=""):
    door_calls.append(f"history:{key}:{client}")
    DOOR_SCOPES.append(dict(scope))
    return {"rx_root": key} if key == "r1" else None


async def _door_not_python(*_a, **_k):
    """House Supplies off Python here: the relay's own door answers (the same tables)."""
    return None


door_ns = {"app": types.SimpleNamespace(get=lambda path: (lambda f: f)), "Header": lambda default="": default,
           "Response": object, "Any": object, "asyncio": asyncio, "log": logging.getLogger("test"),
           "PG_DSN": "dsn", "MEDS_DSN": "dsn", "_meds_python": _door_not_python, "house_meds": types.SimpleNamespace(view_for=_door_view, rx_history=_door_history),
           "_meds_reader": _door_reader, "_session_actor": _door_session_actor, "_auth_me": _door_auth_me,
           "_app_pack_released": _door_released,
           "_auth_master": DOOR_MASTER, "_acting": _DoorActing(), "_note_session_answer": lambda token, env: None}
for name in ("_MEDS_DOWN", "_MEDS_CLIENT_SCOPE", "_MEDS_CLIENT_SHUT", "_hotline_token", "_meds_no_store",
             "_my_work_acting", "_my_work_learn_master", "_meds_client_reader", "lane_house_meds", "lane_house_meds_rx"):
    code = svc_segment(name)
    check(f"the relay declares {name}", bool(code))
    exec(code, door_ns)  # noqa: S102 — the relay's own source


def meds_door(client="", auth="Bearer tok"):
    door_calls.clear()
    DOOR_SCOPES.clear()
    resp = types.SimpleNamespace(headers={})
    got = asyncio.run(door_ns["lane_house_meds"](resp, since="", client=client, authorization=auth))
    return got, list(door_calls), resp.headers.get("Cache-Control")


def rx_door(key, client="", auth="Bearer tok"):
    door_calls.clear()
    DOOR_SCOPES.clear()
    resp = types.SimpleNamespace(headers={})
    got = asyncio.run(door_ns["lane_house_meds_rx"](resp, key=key, client=client, authorization=auth))
    return got, list(door_calls), resp.headers.get("Cache-Control")


RELEASED = "released:client-profiles"
plain_got, plain_calls, plain_cc = meds_door()
check("without ?client= the House Supplies door asks no master check and builds the reader's view",
      plain_got["status"] == 200 and plain_calls == ["reader", "view:"] and plain_cc == "no-store",
      [plain_got, plain_calls])
unk_got, unk_calls, _ = meds_door(client="c_ann")
check("after a restart (flag unknown) with the check failing and the Clients app not released: authMe asked once, "
      "before the release; a 503 'unknown' saying the check failed — never a badge, never the view",
      unk_got["status"] == 503 and unk_got["reason"] == "unknown" and "(RuntimeError)" in unk_got["message"]
      and unk_calls == ["exec:authMe", RELEASED] and "c_ann" not in json.dumps(unk_got), [unk_got, unk_calls])
DOOR["authme"] = {"status": 200, "data": {"user": {"is_master": True}}}
learned_got, learned_calls, _ = meds_door(client="c_ann")
check("after a restart the master's open tab is learned as the master and reads the client — no reload, no "
      "House Supplies gate, a read-only every-house scope",
      learned_got["status"] == 200 and learned_got["data"]["client"] == "c_ann" and DOOR_MASTER.get("tok") is True
      and learned_calls == ["exec:authMe", "view:c_ann"]
      and DOOR_SCOPES == [{"reader": True, "writer": False, "every_house": True, "houses": [],
                           "managers_readable": True, "why": ""}], [learned_got, learned_calls, DOOR_SCOPES])
known_got, known_calls, _ = meds_door(client="c_ann")
check("a flag already known is not asked again", known_got["status"] == 200 and "exec:authMe" not in known_calls,
      known_calls)
DOOR["acting"].add("tok")
DOOR["released"] = True
act_got, act_calls, _ = meds_door(client="c_ann")
check("acting as someone with a stale True flag is refused as a badge, asking nothing — not even the release, "
      "which would read that flag",
      act_got["status"] == 403 and act_got["reason"] == "badge" and act_calls == [], [act_got, act_calls])
DOOR_MASTER.clear()
DOOR["role"] = "staff"
visit_got, visit_calls, _ = meds_door(client="c_ann")
check("inside a visit the visited account's release decides: released, the client's prescriptions are read",
      visit_got["status"] == 200 and visit_calls == [RELEASED, "view:c_ann"], [visit_got, visit_calls])
DOOR["released"] = False
vshut_got, vshut_calls, _ = meds_door(client="c_ann")
check("inside a visit to an account the Clients app is not released to, a badge refusal and nothing built",
      vshut_got["status"] == 403 and vshut_got["reason"] == "badge" and vshut_calls == [RELEASED],
      [vshut_got, vshut_calls])
DOOR["acting"].clear()
DOOR.update(role="admin", authme={"status": 200, "data": {"user": {"is_master": False}}})
not_got, not_calls, _ = meds_door(client="c_ann")
check("an admin the backend names not the master, the Clients app not released to it, is refused as a badge",
      not_got["status"] == 403 and not_got["reason"] == "badge" and DOOR_MASTER.get("tok") is False
      and not_calls == ["exec:authMe", RELEASED], [not_got, not_calls])
DOOR_MASTER.clear()
DOOR.update(role="staff", authme=None)
staff_got, staff_calls, _ = meds_door(client="c_ann")
check("a staff session the Clients app is not released to asks no master check and is refused as a badge",
      staff_got["status"] == 403 and staff_got["reason"] == "badge" and staff_calls == [RELEASED]
      and staff_got["message"] == "One client's prescriptions are not open to this account.",
      [staff_got, staff_calls])
DOOR.update(released=True, reader=False)
rel_got, rel_calls, _ = meds_door(client="c_ann")
check("a staff session the Clients app IS released to reads the client's prescriptions, House Supplies unreleased "
      "to it and never asked; without ?client= House Supplies' refusal stands",
      rel_got["status"] == 200 and rel_got["data"]["client"] == "c_ann" and rel_calls == [RELEASED, "view:c_ann"]
      and meds_door()[0].get("message") == "House Supplies is not open to you.", [rel_got, rel_calls])
h_got, h_calls, h_cc = rx_door("r1", client="c_ann")
h_other, _, _ = rx_door("r9", client="c_ann")
check("the history door's ?client= is the same gate, and the history is asked narrowed to that client; another "
      "client's key is the same 404 as no key",
      h_got["status"] == 200 and h_calls == [RELEASED, "history:r1:c_ann"] and h_cc == "no-store"
      and h_other["status"] == 404 and h_other["message"] == "No such prescription.", [h_got, h_calls, h_other])
hp_got, hp_calls, _ = rx_door("r1")
check("the history door without ?client= stays House Supplies'",
      hp_got["status"] == 403 and hp_calls == ["reader"], [hp_got, hp_calls])
DOOR.update(released=False, reader=True)
hs_got, hs_calls, _ = rx_door("r1", client="c_ann")
check("the history door refuses ?client= to a session the Clients app is not released to, and reads nothing",
      hs_got["status"] == 403 and hs_calls == [RELEASED], [hs_got, hs_calls])
DOOR.update(role="admin", authme=None)


def _rx_line(patid):
    return {"patid": patid, "report_start": None, "report_end": None, "drug": "D", "physician": "", "date_written": None,
            "last_dispense": None, "dispensed_in_period": "1", "qty_written": None, "qty_remaining": None,
            "qty_dispensed_to_date": "1", "cutoff": None, "sig": "", "import_id": "i"}


_keep_hm = (hm.model, hm._visible)
try:
    hm.model = lambda dsn: {"families": {"ra": [_rx_line("P1")], "rb": [_rx_line("P2")], "rc": [_rx_line("P3")]}}
    hm._visible = lambda dsn, m, scope: ({
        "P1": {"key": "P1", "client_key": "c_ann", "group": "house"},
        "P2": {"key": "P2", "client_key": "c_bob", "group": "house"},
        "P3": {"key": "P3", "client_key": "c_ann", "group": "unmatched"}}, "s")
    every = {"reader": True, "every_house": True}
    narrowed = {k: bool(hm.rx_history("dsn", every, k, client="c_ann")) for k in ("ra", "rb", "rc", "rz")}
    wide = {k: bool(hm.rx_history("dsn", every, k)) for k in ("ra", "rb", "rc")}
finally:
    hm.model, hm._visible = _keep_hm
check("rx_history's client answers only a family of a resident matched to that client (never one in review), as "
      "view_for narrows; without it the reader's whole scope",
      narrowed == {"ra": True, "rb": False, "rc": False, "rz": False} and wide == {"ra": True, "rb": True, "rc": True},
      [narrowed, wide])


# ═══════════════════════════════════════════════════════════════════════════
# THE LANE, IN THE RELAY'S CONTAINER
# ═══════════════════════════════════════════════════════════════════════════
LANE = r'''
import glob, hashlib, io, json, os, re, sys, threading, time, zipfile
from datetime import date, timedelta
sys.path.insert(0, HERE_DIR)
import psycopg2, psycopg2.extras
import openpyxl
import lane_schema
import house_meds as hm
import shift_requests as sr

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
ROOMS = lane_schema.Rooms(DSN, "house-meds")
OUT = {"real": None, "owned": {}}
HDR = list(hm.HEADER)
REAL = "/tmp/meds_inspect"
H1 = "CAN - 48TH (B) - ABD1711"
MANAGERS = {"ABD1711": {"name": "Hal Manager", "phone": "", "house": H1}}
sr.house_managers = lambda dsn, fresh=False, today=None: {"readable": True, "why": "", "by_code": dict(MANAGERS)}


def schema(tag):
    name = ROOMS.make(tag)
    dsn = ROOMS.path(name)
    # every table the code reads is this schema's before its first read
    OUT["owned"][tag] = lane_schema.own_shift_lane(dsn, name, HERE_DIR, make=hm.DDL)["lane"]
    return dsn


def q(dsn, sql, args=()):
    with psycopg2.connect(dsn) as c, c.cursor() as cur:
        cur.execute(sql, args)
        rows = cur.fetchall() if cur.description else []
    c.close()
    return rows


class _Req:
    def __init__(self, fn):
        self.fn = fn

    def execute(self):
        return self.fn()


class FakeDrive:
    def __init__(self):
        self.items, self.downloads, self.truncate_once = {}, {}, set()
        self.list_delay, self.fail_list = 0.0, False

    def add(self, fid, name, data, *, native=False, who="pharmacy@example.test", mtime="2030-01-01T05:00:00.000Z"):
        self.items[fid] = {"id": fid, "name": name, "mimeType": hm.GSHEET_MIME if native else hm.XLSX_MIME,
                           "md5Checksum": "" if native else hashlib.md5(data).hexdigest(),
                           "size": str(len(data)), "modifiedTime": mtime,
                           "lastModifyingUser": {"emailAddress": who}, "_b": data}

    def files(self):
        return _Files(self)


class _Files:
    def __init__(self, d):
        self.d = d

    def list(self, **kw):
        def go():
            if self.d.fail_list:
                raise RuntimeError("drive down")
            if self.d.list_delay:
                time.sleep(self.d.list_delay)
            return {"files": [{k: v for k, v in f.items() if k != "_b"} for f in self.d.items.values()]}
        return _Req(go)

    def get_media(self, fileId, **kw):
        def go():
            self.d.downloads[fileId] = self.d.downloads.get(fileId, 0) + 1
            data = self.d.items[fileId]["_b"]
            if fileId in self.d.truncate_once:
                self.d.truncate_once.discard(fileId)
                return data[: len(data) // 2]
            return data
        return _Req(go)

    def export(self, fileId, mimeType):
        return self.get_media(fileId)


def dl(drive):
    return sum(drive.downloads.values())


def strip_dimension(data):
    src = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for item in src.infolist():
            b = src.read(item.filename)
            if item.filename.startswith("xl/worksheets/sheet"):
                b = re.sub(rb"<dimension[^>]*/>", b"", b)
            z.writestr(item, b)
    return out.getvalue()


def book(rows, *, wide=False, no_dim=False, sheet="KDP", header=None, blanks=False):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
    head = list(header if header is not None else HDR)
    extra = [None] * 8 if wide else []
    ws.append(head + extra)
    for i, r in enumerate(rows):
        ws.append(list(r) + extra)
        if blanks:
            ws.append([None] * (len(head) + len(extra)))
    bio = io.BytesIO()
    wb.save(bio)
    data = bio.getvalue()
    return strip_dimension(data) if no_dim else data


def resave(data):
    wb = openpyxl.load_workbook(io.BytesIO(data))
    wb.properties.creator = "another export"
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


def f4(x):
    return f"{x:.4f}"


def ymd(d):
    return d.strftime("%Y/%m/%d")


BASE = date(2030, 1, 1)


def start_of(k):
    return BASE + timedelta(days=15 * k)


def kdp_name(k, extra=""):
    return f"Key Data Points, A Brighter Dawn, {(start_of(k) + timedelta(days=15)).isoformat()}_050000{extra}.xlsx"


ANN = {"id": "T90001", "first": "Ann", "last": "Test"}
BOB = {"id": "T90002", "first": "Bob", "last": "Test"}
CY = {"id": "T90003", "first": "Cy", "last": "Test"}
DEE = {"id": "T90004", "first": "Dee", "last": "Test"}
EVE = {"id": "T90005", "first": "Eve", "last": "Nomatch"}
ANN2 = {"id": "T90006", "first": "Ann", "last": "Test"}
FAY = {"id": "T90007", "first": "Fay", "last": "Test"}
WRITTEN = date(2029, 12, 1)
CLIENTS = [{"client_key": "c_ann", "name": "Ann Test", "house": "ABD1711"},
           {"client_key": "c_bob", "name": "Bob Test", "house": "ABD2704"},
           {"client_key": "c_cy", "name": "Cy Test", "house": "ABD1711"},
           {"client_key": "c_dee", "name": "Dee Test", "house": ""},
           {"client_key": "c_fay", "name": "Fay Test", "house": "ABD2704"}]
STAMP = ["s1"]
hm.CLIENTS_READER = lambda: ([dict(c) for c in CLIENTS], STAMP[0])


def row(k, pat, drug, *, total=None, rem=None, sumd=30, end_days=14, start=None, last=3, physician="DR TEST ONE",
        qw=900, cutoff="", facility="TSTFAC"):
    s = start or start_of(k)
    total = 30 * (k + 1) if total is None else total
    rem = qw - total if rem is None else rem
    return [ymd(s), ymd(s + timedelta(days=end_days)), pat["last"], pat["first"], physician, drug, f4(sumd),
            ymd(s + timedelta(days=last)), ymd(WRITTEN), cutoff, f4(qw), f4(rem), f4(total),
            "TAKE 1 TABLET BY MOUTH DAILY", "", "", facility, pat["id"]]


def period_rows(k, *, ann_label=None, cy_label=None, cy_total=None, bob=BOB, extra=()):
    return [row(k, ANN, ann_label or ("LISINOPRIL 10MG TAB" if k == 0 else "LISINOPRIL 10 MG TABLET")),
            row(k, bob, "METFORMIN 500MG TAB"),
            row(k, CY, cy_label or ("ATORVASTATIN 20MG" if k == 0 else "ATORVASTATIN CALCIUM 20MG"),
                total=cy_total, rem=0 if cy_total else None),
            row(k, DEE, "VITAMIN D3 1000 UNIT"),
            row(k, EVE, "ASPIRIN 81MG EC", cutoff=ymd(start_of(k) + timedelta(days=40)))] + list(extra)


ADMIN_ACTOR = {"uid": "u-admin", "label": "Ada Admin"}


def up(dsn, name, data):
    return hm.preview_upload(dsn, name=name, data=data, actor=ADMIN_ACTOR)


def commit_all(dsn):
    staged = [p["stage_id"] for p in hm.staged_previews(dsn)]
    return hm.commit(dsn, staged, actor=ADMIN_ACTOR) if staged else {"results": [], "counts": {}}


def lines_in(dsn):
    return q(dsn, "SELECT count(*) FROM hub_med_dispenses")[0][0]


def viewer(name, role="staff", types_=""):
    return sr.viewer("dsn", name=name, role=role, types=types_)


PHASE = ["real"]
try:
    # ── THE REAL REPORTS, when the container holds them ──────────────────
    if os.path.isdir(REAL) and glob.glob(REAL + "/*.xlsx"):
        R = schema("real")
        hm.forget_schema()
        hm.CLIENTS_READER = lambda: ([], "none")
        real = {}
        paths = sorted(glob.glob(REAL + "/*.xlsx"))
        # THE INDEPENDENT COUNT: every non-blank row of every distinct report,
        # read here with openpyxl and nothing of the module under test.
        n_lines, rx = 0, set()
        for p in paths:
            if ".GSHEET." in p:
                continue
            ws = openpyxl.load_workbook(p, read_only=True, data_only=True)["KDP"]
            it = ws.iter_rows(values_only=True)
            head = [str(c or "").strip() for c in next(it)]
            ix = {h: i for i, h in enumerate(head)}
            for r in it:
                r = list(r) + [None] * 30
                if any(c is not None and str(c).strip() for c in r[:18]):
                    n_lines += 1
                    rx.add((str(r[ix["PatID"]]).strip(), " ".join(str(r[ix["DrugLabelName"]]).split()).upper(),
                            str(r[ix["Date Written"]]).strip()))
        real["files"] = len(paths)
        real["n_independent"] = n_lines
        real["rx_independent"] = len(rx)
        drive = FakeDrive()
        for i, p in enumerate(paths):
            base = os.path.basename(p)
            native = ".GSHEET." in base
            drive.add(f"R{i:02d}", base.replace(".GSHEET.xlsx", "") if native else base, open(p, "rb").read(),
                      native=native, mtime=f"2026-09-01T00:00:{i:02d}.000Z")
        hm.DRIVE_FACTORY = lambda: drive
        calls = 0
        while True:
            got = hm.folder_read(R, actor=ADMIN_ACTOR)
            calls += 1
            if got.get("error") or got.get("remaining", 0) == 0 or calls > 20:
                break
        real["read_calls"] = calls
        real["read_error"] = got.get("error")
        real["downloads"] = dl(drive)
        real["max_per_file"] = max(drive.downloads.values()) if drive.downloads else 0
        res = commit_all(R)
        real["commit"] = res["counts"]
        real["lines"] = lines_in(R)
        real["rx_keys"], real["rx_roots"], real["patients"] = q(
            R, "SELECT count(DISTINCT rx_key), count(DISTINCT rx_root), count(DISTINCT patid) FROM hub_med_dispenses")[0]
        real["ledger"] = dict(q(R, "SELECT outcome, count(*) FROM hub_med_imports GROUP BY 1"))
        real["native_row"] = [list(r) for r in q(R, "SELECT outcome, layers FROM hub_med_imports WHERE native")]
        again = hm.folder_read(R, actor=ADMIN_ACTOR)
        real["second_read"] = {"known": again.get("known"), "downloads": dl(drive)}
        # EVERY FILE AGAIN, DROPPED: 0 new lines and 31 refusals
        before = lines_in(R)
        drops = [up(R, os.path.basename(p), open(p, "rb").read()) for p in paths]
        real["again"] = {"new_lines": lines_in(R) - before,
                         "verdicts": sorted({d["verdict"] for d in drops}),
                         "refused": sum(1 for d in drops if d["verdict"] == "duplicate"),
                         "with_content": sum(1 for d in drops if "content" in d["layers"]),
                         "sentences": sum(1 for d in drops if d["reason"].startswith(("Same report as", "Same content as"))),
                         "native": [d["layers"] for d, p in zip(drops, paths) if ".GSHEET." in p]}
        # A RENAMED COPY: caught by its content, not its name
        xl = [p for p in paths if ".GSHEET." not in p][6]
        renamed = up(R, "pharmacy export for the office.xlsx", open(xl, "rb").read())
        gsheet = next(p for p in paths if ".GSHEET." in p)
        renamed_native = up(R, "another name.xlsx", open(gsheet, "rb").read())
        real["renamed"] = [renamed["verdict"], renamed["layers"], renamed["reason"][:15]]
        real["renamed_native"] = [renamed_native["verdict"], renamed_native["layers"]]
        # THE SAME PERIOD WITH ONE ROW CHANGED: held and surfaced, never merged
        wb = openpyxl.load_workbook(xl)
        ws = wb["KDP"]
        col = [c.value for c in ws[1]].index("Quantity Remaining") + 1
        original = ws.cell(row=2, column=col).value
        ws.cell(row=2, column=col).value = f4(float(str(original)) + 1)
        bio = io.BytesIO()
        wb.save(bio)
        changed = bio.getvalue()
        before = lines_in(R)
        same_name = up(R, os.path.basename(xl), changed)
        no_pharmacy = up(R, "changed copy.xlsx", changed)
        real["changed"] = {"same_name": [same_name["verdict"], same_name["layers"]],
                           "raw_name": [no_pharmacy["verdict"], no_pharmacy["layers"], no_pharmacy["reason"]],
                           "new_lines": lines_in(R) - before}
        OUT["real"] = real

    # ── THE SYNTHETIC WORLD: every rule, no PHI ──────────────────────────
    PHASE[0] = "synthetic"
    S = schema("syn")
    hm.forget_schema()
    hm.CLIENTS_READER = lambda: ([dict(c) for c in CLIENTS], STAMP[0])
    hm.AUTO_FACILITIES = frozenset({"TSTFAC"})
    syn = {}
    drive = FakeDrive()
    hm.DRIVE_FACTORY = lambda: drive

    # P0: wide (26 columns), no dimension record, blank rows between lines
    p0 = book(period_rows(0), wide=True, no_dim=True, blanks=True)
    ro = openpyxl.load_workbook(io.BytesIO(p0), read_only=True)["KDP"]
    syn["p0_dims"] = [ro.max_row, ro.max_column]
    syn["p0_parse"] = [hm.parse(p0).get("ok"), hm.parse(p0).get("counts")]
    drive.add("fP0", kdp_name(0), p0)
    empty_sweep = hm.sweep(S)
    syn["empty_sweep"] = [empty_sweep["imported"], lines_in(S)]
    r0 = commit_all(S)
    syn["p0_commit"] = [r0["counts"], lines_in(S)]
    syn["p0_retry"] = hm.commit(S, [r0["results"][0]["stage_id"]], actor=ADMIN_ACTOR)["results"][0]
    again = hm.folder_read(S, actor=ADMIN_ACTOR)
    syn["p0_reread"] = [again["known"], drive.downloads.get("fP0")]
    dup = up(S, kdp_name(0), p0)
    syn["p0_dup"] = [dup["verdict"], dup["layers"], lines_in(S)]

    # P1: the relabel that the cumulative quantity proves, and a near miss
    p1 = book(period_rows(1, cy_total=999))
    one = up(S, kdp_name(1, " (1)"), p1)
    syn["p1_preview"] = [one["verdict"], one["lines"]]
    hm.commit(S, [one["stage_id"]], actor=ADMIN_ACTOR)
    fam = {r[0]: [r[1], r[2]] for r in q(
        S, "SELECT patid, count(DISTINCT rx_key), count(DISTINCT rx_root) FROM hub_med_dispenses "
           "WHERE patid IN ('T90001', 'T90003') GROUP BY 1")}
    maybe = q(S, "SELECT count(*) FROM hub_med_dispenses WHERE patid = 'T90003' AND maybe_same_as <> ''")[0][0]
    syn["relabel"] = {"ann": fam.get("T90001"), "cy": fam.get("T90003"), "cy_maybe": maybe}

    # SHAPES: each refusal named
    base_rows = period_rows(2)
    shapes = {
        "no_sheet": book(base_rows, sheet="Other"),
        "no_column": book([r[:11] + r[12:] for r in base_rows], header=HDR[:11] + HDR[12:]),
        "two_periods": book(base_rows[:2] + [row(3, CY, "X")]),
        "blank_last": book([r[:7] + [""] + r[8:] for r in base_rows]),
        "zero_a": book([]),
        "zero_b": book([], wide=True),
        "negative": book([r[:11] + [f4(-1)] + r[12:] for r in base_rows]),
        "garbage": b"PK\x03\x04 this is not a workbook",
    }
    syn["shapes"] = {k: [v["verdict"], v["reason"]] for k, v in
                     ((k, up(S, f"shape {k}.xlsx", b)) for k, b in shapes.items())}
    syn["not_xlsx_name"] = up(S, "notes.csv", b"a,b")["verdict"]
    syn["zero_rows"] = q(S, "SELECT count(*) FROM hub_med_imports WHERE file_name LIKE 'shape zero_%%' "
                            "AND outcome = 'invalid'")[0][0]

    # HELD, NEVER MERGED
    changed_p1 = book([r if i else r[:11] + [f4(123)] + r[12:] for i, r in enumerate(period_rows(1, cy_total=999))])
    before = lines_in(S)
    held_period = up(S, "changed copy.xlsx", changed_p1)
    held_name = up(S, kdp_name(1), changed_p1)
    remaining = q(S, "SELECT qty_remaining FROM hub_med_dispenses WHERE patid = 'T90001' AND report_start = %s",
                  (start_of(1),))[0][0]
    syn["held"] = {"period": [held_period["verdict"], held_period["layers"], held_period["reason"]],
                   "name": [held_name["verdict"], held_name["layers"]],
                   "new_lines": lines_in(S) - before, "kept_value": str(remaining)}
    p2 = book(period_rows(2))
    other = up(S, f"Key Data Points, Other Pharmacy, {(start_of(2) + timedelta(days=15)).isoformat()}_050000.xlsx", p2)
    wrong_date = up(S, f"Key Data Points, A Brighter Dawn, {(start_of(2) + timedelta(days=20)).isoformat()}.xlsx", p2)
    short = up(S, "short period.xlsx", book([row(2, ANN, "SHORT", end_days=13)]))
    syn["held_more"] = {"pharmacy": [other["verdict"], other["layers"]],
                        "name_date": [wrong_date["verdict"], wrong_date["layers"]],
                        "length": [short["verdict"], short["layers"]]}

    # THE DATABASE'S OWN WORD, with the code's checks switched off
    hm.CHECKS_OFF.update({"overlap", "period", "name", "lines", "shape-period"})
    widened = book([row(0, p["pat"], p["drug"], end_days=15) for p in (
        {"pat": ANN, "drug": "LISINOPRIL 10MG TAB"}, {"pat": BOB, "drug": "METFORMIN 500MG TAB"})])
    w = up(S, "widened by a day.xlsx", widened)
    before = lines_in(S)
    wc = hm.commit(S, [w["stage_id"]], actor=ADMIN_ACTOR)["results"][0] if w.get("stage_id") else w
    same_period = up(S, "same period other lines.xlsx", changed_p1)
    sp = hm.commit(S, [same_period["stage_id"]], actor=ADMIN_ACTOR)["results"][0] \
        if same_period.get("stage_id") else same_period
    hm.CHECKS_OFF.clear()
    syn["database"] = {"widened": [w["verdict"], wc.get("verdict"), wc.get("layers")],
                       "same_period": [same_period["verdict"], sp.get("verdict"), sp.get("layers")],
                       "new_lines": lines_in(S) - before}
    probes = {}
    for label, sql in (
            ("null_key", "INSERT INTO hub_med_dispenses (row_id, rx_key, rx_root, import_id, pharmacy, report_start, "
                         "report_end, patid, drug, drug_norm, date_written, last_dispense, dispensed_in_period) "
                         "SELECT 'MD-null', 'k', 'k', import_id, pharmacy, report_start, report_end, patid, drug, "
                         "drug_norm, date_written, NULL, 1 FROM hub_med_dispenses LIMIT 1"),
            ("dup_key", "INSERT INTO hub_med_dispenses (row_id, rx_key, rx_root, import_id, pharmacy, report_start, "
                        "report_end, patid, drug, drug_norm, date_written, last_dispense, dispensed_in_period) "
                        "SELECT 'MD-dup', rx_key, rx_root, import_id, pharmacy, report_start + 1, report_end, patid, "
                        "drug, drug_norm, date_written, last_dispense, 1 FROM hub_med_dispenses LIMIT 1"),
            # EACH INDEX ON ITS OWN: every other key of the row is new, so the
            # one refusal can only be the constraint named
            ("name_once", "INSERT INTO hub_med_imports (source, parser_version, outcome, name_key, content_fp, "
                          "pharmacy, report_start, report_end, period) SELECT 'upload', 1, 'imported', name_key, "
                          "'fp-probe-name', pharmacy, DATE '2090-01-01', DATE '2090-01-15', "
                          "daterange(DATE '2090-01-01', DATE '2090-01-15', '[]') FROM hub_med_imports "
                          "WHERE outcome = 'imported' ORDER BY import_id LIMIT 1"),
            ("content_once", "INSERT INTO hub_med_imports (source, parser_version, outcome, name_key, content_fp, "
                             "pharmacy, report_start, report_end, period) SELECT 'upload', 1, 'imported', "
                             "'kdp|probe|content', content_fp, pharmacy, DATE '2091-01-01', DATE '2091-01-15', "
                             "daterange(DATE '2091-01-01', DATE '2091-01-15', '[]') FROM hub_med_imports "
                             "WHERE outcome = 'imported' ORDER BY import_id LIMIT 1"),
            ("bytes_once", "INSERT INTO hub_med_imports (source, parser_version, outcome, name_key, content_fp, "
                           "bytes_sha256, pharmacy, report_start, report_end, period) SELECT 'upload', 1, "
                           "'imported', 'kdp|probe|bytes', 'fp-probe-bytes', bytes_sha256, pharmacy, "
                           "DATE '2092-01-01', DATE '2092-01-15', daterange(DATE '2092-01-01', DATE '2092-01-15', "
                           "'[]') FROM hub_med_imports WHERE outcome = 'imported' AND bytes_sha256 <> '' "
                           "ORDER BY import_id LIMIT 1"),
            ("revision_once", "INSERT INTO hub_med_imports (source, parser_version, outcome, drive_file_id, "
                              "drive_revision) SELECT 'folder', 1, 'duplicate', drive_file_id, drive_revision "
                              "FROM hub_med_imports WHERE drive_file_id <> '' AND outcome <> 'failed' "
                              "AND superseded_by = '' ORDER BY import_id LIMIT 1"),
            ("whole", "INSERT INTO hub_med_imports (source, parser_version, outcome, name_key, content_fp, pharmacy, "
                      "report_start, report_end, period) VALUES ('upload', 1, 'imported', '', 'fp-probe-whole', "
                      "'A Brighter Dawn', DATE '2093-01-01', DATE '2093-01-15', "
                      "daterange(DATE '2093-01-01', DATE '2093-01-15', '[]'))"),
            ("row_once", "INSERT INTO hub_med_dispenses (row_id, rx_key, rx_root, import_id, pharmacy, report_start, "
                         "report_end, patid, drug, drug_norm, date_written, last_dispense, dispensed_in_period) "
                         "SELECT 'MD-row', rx_key, rx_root, import_id, pharmacy, report_start, report_end, patid, "
                         "drug, drug_norm, date_written, last_dispense + 1, 1 FROM hub_med_dispenses "
                         "ORDER BY row_id LIMIT 1")):
        try:
            q(S, sql)
            probes[label] = "accepted"
        except psycopg2.Error as exc:
            probes[label] = [type(exc).__name__, getattr(exc.diag, "constraint_name", None)]
    syn["probes"] = probes
    # THE COMMIT ROAD WITH EVERY CODE CHECK OFF, content and bytes included:
    # an exact copy of an imported report reaches the database and is refused
    hm.CHECKS_OFF.update({"content", "bytes", "name", "period", "overlap", "lines", "shape-period", "staged"})
    exact = up(S, "exact copy.xlsx", p0)
    before = lines_in(S)
    ec = hm.commit(S, [exact["stage_id"]], actor=ADMIN_ACTOR)["results"][0] if exact.get("stage_id") else exact
    hm.CHECKS_OFF.clear()
    syn["exact_off"] = [exact["verdict"], ec.get("verdict"), ec.get("layers"), lines_in(S) - before]

    # TWO IMPORTS OF ONE FILE AT ONCE
    gate = threading.Barrier(2)
    answers = []

    def race():
        gate.wait()
        pv = up(S, kdp_name(2), p2)
        if pv.get("stage_id"):
            answers.append(hm.commit(S, [pv["stage_id"]], actor=ADMIN_ACTOR)["results"][0]["verdict"])
        else:
            answers.append(pv["verdict"])
    ts = [threading.Thread(target=race) for _ in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    fp2 = hm.parse(p2)["content_fp"]
    p3 = book(period_rows(3))
    s3 = up(S, kdp_name(3), p3)["stage_id"]
    gate2 = threading.Barrier(2)
    answers2 = []

    def race2():
        gate2.wait()
        answers2.append(hm.commit(S, [s3], actor=ADMIN_ACTOR)["results"][0])
    ts = [threading.Thread(target=race2) for _ in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    fp3 = hm.parse(p3)["content_fp"]
    syn["race"] = {"answers": sorted(answers),
                   "imported_p2": q(S, "SELECT count(*) FROM hub_med_imports WHERE outcome = 'imported' "
                                       "AND content_fp = %s", (fp2,))[0][0],
                   "same_stage": sorted([a.get("verdict") for a in answers2]),
                   "already": sum(1 for a in answers2 if a.get("already")),
                   "imported_p3": q(S, "SELECT count(*) FROM hub_med_imports WHERE outcome = 'imported' "
                                       "AND content_fp = %s", (fp3,))[0][0]}

    # THE FOLDER
    drive.add("fP2", kdp_name(2), p2)
    before = dl(drive)
    hm.folder_read(S, actor=ADMIN_ACTOR)
    md5_row = q(S, "SELECT outcome, layers FROM hub_med_imports WHERE drive_file_id = 'fP2'")
    syn["md5_after_upload"] = {"downloads": dl(drive) - before, "row": [list(r) for r in md5_row]}
    p4 = book(period_rows(4))
    staged4 = up(S, kdp_name(4), p4)
    drive.add("fP4", kdp_name(4), p4)
    before = dl(drive)
    hm.folder_read(S, actor=ADMIN_ACTOR)
    adopted = q(S, "SELECT drive_file_id FROM hub_med_staged WHERE stage_id = %s", (staged4["stage_id"],))
    syn["adopted"] = {"downloads": dl(drive) - before, "drive_file_id": adopted[0][0] if adopted else ""}
    p5 = book(period_rows(5))
    p5_native = book(period_rows(5), wide=True)
    drive.add("fP5", kdp_name(5), p5)
    drive.add("fP5n", kdp_name(5)[:-5], p5_native, native=True)
    hm.folder_read(S, actor=ADMIN_ACTOR)
    committed = commit_all(S)
    twins = [list(r) for r in q(S, "SELECT drive_file_id, outcome, layers FROM hub_med_imports "
                                   "WHERE drive_file_id IN ('fP5', 'fP5n') ORDER BY drive_file_id")]
    before = dl(drive)
    hm.folder_read(S, actor=ADMIN_ACTOR)
    syn["twins"] = {"rows": twins, "second_read_downloads": dl(drive) - before, "commit": committed["counts"]}
    drive.add("fCopy", "some export.xlsx", resave(p1))
    hm.folder_read(S, actor=ADMIN_ACTOR)
    first = drive.downloads.get("fCopy")
    hm.folder_read(S, actor=ADMIN_ACTOR)
    copy_row = q(S, "SELECT outcome, layers FROM hub_med_imports WHERE drive_file_id = 'fCopy'")
    syn["nothing_new"] = {"downloads": [first, drive.downloads.get("fCopy")], "row": [list(r) for r in copy_row]}
    p6 = book(period_rows(6, extra=[row(6, ANN2, "SERTRALINE 50MG TAB"),
                                    row(6, FAY, "FOLIC ACID 1MG TAB", facility="ELSEFAC")]))
    drive.add("fP6", kdp_name(6), p6)
    drive.truncate_once.add("fP6")
    t1 = hm.folder_read(S, actor=ADMIN_ACTOR)
    failed_rows = [list(r) for r in q(S, "SELECT outcome, reason FROM hub_med_imports WHERE drive_file_id = 'fP6'")]
    t2 = hm.folder_read(S, actor=ADMIN_ACTOR)
    staged6 = q(S, "SELECT count(*) FROM hub_med_staged WHERE drive_file_id = 'fP6'")[0][0]
    commit_all(S)
    syn["truncated"] = {"first": [t1["failed"], failed_rows], "downloads": drive.downloads.get("fP6"),
                        "staged_after_retry": staged6,
                        "imported": q(S, "SELECT count(*) FROM hub_med_imports WHERE drive_file_id = 'fP6' "
                                         "AND outcome = 'imported'")[0][0]}
    bad = book([r[:11] + r[12:] for r in period_rows(20)], header=HDR[:11] + HDR[12:])
    drive.add("fBad", kdp_name(20), bad)
    hm.folder_read(S, actor=ADMIN_ACTOR)
    hm.folder_read(S, actor=ADMIN_ACTOR)
    d1 = drive.downloads.get("fBad")
    q(S, "UPDATE hub_med_imports SET parser_version = 0 WHERE drive_file_id = 'fBad'")
    hm.folder_read(S, actor=ADMIN_ACTOR)
    d2 = drive.downloads.get("fBad")
    hm.folder_read(S, actor=ADMIN_ACTOR)
    d3 = drive.downloads.get("fBad")
    syn["reread"] = {"downloads": [d1, d2, d3],
                     "rows": [list(r) for r in q(S, "SELECT outcome, parser_version, superseded_by <> '' FROM "
                                                    "hub_med_imports WHERE drive_file_id = 'fBad' ORDER BY import_id")]}
    p7 = book(period_rows(7, bob={"id": "T90002", "first": "Robert", "last": "Test"}))
    drive.add("fP7", kdp_name(7), p7)
    drive.list_delay = 1.0
    busy = []
    gate3 = threading.Barrier(2)

    def reader(label):
        gate3.wait()
        busy.append(hm.folder_read(S, actor={"uid": label, "label": label}).get("busy"))
    ts = [threading.Thread(target=reader, args=(n,)) for n in ("Reader One", "Reader Two")]
    [t.start() for t in ts]
    [t.join() for t in ts]
    drive.list_delay = 0.0
    syn["two_readers"] = {"busy": sorted(bool(b) for b in busy), "downloads_p7": drive.downloads.get("fP7")}
    commit_all(S)
    empty = FakeDrive()
    hm.DRIVE_FACTORY = lambda: empty
    e = hm.folder_read(S, actor=ADMIN_ACTOR)
    empty.fail_list = True
    f = hm.folder_read(S, actor=ADMIN_ACTOR)
    hm.DRIVE_FACTORY = lambda: drive
    syn["empty"] = {"warning": e["empty_warning"], "error": e["error"], "fail_error": bool(f["error"]),
                    "fail_known": f["known"]}

    # THE SWEEP: the next period after the latest, across a gap too, only a trusted binary
    drive.add("fP9", kdp_name(9), book(period_rows(9)))
    s1 = hm.sweep(S)
    drive.add("fP8n", kdp_name(8)[:-5], book(period_rows(8)), native=True)
    s2 = hm.sweep(S)
    p8_stage = q(S, "SELECT stage_id FROM hub_med_staged WHERE drive_file_id = 'fP8n'")
    if p8_stage:
        hm.commit(S, [p8_stage[0][0]], actor=ADMIN_ACTOR)
    s3_ = hm.sweep(S)
    drive.add("fP10", kdp_name(10), book(period_rows(10)), who="stranger@example.test")
    s4 = hm.sweep(S)
    syn["sweep"] = {"gap": s1["imported"], "native": s2["imported"], "after_person": len(s3_["imported"]),
                    "stranger": s4["imported"],
                    "p9_imported": q(S, "SELECT count(*) FROM hub_med_imports WHERE drive_file_id = 'fP9' "
                                        "AND outcome = 'imported' AND source = 'sweep'")[0][0]}

    # PATIENTS AND WHO SEES THEM
    hm.auto_match(S)
    syn["matches"] = {r[0]: [r[1], r[2]] for r in q(S, "SELECT patid, match, client_key FROM hub_med_patients")}
    admin = hm.scope_of(viewer("Ada Admin", "admin", "ADMINISTRATOR"))
    hal = hm.scope_of(viewer("Hal Manager", "staff", "HM"))
    hana = hm.scope_of(viewer("Hana Badge", "staff", "HM"))
    va = hm.view_for(S, admin)
    vh = hm.view_for(S, hal)
    syn["admin_view"] = {"patients": sorted(p["patid"] for p in va["patients"]),
                         "groups": sorted({p["group"] for p in va["patients"]}),
                         "ledger": len(va.get("ledger") or []), "gaps": va["gaps"][:2]}
    syn["hal_view"] = {"patients": sorted(p["patid"] for p in vh["patients"]), "ledger": "ledger" in vh,
                       "houses": sorted({p["house"] for p in vh["patients"]})}
    syn["hana_view"] = [len(hm.view_for(S, hana)["patients"]), hana["why"]]
    vc = hm.view_for(S, admin, client="c_ann")
    syn["client_view"] = {"patients": sorted(p["patid"] for p in vc["patients"]),
                          "rx": sorted({r["patid"] for r in vc["rx"]}), "rx_count": len(vc["rx"]),
                          "desk": [k for k in ("ledger", "clients", "staged") if k in vc],
                          "version": vc["version"] != va["version"],
                          "since": hm.view_for(S, admin, since=vc["version"]).get("unchanged") is not True,
                          "other_house": len(hm.view_for(S, hal, client="c_bob")["patients"]),
                          "unknown": [len(hm.view_for(S, admin, client="c_nobody")[k]) for k in ("patients", "rx")]}
    lis = [r for r in va["rx"] if r["patient"] == "T90001" and "LISINOPRIL" in r["drug"] and r["current"]]
    syn["current_once"] = len(lis)
    bob_key = next(r["rx_root"] for r in va["rx"] if r["patid"] == "T90002")
    ann_key = next(r["rx_root"] for r in va["rx"] if r["patid"] == "T90001")
    syn["rx_404"] = {"other_house": hm.rx_history(S, hal, bob_key) is None,
                     "unknown": hm.rx_history(S, hal, "not-a-key") is None,
                     "own": hm.rx_history(S, hal, ann_key) is not None,
                     "admin": hm.rx_history(S, admin, bob_key) is not None}
    v1 = vh["version"]
    syn["since_same"] = hm.view_for(S, hal, since=v1).get("unchanged") is True
    MANAGERS["ABD2704"] = {"name": "Hal Manager", "phone": "", "house": "CAN - JH - ABD2704"}
    hal_wide = hm.scope_of(viewer("Hal Manager", "staff", "HM"))
    syn["since_scope"] = hm.view_for(S, hal_wide, since=v1).get("unchanged") is not True
    del MANAGERS["ABD2704"]
    CLIENTS[2]["house"] = "ABD2704"
    STAMP[0] = "s2"
    moved = hm.view_for(S, hal)
    syn["moved"] = {"patients": sorted(p["patid"] for p in moved["patients"]),
                    "since": hm.view_for(S, hal, since=v1).get("unchanged") is not True}
    CLIENTS[2]["house"] = "ABD1711"
    STAMP[0] = "s3"
    hm.match(S, patid="T90006", client_key="c_ann", same_as="T90001", by="Ada Admin")
    folded = hm.view_for(S, hal)
    syn["same_as"] = sorted({(p["patid"], p["key"]) for p in folded["patients"]})
    # the fold's own name falls to review, as a later report that renames it writes: House Supplies lists it
    # unmatched while it keeps its head's client, and ?client= leaves it out until a person confirms it
    was6 = q(S, "SELECT match, match_note FROM hub_med_patients WHERE patid = 'T90006'")[0]
    q(S, "UPDATE hub_med_patients SET match = 'review', match_note = 'this PatID now reports a different name', "
         "updated_at = now() WHERE patid = 'T90006'")
    hm.rebuild(S)
    t6 = next((p for p in hm.view_for(S, admin)["patients"] if p["patid"] == "T90006"), {})
    in_review = hm.view_for(S, admin, client="c_ann")
    syn["review_fold"] = {"wide": [t6.get("group"), t6.get("client_key")],
                          "patients": sorted(p["patid"] for p in in_review["patients"]),
                          "rx": sorted({r["patid"] for r in in_review["rx"]}),
                          "fold_rx": sum(1 for r in hm.model(S)["rx"] if r["patid"] == "T90006")}
    q(S, "UPDATE hub_med_patients SET match = %s, match_note = %s, updated_at = now() WHERE patid = 'T90006'",
      tuple(was6))
    hm.rebuild(S)
    syn["review_fold"]["confirmed"] = sorted(p["patid"] for p in hm.view_for(S, admin, client="c_ann")["patients"])

    # THE HOUSE COPY
    offers = hm.house_offer(S)
    imports_rows = [r for o in offers if "med_imports" in o["tabs"] for r in o["tabs"]["med_imports"]["rows"]]
    names = {r[4] for r in imports_rows}
    one_import = next(o for o in offers if "med_dispenses" in o["tabs"])
    iid = one_import["import_ids"][0]
    expect = q(S, "SELECT count(*) FROM hub_med_dispenses WHERE import_id = %s", (iid,))[0][0]
    sent = {t: len(p["rows"]) for t, p in one_import["tabs"].items()}
    good = hm.house_mark(S, one_import, {"present": dict(sent), "conflicts": {}})
    refusals_only = [o for o in offers if "med_imports" in o["tabs"] and "med_dispenses" not in o["tabs"]]
    refusal_offer = refusals_only[0]
    short_ = hm.house_mark(S, refusal_offer, {"present": {"med_imports": 0}})
    states = dict(q(S, "SELECT house_state, count(*) FROM hub_med_imports GROUP BY 1"))
    other_refusals = refusals_only[1:]
    unreachable = hm.house_mark(S, other_refusals[0] if other_refusals else one_import, None,
                                "the door could not be reached (ConnectError)")
    # THE PATIENT ROWS: owed by version, whatever changed them, and re-owed
    # by a person's match after the copy had them
    pat_offers = [o for o in offers if "med_patients" in o["tabs"]]
    pat_sent = sorted(p for o in pat_offers for p, _v in o["patients"])
    for o in pat_offers:
        hm.house_mark(S, o, {"present": {"med_patients": len(o["tabs"]["med_patients"]["rows"])}, "conflicts": {}})
    owed_after = [p for o in hm.house_offer(S) for p, _v in o.get("patients") or []]
    hm.match(S, patid="T90007", client_key="c_fay", by="Ada Admin")
    requeued = [o for o in hm.house_offer(S) if "med_patients" in o["tabs"]]
    fay_row = next((r for o in requeued for r in o["tabs"]["med_patients"]["rows"] if r[2] == "T90007"), None)
    # a change while the door wrote: the version sent is marked, the newer one stays owed
    hm.match(S, patid="T90007", client_key="", by="Ada Admin")
    for o in requeued:
        hm.house_mark(S, o, {"present": {"med_patients": len(o["tabs"]["med_patients"]["rows"])}, "conflicts": {}})
    still = [p for o in hm.house_offer(S) for p, _v in o.get("patients") or []]
    syn["house_patients"] = {"sent": pat_sent, "owed_after": owed_after,
                             "requeued": [fay_row[8], fay_row[9]] if fay_row else None, "still": still,
                             "in_import_offers": any("med_patients" in o["tabs"] for o in offers
                                                     if "med_dispenses" in o["tabs"])}
    syn["house"] = {"offers": len(offers), "raw_named": hm.UNRECOGNISED in names,
                    "raw_leak": any(n in names for n in ("changed copy.xlsx", "some export.xlsx")),
                    "lines_sent": [sent.get("med_dispenses"), expect], "good": good, "short": short_,
                    "states": states, "unreachable": unreachable,
                    "next_set": q(S, "SELECT count(*) FROM hub_med_imports WHERE house_state = 'failed' "
                                     "AND house_next > now()")[0][0]}
    OUT["syn"] = syn

    # ── THE GAPS: each defect the review named, in a schema of its own ───
    G = schema("gaps")
    hm.forget_schema()
    gaps = {}
    gd = FakeDrive()
    hm.DRIVE_FACTORY = lambda: gd

    # A: the same file dropped twice (the second a batch duplicate), then met
    # in the folder — the refusal says nothing about the folder file's bytes
    ga = book(period_rows(0))
    u1 = up(G, kdp_name(0), ga)
    u2 = up(G, kdp_name(0), ga)
    gd.add("gA", kdp_name(0), ga)
    before = dl(gd)
    hm.folder_read(G, actor=ADMIN_ACTOR)
    gaps["a_batch"] = {"drops": [u1["verdict"], u2["verdict"], u2["layers"]], "downloads": dl(gd) - before,
                       "ledger_gA": [list(r) for r in q(G, "SELECT outcome FROM hub_med_imports WHERE drive_file_id = 'gA'")],
                       "adopted": q(G, "SELECT count(*) FROM hub_med_staged WHERE stage_id = %s AND drive_file_id = 'gA'",
                                    (u1["stage_id"],))[0][0]}
    commit_all(G)
    # A': the first drop EXPIRED before the folder was read
    gb = book(period_rows(1))
    v1 = up(G, kdp_name(1), gb)
    up(G, kdp_name(1), gb)
    q(G, "UPDATE hub_med_staged SET created_at = now() - interval '2 days' WHERE stage_id = %s", (v1["stage_id"],))
    expired = hm.expire_uploads(G)
    gd.add("gB", kdp_name(1), gb)
    before = dl(gd)
    hm.folder_read(G, actor=ADMIN_ACTOR)
    gaps["a_expired"] = {"expired": expired, "downloads": dl(gd) - before,
                         "staged_gB": q(G, "SELECT count(*) FROM hub_med_staged WHERE drive_file_id = 'gB'")[0][0],
                         "ledger_gB": q(G, "SELECT count(*) FROM hub_med_imports WHERE drive_file_id = 'gB'")[0][0]}
    commit_all(G)
    # B: a drop HELD for its name; the correctly named folder copy is read
    gc = book(period_rows(2))
    wrong = up(G, f"Key Data Points, A Brighter Dawn, {(start_of(2) + timedelta(days=20)).isoformat()}.xlsx", gc)
    gd.add("gC", kdp_name(2), gc)
    before = dl(gd)
    hm.folder_read(G, actor=ADMIN_ACTOR)
    gaps["b_name"] = {"drop": [wrong["verdict"], wrong["layers"]], "downloads": dl(gd) - before,
                      "staged_gC": q(G, "SELECT count(*) FROM hub_med_staged WHERE drive_file_id = 'gC'")[0][0]}
    gaps["b_commit"] = commit_all(G)["counts"]
    # THE GATE: a session lock on an idle autocommit connection (no idle-in-
    # transaction timeout can drop it), and a gate that died stops the reads
    gd.add("gE", kdp_name(5), book(period_rows(5)))
    gd.add("gF", kdp_name(6), book(period_rows(6)))
    gd.list_delay = 1.5
    seen = []

    def slow_reader():
        seen.append(hm.folder_read(G, actor={"uid": "slow", "label": "Slow Reader"}, limit=0))

    t = threading.Thread(target=slow_reader)
    t.start()
    time.sleep(0.7)
    gate_state = q(G, "SELECT a.state FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid "
                      "WHERE l.locktype = 'advisory' AND l.classid = %s AND l.objsubid = 2 AND "
                      "l.objid::bigint = (hashtext('house_meds|folder|' || current_schema())::bigint & 4294967295)",
                   (hm.LOCK_NS,))
    t.join()
    gd.list_delay = 0.0
    dead = hm._FolderGate.alive
    hm._FolderGate.alive = lambda self: False
    before = dl(gd)
    lost = hm.folder_read(G, actor=ADMIN_ACTOR)
    hm._FolderGate.alive = dead
    gaps["gate"] = {"state": [r[0] for r in gate_state], "lost": [bool(lost.get("gate_lost")), lost.get("remaining"),
                                                                  dl(gd) - before]}
    # a reader that lost the gate decides a revision another reader staged:
    # it finds the staging, never a twin of itself
    hm.folder_read(G, actor=ADMIN_ACTOR)
    fe = {k: v for k, v in gd.items["gE"].items() if k != "_b"}
    src_e = hm._folder_src(fe, "folder", ADMIN_ACTOR)
    src_e["bytes_sha256"] = hashlib.sha256(gd.items["gE"]["_b"]).hexdigest()
    conn, cur = hm._lane_tx(G)
    try:
        late = hm.decide(cur, src_e, hm.parse(gd.items["gE"]["_b"]))
        conn.commit()
    finally:
        conn.close()
    staged_e = q(G, "SELECT stage_id FROM hub_med_staged WHERE drive_file_id = 'gE'")
    gaps["late"] = {"verdict": late.get("verdict"), "same_stage": bool(staged_e) and late.get("stage_id") == staged_e[0][0],
                    "ledger_gE": q(G, "SELECT count(*) FROM hub_med_imports WHERE drive_file_id = 'gE'")[0][0]}
    gaps["late_commit"] = commit_all(G)["counts"]
    # TWO REVISIONS OF ONE DRIVE FILE: the corrected one is imported
    r1 = book(period_rows(3))
    r2 = book([r if i else r[:11] + [f4(77)] + r[12:] for i, r in enumerate(period_rows(3))])
    gd.add("gD", kdp_name(3), r1, mtime="2030-02-01T05:00:00.000Z")
    hm.folder_read(G, actor=ADMIN_ACTOR)
    gd.add("gD", kdp_name(3), r2, mtime="2030-02-02T05:00:00.000Z")
    hm.folder_read(G, actor=ADMIN_ACTOR)
    staged_d = [list(r) for r in q(G, "SELECT drive_revision FROM hub_med_staged WHERE drive_file_id = 'gD'")]
    old_row = [list(r) for r in q(G, "SELECT outcome, layers FROM hub_med_imports WHERE drive_file_id = 'gD'")]
    before = dl(gd)
    gd.add("gD", "Copy of " + kdp_name(3), r2, mtime="2030-02-03T05:00:00.000Z")
    hm.folder_read(G, actor=ADMIN_ACTOR)
    renamed_d = [list(r) for r in q(G, "SELECT drive_revision, file_name LIKE 'Copy of %%' FROM hub_med_staged "
                                       "WHERE drive_file_id = 'gD'")]
    rename_downloads = dl(gd) - before
    commit_all(G)
    gaps["revisions"] = {"staged": staged_d, "old": old_row, "renamed": renamed_d, "rename_downloads": rename_downloads,
                         "imported_fp_is_r2": q(G, "SELECT count(*) FROM hub_med_imports WHERE outcome = 'imported' "
                                                   "AND content_fp = %s", (hm.parse(r2)["content_fp"],))[0][0]}
    # TWO DIFFERENT REPORTS WAITING FOR ONE PERIOD: both held, neither chosen
    w1 = up(G, kdp_name(4), book(period_rows(4)))
    w2 = up(G, "rerun of the same fortnight.xlsx",
            book([r if i else r[:11] + [f4(55)] + r[12:] for i, r in enumerate(period_rows(4))]))
    gaps["staged_conflict"] = {"first_preview": w1["verdict"], "second": [w2["verdict"], w2["layers"]],
                               "first_now": [list(r) for r in q(G, "SELECT outcome, layers FROM hub_med_imports "
                                                                   "WHERE stage_id = %s", (w1["stage_id"],))],
                               "staged_left": q(G, "SELECT count(*) FROM hub_med_staged WHERE report_start = %s",
                                                (start_of(4),))[0][0]}
    OUT["gaps"] = gaps
except Exception:
    import traceback
    if PHASE[0] == "real":
        # a failure on the real reports prints no value of them: exception
        # types and code lines only (a DETAIL line would carry a PatID)
        et, _ev, tb = sys.exc_info()
        frames = [f"{os.path.basename(f.filename)}:{f.lineno} {f.name}" for f in traceback.extract_tb(tb)][-12:]
        OUT["crash"] = f"{et.__name__} (message withheld: real reports) at " + " <- ".join(reversed(frames))
    else:
        OUT["crash"] = traceback.format_exc()[-3000:]
    OUT["partial"] = {k: v for k, v in locals().get("syn", {}).items()}
finally:
    OUT["rooms"] = ROOMS.close()
    OUT["schemas_left"] = len(OUT["rooms"]["left"])
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''


def _lane_in_container() -> tuple[str, dict | str]:
    """('ran', result) · ('skipped', why) · ('failed', what it said)."""
    names = ("house_meds", "shift_requests", "shift_handoff", "house_cal_live", "shift_slices",
             "calendar_builder_slices", "house_directory", "psi_reminders", "badge_follows",
             "effective_roster", "calendar_builder_houses", "calendar_builder_write", "ist_config",
             "time_off", "redaction")
    # A FOLDER OF ITS OWN PER RUN, removed when the lane exits: two checkouts testing at once
    # must not import each other's modules, and a module not shipped must not load from live.
    sources = lane_schema.with_imports(SERVER, names)
    script = lane_schema.script(sources, "HERE_DIR = LANE_DIR\n" + LANE, "house-meds")
    try:
        proc = subprocess.run(["docker", "exec", "-i", CONTAINER, "python3", "-"],
                              input=script, capture_output=True, text=True, timeout=900)
    except FileNotFoundError:
        return "skipped", "no docker on this host"
    except subprocess.TimeoutExpired:
        return "failed", "the lane ran past 900 s"
    err = (proc.stderr or "")
    if proc.returncode != 0 and ("No such container" in err or "is not running" in err):
        return "skipped", f"the relay container {CONTAINER} is not running"
    for line in (proc.stdout or "").splitlines():
        if line.startswith("LANE_RESULT "):
            return "ran", json.loads(line[len("LANE_RESULT "):])
    return "failed", _scrub((proc.stdout or "") + "\n" + err)


def _scrub(text: str) -> str:
    """What a lane that died said, WITHOUT its messages: code lines and
    exception types only — a psycopg2 DETAIL line carries a real report's
    PatID or drug."""
    keep = []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith('File "'):
            keep.append(s)
        elif re.match(r"^[A-Za-z_][\w.]*(Error|Exception|Violation|Exit|Interrupt)\b", s):
            keep.append(s.split(":", 1)[0] + ": (message withheld)")
    return "\n".join(keep[-24:]) or "(the lane printed no traceback; its output is withheld)"


print("\nH5 — the whole lane, against a real database")
state, lane = _lane_in_container()
if state == "skipped":
    results["skipped"].append(str(lane))
    print(f"  (skipped — {lane})")
    print("  NOTE: the pure half above still ran; the database half did not.")
elif state == "failed" or lane.get("crash"):
    check("the lane ran to its end inside the relay's container (a crash is a failure, never a skip)", False,
          lane if state == "failed" else f"{lane['crash']}\n    so far: " + json.dumps(
              {k: v for k, v in (lane.get("partial") or {}).items() if k != "p0_retry"})[-2500:])
else:
    owned = lane.get("owned") or {}
    check("every schema the run made owns every table the code reads before its first read, never public's",
          {"syn", "gaps"} <= set(owned) and all(
              v and all(str(s).startswith("hub_test_house_meds_") and str(s).endswith(f"_{tag}")
                        for s in v.values())
              for tag, v in owned.items()), {t: sorted(set(v.values())) for t, v in owned.items()})
    check("every schema the run created was dropped", lane.get("schemas_left") == 0, lane.get("schemas_left"))
    real = lane.get("real")
    if real is None:
        results["skipped"].append("the real reports are not in the container (/tmp/meds_inspect)")
        print("  (the real reports are not in the container — the synthetic half proves the rules)")
    else:
        n = real["n_independent"]
        print(f"  … the real folder: {real['files']} files, N = {n} lines counted independently, "
              f"{real['rx_independent']} prescriptions")
        check(f"the {real['files']} files read in {real['read_calls']} batched calls, each file downloaded ONCE",
              real["read_error"] in (None, "") and real["downloads"] == real["files"] and real["max_per_file"] == 1,
              real)
        check(f"importing them all yields N = {n} lines: {real['files'] - 1} reports imported, the native copy refused",
              real["lines"] == n and real["commit"] == {"imported": real["files"] - 1}
              and real["ledger"] == {"imported": real["files"] - 1, "duplicate": 1}, real)
        check("the native copy is refused as the same report: same name, same content, same period",
              len(real["native_row"]) == 1 and real["native_row"][0][0] == "duplicate"
              and {"name", "content", "period"} <= set(real["native_row"][0][1]), real["native_row"])
        check(f"{real['rx_independent']} prescriptions stored; the relabels the cumulative quantity proves fold "
              f"into {real['rx_roots']} families; {real['patients']} patients",
              real["rx_keys"] == real["rx_independent"] and real["rx_roots"] < real["rx_keys"], real)
        check("a second folder read downloads nothing — every file is on file",
              real["second_read"]["known"] == real["files"] and real["second_read"]["downloads"] == real["files"],
              real["second_read"])
        a = real["again"]
        check(f"importing all {real['files']} AGAIN adds 0 lines and records {real['files']} refusals, each by content",
              a["new_lines"] == 0 and a["verdicts"] == ["duplicate"] and a["refused"] == real["files"]
              and a["with_content"] == real["files"] and a["sentences"] == real["files"], a)
        check("the dropped native copy is refused by name, content and period (its bytes differ)",
              a["native"] and {"name", "content", "period"} <= set(a["native"][0]) and "bytes" not in a["native"][0],
              a["native"])
        check("a renamed copy is refused by its fingerprint, not its name",
              real["renamed"][0] == "duplicate" and "content" in real["renamed"][1] and "name" not in real["renamed"][1]
              and real["renamed"][2].startswith("Same content"), real["renamed"])
        check("the native copy under another name is refused by content alone (no md5, other bytes)",
              real["renamed_native"][0] == "duplicate" and "content" in real["renamed_native"][1]
              and "bytes" not in real["renamed_native"][1], real["renamed_native"])
        ch = real["changed"]
        check("a same-period file with one row changed is HELD and surfaced, never merged: by name, and by period "
              "with the one differing line counted",
              ch["same_name"][0] == "held" and ch["same_name"][1] == ["name"]
              and ch["raw_name"][0] == "held" and ch["raw_name"][1] == ["period"]
              and "1 of them different" in ch["raw_name"][2] and ch["new_lines"] == 0, ch)

    s = lane["syn"]
    check("a 26-column file with blank rows and no dimension record parses, rows iterated",
          s["p0_parse"][0] is True and s["p0_parse"][1]["lines"] == 5, s["p0_parse"])
    print(f"  … its dimensions as openpyxl reads them: {s['p0_dims']}")
    check("with an empty ledger the sweep imports nothing — the backfill is a person's",
          s["empty_sweep"] == [[], 0], s["empty_sweep"])
    check("the first report lands whole", s["p0_commit"][0] == {"imported": 1} and s["p0_commit"][1] == 5, s["p0_commit"])
    check("a commit re-sent after a lost answer is answered from the ledger, not an error",
          s["p0_retry"].get("verdict") == "imported" and s["p0_retry"].get("already") is True, s["p0_retry"])
    check("an immediate re-read is a no-op: known, not downloaded again", s["p0_reread"] == [1, 1], s["p0_reread"])
    check("the same file dropped again is a duplicate by name, content, period and bytes; 0 lines",
          s["p0_dup"][0] == "duplicate" and {"name", "content", "period", "bytes"} <= set(s["p0_dup"][1])
          and s["p0_dup"][2] == 5, s["p0_dup"])
    check("a ` (1)` file imports", s["p1_preview"] == ["new", 5], s["p1_preview"])
    check("a relabel proved by the cumulative quantity shares one family; a near miss stays two, marked",
          s["relabel"]["ann"] == [2, 1] and s["relabel"]["cy"] == [2, 2] and s["relabel"]["cy_maybe"] >= 1, s["relabel"])
    sh = s["shapes"]
    words = {"no_sheet": "KDP", "no_column": "Quantity Remaining", "two_periods": "two report periods",
             "blank_last": "Last Dispense Dt", "zero_a": "no lines", "zero_b": "no lines", "negative": "negative",
             "garbage": "not an .xlsx"}
    check("every shape refusal is named, never a guess",
          all(sh[k][0] == "invalid" and w in sh[k][1] for k, w in words.items()), sh)
    check("two zero-line files are two invalid files, never duplicates of each other",
          s["zero_rows"] == 2, s["zero_rows"])
    check("a file that is not .xlsx is refused by name", s["not_xlsx_name"] == "invalid")
    hd = s["held"]
    check("a changed row for a period on file is held by period, the difference counted; the stored value kept",
          hd["period"][0] == "held" and hd["period"][1] == ["period"] and "1 of them different" in hd["period"][2]
          and hd["name"] == ["held", ["name"]] and hd["new_lines"] == 0 and hd["kept_value"] != "123", hd)
    hm_ = s["held_more"]
    check("a name naming another pharmacy, a name date that is not the day after the end, and a period that is "
          "not 15 days are each held",
          hm_["pharmacy"] == ["held", ["pharmacy"]] and hm_["name_date"] == ["held", ["name-date"]]
          and hm_["length"] == ["held", ["length"]], hm_)
    db = s["database"]
    check("a period widened by one day is refused by the exclusion constraint with the code's checks off",
          db["widened"][0] == "new" and db["widened"][1] == "held" and "overlap" in db["widened"][2]
          and "database" in db["widened"][2], db)
    check("a same-period report is refused by the database's own index with the code's checks off",
          db["same_period"][1] == "held" and "database" in (db["same_period"][2] or []) and db["new_lines"] == 0, db)
    check("a NULL key is refused by the table itself", s["probes"]["null_key"][0] == "NotNullViolation", s["probes"])
    check("a dispense reported twice is refused by the table itself",
          s["probes"]["dup_key"] == ["UniqueViolation", "hub_med_dispense_once"], s["probes"])
    pr = s["probes"]
    check("each unique index refuses on its own: the name, the content, the bytes, the Drive revision, the "
          "report's line",
          pr["name_once"] == ["UniqueViolation", "hub_med_imports_name_once"]
          and pr["content_once"] == ["UniqueViolation", "hub_med_imports_content_once"]
          and pr["bytes_once"] == ["UniqueViolation", "hub_med_imports_bytes_once"]
          and pr["revision_once"] == ["UniqueViolation", "hub_med_imports_revision_once"]
          and pr["row_once"] == ["UniqueViolation", "hub_med_row_once"], pr)
    check("an import with no name key is refused by the table's CHECK",
          pr["whole"] == ["CheckViolation", "hub_med_imports_whole"], pr)
    ex = s["exact_off"]
    check("with EVERY code check off (content and bytes included) an exact copy is refused by the database, "
          "0 lines",
          ex[0] == "new" and ex[1] in ("duplicate", "held") and "database" in (ex[2] or []) and ex[3] == 0, ex)
    rc = s["race"]
    check("two imports of one file at once make ONE import",
          rc["imported_p2"] == 1 and rc["answers"].count("imported") == 1, rc)
    check("two commits of one staged file at once make ONE import, the other answered from the ledger",
          rc["imported_p3"] == 1 and rc["already"] == 1, rc)
    check("a folder file whose bytes were already imported by hand is NOT downloaded: layer md5",
          s["md5_after_upload"]["downloads"] == 0 and s["md5_after_upload"]["row"] == [["duplicate", ["md5"]]],
          s["md5_after_upload"])
    check("a folder file whose bytes wait as a dropped file is not downloaded; the staging becomes the folder's",
          s["adopted"] == {"downloads": 0, "drive_file_id": "fP4"}, s["adopted"])
    tw = s["twins"]
    check("the .xlsx and its native twin leave TWO ledger rows — one imported, one duplicate — and a second read "
          "downloads nothing",
          tw["rows"][0][:2] == ["fP5", "imported"] and tw["rows"][1][:2] == ["fP5n", "duplicate"]
          and {"batch", "name", "content", "period"} <= set(tw["rows"][1][2]) and tw["second_read_downloads"] == 0, tw)
    check("a batch with nothing new records its duplicate, and the next read downloads 0",
          s["nothing_new"]["downloads"] == [1, 1] and s["nothing_new"]["row"][0][0] == "duplicate", s["nothing_new"])
    tr = s["truncated"]
    check("a truncated download is FAILED (never invalid), said so, and retried into an import",
          tr["first"][0] == 1 and tr["first"][1][0][0] == "failed" and "tried again" in tr["first"][1][0][1]
          and tr["downloads"] == 2 and tr["imported"] == 1, tr)
    rr = s["reread"]
    check("an `invalid` under an older parser is read ONCE more, and the older verdict gives way",
          rr["downloads"] == [1, 2, 2] and len(rr["rows"]) == 2 and rr["rows"][0][2] is True
          and rr["rows"][1][:2] == ["invalid", 1], rr)
    check("two folder reads at once: the second is told who reads, each file downloaded once",
          s["two_readers"]["busy"] == [False, True] and s["two_readers"]["downloads_p7"] == 1, s["two_readers"])
    check("an empty listing over a ledger that holds folder files is a warning, and a Drive failure an error — "
          "never \"nothing new\"",
          s["empty"]["warning"] is True and s["empty"]["fail_error"] is True and s["empty"]["fail_known"] == 0, s["empty"])
    sw = s["sweep"]
    check("the sweep imports the next period even across a gap (the gap stays said as missing), and refuses a native "
          "sheet and a stranger's file; a person's import of the missing period leaves nothing newer to sweep",
          len(sw["gap"]) == 1 and sw["native"] == [] and sw["after_person"] == 0 and sw["stranger"] == []
          and sw["p9_imported"] == 1, sw)
    mt = s["matches"]
    check("PatIDs match clients on the exact name: auto, none, and a second PatID for a matched client ambiguous",
          mt.get("T90001", [None])[0] == "auto" and mt.get("T90005", [None])[0] == "none"
          and mt.get("T90006", [None])[0] == "ambiguous", mt)
    check("a PatID reporting another name goes to review", mt.get("T90002", [None])[0] == "review", mt)
    check("a name is not enough for a PatID never filed under our facility: it waits for a person",
          mt.get("T90007", [None])[0] == "none" and not mt.get("T90007", [None, None])[1], mt)
    av = s["admin_view"]
    check("the every-house reader sees every patient, the unmatched and those with no house, and the ledger",
          len(av["patients"]) == 7 and {"house", "nohouse", "unmatched"} <= set(av["groups"]) and av["ledger"] > 0, av)
    hv = s["hal_view"]
    check("a ticked HM badge with one house sees only that house's matched residents, and no ledger",
          hv["patients"] == ["T90001", "T90003"] and hv["houses"] == ["ABD1711"] and hv["ledger"] is False, hv)
    check("a ticked HM badge that manages nothing sees nobody, and is told why",
          s["hana_view"][0] == 0 and s["hana_view"][1], s["hana_view"])
    cv = s["client_view"]
    check("?client= narrows the view to the residents matched to that client, leaves out the import desk, and has "
          "its own version; another house's client and an unknown one are empty",
          cv["patients"] == ["T90001"] and cv["rx"] == ["T90001"] and cv["rx_count"] > 0 and cv["desk"] == []
          and cv["version"] is True and cv["since"] is True and cv["other_house"] == 0 and cv["unknown"] == [0, 0], cv)
    check("a relabelled prescription shows ONCE in the current view", s["current_once"] == 1, s["current_once"])
    check("another house's prescription and an unknown key are the same 404",
          s["rx_404"] == {"other_house": True, "unknown": True, "own": True, "admin": True}, s["rx_404"])
    check("?since answers unchanged while nothing moved, and changed after the reader's houses changed",
          s["since_same"] is True and s["since_scope"] is True)
    check("a client moved to another house leaves the old manager's answer on the next request, with no import",
          s["moved"]["patients"] == ["T90001"] and s["moved"]["since"] is True, s["moved"])
    check("a person's `same as` folds a second PatID into the resident the manager already sees",
          ["T90006", "T90001"] in s["same_as"], s["same_as"])
    rf = s["review_fold"]
    check("a fold whose own name fell to review is listed unmatched with its head's client, and ?client= leaves it "
          "and its prescriptions out; confirmed, it is the client's again",
          rf["wide"] == ["unmatched", "c_ann"] and rf["patients"] == ["T90001"] and rf["rx"] == ["T90001"]
          and rf["fold_rx"] > 0 and rf["confirmed"] == ["T90001", "T90006"], rf)
    ho = s["house"]
    check("the house copy: one import's lines in one offer, raw names never in the mirrored ledger",
          ho["lines_sent"][0] == ho["lines_sent"][1] and ho["raw_named"] and not ho["raw_leak"], ho)
    check("`written` only when every row sent is present; a short answer is failed, with a backoff",
          ho["good"] == "written" and ho["short"] == "failed" and ho["next_set"] >= 1, ho)
    check("a door that could not be reached (or is not published yet) leaves the house copy pending",
          ho["unreachable"] == "pending", ho)
    hp = s["house_patients"]
    check("every patient row is owed by version and none rides an import's offer; written, nothing is owed",
          hp["sent"] == [f"T9000{i}" for i in range(1, 8)] and hp["owed_after"] == [] and not hp["in_import_offers"], hp)
    check("a person's match after the copy had the row owes it again, with the new client",
          hp["requeued"] == ["c_fay", "person"], hp)
    check("a change made while the door wrote stays owed: the version SENT is the one marked",
          hp["still"] == ["T90007"], hp)

    g = lane.get("gaps") or {}
    check("the gap cases ran", bool(g), lane.get("gaps"))
    if g:
        ga_ = g["a_batch"]
        check("a drop refused as a batch duplicate never settles the folder file: the waiting drop is adopted, "
              "nothing downloaded, no refusal for the Drive file",
              ga_["drops"][:2] == ["new", "duplicate"] and "batch" in ga_["drops"][2] and ga_["downloads"] == 0
              and ga_["ledger_gA"] == [] and ga_["adopted"] == 1, ga_)
        ge = g["a_expired"]
        check("when the first drop expired, the folder file is downloaded and staged — never 'already on file'",
              ge == {"expired": 1, "downloads": 1, "staged_gB": 1, "ledger_gB": 0}, ge)
        gn = g["b_name"]
        check("a drop held for its NAME says nothing about the correctly named folder copy: read and imported",
              gn["drop"] == ["held", ["name-date"]] and gn["downloads"] == 1 and gn["staged_gC"] == 1
              and g["b_commit"] == {"imported": 1}, gn)
        gg = g["gate"]
        check("the folder gate is a session lock on an IDLE connection (no idle-in-transaction timeout applies)",
              gg["state"] == ["idle"], gg)
        check("a gate that died stops the downloads; the file waits for the next read",
              gg["lost"] == [True, 1, 0], gg)
        gl = g["late"]
        check("a reader deciding a revision another reader staged finds that staging, never a twin of itself",
              gl == {"verdict": "new", "same_stage": True, "ledger_gE": 0} and g["late_commit"] == {"imported": 2},
              [gl, g["late_commit"]])
        gr = g["revisions"]
        check("a Drive file replaced before import: the old revision is recorded and dropped, the new one staged "
              "and imported; a rename follows the staging without a download",
              gr["staged"] == [["2030-02-02T05:00:00.000Z"]] and gr["old"] == [["duplicate", ["revision"]]]
              and gr["renamed"] == [["2030-02-03T05:00:00.000Z", True]] and gr["rename_downloads"] == 0
              and gr["imported_fp_is_r2"] == 1, gr)
        gc_ = g["staged_conflict"]
        check("two different reports waiting for one period are BOTH held — neither chosen by arrival",
              gc_["first_preview"] == "new" and gc_["second"] == ["held", ["batch", "period"]]
              and gc_["first_now"] == [["held", ["batch", "period"]]] and gc_["staged_left"] == 0, gc_)


print(f"\n{results['ok']} ok, {len(results['failed'])} failed"
      + (f", skipped: {'; '.join(results['skipped'])}" if results["skipped"] else ""))
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
