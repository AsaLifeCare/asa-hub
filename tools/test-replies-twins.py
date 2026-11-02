"""commReplies on the live contributions in asa-hub-db: one message a person sent that reached several of our lines
is one card, carrying `twins`; a closed twin speaks for the card; nothing else folds.
Only the read is run: nothing is written, no door is asked.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-replies-twins.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("REPLIES_TWINS_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_replies_twins.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"REPLIES_TWINS_INPROC": "1"})], capture_output=True, text=True, timeout=600)
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
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
reads = L.Reads(db, None)
master = next((u for u in reads.users() if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
raw = SCD.board_rows(reads, SCD.COMM_CONTRIBUTIONS_HOUSE)
got = SCD.replies(L.Session(reads, master), {"all": True})
rows = (got.get("data") or {}).get("rows") or []
facts["contributions"], facts["cards"] = len(raw), len(rows)
facts["folded"] = sum(int(r.get("twins") or 0) for r in rows)
check("the master reads the replies", got.get("status") == 200, got.get("message"))
keys = [(gsjs.or_text(r.get("person_key")), " ".join(gsjs.or_text(r.get("text")).split()).lower(),
         gsjs.or_text(r.get("received_at"))) for r in rows if r.get("person_key") and r.get("text")]
check("no two cards are one message", len(keys) == len(set(keys)), len(keys) - len(set(keys)))
every = SCD.fold_twins(list(raw))
facts["all cards"], facts["all folded"] = len(every), sum(int(r.get("twins") or 0) for r in every)
check("every row is a card or a folded twin (the door shows the newest 500)",
      len(raw) == facts["all cards"] + facts["all folded"] and len(rows) <= 500, facts)
bull = [r for r in rows if "bullhorn" in gsjs.or_text(r.get("text")).lower()]
check("the bullhorn text that reached two lines is one card, saying so",
      len(bull) == 1 and bull[0].get("twins") == 1, [(r.get("id"), r.get("twins")) for r in bull])
pair = [{"id": "a", "person_key": "p", "text": "Hi", "received_at": "t", "state": "needs_human"},
        {"id": "b", "person_key": "p", "text": "hi ", "received_at": "t", "state": "dismissed"}]
lead = SCD.fold_twins(pair)
check("a closed twin speaks for the card", len(lead) == 1 and lead[0]["id"] == "b" and lead[0]["twins"] == 1, lead)
apart = SCD.fold_twins([{**pair[0]}, {**pair[0], "id": "c", "received_at": "u"}])
check("the same words at another instant stay two cards", len(apart) == 2, apart)

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1))
