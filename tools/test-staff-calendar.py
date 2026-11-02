#!/usr/bin/env python3
"""Staff › Calendar on the live rows: schedulingStaffShifts through Staff answers the shifts from today on (the Ohio
day) that carry a time — never a past day, nor a cell naming another house ("MS", "48th (A)") or a word with no hours.
Run in asa-hub-db-sync (never inside asa-hub-app) on this checkout's modules, streamed, for every active staff member,
and once on asa_dev's own modules for the same person to show what the cut leaves out. Read only; prints counts."""
from __future__ import annotations

import base64
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
RUNNER = "asa-hub-db-sync"
_spec = importlib.util.spec_from_file_location("staff_ist_add", ROOT / "tools" / "test-staff-ist-add.py")
_ist = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_ist)
check, results = _ist.check, _ist.results

DRIVER = r'''
import base64, json, sys, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
import gsjs, hubdb, locations as L, scheduling as SCH, scope as sc, staff_app as SA
db = hubdb.HubDb()
reads = L.Reads(db, None)
boss = next((u for u in reads.users() if not gsjs.str_(u.get("mergedinto")) and sc.is_master_email(u.get("email"))
             and gsjs.str_(u.get("role")) == "admin"), None)
master = sc.user_from_row(boss) if boss else None
today = reads.today()
roster = SA.ACTIONS["staffProfileRoster"](L.Session(L.Reads(db, None), master), {})
keys = [r["key"] for r in ((roster.get("data") or {}).get("staff") or [])
        if r.get("status") == "active" and not r.get("ambiguous")]
if blob["only"]:
    keys = [k for k in keys if k == blob["only"]]
out = {"today": today, "staff": len(keys), "answered": 0, "shifts": 0, "past": 0, "untimed": 0, "kinds": {}}
for k in keys:
    env = SCH.staff_shifts(L.Session(L.Reads(db, None), master), {"person": k, "via": "staff"})
    if env.get("status") != 200:
        continue
    out["answered"] += 1
    for s in (env.get("data") or {}).get("shifts") or []:
        out["shifts"] += 1
        out["past"] += s["date"] < today
        out["untimed"] += not isinstance(s.get("start"), (int, float))
        out["kinds"][s["kind"]] = out["kinds"].get(s["kind"], 0) + 1
print(json.dumps(out, default=str))
'''


def run(app: Path, only: str) -> dict[str, Any] | None:
    _ist.APP = app  # the closure walks the tree it is pointed at: this checkout's, or asa_dev's own
    try:
        order = _ist.closure(("scheduling", "staff_app"))
    finally:
        _ist.APP = APP
    blob = {"order": order, "src": {m: (app / f"{m}.py").read_text(encoding="utf-8") for m in order}, "only": only}
    decl = (app / "ist_config_defaults.json").read_text(encoding="utf-8")
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", "-e",
                          "HUB_IST_CONFIG_DECLARATION_JSON=" + decl, RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=900)
    if got.returncode != 0:
        check("the door ran in the runner", False, got.stderr.decode()[-1500:])
        return None
    return json.loads(got.stdout.decode().strip().splitlines()[-1])


def main() -> int:
    who = sys.argv[1] if len(sys.argv) > 1 else "adriannawilliams"
    print(f"Staff › Calendar (schedulingStaffShifts via staff) in {RUNNER}, read only")
    new = run(APP, "")
    if new:
        print(f"  {new['answered']}/{new['staff']} active staff answered on {new['today']}: {new['shifts']} shift(s), "
              f"kinds {new['kinds']}")
        check("every active staff member's calendar answers", new["answered"] == new["staff"], new["answered"])
        check("no shift before today (the Ohio day)", new["past"] == 0, new["past"])
        check("every shift carries a start and an end", new["untimed"] == 0, new["untimed"])
        check("no alias, off or R/O cell is listed", not set(new["kinds"]) & {"alias", "off", "ro", ""}, new["kinds"])
    base = Path("/opt/docker/asa-hub/app")
    one_new, one_old = run(APP, who), run(base, who)
    if one_new and one_old:
        print(f"  {who}: {one_old['shifts']} row(s) before ({one_old['past']} past, {one_old['untimed']} untimed, kinds "
              f"{one_old['kinds']}) → {one_new['shifts']} now")
        check(f"{who}: the cut leaves out exactly the past and the untimed rows",
              one_new["shifts"] <= one_old["shifts"] and one_new["past"] == one_new["untimed"] == 0, [one_old, one_new])
    print(f"\ntest-staff-calendar: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
