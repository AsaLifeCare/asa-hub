#!/usr/bin/env python3
"""The approved time off's panel on the live rows (app/time_off_approved.py): Scheduling's Time Off Requests hands every
approved time off its impacted shifts, the person's approved days that year and Edit for its approvers alone; the
Time Off app's record gets the same facts and its `may.edit`. Runs in asa-hub-db-sync (never inside asa-hub-app) on
this checkout's modules, streamed, on a read-only connection; prints counts only — no name, no value."""
from __future__ import annotations

import ast
import base64
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
RUNNER = "asa-hub-db-sync"

results: dict[str, Any] = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: Any = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:600]}")


def closure(roots: tuple[str, ...]) -> list[str]:
    """Every app module the roots import, those a module imports at its top first; a function's own imports after."""
    order: list[str] = []
    seen: set[str] = set()
    later: list[str] = []

    def names(nodes: Any) -> Any:
        for node in nodes:
            if isinstance(node, ast.Import):
                for a in node.names:
                    yield a.name.split(".")[0]
            elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                yield node.module.split(".")[0]

    def visit(name: str) -> None:
        if name in seen or not (APP / f"{name}.py").exists():
            return
        seen.add(name)
        tree = ast.parse((APP / f"{name}.py").read_text(encoding="utf-8"))
        top = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom))]
        top += [n for t in tree.body if isinstance(t, ast.Try) for n in t.body if isinstance(n, (ast.Import, ast.ImportFrom))]
        for n in names(top):
            visit(n)
        later.extend(names(ast.walk(tree)))
        order.append(name)

    for r in roots:
        visit(r)
    while later:
        visit(later.pop())
    return order


DRIVER = r'''
import base64, importlib.abc, importlib.machinery, json, sys, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())


class WebStub(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    """The runner has no web framework; the lanes' modules only name its classes, and nothing here serves a request."""
    def find_spec(self, name, path, target=None):
        if name.split(".")[0] in ("fastapi", "starlette"):
            return importlib.machinery.ModuleSpec(name, self, is_package=True)
        return None

    def create_module(self, spec):
        m = types.ModuleType(spec.name)
        m.__path__ = []
        m.__getattr__ = lambda attr: type(attr, (), {"__init__": lambda self, *a, **k: None})
        return m

    def exec_module(self, module):
        pass


sys.meta_path.append(WebStub())
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
unloaded = []
for name in blob["order"]:
    try:
        exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
    except Exception as exc:  # a module the app's own tree feeds (a file beside it): these reads never call it
        if name in ("time_off_approved", "scheduling", "time_off", "editions", "locations", "scope", "hubdb", "lanes_pg"):
            raise
        unloaded.append(f"{name}: {type(exc).__name__}")
import psycopg
import gsjs, hubdb, lanes_pg, locations as L, scope as sc, scheduling as SCH, time_off, time_off_approved as TA

# every read the Time Off module makes goes over one read-only connection: nothing here can write
def reader():
    return psycopg.connect(hubdb._dsn(), autocommit=True, options="-c default_transaction_read_only=on")
lanes_pg.CONNECT["own"] = reader
lanes_pg.CONNECT["spare"] = reader
db = hubdb.HubDb()
out = {"checks": [], "counts": {"unloaded": len(unloaded)}}


def check(name, ok, detail=None):
    out["checks"].append([name, bool(ok), None if ok else detail])


def fresh():
    return L.Reads(db, None)


users = fresh().users()
live = [u for u in users if not gsjs.str_(u.get("mergedinto"))]
boss = next((u for u in live if sc.is_master_email(u.get("email")) and gsjs.str_(u.get("role")) == "admin"), None)
plain = next((u for u in live if gsjs.str_(u.get("role")) == "staff" and not sc.is_master_email(u.get("email"))
              and not gsjs.str_(u.get("clientkey"))), None)
master = sc.user_from_row(boss) if boss else None
worker = sc.user_from_row(plain) if plain else None
check("the master and a plain staff account are on the live rows", master is not None and worker is not None)

# 1. Scheduling's list, as the master: every approved time off carries its facts, and Edit
env = SCH.time_off_list(L.Session(fresh(), master), {"past": True})
data = env.get("data") or {}
check("Time Off Requests answers the master", env.get("status") == 200, env.get("message"))
asks = [a for a in data.get("approved") or [] if a.get("kind") == "time_off"]
out["counts"]["approved_time_off"] = len(asks)
facts = [a.get("approved") for a in asks]
check("every approved time off carries its panel's facts", all(isinstance(f, dict) for f in facts) and asks,
      len([f for f in facts if not isinstance(f, dict)]))
nope = [f for f in facts if isinstance(f, dict) and (f.get("shifts") is None or f.get("year_days") is None)]
check("its shifts and its year's days were read, none said unreadable", not nope,
      sorted({(f.get("shifts_why") or "") + " | " + (f.get("year_why") or "") for f in nope})[:3])
short = [a for a in asks if isinstance(a.get("approved"), dict) and a["approved"].get("year_days") is not None
         and a["from"][:4] == a["to"][:4] and a["approved"]["year_days"] < a["days"]]
check("the year's days hold at least the request's own days", not short, len(short))
out["counts"]["shifts"] = sum(len((f or {}).get("shifts") or []) for f in facts)
out["counts"]["overnight"] = sum(1 for f in facts for s in (f or {}).get("shifts") or [] if s["end_min"] > 1440)
check("Edit is the master's on every approved time off", all(a.get("may_edit") is True for a in asks),
      len([a for a in asks if a.get("may_edit") is not True]))
# the approvers' side: every waiting ask (and every Request Off) opens on the same panel, its facts and Edit included
waiting = data.get("pending") or []
others = waiting + [a for a in data.get("approved") or [] if a.get("kind") != "time_off"]
out["counts"]["waiting"] = len(waiting)
check("every waiting ask and Request Off carries the panel's facts", all(isinstance(a.get("approved"), dict) for a in others),
      len([a for a in others if not isinstance(a.get("approved"), dict)]))
check("their shifts and year's days were read", not [a for a in others if (a.get("approved") or {}).get("shifts") is None
                                                     or (a.get("approved") or {}).get("year_days") is None])
check("Edit is the master's on every ask he does not own", all(a.get("may_edit") is True for a in others if not a.get("own")),
      len([a for a in others if not a.get("own") and a.get("may_edit") is not True]))

# 2. as a plain staff member: never Edit
env = SCH.time_off_list(L.Session(fresh(), worker), {"past": True})
mine = (env.get("data") or {}).get("approved") or []
out["counts"]["staff_sees"] = len(mine)
check("a plain staff member is never handed Edit", env.get("status") != 200 or not any(a.get("may_edit") for a in mine),
      env.get("status"))

# 3. the overlap law on the live cells: an overnight on the eve counts, a shift ending at the first midnight does not
reads = fresh()
night = next((c for c in SCH.read_tab(reads, SCH.TABS["cells"]) if c["row_id"].startswith("P:") and SCH.flow_holds(c)
              and (SCH.js_num(c["end_min"]) or 0) > 1440), None)
check("an overnight shift is on the live calendars", night is not None)
if night:
    key = night["row_id"][2:]
    nxt = TA._day(night["date"]).toordinal() + 1
    from datetime import date
    after = date.fromordinal(nxt).isoformat()
    got = TA.impacted(reads, key, after, after)
    hit = [s for s in got if s["date"] == night["date"] and s["house_code"] == night["house_code"]]
    check("the eve's overnight overlaps the first day off", hit and hit[0]["end_min"] > 1440, len(got))
    later = date.fromordinal(nxt + 1).isoformat()
    check("it does not overlap the day after", not [s for s in TA.impacted(reads, key, later, later)
                                                   if s["date"] == night["date"]])

# 4. the Time Off app's own record: its facts, and Edit for its approvers
rows = time_off.rows(time_off.KEPT_DSN)
sched = [r for r in rows if r.get("status") == time_off.SCHEDULED]
out["counts"]["time_off_scheduled"] = len(sched)
if sched:
    r = sched[0]
    f = TA.of_detail({"person": r.get("person"), "start": r.get("start_date"), "end": r.get("end_date")})
    check("a scheduled Time Off request reads its shifts and its year's days",
          f["shifts"] is not None and f["year_days"] is not None, (f["shifts_why"], f["year_why"]))
    dirs = ["Dee Rector"]
    base = {"name": "Mia Manager", "manages": [], "decides_everywhere": False}
    house = (time_off._list(r.get("houses")) or ["ZZ1"])[0]
    row = {**r, "person": "Ann Roe", "filed_by": "Ann Roe", "houses": house}
    check("its person is never handed Edit", not time_off.may_edit({**base, "name": "Ann Roe", "decides_everywhere": True}, row, dirs))
    check("whoever filed it is never handed Edit",
          not time_off.may_edit({**base, "name": "Fay Filer", "decides_everywhere": True}, {**row, "filed_by": "Fay Filer"}, dirs))
    check("a listed director is", time_off.may_edit({**base, "name": "Dee Rector"}, row, dirs))
    check("its house's manager is", time_off.may_edit({**base, "manages": [house]}, row, dirs))
    check("anyone else is not", not time_off.may_edit(base, row, dirs))
    check("may_edit alone gives a waiting request no Edit (its decider's comes from the detail's leg)",
          not time_off.may_edit({**base, "name": "Dee Rector"}, {**row, "status": time_off.PENDING}, dirs))
pend = [r for r in rows if r.get("status") == time_off.PENDING]
out["counts"]["time_off_pending"] = len(pend)
if pend:
    r = pend[0]
    f = TA.of_detail({"person": r.get("person"), "start": r.get("start_date"), "end": r.get("end_date")})
    check("a waiting Time Off request reads its shifts and its year's days (the approver's panel)",
          f["shifts"] is not None and f["year_days"] is not None, (f["shifts_why"], f["year_why"]))
print(json.dumps(out, default=str))
'''


def main() -> int:
    order = closure(("time_off_approved", "scheduling", "editions"))
    blob = {"order": order, "src": {m: (APP / f"{m}.py").read_text(encoding="utf-8") for m in order}}
    decl = (APP / "ist_config_defaults.json").read_text(encoding="utf-8")
    print(f"The approved time off's panel in {RUNNER} ({len(order)} modules, streamed; read-only)")
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", "-e",
                          "HUB_IST_CONFIG_DECLARATION_JSON=" + decl, RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=900)
    if got.returncode != 0:
        check("the doors ran in the runner", False, got.stderr.decode()[-1500:])
    else:
        py = json.loads(got.stdout.decode().strip().splitlines()[-1])
        print(f"  counts: {json.dumps(py.get('counts'))}")
        for name, ok, detail in py["checks"]:
            check(name, ok, detail)
    print(f"\ntest-time-off-approved: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
