"""Kinds (people_types) on its own table (peopleTypes), not on a spreadsheet: Staff's merge map and People merge's
pending suggestions answer what they answered off the copy (each row keeping its sheet row number); the signing's
Types reads the same rows, signs a row and appends a fold in the table alone, leaving no edit; and a void takes them
back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-people-types-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("PEOPLE_TYPES_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_people_types_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"PEOPLE_TYPES_TABLE_INPROC": "1"})], capture_output=True, text=True,
                         timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import people_merge as PM  # noqa: E402
import resource_rows as RR  # noqa: E402
import smart_comms as SC  # noqa: E402
import staff as SP  # noqa: E402
import users_merge_apply as UMA  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
TAB, RES = PM.PEOPLE_TYPES_TAB, "peopleTypes"


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))


def on_copy(read):
    """What a reader answered off the copy: the same code, with no house kept in a table."""
    tabled = HT.tabled
    HT.tabled = lambda _tab: False
    try:
        return read(L.Reads(db, None))
    finally:
        HT.tabled = tabled


def plain(v: object) -> str:
    return json.dumps(v, sort_keys=True, default=str)


def typed_rows(t: UMA.Types) -> list[tuple]:
    return [(rn, {h: str(hubdb.typed(raw.get(t.raw[h]), "hub")) for h in t.raw}) for rn, raw in t.rows]


copy_map = on_copy(SP._merge_map)
copy_pending = on_copy(PM.pending)
copy_types = on_copy(UMA.Types)
facts["the copy"] = {"rows": len(copy_types.rows), "folds": len(copy_map), "pending": len(copy_pending["pending"])}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        if not RR.uploaded(db, RES):
            RR.upload(L.Reads(db, None), RES, TAB)
        check("Staff's merge map answers the copy's", plain(SP._merge_map(L.Reads(db, None))) == plain(copy_map))
        got = PM.pending(L.Reads(db, None))
        check("People merge's pending suggestions answer the copy's, sheet rows and all",
              plain(got) == plain(copy_pending), (len(got.get("pending", [])), len(copy_pending["pending"])))
        types = UMA.Types(L.Reads(db, None))
        check("the signing reads the copy's rows, their first row per person and their numbers",
              plain(typed_rows(types)) == plain(typed_rows(copy_types)) and types.first == copy_types.first
              and types.by_rn == copy_types.by_rn, (len(types.rows), len(copy_types.rows)))
        wid = "Wzzpeopletypescheck001"
        tok = SC._WRITE.set({"write_id": wid})
        pid = next(iter(types.first))
        ok = types.sign(types.first[pid], {"duplicate_of": "Check Person (zzP1)", "decision": "merge"})
        types.append("zzP2", {"person_id": "zzP2", "duplicate_of": "Check Person (zzP1)", "decision": "merge"})
        SC._WRITE.reset(tok)
        later = SP._merge_map(L.Reads(db, None))
        check("a signed row and an appended fold land in the table and leave no edit", ok and not types.edits
              and later.get(pid) == "zzP1" and later.get("zzP2") == "zzP1", (ok, types.edits, later.get(pid)))
        RR.void(cur, wid)
        back = SP._merge_map(L.Reads(db, None))
        check("a void takes them back", plain(back) == plain(copy_map), (back.get(pid), back.get("zzP2")))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
