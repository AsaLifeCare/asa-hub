#!/usr/bin/env python3
"""
THE MED DEL CATALOGUE, asserted offline — and above all, asserted BROKEN.

The Med Del renewal lane's settings moved out of the code and into the
`meddel_catalog` house so a business person can change them without a push.
The interesting half of that move is not the happy path: it is what the lane
does on the day the sheet is not there, cannot be opened, is half-filled in,
or has been emptied by somebody clearing rows they thought were noise.

Getting that wrong is not a display bug. An empty level list means no
expiring certification is ever detected again. An empty employment-status list
means every employee reads as no longer employed and every open renewal is
auto-cancelled in one pass. A catalogue read as EMPTY when it was merely
UNREADABLE does both, silently, with every check green.

So this runs the real reader — apps-script/MedDelCatalog.gs, in node, over a
fake grid — through the cases that matter:

  present      the sheet answers and its values reach the lane
  missing      the house is not minted: the shipped levels, statuses and
               timings stand, and the read says why
  unreadable   the house exists but throws: the same, and NOT an empty list
  sheet-only   a fourth certification declared only in the sheet is renewed,
               and its Master column joins the projection — while the PII
               whitelist stays exactly as narrow as it was
  emptied      a group whose rows were all deleted or switched off falls back
               rather than deciding; only a DECLARED `no` turns one thing off
  cached       a good read is cached for a minute; a FAILED one never is, so
               a one-second outage does not pin the lane to shipped values
  agreement    the shipped copy in MedDel.gs, the header in MedDelCatalog.gs
               and the rows tools/mint_meddel_catalog_house.py seeds are the
               same values — a migration that plants different numbers is a
               behaviour change wearing a migration's clothes

HOW IT STAYS OFFLINE. Apps Script is node running the lane's own source over a
grid held in memory; the mint tool is imported for its tables only and never
reaches Google (it takes no token unless it is run as a script).

    python3 tools/test-meddel-catalog.py
"""
import json
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
REPO = HERE.parent.parent
GS = REPO / "apps-script"
sys.path.insert(0, str(HERE.parent))

import mint_meddel_catalog_house as mint  # noqa: E402

results = {"ok": 0, "failed": []}


def check(name, cond, detail=""):
    if cond:
        results["ok"] += 1
        print(f"ok   {name}")
    else:
        results["failed"].append(name)
        print(f"FAIL {name}{(' — ' + str(detail)[:600]) if detail else ''}")


# ── the lane's own source, in node, over a grid that is ours ───────────────
NODE = r"""
const fs = require('fs'); const vm = require('vm');
const cache = new Map();
const logs = [];

// THE EMPLOYEE MASTER, in memory. Phase 5 writes ONE cell of it, under a
// header the catalogue now names — so the write-back has to be run for real
// here, not asserted on the source. The protected columns are present exactly
// because the question is whether a catalogue cell can reach them.
const MASTER_ROW0 = ['Employee', 'Status', 'SSN#', 'Date of Birth', 'Login', 'Password',
                     'Address', 'Med 1 Exp Date', 'Med 2 Exp Date', 'Med 3 Exp Date'];
let masterGrid = [];
let written = [];
const resetMaster = () => {
  masterGrid = [MASTER_ROW0.slice(),
                ['Jane Doe', 'Yes', '123-45-6789', '1980-01-01', 'jdoe', 'hunter2',
                 '1 Main St', '2026-01-01', '2026-02-02', '2026-03-03']];
  written = [];
};
resetMaster();
const masterSheet = {
  getLastRow: () => masterGrid.length,
  getLastColumn: () => masterGrid[0].length,
  getRange: (r, c, nr, nc) => ({
    getValues: () => {
      const rows = [];
      for (let i = 0; i < (nr || 1); i++) {
        const line = [];
        for (let j = 0; j < (nc || 1); j++) line.push(masterGrid[r - 1 + i][c - 1 + j]);
        rows.push(line);
      }
      return rows;
    },
    getValue: () => masterGrid[r - 1][c - 1],
    setValue: (v) => {
      written.push({ header: masterGrid[0][c - 1], value: v });
      masterGrid[r - 1][c - 1] = v;
    },
  }),
};

const ctx = {
  HUB_POLICY: {}, HUB_ACTIONS: {}, console, JSON, String, Number, Boolean, Array,
  Object, RegExp, Date, Math, isNaN, parseInt, parseFloat, Error,
  cellText_: (v) => String(v),
  str_: (v) => String(v == null ? '' : v).trim(),
  hubIsWriter_: () => true,
  hubDenied_: () => ({ status: 403 }),
  listRows_: () => LEGACY_ROWS,
  hubSysLog_: (actor, action, target, env) => { logs.push({ action, target, env }); },
  Utilities: { getUuid: () => 'uuid' },
  hubId_: () => 'CERT_SOURCE',
  ssOpen_: () => ({ getSheetByName: () => masterSheet }),
  CERT_MASTER_TAB: 'Master',
  CacheService: { getScriptCache: () => ({
    get: (k) => (cache.has(k) ? cache.get(k) : null),
    put: (k, v) => cache.set(k, String(v)),
    remove: (k) => cache.delete(k),
  }) },
};
let LEGACY_ROWS = [];
ctx.globalThis = ctx;
vm.createContext(ctx);
// argv: 1 MedDel.gs · 2 MedDelCatalog.gs · 3 SheetDb.gs, which is READ for its
// cacheScope_ alone (case 17) and is never loaded into this context.
for (const f of process.argv.slice(1, 3)) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);

const H = ctx.MEDDEL_CATALOG_HEADER;
const sheetOf = (rows) => {
  const grid = [H.slice()];
  for (const r of rows) grid.push(H.map((h) => (r[h] === undefined ? '' : r[h])));
  return { getDataRange: () => ({ getValues: () => grid }) };
};
const setSheet = (fn) => { ctx.hubTabSheet_ = fn; };
const fresh = () => { ctx.medDelCatalogBump_(); };

const SETTINGS = [
  { kind: 'setting', name: 'windowDays', value: '60' },
  { kind: 'setting', name: 'phase2ResendDays', value: '3' },
  { kind: 'setting', name: 'skillsCheckEmail', value: 'reedh@starkdd.org' },
];
const LEVELS = [
  { kind: 'level', name: 'Med 1', value: 'med_1_exp_date', label: 'Med 1 Exp Date' },
  { kind: 'level', name: 'Med 2', value: 'med_2_exp_date', label: 'Med 2 Exp Date' },
  { kind: 'level', name: 'Med 3', value: 'med_3_exp_date', label: 'Med 3 Exp Date' },
];
const STATUSES = [
  { kind: 'active_status', name: 'yes' },
  { kind: 'active_status', name: 'other' },
  { kind: 'active_status', name: 'active' },
];
const full = SETTINGS.concat(LEVELS, STATUSES);

const out = {};

// what the code ships with, for the agreement half
out.shipped = {
  defaults: ctx.MEDDEL_DEFAULTS, levels: ctx.MEDDEL_LEVELS,
  columns: ctx.MEDDEL_LEVEL_COLUMNS, headers: ctx.MEDDEL_LEVEL_HEADERS,
  statuses: ctx.MEDDEL_ACTIVE_STATUSES, masterFields: ctx.MEDDEL_MASTER_FIELDS,
  catalogHeader: H, tab: ctx.MEDDEL_CATALOG_TAB,
};

// 1 · PRESENT
setSheet(() => sheetOf(full)); fresh();
out.present = ctx.medDelCatalog_();

// 2 · MISSING — nothing answers for the tab
setSheet(() => null); fresh();
out.missing = ctx.medDelCatalog_();
out.missingCached = cache.size;

// 3 · UNREADABLE — the house is there and throws
setSheet(() => ({ getDataRange: () => { throw new Error('rate limit'); } })); fresh();
out.unreadable = ctx.medDelCatalog_();
out.unreadableCached = cache.size;

// 3b · the router itself throws
setSheet(() => { throw new Error('ssOpen_ failed'); }); fresh();
out.routerThrew = ctx.medDelCatalog_();

// 3c · the tab answers with somebody else's header
setSheet(() => ({ getDataRange: () => ({ getValues: () => [['a', 'b'], ['1', '2']] }) })); fresh();
out.wrongHeader = ctx.medDelCatalog_();

// 4 · A ROW ONLY IN THE SHEET — a fourth certification nobody pushed
setSheet(() => sheetOf(full.concat([
  { kind: 'level', name: 'Med 4', value: 'med_4_exp_date', label: 'Med 4 Exp Date' },
]))); fresh();
out.sheetOnly = ctx.medDelCatalog_();

// 5 · PRESENT BUT EMPTY — header only
setSheet(() => sheetOf([])); fresh();
out.emptySheet = ctx.medDelCatalog_();

// 6 · EVERY STATUS SWITCHED OFF — the cancel-everybody case
setSheet(() => sheetOf(SETTINGS.concat(LEVELS,
  STATUSES.map((s) => Object.assign({}, s, { enabled: 'no' }))))); fresh();
out.noStatuses = ctx.medDelCatalog_();

// 6b · ONE level switched off — the declared way to stop renewing one
setSheet(() => sheetOf(SETTINGS.concat(
  [LEVELS[0], LEVELS[1], Object.assign({}, LEVELS[2], { enabled: 'no' })], STATUSES))); fresh();
out.oneLevelOff = ctx.medDelCatalog_();

// 7 · THE PII FLOOR — a level pointed at a protected column
setSheet(() => sheetOf(SETTINGS.concat(
  [Object.assign({}, LEVELS[0], { value: 'ssn' }), LEVELS[1], LEVELS[2]], STATUSES))); fresh();
out.pii = ctx.medDelCatalog_();

// 7b · and a brand-new level pointed at one: it never joins at all
setSheet(() => sheetOf(full.concat([
  { kind: 'level', name: 'Med 9', value: 'date_of_birth', label: 'DOB' },
]))); fresh();
out.piiNewLevel = ctx.medDelCatalog_();

// 8 · THE SHEET EDITS A TIMING — the whole point of the move
setSheet(() => sheetOf(full.map((r) =>
  (r.name === 'windowDays' ? Object.assign({}, r, { value: '90' }) : r)))); fresh();
out.edited = ctx.medDelCatalog_();
out.editedCached = cache.size;

// 8b · a setting switched off falls back to the shipped default
setSheet(() => sheetOf(full.map((r) =>
  (r.name === 'windowDays' ? Object.assign({}, r, { value: '90', enabled: 'no' }) : r)))); fresh();
out.settingOff = ctx.medDelCatalog_();

// 9 · THE LEGACY OVERRIDE ROW, still honoured — and outranked by the sheet
LEGACY_ROWS = [{ key: 'medDelConfig', value: JSON.stringify({ windowDays: 45, cancelAfterDays: 30 }) }];
setSheet(() => null); fresh();
out.legacyAlone = ctx.medDelCatalog_();
setSheet(() => sheetOf(full.map((r) =>
  (r.name === 'windowDays' ? Object.assign({}, r, { value: '90' }) : r)))); fresh();
out.legacyUnderSheet = ctx.medDelCatalog_();
LEGACY_ROWS = [];

// 10 · THE LOG. One line per execution, however many flows the sweep touches.
logs.length = 0;
setSheet(() => null); fresh();
ctx.medDelCatalog_(); ctx.medDelCatalog_(); ctx.medDelCatalog_();
out.saidTimes = logs.filter((l) => l.action === 'meddel_catalog_unreadable').length;
out.said = logs[0] || null;

// 11 · WHAT THE SCREEN IS HANDED
out.state = ctx.medDelCatalogState_();

// 12 · the phases read the catalogue, not the constants
const src = (fn) => String(fn).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
out.reads = {
  sweepLevels: src(ctx.medDelSweep_).indexOf('cat.levels') !== -1,
  sweepColumns: src(ctx.medDelSweep_).indexOf('cat.levelColumns') !== -1,
  sweepStatuses: src(ctx.medDelSweep_).indexOf('cat.activeStatuses') !== -1,
  sweepOnce: (src(ctx.medDelSweep_).match(/medDelCat_\(\)/g) || []).length === 1,
  sweepNoConst: src(ctx.medDelSweep_).indexOf('MEDDEL_LEVELS') === -1
    && src(ctx.medDelSweep_).indexOf('MEDDEL_ACTIVE_STATUSES') === -1,
  writeBack: src(ctx.medDelMasterWriteExp_).indexOf('medDelCat_().levelHeaders') !== -1,
  projection: src(ctx.medDelMasterRows_).indexOf('medDelCat_().masterFields') !== -1,
  startLevels: src(ctx.HUB_ACTIONS.medDelStart).indexOf('cat.levels') !== -1,
  seedLevels: src(ctx.HUB_ACTIONS.medDelSeed).indexOf('cat.levels') !== -1,
  boardTells: src(ctx.HUB_ACTIONS.medDelFlows).indexOf('medDelCatState_') !== -1,
  neverEnsures: fs.readFileSync(process.argv[2], 'utf8').indexOf('hubTabEnsure_(MEDDEL_CATALOG_TAB') === -1,
};

// 13 · the words did NOT move twice
out.seeds = (ctx.MEDDEL_SMART_SEEDS || []).map((s) => s.id);

// 14 · THE WRITE-BACK CELL. `label` decides which column of the employee
// Master phase 5 puts a date in — the only cell this lane ever changes on
// somebody's record. It is run for real, against a Master that carries the
// protected columns, because a floor asserted on source is not a floor.
const writeCase = (label) => {
  resetMaster();
  setSheet(() => sheetOf(SETTINGS.concat(
    [Object.assign({}, LEVELS[0], { label: label }), LEVELS[1], LEVELS[2]], STATUSES)));
  fresh();
  const cat = ctx.medDelCatalog_();
  const res = ctx.medDelMasterWriteExp_('Jane Doe', 'Med 1', '2027-05-05');
  return { header: cat.levelHeaders['Med 1'], refused: cat.refused, write: res,
           written: written.slice(), row: masterGrid[1].slice() };
};
out.writeBack = {};
for (const label of ['SSN#', 'Date of Birth', 'Login', 'Password', 'Address', 'Med 1 Exp Date']) {
  out.writeBack[label] = writeCase(label);
}

// 15 · A LEVEL SWITCHED OFF OR RENAMED still has somewhere to land. Detection
// shrinks on purpose; the write-back map must not, or every renewal already in
// flight for that level closes with the OLD date still on the Master.
const inFlight = (rows) => {
  resetMaster();
  setSheet(() => sheetOf(rows)); fresh();
  const cat = ctx.medDelCatalog_();
  const res = ctx.medDelMasterWriteExp_('Jane Doe', 'Med 3', '2027-05-05');
  return { levels: cat.levels, header: cat.levelHeaders['Med 3'], write: res,
           written: written.slice() };
};
out.levelOff = inFlight(SETTINGS.concat(
  [LEVELS[0], LEVELS[1], Object.assign({}, LEVELS[2], { enabled: 'no' })], STATUSES));
out.levelRenamed = inFlight(SETTINGS.concat(
  [LEVELS[0], LEVELS[1], Object.assign({}, LEVELS[2], { name: 'Med III' })], STATUSES));
out.levelGone = inFlight(SETTINGS.concat([LEVELS[0], LEVELS[1]], STATUSES));
resetMaster();

// 16 · `enabled` WORDS. Only a declared off-word switches a row off; a tick
// nobody can parse leaves it ON and is said out loud.
out.enabledWords = {};
for (const word of ['', 'yes', 'YES', 'no', 'NO', 'off', 'false', '0',
                    'x', 'X', 'ok', '✓', 'n/a', 'sim', 'maybe']) {
  setSheet(() => sheetOf(SETTINGS.concat(LEVELS,
    [STATUSES[0], Object.assign({}, STATUSES[1], { enabled: word }), STATUSES[2]])));
  fresh();
  const cat = ctx.medDelCatalog_();
  out.enabledWords[word] = { statuses: Object.keys(cat.activeStatuses).sort(),
                             refused: cat.refused.length };
}

// 17 · THE CACHE KEY. The store is shared across worlds and places; the key
// must not be. cacheScope_ is the platform's own answer, so it is the real one
// that is exercised here.
const scopeSrc = fs.readFileSync(process.argv[3], 'utf8').match(/function cacheScope_\([\s\S]*?\n}/)[0];
out.cacheKeys = {};
for (const [where, world, tenant] of [['hq', null, ''],
                                      ['world', { ssId: '1worldBookAAAAAAAA' }, ''],
                                      ['place', null, '1tenantBookBBBBBBB']]) {
  const c = { HUB_POLICY: {}, HUB_ACTIONS: {}, console, JSON, String, Number, Boolean,
    Array, Object, RegExp, Date, Math, isNaN, parseInt, parseFloat, Error,
    str_: (v) => String(v == null ? '' : v).trim(), listRows_: () => [],
    HUB_WORLD_CTX: world, tenantSpreadsheetId_: () => tenant, hubTabIsCentral_: () => false };
  c.globalThis = c; vm.createContext(c);
  for (const f of process.argv.slice(1, 3)) vm.runInContext(fs.readFileSync(f, 'utf8'), c);
  vm.runInContext(scopeSrc, c);
  out.cacheKeys[where] = c.medDelCatalogKey_();
}

// 18 · MedDel.gs ALONE. Apps Script is pushed file by named file and a named
// push leaves the rest behind in silence. The lane must degrade to the shipped
// copy, not die with a ReferenceError.
{
  const c = { HUB_POLICY: {}, HUB_ACTIONS: {}, console, JSON, String, Number, Boolean,
    Array, Object, RegExp, Date, Math, isNaN, parseInt, parseFloat, Error,
    str_: (v) => String(v == null ? '' : v).trim(), listRows_: () => [],
    hubSysLog_: (actor, action, target, env) => { alone.logs.push({ action, env }); } };
  const alone = { logs: [], errors: {} };
  c.globalThis = c; vm.createContext(c);
  vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), c);
  const seen = {};
  for (const name of ['medDelConfig_', 'medDelMasterRows_', 'medDelCat_']) {
    try { seen[name] = c[name]() || true; } catch (e) { alone.errors[name] = String(e.message); }
  }
  out.alone = {
    errors: alone.errors,
    logs: alone.logs.map((l) => l.action),
    cat: seen.medDelCat_ || null,
  };
}

// 19 · PHASE 5 DOES NOT CLOSE A FLOW WHOSE MASTER WRITE FAILED.
out.reads.phase5Holds = src(ctx.medDelSweep_).indexOf('master_write_failed') !== -1
  && /overallStatus:\s*held \? 'active' : 'complete'/.test(src(ctx.medDelSweep_));
out.reads.seamGuarded = src(ctx.medDelCat_).indexOf("typeof medDelCatalog_ !== 'function'") !== -1
  || src(ctx.medDelCat_).indexOf("typeof medDelCatalog_ === 'function'") !== -1;

process.stdout.write(JSON.stringify(out));
"""

proc = subprocess.run(
    ["node", "-e", NODE, str(GS / "MedDel.gs"), str(GS / "MedDelCatalog.gs"),
     str(GS / "SheetDb.gs")],
    capture_output=True, text=True, timeout=120)
if proc.returncode != 0 or not proc.stdout:
    print("FAIL the reader could not be run in node")
    print((proc.stderr or "")[:4000])
    sys.exit(1)
R = json.loads(proc.stdout)
shipped = R["shipped"]

# ── 1 · present ────────────────────────────────────────────────────────────
p = R["present"]
check("PRESENT: the sheet answers and every group comes from it",
      p["ok"] is True and p["source"] == "sheet"
      and p["groups"] == {"settings": "sheet", "levels": "sheet", "statuses": "sheet"}
      and p["levels"] == ["Med 1", "Med 2", "Med 3"]
      and p["levelColumns"]["Med 2"] == "med_2_exp_date"
      and p["levelHeaders"]["Med 3"] == "Med 3 Exp Date"
      and sorted(p["activeStatuses"]) == ["active", "other", "yes"]
      and p["settings"]["windowDays"] == 60 and not p["refused"], p)
check("PRESENT: a group the sheet does not carry still answers, from the code — "
      "one half-filled section never drags a whole catalogue down",
      p["settings"]["cancelAfterDays"] == shipped["defaults"]["cancelAfterDays"], p["settings"])

# ── 2/3 · missing and unreadable are NEVER empty ───────────────────────────
for label, key in (("MISSING (the house was never minted)", "missing"),
                   ("UNREADABLE (the house threw)", "unreadable"),
                   ("THE ROUTER ITSELF THREW", "routerThrew"),
                   ("A TAB THAT IS NOT THE CATALOGUE", "wrongHeader")):
    c = R[key]
    check(f"{label}: no level disappears, no status is lost, every timing stands — "
          f"and the read says WHY instead of pretending the sheet was empty",
          c["ok"] is False and c["why"]
          and c["levels"] == shipped["levels"]
          and c["levelColumns"] == shipped["columns"]
          and c["levelHeaders"] == shipped["headers"]
          and c["activeStatuses"] == shipped["statuses"]
          and c["settings"] == shipped["defaults"]
          and c["masterFields"] == shipped["masterFields"]
          and c["source"] == "code", c)

check("A FAILED READ IS NEVER CACHED — a one-second outage must not pin the lane to the "
      "shipped values for the following minute",
      R["missingCached"] == 0 and R["unreadableCached"] == 0,
      (R["missingCached"], R["unreadableCached"]))
check("A GOOD READ IS CACHED, so the sheet costs one read a minute and an edit still lands "
      "inside one", R["editedCached"] == 1, R["editedCached"])

# ── 4 · a row only in the sheet ────────────────────────────────────────────
s = R["sheetOnly"]
check("A ROW ONLY IN THE SHEET: a fourth certification is renewed with no push and no publish",
      s["ok"] is True and s["levels"] == ["Med 1", "Med 2", "Med 3", "Med 4"]
      and s["levelColumns"]["Med 4"] == "med_4_exp_date"
      and s["levelHeaders"]["Med 4"] == "Med 4 Exp Date", s)
check("A ROW ONLY IN THE SHEET: its Master column joins the projection, so the date can be "
      "read — and NOTHING else widens",
      "med_4_exp_date" in s["masterFields"]
      and set(s["masterFields"]) - set(shipped["masterFields"]) == {"med_4_exp_date"},
      s["masterFields"])

# ── 5/6 · absence never decides ────────────────────────────────────────────
e = R["emptySheet"]
check("AN EMPTIED CATALOGUE IS NOT A DECISION: a sheet with only a header falls back to the "
      "shipped levels, statuses and timings",
      e["ok"] is True and e["levels"] == shipped["levels"]
      and e["activeStatuses"] == shipped["statuses"]
      and e["settings"] == shipped["defaults"]
      and e["groups"] == {"settings": "code", "levels": "code", "statuses": "code"}
      and e["why"], e)

n = R["noStatuses"]
check("EVERY EMPLOYMENT STATUS SWITCHED OFF would auto-cancel every open renewal — so it is "
      "refused out loud and the shipped three stand",
      n["activeStatuses"] == shipped["statuses"] and n["groups"]["statuses"] == "code"
      and any("cancel every open renewal" in r for r in n["refused"]), n)

o = R["oneLevelOff"]
check("ONE LEVEL SWITCHED OFF is the declared way to stop renewing one: no flow is ever "
      "created for it again, and the other two are untouched",
      o["levels"] == ["Med 1", "Med 2"] and o["groups"]["levels"] == "sheet"
      and "Med 3" not in o["levelColumns"], o)
check("ONE LEVEL SWITCHED OFF keeps its WRITE-BACK header, because the detection list shrinking "
      "says nothing about the renewals already in flight — they still have to land their new "
      "date on the Master",
      o["levelHeaders"]["Med 3"] == shipped["headers"]["Med 3"], o["levelHeaders"])
check("ONE LEVEL SWITCHED OFF does NOT narrow the Master projection — the whitelist is a "
      "privacy boundary, not a feature switch, and shrinking it on a config edit would be a "
      "second, invisible meaning for the same cell",
      o["masterFields"] == shipped["masterFields"], o["masterFields"])

# ── 7 · the PII floor ──────────────────────────────────────────────────────
pii = R["pii"]
check("THE PII FLOOR: a level pointed at a protected column is refused by name, the shipped "
      "column stands, and the level does NOT disappear",
      pii["levelColumns"]["Med 1"] == "med_1_exp_date"
      and pii["levels"] == ["Med 1", "Med 2", "Med 3"]
      and any("protected employee data" in r for r in pii["refused"])
      and "ssn" not in pii["masterFields"], pii)
new = R["piiNewLevel"]
check("THE PII FLOOR: a level INVENTED in the sheet with a protected column never joins at all",
      "Med 9" not in new["levels"] and "date_of_birth" not in new["masterFields"]
      and any("Med 9" in r for r in new["refused"]), new)

# ── 8/9 · the edit reaches the lane, and the legacy row still works ────────
check("AN EDIT IN THE SHEET REACHES THE LANE: the detection window moves from 60 to 90 days "
      "with no push and no publish",
      R["edited"]["settings"]["windowDays"] == 90, R["edited"]["settings"])
check("A SETTING SWITCHED OFF falls back to the shipped default rather than to nothing",
      R["settingOff"]["settings"]["windowDays"] == shipped["defaults"]["windowDays"],
      R["settingOff"]["settings"])
check("THE LEGACY medDelConfig ROW STILL APPLIES when the sheet cannot be read — the move "
      "retires nothing behind anybody's back",
      R["legacyAlone"]["settings"]["windowDays"] == 45
      and R["legacyAlone"]["settings"]["cancelAfterDays"] == 30, R["legacyAlone"]["settings"])
check("THE SHEET OUTRANKS THE LEGACY ROW where both speak, and the legacy row still answers "
      "where the sheet is silent",
      R["legacyUnderSheet"]["settings"]["windowDays"] == 90
      and R["legacyUnderSheet"]["settings"]["cancelAfterDays"] == 30,
      R["legacyUnderSheet"]["settings"])

# ── 10/11 · what is said ───────────────────────────────────────────────────
check("IT IS SAID IN THE LOG, ONCE per execution — a sweep asks this per flow and must not "
      "write a hundred identical lines",
      R["saidTimes"] == 1 and R["said"]["action"] == "meddel_catalog_unreadable"
      and "nobody was cancelled" in R["said"]["env"]["message"], R["said"])
check("IT IS SAID ON THE SCREEN: the board's answer carries ok, why and where each group "
      "came from",
      R["state"]["ok"] is False and R["state"]["why"]
      and R["state"]["source"] == "code" and R["state"]["levels"] == shipped["levels"],
      R["state"])

# ── 12 · the phases really read it ─────────────────────────────────────────
reads = R["reads"]
for name, why in (
    ("sweepLevels", "the sweep detects expiring certs from the catalogue's levels"),
    ("sweepColumns", "the sweep reads each level's Master column from the catalogue"),
    ("sweepStatuses", "the sweep's auto-cancel asks the catalogue which statuses mean employed"),
    ("sweepOnce", "the sweep reads the catalogue ONCE, so a cache expiry mid-pass cannot judge "
                  "the first half of the flows against different levels than the second"),
    ("sweepNoConst", "the sweep no longer reaches for the in-code constants"),
    ("writeBack", "phase 5 writes the renewed date under the catalogue's Master header"),
    ("projection", "the Master projection is the catalogue's, so a new level's column is readable"),
    ("startLevels", "the Start door validates against the catalogue's levels"),
    ("seedLevels", "the Seed door walks the catalogue's levels"),
    ("boardTells", "the board is told where the settings came from"),
    ("neverEnsures", "the catalogue is never CREATED by the lane — a missing house must stay "
                     "missing, not be resurrected as an empty tab in HUB_DB"),
):
    check(f"THE PHASES READ THE CATALOGUE: {why}", reads.get(name) is True, reads)

# ── 12b · the write-back cell, which is the only one this lane ever changes ─
# The read column had a floor from the first day; the WRITE-BACK header did
# not, and it is the cell that decides where on somebody's employee record a
# date is stamped. `SSN#` in a `label` cell overwrote the SSN with a date, the
# write reported ok, and nothing was refused or logged.
wb = R["writeBack"]
for label in ("SSN#", "Date of Birth", "Login", "Password"):
    c = wb[label]
    check(f"THE WRITE-BACK FLOOR: a `label` cell naming {label} is refused — phase 5 writes "
          f"under the shipped header instead, and the protected cell is untouched",
          c["header"] == shipped["headers"]["Med 1"]
          and any("protected employee data" in r and "write-back" in r for r in c["refused"])
          and [w["header"] for w in c["written"]] == ["Med 1 Exp Date"]
          and c["row"][2] == "123-45-6789" and c["row"][3] == "1980-01-01"
          and c["row"][4] == "jdoe" and c["row"][5] == "hunter2", c)
check("THE WRITE-BACK FLOOR: a `label` naming an ordinary Master column that is not an "
      "expiration date is refused too — the floor is not a PII blocklist, it is a rule about "
      "which one cell this lane may write",
      wb["Address"]["header"] == shipped["headers"]["Med 1"]
      and any("does not read like an expiration column" in r for r in wb["Address"]["refused"])
      and wb["Address"]["row"][6] == "1 Main St", wb["Address"])
check("THE WRITE-BACK FLOOR: the header the business really typed still works — the renewed "
      "date lands on the Master and nothing else moves",
      wb["Med 1 Exp Date"]["write"]["ok"] is True
      and not wb["Med 1 Exp Date"]["refused"]
      and wb["Med 1 Exp Date"]["row"][7] == "2027-05-05"
      and wb["Med 1 Exp Date"]["row"][2] == "123-45-6789", wb["Med 1 Exp Date"])

# ── 12c · a level switched off must not strand the renewals already running ─
for label, key, levels in (
    ("SWITCHED OFF, the documented edit", "levelOff", ["Med 1", "Med 2"]),
    ("RENAMED in the sheet", "levelRenamed", ["Med 1", "Med 2", "Med III"]),
    ("DELETED from the sheet", "levelGone", ["Med 1", "Med 2"]),
):
    c = R[key]
    check(f"A LEVEL {label} stops being DETECTED but keeps its write-back header: a renewal "
          f"already in flight still lands its new date on the Master, instead of closing as "
          f"complete while the Master keeps the OLD expiration and every other lane reads that "
          f"person as no longer delegated",
          c["levels"] == levels and c["header"] == shipped["headers"]["Med 3"]
          and c["write"]["ok"] is True
          and [w["header"] for w in c["written"]] == ["Med 3 Exp Date"], c)

check("PHASE 5 DOES NOT CLOSE A FLOW WHOSE MASTER WRITE FAILED — it holds it open in a "
      "retryable state, the way a failed scrape already does, so a renewal that never reached "
      "the Master is never recorded as done",
      R["reads"]["phase5Holds"] is True, R["reads"])

# ── 12d · an illegible `enabled` cell is not a declared no ──────────────────
words = R["enabledWords"]
for word in ("", "yes", "YES"):
    check(f"`enabled` = {word!r} means ON, and nothing is refused",
          words[word]["statuses"] == ["active", "other", "yes"] and words[word]["refused"] == 0,
          words[word])
for word in ("no", "NO", "off", "false", "0"):
    check(f"`enabled` = {word!r} is a DECLARED no and switches the row off",
          words[word]["statuses"] == ["active", "yes"] and words[word]["refused"] == 0,
          words[word])
for word in ("x", "X", "ok", "✓", "n/a", "sim", "maybe"):
    check(f"`enabled` = {word!r} is neither yes nor no: the row stays ON and the board is told "
          f"— an unreadable tick used to cancel every open renewal for that status, silently",
          words[word]["statuses"] == ["active", "other", "yes"] and words[word]["refused"] == 1,
          words[word])

# ── 12e · the cache key is not shared across worlds and places ──────────────
keys = R["cacheKeys"]
check("THE CACHE KEY CARRIES THE WORLD AND THE PLACE: `meddel_catalog` is not a central tab, so "
      "the router answers per world and per place — a bare key would serve headquarters' levels, "
      "statuses and timings to a world that has no catalogue at all, and report source:sheet",
      len({keys["hq"], keys["world"], keys["place"]}) == 3
      and "1worldBo" in keys["world"] and "1tenantB" in keys["place"], keys)

# ── 12f · a named push that lands one file and not the other ────────────────
alone = R["alone"]
check("MedDel.gs WITHOUT MedDelCatalog.gs degrades instead of dying: a named push that leaves "
      "the new file behind must give the lane the shipped copy, not a ReferenceError in every "
      "door",
      alone["errors"] == {} and "meddel_catalog_module_missing" in alone["logs"], alone)
check("THE SHIPPED COPY IT FALLS BACK TO IS THE REAL ONE — the same levels, columns, headers, "
      "statuses and timings, so no level disappears and nobody is marked as not delegated",
      alone["cat"]["levels"] == shipped["levels"]
      and alone["cat"]["levelColumns"] == shipped["columns"]
      and alone["cat"]["levelHeaders"] == shipped["headers"]
      and alone["cat"]["activeStatuses"] == shipped["statuses"]
      and alone["cat"]["settings"] == shipped["defaults"]
      and alone["cat"]["masterFields"] == shipped["masterFields"]
      and alone["cat"]["ok"] is False and alone["cat"]["source"] == "code", alone["cat"])
check("AND THE SEAM IS A `typeof` GUARD, not a hope", R["reads"]["seamGuarded"] is True, R["reads"])

# ── 13 · the words did not move twice ──────────────────────────────────────
check("THE MESSAGE WORDING DID NOT MOVE: the four situations are still Smart Comms seeds, "
      "editable from the Desk, and are NOT duplicated into the catalogue",
      sorted(R["seeds"]) == ["meddel_relias_reminder", "meddel_renewal_started",
                             "meddel_scrape_alert", "meddel_skills_reminder"]
      and not any(k in json.dumps(R["present"]) for k in ("sms_text", "email_subject")),
      R["seeds"])

# ── 14 · the code and the migration tool agree ─────────────────────────────
check("AGREEMENT: the header the mint tool stamps IS the header the reader declares",
      list(mint.HEADER) == list(shipped["catalogHeader"]),
      (mint.HEADER, shipped["catalogHeader"]))
check("AGREEMENT: the house the tool mints is the tab the reader asks the router for",
      mint.HOUSE["tab"] == shipped["tab"] == "meddel_catalog"
      and mint.HOUSE["prop"] == "HUB_HOUSE_MEDDEL_CATALOG_ID",
      (mint.HOUSE["tab"], shipped["tab"]))

tool_settings = {k: v for k, v, _n in mint.SETTINGS}
code_settings = {k: str(v) for k, v in shipped["defaults"].items()}
check("AGREEMENT: the tool seeds every shipped setting, and not one it invented",
      sorted(tool_settings) == sorted(code_settings), (sorted(tool_settings), sorted(code_settings)))
check("AGREEMENT: every seeded value IS the shipped value — a migration that plants different "
      "numbers is a behaviour change wearing a migration's clothes",
      tool_settings == code_settings,
      {k: (tool_settings.get(k), code_settings.get(k))
       for k in set(tool_settings) | set(code_settings)
       if tool_settings.get(k) != code_settings.get(k)})
check("AGREEMENT: every setting row carries a note, because a cell nobody can interpret is a "
      "cell nobody will touch",
      all(len(n) > 30 for _k, _v, n in mint.SETTINGS),
      [k for k, _v, n in mint.SETTINGS if len(n) <= 30])

tool_levels = [name for name, _c, _l in mint.LEVELS]
check("AGREEMENT: the tool seeds the same three certifications, with the same Master columns "
      "and the same write-back headers",
      tool_levels == list(shipped["levels"])
      and {n: c for n, c, _l in mint.LEVELS} == shipped["columns"]
      and {n: l for n, _c, l in mint.LEVELS} == shipped["headers"],
      (mint.LEVELS, shipped["columns"], shipped["headers"]))
check("AGREEMENT: the tool seeds the same employment statuses",
      sorted(mint.STATUSES) == sorted(shipped["statuses"]),
      (mint.STATUSES, shipped["statuses"]))
check("AGREEMENT: every seeded level's column is already inside the shipped PII whitelist, so "
      "the migration needs no widening of it at all",
      all(c in shipped["masterFields"] for _n, c, _l in mint.LEVELS),
      [c for _n, c, _l in mint.LEVELS if c not in shipped["masterFields"]])

# ── 15 · the tool is idempotent and only ever fills gaps ───────────────────
rows = mint.seed_rows(dict(tool_settings), "2026-01-01T00:00:00Z")
keys = [(r[mint.HEADER.index("kind")], r[mint.HEADER.index("name")]) for r in rows]
check("THE TOOL: one row per setting, level and status, every one uniquely addressed by "
      "(kind, name) — which is what a re-run matches on",
      len(rows) == len(mint.SETTINGS) + len(mint.LEVELS) + len(mint.STATUSES)
      and len(set(keys)) == len(keys), (len(rows), len(keys), len(set(keys))))
check("THE TOOL: every seeded row is born switched ON by a BLANK cell, so nothing has to be "
      "typed to keep today's behaviour",
      all(r[mint.HEADER.index("enabled")] == "" for r in rows), rows[:2])
def seeded(rows, kind, name, column):
    """One seeded cell, by the row's own (kind, name) — never by position."""
    ki, ni, ci = (mint.HEADER.index(x) for x in ("kind", "name", column))
    for r in rows:
        if r[ki] == kind and r[ni] == name:
            return r[ci]
    return None


carried = mint.seed_rows({**tool_settings, "windowDays": "90"}, "t")
check("THE TOOL: the seeded window carries the LIVE override when there is one — the migration "
      "copies what the lane is running on, not what the code wishes it ran on",
      seeded(carried, "setting", "windowDays", "value") == "90"
      and seeded(carried, "setting", "cancelAfterDays", "value") == code_settings["cancelAfterDays"],
      carried)
check("THE TOOL: a level row seeds its Master column in `value` and the write-back header in "
      "`label` — the two things the reader takes from it",
      seeded(rows, "level", "Med 2", "value") == "med_2_exp_date"
      and seeded(rows, "level", "Med 2", "label") == "Med 2 Exp Date",
      [r for r in rows if r[mint.HEADER.index("name")] == "Med 2"])


# ── 16 · the tool RE-RUN over a catalogue somebody emptied ─────────────────
# The repair case, and the one the tool used to make worse: with the pointer
# already in the depot it read row 1, found nothing, and — because "no header"
# was spelled `[]` rather than `None` — never stamped one. seed() then appended
# the first SETTING row into row 1, and the reader, finding no `kind`/`name`
# columns, refused the catalogue permanently. The run printed success.
def drive_mint(start_grid):
    """Run the real mint over a fake Sheets API; answer the grid it leaves."""
    grid = [list(r) for r in start_grid]
    house = "1houseFakeCatalogue000000000"
    ess, apps = mint.ESSENCIAL_ID, "1appsBookFake"
    facts = [["f", "props.HUB_HOUSE_MEDDEL_CATALOG_ID", house, "",
              "switchboard:props.HUB_HOUSE_MEDDEL_CATALOG_ID", "", "", "", ""],
             ["f", "moved.meddel_catalog", "on", "",
              "switchboard:moved.meddel_catalog", "", "", "", ""],
             ["f", "__schema", json.dumps(mint.HEADER, separators=(",", ":")), "",
              "schema:meddel_catalog.header", "", "", "", ""],
             ["f", "props.HUB_APPS_BOOK_ID", apps, "",
              "switchboard:props.HUB_APPS_BOOK_ID", "", "", "", ""]]
    said = []

    def fake_api(url, payload=None, method="GET", tries=6):
        import urllib.parse as up
        u = up.unquote(url)
        if ess in u and "'Facts'!A2" in u:
            return {"values": facts}
        if ess in u and "'Facts'!A1:append" in u:
            facts.extend(payload["values"])
            return {}
        if ess in u and "'Registry'!A2" in u:
            return {"values": [["data.meddel_catalog", house, "on", "note"]]}
        if apps in u:
            return {"values": [["key", "value"]]}
        if house in u and "'meddel_catalog'!1:1" in u:
            return {"values": [grid[0]] if grid else []}
        if house in u and "'meddel_catalog'!A1:Z" in u:
            return {"values": [list(r) for r in grid]}
        if house in u and "'meddel_catalog'!A1" in u and method == "PUT":
            if not grid:
                grid.append([])
            grid[0] = list(payload["values"][0])
            said.append("header stamped")
            return {}
        if house in u and "'meddel_catalog'!A1:append" in u:
            grid.extend([list(r) for r in payload["values"]])
            said.append("rows appended")
            return {}
        if u.startswith(mint.D):
            return {}
        raise AssertionError("the tool called something the test does not fake: " + u[:160])

    real_api, real_sa = mint.api, mint.sa_email
    mint.api, mint.sa_email = fake_api, (lambda: "")
    try:
        mint.mint({r[4]: r[2] for r in facts}, "2026-01-01T00:00:00Z", "",
                  {k: s for k, s, _n in mint.SETTINGS}, False)
    finally:
        mint.api, mint.sa_email = real_api, real_sa
    return grid, said


emptied, said = drive_mint([])
head = [str(h).strip() for h in (emptied[0] if emptied else [])]
check("THE TOOL, RE-RUN OVER AN EMPTIED CATALOGUE, repairs the header row before it seeds — a "
      "house whose row 1 is blank is a house to repair, not one to follow",
      head == list(mint.HEADER) and "header stamped" in said, (head, said))
check("THE TOOL, RE-RUN OVER AN EMPTIED CATALOGUE, leaves a sheet the reader can READ — the "
      "first setting row landed under the header, not in place of it",
      "kind" in head and "name" in head
      and len(emptied) == 1 + len(mint.SETTINGS) + len(mint.LEVELS) + len(mint.STATUSES)
      and str(emptied[1][head.index("kind")]) in ("setting", "level", "active_status"),
      (head, emptied[:2]))

kept, said2 = drive_mint([list(mint.HEADER),
                          ["mdc_setting_windowdays", "t", "t", "setting", "windowDays", "90",
                           "", "", "the business changed this"]])
check("THE TOOL, RE-RUN OVER A HEALTHY CATALOGUE, still never re-stamps the header and never "
      "rewrites a row somebody edited",
      "header stamped" not in said2
      and [str(c) for c in kept[0]] == list(mint.HEADER)
      and kept[1][5] == "90"
      and len(kept) == 1 + len(mint.SETTINGS) + len(mint.LEVELS) + len(mint.STATUSES),
      (said2, kept[:2], len(kept)))

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for f in results["failed"]:
    print(f"  FAILED: {f}")
sys.exit(1 if results["failed"] else 0)
