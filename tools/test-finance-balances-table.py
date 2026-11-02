"""The on-file balances (finance_balances) on their own table (financeBalances), not on a spreadsheet: Clients' Funds
answers every client's balances on file and closed months as it did off the copy, the card shown by the same last
four; the table keeps no withheld marker and nothing of a card beyond those four; and the generic rows serve it.
One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-finance-balances-table.py
"""
import json
import os
import re
import subprocess
import sys

if not os.environ.get("FINANCE_BALANCES_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_finance_balances_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"FINANCE_BALANCES_TABLE_INPROC": "1"})], capture_output=True, text=True,
                         timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_sources as CS  # noqa: E402
import client_writes  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import sheet_resources as SR  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
TAB, RES = "finance_balances", "financeBalances"


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))


def plain(v: object) -> str:
    return json.dumps(v, sort_keys=True, default=str)


copy_rows = CS.hub_rows(L.Reads(db, None), TAB)
clients = []
for b in copy_rows:
    c = {"client_key": gsjs.trim(gsjs.str_(b.get("client_key"))),
         "name_key": gsjs.name_key(b.get("client_name") or b.get("client"))}
    if c not in clients:
        clients.append(c)
copy_funds = [CS._balances_on_file(c, copy_rows) for c in clients]
facts["the copy"] = {"rows": len(copy_rows), "clients": len(clients),
                     "cards shown": sum(1 for f in copy_funds if (f["on_file"] or {}).get("card_last4"))}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        if not RR.uploaded(db, RES):
            RR.upload(L.Reads(db, None), RES, TAB, SR.DERIVE[RES])
        rows = CS.kept_hub_rows(L.Reads(db, None), TAB)
        got = [CS._balances_on_file(c, rows) for c in clients]
        check("Clients' Funds answers every client's balances, the card by the same last four",
              plain(got) == plain(copy_funds), next(((a, b) for a, b in zip(got, copy_funds) if a != b), None))
        cards = [gsjs.or_blank(c.get("debit_card")) for _k, c in RR.table_rows(None, RES)]
        check("the table keeps no withheld marker and nothing of a card beyond its last four",
              all(v == "" or re.fullmatch(r"ending \d{4}", v) for v in cards), cards)
        check("the generic rows serve it, none withheld",
              len(SR.rows(L.Reads(db, None), RES)) == len(copy_rows)
              and not any(str(v).startswith(RR.WITHHELD) for r in SR.rows(L.Reads(db, None), RES) for v in r.values()))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
