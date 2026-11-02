"""A client's Incidents opens Locations' own new and edit panels, at the client's house.
- Every incident a client's Incidents lists names the house it is filed at (house_code).
- Each one is found, under the same row id, in that house's incidents as Locations reads them: the edit panel
  reads the incident from there and the edit door finds it by that id.
- The client is one of that house's current clients, as the file and edit doors ask.
Only the reads are run: nothing is written, no door is asked to write.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-client-incidents-panels.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("CLIENT_INCIDENTS_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_client_incidents_panels.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"CLIENT_INCIDENTS_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import re  # noqa: E402
import time  # noqa: E402

import client_writes  # noqa: E402
import clients as C  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import scope as sc  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


db = hubdb.HubDb()
# the kept edits laid over the copy, as main._own lays them over every read
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
reads = L.Reads(db, None)
master = next((u for u in reads.users() if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
sess = L.Session(reads, master)

roster = [c for c in C.derived(reads) if gsjs.trim(gsjs.or_text(c.get("client_key")))]
houses: dict[str, list] = {}
listed = found = codeless = 0
missing: list[str] = []
not_current: list[str] = []
houseless: set[str] = set()
for c in roster:
    ctx = C.client_ctx(reads, c.get("client_key"))
    if ctx.get("refused") or ctx.get("archived"):
        continue
    rows = C.incidents_build(reads, ctx).get("rows") or []
    for r in rows:
        listed += 1
        code = gsjs.text(r.get("house_code")).upper()
        if not code:
            codeless += 1
            houseless.add(gsjs.text(ctx["row"].get("house")) or "(no house)")
            continue
        if code not in houses:
            got = L.location_incidents(sess, {"house": code})
            houses[code] = ((got.get("data") or {}).get("rows") or []) if got.get("status") == 200 else []
        hit = next((x for x in houses[code] if x.get("id") == r["id"]), None)
        if hit is None:
            missing.append(f"{ctx['name']} {r['id']} @ {code}")
            continue
        found += 1
        if gsjs.text(hit.get("client_name")).lower() != gsjs.text(r.get("client_name")).lower():
            not_current.append(f"{ctx['name']} {r['id']} @ {code}: {hit.get('client_name')}")

facts["clients"] = len(roster)
facts["incidents listed"] = listed
facts["found at their house"] = found
facts["without a house code"] = codeless
facts["their houses, as the roster names them"] = sorted(houseless)
facts["houses read"] = len(houses)
check("clients list incidents", listed > 0, listed)
check("every listed incident has a row id the edit door finds", all(
    re.fullmatch(r"r\d+", x["id"]) for v in houses.values() for x in v), "")
check("each is in its house's incidents under the same id", not missing, missing[:6])
check("the house names the same client", not not_current, not_current[:6])

print(json.dumps({"facts": facts, "results": results,
                  "failed": [k for k, v in results.items() if v != "ok"]}, indent=1))
