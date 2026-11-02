"""The Directory's directors on their own table (directors), not on a spreadsheet: the Directors list and People
merge's system identity answer what they answered off the Directory's copy; directorsCreate, directorsUpdate and
directorsDelete change the table alone, kept as the write's own, and refuse anyone who may not edit people; and a void
takes them back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-directors-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("DIRECTORS_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_directors_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"DIRECTORS_TABLE_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import directors as D  # noqa: E402
import generic_rows_writes as GRW  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import people_merge as PM  # noqa: E402
import resource_rows as RR  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
ADMIN = {"uid": "check", "name": "Check", "email": "check@example.invalid", "role": "admin"}


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


def door(fn, user: dict, payload: dict) -> W.Decision:
    return fn(L.Session(L.Reads(db, None), user), payload)


copy_all = on_copy(D.all_rows)
copy_list = on_copy(lambda r: D.directors_list(L.Session(r, ADMIN), {}))
copy_identity = on_copy(PM.system_identity)
facts["directors on the copy"] = len(copy_all)
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        if not RR.uploaded(db, D.RESOURCE):
            RR.upload(L.Reads(db, None), D.RESOURCE, D.DIRECTORS_TAB)
        check("the Directors list answers the copy's", plain(D.all_rows(L.Reads(db, None))) == plain(copy_all)
              and plain(D.directors_list(L.Session(L.Reads(db, None), ADMIN), {})) == plain(copy_list))
        check("People merge's system identity too", plain(PM.system_identity(L.Reads(db, None)))
              == plain(copy_identity))
        wid = "Wzzdirectorscheck00001"
        tok = SC._WRITE.set({"write_id": wid})
        made = door(GRW.director_create, ADMIN, {"name": "Zz Check Director", "title": "Checker", "tenureYears": 3,
                                                 "bio": "One.\n\nTwo."})
        rid = (made.answer.get("data") or {}).get("id", "")
        got = next((d for d in D.all_rows(L.Reads(db, None)) if d["id"] == rid), None)
        check("directorsCreate makes the row in the table, kept as the write's own", made.own and not made.edits
              and got is not None and got["title"] == "Checker" and got == made.answer["data"], (made.answer, got))
        changed = door(GRW.director_update, ADMIN, {"id": rid, "title": "Lead checker"})
        got = next((d for d in D.all_rows(L.Reads(db, None)) if d["id"] == rid), None)
        check("directorsUpdate changes it there", changed.own and got is not None and got["title"] == "Lead checker"
              and changed.answer["data"] == got, (changed.answer, got))
        gone = door(GRW.director_delete, ADMIN, {"id": rid})
        check("directorsDelete takes it out", gone.own and gone.answer.get("status") == 200
              and all(d["id"] != rid for d in D.all_rows(L.Reads(db, None))), gone.answer)
        refused = door(GRW.director_create, {"uid": "x", "role": "staff", "email": "x@example.invalid"},
                       {"name": "Nobody"})
        check("anyone who may not edit people is refused", refused.answer.get("status") == 403 and not refused.own,
              refused.answer)
        SC._WRITE.reset(tok)
        RR.void(cur, wid)
        check("a void takes the write's changes back", plain(D.all_rows(L.Reads(db, None))) == plain(copy_all))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
