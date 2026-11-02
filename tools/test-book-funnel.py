"""The book-write funnel decided in Python, on the live situations and switch in asa-hub-db.
- W.gate answers the funnel itself: armed while the send switch holds, a write is held with its 409 and the gate's
  own words (GateHeld, an envelope.Refused that main.py answers and a Defer a door may still catch). Not armed, or
  the switch off, it lets the write through. It never sends a write on to Apps Script.
- The Smart Comms Desk save is never held by it: every gate row, the funnel's own included, switches.
- The Desk tells the truth about the gates no door asks.
Only decisions are run: no transaction is opened, nothing is written, no door is asked.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-book-funnel.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("BOOK_FUNNEL_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_book_funnel.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"BOOK_FUNNEL_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import candidate_papers as CP  # noqa: E402
import client_writes  # noqa: E402
import envelope  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import scope as sc  # noqa: E402
import smart_comms_desk as SCD  # noqa: E402
import smart_comms_writes as SW  # noqa: E402
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
check("the master's account is read", master is not None)

why = CP.gate_holds(reads, W.GATE_ID)
facts["funnel holds now"] = bool(why)
facts["send switch"] = SCD.switch_word(reads.config())
try:
    W.gate(reads)
    raised = None
except Exception as exc:  # noqa: BLE001 - its type is the check
    raised = exc
if why:
    check("held: GateHeld with the gate's 409 and its own words",
          isinstance(raised, W.GateHeld) and raised.answer == {"status": 409, "message": why}, repr(raised))
    check("which main.py answers as a refusal, and a door may still catch as a Defer",
          isinstance(raised, envelope.Refused) and isinstance(raised, sc.Defer))
    check("its words name the gate, never Apps Script",
          W.GATE_ID in why and "Apps Script" not in why, why)
else:
    check("not holding: the write goes through", raised is None, repr(raised))

for gid in ("gate_behavior_signals_ingest", "gate_book_write_funnel"):
    # the switch turned the other way from where it stands, so there is always a cell to keep
    word = "no" if SCD.situation_on(SCD.situations(reads), gid) is not None else "yes"
    d = SW.smart_comms_set(L.Session(reads, master), {"rows": [{"id": gid, "enabled": word}]})
    got = d.answer or {}
    check(f"the Desk switches {gid} whatever the funnel says: 200, kept in Postgres",
          got.get("status") == 200 and bool(d.edits), got)

desk = {g["id"]: g for g in SCD.gate_desk(SCD.situations(reads), reads.config())["gates"]}
check("the wellbeing link gate is told as asked by no door",
      desk["gate_wellbeing_image_link"]["wired"] is False and not desk["gate_wellbeing_image_link"]["holds_now"]
      and "no door" in desk["gate_wellbeing_image_link"]["wired_why"], desk.get("gate_wellbeing_image_link"))
check("no gate's words on the Desk send anyone to Main.gs",
      all("Main.gs" not in (g["wired_why"] + g["caveat"]) for g in desk.values()))
facts["armed"] = sorted(k for k, g in desk.items() if g["armed"])
facts["holding now"] = sorted(k for k, g in desk.items() if g["holds_now"])

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1))
