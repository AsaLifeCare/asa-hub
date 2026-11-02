"""Scheduling's settings, change log and Builder drafts on their own tables (schedSettings, schedLog, schedDrafts),
not on spreadsheets: every reader (scheduling.read_tab, the Builder's, the flows', Staff performance's) answers the rows
the copy answered; a setting kept through the board's Plan, a draft through the Builder's upsert and a log line through
its append land in the tables alone; and a write that changed a table row is kept as one (writes.plan_of), whatever
its door said. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-sched-tables.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("SCHED_TABLES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_sched_tables.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"SCHED_TABLES_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import scheduling as SCH  # noqa: E402
import scheduling_builder as SB  # noqa: E402
import scheduling_flows as SF  # noqa: E402
import scheduling_writes as SW  # noqa: E402
import smart_comms as SC  # noqa: E402
import staff_perf as SP  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
TABS = ("sched_settings", "sched_log", "sched_drafts")


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))


def copy_rows(tab: str) -> list[dict]:
    """What schedRead_ answered off the copy: every header a key, each cell its text, the kept edits laid."""
    reads = L.Reads(db, None)
    res = db.resolve(tab)
    idf = "key" if tab == "sched_settings" else "id"
    heads = [gsjs.trim(gsjs.or_blank(h)) for h in res.ref.headers]
    out = []
    for raw in db.sheetdb_rows(res.ref):
        row = {h: "" for h in SCH.HEADERS[tab]}
        for h in heads:
            if h:
                row[h] = gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(h), "raw")))
        if row.get(idf):
            out.append(row)
    del reads
    return out


def same(v: object) -> object:
    """A cell as a value: JSON text and the list or object it reads as compare equal, whatever its spacing."""
    if isinstance(v, str) and v[:1] in "[{":
        try:
            return json.loads(v)
        except ValueError:
            return v
    return v


def key(rows: list[dict], tab: str) -> list[str]:
    return sorted(json.dumps({h: same(r.get(h, "")) for h in SCH.HEADERS[tab]}, sort_keys=True) for r in rows)


copies = {t: copy_rows(t) for t in TABS}
facts["rows on the copies"] = {t: len(v) for t, v in copies.items()}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for t in TABS:
            if not RR.uploaded(db, HT.resource_of(t)):
                RR.upload(L.Reads(db, None), HT.resource_of(t), t)
        for t in TABS:
            reads = L.Reads(db, None)
            check(f"{t}: Scheduling's reader answers the copy's rows", key(SCH.read_tab(reads, t), t)
                  == key(copies[t], t), (len(SCH.read_tab(reads, t)), len(copies[t])))
            check(f"{t}: the Builder's reader too", key(SB._read(L.Reads(db, None), t), t) == key(copies[t], t))
            check(f"{t}: the flows' reader too", key(SF._rows(L.Reads(db, None), t), t) == key(copies[t], t))
        check("Staff performance reads the settings off the table",
              key(SP._sched_read(L.Reads(db, None), "sched_settings"), "sched_settings")
              == key(copies["sched_settings"], "sched_settings"))
        tok = SC._WRITE.set({"write_id": "Wzzschedtablecheck0001"})
        reads = L.Reads(db, None)
        plan = SW.Plan(reads, {"uid": "check"})
        plan.upsert("sched_settings", {"key": "zz_table_check", "value": "1", "note": "", "updated_at": "now",
                                       "updated_by": "check"})
        edits = plan.records(SCH.APP_ID)
        check("a setting kept through the board's Plan lands in its table and leaves no edit", not edits
              and HT.find(L.Reads(db, None), "sched_settings", "key", "zz_table_check") is not None, edits)
        got = SB._upserts(L.Reads(db, None), "sched_drafts", [{"id": "zz_draft", "house_code": "ZZ1", "state": "draft",
                                                               "rev": "1"}], "check")
        check("a draft through the Builder's upsert lands in its table", got == []
              and HT.find(L.Reads(db, None), "sched_drafts", "id", "zz_draft") is not None, got)
        got = SB._appends(L.Reads(db, None), "sched_log", [{"id": "zz_log", "at": "now", "via": "check"}], "check")
        check("a log line through the append lands in its table", got == []
              and HT.find(L.Reads(db, None), "sched_log", "id", "zz_log") is not None, got)
        envelope = W.envelope(W.Decision({"status": 200}), "Wzzschedtablecheck0001", None)
        check("a write that changed a table row is kept as one, though its door said nothing",
              (envelope.get("_write") or {}).get("final") is True, envelope)
        check("a write that changed none is not", "_write" not in W.envelope(W.Decision({"status": 200}),
                                                                             "Wzznothing000000000001", None))
        SC._WRITE.reset(tok)
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
