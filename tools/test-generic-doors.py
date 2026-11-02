"""The books kept on 10-27 asked through the front door, as the SPA asks them: each resource's generic verbs mapped to
their doors by app/front_door_routes.json (front_door.generic_door's table, never App Studio's builder), each door run
as main.py runs it (generic_rows READS_OF / generic_rows_writes WRITES_OF). The master lists and gets every resource; an
admin App Control has not released it to is refused; on one resource of each app a row is made, changed and removed.
One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-generic-doors.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("GENERIC_DOORS_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_generic_doors.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    routes = json.load(open(os.path.join("app", "front_door_routes.json"), encoding="utf-8"))["generic"]["doors"]
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"GENERIC_DOORS_INPROC": "1", "ROUTES": json.dumps(routes)})],
                         capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-3000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import generic_rows as GR  # noqa: E402
import generic_rows_writes as GW  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

DOORS = {(r, v): d for r, v, d in json.loads(os.environ["ROUTES"])}
NEW = [r for r, s in SR.SPECS.items() if s.get("app") and r in GR.ROUTES]
results: dict[str, str] = {}
listed: dict[str, int] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:200]}"


def door(resource: str, verb: str):
    name = DOORS.get((resource, verb))
    app = GR.ROUTES[resource][0]
    table = GR.READS_OF[app] if verb in ("list", "get") else GW.WRITES_OF[app]
    return name, table.get(name or "")


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
users = L.Reads(db, None).users()
master = next(u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT)
other = next(u for u in users if gsjs.str_(u.get("role")) == "admin"
             and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT)
for res in NEW:
    for verb in GR.VERBS:
        name, fn = door(res, verb)
        if name is None or fn is None:
            check(f"{res} {verb}: the front door names its own door", False, name)
    name, fn = door(res, "list")
    if fn is None:
        continue
    got = fn(L.Session(L.Reads(db, None), master), {})
    listed[res] = len(got.get("data") or [])
    check(f"{res}: the master lists it through {name}", got.get("status") == 200 and listed[res] > 0, got.get("status"))
    refused = fn(L.Session(L.Reads(db, None), other), {})
    check(f"{res}: an admin not released to it is refused", refused.get("status") == 403, refused.get("status"))
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        firsts: dict[str, str] = {}
        for res in NEW:
            firsts.setdefault(GR.ROUTES[res][0], res)
        for app, res in firsts.items():
            tok = SC._WRITE.set({"write_id": "Wzzdoorcheck" + app[:6]})
            m = L.Session(L.Reads(db, None), master)
            row = (door(res, "list")[1](m, {}).get("data") or [{}])[0]
            col = next(k for k in row if k not in ("id", "createdAt", "updatedAt"))
            got = door(res, "get")[1](m, {"id": row.get("id")})
            made = door(res, "create")[1](L.Session(L.Reads(db, None), master), {col: "zz made at the door"})
            changed = door(res, "update")[1](L.Session(L.Reads(db, None), master),
                                             {"id": row.get("id"), col: "zz changed at the door"})
            new_id = (made.answer.get("data") or {}).get("id")
            gone = door(res, "delete")[1](L.Session(L.Reads(db, None), master), {"id": new_id})
            check(f"{app} ({res}): get, create, update and delete through the doors",
                  got.get("status") == 200 and all(d.answer.get("status") == 200 for d in (made, changed, gone)),
                  [got.get("status")] + [d.answer.get("status") for d in (made, changed, gone)])
            SC._WRITE.reset(tok)
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"resources": len(NEW), "listed": listed,
                  "results": {k: v for k, v in results.items() if v != "ok"} or f"all {len(results)} ok",
                  "failed": [k for k, v in results.items() if v != "ok"]}, indent=0, default=str))
