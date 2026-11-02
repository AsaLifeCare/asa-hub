#!/usr/bin/env python3
"""Scheduling › House Calendars' drag and drop for a house manager and above (scheduling_drag, schedulingCellSave via
move) on the live rows. Who moves where, as App Control stands and with the scheduling.dragMove row laid in memory as the
operator asked; a preview of each kind of drop writes nothing; a DSP and a stale cell are refused; a move confirmed by the
master changes both cells, leaves its own flow owing a text to each person and a My Work note each, which My Work lists —
on the Scheduling store's own transaction, rolled back at the end and looked for again afterwards. The doors run in
asa-hub-db-sync (never inside asa-hub-app) on this checkout's modules, streamed. Prints shapes and counts only — no name,
no value."""
from __future__ import annotations

import base64
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
RUNNER = "asa-hub-db-sync"

_spec = importlib.util.spec_from_file_location("staff_ist_add_check", ROOT / "tools" / "test-staff-ist-add.py")
_harness = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(_harness)  # type: ignore[union-attr]
closure = _harness.closure

results: dict[str, Any] = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: Any = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:600]}")


DRIVER = r'''
import base64, importlib.abc, importlib.util, json, sys, time, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
# the runner has no fastapi: the modules that name it at the top (recon_gate, my_work's readers) only name its classes
for mod in ("fastapi", "fastapi.responses"):
    stub = types.ModuleType(mod)
    for cls in ("Request", "Response", "JSONResponse", "StreamingResponse"):
        setattr(stub, cls, type(cls, (), {}))
    sys.modules.setdefault(mod, stub)


class Streamed(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    """This checkout's modules, each run when first imported (a function's own imports only when it runs)."""

    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self) if name in blob["src"] else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = module.__name__ + ".py"
        exec(compile(blob["src"][module.__name__], module.__file__, "exec"), module.__dict__)


sys.meta_path.insert(0, Streamed())
import client_writes, gsjs, hubdb, locations as L, my_work as MW, scope as sc, smart_comms as SC, staff_views
import scheduling as SCH, scheduling_drag as DR, scheduling_writes as SW, writes as W

staff_views.record = lambda *a, **k: None  # the activity line is the write store's; none here
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
ROW = ["HM", "TEAMLEAD", "SUPERVISOR", "ADMIN", "ADMINISTRATOR", "DIRECTOR", "PLATFORMLEAD"]
out = {"checks": [], "counts": {}}


def check(name, ok, detail=None):
    out["checks"].append([name, bool(ok), None if ok else detail])


def reads(row=True):
    r = L.Reads(db, None)
    if row:
        r.app_rules()["rules"][DR.FEATURE] = list(ROW)
    return r


live = [sc.user_from_row(u) for u in reads(False).users()
        if not gsjs.str_(u.get("mergedinto")) and gsjs.str_(u.get("active")).lower() != "false"]
master = next(u for u in live if sc.is_real_master(u))
codes = [h["code"] for h in SCH.house_list(reads(False))]
srows = [r for r in SCH.read_tab(reads(False), "sched_rows") if r["active"] != "no"]
managed = {}
for r in srows:
    if r["row_kind"] == "person" and r["designation"] == "**":
        managed.setdefault(r["person_key"], set()).add(r["house_code"])


def moves_at(user, row=True):
    rd = reads(row)
    ctx = SCH.gate(L.Session(rd, user))
    return set(DR.houses_for(rd, ctx, codes)) if ctx["open"] else set()


def worn(u):
    return set(sc.badges_worn(u.get("types"), ""))


# 1. who moves where
check("the master moves at every house, row or no row", moves_at(master, False) == set(codes)
      and moves_at(master) == set(codes))
nobody = [u for u in live if not sc.is_real_master(u) and worn(u) & set(ROW)]
live_row = (L.Reads(db, None).app_rules().get("rules") or {}).get(DR.FEATURE) or []
out["counts"]["live_row"] = sorted(live_row)
if live_row:
    check("App Control's live row is the one the operator asked for (11-02)", sorted(live_row) == sorted(ROW), live_row)
    check("…and everybody moves as App Control stands exactly as with the row laid in memory",
          all(moves_at(u, False) == moves_at(u) for u in nobody), len(nobody))
else:
    check("without the row nobody but the master moves, whatever the badge",
          all(not moves_at(u, False) for u in nobody), len(nobody))
wide = [u for u in live if worn(u) & set(DR.EVERY_HOUSE)]
check("with the row: every Supervisor, Admin, Administrator, Director and Platform Lead moves at every house",
      wide and all(moves_at(u) == set(codes) for u in wide), len(wide))
hms = [u for u in live if worn(u) & {"HM", "TEAMLEAD"} and not worn(u) & set(DR.EVERY_HOUSE)]
bad = []
for u in hms:
    ctx = SCH.gate(L.Session(reads(), u))
    want = managed.get(ctx["key"], set()) & set(codes) if ctx["key"] else set()
    if moves_at(u) != want:
        bad.append(len(want))
check("with the row: a House Manager or Team Lead moves only at the houses whose ** row is theirs", hms and not bad,
      [len(hms), bad])
staffish = [u for u in live if worn(u) == {"STAFF"} and gsjs.str_(u.get("role")) == "staff"]
check("a DSP moves nowhere, ** row or not", staffish and all(not moves_at(u) for u in staffish), len(staffish))
out["counts"].update(houses=len(codes), wide=len(wide), hm_tl=len(hms), dsp=len(staffish))

# 2. previews: one of each kind, none writes
rd = reads()
today = rd.today()
cells = SCH.read_tab(rd, "sched_cells")
has = {(c["house_code"], c["row_id"], c["date"]) for c in cells if c["text"]}
row_of = {(r["house_code"], r["row_id"]): r for r in srows}


def preview(user, payload, prev=True):
    d = DR.move(L.Session(reads(), user), {"via": "move", "preview": prev, **payload})
    env = d.answer or {}
    return env.get("status"), (env.get("data") or {}).get("preview") or {}, d.edits, env.get("message")


def drops(kind):
    for c in cells:
        r = row_of.get((c["house_code"], c["row_id"]))
        if not r or c["date"] <= today or not SCH.classify(c["text"]) or SCH.classify(c["text"]).start is None:
            continue
        here = [p for p in srows if p["house_code"] == c["house_code"] and p["row_id"] != c["row_id"]]
        if kind == "assign" and r["row_kind"] == "open" and c["state"] == "open":
            targets = [p for p in here if p["row_kind"] == "person" and (p["house_code"], p["row_id"], c["date"]) not in has]
        elif kind == "move" and r["row_kind"] == "person" and c["state"] in ("", "scheduled"):
            targets = [p for p in here if p["row_kind"] == "person" and (p["house_code"], p["row_id"], c["date"]) not in has]
        elif kind == "exchange" and r["row_kind"] == "person" and c["state"] in ("", "scheduled"):
            targets = [p for p in here if p["row_kind"] == "person" and (p["house_code"], p["row_id"], c["date"]) in has]
        elif kind == "release" and r["row_kind"] == "person" and c["state"] in ("", "scheduled"):
            targets = [p for p in here if p["row_kind"] == "open" and (p["house_code"], p["row_id"], c["date"]) not in has]
        else:
            continue
        for p in targets:
            yield {"house": c["house_code"], "from_row_id": c["row_id"], "from_date": c["date"],
                   "to_row_id": p["row_id"], "to_date": c["date"]}


found = {}
for kind in ("move", "exchange", "assign", "release"):
    for n, payload in enumerate(drops(kind)):
        if n > 80:
            break
        st, p, edits, _m = preview(master, payload)
        if st == 200 and p.get("kind") == kind and not p.get("blocked"):
            found[kind] = (payload, p, edits)
            break
for kind in ("move", "exchange", "assign", "release"):
    if kind not in found:
        out["counts"]["no_" + kind] = True
        continue
    payload, p, edits = found[kind]
    told = [n for n in p["notes"] if n["text"].startswith("Auto-approved")]
    check(f"{'an' if kind[0] in 'aeiou' else 'a'} {kind} previews whole — two cells changed, who is told — and writes nothing",
          len(p["changes"]) == 2 and edits is None and len(told) == 1 and not p["blocked"],
          [len(p["changes"]), edits is None, len(told)])
past = next(({"house": c["house_code"], "from_row_id": c["row_id"], "from_date": c["date"],
              "to_row_id": c["row_id"], "to_date": gsjs.day_shift(today, 1)} for c in cells
             if c["date"] < today and row_of.get((c["house_code"], c["row_id"]), {}).get("row_kind") == "person"
             and SCH.classify(c["text"]) and SCH.classify(c["text"]).start is not None), None)
if past:
    st, p, edits, _m = preview(master, past)
    check("a shift already past is blocked, and only the block is said", st == 200 and p.get("blocked")
          and all(n["tone"] == "block" for n in p["notes"]), p.get("notes"))

# 3. refusals
probe = (found.get("move") or found.get("exchange") or (None,))[0]
if probe:
    dsp = staffish[0] if staffish else None
    if dsp:
        st, _p, _e, _m = preview(dsp, probe)
        check("a DSP's drop is refused (403)", st == 403, st)
    st, _p, edits, _m = preview(master, {**probe, "seen_from": "XX-STALE", "seen_to": ""}, prev=False)
    check("a confirm over a cell changed since the preview is refused (409) and writes nothing", st == 409 and edits is None, st)

# 4. a move confirmed by the master, on the Scheduling store's transaction, rolled back
class Rehearsal(Exception):
    pass


STORE = SW.Store(dsn=hubdb._dsn())
check("the Scheduling write store is ready", not STORE.ensure())
fid = ""
if probe:
    st0, p0, _e, _m = preview(master, probe)
    try:
        with STORE.locked() as tx:
            own = client_writes.Own([{**w, "store": "scheduling"} for w in tx.live()], book=db.book, edits=tx.edits(),
                                    edits_at=time.time())
            tok = hubdb.OWN.set(own)
            try:
                wid = "Wdragcheck" + str(time.time_ns())[-12:]
                with SC.deciding(tx, wid, "schedulingCellSave"):
                    d = SW.ACTIONS["schedulingCellSave"](L.Session(L.Reads(db, None), master),
                                                         {"via": "move", **probe, "seen_from": p0["seen_from"],
                                                          "seen_to": p0["seen_to"], "override": True})
                env = d.answer or {}
                check("the master's confirm answers 200 with the board's houses", env.get("status") == 200
                      and probe["house"] in ((env.get("data") or {}).get("grids") or {}), env.get("message"))
                cur = tx.cur

                def rows(resource, where, args):
                    cur.execute("select cells from app.resource_rows where resource = %s and removed_at is null and "
                                + where, (resource, *args))
                    return [r[0] if isinstance(r[0], dict) else json.loads(r[0]) for r in cur.fetchall()]

                got = {c["row_id"]: c["text"] for c in rows(
                    "schedCells", "cells->>'house_code' = %s and cells->>'date' = %s and cells->>'row_id' in (%s, %s)",
                    (probe["house"], probe["from_date"], probe["from_row_id"], probe["to_row_id"]))}
                want = {c["row_id"]: c["now"] for c in p0["changes"]}
                check("both cells read as the preview said", all(got.get(k, "") == v for k, v in want.items()),
                      [len(got), len(want)])
                flows = rows("schedFlows", "cells->>'kind' = 'move' and cells->>'source' = 'drag' and "
                             "cells->>'house_code' = %s", (probe["house"],))
                f = max(flows, key=lambda x: x.get("created_at") or "") if flows else {}
                fid = gsjs.str_(f.get("id"))
                owed = (json.loads(f.get("outreach_log") or "{}") or {}).get("owed") or []
                told = [n for n in p0["notes"] if n["text"].startswith("Auto-approved")]
                people = len(p0["changes"]) - sum(1 for c in p0["changes"] if c["name"].startswith("OPEN"))
                check("the move's own flow is done and owes one text per person, through Smart Comms' situation",
                      f.get("state") == "done" and len(owed) == people and all(
                          o.get("sit") in (DR.SIT_MOVED, DR.SIT_OPEN) and (o.get("vars") or {}).get("change")
                          for o in owed) and f.get("outreach_next_at"), [f.get("state"), len(owed), people])
                notes = rows("schedInbox", "cells->>'flow_id' = %s", (fid,))
                check("a My Work note per person with an account: box work, posted, never an approval",
                      notes and all(n.get("box") == "work" and n.get("state") == "posted" and n.get("kind") in DR.NOTE_KINDS
                                    for n in notes), [len(notes)])

                class DbStub:
                    def tab(self, sid, tab, where, args):
                        return notes, len(notes), ""

                class CtxStub:
                    own = True
                    db = DbStub()

                    def __init__(self, uid):
                        self.me = {"uid": uid}
                        self.today = MW.day_of(today)

                    def house(self, pointer, what):
                        return "sid"

                listed = [MW._sched_notices(CtxStub(n.get("to_uid"))) for n in notes]
                check("My Work lists each person's note as theirs alone, an informative opening Scheduling",
                      all(len(x) == 1 and x[0]["phase"] == "Informative" and (x[0]["action"] or {}).get("label")
                          == "Open in Scheduling" for x in listed), [len(x) for x in listed])
                raise Rehearsal()
            finally:
                hubdb.OWN.reset(tok)
    except Rehearsal:
        pass
left = db.query("select 1 from app.resource_rows where resource = 'schedFlows' and row_id = %s", (fid,)) if fid else []
check("nothing is left: the transaction was rolled back", fid and not left, [bool(fid), len(left or [])])
print(json.dumps(out, default=str))
'''


def main() -> int:
    order = closure(("scheduling_writes", "scheduling_drag", "my_work"))
    blob = {"order": order, "src": {m: (APP / f"{m}.py").read_text(encoding="utf-8") for m in order}}
    decl = (APP / "ist_config_defaults.json").read_text(encoding="utf-8")
    print(f"Scheduling's drag and drop in {RUNNER} ({len(order)} modules, streamed; rolled back)")
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", "-e",
                          "HUB_IST_CONFIG_DECLARATION_JSON=" + decl, RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=900)
    if got.returncode != 0:
        check("the doors ran in the runner", False, got.stderr.decode()[-1500:])
    else:
        py = json.loads(got.stdout.decode().strip().splitlines()[-1])
        print("  counts: " + json.dumps(py.get("counts") or {}))
        for name, ok, detail in py["checks"]:
            check(name, ok, detail)
    print(f"\ntest-scheduling-drag: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
