"""The shared finance settings (finance_config) on their own table (financeConfig), not on a spreadsheet: Finance's,
Recon's and Learning's readers and the generic rows answer what they answered off the copy; finSettingsSet and
reconConfigSet change the table alone, as the write's own; and a void takes them back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-finance-config-table.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("FINANCE_CONFIG_TABLE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_finance_config_table.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"FINANCE_CONFIG_TABLE_INPROC": "1"})], capture_output=True, text=True,
                         timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import finance as F  # noqa: E402
import finance_writes as FW  # noqa: E402
import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import learning as LR  # noqa: E402
import locations as L  # noqa: E402
import ops_stragglers as OS  # noqa: E402
import recon as R  # noqa: E402
import recon_writes as RW  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
TAB, RES = F.CONFIG_TAB, "financeConfig"


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


READERS = {
    "Finance's config rows": F.config_rows,
    "Finance's vocabulary": F.vocabulary,
    "Recon's rows": lambda r: R.rows(r, TAB),
    "Recon's thresholds": R.config,
    "Learning's rules": LR.rules,
}
copies = {k: on_copy(f) for k, f in READERS.items()}
copy_generic = on_copy(lambda r: OS.rows(r, TAB))
facts["rows on the copy"] = len(copies["Finance's config rows"])
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
        check("the generic rows answer the copy's", plain(SR.rows(L.Reads(db, None), RES)) == plain(copy_generic))
        wid = "Wzzfinanceconfigcheck1"
        tok = SC._WRITE.set({"write_id": wid})
        key = F.CFG_KEYS[0]
        d = FW.settings_set(L.Session(L.Reads(db, None), master), {key: list(F.FLOOR[key]) + ["Zz check"]})
        voc = F.vocabulary(L.Reads(db, None))
        check("finSettingsSet keeps the vocabulary in the table as the write's own", d.answer.get("status") == 200
              and d.own and not d.edits and "Zz check" in voc[key], (d.answer, d.edits, voc.get(key)))
        d = RW.config_set(L.Session(L.Reads(db, None), master), {"gapMin": 7})
        kept = [c for _k, c in RR.table_rows(None, RES) if c.get("key") == R.CONFIG_KEY]
        check("reconConfigSet keeps the thresholds in the table as the write's own",
              d.answer.get("status") == 200 and d.own and not d.edits and len(kept) == 1
              and json.loads(kept[0].get("value") or "{}").get("gapMin") == 7, (d.answer, kept))
        SC._WRITE.reset(tok)
        RR.void(cur, wid)
        check("a void takes them back",
              plain(F.config_rows(L.Reads(db, None))) == plain(copies["Finance's config rows"]))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
