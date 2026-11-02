#!/usr/bin/env python3
"""Staff Profile's Python-only edits and reads, run on this branch's modules in asa-hub-db-sync (never asa-hub-app):
HR Admin and Performance answered with their audit line, the Compliance edit section, the HR issue and the
concluded documentation mark decided (never kept), and the live requirement states against the stored ones.

    python3 tools/test-staff-profile-edits.py [--runner asa-hub-db-sync] [-n 40]
"""
from __future__ import annotations

import argparse
import base64
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
MODULES = ("gsjs", "hubdb", "editions", "scope", "drive", "locations", "clients", "staff_views", "cert_reads", "staff",
           "staff_comms", "staff_perf", "staff_app", "writes", "client_writes", "staff_writes")
results: dict[str, Any] = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: Any = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}" + (f"\n       {json.dumps(detail, default=str)[:900]}" if detail is not None else ""))


DRIVER = r'''
import base64, json, sys, time, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
import hubdb, gsjs, locations as L, scope as sc, drive as dr, staff as SP, staff_app as SA, staff_perf as SF
import staff_views as SV, staff_writes as SW, writes as W
db = hubdb.HubDb()
drv = dr.Drive()
users = L.Reads(db, drv).users()
boss = next((u for u in users if not gsjs.str_(u.get("mergedinto")) and sc.is_master_email(u.get("email"))
             and gsjs.str_(u.get("role")) == "admin"), None)
master = sc.user_from_row(boss) if boss else None
out = {"master": master is not None}

class FakeConn:
    def __init__(self): self.sql = []
    def execute(self, sql, params=None):
        self.sql.append((sql, params))
        class R:
            def fetchall(self_inner): return []
        return R()
class FakeStore:
    available = True
    def __init__(self): self.c = FakeConn()
    def conn(self): return self.c
store = FakeStore()
SV.bind(store)

def sess():
    return L.Session(L.Reads(db, drv), master)

roster = SA.ACTIONS["staffProfileRoster"](sess(), {})
staff = [r for r in ((roster.get("data") or {}).get("staff") or []) if r.get("status") == "active"
         and not r.get("ambiguous")]
out["roles"] = {}
for r in staff:
    out["roles"][r.get("role") or ""] = out["roles"].get(r.get("role") or "", 0) + 1
keys = [r["key"] for r in staff][: blob["n"]]
out["keys"] = len(keys)

# the audited reads, each with its line; Performance timed
doors = {}
for action in ("staffProfileHr", "staffProfilePerformance", "staffProfileActions", "staffProfileCompliance"):
    tally, slow = {}, 0.0
    for k in keys[:12]:
        t = time.monotonic()
        try:
            env = SA.ACTIONS[action](sess(), {"staff": k})
            st = str(env.get("status"))
        except Exception as e:
            st = type(e).__name__ + ": " + str(e)[:120]
        slow = max(slow, time.monotonic() - t)
        tally[st] = tally.get(st, 0) + 1
    doors[action] = {"tally": tally, "slowest_s": round(slow, 2)}
out["doors"] = doors
inserts = [p for s, p in store.c.sql if s.startswith("insert into app.staff_views")]
out["lines"] = {"hr": sum(1 for p in inserts if p[2] == "staffProfileHr"),
                "perf": sum(1 for p in inserts if p[2] == "staffProfilePerformance"),
                "actor": inserts[0][0] if inserts else ""}
store.c.sql.clear()
SV.record({**(master or {}), "unlogged": True}, "staffProfileHr", keys[0])
SV.record({"is_service": True}, "staffProfileHr", keys[0])
out["unlogged_lines"] = sum(1 for s, _p in store.c.sql if s.startswith("insert"))

# the Compliance answer carries the master's edit values for its section
env = SA.ACTIONS["staffProfileCompliance"](sess(), {"staff": keys[0]})
out["compliance_edit"] = sorted(((env.get("data") or {}).get("edit") or {}).keys())

# the live requirement states against the stored rebuild's
reads = L.Reads(db, drv)
st = SP.req_states(reads)
agree = differ = missing = 0
samples = []
for k in keys:
    ctx = SP.person(L.Reads(db, drv), k)
    if ctx.get("refused"):
        continue
    live = SP.req_states_live(L.Reads(db, drv), ctx)
    stored = {r["req_id"]: r for r in SP.req_states_from(st["hdr"], st["values"], k)}
    for rid, r in live.items():
        s = stored.get(rid)
        if s is None:
            missing += 1
            continue
        if s["state"] == r["state"]:
            agree += 1
        else:
            differ += 1
            if len(samples) < 8:
                samples.append({"key": k, "req": rid, "stored": [s["state"], s["expires"], s["computed_at"]],
                                "live": [r["state"], r["expires"]]})
out["states"] = {"agree": agree, "differ": differ, "not_stored": missing, "samples": samples}

# the writes, decided and never kept
k = keys[0]
def decide(action, payload):
    try:
        d = SW.ACTIONS[action](sess(), payload)
        return {"status": (d.answer or {}).get("status"), "message": (d.answer or {}).get("message", ""),
                "edits": d.edits or [], "engine": bool(d.engine)}
    except Exception as e:
        return {"status": type(e).__name__, "message": str(e)[:200], "edits": [], "engine": False}
today = reads.today()
yday = gsjs.day_shift(today, -1)
w = {}
w["conclude"] = decide("staffProfileDocConclude", {"staff": k, "date": yday, "area": "daily_notes",
                                                   "why": "Filed on paper at the house."})
w["conclude_bad_area"] = decide("staffProfileDocConclude", {"staff": k, "date": yday, "area": "incidents", "why": "x"})
w["conclude_no_why"] = decide("staffProfileDocConclude", {"staff": k, "date": yday, "area": "daily_notes", "why": ""})
w["conclude_future"] = decide("staffProfileDocConclude", {"staff": k, "date": gsjs.day_shift(today, 2),
                                                          "area": "daily_notes", "why": "x"})
w["hr"] = decide("staffProfileHrIssueAdd", {"staff": k, "date": yday, "severity": "Coaching", "category": "Conduct",
                                            "summary": "Late handover", "details": "Left before relief arrived.",
                                            "action": "Talked it through.", "next_review": today})
w["hr_bad"] = decide("staffProfileHrIssueAdd", {"staff": k, "date": yday, "severity": "Nope", "category": "Conduct",
                                                "summary": "x", "details": "y"})
ctx = SP.person(L.Reads(db, drv), k)
raw = SP.edit_raw(ctx, "compliance")
w["edit_cpr"] = decide("staffProfileEdit", {"key": k, "changes": [
    {"field": "cpr_exp", "value": "2027-01-31", "expected": raw.get("cpr_exp", "")}]})
out["writes"] = {n: {"status": v["status"], "message": v["message"][:160], "engine": v["engine"],
                     "edits": [{"tab": e.get("tab_name"), "kind": e.get("kind"), "match": e.get("match"),
                                "cells": e.get("cells")} for e in v["edits"]]} for n, v in w.items()}

# a concluded mark turns its missing record complete
orig = SF.doc_marks
try:
    ctx = SP.person(L.Reads(db, drv), k)
    base = SF.perf_build(L.Reads(db, drv), ctx)["documentation"]
    miss = [x for x in base["exceptions"] if x["status"] == "missing" and x["area"] in SP.DOC_MARK_AREAS]
    if miss:
        x = miss[0]
        SF.doc_marks = lambda reads, key: {(x["date"], x["area"]): {"id": "SDM_t", "why": "Filed on paper.",
                                                                   "by": "Someone", "at": today + "T12:00:00.000Z"}}
        after = SF.perf_build(L.Reads(db, drv), ctx)["documentation"]
        a0 = next(a for a in base["areas"] if a["id"] == x["area"])
        a1 = next(a for a in after["areas"] if a["id"] == x["area"])
        row = next((e for e in after["exceptions"] if e["date"] == x["date"] and e["area"] == x["area"]), None)
        out["mark"] = {"found": True, "before": [a0["complete"], a0["missing"]],
                       "after": [a1["complete"], a1["missing"]], "row": row}
    else:
        out["mark"] = {"found": False}
finally:
    SF.doc_marks = orig
print(json.dumps(out, default=str))
'''


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runner", default="asa-hub-db-sync")
    ap.add_argument("-n", type=int, default=40)
    a = ap.parse_args()
    if a.runner == "asa-hub-app":
        print("refused: never run inside asa-hub-app (768 MiB)")
        return 2
    if not shutil.which("docker"):
        print("skipped — no docker")
        return 0
    blob = {"order": list(MODULES), "src": {m: (APP / f"{m}.py").read_text(encoding="utf-8") for m in MODULES},
            "n": a.n}
    got = subprocess.run(["docker", "exec", "-i", a.runner, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=900)
    if got.returncode != 0:
        print(got.stderr.decode()[-2000:])
        return 1
    py = json.loads(got.stdout.decode().strip().splitlines()[-1])
    print(f"\n{py['keys']} active staff; Role words: {json.dumps(py['roles'])[:300]}")
    print("doors:", json.dumps(py["doors"]))
    print("states:", json.dumps(py["states"])[:1200])
    print("writes:", json.dumps(py["writes"], indent=1)[:4000])
    print("mark:", json.dumps(py["mark"]))
    d = py["doors"]
    check("the doors ran as the master", py["master"] and py["keys"] > 0)
    for action in d:
        check(f"{action} answers 200 for every staff member read", set(d[action]["tally"]) == {"200"}, d[action])
    check("each HR and Performance view keeps one line, under the viewer's e-mail",
          py["lines"]["hr"] == d["staffProfileHr"]["tally"].get("200") and
          py["lines"]["perf"] == d["staffProfilePerformance"]["tally"].get("200") and "@" in py["lines"]["actor"],
          py["lines"])
    check("a session the relay says leaves no line, and a service, keep none", py["unlogged_lines"] == 0)
    check("the Compliance answer carries the master's edit values for its section",
          {"cpr_exp", "dodd_exp", "license_exp", "sam", "oig", "bci_check_date"} <= set(py["compliance_edit"]),
          py["compliance_edit"])
    s = py["states"]
    check("the live requirement states agree with the stored rebuild's for nearly every pair (>= 95%)",
          s["agree"] >= 0.95 * max(1, s["agree"] + s["differ"]), s)
    wr = py["writes"]
    c = wr["conclude"]
    check("a missing record is marked concluded: one appended row on staff_doc_marks, final",
          c["status"] == 200 and len(c["edits"]) == 1 and c["edits"][0]["tab"] == "staff_doc_marks"
          and c["edits"][0]["kind"] == "append" and c["edits"][0]["cells"].get("state") == "concluded", c)
    check("the mark refuses another area, no why, and a day to come",
          all(wr[n]["status"] == 400 for n in ("conclude_bad_area", "conclude_no_why", "conclude_future")),
          {n: wr[n] for n in ("conclude_bad_area", "conclude_no_why", "conclude_future")})
    h = wr["hr"]
    cells = (h["edits"] or [{}])[0].get("cells") or {}
    check("an HR issue is the tracker's appended row, final, never handed to Apps Script",
          h["status"] == 200 and not h["engine"] and len(h["edits"]) == 1 and h["edits"][0]["tab"] == "Master"
          and h["edits"][0]["match"].startswith("cols:") and cells.get("Result") == "Under review"
          and "Category: Conduct" in cells.get("Situation", "") and "Next review:" in cells.get("Follow up", ""), h)
    check("an HR issue with an unknown severity is refused", wr["hr_bad"]["status"] == 400, wr["hr_bad"])
    e = wr["edit_cpr"]
    check("a Compliance date is the Master's CPR Exp Date, final",
          e["status"] == 200 and any("CPR Exp Date" in (x["cells"] or {}) for x in e["edits"]), e)
    m = py["mark"]
    if m.get("found"):
        check("a concluded mark makes its record complete and its row says Concluded",
              m["after"][0] == m["before"][0] + 1 and m["after"][1] == m["before"][1] - 1 and m["row"]
              and m["row"]["status"] == "concluded" and m["row"]["details"].startswith("Concluded by"), m)
    print(f"\ntest-staff-profile-edits: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
