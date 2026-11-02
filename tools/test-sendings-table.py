"""The Smart Comms ledger (Sendings, smart_comms_sent) on its own table (smartCommsActivity), not on a spreadsheet:
every reader — the trail's ledger_rows, the clock's ledger_stats, Comm Repair's, Flow Control's and its already-sent
keys, the calendar's sends, the Activity resource and the Desk's count — answers what it answered off the copy; a
line kept while deciding (record_ledger) and one kept after a send (_note_ledger's append, on the drain's own cursor)
land in the table alone, under their write; and a void takes the write's lines back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-sendings-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("SENDINGS_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_sendings_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"SENDINGS_TABLE_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import comm_repair as CR  # noqa: E402
import company_calendar as CAL  # noqa: E402
import hiring_flow as HF  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import ops_stragglers as OS  # noqa: E402
import resource_rows as RR  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_clock as CLK  # noqa: E402
import smart_comms as SC  # noqa: E402
import smart_comms_desk as SCD  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
TAB, RES = SC.LEDGER_TAB, "smartCommsActivity"


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


def trail(reads: L.Reads) -> list[dict]:
    """What the trail, the profiles and the clock take from ledger_rows: the six cells, each as getValues hands it."""
    rows, heads = SCD.ledger_rows(reads)
    return [{h: str(hubdb.typed(raw.get(heads[h]), "hub")) for h in SCD.SMART_LEDGER_HEADER} for _rn, raw in rows]


def plain(v: object) -> str:
    return json.dumps(v, sort_keys=True, default=str)


READERS = {
    "the trail's ledger_rows": trail,
    "Comm Repair's ledger": CR.ledger_rows,
    "the clock's ledger_stats": CLK.ledger_stats,
    "Flow Control's ledger": HF.ledger_rows,
    "the already-sent keys": lambda r: sorted(HF.ledger_keys(r)),
    "the calendar's sends": lambda r: CAL.sends(r, "2000-01-01", "2100-12-31"),
}
copies = {k: on_copy(f) for k, f in READERS.items()}
copy_activity = on_copy(lambda r: OS.rows(r, TAB))
facts["lines on the copy"] = len(copies["the trail's ledger_rows"])
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
                  (len(got) if isinstance(got, list) else "", len(copies[name]) if isinstance(got, list) else ""))
        got = SR.rows(L.Reads(db, None), RES)
        check("the Activity resource lists the copy's rows", plain(got) == plain(copy_activity),
              (len(got), len(copy_activity)))
        count = next((h for h in SCD.houses(L.Reads(db, None)) if h["id"] == TAB), {})
        check("the Desk counts the table's lines", count.get("rows") == len(copies["the trail's ledger_rows"])
              and count.get("record") is True, count)
        cur.execute(f"select count(*) from {W.EDITS_TABLE}")
        edits_before = cur.fetchone()[0]
        wid = "Wzzsendingscheck000001"
        tok = SC._WRITE.set({"write_id": wid, "tx": cur, "door": "check"})
        kept = SC.record_ledger("ZZ|sendings|check", "zz_check", "check person", "2026-12-31", "sms")
        SC._WRITE.reset(tok)
        c = {"write_id": wid, "door": "check"}
        sent = SC._append_house(cur, c, db, TAB, SC.LEDGER_HEADER,
                                {"key": "ZZ|sendings|drain", "situation": "zz_check", "person": "check person",
                                 "expires": "", "channel": "sms", "at": SC.iso(time.time())}, SC.LEDGER_MATCH, "x")
        cur.execute(f"select count(*) from {W.EDITS_TABLE}")
        edits_after = cur.fetchone()[0]
        cur.execute(f"select count(*) from {RR.ROWS} where resource = %s and write_id = %s", (RES, wid))
        lines = cur.fetchone()[0]
        check("a line kept while deciding and one after a send land in the table, under their write", kept and sent
              and lines == 2 and edits_after == edits_before, (kept, sent, lines, edits_before, edits_after))
        keys = HF.ledger_keys(L.Reads(db, None))
        check("the already-sent keys see them", {"ZZ|sendings|check", "ZZ|sendings|drain"} <= keys)
        stats = CLK.ledger_stats(L.Reads(db, None))
        got = stats["attempts"].get("ZZ|sendings|check", {})
        check("the clock counts them", got.get("count") == 1, got)
        SC.void_write(cur, wid)
        cur.execute(f"select count(*) from {RR.ROWS} where resource = %s and write_id = %s", (RES, wid))
        check("a void takes the write's lines back", cur.fetchone()[0] == 0)
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
