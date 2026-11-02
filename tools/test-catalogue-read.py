"""smartCommsGet as the Smart Comms Catalogue reads it, on the live situations in asa-hub-db.
- The situations' book is named, and Postgres keeps its record.
- The lane's knobs come as written in the words book's Digest Settings, and every situation carries its rung of the
  ladder as comm_repair resolves it.
- The dial and test mode come with the read, so the page needs no second one.
Only the read is run: nothing is written, no door is asked.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-catalogue-read.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("CATALOGUE_READ_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_catalogue_read.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"CATALOGUE_READ_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import client_writes  # noqa: E402
import comm_repair as CR  # noqa: E402
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
master = next((u for u in reads.users() if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
got = SCD.desk_get(L.Session(reads, master), {})
data = got.get("data") or {}
check("the master reads the Desk", got.get("status") == 200, got.get("message"))

book = data.get("book") or {}
facts["situations book"] = book.get("name")
check("the situations' book is named, and Postgres keeps its record",
      bool(book.get("name")) and book.get("record") is True and book.get("id") == data.get("spreadsheet_id"), book)

lane = data.get("lane") or {}
settings, rungs = lane.get("settings"), lane.get("priorities")
check("every knob is answered, as written or empty", isinstance(settings, dict)
      and set(settings) == set(SCD.LANE_KNOBS) and all(isinstance(v, str) for v in settings.values()), lane.get("why"))
facts["knobs written"] = sorted(k for k, v in (settings or {}).items() if v)
words = (lane.get("book") or {})
facts["words book"] = words.get("name")
check("the words book is named", bool(words.get("name")), words)

ids = [gsjs.js_str(r.get("id")) for r in data.get("situations") or [] if gsjs.js_str(r.get("id"))]
check("every situation carries its rung", isinstance(rungs, dict) and set(ids) <= set(rungs)
      and set(rungs.values()) <= set(CR.PRIORITY_ORDER), sorted(set((rungs or {}).values())))
check("the rung is the lane's own answer", all(rungs[i] == CR.priority_for(reads, i) for i in ids[:40]))
counts: dict[str, int] = {}
for i in ids:
    counts[rungs[i]] = counts.get(rungs[i], 0) + 1
facts["rungs"] = counts
facts["situations"] = len(ids)

check("the dial and test mode come with the read", data.get("dial") in ("record", "send", "off")
      and isinstance((data.get("test_mode") or {}).get("on"), bool), {"dial": data.get("dial")})
facts["dial"] = data.get("dial")

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1))
