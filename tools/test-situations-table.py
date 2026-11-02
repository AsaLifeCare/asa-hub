"""Smart Comms' situations (smart_comms, the Situations house) on their own table (smartCommsDesk), not on a
spreadsheet: the engine's read_situations, the Desk's situations, the Desk save's index, the gates and the generic rows
answer what they answered off the copy; smartCommsSet changes the situation's last row in the table alone, as the
write's own; a missing seed is made there; and a void takes the save back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-situations-table.py
"""
import contextlib
import json
import os
import subprocess
import sys

if not os.environ.get("SITUATIONS_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_situations_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"SITUATIONS_TABLE_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402
import types  # noqa: E402

import psycopg  # noqa: E402

import candidate_papers as CP  # noqa: E402
import client_writes  # noqa: E402
import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import ops_stragglers as OS  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import smart_comms_desk as SCD  # noqa: E402
import smart_comms_writes as SCW  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
TAB, RES = SC.SITUATIONS_TAB, "smartCommsDesk"


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
boss = next((u for u in L.Reads(db, None).users() if not gsjs.str_(u.get("mergedinto"))
             and sc.is_master_email(u.get("email")) and gsjs.str_(u.get("role")) == "admin"), None)
master = sc.user_from_row(boss)


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


def gate_words(r: L.Reads) -> dict:
    out = {g["id"]: CP.gate_holds(r, g["id"]) for g in SCD.HUB_GATES}
    try:
        W.gate(r)
        out["W.gate"] = "passes"
    except W.GateHeld as held:
        out["W.gate"] = str(held)
    return out


READERS = {
    "the engine's read_situations": lambda r: SC.read_situations(db),
    "the Desk's situations": SCD.situations,
    "the Desk save's index": lambda r: SCW.situations(r)[2],
    "the gates": gate_words,
}
copies = {k: on_copy(f) for k, f in READERS.items()}
copy_generic = on_copy(lambda r: OS.rows(r, TAB))
facts["situations on the copy"] = len(copies["the Desk's situations"])
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        if not RR.uploaded(db, RES):
            RR.upload(L.Reads(db, None), RES, TAB)
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(copies[name]),
                  (len(got) if isinstance(got, (list, dict)) else got, len(copies[name])
                   if isinstance(got, (list, dict)) else ""))
        check("the generic rows answer the copy's", plain(SR.rows(L.Reads(db, None), RES)) == plain(copy_generic))
        check("the Desk names where the situations are kept", SCD.house_id(L.Reads(db, None)).startswith(
            "app.resource_rows"))
        sid = next(s["id"] for s in SCD.situations(L.Reads(db, None)) if not SCW.is_gate(s))
        wid = "Wzzsituationscheck0001"
        tok = SC._WRITE.set({"write_id": wid})
        d = SCW.smart_comms_set(L.Session(L.Reads(db, None), master), {"rows": [{"id": sid, "note": "zz table check"}]})
        hit = SCD.situation_last(SC.read_situations(db), sid) or {}
        check("smartCommsSet changes the situation's last row in the table, as the write's own",
              d.answer.get("status") == 200 and d.own and not d.edits and hit.get("note") == "zz table check",
              (d.answer, d.edits, hit.get("note")))
        SC._WRITE.reset(tok)
        RR.void(cur, wid)
        check("a void takes the save back", plain(SCD.situations(L.Reads(db, None)))
              == plain(copies["the Desk's situations"]))
        seed_id = SC.SEEDS[0]["id"]
        gone = [(k, c) for k, c in RR.table_rows(None, RES) if c.get("id") == seed_id]
        for k, c in gone:
            RR.remove(None, RES, k, c, "check")

        class Locked:
            @contextlib.contextmanager
            def locked(self):
                yield types.SimpleNamespace(cur=cur)
        made = SC.seed(Locked(), db)
        check("a missing seed is made in the table", seed_id in made
              and any(s["id"] == seed_id for s in SC.read_situations(db)), (made, len(gone)))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
