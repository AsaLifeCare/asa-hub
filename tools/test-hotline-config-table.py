"""The hotline sweep's orders on their own table (hotlineConfig), not on a spreadsheet: hotline.config and the calls
index's _read_config answer what the copy answered; hotlineConfigSet changes a key's row and makes a missing one in the
table alone, kept as the write's own, and refuses anyone but an admin. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-hotline-config-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("HOTLINE_CONFIG_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_hotline_config_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"HOTLINE_CONFIG_TABLE_INPROC": "1"})], capture_output=True, text=True,
                         timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import hotline as H  # noqa: E402
import hotline_calls as HC  # noqa: E402
import hotline_writes as HW  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
TAB = H.CONFIG_TAB


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
        return read()
    finally:
        HT.tabled = tabled


def bare(cfg: dict) -> dict:
    return {k: v for k, v in cfg.items() if k != "config_from"}


copy_cfg = on_copy(lambda: H.config(L.Reads(db, None)))
copy_sweep = on_copy(HC._read_config)
facts["the copy"] = {"from": copy_cfg["config_from"], "keys": sorted(k for k in copy_cfg if k != "prompt"),
                     "sweep": copy_sweep}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        if not RR.uploaded(db, HT.resource_of(TAB)):
            RR.upload(L.Reads(db, None), HT.resource_of(TAB), TAB)
        got = H.config(L.Reads(db, None))
        check("hotline.config answers the copy's orders", bare(got) == bare(copy_cfg)
              and got["config_from"] == "table", {k: (got.get(k), copy_cfg.get(k)) for k in got
                                                  if got.get(k) != copy_cfg.get(k)})
        check("the calls index reads the same orders", HC._read_config() == copy_sweep, (HC._read_config(), copy_sweep))
        tok = SC._WRITE.set({"write_id": "Wzzhotlineconfigcheck01"})
        admin = {"uid": "check", "name": "check", "role": "admin"}
        try:
            d = HW.config_set(L.Session(L.Reads(db, None), admin), {"max_per_sweep": "7", "enabled": "on"})
        except W.GateHeld as held:
            d = None
            facts["held by the book-write funnel"] = str(held)[:200]
        if d is not None:
            after = H.config(L.Reads(db, None))
            check("hotlineConfigSet changes the keys on the table and leaves no edit",
                  d.answer.get("status") == 200 and d.own and not d.edits and after["max_per_sweep"] == "7"
                  and after["enabled"] == "on", (d.answer, d.own, d.edits, after.get("max_per_sweep")))
            rows = [c for _k, c in RR.table_rows(None, HT.resource_of(TAB)) if c.get("key") == "max_per_sweep"]
            check("a key is one row, however often it is set", len(rows) == 1, rows)
            env = W.envelope(d, "Wzzhotlineconfigcheck01", admin)
            check("the save is kept as the write's own", (env.get("_write") or {}).get("final") is True, env)
        d = HW.config_set(L.Session(L.Reads(db, None), {"uid": "x", "role": "staff"}), {"enabled": "off"})
        check("anyone but an admin is refused", d.answer.get("status") != 200 and not d.own, d.answer)
        SC._WRITE.reset(tok)
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
