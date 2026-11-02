#!/usr/bin/env python3
"""Staff Performance off asa-hub-db (app/performance.py), live in asa-hub-db-sync with this branch's modules streamed.

As the master: the reads answer from the copy; each write is decided (never recorded), turned into the rows app.edits
would keep, and laid over a second round of reads, which must then show the new note, absence, incident, metric, entry
and paragraph. The evaluator's read asks the local model once. Nothing is written anywhere."""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
MODULES = ("gsjs", "hubdb", "editions", "scope", "drive", "locations", "writes", "staff_views", "staff_perf",
           "performance")

DRIVER = r'''
import base64, json, sys, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
import hubdb, gsjs, locations as L, scope as sc, drive as dr, writes as W, performance as P
db = hubdb.HubDb(); drv = dr.Drive()
users = L.Reads(db, drv).users()
boss = next(u for u in users if not gsjs.str_(u.get("mergedinto")) and sc.is_master_email(u.get("email"))
            and gsjs.str_(u.get("role")) == "admin")
master = sc.user_from_row(boss)
staff_row = next((u for u in users if gsjs.str_(u.get("role")) == "staff"), None)
out = {}

def sess():
    return L.Session(L.Reads(db, drv), master)

def read(action, payload):
    try:
        return P.ACTIONS[action](sess(), payload)
    except Exception as e:
        return {"status": "raised", "message": type(e).__name__ + ": " + str(e)[:200]}

lst = read("staffPerfList", {})
rows = (lst.get("data") or {}).get("rows") or []
emp = rows[0]["emp_id"] if rows else ""
out["list"] = {"status": lst.get("status"), "rows": len(rows), "migrated": (lst.get("data") or {}).get("migrated"),
               "first": {k: rows[0].get(k) for k in ("emp_id", "name", "grade", "incidents")} if rows else None}
prof = read("staffPerfProfile", {"emp_id": emp})
pd = prof.get("data") or {}
out["profile"] = {"status": prof.get("status"), "notes": len(pd.get("notes") or []),
                  "incidents": len(pd.get("incidents") or []), "attendance": len(pd.get("attendance") or []),
                  "grade": (pd.get("grade") or {}).get("value")}
board = read("perfBoard", {})
bd = board.get("data") or {}
out["board"] = {"status": board.get("status"), "metrics": len(bd.get("metrics") or []),
                "people": len(bd.get("people") or []), "period": bd.get("period")}
out["recompute"] = read("staffPerfRecompute", {}).get("data")
out["migrate"] = read("staffPerfMigrate", {}).get("status")
if staff_row:
    staff_sess = L.Session(L.Reads(db, drv), sc.user_from_row(staff_row))
    out["staff_refused"] = P.ACTIONS["staffPerfList"](staff_sess, {}).get("status")

period = bd.get("period") or ""
decide = [("staffPerfNoteAdd", {"emp_id": emp, "text": "Test note from the Python port"}),
          ("staffPerfAbsenceAdd", {"emp_id": emp, "date": "2026-10-20", "kind": "late", "notes": "port test"}),
          ("staffPerfIncidentAdd", {"emp_id": emp, "summary": "Port test incident", "severity": "medium",
                                    "date": "2026-10-20"}),
          ("perfMetricUpsert", {"label": "Port test metric", "target": 10, "weight": 2, "unit": "count"}),
          ("perfMetricUpsert", {"metric_id": "attendance", "label": "Attendance", "target": 96}),
          ("perfEntrySave", {"person_id": emp, "person_name": "Port", "metric_id": "attendance", "period": period,
                             "value": 97}),
          ("staffPerfAiKeep", {"emp_id": emp, "hash": "test-hash", "summary": "A test paragraph.", "tags": "a|b",
                               "grade": "7", "via": "test", "made_at": "2026-10-20T00:00:00.000Z"})]
edit_rows, decided = [], {}
for i, (action, payload) in enumerate(decide):
    try:
        d = P.WRITE.ACTIONS[action](sess(), payload)
        decided[action + str(i)] = {"status": (d.answer or {}).get("status"), "edits": [
            {k: e.get(k) for k in ("tab_name", "kind", "match")} for e in (d.edits or [])]}
        edit_rows += W.edit_rows(f"WTEST{i:04d}0000", "performance", action, d, "test")
    except Exception as e:
        decided[action + str(i)] = {"status": "raised", "why": type(e).__name__ + ": " + str(e)[:200]}
out["decided"] = decided
refused = [P.WRITE.ACTIONS["staffPerfNoteAdd"](sess(), {"emp_id": emp}).answer.get("status"),
           P.WRITE.ACTIONS["staffPerfAbsenceAdd"](sess(), {"emp_id": emp, "date": "20/10/2026"}).answer.get("status"),
           P.WRITE.ACTIONS["perfEntrySave"](sess(), {"person_id": emp, "metric_id": "attendance"}).answer.get("status"),
           P.WRITE.ACTIONS["staffPerfNoteAdd"](sess(), {"emp_id": "NOPE", "text": "x"}).answer.get("status")]
out["refused"] = refused
kept = [{"sheet_id": r[3], "tab_name": r[4], "match": r[6], "keyed": r[7], "row_key": r[8],
         "appended": r[5] == "append", "field": r[9], "value": r[10], "id": n + 1, "born": n + 1}
        for n, r in enumerate(edit_rows)]
own = W.Own([], book=db.book, edits=kept)
tok = hubdb.OWN.set(own)
try:
    lst2 = read("staffPerfList", {})
    row2 = next((r for r in (lst2.get("data") or {}).get("rows") or [] if r["emp_id"] == emp), {})
    prof2 = (read("staffPerfProfile", {"emp_id": emp}).get("data") or {})
    board2 = read("perfBoard", {}).get("data") or {}
    person = next((p for p in board2.get("people") or [] if p["person_id"] == emp), {})
    att = next((c for c in person.get("cells") or [] if c["metric_id"] == "attendance"), {})
    out["laid"] = {
        "notes": len(prof2.get("notes") or []), "incidents": len(prof2.get("incidents") or []),
        "attendance": len(prof2.get("attendance") or []), "list_incidents": row2.get("incidents"),
        "note_text": (prof2.get("notes") or [{}])[0].get("text"),
        "ai_summary": (prof2.get("ai") or {}).get("summary"),
        "metrics": [m["metric_id"] for m in board2.get("metrics") or []],
        "attendance_target": next((m["target"] for m in board2.get("metrics") or []
                                   if m["metric_id"] == "attendance"), None),
        "entry": {k: att.get(k) for k in ("value", "attainment", "status")}, "score": person.get("score")}
finally:
    hubdb.OWN.reset(tok)
ev = read("staffPerfEvaluate", {"emp_id": emp, "refresh": True})
out["evaluate"] = {"status": ev.get("status"), "fresh": (ev.get("data") or {}).get("fresh"),
                   "note": (ev.get("data") or {}).get("note"), "keep": sorted((ev.get("_keep") or {}).keys()),
                   "grade": (ev.get("data") or {}).get("grade"),
                   "summary": ((ev.get("data") or {}).get("summary") or "")[:120]}
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
    blob = {"order": list(MODULES), "src": {m: (APP / f"{m}.py").read_text(encoding="utf-8") for m in MODULES}}
    got = subprocess.run(["docker", "exec", "-i", args.runner, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=600)
    if got.returncode != 0:
        print(got.stderr.decode()[-2000:])
        return 1
    o = json.loads(got.stdout.decode().strip().splitlines()[-1])
    print(json.dumps(o, indent=1)[:4000])
    print("\nchecks")
    check("the board lists the migrated staff from the copy", o["list"]["status"] == 200 and o["list"]["rows"] > 100
          and o["list"]["migrated"] is True, o["list"])
    check("a staff member's record reads with its grade", o["profile"]["status"] == 200
          and o["profile"]["grade"] is not None, o["profile"])
    check("the metric board answers the seeded metrics for this month", o["board"]["status"] == 200
          and o["board"]["metrics"] >= 7, o["board"])
    check("Recompute says what the board holds; Migrate never reads Google", (o["recompute"] or {}).get("rows", 0) > 100
          and o["migrate"] == 200, (o["recompute"], o["migrate"]))
    check("a staff account is refused", o.get("staff_refused") in (403, None), o.get("staff_refused"))
    check("every write decides 200 as one kept edit", all(d.get("status") == 200 and len(d.get("edits") or []) == 1
                                                         for d in o["decided"].values()), o["decided"])
    check("bad writes are refused: no text, a bad date, no value, an unknown person",
          o["refused"] == [400, 400, 400, 404], o["refused"])
    lay = o.get("laid") or {}
    check("laid over the copy, the record shows the new note, absence and incident",
          lay.get("notes") == o["profile"]["notes"] + 1 and lay.get("incidents") == o["profile"]["incidents"] + 1
          and lay.get("attendance") == o["profile"]["attendance"] + 1
          and lay.get("note_text") == "Test note from the Python port", lay)
    check("the board counts the new incident; the kept paragraph is the one the write kept",
          lay.get("list_incidents") == (o["list"]["first"] or {}).get("incidents", -1) + 1
          and lay.get("ai_summary") == "A test paragraph.", lay)
    check("the metric board carries the new metric, the edited target and the filed entry",
          "port_test_metric" in (lay.get("metrics") or []) and lay.get("attendance_target") == 96
          and (lay.get("entry") or {}).get("value") == 97 and (lay.get("entry") or {}).get("attainment") == 101
          and lay.get("score") is not None, lay)
    ev = o["evaluate"]
    check("the evaluator asks the local model and hands back what to keep",
          ev["status"] == 200 and ev["fresh"] is True
          and ev["keep"] == ["emp_id", "grade", "hash", "made_at", "summary", "tags", "via"], ev)
    print(f"\ntest-performance: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
