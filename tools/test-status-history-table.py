"""Every candidate's stage moves (LogStatusHistory, log_status_history) on their own table (logStatusHistory), not on a
spreadsheet: the Talent readers (read_tab, status_rows, a candidate's history, the stage arrivals, the riders' last
human touch), Screening's history and My Inbox's house read (my_work.HubBooks) answer what they answered off the copy;
a stage move's row and an intake's row land in the table alone, leaving no edit; and a void takes them back. One
transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-status-history-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("STATUS_HISTORY_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_status_history_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"STATUS_HISTORY_TABLE_INPROC": "1"})], capture_output=True, text=True,
                         timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import candidate_writes as CDW  # noqa: E402
import candidates as CND  # noqa: E402
import client_writes  # noqa: E402
import hiring_intake_writes as HIW  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import my_inbox as MI  # noqa: E402
import my_work as MW  # noqa: E402
import resource_rows as RR  # noqa: E402
import screening as SCR  # noqa: E402
import smart_comms as SC  # noqa: E402
import talent_riders as TR  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
TAB, RES = CND.CND_STATUS_TAB, "logStatusHistory"


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))


class Through:
    """asa-hub-db as this transaction sees it: its queries on the transaction's cursor, the rest the real reader's."""

    def __init__(self, real: hubdb.HubDb, cur) -> None:
        self._real, self._cur = real, cur

    def query(self, sql: str, params: tuple = ()) -> list[tuple]:
        self._cur.execute(sql, params)
        return list(self._cur.fetchall())

    def __getattr__(self, name: str):
        return getattr(self._real, name)


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


def inbox(r: L.Reads) -> list[dict]:
    """My Inbox's house read of the history, its rows only."""
    sid = db.switchboard("props").get(MI.PTR_STATUS_HISTORY)
    return MW.HubBooks(r).tab(sid, MI.HOUSE_TAB)[0]


someone = next((s for s in (str(r.get("candidateid") or "") for r in on_copy(CND.status_rows)) if s), "")
READERS = {
    "Talent's read_tab": lambda r: CND.read_tab(r, TAB),
    "the status rows": CND.status_rows,
    "a candidate's stage history": lambda r: CND.status_history(r, someone),
    "the stage arrivals": CND._stage_arrivals,
    "the riders' last human touch": TR.last_human_touch,
    "Screening's history": SCR.history_rows,
}
copies = {k: on_copy(f) for k, f in READERS.items()}
copy_inbox = inbox(L.Reads(db, None))
facts["moves on the copy"] = len(copies["the status rows"])
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
                  (len(got) if isinstance(got, list) else got, len(copies[name]) if isinstance(got, list) else ""))
        seen = inbox(L.Reads(Through(db, cur), None))
        check("My Inbox reads the table's rows where it read the copy's", plain(seen) == plain(copy_inbox),
              (len(seen), len(copy_inbox), seen[:1], copy_inbox[:1]))
        wid = "Wzzstatushistorycheck1"
        tok = SC._WRITE.set({"write_id": wid})
        moved = CDW.status_record(L.Reads(db, None), "zzC1", {"timestamp": "2026-10-26T21:40:00.000Z",
                                                              "candidate_id": "zzC1", "candidate_name": "Zz Check",
                                                              "from_status": "New", "to_status": "Phone Screen",
                                                              "actor": "check@example.invalid"})
        took = HIW.status_row(L.Reads(db, None), "zzC2", "Zz Intake", "New", "Phone Screen", "referral:fast-lane",
                              "2026-10-26T21:41:00.000Z")
        echo = HIW.status_row(L.Reads(db, None), "zzC3", "Zz Echo", "New", "New", "x", "2026-10-26T21:42:00.000Z")
        SC._WRITE.reset(tok)
        hist = CND.status_history(L.Reads(db, None), "zzC1")
        check("a stage move's row and an intake's row land in the table and leave no edit; an echo is no row",
              moved == [] and took == [] and echo == []
              and hist == [{"at": "2026-10-26T21:40:00.000Z", "from": "New", "to": "Phone Screen",
                            "by": "check@example.invalid"}]
              and any(str(r.get("candidateid")) == "zzC2" for r in CND.status_rows(L.Reads(db, None)))
              and not any(str(r.get("candidateid")) == "zzC3" for r in CND.status_rows(L.Reads(db, None))),
              (moved, took, echo, hist))
        check("My Inbox sees them too", {"zzC1", "zzC2"} <= {str(r.get("candidate_id"))
                                                           for r in inbox(L.Reads(Through(db, cur), None))})
        RR.void(cur, wid)
        check("a void takes them back", plain(CND.status_rows(L.Reads(db, None))) == plain(copies["the status rows"]))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
