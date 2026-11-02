#!/usr/bin/env python3
"""UI Reports off asa-hub-db (app/ui_incidents.py), live in asa-hub-db-sync with this branch's modules streamed.

The master's list is compared row by row with the uiIncidents slice the relay serves today (from the sheet's mirror):
the same ids and the same cells the screen shows. A staff member reads every row, a client only their own, an unknown
role none; get answers one row by id and 404 for none; q narrows across every cell. Nothing is written."""
from __future__ import annotations

import argparse
import base64
import gzip
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
MODULES = ("gsjs", "hubdb", "editions", "scope", "drive", "locations", "writes", "photos", "clients", "client_sources",
           "dr_appointments", "ui_incidents")
SLICE = Path("/opt/docker/asa-hub/web/snapshot/uiIncidents.json")
SHOWN = ("id", "timestamp", "incident_date", "incident_time", "incident_category", "client_name", "incident_location",
         "your_name")

DRIVER = r'''
import base64, json, sys, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
import hubdb, gsjs, locations as L, scope as sc, drive as dr, ui_incidents as U
db = hubdb.HubDb(); drv = dr.Drive()
users = L.Reads(db, drv).users()
live = [u for u in users if not gsjs.str_(u.get("mergedinto"))]
boss = next(u for u in live if sc.is_master_email(u.get("email")) and gsjs.str_(u.get("role")) == "admin")
staff = next((u for u in live if gsjs.str_(u.get("role")) == "staff"), None)
client = next((u for u in live if gsjs.str_(u.get("role")) == "client" and gsjs.str_(u.get("clientkey"))), None)
odd = next((u for u in live if gsjs.str_(u.get("role")) == "onboarding"), None)
shown = blob["shown"]

def call(row, action, payload):
    try:
        return U.ACTIONS[action](L.Session(L.Reads(db, drv), sc.user_from_row(row)), payload)
    except Exception as e:
        return {"status": "raised", "message": type(e).__name__ + ": " + str(e)[:200], "data": []}

m = call(boss, "uiIncidentsList", {})
rows = m.get("data") or []
out = {"master": {"status": m.get("status"), "rows": len(rows), "cells": [{k: r.get(k) for k in shown} for r in rows]}}
if staff:
    s = call(staff, "uiIncidentsList", {})
    out["staff"] = {"status": s.get("status"), "rows": len(s.get("data") or [])}
if client:
    c = call(client, "uiIncidentsList", {})
    out["client"] = {"status": c.get("status"), "rows": len(c.get("data") or []),
                     "ids_in_master": all(r.get("id") in {x.get("id") for x in rows} for r in c.get("data") or [])}
if odd:
    out["onboarding"] = call(odd, "uiIncidentsList", {}).get("status")
first = rows[0]["id"] if rows else ""
out["get"] = call(boss, "uiIncidentsGet", {"id": first}).get("status")
out["get_none"] = call(boss, "uiIncidentsGet", {"id": "r999999"}).get("status")
word = (rows[0].get("incident_category") or "").split(" ")[0].lower() if rows else ""
q = call(boss, "uiIncidentsList", {"q": word}).get("data") or []
out["q"] = {"word": word, "rows": len(q),
            "all_match": all(any(word in gsjs.js_str(v).lower() for v in r.values()) for r in q)}
print(json.dumps(out, default=str))
'''

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: object = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:700]}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--runner", default="asa-hub-db-sync", help="never asa-hub-app (768 MiB)")
    args = ap.parse_args()
    blob = {"order": list(MODULES), "src": {m: (APP / f"{m}.py").read_text(encoding="utf-8") for m in MODULES},
            "shown": list(SHOWN)}
    got = subprocess.run(["docker", "exec", "-i", args.runner, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=600)
    if got.returncode != 0:
        print(got.stderr.decode()[-2000:])
        return 1
    o = json.loads(got.stdout.decode().strip().splitlines()[-1])
    raw = SLICE.read_bytes()
    try:
        raw = gzip.decompress(raw)
    except OSError:
        pass
    sliced = json.loads(raw)
    sliced = sliced.get("rows") if isinstance(sliced, dict) else sliced
    mine = {r["id"]: r for r in o["master"]["cells"]}
    theirs = {r.get("id"): {k: r.get(k) for k in SHOWN} for r in sliced}

    # the sheet's text keeps a timestamp rounded to the second, where Apps Script's Date carried its milliseconds
    def at(v: object) -> float | None:
        try:
            return datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None

    def same(a: dict, b: dict) -> bool:
        ta, tb = at(a.get("timestamp")), at(b.get("timestamp"))
        close = a.get("timestamp") == b.get("timestamp") or (ta is not None and tb is not None and abs(ta - tb) < 1)
        return close and all(a.get(k) == b.get(k) for k in SHOWN if k != "timestamp")
    differ = [i for i in theirs if i in mine and not same(mine[i], theirs[i])]
    print(json.dumps({k: v for k, v in o.items() if k != "master"} | {"master_rows": o["master"]["rows"],
                                                                      "slice_rows": len(theirs)}, indent=1))
    print("\nchecks")
    check("the master's list answers every incident off the copy", o["master"]["status"] == 200
          and o["master"]["rows"] >= 700, o["master"]["rows"])
    check("the same ids as the slice the relay serves today (a row the form added since may lead)",
          set(theirs) <= set(mine) and len(mine) - len(theirs) <= 5, (len(mine), len(theirs),
                                                                      sorted(set(theirs) - set(mine))[:5]))
    check("every shown cell equals the slice's (the timestamp within a second): date, time, category, client, place",
          not differ, [(i, mine[i], theirs[i]) for i in differ[:3]])
    check("a staff member reads every row", (o.get("staff") or {}).get("rows") == o["master"]["rows"], o.get("staff"))
    client = o.get("client")
    check("a client reads only their own rows", client is None
          or (client["status"] == 200 and client["rows"] < o["master"]["rows"] and client["ids_in_master"]), client)
    check("an onboarding account is refused", o.get("onboarding") in (403, None), o.get("onboarding"))
    check("get answers a row by id, 404 for none", o["get"] == 200 and o["get_none"] == 404, (o["get"], o["get_none"]))
    check("q narrows across every cell", o["q"]["rows"] > 0 and o["q"]["all_match"], o["q"])
    print(f"\ntest-ui-incidents: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
