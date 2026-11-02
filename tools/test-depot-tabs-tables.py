"""The depot's own tabs but its Facts (Action Attempts, Condition Instances, Documents, Events, Flow Instances,
Registry, Rounds, Subjects) on tables of their own, each named with the depot: every reader (the book reader every
tab goes through, the registry, the engine's Condition Instances snapshot) answers what it answered off the copy; a
condition instance and a journey event land in the tables alone (writes.into_tables), and a void takes them back.
One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-depot-tabs-tables.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("DEPOT_TABS_TABLES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_depot_tabs_tables.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"DEPOT_TABS_TABLES_INPROC": "1"})], capture_output=True, text=True,
                         timeout=900)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import candidates as CND  # noqa: E402
import client_writes  # noqa: E402
import hiring_engine as HE  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
# the Facts have a table and a test of their own (tools/test-depot-facts-table.py)
DEPOT = {r: s["tab"] for r, s in SR.BOOKED.items() if s.get("book") == "ESSENCIAL" and r != hubdb.FACTS_RESOURCE}
sid = hubdb.ESSENCIAL_ID


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))


def on_copy(read):
    tabled, within = HT.tabled, HT.resource_in
    HT.tabled, HT.resource_in = (lambda _tab: False), (lambda _r, _s, _t: None)
    try:
        return read(L.Reads(db, None))
    finally:
        HT.tabled, HT.resource_in = tabled, within


def keyed(v: object) -> object:
    """A value with every key as text (the snapshot keys a row by a pair)."""
    if isinstance(v, dict):
        return {str(k): keyed(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [keyed(x) for x in v]
    return v


def plain(v: object) -> str:
    return json.dumps(keyed(v), sort_keys=True, default=str)


def first_diff(a: object, b: object, at: str = "") -> str:
    if type(a) is not type(b) and not (isinstance(a, (list, tuple)) and isinstance(b, (list, tuple))):
        return f"{at}: {str(a)[:80]} | {str(b)[:80]}"
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if plain(a.get(k)) != plain(b.get(k)):
                return first_diff(a.get(k), b.get(k), f"{at}.{k}")
    if isinstance(a, (list, tuple)):
        if len(a) != len(b):
            return f"{at}: {len(a)} vs {len(b)} items"
        for i, (x, y) in enumerate(zip(a, b)):
            if plain(x) != plain(y):
                return first_diff(x, y, f"{at}[{i}]")
    return f"{at}: {str(a)[:80]} | {str(b)[:80]}"


rid = HE.runtime_id(L.Reads(db, None))
facts["the runtime book is the depot"] = rid == sid
READERS = {
    "every tab whole, as the book reader reads it": lambda r: {t: CND._book_rows(r, sid, t) for t in sorted(
        DEPOT.values())},
    "the registry": lambda r: CND.registry(r),
    "the engine's Condition Instances snapshot": lambda r: {str(k): v for k, v in (HE.ci_snapshot(r, rid) or {}).items()},
}
copies = {k: on_copy(f) for k, f in READERS.items()}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for res, tab in DEPOT.items():
            if not RR.uploaded(db, res):
                RR.upload(L.Reads(db, None), res, tab, SR.DERIVE.get(res))
        check("no depot tab name is a house by its name alone", not any(t in SR.TAB_OF for t in DEPOT.values()))
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(copies[name]), first_diff(got, copies[name]))
        wid = "Wzzdepottabscheck001"
        tok = SC._WRITE.set({"write_id": wid})
        edits = [W.kept_record(sid, "Condition Instances", "append", "cols:Instance ID", "zzci1", "check",
                               {"Instance ID": "zzci1", "Condition ID": "zzcond", "Subject ID": "zzsub",
                                "Status": "open"}),
                 W.kept_record(sid, "Events", "append", "cols:Event ID", "zzev1", "check",
                               {"Event ID": "zzev1", "Subject ID": "zzsub", "Kind": "journey"})]
        W.Tx(cur, "location").record(wid, "check", {"status": 200}, W.final({"status": 200}, edits, "check"), "check")
        snap = plain(HE.ci_snapshot(L.Reads(db, None), rid) or {})
        check("the condition instance lands in its table, as the engine's snapshot reads it", "zzcond" in snap)
        ev = CND._book_rows(L.Reads(db, None), sid, "Events")
        check("the journey event lands in its table", ev and any("zzev1" in [str(c) for c in row] for row in ev[1]))
        cur.execute(f"select count(*) from {W.EDITS_TABLE} where write_id = %s", (wid,))
        check("app.edits keeps none of it", cur.fetchone()[0] == 0)
        SC._WRITE.reset(tok)
        RR.void(cur, wid)
        back = READERS["every tab whole, as the book reader reads it"](L.Reads(db, None))
        check("a void takes it all back", plain(back) == plain(copies["every tab whole, as the book reader reads it"]))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
