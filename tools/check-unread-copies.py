"""The copies no Hub reader opens, proved already held by the Hub's own record before their keeper stops:

- ASA Hiring — Store: every dissolved tab's rows by their key in the Essencial's facts (candidates.legacy_rows); a
  configuration tab's rows by their note (or action), since the copy withholds a cell named key — a value that
  differs there is a later decision, not a lost one;
- the old Chat houses (ASA Data — ChatMessages, ChatPresence): every message by its id in app.chat_messages, every
  person in app.chat_presence.

Read only. From the repo root:

    RUNNER=<scratchpad> python3 tools/check-unread-copies.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("UNREAD_COPIES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "check_unread_copies.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"UNREAD_COPIES_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-6000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import candidates as CND  # noqa: E402
import client_writes  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import writes as W  # noqa: E402

STORE = "ASA Hiring — Store"
# a configuration tab's rows told apart by what the copy does not withhold
BY_TEXT = {"hiring_alerts_config": "note", "hiring_sim_config": "note", "recruitment_config": "whatitdoes",
           "hiring_policy": "action"}
results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
reads = L.Reads(db, None)
cat = db.catalog()
store = next((s for s, b in cat["books"].items() if getattr(b, "name", "") == STORE), "")
check(f"{STORE} is a book asa-hub-db holds", bool(store))


def cells(raw: dict) -> dict[str, str]:
    return {hubdb.norm_key(h): gsjs.trim(gsjs.or_blank(hubdb.typed(v, "raw"))) for h, v in raw.items()
            if hubdb.norm_key(h)}


for (s, tab), ref in sorted(cat["tabs"].items()):
    if s != store or not db.dissolved(tab):
        continue
    copy = [cells(raw) for _rn, raw in db.rows(ref)]
    held = CND.legacy_rows(reads, tab) or []
    by = BY_TEXT.get(tab) or CND.HIRING_TAB_KEY.get(tab, "candidateid")
    have = {gsjs.trim(gsjs.or_blank(r.get(by))) for r in held}
    lost = [r.get(by, "") for r in copy if r.get(by, "") and r.get(by, "") not in have]
    facts[tab] = {"store": len(copy), "the Hub's record": len(held)}
    check(f"{tab}: every store row is in the Hub's record (by {by})", not lost, lost[:3])
for house, table, col in (("chat_messages", "app.chat_messages", "message_id"),
                          ("chat_presence", "app.chat_presence", "user_id")):
    res = db.resolve(house)
    copy = [cells(raw) for _rn, raw in db.rows(res.ref)] if res.ref else []
    have = {str(v) for (v,) in db.query(f"select {col} from {table}")}  # noqa: S608 - fixed names
    lost = [r.get(col.replace("_", ""), "") for r in copy if r.get(col.replace("_", ""), "") not in have]
    facts[house] = {"copy": len(copy), table: len(have)}
    check(f"{house}: every row is in {table} (by {col})", not lost, lost[:3])

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
