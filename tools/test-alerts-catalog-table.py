"""The configuration catalogue (AlertsCatalog, hiring_alerts_catalog) on its own table (hiringAlertsCatalog), not on a
spreadsheet: Alerts Config's catalogue, and the hide defaults the config lane, My Work, SSA, Support Desk, Scheduling
and My Calendar read from it, answer what they answered off the copy. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-alerts-catalog-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("ALERTS_CATALOG_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_alerts_catalog_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"ALERTS_CATALOG_TABLE_INPROC": "1"})], capture_output=True, text=True,
                         timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import alerts_config as AC  # noqa: E402
import client_writes  # noqa: E402
import config_lane as CL  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import my_calendar_writes as MCW  # noqa: E402
import my_work as MW  # noqa: E402
import resource_rows as RR  # noqa: E402
import scheduling as SCH  # noqa: E402
import ssa as SSA  # noqa: E402
import support_desk as SD  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
TAB, RES = AC.CATALOG_TAB, "hiringAlertsCatalog"


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


READERS = {
    "Alerts Config's catalogue as its house holds it": AC.catalog_from_sheet,
    "Alerts Config's whole catalogue": lambda r: AC.catalog_merge(AC.catalog_from_sheet(r)),
    "the config lane's hide defaults": CL.hide_defaults,
    "My Work's hide defaults": MW._hide_defaults,
    "SSA's hide defaults": SSA._hide_defaults,
    "Support Desk's auto defaults": SD.auto_defaults,
    "Scheduling's hours default": SCH._hide_default,
    "My Calendar's time-off default": MCW._catalogue_default,
}
copies = {k: on_copy(f) for k, f in READERS.items()}
facts["keys on the copy"] = len(copies["Alerts Config's catalogue as its house holds it"].get("rows") or [])
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        if not RR.uploaded(db, RES):
            RR.upload(L.Reads(db, None), RES, TAB)
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(copies[name]), (got, copies[name]))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
