"""smartCommsHistory as the Smart Comms Activity reads it, on the live houses in asa-hub-db.
- Test mode's position comes with the trail.
- Every house the lane writes is found where it lives now: its book named, its rows counted as every read sees them.
- What test mode held comes newest first from app.comm_rehearsal, its words for an admin only.
Only the read is run: nothing is written, no door is asked.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-activity-read.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("ACTIVITY_READ_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_activity_read.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"ACTIVITY_READ_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import client_writes  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import scope as sc  # noqa: E402
import smart_comms_desk as SCD  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


db = hubdb.HubDb()
# the kept edits laid over the copy, as main._own lays them over every read
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
reads = L.Reads(db, None)
users = reads.users()
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
started = time.time()
got = SCD.history(L.Session(reads, master), {"limit": 500})
facts["seconds"] = round(time.time() - started, 2)
data = got.get("data") or {}
check("the master reads the trail", got.get("status") == 200, got.get("message"))
check("test mode comes with it", isinstance((data.get("test_mode") or {}).get("on"), bool), data.get("test_mode"))
facts["test mode on"] = (data.get("test_mode") or {}).get("on")

hs = data.get("houses") or []
check("every house the lane writes is answered", [h["id"] for h in hs] == list(SCD.ACTIVITY_HOUSES), hs)
check("each found where it lives, with its book and its rows",
      all(h.get("name") and isinstance(h.get("rows"), int) for h in hs), [h for h in hs if not h.get("name")])
facts["houses"] = {h["id"]: [h.get("name"), h.get("rows"), "record" if h.get("record") else "copy"] for h in hs}

reh = data.get("rehearsals") or {}
rows = reh.get("rows")
check("what test mode held comes with it", isinstance(rows, list) and len(rows) <= SCD.REHEARSALS_SHOWN, reh.get("why"))
stamps = [r["at"] for r in rows or [] if r.get("at")]
check("newest first", stamps == sorted(stamps, reverse=True), stamps[:5])
check("the master reads their words", bool(rows) and any(r.get("body") for r in rows))
manager = next((u for u in users if gsjs.str_(u.get("role")) == "manager" and not gsjs.str_(u.get("clientkey"))), None)
if manager is not None:
    m = SCD.history(L.Session(reads, manager), {"limit": 5}).get("data") or {}
    check("a manager reads who and when, never the words",
          all(not r.get("body") and not r.get("subject") for r in (m.get("rehearsals") or {}).get("rows") or []))
facts["rehearsals"] = len(rows or [])
facts["newest rehearsal"] = stamps[0] if stamps else ""
dels = data.get("deliveries") or []
facts["deliveries"] = len(dels)
check("every delivery says it was sent, and none carries its ledger key out",
      all(d.get("status") == "sent" and "key" not in d for d in dels), dels[:2])
facts["deliveries with their words"] = sum(1 for d in dels if d.get("text") or d.get("subject"))
check("what did not leave is read (a list, maybe empty), never left unsaid",
      isinstance(data.get("not_sent"), list), data.get("not_sent"))
facts["not sent"] = len(data.get("not_sent") or [])

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1))
