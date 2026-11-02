"""The Scheduling board's own houses (sched_cells, sched_rows, sched_flows, sched_inbox) on their own tables, not on
spreadsheets: every reader (Scheduling's read_tab and its cleared cells, the Builder's, the flows', Staff
performance's), the board and the time-off list as the master sees them, and My Work's read of the inbox answer what
they answered off the copies; the board's Plan makes, changes and clears a cell, a flow and an inbox item in the tables
alone, a cleared cell kept as the copy keeps one; and a void takes it all back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-sched-board-tables.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("SCHED_BOARD_TABLES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_sched_board_tables.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"SCHED_BOARD_TABLES_INPROC": "1"})], capture_output=True, text=True,
                         timeout=900)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import my_work as MW  # noqa: E402
import resource_rows as RR  # noqa: E402
import scheduling as SCH  # noqa: E402
import scheduling_builder as SB  # noqa: E402
import scheduling_flows as SF  # noqa: E402
import scheduling_writes as SW  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import staff_perf as SP  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
HOUSES = {"sched_cells": "schedCells", "sched_rows": "schedRows", "sched_flows": "schedFlows",
          "sched_inbox": "schedInbox"}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
boss = next((u for u in L.Reads(db, None).users() if not gsjs.str_(u.get("mergedinto"))
             and sc.is_master_email(u.get("email")) and gsjs.str_(u.get("role")) == "admin"), None)
master = sc.user_from_row(boss)


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


def unwithheld(v: object) -> object:
    """The copy's answer with each withheld cell token as the upload works it out (SR.cell_token: proven on every
    token the copy shows), so the copy and the table compare by what a cell holds."""
    if isinstance(v, dict):
        out = {k: unwithheld(x) for k, x in v.items()}
        if isinstance(out.get("token"), str) and out["token"].startswith(RR.WITHHELD) and "text" in out:
            out["token"] = SR.cell_token(out)
        return out
    if isinstance(v, (list, tuple)):
        return [unwithheld(x) for x in v]
    return v


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


def inbox(r: L.Reads) -> list[dict]:
    sid = db.switchboard("props").get(MW.PTR_SCHED_INBOX)
    return MW.HubBooks(r).tab(sid, MW.HOUSE_TAB)[0]


READERS = {
    **{f"{t}: Scheduling's read_tab": (lambda r, t=t: SCH.read_tab(r, t)) for t in HOUSES},
    "sched_cells: the cleared cells": lambda r: SCH.gone_rows(r, "sched_cells"),
    **{f"{t}: the Builder's reader": (lambda r, t=t: SB._read(r, t)) for t in ("sched_cells", "sched_rows",
                                                                               "sched_flows")},
    **{f"{t}: the flows' reader": (lambda r, t=t: SF._rows(r, t)) for t in HOUSES},
    **{f"{t}: Staff performance's reader": (lambda r, t=t: SP._sched_read(r, t)) for t in ("sched_cells",
                                                                                           "sched_rows",
                                                                                           "sched_flows")},
    # the board's own clock left out: each read tells the moment it was made
    "the board as the master sees it": lambda r: {**(b := SCH.board_read(L.Session(r, master), {})),
                                                  "data": {k: v for k, v in (b.get("data") or {}).items()
                                                           if k != "now"}},
    "the time-off list as the master sees it": lambda r: SCH.time_off_list(L.Session(r, master), {}),
}
copies = {k: on_copy(f) for k, f in READERS.items()}
copy_inbox = inbox(L.Reads(db, None))
facts["rows on the copies"] = {t: len(copies[f"{t}: Scheduling's read_tab"]) for t in HOUSES}
facts["cleared cells on the copy"] = len(copies["sched_cells: the cleared cells"])
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for tab, res in HOUSES.items():
            if not RR.uploaded(db, res):
                RR.upload(L.Reads(db, None), res, tab, SR.DERIVE.get(res))
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(unwithheld(copies[name])),
                  first_diff(got, unwithheld(copies[name])))
        seen = inbox(L.Reads(Through(db, cur), None))
        check("My Work reads the inbox off its table", plain(seen) == plain(copy_inbox), first_diff(seen, copy_inbox))
        wid = "Wzzschedboardcheck0001"
        tok = SC._WRITE.set({"write_id": wid})
        some = next(c for c in SCH.read_tab(L.Reads(db, None), "sched_cells"))
        plan = SW.Plan(L.Reads(db, None), {"uid": "check"})
        cell = {**{h: "" for h in SCH.HEADERS["sched_cells"]}, **{k: some[k] for k in ("period_id", "house_code",
                                                                                      "row_id")},
                "id": "zzCELL1", "date": "2099-01-01", "text": "8-4", "updated_at": "now", "updated_by": "check"}
        plan.upsert("sched_cells", cell)
        plan.upsert("sched_flows", {**{h: "" for h in SCH.HEADERS["sched_flows"]}, "id": "zzFLOW1", "kind": "check"})
        plan.upsert("sched_inbox", {**{h: "" for h in SCH.HEADERS["sched_inbox"]}, "id": "zzINB1",
                                    "flow_id": "zzFLOW1"})
        made = plan.records("check")
        r1 = L.Reads(db, None)
        check("the Plan makes a cell, a flow and an inbox item in their tables and leaves no edit", made == []
              and any(c["id"] == "zzCELL1" for c in SCH.read_tab(r1, "sched_cells"))
              and any(f["id"] == "zzFLOW1" for f in SCH.read_tab(r1, "sched_flows"))
              and any(i["id"] == "zzINB1" for i in SCH.read_tab(r1, "sched_inbox")), made)
        plan = SW.Plan(L.Reads(db, None), {"uid": "check"})
        plan.upsert("sched_cells", {**cell, "text": "9-5"})
        plan.records("check")
        check("the Plan changes the cell there", next((c["text"] for c in SCH.read_tab(L.Reads(db, None), "sched_cells")
                                                      if c["id"] == "zzCELL1"), "") == "9-5")
        plan = SW.Plan(L.Reads(db, None), {"uid": "check"})
        plan.remove("sched_cells", "zzCELL1")
        plan.records("check")
        r2 = L.Reads(db, None)
        kept = HT.find(r2, "sched_cells", "id", "zzCELL1")
        check("a removed cell is cleared, its id kept, and read as no cell", kept is not None
              and not gsjs.or_blank(kept[1].get("text")) and kept[1].get("updated_by") == "check"
              and all(c["id"] != "zzCELL1" for c in SCH.read_tab(r2, "sched_cells"))
              and "zzCELL1" in SCH.gone_rows(r2, "sched_cells"), kept)
        SC._WRITE.reset(tok)
        RR.void(cur, wid)
        check("a void takes it all back", all(plain(SCH.read_tab(L.Reads(db, None), t))
                                              == plain(unwithheld(copies[f"{t}: Scheduling's read_tab"]))
                                              for t in HOUSES))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
