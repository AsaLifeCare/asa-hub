#!/usr/bin/env python3
"""
MAR ERRORS AND MISSING MEDICATIONS ARE NEVER A FILE, asserted offline against
the real relay code.

  gate    with the emitted manifest the relay builds neither slice and its gate
          refuses both files to every role, an old file included, and a raw URI
          nginx would rewrite (#, %, \\) is never judged as another name;
          the study itself is still served to its three roles
  study   medcorr_slices takes both books from the hand-in alone: files planted
          where the old slices lived are never read, a cycle missing either
          hand-in fails (the last study stands), and a hand-in is used once;
          the file it writes carries initials and counts, never a row's free
          text, a staff name or a client's name
  hand-in the builder reads the bundle first, then ONE tab read for what it did
          not answer, writes nothing to disk, and counts empty rows as a failed read
  notify  a /notify naming either book is queued and rebuilds the study
"""
from __future__ import annotations

import ast
import asyncio
import atexit
import json
import logging
import os
import shutil
import sys
import tempfile
import time
import types
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "server"

results = {"ok": 0, "failed": []}


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
    extras = types.ModuleType("psycopg2.extras")
    extras.RealDictCursor = object
    fake.extras = extras
    sys.modules["psycopg2"] = fake
    sys.modules["psycopg2.extras"] = extras

TMP = Path(tempfile.mkdtemp(prefix="mar-errors-test-"))
atexit.register(shutil.rmtree, TMP, True)
SNAP = TMP / "snap"
SNAP.mkdir()
os.environ["HUB_SNAPSHOT_OUT"] = str(SNAP)
sys.path.insert(0, str(SERVER))
import medcorr_slices as mc  # noqa: E402

MANIFEST = ROOT / "public/snapshot-manifest.json"
ROLES = ["admin", "manager", "staff", "client", "director", "interviewer", "onboarding"]
HELD = {"marErrors": "mar_errors", "missingMedications": "missing_medications"}


def err_row(i: int, flags: str = "Missed") -> dict[str, Any]:
    return {"id": f"E{i}", "error_date": "2026-08-0" + str(1 + i % 9), "initials": "AB",
            "medication": f"med{i}", "problem": "ran out", "flags": flags, "staff": "S", "notes": ""}


def miss_row(i: int) -> dict[str, Any]:
    return {"id": f"M{i}", "reported_at": "2026-08-0" + str(1 + i % 9), "client_name": "Ann Bee",
            "medications": f"med{i}", "issue": "ran out", "status": "open", "house": "H1"}


# ── the gate, out of the relay's own source ─────────────────────────────────
SVC = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
TREE = ast.parse(SVC)
NAMES = {"_HELD_LIVE", "_HELD_SAID", "_note_held_live", "load_manifest", "_role_may_read",
         "_medcorr_hand_in", "_mark_dirty"}


def relay(**extra: Any) -> dict[str, Any]:
    ns: dict[str, Any] = {"json": json, "time": time, "Any": Any, "Path": Path,
                          "log": logging.getLogger("mar-errors-test"), "MANIFEST_PATH": MANIFEST,
                          "medcorr_slices": mc, "_dirty": set(), "_dirty_at": 0.0,
                          "DEBOUNCE_SECONDS": 5, **extra}
    found = set()
    for node in TREE.body:
        name = (node.name if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                else getattr(node.targets[0], "id", "") if isinstance(node, ast.Assign)
                else getattr(node.target, "id", "") if isinstance(node, ast.AnnAssign) else "")
        if name in NAMES:
            exec(compile(ast.Module(body=[node], type_ignores=[]), "snapshot_service.py", "exec"), ns)
            found.add(name)
    ns["_found"] = found
    return ns


print("gate")
R = relay()
check("every piece was found in the relay's source", R["_found"] == NAMES, sorted(NAMES - R["_found"]))
check("medcorr_slices holds both books", mc.HELD_SOURCES == HELD, mc.HELD_SOURCES)
raw = json.loads(MANIFEST.read_text())["resources"]
for resource in HELD:
    entry = next((e for e in raw if e["resource"] == resource), {})
    check(f"the emitted manifest holds {resource} live, by design", entry.get("mode") == "live"
          and entry.get("held") == "by-design", entry)
built = {e["resource"] for e in R["load_manifest"]()}
check("the builder is never handed either book to build", not (set(HELD) & built), set(HELD) & built)
check("the study is still built", "medCorrelation" in built, None)
for resource in HELD:
    refused = [r for r in ROLES if R["_role_may_read"](r, f"/snapshot/{resource}.json")]
    check(f"{resource}.json is refused to every role, an old file on disk included", not refused, refused)
check("the query string does not open it", not R["_role_may_read"]("admin", "/snapshot/marErrors.json?v=1"))
study = [r for r in ROLES if R["_role_may_read"](r, "/snapshot/medCorrelation.json")]
check("the study is served to admin, director and manager alone", sorted(study) == ["admin", "director", "manager"],
      study)

# nginx serves the normalized path and cuts it at '#'; the gate reads the raw one
TRICKS = ["/snapshot/marErrors.json#/index.json", "/snapshot/missingMedications.json#/all.json",
          "/snapshot/marErrors.json#/medCorrelation.json", "/snapshot/marErrors.json#?/index.json",
          "/snapshot/marErrors%2Ejson", "/snapshot/x%2F..%2FmarErrors.json#/index.json",
          "/snapshot/marErrors.json\\index.json", "/snapshot\\index.json"]
opened = [(r, u) for u in TRICKS for r in ROLES if R["_role_may_read"](r, u)]
check("a raw URI nginx would rewrite (#, %, \\) is refused to every role", not opened, opened)
check("the plain doors still open: index.json, all.json and the place door with an encoded query",
      R["_role_may_read"]("client", "/snapshot/index.json")
      and R["_role_may_read"]("staff", "/snapshot/all.json")
      and R["_role_may_read"]("staff", "/snapshot/place?tab=calendarGrid&member=a%40b.com"), None)

print("\nstudy")
for resource in HELD:
    (SNAP / f"{resource}.json").write_text(json.dumps({"built_at": "2026-01-01T00:00:00Z",
                                                       "rows": [err_row(i) for i in range(50)]}))
for resource in HELD:
    mc.hand_in(resource, None)
try:
    mc.build("medCorrelation", "")
    check("nothing handed: the build fails rather than read the old files", False, "it built")
except RuntimeError as exc:
    check("nothing handed: the build fails rather than read the old files",
          "marErrors" in str(exc) and "missingMedications" in str(exc), exc)

mc.hand_in("marErrors", [err_row(1)], "2026-09-28T10:00:00Z")
try:
    mc.build("medCorrelation", "")
    check("one book missing: the build fails and names it", False, "it built")
except RuntimeError as exc:
    check("one book missing: the build fails and names it",
          "missingMedications" in str(exc) and "marErrors" not in str(exc), exc)
mc.hand_in("missingMedications", [miss_row(1)], "2026-09-28T10:00:00Z")
try:
    mc.build("medCorrelation", "")
    check("a failed cycle takes its hand-ins too: the next needs both again", False, "it built")
except RuntimeError as exc:
    check("a failed cycle takes its hand-ins too: the next needs both again", "marErrors" in str(exc), exc)

mc.hand_in("marErrors", [err_row(1), err_row(2, "Unavailable"), err_row(3, "")], "2026-09-28T10:00:00Z")
mc.hand_in("missingMedications", [miss_row(1), miss_row(2)], "2026-09-28T10:05:00Z")
rows, _at = mc.build("medCorrelation", "")
summary = rows[0]
check("the handed rows are the ones studied (3 and 2, not the 50 in the old files)",
      summary["totals"]["mar_audit_rows"] == 3 and summary["totals"]["med_errors"] == 3
      and summary["totals"]["missing_meds"] == 2, summary["totals"])
check("the study says when each book was read",
      summary["slice_sources"] == {"marErrors": "2026-09-28T10:00:00Z",
                                   "missingMedications": "2026-09-28T10:05:00Z"}, summary["slice_sources"])
check("the page's source lines no longer call either a slice",
      not any("sliced" in v for v in summary["sources"].values()), summary["sources"])
try:
    mc.build("medCorrelation", "")
    check("a hand-in is used once: the next cycle needs its own", False, "it built again")
except RuntimeError:
    check("a hand-in is used once: the next cycle needs its own", True)
for resource in HELD:
    (SNAP / f"{resource}.json").unlink()

named = dict(err_row(4, "Unavailable"), problem="Pharmacy did not deliver Carol Dunn's refill",
             staff="Jane Roe", initials="Carol Dunn")
mc.hand_in("marErrors", [err_row(1), named, dict(err_row(5), staff="Jane Roe", initials="cd")],
           "2026-09-28T10:00:00Z")
mc.hand_in("missingMedications", [dict(miss_row(1), client_name="Carol Dunn")], "2026-09-28T10:05:00Z")
rows, _at = mc.build("medCorrelation", "")
text = json.dumps(rows).lower()
check("the study carries no row's free text, no staff name and no client's name",
      not any(s in text for s in ("carol", "dunn", "jane roe", "pharmacy did not")), text[:600])
check("the causes are counts only, and there is no staff board",
      "examples" not in rows[0]["causes"] and not any("staff" in k for k in rows[0])
      and rows[0]["causes"]["availability"] == 3, rows[0]["causes"])
check("an initials cell holding a name is cut to its initials and still meets the missing report",
      [(r["initials"], r["errors"], r["missing"]) for r in rows if r["kind"] == "client"] == [("CD", 2, 1)]
      and {c["client"]: c["count"] for c in rows[0]["top_error_clients"]} == {"AB": 1, "CD": 2}, rows)

print("\nhand-in")


def run_hand_in(bundle: dict[str, Any], tabs: Any) -> dict[str, Any]:
    calls: dict[str, Any] = {"tabs": []}

    async def _tabs_from_python(names: list[str]):
        calls["tabs"].append(list(names))
        if isinstance(tabs, Exception):
            raise tabs
        return {t: tabs[t] for t in names if t in tabs}, "2026-09-28T11:00:00Z", {}

    h = relay(_bundle_rows=lambda resource: bundle.get(resource), _tabs_from_python=_tabs_from_python)
    before = sorted(p.name for p in SNAP.iterdir())
    asyncio.run(h["_medcorr_hand_in"]())
    calls["written"] = sorted(p.name for p in SNAP.iterdir()) != before
    try:
        calls["study"] = mc.build("medCorrelation", "")[0][0]
    except RuntimeError as exc:
        calls["study"] = exc
    return calls


got = run_hand_in({"marErrors": ([err_row(1), err_row(2)], "2026-09-28T09:00:00Z"),
                   "missingMedications": ([miss_row(1)], "2026-09-28T09:00:00Z")}, {})
check("a fresh bundle answers both and no tab is read", not got["tabs"]
      and not isinstance(got["study"], Exception)
      and got["study"]["totals"]["mar_audit_rows"] == 2
      and got["study"]["totals"]["missing_meds"] == 1
      and got["study"]["slice_sources"]["marErrors"] == "2026-09-28T09:00:00Z", got)
check("nothing is written to the snapshot disk", not got["written"], None)

got = run_hand_in({}, {"mar_errors": [err_row(7)], "missing_medications": [miss_row(7), miss_row(8)]})
check("no bundle: ONE read names both tabs", got["tabs"] == [["mar_errors", "missing_medications"]]
      and not isinstance(got["study"], Exception)
      and got["study"]["totals"]["mar_audit_rows"] == 1
      and got["study"]["totals"]["missing_meds"] == 2, got)

got = run_hand_in({"marErrors": ([err_row(1)], "2026-09-28T09:00:00Z")},
                  {"missing_medications": [miss_row(3)]})
check("the bundle answers one: the read asks only for the other", got["tabs"] == [["missing_medications"]]
      and not isinstance(got["study"], Exception), got)

got = run_hand_in({"marErrors": ([], None)}, {"mar_errors": [], "missing_medications": [miss_row(1)]})
check("empty everywhere is a failed read, never a book with nothing in it",
      isinstance(got["study"], RuntimeError) and "marErrors" in str(got["study"]), got)

got = run_hand_in({}, RuntimeError("backend said 500"))
check("a refused tab read fails the study, which keeps its last file", isinstance(got["study"], RuntimeError), got)

print("\nnotify")
N = relay()
check("a /notify naming either book is queued", N["_mark_dirty"](["marErrors", "missingMedications", "nope"])
      == ["marErrors", "missingMedications"] and N["_dirty"] == {"marErrors", "missingMedications"}, N["_dirty"])

build_all = next(n for n in TREE.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "build_all")
wants = next((n.value for n in ast.walk(build_all) if isinstance(n, ast.Assign)
              and getattr(n.targets[0], "id", "") == "wants_medcorr"), None)
check("build_all decides wants_medcorr", wants is not None, None)
if wants is not None:
    expr = compile(ast.Expression(body=wants), "snapshot_service.py", "eval")

    def wants_for(only: set[str] | None) -> bool:
        return bool(eval(expr, {"medcorr_slices": mc, "only": only, "touched": set()}))  # noqa: S307

    check("a pass whose only names a book rebuilds the study",
          wants_for({"marErrors"}) and wants_for({"missingMedications"}), None)
    check("a full pass rebuilds it, an unrelated notify does not",
          wants_for(None) and not wants_for({"calendarGrid"}), None)

pkg = json.loads((ROOT / "package.json").read_text())
check("`npm run check` runs this file", "npm run test:mar-errors" in pkg["scripts"]["check"]
      and pkg["scripts"].get("test:mar-errors") == "python3 tools/test-mar-errors.py", None)

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
