#!/usr/bin/env python3
"""
THE IST SETTINGS — one declaration, three checks that must agree, and every
reader held to what a cell says.

  1. ONE DECLARATION. server/ist_config_defaults.json is the only place a key,
     its type, its limits, its shipped value and its note are written. The
     Apps Script block is generated from it, the SPA imports it, the relay, the
     mint tool and the rebuild read it, and the floors that must stay constants
     (Certs.gs, the relay's expiring window) are held equal to it here.

  2. ONE CHECK, THREE LANGUAGES. The same table of cells runs through
     server/ist_config.py, apps-script/IstConfig.gs and
     src/lib/istConfigDeclaration.ts; a cell one of them refuses and another
     accepts fails this file.

  3. EVERY READER. Each key is read at its shipped value when the cell is
     absent, a refused cell answers the shipped value and is reported, and an
     edited cell changes what the reader does — the rebuild, the relay's
     first-shift gate, the wellbeing board. The Apps Script readers are held
     in SelfTest.gs (node tools/run-selftest.mjs) and the screens in
     tests/spa/ist-config.test.ts.

Run: python3 tools/test-ist-config.py
"""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
import types
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent

results = {"ok": 0, "failed": []}


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        results["ok"] += 1
        print(f"ok   {name}")
    else:
        results["failed"].append(name)
        print(f"FAIL {name}{(' — ' + str(detail)[:700]) if detail else ''}")


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# psycopg2 belongs to the relay's image; stood in for so the modules import, and it refuses to connect
if "psycopg2" not in sys.modules:
    fake_pg = types.ModuleType("psycopg2")

    class _Error(Exception):
        pass

    fake_pg.Error = _Error
    fake_pg.connect = lambda *_a, **_k: (_ for _ in ()).throw(
        AssertionError("the test tried to reach a database"))
    extras = types.ModuleType("psycopg2.extras")
    extras.RealDictCursor = object
    extras.Json = lambda x: x
    fake_pg.extras = extras
    sys.modules["psycopg2"] = fake_pg
    sys.modules["psycopg2.extras"] = extras

sys.path.insert(0, str(ROOT / "server"))
import ist_config as ic  # noqa: E402

DECL = json.loads((ROOT / "server" / "ist_config_defaults.json").read_text(encoding="utf-8"))
KEYS = [d["key"] for d in DECL["keys"]]
SHIPPED = {d["key"]: str(d["value"]) for d in DECL["keys"]}
NEW_KEYS = ("ist_trained_scope", "ist_valid_days", "ist_trainer_must_be_free",
            "ist_trainer_when_no_hm", "ist_assigner_owns_training", "ist_pair_requires_overlap",
            "ist_roster_lookback_days", "ist_cert_tracker_statuses", "ist_cert_mais_statuses",
            "ist_cert_source_fields", "ist_requirements_window", "ist_cert_status_tints",
            "ist_matrix_page_size", "ist_dashboard_months", "ist_notice_repeats")


# ---------------------------------------------------------------------------
# node: the Apps Script file and the SPA module, evaluated rather than matched
# ---------------------------------------------------------------------------

GS_SANDBOX = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = {
  console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN, parseInt,
  parseFloat, isFinite, Error,
  HUB_POLICY: {}, HUB_ACTIONS: {},
  hubDenied_: () => ({ status: 403 }),
  hubCellSafe_: (v) => v,
  hubSysLog_: () => {},
  hubTabEnsure_: () => { throw new Error('no sheets here'); },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  CacheService: { getScriptCache: () => null },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
const out = vm.runInContext('(function (INPUT) {' + BODY + '})', sandbox)(INPUT);
process.stdout.write(JSON.stringify(out));
"""


def run_gs(files: list[str], body: str, payload) -> object:
    js = (f"const FILES = {json.dumps([str(ROOT / 'apps-script' / f) for f in files])};\n"
          f"const BODY = {json.dumps(body)};\nconst INPUT = {json.dumps(payload)};\n" + GS_SANDBOX)
    out = subprocess.run(["node", "-"], input=js, text=True, capture_output=True, timeout=120)
    if out.returncode != 0:
        sys.exit(f"the Apps Script files would not evaluate: {out.stderr.strip()[:600]}")
    return json.loads(out.stdout)


TS_RUNNER = r"""
const esbuild = require(ROOT + '/node_modules/esbuild');
const built = esbuild.buildSync({
  entryPoints: [ROOT + '/src/lib/istConfigDeclaration.ts'], bundle: true, write: false,
  format: 'cjs', platform: 'node', logLevel: 'silent',
});
const module = { exports: {} };
new Function('module', 'exports', 'require', built.outputFiles[0].text)(module, module.exports, require);
const M = module.exports;
const out = (function (INPUT) { BODY })(INPUT);
process.stdout.write(JSON.stringify(out));
"""


def run_ts(body: str, payload) -> object:
    js = (f"const ROOT = {json.dumps(str(ROOT))};\nconst INPUT = {json.dumps(payload)};\n"
          + TS_RUNNER.replace("BODY", body))
    out = subprocess.run(["node", "-"], input=js, text=True, capture_output=True, timeout=120,
                         cwd=str(ROOT))
    if out.returncode != 0:
        sys.exit(f"the SPA declaration would not evaluate: {out.stderr.strip()[:600]}")
    return json.loads(out.stdout)


# ---------------------------------------------------------------------------
# 1. ONE DECLARATION
# ---------------------------------------------------------------------------
print("\n1. ONE DECLARATION")

TYPES = {"list", "pairs", "text", "template", "int", "yesno", "choice", "course"}
group_ids = [g["id"] for g in DECL["groups"]]
check("declaration: every key is declared once", len(KEYS) == len(set(KEYS)),
      [k for k in KEYS if KEYS.count(k) > 1])
check("declaration: every proposed key is declared",
      all(k in SHIPPED for k in NEW_KEYS), [k for k in NEW_KEYS if k not in SHIPPED])
check("declaration: every key has a known type, a declared group and a note",
      all(d.get("type") in TYPES and d.get("group") in group_ids and d.get("note") for d in DECL["keys"]),
      [d["key"] for d in DECL["keys"]
       if not (d.get("type") in TYPES and d.get("group") in group_ids and d.get("note"))])
check("declaration: a whole number declares its range, and its shipped value sits inside it",
      all(d.get("min") is not None and d.get("max") is not None
          and d["min"] <= int(d["value"]) <= d["max"] for d in DECL["keys"] if d["type"] == "int"))
check("declaration: a choice declares its words, and its shipped value is one of them",
      all(d.get("allowed") and d["value"] in d["allowed"] for d in DECL["keys"] if d["type"] == "choice"))
check("declaration: every shipped value passes its own check",
      all(not ic.check(k, v) for k, v in SHIPPED.items()),
      {k: ic.check(k, v) for k, v in SHIPPED.items() if ic.check(k, v)})
check("declaration: the first-shift rules have a Settings group of their own",
      {"ist_trained_scope", "ist_valid_days", "ist_trainer_must_be_free", "ist_trainer_when_no_hm",
       "ist_assigner_owns_training"} == {d["key"] for d in DECL["keys"] if d["group"] == "first_shift"})

# every new key ships today's behaviour
TODAY = {"ist_trained_scope": "house", "ist_valid_days": "0", "ist_trainer_must_be_free": "yes",
         "ist_trainer_when_no_hm": "approver", "ist_assigner_owns_training": "yes",
         "ist_pair_requires_overlap": "yes", "ist_roster_lookback_days": "0",
         "ist_cert_tracker_statuses": "expired=expired, *=expiring",
         "ist_cert_mais_statuses": "certified=certified, ERROR*=skip, *=expired",
         "ist_requirements_window": "own",
         "ist_cert_status_tints": "valid=mint, expiring=amber, expired=pink, missing=pink",
         "ist_matrix_page_size": "12", "ist_dashboard_months": "12", "ist_notice_repeats": "no"}
check("declaration: every new key ships the behaviour the code had",
      all(SHIPPED[k] == v for k, v in TODAY.items()),
      {k: SHIPPED[k] for k, v in TODAY.items() if SHIPPED[k] != v})
check("declaration: the MAIS name join ships the one column Certs.gs always read",
      (ic.pairs_of(SHIPPED["ist_cert_source_fields"]) or ([], {}))[1]["mais.name"] == "name")
check("declaration: the coverage labels the calendar generator knew are in the shipped list",
      {"AGENCY", "VACANT", "TBA", "PRN"} <= set(ic.bits(SHIPPED["ist_non_person_names"])))
NOTES = " ".join(d["note"] for d in DECL["keys"]) + " ".join(g["blurb"] for g in DECL["groups"])
check("declaration: the help text names no script, no property and no fixed course list",
      not re.search(r"tools/|\.py\b|\.gs\b|a property|PUT AWAY|\(dodd, cpr, med1", NOTES),
      re.findall(r"tools/\S+|\S+\.py|\S+\.gs|a property|PUT AWAY", NOTES))
check("declaration: no note promises that anything else simply 'keeps' a value the editor refuses",
      "anything else keeps" not in NOTES)

# the generated Apps Script block is exactly what the emitter prints
emitted = subprocess.run([sys.executable, str(ROOT / "tools" / "emit_ist_config_gs.py")],
                         text=True, capture_output=True, timeout=60).stdout
gs_src = (ROOT / "apps-script" / "IstConfig.gs").read_text(encoding="utf-8")
m = re.search(r"/\* ── BEGIN generated[\s\S]*?/\* ── END generated declaration ── \*/", gs_src)
check("apps script: the block in IstConfig.gs is the emitter's output, byte for byte",
      bool(m) and m.group(0) + "\n" == emitted,
      "run python3 tools/emit_ist_config_gs.py and paste its block between the markers")

gs_decl = run_gs(["IstConfig.gs"],
                 "return { keys: IST_CONFIG_DEFAULTS, groups: IST_CONFIG_GROUPS, tints: IST_CONFIG_TINTS,"
                 " tab: IST_CONFIG_TAB };", None)
check("apps script: the evaluated declaration equals the JSON, field for field",
      gs_decl["keys"] == DECL["keys"] and gs_decl["groups"] == DECL["groups"]
      and gs_decl["tints"] == DECL["tints"] and gs_decl["tab"] == DECL["tab"])

decl_ts = (ROOT / "src" / "lib" / "istConfigDeclaration.ts").read_text(encoding="utf-8")
check("spa: the declaration module imports the JSON rather than typing a copy",
      "from '../../server/ist_config_defaults.json'" in decl_ts
      and "OPEN, NEW, FAMILY" not in decl_ts and "dodd=DODD 8-Hour" not in decl_ts)
ts_decl = run_ts("return { shipped: M.IST_CONFIG_SHIPPED, keys: M.IST_CONFIG_KEYS, groups: M.IST_CONFIG_GROUPS };", None)
check("spa: the evaluated shipped values equal the JSON", ts_decl["shipped"] == SHIPPED
      and ts_decl["keys"] == KEYS and ts_decl["groups"] == DECL["groups"])
spa_lib = (ROOT / "src" / "lib" / "istConfig.ts").read_text(encoding="utf-8")
check("spa: the reader holds no value of its own",
      "OPEN, NEW, FAMILY" not in spa_lib and "owed=amber" not in spa_lib
      and "IST_CONFIG_SHIPPED: Record<string, string> = {" not in spa_lib)

MINT = load_module(ROOT / "tools" / "mint_ist_config_house.py", "mint_ist_config_house")
check("mint tool: seeds one row per declared key, value and note as declared",
      MINT.ROWS == [(d["key"], str(d["value"]), d["note"]) for d in DECL["keys"]])

REBUILD = load_module(ROOT / "tools" / "rebuild_ist.py", "rebuild_ist")
check("rebuild: its floor is the declaration", REBUILD.IST_CONFIG_SHIPPED == SHIPPED)
rebuild_src = (ROOT / "tools" / "rebuild_ist.py").read_text(encoding="utf-8")
check("rebuild: the estate file is the depot's CERT_SOURCE_ID, never a literal id",
      "switchboard:props.CERT_SOURCE_ID" in rebuild_src
      and "1Gqq08-3nZgKDoCLDnIHg16qTtdzeSZt9aNQRRi5y45s" not in rebuild_src)
check("rebuild: the depot pointer is read as Apps Script reads it",
      REBUILD.cert_source_id({"switchboard:props.CERT_SOURCE_ID": " abc "}) == "abc"
      and REBUILD.cert_source_id({}) == "")

import behavior_slices as bs  # noqa: E402

check("relay: the wellbeing board's floor is the declared window",
      bs._EXPIRING_DAYS == int(SHIPPED["ist_cert_expiring_days"]))

certs = run_gs(["IstConfig.gs", "Certs.gs"],
               "return { labels: CERT_LABELS, master: CERT_MASTER_COLUMNS, training: CERT_TRAINING_KEYS,"
               " days: CERT_EXPIRING_DAYS, tabs: [CERT_TRAININGS_TAB, CERT_MAIS_TAB, CERT_MASTER_TAB] };",
               None)
pairs = lambda k: (ic.pairs_of(SHIPPED[k]) or ([], {}))[1]  # noqa: E731
tabs = pairs("ist_cert_source_tabs")
check("apps script: the Certs.gs load-order floor equals the declaration",
      certs["labels"] == pairs("ist_cert_labels") and certs["master"] == pairs("ist_cert_master_columns")
      and certs["training"] == pairs("ist_cert_training_keys")
      and str(certs["days"]) == SHIPPED["ist_cert_expiring_days"]
      and certs["tabs"] == [tabs["trainings"], tabs["mais"], tabs["master"]], json.dumps(certs)[:400])

registry = (ROOT / "src" / "registry" / "apps-employeetracker.ts").read_text(encoding="utf-8")
compliance = (ROOT / "src" / "registry" / "apps-compliance.ts").read_text(encoding="utf-8")
check("spa: the shipped schemas read the declared values, not a copy",
      "cfgPairsOf(IST_CONFIG_SHIPPED.ist_status_tints)" in registry
      and "IST_CONFIG_SHIPPED.ist_page_size" in registry
      and "cfgPairsOf(IST_CONFIG_SHIPPED.ist_cert_status_tints)" in compliance
      and "IST_CONFIG_SHIPPED.ist_matrix_page_size" in compliance
      and "{ owed: 'amber', done: 'mint' }" not in registry)
check("spa: no screen promises a 30-day window the platform does not use",
      "≤30d" not in compliance and "≤ 30 days" not in compliance)


# ---------------------------------------------------------------------------
# 2. ONE CHECK, THREE LANGUAGES
# ---------------------------------------------------------------------------
print("\n2. ONE CHECK, THREE LANGUAGES")

CASES: list[tuple[str, str, bool, list[str] | None]] = []
for k, v in SHIPPED.items():
    CASES.append((k, v, False, None))
    CASES.append((k, "", False, None))
CASES += [
    ("ist_non_person_names", " , ; ", True, None),
    ("ist_non_person_names", "OPEN, TBD", False, None),
    ("ist_valid_days", "abc", True, None), ("ist_valid_days", "-1", True, None),
    ("ist_valid_days", "3651", True, None), ("ist_valid_days", "3.5", True, None),
    ("ist_valid_days", "365", False, None), ("ist_valid_days", "0", False, None),
    ("ist_cert_expiring_days", "0", True, None), ("ist_cert_expiring_days", "30", False, None),
    ("ist_page_size", "4", True, None), ("ist_page_size", "201", True, None),
    ("ist_matrix_page_size", "twelve", True, None), ("ist_matrix_page_size", "40", False, None),
    ("ist_dashboard_months", "2", True, None), ("ist_dashboard_months", "24", False, None),
    ("ist_roster_lookback_days", "-5", True, None), ("ist_roster_lookback_days", "90", False, None),
    ("ist_trainer_must_be_free", "maybe", True, None), ("ist_trainer_must_be_free", "NO", False, None),
    ("ist_assigner_owns_training", "true", True, None), ("ist_pair_requires_overlap", "no", False, None),
    ("ist_trained_scope", "everyone", True, None), ("ist_trained_scope", "Client", False, None),
    ("ist_trainer_when_no_hm", "director", True, None), ("ist_trainer_when_no_hm", "refuse", False, None),
    ("ist_requirements_window", "30", True, None), ("ist_requirements_window", "ist", False, None),
    ("ist_gate_certification", "DODD", True, None), ("ist_gate_certification", "cpr", False, None),
    ("ist_gate_certification", "bbp", True, None), ("ist_gate_certification", "bbp", False, ["dodd", "bbp"]),
    ("ist_cert_labels", "nonsense", True, None), ("ist_cert_labels", "dodd=", True, None),
    ("ist_cert_labels", "dodd=DODD, bbp=Bloodborne", False, None),
    ("ist_cert_source_tabs", "roster=Roster", True, None),
    ("ist_cert_source_tabs", "master=Master 2027", False, None),
    ("ist_status_tints", "owed=fuchsia, done=mint", True, None),
    ("ist_status_tints", "owed=pink, done=green", False, None),
    ("ist_cert_status_tints", "valid=mint, unknown=pink", True, None),
    ("ist_cert_status_tints", "expiring=peach", False, None),
    ("ist_cert_tracker_statuses", "*=valid", True, None),
    ("ist_cert_tracker_statuses", "late=expired, *=expiring", False, None),
    ("ist_cert_mais_statuses", "certified=ok", True, None),
    ("ist_cert_mais_statuses", "active=certified, *=expired", False, None),
    ("ist_cert_source_fields", "master.name=Employee Name", True, None),
    ("ist_cert_source_fields", "roster.name=name", True, None),
    ("ist_cert_source_fields", "master.name=full_name|employee", False, None),
    ("ist_note_expired", "{name} expired", True, None),
    ("ist_note_expired", "{cert} lapsed on {date}", False, None),
    ("ist_note_no_certification", "no certificate ({date})", True, None),
    ("ist_stale_marker", "house closed", False, None),
    ("not_a_key", "x", True, None),
    # a coverage word short enough to sit inside real names
    ("ist_non_person_contains", "a", True, None), ("ist_non_person_contains", "e, i", True, None),
    ("ist_non_person_contains", "workshop, an", True, None),
    ("ist_non_person_contains", "workshop, cover", False, None),
    # MAIS words that would make a lapsed or broken record read valid
    ("ist_cert_mais_statuses", "*=certified", True, None),
    ("ist_cert_mais_statuses", "expired=certified, revoked=certified", True, None),
    ("ist_cert_mais_statuses", "ERROR*=certified", True, None),
    ("ist_cert_mais_statuses", "error 500=certified", True, None),
    ("ist_cert_mais_statuses", "e*=certified", True, None),
    ("ist_cert_mais_statuses", "cert*=certified, *=expired", False, None),
    ("ist_cert_mais_statuses", "Revoked=expired, *=expired", False, None),
    # the course joins name course keys, and the Master join names headers as Certs.gs keys them
    ("ist_cert_master_columns", "DODD 8-Hour Exp=dodd", True, None),
    ("ist_cert_master_columns", "dodd_8_hour_exp=DODD", True, None),
    ("ist_cert_master_columns", "dodd_8hr_exp=dodd, cpr_exp_date=cpr", False, None),
    ("ist_cert_master_columns", "bbp_exp_date=bbp", True, None),
    ("ist_cert_master_columns", "bbp_exp_date=bbp", False, ["dodd", "bbp"]),
    ("ist_cert_training_keys", "cpr exp date=CPR", True, None),
    ("ist_cert_training_keys", "CPR Exp Date=cpr", False, None),
    ("ist_matrix_columns", "DODD, CPR", True, None), ("ist_matrix_columns", "mandt, money", False, None),
    ("ist_matrix_columns", "mandt", False, ["dodd"]),
    ("ist_matrix_labels", "DODD=8-Hr", True, None), ("ist_matrix_labels", "dodd=8-Hr", False, None),
    # numbers: ASCII digits, and the key's own unit may follow
    ("ist_valid_days", "90 days", False, None), ("ist_valid_days", "1 day", False, None),
    ("ist_valid_days", "90 months", True, None), ("ist_valid_days", "３０", True, None),
    ("ist_page_size", "25 rows", True, None), ("ist_dashboard_months", "6 months", False, None),
    ("ist_cert_expiring_days", "90days", False, None),
    ("ist_notice_repeats", "yes", False, None), ("ist_notice_repeats", "sometimes", True, None),
]

py_verdicts = [ic.check(k, v, cat) for k, v, _want, cat in CASES]
payload = [[k, v, cat] for k, v, _want, cat in CASES]
gs_verdicts = run_gs(["IstConfig.gs"],
                     "return INPUT.map(function (c) { return istConfigCheck_(c[0], c[1], c[2] || undefined); });",
                     payload)
ts_verdicts = run_ts("return INPUT.map((c) => M.cfgCheck(c[0], c[1], c[2] || undefined));", payload)

wrong_py = [(k, v, why) for (k, v, want, _c), why in zip(CASES, py_verdicts) if bool(why) != want]
check(f"check: the relay's check refuses exactly the {sum(1 for c in CASES if c[2])} bad cells of "
      f"{len(CASES)}", not wrong_py, wrong_py)
split = [(k, v, a, b, c) for (k, v, _w, _c), a, b, c in zip(CASES, py_verdicts, gs_verdicts, ts_verdicts)
         if bool(a) != bool(b) or bool(a) != bool(c)]
check("check: Apps Script, the relay and the SPA refuse the same cells", not split, split)
check("check: every refusal says why, in all three",
      all((not want) or (a and b and c) for (_k, _v, want, _c), a, b, c
          in zip(CASES, py_verdicts, gs_verdicts, ts_verdicts)))

RAW = {"ist_valid_days": "abc", "ist_trained_scope": "client", "ist_status_tints": "owed=fuchsia",
       "ist_cert_labels": "dodd=DODD, bbp=Bloodborne", "ist_gate_certification": "bbp",
       "ist_page_size": "", "ist_invented": "x"}
py_values, py_problems = ic.resolve(RAW)
ts_resolved = run_ts("return M.resolveIstValues(INPUT);", RAW)
gs_problems = run_gs(["IstConfig.gs"], "return istConfigProblems_(INPUT);", RAW)
check("resolve: a refused cell answers its shipped value, and is reported",
      py_values["ist_valid_days"] == "0" and "ist_valid_days" in py_problems
      and py_values["ist_status_tints"] == SHIPPED["ist_status_tints"])
check("resolve: a usable cell answers itself — a course added in the same map is a valid gate",
      py_values["ist_trained_scope"] == "client" and py_values["ist_gate_certification"] == "bbp")
check("resolve: a blank cell is the shipped value and is not a problem",
      py_values["ist_page_size"] == "25" and "ist_page_size" not in py_problems)
check("resolve: the SPA resolves the same map to the same values and problems",
      ts_resolved["values"] == py_values and set(ts_resolved["problems"]) == set(py_problems),
      json.dumps({"ts": sorted(ts_resolved["problems"]), "py": sorted(py_problems)}))
check("resolve: Apps Script reports the same problems", set(gs_problems) == set(py_problems),
      json.dumps({"gs": sorted(gs_problems), "py": sorted(py_problems)}))
check("resolve: nothing absent is a problem — every key reads its shipped value",
      ic.resolve({}) == (SHIPPED, {}))

# a cell typed straight into the sheet: one stray entry never throws the whole cell away
TOLERANT = {"ist_non_person_contains": "a, workshop", "ist_status_tints": "owed=fuchsia, done=green",
            "ist_cert_labels": "dodd=DODD 8-Hour, cpr=, bbp=Bloodborne",
            "ist_cert_mais_statuses": "*=certified, certified=certified, ERROR*=skip",
            "ist_cert_source_tabs": "roster=Roster, master=Master 2027",
            "ist_valid_days": "90 days", "ist_cert_expiring_days": "60 (renewal)",
            "ist_gate_certification": "cpr", "ist_gate_certification_label": "CPR"}
py_t = ic.resolve(TOLERANT)
ts_t = run_ts("return M.resolveIstValues(INPUT);", TOLERANT)
gs_t = run_gs(["IstConfig.gs"], "return istConfigResolve_(INPUT);", TOLERANT)
check("resolve: a list or pairs cell keeps its usable entries, and is still reported",
      py_t[0]["ist_non_person_contains"] == "workshop" and py_t[0]["ist_status_tints"] == "done=green"
      and py_t[0]["ist_cert_mais_statuses"] == "certified=certified, ERROR*=skip"
      and py_t[0]["ist_cert_source_tabs"] == "master=Master 2027"
      and py_t[0]["ist_cert_labels"] == "dodd=DODD 8-Hour, bbp=Bloodborne"
      and {"ist_non_person_contains", "ist_status_tints", "ist_cert_mais_statuses",
           "ist_cert_source_tabs", "ist_cert_labels"} <= set(py_t[1]), json.dumps(py_t[0])[:600])
check("resolve: a number with its own unit reads as the number; a number with a remark is refused",
      py_t[0]["ist_valid_days"] == "90" and "ist_valid_days" not in py_t[1]
      and py_t[0]["ist_cert_expiring_days"] == "60" and "ist_cert_expiring_days" in py_t[1])
check("resolve: a gate the shrunk course list refuses takes its label back with it",
      py_t[0]["ist_gate_certification"] == "dodd" and py_t[0]["ist_gate_certification_label"] == "DODD"
      and "ist_gate_certification_label" in py_t[1])
check("resolve: the SPA and Apps Script resolve a hand-typed tab to the same values and problems",
      ts_t["values"] == py_t[0] and gs_t["values"] == py_t[0]
      and set(ts_t["problems"]) == set(py_t[1]) == set(gs_t["problems"]),
      json.dumps({"ts": sorted(k for k in py_t[0] if ts_t["values"].get(k) != py_t[0][k]),
                  "gs": sorted(k for k in py_t[0] if gs_t["values"].get(k) != py_t[0][k])}))
check("reader: text() answers a raw map the way resolve() does, the label pairing included",
      all(ic.text(TOLERANT, k) == py_t[0][k] for k in KEYS),
      [k for k in KEYS if ic.text(TOLERANT, k) != py_t[0][k]])
check("reader: a fullwidth number is not a number on the relay either",
      ic.int_value("ist_valid_days", "３０") is None
      and ic.int_of({"ist_valid_days": "３０"}, "ist_valid_days") == 0)

# the save door: every key the save touches, and every key a course-list change pulls out from under
SAVES = [
    ("shrink the list under the gate", {"ist_cert_labels": "cpr=CPR"}, {"ist_gate_certification": "cpr"}, False),
    ("shrink the list under the shipped gate", {"ist_cert_labels": "cpr=CPR"}, {}, True),
    ("shrink the list under an edited gate", {"ist_cert_labels": "dodd=DODD"},
     {"ist_gate_certification": "cpr"}, True),
    ("shrink the list and move the gate in one save",
     {"ist_cert_labels": "cpr=CPR", "ist_gate_certification": "cpr"}, {}, False),
    ("add a course and point the gate at it", {"ist_cert_labels": SHIPPED["ist_cert_labels"] + ", bbp=B",
                                               "ist_gate_certification": "bbp"}, {}, False),
    ("a gate on a course the tab already added", {"ist_gate_certification": "fa"},
     {"ist_cert_labels": SHIPPED["ist_cert_labels"] + ", fa=First Aid"}, False),
    ("a gate on a course the tab does not carry", {"ist_gate_certification": "fa"}, {}, True),
    ("drop a course the Master join still names", {"ist_cert_labels": "dodd=DODD, cpr=CPR"}, {}, False),
    ("a short coverage word", {"ist_non_person_contains": "a"}, {}, True),
    ("every MAIS record certified", {"ist_cert_mais_statuses": "*=certified"}, {}, True),
]
py_s = [ic.save_problems(v, s) for _n, v, s, _w in SAVES]
payload_s = [[v, s] for _n, v, s, _w in SAVES]
ts_s = run_ts("return INPUT.map((c) => M.cfgSaveProblems(c[0], c[1]));", payload_s)
gs_s = run_gs(["IstConfig.gs"], "return INPUT.map(function (c) { return istConfigSaveProblems_(c[0], c[1]); });",
              payload_s)
wrong_s = [n for (n, _v, _s, want), got in zip(SAVES, py_s) if bool(got) != want]
check("save door: refuses exactly the saves that would orphan the gate or open a hole", not wrong_s,
      json.dumps([[n, g] for (n, *_r), g in zip(SAVES, py_s) if n in wrong_s])[:700])
check("save door: Apps Script, the relay and the SPA refuse the same saves for the same keys",
      [[p.split(":")[0] for p in x] for x in py_s] == [[p.split(":")[0] for p in x] for x in ts_s]
      == [[p.split(":")[0] for p in x] for x in gs_s], json.dumps({"py": py_s, "ts": ts_s, "gs": gs_s})[:700])
check("save door: a shrunk list names the gate it would orphan",
      any(p.startswith("ist_gate_certification:") for p in py_s[1]), py_s[1])


# ---------------------------------------------------------------------------
# 3. THE REBUILD — the writer that fills the live table
# ---------------------------------------------------------------------------
print("\n3. THE REBUILD")

WAS_IN_CODE = (
    "   and upper(staff_name) not in ('OPEN', 'NEW', 'FAMILY', 'LOCATION', 'NURSE', 'STAFF', 'TBD', "
    "'AGENCY', 'VACANT', 'TBA', 'PRN')\n"
    "   and staff_name not ilike '%workshop%'"
)
check("roster: the shipped cells rebuild the clause that was hardcoded, with the generator's four labels",
      REBUILD.not_a_person_sql(SHIPPED) == WAS_IN_CODE, REBUILD.not_a_person_sql(SHIPPED))
check("roster: a coverage word under four letters never reaches the SQL",
      "'%an%'" not in REBUILD.not_a_person_sql(dict(SHIPPED, ist_non_person_contains="workshop, an"))
      and "'%workshop%'" in REBUILD.not_a_person_sql(dict(SHIPPED, ist_non_person_contains="workshop, an")))
clause = REBUILD.not_a_person_sql(dict(SHIPPED, ist_non_person_names="OPEN, TBD",
                                       ist_non_person_contains="workshop, training"))
check("roster: an edited list reaches the SQL", "not in ('OPEN', 'TBD')" in clause
      and "'%training%'" in clause, clause)
check("roster: an empty cell is the shipped list, never no filter",
      REBUILD.not_a_person_sql(dict(SHIPPED, ist_non_person_names="", ist_non_person_contains=""))
      == WAS_IN_CODE)
check("roster: a cell that parses to nothing is refused and the shipped list answers",
      "'OPEN'" in REBUILD.not_a_person_sql(dict(SHIPPED, ist_non_person_names=" , ; , ")))
check("roster: a quote in a cell is escaped, not executed",
      "'O''BRIEN COVER'" in REBUILD.not_a_person_sql(dict(SHIPPED, ist_non_person_names="O'BRIEN COVER")))

check("lookback: 0 reads the whole history — the SQL the table was always built from",
      REBUILD.lookback_sql(SHIPPED) == "" and "shift_date >=" not in REBUILD.roster_sql(SHIPPED))
check("lookback: a number floors both roster reads",
      "shift_date >= current_date - 90" in REBUILD.roster_sql(dict(SHIPPED, ist_roster_lookback_days="90"))
      and "shift_date >= current_date - 90" in REBUILD.shift_days_sql(
          dict(SHIPPED, ist_roster_lookback_days="90")))
check("lookback: a refused number is the whole history, and is reported",
      REBUILD.lookback_sql(dict(SHIPPED, ist_roster_lookback_days="-5")) == ""
      and "ist_roster_lookback_days" in ic.resolve({"ist_roster_lookback_days": "-5"})[1])

TODAY_D = date(2026, 6, 1)
ROSTER = dict(first_at={("ABD1", "Ana Lopez"): "2025-01-05", ("ABD1", "Ben Gone"): "2024-01-01"},
              days={("ABD1", "Ana Lopez"): ["2025-01-05", "2026-05-01"],
                    ("ABD1", "Ben Gone"): ["2024-01-01", "2024-02-01"]},
              by_house={"ABD1": ["Cara Client"]}, client_start={"cara_client": "2025-06-01"},
              existing=set(), people={"ana_lopez": {"email": "a@x"}}, certs={}, certs_read=False,
              now="t", today=TODAY_D)
rows, skipped, _unknown = REBUILD.new_rows(SHIPPED, **ROSTER)
check("overlap: yes — somebody who left before the client arrived owes nothing",
      [r[3] for r in rows] == ["Ana Lopez"] and skipped == 1, f"{[r[3] for r in rows]} {skipped}")
check("overlap: the date owed is the later of the first shift and the client's start",
      rows and rows[0][9] == "2025-06-01" and rows[0][10] == ic.IST_STATUS_OWED)
rows_no, skipped_no, _u = REBUILD.new_rows(dict(SHIPPED, ist_pair_requires_overlap="no"), **ROSTER)
check("overlap: no — everybody ever rostered at the house owes it",
      sorted(r[3] for r in rows_no) == ["Ana Lopez", "Ben Gone"] and skipped_no == 0)
rows_bad, skipped_bad, _u = REBUILD.new_rows(dict(SHIPPED, ist_pair_requires_overlap="sometimes"), **ROSTER)
check("overlap: a refused cell keeps the shipped yes", skipped_bad == 1 and len(rows_bad) == 1)


def estate_rows(header, *rows):
    return (header, [dict(zip(header, r)) for r in rows])


TABS = {
    "master": estate_rows(["Employee", "DODD 8-Hour Exp", "CPR Exp Date", "Full Name"],
                          ["Ana Lopez", "2027-01-01", "2020-01-01", "Ana Lopez"],
                          ["Ben Gone", "", "", "Ben Gone"],
                          ["Cy Odd", "someday", "", "Cy Odd"]),
    "trainings": estate_rows(["Name", "Training", "Status", "Expiration Date"],
                             ["Ana Lopez", "DODD 8-Hour Exp", "Expired", "2024-03-04"],
                             ["Cy Odd", "DODD 8-Hour Exp", "Upcoming", ""]),
    "mais": estate_rows(["Name", "Status", "Expiration", "Cert Type"],
                        ["Ana Lopez", "Certified", "2027-05-05", "Cat I"],
                        ["Ben Gone", "ERROR 500", "2030-01-01", ""],
                        ["Dee Revoked", "Revoked", "2027-01-01", ""],
                        ["Eve Active", "Active", "2028-01-01", ""]),
}
pic = REBUILD.gate_picture(SHIPPED, TABS)
check("gate: dodd reads the Master column, and the dated tracker outranks it",
      pic.get("ana_lopez") == "2024-03-04", pic)
check("gate: an undated tracker row keeps the Master date rather than claiming none on file",
      pic.get("cy_odd") == "someday", pic)
check("gate: the note says expired, unreadable or none — the three sentences",
      REBUILD.cert_note(SHIPPED, pic.get("ana_lopez"), TODAY_D) == "DODD expired 2024-03-04"
      and REBUILD.cert_note(SHIPPED, pic.get("cy_odd"), TODAY_D) == "DODD date unreadable: someday"
      and REBUILD.cert_note(SHIPPED, pic.get("ben_gone"), TODAY_D) == "no DODD certification on file"
      and REBUILD.cert_note(SHIPPED, "2099-01-01", TODAY_D) == "")
edited_notes = dict(SHIPPED, ist_note_expired="{cert} lapsed {date}", ist_note_unreadable="{cert}? {value}",
                    ist_note_no_certification="{cert} missing", ist_gate_certification_label="D8")
check("gate: edited sentences reach the row",
      REBUILD.cert_note(edited_notes, "2024-03-04", TODAY_D) == "D8 lapsed 2024-03-04"
      and REBUILD.cert_note(edited_notes, "x", TODAY_D) == "D8? x"
      and REBUILD.cert_note(edited_notes, "", TODAY_D) == "D8 missing")
check("gate: a refused sentence is the shipped one",
      REBUILD.cert_note(dict(SHIPPED, ist_note_expired="{who} expired"), "2024-03-04", TODAY_D)
      == "DODD expired 2024-03-04")
pic_cpr = REBUILD.gate_picture(dict(SHIPPED, ist_gate_certification="cpr"), TABS)
check("gate: the cell picks the course — cpr reads the CPR column",
      pic_cpr.get("ana_lopez") == "2020-01-01" and "cy_odd" not in pic_cpr, pic_cpr)
pic_mais = REBUILD.gate_picture(dict(SHIPPED, ist_gate_certification="mais"), TABS)
check("gate: mais reads the MAIS scrape; ERROR rows are skipped as scraper noise",
      pic_mais.get("ana_lopez") == "2027-05-05" and "ben_gone" not in pic_mais, pic_mais)
check("mais statuses: the shipped words — certified, ERROR* skipped, the rest expired",
      REBUILD.state_of(SHIPPED, "ist_cert_mais_statuses", "Certified", "expired") == "certified"
      and REBUILD.state_of(SHIPPED, "ist_cert_mais_statuses", "ERROR 502", "expired") == "skip"
      and REBUILD.state_of(SHIPPED, "ist_cert_mais_statuses", "Revoked", "expired") == "expired")
check("mais statuses: an edited cell changes what a word means",
      REBUILD.state_of(dict(SHIPPED, ist_cert_mais_statuses="active=certified, *=expired"),
                       "ist_cert_mais_statuses", "Active", "expired") == "certified")
check("tracker statuses: expired is expired, every other word expiring — never valid",
      REBUILD.state_of(SHIPPED, "ist_cert_tracker_statuses", "Expired", "expiring") == "expired"
      and REBUILD.state_of(SHIPPED, "ist_cert_tracker_statuses", "Upcoming", "expiring") == "expiring"
      and REBUILD.state_of(dict(SHIPPED, ist_cert_tracker_statuses="*=valid"),
                           "ist_cert_tracker_statuses", "Upcoming", "expiring") == "expiring")
fields_edit = dict(SHIPPED, ist_cert_source_fields="master.name=full_name")
check("source fields: an edited column is the column read; facts left out keep theirs",
      REBUILD.source_field(fields_edit, "master.name") == "full_name"
      and REBUILD.source_field(fields_edit, "mais.status") == "status"
      and REBUILD.gate_picture(fields_edit, TABS).get("ana_lopez") == "2024-03-04")
check("source fields: | tries alternatives and + joins columns",
      REBUILD.field_of({"name": "", "search_first": "Ana", "search_last": "Lopez"},
                       "name|search_first+search_last") == "Ana Lopez"
      and REBUILD.field_of({"employee": "", "name": "Bo"}, "employee|name") == "Bo")

EXISTING = [{"house": "ABD1", "houseStatus": ""}, {"house": "GONE", "houseStatus": ""},
            {"house": "ABD1", "houseStatus": "house closed"}, {"house": "", "houseStatus": ""},
            {"house": "", "houseStatus": "", "staffName": "Ana Lopez"}]
check("stale mark: the cell's word marks rows off the map, clears one that came back, skips blank rows",
      REBUILD.stale_marks(EXISTING, {"ABD1": ["x"]}, "house closed")
      == [(1, "house closed"), (2, ""), (4, "house closed")],
      REBUILD.stale_marks(EXISTING, {"ABD1": ["x"]}, "house closed"))
RENAMED = [{"house": "ABD1", "houseStatus": "house no longer mapped"},
           {"house": "GONE", "houseStatus": "house no longer mapped"},
           {"house": "GONE", "houseStatus": "house closed"}]
check("stale mark: after the word changes, an old-word row that came back is cleared and one still gone re-marked",
      REBUILD.stale_marks(RENAMED, {"ABD1": ["x"]}, "house closed") == [(0, ""), (1, "house closed")],
      REBUILD.stale_marks(RENAMED, {"ABD1": ["x"]}, "house closed"))
fresh_rows = [[""] * 11 + [n] for n in ("", "no DODD certification on file", "DODD expired 2020-01-01")]
check("rebuild: the dry run counts what the Certification cell of the new rows will say",
      REBUILD.note_counts(fresh_rows, SHIPPED) == '1 clear · 1 "no DODD certification on file" · 1 expired or unreadable',
      REBUILD.note_counts(fresh_rows, SHIPPED))


def with_house(rows, raises=False, declared=True):
    depot = {"switchboard:props.HUB_HOUSE_IST_CONFIG_ID": "sheet-id"} if declared else {}
    held = REBUILD.read_house

    def fake(_tok, _sid, _tab):
        if raises:
            raise RuntimeError("the house did not answer")
        return ["key", "value", "note"], rows

    REBUILD.read_house = fake
    try:
        return REBUILD.ist_config("tok", depot), REBUILD.ist_config_problems("tok", depot)
    finally:
        REBUILD.read_house = held


(cfg, src), probs = with_house([{"key": "ist_non_person_names", "value": "OPEN"},
                                {"key": "ist_valid_days", "value": "forever"}])
check("config read: the sheet answers, its value wins, and a key it lacks keeps the shipped value",
      src == "sheet" and cfg["ist_non_person_names"] == "OPEN"
      and cfg["ist_non_person_contains"] == "workshop", f"{src}")
check("config read: a refused cell is the shipped value, and printed as refused",
      cfg["ist_valid_days"] == "0" and "ist_valid_days" in probs)
for label, kw in (("no house declared", {"declared": False}), ("a house that throws", {"raises": True}),
                  ("an empty tab", {})):
    (cfg, src), _p = with_house([], **kw)
    check(f"config read: {label} is named, and the declared values answer",
          src.startswith("shipped") and cfg == SHIPPED, src)
(cfg, src), _p = with_house([{"key": "ist_something_new", "value": "hello"}])
check("config read: a row only in the sheet is carried, not swallowed",
      cfg.get("ist_something_new") == "hello")


# ---------------------------------------------------------------------------
# 4. THE RELAY — the settings reader, the wellbeing board, the first-shift gate
# ---------------------------------------------------------------------------
print("\n4. THE RELAY")


class Cur:
    """A cursor walking `_rows_for` the way the live mirror does (depot, Data, the tab's book, rows)."""

    def __init__(self, rows, *, refuse=False):
        self.rows, self.refuse, self._answer = rows, refuse, []

    def execute(self, sql, _args=None):
        if self.refuse:
            raise sys.modules["psycopg2"].Error("the mirror did not answer")
        if "tab_name='Facts'" in sql:
            self._answer = [{"data": {"Value": "house-1"}}]
        elif "tab_name='Data'" in sql:
            self._answer = []
        elif "SELECT sheet_id" in sql:
            self._answer = [{"sheet_id": "house-1"}] if self.rows else []
        else:
            self._answer = [{"data": r} for r in self.rows]

    def fetchone(self):
        return self._answer[0] if self._answer else None

    def fetchall(self):
        return self._answer


def with_relay_config(rows, *, refuse=False):
    ic.forget()
    try:
        return bs._load_ist_config(Cur(rows, refuse=refuse)), bs._expiring_days()
    finally:
        ic.forget()


src, days = with_relay_config([{"key": "ist_cert_expiring_days", "value": "30"}])
check("board: the sheet answers and the window follows it", src == "sheet" and days == 30, f"{src} {days}")
src, days = with_relay_config([])
check("board: a missing tab is named, and the declared 60 answers", src == "shipped" and days == 60)
src, days = with_relay_config([], refuse=True)
check("board: a mirror that refuses is named, and the declared 60 answers", src == "shipped" and days == 60)
src, days = with_relay_config([{"key": "ist_cert_expiring_days", "value": "0"}])
check("board: a refused window keeps the declared 60", days == 60)
ic.forget()
try:
    first = bs._load_ist_config(Cur([{"key": "ist_cert_expiring_days", "value": "30"}]))
    check("board and gate: the pass fills the one holder the first-shift gate and /bundle read",
          ic.state()["source"] == "sheet" and ic.current()["ist_cert_expiring_days"] == "30")
    second = bs._load_ist_config(Cur([]))
    check("board: a pass that loses the house says LAST KNOWN and keeps the window it knew",
          first == "sheet" and second == "last known" and bs._expiring_days() == 30)
finally:
    ic.forget()
relay_src = (ROOT / "server" / "behavior_slices.py").read_text(encoding="utf-8")
check("board: the pass reports which settings it counted against",
      '"ist_config_source": ist_config_source' in relay_src and '"ist_expiring_days": _expiring_days()' in relay_src)
check("board: no second copy of the settings beside the relay's one holder",
      "_IST_CFG" not in relay_src)


class ForeignBook(Cur):
    """A mirror holding a stale `ist_config` tab in another book, and the declared house not mirrored."""

    def execute(self, sql, args=None):
        if "tab_name='Facts'" in sql:
            self._answer = [{"data": {"Value": "house-1"}}]
        elif args and args[0] == "house-1":
            self._answer = []
        else:
            self._answer = [{"data": r} for r in self.rows]


got, why = ic.read(ForeignBook([{"key": "ist_valid_days", "value": "1"}]))
check("reader: only the declared house is read — a same-named tab in another book is never taken",
      got == {} and "not in the mirror" in why, f"{got} {why}")


def board_ist(rows, cfg_rows):
    held_rows = bs._rows_for
    ic.forget()
    ic.adopt({r["key"]: r["value"] for r in cfg_rows}, "sheet")
    bs._rows_for = lambda _cur, tab: (rows, "sid") if tab == "ist_records" else ([], "")
    try:
        return bs._ist(None)
    finally:
        bs._rows_for = held_rows
        ic.forget()


old = (datetime.now(timezone.utc).date() - timedelta(days=400)).isoformat()
IST_ROWS = [{"staffName": "Ana Lopez", "status": "done", "trainedAt": old, "clientName": "C1"},
            {"staffName": "Ana Lopez", "status": "done", "trainedAt": "", "clientName": "C2"},
            {"staffName": "Ana Lopez", "status": "owed", "trainedAt": "", "clientName": "C3"}]
got = board_ist(IST_ROWS, [])
check("board: ist_valid_days 0 — a completed IST never lapses", got["analopez"]["done"] == 2
      and got["analopez"]["owed"] == 1, got)
got = board_ist(IST_ROWS, [{"key": "ist_valid_days", "value": "365"}])
check("board: ist_valid_days 365 — the one recorded 400 days ago counts as owed, the undated one stays done",
      got["analopez"]["done"] == 1 and got["analopez"]["owed"] == 2, got)
got = board_ist(IST_ROWS, [{"key": "ist_valid_days", "value": "soon"}])
check("board: a refused ist_valid_days is the declared never-lapses", got["analopez"]["done"] == 2)

# the settings reader (the board passes above adopted what they read; start from nothing)
ic.pin(None)
ic.adopt({}, "sheet")
check("reader: with nothing read, the declared values answer and say so",
      ic.state()["source"] == "shipped" and ic.current() == SHIPPED)
ic.adopt({"ist_valid_days": "30", "ist_trained_scope": "wrong"}, "sheet")
st = ic.state()
check("reader: an adopted copy answers, a refused cell is its shipped value and reported",
      st["source"] == "sheet" and st["values"]["ist_valid_days"] == "30"
      and st["values"]["ist_trained_scope"] == "house" and "ist_trained_scope" in st["problems"])
check("reader: typed readers answer inside the declaration",
      ic.int_of(st["values"], "ist_valid_days") == 30 and ic.choice(st["values"], "ist_trained_scope") == "house"
      and ic.yes(st["values"], "ist_trainer_must_be_free") is True
      and ic.int_of({"ist_valid_days": "9999"}, "ist_valid_days") == 0)
rules_read = ic.rules(cur=Cur([{"key": "ist_valid_days", "value": "7"}]), fresh=True)
check("reader: a fresh read of the mirror replaces the held copy", rules_read["ist_valid_days"] == "7"
      and ic.state()["source"] == "sheet")
ic.rules(cur=Cur([], refuse=True), fresh=True)
check("reader: a failed read keeps the last copy, named last known",
      ic.current()["ist_valid_days"] == "7" and ic.state()["source"] == "last known")
ic.adopt({}, "sheet")
ic.pin(None)

# a copy adopted while an older one is being resolved is never overwritten by the older result
ic.forget()
ic.adopt({"ist_valid_days": "5"}, "sheet")
real_resolve = ic.resolve
raced = {"done": False}


def resolve_then_adopt(raw):
    out = real_resolve(raw)
    if not raced["done"]:
        raced["done"] = True
        ic.adopt({"ist_valid_days": "9"}, "sheet")
    return out


ic.resolve = resolve_then_adopt
try:
    stale_answer = ic.current()["ist_valid_days"]
finally:
    ic.resolve = real_resolve
check("reader: an adopt that lands mid-resolve wins — the stale result is answered once, never held",
      stale_answer == "5" and ic.current()["ist_valid_days"] == "9", f"{stale_answer} {ic.current()['ist_valid_days']}")
ic.forget()

# one lapse rule: the gate, the board and the SPA agree on day N and day N+1, by the Ohio date
DAY_N, DAY_N1 = date(2026, 1, 31), date(2026, 2, 1)
check("lapse: an IST recorded on day 0 still counts on day 30 and lapses on day 31",
      ic.lapsed("2026-01-01", 30, DAY_N) is False and ic.lapsed("2026-01-01", 30, DAY_N1) is True
      and ic.lapsed("", 30, DAY_N1) is False and ic.lapsed("2026-01-01", 0, DAY_N1) is False)
check("lapse: the board reads it on the same days",
      bs._ist_lapsed("2026-01-01", 30, DAY_N) is False and bs._ist_lapsed("2026-01-01", 30, DAY_N1) is True)
import shift_requests as sr  # noqa: E402

check("lapse: the gate reads it on the same days",
      sr._ist_current({"done": True, "at": "2026-01-01"}, 30, DAY_N) is True
      and sr._ist_current({"done": True, "at": "2026-01-01"}, 30, DAY_N1) is False)

import shift_requests as sr  # noqa: E402

LOC = "CAN - BM - BM4060"


def index(rows=None, *, readable=True, mapped=None, mapped_readable=True, rules=None, owed=0):
    slot = {"done": sum(1 for r in rows or [] if r["done"]), "owed": owed,
            "clients": [r["client"] for r in rows or [] if r["done"]], "owed_for": ["C9"] * owed,
            "rows": rows or []}
    return {"readable": readable, "why": "" if readable else "mirror down",
            "by_person": {"zoenew": {"BM4060": slot}} if rows or owed else {},
            "rules": dict(SHIPPED, **(rules or {})), "mapped": mapped or {},
            "mapped_readable": mapped_readable}


recent = (datetime.now().date() - timedelta(days=10)).isoformat()
ONE = [{"client": "C1", "done": True, "at": recent}]
check("gate: shipped rules — one completed IST at the house, any client, is trained",
      sr.ist_verdict(index(ONE), "Zoe New", LOC)["ok"] is True)
check("gate: no row at all is missing, rows all owed are owed",
      sr.ist_verdict(index([]), "Zoe New", LOC)["state"] == "missing"
      and sr.ist_verdict(index([], owed=1), "Zoe New", LOC)["state"] == "owed")
check("gate: an unreadable book is never a trained person",
      sr.ist_verdict(index(ONE, readable=False), "Zoe New", LOC)["ok"] is False)
MAP = {"BM4060": ["C1", "C2"]}
v = sr.ist_verdict(index(ONE, mapped=MAP, rules={"ist_trained_scope": "client"}), "Zoe New", LOC)
check("scope client: one client of two is not trained for the house", v["ok"] is False
      and v["state"] == "owed" and "C2" in v["why"], v)
BOTH = ONE + [{"client": "C2", "done": True, "at": ""}]
check("scope client: every mapped client done is trained",
      sr.ist_verdict(index(BOTH, mapped=MAP, rules={"ist_trained_scope": "client"}), "Zoe New", LOC)["ok"])
v = sr.ist_verdict(index(BOTH, mapped=MAP, mapped_readable=False, rules={"ist_trained_scope": "client"}),
                   "Zoe New", LOC)
check("scope client: an unreadable map asks for the approval, never trains",
      v["ok"] is False and v["state"] == "unreadable", v)
check("scope client: a refused scope is the shipped house scope",
      sr.ist_verdict(index(ONE, mapped=MAP, rules={"ist_trained_scope": "all"}), "Zoe New", LOC)["ok"])
OLD = [{"client": "C1", "done": True, "at": old}]
v = sr.ist_verdict(index(OLD, rules={"ist_valid_days": "365"}), "Zoe New", LOC)
check("valid days: an IST recorded before the window lapsed and reads owed",
      v["ok"] is False and v["state"] == "owed" and "lapsed" in v["why"], v)
check("valid days: 0 never lapses; an undated completed row never lapses",
      sr.ist_verdict(index(OLD), "Zoe New", LOC)["ok"]
      and sr.ist_verdict(index([{"client": "C1", "done": True, "at": ""}],
                               rules={"ist_valid_days": "30"}), "Zoe New", LOC)["ok"])
v = sr.ist_verdict(index([]), "STAFF", LOC)
check("labels: a coverage label from the IST settings is nobody to train",
      v["ok"] is True and v["state"] == "not_a_person", v)
check("labels: an edited list is the relay's list too",
      sr.ist_verdict(index([], rules={"ist_non_person_names": "OPEN"}), "STAFF", LOC)["state"] == "missing"
      and sr.not_a_person("Workshop AM") and not sr.not_a_person("Ana Lopez"))
v = sr.ist_verdict(index([], owed=1, rules={"ist_non_person_names": "Zoe New"}), "Zoe New", LOC)
check("labels: a name the IST book knows as a trainee is a person, whatever a label cell says",
      v["ok"] is False and v["state"] == "owed", v)
v = sr.ist_verdict(index([], rules={"ist_non_person_contains": "workshop, an"}), "Ana Lopez", LOC)
check("labels: a coverage word under four letters never lets a person skip the gate",
      v["ok"] is False and v["state"] == "missing", v)
check("labels: VACANT, AGENCY, PRN and TBA rows are coverage labels on the relay, as in the generator",
      all(ic.not_a_person(n, SHIPPED) for n in ("VACANT", "agency", "PRN", "TBA")))
import calendar_generator as cg  # noqa: E402

check("generator: its role words are the IST settings' labels — one list for the lane",
      "_ROLE_WORDS" not in (ROOT / "server" / "calendar_generator.py").read_text(encoding="utf-8")
      and not cg._is_person({"rowType": "staff", "employee": "Agency Staff"})
      and not cg._is_person({"rowType": "staff", "employee": "Morning Workshop"})
      and cg._is_person({"rowType": "staff", "employee": "Ana Lopez"}))

MANAGERS = {"readable": True, "why": "", "by_code": {"BM4060": {"name": "Hana Boss", "names": ["Hana Boss"]}}}
CLASH = {"location": "CAN - MK - MK11787", "col_iso": "2026-10-01", "value": "8A-4P", "source": "roster"}


def trainer(busy=None, managers=MANAGERS, approver="", rules=None):
    busy = busy or {}
    return sr.training_verdict(location=LOC, col_iso="2026-10-01", value="8A-4P", trainee="Zoe New",
                               managers=managers, busy_of=lambda n: busy.get(n), approver=approver,
                               rules=dict(SHIPPED, **(rules or {})))


check("trainer: shipped — a busy house manager cannot train, the approval waits",
      trainer({"Hana Boss": CLASH})["may_approve"] is False and trainer({"Hana Boss": CLASH})["state"] == "busy")
t = trainer({"Hana Boss": CLASH}, rules={"ist_trainer_must_be_free": "no"})
check("trainer: must be free = no — the house manager trains whatever they are working",
      t["may_approve"] is True and t["trains"] == "Hana Boss" and t.get("busy_ok") is True, t)
check("trainer: the reader's sentence says the settings allowed it",
      "do not require" in sr.training_for_reader(t)["why"])
check("trainer: a refused must-be-free is the shipped yes",
      trainer({"Hana Boss": CLASH}, rules={"ist_trainer_must_be_free": "sometimes"})["may_approve"] is False)
NOHM = {"readable": True, "why": "", "by_code": {}}
check("trainer: no house manager — shipped, whoever approves trains",
      trainer(managers=NOHM, approver="Dana Director")["trains"] == "Dana Director")
t = trainer(managers=NOHM, approver="Dana Director", rules={"ist_trainer_when_no_hm": "refuse"})
check("trainer: when no hm = refuse — nobody may approve until a house manager is on file",
      t["may_approve"] is False and t["state"] == sr.TRAINING_NO_MANAGER, t)
check("trainer: nobody named yet says who approves, in words the badges generate",
      sr.deciders_one() in trainer(managers=NOHM)["why"])

ic.pin(dict(SHIPPED))
check("assigner: shipped — a decider's assignment takes the training on",
      sr.assigner_owns_training() is True
      and sr.unowned_training("dsn", {"ist": {"why": "no IST"}}, location=LOC, open_row="Zoe New",
                              col_iso="2026-10-01", value="8A-4P", person="Zoe New") == "")
ic.pin(dict(SHIPPED, ist_assigner_owns_training="no"))
said = sr.unowned_training("dsn", {"ist": {"why": "no IST"}}, location=LOC, open_row="Zoe New",
                           col_iso="2026-10-01", value="8A-4P", person="Zoe New", raise_it=False)
check("assigner: no — the cell waits, and a dry run says the approval would go to Requests",
      sr.assigner_owns_training() is False and "would be put on Requests" in said, said)
check("assigner: an approval already on file lets it through either way",
      sr.unowned_training("dsn", {"ist": {}, "training_on_file": {"id": "r1"}}, location=LOC,
                          open_row="Zoe New", col_iso="2026-10-01", value="8A-4P", person="Zoe New") == "")
ic.pin(dict(SHIPPED, ist_assigner_owns_training="maybe"))
check("assigner: a refused cell is the shipped yes", sr.assigner_owns_training() is True)
ic.pin(None)

# UNREAD IS NOT THE HOUSE'S WORD: nothing read yet, the shipped values answer, and no gate decides on them.
ic.forget()


class _NoHouseCur:
    """A mirror that holds no settings house: every read answers nothing."""

    def execute(self, *a, **k):
        return None

    def fetchone(self):
        return None

    def fetchall(self):
        return []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _NoHouseConn(_NoHouseCur):
    def cursor(self, *a, **k):
        return _NoHouseCur()


check("unread: before any read lands the copy is 'shipped', and unread() says so",
      ic.unread() is True and ic.state()["source"] == "shipped")
held_connect, held_rows, held_mapped = sr._connect, sr._ist_rows, sr._ist_mapped_clients
sr._connect = lambda dsn: _NoHouseConn()
sr._ist_rows = lambda cur: ([{"staffName": "Zoe New", "house": "BM4060", "status": "done",
                              "trainedAt": "2026-09-01", "clientName": "C1"}], "book/Data")
sr._ist_mapped_clients = lambda cur: ({}, True)
sr.forget_ist()
try:
    unread_index = sr.ist_index("dsn", fresh=True)
finally:
    sr._connect, sr._ist_rows, sr._ist_mapped_clients = held_connect, held_rows, held_mapped
    sr.forget_ist()
unread_verdict = sr.ist_verdict(unread_index, "Zoe New", LOC)
check("unread: a settings house that could not be read makes the IST index UNREADABLE, even with a trained "
      "row on file — the shipped settings never decide who is trained",
      unread_index["readable"] is False and "could not be read" in unread_index["why"]
      and unread_verdict["ok"] is False and unread_verdict["state"] == "unreadable", (unread_index, unread_verdict))
t_unread = sr.training_verdict(location=LOC, col_iso="2026-10-01", value="8A-4P", trainee="Zoe New",
                               managers=MANAGERS, busy_of=lambda n: None)
check("unread: who trains is unreadable too — nobody may approve the training on shipped rules",
      t_unread["state"] == sr.TRAINING_UNREADABLE and t_unread["may_approve"] is False
      and "could not be read" in t_unread["why"], t_unread)
said_unread = sr.unowned_training("dsn", {"ist": {"why": "no IST"}}, location=LOC, open_row="Zoe New",
                                  col_iso="2026-10-01", value="8A-4P", person="Zoe New", raise_it=False)
check("unread: an assignment does not take the training on, and the sentence says the settings could not "
      "be read rather than that they say no",
      sr.assigner_owns_training() is False and "could not be read" in said_unread, said_unread)
ic.adopt(dict(SHIPPED), "sheet")
check("a read that landed answers again, with its label",
      ic.unread() is False and sr.assigner_owns_training() is True
      and sr.training_verdict(location=LOC, col_iso="2026-10-01", value="8A-4P", trainee="Zoe New",
                              managers=MANAGERS, busy_of=lambda n: None)["state"] == "free")


class _IstCur(_NoHouseCur):
    """The depot declares `book` (or nothing); its tabs hold `tabs`."""

    def __init__(self, book, tabs):
        self.book, self.tabs, self.last, self.sql = book, tabs, ("", ()), []

    def execute(self, sql, args=()):
        self.last = (sql, args)
        self.sql.append(sql)

    def fetchone(self):
        return {"v": self.book} if self.book else None

    def fetchall(self):
        sql, args = self.last
        return [{"data": d} for d in self.tabs.get(args[1], [])] if "tab_name=%s" in sql else []


class _OneCurConn(_NoHouseCur):
    def __init__(self, cur):
        self.cur = cur

    def cursor(self, *a, **k):
        return self.cur


def ist_index_over(cur):
    held = sr._connect, sr._ist_mapped_clients
    sr._connect = lambda dsn: _OneCurConn(cur)
    sr._ist_mapped_clients = lambda c: ({}, True)
    sr.forget_ist()
    try:
        return sr.ist_index("dsn", fresh=True)
    finally:
        sr._connect, sr._ist_mapped_clients = held
        sr.forget_ist()


TRAINED_ROW = {"staffName": "Zoe New", "house": "BM4060", "status": "done", "trainedAt": "2026-09-01",
               "clientName": "C1"}
undeclared = _IstCur("", {"ist_records": [TRAINED_ROW]})
declared_empty = _IstCur("book-ist", {})
declared_old_tab = _IstCur("book-ist", {"ist_records": [TRAINED_ROW]})
got_undeclared = sr._ist_rows(undeclared)
got_empty = sr._ist_rows(declared_empty)
got_old_tab = sr._ist_rows(declared_old_tab)
idx_undeclared = ist_index_over(_IstCur("", {"ist_records": [TRAINED_ROW]}))
idx_empty = ist_index_over(_IstCur("book-ist", {}))
check("IST ROWS COME FROM THE DECLARED HOUSE OR NOWHERE: an undeclared pointer answers no rows and says "
      "which pointer, never another book's ist_records",
      got_undeclared == ([], "the IST house is not declared (HUB_HOUSE_IST_RECORDS_ID)")
      and len(undeclared.sql) == 1, (got_undeclared, undeclared.sql))
check("…a declared house holding no rows says so by name",
      got_empty[0] == [] and "book-ist holds no rows in Data or ist_records" in got_empty[1], got_empty)
check("…and its older tab spelling still reads",
      got_old_tab == ([TRAINED_ROW], "book-ist/ist_records"), got_old_tab)
check("…and the index reads both as UNREADABLE with that reason — every verdict unreadable, the house "
      "manager approves",
      idx_undeclared["readable"] is False and "not declared" in idx_undeclared["why"]
      and idx_empty["readable"] is False and "holds no rows" in idx_empty["why"]
      and sr.ist_verdict(idx_undeclared, "Zoe New", LOC)["state"] == "unreadable", (idx_undeclared, idx_empty))
ic.forget()

check("deciders: the approvers above a house are generated from the badges",
      sr.deciders_one() == "a director, supervisor or administrator"
      and sr.deciders_all() == "directors, supervisors and administrators",
      (sr.deciders_one(), sr.deciders_all()))
check("deciders: a different badge set says a different sentence",
      sr.deciders_one({"DIRECTOR"}) == "a director or supervisor"
      and sr.deciders_all({"ADMIN"}) == "administrators",
      (sr.deciders_one({"DIRECTOR"}), sr.deciders_all({"ADMIN"})))
check("deciders: a team lead follows nobody (2026-10-29), so no sentence names one among the deciders",
      "team lead" not in sr.deciders_one() and "team lead" not in sr.deciders_all())
sr_src = (ROOT / "server" / "shift_requests.py").read_text(encoding="utf-8")
check("deciders: no sentence in the lane types the badge list any more",
      '"a director, team lead or administrator"' not in sr_src
      and '"directors, team leads and administrators"' not in sr_src
      and '"a director, supervisor or administrator"' not in sr_src
      and '"directors, supervisors and administrators"' not in sr_src)
cb_src = (ROOT / "server" / "calendar_builder_houses.py").read_text(encoding="utf-8")
check("assigner: every Calendar Builder publish path asks the same rule",
      cb_src.count("shift_requests.unowned_training(") == 3)

snap = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
block_src = snap[snap.index("def _ist_config_block"):snap.index("def _shelf_rows")]
check("bundle: /bundle carries the relay's own IST copy — the gate's and the board's — for every role",
      'out["config"]["ist"] = ist_block' in snap and "ist_config.rules(PG_DSN)" in block_src
      and "ist_config.bundle_block(role)" in block_src and "_config_kv" not in block_src
      and "_ist_config_block(role)" in snap)
client = (ROOT / "src" / "lib" / "snapshotClient.ts").read_text(encoding="utf-8")
check("bundle: the SPA seeds its settings reader from it before asking Apps Script",
      "seedIstConfig(ist)" in client)
ic.forget()
ic.adopt({"ist_page_size": "40", "ist_invented": "x"}, "sheet")
staff_block, admin_block = ic.bundle_block("staff"), ic.bundle_block("admin")
check("bundle: every role gets the values the gate uses; only admin and manager get the problems",
      bool(staff_block) and staff_block["values"]["ist_page_size"] == "40" and staff_block["source"] == "mirror"
      and "problems" not in staff_block and bool(admin_block) and admin_block["unknown"] == ["ist_invented"],
      json.dumps({"staff": staff_block and sorted(staff_block), "admin": admin_block and sorted(admin_block)}))
ic.forget()
check("bundle: with no mirror copy the block is not sent, so the SPA reads the tab itself",
      ic.bundle_block("admin") is None)


# ---------------------------------------------------------------------------
# 5. APPS SCRIPT AND THE SCREENS — the wiring (behaviour: SelfTest.gs, tests/spa)
# ---------------------------------------------------------------------------
print("\n5. THE WIRING")

ist_gs = (ROOT / "apps-script" / "IST.gs").read_text(encoding="utf-8")
check("IST.gs: the dead rebuild obeys the lookback and the overlap cells too",
      "istCfgInt_('ist_roster_lookback_days')" in ist_gs and "istCfgYes_('ist_pair_requires_overlap')" in ist_gs)
check("IST.gs: coverage labels and the stale mark come from the settings",
      "istNotAPerson_(staff)" in ist_gs and "'house no longer mapped'" not in ist_gs)
check("IST.gs: the ist_due row's own pacing is deferred to", "istNoticeRepeats_()" in ist_gs)
certs_gs = (ROOT / "apps-script" / "Certs.gs").read_text(encoding="utf-8")
check("Certs.gs: status words and columns come from the settings",
      "certStateOf_('ist_cert_tracker_statuses'" in certs_gs and "certStateOf_('ist_cert_mais_statuses'" in certs_gs
      and "certSourceField_(f)" in certs_gs and "indexOf('ERROR') === 0" not in certs_gs)
req_gs = (ROOT / "apps-script" / "RequirementStates.gs").read_text(encoding="utf-8")
check("RequirementStates.gs: training rows can take the certification window",
      "reqIstWindow_()" in req_gs and "reqWarnDays_(req, istWindow)" in req_gs)
set_body = gs_src[gs_src.index("HUB_ACTIONS.istConfigSet"):]
check("IstConfig.gs: the save refuses every declared type out loud before touching the sheet",
      set_body.index("istConfigSaveProblems_(values, istConfig_())") < set_body.index("istConfigSheet_()"))
check("IstConfig.gs: the read sends each key's type, limits and problem",
      all(f in gs_src for f in ("type: d.type", "min: d.min", "allowed: d.allowed",
                                "problem: resolved.problems[d.key]", "groups: IST_CONFIG_GROUPS")))
SET_DOOR = r"""
var grid = [['key', 'value', 'note']].concat(IST_CONFIG_DEFAULTS.map(function (d) { return [d.key, d.value, d.note]; }));
var writes = [];
var sheet = {
  isRuntimeBacked: false,
  getDataRange: function () { return { getValues: function () { return grid.map(function (r) { return r.slice(); }); } }; },
  appendRow: function (r) { grid.push(r.slice()); },
  getRange: function (r, c) {
    return { setNumberFormat: function (f) { writes.push('fmt:' + r + ':' + f); },
             setValue: function (v) { grid[r - 1][c - 1] = v; writes.push('set:' + r + ':' + v); } };
  },
  deleteRow: function (i) { grid.splice(i - 1, 1); }
};
var fakeTab = function (head) {
  return { getLastColumn: function () { return head.length; },
           getRange: function () { return { getValues: function () { return [head]; } }; } };
};
var tabs = {
  'Trainings Status': fakeTab(['Name', 'Training', 'Status', 'Expiration Date']),
  'Med Del Certs (MAIS)': fakeTab(['Name', 'Status', 'Expiration', 'Cert Type']),
  'Master': fakeTab(['Employee', 'DODD 8-Hour Exp', 'CPR Exp Date'])
};
var estateOpen = true, sheetOpen = true, peopleOpen = true, badgeRows = [];
hubTabEnsure_ = function () { if (!sheetOpen) throw new Error('no tab'); return sheet; };
hubId_ = function (k) { return k; };
ssOpen_ = function (id) {
  if (id === 'CERT_SOURCE_ID' && estateOpen) return { getSheetByName: function (n) { return tabs[n] || null; } };
  if (id === 'HUB_DB_ID') return {};
  throw new Error('closed');
};
readTabNormalized_ = function () { return badgeRows; };
str_ = function (v) { return v == null ? '' : String(v).trim(); };
userTypesFromRaw_ = function (raw) {
  return { types: String(raw || '').split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean) };
};
userBadgesWorn_ = function (types, role) { return userTypesFromRaw_(types).types.concat([String(role).toUpperCase()]); };
hubIsMaster_ = function (e) { return e === 'master@x'; };
CONFIG_BADGE_TAB = 'config_badge_access';
listRows_ = function (t) { if (t === 'people' && !peopleOpen) throw new Error('closed'); return t === 'people' ? [{ name: 'Ana Lopez' }, { name: 'Dana Director' }] : []; };
withoutIspClients_ = function (r) { return r; };
peopleMerged_ = function (r) { return r; };
estateKey_ = function (h) { return String(h || '').replace(/\([^)]*\)/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); };
var admin = { email: 'a@x', role: 'admin' };
var save = function (values, user) {
  IST_CONFIG_MEMO = null; IST_CONFIG_RESOLVED = null;
  var r = HUB_ACTIONS.istConfigSet({ values: values }, user || admin);
  return { status: r.status, message: String(r.message || '') };
};
var out = {};
out.manager = save({ ist_valid_days: '30' }, { email: 'm@x', role: 'manager' }).status;
badgeRows = [{ sectionid: 'ist', badges: 'DIRECTOR' }];
out.badgeless = save({ ist_valid_days: '30' }).status;
out.badged = save({ ist_valid_days: '30' }, { email: 'd@x', role: 'admin', types: 'DIRECTOR' }).status;
out.master = save({ ist_valid_days: '30' }, { email: 'master@x', role: 'admin' }).status;
badgeRows = [];
out.short = save({ ist_non_person_contains: 'workshop, a' });
out.name = save({ ist_non_person_names: 'OPEN, Ana Lopez' });
out.inside = save({ ist_non_person_contains: 'lopez' });
peopleOpen = false;
out.peopleShut = save({ ist_non_person_names: 'OPEN' });
peopleOpen = true;
out.label = save({ ist_non_person_names: 'OPEN, AGENCY' }).status;
out.tabTypo = save({ ist_cert_source_tabs: 'trainings=Trainings Stauts' });
out.colTypo = save({ ist_cert_source_fields: 'trainings.course=trainign' });
out.masterWrong = save({ ist_cert_source_tabs: 'master=Trainings Status' });
estateOpen = false;
out.estateShut = save({ ist_cert_source_tabs: 'master=Master' });
estateOpen = true;
out.shrink = save({ ist_cert_labels: 'cpr=CPR' });
out.mais = save({ ist_cert_mais_statuses: '*=certified' });
writes = [];
out.text = save({ ist_stale_marker: 'TRUE' });
out.textWrites = writes.slice();
sheetOpen = false;
out.blind = save({ ist_stale_marker: 'house closed' });
return out;
"""
door = run_gs(["IstConfig.gs"], SET_DOOR, None)
check("save door: the manager role, and an admin without the section's badge, are refused",
      door["manager"] == 403 and door["badgeless"] == 403 and door["badged"] == 200 and door["master"] == 200,
      json.dumps({k: door[k] for k in ("manager", "badgeless", "badged", "master")}))
check("save door: a short coverage word, a real person's name, or a word inside one is refused",
      door["short"]["status"] == 400 and door["name"]["status"] == 400 and "Ana Lopez" in door["name"]["message"]
      and door["inside"]["status"] == 400 and door["peopleShut"]["status"] == 400 and door["label"] == 200,
      json.dumps({k: door[k] for k in ("short", "name", "inside", "peopleShut", "label")})[:600])
check("save door: a tab or a column the estate's book does not have is refused, and so is a Master with no dates",
      door["tabTypo"]["status"] == 400 and "Trainings Stauts" in door["tabTypo"]["message"]
      and door["colTypo"]["status"] == 400 and "trainign" in door["colTypo"]["message"]
      and door["masterWrong"]["status"] == 400 and door["estateShut"]["status"] == 400,
      json.dumps({k: door[k] for k in ("tabTypo", "colTypo", "masterWrong", "estateShut")})[:700])
check("save door: a course list that drops the gate, and every MAIS word certified, are refused",
      door["shrink"]["status"] == 400 and "ist_gate_certification" in door["shrink"]["message"]
      and door["mais"]["status"] == 400, json.dumps({k: door[k] for k in ("shrink", "mais")})[:500])
check("save door: a text cell is stored as text, so TRUE reads back as typed",
      door["text"]["status"] == 200 and any(w.endswith(":@") for w in door["textWrites"])
      and door["textWrites"].index(next(w for w in door["textWrites"] if w.endswith(":@")))
      < door["textWrites"].index(next(w for w in door["textWrites"] if w.startswith("set:"))),
      json.dumps(door["textWrites"]))
check("save door: a tab that cannot be read refuses the save — nothing written into a blind tab",
      door["blind"]["status"] == 503, json.dumps(door["blind"]))
check("heal: every repair is planned from a read made inside the lock",
      "istConfigHealPlan_(sheet.getDataRange().getValues())" in gs_src
      and gs_src.index("held = lock.tryLock(10000)", gs_src.index("function istConfigHeal_"))
      < gs_src.index("var plan = istConfigHealPlan_", gs_src.index("function istConfigHeal_")))
check("log: Apps Script says a refusal when the set changes, not on every read",
      "IST_CONFIG_REFUSED_PROP" in gs_src and "=== print) return" in gs_src)

strays = []
for gs in sorted((ROOT / "apps-script").glob("*.gs")):
    if gs.name in ("Certs.gs", "SelfTest.gs"):
        continue
    text = re.sub(r"//[^\n]*", " ", re.sub(r"/\*[\s\S]*?\*/", " ", gs.read_text(encoding="utf-8")))
    for const in ("CERT_LABELS", "CERT_MASTER_TAB", "CERT_TRAININGS_TAB", "CERT_MAIS_TAB",
                  "CERT_EXPIRING_DAYS", "CERT_MASTER_COLUMNS", "CERT_TRAINING_KEYS"):
        if re.search(r"\b" + const + r"\b", text):
            strays.append(f"{gs.name}:{const}")
check("apps script: no file outside Certs.gs reads the load-order floor directly", not strays, strays)
for name, fn in (("Emp360.gs", "emp360MasterTab_"), ("Compliance.gs", "complianceMasterTab_"),
                 ("EmployeeDb.gs", "empdbTab_")):
    text = (ROOT / "apps-script" / name).read_text(encoding="utf-8")
    check(f"apps script: {name} opens the Master tab the cell names",
          f"function {fn}()" in text and "certSourceTab_('master')" in text)

settings = (ROOT / "src" / "pages" / "settings" / "IstSection.tsx").read_text(encoding="utf-8")
editor = (ROOT / "src" / "pages" / "settings" / "IstSettingsEditor.tsx").read_text(encoding="utf-8")
check("settings: the section draws every key through the typed editor, groups from the declaration",
      "<IstSettingsEditor" in settings and "CFG_GROUPS" not in settings and "IST_CONFIG_GROUPS" in editor)
check("settings: the stale mark is the cell, never a word from memory",
      "house no longer mapped" not in settings and "staleMark" in settings)
check("settings: the save is checked against the declaration and says when screens follow",
      "saveIstConfig(" in settings and "IST_CONFIG_FOLLOW" in settings
      and "within a minute" not in settings)
check("settings: the screen is in English", not re.search(r"Implantar|Gerenciar|implantações|Versão", settings))
check("settings: no real-looking client name as a placeholder", "Eugene Williams" not in settings)
check("settings: each type has its input, and a reset to the declared value",
      all(f'data-ist-input="{t}"' in editor for t in ("int",)) and "data-ist-input={spec.type}" in editor
      and "Reset to default" in editor)
tracker = (ROOT / "src/pages/features/employeetracker/EmployeeTrackerPage.tsx").read_text(encoding="utf-8")
check("tracker: IST status is read through the settings, never the literal",
      "=== 'owed'" not in tracker and "istRowOwed" in tracker and "cfgTints(cfg, 'ist_status_tints')" in tracker)
dash = (ROOT / "src/pages/features/compliance/CertificationsDashboard.tsx").read_text(encoding="utf-8")
check("dashboard: the renewal rail's reach and the certification colours come from the settings",
      "cfgInt(cfgNow, 'ist_dashboard_months')" in dash and "certStateTints(" in dash
      and "length: 12" not in dash)
for path in ("src/pages/features/employeetracker/EmployeeTrackerPage.tsx",
             "src/pages/features/compliance/CertificationsDashboard.tsx"):
    text = (ROOT / path).read_text(encoding="utf-8")
    check(f"screens: {path.split('/')[-1]} reads the course list and says when the read failed",
          "certScreenColumns(" in text and "fetchIstConfig(" in text and "istCfg?.blind" in text)
drawer = (ROOT / "src/pages/features/compliance/PersonComplianceDrawer.tsx").read_text(encoding="utf-8")
check("screens: the certification drawer counts against the platform's window",
      "expiringDays(" in drawer and "30 * DAY_MS" not in drawer)


print(f"\nist config: {results['ok']} passed, {len(results['failed'])} failed")
if results["failed"]:
    for f in results["failed"]:
        print(f"  ✗ {f}")
    sys.exit(1)
