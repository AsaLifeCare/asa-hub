#!/usr/bin/env python3
"""Staff › Related Clients on the live rows: the clients a person worked with (a punch names them, or a past shift at
the home they alone live in) and the IST recorded for one that holds none (staffProfileIstAdd). The doors run in
asa-hub-db-sync (never inside asa-hub-app) on this checkout's modules, streamed; the IST written lives on one
transaction that is rolled back at the end, never committed, and is looked for again afterwards. Prints shapes and
counts only — no name, no value."""
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
import base64, json, sys, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
import psycopg
import gsjs, hubdb, ist as IST, locations as L, scope as sc, staff as SP, staff_app as SA, staff_views, staff_writes as SW
import writes as W

staff_views.record = lambda *a, **k: None  # the activity line is the write store's; none here
db = hubdb.HubDb()
out = {"checks": []}


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


def overview(key):
    env = SA.ACTIONS["staffProfileOverview"](L.Session(fresh(), master), {"staff": key})
    return env.get("status"), env.get("data") or {}


# 1. who Related Clients lists, for every active staff member
roster = SA.ACTIONS["staffProfileRoster"](L.Session(fresh(), master), {})
active = [r["key"] for r in ((roster.get("data") or {}).get("staff") or [])
          if r.get("status") == "active" and not r.get("ambiguous")]
rows = shapes = 0
undated = untied = 0
pick = None
for key in active:
    st, o = overview(key)
    if st != 200:
        continue
    shapes += 1
    ist_keys = {r.get("client_key") for r in o.get("ist") or [] if r.get("client_key")}
    for c in o.get("clients") or []:
        rows += 1
        undated += 0 if c.get("first_day") and c.get("last_day") else 1
        untied += 0 if set(c.get("via") or []) and set(c["via"]) <= {"punches", "house"} else 1
    held = [c for c in o.get("clients") or [] if c["client_key"] in ist_keys]
    free = [c for c in o.get("clients") or [] if c["client_key"] not in ist_keys
            and (L.house_code(c.get("house")) or L.code_of(c.get("house")))]
    if pick is None and held and free:
        pick = {"key": key, "free": free[0], "held": held[0]}
out["counts"] = {"staff": len(active), "answered": shapes, "rows": rows}
check("every active staff member's overview answers", shapes == len(active), [shapes, len(active)])
check("every related client is tied by a punch or a shift at their own home, never by an IST alone", untied == 0, untied)
check("every related client has a first and a last day worked", undated == 0, undated)
check("a staff member with a client holding an IST and one holding none", pick is not None)

# 2. staffProfileIstAdd, on one transaction rolled back at the end
conn = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="staff-ist-add-check")
cur = conn.cursor()
tok = W.HELD.set(cur)
made = []
try:
    def add(user, **payload):
        d = SW.ACTIONS["staffProfileIstAdd"](L.Session(fresh(), user), payload)
        return d.answer or {}

    if pick:
        key, free, held = pick["key"], pick["free"], pick["held"]
        today = fresh().today()
        check("the IST records live in Postgres", IST.owned(db))
        a = add(worker, key=key, client=free["client_key"], status="done", day=today)
        check("a staff account holding no staff.ist edition: the unknown action", a == SP.unknown(), a.get("status"))
        for name, payload, want in (
                ("a status that is neither owed nor done", {"status": "maybe", "day": today}, 400),
                ("a day that is not yyyy-MM-dd", {"status": "done", "day": "10/29/2026"}, 400),
                ("a trained day after today", {"status": "done", "day": gsjs.day_shift(today, 1)}, 400),
                ("a client no record answers to", {"status": "done", "day": today, "client": "nobody_here_x"}, 404),
                ("a client whose pair already holds a record", {"status": "done", "day": today,
                                                                "client": held["client_key"]}, 409)):
            a = add(master, key=key, **{"client": free["client_key"], **payload})
            check(f"refused: {name} ({want})", a.get("status") == want, a.get("status"))
        cur.execute("savepoint owed_case")
        due = gsjs.day_shift(today, 14)
        a = add(master, key=key, client=free["client_key"], status="owed", day=due)
        rec = next((r for r in IST.records(fresh()) if gsjs.str_(r.get("id")) == (a.get("data") or {}).get("id")), {})
        made.append((a.get("data") or {}).get("id"))
        check("owed: recorded with the due day and no trained day",
              a.get("status") == 200 and rec.get("status") == "owed" and rec.get("dueDate") == due
              and not rec.get("trainedAt"), [a.get("status"), rec.get("status")])
        cur.execute("rollback to savepoint owed_case")
        a = add(master, key=key, client=free["client_key"], status="done", day=today)
        data = a.get("data") or {}
        made.append(data.get("id"))
        rec = next((r for r in IST.records(fresh()) if gsjs.str_(r.get("id")) == data.get("id")), {})
        code = L.house_code(free.get("house")) or L.code_of(free.get("house"))
        check("the master records a trained IST: 200, its id, at the client's house",
              a.get("status") == 200 and data.get("id") and data.get("house") == code, a.get("status"))
        check("the record pairs the staff member and the client, done, trained and due on the day",
              rec and gsjs.name_key(rec.get("clientName")) == gsjs.name_key(free["name"])
              and rec.get("status") == "done" and rec.get("trainedAt") == today and rec.get("dueDate") == today
              and rec.get("house") == code, sorted(rec))
        st, o = overview(key)
        shown = [r for r in o.get("ist") or [] if r.get("id") == data.get("id")]
        check("the next overview shows it keyed to the client, so Related Clients draws its day and pencil",
              st == 200 and len(shown) == 1 and shown[0].get("client_key") == free["client_key"]
              and shown[0].get("trained_at") == today, shown)
        a = add(master, key=key, client=free["client_key"], status="done", day=today)
        check("the same client again: 409, never a second record", a.get("status") == 409, a.get("status"))
finally:
    W.HELD.reset(tok)
    conn.rollback()
    conn.close()
left = [i for i in made if i and db.query("select 1 from app.resource_rows where resource = %s and row_id = %s",
                                          (IST.RECORDS, i))]
check("nothing is left: the transaction was rolled back", not left, len(left))
print(json.dumps(out, default=str))
'''


def main() -> int:
    order = closure(("staff_app", "staff_writes"))
    blob = {"order": order, "src": {m: (APP / f"{m}.py").read_text(encoding="utf-8") for m in order}}
    decl = (APP / "ist_config_defaults.json").read_text(encoding="utf-8")
    print(f"Staff › Related Clients and staffProfileIstAdd in {RUNNER} ({len(order)} modules, streamed; rolled back)")
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", "-e",
                          "HUB_IST_CONFIG_DECLARATION_JSON=" + decl, RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=900)
    if got.returncode != 0:
        check("the doors ran in the runner", False, got.stderr.decode()[-1500:])
    else:
        py = json.loads(got.stdout.decode().strip().splitlines()[-1])
        c = py.get("counts") or {}
        print(f"  {c.get('answered')}/{c.get('staff')} active staff answered, {c.get('rows')} related client row(s)")
        for name, ok, detail in py["checks"]:
            check(name, ok, detail)
    print(f"\ntest-staff-ist-add: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
