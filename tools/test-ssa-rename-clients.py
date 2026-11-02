"""An SSA renamed and its clients ticked from the edit panel (app/ssa_writes.py), on the app's own modules and asa-hub-db
read live. The doors decide; nothing is written (a door's edits are kept by the store, never called here):
- a rename writes the new name on every client record that names the SSA, and moves its own rows (details, notes,
  entries' edits) to the new key; the answer names the new key; a name another SSA carries is refused;
- ticking an active client writes the SSA's name, phone and e-mail on its record; unticking blanks them; a tie only
  the Master holds is never unticked;
- the edit read lists the active clients, each ticked or not.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-ssa-rename-clients.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("SSA_RENAME_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_ssa_rename_clients.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"SSA_RENAME_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import client_writes  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import scope as sc  # noqa: E402
import ssa as S  # noqa: E402
import ssa_writes as SW  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
master = {"id": "u-boss", "email": sc.MASTER_ACCOUNT, "role": "admin", "types": []}
reads = L.Reads(db, None)
idx = S.index(reads)
pick = None
for key in sorted(idx["ssas"]):
    ctx = S.ssa_ctx(reads, key)
    if ctx.get("refused") or ctx["degraded"]:
        continue
    e = S.edit_of(reads, ctx)
    if e["records"] and "name" not in e["locked"]:
        pick = (key, ctx, e)
        break
check("an SSA some client's Hub record names", pick is not None)
if pick:
    key, ctx, e = pick
    facts["records"] = len(e["records"])
    check("the name is open to edit", "name" not in e["locked"], e["locked"])
    check("the edit read lists the active clients, the SSA's own ticked",
          e["clients"] and all(c["on"] for c in e["clients"] if c["client_key"] in e["records"]), e["clients"][:3])
    new = ctx["name"] + " Probe"
    sess = L.Session(L.Reads(db, None), master)
    got = SW.edit(sess, {"ssa": key, "changes": [{"field": "name", "value": new, "expected": e["raw"]["name"]}]})
    data = got.answer.get("data") or {}
    edits = got.edits or []
    on_records = [x for x in edits if (x.get("cells") or {}).get("ssa_name") == new and x.get("tab_name") != S.NOTES_TAB
                  and x.get("tab_name") != S.LIST_TAB and x.get("tab_name") != S.DETAILS_TAB]
    moved = [x for x in edits if (x.get("cells") or {}).get("ssa_key") == S.key_of(new)]
    check("a rename answers the new key", data.get("ssa") == S.key_of(new) and "name" in data.get("written", []), data)
    check("the new name goes on every client record that names the SSA", len(on_records) == len(e["records"]),
          [len(on_records), len(e["records"])])
    facts["own rows moved"] = len(moved)
    check("the SSA's own rows move to the new key, none left behind",
          all((x.get("cells") or {}).get("ssa_name") == new for x in moved), moved[:2])
    other = next((s["name"] for k, s in idx["ssas"].items() if k != key), "")
    clash = SW.edit(L.Session(L.Reads(db, None), master),
                    {"ssa": key, "changes": [{"field": "name", "value": other, "expected": e["raw"]["name"]}]})
    check("a name another SSA carries is refused, nothing written", not clash.edits
          and any(r.get("field") == "name" for r in (clash.answer.get("data") or {}).get("refused", [])), clash.answer)

    off = next((c for c in e["clients"] if not c["on"]), None)
    on = next((c for c in e["clients"] if c["on"] and not c["why"]), None)
    pinned = next((c for c in e["clients"] if c["why"]), None)
    if off:
        got = SW.clients_set(L.Session(L.Reads(db, None), master), {"ssa": key, "add": [off["client_key"]]})
        cells = [(x.get("cells") or {}) for x in got.edits or []]
        check("ticking a client writes the SSA's name, phone and e-mail on its record",
              (got.answer.get("data") or {}).get("added") == [off["client_key"]]
              and any(c.get("ssa_name") == ctx["name"] for c in cells), got.answer)
    if on:
        got = SW.clients_set(L.Session(L.Reads(db, None), master), {"ssa": key, "remove": [on["client_key"]]})
        cells = [(x.get("cells") or {}) for x in got.edits or []]
        check("unticking a client blanks the SSA on its record",
              (got.answer.get("data") or {}).get("removed") == [on["client_key"]]
              and any(c.get("ssa_name") == "" for c in cells), got.answer)
    if pinned:
        got = SW.clients_set(L.Session(L.Reads(db, None), master), {"ssa": key, "remove": [pinned["client_key"]]})
        check("a tie only the Master holds is never unticked", not got.edits
              and (got.answer.get("data") or {}).get("refused"), got.answer)
    staff = {"id": "u-staff", "email": "staff@example.org", "role": "staff", "types": ["STAFF"]}
    shut = SW.clients_set(L.Session(L.Reads(db, None), staff), {"ssa": key, "add": [(off or on or {}).get("client_key", "x")]})
    check("without the edition the clients are not changed", not shut.edits
          and shut.answer.get("message") == "Unknown action.", shut.answer)

    # the SSA's own rows, stood in (no SSA has notes or details yet): each moves to the new key, another SSA's never
    class _Res:
        ref = object()

    saved = (W.tab_of, W.where_of, W.append_record, S.details_all, db.locations_rows)
    W.tab_of = lambda r, tab: _Res()
    W.where_of = lambda res: ("BOOK", "tab")
    W.append_record = lambda res, header, cells, subject: {"kind": "append", "cells": dict(cells)}
    S.details_all = lambda r: {S.details_id(key): {"agency": "Stark DD", "office_address": "1 Main St"}}
    db.locations_rows = lambda ref: [{"id": "SSAN_1", "ssa_key": key}, {"id": "SSAN_2", "ssa_key": "ssa_someoneelse"}]
    try:
        new_key = S.key_of(ctx["name"] + " Probe")
        got = SW.rekeyed(L.Session(L.Reads(db, None), master), ctx, new_key, ctx["name"] + " Probe", {}, "")
    finally:
        W.tab_of, W.where_of, W.append_record, S.details_all, db.locations_rows = saved
    details = [x for x in got if x.get("kind") == "append"]
    rows = [x for x in got if x.get("kind") != "append"]
    check("a rename carries the details to the new key",
          len(details) == 1 and details[0]["cells"].get("ssa_key") == new_key
          and details[0]["cells"].get("agency") == "Stark DD", details)
    check("each of its notes and entries' rows moves, another SSA's stays", len(rows) == 2
          and all(x.get("row_key") == "SSAN_1" for x in rows) and all(x["cells"]["ssa_key"] == new_key for x in rows),
          [(x.get("row_key"), x.get("cells")) for x in rows])

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
